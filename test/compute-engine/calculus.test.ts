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
    expect(evaluate('\\frac{d}{dx} x^2')).toMatchInlineSnapshot(
      `2x`
    ));

  test('partial derivative', () =>
    expect(evaluate('\\frac{d}{dx} tx^2')).toMatchInlineSnapshot(
      `2t * x`
    ));

  test('to constant', () =>
    expect(evaluate('\\frac{d}{dx} 3x')).toMatchInlineSnapshot(
      `3`
    ));

  test('no variable', () =>
    expect(evaluate('\\frac{d}{dx} 3t')).toMatchInlineSnapshot(
      `0`
    ));
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
      `int(Error(ErrorCode("incompatible-type", "number", "any")) + Error(ErrorCode("incompatible-type", "number", "any")))`
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
    expect(evaluate('\\int 2^x dx')).toMatchInlineSnapshot(
      `1.442695040888963426960659505534575535567482856042211903579535363595630580176111451674827877621175638 * 2^x`
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
