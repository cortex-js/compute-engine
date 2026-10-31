// Element-wise and reducing extrema, Gcd and Lcm.

import type { Expression } from '../global-types.js';
import { formatFloat } from './constant-folding.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import {
  gpuOperandShape,
  gpuShapeName,
  gpuShapeRules,
  gpuSlotNames,
  gpuTopLevelCall,
} from './gpu-shapes.js';
import type { GPUShapeRules } from './gpu-shapes.js';
import {
  GPU_AGGREGATE_CONSTRUCTOR,
  GPU_AGGREGATE_CONSTRUCTOR_ANYWHERE,
  gpuIdentityPassthrough,
  gpuIsAtomicEmission,
  gpuNaN,
  gpuParenthesizeIdentity,
  gpuVecType,
} from './gpu-emit.js';
import { gpuProvablyFinite } from './gpu-finite-proof.js';
import { gpuCanPlaceStatement } from './gpu-statements.js';
import {
  gpuAssertBindingKeepsDrawOrder,
  gpuRecordBoundDraws,
} from './gpu-draw-order.js';
import { isCallerMapped } from './cse.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import { multiClauseState } from '../multi-clause.js';

/**
 * Can the emitted source of `expr` be written more than once with the same
 * value and no added effect? It cannot when `expr` is impure once its
 * assigned symbol values and called user-function bodies are looked through
 * (`expr.isPure` stops at a symbol with a value), or when it reads a symbol
 * whose `vars` entry is caller source or applies a head whose emission the
 * caller supplied, directly or inside one of those values or bodies. The
 * caller's code can count its calls or draw a number, and the compiler does
 * not see inside it.
 */
function gpuRepeatableSource(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (BaseCompiler.foldValueImpure(expr)) return false;
  // A route with no common-subexpression session (`compileToSource`, a
  // declared function body, a whole shader) has no `vars` or `functions`,
  // but an operator declared with its own `compile` handler still emits
  // caller code there, and `isCallerMapped` finds it from the definition.
  const caller = target.cse?.harvestOptions ?? {};
  // The walk looks through what a shader target inlines: the value of an
  // assigned symbol, the body of a called user-defined function, and each
  // clause of a multi-clause function. Each node and each name is visited
  // once, so a value that refers to itself ends the walk.
  const engine = expr.engine;
  const seen = new Set<Expression>();
  const names = new Set<string>();
  const callerCode = (node: Expression): boolean => {
    if (seen.has(node)) return false;
    seen.add(node);
    if (isSymbol(node)) {
      if (caller.isStringVar?.(node.symbol) === true) return true;
      if (names.has(node.symbol)) return false;
      names.add(node.symbol);
      const value = engine._getSymbolValue(node.symbol);
      return value !== undefined && callerCode(value);
    }
    if (!isFunction(node)) return false;
    if (isCallerMapped(node, caller) || node.ops.some(callerCode)) return true;
    if (names.has(node.operator)) return false;
    names.add(node.operator);
    const literal = userFunctionLiteral(engine, node.operator);
    if (literal !== undefined) return callerCode(literal);
    const clauses = multiClauseState(
      engine.lookupDefinition(node.operator)
    )?.clauses;
    return clauses?.some((c) => callerCode(c.literal)) ?? false;
  };
  return !callerCode(expr);
}

/**
 * Fold a variadic application of a 2-argument shader builtin (`min`/`max`)
 * into a left-nested tree of 2-argument calls: `max(max(a, b), c)`. GLSL and
 * WGSL do not accept a 3+-argument `min`/`max`, so emitting `max(a, b, c)`
 * would be invalid shader source.
 *
 * Each GENERATED call is validated as it is produced, against the ORIGINAL
 * operand shapes (`gpuOperandShape`) rather than against the emitted source:
 * once the fold has nested the calls, the CE operand positions no longer line
 * up with the emitted argument positions, and the generic gate's source-level
 * reconstruction (`gpuSourceIsVector`) cannot see a vector in a BARE
 * IDENTIFIER at all — so `ElementMax(2, v, w)` over two declared `vector<3>`
 * symbols emitted `max(max(2.0, v), w)`, which no GLSL driver accepts, behind
 * `success: true`. The accumulator's shape is exact by construction: it is a
 * vector as soon as any operand folded into it is one.
 *
 * With TWO operands the emission passes them through ONE FOR ONE, so the
 * generic gate already judges it on the same exact shapes (and phrases the
 * diagnostic in its own positional terms); only the nested calls of a longer
 * fold need the shapes carried in here.
 */
function foldNaryBuiltin(
  name: string,
  head: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  rules: GPUShapeRules | undefined,
  target?: CompileTarget<Expression>
): string {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${name}\`: needs at least one argument`
    );
  // One operand: no call is emitted and the lowering is the operand's own
  // code, so it keeps its grouping in an infix parent
  // (`gpuIdentityPassthrough`): `3·ElementMax(x + 1)` emitted `3.0 * x + 1.0`.
  // CE-251.1.
  if (args.length === 1)
    return gpuIdentityPassthrough(args[0], compile, target);
  const shapes = args.map(gpuOperandShape);
  const slots = rules?.scalarGenTypeSlots.get(name);
  // A builtin the language gives no scalar/genType overload AT ALL is judged
  // exactly by the generic gate already (it compares the CE operand shapes, not
  // the source, to reach its `requires MATCHING genType` verdict), so the fold
  // leaves that case — and the one-for-one two-operand case — to it.
  const check = slots !== undefined && args.length > 2;
  let acc = `${name}(${compile(args[0])}, ${compile(args[1])})`;
  let accShape = shapes[0];
  for (let i = 1; i < args.length; i++) {
    if (i > 1) acc = `${name}(${acc}, ${compile(args[i])})`;
    if (check) {
      const pair = [accShape, shapes[i]];
      const bad = pair.findIndex(
        (s, k) => s === 'scalar' && !slots!.has(k) && pair[1 - k] !== 'scalar'
      );
      if (bad >= 0)
        throw new Error(
          `Could not compile \`${head}\`: the shader builtin \`${name}\` takes a scalar only ` +
            `${gpuSlotNames(slots!)}, but the emitted call \`${acc}\` has a ` +
            `scalar in argument ${bad + 1}, where the overload requires the ` +
            `\`vecN\` genType; the scalar is not promoted to a vector.`
        );
    }
    // The accumulator is a vector as soon as any operand folded into it is.
    if (accShape === 'scalar') accShape = shapes[i];
  }
  return acc;
}

/**
 * Compile `ElementMax`/`ElementMin` as a left fold of the NaN-safe helpers
 * (`gpuNaNSafeLibrary`): `_gpu_max(a, b)` when every operand is a
 * scalar, and `_gpu_maxN(a, b)` when the operands are `vecN` values of one
 * width and scalars, each scalar broadcast with the vector constructor, as
 * the interpreter broadcasts it (`ElementMax(2, [1, 3, 5])` is `[2, 3, 5]`).
 * When every operand is finite for certain (`gpuProvablyFinite`, asked of
 * each operand as written, before a scalar is broadcast), the built-in
 * `max`/`min` takes the same operands: `max(v, vec3(0.0))`.
 * Each operand is compiled once.
 *
 * Other operand shapes (a matrix, an array, a complex operand, vectors of
 * different widths) keep the built-in fold of `foldNaryBuiltin`, so that the
 * operand-shape gate gives its reason for the decline. So does a single
 * operand, which `foldNaryBuiltin` passes through unchanged.
 */
export function compileGPUElementExtremum(
  name: 'max' | 'min',
  head: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const builtin = (): string =>
    foldNaryBuiltin(name, head, args, compile, gpuShapeRules(target), target);
  if (args.length < 2) return builtin();
  if (args.some((a) => BaseCompiler.isComplexValued(a))) return builtin();
  const shapes = args.map(gpuOperandShape);
  // Finite operands need no guard (`gpuProvablyFinite`). The proof reads the
  // operands as written, before a scalar is broadcast: a scalar widened to
  // `vecN(s)` is finite exactly when `s` is. Operands of one shape (all
  // scalars, or `vecN` values of one width) go to the built-in fold as they
  // are.
  const finite = args.every((a) => gpuProvablyFinite(a, target, true));
  if (
    finite &&
    new Set(shapes).size === 1 &&
    (shapes[0] === 'scalar' || typeof shapes[0] === 'number')
  )
    return builtin();
  if (!shapes.every((s) => s === 'scalar' || typeof s === 'number'))
    return builtin();
  const widths = new Set(shapes.filter((s) => typeof s === 'number'));
  if (widths.size > 1) return builtin();
  const width = widths.size === 1 ? ([...widths][0] as number) : undefined;
  const ctor =
    width === undefined ? '' : gpuVecType(width, target.language === 'wgsl');
  const codes = args.map((a, i) =>
    width !== undefined && shapes[i] === 'scalar'
      ? `${ctor}(${compile(a)})`
      : compile(a)
  );
  // A scalar beside a vector is broadcast with the vector constructor, for
  // the helper and for the built-in alike: WGSL has no `max(vecN, f32)` and
  // GLSL no `max(float, vecN)`. When every operand is finite for certain,
  // the built-in `max`/`min` takes the broadcast operands
  // (`max(v, vec3(0.0))`); otherwise the helper keeps the NaN of the
  // interpreter.
  const helper = finite ? name : `_gpu_${name}${width ?? ''}`;
  let acc = codes[0];
  for (let i = 1; i < codes.length; i++) acc = `${helper}(${acc}, ${codes[i]})`;
  return acc;
}

/**
 * The SCALAR component sources of a NON-SCALAR operand, or `undefined` when it
 * has none — what a shader reduction needs in order to consume a collection.
 *
 * Two routes, both derived from the emitted source and from the shape helpers
 * of gpu-shapes.ts, never from a list of head names:
 *
 *  - the operand lowers to an aggregate CONSTRUCTOR (`vec3(1.0, 2.0, 3.0)`,
 *    `float[5](…)`, `array<f32, 5>(…)`) — a `List`/`Tuple`/`Range` literal, and
 *    any other head that builds one. Its top-level arguments ARE the
 *    components when there is one argument per component. A matrix
 *    constructor with fewer arguments declines. A `vecN` constructor with
 *    fewer arguments (the splat `vec3(y)`, the conversion `vec3(u + v)` of a
 *    vector, or `vec3(v, z)`) is read through its swizzles, because the
 *    source does not tell a scalar argument from a vector one: a single
 *    numeric literal is repeated; with only bare identifiers and literals as
 *    arguments, the swizzles of the constructor itself (`vec3(y).x`);
 *    otherwise the swizzles of a hoisted temporary, as in the second route,
 *    or of the constructor itself when no statement can be placed and the
 *    operand is pure. (`assertGPUScalarComponents` guarantees that the
 *    arguments of a `List`/`Tuple` constructor are scalars; an argument that
 *    is itself an aggregate — a `matN`'s `vecN` columns — is refused here
 *    rather than folded into nonsense.)
 *  - the operand has a static `vec2`–`vec4` shape but no constructor to read (a
 *    declared `vector<3>` symbol, an expression over one): reduce over its
 *    swizzles. That repeats the operand's source once per component, so it is
 *    used verbatim only for a BARE identifier; anything compound is bound to a
 *    hoisted temporary first, and where there is no statement sink (inside a
 *    conditional arm — see `compileGPUConditionalArm`) there is no safe reading
 *    and this declines. Repeating a compound source is not merely slow:
 *    `_gpu_rnd_draw` advances a runtime counter, so a repeated draw shifts
 *    every later value in the shader.
 *
 * A matrix, or an array of unknown/runtime length, has no compile-time
 * component list at all, and a shader has no dynamic iteration to fall back on.
 */
export function gpuScalarComponents(
  expr: Expression,
  code: string,
  target: CompileTarget<Expression>
): string[] | undefined {
  const call = gpuTopLevelCall(code);
  // The width and the type of the hoisted temporary of the swizzle route
  // below. When the operand is a vector constructor that is read through its
  // swizzles, they come from the constructor (an `ivec3(…)` is held in an
  // `ivec3`); otherwise the width comes from the shape of the operand and
  // the type is a float vector.
  let width: number | undefined;
  let ctorType: string | undefined;
  if (call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee)) {
    if (call.operands.some((o) => GPU_AGGREGATE_CONSTRUCTOR_ANYWHERE.test(o)))
      return undefined;
    const n = call.operands.length;
    if (n === 0) return undefined;
    // A vector constructor has one operand per component only when it has
    // exactly N operands. With fewer, an operand stands for more than one
    // component: `vec3(y)` is the splat `(y, y, y)`, and `vec3(v, z)` takes
    // two components from the `vec2` `v`. The emitted source does not tell a
    // scalar operand from a vector one, so such a constructor is read through
    // its swizzles below, which is correct for both. The one exception is a
    // splat of a numeric literal, which is a scalar for certain and is
    // repeated as it is. Taking the operands as the components gave the
    // reduction one component where there are N: `Sum` of the second
    // coordinates of `PointList(xs, y)` over three points emitted `y` for
    // `3y` (CE-684).
    const vec = /^([iub]?)vec([234])([fhiu]?)\s*(<[^<>]*>)?$/.exec(
      call.callee.trim()
    );
    if (vec !== null) {
      const size = Number(vec[2]);
      if (n === size) return call.operands;
      if (n > size) return undefined;
      const literal = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
      if (n === 1 && literal.test(call.operands[0].trim()))
        return Array.from({ length: size }, () => call.operands[0]);
      // A constructor whose operands are all bare identifiers or literals
      // has no side effect and costs little, so its swizzles are read from
      // the constructor itself (`vec3(y).x`), with no temporary. That also
      // works where no temporary can be placed (a conditional arm, the body
      // of a `Sum` over an index).
      if (call.operands.every((o) => gpuIsAtomicEmission(o)))
        return ['x', 'y', 'z', 'w']
          .slice(0, size)
          .map((c) => `${code.trim()}.${c}`);
      // With no place for a temporary (no statement sink, or a conditionally
      // evaluated arm, out of which the temporary would run
      // unconditionally), a PURE constructor is read through its own
      // swizzles: its source is repeated once per component, which costs
      // time but gives the right value whether an argument is a scalar or a
      // vector. An impure one declines, because each repetition would make
      // a draw of its own. The test looks through assigned symbol values and
      // user-function bodies (`r := Random()` makes `r + 1` impure there),
      // and it refuses code that the caller supplied (a `vars` string or a
      // head overridden through `functions`), whose effects the compiler
      // cannot see.
      if (!gpuCanPlaceStatement(target) && gpuRepeatableSource(expr, target))
        return ['x', 'y', 'z', 'w']
          .slice(0, size)
          .map((c) => `${code.trim()}.${c}`);
      width = size;
      // A bare WGSL `vecN(…)` infers its element type from the operands; the
      // temporary is then declared without a type and infers the same one.
      ctorType =
        target.language === 'wgsl' && vec[3] === '' && vec[4] === undefined
          ? ''
          : call.callee.trim();
    } else {
      // A matrix constructor has one operand per component only when it has
      // columns × rows operands: `mat3(s)` is the diagonal matrix of `s`,
      // and `mat3(c0, c1, c2)` takes its columns from three vectors.
      const mat = /^mat([234])(?:x([234]))?/.exec(call.callee.trim());
      if (mat !== null) {
        const cols = Number(mat[1]);
        const rows = mat[2] === undefined ? cols : Number(mat[2]);
        if (n !== cols * rows) return undefined;
      }
      return call.operands;
    }
  }
  if (width === undefined) {
    const shape = gpuOperandShape(expr);
    if (typeof shape !== 'number') return undefined;
    width = shape;
  }
  const comps = ['x', 'y', 'z', 'w'].slice(0, width);
  if (/^[A-Za-z_]\w*$/.test(code)) return comps.map((c) => `${code}.${c}`);
  if (!BaseCompiler.canHoist(target)) return undefined;
  const draws = BaseCompiler.foldValueImpure(expr);
  if (draws) gpuAssertBindingKeepsDrawOrder(expr.operator, [expr], target);
  const tv = BaseCompiler.tempVar(target);
  const type =
    ctorType ?? (target.language === 'wgsl' ? `vec${width}f` : `vec${width}`);
  const decl =
    target.language === 'wgsl'
      ? type === ''
        ? `var ${tv}`
        : `var ${tv}: ${type}`
      : `${type} ${tv}`;
  BaseCompiler.hoistStatement(target, `${decl} = ${code};`);
  if (draws) gpuRecordBoundDraws([expr], target);
  return comps.map((c) => `${tv}.${c}`);
}

/**
 * Compile `Max`/`Min` as scalar reductions. Shader `max`/`min` builtins are
 * componentwise, so collection operands must first be expanded into their
 * statically known scalar components. Each operand is compiled once, empty
 * collections contribute no components, and an all-empty reduction yields
 * NaN. `markAggregateConsuming` tells the generic shape gate that the original
 * aggregate shapes are absent from the emitted expression.
 */
export function compileGPUExtremum(
  name: 'max' | 'min',
  head: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${head}\`: needs at least one argument`
    );
  const shapes = args.map(gpuOperandShape);
  // An EMPTY collection contributes nothing to the fold. Recognized BEFORE the
  // operand is compiled: `[]` lowers to `float[0]()` / `array<f32, 0>()`, which
  // `assertGPUScalarComponents` refuses outright, so compiling it first would
  // decline the whole reduction.
  const isEmpty = args.map((a) => a.isCollection && a.count === 0);
  // Each operand is compiled EXACTLY ONCE: a second `compile()` of the same
  // operand would re-advance the `_gpu_rnd_draw` counter.
  const codes = args.map((a, i) => (isEmpty[i] ? '' : compile(a)));
  // Non-scalar by the shape analysis, OR by the emitted source: a `Range` types
  // only as `indexed_collection` (no `list` dimensions), which
  // `gpuOperandShape` reads as a scalar, but it lowers to an array
  // CONSTRUCTOR — and a constructor is exactly what a reduction can consume.
  const isAggregate = codes.map((c, i) => {
    if (isEmpty[i]) return true;
    if (shapes[i] !== 'scalar') return true;
    const call = gpuTopLevelCall(c);
    return call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee);
  });
  // The fold calls the `_gpu_max`/`_gpu_min` helpers, which give NaN for a
  // NaN operand (`gpuNaNSafeLibrary`). Every part is a scalar here: a
  // collection operand contributes its scalar components.
  const fold = (parts: ReadonlyArray<string>): string => {
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++)
      acc = `_gpu_${name}(${acc}, ${parts[i]})`;
    return acc;
  };
  // Every operand a scalar: a left fold of the `_gpu_max`/`_gpu_min` helpers
  // over the operands, with no reduction over components. With ONE operand the fold emits no call at
  // all — the lowering is the operand's own code — so it is parenthesized on
  // the identity-passthrough rule (see `gpuParenthesizeIdentity`): `2·max(x +
  // 1)` emitted `2.0 * x + 1.0`, which is `2x + 1`.
  if (!isAggregate.some((x) => x)) {
    if (codes.length === 1)
      return gpuParenthesizeIdentity(args[0], codes[0], target);
    // Finite operands need no guard (`gpuProvablyFinite`): the built-in.
    if (args.every((a) => gpuProvablyFinite(a, target, true)))
      return codes
        .slice(1)
        .reduce((acc, c) => `${name}(${acc}, ${c})`, codes[0]);
    return fold(codes);
  }

  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (isEmpty[i]) continue;
    if (!isAggregate[i]) {
      parts.push(codes[i]);
      continue;
    }
    const comps = gpuScalarComponents(args[i], codes[i], target);
    if (comps === undefined)
      throw new Error(
        `Could not compile \`${head}\`: the operand \`${args[i].toString()}\` lowers to a shader ` +
          `${gpuShapeName(shapes[i])} with no compile-time component list, so ` +
          `there is nothing for the reduction to fold over — a shader has no ` +
          `dynamic iteration here, and the \`${name}\` builtin is ` +
          `componentwise, not a reduction.`
      );
    parts.push(...comps);
  }
  // Nothing left to fold — every operand was an empty collection. The
  // interpreter and the JavaScript target both answer NaN here (an empty
  // reduction has no extremum), and the shader NaN is reachable for a literal.
  if (parts.length === 0) return `(${gpuNaN(target)})`;
  // Each component of a finite vector is finite: the built-in fold.
  if (args.every((a, i) => isEmpty[i] || gpuProvablyFinite(a, target, true)))
    return `(${parts.slice(1).reduce((acc, c) => `${name}(${acc}, ${c})`, parts[0])})`;
  return `(${fold(parts)})`;
}

/**
 * Lower `GCD`/`LCM` as a left fold of the two-argument preamble helper
 * (`_gpu_gcd`, `_gpu_lcm`) over the scalar components of the operands, the
 * reading of the interpreter and of the javascript target, where a
 * collection operand contributes its elements: `GCD(v)` for a `vector<3>`
 * `v` is `_gpu_gcd(_gpu_gcd(v.x, v.y), v.z)`, and `GCD(v, 4)` folds the 4
 * in as well.
 *
 * A collection operand is read through `gpuScalarComponents`, as by the
 * `Max`/`Min` reduction (`compileGPUExtremum`): a compound vector operand is
 * bound to a temporary first, and an operand with no compile-time component
 * list (a matrix, an array of run-time length) declines. An EMPTY collection
 * contributes nothing. With no component left the value is the identity of
 * the fold (0 for `GCD`, 1 for `LCM`), and with one component it is the
 * absolute value of the component, as in the interpreter (`GCD(-12)` is 12).
 * CE-280.11.
 */
export function compileGPUGcdLcm(
  head: 'GCD' | 'LCM',
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const helper = head === 'GCD' ? '_gpu_gcd' : '_gpu_lcm';
  const parts: string[] = [];
  for (const a of args) {
    if (a === null || a === undefined)
      throw new Error(`Could not compile \`${head}\`: missing argument`);
    // Recognized before the operand is compiled: `[]` lowers to `float[0]()`,
    // which `gpuScalarComponents` would refuse.
    if (a.isCollection && a.count === 0) continue;
    // Each operand is compiled exactly once: a second `compile()` would
    // advance the `_gpu_rnd_draw` counter again.
    const code = compile(a);
    const call = gpuTopLevelCall(code);
    const aggregate =
      gpuOperandShape(a) !== 'scalar' ||
      (call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee));
    if (!aggregate) {
      parts.push(code);
      continue;
    }
    const comps = gpuScalarComponents(a, code, target);
    if (comps === undefined)
      throw new Error(
        `Could not compile \`${head}\`: the operand \`${a.toString()}\` lowers to a shader ` +
          `${gpuShapeName(gpuOperandShape(a))} with no compile-time component ` +
          `list, so there is nothing for the fold to run over.`
      );
    parts.push(...comps);
  }
  if (parts.length === 0)
    return formatFloat(head === 'GCD' ? 0 : 1, target.language);
  if (parts.length === 1) return `abs(${parts[0]})`;
  let acc = parts[0];
  for (let i = 1; i < parts.length; i++) acc = `${helper}(${acc}, ${parts[i]})`;
  return acc;
}
