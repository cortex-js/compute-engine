import { ComputeEngine } from '../../src/compute-engine';

// The derivative of a call of a user function differentiates the body of the
// function with the arguments in place of its parameters. The body is taken
// from the function literal and is not evaluated, so an assigned value of a
// symbol of the body is not read. The derivative follows the name of its
// variable into the body of a called function whether or not the variable
// has a value (user decision 2026-10-20): with `h := a ↦ a·x²`,
// `D(h(k), x)` is `2kx`; it was `0` after `x := 5`, because the evaluated
// body was `25k`. A parameter can also be the name of a called function:
// `(f, a) ↦ f(a)` applied to `h` and `k` is `h(k)`.

function engine(valued: boolean): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('h', 'function');
  ce.assign(
    'h',
    ce.box(['Function', ['Multiply', 'a', ['Power', 'x', 2]], 'a'])
  );
  ce.parse('q(a) := a x^2').evaluate();
  ce.declare('G', 'function');
  ce.assign('G', ce.box(['Function', ['f', 'a'], 'f', 'a']));
  ce.declare('G2', 'function');
  ce.assign(
    'G2',
    ce.box(['Function', ['Multiply', ['f', 'a'], 'x'], 'f', 'a'])
  );
  ce.declare('h0', 'function');
  ce.assign('h0', ce.box(['Function', ['Multiply', 'a', 2], 'a']));
  if (valued) ce.assign('x', 5);
  return ce;
}

function d(ce: ComputeEngine, json: unknown): string {
  return ce
    .box(json as any)
    .evaluate()
    .toString();
}

describe.each([
  ['x has no value', false],
  ['x := 5', true],
])('the derivative of a call of a user function, %s', (_, valued) => {
  test('a function declared and then assigned a literal', () => {
    expect(d(engine(valued), ['D', ['h', 'k'], 'x'])).toBe('2k * x');
  });

  test('a function defined with `:=`', () => {
    expect(d(engine(valued), ['D', ['q', 'k'], 'x'])).toBe('2k * x');
  });

  test('a function passed as an argument', () => {
    expect(d(engine(valued), ['D', ['G', 'h', 'k'], 'x'])).toBe('2k * x');
  });

  test('a library function passed as an argument', () => {
    expect(d(engine(valued), ['D', ['G', 'Sin', 'x'], 'x'])).toBe('cos(x)');
  });

  test('a function literal passed as an argument', () => {
    expect(
      d(engine(valued), [
        'D',
        ['G', ['Function', ['Multiply', 't', 'x'], 't'], 'k'],
        'x',
      ])
    ).toBe('k');
  });

  test('a parameter used as a function name, next to the variable', () => {
    // G2(h0, k) = 2k·x
    expect(d(engine(valued), ['D', ['G2', 'h0', 'k'], 'x'])).toBe('2k');
  });

  test('the application of a function literal', () => {
    // `Apply(t ↦ t·x, k)` is `k·x`. The result had the parameter `t` free
    // in it: `t * Apply(Derivative("Apply", 1, 0), (t) => t * x, k)`.
    expect(
      d(engine(valued), [
        'D',
        ['Apply', ['Function', ['Multiply', 't', 'x'], 't'], 'k'],
        'x',
      ])
    ).toBe('k');
  });

  test('the variable written in the expression is not substituted either', () => {
    expect(
      d(engine(valued), ['D', ['Multiply', 'k', ['Power', 'x', 2]], 'x'])
    ).toBe('2k * x');
  });
});

describe('a recursive function', () => {
  test('a body that calls its own function is not expanded', () => {
    // Expanding `f(x) := x·f(x − 1)` would give `f(x − 1) + x·f′(x − 1)`,
    // whose evaluation at a symbolic `x` never ends.
    const ce = new ComputeEngine();
    ce.parse('f(x) := x f(x-1)').evaluate();
    expect(d(ce, ['D', ['f', 'x'], 'x'])).toBe('Apply(Derivative(f, 1), x)');
    expect(d(ce, ['D', ['f', ['Power', 'x', 2]], 'x'])).toBe(
      '2x * Apply(Derivative(f, 1), x^2)'
    );
  });

  test('two functions that call each other', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x g(x-1)').evaluate();
    ce.parse('g(x) := x f(x-1)').evaluate();
    expect(d(ce, ['D', ['f', 'x'], 'x'])).toBe('Apply(Derivative(f, 1), x)');
  });

  test('a function that passes itself as an argument', () => {
    // F(x) = G3(F, x) = x·F(x − 1)
    const ce = new ComputeEngine();
    ce.declare('G3', 'function');
    ce.assign(
      'G3',
      ce.box([
        'Function',
        ['Multiply', 'a', ['h', ['Subtract', 'a', 1]]],
        'h',
        'a',
      ])
    );
    ce.parse('F(x) := \\operatorname{G3}(F, x)').evaluate();
    expect(() => ce.box(['D', ['F', 'x'], 'x']).evaluate()).not.toThrow();
  });
});

describe('calls inside the body and inside the arguments', () => {
  // The value of the derivative of `json` at `x = x0`.
  function at(ce: ComputeEngine, json: unknown, x0: number): number {
    return ce
      .box(json as any)
      .evaluate()
      .subs({ x: ce.number(x0) })
      .N().re;
  }

  test('a call in the body of the function', () => {
    // f(k) = g(k)² = k²x²
    const ce = new ComputeEngine();
    ce.parse('g(t) := t x').evaluate();
    ce.parse('f(t) := g(t)^2').evaluate();
    expect(d(ce, ['D', ['f', 'k'], 'x'])).toBe('2x * k^2');
  });

  test('a call written in a power or an exponential', () => {
    // The rules for a power and an exponential tested `has(x)`, which does
    // not see the `x` in the body of `g`: both derivatives were 0.
    const ce = new ComputeEngine();
    ce.parse('g(t) := t x').evaluate();
    expect(d(ce, ['D', ['Power', ['g', 'k'], 2], 'x'])).toBe('2x * k^2');
    expect(d(ce, ['D', ['Exp', ['g', 'k']], 'x'])).toBe('k * e^(k * x)');
  });

  test('a function composed with itself is expanded', () => {
    // h(h(x)) = (x·x²)·x² = x⁵, and p(p(x)) = x + 2x = 3x
    const ce = engine(false);
    ce.parse('p(t) := t + x').evaluate();
    expect(at(ce, ['D', ['h', ['h', 'x']], 'x'], 1.3)).toBeCloseTo(
      5 * 1.3 ** 4,
      10
    );
    expect(d(ce, ['D', ['p', ['p', 'x']], 'x'])).toBe('3');
  });

  test('a call in an argument is not taken for the parameter', () => {
    // G(h, c(x)) = h(c(x)) = x³·x² = x⁵. The parameter of `G` is named `f`,
    // and a call `f(x)` in the argument must stay a call of the global `f`:
    // with `c` here, a call of `c` stays a call of `c`.
    const ce = engine(false);
    ce.parse('c(a) := a^3').evaluate();
    ce.parse('f(a) := a^3').evaluate();
    expect(at(ce, ['D', ['G', 'h', ['c', 'x']], 'x'], 1.3)).toBeCloseTo(
      5 * 1.3 ** 4,
      10
    );
    expect(at(ce, ['D', ['G', 'h', ['f', 'x']], 'x'], 1.3)).toBeCloseTo(
      5 * 1.3 ** 4,
      10
    );
  });

  test('a function with no body passed as an argument', () => {
    // The call keeps the name of the argument, never the name of the
    // parameter, which is also a global function here.
    const ce = engine(false);
    ce.parse('f(a) := a^3').evaluate();
    ce.declare('u', 'function');
    expect(d(ce, ['D', ['G', 'u', 'x'], 'x'])).toBe(
      'Apply(Derivative(u, 1), x)'
    );
  });

  test('a function applied to itself stays unevaluated', () => {
    const ce = new ComputeEngine();
    const L = ['Function', ['p', 'p', 'a'], 'p', 'a'];
    expect(ce.box(['D', ['Apply', L, L, 'x'], 'x']).evaluate().operator).toBe(
      'D'
    );
    ce.declare('GG', 'function');
    ce.assign('GG', ce.box(L as any));
    expect(ce.box(['D', ['GG', 'GG', 'x'], 'x']).evaluate().operator).toBe('D');
  });

  test('a parameter with the name of the variable', () => {
    // In `q(x) := x²`, the `x` of the body is the parameter: q(k) = k² does
    // not depend on `x`.
    const ce = new ComputeEngine();
    ce.parse('q(x) := x^2').evaluate();
    expect(d(ce, ['D', ['Power', ['q', 'k'], 2], 'x'])).toBe('0');
    expect(d(ce, ['D', ['q', 'x'], 'x'])).toBe('2x');
  });
});

describe('literals with a declared result type or a rest parameter', () => {
  test('a declared result type', () => {
    // The body of the literal is `Typed(t², real)`: the value is used.
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box(['Function', ['Typed', ['Power', 't', 2], "'real'"], 't'])
    );
    expect(d(ce, ['D', ['f', 'x'], 'x'])).toBe('2x');
    expect(d(ce, ['D', ['f', ['Power', 'x', 2]], 'x'])).toBe('4x^3');
  });

  test('a rest parameter binds a tuple, not one argument', () => {
    // R(x) is the tuple `(x)`, whose derivative is `(1)`, not the number 1.
    const ce = new ComputeEngine();
    const L = ['Function', 'args', ['Spread', 'args']];
    ce.declare('R', 'function');
    ce.assign('R', ce.box(L as any));
    expect(d(ce, ['D', ['R', 'x'], 'x'])).toBe('(1)');
    expect(ce.box(['D', ['Apply', L, 'x'], 'x']).evaluate().operator).toBe('D');
  });
});

describe('a free symbol of the body that is not the variable', () => {
  test('its value applies', () => {
    // The derivative of `q` in its parameter is `x²`, and `x` is a free
    // symbol there: with `x := 5` it is 25.
    expect(d(engine(true), ['Apply', ['Derivative', 'q', 1], 'y'])).toBe('25');
    expect(d(engine(false), ['Apply', ['Derivative', 'q', 1], 'y'])).toBe(
      'x^2'
    );
  });
});

// The derivative of a `Sum` is the sum of the derivatives of its terms. The
// derivative of a term that calls a user function is the derivative of the
// body of that function, and that body can read a global symbol with the
// name of the index: with `k := 2` and `g := a ↦ a·k·x`,
// `Σ_{k=1}^{5} g(k)` is `Σ 2kx = 30x`. The derivative in `x` was
// `Σ k² = 55`, because the sum of the derivatives `k·k` read the global `k`
// as the index. The index is now renamed when this occurs (Tycho ledger row
// 412).
describe('a sum index with the name of a symbol that a called function reads', () => {
  function sliderEngine(
    valued: boolean,
    declareFunction = true
  ): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    if (valued) ce.assign('k', 2);
    ce.declare('x', 'real');
    ce.declare('n', 'integer');
    if (declareFunction) ce.declare('g', 'function');
    ce.assign('g', ce.parse('a\\mapsto akx'));
    return ce;
  }

  function at(
    ce: ComputeEngine,
    latex: string,
    values: Record<string, number>
  ): number {
    return ce.parse(latex).evaluate().subs(values).N().re;
  }

  describe.each([
    ['g declared as a function', true],
    ['g assigned only', false],
  ])('%s', (_, declareFunction) => {
    test('the sum itself reads the slider k', () => {
      const ce = sliderEngine(true, declareFunction);
      expect(at(ce, '\\sum_{k=1}^{5}g(k)', { x: 0.3 })).toBeCloseTo(9, 12);
    });

    test('its derivative in x, k := 2', () => {
      const ce = sliderEngine(true, declareFunction);
      expect(
        ce.parse('\\frac{d}{dx}\\sum_{k=1}^{5}g(k)').evaluate().toString()
      ).toBe('30');
    });

    test('the control: the same sum with the index j', () => {
      const ce = sliderEngine(true, declareFunction);
      expect(
        ce.parse('\\frac{d}{dx}\\sum_{j=1}^{5}g(j)').evaluate().toString()
      ).toBe('30');
    });

    test('its derivative in x, k with no value, then k = 2', () => {
      const ce = sliderEngine(false, declareFunction);
      const latex = '\\frac{d}{dx}\\sum_{k=1}^{5}g(k)';
      expect(ce.parse(latex).evaluate().toString()).toBe('15k');
      expect(at(ce, latex, { k: 2, x: 0.3 })).toBeCloseTo(30, 12);
      expect(
        ce.parse('\\frac{d}{dx}\\sum_{j=1}^{5}g(j)').evaluate().toString()
      ).toBe('15k');
    });

    test('a product, k := 2 and k with no value', () => {
      // ∏_{k=1}^{3} 2kx = 48x³, and ∏_{k=1}^{3} k·k·x with k free in the
      // body of g is 6k³x³.
      for (const index of ['k', 'j']) {
        const latex = `\\frac{d}{dx}\\prod_{${index}=1}^{3}g(${index})`;
        expect(
          sliderEngine(true, declareFunction).parse(latex).evaluate().toString()
        ).toBe('144x^2');
        expect(
          at(sliderEngine(false, declareFunction), latex, { k: 2, x: 0.3 })
        ).toBeCloseTo(144 * 0.09, 12);
      }
    });
  });

  test('the index next to the call, and nested sums', () => {
    const ce = sliderEngine(true);
    // Σ_{k=1}^{5} k·2kx = 110x
    expect(
      ce.parse('\\frac{d}{dx}\\sum_{k=1}^{5}k\\,g(k)').evaluate().toString()
    ).toBe('110');
    // Σ_{k=1}^{3} Σ_{j=1}^{k} 2jx = 20x
    expect(
      ce
        .parse('\\frac{d}{dx}\\sum_{k=1}^{3}\\sum_{j=1}^{k}g(j)')
        .evaluate()
        .toString()
    ).toBe('20');
    // Σ_{k=1}^{3} k·Σ_{m=1}^{k} 2mx = 50x
    expect(
      ce
        .parse('\\frac{d}{dx}\\sum_{k=1}^{3}k\\sum_{m=1}^{k}g(m)')
        .evaluate()
        .toString()
    ).toBe('50');
    // A set of values: Σ_{k ∈ {1, 2, 3}} 2kx = 12x
    expect(
      ce
        .box([
          'D',
          ['Sum', ['g', 'k'], ['Element', 'k', ['List', 1, 2, 3]]],
          'x',
        ])
        .evaluate()
        .toString()
    ).toBe('12');
  });

  // The renamed inner sum keeps the binding of each other symbol: an
  // occurrence of the index of the enclosing sum stays bound to it. When the
  // inner sum was boxed again from MathJSON, that occurrence became a global
  // (the outer sum then saw a capture of its own index and renamed it, again
  // and again, until the depth limit) or, for `i`, the imaginary unit.
  test.each([
    // Σ_{j=1}^{3} Σ_{k=1}^{j} 2kx = 20x
    ['\\sum_{j=1}^{3}\\sum_{k=1}^{j}g(k)', '20'],
    // Σ_{j=1}^{2} j·Σ_{k=1}^{3} 2kx = 36x
    ['\\sum_{j=1}^{2}\\sum_{k=1}^{3}j\\,g(k)', '36'],
    // Σ_{i=1}^{3} i·Σ_{k=1}^{5} 2kx = 180x
    ['\\sum_{i=1}^{3}\\sum_{k=1}^{5}i\\,g(k)', '180'],
  ])('an inner sum that is renamed: %s', (latex, expected) => {
    const ce = sliderEngine(true);
    const spy = jest.spyOn(console, 'assert').mockImplementation(() => {});
    try {
      const explanation = ce.box(['D', ce.parse(latex).json, 'x']).explain('D');
      expect(explanation.result.toString()).toBe(expected);
      expect(
        explanation.steps.filter((s) => s.id === 'derivative.rewrite').length
      ).toBe(1);
      expect(ce.parse(`\\frac{d}{dx}${latex}`).evaluate().toString()).toBe(
        expected
      );
      expect(spy.mock.calls.filter(([ok]) => !ok)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  // The differentiation variable `k_1` is only in the body of `g`, and the
  // derivative of the term removes it: it must not be the fresh index.
  // Σ_{k=1}^{5} k·2 = 30 (the control with the index `j` also gives 30).
  test('the fresh index is not the differentiation variable', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'real');
    ce.assign('k', 2);
    ce.declare('k_1', 'real');
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('a\\mapsto a k k_1'));
    for (const index of ['k', 'j'])
      expect(
        ce
          .box(['D', ['Sum', ['g', index], ['Limits', index, 1, 5]], 'k_1'])
          .evaluate()
          .toString()
      ).toBe('30');
  });

  test('a symbolic bound: the index is renamed', () => {
    const ce = sliderEngine(true);
    const result = ce.parse('\\frac{d}{dx}\\sum_{k=1}^{n}g(k)').evaluate();
    expect(JSON.stringify(result.json)).toBe(
      '["Sum",["Multiply","k","k_1"],["Limits","k_1",1,"n"]]'
    );
    expect(result.subs({ n: 5 }).evaluate().toString()).toBe('30');
  });

  test('the box and function routes', () => {
    const ce = sliderEngine(true);
    const sum = ['Sum', ['g', 'k'], ['Limits', 'k', 1, 5]] as const;
    expect(ce.box(['D', sum, 'x']).evaluate().toString()).toBe('30');
    expect(
      ce
        .function('D', [ce.box(sum), ce.symbol('x')])
        .evaluate()
        .toString()
    ).toBe('30');
  });
});
