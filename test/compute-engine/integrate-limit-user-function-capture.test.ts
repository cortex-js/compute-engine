import { ComputeEngine } from '../../src/compute-engine';

// The variable of `Integrate` and of `Limit` never reads a symbol inside a
// called user function, whether or not the symbol has a value (the decision
// of 2026-09-21 in `docs/SCOPING-MODEL.md`). With `g := a ↦ a·k·x`, the
// integral `∫₀¹ g(k) dk` is the integral of `t ↦ t·k·x`, where `k` is the
// global `k`: it is `∫₀¹ g(t) dt`. These operators inline the body of `g`
// and select the variable by its name, so the `k` of the body became the
// variable: with `k := 2`, `∫₀¹ g(k) dk` was `x/3` instead of `x`, and
// `lim_{k→1} g(k)` was `x` instead of `2x`. The variable is now renamed to a
// fresh name before the body is inlined. `Solve` has the same capture: it
// stays unsolved instead of giving `[]`.
//
// Two definition shapes hold the function literal: a name assigned with no
// declaration has an operator definition, and a name declared with a
// function type and then assigned has a value definition whose value is the
// literal. Both give the same answers (the second one left `Integrate`
// unevaluated before).

function engine(shape: 'assigned' | 'declared', valued: boolean) {
  const ce = new ComputeEngine();
  ce.declare('k', 'real');
  if (valued) ce.assign('k', 2);
  ce.declare('x', 'real');
  if (shape === 'declared') ce.declare('g', '(real) -> real');
  ce.assign('g', ce.parse('a \\mapsto a k x'));
  return ce;
}

function evaluate(ce: ComputeEngine, latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

describe.each([
  ['assigned', 'assigned'],
  ['declared, then assigned', 'declared'],
] as const)('a user function %s', (_, shape) => {
  describe('that reads the global k := 2', () => {
    test.each([
      ['\\int_0^1 g(k)\\,dk', 'x'],
      ['\\int_0^1 g(t)\\,dt', 'x'],
      ['\\int g(k)\\,dk', 'x * k^2'],
      ['\\int g(t)\\,dt', 'x * t^2'],
      ['\\lim_{k\\to 1} g(k)', '2x'],
      ['\\lim_{t\\to 1} g(t)', '2x'],
      ['\\sum_{k=1}^{5} g(k)', '30x'],
    ])('%s = %s', (latex, expected) => {
      expect(evaluate(engine(shape, true), latex)).toBe(expected);
    });

    test('the numeric limit', () => {
      const ce = engine(shape, true);
      expect(ce.parse('\\lim_{k\\to 1} g(k)').N().toString()).toBe('2x');
    });
  });

  describe('that reads the valueless global k', () => {
    test.each([
      ['\\int_0^1 g(k)\\,dk', '1/2 * k * x'],
      ['\\int_0^1 g(t)\\,dt', '1/2 * k * x'],
      ['\\lim_{k\\to 1} g(k)', 'k * x'],
      ['\\lim_{t\\to 1} g(t)', 'k * x'],
      ['\\sum_{k=1}^{5} g(k)', '15k * x'],
    ])('%s = %s', (latex, expected) => {
      expect(evaluate(engine(shape, false), latex)).toBe(expected);
    });

    // The antiderivative is a function of the variable, and the result also
    // holds the global `k`: the variable keeps its fresh name, because the
    // two symbols would otherwise have the same name.
    test('an indefinite integral keeps the fresh name', () => {
      expect(evaluate(engine(shape, false), '\\int g(k)\\,dk')).toBe(
        '1/2 * k * x * "k_1"^2'
      );
    });
  });

  test('Solve stays unsolved instead of finding no solution', () => {
    const ce = engine(shape, true);
    ce.assign('h', ce.parse('a \\mapsto a - k'));
    expect(evaluate(ce, '\\operatorname{Solve}(h(k)=1, k)')).toBe(
      'Solve(h(k) == 1, k)'
    );
    expect(evaluate(ce, '\\operatorname{Solve}(h(t)=1, t)')).toBe('[3]');
  });
});

describe('the routes that build the expression', () => {
  const ce = engine('assigned', true);

  test('Integrate from MathJSON', () => {
    expect(
      ce
        .box(['Integrate', ['g', 'k'], ['Limits', 'k', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('x');
  });

  test('Integrate from boxed operands', () => {
    expect(
      ce
        .function('Integrate', [
          ce.box(['g', 'k']),
          ce.function('Limits', [ce.symbol('k'), ce.number(0), ce.number(1)]),
        ])
        .evaluate()
        .toString()
    ).toBe('x');
  });

  test('Limit from MathJSON', () => {
    expect(
      ce
        .box(['Limit', ['Function', ['g', 'k'], 'k'], 1])
        .evaluate()
        .toString()
    ).toBe('2x');
  });

  test('Limit from boxed operands', () => {
    expect(
      ce
        .function('Limit', [ce.box(['g', 'k']), ce.symbol('k'), ce.number(1)])
        .evaluate()
        .toString()
    ).toBe('2x');
  });

  test('Solve inlines a function declared with a function type', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('q', '(real) -> real');
    ce.assign('q', ce.parse('a \\mapsto 2a + x'));
    expect(evaluate(ce, '\\operatorname{Solve}(q(t)=1, t)')).toBe(
      '[-1/2 * x + 1/2]'
    );
  });

  // Each inlined body of a recursive function holds a new call. The call is
  // not inlined, and its evaluation stops at the recursion limit. Inlining
  // it ran for about 11 s and ended with a stack overflow.
  test.each([['assigned'], ['declared']])(
    'a recursive function, %s, is not inlined',
    (shape) => {
      const ce = new ComputeEngine();
      ce.recursionLimit = 64;
      if (shape === 'declared') ce.declare('r', 'function');
      ce.parse('r(x) := r(x-1) + 1').evaluate();
      let thrown: unknown;
      try {
        ce.parse('\\int_0^1 x^2 + r(3)\\,dx').evaluate();
      } catch (e) {
        thrown = e;
      }
      expect((thrown as Error | undefined)?.name).toBe('CancellationError');
    }
  );

  test('a function that calls the function', () => {
    ce.assign('p', ce.parse('b \\mapsto g(b) + 1'));
    expect(evaluate(ce, '\\int_0^1 p(k)\\,dk')).toBe('x + 1');
  });
});

// The bounds of an integral and the point of a limit are outside the scope of
// the variable. A symbol in them keeps its binding when the variable is
// renamed, and the fresh name is not the name of a symbol in them. Each value
// is checked against the same expression written with the variable `t`, and
// by hand: with `k := 2`, `g(t) = 2·t·x`.
describe('the bounds and the point keep their symbols', () => {
  test.each([
    // ∫₀^{k_1} 2·t·x dt = x·k_1²
    ['\\int_0^{k_1} g(k)\\,dk', 'x * "k_1"^2'],
    ['\\int_0^{k_1} g(t)\\,dt', 'x * "k_1"^2'],
    // lim_{t→k_1} 2·t·x = 2·k_1·x
    ['\\lim_{k\\to k_1} g(k)', '2 * "k_1" * x'],
    ['\\lim_{t\\to k_1} g(t)', '2 * "k_1" * x'],
    // ∫₀² 2·t·x dt = 4x: the bound is the global `k`
    ['\\int_0^k g(k)\\,dk', '4x'],
    ['\\int_0^k g(t)\\,dt', '4x'],
    // Σ_{j=1}^{2} ∫₀^j 2·t·x dt = Σ_{j=1}^{2} j²·x = 5x: the bound is the
    // index of the sum
    ['\\sum_{k=1}^{2} \\int_0^k g(k)\\,dk', '5x'],
    ['\\sum_{k=1}^{2} \\int_0^k g(t)\\,dt', '5x'],
  ])('%s = %s', (latex, expected) => {
    const ce = engine('assigned', true);
    ce.declare('k_1', 'real');
    expect(evaluate(ce, latex)).toBe(expected);
  });

  test.each([
    ['Integrate(g(k), Limits(k, 0, k_1))', 'k'],
    ['Integrate(g(t), Limits(t, 0, k_1))', 't'],
  ])('%s with g := a ↦ a·k', (_, v) => {
    // ∫₀^{k_1} 2·t dt = k_1²
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.assign('k', 2);
    ce.declare('k_1', 'real');
    ce.assign('g', ce.parse('a \\mapsto a k'));
    expect(
      ce
        .box(['Integrate', ['g', v], ['Limits', v, 0, 'k_1']])
        .evaluate()
        .toString()
    ).toBe('"k_1"^2');
  });

  test.each([
    ['\\sum_{k=1}^{2} \\int_0^k g(k)\\,dk'],
    ['\\sum_{k=1}^{2} \\int_0^k g(t)\\,dt'],
  ])('%s with the valueless global k', (latex) => {
    // Σ_{j=1}^{2} ∫₀^j t·k·x dt = Σ_{j=1}^{2} j²/2·k·x = 5/2·k·x
    expect(evaluate(engine('assigned', false), latex)).toBe('5/2 * k * x');
  });

  test.each([
    ['k ↦ ∫₀^k g(k) dk', 'R := k \\mapsto \\int_0^k g(k)\\,dk'],
    ['k ↦ ∫₀^k g(t) dt', 'R := k \\mapsto \\int_0^k g(t)\\,dt'],
  ])('a function parameter as the bound: %s', (_, definition) => {
    // ∫₀⁵ 2·t·x dt = 25x
    const ce = engine('assigned', true);
    ce.parse(definition).evaluate();
    expect(evaluate(ce, 'R(5)')).toBe('25x');
  });

  test.each([
    ['k', 'y'],
    ['t', 'y'],
  ])(
    'the bound of a later limit reads the variable %s of an earlier limit',
    (v, y) => {
      // ∫₀¹ ∫₀^t 2·t dy dt = ∫₀¹ 2·t² dt = 2/3 (a triangle)
      const ce = new ComputeEngine();
      ce.declare('k', 'real');
      ce.assign('k', 2);
      ce.declare(y, 'real');
      ce.assign('g', ce.parse('a \\mapsto a k'));
      expect(
        ce
          .box([
            'Integrate',
            ['g', v],
            ['Limits', v, 0, 1],
            ['Limits', y, 0, v],
          ])
          .evaluate()
          .toString()
      ).toBe('2/3');
    }
  );

  // The fresh name is not the name of a declared symbol, with or without a
  // value: here `k_1` is declared, so the variable is `k_2`. Otherwise the
  // antiderivative would be a function of the symbol `k_1` of the user.
  test('the fresh name is not a declared name', () => {
    const ce = engine('assigned', false);
    ce.declare('k_1', 'real');
    // ∫ t·k·x dt = 1/2·k·x·t², with the fresh variable `k_2` for `t`
    expect(evaluate(ce, '\\int g(k)\\,dk + k_1')).toBe(
      '1/2 * k * x * "k_2"^2 + "k_1"'
    );
  });
});

describe('the other routes of a captured integral', () => {
  test.each([['k'], ['t']])('the numeric value of ∫₀¹ w(%s)', (v) => {
    // With `w := a ↦ a·k` and `k := 2`: ∫₀¹ 2·t dt = 1
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.assign('k', 2);
    ce.assign('w', ce.parse('a \\mapsto a k'));
    expect(ce.parse(`\\int_0^1 w(${v})\\,d${v}`).N().re).toBeCloseTo(1, 12);
  });

  test.each([['k'], ['t']])('an integral over the real line in %s', (v) => {
    // With `w := a ↦ 1/(a² + k²)` and `k := 2`:
    // ∫_{−∞}^{∞} dt/(t² + 4) = [arctan(t/2)/2]_{−∞}^{∞} = π/2
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.assign('k', 2);
    ce.assign('w', ce.parse('a \\mapsto \\frac{1}{a^2+k^2}'));
    const integral = ce.parse(`\\int_{-\\infty}^{\\infty} w(${v})\\,d${v}`);
    expect(integral.evaluate().toString()).toBe('1/2 * pi');
    expect(integral.N().re).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe.each([
  ['assigned', 'assigned'],
  ['declared, then assigned', 'declared'],
] as const)('Solve with a bundled domain, %s', (_, shape) => {
  // With `k := 2` and `h := a ↦ a − k`: `h(t) = 1` is `t − 2 = 1`, so `t = 3`,
  // which is in 1..3. With the unknown `k`, the body of `h` would read the
  // unknown: the equation stays unsolved instead of giving `[]`.
  test.each([
    ['k', undefined],
    ['t', '[3]'],
  ])('Solve({h(%s) = 1, %s ∈ 1..3})', (v, expected) => {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.assign('k', 2);
    if (shape === 'declared') ce.declare('h', '(real) -> real');
    ce.assign('h', ce.parse('a \\mapsto a - k'));
    const result = ce
      .box([
        'Solve',
        ['List', ['Equal', ['h', v], 1], ['Element', v, ['Range', 1, 3]]],
      ])
      .evaluate();
    if (expected === undefined) expect(result.operator).toBe('Solve');
    else expect(result.toString()).toBe(expected);
  });
});
