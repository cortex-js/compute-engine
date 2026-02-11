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
} from './global-types';
import { isValueDef, updateDef } from './boxed-expression/utils';
import { isSymbol, isNumber, isFunction } from './boxed-expression/type-guards';

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
  const domain = def.domain ?? {};

  // Store recurrence source for lazy parsing
  const recurrenceSource = def.recurrence;
  let recurrence: Expression | null = null;

  // Parse and box constraint expression
  let constraintsExpr: Expression | null = null;
  if (def.constraints) {
    constraintsExpr =
      typeof def.constraints === 'string'
        ? ce.parse(def.constraints)
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

  // Register sequence for introspection (SUB-7)
  registerSequence(ce, {
    name,
    variable: isMultiIndex ? undefined : variable,
    variables: isMultiIndex ? variables : undefined,
    isMultiIndex,
    base,
    memoize,
    memo,
    domain,
    constraints: constraintsExpr ?? undefined,
  });

  // Return the handler function
  return (subscript, { engine, numericApproximation }) => {
    // Lazy parse the recurrence on first use
    if (recurrence === null) {
      recurrence =
        typeof recurrenceSource === 'string'
          ? engine.parse(recurrenceSource)
          : recurrenceSource;
    }

    // Extract indices from subscript
    let indices: number[];

    if (subscript.operator === 'Sequence' && isFunction(subscript)) {
      // Multi-index: Subscript(P, Sequence(n, k))
      // Evaluate operands in case they contain unevaluated arithmetic (e.g., n-1)
      indices = subscript.ops.map((op) => op.evaluate().re);
    } else if (subscript.operator === 'Tuple' && isFunction(subscript)) {
      // Multi-index after canonicalization: Subscript(P, Tuple(n, k))
      // Evaluate operands in case they contain unevaluated arithmetic (e.g., n-1)
      indices = subscript.ops.map((op) => op.evaluate().re);
    } else if (subscript.operator === 'Delimiter' && isFunction(subscript)) {
      // Alternative: Subscript(P, Delimiter(n, k))
      // Evaluate operands in case they contain unevaluated arithmetic (e.g., n-1)
      indices = subscript.ops.map((op) => op.evaluate().re);
    } else {
      // Single index - evaluate in case it contains arithmetic
      indices = [subscript.evaluate().re];
    }

    // All indices must be integers
    if (!indices.every((n) => Number.isInteger(n))) return undefined;

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
      ) {
        return undefined;
      }
    } else {
      // Single-index domain
      const singleDomain = domain as { min?: number; max?: number };
      const n = indices[0];
      if (singleDomain.min !== undefined && n < singleDomain.min)
        return undefined;
      if (singleDomain.max !== undefined && n > singleDomain.max)
        return undefined;
    }

    // Check constraint expression (multi-index only)
    if (
      constraintsExpr &&
      !checkConstraints(engine, constraintsExpr, variables, indices)
    ) {
      return undefined;
    }

    // Generate memo key
    const memoKey = isMultiIndex ? indices.join(',') : indices[0];

    // Check memo first
    if (memo?.has(memoKey)) return memo.get(memoKey)!;

    // Check base cases
    if (isMultiIndex) {
      // Multi-index: use pattern matching
      const baseValue = findMatchingBaseCase(preparedBaseCases!, indices);
      if (baseValue !== undefined) {
        if (memo) memo.set(memoKey, baseValue);
        return baseValue;
      }
    } else {
      // Single-index: direct lookup
      const n = indices[0];
      if (base.has(n)) return base.get(n)!;
    }

    // Evaluate recurrence by substituting all variables
    const subs: Record<string, Expression> = {};
    for (let i = 0; i < variables.length; i++) {
      subs[variables[i]] = engine.number(indices[i]);
    }

    const substituted = recurrence.subs(subs);
    const result = numericApproximation
      ? substituted.N()
      : substituted.evaluate();

    // Memoize valid numeric results
    if (memo && isNumber(result)) {
      memo.set(memoKey, result);
    }

    return isNumber(result) ? result : undefined;
  };
}

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
      ? ce.parse(def.recurrence)
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
  pending.recurrence = { variable, latex: expr.latex };
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
  pending.recurrence = { variables, latex: expr.latex };
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
    updateDef(ce, name, existingDef, {
      subscriptEvaluate: handler,
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
      if (isSymbol(op1) && op1.symbol === seqName) return true;
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
    if (metadata?.memo) {
      metadata.memo.clear();
    }
  } else {
    // Clear caches for all sequences
    for (const metadata of registry.values()) {
      if (metadata.memo) {
        metadata.memo.clear();
      }
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
    const expr = ce.parse(`${name}_{${n}}`);
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
