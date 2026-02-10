/**
 * Cost functions for the Fu trigonometric simplification algorithm.
 *
 * The primary objective is to minimize the number of trigonometric functions,
 * with secondary consideration for overall expression complexity.
 */

import type { BoxedExpression } from '../global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards';

const TRIG_FUNCS = new Set(['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc']);

/**
 * Count the number of trigonometric function occurrences in an expression.
 * This is the primary metric for the Fu algorithm.
 */
export function countTrigFunctions(expr: BoxedExpression): number {
  let count = 0;

  if (TRIG_FUNCS.has(expr.operator)) {
    count = 1;
  }

  if (isFunction(expr)) {
    for (const op of expr.ops) {
      count += countTrigFunctions(op);
    }
  }

  return count;
}

/**
 * Count the number of leaves (atoms) in an expression.
 * Includes symbols, numbers, and function names.
 */
export function countLeaves(expr: BoxedExpression): number {
  // Symbols and numbers are leaves
  if (isSymbol(expr)) return 1;
  if (isNumber(expr)) return 1;

  // For functions, count the operator name + operands
  let count = 1; // The function name itself
  if (isFunction(expr)) {
    for (const op of expr.ops) {
      count += countLeaves(op);
    }
  }

  return count;
}

/**
 * The default trig cost function for the Fu algorithm.
 *
 * Priority:
 * 1. Minimize number of trig functions (weighted heavily)
 * 2. Minimize leaf count (secondary)
 *
 * This ensures that expressions with fewer trig functions are always
 * preferred, even if they have slightly more total operations.
 */
export function trigCost(expr: BoxedExpression): number {
  const trigCount = countTrigFunctions(expr);
  const leaves = countLeaves(expr);

  // Weight trig count heavily so it dominates the decision
  return trigCount * 1000 + leaves;
}

export type TrigCostFunction = (expr: BoxedExpression) => number;

/**
 * Default cost function for the Fu algorithm
 */
export const DEFAULT_TRIG_COST: TrigCostFunction = trigCost;
