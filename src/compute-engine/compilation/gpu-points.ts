// Point and point-list operands: projection, swizzle and Last.

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { gpuNonFiniteLiteral } from './constant-folding.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { isSubtype } from '../../common/type/subtype.js';
import { MAX_POINT_CALL_INLINES } from './point-value-inlining.js';
import { gpuIsAtomicEmission, gpuType } from './gpu-emit.js';
import { gpuPointOrPointListUnion } from './gpu-declared-types.js';

/**
 * True when a `PointList` component is a *source* — a zip participant rather
 * than a per-point scalar slot: an `indexed_collection` type that is neither a
 * tuple nor a union. THE shared source predicate on the compile route, the same
 * one the JavaScript zip lowering uses. Kept local (not imported) for the
 * module-init reordering hazard.
 *
 * DELIBERATE DIVERGENCE from the `PointList` TYPE handler's `isListType`
 * (`library/collections.ts`): that predicate reads a bare `tuple` and a union
 * whose members all match `indexed_collection` (`list<number> |
 * tuple<number, number>`) as sources. Narrowing it there is
 * interpreter-visible, so the compile route narrows on its own: both shapes are
 * declined here (their per-point value is not statically known), matching the
 * spec's Shared-predicate table.
 */
export function isPointListSource(e: Expression): boolean {
  const t = gpuType(e);
  // `'tuple'` (the bare, unparameterized name) is a plain string, not a
  // `{ kind: 'tuple' }` node — both spellings are a single point.
  if (t === 'tuple') return false;
  if (typeof t !== 'string' && (t.kind === 'tuple' || t.kind === 'union'))
    return false;
  return e.type.matches('indexed_collection<any>');
}

/**
 * Project one coordinate of a symbolic `PointList` as a `vecN`. Shader targets
 * cannot represent a runtime-length point list as an expression, but a
 * projection with a statically known width is an ordinary vector.
 *
 * Returns the emitted code or a specific decline reason. Every admissibility
 * condition must hold:
 * - the coordinate index is within the point arity (`PointZ` on a 2-arity
 *   `PointList` stays declined);
 * - at least one component is a source, and EVERY source has a statically
 *   known vec-emittable length 2–4 (a literal `List`, or a declared
 *   `vector<N>`); an unknown length would be asserting a shape we do not know;
 * - every non-source slot is provably scalar numeric (`vecW(<aggregate>)` is
 *   invalid or wrong);
 * - every NON-SELECTED component is pure — projection never evaluates them,
 *   and discarding an effectful operand (`Random()`) would break the
 *   evaluate-once contract.
 *
 * The emitted width is the shortest source length (statically evaluated
 * shortest-zip); a longer source is swizzle-truncated (`(v).xy`), a scalar slot
 * broadcasts as `vecW(slot)` (`vecWf` on WGSL).
 */
function compilePointListProjection(
  arg: Expression,
  k: number,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | { decline: string } {
  if (!isFunction(arg, 'PointList'))
    return {
      decline:
        `the operand is not a symbolic \`PointList\` application, and only ` +
        `that shape has a statically known point count`,
    };
  const ops = arg.ops;
  if (k >= ops.length)
    return {
      decline:
        `the points have arity ${ops.length}, so there is no coordinate ` +
        `${k + 1}`,
    };

  let width: number | undefined = undefined;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (isPointListSource(op)) {
      const n = BaseCompiler.aggregateComponentCount(op);
      // Unknown length, or a length with no `vecN`: decline.
      if (n === undefined)
        return {
          decline:
            `source component ${i + 1} (type \`${op.type.toString()}\`) has ` +
            `no statically known length, and a shader vector must have one`,
        };
      if (n < 2 || n > 4)
        return {
          decline:
            `source component ${i + 1} has ${n} elements, and a shader ` +
            `vector holds 2 to 4`,
        };
      width = width === undefined ? n : Math.min(width, n);
    } else if (!isSubtype(gpuType(op), 'number')) {
      // A non-source slot must be provably scalar numeric.
      return {
        decline:
          `component ${i + 1} (type \`${op.type.toString()}\`) is neither a ` +
          `list source nor a provably scalar numeric slot, so it has no ` +
          `\`vecN\` broadcast`,
      };
    }
  }
  if (width === undefined)
    return {
      decline: 'no component is a list source, so this is not a point LIST',
    };

  // Every discarded component must be pure: the projection never evaluates it.
  for (let i = 0; i < ops.length; i++)
    if (i !== k && !ops[i].isPure)
      return {
        decline:
          `component ${i + 1} is impure, and the projection would discard it ` +
          `unevaluated`,
      };

  const slot = ops[k];
  if (!isPointListSource(slot)) {
    const ctor = target.language === 'wgsl' ? `vec${width}f` : `vec${width}`;
    return `${ctor}(${compile(slot)})`;
  }
  const n = BaseCompiler.aggregateComponentCount(slot)!;
  const code = compile(slot);
  if (n === width) return code;
  // Swizzle-truncate to the shortest source. A bare identifier takes the
  // suffix directly (`v.xy`), which keeps the emission ATOMIC for the shape
  // gate; anything else is parenthesized and is judged as the compound
  // emission it is.
  const sw = 'xyzw'.slice(0, width);
  return gpuIsAtomicEmission(code) ? `${code}.${sw}` : `(${code}).${sw}`;
}

/**
 * Compile `Last` as a GPU swizzle. Unlike `First`/`Second`/`Third`, whose
 * component is fixed, the component of `Last` depends on the width of the
 * operand, so the width must be known statically: a `tuple` of 2 to 4 scalar
 * numbers, or a list of 2 to 4 scalar numbers (the two spellings that lower
 * to a `vec2`/`vec3`/`vec4`). The last component of a `vecN` is `.y`, `.z`
 * or `.w`.
 *
 * An absent operand (`Missing`, `Undefined`) compiles to the SCALAR NaN of
 * the target and has no static width. Every component of an absent value is
 * NaN, so its last component is that NaN, as `First` of an absent operand is
 * (see `gpuSwizzle`). Any other operand has no GPU lowering: a longer list
 * compiles to an array, not a vector, and has no swizzle.
 */
export function compileGpuLast(
  arg: Expression,
  compile: (e: Expression) => string
): string {
  const code = compile(arg).trim();
  if (code === gpuNonFiniteLiteral(NaN)) return code;
  const t = gpuType(arg);
  const width =
    typeof t !== 'string'
      ? t.kind === 'tuple'
        ? t.elements.every((el) => isSubtype(el.type, 'number'))
          ? t.elements.length
          : undefined
        : t.kind === 'list' &&
            t.dimensions?.length === 1 &&
            t.elements !== undefined &&
            isSubtype(t.elements, 'number')
          ? t.dimensions[0]
          : undefined
      : undefined;
  if (width !== undefined && width >= 2 && width <= 4)
    return gpuSwizzle(code, 'xyzw'[width - 1]);
  throw new Error(
    'Could not compile `Last`: the operand must be a point or a list of 2 to 4 ' +
      'numbers of known length (a `vec2`/`vec3`/`vec4`).'
  );
}

/**
 * The error of a shader compilation when `inlinePointCalls()` would
 * substitute more than `MAX_POINT_CALL_INLINES` function bodies. A call of
 * `head` left as written has the type of `call`, a union that has no shader
 * type, so the compilation would fail on it anyway.
 */
export function gpuPointCallsOverBudget(head: string, call: Expression): Error {
  return new Error(
    `Could not compile \`${head}\`: its value has the type ` +
      `\`${call.type.toString()}\`, which has no shader type, and the ` +
      `calls of the functions that give such a value would be written ` +
      `out more than ${MAX_POINT_CALL_INLINES} times. If the value ` +
      `reads a symbol that can be a point or a list of points, declare ` +
      `that symbol with the point type (\`tuple<real, real>\`).`
  );
}

/**
 * The declaration of `name` as a point of `arity` real numbers, to name in
 * a decline: `ce.declare('P', 'tuple<real, real>')`. With no single arity,
 * the declaration of a 2-D point.
 */
export function gpuPointDeclaration(
  name: string,
  arity: number | undefined
): string {
  const n = arity !== undefined && arity >= 2 && arity <= 4 ? arity : 2;
  return `ce.declare('${name}', 'tuple<${Array(n).fill('real').join(', ')}>')`;
}

/**
 * The decline of the operator `head` over the symbol `name`, whose type
 * admits a point and a list of points (`gpuPointOrPointListUnion`), when
 * the shader reads the symbol as an input. When `bound` is true (a
 * parameter, an index or a local of the compiled code), the symbol has no
 * assigned value that the shader can use, so only the declaration is named.
 */
export function gpuPointOrPointListRefusal(
  head: string,
  name: string,
  e: Expression,
  union: { arity: number | undefined },
  bound = false
): string {
  const declaration = gpuPointDeclaration(name, union.arity);
  return (
    `Could not compile \`${head}\`: "${name}" has the type ` +
    `\`${e.type.toString()}\`, which admits a point and a list of points. ` +
    `A shader value cannot be both: a point is a vector (\`vec2\`, ` +
    `\`vec3\`, \`vec4\`) and a list of points is an array. ` +
    (bound
      ? `Declare "${name}" as a point (\`${declaration}\`).`
      : `Declare "${name}" as a point (\`${declaration}\`), or assign a ` +
        `point to "${name}" and do not map it with \`vars\`, so that the ` +
        `shader uses its value.`)
  );
}

/**
 * True when the compiled code binds the name `s` where `target` compiles:
 * a parameter, an index or a local, which a binder of the compiled code
 * resolves (`boundVars`, or a `var` hook that answers for a name that no
 * `vars` entry maps).
 */
function gpuSymbolIsBound(
  s: string,
  target: CompileTarget<Expression>
): boolean {
  if (target.boundVars?.has(s) === true) return true;
  return target.varsKeys?.has(s) !== true && target.var(s) !== undefined;
}

/**
 * Compile a point-coordinate accessor (`PointX`/`PointY`/`PointZ`) as a GPU
 * swizzle. A single point is a `vec2`/`vec3`/`vec4`, so `.x`/`.y`/`.z` is
 * valid. A *list* of points is not a GPU value — a swizzle on it is invalid
 * shader source, so a list-of-points operand fails closed rather than
 * silently emitting garbage; the one exception is a symbolic `PointList`
 * application, whose coordinate IS a `vecN` (`compilePointListProjection`). A
 * tuple type also matches `indexed_collection`, so the single-point case is
 * checked first.
 */
export function compilePointSwizzle(
  arg: Expression,
  comp: 'x' | 'y' | 'z',
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const idx = comp === 'x' ? 0 : comp === 'y' ? 1 : 2;
  const head = `Point${comp.toUpperCase()}`;
  // A symbol whose type admits a point and a list of points. The compile
  // entries write its point value in place of it where the shader computes
  // the value (`inlinePointValues`), so a symbol of this type that
  // reaches here is read as an input, or is bound by the compiled code. A
  // bound local whose assignments give it a vector width (`a ≔ x·P`, a
  // `vec2` local) has that width, and its coordinate is a swizzle. Any
  // other such symbol has no shader type.
  const union = isSymbol(arg)
    ? gpuPointOrPointListUnion(arg.type.type)
    : undefined;
  if (union !== undefined && isSymbol(arg)) {
    const bound = gpuSymbolIsBound(arg.symbol, target);
    const width = BaseCompiler.localShapeFrameOf(arg.symbol)?.get(arg.symbol);
    if (bound && width !== undefined && width >= 2 && width <= 4) {
      if (width <= idx)
        throw new Error(
          `Could not compile \`${head}\`: the point has arity ${width} ` +
            `— no ${['first', 'second', 'third'][idx]} coordinate.`
        );
      return gpuSwizzle(compile(arg), comp);
    }
    throw new Error(
      gpuPointOrPointListRefusal(head, arg.symbol, arg, union, bound)
    );
  }
  // Any other value of that type: a call of a user function whose body is
  // not a point once the point values are in place (it reads a list of
  // points, `h(t) := t·Q` with `Q := [(1, 2), (3, 4)]`), or a value that the
  // compile entries did not rewrite.
  if (!isSymbol(arg) && gpuPointOrPointListUnion(arg.type.type) !== undefined)
    throw new Error(
      `Could not compile \`${head}\`: \`${arg.toString()}\` has the type ` +
        `\`${arg.type.toString()}\`, which admits a point and a list of ` +
        `points. A shader value cannot be both: a point is a vector ` +
        `(\`vec2\`, \`vec3\`, \`vec4\`) and a list of points is an array. ` +
        `Make the value a point (a tuple such as \`tuple<real, real>\`).`
    );
  const t = gpuType(arg);
  // The two spellings of a SINGLE point, each stating its own arity: a tuple,
  // and the flat numeric list a data import produces. `[3, 4]` lowers to
  // `vec2(3.0, 4.0)` here — a genuine `vecN`, so `.x` is a valid swizzle on it
  // — and the interpreter likewise reads such a list as one point rather than
  // a list of points (`PointX([3,4])` is `3`). Treating every indexed
  // collection as a point LIST declined it, so the flat spelling could not
  // reach a shader while the tuple spelling compiled.
  //
  // Width is bounded at 4 and the elements must be scalar numbers: a longer or
  // nested list is an array or a matrix, which has no swizzle.
  const pointArity =
    typeof t !== 'string'
      ? t.kind === 'tuple'
        ? t.elements.length
        : t.kind === 'list' &&
            t.dimensions?.length === 1 &&
            t.dimensions[0] >= 2 &&
            t.dimensions[0] <= 4 &&
            t.elements !== undefined &&
            isSubtype(t.elements, 'number')
          ? t.dimensions[0]
          : undefined
      : undefined;

  if (pointArity === undefined && arg.type.matches('indexed_collection<any>')) {
    const projected = compilePointListProjection(arg, idx, compile, target);
    if (typeof projected === 'string') return projected;
    throw new Error(
      `Could not compile \`Point${comp.toUpperCase()}\`: a list of points has no GPU lowering ` +
        `(a point must be a single vec2/vec3/vec4): ${projected.decline}.`
    );
  }
  // A stated point arity makes an out-of-range coordinate a static error:
  // `p.z` on a `vec2` is invalid shader source. Symmetric with the list
  // route's arity decline in `compilePointListProjection`. An unparameterized
  // `tuple` states no arity and keeps the emission.
  if (pointArity !== undefined && pointArity <= idx)
    throw new Error(
      `Could not compile \`Point${comp.toUpperCase()}\`: the point has arity ${pointArity} ` +
        `— no ${['first', 'second', 'third'][idx]} coordinate.`
    );
  return gpuSwizzle(compile(arg), comp);
}

/**
 * Append the swizzle `sw` to the emission `code` so that it selects from the
 * WHOLE value. A postfix swizzle binds tighter than every infix and prefix
 * operator, so a single primary — an identifier, a literal, or ONE function
 * call whose parentheses close at the end (`vec2(x, y)`) — takes the suffix
 * directly, and anything else is parenthesized first. Splicing the suffix
 * onto an infix emission bound it to the LAST term alone:
 * `PointX((x, y) + (1, 2))` emitted `vec2(x, y) + vec2(1.0, 2.0).x`, legal
 * shader source (a float broadcasts into a `vec2`) that computes
 * `(x + 1, y + 1)` behind `success: true` (Tycho item 242).
 */
export function gpuSwizzle(code: string, sw: string): string {
  const s = code.trim();
  // An absent operand (`Missing`, `Undefined`) compiles to the SCALAR NaN of
  // the target (`_gpu_nan()`, on both targets). A scalar has no components:
  // WGSL rejects `.x` on an `f32`, and GLSL before 4.20 rejects it on a
  // `float`. Every coordinate of an absent point is NaN, so one component of
  // that NaN is the NaN itself, and several components are a vector of it.
  // `vecN(x)` is a splat in both languages (WGSL infers the element type).
  if (s === gpuNonFiniteLiteral(NaN)) {
    if (sw.length === 1) return s;
    return `vec${sw.length}(${s})`;
  }
  if (gpuIsAtomicEmission(s)) return `${s}.${sw}`;
  const call = /^[A-Za-z_]\w*\(/.exec(s);
  if (call !== null && s.endsWith(')')) {
    // One call is a primary only when the parenthesis opened by its name is
    // the one closed by the final character: `f(a) + g(b)` also starts with
    // a call and ends with `)`.
    let depth = 0;
    let single = true;
    for (let i = call[0].length - 1; i < s.length; i++) {
      if (s[i] === '(') depth += 1;
      else if (s[i] === ')') {
        depth -= 1;
        if (depth === 0 && i !== s.length - 1) {
          single = false;
          break;
        }
      }
    }
    if (single) return `${s}.${sw}`;
  }
  return `(${s}).${sw}`;
}
