import type { Expression } from '../global-types.js';
import { isNumber, isSymbol, indeterminateFormAnswer } from './type-guards.js';
import { asFloat, hasFloatOperand } from './float-result.js';
import { isCollectionShaped } from '../collection-utils.js';

/**
 * Where a logarithm operand sits among the exceptional points:
 *
 * - `nan`, `zero` (`ln 0 = −∞`), `one` (`ln 1 = 0`), `pos-inf`
 *   (`ln(+∞) = +∞`), `complex-inf` (`ln(~oo) = ~oo`);
 * - `directed-inf`: `−∞`, an infinite value with a direction other than
 *   +∞, whose logarithm is `∞ + iπ`. A value with an infinite real part and
 *   a finite imaginary part is the real infinity `+∞` or `−∞`
 *   (`canonicalNumber()`), so `ln(−∞) = +∞`, as `ln(+∞)`;
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
    // A literal with an infinite part is boxed as `±∞` or `~oo`
    // (`canonicalNumber()`), thus it was classified above.
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

/**
 * `Log(x, base)` — `Ln(x)` when `base` is absent or `e` — at the EXCEPTIONAL
 * points, defined as the quotient `Ln(x) / Ln(base)` under the engine's
 * extended arithmetic (ruled 2026-09-01). The building blocks are
 * `ln 0 = −∞`, `ln 1 = 0`, `ln(+∞) = +∞`, `ln(−∞) = +∞` (the limit
 * `∞ + iπ` has an infinite real part and a finite imaginary part, and such
 * a value is the real infinity `+∞`),
 * `ln(~oo) = ~oo` (the modulus grows without bound in every direction), and
 * the quotient rules `finite/0 = ~oo`, `finite/∞ = 0`, and the
 * indeterminate forms `∞/∞` and `0/0` (`Indeterminate`, or `NaN` with a
 * float operand). So `Log(8, 1) = ~oo`, `Log(8, 0) = 0`,
 * `Log(0, 1/2) = +∞`, `Log(+∞, +∞) = Indeterminate`,
 * `Log(1, 1) = Indeterminate`, `Log(8, ~oo) = 0`.
 *
 * `NaN` in either operand propagates. An operand with no known value has
 * no exceptional-point answer, with one generic-point exception: `Log(1, b)`
 * is 0 for a symbolic base — the same convention as `1^x = 1`, where the
 * exceptional base (`b = 1`, giving `0/0`) is not assumed.
 *
 * Returns `undefined` when the ordinary logarithm applies (both operands
 * finite and away from 0 and 1). The answers are exact, so `evaluate()`
 * and `.N()` give the same values: `Log(−∞, b)` is `+∞` for a real base
 * `b > 1` and `−∞` for `0 < b < 1`, as `Log(+∞, b)`.
 */
export function logarithmAtExceptionalPoint(
  ce: Expression['engine'],
  x: Expression,
  base: Expression | undefined
): Expression | undefined {
  // A collection operand threads element-wise; no scalar answer applies
  // (`Log(1, [2, 3])` is `[0, 0]`, not `0`).
  if (isCollectionShaped(x) || (base !== undefined && isCollectionShaped(base)))
    return undefined;
  const natural = base === undefined || isSymbol(base, 'ExponentialE');
  // A float argument or base gives the float `0`, not the exact `0`:
  // `\ln(1.0)` is the float `0`, as `\ln(1.5)` is a float.
  const zero = hasFloatOperand([x, base]) ? asFloat(ce.Zero) : ce.Zero;
  const n = classify(x);
  const d = natural ? undefined : classify(base!);
  if (n === 'nan' || d === 'nan') return ce.NaN;

  // A symbolic argument: nothing to say. A symbolic BASE: only `Log(1, b)`
  // answers (the generic-point 0).
  if (n === undefined) return undefined;
  if (!natural && d === undefined) return n === 'one' ? zero : undefined;

  // The natural logarithm (or the quotient by `ln e = 1`).
  if (natural) {
    if (n === 'zero') return ce.NegativeInfinity;
    if (n === 'one') return zero;
    if (n === 'pos-inf' || n === 'directed-inf') return ce.PositiveInfinity;
    if (n === 'complex-inf') return ce.ComplexInfinity;
    return undefined;
  }

  // `ln base = 0` (base 1): a non-zero numerator over 0 is `~oo`; `0/0` is
  // the indeterminate form (`Indeterminate`, or `NaN` with a float operand,
  // see `indeterminateFormAnswer()`).
  if (d === 'one')
    return n === 'one'
      ? indeterminateFormAnswer(ce, [x, base!])
      : ce.ComplexInfinity;

  // An infinite `ln base` (base 0, ±∞, or ~oo): a finite numerator gives 0,
  // an infinite one the indeterminate form `∞/∞`.
  if (isInfinitePoint(d!))
    return isInfinitePoint(n) ? indeterminateFormAnswer(ce, [x, base!]) : zero;

  // A finite base other than 0 and 1: `ln base` is finite and non-zero.
  if (n === 'finite') return undefined;
  if (n === 'one') return zero;
  if (n === 'complex-inf') return ce.ComplexInfinity;
  const sign = lnBaseSign(base!);
  // `−∞` (`ln 0`) or `+∞` (`ln(+∞)`, `ln(−∞)`) over a real `ln base`: the
  // sign follows the quotient; a complex `ln base` leaves the modulus
  // infinite with no real direction.
  if (sign === 'complex') return ce.ComplexInfinity;
  const positive = (n !== 'zero') === (sign === 'positive');
  return positive ? ce.PositiveInfinity : ce.NegativeInfinity;
}
