import type { NumericPrimitiveType, Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { BigDecimal } from '../../big-decimal/index.js';
import type { Expression, NumberLiteralInterface } from '../global-types.js';
import { SMALL_INTEGER, machineNthRoot } from '../numerics/numeric.js';
import { bigintMaximalPerfectPower } from '../numerics/bigint.js';
import {
  rationalize,
  reduceRationalRoot,
  reducedRational,
} from '../numerics/rationals.js';
import type { Rational } from '../numerics/types.js';

import { asRational } from './numerics.js';
import { bignumPreferred, getImaginaryFactor } from './utils.js';
import {
  exactUnitCircle,
  halfTurnAngle,
  halfTurns,
  radiansToAngle,
} from './trigonometry.js';
import {
  apply,
  apply2,
  boxComplexKernelResult,
  complexNumericValueRoute,
} from './apply.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  nanOperandAnswer,
  indeterminateFormAnswer,
  numericValue,
} from './type-guards.js';
import { realExponentValue, isGaussianIntegerValue } from './imaginary-part.js';
import { isGaussianInteger } from '../numeric-value/gaussian-integer.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { complexPow } from '../numerics/numeric-complex.js';
import { asFloat, hasFloatOperand } from './float-result.js';

/** Is the expression statically a MATRIX — a shape decision, so the bottom
 * type must answer no: `never` is a subtype of `matrix` (of everything),
 * but an expression with no value has no shape to rewrite for. */
function isMatrixTyped(x: Expression): boolean {
  return x.type.type !== 'never' && x.type.matches(new BoxedType('matrix'));
}

/** A number literal denoting the direction-less complex infinity `~oo` —
 * infinite, but with no signed direction. */
function isComplexInfinityLiteral(x: Expression): boolean {
  return (
    isNumber(x) &&
    x.isInfinity === true &&
    x.isPositive !== true &&
    x.isNegative !== true
  );
}

/**
 * Whether an exact value's modulus is exactly 1: `0` when |v|² = 1, `1`
 * when |v|² > 1, `-1` when |v|² < 1, `undefined` when the components do
 * not admit the exact computation. An exact value is
 * `(p/q)·√c + (r/s)·√m·i`, so |v|² is the RATIONAL
 * `(p²c·s² + r²m·q²) / (q²s²)`, and the comparison against 1 is exact
 * integer arithmetic — the machine doubles cannot decide it: `(5+12i)/13`
 * computes `re² + im²` as 1.0000000000000002 though its modulus is
 * exactly 1, and `1 + 10⁻¹⁰i` computes exactly 1 though its modulus is
 * not.
 */
function exactModulusSquaredVsOne(nv: ExactNumericValue): number | undefined {
  const toBig = (x: number | bigint): bigint | undefined =>
    typeof x === 'bigint' ? x : Number.isSafeInteger(x) ? BigInt(x) : undefined;
  const p = toBig(nv.rational[0]);
  const q = toBig(nv.rational[1]);
  const r = toBig(nv.imRational[0]);
  const s = toBig(nv.imRational[1]);
  const c = toBig(nv.radical);
  const m = toBig(nv.imRadical);
  if (
    p === undefined ||
    q === undefined ||
    r === undefined ||
    s === undefined ||
    c === undefined ||
    m === undefined ||
    q === 0n ||
    s === 0n
  )
    return undefined;
  const lhs = p * p * c * s * s + r * r * m * q * q;
  const rhs = q * q * s * s;
  return lhs === rhs ? 0 : lhs > rhs ? 1 : -1;
}

/**
 * The value of `a^(±∞)` for a NON-REAL finite number literal `a`, decided by
 * the modulus (ruled 2026-09-01): for the +∞ exponent, |a| > 1 gives the
 * direction-less `~oo` (the modulus grows without bound while the argument
 * rotates), |a| < 1 gives 0, and |a| = 1 oscillates on the unit circle with
 * no limit — NaN. The −∞ exponent mirrors through `a^(−∞) = (1/a)^∞`.
 *
 * How the modulus is compared depends on the literal's exactness:
 *
 * - An EXACT base takes the exact integer test (`exactModulusSquaredVsOne`
 *   above), which is definitive — `i^∞ = NaN`, `((5+12i)/13)^∞ = NaN`,
 *   `(1 + 10⁻¹⁰i)^∞ = ~oo`. If the exact test does not apply, machine
 *   doubles classify only comfortably away from the unit circle; inside
 *   the boundary band the base DECLINES rather than risk a wrong claim
 *   (the node stays symbolic; `.N()` numericizes the operands and the
 *   float arm below answers for those values).
 * - An INEXACT (float-component) base is classified by its doubles — they
 *   ARE its value — except within a few ulps of the unit circle, where
 *   the true modulus of the doubles differs from 1 by no more than
 *   representation error: at machine precision the power oscillates
 *   rather than converging, so the value is NaN (`√3/2 + 0.5i` computes
 *   `re² + im²` as 0.9999999999999999; folding that to 0 would amplify a
 *   1-ulp artifact into a definite value).
 *
 * Returns `undefined` when the rule does not apply (real base, infinite
 * operand, or boundary-ambiguous exact base) — the caller leaves the node
 * unchanged.
 */
function complexBaseAtInfiniteExponent(
  a: Expression,
  ce: Expression['engine'],
  expPositive: boolean
): Expression | undefined {
  if (!isNumber(a) || !a.isComplex) return undefined;
  if (!Number.isFinite(a.re) || !Number.isFinite(a.im)) {
    // The literal itself is finite — the caller handles infinite operands
    // — so a non-finite double read means an exact component OVERFLOWED
    // the double range: the modulus is far above 1.
    if (a.isFinite === true) return expPositive ? ce.ComplexInfinity : ce.Zero;
    return undefined;
  }
  const m2 = a.re * a.re + a.im * a.im;
  if (a.isExact) {
    const nv = a.numericValue;
    if (nv instanceof ExactNumericValue) {
      const t = exactModulusSquaredVsOne(nv);
      // An exact base on the unit circle, other than 1, oscillates with no
      // limit: the indeterminate form `Indeterminate` (`i^∞`).
      if (t === 0) return indeterminateFormAnswer(ce, [a]);
      if (t === 1) return expPositive ? ce.ComplexInfinity : ce.Zero;
      if (t === -1) return expPositive ? ce.Zero : ce.ComplexInfinity;
    }
    if (Math.abs(m2 - 1) < 1e-9) return undefined;
  } else if (Math.abs(m2 - 1) < 1e-12) {
    return ce.NaN;
  }
  if (m2 > 1) return expPositive ? ce.ComplexInfinity : ce.Zero;
  if (m2 < 1) return expPositive ? ce.Zero : ce.ComplexInfinity;
  // Unreachable: every m2 === 1 case was answered by an arm above.
  return undefined;
}

/**
 * True if `x` is the EXACT number literal `n`. A float literal with the same
 * value (`1.0`, `-1.0`) is not an identity of `Power`: a float operand makes
 * the result a float, so `1.0^x`, `x^{1.0}` and `x^{-1.0}` stay as they are,
 * and `1.0^2` evaluates to a float `1`. (Mathematica does the same:
 * `x^1.` stays `x^1.`.)
 */
function isExactLiteral(x: Expression, n: number): boolean {
  return isNumber(x) && x.isExact && x.isSame(n);
}

function isSqrt(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  return (
    expr.operator === 'Sqrt' ||
    (expr.operator === 'Power' && expr.op2.im === 0 && expr.op2.re === 0.5) ||
    (expr.operator === 'Root' && expr.op2.im === 0 && expr.op2.re === 2)
  );
}

/** Return the maximal decomposition `n = base^exponent`, or undefined. */
function maximalPerfectPower(
  n: number
): { base: number; exponent: number } | undefined;
function maximalPerfectPower(
  n: number | bigint
): { base: number | bigint; exponent: number } | undefined;
function maximalPerfectPower(
  n: number | bigint
): { base: number | bigint; exponent: number } | undefined {
  // Past the safe integers a double cannot represent the radicand exactly,
  // so the search runs on the exact bigint instead (`10^61 = 10^61`, with
  // the maximal exponent 61).
  if (typeof n === 'bigint') {
    if (n <= BigInt(Number.MAX_SAFE_INTEGER)) n = Number(n);
    else return bigintMaximalPerfectPower(n);
  }
  if (!Number.isSafeInteger(n) || n <= 1) return undefined;
  for (let exponent = Math.floor(Math.log2(n)); exponent >= 2; exponent--) {
    const base = Math.round(Math.pow(n, 1 / exponent));
    if (base > 1 && BigInt(base) ** BigInt(exponent) === BigInt(n))
      return { base, exponent };
  }
  return undefined;
}

/**
 * Ceiling on the expected number of reduced rationals with denominator ≤ `q`
 * inside `realPowerBranchTerms`' admission window — i.e. the odds that a
 * reconstruction is a coincidence rather than the rational the double was
 * rounded from. See `realPowerBranchTerms`.
 */
export const COINCIDENCE_BUDGET = 1e-4;

/** A `Rational` term as an exact integer, or `undefined` if it is not one. */
function asBigInteger(n: number | bigint): bigint | undefined {
  if (typeof n === 'bigint') return n;
  return Number.isInteger(n) ? BigInt(n) : undefined;
}

/**
 * `n` as a double with the SAME PARITY — which is the only property of these
 * terms the branch decision reads (an odd `q` is the real branch, an odd `p`
 * its negative sign).
 *
 * Parity and magnitude cannot both survive the narrowing: EVERY double at or
 * above 2^53 is an even integer, so an odd term that large has no faithful
 * double at all. `Number(66052794534767279n)` is `…280`, which turned an odd
 * numerator even and — for the denominator — reported a real value complex.
 * Parity wins; a term that big is returned as a same-signed, same-parity
 * sentinel instead. Nothing downstream reads the magnitude except the compiled
 * fold's root-then-power split, which is gated at 64 and so declines the
 * sentinel exactly as it would decline the true term.
 */
function parityFaithful(n: bigint): number {
  const v = Number(n);
  // Safe range: the narrowing is exact, parity included.
  if (Number.isSafeInteger(v)) return v;
  const isOdd = n % 2n !== 0n;
  // Above the safe range every double is even, so an even term still narrows
  // faithfully — unless it overflows to Infinity, whose parity is NaN.
  if (!isOdd && Number.isFinite(v)) return v;
  const sentinel = isOdd
    ? Number.MAX_SAFE_INTEGER
    : Number.MAX_SAFE_INTEGER - 1;
  return n < 0n ? -sentinel : sentinel;
}

/**
 * The reduced terms `[p, q]` of a real exponent, for deciding the branch of a
 * NEGATIVE base — or `undefined` when no faithful rational is available.
 *
 * CE's convention: `p/q` in lowest terms with an **odd** `q` has a real
 * principal value (`(−8)^(2/3) = 4`, matching `Root(−8, 3) = −2`); an even `q`
 * — or an exponent that is not a rational at all — takes the principal complex
 * value.
 *
 * The decision is made from the EXACT rational whenever the caller has one.
 * Recovering `p/q` from the double instead is not equivalent: `100/3` rounds to
 * a double whose continued-fraction expansion terminates at the dyadic
 * `4691249611844267/140737488355328`, whose denominator is EVEN — so a
 * float-first decision reports `(−2)^(100/3)` complex even though the exact
 * exponent has an odd denominator and the value is real.
 *
 * When only the double is available — under `.N()` the exponent reaches the
 * numeric path already numericized — the reconstruction is given a tolerance
 * scaled to the precision the double was PRODUCED at, so a double that IS an
 * exact rational rounded at that precision recovers that rational
 * (`33.333333333333336` → `100/3`) while a genuine decimal (`0.3333333333`)
 * stays at its own, far-from-`1/3`, terms. That keeps the two routes — and the
 * compiled constant fold, which shares this helper — deciding the same branch
 * for the same node.
 *
 * The window is scaled to `BigDecimal.precision` — the PROCESS-GLOBAL working
 * precision, which is the value that actually governed the rounding, NOT the
 * `precision` of whichever engine happens to be asking. The two diverge,
 * because constructing any engine writes the global: create a default engine
 * and THEN a machine one, and the first still reports `precision` 21 while its
 * `.N()` now rounds at 15. Sizing the window off the engine then computed a
 * 17-digit tolerance for a 15-digit double, lost the reconstruction, and
 * resurrected the exact bug this helper exists to fix — with the outcome
 * depending on engine CREATION ORDER. Reading the global also makes every lane
 * agree by construction, since there is only one of it.
 *
 * Precision matters because numericizing an exact rational rounds to that many
 * digits BEFORE the double is formed: at precision 15, `100/3` becomes
 * `33.3333333333333`, which is ~1.5e5 ulp from `100/3` and reconstructs to
 * `335089257988833/10052677739665` — an ODD denominator with an ODD numerator,
 * so `(−2)^(100/3)` came out NEGATIVE where a correctly-rounded double returns
 * the correct positive value. A tolerance of one unit in the last KEPT digit
 * absorbs that rounding; it never shrinks below the 4-ulp floor, so a lane at
 * precision ≥ 17 is unaffected.
 *
 * Closeness alone is NOT enough to accept a reconstruction, at ANY tolerance.
 * Every irrational has continued-fraction convergents with `|x − p/q| ~ 1/q²`,
 * so once `q` grows past `1/√tol` SOME convergent falls inside the window: `π`
 * lands on `5419351/1725033` (odd `q` ⇒ real branch) and `√2` on
 * `9369319/6625109`, which is how `(−2)^π` and `(−2)^(√2)` used to come back
 * REAL. Widening or narrowing the tolerance only moves which convergent is
 * picked — and, because the two lanes use different tolerances, makes them
 * disagree.
 *
 * So the reconstruction must also be UNLIKELY TO BE A COINCIDENCE. The reduced
 * rationals with denominator ≤ q have density `(6/π²)·q²` per unit length, so
 * the expected number of them inside the `±tol` admission window is
 * `(6/π²)·q²·(2·tol)`. Requiring that expectation to stay under
 * `COINCIDENCE_BUDGET` (1e-4) caps `q` at `~0.009/√tol`. The same cap subsumes
 * Legendre uniqueness (`2·tol·q² < 1`), which by itself is ~10⁴ times too
 * permissive to separate the two populations.
 *
 * What that criterion guarantees is a coincidence RATE, and it is worth stating
 * without varnish in both directions:
 *
 * - It is not a proof of irrationality. `COINCIDENCE_BUDGET` is an upper bound
 *   on a rate that is genuinely spent: ~5e-5 of arbitrary doubles drawn from
 *   (0, 10) still reconstruct to something, ~3e-5 of them onto the REAL branch,
 *   at denominators of 1e4–7e5. Those ARE accepted coincidences sitting just
 *   under budget. The criterion buys ~10⁴:1 odds per query, not impossibility.
 * - It is not exhaustive for rationals either. A `p/q` is recoverable from its
 *   double only while `q ≲ 0.009/√tol` — for `|value| ≈ 1` that is ~9e4 at 15
 *   digits and ~3e5 at 17 (the cap loosens as `1/√|value|`, since `tol` is
 *   relative). That covers the terms a `.N()` round-trip realistically carries,
 *   but genuine odd-`q` rationals ABOVE the cap are REJECTED and take the
 *   complex branch — a `(3q+1)/q` ladder reaching `q ~ 10⁶` is declined for
 *   most of its rungs. This is not a defect to be tuned away: past the cap the
 *   exponent is, at double precision, indistinguishable from an irrational, and
 *   no tolerance admits those without admitting the convergents of `π`
 *   alongside them.
 *
 * Callers with the EXACT rational in hand never pay either price: the float
 * path is a fallback for an exponent that has already been numericized.
 */
export function realPowerBranchTerms(
  exact: Rational | undefined,
  value: number
): [p: number, q: number] | undefined {
  if (exact !== undefined) {
    const [rp, rq] = reducedRational(exact);
    const p = asBigInteger(rp);
    const q = asBigInteger(rq);
    if (p === undefined || q === undefined || q === 0n) return undefined;
    return [parityFaithful(p), parityFaithful(q)];
  }

  if (!Number.isFinite(value)) return undefined;
  // The GLOBAL working precision is what rounded `value`, so it — not any
  // engine's `precision` — sizes the window. See the note above.
  //
  // A double never carries more than 17 significant digits, and the branch
  // decision must not depend on a precision configured BELOW machine
  // precision: `new ComputeEngine({ precision: 3 })` writes a global of 3,
  // bypassing the MACHINE_PRECISION floor that `setPrecision` applies, and a
  // 1%-wide window snaps essentially any float to a small rational. Clamp to
  // [15, 17] regardless.
  const digits = realPowerReconstructionDigits();
  const tol = Math.max(
    Number.MIN_VALUE,
    Math.abs(value) * 4 * Number.EPSILON,
    Math.abs(value) * Math.pow(10, 1 - digits)
  );
  const r = rationalize(value, tol);
  if (!Array.isArray(r)) return undefined;
  const [p, q] = r;
  if (!Number.isFinite(p) || !Number.isFinite(q) || q === 0) return undefined;
  // Only a faithful reconstruction is trusted, measured at EXACTLY the width
  // the coincidence budget below is charged for. `rationalize` can fall out of
  // its convergent loop on its own internal 1e-15 guard and return terms it
  // never checked against `tol`, so this is a real gate, not a formality.
  //
  // The width is `tol` alone: an earlier `Math.max(1e-12, tol)` accepted at one
  // bound while charging the budget at the other, and for |value| < 100 the
  // 1e-12 floor dominated — admitting e.g. `0.0249… → 24737/993426` (21x
  // outside its own 2.2e-17 tolerance) for a charge of 2.7e-5 when its true
  // expected-coincidence count was 1.2, i.e. a certainty. The floor is also
  // dead weight: a p/q rounded at `digits` lands within 0.47·tol at worst
  // (measured over the exercised terms, and the bound is scale-invariant since
  // both are relative), so no legitimate reconstruction ever needed it —
  // including the `1000001/3` → `333333.666666667` case that motivated it,
  // whose 2.9e-10 error sits inside a 3.3e-9 tolerance.
  if (Math.abs(p / q - value) > tol) return undefined;
  // ...and only a reconstruction that cannot plausibly be a coincidence. See
  // the note above: `(6/π²)·q²·(2·tol)` is the expected number of reduced
  // rationals with denominator ≤ q inside the admission window; past the
  // budget the hit says nothing about where the double came from.
  if ((12 / Math.PI ** 2) * q * q * tol > COINCIDENCE_BUDGET) return undefined;
  return [p, q];
}

// If the expression is of the form
// : sqrt(n), return n/1
// : sqrt(n/m), return n/m
// : 1/sqrt(n), return 1/n
// : (could do): sqrt(n)/m, return n/m^2
export function asRadical(expr: Expression): Rational | null {
  if (isSqrt(expr) && isFunction(expr)) {
    const r = asRational(expr.op1);
    // Reject negative radicands (imaginary results, not real radicals)
    if (r === undefined || r[0] < 0 || r[1] < 0) return null;
    return r;
  }

  if (isFunction(expr, 'Divide') && expr.op1.isSame(1) && isSqrt(expr.op2)) {
    const n = expr.op2.re;
    if (!Number.isInteger(n) || n <= 0) return null;
    return [1, n];
  }

  return null;
}

/**
 *
 * Produce the canonical form of the operands of a Power expression, returning either the operation
 * result (e.g. 'a^1 -> a'), an alternate expr. representation ('a^{1/2} -> Sqrt(a)'), or an
 * unchanged 'Power' expression. Operations include:
 * 
 * - @todo
 * 
 * Both the given base and exponent can either be canonical or non-canonical: with fully
 * canonicalized args. lending to more simplifications.
 * 
 * Returns a canonical expr. is both operands are canonical.
 
 * @export
 * @param a
 * @param b
 * @returns
 */
export function canonicalPower(a: Expression, b: Expression): Expression {
  const ce = a.engine;

  const fullyCanonical =
    (a.isCanonical || a.isStructural) && (b.isCanonical || b.isStructural);
  const unchanged = () =>
    ce._fn('Power', [a, b], { canonical: fullyCanonical });

  // An operand with the EMPTY type `never` (e.g. a symbol declared
  // `integer<2<..<3>`) has no value — but the bottom type matches every
  // type, so the value folds below, keyed on type-channel predicates
  // (`isInfinity`, `isFinite`, `isGreater`, sign reads), would all fire
  // for it: a never-typed base folded `m^∞` to `~oo` and `m^0` to 1. No
  // fold applies to a valueless operand; leave the node unchanged and its
  // TYPE stays `never` (the same guard `isMatrixTyped` carries for the
  // matrix rewrite).
  if (a.type.type === 'never' || b.type.type === 'never') return unchanged();

  if (isFunction(a, 'Power')) {
    const [base, aPow] = a.ops;
    // (a^n)^m -> a^{n*m} only when mathematically safe:
    // - base is non-negative (no sign info to lose), or
    // - outer exponent m is integer (repeated multiplication is safe).
    // An odd inner exponent n is NOT sufficient: on the principal branch
    // (a^n)^m = a^{nm}·e^{-2πi·m·k}, where k is how many times arg(a^n) wraps
    // out of (-π, π]. For odd n and a < 0, k != 0 (e.g. n=3 ⇒ k=1), so the
    // phase factor e^{-2πi·m·k} != 1 unless m is an integer. Concretely
    // (x^3)^{1/2} = √(x^3) (= 8i at x=-4), not x^{3/2} (= -8i) — combining
    // here is unsound and breaks confluence with the Sqrt(x^3) form.
    const outerIsInteger = b.isInteger === true;
    const baseNonNeg = base.isNonNegative === true;

    if (baseNonNeg || outerIsInteger) {
      return ce._fn('Power', [
        base,
        ce.expr(['Multiply', aPow, b], {
          form: fullyCanonical ? 'canonical' : 'Power',
        }),
      ]);
    }
    // Unsafe to combine — leave as nested Power, fall through
  }

  // (a/b)^{-n} -> a^{-n} / b^{-n} = b^n / a^n
  // Only distribute when exponent is negative to normalize negative exponents on fractions
  // e.g., (a/b)^{-2} -> b^2 / a^2
  if (isFunction(a, 'Divide') && b.isNegative === true) {
    const num = a.op1;
    const denom = a.op2;
    // Only distribute when exponent is integer or both operands are non-negative
    // (distributing non-integer exponents over negative operands changes sign)
    if (
      b.isInteger === true ||
      (num.isNonNegative === true && denom.isNonNegative === true)
    ) {
      return pow(num, b, { numericApproximation: false }).div(
        pow(denom, b, { numericApproximation: false })
      );
    }
  }

  // Handle special base cases that only need sign/infinity info from the
  // exponent, before the numeric-exponent guard below.
  if (isNumber(a) && a.isSame(0) && !b.isSame(0) && !b.isInfinity) {
    // 0^positive = 0, 0^negative = ComplexInfinity. A float base `0.0`
    // or a float exponent (`0^{2.0}`) gives a float `0`.
    if (b.isPositive === true)
      return !a.isExact ? a : hasFloatOperand([b]) ? asFloat(a) : ce.Zero;
    if (b.isNegative === true) return ce.ComplexInfinity;
  }

  // 1^b = 1 for any finite exponent. This must precede the numeric-exponent
  // guard below: that guard bails on a symbolic or function exponent (e.g.
  // `1^(n+1)`), which would otherwise leave `1^(n+1)` un-reduced. A genuinely
  // infinite or NaN exponent (`1^∞`, `1^NaN`) is indeterminate and is
  // intentionally excluded — it has `isFinite === false` / `isNaN === true` and
  // falls through to the NaN handling further down. (Matches SymPy / Mathematica,
  // which both reduce `1^x → 1`.)
  if (isExactLiteral(a, 1) && b.isFinite !== false && b.isNaN !== true)
    return ce.One;

  // Onwards, the focus on operations is where is a *numeric* exponent.
  // Therefore, exclude cases - which may otherwise be valid - of the exponent either: being a function (e.g.
  // '0 + 0'), a symbol, or of a non-numeric type.
  //
  // @consider:possible exceptions where function-expressions are reasonable :Rational,Half,
  // Negate... (However, provided that canonicalNumber provided prior, should not be missing anything
  // here)
  if (isFunction(b) || isSymbol(b) || !b.type.matches('number' as Type))
    return unchanged();

  // Matrix power: `A^n` for an integer `n` is the *matrix* power — repeated
  // matrix multiplication (`A·A·…`), the identity for `n = 0`, and the inverse
  // for negative `n` — consistent with `*`/`\cdot`/`\times` being the matrix
  // product. (Element-wise power of a matrix is not expressed via `^`.) Routing
  // at canonicalization keeps `A^2` from element-wise broadcasting at
  // evaluation. Vectors and non-integer exponents are left to other handling.
  // `isMatrixTyped`, not a bare `matches('matrix')`: the bottom type
  // `never` (an EMPTY declared range, `integer<2<..<3>`) matches every
  // type, and a shape REWRITE keyed on that vacuous match turned
  // `Power(never, 2)` into a `MatrixPower` typed `matrix`.
  if (b.isInteger === true && isMatrixTyped(a)) {
    const n = b.re;
    if (n === 1) return a;
    // Preserve the existing canonical form for the inverse.
    if (n === -1) return ce.function('Inverse', [a]);
    return ce.function('MatrixPower', [a, b]);
  }

  // Zero as base
  if (isNumber(a) && a.isSame(0)) {
    // A `NaN`-valued exponent is forwarded (`Indeterminate` stays
    // `Indeterminate`, see `nanOperandAnswer()`).
    // A literal only: `isNaN` of a symbol reads its current value, which a
    // canonical form must not depend on (see `canonicalDivide`).
    if (isNumber(b) && b.isNaN) return nanOperandAnswer(ce, [a, b]);
    // `0^(imaginary)` and `0^0` have no value: `Indeterminate`, or `NaN`
    // when an operand is a float (`indeterminateFormAnswer()`).
    if (b.type.matches('imaginary' as NumericPrimitiveType))
      return indeterminateFormAnswer(ce, [a, b]);

    if (b.isSame(0)) return indeterminateFormAnswer(ce, [a, b]);

    if (b.isInfinity) {
      // 0^∞ = 0 (because for all complex numbers z near 0, z^∞ -> 0).
      if (b.isPositive) return ce.Zero; // 0^∞ = 0
      // 0^-∞ = ~∞
      if (b.isNegative) return ce.ComplexInfinity;
      // A `~oo` exponent is off-carrier for `Power` (ruled 2026-09-01: no
      // base has a value there). Leave the node unfolded so the `Power`
      // evaluate handler answers the incompatible-type error — folding
      // here (the old `0^~∞ = NaN`) would bypass that seam.
      return unchanged();
    }
    //(note: these should be applicable only to the reals)
    if (b.isGreater(0)) return ce.Zero;
    if (b.isLess(0)) return ce.ComplexInfinity;

    return unchanged(); // No other canonicalization cases with this base
  }

  // 'a'/base has an associated number value (excludes numeric functions)
  // (this should at this stage include library-defined symbols such as 'Pi')
  // @note: include 'Negate', because this could be wrapped around a
  // number-valued symbol, such as 'Pi'...
  // ^there could exist other exceptions: perhaps consider a util. such as
  //  'maybeNumber'?
  const aIsNum =
    a.type.matches('number' as NumericPrimitiveType) &&
    (!isFunction(a) || a.operator === 'Negate');

  // Zero as exponent
  if (b.isSame(0)) {
    // If 'isFinite' is a boolean, then 'a' has a value. A float exponent
    // `0.0` is not folded to the exact `1`: `2^{0.0}` evaluates to a float.
    // A symbol whose value is `NaN` is left to `evaluate()`, which
    // substitutes the value first (see `canonicalDivide`).
    if (a.isNaN === true && !isNumber(a)) return unchanged();
    if (
      aIsNum &&
      a.isFinite !== undefined &&
      (a.isFinite === false || isExactLiteral(b, 0))
    )
      // A `NaN`-valued base is forwarded (`Indeterminate^0` is
      // `Indeterminate`); an infinite base is the indeterminate form `∞^0`
      // (`Indeterminate`, or `NaN` with a float exponent `0.0`).
      return a.isFinite
        ? ce.One
        : a.isNaN === true
          ? nanOperandAnswer(ce, [a, b])
          : indeterminateFormAnswer(ce, [a, b]);
    return unchanged();
  }

  // One as base
  // (note: 1^∞ = NaN - Because there are various cases where lim(x(t),t)=1, lim(y(t),t)=∞ (or -∞),
  // but lim( x(t)^y(t), t) != 1.)
  // A `~oo` exponent stays unfolded: it is off-carrier for `Power` (ruled
  // 2026-09-01), and the `Power` evaluate handler owns the
  // incompatible-type error. `1^±∞` keeps the indeterminate-form NaN and
  // `1^NaN` the propagated NaN.
  if (aIsNum && isExactLiteral(a, 1)) {
    if (b.isFinite) return ce.One;
    if (isComplexInfinityLiteral(b)) return unchanged();
    if (isNumber(b) && b.isNaN) return nanOperandAnswer(ce, [a, b]);
    return indeterminateFormAnswer(ce, [a, b]);
  }

  // One as exponent
  // (Permit the base to be a FN-expr. here, too...)
  if (isExactLiteral(b, 1) && a.type.matches('number' as NumericPrimitiveType))
    return a;

  // -1 exponent
  if (isExactLiteral(b, -1)) {
    if (aIsNum) {
      // 1/∞ = 0 for EVERY infinite base, `~oo` included: the modulus is
      // infinite in every direction, so the reciprocal's modulus is 0 in
      // every direction. This agrees with the `Divide` route (`1/~oo = 0`)
      // and with `(~oo)^-2 = 0`; excluding `~oo` here used to send it to
      // `.inv()`, which answered NaN. `isNumber` restricts the fold to a
      // LITERAL infinity: a symbol with the EMPTY type `never` answers
      // `isInfinity` true (the bottom type matches every type — the same
      // trap `isMatrixTyped` guards against), and has no value to fold.
      if (isNumber(a) && a.isInfinity === true) return ce.Zero;

      // (-1)^-1 = -1
      if (isExactLiteral(a, -1)) return ce.NegativeOne;

      // 1^-1 = 1
      if (isExactLiteral(a, 1)) return ce.One;
    }

    // Matrix inverse: A^{-1} -> Inverse(A)
    if (isMatrixTyped(a)) return ce.function('Inverse', [a]);

    // (note: case of `0^-1 = ~∞` is covered prior...)
    if (!(a.isCanonical || a.isStructural))
      return ce._fn('Power', [a, ce.number(-1)], { canonical: false });
    return a.inv();
  }

  //Infinity exponents
  if (b.isInfinity && aIsNum) {
    // x^oo
    if (b.isPositive) {
      // (note: 0^∞ = 0, 1^∞ = NaN, covered prior)

      // e^∞ = ∞ (handle explicitly before general case)
      if (isSymbol(a, 'ExponentialE')) return ce.PositiveInfinity;

      // (-1)^∞ = Indeterminate, because of oscillations in the limit (`NaN`
      // for the float `-1.0`). A float base `1.0` is the form `1^∞`: `NaN`
      // (an exact `1` was handled above; the float fell to the `0` below).
      if (a.isSame(-1) || a.isSame(1))
        return indeterminateFormAnswer(ce, [a, b]);

      // An infinite base: (+∞)^∞ = +∞, because the DIRECTION is known —
      // nⁿ grows through +∞ (10¹⁰, 100¹⁰⁰ = 10²⁰⁰, 1000¹⁰⁰⁰ overflows the
      // double range), never changing sign. (-∞)^∞ and (~∞)^∞ keep the
      // direction-less ~∞: (-n)ⁿ alternates with the parity of n
      // ((-10)¹⁰ = +10¹⁰, (-11)¹¹ = -2.85·10¹¹), so no signed limit exists.
      if (a.isInfinity) {
        if (a.isPositive === true) return ce.PositiveInfinity;
        return ce.ComplexInfinity;
      }

      if (isNumber(a) && a.isNaN) return nanOperandAnswer(ce, [a, b]);

      //↓numeric-expr. bases included: e.g. '{2+3}^oo'
      if (a.isExtendedReal) {
        if (a.isGreater(1)) return ce.PositiveInfinity;
        if (a.isLess(-1)) return ce.ComplexInfinity;
        // Must be '-1 < a < 1', excluding zero
        return ce.Zero;
      }

      // A non-real literal base is decided by its modulus (ruled
      // 2026-09-01): |a| > 1 spirals outward — the modulus grows without
      // bound while the argument rotates, so the direction-less `~oo`
      // (`(1+i)^∞ = ~oo`, matching the real `(-2)^∞` above); |a| < 1
      // spirals into 0; |a| = 1 with a ≠ 1 oscillates on the unit circle
      // with no limit (`i^∞ = NaN`, like `(-1)^∞`). These used to stay
      // symbolic under `evaluate()` while `.N()` answered NaN — a route
      // divergence.
      {
        const fold = complexBaseAtInfiniteExponent(a, ce, true);
        if (fold !== undefined) return fold;
      }

      return unchanged();
    }

    // x^-oo
    if (b.isNegative) {
      // e^(-∞) = 0 (handle explicitly before general case)
      if (isSymbol(a, 'ExponentialE')) return ce.Zero;

      // (-1)^-∞ = Indeterminate, and the float `1.0^-∞` is `NaN`, as for +∞.
      if (a.isSame(-1) || a.isSame(1))
        return indeterminateFormAnswer(ce, [a, b]);
      //Same result for all infinity types...
      if (a.isInfinity) return ce.Zero;

      if (isNumber(a) && a.isNaN) return nanOperandAnswer(ce, [a, b]);

      if (a.isExtendedReal) {
        if (a.isGreater(0)) return a.isLess(1) ? ce.PositiveInfinity : ce.Zero;
        // Must be < 0
        return a.isGreater(-1) ? ce.ComplexInfinity : ce.Zero;
      }
      // Non-real literal base: the mirror of the +∞ arm above —
      // a^(−∞) = (1/a)^∞, so |a| > 1 gives 0 and |a| < 1 gives `~oo`.
      {
        const fold = complexBaseAtInfiniteExponent(a, ce, false);
        if (fold !== undefined) return fold;
      }
      return unchanged();
    }

    // Must be 'x^~oo'. A `~oo` exponent is off-carrier for `Power` (ruled
    // 2026-09-01): `b^z` has no value at `z = ~oo` for ANY base — the
    // result depends on the direction of approach. Leave the node unfolded
    // so the `Power` evaluate handler answers the incompatible-type error
    // (the old fold to NaN bypassed that seam).
    return unchanged();
  }

  //'AnyInfinity^b'
  if (isNumber(a) && a.isInfinity) {
    // Special handling for NegativeInfinity with integer/rational exponents
    if (a.isNegative) {
      // (-inf)^n for negative exponents -> 0
      if (b.isNegative === true) return ce.Zero;

      // (-inf)^n for positive integer n
      if (b.isInteger === true) {
        if (b.isEven === true) return ce.PositiveInfinity; // (-inf)^(even) -> +inf
        if (b.isOdd === true) return ce.NegativeInfinity; // (-inf)^(odd) -> -inf
      }

      // (-inf)^(n/m) for rational n/m
      if (b.isRational === true) {
        const [numExpr, denomExpr] = b.numeratorDenominator;
        const num = numExpr.re;
        const denom = denomExpr.re;

        if (
          typeof num === 'number' &&
          typeof denom === 'number' &&
          Number.isInteger(num) &&
          Number.isInteger(denom)
        ) {
          const numIsEven = num % 2 === 0;
          const numIsOdd = num % 2 !== 0;
          const denomIsOdd = denom % 2 !== 0;

          // n even, m odd -> +inf
          if (numIsEven && denomIsOdd) return ce.PositiveInfinity;

          // n odd, m odd -> -inf (real interpretation)
          if (numIsOdd && denomIsOdd) return ce.NegativeInfinity;
        }
      }
    }

    // PositiveInfinity^b for real b
    if (a.isPositive) {
      if (b.isPositive === true) return ce.PositiveInfinity; // +inf^positive -> +inf
      if (b.isNegative === true) return ce.Zero; // +inf^negative -> 0
    }

    // If the exponent is pure imaginary, the result is NaN
    //(↓fix?:ensure both these cases narrow down to 'b' being a num./symbol literal)
    // (the indeterminate form `Indeterminate`, or `NaN` with a float operand)
    if (b.type.matches('imaginary')) return indeterminateFormAnswer(ce, [a, b]);
    if (b.type.matches('complex') && !isNaN(b.re)) {
      if (b.re > 0) return ce.ComplexInfinity;
      if (b.re < 0) return ce.Zero;
    }
  }

  // Fractional exponents
  //---------------------
  // Only an EXACT `1/2` makes a square root. A float exponent `0.5` is kept,
  // as a float `1.0` is (`isExactLiteral` above): `4^{0.5}` evaluates to the
  // float `2`, and `x^{0.5}` stays `x^{0.5}`, as in Mathematica.
  if (isExactLiteral(b, 0.5))
    return a.isCanonical || a.isStructural
      ? canonicalRoot(a, 2)
      : ce._fn('Sqrt', [a], { canonical: false });
  const r = asRational(b);

  //1/3, 1/4...
  if (r !== undefined && r[0] === 1 && r[1] !== 1)
    return a.isCanonical || a.isStructural
      ? canonicalRoot(a, ce.number(r[1]))
      : ce._fn('Root', [a, ce.number(r[1])], { canonical: false });

  // Negative unit fractions: a^{-1/n} -> 1/Root(a, n) (1/Sqrt(a) for n=2).
  // a^{-1/n} = 1/a^{1/n} is exact on the principal branch (no sign info
  // lost — unlike the unsound 1/√u -> √(1/u)), so this is branch-safe.
  // Without it, x^{-1/2} stayed a Power node and did NOT unify with the
  // Divide(1, Sqrt(x)) form that 1/Sqrt(x), Sqrt(x)^{-1} and 1/x^{1/2} all
  // canonicalize to — so e.g. D(arcsin x) = (1-x^2)^{-1/2} would not cancel
  // against the integrand 1/Sqrt(1-x^2), breaking antiderivative checks.
  if (r !== undefined && r[0] === -1 && Math.abs(Number(r[1])) !== 1) {
    const root = canonicalRoot(a, ce.number(Math.abs(Number(r[1]))));
    return a.isCanonical || a.isStructural
      ? ce.function('Divide', [ce.One, root])
      : ce._fn('Divide', [ce.One, root], { canonical: false });
  }

  // Fold exact numeric powers: Power(2, 3) → 8, Power(1/2, 2) → 1/4
  // Only when both base and exponent are exact, and exponent is a real
  // integer (a pure-imaginary exponent like `i` has re = 0, which must NOT
  // fold as a^0)
  if (isNumber(a) && isNumber(b) && b.isExact && !b.isComplex) {
    // `realExponentValue`, not `b.re`: the double of an exact non-integer
    // rational can be an integer (`(10^{400}+1)/10^{400}` projects to `1`).
    const e = realExponentValue(b);
    if (typeof e === 'number' && Number.isInteger(e) && Math.abs(e) <= 64) {
      const n = a.numericValue;
      if (typeof n === 'number') {
        const result = Math.pow(n, e);
        if (Number.isSafeInteger(result)) return ce.number(result);
      } else if (n.isExact) {
        // Compute the exact power with bigints (not `n.pow(e)`, whose
        // ExactNumericValue guard floats — and rounds — a base larger than
        // SMALL_INTEGER, e.g. `(2^127)^2`). Falls through if the result is too
        // large to materialize (magnitude guard).
        const folded = exactIntegerPow(a, e);
        if (folded !== undefined) return folded;
      }
    }
  }

  return unchanged();
}

export function canonicalRoot(
  a: Expression,
  b: Expression | number
): Expression {
  const ce = a.engine;
  let exp: number | undefined = undefined;
  if (typeof b === 'number') exp = b;
  else {
    // `realExponentValue` is `undefined` for an exact non-integer index whose
    // double is an integer (`(10^{400}+1)/10^{400}` projects to `1`); the
    // exact rational index is then handled by the `p/q` rewrite below.
    if (isNumber(b) && !b.isComplex) exp = realExponentValue(b);
  }

  if (exp === 1) return a;
  if (exp === 2) {
    if (isNumber(a) && a.type.matches('rational')) {
      if (a.re < SMALL_INTEGER) {
        const v = a.sqrt();
        if (isNumber(v)) {
          if (typeof v.numericValue === 'number') return v;
          if (v.numericValue.isExact) return v;
        }
      }
    }
    return ce._fn('Sqrt', [a], { canonical: a.isCanonical || a.isStructural });
  }

  // Exact NON-INTEGER rational radicand with an integer index ≥ 3: extract
  // perfect `exp`-th power factors from the numerator and denominator
  // independently, the general-index analog of the square-root reduction
  // above (8/9 → (2/3)√2). e.g. (1029/1000)^(1/3) = (7/10)·3^(1/3) since
  // 1029 = 3·7³ and 1000 = 10³. The denominator is not rationalized, so a
  // radicand with no extractable factor (e.g. (1/2)^(1/3)) is left as a Root.
  // Integer radicands are intentionally excluded here: like the higher
  // integer roots (Root(8,3), root6(997³)) they stay symbolic at
  // canonicalization and only reduce under evaluate(), a convention this
  // preserves. Factoring effort is bounded by SMALL_INTEGER (and by
  // canonicalInteger, which declines to factor magnitudes ≥ MAX_SAFE_INTEGER).
  if (
    exp !== undefined &&
    Number.isInteger(exp) &&
    exp >= 3 &&
    isNumber(a) &&
    a.isPositive === true &&
    a.type.matches('rational') &&
    !a.type.matches('integer')
  ) {
    const rad = asRational(a);
    if (rad !== undefined) {
      const [num, den] = rad;
      const numAbs = Math.abs(Number(num));
      const denAbs = Math.abs(Number(den));
      if (numAbs < SMALL_INTEGER && denAbs < SMALL_INTEGER) {
        const [factor, radicand] = reduceRationalRoot(rad, exp);
        const factorExpr = ce.number(factor);
        if (!factorExpr.isSame(1)) {
          const radExpr = ce.number(radicand);
          const rootExpr = radExpr.isSame(1)
            ? ce.One
            : ce._fn('Root', [radExpr, ce.number(exp)], { canonical: true });
          return ce.function('Multiply', [factorExpr, rootExpr]);
        }
      }
    }
  }

  // A negative root index denotes a reciprocal. Normalize to the
  // reciprocal-of-(positive-index)-root form so a negative-index root
  // (`Root(a, -n)`, which serializes as the nonstandard, unparseable
  // `\sqrt[-n]{a}`) is never produced — uniform with `x^{-1/2} → 1/√x` (#13).
  if (exp !== undefined && exp < 0 && Number.isInteger(exp))
    return ce._fn('Divide', [ce.One, canonicalRoot(a, -exp)]);

  // An exact NON-INTEGER rational index `p/q` is the power `a^(q/p)`
  // (`Root(a, b)` is `Power(a, 1/b)` at every point, ruled 2026-09-01):
  // `Root(2, 1/2) = 2^2 = 4`, `Root(8, 2/3) = 8^(3/2)`. Only a canonical
  // radicand takes the rewrite — `canonicalPower` builds canonical
  // structure.
  if (
    typeof b !== 'number' &&
    isNumber(b) &&
    !b.isComplex &&
    (exp === undefined || !Number.isInteger(exp)) &&
    (a.isCanonical || a.isStructural)
  ) {
    const r = asRational(b);
    if (r !== undefined && r[0] !== 0)
      return canonicalPower(a, ce.number([r[1], r[0]] as Rational));
  }

  return ce._fn('Root', [a, typeof b === 'number' ? ce.number(b) : b], {
    canonical:
      (a.isCanonical || a.isStructural) &&
      (typeof b === 'number' || b.isCanonical || b.isStructural),
  });
}

// Maximum number of decimal digits allowed in a *materialized* exact
// integer/rational power. Beyond this the power is kept symbolic (an inert
// `Power` node) instead of being computed: a multi-million-digit integer is
// pathological to build and to serialize, and `.N()` still yields the float /
// overflow-to-infinity. `Power(2, 1e15)` (≈ 3·10^14 digits) is well past this.
const MAX_EXACT_POW_DIGITS = 1_000_000;

/** (Rough upper bound on) the decimal digit count of an integer value. */
function integerDigitCount(v: bigint | number): number {
  if (typeof v === 'bigint') return (v < 0n ? -v : v).toString().length;
  if (!Number.isFinite(v)) return Infinity;
  const a = Math.abs(v);
  return a < 1 ? 1 : Math.floor(Math.log10(a)) + 1;
}

/** The base-10 logarithm of `|v|` for an integer `v`, `-Infinity` for `0`.
 * A bigint beyond the double range is read through its decimal digits, so
 * the result stays finite for any finite integer. */
function log10OfInteger(v: bigint | number): number {
  if (typeof v === 'number') return Math.log10(Math.abs(v));
  const s = (v < 0n ? -v : v).toString();
  if (s.length <= 15) return Math.log10(Number(s));
  return s.length - 1 + Math.log10(Number(s.slice(0, 15)) / 1e14);
}

/** The base-10 logarithm of the modulus of an exact complex value, computed
 * from its exact components (`rational·√radical` for each part), so that it
 * is correct for components that underflow or overflow a double.
 * `-Infinity` for zero. */
function exactLog10Modulus(v: ExactNumericValue): number {
  const part = (r: Rational, radical: number): number =>
    log10OfInteger(r[0]) - log10OfInteger(r[1]) + 0.5 * Math.log10(radical);
  const a = part(v.rational, v.radical);
  const b = part(v.imRational, v.imRadical);
  const m = Math.max(a, b);
  const n = Math.min(a, b);
  if (m === -Infinity) return -Infinity;
  // The modulus is sqrt(10^{2m} + 10^{2n}); this is its base-10 logarithm.
  return m + 0.5 * Math.log10(1 + 10 ** (2 * (n - m)));
}

/**
 * `x^e` for an integer exponent `e` and an EXACT base `x`, computed exactly:
 *  - integer / rational base → exact bigint rational power;
 *  - complex base (an exact Gaussian rational / pure-imaginary radical, or a
 *    Gaussian-integer literal from the inexact lane) → `ExactNumericValue.pow`
 *    (exact binary powering of the components — no `exp`/`ln` round-trip, so
 *    no float residue: `(1+i)^2 = 2i`, `(2+i)^3 = 2+11i`; a negative exponent
 *    yields an exact Gaussian rational, e.g. `(1+i)^-2 = -i/2`);
 *  - radical base (a/b·√c)   → `ExactNumericValue.pow` (exact for these).
 *
 * Returns `undefined` when the exact result would exceed the digit magnitude
 * guard (huge power) or is not representable — the caller then keeps the
 * power symbolic. Never returns a rounded / float-residue value.
 */
function exactIntegerPow(x: Expression, e: number): Expression | undefined {
  const ce = x.engine;
  if (!isNumber(x) || !Number.isSafeInteger(e)) return undefined;

  //
  // Complex base: an exact complex value, or a machine/big Gaussian integer
  //
  if (x.isComplex) {
    const nv = x.numericValue;
    if (typeof nv === 'number') return undefined; // a JS number is never complex
    let exact: ExactNumericValue | undefined;
    if (nv instanceof ExactNumericValue) exact = nv;
    else if (isGaussianInteger(nv))
      // A Gaussian-integer literal from the inexact lane is exactly
      // representable: lift it so the powering is exact (WP-2.16)
      exact = ce._numericValue({
        rational: [nv.re, 1],
        imRational: [nv.im, 1],
      }) as ExactNumericValue;
    if (exact === undefined) return undefined;

    // Magnitude guard: |z^e| = |z|^e — keep pathological powers symbolic
    // rather than materializing huge exact components. The modulus is read
    // from the exact components, not from the doubles `re` and `im`: those
    // are `0` or `Infinity` for a component beyond the double range
    // (`10^{-800}i`), and their squares underflow sooner (`10^{-200}i`). A
    // result with very many digits in its DENOMINATOR (a tiny modulus to a
    // large power) is as costly as one with a huge numerator, so the guard
    // bounds the digit count on both sides.
    const magLog10 = Math.abs(e) * exactLog10Modulus(exact);
    if (!Number.isFinite(magLog10) || Math.abs(magLog10) > MAX_EXACT_POW_DIGITS)
      return undefined;

    const v = exact.pow(e);
    // `pow` falls back to the float lane when the result leaves the exact
    // representable set — keep the power symbolic in that case. A float
    // result whose value is an integer reports `isExact` too, so the test is
    // on the class, not on that flag.
    if (v instanceof ExactNumericValue && !v.isNaN) return ce.number(v);
    return undefined;
  }

  //
  // Real exact base
  //
  const nv = x.numericValue;
  const exact =
    typeof nv === 'number' ? ce._numericValue(nv) : (nv.asExact ?? nv);
  if (!(exact instanceof ExactNumericValue)) return undefined;
  if (exact.isNaN || exact.isPositiveInfinity || exact.isNegativeInfinity)
    return undefined;

  const [num, den] = exact.rational;
  const radical = exact.radical;

  // Magnitude guard on the (approximate) result digit count. Include the
  // radical so a huge exponent can't blow up the internal `radical^e`
  // computation inside `ExactNumericValue.pow` (e.g. `Sqrt(2)^1e15`).
  const baseDigits = Math.max(
    integerDigitCount(num),
    integerDigitCount(den),
    integerDigitCount(radical)
  );
  if (baseDigits * Math.abs(e) > MAX_EXACT_POW_DIGITS) return undefined;

  // Pure integer or rational base: exact bigint power (`bigint ** bigint`
  // carries the sign, e.g. (−2)^3 = −8; `ce.number` normalizes the rational).
  if (radical === 1) {
    const absE = BigInt(Math.abs(e));
    const numB = BigInt(num);
    const denB = BigInt(den);
    const [rn, rd] =
      e >= 0 ? [numB ** absE, denB ** absE] : [denB ** absE, numB ** absE];
    return rd === 1n ? ce.number(rn) : ce.number([rn, rd] as Rational);
  }

  // Radical base: `ExactNumericValue.pow` is exact here, and the guard above
  // bounds the exponent so the internal computation can't explode.
  return ce.number(exact.pow(e));
}

/**
 * The exact rational a RAW exponent carries, following one symbol binding.
 *
 * `asRational` reads a number LITERAL, so `(-2)^u` with `u := 1000003/1000001`
 * had no provenance at all and decided its branch from the double, where the
 * same exponent written inline decided it from the exact terms — the two
 * disagreeing about whether the value is real. Reading the symbol's binding
 * closes that gap: `.value` resolves the binding without evaluating anything
 * (it is the stored expression, guarded against self-reference), so this stays
 * safe to call from inside the `Power` handler.
 *
 * Deliberately NOT recursive and deliberately not an evaluation: an arbitrary
 * `op2` (a lambda parameter, a `When`, a `Sum` body) keeps the float
 * reconstruction. Evaluating it here would re-enter the engine's hottest
 * operator.
 */
function rawRational(exp: Expression): Rational | undefined {
  const direct = asRational(exp);
  if (direct !== undefined) return direct;
  if (!isSymbol(exp)) return undefined;
  const value = exp.value;
  if (value === undefined || value === exp) return undefined;
  return asRational(value);
}

/**
 * When `theta` is `c·π` with `c` a float literal whose value is a multiple
 * of `1/2`, the quarter-turn `k` (0..3) such that `e^{iθ}` is `i^k`.
 * `undefined` for any other angle.
 */
function eulerQuarterTurn(theta: Expression): number | undefined {
  if (!isFunction(theta, 'Multiply') || theta.nops !== 2) return undefined;
  const [c, pi] = theta.ops;
  if (!isSymbol(pi, 'Pi')) return undefined;
  if (!isNumber(c) || c.isExact || c.isComplex) return undefined;
  const twice = (c.bignumRe ?? new BigDecimal(c.re)).mul(2);
  if (!twice.isFinite() || !twice.isInteger()) return undefined;
  return Number(((twice.toBigInt() % 4n) + 4n) % 4n);
}

/**
 * `e^{a + iθ}` as `e^a · (cos θ + i·sin θ)`, when the exponent is a sum of
 * real constant terms (the sum `a`) and terms with an imaginary factor
 * (the sum `iθ`), and `e^{iθ}` has an exact closed form: `e^{1 + iπ}` is
 * `-e`, `e^{1 + 0.5iπ}` is `e·i`. Return `undefined` otherwise — a
 * symbolic real part (`e^{x + iπ}`), or an angle that the Euler branch of
 * `pow()` does not reduce to an exact value (`e^{1 + 0.3iπ}`), keeps the
 * existing evaluation of the power.
 *
 * The angle `θ` is evaluated by `pow(e, iθ)`, so a float multiple of a
 * quarter-turn (`0.5·π`) is recognized as it is for a purely imaginary
 * exponent (`eulerQuarterTurn`).
 */
function eulerSplit(
  exp: number | Expression,
  numericApproximation: boolean
): Expression | undefined {
  if (typeof exp === 'number' || !isFunction(exp, 'Add')) return undefined;
  const ce = exp.engine;
  const realTerms: Expression[] = [];
  const imagFactors: Expression[] = [];
  for (const op of exp.ops) {
    const factor = getImaginaryFactor(op);
    if (factor !== undefined) imagFactors.push(factor);
    else if (op.type.matches('real') && op.unknowns.length === 0)
      // The term comes from the RAW exponent (read for its structure), so a
      // symbol that holds a value is still the symbol: evaluate it, or
      // `e^{x + iπ}` with `x := 2` would answer `-(e^x)` instead of `-e^2`.
      realTerms.push(op.evaluate({ numericApproximation }));
    else return undefined;
  }
  if (realTerms.length === 0 || imagFactors.length === 0) return undefined;

  const theta =
    imagFactors.length === 1 ? imagFactors[0] : ce.function('Add', imagFactors);
  const iTheta = ce.function('Multiply', [ce.I, theta]);
  // The angle is given to `pow()` as its raw exponent too, so that its
  // structure (`0.5·π`) is read before any numeric evaluation.
  const euler = pow(ce.E, iTheta, {
    numericApproximation,
    rawExponent: iTheta,
  });
  // Only an exact closed form is adopted: a float or an unreduced power
  // in `e^{iθ}` gains nothing over the evaluation of the whole power.
  if (
    hasInexactLiteral(euler) ||
    isFunction(euler, 'Power') ||
    isFunction(euler, 'Exp')
  )
    return undefined;

  const real =
    realTerms.length === 1 ? realTerms[0] : ce.function('Add', realTerms);
  const magnitude = pow(ce.E, real, { numericApproximation });
  // Assemble with the canonical constructor: the `.mul()` method folds
  // exact literals to machine floats.
  const result = ce.function('Multiply', [magnitude, euler]);
  return numericApproximation ? result.N() : result;
}

/**
 * The numeric value of `e^{iθ}` or `e^{a + iθ}` when the imaginary term `θ`
 * is an EXACT rational multiple of π (`π`, `2π/3`, `10^{20}π`), by Euler's
 * formula `e^a·(cos θ + i·sin θ)`, with `cos θ` and `sin θ` computed from
 * the exact angle in half-turns (`exactUnitCircle`,
 * `boxed-expression/trigonometry.ts`): `e^{iπ}` is `−1`, `e^{2iπ/3}` is
 * `−0.5 + 0.866i` and `e^{i·10^{20}π}` is `1`, at every precision and in
 * every angular unit (the exponent of `e` is in radians). With the double
 * nearest to `θ`, the polar form leaves roundoff in a part whose value is
 * `0` or an exact rational (`e^{iπ}` was `−1 + 1.2·10⁻¹⁶i`). `raw` is the
 * exponent before its numeric evaluation. Returns `undefined` for any other
 * exponent: a float angle (`e^{3.14159i}`) is the value at that float.
 */
function exactEulerN(raw: Expression): Expression | undefined {
  if (!(raw.isCanonical || raw.isStructural)) return undefined;
  const ce = raw.engine;
  const real: Expression[] = [];
  const imaginary: Expression[] = [];
  for (const term of isFunction(raw, 'Add') ? raw.ops : [raw]) {
    const factor = getImaginaryFactor(term);
    if (factor !== undefined) imaginary.push(factor);
    else if (term.unknowns.length === 0 && term.type.matches('real'))
      real.push(term);
    else return undefined;
  }
  if (imaginary.length === 0) return undefined;
  const theta =
    imaginary.length === 1 ? imaginary[0] : ce.function('Add', imaginary);
  const euler = exactUnitCircle(theta);
  if (euler === undefined || !isNumber(euler)) return undefined;
  if (real.length === 0) return euler;
  const magnitude = ce
    .function('Exp', [real.length === 1 ? real[0] : ce.function('Add', real)])
    .N();
  if (!isNumber(magnitude)) return undefined;
  const m = magnitude.numericValue;
  const e = euler.numericValue;
  return ce.number(
    (typeof m === 'number' ? ce._inexactNumericValue(m) : m).mul(
      typeof e === 'number' ? ce._inexactNumericValue(e) : e
    )
  );
}

/** Whether `x` holds a float (an inexact number literal) at any depth. */
function hasInexactLiteral(x: Expression): boolean {
  if (isNumber(x)) return !x.isExact;
  if (isFunction(x)) return x.ops.some(hasInexactLiteral);
  return false;
}

/**
 * The numeric value of `x^exp` for a complex base or a complex exponent,
 * computed with the complex kernel.
 *
 * The kernel (`complexPow()`) gives an exact `0` for a part whose value is
 * `0` (`(1 + i)^{2.0}` is `2i`, `i^{2.0}` is `-1`), so no part is removed,
 * and a small part of a float input is kept: `2^{10^{-100}i}` is
 * `1 + 6.93·10^{-101}i`, and `e^{3.141592653589793i}` is
 * `-1 + 1.22·10^{-16}i`, the value at that double. An exact multiple of π
 * in an exponent of `e` is reduced exactly before this (`exactEulerN`).
 */
function complexPowN(
  x: Expression & NumberLiteralInterface,
  exp: number | (Expression & NumberLiteralInterface)
): Expression | undefined {
  const ce = x.engine;
  const [expRe, expIm] = typeof exp === 'number' ? [exp, 0] : [exp.re, exp.im];
  // A NaN operand propagates.
  if ([x.re, x.im, expRe, expIm].some((v) => Number.isNaN(v))) return ce.NaN;
  // A zero base: 0^w is 0 when the real part of w is positive. Otherwise it
  // has no value (a pole or an undefined point), so the result is NaN, and
  // the polar form below must not run (ln 0 is -∞). The test reads the
  // numeric value, not the double projections `re` and `im`: a base whose
  // big-decimal parts are too small for a double (`10^{-800}(1+i)`) has
  // double projections `0` and `0`, but it is not zero.
  const baseValue = x.numericValue;
  if (typeof baseValue === 'number' ? baseValue === 0 : baseValue.isZero)
    return expRe > 0 ? ce.Zero : ce.NaN;
  // Above machine precision, the big-decimal power computes both parts at
  // the working precision. The double kernel below is used otherwise.
  const viaNumericValue = complexNumericValueRoute(
    ce,
    [x, typeof exp === 'number' ? ce.number(exp) : exp],
    (base, exponent) => base.pow(exponent)
  );
  if (viaNumericValue !== undefined) return viaNumericValue;
  let z: { re: number; im: number } = complexPow(
    ce.complex(x.re, x.im),
    ce.complex(expRe, expIm)
  );
  // The complex kernel can give a NaN part for finite operands when an
  // intermediate value overflows or underflows: `(10^{-200} + 10^{-200}i)^{-0.5}`
  // and `(10^{300} + 10^{300}i)^{0.3}` give `NaN + NaN·i`. Then compute the
  // power again in polar form, z^w = e^{w·ln z} with
  // ln z = ln|z| + i·arg(z). ln|z| is computed as
  // ln(m) + ½·ln(1 + (n/m)²), where m and n are the larger and the smaller
  // of |re| and |im|, so that |z| itself is never formed: it can be above the
  // largest double for finite parts (`1.5e308 + 1.5e308i`).
  if (Number.isNaN(z.re) || Number.isNaN(z.im)) {
    const m = Math.max(Math.abs(x.re), Math.abs(x.im));
    const n = Math.min(Math.abs(x.re), Math.abs(x.im));
    const lnModulus = Math.log(m) + 0.5 * Math.log1p((n / m) ** 2);
    const argument = Math.atan2(x.im, x.re);
    const magnitude = Math.exp(expRe * lnModulus - expIm * argument);
    const angle = expIm * lnModulus + expRe * argument;
    z = {
      re: magnitude * Math.cos(angle),
      im: magnitude * Math.sin(angle),
    };
  }
  // When the polar form also gives a NaN part, the angle is not known (an
  // infinite ln|z| times a nonzero imaginary exponent, or an angle that
  // overflows). The magnitude can still decide the answer: 0 when it
  // underflows, the complex infinity when it overflows. Otherwise the result
  // is undefined, and the caller uses the exact or symbolic power.
  if (Number.isNaN(z.re) || Number.isNaN(z.im)) {
    const m = Math.max(Math.abs(x.re), Math.abs(x.im));
    const n = Math.min(Math.abs(x.re), Math.abs(x.im));
    const lnModulus =
      m === Infinity ? Infinity : Math.log(m) + 0.5 * Math.log1p((n / m) ** 2);
    const lnMagnitude = expRe * lnModulus - expIm * Math.atan2(x.im, x.re);
    if (lnMagnitude === -Infinity || Math.exp(lnMagnitude) === 0)
      return ce.Zero;
    if (lnMagnitude === Infinity || Math.exp(lnMagnitude) === Infinity)
      return ce.ComplexInfinity;
    return undefined;
  }
  // A float operand makes the result a float (`i^{2.0}` is the float `-1`).
  return boxComplexKernelResult(
    ce,
    z,
    typeof exp === 'number' ? [x] : [x, exp]
  );
}

/**
 * The power function.
 *
 * It follows the same conventions as SymPy, which do not always
 * conform to IEEE 754 floating point arithmetic.
 *
 * See https://docs.sympy.org/latest/modules/core.html#sympy.core.power.Pow
 *
 */
export function pow(
  x: Expression,
  exp: number | Expression,
  {
    numericApproximation,
    rawExponent,
  }: {
    numericApproximation: boolean;
    /**
     * The RAW (pre-numericization) exponent of the `Power` node being
     * evaluated, when the caller has it — `options.expression.op2` in an
     * `evaluate` handler.
     *
     * Under `.N()` the `exp` argument arrives already numericized, so the
     * exponent's exact rational terms — which decide the branch of a negative
     * base — have been destroyed and can only be GUESSED back from the double.
     * `realPowerBranchTerms` does guess, but only within a bounded
     * coincidence budget, so a large-termed `p/q` (`1000003/1000001`) is
     * declined and takes the complex branch while the type handler and the
     * compiled constant fold — both of which still hold the exact rational —
     * say real. Passing the raw exponent restores that provenance and the
     * three agree for ANY term size.
     *
     * Only ever an addition to what is known: a caller without one, or a raw
     * exponent with no exact rational (a float, `Pi`, `Ln(2)`), falls back to
     * the reconstruction unchanged.
     */
    rawExponent?: Expression;
  }
): Expression {
  if (
    !(x.isCanonical || x.isStructural) ||
    (typeof exp !== 'number' && !(exp.isCanonical || exp.isStructural))
  )
    return x.engine._fn('Power', [x, x.engine.expr(exp)], { canonical: false });

  // A power with an `Indeterminate` operand is `Indeterminate` unless the
  // other operand is inexact (`nanOperandAnswer()`), and `NaN` under a
  // numeric approximation. The numeric kernels below would answer the `NaN`
  // literal.
  if (
    (isNumber(x) && x.isIndeterminate) ||
    (typeof exp !== 'number' && isNumber(exp) && exp.isIndeterminate)
  )
    return numericApproximation
      ? x.engine.NaN
      : nanOperandAnswer(x.engine, [x, x.engine.expr(exp)]);

  //
  // If a numeric approximation is requested, we try to evaluate the expression
  //
  if (numericApproximation) {
    // 0^0 is indeterminate → NaN, matching the exact canonical fold
    // (`canonicalPower` returns NaN for a literal 0^0). Under `.N()` a
    // value-bound-symbol base/exponent (x=0, y=0) is pre-numericized to
    // literal 0 before reaching here, where the machine/bignum path would
    // otherwise return `Math.pow(0, 0) = 1` — diverging from both the literal
    // and the symbolic `evaluate()` result. (CORRECTNESS_FINDINGS #30.)
    if (
      isNumber(x) &&
      x.isSame(0) &&
      ((typeof exp === 'number' && exp === 0) ||
        (typeof exp !== 'number' && isNumber(exp) && exp.isSame(0)))
    )
      return x.engine.NaN;

    if (isNumber(x)) {
      // e^exp, fast path. Exp(x) canonicalizes to Power(E, x), and under N()
      // the E base is numericized to e *before* reaching pow(). Evaluating
      // e^exp through the generic base.pow(exp) = exp(exp·ln(base)) would
      // recompute ln(e) ≈ 1 — a full high-precision logarithm — on every call,
      // which is the bulk of Exp(x).N()'s cost at high precision. The base is
      // the interned numeric value of the E constant, so an O(1) reference
      // check against the cached `E.N()` detects it; compute exp(exp) directly.
      // At machine precision the generic path would cost the same, one
      // `Math.pow(e, x)`, but it is the wrong primitive for two reasons.
      // `evaluate()` of the same power computes `Math.exp(x)` (the base is
      // still the symbol there), and the two differ by one unit in the last
      // place on about one input in ten, so `Exp(1.1).N()` was not
      // `Exp(1.1).evaluate()`. And `Math.pow` is the one `Math` function
      // whose results changed between V8 12 (Node 22) and V8 14 (Node 26),
      // where `Math.exp` answers the same bits on both. (A complex exponent
      // falls through to the e^(a+bi) handling below.)
      // The test on the value comes first because it is two comparisons of
      // doubles, where reading `E.N()` resolves a symbol: every numeric power
      // passes here, and nearly none has the base `e`.
      const ce = x.engine;
      // `e^{iθ}` and `e^{a + iθ}` with `θ` an EXACT rational multiple of π
      // (`exactEulerN`). The raw exponent is read, since `exp` has been
      // numericized by now and holds the double nearest to `θ`.
      if (
        x.re > 2.718 &&
        x.re < 2.719 &&
        x === ce.E.N() &&
        rawExponent !== undefined
      ) {
        const euler = exactEulerN(rawExponent);
        if (euler !== undefined) return euler;
      }
      if (x.re > 2.718 && x.re < 2.719 && x === ce.E.N()) {
        if (typeof exp === 'number')
          return ce.number(ce._numericValue(exp).exp());
        if (isNumber(exp) && !exp.isComplex)
          return ce.number(ce._numericValue(exp.numericValue).exp());
      }

      // Negative real base with a non-integer real exponent. `Math.pow` (and
      // the bignum path) return NaN here, so compute the value explicitly. We
      // honor CE's branch conventions: an exact rational p/q with an *odd*
      // denominator uses the real root (e.g. (-8)^{2/3} = 4, (-8)^{5/3} = -32),
      // matching `Root(-8, 3) = -2`; everything else (even denominator, or an
      // inexact exponent) takes the principal complex value, x = |x|·e^{iπ},
      // so (x^e) = |x|^e·e^{iπe} (e.g. (-4)^{3/2} = -8i, consistent with
      // Sqrt(-4) = 2i). Unit fractions never reach here — they canonicalize to
      // Sqrt/Root, which already handle negative radicands.
      {
        const eVal =
          typeof exp === 'number'
            ? exp
            : isNumber(exp) && !exp.isComplex
              ? exp.re
              : undefined;
        const negativeBase =
          x.isNegative === true && !x.isComplex && eVal !== undefined;
        // Recover the exponent's rational p/q — from its EXACT terms when it
        // still has them, otherwise from the float. Under .N() the `exp`
        // argument reaches here already numericized, so the exact terms come
        // from the RAW exponent the caller threaded through (`rawExponent`,
        // the node's own `op2`); that is the same object the type handler and
        // the compiled constant fold read, so all three decide the same
        // branch for any term size. Only when there is no raw exponent — or
        // it is not an exact rational — does the float reconstruction decide,
        // and `realPowerBranchTerms` recovers the rational the double came
        // from within its coincidence budget.
        const rawExact =
          negativeBase && rawExponent !== undefined
            ? rawRational(rawExponent)
            : undefined;
        const exact = negativeBase
          ? (rawExact ??
            (typeof exp === 'number' ? undefined : asRational(exp)))
          : undefined;
        const terms = negativeBase
          ? realPowerBranchTerms(exact, eVal!)
          : undefined;
        // Integer-ness is a property of the exponent, not of the double it
        // numericized to: at precision 3 `6000001/2000000` numericizes to
        // EXACTLY 3, and reading the integer power off that double would take
        // the plain (real) integer power where the raw — even — denominator
        // says the value is complex. When the raw exponent is in hand its own
        // reduced denominator decides; a pure-float exponent has nothing but
        // the double, and keeps it.
        // The same holds for an exact exponent passed directly: the double
        // of `(10^{400}+1)/10^{400}` is `1`, but its denominator is not.
        const isIntegerExponent =
          exact !== undefined && terms !== undefined
            ? terms[1] === 1
            : Number.isInteger(eVal);
        if (negativeBase && !isIntegerExponent) {
          // |x|^e, computed on the positive base (no re-entry: base > 0).
          const absPow = pow(x.neg(), exp, { numericApproximation: true });
          if (terms !== undefined && terms[1] % 2 !== 0) {
            // Odd denominator: real root. Sign from the numerator's parity.
            return terms[0] % 2 !== 0 ? absPow.neg() : absPow;
          }
          // Even denominator or inexact exponent: principal complex value.
          // The phase cos(eπ) is computed at working precision: a machine
          // cos here would pollute the full-precision magnitude when they
          // are multiplied (Power(-4,0.25).N() at precision 50 printed 50+
          // digits with garbage past digit 16). The imaginary part is a
          // machine double by representation, so machine sin is enough.
          const angle = eVal * Math.PI;
          const reBig = new BigDecimal(eVal)
            .mul(BigDecimal.PI)
            .cos()
            .toPrecision(BigDecimal.precision);
          let re: BigDecimal | number = reBig;
          let im = Math.sin(angle);
          // Snap the phase's exact zeros (e.g. half-integer e ⇒ ±i) so the
          // result is clean: cos/sin of pπ/q is exactly 0 only at odd
          // multiples of π/2, never merely small for a genuine value.
          if (Math.abs(reBig.toNumber()) < 1e-12) re = 0;
          if (Math.abs(im) < 1e-12) im = 0;
          // Form magnitude·phase manually, rounding the real product back to
          // working precision: `BigDecimal.mul` is exact, so the product of
          // two P-digit values carries 2P digits — the tail beyond P is
          // noise and must not be asserted.
          const magNV = numericValue(absPow);
          if (
            magNV !== null &&
            magNV !== undefined &&
            typeof magNV !== 'number' &&
            !magNV.isComplex &&
            magNV.bignumRe !== undefined
          ) {
            const magBig = magNV.bignumRe;
            return ce.number(
              ce._numericValue({
                re:
                  re === 0
                    ? 0
                    : magBig._mulToPrecision(reBig, BigDecimal.precision),
                im: im === 0 ? 0 : magNV.re * im,
              })
            );
          }
          return absPow.mul(ce.number(ce._numericValue({ re, im })));
        }
      }

      // A complex base or a complex exponent: use `complexPowN()`, not
      // `apply2()`. It gives a zero base its value (0 or NaN), and it
      // computes the power again in polar form when the complex kernel gives
      // a NaN part for finite operands. When it cannot give a value (it
      // returns undefined), the result is the exact or symbolic power.
      if (typeof exp === 'number') {
        if (x.isComplex)
          return (
            complexPowN(x, exp) ?? pow(x, exp, { numericApproximation: false })
          );
      } else if (isNumber(exp) && (x.isComplex || exp.isComplex))
        return (
          complexPowN(x, exp) ?? pow(x, exp, { numericApproximation: false })
        );

      if (typeof exp === 'number') {
        return (
          apply(
            x,
            (x) => Math.pow(x, exp as number),
            (x) => x.pow(exp as number),
            (x) => x.pow(exp as number)
          ) ?? pow(x, exp, { numericApproximation: false })
        );
      } else if (isNumber(exp))
        return (
          apply2(
            x,
            exp,
            (x, exp) => Math.pow(x, exp),
            (x, exp) => x.pow(exp),
            (x, exp) => x.pow(exp)
          ) ?? pow(x, exp, { numericApproximation: false })
        );
    }
  }

  const ce = x.engine;

  if (typeof exp !== 'number') exp = exp.canonical;

  // 'canonicalPower' deals with a set of basic operations.
  // If the result is not 'Power', can assume an op. has occurred
  // In some cases, an op. may apply, but a 'Power' expr. is still the result ('(a^b)^c -> a^(b*c)'
  // for instance). For these cases, proceed.
  const canonicalResult = canonicalPower(x, ce.expr(exp));
  if (canonicalResult.operator !== 'Power') return canonicalResult;

  const e =
    typeof exp === 'number'
      ? exp
      : isNumber(exp)
        ? realExponentValue(exp)
        : exp.im === 0
          ? exp.re
          : undefined;

  if (isSymbol(x, 'ExponentialE')) {
    // e^(ln(y)) = y. (Previously this only reduced because `ln(y)` of a
    // numeric `y` evaluated to a float and `e^float` was computed; now that
    // `ln(2)` stays the exact symbol `Ln(2)`, reduce the inverse pair here.)
    if (typeof exp !== 'number' && isFunction(exp, 'Ln')) return exp.op1;

    // Is the argument an imaginary or complex number?
    //
    // The imaginary factor is read from the RAW exponent first, when the
    // caller has it. The `Power` evaluate handler receives its exponent
    // already evaluated, and the evaluation of `0.5·i·π` is the machine
    // complex `1.5707963267948966i`: the cosine of that rounded angle is
    // `1.9e-17`, not `0`, and `e^{0.5iπ}` became `1.9e-17 + i`. The raw
    // exponent keeps the factor `0.5·π`, which is exactly a quarter-turn
    // (`eulerQuarterTurn` below).
    const rawFactor =
      rawExponent !== undefined &&
      (rawExponent.isCanonical || rawExponent.isStructural)
        ? getImaginaryFactor(rawExponent)
        : undefined;
    const imagFactor = rawFactor ?? getImaginaryFactor(exp);

    // A sum of a real constant and an imaginary term, `e^{a + iθ}`: split it
    // as `e^a · e^{iθ}` and evaluate `e^{iθ}` with the Euler branch below.
    // The evaluated exponent of `1 + 0.5·i·π` is the machine complex
    // `1 + 1.5707963267948966i`, and `e` to that power is
    // `5.2e-17 + 2.718i`; the raw exponent keeps the angle `0.5·π`, and the
    // split gives the exact `e·i`.
    if (imagFactor === undefined) {
      const split = eulerSplit(
        rawExponent !== undefined &&
          (rawExponent.isCanonical || rawExponent.isStructural)
          ? rawExponent
          : exp,
        numericApproximation
      );
      if (split !== undefined) return split;
    }

    if (imagFactor !== undefined) {
      // We have an expression of the form `e^(i theta)`, with `theta` in
      // radians.
      //
      // A float multiple of π whose double is a multiple of a quarter-turn
      // (`e^{0.5iπ}`) has the value `±1` or `±i`: the coefficient is known
      // exactly, and only the product with π would round.
      const cardinal = eulerQuarterTurn(imagFactor);
      if (cardinal !== undefined)
        return [ce.One, ce.I, ce.NegativeOne, ce.I.neg()][cardinal];
      // A float multiple of π that is a special angle (`0.25·π`: the float
      // `0.25` is within one unit in its last place of `1/4`) is read as
      // that exact angle, whatever the angular unit, and `e^{0.25iπ}` is
      // `√2/2 + √2/2·i`, as `e^{iπ/4}` is (user decision, 2026-09-27). The
      // exponent of `e` is in radians, so it is read in radians.
      let angle = imagFactor;
      let floatAngle = hasInexactLiteral(angle);
      if (floatAngle) {
        const turns = halfTurns(angle, 'rad');
        if (turns !== undefined) {
          // Reduce the number of half-turns modulo a full turn (`2·den`) as a
          // bigint, and keep the rational in bigints: a numerator above
          // 2^53 converted to a double loses its parity, and the parity
          // decides the sign of the value.
          const [num, den] = turns;
          let reduced = num % (2n * den);
          if (reduced < 0n) reduced += 2n * den;
          angle = ce.function('Multiply', [ce.number([reduced, den]), ce.Pi]);
          floatAngle = false;
        }
      }
      // `Cos` and `Sin` read their argument in the engine's angular unit, so
      // in another unit `theta` is converted to it. An exact angle is
      // converted exactly (`θ·halfTurn/π`: `π` is `180` in degrees), and
      // `Cos` and `Sin` find an exact value from its structure
      // (`halfTurns`). Any other angle with a float is converted
      // numerically, at the working precision (`radiansToAngle`): a
      // symbolic conversion of it could fold the float into an exact
      // integer. In radians the angle is passed as it is, and `Cos` and
      // `Sin` reduce and round an angle that is not special at the working
      // precision.
      const theta =
        ce.angularUnit === 'rad'
          ? angle
          : floatAngle
            ? angle.unknowns.length === 0
              ? radiansToAngle(angle.N())
              : undefined
            : ce.function('Divide', [
                ce.function('Multiply', [angle, halfTurnAngle(ce)]),
                ce.Pi,
              ]);
      // Euler's formula e^{iθ} = cos θ + i·sin θ — but only adopt it for a
      // CONSTANT angle (`e^{iπ/2}→i`, `e^{iπ}→-1`): there the trig reduces to a
      // closed-form value and this is a genuine evaluation. For a SYMBOLIC
      // angle (`e^{ix}`) the rewrite is just a basis change that discards the
      // compact exponential form and loses no information, so keep `e^{iθ}`
      // symbolic (convert on demand with `simplify({ strategy: 'trig' })`).
      // This also removes the inconsistency where `(e^{ix})^2` expanded (it
      // recurses here as `pow(e, 2ix)` with symbolic θ=2x) while `e^{ix}` did
      // not.
      if (theta !== undefined && theta.unknowns.length === 0) {
        // IMPORTANT: Use .evaluate() not .simplify() to avoid infinite
        // recursion when pow() is called from simplification rules.
        //
        // An angle with a float that is not a special angle gives a float,
        // in every unit. In degrees `radiansToAngle` can give an exact
        // integer (`0.35·π` is `63`), and `Cos(63)` stays symbolic under
        // `evaluate()`: `e^{0.35iπ}` was `cos(63) + i·sin(63)`.
        const cosVal = floatAngle
          ? ce.function('Cos', [theta]).N()
          : ce.function('Cos', [theta]).evaluate();
        const sinVal = floatAngle
          ? ce.function('Sin', [theta]).N()
          : ce.function('Sin', [theta]).evaluate();
        // Assemble with the non-folding canonical constructors: the `.add()`/
        // `.mul()` methods fold exact literals (e.g. 1/2, √3/2) to machine
        // floats, which would violate the evaluate-vs-N exactness contract.
        // Canonicalization folds the degenerate cases structurally
        // (`e^{iπ/2}→i`, `e^{iπ}→-1`).
        return ce.function('Add', [
          cosVal,
          ce.function('Multiply', [sinVal, ce.I]),
        ]);
      }
    } else if (numericApproximation) {
      // e^x = exp(x): evaluate exp directly. Going through e.pow(x) would
      // compute exp(x·ln(e)) — recomputing ln(e) ≈ 1, a full high-precision
      // logarithm per call. (Real exponents take the direct path; a general
      // complex exponent keeps the e.pow(x) path, unchanged.)
      if (typeof exp === 'number') {
        return ce.number(ce._numericValue(exp).exp());
      } else if (isNumber(exp)) {
        const xv = ce._numericValue(exp.numericValue);
        // A complex exponent above machine precision uses the big-decimal
        // `exp` too: `e` pre-rounded to the working precision and raised to
        // `z` loses a digit (`e^{1+2i}` at 50 digits was one unit off).
        if (!xv.isComplex || bignumPreferred(ce)) return ce.number(xv.exp());
        const eNv = numericValue(ce.E.N());
        if (eNv !== undefined) return ce.number(ce._numericValue(eNv).pow(xv));
      }
    }
  }

  // (a^b)^c -> a^(b*c) only when mathematically safe: base non-negative, or
  // outer exponent c integer. An odd inner exponent is NOT sufficient — see
  // the matching note in canonicalPower for why (principal-branch phase).
  if (isFunction(x, 'Power')) {
    const [base, power] = x.ops;
    const expExpr = typeof exp === 'number' ? ce.number(exp) : exp;
    const outerIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    const baseNonNeg = base.isNonNegative === true;

    if (baseNonNeg || outerIsInteger) {
      return pow(base, power.mul(expExpr), { numericApproximation });
    }
  }

  // (a/b)^c -> a^c / b^c
  // Only distribute when exponent is integer or both operands are non-negative
  if (isFunction(x, 'Divide')) {
    const [num, denom] = x.ops;
    const expIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    if (
      expIsInteger ||
      (num.isNonNegative === true && denom.isNonNegative === true)
    ) {
      return pow(num, exp, { numericApproximation }).div(
        pow(denom, exp, { numericApproximation })
      );
    }
  }

  if (isFunction(x, 'Negate')) {
    // (-x)^n = (-1)^n x^n — only valid when n is integer
    if (e !== undefined && Number.isInteger(e)) {
      if (e % 2 === 0) return pow(x.op1, exp, { numericApproximation });
      return pow(x.op1, exp, { numericApproximation }).neg();
    }
  }

  // (√a)^b -> a^(b/2) or √(a^b)
  if (isFunction(x, 'Sqrt')) {
    // (√a)^2 -> a (integer outer exponent, always safe)
    if (e === 2) return x.op1;
    // (√a)^{2k} -> a^k (even integer outer exponent, always safe)
    if (e !== undefined && e % 2 === 0) return x.op1.pow(e / 2);
    // (√a)^b -> √(a^b) — rearranges (a^{1/2})^b to (a^b)^{1/2},
    // only valid when a >= 0 (negative a changes sign under rearrangement)
    if (x.op1.isNonNegative === true)
      return pow(x.op1, exp, { numericApproximation }).sqrt();
  }

  // exp(a)^b -> e^(a*b)
  if (isFunction(x, 'Exp'))
    return pow(ce.E, x.op1.mul(exp), { numericApproximation });

  // (a*b)^c -> a^c * b^c — only valid when c is integer
  if (isFunction(x, 'Multiply')) {
    const expIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    if (expIsInteger) {
      const ops = x.ops.map((x) => pow(x, exp, { numericApproximation }));
      // return mul(...ops);  // don't call: infinite recursion
      return ce._fn('Multiply', ops);
    }
  }

  // a^(b/c) -> root(a, c)^b if b = 1 or c = 1
  if (typeof exp !== 'number' && isNumber(exp)) {
    const r = asRational(exp);
    if (r !== undefined && r[0] === 1)
      return root(x, ce.number(r[1]), { numericApproximation });
  }

  // (a^(1/b))^c -> a^(c/b) — combines exponents, only safe when
  // base is non-negative or outer exponent c is integer
  if (isFunction(x, 'Root')) {
    const [base, rootIdx] = x.ops;
    const expIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    if (base.isNonNegative === true || expIsInteger)
      return pow(base, ce.expr(exp).div(rootIdx), { numericApproximation });
  }

  //
  // We were not requested for a numeric approximation,
  // so we evaluate a numeric expression only if exact
  //
  if (isNumber(x) && Number.isInteger(e)) {
    // x^e with an integer exponent.
    //
    // An EXACT base (integer/rational/radical, or a Gaussian integer) must
    // yield an EXACT result — never a rounded bignum (`Power(2,127)`), a float
    // (`Power(2,-2)`), or a float residue (`(1+i)^2`). That's the exactness
    // contract: numericizing an exact argument is the `.N()` path's job.
    const isGaussianInt = x.isComplex && isGaussianIntegerValue(x.numericValue);
    if (x.isExact || isGaussianInt) {
      const exact = exactIntegerPow(x, e!);
      if (exact !== undefined) return exact;
      // The exact result is too large to materialize (magnitude guard) or is
      // not representable (e.g. a big/negative Gaussian power): keep the power
      // symbolic. `.N()` still produces the float / overflow-to-infinity.
      return ce._fn('Power', [x, ce.expr(exp)]);
    }

    // An inexact base (a float, or a non-Gaussian complex) numericizes — an
    // inexact argument is allowed to produce a float under `evaluate()`.
    const n = x.numericValue;
    if (typeof n === 'number') {
      return (
        apply(
          x,
          (x) => Math.pow(x, e as number),
          (x) => x.pow(e as number),
          (x) => x.pow(e as number)
        ) ?? ce._fn('Power', [x, ce.expr(exp)])
      );
    } else {
      return ce.number(n!.pow(e!));
    }
  }

  // Real base with an exact non-integer rational exponent p/q: reduce via the
  // root, x^{p/q} = root(x, q)^p, but only when root(x, q) is itself an exact
  // value (a perfect power) — otherwise the power stays symbolic (e.g.
  // 2^{2/3}). This extends the unit-fraction reduction (8^{1/3} = 2,
  // (-8)^{1/3} = -2) to non-unit numerators (8^{2/3} = 4, (-8)^{2/3} = 4,
  // (-8)^{5/3} = -32) and agrees with what N() computes. For a negative base
  // only an odd denominator is admitted: an even root is complex (e.g.
  // (-4)^{3/2} = -8i), whose exact value only arises through dusty complex
  // arithmetic, so it is left symbolic here and evaluated by N().
  if (isNumber(x) && !x.isComplex && typeof exp !== 'number' && isNumber(exp)) {
    const r = asRational(exp);
    if (r !== undefined) {
      const p = Number(r[0]);
      const q = Number(r[1]);
      const realRootExists = x.isNegative !== true || q % 2 !== 0;
      // A numerator or a denominator past the safe integers is rounded by
      // the conversion to a double: `(5·10^29 + 1)/10^30` became exactly
      // `1/2`, and `2^{1/2 + 10^-30}` evaluated to `√2`. Such an exponent
      // keeps the power symbolic.
      if (
        Number.isSafeInteger(p) &&
        Number.isSafeInteger(q) &&
        q > 1 &&
        realRootExists
      ) {
        // Normalize a positive perfect-power base before attempting the root:
        // `(m^k)^(p/q) -> m^(kp/q)`. This exposes a common base to product
        // tallying (`4^(2/3) -> 2^(4/3)`) without materializing a float.
        if (x.isPositive === true) {
          const decomposition = maximalPerfectPower(x.re);
          if (decomposition)
            return pow(
              ce.number(decomposition.base),
              ce.number([decomposition.exponent * p, q]),
              { numericApproximation: false }
            );

          // Extract the integer part of a positive improper exponent so like
          // radicals share the same proper fractional power:
          // `2^(4/3) -> 2 * 2^(1/3)`.
          if (p > q) {
            const whole = Math.floor(p / q);
            const remainder = p % q;
            const integerPart = pow(x, whole, {
              numericApproximation: false,
            });
            if (remainder === 0) return integerPart;
            return ce.function('Multiply', [
              integerPart,
              pow(x, ce.number([remainder, q]), {
                numericApproximation: false,
              }),
            ]);
          }
        }
        const rt = root(x, ce.number(q), { numericApproximation: false });
        if (isNumber(rt)) return pow(rt, p, { numericApproximation: false });
      }
    }
  }

  return ce._fn('Power', [x, ce.expr(exp)]);
}

/**
 * `Root(a, b)` at the points where one operand is NaN, infinite, or — for
 * the index — 0: `Root(a, b)` IS `Power(a, 1/b)` (ruled 2026-09-01), so
 * the value is `pow`'s at the exponent `1/b`, computed with the engine's
 * extended arithmetic (`1/±∞ = 1/~oo = 0`, `1/0 = ~oo`). Concretely:
 * `Root(2, ±∞) = 2^0 = 1`, `Root(0, ±∞) = 0^0 = NaN`, `Root(±∞, ±∞) =
 * NaN`, `Root(±∞, 3)` and `Root(~oo, 3)` follow `Power`'s infinite-base
 * arms (`−∞`, `~oo`), NaN propagates. An index of 0 is left alone: the
 * `Root` definition declares it a violated precondition (an Error), which
 * the dispatch gate answers before the handler runs.
 *
 * Returns `undefined` when no operand is at such a point.
 */
function rootAtExceptionalPoint(
  a: Expression,
  b: Expression
): Expression | undefined {
  const ce = a.engine;
  if (!isNumber(a) && !isNumber(b)) return undefined;
  if ((isNumber(a) && a.isNaN) || (isNumber(b) && b.isNaN))
    return nanOperandAnswer(ce, [a, b]);
  if (isNumber(b)) {
    if (b.isSame(0)) return undefined;
    if (b.isInfinity === true) {
      // The exponent `1/b` is 0: `a^0` is 1 for a finite non-zero base and
      // the indeterminate NaN for a zero or infinite one.
      if (!isNumber(a)) return undefined;
      if (a.isSame(0) || a.isInfinity === true)
        return indeterminateFormAnswer(ce, [a, b]);
      return ce.One;
    }
  }
  if (isNumber(a) && a.isInfinity === true && isNumber(b)) {
    // An infinite radicand with a finite non-zero index: `Power`'s
    // infinite-base arms decide (`(−∞)^(1/3) = −∞`, `(+∞)^(1/2) = +∞`,
    // `(~oo)^(1/n) = ~oo`, a negative index gives 0).
    // The canonical `Divide` keeps `1/b` exact (`1/3` stays a rational).
    return pow(a, ce.function('Divide', [ce.One, b]), {
      numericApproximation: false,
    });
  }
  return undefined;
}

export function root(
  a: Expression,
  b: Expression,
  { numericApproximation }: { numericApproximation: boolean }
): Expression {
  if (!(a.isCanonical || a.isStructural) || !(b.isCanonical || b.isStructural))
    return a.engine._fn('Root', [a, b], { canonical: false });

  const special = rootAtExceptionalPoint(a, b);
  if (special !== undefined) return special;

  if (numericApproximation) {
    if (isNumber(a) && isNumber(b)) {
      // (-x)^n = (-1)^n x^n
      const isNegative = a.isNegative;
      const isEven = b.isEven;
      if (isNegative && isEven) {
        // An even root of a negative real has no real value. Return the
        // complex principal root |a|^(1/n)·(cos(π/n) + i·sin(π/n)) — consistent
        // with `Sqrt(-4).N()` → 2i. (The old code returned the real root of
        // |a|, e.g. `Root(-16, 4).N()` → 2 instead of √2 + √2·i.)
        const n = b.re;
        const mod = Math.pow(-a.re, 1 / n);
        const angle = Math.PI / n;
        return a.engine.number(
          a.engine.complex(mod * Math.cos(angle), mod * Math.sin(angle))
        );
      }
      if (isNegative) a = a.neg();

      return (
        apply2(
          a,
          b,
          // Machine: Math.pow(a, 1/b) is not correctly rounded (e.g.
          // Math.pow(64, 1/3) = 3.999…6); use a Newton-corrected, snap-to-exact
          // n-th root instead. (NU-P1-7)
          (a, b) => {
            const result = machineNthRoot(a, b);
            if (isNegative && !isEven) return -result;
            return result;
          },
          // Bignum: `a.pow(b.pow(-1))` rounds the reciprocal 1/b to machine
          // precision before the power, so a perfect root printed 3.999…9.
          // `nthRoot` computes x^(1/n) directly and snaps perfect powers to the
          // exact integer. `nthRoot` is integer-degree only — a non-integer
          // degree (Root(2, 0.5)) falls back to the full-precision power.
          // (NU-P1-7)
          (a, b) => {
            const n = b.toNumber();
            const result = Number.isInteger(n)
              ? a.nthRoot(n)
              : a.pow(b.pow(-1));
            if (isNegative && !isEven) return result.neg();
            return result;
          },
          (a, b) => {
            const result = a.pow(typeof b === 'number' ? 1 / b : b.inverse());
            if (isNegative && !isEven) return result.neg();
            return result;
          },
          // A complex operand above machine precision: the big-decimal root
          // or power computes both parts at the working precision.
          (a, b) => {
            const result =
              !b.isComplex && Number.isInteger(b.re)
                ? a.root(b.re)
                : a.pow(b.inv());
            if (isNegative && !isEven) return result.neg();
            return result;
          }
        ) ?? root(a, b, { numericApproximation: false })
      );
    }
  }

  if (isNumber(a) && isNumber(b) && b.isInteger) {
    const e = typeof b === 'number' ? b : !b.isComplex ? b.re : undefined;

    // a^(1/b): evaluate if b is an integer and a is exact

    // An even root of a negative real has no real value, but a complex
    // principal value always exists (like Sqrt(-4) = 2i). Never assert a NaN
    // literal here — stay symbolic so N() can produce the complex root.
    // (`Root(-8,3)` = −2 is odd and still reduces below.) (NU-P1-8)
    // The index 4 is the exception: the principal fourth root of a negative
    // value is exact when it is a Gaussian value of the representable set
    // (`Root(-1, 4)` = (√2/2)(1 + i), `Root(-4, 4)` = 1 + i), which
    // `ExactNumericValue.root` decides. A result that is not exact is
    // rejected below, so the `Root` stays symbolic.
    const evenRootOfNegative =
      a.isNegative === true &&
      e !== undefined &&
      e > 0 &&
      e % 2 === 0 &&
      e !== 4;

    // @todo the result should always be exact if e is an integer
    if (e !== undefined && !evenRootOfNegative) {
      // Only an `ExactNumericValue` is an exact root. The root of an exact
      // value that is not a perfect power is a big float, and such a float
      // reports `isExact` when its value at the working precision is an
      // integer: `(1 + 10^-30)^(1/3)` at 21 digits is `1.000…` and was
      // answered as the exact integer `1`.
      const v =
        typeof a.numericValue === 'number'
          ? a.engine._numericValue(a.numericValue).root(e)
          : a.numericValue.asExact?.root(e);
      if (v instanceof ExactNumericValue && !v.isNaN) return a.engine.number(v);
    }

    // The radicand may be a perfect power whose structure was folded away at
    // canonicalization (997³ → 991026973): decompose n = m^k with the largest
    // k and reduce the exponent, root_e(m^k) = m^(k/e) — e.g.
    // root6(997³) = √997, root6(8) = √2, root6(4096) = 4. (Wester 26; the
    // structurally preserved (999983³)^(1/6) already reduces via the (x^a)^b
    // exponent rule, which this makes consistent.)
    if (
      e !== undefined &&
      Number.isInteger(e) &&
      e > 1 &&
      a.isPositive === true
    ) {
      // Read the radicand as an exact integer when it is one: a radicand
      // past the safe integers (`10^61`) has no exact double, but its
      // `ExactNumericValue` holds the exact bigint.
      const exact =
        typeof a.numericValue === 'number' ? undefined : a.numericValue.asExact;
      const n =
        exact instanceof ExactNumericValue &&
        exact.radical === 1 &&
        !exact.isComplex &&
        exact.rational[1] === 1n
          ? exact.rational[0]
          : a.re;
      if (typeof n === 'bigint' || (Number.isSafeInteger(n) && n > 1)) {
        const decomposition = maximalPerfectPower(n);
        if (decomposition) {
          // The base is not itself a perfect power (the exponent is maximal),
          // so the rational-exponent path in pow() terminates.
          return pow(
            a.engine.number(decomposition.base),
            a.engine.number([decomposition.exponent, e]),
            {
              numericApproximation: false,
            }
          );
        }
      }
    }
  }

  return a.engine._fn('Root', [a, b]);
}

/**
 * The number of significant digits that `realPowerBranchTerms` reads a float
 * exponent to: the global working precision (`BigDecimal.precision`), which
 * is what rounded the exponent, clamped to [15, 17] (a double never carries
 * more than 17 significant digits, and a precision configured below machine
 * precision must not widen the window). The compiled Python helper `_ce_pow`
 * is given this value when the code is generated.
 */
export function realPowerReconstructionDigits(): number {
  const precision = BigDecimal.precision;
  return Number.isFinite(precision)
    ? Math.max(15, Math.min(17, Math.trunc(precision)))
    : 17;
}
