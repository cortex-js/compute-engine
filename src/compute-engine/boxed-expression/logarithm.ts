import type { Expression } from '../global-types.js';
import type { NumericValue } from '../numeric-value/types.js';
import { isNumber, isSymbol } from './type-guards.js';

/**
 * Whether a number literal's value has an infinite component although it is
 * not one of the three named infinities — an "anonymous" member of the
 * `infinity` type such as `∞ + i` (`isInfinity` and `isFinite` both answer
 * for the named values only). Asked of the NUMERIC VALUE, not the machine
 * projections: a finite bignum beyond the double range (`10^1000`)
 * projects `re` to `Infinity` while its `bignumRe` is finite.
 */
export function hasInfiniteComponent(nv: NumericValue | number): boolean {
  if (typeof nv === 'number') return !Number.isFinite(nv);
  const reFinite =
    nv.bignumRe !== undefined ? nv.bignumRe.isFinite() : Number.isFinite(nv.re);
  return !reFinite || !Number.isFinite(nv.im);
}

/**
 * Where a logarithm operand sits among the exceptional points:
 *
 * - `nan`, `zero` (`ln 0 = −∞`), `one` (`ln 1 = 0`), `pos-inf`
 *   (`ln(+∞) = +∞`), `complex-inf` (`ln(~oo) = ~oo`);
 * - `directed-inf`: an infinite value with a direction other than +∞ —
 *   `−∞` (`ln(−∞) = ∞ + iπ`) or a complex value with an infinite
 *   component (`∞ + i`, an "anonymous" member of the `infinity` type
 *   whose `isInfinity` is false) — whose logarithm is `∞ + iθ`, infinite
 *   and not real;
 * - `finite`: every other finite number literal;
 * - `undefined`: an operand with no known value (a symbol that holds
 *   none), which has no exceptional-point answer.
 *
 * The facts are read through the generic getters (`isNaN`, `isInfinity`,
 * `isPositive`), which follow a symbol's held value, so a caller that
 * passes a symbol holding `+∞` gets the literal's answer. (The simplify
 * pipeline never reaches this with such an operand: it is deliberately
 * value-blind — the `hasAssignedVariable` guard in simplify.ts — and
 * leaves a held value to `evaluate()`.)
 */
type LogPoint =
  | 'nan'
  | 'zero'
  | 'one'
  | 'pos-inf'
  | 'directed-inf'
  | 'complex-inf'
  | 'finite';

function classify(x: Expression): LogPoint | undefined {
  if (x.isNaN === true) return 'nan';
  if (x.isInfinity === true) {
    if (x.isPositive === true) return 'pos-inf';
    if (x.isNegative === true) return 'directed-inf';
    // No sign: the literal `~oo`. A symbol merely DECLARED with the
    // `infinity` type answers `isInfinity` true with no sign as well, but
    // holds no value to fold.
    return isNumber(x) ? 'complex-inf' : undefined;
  }
  if (isNumber(x)) {
    if (hasInfiniteComponent(x.numericValue)) return 'directed-inf';
    if (x.isSame(0)) return 'zero';
    if (x.isSame(1)) return 'one';
    return 'finite';
  }
  return undefined;
}

const isInfinitePoint = (p: LogPoint): boolean =>
  p === 'zero' ||
  p === 'pos-inf' ||
  p === 'directed-inf' ||
  p === 'complex-inf';

/** The argument θ of an infinite value's logarithm `∞ + iθ`: π for `−∞`,
 * the direction of the infinite components otherwise. */
function directionOfInfinity(x: Expression): number {
  if (x.isNegative === true) return Math.PI;
  return isNumber(x) ? Math.atan2(x.im, x.re) : Math.PI;
}

/**
 * The sign of `ln b` for a finite base `b` other than 0 and 1: `'positive'`
 * for a real `b > 1`, `'negative'` for a real `0 < b < 1`, and `'complex'`
 * for a negative or non-real base (its logarithm is a non-zero complex
 * number).
 */
function lnBaseSign(base: Expression): 'positive' | 'negative' | 'complex' {
  if (base.isGreater(1) === true) return 'positive';
  if (base.isPositive === true && base.isLess(1) === true) return 'negative';
  return 'complex';
}

/** `ln b` as a machine number for a finite real base `b > 0`, computed
 * from the bignum when the literal carries one — a base outside the
 * double range (`10^1000`) projects `re` to `Infinity`, which would lose
 * the finite logarithm. */
function machineLnOfBase(base: Expression): number {
  if (isNumber(base)) {
    const nv = base.numericValue;
    if (typeof nv !== 'number' && nv.bignumRe !== undefined)
      return nv.bignumRe.ln().toNumber();
  }
  return Math.log(base.re);
}

/**
 * `Log(x, base)` — `Ln(x)` when `base` is absent or `e` — at the EXCEPTIONAL
 * points, defined as the quotient `Ln(x) / Ln(base)` under the engine's
 * extended arithmetic (ruled 2026-09-01). The building blocks are
 * `ln 0 = −∞`, `ln 1 = 0`, `ln(+∞) = +∞`, `ln(−∞) = ∞ + iπ`,
 * `ln(~oo) = ~oo` (the modulus grows without bound in every direction), and
 * the quotient rules `finite/0 = ~oo`, `finite/∞ = 0`, `∞/∞ = NaN`,
 * `0/0 = NaN`. So `Log(8, 1) = ~oo`, `Log(8, 0) = 0`, `Log(0, 1/2) = +∞`,
 * `Log(+∞, +∞) = NaN`, `Log(1, 1) = NaN`, `Log(8, ~oo) = 0`.
 *
 * `NaN` in either operand propagates. An operand with no known value has
 * no exceptional-point answer, with one generic-point exception: `Log(1, b)`
 * is 0 for a symbolic base — the same convention as `1^x = 1`, where the
 * exceptional base (`b = 1`, giving `0/0`) is not assumed.
 *
 * Returns `undefined` when the ordinary logarithm applies (both operands
 * finite and away from 0 and 1), or when the value has no exact spelling
 * under `evaluate()` — `Ln(−∞)` and the other directed infinities, and
 * their quotients by a finite base — which `numericApproximation` answers
 * as a machine complex (`∞ + iπ` for the natural logarithm of `−∞`;
 * `∞ + i·π/ln b` for a real base `b > 1`, the mirror `−∞ − i·π/|ln b|`
 * for `0 < b < 1`).
 */
export function logarithmAtExceptionalPoint(
  ce: Expression['engine'],
  x: Expression,
  base: Expression | undefined,
  numericApproximation: boolean
): Expression | undefined {
  const natural = base === undefined || isSymbol(base, 'ExponentialE');
  const n = classify(x);
  const d = natural ? undefined : classify(base!);
  if (n === 'nan' || d === 'nan') return ce.NaN;

  // A symbolic argument: nothing to say. A symbolic BASE: only `Log(1, b)`
  // answers (the generic-point 0).
  if (n === undefined) return undefined;
  if (!natural && d === undefined) return n === 'one' ? ce.Zero : undefined;

  // The natural logarithm (or the quotient by `ln e = 1`).
  if (natural) {
    if (n === 'zero') return ce.NegativeInfinity;
    if (n === 'one') return ce.Zero;
    if (n === 'pos-inf') return ce.PositiveInfinity;
    if (n === 'complex-inf') return ce.ComplexInfinity;
    if (n === 'directed-inf')
      return numericApproximation
        ? ce.number(
            ce._numericValue({ re: Infinity, im: directionOfInfinity(x) })
          )
        : undefined;
    return undefined;
  }

  // `ln base = 0` (base 1): a non-zero numerator over 0 is `~oo`; `0/0` NaN.
  if (d === 'one') return n === 'one' ? ce.NaN : ce.ComplexInfinity;

  // An infinite `ln base` (base 0, ±∞, or ~oo): a finite numerator gives 0,
  // an infinite one the indeterminate `∞/∞`.
  if (isInfinitePoint(d!)) return isInfinitePoint(n) ? ce.NaN : ce.Zero;

  // A finite base other than 0 and 1: `ln base` is finite and non-zero.
  if (n === 'finite') return undefined;
  if (n === 'one') return ce.Zero;
  if (n === 'complex-inf') return ce.ComplexInfinity;
  const sign = lnBaseSign(base!);
  if (n === 'zero' || n === 'pos-inf') {
    // `−∞` or `+∞` over a real `ln base`: the sign follows the quotient; a
    // complex `ln base` leaves the modulus infinite with no real direction.
    if (sign === 'complex') return ce.ComplexInfinity;
    const positive = (n === 'pos-inf') === (sign === 'positive');
    return positive ? ce.PositiveInfinity : ce.NegativeInfinity;
  }
  // `n === 'directed-inf'`: `(∞ + iθ) / ln base`.
  if (!numericApproximation) return undefined;
  if (sign === 'complex') return ce.ComplexInfinity;
  const lnB = machineLnOfBase(base!);
  return ce.number(
    ce._numericValue({
      re: lnB > 0 ? Infinity : -Infinity,
      im: directionOfInfinity(x) / lnB,
    })
  );
}
