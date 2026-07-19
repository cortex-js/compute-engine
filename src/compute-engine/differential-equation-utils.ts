import type { Expression, IComputeEngine } from './global-types.js';
import { implicitCompile } from './implicit-compile.js';
import { isFunction, isSymbol, sym } from './boxed-expression/type-guards.js';
import {
  rk45System,
  rk45Sample,
  type RK45Solution,
} from './numerics/differential-equations.js';

/**
 * Integrate `y' = f(x, y)` adaptively (Dormand–Prince 5(4)) and sample the
 * dense-output interpolant on the uniform grid of `steps + 1` points over
 * `[x0, x1]` — the same output shape the former fixed-step RK4 produced, at
 * tolerance-controlled accuracy. Returns `undefined` (→ inert `NDSolve`)
 * when the integration fails (non-finite derivative, blow-up, step cap).
 */
function solveOnGrid(
  f: (x: number, y: readonly number[]) => readonly number[] | undefined,
  x0: number,
  y0: readonly number[],
  x1: number,
  steps: number,
  deadline?: number
): [x: number, y: readonly number[]][] | undefined {
  const solution: RK45Solution | undefined = rk45System(f, x0, y0, x1, {
    deadline,
  });
  if (!solution) return undefined;

  const samples: [number, readonly number[]][] = [];
  for (let i = 0; i < steps; i++) {
    const x = x0 + (i * (x1 - x0)) / steps;
    samples.push([x, rk45Sample(solution, x)]);
  }
  samples.push([x1, solution.y1]);
  return samples;
}

export function symbolArg(
  engine: IComputeEngine,
  arg: Expression | undefined
): Expression {
  if (arg === undefined) return engine.error('missing');
  if (!isSymbol(arg)) return engine.typeError('symbol', arg.type, arg);
  return arg;
}

export function symbolOrListArg(
  engine: IComputeEngine,
  arg: Expression | undefined
): Expression {
  if (arg === undefined) return engine.error('missing');
  if (isSymbol(arg)) return arg;
  if (isFunction(arg, 'List')) {
    const symbols = arg.ops.map((op) => symbolArg(engine, op));
    return engine._fn('List', symbols);
  }
  return engine.typeError('symbol', arg.type, arg);
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

export function explicitDerivativeRhs(
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

export function replaceDerivativeOfDependent(
  expr: Expression,
  dependentName: string,
  independentName: string,
  order: number,
  replacement: Expression
): Expression {
  const derivativeOrder = derivativeOrderOfDependent(
    expr,
    dependentName,
    independentName
  );
  if (derivativeOrder === order) return replacement;
  // A derivative of a different order must be left intact: recursing into its
  // operands would replace the lower-order derivative it is built from, e.g.
  // `D(D(y(x), x), x)` with order 1 would become `D(replacement, x)`.
  if (derivativeOrder !== undefined) return expr;
  if (!isFunction(expr)) return expr;
  return expr.engine._fn(
    expr.operator,
    expr.ops.map((op) =>
      replaceDerivativeOfDependent(
        op,
        dependentName,
        independentName,
        order,
        replacement
      )
    )
  );
}

function dependentNames(dependent: Expression): string[] | undefined {
  if (isSymbol(dependent)) return [dependent.symbol];
  if (!isFunction(dependent, 'List')) return undefined;
  const names = dependent.ops.map((op) => sym(op));
  if (names.some((name) => name === undefined)) return undefined;
  const result = names as string[];
  return new Set(result).size === result.length ? result : undefined;
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

function substituteSystemDependentCalls(
  expr: Expression,
  dependentNames: readonly string[],
  independentName: string,
  stateNames: readonly string[]
): Expression {
  for (let i = 0; i < dependentNames.length; i++) {
    if (isDependentFunction(expr, dependentNames[i], independentName))
      return expr.engine.symbol(stateNames[i]);
  }

  if (!isFunction(expr)) return expr;
  return expr.engine._fn(
    expr.operator,
    expr.ops.map((op) =>
      substituteSystemDependentCalls(
        op,
        dependentNames,
        independentName,
        stateNames
      )
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

/**
 * The compiled right-hand side and numeric problem data shared by the
 * `NDSolve` (sample-grid) and `NDSolveFunction` (interpolating-function)
 * evaluate paths. `vector` is true for the multi-dependent system form,
 * whose solution values are vectors; scalar forms (first-order and
 * higher-order reduced to a system) expose the solution as component 0.
 */
type PreparedODE = {
  f: (x: number, y: readonly number[]) => readonly number[] | undefined;
  x0: number;
  x1: number;
  y0: readonly number[];
  independentName: string;
  vector: boolean;
};

function prepareODE(
  equation: Expression,
  dependent: Expression,
  limits: Expression,
  initialValue: Expression
): PreparedODE | undefined {
  const ce = equation.engine;
  const names = dependentNames(dependent);
  if (!names) return undefined;

  if (!isFunction(limits, 'Limits')) return undefined;
  const independentName = sym(limits.op1);
  if (!independentName) return undefined;

  const [x0, x1] = [limits.op2.N().re, limits.op3.N().re];
  if (![x0, x1].every(Number.isFinite)) return undefined;

  if (names.length > 1 || isFunction(equation, 'List')) {
    if (
      names.length === 1 ||
      !isFunction(equation, 'List') ||
      !isFunction(initialValue, 'List') ||
      equation.ops.length !== names.length ||
      initialValue.ops.length !== names.length
    )
      return undefined;

    const initialValues = initialValue.ops.map((op) => op.N().re);
    if (!initialValues.every(Number.isFinite)) return undefined;

    const stateNames = names.map((name, i) => `ndsolve${name}state${i}`);
    if (stateNames.some((stateName) => equation.has(stateName)))
      return undefined;
    const runs: ((vars: Record<string, number>) => number)[] = [];

    for (let i = 0; i < equation.ops.length; i++) {
      const rhsInfo = explicitDerivativeRhs(
        equation.ops[i].structural,
        names[i],
        independentName
      );
      if (!rhsInfo || rhsInfo.order !== 1) return undefined;

      const compiledRhs = substituteSystemDependentCalls(
        rhsInfo.rhs,
        names,
        independentName,
        stateNames
      );
      const compiled = implicitCompile(ce, compiledRhs, { realOnly: true });
      if (!compiled?.success) return undefined;
      runs.push(compiled.run as (vars: Record<string, number>) => number);
    }

    return {
      f: (x, y) => {
        const vars: Record<string, number> = { [independentName]: x };
        stateNames.forEach((name, i) => {
          vars[name] = y[i];
        });
        const values = runs.map((run) => run(vars));
        return values.every(Number.isFinite) ? values : undefined;
      },
      x0,
      x1,
      y0: initialValues,
      independentName,
      vector: true,
    };
  }

  const dependentName = names[0];
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
    const compiled = implicitCompile(ce, compiledRhs, { realOnly: true });
    if (!compiled?.success) return undefined;
    const run = compiled.run as (vars: Record<string, number>) => number;

    return {
      f: (x, y) => {
        const vars: Record<string, number> = { [independentName]: x };
        stateNames.forEach((name, i) => {
          vars[name] = y[i];
        });
        const highest = run(vars);
        if (!Number.isFinite(highest)) return undefined;
        return [...y.slice(1), highest];
      },
      x0,
      x1,
      y0: initialValues,
      independentName,
      vector: false,
    };
  }

  const stateName = `ndsolve${dependentName}state`;
  const compiledRhs = substituteDependentCall(
    rhsInfo.rhs,
    dependentName,
    independentName,
    stateName
  );
  const compiled = implicitCompile(ce, compiledRhs, { realOnly: true });
  if (!compiled?.success) return undefined;
  const run = compiled.run as (vars: Record<string, number>) => number;

  return {
    f: (x, [y]) => {
      const v = run({ [independentName]: x, [stateName]: y });
      return Number.isFinite(v) ? [v] : undefined;
    },
    x0,
    x1,
    y0: [initialValues[0]],
    independentName,
    vector: false,
  };
}

export function nDSolve(
  equation: Expression,
  dependent: Expression,
  limits: Expression,
  initialValue: Expression,
  stepsExpr?: Expression
): Expression | undefined {
  const ce = equation.engine;

  const steps = stepsExpr === undefined ? 100 : stepsExpr.N().re;
  if (
    !Number.isInteger(steps) ||
    steps <= 0 ||
    steps > ce.iterationLimit ||
    steps + 1 > ce.maxCollectionSize
  )
    return undefined;

  const prepared = prepareODE(equation, dependent, limits, initialValue);
  if (!prepared) return undefined;
  const { f, x0, x1, y0, vector } = prepared;

  const samples = solveOnGrid(f, x0, y0, x1, steps, ce._deadline);
  if (!samples) return undefined;

  if (vector)
    return ce._fn(
      'List',
      samples.map(([x, y]) =>
        ce._fn('List', [
          ce.number(x),
          ce._fn(
            'List',
            y.map((yi) => ce.number(yi))
          ),
        ])
      )
    );

  return ce._fn(
    'List',
    samples.map(([x, y]) => ce._fn('List', [ce.number(x), ce.number(y[0])]))
  );
}

/**
 * `NDSolveFunction` evaluate path: solve the IVP adaptively and package the
 * scalar dense-output table as an applicable function literal
 * `Function(InterpolatingFunction(data, x), x)` — `data` is a `List` of
 * per-step rows `[x, h, r1, r2, r3, r4, r5]` (see `evalDenseRows`).
 *
 * Scalar forms only (first-order and higher-order scalar — the solution
 * component is the dependent value itself); the multi-dependent system form
 * stays inert (a vector-valued interpolating function would need a
 * result-shape decision).
 */
export function nDSolveFunction(
  equation: Expression,
  dependent: Expression,
  limits: Expression,
  initialValue: Expression
): Expression | undefined {
  const ce = equation.engine;

  const prepared = prepareODE(equation, dependent, limits, initialValue);
  if (!prepared || prepared.vector) return undefined;
  const { f, x0, x1, y0, independentName } = prepared;

  const solution = rk45System(f, x0, y0, x1, { deadline: ce._deadline });
  if (!solution || solution.steps.length === 0) return undefined;

  const data = ce._fn(
    'List',
    solution.steps.map((s) =>
      ce._fn('List', [
        ce.number(s.x),
        ce.number(s.h),
        ce.number(s.r1[0]),
        ce.number(s.r2[0]),
        ce.number(s.r3[0]),
        ce.number(s.r4[0]),
        ce.number(s.r5[0]),
      ])
    )
  );

  const param = ce.symbol(independentName);
  return ce.function('Function', [
    ce.function('InterpolatingFunction', [data, param]),
    param,
  ]);
}

/**
 * Extract the numeric per-step rows `[x, h, r1..r5]` from an
 * `InterpolatingFunction` data operand. Returns undefined for anything that
 * is not a `List` of 7-number `List` rows (the expression then stays
 * symbolic).
 */
export function interpolatingFunctionRows(
  data: Expression | undefined
): number[][] | undefined {
  if (!data || !isFunction(data, 'List') || data.nops === 0) return undefined;
  const rows: number[][] = [];
  for (const row of data.ops) {
    if (!isFunction(row, 'List') || row.nops !== 7) return undefined;
    const values = row.ops.map((op) => op.re);
    if (!values.every(Number.isFinite)) return undefined;
    rows.push(values);
  }
  return rows;
}
