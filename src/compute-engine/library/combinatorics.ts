import {
  toBigint,
  toInteger,
  toIntegerOperand,
} from '../boxed-expression/numerics.js';
import type {
  Expression,
  OperandDescriptor,
  SymbolDefinitions,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { typeFact } from '../boxed-expression/operand-descriptor.js';
import { negativeSign, nonNegativeSign } from '../boxed-expression/sgn.js';
import { operandNonFiniteNumber, operandSgn } from './type-handlers.js';
import { apply2, shouldNumericize } from '../boxed-expression/apply.js';
import {
  infinitePoint,
  isNegativeIntegerLiteral,
  isNonPositiveIntegerLiteral,
  isRealLiteral,
} from '../boxed-expression/infinite-point.js';
import {
  gamma,
  bigGamma,
  gammaln,
  estimatedFactorialDigits,
} from '../numerics/special-functions.js';
import { checkDeadline } from '../../common/interruptible.js';
import { kleeneEvery } from '../../common/kleene.js';
import {
  enumerableFromAllSources,
  enumerableFromSource,
} from '../collection-utils.js';
import { innerRun, resolveTextSource } from './collections.js';

/**
 * Above this many decimal digits, an exact combinatorial result (Fibonacci,
 * Binomial, BellNumber, Subfactorial) is impractical to materialize as a
 * bigint — the loops below would grind for a very long time to build a
 * multi-hundred-thousand-digit number nobody can use. Stay symbolic instead
 * (mirrors `MAX_EXACT_POW_DIGITS` in boxed-expression/arithmetic-power.ts).
 * The loops also carry `checkDeadline` calls as a backstop for whatever
 * slips under this threshold on a slow host. See WP-2.11 / EX-14.
 */
const MAX_EXACT_COMBINATORICS_DIGITS = 1_000_000;

/**
 * Largest literal integer second argument for which `Binomial`/`Pochhammer`
 * with a *symbolic* first argument expand to their explicit product form
 * (Wester B13). The expansion has `k` factors, so keep the cap small to avoid
 * churning out large factored polynomials.
 */
const SYMBOLIC_EXPANSION_CAP = 20n;

/** log10(φ): F(n) has ≈ n·log10(φ) decimal digits (φ = golden ratio). */
const LOG10_PHI = Math.log10((1 + Math.sqrt(5)) / 2);

/** Rough estimate of the decimal digit count of Binomial(n, k), via lgamma. */
function estimatedBinomialDigits(n: bigint, k: bigint): number {
  const nf = Number(n);
  const kf = Number(k);
  if (!Number.isFinite(nf) || !Number.isFinite(kf)) return Infinity;
  const logC =
    (gammaln(nf + 1) - gammaln(kf + 1) - gammaln(nf - kf + 1)) / Math.LN10;
  return Number.isFinite(logC) ? logC : Infinity;
}

/**
 * Rough estimate of the decimal digit count of the Bell number B(n), via the
 * leading terms of the de Bruijn asymptotic: ln B(n) ≈ n·ln(n) − n·ln(ln(n)) − n.
 */
function estimatedBellDigits(n: number): number {
  if (!Number.isFinite(n) || n < 0) return Infinity;
  if (n < 3) return 1;
  const lnN = Math.log(n);
  const lnB = n * lnN - n * Math.log(lnN) - n;
  return lnB > 0 ? lnB / Math.LN10 : 1;
}

/**
 * Exact binomial coefficient for bigint n, k.
 *
 * - k < 0 → 0, because `1/Γ(k+1)` vanishes at a pole of `Γ` — UNLESS `Γ(n+1)`
 *   is a pole as well (`n` a negative integer), where the two poles cancel
 *   and the quotient is finite. On that both-negative diagonal the value is
 *   `(-1)^(n-k)·Binomial(-k-1, -n-1)` for n ≥ k (`C(-3,-3) = 1`,
 *   `C(-3,-4) = -3`, `C(-3,-5) = 6`) and 0 for n < k, where `Γ(n-k+1)` puts a
 *   second pole in the denominator (`C(-5,-3) = 0`). Verified against a
 *   high-precision reference over the whole -6..0 square. The `k < 0 → 0`
 *   short cut used to apply "regardless of n", so `Binomial(-3, -3)` answered
 *   0 while `simplify`'s own `C(n, n) → 1` rewrite answered 1.
 * - n ≥ 0 and k > n → 0 (standard convention).
 * - n < 0 and k ≥ 0 → the standard extension via Pascal's rule analytic
 *   continuation: Binomial(n, k) = (-1)^k · Binomial(k-n-1, k), e.g.
 *   Binomial(-2, 3) = (-1)³·Binomial(4, 3) = -4 (matches Mathematica/sympy).
 *
 * Returns `undefined` (stay symbolic) rather than an exact bigint when the
 * result would exceed MAX_EXACT_COMBINATORICS_DIGITS decimal digits — e.g.
 * `Binomial(2e9, 1e9)` has ~6×10⁸ digits, pathological to build.
 */
function binomialBigint(
  n: bigint,
  k: bigint,
  deadline?: number
): bigint | undefined {
  if (k < 0n) {
    // A pole of Γ(k+1) in the denominator, so 0 — unless Γ(n+1) is a pole
    // too and cancels it, and Γ(n−k+1) does not put a second pole back.
    if (n >= 0n || n < k) return 0n;
    const sign = (n - k) % 2n === 0n ? 1n : -1n;
    const inner = binomialBigint(-k - 1n, -n - 1n, deadline);
    return inner === undefined ? undefined : sign * inner;
  }
  if (n < 0n) {
    const sign = k % 2n === 0n ? 1n : -1n;
    const inner = binomialBigint(k - n - 1n, k, deadline);
    return inner === undefined ? undefined : sign * inner;
  }
  if (k > n) return 0n;
  // Use the smaller of k and n-k to minimize the number of iterations.
  const kk = k < n - k ? k : n - k;
  if (kk === 0n) return 1n;
  if (estimatedBinomialDigits(n, kk) > MAX_EXACT_COMBINATORICS_DIGITS)
    return undefined;
  let result = 1n;
  let steps = 0;
  for (let i = 1n; i <= kk; i++) {
    if ((++steps & 0xffff) === 0) checkDeadline(deadline);
    result = (result * (n - kk + i)) / i;
  }
  return result;
}

/**
 * The value of `Binomial(n, k)` = Γ(n+1)/(Γ(k+1)·Γ(n−k+1)) when at least one
 * operand is an infinite point, or `undefined` when both are finite (and for
 * the combinations below whose limit is not established). Each answer is
 * exact, so it is given on `evaluate()` and `.N()` alike. The limits were
 * verified against an independent high-precision computation at |n| or |k| =
 * 10², 10⁴ and 10⁶, and — for the direction-less `~oo` — along the
 * directions `R·e^{iθ}` for θ ∈ {0, π/3, π/2, 2π/3, π}:
 *
 * - A NEGATIVE INTEGER `k` makes `C(n, k)` the zero function: `1/Γ(k+1)` is
 *   `0` at every pole of `Γ`. The value is `0` at every `n`, infinite ones
 *   included.
 * - `C(n, k) ~ n^k/Γ(k+1)` as `n → +∞`, so `C(+∞, k)` is `+∞` for `k > 0`,
 *   `1` for `k = 0` (`C(10⁶, 0) = 1`) and `0` for `k < 0`
 *   (`C(10⁶, −2.5) = 4.2·10⁻¹⁶`).
 * - Towards `−∞` the poles of `Γ(n+1)` at the negative integers get in the
 *   way. For a non-negative INTEGER `k`, `C(n, k)` is the polynomial
 *   `n(n−1)⋯(n−k+1)/k!`, which has no poles: `C(−∞, k)` is `1` for `k = 0`
 *   and `(−1)^k·∞` for `k ≥ 1` (`C(−10⁶, 3) = −1.67·10¹⁷`). For a
 *   NON-INTEGER `k` the value oscillates in sign and modulus between
 *   consecutive poles without settling (`C(−10⁶−0.1, 0.5) = 3473`,
 *   `C(−10⁶−0.5, 0.5) = 0`, `C(−10⁶−0.9, 0.5) = −3473`), so there is no
 *   limit: `NaN`.
 * - `C(~oo, k)`: the polynomial arm again. `1` for `k = 0` and `~oo` for a
 *   positive integer `k` — the modulus diverges in every direction while the
 *   direction itself does not settle. For a non-integer `k` the negative
 *   real axis is again a line of poles, so there is no limit: `NaN`.
 * - `C(n, ±∞)` is decided by the same asymptotic read in `k`:
 *   `|C(n, k)| ~ |Γ(n+1)/π|·|sin(π(n−k+1))|·k^(−n−1)`. For a finite real
 *   `n > −1` the power wins and the value is `0` (`C(0.5, −10⁶) =
 *   2.8·10⁻¹⁰`); for `n ≤ −1` the power diverges while the sine oscillates,
 *   so there is no limit: `NaN` (`C(−2.5, 10⁶) = 7.5·10⁸` against
 *   `C(−2.5, 10⁶+0.5) = 0`).
 * - `C(n, ~oo)`: `NaN`. The modulus wanders between 0 and `+∞` with the
 *   direction (`C(5, 10⁶·e^{i}) = 10¹¹⁴⁸⁰⁴⁸` against
 *   `C(5, −10⁶) = 1.5·10⁻⁴⁴`).
 * - Two infinite operands, or an anonymous infinity such as `∞ + i` in
 *   either slot: `NaN` (the uniform rule of the special-function heads).
 *
 * A finite operand that is not a real literal (a complex number, a symbol)
 * leaves the application symbolic: nothing here is proven for it.
 */
function binomialValueAtInfinity(
  n: Expression,
  k: Expression,
  ce: Expression['engine']
): Expression | undefined {
  const pn = infinitePoint(n);
  const pk = infinitePoint(k);
  if (pn === undefined && pk === undefined) return undefined;
  if (pn === 'anonymous' || pk === 'anonymous') return ce.NaN;

  // The zero function: `C(n, k) = 0` for every negative integer `k`.
  if (pk === undefined && isNegativeIntegerLiteral(k)) return ce.Zero;

  if (pn !== undefined && pk !== undefined) return ce.NaN;

  if (pn !== undefined) {
    // `n` is infinite, `k` is finite.
    if (!isRealLiteral(k)) return undefined;
    if (k.isSame(0)) return ce.One;
    if (pn === '+oo')
      return k.isPositive === true ? ce.PositiveInfinity : ce.Zero;
    // `-oo` and `~oo`: only the polynomial (non-negative integer `k`) arm
    // has a limit; the negative-integer `k` is already answered above.
    if (k.isInteger !== true) return ce.NaN;
    if (pn === '~oo') return ce.ComplexInfinity;
    const ki = toBigint(k);
    if (ki === null) return undefined;
    return ki % 2n === 0n ? ce.PositiveInfinity : ce.NegativeInfinity;
  }

  // `k` is infinite, `n` is finite.
  if (pk === '~oo') return ce.NaN;
  if (!isRealLiteral(n)) return undefined;
  if (n.isGreater(-1) === true) return ce.Zero;
  if (n.isLessEqual(-1) === true) return ce.NaN;
  return undefined;
}

/**
 * The value of `Binomial(n, k)` at a finite real point where one of the three
 * `Γ` factors of `Γ(n+1)/(Γ(k+1)·Γ(n−k+1))` sits on a pole, or `undefined`
 * away from those points. Exact, so given on both routes.
 *
 * A pole in the DENOMINATOR makes the quotient `0`; a pole in the numerator
 * alone makes it the engine's spelling of an unsigned pole, `~oo` (the same
 * answer `Gamma(0)` and `Beta(−1, 2)` give). The naive Γ-ratio kernel
 * answered overflow garbage at all of these (`C(2.5, −2)` was
 * `−2.1·10⁻⁵¹` instead of `0`, `C(−3, 0.5)` was `−8.9·10⁴⁸` instead of
 * `~oo`) or `NaN` (`C(−2.5, −1.5)`, where `n − k + 1 = 0`, is `0`: the
 * limit `C(−2.5, −1.5±ε)` crosses zero, ±0.0067 at ε = 0.01).
 *
 * Only reached when `n` and `k` are not both integers — that case has its own
 * exact bigint route (`binomialBigint`), which is where a pole in the
 * numerator meets one in the denominator and the finite ratio decides.
 */
function binomialPoleValue(
  n: Expression,
  k: Expression,
  ce: Expression['engine']
): Expression | undefined {
  if (!isRealLiteral(n) || !isRealLiteral(k)) return undefined;
  // A negative-integer `n` AND a negative-integer `k` put a pole on both
  // sides of the quotient; the finite ratio is the exact bigint route's, so
  // decline rather than answer either pole's naive value.
  if (isNegativeIntegerLiteral(n) && isNegativeIntegerLiteral(k))
    return undefined;
  // `Γ(k+1)` on a pole: `k` a negative integer, with nothing to cancel it.
  if (isNegativeIntegerLiteral(k)) return ce.Zero;
  // `Γ(n−k+1)` on a pole: `n − k` a negative integer.
  const nk = ce.function('Subtract', [n, k]).evaluate();
  if (isNegativeIntegerLiteral(nk)) return ce.Zero;
  // `Γ(n+1)` on a pole and neither denominator factor on one.
  if (isNegativeIntegerLiteral(n)) return ce.ComplexInfinity;
  return undefined;
}

/**
 * Shared evaluate logic for `Binomial` and `Choose` — the two names must
 * agree everywhere both are defined, so both handlers delegate here.
 *
 * - Exact integers (any sign of n): exact bigint result (see
 *   `binomialBigint`), regardless of `numericApproximation`.
 * - Exact non-integers (rationals, radicals, symbolic constants like π):
 *   no closed form, so stay symbolic under plain `evaluate()`; under `.N()`
 *   numericize via the Gamma form Γ(n+1)/(Γ(k+1)·Γ(n−k+1)).
 * - Inexact (float) operands numericize under both `evaluate()` and `.N()`,
 *   per the exactness contract (an inexact argument always numericizes).
 * - Complex or non-numeric (symbolic) operands: stay symbolic (no closed
 *   form implemented for complex args; symbolic args can't be evaluated).
 */
/**
 * Result type shared by `Binomial` and `Choose` (they share
 * `evaluateBinomial` and must agree). Integer n, k → an integer (also for
 * negative n, via the falling factorial). Real arguments go through the Γ
 * ratio: finite real unless the numerator Γ(n+1) sits on a pole (negative
 * integer n with a non-integer k) — there, and for non-finite or non-real
 * arguments, nothing narrower than `number` is sound (`Binomial(∞, 2)` is
 * NaN).
 */
// The `negativeSign` read below widens the claim to `number` on the Γ pole
// (negative integer `n`, non-integer `k`). On a compound operand that
// negative sign is an operator `sgn` handler's to prove (`Sign(p)`, a
// `Divide` whose sign recurses through its operands), and the descriptor's
// sign fact carries it (open item O7 of
// `docs/plans/2026-08-22-type-handlers-on-types.md`).
function binomialType(
  n: OperandDescriptor | undefined,
  k: OperandDescriptor | undefined
): Type | undefined {
  // A provably-NaN operand DECLINES: a handler answer is never widened, so
  // answering `number` here would suppress any sharper claim the framework
  // can derive. (What that buys today is recorded on `specialFunctionType`
  // in `library/arithmetic.ts`: for a head whose declared result is the wide
  // `number`, the derived claim stays `number`.)
  if (
    (n && typeFact(n.type, 'nan') === true) ||
    (k && typeFact(k.type, 'nan') === true)
  )
    return undefined;
  if (!n || !k) return 'number';
  if (operandNonFiniteNumber(n) || operandNonFiniteNumber(k)) return 'number';
  if (
    typeFact(n.type, 'integer') === true &&
    typeFact(k.type, 'integer') === true
  )
    return 'integer';
  if (typeFact(n.type, 'real') === true && typeFact(k.type, 'real') === true) {
    if (
      typeFact(n.type, 'integer') === true &&
      negativeSign(operandSgn(n)) === true
    )
      return 'number';
    return 'real';
  }
  return 'number';
}

function evaluateBinomial(
  nExpr: Expression,
  kExpr: Expression,
  numericApproximation: boolean | undefined,
  ce: Expression['engine']
): Expression | undefined {
  // The infinite points are exact, so they are answered on both routes and
  // BEFORE any numeric kernel sees an `Infinity` argument.
  const infinite = binomialValueAtInfinity(nExpr, kExpr, ce);
  if (infinite !== undefined) return infinite;

  // Exact integers: exact bigint arithmetic (handles negative n).
  if (
    isNumber(nExpr) &&
    isNumber(kExpr) &&
    nExpr.im === 0 &&
    kExpr.im === 0 &&
    nExpr.isInteger &&
    kExpr.isInteger
  ) {
    const n = toBigint(nExpr);
    const k = toBigint(kExpr);
    if (n !== null && k !== null) {
      const r = binomialBigint(n, k, ce._deadline);
      return r === undefined ? undefined : ce.number(r);
    }
  }

  // Complex operands: no closed form implemented here; stay symbolic.
  if (
    (isNumber(nExpr) && nExpr.im !== 0) ||
    (isNumber(kExpr) && kExpr.im !== 0)
  )
    return undefined;

  // A Γ factor on a pole. Exact, so answered on both routes, and before the
  // kernel — the Γ-ratio overflows to garbage there.
  const pole = binomialPoleValue(nExpr, kExpr, ce);
  if (pole !== undefined) return pole;

  // Inexact (float) operands numericize even under plain evaluate(); exact
  // non-integer operands (rationals, radicals, π, ...) only numericize
  // under .N() — and otherwise stay symbolic (no closed form).
  const inexact =
    (isNumber(nExpr) && !nExpr.isExact) || (isNumber(kExpr) && !kExpr.isExact);
  if (numericApproximation || inexact) {
    return apply2(
      nExpr,
      kExpr,
      (n, k) => gamma(n + 1) / (gamma(k + 1) * gamma(n - k + 1)),
      (n, k) =>
        bigGamma(ce, n.add(1)).div(
          bigGamma(ce, k.add(1)).mul(bigGamma(ce, n.sub(k).add(1)))
        )
    );
  }

  // Symbolic first argument with a small nonnegative integer second argument:
  // expand to the explicit falling-factorial form n(n-1)…(n-k+1)/k! (Wester
  // B13). This is an exact closed form. It is built non-canonically so the
  // factored structure survives serialization — canonicalizing it would fold
  // the 1/k! into a leading rational coefficient and, on evaluation, distribute
  // into an expanded polynomial.
  if (
    !isNumber(nExpr) &&
    isNumber(kExpr) &&
    kExpr.im === 0 &&
    kExpr.isInteger
  ) {
    const k = toBigint(kExpr);
    if (k !== null && k >= 0n && k <= SYMBOLIC_EXPANSION_CAP) {
      const kn = Number(k);
      if (kn === 0) return ce.One;
      if (kn === 1) return nExpr;
      const factors: Expression[] = [nExpr];
      for (let i = 1; i < kn; i++)
        factors.push(
          ce.function('Subtract', [nExpr, ce.number(i)], { form: 'structural' })
        );
      let fact = 1n;
      for (let i = 2n; i <= k; i++) fact *= i;
      return ce.function(
        'Divide',
        [
          ce.function('Multiply', factors, { form: 'structural' }),
          ce.number(fact),
        ],
        { form: 'structural' }
      );
    }
  }

  return undefined;
}

/**
 * The sign of `Γ(a)` for a NEGATIVE, NON-INTEGER real literal `a`: `Γ` is
 * negative on `(−1, 0)` and alternates across every pole, so the sign is
 * `−1` when `⌊−a⌋` is even and `+1` when it is odd (`Γ(−0.5) = −3.54`,
 * `Γ(−1.5) = +2.36`, `Γ(−2.5) = −0.95`, `Γ(−3.5) = +0.27`). The parity is
 * read through `Floor` on the engine so a magnitude beyond the double range
 * is still decided correctly. Returns `undefined` when the parity cannot be
 * settled.
 */
function negativeGammaSign(
  a: Expression,
  ce: Expression['engine']
): 1 | -1 | undefined {
  const f = ce.function('Floor', [ce.function('Negate', [a])]).evaluate();
  if (f.isEven === true) return -1;
  if (f.isOdd === true) return 1;
  return undefined;
}

/**
 * The value of `Pochhammer(a, k)` = Γ(a+k)/Γ(a) when at least one operand is
 * an infinite point, or `undefined` when both are finite (and where the limit
 * is not established). Exact, so given on `evaluate()` and `.N()` alike.
 * Every limit was verified against an independent high-precision computation
 * at 10², 10⁴ and 10⁶, and at three offsets between consecutive poles when
 * the approach is along the negative axis:
 *
 * - `(a)_k ~ a^k` as `|a| → ∞`, so `(+∞)_k` is `+∞` for `k > 0`, `1` for
 *   `k = 0` and `0` for `k < 0` (`(10⁶)_{−2.5} = 10⁻¹⁵`).
 * - `(−∞)_k` and `(~oo)_k` are decided by the polynomial arm: `1` for
 *   `k = 0`, `(−1)^k·∞` (respectively `~oo`) for a positive integer `k`
 *   (`(−10⁶−½)_3 = −10¹⁸`), and `0` for a negative integer `k` — there
 *   `(a)_k = 1/((a−1)⋯(a+k))`, which has no pole for large `|a|`
 *   (`(−10⁶−½)_{−2} = 10⁻¹²`). For a NON-INTEGER `k` the poles of `Γ(a+k)`
 *   sit between the zeros of `1/Γ(a)`, so the value alternates between `0`
 *   and an infinite value without settling: `NaN` (`(−10⁶−¼)_{0.5} = −1000`,
 *   `(−10⁶−½)_{0.5} = ∞`, `(−10⁶−¾)_{0.5} = +1000`).
 * - `(a)_{+∞}`: `0` when `a` is a non-positive integer (`1/Γ(a) = 0`), and
 *   otherwise `sign(Γ(a))·∞` — `+∞` for `a > 0`, and the alternating sign of
 *   `Γ` below zero (`(−2.5)_{10⁶}` is negative, `Γ(−2.5) = −0.95`).
 * - `(a)_{−∞}`: `0` when `a` is a non-positive integer, `NaN` otherwise.
 *   `Γ(a+k)` has a pole at every `k` with `a + k` a non-positive integer, so
 *   for any other `a` the value is unbounded arbitrarily far out
 *   (`(0.5)_{−10⁶} = 2·10⁻⁵⁵⁶⁵⁷⁰⁶` but `(0.5)_{−10⁶−½} = ∞`); the poles are
 *   cancelled by the pole of `Γ(a)` exactly when `a` is a non-positive
 *   integer.
 * - `(a)_{~oo}`: `NaN`. `|Γ(a+k)|` decays like `e^{−π|Im k|/2}` in the
 *   imaginary direction and diverges along the positive real axis, so the
 *   modulus has no limit.
 * - Two infinite operands, or an anonymous infinity such as `∞ + i` in
 *   either slot: `NaN`.
 */
function pochhammerValueAtInfinity(
  a: Expression,
  k: Expression,
  ce: Expression['engine']
): Expression | undefined {
  const pa = infinitePoint(a);
  const pk = infinitePoint(k);
  if (pa === undefined && pk === undefined) return undefined;
  if (pa === 'anonymous' || pk === 'anonymous') return ce.NaN;
  if (pa !== undefined && pk !== undefined) return ce.NaN;

  if (pa !== undefined) {
    // `a` is infinite, `k` is finite.
    if (!isRealLiteral(k)) return undefined;
    if (k.isSame(0)) return ce.One;
    if (pa === '+oo')
      return k.isPositive === true ? ce.PositiveInfinity : ce.Zero;
    if (k.isInteger !== true) return ce.NaN;
    if (k.isNegative === true) return ce.Zero;
    if (pa === '~oo') return ce.ComplexInfinity;
    const ki = toBigint(k);
    if (ki === null) return undefined;
    return ki % 2n === 0n ? ce.PositiveInfinity : ce.NegativeInfinity;
  }

  // `k` is infinite, `a` is finite.
  if (pk === '~oo') return ce.NaN;
  if (!isRealLiteral(a)) return undefined;
  if (isNonPositiveIntegerLiteral(a)) return ce.Zero;
  if (pk === '-oo') return ce.NaN;
  if (a.isPositive === true) return ce.PositiveInfinity;
  const sign = negativeGammaSign(a, ce);
  if (sign === undefined) return undefined;
  return sign > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
}

/**
 * Evaluate `Pochhammer(a, k)` — the rising factorial (a)_k = Γ(a+k)/Γ(a).
 *
 * - The infinite points are `pochhammerValueAtInfinity`'s, answered on both
 *   routes before any kernel sees an `Infinity` argument.
 * - A small integer `k` (Wester B13): the explicit finite product. For
 *   `k ≥ 0` that is the rising factorial `a(a+1)…(a+k-1)`; for `k < 0` it is
 *   the reciprocal falling form `1/((a−1)(a−2)…(a+k))`, so `(3)_{−2} = 1/2`.
 *   Both hold for a symbolic `a`, where the product is kept non-canonical so
 *   the factored structure survives serialization.
 * - Numeric `a`: fold to the numeric value (exact for integer/rational `a`,
 *   float for an inexact `a`).
 * - Otherwise the Γ ratio: a real `a` and a real `k` numericize under `.N()`
 *   (and under plain `evaluate()` when either is inexact). A `Γ` factor on a
 *   pole is answered exactly first — `1/Γ(a) = 0` where `a` is a non-positive
 *   integer, and `Γ(a+k)` on a pole makes the value the unsigned `~oo`.
 * - A complex `a` with a non-integer or large `k`, and a symbolic operand,
 *   stay symbolic: there is no complex kernel here.
 */
function evaluatePochhammer(
  aExpr: Expression,
  kExpr: Expression,
  ce: Expression['engine'],
  numericApproximation: boolean | undefined
): Expression | undefined {
  const infinite = pochhammerValueAtInfinity(aExpr, kExpr, ce);
  if (infinite !== undefined) return infinite;

  const k =
    isNumber(kExpr) && kExpr.im === 0 && kExpr.isInteger === true
      ? toBigint(kExpr)
      : null;
  if (k !== null && k >= -SYMBOLIC_EXPANSION_CAP && k <= SYMBOLIC_EXPANSION_CAP)
    return pochhammerProduct(aExpr, Number(k), ce);

  // The Γ ratio. Only real operands: `apply2` has no complex kernel here.
  if (!isRealLiteral(aExpr) || !isRealLiteral(kExpr)) return undefined;
  const aPole = isNonPositiveIntegerLiteral(aExpr);
  const sPole = isNonPositiveIntegerLiteral(
    ce.function('Add', [aExpr, kExpr]).evaluate()
  );
  // Both on a pole: `k` is then an integer past the expansion cap, and the
  // finite ratio of the two poles is what decides — a value this handler does
  // not build. Stay symbolic rather than let the kernel answer `NaN/NaN`.
  if (aPole && sPole) return undefined;
  if (aPole) return ce.Zero;
  if (sPole) return ce.ComplexInfinity;
  if (!shouldNumericize(numericApproximation, aExpr, kExpr)) return undefined;
  return apply2(
    aExpr,
    kExpr,
    (a, k) => gamma(a + k) / gamma(a),
    (a, k) => bigGamma(ce, a.add(k)).div(bigGamma(ce, a))
  );
}

/**
 * `Pochhammer(a, k)` as an explicit product of `|k|` factors, for a literal
 * integer `k` inside `SYMBOLIC_EXPANSION_CAP`.
 *
 * The terms are built with `ce.function('Add', …)` rather than the `.add()`
 * METHOD: the method folds two exact literals to a machine float, so an exact
 * irrational `a` lost its exactness on the first term (`(√2)_2` →
 * 3.41421356… instead of `2 + √2`). For a numeric `a` the product is
 * evaluated (floats are excluded from canonical folding, so it must be
 * evaluated rather than merely constructed) and the trailing `.evaluate()`
 * still folds a float argument to a float, so both halves of the exact/`.N()`
 * contract hold. For a symbolic `a` the product is left non-canonical.
 */
function pochhammerProduct(
  aExpr: Expression,
  kn: number,
  ce: Expression['engine']
): Expression | undefined {
  if (kn === 0) return ce.One;
  if (kn === 1) return aExpr;
  const numeric = isNumber(aExpr);

  // (a)_k = a(a+1)…(a+k−1) for k > 0; (a)_k = 1/((a−1)(a−2)…(a+k)) for k < 0.
  const offsets: number[] = [];
  if (kn > 0) for (let i = 0; i < kn; i++) offsets.push(i);
  else for (let i = 1; i <= -kn; i++) offsets.push(-i);

  const form = numeric ? undefined : ({ form: 'structural' } as const);
  const factors = offsets.map((i) =>
    i === 0 ? aExpr : ce.function('Add', [aExpr, ce.number(i)], form)
  );
  const product = ce.function('Multiply', factors, form);
  if (kn > 0) return numeric ? product.evaluate() : product;
  const reciprocal = ce.function('Divide', [ce.One, product], form);
  return numeric ? reciprocal.evaluate() : reciprocal;
}

export const COMBINATORICS_LIBRARY: SymbolDefinitions[] = [
  {
    Choose: {
      description:
        'Binomial coefficient: number of ways to choose k items from n. Agrees with Binomial for all defined values.',
      complexity: 1200,
      // The same carrier as `Binomial`: the two names share `evaluateBinomial`
      // and are documented to agree, so they must also admit the same
      // operands and infer the same type for a fresh symbol. See `Binomial`
      // for what the carrier and the explicit `nanBehavior` say.
      signature: '(n:complex | infinity, m:complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: ([n, k]) => binomialType(n, k),

      evaluate: ([n, k], { numericApproximation, engine: ce }) =>
        evaluateBinomial(n, k, numericApproximation, ce),
    },
  },

  {
    Fibonacci: {
      description: 'Compute the nth Fibonacci number.',
      wikidata: 'Q47577',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;

        // Compute F(|k|); negative indices use the reflection formula below.
        const m = k < 0n ? -k : k;

        // F(m) has ~m·log10(φ) digits: for huge m (e.g. Fibonacci(1e9), a
        // ~2×10⁸-digit result) the loop below would grind for a very long
        // time to build an unusable number — stay symbolic instead.
        if (Number(m) * LOG10_PHI > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;

        let result: bigint;
        if (m === 0n) result = 0n;
        else if (m === 1n) result = 1n;
        else {
          let a = 0n;
          let b = 1n;
          let steps = 0;
          for (let i = 2n; i <= m; i++) {
            if ((++steps & 0xffff) === 0) checkDeadline(ce._deadlineFrame);
            const next = a + b;
            a = b;
            b = next;
          }
          result = b;
        }

        // Reflection formula: F(−m) = (−1)^{m+1} F(m). The previous code built
        // a malformed `Negate(Fibonacci, m)` (two operands) → an Error.
        if (k < 0n && m % 2n === 0n) result = -result;
        return ce.number(result);
      },
    },

    Binomial: {
      description:
        'Compute the binomial coefficient C(n, k) = n! / (k! (n-k)!). Agrees with Choose for all defined values.',
      keywords: ['choose', 'nCr', 'combination'],
      wikidata: 'Q209875',
      // Was `(integer, integer) -> integer`: too strict — it turned any
      // non-integer (rational, radical, symbolic n/k inferred as `number`)
      // into an Error() at canonicalization time, before `evaluate` ever
      // ran. Binomial is well-defined (via Gamma) for real n, k.
      //
      // Both slots now take the Γ-family carrier: every finite complex point
      // has a value (a Γ-pole, `~oo`, where `Γ(n+1)` is one and nothing
      // cancels it), and every infinity is in the carrier with the values
      // `binomialValueAtInfinity` gives, so a point with no limit answers
      // `NaN` rather than a boxing error. `NaN` propagates — stated
      // explicitly because the carrier is not a subtype of `complex`, so the
      // policy derived from the signature alone would be `reject`. The
      // declared result stays the wide `number`: the handler carries the
      // per-call sharpness. There is no `canonical` handler, so a proven
      // off-carrier operand is rejected at BOXING; with every numeric point
      // in the carrier, that seam only ever sees a non-number.
      signature: '(complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: ([n, k]) => binomialType(n, k),
      evaluate: ([n, k], { numericApproximation, engine: ce }) =>
        evaluateBinomial(n, k, numericApproximation, ce),
    },
    Pochhammer: {
      description:
        'Rising factorial (Pochhammer symbol) (a)_k = a(a+1)…(a+k-1).',
      wikidata: 'Q2367490',
      // Both slots take the Γ-family carrier, as `Binomial` does: every
      // finite complex point has a value (the poles of `Γ(a)` and `Γ(a+k)`
      // included) and every infinity is in the carrier with the values
      // `pochhammerValueAtInfinity` gives, so a point with no limit answers
      // `NaN` rather than a boxing error. `NaN` propagates (explicit: the
      // carrier is not a subtype of `complex`).
      signature: '(complex | infinity, complex | infinity) -> number',
      nanBehavior: 'propagate',
      // (a)_k with a provably non-negative integer k is a finite product of
      // k terms: integer for integer a, real for real a. Any other k reaches
      // the Γ-ratio continuation, which can hit poles (→ `~oo`) or complex
      // values. The `nonNegativeSign` gate can be proven by an operator
      // `sgn` handler on a compound operand — a proof the descriptor's sign
      // fact carries (open item O7 of
      // `docs/plans/2026-08-22-type-handlers-on-types.md`).
      type: ([a, k]) => {
        // A provably-NaN operand declines, as `binomialType` does and for the
        // same reason: a handler answer is never widened.
        if (
          (a && typeFact(a.type, 'nan') === true) ||
          (k && typeFact(k.type, 'nan') === true)
        )
          return undefined;
        if (!a || !k) return 'number';
        if (operandNonFiniteNumber(a) || operandNonFiniteNumber(k))
          return 'number';
        if (
          typeFact(k.type, 'integer') === true &&
          nonNegativeSign(operandSgn(k)) === true
        ) {
          if (typeFact(a.type, 'integer') === true) return 'integer';
          if (typeFact(a.type, 'rational') === true) return 'rational';
          if (typeFact(a.type, 'real') === true) return 'real';
        }
        return 'number';
      },
      evaluate: ([a, k], { numericApproximation, engine: ce }) =>
        evaluatePochhammer(a, k, ce, numericApproximation),
    },
    CartesianProduct: {
      description: 'Return the Cartesian product of input sets.',
      // Aka the product set, the set direct product or cross product
      // Notation: \times
      wikidata: 'Q173740',
      signature: '(set<any>+) -> set',
      collection: {
        isEnumerable: enumerableFromAllSources,
        contains: (expr, x) => {
          if (!isFunction(expr)) return false;
          const factors = expr.ops;
          if (
            !x.isCollection ||
            !isFunction(x) ||
            x.ops.length !== factors.length
          )
            return false;
          const xOps = x.ops;
          // Three-valued: a factor that cannot decide its component leaves the
          // tuple's membership undecided (`?? false` inside `every()` claimed a
          // definite "not a member" no factor had given).
          return kleeneEvery(factors, (factor, i) => factor.contains(xOps[i]));
        },
        count: (expr) => {
          if (!isFunction(expr)) return 0;
          const sizes = expr.ops.map((op) => op.count);
          if (sizes.includes(Infinity)) return Infinity;
          return sizes.reduce((a, b) => a! * b!, 1);
        },
        iterator: cartesianProductIterator,
      },
    },

    PowerSet: {
      description: 'Return the power set of a set (set of all subsets).',
      wikidata: 'Q205170',
      signature: '(set<any>) -> set',
      collection: {
        isEnumerable: enumerableFromSource,
        contains: (expr, x) => {
          if (!isFunction(expr)) return false;
          const base = expr.ops[0];
          if (!x.isCollection || !isFunction(x)) return false;
          // Three-valued: a candidate element the base set cannot judge leaves
          // the subset relation — and so the membership — undecided.
          return kleeneEvery(x.ops, (elem) => base.contains(elem));
        },
        count: (expr) => {
          if (!isFunction(expr)) return 0;
          const xs = expr.ops[0];
          if (xs.isEmptyCollection) return 1; // Power set of empty set is {{}}
          if (xs.isFiniteCollection === false) return Infinity;
          return 2 ** xs.count!;
        },
        iterator: powerSetIterator,
      },
    },

    Permutations: {
      description:
        'Return all permutations of length k (default full length) of a collection.',
      keywords: ['nPr'],
      // The LEADING arm is the string rule: an arrangement of a string's own
      // characters is itself a string, so `Permutations("ab")` is
      // `["ab","ba"]` rather than `[["a","b"],["b","a"]]` (ruling D9(b),
      // 2026-08-16; see `innerRun` in `library/collections.ts`). Spelled as a
      // BOUNDED type variable (`S where S: string`), never the ground type
      // `string`: an `unknown`- or `any`-typed operand refutes no arm, so a
      // ground `string` parameter would win most-specific-wins on every
      // untyped operand.
      signature:
        '((S, integer?) -> list<string> where S: string) & ((collection, integer?) -> list<list>)',
      // A lazy indexed collection (like `CartesianProduct`/`PowerSet`): the
      // result has `P(n, k)` elements — factorially many — so it is NEVER
      // materialized up front. `.count` is the closed form `n·(n-1)···(n-k+1)`
      // (no walk); elements stream from `iterator`, and `at(i)` yields only the
      // first `i` ARRANGEMENTS (after reading the — typically small — base
      // collection once). Binding an unread `Permutations` is O(1).
      collection: {
        isEnumerable: enumerableFromSource,
        isLazy: () => true,
        count: (expr) => permutationsCount(expr),
        isEmpty: (expr) => {
          const c = permutationsCount(expr);
          return c === undefined ? undefined : c === 0;
        },
        // Finiteness comes from the BASE collection, not `count`: a permutation
        // of a finite collection is finite even when the count is so large it
        // rounds to `Infinity` as a JS number. `k = 0` is the lone exception —
        // the single empty arrangement is finite even over an infinite base.
        // An infinite base with `k > 0` can't be enumerated, so report
        // `undefined` (unknown) rather than `false` — which would advertise an
        // infinite collection that yields nothing.
        isFinite: (expr) => {
          if (!isFunction(expr)) return undefined;
          const k = expr.ops[1]
            ? toIntegerOperand(expr.ops[1])
            : expr.op1.count;
          if (k === 0) return true;
          const f = expr.op1.isFiniteCollection;
          return f === false ? undefined : f;
        },
        iterator: permutationsIterator,
        at: (expr, index) =>
          nthFromIterator(expr, index, permutationsIterator, permutationsCount),
      },
    },

    Combinations: {
      description: 'Return all k-element combinations of a collection.',
      wikidata: 'Q193606',
      // The LEADING arm is the string rule: a combination of a string's own
      // characters is itself a string, so `Combinations("abc", 2)` is
      // `["ab","ac","bc"]` (ruling D9(b), 2026-08-16; see `innerRun` in
      // `library/collections.ts`). Spelled as a BOUNDED type variable (`S
      // where S: string`), never the ground type `string`: an `unknown`- or
      // `any`-typed operand refutes no arm, so a ground `string` parameter
      // would win most-specific-wins on every untyped operand.
      signature:
        '((S, integer) -> list<string> where S: string) & ((collection, integer) -> list<list>)',
      // Lazy indexed collection: `C(n, k)` elements, never materialized up
      // front. `.count` is the closed form `P(n, k) / k!`; elements stream from
      // `iterator`, and `at(i)` yields only the first `i` combinations (after
      // reading the — typically small — base collection once).
      collection: {
        isEnumerable: enumerableFromSource,
        isLazy: () => true,
        count: (expr) => combinationsCount(expr),
        isEmpty: (expr) => {
          const c = combinationsCount(expr);
          return c === undefined ? undefined : c === 0;
        },
        // Finiteness comes from the BASE collection, not `count` (see
        // `Permutations`); `k = 0` is finite even over an infinite base, and an
        // infinite base with `k > 0` is `undefined` (unenumerable), not `false`.
        isFinite: (expr) => {
          if (!isFunction(expr)) return undefined;
          const k = expr.ops[1]
            ? toIntegerOperand(expr.ops[1])
            : expr.op1.count;
          if (k === 0) return true;
          const f = expr.op1.isFiniteCollection;
          return f === false ? undefined : f;
        },
        iterator: combinationsIterator,
        at: (expr, index) =>
          nthFromIterator(expr, index, combinationsIterator, combinationsCount),
      },
    },

    Multinomial: {
      description: 'Compute the multinomial coefficient for multiple integers.',
      wikidata: 'Q20820114',
      signature: '(integer+) -> integer',
      evaluate: (ops, { engine: ce }) => {
        const ks = ops.map(toInteger);
        if (ks.some((k) => k === null || k < 0)) return undefined;
        const n = ks.reduce((a, b) => a! + (b ?? 0), 0)!;

        // n! dwarfs the individual k! factors, so its digit count bounds the
        // whole computation — stay symbolic rather than grind through an
        // unusably large exact factorial (same class of issue as
        // Subfactorial/Fibonacci/BellNumber, see WP-2.11 / EX-14).
        if (estimatedFactorialDigits(n) > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;

        // Use exact bigint arithmetic — the float version overflowed past
        // n ≈ 170 and lost precision (`Multinomial(20,20)` → …820.00003).
        // n! / (k1! · k2! · …) is always an integer, so the divisions are exact.
        const factorial = (m: number): bigint => {
          let r = 1n;
          let steps = 0;
          for (let i = 2n; i <= BigInt(m); i++) {
            if ((++steps & 0xffff) === 0) checkDeadline(ce._deadlineFrame);
            r *= i;
          }
          return r;
        };
        let result = factorial(n);
        for (const k of ks) result /= factorial(k!);
        return ce.number(result);
      },
    },

    Subfactorial: {
      description:
        'Compute the number of derangements (subfactorial) of n items.',
      wikidata: 'Q2361661',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        // Derangements are defined only for non-negative integers; stay
        // symbolic for anything else rather than rounding the argument.
        if (n.isInteger !== true) return undefined;
        const k = toInteger(n);
        if (k === null || k < 0) return undefined;
        // !n has the same order of magnitude as n! (!n = round(n!/e)): for
        // huge n (e.g. Subfactorial(1e6), a ~5.6×10⁶-digit result) the loop
        // below would grind for a very long time — stay symbolic instead.
        if (estimatedFactorialDigits(k) > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;
        // Recurrence (exact, in bigint): !0 = 1, !m = m·!(m−1) + (−1)^m.
        // The previous float formula reduced to result·(i−1), which is 0 at
        // i = 1 and pinned every !n≥1 to 0.
        let result = 1n;
        let sign = 1n;
        let steps = 0;
        for (let i = 1; i <= k; i++) {
          if ((++steps & 0xffff) === 0) checkDeadline(ce._deadlineFrame);
          sign = -sign;
          result = BigInt(i) * result + sign;
        }
        return ce.number(result);
      },
    },

    BellNumber: {
      description:
        'Compute the Bell number B(n), the number of partitions of a set of n elements.',
      wikidata: 'Q816063',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        // Bell numbers count set partitions, defined only for non-negative
        // integers; stay symbolic rather than rounding the argument.
        if (n.isInteger !== true) return undefined;
        const k = toInteger(n);
        if (k === null || k < 0) return undefined;

        // B(n) grows faster than exponentially (ln B(n) ≈ n·ln(n) −
        // n·ln(ln(n)) − n, de Bruijn): for huge n (e.g. BellNumber(20000)
        // already has ~57000 digits, and the O(n²) triangle cost grows much
        // faster still) stay symbolic rather than grind. The `checkDeadline`
        // below is the primary guard in the range this estimate misses.
        if (estimatedBellDigits(k) > MAX_EXACT_COMBINATORICS_DIGITS)
          return undefined;

        // Bell triangle (Aitken's array) in exact bigint — the float
        // recurrence lost precision past n ≈ 25 (`BellNumber(25)` was
        // …9000 instead of …9353). B(n) is the first entry of row n.
        let row: bigint[] = [1n];
        let steps = 0;
        for (let i = 1; i <= k; i++) {
          const next: bigint[] = [row[row.length - 1]];
          for (let j = 0; j < row.length; j++) {
            if ((++steps & 0xffff) === 0) checkDeadline(ce._deadlineFrame);
            next.push(next[j] + row[j]);
          }
          row = next;
        }
        return ce.number(row[0]);
      },
    },
  },
];

function* cartesianProductIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const factors = expr.ops;
  const iterators = factors.map((f) => [...f.each()] as Expression[]);
  const lengths = iterators.map((it) => it.length);
  if (lengths.some((len) => len === 0)) return;

  const indices = Array(factors.length).fill(0);
  while (true) {
    const tuple = indices.map((i, j) => iterators[j][i]);
    yield expr.engine._fn('Tuple', tuple);

    // Increment indices
    let j = indices.length - 1;
    while (j >= 0) {
      indices[j]++;
      if (indices[j] < lengths[j]) break;
      indices[j] = 0;
      j--;
    }
    if (j < 0) break;
  }
}

function* powerSetIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  const elements = [...expr.ops[0].each()] as Expression[];
  const n = elements.length;
  const ce = expr.engine;

  const total = 1 << n; // 2ⁿ subsets
  for (let mask = 0; mask < total; mask++) {
    const subset: Expression[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) {
        subset.push(elements[i]);
      }
    }
    yield subset.length === 0 ? ce.symbol('EmptySet') : ce._fn('Set', subset);
  }
}

// NOTE on precision: `count` returns a JS `number`, so values past 2^53 are not
// exact and values past ~1.8e308 round to `Infinity` — the same ceiling every
// collection `count` handler has (cf. `PowerSet`'s `2 ** n`). The products below
// are accumulated in `bigint` so everything that DOES fit is exact and there is
// no float rounding; only the final `Number(...)` conversion is lossy. The
// `isFinite` handlers report finiteness from the BASE collection, not from
// `count`, so a finite-but-huge result that rounds to `Infinity` is never
// mistaken for an infinite collection.

// Once a running count exceeds the largest finite JS number, `Number(...)` can
// only ever yield `Infinity`, so the products below stop early at this bigint
// threshold rather than grinding through (potentially billions of) remaining
// terms for an astronomically large — but finite — collection.
const MAX_FINITE_COUNT = BigInt(Number.MAX_VALUE);

/**
 * The number of length-`k` permutations of an `n`-element collection,
 * `P(n, k) = n·(n-1)···(n-k+1)`, WITHOUT enumerating them. `k` defaults to the
 * collection size. Returns `1` for `k = 0` (the empty arrangement); `undefined`
 * when the size is unknown, `k` is out of range, or the base is infinite with
 * `k > 0` (which the iterator cannot enumerate); `Infinity` only when a finite
 * base's count exceeds the largest finite JS number.
 */
function permutationsCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const n = expr.op1.count;
  if (n === undefined) return undefined;
  const kExpr = expr.ops[1];
  const k = kExpr ? toIntegerOperand(kExpr) : n;
  // Validate `k` BEFORE the infinite short-circuit: an out-of-range `k` is an
  // invalid expression, not an infinite collection.
  if (k === null || k < 0 || (Number.isFinite(n) && k > n)) return undefined;
  if (k === 0) return 1; // P(n, 0) = 1
  // A valid `k > 0` over an infinite base has infinitely many arrangements, but
  // the iterator can't enumerate them (it can't materialize the source): report
  // `undefined` (unsupported) rather than a count no consumer can back up.
  if (!Number.isFinite(n)) return undefined;
  let p = 1n;
  const bn = BigInt(n);
  for (let j = 0n; j < BigInt(k); j++) {
    p *= bn - j;
    if (p > MAX_FINITE_COUNT) return Infinity;
  }
  return Number(p);
}

/**
 * The number of `k`-element combinations of an `n`-element collection,
 * `C(n, k) = P(n, k) / k!`, WITHOUT enumerating them. Returns `1` for `k = 0`;
 * `undefined` when the size is unknown, `k` is out of range, or the base is
 * infinite with `k > 0`; `Infinity` only when a finite base's count exceeds the
 * largest finite JS number.
 */
function combinationsCount(expr: Expression): number | undefined {
  if (!isFunction(expr)) return undefined;
  const n = expr.op1.count;
  if (n === undefined) return undefined;
  const k = toIntegerOperand(expr.ops[1]);
  if (k === null || k < 0 || (Number.isFinite(n) && k > n)) return undefined;
  if (k === 0) return 1; // C(n, 0) = 1
  if (!Number.isFinite(n)) return undefined; // see `permutationsCount`
  // Symmetry C(n,k) = C(n,n-k) keeps the running product smallest. Each step
  // `c·(n-j)/(j+1)` is an exact integer division because the product of `j+1`
  // consecutive integers is divisible by `(j+1)!`.
  const bn = BigInt(n);
  const kk = BigInt(Math.min(k, n - k));
  let c = 1n;
  for (let j = 0n; j < kk; j++) {
    c = (c * (bn - j)) / (j + 1n);
    if (c > MAX_FINITE_COUNT) return Infinity;
  }
  return Number(c);
}

/** Stream the length-`k` permutations of a (finite) collection, in the same
 * lexicographic-by-removal order as the former eager evaluator. Each
 * arrangement is emitted through `innerRun`, so it is a `List` for a general
 * collection but a STRING over a string source (`Permutations("ab")` is
 * `["ab","ba"]`, ruling D9(b), 2026-08-16). Rejoining an arrangement's grapheme
 * clusters re-runs segmentation and two adjacent clusters can merge, but only
 * when the source itself contained a lone combining mark — the only way a
 * cluster can begin with a character that attaches to what precedes it
 * (`docs/STRING_ROADMAP.md`, design constraint 3). */
function* permutationsIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  // `Permutations` is lazy-only, so this iterator sees the RAW operand: a
  // symbol holding a string, or a string-valued application, is not a string
  // literal and `innerRun` would emit LISTS of characters. Resolve once, here
  // (see `resolveTextSource` in `library/collections.ts`).
  const xs = resolveTextSource(expr.op1);
  const ce = expr.engine;
  const kExpr = expr.ops[1];
  // P(n, 0) = 1: the single empty arrangement — yield it without touching the
  // source (so it also works for an infinite source, which can't be
  // enumerated). A negative/invalid explicit `k` yields nothing.
  if (kExpr) {
    const k0 = toIntegerOperand(kExpr);
    if (k0 === null || k0 < 0) return;
    if (k0 === 0) {
      yield innerRun(ce, xs, []);
      return;
    }
  }
  if (!xs.isFiniteCollection) return;
  const all = [...xs.each()] as Expression[];
  const k = kExpr ? toIntegerOperand(kExpr) : all.length;
  if (k === null || k < 0 || k > all.length) return;

  function* permute(
    prefix: Expression[],
    rest: Expression[]
  ): Generator<Expression[]> {
    if (prefix.length === k) {
      yield prefix;
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      const next = rest.slice();
      const [item] = next.splice(i, 1);
      yield* permute([...prefix, item], next);
    }
  }
  for (const perm of permute([], all)) yield innerRun(ce, xs, perm);
}

/** Stream the `k`-element combinations of a (finite) collection, in
 * ascending-index order (same as the former eager evaluator). Each combination
 * is emitted through `innerRun`, so it is a `List` for a general collection but
 * a STRING over a string source (`Combinations("abc", 2)` is
 * `["ab","ac","bc"]`, ruling D9(b), 2026-08-16). Rejoining a combination's
 * grapheme clusters re-runs segmentation and two adjacent clusters can merge,
 * but only when the source itself contained a lone combining mark — the only
 * way a cluster can begin with a character that attaches to what precedes it
 * (`docs/STRING_ROADMAP.md`, design constraint 3). */
function* combinationsIterator(
  expr: Expression
): Generator<Expression, undefined, any> {
  if (!isFunction(expr)) return;
  // `Combinations` is lazy-only, so this iterator sees the RAW operand; resolve
  // it once so a `string`-holding symbol or a string-valued application emits
  // inner STRINGS (see `resolveTextSource` in `library/collections.ts`).
  const xs = resolveTextSource(expr.op1);
  const ce = expr.engine;
  const kExpr = expr.ops[1];
  // C(n, 0) = 1: the single empty combination — yield it without touching the
  // source (works for an infinite source too). Negative/invalid `k` → nothing.
  const k0 = kExpr ? toIntegerOperand(kExpr) : null;
  if (k0 === null || k0 < 0) return;
  if (k0 === 0) {
    yield innerRun(ce, xs, []);
    return;
  }
  if (!xs.isFiniteCollection) return;
  const all = [...xs.each()] as Expression[];
  const k = k0;
  if (k > all.length) return;

  function* combine(
    start: number,
    combo: Expression[]
  ): Generator<Expression[]> {
    if (combo.length === k) {
      yield combo;
      return;
    }
    for (let i = start; i < all.length; i++) {
      yield* combine(i + 1, [...combo, all[i]]);
    }
  }
  for (const combo of combine(0, [])) yield innerRun(ce, xs, combo);
}

/**
 * Return the element at `index` (1-based; negative counts from the end) of a
 * lazy collection defined by a streaming `gen`, walking only as far as needed.
 * A negative index needs the length, taken from `countFn` (closed form here),
 * so it never forces a full materialization for a known count.
 */
function nthFromIterator(
  expr: Expression,
  index: number | string,
  gen: (e: Expression) => Generator<Expression, undefined, any>,
  countFn: (e: Expression) => number | undefined
): Expression | undefined {
  if (typeof index !== 'number' || !Number.isInteger(index) || index === 0)
    return undefined;
  let target = index;
  if (index < 0) {
    const c = countFn(expr);
    if (c === undefined || !Number.isFinite(c)) return undefined;
    target = c + index + 1;
    if (target < 1) return undefined;
  }
  let i = 0;
  for (const el of gen(expr)) {
    if (++i === target) return el;
  }
  return undefined;
}
