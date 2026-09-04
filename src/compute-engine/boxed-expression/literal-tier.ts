import type { Type } from '../../common/type/types.js';
import { SIGNED_INFINITY_TYPE } from '../../common/type/primitive.js';
import type { NumericValue } from '../numeric-value/types.js';

/**
 * The type a number literal contributes to a COMPOSITE type — the tier the
 * literal's value belongs to, read directly off the value.
 *
 * A number literal's own `.type` is its literal type: the value (`21`), an
 * exact rational's singleton range (`rational<0.5..0.5>`), or an enclosure
 * of a value no double holds (`real<1.4..1.5>` for `√2`). That precision
 * belongs to the literal NODE only. A composite type built from the
 * literal — a tuple's component, a list's or set's element, a record's
 * field — is a STORED contract, and a stored contract carries the tier:
 * `(√2, 1)` types `tuple<real, integer>`, never `tuple<real<1.4..1.5>,
 * integer>`. (Ruling of 2026-08-27; the contract is stated in
 * `docs/TYPE-SYSTEM.md` §"Number literal types" and pinned in
 * `test/compute-engine/composite-type-synthesis.test.ts`.)
 *
 * This function is that tier. It reads the value's kind and never builds
 * the literal type, so a composite of many literals is typed without
 * materializing one structured type per component only to widen it away.
 * The answer matches what `widenValueTypes` (`common/type/widen-value.ts`)
 * gives for the literal's value type, and what `stripNumericRanges`
 * (`common/type/utils.ts`) gives for its range form — for a finite value.
 * The non-finite cases follow `widenValueTypes`:
 *
 * - `NaN` is `nan`;
 * - a SIGNED infinity is the pair `+oo | -oo`, never the lone singleton
 *   (a contract inferred from one observed `+∞` must not reject a later
 *   `−∞`) and never the wider `infinity` (which also admits the unsigned
 *   `~oo` and would destroy the extended-real claim);
 * - the unsigned `~oo` is `infinity`;
 * - a finite complex value keeps the tier its kernel value reports
 *   (`complex`, or `imaginary` for a pure imaginary).
 */
export function numberLiteralTierType(literal: {
  readonly numericValue: number | NumericValue;
}): Type {
  const v = literal.numericValue;
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'nan';
    if (!Number.isFinite(v)) return SIGNED_INFINITY_TYPE;
    return Number.isInteger(v) ? 'integer' : 'real';
  }
  if (v.isPositiveInfinity || v.isNegativeInfinity) return SIGNED_INFINITY_TYPE;
  return v.type;
}
