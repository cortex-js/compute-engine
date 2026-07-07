/**
 * Arithmetic helpers for Measurement expressions.
 *
 * A `Measurement(value, error)` carries a nominal `value` and a 1σ absolute
 * `error`.  Arithmetic propagates the error using the standard independent,
 * first-order (quadrature) formulas.  This mirrors the structure of
 * `quantity-arithmetic.ts`: every function here operates on Measurement
 * expressions and is called from the evaluate paths of Add, Multiply, Divide,
 * Negate and Power in `arithmetic.ts`.
 *
 * Nominals are computed with ordinary engine arithmetic on the value
 * components (honoring exactness — `a.mul(b)` etc.).  Errors are built as
 * boxed expressions (`Sqrt(Add(…squares…))`) using the nominal values as the
 * partial-derivative coefficients, so that exact inputs keep a symbolic error
 * under `evaluate()` and `.N()` produces the float — honoring the
 * evaluate-vs-N exactness contract.
 *
 * A non-`Measurement` operand is promoted to a measurement with error 0 (its
 * exact value); this uniformly handles scalar·measurement, scalar+measurement,
 * measurement^scalar, etc.
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isFunction } from '../boxed-expression/type-guards';

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

/** Build a boxed `x²`. */
function square(ce: ComputeEngine, x: Expression): Expression {
  return ce.function('Power', [x, 2]);
}

/**
 * Build the result Measurement.  A zero error collapses to the bare value
 * (handled by the Measurement canonical form as well).
 */
function makeMeasurement(
  ce: ComputeEngine,
  value: Expression,
  error: Expression
): Expression {
  if (error.isSame(0)) return value;
  return ce.function('Measurement', [value, error]);
}

// ---------------------------------------------------------------------------
// Measurement arithmetic
// ---------------------------------------------------------------------------

/**
 * Add measurements (and scalars, promoted to error-0 measurements).
 * Folded pairwise: σ = √(σ_a² + σ_b²).
 */
export function measurementAdd(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length === 0) return undefined;
  let acc = toPair(ce, ops[0]);
  for (let i = 1; i < ops.length; i++) {
    const b = toPair(ce, ops[i]);
    const value = acc.value.add(b.value);
    const error = ce.function('Sqrt', [
      ce.function('Add', [square(ce, acc.error), square(ce, b.error)]),
    ]);
    acc = { value, error };
  }
  return makeMeasurement(ce, acc.value, acc.error);
}

/**
 * Multiply measurements (and scalars).  Folded pairwise:
 * nominal = a·b, σ = √(b²σ_a² + a²σ_b²).
 */
export function measurementMultiply(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length === 0) return undefined;
  let acc = toPair(ce, ops[0]);
  for (let i = 1; i < ops.length; i++) {
    const b = toPair(ce, ops[i]);
    const a = acc.value;
    const value = a.mul(b.value);
    const error = ce.function('Sqrt', [
      ce.function('Add', [
        ce.function('Multiply', [square(ce, b.value), square(ce, acc.error)]),
        ce.function('Multiply', [square(ce, a), square(ce, b.error)]),
      ]),
    ]);
    acc = { value, error };
  }
  return makeMeasurement(ce, acc.value, acc.error);
}

/**
 * Divide two operands (at least one a Measurement).
 * nominal = a/b, σ = √(σ_a²/b² + a²σ_b²/b⁴).
 */
export function measurementDivide(
  ce: ComputeEngine,
  num: Expression,
  den: Expression
): Expression | undefined {
  const A = toPair(ce, num);
  const B = toPair(ce, den);
  const a = A.value;
  const b = B.value;
  const value = a.div(b);
  const term1 = ce.function('Divide', [square(ce, A.error), square(ce, b)]);
  const term2 = ce.function('Divide', [
    ce.function('Multiply', [square(ce, a), square(ce, B.error)]),
    ce.function('Power', [b, 4]),
  ]);
  const error = ce.function('Sqrt', [ce.function('Add', [term1, term2])]);
  return makeMeasurement(ce, value, error);
}

/**
 * Negate a measurement.  nominal = −a, σ unchanged.
 */
export function measurementNegate(
  ce: ComputeEngine,
  expr: Expression
): Expression | undefined {
  const A = toPair(ce, expr);
  return makeMeasurement(ce, A.value.neg(), A.error);
}

/**
 * Raise a measurement to a power (or a scalar to a measurement power).
 * nominal = a^b, σ = √((b·a^{b−1})²σ_a² + (a^b·ln a)²σ_b²).
 */
export function measurementPower(
  ce: ComputeEngine,
  base: Expression,
  exp: Expression
): Expression | undefined {
  const A = toPair(ce, base);
  const B = toPair(ce, exp);
  const a = A.value;
  const b = B.value;
  const value = a.pow(b);

  const saZero = A.error.isSame(0);
  const sbZero = B.error.isSame(0);

  const terms: Expression[] = [];
  if (!saZero) {
    // (b·a^{b−1})² · σ_a²
    const partial = ce.function('Multiply', [
      b,
      ce.function('Power', [a, ce.function('Subtract', [b, 1])]),
    ]);
    terms.push(
      ce.function('Multiply', [square(ce, partial), square(ce, A.error)])
    );
  }
  if (!sbZero) {
    // (a^b·ln a)² · σ_b² — the ln-a term requires a > 0.  For a ≤ 0, ln a is
    // complex/undefined and this partial is ill-defined; rather than produce a
    // NaN error we drop the uncertainty contribution from the exponent and
    // return the nominal-only result.  (Only reachable for a genuinely
    // uncertain exponent, i.e. scalar^measurement or measurement^measurement.)
    if (a.isPositive !== true) return value;
    const partial = ce.function('Multiply', [
      ce.function('Power', [a, b]),
      ce.function('Ln', [a]),
    ]);
    terms.push(
      ce.function('Multiply', [square(ce, partial), square(ce, B.error)])
    );
  }

  if (terms.length === 0) return value;
  const error = ce.function('Sqrt', [
    terms.length === 1 ? terms[0] : ce.function('Add', terms),
  ]);
  return makeMeasurement(ce, value, error);
}

// ---------------------------------------------------------------------------
// Elementary functions (unary, first-order propagation)
// ---------------------------------------------------------------------------

/**
 * Generic unary error propagation: `σ_f = |f'(a)|·σ_a`.
 *
 * `fNominal(a)` builds the nominal `f(a)` (ordinary engine arithmetic, so
 * exactness is preserved).  `fPrime(a)` builds the derivative `f'(a)` as a
 * boxed expression, or returns `undefined` at a domain edge where `f'` is
 * undefined/infinite (e.g. `ln`/`sqrt` of a non-positive nominal, `tan` at a
 * pole) — in which case the error bar is dropped and the bare nominal is
 * returned rather than producing NaN.
 *
 * The error is evaluated so that (a) exact inputs keep an exact error under
 * `evaluate()` and `.N()` floats it (evaluate-vs-N contract), and (b) a zero
 * slope at a stationary point (e.g. `cos` at `a = 0`) collapses to error 0,
 * which `makeMeasurement`/the `Measurement` canonical form fold back to the
 * bare value — the correct first-order behavior (linear propagation gives zero
 * error at an extremum).
 */
function measurementUnary(
  ce: ComputeEngine,
  arg: Expression,
  fNominal: (a: Expression) => Expression,
  fPrime: (a: Expression) => Expression | undefined
): Expression | undefined {
  const A = toPair(ce, arg);
  const a = A.value;
  const value = fNominal(a);
  // Exact input (error 0): nothing to propagate.
  if (A.error.isSame(0)) return value;
  const d = fPrime(a);
  if (d === undefined) return value; // domain edge — see docstring
  const error = ce
    .function('Multiply', [ce.function('Abs', [d]), A.error])
    .evaluate();
  return makeMeasurement(ce, value, error);
}

/** √a: nominal √a, σ = σ_a / (2√a). */
export function measurementSqrt(
  ce: ComputeEngine,
  arg: Expression
): Expression | undefined {
  return measurementUnary(
    ce,
    arg,
    (a) => a.sqrt(),
    (a) => {
      // a = 0 → infinite slope, a < 0 → complex; drop the error bar.
      if (a.isPositive !== true) return undefined;
      return ce.function('Divide', [
        1,
        ce.function('Multiply', [2, ce.function('Sqrt', [a])]),
      ]);
    }
  );
}

/** a^{1/n} (n the constant index): nominal a^{1/n}, σ = |a^{1/n−1}/n|·σ_a. */
export function measurementRoot(
  ce: ComputeEngine,
  base: Expression,
  index: Expression
): Expression | undefined {
  return measurementUnary(
    ce,
    base,
    (a) => ce.function('Root', [a, index]),
    (a) => {
      // Real root propagation is only defined for a > 0 (a = 0 with n > 1 has
      // infinite slope, a < 0 gives a complex root); drop the error otherwise.
      if (a.isPositive !== true) return undefined;
      const oneOverN = ce.function('Divide', [1, index]);
      return ce.function('Divide', [
        ce.function('Power', [a, ce.function('Subtract', [oneOverN, 1])]),
        index,
      ]);
    }
  );
}

/** ln a: nominal ln a, σ = σ_a / |a|. */
export function measurementLn(
  ce: ComputeEngine,
  arg: Expression
): Expression | undefined {
  return measurementUnary(
    ce,
    arg,
    (a) => a.ln(),
    // ln a is real only for a > 0; for a ≤ 0 (complex/undefined) drop the error.
    (a) => (a.isPositive !== true ? undefined : ce.function('Divide', [1, a]))
  );
}

/** log_b a: nominal log_b a, σ = σ_a / (|a|·ln b). */
export function measurementLog(
  ce: ComputeEngine,
  arg: Expression,
  base: Expression
): Expression | undefined {
  return measurementUnary(
    ce,
    arg,
    (a) => a.ln(base),
    (a) => {
      // Requires a > 0 and a valid real base b > 0, b ≠ 1.
      if (a.isPositive !== true) return undefined;
      if (base.isPositive !== true || base.isSame(1)) return undefined;
      return ce.function('Divide', [
        1,
        ce.function('Multiply', [a, ce.function('Ln', [base])]),
      ]);
    }
  );
}

/**
 * The chain factor dθ/da converting the engine's angular unit to radians, so
 * the trig derivatives (`cos`, `−sin`, `sec²`) are taken in the SAME
 * convention `Sin`/`Cos`/`Tan` use to evaluate (they interpret their argument
 * in `ce.angularUnit`).  In radian mode this is 1 (no chain factor); in degree
 * mode it is π/180, etc. — matching `angleToRadians` in
 * `boxed-expression/utils.ts`.
 */
function angularChainFactor(ce: ComputeEngine): Expression {
  switch (ce.angularUnit) {
    case 'deg':
      return ce.function('Divide', [ce.Pi, 180]);
    case 'grad':
      return ce.function('Divide', [ce.Pi, 200]);
    case 'turn':
      return ce.function('Multiply', [2, ce.Pi]);
    default:
      return ce.number(1); // 'rad'
  }
}

/**
 * Sin/Cos/Tan error propagation.  σ_f = |f'(a)|·σ_a with the derivative taken
 * in the engine's angular convention (see `angularChainFactor`).  Returns
 * `undefined` for any other operator (the caller then falls through to the
 * normal trig evaluate path).
 */
export function measurementTrig(
  ce: ComputeEngine,
  operator: string,
  arg: Expression
): Expression | undefined {
  const k = angularChainFactor(ce);
  if (operator === 'Sin')
    return measurementUnary(
      ce,
      arg,
      (a) => ce.function('Sin', [a]),
      (a) => ce.function('Multiply', [k, ce.function('Cos', [a])])
    );
  if (operator === 'Cos')
    return measurementUnary(
      ce,
      arg,
      (a) => ce.function('Cos', [a]),
      // |−k·sin a| = |k·sin a|; the sign folds under the helper's Abs.
      (a) => ce.function('Multiply', [k, ce.function('Sin', [a])])
    );
  if (operator === 'Tan')
    return measurementUnary(
      ce,
      arg,
      (a) => ce.function('Tan', [a]),
      (a) => {
        // k·sec²a = k / cos²a; undefined at a pole (cos a = 0 → infinite error).
        const cosA = ce.function('Cos', [a]).evaluate();
        if (cosA.isSame(0)) return undefined;
        return ce.function('Divide', [k, ce.function('Power', [cosA, 2])]);
      }
    );
  return undefined;
}
