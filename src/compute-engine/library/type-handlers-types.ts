import type { OperandDescriptor, Sign } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeFact } from '../boxed-expression/operand-descriptor.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import {
  collectionElementType,
  nonNegativeRangeType,
  widen,
} from '../../common/type/utils.js';
import {
  negativeSign,
  nonNegativeSign,
  nonPositiveSign,
  positiveSign,
} from '../boxed-expression/sgn.js';

/**
 * The `'types'`-shape twins of the shared type-handler helpers in
 * `library/type-handlers.ts`.
 *
 * A type handler declared with `typeHandlerKind: 'types'` receives an
 * `OperandDescriptor` per operand instead of the operand expression, so it
 * can neither declare, canonicalize nor evaluate anything while deriving a
 * type. The helpers below are the descriptor-taking counterparts of the
 * expression-taking helpers the numeric families (`arithmetic`,
 * `trigonometry`, `special-functions`, `statistics`) share today. Both
 * shapes coexist for the duration of the handler migration; when the
 * expressions shape is retired this file replaces `type-handlers.ts`, and
 * the helper names are deliberately the same so that a converted call site
 * only changes its import path.
 *
 * A descriptor carries strictly less than an expression, in three places
 * that matter here (they are the reason several helpers below are wider
 * than their twin rather than equal):
 *
 * - The sign of a function APPLICATION comes only from that application's
 *   result type. The operator `sgn` handlers are never invoked while a type
 *   is derived, so a compound whose sign only a `sgn` handler knows —
 *   `Sqrt(Abs(x))`, `Negate(Floor(Abs(x)))` — answers `undefined` where the
 *   expression channel answered `non-negative` / `non-positive`.
 * - An assumption whose bound no machine number represents
 *   (`assume(x > 1/3)`) records a sign but neither a range in the type nor
 *   a machine bound in `facts.bounds`, so a magnitude comparison that the
 *   assumptions system could decide stays undecided. (A MACHINE-number
 *   assumption bound does reach the descriptor — `facts.bounds`, with its
 *   strictness — which is how a strict-assumed symbol still proves
 *   membership in an open domain.)
 * - Equality and ordering against an arbitrary constant are decided here
 *   from the operand's ranged type, its assumption bounds, and, for a
 *   number literal, its value type. There is no evaluation, so a compound
 *   whose value only evaluation would reveal stays undecided.
 *
 * In every branch below, a proof that the descriptor cannot reach must
 * steer the claim toward the WIDER type. Where it would steer narrower the
 * branch is marked, because a narrower claim is unsound with respect to the
 * expression-shape baseline.
 *
 * These helpers follow the same **non-finite typing convention** as their
 * expression-shape twins (documented in `ARCHITECTURE.md`, § "Non-finite
 * typing convention for type handlers"):
 *
 * - Claim `non_finite_number` only when the value is PROVABLY `±∞`
 *   (e.g. `Ln(0) = −∞`, `±∞ · (provably non-zero reals)`).
 * - When a non-finite value (`±∞`, `~oo`) or NaN is merely POSSIBLE, claim
 *   `number` — never `non_finite_number` speculatively, and never a finite
 *   type. `~oo` and NaN are representable only by `number`.
 * - An operand of *unknown* finiteness (a bare `real` symbol) is treated as
 *   a generic (finite) point; zero-ness, by contrast, must be *proven*
 *   absent (via the sign) for claims that depend on it.
 */

/**
 * The sign of an operand as a `'types'`-shape handler may read it.
 *
 * The descriptor already computed the audited pure-source cascade: the
 * value channel first (a number literal's value, a symbol's held numeric
 * value, an assumption recorded by `ce.assume`), then the sign the type
 * itself proves (a literal's value type, a ranged declaration such as
 * `assume(x > 0)` produces, a ranged result type such as `Abs`'s
 * `real<0..>`). Handlers combine this with the `Sign` predicates
 * (`positiveSign(operandSgn(d)) === true`), exactly as the expression-shape
 * helpers do.
 *
 * What is missing relative to the expression channel is the operator `sgn`
 * handlers: a compound whose sign is known only to its head's `sgn` handler
 * and whose result type carries no range answers `undefined` here.
 */
export function operandSgn(d: OperandDescriptor): Sign | undefined {
  return d.facts.sgn;
}

/**
 * The type a `broadcastable` operator's `type` handler must gate on for ONE
 * SCALAR element of its operand.
 *
 * A broadcastable operator applied to a collection is mapped over it, and the
 * result-typing call site re-adds the operand's entire lifted shape around
 * whatever the handler returns — so the handler's job is to describe a single
 * scalar, and its gates must read the fully unwrapped element type. Gating on
 * the collection type itself would decide every question the wrong way
 * (`list<finite_real>` is not a subtype of `real`), and unwrapping only ONE
 * rank would do the same for every operand of rank two or more: one unwrap of
 * `matrix<real^(2x2)>` yields the ROW type `list<real^2>`, which proves
 * nothing about a scalar either. Broadcast is elementwise all the way down,
 * so the unwrapping is too.
 *
 * The loop stops on any type that is not a collection — that includes a
 * collection whose element type is unknown, which answers with a type no
 * narrowing gate proves, so the handler falls back to its wide claim. It also
 * stops on a type that is its own element type, so a self-referential element
 * type cannot spin here.
 *
 * A `broadcastable<T>` operand is unwrapped as well. Its `collection` fact is
 * `undefined` — the type abbreviates the union `T | indexed_collection<T>`,
 * so whether the operand IS a collection is exactly what is not yet known —
 * but either way the handler still describes one element, and the call site
 * still re-wraps.
 *
 * Scalar operands pass through unchanged, so this is safe to apply
 * unconditionally in a broadcastable operator's handler.
 *
 * The premise that the call site re-wraps the shape holds for INDEXED
 * collections — lists, vectors, matrices — which are what broadcast maps
 * over. `collectionElementType` descends more than that: it also yields an
 * element type for tuples, sets, dictionaries, records and strings, which
 * broadcast does NOT map over, so nothing re-wraps their shape and the
 * handler's scalar claim is returned as the whole result. `Sinc(Tuple(1,2))`
 * therefore types `finite_real` while staying symbolic. That is the same
 * answer the retired constant handler gave, so it is kept deliberately
 * rather than corrected here; changing it belongs with the broadcast call
 * site, which is what decides which operand shapes are lifted.
 */
export function broadcastOperandType(x: OperandDescriptor): Type {
  let t = x.type;
  if (x.facts.collection !== true && !isBroadcastableType(t)) return t;
  while (true) {
    const elements = collectionElementType(t);
    if (elements === undefined || elements === t) return t;
    t = elements;
  }
}

/** Is this the `broadcastable<T>` type constructor? */
function isBroadcastableType(t: Type): boolean {
  return typeof t === 'object' && t.kind === 'broadcastable';
}

/**
 * Result type of a step function that is defined on the REAL line only:
 * `Heaviside` (0, 1/2, 1) and `Sign` (−1, 0, 1). On the reals the value is
 * one of finitely many finite numbers, at the ends of the line included
 * (`H(−∞) = 0`, `Sign(+∞) = 1`), so a proven real argument has a finite
 * value of the tier the caller names in `onReal`.
 *
 * Nothing else has a value at all: neither step function is defined at NaN,
 * at `~oo`, or off the real line (where `Sign`'s usual convention `z/|z|`
 * would be complex, not an integer), and no finite type admits those. So the
 * gate narrows only on a PROVEN real, and an argument whose type cannot
 * decide realness keeps the wide `number` — the non-finite typing convention.
 * The claim is per-element: both operators are broadcastable.
 */
export function realOnlyStepType(
  x: OperandDescriptor | undefined,
  onReal: Type
): Type {
  if (x === undefined) return 'number';
  return typeFact(broadcastOperandType(x), 'real') === true ? onReal : 'number';
}

/**
 * Is this descriptor a number LITERAL? The structural view answers `number`
 * for a literal and nothing else, which is the same population the
 * expression-shape helpers select with `isNumber(x)`. A synthetic
 * descriptor (built from a type alone, with no structural view) answers
 * `false`, which routes it exactly as a SYMBOL of the same type — the
 * population a type-only descriptor stands for, and the same route the
 * expression shape takes for such a symbol.
 *
 * That is not the same as saying every literal-only fast path below is a
 * narrowing one, so that declining always widens. Most are: a value
 * decides a magnitude (`boundedInverseTrigType`) or a parity
 * (`operandIsEven`) the type cannot, and declining loses precision only.
 * But the non-literal route can also run gates a literal never reaches,
 * and one of those gates reads a fact a synthetic descriptor lacks — see
 * the marking on the `facts.closed` gate in `poleReciprocalType`.
 */
function isNumberLiteral(d: OperandDescriptor): boolean {
  return d.structureOf?.()?.kind === 'number';
}

/** The machine value a value type or a singleton range carries, if any. */
function valueOfType(t: Type): number | undefined {
  if (typeof t === 'string') return undefined;
  if (t.kind === 'value' && typeof t.value === 'number') return t.value;
  if (t.kind === 'numeric' && typeof t.lower === 'number' && t.lower === t.upper)
    return t.lower;
  return undefined;
}

/**
 * The machine value carried by a number literal's handler-visible type: a
 * value type's value, or a singleton range's bound. `undefined` for
 * symbols, compound expressions, and literals whose exact value no machine
 * number holds (`1/3`, `√2`, a bigint beyond ±2⁵³ — those carry only their
 * sign).
 *
 * The literal gate matters: a descriptor's type is the operand's
 * handler-visible type, so a SYMBOL declared with a singleton range
 * (`real<2..2>`) also carries a value here, where the expression-shape
 * helper — which reads a number literal's `_literalType` and nothing else —
 * answers `undefined`. Gating on the structural view keeps the two
 * answering the same thing. Code that wants the symbol's bound too should
 * use the bounds helpers below, which are explicit about reading the type.
 */
export function operandLiteralValue(
  d: OperandDescriptor
): number | undefined {
  if (!isNumberLiteral(d)) return undefined;
  return valueOfType(d.type);
}

/**
 * Is this operand's value a provably even (or odd) integer?
 *
 * Only the literal-value channel answers: there is no even/odd type, so a
 * symbol's parity — which the expression-shape twin could get from
 * `x.isEven` consulting the assumptions system and the value of a held
 * expression — is not reachable from a descriptor. Every consumer of this
 * helper branches on `=== true`, so the lost proof widens the claim.
 */
export function operandIsEven(d: OperandDescriptor): boolean | undefined {
  const v = operandLiteralValue(d);
  if (v !== undefined && Number.isInteger(v)) return v % 2 === 0;
  return undefined;
}

export function operandIsOdd(d: OperandDescriptor): boolean | undefined {
  const even = operandIsEven(d);
  return even === undefined ? undefined : !even;
}

/**
 * Is this operand a provably non-finite NUMBER (`±∞`, `~oo` or NaN)?
 *
 * The descriptor twin of `provablyNonFiniteNumber`
 * (`boxed-expression/numerics.ts`): `facts.finite` is `false` only when a
 * pure source proved the operand is a number that is not finite — a
 * `non_finite_number` type, a `±∞`/NaN literal, or a symbol holding such a
 * value behind a wider declaration. It is never `false` merely because the
 * operand is not a number at all (a tuple, a list, a `set | number` union),
 * which is the conflation the expression-shape helper has to exclude with
 * an extra `type.matches('number')` qualifier.
 */
export function operandNonFiniteNumber(d: OperandDescriptor): boolean {
  return d.facts.finite === false;
}

/**
 * May this operand be NaN, as far as the descriptor can tell?
 *
 * NaN types `number` (there is no NaN tier) and its sign is `unsigned`, and
 * so — exactly — does complex infinity: `NaN` and `~oo` produce identical
 * descriptors. A handler that must exclude NaN therefore has to treat `~oo`
 * as possibly-NaN too, which widens its claim on a `~oo` operand and is the
 * sound direction (NaN is a member of `number` only).
 */
function mayBeNaN(d: OperandDescriptor): boolean {
  return d.facts.finite === false && d.facts.sgn === 'unsigned';
}

/**
 * The closed real interval `[lo, hi]` that the operand's type guarantees,
 * with `±Infinity` for an unbounded end. A range on the numeric bases
 * `number`, `complex`, `finite_complex` and `imaginary` is discarded: an
 * ordering bound says nothing about a value that need not be real. The
 * exclusion list is the one `signOfType` uses, copied so the two agree,
 * and — like it — it is not a complete list of the non-real bases:
 * `finite_number` also admits finite complex values, and a
 * `finite_number<a..b>` would be read here as the real interval `[a, b]`.
 * Nothing constructs a ranged `finite_number` (every range the engine
 * attaches sits on a real tier), and the one caller that does not first
 * prove its operand real — `logType`'s base gate — requires a positive
 * sign, which such a type could only obtain from the same list. A caller
 * that compares an operand it has neither proven real nor proven signed
 * must add `finite_number` to the exclusion list first.
 *
 * Range endpoints in the type lattice are inclusive; a strict bound is
 * carried separately, as an intersection with a negated value type —
 * `(real<0..>) & !0` is "positive", `(real<0..1>) & !0 & !1` the open unit
 * interval. The zero exclusion reaches the comparisons through the sign;
 * an exclusion at any other endpoint is read by `typeExcludesValue`, which
 * the `provably*` helpers combine with a closed bound AT that endpoint to
 * prove the strict comparison.
 */
function typeBounds(
  t: Type,
  seen?: Set<object>
): { lo: number; hi: number } {
  const ALL = { lo: -Infinity, hi: Infinity };
  if (typeof t === 'string') return ALL;
  switch (t.kind) {
    case 'value':
      return typeof t.value === 'number' && !Number.isNaN(t.value)
        ? { lo: t.value, hi: t.value }
        : ALL;
    case 'numeric':
      if (
        t.type === 'number' ||
        t.type === 'complex' ||
        t.type === 'finite_complex' ||
        t.type === 'imaginary'
      )
        return ALL;
      return { lo: t.lower ?? -Infinity, hi: t.upper ?? Infinity };
    case 'reference': {
      // A TRANSPARENT alias is semantically its definition; a nominal
      // reference stays opaque. The `seen` set breaks a recursive alias.
      if (!t.alias || t.def === undefined) return ALL;
      seen ??= new Set();
      if (seen.has(t)) return ALL;
      seen.add(t);
      return typeBounds(t.def, seen);
    }
    case 'intersection': {
      // Every member must admit the value, so the bounds are the tightest
      // of the members'.
      let lo = -Infinity;
      let hi = Infinity;
      for (const m of t.types) {
        const b = typeBounds(m, seen);
        if (b.lo > lo) lo = b.lo;
        if (b.hi < hi) hi = b.hi;
      }
      return { lo, hi };
    }
    case 'union': {
      // Any member may admit the value, so the bounds are the loosest of
      // the members'. A member with no bound at all makes the union
      // unbounded, which the loosest-of rule already produces.
      let lo = Infinity;
      let hi = -Infinity;
      for (const m of t.types) {
        const b = typeBounds(m, seen);
        if (b.lo < lo) lo = b.lo;
        if (b.hi > hi) hi = b.hi;
      }
      return lo > hi ? ALL : { lo, hi };
    }
    default:
      return ALL;
  }
}

/**
 * Three-valued magnitude comparisons against a machine constant `k`, from
 * the operand's ranged type (a closed bound AT `k` combined with a type
 * exclusion of `k` — `(real<0..1>) & !1` — proves the strict comparison),
 * its literal value, its assumption bounds (`facts.bounds`, which carry a
 * strict bound the assumption refinement did not spell into the type), and
 * — for `k = 0` only, the one comparison a sign decides — its sign.
 * `false` here means "not proven", never "proven otherwise": every caller
 * treats anything but `true` as undecided.
 */
/**
 * Does the type PROVE the value is not `k`? A negated value type in an
 * intersection does (`(real<0..1>) & !1` excludes 1 — the lattice's
 * spelling of an open endpoint); a transparent alias answers for its
 * definition; a union excludes `k` only when every member does.
 * Deliberately conservative: `false` means "not proven", never "admits
 * `k`".
 */
function typeExcludesValue(t: Type, k: number, seen?: Set<object>): boolean {
  if (typeof t === 'string') return false;
  switch (t.kind) {
    case 'negation':
      // Membership of `k` in the NEGATED type proves the exclusion — not
      // just the exact `!k` node: the type reducer folds sibling
      // exclusions by De Morgan (`!0 & !1` → `!(0 | 1)`), and a negated
      // range (`!(real<1..2>)`) excludes every value it covers.
      return isSubtype({ kind: 'value', value: k }, t.type);
    case 'intersection':
      return t.types.some((m) => typeExcludesValue(m, k, seen));
    case 'union':
      return t.types.every((m) => typeExcludesValue(m, k, seen));
    case 'reference': {
      if (!t.alias || t.def === undefined) return false;
      seen ??= new Set();
      if (seen.has(t)) return false;
      seen.add(t);
      return typeExcludesValue(t.def, k, seen);
    }
    default:
      return false;
  }
}

function provablyGreater(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v > k;
  if (k === 0 && positiveSign(d.facts.sgn) === true) return true;
  const b = d.facts.bounds;
  if (
    b?.lower !== undefined &&
    (b.lower > k || (b.lower === k && b.lowerStrict === true))
  )
    return true;
  const tb = typeBounds(d.type);
  if (tb.lo > k) return true;
  // A closed bound AT `k` plus an exclusion OF `k` is the lattice's strict
  // bound: `(real<1..>) & !1` proves > 1.
  return tb.lo === k && typeExcludesValue(d.type, k);
}

function provablyGreaterEqual(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v >= k;
  if (k === 0 && nonNegativeSign(d.facts.sgn) === true) return true;
  if ((d.facts.bounds?.lower ?? -Infinity) >= k) return true;
  return typeBounds(d.type).lo >= k;
}

function provablyLess(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v < k;
  if (k === 0 && negativeSign(d.facts.sgn) === true) return true;
  const b = d.facts.bounds;
  if (
    b?.upper !== undefined &&
    (b.upper < k || (b.upper === k && b.upperStrict === true))
  )
    return true;
  const tb = typeBounds(d.type);
  if (tb.hi < k) return true;
  // Closed-at-`k` bound plus exclusion of `k`: the lattice's strict bound.
  return tb.hi === k && typeExcludesValue(d.type, k);
}

function provablyLessEqual(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v <= k;
  if (k === 0 && nonPositiveSign(d.facts.sgn) === true) return true;
  if ((d.facts.bounds?.upper ?? Infinity) <= k) return true;
  return typeBounds(d.type).hi <= k;
}

/** Is the operand provably equal to the machine constant `k`? A literal's
 * value decides it; otherwise only a singleton range in the type does. */
function provablyEquals(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v === k;
  const b = typeBounds(d.type);
  return b.lo === b.hi && b.lo === k;
}

/** Is the operand provably DIFFERENT from the machine constant `k`? A
 * literal's value decides it; otherwise `k` outside the type's bounds or
 * the assumption bounds (a strict bound AT `k` counts), a type exclusion
 * of `k` (`… & !k`), or a sign that excludes `k`'s half-line, proves it. */
function provablyDiffers(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v !== k;
  if (typeExcludesValue(d.type, k)) return true;
  const ab = d.facts.bounds;
  if (ab !== undefined) {
    if (
      ab.lower !== undefined &&
      (k < ab.lower || (k === ab.lower && ab.lowerStrict === true))
    )
      return true;
    if (
      ab.upper !== undefined &&
      (k > ab.upper || (k === ab.upper && ab.upperStrict === true))
    )
      return true;
  }
  const b = typeBounds(d.type);
  if (k < b.lo || k > b.hi) return true;
  const s = d.facts.sgn;
  if (k > 0) return nonPositiveSign(s) === true;
  if (k < 0) return nonNegativeSign(s) === true;
  return s === 'not-zero' || positiveSign(s) === true || negativeSign(s) === true;
}

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
export function numericTypeHandler(
  ops: ReadonlyArray<OperandDescriptor>
): Type {
  if (ops.some((d) => operandNonFiniteNumber(d))) return 'number';
  if (ops.every((d) => typeFact(d.type, 'real') === true)) return 'finite_real';
  return 'finite_number';
}

/**
 * Logarithms (`Ln`, `Log`, `Lb`, `Lg`). `log(x)` of a *positive* real is real;
 * of `0` is −∞; of a *negative* real is complex. A non-1 positive finite base
 * is required for the real claim.
 */
function logType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const x = ops[0];
  const base = ops[1];
  if (!x) return 'number';
  // A NaN argument is absorbed here: `facts.finite === false` holds for a
  // NaN literal exactly as it does for `±∞` and `~oo`, and all three give
  // the top type.
  if (operandNonFiniteNumber(x)) return 'number';
  const xSgn = operandSgn(x);
  // A base of 1 is not a base at all (`log_1` has no value: `1^y = 1` for
  // every y), so non-1-ness must be PROVEN, not merely un-disproven.
  // `operandLiteralValue` answers `undefined` for every non-literal, so a
  // `!== 1` test on it would accept any positive finite compound —
  // including `Exp(r)`, whose type `finite_real<0..> & !0` proves positive
  // and finite yet whose value IS 1 at r = 0, and `Log(4, Exp(0)).N()` is
  // `+oo`. `provablyDiffers` requires the type's bounds or its sign to
  // exclude 1, so an operand that may be 1 makes the base unusable and the
  // claim widens to `number`.
  const usableBase = (b: OperandDescriptor): boolean =>
    positiveSign(operandSgn(b)) === true &&
    b.facts.finite === true &&
    provablyDiffers(b, 1);
  // A provably-zero argument is the log pole, with a *provably* ±∞ value:
  // `ln(0) = −∞`, and `log_b(0) = ∓∞` for any valid base (positive, finite,
  // ≠ 1). Per the non-finite typing convention this provable case claims
  // `non_finite_number`; an unusable base widens to `number`.
  if (operandLiteralValue(x) === 0) {
    if (base === undefined || usableBase(base)) return 'non_finite_number';
    return 'number';
  }
  // A provably non-positive argument that may be 0 → −∞ pole (`ln(0)`).
  //
  // This gate widens the claim to `number` on a proven non-positive sign.
  // The descriptor's sign fact covers the case that once made wiring this
  // to the log heads unsound — a sign only an operator `sgn` handler knows
  // (`Negate(Floor(Abs(x)))`, whose result type is a bare
  // `finite_integer`) — because `describe()` consults those handlers for
  // applications (open item O7 of
  // `docs/plans/2026-08-22-type-handlers-on-types.md`); the divergence
  // table in `test/compute-engine/type-handler-twins.test.ts` is empty, so
  // `Ln` and `Log` are wired to this handler (`Lb`/`Lg`/`Log2`/`Log10`
  // canonicalize to `Log` and have no type handler of their own).
  if (positiveSign(xSgn) === false && negativeSign(xSgn) !== true)
    return 'number';
  if (base && !usableBase(base)) return 'number';
  // Provably negative finite argument: `ln(x) = ln|x| + iπ` (e.g.
  // `ln(−1) = iπ`) — a finite complex value.
  if (negativeSign(xSgn) === true) return 'finite_complex';
  // Provably positive (hence real, and finite per the check above): real.
  if (positiveSign(xSgn) === true) return 'finite_real';
  // Sign unknown: the value may be real (x > 0), −∞ (x = 0) or finite
  // complex (x < 0) — the join is `complex`, which admits ±∞ (D10 lattice).
  // `complex` excludes NaN, so it is only sound when the operand's type does
  // too (`ln(NaN) = NaN`): an operand that may be NaN (`number`,
  // `finite_number` — the latter is not a lattice subtype of `complex`)
  // keeps the top type.
  return typeFact(x.type, 'complex') === true ? 'complex' : 'number';
}

/**
 * `Tan`/`Sec`/`Csc`/`Cot` (and the hyperbolic reciprocals `Coth`/`Csch`,
 * poles at 0): a pole value is `~oo`, representable only by the top type
 * (the lattice's `non_finite_number` is ±∞ only), so an argument that may
 * sit on a pole claims `number`.
 *
 * The poles of Tan/Sec are the odd multiples of π/2 and those of Csc/Cot the
 * multiples of π — all irrational except 0 (a Csc/Cot/Csch/Coth pole only).
 * A number literal therefore never lands on a nonzero pole, and a symbolic
 * real keeps the generic-point convention (the pole set has measure zero) —
 * with zero-ness, the one *provable* pole, required to be disproven for the
 * zero-pole operators.
 *
 * ±∞: the circular functions give NaN (→ `number`), while `coth(±∞) = ±1`
 * and `csch(±∞) = 0` are finite reals.
 */
function poleReciprocalType(
  operator: string,
  ops: ReadonlyArray<OperandDescriptor>
): Type {
  const x = ops[0];
  if (!x) return 'number';
  const hyperbolic = operator === 'Coth' || operator === 'Csch';
  // A NaN argument needs no separate test: NaN types `number`, which does
  // not prove `real`, so the non-finite arm below gives it the top type
  // even for the hyperbolic heads whose value at a real ±∞ is finite.
  if (operandNonFiniteNumber(x))
    return hyperbolic && typeFact(x.type, 'real') === true
      ? 'finite_real'
      : 'number';
  if (typeFact(x.type, 'real') !== true) return 'number';
  // Only the pole at 0 is reachable by a number literal (every other pole is
  // an irrational multiple of π, which no literal — rational, float, or
  // radical — equals).
  const poleAtZero = operator !== 'Tan' && operator !== 'Sec';
  if (isNumberLiteral(x)) {
    // A literal whose exact value no machine number holds (`1/3`, `√2`) has
    // no value here — and is not 0 either, so it is off every pole.
    return poleAtZero && operandLiteralValue(x) === 0 ? 'number' : 'finite_real';
  }
  // A non-literal CONSTANT (π/2, 2π/3, …) can sit exactly on a circular pole
  // — `Tan(π/2) = ~oo`, `Csc(π) = ~oo` — so it keeps `number`. The
  // hyperbolic poles are only at 0, where the sign check below decides.
  //
  // NARROWER ON A SYNTHETIC DESCRIPTOR: this is a WIDENING branch gated on
  // `closed`, and `describeType()` — which builds a descriptor from a type
  // alone — always leaves `closed` undefined, so such a descriptor skips
  // the branch and claims `finite_real` for a value that may be an exact
  // pole. Every call site today passes a `describe()` descriptor built from
  // a real operand, where `closed` is populated from the structural view; a
  // recursive derivation that ever routes a type-only descriptor into this
  // helper has to widen here instead of falling through.
  if (!hyperbolic && x.facts.closed === true) return 'number';
  if (!poleAtZero) return 'finite_real';
  // Zero-pole operators on a symbolic real: the pole at 0 — the one provable
  // pole — must be disproven; the rest of the pole set has measure zero
  // (generic-point convention).
  const s = operandSgn(x);
  if (positiveSign(s) === true || negativeSign(s) === true)
    return 'finite_real';
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
 * `finite_real` for an argument that is not provably in-domain is unsound —
 * `finite_complex` does not match `finite_real`. The handler below therefore
 * decides three ways (user ruling 2026-07-30):
 *
 * - argument provably in `real`    → `finite_real`  (tight)
 * - argument provably in `complex` → `finite_complex`
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
   * (`artanh(1) = +∞`), `complex` for `~oo` (a member of `complex` per the
   * D10 lattice, though not of `non_finite_number`), `number` when the pole
   * value may be NaN.
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
 * Is the operand **provably** inside one of `intervals`?
 *
 * The expression shape asks the numeric predicates, which consult the
 * assumptions system (`x ≥ 2` ⊢ `x.isGreater(1) === true`). Here the proof
 * comes from the operand's ranged type, its literal value, and its sign, so
 * two proofs the predicates could make are unreachable: a bound recorded as
 * an assumption but not as a range (`assume(x > 1/3)` leaves type `real`),
 * and the value of a symbol that holds one (`a := 5` keeps type `integer`,
 * because an assigned symbol is checked, never narrowed). Both losses make
 * the containment fail, which widens the claim.
 *
 * The traffic runs the other way too. A range that came from a
 * DECLARATION — `ce.declare('BIG', 'real<2..>')` — records no assumption,
 * and `Expression.isGreaterEqual` answers from the assumptions system, so
 * the expression shape says `undefined` where the bounds read here prove
 * containment outright. The twin's claim is then NARROWER: sound and
 * tighter. Adopting those tighter claims was ruled (2026-08-25) when the
 * bounded inverse heads converted — they are the one family whose
 * conversion changed derived types, and they run no shadow parity for
 * that reason. (A symbol ranged by `ce.assume` carries both channels,
 * which is why those rows agree.) Every changed row is recorded in
 * `test/compute-engine/type-handler-twins.test.ts`.
 */
function provablyIn(
  d: OperandDescriptor,
  intervals: readonly RealInterval[]
): boolean {
  return intervals.some(({ lo, loClosed, hi, hiClosed }) => {
    if (
      lo !== -Infinity &&
      !(loClosed ? provablyGreaterEqual(d, lo) : provablyGreater(d, lo))
    )
      return false;
    if (
      hi !== Infinity &&
      !(hiClosed ? provablyLessEqual(d, hi) : provablyLess(d, hi))
    )
      return false;
    return true;
  });
}

export function boundedInverseTrigType(
  ops: ReadonlyArray<OperandDescriptor>,
  domain: RealDomain
): Type {
  const x = ops[0];
  if (!x || operandNonFiniteNumber(x)) return 'number';
  if (typeFact(x.type, 'real') !== true) return 'number';

  // Fast path: a (finite) real LITERAL classifies by arithmetic alone,
  // without going through the comparison machinery. Rounding to machine
  // precision can land an exact value (`1 + 10⁻²⁰`, a bignum `1 − 10⁻³⁰`)
  // EXACTLY ON a pole or interval endpoint — never strictly past one
  // (round-to-nearest moves a value at most half an ulp, so the only double
  // reachable across a representable boundary is the boundary itself). The
  // literal value read here is exact by construction — it is `undefined`
  // rather than rounded whenever no machine number holds the value — so no
  // boundary correction is needed, but the boundary test is kept so that a
  // value ON a boundary takes the interval-membership route below, which
  // states the open/closed ends explicitly.
  const r = operandLiteralValue(x);
  if (typeof r === 'number' && Number.isFinite(r)) {
    const onBoundary =
      domain.poles.includes(r) ||
      domain.real.some(({ lo, hi }) => r === lo || r === hi) ||
      domain.complex.some(({ lo, hi }) => r === lo || r === hi);
    if (!onBoundary) {
      if (containsNumber(domain.real, r)) return 'finite_real';
      if (containsNumber(domain.complex, r)) return 'finite_complex';
      return domain.poleType;
    }
  }

  if (domain.poles.some((p) => provablyEquals(x, p))) return domain.poleType;
  if (provablyIn(x, domain.real)) return 'finite_real';
  if (provablyIn(x, domain.complex)) return 'finite_complex';
  // Magnitude unknown: the join of what remains. A pole that is provably
  // avoided (or a head with no real pole) drops the non-finite arm.
  if (domain.poles.every((p) => provablyDiffers(x, p))) return 'finite_complex';
  // The join of `finite_complex` with the pole value: ±∞ and ~oo are both
  // members of `complex` (D10 lattice: `complex` admits `non_finite_number`
  // and `~oo`), so only a NaN-capable pole (`poleType: 'number'`) forces the
  // top type.
  return domain.poleType === 'number' ? 'number' : 'complex';
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
 * Mathematically the pole value is `~oo`, and `~oo` IS a member of `complex`
 * (D10 lattice), which would make `complex` the tight pole claim. But the
 * numeric evaluator currently yields **NaN** at 0 (`arcsec(0).N() → NaN`;
 * exact `evaluate()` stays symbolic), and NaN is a member only of `number`.
 * A type claim must not exclude a value the operator actually produces, so
 * the sound pole claim — and hence the unknown-magnitude join — is `number`.
 * Restoring `complex` requires first changing `Arcsec`/`Arccsc` evaluation to
 * produce `~oo` at the pole.
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
 * so any real argument — provably infinite ones included — → `finite_real`.
 * The only poles are at ±i, so a non-real or unknown-realness argument can be
 * complex infinity (`arctan(i) = ~oo`, `arctan(~oo)`) → the final `number`.
 *
 * A NaN argument needs no separate test here: NaN types `number`, which does
 * not prove `real`, so it takes the final `number` — where the expression
 * shape needs an explicit `isNaN` guard, because a NaN literal's `isReal`
 * answers `true`.
 */
function arctanType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const x = ops[0];
  if (!x) return 'number';
  if (typeFact(x.type, 'real') === true) return 'finite_real';
  return 'number';
}

/**
 * Γ-family result type (`Gamma`, `GammaLn`, `Digamma`, `Trigamma`,
 * `PolyGamma`): poles at the non-positive integers, where the value is `~oo`
 * (`+∞` for `GammaLn`) — not representable by any finite type nor by
 * `non_finite_number` (for `~oo`), so a *provably* non-positive-integer
 * argument claims `number`. An integer of unknown sign keeps the
 * generic-point convention (via `numericTypeHandler`).
 *
 * NARROWER THAN THE EXPRESSION SHAPE WHEN THE SIGN IS ONLY A `sgn`
 * HANDLER'S: the pole gate widens the claim to `number` on a PROVEN
 * non-positive sign. The descriptor's sign fact covers the case that once
 * made wiring this to the Γ family unsound — a sign only an operator
 * `sgn` handler knows (`Negate(Floor(Abs(x)))`, whose result type is a
 * bare `finite_integer`) — because `describe()` consults those handlers
 * for applications (open item O7 of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`); the divergence
 * table in `test/compute-engine/type-handler-twins.test.ts` is empty, so
 * the Γ-family operators (`Gamma`, `GammaLn`, `Digamma`, `Trigamma`,
 * `PolyGamma`) are wired to it (`PolyGamma` gates inline on its second
 * operand and falls back to `numericTypeHandler`, mirroring its legacy
 * shape).
 */
export function gammaPoleType(x: OperandDescriptor | undefined): Type {
  if (!x) return 'number';
  if (
    typeFact(x.type, 'integer') === true &&
    nonPositiveSign(operandSgn(x)) === true
  )
    return 'number';
  return numericTypeHandler([x]);
}

/**
 * Rounding family (`Round`, `Ceil`, `Floor`, `Truncate`), which extends
 * component-wise to complex arguments (Gaussian rounding):
 * - NaN → NaN, and a non-finite argument that may be `~oo` (or a non-finite
 *   complex) → `number`;
 * - a provably real ±∞ maps to itself: `non_finite_number` (provable);
 * - a *provably* non-real argument rounds component-wise → `finite_complex`
 *   (widened to `number` when its finiteness is not established);
 * - otherwise (real or unknown, finiteness unknown = generic point) →
 *   `finite_integer`.
 *
 * Non-realness must be PROVEN, not merely un-disproven. For a non-literal
 * the proof is a type that excludes the reals; reading a mere "not provably
 * real" as "complex" made `Round(4Q)` (Q undeclared, so `finite_number`)
 * type `number` while the strictly less informative `Round(Q)` typed
 * `finite_integer` — more knowledge about the operand yielding a weaker
 * result.
 *
 * For a number LITERAL the proof is the sign: `unsigned` means the value has
 * an imaginary part or is NaN, and NaN is already excluded by the non-finite
 * arm above, so a finite literal of sign `unsigned` is exactly a non-real
 * one. The type does not answer this — `1 + 2i` types `finite_complex`,
 * which is not disjoint from `real` — so the sign is the channel that
 * carries a literal's non-realness here.
 */
export function roundingFunctionType(
  x: OperandDescriptor | undefined
): Type {
  if (!x) return 'number';
  if (operandNonFiniteNumber(x))
    return typeFact(x.type, 'real') === true ? 'non_finite_number' : 'number';
  const provablyNonReal = isNumberLiteral(x)
    ? x.facts.sgn === 'unsigned'
    : typeFact(x.type, 'imaginary') === true;
  if (provablyNonReal)
    return x.facts.finite === true || typeFact(x.type, 'finite_number') === true
      ? 'finite_complex'
      : 'number';
  return 'finite_integer';
}

/**
 * `Abs` — |x| is a non-negative real whose finiteness follows the operand:
 * |±∞| = |~oo| = +∞, |NaN| = NaN, and a finite x (real or complex) has a
 * finite magnitude. `finite_real` is only claimed when finiteness is
 * *provable from the static type* so downstream finiteness guards (e.g.
 * `Multiply`'s ∞·0 protection in its sgn handler) can rely on it; an
 * operand of unknown finiteness keeps the signature's `real`.
 *
 * WIDER THAN THE EXPRESSION SHAPE ON COMPLEX INFINITY: the exclusion below
 * is the descriptor test `finite === false && sgn === 'unsigned'`, and
 * `~oo` and NaN produce IDENTICAL descriptors (type `number`, not finite,
 * sign `unsigned`), so the exclusion cannot separate them and `Abs(~oo)`
 * claims `number` where the expression shape claims `real<0..>`. The wider
 * claim only stops asserting a bound that happens to hold (|~oo| = +∞).
 *
 * A symbol HOLDING NaN behind a wider declaration (`x: number`, `x :=
 * NaN`) is covered by the same test and answers `number` — and so does the
 * expression shape, whose guard reads both the literal and the held-number
 * value channels (its literal-only guard once fell through to `real<0..>`
 * there; the hole was closed when this twin's A/B battery surfaced it).
 */
export function absFunctionType(x: OperandDescriptor | undefined): Type {
  if (!x) return 'number';
  // NaN's static type is just `number`, so only the value channel proves
  // it — and the descriptor carries that channel for a held value as well
  // as for a literal, hence no literal gate here.
  if (mayBeNaN(x)) return 'number';
  const t = x.type;
  // |x| also preserves the numeric TIER of a real operand: the magnitude of
  // an integer is an integer, of a rational a rational (`|−1/2| = 1/2`). The
  // finiteness rungs come first, so a *complex* finite operand — whose
  // magnitude is real but neither rational nor integer — still lands on
  // `finite_real`, and a provably non-finite one keeps `non_finite_number`.
  // |x| ≥ 0, and the type says so: each tier claim carries its non-negative
  // range, so a type-channel consumer (`√|x|`, the GPU real-vs-complex
  // lowering) sees the sign the sgn handler always knew.
  if (typeFact(t, 'finite_number') === true) {
    for (const tier of ['finite_integer', 'finite_rational'] as const)
      if (typeFact(t, tier) === true) return nonNegativeRangeType(tier);
    return nonNegativeRangeType('finite_real');
  }
  if (typeFact(t, 'non_finite_number') === true) return 'non_finite_number';
  // Unknown finiteness: the tier still carries (`integer`/`rational`/`real`
  // admit ±∞, and |±∞| = +∞ stays inside them).
  for (const tier of ['integer', 'rational', 'real'] as const)
    if (typeFact(t, tier) === true) return nonNegativeRangeType(tier);
  return nonNegativeRangeType('real');
}

/**
 * `Max`/`Min`/`Supremum`/`Infimum`. These are data-consuming aggregates
 * (an absent datum or empty input evaluates to NaN), so the base claim is
 * `number`. When every operand is a *scalar* number, though, no
 * empty/missing datum is possible — the result is one of the operands — and
 * the claim narrows to the join tier of the operand types. A collection
 * operand (which may be empty or contain `Missing`) keeps `number`.
 */
export function extremumType(ops: ReadonlyArray<OperandDescriptor>): Type {
  if (ops.length === 0) return 'number';
  if (!ops.every((d) => typeFact(d.type, 'number') === true)) return 'number';
  for (const t of [
    'finite_integer',
    'finite_rational',
    'finite_real',
    'integer',
    'rational',
    'real',
  ] as const)
    if (ops.every((d) => typeFact(d.type, t) === true)) return t;
  return 'number';
}

/**
 * `Measurement(value, error)` — a nominal value carrying a 1σ absolute error.
 * The type is the nominal's scalar type (typically `real`); the error bar does
 * not widen it.
 */
export function measurementType(ops: ReadonlyArray<OperandDescriptor>): Type {
  return ops[0]?.type ?? 'real';
}

/**
 * Result type of a big-op (`Sum`/`Product`) in its `(body, limits…)` form.
 * Elementwise accumulation over a collection-valued body yields the same
 * indexed-collection type: summing (or multiplying) a `vector<2>`-, `list<T>`-
 * or tuple-valued body gives that same collection type. A scalar body — or the
 * arity-1 reducer form `Sum(L)`, which sums a collection's elements to a
 * scalar — types as `number`.
 *
 * The collection test is deliberately the TYPE test and not
 * `facts.indexed`: the fact also answers `true` from the operand's runtime
 * collection capability, which would carry a body type through where the
 * expression shape claims `number` — a narrowing.
 */
export function bigOpResultType(
  ops: ReadonlyArray<OperandDescriptor>
): Type {
  const body = ops[0];
  if (
    ops.length > 1 &&
    body !== undefined &&
    typeFact(body.type, INDEXED_COLLECTION_SHAPE_TYPE) === true
  )
    return body.type;
  // A body that is only POSSIBLY a collection carries its `broadcastable<T>`
  // type through for the same reason: `broadcastable<T>` abbreviates the union
  // `T | indexed_collection<T>`, so it covers both the scalar accumulation and
  // the element-wise one, and the big-op cannot decide between them until the
  // body evaluates. A `Which` whose condition is a comparison the engine
  // cannot statically prove will broadcast (`comparisonResultType` in
  // `library/relational-operator.ts`) is the case that produces such a body.
  const bodyType = body?.type;
  if (
    ops.length > 1 &&
    bodyType !== undefined &&
    typeof bodyType !== 'string' &&
    bodyType.kind === 'broadcastable'
  )
    return bodyType;
  return 'number';
}

/**
 * Result type for the elementary/inverse trig and log functions, dispatched by
 * operator so that pole-capable and domain-restricted operators do not claim
 * `finite_real` where their values are complex/infinite/NaN.
 */
export function elementaryFunctionType(
  operator: string,
  ops: ReadonlyArray<OperandDescriptor>
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
    // and correctly keep `number` via `numericTypeHandler`.) The realness
    // test is the TYPE's: it excludes a NaN argument, whose type is `number`,
    // so `sinh(NaN)` and `tanh(NaN)` fall through to `numericTypeHandler` and
    // claim the top type rather than a value NaN is not a member of.
    case 'Sinh':
    case 'Cosh':
      if (
        ops[0] !== undefined &&
        ops[0].facts.finite === false &&
        typeFact(ops[0].type, 'real') === true
      )
        return 'non_finite_number';
      return numericTypeHandler(ops);
    case 'Tanh':
    case 'Sech':
      if (
        ops[0] !== undefined &&
        ops[0].facts.finite === false &&
        typeFact(ops[0].type, 'real') === true
      )
        return 'finite_real';
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
    // neither may claim `finite_real`.
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
export function adjoinType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const base = ops[0];
  const baseElements =
    (base ? collectionElementType(base.type) : undefined) ?? 'unknown';
  const adjoined = ops.slice(1).map((d) => d.type);
  // `widen` treats `unknown` as "no information" and drops it, which would let
  // `ℤ[x]` (an INDETERMINATE) claim `set<finite_integer>` — unsound, since the
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
 * type is the base's: `QuotientRing(Integers, n)` is a `set<finite_integer>`.
 * The quotient is never larger than the base, so this is an upper bound in
 * both directions and introduces no non-finite value.
 */
export function quotientRingType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const base = ops[0];
  const elements =
    (base ? collectionElementType(base.type) : undefined) ?? 'unknown';
  return { kind: 'set', elements };
}
