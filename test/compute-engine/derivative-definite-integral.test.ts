import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const derivative = (latex: string) => ce.parse(latex).evaluate().toString();

// The derivative of a definite integral is the derivative of its closed form
// when it has one. Otherwise it is the Leibniz rule:
//   d/dv ∫_a^b f(x, v) dx = ∫_a^b ∂f/∂v dx + f(b, v)·b′ − f(a, v)·a′
describe('THE DERIVATIVE OF A DEFINITE INTEGRAL', () => {
  test('with respect to a variable of the integrand', () => {
    expect(derivative('\\frac{d}{dy}\\int_0^1 xy\\,dx')).toBe('1/2');
    expect(derivative('\\frac{d}{dy}\\int_0^1 \\sin(xy)\\,dx')).toBe(
      '(y * sin(y) + cos(y)) / y^2 - y^(-2)'
    );
  });

  test('the same integral built by each route', () => {
    const integral = ['Integrate', ['Multiply', 'x', 'y'], ['Limits', 'x', 0, 1]];
    expect(ce.box(['D', integral, 'y']).evaluate().toString()).toBe('1/2');
    expect(
      ce.function('D', [ce.box(integral), ce.symbol('y')]).evaluate().toString()
    ).toBe('1/2');
  });

  test('with respect to the integration variable', () => {
    // The `x` of the integrand is the integration variable, not the `x` of
    // the derivative: the integral is constant in `x`.
    expect(derivative('\\frac{d}{dx}\\int_0^1 xy\\,dx')).toBe('0');
    expect(derivative('\\frac{d}{dz}\\int_0^1 xy\\,dx')).toBe('0');
  });

  test('a closed form that holds on a set only keeps its condition', () => {
    expect(derivative('\\frac{d}{dy}\\int_0^1 x^y\\,dx')).toBe(
      'If(0 < y + 1, -1 / (y + 1)^2)'
    );
    expect(derivative('\\frac{d}{dy}\\int_0^\\infty e^{-xy}\\,dx')).toBe(
      'If(0 < y, -1 / y^2)'
    );
  });

  test('an integral with no closed form is differentiated under the integral sign', () => {
    const result = ce.parse('\\frac{d}{dy}\\int_0^1 e^{x^3 y}\\,dx').evaluate();
    expect(result.toString()).toBe('int_(0)^(1)(x^3 * e^(y * x^3) dx)');
    // The central difference of the integral at y = 0.5.
    const at = (y: number) =>
      ce
        .parse(`\\int_0^1 e^{x^3 \\cdot ${y}}\\,dx`)
        .N().re;
    const h = 1e-4;
    expect(result.subs({ y: 0.5 }).N().re).toBeCloseTo(
      (at(0.5 + h) - at(0.5 - h)) / (2 * h),
      7
    );
  });

  test('a bound that depends on the variable', () => {
    // The fundamental theorem of calculus.
    expect(derivative('\\frac{d}{dx}\\int_0^x e^{t^3}\\,dt')).toBe('e^(x^3)');
    expect(derivative('\\frac{d}{dy}\\int_y^{y^2} e^{x^3}\\,dx')).toBe(
      '2y * e^(y^6) - e^(y^3)'
    );
    // Both the integrand and a bound depend on the variable.
    expect(derivative('\\frac{d}{dy}\\int_0^y e^{x^3 y}\\,dx')).toBe(
      'e^(y^4) + int_(0)^(y)(x^3 * e^(y * x^3) dx)'
    );
  });

  test('an integrand that is an unknown function', () =>
    expect(derivative('\\frac{d}{dy}\\int_0^1 f(x,y)\\,dx')).toBe(
      'int_(0)^(1)(Apply(Derivative(f, 0, 1), x, y) dx)'
    ));

  test('an integral over two variables', () =>
    expect(derivative('\\frac{d}{dz}\\int_0^1\\int_0^2 xyz\\,dx\\,dy')).toBe(
      '1'
    ));

  test('an integral over two variables with no closed form', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            ['Exp', ['Multiply', ['Power', 'x', 3], ['Power', 'z', 3], 'y']],
            ['Limits', 'x', 0, 1],
            ['Limits', 'z', 0, 1],
          ],
          'y',
        ])
        .evaluate()
        .toString()
    ).toBe(
      'int_(0)^(1)(int_(0)^(1)(x^3 * z^3 * e^(y * x^3 * z^3) dz) dx)'
    ));

  test('a singularity that does not move with the variable', () =>
    expect(derivative('\\frac{d}{dy}\\int_0^2 e^{x^3}\\ln(y)\\,dx')).toBe(
      'int_(0)^(2)(e^(x^3) / y dx)'
    ));

  test('the integral of a list is a list', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            ['List', 'x', ['Power', 'x', 2]],
            ['Limits', 'x', 0, 1],
          ],
          'y',
        ])
        .evaluate()
        .toString()
    ).toBe('[0,0]'));

  // The body of `g` reads the global `x`, which is not the integration
  // variable: `∫_0^1 g(x) dx` is `x/2`.
  test('a called function that reads a global with the name of the integration variable', () => {
    const engine = new ComputeEngine();
    engine.parse('g(a) := a x').evaluate();
    const value = (json: Parameters<typeof engine.box>[0]) =>
      engine.box(json).evaluate().toString();
    expect(
      value(['D', ['Integrate', ['g', 'x'], ['Limits', 'x', 0, 1]], 'x'])
    ).toBe('1/2');
    expect(
      value([
        'D',
        ['Integrate', ['Multiply', ['g', 'x'], 'y'], ['Limits', 'x', 0, 1]],
        'y',
      ])
    ).toBe('1/2 * x');
    // No closed form: under the integral sign, the integration variable
    // would capture the global `x`.
    expect(
      engine
        .box([
          'D',
          [
            'Integrate',
            ['Exp', ['Power', ['g', 'x'], 3]],
            ['Limits', 'x', 0, 'x'],
          ],
          'x',
        ])
        .evaluate().operator
    ).toBe('D');
  });

  // The derivative of a function literal is cached. The closed form read the
  // value of `a`, so a new value of `a` gives a new derivative.
  test('a closed form that reads an assigned value', () => {
    const engine = new ComputeEngine();
    engine.assign('a', 2);
    const f = engine.box([
      'Function',
      ['Integrate', ['Multiply', 'a', 'x', 'y'], ['Limits', 'x', 0, 1]],
      'y',
    ]);
    const derivativeAt3 = () =>
      engine.box(['Apply', ['Derivative', f], 3]).evaluate().toString();
    expect(derivativeAt3()).toBe('1');
    engine.assign('a', 4);
    expect(derivativeAt3()).toBe('2');
  });

  test('the steps of the Leibniz rule are explained', () => {
    const explanation = ce
      .parse('\\frac{d}{dx}\\int_0^x e^{t^3}\\,dt')
      .explain('D');
    expect(explanation.steps[0].id).toBe('derivative.leibniz-rule');
    expect(explanation.result.toString()).toBe('e^(x^3)');
  });

  test('the steps of the derivative of the integrand are explained', () => {
    const explanation = ce
      .parse('\\frac{d}{dy}\\int_0^1 \\sin(x^3 y)\\,dx')
      .explain('D');
    expect(explanation.steps.map((s) => s.id)).toEqual([
      'derivative.leibniz-rule',
      'derivative.rewrite',
      'derivative.chain-rule',
      'derivative.product-rule',
      'derivative.simplify',
    ]);
    expect(explanation.result.toString()).toBe(
      'int_(0)^(1)(cos(y * x^3) * x^3 dx)'
    );
  });
});

describe('THE DERIVATIVE OF A DEFINITE INTEGRAL THAT STAYS UNEVALUATED', () => {
  // For 0 < y < 1 the integral is ∫_y^{2+y} ⌊t⌋ dt, whose derivative is
  // ⌊2 + y⌋ − ⌊y⌋ = 2. Under the integral sign, the derivative of the step
  // is 0 between its jumps, and would give 0.
  test('an integrand with a step in the variable', () => {
    expect(derivative('\\frac{d}{dy}\\int_0^2 \\lfloor x+y \\rfloor\\,dx')).toBe(
      'D(int_(0)^(2)(floor(x + y) dx), y)'
    );
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            ['If', ['Less', 'x', 'y'], 1, 0],
            ['Limits', 'x', 0, 1],
          ],
          'y',
        ])
        .evaluate().operator
    ).toBe('D');
  });

  // The derivative of ∫_0^2 ln|x − y| dx is ln|y| − ln|2 − y|, but the
  // integral of the derivative of the integrand, −sign(x − y)/|x − y|,
  // diverges for 0 < y < 2.
  test('an integrand with a singularity that moves with the variable', () =>
    expect(
      derivative('\\frac{d}{dy}\\int_0^2 e^{x^3}\\ln|x-y|\\,dx')
    ).toBe('D(int_(0)^(2)(ln(|x - y|) * e^(x^3) dx), y)'));

  test('a bound that depends on the variable, over two variables', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            ['Exp', ['Multiply', ['Power', 'x', 3], ['Power', 'z', 3]]],
            ['Limits', 'x', 0, 'y'],
            ['Limits', 'z', 0, 1],
          ],
          'y',
        ])
        .evaluate().operator
    ).toBe('D'));

  // The value of the body at the bound `k·y` replaces `x` by `k·y`, and the
  // index `k` of the sum would capture the `k` of the bound.
  test('a binder in the body with a name that the bound reads', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            [
              'Exp',
              [
                'Power',
                ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 3]],
                3,
              ],
            ],
            ['Limits', 'x', 0, ['Multiply', 'k', 'y']],
          ],
          'y',
        ])
        .evaluate().operator
    ).toBe('D'));

  // The integral is y·e^(−y²), whose derivative at y = 0 is 1. Under the
  // integral sign, the pole of x^(−2) at x = 0 gives 0 at y = 0.
  test('an integrand with a pole in the integration variable', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            [
              'Multiply',
              ['Power', 'y', 3],
              ['Power', 'x', -2],
              [
                'Exp',
                ['Negate', ['Multiply', ['Power', 'y', 2], ['Power', 'x', -1]]],
              ],
            ],
            ['Limits', 'x', 0, 1],
          ],
          'y',
        ])
        .evaluate().operator
    ).toBe('D'));

  test('a bound that is a list', () =>
    expect(
      ce
        .box(['D', ['Integrate', 'x', ['Limits', 'x', 0, ['List', 1, 2]]], 'y'])
        .evaluate().operator
    ).toBe('D'));

  // A function literal with a parameter named `x` can call a user function
  // that reads the global `x`.
  test('an integrand with a nested function literal', () => {
    const engine = new ComputeEngine();
    engine.parse('g(a) := a x').evaluate();
    expect(
      engine
        .box([
          'D',
          [
            'Integrate',
            ['Apply', ['Function', ['g', 'x'], 'x'], 2],
            ['Limits', 'x', 0, 1],
          ],
          'x',
        ])
        .evaluate().operator
    ).toBe('D');
  });

  // A user definition with the name of a library function can have a step.
  test('a user definition that shadows a library function', () => {
    const engine = new ComputeEngine();
    engine.declare('Sinh', {
      signature: '(real) -> real',
      evaluate: ([t]) => engine.box(['Floor', t]),
    });
    expect(
      engine
        .box([
          'D',
          [
            'Integrate',
            ['Sinh', ['Add', ['Power', 'x', 3], 'y']],
            ['Limits', 'x', 0, 1],
          ],
          'y',
        ])
        .evaluate().operator
    ).toBe('D');
  });

  // ∫_0^∞ cos(xy) dx has no value: the derivative under the integral sign of
  // an integral over an infinite range is not used.
  test('an integral over an infinite range with no closed form', () =>
    expect(derivative('\\frac{d}{dy}\\int_0^\\infty \\cos(xy)\\,dx')).toBe(
      'D(int_(0)^(+oo)(cos(x * y) dx), y)'
    ));

  test('an indefinite integral', () =>
    expect(derivative('\\frac{d}{dx}\\int x^2\\,dx')).toBe(
      'D(int(x^2 dx), x)'
    ));
});
