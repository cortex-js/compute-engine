import type { Expression, IComputeEngine } from './global-types';
import { isFunction, isSymbol, sym } from './boxed-expression/type-guards';
import { rk4 } from './numerics/differential-equations';

export function symbolArg(
  engine: IComputeEngine,
  arg: Expression | undefined
): Expression {
  if (arg === undefined) return engine.error('missing');
  if (!isSymbol(arg)) return engine.typeError('symbol', arg.type, arg);
  return arg;
}

export function isDependentFunction(
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

export function isDerivativeOfDependent(
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
  if (!compiled.success) return undefined;
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
