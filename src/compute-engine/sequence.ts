/**
 * Utilities for declarative sequence definitions.
 *
 * This module provides functions to create subscriptEvaluate handlers
 * from sequence definitions (base cases + recurrence relation).
 */

import type {
  BoxedExpression,
  ComputeEngine,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
} from './global-types';
import { isValueDef, updateDef } from './boxed-expression/utils';

// ============================================================================
// Sequence Registry (SUB-7: Introspection support)
// ============================================================================

/**
 * Internal metadata for a sequence, used for introspection.
 */
interface SequenceMetadata {
  name: string;
  variable: string;
  base: Map<number, BoxedExpression>;
  memoize: boolean;
  memo: Map<number, BoxedExpression> | null;
  domain: { min?: number; max?: number };
}

/**
 * Registry of complete sequences for introspection.
 * Maps ComputeEngine → Map<name, SequenceMetadata>
 */
const sequenceRegistry = new WeakMap<ComputeEngine, Map<string, SequenceMetadata>>();

function getOrCreateRegistry(ce: ComputeEngine): Map<string, SequenceMetadata> {
  if (!sequenceRegistry.has(ce)) {
    sequenceRegistry.set(ce, new Map());
  }
  return sequenceRegistry.get(ce)!;
}

/**
 * Register a sequence in the registry for introspection.
 */
function registerSequence(
  ce: ComputeEngine,
  metadata: SequenceMetadata
): void {
  const registry = getOrCreateRegistry(ce);
  registry.set(metadata.name, metadata);
}

/**
 * Create a subscriptEvaluate handler from a sequence definition.
 *
 * The handler evaluates expressions like `F_{10}` by:
 * 1. Checking base cases first
 * 2. Looking up memoized values
 * 3. Recursively evaluating the recurrence relation
 */
export function createSequenceHandler(
  ce: ComputeEngine,
  name: string,
  def: SequenceDefinition
): (
  subscript: BoxedExpression,
  options: { engine: ComputeEngine; numericApproximation?: boolean }
) => BoxedExpression | undefined {
  const variable = def.variable ?? 'n';
  const memoize = def.memoize ?? true;
  const memo = memoize ? new Map<number, BoxedExpression>() : null;
  const domain = def.domain ?? {};

  // Store recurrence source for lazy parsing
  // We parse lazily because at handler creation time, the sequence symbol
  // may not yet have its subscriptEvaluate handler set up.
  const recurrenceSource = def.recurrence;
  let recurrence: BoxedExpression | null = null;

  // Box base cases
  const base = new Map<number, BoxedExpression>();
  for (const [k, v] of Object.entries(def.base)) {
    const index = Number(k);
    base.set(index, typeof v === 'number' ? ce.number(v) : v);
  }

  // Register sequence for introspection (SUB-7)
  registerSequence(ce, {
    name,
    variable,
    base,
    memoize,
    memo,
    domain,
  });

  return (subscript, { engine, numericApproximation }) => {
    // Lazy parse the recurrence on first use
    // This ensures the sequence symbol has its subscriptEvaluate set up
    if (recurrence === null) {
      recurrence =
        typeof recurrenceSource === 'string'
          ? engine.parse(recurrenceSource)
          : recurrenceSource;
    }
    const n = subscript.re;

    // Must be an integer
    if (!Number.isInteger(n)) return undefined;

    // Check domain constraints
    if (domain.min !== undefined && n < domain.min) return undefined;
    if (domain.max !== undefined && n > domain.max) return undefined;

    // Check base cases
    if (base.has(n)) return base.get(n)!;

    // Check memo
    if (memo?.has(n)) return memo.get(n)!;

    // Evaluate recurrence by substituting n
    const substituted = recurrence.subs({ [variable]: engine.number(n) });
    const result = numericApproximation
      ? substituted.N()
      : substituted.evaluate();

    // Memoize valid numeric results
    if (memo && result.isNumberLiteral) {
      memo.set(n, result);
    }

    return result.isNumberLiteral ? result : undefined;
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
 */
interface PendingSequence {
  base: Map<number, BoxedExpression>;
  recurrence?: { variable: string; latex: string };
}

const pendingSequences = new WeakMap<ComputeEngine, Map<string, PendingSequence>>();

function getOrCreatePending(ce: ComputeEngine, name: string): PendingSequence {
  if (!pendingSequences.has(ce)) {
    pendingSequences.set(ce, new Map());
  }
  const map = pendingSequences.get(ce)!;
  if (!map.has(name)) {
    map.set(name, { base: new Map() });
  }
  return map.get(name)!;
}

/**
 * Add a base case for a sequence definition.
 * e.g., from `L_0 := 1`
 */
export function addSequenceBaseCase(
  ce: ComputeEngine,
  name: string,
  index: number,
  value: BoxedExpression
): void {
  const pending = getOrCreatePending(ce, name);
  pending.base.set(index, value);
  tryFinalizeSequence(ce, name);
}

/**
 * Add a recurrence relation for a sequence definition.
 * e.g., from `L_n := L_{n-1} + 1`
 *
 * We store the recurrence as a LaTeX string rather than a BoxedExpression
 * because the expression may have been parsed before the symbol was declared
 * with subscriptEvaluate. Storing as LaTeX allows us to re-parse fresh when
 * creating the handler, ensuring proper binding.
 */
export function addSequenceRecurrence(
  ce: ComputeEngine,
  name: string,
  variable: string,
  expr: BoxedExpression
): void {
  const pending = getOrCreatePending(ce, name);
  // Convert to LaTeX for deferred parsing
  pending.recurrence = { variable, latex: expr.latex };
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
  const base: Record<number, BoxedExpression> = {};
  for (const [k, v] of pending.base) {
    base[k] = v;
  }

  const def: SequenceDefinition = {
    variable: pending.recurrence.variable,
    base,
    recurrence: pending.recurrence.latex, // Pass as string for fresh parsing
  };

  // Validate the definition
  const validation = validateSequenceDefinition(ce, name, def);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Create the subscriptEvaluate handler
  const handler = createSequenceHandler(ce, name, def);

  // Check if the symbol already exists in the current scope
  // (it may have been auto-declared when parsing the recurrence expression)
  const scope = (ce as any).context.lexicalScope;
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
  expr: BoxedExpression,
  seqName: string
): boolean {
  // Check if this is a Subscript with the sequence name as base
  if (expr.operator === 'Subscript' && expr.op1?.symbol === seqName) {
    return true;
  }

  // Recursively check operands
  if (expr.ops) {
    return expr.ops.some((op) => containsSelfReference(op, seqName));
  }

  return false;
}

/**
 * Extract the index variable from a subscript expression.
 * e.g., from `n-1` extract 'n', from `2*k` extract 'k'
 */
export function extractIndexVariable(
  subscript: BoxedExpression
): string | undefined {
  // Simple symbol
  if (subscript.symbol) return subscript.symbol;

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
 */
export function getSequenceStatus(
  ce: ComputeEngine,
  name: string
): SequenceStatus {
  // Check for pending sequence first
  const pendingMap = pendingSequences.get(ce);
  const pending = pendingMap?.get(name);

  if (pending) {
    return {
      status: 'pending',
      hasBase: pending.base.size > 0,
      hasRecurrence: !!pending.recurrence,
      baseIndices: Array.from(pending.base.keys()).sort((a, b) => a - b),
      variable: pending.recurrence?.variable,
    };
  }

  // Check if symbol has subscriptEvaluate (complete sequence)
  const def = ce.lookupDefinition(name);
  if (def && isValueDef(def) && def.value.subscriptEvaluate) {
    // It's a complete sequence - get details from registry
    const registry = sequenceRegistry.get(ce);
    const metadata = registry?.get(name);
    return {
      status: 'complete',
      hasBase: true,
      hasRecurrence: true,
      baseIndices: metadata
        ? Array.from(metadata.base.keys()).sort((a, b) => a - b)
        : [],
      variable: metadata?.variable,
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
 */
export function getSequenceInfo(
  ce: ComputeEngine,
  name: string
): SequenceInfo | undefined {
  const registry = sequenceRegistry.get(ce);
  const metadata = registry?.get(name);

  if (!metadata) return undefined;

  return {
    name: metadata.name,
    variable: metadata.variable,
    baseIndices: Array.from(metadata.base.keys()).sort((a, b) => a - b),
    memoize: metadata.memoize,
    domain: metadata.domain,
    cacheSize: metadata.memo?.size ?? 0,
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
 */
export function getSequenceCache(
  ce: ComputeEngine,
  name: string
): Map<number, BoxedExpression> | undefined {
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
): BoxedExpression[] | undefined {
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

  const terms: BoxedExpression[] = [];

  // Generate terms by evaluating subscripted expressions
  for (let n = start; step > 0 ? n <= end : n >= end; n += step) {
    const expr = ce.parse(`${name}_{${n}}`);
    const value = expr.evaluate();

    // Only include if we got a valid numeric result
    if (value.isNumberLiteral) {
      terms.push(value);
    } else {
      // If any term fails to evaluate, return undefined
      return undefined;
    }
  }

  return terms;
}
