import { toInteger } from '../boxed-expression/numerics.js';
import { isNumber } from '../boxed-expression/type-guards.js';
import { MAX_RANDOM_ELEMENT_COUNT } from '../numerics/random.js';

import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types.js';

/**
 * The `k` operand of `RandomChoice` (`library/core.ts`) and `RandomSample`
 * (`library/statistics.ts`), rounded and validated — the shared half of the
 * `k` table in `docs/plans/2026-07-25-random-signature-redesign.md` §4.
 *
 * `k` is typed `number`, not `integer`: a caller who computes a count
 * (`Count(xs)/2`, a fitted value, `4N` for a slider `N`) should not have to
 * round it first. `toInteger` rounds half toward `+∞` (`2.5 → 3`,
 * `-2.5 → -2`).
 *
 * @returns
 * - `null` — the operand is not a literal (a symbol, an error): stay symbolic.
 * - an `Expression` — an `out-of-range` error: non-finite, outside the
 *   safe-integer range, negative, or past the size cap.
 * - a `number` — the rounded count, in `0..MAX_RANDOM_ELEMENT_COUNT`.
 *
 * The `k > n` row is NOT decided here: it is legal for `RandomChoice` (that
 * is what replacement means) and an error for `RandomSample`.
 */
export function randomCount(
  ce: ComputeEngine,
  kOp: Expression | undefined
): number | null | Expression {
  if (kOp === undefined) return null;

  const outOfRange = (v: string): Expression =>
    ce.error(['out-of-range', `a count in 0..${MAX_RANDOM_ELEMENT_COUNT}`, v]);

  const k = toInteger(kOp);
  if (k === null) {
    // `toInteger` declines non-finite literals (`NaN`, `±∞`) and finite
    // literals beyond the safe-integer range (e.g. 1e20). All are
    // out-of-range counts and must error loudly rather than linger as
    // symbolic. Everything else — a symbol (`isNumber` is false), an error
    // operand — stays symbolic.
    if (isNumber(kOp) && kOp.im === 0) return outOfRange(kOp.toString());
    return null;
  }
  if (k < 0 || k > MAX_RANDOM_ELEMENT_COUNT) return outOfRange(k.toString());
  return k;
}
