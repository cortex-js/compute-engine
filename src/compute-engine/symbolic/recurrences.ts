import type { Expression } from '../global-types.js';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards.js';
import {
  appendDistinctRoot,
  characteristicPolynomial,
  collectSymbols,
  freshSymbolName,
  integrationConstants,
  numericMagnitude,
  rootMultiplicity,
  solveLinearSystem,
} from './solver-utils.js';

interface RecurrenceProblem {
  equation: Expression;
  conditions: readonly Expression[];
}

interface RecurrenceTerms {
  coefficients: Map<number, Expression>;
  rest: Expression;
}

function recurrenceProblem(equation: Expression): RecurrenceProblem {
  if (!isFunction(equation, 'List')) return { equation, conditions: [] };
  const [recurrence, ...conditions] = equation.ops;
  return recurrence
    ? { equation: recurrence, conditions }
    : { equation, conditions: [] };
}

function functionName(expr: Expression): string | undefined {
  if (!isFunction(expr)) return undefined;
  return expr.operator;
}

function dependentAtShift(
  expr: Expression,
  dependentName: string,
  indexName: string
): number | undefined {
  if (!isFunction(expr) || expr.operator !== dependentName || expr.nops !== 1)
    return undefined;

  const index = expr.op1;
  if (isSymbol(index, indexName)) return 0;
  if (isFunction(index, 'Add')) {
    let shift = 0;
    let indexCount = 0;
    for (const op of index.ops) {
      if (isSymbol(op, indexName)) indexCount += 1;
      else {
        const value = op.N();
        if (!Number.isInteger(value.re) || Math.abs(value.im) > 1e-12)
          return undefined;
        shift += value.re;
      }
    }
    return indexCount === 1 ? shift : undefined;
  }
  if (isFunction(index, 'Subtract') && isSymbol(index.op1, indexName)) {
    const value = index.op2.N();
    if (!Number.isInteger(value.re) || Math.abs(value.im) > 1e-12)
      return undefined;
    return -value.re;
  }

  return undefined;
}

function splitRecurrenceTerm(
  term: Expression,
  dependentName: string,
  indexName: string
): { shift: number | null; coefficient: Expression } {
  const ce = term.engine;
  const directShift = dependentAtShift(term, dependentName, indexName);
  if (directShift !== undefined)
    return { shift: directShift, coefficient: ce.One };

  if (isFunction(term, 'Negate')) {
    const result = splitRecurrenceTerm(term.op1, dependentName, indexName);
    return { ...result, coefficient: result.coefficient.neg() };
  }

  if (isFunction(term, 'Multiply')) {
    let matchedIndex = -1;
    let matchedShift: number | null = null;

    for (let i = 0; i < term.ops.length; i++) {
      const shift = dependentAtShift(term.ops[i], dependentName, indexName);
      if (shift !== undefined) {
        if (matchedIndex >= 0) return { shift: null, coefficient: term };
        matchedIndex = i;
        matchedShift = shift;
      }
    }

    if (matchedIndex >= 0 && matchedShift !== null) {
      const factors = term.ops.filter((_, i) => i !== matchedIndex);
      const coefficient =
        factors.length === 0 ? ce.One : ce.function('Multiply', factors);
      return { shift: matchedShift, coefficient };
    }
  }

  return { shift: null, coefficient: term };
}

function collectRecurrenceTerms(
  residual: Expression,
  dependentName: string,
  indexName: string
): RecurrenceTerms {
  const ce = residual.engine;
  const terms = isFunction(residual, 'Add')
    ? residual.ops
    : isFunction(residual, 'Subtract')
      ? [residual.op1, residual.op2.neg()]
      : [residual];
  const coefficients = new Map<number, Expression>();
  let rest = ce.Zero;

  for (const term of terms) {
    const split = splitRecurrenceTerm(term, dependentName, indexName);
    if (split.shift === null) rest = rest.add(split.coefficient).simplify();
    else
      coefficients.set(
        split.shift,
        (coefficients.get(split.shift) ?? ce.Zero)
          .add(split.coefficient)
          .simplify()
      );
  }

  return { coefficients, rest };
}

function equationRecurrenceTerms(
  equation: Expression,
  dependentName: string,
  indexName: string
): RecurrenceTerms {
  const ce = equation.engine;
  if (!isFunction(equation, 'Equal'))
    return collectRecurrenceTerms(equation, dependentName, indexName);

  const lhs = collectRecurrenceTerms(equation.op1, dependentName, indexName);
  const rhs = collectRecurrenceTerms(equation.op2, dependentName, indexName);
  const coefficients = new Map(lhs.coefficients);
  for (const [shift, coefficient] of rhs.coefficients)
    coefficients.set(
      shift,
      (coefficients.get(shift) ?? ce.Zero).sub(coefficient).simplify()
    );

  return {
    coefficients,
    rest: lhs.rest.sub(rhs.rest).simplify(),
  };
}

function normalizeShifts(
  terms: RecurrenceTerms
): { coefficients: Map<number, Expression>; order: number } | undefined {
  const nonzero = [...terms.coefficients.entries()].filter(
    ([, coefficient]) => !coefficient.simplify().isSame(0)
  );
  if (nonzero.length === 0) return undefined;

  const minShift = Math.min(...nonzero.map(([shift]) => shift));
  const maxShift = Math.max(...nonzero.map(([shift]) => shift));
  const coefficients = new Map<number, Expression>();
  for (const [shift, coefficient] of nonzero)
    coefficients.set(shift - minShift, coefficient.simplify());

  return { coefficients, order: maxShift - minShift };
}

/**
 * Extract the `(point, value)` pair from an initial condition such as
 * `a(0) = 1` (either orientation). Returns `undefined` if the condition is not
 * of the form `dependent(point) = value`.
 */
function conditionPointValue(
  condition: Expression,
  dependentName: string
): { point: Expression; value: Expression } | undefined {
  if (!isFunction(condition, 'Equal')) return undefined;
  const lhsTarget =
    isFunction(condition.op1) && condition.op1.operator === dependentName
      ? condition.op1
      : undefined;
  const rhsTarget =
    isFunction(condition.op2) && condition.op2.operator === dependentName
      ? condition.op2
      : undefined;
  const target = lhsTarget ?? rhsTarget;
  if (!target || target.nops !== 1) return undefined;

  const value = lhsTarget ? condition.op2 : condition.op1;
  const point = target.op1;
  return { point, value };
}

function applyConditions(
  solution: Expression,
  conditions: readonly Expression[],
  dependentName: string,
  indexName: string
): Expression | undefined {
  if (conditions.length === 0) return solution;
  if (!isFunction(solution, 'List') || solution.nops !== 1) return undefined;

  const solutionEquation = solution.op1;
  if (!isFunction(solutionEquation, 'Equal')) return undefined;
  const ce = solution.engine;
  const generalTerm = solutionEquation.op2;

  const constantNames = [...collectSymbols(solution)]
    .filter((name) => /^c_\d+$/.test(name))
    .sort();
  if (constantNames.length === 0) return undefined;
  const order = constantNames.length;

  // The general solution of a homogeneous linear recurrence is
  // `Σᵢ cᵢ·Bᵢ(n)` — purely linear in the constants with no offset. Recover the
  // basis functions `Bᵢ(n)` by setting `cᵢ = 1` and the others to `0`.
  const basis = constantNames.map((ci) => {
    const map: Record<string, number> = {};
    for (const cj of constantNames) map[cj] = cj === ci ? 1 : 0;
    return generalTerm.subs(map).simplify();
  });

  // Build the linear system `Σᵢ cᵢ·Bᵢ(point) = value` from the conditions.
  const points: Expression[] = [];
  const values: Expression[] = [];
  for (const condition of conditions) {
    const pv = conditionPointValue(condition, dependentName);
    if (!pv) return undefined;
    points.push(pv.point);
    values.push(pv.value);
  }
  if (points.length < order) return undefined;

  const matrix: Expression[][] = [];
  for (let k = 0; k < order; k++)
    matrix.push(
      basis.map((b) => b.subs({ [indexName]: points[k] }).simplify())
    );

  const coefficients = solveLinearSystem(ce, matrix, values.slice(0, order));
  if (!coefficients) return undefined;

  const resolved: Record<string, Expression> = {};
  constantNames.forEach((name, i) => (resolved[name] = coefficients[i]));
  const conditioned = generalTerm.subs(resolved).simplify();
  if (constantNames.some((name) => conditioned.has(name))) return undefined;

  // Over-determined system: the first `order` conditions fixed the constants;
  // the remaining ones must be consistent with the resolved solution
  // (numeric check, matching the pivot test above — an exact `.isSame(0)`
  // can false-reject radical forms such as Binet powers).
  for (let k = order; k < points.length; k++) {
    const diff = ce.function('Subtract', [
      conditioned.subs({ [indexName]: points[k] }),
      values[k],
    ]);
    if (numericMagnitude(diff) > 1e-9) return undefined;
  }

  return ce.function('List', [
    ce.function('Equal', [solutionEquation.op1, conditioned]),
  ]);
}

/**
 * Solve linear homogeneous constant-coefficient recurrences.
 *
 * Currently supports equations such as
 * `a(n + 2) = a(n + 1) + a(n)` and optional initial conditions in a list:
 * `RSolve([recurrence, a(0)=0, a(1)=1], a, n)`.
 */
export function rSolve(
  equation: Expression,
  dependent: Expression,
  index: Expression
): Expression | undefined {
  const dependentName = sym(dependent) ?? functionName(dependent);
  const indexName = sym(index);
  if (!dependentName || !indexName) return undefined;

  const problem = recurrenceProblem(equation);
  const ce = equation.engine;
  const collected = equationRecurrenceTerms(
    problem.equation,
    dependentName,
    indexName
  );
  if (!collected.rest.isSame(0)) return undefined;

  const normalized = normalizeShifts(collected);
  if (!normalized || normalized.order < 1) return undefined;
  const leading = (
    normalized.coefficients.get(normalized.order) ?? ce.Zero
  ).simplify();
  if (leading.isSame(0)) return undefined;

  if (
    [...normalized.coefficients.values()].some((coefficient) =>
      coefficient.has(indexName)
    )
  )
    return undefined;

  const rootVariable = freshSymbolName('rsolveroot', collectSymbols(equation));
  const polynomial = characteristicPolynomial(
    normalized.coefficients,
    rootVariable,
    ce
  );
  const foundRoots = polynomial.polynomialRoots(rootVariable);
  if (!foundRoots || foundRoots.length === 0) return undefined;

  const roots: Expression[] = [];
  for (const root of foundRoots) appendDistinctRoot(roots, root.simplify());

  const rootMultiplicities = roots.map((root) => ({
    root,
    multiplicity: rootMultiplicity(
      polynomial,
      rootVariable,
      root,
      normalized.order
    ),
  }));
  if (rootMultiplicities.some(({ multiplicity }) => multiplicity === 0))
    return undefined;

  const totalMultiplicity = rootMultiplicities.reduce(
    (sum, { multiplicity }) => sum + multiplicity,
    0
  );
  if (totalMultiplicity !== normalized.order) return undefined;

  const n = ce.symbol(indexName);
  const constants = integrationConstants(equation, normalized.order);
  let constantIndex = 0;
  const terms: Expression[] = [];

  for (const { root, multiplicity } of rootMultiplicities) {
    for (let power = 0; power < multiplicity; power++) {
      const coefficient =
        power === 0
          ? constants[constantIndex]
          : constants[constantIndex].mul(n.pow(power)).simplify();
      terms.push(coefficient.mul(root.pow(n)).simplify());
      constantIndex += 1;
    }
  }

  const dependentCall = ce.function(dependentName, [n]);
  const solution = ce
    .function('List', [
      ce.function('Equal', [
        dependentCall,
        ce.function('Add', terms).simplify(),
      ]),
    ])
    .simplify();
  return applyConditions(
    solution,
    problem.conditions,
    dependentName,
    indexName
  );
}
