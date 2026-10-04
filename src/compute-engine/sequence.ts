/**
 * Utilities for declarative sequence definitions.
 *
 * This module provides functions to create subscriptEvaluate handlers
 * from sequence definitions (base cases + recurrence relation).
 */

import type {
  Expression,
  IComputeEngine as ComputeEngine,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
} from './global-types.js';
import {
  isValueDef,
  updateDef,
  defIsCallableShaped,
} from './boxed-expression/utils.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from './boxed-expression/type-guards.js';
import { serialize as serializeLatex } from './latex-syntax/latex-syntax.js';
import { noteSequenceReadStop } from './boxed-expression/sequence-read-stops.js';
import { countLeaves } from './symbolic/fu-cost.js';
import { checkDeadline } from '../common/interruptible.js';
import {
  isTransitivelyPure,
  setSubscriptEvaluateReads,
} from './boxed-expression/transitive-purity.js';
import {
  memoDepsStillValid,
  snapshotMemoDeps,
  type MemoDeps,
} from './boxed-expression/collection-element-memo.js';

// ============================================================================
// Sequence Registry (SUB-7: Introspection support)
// ============================================================================

/**
 * Internal metadata for a sequence, used for introspection.
 * Supports both single-index and multi-index sequences.
 */
interface SequenceMetadata {
  name: string;
  /** For single-index sequences */
  variable?: string;
  /** For multi-index sequences */
  variables?: string[];
  /** Whether this is a multi-index sequence */
  isMultiIndex: boolean;
  /**
   * Base cases.
   * For single-index: numeric keys (0, 1, 2, ...)
   * For multi-index: string keys ('0,0', 'n,0', 'n,n', ...)
   */
  base: Map<number | string, Expression>;
  memoize: boolean;
  /**
   * Memoization cache.
   * For single-index: numeric keys
   * For multi-index: string keys like '5,2'
   */
  memo: Map<number | string, Expression> | null;
  /**
   * Memoization cache of the terms computed by a numeric approximation
   * (`.N()`, `N(x, n)`). It is separate from `memo`, so `getSequenceCache()`
   * shows only the exact terms, with the key shape it documents. The key
   * is the precision of the engine, the digits that an enclosing `N(x, n)`
   * requests, and the index: `'21:|5'`, `'21:50|5'`, `'21:|5,2'`.
   * It also keeps the terms of an exact evaluation that contain a float
   * (`h_n = h_{n−1} + 0.1√2`), because their digits depend on the
   * precision: the key is `E` and the same key, `'E21:50|5'`.
   * `null` when memoization is disabled.
   */
  numericMemo: Map<string, Expression> | null;
  /**
   * The keys of the terms that were declined: the handler returned no
   * term, so the `Subscript` stays unevaluated. The key is the key of
   * `memo` or of `numericMemo`, after `E` (exact) or `N` (numeric).
   * Without this set, each read of a declined term computes it again, and
   * a recurrence that reads two lower terms is exponential in the index.
   * `null` when memoization is disabled.
   */
  declined: Set<string> | null;
  domain:
    | { min?: number; max?: number }
    | Record<string, { min?: number; max?: number }>;
  /** Constraint expression for multi-index sequences */
  constraints?: Expression;
}

/**
 * Registry of complete sequences for introspection.
 * Maps ComputeEngine → Map<name, SequenceMetadata>
 */
const sequenceRegistry = new WeakMap<
  ComputeEngine,
  Map<string, SequenceMetadata>
>();

function getOrCreateRegistry(ce: ComputeEngine): Map<string, SequenceMetadata> {
  if (!sequenceRegistry.has(ce)) {
    sequenceRegistry.set(ce, new Map());
  }
  return sequenceRegistry.get(ce)!;
}

/**
 * Register a sequence in the registry for introspection.
 */
function registerSequence(ce: ComputeEngine, metadata: SequenceMetadata): void {
  const registry = getOrCreateRegistry(ce);
  registry.set(metadata.name, metadata);
}

// ============================================================================
// Multi-Index Pattern Matching (SUB-9)
// ============================================================================

/**
 * Parsed base case pattern.
 * - 'exact': All indices are numeric (e.g., '0,0' → [0, 0])
 * - 'pattern': Contains variable names (e.g., 'n,0' → ['n', 0])
 */
interface ParsedPattern {
  type: 'exact' | 'pattern';
  values: (number | string)[];
}

/**
 * Parse a base case key into a pattern.
 *
 * @example
 * parseBasePattern('0,0') → { type: 'exact', values: [0, 0] }
 * parseBasePattern('n,0') → { type: 'pattern', values: ['n', 0] }
 * parseBasePattern('n,n') → { type: 'pattern', values: ['n', 'n'] }
 */
function parseBasePattern(key: string | number): ParsedPattern {
  if (typeof key === 'number') {
    return { type: 'exact', values: [key] };
  }

  const parts = key.split(',').map((p) => p.trim());
  const values = parts.map((p) => {
    const num = Number(p);
    return isNaN(num) ? p : num; // Variable names or numeric indices
  });
  const hasVariable = values.some((v) => typeof v === 'string');
  return { type: hasVariable ? 'pattern' : 'exact', values };
}

/**
 * Match a pattern against concrete indices.
 *
 * Patterns can contain:
 * - Numeric values that must match exactly
 * - Variable names that match any value
 * - Repeated variable names that must have equal values (e.g., 'n,n')
 *
 * @example
 * matchPattern({ type: 'exact', values: [0, 0] }, [0, 0]) → true
 * matchPattern({ type: 'pattern', values: ['n', 0] }, [5, 0]) → true
 * matchPattern({ type: 'pattern', values: ['n', 'n'] }, [5, 5]) → true
 * matchPattern({ type: 'pattern', values: ['n', 'n'] }, [5, 3]) → false
 */
function matchPattern(pattern: ParsedPattern, indices: number[]): boolean {
  if (pattern.values.length !== indices.length) return false;

  // Track variable bindings for equality checks (e.g., 'n,n' requires equal values)
  const bindings = new Map<string, number>();

  for (let i = 0; i < pattern.values.length; i++) {
    const pv = pattern.values[i];
    const iv = indices[i];

    if (typeof pv === 'number') {
      // Exact value must match
      if (pv !== iv) return false;
    } else {
      // Variable - check if we've seen it before
      if (bindings.has(pv)) {
        // Variable appeared earlier - values must be equal
        if (bindings.get(pv) !== iv) return false;
      } else {
        // First occurrence - bind it
        bindings.set(pv, iv);
      }
    }
  }
  return true;
}

/**
 * Prepared base case for efficient matching.
 */
interface PreparedBaseCase {
  pattern: ParsedPattern;
  value: Expression;
  /** Number of variables in pattern (more specific = fewer variables) */
  variableCount: number;
}

/**
 * Prepare and sort base cases for matching.
 * Order: exact matches first, then patterns with fewer variables (more specific first).
 */
function prepareBaseCases(
  base: Map<number | string, Expression>
): PreparedBaseCase[] {
  const cases: PreparedBaseCase[] = [];

  for (const [key, value] of base) {
    const pattern = parseBasePattern(key);
    const variableCount = pattern.values.filter(
      (v) => typeof v === 'string'
    ).length;
    cases.push({ pattern, value, variableCount });
  }

  // Sort: exact matches first, then by ascending variable count
  cases.sort((a, b) => {
    if (a.pattern.type !== b.pattern.type) {
      return a.pattern.type === 'exact' ? -1 : 1;
    }
    return a.variableCount - b.variableCount;
  });

  return cases;
}

/**
 * Find matching base case for given indices.
 */
function findMatchingBaseCase(
  cases: PreparedBaseCase[],
  indices: number[]
): Expression | undefined {
  for (const { pattern, value } of cases) {
    if (matchPattern(pattern, indices)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Validate domain constraints for multi-index sequences.
 */
function validateMultiIndexDomain(
  indices: number[],
  variables: string[],
  domain: Record<string, { min?: number; max?: number }>
): boolean {
  for (let i = 0; i < variables.length; i++) {
    const variable = variables[i];
    const index = indices[i];
    const constraint = domain[variable];

    if (constraint) {
      if (constraint.min !== undefined && index < constraint.min) return false;
      if (constraint.max !== undefined && index > constraint.max) return false;
    }
  }
  return true;
}

/**
 * Check constraint expression for multi-index sequences.
 * Returns true if constraints are satisfied or no constraints exist.
 */
function checkConstraints(
  ce: ComputeEngine,
  constraints: Expression,
  variables: string[],
  indices: number[]
): boolean {
  // Substitute variable values
  const subs: Record<string, Expression> = {};
  for (let i = 0; i < variables.length; i++) {
    subs[variables[i]] = ce.number(indices[i]);
  }

  const substituted = constraints.subs(subs);
  const result = substituted.evaluate();

  // Check if result is truthy (non-zero number or True)
  if (isSymbol(result)) {
    if (result.symbol === 'True') return true;
    if (result.symbol === 'False') return false;
  }
  if (isNumber(result)) return result.re !== 0;

  // If we can't determine, assume constraints are not satisfied
  return false;
}

/**
 * Create a subscriptEvaluate handler from a sequence definition.
 *
 * The handler evaluates expressions like `F_{10}` or `P_{5,2}` by:
 * 1. Checking base cases first (with pattern matching for multi-index)
 * 2. Looking up memoized values
 * 3. Recursively evaluating the recurrence relation
 *
 * Supports both single-index and multi-index sequences:
 * - Single-index: `F_{10}` with subscript as a number
 * - Multi-index: `P_{5,2}` with subscript as `Sequence(5, 2)`
 */
export function createSequenceHandler(
  ce: ComputeEngine,
  name: string,
  def: SequenceDefinition
): (
  subscript: Expression,
  options: { engine: ComputeEngine; numericApproximation?: boolean }
) => Expression | undefined {
  // Determine if this is a multi-index sequence
  const isMultiIndex = def.variables !== undefined && def.variables.length > 1;
  const variables = def.variables ?? [def.variable ?? 'n'];
  const variable = variables[0]; // For single-index backward compatibility

  const memoize = def.memoize ?? true;
  // Use string keys for multi-index, number keys for single-index
  const memo = memoize ? new Map<number | string, Expression>() : null;
  const numericMemo = memoize ? new Map<string, Expression>() : null;
  const declined = memoize ? new Set<string>() : null;
  const domain = def.domain ?? {};

  // Store recurrence source for lazy parsing
  const recurrenceSource = def.recurrence;
  let recurrence: Expression | null = null;

  // Parse and box constraint expression
  let constraintsExpr: Expression | null = null;
  if (def.constraints) {
    constraintsExpr =
      typeof def.constraints === 'string'
        ? ce.parse(def.constraints)!
        : def.constraints;
  }

  // Box base cases
  const base = new Map<number | string, Expression>();
  for (const [k, v] of Object.entries(def.base)) {
    const key = isMultiIndex ? String(k) : Number(k);
    base.set(key, typeof v === 'number' ? ce.number(v) : v);
  }

  // For multi-index: prepare sorted base cases for pattern matching
  const preparedBaseCases = isMultiIndex ? prepareBaseCases(base) : null;

  // The expressions that a term is computed from, with the recurrence:
  // the base cases and the constraints. The memos are valid while what
  // these expressions read is unchanged (see `memoStampIsValid`).
  const baseValues = [...base.values()];

  /** The recurrence, parsed on the first use. */
  const parsedRecurrence = (engine: ComputeEngine): Expression => {
    recurrence ??=
      typeof recurrenceSource === 'string'
        ? engine.parse(recurrenceSource)!
        : recurrenceSource;
    return recurrence;
  };

  const sources = (engine: ComputeEngine): Expression[] => [
    parsedRecurrence(engine),
    ...baseValues,
    ...(constraintsExpr === null ? [] : [constraintsExpr]),
  ];

  const metadata: SequenceMetadata = {
    name,
    variable: isMultiIndex ? undefined : variable,
    variables: isMultiIndex ? variables : undefined,
    isMultiIndex,
    base,
    memoize,
    memo,
    numericMemo,
    declined,
    domain,
    constraints: constraintsExpr ?? undefined,
  };

  // Register sequence for introspection (SUB-7)
  registerSequence(ce, metadata);

  // The state of the engine when the terms in the memos were computed, or
  // `undefined` before the first term is computed.
  let stamp: SequenceMemoStamp | undefined;

  /**
   * The stamp of the memos, after a check that it is still valid. When it
   * is not valid, the memos are cleared and a new stamp is taken.
   *
   * The stamp records what the sources of this sequence read, and also
   * what the sources of each sequence whose terms they read do: the
   * dependency snapshot of an expression follows the expressions that the
   * handler of a sequence registered (`setSubscriptEvaluateReads()`). Thus
   * with `A_n = B_n` and `B_n = B_{n−1} + x`, an assignment to `x` makes
   * the memoized terms of `A` outdated, although the recurrence of `A`
   * does not show `x`.
   */
  const currentStamp = (engine: ComputeEngine): SequenceMemoStamp => {
    if (stamp === undefined || !memoStampIsValid(engine, stamp)) {
      memo?.clear();
      numericMemo?.clear();
      declined?.clear();
      stamp = takeMemoStamp(engine, sources(engine));
    }
    return stamp;
  };

  // The purity of the sources (`isPureSequence()`), and the state of the
  // engine when it was computed.
  let purity:
    | {
        version: number;
        scope: unknown;
        sequence: boolean;
        constraints: boolean;
      }
    | undefined;

  /**
   * The purity of the sources, computed again when the engine changed
   * (`_anyVersion`, which each write, declaration and redefinition
   * changes) or when the current scope is a different scope (the value of
   * a symbol is read through the current scope).
   */
  const purityOf = (
    engine: ComputeEngine
  ): { sequence: boolean; constraints: boolean } => {
    const scope = engine.context?.lexicalScope;
    if (purity?.version !== engine._anyVersion || purity.scope !== scope) {
      const visited = new Set<unknown>();
      const sequence = sources(engine).every((e) =>
        isTransitivelyPure(e, visited)
      );
      const constraints =
        constraintsExpr === null || isTransitivelyPure(constraintsExpr);
      // The version is read after the walk: the walk can parse the
      // recurrence of another sequence, and the parse can declare symbols.
      purity = { version: engine._anyVersion, scope, sequence, constraints };
    }
    return purity;
  };

  /**
   * The key of the term at `indices` in `memo` or in `numericMemo`.
   *
   * The key carries whether the assumptions are hidden right now
   * (`ce._withoutFacts`, the bracket every type-write routine runs in): a
   * recurrence whose body mentions a symbol answers differently when an
   * `assume(x = …)` value is in force and when it is not, and a term
   * computed on one side of the bracket must not be served to a read on the
   * other (`docs/plans/2026-08-30-assumptions-memo-inventory.md`). The
   * prefix is added only inside such a window.
   *
   * A term computed by a numeric approximation is kept in its own map
   * (`numericMemo`), with a key that carries the precision of the engine
   * and the digits that an enclosing `N(x, n)` requests. Without this, the
   * float term of `.N()` was the value of a later exact evaluation, and a
   * term computed at 21 digits was the value of a later `N(a_10, 50)`:
   * `N(x, n)` computes at `n` digits with no reset of the engine
   * (`_withTransientPrecision`), and the memo is not cleared. An exact
   * term is kept in `memo`, which `getSequenceCache()` copies: outside a
   * window with hidden assumptions, its keys are the index (a number) or
   * the indices joined by commas, the shape that `getSequenceCache()`
   * documents.
   *
   * An exact evaluation can also give a term that contains a float (the
   * recurrence `h_n = h_{n−1} + 0.1√2`). The digits of that term depend on
   * the precision, so it is kept in `numericMemo` too, with the key of
   * `precisionKeyOf()` after `E`.
   */
  const memoKeyOf = (
    engine: ComputeEngine,
    indices: number[],
    numericApproximation: boolean | undefined
  ): number | string => {
    const indexKey = isMultiIndex ? indices.join(',') : indices[0];
    const modeKey = numericApproximation
      ? `${precisionKeyOf(engine)}|${indexKey}`
      : indexKey;
    return engine._factsHidden() ? `facts-hidden|${modeKey}` : modeKey;
  };

  /** The key in `numericMemo` of an exact term that contains a float. */
  const floatTermKeyOf = (engine: ComputeEngine, indices: number[]): string => {
    const indexKey = isMultiIndex ? indices.join(',') : indices[0];
    const key = `E${precisionKeyOf(engine)}|${indexKey}`;
    return engine._factsHidden() ? `facts-hidden|${key}` : key;
  };

  /**
   * The memoized term at `indices`: `{ term }`, where `term` is `undefined`
   * when the term was declined. `undefined` when the term is not in the
   * memos.
   */
  const memoizedTerm = (
    engine: ComputeEngine,
    indices: number[],
    numericApproximation: boolean | undefined
  ): { term: Expression | undefined } | undefined => {
    if (memo === null) return undefined;
    currentStamp(engine);
    const key = memoKeyOf(engine, indices, numericApproximation);
    const term = numericApproximation
      ? numericMemo!.get(key as string)
      : (memo.get(key) ?? numericMemo!.get(floatTermKeyOf(engine, indices)));
    if (term !== undefined) return { term };
    if (declined!.has(`${numericApproximation ? 'N' : 'E'}${key}`))
      return { term: undefined };
    return undefined;
  };

  /** Put the term at `indices` in the memos (`undefined`: declined). */
  const memoizeTerm = (
    engine: ComputeEngine,
    indices: number[],
    numericApproximation: boolean | undefined,
    term: Expression | undefined
  ): void => {
    const key = memoKeyOf(engine, indices, numericApproximation);
    if (term === undefined)
      declined!.add(`${numericApproximation ? 'N' : 'E'}${key}`);
    else if (numericApproximation) numericMemo!.set(key as string, term);
    else if (containsFloat(term))
      numericMemo!.set(floatTermKeyOf(engine, indices), term);
    else memo!.set(key, term);
  };

  /**
   * The value of the base case at `indices`, or `undefined` when `indices`
   * is not a base case.
   *
   * The base value is evaluated at each read, with `evaluate()` or with
   * `.N()`, as a term is. Thus a base value that reads a symbol (`b_0 = s`)
   * gives the value of the symbol now (`b_3` is `13` for `s := 10`, not
   * `s + 3`), and an exact base value such as `π` stays exact under
   * `evaluate()`. The stamp of the memos records the symbols that the base
   * values read (`takeMemoStamp()`), so an assignment to `s` makes the
   * memoized terms outdated.
   */
  const baseTerm = (
    indices: number[],
    numericApproximation: boolean | undefined
  ): Expression | undefined => {
    const value = isMultiIndex
      ? findMatchingBaseCase(preparedBaseCases!, indices)
      : base.get(indices[0]);
    if (value === undefined) return undefined;
    return numericApproximation ? value.N() : value.evaluate();
  };

  /** True when a term can be at `indices`. */
  const isValidIndex = (indices: number[], engine: ComputeEngine): boolean => {
    // All indices must be integers. An index that is not a safe integer
    // (`1e20`) is declined: `n − 1` is `n` for such an index, so the
    // recurrence would read the same term again.
    if (!indices.every((n) => Number.isSafeInteger(n))) return false;

    // Check domain constraints
    if (isMultiIndex) {
      // Multi-index domain: per-variable constraints
      const multiDomain = domain as Record<
        string,
        { min?: number; max?: number }
      >;
      if (
        Object.keys(multiDomain).length > 0 &&
        !validateMultiIndexDomain(indices, variables, multiDomain)
      )
        return false;
    } else {
      // Single-index domain
      const singleDomain = domain as { min?: number; max?: number };
      const n = indices[0];
      if (singleDomain.min !== undefined && n < singleDomain.min) return false;
      if (singleDomain.max !== undefined && n > singleDomain.max) return false;
    }

    // Check constraint expression (multi-index only)
    if (!constraintsExpr) return true;

    // A constraint that reads the term that it checks, also through other
    // terms, makes the index not valid. Without this, the check of the
    // term starts again in the check, with no end. The checks that are in
    // progress are also limited in depth, as the recursive computations
    // of terms are (`MAX_RECURSION_DEPTH`).
    const key = indexKeyOf(indices);
    if (constraintChecks.has(key)) return false;
    if (recursionDepth >= MAX_RECURSION_DEPTH) {
      stopSequenceReads();
      return false;
    }
    constraintChecks.add(key);
    recursionDepth += 1;
    try {
      return checkConstraints(engine, constraintsExpr, variables, indices);
    } finally {
      recursionDepth -= 1;
      constraintChecks.delete(key);
    }
  };

  // The index keys of the terms whose constraint check is in progress.
  const constraintChecks = new Set<string>();

  // The cold reads in progress, by the key of `readKeyOf()`. A read of a
  // term inside one of them (the recurrence of a term reads a lower term)
  // is served by it: see `termAt()`.
  const reads = new Map<string, SequenceRead>();

  /**
   * The key of a cold read: the kind of evaluation (`E` for `evaluate()`,
   * `N` for `.N()`), the precision, and whether the assumptions are
   * hidden. A read of a term with the same key gives the same term.
   */
  const readKeyOf = (
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): string =>
    `${engine._factsHidden() ? 'facts-hidden|' : ''}${
      numericApproximation ? 'N' : 'E'
    }${precisionKeyOf(engine)}`;

  const indexKeyOf = (indices: number[]): string => indices.join(',');

  // The offsets `c` of the lower terms `name_{n−c}` that the recurrence
  // always reads (see `lowerTermOffsets()`). `null` before the analysis.
  let offsets: number[] | null = null;

  /**
   * True when the computation of a term has no side effect: the
   * recurrence, the base values and the constraints are pure (`isPure` is
   * false for an assignment, `Print`, `Random()`, a function declared
   * `pure: false`, and a function whose body has a side effect), and so
   * is each expression that their evaluation reads (`isTransitivelyPure()`):
   * the value of a symbol (`r` with the value `Random()` draws a number at
   * each read), the body of a user function, and the sources of another
   * sequence (registered with `setSubscriptEvaluateReads()`). Then a computation that is stopped and done again
   * (`computeTerm()`) does nothing that can be seen. The value is computed
   * again when the engine changes (`purityOf()`): a symbol in the
   * recurrence can get a function with side effects later.
   */
  const isPureSequence = (engine: ComputeEngine): boolean =>
    purityOf(engine).sequence;

  /**
   * The term at `indices`, or `undefined` when the term is declined.
   */
  const termAt = (
    indices: number[],
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): Expression | undefined => {
    // A read that was stopped declines each term (`stopSequenceReads()`).
    if (sequenceReadsStopped) return undefined;

    // The check of the constraints has side effects: a computation that is
    // in progress must not be done again after it.
    if (constraintsExpr !== null && !purityOf(engine).constraints)
      restartEpoch += 1;
    if (!isValidIndex(indices, engine)) return undefined;

    const known = memoizedTerm(engine, indices, numericApproximation);
    if (known !== undefined) return known.term;

    const pure = isPureSequence(engine);
    // The base value and the recurrence have side effects: the same
    // condition as for the constraints.
    if (!pure) restartEpoch += 1;
    const baseValue = baseTerm(indices, numericApproximation);
    if (baseValue !== undefined) return baseValue;

    const read = reads.get(readKeyOf(engine, numericApproximation));
    if (read === undefined)
      return beginRead(indices, pure, engine, numericApproximation);

    // The recurrence of a term of a cold read reads this term. A term that
    // the read computed is served also when the memos were cleared: the
    // computation of a term can change a symbol that the recurrence reads,
    // and without this, the lower terms were computed again at each level.
    const key = indexKeyOf(indices);
    if (read.terms.has(key)) return read.terms.get(key);
    // A term that reads itself, also through other terms, is declined.
    if (read.pending.has(key)) return undefined;

    // In a read of a pure sequence, the computation of the term that reads
    // this term is stopped, and it is done again after this term is known
    // (`computeTerm()`). This keeps the depth of the JavaScript calls small:
    // it does not grow with the index. The computation is not stopped when
    // it is not in progress (a constraint check between two computations),
    // or when work with side effects started after it (`restartEpoch`): a
    // second computation would do that work again.
    if (read.attempting && restartEpoch === read.attemptEpoch) {
      read.missing = indices;
      pendingSignal = read.signal;
      throw read.signal;
    }
    return computeRecursively(indices, read, engine, numericApproximation);
  };

  /**
   * Start a cold read of the term at `indices` (a term that is not
   * memoized and is not a base case): compute it, with the lower terms that
   * it reads. A pure sequence uses `computeTerm()`, and a sequence with
   * side effects uses `computeRecursively()`, which computes each term one
   * time.
   */
  const beginRead = (
    root: number[],
    pure: boolean,
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): Expression | undefined => {
    const readKey = readKeyOf(engine, numericApproximation);
    const read: SequenceRead = {
      signal: {},
      terms: new Map(),
      pending: new Set(),
      missing: undefined,
      attempting: false,
      attemptEpoch: 0,
      count: 0,
    };
    reads.set(readKey, read);
    activeSequenceReads += 1;
    try {
      return pure
        ? computeTerm(root, read, engine, numericApproximation)
        : computeRecursively(root, read, engine, numericApproximation);
    } catch (e) {
      // The signal of this read was thrown where no computation of the
      // read receives it. The term is declined: the signal must not get
      // out of the read.
      if (e === read.signal) return undefined;
      throw e;
    } finally {
      if (pendingSignal === read.signal) pendingSignal = undefined;
      reads.delete(readKey);
      activeSequenceReads -= 1;
      if (activeSequenceReads === 0) sequenceReadsStopped = false;
    }
  };

  /**
   * Compute the term at `root` of a pure sequence, with the lower terms
   * that it reads.
   *
   * The terms are computed on demand, with a stack of the terms whose
   * computation is not complete: when the recurrence of the term on the top
   * reads a term that is not known, its evaluation is stopped (`termAt()`
   * throws the signal of the read), the term that it reads is put on the
   * stack, and the term is computed again when that term is known. Thus:
   * - only the terms that the recurrence reads are computed: a term in a
   *   branch of an `If` that is not taken is not computed;
   * - the depth of the JavaScript calls does not grow with the index (a
   *   recursive evaluation of `F_{500}` exceeded the call stack);
   * - the computation of each term is completed one time in the read, also
   *   when it changes a symbol that the recurrence reads and the memos are
   *   cleared.
   *
   * A computation is done again only for a pure sequence: the second
   * computation then does nothing that can be seen, and it draws no random
   * number. A term that the recurrence always reads (`lowerTermOffsets()`)
   * is put on the stack before the term that reads it is computed, so the
   * computation of most terms is not stopped.
   *
   * The read is declined when it needs more than `MAX_TERMS_PER_READ` terms,
   * and it stops with the deadline of the evaluation
   * (`docs/TIMEOUT-MODEL.md`).
   */
  const computeTerm = (
    root: number[],
    read: SequenceRead,
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): Expression | undefined => {
    const stack: number[][] = [];
    const push = (indices: number[]): boolean => {
      read.count += 1;
      if (read.count > MAX_TERMS_PER_READ) {
        stopSequenceReads();
        return false;
      }
      stack.push(indices);
      read.pending.add(indexKeyOf(indices));
      return true;
    };
    if (!push(root)) return undefined;
    while (stack.length > 0) {
      checkDeadline(engine._deadlineFrame);
      const indices = stack[stack.length - 1];
      const needed =
        lowerTermToCompute(indices, read, engine, numericApproximation) ??
        computeOneTerm(indices, read, engine, numericApproximation);
      if (sequenceReadsStopped) return undefined;
      if (needed !== undefined) {
        if (!push(needed)) return undefined;
        continue;
      }
      stack.pop();
      read.pending.delete(indexKeyOf(indices));
    }
    return read.terms.get(indexKeyOf(root));
  };

  /**
   * A lower term that the recurrence of the term at `indices` always reads
   * and that is not known yet, or `undefined` (single-index sequences
   * only).
   */
  const lowerTermToCompute = (
    indices: number[],
    read: SequenceRead,
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): number[] | undefined => {
    if (isMultiIndex) return undefined;
    offsets ??= lowerTermOffsets(recurrence!, name, variable);
    for (const offset of offsets) {
      const lower = [indices[0] - offset];
      const key = indexKeyOf(lower);
      if (read.terms.has(key) || read.pending.has(key)) continue;
      if (!isValidIndex(lower, engine)) continue;
      if (base.has(lower[0])) continue;
      if (memoizedTerm(engine, lower, numericApproximation) !== undefined)
        continue;
      return lower;
    }
    return undefined;
  };

  /**
   * Compute the term at `indices` of a pure sequence with the recurrence.
   * Return the indices of a term that the recurrence reads and that is
   * not known yet: the computation is then stopped, and it is done again
   * later. Otherwise, the term is put in `read.terms`, and in the memos
   * when the state of the engine did not change during the computation.
   */
  const computeOneTerm = (
    indices: number[],
    read: SequenceRead,
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): number[] | undefined => {
    const termStamp = memo !== null ? currentStamp(engine) : undefined;
    read.missing = undefined;
    read.attempting = true;
    read.attemptEpoch = restartEpoch;

    let result: Expression | undefined = undefined;
    try {
      result = evaluateRecurrence(indices, engine, numericApproximation);
    } catch (e) {
      if (e !== read.signal) throw e;
    } finally {
      read.attempting = false;
      if (pendingSignal === read.signal) pendingSignal = undefined;
    }

    const missing = read.missing;
    if (missing !== undefined) {
      // A `catch` in the evaluation can keep the signal from reaching this
      // function: `read.missing` is what tells that the computation was
      // stopped.
      read.missing = undefined;
      return missing;
    }

    // The signal of an enclosing read (another sequence, or another kind
    // of evaluation) was caught in this computation: the result is not
    // valid, and the enclosing read must be stopped.
    if (pendingSignal !== undefined) throw pendingSignal;

    if (sequenceReadsStopped) return undefined;
    keepTerm(indices, read, engine, numericApproximation, result!, termStamp);
    return undefined;
  };

  /**
   * Compute the term at `indices` with the recurrence, and the lower terms
   * that it reads when the evaluation reads them (a recursive evaluation).
   * Each term is computed one time in the read, so a side effect of the
   * recurrence occurs one time for each term.
   *
   * This is the computation of the terms of a sequence with side effects.
   * It is also used in a read of a pure sequence when its computation must
   * not be stopped (see `termAt()`).
   *
   * The depth of the JavaScript calls grows with the depth of the
   * recursion. When the computations in progress, of all the sequences, are
   * more than `MAX_RECURSION_DEPTH`, or when the read needs more than
   * `MAX_TERMS_PER_READ` terms, the reads are stopped
   * (`stopSequenceReads()`): the term is declined, and the terms computed
   * before stay in the memos.
   */
  const computeRecursively = (
    indices: number[],
    read: SequenceRead,
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): Expression | undefined => {
    read.count += 1;
    if (
      recursionDepth >= MAX_RECURSION_DEPTH ||
      read.count > MAX_TERMS_PER_READ
    ) {
      stopSequenceReads();
      return undefined;
    }
    checkDeadline(engine._deadlineFrame);

    const termStamp = memo !== null ? currentStamp(engine) : undefined;
    const key = indexKeyOf(indices);
    read.pending.add(key);
    recursionDepth += 1;
    let result: Expression;
    try {
      result = evaluateRecurrence(indices, engine, numericApproximation);
    } finally {
      recursionDepth -= 1;
      read.pending.delete(key);
    }

    // The signal of a read was caught in this computation: see
    // `computeOneTerm()`.
    if (pendingSignal !== undefined) throw pendingSignal;

    if (sequenceReadsStopped) return undefined;
    return keepTerm(
      indices,
      read,
      engine,
      numericApproximation,
      result,
      termStamp
    );
  };

  /** Evaluate the recurrence at `indices`. */
  const evaluateRecurrence = (
    indices: number[],
    engine: ComputeEngine,
    numericApproximation: boolean | undefined
  ): Expression => {
    const subs: Record<string, Expression> = {};
    for (let i = 0; i < variables.length; i++)
      subs[variables[i]] = engine.number(indices[i]);
    const substituted = recurrence!.subs(subs);
    return numericApproximation ? substituted.N() : substituted.evaluate();
  };

  /**
   * Put the term that `result` gives in `read.terms`, and in the memos when
   * the stamp of the memos is still the one that was current before the
   * term was computed (`termStamp`). Otherwise, the state of the engine
   * changed during the computation, and the term can depend on the earlier
   * state. Return the term (`undefined`: declined).
   */
  const keepTerm = (
    indices: number[],
    read: SequenceRead,
    engine: ComputeEngine,
    numericApproximation: boolean | undefined,
    result: Expression,
    termStamp: SequenceMemoStamp | undefined
  ): Expression | undefined => {
    const term = acceptedTerm(result, numericApproximation);
    read.terms.set(indexKeyOf(indices), term);
    if (
      termStamp !== undefined &&
      stamp === termStamp &&
      memoStampIsValid(engine, termStamp)
    )
      memoizeTerm(engine, indices, numericApproximation, term);
    return term;
  };

  /**
   * The term that `result` gives, or `undefined` when the term is declined.
   */
  const acceptedTerm = (
    result: Expression,
    numericApproximation: boolean | undefined
  ): Expression | undefined => {
    if (isNumber(result)) return result;

    // A numeric approximation that is not a number literal (the recurrence
    // has a free symbol) is not a term.
    if (numericApproximation) return undefined;

    // An exact evaluation returns the exact term also when it is not a
    // single number literal: `π^10/10!` for `B_n = π·B_{n−1}/n`, `1 + 10√2`
    // for `a_n = a_{n−1} + √2`. This is what `evaluate()` returns for any
    // other constant expression.
    //
    // The term is declined (the `Subscript` stays unevaluated) when:
    // - it is not valid (it contains an error);
    // - its type is not `number`: the type of a `Subscript` of a sequence
    //   is `number` (the `Subscript` type handler), so a list, a string or
    //   the application `f(f(1))` of an undeclared function is not a term;
    // - it contains a lower term of the same sequence that was declined:
    //   the symbol of the sequence then occurs in the term;
    // - it has more than `MAX_EXACT_TERM_NODES` nodes. A recurrence over a
    //   free symbol, such as `c_n = x·c_{n−1} + 1`, gives a term that grows
    //   with `n`: evaluation does not expand a product of sums, so `c_n`
    //   is nested `n` levels deep. A recurrence that uses the previous term
    //   two times, such as `d_n = d_{n−1}(d_{n−1} + 1)`, doubles the size
    //   at each level. Each term is computed from the terms below it, so the
    //   limit also bounds the work at each level. A term with many nodes is
    //   also not a useful exact result.
    if (
      !result.isValid ||
      !result.type.matches('number') ||
      result.has(name) ||
      countLeaves(result) > MAX_EXACT_TERM_NODES
    )
      return undefined;

    // A term with a free symbol, such as `x(x + 1) + 1`, is memoized as a
    // constant term is: the stamp of the memos records the value of `x`
    // (its write version), so a later assignment `x := 2` makes the memo
    // outdated. The exact terms and the numeric terms are in different maps
    // (`memo` and `numericMemo`), so an exact term is never served to
    // `.N()`, and a float never to `evaluate()`.
    return result;
  };

  // Return the handler function
  const handler = (
    subscript: Expression,
    {
      engine,
      numericApproximation,
    }: { engine: ComputeEngine; numericApproximation?: boolean }
  ): Expression | undefined => {
    // Lazy parse the recurrence on first use
    parsedRecurrence(engine);

    // Extract indices from subscript
    let indices: number[];

    if (isFunction(subscript, 'Sequence')) {
      // Multi-index: Subscript(P, Sequence(n, k))
      // Evaluate operands in case they contain unevaluated arithmetic (e.g., n-1)
      indices = subscript.ops.map((op) => op.evaluate().re);
    } else if (isFunction(subscript, 'Tuple')) {
      // Multi-index after canonicalization: Subscript(P, Tuple(n, k))
      // Evaluate operands in case they contain unevaluated arithmetic (e.g., n-1)
      indices = subscript.ops.map((op) => op.evaluate().re);
    } else if (isFunction(subscript, 'Delimiter')) {
      // Alternative: Subscript(P, Delimiter(n, k))
      // Evaluate operands in case they contain unevaluated arithmetic (e.g., n-1)
      indices = subscript.ops.map((op) => op.evaluate().re);
    } else {
      // Single index - evaluate in case it contains arithmetic
      indices = [subscript.evaluate().re];
    }

    return termAt(indices, engine, numericApproximation);
  };
  setSubscriptEvaluateReads(handler, () => sources(ce));
  return handler;
}

/**
 * The state of the engine that the memoized terms of a sequence were
 * computed from.
 */
interface SequenceMemoStamp {
  worldVersion: number;
  objectStoreEpoch: number;
  /**
   * For each expression that a term is computed from (the recurrence and
   * the base cases), the dependency snapshot of the expression
   * (`snapshotMemoDeps()`). `undefined` when one of the expressions has no
   * snapshot: then `semanticVersion` is used instead.
   */
  deps: { expr: Expression; deps: MemoDeps }[] | undefined;
  /** `ce._semanticVersion` when `deps` is `undefined`. */
  semanticVersion: number;
}

/**
 * Record the state of the engine that a term computed now depends on.
 *
 * The world version changes with an assumption, a redefinition and a
 * change of the configuration (precision, angular unit, tolerance). The
 * dependency snapshot of each expression records the write version of each
 * symbol that the expression reads, also through the body of a user
 * function and through the sources of another sequence whose terms it
 * reads, so the assignment `x := 3` makes a term of `c_n = x·c_{n−1} + 1`
 * outdated, but an assignment to a symbol that the recurrence does not read
 * does not. This is the mechanism of the memo of the applications of a
 * function literal (`validApplicationMemo()` in `function-utils.ts`).
 *
 * An expression can have no snapshot (it contains a dictionary or an
 * object, or a symbol with no binding). Then each value write
 * (`ce._semanticVersion`) makes the memos outdated.
 */
function takeMemoStamp(
  ce: ComputeEngine,
  sources: Expression[]
): SequenceMemoStamp {
  let deps: SequenceMemoStamp['deps'] = [];
  for (const expr of sources) {
    if (isNumber(expr)) continue;
    const exprDeps = snapshotMemoDeps(expr);
    if (exprDeps === undefined) {
      deps = undefined;
      break;
    }
    deps.push({ expr, deps: exprDeps });
  }
  return {
    worldVersion: ce._worldVersion,
    objectStoreEpoch: ce._objectStoreEpoch,
    deps,
    semanticVersion: ce._semanticVersion,
  };
}

/** True when the state that `stamp` records is unchanged. */
function memoStampIsValid(
  ce: ComputeEngine,
  stamp: SequenceMemoStamp
): boolean {
  if (stamp.worldVersion !== ce._worldVersion) return false;
  if (stamp.objectStoreEpoch !== ce._objectStoreEpoch) return false;
  if (stamp.deps === undefined)
    return stamp.semanticVersion === ce._semanticVersion;
  return stamp.deps.every(({ expr, deps }) => memoDepsStillValid(expr, deps));
}

/**
 * The offsets `c` of the terms `name_{n−c}` of the sequence that a
 * single-index recurrence always reads, in increasing order. `computeTerm()`
 * computes these terms before the term that reads them, so that the
 * computation of the term is not stopped to compute them.
 *
 * A term is counted only when the form of its index is `variable − c`,
 * with `c` an integer of 1 or more: the canonical form `Add(n, −c)`, or
 * `Subtract(n, c)`. The value of the index at some values of `variable` is
 * not sufficient: `If(n < 10, 0, n − 1)` is `n − 1` for a large `n`, but
 * it is `0` for `n = 5`. A term is also counted only when it is not in an
 * operand of a lazy operator: the operands of `If`, `Which`, `And`, `Sum`,
 * … are evaluated by their operator, and maybe not at all. The lazy
 * operators of `EAGER_LAZY_OPERATORS` are the exception: they evaluate
 * each operand. A term that is not counted is computed when the evaluation
 * reads it.
 */
function lowerTermOffsets(
  recurrence: Expression,
  name: string,
  variable: string
): number[] {
  const offsets = new Set<number>();
  const visit = (e: Expression): void => {
    if (!isFunction(e)) return;
    if (e.operator === 'Subscript' && isSymbol(e.op1, name)) {
      const offset = affineOffset(e.op2, variable);
      if (offset !== undefined) offsets.add(offset);
      return;
    }
    if (e.operatorDefinition?.lazy && !EAGER_LAZY_OPERATORS.has(e.operator))
      return;
    for (const op of e.ops) visit(op);
  };
  visit(recurrence);
  return [...offsets].sort((a, b) => a - b);
}

/**
 * The integer `c` (1 or more) when the form of `index` is `variable − c`
 * (`Add(variable, −c)` or `Subtract(variable, c)`), or `undefined`.
 */
function affineOffset(index: Expression, variable: string): number | undefined {
  if (!isFunction(index) || index.nops !== 2) return undefined;
  const integerOf = (e: Expression): number | undefined =>
    isNumber(e) && e.im === 0 && Number.isSafeInteger(e.re) ? e.re : undefined;
  let c: number | undefined;
  if (index.operator === 'Add') {
    const [a, b] = index.ops;
    if (isSymbol(a, variable)) c = integerOf(b);
    else if (isSymbol(b, variable)) c = integerOf(a);
    c = c === undefined ? undefined : -c;
  } else if (index.operator === 'Subtract' && isSymbol(index.op1, variable))
    c = integerOf(index.op2);
  return c !== undefined && c >= 1 ? c : undefined;
}

/**
 * The operators that are lazy (their handler evaluates the operands) and
 * that evaluate each of their operands (`lowerTermOffsets()`).
 */
const EAGER_LAZY_OPERATORS = new Set(['Add', 'Multiply', 'List', 'Tuple']);

/**
 * The precision of the engine and the digits that an enclosing `N(x, n)`
 * requests, for the keys of the memos of a sequence: `'21:'`, `'21:50'`.
 */
function precisionKeyOf(ce: ComputeEngine): string {
  return `${ce.precision}:${ce._requestedPrecision ?? ''}`;
}

/** True when `expr` is a float or contains a float. */
function containsFloat(expr: Expression): boolean {
  if (isNumber(expr)) return !expr.isExact;
  return isFunction(expr) && expr.ops.some(containsFloat);
}

/**
 * A cold read of a term of a sequence: the computation of a term that is
 * not memoized, with the lower terms that it reads (`computeTerm()` in
 * `createSequenceHandler()`).
 */
interface SequenceRead {
  /**
   * The value that `termAt()` throws to stop the computation of a term
   * whose recurrence reads a term that is not known yet. It is not an
   * `Error`, so the evaluation does not change it into an error value.
   */
  signal: object;
  /** The terms computed in this read, by index key. `undefined`: declined. */
  terms: Map<string, Expression | undefined>;
  /** The index keys of the terms whose computation is not complete: the
   * terms on the stack of `computeTerm()`, and the terms that
   * `computeRecursively()` computes. */
  pending: Set<string>;
  /** The indices of the term that stopped the current computation. */
  missing: number[] | undefined;
  /** True while `computeOneTerm()` evaluates the recurrence of a term of
   * this read: only then can the computation be stopped. */
  attempting: boolean;
  /** The value of `restartEpoch` when that evaluation started. */
  attemptEpoch: number;
  /** The number of terms that the read started to compute. */
  count: number;
}

/**
 * The signal of a `SequenceRead` that was thrown and not yet received by
 * its read. A `catch` in the evaluation can keep the signal from reaching
 * its read: when the computation of a term of another read ends while a
 * signal is pending, that read throws the signal again, and its result is
 * not used. The evaluation is synchronous, so one value is sufficient.
 */
let pendingSignal: object | undefined = undefined;

/**
 * A counter that changes when work with side effects starts: a term of a
 * sequence that is not pure is computed or read, or a constraint that is
 * not pure is checked. A read of a pure sequence stops the computation of
 * a term (to compute a lower term first, and then to do the computation
 * again) only when this counter did not change after the computation
 * started. Otherwise, the second computation would do that work again: a
 * second assignment, a second `Print`, or a second draw of a random number.
 */
let restartEpoch = 0;

/**
 * The number of the recursive computations of terms (`computeRecursively()`)
 * and of the constraint checks that are in progress, for all the sequences.
 * Each one adds JavaScript calls to the call stack.
 */
let recursionDepth = 0;

/** The number of the cold reads in progress, for all the sequences. */
let activeSequenceReads = 0;

/**
 * True when the cold reads in progress were stopped (`stopSequenceReads()`):
 * each term read until the last of them ends is declined, and no term is
 * memoized. It is set back to false when the last read ends.
 */
let sequenceReadsStopped = false;

/**
 * Stop the cold reads in progress: the terms that they compute are
 * declined (the `Subscript` stays unevaluated), and they are not memoized,
 * also not as declined terms. Thus a later read of a lower index first,
 * and then of the same index, can give the term. Does nothing when no read
 * is in progress.
 */
function stopSequenceReads(): void {
  // Caches outside this module must not keep a result that contains a
  // term declined by this stop (`boxed-expression/sequence-read-stops.ts`).
  noteSequenceReadStop();
  if (activeSequenceReads > 0) sequenceReadsStopped = true;
}

/**
 * The largest number of recursive computations of terms and of constraint
 * checks in progress (`recursionDepth`). Past it, the reads are stopped,
 * so a recursion that is too deep declines the term and does not exceed
 * the call stack (a `RangeError` would leave the evaluation at an
 * arbitrary point).
 *
 * Each level of the recursion uses the calls of one evaluation of the
 * recurrence. With the default stack of Node.js, a cold read exceeded the
 * call stack at a depth of about 340 levels for `S_n = S_{n−1} + Random()`,
 * 400 for `a_n = Block(Assign(c, c + 1), a_{n−1} + 1)`, and 620 for
 * `G_n = G_{n−1} + G_{n−2} + 0·Random()`. The limit is less than a third
 * of the smallest of these, so that a recurrence with more nested
 * operators, or a read that starts from a deep evaluation, also has space.
 */
const MAX_RECURSION_DEPTH = 100;

/**
 * The largest number of terms that one cold read of a term computes. Past
 * it, the term is declined (the `Subscript` stays unevaluated). The terms
 * that were computed stay in the memos, so a read of a lower index first
 * makes a later read of a higher index possible. Without a limit, a read
 * such as `F_{10^6}` can run for minutes and keep hundreds of megabytes of
 * terms. 100,000 terms of the recurrence `a_n = a_{n−1} + 1` take about
 * two seconds.
 */
const MAX_TERMS_PER_READ = 100_000;

/**
 * The largest number of nodes (`countLeaves()`) in an exact sequence term
 * that is not a single number literal. A term with more nodes is declined:
 * the `Subscript` stays unevaluated. A number literal term has no limit,
 * because its size does not grow with the nesting of the recurrence.
 *
 * The value lets a recurrence over a free symbol give its first terms, and
 * keeps the cost of each level small. For `c_n = x·c_{n−1} + 1`, `c_0 = 1`,
 * the term `c_n` has `4n − 1` nodes, so the terms up to `c_62` are returned.
 * A constant term such as `π^n/n!` or `1 + n√2` has fewer than 10 nodes for
 * every `n`.
 */
const MAX_EXACT_TERM_NODES = 250;

/**
 * Validate a sequence definition.
 */
export function validateSequenceDefinition(
  ce: ComputeEngine,
  name: string,
  def: SequenceDefinition
): { valid: boolean; error?: string } {
  // Must have base cases
  if (!def.base || Object.keys(def.base).length === 0) {
    return {
      valid: false,
      error: `Sequence "${name}" requires at least one base case`,
    };
  }

  // Must have recurrence
  if (!def.recurrence) {
    return {
      valid: false,
      error: `Sequence "${name}" requires a recurrence relation`,
    };
  }

  // Parse recurrence to check validity
  const recurrence =
    typeof def.recurrence === 'string'
      ? ce.parse(def.recurrence)!
      : def.recurrence;

  if (!recurrence.isValid) {
    return {
      valid: false,
      error: `Invalid recurrence for "${name}": expression contains errors`,
    };
  }

  return { valid: true };
}

// ============================================================================
// LaTeX-based sequence definition support (SUB-5)
// ============================================================================

/**
 * Track pending sequence definitions (base cases + recurrence).
 * A sequence is "pending" until both base case(s) and recurrence are provided.
 * Supports both single-index and multi-index sequences.
 */
interface PendingSequence {
  /**
   * Base cases.
   * For single-index: Map<number, Expression>
   * For multi-index: Map<string, Expression> with keys like '0,0', 'n,0'
   */
  base: Map<number | string, Expression>;
  /**
   * Recurrence definition.
   * For single-index: variable is a string (e.g., 'n')
   * For multi-index: variables is an array (e.g., ['n', 'k'])
   */
  recurrence?: {
    variable?: string;
    variables?: string[];
    latex: string;
  };
  /** Whether this appears to be a multi-index sequence */
  isMultiIndex: boolean;
}

const pendingSequences = new WeakMap<
  ComputeEngine,
  Map<string, PendingSequence>
>();

function getOrCreatePending(ce: ComputeEngine, name: string): PendingSequence {
  if (!pendingSequences.has(ce)) {
    pendingSequences.set(ce, new Map());
  }
  const map = pendingSequences.get(ce)!;
  if (!map.has(name)) {
    map.set(name, { base: new Map(), isMultiIndex: false });
  }
  return map.get(name)!;
}

/**
 * Add a base case for a single-index sequence definition.
 * e.g., from `L_0 := 1`
 */
export function addSequenceBaseCase(
  ce: ComputeEngine,
  name: string,
  index: number,
  value: Expression
): void {
  const pending = getOrCreatePending(ce, name);
  pending.base.set(index, value);
  tryFinalizeSequence(ce, name);
}

/**
 * Add a base case for a multi-index sequence definition.
 * e.g., from `P_{0,0} := 1` or `P_{n,0} := 1`
 *
 * @param key - The base case key, e.g., '0,0' for exact or 'n,0' for pattern
 */
export function addMultiIndexBaseCase(
  ce: ComputeEngine,
  name: string,
  key: string,
  value: Expression
): void {
  const pending = getOrCreatePending(ce, name);
  pending.base.set(key, value);
  pending.isMultiIndex = true;
  tryFinalizeSequence(ce, name);
}

/**
 * Add a recurrence relation for a single-index sequence definition.
 * e.g., from `L_n := L_{n-1} + 1`
 *
 * We store the recurrence as a LaTeX string rather than a Expression
 * because the expression may have been parsed before the symbol was declared
 * with subscriptEvaluate. Storing as LaTeX allows us to re-parse fresh when
 * creating the handler, ensuring proper binding.
 */
export function addSequenceRecurrence(
  ce: ComputeEngine,
  name: string,
  variable: string,
  expr: Expression
): void {
  const pending = getOrCreatePending(ce, name);
  // Convert to LaTeX for deferred parsing
  pending.recurrence = { variable, latex: serializeLatex(expr.json) };
  tryFinalizeSequence(ce, name);
}

/**
 * Add a recurrence relation for a multi-index sequence definition.
 * e.g., from `P_{n,k} := P_{n-1,k-1} + P_{n-1,k}`
 *
 * @param variables - The index variable names, e.g., ['n', 'k']
 */
export function addMultiIndexRecurrence(
  ce: ComputeEngine,
  name: string,
  variables: string[],
  expr: Expression
): void {
  const pending = getOrCreatePending(ce, name);
  pending.recurrence = { variables, latex: serializeLatex(expr.json) };
  pending.isMultiIndex = true;
  tryFinalizeSequence(ce, name);
}

/**
 * Try to finalize a sequence definition.
 * A sequence is finalized when both base case(s) and recurrence are present.
 */
function tryFinalizeSequence(ce: ComputeEngine, name: string): void {
  const pending = getOrCreatePending(ce, name);

  // Need both base case(s) and recurrence to finalize
  if (pending.base.size === 0 || !pending.recurrence) return;

  // Convert to SequenceDefinition format
  const base: Record<number | string, Expression> = {};
  for (const [k, v] of pending.base) {
    base[k] = v;
  }

  // Build definition based on single vs multi-index
  const def: SequenceDefinition = {
    base,
    recurrence: pending.recurrence.latex, // Pass as string for fresh parsing
  };

  if (pending.isMultiIndex || pending.recurrence.variables) {
    // Multi-index sequence
    def.variables = pending.recurrence.variables;
  } else {
    // Single-index sequence
    def.variable = pending.recurrence.variable;
  }

  // Validate the definition
  const validation = validateSequenceDefinition(ce, name, def);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Create the subscriptEvaluate handler
  const handler = createSequenceHandler(ce, name, def);

  // Check if the symbol already exists in the current scope
  // (it may have been auto-declared when parsing the recurrence expression)
  const scope = ce.context.lexicalScope;
  const existingDef = scope.bindings.get(name);

  if (existingDef) {
    // Symbol already exists - update it with subscriptEvaluate
    const callableBefore = defIsCallableShaped(existingDef);
    updateDef(ce, name, existingDef, {
      subscriptEvaluate: handler,
    });
    // In-place redefinition of an existing binding is a semantic mutation
    // (a structural change, not a value write: the epoch bumps too).
    ce._noteStateEvent({
      kind: 'redefine',
      callableBefore,
      callableAfter: true,
    });
  } else {
    // Symbol doesn't exist - declare it with the handler
    ce.declare(name, {
      subscriptEvaluate: handler,
    });
  }

  // Clear pending
  pendingSequences.get(ce)!.delete(name);
}

/**
 * Check if expression contains self-reference to sequence name.
 * e.g., `a_{n-1}` when defining sequence 'a'
 */
export function containsSelfReference(
  expr: Expression,
  seqName: string
): boolean {
  if (isFunction(expr)) {
    // Check if this is a Subscript with the sequence name as base
    if (expr.operator === 'Subscript') {
      const op1 = expr.op1;
      if (isSymbol(op1, seqName)) return true;
    }

    // Recursively check operands
    return expr.ops.some((op) => containsSelfReference(op, seqName));
  }

  return false;
}

/**
 * Extract the index variable from a subscript expression.
 * e.g., from `n-1` extract 'n', from `2*k` extract 'k'
 */
export function extractIndexVariable(
  subscript: Expression
): string | undefined {
  // Simple symbol
  if (isSymbol(subscript)) return subscript.symbol;

  // Look for symbols in expression
  const symbols = subscript.symbols;

  // If exactly one symbol, use it
  if (symbols.length === 1) return symbols[0];

  // Multiple symbols or no symbols - ambiguous
  // Try to find common index variable names
  const commonVars = ['n', 'k', 'i', 'j', 'm'];
  for (const v of commonVars) {
    if (symbols.includes(v)) return v;
  }

  return undefined;
}

/**
 * Get the status of a sequence definition.
 *
 * Returns information about whether a sequence is complete, pending, or not defined.
 * Supports both single-index and multi-index sequences.
 */
export function getSequenceStatus(
  ce: ComputeEngine,
  name: string
): SequenceStatus {
  // Check for pending sequence first
  const pendingMap = pendingSequences.get(ce);
  const pending = pendingMap?.get(name);

  if (pending) {
    // Sort base indices appropriately
    const baseIndices = Array.from(pending.base.keys());
    if (!pending.isMultiIndex) {
      // Single-index: sort numerically
      (baseIndices as number[]).sort((a, b) => a - b);
    }
    // Multi-index: keep as strings, sort lexicographically

    return {
      status: 'pending',
      hasBase: pending.base.size > 0,
      hasRecurrence: !!pending.recurrence,
      baseIndices,
      variable: pending.recurrence?.variable,
      variables: pending.recurrence?.variables,
    };
  }

  // Check if symbol has subscriptEvaluate (complete sequence)
  const def = ce.lookupDefinition(name);
  if (def && isValueDef(def) && def.value.subscriptEvaluate) {
    // It's a complete sequence - get details from registry
    const registry = sequenceRegistry.get(ce);
    const metadata = registry?.get(name);

    if (metadata) {
      const baseIndices = Array.from(metadata.base.keys());
      if (!metadata.isMultiIndex) {
        // Single-index: sort numerically
        (baseIndices as number[]).sort((a, b) => a - b);
      }

      return {
        status: 'complete',
        hasBase: true,
        hasRecurrence: true,
        baseIndices,
        variable: metadata.variable,
        variables: metadata.variables,
      };
    }

    return {
      status: 'complete',
      hasBase: true,
      hasRecurrence: true,
      baseIndices: [],
    };
  }

  return {
    status: 'not-a-sequence',
    hasBase: false,
    hasRecurrence: false,
    baseIndices: [],
  };
}

// ============================================================================
// Introspection API (SUB-7)
// ============================================================================

/**
 * Get information about a defined sequence.
 * Returns `undefined` if the symbol is not a complete sequence.
 * Supports both single-index and multi-index sequences.
 */
export function getSequenceInfo(
  ce: ComputeEngine,
  name: string
): SequenceInfo | undefined {
  const registry = sequenceRegistry.get(ce);
  const metadata = registry?.get(name);

  if (!metadata) return undefined;

  // Get and sort base indices
  const baseIndices = Array.from(metadata.base.keys());
  if (!metadata.isMultiIndex) {
    // Single-index: sort numerically
    (baseIndices as number[]).sort((a, b) => a - b);
  }

  return {
    name: metadata.name,
    variable: metadata.variable,
    variables: metadata.variables,
    baseIndices,
    memoize: metadata.memoize,
    domain: metadata.domain,
    cacheSize: metadata.memo?.size ?? 0,
    isMultiIndex: metadata.isMultiIndex,
  };
}

/**
 * List all defined sequences.
 */
/**
 * Snapshot both sequence registries for a checkpoint — bounded state, taken
 * whole at checkpoint creation rather than journaled ("State coverage" in
 * `docs/CHECKPOINT-MODEL.md`).
 *
 * Sequences (`a_n := …`) bypass the binding model entirely into these
 * module-level `WeakMap`s, so the checkpoint journal never sees them and they
 * have to be captured whole. The capture is STRUCTURAL, not by reference: a
 * restore has to reinstate a sequence that was REPLACED during the window and
 * undo additions to a pre-existing PENDING one, not merely delete the names
 * the window created — and both the metadata records and their nested
 * base-case maps are mutated in place.
 *
 * Value memos are deliberately NOT captured: the restore clears them
 * wholesale (over-invalidation is a recompute).
 *
 * Bounded by design — sequence counts are small at a cell boundary.
 * @internal
 */
export function _sequenceRegistrySnapshot(ce: ComputeEngine): unknown {
  const registry = sequenceRegistry.get(ce);
  const pending = pendingSequences.get(ce);
  return {
    registry:
      registry === undefined
        ? undefined
        : [...registry.entries()].map(([name, meta]) => ({
            name,
            meta,
            // The record is mutated in place (base cases and recurrences are
            // added to an existing entry), so its fields ride along with it.
            fields: { ...meta, base: new Map(meta.base) },
          })),
    pending:
      pending === undefined
        ? undefined
        : [...pending.entries()].map(([name, entry]) => ({
            name,
            entry,
            fields: { ...entry, base: new Map(entry.base) },
          })),
  };
}

/**
 * Restore what {@link _sequenceRegistrySnapshot} captured, rewriting the
 * existing records in place and dropping the ones the window created. Every
 * value memo is cleared, whether or not its sequence moved.
 * @internal
 */
export function _restoreSequenceRegistrySnapshot(
  ce: ComputeEngine,
  snapshot: unknown
): void {
  const s = snapshot as {
    registry?: {
      name: string;
      meta: SequenceMetadata;
      fields: SequenceMetadata;
    }[];
    pending?: {
      name: string;
      entry: PendingSequence;
      fields: PendingSequence;
    }[];
  };

  const registry = sequenceRegistry.get(ce);
  if (registry !== undefined) {
    const kept = new Map((s.registry ?? []).map((e) => [e.name, e]));
    for (const name of [...registry.keys()])
      if (!kept.has(name)) registry.delete(name);
    for (const { name, meta, fields } of s.registry ?? []) {
      // In place, so anything holding the metadata record keeps answering
      // from it — the same identity rule the definition records follow.
      Object.assign(meta, fields);
      // `base` and `memo` are rebuilt rather than reassigned from `fields`
      // for two different reasons, both about identity.
      //
      // `base` is COPIED out of the snapshot so a second restore of the same
      // checkpoint does not hand the live record the snapshot's own map and
      // then mutate it.
      meta.base = new Map(fields.base);
      // `memo` and `numericMemo` are cleared IN PLACE, never replaced.
      // `createSequenceHandler` closes over the maps it created and reads
      // and writes THOSE objects directly; the metadata merely holds the
      // same references. Assigning a fresh map here would leave the handler
      // consulting the old one, so every value memoized after the checkpoint
      // would survive the rewind — the restore would look correct through
      // `getSequenceInfo` and still serve stale terms. Cleared rather than
      // restored: the stamp of the memos (`takeMemoStamp()`) records
      // counters of the engine, and a restore puts back an earlier state
      // through routes that this stamp was not designed for. A restore is
      // rare and a cleared memo costs only a recompute, so the memos are
      // not kept across it, even when their stamp is still valid. The set
      // of declined terms is cleared for the same reason.
      meta.memo?.clear();
      meta.numericMemo?.clear();
      meta.declined?.clear();
      registry.set(name, meta);
    }
  }

  const pending = pendingSequences.get(ce);
  if (pending !== undefined) {
    const kept = new Map((s.pending ?? []).map((e) => [e.name, e]));
    for (const name of [...pending.keys()])
      if (!kept.has(name)) pending.delete(name);
    for (const { name, entry, fields } of s.pending ?? []) {
      Object.assign(entry, fields);
      entry.base = new Map(fields.base);
      // Assigned unconditionally, OUTSIDE the `Object.assign` above: a
      // pending sequence is created without a `recurrence` key at all
      // (`getOrCreatePending`), and the recurrence is added in place later.
      // `Object.assign` only overwrites keys the source HAS, so a snapshot
      // taken before the recurrence arrived would leave a window-added one
      // in place — and `getSequenceStatus` reads `pending.recurrence`
      // directly, so the restored engine would report a recurrence a fresh
      // replay never had.
      entry.recurrence = fields.recurrence;
      pending.set(name, entry);
    }
  }
}

export function listSequences(ce: ComputeEngine): string[] {
  const registry = sequenceRegistry.get(ce);
  if (!registry) return [];
  return Array.from(registry.keys());
}

/**
 * Check if a symbol is a defined sequence.
 */
export function isSequence(ce: ComputeEngine, name: string): boolean {
  const registry = sequenceRegistry.get(ce);
  return registry?.has(name) ?? false;
}

/**
 * Clear the memoization cache for a sequence or all sequences.
 */
export function clearSequenceCache(ce: ComputeEngine, name?: string): void {
  const registry = sequenceRegistry.get(ce);
  if (!registry) return;

  if (name !== undefined) {
    // Clear cache for specific sequence
    const metadata = registry.get(name);
    metadata?.memo?.clear();
    metadata?.numericMemo?.clear();
    metadata?.declined?.clear();
  } else {
    // Clear caches for all sequences
    for (const metadata of registry.values()) {
      metadata.memo?.clear();
      metadata.numericMemo?.clear();
      metadata.declined?.clear();
    }
  }
}

/**
 * Get the memoization cache for a sequence.
 * Returns a copy of the cache Map, or `undefined` if not a sequence or memoization is disabled.
 *
 * For single-index sequences, keys are numbers.
 * For multi-index sequences, keys are comma-separated strings (e.g., '5,2').
 */
export function getSequenceCache(
  ce: ComputeEngine,
  name: string
): Map<number | string, Expression> | undefined {
  const registry = sequenceRegistry.get(ce);
  const metadata = registry?.get(name);

  if (!metadata?.memo) return undefined;

  // Return a copy to prevent external modification
  return new Map(metadata.memo);
}

// ============================================================================
// Generate Sequence Terms (SUB-8)
// ============================================================================

/**
 * Generate a list of sequence terms from start to end (inclusive).
 *
 * @param ce - The compute engine
 * @param name - The sequence name
 * @param start - Starting index (inclusive)
 * @param end - Ending index (inclusive)
 * @param step - Step size (default: 1)
 * @returns Array of BoxedExpressions for each term, or undefined if not a sequence
 *
 * @example
 * ```typescript
 * // For Fibonacci sequence F
 * generateSequenceTerms(ce, 'F', 0, 10);
 * // → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
 * ```
 */
export function generateSequenceTerms(
  ce: ComputeEngine,
  name: string,
  start: number,
  end: number,
  step: number = 1
): Expression[] | undefined {
  // Validate inputs
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    return undefined;
  }
  if (step <= 0 || !Number.isInteger(step)) {
    return undefined;
  }

  // Check if it's a valid sequence
  if (!isSequence(ce, name)) {
    return undefined;
  }

  const terms: Expression[] = [];

  // Generate terms by evaluating subscripted expressions
  for (let n = start; step > 0 ? n <= end : n >= end; n += step) {
    const expr = ce.parse(`${name}_{${n}}`)!;
    const value = expr.evaluate();

    // Only include if we got a valid numeric result
    if (isNumber(value)) {
      terms.push(value);
    } else {
      // If any term fails to evaluate, return undefined
      return undefined;
    }
  }

  return terms;
}
