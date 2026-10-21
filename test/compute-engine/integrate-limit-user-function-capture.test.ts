import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { rewriteWithBinders } from '../../src/compute-engine/boxed-expression/binders';

// The variable of `Integrate` and of `Limit` never reads a symbol inside a
// called user function, whether or not the symbol has a value (the decision
// of 2026-09-21 in `docs/SCOPING-MODEL.md`). With `g := a ↦ a·k·x`, the
// integral `∫₀¹ g(k) dk` is the integral of `t ↦ t·k·x`, where `k` is the
// global `k`: it is `∫₀¹ g(t) dt`. These operators inline the body of `g`
// and select the variable by its name, so the `k` of the body became the
// variable: with `k := 2`, `∫₀¹ g(k) dk` was `x/3` instead of `x`, and
// `lim_{k→1} g(k)` was `x` instead of `2x`. The variable is now renamed to a
// fresh name before the body is inlined. `Solve` has the same capture, and
// its unknown is renamed the same way: with `h := a ↦ a − k`,
// `Solve(h(k) = 1, k)` is solved as `Solve(h(t) = 1, t)`. It was `[]`, then
// it stayed unsolved.
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

  // With `k := 2`, `h(t) = 1` is `t − 2 = 1`. With the unknown `k`, the
  // `k` of the body of `h` is the global `k`, not the unknown.
  test('Solve renames the unknown that the body reads', () => {
    const ce = engine(shape, true);
    ce.assign('h', ce.parse('a \\mapsto a - k'));
    expect(evaluate(ce, '\\operatorname{Solve}(h(k)=1, k)')).toBe('[3]');
    expect(evaluate(ce, '\\operatorname{Solve}(h(t)=1, t)')).toBe('[3]');
  });

  // With `k` valueless, `h(t) = 1` is `t − k = 1`, so `t = k + 1`.
  test('Solve renames the unknown, valueless global k', () => {
    const ce = engine(shape, false);
    ce.assign('h', ce.parse('a \\mapsto a - k'));
    expect(evaluate(ce, '\\operatorname{Solve}(h(k)=1, k)')).toBe('[k + 1]');
    expect(evaluate(ce, '\\operatorname{Solve}(h(t)=1, t)')).toBe('[k + 1]');
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
  // which is in 1..3. With the unknown `k`, the unknown is renamed, and the
  // `k` of the body of `h` stays the global `k`.
  test.each([
    ['k', '[3]'],
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

// The unknown is renamed in each shape of the operands of `Solve`: a spec
// with a domain, and a system with a list of unknowns. With `k := 2` and
// `h := a ↦ a − k`: `h(k) = 0` over 1..3 is `k = 2`, and the system
// `h(k) + y = 1, k − y = 0` is `k − 2 + y = 1, k = y`, so `k = y = 3/2`.
// With `k` valueless, the system gives `k₁ = y = (k + 1)/2` in terms of the
// global `k`, and the domain spec stays unsolved: a candidate `c` of 1..3
// gives `c − k`, which is zero only when `k = c`.
describe('Solve renames a captured unknown in its spec shapes', () => {
  function solveEngine(valued: boolean) {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    if (valued) ce.assign('k', 2);
    ce.assign('h', ce.parse('a \\mapsto a - k'));
    return ce;
  }
  const domain = [
    'Solve',
    ['Equal', ['h', 'k'], 0],
    ['Element', 'k', ['Range', 1, 3]],
  ];
  const system = [
    'Solve',
    [
      'List',
      ['Equal', ['Add', ['h', 'k'], 'y'], 1],
      ['Equal', ['Subtract', 'k', 'y'], 0],
    ],
    ['List', 'k', 'y'],
  ];

  test('a domain spec, k := 2', () => {
    const ce = solveEngine(true);
    expect(
      ce
        .box(domain as never)
        .evaluate()
        .toString()
    ).toBe('[2]');
  });

  test('a system, k := 2', () => {
    const ce = solveEngine(true);
    expect(
      ce
        .box(system as never)
        .evaluate()
        .toString()
    ).toBe('[(3/2, 3/2)]');
  });

  test('a domain spec, valueless k: unsolved', () => {
    const ce = solveEngine(false);
    expect(ce.box(domain as never).evaluate().operator).toBe('Solve');
  });

  test('a system, valueless k', () => {
    const ce = solveEngine(false);
    expect(
      ce
        .box(system as never)
        .evaluate()
        .toString()
    ).toBe('[(1/2 * k + 1/2, 1/2 * k + 1/2)]');
  });

  test('NSolve', () => {
    const ce = solveEngine(true);
    expect(
      ce
        .box(['NSolve', ['Equal', ['h', 'k'], 1], 'k'] as never)
        .evaluate()
        .toString()
    ).toBe('[3]');
  });

  test('the global k keeps its value and no fresh name is declared', () => {
    const ce = solveEngine(true);
    ce.box(['Solve', ['Equal', ['h', 'k'], 1], 'k'] as never).evaluate();
    expect(ce.box('k').evaluate().toString()).toBe('2');
    expect(ce.lookupDefinition('k_1')).toBeUndefined();
  });
});

// The bounds of a limit are outside the scope of its variable: in
// `∫₀ᵏ k dk`, the upper bound is the global `k`. The canonical form bound it
// to the integration variable, and the integral was `k²/2` with `k := 2`
// where `∫₀ᵏ t dt` is `2`. `Sum` and `Product` have the same `Limits`
// clause: `∏_{k=1}^{k} k` was `k!`.
describe('a bound with the name of the variable reads the enclosing k', () => {
  const ce = new ComputeEngine();
  ce.assign('k', 2);

  test.each([
    ['\\int_0^k k\\,dk', '2'],
    ['\\int_0^k t\\,dt', '2'],
    ['\\int_k^4 k\\,dk', '6'],
    ['\\int_0^{k} \\int_0^k x\\,dk\\,dx', '4'],
    ['\\sum_{k=1}^{k} k', '3'],
    ['\\sum_{k=k}^{5} k', '14'],
    ['\\prod_{k=1}^{k} k', '2'],
    ['\\sum_{j=1}^{3}\\sum_{k=1}^{j} k', '10'],
    ['\\int_0^1\\int_0^x y\\,dy\\,dx', '1/6'],
  ])('%s = %s', (latex, expected) => {
    expect(ce.parse(latex).evaluate().toString()).toBe(expected);
  });

  test('the numeric value', () => {
    expect(ce.parse('\\int_0^k k\\,dk').N().re).toBeCloseTo(2, 12);
  });

  test('the indefinite integral is a function of the variable', () => {
    expect(ce.parse('\\int k\\,dk').evaluate().toString()).toBe('1/2 * k^2');
  });

  test('the bound is the global k in the canonical form', () => {
    const limits = ce.parse('\\int_0^k k\\,dk').ops![1];
    expect(limits.op3.valueDefinition).toBe(ce.box('k').valueDefinition);
    expect(limits.op1.valueDefinition).not.toBe(ce.box('k').valueDefinition);
  });
});

// The renamed solve reads the assumptions about the unknown and its type as
// the unknown itself does. An assumption whose free symbols include the
// unknown is assumed again with the fresh name. A type inferred from the
// uses of a symbol with no value restricts the solutions; a type inferred
// from an assigned value does not.
describe('Solve with a renamed unknown keeps its constraints', () => {
  // `k + h(0) = h(0) − 1` is `k₁ + k = k − 1`, so `k₁ = −1`.
  test('an assumption removes a root', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('a \\mapsto a + k'));
    const eq = ['Equal', ['Add', 'k', ['h', 0]], ['Subtract', ['h', 0], 1]];
    expect(
      ce
        .box(['Solve', eq, 'k'] as never)
        .evaluate()
        .toString()
    ).toBe('[-1]');
    ce.assume(ce.parse('k \\ne -1'));
    expect(
      ce
        .box(['Solve', eq, 'k'] as never)
        .evaluate()
        .toString()
    ).toBe('[]');
  });

  // `k² + h(0) = 4 + h(0)` is `k₁² + k = 4 + k`, so `k₁ = ±2`.
  test('an assumption of a sign keeps one root', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('a \\mapsto a + k'));
    ce.assume(ce.parse('k > 0'));
    expect(
      ce
        .box([
          'Solve',
          ['Equal', ['Add', ['Power', 'k', 2], ['h', 0]], ['Add', 4, ['h', 0]]],
          'k',
        ] as never)
        .evaluate()
        .toString()
    ).toBe('[2]');
  });

  // `k + h(0) = h(0) + c` is `k₁ = c`, and `k` holds integers only.
  test('a type inferred from the uses of a valueless unknown', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('a \\mapsto a + k'));
    ce.declare('k', { type: 'integer', inferred: true });
    const solve = (c: unknown) =>
      ce
        .box([
          'Solve',
          ['Equal', ['Add', 'k', ['h', 0]], ['Add', ['h', 0], c]],
          'k',
        ] as never)
        .evaluate()
        .toString();
    expect(solve(['Rational', 1, 2])).toBe('[]');
    expect(solve(3)).toBe('[3]');
  });

  // `sin(h(k)) = 0` is `sin(k₁ − k) = 0`: a family of roots with a fresh
  // integer parameter `t`, which is declared where the caller can read it.
  test('the parameter of a family of roots is in the caller scope', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('a \\mapsto a - k'));
    const r = ce
      .box(['Solve', ['Equal', ['Sin', ['h', 'k']], 0], 'k'] as never)
      .evaluate();
    expect(r.toString()).toBe('[k + 2pi * t,k + 2pi * t + pi]');
    const t: Expression[] = [];
    const walk = (e: Expression) => {
      if (e.symbol === 't') t.push(e);
      e.ops?.forEach(walk);
    };
    walk(r);
    expect(t.length).toBeGreaterThan(0);
    for (const s of t)
      expect(s.valueDefinition).toBe(ce.box('t').valueDefinition);
  });
});

// The scope of an index excludes the bounds of its `Limits` clause and the
// collection of its `Element` clause, in the canonical form and in every
// walk that reads which names a binder shadows: the free variables, the
// rebinding of an enclosing binder, the rename of an unknown.
describe('the bound of a clause is outside the scope of its index', () => {
  test('a nested sum reads the outer index in its bound', () => {
    const ce = new ComputeEngine();
    // Σ_{k=1}^{3} Σ_{j=1}^{k} j = 1 + 3 + 6
    expect(
      ce.parse('\\sum_{k=1}^{3}\\sum_{k=1}^{k} k').evaluate().toString()
    ).toBe('10');
    const inner = ce.parse('\\sum_{k=1}^{k} k');
    const outer = ce.function('Sum', [
      inner,
      ce.function('Limits', [ce.symbol('k'), ce.number(1), ce.number(3)]),
    ]);
    expect(outer.evaluate().toString()).toBe('10');
    ce.assign('k', 5);
    expect(
      ce.parse('\\sum_{k=1}^{3}\\sum_{k=1}^{k} k').evaluate().toString()
    ).toBe('10');
  });

  test('the free variables of a bound', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^k k\\,dk').unknowns).toEqual(['k']);
    expect(ce.parse('\\sum_{k=1}^{k} k').unknowns).toEqual(['k']);
    expect(ce.parse('\\int_0^1 x\\,dx').unknowns).toEqual([]);
    expect(ce.parse('\\sum_{k=1}^{3}\\sum_{k=1}^{k} k').unknowns).toEqual([]);
  });

  // With `k := 2`: Σ over {1, 2}, Σ over {2, 3} with the condition `k > 1`
  // reading the index, and Π over {2, 3}.
  test.each([
    [['Sum', 'k', ['Element', 'k', ['List', 1, 'k']]], '3'],
    [
      ['Sum', 'k', ['Element', 'k', ['List', 1, 'k', 3], ['Greater', 'k', 1]]],
      '5',
    ],
    [['Product', 'k', ['Element', 'k', ['List', 'k', 3]]], '6'],
  ])('the collection of an Element clause: %j = %s', (json, expected) => {
    const ce = new ComputeEngine();
    ce.assign('k', 2);
    expect(
      ce
        .box(json as never)
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  // `y' = y` on `[0, x]` with `x := 1`: the solution at 0.5 is `e^0.5`.
  test('the interval of NDSolveFunction', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    const f = ce
      .expr([
        'NDSolveFunction',
        ['Equal', ['D', ['y', 'x'], 'x'], ['y', 'x']],
        'y',
        ['Limits', 'x', 0, 'x'],
        1,
      ] as never)
      .evaluate();
    expect(f.operator).toBe('Function');
    expect(
      ce
        .function('Apply', [f, ce.number(0.5)])
        .evaluate()
        .N().re
    ).toBeCloseTo(Math.exp(0.5), 9);
  });

  // The rewrite walk that renames an unknown (`Solve`) or rebinds an
  // enclosing binder's variable visits the bound `k` of `Σ_{k=1}^{k} k` as a
  // free occurrence, and the index and the summand as shadowed ones.
  test('the rewrite walk sees the bound as free', () => {
    const ce = new ComputeEngine();
    const free: string[] = [];
    rewriteWithBinders(ce.parse('\\sum_{k=1}^{k} k'), (s, shadowed) => {
      if (!shadowed?.has(s.symbol)) free.push(s.symbol);
      return s;
    });
    expect(free).toEqual(['k']);
  });
});
