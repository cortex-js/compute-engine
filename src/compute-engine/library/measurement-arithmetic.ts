/**
 * Arithmetic of Measurement expressions, and the VALUE KIND of the head
 * `Measurement` (`MEASUREMENT_ARITHMETIC`, the `arithmetic` field of its
 * definition in `library/arithmetic.ts`).
 *
 * A `Measurement(value, error)` carries a nominal `value` and a 1σ absolute
 * `error`. It is a value of the kind type `measurement`: an opaque type,
 * disjoint from every numeric type, so that the number rules (`x - x` is 0,
 * `x/x` is 1) do not apply to it, and admitted where a number is admitted
 * (`admittedAs: 'number'`). The arithmetic operators reach the hooks below
 * through the kind dispatch (`boxed-expression/kind-dispatch.ts`), and the
 * comparisons reach `compare` and the `eq` handler of the definition
 * (`measurementEq()`) through `boxed-expression/kind-compare.ts`. See
 * `docs/plans/2026-10-26-value-kinds.md`, sections 4.7 and 13.
 *
 * Errors propagate to first order, with independent errors in quadrature:
 * `σ_f² = Σ |∂f/∂xᵢ|²·σᵢ²`. Each term is the square of the MODULUS of a
 * partial derivative, so a term is never negative, also for a complex
 * nominal, and two terms never cancel: `(1 ± 0.1)·(i ± 0.1)` is
 * `i ± 0.1414`. (The square of a complex partial, which an earlier form
 * used, made the terms of that product cancel to a zero error.)
 *
 * Nominals are computed with ordinary engine arithmetic on the value
 * components, so an exact input keeps an exact nominal. Errors are built as
 * boxed expressions and evaluated, so exact inputs keep an exact error under
 * `evaluate()` and `.N()` gives a float (the evaluate-vs-N exactness
 * contract). A zero error collapses to the bare nominal (decided 2026-07-07:
 * a zero error is an exact value), in the constructor and in the helpers
 * here, so a hook can answer a plain number: `0 · (2 ± 0.1)` is `0`.
 *
 * A helper promotes an operand that is not a `Measurement` to a measurement
 * with error 0 (its exact value). The hooks give the helpers only the
 * operands that are a measurement or a numeric value with no unknowns
 * (`isFoldableNumber()`): a free symbol is not folded into a nominal, and
 * stays beside the measurement (`x + (2 ± 0.1)` stays a sum).
 */

import type {
  ArithmeticDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
  KindFold,
  KindOperand,
  KindOperands,
} from '../global-types.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  differentiate,
  unaryDerivativeFormula,
} from '../symbolic/derivative.js';
import { cmp, exactOrder } from '../boxed-expression/compare.js';
import { isOperatorDef } from '../boxed-expression/definition-guards.js';
import { overloadArms } from '../boxed-expression/overload.js';
import { paramAt } from '../../common/type/instantiate.js';
import { isSubtype } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/** A Measurement function expression with guaranteed op1 and op2 access. */
export type MeasurementExpr = Expression & {
  readonly op1: Expression;
  readonly op2: Expression;
};

/** Check if an expression is a Measurement and narrow the type. */
export function isMeasurement(expr: Expression): expr is MeasurementExpr {
  return isFunction(expr, 'Measurement');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A (nominal, 1σ-error) pair. */
interface Pair {
  value: Expression;
  error: Expression;
}

/**
 * Promote any operand to a (nominal, error) pair.  A non-Measurement operand
 * is treated as a measurement with error 0 (an exact value).
 */
function toPair(ce: ComputeEngine, expr: Expression): Pair {
  if (isMeasurement(expr)) return { value: expr.op1, error: expr.op2 };
  return { value: expr, error: ce.number(0) };
}

/** The term `|partial|²·σ²` of a sum in quadrature. */
function quadratureTerm(
  ce: ComputeEngine,
  partial: Expression,
  sigma: Expression
): Expression {
  return ce.function('Multiply', [
    ce.function('Power', [ce.function('Abs', [partial]), 2]),
    ce.function('Power', [sigma, 2]),
  ]);
}

/** `√(Σ terms)`, or `0` when there is no term. */
function quadrature(
  ce: ComputeEngine,
  terms: ReadonlyArray<Expression>
): Expression {
  if (terms.length === 0) return ce.Zero;
  return ce.function('Sqrt', [
    terms.length === 1 ? terms[0] : ce.function('Add', [...terms]),
  ]);
}

/**
 * True when the partial derivative `partial`, built from values with no
 * unknowns, is infinite or `NaN` at the nominal: the first-order
 * propagation has no answer there (`√x` at 0, `1/x` at 0), and the caller
 * declines (decision 4 of `docs/plans/2026-10-26-value-kinds.md`, section
 * 13). A partial whose value is not a number literal after `.N()` (a
 * symbolic nominal) is not refused.
 */
function isUnboundedPartial(partial: Expression): boolean {
  const v = partial.N();
  if (!isNumber(v)) return false;
  return v.isNaN === true || v.isFinite === false;
}

/**
 * Build the result Measurement. The error is evaluated, and the value and the
 * error are made numeric under `.N()` (`numericApproximation`). A zero error
 * collapses to the bare value (decided 2026-07-07: a zero error is an exact
 * value), as the Measurement canonical form does.
 */
function makeMeasurement(
  ce: ComputeEngine,
  value: Expression,
  error: Expression,
  numericApproximation = false
): Expression {
  // The error is evaluated: `evaluate()` keeps an exact error exact
  // (`√(1/4 + 1/9)` stays exact, `√2` stays `√2`) and gives a float for a
  // float error, the evaluate-vs-N contract. Left as built, a float error
  // stayed the unevaluated `√(0.2²)` under `evaluate()`
  // (`Measurement(5, 0.2) + 3` printed `8 ± sqrt(0.2^2)`).
  const evaluated = numericApproximation ? error.N() : error.evaluate();
  const v = numericApproximation ? value.N() : value;
  if (evaluated.isSame(0)) return v;
  return ce.function('Measurement', [v, evaluated]);
}

// ---------------------------------------------------------------------------
// Measurement arithmetic
// ---------------------------------------------------------------------------

/**
 * Add measurements (and scalars, promoted to error-0 measurements):
 * σ = √(Σ σᵢ²).
 */
export function measurementAdd(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation = false
): Expression | undefined {
  if (ops.length === 0) return undefined;
  const pairs = ops.map((x) => toPair(ce, x));
  // The boxed `Add`, not `.add()`: the method folds two exact radicals to
  // a float (`√2 + 1`), and the nominal must stay exact under `evaluate()`.
  const value = ce
    .function(
      'Add',
      pairs.map((p) => p.value)
    )
    .evaluate();
  const error = quadrature(
    ce,
    pairs
      .filter((p) => !p.error.isSame(0))
      .map((p) => ce.function('Power', [p.error, 2]))
  );
  return makeMeasurement(ce, value, error, numericApproximation);
}

/**
 * Multiply measurements (and scalars). Folded pairwise: nominal = a·b,
 * σ = √(|b|²σ_a² + |a|²σ_b²).
 */
export function measurementMultiply(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation = false
): Expression | undefined {
  if (ops.length === 0) return undefined;
  let acc = toPair(ce, ops[0]);
  for (let i = 1; i < ops.length; i++) {
    const b = toPair(ce, ops[i]);
    const a = acc.value;
    // The boxed `Multiply`, not `.mul()`, for the same reason as in
    // `measurementAdd`: the nominal stays exact under `evaluate()`.
    const value = ce.function('Multiply', [a, b.value]).evaluate();
    const terms: Expression[] = [];
    if (!acc.error.isSame(0))
      terms.push(quadratureTerm(ce, b.value, acc.error));
    if (!b.error.isSame(0)) terms.push(quadratureTerm(ce, a, b.error));
    acc = { value, error: quadrature(ce, terms).evaluate() };
  }
  return makeMeasurement(ce, acc.value, acc.error, numericApproximation);
}

/**
 * Divide two operands (at least one a Measurement): nominal = a/b,
 * σ = √(|1/b|²σ_a² + |a/b²|²σ_b²). `undefined` when a partial derivative is
 * infinite at the nominal (a divisor with the nominal 0).
 */
export function measurementDivide(
  ce: ComputeEngine,
  num: Expression,
  den: Expression,
  numericApproximation = false
): Expression | undefined {
  const A = toPair(ce, num);
  const B = toPair(ce, den);
  const a = A.value;
  const b = B.value;
  const value = ce.function('Divide', [a, b]).evaluate();
  const terms: Expression[] = [];
  if (!A.error.isSame(0)) {
    const partial = ce.function('Divide', [1, b]);
    if (isUnboundedPartial(partial)) return undefined;
    terms.push(quadratureTerm(ce, partial, A.error));
  }
  if (!B.error.isSame(0)) {
    const partial = ce.function('Divide', [a, ce.function('Power', [b, 2])]);
    if (isUnboundedPartial(partial)) return undefined;
    terms.push(quadratureTerm(ce, partial, B.error));
  }
  return makeMeasurement(
    ce,
    value,
    quadrature(ce, terms),
    numericApproximation
  );
}

/**
 * Negate a measurement.  nominal = −a, σ unchanged.
 */
export function measurementNegate(
  ce: ComputeEngine,
  expr: Expression,
  numericApproximation = false
): Expression | undefined {
  const A = toPair(ce, expr);
  return makeMeasurement(ce, A.value.neg(), A.error, numericApproximation);
}

/**
 * Raise a measurement to a power (or a scalar to a measurement power):
 * nominal = a^b, σ = √(|b·a^{b−1}|²σ_a² + |a^b·ln a|²σ_b²), where `ln` is
 * the principal logarithm, which is complex for a negative or complex base.
 *
 * `undefined` (the caller leaves the power unevaluated) when a partial
 * derivative is infinite at the nominal (`√(0 ± 0.1)`: the slope of `√x` at
 * 0), or when the exponent is uncertain and the base is 0 (`ln 0`). The
 * nominal alone is never the answer for an uncertain exponent: the bare
 * nominal would claim an exact result (decisions 4 and A4 of
 * `docs/plans/2026-10-26-value-kinds.md`, section 13).
 */
export function measurementPower(
  ce: ComputeEngine,
  base: Expression,
  exp: Expression,
  numericApproximation = false
): Expression | undefined {
  const A = toPair(ce, base);
  const B = toPair(ce, exp);
  const a = A.value;
  const b = B.value;
  const value = ce.function('Power', [a, b]).evaluate();

  const terms: Expression[] = [];
  if (!A.error.isSame(0)) {
    // ∂/∂a = b·a^{b−1}
    const partial = ce.function('Multiply', [
      b,
      ce.function('Power', [a, ce.function('Subtract', [b, 1])]),
    ]);
    if (isUnboundedPartial(partial)) return undefined;
    terms.push(quadratureTerm(ce, partial, A.error));
  }
  if (!B.error.isSame(0)) {
    // ∂/∂b = a^b·ln a, with the principal logarithm: defined for every base
    // but 0.
    if (a.isSame(0) || (isNumber(a) && a.isEqual(0) === true)) return undefined;
    const partial = ce.function('Multiply', [
      ce.function('Power', [a, b]),
      ce.function('Ln', [a]),
    ]);
    if (isUnboundedPartial(partial)) return undefined;
    terms.push(quadratureTerm(ce, partial, B.error));
  }
  return makeMeasurement(
    ce,
    value,
    quadrature(ce, terms),
    numericApproximation
  );
}

/**
 * Apply an affine map `x → f·x + c` to a magnitude expression, scaling a
 * `Measurement` error by `|f|` (the shift `c` moves the nominal only).  Used
 * by the units layer for unit conversion of a measured magnitude — converting
 * by a linear factor scales both nominal and error.  A non-`Measurement`
 * operand collapses to a plain scalar (error 0).
 */
export function measurementAffine(
  ce: ComputeEngine,
  mag: Expression,
  f: number,
  c: number
): Expression {
  let r = mag;
  if (f !== 1) {
    const m = measurementMultiply(ce, [r, ce.number(f)]);
    if (m !== undefined) r = m;
  }
  if (c !== 0) {
    const m = measurementAdd(ce, [r, ce.number(c)]);
    if (m !== undefined) r = m;
  }
  return r;
}

// ---------------------------------------------------------------------------
// The value kind
// ---------------------------------------------------------------------------

/**
 * True when `x` is folded by the hooks beside a measurement: a number
 * literal, or a numeric value with no unknowns that is not a value of a
 * kind (`π`, `2 + √3`). A free symbol is not: `x + (2 ± 0.1)` stays a sum,
 * since folding `x` into the nominal would make a measurement whose nominal
 * is not a value.
 */
function isFoldableNumber(x: Expression): boolean {
  if (isNumber(x)) return true;
  if (isMeasurement(x)) return false;
  return (
    x.isConstant === true && x.unknowns.length === 0 && x.type.matches('number')
  );
}

/** True when `x` is a measurement or a value that the hooks fold beside one
 * (`isFoldableNumber()`). */
function isMeasurementOperand(x: Expression): boolean {
  return isMeasurement(x) || isFoldableNumber(x);
}

/** The folds of the `add` (`multiply`) hook: every measurement and every
 * foldable value among the operands, in one fold, when there is at least
 * one measurement and at least two such operands. */
function measurementFold(
  ce: ComputeEngine,
  ops: KindOperands,
  operation: 'add' | 'multiply',
  numericApproximation: boolean
): ReadonlyArray<KindFold> | undefined {
  const idx: number[] = [];
  let measurements = 0;
  ops.evaluated.forEach((x, i) => {
    if (isMeasurement(x)) {
      measurements += 1;
      idx.push(i);
    } else if (isFoldableNumber(x)) idx.push(i);
  });
  if (measurements === 0 || idx.length < 2) return undefined;
  const xs = idx.map((i) => ops.evaluated[i]);
  const value =
    operation === 'add'
      ? measurementAdd(ce, xs, numericApproximation)
      : measurementMultiply(ce, xs, numericApproximation);
  if (value === undefined) return undefined;
  return [{ value, operands: idx }];
}

/** The nominal of `x`: the first operand of a measurement, `x` itself for
 * a foldable value (`isFoldableNumber()`), else `undefined`. */
function nominalOf(x: Expression): Expression | undefined {
  if (isMeasurement(x)) return x.op1;
  return isFoldableNumber(x) ? x : undefined;
}

/** The numeric value of the nominal `x`: `x` when it is a number literal,
 * else its `.N()` when that is a number literal, else `undefined` (a
 * symbolic nominal has no order). */
function numericNominal(x: Expression): Expression | undefined {
  if (isNumber(x)) return x;
  if (x.unknowns.length > 0) return undefined;
  const v = x.N();
  return isNumber(v) ? v : undefined;
}

/**
 * The exact value of the operand `x` of a comparison (`x.exact()`) when it
 * is a measurement or a number literal, else its value. Under `.N()` the
 * exact value of an operand that becomes a measurement only through the
 * numeric approximation (a definite integral, whose quadrature is a
 * measurement) is the symbolic operand, which has no nominal.
 */
function exactOperand(x: KindOperand): Expression {
  const exact = x.exact();
  return isMeasurement(exact) || isNumber(exact) ? exact : x.evaluated;
}

/**
 * The order of two measurements, or of a measurement and a value, by their
 * nominals (`docs/plans/2026-10-26-value-kinds.md`, section 4.7 and A6 of
 * section 13). The exact nominals decide: two exact nominals are compared
 * exactly, and a float nominal within the engine tolerance of the other is
 * a tie, as for two numbers (`isEqual()`). The uncertainties take no part:
 * `1 ± 0.1` and `1 ± 0.5` are a tie. A complex or `NaN` nominal has no
 * order (`'unordered'`), as a complex number has none. `undefined` when a
 * nominal has no numeric value (a symbol) or the other operand is not a
 * number.
 *
 * `tolerance` is the tolerance of a caller that compares within one
 * (`.is()`, `ArithmeticContext.tolerance`): two nominals whose numeric
 * values are within it are a tie, also when both are exact.
 */
function compareMeasurements(
  a: KindOperand,
  b: KindOperand,
  tolerance: number | undefined
): -1 | 0 | 1 | 'unordered' | undefined {
  const x = nominalOf(exactOperand(a));
  const y = nominalOf(exactOperand(b));
  if (x === undefined || y === undefined) return undefined;
  const xn = numericNominal(x);
  const yn = numericNominal(y);
  if (xn === undefined || yn === undefined) return undefined;
  if (xn.isNaN === true || yn.isNaN === true) return 'unordered';
  if (xn.im !== 0 || yn.im !== 0) return 'unordered';
  // A tolerance other than the engine tolerance (an explicit argument of
  // `.is()`) decides alone: a tie is a difference within it, and
  // `isEqual()`, which uses the engine tolerance for a float, is not asked.
  // With a tolerance of 0, `cmp()` compares the nominals exactly.
  if (tolerance !== undefined && tolerance !== x.engine.tolerance) {
    if (tolerance > 0 && Math.abs(xn.re - yn.re) <= tolerance) return 0;
    const c = cmp(xn, yn, tolerance);
    if (c === '=') return 0;
    if (c === '<') return -1;
    if (c === '>') return 1;
    return undefined;
  }
  if (tolerance !== undefined && Math.abs(xn.re - yn.re) <= tolerance) return 0;
  if (x.isEqual(y) === true) return 0;
  const less = x.isLess(y);
  if (less === undefined) return undefined;
  return less ? -1 : 1;
}

/**
 * The `eq` handler of the head `Measurement`: two values are equal when
 * their nominals are, with the engine tolerance for a float as for two
 * numbers, and a complex nominal compared as a complex number:
 * `Equal((2 + 3i) ± 0.1, 2 + 3i)` is `True` and `Equal(1 ± 0.1, 1 ± 0.5)`
 * is `True` (A6 of `docs/plans/2026-10-26-value-kinds.md`, section 13). A
 * measurement and a value that is not a number compare as the nominal and
 * the value do: `Equal(2 ± 0.1, "abc")` and `Equal(2 ± 0.1, 2 m)` are
 * `False`. `undefined` when the equality of the two is not decided (an
 * operand with unknowns: `Equal(2 ± 0.1, x)` stays as written).
 */
export function measurementEq(
  a: Expression,
  b: Expression
): boolean | undefined {
  const x = isMeasurement(a) ? a.op1 : a;
  const y = isMeasurement(b) ? b.op1 : b;
  return x.isEqual(y);
}

// ---------------------------------------------------------------------------
// The `apply` hook
// ---------------------------------------------------------------------------
//
// At an APPLY SITE (an operator such as `Sin`, `Floor` or `Mean` that
// admits a measurement through the carrier `number`), the hook computes the
// value of the call from the nominals and the uncertainties of its operands
// (`docs/plans/2026-10-26-value-kinds.md`, sections 4.3 and 4.4, and the
// decisions and amendments of section 13). `measurementApply()` sends the
// call to one rule:
//
// - the statistics over a collection (`statisticApply()`), which read the
//   elements that the dispatch enumerated (`ops.elements(i)`);
// - the multilinear operators over vectors and matrices (`Dot`, `Cross`,
//   `MatrixMultiply`, `HadamardProduct`, `Trace`: `multilinearApply()`),
//   `Norm` (`normApply()`) and `Distance` (`distanceApply()`), which read
//   the cells of their operands;
// - every other operator, on scalar operands (`scalarApply()`): the step
//   functions (`stepApply()`), `Mod` and `Fract` (`sawtoothApply()`), the
//   parts of a complex number and `Abs` (`partApply()`), and the general
//   first-order propagation (`propagate()`), whose partial derivatives come
//   from `partialDerivative()`.
//
// The first-order rule: the nominal is `f(a₁, …, aₙ)` at the nominals, and
// the uncertainty is `√(Σ |∂f/∂aᵢ|²·σᵢ²)` over the uncertain operands. The
// nominal is computed from the EXACT nominals (`ops.exact(i)`): an exact
// nominal keeps an exact value under `evaluate()` (`Sin(1/3 ± 0.1)` is
// `Sin(1/3) ± …`), and under `.N()` the operator itself makes the float, so
// that a step function decides its jump on the exact value (the exactness
// contract of CLAUDE.md, "Evaluate vs. N").

/** An operand of an apply site, read as a nominal and an uncertainty.
 * `sigma` is `undefined` for an operand that is not a measurement: an
 * exact value, with no uncertainty. */
interface ApplyOperand {
  readonly nominal: Expression;
  readonly sigma: Expression | undefined;
}

/**
 * The operand `i` of `ops`, with its exact value under `.N()`
 * (`ops.exact(i)`) when the operand as written is a measurement, a number
 * literal or a symbol: then evaluating it again without the numeric
 * approximation is cheap, and gives the exact nominal of a measurement
 * written with an exact nominal. An operand written as another expression
 * (a definite integral, whose numeric quadrature makes the measurement) is
 * read as it was evaluated: evaluating it again can cost a symbolic
 * computation, and gives no measurement.
 */
function exactOperandValue(
  ops: KindOperands,
  i: number,
  numericApproximation: boolean
): Expression {
  const value = ops.evaluated[i];
  if (!numericApproximation) return value;
  const written = ops.written[i];
  if (
    written === undefined ||
    !(isMeasurement(written) || isNumber(written) || isSymbol(written))
  )
    return value;
  const exact = ops.exact(i);
  if (isMeasurement(value)) return isMeasurement(exact) ? exact : value;
  return isFoldableNumber(exact) ? exact : value;
}

/** The operand `i` of `ops` as a nominal and an uncertainty, or `undefined`
 * when it is neither a measurement with a numeric nominal and uncertainty
 * nor a numeric value with no unknowns (a free symbol, a string, a
 * collection). */
function applyOperand(
  ops: KindOperands,
  i: number,
  numericApproximation: boolean
): ApplyOperand | undefined {
  const x = exactOperandValue(ops, i, numericApproximation);
  if (isMeasurement(x)) {
    if (!isFoldableNumber(x.op1) || x.op2.unknowns.length > 0) return undefined;
    return { nominal: x.op1, sigma: x.op2 };
  }
  if (isFoldableNumber(x)) return { nominal: x, sigma: undefined };
  return undefined;
}

/** The real value of `x` as a JavaScript number, or `undefined` when `x`
 * has no numeric value or its value is not real. */
function realOf(x: Expression): number | undefined {
  const v = numericNominal(x);
  if (v === undefined || v.isNaN === true || v.im !== 0) return undefined;
  return v.re;
}

/** True when the nominal `x` has a numeric value that is real. */
function isRealNominal(x: Expression): boolean {
  return realOf(x) !== undefined;
}

/** The uncertainty `sigma` as a JavaScript number: 0 for an operand with no
 * uncertainty, `undefined` when it has no real value. */
function sigmaOf(sigma: Expression | undefined): number | undefined {
  return sigma === undefined ? 0 : realOf(sigma);
}

/**
 * True when the value `value` of the nominal is infinite: the first-order
 * propagation has no answer there, and the call stays unevaluated (decision
 * 4 and A13 of `docs/plans/2026-10-26-value-kinds.md`, section 13:
 * `Gamma(0 ± 0.1)`, `Ln(0 ± 0.1)`, `Tan(π/2 ± 0.1)`). A symbolic value whose
 * numeric value is not known (a missing numeric kernel, `LogIntegral(2 + 3i)`)
 * is not infinite: it is kept, with its propagated uncertainty.
 */
function isInfiniteValue(value: Expression): boolean {
  if (isNumber(value)) return value.isFinite === false && value.isNaN !== true;
  if (value.unknowns.length > 0) return false;
  const v = value.N();
  return isNumber(v) && v.isFinite === false && v.isNaN !== true;
}

/**
 * The propagated uncertainty of the terms `terms`, each a partial
 * derivative and the uncertainty of its operand: `|∂f/∂a|·σ` for one term,
 * and the quadrature `√(Σ |∂f/∂aᵢ|²·σᵢ²)` for several. Each term is the
 * square of a MODULUS, so a complex partial derivative never makes two terms
 * cancel (A3 of `docs/plans/2026-10-26-value-kinds.md`, section 13).
 *
 * The result is not evaluated (`makeMeasurement()` evaluates it), except
 * when an uncertainty is a float: then the uncertainty is a float, as a
 * float operand makes a numeric result a float, and not a mix such as
 * `0.0277/ln(2)` of a float and an exact partial derivative.
 */
function propagatedError(
  ce: ComputeEngine,
  terms: ReadonlyArray<readonly [Expression, Expression]>
): Expression {
  const nonzero = terms.filter(([d]) => !d.isSame(0));
  if (nonzero.length === 0) return ce.Zero;
  let error: Expression;
  if (nonzero.length === 1) {
    const [d, sigma] = nonzero[0];
    error = ce.function('Multiply', [ce.function('Abs', [d]), sigma]);
  } else
    error = quadrature(
      ce,
      nonzero.map(([d, sigma]) => quadratureTerm(ce, d, sigma))
    );
  return nonzero.some(([, sigma]) => isNumber(sigma) && !sigma.isExact)
    ? error.N()
    : error;
}

/** True when `x` holds a derivative that the engine could not compute: a
 * `D` or a `Derivative` of an operator whose derivative it does not know
 * (`Apply(Derivative("Binomial", 1, 0), …)`). */
function holdsUnknownDerivative(x: Expression): boolean {
  if (!isFunction(x)) return false;
  if (x.operator === 'D' || x.operator === 'Derivative') return true;
  return x.ops.some(holdsUnknownDerivative);
}

/**
 * The partial derivatives that the engine's derivative tables do not give,
 * in closed form, as a function of the nominals `args` and of the index `i`
 * of the operand: `undefined` when the partial derivative in that operand
 * has no closed form (the order `s` of `HurwitzZeta(s, a)`). An operator
 * whose result is an angle uses the derivative formulas of the circular
 * functions (`unaryDerivativeFormula()`), which are taken in the angular
 * unit of the engine.
 */
const CLOSED_PARTIALS: Readonly<
  Record<
    string,
    (
      ce: ComputeEngine,
      args: ReadonlyArray<Expression>,
      i: number
    ) => Expression | undefined
  >
> = {
  // Hypot(x, y) = √(x² + y²): ∂/∂x = x/Hypot(x, y), ∂/∂y = y/Hypot(x, y).
  Hypot: (ce, args, i) =>
    args.length === 2
      ? ce.function('Divide', [args[i], ce.function('Hypot', [...args])])
      : undefined,
  // Degrees(x) is linear: its derivative is the conversion factor,
  // Degrees(1) (π/180 in radians).
  Degrees: (ce) => ce.function('Degrees', [ce.One]),
  // Haversine(x) = (1 − cos x)/2: the derivative is −cos′(x)/2.
  Haversine: (ce, [x]) => {
    const d = unaryDerivativeFormula(ce, 'Cos', x);
    return d === undefined ? undefined : ce.function('Divide', [d, -2]);
  },
  // InverseHaversine(x) = 2·arcsin(√x): the derivative is arcsin′(√x)/√x.
  InverseHaversine: (ce, [x]) => {
    const root = ce.function('Sqrt', [x]);
    const d = unaryDerivativeFormula(ce, 'Arcsin', root);
    return d === undefined ? undefined : ce.function('Divide', [d, root]);
  },
  PreIncrement: (ce) => ce.One,
  PreDecrement: (ce) => ce.One,
  // x! = Γ(x + 1): the derivative is Γ(x + 1)·ψ(x + 1).
  Factorial: (ce, [x]) => {
    const shifted = ce.function('Add', [x, ce.One]);
    return ce.function('Multiply', [
      ce.function('Gamma', [shifted]),
      ce.function('Digamma', [shifted]),
    ]);
  },
  // ζ(s, a) = Σ (n + a)^(−s): ∂/∂a = −s·ζ(s + 1, a). The derivative in `s`
  // has no closed form.
  HurwitzZeta: (ce, args, i) =>
    args.length === 2 && i === 1
      ? ce.function('Multiply', [
          ce.function('Negate', [args[0]]),
          ce.function('HurwitzZeta', [
            ce.function('Add', [args[0], ce.One]),
            args[1],
          ]),
        ])
      : undefined,
};

/**
 * The partial derivative of `operator` in its operand `i`, at the nominals
 * `args`, not evaluated; `undefined` when the engine has none. In order: a
 * closed form of `CLOSED_PARTIALS`, the derivative table of the unary
 * functions (`unaryDerivativeFormula()`, in the angular unit of the engine),
 * and the symbolic derivative `D` of the call in that operand
 * (`symbolicPartial()`: `Log(a, b)`, `Root(a, n)`, `Arctan2(y, x)`,
 * `BesselJ(n, x)`, `Beta(a, b)`, …). Only for an operator of the standard
 * library or one whose definition declares a `derivative`
 * (`hasLibraryDerivative()`): a user operator with a handler
 * (`h: (real) -> real`) has no derivative the engine knows, and a user
 * definition that shadows a library name (`Sin` in a local scope) is not
 * the function of the tables.
 */
function partialDerivative(
  ce: ComputeEngine,
  operator: string,
  args: ReadonlyArray<Expression>,
  i: number
): Expression | undefined {
  if (!hasLibraryDerivative(ce, operator)) return undefined;
  const closed = CLOSED_PARTIALS[operator];
  if (closed !== undefined) return closed(ce, args, i);
  if (args.length === 1) {
    const formula = unaryDerivativeFormula(ce, operator, args[0]);
    if (formula !== undefined) return formula;
  }
  return symbolicPartial(ce, operator, args, i);
}

/**
 * True when `D` can differentiate a call of `operator` without running its
 * `evaluate` handler on a symbolic operand: the operator is bound to the
 * definition of the standard library (in the system scope), or its
 * definition declares a `derivative`. `differentiate()` evaluates the call
 * of a user operator to read its body, which would run a user handler with
 * a variable in place of the measurement (a side effect the user did not
 * ask for, on an operand the handler does not expect).
 */
function hasLibraryDerivative(ce: ComputeEngine, operator: string): boolean {
  const def = ce.lookupDefinition(operator);
  if (def === undefined || !isOperatorDef(def)) return false;
  if (def.operator.derivative !== undefined) return true;
  if (ce._customLibraryOperators.has(operator)) return false;
  return ce.contextStack[0]?.lexicalScope?.bindings.get(operator) === def;
}

/**
 * The symbolic derivative of the call of `operator` in its operand `i`, at
 * the nominals `args`: the operand is replaced by a variable declared in a
 * scope of its own (`_bindingSymbol()`, so that a library constant or a
 * user symbol of the same name is not read), the call is differentiated
 * (`differentiate()`), and the nominal is substituted. `undefined` when the
 * engine does not know the derivative: the result holds a `D` or a
 * `Derivative` of the operator (decision 7: `Binomial`, `Pochhammer`).
 */
function symbolicPartial(
  ce: ComputeEngine,
  operator: string,
  args: ReadonlyArray<Expression>,
  i: number
): Expression | undefined {
  const name = 'x';
  ce.pushScope();
  try {
    ce.declare(name, isRealNominal(args[i]) ? 'real' : 'complex');
    const x = ce._bindingSymbol(name, ce.context.lexicalScope);
    if (x === undefined) return undefined;
    const call = ce.function(
      operator,
      args.map((a, j) => (j === i ? x : a))
    );
    if (!call.isValid) return undefined;
    const d = differentiate(call, name);
    if (d === undefined || holdsUnknownDerivative(d)) return undefined;
    const partial = d.subs({ [name]: args[i] });
    return partial.unknowns.length > 0 ? undefined : partial;
  } finally {
    ce.popScope();
  }
}

/**
 * The general first-order propagation through `operator` at the nominals
 * of `args` (decisions 5 and 6, A3, A5, A11, A13 of
 * `docs/plans/2026-10-26-value-kinds.md`, section 13). The nominal is the
 * value of `call`, the call of the operator on the nominals. Every
 * uncertain operand contributes `|∂f/∂aᵢ|²·σᵢ²`, with the modulus of the
 * partial derivative, so a real nominal whose value is not real
 * (`Arccos(2.5 ± 0.1)` is `1.5668i ± 0.0436`) and a complex nominal
 * (`Cos((2 + 3i) ± 0.1)`) propagate by the same rule.
 *
 * `undefined` (the call stays unevaluated) when the value or a partial
 * derivative is infinite at the nominal (decision 4: `Arcsin(1 ± 0.1)`,
 * `Gamma(0 ± 0.1)`), or when a partial derivative is not known.
 */
function propagate(
  ce: ComputeEngine,
  operator: string,
  args: ReadonlyArray<ApplyOperand>,
  call: Expression,
  numericApproximation: boolean
): Expression | undefined {
  // The partial derivatives are found first: an operator with no known
  // derivative is not evaluated at all (its handler does not run).
  const nominals = args.map((a) => a.nominal);
  const formulas: [Expression, Expression][] = [];
  for (let i = 0; i < args.length; i++) {
    const sigma = args[i].sigma;
    if (sigma === undefined) continue;
    const formula = partialDerivative(ce, operator, nominals, i);
    if (formula === undefined) return undefined;
    formulas.push([formula, sigma]);
  }
  const value = call.evaluate({ numericApproximation });
  if (isNumber(value) && value.isNaN === true) return value;
  if (isInfiniteValue(value)) return undefined;
  const terms: [Expression, Expression][] = [];
  for (const [formula, sigma] of formulas) {
    const d = formula.evaluate();
    if (isUnboundedPartial(d)) return undefined;
    terms.push([d, sigma]);
  }
  return makeMeasurement(
    ce,
    value,
    propagatedError(ce, terms),
    numericApproximation
  );
}

/** The kind of jump of a step function: where its jumps are. */
type StepKind =
  'integer' | 'nonzero-integer' | 'half-integer' | 'zero' | 'prime';

/** The step functions (decision 1 of `docs/plans/2026-10-26-value-kinds.md`,
 * section 13), with the positions of their jumps. */
const STEP_FUNCTIONS: Readonly<Record<string, StepKind>> = {
  Floor: 'integer',
  Ceil: 'integer',
  // trunc(x) is continuous at 0: trunc(±0.5) = 0.
  Truncate: 'nonzero-integer',
  Round: 'half-integer',
  Sign: 'zero',
  Heaviside: 'zero',
  PrimePi: 'prime',
};

/**
 * True when a jump of a step function whose jumps are at `kind` lies within
 * `sigma` of the real value `q` (the closed interval `[q − σ, q + σ]` holds
 * a jump), `false` when none does, `undefined` when it is not decided. The
 * distance to the nearest jumps is computed exactly for an exact `q`, so
 * that a value very near a jump is not rounded onto it.
 */
function jumpWithin(
  ce: ComputeEngine,
  kind: StepKind,
  q: Expression,
  sigma: number
): boolean | undefined {
  if (kind === 'zero') {
    const v = realOf(q);
    return v === undefined ? undefined : Math.abs(v) <= sigma;
  }
  if (kind === 'prime') {
    const v = realOf(q);
    if (v === undefined) return undefined;
    const lo = Math.ceil(v - sigma);
    const hi = Math.floor(v + sigma);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined;
    if (hi < 2 || hi < lo) return false;
    const count = (n: number) =>
      realOf(ce.function('PrimePi', [ce.number(n)]).evaluate());
    const above = count(hi);
    const below = count(Math.max(lo - 1, 1));
    if (above === undefined || below === undefined) return undefined;
    return above > below;
  }
  // The jumps at the half-integers are the jumps at the integers of
  // `q − 1/2`.
  const shifted =
    kind === 'half-integer'
      ? ce.function('Subtract', [q, ce.Half]).evaluate()
      : q;
  const lo = ce.function('Floor', [shifted]).evaluate();
  if (!isNumber(lo) || lo.isFinite !== true) return undefined;
  const hi = ce.function('Add', [lo, ce.One]).evaluate();
  const below = realOf(ce.function('Subtract', [shifted, lo]).evaluate());
  const above = realOf(ce.function('Subtract', [hi, shifted]).evaluate());
  if (below === undefined || above === undefined) return undefined;
  // `Truncate` has no jump at 0.
  const jumpAtLo = !(kind === 'nonzero-integer' && lo.isSame(0));
  const jumpAtHi = !(kind === 'nonzero-integer' && hi.isSame(0));
  return (jumpAtLo && below <= sigma) || (jumpAtHi && above <= sigma);
}

/**
 * The value of a step function of a measurement (decision 1 and A2 of
 * `docs/plans/2026-10-26-value-kinds.md`, section 13): the slope is zero
 * between the jumps, so the first-order uncertainty of the result is zero
 * and the answer is the bare value (`Floor(2.5 ± 0.1)` is `2`), computed
 * on the exact nominal under `.N()`. With an uncertain step,
 * `Round(x, s) = |s|·round(x/|s|)` has the slope `±round(x/|s|)` in `s`.
 *
 * `undefined` (the call stays unevaluated) when a jump lies within one σ of
 * the value whose jumps decide (`x`, or `x/|s|` with a step), as for
 * `Floor(2.95 ± 0.1)`, `Round(2.5 ± 0.1)` and `Sign(0 ± 0.1)`; and for a
 * nominal that is not real (A2: complex `Sign` is `z/|z|`, not a step).
 */
function stepApply(
  ce: ComputeEngine,
  kind: StepKind,
  args: ReadonlyArray<ApplyOperand>,
  call: Expression,
  numericApproximation: boolean
): Expression | undefined {
  if (!args.every((a) => isRealNominal(a.nominal))) return undefined;
  const [x, step] = args;
  const sx = sigmaOf(x.sigma);
  if (sx === undefined) return undefined;
  let q = x.nominal;
  let sq = sx;
  if (step !== undefined) {
    const ss = sigmaOf(step.sigma);
    const s = realOf(step.nominal);
    if (ss === undefined || s === undefined || s === 0) return undefined;
    q = ce
      .function('Divide', [x.nominal, ce.function('Abs', [step.nominal])])
      .evaluate();
    const qv = realOf(q);
    if (qv === undefined) return undefined;
    // ∂q/∂x = 1/|s|, |∂q/∂s| = |q|/|s|.
    sq = Math.hypot(sx / Math.abs(s), (qv * ss) / Math.abs(s));
  }
  const near = jumpWithin(ce, kind, q, sq);
  if (near !== false) return undefined;
  const value = call.evaluate({ numericApproximation });
  if (step?.sigma === undefined) return value;
  // ∂(|s|·g(x/|s|))/∂s = sign(s)·g(q) between the jumps: its modulus is
  // |value/s|.
  const d = ce.function('Divide', [call.evaluate(), step.nominal]).evaluate();
  return makeMeasurement(
    ce,
    value,
    propagatedError(ce, [[d, step.sigma]]),
    numericApproximation
  );
}

/**
 * `Mod(a, b) = a − b·⌊a/b⌋` and `Fract(a) = a − ⌊a⌋` of measurements
 * (decision 2 of `docs/plans/2026-10-26-value-kinds.md`, section 13): the
 * slope is 1 in `a` and `−⌊a/b⌋` in `b` between the jumps, so
 * `Mod(5 ± 0.1, 3)` is `2 ± 0.1`, `Mod(7, 3 ± 0.1)` is `1 ± 0.2` and
 * `Fract(2.5 ± 0.01)` is `0.5 ± 0.01`. `undefined` (unevaluated) when a
 * jump (an integer value of `a/b`) lies within one σ of `a/b`.
 */
function sawtoothApply(
  ce: ComputeEngine,
  operator: 'Mod' | 'Fract',
  args: ReadonlyArray<ApplyOperand>,
  call: Expression,
  numericApproximation: boolean
): Expression | undefined {
  if (!args.every((a) => isRealNominal(a.nominal))) return undefined;
  const value = call.evaluate({ numericApproximation });
  if (isNumber(value) && value.isNaN === true) return value;
  const [a, b] = args;
  const sa = sigmaOf(a.sigma);
  if (sa === undefined) return undefined;
  let q = a.nominal;
  let sq = sa;
  if (operator === 'Mod') {
    if (b === undefined) return undefined;
    const sb = sigmaOf(b.sigma);
    const bv = realOf(b.nominal);
    if (sb === undefined || bv === undefined || bv === 0) return undefined;
    q = ce.function('Divide', [a.nominal, b.nominal]).evaluate();
    const qv = realOf(q);
    if (qv === undefined) return undefined;
    sq = Math.hypot(sa / Math.abs(bv), (qv * sb) / Math.abs(bv));
  }
  const near = jumpWithin(ce, 'integer', q, sq);
  if (near !== false) return undefined;
  const terms: [Expression, Expression][] = [];
  if (a.sigma !== undefined) terms.push([ce.One, a.sigma]);
  if (operator === 'Mod' && b?.sigma !== undefined)
    terms.push([
      ce.function('Negate', [ce.function('Floor', [q])]).evaluate(),
      b.sigma,
    ]);
  return makeMeasurement(
    ce,
    value,
    propagatedError(ce, terms),
    numericApproximation
  );
}

/** The operators that keep the uncertainty of their operand as it is
 * (`partApply()`), by their name and by the operator they compute. */
const PART_OPERATORS: Readonly<
  Record<string, 'Real' | 'Imaginary' | 'Conjugate' | 'Abs'>
> = {
  Real: 'Real',
  Re: 'Real',
  Imaginary: 'Imaginary',
  Im: 'Imaginary',
  Conjugate: 'Conjugate',
  Abs: 'Abs',
};

/**
 * `Real`, `Imaginary`, `Conjugate` and `Abs` of a measurement: the value of
 * the operator at the nominal, with the uncertainty of the operand. Each of
 * these maps moves its operand by at most the operand's own change (a
 * projection on an axis, a reflection, the distance to the origin), so the
 * first-order uncertainty does not grow; `Abs(0 ± 0.1)` is `0 ± 0.1`.
 *
 * The projection of the uncertainty of a COMPLEX nominal on one axis is not
 * modeled: `Real((2 + 3i) ± 0.1)` is `2 ± 0.1`, with the whole uncertainty,
 * which is an upper bound. The imaginary part of a REAL nominal is exactly
 * `0`: the whole uncertainty lies on the real axis.
 */
function partApply(
  ce: ComputeEngine,
  head: 'Real' | 'Imaginary' | 'Conjugate' | 'Abs',
  arg: ApplyOperand,
  call: Expression,
  numericApproximation: boolean
): Expression | undefined {
  const value = call.evaluate({ numericApproximation });
  if (arg.sigma === undefined) return value;
  if (head === 'Imaginary' && isRealNominal(arg.nominal)) return value;
  return makeMeasurement(ce, value, arg.sigma, numericApproximation);
}

/**
 * The operators that stay unevaluated for a measurement although the
 * engine could compute a derivative for some of them (decision 7 and A8 of
 * `docs/plans/2026-10-26-value-kinds.md`, section 13): `Binomial`, `Choose`
 * and `Pochhammer` (the user's decision), `ContinuedFraction` and
 * `ComplexRoots` (the result is not a function of the value with a
 * derivative), `Arg` and `Argument`, and `BaseForm` (a way to print a
 * number, not a function of it).
 */
const UNEVALUATED_OPERATORS: ReadonlySet<string> = new Set([
  'Binomial',
  'Choose',
  'Pochhammer',
  'ContinuedFraction',
  'ComplexRoots',
  'Arg',
  'Argument',
  'BaseForm',
]);

/**
 * The parameter at the position `i` of the operator `operator` when no arm
 * of its signature admits a complex number there (`real`,
 * `real | signed_infinity`, …), else `undefined`. A parameter typed by a
 * type variable (`(T) -> T where T: number`) admits one.
 */
function realOnlyParameter(
  ce: ComputeEngine,
  operator: string,
  i: number
): Type | undefined {
  const def = ce.lookupDefinition(operator);
  if (def === undefined || !isOperatorDef(def)) return undefined;
  const sig = def.operator.signature.type;
  const arms =
    overloadArms(sig) ??
    (typeof sig === 'object' && sig.kind === 'signature' ? [sig] : []);
  let refusing: Type | undefined;
  for (const arm of arms) {
    const param = paramAt(arm, i);
    if (param === undefined) continue;
    if (typeof param === 'object' && param.kind === 'variable')
      return undefined;
    if (isSubtype('complex', param)) return undefined;
    refusing ??= param;
  }
  return refusing;
}

/**
 * The value of the call of `operator` at an apply site whose operands are
 * scalars: the measurements and the exact values beside them. An operand
 * that is not a number (a free symbol, a string, a collection) leaves the
 * call unevaluated.
 *
 * A measurement whose nominal is not real at a parameter that admits `real`
 * but not `complex` (`Floor`, `Mod`, `Hypot`, `Arctan2`, `Degrees`,
 * `ContinuedFraction`, …) is the `incompatible-type` error, read from the
 * signature (`realOnlyParameter()`; decision D of the phase-2 inventory,
 * CE-508.8). Then the call of the operator on the NOMINALS is built: an
 * operator whose parameter refuses a nominal for another reason refuses the
 * measurement the same way.
 */
function scalarApply(
  ce: ComputeEngine,
  operator: string,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const args: ApplyOperand[] = [];
  for (let i = 0; i < ops.evaluated.length; i++) {
    const a = applyOperand(ops, i, numericApproximation);
    if (a === undefined) return undefined;
    if (a.sigma !== undefined && !isRealNominal(a.nominal)) {
      const param = realOnlyParameter(ce, operator, i);
      if (param !== undefined)
        return ce.typeError(param, a.nominal.type, a.nominal);
    }
    args.push(a);
  }
  const call = ce.function(
    operator,
    args.map((a) => a.nominal)
  );
  if (!call.isValid) return call.evaluate();
  if (UNEVALUATED_OPERATORS.has(operator)) return undefined;
  const step = STEP_FUNCTIONS[operator];
  if (step !== undefined)
    return stepApply(ce, step, args, call, numericApproximation);
  if (operator === 'Mod' || operator === 'Fract')
    return sawtoothApply(ce, operator, args, call, numericApproximation);
  const part = PART_OPERATORS[operator];
  if (part !== undefined && args.length === 1)
    return partApply(ce, part, args[0], call, numericApproximation);
  return propagate(ce, operator, args, call, numericApproximation);
}

//
// The statistics
//

/** The statistics whose uncertainty `statisticApply()` propagates. */
const STATISTICS: ReadonlySet<string> = new Set([
  'Mean',
  'Median',
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
]);

/**
 * A statistic of data that hold measurements (`docs/plans/
 * 2026-10-26-value-kinds.md`, section 4.4, "`apply`"). The data are the
 * elements that the dispatch enumerated (`ops.elements(i)`), and the
 * operands that are not collections. The nominal is the statistic of the
 * nominals, as the operator computes it for plain data (exact on exact
 * data, a float on float data), and the data are independent:
 *
 * - `Mean`: `∂/∂xᵢ = 1/n`, so `σ = √(Σ σᵢ²)/n`;
 * - `Median`: the middle datum in the order of the nominals, with its
 *   uncertainty, or the mean of the two middle data;
 * - `Variance` (`PopulationVariance`): `∂/∂xᵢ = 2·Re(xᵢ − m)/(n − 1)`
 *   (`/n`), where `m` is the mean of the nominals; the real part is the
 *   derivative of `E[|X − m|²]` along a real measured datum beside complex
 *   plain data. The formula is not built from the measurements with the
 *   arithmetic hooks: they would treat the occurrences of the mean in every
 *   term as independent;
 * - `StandardDeviation` (`PopulationStandardDeviation`): the derivative of
 *   `√Var`, `∂Var/∂xᵢ / (2s)`.
 *
 * `undefined` (unevaluated) for a datum with unknowns, for a measurement
 * whose nominal is not a finite real number, for a collection that was not
 * enumerated, and for an order of the nominals that is not decided. A plain
 * datum that is not a finite number (`+∞`, `NaN`, an absent value) decides
 * the statistic as it does for plain data: the statistic of the nominals.
 */
function statisticApply(
  ce: ComputeEngine,
  operator: string,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const data: Expression[] = [];
  for (let i = 0; i < ops.evaluated.length; i++) {
    const elements = ops.elements(i);
    if (elements !== undefined) data.push(...elements);
    else if (ops.evaluated[i].isCollection === true) return undefined;
    else data.push(ops.evaluated[i]);
  }
  const nominals: Expression[] = [];
  const sigmas: (Expression | undefined)[] = [];
  let plainNotFinite = false;
  for (const x of data) {
    if (isMeasurement(x)) {
      const v = realOf(x.op1);
      if (v === undefined || !Number.isFinite(v)) return undefined;
      if (x.op2.unknowns.length > 0) return undefined;
      nominals.push(x.op1);
      sigmas.push(x.op2);
    } else {
      if (x.unknowns.length > 0) return undefined;
      if (!(isFoldableNumber(x) && x.isFinite === true)) plainNotFinite = true;
      nominals.push(x);
      sigmas.push(undefined);
    }
  }
  const list = ce.function('List', nominals);
  const value = ce
    .function(operator, [list])
    .evaluate({ numericApproximation });
  if (plainNotFinite) return value;
  if (isNumber(value) && value.isNaN === true) return value;
  const n = nominals.length;
  const terms: [Expression, Expression][] = [];

  if (operator === 'Mean') {
    const d = ce.number([1, n]);
    sigmas.forEach((s) => {
      if (s !== undefined) terms.push([d, s]);
    });
  } else if (operator === 'Median') {
    const order = nominals.map((_, i) => i);
    let undecided = false;
    order.sort((i, j) => {
      const c = exactOrder(nominals[i], nominals[j]);
      if (c === undefined) undecided = true;
      return c ?? 0;
    });
    if (undecided) return undefined;
    const mid = Math.floor(n / 2);
    const middle = n % 2 === 1 ? [order[mid]] : [order[mid - 1], order[mid]];
    const d = n % 2 === 1 ? ce.One : ce.Half;
    for (const k of middle) {
      const s = sigmas[k];
      if (s !== undefined) terms.push([d, s]);
    }
  } else {
    const population = operator.startsWith('Population');
    const deviation = operator.endsWith('StandardDeviation');
    const mean = ce.function('Mean', [list]).evaluate();
    const denominator = ce.number(population ? n : n - 1);
    sigmas.forEach((s, i) => {
      if (s === undefined) return;
      const re = ce
        .function('Real', [ce.function('Subtract', [nominals[i], mean])])
        .evaluate();
      terms.push([
        ce
          .function('Divide', [
            ce.function('Multiply', [ce.number(2), re]),
            denominator,
          ])
          .evaluate(),
        s,
      ]);
    });
    // The standard deviation is `√Var`. Every datum at the mean is a
    // stationary point of the variance: the answer is the value, with no
    // uncertainty.
    if (deviation && terms.every(([d]) => d.isSame(0))) return value;
    if (deviation) {
      const s = ce.function('Multiply', [ce.number(2), value]);
      for (const term of terms)
        term[0] = ce.function('Divide', [term[0], s]).evaluate();
      if (terms.some(([d]) => isUnboundedPartial(d))) return undefined;
    }
  }
  return makeMeasurement(
    ce,
    value,
    propagatedError(ce, terms),
    numericApproximation
  );
}

//
// Vectors and matrices
//

/** The heads of a literal vector or matrix whose cells `mapCells()` reads. */
const CELL_CONTAINERS: ReadonlySet<string> = new Set([
  'List',
  'Tuple',
  'Pair',
  'Triple',
]);

/**
 * A copy of `x` whose cells are replaced by `fn(cell, path)`, or `undefined`
 * when `fn` answers `undefined` for a cell. The cells of a literal vector or
 * matrix (`List`, `Tuple`, a `Matrix` of rows) are read at every depth; any
 * other expression is one cell, with the path `[]`. `path` is the list of
 * the indices of the cell in the nested containers.
 */
function mapCells(
  ce: ComputeEngine,
  x: Expression,
  fn: (cell: Expression, path: ReadonlyArray<number>) => Expression | undefined,
  path: ReadonlyArray<number> = []
): Expression | undefined {
  if (isFunction(x) && CELL_CONTAINERS.has(x.operator)) {
    const out: Expression[] = [];
    for (let k = 0; k < x.nops; k++) {
      const y = mapCells(ce, x.ops[k], fn, [...path, k]);
      if (y === undefined) return undefined;
      out.push(y);
    }
    return ce.function(x.operator, out);
  }
  if (isFunction(x, 'Matrix') && x.nops >= 1) {
    const rows = mapCells(ce, x.op1, fn, path);
    if (rows === undefined) return undefined;
    return ce.function('Matrix', [rows, ...x.ops.slice(1)]);
  }
  return fn(x, path);
}

/** The cell of `x` at `path` (`mapCells()`), or `undefined`. */
function cellAt(
  x: Expression,
  path: ReadonlyArray<number>
): Expression | undefined {
  let y: Expression | undefined = x;
  for (const k of path) {
    if (y === undefined || !isFunction(y)) return undefined;
    if (y.operator === 'Matrix') y = y.op1;
    if (!isFunction(y) || !CELL_CONTAINERS.has(y.operator)) return undefined;
    y = y.ops[k];
  }
  if (y !== undefined && isFunction(y, 'Matrix')) return undefined;
  return y;
}

/** True when two paths of cells are the same. */
function samePath(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** The operators that are linear in each operand, which
 * `multilinearApply()` propagates through. */
const MULTILINEAR: ReadonlySet<string> = new Set([
  'Dot',
  'Cross',
  'MatrixMultiply',
  'HadamardProduct',
  'Trace',
]);

/** An uncertain cell of an operand of `multilinearApply()`. */
interface UncertainCell {
  readonly operand: number;
  readonly path: ReadonlyArray<number>;
  readonly sigma: Expression;
}

/**
 * The nominals of the cells of the operands of `ops`, and the list of the
 * cells that are measurements; `undefined` when a cell is neither a
 * measurement with a numeric nominal nor a numeric value.
 */
function nominalCells(
  ce: ComputeEngine,
  ops: KindOperands
): { nominals: Expression[]; uncertain: UncertainCell[] } | undefined {
  const nominals: Expression[] = [];
  const uncertain: UncertainCell[] = [];
  for (let i = 0; i < ops.evaluated.length; i++) {
    const y = mapCells(ce, ops.evaluated[i], (cell, path) => {
      if (isMeasurement(cell)) {
        if (!isFoldableNumber(cell.op1) || cell.op2.unknowns.length > 0)
          return undefined;
        uncertain.push({ operand: i, path, sigma: cell.op2 });
        return cell.op1;
      }
      return isFoldableNumber(cell) ? cell : undefined;
    });
    if (y === undefined) return undefined;
    nominals.push(y);
  }
  return { nominals, uncertain };
}

/**
 * The value of an operator that is linear in each of its operands (`Dot`,
 * `Cross`, `MatrixMultiply`, `HadamardProduct`, `Trace`: decision 7 and A8
 * of `docs/plans/2026-10-26-value-kinds.md`, section 13) with measurements
 * among the cells of its operands. The value is the operator on the
 * nominals; each cell of the result gets the uncertainty
 * `√(Σ |∂r/∂c|²·σ_c²)` over the uncertain cells `c`. As the operator is
 * linear in the operand that holds `c`, the partial derivative of the
 * result in `c` is the operator applied with that operand replaced by the
 * unit tensor of `c` (1 in the cell `c`, 0 elsewhere):
 * `Dot([2.5 ± 0.1, 2, 3], [1, 2, 3])` is `15.5 ± 0.1`.
 */
function multilinearApply(
  ce: ComputeEngine,
  operator: string,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const cells = nominalCells(ce, ops);
  if (cells === undefined || cells.uncertain.length === 0) return undefined;
  const { nominals, uncertain } = cells;
  const call = ce.function(operator, nominals);
  if (!call.isValid) return call.evaluate();
  const value = call.evaluate({ numericApproximation });
  const partials: Expression[] = [];
  for (const c of uncertain) {
    const unit = mapCells(ce, nominals[c.operand], (_, path) =>
      samePath(path, c.path) ? ce.One : ce.Zero
    );
    if (unit === undefined) return undefined;
    const args = [...nominals];
    args[c.operand] = unit;
    partials.push(ce.function(operator, args).evaluate());
  }
  return mapCells(ce, value, (cell, path) => {
    if (!isFoldableNumber(cell)) return undefined;
    const terms: [Expression, Expression][] = [];
    for (let k = 0; k < uncertain.length; k++) {
      const d = cellAt(partials[k], path);
      if (d === undefined || !isFoldableNumber(d)) return undefined;
      terms.push([d, uncertain[k].sigma]);
    }
    return makeMeasurement(
      ce,
      cell,
      propagatedError(ce, terms),
      numericApproximation
    );
  });
}

/** The cells of a literal vector (a `List` or a `Tuple` of scalars), or
 * `undefined` for any other expression. */
function vectorCells(x: Expression): ReadonlyArray<Expression> | undefined {
  if (!isFunction(x) || !CELL_CONTAINERS.has(x.operator)) return undefined;
  if (x.ops.some((y) => isFunction(y) && CELL_CONTAINERS.has(y.operator)))
    return undefined;
  return x.ops;
}

/**
 * `Norm` of a measurement or of a vector with measurement cells (decision
 * 7, A8 and A11 of `docs/plans/2026-10-26-value-kinds.md`, section 13). The
 * norm of a scalar is its modulus (`partApply()`). For a vector `v` and an
 * order `p` (2 by default; a number, `"Frobenius"`, `"Infinity"` or `+∞`):
 *
 * - `|∂‖v‖_p/∂vₖ| = |vₖ|^(p−1)/‖v‖_p^(p−1)` for a finite `p` (`|vₖ|/‖v‖`
 *   for `p = 2`);
 * - for an uncertain order, `∂‖v‖_p/∂p = ‖v‖_p·(S₁/(p·S₀) − ln S₀/p²)`,
 *   with `S₀ = Σ|vₖ|^p` and `S₁ = Σ|vₖ|^p·ln|vₖ|` over the cells that are
 *   not zero;
 * - for `p = ∞` the norm is the largest modulus: its derivative is 1 in the
 *   one cell that reaches it, and a tie between an uncertain cell and
 *   another leaves the call unevaluated (no derivative).
 *
 * `undefined` (unevaluated) for a matrix, for the zero vector (no
 * derivative), and for an order that is not one of the above.
 */
function normApply(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  const [x, order] = ops.evaluated;
  const cellsOfX = vectorCells(x);
  if (cellsOfX === undefined) {
    if (ops.evaluated.length !== 1) return undefined;
    const arg = applyOperand(ops, 0, numericApproximation);
    if (arg === undefined) return undefined;
    const call = ce.function('Norm', [arg.nominal]);
    if (!call.isValid) return call.evaluate();
    return partApply(ce, 'Abs', arg, call, numericApproximation);
  }
  const cells: ApplyOperand[] = [];
  for (const cell of cellsOfX) {
    if (isMeasurement(cell)) {
      if (!isFoldableNumber(cell.op1) || cell.op2.unknowns.length > 0)
        return undefined;
      cells.push({ nominal: cell.op1, sigma: cell.op2 });
    } else if (isFoldableNumber(cell))
      cells.push({ nominal: cell, sigma: undefined });
    else return undefined;
  }
  // The order: absent (2), a string, an infinity, a number or a
  // measurement.
  let p: ApplyOperand | 'infinity' = {
    nominal: ce.number(2),
    sigma: undefined,
  };
  if (order !== undefined) {
    if (isString(order)) {
      if (order.string === 'Infinity') p = 'infinity';
      else if (order.string !== 'Frobenius') return undefined;
    } else if (isNumber(order) && order.isInfinity === true) p = 'infinity';
    else {
      const a = applyOperand(ops, 1, numericApproximation);
      if (a === undefined || !isRealNominal(a.nominal)) return undefined;
      p = a;
    }
  }
  const vector = ce.function(
    x.operator,
    cells.map((c) => c.nominal)
  );
  const call = ce.function(
    'Norm',
    order === undefined
      ? [vector]
      : [vector, p === 'infinity' ? order : p.nominal]
  );
  if (!call.isValid) return call.evaluate();
  const value = call.evaluate({ numericApproximation });
  const norm = call.evaluate();
  if (realOf(norm) === undefined || norm.isSame(0)) return undefined;
  const terms: [Expression, Expression][] = [];
  const moduli = cells.map((c) => ce.function('Abs', [c.nominal]).evaluate());

  if (p === 'infinity') {
    const largest = moduli.filter((m) => exactOrder(m, norm) === 0);
    const at = moduli.findIndex((m) => exactOrder(m, norm) === 0);
    if (at < 0) return undefined;
    if (largest.length > 1) {
      if (
        cells.some(
          (c, k) => c.sigma !== undefined && exactOrder(moduli[k], norm) === 0
        )
      )
        return undefined;
    } else if (cells[at].sigma !== undefined)
      terms.push([ce.One, cells[at].sigma!]);
    return makeMeasurement(
      ce,
      value,
      propagatedError(ce, terms),
      numericApproximation
    );
  }

  const pm1 = ce.function('Subtract', [p.nominal, ce.One]);
  cells.forEach((c, k) => {
    if (c.sigma === undefined) return;
    terms.push([
      ce
        .function('Divide', [
          ce.function('Power', [moduli[k], pm1]),
          ce.function('Power', [norm, pm1]),
        ])
        .evaluate(),
      c.sigma,
    ]);
  });
  if (p.sigma !== undefined) {
    const nonzero = moduli.filter((m) => !m.isSame(0));
    const powers = nonzero.map((m) => ce.function('Power', [m, p.nominal]));
    const s0 = ce.function('Add', powers);
    const s1 = ce.function(
      'Add',
      nonzero.map((m, k) =>
        ce.function('Multiply', [powers[k], ce.function('Ln', [m])])
      )
    );
    terms.push([
      ce
        .function('Multiply', [
          norm,
          ce.function('Subtract', [
            ce.function('Divide', [
              s1,
              ce.function('Multiply', [p.nominal, s0]),
            ]),
            ce.function('Divide', [
              ce.function('Ln', [s0]),
              ce.function('Power', [p.nominal, 2]),
            ]),
          ]),
        ])
        .evaluate(),
      p.sigma,
    ]);
  }
  if (terms.some(([d]) => isUnboundedPartial(d))) return undefined;
  return makeMeasurement(
    ce,
    value,
    propagatedError(ce, terms),
    numericApproximation
  );
}

/**
 * `Distance(u, v)` of two points with measurement coordinates (decision 7
 * and A8 of `docs/plans/2026-10-26-value-kinds.md`, section 13): the
 * distance `d` of the nominals, and `|∂d/∂uₖ| = |∂d/∂vₖ| = |uₖ − vₖ|/d`.
 * `undefined` (unevaluated) for a list of points, and for two points at
 * the same place (no derivative).
 */
function distanceApply(
  ce: ComputeEngine,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  if (ops.evaluated.length !== 2) return undefined;
  const cells = nominalCells(ce, ops);
  if (cells === undefined) return undefined;
  const [u, v] = cells.nominals;
  const uc = vectorCells(u);
  const vc = vectorCells(v);
  if (uc === undefined || vc === undefined || uc.length !== vc.length)
    return undefined;
  const call = ce.function('Distance', [u, v]);
  if (!call.isValid) return call.evaluate();
  const value = call.evaluate({ numericApproximation });
  const d = call.evaluate();
  if (realOf(d) === undefined || d.isSame(0)) return undefined;
  const terms: [Expression, Expression][] = cells.uncertain.map((c) => {
    const k = c.path[0];
    return [
      ce
        .function('Divide', [
          ce.function('Abs', [ce.function('Subtract', [uc[k], vc[k]])]),
          d,
        ])
        .evaluate(),
      c.sigma,
    ];
  });
  return makeMeasurement(
    ce,
    value,
    propagatedError(ce, terms),
    numericApproximation
  );
}

/**
 * The `apply` hook of the measurement kind: the value of the call of
 * `operator`, an operator that admitted a measurement through the carrier
 * `number` (an APPLY SITE, `docs/plans/2026-10-26-value-kinds.md`, section
 * 4.3), sent to the rule of the operator (the overview above
 * `ApplyOperand`). `undefined` leaves the call unevaluated: the operator
 * has no derivative the engine knows (a user operator
 * `h: (real) -> real` with a handler, `Binomial`, `Zeta`), the operator is
 * one of `UNEVALUATED_OPERATORS`, a determinant or an inverse (which use a
 * cell more than once), or the propagation has no answer at the nominal.
 */
function measurementApply(
  ce: ComputeEngine,
  operator: string,
  ops: KindOperands,
  numericApproximation: boolean
): Expression | undefined {
  if (STATISTICS.has(operator))
    return statisticApply(ce, operator, ops, numericApproximation);
  if (MULTILINEAR.has(operator))
    return multilinearApply(ce, operator, ops, numericApproximation);
  if (operator === 'Norm') return normApply(ce, ops, numericApproximation);
  if (operator === 'Distance')
    return distanceApply(ce, ops, numericApproximation);
  return scalarApply(ce, operator, ops, numericApproximation);
}

/** The operators whose answer for a measurement keeps an error at least as
 * large as the error of a measurement operand, so never a plain number: a
 * sum, a negation, a shift by one (`PreIncrement`, `PreDecrement`: slope 1),
 * and the 1-Lipschitz maps that keep the error (`partApply()`; `Imaginary`
 * is not one, since the imaginary part of a real measurement is exactly 0). */
const MEASUREMENT_PRESERVING_OPERATORS: ReadonlySet<string> = new Set([
  'Add',
  'Negate',
  'PreIncrement',
  'PreDecrement',
  'Conjugate',
  'Real',
  'Re',
  'Abs',
]);

/**
 * The static result type of a cell of an operator with a measurement
 * operand: a hook can answer a plain number, since a zero propagated error
 * collapses to the nominal (`0 · (2 ± 0.1)` is `0`, `Cos(0 ± 0.1)` is `1`),
 * so every operator but those of `MEASUREMENT_PRESERVING_OPERATORS` is typed
 * `number | measurement` (decision 3 and A1 of
 * `docs/plans/2026-10-26-value-kinds.md`, section 13).
 */
function measurementResultType(operator: string): string | undefined {
  if (MEASUREMENT_PRESERVING_OPERATORS.has(operator)) return undefined;
  return 'number | measurement';
}

/**
 * The arithmetic of the value kind `measurement`, the `arithmetic` field of
 * the head `Measurement` (`library/arithmetic.ts`).
 */
export const MEASUREMENT_ARITHMETIC: ArithmeticDefinition = {
  admittedAs: 'number',
  add: (ops, { engine, numericApproximation }) =>
    measurementFold(engine, ops, 'add', numericApproximation),
  multiply: (ops, { engine, numericApproximation }) =>
    measurementFold(engine, ops, 'multiply', numericApproximation),
  negate: (x, { engine, numericApproximation }) =>
    isMeasurement(x.evaluated)
      ? measurementNegate(engine, x.evaluated, numericApproximation)
      : undefined,
  divide: (a, b, { engine, numericApproximation }) =>
    isMeasurementOperand(a.evaluated) && isMeasurementOperand(b.evaluated)
      ? measurementDivide(
          engine,
          a.evaluated,
          b.evaluated,
          numericApproximation
        )
      : undefined,
  power: (base, exponent, { engine, numericApproximation }) =>
    isMeasurementOperand(base.evaluated) &&
    isMeasurementOperand(exponent.evaluated)
      ? measurementPower(
          engine,
          base.evaluated,
          exponent.evaluated,
          numericApproximation
        )
      : undefined,
  compare: (a, b, { tolerance }) => compareMeasurements(a, b, tolerance),
  isExact: () => false,
  // A measurement with a `NaN` nominal stands for no value: `Max` and `Min`
  // of it are `NaN`, as for the number `NaN`.
  isNaN: (value) => isMeasurement(value) && value.op1.isNaN === true,
  // A measurement stands for its nominal: `re` and `im` read it
  // (`Measurement(2.5, 0.1).re` is `2.5`), as a consumer of a numeric
  // quadrature reads `.re` of its result.
  numericValue: (value) => (isMeasurement(value) ? value.op1 : undefined),
  apply: (operator, ops, { engine, numericApproximation }) =>
    measurementApply(engine, operator, ops, numericApproximation),
  resultType: (operator) => measurementResultType(operator),
};
