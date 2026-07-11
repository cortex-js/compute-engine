import type {
  Expression,
  IComputeEngine as ComputeEngine,
  IntervalBounds,
  Sign,
} from '../global-types.js';
import { isFunction, isSymbol, isNumber } from './type-guards.js';

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
  /**
   * Directed ≥ edges between bare symbols derived from symbol-vs-symbol
   * inequality assumptions. An edge `u → { to: v, strict }` means the
   * assumptions entail `u ≥ v` (`u > v` when `strict`). Used by
   * `relationFromChains` for transitive-closure / antisymmetry reasoning.
   */
  geEdges: Map<string, GeEdge[]>;
};

/** A single ≥ edge `u ≥ to` (strict = `u > to`) in the assumed-inequality graph. */
type GeEdge = { to: string; strict: boolean };

const EMPTY_FACT_INDEX: FactIndex = Object.freeze({
  bySubject: new Map<string, SubjectFacts>(),
  membership: new Map<string, MembershipFacts>(),
  geEdges: new Map<string, GeEdge[]>(),
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

function buildFactIndex(
  assumptions: Iterable<[Expression, boolean]>
): FactIndex {
  const bySubject = new Map<string, SubjectFacts>();
  const membership = new Map<string, MembershipFacts>();
  const geEdges = new Map<string, GeEdge[]>();

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

  return { bySubject, membership, geEdges };
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
