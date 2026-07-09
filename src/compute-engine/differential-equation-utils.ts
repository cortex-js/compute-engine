import type { Expression, IComputeEngine } from './global-types.js';
import { isFunction, isSymbol, sym } from './boxed-expression/type-guards.js';
import { rk4, rk4System } from './numerics/differential-equations.js';

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
  return derivativeOrderOfDependent(expr, dependentName, independentName) === 1;
}

export function derivativeOrderOfDependent(
  expr: Expression,
  dependentName: string,
  independentName: string
): number | undefined {
  if (isFunction(expr, 'D')) {
    const variables = expr.ops.slice(1);
    if (
      variables.length === 0 ||
      !variables.every((op) => isSymbol(op, independentName))
    )
      return undefined;
    const innerOrder = derivativeOrderOfDependent(
      expr.op1,
      dependentName,
      independentName
    );
    if (innerOrder !== undefined) return innerOrder + variables.length;
    if (isDependentFunction(expr.op1, dependentName, independentName))
      return variables.length;
    return undefined;
  }

  if (isFunction(expr, 'Apply') && isFunction(expr.op1, 'Derivative')) {
    if (
      !isSymbol(expr.op1.op1, dependentName) ||
      expr.nops !== 2 ||
      !isSymbol(expr.op2, independentName)
    )
      return undefined;

    // `Derivative(y)` (no explicit order) has a single operand; a missing
    // second operand surfaces as the `Nothing` symbol, not `undefined`, so
    // testing `op2 === undefined` never fired and `Nothing.N().re` was `NaN`.
    // Default the order to 1 when the order operand is absent.
    const orderOp = expr.op1.op2;
    const order =
      orderOp === undefined || isSymbol(orderOp, 'Nothing')
        ? 1
        : orderOp.N().re;
    return Number.isInteger(order) && order > 0 ? order : undefined;
  }

  return undefined;
}

function explicitDerivativeRhs(
  equation: Expression,
  dependentName: string,
  independentName: string
): { order: number; rhs: Expression } | undefined {
  if (!isFunction(equation, 'Equal')) return undefined;
  const lhsOrder = derivativeOrderOfDependent(
    equation.op1,
    dependentName,
    independentName
  );
  if (lhsOrder !== undefined) return { order: lhsOrder, rhs: equation.op2 };
  const rhsOrder = derivativeOrderOfDependent(
    equation.op2,
    dependentName,
    independentName
  );
  if (rhsOrder !== undefined) return { order: rhsOrder, rhs: equation.op1 };
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

function substituteDependentState(
  expr: Expression,
  dependentName: string,
  independentName: string,
  stateNames: readonly string[]
): Expression {
  if (isDependentFunction(expr, dependentName, independentName))
    return expr.engine.symbol(stateNames[0]);

  const order = derivativeOrderOfDependent(
    expr,
    dependentName,
    independentName
  );
  if (order !== undefined && order < stateNames.length)
    return expr.engine.symbol(stateNames[order]);

  if (!isFunction(expr)) return expr;
  return expr.engine._fn(
    expr.operator,
    expr.ops.map((op) =>
      substituteDependentState(op, dependentName, independentName, stateNames)
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

  const [x0, x1] = [limits.op2.N().re, limits.op3.N().re];
  if (![x0, x1].every(Number.isFinite)) return undefined;

  const steps = stepsExpr === undefined ? 100 : stepsExpr.N().re;
  if (
    !Number.isInteger(steps) ||
    steps <= 0 ||
    steps > ce.iterationLimit ||
    steps + 1 > ce.maxCollectionSize
  )
    return undefined;

  const rhsInfo = explicitDerivativeRhs(
    equation.structural,
    dependentName,
    independentName
  );
  if (!rhsInfo) return undefined;

  const initialValues = isFunction(initialValue, 'List')
    ? initialValue.ops.map((op) => op.N().re)
    : [initialValue.N().re];
  if (
    rhsInfo.order !== initialValues.length ||
    !initialValues.every(Number.isFinite)
  )
    return undefined;

  if (rhsInfo.order > 1) {
    const stateNames = Array.from(
      { length: rhsInfo.order },
      (_, i) => `ndsolve${dependentName}state${i}`
    );
    const compiledRhs = substituteDependentState(
      rhsInfo.rhs,
      dependentName,
      independentName,
      stateNames
    );
    const compiled = ce._compile(compiledRhs, { realOnly: true });
    if (!compiled.success) return undefined;
    const run = compiled.run as (vars: Record<string, number>) => number;

    const samples = rk4System(
      (x, y) => {
        const vars: Record<string, number> = { [independentName]: x };
        stateNames.forEach((name, i) => {
          vars[name] = y[i];
        });
        const highest = run(vars);
        if (!Number.isFinite(highest)) return undefined;
        return [...y.slice(1), highest];
      },
      x0,
      initialValues,
      x1,
      { steps, deadline: ce._deadline }
    );
    if (!samples) return undefined;

    return ce._fn(
      'List',
      samples.map(([x, y]) => ce._fn('List', [ce.number(x), ce.number(y[0])]))
    );
  }

  const stateName = `ndsolve${dependentName}state`;
  const compiledRhs = substituteDependentCall(
    rhsInfo.rhs,
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
    initialValues[0],
    x1,
    { steps, deadline: ce._deadline }
  );
  if (!samples) return undefined;

  return ce._fn(
    'List',
    samples.map(([x, y]) => ce._fn('List', [ce.number(x), ce.number(y)]))
  );
}
