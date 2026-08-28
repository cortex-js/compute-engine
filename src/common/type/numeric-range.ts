import type { NumericPrimitiveType, Type } from './types.js';

/**
 * The ONE constructor for a numeric range type. Every site that builds a
 * `numeric` node with bounds goes through here, so the normal form of
 * open-bound ranges (`docs/plans/2026-08-28-open-bounds-in-ranged-types.md`
 * §3.2) is enforced by construction:
 *
 * - `-0` normalizes to `0`, so `-0` and `0` are one endpoint.
 * - An open flag is dropped at a non-finite bound (an infinity carries no
 *   endpoint to exclude).
 * - On the DISCRETE integer tiers open bounds normalize away: an open lower
 *   bound `k` becomes the closed `floor(k) + 1`, an open upper bound `k` the
 *   closed `ceil(k) - 1`, and non-integral closed bounds tighten inward to
 *   the nearest integer — `integer<0<..>` IS `integer<1..>`. Integer-tier
 *   consumers therefore never see an open flag, EXCEPT on a bound at or
 *   beyond 2⁵³, where the successor is not representable and the flag is
 *   kept rather than admitting the excluded endpoint.
 * - An EMPTY range — `lower > upper`, or equal endpoints with either side
 *   open (`real<0<..0>`) — is the lattice bottom `never`.
 * - A range unbounded on both sides collapses to its bare tier.
 */
export function makeNumericRangeType(
  tier: NumericPrimitiveType,
  lower: number,
  upper: number,
  lowerOpen = false,
  upperOpen = false
): Type {
  let lo = lower === 0 ? 0 : lower;
  let hi = upper === 0 ? 0 : upper;
  if (!Number.isFinite(lo)) lowerOpen = false;
  if (!Number.isFinite(hi)) upperOpen = false;

  if (isIntegerTier(tier)) {
    // The successor step is exact only within the safe-integer span; at
    // or beyond 2⁵³ `floor(k) + 1` can round back to `k` itself, and
    // clearing the flag there would ADMIT the excluded endpoint
    // (dual-review catch). Such a bound keeps its open flag instead — an
    // integer-tier consumer may then see an open flag in that span only.
    if (Number.isFinite(lo)) {
      const next = lowerOpen ? Math.floor(lo) + 1 : Math.ceil(lo);
      if (!lowerOpen || next !== lo) {
        lo = next;
        lowerOpen = false;
      }
    }
    if (Number.isFinite(hi)) {
      const prev = upperOpen ? Math.ceil(hi) - 1 : Math.floor(hi);
      if (!upperOpen || prev !== hi) {
        hi = prev;
        upperOpen = false;
      }
    }
  }

  if (lo > hi) return 'never';
  if (lo === hi && (lowerOpen || upperOpen)) return 'never';
  if (lo === -Infinity && hi === Infinity) return tier;

  const node: Extract<Type, { kind: 'numeric' }> = { kind: 'numeric', type: tier };
  if (lo !== -Infinity) node.lower = lo;
  if (hi !== Infinity) node.upper = hi;
  if (lowerOpen) node.lowerOpen = true;
  if (upperOpen) node.upperOpen = true;
  return node;
}

export function isIntegerTier(tier: NumericPrimitiveType): boolean {
  return tier === 'integer';
}
