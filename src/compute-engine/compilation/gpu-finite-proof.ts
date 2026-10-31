// The proof that a shader expression stays finite, and the call-site facts it
// records.

import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import {
  functionLiteralParameterName,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import { gpuOperandShape } from './gpu-shapes.js';

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
 * (`gpuNaNSafeLibrary`) can be the built-in? Five conditions:
 *
 * - its static type is a finite real, or it is a `vec2`–`vec4` whose cells
 *   are finite reals (`gpuFiniteRealCells`). The rules below then apply to
 *   each component: a written vector `[t, k, 1]` is finite when each of its
 *   components is, and arithmetic over vectors is componentwise. Inside the
 *   body of an emitted user-function definition, a scalar operand that
 *   reads a parameter is typed `number` (the engine types a parameter so),
 *   and is then proven from its parts alone: each symbol it reads must be a
 *   finite real by its own type or its value, each head must be one that
 *   the last condition accepts, and a constant subtree must have a real
 *   value;
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
 * - a scalar parameter of the user function whose body is compiled
 *   (`CompileTarget.gpuParameterFacts`) is finite for certain when every
 *   call of the function passes, at its position, an argument that is
 *   finite for certain by these rules in the context of the call
 *   (`gpuRecordCallSiteFacts`). The shader holds every call of the
 *   definition, and the expression route of `compile()` sees them all:
 *   `F(x, y) + F(2x, y)` with `x` and `y` declared `real` proves both
 *   parameters of `F`. A call from the body of another function can pass a
 *   parameter of that function, which counts when it is itself finite for
 *   certain. The magnitude of such a parameter is bounded when each
 *   argument has a bound (a literal, a declared range). A declared
 *   parameter type (`F: (real, real) -> real`) does NOT make the parameter
 *   finite: the argument `exp(x)` is a `real` but overflows to `+∞` in f32
 *   before the call, and the check of each argument applies the overflow
 *   rules below. A function used as a value, and a parameter that the body
 *   binds again or assigns, have no facts. The shader route and
 *   `compileFunction` record no call sites (and open no session of the
 *   common-subexpression pass, without which nothing is proven), so every
 *   parameter keeps the guard there;
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
 *   or negation of such values (the sum of the bounds of the operands), or
 *   `abs`, `min` or `max` of real scalar operands of known magnitude (the
 *   largest bound of the operands; `|(x, x)|` is a Euclidean norm and has
 *   no bound from this rule). Each head is in
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
 *   - a quotient by a number literal (`quotientStaysFinite`), and a
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
 *   finite (`k: real<0..10>`, `t: real<0..6.3>`). The product `a·b` of two
 *   parameters of a definition keeps the guard for the same reason, unless
 *   the arguments of every call bound the magnitude of both.
 *
 * The guard costs a bit test and a selection per call: about 10% of the
 * frame time of Tycho's `voronoi-diagram` on WebGPU. On a finite argument it
 * does not change the value: measured on an Apple M5 Max over WebGPU, the
 * guarded and the built-in `sin` and `cos` give the same bits on 39,200
 * inputs.
 */
export function gpuProvablyFinite(
  x: Expression,
  target: CompileTarget<Expression>,
  guardOperand = false
): boolean {
  // The static type of an expression that reads a parameter of the body
  // being compiled says nothing (the parameter is typed `number`), so a
  // scalar operand is then proven from its parts alone (`strict`).
  let strict = false;
  if (!gpuFiniteRealCells(x)) {
    const facts = target.gpuParameterFacts;
    if (facts === undefined || facts.size === 0) return false;
    if (gpuOperandShape(x) !== 'scalar') return false;
    strict = true;
  }
  return gpuFiniteProof(target, strict)?.finite(x, guardOperand) === true;
}

/**
 * The two tests of the proof of `gpuProvablyFinite`, for one target:
 * `finite(e)`, is `e` finite for certain in the shader, and `magnitude(e)`,
 * the largest magnitude that the finite `e` can have there, or `undefined`
 * when no bound is known. `undefined` when the caller of the compilation is
 * not known.
 *
 * With `strict`, the static type of a node is not read as evidence that it
 * is real, since a node that reads a parameter of the body being compiled is
 * typed `number`: each symbol must then be a finite real by its own type
 * (or by its value), and a constant subtree must have a real value. The
 * heads that `finite` accepts give a real result from real operands.
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
  // The parameters of the user-function body being compiled
  // (`CompileTarget.gpuParameterFacts`). A parameter that is finite for
  // certain is accepted whatever its own type says.
  const facts = target.gpuParameterFacts;
  // A name that the compiled code writes holds the value it assigns, which
  // its declared type does not describe (`GPU_WRITTEN_NAMES`).
  const written =
    target.userFunctions === undefined
      ? undefined
      : GPU_WRITTEN_NAMES.get(target.userFunctions);
  const isWritten = (s: string): boolean =>
    written === 'all' || written?.has(s) === true;
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
  const bakedValue = (e: Expression & { symbol: string }) => {
    if (isMapped(e.symbol) || target.boundVars?.has(e.symbol) === true)
      return undefined;
    if (target.var(e.symbol) !== undefined) return undefined;
    const stored = e.engine._getSymbolValue(e.symbol);
    return stored === undefined
      ? undefined
      : BaseCompiler.foldedValueInRadians(stored, target);
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
      // A field of the uniform parameter struct of `compileFieldFunction()`
      // (`hostInputVars`) is also the host's input of the declared type.
      const selfMapped =
        mapped &&
        e.valueDefinition?.isConstant !== true &&
        (target.var(e.symbol) === e.symbol ||
          target.hostInputVars?.has(e.symbol) === true);
      result =
        (baked !== undefined || e.valueDefinition?.inferredType !== true) &&
        (!strict || baked !== undefined || gpuFiniteRealCells(e)) &&
        (!mapped || selfMapped) &&
        (value === undefined ||
          (!reading.has(e.symbol) && (reading.add(e.symbol), finite(value))));
      reading.delete(e.symbol);
    } else if (
      isFunction(e) &&
      caller.isOverriddenOperator?.(e.operator) !== true &&
      e.ops.every((op) => finite(op, top && sum))
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
      else if (e.operator === 'Power') result = top && smallPowerStaysFinite(e);
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
      // Over finite operands, `Smoothstep` has no defined value when its two
      // edges are equal. The static type of the node excludes it for symbols,
      // but a parameter of the body being compiled is typed `number`, and so
      // is the node: then the edges must be two different literals.
      else if (
        facts !== undefined &&
        e.operator === 'Smoothstep' &&
        !e.type.matches('finite_real')
      )
        result = isNumber(e.op1) && isNumber(e.op2) && !e.op1.isSame(e.op2);
      else result = GPU_F32_BOUNDED_HEADS.has(e.operator);
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
  // of the real scalar operands of `abs`, `min` and `max`; else the bounds
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
      e.valueDefinition?.inferredType === true
    )
      return undefined;
    const t = e.type.type;
    if (typeof t !== 'object' || t.kind !== 'numeric') return undefined;
    const { lower, upper } = t;
    if (lower === undefined || upper === undefined) return undefined;
    const m = Math.max(Math.abs(lower), Math.abs(upper));
    return Number.isFinite(m) ? m : undefined;
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
  // at most half of `a`). Any other divisor is refused: `x / 10⁻³⁰` is
  // `+∞` in f32 for `|x| ≥ 3.5·10⁸`, and a divisor that can be 0 or tiny
  // makes the quotient `±∞` or NaN.
  const quotientStaysFinite = (e: Expression): boolean => {
    if (!isFunction(e) || !isNumber(e.op2) || e.op2.im !== 0) return false;
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
      d.valueDefinition?.inferredType !== true
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
  // A bound of the magnitude of the base `b` of a small power, for three
  // forms only: a term, the negation of a term, or a sum or a difference of
  // such terms (the sum of their bounds). A term is an atom, or a product of
  // one atom that is not a literal and of one or more number literals (the
  // product of the bounds: `|c|·m`). An atom is a finite number literal,
  // `sin` or `cos` of a real operand (at most 1), or a symbol that the
  // shader reads as the host's input with a DECLARED type that has a finite
  // numeric range (`x: real<-10..10>`). A symbol whose type is inferred,
  // whose value the shader computes in its place, that the compiled code
  // writes, or that is a parameter of the body being compiled has no bound
  // here. Any other form gives `undefined`: a product of two atoms that are
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
      t.valueDefinition?.inferredType === true
    )
      return undefined;
    const type = t.type.type;
    if (typeof type !== 'object' || type.kind !== 'numeric') return undefined;
    const { lower, upper } = type;
    if (lower === undefined || upper === undefined) return undefined;
    const m = Math.max(Math.abs(lower), Math.abs(upper));
    return Number.isFinite(m) ? m : undefined;
  };
  return { finite, magnitude: (e) => magnitude(e) };
}

/** What is known of the value of one parameter of a user function on the
 * shader targets (`CompileTarget.gpuParameterFacts`). */
type GPUParameterFact = {
  readonly finite: boolean;
  readonly magnitude: number | undefined;
};

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
 * The names that the compiled code writes, by the user-function registry
 * of the compilation (`gpuRecordCallSiteFacts`): the target of each
 * `Assign` or `Declare` in the root, in the body of each function that it
 * reaches, and in the value of each symbol that it reads. `'all'` when the
 * walk stopped before it saw every node. The declared type of such a name
 * holds for the value that the host passes, not for the value that the code
 * assigns: `x ≔ exp(x)` with `x` declared `real` is `+∞` in f32 for
 * `x > 88.7`. `gpuFiniteProof` therefore does not read it.
 */
const GPU_WRITTEN_NAMES = new WeakMap<object, ReadonlySet<string> | 'all'>();

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
  const visit = (e: Expression, top: boolean): void => {
    if (!isFunction(e)) return;
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
 * Record, on the user-function registry of `target`, which parameters of
 * the user functions that `root` calls are finite for certain because of
 * their call sites, for the definitions that the compilation emits
 * (`gpuDefinitionParameterFacts`). `root` is the expression that the root
 * target compiles, after every rewrite of the root.
 *
 * The shader holds every call of an emitted definition: the calls of the
 * root, of the bodies of the functions that it calls (directly or through
 * another body), and of the values that the shader computes in place of a
 * symbol. A parameter is finite for certain when, at every one of these call
 * sites, the argument at its position is finite for certain
 * (`gpuProvablyFinite`) in the context of the caller: in the root, the
 * declared symbols; in the body of another function, also the parameters of
 * that function that are themselves finite for certain. The facts are the
 * greatest fixpoint of this rule: each parameter starts finite, and loses it
 * when a call site passes an argument that is not finite for certain under
 * the current facts, until nothing changes. This is sound by induction on
 * the depth of the calls: the arguments of the root are finite, and a call
 * from a body passes values computed by finite-preserving operations from
 * parameters that are finite. A recursive or mutually recursive call is one
 * more call site, checked as the others (the shader targets refuse a
 * recursive definition in any case).
 *
 * A bound of the magnitude of each finite parameter is then computed: the
 * largest magnitude of its arguments (`magnitude` of `gpuFiniteProof`), or
 * no bound when one argument has none. Each round reads the bounds of the
 * round before, starting from no bound at all, so the bounds of every round
 * are sound, and a fixed number of rounds is done.
 *
 * A function has no finite parameter when its set of call sites is not
 * fully known: it is used as a value (`Map(F, L)`, or passed to another
 * function), a binder of the expression binds its name, or a call passes
 * another number of arguments than it has parameters. A position is not
 * finite when the body binds the name of the parameter again or assigns
 * it, or when the parameter is a rest or destructuring parameter. An
 * argument that reads a name bound by an enclosing binder of its call (the
 * index of a `Sum`, a local of a `Block`, the parameter of a lambda) is not
 * finite for certain here. When the literal of a called function cannot be
 * read, or the walk passes 100,000 nodes, no fact is recorded at all.
 *
 * The walk also records the names that the compiled code writes
 * (`GPU_WRITTEN_NAMES`), or `'all'` when it stopped early. A call whose
 * head the caller maps with `functions` or `operators` is the caller's code
 * and is not followed; a `vars` entry maps a symbol, not a head, and a call
 * of a name that `vars` maps still calls the engine's definition.
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
  // not a call of the engine's definition. A `vars` entry is not such a
  // head: it maps a symbol, and the shader targets emit the engine's
  // definition for a call of a name that `vars` maps (`F(x)` with
  // `vars: { F: 'uF' }` calls `_fn_F`).
  const overridden = (h: string): boolean =>
    caller.isOverriddenOperator?.(h) === true ||
    target.unrollSkipHeads?.has(h) === true ||
    target.overridesHead?.(h) === true;
  // The names that the compiled code writes (`gpuWrittenNames`).
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
  const escaped = new Set<string>();
  const values = new Set<string>();
  const visited = new Map<string | undefined, Set<Expression>>();
  let visits = 0;
  const pending: Array<[Expression, string | undefined]> = [[root, undefined]];
  const reach = (h: string, literal: Expression): void => {
    if (functions.has(h) || !isFunction(literal, 'Function')) return;
    const body = literal.ops[0];
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
    bound: ReadonlySet<string>
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
      if (literal !== undefined) {
        // A function used as a value: its calls are not all in sight.
        escaped.add(s);
        reach(s, literal);
      } else if (!values.has(s)) {
        // A value that the shader may compute in place of the symbol, with
        // the calls it makes.
        values.add(s);
        const value = engine._getSymbolValue(s);
        if (value !== undefined) pending.push([value, undefined]);
      }
      return;
    }
    if (!isFunction(node) || unreadable) return;
    // The walk is bounded: past the limit, no fact is recorded.
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
    // The parameters of the calling function are not bound names here:
    // the scope of the body binds them, and their facts describe them.
    const own =
      callerName === undefined ? [] : functions.get(callerName)!.names;
    const binds = boundVariableNames(node).filter((n) => !own.includes(n));
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
    walk(node, callerName, new Set());
  }
  // A walk that stopped early has not seen every write: every name may be
  // written then.
  GPU_WRITTEN_NAMES.set(registry, unreadable ? 'all' : written);
  if (unreadable || functions.size === 0) return;

  const finite = new Map<string, boolean[]>();
  for (const [h, { stable }] of functions)
    finite.set(
      h,
      stable.map((s) => s && !escaped.has(h))
    );
  for (const site of sites)
    if (site.args.length !== functions.get(site.callee)!.names.length)
      finite.get(site.callee)!.fill(false);
  const magnitudes = new Map<string, (number | undefined)[]>();
  for (const [h, { names }] of functions)
    magnitudes.set(
      h,
      names.map(() => undefined)
    );
  // The target that reads an argument of `site`: the root target, with the
  // parameters of the calling function bound and described by their facts.
  const contextOf = (site: Site): CompileTarget<Expression> => {
    if (site.caller === undefined) return target;
    const { names } = functions.get(site.caller)!;
    const facts = new Map<string, GPUParameterFact>();
    names.forEach((p, i) => {
      if (p !== '')
        facts.set(p, {
          finite: finite.get(site.caller!)![i],
          magnitude: magnitudes.get(site.caller!)![i],
        });
    });
    const boundVars = new Set(target.boundVars ?? []);
    for (const p of names) if (p !== '') boundVars.add(p);
    return { ...target, boundVars, gpuParameterFacts: facts };
  };
  const readsBound = (e: Expression, bound: ReadonlySet<string>): boolean => {
    if (bound.size === 0) return false;
    if (isSymbol(e)) return bound.has(e.symbol);
    if (!isFunction(e)) return false;
    return bound.has(e.operator) || e.ops.some((op) => readsBound(op, bound));
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const site of sites) {
      const facts = finite.get(site.callee)!;
      if (!facts.some((f) => f)) continue;
      const context = contextOf(site);
      site.args.forEach((arg, i) => {
        if (!facts[i]) return;
        if (readsBound(arg, site.bound) || !gpuProvablyFinite(arg, context)) {
          facts[i] = false;
          changed = true;
        }
      });
    }
  }
  for (let round = 0; round <= functions.size; round++) {
    const next = new Map<string, (number | undefined)[]>();
    for (const [h, { names }] of functions)
      next.set(
        h,
        names.map(() => -1)
      );
    for (const site of sites) {
      const facts = finite.get(site.callee)!;
      const bounds = next.get(site.callee)!;
      const proof = facts.some((f) => f)
        ? gpuFiniteProof(contextOf(site), true)
        : undefined;
      site.args.forEach((arg, i) => {
        const m = facts[i] ? proof?.magnitude(arg) : undefined;
        const known = bounds[i];
        bounds[i] =
          m === undefined || known === undefined
            ? undefined
            : Math.max(known, m);
      });
    }
    for (const bounds of next.values())
      bounds.forEach((m, i) => {
        if (m === -1) bounds[i] = undefined;
      });
    for (const [h, bounds] of next) magnitudes.set(h, bounds);
  }
  const result = new Map<string, GPUParameterFact[]>();
  for (const [h, facts] of finite)
    result.set(
      h,
      facts.map((f, i) => ({
        finite: f,
        magnitude: f ? magnitudes.get(h)![i] : undefined,
      }))
    );
  GPU_CALL_SITE_FACTS.set(registry, result);
}

/**
 * The facts of the scalar parameters of the user function `id`, for the
 * body of its definition (`CompileTarget.gpuParameterFacts`): a parameter
 * is finite for certain when every call of `id` in the compiled expression
 * passes a value that is finite for certain at its position
 * (`gpuRecordCallSiteFacts`), with the bound of the magnitude of those
 * values. A declared parameter type is not a fact: the argument `exp(x)` is
 * a `real` that is `+∞` in f32 for `x > 88.7`. Only a parameter whose
 * shader type is a float has facts, and not one that the body binds again
 * or assigns: the body then reads another value under its name. With no
 * recorded call sites (the shader route, `compileFunction`), no parameter
 * has facts.
 */
export function gpuDefinitionParameterFacts(
  id: string,
  params: ReadonlyArray<string>,
  shaderTypes: ReadonlyArray<string>,
  body: Expression,
  target: CompileTarget<Expression>,
  isWGSL: boolean
): ReadonlyMap<string, GPUParameterFact> | undefined {
  const callSites =
    target.userFunctions === undefined
      ? undefined
      : GPU_CALL_SITE_FACTS.get(target.userFunctions)?.get(id);
  if (callSites === undefined) return undefined;
  const rebound = gpuReboundNames(body);
  const facts = new Map<string, GPUParameterFact>();
  params.forEach((p, i) => {
    if (shaderTypes[i] !== (isWGSL ? 'f32' : 'float')) return;
    if (rebound.has(p)) return;
    const site = callSites[i];
    if (site?.finite === true) facts.set(p, site);
  });
  return facts.size === 0 ? undefined : facts;
}
