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

function finalSystemSample(
  result: ReturnType<typeof ndsolve>
): [number, number[]] {
  const sample = result.ops[result.ops.length - 1];
  return [sample.op1.N().re, sample.op2.ops.map((op) => op.N().re)];
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

function verifySystemSolution(
  equations: unknown[],
  solution: ReturnType<typeof dsolve>,
  sample: Record<string, number>
): boolean {
  for (const equation of equations) {
    let substituted = engine.expr(equation, { form: 'raw' });
    for (const solutionEquation of solution.ops) {
      const dependentName = solutionEquation.op1.operator;
      const value = solutionEquation.op2;
      const derivative = engine.expr(['D', value, 'x']).evaluate();
      const dependentCall = [dependentName, 'x'];
      substituted =
        substituted.replace(
          { match: ['D', dependentCall, 'x'], replace: derivative },
          { recursive: true }
        ) ?? substituted;
      substituted =
        substituted.replace(
          { match: dependentCall, replace: value },
          { recursive: true }
        ) ?? substituted;
    }
    if (substituted.operator !== 'Equal') return false;

    const residual = substituted.op1
      .evaluate()
      .sub(substituted.op2.evaluate())
      .subs(sample)
      .simplify();
    if (Math.abs(residual.N().re) >= 1e-10) return false;
  }
  return true;
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

    expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === "c_1" * e^x]`);
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

  test('solves diagonal first-order linear systems', () => {
    const equations = [
      ['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']],
      ['Equal', ['D', ['z', 'x'], 'x'], ['Multiply', 2, ['z', 'x']]],
    ];
    const solution = dsolve(['List', ...equations], ['List', 'y', 'z']);

    expect(solution.operator).toBe('List');
    expect(solution.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x,z(x) === "c_2" * e^(2x)]`
    );
    expect(
      verifySystemSolution(equations, solution, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves coupled first-order linear systems', () => {
    const equations = [
      ['Equal', ['D', ['y', 'x'], 'x'], ['z', 'x']],
      ['Equal', ['D', ['z', 'x'], 'x'], ['y', 'x']],
    ];
    const solution = dsolve(['List', ...equations], ['List', 'y', 'z']);

    expect(solution.operator).toBe('List');
    expect(
      verifySystemSolution(equations, solution, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('stays inert for first-order linear systems with repeated eigenvalues', () => {
    const result = dsolve(
      [
        'List',
        ['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']],
        ['Equal', ['D', ['z', 'x'], 'x'], ['z', 'x']],
      ],
      ['List', 'y', 'z']
    );

    expect(result.operator).toBe('DSolve');
  });

  test('solves separable nonlinear first-order equations implicitly', () => {
    const equation = [
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Divide', 'x', ['y', 'x']],
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[1/2 * "y_value"^2 === 1/2 * x^2 + "c_1"]`
    );
  });

  test('applies initial conditions to separable implicit solutions', () => {
    const equation = [
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Divide', 'x', ['y', 'x']],
    ];
    const solution = dsolve(['List', equation, ['Equal', ['y', 0], 1]]);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[1/2 * "y_value"^2 === 1/2 * x^2 + 1/2]`
    );
  });

  test('solves first-order homogeneous equations by substitution', () => {
    const equation = [
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Add', 1, ['Divide', ['y', 'x'], 'x']],
    ];
    const solution = dsolve(equation);

    expect(solution.toString()).toMatchInlineSnapshot(
      `["y_value" / x === "c_1" + ln(x)]`
    );
  });

  test('solves Bernoulli first-order equations', () => {
    const equation = [
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Add', ['y', 'x'], ['Multiply', 'x', ['Power', ['y', 'x'], 2]]],
    ];
    const solution = dsolve(equation);

    expect(solution.operator).toBe('List');
    expect(
      verifyEquationSolution(equation, solution, { c_1: 2, x: 0.75 })
    ).toBe(true);
  });

  test('applies initial conditions to first-order equations', () => {
    const equation = ['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']];
    const solution = dsolve(['List', equation, ['Equal', ['y', 0], 2]]);

    expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === 2e^x]`);
    expect(verifyEquationSolution(equation, solution, { x: 0.75 })).toBe(true);
  });

  test('stays inert for unsupported nonlinear first-order equations', () => {
    const result = dsolve([
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Add', 'x', ['Power', ['y', 'x'], 2]],
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

  test('applies initial conditions to second-order equations', () => {
    const equation = [
      'Equal',
      ['D', ['D', ['y', 'x'], 'x'], 'x'],
      ['Negate', ['y', 'x']],
    ];
    const solution = dsolve([
      'List',
      equation,
      ['Equal', ['y', 0], 0],
      ['Equal', ['Apply', ['Derivative', 'y', 1], 0], 1],
    ]);

    expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === sin(x)]`);
    expect(verifyEquationSolution(equation, solution, { x: 0.75 })).toBe(true);
  });

  test('applies flat derivative-form initial conditions', () => {
    const equation = [
      'Equal',
      ['D', ['D', ['y', 'x'], 'x'], 'x'],
      ['Negate', ['y', 'x']],
    ];
    const solution = dsolve([
      'List',
      equation,
      ['Equal', ['y', 0], 0],
      ['Equal', ['D', ['y', 0], 'x'], 1],
    ]);

    expect(solution.toString()).toMatchInlineSnapshot(`[y(x) === sin(x)]`);
    expect(verifyEquationSolution(equation, solution, { x: 0.75 })).toBe(true);
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
    const equation = ['Equal', ['D', ['D', ['y', 'x'], 'x'], 'x'], 1];
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
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['Negate', ['y', 'x']]],
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

  test('solves resonant exponential-forced second-order equation', () => {
    const equation = [
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['Negate', ['y', 'x']]],
      ['Exp', 'x'],
    ];
    const result = dsolve(equation);

    expect(result.operator).toBe('List');
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves resonant sinusoidal-forced second-order equation', () => {
    const equation = [
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']],
      ['Sin', 'x'],
    ];
    const result = dsolve(equation);

    expect(result.operator).toBe('List');
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves exponential-forced higher-order constant coefficient equation', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'],
        ['Negate', ['y', 'x']],
      ],
      ['Exp', 'x'],
    ];
    const result = dsolve(equation);

    expect(result.operator).toBe('List');
    expect(
      verifyEquationSolution(equation, result, {
        c_1: 2,
        c_2: 3,
        c_3: 5,
        x: 0.25,
      })
    ).toBe(true);
  });

  test('solves sinusoidal-forced higher-order constant coefficient equation', () => {
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'],
        ['Negate', ['y', 'x']],
      ],
      ['Sin', 'x'],
    ];
    const result = dsolve(equation);

    expect(result.operator).toBe('List');
    expect(
      verifyEquationSolution(equation, result, {
        c_1: 2,
        c_2: 3,
        c_3: 5,
        x: 0.25,
      })
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

  // Regression: numeric-root fallback must cluster coincident Durand-Kerner
  // roots by multiplicity instead of emitting numerically-dependent modes.
  function solutionRhsTerms(solution: ReturnType<typeof dsolve>) {
    const rhs = solution.op1.op2;
    return rhs.operator === 'Add' ? [...rhs.ops] : [rhs];
  }

  function termHasFactors(
    term: ReturnType<typeof dsolve>,
    predicates: Array<(f: ReturnType<typeof dsolve>) => boolean>
  ): boolean {
    const factors = term.operator === 'Multiply' ? [...term.ops] : [term];
    return predicates.every((p) => factors.some((f) => p(f)));
  }

  function hasNoErrorNode(expr: ReturnType<typeof dsolve>): boolean {
    if (expr.operator === 'Error') return false;
    return (expr.ops ?? []).every(hasNoErrorNode);
  }

  const isX = (f: ReturnType<typeof dsolve>) => f.symbol === 'x';
  const isCos = (f: ReturnType<typeof dsolve>) => f.operator === 'Cos';
  const isExp = (f: ReturnType<typeof dsolve>) => f.operator === 'Power';

  test('solves fourth-order equation with a repeated complex-conjugate root', () => {
    // y'''' + 2y'' + y = 0, characteristic (r^2 + 1)^2, roots +/-i (double).
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'], 'x'],
        ['Multiply', 2, ['D', ['D', ['y', 'x'], 'x'], 'x']],
        ['y', 'x'],
      ],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.operator).toBe('List');
    const terms = solutionRhsTerms(solution);
    // Four independent modes: cos x, sin x, x cos x, x sin x.
    expect(terms.length).toBe(4);
    // The repeated-root modes x*cos(x) and x*sin(x) must be present, and no
    // spurious e^(3.8e-9 x) noise factors (checked via numeric verification).
    expect(terms.some((t) => termHasFactors(t, [isX, isCos]))).toBe(true);
    expect(
      verifyEquationSolution(equation, solution, {
        c_1: 2,
        c_2: 3,
        c_3: 5,
        c_4: 7,
        x: 0.6,
      })
    ).toBe(true);
  });

  test('solves fourth-order equation with a repeated real root and a complex pair', () => {
    // y'''' - 2y''' + 2y'' - 2y' + y = 0, characteristic (r-1)^2 (r^2 + 1).
    const equation = [
      'Equal',
      [
        'Add',
        ['D', ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x'], 'x'],
        [
          'Negate',
          ['Multiply', 2, ['D', ['D', ['D', ['y', 'x'], 'x'], 'x'], 'x']],
        ],
        ['Multiply', 2, ['D', ['D', ['y', 'x'], 'x'], 'x']],
        ['Negate', ['Multiply', 2, ['D', ['y', 'x'], 'x']]],
        ['y', 'x'],
      ],
      0,
    ];
    const solution = dsolve(equation);

    expect(solution.operator).toBe('List');
    const terms = solutionRhsTerms(solution);
    // Four independent modes: e^x, x e^x, cos x, sin x.
    expect(terms.length).toBe(4);
    // The repeated real-root mode x*e^x must be present.
    expect(terms.some((t) => termHasFactors(t, [isX, isExp]))).toBe(true);
    expect(
      verifyEquationSolution(equation, solution, {
        c_1: 2,
        c_2: 3,
        c_3: 5,
        c_4: 7,
        x: 0.6,
      })
    ).toBe(true);
  });

  test('stays inert (no Error node) for nonhomogeneous Cauchy-Euler equation', () => {
    // x^2 y'' + x y' = x. Previously produced a corrupted Error-node "solution".
    const result = dsolve([
      'Equal',
      [
        'Add',
        ['Multiply', ['Power', 'x', 2], ['D', ['D', ['y', 'x'], 'x'], 'x']],
        ['Multiply', 'x', ['D', ['y', 'x'], 'x']],
      ],
      'x',
    ]);

    // Either inert, or a valid solution - but never an Error-bearing result.
    expect(hasNoErrorNode(result)).toBe(true);
    expect(result.operator).toBe('DSolve');
  });

  test('stays inert (no Error node) for variable-coefficient second-order equation', () => {
    // sin(x) y'' + y' = cos(x).
    const result = dsolve([
      'Equal',
      [
        'Add',
        ['Multiply', ['Sin', 'x'], ['D', ['D', ['y', 'x'], 'x'], 'x']],
        ['D', ['y', 'x'], 'x'],
      ],
      ['Cos', 'x'],
    ]);

    expect(hasNoErrorNode(result)).toBe(true);
    expect(result.operator).toBe('DSolve');
  });

  test('stays inert for forcing that references the dependent function', () => {
    // y'(x) = y(2x): not a supported linear ODE, must not return an unevaluated
    // integral as a "solution".
    const result = dsolve([
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['y', ['Multiply', 2, 'x']],
    ]);

    expect(result.operator).toBe('DSolve');
  });

  test('still solves first-order equation with non-elementary antiderivative (Erf)', () => {
    const solution = dsolve([
      'Equal',
      ['D', ['y', 'x'], 'x'],
      ['Exp', ['Negate', ['Power', 'x', 2]]],
    ]);

    expect(solution.operator).toBe('List');
    expect(solution.toString()).toContain('Erf');
  });

  //
  // Variation of parameters with exponential forcing (regression: the
  // Wronskian for {e^x, e^-x} was left as `-2 e^(x-x)` instead of `-2`,
  // silently disabling variation of parameters; a later polish folded
  // leftover `e^a·e^b` products such as `e^(-x)·e^(2x)` in the output).
  //

  // No `Multiply` in the tree may contain two or more exponential
  // (`Power(ExponentialE, …)`) factors: they must be folded to a single
  // `e^(a+b)`.
  function hasUnfoldedExpProduct(expr: ReturnType<typeof dsolve>): boolean {
    if (expr.operator === 'Multiply') {
      const expFactors = expr.ops.filter(
        (op) => op.operator === 'Power' && op.op1?.symbol === 'ExponentialE'
      ).length;
      if (expFactors >= 2) return true;
    }
    return (expr.ops ?? []).some(hasUnfoldedExpProduct);
  }

  // No `Add` in the tree may contain an uncollected Pythagorean pair
  // `A·sin²(u) + A·cos²(u)` (same coefficient, same argument): variation of
  // parameters with a trig basis produces this shape and it must have been
  // collected to `A`.
  function hasPythagoreanPair(expr: ReturnType<typeof dsolve>): boolean {
    type Expr = ReturnType<typeof dsolve>;
    const trigSquare = (x: Expr) =>
      x.operator === 'Power' &&
      x.op2?.isSame(2) &&
      (x.op1?.operator === 'Sin' || x.op1?.operator === 'Cos')
        ? { kind: x.op1.operator, arg: x.op1.op1 }
        : undefined;
    const split = (
      t: Expr
    ): { kind: string; arg: Expr; coef: Expr } | undefined => {
      const direct = trigSquare(t);
      if (direct) return { ...direct, coef: engine.One };
      if (t.operator === 'Negate') {
        const inner = split(t.op1);
        return inner ? { ...inner, coef: inner.coef.neg() } : undefined;
      }
      if (t.operator === 'Multiply') {
        let found: { kind: string; arg: Expr } | undefined;
        const rest: Expr[] = [];
        for (const op of t.ops) {
          const ts = trigSquare(op);
          if (ts) {
            if (found) return undefined;
            found = ts;
          } else rest.push(op);
        }
        if (!found) return undefined;
        const coef =
          rest.length === 0
            ? engine.One
            : rest.length === 1
              ? rest[0]
              : engine.function('Multiply', rest);
        return { ...found, coef };
      }
      return undefined;
    };
    if (expr.operator === 'Add') {
      const splits = expr.ops.map(split);
      for (let i = 0; i < splits.length; i++)
        for (let j = i + 1; j < splits.length; j++) {
          const a = splits[i];
          const b = splits[j];
          if (
            a &&
            b &&
            a.kind !== b.kind &&
            a.arg.isSame(b.arg) &&
            a.coef.isSame(b.coef)
          )
            return true;
        }
    }
    return (expr.ops ?? []).some(hasPythagoreanPair);
  }

  test('solves exponential-forced equation y-prime-prime minus y equals e^x', () => {
    const equation = [
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['Negate', ['y', 'x']]],
      ['Exp', 'x'],
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x + "c_2" * e^(-x) + 1/2 * x * e^x]`
    );
    expect(hasUnfoldedExpProduct(result)).toBe(false);
    expect(hasPythagoreanPair(result)).toBe(false);
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves exponential-forced equation (Subtract spelling) y-prime-prime minus y equals e^x', () => {
    const equation = [
      'Equal',
      ['Subtract', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']],
      ['Exp', 'x'],
    ];
    const result = dsolve(equation);

    expect(result.operator).toBe('List');
    expect(result.toString()).toContain('1/2 * x * e^x');
    expect(hasUnfoldedExpProduct(result)).toBe(false);
    expect(hasPythagoreanPair(result)).toBe(false);
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves exponential-forced equation y-prime-prime plus y equals e^x', () => {
    const equation = [
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['y', 'x']],
      ['Exp', 'x'],
    ];
    const result = dsolve(equation);

    // The ½eˣsin²x + ½eˣcos²x pair from variation of parameters must be
    // collected to ½eˣ.
    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * cos(x) + "c_2" * sin(x) + 1/2 * e^x]`
    );
    expect(hasUnfoldedExpProduct(result)).toBe(false);
    expect(hasPythagoreanPair(result)).toBe(false);
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  test('solves exponential-forced equation y-prime-prime minus y equals e^(2x)', () => {
    const equation = [
      'Equal',
      ['Add', ['D', ['D', ['y', 'x'], 'x'], 'x'], ['Negate', ['y', 'x']]],
      ['Exp', ['Multiply', 2, 'x']],
    ];
    const result = dsolve(equation);

    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * e^x + "c_2" * e^(-x) + 1/3 * e^(2x)]`
    );
    expect(hasUnfoldedExpProduct(result)).toBe(false);
    expect(hasPythagoreanPair(result)).toBe(false);
    expect(
      verifyEquationSolution(equation, result, { c_1: 2, c_2: 3, x: 0.75 })
    ).toBe(true);
  });

  //
  // Parsed-LaTeX entry path (regression: the canonical `Add` typechecked the
  // `D` term as `expression` and replaced it with an `Error` node before
  // `DSolve` ran).
  //
  test("parses y''(x) + y(x) = 0 without an Error node and solves it", () => {
    const equation = engine.parse("y''(x)+y(x)=0");
    expect(equation.isValid).toBe(true);
    expect(hasNoErrorNode(equation)).toBe(true);

    const result = dsolve(equation);
    expect(result.operator).toBe('List');
    expect(result.toString()).toMatchInlineSnapshot(
      `[y(x) === "c_1" * cos(x) + "c_2" * sin(x)]`
    );
  });

  test("parses and solves y''(x) - y(x) = e^x end-to-end", () => {
    const equation = engine.parse("y''(x) - y(x) = e^x");
    expect(equation.isValid).toBe(true);
    expect(hasNoErrorNode(equation)).toBe(true);

    const result = dsolve(equation);
    expect(result.operator).toBe('List');
    expect(hasUnfoldedExpProduct(result)).toBe(false);
    const rhs = result.op1.op2;
    // ½·x·eˣ particular term survives the parse path.
    const derivative1 = engine.expr(['D', rhs, 'x']).evaluate();
    const derivative2 = engine.expr(['D', derivative1, 'x']).evaluate();
    const residual = derivative2
      .sub(rhs)
      .sub(engine.box(['Exp', 'x']))
      .subs({ c_1: 2, c_2: 3, x: 0.75 })
      .N().re;
    expect(Math.abs(residual)).toBeLessThan(1e-10);
  });

  //
  // Implicit first-order derivative `Apply(Derivative(y), x)` (order defaults
  // to 1) must be recognized just like the explicit `Apply(Derivative(y,1),x)`.
  //
  test('recognizes implicit-order Apply(Derivative(y), x) like the explicit form', () => {
    const implicit = dsolve([
      'Equal',
      ['Apply', ['Derivative', 'y'], 'x'],
      ['y', 'x'],
    ]);
    const explicit = dsolve([
      'Equal',
      ['Apply', ['Derivative', 'y', 1], 'x'],
      ['y', 'x'],
    ]);

    expect(implicit.operator).toBe('List');
    expect(implicit.toString()).toEqual(explicit.toString());
    expect(implicit.toString()).toMatchInlineSnapshot(`[y(x) === "c_1" * e^x]`);
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

  test('solves first-order systems with RK4 samples', () => {
    const result = ndsolve(
      [
        'List',
        ['Equal', ['D', ['y', 'x'], 'x'], ['z', 'x']],
        ['Equal', ['D', ['z', 'x'], 'x'], ['Negate', ['y', 'x']]],
      ],
      ['List', 0, 1],
      200,
      ['List', 'y', 'z']
    );
    const [x, [y, z]] = finalSystemSample(result);

    expect(result.operator).toBe('List');
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(Math.sin(1), 10);
    expect(z).toBeCloseTo(Math.cos(1), 10);
  });

  test('solves nonlinear first-order systems with RK4 samples', () => {
    const result = ndsolve(
      [
        'List',
        ['Equal', ['D', ['y', 'x'], 'x'], ['Multiply', ['y', 'x'], ['z', 'x']]],
        ['Equal', ['D', ['z', 'x'], 'x'], ['Negate', ['z', 'x']]],
      ],
      ['List', 1, 1],
      400,
      ['List', 'y', 'z']
    );
    const [, [y, z]] = finalSystemSample(result);

    expect(result.operator).toBe('List');
    expect(y).toBeCloseTo(Math.exp(1 - Math.exp(-1)), 10);
    expect(z).toBeCloseTo(Math.exp(-1), 10);
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
