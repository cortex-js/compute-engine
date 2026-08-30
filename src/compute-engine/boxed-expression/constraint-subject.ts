import type {
  BoxedValueDefinition,
  Expression,
  ExpressionMapInterface,
  FactRecord,
  FactSubject,
  IComputeEngine as ComputeEngine,
  IntervalBounds,
  Sign,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { makeNumericRangeType } from '../../common/type/numeric-range.js';
import { reduceType } from '../../common/type/reduce.js';
import { nextDown, nextUp } from '../numerics/numeric.js';
import { isFunction, isSymbol, isNumber } from './type-guards.js';
import { ExpressionMap } from './expression-map.js';
import { domainToType, SIGNED_NUMBER_SETS } from './number-set-types.js';

/**
 * Constraint subjects (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §2).
 *
 * The assumptions system keys facts not just on bare symbols, but on a small
 * algebra of "subjects": a symbol, or one of the four part-extractors
 * (`Real`, `Imaginary`, `Abs`, `Argument`) applied to exactly a bare symbol.
 *
 * This module is a leaf: it imports types from `global-types`, the runtime
 * type guards, and the `ExpressionMap` class — used only to build the frozen
 * empty store that `contextAssumptions()` answers while facts are suppressed.
 * `expression-map.ts` has no imports of its own, so that edge cannot close a
 * cycle. Do not add imports that could create cycles.
 */

/** The "part" of a symbol that a constraint subject refers to. */
export type SubjectPart = 'self' | 're' | 'im' | 'abs' | 'arg';

/**
 * A constraint subject: either a symbol itself (`part: 'self'`) or a
 * part-extractor (`Real`, `Imaginary`, `Abs`, `Argument`) applied to a
 * bare symbol.
 */
export type Subject = { symbol: string; part: SubjectPart };

/** Map from CE canonical operator names to subject parts. */
const PART_OPERATORS: Record<string, SubjectPart> = {
  Real: 're',
  Imaginary: 'im',
  Abs: 'abs',
  Argument: 'arg',
};

/**
 * Recognize a canonical subject term:
 * - a bare symbol → `{ symbol, part: 'self' }`
 * - `Real(x)`, `Imaginary(x)`, `Abs(x)`, `Argument(x)` where `x` is a bare
 *   symbol → `{ symbol: x, part: 're'|'im'|'abs'|'arg' }`
 *
 * Nothing deeper is recognized: `Real(z + w)` is **not** a subject, nor is
 * `Abs(Real(z))`.
 */
export function subjectOf(expr: Expression): Subject | undefined {
  if (isSymbol(expr)) return { symbol: expr.symbol, part: 'self' };
  if (isFunction(expr)) {
    const part = PART_OPERATORS[expr.operator];
    if (part !== undefined && expr.ops.length === 1 && isSymbol(expr.op1))
      return { symbol: expr.op1.symbol, part };
  }
  return undefined;
}

/**
 * A stable string key for a subject, for indexing: `"self:x"`, `"re:s"`,
 * `"im:tau"`, `"abs:q"`, `"arg:z"`.
 */
export function subjectKey(subject: Subject): string {
  return `${subject.part}:${subject.symbol}`;
}

/** Convert a `string | Subject` argument to a `Subject` ('self' part). */
export function toSubject(subjectOrSymbol: string | Subject): Subject {
  if (typeof subjectOrSymbol === 'string')
    return { symbol: subjectOrSymbol, part: 'self' };
  return subjectOrSymbol;
}

/**
 * True if `expr` is exactly the subject term for `subject` (a bare symbol
 * for `part: 'self'`, or the corresponding part-extractor applied to the
 * symbol otherwise).
 */
export function matchesSubject(expr: Expression, subject: Subject): boolean {
  if (subject.part === 'self') return isSymbol(expr, subject.symbol);
  const s = subjectOf(expr);
  return (
    s !== undefined && s.part === subject.part && s.symbol === subject.symbol
  );
}

/** Numeric (real, finite) value of a number literal term, or undefined. */
export function finiteNumericValue(
  term: Expression | undefined
): number | undefined {
  if (term === undefined || !isNumber(term)) return undefined;
  const val =
    typeof term.numericValue === 'number'
      ? term.numericValue
      : term.numericValue?.re;
  if (val !== undefined && Number.isFinite(val)) return val;
  return undefined;
}

/**
 * Extract the bound contribution of a single normalized inequality
 * assumption — `Less(lhs, 0)` or `LessEqual(lhs, 0)` — for `subject`.
 *
 * Recognized lhs shapes (mirroring the historical symbol-only logic, with
 * the bare symbol generalized to a subject term):
 *
 * - `Negate(subject)` → lower bound 0 (i.e. `subject > 0` / `subject ≥ 0`)
 * - `subject` → upper bound 0
 * - `Add(..., Negate(subject), ..., k…)` with numeric terms summing to
 *   `k ≠ 0` → lower bound `k`
 * - `Add(..., subject, ..., k…)` with numeric terms summing to `k ≠ 0` →
 *   upper bound `-k`
 *
 * Returns `undefined` if the assumption carries no bound for `subject`.
 *
 * NOTE: as in the historical implementation, non-numeric extra terms in an
 * `Add` are ignored when summing the constant. Callers should treat the
 * result as a best-effort bound (this matches the pre-existing behavior of
 * `getInequalityBoundsFromAssumptions`).
 */
export function boundsFromNormalizedInequality(
  assumption: Expression,
  subject: Subject
): IntervalBounds | undefined {
  const op = assumption.operator;
  if (op !== 'Less' && op !== 'LessEqual') return undefined;
  if (!isFunction(assumption)) return undefined;

  const ops = assumption.ops;
  if (ops.length !== 2) return undefined;

  const [lhs, rhs] = ops;

  // RHS must be 0 for normalized assumptions
  if (!rhs.isSame(0)) return undefined;

  const ce = assumption.engine;
  const isStrict = op === 'Less';
  const result: IntervalBounds = {};

  // Case 1: Negate(subject) < 0 => subject > 0 — lower bound 0
  if (isFunction(lhs, 'Negate') && matchesSubject(lhs.op1, subject)) {
    result.lower = ce.Zero;
    result.lowerStrict = isStrict;
  }

  // Case 2: subject < 0 — upper bound 0
  if (matchesSubject(lhs, subject)) {
    result.upper = ce.Zero;
    result.upperStrict = isStrict;
  }

  if (isFunction(lhs, 'Add')) {
    let hasSubject = false;
    let hasNegatedSubject = false;
    let constantSum = 0;
    // A term that is neither the subject nor a finite numeric constant —
    // another symbol, an application — makes the inequality relate the
    // subject to an UNKNOWN quantity, so no numeric bound is entailed.
    // Dropping such a term used to record a bound anyway: `b > y + 1`
    // normalizes to `Add(Negate(b), y, 1) < 0`, and skipping `y` recorded
    // `b > 1`, which `y = -2, b = 0` refutes. No bound may come from an
    // inequality with a foreign term.
    let hasForeignTerm = false;

    for (const term of lhs.ops) {
      if (isFunction(term, 'Negate') && matchesSubject(term.op1, subject)) {
        hasNegatedSubject = true;
      } else if (matchesSubject(term, subject)) {
        hasSubject = true;
      } else {
        const val = finiteNumericValue(term);
        if (val !== undefined) constantSum += val;
        else hasForeignTerm = true;
      }
    }

    // Case 3: Add(Negate(subject), k) < 0 => k - subject < 0 => subject > k
    if (!hasForeignTerm && hasNegatedSubject && constantSum !== 0) {
      result.lower = ce.expr(constantSum);
      result.lowerStrict = isStrict;
    }

    // Case 4: Add(subject, k) < 0 => subject < -k
    if (!hasForeignTerm && hasSubject && constantSum !== 0) {
      result.upper = ce.expr(-constantSum);
      result.upperStrict = isStrict;
    }
  }

  if (result.lower === undefined && result.upper === undefined)
    return undefined;
  return result;
}

/**
 * Merge `from` into `into`, keeping the tightest bounds.
 *
 * Semantics match the historical accumulation in
 * `getInequalityBoundsFromAssumptions`: a candidate replaces the current
 * bound only when it is strictly tighter (`isGreater`/`isLess` returning
 * exactly `true`); ties keep the existing strictness.
 */
export function mergeTightestBounds(
  into: IntervalBounds,
  from: IntervalBounds
): void {
  if (from.lower !== undefined) {
    if (into.lower === undefined || from.lower.isGreater(into.lower) === true) {
      into.lower = from.lower;
      into.lowerStrict = from.lowerStrict;
    }
  }
  if (from.upper !== undefined) {
    if (into.upper === undefined || from.upper.isLess(into.upper) === true) {
      into.upper = from.upper;
      into.upperStrict = from.upperStrict;
    }
  }
}

//
// ─── The fact store ─────────────────────────────────────────────────────────
//

/** The scoped assumptions store: normalized fact expression → assertions. */
export type AssumptionStore = ExpressionMapInterface<ReadonlyArray<FactRecord>>;

/**
 * The map every QUERY reader consults while facts are suppressed. Shared and
 * frozen because nothing ever writes to it: a reader that finds `size === 0`
 * stops before touching it further.
 */
const EMPTY_ASSUMPTIONS: AssumptionStore = Object.freeze(
  new ExpressionMap<ReadonlyArray<FactRecord>>()
);

/**
 * The assumptions the current context puts in force, for a consumer that
 * ASKS the store what is known.
 *
 * Every such consumer goes through this accessor rather than reading
 * `ce.context.assumptions`, because a computation may be bracketed so that
 * it derives its answer WITHOUT the facts: while `ce._factSuppressionDepth`
 * is above zero the accessor hands back an empty store and the consumer
 * answers as if nothing were assumed. Sites that COPY or SNAPSHOT the store
 * — a scope push, a checkpoint, the scope dump — are exempt and read
 * `ce.context.assumptions` by identity, since a scope pushed or a checkpoint
 * taken inside such a bracket must still carry the real facts.
 */
export function contextAssumptions(ce: ComputeEngine): AssumptionStore {
  if (ce._factSuppressionDepth > 0) return EMPTY_ASSUMPTIONS;
  return ce.context?.assumptions ?? EMPTY_ASSUMPTIONS;
}

/** The values `assume(x = …)` put in force, keyed by definition. */
export type AssumedValueOverlay = ReadonlyMap<BoxedValueDefinition, Expression>;

/** Shared and frozen for the same reason as {@link EMPTY_ASSUMPTIONS}. */
const EMPTY_ASSUMED_VALUES: AssumedValueOverlay = Object.freeze(
  new Map<BoxedValueDefinition, Expression>()
);

/**
 * The assumed-value overlay in force for the current context — the value
 * channel's twin of {@link contextAssumptions}, and empty for exactly the
 * same reason while facts are suppressed: a value an assumption put in force
 * is a FACT about the current state, so a computation whose result is stored
 * must not see it.
 */
export function contextAssumedValues(ce: ComputeEngine): AssumedValueOverlay {
  if (ce._factSuppressionDepth > 0) return EMPTY_ASSUMED_VALUES;
  return ce.context?.assumedValues ?? EMPTY_ASSUMED_VALUES;
}

//
// ─── The recording-time value shield ────────────────────────────────────────
//

/**
 * The definitions whose value is hidden while `assume()` records a predicate.
 *
 * Without it, `w := 5; assume(w > 0)` folds through the value to `5 > 0` and
 * returns `'tautology'`, recording nothing: the fact about the SYMBOL `w` is
 * lost. `assume()` therefore checks consistency with the values applied
 * first, then records the predicate with the values of the symbols it
 * mentions hidden. The shield hides the assumed-value overlay too, so
 * re-asserting an assumed equality (`assume(one = 1)` twice) is still
 * recorded rather than answering `'tautology'` against the value it
 * installed itself.
 *
 * Module state rather than a field on the engine: `assume()` is synchronous
 * and the window is one dispatch, and the shield must be visible to the
 * definition's own value read, which cannot import `assume.ts`.
 */
let _shieldedDefinitions: ReadonlySet<BoxedValueDefinition> | undefined;

/** Run `fn` with the value of every definition in `defs` hidden from
 * {@link isValueShielded}. Re-entrant: an inner window restores the outer
 * one, and the two sets are unioned so an inner call never un-hides a value
 * the outer one hid. */
export function withShieldedValues<T>(
  defs: ReadonlySet<BoxedValueDefinition>,
  fn: () => T
): T {
  if (defs.size === 0) return fn();
  const saved = _shieldedDefinitions;
  _shieldedDefinitions =
    saved === undefined ? defs : new Set([...saved, ...defs]);
  try {
    return fn();
  } finally {
    _shieldedDefinitions = saved;
  }
}

/** True while this definition's value is hidden by a recording-time shield. */
export function isValueShielded(def: BoxedValueDefinition): boolean {
  return _shieldedDefinitions?.has(def) === true;
}

/**
 * Whether the fact keyed by a list of assertions holds.
 *
 * One key can carry several assertions — an inner scope inherits the
 * enclosing scope's records and may assert the same normalized fact against
 * its own definition of a name — so the list, not a single value, decides.
 * The fact holds when ANY of its assertions claims it does.
 */
export function isFactTrue(records: ReadonlyArray<FactRecord>): boolean {
  for (const record of records) if (record.truth === true) return true;
  return false;
}

//
// ─── Fact index (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §3.1) ────────────────────────
//

/** Facts indexed for a single subject. */
export type SubjectFacts = {
  bounds: IntervalBounds;
  /** Values `v` for which `NotEqual(subject, v)` is assumed. */
  notEqual: Expression[];
};

/** Membership facts for a single symbol. */
export type MembershipFacts = {
  /** Set expressions `S` for which `Element(symbol, S)` is assumed. */
  in: Expression[];
  /** Set expressions `S` for which `NotElement(symbol, S)` is assumed. */
  notIn: Expression[];
};

/**
 * A derived, read-only index over the scoped assumptions `ExpressionMap`.
 *
 * The `ExpressionMap` remains the single source of truth; this index is
 * rebuilt lazily whenever the assumptions change (see `getFactIndex`).
 * Consumers must treat it as immutable.
 */
export type FactIndex = {
  bySubject: Map<string, SubjectFacts>;
  membership: Map<string, MembershipFacts>;
  /**
   * Directed ≥ edges between bare symbols derived from symbol-vs-symbol
   * inequality assumptions. An edge `u → { to: v, strict }` means the
   * assumptions entail `u ≥ v` (`u > v` when `strict`). Used by
   * `relationFromChains` for transitive-closure / antisymmetry reasoning.
   */
  geEdges: Map<string, GeEdge[]>;
  /**
   * Every subject mentioned in any normalized inequality entry (as a bare
   * term, `Negate(term)`, `Subtract` operand, or `Add` summand) — collected
   * regardless of the entry's truth value. A subject absent from this set
   * provably cannot be decided by the legacy linear-scan sign inference, so
   * callers may skip that O(#assumptions) fallback without changing any
   * answer (the gate over-approximates the scan's reach; it never turns
   * "unknown" into a definite sign).
   */
  inequalitySubjects: Set<string>;
  /**
   * What the facts prove about the TYPE of each subject definition, as the
   * operands of one intersection the reader reduces together with the
   * definition's declared type (see `BoxedValueDefinition.type`).
   *
   * Keyed by DEFINITION, never by name — the identity rule of
   * `docs/plans/2026-08-29-assumptions-as-facts-type.md` §2.2: a fact
   * contributes to the definition the assertion was recorded against and to
   * no other, so re-declaring a name in an inner scope leaves the facts about
   * the outer definition alone and each of two definitions of one name keeps
   * its own contributions.
   */
  typeByDefinition: Map<BoxedValueDefinition, Type[]>;
};

/** A single ≥ edge `u ≥ to` (strict = `u > to`) in the assumed-inequality graph. */
type GeEdge = { to: string; strict: boolean };

const EMPTY_FACT_INDEX: FactIndex = Object.freeze({
  bySubject: new Map<string, SubjectFacts>(),
  membership: new Map<string, MembershipFacts>(),
  geEdges: new Map<string, GeEdge[]>(),
  inequalitySubjects: new Set<string>(),
  typeByDefinition: new Map<BoxedValueDefinition, Type[]>(),
});

/** The type contributions the facts make to `def`, or an empty array. */
export function typeFor(index: FactIndex, def: BoxedValueDefinition): Type[] {
  return index.typeByDefinition.get(def) ?? [];
}

/**
 * The type the facts in force prove about `def` ON THEIR OWN — the reduced
 * intersection of their contributions, without the declared type — or
 * `undefined` when they prove nothing.
 *
 * This is what a CONSTRAINT check reads: an assumption is an assertion, not a
 * guess, so a value must satisfy it whether the declaration was a contract or
 * an inferred guess, and whether or not the definition already holds a value
 * (its type deliberately does not narrow, but the facts still bind it).
 */
export function provenTypeNode(
  ce: ComputeEngine,
  def: BoxedValueDefinition
): Type | undefined {
  if (contextAssumptions(ce).size === 0) return undefined;
  const contributions = typeFor(getFactIndex(ce), def);
  if (contributions.length === 0) return undefined;
  return reduceType({ kind: 'intersection', types: contributions });
}

/**
 * The fact in force that a candidate `value` for `def` REFUTES, or `undefined`
 * when every fact about `def` survives it.
 *
 * What a fact contributes to a type is a summary, and a coarse one: an
 * equality contributes only the promoted TIER of its value (`x = 5`
 * contributes `integer`), so a type-only check accepts `assign(x, 7)` while
 * `x = 5` is in force. This puts the candidate value back into the fact
 * expression and asks whether the fact still holds. A fact that still mentions
 * an unknown after the substitution is left undecided: a value is refused only
 * on a fact that is definitely false with it.
 */
export function refutingFact(
  ce: ComputeEngine,
  def: BoxedValueDefinition,
  value: Expression
): Expression | undefined {
  const assumptions = contextAssumptions(ce);
  if (assumptions.size === 0) return undefined;

  for (const [fact, records] of assumptions.entries()) {
    // The assertions under one key share the fact EXPRESSION, so the first one
    // asserted about `def` decides which symbol of it stands for this value.
    let subject: FactSubject | undefined;
    for (const record of records) {
      if (record.truth !== true) continue;
      subject = record.subjects.find((s) => s.def === def && s.part === 'self');
      if (subject !== undefined) break;
    }
    if (subject === undefined || subject.def.disposed) continue;

    const substituted = fact.subs({ [subject.symbol]: value });
    if (substituted.unknowns.length !== 0) continue;
    // An equality is decided ARITHMETICALLY rather than by evaluation, so that
    // `x = 1` and a candidate `2/2` agree.
    if (isFunction(substituted, 'Equal') && substituted.ops.length === 2) {
      if (substituted.op1.isEqual(substituted.op2) === false) return fact;
      continue;
    }
    if (isSymbol(substituted.evaluate(), 'False')) return fact;
  }
  return undefined;
}

type FactIndexCacheEntry = {
  /** `ce._anyVersion` at build time. `assume()`/`forget()` bump it. */
  generation: number;
  /**
   * The map's own mutation counter at build time. Catches a `.set()` or
   * `.delete()` that changed the contents without advancing the engine's
   * generation — a checkpoint restore refills a map in place, and internal
   * storage of a normalized fact can replace one key's records.
   */
  version: number;
  index: FactIndex;
};

/**
 * Keyed by the assumptions map itself rather than by the engine: a scope
 * push installs a fresh copy of the map (`engine-scope.ts`), so a single
 * per-engine slot would rebuild the index on every push — and a read-only
 * scoped probe pushes and pops per read. Keeping one entry per map lets the
 * enclosing scope's index survive a nested scope, and an entry dies with the
 * map it describes.
 */
const factIndexCache = new WeakMap<AssumptionStore, FactIndexCacheEntry>();

/** Collect the distinct subjects appearing as top-level terms of a
 * normalized inequality lhs (bare term, `Negate(term)`, or summands of an
 * `Add`). */
function subjectsInNormalizedLhs(lhs: Expression): Subject[] {
  const found = new Map<string, Subject>();
  const consider = (term: Expression) => {
    const inner =
      isFunction(term, 'Negate') && term.ops.length === 1 ? term.op1 : term;
    const s = subjectOf(inner);
    if (s !== undefined) found.set(subjectKey(s), s);
  };
  if (isFunction(lhs, 'Add')) for (const term of lhs.ops) consider(term);
  else if (isFunction(lhs, 'Subtract') && lhs.ops.length === 2) {
    // Not produced by canonical normalization, but the legacy scan matches
    // `Subtract` operands, so the `inequalitySubjects` gate must see them.
    // Harmless for the bounds path (`boundsFromNormalizedInequality`
    // recognizes no `Subtract` shape and yields no bound for these).
    consider(lhs.ops[0]);
    consider(lhs.ops[1]);
  } else consider(lhs);
  return [...found.values()];
}

/**
 * Recognize a normalized inequality lhs of the pure symbol-difference shape
 * `Add(sym, Negate(sym))` (i.e. `pos - neg`) with two bare symbols and no other
 * terms. Returns `{ pos, neg }` (the bare symbol name and the negated symbol
 * name), or `undefined`.
 */
function symbolDifference(
  lhs: Expression
): { pos: string; neg: string } | undefined {
  if (!isFunction(lhs, 'Add') || lhs.ops.length !== 2) return undefined;
  let pos: string | undefined;
  let neg: string | undefined;
  for (const t of lhs.ops) {
    if (isSymbol(t)) {
      if (pos !== undefined) return undefined; // two bare terms
      pos = t.symbol;
    } else if (
      isFunction(t, 'Negate') &&
      t.ops.length === 1 &&
      isSymbol(t.op1)
    ) {
      if (neg !== undefined) return undefined;
      neg = t.op1.symbol;
    } else return undefined;
  }
  if (pos === undefined || neg === undefined) return undefined;
  return { pos, neg };
}

/**
 * Recognize a normalized-inequality lhs of the form `±Part(x) + k` where
 * `Part ∈ {Real, Imaginary, Abs, Argument}` and `k` is an optional numeric
 * constant. Returns the (non-self) subject, or `undefined`.
 *
 * Deliberately stricter than `boundsFromNormalizedInequality`: an lhs with
 * a non-numeric extra term (e.g. `Re(s) + Im(s)`) is *not* a part-bound and
 * is stored opaque instead.
 */
export function partBoundSubject(lhs: Expression): Subject | undefined {
  const partOf = (term: Expression): Subject | undefined => {
    const inner =
      isFunction(term, 'Negate') && term.ops.length === 1 ? term.op1 : term;
    const s = subjectOf(inner);
    return s !== undefined && s.part !== 'self' ? s : undefined;
  };

  const direct = partOf(lhs);
  if (direct !== undefined) return direct;

  if (!isFunction(lhs, 'Add')) return undefined;
  let subject: Subject | undefined = undefined;
  for (const term of lhs.ops) {
    const s = partOf(term);
    if (s !== undefined) {
      if (subject !== undefined) return undefined; // more than one part term
      subject = s;
    } else if (!isNumber(term)) {
      return undefined; // non-numeric extra term
    }
  }
  return subject;
}

/** True if `expr` contains a part term (`Real/Imaginary/Abs/Argument` of a
 * bare symbol) anywhere. */
export function containsPartTerm(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  const s = subjectOf(expr);
  if (s !== undefined && s.part !== 'self') return true;
  return expr.ops.some(containsPartTerm);
}

//
// ─── Type contributions (design §2.3) ───────────────────────────────────────
//
// What a stored fact proves about the TYPE of the definition it is about.
// These producers used to be TYPE WRITES inside `assume()`; they now derive
// the same types at read time, so that retracting a fact retracts the type it
// proved and no stored contract can be built from one
// (`docs/plans/2026-08-29-assumptions-as-facts-type.md` §2.3).
//

function addContribution(
  out: Map<BoxedValueDefinition, Type[]>,
  def: BoxedValueDefinition,
  type: Type
): void {
  const existing = out.get(def);
  if (existing === undefined) out.set(def, [type]);
  else existing.push(type);
}

/**
 * The subject a whole-value fact is ABOUT: its one `'self'` subject that is
 * an unknown quantity.
 *
 * A fact relating two unknowns (`x > y`) has two and proves nothing about
 * either one's type. The other symbols a fact may mention are quantities it
 * is not about — a constant (`x + 1 < π`), or a symbol holding a value
 * (`w := 5; assume(x + w < 0)`) — so a subject WITHOUT a value wins over one
 * with a value. A fact about a valued symbol alone (`assign u 5; assume u >
 * 3`) still names it: the type merge skips a valued definition, but a
 * CONSTRAINT check on the next assignment reads those contributions.
 */
function soleSelfSubject(record: FactRecord): FactSubject | undefined {
  const variables = record.subjects.filter(
    (s) => s.part === 'self' && s.def.isConstant !== true
  );
  const valueless = variables.filter((s) => s.def.value === undefined);
  if (valueless.length === 1) return valueless[0];
  if (valueless.length === 0 && variables.length === 1) return variables[0];
  return undefined;
}

/** The subject of `record` named `symbol` with the given part, if any. */
function subjectNamed(
  record: FactRecord,
  symbol: string,
  part: SubjectPart
): FactSubject | undefined {
  return record.subjects.find((s) => s.symbol === symbol && s.part === part);
}

/**
 * The range a normalized inequality proves for its bare-symbol subject:
 * `x > k` proves the OPEN range `real<k<..>`, `x ≥ k` the closed `real<k..>`,
 * and the two upper-bound twins (open-bound ranged types,
 * `docs/plans/2026-08-28-open-bounds-in-ranged-types.md` §3.4) — the type is
 * the single channel for a symbol's own strict magnitude bound.
 *
 * `undefined` when the inequality is not a simple comparison against a
 * finite real literal; the caller then falls back to bare `real`, which is
 * all an inequality proves about a symbol on its own.
 */
function rangeFromNormalizedInequality(
  assumption: Expression,
  symbol: string
): Type | undefined {
  if (!isFunction(assumption)) return undefined;
  const op = assumption.operator;
  if (op !== 'Less' && op !== 'LessEqual') return undefined;
  const ops = assumption.ops;
  if (ops.length !== 2 || !ops[1].isSame(0)) return undefined;

  const lhs = ops[0];
  const strict = op === 'Less';
  const ce = assumption.engine;
  const subject: Subject = { symbol, part: 'self' };

  // `−x < 0` ⇔ `x > 0`, and `x < 0` is its upper-bound twin: the bound is
  // the literal zero, which is machine-exact.
  if (isFunction(lhs, 'Negate') && matchesSubject(lhs.op1, subject))
    return boundRange(true, ce.Zero, strict);
  if (matchesSubject(lhs, subject)) return boundRange(false, ce.Zero, strict);

  // `k − x (<|≤) 0` ⇔ `x (>|≥) k`, and `x + k (<|≤) 0` ⇔ `x (<|≤) −k`.
  if (!isFunction(lhs, 'Add') || lhs.ops.length !== 2) return undefined;
  let isLower: boolean | undefined;
  let constant: Expression | undefined;
  for (const term of lhs.ops) {
    if (isFunction(term, 'Negate') && matchesSubject(term.op1, subject)) {
      if (isLower !== undefined) return undefined;
      isLower = true;
    } else if (matchesSubject(term, subject)) {
      if (isLower !== undefined) return undefined;
      isLower = false;
    } else if (constant === undefined && isNumber(term)) {
      constant = term;
    } else return undefined;
  }
  if (isLower === undefined || constant === undefined) return undefined;
  return boundRange(isLower, isLower ? constant : constant.neg(), strict);
}

/**
 * The ranged type for one bound.
 *
 * `bound` may be an EXACT value the machine cannot represent (`1/3`, `1 −
 * 10⁻³⁰`). Its machine projection is then a ROUNDING, so the range takes the
 * projection moved OUTWARD by one ulp — a lower bound down, an upper bound up
 * — so that the range still admits every value the assumption admits, and the
 * open flag is demoted to closed: the strict fact was about the original
 * endpoint, and the moved bound is no longer that endpoint.
 */
function boundRange(
  isLower: boolean,
  bound: Expression,
  strict: boolean
): Type | undefined {
  if (bound.im !== 0) return undefined;
  const re = finiteNumericValue(bound);
  if (re === undefined) return undefined;
  const exact = bound.isSame(bound.engine.number(re));
  const k = exact ? re : isLower ? nextDown(re) : nextUp(re);
  const open = strict && exact;
  return isLower
    ? makeNumericRangeType('real', k, Infinity, open, false)
    : makeNumericRangeType('real', -Infinity, k, false, open);
}

/** The type a membership fact `x ∈ S` proves, or `undefined` for a set the
 * type system cannot express (an inert set, a user-defined finite literal
 * set). The bounds a `Range`/`Interval` also carries reach the type through
 * the separate bound facts `assume()` records alongside the membership.
 *
 * Exported so that `assume()` judges a membership against the SAME tier the
 * index will later contribute: the two must not disagree about what `x ∈ S`
 * proves, or a membership is refused for a tier no reader ever sees. */
export function membershipType(setExpr: Expression): Type | undefined {
  const primitive = domainToType(setExpr);
  if (primitive !== 'unknown') return primitive;
  if (isSymbol(setExpr)) return SIGNED_NUMBER_SETS[setExpr.symbol]?.type;
  if (isFunction(setExpr, 'Range') && setExpr.ops.length >= 2) return 'integer';
  if (isFunction(setExpr, 'Interval') && setExpr.ops.length === 2)
    return 'real';
  if (isFunction(setExpr, 'Union') && setExpr.ops.length > 0) {
    if (setExpr.ops.every((s) => isFunction(s, 'Range'))) return 'integer';
    if (
      setExpr.ops.every(
        (s) => isFunction(s, 'Interval') || isFunction(s, 'Range')
      )
    )
      return 'real';
  }
  return undefined;
}

/**
 * The tier an equality `x = v` proves for `x`: the promotion drops the detail
 * a single value carries — a range, or a literal type — and keeps only the
 * tier a symbol can be re-assigned within.
 *
 * This table must stay identical to its two siblings,
 * `widenAssignedType`/`inferTypeFromValue` in `boxed-value-definition.ts` and
 * `promotedValueType` in `engine-declarations.ts`: a symbol must get the same
 * type whether an assumption, a fresh declaration or an assignment supplied
 * its value.
 */
function promotedTierOfValue(value: Expression): Type {
  const t = value.type;
  if (t.matches('integer')) return 'integer';
  if (t.matches('rational')) return 'real';
  if (t.matches('real')) return 'real';
  if (t.matches('complex')) return 'number';
  // An infinite value and NaN are disjoint from `real` and from `complex`, so
  // they reach none of the rungs above. Each promotes to its own tier.
  if (t.matches('infinity')) return 'infinity';
  if (t.matches('nan')) return 'nan';
  return t.type;
}

/** The plain machine number a disequality excludes, or `undefined`. An exact
 * value the machine cannot represent (`x ≠ √2`) excludes nothing a type can
 * say: `numericValue` is a plain JS number for exactly the machine
 * literals. */
function machineNumberValue(expr: Expression): number | undefined {
  if (!isNumber(expr)) return undefined;
  const v = expr.numericValue;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Collect the type contributions of one assertion into `out`. */
function collectTypeContributions(
  assumption: Expression,
  record: FactRecord,
  out: Map<BoxedValueDefinition, Type[]>
): void {
  if (record.truth !== true) return;
  // An assertion about a definition whose scope is gone is about a value that
  // no longer exists, so it proves nothing about any live type.
  for (const s of record.subjects) if (s.def.disposed) return;

  if (!isFunction(assumption)) return;
  const op = assumption.operator;
  const ops = assumption.ops;

  if (op === 'Less' || op === 'LessEqual') {
    if (ops.length !== 2 || !ops[1].isSame(0)) return;
    const lhs = ops[0];
    const part = partBoundSubject(lhs);
    if (part !== undefined) {
      const target = subjectNamed(record, part.symbol, part.part);
      if (target === undefined) return;
      // A predicate over `Re(x)`/`Im(x)`/`Abs(x)`/`Arg(x)` implies at most
      // that `x` is a number — never that it is real. A FINITE upper bound on
      // `|x|` implies more: the value is finite, so `complex`, the widest
      // finite numeric type. `complex` is the honest claim and it is
      // deliberately not narrowed: a bound on the modulus says nothing about
      // the imaginary part, so the real-only rewrites correctly decline (the
      // rewrite `√(q²) → |q|` is false at `q = i`).
      const bounds = boundsFromNormalizedInequality(assumption, part);
      const finiteModulus =
        part.part === 'abs' &&
        bounds !== undefined &&
        finiteNumericValue(bounds.upper) !== undefined;
      addContribution(out, target.def, finiteModulus ? 'complex' : 'number');
      return;
    }
    // A part term the part-bound shape does not recognize (`Re(s) + Im(s) <
    // 0`) proves nothing about the whole value either.
    if (containsPartTerm(lhs)) return;
    const target = soleSelfSubject(record);
    if (target === undefined) return;
    addContribution(
      out,
      target.def,
      rangeFromNormalizedInequality(assumption, target.symbol) ?? 'real'
    );
    return;
  }

  if (op === 'Element') {
    if (ops.length !== 2 || !isSymbol(ops[0])) return;
    const target = subjectNamed(record, ops[0].symbol, 'self');
    if (target === undefined) return;
    const type = membershipType(ops[1]);
    if (type !== undefined) addContribution(out, target.def, type);
    return;
  }

  if (op === 'NotEqual') {
    if (ops.length !== 2) return;
    for (const [side, other] of [
      [ops[0], ops[1]],
      [ops[1], ops[0]],
    ]) {
      if (!isSymbol(side)) continue;
      const target = subjectNamed(record, side.symbol, 'self');
      if (target === undefined) continue;
      const k = machineNumberValue(other);
      if (k === undefined) continue;
      // An exclusion needs a base to be excluded FROM. Against a declared
      // type it sharpens it (`real & !2`), but `unknown & !3` reduces to a
      // bare `!3` — a type with no tier — which a consumer that reads a
      // symbol's type as a numeric DOMAIN cannot use: the solver's root
      // filter answered "no roots at all" for `assume(x ≠ 3); Solve(x² = 9)`.
      // The disequality stays a fact either way, and the fact index serves it
      // to every query that asks.
      if (target.def.declaredType.isUnknown) continue;
      addContribution(out, target.def, {
        kind: 'negation',
        type: { kind: 'value', value: k },
      });
    }
    return;
  }

  if (op === 'Equal') {
    if (ops.length !== 2) return;
    for (const [side, other] of [
      [ops[0], ops[1]],
      [ops[1], ops[0]],
    ]) {
      if (!isSymbol(side) || other.has(side.symbol) || !other.isValid) continue;
      const target = subjectNamed(record, side.symbol, 'self');
      if (target === undefined) continue;
      addContribution(out, target.def, promotedTierOfValue(other));
      return;
    }
  }
}

function buildFactIndex(
  assumptions: Iterable<[Expression, ReadonlyArray<FactRecord>]>
): FactIndex {
  const bySubject = new Map<string, SubjectFacts>();
  const membership = new Map<string, MembershipFacts>();
  const geEdges = new Map<string, GeEdge[]>();
  const inequalitySubjects = new Set<string>();
  const typeByDefinition = new Map<BoxedValueDefinition, Type[]>();

  const addGeEdge = (from: string, to: string, strict: boolean): void => {
    let arr = geEdges.get(from);
    if (!arr) {
      arr = [];
      geEdges.set(from, arr);
    }
    arr.push({ to, strict });
  };

  const subjectFacts = (subject: Subject): SubjectFacts => {
    const key = subjectKey(subject);
    let facts = bySubject.get(key);
    if (!facts) {
      facts = { bounds: {}, notEqual: [] };
      bySubject.set(key, facts);
    }
    return facts;
  };

  const membershipFacts = (symbol: string): MembershipFacts => {
    let facts = membership.get(symbol);
    if (!facts) {
      facts = { in: [], notIn: [] };
      membership.set(symbol, facts);
    }
    return facts;
  };

  for (const [assumption, records] of assumptions) {
    const op = assumption.operator;
    if (!op || !isFunction(assumption)) continue;

    // Type contributions are collected PER ASSERTION, because each assertion
    // names the definition it is about (the identity rule of §2.2); every
    // other index below is keyed by subject NAME and reads the key's
    // assertions as a whole.
    for (const record of records)
      collectTypeContributions(assumption, record, typeByDefinition);

    // Collect the legacy-scan gate set BEFORE the truth-value filter: the
    // legacy scan iterates every stored entry regardless of its value, so
    // the gate must over-approximate its reach to stay fail-closed.
    if (op === 'Less' || op === 'LessEqual') {
      const ops = assumption.ops;
      if (ops.length === 2 && ops[1].isSame(0))
        for (const subject of subjectsInNormalizedLhs(ops[0]))
          inequalitySubjects.add(subjectKey(subject));
    }

    if (!isFactTrue(records)) continue;

    //
    // Normalized inequalities: Less/LessEqual(lhs, 0)
    //
    if (op === 'Less' || op === 'LessEqual') {
      const ops = assumption.ops;
      if (ops.length !== 2 || !ops[1].isSame(0)) continue;
      for (const subject of subjectsInNormalizedLhs(ops[0])) {
        const partial = boundsFromNormalizedInequality(assumption, subject);
        if (partial !== undefined)
          mergeTightestBounds(subjectFacts(subject).bounds, partial);
      }
      // Symbol-vs-symbol edge: `pos - neg (≤|<) 0` ⇔ `neg ≥ pos` (or `neg > pos`).
      const diff = symbolDifference(ops[0]);
      if (diff !== undefined) addGeEdge(diff.neg, diff.pos, op === 'Less');
      continue;
    }

    //
    // Disequalities: NotEqual(subject, v) (either side may be the subject)
    //
    if (op === 'NotEqual') {
      const ops = assumption.ops;
      if (ops.length !== 2) continue;
      const [a, b] = ops;
      const sa = subjectOf(a);
      if (sa !== undefined) subjectFacts(sa).notEqual.push(b);
      const sb = subjectOf(b);
      if (sb !== undefined && !b.isSame(a)) subjectFacts(sb).notEqual.push(a);
      continue;
    }

    //
    // Membership: Element/NotElement(symbol, setExpr)
    //
    if (op === 'Element' || op === 'NotElement') {
      const ops = assumption.ops;
      if (ops.length !== 2) continue;
      const [x, setExpr] = ops;
      if (!isSymbol(x)) continue;
      const facts = membershipFacts(x.symbol);
      if (op === 'Element') facts.in.push(setExpr);
      else facts.notIn.push(setExpr);
      continue;
    }
  }

  return {
    bySubject,
    membership,
    geEdges,
    inequalitySubjects,
    typeByDefinition,
  };
}

/**
 * Lazily-built, cached index over the current context's assumptions.
 *
 * - Returns a shared empty index (cheaply, with no cache machinery) when
 *   there are no assumptions — hot paths with zero assumptions pay only an
 *   emptiness check.
 * - Otherwise, the index is cached against the assumptions map itself and
 *   invalidated when `ce._anyVersion` changes (bumped by `assume()`,
 *   `forget()`, declarations…) or when the map's own `version` changes
 *   (any `.set()`/`.delete()`/`.clear()`, including one that leaves the
 *   entry count unchanged).
 *
 * The returned index must be treated as read-only.
 */
export function getFactIndex(ce: ComputeEngine): FactIndex {
  // The accessor hands back an empty store while facts are suppressed, so
  // that case exits here and needs no place in the cache key.
  const assumptions = contextAssumptions(ce);
  if (assumptions.size === 0) return EMPTY_FACT_INDEX;

  const cached = factIndexCache.get(assumptions);
  if (
    cached &&
    cached.generation === ce._anyVersion &&
    cached.version === assumptions.version
  )
    return cached.index;

  // The builder derives TYPE contributions, and a type read goes back through
  // the effective type, which asks for this very index. Building with the
  // facts suppressed breaks that cycle and is also what makes a contribution
  // a function of declarations and literals alone. The map was captured
  // ABOVE, before the suppression: a builder reading through
  // `contextAssumptions()` would index the empty store.
  //
  // The RECORDING shield comes down for the build, because the index is
  // cached on `(map.version, ce._anyVersion)` and neither moves when the
  // shield goes up or down: an index built while `assume()` was recording
  // would otherwise be served to every later read of that generation.
  // `soleSelfSubject` reads `s.def.value` to decide which subject a fact is
  // about, and the shield hides exactly that, so a shielded build and a live
  // build do not agree.
  //
  // A memo filled by a producer read inside this window — `BoxedFunction`'s
  // `_type`/`_sgn`/`_structural` through `cachedValue`, the `_typeGeneration`
  // fast path, `BoxedDictionary._type` — keys on `ce._cacheGeneration()`,
  // which carries the suppression state in its low bit. So the fact-free
  // answer this build produces is stored apart from the live one and is never
  // served to a read made outside the window. The complete list of the memos
  // that observe the state, and of the ones that provably cannot reach a
  // fact, is `docs/plans/2026-08-30-assumptions-memo-inventory.md`.
  const shielded = _shieldedDefinitions;
  _shieldedDefinitions = undefined;
  let index: FactIndex;
  try {
    index = ce._withoutFacts(() => buildFactIndex(assumptions));
  } finally {
    _shieldedDefinitions = shielded;
  }
  factIndexCache.set(assumptions, {
    generation: ce._anyVersion,
    version: assumptions.version,
    index,
  });
  return index;
}

//
// ─── Query helpers (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1) ─────────────────────
//

/**
 * Fast emptiness check for the assumptions store. The P3 query hooks
 * (relational operators, sgn fallbacks, membership lookups, symbol
 * predicates) are gated on this so that zero-assumption engines pay only
 * one size read before any subject or index work.
 */
export function hasAssumptions(ce: ComputeEngine): boolean {
  return contextAssumptions(ce).size !== 0;
}

/**
 * Decide a comparison of a subject against the numeric constant `k` from
 * the subject's assumed interval bounds (design §5.1a).
 *
 * Strict three-valued discipline (design §5.2): returns `true` only when
 * the bounds entail the comparison, `false` only when they refute it, and
 * `undefined` otherwise.
 */
export function decideComparisonFromBounds(
  bounds: IntervalBounds,
  k: number,
  query: 'less' | 'lessEqual' | 'greater' | 'greaterEqual'
): boolean | undefined {
  const lower = finiteNumericValue(bounds.lower);
  const upper = finiteNumericValue(bounds.upper);
  const lowerStrict = bounds.lowerStrict === true;
  const upperStrict = bounds.upperStrict === true;

  switch (query) {
    case 'less': // subject < k
      // Entailed by subject < upper ≤ k (or ≤ upper < k)
      if (upper !== undefined && (upper < k || (upper === k && upperStrict)))
        return true;
      // Refuted by subject ≥ lower ≥ k (strictness immaterial)
      if (lower !== undefined && lower >= k) return false;
      return undefined;
    case 'lessEqual': // subject ≤ k
      if (upper !== undefined && upper <= k) return true;
      if (lower !== undefined && (lower > k || (lower === k && lowerStrict)))
        return false;
      return undefined;
    case 'greater': // subject > k
      if (lower !== undefined && (lower > k || (lower === k && lowerStrict)))
        return true;
      if (upper !== undefined && upper <= k) return false;
      return undefined;
    case 'greaterEqual': // subject ≥ k
      if (lower !== undefined && lower >= k) return true;
      if (upper !== undefined && (upper < k || (upper === k && upperStrict)))
        return false;
      return undefined;
  }
}

/**
 * Order two subjects purely from their assumed interval bounds (design
 * §5.1a, generalized to two bounded subjects).
 *
 * Returns a definite relation only when the bounds separate the two values;
 * `undefined` otherwise. Strict three-valued / fail-closed discipline:
 * - `'>'`/`'<'` when the separation is strict,
 * - `'>='`/`'<='` when the values touch at a shared, non-strict endpoint,
 * - `undefined` when the bounds overlap or don't separate.
 */
export function compareBounds(
  a: IntervalBounds,
  b: IntervalBounds
): '<' | '>' | '<=' | '>=' | undefined {
  const aLower = finiteNumericValue(a.lower);
  const aUpper = finiteNumericValue(a.upper);
  const bLower = finiteNumericValue(b.lower);
  const bUpper = finiteNumericValue(b.upper);

  // a > b (or a ≥ b): a's lower bound sits at/above b's upper bound.
  if (aLower !== undefined && bUpper !== undefined) {
    if (aLower > bUpper) return '>';
    if (aLower === bUpper)
      return a.lowerStrict === true || b.upperStrict === true ? '>' : '>=';
  }

  // a < b (or a ≤ b): a's upper bound sits at/below b's lower bound.
  if (aUpper !== undefined && bLower !== undefined) {
    if (aUpper < bLower) return '<';
    if (aUpper === bLower)
      return a.upperStrict === true || b.lowerStrict === true ? '<' : '<=';
  }

  return undefined;
}

/**
 * Derive a `Sign` from assumed interval bounds (design §5.1b — the
 * `Real`/`Imaginary`/`Abs`/`Argument` sgn fallbacks).
 *
 * Returns a sign only when the bounds entail it; `undefined` otherwise.
 */
export function signFromBounds(bounds: IntervalBounds): Sign | undefined {
  const lower = finiteNumericValue(bounds.lower);
  if (lower !== undefined) {
    if (lower > 0 || (lower === 0 && bounds.lowerStrict === true))
      return 'positive';
    if (lower === 0) return 'non-negative';
  }
  const upper = finiteNumericValue(bounds.upper);
  if (upper !== undefined) {
    if (upper < 0 || (upper === 0 && bounds.upperStrict === true))
      return 'negative';
    if (upper === 0) return 'non-positive';
  }
  return undefined;
}

//
// ─── Transitive-closure reasoning over assumed ≥/≤ chains ────────────────────
//

/**
 * Reachability from `start` over the directed ≥ edges. Returns a map from each
 * reachable node to a boolean: `true` if some path `start → … → node` uses at
 * least one strict edge (so `start > node`), `false` otherwise (`start ≥ node`).
 * `start` itself maps to `false`.
 *
 * A monotone fixpoint (a node's flag only flips `false → true`, and nodes are
 * only added), bounded by the number of edges so a cyclic graph cannot loop.
 */
function reachGE(
  geEdges: Map<string, GeEdge[]>,
  start: string
): Map<string, boolean> {
  const reached = new Map<string, boolean>([[start, false]]);
  let edgeCount = 0;
  for (const arr of geEdges.values()) edgeCount += arr.length;

  let changed = true;
  let guard = 0;
  const maxIterations = (edgeCount + 1) * (edgeCount + 1) + 1;
  while (changed && guard++ < maxIterations) {
    changed = false;
    for (const [u, strictU] of [...reached]) {
      const edges = geEdges.get(u);
      if (!edges) continue;
      for (const e of edges) {
        const newStrict = strictU || e.strict;
        const prev = reached.get(e.to);
        if (prev === undefined) {
          reached.set(e.to, newStrict);
          changed = true;
        } else if (!prev && newStrict) {
          reached.set(e.to, true);
          changed = true;
        }
      }
    }
  }
  return reached;
}

/**
 * Decide the order relation between two bare symbols purely from the assumed
 * ≥/≤ chains (transitive closure + antisymmetry).
 *
 * Returns:
 * - `'='` when `a ≥ … ≥ b` and `b ≥ … ≥ a` (an antisymmetric cycle),
 * - `'>'` / `'>='` when only `a` reaches `b` (strict if the chain has a strict link),
 * - `'<'` / `'<='` when only `b` reaches `a`,
 * - `undefined` when the chains do not relate them.
 */
export function relationFromChains(
  ce: ComputeEngine,
  a: string,
  b: string
): '>' | '>=' | '=' | '<' | '<=' | undefined {
  if (a === b) return '=';
  const geEdges = getFactIndex(ce).geEdges;
  if (geEdges.size === 0) return undefined;

  const fromA = reachGE(geEdges, a);
  const fromB = reachGE(geEdges, b);
  const aGeB = fromA.has(b); // a ≥ … ≥ b
  const bGeA = fromB.has(a); // b ≥ … ≥ a

  // Antisymmetry: a ≥ b and b ≥ a ⇒ a = b (takes precedence over any strict
  // flag; a strict link inside such a cycle is an inconsistent assumption set).
  if (aGeB && bGeA) return '=';
  if (aGeB) return fromA.get(b) === true ? '>' : '>=';
  if (bGeA) return fromB.get(a) === true ? '<' : '<=';
  return undefined;
}

/** Map an order relation to the sign of `lhs - rhs`. */
function relationToSign(
  rel: '>' | '>=' | '=' | '<' | '<=' | undefined
): Sign | undefined {
  switch (rel) {
    case '>':
      return 'positive';
    case '>=':
      return 'non-negative';
    case '<':
      return 'negative';
    case '<=':
      return 'non-positive';
    case '=':
      return 'zero';
    default:
      return undefined;
  }
}

/** Multiply two (strict) signs; only strict/zero inputs yield a definite sign. */
function multiplySigns(
  a: Sign | undefined,
  b: Sign | undefined
): Sign | undefined {
  const v = (s: Sign | undefined): number | undefined =>
    s === 'positive' ? 1 : s === 'negative' ? -1 : s === 'zero' ? 0 : undefined;
  const va = v(a);
  const vb = v(b);
  if (va === 0 || vb === 0) return 'zero';
  if (va === undefined || vb === undefined) return undefined;
  return va * vb > 0 ? 'positive' : 'negative';
}

/** Parse a term shaped `coef · sym²` (coef a numeric literal, exponent 2). */
function scaledSquare(
  term: Expression
): { coef: number; base: string } | undefined {
  let coef = 1;
  // Unwrap a leading Negate (e.g. `-y²` canonicalizes to `Negate(Power(y,2))`
  // when the coefficient magnitude is 1).
  if (isFunction(term, 'Negate') && term.ops.length === 1) {
    coef = -1;
    term = term.op1;
  }
  let powerTerm: Expression | undefined;
  if (isFunction(term, 'Power')) {
    powerTerm = term;
  } else if (isFunction(term, 'Multiply')) {
    for (const f of term.ops) {
      if (isFunction(f, 'Power')) {
        if (powerTerm !== undefined) return undefined;
        powerTerm = f;
      } else {
        const val = finiteNumericValue(f);
        if (val === undefined) return undefined;
        coef *= val;
      }
    }
  } else return undefined;

  if (powerTerm === undefined || !isFunction(powerTerm, 'Power'))
    return undefined;
  if (powerTerm.ops.length !== 2) return undefined;
  const base = powerTerm.op1;
  if (!isSymbol(base)) return undefined;
  if (finiteNumericValue(powerTerm.op2) !== 2) return undefined;
  return { coef, base: base.symbol };
}

/**
 * Recognize a difference of equally-scaled squares
 * `k·a² − k·b²` (`k > 0`). Returns the base symbols so the sign reduces to
 * `sign(a − b) · sign(a + b)`.
 */
function differenceOfSquares(
  expr: Expression
): { a: string; b: string } | undefined {
  if (!isFunction(expr, 'Add') || expr.ops.length !== 2) return undefined;
  const t0 = scaledSquare(expr.ops[0]);
  const t1 = scaledSquare(expr.ops[1]);
  if (t0 === undefined || t1 === undefined) return undefined;
  if (t0.coef === 0 || t1.coef === 0) return undefined;
  if (Math.sign(t0.coef) === Math.sign(t1.coef)) return undefined;
  if (Math.abs(t0.coef) !== Math.abs(t1.coef)) return undefined;
  const pos = t0.coef > 0 ? t0 : t1;
  const neg = t0.coef > 0 ? t1 : t0;
  return { a: pos.base, b: neg.base };
}

/**
 * Best-effort sign of `expr` derived from assumed ≥/≤ chains, beyond what the
 * bounds-based `expr.sgn` already delivers. Deliberately NARROW — it handles
 * exactly two structures:
 * - a bare symbol difference `a − b` (from the transitive closure),
 * - a difference of equally-scaled squares `k(a² − b²)` via
 *   `sign(a − b)·sign(a + b)` (even-power monotonicity), where only the inner
 *   `a ± b` factors may consult the engine's own `.sgn` machinery.
 *
 * There is intentionally no general `.sgn` fallback at the top level: routing
 * ambient sign knowledge (e.g. `√a > 0` under `a > 0`) into relational
 * comparisons changes behaviors that deliberately stay conservative, such as
 * solve()'s root filtering keeping both `±√a` roots.
 *
 * Returns a definite `Sign` only when the chains entail it; `undefined`
 * otherwise.
 */
export function signFromChains(
  ce: ComputeEngine,
  expr: Expression
): Sign | undefined {
  // Bare symbol difference a - b.
  const d = symbolDifference(expr);
  if (d !== undefined) {
    const s = relationToSign(relationFromChains(ce, d.pos, d.neg));
    if (s !== undefined) return s;
  }

  // Difference of equally-scaled squares k(a² − b²) = k(a−b)(a+b), k > 0.
  const dsq = differenceOfSquares(expr);
  if (dsq !== undefined) {
    const a = ce.symbol(dsq.a);
    const b = ce.symbol(dsq.b);
    const s = multiplySigns(
      innerFactorSign(ce, a, b, -1),
      innerFactorSign(ce, a, b, +1)
    );
    if (s !== undefined) return s;
  }

  return undefined;
}

/**
 * Sign of the inner factor `a − b` (direction −1) or `a + b` (direction +1) of
 * a difference of squares. Consults the assumed chains first; for the sum
 * factor it may combine a chain relation with the engine's own `.sgn` of the
 * operands (x > y and y > 0 ⇒ x + y > 0), and finally falls back to the
 * factor's own `.sgn` (bounds machinery). This `.sgn` use is scoped to these
 * inner factors only — see the `signFromChains` doc comment.
 */
function innerFactorSign(
  ce: ComputeEngine,
  a: Expression,
  b: Expression,
  direction: -1 | 1
): Sign | undefined {
  if (direction === -1) {
    if (isSymbol(a) && isSymbol(b)) {
      const s = relationToSign(relationFromChains(ce, a.symbol, b.symbol));
      if (s !== undefined) return s;
    }
    return a.sub(b).sgn ?? undefined;
  }

  // Sum factor a + b: positive when one operand is positive and the other is
  // at least as large (chains) or itself non-negative (bounds).
  const sa = a.sgn;
  const sb = b.sgn;
  if (sa === 'positive' && (sb === 'positive' || sb === 'non-negative'))
    return 'positive';
  if (sb === 'positive' && (sa === 'positive' || sa === 'non-negative'))
    return 'positive';
  if (sb === 'positive' && isSymbol(a) && isSymbol(b)) {
    // a ≥ b (chains) and b > 0 (bounds) ⇒ a + b > 0.
    const rel = relationFromChains(ce, a.symbol, b.symbol);
    if (rel === '>' || rel === '>=' || rel === '=') return 'positive';
  }
  if (sa === 'positive' && isSymbol(a) && isSymbol(b)) {
    const rel = relationFromChains(ce, b.symbol, a.symbol);
    if (rel === '>' || rel === '>=' || rel === '=') return 'positive';
  }
  return a.add(b).sgn ?? undefined;
}
