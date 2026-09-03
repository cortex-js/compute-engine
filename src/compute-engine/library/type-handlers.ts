import {
  SIGNED_INFINITY_TYPE,
  EXTENDED_REAL_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
  NUMERIC_TYPES_SET,
} from '../../common/type/primitive.js';
import type { OperandDescriptor, Sign } from '../global-types.js';
import type { NumericPrimitiveType, Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { typeFact } from '../boxed-expression/operand-descriptor.js';
import {
  absRange,
  intervalOfType,
  type Interval,
} from '../numerics/interval-arithmetic.js';
import { parseType } from '../../common/type/parse.js';
import {
  collectionElementType,
  stripNumericRanges,
  widen,
} from '../../common/type/utils.js';
import {
  negativeSign,
  nonNegativeSign,
  nonPositiveSign,
  positiveSign,
} from '../boxed-expression/sgn.js';

/**
 * The shared type-handler helpers.
 *
 * A type handler receives an `OperandDescriptor` per operand instead of
 * the operand expression, so it can neither declare, canonicalize nor
 * evaluate anything while deriving a type. The helpers below are shared by
 * the numeric families (`arithmetic`, `trigonometry`, `special-functions`,
 * `statistics`). They replaced expression-taking helpers of the same names
 * when type handlers moved to descriptors.
 *
 * A descriptor carries strictly less than an expression, in three places
 * that matter here (they are the reason several helpers below are wider
 * than the expression-taking helpers they replaced):
 *
 * - The sign of a function APPLICATION comes only from that application's
 *   result type. The operator `sgn` handlers are never invoked while a type
 *   is derived, so a compound whose sign only a `sgn` handler knows —
 *   `Sqrt(Abs(x))`, `Negate(Floor(Abs(x)))` — answers `undefined` where the
 *   expression channel answered `non-negative` / `non-positive`.
 * - An assumption's magnitude bound reaches the descriptor through the
 *   symbol's refined TYPE, strictness included (`assume(x > 2)` refines
 *   to `real<2<..>`; a bound no machine number represents, like `1/3`,
 *   is rounded outward and closed). A bound on a PART of a symbol
 *   (`Re(s) > 1`) has no type slot and stays undecided here.
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
 * - Claim `+oo | -oo` — the signed pair `+∞`, `−∞` — only when the
 *   value is PROVABLY one of them (e.g. `Ln(0) = −∞`,
 *   `±∞ · (provably non-zero reals)`).
 * - When a non-finite value (`±∞`, `~oo`) or NaN is merely POSSIBLE, claim
 *   the top type `number` — never `+oo | -oo` speculatively, and
 *   never a finite type. `number` is the only claim that admits `~oo` and
 *   NaN together with the finite values.
 * - Every bare numeric name (`integer`, `rational`, `real`, `complex`)
 *   means a FINITE value, so an operand whose type is one of them needs no
 *   separate finiteness proof. A gate that must also admit `±∞` spells the
 *   question `EXTENDED_REAL_TYPE` (`common/type/primitive.ts`). Zero-ness,
 *   by contrast, must be *proven* absent (via the sign) for claims that
 *   depend on it.
 */

/**
 * The join of the FINITE complex numbers with the two signed infinities.
 * A log-like head whose argument's sign is unknown reaches exactly this set
 * — `ln(x)` is real for x > 0, `−∞` at x = 0, and finite complex for x < 0
 * — and the bare name `complex` cannot carry the pole because it denotes
 * the finite complex numbers alone. Parsed once at module load.
 */
const COMPLEX_OR_SIGNED_INFINITY_TYPE = parseType('complex | +oo | -oo');

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
  'real<0..> | +oo | -oo'
);

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
 * (`list<real>` is not a subtype of `real`), and unwrapping only ONE
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
 * therefore types `real` while staying symbolic. That is the same
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
 * Is this descriptor a number LITERAL? The structural view answers `number`
 * for a literal and nothing else, which is the population `isNumber(x)`
 * selects on an expression. A synthetic descriptor (built from a type
 * alone, with no structural view) answers `false`, which routes it exactly
 * as a SYMBOL of the same type — the population a type-only descriptor
 * stands for.
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
  if (
    t.kind === 'numeric' &&
    typeof t.lower === 'number' &&
    t.lower === t.upper
  )
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
export function operandLiteralValue(d: OperandDescriptor): number | undefined {
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
 * `+oo | -oo` type, a `±∞`/NaN literal, or a symbol holding such a
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
 * A descriptor carries a FACT, not a type: `facts.finite` is `false` and
 * `facts.sgn` is `unsigned` for NaN and for complex infinity alike, so the
 * two are indistinguishable here even though their types (`nan` and `~oo`)
 * are disjoint. A handler that must exclude NaN therefore has to treat
 * `~oo` as possibly-NaN too, which widens its claim on a `~oo` operand and
 * is the sound direction (only `number` admits both).
 */
function mayBeNaN(d: OperandDescriptor): boolean {
  return d.facts.finite === false && d.facts.sgn === 'unsigned';
}

/**
 * The closed real interval `[lo, hi]` that the operand's type guarantees,
 * with `±Infinity` for an unbounded end. A range on the numeric bases
 * `number`, `complex` and `imaginary` is discarded: an ordering bound says
 * nothing about a value that need not be real. The decision is made by an
 * INCLUSION list — the real, NaN-free tiers named in `NAN_FREE_REAL_TIERS`
 * (`numerics/interval-arithmetic.ts`), shared with `signOfType` so the two
 * agree — so a base nobody thought to name is discarded rather than
 * silently read as a real interval.
 *
 * Range endpoints in the type lattice are inclusive; a strict bound is
 * carried separately, as an intersection with a negated value type —
 * `(real<0..>) & !0` is "positive", `(real<0..1>) & !0 & !1` the open unit
 * interval. The zero exclusion reaches the comparisons through the sign;
 * an exclusion at any other endpoint is read by `typeExcludesValue`, which
 * the `provably*` helpers combine with a closed bound AT that endpoint to
 * prove the strict comparison.
 */
function typeBounds(t: Type): Interval {
  // Delegates to THE bounds reader (`intervalOfType`,
  // `numerics/interval-arithmetic.ts`), so a domain proof here and a
  // computed arithmetic result range can never disagree about the same
  // type. `undefined` — a type with no real-line claim (a NaN-admitting
  // or complex base, a non-numeric type, a contradictory intersection) —
  // maps to the unbounded pair, which is what every comparison below
  // treats as "no proof". (Two deliberate tightenings over the inlined
  // predecessor: a contradictory intersection used to return an inverted
  // `lo > hi` pair that could over-prove, and a range on the new
  // `infinity`/`nan` primitives — which admit the unordered `~oo` or NaN
  // — used to be read as ordinary bounds.)
  // The interval carries the endpoints' OPENNESS (`loOpen`/`hiOpen`) since
  // open-bound ranged types landed — the strict facts `facts.bounds` used
  // to carry now live in the type itself.
  return intervalOfType(t) ?? { lo: -Infinity, hi: Infinity };
}

/**
 * Three-valued magnitude comparisons against a machine constant `k`, from
 * the operand's ranged type (a closed bound AT `k` combined with a type
 * exclusion of `k` — `(real<0..1>) & !1` — proves the strict comparison,
 * and so does an OPEN endpoint at `k`, the canonical spelling since
 * open-bound ranged types: `real<1<..>`), its literal value, and — for
 * `k = 0` only, the one comparison a sign decides — its sign.
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

// The strict-comparison truth tables over the flagged `typeBounds` (open-
// bound ranged types, `docs/plans/2026-08-28-open-bounds-in-ranged-types.md`
// §3.3). An OPEN endpoint at `k` proves the strict comparison directly —
// `real<1<..>` proves > 1 — which is what the retired descriptor
// `facts.bounds` used to carry for assumption-derived bounds; a DECLARED
// interior exclusion at `k` (`(real<0..1>) & !0.5`, no range spelling)
// is still read by `typeExcludesValue`.
export function provablyGreater(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v > k;
  if (k === 0 && positiveSign(d.facts.sgn) === true) return true;
  const tb = typeBounds(d.type);
  if (tb.lo > k) return true;
  if (tb.lo === k && tb.loOpen === true) return true;
  return tb.lo === k && typeExcludesValue(d.type, k);
}

export function provablyGreaterEqual(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v >= k;
  if (k === 0 && nonNegativeSign(d.facts.sgn) === true) return true;
  return typeBounds(d.type).lo >= k;
}

export function provablyLess(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v < k;
  if (k === 0 && negativeSign(d.facts.sgn) === true) return true;
  const tb = typeBounds(d.type);
  if (tb.hi < k) return true;
  if (tb.hi === k && tb.hiOpen === true) return true;
  return tb.hi === k && typeExcludesValue(d.type, k);
}

export function provablyLessEqual(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v <= k;
  if (k === 0 && nonPositiveSign(d.facts.sgn) === true) return true;
  return typeBounds(d.type).hi <= k;
}

/** Is the operand provably equal to the machine constant `k`? A literal's
 * value decides it; otherwise only a singleton range in the type does. */
export function provablyEquals(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v === k;
  const b = typeBounds(d.type);
  return b.lo === b.hi && b.lo === k;
}

/** Is the operand provably DIFFERENT from the machine constant `k`? A
 * literal's value decides it; otherwise `k` outside the type's bounds, `k`
 * at an OPEN endpoint of them, a type exclusion of `k` (`… & !k`), or a
 * sign that excludes `k`'s half-line, proves it. */
function provablyDiffers(d: OperandDescriptor, k: number): boolean {
  const v = operandLiteralValue(d);
  if (v !== undefined) return v !== k;
  if (typeExcludesValue(d.type, k)) return true;
  const b = typeBounds(d.type);
  if (k < b.lo || k > b.hi) return true;
  // `k` AT an open endpoint is excluded by the range itself.
  if ((k === b.lo && b.loOpen === true) || (k === b.hi && b.hiOpen === true))
    return true;
  const s = d.facts.sgn;
  if (k > 0) return nonPositiveSign(s) === true;
  if (k < 0) return nonNegativeSign(s) === true;
  return (
    s === 'not-zero' || positiveSign(s) === true || negativeSign(s) === true
  );
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
export function numericTypeHandler(
  ops: ReadonlyArray<OperandDescriptor>
): Type {
  if (ops.some((d) => operandNonFiniteNumber(d))) return 'number';
  if (ops.every((d) => typeFact(d.type, 'real') === true)) return 'real';
  return 'number';
}

/**
 * Result type for an additive-shift operator — one whose result stays in
 * its operands' numeric kind under a shift by a real constant: the claim is
 * the JOIN of the operand kinds (`PreIncrement(2)` is a `integer`
 * because n + 1 is closed on the integers). The claim is made only when
 * every operand is provably finite and provably numeric; a non-finite,
 * unknown-finiteness, or non-numeric operand widens the claim to the top
 * type `number`, because kind closure says nothing about what the operator
 * does at ±∞ or NaN. One kind is special-cased: `imaginary` is NOT closed
 * under a real shift (i + 1 is complex, with a nonzero real part), so it
 * widens to `complex` — the same widening `Add`'s own typing applies
 * (`boxed-expression/arithmetic-add.ts`).
 *
 * This behavior is strictly OPT-IN. An operator with no type handler keeps
 * its declared result type verbatim: the kind-closure premise is a
 * per-operator fact, never an engine-wide default — the mean of two
 * integers is not an integer, and `BigO(3)` is never a number at all.
 * Attach this handler only to operators whose declared result is exactly
 * `number`: the bail-out paths return the literal `'number'`, and a handler
 * result REPLACES the declared result, so on an operator declaring a
 * narrower result this handler would silently widen it.
 *
 */
export function kindClosureType(ops: ReadonlyArray<OperandDescriptor>): Type {
  if (ops.length === 0) return 'number';
  const kinds: NumericPrimitiveType[] = [];
  for (const d of ops) {
    if (d.facts.finite !== true) return 'number';
    const t = stripNumericRanges(d.type);
    if (
      typeof t !== 'string' ||
      !NUMERIC_TYPES_SET.has(t as NumericPrimitiveType)
    )
      return 'number';
    kinds.push(t === 'imaginary' ? 'complex' : (t as NumericPrimitiveType));
  }
  return widen(...kinds);
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
  // including `Exp(r)`, whose type `real<0..> & !0` proves positive
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
  // `+oo | -oo`; an unusable base widens to `number`.
  if (operandLiteralValue(x) === 0) {
    if (base === undefined || usableBase(base)) return SIGNED_INFINITY_TYPE;
    return 'number';
  }
  // A provably non-positive argument that may be 0 → −∞ pole (`ln(0)`).
  //
  // This gate widens the claim to `number` on a proven non-positive sign.
  // The descriptor's sign fact covers the case that once made wiring this
  // to the log heads unsound — a sign only an operator `sgn` handler knows
  // (`Negate(Floor(Abs(x)))`, whose result type is a bare
  // `integer`) — because `describe()` consults those handlers for
  // applications (open item O7 of
  // `docs/plans/2026-08-22-type-handlers-on-types.md`). `Ln` and `Log`
  // are wired to this handler (`Lb`/`Lg`/`Log2`/`Log10` canonicalize to
  // `Log` and have no type handler of their own).
  if (positiveSign(xSgn) === false && negativeSign(xSgn) !== true)
    return 'number';
  if (base && !usableBase(base)) return 'number';
  // Provably negative finite argument: `ln(x) = ln|x| + iπ` (e.g.
  // `ln(−1) = iπ`) — a finite complex value.
  if (negativeSign(xSgn) === true) return 'complex';
  // Provably positive (hence real, and finite per the check above): real.
  if (positiveSign(xSgn) === true) return 'real';
  // Sign unknown: the value may be real (x > 0), −∞ (x = 0) or finite
  // complex (x < 0) — the join is `complex | +oo | -oo`. The bare
  // name `complex` denotes the FINITE complex numbers, so it cannot carry
  // the `x = 0` pole on its own and the signed pair is spelled out.
  // Neither disjunct admits NaN, so the claim is only sound when the
  // operand's type excludes NaN too (`ln(NaN) = NaN`): an operand that may
  // be NaN — `number`, which sits ABOVE `complex` rather than inside it —
  // keeps the top type.
  return typeFact(x.type, 'complex') === true
    ? COMPLEX_OR_SIGNED_INFINITY_TYPE
    : 'number';
}

/**
 * `Tan`/`Sec`/`Csc`/`Cot` (and the hyperbolic reciprocals `Coth`/`Csch`,
 * poles at 0): a pole value is `~oo`, which `+oo | -oo` — the
 * SIGNED pair `+∞`, `−∞` — does not admit, so an argument that may sit on a
 * pole claims the top type `number`.
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
  // A NaN argument needs no separate test: NaN types `nan`, which is not on
  // the extended real line, so the non-finite arm below gives it the top
  // type even for the hyperbolic heads whose value at a real ±∞ is finite.
  // The arm asks for EXTENDED realness because the operand it exists for is
  // `±∞`, which the bare (finite) name `real` does not match.
  if (operandNonFiniteNumber(x))
    return hyperbolic && typeFact(x.type, EXTENDED_REAL_TYPE) === true
      ? 'real'
      : 'number';
  // Past the non-finite arm the operand is not provably infinite, so the
  // finite name is the right question here.
  if (typeFact(x.type, 'real') !== true) return 'number';
  // Only the pole at 0 is reachable by a number literal (every other pole is
  // an irrational multiple of π, which no literal — rational, float, or
  // radical — equals).
  const poleAtZero = operator !== 'Tan' && operator !== 'Sec';
  if (isNumberLiteral(x)) {
    // A literal whose exact value no machine number holds (`1/3`, `√2`) has
    // no value here — and is not 0 either, so it is off every pole.
    return poleAtZero && operandLiteralValue(x) === 0 ? 'number' : 'real';
  }
  // A non-literal CONSTANT (π/2, 2π/3, …) can sit exactly on a circular pole
  // — `Tan(π/2) = ~oo`, `Csc(π) = ~oo` — so it keeps `number`. The
  // hyperbolic poles are only at 0, where the sign check below decides.
  //
  // Closedness UNKNOWN is treated as closed: a descriptor built from a type
  // alone (`describeType()`, reached through a recursive derivation) says
  // nothing about whether its operand is a constant, and claiming `real`
  // for a value that may be an exact pole would be unsound. A bound
  // variable's stand-in carries `closed: false` on purpose, so a mapped
  // `tan` over real elements keeps `real`.
  if (!hyperbolic && x.facts.closed !== false) return 'number';
  if (!poleAtZero) return 'real';
  // Zero-pole operators on a symbolic real: the pole at 0 — the one provable
  // pole — must be disproven; the rest of the pole set has measure zero
  // (generic-point convention).
  const s = operandSgn(x);
  if (positiveSign(s) === true || negativeSign(s) === true) return 'real';
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
   * The type of the value at a pole: `+oo | -oo` for a signed `±∞`
   * (`artanh(1) = +∞`), and `number` when the pole value is `~oo` or may be
   * NaN — neither of those is a member of `+oo | -oo`, which is the
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
 * Is the operand **provably** inside one of `intervals`?
 *
 * The numeric predicates on an expression (`x.isGreater(1)`) consult the
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
 * the predicates say `undefined` where the bounds read here prove
 * containment outright. The claim here is then NARROWER: sound and
 * tighter. Adopting those tighter claims was ruled (2026-08-25) when the
 * bounded inverse heads converted — they are the one family whose
 * conversion changed derived types. (A symbol ranged by `ce.assume`
 * carries both channels, which is why those rows agree.) The changed rows
 * are pinned in `test/compute-engine/type-handler-parity.test.ts`
 * ("bounded inverse trig heads read ranged types").
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
      if (containsNumber(domain.real, r)) return 'real';
      if (containsNumber(domain.complex, r)) return 'complex';
      return domain.poleType;
    }
  }

  if (domain.poles.some((p) => provablyEquals(x, p))) return domain.poleType;
  if (provablyIn(x, domain.real)) return 'real';
  if (provablyIn(x, domain.complex)) return 'complex';
  // Magnitude unknown: the join of what remains. A pole that is provably
  // avoided (or a head with no real pole) drops the non-finite arm.
  if (domain.poles.every((p) => provablyDiffers(x, p))) return 'complex';
  // The join of `complex` with the pole value. `complex` denotes the
  // FINITE complex numbers, so it cannot absorb the pole: a signed-infinity
  // pole (`poleType: SIGNED_INFINITY_TYPE`) is spelled out in the union, and
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
  poleType: SIGNED_INFINITY_TYPE,
};

/** `Arcoth`: real on `|x| > 1`, finite complex on `(−1, 1)`, `±∞` at `±1`. */
const ARCOTH_DOMAIN: RealDomain = {
  real: [iv(-Infinity, false, -1, false), iv(1, false, Infinity, false)],
  complex: [iv(-1, false, 1, false)],
  poles: [-1, 1],
  poleType: SIGNED_INFINITY_TYPE,
};

/** `Arsech`: real on `(0, 1]`, finite complex elsewhere, `+∞` at 0. */
const ARSECH_DOMAIN: RealDomain = {
  real: [iv(0, false, 1, true)],
  complex: [iv(-Infinity, false, 0, false), iv(1, false, Infinity, false)],
  poles: [0],
  poleType: SIGNED_INFINITY_TYPE,
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
 *
 * The realness test is the EXTENDED one: the bare name `real` denotes the
 * finite reals, so a `±∞` argument does not match it, and gating on `real`
 * alone would send `arctan(∞)` — whose value is the finite π/2 — to the top
 * type.
 *
 * A NaN argument needs no separate test here: NaN types `nan`, which is not
 * on the extended real line, so it takes the final `number`. The expression
 * shape reaches the same answer through the value channel, since a NaN
 * literal's `isExtendedReal` is `false`.
 */
function arctanType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const x = ops[0];
  if (!x) return 'number';
  if (typeFact(x.type, EXTENDED_REAL_TYPE) === true) return 'real';
  return 'number';
}

/**
 * Γ-family result type (`Gamma`, `GammaLn`, `Digamma`, `Trigamma`,
 * `PolyGamma`): poles at the non-positive integers, where the value is `~oo`
 * (`+∞` for `GammaLn`) — not representable by any finite type nor by
 * `+oo | -oo` (for `~oo`), so a *provably* non-positive-integer
 * argument claims `number`. An integer of unknown sign keeps the
 * generic-point convention (via `numericTypeHandler`).
 *
 * NARROWER THAN THE EXPRESSION SHAPE WHEN THE SIGN IS ONLY A `sgn`
 * HANDLER'S: the pole gate widens the claim to `number` on a PROVEN
 * non-positive sign. The descriptor's sign fact covers the case that once
 * made wiring this to the Γ family unsound — a sign only an operator
 * `sgn` handler knows (`Negate(Floor(Abs(x)))`, whose result type is a
 * bare `integer`) — because `describe()` consults those handlers
 * for applications (open item O7 of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`). The Γ-family
 * operators (`Gamma`, `GammaLn`, `Digamma`, `Trigamma`,
 * `PolyGamma`) are wired to it (`PolyGamma` gates inline on its second
 * operand and falls back to `numericTypeHandler`, mirroring its legacy
 * shape).
 *
 * A provably-NaN operand DECLINES, as `Sqrt` and `Erf` do (the Γ family
 * declares `nanBehavior: 'propagate'` on its `complex | infinity`
 * carrier). Measured
 * consequence: the derived claim is `number`, not the sharp `nan`, because
 * the Γ heads keep the wide `number` result and the result-adjustment
 * seam adds a `nan` arm only to a NaN-free declared result (the `Sin(NaN)`
 * precedent; `specialFunctionType` in library/arithmetic.ts says the
 * same).
 */
export function gammaPoleType(
  x: OperandDescriptor | undefined
): Type | undefined {
  if (!x) return 'number';
  if (typeFact(x.type, 'nan') === true) return undefined;
  if (
    typeFact(x.type, 'integer') === true &&
    nonPositiveSign(operandSgn(x)) === true
  )
    return 'number';
  return numericTypeHandler([x]);
}

/**
 * Rounding family (`Round`, `Ceil`, `Floor`, `Truncate`) — the SLIM
 * finiteness-narrowing handler that remains after the family's Contract B
 * domain-signature flip (each declares
 * `(real | signed_infinity) -> integer | signed_infinity`; an off-carrier
 * operand — a complex value, `~oo` — is a boxing error, so this handler
 * never needs the component-wise Gaussian arms it used to carry):
 *
 * - a provably FINITE real operand rounds to a finite integer → `integer`
 *   (the load-bearing sharp claim: `matches('integer')` gates downstream
 *   read it);
 * - a provably infinite extended real maps to itself → `+oo | -oo`;
 * - a proven extended real of UNDECIDED finiteness — e.g. an undeclared
 *   symbol the carrier itself inferred as `real | signed_infinity` —
 *   gets the union of those two outcomes, `integer | signed_infinity`,
 *   which is sharper than the family's declared `Round` result and, for
 *   the others, NaN-free where the declared-result fallback would add
 *   the `nan` arm the proof excludes;
 * - anything else — realness undecided, or a propagate-admitted `NaN` —
 *   DECLINES (`undefined`), so the framework derives the honest claim
 *   from the declared signature (`integer | signed_infinity`, with the
 *   `nan` arm exactly where the argument can carry one).
 *
 * The operand is unwrapped to its broadcast element first, so a
 * `list<real>` operand keeps the sharp per-cell `integer` claim.
 */
const INTEGER_OR_SIGNED_INFINITY_TYPE = parseType('integer | signed_infinity');

export function roundingFunctionType(
  x: OperandDescriptor | undefined
): Type | undefined {
  if (!x) return undefined;
  const t = broadcastOperandType(x);
  // The VALUE channel first: `facts.finite === false` is a PROOF of
  // non-finiteness the descriptor can read through an application whose
  // static type stays a union (`Ceil(Abs(w))` with `w := +∞` — the type
  // alone says only `real<0..> | +oo | -oo`). A proven non-finite,
  // provably extended-real operand IS `±∞`, and rounding maps it to
  // itself. The same fact holds for a NaN operand (the facts channel
  // cannot tell NaN and `~oo` from `±∞`), but there the extended-real
  // test fails and the handler declines — the framework's proven-NaN arm
  // answers `nan`. The fact describes the OPERAND, not its elements, so
  // it is only consulted for a scalar operand (the convention
  // `boundedEntireRealType` and the `LogIntegral` handler follow); a
  // collection operand's cells answer through the element-type arms
  // below.
  if (x.facts.collection !== true && operandNonFiniteNumber(x))
    return typeFact(t, EXTENDED_REAL_TYPE) === true
      ? SIGNED_INFINITY_TYPE
      : undefined;
  // Bare `real` names the FINITE reals (finite-by-default lattice), so this
  // single fact is the whole finiteness proof.
  if (typeFact(t, 'real') === true) return 'integer';
  if (typeFact(t, SIGNED_INFINITY_TYPE) === true) return SIGNED_INFINITY_TYPE;
  if (typeFact(t, EXTENDED_REAL_TYPE) === true)
    return INTEGER_OR_SIGNED_INFINITY_TYPE;
  return undefined;
}

/**
 * `Abs` — |x| is a non-negative real whose finiteness follows the operand:
 * |±∞| = |~oo| = +∞, |NaN| = NaN, and a finite x (real or complex) has a
 * finite magnitude. A finite tier is only claimed when finiteness is
 * *provable from the static type* so downstream finiteness guards (e.g.
 * `Multiply`'s ∞·0 protection in its sgn handler) can rely on it; an
 * operand of unknown finiteness gets the union of the two outcomes,
 * `real<0..> | +oo | -oo`, because the bare tiers denote the
 * FINITE values alone and would exclude the `+∞` such an operand can
 * produce.
 *
 * The descriptor's NaN exclusion is `finite === false && sgn ===
 * 'unsigned'`, and `~oo` and NaN produce IDENTICAL descriptors (not
 * finite, sign `unsigned`), so that test alone cannot separate them. The
 * TYPE channel can: `~oo` is a subtype of `infinity` and NaN is not, so the
 * infinite arm runs first and both shapes answer `+oo | -oo` for
 * `~oo`.
 *
 * A symbol HOLDING NaN behind a wider declaration (`x: number`, `x :=
 * NaN`) is covered by the same test and answers `number`.
 */
export function absFunctionType(x: OperandDescriptor | undefined): Type {
  if (!x) return 'number';
  const t = x.type;
  // An operand the TYPE proves infinite — the signed pair `±∞` and the
  // unsigned `~oo` — has magnitude `+∞`, so `+oo | -oo` (the signed
  // pair) is the claim. This arm runs before every other test: a
  // type-provable infinity is never NaN, so the NaN exclusion below must
  // not preempt it, and every tier the walk below can reach denotes FINITE
  // values only, so any of them would exclude the value the operand
  // actually has.
  if (typeFact(t, 'infinity') === true) return SIGNED_INFINITY_TYPE;
  // NaN's static type is just `number`, so only the value channel proves
  // it — and the descriptor carries that channel for a held value as well
  // as for a literal, hence no literal gate here.
  if (mayBeNaN(x)) return 'number';
  // |x| also preserves the numeric TIER of a real operand: the magnitude of
  // an integer is an integer, of a rational a rational (`|−1/2| = 1/2`). A
  // *complex* finite operand — whose magnitude is real but neither rational
  // nor integer — matches no tier rung and lands on `real`.
  // |x| ≥ 0, and the type says so: each tier claim carries its non-negative
  // range, so a type-channel consumer (`√|x|`, the GPU real-vs-complex
  // lowering) sees the sign the sgn handler always knew.
  // `absRange` tightens each tier claim with the operand's interval when
  // one exists (`|x|` for `x: real<-3..2>` is `real<0..3>`), and answers
  // the plain non-negative range `tier<0..>` otherwise.
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
    if (typeFact(t, tier) === true) return absRange(tier, t);
  // A finite operand that matched no real tier is complex, and the
  // magnitude of a finite complex number is a finite real that is neither
  // rational nor integer.
  if (typeFact(t, 'complex') === true) return absRange('real', t);
  // The operand is neither provably finite nor provably infinite, so `|x|`
  // is either a non-negative real or `+∞` — the only infinite magnitude
  // there is. NaN is NOT covered by this claim: the exclusion above catches
  // it wherever the descriptor proves it, but an operand typed the top
  // `number` admits NaN and reaches here, and `|NaN| = NaN` falsifies the
  // claim. That hole is older than the finite-by-default numeric flip — the
  // claim made here before the flip, `real<0..>`, did not admit NaN either
  // — so closing it is a separate decision from carrying the `+∞`.
  return NON_NEGATIVE_REAL_OR_SIGNED_INFINITY_TYPE;
}

/**
 * `Max`/`Min`/`Supremum`/`Infimum`. These are data-consuming aggregates
 * (an absent datum or empty input evaluates to NaN), so the base claim is
 * `number`. When every operand is a *scalar* number, though, no
 * empty/missing datum is possible — the result is one of the operands — and
 * the claim narrows to the join tier of the operand types. A collection
 * operand (which may be empty or contain `Missing`) keeps `number`.
 *
 * The ladder walks the numeric tiers from tightest to widest, so the first
 * rung every operand matches is the tightest true claim.
 *
 * An operand set containing a signed infinity matches no rung and takes the
 * top type. That is sound but loose — `max(+∞, 3)` really is `+∞`, so the
 * extended real line would be a tighter claim. Tightening it is a separate
 * behavior change with its own pins, not part of the handler machinery.
 */
export function extremumType(ops: ReadonlyArray<OperandDescriptor>): Type {
  if (ops.length === 0) return 'number';
  if (!ops.every((d) => typeFact(d.type, 'number') === true)) return 'number';
  for (const t of ['integer', 'rational', 'real'] as const)
    if (ops.every((d) => typeFact(d.type, t) === true)) return t;
  return 'number';
}

/**
 * `ElementMax`/`ElementMin`/`Clamp` — the SLIM finiteness-narrowing handler
 * that remains after the family's Contract B domain-signature flip (each
 * declares the extended real line, `(real | signed_infinity, …) ->
 * real | signed_infinity`, so a non-real or `~oo` operand is a boxing error
 * and never reaches this handler).
 *
 * Each of these heads returns ONE OF ITS OPERANDS — `max`, `min` and the
 * `min(max(x, lo), hi)` composition all select, they never compute — so the
 * result stays in the operands' common numeric tier:
 *
 * - every operand a provably finite integer → `integer`;
 * - every operand a provably finite real → `real`;
 * - anything else — an operand that may be infinite, whose realness is not
 *   proven, or a propagate-admitted `NaN` — DECLINES (`undefined`), so the
 *   framework derives the honest claim from the declared signature
 *   (`real | signed_infinity`, with the `nan` arm exactly where an operand
 *   can carry one). Declining rather than answering `number` is what lets
 *   that derivation show: a handler answer is never widened NOR sharpened
 *   by the framework.
 *
 * Each operand is unwrapped to its broadcast element first, so a
 * `list<integer>` operand keeps the sharp per-cell claim under the
 * broadcast lift the family's `broadcastable: true` flag performs.
 *
 * Ruling recorded in the arithmetic-core record of
 * `docs/plans/2026-08-30-error-model-implementation.md`.
 */
export function elementExtremumType(
  ops: ReadonlyArray<OperandDescriptor>
): Type | undefined {
  if (ops.length === 0) return undefined;
  const ts = ops.map((d) => broadcastOperandType(d));
  // An operand that cannot hold a value — the EMPTY type `never`, from an
  // empty range such as `integer<2<..<3>` — answers TRUE to every fact
  // below, because the bottom type is a subtype of every type. Decline, or
  // the tier scan claims a sharp finite tier for a valueless operand. The
  // framework's own generic guard intercepts a SCALAR `never` operand, but
  // it reads the top-level type only, not the element type unwrapped just
  // above, so a `list<never>` cell reaches here.
  if (ts.some((t) => isSubtype(t, 'never'))) return undefined;
  // Bare `integer`/`real` name the FINITE values (finite-by-default
  // lattice), so each of these single facts is the whole finiteness proof.
  if (ts.every((t) => typeFact(t, 'integer') === true)) return 'integer';
  if (ts.every((t) => typeFact(t, 'real') === true)) return 'real';
  return undefined;
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
 * collection capability, which would carry a body type through for an
 * operand whose TYPE does not prove a collection — a claim the types alone
 * do not support.
 */
export function bigOpResultType(ops: ReadonlyArray<OperandDescriptor>): Type {
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
 * `real` where their values are complex/infinite/NaN.
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
    // a PROVABLE ±∞/+∞ (`+oo | -oo`), while `tanh(±∞) = ±1` and
    // `sech(±∞) = 0` are finite reals. (The circular Sin/Cos give NaN at ±∞
    // and correctly keep `number` via `numericTypeHandler`.) The realness
    // test is the TYPE's, and it is EXTENDED realness: the bare name `real`
    // denotes the finite reals, so a `±∞` operand — which is exactly what
    // these arms exist for — does not match it, and testing `real` alone
    // made both arms unreachable. NaN types `nan`, which is outside the
    // extended real line, so `sinh(NaN)` and `tanh(NaN)` still fall through
    // to `numericTypeHandler` and claim the top type rather than a value NaN
    // is not a member of.
    case 'Sinh':
    case 'Cosh':
      if (
        ops[0] !== undefined &&
        ops[0].facts.finite === false &&
        typeFact(ops[0].type, EXTENDED_REAL_TYPE) === true
      )
        return SIGNED_INFINITY_TYPE;
      return numericTypeHandler(ops);
    case 'Tanh':
    case 'Sech':
      if (
        ops[0] !== undefined &&
        ops[0].facts.finite === false &&
        typeFact(ops[0].type, EXTENDED_REAL_TYPE) === true
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
 * No non-finite value is introduced by adjunction, so no `+oo | -oo`
 * claim is made (nor withheld): the finiteness of the result is exactly the
 * finiteness carried by the operands' own types.
 */
export function adjoinType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const base = ops[0];
  const baseElements =
    (base ? collectionElementType(base.type) : undefined) ?? 'unknown';
  const adjoined = ops.slice(1).map((d) => d.type);
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
export function quotientRingType(ops: ReadonlyArray<OperandDescriptor>): Type {
  const base = ops[0];
  const elements =
    (base ? collectionElementType(base.type) : undefined) ?? 'unknown';
  return { kind: 'set', elements };
}
