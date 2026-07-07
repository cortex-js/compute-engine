import type { Expression } from '../global-types';
import type { Type } from '../../common/type/types';
import type { BoxedType } from '../../common/type/boxed-type';

/**
 * Type handlers for the standard library follow the **non-finite typing
 * convention** documented in `ARCHITECTURE.md` (§ "Non-finite typing
 * convention for type handlers"). In short:
 *
 * - Claim `non_finite_number` only when the value is PROVABLY `±∞`
 *   (e.g. `Ln(0) = −∞`, `±∞ · (provably non-zero reals)`).
 * - When a non-finite value (`±∞`, `~oo`) or NaN is merely POSSIBLE, claim
 *   `number` — never `non_finite_number` speculatively, and never a finite
 *   type. `~oo` and NaN are representable only by `number`.
 * - An operand of *unknown* finiteness (a bare `real` symbol) is treated as a
 *   generic (finite) point; zero-ness, by contrast, must be *proven* absent
 *   (via `sgn`) for claims that depend on it.
 */

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
  if (x.isFinite === false) return 'number';
  // A provably-zero argument is the log pole, with a *provably* ±∞ value:
  // `ln(0) = −∞`, and `log_b(0) = ∓∞` for any valid base (positive, finite,
  // ≠ 1). Per the non-finite typing convention this provable case claims
  // `non_finite_number`; an unusable base widens to `number`.
  if (x.isSame(0)) {
    if (
      base === undefined ||
      (base.isPositive === true && base.isFinite === true && !base.isSame(1))
    )
      return 'non_finite_number';
    return 'number';
  }
  // A provably *negative* (hence non-zero) finite real argument gives a
  // finite complex value: `ln(x) = ln|x| + iπ` (e.g. `ln(−1) = iπ`). Note
  // the base check below still applies before this claim is usable, so
  // handle it after the base guard.
  // A provably non-positive argument that may be 0 → −∞ pole (`ln(0)`).
  if (x.isPositive === false && x.isNegative !== true) return 'number';
  if (
    base &&
    !(base.isPositive === true && base.isFinite === true && !base.isSame(1))
  )
    return 'number';
  // Provably negative finite argument (see note above): finite complex.
  if (x.isNegative === true) return 'finite_complex';
  // Positive, or unknown-sign real (generic-real convention for a symbol).
  if (x.type.matches('real')) return 'finite_real';
  return 'finite_number';
}

/**
 * `Tan`/`Sec`/`Csc`/`Cot` (and the hyperbolic reciprocals with a pole at 0):
 * a finite real argument can land on a pole (→ `~oo`, e.g. `Csc(0)`,
 * `Tan(π/2)`) or give a finite value, and a ±∞ argument gives NaN. Since
 * `~oo` is representable only by the top type (the lattice's
 * `non_finite_number` is ±∞ only), the sound claim is `number` per the
 * non-finite typing convention. (Previously claimed `complex`, which does
 * not admit `~oo`.)
 */
function poleReciprocalType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  if (!x || x.isNaN || x.isFinite === false) return 'number';
  return 'number';
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
 * Γ-family result type (`Gamma`, `GammaLn`, `Digamma`, `Trigamma`,
 * `PolyGamma`): poles at the non-positive integers, where the value is `~oo`
 * (`+∞` for `GammaLn`) — not representable by any finite type nor by
 * `non_finite_number` (for `~oo`), so a *provably* non-positive-integer
 * argument claims `number`. An integer of unknown sign keeps the
 * generic-point convention (via `numericTypeHandler`).
 */
export function gammaPoleType(x: Expression | undefined): Type {
  if (!x || x.isNaN) return 'number';
  if (x.isInteger === true && x.isNonPositive === true) return 'number';
  return numericTypeHandler([x]);
}

/**
 * Rounding family (`Round`, `Ceil`, `Floor`, `Truncate`), which extends
 * component-wise to complex arguments (Gaussian rounding):
 * - NaN → NaN, and a non-finite argument that may be `~oo` (or a non-finite
 *   complex) → `number`;
 * - a provably real ±∞ maps to itself: `non_finite_number` (provable);
 * - a finite non-real argument rounds component-wise → `finite_complex`;
 * - otherwise (real or unknown, finiteness unknown = generic point) →
 *   `finite_integer`.
 */
export function roundingFunctionType(x: Expression | undefined): Type {
  if (!x || x.isNaN) return 'number';
  if (x.isFinite === false)
    return x.isReal === true ? 'non_finite_number' : 'number';
  if (x.isReal === false)
    return x.isFinite === true ? 'finite_complex' : 'number';
  return 'finite_integer';
}

/**
 * `Measurement(value, error)` — a nominal value carrying a 1σ absolute error.
 * The type is the nominal's scalar type (typically `real`); the error bar does
 * not widen it.
 */
export function measurementType(
  ops: ReadonlyArray<Expression>
): Type | BoxedType {
  return ops[0]?.type ?? 'real';
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

    case 'Tan':
    case 'Sec':
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

    // Inverse hyperbolic functions with real poles / restricted real domains.
    // `artanh(±1) = ±∞`, `arcoth(±1) = ±∞`, `arsech(0) = +∞`, `arcsch(0) = ~oo`
    // are non-finite, so a literal at a pole (or outside the real domain, where
    // the value is complex) must not claim `finite_real`.
    case 'Artanh':
      // Real on |x| < 1; ±∞ at ±1; complex for |x| > 1.
      return boundedInverseTrigType(ops, (r) => Math.abs(r) < 1);
    case 'Arcoth':
      // Real on |x| > 1; ±∞ at ±1; complex for |x| < 1.
      return boundedInverseTrigType(ops, (r) => Math.abs(r) > 1);
    case 'Arsech':
      // Real on (0, 1]; +∞ at 0; complex elsewhere.
      return boundedInverseTrigType(ops, (r) => r > 0 && r <= 1);
    case 'Arcsch':
      // Real for every non-zero real; ~oo at 0.
      return boundedInverseTrigType(ops, (r) => r !== 0);

    default:
      return numericTypeHandler(ops);
  }
}
