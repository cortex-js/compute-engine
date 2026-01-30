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
 * Result of extracting a finite domain from an Element expression.
 * - `status: 'success'` - Domain was successfully extracted
 * - `status: 'non-enumerable'` - Domain exists but cannot be enumerated (e.g., infinite set, unknown symbol)
 * - `status: 'error'` - Invalid Element expression (missing variable, malformed domain)
 */
export type ExtractDomainResult =
  | { status: 'success'; variable: string; values: BoxedExpression[] }
  | {
      status: 'non-enumerable';
      variable: string;
      domain: BoxedExpression;
      reason: string;
    }
  | { status: 'error'; reason: string };

/**
 * EL-3: Filter domain values using a condition expression.
 * Evaluates the condition for each value and returns only those where the condition is true.
 */
function filterValuesWithCondition(
  values: BoxedExpression[],
  variable: string,
  conditionExpr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression[] {
  return values.filter((value) => {
    // Substitute the variable with the value in the condition
    const substituted = conditionExpr.subs({ [variable]: value });
    // Evaluate the condition
    const result = substituted.evaluate();
    // Keep the value if the condition evaluates to True
    return result.symbol === 'True';
  });
}

/**
 * Extract the finite domain from a quantifier's condition.
 * Supports:
 * - ["Element", "x", ["Set", 1, 2, 3]] → [1, 2, 3]
 * - ["Element", "x", ["Range", 1, 5]] → [1, 2, 3, 4, 5]
 * - ["Element", "x", ["Interval", 1, 5]] → [1, 2, 3, 4, 5] (integers only)
 * - ["Element", "x", ["Set", 1, 2, 3], condition] → filtered values (EL-3)
 * Returns detailed result indicating success, non-enumerable domain, or error.
 */
export function extractFiniteDomainWithReason(
  condition: BoxedExpression,
  ce: ComputeEngine
): ExtractDomainResult {
  // Check for ["Element", var, set] or ["Element", var, set, condition] pattern
  if (condition.operator !== 'Element') {
    return { status: 'error', reason: 'expected-element-expression' };
  }

  const variable = condition.op1?.symbol;
  if (!variable) {
    return { status: 'error', reason: 'expected-index-variable' };
  }

  const domain = condition.op2;
  if (!domain) {
    return { status: 'error', reason: 'expected-domain' };
  }

  // EL-3: Check for optional condition (3rd operand, index 2)
  // Element with condition has form: ["Element", variable, domain, condition]
  // Note: op3 returns Nothing when not present, so we also check nops >= 3
  const maybeCondition = condition.op3;
  const filterCondition =
    condition.nops >= 3 && maybeCondition && maybeCondition.symbol !== 'Nothing'
      ? maybeCondition
      : null;

  // Helper to return success result with optional condition filtering
  const successResult = (values: BoxedExpression[]): ExtractDomainResult => {
    if (filterCondition) {
      const filteredValues = filterValuesWithCondition(
        values,
        variable,
        filterCondition,
        ce
      );
      return { status: 'success', variable, values: filteredValues };
    }
    return { status: 'success', variable, values };
  };

  // Handle explicit sets: ["Set", 1, 2, 3]
  if (domain.operator === 'Set' || domain.operator === 'List') {
    const values = domain.ops;
    if (values && values.length <= 1000) {
      // EL-1: Special case for 2-element Lists with integer values
      // Treat [a, b] as Range(a, b) in Element context for Sum/Product
      // e.g., ["Element", "n", ["List", 1, 5]] iterates 1, 2, 3, 4, 5
      if (domain.operator === 'List' && values.length === 2) {
        const start = asSmallInteger(values[0]);
        const end = asSmallInteger(values[1]);
        if (start !== null && end !== null) {
          const count = end - start + 1;
          if (count > 0 && count <= 1000) {
            const rangeValues: BoxedExpression[] = [];
            for (let i = start; i <= end; i++) {
              rangeValues.push(ce.number(i));
            }
            return successResult(rangeValues);
          }
          if (count > 1000) {
            return {
              status: 'non-enumerable',
              variable,
              domain,
              reason: 'domain-too-large',
            };
          }
        }
      }
      return successResult([...values]);
    }
    if (values && values.length > 1000) {
      return {
        status: 'non-enumerable',
        variable,
        domain,
        reason: 'domain-too-large',
      };
    }
    return { status: 'error', reason: 'empty-domain' };
  }

  // Handle Range: ["Range", start, end] or ["Range", start, end, step]
  if (domain.operator === 'Range') {
    const start = asSmallInteger(domain.op1);
    const end = asSmallInteger(domain.op2);
    // op3 may be Nothing (a symbol) when not specified, so check ops length
    const step =
      domain.ops && domain.ops.length >= 3 ? asSmallInteger(domain.op3) : 1;

    if (start !== null && end !== null && step !== null && step !== 0) {
      const count = Math.floor((end - start) / step) + 1;
      if (count > 0 && count <= 1000) {
        const values: BoxedExpression[] = [];
        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
          values.push(ce.number(i));
        }
        return successResult(values);
      }
      if (count > 1000) {
        return {
          status: 'non-enumerable',
          variable,
          domain,
          reason: 'domain-too-large',
        };
      }
    }
    // Range with non-integer or symbolic bounds
    return {
      status: 'non-enumerable',
      variable,
      domain,
      reason: 'non-integer-bounds',
    };
  }

  // Handle finite integer Interval: ["Interval", start, end]
  // EL-6: Support Open/Closed boundary wrappers
  // e.g., ["Interval", ["Open", 0], 5] → iterates 1, 2, 3, 4, 5
  // e.g., ["Interval", 1, ["Open", 6]] → iterates 1, 2, 3, 4, 5
  if (domain.operator === 'Interval') {
    let op1 = domain.op1;
    let op2 = domain.op2;
    let openStart = false;
    let openEnd = false;

    // Unwrap Open/Closed boundary markers
    if (op1?.operator === 'Open') {
      openStart = true;
      op1 = op1.op1;
    } else if (op1?.operator === 'Closed') {
      op1 = op1.op1;
    }

    if (op2?.operator === 'Open') {
      openEnd = true;
      op2 = op2.op1;
    } else if (op2?.operator === 'Closed') {
      op2 = op2.op1;
    }

    let start = asSmallInteger(op1);
    let end = asSmallInteger(op2);

    if (start !== null && end !== null) {
      // Adjust bounds for open intervals (integers only)
      if (openStart) start += 1;
      if (openEnd) end -= 1;

      const count = end - start + 1;
      if (count > 0 && count <= 1000) {
        const values: BoxedExpression[] = [];
        for (let i = start; i <= end; i++) {
          values.push(ce.number(i));
        }
        return successResult(values);
      }
      if (count > 1000) {
        return {
          status: 'non-enumerable',
          variable,
          domain,
          reason: 'domain-too-large',
        };
      }
    }
    // Interval with non-integer or symbolic bounds
    return {
      status: 'non-enumerable',
      variable,
      domain,
      reason: 'non-integer-bounds',
    };
  }

  // Check for known infinite sets (e.g., NonNegativeIntegers, Integers, Reals, etc.)
  if (domain.symbol) {
    const knownInfiniteSets = [
      'Integers',
      'NonNegativeIntegers',
      'PositiveIntegers',
      'NegativeIntegers',
      'Rationals',
      'Reals',
      'PositiveReals',
      'NonNegativeReals',
      'NegativeReals',
      'NonPositiveReals',
      'ExtendedReals',
      'Complexes',
      'ImaginaryNumbers',
      'Numbers',
      'ExtendedComplexes',
      'AlgebraicNumbers',
      'TranscendentalNumbers',
    ];
    if (knownInfiniteSets.includes(domain.symbol)) {
      return {
        status: 'non-enumerable',
        variable,
        domain,
        reason: 'infinite-domain',
      };
    }
    // Check if the symbol has a value that's a finite set
    const domainValue = domain.value;
    if (domainValue && domainValue.operator === 'Set') {
      const values = domainValue.ops;
      if (values && values.length <= 1000) {
        return successResult([...values]);
      }
      if (values && values.length > 1000) {
        return {
          status: 'non-enumerable',
          variable,
          domain,
          reason: 'domain-too-large',
        };
      }
    }
    // Unknown symbol - could be a finite set, but we can't determine
    return {
      status: 'non-enumerable',
      variable,
      domain,
      reason: 'unknown-domain',
    };
  }

  // Unknown domain structure
  return {
    status: 'non-enumerable',
    variable,
    domain,
    reason: 'unrecognized-domain-type',
  };
}

/**
 * Extract the finite domain from a quantifier's condition.
 * Supports:
 * - ["Element", "x", ["Set", 1, 2, 3]] → [1, 2, 3]
 * - ["Element", "x", ["Range", 1, 5]] → [1, 2, 3, 4, 5]
 * - ["Element", "x", ["Interval", 1, 5]] → [1, 2, 3, 4, 5] (integers only)
 * Returns null if the domain is not finite or not recognized.
 * @deprecated Use extractFiniteDomainWithReason for better error handling
 */
export function extractFiniteDomain(
  condition: BoxedExpression,
  ce: ComputeEngine
): { variable: string; values: BoxedExpression[] } | null {
  const result = extractFiniteDomainWithReason(condition, ce);
  if (result.status === 'success') {
    return { variable: result.variable, values: result.values };
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

  return [
    { variable: domain.variable, values: domain.values },
    ...innerDomains,
  ];
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
