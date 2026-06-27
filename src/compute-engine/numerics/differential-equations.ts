import { checkDeadline } from '../../common/interruptible';
import type { Expression } from '../global-types';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards';

export type RK4Options = {
  steps: number;
  deadline?: number;
};

export type ODESample = readonly [x: number, y: number];

/**
 * Fixed-step classical fourth-order Runge-Kutta solver for scalar explicit
 * initial value problems: y' = f(x, y), y(x0) = y0.
 */
export function rk4(
  f: (x: number, y: number) => number,
  x0: number,
  y0: number,
  x1: number,
  options: RK4Options
): ODESample[] | undefined {
  const steps = Math.trunc(options.steps);
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    !Number.isFinite(x1) ||
    !Number.isInteger(steps) ||
    steps <= 0
  )
    return undefined;

  const h = (x1 - x0) / steps;
  const samples: ODESample[] = [[x0, y0]];
  let x = x0;
  let y = y0;

  for (let i = 0; i < steps; i++) {
    if ((i & 0xff) === 0) checkDeadline(options.deadline);

    const k1 = f(x, y);
    const k2 = f(x + h / 2, y + (h * k1) / 2);
    const k3 = f(x + h / 2, y + (h * k2) / 2);
    const k4 = f(x + h, y + h * k3);
    if (![k1, k2, k3, k4].every(Number.isFinite)) return undefined;

    y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    x = i === steps - 1 ? x1 : x + h;
    if (!Number.isFinite(y)) return undefined;
    samples.push([x, y]);
  }

  return samples;
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
    return (
      isSymbol(expr.op1.op1, dependentName) &&
      expr.nops === 2 &&
      isSymbol(expr.op2, independentName)
    );
  }

  return false;
}

function explicitRhs(
  equation: Expression,
  dependentName: string,
  independentName: string
): Expression | undefined {
  if (!isFunction(equation, 'Equal')) return undefined;
  if (isDerivativeOfDependent(equation.op1, dependentName, independentName))
    return equation.op2;
  if (isDerivativeOfDependent(equation.op2, dependentName, independentName))
    return equation.op1;
  return undefined;
}

function substituteDependentCall(
  expr: Expression,
  dependentName: string,
  independentName: string,
  stateName: string
): Expression {
  if (isDependentFunction(expr, dependentName, independentName))
    return expr.engine.symbol(stateName);
  if (!isFunction(expr)) return expr;
  return expr.engine._fn(
    expr.operator,
    expr.ops.map((op) =>
      substituteDependentCall(op, dependentName, independentName, stateName)
    )
  );
}

export function nDSolve(
  equation: Expression,
  dependent: Expression,
  limits: Expression,
  initialValue: Expression,
  stepsExpr?: Expression
): Expression | undefined {
  const ce = equation.engine;
  const dependentName = sym(dependent);
  if (!dependentName) return undefined;

  if (!isFunction(limits, 'Limits')) return undefined;
  const independentName = sym(limits.op1);
  if (!independentName) return undefined;

  const [x0, x1, y0] = [
    limits.op2.N().re,
    limits.op3.N().re,
    initialValue.N().re,
  ];
  if (![x0, x1, y0].every(Number.isFinite)) return undefined;

  const steps = stepsExpr === undefined ? 100 : stepsExpr.N().re;
  if (
    !Number.isInteger(steps) ||
    steps <= 0 ||
    steps > ce.iterationLimit ||
    steps + 1 > ce.maxCollectionSize
  )
    return undefined;

  const rhs = explicitRhs(equation.structural, dependentName, independentName);
  if (!rhs) return undefined;

  const stateName = `ndsolve${dependentName}state`;
  const compiledRhs = substituteDependentCall(
    rhs,
    dependentName,
    independentName,
    stateName
  );
  const compiled = ce._compile(compiledRhs, { realOnly: true });
  const run = compiled.run as (vars: Record<string, number>) => number;

  const samples = rk4(
    (x, y) => run({ [independentName]: x, [stateName]: y }),
    x0,
    y0,
    x1,
    { steps, deadline: ce._deadline }
  );
  if (!samples) return undefined;

  return ce._fn(
    'List',
    samples.map(([x, y]) => ce._fn('List', [ce.number(x), ce.number(y)]))
  );
}
