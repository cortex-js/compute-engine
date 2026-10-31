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
  tryGetConstant,
  assertScalarComplexOperand,
  formatFloat,
  principalComplexPow,
} from './constant-folding.js';
import type { CompileTarget, CompiledFunction } from './types.js';
import { BaseCompiler, pointHasBroadcastComponent } from './base-compiler.js';
import { complexContinuation } from './complex-continuation.js';
import {
  finitePartOfType,
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';
import {
  GPU_AGGREGATE_CONSTRUCTOR,
  GPU_OPERATORS,
  GPU_VECTOR_ARRAY_CONSTRUCTOR,
  gpuFVec,
  gpuIsAtomicEmission,
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
  gpuTypeOfValue,
} from './gpu-declared-types.js';
import type { GPUValueType } from './gpu-declared-types.js';

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
  return `${gpuVec2(target)}(${formatFloat(r.re, target?.language)}, ${formatFloat(
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
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  if (BaseCompiler.isComplexValued(x)) return compile(x);
  assertScalarComplexOperand(undefined, x);
  return `${gpuVec2(target)}(${compile(x)}, 0.0)`;
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
 * (`vec3[N](…)` / `array<vec3f, N>(…)`) — or `undefined` when the elements
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
 * `float[0]()` / `array<f32, 0>()`, and neither language has a zero-length
 * array type.
 */
export function assertGPUScalarComponents(
  args: ReadonlyArray<Expression>,
  ctor: string
): void {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${ctor}\`: an empty tuple/list has no GPU lowering — neither GLSL nor ` +
        `WGSL has a zero-length array type.`
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
 * broadcast vector constructor (`vec2(_gpu_nan())` / `vec2f(_gpu_nan())`)
 * for a vector-valued one. GLSL has no implicit float→vecN conversion in a
 * ternary, so a masked (`When`/`Which` else) branch whose value is a tuple
 * body (a restricted parametric `(x(t), y(t))`) must emit a NaN of the same
 * component count or the driver rejects the shader (Tycho item 49). WGSL's
 * `select` likewise requires both operands to share one type.
 */
export function gpuNaNFor(
  val: Expression | null,
  target?: CompileTarget<Expression>
): string {
  const n = gpuComponentCount(val);
  if (n === undefined) return gpuNaN(target);
  const ctor = target?.language === 'wgsl' ? `vec${n}f` : `vec${n}`;
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
 *    element lowering is declared with scalar `float`/`f32` parameters, so
 *    `_gpu_sinc` of a `vec3` is source no driver accepts. The `_gpu_` prefix
 *    IS the property being tested. (A few helpers ARE aggregate-aware — the
 *    complex arithmetic and the colour converters take `vec2`/`vec3`, and the
 *    integer power has a per-width overload family, `_gpu_powi2`–`_gpu_powi4`
 *    — which is why the generic gate `gpuCheckOperandShapes` consults the
 *    emitted DECLARATION, `gpuHelperIsScalarOnly`, before reusing this
 *    verdict.)
 *  - a COMPARISON or a TERNARY (`Argument(x)` → `((x >= 0.0) ? 0.0 : π)`):
 *    GLSL has no `vecN >= float`, and both languages require a scalar `bool`
 *    condition, so there is no componentwise reading of either.
 *  - a lowering that DROPS the operand (`Imaginary(x)` → `0.0` for a real
 *    `x`): the result is a scalar where the caller is owed a `vecN`, which is
 *    a silent SHAPE error rather than a driver error.
 *
 * The last two are only decidable when the caller can name the operand's own
 * compiled source (`vector`) — i.e. on the fan-out route, where the WHOLE
 * emission derives from the element lowering. A caller with no such handle
 * (the generic gate, which sees a lowering over several independently
 * compiled operands) passes none, and gets the helper verdict alone: there,
 * a comparison may perfectly well be over an unrelated scalar operand
 * (`ContrastingColor` → `(_gpu_apca(…) > 50.0) ? … : …`).
 */
export function gpuIsComponentwise(
  code: string,
  vector?: string
): string | undefined {
  const helper = /_gpu_[A-Za-z0-9_]+\s*\(/.exec(code);
  if (helper !== null)
    return (
      `it calls the preamble helper \`${helper[0].slice(0, -1).trim()}\`, ` +
      `which is declared with scalar float/f32 parameters.`
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
 * width), a `matN`, or an array (`float[N]` / `array<f32, N>`).
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
  period: number
): Expression | undefined {
  if (x === null) return undefined;
  const u = BaseCompiler.piMultiple(x);
  return u !== undefined && gpuOperandShape(u) === 'scalar'
    ? gpuReduceTrigOffset(u, period, false)
    : undefined;
}

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
  period: number
): Expression | undefined {
  if (x === null) return undefined;
  const u = BaseCompiler.imaginaryPiMultiple(x);
  return u !== undefined && gpuOperandShape(u) === 'scalar'
    ? gpuReduceTrigOffset(u, period, false)
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

/** How `gpuCheckOperandShapes` names a shape in a diagnostic. */
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
 * lowering emits its plain form and `gpuCheckOperandShapes` reports the fault
 * with the diagnostic it owns — a lowering that guessed a width here would
 * turn a clean decline into invalid source.
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
 * for all their arguments; neither GLSL nor WGSL promotes a scalar argument to
 * the vector of its neighbours, so the promotion has to be written out.
 * `vec3(y)` is the broadcast constructor of both languages — every component
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
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  if (width === undefined || gpuOperandShape(expr) !== 'scalar')
    return compile(expr);
  return `${gpuFVec(width, target)}(${compile(expr)})`;
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
 * A WGSL type TEMPLATE — the type keyword and its opening angle bracket
 * (`array<`, `vec3<`, `mat2x2<`, `atomic<`, `ptr<`). GLSL has no such
 * spelling, so one pattern serves both languages.
 *
 * Sticky, and used only with `lastIndex` set immediately before each test, so
 * it carries no state between calls.
 */
const GPU_TYPE_TEMPLATE =
  /(?:array|[iub]?vec[234]|mat[234]x[234]|atomic|ptr)\s*</y;

/**
 * The callee and top-level argument count of `code` when the WHOLE emission is
 * a single call. `undefined` for an infix/compound emission (`a + b`,
 * `(c ? a : b)`, `log(a) / log(10.0)`), which is what tells the gate below
 * that no single builtin signature governs the operand shapes.
 *
 * The argument count is what distinguishes a lowering that passes its operands
 * THROUGH (`_gpu_powi(x, n)`, one argument per operand) from one that
 * DESTRUCTURES a collection operand into scalars (`Median([1,5,3,2,4])` →
 * `_gpu_median_5(1.0, 5.0, 3.0, 2.0, 4.0)`, five arguments for one operand) —
 * a reduction the shape gate must leave alone.
 *
 * `operands` are those arguments' own sources, which is what lets a reduction
 * read the components back out of an aggregate CONSTRUCTOR
 * (`gpuScalarComponents`).
 */
export function gpuTopLevelCall(
  code: string
): { callee: string; argCount: number; operands: string[] } | undefined {
  const s = code.trim();
  // `sin`, `_gpu_powi`, `vec3f`, `mat2x2f`, `float[5]`, `array<f32, 5>`
  const m = /^([A-Za-z_]\w*(?:\s*<[^<>()]*>)?(?:\s*\[\d+\])?)\s*\(/.exec(s);
  if (m === null) return undefined;
  let depth = 0;
  let start = m[0].length;
  const operands: string[] = [];
  for (let i = m[0].length - 1; i < s.length; i++) {
    // A WGSL type template carries a COMMA of its own: an `array<f32, 5>(…)`
    // argument used to split into `array<f32` and `5>(…)`, so the argument
    // count came out one too high and every check keyed to it (the one-for-one
    // tests in `gpuCheckOperandShapes`) silently stepped aside — which let an
    // array operand of a scalar-only helper through as invalid source. Skip
    // past the matching `>`. Anchored on the type KEYWORD at a token start, so
    // a `<` that is a less-than inside a comparison operand is untouched.
    if (i === 0 || !/[\w$]/.test(s[i - 1])) {
      GPU_TYPE_TEMPLATE.lastIndex = i;
      if (GPU_TYPE_TEMPLATE.test(s)) {
        let angle = 1;
        let j = GPU_TYPE_TEMPLATE.lastIndex;
        for (; j < s.length && angle > 0; j++) {
          if (s[j] === '<') angle++;
          else if (s[j] === '>') angle--;
        }
        if (angle > 0) return undefined;
        i = j - 1;
        continue;
      }
    }
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
 * Is the preamble helper `name` declared with SCALAR parameters only?
 *
 * Read off the declaration the target itself emits for it, rather than
 * assumed: most helpers are scalar (`float _gpu_powi(float x, float n)`), but
 * the complex arithmetic takes `vec2` and the colour converters take `vec3`,
 * and handing those an aggregate is exactly what they are for.
 *
 * A helper with no declaration in the preamble answers `false` (permissive) —
 * the gate then leaves the call alone rather than declining a lowering it
 * cannot see.
 */
function gpuHelperIsScalarOnly(name: string, preamble: string): boolean {
  // GLSL: `float _gpu_powi(float x, float n) {`
  // WGSL: `fn _gpu_powi(x: f32, n: f32) -> f32 {`
  // Anchored to a declaration (a return type or `fn` at the head of a line) so
  // a CALL of the same helper inside another body cannot be read as one.
  const decl = new RegExp(
    `(?:^|\\n)[^\\S\\n]*(?:fn[^\\S\\n]+|[A-Za-z_]\\w*(?:\\[\\d+\\])?[^\\S\\n]+)` +
      `${name}[^\\S\\n]*\\(([^)]*)\\)`
  ).exec(preamble);
  if (decl === null) return false;
  return !/[iub]?vec[234]|mat[234]|array\s*<|\[\s*\d+\s*\]/.test(decl[1]);
}

/**
 * The shader builtins that REDUCE an aggregate argument to a scalar result —
 * a fact of both languages' specifications, in the same way the entries of
 * `GPUShapeRules` are, not a list of CE heads. `dot`, `length` and `distance`
 * are declared over the genType and return `float`/`f32`; `determinant` takes
 * a `matN` and returns one scalar; `any` and `all` reduce a `bvecN` to a
 * `bool`. Both languages spell all six the same way, so one table serves both.
 *
 * An aggregate CONSTRUCTOR standing inside one of these calls is consumed by
 * it: what reaches the enclosing slot is the scalar the call returns, not the
 * vector the constructor built.
 */
const GPU_SCALAR_REDUCING_BUILTINS = [
  'dot',
  'length',
  'distance',
  'determinant',
  'any',
  'all',
] as const;

/**
 * `code` with every scalar-reducing builtin call (`GPU_SCALAR_REDUCING_BUILTINS`)
 * replaced by a scalar literal — `dot(vec3(x, y, z), vec3(1.0, 2.0, 3.0)) + 1.0`
 * becomes `0.0 + 1.0`.
 *
 * Used before scanning a slot for an aggregate value. A constructor consumed
 * by `dot`, for example, does not make the enclosing slot aggregate-valued.
 * Replacing the outermost reduction also removes constructors nested inside it.
 */
function gpuWithoutScalarReductions(code: string): string {
  const head = new RegExp(
    `\\b(?:${GPU_SCALAR_REDUCING_BUILTINS.join('|')})\\s*\\(`,
    'g'
  );
  let out = '';
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = head.exec(code)) !== null) {
    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    // Unbalanced (a source shape this scanner does not understand): leave the
    // remainder as it stands rather than guess at where the call ends.
    if (end < 0) break;
    out += code.slice(cursor, m.index) + '0.0';
    cursor = end + 1;
    head.lastIndex = cursor;
  }
  return out + code.slice(cursor);
}

/**
 * A VECTOR constructor in `code` with another aggregate constructor STANDING IN
 * one of its slots — `length(vec2(vec3(…), vec3(…)))`, `length(vec2(float[1](3.0),
 * 4.0))` — or `undefined` when there is none.
 *
 * Such a lowering RESHAPES its operands (it packs them into a vector) instead
 * of acting on them componentwise, so it is only correct for the scalar
 * operands it was written for: `Hypot(x, y)` → `length(vec2(x, y))` is
 * `√(x²+y²)` for scalars, but `vec2(vec3, vec3)` is not source a driver
 * accepts, and the element-wise hypotenuse it was asked for is not what it
 * would mean. Only `vecN(` heads are scanned — a `matN(` constructor takes
 * `vecN` columns BY DESIGN, and the aggregate constructors are exempt from the
 * gate entirely (they build a shape rather than consume one).
 *
 * What stands in a slot is judged after the scalar-reducing calls are removed
 * (`gpuWithoutScalarReductions`): `dot(vec2(dot(vec3(…), vec3(…)), 0.0),
 * vec2(…))` — a 2-D inner product one of whose components is a 3-D one —
 * packs a `float` and a `float` into its `vec2`, which is exactly what a
 * `vec2` has room for. Every `vecN(` in the source is still visited, so an
 * aggregate genuinely standing in a slot INSIDE a reduction
 * (`dot(vec2(vec3(…), 0.0), …)`) is still caught by that constructor's own
 * turn in the loop.
 */
function gpuReshapesOperands(code: string): string | undefined {
  const ctor = /\b([iub]?vec[234][fhiu]?)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = ctor.exec(code)) !== null) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) {
        const inner = gpuWithoutScalarReductions(
          code.slice(m.index + m[0].length, i)
        );
        const nested =
          /\b(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32)\s*\[)/.exec(
            inner
          );
        if (nested !== null)
          return (
            `it packs its operands into a \`${m[1]}\` constructor, which ` +
            `has no room for the aggregate \`${nested[0].trim()}\` value ` +
            `standing in each slot.`
          );
        break;
      }
    }
  }
  return undefined;
}

/**
 * Per-language shape rules for `gpuCheckOperandShapes`. GLSL and WGSL agree on
 * the broad strokes — the builtins and the arithmetic operators are
 * genType-polymorphic — but not on where a SCALAR may stand in for a `vecN`,
 * so each target supplies its own table (see `GPUShaderTarget.getShapeRules`).
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
   * `atan(vec3, float)` and `pow(float, vec3)` are not valid source in either
   * language.
   *
   * These are shader BUILTIN names — a fact of each language's specification,
   * not a list of CE heads — so tabulating them is what keeps the two
   * languages' genuinely different overload sets apart.
   */
  readonly scalarGenTypeSlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Shader builtins with an argument that is ALWAYS a scalar — an OBLIGATION,
   * where `scalarGenTypeSlots` records a PERMISSION.
   *
   * The distinction is the overload SET, not the presence of a scalar-tailed
   * signature. `mix` is declared BOTH `mix(genType, genType, float)` AND
   * `mix(genType, genType, genType)`, so its third argument MAY be a scalar;
   * `refract` is declared ONLY `refract(genType I, genType N, float eta)`
   * (GLSL ES 3.00 §8.4 / GLSL 4.60 §8.5 / WGSL §17.5, `refract(e1: vecN<T>,
   * e2: vecN<T>, e3: T)`), so its third argument MUST be one. Every other
   * builtin in `scalarGenTypeSlots` — `min`, `max`, `clamp`, `step`,
   * `smoothstep`, `mod` — has a matched all-genType overload alongside its
   * scalar-tailed one, so none of them belongs here.
   *
   * Check this independently of `scalarGenTypeSlots`, including when no
   * operand is a scalar: `refract(vec3, vec3, vec3)` has no overload at all,
   * but the permission table is only consulted once a scalar is present, so an
   * all-vector call must be declined.
   */
  readonly mandatoryScalarSlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Shader builtins with an argument that is ALWAYS a `vecN` — the mirror of
   * `mandatoryScalarSlots`, and the other obligation an ALL-SCALAR call can
   * fail.
   *
   * GLSL declares its geometric functions over the genType, which INCLUDES
   * `float`: `refract(float, float, float)`, `dot(float, float)` and
   * `normalize(float)` are all valid GLSL (§8.4 / §8.5 — "genType" is
   * `float`, `vec2`, `vec3`, `vec4`). WGSL does not: `refract(e1: vecN<T>,
   * e2: vecN<T>, e3: T)`, `dot(e1: vecN<T>, e2: vecN<T>)`,
   * `faceForward(e1: vecN<T>, e2: vecN<T>, e3: vecN<T>)`,
   * `normalize(e: vecN<T>)` and `reflect(e1: vecN<T>, e2: vecN<T>)` (§17.5)
   * have no all-scalar form at all, so `refract(1.0, 2.0, 0.5)` — perfectly
   * good GLSL — is source no WebGPU driver accepts. `cross` is narrower still
   * and vector-only in BOTH languages (`vec3` only). `length` and `distance`
   * are declared over both a scalar and a `vecN` in either language and are
   * therefore absent.
   *
   * The all-scalar case is exactly the one the rest of the gate never sees: it
   * returns early on operands that are all scalars, which is why this check
   * runs first.
   */
  readonly vectorOnlySlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Does the arithmetic operator `sym` accept a `matN` operand? `allMatrix` is
   * true when EVERY operand is a matrix (`mat2 * mat2`, `mat2 + mat2`) and
   * false when a scalar is mixed in (`mat2 * 2.0`). Admissibility of the
   * KIND pairing only — the dimension constraints (same size under the
   * componentwise operators, agreeing sizes under `*`) are language-shared
   * facts checked by the gate itself.
   */
  matrixArithmetic(sym: string, allMatrix: boolean): boolean;
  /**
   * Does the language define unary negation on a `matN`? GLSL does — its
   * unary operators "operate on integer or floating-point values (including
   * vectors and matrices)" (GLSL 4.60 §5.9) — but WGSL's negation (§8.7,
   * "Unary arithmetic expressions") is declared over scalars and `vecN` only,
   * so `-mat2x2f(…)` is not valid WGSL source.
   */
  readonly matrixNegate: boolean;
};

/**
 * The GPU targets' extension of `CompileTarget`: the language's own shape
 * rules, carried on the target so a LOWERING — not just the generic gate —
 * can judge the calls it generates against the same table
 * (`foldNaryBuiltin`). Written once by `createTarget()`; a hand-rolled target
 * that never went through it simply has none, and those lowerings then fall
 * back on the generic gate alone.
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

/**
 * Lowerings that CONSUME their aggregate operands — destructuring a collection
 * into scalars and combining those — rather than handing the aggregate to a
 * componentwise builtin. The `Max`/`Min` reduction (`compileGPUExtremum`),
 * `Median`'s sorting network and `Variance`'s inline mean/deviation sum are
 * the three. The original operand shapes are absent from the final emission,
 * so judging the emission against them would decline a
 * perfectly good reduction.
 *
 * The capability is declared at the handler's own definition site
 * (`markAggregateConsuming`) — never a table of CE head names kept elsewhere,
 * and never inferred from the shape of the emitted source. This prevents an
 * ordinary compound lowering such as WGSL's `Mod` from being mistaken for an
 * aggregate-consuming one.
 *
 * The value is a PREDICATE over the operands, not a flag, because a handler
 * that destructures a LITERAL collection still passes scalar operands straight
 * through in its other form: `Variance([1,2,3,4,5])` consumes an aggregate,
 * `Variance(v, w)` does not, and only the first should step the gate aside.
 */
const GPU_AGGREGATE_CONSUMING = new WeakMap<
  object,
  (args: ReadonlyArray<Expression>) => boolean
>();

/**
 * Is the operand of a `Norm` call a point literal with a broadcasting
 * component? The `Norm` lowering compiles such a point as its explicit norm
 * (`explicitBroadcastPointNorm`), so it consumes the point operand.
 */
export function isBroadcastPointNormOperand(
  args: ReadonlyArray<Expression>
): boolean {
  const arg = args[0];
  return (
    args.length === 1 &&
    arg !== undefined &&
    (isFunction(arg, 'Tuple') || isFunction(arg, 'PointList')) &&
    pointHasBroadcastComponent(arg)
  );
}

/**
 * Declare `fn` an aggregate-consuming lowering for the calls `when` accepts
 * (every call, by default) — see `GPU_AGGREGATE_CONSUMING`.
 */
export function markAggregateConsuming<T extends CompiledFunction<Expression>>(
  fn: T,
  when: (args: ReadonlyArray<Expression>) => boolean = () => true
): T {
  if (typeof fn === 'function') GPU_AGGREGATE_CONSUMING.set(fn, when);
  return fn;
}

/**
 * Lowerings that, in one of their forms, leave an operand out of the emitted
 * call because a peephole has absorbed it. GLSL's and WGSL's `Mod(a, 1)` emit
 * `fract(a)` (the divisor 1 is absorbed), and `Power(2, y)` emits `exp2(y)`
 * (the base 2 is absorbed). The emitted call then has fewer arguments than
 * the head has operands, and judging it against all of the operand shapes
 * gives a false decline for a `vecN` operand: `fract(v)` beside a scalar
 * divisor read as a `vecN` and a scalar given to a builtin that requires
 * matching genTypes. So these peepholes applied to scalar operands only.
 *
 * The value is a function of the operands and of the emitted source. It
 * answers the 0-based positions of the operands the emission left out, or
 * `undefined` when the emission is not the form that leaves them out (the
 * same head can emit `mod(a, 2.0)`, or the exact form of a sine hash). The
 * shape check then judges the emission against the other operands only, so a
 * `matN` or an array dividend of `fract` still declines. Declared with
 * `markOperandConsuming` next to the table that defines the lowering, never
 * inferred from the head name alone. CE-254.
 */
const GPU_OPERAND_CONSUMING = new WeakMap<
  object,
  (
    args: ReadonlyArray<Expression>,
    code: string
  ) => ReadonlySet<number> | undefined
>();

/**
 * Declare that `fn` leaves out the operands `consumed` answers — see
 * `GPU_OPERAND_CONSUMING`.
 */
export function markOperandConsuming<T extends CompiledFunction<Expression>>(
  fn: T,
  consumed: (
    args: ReadonlyArray<Expression>,
    code: string
  ) => ReadonlySet<number> | undefined
): T {
  if (typeof fn === 'function') GPU_OPERAND_CONSUMING.set(fn, consumed);
  return fn;
}

/**
 * The `consumed` predicate of a peephole that emits the ONE-argument builtin
 * `callee` in place of a two-operand head and leaves out operand `slot` when
 * that operand is the constant `value`: `Mod(a, 1)` → `fract(a)` is
 * `gpuAbsorbedConstant('fract', 1, 1)`, `Power(2, y)` → `exp2(y)` is
 * `gpuAbsorbedConstant('exp2', 0, 2)`.
 */
export function gpuAbsorbedConstant(
  callee: string,
  slot: number,
  value: number
): (
  args: ReadonlyArray<Expression>,
  code: string
) => ReadonlySet<number> | undefined {
  return (args, code) => {
    const operand = args[slot];
    if (args.length !== 2 || operand === null || operand === undefined)
      return undefined;
    if (tryGetConstant(operand) !== value) return undefined;
    const call = gpuTopLevelCall(code);
    if (call?.callee !== callee || call.argCount !== 1) return undefined;
    return new Set([slot]);
  };
}

/**
 * `Median` and `Variance` destructure a SINGLE `List` operand into its
 * elements; given N scalar arguments instead they use them one for one, and
 * the gate must go on judging that form.
 */
export const gpuDestructuresListOperand = (
  args: ReadonlyArray<Expression>
): boolean => args.length === 1 && isFunction(args[0], 'List');

/**
 * Is this the COLLECTION (reduce) form of `Sum`/`Product` — one operand, no
 * indexing set? That form destructures its operand into scalar components; the
 * indexed form (body plus `Limits`) does not.
 */
export const gpuIsCollectionReduceForm = (
  args: ReadonlyArray<Expression>
): boolean => args.length === 1;

/** `{1}` → "in argument 2"; `{1, 2}` → "in arguments 2 and 3". */
export function gpuSlotNames(slots: ReadonlySet<number>): string {
  const ns = [...slots].sort((a, b) => a - b).map((n) => `${n + 1}`);
  if (ns.length === 0) return 'nowhere';
  if (ns.length === 1) return `in argument ${ns[0]}`;
  return `in arguments ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * Does this emitted argument source read as a `vecN` VALUE?
 *
 * Source-level, and deliberately conservative. Once a lowering has folded
 * several operands into NESTED calls (`ElementMax(a, b, c)` →
 * `max(max(a, b), c)`) the CE operand positions no longer line up with the
 * emitted argument positions, so the call tree is all there is to judge. A
 * vector is recognized as an aggregate CONSTRUCTOR, or as a genType-polymorphic
 * builtin call (one carrying scalar-slot rules) over a vector. Everything else
 * — including a bare identifier declared `vector<3>` — reads as a scalar, so an
 * argument list with no recognizable vector is left alone rather than judged on
 * a guess. (The one-for-one case is judged on the CE operand shapes instead,
 * which ARE exact; see `gpuCheckOperandShapes`.)
 */
function gpuSourceIsVector(
  code: string,
  slots: ReadonlyMap<string, ReadonlySet<number>>
): boolean {
  const call = gpuTopLevelCall(code);
  if (call === undefined) return false;
  // An ARRAY of vectors — `vec2[2](…)`, `array<vec2f, 2>(…)`, the lowering
  // of a written list of points — is not a vector value, though its callee
  // starts like one.
  if (GPU_AGGREGATE_CONSTRUCTOR.test(call.callee))
    return !GPU_VECTOR_ARRAY_CONSTRUCTOR.test(call.callee);
  if (!slots.has(call.callee)) return false;
  return call.operands.some((o) => gpuSourceIsVector(o, slots));
}

/**
 * The width of the float vector an emitted argument source CONSTRUCTS, or
 * `undefined` when it constructs none.
 *
 * A lowering may widen a scalar operand ITSELF, writing out the broadcast
 * constructor neither shader language supplies for a genType builtin: `Power`
 * over a `vecN` base and a scalar exponent emits `pow(v, vec3(y))`. The CE
 * operand is still a scalar there, so `gpuCheckOperandShapes` reads the
 * emitted argument to see the shape that actually reaches the call.
 *
 * Deliberately narrow — only a top-level `vecN` / `vecNf` constructor is read.
 * Everything else answers `undefined`, and the gate then keeps the shape the
 * CE operand gives it, so a source this cannot read never weakens a check.
 */
function gpuConstructedVectorWidth(
  code: string | undefined
): 2 | 3 | 4 | undefined {
  if (code === undefined) return undefined;
  const call = gpuTopLevelCall(code);
  if (call === undefined) return undefined;
  const m = /^vec([234])f?$/.exec(call.callee);
  return m === null ? undefined : (Number(m[1]) as 2 | 3 | 4);
}

/**
 * A scalar argument standing where the emitted builtin's overload requires the
 * `vecN` genType, anywhere in the emitted call TREE — or `undefined` when there
 * is none.
 *
 * The counterpart of the one-for-one positional check in
 * `gpuCheckOperandShapes`, for a lowering that does NOT pass its operands
 * through: a fold `max(max(vec3(…), vec3(…)), 2.0)` is valid GLSL, while
 * `max(max(2.0, vec3(…)), vec3(…))` puts the scalar first in its INNER call,
 * where GLSL's `max(genType, float)` has no overload. `foldNaryBuiltin` emits
 * such folds; `ElementMax`/`ElementMin` reach it only for operand shapes that
 * have no NaN-safe helper (`compileGPUElementExtremum`).
 */
function gpuMisplacedScalarArgument(
  code: string,
  slots: ReadonlyMap<string, ReadonlySet<number>>
): string | undefined {
  const call = gpuTopLevelCall(code);
  if (call === undefined) return undefined;
  const allowed = slots.get(call.callee);
  if (allowed !== undefined) {
    const isVector = call.operands.map((o) => gpuSourceIsVector(o, slots));
    if (isVector.some((v) => v)) {
      const bad = isVector.findIndex((v, i) => !v && !allowed.has(i));
      if (bad >= 0)
        return (
          `the shader builtin \`${call.callee}\` takes a scalar only ` +
          `${gpuSlotNames(allowed)}, but the emitted call \`${code.trim()}\` ` +
          `has a scalar in argument ${bad + 1}, where the overload requires ` +
          `the \`vecN\` genType; the scalar is not promoted to a vector.`
        );
    }
  }
  for (const o of call.operands) {
    const why = gpuMisplacedScalarArgument(o, slots);
    if (why !== undefined) return why;
  }
  return undefined;
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
 * Reject a non-scalar operand when the emitted shader cannot accept its shape.
 *
 * The counterpart of `compileGPUBroadcastUnary` for every emission that does
 * not go through the fan-out hook: the generic function-codegen and
 * string-mapped-helper paths, which the base compiler splices directly. Reject
 * mixed generic types, arrays nested in vector constructors, and matrices
 * passed to scalar builtins before reporting success.
 *
 * Decisions are derived from the operands' shapes (`gpuOperandShape`) and
 * from the shape of the emitted source (`gpuTopLevelCall`,
 * `gpuIsComponentwise`), never from a list of head names: a head that changes
 * its lowering is re-judged on the new source. The one exception is DECLARED
 * rather than inferred — a lowering that consumes its aggregate operands
 * (`GPU_AGGREGATE_CONSUMING`) steps the gate aside, because the shapes it was
 * handed are no longer in its emission. A complex operand reads as a scalar
 * here, so no shape test can tell that a real-only lowering received one: the
 * base compiler refuses that case before the lowering runs
 * (`gpuIsRealOnlyLowering`, read through `BaseCompiler.isRealOnlyLowering`).
 */
export function gpuCheckOperandShapes(
  head: string,
  args: ReadonlyArray<Expression>,
  code: string,
  rules: GPUShapeRules,
  preambleFor: (code: string) => string,
  lowering?: CompiledFunction<Expression>
): void {
  const shapes = args.map(gpuOperandShape);

  // A lowering that destructured its aggregate operands (`Max`/`Min`, whose
  // reduction folds every collection down to one scalar) has an emission the
  // operand shapes no longer describe. It says so explicitly, at its own
  // definition site; nothing about the shape of its emitted source is read as
  // that claim.
  if (typeof lowering === 'function') {
    const consumes = GPU_AGGREGATE_CONSUMING.get(lowering);
    if (consumes?.(args) === true) return;
    // A peephole that left an operand out of its emission is judged against
    // the operands it emitted (`GPU_OPERAND_CONSUMING`).
    const consumed = GPU_OPERAND_CONSUMING.get(lowering)?.(args, code);
    if (consumed !== undefined && consumed.size > 0)
      return gpuCheckOperandShapes(
        head,
        args.filter((_, i) => !consumed.has(i)),
        code,
        rules,
        preambleFor
      );
  }

  // Annotated (rather than inferred) so a `decline(…)` call narrows what
  // follows it: the positional check below reads a rule the preceding
  // `decline` has already ruled out as absent.
  const decline: (reason: string) => never = (reason) => {
    throw new Error(`Could not compile \`${head}\`: ${reason}`);
  };

  // A slot with no SCALAR overload at all — the mirror of
  // `mandatoryScalarSlots`, and the only fault an ALL-SCALAR call can have.
  // WGSL declares `refract(e1: vecN<T>, e2: vecN<T>, e3: T)` and no all-scalar
  // form, where GLSL's genType includes `float`, so `Refract(1, 2, 0.5)`
  // emitted `refract(1.0, 2.0, 0.5)` — good GLSL, and source no WebGPU driver
  // accepts. Positional, so it needs the lowering to pass its operands through
  // one for one; and only SCALARS are judged here, because a `matN` or array
  // in such a slot gets a more specific verdict from the branches below.
  const topCall = gpuTopLevelCall(code);
  const declineVectorOnly = (): void => {
    if (topCall === undefined || topCall.argCount !== args.length) return;
    const vectorOnly = rules.vectorOnlySlots.get(topCall.callee);
    if (vectorOnly === undefined) return;
    const bad = shapes.findIndex((s, i) => vectorOnly.has(i) && s === 'scalar');
    if (bad >= 0)
      decline(
        `the shader builtin \`${topCall.callee}\` is declared over the ` +
          `\`vecN\` genType ${gpuSlotNames(vectorOnly)} in this language — it ` +
          `has no scalar overload there — but argument ${bad + 1} lowers to a ` +
          `scalar; the scalar is not promoted to a vector.`
      );
  };

  // Nothing but scalars: the overwhelmingly common case, left untouched apart
  // from the vector-only obligations, which are exactly the rule that a call
  // with no non-scalar operand anywhere can still break.
  if (shapes.every((s) => s === 'scalar')) {
    declineVectorOnly();
    return;
  }

  const widths = new Set(
    shapes.filter((s): s is 2 | 3 | 4 => typeof s === 'number')
  );
  const declineWidths = (): void => {
    if (widths.size > 1)
      decline(
        `its operands lower to shader vectors of different widths ` +
          `(${[...widths].map((w) => `vec${w}`).join(', ')}); the ` +
          `componentwise builtins and operators require ONE genType.`
      );
  };
  const hasMatrix = shapes.includes('matrix');
  const hasArray = shapes.includes('array');
  const call = topCall;

  if (call === undefined) {
    // Not a single call: an infix operator emission or a compound lowering
    // lowering (WGSL's `Mod` → `(((a % b) - b * floor((a % b) / b)) % b)`,
    // `Log10` → `log(a) / log(10.0)`). Aggregate-consuming lowerings have already
    // returned above through an explicit capability. Other compound lowerings
    // still need array, matrix, and vector-width checks.
    const sym = GPU_OPERATORS[head]?.[0];
    if (sym === undefined || !/^[-+*/]$/.test(sym)) {
      // An emission that COMBINES nothing constrains nothing: a lowering that
      // passes ONE operand through (`Real(m)` → `m`, `WithRandomSeed(m, s)` →
      // the body) or answers a constant (`Imaginary(x)` → `0.0`) says nothing
      // about the shapes of the operands it did not use, and judging it
      // against all of them is a false decline.
      if (gpuIsAtomicEmission(code)) return;
      // No ONE signature governs a compound emission, but its pieces are the
      // same genType-polymorphic builtins and operators, which require ONE
      // genType across the whole expression and have no `matN` or array
      // reading at all. (A scalar mixed with same-width vectors stays
      // admissible: the arithmetic operators broadcast it in both languages,
      // and a compound lowering is built from those.)
      if (hasArray || hasMatrix)
        decline(
          `the compound shader lowering \`${code}\` is built from the ` +
            `genType-polymorphic builtins and operators, which have no ` +
            `${hasMatrix ? '`matN`' : 'array'} reading, so the operand ` +
            `shapes (${shapes.map(gpuShapeName).join(', ')}) have no lowering.`
        );
      declineWidths();
      const packs = gpuReshapesOperands(code);
      if (packs !== undefined)
        decline(
          `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
            `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${packs}`
        );
      return;
    }
    if (hasArray)
      decline(
        `an operand lowers to a shader ARRAY (\`float[N]\` / ` +
          `\`array<f32, N>\`), which has no arithmetic operators — only ` +
          `scalars, \`vecN\` and \`matN\` values do.`
      );
    if (!hasMatrix) {
      declineWidths();
      // A scalar mixed with (same-width) vectors is valid in BOTH languages
      // under every arithmetic operator: GLSL 4.60 §5.9 ("one operand is a
      // scalar, and the other is a vector or matrix"), WGSL §8.7 ("Binary
      // arithmetic expressions with mixed scalar and vector operands", which
      // lists `+ - * / %` in both orders).
      return;
    }

    // A matrix operand enters infix arithmetic only through its NATIVE shader
    // form: the square `matN` (N = 2–4) the `Matrix` lowering emits, or — for
    // an N×1 column `Matrix` literal — the `vecN` it flattens to
    // (`compileGPUMatrix`). Everything else (non-square, 5+ rows, unknown
    // dimensions) lowers to nested arrays, which have no operators. And the
    // DIMENSIONS matter, not just the kind: `mat2 + mat3` and `mat2 * vec3`
    // are as invalid as `vec2 + vec3`.
    const eff: Array<number | 'scalar' | { mat: number }> = [];
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      if (s !== 'matrix') {
        eff.push(s as number | 'scalar');
        continue;
      }
      const dims = gpuMatrixDims(args[i]);
      if (
        dims !== undefined &&
        dims[1] === 1 &&
        dims[0] >= 2 &&
        dims[0] <= 4 &&
        isFunction(args[i], 'Matrix')
      ) {
        eff.push(dims[0]);
        continue;
      }
      if (
        dims === undefined ||
        dims[0] !== dims[1] ||
        dims[0] < 2 ||
        dims[0] > 4
      )
        decline(
          `its operand \`${args[i].toString()}\` lowers to a matrix with no ` +
            `native square \`matN\` (N = 2–4) shader type` +
            (dims !== undefined
              ? ` (its dimensions are ${dims[0]}×${dims[1]})`
              : ` (its dimensions are not statically known)`) +
            `, so the shader operator \`${sym}\` has no overload for it.`
        );
      eff.push({ mat: dims[0] });
    }
    const effName = (e: number | 'scalar' | { mat: number }): string =>
      typeof e === 'number' ? `vec${e}` : e === 'scalar' ? e : `mat${e.mat}`;
    const shapeList = `(${eff.map(effName).join(', ')})`;
    // The single size every non-scalar operand must share: with only SQUARE
    // native matrices, the componentwise same-genType rule, the matrix
    // same-dimensions rule and the `*` inner-dimension rule (`matCxR * vecC`,
    // `vecR * matCxR`, `matKxR * matCxK`) all collapse to one size.
    const sizes = new Set<number>(
      eff.flatMap((e) =>
        e === 'scalar' ? [] : [typeof e === 'number' ? e : e.mat]
      )
    );
    if (!eff.some((e) => typeof e === 'object')) {
      // Every matrix was an N×1 column literal: plain vector arithmetic.
      if (sizes.size > 1)
        decline(
          `its operands lower to shader vectors of different widths ` +
            `${shapeList}; the componentwise operators require ONE genType.`
        );
      return;
    }
    if (args.length === 1) {
      // Unary negation of a matrix — the one arity where the two languages
      // split on the KIND itself (see `GPUShapeRules.matrixNegate`).
      if (!rules.matrixNegate)
        decline(
          `the shader unary \`-\` is declared over scalars and \`vecN\` ` +
            `only in this language; it has no overload for the ` +
            `${effName(eff[0])} operand.`
        );
      return;
    }
    if (sym !== '*') {
      if (eff.some((e) => typeof e === 'number'))
        decline(
          `a \`matN\` and a \`vecN\` operand combine only under \`*\` ` +
            `(matrix-vector product), not \`${sym}\`.`
        );
      if (
        !rules.matrixArithmetic(
          sym,
          eff.every((e) => typeof e === 'object')
        )
      )
        decline(
          `the shader operator \`${sym}\` has no overload for the operand ` +
            `shapes ${shapeList}.`
        );
      if (sizes.size > 1)
        decline(
          `the componentwise \`${sym}\` requires matrices of the SAME ` +
            `dimensions, but the operand shapes are ${shapeList}.`
        );
      return;
    }
    // `*`: matrix-scalar scaling and the linear-algebraic products. The inner
    // dimensions must agree; with square `matN` types that is ONE size across
    // every non-scalar operand.
    if (sizes.size > 1)
      decline(
        `under \`*\` the matrix and vector dimensions must agree ` +
          `(\`matCxR * vecC\`, \`matKxR * matCxK\`), but the operand shapes ` +
          `${shapeList} do not.`
      );
    return;
  }

  const { callee, argCount } = call;

  // An aggregate constructor BUILDS a shape from its operands (`List`,
  // `Tuple`, `Matrix`); its own guards own that check.
  if (GPU_AGGREGATE_CONSTRUCTOR.test(callee)) return;

  // A preamble helper. The aggregate-aware ones (complex arithmetic, colour
  // conversion) own their operand shapes, so the gate steps aside; a
  // scalar-only one cannot take an aggregate — unless the lowering DESTRUCTURED
  // the collection into one scalar argument per element (`Median` →
  // `_gpu_median_5(…)`), which the argument count reveals.
  if (callee.startsWith('_gpu_')) {
    if (argCount !== args.length) return;
    // `${callee}(` — a synthetic CALL SITE, not the bare name. Every
    // `preambleFor` scan that generates a helper on demand (the `_gpu_atN`
    // positional accessors, the `_gpu_powiN` integer powers) is anchored on a
    // call parenthesis, so that a user symbol which merely SPELLS a helper
    // name cannot make the target declare one. A bare name reaches none of
    // those scans, and the gate would then judge a generated helper against
    // an empty preamble.
    if (!gpuHelperIsScalarOnly(callee, preambleFor(`${callee}(`))) return;
    const why = gpuIsComponentwise(code);
    if (why !== undefined)
      decline(
        `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
          `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${why}`
      );
    return;
  }

  if (hasMatrix || hasArray)
    decline(
      `the shader builtin \`${callee}\` is declared over scalar and \`vecN\` ` +
        `genTypes; it has no ${hasMatrix ? '`matN`' : 'array'} overload, so ` +
        `the operand shapes (${shapes.map(gpuShapeName).join(', ')}) have no ` +
        `lowering.`
    );
  declineWidths();
  const reshapes = gpuReshapesOperands(code);
  if (reshapes !== undefined)
    decline(
      `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
        `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${reshapes}`
    );
  // The shapes as they REACH the emitted call. A lowering is allowed to widen
  // a scalar operand itself, by writing out the broadcast constructor neither
  // language supplies (`Power` over a `vecN` base and a scalar exponent emits
  // `pow(v, vec3(y))`); the CE operand stays a scalar, but the argument that
  // stands in the call is a vector, so the mixed-genType checks below would
  // otherwise decline valid source. Only an UPGRADE is taken from the emitted
  // argument, and only where the lowering passes its operands through one for
  // one — a source that constructs no vector keeps its CE shape, so nothing
  // here can weaken a check.
  const emitted = shapes.map((s, i) => {
    if (s !== 'scalar' || argCount !== args.length) return s;
    return gpuConstructedVectorWidth(call.operands[i]) ?? s;
  });
  if (widths.size === 1 && emitted.includes('scalar')) {
    const slots = rules.scalarGenTypeSlots.get(callee);
    if (slots === undefined)
      decline(
        `the shader builtin \`${callee}\` requires MATCHING genType ` +
          `arguments, but it is applied to a vec${[...widths][0]} operand and ` +
          `a scalar one; the scalar is not promoted to a vector.`
      );
    // The overload says WHERE a scalar may stand, not merely that one may:
    // `mod(genType, float)` admits it only LAST, `step(float, genType)` only
    // FIRST, `mix(genType, genType, float)` only third. When the lowering
    // passes its operands through ONE FOR ONE the CE operand shapes give the
    // positions exactly — including for an operand with no constructor in its
    // source (a symbol declared `vector<3>`).
    if (argCount === args.length) {
      const bad = emitted.findIndex((s, i) => s === 'scalar' && !slots.has(i));
      if (bad >= 0)
        decline(
          `the shader builtin \`${callee}\` takes a scalar only ` +
            `${gpuSlotNames(slots)}, but here the scalar stands in argument ` +
            `${bad + 1}, where the overload requires the vec${
              [...widths][0]
            } genType; the scalar is not promoted to a vector.`
        );
    }
    // A lowering that does NOT pass its operands through (the variadic
    // `min`/`max` fold) is judged on the emitted call TREE, where each nested
    // call has its own argument positions.
    const misplaced = gpuMisplacedScalarArgument(
      code,
      rules.scalarGenTypeSlots
    );
    if (misplaced !== undefined) decline(misplaced);
  }
  // The OBLIGATIONS, last: a slot that must be scalar is violated by a `vecN`
  // standing in it, so — unlike everything above — this check does not depend
  // on a scalar being present anywhere, and is the only one an all-vector call
  // can fail. `refract(vec3, vec3, vec3)` is not a signature either language
  // declares, but the permission table above is consulted only once
  // `shapes.includes('scalar')`.
  // Positional, so it needs the lowering to pass its operands through one for
  // one; and reported after the permission verdict, which names the more
  // specific fault when a scalar is ALSO misplaced.
  const mandatory = rules.mandatoryScalarSlots.get(callee);
  if (mandatory !== undefined && argCount === args.length) {
    const bad = shapes.findIndex((s, i) => mandatory.has(i) && s !== 'scalar');
    if (bad >= 0)
      decline(
        `the shader builtin \`${callee}\` requires a SCALAR ` +
          `${gpuSlotNames(mandatory)} — that argument is not ` +
          `genType-polymorphic, so there is no overload with a ` +
          `${gpuShapeName(shapes[bad])} standing there — but argument ` +
          `${bad + 1} lowers to a ${gpuShapeName(shapes[bad])}.`
      );
  }
  // And the mirror obligation, for a scalar the checks above left standing (a
  // builtin whose permission table admits a scalar in a slot the language
  // nonetheless declares `vecN`). Defensive: with today's tables every mixed
  // scalar/`vecN` call already declines above, and the ALL-SCALAR calls — the
  // ones this rule exists for — returned before reaching here.
  declineVectorOnly();
}

/**
 * A new `CompileTarget.loweredSymbolType` hook for one shader target: the
 * shader type the emitted code reads the free symbol `symbol` as — the type
 * of the uniform the host must declare. A symbol read as a colour operand is
 * a `vec3`; otherwise the type is read from the same analysis that types the
 * parameters and return values of emitted functions (`gpuTypeOfValue`),
 * then a matrix (`mat2`, `mat3x2f`) or an array (`float[5]`,
 * `array<f32, 5>`). `undefined` when none of these apply.
 */
export function gpuLoweredSymbolTypeHook(
  isWGSL: boolean
): (symbol: Expression) => string | undefined {
  const colorReads = new Set<string>();
  const hook = (symbol: Expression): string | undefined => {
    if (isSymbol(symbol) && colorReads.has(symbol.symbol))
      return gpuVecType(3, isWGSL);
    const shape = gpuOperandShape(symbol);
    if (shape === 'matrix') {
      const dims = gpuMatrixDims(symbol);
      if (dims === undefined) return undefined;
      const [rows, cols] = dims;
      if (isWGSL) return `mat${cols}x${rows}f`;
      return rows === cols ? `mat${cols}` : `mat${cols}x${rows}`;
    }
    if (shape === 'array') {
      const t = gpuType(symbol);
      const n =
        typeof t !== 'string' && t.kind === 'list' && t.dimensions?.length === 1
          ? t.dimensions[0]
          : undefined;
      if (n === undefined || !(n > 0)) return undefined;
      return isWGSL ? `array<f32, ${n}>` : `float[${n}]`;
    }
    return gpuTypeOfValue(symbol, isWGSL);
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
  expr: Expression,
  isWGSL: boolean
): GPUValueType | { kind: 'matrix' | 'array'; spelling: string } | undefined {
  if (BaseCompiler.isComplexValued(expr)) return undefined;
  const isFloatScalar = (e: Expression): boolean => {
    const t = gpuCertainValueType(e, isWGSL);
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
        spelling: isWGSL ? `array<f32, ${rows}>` : `float[${rows}]`,
      };
    }
    // Another shape with 2 to 4 columns is written as an array of its rows
    // (`vec2[1](vec2(1.0, 2.0))` for a 1×2 `Matrix`).
    if (rows !== cols || rows > 4)
      return cols >= 2 && cols <= 4
        ? {
            kind: 'array',
            spelling: isWGSL
              ? `array<vec${cols}f, ${rows}>`
              : `vec${cols}[${rows}]`,
          }
        : undefined;
    return {
      kind: 'matrix',
      spelling: isWGSL ? `mat${cols}x${rows}f` : `mat${cols}`,
    };
  }
  if (op === 'Tuple' || op === 'List') {
    if (!expr.ops.every(isFloatScalar)) return undefined;
    const n = expr.nops;
    if (n >= 2 && n <= 4) return { element: 'f', width: n };
    return {
      kind: 'array',
      spelling: isWGSL ? `array<f32, ${n}>` : `float[${n}]`,
    };
  }
  if (GPU_SCALAR_ARITHMETIC.has(op))
    return expr.nops > 0 && expr.ops.every(isFloatScalar)
      ? { element: 'f', width: 1 }
      : undefined;
  if (GPU_SCALAR_PREDICATES.has(op))
    return expr.nops > 0 &&
      expr.ops.every((e) => {
        const t = gpuCertainValueType(e, isWGSL);
        return t !== undefined && 'element' in t && t.width === 1;
      })
      ? { element: 'b', width: 1 }
      : undefined;
  if (op === 'If' && expr.nops === 3) {
    const a = gpuCertainValueType(expr.ops[1], isWGSL);
    const b = gpuCertainValueType(expr.ops[2], isWGSL);
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
