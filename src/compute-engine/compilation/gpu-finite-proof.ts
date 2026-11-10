// The proof that a shader expression stays finite, and the names that the
// compiled code writes.

import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { functionResult } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  isFunction,
  isNumber,
  isSymbol,
  hasInferredType,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { definitionBodyExpr } from './compile-cse.js';
import {
  functionLiteralParameterName,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import {
  isOperatorDef,
  isValueDef,
} from '../boxed-expression/definition-guards.js';
import { gpuOperandShape } from './gpu-shapes.js';
import { exactRationalDivisor } from './compiler-type-facts.js';
import { isAmplifiedTrig } from './gpu-exact-trig.js';
import {
  absCompilesToPointNorm,
  absCompilesToPointListNorm,
} from './compiler-core.js';

/** The largest finite f32 value, 2¹²⁸ − 2¹⁰⁴. */
const GPU_F32_MAX = 3.4028234663852886e38;

/**
 * Is each value that `x` holds in the shader typed a finite real? A scalar
 * whose static type is a finite real, or a `vec2`–`vec4` operand
 * (`gpuOperandShape`) whose cells are: a vector of reals
 * (`vector<real^3>`, a written `[t, k, 1]` with `t` and `k` declared
 * `real`) or a tuple of reals of that width. A vector of `number` cells
 * (`vector<3>`) can hold NaN, and an array or a matrix has no componentwise
 * built-in.
 */
function gpuFiniteRealCells(x: Expression): boolean {
  const shape = gpuOperandShape(x);
  if (shape === 'scalar') return x.type.matches('finite_real');
  if (typeof shape !== 'number') return false;
  return (
    x.type.matches('list<finite_real>') ||
    x.type.matches(`tuple<${Array(shape).fill('finite_real').join(', ')}>`)
  );
}

/**
 * The heads whose value is finite in f32 when their operands are, and that
 * `gpuProvablyFinite` therefore accepts: their result does not grow past
 * the size of their operands, or is bounded (`sin`, `tanh`). A sum
 * (`Add`, `Subtract`, `Negate`), `Multiply`, `Divide`, `Mod` and `Power`
 * are not in this set: they have their own rule in `gpuFiniteProof`, which
 * reads the size of the operands, since a sum, a product or a quotient of
 * finite values can overflow f32. A head such as `Exp` or `Cosh` can
 * overflow to `+∞` in f32 where the interpreter's f64 value is finite:
 * `cosh(x) − sinh(x)` is typed `real`, and at `x = 100` it is `∞ − ∞` in
 * f32.
 */
const GPU_F32_BOUNDED_HEADS = new Set([
  'Sin',
  'Cos',
  'Tanh',
  'Arctan',
  'Abs',
  'Floor',
  'Ceil',
  'Round',
  'Truncate',
  'Fract',
  'Sign',
  'Clamp',
  'Min',
  'Max',
  'ElementMin',
  'ElementMax',
  'Smoothstep',
  'Random',
]);

/**
 * Is `x` finite for certain in the shader, so that a NaN-safe helper of it
 * (`gpuNaNSafeLibrary`) can be the built-in? The proof reads only what the
 * host declared and what the expression says: the declared types and
 * ranges of the inputs, the declared result types of the user functions,
 * the number literals and the operators of `x`, and, in the body of a user
 * function, the facts of its parameters (`CompileTarget.gpuParameterFacts`:
 * every call passes a value proven finite from these declarations, or the
 * host declared the parameter with a range). It does not read the body of
 * a user function that `x` calls. To get the built-in for such a call, the
 * host declares a result type with a range for the function
 * (`f: (real) -> real<-1..1>`). Four conditions:
 *
 * - its static type is a finite real, or it is a `vec2`–`vec4` whose cells
 *   are finite reals (`gpuFiniteRealCells`). The rules below then apply to
 *   each component: a written vector `[t, k, 1]` is finite when each of its
 *   components is, and arithmetic over vectors is componentwise. A scalar
 *   operand of another static type is proven from its parts alone: each
 *   symbol it reads must be a finite real by its own type or its value,
 *   each head must be one that the last condition accepts, and a constant
 *   subtree must have a real value. This is how an operand that divides by
 *   an operand that is not a literal is proven (its type holds `±∞` and
 *   NaN). A parameter of the body of an emitted user-function definition is
 *   typed `number` by the engine, also with a declared signature: it is
 *   proven by its facts (`gpuDefinitionParameterFacts`), not by its type.
 *   A call of a user function is finite when the host declared
 *   its result type with a range of finite bounds in the signature of the
 *   definition (`declaredUserCallBound` in `gpuFiniteProof`), and that
 *   range is the bound of its magnitude. A bare `real` result type is not
 *   enough, and neither is the range of the static type of the call, which
 *   comes from the body when the function is declared `function`;
 * - each symbol it reads has a DECLARED type (a symbol declared `real`
 *   holds a finite value). An inferred type is not a promise of the host: a
 *   parameter of `p(k) := cos(1.9k)` called with `0/0` is NaN, and a
 *   uniform (`vars: { a: 'a' }`) holds what the host passes. A
 *   symbol with a value is read through its value. When the shader computes
 *   that value in place of the symbol (no `vars` entry and no binder names
 *   it), the type of the symbol does not matter, and an inferred type is
 *   accepted: `c := 2.5` makes `sin(c + x)` the built-in `sin(2.5 + x)`. A
 *   symbol that the compiled code writes (`Assign`, `Declare`) is not
 *   finite by its declared type: the type holds for the value that the host
 *   passes, and `x ≔ exp(x)` is `+∞` in f32 for `x > 88.7`
 *   (`GPU_WRITTEN_NAMES`);
 * - it reads no name that the caller maps to its own source: `vars` can map
 *   `ExponentialE` to a run-time input, `functions` can map `Gamma` to code
 *   of the caller's, and the static type does not describe either. A name
 *   that `vars` maps to its own identifier (`{ T: 'T' }`, the way Tycho
 *   passes a uniform) is the exception: it is the host's input, of its
 *   declared type;
 * - it cannot overflow in f32. A value of unknown magnitude is a finite
 *   f32 value, which can be as large as 3.4·10³⁸; a value of known
 *   magnitude is a number literal, `sin`, `cos` or `tanh` of a real (at
 *   most 1), `arctan` of a real, `Random()`, a constant, a symbol that the
 *   shader reads as the host's input with a declared finite range
 *   (`k: real<0..10>`; the range in the static type of a compound
 *   expression is not read), a product of such values, a sum, difference
 *   or negation of such values (the sum of the bounds of the operands),
 *   `abs`, `min` or `max` of real scalar operands of known magnitude (the
 *   largest bound of the operands; `|(x, x)|` is a Euclidean norm and has
 *   no bound from this rule), `floor`, `ceil`, `round` or `trunc` of such a
 *   value (its bound plus 1), a fractional part (`fract`, at most 1), or a
 *   floored modulo `mod(a, d)` of such values (about the bound of `d`; at
 *   most 1 for `d = 1`, whatever `a`). Each head is in
 *   `GPU_F32_BOUNDED_HEADS`, or is one of these:
 *   - a product whose factors all have a known magnitude, and whose
 *     magnitudes multiply to at most half the largest f32, or a product of
 *     one factor of unknown magnitude and number literals of magnitude at
 *     most 1 (`0.5·x`, `x/3`) (`productStaysFinite`): `H·x` with
 *     `H: real<0..10³⁰>` and `x` declared `real` is `+∞` in f32 for
 *     `x ≥ 3.5·10⁸`, and `k·t` of two declared `real` symbols for
 *     `k = t = 10²⁰`, where the interpreter's f64 value is finite;
 *   - a sum whose terms have magnitudes that add up to at most half the
 *     largest f32, or one term of unknown magnitude beside terms whose
 *     magnitudes add up to at most 2¹⁰⁰ (`x + 1`) (`sumStaysFinite`):
 *     `R + Q` with `R, Q: real<0..2·10³⁸>` is `+∞` in f32;
 *   - a power `b^n` with an integer literal `n` from 2 to 4, as the operand
 *     of the guarded call or a term of a sum there, whose base has a known
 *     magnitude (a declared range, `sin`, `cos`, a literal, a product of
 *     number literals that are not rationals and one of the others, such
 *     as `2x` or `-0.14·cos(T)`, or a sum of these) and whose `n`-th power
 *     stays within half the largest f32;
 *   - a quotient by a number literal, or by an operand with a known lower
 *     bound of its magnitude (`lowerMagnitude`: a number literal, a product
 *     or a small power of such operands, or an operand whose interval does
 *     not hold 0, such as `k + 11` with `k: real<0..10>`)
 *     (`quotientStaysFinite`), a power `b^(-n)` for `n` from 2 to 4, which
 *     the shader computes as the quotient `1 / b^n`
 *     (`reciprocalPowerBound`), and a
 *     floored modulo (`modStaysFinite`), whose quotient cannot overflow:
 *     `mod(R, 10⁻³⁰)` with `R: real<0..10¹⁷>` is NaN in f32;
 *   - a pure subtree with no unknowns, whose value is finite in f32.
 *     `Random()` is not such a subtree: it is drawn at run time. Neither is
 *     `5r` with `r := Random()` (`BaseCompiler.foldValueImpure` looks
 *     through the value of a symbol).
 *
 *   A finite operand that overflows becomes `±∞` in the shader, and the
 *   guard turns `sin(∞)` into NaN, where the built-in gives 0 on Apple
 *   GPUs. A declared range proves a product of declared `real` symbols
 *   finite (`k: real<0..10>`, `t: real<0..6.3>`).
 *
 * An operand that is not proven calls the NaN-safe helper: the call never
 * declines. The guard costs a bit test and a selection per call: about 10%
 * of the frame time of Tycho's `voronoi-diagram` on WebGPU. On a finite
 * argument it does not change the value: measured on an Apple M5 Max over
 * WebGPU, the guarded and the built-in `sin` and `cos` give the same bits
 * on 39,200 inputs.
 */
export function gpuProvablyFinite(
  x: Expression,
  target: CompileTarget<Expression>,
  guardOperand = false
): boolean {
  // A scalar operand whose static type is not a finite real is proven from
  // its parts alone (`strict`). The type of a quotient by an operand that is
  // not a literal holds `±∞` and NaN (`x / cos(0.2)²` is typed
  // `infinity | nan | real`), where the quotient rule can show that the
  // divisor is not 0.
  let strict = false;
  if (!gpuFiniteRealCells(x)) {
    if (gpuOperandShape(x) !== 'scalar') return false;
    strict = true;
  }
  // An error raised while the proof reads the operand (a reference that the
  // target refuses) leaves the operand unproven: the helper stays, and the
  // emission of the operand reports the error, if any.
  try {
    return gpuFiniteProof(target, strict)?.finite(x, guardOperand) === true;
  } catch (err) {
    if (err instanceof Error && err.name === 'CancellationError') throw err;
    return false;
  }
}

/**
 * The test of the proof of `gpuProvablyFinite`, for one target:
 * `finite(e)`, is `e` finite for certain in the shader. `undefined` when
 * the caller of the compilation is not known.
 *
 * With `strict`, the static type of a node is not read as evidence that it
 * is real, since the operand is not typed a finite real (a node that reads
 * a parameter of the body being compiled is typed `number`, and a quotient
 * by an operand that is not a literal holds `±∞` and NaN): each symbol must
 * then be a finite real by its own type (or by its value), and a constant
 * subtree must have a real value. The heads that `finite` accepts give a
 * real result from real operands.
 */
function gpuFiniteProof(
  target: CompileTarget<Expression>,
  strict: boolean
):
  | {
      finite: (e: Expression, top?: boolean) => boolean;
      magnitude: (e: Expression) => number | undefined;
    }
  | undefined {
  // The names the caller maps to its own source (`vars`, `functions`,
  // `operators`), recorded on the common-subexpression session; with no
  // record (a direct custom target) every name may be the caller's.
  const caller = target.cse?.harvestOptions;
  if (caller === undefined) return undefined;
  // A name that the compiled code writes holds the value it assigns, which
  // its declared type does not describe (`GPU_WRITTEN_NAMES`).
  const written =
    target.userFunctions === undefined
      ? undefined
      : GPU_WRITTEN_NAMES.get(target.userFunctions);
  const isWritten = (s: string): boolean =>
    written === 'all' || written?.has(s) === true;
  // The parameters of the user-function body being compiled
  // (`CompileTarget.gpuParameterFacts`). A parameter that is finite for
  // certain is accepted whatever its own type says: the engine types a
  // parameter of an emitted definition `number`.
  const facts = target.gpuParameterFacts;
  const seen = new Map<Expression, boolean>();
  const seenTop = new Map<Expression, boolean>();
  // The real value of the literal that the emitter writes in place of the
  // function node `e`, or `undefined` when the emitter does not fold `e`
  // into one literal. The emitter folds a constant subtree top-down at each
  // function node with the gates of `foldedRealNumber()` in
  // `base-compiler.ts`: no unknowns, pure (also through the value of each
  // symbol), within the work estimate, and no `constantFold: false` on the
  // target. The value is the interpreter's f64 value of `e`, which the
  // shader reads rounded to f32. A subtree that is not folded is computed
  // by the shader in f32, and its value can be far from the f64 value: with
  // `A := 100000005` and `B := 100000003`, `A - B` is 2 in f64, but 8 in
  // f32, where `A` rounds to 100000008 and `B` to 10^8.
  const gpuFoldedValue = (e: Expression): number | undefined =>
    isFunction(e) ? BaseCompiler.foldedRealNumber(e, target) : undefined;
  // The largest magnitude of the numeric range of the type `t`, or
  // `undefined` when `t` has no range with two finite bounds.
  const rangeBound = (t: Type | undefined): number | undefined => {
    if (typeof t !== 'object' || t.kind !== 'numeric') return undefined;
    const { lower, upper } = t;
    if (lower === undefined || upper === undefined) return undefined;
    const m = Math.max(Math.abs(lower), Math.abs(upper));
    return Number.isFinite(m) ? m : undefined;
  };
  // The largest magnitude of the numeric range in the static type of `e`
  // (`k: real<0..10>` gives 10), or `undefined` when the type has no range
  // with two finite bounds. The caller checks that the type is a
  // declaration of the host.
  const declaredRangeBound = (e: Expression): number | undefined =>
    rangeBound(e.type.type);
  // When `e` is a call of a user function whose result type the host
  // declared with a range of finite bounds, of magnitude at most the
  // largest f32 (`f: (real) -> real<-1..1>`, `(real) -> integer<0..10>`),
  // the largest magnitude of that range. Otherwise `undefined`. `magnitude`
  // reads it as the bound of the call. A bare `real` result type is not
  // enough: the body is computed in f32, and `f(u) := exp(u)` declared
  // `(real) -> real` is `+∞` in f32 for `u > 88.7`. A body whose f32 value
  // leaves the declared range gives a value outside its declared type, for
  // which the compiled value is unspecified.
  //
  // The range is read from the declared signature of the definition only,
  // not from the static type of the call. A type that the engine inferred
  // from the body is not a promise of the host, and the static type of a
  // call of a function declared with the bare type `function` comes from
  // the body: with `h: function` and `h(p) := Fract(p)`, a call `h(x)` is
  // typed `real<0..1>`. A declared `function` type has no result range.
  // A head that a binder of the compiled expression binds (a lambda
  // parameter that shadows the function), or that the caller maps to its
  // own code (`functions`, `operators`), is not the user function.
  const declaredUserCallBound = (e: Expression): number | undefined => {
    if (!isFunction(e) || !e.type.matches('finite_real')) return undefined;
    const h = e.operator;
    if (
      target.boundVars?.has(h) === true ||
      target.unrollSkipHeads?.has(h) === true ||
      target.overridesHead?.(h) === true ||
      caller.isOverriddenOperator?.(h) === true ||
      BaseCompiler.userFunctionLiteral(e.engine, h) === undefined
    )
      return undefined;
    const def = e.engine.lookupDefinition(h);
    let declared: Type | undefined;
    if (isValueDef(def) && def.value.inferredType !== true)
      declared = def.value.type.type;
    else if (isOperatorDef(def) && def.operator.inferredSignature !== true)
      declared = def.operator.signature.type;
    const result = functionResult(declared);
    if (result === undefined || !isSubtype(result, 'finite_real'))
      return undefined;
    const bound = rangeBound(result);
    return bound === undefined || bound > GPU_F32_MAX ? undefined : bound;
  };
  const declaredUserCall = (e: Expression): boolean =>
    declaredUserCallBound(e) !== undefined;
  const reading = new Set<string>();
  const isMapped = (s: string): boolean =>
    target.varsKeys?.has(s) === true || caller.isVarsKey?.(s) === true;
  // The value that the shader computes in place of the symbol `e`, or
  // `undefined` when the shader reads `e` as an input. A symbol with a value
  // that no `vars` entry, binder (a parameter, an index, a local) or target
  // constant resolves is compiled as its value, written into the shader
  // (`tryFoldKnownSymbol()` in `base-compiler.ts`). A later assignment does
  // not change the compiled code, so the value, not the type of the symbol,
  // tells what the shader computes: `c := 2.5` gives `c` the INFERRED type
  // `real`, and `sin(c + x)` is `sin(2.5 + x)` in the shader. The value is
  // read as the shader computes it: rewritten for the engine's angular unit,
  // as `tryFoldKnownSymbol()` rewrites it before it compiles it. In degree
  // mode `c := |\arccos(-1) - \pi|` is about 176.86 in the shader, not 0.
  // A symbol with no value is read first, without asking `target.var`: a
  // target can refuse a reference to some names (a list in the parameter
  // struct of `compileFieldFunction()` is read only by position).
  const bakedValue = (e: Expression & { symbol: string }) => {
    const stored = e.engine._getSymbolValue(e.symbol);
    if (stored === undefined) return undefined;
    if (isMapped(e.symbol) || target.boundVars?.has(e.symbol) === true)
      return undefined;
    if (target.var(e.symbol) !== undefined) return undefined;
    return BaseCompiler.foldedValueInRadians(stored, target);
  };
  // `top` is true for the operand of the guarded call itself, and for a term
  // of a sum, difference or negation in that position: only there is a
  // small power accepted (`smallPowerStaysFinite`). Elsewhere its size
  // would be lost: `floor(x^4)` is typed an integer with no range, and
  // would count as a value of unknown magnitude.
  const finite = (e: Expression, top = false): boolean => {
    const memo = top ? seenTop : seen;
    const known = memo.get(e);
    if (known !== undefined) return known;
    const sum =
      isFunction(e) &&
      (e.operator === 'Add' ||
        e.operator === 'Subtract' ||
        e.operator === 'Negate');
    let result = false;
    // A literal is finite in the shader when it is finite in f32: `1e39` is
    // a finite f64 value, but `+∞` in f32.
    if (isNumber(e))
      result =
        e.type.matches('finite_real') &&
        e.im === 0 &&
        Math.abs(e.re) <= GPU_F32_MAX;
    else if (isSymbol(e) && facts?.get(e.symbol)?.finite === true)
      result = true;
    else if (isSymbol(e) && isWritten(e.symbol)) result = false;
    else if (isSymbol(e)) {
      const baked = bakedValue(e);
      const value = baked ?? e.engine._getSymbolValue(e.symbol);
      // A name that `vars` maps to its own bare identifier (`{ T: 'T' }`,
      // how a host passes a uniform) reads the host's input of its
      // declared type, as an unmapped symbol does. A mapping to other
      // source, or a mapping of a library constant, replaces a value whose
      // type the engine knows with one it does not.
      const mapped = isMapped(e.symbol);
      const selfMapped =
        mapped &&
        e.valueDefinition?.isConstant !== true &&
        target.var(e.symbol) === e.symbol;
      result =
        (baked !== undefined || !hasInferredType(e)) &&
        (!strict || baked !== undefined || gpuFiniteRealCells(e)) &&
        (!mapped || selfMapped) &&
        (value === undefined ||
          (!reading.has(e.symbol) && (reading.add(e.symbol), finite(value))));
      reading.delete(e.symbol);
    } else if (
      isFunction(e) &&
      caller.isOverriddenOperator?.(e.operator) !== true &&
      // The divisor of a quotient is read as the operand of a guarded call
      // is (`top`): a small power is accepted there, since the quotient
      // rule reads its bound (`quotientStaysFinite`).
      e.ops.every((op, i) =>
        finite(op, (top && sum) || (e.operator === 'Divide' && i === 1))
      )
    ) {
      // A subtree that the emitter folds into one literal (`gpuFoldedValue`)
      // is finite in the shader when its value is finite in f32 (`Γ(20)`,
      // but not `Γ(40)`). A subtree that it does not fold is evaluated by
      // the shader in f32, and is judged by the rules below.
      const v = gpuFoldedValue(e);
      if (v !== undefined && Number.isFinite(v) && Math.abs(v) <= GPU_F32_MAX) {
        memo.set(e, true);
        return true;
      }
      if (e.operator === 'Multiply') result = productStaysFinite(e.ops);
      else if (e.operator === 'Power')
        result =
          (top && smallPowerStaysFinite(e)) ||
          reciprocalPowerBound(e) !== undefined;
      // A sum, read through nested sums, differences and negations
      // (`-u^2 - v^2 - w^2` is a sum of `Negate(Power(…))` terms), is
      // finite when its terms cannot overflow together (`sumStaysFinite`).
      else if (sum) {
        const terms: Expression[] = [];
        const collect = (t: Expression): void => {
          if (
            isFunction(t) &&
            (t.operator === 'Add' ||
              t.operator === 'Subtract' ||
              t.operator === 'Negate')
          )
            t.ops.forEach(collect);
          else terms.push(t);
        };
        collect(e);
        result = sumStaysFinite(terms);
      }
      // A written vector (`[t, k, 1]` is `vec3(t, k, 1.0)`) is finite when
      // each of its components is.
      else if (e.operator === 'List' || e.operator === 'Tuple') result = true;
      else if (e.operator === 'Divide') result = quotientStaysFinite(e);
      else if (e.operator === 'Mod') result = modStaysFinite(e);
      // `Abs` of a point or of a complex value is emitted as its Euclidean
      // norm (`length(…)`), which can overflow f32 when each component is
      // finite: `|(x, x, x, x)|` is `+∞` for `x = 2·10³⁸`. The test of a
      // point is the one of the emitter (`absCompilesToPointNorm()` in
      // `compiler-core.ts`). The norm is finite when `n·m²` is at most half
      // the largest f32, less a margin of 2⁻¹⁰ for the rounding, for the `n`
      // components and the bound `m` of their magnitudes (`magnitude`). A
      // complex value has 2 components, and its bound is not known here.
      // `Abs` of a list of points is the list of their norms
      // (`absCompilesToPointListNorm()`), and is not proven. `Abs` of a
      // list of numbers (`|[x, y, z]|`) is the component-wise `abs`, which
      // cannot overflow, and is accepted with the heads below.
      else if (
        e.operator === 'Abs' &&
        e.nops === 1 &&
        (absCompilesToPointNorm(e.op1) ||
          absCompilesToPointListNorm(e.op1) ||
          BaseCompiler.isComplexValued(e.op1))
      ) {
        const shape = gpuOperandShape(e.op1);
        const m =
          typeof shape === 'number' &&
          absCompilesToPointNorm(e.op1) &&
          !BaseCompiler.isComplexValued(e.op1)
            ? magnitude(e.op1)
            : undefined;
        result =
          typeof shape === 'number' &&
          m !== undefined &&
          shape * m * m * (1 + 2 ** -10) <= GPU_F32_MAX / 2;
      }
      // Over finite operands, `Smoothstep` has no defined value when its two
      // edges are equal. The static type of the node excludes it for symbols
      // of a declared type, but a parameter of the body being compiled is
      // typed `number`, and so is the node: then (and whenever the proof is
      // `strict`, the node is not typed a finite real) the edges must be two
      // different literals.
      else if (
        (facts !== undefined || strict) &&
        e.operator === 'Smoothstep' &&
        !e.type.matches('finite_real')
      )
        result = isNumber(e.op1) && isNumber(e.op2) && !e.op1.isSame(e.op2);
      else if (GPU_F32_BOUNDED_HEADS.has(e.operator)) result = true;
      // A call of a user function whose result type the host DECLARED with
      // a range (`f: (real) -> real<-1..1>`, `declaredUserCall`) is finite:
      // the declaration is a promise of the host, as the declared range of
      // an input is. The proof does not read the body of the function. Any
      // other head is not proven.
      else result = declaredUserCall(e);
    }
    memo.set(e, result);
    return result;
  };
  // The largest magnitude that the finite operand `e` can have in the
  // shader, or `undefined` when no bound is known: the value of a number
  // literal; the bound of the value written in place of a symbol; 1 for
  // `sin`, `cos` and `tanh` of a real operand and for `Random()`; π/2 for
  // `arctan` of a real operand; the product of the bounds of
  // the factors of a product when each factor has one; the magnitude of the
  // literal that the emitter folds a constant subtree into (`2π`); the sum of the bounds
  // of the operands of a sum, a difference or a negation; the largest bound
  // of the real scalar operands of `abs`, `min` and `max`; the bound of the
  // operand plus 1 for `floor`, `ceil`, `round` and `trunc`; 1 for `fract`;
  // about the bound of the divisor for `mod`; else the bounds
  // of the declared range of a
  // symbol that the shader reads as the host's input (`k: real<0..10>`). A
  // declared range is a promise of the host, as a declared `real` is (see
  // above). The range in the static type of a compound expression is not
  // read. The bound is the exact bound of the value: the rules that read it
  // keep a margin for the rounding to f32.
  const magnitude = (e: Expression, depth = 0): number | undefined => {
    if (isNumber(e))
      return e.im === 0 && Number.isFinite(e.re) ? Math.abs(e.re) : undefined;
    // A written vector: the largest magnitude of its components.
    if (isFunction(e) && (e.operator === 'List' || e.operator === 'Tuple')) {
      let m = 0;
      for (const op of e.ops) {
        const c = magnitude(op, depth + 1);
        if (c === undefined) return undefined;
        m = Math.max(m, c);
      }
      return m;
    }
    if (isSymbol(e)) {
      // A parameter of the body being compiled: the bound of its facts.
      const fact = facts?.get(e.symbol);
      if (fact?.finite === true) return fact.magnitude;
      if (isWritten(e.symbol)) return undefined;
      // Past the depth limit a stored value gives no bound: the constant
      // rule below would read the interpreter's value, which the shader does
      // not compute when the value is not folded. The limit counts every
      // level of nesting of `magnitude()`, not only the steps through
      // stored values, so a stored value deep in a sum or a product also
      // gives no bound: the helper stays (a decline of the built-in, never
      // a wrong value).
      const baked = bakedValue(e);
      if (baked !== undefined)
        return depth < 8 ? magnitude(baked, depth + 1) : undefined;
    } else if (
      isFunction(e) &&
      (e.operator === 'Sin' || e.operator === 'Cos' || e.operator === 'Tanh') &&
      (e.type.matches('real') || (strict && finite(e.op1)))
    )
      return 1;
    // `arctan` of a real operand is at most π/2, and `Random()` is in
    // [0, 1).
    else if (
      isFunction(e) &&
      e.operator === 'Arctan' &&
      e.nops === 1 &&
      (e.type.matches('real') || (strict && finite(e.op1)))
    )
      return Math.PI / 2;
    else if (isFunction(e) && e.operator === 'Random' && e.nops === 0) return 1;
    // A small power that `finite` accepts: `m^n` for the bound `m` of its
    // base, with the same margin, so that a sum that holds it
    // (`x^2 + y^2`) adds that bound.
    else if (isFunction(e) && e.operator === 'Power' && isNumber(e.op2)) {
      const m = powerBaseMagnitude(e.op1);
      if (m !== undefined && smallPowerStaysFinite(e))
        return Math.max(1, m) ** e.op2.re * (1 + 2 ** -10);
      // `b^(-n)`, which the shader computes as `1.0 / b^n`.
      const q = reciprocalPowerBound(e);
      if (q !== undefined) return q;
    }
    // A quotient by an operand that is not a literal, which the quotient
    // rule accepts (`quotientStaysFinite`): the bound `m` of the dividend
    // over the lower bound `l` of the magnitude of the divisor
    // (`lowerMagnitude`), with a margin for the error of the division
    // (2.5 ulp).
    else if (
      isFunction(e) &&
      e.operator === 'Divide' &&
      e.nops === 2 &&
      !isNumber(e.op2) &&
      finite(e)
    ) {
      const m = magnitude(e.op1, depth + 1);
      const l = lowerMagnitude(e.op2);
      if (m !== undefined && l !== undefined && quotientStaysFinite(e))
        return (m / l) * (1 + 2 ** -20);
    } else if (isFunction(e) && e.operator === 'Multiply') {
      let bound = 1;
      for (const op of e.ops) {
        const m = magnitude(op, depth + 1);
        if (m === undefined) {
          bound = NaN;
          break;
        }
        bound *= m;
      }
      if (Number.isFinite(bound)) return bound;
    }
    // `floor`, `ceil`, `round` and `trunc` of a real operand of bound `m`
    // (one operand: the step form `Floor(x, step)` is a quotient and a
    // product, `gpuRoundToStep`): at most `m + 1`. The shader computes them
    // exactly from the f32 value of the operand, and every form of `Round`
    // (`gpuRoundToInteger`) gives an integer next to that value.
    else if (
      isFunction(e) &&
      e.nops === 1 &&
      (e.operator === 'Floor' ||
        e.operator === 'Ceil' ||
        e.operator === 'Round' ||
        e.operator === 'Truncate') &&
      !BaseCompiler.isComplexValued(e.op1)
    ) {
      const m = magnitude(e.op1, depth + 1);
      if (m !== undefined) return m + 1;
    }
    // The fractional part of a finite real operand: `fract(x)` is in
    // [0, 1] in f32 (`fract(-1e-20)` rounds to 1). The exact form of a
    // sine hash (`isAmplifiedTrig`, `gpuAmplifiedTrigMod`) can be NaN, so
    // it gets no bound.
    else if (
      isFunction(e) &&
      e.operator === 'Fract' &&
      e.nops === 1 &&
      !BaseCompiler.isComplexValued(e.op1) &&
      !isAmplifiedTrig(e.op1) &&
      finite(e)
    )
      return 1;
    // A floored modulo `Mod(a, d)` that the modulo rule accepts
    // (`modStaysFinite`). With the divisor 1 the shader computes
    // `fract(fract(a))`, in [0, 1]. Otherwise the `_gpu_fmod` helper
    // (`gpuFloorModLibrary`) gives a value in the range of `d`, of
    // magnitude at most the bound `M` of `d`, except for the rounding of
    // the quotient `a / d` in f32: a quotient that rounds past an integer
    // moves the result by `d` times its error, which is at most a few ulp
    // of `|a| / |d|`. So the bound is `M + (m + M)·2⁻¹⁶` for the bound `m`
    // of `a`. The sine hash has no bound, as for `Fract`.
    else if (
      isFunction(e) &&
      e.operator === 'Mod' &&
      e.nops === 2 &&
      !BaseCompiler.isComplexValued(e.op1) &&
      !BaseCompiler.isComplexValued(e.op2) &&
      !isAmplifiedTrig(e.op1) &&
      finite(e)
    ) {
      if (isNumber(e.op2) && e.op2.im === 0 && e.op2.re === 1) return 1;
      const m = magnitude(e.op1, depth + 1);
      const M = magnitude(e.op2, depth + 1);
      if (m !== undefined && M !== undefined) return M + (m + M) * 2 ** -16;
    }
    // A library constant (`Pi`) that the caller does not map has a value
    // known here. The shader reads a symbol that is not a constant from its
    // input or a binder, not from its value. A subtree that the emitter
    // folds into one literal (`gpuFoldedValue`) has the magnitude of that
    // literal; another subtree is evaluated by the shader in f32, and its
    // bound comes from the bounds of its parts (the rules above and below).
    if (isSymbol(e)) {
      if (
        e.valueDefinition?.isConstant === true &&
        !isMapped(e.symbol) &&
        e.unknowns.length === 0
      ) {
        const n = e.N();
        if (n.im === 0 && Number.isFinite(n.re)) return Math.abs(n.re);
      }
    } else {
      const v = gpuFoldedValue(e);
      if (v !== undefined && Number.isFinite(v)) return Math.abs(v);
    }
    // A sum, a difference or a negation: the sum of the bounds of its
    // operands. `abs`, `min` and `max` of real scalar operands: the largest
    // bound of their operands. A point or a list operand gives no bound
    // here: `|(x, x, x, x)|` compiles to the Euclidean norm `length(…)`,
    // which is 2 for `x = 1`, not the largest component magnitude 1 that
    // the bound of a written vector gives. `min` and `max` have the same
    // requirement, so that only the scalar meaning of these heads is read.
    if (
      isFunction(e) &&
      (e.operator === 'Add' ||
        e.operator === 'Subtract' ||
        e.operator === 'Negate' ||
        e.operator === 'Abs' ||
        e.operator === 'Min' ||
        e.operator === 'Max')
    ) {
      const sum = e.operator === 'Add' || e.operator === 'Subtract';
      const extremum = !sum && e.operator !== 'Negate';
      let bound = 0;
      for (const op of e.ops) {
        if (
          extremum &&
          (gpuOperandShape(op) !== 'scalar' || BaseCompiler.isComplexValued(op))
        )
          return undefined;
        const m = magnitude(op, depth + 1);
        if (m === undefined) return undefined;
        bound = sum ? bound + m : Math.max(bound, m);
      }
      return Number.isFinite(bound) ? bound : undefined;
    }
    // A call of a user function with a declared ranged result type
    // (`declaredUserCallBound`) has the bound of that range.
    if (isFunction(e)) return declaredUserCallBound(e);
    // The range in the static type of a symbol that the shader reads as
    // the host's input, under the conditions of `atomBound`: a declared
    // range is a promise of the host, as a declared `real` is. The range
    // in the static type of another expression is computed over the exact
    // values of its operands, and does not hold after their rounding to
    // f32: with `A: real<100000005..100000006>` and
    // `B: real<100000003..100000003>`, `A − B` is typed in [2, 3], but `A`
    // rounds to 100000008 and `B` to 10⁸ in f32, and `A − B` is 8 there.
    if (
      !isSymbol(e) ||
      facts?.has(e.symbol) === true ||
      isWritten(e.symbol) ||
      bakedValue(e) !== undefined ||
      hasInferredType(e)
    )
      return undefined;
    return declaredRangeBound(e);
  };
  // A product of finite factors cannot overflow in f32 when every factor
  // has a known magnitude and the product of those magnitudes (each counted
  // as at least 1, so that every partial product of the shader's evaluation
  // order is bounded too) is at most half the largest f32. The half covers
  // the rounding of each factor and each partial product to f32. A factor
  // of unknown magnitude can be any finite f32 value, up to 3.4·10³⁸, so a
  // product with one is refused: `H·x` with `H: real<0..10³⁰>` and `x`
  // declared `real` is `+∞` in f32 for `x ≥ 3.5·10⁸`, and `5·x` is `+∞`
  // for `x ≥ 6.9·10³⁷`. The exception is a product of one factor of
  // unknown magnitude and number literals of magnitude at most 1 (`0.5·x`,
  // the conversion `0.017453292·x` of degrees): the shader languages round
  // a product correctly, so each partial product is at most the factor of
  // unknown magnitude, a finite f32. A rational literal `±1/q` is such a
  // factor too, for an integer `q` from 1 to 2¹²⁶: the shader multiplies by
  // its value (`0.25 * x`) or divides by `q` (`x / 3.0`), and a division by
  // `q ≥ 1` in the range where its error is specified (2.5 ulp) cannot
  // overflow. Another rational literal (`2/3`) is refused, and so is
  // `sin(t)`, whose GPU value is not specified to be at most 1.
  const productStaysFinite = (ops: ReadonlyArray<Expression>): boolean => {
    let bound = 1;
    let unknown = 0;
    let smallLiterals = true;
    for (const op of ops) {
      const m = magnitude(op);
      if (m === undefined) unknown += 1;
      else {
        bound *= Math.max(1, m);
        const small =
          isNumber(op) &&
          m <= 1 &&
          (op.operator !== 'Rational' ||
            (Math.abs(op.numerator.re) === 1 && op.denominator.re <= 2 ** 126));
        if (!small) smallLiterals = false;
      }
    }
    if (unknown === 1) return smallLiterals;
    return unknown === 0 && Number.isFinite(bound) && bound <= GPU_F32_MAX / 2;
  };
  // A sum of finite terms (read through nested sums, differences and
  // negations) cannot overflow in f32 when the magnitudes of its terms add
  // up to at most half the largest f32: `R + Q` with
  // `R, Q: real<0..2·10³⁸>` can be 4·10³⁸, `+∞` in f32. A product term of
  // the form that a power base accepts (`productBound`: number literals and
  // one atom) has the bound `|c|·m` when `magnitude` gives none.
  //
  // One term of unknown magnitude is accepted when the other terms add up
  // to at most 2¹⁰⁰ (about 1.3·10³⁰): `x + 1` and `x - 0.14·cos(T)` with
  // `x` declared `real`. The term of unknown magnitude is a finite f32
  // value, at most 2¹²⁸ − 2¹⁰⁴, and an f32 sum rounds to `+∞` only from
  // 2¹²⁸ − 2¹⁰³ (the half-way point to the next power of two). Whatever
  // order the shader adds the terms in, each partial sum that holds the
  // term of unknown magnitude is then below that point, and rounds to at
  // most the largest f32; the margin from 2¹⁰⁰ to 2¹⁰³ covers the rounding
  // of the partial sums of the other terms. Two terms of unknown magnitude
  // can overflow: `x + y` with `x = y = 2·10³⁸`.
  const sumStaysFinite = (terms: ReadonlyArray<Expression>): boolean => {
    let s = 0;
    let unknown = 0;
    for (const t of terms) {
      const m = magnitude(t) ?? productBound(t);
      if (m === undefined) unknown += 1;
      else s += m;
    }
    if (!Number.isFinite(s)) return false;
    if (unknown === 0) return s <= GPU_F32_MAX / 2;
    return unknown === 1 && s <= 2 ** 100;
  };
  // The quotient `a / d` of finite operands, for a number literal `d`
  // whose magnitude is from 2⁻¹²⁶ to 2¹²⁶ (the range where the shader
  // languages specify the error of a division, 2.5 ulp): finite when `a`
  // has a magnitude `m` with `m / |d|` at most half the largest f32, or,
  // when `a` has no known magnitude, when `|d| ≥ 2` (the quotient is then
  // at most half of `a`). A divisor that is not a literal is accepted under
  // the same conditions, with a lower bound `l` of its magnitude in place
  // of `|d|` (`lowerMagnitude`) and a known bound of its magnitude of at
  // most 2¹²⁶: `x / (k + 11)` with `k: real<0..10>` (`l` about 1). Any
  // other divisor is refused: `x / 10⁻³⁰` is `+∞` in f32 for
  // `|x| ≥ 3.5·10⁸`, and a divisor that can be 0 or tiny makes the
  // quotient `±∞` or NaN.
  const quotientStaysFinite = (e: Expression): boolean => {
    if (!isFunction(e) || e.nops !== 2) return false;
    if (!isNumber(e.op2)) {
      const l = lowerMagnitude(e.op2);
      const M = magnitude(e.op2);
      if (l === undefined || !(l >= 2 ** -126)) return false;
      if (M === undefined || M > 2 ** 126) return false;
      const m = magnitude(e.op1);
      if (m === undefined) return l >= 2;
      return m / l <= GPU_F32_MAX / 2;
    }
    if (e.op2.im !== 0) return false;
    const d = Math.abs(e.op2.re);
    if (!(d >= 2 ** -126 && d <= 2 ** 126)) return false;
    const m = magnitude(e.op1);
    if (m === undefined) return d >= 2;
    return m / d <= GPU_F32_MAX / 2;
  };
  // The floored modulo `Mod(a, d)` of finite operands. The shader computes
  // it from the quotient `a / d` (`gpuFloorModLibrary`), which is `±∞` in
  // f32 when `d` is tiny: `mod(R, 10⁻³⁰)` with `R: real<0..10¹⁷>` is NaN.
  // The product of the divisor and the rounded quotient can also reach
  // `|a| + |d|`. So it is finite when:
  // - `d` is the literal 1, which the shader computes as `fract(fract(a))`
  //   (`a - floor(a)`), finite for every finite `a`; or
  // - `a` has a known magnitude `m`, `d` has a known magnitude `M` of at
  //   most 2¹²⁶ (the range where the shader languages specify the error of
  //   a division), and a known lower bound `l` of its magnitude, at least
  //   2⁻¹²⁶ (a smaller divisor can be flushed to 0). Then `m / l` and
  //   `m + M` must each be at most half the largest f32. The lower bound is
  //   the value of a number literal, or, when the proof reads static types
  //   (not `strict`, see `gpuFiniteProof`), the declared range of a symbol
  //   that the shader reads as the host's input, under the conditions of
  //   `atomBound` (`d: real<0.5..2>`). The range in the static type of
  //   another divisor does not hold in f32: with
  //   `A: real<100000000.5..100000002>` and `B: real<100000000..100000000>`,
  //   `A − B` is typed in [0.5, 2], but both round to 10⁸ in f32, the
  //   divisor is 0, and the shader gives NaN. The value that the shader
  //   computes in place of a symbol is such a divisor too.
  const modStaysFinite = (e: Expression): boolean => {
    if (!isFunction(e) || e.nops !== 2) return false;
    const d = e.op2;
    if (isNumber(d) && d.im === 0 && d.re === 1) return true;
    let low: number | undefined;
    if (isNumber(d)) low = d.im === 0 ? Math.abs(d.re) : undefined;
    else if (
      !strict &&
      isSymbol(d) &&
      facts?.has(d.symbol) !== true &&
      !isWritten(d.symbol) &&
      bakedValue(d) === undefined &&
      !hasInferredType(d)
    ) {
      const t = d.type.type;
      if (typeof t === 'object' && t.kind === 'numeric') {
        const { lower, upper } = t;
        if (lower !== undefined && lower > 0) low = lower;
        else if (upper !== undefined && upper < 0) low = -upper;
      }
    }
    if (low === undefined || !(low >= 2 ** -126)) return false;
    const m = magnitude(e.op1);
    const M = magnitude(d);
    if (m === undefined || M === undefined || M > 2 ** 126) return false;
    return m / low <= GPU_F32_MAX / 2 && m + M <= GPU_F32_MAX / 2;
  };
  // `b^n` with an integer literal `n` from 2 to 4, whose operands are
  // finite (checked by `finite` before), is finite when `b` has a bound `m`
  // of its magnitude, read from its parts only (`powerBaseMagnitude`), with
  // `m^n` (`m` counted as at least 1, so that each partial product is
  // bounded too) at most half the largest f32, less a margin of 2^-10 for
  // the rounding: `(x - cos(T))^2` with `x: real<-10..10>`. For these
  // exponents the shader multiplies (`x * x`, `_gpu_pow2`–`_gpu_pow4`). Any
  // other exponent, and a base of another form, is refused: `x^2` with `x`
  // declared `real` and no range is `+∞` in f32 for `x = 10²⁰`, and a
  // larger exponent of a compound base calls `_gpu_powi`, which computes
  // `pow(abs(x), n)` with an error that the GPU does not specify.
  const smallPowerStaysFinite = (e: Expression): boolean => {
    if (!isFunction(e) || !isNumber(e.op2) || e.op2.im !== 0) return false;
    const n = e.op2.re;
    if (!Number.isInteger(n) || n < 2 || n > 4) return false;
    const m = powerBaseMagnitude(e.op1);
    return (
      m !== undefined && Math.max(1, m) ** n * (1 + 2 ** -10) <= GPU_F32_MAX / 2
    );
  };
  // A bound of the magnitude of `b^(-n)` with an integer literal `n` from 2
  // to 4, whose operands are finite (checked by `finite` before), or
  // `undefined` when it can be `±∞`. The shader computes it as
  // `1.0 / _gpu_pow2(b)`–`1.0 / _gpu_pow4(b)`, the quotient of 1 by the
  // product `b^n`, so the rule of a quotient by an operand that is not a
  // literal applies (`quotientStaysFinite`), with the same margins:
  // `b^n` must have a bound of at most 2¹²⁶ (`smallPowerStaysFinite` and
  // `powerBaseMagnitude`), and a lower bound `l` of its magnitude of at
  // least 2⁻¹²⁶ (`lowerMagnitude` of `b`, to the power `n`, less the
  // margin of the rule for `b^n`). The bound is then `1 / l`, with a margin
  // for the error of the division (2.5 ulp). The exponent -1 does not
  // occur: `b^{-1}` is the quotient `1 / b`.
  const reciprocalPowerBound = (e: Expression): number | undefined => {
    if (!isFunction(e, 'Power') || !isNumber(e.op2) || e.op2.im !== 0)
      return undefined;
    const n = -e.op2.re;
    if (!Number.isInteger(n) || n < 2 || n > 4) return undefined;
    const m = powerBaseMagnitude(e.op1);
    if (m === undefined || Math.max(1, m) ** n * (1 + 2 ** -10) > 2 ** 126)
      return undefined;
    const l = lowerMagnitude(e.op1);
    if (l === undefined) return undefined;
    const low = l ** n * (1 - 2 ** -20);
    if (!(low >= 2 ** -126)) return undefined;
    const q = (1 / low) * (1 + 2 ** -20);
    return q <= GPU_F32_MAX / 2 ? q : undefined;
  };
  // A bound of the magnitude of the base `b` of a small power, for three
  // forms only: a term, the negation of a term, or a sum or a difference of
  // such terms (the sum of their bounds). A term is an atom, or a product of
  // one atom that is not a literal and of one or more number literals (the
  // product of the bounds: `|c|·m`). An atom is a finite number literal,
  // `sin` or `cos` of a real operand (at most 1), or a symbol that the
  // shader reads as the host's input with a DECLARED type that has a finite
  // numeric range (`x: real<-10..10>`). A symbol whose type is inferred,
  // whose value the shader computes in its place, or that the compiled code
  // writes has no bound here. Any other form gives `undefined`: a product of two atoms that are
  // not literals (`x·y`), a factor of another form (`0.5·exp(T)`), and a
  // rational factor, which the shader computes as a division (`2x/3` is
  // `x / 3.0 * 2.0`).
  const powerBaseMagnitude = (b: Expression): number | undefined => {
    const term = (t: Expression): number | undefined => {
      if (isFunction(t) && t.operator === 'Negate') t = t.op1;
      if (isFunction(t) && t.operator === 'Multiply') return productBound(t);
      return atomBound(t);
    };
    if (isFunction(b) && (b.operator === 'Add' || b.operator === 'Subtract')) {
      let s = 0;
      for (const op of b.ops) {
        const m = term(op);
        if (m === undefined) return undefined;
        s += m;
      }
      return Number.isFinite(s) ? s : undefined;
    }
    return term(b);
  };
  // The bound of a product term of a small power base (see
  // `powerBaseMagnitude`): number literals that are not rationals, and
  // exactly one atom that is not a literal. Any other product gives
  // `undefined`.
  const productBound = (p: Expression): number | undefined => {
    if (!isFunction(p) || p.operator !== 'Multiply') return undefined;
    let bound = 1;
    let literals = 0;
    let others = 0;
    for (const op of p.ops) {
      if (isNumber(op)) {
        if (op.operator === 'Rational') return undefined;
        literals += 1;
      } else others += 1;
      const m = atomBound(op);
      if (m === undefined) return undefined;
      bound *= m;
    }
    if (literals === 0 || others !== 1) return undefined;
    return Number.isFinite(bound) ? bound : undefined;
  };
  // The bound of an atom of a small power base (see `powerBaseMagnitude`).
  const atomBound = (t: Expression): number | undefined => {
    if (isNumber(t))
      return t.im === 0 && Number.isFinite(t.re) ? Math.abs(t.re) : undefined;
    // A real operand only, as in `magnitude`: `cos(z)` of a complex `z`
    // grows as `cosh(Im z)`.
    if (isFunction(t) && (t.operator === 'Sin' || t.operator === 'Cos'))
      return t.nops === 1 &&
        (t.type.matches('real') || (strict && finite(t.op1)))
        ? 1
        : undefined;
    if (!isSymbol(t)) return undefined;
    if (
      facts?.has(t.symbol) === true ||
      isWritten(t.symbol) ||
      bakedValue(t) !== undefined ||
      hasInferredType(t)
    )
      return undefined;
    const type = t.type.type;
    if (typeof type !== 'object' || type.kind !== 'numeric') return undefined;
    const { lower, upper } = type;
    if (lower === undefined || upper === undefined) return undefined;
    const m = Math.max(Math.abs(lower), Math.abs(upper));
    return Number.isFinite(m) ? m : undefined;
  };
  // A rational literal `p/q` for which `exactRationalDivisor()` gives `p`
  // and `q` (both safe integers, `q > 1` and not a power of two) is not
  // written as one f32 value: the emitter writes a product by it as a
  // division and a product, `t / q * p`. The intermediate
  // `t / q` can then be below the smallest normal f32 and be flushed to 0
  // before the product by `p`: with `t = 10⁻³⁰` and
  // `p/q = 8999999999999999/9000000000000000`, `t / q` is about
  // 1.1·10⁻⁴⁶, and the product is 0, while `p/q·t` is about 10⁻³⁰. The
  // literal itself is the quotient of two values that are each rounded to
  // f32. An interval or a lower bound computed from the value `p/q` does
  // not hold for these, so `range` and `lowerMagnitude` refuse the literal
  // alone, and read a product with one as the two steps of the shader. An
  // upper bound does hold (`magnitude`): `|t / q| ≤ |t|` for `q ≥ 1`, and
  // the rules that read a bound keep a margin of half the largest f32.
  //
  // Any other rational literal (`1/2`, or `1/(3·10⁴⁰)`, whose `q` is not a
  // safe integer) is written as one f32 literal, the value `p/q` rounded,
  // and is read as any other number literal: its interval is widened by
  // 2⁻¹²⁶ for a flush to 0, and its lower bound must be a normal f32.
  const isExactRationalDivisor = (e: Expression): boolean =>
    exactRationalDivisor(e) !== undefined;
  // An interval `[lower, upper]` that holds the value of the finite `e` in
  // the shader, or `undefined` when none is known. The interval of a sum, a
  // difference, a negation, a product and a quotient by a number literal is
  // computed from the intervals of the operands, then widened for the
  // rounding of the f32 operations: by `n·2⁻²²` times the sum of the
  // magnitudes of the `n` operands for a sum or a difference, by `n·2⁻²²`
  // times the bound of a product of `n` factors, and by 2⁻¹²⁶ for each
  // result that can be flushed to 0. A product with a partial product that
  // excludes 0 and can be below 2⁻¹⁰⁰ has no interval from this rule. A
  // number literal is widened for its rounding to f32. A symbol whose value
  // the shader computes in its place has the interval of that value, and a
  // subtree that the emitter folds into one literal has the interval of that
  // literal.
  //
  // `lowerMagnitude` reads these intervals for a lower bound, so no other
  // function node has an interval, even when `magnitude` gives it a bound.
  // That bound is the exact bound of the value (1 for `sin`, `cos` and
  // `tanh`, π/2 for `arctan`), but the error of a GPU trigonometric
  // function is absolute, and GLSL does not specify it. So `1.0004 + sin(t)`, with the
  // interval `[-1, 1]` for `sin(t)`, would get the lower bound 4·10⁻⁴,
  // while the shader can compute 0 or less for it. Only a symbol that the
  // shader reads as the host's input (its declared range, a promise of the
  // host) or a library constant of known magnitude `m` is in `[-m, m]`
  // (`magnitude`).
  //
  // A rational literal that the emitter writes as a division
  // (`isExactRationalDivisor`) has no interval, and
  // neither has a quotient by one; a product with one is read as the shader
  // computes it (see the `Multiply` case).
  const range = (
    e: Expression,
    depth = 0
  ): readonly [number, number] | undefined => {
    if (depth > 32 || !finite(e) || isExactRationalDivisor(e)) return undefined;
    const widen = (
      lo: number,
      hi: number,
      error: number,
      operations = 1
    ): readonly [number, number] | undefined => {
      const flush = operations * 2 ** -126;
      const r = [lo - error - flush, hi + error + flush] as const;
      return Math.max(-r[0], r[1]) <= GPU_F32_MAX / 2 ? r : undefined;
    };
    if (isNumber(e))
      return e.im === 0
        ? widen(e.re, e.re, Math.abs(e.re) * 2 ** -23)
        : undefined;
    if (isSymbol(e)) {
      const fact = facts?.get(e.symbol);
      if (fact?.finite === true) return fact.range;
      const baked = bakedValue(e);
      if (baked !== undefined) return range(baked, depth + 1);
    } else if (isFunction(e)) {
      const h = e.operator;
      if (h === 'Negate' && e.nops === 1) {
        const r = range(e.op1, depth + 1);
        if (r !== undefined) return [-r[1], -r[0]];
      } else if ((h === 'Add' || h === 'Subtract') && e.nops >= 1) {
        let lo = 0;
        let hi = 0;
        let size = 0;
        let known = true;
        e.ops.forEach((op, i) => {
          const r = known ? range(op, depth + 1) : undefined;
          if (r === undefined) {
            known = false;
            return;
          }
          if (h === 'Subtract' && i > 0) {
            lo -= r[1];
            hi -= r[0];
          } else {
            lo += r[0];
            hi += r[1];
          }
          size += Math.max(-r[0], r[1]);
        });
        if (known) return widen(lo, hi, e.nops * 2 ** -22 * size, e.nops);
      } else if (h === 'Multiply' && e.nops >= 1) {
        // A rational factor `p/q` (`isExactRationalDivisor`) is not read as a
        // factor: the shader divides the product of the other factors by
        // `q`, then multiplies the quotient by `p` (`t / q * p`). Each of the
        // two steps is a product of an interval by a value, with the same
        // test of a flush to 0 and a margin of 2⁻²⁰ for the rounding of the
        // integer to f32 and of the operation. A product with two such
        // factors has no interval.
        const rationals = e.ops.filter(isExactRationalDivisor);
        let lo = 1;
        let hi = 1;
        let known = rationals.length <= 1 && rationals.length < e.nops;
        const scale = (
          r: readonly [number, number] | undefined,
          c: number
        ): readonly [number, number] | undefined => {
          if (r === undefined) return undefined;
          const a = Math.min(r[0] * c, r[1] * c);
          const b = Math.max(r[0] * c, r[1] * c);
          if (
            (a > 0 || b < 0) &&
            Math.min(Math.abs(a), Math.abs(b)) < 2 ** -100
          )
            return undefined;
          return widen(a, b, 2 ** -20 * Math.max(-a, b));
        };
        for (const op of e.ops) {
          if (!known) break;
          if (isExactRationalDivisor(op)) continue;
          const r = range(op, depth + 1);
          if (r === undefined) {
            known = false;
            break;
          }
          const corners = [lo * r[0], lo * r[1], hi * r[0], hi * r[1]];
          lo = Math.min(...corners);
          hi = Math.max(...corners);
          // A partial product that does not hold 0 and that can be below the
          // smallest normal f32 can be flushed to 0 by the shader, out of the
          // interval, and a later factor does not bring it back. An interval
          // that holds 0 holds the flushed value too.
          if (
            (lo > 0 || hi < 0) &&
            Math.min(Math.abs(lo), Math.abs(hi)) < 2 ** -100
          ) {
            known = false;
            break;
          }
        }
        let r =
          known && Number.isFinite(lo) && Number.isFinite(hi)
            ? widen(lo, hi, e.nops * 2 ** -22 * Math.max(-lo, hi))
            : undefined;
        const rational =
          rationals[0] === undefined
            ? undefined
            : exactRationalDivisor(rationals[0]);
        if (rational !== undefined) {
          r = scale(r, 1 / rational.q);
          if (rational.p !== 1) r = scale(r, rational.p);
        }
        if (r !== undefined) return r;
      } else if (
        h === 'Divide' &&
        e.nops === 2 &&
        isNumber(e.op2) &&
        !isExactRationalDivisor(e.op2) &&
        e.op2.im === 0 &&
        Math.abs(e.op2.re) >= 2 ** -126 &&
        Math.abs(e.op2.re) <= 2 ** 126
      ) {
        const r = range(e.op1, depth + 1);
        const d = e.op2.re;
        if (r !== undefined) {
          const a = r[0] / d;
          const b = r[1] / d;
          return widen(
            Math.min(a, b),
            Math.max(a, b),
            2 ** -21 * Math.max(Math.abs(a), Math.abs(b))
          );
        }
      }
      const v = gpuFoldedValue(e);
      return v !== undefined && Number.isFinite(v)
        ? widen(v, v, Math.abs(v) * 2 ** -23)
        : undefined;
    }
    const m = magnitude(e);
    return m === undefined ? undefined : [-m, m];
  };
  // A lower bound `l > 0` of the magnitude of the finite `e` in the shader,
  // or `undefined` when `e` can be 0 or none is known:
  // - a number literal: its magnitude, less the rounding to f32;
  // - a power `b^n` with an integer literal `n` from 2 to 4, which the
  //   shader computes as products (`_gpu_pow2`–`_gpu_pow4`): `l^n` for the
  //   lower bound `l` of `b`, less a margin for the rounding;
  // - a product: the product of the lower bounds of its factors, less a
  //   margin for the rounding;
  // - any other operand whose interval (`range`) does not hold 0: the
  //   smaller magnitude of the two ends.
  // The operand is checked as a divisor is (`finite` with `top`), so that a
  // small power is accepted. A rational literal that the emitter writes as
  // a division has no lower bound (`isExactRationalDivisor`); a product
  // with one is read as the shader
  // computes it.
  const lowerMagnitude = (e: Expression, depth = 0): number | undefined => {
    if (depth > 32 || !finite(e, true) || isExactRationalDivisor(e))
      return undefined;
    const positive = (v: number): number | undefined =>
      Number.isFinite(v) && v >= 2 ** -126 ? v : undefined;
    if (isNumber(e))
      return e.im === 0 ? positive(Math.abs(e.re) * (1 - 2 ** -23)) : undefined;
    if (
      isFunction(e, 'Power') &&
      isNumber(e.op2) &&
      e.op2.im === 0 &&
      Number.isInteger(e.op2.re) &&
      e.op2.re >= 2 &&
      e.op2.re <= 4
    ) {
      const l = lowerMagnitude(e.op1, depth + 1);
      return l === undefined
        ? undefined
        : positive(l ** e.op2.re * (1 - 2 ** -20));
    }
    if (isFunction(e, 'Multiply')) {
      // A rational factor `p/q` is applied last, as the shader does (see
      // `range`): a division of the product of the other factors by `q`,
      // then a product by `p`, each with a margin of 2⁻²⁰.
      const rationals = e.ops.filter(isExactRationalDivisor);
      if (rationals.length > 1 || rationals.length === e.nops) return undefined;
      let l = 1;
      for (const op of e.ops) {
        if (isExactRationalDivisor(op)) continue;
        const f = lowerMagnitude(op, depth + 1);
        if (f === undefined) return undefined;
        l *= f;
        // A partial product below the smallest normal f32 can be flushed to
        // 0, and a later factor does not bring it back: 2⁻¹⁰⁰ keeps a margin.
        if (!(l >= 2 ** -100)) return undefined;
      }
      l *= 1 - e.nops * 2 ** -22;
      const rational =
        rationals[0] === undefined
          ? undefined
          : exactRationalDivisor(rationals[0]);
      if (rational !== undefined) {
        l = (l / rational.q) * (1 - 2 ** -20);
        if (!(l >= 2 ** -100)) return undefined;
        l *= Math.abs(rational.p) * (1 - 2 ** -20);
      }
      return positive(l);
    }
    const r = range(e, depth + 1);
    if (r === undefined || (r[0] <= 0 && r[1] >= 0)) return undefined;
    return positive(Math.min(Math.abs(r[0]), Math.abs(r[1])));
  };
  return { finite, magnitude: (e) => magnitude(e) };
}

/**
 * The names that the compiled code writes, by the user-function registry
 * of the compilation (`gpuRecordCallSiteFacts`): the target of each
 * `Assign` or `Declare` in the root, in the body of each function that it
 * calls, and in the value of each symbol that it reads. `'all'` when the
 * walk stopped before it saw every node. The declared type of such a name
 * holds for the value that the host passes, not for the value that the
 * code assigns: `x ≔ exp(x)` with `x` declared `real` is `+∞` in f32 for
 * `x > 88.7`. `gpuFiniteProof` therefore does not read it.
 */
const GPU_WRITTEN_NAMES = new WeakMap<object, ReadonlySet<string> | 'all'>();

/** What is known of the value of one parameter of a user function on the
 * shader targets: the value type of `CompileTarget.gpuParameterFacts`,
 * which declares the fields. */
type GPUParameterFact =
  NonNullable<
    CompileTarget<Expression>['gpuParameterFacts']
  > extends ReadonlyMap<string, infer V>
    ? V
    : never;

/**
 * The facts of the call sites of each user function that the compiled
 * expression calls, by the user-function registry of the compilation
 * (`gpuRecordCallSiteFacts`): for each function, one fact for each
 * parameter position. A registry with no entry (the shader route, the
 * `compileFunction` route) has no call-site facts.
 */
const GPU_CALL_SITE_FACTS = new WeakMap<
  object,
  ReadonlyMap<string, readonly GPUParameterFact[]>
>();

/**
 * The names that the body of a function literal binds again or writes, so
 * that a parameter of that name does not keep the value of its argument in
 * the whole body: a name bound by a binder inside the body (a lambda
 * parameter, the index of a `Sum`, a local of a nested `Block`), and the
 * target of an `Assign` or a `Declare` anywhere in the body. The bindings of
 * the body node itself are not counted: the canonical body is a `Block`
 * whose scope is the scope of the literal, which binds the parameters.
 */
function gpuReboundNames(body: Expression): Set<string> {
  const names = new Set<string>();
  // A body can be a graph that shares nodes; each node is read once, so the
  // work is the number of distinct nodes, not the number of paths.
  const seen = new Set<Expression>();
  const visit = (e: Expression, top: boolean): void => {
    if (!isFunction(e) || seen.has(e)) return;
    seen.add(e);
    if (!top) for (const n of boundVariableNames(e)) names.add(n);
    if (
      (e.operator === 'Assign' || e.operator === 'Declare') &&
      isSymbol(e.op1)
    )
      names.add(e.op1.symbol);
    for (const op of e.ops) visit(op, false);
  };
  visit(body, true);
  return names;
}

/**
 * Record, on the user-function registry of `target`, the names that the
 * compiled code writes (`GPU_WRITTEN_NAMES`), and which parameters of the
 * user functions that `root` calls are finite for certain because of their
 * call sites (`GPU_CALL_SITE_FACTS`, read by
 * `gpuDefinitionParameterFacts`). `root` is the expression that the root
 * target compiles, after every rewrite of the root.
 *
 * The walk reads the root, the body of each user function that it calls
 * (directly or through another body) or uses as a value, and the value of
 * each symbol that it reads, since the shader can compute that value in
 * place of the symbol. A call whose head the caller maps with `functions`
 * or `operators` is the caller's code and is not followed; a `vars` entry
 * maps a symbol, not a head, and a call of a name that `vars` maps still
 * calls the engine's definition. When the literal of a called function
 * cannot be read, or the walk passes 100,000 nodes, every name counts as
 * written (`'all'`) and no call-site fact is recorded.
 *
 * The shader holds every call of an emitted definition: the calls of the
 * root, of the bodies of the functions that it calls, and of the values
 * that the shader computes in place of a symbol. A parameter is finite for
 * certain when, at every one of these call sites, the argument at its
 * position is finite for certain (`gpuProvablyFinite`) in the context of
 * the caller: in the root, the declared inputs; in the body of another
 * function, also the parameters of that function that are themselves
 * finite for certain. The argument is proven from the declarations of the
 * host and the operators of the argument, as any guarded operand is: with
 * `x` declared `real<-1e15..1e15>`, `F(x)` makes the parameter of `F`
 * finite, of magnitude at most 10¹⁵, and `sin(a)` in the body of
 * `F(a) := sin(a)` is the built-in `sin(a)`. A finite parameter also has a
 * bound of its magnitude: the largest magnitude of its arguments
 * (`magnitude` of `gpuFiniteProof`), or no bound when one argument has
 * none. A parameter that the host declared with a range also has the facts
 * of that range (`gpuCombinedFact`).
 *
 * The functions are taken in an order where each caller comes before the
 * functions it calls, so the arguments of a call from a body are proven
 * with the final facts of the parameters of that body. The shader targets
 * refuse a recursive definition, so such an order exists; a function on a
 * cycle of calls has no finite parameter. This is sound by induction along
 * the order: the arguments of the root are proven from the declarations,
 * and a call from a body passes values computed from parameters whose facts
 * are already proven.
 *
 * A function has no finite parameter when its set of call sites is not
 * fully known: it is used as a value (`Map(F, L)`, or passed to another
 * function), a binder of the expression binds its name, or a call passes
 * another number of arguments than it has parameters. A position is not
 * finite when the body binds the name of the parameter again or assigns
 * it, or when the parameter is a rest or destructuring parameter. An
 * argument that reads a name bound by an enclosing binder of its call (a
 * local of a `Block`, the parameter of a lambda, the index of a `Sum`) is
 * not finite for certain here.
 */
export function gpuRecordCallSiteFacts(
  root: Expression,
  target: CompileTarget<Expression>
): void {
  const registry = target.userFunctions;
  const caller = target.cse?.harvestOptions;
  if (registry === undefined || caller === undefined) return;
  const engine = root.engine;
  // A head the caller gives code of its own (`functions`, `operators`) is
  // not a call of the engine's definition.
  const overridden = (h: string): boolean =>
    caller.isOverriddenOperator?.(h) === true ||
    target.unrollSkipHeads?.has(h) === true ||
    target.overridesHead?.(h) === true;
  const written = new Set<string>();
  let unreadable = false;
  const literals = new Map<string, Expression | undefined>();
  const literalOf = (h: string): Expression | undefined => {
    if (literals.has(h)) return literals.get(h);
    let literal: Expression | undefined;
    if (!overridden(h)) {
      try {
        literal = BaseCompiler.userFunctionLiteral(engine, h);
      } catch (e) {
        if (e instanceof Error && e.name === 'CancellationError') throw e;
        unreadable = true;
      }
    }
    literals.set(h, literal);
    return literal;
  };
  type Site = {
    caller: string | undefined;
    callee: string;
    args: ReadonlyArray<Expression>;
    bound: ReadonlySet<string>;
  };
  const sites: Site[] = [];
  // The parameter names of each function reached (`''` for a parameter
  // with no single name), and whether the parameter at each position keeps
  // the value of its argument in the whole body.
  const functions = new Map<
    string,
    { names: ReadonlyArray<string>; stable: ReadonlyArray<boolean> }
  >();
  // The functions whose calls are not all in sight.
  const escaped = new Set<string>();
  const values = new Set<string>();
  const visited = new Map<string | undefined, Set<Expression>>();
  let visits = 0;
  const pending: Array<[Expression, string | undefined]> = [[root, undefined]];
  const reach = (h: string, literal: Expression): void => {
    if (functions.has(h) || !isFunction(literal, 'Function')) return;
    // The walk reads the body that the emission compiles, not the stored
    // one: the angular unit rewritten, the collection-valued calls inlined
    // and the fixed-width collections unrolled (`definitionBodyExpr()`). In
    // degree mode the stored `arctan(c)` is at most π/2, but the shader
    // computes `57.29578 * atan(c)`, up to 90, and an argument bound read
    // from the stored body would be wrong.
    let body: Expression;
    try {
      body = definitionBodyExpr(literal, target, registry, h);
    } catch (e) {
      if (e instanceof Error && e.name === 'CancellationError') throw e;
      unreadable = true;
      return;
    }
    const rebound = gpuReboundNames(body);
    const params = literal.ops.slice(1);
    const names = params.map((p) => functionLiteralParameterName(p));
    functions.set(h, {
      names,
      stable: params.map(
        (p, i) =>
          !isRestParameter(p) && names[i] !== '' && !rebound.has(names[i])
      ),
    });
    pending.push([body, h]);
  };
  const walk = (
    node: Expression,
    callerName: string | undefined,
    bound: ReadonlySet<string>,
    top = false
  ): void => {
    if (isSymbol(node)) {
      const s = node.symbol;
      if (bound.has(s)) return;
      if (
        callerName !== undefined &&
        functions.get(callerName)!.names.includes(s)
      )
        return;
      const literal = literalOf(s);
      // A function used as a value: the shader can call it, and its calls
      // are not all in sight.
      if (literal !== undefined) {
        escaped.add(s);
        reach(s, literal);
      } else if (!values.has(s)) {
        // A value that the shader may compute in place of the symbol, read
        // as the shader computes it: rewritten for the angular unit
        // (`foldedValueInRadians`, as `bakedValue` in `gpuFiniteProof`
        // reads it).
        values.add(s);
        const value = engine._getSymbolValue(s);
        if (value !== undefined)
          pending.push([
            BaseCompiler.foldedValueInRadians(value, target),
            undefined,
          ]);
      }
      return;
    }
    if (!isFunction(node) || unreadable) return;
    // The walk is bounded: past the limit, every name counts as written.
    if (++visits > 100_000) {
      unreadable = true;
      return;
    }
    // A node reached again in the same body with no enclosing binder adds
    // nothing: the root can be a DAG with many paths to one node
    // (`gpu-shared-calls.ts`).
    if (bound.size === 0) {
      let seenHere = visited.get(callerName);
      if (seenHere === undefined)
        visited.set(callerName, (seenHere = new Set()));
      if (seenHere.has(node)) return;
      seenHere.add(node);
    }
    const h = node.operator;
    if ((h === 'Assign' || h === 'Declare') && isSymbol(node.op1))
      written.add(node.op1.symbol);
    const literal = literalOf(h);
    if (literal !== undefined) {
      if (bound.has(h)) escaped.add(h);
      else sites.push({ caller: callerName, callee: h, args: node.ops, bound });
      reach(h, literal);
    }
    // The parameters of the calling function are not bound names at the
    // top node of its body: the scope of that node (the canonical `Block`)
    // binds them, and their facts describe them. A binder below it that
    // binds a name of a parameter again (`Sum(F(c), (c, 1, 10))`) hides
    // the parameter: an argument that reads that name is not finite here.
    const own =
      callerName === undefined || !top ? [] : functions.get(callerName)!.names;
    const binds = boundVariableNames(node).filter((n) => !own.includes(n));
    // A binder that binds the name of a user function hides it: a call of
    // that name below is not a call of the function.
    for (const name of binds) {
      const shadowed = literalOf(name);
      if (shadowed !== undefined) {
        escaped.add(name);
        reach(name, shadowed);
      }
    }
    const inner = binds.length === 0 ? bound : new Set([...bound, ...binds]);
    for (const op of node.ops) walk(op, callerName, inner);
  };
  while (pending.length > 0) {
    const [node, callerName] = pending.pop()!;
    walk(node, callerName, new Set(), callerName !== undefined);
  }
  // A walk that stopped early has not seen every write: every name may be
  // written then.
  GPU_WRITTEN_NAMES.set(registry, unreadable ? 'all' : written);
  if (unreadable || functions.size === 0) return;

  // The facts of each function are final before the facts of the functions
  // it calls are computed: the shader targets refuse a recursive definition,
  // so the calls between the functions reached form a graph with no cycle,
  // and the functions are taken in an order where each caller comes before
  // its callees (Kahn's algorithm). The argument of a call site is then
  // proven with the final facts of its caller, bound of the magnitude
  // included: with `G(c) := F(c, 2c)` and `G(k)` for `k: real<0..10>`, `2c`
  // is at most 20. A function on a cycle has no finite parameter.
  const callers = new Map<string, Set<string>>();
  for (const h of functions.keys()) callers.set(h, new Set());
  for (const site of sites)
    if (site.caller !== undefined && site.caller !== site.callee)
      callers.get(site.callee)!.add(site.caller);
    else if (site.caller === site.callee) escaped.add(site.callee);
  const order: string[] = [];
  const waiting = new Map<string, number>();
  for (const [h, set] of callers) waiting.set(h, set.size);
  const ready = [...functions.keys()].filter((h) => waiting.get(h) === 0);
  while (ready.length > 0) {
    const h = ready.pop()!;
    order.push(h);
    for (const [callee, set] of callers)
      if (set.has(h)) {
        const n = waiting.get(callee)! - 1;
        waiting.set(callee, n);
        if (n === 0) ready.push(callee);
      }
  }
  const result = new Map<string, GPUParameterFact[]>();
  for (const [h, { names }] of functions)
    result.set(
      h,
      names.map(() => ({ finite: false, magnitude: undefined }))
    );
  // The target that reads an argument of `site`: the root target, with the
  // parameters of the calling function bound and described by their final
  // facts (`result`), which include the ranges that the host declared for
  // them (`gpuDeclaredParameterRanges`).
  const contextOf = (site: Site): CompileTarget<Expression> => {
    if (site.caller === undefined) return target;
    const names = functions.get(site.caller)!.names;
    const callerFacts = result.get(site.caller)!;
    const facts = new Map<string, GPUParameterFact>();
    names.forEach((p, i) => {
      if (p !== '') facts.set(p, callerFacts[i]);
    });
    const boundVars = new Set(target.boundVars ?? []);
    for (const p of names) if (p !== '') boundVars.add(p);
    return { ...target, boundVars, gpuParameterFacts: facts };
  };
  // Does `e` read a name of `bound` (a name that an enclosing binder of the
  // call binds)?
  const readsBound = (e: Expression, bound: ReadonlySet<string>): boolean => {
    if (bound.size === 0) return false;
    if (isSymbol(e)) return bound.has(e.symbol);
    if (!isFunction(e)) return false;
    return bound.has(e.operator) || e.ops.some((op) => readsBound(op, bound));
  };
  for (const h of order) {
    const { names, stable } = functions.get(h)!;
    const own = sites.filter((site) => site.callee === h);
    const finite = stable.map((s) => s && !escaped.has(h));
    if (
      own.length === 0 ||
      own.some((site) => site.args.length !== names.length)
    )
      finite.fill(false);
    const bounds: (number | undefined)[] = names.map(() => 0);
    for (const site of own) {
      if (!finite.some((f) => f)) break;
      const context = contextOf(site);
      const proof = gpuFiniteProof(context, true);
      site.args.forEach((arg, i) => {
        if (!finite[i]) return;
        // A scalar argument only. A call that passes a point or a list takes
        // a copy of the function whose parameter has that shape, and the
        // copy compiles the body differently: `Abs(p)` of a point is the
        // norm `length(p)`, which can overflow in f32 when each component is
        // finite.
        if (
          gpuOperandShape(arg) !== 'scalar' ||
          readsBound(arg, site.bound) ||
          !gpuProvablyFinite(arg, context)
        ) {
          finite[i] = false;
          return;
        }
        let m: number | undefined;
        try {
          m = proof?.magnitude(arg);
        } catch (err) {
          if (err instanceof Error && err.name === 'CancellationError')
            throw err;
          m = undefined;
        }
        const known = bounds[i];
        bounds[i] =
          m === undefined || known === undefined
            ? undefined
            : Math.max(known, m);
      });
    }
    const declared = gpuDeclaredParameterRanges(root.engine, h, names.length);
    result.set(
      h,
      names.map((_, i) =>
        gpuCombinedFact(stable[i], finite[i] ? bounds[i] : null, declared?.[i])
      )
    );
  }
  GPU_CALL_SITE_FACTS.set(registry, result);
}

/**
 * The fact of one parameter from what its call sites show and from the
 * range the host declared for it. `sites` is the bound of the magnitude of
 * the arguments when every call passes a value that is finite for certain
 * (`undefined` when one argument has no bound), or `null` when one call
 * does not. `declared` is the declared range, or `undefined`. A parameter
 * that the body binds again or assigns (`stable` false) has no fact: the
 * body reads another value under its name. When both give a bound, the
 * smaller one is kept.
 */
function gpuCombinedFact(
  stable: boolean,
  sites: number | undefined | null,
  declared: readonly [number, number] | undefined
): GPUParameterFact {
  if (!stable) return { finite: false, magnitude: undefined };
  if (declared === undefined)
    return sites === null
      ? { finite: false, magnitude: undefined }
      : { finite: true, magnitude: sites };
  const bound = Math.max(Math.abs(declared[0]), Math.abs(declared[1]));
  return {
    finite: true,
    magnitude:
      sites === null || sites === undefined ? bound : Math.min(sites, bound),
    range: declared,
  };
}

/**
 * The facts of the scalar parameters of the user function `id`, for the
 * body of its definition (`CompileTarget.gpuParameterFacts`). A parameter
 * has a fact when one of these holds:
 *
 * - every call of `id` in the compiled expression passes a value that is
 *   finite for certain at its position (`gpuRecordCallSiteFacts`); the
 *   fact has the bound of the magnitude of those values;
 * - the host declared the parameter with a numeric type of two finite
 *   bounds, of magnitude at most the largest f32, in the signature of the
 *   definition (`F: (real<-1..1>) -> real`); the fact has the bound and the
 *   interval of that range. The declaration is a promise of the host, as
 *   the declared range of an input is: an argument outside the range is a
 *   value outside its declared type, for which the compiled value is
 *   unspecified. A bare `real` parameter is not enough: the argument
 *   `exp(x)` is a `real` that is `+∞` in f32 for `x > 88.7`.
 *
 * When both hold, the smaller bound is kept. Only a parameter whose shader
 * type is a float has facts, and not one that the body binds again or
 * assigns: the body then reads another value under its name. With no
 * recorded call sites (the shader route, `compileFunction`), only the
 * declared ranges give facts.
 *
 * `positions` is given for a variant whose parameters are a part of the
 * parameters of `id` (`ensureBoundListVariantEmitted`): the facts of the
 * parameter `i` are then read at the position `positions.at[i]` of the
 * declaration of `id`, which has `positions.arity` parameters.
 */
export function gpuDefinitionParameterFacts(
  id: string,
  params: ReadonlyArray<string>,
  shaderTypes: ReadonlyArray<string>,
  body: Expression,
  target: CompileTarget<Expression>,
  positions?: { readonly at: ReadonlyArray<number>; readonly arity: number }
): ReadonlyMap<string, GPUParameterFact> | undefined {
  const callSites =
    target.userFunctions === undefined
      ? undefined
      : GPU_CALL_SITE_FACTS.get(target.userFunctions)?.get(id);
  const declared = gpuDeclaredParameterRanges(
    body.engine,
    id,
    positions?.arity ?? params.length
  );
  if (callSites === undefined && declared === undefined) return undefined;
  const rebound = gpuReboundNames(body);
  const facts = new Map<string, GPUParameterFact>();
  params.forEach((p, i) => {
    if (shaderTypes[i] !== 'float') return;
    if (rebound.has(p)) return;
    // A recorded fact already holds the declared range
    // (`gpuRecordCallSiteFacts`).
    const at = positions?.at[i] ?? i;
    const site = callSites?.[at];
    const fact =
      site?.finite === true
        ? site
        : gpuCombinedFact(true, null, declared?.[at]);
    if (fact.finite) facts.set(p, fact);
  });
  return facts.size === 0 ? undefined : facts;
}

/**
 * The declared range of each parameter of the user function `id`, from the
 * signature that the host declared (`F: (real<-1..1>, real) -> real` gives
 * `[[-1, 1], undefined]`), or `undefined` when no parameter has one. A
 * range counts when the parameter type is a finite real numeric type with
 * two finite bounds of magnitude at most the largest f32. A signature that
 * the engine inferred from the body, and the bare type `function`, give no
 * range: they are not a promise of the host.
 */
function gpuDeclaredParameterRanges(
  engine: Expression['engine'],
  id: string,
  count: number
): ReadonlyArray<readonly [number, number] | undefined> | undefined {
  const def = engine.lookupDefinition(id);
  let declared: Type | undefined;
  if (isValueDef(def) && def.value.inferredType !== true)
    declared = def.value.type.type;
  else if (isOperatorDef(def) && def.operator.inferredSignature !== true)
    declared = def.operator.signature.type;
  if (typeof declared !== 'object' || declared.kind !== 'signature')
    return undefined;
  const args = declared.args;
  if (
    args === undefined ||
    args.length !== count ||
    declared.optArgs !== undefined ||
    declared.variadicArg !== undefined
  )
    return undefined;
  let any = false;
  const ranges = args.map((a) => {
    const t = a.type;
    if (typeof t !== 'object' || t.kind !== 'numeric') return undefined;
    if (!isSubtype(t, 'finite_real')) return undefined;
    const { lower, upper } = t;
    if (lower === undefined || upper === undefined) return undefined;
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) return undefined;
    if (Math.max(Math.abs(lower), Math.abs(upper)) > GPU_F32_MAX)
      return undefined;
    any = true;
    return [lower, upper] as const;
  });
  return any ? ranges : undefined;
}
