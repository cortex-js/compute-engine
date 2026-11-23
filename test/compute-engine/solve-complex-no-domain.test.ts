import { ComputeEngine } from '../../src/compute-engine';

// GitHub issue #526: with no domain, `Solve` answers over the complex
// numbers where it can (`x² + 1 = 0` gives `[i, -i]`). A root template that
// inverts `sin` or `cos` removes a root outside the real range of the
// function (`arcsin(2)`), and the empty list read as "no solution". These
// equations have complex roots: the `Solve` now stays unevaluated, as it
// does when the proof that there is no real root is an interval scan of a
// nested periodic equation (`cos(sin(x)) = 0`). An exponential or a
// hyperbolic function gives its families of complex roots (CE-1713, below).
// An explicitly real domain keeps `[]`.
describe('issue 526: no domain, the real range of an inversion is not a decision', () => {
  const ce = new ComputeEngine();
  const solve = (eq: unknown, spec: unknown = 'x') =>
    ce.box(['Solve', eq as any, spec as any]).evaluate();
  const json = (eq: unknown, spec: unknown = 'x') =>
    JSON.stringify(solve(eq, spec).json);

  test.each([
    ['sin x = 2', ['Equal', ['Sin', 'x'], 2]],
    ['cos x = 2', ['Equal', ['Cos', 'x'], 2]],
    ['3 sin x = 6', ['Equal', ['Multiply', 3, ['Sin', 'x']], 6]],
    ['sin(2x) = 2', ['Equal', ['Sin', ['Multiply', 2, 'x']], 2]],
    // `x² = -ln 2 + 2πik` has two roots for each `k`: no family of
    // `exponentialRootFamilies()` holds them
    [
      'e^(x²) = 1/2',
      [
        'Equal',
        ['Power', 'ExponentialE', ['Power', 'x', 2]],
        ['Rational', 1, 2],
      ],
    ],
    // A nested periodic equation with no real root: `sin(x) = ±π/2` has
    // complex roots.
    ['cos(sin x) = 0', ['Equal', ['Cos', ['Sin', 'x']], 0]],
  ])('%s stays unevaluated', (_label, eq) => {
    expect(solve(eq).operator).toBe('Solve');
  });

  test.each([
    ['sin x = 2', ['Equal', ['Sin', 'x'], 2]],
    ['e^x = -1', ['Equal', ['Power', 'ExponentialE', 'x'], -1]],
    ['sin(2x) = 2', ['Equal', ['Sin', ['Multiply', 2, 'x']], 2]],
    ['cosh x = 0', ['Equal', ['Cosh', 'x'], 0]],
    ['cos(sin x) = 0', ['Equal', ['Cos', ['Sin', 'x']], 0]],
  ])('%s over the real numbers is []', (_label, eq) => {
    expect(json(eq, ['Element', 'x', 'RealNumbers'])).toBe('["List"]');
  });

  test('sin x = 2 over the complex numbers stays unevaluated', () => {
    expect(
      solve(['Equal', ['Sin', 'x'], 2], ['Element', 'x', 'ComplexNumbers'])
        .operator
    ).toBe('Solve');
  });

  test('an unknown declared real keeps []', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    for (const eq of [
      ['Equal', ['Sin', 'y'], 2],
      ['Equal', ['Power', 'ExponentialE', 'y'], -1],
      ['Equal', ['Sin', ['Multiply', 2, 'y']], 2],
      ['Equal', ['Power', 'ExponentialE', ['Add', 'y', 1]], -2],
      ['Equal', ['Cos', ['Sin', 'y']], 0],
    ])
      expect(
        JSON.stringify(ce.box(['Solve', eq as any, 'y']).evaluate().json)
      ).toBe('["List"]');
  });

  // These equations have no complex root either: `[]` stays.
  test.each([
    ['e^x = 0', ['Equal', ['Power', 'ExponentialE', 'x'], 0]],
    ['tanh x = 1', ['Equal', ['Tanh', 'x'], 1]],
    ['arcsin x = 5', ['Equal', ['Arcsin', 'x'], 5]],
    ['√x = -1', ['Equal', ['Sqrt', 'x'], -1]],
    ['|x| = -1', ['Equal', ['Abs', 'x'], -1]],
  ])('%s is []', (_label, eq) => {
    expect(json(eq)).toBe('["List"]');
  });

  test('x² + 1 = 0 gives its complex roots', () => {
    expect(json(['Equal', ['Add', ['Power', 'x', 2], 1], 0])).toBe(
      '["List",["Complex",0,1],["Complex",0,-1]]'
    );
  });

  test('sin x = 1/2 gives its real families of roots', () => {
    expect(json(['Equal', ['Sin', 'x'], ['Rational', 1, 2]])).toBe(
      '["List",["Add",["Multiply",2,"Pi",["ArbitraryInteger",1]],["Multiply",["Rational",1,6],"Pi"]],["Add",["Multiply",2,"Pi",["ArbitraryInteger",1]],["Multiply",["Rational",5,6],"Pi"]]]'
    );
  });

  test('tan x = 1 gives its family of roots', () => {
    expect(json(['Equal', ['Tan', 'x'], 1])).toBe(
      '["List",["Add",["Multiply",["Rational",1,4],"Pi"],["Multiply","Pi",["ArbitraryInteger",1]]]]'
    );
  });

  test('e^x = 2 and cosh x = 2 keep their real roots over the real numbers', () => {
    const real = ['Element', 'x', 'RealNumbers'];
    expect(json(['Equal', ['Power', 'ExponentialE', 'x'], 2], real)).toBe(
      '["List",["Ln",2]]'
    );
    expect(json(['Equal', ['Cosh', 'x'], 2], real)).toBe(
      '["List",["Arcosh",2],["Negate",["Arcosh",2]]]'
    );
  });
});

// CE-1713: with no domain, `Solve` answers over the complex numbers. For a
// complex `z`, `b^z` repeats with the period `2πi/ln b`, thus an exponential
// equation has a family of roots for each root of the equation in `b^x`:
// `e^x = 2` has the roots `ln 2 + 2πik`. A hyperbolic function is a sum of
// exponentials. A list of the real roots only (`[ln 2]`) is not all the
// roots. A trig function of a periodic argument (`sin(sin(x)) = 0`, which
// holds where `sin(x) = kπ`) has complex roots that no family with one
// parameter holds: `Solve` stays unevaluated.
describe('CE-1713: no domain, an exponential gives its complex families', () => {
  const ce = new ComputeEngine();
  const solve = (eq: unknown, spec: unknown = 'x') =>
    ce.box(['Solve', eq as any, spec as any]).evaluate();

  // Each member of each family (the integer parameter `k` from -2 to 2) is
  // a root of the equation `eq` (`['Equal', lhs, rhs]`), and the answer has
  // `count` items.
  const expectFamilies = (eq: any[], count: number, spec: unknown = 'x') => {
    const answer = solve(eq, spec);
    expect(answer.operator).toBe('List');
    expect(answer.nops).toBe(count);
    const residual = ce.box(['Subtract', eq[1], eq[2]]);
    for (const item of answer.ops!) {
      const text = JSON.stringify(item.json);
      for (const k of [-2, -1, 0, 1, 2]) {
        const value = ce
          .box(JSON.parse(text.replaceAll('["ArbitraryInteger",1]', `${k}`)))
          .N();
        const r = residual.subs({ x: value }).N();
        expect(Math.hypot(r.re, r.im)).toBeLessThan(1e-9);
      }
    }
    return answer;
  };

  test('e^x = 2 is ln 2 + 2πik', () => {
    const answer = expectFamilies(
      ['Equal', ['Power', 'ExponentialE', 'x'], 2],
      1
    );
    expect(answer.toString()).toBe('[2i * pi * ArbitraryInteger(1) + ln(2)]');
  });

  test('(x - 1)(e^x + 1) = 0 has the family (2k + 1)πi', () => {
    const answer = expectFamilies(
      [
        'Equal',
        [
          'Multiply',
          ['Subtract', 'x', 1],
          ['Add', ['Power', 'ExponentialE', 'x'], 1],
        ],
        0,
      ],
      2
    );
    expect(answer.toString()).toBe(
      '[1,2i * pi * ArbitraryInteger(1) + i * pi]'
    );
  });

  test.each([
    ['e^x = -1', ['Equal', ['Power', 'ExponentialE', 'x'], -1], 1],
    [
      'e^x + 1 = 0',
      ['Equal', ['Add', ['Power', 'ExponentialE', 'x'], 1], 0],
      1,
    ],
    ['2^x = -1', ['Equal', ['Power', 2, 'x'], -1], 1],
    ['2^x = 8', ['Equal', ['Power', 2, 'x'], 8], 1],
    [
      'e^(x + 1) = -2',
      ['Equal', ['Power', 'ExponentialE', ['Add', 'x', 1]], -2],
      1,
    ],
    [
      '2e^(3x + 1) = 5',
      [
        'Equal',
        [
          'Multiply',
          2,
          ['Power', 'ExponentialE', ['Add', ['Multiply', 3, 'x'], 1]],
        ],
        5,
      ],
      1,
    ],
    [
      'e^(ix) = -1',
      [
        'Equal',
        ['Power', 'ExponentialE', ['Multiply', 'ImaginaryUnit', 'x']],
        -1,
      ],
      1,
    ],
    ['e^x = i', ['Equal', ['Power', 'ExponentialE', 'x'], 'ImaginaryUnit'], 1],
    [
      'e^(2x) - 3e^x + 2 = 0',
      [
        'Equal',
        [
          'Add',
          ['Power', 'ExponentialE', ['Multiply', 2, 'x']],
          ['Multiply', -3, ['Power', 'ExponentialE', 'x']],
          2,
        ],
        0,
      ],
      2,
    ],
    [
      'e^x + e^(-x) = 3',
      [
        'Equal',
        [
          'Add',
          ['Power', 'ExponentialE', 'x'],
          ['Power', 'ExponentialE', ['Negate', 'x']],
        ],
        3,
      ],
      2,
    ],
    ['sinh x = 1', ['Equal', ['Sinh', 'x'], 1], 2],
    ['cosh x = 0', ['Equal', ['Cosh', 'x'], 0], 2],
    ['cosh x = 2', ['Equal', ['Cosh', 'x'], 2], 2],
    ['tanh x = 2', ['Equal', ['Tanh', 'x'], 2], 1],
    ['tanh x = 1/2', ['Equal', ['Tanh', 'x'], ['Rational', 1, 2]], 1],
    // The root 0 of the factor x is in the family 2πik
    [
      'x(e^x - 1) = 0',
      [
        'Equal',
        ['Multiply', 'x', ['Subtract', ['Power', 'ExponentialE', 'x'], 1]],
        0,
      ],
      1,
    ],
  ])('%s gives its families of roots', (_label, eq, count) => {
    expectFamilies(eq as any[], count as number);
  });

  test.each([
    ['e^x = -1', ['Equal', ['Power', 'ExponentialE', 'x'], -1], 1],
    [
      '(x - 1)(e^x + 1) = 0',
      [
        'Equal',
        [
          'Multiply',
          ['Subtract', 'x', 1],
          ['Add', ['Power', 'ExponentialE', 'x'], 1],
        ],
        0,
      ],
      2,
    ],
    ['cosh x = 2', ['Equal', ['Cosh', 'x'], 2], 2],
  ])('%s over the complex numbers gives its families', (_label, eq, count) => {
    expectFamilies(eq as any[], count as number, [
      'Element',
      'x',
      'ComplexNumbers',
    ]);
  });

  test('e^x = 0 and tanh x = 1 have no root', () => {
    expect(solve(['Equal', ['Power', 'ExponentialE', 'x'], 0]).nops).toBe(0);
    expect(solve(['Equal', ['Tanh', 'x'], 1]).nops).toBe(0);
    expect(
      solve([
        'Equal',
        ['Multiply', ['Subtract', 'x', 2], ['Exp', 'x']],
        0,
      ]).toString()
    ).toBe('[2]');
  });

  test('an unknown declared real keeps its real roots', () => {
    const real = new ComputeEngine();
    real.declare('y', 'real');
    expect(
      real
        .box(['Solve', ['Equal', ['Power', 'ExponentialE', 'y'], 2], 'y'])
        .evaluate()
        .toString()
    ).toBe('[ln(2)]');
    expect(
      solve(
        ['Equal', ['Power', 'ExponentialE', 'x'], 2],
        ['Element', 'x', 'RealNumbers']
      ).toString()
    ).toBe('[ln(2)]');
  });

  test.each([
    // `x² = ln 2 + 2πik`: two roots for each `k`
    ['e^(x²) = 2', ['Equal', ['Power', 'ExponentialE', ['Power', 'x', 2]], 2]],
    // `sin x = ln 2 + 2πik`
    ['e^(sin x) = 2', ['Equal', ['Power', 'ExponentialE', ['Sin', 'x']], 2]],
    // `sin x = kπ` has complex roots for `k ≠ 0`
    ['sin(sin x) = 0', ['Equal', ['Sin', ['Sin', 'x']], 0]],
    ['sin(cos x) = 0', ['Equal', ['Sin', ['Cos', 'x']], 0]],
    // `sin x = 2` has complex roots, `sin x = 1/2` only real ones
    [
      '(sin x - 2)(sin x - 1/2) = 0',
      [
        'Equal',
        [
          'Multiply',
          ['Subtract', ['Sin', 'x'], 2],
          ['Subtract', ['Sin', 'x'], ['Rational', 1, 2]],
        ],
        0,
      ],
    ],
  ])('%s stays unevaluated', (_label, eq) => {
    expect(solve(eq).operator).toBe('Solve');
  });

  test.each([
    // An identity: every x is a root, and `[]` would read as "no root"
    [
      'e^x = e^x',
      ['Equal', ['Power', 'ExponentialE', 'x'], ['Power', 'ExponentialE', 'x']],
    ],
    // Alternatives, a chain and a list are solved with the real roots only
    [
      'e^x = 2 or x = 1',
      ['Or', ['Equal', ['Power', 'ExponentialE', 'x'], 2], ['Equal', 'x', 1]],
    ],
    [
      'e^x = 2 = e^x',
      [
        'Equal',
        ['Power', 'ExponentialE', 'x'],
        2,
        ['Power', 'ExponentialE', 'x'],
      ],
    ],
    [
      '[e^x = 1, e^(2x) = 1]',
      [
        'List',
        ['Equal', ['Power', 'ExponentialE', 'x'], 1],
        ['Equal', ['Power', 'ExponentialE', ['Multiply', 2, 'x']], 1],
      ],
    ],
  ])('%s stays unevaluated', (_label, eq) => {
    expect(solve(eq).operator).toBe('Solve');
  });

  test('a power of a very large degree in e^x is not expanded', () => {
    const eq = [
      'Equal',
      [
        'Divide',
        ['Power', 'ExponentialE', 'x'],
        [
          'Power',
          ['Add', 1, ['Power', 'ExponentialE', ['Multiply', 64, 'x']]],
          1000000,
        ],
      ],
      2,
    ];
    expect(solve(eq).operator).toBe('Solve');
  });

  test('a family cannot express a type narrower than complex', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'imaginary');
    expect(
      engine
        .box(['Solve', ['Equal', ['Power', 'ExponentialE', 'y'], 2], 'y'])
        .evaluate().operator
    ).toBe('Solve');
  });

  test('a family cannot express an assumption about the unknown', () => {
    const engine = new ComputeEngine();
    engine.assume(engine.box(['NotEqual', 'x', 1]));
    expect(
      engine
        .box(['Solve', ['Equal', ['Power', 'ExponentialE', 'x'], 2], 'x'])
        .evaluate().operator
    ).toBe('Solve');
  });

  test('over the real numbers, sin(sin x) = 0 is πk', () => {
    expect(
      solve(
        ['Equal', ['Sin', ['Sin', 'x']], 0],
        ['Element', 'x', 'RealNumbers']
      ).toString()
    ).toBe('[pi * ArbitraryInteger(1)]');
  });
});
