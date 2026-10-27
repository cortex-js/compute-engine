import { ComputeEngine } from '../../src/compute-engine';

// A function literal whose body is `D(f, x)`, `Series(f, x, …)` or an
// indefinite `Integrate(f, x)` has a value that is an expression in its
// parameter `x`. Applied to an argument that contains a symbol `x` (`x + 1`),
// the value is the derivative at the argument, and the `x` of the argument is
// the `x` of the enclosing scope. Before the fix, the `x` of the value was not
// replaced: `(x ↦ D(x^2, x))(x + 1)` gave `2x`. With an argument of another
// name (`y + 1`) the value was right.

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

// The value of `EvaluateAt(literal, point)` and the value of the same
// application written with `Apply`, a `Tuple` point spread as the
// arguments. `EvaluateAt` is a plain application: the two are the same.
const evaluateAtAndApply = (
  engine: ComputeEngine,
  literal: Json,
  points: Json[]
): [string, string] => [
  engine
    .box([
      'EvaluateAt',
      literal,
      points.length === 1 ? points[0] : ['Tuple', ...points],
    ])
    .evaluate()
    .toString(),
  engine
    .box(['Apply', literal, ...points])
    .evaluate()
    .toString(),
];

const at = (body: Json, arg: Json): Json => [
  'Apply',
  ['Function', body, 'x'],
  arg,
];

describe('APPLYING A FUNCTION LITERAL WHOSE BODY IS A BINDER OF ITS PARAMETER', () => {
  test('D(x^2, x) at x + 1', () =>
    expect(
      ce
        .box(at(['D', ['Power', 'x', 2], 'x'], ['Add', 'x', 1]))
        .evaluate()
        .toString()
    ).toBe('2(x + 1)'));

  test('D(x^2, x) at 2x', () =>
    expect(
      ce
        .box(at(['D', ['Power', 'x', 2], 'x'], ['Multiply', 2, 'x']))
        .evaluate()
        .toString()
    ).toBe('4x'));

  test('D(x^2, x) at y + 1 and at 3', () => {
    expect(
      ce
        .box(at(['D', ['Power', 'x', 2], 'x'], ['Add', 'y', 1]))
        .evaluate()
        .toString()
    ).toBe('2(y + 1)');
    expect(
      ce.box(at(['D', ['Power', 'x', 2], 'x'], 3)).evaluate().json
    ).toEqual(6);
  });

  test('D(x^2, x) at a float is folded', () => {
    // The value `2x` at `3.5` was `2 * 3.5`.
    const expr = ce.box(at(['D', ['Power', 'x', 2], 'x'], 3.5));
    expect(expr.evaluate().re).toBe(7);
    expect(expr.N().re).toBe(7);
  });

  test('Series(sin x, x, 0, 3) at x + 1', () =>
    expect(
      ce
        .box(at(['Series', ['Sin', 'x'], 'x', 0, 3], ['Add', 'x', 1]))
        .evaluate()
        .toString()
    ).toBe('1 + x - 1/6 * (x + 1)^3 + BigO((x + 1)^5)'));

  test('Integrate(a·x, x) at x + 1', () =>
    expect(
      ce
        .box(at(['Integrate', ['Multiply', 'a', 'x'], 'x'], ['Add', 'x', 1]))
        .evaluate()
        .toString()
    ).toBe('1/2 * a * (x + 1)^2'));

  test('the value agrees with the expected expression at sample points', () => {
    const cases: [Json, Json][] = [
      [
        at(['D', ['Power', 'x', 2], 'x'], ['Add', 'x', 1]),
        ['Multiply', 2, ['Add', 'x', 1]],
      ],
      [
        ['Normal', at(['Series', ['Sin', 'x'], 'x', 0, 3], ['Add', 'x', 1])],
        [
          'Subtract',
          ['Add', 'x', 1],
          ['Divide', ['Power', ['Add', 'x', 1], 3], 6],
        ],
      ],
      [
        at(['Integrate', ['Multiply', 'a', 'x'], 'x'], ['Add', 'x', 1]),
        ['Divide', ['Multiply', 'a', ['Power', ['Add', 'x', 1], 2]], 2],
      ],
    ];
    for (const [expr, expected] of cases) {
      const value = ce.box(expr).evaluate();
      for (const x of [0.3, 1.7, -2.2, 4.1]) {
        const point = { x: ce.number(x), a: ce.number(1.3) };
        expect(value.subs(point).N().re).toBeCloseTo(
          ce.box(expected).subs(point).N().re,
          9
        );
      }
    }
  });

  // Under `.N()`, an application with a written argument that is not a
  // number literal (`1 + 2.5`) put the argument in place of the parameter
  // in the body. The `x` of `D(x^2, x)` is the variable of the `D`, so it
  // was not replaced, and the value was `2x`.
  test('D(x^2, x) at 1 + 2.5 under N()', () =>
    expect(
      ce.box(at(['D', ['Power', 'x', 2], 'x'], ['Add', 1, 2.5])).N().re
    ).toBe(7));
});

// `EvaluateAt` of a function literal whose body has a `D`, a `Series` or an
// indefinite `Integrate` of a parameter evaluates that node with the
// parameters as variables, then puts the point in its value.
describe('EVALUATEAT OF A BINDER OF A PARAMETER', () => {
  // A symbol of the enclosing scope with the name of a parameter and an
  // assigned value is not read: with `x := 5`, `x·D(x^2, x)` at `3` is
  // `3·6 = 18`, not `3·2·5 = 30`.
  test('a parameter name with an assigned value', () => {
    const engine = new ComputeEngine();
    engine.assign('x', 5);
    expect(
      engine
        .box([
          'EvaluateAt',
          ['Function', ['Multiply', 'x', ['D', ['Power', 'x', 2], 'x']], 'x'],
          3,
        ])
        .evaluate().json
    ).toEqual(18);
    const other = new ComputeEngine();
    other.assign('y', 7);
    expect(
      other
        .box([
          'EvaluateAt',
          ['Function', ['Add', ['D', ['Power', 'x', 2], 'x'], 'y'], 'x', 'y'],
          ['Tuple', 3, 5],
        ])
        .evaluate().json
    ).toEqual(11);
    expect(
      other
        .box([
          'EvaluateAt',
          ['Function', ['D', ['Multiply', 'x', 'y'], 'x'], 'x', 'y'],
          ['Tuple', 3, 2],
        ])
        .evaluate().json
    ).toEqual(2);
  });

  // Only the `D` is evaluated first: the `If` still selects its branch at
  // the point.
  test('a lazy condition', () => {
    const at = (point: number) =>
      ce
        .box([
          'EvaluateAt',
          [
            'Function',
            ['If', ['Equal', 'x', 0], 0, ['D', ['Power', 'x', 2], 'x']],
            'x',
          ],
          point,
        ])
        .evaluate().json;
    expect(at(0)).toEqual(0);
    expect(at(3)).toEqual(6);
  });

  // The branch that the `If` does not select is not evaluated: an expansion
  // or an antiderivative with no closed form there does not keep the form
  // unevaluated.
  test('a branch that is not selected', () => {
    expect(
      ce
        .box([
          'EvaluateAt',
          [
            'Function',
            [
              'If',
              'True',
              1,
              ['Series', ['Exp', ['Divide', 1, 'x']], 'x', 0, 3],
            ],
            'x',
          ],
          2,
        ])
        .evaluate().json
    ).toEqual(1);
    expect(
      ce
        .box([
          'EvaluateAt',
          [
            'Function',
            [
              'If',
              ['Equal', 'x', 0],
              0,
              ['Integrate', ['Sin', ['Sin', 'x']], 'x'],
            ],
            'x',
          ],
          0,
        ])
        .evaluate().json
    ).toEqual(0);
    // The `D` of the selected branch reads the point, with `x := 5`.
    const engine = new ComputeEngine();
    engine.assign('x', 5);
    expect(
      engine
        .box([
          'EvaluateAt',
          [
            'Function',
            ['If', ['Equal', 'x', 0], 0, ['D', ['Power', 'x', 2], 'x']],
            'x',
          ],
          3,
        ])
        .evaluate().json
    ).toEqual(6);
  });

  // The order of the `Series` is a parameter: the expansion is made at the
  // point, with the order of the point (`x + O(x^3)` at 1/2).
  test('a Series whose order is a parameter', () =>
    expect(
      ce
        .box([
          'EvaluateAt',
          ['Function', ['Series', ['Sin', 'x'], 'x', 0, 'n'], 'x', 'n'],
          ['Tuple', ['Rational', 1, 2], 1],
        ])
        .evaluate()
        .toString()
    ).toBe('1/2 + BigO(1/8)'));

  // The application runs the statements of the body in order: the `D`
  // reads the value that the `Assign` before it gives to `a`.
  test('the statements of the body run in order', () => {
    const engine = new ComputeEngine();
    engine.assign('a', 1);
    expect(
      engine
        .box([
          'EvaluateAt',
          [
            'Function',
            ['Block', ['Assign', 'a', 2], ['D', ['Multiply', 'a', 'x'], 'x']],
            'x',
          ],
          3,
        ])
        .evaluate().json
    ).toEqual(2);
  });

  // A point that contains the name of a parameter is applied as `Apply`
  // applies it, also when the `D` is in the selected branch of an `If`.
  // `D(x·y, x)` is `y`, and `y` is the `x` of the caller.
  test('a point that contains a parameter name, in a branch', () => {
    const dxy: Json = ['D', ['Multiply', 'x', 'y'], 'x'];
    expect(
      evaluateAtAndApply(
        ce,
        ['Function', ['If', 'True', dxy, 0], 'x', 'y'],
        [3, 'x']
      )
    ).toEqual(['x', 'x']);
    expect(
      evaluateAtAndApply(
        ce,
        ['Function', ['If', ['Greater', 'x', 0], dxy, 0], 'x', 'y'],
        [2, 'x']
      )
    ).toEqual(['x', 'x']);
  });

  // The literal keeps the bindings of the scope where it was made: a `k`
  // read there, global or local to a `Block`, is not the `k` of the scope
  // where `EvaluateAt` is evaluated.
  test('the literal keeps its bindings', () => {
    const engine = new ComputeEngine();
    engine.assign('k', 2);
    engine.assign('f', engine.box(['Function', ['Multiply', 'k', 'x'], 'x']));
    expect(
      engine
        .box([
          'Block',
          ['Declare', 'k', "'integer'"],
          ['Assign', 'k', 10],
          ['EvaluateAt', 'f', ['Add', 'x', 1]],
        ])
        .evaluate()
        .toString()
    ).toBe('2(x + 1)');
    const other = new ComputeEngine();
    const closure = other
      .box([
        'Block',
        ['Declare', 'k', "'integer'"],
        ['Assign', 'k', 2],
        ['Function', ['Multiply', 'k', 'x'], 'x'],
      ])
      .evaluate();
    other.assign('k', 10);
    expect(
      other
        .function('EvaluateAt', [closure, other.box(['Add', 'x', 1])])
        .evaluate()
        .toString()
    ).toBe('2(x + 1)');
  });

  // An annotated or a destructuring parameter is applied as `Apply`
  // applies it.
  test('an annotated or a destructuring parameter', () => {
    const dxy: Json = ['D', ['Multiply', 'x', 'y'], 'x'];
    expect(
      evaluateAtAndApply(
        ce,
        [
          'Function',
          dxy,
          ['Typed', 'x', "'number'"],
          ['Typed', 'y', "'number'"],
        ],
        [3, 'x']
      )
    ).toEqual(['x', 'x']);
    const destructuring: Json = ['Function', dxy, ['Tuple', 'x', 'y']];
    expect(
      ce
        .box(['EvaluateAt', destructuring, ['Tuple', 3, 'x']])
        .evaluate()
        .toString()
    ).toBe(
      ce
        .box(['Apply', destructuring, ['Tuple', 3, 'x']])
        .evaluate()
        .toString()
    );
  });

  // A point is passed by its value, as an argument of `Apply` is: a symbol
  // assigned the symbol `x`, or a call that gives `x`.
  test('a point whose value contains a parameter name', () => {
    const literal: Json = [
      'Function',
      ['D', ['Multiply', 'x', 'y'], 'x'],
      'x',
      'y',
    ];
    const engine = new ComputeEngine();
    engine.assign('z', engine.symbol('x'));
    expect(evaluateAtAndApply(engine, literal, [3, 'z'])).toEqual(['x', 'x']);
    const other = new ComputeEngine();
    other.parse('g(t) := x').evaluate();
    expect(evaluateAtAndApply(other, literal, [3, ['g', 1]])).toEqual([
      'x',
      'x',
    ]);
  });

  // A point of several coordinates is evaluated exactly, and the numeric
  // request applies to the value.
  test('a numeric request on a point of several coordinates', () =>
    expect(
      ce
        .box([
          'EvaluateAt',
          ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
          ['Tuple', ['Rational', 1, 3], 3],
        ])
        .N().re
    ).toBe(1));

  // A rest parameter takes no argument or more: `(x, ...rest) ↦ x +
  // Length(rest)` takes one point, and two bounds.
  test('a literal with a rest parameter', () => {
    const literal: Parameters<typeof ce.box>[0] = [
      'Function',
      ['Add', 'x', ['Length', 'rest']],
      'x',
      ['Spread', 'rest'],
    ];
    expect(ce.box(['EvaluateAt', literal, 3]).evaluate().json).toEqual(3);
    expect(ce.box(['EvaluateAt', literal, 1, 3]).evaluate().json).toEqual(2);
  });

  // The value is evaluated with the bindings it denotes, not by name in the
  // scope of the caller: the `x` of `a := x + 1` is the global `x`, not the
  // local `x` of the block.
  test('the value keeps its own bindings', () => {
    const engine = new ComputeEngine();
    engine.assign('a', engine.box(['Add', 'x', 1]));
    engine.parse('f(t) := a').evaluate();
    expect(
      engine
        .box([
          'Block',
          ['Declare', 'x', "'integer'"],
          ['Assign', 'x', 10],
          ['EvaluateAt', 'f', 0],
        ])
        .evaluate()
        .toString()
    ).toBe('x + 1');
  });

  // A callee that is not a function literal receives the points as written,
  // as a direct call does: a lazy operator reads the expression.
  test('a lazy callee receives the written point', () => {
    const engine = new ComputeEngine();
    engine.declare('p', {
      signature: '(any) -> any',
      lazy: true,
      evaluate: ([e]) => engine.string(e.operator),
    });
    expect(
      engine
        .box(['EvaluateAt', 'p', ['Sin', 'Pi']])
        .evaluate()
        .toString()
    ).toBe(
      engine
        .box(['p', ['Sin', 'Pi']])
        .evaluate()
        .toString()
    );
    expect(
      engine.box(['EvaluateAt', 'Hold', ['Sin', 'Pi']]).evaluate().json
    ).toEqual(['Hold', ['Sin', 'Pi']]);
  });

  // The check of the value for a `D`, a `Series` or an `Integrate` reads a
  // shared node once: a value that is a DAG of depth 30 (2^30 paths) is
  // checked at once.
  test('a value with shared nodes', () => {
    let e = ce.number(1);
    for (let i = 0; i < 30; i++) e = ce.function('Pair', [e, e]);
    const start = Date.now();
    const result = ce
      .function('EvaluateAt', [
        ce.function('Function', [ce.symbol('x'), ce.symbol('x')]),
        ce.function('Hold', [e]),
      ])
      .evaluate();
    expect(result.operator).toBe('Hold');
    expect(Date.now() - start).toBeLessThan(2000);
  });

  // A `Tuple` point is spread over the parameters when the literal has more
  // than one, a rest parameter included.
  test('a tuple point and a rest parameter', () => {
    expect(
      ce
        .box([
          'EvaluateAt',
          [
            'Function',
            ['Add', 'x', ['Length', 'rest']],
            'x',
            ['Spread', 'rest'],
          ],
          ['Tuple', 1, 2],
        ])
        .evaluate().json
    ).toEqual(2);
    expect(
      ce
        .box([
          'EvaluateAt',
          [
            'Function',
            ['Add', 'x', 'y', ['Length', 'rest']],
            'x',
            'y',
            ['Spread', 'rest'],
          ],
          ['Tuple', 1, 2, 3, 4],
        ])
        .evaluate().json
    ).toEqual(5);
  });

  // A symbol whose value is a function literal is read as the literal: its
  // points are spread and counted in the same way.
  test('a symbol whose value is a function literal', () => {
    const engine = new ComputeEngine();
    engine.assign(
      'h',
      engine.box(['Function', ['Multiply', 'x', 'y'], 'x', 'y'])
    );
    expect(
      engine.box(['EvaluateAt', 'h', ['Tuple', 2, 3]]).evaluate().json
    ).toEqual(6);
    // Two bounds are for a function of one variable, as for the literal.
    expect(engine.box(['EvaluateAt', 'h', 2, 3]).evaluate().operator).toBe(
      'EvaluateAt'
    );
    engine.assign(
      'k',
      engine.box(['Function', ['D', ['Multiply', 'x', 'y'], 'x'], 'x', 'y'])
    );
    expect(
      engine
        .box(['EvaluateAt', 'k', ['Tuple', 3, 'x']])
        .evaluate()
        .toString()
    ).toBe(engine.box(['k', 3, 'x']).evaluate().toString());
    engine.assign(
      'g',
      engine.box(['Function', ['D', ['Power', 'x', 2], 'x'], 'x'])
    );
    expect(
      engine
        .box(['EvaluateAt', 'g', ['Add', 'x', 1]])
        .evaluate()
        .toString()
    ).toBe('2(x + 1)');
  });

  // A parameter with the name of the head of the literal.
  test('a parameter named like an operator', () =>
    expect(
      ce
        .box([
          'EvaluateAt',
          ['Function', 'x', 'x', 'Function'],
          ['Tuple', ['Add', 'x', 1], 0],
        ])
        .evaluate()
        .toString()
    ).toBe('x + 1'));

  // A parameter called in the body with the name of a library operator or
  // of a user function: the application calls the point, as `Apply` does.
  test('a parameter with the name of a function', () => {
    const engine = new ComputeEngine();
    engine.parse('w(x) := x + 100').evaluate();
    const square: Parameters<typeof engine.box>[0] = [
      'Function',
      ['Power', 'x', 2],
      'x',
    ];
    const at = (json: Parameters<typeof engine.box>[0]) =>
      engine.box(json).evaluate().toString();
    expect(
      at([
        'EvaluateAt',
        ['Function', ['Sin', 'y'], 'Sin', 'y'],
        ['Tuple', square, 'y'],
      ])
    ).toBe('y^2');
    expect(
      at([
        'EvaluateAt',
        ['Function', ['w', 'y'], 'w', 'y'],
        ['Tuple', square, 'y'],
      ])
    ).toBe('y^2');
    const fiveW: Json = ['Function', ['Multiply', 5, ['w', 'x']], 'x'];
    expect(
      evaluateAtAndApply(engine, ['Function', ['w', 2], 'w'], [fiveW])
    ).toEqual(['510', '510']);
    expect(
      evaluateAtAndApply(engine, ['Function', ['w', ['w', 2]], 'w'], [fiveW])
    ).toEqual(['3050', '3050']);
    const [dAt, dApply] = evaluateAtAndApply(
      engine,
      ['Function', ['D', ['w', 'x'], 'x'], 'w'],
      [fiveW]
    );
    expect(dAt).toBe(dApply);
    expect(
      at([
        'EvaluateAt',
        ['Function', ['Sin', 'x'], 'Sin', 'x'],
        ['Tuple', ['Function', 42, 't'], 'x'],
      ])
    ).toBe('42');
  });

  // The variable of an `Integrate` (bound by the integral and by its
  // integrand) and a point that contains it: as `Apply`. `∫ a·x dx` is
  // `a·x²/2`, at `x = x + 1` and `a = x`.
  test('a point that contains the variable of an Integrate', () => {
    expect(
      evaluateAtAndApply(
        ce,
        ['Function', ['Integrate', ['Multiply', 'a', 'x'], 'x'], 'x', 'a'],
        [['Add', 'x', 1], 'x']
      )
    ).toEqual(['1/2 * x * (x + 1)^2', '1/2 * x * (x + 1)^2']);
  });

  // A lazy operator defined by a literal receives the written point, as a
  // direct call does: `Head` reads `Sin(Pi)`, not its value `0`.
  test('a lazy operator defined by a literal', () => {
    const engine = new ComputeEngine();
    engine.declare('p', {
      signature: '(any) -> any',
      lazy: true,
      evaluate: ['Function', ['Head', 'e'], 'e'],
    });
    expect(
      engine
        .box(['EvaluateAt', 'p', ['Sin', 'Pi']])
        .evaluate()
        .toString()
    ).toBe(
      engine
        .box(['p', ['Sin', 'Pi']])
        .evaluate()
        .toString()
    );
  });

  // A literal with no parameter is applied once per bound, the lower one
  // first: a counter gives `2 − 1`.
  test('a literal with no parameter and an effect', () => {
    const engine = new ComputeEngine();
    engine.box(['Declare', 'n', "'integer'"]).evaluate();
    engine.box(['Assign', 'n', 0]).evaluate();
    const counter = engine.box([
      'Function',
      ['Block', ['Assign', 'n', ['Add', 'n', 1]], 'n'],
    ]);
    expect(
      engine
        .function('EvaluateAt', [counter, engine.number(1), engine.number(3)])
        .evaluate().json
    ).toEqual(1);
  });

  // A constant is its own value at any point, and its difference is `0`.
  test('a literal with no parameter', () => {
    expect(ce.box(['EvaluateAt', 5, 3]).evaluate().json).toEqual(5);
    expect(ce.box(['EvaluateAt', 5, 1, 3]).evaluate().json).toEqual(0);
  });

  // An inner literal with the same parameter name binds its own `x`.
  test('a nested function literal', () =>
    expect(
      ce
        .box([
          'EvaluateAt',
          ['Function', ['Function', ['D', ['Power', 'x', 2], 'x'], 'x'], 'x'],
          3,
        ])
        .evaluate().operator
    ).toBe('Function'));

  // A point is never a partial application: the points are one per
  // parameter, or the form stays unevaluated.
  test('fewer points than parameters', () =>
    expect(
      ce
        .box(['EvaluateAt', ['Function', ['Multiply', 'a', 'b'], 'a', 'b'], 2])
        .evaluate().operator
    ).toBe('EvaluateAt'));
});

describe('A POINT THAT NAMES A PARAMETER IS APPLIED AS BY APPLY', () => {
  const xPlus1: Json = ['Add', 'x', 1];

  test('A local assignment in the body does not change the global symbol', () => {
    expect(
      evaluateAtAndApply(
        ce,
        ['Function', ['Add', ['Block', ['Assign', 'x', 7], 'x'], 'x'], 'x'],
        [xPlus1]
      )
    ).toEqual(['x + 8', 'x + 8']);
    expect(ce.box('x').evaluate().toString()).toBe('x');
  });

  test('An assignment of the parameter in the body runs once', () =>
    expect(
      evaluateAtAndApply(
        ce,
        [
          'Function',
          ['Block', ['Assign', 'x', ['Add', 'x', 1]], ['Multiply', 2, 'x']],
          'x',
        ],
        [xPlus1]
      )
    ).toEqual(['2(x + 2)', '2(x + 2)']));

  test('A held operand', () =>
    expect(
      evaluateAtAndApply(
        ce,
        ['Function', ['List', ['Hold', 'x'], 'x'], 'x'],
        [xPlus1]
      )
    ).toEqual(['[Hold(x + 1),x + 1]', '[Hold(x + 1),x + 1]']));

  test('A dictionary value', () =>
    expect(
      evaluateAtAndApply(
        ce,
        ['Function', ['Dictionary', ['KeyValuePair', "'v'", 'x']], 'x'],
        [xPlus1]
      )
    ).toEqual(['{"v" -> x + 1}', '{"v" -> x + 1}']));

  test('A literal that returns a literal of the same parameter', () =>
    expect(
      evaluateAtAndApply(
        ce,
        ['Function', ['Function', ['D', ['Power', 'x', 2], 'x'], 'x'], 'x'],
        [xPlus1]
      )
    ).toEqual(['(x) => D(x^2, x)', '(x) => D(x^2, x)']));
});

describe('A NAMED CALLEE IS APPLIED AS BY APPLY', () => {
  // The call of the name checks the declared signature: a point that the
  // signature refuses is refused, as `h(1.5)` is.
  test('the declared signature of the callee is checked', () => {
    const engine = new ComputeEngine();
    engine.declare('h', {
      signature: '(integer) -> number',
      evaluate: engine.box(['Function', ['Multiply', 2, 'x'], 'x']),
    });
    const refused = engine.box(['EvaluateAt', 'h', 1.5]).evaluate();
    expect(refused.isSame(engine.box(['Apply', 'h', 1.5]).evaluate())).toBe(
      true
    );
    expect(refused.toString()).toContain('incompatible-type');
    expect(evaluateAtAndApply(engine, 'h', [2])).toEqual(['4', '4']);
  });

  // An `evaluate` handler with an anonymous parameter takes the point.
  test('an evaluate handler with an anonymous parameter', () => {
    const engine = new ComputeEngine();
    engine.declare('f', { evaluate: ['Function', ['Add', '_', 1]] });
    expect(evaluateAtAndApply(engine, 'f', [3])).toEqual(['4', '4']);
  });

  // A point whose value is a tuple is spread as a written tuple is.
  test('a point whose value is a tuple', () => {
    const engine = new ComputeEngine();
    engine.assign('p', engine.box(['Tuple', 2, 3]));
    const literal: Json = ['Function', ['Multiply', 'x', 'y'], 'x', 'y'];
    for (const point of ['p', ['Tuple', 2, 3]] as Json[])
      expect(
        engine.box(['EvaluateAt', literal, point]).evaluate().toString()
      ).toBe(engine.box(['Apply', literal, 2, 3]).evaluate().toString());
    engine.assign('g', engine.box(literal));
    expect(engine.box(['EvaluateAt', 'g', 'p']).evaluate().toString()).toBe(
      engine.box(['Apply', 'g', 2, 3]).evaluate().toString()
    );
    engine.parse('u(x, y) := x + 10y').evaluate();
    expect(
      engine
        .box(['EvaluateAt', 'u', ['Tuple', 2, 3]])
        .evaluate()
        .toString()
    ).toBe(engine.box(['Apply', 'u', 2, 3]).evaluate().toString());
    expect(
      engine.box(['EvaluateAt', 'u', ['Tuple', 2, 3]]).evaluate().json
    ).toEqual(32);
  });

  // Fewer points than the required parameters of a named callee is not a
  // partial application: the form stays.
  test('fewer points than the parameters of a user function', () => {
    const engine = new ComputeEngine();
    engine.parse('u(x, y) := x + 10y').evaluate();
    expect(engine.box(['EvaluateAt', 'u', 2]).evaluate().operator).toBe(
      'EvaluateAt'
    );
    expect(engine.box(['EvaluateAt', 'u', 2, 3]).evaluate().operator).toBe(
      'EvaluateAt'
    );
  });
});

describe('A TUPLE POINT OF A NAMED CALLEE THAT TAKES A TUPLE', () => {
  // A named callee whose call with one argument is valid receives the tuple
  // as one argument, as `Apply` passes it.
  test('a first parameter that takes a tuple and an optional second', () => {
    const engine = new ComputeEngine();
    engine.declare('pt', {
      signature: '(tuple<real, real>, real?) -> real',
      evaluate: (ops) => engine.number(ops.length === 1 ? 100 : 200),
    });
    expect(evaluateAtAndApply(engine, 'pt', [['Tuple', 1, 2]])).toEqual([
      '100',
      '100',
    ]);
    engine.declare('pi2', {
      signature: '(tuple<integer, integer>, integer?) -> integer',
      evaluate: (ops) => engine.number(ops.length === 1 ? 1 : 2),
    });
    const [at, applied] = evaluateAtAndApply(engine, 'pi2', [['Tuple', 1, 2]]);
    expect(at).toBe(applied);
    expect(at).toBe('1');
  });

  // A user function of two parameters still receives the elements.
  test('a user function of two parameters', () => {
    const engine = new ComputeEngine();
    engine.parse('u(x, y) := x + 10y').evaluate();
    expect(
      engine.box(['EvaluateAt', 'u', ['Tuple', 2, 3]]).evaluate().json
    ).toEqual(32);
  });
});

// ROADMAP CE-556: the value of the application of a lazy callee is returned
// as it is, as a direct call returns it. It was evaluated again, and a
// `Random()` that the callee returned unevaluated was drawn.
describe('EVALUATEAT OF A LAZY CALLEE', () => {
  test('the value of the application is not evaluated again', () => {
    const engine = new ComputeEngine();
    engine.declare('p', {
      signature: '(any) -> any',
      lazy: true,
      evaluate: ([e]) => e.canonical,
    });
    expect(engine.box(['p', ['Random']]).evaluate().json).toEqual(['Random']);
    expect(engine.box(['EvaluateAt', 'p', ['Random']]).evaluate().json).toEqual(
      ['Random']
    );
  });
});

// ROADMAP CE-555: a `D`, a `Series` or an `Integrate` that comes from the
// point is not a reason to keep the form unevaluated. Only the body of the
// function can drop a point.
describe('A BINDER NODE IN THE POINT', () => {
  const series: Json = ['Series', ['Exp', ['Divide', 1, 'x']], 'x', 0, 3];

  test('the identity at a series, whatever the name of the parameter', () => {
    const atX = ce
      .box(['EvaluateAt', ['Function', 'x', 'x'], series])
      .evaluate();
    const atT = ce
      .box(['EvaluateAt', ['Function', 't', 't'], series])
      .evaluate();
    expect(atX.operator).toBe('Series');
    expect(atX.isSame(atT)).toBe(true);
    expect(atX.isSame(ce.box(series).evaluate())).toBe(true);
  });

  test('an integral with no closed form in the point', () => {
    const integral: Json = ['Integrate', ['Sin', ['Sin', 'x']], 'x'];
    const value = ce
      .box(['EvaluateAt', ['Function', ['Add', 'x', 1], 'x'], integral])
      .evaluate();
    expect(value.operator).not.toBe('EvaluateAt');
    expect(value.isSame(ce.box(['Add', integral, 1]).evaluate())).toBe(true);
  });

  // The case the check exists for: the series of the body has no closed
  // form, and its value would drop the point.
  test('a series of the parameter in the body', () => {
    expect(
      ce.box(['EvaluateAt', ['Function', series, 'x'], 2]).evaluate().operator
    ).toBe('EvaluateAt');
    expect(
      ce.box(['EvaluateAt', ['Function', series, 'x'], series]).evaluate()
        .operator
    ).toBe('EvaluateAt');
  });
});

// ROADMAP CE-554: the point of an expression (not a function literal) whose
// value is a tuple gives one coordinate per free variable, as a written
// tuple does. The parameters were chosen from the point as written: the
// symbol `p` counted as one coordinate, the "bounds are for `x`" rule made
// the function a function of `x` alone, and the whole tuple was applied to
// `x`.
describe('A POINT WHOSE VALUE IS A TUPLE, OF AN EXPRESSION', () => {
  test('x·y at p := (2, 3)', () => {
    const engine = new ComputeEngine();
    engine.assign('p', engine.box(['Tuple', 2, 3]));
    const boxed = engine.box(['EvaluateAt', ['Multiply', 'x', 'y'], 'p']);
    expect(boxed.evaluate().json).toEqual(6);
    expect(
      engine
        .box(['EvaluateAt', ['Multiply', 'x', 'y'], ['Tuple', 2, 3]])
        .evaluate().json
    ).toEqual(6);
    // The expression is kept until the value of the point is known, and its
    // LaTeX parses back to the same expression.
    expect(boxed.json).toEqual(['EvaluateAt', ['Multiply', 'x', 'y'], 'p']);
    const parsed = engine.parse(boxed.latex);
    expect(parsed.isSame(boxed)).toBe(true);
    expect(parsed.evaluate().json).toEqual(6);
  });

  test('a point whose value is not a tuple is for x', () => {
    const engine = new ComputeEngine();
    expect(
      engine
        .box(['EvaluateAt', ['Multiply', 'k', 'x'], 'a'])
        .evaluate()
        .toString()
    ).toBe('a * k');
    engine.assign('q', 3);
    expect(
      engine
        .box(['EvaluateAt', ['Multiply', 'k', 'x'], 'q'])
        .evaluate()
        .toString()
    ).toBe('3k');
    // A point whose type is a number is read as written.
    expect(
      engine.box(['EvaluateAt', ['Multiply', 'k', 'x'], ['Add', 'a', 1]]).json
    ).toEqual([
      'EvaluateAt',
      ['Function', ['Block', ['Multiply', 'k', 'x']], 'x'],
      ['Add', 'a', 1],
    ]);
  });
});

// ROADMAP CE-553: the signature that a definition derives from an
// `evaluate` handler written with anonymous parameters counts them. It was
// `() -> unknown`, and `EvaluateAt` could not refuse a surplus of points
// for a named callee.
describe('THE SIGNATURE OF A HANDLER WITH ANONYMOUS PARAMETERS', () => {
  test('one parameter for each anonymous parameter', () => {
    const engine = new ComputeEngine();
    engine.declare('f', { evaluate: ['Function', ['Add', '_', 1]] });
    expect(engine.box('f').operatorDefinition!.signature.toString()).toBe(
      '(unknown) -> unknown'
    );
    expect(engine.box(['f', 3]).evaluate().json).toEqual(4);
    engine.declare('g', {
      evaluate: ['Function', ['Add', '_1', ['Multiply', 10, '_2']]],
    });
    expect(engine.box('g').operatorDefinition!.signature.toString()).toBe(
      '(unknown, unknown) -> unknown'
    );
    // A tuple point is spread over the two parameters.
    expect(
      engine.box(['EvaluateAt', 'g', ['Tuple', 2, 3]]).evaluate().json
    ).toEqual(32);
  });

  // A named callee whose signature takes no argument is a constant, as a
  // literal with no parameter is: its value at any point is its value, and
  // its difference between two bounds is `0`. A call with the point gave an
  // `unexpected-argument` error.
  test('a named callee that takes no argument', () => {
    const engine = new ComputeEngine();
    engine.declare('h', {
      signature: '() -> integer',
      evaluate: () => engine.number(42),
    });
    engine.assign('k', engine.box(['Function', 42]));
    for (const callee of ['h', 'k']) {
      expect(engine.box(['EvaluateAt', callee, 3]).evaluate().json).toEqual(42);
      expect(engine.box(['EvaluateAt', callee, 1, 3]).evaluate().json).toEqual(
        0
      );
    }
    expect(
      engine.box(['EvaluateAt', ['Function', 42], 3]).evaluate().json
    ).toEqual(42);
  });
});

// An `Integrate` with no closed form in a BOUND of the two-point form is a
// value like any other: the form stayed unevaluated. An `Integrate` that
// comes from the function (an antiderivative with no closed form) still
// keeps the form: the bound would be put into the integration variable.
describe('AN INTEGRAL IN A BOUND', () => {
  const integral: Json = ['Integrate', ['Sin', ['Sin', 't']], 't'];
  const noClosedForm: Json = [
    'Function',
    ['Integrate', ['Sin', ['Sin', 'x']], 'x'],
    'x',
  ];

  test('the identity between 0 and an integral', () => {
    const value = ce
      .box(['EvaluateAt', ['Function', 'x', 'x'], 0, integral])
      .evaluate();
    expect(value.operator).toBe('Integrate');
    expect(value.isSame(ce.box(integral).evaluate())).toBe(true);
    expect(
      ce
        .box(['EvaluateAt', ['Function', ['Add', 'x', 1], 'x'], integral, 2])
        .evaluate()
        .isSame(ce.box(['Subtract', 2, integral]).evaluate())
    ).toBe(true);
  });

  test('an antiderivative with no closed form keeps the form', () => {
    expect(ce.box(['EvaluateAt', noClosedForm, 0, 1]).evaluate().operator).toBe(
      'EvaluateAt'
    );
    expect(
      ce.box(['EvaluateAt', noClosedForm, 0, integral]).evaluate().operator
    ).toBe('EvaluateAt');
    const engine = new ComputeEngine();
    engine.parse('h(x) := \\int \\sin(\\sin(x)) dx').evaluate();
    expect(engine.box(['EvaluateAt', 'h', 0, 1]).evaluate().operator).toBe(
      'EvaluateAt'
    );
  });
});

// A literal whose variable of `D` or of `Integrate` is a parameter too:
// the parameters are independent variables. The binder is worked out with
// the other parameters as symbols, then the call puts the arguments in. The
// argument `x` of `y` is the `x` of the caller, not the parameter `x`.
// Before, the value of `y` was put in before the differentiation:
// `D(x·y, x)` at `(3, x)` gave `x + 3`, and `∫ a·x dx` at `(x + 1, x)` gave
// `x³/2`.
describe('A PARAMETER WHOSE ARGUMENT HAS THE NAME OF THE VARIABLE OF THE BINDER', () => {
  const dxy: Json = ['Function', ['D', ['Multiply', 'x', 'y'], 'x'], 'x', 'y'];
  const integral: Json = [
    'Function',
    ['Integrate', ['Multiply', 'a', 'x'], 'x'],
    'x',
    'a',
  ];

  test('D(x·y, x) at (3, x) is x', () => {
    expect(evaluateAtAndApply(ce, dxy, [3, 'x'])).toEqual(['x', 'x']);
    expect(evaluateAtAndApply(ce, dxy, [['Add', 'x', 1], 'x'])).toEqual([
      'x',
      'x',
    ]);
    expect(
      evaluateAtAndApply(
        ce,
        [
          'Function',
          ['D', ['Multiply', ['Power', 'x', 2], 'y'], 'x'],
          'x',
          'y',
        ],
        [3, 'x']
      )
    ).toEqual(['6x', '6x']);
  });

  test('a parameter with no symbol of the variable in its value', () =>
    expect(evaluateAtAndApply(ce, dxy, [3, 'z'])).toEqual(['z', 'z']));

  test('∫ a·x dx at (x + 1, x) is x(x + 1)²/2', () => {
    const [at, applied] = evaluateAtAndApply(ce, integral, [
      ['Add', 'x', 1],
      'x',
    ]);
    expect(at).toBe(applied);
    // `a·x²/2` at `x = x + 1, a = x`, compared at sample points.
    const value = ce.box(['Apply', integral, ['Add', 'x', 1], 'x']).evaluate();
    for (const x of [0.7, -1.3, 2.4]) {
      const point = { x: ce.number(x) };
      expect(value.subs(point).N().re).toBeCloseTo((x * (x + 1) ** 2) / 2, 9);
    }
    expect(
      ce
        .box(['Apply', integral, ['Add', 'x', 1], 3])
        .evaluate()
        .toString()
    ).toBe('3/2 * (x + 1)^2');
  });

  test('a definite integral', () =>
    expect(
      ce
        .box([
          'Apply',
          [
            'Function',
            ['Integrate', ['Multiply', 'a', 'x'], ['Limits', 'x', 0, 1]],
            'x',
            'a',
          ],
          ['Add', 'x', 1],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('1/2 * x'));

  // The variable of the binder is not a parameter: the value of the
  // parameter is an expression in that variable (`g(f) = D(f, x)`).
  test('the variable of the binder is not a parameter', () => {
    const engine = new ComputeEngine();
    engine.parse('g(f) := \\frac{d}{dx} f').evaluate();
    engine.parse('h(f) := \\int f\\,dx').evaluate();
    expect(
      engine
        .box(['g', ['Power', 'x', 2]])
        .evaluate()
        .toString()
    ).toBe('2x');
    expect(
      engine
        .box(['h', ['Power', 'x', 2]])
        .evaluate()
        .toString()
    ).toBe('1/3 * x^3');
  });
});

// A parameter that holds a function and has the name of a user function:
// the function given as the argument calls the user function. Before, the
// call of the user function in the argument was read as a call of the
// parameter, and `D` gave `Apply(Derivative(w, 1), x)`, `Integrate` stayed
// unevaluated and `Series` stopped at the recursion limit.
describe('A FUNCTION PARAMETER WITH THE NAME OF A USER FUNCTION', () => {
  const engine = new ComputeEngine();
  engine.parse('w(x) := x + 100').evaluate();
  const fiveW: Json = ['Function', ['Multiply', 5, ['w', 'x']], 'x'];
  const value = (json: Json) => engine.box(json).evaluate().toString();

  test('D(w(x), x)', () => {
    expect(
      evaluateAtAndApply(
        engine,
        ['Function', ['D', ['w', 'x'], 'x'], 'w'],
        [fiveW]
      )
    ).toEqual(['5', '5']);
    // The same literal with a parameter of another name.
    expect(
      value(['Apply', ['Function', ['D', ['f', 'x'], 'x'], 'f'], fiveW])
    ).toBe('5');
    expect(
      value([
        'Apply',
        ['Function', ['D', ['w', ['Power', 'x', 2]], 'x'], 'w'],
        fiveW,
      ])
    ).toBe('10x');
    expect(
      value([
        'Apply',
        ['Function', ['D', ['w', 'x'], 'x'], 'w'],
        ['Function', ['Multiply', 5, ['w', ['w', 'x']]], 'x'],
      ])
    ).toBe('5');
  });

  test('Integrate(w(x), x)', () =>
    expect(
      value(['Apply', ['Function', ['Integrate', ['w', 'x'], 'x'], 'w'], fiveW])
    ).toBe('5/2 * x^2 + 500x'));

  test('Series(w(x), x, 0, 2)', () =>
    expect(
      value([
        'Apply',
        ['Function', ['Series', ['w', 'x'], 'x', 0, 2], 'w'],
        fiveW,
      ])
    ).toBe('500 + 5x + BigO(x^3)'));
});

// The value of the application is returned as it is, as `Apply` returns it.
// It was evaluated a second time, and a `Random()` that a lazy operation of
// the body returned unevaluated was drawn.
describe('THE VALUE OF THE APPLICATION IS NOT EVALUATED AGAIN', () => {
  test('a lazy operation in the body', () => {
    const engine = new ComputeEngine();
    engine.declare('p', {
      signature: '(any) -> any',
      lazy: true,
      evaluate: ([e]) => e.canonical,
    });
    const literal: Json = ['Function', ['p', ['Random']], 'x'];
    expect(engine.box(['Apply', literal, 0]).evaluate().json).toEqual([
      'Random',
    ]);
    expect(engine.box(['EvaluateAt', literal, 0]).evaluate().json).toEqual([
      'Random',
    ]);
  });
});

// Three or more points are neither a point nor two bounds: the form stays
// unevaluated. The first two were read as bounds, and the third point was
// dropped (`f(2) − f(1)`).
describe('THREE POINTS', () => {
  test('the form stays unevaluated', () => {
    const expr = ce.parse('\\left.\\left(f\\right)\\right|_{1, 2, 3}');
    expect(expr.json).toEqual(['EvaluateAt', 'f', 1, 2, 3]);
    expect(expr.evaluate().json).toEqual(['EvaluateAt', 'f', 1, 2, 3]);
  });
});

// The bounds are evaluated once, before the applications, as the point of
// `f|_a` is. The value of a bound that is an integral with a part that has a
// closed form (`∫(sin(sin t) + t) dt` is `t²/2 + ∫sin(sin t) dt`) has an
// `Integrate` node that the written bound does not have, and the form was
// kept unevaluated.
describe('THE BOUNDS ARE EVALUATED ONCE', () => {
  test('an integral bound whose value is another integral', () => {
    const integral: Json = [
      'Integrate',
      ['Add', ['Sin', ['Sin', 't']], 't'],
      't',
    ];
    const value = ce.box(integral).evaluate().toString();
    expect(
      ce
        .box(['EvaluateAt', ['Function', 'x', 'x'], 0, integral])
        .evaluate()
        .toString()
    ).toBe(value);
    expect(
      ce
        .box(['EvaluateAt', ['Function', 'x', 'x'], integral])
        .evaluate()
        .toString()
    ).toBe(value);
  });
});

// Under `.N()`, the application runs the body with the numeric request. An
// indefinite integral in the body was then read as a numeric integral with
// no bounds, and stayed unevaluated: `Apply(x ↦ ∫sin(x) dx, 1).N()` was
// `∫sin(x) dx`. Its antiderivative is computed exactly, and the numeric
// request applies to the value at the point. `D` already did so.
describe('A BINDER OF THE PARAMETER UNDER N()', () => {
  test('an indefinite integral', () => {
    const literal: Json = ['Function', ['Integrate', ['Sin', 'x'], 'x'], 'x'];
    expect(ce.box(['Apply', literal, 1]).evaluate().toString()).toBe('-cos(1)');
    expect(ce.box(['Apply', literal, 1]).N().re).toBeCloseTo(-Math.cos(1), 12);
  });

  test('a derivative', () =>
    expect(
      ce.box(['Apply', ['Function', ['D', ['Sin', 'x'], 'x'], 'x'], 1]).N().re
    ).toBeCloseTo(Math.cos(1), 12));
});
