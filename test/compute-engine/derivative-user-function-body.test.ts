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
