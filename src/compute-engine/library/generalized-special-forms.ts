import { shouldNumericize } from '../boxed-expression/apply.js';
import { asRational } from '../boxed-expression/numerics.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { MACHINE_PRECISION } from '../numerics/numeric.js';

import type {
  EvaluateHandlerOptions,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

//
// The generalized call forms Wolfram gives the incomplete and error
// functions, each an identity over a call the head already answers:
//
//   Erf(z0, z1)                = Erf(z1) − Erf(z0)                  (DLMF 7.2.1)
//   ErfInv(z0, z)              = ErfInv(z + Erf(z0))
//   Gamma(a, z0, z1)           = Γ(a, z0) − Γ(a, z1)                (DLMF 8.2.3)
//   GammaRegularized(a, z0, z1) = Q(a, z0) − Q(a, z1)
//   BetaRegularized(z0, z1, a, b) = I_{z1}(a, b) − I_{z0}(a, b)     (DLMF 8.17.2)
//   Beta(z, a, b)              = I_z(a, b)·B(a, b)                  (DLMF 8.17.1)
//   Beta(z0, z1, a, b)         = B_{z1}(a, b) − B_{z0}(a, b)
//

/**
 * The most digits above the working precision that a difference or a shifted
 * inverse asks for. Past it the call stays unevaluated: the value would need
 * more digits of the operands than the kernels are measured to give.
 */
const MAX_GUARD_DIGITS = 500;

/** Digits kept above the loss that the difference measures. */
const SAFETY_DIGITS = 5;

/** The largest `a + b - 1` for which `B_z(a, b)` is expanded exactly. */
const MAX_EXACT_BETA_DEGREE = 200;

type Pair = readonly [Expression, Expression];

/**
 * The operands as written (`1/3`, `√2`) when the call has them, so that the
 * guard digits are digits of the exact operand and not of a rounded float;
 * otherwise the operands received.
 */
function operandsAsWritten(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  const written = options.expression;
  return written !== undefined &&
    isFunction(written) &&
    written.nops === ops.length
    ? written.ops
    : ops;
}

/** The operands as written, approximated at the precision in force. */
function operandsAtPrecision(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>
): Expression[] {
  return operandsAsWritten(options, ops).map((op) => op.N());
}

function magnitudeRatio(value: Expression, difference: Expression): number {
  if (value.isSame(0)) return 0;
  return value.abs().div(difference.abs()).re;
}

/**
 * `value` at the working precision of the engine: a big decimal computed at a
 * raised precision is cut to `working` digits, and a machine float is made
 * again at machine precision.
 */
function atWorkingPrecision(
  ce: ComputeEngine,
  value: Expression,
  working: number
): Expression {
  if (!isNumber(value) || value.isExact || value.isFinite !== true)
    return value;
  const re = value.bignumRe;
  const im = value.bignumIm;
  if (working <= MACHINE_PRECISION) {
    // A value outside the range of a double stays a big decimal.
    const lost = (part: number, big: typeof re): boolean =>
      !Number.isFinite(part) ||
      (part === 0 && big !== undefined && !big.isZero());
    if (lost(value.re, re) || lost(value.im, im)) return value;
    return ce.number(
      ce._inexactNumericValue(
        value.im === 0 ? value.re : { re: value.re, im: value.im }
      )
    );
  }
  if (re === undefined && im === undefined) return value;
  const bigRe = (re ?? ce.bignum(value.re)).toPrecision(working);
  if (!value.isComplex) return ce.number(ce._numericValue(bigRe));
  const bigIm = (im ?? ce.bignum(value.im)).toPrecision(working);
  return ce.number(ce._inexactNumericValue({ re: bigRe, im: bigIm }));
}

/**
 * The difference of two terms of a special function, `terms[0] - terms[1]`.
 *
 * An exact call answers only where both terms fold to exact numbers. A call
 * with a float operand, or under `.N()`, subtracts the two values at a
 * precision raised by the digits that the subtraction cancels (the larger term
 * over the difference), plus a margin, and declines (`undefined`) where that
 * takes more than `MAX_GUARD_DIGITS`.
 */
export function evaluateDifference(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>,
  endpoints: readonly [number, number],
  build: (at: ReadonlyArray<Expression>) => Pair | undefined
): Expression | undefined {
  const ce = options.engine;
  if (ops.some((op) => !isNumber(op) || op.isNaN === true)) return undefined;
  // The endpoints as written: two that differ in digits the working precision
  // does not hold are not the same endpoint.
  const written = operandsAsWritten(options, ops);
  const coincide = written[endpoints[0]].isSame(written[endpoints[1]]);

  if (!shouldNumericize(options.numericApproximation, ...ops)) {
    const exact = build(ops);
    if (exact === undefined) return undefined;
    const upper = exact[0].evaluate();
    const lower = exact[1].evaluate();
    if (
      !isNumber(upper) ||
      !isNumber(lower) ||
      upper.isFinite !== true ||
      lower.isFinite !== true
    )
      return undefined;
    // `.sub()` of two exact literals is a float.
    return ce.function('Subtract', [upper, lower]).evaluate();
  }

  const working = ce.precision;
  let guard = 10;
  for (;;) {
    const outcome = ce._withTransientPrecision(working + guard, () => {
      const built = build(operandsAtPrecision(options, ops));
      if (built === undefined) return null;
      const upper = built[0].N();
      const lower = built[1].N();
      if (
        !isNumber(upper) ||
        !isNumber(lower) ||
        upper.isFinite !== true ||
        lower.isFinite !== true
      )
        return null;
      const difference = upper.sub(lower);
      if (coincide || (upper.isSame(0) && lower.isSame(0)))
        return { difference, lost: 0 };
      if (difference.isSame(0)) return { difference, lost: Infinity };
      const ratio = Math.max(
        magnitudeRatio(upper, difference),
        magnitudeRatio(lower, difference)
      );
      return { difference, lost: Math.log10(ratio) };
    });
    if (outcome === null || Number.isNaN(outcome.lost)) return undefined;
    if (outcome.lost + SAFETY_DIGITS <= guard)
      return atWorkingPrecision(ce, outcome.difference, working);
    // A difference of exactly 0 between endpoints that differ has lost every
    // digit: the loss is not measured, so the guard grows geometrically.
    if (guard >= MAX_GUARD_DIGITS) return undefined;
    guard = Math.min(
      Number.isFinite(outcome.lost)
        ? Math.ceil(outcome.lost) + 2 * SAFETY_DIGITS
        : 4 * guard,
      MAX_GUARD_DIGITS
    );
  }
}

const isReal = (x: Expression): boolean => isNumber(x) && !x.isComplex;
const isAbove = (x: Expression, bound: number): boolean =>
  isReal(x) && x.re > bound;
const isBelow = (x: Expression, bound: number): boolean =>
  isReal(x) && x.re < bound;

/**
 * `Erf(z0, z1) = Erf(z1) - Erf(z0)`. Two operands of one sign subtract the
 * complementary error functions instead (`erf z1 - erf z0 = erfc z0 - erfc
 * z1`, DLMF 7.2.2): `erf(5)` is `1 - 1.5e-12`, and its difference with
 * `erf(5.1)` would otherwise cancel twelve digits more than it has to.
 */
export function evaluateErfBetween(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const ce = options.engine;
  const erf = (x: Expression) => ce.function('Erf', [x]);
  const erfc = (x: Expression) => ce.function('Erfc', [x]);
  // erf is entire and finite at the infinities: the same endpoint twice is 0.
  const written = operandsAsWritten(options, ops);
  if (
    ops.every((op) => isNumber(op) && op.isNaN !== true) &&
    written[0].isSame(written[1])
  )
    return ce.Zero;
  return evaluateDifference(options, ops, [0, 1], ([z0, z1]) => {
    if (isAbove(z0, 0) && isAbove(z1, 0)) return [erfc(z0), erfc(z1)];
    if (isBelow(z0, 0) && isBelow(z1, 0))
      return [
        erfc(ce.function('Negate', [z1])),
        erfc(ce.function('Negate', [z0])),
      ];
    return [erf(z1), erf(z0)];
  });
}

/**
 * `ErfInv(z0, z)`: the `x` with `erf(x) - erf(z0) = z`, which is
 * `ErfInv(z + Erf(z0))`. An error `e` in the sum reaches `x` as
 * `e·(√π/2)·exp(x²)`, so the sum is taken with `x²/ln 10` more digits (the
 * `x` of a first pass), and the call declines where that is more than
 * `MAX_GUARD_DIGITS`.
 */
export function evaluateErfInvShifted(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const ce = options.engine;
  const [z0, z] = ops;
  if (!isNumber(z0) || !isNumber(z) || z0.isNaN === true || z.isNaN === true)
    return undefined;
  if (!shouldNumericize(options.numericApproximation, z0, z)) {
    // erf(0) = 0 is the one shift that is exact.
    return z0.isSame(0) ? ce.function('ErfInv', [z]).evaluate() : undefined;
  }
  if (!isReal(z0) || !isReal(z) || z0.isFinite !== true || z.isFinite !== true)
    return undefined;
  const working = ce.precision;
  let guard = 10;
  for (;;) {
    const x = ce._withTransientPrecision(working + guard, () => {
      const [a, b] = operandsAtPrecision(options, ops);
      const sum = ce.function('Erf', [a]).N().add(b);
      if (!isNumber(sum) || !(sum.re > -1 && sum.re < 1)) return null;
      const inverse = ce.function('ErfInv', [sum]).N();
      return isNumber(inverse) && inverse.isFinite === true ? inverse : null;
    });
    if (x === null) return undefined;
    const needed = Math.ceil((x.re * x.re) / Math.LN10) + 2 * SAFETY_DIGITS;
    if (needed <= guard) return atWorkingPrecision(ce, x, working);
    if (guard >= MAX_GUARD_DIGITS || needed > MAX_GUARD_DIGITS)
      return undefined;
    guard = needed;
  }
}

/**
 * `BetaRegularized(z0, z1, a, b) = I_{z1}(a, b) - I_{z0}(a, b)`, as the two
 * calls (before a common factor). For `z0` and `z1` above 1/2 the terms are
 * those of the complement, `I_x(a, b) = 1 - I_{1-x}(b, a)` (DLMF 8.17.4):
 * `I_{z1} - I_{z0}` is `I_{1-z0}(b, a) - I_{1-z1}(b, a)`, which keeps its
 * digits where both `I` are close to 1.
 */
function regularizedBetaTerms(
  ce: ComputeEngine,
  [z0, z1, a, b]: ReadonlyArray<Expression>
): Pair {
  const regularized = (x: Expression, p: Expression, q: Expression) =>
    ce.function('BetaRegularized', [x, p, q]);
  if (isAbove(z0, 0.5) && isAbove(z1, 0.5)) {
    const complement = (x: Expression) => ce.function('Subtract', [ce.One, x]);
    return [
      regularized(complement(z0), b, a),
      regularized(complement(z1), b, a),
    ];
  }
  return [regularized(z1, a, b), regularized(z0, a, b)];
}

export function evaluateRegularizedBetaBetween(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const ce = options.engine;
  return evaluateDifference(options, ops, [0, 1], (at) =>
    regularizedBetaTerms(ce, at)
  );
}

/**
 * `Gamma(a, z0, z1) = Γ(a, z0) - Γ(a, z1)`, and for `regularized`
 * `GammaRegularized(a, z0, z1) = Q(a, z0) - Q(a, z1)`. Where either term has no
 * finite value (`Q(-1/2, 0)` is infinite) the call stays unevaluated.
 */
export function evaluateGammaBetween(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>,
  regularized: boolean
): Expression | undefined {
  const ce = options.engine;
  const head = regularized ? 'GammaRegularized' : 'Gamma';
  return evaluateDifference(options, ops, [1, 2], ([a, z0, z1]) => [
    ce.function(head, [a, z0]),
    ce.function(head, [a, z1]),
  ]);
}

type Q = readonly [bigint, bigint];

function reduced(p: bigint, q: bigint): Q {
  if (q < 0n) [p, q] = [-p, -q];
  let [x, y] = [p < 0n ? -p : p, q];
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? [p, q] : [p / x, q / x];
}

/**
 * `B_z(a, b) = Σ_{j<b} C(b-1, j)(-1)^j z^(a+j)/(a+j)`: the integral of
 * `t^(a-1)(1-t)^(b-1)` from 0 to `z`, expanded term by term, exact for a
 * rational `z` and positive integers `a`, `b` (DLMF 8.17.1).
 */
function incompleteBetaPolynomial(z: Q, a: number, b: number): Q {
  let sum: Q = [0n, 1n];
  let binomial = 1n;
  const power = (n: number): Q => [z[0] ** BigInt(n), z[1] ** BigInt(n)];
  for (let j = 0; j < b; j++) {
    const [zn, zd] = power(a + j);
    const sign = j % 2 === 0 ? 1n : -1n;
    const term = reduced(sign * binomial * zn, BigInt(a + j) * zd);
    sum = reduced(sum[0] * term[1] + term[0] * sum[1], sum[1] * term[1]);
    binomial = (binomial * BigInt(b - 1 - j)) / BigInt(j + 1);
  }
  return sum;
}

function exactRational(x: Expression): Q | undefined {
  if (!isNumber(x) || !x.isExact) return undefined;
  const r = asRational(x);
  return r === undefined ? undefined : [BigInt(r[0]), BigInt(r[1])];
}

const positiveInteger = (x: Expression, limit: number): number | undefined => {
  const r = exactRational(x);
  if (r === undefined || r[1] !== 1n || r[0] < 1n || r[0] > BigInt(limit))
    return undefined;
  return Number(r[0]);
};

/**
 * `Beta(z, a, b)` and `Beta(z0, z1, a, b)`, the incomplete and the
 * generalized incomplete beta functions.
 *
 * A rational `z` with positive integers `a`, `b` is the exact rational
 * `B_z(a, b)` (the polynomial above), under `evaluate()` and `.N()` alike.
 * Otherwise a call with a float operand, or under `.N()`, takes
 * `B_z(a, b) = I_z(a, b)·B(a, b)` with real `a, b > 0` and `z` where
 * `BetaRegularized` has its value; any other call stays unevaluated.
 */
export function evaluateIncompleteBeta(
  options: EvaluateHandlerOptions,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  const ce = options.engine;
  const endpoints = ops.slice(0, ops.length - 2);
  const [a, b] = ops.slice(-2);
  if (ops.some((op) => !isNumber(op) || op.isNaN === true)) return undefined;

  const ia = positiveInteger(a, MAX_EXACT_BETA_DEGREE);
  const ib = positiveInteger(b, MAX_EXACT_BETA_DEGREE);
  const zs = endpoints.map(exactRational);
  if (
    ia !== undefined &&
    ib !== undefined &&
    ia + ib - 1 <= MAX_EXACT_BETA_DEGREE &&
    zs.every((z): z is Q => z !== undefined)
  ) {
    const values = (zs as Q[]).map((z) => incompleteBetaPolynomial(z, ia, ib));
    const hi = values[values.length - 1];
    const lo: Q = values.length === 2 ? values[0] : [0n, 1n];
    const [p, q] = reduced(hi[0] * lo[1] - lo[0] * hi[1], hi[1] * lo[1]);
    const exact = ce.number([p, q]);
    return options.numericApproximation ? exact.N() : exact;
  }

  if (!shouldNumericize(options.numericApproximation, ...ops)) return undefined;
  if (
    !ops.every(isReal) ||
    ops.some((op) => op.isFinite !== true) ||
    !isAbove(a, 0) ||
    !isAbove(b, 0)
  )
    return undefined;

  const working = ce.precision;
  const beta = (x: Expression, y: Expression) => ce.function('Beta', [x, y]);
  if (endpoints.length === 2) {
    return evaluateDifference(options, ops, [0, 1], (at) => {
      const [upper, lower] = regularizedBetaTerms(ce, at);
      const scale = beta(at[2], at[3]);
      return [
        ce.function('Multiply', [upper, scale]),
        ce.function('Multiply', [lower, scale]),
      ];
    });
  }
  // A single endpoint: a product, with no cancellation to guard.
  if (!(ops[0].re >= 0 && ops[0].re <= 1)) return undefined;
  const product = ce
    .function('Multiply', [
      ce.function('BetaRegularized', [...ops]),
      beta(ops[1], ops[2]),
    ])
    .N();
  if (!isNumber(product) || product.isFinite !== true) return undefined;
  return atWorkingPrecision(ce, product, working);
}
