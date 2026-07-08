import { antiderivative } from './antiderivative';
import type { Expression } from '../global-types';
import { isValueDef } from '../boxed-expression/utils';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards';
import {
  getPolynomialCoefficients,
  polynomialDegree,
} from '../boxed-expression/polynomials';
import {
  derivativeOrderOfDependent,
  explicitDerivativeRhs,
  isDependentFunction,
  isDerivativeOfDependent,
} from '../differential-equation-utils';
import { durandKernerRoots } from '../numerics/polynomial-roots';

interface LinearTermCoefficients {
  derivative: Expression;
  dependent: Expression;
  rest: Expression;
}

interface DerivativeTermCoefficients {
  coefficients: Map<number, Expression>;
  rest: Expression;
}

interface SystemLinearTerms {
  coefficients: Expression[];
  rest: Expression;
}

function functionName(expr: Expression): string | undefined {
  if (!isFunction(expr)) return undefined;
  return expr.operator;
}

function splitTerm(
  term: Expression,
  dependentName: string,
  independentName: string
): { kind: 'derivative' | 'dependent' | 'rest'; coefficient: Expression } {
  const ce = term.engine;

  if (isDerivativeOfDependent(term, dependentName, independentName))
    return { kind: 'derivative', coefficient: ce.One };

  if (isDependentFunction(term, dependentName, independentName))
    return { kind: 'dependent', coefficient: ce.One };

  if (isFunction(term, 'Negate')) {
    const result = splitTerm(term.op1, dependentName, independentName);
    return { ...result, coefficient: result.coefficient.neg() };
  }

  if (isFunction(term, 'Multiply')) {
    let derivativeIndex = -1;
    let dependentIndex = -1;

    for (let i = 0; i < term.ops.length; i++) {
      if (
        isDerivativeOfDependent(term.ops[i], dependentName, independentName)
      ) {
        if (derivativeIndex >= 0) return { kind: 'rest', coefficient: term };
        derivativeIndex = i;
      } else if (
        isDependentFunction(term.ops[i], dependentName, independentName)
      ) {
        if (dependentIndex >= 0) return { kind: 'rest', coefficient: term };
        dependentIndex = i;
      }
    }

    if (derivativeIndex >= 0 && dependentIndex >= 0)
      return { kind: 'rest', coefficient: term };

    const matchedIndex =
      derivativeIndex >= 0 ? derivativeIndex : dependentIndex;
    if (matchedIndex >= 0) {
      const coefficientFactors = term.ops.filter((_, i) => i !== matchedIndex);
      const coefficient =
        coefficientFactors.length === 0
          ? ce.One
          : ce.function('Multiply', coefficientFactors);
      return {
        kind: derivativeIndex >= 0 ? 'derivative' : 'dependent',
        coefficient,
      };
    }
  }

  return { kind: 'rest', coefficient: term };
}

function hasDependentOrDerivative(
  expr: Expression,
  dependentName: string,
  independentName: string
): boolean {
  if (isDependentFunction(expr, dependentName, independentName)) return true;
  if (
    derivativeOrderOfDependent(expr, dependentName, independentName) !==
    undefined
  )
    return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) =>
    hasDependentOrDerivative(op, dependentName, independentName)
  );
}

/**
 * Whether `expr` mentions the dependent function head (or symbol) anywhere,
 * regardless of its argument. Unlike `hasDependentOrDerivative`, this also
 * matches non-standard occurrences such as `y(2x)`, which are not valid
 * forcing terms for the linear first-order solver.
 */
function referencesDependent(expr: Expression, dependentName: string): boolean {
  if (isSymbol(expr, dependentName)) return true;
  if (isFunction(expr)) {
    if (expr.operator === dependentName) return true;
    return expr.ops.some((op) => referencesDependent(op, dependentName));
  }
  return false;
}

/**
 * Build a sum of `terms` without canonicalizing them. Canonical `Add`/`Multiply`
 * type-checks operands, and an unrecognized higher-order derivative term such as
 * `x^2 * y''` (type `expression` when the dependent function is undeclared) would
 * be rewritten to an `Error` node — silently dropping the derivative from the
 * residual. Accumulating structurally preserves the derivative so the guard in
 * `dSolve` can detect it and stay inert.
 */
function structuralSum(
  ce: Expression['engine'],
  terms: Expression[]
): Expression {
  const nonzero = terms.filter((t) => !t.isSame(0));
  if (nonzero.length === 0) return ce.Zero;
  if (nonzero.length === 1) return nonzero[0];
  return ce.function('Add', nonzero, { form: 'structural' });
}

function structuralNeg(expr: Expression): Expression {
  const ce = expr.engine;
  if (expr.isSame(0)) return ce.Zero;
  return ce.function('Negate', [expr], { form: 'structural' });
}

function collectLinearTerms(
  residual: Expression,
  dependentName: string,
  independentName: string
): LinearTermCoefficients {
  const ce = residual.engine;
  const terms = isFunction(residual, 'Add')
    ? residual.ops
    : isFunction(residual, 'Subtract')
      ? [residual.op1, residual.op2.neg()]
      : [residual];
  let derivative = ce.Zero;
  let dependent = ce.Zero;
  const restTerms: Expression[] = [];

  for (const term of terms) {
    const split = splitTerm(term, dependentName, independentName);
    if (split.kind === 'derivative')
      derivative = derivative.add(split.coefficient);
    else if (split.kind === 'dependent')
      dependent = dependent.add(split.coefficient);
    // Keep the residual structural: a term may still contain a (higher-order)
    // derivative that canonical `Add` would corrupt into an `Error` node.
    else restTerms.push(split.coefficient);
  }

  return { derivative, dependent, rest: structuralSum(ce, restTerms) };
}

function equationCoefficients(
  equation: Expression,
  dependentName: string,
  independentName: string
): LinearTermCoefficients {
  const ce = equation.engine;
  if (!isFunction(equation, 'Equal'))
    return collectLinearTerms(
      equation.structural,
      dependentName,
      independentName
    );

  const lhs = collectLinearTerms(
    equation.op1.structural,
    dependentName,
    independentName
  );
  const rhs = collectLinearTerms(
    equation.op2.structural,
    dependentName,
    independentName
  );

  return {
    derivative: lhs.derivative.sub(rhs.derivative),
    dependent: lhs.dependent.sub(rhs.dependent),
    // Combine residuals structurally so higher-order derivative terms survive
    // for the guard rather than being canonicalized into `Error` nodes.
    rest: structuralSum(ce, [lhs.rest, structuralNeg(rhs.rest)]),
  };
}

function expressionForDependent(
  dependent: Expression,
  independent: Expression
): {
  dependentName: string;
  independentName: string;
  dependentCall: Expression;
} | null {
  const dependentName = sym(dependent) ?? functionName(dependent);
  const independentName = sym(independent);
  if (!dependentName || !independentName) return null;

  const ce = dependent.engine;
  return {
    dependentName,
    independentName,
    dependentCall: ce.function(dependentName, [ce.symbol(independentName)]),
  };
}

function expressionsForDependentSystem(
  dependent: Expression,
  independent: Expression
): {
  dependentNames: string[];
  independentName: string;
  dependentCalls: Expression[];
} | null {
  if (!isFunction(dependent, 'List')) return null;
  const independentName = sym(independent);
  if (!independentName) return null;

  const dependentNames = dependent.ops.map((op) => sym(op));
  if (dependentNames.some((name) => name === undefined)) return null;
  const names = dependentNames as string[];
  if (new Set(names).size !== names.length) return null;

  const ce = dependent.engine;
  return {
    dependentNames: names,
    independentName,
    dependentCalls: names.map((name) =>
      ce.function(name, [ce.symbol(independentName)])
    ),
  };
}

function collectSymbols(
  expr: Expression,
  symbols = new Set<string>()
): Set<string> {
  if (isSymbol(expr)) symbols.add(expr.symbol);
  if (isFunction(expr)) {
    for (const op of expr.ops) collectSymbols(op, symbols);
  }
  return symbols;
}

function freshSymbolName(prefix: string, usedSymbols: Set<string>): string {
  for (let i = 0; ; i++) {
    const name = i === 0 ? prefix : `${prefix}_${i}`;
    if (!usedSymbols.has(name)) return name;
  }
}

function integrationConstants(
  equation: Expression,
  count: number
): Expression[] {
  const ce = equation.engine;
  const usedSymbols = collectSymbols(equation);
  const result: Expression[] = [];

  for (let i = 1; result.length < count; i++) {
    const name = `c_${i}`;
    if (usedSymbols.has(name)) continue;
    const def = ce.lookupDefinition(name);
    if (def && !(isValueDef(def) && def.value.inferredType)) continue;
    usedSymbols.add(name);
    result.push(ce.symbol(name));
  }

  return result;
}

function splitDerivativeTerm(
  term: Expression,
  dependentName: string,
  independentName: string
): { order: number | null; coefficient: Expression } {
  const ce = term.engine;

  if (isDependentFunction(term, dependentName, independentName))
    return { order: 0, coefficient: ce.One };

  const directDerivativeOrder = derivativeOrderOfDependent(
    term,
    dependentName,
    independentName
  );
  if (directDerivativeOrder !== undefined)
    return { order: directDerivativeOrder, coefficient: ce.One };

  if (isFunction(term, 'Negate')) {
    const result = splitDerivativeTerm(
      term.op1,
      dependentName,
      independentName
    );
    return { ...result, coefficient: result.coefficient.neg() };
  }

  if (isFunction(term, 'Multiply')) {
    let matchedIndex = -1;
    let matchedOrder: number | null = null;

    for (let i = 0; i < term.ops.length; i++) {
      let order: number | undefined;
      if (isDependentFunction(term.ops[i], dependentName, independentName))
        order = 0;
      else
        order = derivativeOrderOfDependent(
          term.ops[i],
          dependentName,
          independentName
        );

      if (order !== undefined) {
        if (matchedIndex >= 0) return { order: null, coefficient: term };
        matchedIndex = i;
        matchedOrder = order;
      }
    }

    if (matchedIndex >= 0 && matchedOrder !== null) {
      const coefficientFactors = term.ops.filter((_, i) => i !== matchedIndex);
      const coefficient =
        coefficientFactors.length === 0
          ? ce.One
          : ce.function('Multiply', coefficientFactors);
      return { order: matchedOrder, coefficient };
    }
  }

  return { order: null, coefficient: term };
}

function collectDerivativeTerms(
  residual: Expression,
  dependentName: string,
  independentName: string
): DerivativeTermCoefficients {
  const ce = residual.engine;
  const terms = isFunction(residual, 'Add')
    ? residual.ops
    : isFunction(residual, 'Subtract')
      ? [residual.op1, residual.op2.neg()]
      : [residual];
  const coefficients = new Map<number, Expression>();
  let rest = ce.Zero;

  for (const term of terms) {
    const split = splitDerivativeTerm(term, dependentName, independentName);
    if (split.order === null) rest = rest.add(split.coefficient);
    else
      coefficients.set(
        split.order,
        (coefficients.get(split.order) ?? ce.Zero).add(split.coefficient)
      );
  }

  return { coefficients, rest };
}

function negateDerivativeCoefficients(
  coefficients: DerivativeTermCoefficients
): DerivativeTermCoefficients {
  const negated = new Map<number, Expression>();
  for (const [order, coefficient] of coefficients.coefficients)
    negated.set(order, coefficient.neg());
  return { coefficients: negated, rest: coefficients.rest.neg() };
}

function equationDerivativeCoefficients(
  equation: Expression,
  dependentName: string,
  independentName: string
): DerivativeTermCoefficients {
  if (!isFunction(equation, 'Equal'))
    return collectDerivativeTerms(
      equation.structural,
      dependentName,
      independentName
    );

  const lhs = collectDerivativeTerms(
    equation.op1.structural,
    dependentName,
    independentName
  );
  const rhs = negateDerivativeCoefficients(
    collectDerivativeTerms(
      equation.op2.structural,
      dependentName,
      independentName
    )
  );
  const coefficients = new Map(lhs.coefficients);

  for (const [order, coefficient] of rhs.coefficients)
    coefficients.set(
      order,
      (coefficients.get(order) ?? equation.engine.Zero).add(coefficient)
    );

  return { coefficients, rest: lhs.rest.add(rhs.rest) };
}

function isConstantCoefficient(
  expr: Expression,
  dependentName: string,
  independentName: string
): boolean {
  if (expr.has(independentName)) return false;
  return !hasDependentOrDerivative(expr, dependentName, independentName);
}

function expTerm(coefficient: Expression, root: Expression, variable: string) {
  const ce = coefficient.engine;
  const exponent = root.mul(ce.symbol(variable)).simplify();
  return coefficient.mul(ce.function('Exp', [exponent])).simplify();
}

function hasOperator(expr: Expression, operator: string): boolean {
  if (isFunction(expr, operator)) return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => hasOperator(op, operator));
}

/**
 * Simplify `expr`, additionally collapsing "stuck" exponential products such as
 * `e^x·e^-x → 1` and `e^-x·e^(2x) → e^x`. The general simplifier combines
 * same-base powers (`e^a·e^b → e^(a+b)`) only when its rule scan visits the
 * `Multiply` node — a `Multiply` nested inside an `Add` operand is never
 * scanned (lazy operators only numeric-fold their operands) — and, even when
 * it does fire, it preserves `Power(ExponentialE, …)` subtrees verbatim so the
 * combined exponent's like terms are never collected. This left `y'' − y = eˣ`'s
 * Wronskian as `-2·e^(x−x)` (disabling variation of parameters) and a
 * `-¼·e^(−x)·e^(2x)` term unfolded in the final solution. So: combine every
 * `e^a·e^b` product here directly, with the summed exponent simplified. This
 * is only reached from the lazy `DSolve` handler, so the `.simplify()` calls
 * are outside the simplify-rule recursion hazard.
 */
function foldExponentialExponents(expr: Expression): Expression {
  const ce = expr.engine;
  if (isFunction(expr, 'Power') && isSymbol(expr.op1, 'ExponentialE'))
    return ce.function('Power', [
      expr.op1,
      foldExponentialExponents(expr.op2).simplify(),
    ]);
  if (isFunction(expr, 'Multiply')) {
    // Combine all `e^…` factors into a single exponential with a simplified
    // summed exponent (`e^a·e^b → e^(a+b)`); recurse into the other factors.
    const exponents: Expression[] = [];
    const rest: Expression[] = [];
    for (const op of expr.ops) {
      const folded = foldExponentialExponents(op);
      if (isFunction(folded, 'Power') && isSymbol(folded.op1, 'ExponentialE'))
        exponents.push(folded.op2);
      else rest.push(folded);
    }
    if (exponents.length > 0) {
      const exponent =
        exponents.length === 1
          ? exponents[0]
          : ce.function('Add', exponents).simplify();
      if (!exponent.isSame(0))
        rest.push(ce.function('Power', [ce.symbol('ExponentialE'), exponent]));
    }
    if (rest.length === 0) return ce.One;
    if (rest.length === 1) return rest[0];
    return ce.function('Multiply', rest);
  }
  if (isFunction(expr))
    return ce.function(
      expr.operator,
      expr.ops.map((op) => foldExponentialExponents(op))
    );
  return expr;
}

/**
 * Decompose a product term into a single squared-trig factor and its
 * coefficient: `½·eˣ·sin²(x)` → `{ kind: 'Sin', arg: x, coefficient: ½·eˣ }`.
 * Returns `undefined` when the term is not of the form `A·sin²(u)` or
 * `A·cos²(u)` (with exactly one squared-trig factor).
 */
function splitTrigSquareTerm(
  term: Expression
):
  | { kind: 'Sin' | 'Cos'; arg: Expression; coefficient: Expression }
  | undefined {
  const ce = term.engine;

  const trigSquare = (
    x: Expression
  ): { kind: 'Sin' | 'Cos'; arg: Expression } | undefined => {
    if (
      isFunction(x, 'Power') &&
      x.op2.isSame(2) &&
      (isFunction(x.op1, 'Sin') || isFunction(x.op1, 'Cos'))
    )
      return { kind: x.op1.operator as 'Sin' | 'Cos', arg: x.op1.op1 };
    return undefined;
  };

  const direct = trigSquare(term);
  if (direct) return { ...direct, coefficient: ce.One };

  if (isFunction(term, 'Negate')) {
    const inner = splitTrigSquareTerm(term.op1);
    if (!inner) return undefined;
    return { ...inner, coefficient: inner.coefficient.neg() };
  }

  if (isFunction(term, 'Multiply')) {
    let found: { kind: 'Sin' | 'Cos'; arg: Expression } | undefined;
    const rest: Expression[] = [];
    for (const op of term.ops) {
      const ts = trigSquare(op);
      if (ts) {
        if (found) return undefined; // more than one squared-trig factor
        found = ts;
      } else rest.push(op);
    }
    if (!found) return undefined;
    const coefficient =
      rest.length === 0
        ? ce.One
        : rest.length === 1
          ? rest[0]
          : ce.function('Multiply', rest);
    return { ...found, coefficient };
  }

  return undefined;
}

/**
 * Within every `Add`, collect Pythagorean pairs `A·sin²(u) + A·cos²(u) → A`
 * (same coefficient up to `isSame`, same argument). Variation of parameters
 * with a trig homogeneous basis {cos ωx, sin ωx} structurally produces exactly
 * this shape (y_p = −y₁∫(y₂g/W) + y₂∫(y₁g/W)), e.g. `y'' + y = eˣ` →
 * `… + ½eˣsin²x + ½eˣcos²x`; the shared `½eˣ` factor hides the bare
 * `sin² + cos²` sum from the general Pythagorean simplification rule.
 */
function collectPythagoreanPairs(expr: Expression): Expression {
  const ce = expr.engine;
  if (!isFunction(expr)) return expr;

  const ops = expr.ops.map((op) => collectPythagoreanPairs(op));

  if (isFunction(expr, 'Add')) {
    const terms = [...ops];
    let collected = false;
    for (let i = 0; i < terms.length; i++) {
      const a = splitTrigSquareTerm(terms[i]);
      if (!a) continue;
      for (let j = i + 1; j < terms.length; j++) {
        const b = splitTrigSquareTerm(terms[j]);
        if (
          !b ||
          b.kind === a.kind ||
          !a.arg.isSame(b.arg) ||
          !a.coefficient.isSame(b.coefficient)
        )
          continue;
        // A·sin²(u) + A·cos²(u) → A
        terms.splice(j, 1);
        terms[i] = a.coefficient;
        collected = true;
        break;
      }
    }
    if (collected) {
      if (terms.length === 1) return terms[0];
      return ce.function('Add', terms);
    }
  }

  const changed = ops.some((op, i) => op !== expr.ops[i]);
  if (!changed) return expr;
  return ce.function(expr.operator, ops);
}

function simplifyFoldingExp(expr: Expression): Expression {
  return collectPythagoreanPairs(
    foldExponentialExponents(expr.simplify())
  ).simplify();
}

function dSolveAntiderivative(expr: Expression, variable: string): Expression {
  const ce = expr.engine;
  if (ce._integrationProvider) {
    try {
      const provided = ce._integrationProvider(expr, variable);
      if (provided && !hasOperator(provided, 'Integrate')) return provided;
    } catch {
      // Fall through to the built-in antiderivative, matching Integrate.
    }
  }
  return antiderivative(expr, variable);
}

function splitSystemTerm(
  term: Expression,
  dependentNames: readonly string[],
  independentName: string
): { index: number | null; coefficient: Expression } {
  const ce = term.engine;

  for (let i = 0; i < dependentNames.length; i++) {
    if (isDependentFunction(term, dependentNames[i], independentName))
      return { index: i, coefficient: ce.One };
  }

  if (isFunction(term, 'Negate')) {
    const result = splitSystemTerm(term.op1, dependentNames, independentName);
    return { ...result, coefficient: result.coefficient.neg() };
  }

  if (isFunction(term, 'Multiply')) {
    let dependentIndex = -1;
    let dependentFactorIndex = -1;

    for (let i = 0; i < term.ops.length; i++) {
      for (let j = 0; j < dependentNames.length; j++) {
        if (
          isDependentFunction(term.ops[i], dependentNames[j], independentName)
        ) {
          if (dependentIndex >= 0) return { index: null, coefficient: term };
          dependentIndex = j;
          dependentFactorIndex = i;
        }
      }
    }

    if (dependentIndex >= 0) {
      const coefficientFactors = term.ops.filter(
        (_, i) => i !== dependentFactorIndex
      );
      return {
        index: dependentIndex,
        coefficient:
          coefficientFactors.length === 0
            ? ce.One
            : ce.function('Multiply', coefficientFactors),
      };
    }
  }

  return { index: null, coefficient: term };
}

function collectSystemLinearTerms(
  rhs: Expression,
  dependentNames: readonly string[],
  independentName: string
): SystemLinearTerms {
  const ce = rhs.engine;
  const terms = isFunction(rhs, 'Add')
    ? rhs.ops
    : isFunction(rhs, 'Subtract')
      ? [rhs.op1, rhs.op2.neg()]
      : [rhs];
  const coefficients = dependentNames.map(() => ce.Zero);
  let rest = ce.Zero;

  for (const term of terms) {
    const split = splitSystemTerm(term, dependentNames, independentName);
    if (split.index === null) rest = rest.add(split.coefficient);
    else
      coefficients[split.index] = coefficients[split.index].add(
        split.coefficient
      );
  }

  return { coefficients, rest };
}

function hasAnyDependentOrDerivative(
  expr: Expression,
  dependentNames: readonly string[],
  independentName: string
): boolean {
  return dependentNames.some((name) =>
    hasDependentOrDerivative(expr, name, independentName)
  );
}

function listOps(expr: Expression): readonly Expression[] | undefined {
  return isFunction(expr, 'List') ? expr.ops : undefined;
}

function solveLinearHomogeneousSystem(
  equation: Expression,
  dependent: Expression,
  independent: Expression
): Expression | undefined {
  const system = expressionsForDependentSystem(dependent, independent);
  if (!system || !isFunction(equation, 'List')) return undefined;

  const { dependentNames, independentName, dependentCalls } = system;
  const ce = equation.engine;
  if (
    dependentNames.length === 0 ||
    equation.ops.length !== dependentNames.length
  )
    return undefined;

  const rows: Expression[][] = [];
  for (let i = 0; i < equation.ops.length; i++) {
    const rhsInfo = explicitDerivativeRhs(
      equation.ops[i].structural,
      dependentNames[i],
      independentName
    );
    if (!rhsInfo || rhsInfo.order !== 1) return undefined;

    const row = collectSystemLinearTerms(
      rhsInfo.rhs.structural,
      dependentNames,
      independentName
    );
    if (!row.rest.simplify().isSame(0)) return undefined;
    if (
      row.coefficients.some(
        (coefficient) =>
          coefficient.has(independentName) ||
          hasAnyDependentOrDerivative(
            coefficient,
            dependentNames,
            independentName
          )
      )
    )
      return undefined;

    rows.push(row.coefficients.map((coefficient) => coefficient.simplify()));
  }

  const matrix = ce
    ._fn(
      'List',
      rows.map((row) => ce._fn('List', row))
    )
    .evaluate();
  const eigen = ce.expr(['Eigen', matrix]).evaluate();
  if (!isFunction(eigen, 'Tuple') || eigen.nops !== 2) return undefined;

  const eigenvalues = listOps(eigen.op1);
  const eigenvectors = listOps(eigen.op2);
  if (
    !eigenvalues ||
    !eigenvectors ||
    eigenvalues.length !== dependentNames.length ||
    eigenvectors.length !== dependentNames.length
  )
    return undefined;

  const seenEigenvalues = new Set<string>();
  for (const eigenvalue of eigenvalues) {
    const key = eigenvalue.toString();
    if (seenEigenvalues.has(key)) return undefined;
    seenEigenvalues.add(key);
  }

  const constants = integrationConstants(equation, dependentNames.length);
  const x = ce.symbol(independentName);
  const solutions = dependentNames.map((_, componentIndex) => {
    const terms: Expression[] = [];
    for (let i = 0; i < eigenvalues.length; i++) {
      const vector = listOps(eigenvectors[i]);
      if (!vector || vector.length !== dependentNames.length) return undefined;
      terms.push(
        constants[i]
          .mul(vector[componentIndex])
          .mul(ce.function('Exp', [eigenvalues[i].mul(x).simplify()]))
      );
    }
    return ce.function('Add', terms).simplify();
  });
  if (solutions.some((solution) => solution === undefined)) return undefined;

  return ce.function(
    'List',
    dependentCalls.map((call, i) =>
      ce.function('Equal', [call, solutions[i] as Expression])
    )
  );
}

function productExpression(ce: Expression['engine'], factors: Expression[]) {
  if (factors.length === 0) return ce.One;
  if (factors.length === 1) return factors[0];
  return ce.function('Multiply', factors).simplify();
}

function sameArgument(
  lhs: Expression | undefined,
  rhs: Expression | undefined
): boolean {
  return lhs !== undefined && rhs !== undefined && lhs.isSame(rhs);
}

function normalizeVariationIntegrand(
  expr: Expression,
  independentName: string
): Expression {
  const ce = expr.engine;
  if (isFunction(expr, 'Negate'))
    return normalizeVariationIntegrand(expr.op1, independentName)
      .neg()
      .simplify();

  if (!isFunction(expr, 'Multiply')) return expr;

  const factors = expr.ops.map((op) =>
    normalizeVariationIntegrand(op, independentName)
  );

  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const a = factors[i];
      const b = factors[j];
      const rest = factors.filter((_, k) => k !== i && k !== j);
      const trigProduct = normalizedTrigProduct(a, b, independentName);
      if (!trigProduct) continue;
      return productExpression(ce, [...rest, trigProduct]).simplify();
    }
  }

  return ce.function('Multiply', factors).simplify();
}

function normalizedTrigProduct(
  lhs: Expression,
  rhs: Expression,
  independentName: string
): Expression | undefined {
  const ce = lhs.engine;
  const ordered =
    isFunction(lhs, 'Tan') && !isFunction(rhs, 'Tan') ? [rhs, lhs] : [lhs, rhs];
  const [a, b] = ordered;
  if (!isFunction(b, 'Tan') || b.op1.has(independentName) === false)
    return undefined;

  if (isFunction(a, 'Cos') && sameArgument(a.op1, b.op1))
    return ce.function('Sin', [a.op1]).simplify();

  if (isFunction(a, 'Sin') && sameArgument(a.op1, b.op1)) {
    const sec = ce.function('Sec', [a.op1]);
    const cos = ce.function('Cos', [a.op1]);
    return sec.sub(cos).simplify();
  }

  return undefined;
}

function characteristicPolynomial(
  coefficients: Map<number, Expression>,
  order: number,
  variable: string,
  ce: Expression['engine']
): Expression {
  const root = ce.symbol(variable);
  const terms: Expression[] = [];

  for (let i = 0; i <= order; i++) {
    const coefficient = (coefficients.get(i) ?? ce.Zero).simplify();
    if (coefficient.isSame(0)) continue;
    if (i === 0) terms.push(coefficient);
    else if (i === 1) terms.push(coefficient.mul(root).simplify());
    else terms.push(coefficient.mul(root.pow(i)).simplify());
  }

  return terms.length === 0 ? ce.Zero : ce.function('Add', terms).simplify();
}

function isZeroAtRoot(
  expr: Expression,
  variable: string,
  root: Expression
): boolean {
  const value = expr.subs({ [variable]: root }).simplify();
  if (value.isSame(0)) return true;
  const numeric = value.N();
  return Math.hypot(numeric.re, numeric.im) < 1e-8;
}

function rootMultiplicity(
  polynomial: Expression,
  variable: string,
  root: Expression,
  maxMultiplicity: number
): number {
  const ce = polynomial.engine;
  let multiplicity = 0;
  let derivative = polynomial;

  while (
    multiplicity < maxMultiplicity &&
    isZeroAtRoot(derivative, variable, root)
  ) {
    multiplicity += 1;
    derivative = ce
      .function('D', [derivative, ce.symbol(variable)])
      .evaluate()
      .simplify();
  }

  return multiplicity;
}

function appendDistinctRoot(
  roots: Expression[],
  root: Expression,
  tolerance = 1e-8
): void {
  const rootValue = root.N();
  if (
    roots.some((other) => {
      if (root.isSame(other)) return true;
      const otherValue = other.N();
      return (
        Math.hypot(rootValue.re - otherValue.re, rootValue.im - otherValue.im) <
        tolerance
      );
    })
  )
    return;

  roots.push(root);
}

function numericCharacteristicCoefficients(
  coefficients: Map<number, Expression>,
  order: number,
  ce: Expression['engine']
): number[] | undefined {
  const result: number[] = [];
  for (let i = 0; i <= order; i++) {
    const value = (coefficients.get(i) ?? ce.Zero).N();
    if (!Number.isFinite(value.re) || Math.abs(value.im) > 1e-12)
      return undefined;
    result.push(value.re);
  }
  return result;
}

// Tolerance for treating a numeric root as real (|im| below this) and for
// pairing conjugates. Kept consistent so a conjugate is never orphaned.
const NUMERIC_ROOT_IM_TOL = 1e-7;

interface NumericRootCluster {
  re: number;
  im: number;
  multiplicity: number;
}

/**
 * Group nearly-coincident numeric roots (as returned by Durand–Kerner for a
 * multiple root) into (representative, multiplicity) clusters. A double or
 * triple root shows up as several roots spread by numeric noise (~1e-8 for a
 * double, larger for higher multiplicity); each cluster's representative is the
 * mean of its members.
 */
function clusterNumericRoots(
  roots: readonly { re: number; im: number }[]
): NumericRootCluster[] {
  const clusters: { sumRe: number; sumIm: number; count: number }[] = [];

  for (const root of roots) {
    let placed = false;
    for (const cluster of clusters) {
      const re = cluster.sumRe / cluster.count;
      const im = cluster.sumIm / cluster.count;
      const scale = Math.max(
        1,
        Math.hypot(re, im),
        Math.hypot(root.re, root.im)
      );
      if (Math.hypot(root.re - re, root.im - im) < 1e-6 * scale) {
        cluster.sumRe += root.re;
        cluster.sumIm += root.im;
        cluster.count += 1;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ sumRe: root.re, sumIm: root.im, count: 1 });
  }

  return clusters.map((cluster) => ({
    re: denoiseComponent(cluster.sumRe / cluster.count),
    im: denoiseComponent(cluster.sumIm / cluster.count),
    multiplicity: cluster.count,
  }));
}

/**
 * Snap a numeric root component to a nearby integer when it is within
 * tolerance, removing Durand–Kerner noise. This turns a double root at
 * `1 ± 1e-15` into `1` (so `e^x` rather than `e^(1.000000000000006x)`) and a
 * spurious real part of `3.8e-9` on a `±i` pair into `0`.
 */
function denoiseComponent(value: number): number {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 1e-7 * Math.max(1, Math.abs(value)))
    return rounded;
  return value;
}

function solveHigherOrderWithNumericRoots(
  equation: Expression,
  dependentCall: Expression,
  coefficients: Map<number, Expression>,
  order: number,
  independentName: string
): Expression | undefined {
  const ce = equation.engine;
  const coeffs = numericCharacteristicCoefficients(coefficients, order, ce);
  if (!coeffs) return undefined;

  // CE's exact polynomial root helper can miss complex roots in degree >= 3.
  // When that happens, use numeric roots rather than returning no solution;
  // exact recovery of values like sqrt(3)/2 is a future improvement.
  const roots = durandKernerRoots(coeffs, ce._deadline);
  if (!roots || roots.length !== order) return undefined;

  // Cluster coincident roots so a multiple root emits `x^k e^(rx)` modes
  // instead of several numerically-dependent copies.
  const clusters = clusterNumericRoots(roots);

  const realClusters = clusters
    .filter((c) => Math.abs(c.im) < NUMERIC_ROOT_IM_TOL)
    .sort((a, b) => a.re - b.re);
  const complexClusters = clusters
    .filter((c) => Math.abs(c.im) >= NUMERIC_ROOT_IM_TOL)
    .sort((a, b) => a.re - b.re || Math.abs(b.im) - Math.abs(a.im));

  const x = ce.symbol(independentName);
  const basis: Expression[] = [];

  // Real roots: x^k e^(rx), k = 0 .. multiplicity - 1.
  for (const cluster of realClusters) {
    const root = ce.number(cluster.re);
    for (let k = 0; k < cluster.multiplicity; k++) {
      const coefficient = k === 0 ? ce.One : x.pow(k);
      basis.push(expTerm(coefficient, root, independentName));
    }
  }

  // Complex roots: pair each a+bi (b > 0) with its conjugate and emit
  // x^k e^(ax) cos(bx) and x^k e^(ax) sin(bx), k = 0 .. multiplicity - 1.
  const usedComplex = new Set<number>();
  for (let i = 0; i < complexClusters.length; i++) {
    if (usedComplex.has(i)) continue;
    const cluster = complexClusters[i];
    if (cluster.im <= 0) continue; // consumed via its positive-im conjugate

    const conjugateIndex = complexClusters.findIndex(
      (candidate, j) =>
        j !== i &&
        !usedComplex.has(j) &&
        Math.abs(candidate.re - cluster.re) < NUMERIC_ROOT_IM_TOL &&
        Math.abs(candidate.im + cluster.im) < NUMERIC_ROOT_IM_TOL &&
        candidate.multiplicity === cluster.multiplicity
    );
    if (conjugateIndex < 0) return undefined;
    usedComplex.add(i);
    usedComplex.add(conjugateIndex);

    const alpha = ce.number(cluster.re);
    const beta = ce.number(Math.abs(cluster.im));
    const betaX = beta.mul(x).simplify();
    const cos = ce.function('Cos', [betaX]);
    const sin = ce.function('Sin', [betaX]);
    for (let k = 0; k < cluster.multiplicity; k++) {
      const power = k === 0 ? ce.One : x.pow(k);
      basis.push(expTerm(power.mul(cos).simplify(), alpha, independentName));
      basis.push(expTerm(power.mul(sin).simplify(), alpha, independentName));
    }
  }

  // Structural self-check: the basis must span exactly `order` distinct
  // functions. If clustering mis-grouped roots (too few modes) or produced a
  // duplicate, stay inert rather than return a degenerate general solution.
  if (basis.length !== order) return undefined;
  for (let i = 0; i < basis.length; i++)
    for (let j = i + 1; j < basis.length; j++)
      if (basis[i].isSame(basis[j])) return undefined;

  const constants = integrationConstants(equation, order);
  let solution = ce.Zero;
  for (let i = 0; i < basis.length; i++)
    solution = solution.add(constants[i].mul(basis[i]));
  solution = solution.simplify();
  return ce.function('List', [ce.function('Equal', [dependentCall, solution])]);
}

function solveHigherOrderHomogeneousConstantCoefficient(
  equation: Expression,
  dependentCall: Expression,
  dependentName: string,
  independentName: string
): Expression | undefined {
  const ce = equation.engine;
  const collected = equationDerivativeCoefficients(
    equation,
    dependentName,
    independentName
  );
  if (!collected.rest.isSame(0)) return undefined;

  const order = Math.max(...collected.coefficients.keys());
  if (order < 3) return undefined;
  const leading = (collected.coefficients.get(order) ?? ce.Zero).simplify();
  if (leading.isSame(0)) return undefined;
  if (
    ![...collected.coefficients.values()].every((coefficient) =>
      isConstantCoefficient(coefficient, dependentName, independentName)
    )
  )
    return undefined;

  const rootVariable = freshSymbolName('dsolveroot', collectSymbols(equation));
  const polynomial = characteristicPolynomial(
    collected.coefficients,
    order,
    rootVariable,
    ce
  );
  const foundRoots = polynomial.polynomialRoots(rootVariable);
  if (!foundRoots || foundRoots.length === 0)
    return solveHigherOrderWithNumericRoots(
      equation,
      dependentCall,
      collected.coefficients,
      order,
      independentName
    );

  const roots: Expression[] = [];
  for (const root of foundRoots) appendDistinctRoot(roots, root.simplify());

  const rootMultiplicities = roots.map((root) => ({
    root,
    multiplicity: rootMultiplicity(polynomial, rootVariable, root, order),
  }));
  if (rootMultiplicities.some(({ multiplicity }) => multiplicity === 0))
    return solveHigherOrderWithNumericRoots(
      equation,
      dependentCall,
      collected.coefficients,
      order,
      independentName
    );

  const totalMultiplicity = rootMultiplicities.reduce(
    (sum, { multiplicity }) => sum + multiplicity,
    0
  );
  if (totalMultiplicity !== order)
    return solveHigherOrderWithNumericRoots(
      equation,
      dependentCall,
      collected.coefficients,
      order,
      independentName
    );

  const constants = integrationConstants(equation, order);
  const x = ce.symbol(independentName);
  let constantIndex = 0;
  const terms: Expression[] = [];

  for (const { root, multiplicity } of rootMultiplicities) {
    for (let power = 0; power < multiplicity; power++) {
      const coefficient =
        power === 0
          ? constants[constantIndex]
          : constants[constantIndex].mul(x.pow(power)).simplify();
      terms.push(expTerm(coefficient, root, independentName));
      constantIndex += 1;
    }
  }

  const solution = ce.function('Add', terms).simplify();
  return ce.function('List', [ce.function('Equal', [dependentCall, solution])]);
}

function solveSecondOrderHomogeneousConstantCoefficient(
  equation: Expression,
  dependentCall: Expression,
  dependentName: string,
  independentName: string
): Expression | undefined {
  const basis = secondOrderConstantCoefficientBasis(
    equation,
    dependentName,
    independentName
  );
  if (!basis) return undefined;

  const constants = integrationConstants(equation, 2);
  const solution = constants[0]
    .mul(basis[0])
    .add(constants[1].mul(basis[1]))
    .simplify();
  return ceListSolution(dependentCall, solution);
}

function ceListSolution(
  dependentCall: Expression,
  solution: Expression
): Expression {
  return dependentCall.engine.function('List', [
    dependentCall.engine.function('Equal', [dependentCall, solution]),
  ]);
}

function secondOrderConstantCoefficientBasis(
  equation: Expression,
  dependentName: string,
  independentName: string
): [Expression, Expression] | undefined {
  const collected = equationDerivativeCoefficients(
    equation,
    dependentName,
    independentName
  );
  if (!collected.rest.isSame(0)) return undefined;
  for (const order of collected.coefficients.keys()) {
    if (order > 2) return undefined;
  }

  return secondOrderConstantCoefficientBasisFromCoefficients(
    equation,
    collected.coefficients,
    dependentName,
    independentName
  );
}

function secondOrderConstantCoefficientBasisFromCoefficients(
  equation: Expression,
  coefficients: Map<number, Expression>,
  dependentName: string,
  independentName: string
): [Expression, Expression] | undefined {
  const ce = equation.engine;
  const a = (coefficients.get(2) ?? ce.Zero).simplify();
  const b = (coefficients.get(1) ?? ce.Zero).simplify();
  const c0 = (coefficients.get(0) ?? ce.Zero).simplify();
  if (a.isSame(0)) return undefined;
  if (
    ![a, b, c0].every((coefficient) =>
      isConstantCoefficient(coefficient, dependentName, independentName)
    )
  )
    return undefined;

  const x = ce.symbol(independentName);
  const twoA = a.mul(2).simplify();
  const discriminant = b.pow(2).sub(a.mul(c0).mul(4)).simplify();

  if (discriminant.isSame(0)) {
    const root = b.neg().div(twoA).simplify();
    const exponential = expTerm(ce.One, root, independentName);
    return [exponential, x.mul(exponential).simplify()];
  }

  if (discriminant.isPositive === true) {
    const sqrtDiscriminant = ce.function('Sqrt', [discriminant]).simplify();
    const root1 = ce.function('Divide', [
      ce.function('Add', [b.neg(), sqrtDiscriminant]),
      twoA,
    ]);
    const root2 = ce.function('Divide', [
      ce.function('Subtract', [b.neg(), sqrtDiscriminant]),
      twoA,
    ]);
    return [
      expTerm(ce.One, root1, independentName),
      expTerm(ce.One, root2, independentName),
    ];
  }

  if (discriminant.isNegative === true) {
    const alpha = b.neg().div(twoA).simplify();
    const beta = ce.function('Sqrt', [discriminant.neg()]).div(twoA).simplify();
    const exponential = expTerm(ce.One, alpha, independentName);
    return [
      exponential.mul(ce.function('Cos', [beta.mul(x).simplify()])).simplify(),
      exponential.mul(ce.function('Sin', [beta.mul(x).simplify()])).simplify(),
    ];
  }

  return undefined;
}

function solveSecondOrderNonhomogeneousConstantCoefficient(
  equation: Expression,
  dependentCall: Expression,
  dependentName: string,
  independentName: string
): Expression | undefined {
  const ce = equation.engine;
  const collected = equationDerivativeCoefficients(
    equation,
    dependentName,
    independentName
  );
  const a = (collected.coefficients.get(2) ?? ce.Zero).simplify();
  if (a.isSame(0) || collected.rest.isSame(0)) return undefined;
  if ([...collected.coefficients.keys()].some((order) => order > 2))
    return undefined;
  if (
    hasDependentOrDerivative(collected.rest, dependentName, independentName) ||
    ![...collected.coefficients.values()].every((coefficient) =>
      isConstantCoefficient(coefficient, dependentName, independentName)
    )
  )
    return undefined;

  const basis = secondOrderConstantCoefficientBasisFromCoefficients(
    equation,
    collected.coefficients,
    dependentName,
    independentName
  );
  if (!basis) return undefined;

  const [y1, y2] = basis;
  const [c1, c2] = integrationConstants(equation, 2);
  const polynomialParticular = polynomialParticularSolution(
    equation,
    collected,
    independentName
  );
  if (polynomialParticular) {
    const solution = c1
      .mul(y1)
      .add(c2.mul(y2))
      .add(polynomialParticular)
      .simplify();
    return ceListSolution(dependentCall, solution);
  }

  const y1Prime = ce.function('D', [y1, ce.symbol(independentName)]).evaluate();
  const y2Prime = ce.function('D', [y2, ce.symbol(independentName)]).evaluate();
  // Fold exponential products (`e^x·e^-x → 1`) that the general simplifier
  // otherwise leaves as `e^(x−x)`, which would keep the Wronskian and the
  // integrands from reducing and silently disable variation of parameters.
  const wronskian = simplifyFoldingExp(y1.mul(y2Prime).sub(y1Prime.mul(y2)));
  if (wronskian.isSame(0)) return undefined;

  const g = collected.rest.neg().simplify();
  const denominator = a.mul(wronskian).simplify();
  const u1Integrand = normalizeVariationIntegrand(
    simplifyFoldingExp(y2.neg().mul(g).div(denominator)),
    independentName
  );
  const u2Integrand = normalizeVariationIntegrand(
    simplifyFoldingExp(y1.mul(g).div(denominator)),
    independentName
  );
  const u1 = dSolveAntiderivative(u1Integrand, independentName);
  const u2 = dSolveAntiderivative(u2Integrand, independentName);

  if (hasOperator(u1, 'Integrate') || hasOperator(u2, 'Integrate'))
    return undefined;

  const solution = simplifyFoldingExp(
    c1.mul(y1).add(c2.mul(y2)).add(y1.mul(u1)).add(y2.mul(u2))
  );
  return ceListSolution(dependentCall, solution);
}

function polynomialParticularSolution(
  equation: Expression,
  collected: DerivativeTermCoefficients,
  independentName: string
): Expression | undefined {
  const ce = equation.engine;
  const rhs = collected.rest.neg().simplify();
  const rhsDegree = polynomialDegree(rhs, independentName);
  if (rhsDegree < 0) return undefined;

  let zeroRootMultiplicity = 0;
  while (
    zeroRootMultiplicity <= 2 &&
    (collected.coefficients.get(zeroRootMultiplicity) ?? ce.Zero)
      .simplify()
      .isSame(0)
  )
    zeroRootMultiplicity += 1;
  if (zeroRootMultiplicity > 2) return undefined;

  const usedSymbols = collectSymbols(equation);
  const coefficientNames = Array.from({ length: rhsDegree + 1 }, (_, i) => {
    const name = freshSymbolName(`dsolvep_${i}`, usedSymbols);
    usedSymbols.add(name);
    return name;
  });
  const x = ce.symbol(independentName);
  const terms = coefficientNames.map((name, i) =>
    ce
      .symbol(name)
      .mul(x.pow(i + zeroRootMultiplicity))
      .simplify()
  );
  const ansatz = ce.function('Add', terms).simplify();

  const residual = [...collected.coefficients.entries()]
    .reduce((sum, [order, coefficient]) => {
      let derivative = ansatz;
      for (let i = 0; i < order; i++)
        derivative = ce.function('D', [derivative, x]).evaluate();
      return sum.add(coefficient.mul(derivative)).simplify();
    }, collected.rest)
    .simplify();
  const residualCoefficients = getPolynomialCoefficients(
    residual,
    independentName
  );
  if (!residualCoefficients) return undefined;

  const equations = residualCoefficients.map((coefficient) =>
    ce.function('Equal', [coefficient.simplify(), ce.Zero])
  );
  const result = ce.function('List', equations).solve(coefficientNames);
  const solution = solutionRecord(result);
  if (!solution) return undefined;

  const particular = ansatz.subs(solution).simplify();
  if (coefficientNames.some((name) => particular.has(name))) return undefined;
  return particular;
}

function solutionRecord(
  result:
    | null
    | ReadonlyArray<Expression>
    | Record<string, Expression>
    | Array<Record<string, Expression>>
): Record<string, Expression> | undefined {
  if (!result) return undefined;
  if (!Array.isArray(result)) return result as Record<string, Expression>;
  const [first] = result;
  if (!first || 'operator' in first) return undefined;
  return first as Record<string, Expression>;
}

function coefficientWithoutPowerOfX(
  coefficient: Expression,
  independentName: string,
  power: number
): Expression | undefined {
  const ce = coefficient.engine;
  const x = ce.symbol(independentName);
  const xPower = power === 0 ? ce.One : power === 1 ? x : x.pow(power);
  const scaled = coefficient.div(xPower).simplify();
  if (scaled.has(independentName)) return undefined;
  return scaled;
}

function solveSecondOrderCauchyEulerHomogeneous(
  equation: Expression,
  dependentCall: Expression,
  dependentName: string,
  independentName: string
): Expression | undefined {
  const ce = equation.engine;
  const collected = equationDerivativeCoefficients(
    equation,
    dependentName,
    independentName
  );
  if (!collected.rest.isSame(0)) return undefined;
  if ([...collected.coefficients.keys()].some((order) => order > 2))
    return undefined;

  const a = coefficientWithoutPowerOfX(
    collected.coefficients.get(2) ?? ce.Zero,
    independentName,
    2
  )?.simplify();
  const b = coefficientWithoutPowerOfX(
    collected.coefficients.get(1) ?? ce.Zero,
    independentName,
    1
  )?.simplify();
  const c0 = coefficientWithoutPowerOfX(
    collected.coefficients.get(0) ?? ce.Zero,
    independentName,
    0
  )?.simplify();
  if (!a || !b || !c0 || a.isSame(0)) return undefined;

  const [c1, c2] = integrationConstants(equation, 2);
  const x = ce.symbol(independentName);
  const effectiveB = b.sub(a).simplify();
  const twoA = a.mul(2).simplify();
  const discriminant = effectiveB.pow(2).sub(a.mul(c0).mul(4)).simplify();

  let solution: Expression | undefined;
  if (discriminant.isSame(0)) {
    const root = effectiveB.neg().div(twoA).simplify();
    solution = c1
      .add(c2.mul(ce.function('Ln', [x])))
      .mul(x.pow(root))
      .simplify();
  } else if (discriminant.isPositive === true) {
    const sqrtDiscriminant = ce.function('Sqrt', [discriminant]).simplify();
    const root1 = ce.function('Divide', [
      ce.function('Add', [effectiveB.neg(), sqrtDiscriminant]),
      twoA,
    ]);
    const root2 = ce.function('Divide', [
      ce.function('Subtract', [effectiveB.neg(), sqrtDiscriminant]),
      twoA,
    ]);
    solution = c1
      .mul(x.pow(root1))
      .add(c2.mul(x.pow(root2)))
      .simplify();
  } else if (discriminant.isNegative === true) {
    const alpha = effectiveB.neg().div(twoA).simplify();
    const beta = ce.function('Sqrt', [discriminant.neg()]).div(twoA).simplify();
    const logX = ce.function('Ln', [x]);
    const oscillatory = c1
      .mul(ce.function('Cos', [beta.mul(logX).simplify()]))
      .add(c2.mul(ce.function('Sin', [beta.mul(logX).simplify()])))
      .simplify();
    solution = x.pow(alpha).mul(oscillatory).simplify();
  }

  return solution ? ceListSolution(dependentCall, solution) : undefined;
}

/**
 * Solve a small linear ODE subset:
 *
 *   y'(x) + p(x)y(x) = q(x)
 *   ay''(x) + by'(x) + cy(x) = 0
 *
 * The returned expression is a `List` of `Equal` expressions for `y(x)`.
 * Unsupported equations return `undefined`, allowing the `DSolve` operator to
 * remain inert.
 */
export function dSolve(
  equation: Expression,
  dependent: Expression,
  independent: Expression
): Expression | undefined {
  const system = solveLinearHomogeneousSystem(equation, dependent, independent);
  if (system) return system;

  const names = expressionForDependent(dependent, independent);
  if (!names) return undefined;

  const { dependentName, independentName, dependentCall } = names;
  const ce = equation.engine;

  const higherOrder = solveHigherOrderHomogeneousConstantCoefficient(
    equation,
    dependentCall,
    dependentName,
    independentName
  );
  if (higherOrder) return higherOrder;

  const cauchyEuler = solveSecondOrderCauchyEulerHomogeneous(
    equation,
    dependentCall,
    dependentName,
    independentName
  );
  if (cauchyEuler) return cauchyEuler;

  const secondOrderNonhomogeneous =
    solveSecondOrderNonhomogeneousConstantCoefficient(
      equation,
      dependentCall,
      dependentName,
      independentName
    );
  if (secondOrderNonhomogeneous) return secondOrderNonhomogeneous;

  // Keep order 2 separate from the general constant-coefficient solver so
  // quadratic radical and complex roots stay exact when possible.
  const secondOrder = solveSecondOrderHomogeneousConstantCoefficient(
    equation,
    dependentCall,
    dependentName,
    independentName
  );
  if (secondOrder) return secondOrder;

  const coefficients = equationCoefficients(
    equation,
    dependentName,
    independentName
  );

  if (coefficients.derivative.isSame(0)) return undefined;
  // An `Error` node anywhere in the collected coefficients means the linear
  // split could not be trusted (e.g. a higher-order derivative term was
  // corrupted). Stay inert rather than "solving" garbage.
  if (
    hasOperator(coefficients.derivative, 'Error') ||
    hasOperator(coefficients.dependent, 'Error') ||
    hasOperator(coefficients.rest, 'Error')
  )
    return undefined;
  if (
    hasDependentOrDerivative(
      coefficients.derivative,
      dependentName,
      independentName
    ) ||
    hasDependentOrDerivative(
      coefficients.dependent,
      dependentName,
      independentName
    ) ||
    hasDependentOrDerivative(coefficients.rest, dependentName, independentName)
  )
    return undefined;

  const p = coefficients.dependent.div(coefficients.derivative).simplify();
  const q = coefficients.rest.neg().div(coefficients.derivative).simplify();

  // Forcing (or a variable coefficient) that references the dependent function
  // with a non-standard argument, e.g. `y'(x) = y(2x)`, is not a supported
  // linear ODE. `hasDependentOrDerivative` only matches the literal `y(x)`, so
  // guard the broader case here.
  if (
    referencesDependent(p, dependentName) ||
    referencesDependent(q, dependentName)
  )
    return undefined;

  const [c] = integrationConstants(equation, 1);

  let solution: Expression;
  if (p.isSame(0)) {
    const integral = dSolveAntiderivative(q, independentName);
    solution = c.add(integral).simplify();
  } else {
    const integralP = dSolveAntiderivative(p, independentName);
    const integratingFactor = ce.function('Exp', [integralP]).simplify();
    const weightedRhs = integratingFactor.mul(q).simplify();
    const integral = dSolveAntiderivative(weightedRhs, independentName);
    solution = c.add(integral).div(integratingFactor).simplify();
  }

  // A leftover, unresolved antiderivative that still references the dependent
  // function is not a real solution — mirror the second-order path and stay
  // inert.
  if (
    hasOperator(solution, 'Integrate') &&
    referencesDependent(solution, dependentName)
  )
    return undefined;

  return ce.function('List', [ce.function('Equal', [dependentCall, solution])]);
}
