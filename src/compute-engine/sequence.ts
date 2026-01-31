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
} from './global-types';
import { updateDef } from './boxed-expression/utils';

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
  _name: string,
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
