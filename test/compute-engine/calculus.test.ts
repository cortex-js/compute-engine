import { engine } from '../utils';

function evaluate(expr: string): string {
  return engine.parse(expr).evaluate().toString();
}
function N(expr: string): number {
  const result = engine.parse(expr).N();
  if (result.operator === 'PlusMinus') return result.op1.re;
  return result.re;
}

describe('DERIVATION', () => {
  test('basic derivative', () =>
    expect(evaluate('\\frac{d}{dx} x^2')).toMatchInlineSnapshot(`2x`));

  test('partial derivative', () =>
    expect(evaluate('\\frac{d}{dx} tx^2')).toMatchInlineSnapshot(`2t * x`));

  test('to constant', () =>
    expect(evaluate('\\frac{d}{dx} 3x')).toMatchInlineSnapshot(`3`));

  test('no variable', () =>
    expect(evaluate('\\frac{d}{dx} 3t')).toMatchInlineSnapshot(`0`));

  // Issue #230: Root operator should be differentiated correctly
  test('cube root derivative', () =>
    expect(evaluate('\\frac{d}{dx} \\sqrt[3]{x}')).toMatchInlineSnapshot(
      `1 / (3x^(2/3))`
    ));

  test('fifth root derivative', () =>
    expect(evaluate('\\frac{d}{dx} \\sqrt[5]{x}')).toMatchInlineSnapshot(
      `1 / (5x^(4/5))`
    ));

  test('root with chain rule', () =>
    expect(evaluate('\\frac{d}{dx} \\sqrt[3]{x^2 + 1}')).toMatchInlineSnapshot(
      `(2x) / (3(x^2 + 1)^(2/3))`
    ));

  test('root of constant', () =>
    expect(evaluate('\\frac{d}{dx} \\sqrt[3]{5}')).toMatchInlineSnapshot(`0`));

  // Edge cases for Root derivatives
  test('root with product rule', () =>
    expect(evaluate('\\frac{d}{dx} x \\sqrt[3]{x}')).toMatchInlineSnapshot(
      `4/3 * root(3)(x)`
    ));

  test('root in denominator', () =>
    expect(
      evaluate('\\frac{d}{dx} \\frac{1}{\\sqrt[3]{x}}')
    ).toMatchInlineSnapshot(`-1 / (3x^(4/3))`));

  test('second derivative of root', () =>
    expect(
      evaluate('\\frac{d}{dx} \\frac{d}{dx} \\sqrt[3]{x}')
    ).toMatchInlineSnapshot(`-2 / (9x^(5/3))`));

  test('root with polynomial', () =>
    expect(
      evaluate('\\frac{d}{dx} \\sqrt[4]{x^3 - 2x + 1}')
    ).toMatchInlineSnapshot(`(3x^2 - 2) / (4(x^3 - 2x + 1)^(3/4))`));

  test('nested roots', () =>
    expect(
      evaluate('\\frac{d}{dx} \\sqrt{\\sqrt[3]{x}}')
    ).toMatchInlineSnapshot(`1 / (6x^(5/6))`));
});

describe('INDEFINITE INTEGRATION', () => {
  test('basic integration', () =>
    expect(evaluate('\\int x^2 dx')).toMatchInlineSnapshot(`1/3 * x^3`));

  test('power', () =>
    expect(evaluate('\\int x^n dx')).toMatchInlineSnapshot(
      `x^(n + 1) / (n + 1)`
    ));

  test('sin', () =>
    expect(evaluate('\\int \\sin x dx')).toMatchInlineSnapshot(`-cos(x)`));

  test('exp', () =>
    expect(evaluate('\\int e^x dx')).toMatchInlineSnapshot(`e^x`));

  test('ln', () =>
    expect(evaluate('\\int \\ln x dx')).toMatchInlineSnapshot(
      `-x + x * ln(x)`
    ));

  test('sum', () =>
    expect(evaluate('\\int f(x) + g(x) dx')).toMatchInlineSnapshot(
      `int(Error(ErrorCode("incompatible-type", "number", "any")) + g(x) dx)`
    ));

  test('product', () =>
    expect(evaluate('\\int f(x) g(x) dx')).toMatchInlineSnapshot(
      `int((f(x), g, x) dg  dx)`
    ));

  test('product with constants', () =>
    expect(evaluate('\\int 2\\pi f(x) dx')).toMatchInlineSnapshot(
      `int((2, pi, f(x)) dx)`
    ));

  // Additional edge cases
  test('cos', () =>
    expect(evaluate('\\int \\cos x dx')).toMatchInlineSnapshot(`sin(x)`));

  test('constant', () =>
    expect(evaluate('\\int 5 dx')).toMatchInlineSnapshot(`5x`));

  test('linear function', () =>
    expect(evaluate('\\int x dx')).toMatchInlineSnapshot(`1/2 * x^2`));

  test('polynomial (simple)', () =>
    expect(evaluate('\\int (x^3 + x^2 + x) dx')).toMatchInlineSnapshot(
      `1/4 * x^4 + 1/3 * x^3 + 1/2 * x^2`
    ));

  test('1/x (reciprocal)', () =>
    expect(evaluate('\\int \\frac{1}{x} dx')).toMatchInlineSnapshot(`ln(|x|)`));

  test('x^{-1} (negative one power)', () =>
    expect(evaluate('\\int x^{-1} dx')).toMatchInlineSnapshot(`ln(|x|)`));

  test('linear function with coefficient', () =>
    expect(evaluate('\\int 3x dx')).toMatchInlineSnapshot(`3/2 * x^2`));

  test('exponential base a', () =>
    expect(evaluate('\\int 2^x dx')).toMatchInlineSnapshot(`2^x / ln(2)`));

  // Trig squared integrals
  test('sec^2(x)', () =>
    expect(evaluate('\\int \\sec^2 x dx')).toMatchInlineSnapshot(`tan(x)`));

  test('csc^2(x)', () =>
    expect(evaluate('\\int \\csc^2 x dx')).toMatchInlineSnapshot(`-cot(x)`));

  // Inverse trig producing integrals
  test('1/(1+x^2) -> arctan', () =>
    expect(evaluate('\\int \\frac{1}{1+x^2} dx')).toMatchInlineSnapshot(
      `arctan(x)`
    ));

  test('1/sqrt(1-x^2) -> arcsin', () =>
    expect(evaluate('\\int \\frac{1}{\\sqrt{1-x^2}} dx')).toMatchInlineSnapshot(
      `arcsin(x)`
    ));

  // Inverse hyperbolic producing integrals
  test('1/sqrt(x^2+1) -> arsinh', () =>
    expect(evaluate('\\int \\frac{1}{\\sqrt{x^2+1}} dx')).toMatchInlineSnapshot(
      `arsinh(x)`
    ));

  test('1/sqrt(x^2-1) -> arcosh', () =>
    expect(evaluate('\\int \\frac{1}{\\sqrt{x^2-1}} dx')).toMatchInlineSnapshot(
      `arcosh(x)`
    ));

  test('1/(x*sqrt(x^2-1)) -> arcsec', () =>
    expect(
      evaluate('\\int \\frac{1}{x\\sqrt{x^2-1}} dx')
    ).toMatchInlineSnapshot(`arcsec(x)`));

  // Trigonometric substitution tests
  test('sqrt(1-x^2) (trig substitution)', () =>
    expect(evaluate('\\int \\sqrt{1-x^2} dx')).toMatchInlineSnapshot(
      `1/2 * x * sqrt(1 - x^2) + 1/2 * arcsin(x)`
    ));

  test('sqrt(1+x^2) (trig substitution)', () =>
    expect(evaluate('\\int \\sqrt{1+x^2} dx')).toMatchInlineSnapshot(
      `1/2 * x * sqrt(x^2 + 1) + 1/2 * arsinh(x)`
    ));

  test('sqrt(x^2-1) (trig substitution)', () =>
    expect(evaluate('\\int \\sqrt{x^2-1} dx')).toMatchInlineSnapshot(
      `1/2 * x * sqrt(x^2 - 1) - 1/2 * arcosh(x)`
    ));

  test('sqrt(4-x^2) (trig substitution with a=2)', () =>
    expect(evaluate('\\int \\sqrt{4-x^2} dx')).toMatchInlineSnapshot(
      `1/2 * x * sqrt(4 - x^2) + 2arcsin(1/2 * x)`
    ));

  test('sqrt(9-x^2) (trig substitution with a=3)', () =>
    expect(evaluate('\\int \\sqrt{9-x^2} dx')).toMatchInlineSnapshot(
      `1/2 * x * sqrt(9 - x^2) + 9/2 * arcsin(1/3 * x)`
    ));

  test('sqrt(x^2+4) (trig substitution with a=2)', () =>
    expect(evaluate('\\int \\sqrt{x^2+4} dx')).toMatchInlineSnapshot(
      `1/2 * x * sqrt(x^2 + 4) + 2arsinh(1/2 * x)`
    ));

  test('sqrt(x^2-4) (trig substitution with a=2)', () =>
    expect(evaluate('\\int \\sqrt{x^2-4} dx')).toMatchInlineSnapshot(
      `1/2 * x * sqrt(x^2 - 4) - 2arcosh(1/2 * x)`
    ));

  // Integration by parts tests
  test('x*e^x (integration by parts)', () =>
    expect(evaluate('\\int x e^x dx')).toMatchInlineSnapshot(`x * e^x - e^x`));

  test('x*sin(x) (integration by parts)', () =>
    expect(evaluate('\\int x \\sin x dx')).toMatchInlineSnapshot(
      `-x * cos(x) + sin(x)`
    ));

  test('x*cos(x) (integration by parts)', () =>
    expect(evaluate('\\int x \\cos x dx')).toMatchInlineSnapshot(
      `x * sin(x) + cos(x)`
    ));

  test('ln(x) (integration by parts with dv=1)', () =>
    expect(evaluate('\\int \\ln x dx')).toMatchInlineSnapshot(
      `-x + x * ln(x)`
    ));

  // U-substitution tests (chain rule recognition)
  test('sin(x^2)*2x (u-substitution)', () =>
    expect(evaluate('\\int \\sin(x^2) \\cdot 2x dx')).toMatchInlineSnapshot(
      `-cos(x^2)`
    ));

  test('e^(x^2)*x (u-substitution with constant factor)', () =>
    expect(evaluate('\\int e^{x^2} x dx')).toMatchInlineSnapshot(
      `1/2 * e^(x^2)`
    ));

  test('cos(x^2)*x (u-substitution with constant factor)', () =>
    expect(evaluate('\\int \\cos(x^2) x dx')).toMatchInlineSnapshot(
      `1/2 * sin(x^2)`
    ));

  test('cos(3x) (linear substitution)', () =>
    expect(evaluate('\\int \\cos(3x) dx')).toMatchInlineSnapshot(
      `1/3 * sin(3x)`
    ));

  test('e^(2x) (linear substitution)', () =>
    expect(evaluate('\\int e^{2x} dx')).toMatchInlineSnapshot(`1/2 * e^(2x)`));

  // Partial fraction tests
  test('1/(x-1) (simple linear denominator)', () =>
    expect(evaluate('\\int \\frac{1}{x-1} dx')).toMatchInlineSnapshot(
      `ln(|x - 1|)`
    ));

  test('1/(x^2-1) (partial fractions)', () =>
    expect(evaluate('\\int \\frac{1}{x^2-1} dx')).toMatchInlineSnapshot(
      `-1/2 * ln(|x + 1|) + 1/2 * ln(|x - 1|)`
    ));

  test('1/(x^2-4) (partial fractions)', () =>
    expect(evaluate('\\int \\frac{1}{x^2-4} dx')).toMatchInlineSnapshot(
      `-1/4 * ln(|x + 2|) + 1/4 * ln(|x - 2|)`
    ));

  test('1/(x^2+3x+2) (partial fractions)', () =>
    expect(evaluate('\\int \\frac{1}{x^2+3x+2} dx')).toMatchInlineSnapshot(
      `ln(|x + 1| / |x + 2|)`
    ));

  // Test common factor cancellation before integration
  test('(x+1)/(x^2+3x+2) (factor cancellation)', () =>
    expect(evaluate('\\int \\frac{x+1}{x^2+3x+2} dx')).toMatchInlineSnapshot(
      `ln(|x + 2|)`
    ));

  // Repeated linear roots
  test('1/(x-1)^2 (repeated linear root)', () =>
    expect(evaluate('\\int \\frac{1}{(x-1)^2} dx')).toMatchInlineSnapshot(
      `-1 / (x - 1)`
    ));

  test('1/(x-1)^3 (higher power repeated)', () =>
    expect(evaluate('\\int \\frac{1}{(x-1)^3} dx')).toMatchInlineSnapshot(
      `-1 / (2(x - 1)^2)`
    ));

  // Derivative pattern recognition (u-substitution)
  test('x/(x^2+1) (derivative pattern)', () =>
    expect(evaluate('\\int \\frac{x}{x^2+1} dx')).toMatchInlineSnapshot(
      `1/2 * ln(|x^2 + 1|)`
    ));

  test('(2x+1)/(x^2+x+1) (derivative pattern)', () =>
    expect(evaluate('\\int \\frac{2x+1}{x^2+x+1} dx')).toMatchInlineSnapshot(
      `ln(|x^2 + x + 1|)`
    ));

  // Completing the square (irreducible quadratics)
  test('1/(x^2+2x+2) (completing square)', () =>
    expect(evaluate('\\int \\frac{1}{x^2+2x+2} dx')).toMatchInlineSnapshot(
      `arctan(x + 1)`
    ));

  test('1/(x^2+x+1) (completing square)', () =>
    expect(evaluate('\\int \\frac{1}{x^2+x+1} dx')).toMatchInlineSnapshot(
      `2/3sqrt(3) * arctan(2/3sqrt(3) * x + sqrt(3)/3)`
    ));

  // Irreducible quadratic powers (reduction formula)
  test('1/(x^2+1)^2 (quadratic power)', () =>
    expect(evaluate('\\int \\frac{1}{(x^2+1)^2} dx')).toMatchInlineSnapshot(
      `x / (2(x^2 + 1)) + 1/2 * arctan(x)`
    ));

  // Mixed partial fractions (linear + irreducible quadratic)
  test('1/((x-1)(x^2+1)) (mixed partial fractions)', () =>
    expect(evaluate('\\int \\frac{1}{(x-1)(x^2+1)} dx')).toMatchInlineSnapshot(
      `-1/2 * arctan(x) - 1/4 * ln(|x^2 + 1|) + 1/2 * ln(|x - 1|)`
    ));

  // Polynomial division before integration
  test('x^2/(x^2+1) (polynomial division)', () =>
    expect(evaluate('\\int \\frac{x^2}{x^2+1} dx')).toMatchInlineSnapshot(
      `x - arctan(x)`
    ));

  test('x^3/(x+1) (polynomial division)', () =>
    expect(evaluate('\\int \\frac{x^3}{x+1} dx')).toMatchInlineSnapshot(
      `1/3 * x^3 - 1/2 * x^2 + x - ln(|x + 1|)`
    ));
});

/** These resolve symbolically the integrals, then applies the limits. */
describe('DEFINITE INTEGRATION', () => {
  test('basic integration', () =>
    expect(evaluate('\\int_0^1 x^2 dx')).toMatchInlineSnapshot(`1/3`));

  test('cube', () =>
    expect(evaluate('\\int_0^1 x^3 dx')).toMatchInlineSnapshot(`1/4`));

  test('power of n', () =>
    expect(evaluate('\\int_0^1 x^n dx')).toMatchInlineSnapshot(
      `((x) |-> x^(n + 1) / (n + 1))|_(0)^(1)`
    ));

  test('sin', () =>
    expect(evaluate('\\int_0^1 \\sin x dx')).toMatchInlineSnapshot(
      `0.4596976941318602825990633925570233962676895793820777723299027446188996052255282354820481439128169107`
    ));
  test('exp', () =>
    expect(evaluate('\\int_0^1 e^x dx')).toMatchInlineSnapshot(`-1 + e`));
  test('ln', () =>
    expect(evaluate('\\int_1^2 \\ln x dx')).toMatchInlineSnapshot(
      `0.3862943611198906`
    ));
});

/** These apply a numerical approximation. These could potentially be functions that do not have a symbolic form. */
describe('NUMERICAL INTEGRATION', () => {
  test('basic', () =>
    expect(Math.round(10 * N('\\int^2_0\\frac{3x}{5}dx'))).toEqual(12));

  test('Stretched precision loss', () => {
    // Stretching precision loss. Actual value: 0.210803
    expect(
      N(
        `\\int_0^1 \\sech^2 (10(x − 0.2)) + \\sech^4 (100(x − 0.4)) + \\sech^6 (1000(x − 0.6)) dx`
      )
    ).toBeCloseTo(0.2, 1);

    // Mathematica returns 2979.60, but with warnings about failure to converge.
    // expect(
    //   parse(`\\int_0^8 (e^x - \\mathrm{floor}(e^x)\\sin(x+e^x)) dx`).N().re! /
    //     10000
    // ).toBeCloseTo(0.3, 1);
  });

  test('Stretched precision loss with limits', () => {
    // Correct value: 0.6366197723675813430755350534900574481378385829618257949906693762
    const result = N(`\\int_0^1 \\sin(\\pi x) dx`);
    expect(result > 0.6 && result < 0.7).toBe(true);
  });

  it('should compute the numerical approximation of a trig function', () => {
    const result = N('\\int_0^1 \\sin x dx');

    expect(Math.round(result * 100)).toMatchInlineSnapshot(`46`);
  });
});

describe('LIMIT', () => {
  expect(
    engine
      .box(['Limit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
      .N().re
  ).toMatchInlineSnapshot(`1`);

  expect(
    engine
      .box(['Limit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
      .N().re
  ).toMatchInlineSnapshot(`1`);

  expect(
    engine
      .box(['NLimit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
      .evaluate().re
  ).toMatchInlineSnapshot(`1`);

  expect(
    engine.box(['NLimit', ['Divide', ['Sin', '_'], '_'], 0]).evaluate().re
  ).toMatchInlineSnapshot(`1`);

  // Should be "1"
  expect(
    engine
      .box([
        'NLimit',
        ['Function', ['Cos', ['Divide', 1, 'x']], 'x'],
        'Infinity',
      ])
      .evaluate().re
  ).toMatchInlineSnapshot(`1`);

  expect(
    engine.parse('\\lim_{x \\to 0} \\frac{\\sin(x)}{x}').N().re
  ).toMatchInlineSnapshot(`1`);
});
