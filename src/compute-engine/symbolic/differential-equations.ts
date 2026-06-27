import { antiderivative } from './antiderivative';
import type { Expression } from '../global-types';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards';

interface LinearTermCoefficients {
  derivative: Expression;
  dependent: Expression;
  rest: Expression;
}

function functionName(expr: Expression): string | undefined {
  if (!isFunction(expr)) return undefined;
  return expr.operator;
}

function isDependentFunction(
  expr: Expression,
  dependentName: string,
  independentName: string
): boolean {
  return (
    isFunction(expr) &&
    expr.operator === dependentName &&
    expr.nops === 1 &&
    isSymbol(expr.op1, independentName)
  );
}

function isDerivativeOfDependent(
  expr: Expression,
  dependentName: string,
  independentName: string
): boolean {
  if (isFunction(expr, 'D')) {
    return (
      isDependentFunction(expr.op1, dependentName, independentName) &&
      isSymbol(expr.op2, independentName)
    );
  }

  if (isFunction(expr, 'Apply') && isFunction(expr.op1, 'Derivative')) {
    const derivativeTarget = expr.op1.op1;
    return (
      isSymbol(derivativeTarget, dependentName) &&
      expr.nops === 2 &&
      isSymbol(expr.op2, independentName)
    );
  }

  return false;
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
  if (isDerivativeOfDependent(expr, dependentName, independentName))
    return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) =>
    hasDependentOrDerivative(op, dependentName, independentName)
  );
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
  let rest = ce.Zero;

  for (const term of terms) {
    const split = splitTerm(term, dependentName, independentName);
    if (split.kind === 'derivative')
      derivative = derivative.add(split.coefficient);
    else if (split.kind === 'dependent')
      dependent = dependent.add(split.coefficient);
    else rest = rest.add(split.coefficient);
  }

  return { derivative, dependent, rest };
}

function negateCoefficients(
  coefficients: LinearTermCoefficients
): LinearTermCoefficients {
  return {
    derivative: coefficients.derivative.neg(),
    dependent: coefficients.dependent.neg(),
    rest: coefficients.rest.neg(),
  };
}

function equationCoefficients(
  equation: Expression,
  dependentName: string,
  independentName: string
): LinearTermCoefficients {
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
  const rhs = negateCoefficients(
    collectLinearTerms(equation.op2.structural, dependentName, independentName)
  );

  return {
    derivative: lhs.derivative.add(rhs.derivative),
    dependent: lhs.dependent.add(rhs.dependent),
    rest: lhs.rest.add(rhs.rest),
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

/**
 * Solve a small first-order linear ODE subset:
 *
 *   y'(x) + p(x)y(x) = q(x)
 *
 * The returned expression is an `Equal` expression for `y(x)`. Unsupported
 * equations return `undefined`, allowing the `DSolve` operator to remain inert.
 */
export function dSolve(
  equation: Expression,
  dependent: Expression,
  independent: Expression
): Expression | undefined {
  const names = expressionForDependent(dependent, independent);
  if (!names) return undefined;

  const { dependentName, independentName, dependentCall } = names;
  const ce = equation.engine;

  const coefficients = equationCoefficients(
    equation,
    dependentName,
    independentName
  );

  if (coefficients.derivative.isSame(0)) return undefined;
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
  const c = ce.symbol('C');

  let solution: Expression;
  if (p.isSame(0)) {
    const integral = antiderivative(q, independentName);
    solution = c.add(integral).simplify();
  } else {
    const integralP = antiderivative(p, independentName);
    const integratingFactor = ce.function('Exp', [integralP]).simplify();
    const weightedRhs = integratingFactor.mul(q).simplify();
    const integral = antiderivative(weightedRhs, independentName);
    solution = c.add(integral).div(integratingFactor).simplify();
  }

  return ce.function('Equal', [dependentCall, solution]);
}
