// Operand shapes (scalar, vector, matrix, aggregate), the shape rules of the
// built-ins, the operand shape check, the complex-result tests, the real-only
// lowering table, and the trig and pi-multiple offset folds that the shape
// check uses.

import type { Expression } from '../global-types.js';
import { isCallerMapped } from './cse.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { BigDecimal } from '../../big-decimal/index.js';
import {
  gpuBigValue,
  gpuExactConstant,
  gpuWithExactConstant,
} from './gpu-exact-trig.js';
import {
  assertScalarComplexOperand,
  formatFloat,
  principalComplexPow,
} from './constant-folding.js';
import type { CompileTarget, CompiledFunction } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { complexContinuation } from './complex-continuation.js';
import {
  finitePartOfType,
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import { typeToString } from '../../common/type/serialize.js';
import {
  gpuFVec,
  gpuNaN,
  gpuType,
  gpuVec2,
  gpuVecType,
} from './gpu-emit.js';
import {
  GPU_SCALAR_ARITHMETIC,
  GPU_SCALAR_PREDICATES,
  gpuColorSymbolReads,
  gpuDeclaredIsIntegerScalar,
  gpuDeclaredTypeOf,
  gpuMatrixOrArraySpelling,
  gpuPointListArity,
  gpuTypeOfValue,
} from './gpu-declared-types.js';
import type { GPUValueType } from './gpu-declared-types.js';
import { fragmentReplaceOperands } from './fragment.js';
import type { FragmentLoweringContract } from './fragment.js';

/**
 * The principal complex power of two real constants, as a shader `vec2(re, im)`
 * literal — the fold for a `Power`/`Root` node whose TYPE is complex (a
 * negative base whose reduced-rational exponent has an even denominator).
 *
 * `Complex.pow` is the routine `_gpu_cpow`'s host-side counterpart and the
 * interpreter both use, so the folded constant is the value the uncompiled
 * expression produces (down to shader float precision).
 */
export function gpuComplexPowLiteral(
  base: number,
  exp: number,
  target?: CompileTarget<Expression>
): string {
  const r = principalComplexPow(base, exp);
  return `${gpuVec2()}(${formatFloat(r.re, target?.language)}, ${formatFloat(
    r.im,
    target?.language
  )})`;
}

/** A direct sRGB constructor can skip its perceptual-space round trip: the
 * conversions keep extended sRGB channels and do no gamut mapping, so the
 * round trip of a finite triple is the identity (`_gpu_srgb_roundtrip`).
 * Compile the child normally first so alpha, operand-shape, and caller-mapping
 * checks still govern its lowering. */
export function gpuRgbBoundary(
  color: Expression,
  code: string,
  target: CompileTarget<Expression>
): string {
  if (
    isFunction(color) &&
    ['Rgb', 'Hsv', 'Hsl', 'Tuple'].includes(color.operator) &&
    !isCallerMapped(color, target.cse?.harvestOptions) &&
    !target.foldExcludedOps?.has(color.operator)
  ) {
    const prefix = '_gpu_srgb_to_oklch(';
    if (code.startsWith(prefix) && code.endsWith(')'))
      return `_gpu_srgb_roundtrip(${code.slice(prefix.length, -1)})`;
  }
  return `_gpu_oklch_to_srgb(${code})`;
}

/**
 * Whether applying `head` to `args` produces a complex value — the SAME signal
 * `BaseCompiler.isComplexValued` reports to the ENCLOSING expression for this
 * node.
 *
 * A handler that picks its real-vs-complex lowering from the ARGUMENT alone can
 * disagree with its own parent. With `a := -2`, `Sqrt(a)` is typed `complex`
 * (the type handler reads the assigned value's sign) while the operand `a` is
 * typed `integer`: the parent emits the `vec2(re, im)` convention around a
 * scalar `sqrt(-2.0)`, and shader scalar-broadcast makes that a silent
 * `vec2(NaN, NaN)` rather than a compile error.
 *
 * The node is rebuilt STRUCTURALLY (bound, not canonicalized) so its head and
 * operands are the ones being lowered, and its type is therefore the type the
 * parent read. A wide result type (`number`, as `Power`/`Root`/`Arcsin` have)
 * is NOT complex — those project to NaN, matching their real lowering.
 *
 * FOUR SITES MUST STAY IN AGREEMENT, because they answer the same question
 * for the same node and a disagreement is a silent value-shape mismatch (a
 * `vec2`/`{re, im}` consumer reading a scalar, or the reverse):
 * `BaseCompiler.isComplexValued` (base-compiler.ts) is what a PARENT consults,
 * `resultIsComplexValued` (javascript-target.ts) is the JavaScript emitters'
 * copy, this function is the GPU emitters' copy, and
 * `resultIsWideUnderComplexDiscipline` (javascript-target.ts) is the
 * JavaScript copy of the wide-type rule (`BaseCompiler.wideIsComplex`).
 * Change one, change all four.
 */
export function gpuResultIsComplexValued(
  head: string,
  args: ReadonlyArray<Expression>
): boolean {
  const engine = args[0]?.engine;
  if (engine === undefined) return false;
  try {
    const t = engine.function(head, [...args], { form: 'structural' }).type;
    // The infinite and NaN branches are dropped first, exactly as the two
    // sites named above do: a head whose value can blow up at a pole claims a
    // union such as `complex | +oo | -oo` (`Artanh`, `Arcoth`,
    // `Arsech`, `Ln`, `Log`), and only its FINITE part decides the lane.
    // Asking `isNonRealNumber` of the whole union answers false and takes the
    // scalar lane while the parent takes the complex one.
    return isNonRealNumber(finitePartOfType(t.type));
  } catch {
    return false;
  }
}

/**
 * Decline a special function whose value is provably not real: the shader
 * helper is real-only (`NaN` there), and there is no complex kernel to
 * lower to (`complexContinuation`).
 */
export function declineComplexContinuation(
  head: string,
  args: ReadonlyArray<Expression>
): void {
  if (complexContinuation(head, args) === 'complex')
    throw new Error(
      `Could not compile \`${head}\`: its value is not real for these operands, and the shader targets have no complex lane for it`
    );
}

/**
 * An operand as `vec2(re, im)` source, lifting a real-emitted operand to
 * `vec2(x, 0.0)`. The `_gpu_c…` helpers take a `vec2`; handing one a scalar is
 * not valid shader source.
 */
export function gpuComplexOperand(
  x: Expression,
  compile: (expr: Expression) => string
): string {
  if (BaseCompiler.isComplexValued(x)) return compile(x);
  assertScalarComplexOperand(undefined, x);
  return `${gpuVec2()}(${compile(x)}, 0.0)`;
}

/**
 * Are the ELEMENTS of a fixed-length aggregate shader floats?
 *
 * `BaseCompiler.vectorComponentCount` reads a width off the OUTER dimension of
 * a 1-axis `list` type (or a tuple's slot count) and says nothing about what
 * the elements are. On a shader target that is only half the question: a
 * `vecN` holds N single floats, so a 3-element list of complex values is three
 * `vec2` cells and a 3-element list of 2-element lists is a 3×2 block — neither
 * has a `vec3` reading, or any shader value shape at all. Without this check
 * the width flowed on and a symbol typed `list<complex^3>` emitted `sin(c)`,
 * `c + c` and `length(c)`, and one typed `list<boolean^3>` emitted
 * `max(max(b.x, b.y), b.z)` — source no shader compiler accepts, behind a
 * reported success. (The `At` lowering asks the same question of its base in
 * `gpuAtNonScalarElement`; this is that guard on the shape reading itself, so
 * every consumer of a width gets it.)
 *
 * Answers `true` — leaving the width alone — for the three shapes whose
 * elements this type reading does not decide:
 *
 *  - a `List`/`Tuple` LITERAL, whose components are checked where the
 *    constructor is emitted (`assertGPUScalarComponents`) and whose operands
 *    routinely carry no element type of their own (a parametric body
 *    `(x(t), y(t))`);
 *  - a COMPLEX value, which is `vec2(re, im)` by the complex convention rather
 *    than a two-element collection;
 *  - a `Block` local, whose boxed type is `unknown` and whose width was
 *    inferred from the value bound to it — components that are already shader
 *    floats.
 *
 * A CALLER-declared name (a `compileFunction` parameter, a `compileShader`
 * `in`/`uniform`) is the one framed case that must still be asked: the frame
 * stores only a WIDTH, so `bvec3`, `ivec3` and `uvec3` are entered as a plain
 * 3 and are indistinguishable there from a `vec3`. The declared SPELLING is
 * the only place their element kind survives, so it is read back here
 * (`gpuDeclaredTypeOf`) — the same question `gpuAtFramedBaseElements` asks of
 * an indexed base.
 *
 * An element declines only when it is PROVABLY not a shader float, which is
 * the same standard the `At` index gate (`compileGPUAt` in gpu-functions.ts)
 * already applies to its own operand. The WIDE types — `unknown`, `any`,
 * `value`, `expression` — are admitted, by the unknown-as-numeric-parameter rule: a component whose type
 * is merely unresolved is a float here, and rejecting it would decline shapes
 * that have always compiled. `value` is the one that matters in practice: a
 * `PointList` component that is itself a computed expression types `value`,
 * and reading that as a non-float declined `Dot` over a point list — a shape
 * with a correct `dot(vec2(…))` lowering.
 *
 * A COMPLEX element is rejected even though it could match `number`: it
 * occupies a `vec2` of (re, im) by the complex convention, so a list of them
 * is not a vector of float cells.
 */
function gpuElementIsShaderFloat(t: Type): boolean {
  // A nominal type or alias answers layout questions as its DEFINITION —
  // compilation is type erasure. Without this a `list<meters^3>` over a
  // nominal `meters = real` was rejected: a nominal type deliberately does not
  // subtype its definition, so `couldMatch` answers `false` for it and the
  // list lost the `vec3` reading it has always had.
  t = resolveTypeForCompilation(t);
  // Complex is asked FIRST, because it satisfies `couldMatch(_, 'number')`
  // while being a two-cell `vec2` of (re, im) here rather than a float.
  //
  // The infinite branches are dropped before that question is put. A head such
  // as `Ln`, `Log`, `Artanh`, `Arcoth` or `Arsech` returns `complex | +oo |
  // -oo`, and `isNonRealNumber` of that whole union answers `false` — the
  // infinite members are not subtypes of `complex`, so the union is not one
  // either. Execution then reached `couldMatch`, which answers `true` because
  // the `complex` member alone overlaps `number`, and a genuinely
  // complex-valued element was admitted into a vector of float cells. That is
  // the same fail-open this gate exists to close, reached through a computed
  // union instead of a written `complex`. `finitePartOfType` reduces the union
  // to `complex`, of which `isNonRealNumber` answers `true`.
  if (isNonRealNumber(finitePartOfType(t))) return false;
  return couldMatch(t, 'number');
}

/**
 * A decline reason when the tuple type `t` has no shader type, or
 * `undefined` when `t` is not a tuple or a shader type holds it.
 *
 * A shader reads a tuple of 2 or more shader floats (`gpuElementIsShaderFloat`,
 * which also admits the wide types `unknown`, `any`, `value` and
 * `expression`): as a `vecN` for 2 to 4 elements, and as an array of floats
 * for more. A tuple of 2 to 4 booleans is a boolean vector (`bvec2`,
 * `vec2<bool>`), which a host can declare: `If(First(b), 1, 0)` with a
 * uniform `bvec2 b` compiles to `float(b.x)`. Each other tuple has no shader
 * type:
 * - an element that is not a shader float: a nested tuple
 *   (`tuple<tuple<real, real>, tuple<real, real>>`, a pair of points), a
 *   mixed tuple (`tuple<real, tuple<real, real>>`), a `complex` element, or
 *   a `boolean` element in a tuple that is not a boolean vector;
 * - fewer than 2 elements (there is no `vec1`);
 * - the bare `tuple` type, which admits any elements.
 * A free symbol of such a type was emitted as a bare identifier, which the
 * host cannot declare, and a swizzle read of it gave a value that is not the
 * interpreter's (`First(T)` was `T.x`).
 */
export function gpuTupleWithoutShaderType(t: Type): string | undefined {
  const resolved = resolveTypeForCompilation(t);
  if (resolved === 'tuple')
    return `this type does not give the number or the types of the elements`;
  if (typeof resolved === 'string' || resolved.kind !== 'tuple')
    return undefined;
  const m = resolved.elements.length;
  if (m < 2)
    return (
      `a tuple of ${m} element${m === 1 ? '' : 's'} has no shader type ` +
      `(there is no \`vec1\`)`
    );
  if (m <= 4 && resolved.elements.every((el) => isSubtype(el.type, 'boolean')))
    return undefined;
  for (let i = 0; i < m; i++)
    if (!gpuElementIsShaderFloat(resolved.elements[i].type))
      return (
        `element ${i + 1} of the tuple (type ` +
        `\`${typeToString(resolved.elements[i].type)}\`) is not a real ` +
        `scalar — a shader vector or array of floats holds only real scalars`
      );
  return undefined;
}

/**
 * See `gpuElementIsShaderFloat` for the element test this applies.
 */
function gpuHasShaderScalarElements(expr: Expression): boolean {
  // A written list or tuple is a vector only when its elements are scalars:
  // a list of points lowers as an ARRAY of vectors (`gpuUniformVectorWidth`),
  // which no `vecN` consumer may read as a vector of its element count.
  if (isFunction(expr, 'List') || isFunction(expr, 'Tuple'))
    return expr.ops.every((op) => !BaseCompiler.isNonScalarShape(op));
  if (BaseCompiler.isComplexValued(expr)) return true;
  if (
    isSymbol(expr) &&
    BaseCompiler.localShapeFrameOf(expr.symbol) !== undefined
  ) {
    const declared = gpuDeclaredTypeOf(expr);
    // No declared type alongside the frame entry is the `Block`-local case:
    // the width came from a bound value whose components are shader floats.
    return declared?.value === undefined || declared.value.element === 'f';
  }
  // The absent arms of a value that may be absent (`missing | tuple<real,
  // real>`) are set aside, as `aggregateComponentCount` sets them aside when
  // it reads the width.
  const t = BaseCompiler.withoutAbsentArms(gpuType(expr));
  if (typeof t === 'string') return true;
  // Reached only with a `tuple` or 1-axis `list` type — the two type shapes
  // `aggregateComponentCount` reads a width from once the sources above are
  // excluded.
  //
  // Asked directly rather than through `gpuDeclaredComponentCount`, whose
  // element test (`gpuIsVectorComponentType`) answers "does this LOWER to the
  // shader scalar", a stricter question than the one owed here. That test
  // rejects every wide type but `unknown` and `any`, so routing through it
  // declined a `value`-typed component — the type a computed `PointList`
  // component carries.
  if (t.kind === 'tuple')
    return t.elements.every((e) => gpuElementIsShaderFloat(e.type));
  if (t.kind === 'list' && t.dimensions?.length === 1)
    return gpuElementIsShaderFloat(t.elements);
  // Every other shape fails CLOSED, which is also what the previous reading
  // (`gpuDeclaredComponentCount(t) !== undefined`) answered for it. Today the
  // only caller has already established a component width, and the two type
  // shapes above are the only ones a width is read from, so nothing reaches
  // this line. Answering `true` here would make a multi-axis list or a
  // tensor-typed element pass for a shader float the moment that stops being
  // so — the fail-open this gate exists to prevent.
  return false;
}

/**
 * Number of vector components a value expression occupies on the GPU (2–4),
 * or `undefined` for a scalar. Structural for `Tuple`/`List` literals (the
 * parametric-body shape `(x(t), y(t))` → `vec2`), type-based for typed
 * operands (`tuple<…>`, a 1-axis `list`), and 2 for a complex value (lowered
 * as `vec2(re, im)`).
 *
 * THE width reading of this target: a type-sourced width whose elements are
 * not shader floats has no `vecN` lowering and answers `undefined` here
 * (`gpuHasShaderScalarElements`), so every consumer treats it as the
 * shapeless value it is instead of emitting `vecN` source for it.
 */
export function gpuComponentCount(
  expr: Expression | null
): 2 | 3 | 4 | undefined {
  const n = BaseCompiler.vectorComponentCount(expr);
  if (n === undefined) return undefined;
  return gpuHasShaderScalarElements(expr!) ? n : undefined;
}

/**
 * The component count every element of a `List` literal shares when EVERY
 * element is a vector value of one width between 2 and 4 — a list of points
 * of the same arity, which lowers as a fixed-size array of `vecK`
 * (`vec3[N](…)`) — or `undefined` when the elements
 * are scalars, of mixed widths, or not vectors at all.
 */
export function gpuUniformVectorWidth(
  args: ReadonlyArray<Expression>
): number | undefined {
  if (args.length === 0) return undefined;
  let width: number | undefined;
  for (const arg of args) {
    if (!BaseCompiler.isNonScalarShape(arg)) return undefined;
    const n = BaseCompiler.aggregateComponentCount(arg);
    if (n === undefined || n < 2 || n > 4) return undefined;
    if (width !== undefined && n !== width) return undefined;
    width = n;
  }
  return width;
}

/**
 * Guard the `vecN(…)` lowering of a `Tuple`/`List` literal: every element must
 * be a SCALAR, so the constructor's argument count is its component count.
 *
 * A vector-valued element (a complex component — lowered as `vec2(re, im)` —
 * or a nested tuple) contributes 2+ components, so `(t, i·t)` would emit
 * `vec2(t, vec2(0.0, t))`: three components into a two-component constructor,
 * which a driver rejects with "constructor: too many arguments". Neither is
 * there a correct flattening — a tuple whose element is complex is not a GPU
 * vector — so fail closed with a diagnostic naming the shape instead of
 * emitting shader source that cannot compile.
 *
 * The check is on AGGREGATE-ness, not on having a `vecN` lowering: a 1- or
 * 5-element list element (`(⟦1⟧, 2)` → `vec2(float[1](1.0), 2.0)`) is just as
 * invalid, and asking `gpuComponentCount` — which reports `undefined` for
 * those widths — would wave them through. It is on being provably NON-SCALAR,
 * not on having a component count: a `Matrix` element has no single count, but
 * `(mat2(…), 1)` → `vec2(mat2(…), 1.0)` is exactly as unacceptable to a driver.
 *
 * Also rejects the EMPTY constructor: an empty tuple/list would lower to
 * `float[0]()`, and GLSL has no zero-length array type.
 */
export function assertGPUScalarComponents(
  args: ReadonlyArray<Expression>,
  ctor: string
): void {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${ctor}\`: an empty tuple/list has no GPU lowering — GLSL has ` +
        `no zero-length array type.`
    );
  for (const [i, arg] of args.entries()) {
    if (!BaseCompiler.isNonScalarShape(arg)) continue;
    const n = BaseCompiler.aggregateComponentCount(arg);
    const shape =
      n === undefined
        ? 'a matrix/tensor value'
        : `${n} component${n === 1 ? '' : 's'} — a complex value or a ` +
          `nested tuple/list`;
    throw new Error(
      `Could not compile \`${ctor}\`: element ${i + 1} (\`${arg.toString()}\`) is itself ` +
        `vector-valued (${shape}) and has no GPU ` +
        `lowering; a ${ctor} constructor takes scalar components.`
    );
  }
}

/**
 * A NaN matching the SHAPE of `val`: scalar NaN for a scalar value, a
 * broadcast vector constructor (`vec2(_gpu_nan())`)
 * for a vector-valued one. GLSL has no implicit float→vecN conversion in a
 * ternary, so a masked (restriction or `Which` else) branch whose value is a tuple
 * body (a restricted parametric `(x(t), y(t))`) must emit a NaN of the same
 * component count or the driver rejects the shader (Tycho item 49).
 */
export function gpuNaNFor(
  val: Expression | null,
  target?: CompileTarget<Expression>
): string {
  const n = gpuComponentCount(val);
  if (n === undefined) return gpuNaN(target);
  const ctor = `vec${n}`;
  return `${ctor}(${gpuNaN(target)})`;
}

/**
 * Why an emitted scalar lowering canNOT be reused verbatim on a `vecN`, or
 * `undefined` when it can.
 *
 * The shader builtins (`sin`, `sqrt`, `abs`, …) and the arithmetic operators
 * are genType-polymorphic, including the mixed scalar/vector forms
 * (`1.0 / vec3`, `vec3 / log(10.0)`), so the overwhelming majority of the
 * scalar lowerings are already componentwise. The exceptions are recognized
 * from the SHAPE OF THE EMITTED SOURCE — not from a list of operator names,
 * which would go stale the moment a lowering changed:
 *
 *  - a `_gpu_…` PREAMBLE HELPER (`_gpu_sinc`, `_gpu_gamma`, `_gpu_heaviside`,
 *    `_gpu_fresnelC`, `_gpu_powi`, …). Every helper reachable from a SCALAR
 *    element lowering is declared with scalar `float` parameters, so
 *    `_gpu_sinc` of a `vec3` is source no driver accepts. The `_gpu_` prefix
 *    IS the property being tested. (A few helpers ARE aggregate-aware — the
 *    complex arithmetic and the colour converters take `vec2`/`vec3`, and the
 *    integer power has a per-width overload family, `_gpu_powi2`–`_gpu_powi4`
 *    — so this verdict is right only for a helper reached from a scalar
 *    element lowering.)
 *  - a COMPARISON or a TERNARY (`Argument(x)` → `((x >= 0.0) ? 0.0 : π)`):
 *    GLSL has no `vecN >= float`, and requires a scalar `bool`
 *    condition, so there is no componentwise reading of either.
 *  - a lowering that DROPS the operand (`Imaginary(x)` → `0.0` for a real
 *    `x`): the result is a scalar where the caller is owed a `vecN`, which is
 *    a silent SHAPE error rather than a driver error.
 *
 * The last two are only decidable when the caller can name the operand's own
 * compiled source (`vector`) — i.e. on the fan-out route, where the WHOLE
 * emission derives from the element lowering. A caller with no such handle
 * passes none, and gets the helper verdict alone: in a lowering over several
 * independently compiled operands, a comparison may be over an unrelated
 * scalar operand (`ContrastingColor` → `(_gpu_apca(…) > 50.0) ? … : …`).
 */
export function gpuIsComponentwise(
  code: string,
  vector?: string
): string | undefined {
  const helper = /_gpu_[A-Za-z0-9_]+\s*\(/.exec(code);
  if (helper !== null)
    return (
      `it calls the preamble helper \`${helper[0].slice(0, -1).trim()}\`, ` +
      `which is declared with scalar float parameters.`
    );
  if (vector === undefined) return undefined;
  if (/\?|[<>]=?|[=!]=/.test(code))
    return (
      `it branches on a comparison, which a shader requires to be a scalar ` +
      `bool.`
    );
  if (!code.includes(vector))
    return `it does not use the operand at all, so its result is a scalar.`;
  return undefined;
}

/**
 * The SHADER shape an operand lowers to: a scalar, a `vecN` (reported as its
 * width), a `matN`, or an array (`float[N]`).
 *
 * Derived from the shape helpers the rest of the GPU analysis already uses —
 * `isNonScalarShape` ("is this a scalar at all?") and `gpuComponentCount`
 * ("does it have a `vec2`–`vec4` lowering?") — so it stays in step with them
 * rather than re-deciding shape from scratch, plus `gpuIsCollectionShaped` for
 * the collection type spellings `isNonScalarShape` does not recognize.
 *
 * A fixed-length list whose ELEMENTS are not shader floats (`list<complex^3>`,
 * a list of lists) has no `vecN` reading and no other shader value shape
 * either, so it lands on `'array'` here and every arithmetic and builtin gate
 * declines it — the fail-closed answer for a shape the language cannot hold.
 *
 * A COMPLEX value reads as a scalar here, even though it lowers to a `vec2` of
 * (re, im): the complex convention is its own, carried by the complex codegen
 * (`_gpu_cmul`, `_gpu_cdiv`, …), and reading it as a 2-cell vector would make
 * every complex lowering look like a shape error. This is the same ordering
 * the fan-out and selection lowerings depend on.
 */
/**
 * `u` when the real expression `x` is `π·u` with a scalar `u`
 * (`BaseCompiler.piMultiple`): the shader lowers `sin(πu)`, `cos(πu)`,
 * `tan(πu)` and `e^{iπu}` with the angle in half-turns (`_gpu_cossinpi`).
 * A vector `u` keeps the componentwise built-in.
 *
 * `period` is the period of the function in half-turns (2 for `sin` and
 * `cos`, 1 for `tan`): a constant term of `u` is reduced by whole periods
 * (`gpuReduceTrigOffset`).
 */
export function gpuPiMultiple(
  x: Expression | null,
  period: number,
  target?: CompileTarget<Expression>
): Expression | undefined {
  if (x === null) return undefined;
  const u = BaseCompiler.piMultiple(x);
  // A trusted lowering (`fragmentReplaceOperands()`). Input: the real
  // argument `x` of `sin`, `cos`, `tan` (or of their reciprocals). Output:
  // `u` with `x = π·u`: `Multiply(π, a, b)` gives `Multiply(a, b)`,
  // `Divide(π·a, d)` gives `Divide(a, d)`, `Negate(π·a)` gives `Negate(a)`,
  // `π` gives `1`. Condition: `π` is the library constant, one factor of a
  // product whose other factors are real and have no `π`. The value is the
  // interpreter's: the emitter computes `sin(π·u)` as `_gpu_sinpi(u)`, and
  // the factors of `u` are the other operands of the same product, each
  // evaluated once.
  return u !== undefined && gpuOperandShape(u) === 'scalar'
    ? gpuReduceTrigOffset(
        fragmentReplaceOperands(x, u, GPU_PI_MULTIPLE_LOWERING, target),
        period,
        false,
        undefined,
        target
      )
    : undefined;
}

/** The contract of the lowering `x = π·u` → `u` (`gpuPiMultiple()`,
 *  `gpuImaginaryPiMultiple()`). `u` is made with the canonical
 *  constructors: `.neg()` distributes over a sum (`−π·(t − 1)` gives
 *  `Add(−t, 1)`), and a canonical quotient or product joins the powers of
 *  one base (`(x/y)/√y` gives `x / y^{3/2}`, `x·y / y^{3/2}` gives
 *  `x / √y`), so a made node can be an `Add`, a `Power`, a `Sqrt` or a
 *  `Root`. */
const GPU_PI_MULTIPLE_LOWERING: FragmentLoweringContract = {
  name: 'the angle in half-turns',
  operators: ['Multiply', 'Divide', 'Negate', 'Add', 'Power', 'Sqrt', 'Root'],
  // The lowering removes the factor `π` (and, for `gpuImaginaryPiMultiple()`,
  // the factor `i`): a leaf that is still one of them gives a wrong angle.
  forbiddenSymbols: ['Pi', 'ImaginaryUnit'],
};

/** The contract of the lowering `gpuReduceTrigOffset()`. */
const GPU_TRIG_OFFSET_LOWERING: FragmentLoweringContract = {
  name: 'the reduction of the constant term of a periodic argument',
  operators: ['Add', 'Multiply'],
};

/**
 * `u` when the complex expression `x` is `i·π·u` with a real scalar `u`
 * (`BaseCompiler.imaginaryPiMultiple`): the shader lowers `sinh`, `cosh`,
 * `tanh`, `csch`, `sech` and `coth` of `iπu` with the angle in half-turns
 * (`_gpu_ipi_sinh` and the others), so a pole is the unsigned pole and a
 * zero is exact. A vector `u` keeps the complex helper. `period` is the
 * period of the function in half-turns, as for `gpuPiMultiple`.
 */
export function gpuImaginaryPiMultiple(
  x: Expression | null,
  period: number,
  target?: CompileTarget<Expression>
): Expression | undefined {
  if (x === null) return undefined;
  const u = BaseCompiler.imaginaryPiMultiple(x);
  // A trusted lowering (`fragmentReplaceOperands()`). Input: the complex
  // argument `x` of `sinh`, `cosh`, `tanh`, `csch`, `sech`, `coth`. Output:
  // `u` with `x = i·π·u`, as for `gpuPiMultiple()`; an imaginary literal
  // factor `b·i` gives the real factor `b`. Condition: `i` (or one imaginary
  // literal) and the library `π` are factors of a product whose other
  // factors are real. The value is the interpreter's: `sinh(iπu)` is
  // `i·sin(πu)`, which the emitter computes with the angle `u` in
  // half-turns.
  return u !== undefined && gpuOperandShape(u) === 'scalar'
    ? gpuReduceTrigOffset(
        fragmentReplaceOperands(x, u, GPU_PI_MULTIPLE_LOWERING, target),
        period,
        false,
        undefined,
        target
      )
    : undefined;
}

/**
 * The argument `x` of a periodic function, with its constant terms reduced
 * by whole periods at compile time.
 *
 * A shader computes in float32, about 7 significant digits. In `x + c` with a
 * large constant `c`, the sum is rounded before the function reads it, so the
 * low digits of `x` are lost: `sin(x + 10^6)` is off by up to 0.03 for every
 * `x`, and the curve crosses zero in the wrong place. The function is
 * periodic, so `c` can be replaced by `c − P·round(c/P)`, which lies in
 * [−P/2, P/2], and `x` then keeps its own precision. No run-time reduction is
 * emitted: the argument of `sin` itself is not changed, and the native `sin`
 * reduces a float32 argument accurately on the GPUs measured.
 *
 * The period is `period·π` when `inRadians` is true (`sin`, `cos`, `tan` and
 * their reciprocals), and `period` itself when it is false (the half-turn
 * helpers `_gpu_sinpi`, `_gpu_cospi`, `_gpu_tanpi` and `_gpu_cossinpi`, whose
 * argument is the angle divided by π).
 *
 * `x` is a sum `u + c`, or a sum times a number literal `k·(u + c)`, the form
 * the degree-mode rewrite gives (`sin(0.0174…·(x + 10^6))`): then `c` is
 * reduced by `P/k`, the period of the product in the units of the sum. A
 * constant term is a real number literal, or an exact-arithmetic expression
 * over number literals (`10^{20}`, `10^7/3`, `10^6·√2`), or, in radians,
 * such a term times the library constant π (`10^6·π`). When the caller gives
 * `target`, a pure library function of constant operands (`Γ(20)`) is a
 * constant term too (`gpuLibraryConstant`). A term that draws a random
 * number (`Random()`) or that calls a function the caller maps to its own
 * code (the `functions` option of `compile()`) is never a constant term.
 *
 * The constant terms are added and reduced with `BigDecimal`, at a precision
 * that keeps every digit of the remainder, so an exact constant that a double
 * does not hold (`10^{20} + 1`, `10^{400}`) reduces correctly. The remainder
 * is written as one float literal. When the constant is already in
 * [−P/2, P/2], `x` is returned unchanged, so a small offset (`sin(x + 1)`)
 * emits the same code as before. Only a real scalar argument is rewritten.
 */
export function gpuReduceTrigOffset(
  x: Expression,
  period: number,
  inRadians: boolean,
  target?: CompileTarget<Expression>,
  /** The target of the emitter, for the structural check only, when the
   *  caller does not give `target` (`gpuPiMultiple()`). */
  emitTarget?: CompileTarget<Expression>
): Expression {
  // A trusted lowering (`fragmentReplaceOperands()`). Input: the real
  // scalar argument `x` of a periodic function, `Add(u…, c…)` or
  // `Multiply(k, Add(u…, c…))` with a number literal `k`. Output:
  // `Add(u…, c')` (or `Multiply(k, Add(u…, c'))`), or `u` alone, or `0`,
  // where `c'` is one number literal. Condition: the constant terms `c` add
  // up to more than half a period `P` (`P/|k|` in the scaled form). The value
  // is the interpreter's: the function has the period `P`, and
  // `c' = c − P·round(c/P)`. The terms `u` are operands of `x`, evaluated
  // once each; a constant term has no effect.
  const reduced = gpuReduceTrigOffsetOf(x, period, inRadians, target);
  return fragmentReplaceOperands(
    x,
    reduced,
    GPU_TRIG_OFFSET_LOWERING,
    emitTarget ?? target
  );
}

function gpuReduceTrigOffsetOf(
  x: Expression,
  period: number,
  inRadians: boolean,
  target?: CompileTarget<Expression>
): Expression {
  if (BaseCompiler.isComplexValued(x) || gpuOperandShape(x) !== 'scalar')
    return x;
  if (isFunction(x, 'Multiply') && x.nops === 2) {
    const [k, sum] = isNumber(x.ops[0])
      ? [x.ops[0], x.ops[1]]
      : [x.ops[1], x.ops[0]];
    if (!isNumber(k) || !isFunction(sum, 'Add')) return x;
    const reduced = gpuReduceSumOffset(sum, period, inRadians, k, target);
    return reduced === sum ? x : x.engine.function('Multiply', [k, reduced]);
  }
  if (!isFunction(x, 'Add')) return x;
  return gpuReduceSumOffset(x, period, inRadians, undefined, target);
}

/**
 * The value of a constant term of a trigonometric argument that applies a
 * library function to constant operands (`Γ(20)`, `20!`, `e^{20}`), as a
 * real number literal, or `undefined`. It is read only by
 * `gpuReduceSumOffset`, and only when the caller gives the compile target
 * (CE-227.1).
 *
 * The term must be pure, so that a `Random()` draw is never made at compile
 * time, and it must not reach a function that the `functions` option of
 * `compile()` maps to the caller's code, or a symbol that the `vars` option
 * maps to a run-time input, even through the body of a user function or an
 * assigned value (`BaseCompiler.reachesExcludedName`): the caller's code
 * computes that value at run time. Its symbols must be constants
 * (`π`, `e`), and the `constantFold: false` option turns the fold off, as
 * it does for the compiler's own constant fold.
 *
 * An exact value (`evaluate()` gives `121645100408832000` for `Γ(20)`) is
 * used as it is. Otherwise the value of `N()` at the precision of the engine
 * is used when that precision keeps at least 12 digits after the decimal
 * point, so that the remainder of the reduction is exact to more digits than
 * a float32 holds.
 */
function gpuLibraryConstant(
  op: Expression,
  target: CompileTarget<Expression>
): Expression | undefined {
  if (!isFunction(op) || target.constantFold === false) return undefined;
  if (op.isPure !== true || op.unknowns.length > 0) return undefined;
  const ce = op.engine;
  if (!op.symbols.every((s) => ce.symbol(s).isConstant)) return undefined;
  // The term must not reach a caller-mapped function or a `vars`-mapped
  // symbol, directly, through a user-function body, or through an assigned
  // value: evaluating it would replace the caller's run-time code or input.
  if (BaseCompiler.reachesExcludedName(op, target)) return undefined;
  const isRealLiteral = (v: Expression): boolean =>
    isNumber(v) && !v.isComplex && v.isFinite === true;
  const exact = op.evaluate();
  if (isRealLiteral(exact) && isNumber(exact) && exact.isExact) return exact;
  const approx = op.N();
  if (!isRealLiteral(approx)) return undefined;
  const integerDigits = Math.max(
    1,
    Math.ceil(Math.log10(Math.abs(approx.re) + 1))
  );
  return ce.precision >= integerDigits + 12 ? approx : undefined;
}

/** `gpuReduceTrigOffset` for a sum, whose units are scaled by `scale`. */
function gpuReduceSumOffset(
  x: Expression,
  period: number,
  inRadians: boolean,
  scale: Expression | undefined,
  target?: CompileTarget<Expression>
): Expression {
  if (!isFunction(x, 'Add')) return x;
  const literals: Expression[] = [];
  const piTerms: Expression[] = [];
  const rest: Expression[] = [];
  for (const op of x.ops) {
    const v = gpuExactConstant(op);
    if (v !== undefined) {
      literals.push(v);
      continue;
    }
    if (inRadians) {
      const u = BaseCompiler.piMultiple(op);
      const k = u === undefined ? undefined : gpuExactConstant(u);
      if (k !== undefined) {
        piTerms.push(k);
        continue;
      }
    }
    // Tried last: an exact multiple of π above keeps all its digits, where
    // the value of `N()` would keep only the digits of the engine precision.
    const w = target === undefined ? undefined : gpuLibraryConstant(op, target);
    if (w !== undefined) {
      literals.push(w);
      continue;
    }
    rest.push(op);
  }
  if (literals.length + piTerms.length === 0) return x;

  // The constant `c`, exact (`gpuWithExactConstant`), and its remainder
  // `c − P·round(c/P)` when `|c| > P/2`.
  const remainder = gpuWithExactConstant(literals, piTerms, (c) => {
    let p = inRadians ? BigDecimal.PI.mul(period) : new BigDecimal(period);
    if (scale !== undefined) {
      const k = gpuBigValue(scale);
      if (k === undefined || k.isZero()) return undefined;
      p = p.div(k.abs());
    }
    if (c.abs().cmp(p.div(2)) <= 0) return undefined;
    return c.sub(c.div(p).round().mul(p)).toNumber();
  });
  if (remainder === undefined) return x;
  const ce = x.engine;
  if (remainder === 0) {
    if (rest.length === 0) return ce.Zero;
    return rest.length === 1 ? rest[0] : ce.function('Add', rest);
  }
  return ce.function('Add', [...rest, ce.number(remainder)]);
}

export function gpuOperandShape(
  expr: Expression
): 'scalar' | 'matrix' | 'array' | 2 | 3 | 4 {
  // `Normalize` has no definition in the engine, so its node has no type
  // that gives a width; the shader `normalize()` keeps the shape of its
  // operand.
  if (isFunction(expr, 'Normalize') && expr.nops === 1)
    return gpuOperandShape(expr.op1);
  if (BaseCompiler.isComplexValued(expr)) return 'scalar';
  if (!BaseCompiler.isNonScalarShape(expr) && !gpuIsCollectionShaped(expr))
    return 'scalar';
  const width = gpuComponentCount(expr);
  if (width !== undefined) return width;
  // A written list of points is emitted as an ARRAY of vectors
  // (`gpuUniformVectorWidth`), never as a matrix, whatever its type's
  // dimensions say: the shape must agree with the emission, or a scalar
  // times a nested list would pass the matrix reading and emit
  // `x * vec2[2](…)`, which no shader accepts.
  if (
    (isFunction(expr, 'List') || isFunction(expr, 'Tuple')) &&
    gpuUniformVectorWidth(expr.ops) !== undefined
  )
    return 'array';
  if (isFunction(expr, 'Matrix')) return 'matrix';
  const t = gpuType(expr);
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    (t.dimensions?.length ?? 0) >= 2
  )
    return 'matrix';
  // A non-scalar with no `vecN` and no matrix reading: a 1-element or
  // 5+-element list, or a list of unknown length — a shader ARRAY.
  return 'array';
}

/**
 * Whether `expr` is COLLECTION-SHAPED by its declared type, whatever spelling
 * that type uses and whether or not a static element count can be read off it.
 *
 * `isNonScalarShape` recognizes only the `list` type CONSTRUCTOR, so an
 * operand declared with a sibling spelling read back as a shader SCALAR and
 * every shape gate stepped aside for it: `Sin(L)` for `L: collection<number>`
 * emitted `sin(L)`, source that is valid only if the host happens to bind `L`
 * to a `vecN` uniform — a shape the compiler asserts but cannot see. The
 * spellings that slipped through are the other collection kinds
 * (`collection<T>`, `indexed_collection<T>`, `set<T>`, `dictionary`) and the
 * BARE names `list` and `collection`, which the type representation carries as
 * primitive strings rather than as a `list` node.
 *
 * The question is asked against the explicit top `collection<any>`. Since
 * 0.160.0 the bare name `collection` also matches `list<any>` and
 * `list<integer|missing>`, but the explicit spelling does not depend on how
 * the bare name is read.
 *
 * A `string` is excluded. It matches `collection` in the lattice — its
 * elements are its grapheme clusters — but this target has no strings at all,
 * so a string operand keeps the "provably not a number" diagnostic naming its
 * type, which is the diagnostic it has always received.
 */
function gpuIsCollectionShaped(expr: Expression): boolean {
  const t = gpuType(expr);
  return isSubtype(t, COLLECTION_SHAPE_TYPE) && !isSubtype(t, 'string');
}

/** The name of a shape in a diagnostic: `scalar`, `vec3`, `matrix`, `array`. */
export function gpuShapeName(
  shape: ReturnType<typeof gpuOperandShape>
): string {
  return typeof shape === 'number' ? `vec${shape}` : shape;
}

/**
 * The `vecN` width a two-operand lowering must emit, or `undefined` when it
 * stays scalar.
 *
 * Answers a width only for the shapes the shader arithmetic really does
 * broadcast: one `vecN` beside a scalar, or two `vecN` of the SAME width.
 * Different widths, a `matN` and an array all answer `undefined`, so the
 * lowering emits its plain form. A lowering must not guess a width here: the
 * GLSL fragment pass refuses these operand shapes before the emitter runs,
 * and a guessed width would write source that no shader compiler accepts.
 *
 * A missing operand (an under-applied head) also answers `undefined`.
 */
export function gpuBinaryVectorWidth(
  a: Expression | null | undefined,
  b: Expression | null | undefined
): 2 | 3 | 4 | undefined {
  if (a === null || a === undefined || b === null || b === undefined)
    return undefined;
  const sa = gpuOperandShape(a);
  const sb = gpuOperandShape(b);
  if (typeof sa === 'number')
    return sb === 'scalar' || sb === sa ? sa : undefined;
  if (typeof sb === 'number') return sa === 'scalar' ? sb : undefined;
  return undefined;
}

/**
 * An operand's source, widened to a `vecN` constructor when the slot it stands
 * in is a vector one and the operand itself lowers to a scalar.
 *
 * The genType builtins (`pow`, `atan`, `mod`, …) are declared over ONE type
 * for all their arguments; GLSL does not promote a scalar argument to
 * the vector of its neighbours, so the promotion has to be written out.
 * `vec3(y)` is the broadcast constructor — every component
 * takes the same value.
 *
 * `width` of `undefined` (a scalar lowering) and an operand that is already
 * that `vecN` both compile unchanged, so the emission is byte-identical to the
 * scalar-only one wherever no widening is due.
 *
 * `compile` runs exactly once on either branch: an operand may hoist a
 * temporary or advance the random-draw counter, so compiling it twice would
 * change the shader, not merely lengthen it.
 */
export function gpuWidenToVector(
  expr: Expression,
  width: 2 | 3 | 4 | undefined,
  compile: (expr: Expression) => string
): string {
  if (width === undefined || gpuOperandShape(expr) !== 'scalar')
    return compile(expr);
  return `${gpuFVec(width)}(${compile(expr)})`;
}

/**
 * The `[rows, cols]` of a matrix-shaped operand, or `undefined` when they are
 * not statically known. The kind alone is not enough for the operator gate:
 * `mat2 + mat3` and `mat2 * vec3` are as invalid as `vec2 + vec3`, so the
 * dimensions must be read — structurally for a `Matrix` literal, from the
 * declared list dimensions otherwise (an unknown extent is reported as a
 * negative count there, and answers `undefined` here).
 */
function gpuMatrixDims(
  expr: Expression
): readonly [rows: number, cols: number] | undefined {
  if (isFunction(expr, 'Matrix')) {
    const body = expr.ops[0];
    if (!isFunction(body) || body.nops === 0) return undefined;
    const rows = body.ops;
    const cols = isFunction(rows[0]) ? rows[0].nops : 0;
    if (cols > 0 && rows.every((r) => isFunction(r) && r.nops === cols))
      return [rows.length, cols];
    return undefined;
  }
  const t = gpuType(expr);
  if (typeof t !== 'string' && t.kind === 'list') {
    const dims = t.dimensions;
    if (dims?.length === 2 && dims[0] > 0 && dims[1] > 0)
      return [dims[0], dims[1]];
  }
  return undefined;
}

/**
 * The callee and top-level argument count of `code` when the WHOLE emission is
 * a single call. `undefined` for an infix/compound emission (`a + b`,
 * `(c ? a : b)`, `log(a) / log(10.0)`): no single builtin signature governs
 * the operand shapes of such an emission.
 *
 * The argument count is what distinguishes a lowering that passes its operands
 * THROUGH (`_gpu_powi(x, n)`, one argument per operand) from one that
 * DESTRUCTURES a collection operand into scalars (`Median([1,5,3,2,4])` →
 * `_gpu_median_5(1.0, 5.0, 3.0, 2.0, 4.0)`, five arguments for one operand).
 *
 * `operands` are those arguments' own sources, which is what lets a reduction
 * read the components back out of an aggregate CONSTRUCTOR
 * (`gpuScalarComponents`).
 */
export function gpuTopLevelCall(
  code: string
): { callee: string; argCount: number; operands: string[] } | undefined {
  const s = code.trim();
  // `sin`, `_gpu_powi`, `vec3`, `mat2x3`, `float[5]`, `vec2[3]`
  const m = /^([A-Za-z_]\w*(?:\s*\[\d+\])?)\s*\(/.exec(s);
  if (m === null) return undefined;
  let depth = 0;
  let start = m[0].length;
  const operands: string[] = [];
  for (let i = m[0].length - 1; i < s.length; i++) {
    if (s[i] === '(') {
      if (++depth === 1) start = i + 1;
    } else if (s[i] === ',' && depth === 1) {
      operands.push(s.slice(start, i).trim());
      start = i + 1;
    } else if (s[i] === ')' && --depth === 0) {
      if (i !== s.length - 1) return undefined;
      const last = s.slice(start, i).trim();
      // `f()` has no arguments; `f(a)` has one, even when `a` is empty text.
      if (last !== '' || operands.length > 0) operands.push(last);
      return { callee: m[1].trim(), argCount: operands.length, operands };
    }
  }
  return undefined;
}

/**
 * Per-language shape rules of a shader target. The languages agree on the
 * broad strokes — the builtins and the arithmetic operators are
 * genType-polymorphic — but not on where a SCALAR may stand in for a `vecN`,
 * so each target supplies its own table (see `GPUShaderTarget.getShapeRules`).
 * The fold of `ElementMax` and `ElementMin` reads it (`foldNaryBuiltin()` in
 * `gpu-extrema.ts`). The other operand shapes that a shader call cannot take
 * are refused by the GLSL fragment pass, which gives each operator a
 * signature over the operand types (`glsl-fragment.ts`).
 */
export type GPUShapeRules = {
  /**
   * Shader builtins that accept a scalar where their other genType arguments
   * are a `vecN`, and — crucially — WHERE. The scalar-tailed overloads
   * constrain the POSITION as well as the presence: GLSL declares
   * `mod(genType, float)` (scalar only LAST), `step(float, genType)` (scalar
   * only FIRST), `mix(genType, genType, float)` and `refract(genType, genType,
   * float)` (scalar only third), `clamp(genType, float, float)` (scalars in
   * slots 2–3). So the value is the set of 0-based argument positions at which
   * a scalar may stand; a scalar anywhere else is as invalid as one in a
   * builtin with no such overload at all.
   *
   * A builtin ABSENT from the map requires MATCHING genTypes throughout, so
   * `atan(vec3, float)` and `pow(float, vec3)` are not valid source.
   *
   * These are shader BUILTIN names — a fact of each language's specification,
   * not a list of CE heads.
   */
  readonly scalarGenTypeSlots: ReadonlyMap<string, ReadonlySet<number>>;
};

/**
 * The GPU targets' extension of `CompileTarget`: the language's own shape
 * rules, carried on the target so a LOWERING can judge the calls it
 * generates against the table (`foldNaryBuiltin`). Written once by
 * `createTarget()`; a hand-rolled target that never went through it has none,
 * and those lowerings then use the plain built-in.
 */
export type GPUShapeRulesTarget = CompileTarget<Expression> & {
  gpuShapeRules?: GPUShapeRules;
};

/** The shape rules `target` was created with, if any. */
export function gpuShapeRules(
  target: CompileTarget<Expression> | undefined
): GPUShapeRules | undefined {
  return (target as GPUShapeRulesTarget | undefined)?.gpuShapeRules;
}

/** `{1}` → "in argument 2"; `{1, 2}` → "in arguments 2 and 3". */
export function gpuSlotNames(slots: ReadonlySet<number>): string {
  const ns = [...slots].sort((a, b) => a - b).map((n) => `${n + 1}`);
  if (ns.length === 0) return 'nowhere';
  if (ns.length === 1) return `in argument ${ns[0]}`;
  return `in arguments ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * The heads this target lowers with a real-only FUNCTION codegen, beyond the
 * heads that are real-only on every target
 * (`BaseCompiler.REAL_ONLY_BY_DEFINITION`). The shader lowering reads the
 * operand as a `float` and has no complex form for it.
 *
 * A complex value lowers to a `vec2` of (re, im). Given one, these lowerings
 * emit either a call no shader compiler accepts (`_gpu_gamma(vec2(x, y))`:
 * the helper takes a `float`) or a componentwise builtin that computes a
 * different value than the interpreter (`asinh(1.0 / vec2(x, y))` for
 * `Arcsch`, `(1 - cos(vec2(x, y))) / 2` for `Haversine`), behind
 * `success: true`. Several of these heads have a complex lowering on another
 * target: the JavaScript target lowers `Arccot`, `Arcsch` and
 * `InverseHaversine` with a complex form (`_SYS.cacot`, …), and the Python
 * target lowers `Gamma`, `Factorial` and `Erf` with `scipy.special`
 * routines that take a complex argument. `Root` is not listed: a complex
 * radicand lowers through `_gpu_cpow` (see the `Root` lowering). `Variance`
 * has a complex value in the interpreter and on the Python target, but the
 * shader lowering sums `float` values. `Mean` and `StandardDeviation` are not
 * listed: the shader targets have no lowering for them, so they fail closed
 * for every operand.
 */
const GPU_REAL_ONLY_LOWERINGS: ReadonlySet<string> = new Set([
  'Variance',
  'Hypot',
  'Arctan2',
  'Haversine',
  'GammaLn',
  'Beta',
  'Erf',
  'Erfc',
  'ErfInv',
  'Heaviside',
  'Sinc',
  'FresnelC',
  'FresnelS',
  'BesselJ',
  'Arccot',
  'Arcsch',
  'InverseHaversine',
  'Gamma',
  'Factorial',
  'Digamma',
  'Trigamma',
  'PolyGamma',
  'Zeta',
  'HurwitzZeta',
  'LerchPhi',
  'PolyLog',
  // `Sign` of a complex `z` is `z / |z|`; the built-in `sign` of a `vec2`
  // takes the sign of each part. `Smoothstep` has no complex form.
  'Sign',
  'Smoothstep',
]);

/** `CompileTarget.isRealOnlyLowering` of the shader targets. The base
 * compiler fails a complex operand of a real-only lowering closed: the
 * shader targets have no run-time realness guard. */
export function gpuIsRealOnlyLowering(
  head: string,
  lowering: CompiledFunction<Expression> | undefined
): boolean {
  return (
    BaseCompiler.REAL_ONLY_BY_DEFINITION.has(head) ||
    GPU_REAL_ONLY_LOWERINGS.has(head) ||
    BaseCompiler.stringHelperIsRealOnly(head, lowering)
  );
}

/**
 * A new `CompileTarget.loweredSymbolType` hook for one shader target: the
 * shader type the emitted code reads the free symbol `symbol` as — the type
 * of the uniform the host must declare. A symbol read as a colour operand is
 * a `vec3`; otherwise the type is read from the same analysis that types the
 * parameters and return values of emitted functions (`gpuTypeOfValue`),
 * then a matrix (`mat2`, `mat3x2`) or an array (`float[5]`;
 * `vec2[3]` for a list of points).
 * `undefined` when none of these apply.
 */
export function gpuLoweredSymbolTypeHook(): (
  symbol: Expression
) => string | undefined {
  const colorReads = new Set<string>();
  const hook = (symbol: Expression): string | undefined => {
    if (isSymbol(symbol) && colorReads.has(symbol.symbol)) return gpuVecType(3);
    const shape = gpuOperandShape(symbol);
    if (shape === 'matrix') {
      const dims = gpuMatrixDims(symbol);
      if (dims === undefined) return undefined;
      const [rows, cols] = dims;
      return rows === cols ? `mat${cols}` : `mat${cols}x${rows}`;
    }
    if (shape === 'array') {
      const t = gpuType(symbol);
      // A tuple of 5 or more real scalars is read as an array of floats:
      // the `At` lowering indexes it (`F[1]`, `_gpu_at5(F, k)`) as it
      // indexes a `list<real^5>`.
      if (
        typeof t !== 'string' &&
        t.kind === 'tuple' &&
        t.elements.length > 4 &&
        gpuTupleWithoutShaderType(t) === undefined
      ) {
        const n = t.elements.length;
        return `float[${n}]`;
      }
      if (typeof t === 'string' || t.kind !== 'list') return undefined;
      const n = t.dimensions?.length === 1 ? t.dimensions[0] : undefined;
      if (n === undefined || !(n > 0)) return undefined;
      // A list of points (tuples of 2 to 4 real coordinates) is read as an
      // array of `vecM`: the `At` lowering indexes it as `P[j]` and passes it
      // to the `_gpu_atpM_N` helper, whose parameter is `vecM v[N]`.
      // `gpuPointListAtBase` uses the same test
      // (`gpuPointListArity`), so the reported type and the emitted reads
      // agree. (CE-685)
      const m = gpuPointListArity(t);
      if (typeof m === 'number') return `vec${m}[${n}]`;
      return `float[${n}]`;
    }
    return gpuTypeOfValue(symbol);
  };
  gpuColorSymbolReads.set(hook, colorReads);
  return hook;
}

/**
 * The type of the value `expr` when it is CERTAIN, or `undefined`.
 *
 * Used only for the type check of a `compileShader()` body statement, which
 * must never refuse a valid shader. The emitter decides the width of a
 * compound value operator by operator (`gpuOperandShape`), and there is no
 * single function that gives it, so this function answers only in the cases
 * where the type cannot be wrong:
 * - a name with a declared type in the frame of the body (read with
 *   `gpuDeclaredTypeOf`): an input, a uniform, and in GLSL an output or a
 *   built-in variable of the stage. An integer scalar name is read through a
 *   float conversion, so it is a float;
 * - a real number literal, a real library constant (`Pi`), `True`, `False`;
 * - a `Tuple` or `List` of float scalars: a vector of 2 to 4 components, or
 *   an array for another count; a `Matrix` literal;
 * - an element-wise operator (`GPU_SCALAR_ARITHMETIC`) whose operands are all
 *   float scalars (a float scalar), and a comparison or a logic operator whose
 *   operands are all scalars (a `bool`);
 * - an `If` whose two branches have the same certain type.
 * A complex value (lowered as `vec2(re, im)`) and anything else answer
 * `undefined`: a vector expression such as `s * uv` or `Sin(uv)` is not
 * typed, and its statement is not checked.
 */
export function gpuCertainValueType(
  expr: Expression
): GPUValueType | { kind: 'matrix' | 'array'; spelling: string } | undefined {
  if (BaseCompiler.isComplexValued(expr)) return undefined;
  const isFloatScalar = (e: Expression): boolean => {
    const t = gpuCertainValueType(e);
    return (
      t !== undefined && 'element' in t && t.element === 'f' && t.width === 1
    );
  };
  if (isNumber(expr)) return { element: 'f', width: 1 };
  if (isSymbol(expr)) {
    const declared = gpuDeclaredTypeOf(expr);
    if (declared !== undefined) {
      if (gpuDeclaredIsIntegerScalar(declared.value))
        return { element: 'f', width: 1 };
      return declared.value ?? gpuMatrixOrArraySpelling(declared.spelling);
    }
    if (expr.symbol === 'True' || expr.symbol === 'False')
      return { element: 'b', width: 1 };
    if (expr.isConstant === true && expr.type.matches('real'))
      return { element: 'f', width: 1 };
    return undefined;
  }
  if (!isFunction(expr)) return undefined;
  const op = expr.operator;
  if (op === 'Matrix') {
    // `compileGPUMatrix` writes a column `Matrix` (N rows of one element) as
    // a `vecN` (N from 2 to 4) or an array, and a square one (2 to 4) as a
    // `matN`. Another shape is written as its nested lists.
    const dims = gpuMatrixDims(expr);
    if (dims === undefined) return undefined;
    const [rows, cols] = dims;
    if (cols === 1) {
      const body = expr.ops[0];
      const cells = isFunction(body)
        ? body.ops.map((row) => (isFunction(row) ? row.ops[0] : row))
        : [];
      if (!cells.every(isFloatScalar)) return undefined;
      if (rows >= 2 && rows <= 4) return { element: 'f', width: rows };
      return {
        kind: 'array',
        spelling: `float[${rows}]`,
      };
    }
    // Another shape with 2 to 4 columns is written as an array of its rows
    // (`vec2[1](vec2(1.0, 2.0))` for a 1×2 `Matrix`).
    if (rows !== cols || rows > 4)
      return cols >= 2 && cols <= 4
        ? {
            kind: 'array',
            spelling: `vec${cols}[${rows}]`,
          }
        : undefined;
    return {
      kind: 'matrix',
      spelling: `mat${cols}`,
    };
  }
  if (op === 'Tuple' || op === 'List') {
    if (!expr.ops.every(isFloatScalar)) return undefined;
    const n = expr.nops;
    if (n >= 2 && n <= 4) return { element: 'f', width: n };
    return {
      kind: 'array',
      spelling: `float[${n}]`,
    };
  }
  if (GPU_SCALAR_ARITHMETIC.has(op))
    return expr.nops > 0 && expr.ops.every(isFloatScalar)
      ? { element: 'f', width: 1 }
      : undefined;
  if (GPU_SCALAR_PREDICATES.has(op))
    return expr.nops > 0 &&
      expr.ops.every((e) => {
        const t = gpuCertainValueType(e);
        return t !== undefined && 'element' in t && t.width === 1;
      })
      ? { element: 'b', width: 1 }
      : undefined;
  if (op === 'If' && expr.nops === 3) {
    const a = gpuCertainValueType(expr.ops[1]);
    const b = gpuCertainValueType(expr.ops[2]);
    if (
      a !== undefined &&
      b !== undefined &&
      'element' in a &&
      'element' in b &&
      a.element === b.element &&
      a.width === b.width
    )
      return a;
  }
  return undefined;
}
