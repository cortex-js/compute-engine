import type { BoxedExpression, ComputeEngine } from '../global-types';
import { asSmallInteger } from '../boxed-expression/numerics';
import {
  extractVariables,
  evaluateWithAssignment,
  generateAssignments,
} from './logic-utils';

/**
 * Quantifier domain helpers and boolean analysis functions.
 * Extracted from logic.ts for better code organization.
 */

/**
 * Extract the finite domain from a quantifier's condition.
 * Supports:
 * - ["Element", "x", ["Set", 1, 2, 3]] → [1, 2, 3]
 * - ["Element", "x", ["Range", 1, 5]] → [1, 2, 3, 4, 5]
 * - ["Element", "x", ["Interval", 1, 5]] → [1, 2, 3, 4, 5] (integers only)
 * Returns null if the domain is not finite or not recognized.
 */
export function extractFiniteDomain(
  condition: BoxedExpression,
  ce: ComputeEngine
): { variable: string; values: BoxedExpression[] } | null {
  // Check for ["Element", var, set] pattern
  if (condition.operator !== 'Element') return null;

  const variable = condition.op1?.symbol;
  if (!variable) return null;

  const domain = condition.op2;
  if (!domain) return null;

  // Handle explicit sets: ["Set", 1, 2, 3]
  if (domain.operator === 'Set' || domain.operator === 'List') {
    const values = domain.ops;
    if (values && values.length <= 1000) {
      return { variable, values: [...values] };
    }
    return null;
  }

  // Handle Range: ["Range", start, end] or ["Range", start, end, step]
  if (domain.operator === 'Range') {
    const start = asSmallInteger(domain.op1);
    const end = asSmallInteger(domain.op2);
    // op3 may be Nothing (a symbol) when not specified, so check ops length
    const step =
      domain.ops && domain.ops.length >= 3
        ? asSmallInteger(domain.op3)
        : 1;

    if (start !== null && end !== null && step !== null && step !== 0) {
      const count = Math.floor((end - start) / step) + 1;
      if (count > 0 && count <= 1000) {
        const values: BoxedExpression[] = [];
        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
          values.push(ce.number(i));
        }
        return { variable, values };
      }
    }
    return null;
  }

  // Handle finite integer Interval: ["Interval", start, end]
  if (domain.operator === 'Interval') {
    const start = asSmallInteger(domain.op1);
    const end = asSmallInteger(domain.op2);

    if (start !== null && end !== null) {
      const count = end - start + 1;
      if (count > 0 && count <= 1000) {
        const values: BoxedExpression[] = [];
        for (let i = start; i <= end; i++) {
          values.push(ce.number(i));
        }
        return { variable, values };
      }
    }
    return null;
  }

  return null;
}

/**
 * Check if an expression contains a reference to a specific variable.
 */
export function bodyContainsVariable(
  expr: BoxedExpression,
  variable: string
): boolean {
  if (expr.symbol === variable) return true;
  if (expr.ops) {
    for (const op of expr.ops) {
      if (bodyContainsVariable(op, variable)) return true;
    }
  }
  return false;
}

/**
 * For nested quantifiers like ∀x∈S. ∀y∈T. P(x,y), collect the inner domains.
 * Returns an array of {variable, values} for nested ForAll/Exists with finite domains.
 */
export function collectNestedDomains(
  body: BoxedExpression,
  ce: ComputeEngine
): { variable: string; values: BoxedExpression[] }[] {
  const canonicalBody = body.canonical;
  const op = canonicalBody.operator;

  // Only collect from same quantifier type (ForAll or Exists)
  if (op !== 'ForAll' && op !== 'Exists') return [];

  const condition = canonicalBody.op1;
  const innerBody = canonicalBody.op2;

  if (!condition || !innerBody) return [];

  const domain = extractFiniteDomain(condition, ce);
  if (!domain) return [];

  // Recursively collect from inner body
  const innerDomains = collectNestedDomains(innerBody, ce);

  return [{ variable: domain.variable, values: domain.values }, ...innerDomains];
}

/**
 * Get the innermost body of nested quantifiers.
 */
export function getInnermostBody(body: BoxedExpression): BoxedExpression {
  const canonicalBody = body.canonical;
  const op = canonicalBody.operator;

  if (op === 'ForAll' || op === 'Exists') {
    const innerBody = canonicalBody.op2;
    if (innerBody) return getInnermostBody(innerBody);
  }

  return canonicalBody;
}

/**
 * Evaluate ForAll over a Cartesian product of domains.
 * Returns True if the predicate holds for all combinations.
 */
export function evaluateForAllCartesian(
  domains: { variable: string; values: BoxedExpression[] }[],
  body: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | undefined {
  // Generate Cartesian product indices
  const indices = domains.map(() => 0);
  const lengths = domains.map((d) => d.values.length);

  // Check for empty domains
  if (lengths.some((l) => l === 0)) return ce.True;

  while (true) {
    // Build substitution map for current combination
    const subs: Record<string, BoxedExpression> = {};
    for (let i = 0; i < domains.length; i++) {
      subs[domains[i].variable] = domains[i].values[indices[i]];
    }

    // Evaluate body with this combination
    const substituted = body.subs(subs).canonical;
    const result = substituted.evaluate();

    if (result.symbol === 'False') {
      return ce.False; // Found a counterexample
    }
    if (result.symbol !== 'True') {
      return undefined; // Can't determine
    }

    // Move to next combination
    let dim = domains.length - 1;
    while (dim >= 0) {
      indices[dim]++;
      if (indices[dim] < lengths[dim]) break;
      indices[dim] = 0;
      dim--;
    }
    if (dim < 0) break; // Exhausted all combinations
  }

  return ce.True;
}

/**
 * Evaluate Exists over a Cartesian product of domains.
 * Returns True if the predicate holds for at least one combination.
 */
export function evaluateExistsCartesian(
  domains: { variable: string; values: BoxedExpression[] }[],
  body: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | undefined {
  // Generate Cartesian product indices
  const indices = domains.map(() => 0);
  const lengths = domains.map((d) => d.values.length);

  // Check for empty domains
  if (lengths.some((l) => l === 0)) return ce.False;

  while (true) {
    // Build substitution map for current combination
    const subs: Record<string, BoxedExpression> = {};
    for (let i = 0; i < domains.length; i++) {
      subs[domains[i].variable] = domains[i].values[indices[i]];
    }

    // Evaluate body with this combination
    const substituted = body.subs(subs).canonical;
    const result = substituted.evaluate();

    if (result.symbol === 'True') {
      return ce.True; // Found a witness
    }

    // Move to next combination
    let dim = domains.length - 1;
    while (dim >= 0) {
      indices[dim]++;
      if (indices[dim] < lengths[dim]) break;
      indices[dim] = 0;
      dim--;
    }
    if (dim < 0) break; // Exhausted all combinations
  }

  return ce.False;
}

/**
 * Check if a boolean expression is satisfiable.
 * Returns True if there exists an assignment that makes the expression true.
 */
export function isSatisfiable(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Handle constant expressions
  if (variables.length === 0) {
    const result = expr.evaluate();
    return result.symbol === 'True' ? ce.True : ce.False;
  }

  // Limit the number of variables to prevent explosion (2^n combinations)
  if (variables.length > 20) {
    // Too many variables, return undefined
    return ce._fn('IsSatisfiable', [expr]);
  }

  // Try all possible assignments
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (result.symbol === 'True') {
      return ce.True;
    }
  }

  return ce.False;
}

/**
 * Check if a boolean expression is a tautology.
 * Returns True if the expression is true for all possible assignments.
 */
export function isTautology(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Handle constant expressions
  if (variables.length === 0) {
    const result = expr.evaluate();
    return result.symbol === 'True' ? ce.True : ce.False;
  }

  // Limit the number of variables to prevent explosion
  if (variables.length > 20) {
    // Too many variables, return undefined
    return ce._fn('IsTautology', [expr]);
  }

  // Check all possible assignments
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (result.symbol !== 'True') {
      return ce.False;
    }
  }

  return ce.True;
}

/**
 * Generate a truth table for a boolean expression.
 * Returns a List of Lists with headers and rows.
 */
export function generateTruthTable(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Limit the number of variables to prevent explosion
  if (variables.length > 10) {
    // Too many rows to generate
    return ce._fn('TruthTable', [expr]);
  }

  const rows: BoxedExpression[] = [];

  // Header row: variable names + "Result"
  const header = ce._fn('List', [
    ...variables.map((v) => ce.string(v)),
    ce.string('Result'),
  ]);
  rows.push(header);

  // Generate all rows
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    const row = ce._fn('List', [
      ...variables.map((v) => (assignment[v] ? ce.True : ce.False)),
      result,
    ]);
    rows.push(row);
  }

  return ce._fn('List', rows);
}
