import type { NumericPrimitiveType, Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { BigDecimal } from '../../big-decimal/index.js';
import type { Expression } from '../global-types.js';
import { SMALL_INTEGER, machineNthRoot } from '../numerics/numeric.js';
import {
  rationalize,
  reduceRationalRoot,
  reducedRational,
} from '../numerics/rationals.js';
import type { Rational } from '../numerics/types.js';

import { asRational } from './numerics.js';
import {
  bignumPreferred,
  canonicalAngle,
  getImaginaryFactor,
} from './utils.js';
import { apply, apply2 } from './apply.js';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';

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
    typeof x === 'bigint'
      ? x
      : Number.isSafeInteger(x)
        ? BigInt(x)
        : undefined;
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
  if (!isNumber(a) || a.im === 0) return undefined;
  if (!Number.isFinite(a.re) || !Number.isFinite(a.im)) {
    // The literal itself is finite — the caller handles infinite operands
    // — so a non-finite double read means an exact component OVERFLOWED
    // the double range: the modulus is far above 1.
    if (a.isFinite === true)
      return expPositive ? ce.ComplexInfinity : ce.Zero;
    return undefined;
  }
  const m2 = a.re * a.re + a.im * a.im;
  if (a.isExact) {
    const nv = a.numericValue;
    if (nv instanceof ExactNumericValue) {
      const t = exactModulusSquaredVsOne(nv);
      if (t === 0) return ce.NaN;
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
): { base: number; exponent: number } | undefined {
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
const COINCIDENCE_BUDGET = 1e-4;

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
  const precision = BigDecimal.precision;
  const digits = Number.isFinite(precision)
    ? Math.max(15, Math.min(17, Math.trunc(precision)))
    : 17;
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
    // 0^positive = 0, 0^negative = ComplexInfinity
    if (b.isPositive === true) return ce.Zero;
    if (b.isNegative === true) return ce.ComplexInfinity;
  }

  // 1^b = 1 for any finite exponent. This must precede the numeric-exponent
  // guard below: that guard bails on a symbolic or function exponent (e.g.
  // `1^(n+1)`), which would otherwise leave `1^(n+1)` un-reduced. A genuinely
  // infinite or NaN exponent (`1^∞`, `1^NaN`) is indeterminate and is
  // intentionally excluded — it has `isFinite === false` / `isNaN === true` and
  // falls through to the NaN handling further down. (Matches SymPy / Mathematica,
  // which both reduce `1^x → 1`.)
  if (isNumber(a) && a.isSame(1) && b.isFinite !== false && b.isNaN !== true)
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
    if (b.type.matches('imaginary' as NumericPrimitiveType) || b.isNaN)
      return ce.NaN;

    if (b.isSame(0)) return ce.NaN;

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
    // If 'isFinite' is a boolean, then 'a' has a value.
    if (aIsNum && a.isFinite !== undefined) return a.isFinite ? ce.One : ce.NaN;
    return unchanged();
  }

  // One as base
  // (note: 1^∞ = NaN - Because there are various cases where lim(x(t),t)=1, lim(y(t),t)=∞ (or -∞),
  // but lim( x(t)^y(t), t) != 1.)
  // A `~oo` exponent stays unfolded: it is off-carrier for `Power` (ruled
  // 2026-09-01), and the `Power` evaluate handler owns the
  // incompatible-type error. `1^±∞` keeps the indeterminate-form NaN and
  // `1^NaN` the propagated NaN.
  if (aIsNum && a.isSame(1)) {
    if (b.isFinite) return ce.One;
    if (isComplexInfinityLiteral(b)) return unchanged();
    return ce.NaN;
  }

  // One as exponent
  // (Permit the base to be a FN-expr. here, too...)
  if (b.isSame(1) && a.type.matches('number' as NumericPrimitiveType)) return a;

  // -1 exponent
  if (b.isSame(-1)) {
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
      if (a.isSame(-1)) return ce.NegativeOne;

      // 1^-1 = 1
      if (a.isSame(1)) return ce.One;
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

      // (-1)^∞ = NaN
      // Because of oscillations in the limit.
      if (a.isSame(-1)) return ce.NaN;

      // An infinite base: (+∞)^∞ = +∞, because the DIRECTION is known —
      // nⁿ grows through +∞ (10¹⁰, 100¹⁰⁰ = 10²⁰⁰, 1000¹⁰⁰⁰ overflows the
      // double range), never changing sign. (-∞)^∞ and (~∞)^∞ keep the
      // direction-less ~∞: (-n)ⁿ alternates with the parity of n
      // ((-10)¹⁰ = +10¹⁰, (-11)¹¹ = -2.85·10¹¹), so no signed limit exists.
      if (a.isInfinity) {
        if (a.isPositive === true) return ce.PositiveInfinity;
        return ce.ComplexInfinity;
      }

      if (a.isNaN) return ce.NaN;

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

      if (a.isSame(-1)) return ce.NaN;
      //Same result for all infinity types...
      if (a.isInfinity) return ce.Zero;

      if (a.isNaN) return ce.NaN;

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
    if (b.type.matches('imaginary')) return ce.NaN;
    if (b.type.matches('complex') && !isNaN(b.re)) {
      if (b.re > 0) return ce.ComplexInfinity;
      if (b.re < 0) return ce.Zero;
    }
  }

  // Fractional exponents
  //---------------------
  if (b.isSame(0.5))
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
  if (isNumber(a) && isNumber(b) && b.im === 0) {
    const e = b.re;
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
    if (isNumber(b) && b.im === 0) exp = b.re;
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
  if (x.im !== 0) {
    const nv = x.numericValue;
    if (typeof nv === 'number') return undefined; // a JS number is never complex
    let exact: ExactNumericValue | undefined;
    if (nv instanceof ExactNumericValue) exact = nv;
    else if (Number.isSafeInteger(nv.re) && Number.isSafeInteger(nv.im))
      // A Gaussian-integer literal from the inexact lane is exactly
      // representable: lift it so the powering is exact (WP-2.16)
      exact = ce._numericValue({
        rational: [nv.re, 1],
        imRational: [nv.im, 1],
      }) as ExactNumericValue;
    if (exact === undefined) return undefined;

    // Magnitude guard: |z^e| = |z|^e — keep pathological powers symbolic
    // rather than materializing huge exact components.
    const magLog10 = 0.5 * Math.abs(e) * Math.log10(x.re * x.re + x.im * x.im);
    if (!Number.isFinite(magLog10) || magLog10 > MAX_EXACT_POW_DIGITS)
      return undefined;

    const v = exact.pow(e);
    // `pow` falls back to the float lane when the result leaves the exact
    // representable set — keep the power symbolic in that case.
    if (v.isExact && !v.isNaN) return ce.number(v);
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
      // Gated to bignum: at machine precision the generic path is a single
      // `Math.pow(e, x)` (no separate ln, so nothing to save) and `exp(x)`
      // would differ by 1 ULP. (A complex exponent falls through to the
      // e^(a+bi) handling below.)
      const ce = x.engine;
      if (bignumPreferred(ce) && x === ce.E.N()) {
        if (typeof exp === 'number')
          return ce.number(ce._numericValue(exp).exp());
        if (isNumber(exp) && exp.im === 0)
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
            : isNumber(exp) && exp.im === 0
              ? exp.re
              : undefined;
        const negativeBase =
          x.isNegative === true && x.im === 0 && eVal !== undefined;
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
        const isIntegerExponent =
          rawExact !== undefined && terms !== undefined
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
            magNV.im === 0 &&
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

  const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

  if (isSymbol(x, 'ExponentialE')) {
    // e^(ln(y)) = y. (Previously this only reduced because `ln(y)` of a
    // numeric `y` evaluated to a float and `e^float` was computed; now that
    // `ln(2)` stays the exact symbol `Ln(2)`, reduce the inverse pair here.)
    if (typeof exp !== 'number' && isFunction(exp, 'Ln')) return exp.op1;

    // Is the argument an imaginary or complex number?
    const imagFactor = getImaginaryFactor(exp);
    if (imagFactor !== undefined) {
      // We have an expression of the form `e^(i theta)`
      const theta = canonicalAngle(imagFactor);
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
        const cosVal = ce.function('Cos', [theta]).evaluate();
        const sinVal = ce.function('Sin', [theta]).evaluate();
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
        if (xv.im === 0) return ce.number(xv.exp());
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
    const isGaussianInt =
      x.im !== 0 && Number.isInteger(x.re) && Number.isInteger(x.im);
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
  if (isNumber(x) && x.im === 0 && typeof exp !== 'number' && isNumber(exp)) {
    const r = asRational(exp);
    if (r !== undefined) {
      const p = Number(r[0]);
      const q = Number(r[1]);
      const realRootExists = x.isNegative !== true || q % 2 !== 0;
      if (
        Number.isInteger(p) &&
        Number.isInteger(q) &&
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

export function root(
  a: Expression,
  b: Expression,
  { numericApproximation }: { numericApproximation: boolean }
): Expression {
  if (!(a.isCanonical || a.isStructural) || !(b.isCanonical || b.isStructural))
    return a.engine._fn('Root', [a, b], { canonical: false });

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
          }
        ) ?? root(a, b, { numericApproximation: false })
      );
    }
  }

  if (isNumber(a) && isNumber(b) && b.isInteger) {
    const e = typeof b === 'number' ? b : b.im === 0 ? b.re : undefined;

    // a^(1/b): evaluate if b is an integer and a is exact

    // An even root of a negative real has no real value, but a complex
    // principal value always exists (like Sqrt(-4) = 2i). Never assert a NaN
    // literal here — stay symbolic so N() can produce the complex root.
    // (`Root(-8,3)` = −2 is odd and still reduces below.) (NU-P1-8)
    const evenRootOfNegative =
      a.isNegative === true && e !== undefined && e > 0 && e % 2 === 0;

    // @todo the result should always be exact if e is an integer
    if (e !== undefined && !evenRootOfNegative) {
      if (typeof a.numericValue === 'number') {
        const v = a.engine._numericValue(a.numericValue).root(e);
        if (v?.isExact && !v.isNaN) return a.engine.number(v);
      } else {
        const v = a.numericValue.asExact?.root(e);
        if (v?.isExact && !v.isNaN) return a.engine.number(v);
      }
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
      const n = a.re;
      if (Number.isSafeInteger(n) && n > 1) {
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
