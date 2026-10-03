import { BigDecimal } from '../../big-decimal/index.js';
import { rationalize, reducedRational } from './rationals.js';
import type { Rational } from './types.js';

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

/**
 * The REAL value of `base^expValue` for a NEGATIVE `base`, or `undefined` when
 * the principal branch is not real.
 *
 * `Math.pow` (and the shader `pow`) is NaN for every negative base with a
 * non-integer exponent, but that is narrower than CE's convention: an exponent
 * that is a rational `p/q` in lowest terms with an **odd** denominator has a
 * real principal root, so `(−8)^(2/3) = 4` — the same convention that makes
 * `Root(−8, 3) = −2`. Only an **even** denominator has no real value, and such
 * a node is typed `complex` and lowers to the complex helper instead.
 *
 * Without this correction `Power(−8, 2/3)` compiled to `NaN` while the
 * interpreter returned `4` — a compiled/interpreted disagreement independent of
 * the type-driven complex lowering (the node stays `number`).
 *
 * The real `q`-th root of a negative is negative, so the result is
 * `(−1)^p · |base|^(p/q)`.
 *
 * Returns `undefined` unless the real branch is PROVABLE, leaving the caller's
 * NaN fold in place. "Provable" is measured by `realPowerBranchTerms`, the same
 * helper the interpreter's numeric power uses — the branch must never be
 * decided differently here, or the compiled value contradicts `.N()`. It
 * prefers the exponent's EXACT rational (so `100/3` is recognized as an odd
 * denominator, where recovering `p/q` from the double lands on an even one) and
 * falls back to an ulp-tolerant float reconstruction, which is what the
 * interpreter is left with once `.N()` has numericized the exponent.
 */
export function negativeBaseRealPowFromRational(
  base: number,
  exact: Rational | null | undefined,
  expValue: number
): number | undefined {
  if (!(base < 0) || !Number.isFinite(base)) return undefined;
  if (!Number.isFinite(expValue) || Number.isInteger(expValue))
    return undefined;

  // The branch is decided by the exponent's EXACT rational when it has one,
  // and only otherwise by the (ulp-tolerant) float reconstruction — sharing
  // `realPowerBranchTerms` with the interpreter so the two can never disagree.
  const isExactRational = exact != null;
  const terms = realPowerBranchTerms(exact ?? undefined, expValue);
  if (terms === undefined) return undefined;
  const [p, q] = terms;
  if (q % 2 === 0) return undefined;

  // The magnitude is |base|^(p/q), evaluated the way the INTERPRETER evaluates
  // this node — the two paths round differently and the fold must match
  // whichever one the uncompiled expression takes:
  //
  // - An exact rational of SMALL terms goes through the interpreter's exact
  //   arithmetic, which lands on clean values. Mirror it by taking the q-th
  //   ROOT first and then the p-th power: `Math.pow(8, 1/3)` is exactly `2`, so
  //   `(−8)^(2/3)` folds to exactly `4`, where a direct `Math.pow(8, 2/3)`
  //   leaves `3.9999999999999996`.
  // - Everything else — a float exponent, or an exact rational with terms too
  //   large for the root-then-power split to stay accurate — goes through the
  //   interpreter's float path. Match it with the DIRECT power: for a
  //   continued-fraction reconstruction like `√2 ≈ 54608393/38613965` the split
  //   compounds rounding over a huge `p` and drifts ~1e-9 off the interpreter,
  //   while the direct form agrees to the last ulp.
  const useSplit = isExactRational && Math.abs(p) <= 64 && q <= 64;
  let magnitude = useSplit
    ? Math.pow(Math.pow(-base, 1 / q), p)
    : Math.pow(-base, expValue);
  // A large `p` can overflow the split form where the direct one does not.
  if (!Number.isFinite(magnitude)) magnitude = Math.pow(-base, expValue);
  if (!Number.isFinite(magnitude)) return undefined;
  return p % 2 === 0 ? magnitude : -magnitude;
}
