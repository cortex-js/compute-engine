import type {
  BoxedExpression,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { asSmallInteger } from '../boxed-expression/numerics';
import {
  extractVariables,
  evaluateWithAssignment,
  generateAssignments,
} from '../symbolic/logic-utils';
import {
  isBoxedSymbol,
  isBoxedFunction,
  sym,
} from '../boxed-expression/type-guards';

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
  _ce: ComputeEngine
): BoxedExpression[] {
  return values.filter((value) => {
    // Substitute the variable with the value in the condition
    const substituted = conditionExpr.subs({ [variable]: value });
    // Evaluate the condition
    const result = substituted.evaluate();
    // Keep the value if the condition evaluates to True
    return sym(result) === 'True';
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

  if (!isBoxedFunction(condition)) {
    return { status: 'error', reason: 'expected-element-expression' };
  }

  const variable = isBoxedSymbol(condition.op1)
    ? condition.op1.symbol
    : undefined;
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
    condition.nops >= 3 && maybeCondition && sym(maybeCondition) !== 'Nothing'
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
    const values = isBoxedFunction(domain) ? domain.ops : undefined;
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
  if (domain.operator === 'Range' && isBoxedFunction(domain)) {
    const start = asSmallInteger(domain.op1);
    const end = asSmallInteger(domain.op2);
    // op3 may be Nothing (a symbol) when not specified, so check ops length
    const step = domain.ops.length >= 3 ? asSmallInteger(domain.op3) : 1;

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
  if (domain.operator === 'Interval' && isBoxedFunction(domain)) {
    let op1: BoxedExpression | undefined = domain.op1;
    let op2: BoxedExpression | undefined = domain.op2;
    let openStart = false;
    let openEnd = false;

    // Unwrap Open/Closed boundary markers
    if (op1?.operator === 'Open' && isBoxedFunction(op1)) {
      openStart = true;
      op1 = op1.op1;
    } else if (op1?.operator === 'Closed' && isBoxedFunction(op1)) {
      op1 = op1.op1;
    }

    if (op2?.operator === 'Open' && isBoxedFunction(op2)) {
      openEnd = true;
      op2 = op2.op1;
    } else if (op2?.operator === 'Closed' && isBoxedFunction(op2)) {
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
  const domainSymbol = sym(domain);
  if (domainSymbol) {
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
    if (knownInfiniteSets.includes(domainSymbol)) {
      return {
        status: 'non-enumerable',
        variable,
        domain,
        reason: 'infinite-domain',
      };
    }
    // Check if the symbol has a value that's a finite set
    const domainValue = domain.value;
    if (
      domainValue &&
      domainValue.operator === 'Set' &&
      isBoxedFunction(domainValue)
    ) {
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
 * Check if an expression contains a reference to a specific variable.
 */
export function bodyContainsVariable(
  expr: BoxedExpression,
  variable: string
): boolean {
  if (sym(expr) === variable) return true;
  if (isBoxedFunction(expr)) {
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
  if (!isBoxedFunction(canonicalBody)) return [];

  const condition = canonicalBody.op1;
  const innerBody = canonicalBody.op2;

  if (!condition || !innerBody) return [];

  const domainResult = extractFiniteDomainWithReason(condition, ce);
  if (domainResult.status !== 'success') return [];

  // Recursively collect from inner body
  const innerDomains = collectNestedDomains(innerBody, ce);

  return [
    { variable: domainResult.variable, values: domainResult.values },
    ...innerDomains,
  ];
}

/**
 * Get the innermost body of nested quantifiers.
 */
export function getInnermostBody(body: BoxedExpression): BoxedExpression {
  const canonicalBody = body.canonical;
  const op = canonicalBody.operator;

  if ((op === 'ForAll' || op === 'Exists') && isBoxedFunction(canonicalBody)) {
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

    if (sym(result) === 'False') {
      return ce.False; // Found a counterexample
    }
    if (sym(result) !== 'True') {
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

    if (sym(result) === 'True') {
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
 *
 * Returns `True` if there exists an assignment of truth values to variables
 * that makes the expression true, `False` if no such assignment exists.
 *
 * ## Algorithm
 *
 * Uses brute-force enumeration of all possible truth assignments.
 * This has **O(2^n) time complexity** where n is the number of variables.
 *
 * ## Performance Characteristics
 *
 * | Variables | Assignments | Approximate Time |
 * |-----------|-------------|------------------|
 * | 10        | 1,024       | < 1ms            |
 * | 15        | 32,768      | ~10ms            |
 * | 20        | 1,048,576   | ~100ms-1s        |
 * | > 20      | (rejected)  | N/A              |
 *
 * ## Limits
 *
 * - **Maximum 20 variables**: Expressions with more than 20 distinct boolean
 *   variables will return the unevaluated `IsSatisfiable` expression rather
 *   than attempting evaluation (to prevent blocking the thread).
 *
 * ## Future Improvements
 *
 * For better performance on larger expressions, a DPLL-based SAT solver
 * could be implemented. The current brute-force approach is suitable for
 * small expressions typically encountered in educational and verification
 * contexts.
 *
 * @param expr - A boolean expression to check for satisfiability
 * @param ce - The ComputeEngine instance
 * @returns `True` if satisfiable, `False` if unsatisfiable, or the
 *          unevaluated expression if the variable limit is exceeded
 */
export function isSatisfiable(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Handle constant expressions
  if (variables.length === 0) {
    const result = expr.evaluate();
    return sym(result) === 'True' ? ce.True : ce.False;
  }

  // Limit the number of variables to prevent explosion (2^n combinations)
  if (variables.length > 20) {
    // Too many variables, return undefined
    return ce._fn('IsSatisfiable', [expr]);
  }

  // Try all possible assignments
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (sym(result) === 'True') {
      return ce.True;
    }
  }

  return ce.False;
}

/**
 * Check if a boolean expression is a tautology.
 *
 * Returns `True` if the expression evaluates to true for all possible
 * assignments of truth values to variables, `False` otherwise.
 *
 * ## Algorithm
 *
 * Uses brute-force enumeration of all possible truth assignments.
 * This has **O(2^n) time complexity** where n is the number of variables.
 *
 * ## Performance Characteristics
 *
 * | Variables | Assignments | Approximate Time |
 * |-----------|-------------|------------------|
 * | 10        | 1,024       | < 1ms            |
 * | 15        | 32,768      | ~10ms            |
 * | 20        | 1,048,576   | ~100ms-1s        |
 * | > 20      | (rejected)  | N/A              |
 *
 * ## Limits
 *
 * - **Maximum 20 variables**: Expressions with more than 20 distinct boolean
 *   variables will return the unevaluated `IsTautology` expression rather
 *   than attempting evaluation (to prevent blocking the thread).
 *
 * ## Future Improvements
 *
 * For better performance on larger expressions, a DPLL-based approach
 * (checking unsatisfiability of the negation) could be implemented.
 *
 * @param expr - A boolean expression to check
 * @param ce - The ComputeEngine instance
 * @returns `True` if a tautology, `False` if not, or the unevaluated
 *          expression if the variable limit is exceeded
 */
export function isTautology(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression {
  const variables = extractVariables(expr);

  // Handle constant expressions
  if (variables.length === 0) {
    const result = expr.evaluate();
    return sym(result) === 'True' ? ce.True : ce.False;
  }

  // Limit the number of variables to prevent explosion
  if (variables.length > 20) {
    // Too many variables, return undefined
    return ce._fn('IsTautology', [expr]);
  }

  // Check all possible assignments
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (sym(result) !== 'True') {
      return ce.False;
    }
  }

  return ce.True;
}

/**
 * Generate a truth table for a boolean expression.
 *
 * Returns a `List` of `List`s where the first row contains column headers
 * (variable names followed by "Result") and subsequent rows contain the
 * truth values for each assignment.
 *
 * ## Algorithm
 *
 * Generates all 2^n possible truth assignments and evaluates the expression
 * for each. This has **O(2^n) time and space complexity**.
 *
 * ## Performance Characteristics
 *
 * | Variables | Rows Generated | Output Size |
 * |-----------|----------------|-------------|
 * | 5         | 32             | ~1 KB       |
 * | 8         | 256            | ~8 KB       |
 * | 10        | 1,024          | ~32 KB      |
 * | > 10      | (rejected)     | N/A         |
 *
 * ## Limits
 *
 * - **Maximum 10 variables**: Expressions with more than 10 distinct boolean
 *   variables will return the unevaluated `TruthTable` expression. This
 *   stricter limit (compared to `IsSatisfiable`/`IsTautology`) accounts for
 *   the memory required to store all rows.
 *
 * @param expr - A boolean expression to generate a truth table for
 * @param ce - The ComputeEngine instance
 * @returns A `List` of `List`s representing the truth table, or the
 *          unevaluated expression if the variable limit is exceeded
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

//
// =============================================================================
// Quine-McCluskey Algorithm for Prime Implicants/Implicates
// =============================================================================
//

/**
 * Represents a term in the Quine-McCluskey algorithm.
 * Each position is 0 (false), 1 (true), or -1 (don't care).
 */
type QMTerm = number[];

/**
 * Convert an integer minterm to a QM term representation.
 */
function mintermToQMTerm(minterm: number, numVars: number): QMTerm {
  const term: QMTerm = [];
  for (let i = numVars - 1; i >= 0; i--) {
    term.push((minterm >> i) & 1);
  }
  return term;
}

/**
 * Count the number of 1s in a QM term (ignoring don't cares).
 */
function countOnes(term: QMTerm): number {
  return term.filter((x) => x === 1).length;
}

/**
 * Check if two terms can be combined (differ in exactly one position,
 * ignoring don't cares which must match).
 * Returns the differing position index, or -1 if cannot combine.
 */
function canCombine(term1: QMTerm, term2: QMTerm): number {
  let diffPos = -1;
  for (let i = 0; i < term1.length; i++) {
    // Don't cares must match
    if (term1[i] === -1 || term2[i] === -1) {
      if (term1[i] !== term2[i]) return -1;
    } else if (term1[i] !== term2[i]) {
      if (diffPos !== -1) return -1; // More than one difference
      diffPos = i;
    }
  }
  return diffPos;
}

/**
 * Combine two terms at the given position, replacing the difference with don't care.
 */
function combineTerms(term1: QMTerm, diffPos: number): QMTerm {
  const result = [...term1];
  result[diffPos] = -1;
  return result;
}

/**
 * Convert a QM term to a string for comparison/deduplication.
 */
function termToString(term: QMTerm): string {
  return term.map((x) => (x === -1 ? '-' : x.toString())).join('');
}

/**
 * Find all prime implicants using the Quine-McCluskey algorithm.
 *
 * ## Algorithm
 *
 * 1. Generate minterms from the truth table (assignments where expression is true)
 * 2. Group minterms by number of 1s
 * 3. Combine terms differing in exactly one position, marking combined terms
 * 4. Repeat until no more combinations possible
 * 5. Return terms that were never combined (prime implicants)
 *
 * ## Performance Characteristics
 *
 * | Variables | Max Minterms | Approximate Time |
 * |-----------|--------------|------------------|
 * | 5         | 32           | < 1ms            |
 * | 8         | 256          | ~10ms            |
 * | 10        | 1,024        | ~100ms           |
 * | > 12      | (rejected)   | N/A              |
 *
 * ## Limits
 *
 * - **Maximum 12 variables**: Larger expressions return unevaluated.
 *
 * @param expr - A boolean expression
 * @param ce - The ComputeEngine instance
 * @returns A Set of expressions representing prime implicants
 */
export function findPrimeImplicants(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression[] | null {
  const variables = extractVariables(expr);

  // Limit variables to prevent explosion
  if (variables.length > 12) {
    return null;
  }

  if (variables.length === 0) {
    // Constant expression
    const result = expr.evaluate();
    if (sym(result) === 'True') return [ce.True];
    if (sym(result) === 'False') return [];
    return null;
  }

  // Collect minterms (assignments where expression is true)
  const minterms: number[] = [];
  let index = 0;
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (sym(result) === 'True') {
      minterms.push(index);
    }
    index++;
  }

  // Handle edge cases
  if (minterms.length === 0) {
    return []; // Contradiction - no prime implicants
  }
  if (minterms.length === 1 << variables.length) {
    return [ce.True]; // Tautology - True is the only prime implicant
  }

  // Run Quine-McCluskey
  const primeImplicants = quineMcCluskey(minterms, variables.length);

  // Convert QM terms back to expressions
  return primeImplicants.map((term) => qmTermToExpression(term, variables, ce));
}

/**
 * Find all prime implicates using the Quine-McCluskey algorithm.
 *
 * Prime implicates are the dual of prime implicants - they are the minimal
 * clauses in CNF. We find them by finding prime implicants of the negation
 * and then negating the result.
 *
 * @param expr - A boolean expression
 * @param ce - The ComputeEngine instance
 * @returns A Set of expressions representing prime implicates (clauses)
 */
export function findPrimeImplicates(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression[] | null {
  const variables = extractVariables(expr);

  // Limit variables to prevent explosion
  if (variables.length > 12) {
    return null;
  }

  if (variables.length === 0) {
    // Constant expression
    const result = expr.evaluate();
    if (sym(result) === 'True') return [];
    if (sym(result) === 'False') return [ce.False];
    return null;
  }

  // Collect maxterms (assignments where expression is false)
  const maxterms: number[] = [];
  let index = 0;
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (sym(result) === 'False') {
      maxterms.push(index);
    }
    index++;
  }

  // Handle edge cases
  if (maxterms.length === 0) {
    return []; // Tautology - no prime implicates
  }
  if (maxterms.length === 1 << variables.length) {
    return [ce.False]; // Contradiction
  }

  // Run Quine-McCluskey on maxterms
  const primeImplicateTerms = quineMcCluskey(maxterms, variables.length);

  // Convert QM terms to clauses (Or expressions)
  // For maxterms, a 0 means the variable should be true in the clause (positive literal)
  // and a 1 means the variable should be negated in the clause
  return primeImplicateTerms.map((term) => qmTermToClause(term, variables, ce));
}

/**
 * Core Quine-McCluskey algorithm.
 * Takes a list of minterms (as integers) and returns prime implicants as QM terms.
 */
function quineMcCluskey(minterms: number[], numVars: number): QMTerm[] {
  // Convert minterms to QM terms
  let currentTerms: Map<string, { term: QMTerm; combined: boolean }> =
    new Map();

  for (const minterm of minterms) {
    const term = mintermToQMTerm(minterm, numVars);
    currentTerms.set(termToString(term), { term, combined: false });
  }

  const primeImplicants: QMTerm[] = [];

  // Iterate until no more combinations
  while (currentTerms.size > 0) {
    const nextTerms: Map<string, { term: QMTerm; combined: boolean }> =
      new Map();

    // Group terms by number of 1s
    const groups: Map<number, Array<{ key: string; term: QMTerm }>> = new Map();
    for (const [key, { term }] of currentTerms) {
      const ones = countOnes(term);
      if (!groups.has(ones)) {
        groups.set(ones, []);
      }
      groups.get(ones)!.push({ key, term });
    }

    // Try to combine adjacent groups (differ by one 1)
    const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => a - b);

    for (let i = 0; i < sortedGroupKeys.length - 1; i++) {
      const group1 = groups.get(sortedGroupKeys[i])!;
      const group2 = groups.get(sortedGroupKeys[i + 1])!;

      for (const { key: key1, term: term1 } of group1) {
        for (const { key: key2, term: term2 } of group2) {
          const diffPos = canCombine(term1, term2);
          if (diffPos !== -1) {
            // Mark both as combined
            const entry1 = currentTerms.get(key1)!;
            const entry2 = currentTerms.get(key2)!;
            entry1.combined = true;
            entry2.combined = true;

            // Create combined term
            const newTerm = combineTerms(term1, diffPos);
            const newKey = termToString(newTerm);
            if (!nextTerms.has(newKey)) {
              nextTerms.set(newKey, { term: newTerm, combined: false });
            }
          }
        }
      }
    }

    // Collect uncombined terms as prime implicants
    for (const { term, combined } of currentTerms.values()) {
      if (!combined) {
        primeImplicants.push(term);
      }
    }

    currentTerms = nextTerms;
  }

  return primeImplicants;
}

/**
 * Convert a QM term (for minterms) to a BoxedExpression.
 * Each term becomes an And of literals.
 */
function qmTermToExpression(
  term: QMTerm,
  variables: string[],
  ce: ComputeEngine
): BoxedExpression {
  const literals: BoxedExpression[] = [];

  for (let i = 0; i < term.length; i++) {
    if (term[i] === 1) {
      // Variable is true
      literals.push(ce.symbol(variables[i]));
    } else if (term[i] === 0) {
      // Variable is false (negated)
      literals.push(ce._fn('Not', [ce.symbol(variables[i])]));
    }
    // Don't care (-1) is omitted
  }

  if (literals.length === 0) return ce.True;
  if (literals.length === 1) return literals[0];
  return ce._fn('And', literals);
}

/**
 * Convert a QM term (for maxterms) to a clause (Or of literals).
 * For maxterms: 0 means positive literal, 1 means negative literal.
 */
function qmTermToClause(
  term: QMTerm,
  variables: string[],
  ce: ComputeEngine
): BoxedExpression {
  const literals: BoxedExpression[] = [];

  for (let i = 0; i < term.length; i++) {
    if (term[i] === 0) {
      // Variable should be true in clause (positive literal)
      literals.push(ce.symbol(variables[i]));
    } else if (term[i] === 1) {
      // Variable should be negated in clause
      literals.push(ce._fn('Not', [ce.symbol(variables[i])]));
    }
    // Don't care (-1) is omitted
  }

  if (literals.length === 0) return ce.False;
  if (literals.length === 1) return literals[0];
  return ce._fn('Or', literals);
}

/**
 * Find a minimal DNF (sum of products) using prime implicants.
 *
 * This uses the Quine-McCluskey algorithm followed by a greedy covering
 * algorithm to select a minimal set of prime implicants.
 *
 * @param expr - A boolean expression
 * @param ce - The ComputeEngine instance
 * @returns The minimal DNF, or null if too many variables
 */
export function minimalDNF(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | null {
  const variables = extractVariables(expr);

  if (variables.length > 12) {
    return null;
  }

  if (variables.length === 0) {
    const result = expr.evaluate();
    return sym(result) === 'True' ? ce.True : ce.False;
  }

  // Collect minterms
  const minterms: number[] = [];
  let index = 0;
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (sym(result) === 'True') {
      minterms.push(index);
    }
    index++;
  }

  if (minterms.length === 0) return ce.False;
  if (minterms.length === 1 << variables.length) return ce.True;

  // Get prime implicants
  const primeImplicants = quineMcCluskey(minterms, variables.length);

  // Find minimal cover using greedy algorithm
  const cover = findMinimalCover(primeImplicants, minterms, variables.length);

  // Convert to expression
  if (cover.length === 0) return ce.False;
  if (cover.length === 1) return qmTermToExpression(cover[0], variables, ce);

  return ce._fn(
    'Or',
    cover.map((term) => qmTermToExpression(term, variables, ce))
  );
}

/**
 * Find a minimal CNF (product of sums) using prime implicates.
 *
 * @param expr - A boolean expression
 * @param ce - The ComputeEngine instance
 * @returns The minimal CNF, or null if too many variables
 */
export function minimalCNF(
  expr: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | null {
  const variables = extractVariables(expr);

  if (variables.length > 12) {
    return null;
  }

  if (variables.length === 0) {
    const result = expr.evaluate();
    return sym(result) === 'True' ? ce.True : ce.False;
  }

  // Collect maxterms
  const maxterms: number[] = [];
  let index = 0;
  for (const assignment of generateAssignments(variables)) {
    const result = evaluateWithAssignment(expr, assignment, ce);
    if (sym(result) === 'False') {
      maxterms.push(index);
    }
    index++;
  }

  if (maxterms.length === 0) return ce.True;
  if (maxterms.length === 1 << variables.length) return ce.False;

  // Get prime implicates
  const primeImplicates = quineMcCluskey(maxterms, variables.length);

  // Find minimal cover
  const cover = findMinimalCover(primeImplicates, maxterms, variables.length);

  // Convert to expression
  if (cover.length === 0) return ce.True;
  if (cover.length === 1) return qmTermToClause(cover[0], variables, ce);

  return ce._fn(
    'And',
    cover.map((term) => qmTermToClause(term, variables, ce))
  );
}

/**
 * Find which minterms a QM term covers.
 */
function getCoveredMinterms(term: QMTerm, numVars: number): number[] {
  const covered: number[] = [];
  const dontCarePositions: number[] = [];

  for (let i = 0; i < term.length; i++) {
    if (term[i] === -1) {
      dontCarePositions.push(i);
    }
  }

  // Generate all combinations for don't care positions
  const numDontCares = dontCarePositions.length;
  const numCombinations = 1 << numDontCares;

  for (let combo = 0; combo < numCombinations; combo++) {
    let minterm = 0;
    for (let i = 0; i < numVars; i++) {
      const dcIndex = dontCarePositions.indexOf(i);
      let bit: number;
      if (dcIndex !== -1) {
        bit = (combo >> (numDontCares - 1 - dcIndex)) & 1;
      } else {
        bit = term[i];
      }
      minterm = (minterm << 1) | bit;
    }
    covered.push(minterm);
  }

  return covered;
}

/**
 * Greedy algorithm to find a minimal cover of prime implicants/implicates.
 */
function findMinimalCover(
  primes: QMTerm[],
  termsTocover: number[],
  numVars: number
): QMTerm[] {
  const uncovered = new Set(termsTocover);
  const cover: QMTerm[] = [];

  // First, find essential prime implicants
  // (those that are the only ones covering some minterm)
  const mintermToPrimes: Map<number, number[]> = new Map();

  for (const minterm of termsTocover) {
    mintermToPrimes.set(minterm, []);
  }

  for (let i = 0; i < primes.length; i++) {
    const covered = getCoveredMinterms(primes[i], numVars);
    for (const m of covered) {
      if (mintermToPrimes.has(m)) {
        mintermToPrimes.get(m)!.push(i);
      }
    }
  }

  // Add essential prime implicants
  const usedPrimes = new Set<number>();

  for (const [minterm, coveringPrimes] of mintermToPrimes) {
    if (coveringPrimes.length === 1 && uncovered.has(minterm)) {
      const primeIndex = coveringPrimes[0];
      if (!usedPrimes.has(primeIndex)) {
        usedPrimes.add(primeIndex);
        cover.push(primes[primeIndex]);
        // Mark all minterms covered by this prime as covered
        const coveredByPrime = getCoveredMinterms(primes[primeIndex], numVars);
        for (const m of coveredByPrime) {
          uncovered.delete(m);
        }
      }
    }
  }

  // Greedy cover for remaining minterms
  while (uncovered.size > 0) {
    let bestPrime = -1;
    let bestCount = 0;

    for (let i = 0; i < primes.length; i++) {
      if (usedPrimes.has(i)) continue;

      const covered = getCoveredMinterms(primes[i], numVars);
      const count = covered.filter((m) => uncovered.has(m)).length;

      if (count > bestCount) {
        bestCount = count;
        bestPrime = i;
      }
    }

    if (bestPrime === -1) break; // Should not happen if primes cover all minterms

    usedPrimes.add(bestPrime);
    cover.push(primes[bestPrime]);

    const coveredByPrime = getCoveredMinterms(primes[bestPrime], numVars);
    for (const m of coveredByPrime) {
      uncovered.delete(m);
    }
  }

  return cover;
}
