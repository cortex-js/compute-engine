import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const derivative = (latex: string) => ce.parse(latex).evaluate().toString();

// The derivative of an indefinite integral with respect to its own variable
// is the integrand (the fundamental theorem of calculus). With respect to
// another variable, it is the derivative of the closed form when there is
// one, and otherwise the integral of the derivative of the integrand. The
// two are equal up to a constant of integration, which an antiderivative
// leaves open. The derivative stayed unevaluated.
describe('THE DERIVATIVE OF AN INDEFINITE INTEGRAL', () => {
  test('with respect to the integration variable', () => {
    expect(derivative('\\frac{d}{dx}\\int x^2\\,dx')).toBe('x^2');
    expect(derivative('\\frac{d}{dx}\\int \\sin(x)e^x\\,dx')).toBe(
      'sin(x) * e^x'
    );
    // An integrand with no antiderivative in closed form.
    expect(derivative('\\frac{d}{dx}\\int e^{x^3}\\,dx')).toBe('e^(x^3)');
    expect(derivative('\\frac{d^2}{dx^2}\\int x^3\\,dx')).toBe('3x^2');
    expect(
      ce
        .box(['D', ['Integrate', ['List', 'x', ['Power', 'x', 2]], 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('[x,x^2]');
  });

  test('the result is an expression in the variable of the derivative', () => {
    const result = ce.parse('\\frac{d}{dx}\\int x^2\\,dx').evaluate();
    expect(result.isSame(ce.parse('x^2'))).toBe(true);
    expect(result.subs({ x: 3 }).evaluate().toString()).toBe('9');
  });

  test('in the body of a function', () => {
    const integral = ['Integrate', ['Multiply', 'y', ['Power', 'x', 2]], 'x'];
    expect(
      ce
        .box(['Apply', ['Function', ['D', integral, 'x'], 'y'], 3])
        .evaluate()
        .toString()
    ).toBe('3x^2');
    expect(
      ce
        .box([
          'Apply',
          ['Function', ['D', ['Integrate', ['Power', 'x', 2], 'x'], 'x'], 'x'],
          3,
        ])
        .evaluate()
        .toString()
    ).toBe('9');
  });

  test('with respect to another variable', () => {
    expect(derivative('\\frac{d}{dy}\\int x^2 y^3\\,dx')).toBe('x^3 * y^2');
    expect(derivative('\\frac{d}{dy}\\int x^2\\,dx')).toBe('0');
    // An integrand with no antiderivative in closed form is differentiated
    // under the integral sign.
    expect(derivative('\\frac{d}{dy}\\int e^{x^2 y}\\,dx')).toBe(
      'int(x^2 * e^(y * x^2) dx)'
    );
  });

  test('an iterated integral, with respect to another variable', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            ['Multiply', 'x', 'y', 'z'],
            ['Limits', 'x', 'Nothing', 'Nothing'],
            ['Limits', 'y', 'Nothing', 'Nothing'],
          ],
          'z',
        ])
        .evaluate()
        .toString()
    ).toBe('1/4 * x^2 * y^2'));

  test('the steps are explained', () => {
    const theorem = ce.parse('\\frac{d}{dx}\\int x^2\\,dx').explain('D');
    expect(theorem.steps.map((s) => s.id)).toEqual([
      'derivative.fundamental-theorem',
    ]);
    expect(theorem.result.toString()).toBe('x^2');

    const underSign = ce.parse('\\frac{d}{dy}\\int e^{x^2 y}\\,dx').explain('D');
    expect(underSign.steps[0].id).toBe('derivative.under-integral-sign');
    expect(underSign.result.toString()).toBe('int(x^2 * e^(y * x^2) dx)');
  });
});

describe('THE DERIVATIVE OF AN INDEFINITE INTEGRAL THAT STAYS UNEVALUATED', () => {
  // The `x` of `g` is the outer `x`, which the derivative varies too: the
  // integrand is not the derivative of the antiderivative in `x`.
  test('a user function in the integrand that reads the variable', () => {
    const engine = new ComputeEngine();
    engine.parse('g(a) := a \\cdot x').evaluate();
    expect(
      engine.parse('\\frac{d}{dx}\\int g(x)\\,dx').evaluate().operator
    ).toBe('D');
    // In another variable, the antiderivative is written with the
    // integration variable renamed to a fresh name (`x·x_1`), and so would
    // be its derivative.
    expect(
      engine.parse('\\frac{d}{dy}\\int g(y)\\,dx').evaluate().operator
    ).toBe('D');
  });

  test('an iterated integral, with respect to one of its variables', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            ['Multiply', 'x', 'y'],
            ['Limits', 'x', 'Nothing', 'Nothing'],
            ['Limits', 'y', 'Nothing', 'Nothing'],
          ],
          'x',
        ])
        .evaluate().operator
    ).toBe('D'));

  test('an integral that is indefinite in one variable and definite in another', () =>
    expect(
      ce
        .box([
          'D',
          [
            'Integrate',
            ['Multiply', 'x', 'y'],
            ['Limits', 'x', 'Nothing', 'Nothing'],
            ['Limits', 'y', 0, 1],
          ],
          'x',
        ])
        .evaluate().operator
    ).toBe('D'));
});
