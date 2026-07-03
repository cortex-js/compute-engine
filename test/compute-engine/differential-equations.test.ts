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
  const sample = { c_1: 2, x: 0.75 };
  const value = derivative
    .subs(sample)
    .sub(expected.structural.subs(sample))
    .simplify()
    .N().re;
  return Math.abs(value) < 1e-10;
}

function verifyEquationSolution(
  equation: unknown,
  solution: ReturnType<typeof dsolve>,
  sample: Record<string, number>
): boolean {
  const solutionEquation = solution.op1;
  const yValue = solutionEquation.op2;
  const maxOrder = maxDerivativeOrder(engine.expr(equation, { form: 'raw' }));
  const derivatives = [yValue];
  for (let i = 1; i <= maxOrder; i++)
    derivatives.push(engine.expr(['D', derivatives[i - 1], 'x']).evaluate());
  const equationExpr = engine.expr(equation, { form: 'raw' });
  let substituted = equationExpr;
  for (let order = maxOrder; order >= 1; order--) {
    let match: unknown = ['y', 'x'];
    for (let i = 0; i < order; i++) match = ['D', match, 'x'];
    substituted =
      substituted.replace(
        { match, replace: derivatives[order] },
        { recursive: true }
      ) ?? substituted;
    substituted =
      substituted.replace(
        {
          match: ['D', ['y', 'x'], ...Array(order).fill('x')],
          replace: derivatives[order],
        },
        { recursive: true }
      ) ?? substituted;
  }
  substituted =
    substituted.replace(
      { match: ['y', 'x'], replace: yValue },
      { recursive: true }
    ) ?? substituted;
  if (substituted.operator !== 'Equal') return false;

  const lhs = substituted.op1.evaluate().canonical;
  const rhs = substituted.op2.evaluate().canonical;
  const residual = lhs.sub(rhs).subs(sample).simplify();
  const value = residual.N().re;
  return Math.abs(value) < 1e-10;
}

function maxDerivativeOrder(expr: ReturnType<typeof engine.expr>): number {
  if (expr.operator === 'D') {
    let order = expr.ops.length - 1;
    let inner = expr.op1;
    while (inner.operator === 'D') {
      order += inner.ops.length - 1;
      inner = inner.op1;
    }
    return Math.max(order, maxDerivativeOrder(expr.op1));
  }

  return (expr.ops ?? []).reduce(
    (max, op) => Math.max(max, maxDerivativeOrder(op)),
    0
  );
}

describe('DSolve', () => {
  test('solves y prime equals y', () => {
    const solution = dsolve(['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']]);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x]`
    );
    expect(verifyFirstOrderSolution(solution, ['y', 'x'])).toBe(true);
  });

  test('solves y prime equals constant multiple of y', () => {
    const solution = dsolve([
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Multiply', 3, ['y', 'x']],
    ]);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" / e^(-3x)]`
    );
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
      `[y(x) === 1/3 * x^3 + "c_1"]`
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
      `[y(x) === x + "c_1" / e^x - 1]`
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

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" / e^(x^2)]`
    );
    expect(
      verifyFirstOrderSolution(solution, [
        'Negate',
        ['Multiply', 2, 'x', ['y', 'x']],
      ])
    ).toBe(true);
  });

  test('uses a fallback integration constant when c_1 is already declared', () => {
    engine.pushScope();
    try {
      engine.declare('c_1', 'real');
      const solution = dsolve(['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']]);

      expect(solution.toString()).toMatchInlineSnapshot(
        `[y(x) === "c_2" * e^x]`
      );
      expect(verifyFirstOrderSolution(solution, ['y', 'x'])).toBe(true);
    } finally {
      engine.popScope();
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

  test('solves second-order homogeneous equation with distinct real roots', () => {
    const result = dsolve([
      'Equal',
      ['D', ['D', ['y', 'x'], 'x'], 'x'],
      ['y', 'x'],
    ]);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x + "c_2" * e^(-x)]`
    );
    expect(
      verifyEquationSolution(
        ['Equal', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']],
        result,
        { c_1: 2, c_2: 3, x: 0.75 }
      )
    ).toBe(true);
  });

  test('solves flat-form second-order derivatives', () => {
    const equation = ['Equal', ['D', ['y', 'x'], 'x', 'x'], ['y', 'x']];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x + "c_2" * e^(-x)]`
    );
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('keeps irrational characteristic roots exact when possible', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['y', 'x'], 'x'], 'x'],
        ['Negate', ['D', ['y', 'x'], 'x']],
        ['Negate', ['y', 'x']],
      ],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^(1/2 * x * (1 + sqrt(5))) + "c_2" * e^(1/2 * x * (1 - sqrt(5)))]`
    );
    expect(
      verifyEquationSolution(equation, solution, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves second-order homogeneous equation with complex roots', () => {
    const equation = [
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * cos(x) + "c_2" * sin(x)]`
    );
    expect(
      verifyEquationSolution(equation, solution, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves second-order homogeneous equation with a repeated root', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['y', 'x'], 'x'], 'x'],
        ['Negate', ['Multiply', 2, ['D', ['y', 'x'], 'x']]],
        ['y', 'x'],
      ],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_2" * x * e^x + "c_1" * e^x]`
    );
    expect(
      verifyEquationSolution(equation, solution, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves second-order homogeneous equation with zero repeated root', () => {
    const equation = ['Equal', ['D', ['D', ['y', 'x'], 'x'], 'x'], 0];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_2" * x + "c_1"]`
    );
    expect(
      verifyEquationSolution(equation, solution, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves third-order homogeneous equation with real roots', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'],
        ['Negate', ['Multiply', 6, ['D', ['D', ['y', 'x'], 'x'], 'x']]],
        ['Multiply', 11, ['D', ['y', 'x'], 'x']],
        ['Negate', ['Multiply', 6, ['y', 'x']]],
      ],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x + "c_2" * e^(2x) + "c_3" * e^(3x)]`
    );
    expect(
      verifyEquationSolution(equation, solution, {
        c_1: 2,
        c_2: 3,
        c_3: 5,
        x: 0.25,
      })
    ).toBe(true);
  });

  test('solves third-order homogeneous equation with repeated root', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'],
        ['Negate', ['Multiply', 3, ['D', ['D', ['y', 'x'], 'x'], 'x']]],
        ['Multiply', 3, ['D', ['y', 'x'], 'x']],
        ['Negate', ['y', 'x']],
      ],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_3" * x^2 * e^x + "c_2" * x * e^x + "c_1" * e^x]`
    );
    expect(
      verifyEquationSolution(equation, solution, {
        c_1: 2,
        c_2: 3,
        c_3: 5,
        x: 0.25,
      })
    ).toBe(true);
  });

  test('solves third-order homogeneous equation with numeric complex roots', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'],
        ['Negate', ['y', 'x']],
      ],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x + "c_2" * cos(0.8660254037844387 * x) * e^(-0.5 * x) + "c_3" * sin(0.8660254037844387 * x) * e^(-0.5 * x)]`
    );
    expect(
      verifyEquationSolution(equation, solution, {
        c_1: 2,
        c_2: 3,
        c_3: 5,
        x: 0.25,
      })
    ).toBe(true);
  });

  test('solves nonhomogeneous second-order constant coefficient equation', () => {
    const equation = [
      'Equal',
      ['D', ['D', ['y', 'x'], 'x'], 'x'],
      1,
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === 1/2 * x^2 + "c_2" * x + "c_1"]`
    );
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves polynomial-forced second-order constant coefficient equation', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['y', 'x'], 'x'], 'x'],
        ['Negate', ['y', 'x']],
      ],
      'x',
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === -x + "c_1" * e^x + "c_2" * e^(-x)]`
    );
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves tangent-forced second-order constant coefficient equation', () => {
    const equation = [
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']],
      ['Tan', 'x'],
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * cos(x) + "c_2" * sin(x) - cos(x) * ln(|tan(x) + sec(x)|)]`
    );
    expect(result.operator).toBe('List');
  });

  test('solves Cauchy-Euler equation with distinct roots', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['Multiply', ['Power', 'x', 2], ['D', ['D', ['y', 'x'], 'x'], 'x']],
        ['Negate', ['Multiply', 2, ['y', 'x']]],
      ],
      0,
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * x^2 + "c_2" / x]`
    );
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 2 })
    ).toBe(true);
  });

  test('solves Cauchy-Euler equation with repeated roots', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['Multiply', ['Power', 'x', 2], ['D', ['D', ['y', 'x'], 'x'], 'x']],
        ['Multiply', 'x', ['D', ['y', 'x'], 'x']],
      ],
      0,
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" + "c_2" * ln(x)]`
    );
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 2 })
    ).toBe(true);
  });

  test('solves Cauchy-Euler equation with complex roots', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['Multiply', ['Power', 'x', 2], ['D', ['D', ['y', 'x'], 'x'], 'x']],
        ['Multiply', 'x', ['D', ['y', 'x'], 'x']],
        ['y', 'x'],
      ],
      0,
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * cos(ln(x)) + "c_2" * sin(ln(x))]`
    );
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 2 })
    ).toBe(true);
  });

  test('stays inert when variation of parameters cannot integrate', () => {
    const result = dsolve([
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']],
      ['Divide', 1, 'x'],
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

  test('solves second-order IVP with RK4 system samples', () => {
    const result = ndsolve(
      ['Equal', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['Negate', ['y', 'x']]],
      ['List', 0, 1],
      200
    );
    const [, y] = finalSample(result);

    expect(result.operator).toBe('List');
    expect(y).toBeCloseTo(Math.sin(1), 10);
  });

  test('solves third-order IVP with RK4 system samples', () => {
    const result = ndsolve(
      ['Equal', ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'], ['y', 'x']],
      ['List', 1, 1, 1],
      200
    );
    const [, y] = finalSample(result);

    expect(result.operator).toBe('List');
    expect(y).toBeCloseTo(Math.E, 10);
  });

  test('stays inert when higher-order IVP initial values have wrong length', () => {
    const result = ndsolve(
      ['Equal', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['Negate', ['y', 'x']]],
      ['List', 0],
      200
    );

    expect(result.operator).toBe('NDSolve');
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
