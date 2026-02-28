/**
 * Fu Algorithm for Trigonometric Simplification
 *
 * Implementation of the algorithm by Fu, Zhong, and Zeng:
 * "Automated and readable simplification of trigonometric expressions."
 * Mathematical and Computer Modelling 44.11 (2006): 1169-1177.
 *
 * The algorithm uses a greedy approach with transformation rules (TR),
 * combination transforms (CTR), and rule lists (RL) to simplify
 * trigonometric expressions.
 */

import type { Expression, RuleStep } from '../global-types';

import {
  hasTrigFunction,
  hasOperator,
  applyTR1,
  applyTR2,
  applyTR2i,
  applyTR3,
  applyTR5,
  applyTR6,
  applyTR7,
  applyTR7i,
  applyTR8,
  applyTR9,
  applyTR10,
  applyTR10i,
  applyTR11,
  applyTR11i,
  applyTR12,
  applyTR12i,
  applyTR13,
  applyTR22,
  applyTR22i,
  applyTRmorrie,
  applyTRpythagorean,
} from './fu-transforms';

import { TrigCostFunction, DEFAULT_TRIG_COST } from './fu-cost';

export interface FuOptions {
  /**
   * Cost function to evaluate expression complexity.
   * Default minimizes trig function count, then leaf count.
   */
  measure?: TrigCostFunction;

  /**
   * Maximum iterations to prevent infinite loops.
   * Default: 100
   */
  maxIterations?: number;
}

/**
 * Select the expression with the lowest cost from a list of candidates.
 */
function bestOf(exprs: Expression[], measure: TrigCostFunction): Expression {
  if (exprs.length === 0) throw new Error('bestOf called with empty array');
  if (exprs.length === 1) return exprs[0];

  let best = exprs[0];
  let bestCost = measure(best);

  for (let i = 1; i < exprs.length; i++) {
    const cost = measure(exprs[i]);
    if (cost < bestCost) {
      best = exprs[i];
      bestCost = cost;
    }
  }

  return best;
}

/**
 * Apply a transformation and return the result only if it's different.
 */
function tryTransform(
  expr: Expression,
  transform: (e: Expression) => Expression
): Expression | null {
  const result = transform(expr);
  // Only return if actually different
  if (result.isSame(expr)) return null;
  return result;
}

// ============================================================================
// Combination Transforms (CTR)
// These apply multiple TR rules and select the best result.
// ============================================================================

/**
 * CTR1: Choose between sin²/cos² Pythagorean substitutions
 * Tries: original, TR5 (sin² -> 1-cos²), TR6 (cos² -> 1-sin²)
 */
function CTR1(expr: Expression, measure: TrigCostFunction): Expression {
  const tr5Result = tryTransform(expr, applyTR5);
  const tr6Result = tryTransform(expr, applyTR6);

  const candidates = [expr];
  if (tr5Result) candidates.push(tr5Result);
  if (tr6Result) candidates.push(tr6Result);

  return bestOf(candidates, measure);
}

/**
 * CTR2: Same as CTR1, used after TR11 in RL2
 */
function CTR2(expr: Expression, measure: TrigCostFunction): Expression {
  return CTR1(expr, measure);
}

/**
 * CTR3: Try product-to-sum conversion and back
 * Tries: original, TR8 (product-to-sum), TR8 then TR10i (contract angles)
 */
function CTR3(expr: Expression, measure: TrigCostFunction): Expression {
  const tr8Result = tryTransform(expr, applyTR8);

  const candidates = [expr];
  if (tr8Result) {
    candidates.push(tr8Result);
    // Also try TR10i after TR8
    const tr8_tr10i = tryTransform(tr8Result, applyTR10i);
    if (tr8_tr10i) candidates.push(tr8_tr10i);
  }

  return bestOf(candidates, measure);
}

/**
 * CTR4: Try angle contraction
 * Tries: original, TR10i (angle contraction)
 */
function CTR4(expr: Expression, measure: TrigCostFunction): Expression {
  const tr10iResult = tryTransform(expr, applyTR10i);

  const candidates = [expr];
  if (tr10iResult) candidates.push(tr10iResult);

  return bestOf(candidates, measure);
}

// ============================================================================
// Rule Lists (RL)
// Organized sequences of transformations for specific expression types.
// ============================================================================

/**
 * RL1: For expressions containing tan/cot
 * Applies tan addition formula and tan*tan/cot*cot identities
 */
function RL1(expr: Expression, _measure: TrigCostFunction): Expression {
  // Apply TR12 (tan addition) then TR13 (tan products)
  let result = applyTR12(expr);
  result = applyTR13(result);
  return result;
}

/**
 * RL2: For expressions containing sin/cos
 * The main simplification sequence for sin/cos expressions.
 */
function RL2(expr: Expression, measure: TrigCostFunction): Expression {
  let result = expr;

  // Expand angles, then double angles, apply Pythagorean, power reduction, double angles again
  result = applyTR10(result);
  result = applyTR11(result);
  result = applyTR5(result);
  result = applyTR7(result);
  result = applyTR11(result);

  // CTR3: Try product-to-sum
  result = CTR3(result, measure);

  // CTR1: Pythagorean substitution choice
  result = CTR1(result, measure);

  // TR9: sum-to-product
  result = applyTR9(result);

  // CTR2: Pythagorean substitution choice again
  result = CTR2(result, measure);

  // TR9 again
  result = applyTR9(result);

  // CTR4: Angle contraction
  result = CTR4(result, measure);

  return result;
}

// ============================================================================
// Main Fu Algorithm
// ============================================================================

/**
 * Apply the Fu algorithm to simplify a trigonometric expression.
 *
 * The algorithm:
 * 1. Converts sec/csc to reciprocal forms (TR1) if present
 * 2. For tan/cot expressions, applies RL1
 * 3. If tan/cot remain, converts to sin/cos ratios (TR2)
 * 4. For sin/cos expressions, applies RL2
 * 5. Tries to convert back to tan/cot (TR2i)
 * 6. Selects the best result based on the cost function
 *
 * @param expr The expression to simplify
 * @param options Configuration options
 * @returns RuleStep with simplified expression, or undefined if no simplification
 */
export function fu(
  expr: Expression,
  options?: FuOptions
): RuleStep | undefined {
  // Skip if no trig functions
  if (!hasTrigFunction(expr)) return undefined;

  const measure = options?.measure ?? DEFAULT_TRIG_COST;
  const maxIterations = options?.maxIterations ?? 100;

  let result = expr;
  let iterations = 0;

  // Track the best result seen so far
  let bestResult = expr;
  let bestCost = measure(expr);

  const updateBest = (candidate: Expression) => {
    const cost = measure(candidate);
    if (cost < bestCost) {
      bestResult = candidate;
      bestCost = cost;
    }
  };

  // Phase 0: Canonicalize negative angles (TR3)
  // This should be done early to normalize expressions like cos(-x) -> cos(x)
  result = applyTR3(result);
  updateBest(result);

  // Phase 0a: Apply TR22i and TR22 early (before TR1 converts sec/csc to 1/cos, 1/sin)
  // TR22i handles sec²(x)-1 -> tan²(x), csc²(x)-1 -> cot²(x), etc.
  // TR22 handles cot²(x) -> csc²(x)-1, tan²(x) -> sec²(x)-1 (useful for cot²-csc² pattern)
  const tr22iEarly = applyTR22i(result);
  updateBest(tr22iEarly);

  // Also try TR22 which can help with expressions like cot²(x) - csc²(x)
  // by converting cot² to csc²-1, making the expression simplify to -1
  const tr22Early = applyTR22(result);
  updateBest(tr22Early);

  result = bestResult; // Use the better result

  // Phase 0b: Apply TR7i early (inverse power reduction)
  // This handles (1-cos(2x))/2 -> sin²(x), (1+cos(2x))/2 -> cos²(x)
  const tr7iEarly = applyTR7i(result);
  updateBest(tr7iEarly);
  result = bestResult;

  // Phase 1: Convert sec/csc to reciprocal forms
  // Always apply TR1 unconditionally because the sin/cos form enables
  // further simplifications (e.g., cos(x)*sec(x) -> cos(x)/cos(x) -> 1)
  // We force-update bestResult here to ensure the sin/cos form is used,
  // even if its immediate cost is higher, because standard simplification
  // after Fu will reduce patterns like x/x to 1.
  if (hasOperator(result, 'Sec', 'Csc')) {
    result = applyTR1(result);
    bestResult = result;
    bestCost = measure(result);
  }

  // Phase 2: Handle tan/cot with RL1
  if (hasOperator(result, 'Tan', 'Cot')) {
    const rl1Result = RL1(result, measure);
    updateBest(rl1Result);
    result = rl1Result;
  }

  // Phase 3: If tan/cot still present, convert to sin/cos ratios
  if (hasOperator(result, 'Tan', 'Cot')) {
    result = applyTR2(result);
    updateBest(result);
  }

  // Phase 3b: Try TR9 sum-to-product BEFORE RL2
  // This catches patterns like sin(x+h)+sin(x-h) before TR10 expands them
  if (hasOperator(result, 'Sin', 'Cos')) {
    const tr9Early = applyTR9(result);
    updateBest(tr9Early);
    result = bestResult;
  }

  // Phase 4: Handle sin/cos with RL2
  if (hasOperator(result, 'Sin', 'Cos')) {
    // Iteratively apply RL2 until no improvement
    let prevCost = measure(result);
    while (iterations < maxIterations) {
      iterations++;
      const rl2Result = RL2(result, measure);
      const newCost = measure(rl2Result);

      updateBest(rl2Result);

      // Stop if no improvement
      if (newCost >= prevCost) break;

      result = rl2Result;
      prevCost = newCost;
    }
  }

  // Phase 5: Try converting sin/cos ratios back to tan/cot
  const tr2iResult = applyTR2i(bestResult);
  updateBest(tr2iResult);

  // Phase 6: Try double angle contraction
  const tr11iResult = applyTR11i(bestResult);
  updateBest(tr11iResult);

  // Phase 7: Try Morrie's law for cos product chains
  const morrieResult = applyTRmorrie(bestResult);
  updateBest(morrieResult);

  // Phase 7a: Try inverse power reduction TR7i
  // (1-cos(2x))/2 -> sin²(x), (1+cos(2x))/2 -> cos²(x)
  const tr7iResult = applyTR7i(bestResult);
  updateBest(tr7iResult);

  // Phase 7b: Try inverse Pythagorean TR22i
  // sec²(x)-1 -> tan²(x), csc²(x)-1 -> cot²(x), etc.
  const tr22iResult = applyTR22i(bestResult);
  updateBest(tr22iResult);

  // Phase 7c: Try angle contraction TR10i
  // sin(x)cos(y) + cos(x)sin(y) -> sin(x+y)
  const tr10iResult = applyTR10i(bestResult);
  updateBest(tr10iResult);

  // Phase 7d: Try Pythagorean identity in compound expressions
  // sin²(x) + cos²(x) + other terms -> 1 + other terms
  // c - c·sin²(x) -> c·cos²(x)
  const pythagoreanResult = applyTRpythagorean(bestResult);
  updateBest(pythagoreanResult);

  // Phase 7e: Try tangent sum identity TR12i
  // tan(A) + tan(B) - tan(C)·tan(A)·tan(B) -> -tan(C) when A+B+C = π
  const tr12iResult = applyTR12i(bestResult);
  updateBest(tr12iResult);

  // Phase 8: Post-Fu arithmetic simplification
  // After trig transformations, apply basic arithmetic to handle cases like
  // sin(2x) - sin(2x) -> 0 or combine like terms
  // We use canonical form evaluation which handles basic arithmetic
  if (bestResult.operator === 'Add' || bestResult.operator === 'Multiply') {
    // Re-canonicalize to combine like terms
    const simplified = expr.engine.expr(bestResult.json);
    updateBest(simplified);
  }

  // Return result only if it's different from input
  if (bestResult.isSame(expr)) return undefined;

  return { value: bestResult, because: 'fu' };
}

/**
 * Simplified entry point that returns the expression directly.
 */
export function fuSimplify(expr: Expression, options?: FuOptions): Expression {
  const result = fu(expr, options);
  return result?.value ?? expr;
}

// Re-export types and utilities
export { hasTrigFunction, hasOperator } from './fu-transforms';
export { trigCost, countTrigFunctions, countLeaves } from './fu-cost';
export type { TrigCostFunction } from './fu-cost';
