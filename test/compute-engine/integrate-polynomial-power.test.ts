import { ComputeEngine } from '../../src/compute-engine';

// An integer power of a polynomial of degree 2 or more is expanded and
// integrated term by term (CE-1591).

const ce = new ComputeEngine();

describe('ANTIDERIVATIVE OF A POWER OF A POLYNOMIAL', () => {
  test.each([
    ['(x^2+1)^2', '\\frac{x^5}{5}+\\frac{2x^3}{3}+x'],
    ['(x^2+1)^3', '\\frac{x^7}{7}+\\frac{3x^5}{5}+x^3+x'],
    ['(x^2+x)^2', '\\frac{x^5}{5}+\\frac{x^4}{2}+\\frac{x^3}{3}'],
    ['3(x^2+1)^2', '\\frac{3x^5}{5}+2x^3+3x'],
    ['(ax^2+b)^2', '\\frac{a^2x^5}{5}+\\frac{2abx^3}{3}+b^2x'],
  ])('∫ %s dx', (integrand, expected) => {
    const result = ce.parse(`\\int ${integrand}\\,dx`).evaluate();
    expect(result.has('Integrate')).toBe(false);
    expect(result.isSame(ce.parse(expected))).toBe(true);
    // The derivative of the result is the integrand
    const derivative = ce.expr(['D', result, 'x']).evaluate();
    expect(derivative.sub(ce.parse(integrand)).simplify().is(0)).toBe(true);
  });

  test('the definite integral of (x^2+1)^2 on [0, 1] is 28/15', () => {
    expect(
      ce
        .parse('\\int_0^1 (x^2+1)^2\\,dx')
        .evaluate()
        .isSame(ce.number([28, 15]))
    ).toBe(true);
  });

  test('a power whose expanded degree is above the cap stays unevaluated', () => {
    expect(ce.parse('\\int (x^2+1)^{20}\\,dx').evaluate().operator).toBe(
      'Integrate'
    );
  });

  test('a power with the derivative of its base keeps the substitution form', () => {
    expect(
      ce
        .parse('\\int x(x^2+1)^2\\,dx')
        .evaluate()
        .isSame(ce.parse('\\frac{(x^2+1)^3}{6}'))
    ).toBe(true);
  });
});
