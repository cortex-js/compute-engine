import type { Expression } from '../global-types';
import type { Type } from '../../common/type/types';

/**
 * Generic result type for a *total, real-closed* numeric function (sin, cos,
 * sinh, erf, …): a finite real (or real-symbol) argument maps to a finite real
 * result.
 *
 * A *provably* non-finite (±∞) argument is excluded: such functions can send
 * ±∞ to ±∞ *or* NaN (`sin(∞) = NaN`, `sinh(∞) = ∞`), neither of which is a
 * `finite_real`, so the sound claim there is the top type `number`. An
 * argument of *unknown* finiteness (a bare `real` symbol) keeps the documented
 * generic-real convention and still yields `finite_real`.
 *
 * This is NOT sound for functions with poles or a restricted real domain
 * (`ln`, `csc`, `arcsin`, …): those use the dedicated handlers below, routed
 * through `elementaryFunctionType`.
 */
export function numericTypeHandler(ops: ReadonlyArray<Expression>): Type {
  if (ops.some((x) => x.isFinite === false)) return 'number';
  if (ops.every((x) => x.type.matches('real'))) return 'finite_real';
  return 'finite_number';
}

/**
 * Logarithms (`Ln`, `Log`, `Lb`, `Lg`). `log(x)` of a *positive* real is real;
 * of `0` is −∞; of a *negative* real is complex. A non-1 positive finite base
 * is required for the real claim.
 */
function logType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  const base = ops[1];
  if (!x || x.isNaN) return 'number';
  // Provably non-positive (0 or negative) or non-finite argument → −∞ / complex
  // / NaN (e.g. `ln(−2)`, `ln(0)`, `ln(+∞)`).
  if (x.isPositive === false || x.isFinite === false) return 'number';
  if (
    base &&
    !(base.isPositive === true && base.isFinite === true && !base.isSame(1))
  )
    return 'number';
  // Positive, or unknown-sign real (generic-real convention for a symbol).
  if (x.type.matches('real')) return 'finite_real';
  return 'finite_number';
}

/**
 * `Csc`/`Cot` (and other periodic reciprocals with poles at multiples of π):
 * a finite real argument can land on a pole (→ `~oo`, typed `complex`) or give
 * a finite value, and a ±∞ argument gives NaN. `complex` is the tightest type
 * covering `finite_real`, `finite_complex`, and complex infinity.
 */
function poleReciprocalType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  if (!x || x.isNaN || x.isFinite === false) return 'number';
  return 'complex';
}

/**
 * Inverse trig with a bounded real domain. `inDomain(r)` decides whether the
 * real value `r` is inside the operator's domain (`|r| ≤ 1` for arcsin/arccos,
 * `|r| ≥ 1` for arcsec/arccsc). A literal outside the domain (or any non-real /
 * ±∞ argument) yields a complex/NaN value; a symbolic real of unknown value
 * keeps the generic-real convention.
 */
function boundedInverseTrigType(
  ops: ReadonlyArray<Expression>,
  inDomain: (r: number) => boolean
): Type {
  const x = ops[0];
  if (!x || x.isNaN || x.isFinite === false) return 'number';
  if (x.isReal !== true) return 'number';
  const r = x.re;
  if (typeof r === 'number' && Number.isFinite(r))
    return inDomain(r) ? 'finite_real' : 'number';
  return 'finite_real';
}

/**
 * `Arctan`/`Arccot`: real-closed on the *extended* reals (`arctan(±∞) = ±π/2`),
 * so any real argument → `finite_real`. The only poles are at ±i, so a non-real
 * finite argument can be complex infinity (`arctan(i) = ~oo`) → widen.
 */
function arctanType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  if (!x || x.isNaN) return 'number';
  if (x.isReal === true) return 'finite_real';
  if (x.isFinite === false) return 'number';
  if (x.type.matches('real')) return 'finite_real';
  return 'number';
}

/**
 * Result type for the elementary/inverse trig and log functions, dispatched by
 * operator so that pole-capable and domain-restricted operators do not claim
 * `finite_real` where their values are complex/infinite/NaN (SYM P0-12).
 */
export function elementaryFunctionType(
  operator: string,
  ops: ReadonlyArray<Expression>
): Type {
  switch (operator) {
    case 'Ln':
    case 'Log':
    case 'Lb':
    case 'Lg':
    case 'Log2':
    case 'Log10':
      return logType(ops);

    case 'Csc':
    case 'Cot':
    case 'Coth':
    case 'Csch':
      return poleReciprocalType(ops);

    case 'Arcsin':
    case 'Arccos':
      return boundedInverseTrigType(ops, (r) => Math.abs(r) <= 1);

    case 'Arcsec':
    case 'Arccsc':
      return boundedInverseTrigType(ops, (r) => Math.abs(r) >= 1);

    case 'Arctan':
    case 'Arccot':
      return arctanType(ops);

    default:
      return numericTypeHandler(ops);
  }
}
