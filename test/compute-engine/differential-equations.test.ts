import { engine } from '../utils';

function dsolve(equation: unknown, dependent = 'y', independent = 'x') {
  return engine.expr(['DSolve', equation, dependent, independent]).evaluate();
}

function ndsolve(
  equation: unknown,
  initialValue: unknown,
  steps = 100,
  dependent = 'y',
  independent = 'x',
  lower = 0,
  upper = 1,
  limits: unknown = ['Limits', independent, lower, upper]
) {
  return engine
    .expr(['NDSolve', equation, dependent, limits, initialValue, steps])
    .evaluate();
}

function finalSample(result: ReturnType<typeof ndsolve>): [number, number] {
  const sample = result.ops[result.ops.length - 1];
  return [sample.op1.N().re, sample.op2.N().re];
}

function verifyFirstOrderSolution(
  solution: ReturnType<typeof dsolve>,
  rhs: unknown
): boolean {
  const solutionEquation = solution.op1;
  const yValue = solutionEquation.op2;
  const derivative = engine
    .expr(['D', yValue, 'x'])
    .evaluate()
    .simplify().structural;
  const expectedTemplate = engine.expr(rhs, { form: 'raw' });
  const expected =
    expectedTemplate.replace(
      { match: ['y', 'x'], replace: yValue },
      { recursive: true }
    ) ?? expectedTemplate;
  const sample = { C: 2, x: 0.75 };
  const value = derivative
    .subs(sample)
    .sub(expected.structural.subs(sample))
    .simplify()
    .N().re;
  return Math.abs(value) < 1e-10;
}

describe('DSolve', () => {
  test('solves y prime equals y', () => {
    const solution = dsolve(['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']]);

    expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === C * e^x]`);
    expect(verifyFirstOrderSolution(solution, ['y', 'x'])).toBe(true);
  });

  test('solves y prime equals constant multiple of y', () => {
    const solution = dsolve([
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Multiply', 3, ['y', 'x']],
    ]);

    expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === C / e^(-3x)]`);
    expect(
      verifyFirstOrderSolution(solution, ['Multiply', 3, ['y', 'x']])
    ).toBe(true);
  });

  test('solves y prime equals x squared', () => {
    const solution = dsolve([
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Power', 'x', 2],
    ]);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === 1/3 * x^3 + C]`
    );
    expect(verifyFirstOrderSolution(solution, ['Power', 'x', 2])).toBe(true);
  });

  test('solves first-order linear equation', () => {
    const solution = dsolve([
      'Equal',
      ['Add', ['D', ['y', 'x'], 'x'], ['y', 'x']],
      'x',
    ]);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === x + C / e^x - 1]`
    );
    expect(
      verifyFirstOrderSolution(solution, ['Subtract', 'x', ['y', 'x']])
    ).toBe(true);
  });

  test('solves first-order homogeneous linear equation with variable coefficient', () => {
    const solution = dsolve([
      'Equal',
      ['Add', ['D', ['y', 'x'], 'x'], ['Multiply', 2, 'x', ['y', 'x']]],
      0,
    ]);

    expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === C / e^(x^2)]`);
    expect(
      verifyFirstOrderSolution(solution, [
        'Negate',
        ['Multiply', 2, 'x', ['y', 'x']],
      ])
    ).toBe(true);
  });

  test('uses a fallback integration constant when C is already declared', () => {
    engine.declare('C', 'real');
    try {
      const solution = dsolve(['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']]);

      expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === c * e^x]`);
      expect(verifyFirstOrderSolution(solution, ['y', 'x'])).toBe(true);
    } finally {
      engine.forget('C');
    }
  });

  test('stays inert for unsupported nonlinear first-order equations', () => {
    const result = dsolve([
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Power', ['y', 'x'], 2],
    ]);

    expect(result.operator).toBe('DSolve');
  });

  test('stays inert for unsupported higher-order equations', () => {
    const result = dsolve([
      'Equal',
      ['D', ['D', ['y', 'x'], 'x'], 'x'],
      ['y', 'x'],
    ]);

    expect(result.operator).toBe('DSolve');
  });
});

describe('NDSolve', () => {
  test('solves y prime equals y with RK4 samples', () => {
    const result = ndsolve(['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']], 1);
    const [x, y] = finalSample(result);
    const expected = engine.expr(['Exp', 1]).N().re;

    expect(result.operator).toBe('List');
    expect(result.ops.length).toBe(101);
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(expected, 8);
  });

  test('accepts tuple limits', () => {
    const result = ndsolve(
      ['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']],
      1,
      100,
      'y',
      'x',
      0,
      1,
      ['Tuple', 'x', 0, 1]
    );
    const [x, y] = finalSample(result);
    const expected = engine.expr(['Exp', 1]).N().re;

    expect(result.operator).toBe('List');
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(expected, 8);
  });

  test('solves variable coefficient first-order IVP with RK4 samples', () => {
    const result = ndsolve(
      [
        'Equal',
        ['D', ['y', 'x'], 'x'],
        ['Negate', ['Multiply', 2, 'x', ['y', 'x']]],
      ],
      1
    );
    const [, y] = finalSample(result);
    const expected = engine.expr(['Exp', -1]).N().re;

    expect(y).toBeCloseTo(expected, 8);
  });

  test('solves inhomogeneous polynomial IVP with RK4 samples', () => {
    const result = ndsolve(
      ['Equal', ['D', ['y', 'x'], 'x'], ['Power', 'x', 2]],
      0
    );
    const [, y] = finalSample(result);

    expect(y).toBeCloseTo(1 / 3, 12);
  });

  test('solves IVP with non-elementary antiderivative using RK4 samples', () => {
    const result = ndsolve(
      ['Equal', ['D', ['y', 'x'], 'x'], ['Exp', ['Negate', ['Power', 'x', 2]]]],
      0,
      400
    );
    const [, y] = finalSample(result);
    const expected = engine
      .expr(['Multiply', ['Divide', ['Sqrt', 'Pi'], 2], ['Erf', 1]])
      .N().re;

    expect(y).toBeCloseTo(expected, 10);
  });

  test('stays inert for unsupported implicit equations', () => {
    const result = ndsolve(
      ['Equal', ['Add', ['D', ['y', 'x'], 'x'], ['y', 'x']], 'x'],
      1
    );

    expect(result.operator).toBe('NDSolve');
  });

  test('stays inert when requested steps exceed the iteration limit', () => {
    const savedLimit = engine.iterationLimit;
    engine.iterationLimit = 10;
    try {
      const result = ndsolve(
        ['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']],
        1,
        11
      );

      expect(result.operator).toBe('NDSolve');
    } finally {
      engine.iterationLimit = savedLimit;
    }
  });
});
