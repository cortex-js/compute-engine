import type { Expression, Sign } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { provablyNonFiniteNumber } from '../boxed-expression/numerics.js';
import { absRange } from '../numerics/interval-arithmetic.js';
import {
  collectionElementType,
  nonNegativeRangeType,
  signOfType,
  widen,
} from '../../common/type/utils.js';
import { EXTENDED_REAL_TYPE } from '../../common/type/primitive.js';
import { parseType } from '../../common/type/parse.js';
import {
  negativeSign,
  nonPositiveSign,
  positiveSign,
} from '../boxed-expression/sgn.js';

/**
 * Type handlers for the standard library follow the **non-finite typing
 * convention** documented in `ARCHITECTURE.md` (§ "Non-finite typing
 * convention for type handlers"). In short:
 *
 * - Claim `non_finite_number` — the signed pair `+∞`, `−∞` — only when the
 *   value is PROVABLY one of them (e.g. `Ln(0) = −∞`,
 *   `±∞ · (provably non-zero reals)`).
 * - When a non-finite value (`±∞`, `~oo`) or NaN is merely POSSIBLE, claim
 *   the top type `number` — never `non_finite_number` speculatively, and
 *   never a finite type. `number` is the only claim that admits `~oo` and
 *   NaN together with the finite values.
 * - Every bare numeric name (`integer`, `rational`, `real`, `complex`) means
 *   a FINITE value, so an operand whose type is one of them needs no
 *   separate finiteness proof. A gate that must also admit `±∞` spells the
 *   question `EXTENDED_REAL_TYPE` (`common/type/primitive.ts`). Zero-ness,
 *   by contrast, must be *proven* absent (via `sgn`) for claims that depend
 *   on it.
 */

/**
 * The join of the FINITE complex numbers with the two signed infinities.
 * A log-like head whose argument's sign is unknown reaches exactly this set
 * — `ln(x)` is real for x > 0, `−∞` at x = 0, and finite complex for x < 0
 * — and the bare name `complex` cannot carry the pole because it denotes
 * the finite complex numbers alone. Parsed once at module load.
 */
const COMPLEX_OR_SIGNED_INFINITY_TYPE = parseType(
  'complex | non_finite_number'
);

/**
 * The join of the non-negative FINITE reals with the two signed infinities.
 * A magnitude `|x|` whose operand the type channel cannot prove finite
 * reaches exactly this set: the value is a non-negative real when the
 * operand is finite, and `+∞` when it is not. The bare name `real` denotes
 * the finite reals alone, so it cannot carry the `+∞` on its own, and the
 * union keeps the finite half tight instead of falling back to `number`.
 * Parsed once at module load.
 */
const NON_NEGATIVE_REAL_OR_SIGNED_INFINITY_TYPE = parseType(
  'real<0..> | non_finite_number'
);

/**
 * The type of an operand as a TYPE HANDLER may read it: a number literal's
 * `_literalType` — the value-carrying (`21`, `rational<0.5..0.5>`)
 * or range-enclosing (`real<1.4..1.5>` for `√2`) type of ruling
 * O9's first half — and the public type for everything else. A symbol's
 * public type already carries what `ce.assume()` refined into it and a
 * declaration's ranges, so no special-casing is needed there.
 */
export function handlerTypeOf(x: Expression): Type {
  return x._literalType ?? x.type.type;
}

/**
 * The sign of an operand as a type handler may read it: the value channel
 * first (`.sgn` — a literal's value, a symbol's held value or assumption,
 * an operator's `sgn` handler), then the TYPE channel (`signOfType` over
 * the handler-visible type — a literal's value type, a ranged declaration
 * such as `assume(x > 0)` produces, a ranged result such as `Abs`'s).
 *
 * Handlers combine this with the `Sign` predicates
 * (`positiveSign(operandSgn(x)) === true`), which is exactly the
 * `x.isPositive === true` read they replace whenever `.sgn` answers, plus
 * the type fallback when it does not.
 */
export function operandSgn(x: Expression): Sign | undefined {
  return x.sgn ?? signOfType(handlerTypeOf(x));
}

/**
 * The machine value carried by a number literal's handler-visible type: a
 * value type's value, or a singleton range's bound. `undefined` for
 * symbols, compound expressions, and literals whose exact value no machine
 * number holds (`1/3`, `√2`, a bigint beyond ±2⁵³ — those carry only
 * their sign).
 */
export function operandLiteralValue(x: Expression): number | undefined {
  const t = x._literalType;
  if (t === undefined || typeof t === 'string') return undefined;
  if (t.kind === 'value' && typeof t.value === 'number') return t.value;
  if (
    t.kind === 'numeric' &&
    typeof t.lower === 'number' &&
    t.lower === t.upper
  )
    return t.lower;
  return undefined;
}

/**
 * Is this operand's value a provably even (or odd) integer? Combines the
 * value channel (`isEven`/`isOdd`) with the literal's handler-visible
 * value. `undefined` when parity cannot be established.
 */
export function operandIsEven(x: Expression): boolean | undefined {
  if (x.isEven !== undefined) return x.isEven;
  const v = operandLiteralValue(x);
  if (v !== undefined && Number.isInteger(v)) return v % 2 === 0;
  return undefined;
}

export function operandIsOdd(x: Expression): boolean | undefined {
  const even = operandIsEven(x);
  return even === undefined ? undefined : !even;
}

/**
 * Generic result type for a *total, real-closed* numeric function (sin, cos,
 * sinh, erf, …): a finite real (or real-symbol) argument maps to a finite real
 * result.
 *
 * A *provably* non-finite (±∞) argument is excluded: such functions can send
 * ±∞ to ±∞ *or* NaN (`sin(∞) = NaN`, `sinh(∞) = ∞`), neither of which is a
 * `real`, so the sound claim there is the top type `number`. A bare
 * `real` symbol is itself finite, so it needs no separate finiteness proof
 * and yields `real` directly.
 *
 * This is NOT sound for functions with poles or a restricted real domain
 * (`ln`, `csc`, `arcsin`, …): those use the dedicated handlers below, routed
 * through `elementaryFunctionType`.
 */
export function numericTypeHandler(ops: ReadonlyArray<Expression>): Type {
  if (ops.some((x) => provablyNonFiniteNumber(x))) return 'number';
  if (ops.every((x) => x.type.matches('real'))) return 'real';
  return 'number';
}

/**
 * Logarithms (`Ln`, `Log`, `Lb`, `Lg`). `log(x)` of a *positive* real is real;
 * of `0` is −∞; of a *negative* real is complex. A base that is *provably*
 * positive, finite and different from 1 is required for the real claim.
 */
function logType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  const base = ops[1];
  if (!x || x.isNaN) return 'number';
  if (provablyNonFiniteNumber(x)) return 'number';
  const xSgn = operandSgn(x);
  // A base of 1 is not a base at all (`log_1` has no value: `1^y = 1` for
  // every y), so non-1-ness must be PROVEN, not merely un-disproven. The
  // proof here is the VALUE channel: the base must be a number literal, or
  // a symbol holding one, whose value is not 1. A `!b.isSame(1)` test on
  // the operand itself is not a proof — `isSame` is syntactic, so it
  // accepts every symbolic base, including `Exp(r)`, whose type
  // `(real<0..>) & !0` proves positive and finite yet whose value IS
  // 1 at r = 0. `Log(4, Exp(0)).N()` is `+oo`, so the `real` such a
  // base once bought was unsound.
  //
  // This is stricter than the descriptor twin, which also accepts a base
  // whose TYPE bounds or sign exclude 1 (`provablyDiffers`,
  // `library/type-handlers-types.ts`). Stricter is sound — it only widens
  // the claim to `number` — and the value channel is the whole proof this
  // shape can reach without a bounds reader of its own.
  const literalValueOf = (b: Expression): Expression | undefined => {
    if (isNumber(b)) return b;
    if (isSymbol(b)) {
      const held = b.valueDefinition?.value;
      if (held !== undefined && isNumber(held)) return held;
    }
    return undefined;
  };
  const usableBase = (b: Expression): boolean => {
    const v = literalValueOf(b);
    return (
      v !== undefined &&
      positiveSign(operandSgn(b)) === true &&
      b.isFinite === true &&
      !v.isSame(1)
    );
  };
  // A provably-zero argument is the log pole, with a *provably* ±∞ value:
  // `ln(0) = −∞`, and `log_b(0) = ∓∞` for any valid base (positive, finite,
  // ≠ 1). Per the non-finite typing convention this provable case claims
  // `non_finite_number`; an unusable base widens to `number`.
  if (x.isSame(0)) {
    if (base === undefined || usableBase(base)) return 'non_finite_number';
    return 'number';
  }
  // A provably *negative* (hence non-zero) finite real argument gives a
  // finite complex value: `ln(x) = ln|x| + iπ` (e.g. `ln(−1) = iπ`). Note
  // the base check below still applies before this claim is usable, so
  // handle it after the base guard.
  // A provably non-positive argument that may be 0 → −∞ pole (`ln(0)`).
  if (positiveSign(xSgn) === false && negativeSign(xSgn) !== true)
    return 'number';
  if (base && !usableBase(base)) return 'number';
  // Provably negative finite argument (see note above): finite complex.
  if (negativeSign(xSgn) === true) return 'complex';
  // Provably positive (hence real, and finite per the check above): real.
  if (positiveSign(xSgn) === true) return 'real';
  // Sign unknown: the value may be real (x > 0), −∞ (x = 0) or finite
  // complex (x < 0) — the join is `complex | non_finite_number`. The bare
  // name `complex` denotes the FINITE complex numbers, so it cannot carry
  // the `x = 0` pole on its own and the signed pair is spelled out.
  // The old claim of `real` for an unknown-sign real operand was
  // unsound (`ln(−2) = 0.693… + iπ`, `ln(0) = −∞`); same ruling as the
  // bounded inverse-trig heads (2026-07-30). Neither disjunct admits NaN,
  // so the claim is only sound when the operand's type excludes NaN too
  // (`ln(NaN) = NaN`): an operand that may be NaN — `number`, which sits
  // ABOVE `complex` rather than inside it — keeps the top type.
  return x.type.matches('complex') ? COMPLEX_OR_SIGNED_INFINITY_TYPE : 'number';
}

/**
 * `Tan`/`Sec`/`Csc`/`Cot` (and the hyperbolic reciprocals `Coth`/`Csch`,
 * poles at 0): a pole value is `~oo`, which `non_finite_number` — the
 * SIGNED pair `+∞`, `−∞` — does not admit, so an argument that may sit on a
 * pole claims the top type `number`.
 *
 * The poles of Tan/Sec are the odd multiples of π/2 and those of Csc/Cot the
 * multiples of π — all irrational except 0 (a Csc/Cot/Csch/Coth pole only).
 * A number literal therefore never lands on a nonzero pole, and a symbolic
 * real keeps the generic-point convention (the pole set has measure zero) —
 * with zero-ness, the one *provable* pole, required to be disproven (sgn)
 * for the zero-pole operators.
 *
 * ±∞: the circular functions give NaN (→ `number`), while `coth(±∞) = ±1`
 * and `csch(±∞) = 0` are finite reals.
 */
function poleReciprocalType(
  operator: string,
  ops: ReadonlyArray<Expression>
): Type {
  const x = ops[0];
  if (!x || x.isNaN) return 'number';
  const hyperbolic = operator === 'Coth' || operator === 'Csch';
  if (provablyNonFiniteNumber(x))
    return hyperbolic && x.isExtendedReal === true ? 'real' : 'number';
  if (x.isExtendedReal !== true) return 'number';
  // Only the pole at 0 is reachable by a number literal (every other pole is
  // an irrational multiple of π, which no literal — rational, float, or
  // radical — equals). A literal is recognized by either channel. In
  // shipping code `isNumber` alone would do (only `BoxedNumber` carries a
  // `_literalType`); the `_literalType` disjunct exists for the §5.7
  // fact-withholding harness, whose operand proxies mask `_kind` — so
  // literal-ness must also be provable from the type channel the proxies
  // forward (`docs/plans/2026-08-22-type-handlers-on-types.md` §5.7).
  const poleAtZero = operator !== 'Tan' && operator !== 'Sec';
  if (isNumber(x) || x._literalType !== undefined) {
    const v = operandLiteralValue(x);
    return poleAtZero && (v !== undefined ? v === 0 : x.isSame(0))
      ? 'number'
      : 'real';
  }
  // A non-literal CONSTANT (π/2, 2π/3, …) can sit exactly on a circular pole
  // — `Tan(π/2) = ~oo`, `Csc(π) = ~oo` — so it keeps `number` (pinned by
  // non-finite-typing.test.ts). The hyperbolic poles are only at 0, where the
  // sgn check below decides.
  if (!hyperbolic && x.isConstant) return 'number';
  if (!poleAtZero) return 'real';
  // Zero-pole operators on a symbolic real: the pole at 0 — the one provable
  // pole — must be disproven; the rest of the pole set has measure zero
  // (generic-point convention).
  const s = operandSgn(x);
  if (positiveSign(s) === true || negativeSign(s) === true)
    return 'real';
  return 'number';
}

/**
 * A real interval, with per-end closedness. Use `±Infinity` for an unbounded
 * end (its closedness is then irrelevant).
 */
export type RealInterval = {
  lo: number;
  loClosed: boolean;
  hi: number;
  hiClosed: boolean;
};

export const iv = (
  lo: number,
  loClosed: boolean,
  hi: number,
  hiClosed: boolean
): RealInterval => ({ lo, loClosed, hi, hiClosed });

/**
 * The real-domain structure of an inverse trig / inverse hyperbolic head with a
 * *bounded* real domain (`Arcsin`, `Arcosh`, `Artanh`, …).
 *
 * These heads take a **complex** value outside their real domain
 * (`arcsin(−2) = −π/2 + 1.3169…i`, `arcosh(−2) = 1.3169… + iπ`), so claiming
 * `real` for an argument that is not provably in-domain is unsound —
 * `complex` does not match `real`. The handler below therefore
 * decides three ways (user ruling 2026-07-30):
 *
 * - argument provably in `real`    → `real`  (tight)
 * - argument provably in `complex` → `complex`
 * - argument provably at a `pole`  → `poleType`
 * - otherwise                      → the join of what is still possible
 *
 * `real` and `complex` must be written **open** at every pole: a proof of
 * membership in a closed interval whose endpoint is a pole would not exclude
 * the non-finite value there.
 */
export type RealDomain = {
  /** Intervals on which the head is finite-real-valued. */
  real: readonly RealInterval[];
  /** Intervals on which the head takes a finite, *non-real* value. */
  complex: readonly RealInterval[];
  /** Isolated real points where the value is not finite. */
  poles: readonly number[];
  /**
   * The type of the value at a pole: `non_finite_number` for a signed `±∞`
   * (`artanh(1) = +∞`), and `number` when the pole value is `~oo` or may be
   * NaN — neither of those is a member of `non_finite_number`, which is the
   * SIGNED pair alone, so only the top type admits them.
   */
  poleType: Type;
};

/** Is the real number `r` inside one of `intervals`? */
function containsNumber(
  intervals: readonly RealInterval[],
  r: number
): boolean {
  return intervals.some(
    ({ lo, loClosed, hi, hiClosed }) =>
      (loClosed ? r >= lo : r > lo) && (hiClosed ? r <= hi : r < hi)
  );
}

/**
 * Is `x` **provably** inside one of `intervals`? Uses the numeric predicates,
 * which consult the assumptions system (`x ≥ 2` ⊢ `x.isGreater(1) === true`).
 * An undecidable predicate answers `undefined` and must not count as a proof,
 * hence the `=== true` comparisons.
 */
function provablyIn(
  x: Expression,
  intervals: readonly RealInterval[]
): boolean {
  return intervals.some(({ lo, loClosed, hi, hiClosed }) => {
    if (
      lo !== -Infinity &&
      (loClosed ? x.isGreaterEqual(lo) : x.isGreater(lo)) !== true
    )
      return false;
    if (
      hi !== Infinity &&
      (hiClosed ? x.isLessEqual(hi) : x.isLess(hi)) !== true
    )
      return false;
    return true;
  });
}

export function boundedInverseTrigType(
  ops: ReadonlyArray<Expression>,
  domain: RealDomain
): Type {
  const x = ops[0];
  if (!x || provablyNonFiniteNumber(x)) return 'number';
  if (x.isExtendedReal !== true) return 'number';

  // Fast path: a (finite) real value classifies by arithmetic alone, without
  // going through the comparison/assumptions machinery. Rounding to machine
  // precision can land an exact value (`1 + 10⁻²⁰`, a bignum `1 − 10⁻³⁰`)
  // EXACTLY ON a pole or interval endpoint — never strictly past one
  // (round-to-nearest moves a value at most half an ulp, so the only double
  // reachable across a representable boundary is the boundary itself). So
  // the arithmetic verdict is trusted unless `r` sits exactly on a boundary;
  // there, fall through to the exact predicates (`x.isEqual(1)`
  // distinguishes `1` from `1 + 10⁻²⁰`, where `.re` cannot).
  const r = operandLiteralValue(x) ?? x.re;
  if (typeof r === 'number' && Number.isFinite(r)) {
    const onBoundary =
      domain.poles.includes(r) ||
      domain.real.some(({ lo, hi }) => r === lo || r === hi) ||
      domain.complex.some(({ lo, hi }) => r === lo || r === hi);
    if (!onBoundary) {
      if (containsNumber(domain.real, r)) return 'real';
      if (containsNumber(domain.complex, r)) return 'complex';
      return domain.poleType;
    }
  }

  // Refine with the numeric predicates. Pole membership must be EXACT for a
  // number literal: `isEqual` compares within the engine tolerance, which
  // would put `1 + 10⁻²⁰` "at" the pole 1 (the inequality predicates used
  // below are exact). A literal's handler-visible value answers the same
  // question through the type channel (it is `undefined` — never a rounded
  // double — when no machine number holds the value exactly).
  const lv = operandLiteralValue(x);
  if (
    lv !== undefined
      ? domain.poles.includes(lv)
      : isNumber(x)
        ? domain.poles.some((p) => x.isSame(p))
        : domain.poles.some((p) => x.isEqual(p) === true)
  )
    return domain.poleType;
  if (provablyIn(x, domain.real)) return 'real';
  if (provablyIn(x, domain.complex)) return 'complex';
  // Magnitude unknown: the join of what remains. A pole that is provably
  // avoided (or a head with no real pole) drops the non-finite arm.
  if (domain.poles.every((p) => x.isEqual(p) === false))
    return 'complex';
  // The join of `complex` with the pole value. `complex` denotes the
  // FINITE complex numbers, so it cannot absorb the pole: a signed-infinity
  // pole (`poleType: 'non_finite_number'`) is spelled out in the union, and
  // a NaN-or-`~oo`-capable pole (`poleType: 'number'`) forces the top type.
  return domain.poleType === 'number'
    ? 'number'
    : COMPLEX_OR_SIGNED_INFINITY_TYPE;
}

/** `Arcsin`/`Arccos`: real on `[−1, 1]`, finite complex outside, no real pole. */
const ARCSIN_DOMAIN: RealDomain = {
  real: [iv(-1, true, 1, true)],
  complex: [iv(-Infinity, false, -1, false), iv(1, false, Infinity, false)],
  poles: [],
  poleType: 'number',
};

/**
 * `Arcsec`/`Arccsc`: real on `|x| ≥ 1`, finite complex on `0 < |x| < 1`,
 * `~oo` at 0.
 *
 * Mathematically the pole value is `~oo`, whose own singleton type would be
 * the tight pole claim. But the numeric evaluator currently yields **NaN**
 * at 0 (`arcsec(0).N() → NaN`; exact `evaluate()` stays symbolic), and the
 * only type that admits both `~oo` and NaN is `number`. A type claim must
 * not exclude a value the operator actually produces, so the sound pole
 * claim — and hence the unknown-magnitude join — is `number`. Narrowing it
 * requires first changing `Arcsec`/`Arccsc` evaluation to produce `~oo` at
 * the pole.
 */
const ARCSEC_DOMAIN: RealDomain = {
  real: [iv(-Infinity, false, -1, true), iv(1, true, Infinity, false)],
  complex: [iv(-1, false, 0, false), iv(0, false, 1, false)],
  poles: [0],
  poleType: 'number',
};

/** `Artanh`: real on `(−1, 1)`, finite complex on `|x| > 1`, `±∞` at `±1`. */
const ARTANH_DOMAIN: RealDomain = {
  real: [iv(-1, false, 1, false)],
  complex: [iv(-Infinity, false, -1, false), iv(1, false, Infinity, false)],
  poles: [-1, 1],
  poleType: 'non_finite_number',
};

/** `Arcoth`: real on `|x| > 1`, finite complex on `(−1, 1)`, `±∞` at `±1`. */
const ARCOTH_DOMAIN: RealDomain = {
  real: [iv(-Infinity, false, -1, false), iv(1, false, Infinity, false)],
  complex: [iv(-1, false, 1, false)],
  poles: [-1, 1],
  poleType: 'non_finite_number',
};

/** `Arsech`: real on `(0, 1]`, finite complex elsewhere, `+∞` at 0. */
const ARSECH_DOMAIN: RealDomain = {
  real: [iv(0, false, 1, true)],
  complex: [iv(-Infinity, false, 0, false), iv(1, false, Infinity, false)],
  poles: [0],
  poleType: 'non_finite_number',
};

/** `Arcosh`: real on `[1, +∞)`, finite complex below (`arcosh(0) = iπ/2`). */
const ARCOSH_DOMAIN: RealDomain = {
  real: [iv(1, true, Infinity, false)],
  complex: [iv(-Infinity, false, 1, false)],
  poles: [],
  poleType: 'number',
};

/**
 * `Arcsch`: real-valued on every *non-zero* real, `~oo` at 0. The real
 * interval is deliberately written as the whole line: the pole is checked
 * first (so a literal 0 still widens to `number`), and a symbolic real of
 * unknown value keeps the documented generic-point convention — matching the
 * behavior of the other real-closed heads rather than the bounded ones.
 */
const ARCSCH_DOMAIN: RealDomain = {
  real: [iv(-Infinity, false, Infinity, false)],
  complex: [],
  poles: [0],
  poleType: 'number',
};

/**
 * `Arctan`/`Arccot`: real-closed on the *extended* reals (`arctan(±∞) = ±π/2`),
 * so any real argument — provably infinite ones included — → `real`.
 * The only poles are at ±i, so a non-real or unknown-realness argument can be
 * complex infinity (`arctan(i) = ~oo`, `arctan(~oo)`) → the final `number`.
 * No separate non-finite test is needed after the real check: a provably
 * non-finite REAL is absorbed by the extended-real closure, and every
 * non-real infinity (`~oo`, a `number`-typed symbol holding `±∞`) answers
 * `number` below.
 *
 * One real check suffices: `isExtendedReal === true` is exactly the test
 * `type.matches(EXTENDED_REAL_TYPE)` performs — on symbols and function
 * expressions `isExtendedReal` IS that type test (a `NotElement(x, ℝ)`
 * assumption only refutes the type-undecided case, where the match is false
 * anyway), and a literal's type is below the extended real line exactly when
 * its value is a real or a signed infinity. The bare name `real` on its own
 * would NOT do: it denotes the finite reals, so a `±∞` argument — the case
 * the extended-real closure exists for — does not match it.
 */
function arctanType(ops: ReadonlyArray<Expression>): Type {
  const x = ops[0];
  if (!x || x.isNaN) return 'number';
  if (x.isExtendedReal === true) return 'real';
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
  if (x.isInteger === true && nonPositiveSign(operandSgn(x)) === true)
    return 'number';
  return numericTypeHandler([x]);
}

/**
 * Rounding family (`Round`, `Ceil`, `Floor`, `Truncate`), which extends
 * component-wise to complex arguments (Gaussian rounding):
 * - NaN → NaN, and a non-finite argument that may be `~oo` (or a non-finite
 *   complex) → `number`;
 * - a provably real ±∞ maps to itself: `non_finite_number` (provable);
 * - a *provably* non-real argument rounds component-wise → `complex`
 *   (widened to `number` when its finiteness is not established);
 * - otherwise (real or unknown, finiteness unknown = generic point) →
 *   `integer`.
 *
 * Non-realness must be PROVEN, not merely un-disproven. On a function
 * expression `isExtendedReal` is derived from the type (a subtype of `real`
 * or of `non_finite_number`), so it answers `false` for an operand that is
 * simply not *provably* real:
 * `4Q` (Q undeclared) types `number`, which admits both readings.
 * Reading that `false` as "complex" made `Round(4Q)` type `number` while the
 * strictly less informative `Round(Q)` typed `integer` — more knowledge
 * about the operand yielding a weaker result. Only a number *literal* (whose
 * `isExtendedReal` is a value, not a type, question) or a type that excludes
 * the reals proves the complex case; everything else keeps the generic-point
 * convention.
 */
export function roundingFunctionType(x: Expression | undefined): Type {
  if (!x || x.isNaN) return 'number';
  if (provablyNonFiniteNumber(x))
    return x.isExtendedReal === true ? 'non_finite_number' : 'number';
  const provablyNonReal = isNumber(x)
    ? x.isExtendedReal === false
    : x.type.matches('imaginary');
  if (provablyNonReal)
    return x.isFinite === true || x.type.matches('complex')
      ? 'complex'
      : 'number';
  return 'integer';
}

/**
 * `Abs` — |x| is a non-negative real whose finiteness follows the operand:
 * |±∞| = |~oo| = +∞, |NaN| = NaN, and a finite x (real or complex) has a
 * finite magnitude. A finite tier is only claimed when finiteness is
 * *provable from the static type* so downstream finiteness guards (e.g.
 * `Multiply`'s ∞·0 protection in its sgn handler) can rely on it; an
 * operand of unknown finiteness gets the union of the two outcomes,
 * `real<0..> | non_finite_number`, because the bare tiers denote the
 * FINITE values alone and would exclude the `+∞` such an operand can
 * produce.
 *
 * Deliberately type-driven, NOT `x.isFinite`-driven: the type is
 * generation-cached, while `isFinite` walks the structural sgn machinery on
 * every call (a measured ~2.5× whole-suite slowdown when this handler used
 * it), and a possibly-collection operand — whose `isFinite` is not `true` —
 * must fall through to the scalar default for the broadcast lift to wrap
 * (`broadcastable<real>`), not be branded non-finite.
 */
export function absFunctionType(x: Expression | undefined): Type {
  if (!x) return 'number';
  // An operand the TYPE proves infinite — the signed pair `±∞` and the
  // unsigned `~oo` — has magnitude `+∞`, so `non_finite_number` (the signed
  // pair) is the claim. This arm runs before every other test: a
  // type-provable infinity is never NaN, so no NaN guard below can apply to
  // it, and every tier the walk below can reach denotes FINITE values only,
  // so any of them would exclude the value the operand actually has.
  if (x.type.matches('infinity')) return 'non_finite_number';
  // NaN's static type is just `number`, so the tier walk below cannot see
  // it — only the value channel can. Two pure value sources exist: a
  // literal's own `isNaN` (a cheap field read), and a symbol's held NUMBER
  // value, which a wide declaration can hide (`w: number := NaN` evaluates
  // |w| to NaN, which every tier claim below would wrongly exclude). A
  // held non-number value proves nothing and is left to the type walk.
  if (isNumber(x) && x.isNaN) return 'number';
  if (isSymbol(x)) {
    const held = x.valueDefinition?.value;
    if (held !== undefined && isNumber(held) && held.isNaN) return 'number';
  }
  // An APPLICATION can be provably NaN through the values it holds
  // (`Abs(hnan)` with `hnan: number := NaN`): proven non-finite with an
  // `unsigned` sign — a signed infinity would carry its sign — is the same
  // exclusion the descriptor twin performs, and without it the tier walk
  // below claims `real<0..>` for a value that is NaN.
  if (isFunction(x) && provablyNonFiniteNumber(x) && x.sgn === 'unsigned')
    return 'number';
  const t = x.type;
  // |x| also preserves the numeric TIER of a real operand: the magnitude of
  // an integer is an integer, of a rational a rational (`|−1/2| = 1/2`). A
  // *complex* finite operand — whose magnitude is real but neither rational
  // nor integer — matches no tier rung and lands on `real`.
  // |x| ≥ 0, and the type says so (ROADMAP "Ranged types should carry
  // sign…", work item 4): each tier claim carries its non-negative range,
  // so a type-channel consumer (`√|x|`, the GPU real-vs-complex lowering)
  // sees the sign the sgn handler always knew.
  // `absRange` tightens each tier claim with the operand's interval when
  // one exists (`|x|` for `x: real<-3..2>` is `real<0..3>`), and answers
  // the plain non-negative range `tier<0..>` otherwise — the
  // interval-arithmetic plan,
  // `docs/plans/2026-08-27-interval-arithmetic-result-types.md`.
  //
  // The tiers are walked tightest first, so an `integer` operand keeps the
  // integer tier that the exact-mode Map compile tier's integer-closedness
  // probe reads.
  //
  // The real tiers are tested DIRECTLY, not behind a finiteness gate:
  // matching a real tier is itself the finiteness proof, because every bare
  // name under `number` denotes finite values alone. It also degrades
  // gracefully — whatever a given lattice means by `real`, `|x|` of it is
  // the non-negative half of that same set.
  for (const tier of ['integer', 'rational', 'real'] as const)
    if (t.matches(tier)) return absRange(tier, t.type);
  // A finite operand that matched no real tier is complex, and the
  // magnitude of a finite complex number is a finite real that is neither
  // rational nor integer. (`absRange` finds no real interval on a complex
  // operand and answers the plain `real<0..>`.)
  if (t.matches('complex')) return absRange('real', t.type);
  // The operand is neither provably finite nor provably infinite, so `|x|`
  // is either a non-negative real or `+∞` — the only infinite magnitude
  // there is. NaN is NOT covered by this claim: the value guards above
  // exclude it wherever a value proves it, but an operand typed the top
  // `number` admits NaN and reaches here, and `|NaN| = NaN` falsifies the
  // claim. That hole is older than the finite-by-default numeric flip — the
  // claim made here before the flip, `real<0..>`, did not admit NaN either
  // — so closing it is a separate decision from carrying the `+∞`.
  return NON_NEGATIVE_REAL_OR_SIGNED_INFINITY_TYPE;
}

/**
 * `Max`/`Min`/`Supremum`/`Infimum`. These are data-consuming aggregates
 * (§3.C: an absent datum or empty input evaluates to NaN), so the base claim
 * is `number`. When every operand is a *scalar* number, though, no
 * empty/missing datum is possible — the result is one of the operands — and
 * the claim narrows to the join tier of the operand types. A collection
 * operand (which may be empty or contain `Missing`) keeps `number`.
 *
 * The ladder walks the numeric tiers from tightest to widest, so the first
 * rung every operand matches is the tightest true claim.
 *
 * An operand set containing a signed infinity matches no rung and takes the
 * top type. That is sound but loose — `max(+∞, 3)` really is `+∞`, so the
 * extended real line would be a tighter claim. It is left wide on purpose:
 * the differential parity harness for this handler
 * (`test/compute-engine/type-handler-shadow-parity.test.ts`) pins the
 * current answer against the pre-conversion expression shape, so tightening
 * it belongs with that harness's retirement, not with the lattice flip.
 */
export function extremumType(ops: ReadonlyArray<Expression>): Type {
  if (ops.length === 0) return 'number';
  if (!ops.every((x) => x.type.matches('number'))) return 'number';
  for (const t of ['integer', 'rational', 'real'] as const)
    if (ops.every((x) => x.type.matches(t))) return t;
  return 'number';
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
 * Result type of a big-op (`Sum`/`Product`) in its `(body, limits…)` form.
 * Elementwise accumulation over a collection-valued body yields the same
 * indexed-collection type: summing (or multiplying) a `vector<2>`-, `list<T>`-
 * or tuple-valued body gives that same collection type. A scalar body — or the
 * arity-1 reducer form `Sum(L)`, which sums a collection's elements to a
 * scalar — types as `number`.
 */
export function bigOpResultType(
  ops: ReadonlyArray<Expression>
): Type | BoxedType {
  const body = ops[0];
  if (ops.length > 1 && body?.type.matches('indexed_collection<any>'))
    return body.type;
  // A body that is only POSSIBLY a collection carries its `broadcastable<T>`
  // type through for the same reason: `broadcastable<T>` abbreviates the union
  // `T | indexed_collection<T>`, so it covers both the scalar accumulation and
  // the element-wise one, and the big-op cannot decide between them until the
  // body evaluates. A `Which` whose condition is a comparison the engine
  // cannot statically prove will broadcast (`comparisonResultType` in
  // `library/relational-operator.ts`) is the case that produces such a body.
  const bodyType = body?.type.type;
  if (
    ops.length > 1 &&
    bodyType !== undefined &&
    typeof bodyType !== 'string' &&
    bodyType.kind === 'broadcastable'
  )
    return body!.type;
  return 'number';
}

/**
 * Result type for the elementary/inverse trig and log functions, dispatched by
 * operator so that pole-capable and domain-restricted operators do not claim
 * `real` where their values are complex/infinite/NaN (SYM P0-12).
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
      return poleReciprocalType(operator, ops);

    // Pole-free hyperbolics at a provably real ±∞: `sinh`/`cosh` send it to
    // a PROVABLE ±∞/+∞ (`non_finite_number`), while `tanh(±∞) = ±1` and
    // `sech(±∞) = 0` are finite reals. (The circular Sin/Cos give NaN at ±∞
    // and correctly keep `number` via `numericTypeHandler`.)
    //
    // Realness is read from the TYPE, and it is EXTENDED realness: the bare
    // name `real` denotes the finite reals, so a `±∞` operand — which is
    // exactly what these two arms exist for — does not match it. Testing
    // `real` alone made both arms unreachable and sent `Sinh(∞)` to the top
    // type.
    //
    // This arm must claim a type that admits the value the call actually
    // produces, and `Sinh(NaN)`/`Tanh(NaN)` are NaN, which neither
    // `non_finite_number` nor `real` admits. NaN types `nan`, which is
    // outside the extended real line, while a real ±∞ types the `+oo`/`-oo`
    // singletons, which are inside it — so the type channel separates the two
    // cases. (A NaN literal used to answer the value predicate — then spelled
    // `isReal` — with `true`, which is how an `isReal` gate here once sent
    // `Sinh(NaN)` to `non_finite_number`. The renamed `isExtendedReal`
    // excludes NaN, so the value channel would now agree; the type channel is
    // kept because it also decides an operand that has no value to probe.)
    case 'Sinh':
    case 'Cosh':
      if (
        ops[0]?.isFinite === false &&
        ops[0].type.matches(EXTENDED_REAL_TYPE)
      )
        return 'non_finite_number';
      return numericTypeHandler(ops);
    case 'Tanh':
    case 'Sech':
      if (
        ops[0]?.isFinite === false &&
        ops[0].type.matches(EXTENDED_REAL_TYPE)
      )
        return 'real';
      return numericTypeHandler(ops);

    case 'Arcsin':
    case 'Arccos':
      return boundedInverseTrigType(ops, ARCSIN_DOMAIN);

    case 'Arcsec':
    case 'Arccsc':
      return boundedInverseTrigType(ops, ARCSEC_DOMAIN);

    case 'Arctan':
    case 'Arccot':
      return arctanType(ops);

    // Inverse hyperbolic functions with real poles / restricted real domains.
    // `artanh(±1) = ±∞`, `arcoth(±1) = ±∞`, `arsech(0) = +∞`, `arcsch(0) = ~oo`
    // are non-finite, and outside the real domain the value is complex, so
    // neither may claim `real`.
    case 'Artanh':
      return boundedInverseTrigType(ops, ARTANH_DOMAIN);
    case 'Arcoth':
      return boundedInverseTrigType(ops, ARCOTH_DOMAIN);
    case 'Arsech':
      return boundedInverseTrigType(ops, ARSECH_DOMAIN);
    case 'Arcsch':
      return boundedInverseTrigType(ops, ARCSCH_DOMAIN);
    case 'Arcosh':
      return boundedInverseTrigType(ops, ARCOSH_DOMAIN);

    default:
      return numericTypeHandler(ops);
  }
}

/**
 * `Adjoin(R, a, b, …)` — the ring `R` with `a`, `b`, … adjoined.
 *
 * Every element of the adjunction is a polynomial in the adjoined elements
 * with coefficients in `R`, so the smallest sound element type is the **join**
 * of the base ring's element type and the types of the adjoined elements:
 * `ℤ[√2]` is a set of finite reals, `ℤ[i]` a set of finite complexes, and
 * `ℤ[x]` (an indeterminate of unknown type) widens all the way to `unknown`.
 *
 * No non-finite value is introduced by adjunction, so no `non_finite_number`
 * claim is made (nor withheld): the finiteness of the result is exactly the
 * finiteness carried by the operands' own types.
 */
export function adjoinType(ops: ReadonlyArray<Expression>): Type {
  const base = ops[0];
  const baseElements =
    (base ? collectionElementType(base.type.type) : undefined) ?? 'unknown';
  const adjoined = ops.slice(1).map((x) => x.type.type);
  // `widen` treats `unknown` as "no information" and drops it, which would let
  // `ℤ[x]` (an INDETERMINATE) claim `set<integer>` — unsound, since the
  // elements are polynomials in `x`, not integers. An adjunct carrying no type
  // information takes the whole claim to `unknown`.
  if (baseElements === 'unknown' || adjoined.some((t) => t === 'unknown'))
    return { kind: 'set', elements: 'unknown' };
  return { kind: 'set', elements: widen(baseElements, ...adjoined) };
}

/**
 * `QuotientRing(R, m)` — the quotient of the ring `R` by the ideal generated
 * by `m` (`ℤ_n` = `ℤ/nℤ`).
 *
 * The residues are represented by elements of the base ring, so the element
 * type is the base's: `QuotientRing(Integers, n)` is a `set<integer>`.
 * The quotient is never larger than the base, so this is an upper bound in
 * both directions and introduces no non-finite value.
 */
export function quotientRingType(ops: ReadonlyArray<Expression>): Type {
  const base = ops[0];
  const elements =
    (base ? collectionElementType(base.type.type) : undefined) ?? 'unknown';
  return { kind: 'set', elements };
}
