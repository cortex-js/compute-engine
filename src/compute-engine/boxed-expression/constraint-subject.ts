import type {
  Expression,
  IComputeEngine as ComputeEngine,
  IntervalBounds,
  Sign,
} from '../global-types';
import { isFunction, isSymbol, isNumber } from './type-guards';

/**
 * Constraint subjects (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §2).
 *
 * The assumptions system keys facts not just on bare symbols, but on a small
 * algebra of "subjects": a symbol, or one of the four part-extractors
 * (`Real`, `Imaginary`, `Abs`, `Argument`) applied to exactly a bare symbol.
 *
 * This module is a leaf: it only imports types from `global-types` and the
 * runtime type guards. Do not add imports that could create cycles.
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

    for (const term of lhs.ops) {
      if (isFunction(term, 'Negate') && matchesSubject(term.op1, subject)) {
        hasNegatedSubject = true;
      } else if (matchesSubject(term, subject)) {
        hasSubject = true;
      } else {
        const val = finiteNumericValue(term);
        if (val !== undefined) constantSum += val;
      }
    }

    // Case 3: Add(Negate(subject), k) < 0 => k - subject < 0 => subject > k
    if (hasNegatedSubject && constantSum !== 0) {
      result.lower = ce.expr(constantSum);
      result.lowerStrict = isStrict;
    }

    // Case 4: Add(subject, k) < 0 => subject < -k
    if (hasSubject && constantSum !== 0) {
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
};

const EMPTY_FACT_INDEX: FactIndex = Object.freeze({
  bySubject: new Map<string, SubjectFacts>(),
  membership: new Map<string, MembershipFacts>(),
});

type FactIndexCacheEntry = {
  /** `ce._generation` at build time. `assume()`/`forget()` bump it. */
  generation: number;
  /**
   * Identity of the assumptions map at build time. `pushScope`/`popScope`
   * swap the map object, so scope changes invalidate the cache even when
   * the generation counter is untouched.
   */
  assumptions: unknown;
  /**
   * Entry count at build time. Catches direct `.set()`/`.delete()` on the
   * map that bypass the generation bump (e.g. internal storage of
   * normalized facts).
   */
  count: number;
  index: FactIndex;
};

const factIndexCache = new WeakMap<ComputeEngine, FactIndexCacheEntry>();

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
  else consider(lhs);
  return [...found.values()];
}

function buildFactIndex(
  assumptions: Iterable<[Expression, boolean]>
): FactIndex {
  const bySubject = new Map<string, SubjectFacts>();
  const membership = new Map<string, MembershipFacts>();

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

  for (const [assumption, val] of assumptions) {
    if (val !== true) continue;
    const op = assumption.operator;
    if (!op || !isFunction(assumption)) continue;

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

  return { bySubject, membership };
}

/**
 * Lazily-built, cached index over the current context's assumptions.
 *
 * - Returns a shared empty index (cheaply, with no cache machinery) when
 *   there are no assumptions — hot paths with zero assumptions pay only an
 *   emptiness check.
 * - Otherwise, the index is cached per engine and invalidated when
 *   `ce._generation` changes (bumped by `assume()`, `forget()`,
 *   declarations…), when the assumptions map object changes (scope
 *   push/pop), or when the number of stored assumptions changes (direct
 *   `.set()`/`.delete()` on the map).
 *
 * The returned index must be treated as read-only.
 */
export function getFactIndex(ce: ComputeEngine): FactIndex {
  const assumptions = ce.context?.assumptions;
  if (!assumptions) return EMPTY_FACT_INDEX;

  // Count entries (also serves as the fast empty check: the common case of
  // zero assumptions exits before touching the cache or building anything).
  let count = 0;
  for (const _entry of assumptions) count += 1;
  if (count === 0) return EMPTY_FACT_INDEX;

  const cached = factIndexCache.get(ce);
  if (
    cached &&
    cached.generation === ce._generation &&
    cached.assumptions === assumptions &&
    cached.count === count
  )
    return cached.index;

  const index = buildFactIndex(assumptions);
  factIndexCache.set(ce, {
    generation: ce._generation,
    assumptions,
    count,
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
 * an (empty) iterator check before any subject or index work.
 */
export function hasAssumptions(ce: ComputeEngine): boolean {
  const assumptions = ce.context?.assumptions;
  if (!assumptions) return false;
  for (const _entry of assumptions) return true;
  return false;
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
