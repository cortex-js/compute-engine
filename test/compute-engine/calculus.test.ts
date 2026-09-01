import { engine } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';

function evaluate(expr: string): string {
  return engine.parse(expr).evaluate().toString();
}
function N(expr: string): number {
  const result = engine.parse(expr).N();
  if (result.operator === 'Measurement') return result.op1.re;
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

  test('D(f(x), x) type is number when f returns number', () => {
    engine.assign('f', engine.expr(['Function', ['Multiply', 'x', 2], 'x']));
    const expr = engine.parse("f'(x)");
    expect(expr.type.matches('number')).toBe(true);
  });

  test("f''(x) nested derivative type is numeric", () => {
    engine.assign('f', engine.expr(['Function', ['Power', 'x', 3], 'x']));
    const expr = engine.parse("f''(x)");
    expect(expr.type.matches('number')).toBe(true);
  });
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
      `1/2 * g * x^2 + int(f(x) dx)`
    ));

  test('product', () =>
    expect(evaluate('\\int f(x) g(x) dx')).toMatchInlineSnapshot(
      `g * int(x * f(x) dx)`
    ));

  test('product with constants', () =>
    expect(evaluate('\\int 2\\pi f(x) dx')).toMatchInlineSnapshot(
      `2pi * int(f(x) dx)`
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

  // Absolute value: ∫|ax+b| dx = (ax+b)|ax+b|/(2a), valid for all x.
  test('|x|', () =>
    expect(evaluate('\\int |x| dx')).toMatchInlineSnapshot(`1/2 * x * |x|`));

  test('|2x+1| (linear argument)', () =>
    expect(evaluate('\\int |2x+1| dx')).toMatchInlineSnapshot(
      `1/4 * (2x + 1) * |2x + 1|`
    ));

  test('exponential base a', () =>
    expect(evaluate('\\int 2^x dx')).toMatchInlineSnapshot(`2^x / ln(2)`));

  // Trig squared integrals
  test('sec^2(x)', () =>
    expect(evaluate('\\int \\sec^2 x dx')).toMatchInlineSnapshot(`tan(x)`));

  test('csc^2(x)', () =>
    expect(evaluate('\\int \\csc^2 x dx')).toMatchInlineSnapshot(`-cot(x)`));

  // Regression: ∫sin²x had a sign bug (returned the cos² antiderivative
  // x/2 + sin(2x)/4); both rules also dropped the 1/a factor and the phase b.
  test('sin^2(x) → x/2 − sin(2x)/4 (was wrong: +sin(2x)/4)', () =>
    expect(evaluate('\\int \\sin^2 x dx')).toMatchInlineSnapshot(
      `1/2 * x - 1/4 * sin(2x)`
    ));
  test('cos^2(x) → x/2 + sin(2x)/4', () =>
    expect(evaluate('\\int \\cos^2 x dx')).toMatchInlineSnapshot(
      `1/2 * x + 1/4 * sin(2x)`
    ));
  test('sin^2(2x) → x/2 − sin(4x)/8 (1/a factor)', () =>
    expect(evaluate('\\int \\sin^2(2x) dx')).toMatchInlineSnapshot(
      `1/2 * x - 1/8 * sin(4x)`
    ));
  test('sin^2(x+1) → x/2 − sin(2x+2)/4 (phase b retained)', () =>
    expect(evaluate('\\int \\sin^2(x+1) dx')).toMatchInlineSnapshot(
      `1/2 * x - 1/4 * sin(2x + 2)`
    ));

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
      `1/2 * (x * sqrt(1 - x^2) + arcsin(x))`
    ));

  test('sqrt(1+x^2) (trig substitution)', () =>
    expect(evaluate('\\int \\sqrt{1+x^2} dx')).toMatchInlineSnapshot(
      `1/2 * (x * sqrt(x^2 + 1) + arsinh(x))`
    ));

  test('sqrt(x^2-1) (trig substitution)', () =>
    expect(evaluate('\\int \\sqrt{x^2-1} dx')).toMatchInlineSnapshot(
      `1/2 * (x * sqrt(x^2 - 1) - arcosh(x))`
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

  // Cyclic integration patterns (e^x with trig)
  test('e^x*sin(x) (cyclic integration)', () =>
    expect(evaluate('\\int e^x \\sin x dx')).toMatchInlineSnapshot(
      `1/2 * (-cos(x) + sin(x)) * e^x`
    ));

  test('e^x*cos(x) (cyclic integration)', () =>
    expect(evaluate('\\int e^x \\cos x dx')).toMatchInlineSnapshot(
      `1/2 * (sin(x) + cos(x)) * e^x`
    ));

  test('e^x*sin(2x) (cyclic with linear argument)', () =>
    expect(evaluate('\\int e^x \\sin(2x) dx')).toMatchInlineSnapshot(
      `-2/5 * cos(2x) * e^x + 1/5 * sin(2x) * e^x`
    ));

  test('e^x*cos(2x) (cyclic with linear argument)', () =>
    expect(evaluate('\\int e^x \\cos(2x) dx')).toMatchInlineSnapshot(
      `1/5 * cos(2x) * e^x + 2/5 * sin(2x) * e^x`
    ));

  // Polynomial × eˣ × trig: by-parts composed with the cyclic solver, solved
  // in closed form with exact rational coefficients (ROADMAP B2 leftover).
  test('x*e^x*sin(x) (poly × eˣ × trig)', () =>
    expect(evaluate('\\int x e^x \\sin(x) dx')).toMatchInlineSnapshot(
      `-1/2 * x * cos(x) * e^x + 1/2 * x * sin(x) * e^x + 1/2 * cos(x) * e^x`
    ));

  test('x*e^x*cos(x) (poly × eˣ × trig)', () =>
    expect(evaluate('\\int x e^x \\cos(x) dx')).toMatchInlineSnapshot(
      `1/2 * x * sin(x) * e^x + 1/2 * x * cos(x) * e^x - 1/2 * sin(x) * e^x`
    ));

  test('x²*e^x*sin(x) (degree-2 poly × eˣ × trig)', () =>
    expect(evaluate('\\int x^2 e^x \\sin(x) dx')).toMatchInlineSnapshot(
      `-1/2 * cos(x) * x^2 * e^x + 1/2 * sin(x) * x^2 * e^x + x * cos(x) * e^x - 1/2 * sin(x) * e^x - 1/2 * cos(x) * e^x`
    ));

  test('x*e^x*sin(2x) (poly × eˣ × trig, frequency 2)', () =>
    expect(evaluate('\\int x e^x \\sin(2x) dx')).toMatchInlineSnapshot(
      `-2/5 * x * cos(2x) * e^x + 1/5 * x * sin(2x) * e^x + 3/25 * sin(2x) * e^x + 4/25 * cos(2x) * e^x`
    ));

  // Additional integration patterns from TODO.md
  test('x^2*e^x (integration by parts twice)', () =>
    expect(evaluate('\\int x^2 e^x dx')).toMatchInlineSnapshot(
      `x^2 * e^x - 2x * e^x + 2e^x`
    ));

  test('x*ln(x) (integration by parts)', () =>
    expect(evaluate('\\int x \\ln(x) dx')).toMatchInlineSnapshot(
      `-1/4 * x^2 + 1/2 * ln(x) * x^2`
    ));

  test('sec(x) (basic)', () =>
    expect(evaluate('\\int \\sec x dx')).toMatchInlineSnapshot(
      `ln(|tan(x) + sec(x)|)`
    ));

  test('csc(x) (basic)', () =>
    expect(evaluate('\\int \\csc x dx')).toMatchInlineSnapshot(
      `-ln(|csc(x) + cot(x)|)`
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

  // Special u-substitution: 1/(x·ln(x)) -> ln(ln(x))
  test('1/(x*ln(x)) (u-substitution)', () =>
    expect(evaluate('\\int \\frac{1}{x\\ln x} dx')).toMatchInlineSnapshot(
      `ln(|ln(x)|)`
    ));

  // Variant with constant: c/(x·ln(x)) -> c·ln(ln(x))
  test('3/(x*ln(x)) (u-substitution with constant)', () =>
    expect(evaluate('\\int \\frac{3}{x\\ln x} dx')).toMatchInlineSnapshot(
      `3ln(|ln(x)|)`
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
      `2/3sqrt(3) * arctan(sqrt(3)/3 * (2x + 1))`
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

  // Rational integrands with repeated linear/irreducible-quadratic factors,
  // closed via full partial-fraction decomposition (exact bigint solve).
  // ∫(1+x²+x³)/((x−1)x(1+x²)²(1+x+x²)) previously returned a WRONG 0; the
  // others returned an inert integral. Verify D(F) = integrand numerically.
  describe('repeated-factor rational integration', () => {
    const verify = (latex: string) => {
      const integrand = engine.parse(latex);
      const F = engine.expr(['Integrate', integrand, 'x']).evaluate();
      expect(F.has('Integrate')).toBe(false); // a closed form, not inert
      expect(F.is(0)).toBe(false); // never the spurious 0
      const dF = engine.expr(['D', F, 'x']).evaluate();
      for (const x of [0.3, 1.7, -0.6, 2.3]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    test('∫1/(x²(x+1)) dx', () => verify('\\frac{1}{x^2(x+1)}'));
    test('∫1/(x(1+x²)²) dx', () => verify('\\frac{1}{x(1+x^2)^2}'));
    test('∫(1+x²+x³)/((x-1)x(1+x²)²(1+x+x²)) dx (was wrongly 0)', () =>
      verify('\\frac{1+x^2+x^3}{(x-1)x(1+x^2)^2(1+x+x^2)}'));
  });

  // ∫xᵐ·(a+bx)^p — a radical or power of a linear function (Sqrt and Power
  // forms, bare or explicit x-coefficient). Canonical √ is a `Sqrt` node, which
  // the pattern rules (matching `Power(_,1/2)`) missed, so ∫√(1+x), ∫√(2x),
  // ∫x√(1+x) were all inert.
  describe('powers and radicals of a linear function', () => {
    const verify = (latex: string) => {
      const integrand = engine.parse(latex);
      const F = engine.expr(['Integrate', integrand, 'x']).evaluate();
      expect(F.has('Integrate')).toBe(false);
      const dF = engine.expr(['D', F, 'x']).evaluate();
      for (const x of [0.21, 0.53, 1.34, 2.07]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    test('∫√(1+x) dx', () => verify('\\sqrt{1+x}'));
    test('∫√(2x) dx', () => verify('\\sqrt{2x}'));
    test('∫(1+2x)^{3/2} dx', () => verify('(1+2x)^{3/2}'));
    test('∫x√(1+x) dx', () => verify('x\\sqrt{1+x}'));
    test('∫x²√(1+2x) dx', () => verify('x^2\\sqrt{1+2x}'));
  });

  // ∫c·Q′·Q^p → c·Q^{p+1}/(p+1) (reverse chain rule for a radical power of a
  // polynomial), and ∫N/(√u±√v) by conjugate rationalization. Both previously
  // inert.
  describe('radical reverse-chain and radical-sum rationalization', () => {
    const verify = (latex: string) => {
      const integrand = engine.parse(latex);
      const F = engine.expr(['Integrate', integrand, 'x']).evaluate();
      expect(F.has('Integrate')).toBe(false);
      const dF = engine.expr(['D', F, 'x']).evaluate();
      for (const x of [0.21, 0.43, 0.84, 1.27]) {
        const a = dF.subs({ x }).N().re;
        const b = integrand.subs({ x }).N().re;
        if (a === undefined || b === undefined) continue;
        expect(a).toBeCloseTo(b, 6);
      }
    };
    // reverse chain rule  ∫c·Q′·Q^p
    test('∫x√(1-x²) dx', () => verify('x\\sqrt{1-x^2}'));
    test('∫(2x+3)√(x²+3x+1) dx', () => verify('(2x+3)\\sqrt{x^2+3x+1}'));
    test('∫x²√(1-x³) dx', () => verify('x^2\\sqrt{1-x^3}'));
    // conjugate rationalization of a radical sum (k = 1)
    test('∫1/(√(1+x)+√(3+x)) dx', () =>
      verify('\\frac{1}{\\sqrt{1+x}+\\sqrt{3+x}}'));
    test('∫x/(√(1+x)+√(3+x)) dx', () =>
      verify('\\frac{x}{\\sqrt{1+x}+\\sqrt{3+x}}'));

    // Symbolic radical sum matches the closed form (no numeric verification).
    test('∫1/(√(a+bx)+√(c+bx)) dx is closed', () => {
      const F = engine
        .expr([
          'Integrate',
          engine.parse('\\frac{1}{\\sqrt{a+bx}+\\sqrt{c+bx}}'),
          'x',
        ])
        .evaluate();
      expect(F.has('Integrate')).toBe(false);
    });
  });
});

// ROADMAP B2: indefinite-integration coverage gaps.
describe('ROADMAP B2: fractional powers and exact partial-fraction coefficients', () => {
  // (a) √x and 1/√x canonicalize to Sqrt(x) and Divide(1, Sqrt(x)) — not Power
  // nodes — so the power rule never saw them and they returned unevaluated.
  test('∫√x dx = (2/3) x^(3/2)', () =>
    expect(evaluate('\\int \\sqrt{x} dx')).toMatchInlineSnapshot(
      `2/3 * x^(3/2)`
    ));

  test('∫1/√x dx = 2√x', () =>
    expect(evaluate('\\int \\frac{1}{\\sqrt{x}} dx')).toMatchInlineSnapshot(
      `2sqrt(x)`
    ));

  test('∫x^(-1/2) dx = 2√x', () =>
    expect(evaluate('\\int x^{-1/2} dx')).toMatchInlineSnapshot(`2sqrt(x)`));

  // (b) The irreducible quadratic x²−x+1 represents its −x term as Negate(x),
  // which the local quadratic/linear coefficient extractors rejected — sending
  // these to the numeric fallback, which leaked float coefficients. They now
  // take the symbolic path and return exact rationals/radicals.
  const noFloats = (s: string) => {
    // Reject any standalone decimal like 0.333… (an exact result has none).
    expect(s).not.toMatch(/\d\.\d/);
    return s;
  };

  test('∫1/(x³+1) dx is exact (no float coefficients)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^3+1} dx'))
    ).toMatchInlineSnapshot(
      `1/3 * ln(|x + 1|) + sqrt(3)/3 * arctan(sqrt(3)/3 * (2x - 1)) - 1/6 * ln(|x^2 - x + 1|)`
    ));

  test('∫1/(x²−x+1) dx is exact (irreducible quadratic with Negate term)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^2-x+1} dx'))
    ).toMatchInlineSnapshot(`2/3sqrt(3) * arctan(sqrt(3)/3 * (2x - 1))`));

  test('∫1/(2−x) dx = −ln|2−x| (linear factor with Negate term)', () =>
    expect(evaluate('\\int \\frac{1}{2-x} dx')).toMatchInlineSnapshot(
      `-ln(|2 - x|)`
    ));

  // (c) Biquadratic denominators with no real roots (x⁴+1, …) factor into two
  // real irreducible quadratics whose coefficients are irrational (√2). The
  // rational factorizer and findUnivariateRoots both miss them, so they
  // previously fell to the numeric fallback and leaked float coefficients
  // (0.3535·arctan(1.414x±1) …). A symbolic biquadratic partial-fraction path
  // now returns the exact radical closed form.
  test('∫1/(x⁴+1) dx is exact (conjugate-quadratic factorization)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^4+1} dx'))
    ).toMatchInlineSnapshot(
      `sqrt(2)/4 * arctan(sqrt(2)/2 * (2x - sqrt(2))) + sqrt(2)/4 * arctan(sqrt(2)/2 * (2x + sqrt(2))) - sqrt(2)/8 * ln(x^2 - sqrt(2) * x + 1) + sqrt(2)/8 * ln(x^2 + sqrt(2) * x + 1)`
    ));

  test('∫x²/(x⁴+1) dx is exact (numerator with the index)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{x^2}{x^4+1} dx'))
    ).toMatchInlineSnapshot(
      `sqrt(2)/4 * arctan(sqrt(2)/2 * (2x - sqrt(2))) + sqrt(2)/4 * arctan(sqrt(2)/2 * (2x + sqrt(2))) - sqrt(2)/8 * ln(x^2 + sqrt(2) * x + 1) + sqrt(2)/8 * ln(x^2 - sqrt(2) * x + 1)`
    ));

  test('∫1/(x⁴+4) dx is exact (rational quadratic factors)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^4+4} dx'))
    ).toMatchInlineSnapshot(
      `1/8 * arctan(x - 1) + 1/8 * arctan(x + 1) - 1/16 * ln(x^2 - 2x + 2) + 1/16 * ln(x^2 + 2x + 2)`
    ));

  // Real positive z-roots (Δ = p²−4q ≥ 0, p > 0): (x²+1)(x²+4). This one even
  // factors over ℚ, but the numeric fallback was still leaking float + noise.
  test('∫1/(x⁴+5x²+4) dx is exact (real z-root factorization)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^4+5x^2+4} dx'))
    ).toMatchInlineSnapshot(`-1/6 * arctan(1/2 * x) + 1/3 * arctan(x)`));

  // (d) Integration-by-parts coefficient leak: ∫x·arctan(x). The recovered
  // arctan term's coefficient leaked as a float 0.5. Root cause was the inner
  // integral ∫x²/(2(1+x²)): a constant factor inside a Multiply denominator
  // (2·(1+x²)) was not pulled out, so the quadratic/arctan rules missed and it
  // hit the numeric fallback. The Divide branch now extracts it.
  test('∫x·arctan(x) dx is exact (by-parts coefficient no longer leaks)', () =>
    expect(noFloats(evaluate('\\int x \\arctan(x) dx'))).toMatchInlineSnapshot(
      `1/2 * arctan(x) * x^2 - 1/2 * x + 1/2 * arctan(x)`
    ));

  test('∫x²/(2(1+x²)) dx is exact (constant factor in Multiply denominator)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{x^2}{2(1+x^2)} dx'))
    ).toMatchInlineSnapshot(`1/2 * (x - arctan(x))`));

  test('∫1/(2(1+x²)) dx = ½arctan(x) (constant factor pulled out)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{2(1+x^2)} dx'))
    ).toMatchInlineSnapshot(`1/2 * arctan(x)`));

  // (e) Denominators that factor over ℚ into distinct linear + irreducible
  // quadratic factors (x⁴−1, x⁶−1, mixed products) previously fell to the
  // numeric partial-fraction fallback and leaked floats. An exact symbolic
  // partial-fraction path (residues for linear factors, ℚ[x]/(F) field
  // arithmetic for the quadratics) now returns the exact closed form. A
  // genuinely ℚ-irreducible quartic (x⁴+x+1) still defers to the numeric path.
  test('∫1/(x⁴−1) dx is exact (two linear + one quadratic factor)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^4-1} dx'))
    ).toMatchInlineSnapshot(
      `-1/2 * arctan(x) - 1/4 * ln(|x + 1|) + 1/4 * ln(|x - 1|)`
    ));

  test('∫x/(x⁴−1) dx is exact (numerator with the index; was unevaluated)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{x}{x^4-1} dx'))
    ).toMatchInlineSnapshot(
      `-1/4 * ln(x^2 + 1) + 1/4 * ln(|x - 1|) + 1/4 * ln(|x + 1|)`
    ));

  test('∫1/(x⁶−1) dx is exact (two linear + two quadratic factors)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^6-1} dx'))
    ).toMatchInlineSnapshot(
      `-1/6 * ln(|x + 1|) + 1/6 * ln(|x - 1|) - sqrt(3)/6 * arctan(sqrt(3)/3 * (2x - 1)) - sqrt(3)/6 * arctan(sqrt(3)/3 * (2x + 1)) - 1/12 * ln(x^2 + x + 1) + 1/12 * ln(x^2 - x + 1)`
    ));

  test('∫1/((x−1)(x−2)(x²+1)) dx is exact (mixed factored denominator)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{(x-1)(x-2)(x^2+1)} dx'))
    ).toMatchInlineSnapshot(
      `-1/2 * ln(|x - 1|) + 1/10 * arctan(x) + 3/20 * ln(x^2 + 1) + 1/5 * ln(|x - 2|)`
    ));

  // A ℚ-irreducible quartic has no rational/real-quadratic factorization (its
  // resolvent cubic needs casus-irreducibilis radicals), so it stays on the
  // numeric fallback — value-correct, just not in exact radical form.
  test('∫1/(x⁴+x+1) dx stays on the numeric fallback (still value-correct)', () => {
    const F = engine.expr([
      'Integrate',
      engine.parse('\\frac{1}{x^4+x+1}'),
      'x',
    ]);
    const result = F.evaluate();
    expect(result.has('Integrate')).toBe(false);
    const dF = engine.expr(['D', result.json as any, 'x']).evaluate();
    for (const xv of [0.3, 2.5, -1.7]) {
      const got = dF.subs({ x: xv }).N().re;
      const want = engine.parse('\\frac{1}{x^4+x+1}').subs({ x: xv }).N().re;
      expect(Math.abs(got! - want!)).toBeLessThan(1e-7);
    }
  });
});

describe('ROADMAP B2: non-elementary & radical integrals (leftovers)', () => {
  // Each antiderivative is checked by differentiating it back to the
  // integrand (numerically, at machine precision) in addition to the
  // snapshot of its closed form.
  const sample = [0.1, 0.37, -0.42, 0.63];
  const checkDeriv = (integrandLatex: string, antiderivLatex: string) => {
    const ce = engine;
    const saved = ce.precision;
    ce.precision = 'machine';
    try {
      const integrand = ce.parse(integrandLatex);
      const dAnti = ce.expr(['D', ce.parse(antiderivLatex), 'x']).evaluate();
      for (const xv of sample) {
        const a = dAnti.subs({ x: xv }).N().re;
        const b = integrand.subs({ x: xv }).N().re;
        if (a === null || b === null) continue;
        if (!isFinite(a) || !isFinite(b)) continue;
        expect(Math.abs(a - b)).toBeLessThan(1e-7 * (1 + Math.abs(b)));
      }
    } finally {
      ce.precision = saved;
    }
  };

  // Gaussian → error functions (completing the square selects Erf vs Erfi).
  test('∫e^(−x²) dx → (√π/2)·Erf(x)', () => {
    expect(evaluate('\\int e^{-x^2} dx')).toMatchInlineSnapshot(
      `1/2 * Erf(x) * sqrt(pi)`
    );
    checkDeriv('e^{-x^2}', '\\frac{\\sqrt{\\pi}}{2}\\mathrm{Erf}(x)');
  });

  test('∫e^(x²) dx → (√π/2)·Erfi(x)', () =>
    expect(evaluate('\\int e^{x^2} dx')).toMatchInlineSnapshot(
      `1/2 * Erfi(x) * sqrt(pi)`
    ));

  test('∫e^(−2x²) dx (constant in exponent)', () =>
    expect(evaluate('\\int e^{-2x^2} dx')).toMatchInlineSnapshot(
      `sqrt(2)/4 * Erf(sqrt(2) * x) * sqrt(pi)`
    ));

  test('∫e^(−x²+3x−1) dx (completing the square)', () =>
    expect(evaluate('\\int e^{-x^2+3x-1} dx')).toMatchInlineSnapshot(
      `1/2 * Erf(x - 3/2) * e^(5/4) * sqrt(pi)`
    ));

  // Fresnel integrals.
  test('∫cos(x²) dx → Fresnel C', () => {
    expect(evaluate('\\int \\cos(x^2) dx')).toMatchInlineSnapshot(
      `sqrt(2)/2 * FresnelC((sqrt(2) * x) / sqrt(pi)) * sqrt(pi)`
    );
    checkDeriv(
      '\\cos(x^2)',
      '\\sqrt{\\frac{\\pi}{2}}\\mathrm{FresnelC}\\left(\\sqrt{\\frac{2}{\\pi}}x\\right)'
    );
  });

  test('∫sin(x²) dx → Fresnel S', () =>
    expect(evaluate('\\int \\sin(x^2) dx')).toMatchInlineSnapshot(
      `sqrt(2)/2 * FresnelS((sqrt(2) * x) / sqrt(pi)) * sqrt(pi)`
    ));

  // Sine/cosine integrals.
  test('∫sin(x)/x dx → Si(x)', () => {
    expect(evaluate('\\int \\frac{\\sin x}{x} dx')).toMatchInlineSnapshot(
      `SinIntegral(x)`
    );
    checkDeriv('\\frac{\\sin x}{x}', '\\mathrm{SinIntegral}(x)');
  });

  test('∫cos(x)/x dx → Ci(x)', () =>
    expect(evaluate('\\int \\frac{\\cos x}{x} dx')).toMatchInlineSnapshot(
      `CosIntegral(x)`
    ));

  test('∫sin(2x)/x dx → Si(2x)', () =>
    expect(evaluate('\\int \\frac{\\sin(2x)}{x} dx')).toMatchInlineSnapshot(
      `SinIntegral(2x)`
    ));

  // Exponential / logarithmic integrals.
  test('∫eˣ/x dx → Ei(x)', () => {
    expect(evaluate('\\int \\frac{e^x}{x} dx')).toMatchInlineSnapshot(
      `ExpIntegralEi(x)`
    );
    checkDeriv('\\frac{e^x}{x}', '\\mathrm{ExpIntegralEi}(x)');
  });

  test('∫e^(2x)/x dx → Ei(2x)', () => {
    expect(evaluate('\\int \\frac{e^{2x}}{x} dx')).toMatchInlineSnapshot(
      `ExpIntegralEi(2x)`
    );
    checkDeriv('\\frac{e^{2x}}{x}', '\\mathrm{ExpIntegralEi}(2x)');
  });

  test('∫1/ln(x) dx → li(x)', () => {
    expect(evaluate('\\int \\frac{1}{\\ln x} dx')).toMatchInlineSnapshot(
      `LogIntegral(x)`
    );
    checkDeriv('\\frac{1}{\\ln x}', '\\mathrm{LogIntegral}(x)');
  });

  test('∫1/ln(2x) dx → ½·li(2x)', () =>
    expect(evaluate('\\int \\frac{1}{\\ln(2x)} dx')).toMatchInlineSnapshot(
      `1/2 * LogIntegral(2x)`
    ));

  // Odd powers of secant via the reduction formula.
  test('∫sec³x dx → ½(sec x·tan x + ln|sec x + tan x|)', () => {
    expect(evaluate('\\int \\sec^3 x dx')).toMatchInlineSnapshot(
      `1/2 * tan(x) * sec(x) + 1/2 * ln(|tan(x) + sec(x)|)`
    );
    checkDeriv(
      '\\sec^3 x',
      '\\frac12\\sec x\\tan x + \\frac12\\ln|\\sec x + \\tan x|'
    );
  });

  test('∫csc³x dx → −½(csc x·cot x + ln|csc x + cot x|)', () =>
    expect(evaluate('\\int \\csc^3 x dx')).toMatchInlineSnapshot(
      `-1/2 * csc(x) * cot(x) - 1/2 * ln(|csc(x) + cot(x)|)`
    ));

  // Powers of tangent/cotangent via the reduction formulas.
  test('∫tan²x dx → tan x − x', () => {
    expect(evaluate('\\int \\tan^2 x dx')).toMatchInlineSnapshot(`-x + tan(x)`);
    checkDeriv('\\tan^2 x', '\\tan x - x');
  });

  test('∫tan³x dx → ½tan²x − ln|sec x|', () => {
    expect(evaluate('\\int \\tan^3 x dx')).toMatchInlineSnapshot(
      `1/2 * tan(x)^2 - ln(|sec(x)|)`
    );
    checkDeriv('\\tan^3 x', '\\frac12\\tan^2 x - \\ln|\\sec x|');
  });

  test('∫cot³x dx', () => {
    expect(evaluate('\\int \\cot^3 x dx')).toMatchInlineSnapshot(
      `-1/2 * cot(x)^2 - ln(|sin(x)|)`
    );
    checkDeriv('\\cot^3 x', '-\\frac12\\cot^2 x - \\ln|\\sin x|');
  });

  // Reverse power-chain rule: ∫c·u′·uⁿ = c·uⁿ⁺¹/(n+1).
  test('∫ln(x)/x dx → ½ln²x', () => {
    expect(evaluate('\\int \\frac{\\ln x}{x} dx')).toMatchInlineSnapshot(
      `1/2 * ln(x)^2`
    );
    checkDeriv('\\frac{\\ln x}{x}', '\\frac12 (\\ln x)^2');
  });

  test('∫ln²(x)/x dx → ⅓ln³x', () =>
    expect(evaluate('\\int \\frac{(\\ln x)^2}{x} dx')).toMatchInlineSnapshot(
      `1/3 * ln(x)^3`
    ));

  // Radical / trig-substitution families: xⁿ/√(1−x²).
  test('∫x/√(1−x²) dx → −√(1−x²) (derivative-in-numerator)', () => {
    expect(evaluate('\\int \\frac{x}{\\sqrt{1-x^2}} dx')).toMatchInlineSnapshot(
      `-sqrt(1 - x^2)`
    );
    checkDeriv('\\frac{x}{\\sqrt{1-x^2}}', '-\\sqrt{1-x^2}');
  });

  test('∫x²/√(1−x²) dx → ½(arcsin x − x√(1−x²))', () => {
    expect(
      evaluate('\\int \\frac{x^2}{\\sqrt{1-x^2}} dx')
    ).toMatchInlineSnapshot(`-1/2 * x * sqrt(1 - x^2) + 1/2 * arcsin(x)`);
    checkDeriv(
      '\\frac{x^2}{\\sqrt{1-x^2}}',
      '\\frac12\\arcsin(x) - \\frac12 x\\sqrt{1-x^2}'
    );
  });

  test('∫x³/√(1−x²) dx (reduction, m=3)', () =>
    expect(
      evaluate('\\int \\frac{x^3}{\\sqrt{1-x^2}} dx')
    ).toMatchInlineSnapshot(
      `-1/3 * x^2 * sqrt(1 - x^2) - 2/3 * sqrt(1 - x^2)`
    ));

  test('∫(2x+1)/√(x²+x+1) dx → 2√(x²+x+1)', () =>
    expect(
      evaluate('\\int \\frac{2x+1}{\\sqrt{x^2+x+1}} dx')
    ).toMatchInlineSnapshot(`2sqrt(x^2 + x + 1)`));

  // Radicand with a linear term: completing the square in the radical handler.
  test('∫1/√(x²+x+1) dx → arsinh((2x+1)/√3)', () => {
    expect(
      evaluate('\\int \\frac{1}{\\sqrt{x^2+x+1}} dx')
    ).toMatchInlineSnapshot(`arsinh(2/3sqrt(3) * (x + 1/2))`);
    checkDeriv(
      '\\frac{1}{\\sqrt{x^2+x+1}}',
      '\\operatorname{arsinh}(\\frac{2x+1}{\\sqrt3})'
    );
  });

  test('∫x/√(x²+x+1) dx (linear numerator + linear term)', () => {
    expect(
      evaluate('\\int \\frac{x}{\\sqrt{x^2+x+1}} dx')
    ).toMatchInlineSnapshot(
      `-1/2 * arsinh(2/3sqrt(3) * (x + 1/2)) + sqrt(x^2 + x + 1)`
    );
    checkDeriv(
      '\\frac{x}{\\sqrt{x^2+x+1}}',
      '\\sqrt{x^2+x+1} - \\frac12\\operatorname{arsinh}(\\frac{2x+1}{\\sqrt3})'
    );
  });

  test('∫1/√(2−x²) dx → arcsin(x/√2) (non-unit constant)', () =>
    expect(evaluate('\\int \\frac{1}{\\sqrt{2-x^2}} dx')).toMatchInlineSnapshot(
      `arcsin(sqrt(2)/2 * x)`
    ));
});

describe('INTEGRATION REGRESSIONS (Rubi Phase-0 findings)', () => {
  // Helper: check ∫f dx by differentiating the result and comparing
  // numerically against f at sample points.
  function checkAntiderivative(
    integrand: any,
    points: Record<string, number>[]
  ) {
    const F = engine.expr(['Integrate', integrand, 'x']).evaluate();
    expect(F.has('Integrate')).toBe(false);
    const dF = engine.expr(['D', F.json as any, 'x']).evaluate();
    const f = engine.expr(integrand);
    for (const pt of points) {
      const got = dF.subs(pt).N().re;
      const want = f.subs(pt).N().re;
      expect(Math.abs(got - want)).toBeLessThanOrEqual(
        1e-7 * (1 + Math.abs(want))
      );
    }
  }

  test('∫(a + b·x⁴)/x⁶ does not drop the a-term', () =>
    checkAntiderivative(
      [
        'Divide',
        ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 4]]],
        ['Power', 'x', 6],
      ],
      [
        { a: 2, b: 3, x: 1.7 },
        { a: -1, b: 0.5, x: -2.3 },
      ]
    ));

  test('∫(a + b·x⁴)/x⁷ does not drop the a-term', () =>
    checkAntiderivative(
      [
        'Divide',
        ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 4]]],
        ['Power', 'x', 7],
      ],
      [{ a: 2, b: 3, x: 1.7 }]
    ));

  test('∫x⁶/(1−x⁶) includes the arctan/quadratic-log terms', () =>
    checkAntiderivative(
      ['Divide', ['Power', 'x', 6], ['Subtract', 1, ['Power', 'x', 6]]],
      [{ x: 0.3 }, { x: 2.5 }, { x: -1.7 }]
    ));

  test('∫1/(2x²−2) accounts for the leading coefficient', () =>
    checkAntiderivative(
      ['Divide', 1, ['Subtract', ['Multiply', 2, ['Power', 'x', 2]], 2]],
      [{ x: 0.3 }, { x: 2.5 }]
    ));

  test('∫1/(x⁴+1) (exact biquadratic partial fractions)', () => {
    // Now exact (√2 radicals) via the biquadratic path, not the numeric
    // fallback — see the ROADMAP B2 block below for the float-free assertion.
    checkAntiderivative(
      ['Divide', 1, ['Add', ['Power', 'x', 4], 1]],
      [{ x: 0.3 }, { x: 2.5 }, { x: -1.7 }]
    );
  });

  test('∫1/(x²−2x+1) (expanded repeated linear root)', () =>
    checkAntiderivative(
      ['Divide', 1, ['Add', ['Power', 'x', 2], ['Multiply', -2, 'x'], 1]],
      [{ x: 0.3 }, { x: 2.5 }]
    ));

  test('trinomial quotients terminate instead of overflowing the stack', () => {
    // These six shapes previously threw RangeError (runaway recursion
    // between the polynomial-division and term-splitting strategies).
    const cases: any[] = [
      [
        'Divide',
        ['Power', 'x', 11],
        ['Power', ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 2]]], 2],
      ],
      [
        'Divide',
        ['Power', 'x', 11],
        [
          'Add',
          ['Power', 'a', 2],
          ['Multiply', 2, 'a', 'b', ['Power', 'x', 2]],
          ['Multiply', ['Power', 'b', 2], ['Power', 'x', 4]],
        ],
      ],
      [
        'Divide',
        [
          'Multiply',
          ['Power', ['Add', 'd', ['Multiply', 'e', 'x']], 3],
          ['Power', ['Add', 'f', ['Multiply', 'g', 'x']], 2],
        ],
        [
          'Subtract',
          ['Power', 'd', 2],
          ['Multiply', ['Power', 'e', 2], ['Power', 'x', 2]],
        ],
      ],
    ];
    for (const c of cases) {
      // Must not throw RangeError — inert results are acceptable
      expect(() => engine.expr(['Integrate', c, 'x']).evaluate()).not.toThrow();
    }
  });

  test('cancelCommonFactors does not cancel with a bogus GCD', () => {
    // gcd(a + bx⁴, x⁶) incorrectly returned x⁴ + a/b when the Euclid
    // remainder had parameter-divided coefficients
    const e = engine.expr([
      'Divide',
      ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 4]]],
      ['Power', 'x', 6],
    ]);
    const f = e.subs({ a: 2, b: 3, x: 1.3 }).N().re;
    expect(Math.abs(f - (2 + 3 * 1.3 ** 4) / 1.3 ** 6)).toBeLessThan(1e-10);
  });
});

/** These resolve symbolically the integrals, then applies the limits. */
describe('DEFINITE INTEGRATION', () => {
  test('basic integration', () =>
    expect(evaluate('\\int_0^1 x^2 dx')).toMatchInlineSnapshot(`1/3`));

  test('cube', () =>
    expect(evaluate('\\int_0^1 x^3 dx')).toMatchInlineSnapshot(`1/4`));

  test('power of n', () =>
    // The parameter-dependent endpoint term `0^(n+1)` (the value of the
    // antiderivative at the lower bound 0) is resolved to its limit 0 under the
    // convergence condition `n + 1 > 0`, so the improper integral emits a
    // `When`-guarded value instead of leaking the indeterminate `0^(n+1)`
    // (conditional-values design, Phase 3a).
    expect(evaluate('\\int_0^1 x^n dx')).toMatchInlineSnapshot(
      `1 / (n + 1) {0 < n + 1}`
    ));

  test('symbolic bounds', () =>
    expect(evaluate('\\int_a^b x dx')).toMatchInlineSnapshot(
      `-1/2 * a^2 + 1/2 * b^2`
    ));

  test('unknown integrand with symbolic bounds stays symbolic', () =>
    expect(engine.parse('\\int_a^b f(x)\\mathrm{d}x').evaluate().json)
      .toMatchInlineSnapshot(`
      [
        Integrate,
        [
          Function,
          [
            Block,
            [
              f,
              x,
            ],
          ],
          x,
        ],
        [
          Limits,
          x,
          a,
          b,
        ],
      ]
    `));

  test('sin', () =>
    expect(evaluate('\\int_0^1 \\sin x dx')).toMatchInlineSnapshot(
      `1 - cos(1)`
    ));
  test('exp', () =>
    expect(evaluate('\\int_0^1 e^x dx')).toMatchInlineSnapshot(`-1 + e`));
  test('ln', () =>
    expect(evaluate('\\int_1^2 \\ln x dx')).toMatchInlineSnapshot(
      `-1 + 2ln(2)`
    ));

  // ROADMAP B3: definite integrals whose closed form is a transcendental
  // constant are now exact (the antiderivative + bound substitution no longer
  // numericizes ln/arctan). Previously these returned floats (≈0.693, ≈0.785).
  test('1/x → ln(2)', () =>
    expect(evaluate('\\int_1^2 \\frac{1}{x} dx')).toMatchInlineSnapshot(
      `ln(2)`
    ));

  test('1/(x²+1) → π/4', () =>
    expect(evaluate('\\int_0^1 \\frac{1}{x^2+1} dx')).toMatchInlineSnapshot(
      `1/4 * pi`
    ));
});

// Regression: the numeric branch of `Integrate.evaluate` used to read only the
// FIRST limit, so `.N()` on a multi-limit integral silently integrated one
// dimension and dropped the rest (∫∫ 1 dx dy over [0,3]×[0,2] gave 3, and a
// multivariate integrand gave NaN). Multiple limits now do iterated quadrature.
describe('MULTIPLE INTEGRALS: .N() uses every limit', () => {
  // A quadrature result is `Measurement(value, error)`, but a zero error
  // (exact GK on a polynomial) simplifies to the bare value.
  const nValue = (F: ReturnType<typeof engine.expr>): number => {
    const r = F.N();
    return r.operator === 'Measurement' ? r.op1.re : r.re;
  };

  test('∫∫ 1 over [0,3]×[0,2] (was 3)', () => {
    const F = engine.expr([
      'Integrate',
      1,
      ['Limits', 'x', 0, 3],
      ['Limits', 'y', 0, 2],
    ]);
    expect(F.evaluate().re).toBe(6);
    expect(nValue(F)).toBeCloseTo(6, 10);
  });

  test('∫∫ x·y over [0,3]×[0,2] (was NaN)', () => {
    const F = engine.expr([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, 3],
      ['Limits', 'y', 0, 2],
    ]);
    expect(F.evaluate().re).toBe(9);
    expect(nValue(F)).toBeCloseTo(9, 10);
  });

  test('∫∫∫ x·y·z over [0,1]³', () => {
    const F = engine.expr([
      'Integrate',
      ['Multiply', 'x', 'y', 'z'],
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 1],
      ['Limits', 'z', 0, 1],
    ]);
    expect(nValue(F)).toBeCloseTo(0.125, 10);
  });

  // Limits follow the Mathematica iterator convention: the FIRST limit is the
  // OUTERMOST integral, so an inner bound may reference the outer variables.
  test('dependent inner bound: triangle ∫₀¹dx ∫₀ˣdy 1 = 1/2', () => {
    const F = engine.expr([
      'Integrate',
      1,
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 'x'],
    ]);
    expect(F.evaluate().toString()).toBe('1/2');
    expect(nValue(F)).toBeCloseTo(0.5, 10);
  });

  test('dependent bound with non-elementary integrand: ∫₀¹dx ∫₀ˣ e^(y²) dy', () => {
    const F = engine.expr([
      'Integrate',
      ['Exp', ['Square', 'y']],
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 'x'],
    ]);
    // Reference value from an independent mpmath computation.
    expect(nValue(F)).toBeCloseTo(0.60351083167765899, 10);
  });

  test('a bound referencing an INNER integration variable declines', () => {
    // `Limits(x, 0, y)` with `y` bound by a LATER (inner) limit: under the
    // first-limit-outermost convention that `y` is out of scope, so `.N()`
    // keeps the integral inert rather than integrate wrongly.
    const F = engine.expr([
      'Integrate',
      1,
      ['Limits', 'x', 0, 'y'],
      ['Limits', 'y', 0, 2],
    ]);
    expect(F.N().has('Integrate')).toBe(true);
  });

  test('a bound with a foreign free symbol declines', () => {
    const F = engine.expr([
      'Integrate',
      1,
      ['Limits', 'x', 0, 'q_unbound'],
      ['Limits', 'y', 0, 2],
    ]);
    expect(F.N().has('Integrate')).toBe(true);
  });
});

// Regression for CORRECTNESS_FINDINGS P0-1: when no antiderivative can be
// found, `evaluate()` must keep the definite integral inert (symbolic) rather
// than wrapping the inert `Integrate` in `EvaluateAt`. Beta-reducing the
// integrand at the bounds used to capture the integration variable and
// collapse the integral to a WRONG finite value (0 / 10 / NaN below), while
// `.N()` (quadrature) stays correct.
describe('UNINTEGRABLE DEFINITE INTEGRALS STAY SYMBOLIC (P0-1)', () => {
  test('∫₋₁¹ √(1−x²)/(1+x²) dx stays symbolic (was 0)', () => {
    const F = engine
      .parse('\\int_{-1}^1 \\frac{\\sqrt{1-x^2}}{1+x^2} dx')
      .evaluate();
    expect(F.has('Integrate')).toBe(true); // inert, NOT the wrong value 0
    expect(F.N().op1.re).toBeCloseTo(1.3012838, 1); // π(√2−1), via quadrature
  });

  test('∫₋₁¹ (√(1−x²)/(1+x²) + 5) dx stays symbolic (was 10)', () => {
    const F = engine
      .parse('\\int_{-1}^1 \\left(\\frac{\\sqrt{1-x^2}}{1+x^2} + 5\\right) dx')
      .evaluate();
    // The integrable `+5` term must NOT be silently dropped.
    expect(F.has('Integrate')).toBe(true);
    expect(F.N().op1.re).toBeCloseTo(11.3012838, 1);
  });

  test('∫₀¹ (1/ln t + 1/(1−t) − ln ln(1/t)) dt stays symbolic (was NaN)', () => {
    const F = engine
      .parse(
        '\\int_0^1 \\left(\\frac{1}{\\ln t} + \\frac{1}{1-t} - \\ln\\ln\\frac{1}{t}\\right) dt'
      )
      .evaluate();
    expect(F.has('Integrate')).toBe(true);
    expect(F.N().op1.re).toBeCloseTo(1.1544313, 1); // 2·γ (Euler–Mascheroni)
  });

  // Controls: the found-antiderivative path (including symbolic bounds added
  // in commit 9b818ec8) must keep producing exact closed forms.
  test('control: ∫₀¹ x² dx = 1/3 (exact)', () =>
    expect(evaluate('\\int_0^1 x^2 dx')).toBe('1/3'));

  test('control: ∫₀^π sin x dx = 2 (exact)', () =>
    expect(evaluate('\\int_0^{\\pi} \\sin x dx')).toBe('2'));

  test('control: ∫₀^a x dx = a²/2 (symbolic bounds, exact)', () =>
    expect(evaluate('\\int_0^a x dx')).toBe('1/2 * a^2'));

  test('control: nested ∫₁²∫₃⁴ x·y dx dy = 21/4 (exact)', () =>
    expect(evaluate('\\int_1^2\\int_3^4 x y \\, dx \\, dy')).toBe('21/4'));
});

describe('IMPROPER INTEGRATION (ROADMAP B3)', () => {
  // The new B2 antiderivatives + special values at ±∞ (Erf(∞)=1,
  // arctan(±∞)=±π/2, FresnelC/S(∞)=½) make these exact via bound
  // substitution — no separate limit machinery needed.
  test('∫₀^∞ e^(−x²) → √π/2 (Gaussian, via Erf(∞)=1)', () =>
    expect(evaluate('\\int_0^\\infty e^{-x^2} dx')).toMatchInlineSnapshot(
      `1/2 * sqrt(pi)`
    ));

  test('∫_{−∞}^∞ e^(−x²) → √π', () =>
    expect(
      evaluate('\\int_{-\\infty}^\\infty e^{-x^2} dx')
    ).toMatchInlineSnapshot(`sqrt(pi)`));

  test('∫₀^∞ e^(−x) → 1', () =>
    expect(evaluate('\\int_0^\\infty e^{-x} dx')).toMatchInlineSnapshot(`1`));

  test('∫₁^∞ 1/x² → 1', () =>
    expect(evaluate('\\int_1^\\infty \\frac{1}{x^2} dx')).toMatchInlineSnapshot(
      `1`
    ));

  test('∫₀^∞ 1/(1+x²) → π/2 (via arctan(∞)=π/2)', () =>
    expect(
      evaluate('\\int_0^\\infty \\frac{1}{1+x^2} dx')
    ).toMatchInlineSnapshot(`1/2 * pi`));

  test('∫_{−∞}^∞ 1/(1+x²) → π', () =>
    expect(
      evaluate('\\int_{-\\infty}^\\infty \\frac{1}{1+x^2} dx')
    ).toMatchInlineSnapshot(`pi`));

  test('∫₀^∞ 1/(x²+4) → π/4', () =>
    expect(
      evaluate('\\int_0^\\infty \\frac{1}{x^2+4} dx')
    ).toMatchInlineSnapshot(`1/4 * pi`));

  // Fresnel-family improper integrals: ∫₀^∞ cos(x²) = ∫₀^∞ sin(x²) = √(π/8).
  // Previously blocked by ∞ / (Pi-derived finite constant) → NaN in the bound
  // substitution (the FresnelC argument is Divide(√2·∞, √π)). Exact via the
  // ∞/finite-nonzero divide rule; finiteness now also propagates structurally
  // so √π reports isFinite = true (see the 'isFinite propagation' block).
  test('∫₀^∞ cos(x²) → √(π/8) (Fresnel C, via FresnelC(∞)=½)', () => {
    const F = engine.parse('\\int_0^\\infty \\cos(x^2) dx').evaluate();
    expect(F.toString()).toMatchInlineSnapshot(`sqrt(2)/4 * sqrt(pi)`);
    // Numericize the exact closed form (not numeric re-integration).
    expect(F.N().re).toBeCloseTo(Math.sqrt(Math.PI / 8), 12);
  });

  test('∫₀^∞ sin(x²) → √(π/8) (Fresnel S, via FresnelS(∞)=½)', () =>
    expect(evaluate('\\int_0^\\infty \\sin(x^2) dx')).toMatchInlineSnapshot(
      `sqrt(2)/4 * sqrt(pi)`
    ));

  // `poly(y)·e^{−c·y}` antiderivative terms make the ∞ endpoint an `∞·0`
  // indeterminate that naive substitution collapses to NaN. These resolve via
  // the limit lim_{y→∞} F(y) = 0 (exp decay beats polynomial growth) rather
  // than leaking NaN or falling back to quadrature.
  test('∫₀^∞ y² e^(−y) → 2 (Γ(3), was NaN)', () =>
    expect(evaluate('\\int_0^\\infty y^2 e^{-y} dy')).toMatchInlineSnapshot(
      `2`
    ));

  test('∫₀^∞ y³ e^(−y) → 6 (Γ(4), was NaN)', () =>
    expect(evaluate('\\int_0^\\infty y^3 e^{-y} dy')).toMatchInlineSnapshot(
      `6`
    ));

  test('∫ₓ^∞ y e^(−y) → e^(−x)(x+1) (symbolic bound, was NaN)', () =>
    expect(evaluate('\\int_x^\\infty y e^{-y} dy')).toMatchInlineSnapshot(
      `x * e^(-x) + e^(-x)`
    ));

  // χ²-tail shape (k=5): the antiderivative (an Erf form) needs both Erf(∞)=1
  // and lim_{y→∞} poly·e^{−y/2}=0 at the ∞ endpoint. The built-in
  // antiderivative can't close this integrand (no Erf), so on the shared engine
  // it stays inert — but must never leak NaN. (The Rubi-closed exact form is
  // asserted in integration-rules-substitutions.test.ts.)
  test('∫ₓ^∞ y^(3/2) e^(−y/2) never leaks NaN (was NaN)', () => {
    const F = engine.parse('\\int_x^\\infty y^{3/2} e^{-y/2} dy').evaluate();
    expect(F.isNaN).not.toBe(true);
    expect(['Add', 'Integrate']).toContain(F.operator);
  });
});

describe('∞ / finite-nonzero divide (B3 Fresnel unblock)', () => {
  // The Divide path returned NaN for an infinite numerator over a finite but
  // symbolic denominator (√π, π, 1/√π), while Multiply already handled
  // ∞·√π → +∞. These keep the two consistent. (Finiteness of those symbolic
  // constants now propagates too — see the 'isFinite propagation' block.)
  test('∞ / π = +∞, ∞ / √π = +∞', () => {
    expect(engine.PositiveInfinity.div(engine.Pi).toString()).toBe('+oo');
    expect(
      engine.PositiveInfinity.div(engine.parse('\\sqrt{\\pi}')).toString()
    ).toBe('+oo');
  });

  test('sign is carried correctly through the divide', () => {
    const sqrtPi = engine.parse('\\sqrt{\\pi}');
    expect(engine.NegativeInfinity.div(sqrtPi).toString()).toBe('-oo');
    expect(engine.PositiveInfinity.div(sqrtPi.neg()).toString()).toBe('-oo');
  });

  test('indeterminate / undefined-sign cases are unchanged', () => {
    // ∞/∞ = NaN, ∞/0 = ~∞, and a could-be-zero constant denominator is left
    // alone (no definite sign ⇒ rule does not fire).
    expect(engine.PositiveInfinity.div(engine.PositiveInfinity).isNaN).toBe(
      true
    );
    expect(engine.PositiveInfinity.div(engine.Zero).toString()).toBe('~oo');
  });
});

describe('isFinite propagation (B3 latent finiteness gap)', () => {
  // Finiteness is now propagated structurally through Sqrt/Root/Power/Divide of
  // finite operands, so finite symbolic constants report isFinite = true before
  // being evaluated to a number (previously undefined). "Definitely nonzero" is
  // established via a known sign (BoxedExpression has no isZero getter).
  test('finite symbolic constants are known finite', () => {
    expect(engine.parse('\\sqrt{\\pi}').isFinite).toBe(true);
    expect(engine.parse('\\frac{1}{\\pi}').isFinite).toBe(true);
    expect(engine.expr(['Power', 'Pi', ['Rational', 1, 3]]).isFinite).toBe(
      true
    );
    expect(engine.expr(['Power', 'Pi', 2]).isFinite).toBe(true);
    expect(engine.expr(['Power', 'Pi', 'Pi']).isFinite).toBe(true);
    expect(engine.expr(['Power', 2, 1000]).isFinite).toBe(true);
  });

  test('non-finite operands are not reported finite', () => {
    expect(engine.expr(['Sqrt', engine.PositiveInfinity]).isFinite).toBe(false);
    // ∞/π is +∞ (handled by the divide rule), hence not finite.
    expect(
      engine.expr(['Divide', engine.PositiveInfinity, 'Pi']).isFinite
    ).toBe(false);
  });

  test('cases without a definite verdict stay undefined (conservative)', () => {
    // Free variable x: could be infinite, zero, etc. — finiteness unknown.
    expect(engine.expr(['Divide', 1, 'x']).isFinite).toBeUndefined();
    expect(engine.expr(['Power', 'x', 2]).isFinite).toBeUndefined();
    expect(engine.expr(['Power', 'Pi', 'x']).isFinite).toBeUndefined();
  });

  test('type-provable non-finiteness is reported (not just structural)', () => {
    // `Ln(0)` is −∞. There is no `Ln` case in the structural propagation
    // above, so finiteness comes from the static type (`signed_infinity`,
    // i.e. the infinities). Previously `isFinite` was type-blind here and
    // returned `undefined` even though `.type` proved the value non-finite.
    expect(engine.parse('\\ln(0)').type.toString()).toBe('signed_infinity');
    expect(engine.parse('\\ln(0)').isFinite).toBe(false);
    expect(engine.expr(['Ln', 0]).isFinite).toBe(false);
    expect(engine.parse('\\log(0)').isFinite).toBe(false);

    // Control: the same operator with an undecidable argument is unchanged —
    // `Ln(x)` types `number`, which proves nothing either way.
    expect(engine.expr(['Ln', 'x']).type.toString()).toBe('number');
    expect(engine.expr(['Ln', 'x']).isFinite).toBeUndefined();
  });
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

  // ROADMAP B3: conditionally-convergent oscillatory improper integrals.
  // Monte-Carlo importance sampling gave garbage here (e.g. ∫₀^∞ sin(x²) was
  // −0.36 ± 0.53); a dedicated lobe-integration + ε-acceleration quadrature now
  // handles them deterministically to ~1e-8. (`toBeCloseTo(v, 6)` ⟹ |Δ|<5e-7.)
  describe('oscillatory improper integrals', () => {
    test('∫₀^∞ sin(x)/x = π/2 (Dirichlet)', () =>
      expect(N('\\int_0^{\\infty} \\frac{\\sin x}{x} dx')).toBeCloseTo(
        Math.PI / 2,
        6
      ));

    test('∫₀^∞ sin(x²) = √(π/8) (Fresnel)', () =>
      expect(N('\\int_0^{\\infty} \\sin(x^2) dx')).toBeCloseTo(
        Math.sqrt(Math.PI / 8),
        6
      ));

    test('∫₀^∞ cos(x²) = √(π/8) (Fresnel)', () =>
      expect(N('\\int_0^{\\infty} \\cos(x^2) dx')).toBeCloseTo(
        Math.sqrt(Math.PI / 8),
        6
      ));

    test('∫₀^∞ sin(2x)/x = π/2', () =>
      expect(N('\\int_0^{\\infty} \\frac{\\sin(2x)}{x} dx')).toBeCloseTo(
        Math.PI / 2,
        6
      ));

    test('∫₀^∞ e^{-x} sin(x) = 1/2 (decaying oscillator, exact)', () =>
      expect(N('\\int_0^{\\infty} e^{-x} \\sin x dx')).toBeCloseTo(0.5, 6));

    test('∫₀^∞ cos(x)/(1+x²) = π/(2e)', () =>
      expect(N('\\int_0^{\\infty} \\frac{\\cos x}{1+x^2} dx')).toBeCloseTo(
        Math.PI / (2 * Math.E),
        6
      ));
  });
});

// Regression (Tycho #28): a doubly-infinite integral of an odd integrand used
// to numericize to a clean scalar 0 because a single symmetric transform makes
// the Gauss and Kronrod sums cancel to exactly 0 on the first panel, reporting
// a spurious {estimate: 0, error: 0, converged: true}. The doubly-infinite case
// is now split at 0 so a divergent half is detected (non-converged → Monte
// Carlo → Measurement with a large error bar), never a bare 0.
describe('DOUBLY-INFINITE NUMERIC INTEGRATION (Tycho #28)', () => {
  test('divergent ∫_{−∞}^∞ x dx does not numericize to a clean scalar 0', () => {
    const r = engine.parse('\\int_{-\\infty}^\\infty x dx').N();
    // Not a bare 0 scalar: either a Measurement (large error) or inert/symbolic.
    expect(r.isSame(0)).toBe(false);
  });

  test('convergent odd ∫_{−∞}^∞ x·e^(−x²) dx ≈ 0', () =>
    expect(N('\\int_{-\\infty}^\\infty x e^{-x^2} dx')).toBeCloseTo(0, 6));

  test('convergent ∫_{−∞}^∞ e^(−x²) dx ≈ √π', () =>
    expect(N('\\int_{-\\infty}^\\infty e^{-x^2} dx')).toBeCloseTo(
      Math.sqrt(Math.PI),
      6
    ));
});

describe('LIMIT', () => {
  expect(
    engine
      .expr(['Limit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
      .N().re
  ).toMatchInlineSnapshot(`1`);

  expect(
    engine
      .expr(['Limit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
      .N().re
  ).toMatchInlineSnapshot(`1`);

  expect(
    engine
      .expr(['NLimit', ['Function', ['Divide', ['Sin', 'x'], 'x'], 'x'], 0])
      .evaluate().re
  ).toMatchInlineSnapshot(`1.0000000000000002`);

  expect(
    engine.expr(['NLimit', ['Divide', ['Sin', '_'], '_'], 0]).evaluate().re
  ).toMatchInlineSnapshot(`1.0000000000000002`);

  // Should be "1"
  expect(
    engine
      .expr([
        'NLimit',
        ['Function', ['Cos', ['Divide', 1, 'x']], 'x'],
        'Infinity',
      ])
      .evaluate().re
  ).toMatchInlineSnapshot(`1`);

  expect(
    engine.parse('\\lim_{x \\to 0} \\frac{\\sin(x)}{x}').N().re
  ).toMatchInlineSnapshot(`1`);

  // Postfix ^ should be part of the limit body, not applied to the Limit
  test('power inside delimited limit body', () => {
    const expr = engine.parse('\\lim_{x\\to 0}\\left(x\\right)^x');
    // Should be Limit(x^x), not Power(Limit(x), x)
    expect(expr.operator).toBe('Limit');
    expect(expr.latex).toMatchInlineSnapshot(`\\lim_{x\\to0}x^{x}`);
  });

  test('low-confidence numeric limits return NaN (oscillatory function)', () => {
    // sin oscillates at ∞ with no limit: Richardson extrapolation cannot
    // converge, and the error-estimate threshold must reject the meaningless
    // extrapolated value rather than report it confidently.
    const r = engine
      .expr(['NLimit', ['Function', ['Sin', 'x'], 'x'], 'Infinity'])
      .evaluate();
    expect(r.re).toBeNaN();
  });

  test('decaying oscillation converges (sinc at −∞ → 0)', () => {
    // sinc oscillates but |sinc| ≤ 1/|x| → the limit exists and is 0. With
    // the even-series `power=2` transcription bug this stalled to NaN; the
    // Taylor default (`power=1`) converges to ≈0 with a confident estimate.
    const r = engine
      .expr(['NLimit', ['Function', ['Sinc', 'x'], 'x'], 'NegativeInfinity'])
      .evaluate();
    expect(Math.abs(r.re)).toBeLessThan(1e-8);
  });

  test('variable-bound Sum in a limit at ∞ honors the deadline (γ)', () => {
    // Stage-2 corpus-audit P1 (corpus const_gamma/4644c0): the Richardson
    // ladder samples at x = 8^k, so the compiled Sum ran an ever-longer
    // uninterruptible loop — N() of this limit ran >30 s under a 2 s
    // deadline. With the probe iteration budget the over-budget rungs
    // read as NaN, the ladder stops at its clean prefix, and extrapolation
    // converges to γ from the remaining rungs — in milliseconds.
    // Converging to γ at all is the assertion: without the probe budget the
    // ladder's 8^k rungs run an uninterruptible loop that never returns a
    // value to extrapolate from. The jest per-test timeout is the backstop.
    const r = engine
      .parse(
        '\\lim_{n\\to\\infty} \\left(\\sum_{k=1}^{n} \\frac{1}{k} - \\ln n\\right)'
      )
      .N();
    expect(r.re).toBeCloseTo(0.5772156649015329, 9); // Euler–Mascheroni γ
  }, 30_000);

  test('variable-bound Sum in a limit at ∞ is bounded by the probe budget with NO deadline (γ)', () => {
    // Deadline-free sibling of the test above. The Richardson ladder cannot
    // interrupt a single compiled `Sum` sample from the outside, so the
    // LIMIT_PROBE_ITERATION_BUDGET compiled into that sample is the SOLE
    // protection: with no deadline armed (no enclosing span), an unbudgeted
    // Sum whose bound is 8^k would run an ever-longer uninterruptible loop and
    // hang. The budget makes the over-budget rungs read as NaN, the ladder
    // stops at its clean prefix, and extrapolation still converges to γ — in
    // ms. A regression in the budget would hang here rather than hide behind a
    // deadline.
    const ce = new ComputeEngine();
    // As above, the value IS the assertion — an unbudgeted Sum never yields
    // one — and the jest per-test timeout is the backstop.
    const r = ce
      .parse(
        '\\lim_{n\\to\\infty} \\left(\\sum_{k=1}^{n} \\frac{1}{k} - \\ln n\\right)'
      )
      .N();
    expect(r.re).toBeCloseTo(0.5772156649015329, 9); // Euler–Mascheroni γ
  }, 30_000);

  test('variable-bound Sum in a limit at ∞ honors the deadline (π)', () => {
    // Stage-2 corpus-audit P1, second corpus entry (pi/dea83d):
    // lim (4/n²)·Σ_{k=1}^n √(n²−k²) = π (quarter-disc Riemann sum; the √
    // singularity at k=n limits the ladder's convergence to ~1e-8).
    const r = engine
      .parse(
        '\\lim_{n\\to\\infty} \\frac{4}{n^2}\\sum_{k=1}^{n} \\sqrt{n^2-k^2}'
      )
      .N();
    expect(r.re).toBeCloseTo(Math.PI, 7);
  });

  test('ROADMAP B7: catastrophic cancellation returns NaN, never spurious 0', () => {
    // lim_{x→∞} (e^(x·e^(−x)/(e^(−x)+e^(−2x²/(x+1)))) − eˣ)/x = −e² (Gruntz).
    // The two eˣ terms cancel to exactly 0 around x≈40 and overflow to NaN past
    // x≈710, so naive Richardson sampling used to report a confident `0`.
    const f1 = engine.expr([
      'Limit',
      [
        'Function',
        [
          'Divide',
          [
            'Subtract',
            [
              'Exp',
              [
                'Divide',
                ['Multiply', 'x', ['Exp', ['Negate', 'x']]],
                [
                  'Add',
                  ['Exp', ['Negate', 'x']],
                  [
                    'Exp',
                    [
                      'Divide',
                      ['Multiply', -2, ['Square', 'x']],
                      ['Add', 'x', 1],
                    ],
                  ],
                ],
              ],
            ],
            ['Exp', 'x'],
          ],
          'x',
        ],
        'x',
      ],
      'PositiveInfinity',
    ]);
    expect(f1.N().re).toBeNaN();

    // lim_{x→∞} x·ln(x)·ln(x·eˣ−x²)²/ln(ln(x²+2·e^(e^(3x³·ln x)))) = 1/e. The
    // triple exponential overflows for any x≳2, so every sample on the
    // geometric ladder reads 0 while the true value lives near x≈1.5.
    const f2 = engine.expr([
      'Limit',
      [
        'Function',
        [
          'Divide',
          [
            'Multiply',
            'x',
            ['Ln', 'x'],
            [
              'Square',
              [
                'Ln',
                ['Subtract', ['Multiply', 'x', ['Exp', 'x']], ['Square', 'x']],
              ],
            ],
          ],
          [
            'Ln',
            [
              'Ln',
              [
                'Add',
                ['Square', 'x'],
                [
                  'Multiply',
                  2,
                  [
                    'Exp',
                    ['Exp', ['Multiply', 3, ['Power', 'x', 3], ['Ln', 'x']]],
                  ],
                ],
              ],
            ],
          ],
        ],
        'x',
      ],
      'PositiveInfinity',
    ]);
    expect(f2.N().re).toBeNaN();
  });

  describe('ROADMAP B8: symbolic limits (exact closed forms)', () => {
    const INF = 'PositiveInfinity';
    // Build Limit[ body, x -> point ] and return its symbolic evaluate() result.
    const lim = (body: any, point: any) =>
      engine.expr(['Limit', ['Function', body, 'x'], point]).evaluate();

    test('finite point: removable singularity via L’Hôpital', () => {
      expect(lim(['Divide', ['Sin', 'x'], 'x'], 0).re).toBe(1);
      expect(lim(['Divide', ['Subtract', ['Exp', 'x'], 1], 'x'], 0).re).toBe(1);
      // two L’Hôpital steps
      expect(
        lim(['Divide', ['Subtract', 1, ['Cos', 'x']], ['Power', 'x', 2]], 0).re
      ).toBe(0.5);
    });

    test('finite point: exact polynomial / factored value', () => {
      expect(lim(['Add', ['Power', 'x', 2], 1], 2).re).toBe(5);
      expect(
        lim(
          ['Divide', ['Subtract', ['Power', 'x', 3], 8], ['Subtract', 'x', 2]],
          2
        ).re
      ).toBe(12);
    });

    test('at infinity: rational functions', () => {
      const r = [
        'Divide',
        ['Add', ['Multiply', 2, ['Power', 'x', 2]], 3],
        ['Subtract', ['Power', 'x', 2], 1],
      ];
      expect(lim(r, INF).re).toBe(2);
      expect(lim(['Divide', ['Add', 'x', 1], ['Power', 'x', 2]], INF).re).toBe(
        0
      );
      expect(
        lim(['Divide', ['Power', 'x', 2], ['Add', 'x', 1]], INF).isInfinity
      ).toBe(true);
    });

    test('at infinity: growth-order (poly vs exp vs log)', () => {
      // eˣ overtakes x¹⁰⁰ only near x≈700 — numeric probing alone gets this wrong
      expect(
        lim(['Divide', ['Exp', 'x'], ['Power', 'x', 100]], INF).isInfinity
      ).toBe(true);
      expect(lim(['Divide', ['Power', 'x', 100], ['Exp', 'x']], INF).re).toBe(
        0
      );
      expect(lim(['Divide', ['Ln', 'x'], 'x'], INF).re).toBe(0);
    });

    test('at infinity: 1^∞ exponentials → e^a', () => {
      const e = lim(['Power', ['Add', 1, ['Divide', 1, 'x']], 'x'], INF);
      expect(e.N().re).toBeCloseTo(Math.E, 10);
      const e2 = lim(['Power', ['Add', 1, ['Divide', 2, 'x']], 'x'], INF);
      expect(e2.N().re).toBeCloseTo(Math.exp(2), 10);
    });

    test('Wester B8: dominant-term cases SymPy solves', () => {
      // (3ˣ+5ˣ)^{1/x} → 5 (dominant exponential base)
      expect(
        lim(
          [
            'Power',
            ['Add', ['Power', 3, 'x'], ['Power', 5, 'x']],
            ['Divide', 1, 'x'],
          ],
          INF
        ).re
      ).toBe(5);
      // ln x/(sin x + ln x) → 1 (bounded sin x is negligible)
      expect(
        lim(['Divide', ['Ln', 'x'], ['Add', ['Sin', 'x'], ['Ln', 'x']]], INF).re
      ).toBe(1);
    });

    test('oscillatory / non-evaluable stays out of the way (numeric NaN)', () => {
      // sin x at ∞ has no limit; symbolic returns undefined, numeric → NaN.
      expect(
        engine.expr(['Limit', ['Function', ['Sin', 'x'], 'x'], INF]).N().re
      ).toBeNaN();
    });
  });

  describe('Wolfram-style 3-arg Limit(expr, var, point)', () => {
    test('canonicalizes identically to the 2-arg form', () => {
      const threeArg = engine.box([
        'Limit',
        ['Divide', ['Sin', 'x'], 'x'],
        'x',
        0,
      ]);
      const twoArg = engine.box(['Limit', ['Divide', ['Sin', 'x'], 'x'], 0]);
      expect(threeArg.json).toEqual(twoArg.json);
    });

    test('sin(x)/x as x → 0 evaluates to 1', () => {
      expect(
        engine.box(['Limit', ['Divide', ['Sin', 'x'], 'x'], 'x', 0]).evaluate()
          .re
      ).toBe(1);
    });

    test('(1 - cos x)/x² as x → 0 evaluates to 1/2 (matches 2-arg)', () => {
      const body = ['Divide', ['Subtract', 1, ['Cos', 'x']], ['Power', 'x', 2]];
      const threeArg = engine
        .box(['Limit', body, 'x', 0])
        .evaluate()
        .toString();
      const twoArg = engine.box(['Limit', body, 0]).evaluate().toString();
      expect(threeArg).toEqual(twoArg);
      expect(threeArg).toBe('1/2');
    });

    test('directional/pole case 1/x as x → 0 matches 2-arg (stays symbolic)', () => {
      const body = ['Divide', 1, 'x'];
      const threeArg = engine
        .box(['Limit', body, 'x', 0])
        .evaluate()
        .toString();
      const twoArg = engine.box(['Limit', body, 0]).evaluate().toString();
      expect(threeArg).toEqual(twoArg);
    });

    test('a symbolic (non-free) point is still read as the direction form', () => {
      // `a` is not free in `1/x`, so this is Limit(function, point=a, dir=1),
      // not the Wolfram (expr, var, point) form.
      expect(engine.box(['Limit', ['Divide', 1, 'x'], 'a', 1]).json).toEqual([
        'Limit',
        ['Function', ['Block', ['Divide', 1, 'x']], 'x'],
        'a',
        1,
      ]);
    });
  });

  describe('ONE-SIDED LIMITS', () => {
    // Regression: `0^+`/`0^-` on the limit point parse as
    // `PseudoInverse(0)`/`Superminus(0)` (generic superscript postfix); in
    // the limit-point position they are direction markers and must unwrap
    // into `Limit`'s direction operand.
    test('1/x as x → 0⁺ is +∞', () =>
      expect(
        engine.parse('\\lim_{x\\to 0^+} \\frac{1}{x}').evaluate().toString()
      ).toBe('+oo'));

    test('1/x as x → 0⁻ is −∞', () =>
      expect(
        engine.parse('\\lim_{x\\to 0^-} \\frac{1}{x}').evaluate().toString()
      ).toBe('-oo'));

    test('braced marker ^{+} parses the same', () =>
      expect(
        engine.parse('\\lim_{x\\to 0^{+}} \\frac{1}{x}').evaluate().toString()
      ).toBe('+oo'));

    test('ln x as x → 0⁺ is −∞', () =>
      expect(
        engine.parse('\\lim_{x\\to 0^+} \\ln x').evaluate().toString()
      ).toBe('-oo'));

    test('rule-arrow function-call form carries the direction', () => {
      expect(
        engine
          .parse('\\mathrm{Limit}(\\frac{1}{x}, x\\to 0^+)')
          .evaluate()
          .toString()
      ).toBe('+oo');
      expect(
        engine
          .parse('\\mathrm{Limit}(\\frac{1}{x}, x\\to 0^-)')
          .evaluate()
          .toString()
      ).toBe('-oo');
    });

    test('two-sided limit is unchanged', () =>
      expect(
        engine.parse('\\lim_{x\\to 0} \\frac{\\sin x}{x}').evaluate().toString()
      ).toBe('1'));

    test('direction serializes as a ^{+}/^{-} marker (round-trip)', () => {
      expect(engine.parse('\\lim_{x\\to 0^+} \\frac{1}{x}').latex).toBe(
        '\\lim_{x\\to0^{+}}\\frac{1}{x}'
      );
      expect(engine.parse('\\lim_{x\\to 0^-} \\frac{1}{x}').latex).toBe(
        '\\lim_{x\\to0^{-}}\\frac{1}{x}'
      );
    });

    test('a symbolic point with a direction round-trips', () =>
      expect(engine.parse('\\lim_{x\\to a^+} \\frac{1}{x-a}').latex).toBe(
        '\\lim_{x\\to a^{+}}\\frac{1}{x-a}'
      ));

    test('superscript +/− outside a limit point keep their meanings', () => {
      expect(engine.parse('A^+').json).toEqual(['PseudoInverse', 'A']);
      expect(engine.parse('3^-').json).toEqual(['Superminus', 3]);
    });
  });
});

describe('DOUBLY-INFINITE SUMS', () => {
  // Regression: limits of n = −∞…∞ produced an empty iteration range, so
  // these sums evaluated to 0. These tests assert VALUES, not timing, and run
  // unbounded (no enclosing span); jest's per-test timeout is the hang
  // backstop.
  test('Σ 2^−|n| over all integers = 3', () => {
    const r = engine
      .expr([
        'Sum',
        ['Power', 2, ['Negate', ['Abs', 'n']]],
        ['Limits', 'n', 'NegativeInfinity', 'PositiveInfinity'],
      ])
      .N();
    expect(r.re).toBeCloseTo(3, 10);
  });

  test('Σ sinc³(n) over all integers = 3π/4', () => {
    const r = engine
      .expr([
        'Sum',
        ['Power', ['Sinc', 'n'], 3],
        ['Limits', 'n', 'NegativeInfinity', 'PositiveInfinity'],
      ])
      .N();
    expect(r.re).toBeCloseTo((3 * Math.PI) / 4, 8);
  });

  test('Σ 2^n for n = −∞…−1 = 1 (infinite lower bound, finite upper)', () => {
    const r = engine
      .expr(['Sum', ['Power', 2, 'n'], ['Limits', 'n', 'NegativeInfinity', -1]])
      .N();
    expect(r.re).toBeCloseTo(1, 10);
  });

  test('a DIVERGENT doubly-infinite sum stays unevaluated (no principal value)', () => {
    // Σ n over all of ℤ pairs to 0 at every symmetric step — the Cauchy
    // PRINCIPAL VALUE, not a sum. Only an absolutely convergent series has a
    // well-defined unordered doubly-infinite value, so this stays symbolic
    // (ruled 2026-08-14) rather than answering 0.
    const r = engine
      .expr([
        'Sum',
        'n',
        ['Limits', 'n', 'NegativeInfinity', 'PositiveInfinity'],
      ])
      .N();
    expect(r.operator).toBe('Sum');
  });
});

// Regression: a `D` node with no operand (produced e.g. when upstream LaTeX
// parsing drops an argument, as in Desmos `D\left[1\right]` list indexing)
// must not throw `Cannot read properties of undefined (reading 'canonical')`
// out of the canonical/evaluate handlers (which box.ts catches and logs to
// stderr, masking the failure).
describe('D with no operand does not crash', () => {
  let errorSpy: jest.SpyInstance;
  beforeAll(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => errorSpy.mockRestore());

  test('canonicalizing D() does not log an internal error', () => {
    const canon = engine.box(['D']);
    expect(canon.json).toEqual(['D']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('evaluating D() does not log an internal error', () => {
    const result = engine.box(['D'], { canonical: false }).evaluate();
    expect(result.json).toEqual(['D']);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// Binder value-shield convention (ARCHITECTURE.md, "Bound variables, free
// symbols, and assigned values"): a variable bound by `D`/`Integrate`/`Limit`
// is a pure symbol — a same-named GLOBAL assignment (`x := 5`) must not leak
// into the operation OR its result. Any OTHER symbol is free and resolves
// normally. Each case uses a fresh engine (`assign` mutates the engine).
describe('binder value-shield: D / Integrate / Limit keep the bound variable symbolic', () => {
  test('D result stays symbolic in the differentiation variable (box + parse)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    // Was `10` (differentiated to `2x`, then evaluated at `x := 5`).
    expect(
      ce
        .box(['D', ['Power', 'x', 2], 'x'])
        .evaluate()
        .toString()
    ).toBe('2x');
    expect(ce.parse('\\frac{d}{dx}x^2').evaluate().toString()).toBe('2x');
    // The global value is intact after the operation.
    expect(ce.box('x').evaluate().toString()).toBe('5');
  });

  test('D shields only the bound variable; free symbols still resolve', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    ce.assign('x', 5);
    // Was `30`; the free coefficient `a` resolves, the bound `x` stays symbolic.
    expect(
      ce
        .box(['D', ['Multiply', 'a', ['Power', 'x', 2]], 'x'])
        .evaluate()
        .toString()
    ).toBe('6x');
  });

  test('Integrate: indefinite result stays symbolic in the integration variable', () => {
    const clean = new ComputeEngine();
    const expected = clean
      .box(['Integrate', ['Power', 'x', 2], 'x'])
      .evaluate()
      .toString();
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    // Was `125/3` (antiderivative `x³/3` evaluated at `x := 5`).
    expect(
      ce
        .box(['Integrate', ['Power', 'x', 2], 'x'])
        .evaluate()
        .toString()
    ).toBe(expected);
    expect(ce.box('x').evaluate().toString()).toBe('5');
  });

  test('Integrate: a nested transformer head does not fold the bound variable', () => {
    const clean = new ComputeEngine();
    const expected = clean
      .box(['Integrate', ['Power', 'x', 2], 'x'])
      .evaluate()
      .toString();
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    // Was `25x` (`Simplify(x²)` folded to `25` before integrating).
    expect(
      ce
        .box(['Integrate', ['Simplify', ['Power', 'x', 2]], 'x'])
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test('Integrate: definite value is independent of the bound variable value', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    // ∫₀¹ x² dx = 1/3; was `0`.
    expect(
      ce
        .box(['Integrate', ['Power', 'x', 2], ['Tuple', 'x', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('1/3');
  });

  test('Integrate: free coefficients still resolve', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    ce.assign('x', 5);
    // ∫ a·x dx = (a/2)·x² = (3/2)·x², with the bound `x` symbolic.
    expect(
      ce
        .box(['Integrate', ['Multiply', 'a', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('3/2 * x^2');
  });

  test('Limit stays symbolic through a nested transformer (box + parse)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    // Was `25` on BOTH routes; the box route also mis-canonicalized because a
    // value-bound `x` dropped out of `.unknowns`.
    expect(
      ce
        .box(['Limit', ['Simplify', ['Power', 'x', 2]], 'x', 0])
        .evaluate()
        .toString()
    ).toBe('0');
    expect(
      ce
        .parse('\\lim_{x\\to 0}\\operatorname{Simplify}(x^2)')
        .evaluate()
        .toString()
    ).toBe('0');
    expect(ce.box('x').evaluate().toString()).toBe('5');
  });
});

describe('INTEGRATE: interior pole', () => {
  // The fundamental theorem of calculus needs a bounded integrand. When the
  // integrand blows up at a point STRICTLY INSIDE the bounds, differencing an
  // antiderivative reports a finite value for a divergent integral, so the
  // `Integrate` handler keeps the expression inert instead (`.N()` quadrature
  // still gives a number, with its error bar).

  const evaluated = (latex: string) =>
    new ComputeEngine().parse(latex).evaluate();

  test('1/t across zero is inert (was 0)', () => {
    const result = evaluated('\\int_{-1}^{1} \\frac{1}{t} dt');
    expect(result.operator).toBe('Integrate');
  });

  test('1/t^2 across zero diverges to +∞ (was -2)', () => {
    const result = evaluated('\\int_{-1}^{1} \\frac{1}{t^2} dt');
    expect(result.toString()).toBe('+oo');
  });

  test('t^-3 across zero is inert (negative Power exponent)', () => {
    const result = evaluated('\\int_{-1}^{1} t^{-3} dt');
    expect(result.operator).toBe('Integrate');
  });

  test('1/(t-1) across its pole is inert (was -ln(2))', () => {
    const result = evaluated('\\int_{-1}^{2} \\frac{1}{t-1} dt');
    expect(result.operator).toBe('Integrate');
  });

  test('1/(t^2-1) across both poles is inert (was -ln(3))', () => {
    const result = evaluated('\\int_{-2}^{2} \\frac{1}{t^2-1} dt');
    expect(result.operator).toBe('Integrate');
  });

  test('pole outside the bounds keeps its closed form', () => {
    expect(evaluated('\\int_{1}^{2} \\frac{1}{t} dt').toString()).toBe('ln(2)');
    expect(evaluated('\\int_{0}^{1} \\frac{1}{t+1} dt').toString()).toBe(
      'ln(2)'
    );
    expect(evaluated('\\int_{2}^{3} \\frac{1}{t-1} dt').toString()).toBe(
      'ln(2)'
    );
  });

  test('denominator with no real root keeps its closed form', () => {
    expect(evaluated('\\int_{-1}^{1} \\frac{1}{t^2+1} dt').toString()).toBe(
      '1/2 * pi'
    );
  });

  test('a cancelling denominator is not a pole', () => {
    // (t²−1)/(t−1) = t+1 is bounded at t = 1, so the numeric confirmation
    // rejects the root of the denominator and the closed form survives.
    expect(evaluated('\\int_{-1}^{1} \\frac{t^2-1}{t-1} dt').toString()).toBe(
      '2'
    );
  });

  test('a pole AT a bound is not interior', () => {
    // Improper but the engine already answers these; unchanged by the check.
    expect(evaluated('\\int_{0}^{1} \\frac{1}{\\sqrt{t}} dt').toString()).toBe(
      '2'
    );
    expect(evaluated('\\int_{0}^{1} \\frac{1}{t} dt').toString()).toBe('+oo');
    expect(evaluated('\\int_{0}^{1} \\ln t \\, dt').operator).toBe('Integrate');
  });

  test('a symbolic bound switches the detection off', () => {
    // No finite numeric interval to test against: whatever the engine did
    // before, it still does.
    expect(evaluated('\\int_{0}^{a} \\frac{1}{t} dt').toString()).toBe('+oo');
  });

  test('a denominator with another free symbol is not analyzed', () => {
    // The root of `t² + x` is unknowable, so the closed form is kept.
    expect(evaluated('\\int_{-1}^{1} \\frac{1}{t^2+x} dt').operator).not.toBe(
      'Integrate'
    );
  });

  test('circular functions of a linear argument', () => {
    // tan/sec blow up at π/2 + kπ, cot/csc and a sin/cos denominator at kπ.
    expect(evaluated('\\int_{0}^{2} \\tan t \\, dt').operator).toBe(
      'Integrate'
    );
    expect(evaluated('\\int_{0}^{2} \\sec t \\, dt').operator).toBe(
      'Integrate'
    );
    expect(evaluated('\\int_{1}^{4} \\cot t \\, dt').operator).toBe(
      'Integrate'
    );
    expect(evaluated('\\int_{0}^{2} \\frac{1}{\\cos t} dt').operator).toBe(
      'Integrate'
    );
    expect(evaluated('\\int_{1}^{4} \\frac{1}{\\sin t} dt').operator).toBe(
      'Integrate'
    );
    // No pole in range: unchanged.
    expect(evaluated('\\int_{1}^{2} \\csc t \\, dt').operator).not.toBe(
      'Integrate'
    );
    expect(evaluated('\\int_{0}^{\\pi} \\sin t \\, dt').toString()).toBe('2');
    // tan(t/4) first blows up at t = 2π, outside (0, 2).
    expect(evaluated('\\int_{0}^{2} \\tan(t/4) dt').operator).not.toBe(
      'Integrate'
    );
  });

  test('box route and an assigned integration variable', () => {
    // `Integrate` is `lazy`, so on the box route its held operands arrive
    // unbound; and the integration variable is value-shielded, so a global
    // `t := 5` must not substitute into the pole check either.
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Integrate', ['Divide', 1, 'x'], ['Limits', 'x', -1, 1]])
        .evaluate().operator
    ).toBe('Integrate');
    expect(
      ce
        .box(['Integrate', ['Divide', 1, 'x'], ['Limits', 'x', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('ln(2)');

    const assigned = new ComputeEngine();
    assigned.assign('t', 5);
    expect(
      assigned.parse('\\int_{-1}^{1} \\frac{1}{t} dt').evaluate().operator
    ).toBe('Integrate');
    expect(
      assigned.parse('\\int_{1}^{2} \\frac{1}{t} dt').evaluate().toString()
    ).toBe('ln(2)');
  });

  test('.N() still reports a quadrature estimate for a divergent integral', () => {
    // The inert `Integrate` is the EVALUATE answer only; the numeric route is
    // unchanged, and is at least honest about its error bar.
    const n = new ComputeEngine().parse('\\int_{-1}^{1} \\frac{1}{t} dt').N();
    // No value at all: the integrand changes sign across the pole.
    expect(n.isNaN).toBe(true);
  });
});

describe('INTEGRATE: sign of the cot antiderivative and of |sec| at the bounds', () => {
  const ce = new ComputeEngine();

  test('∫ cot(ax + b) dx is +ln|sin(ax + b)|/a', () => {
    // d/dx ln|sin x| = cos x / sin x = cot x; the pattern rule used to carry
    // a spurious `Negate`.
    expect(ce.parse('\\int \\cot(2t+1)\\,dt').evaluate().toString()).toBe(
      '1/2 * ln(|sin(2t + 1)|)'
    );
    expect(ce.parse('\\int \\cot t\\,dt').evaluate().toString()).toBe(
      'ln(|sin(t)|)'
    );
  });

  test('∫₀² cot t dt diverges to +∞ (pole at the lower bound)', () => {
    expect(ce.parse('\\int_0^2 \\cot t\\,dt').evaluate().toString()).toBe(
      '+oo'
    );
  });

  test('∫₀¹ tan t dt is the real ln(sec 1), not ln(−sec 1)', () => {
    // `|sec 1|` evaluated to `-sec(1)` while every circular function's sign
    // was off by one quadrant, which made this real integral complex.
    const v = ce.parse('\\int_0^1 \\tan t\\,dt').evaluate();
    expect(v.toString()).toBe('ln(sec(1))');
    const n = v.N();
    expect(n.im).toBe(0);
    expect(n.re).toBeCloseTo(-Math.log(Math.cos(1)), 12);
  });
});

describe('INTEGRATE: the elementary rule table, verified by differentiation', () => {
  // Every built-in `∫ f(ax + b) dx` rule is checked the only way a table can
  // be trusted: differentiate the answer and compare with the integrand at a
  // few points of its domain. Eight rules were wrong at once (2026-08-22):
  // `sinh`/`cosh` answered `ln|cosh|`/`ln|sinh|`, `tanh` had the wrong sign,
  // `sech` answered `ln|tanh|`, `csch` lacked the half-argument, and the six
  // inverse hyperbolic rules answered the function's logarithmic DEFINITION
  // instead of an antiderivative.
  const ce = new ComputeEngine();
  const cases: Array<[latex: string, points: number[]]> = [
    ['\\sinh t', [1.3, -0.7, 2.2]],
    ['\\cosh t', [1.3, -0.7, 2.2]],
    ['\\tanh t', [1.3, -0.7, 2.2]],
    ['\\coth t', [1.3, -0.7, 2.2]],
    ['\\sech t', [1.3, -0.7, 2.2]],
    ['\\csch t', [1.3, -0.7, 2.2]],
    ['\\tan t', [1.3, -0.7, 2.2]],
    ['\\cot t', [1.3, -0.7, 2.2]],
    ['\\sec t', [1.3, -0.7, 2.2]],
    ['\\csc t', [1.3, -0.7, 2.2]],
    ['\\tanh(2t+1)', [1.3, -0.7, 2.2]],
    ['\\sech(3t-1)', [1.3, -0.7, 2.2]],
    ['\\csch(2t+1)', [1.3, -0.7, 2.2]],
    ['\\arcsinh t', [0.3, -0.4, 2.2]],
    ['\\arccosh t', [1.3, 2.2, 5]],
    ['\\arctanh t', [0.3, -0.4, 0.45]],
    ['\\arccoth t', [1.3, -2.2, 5]],
    ['\\arcsech t', [0.3, 0.45, 0.9]],
    ['\\arccsch t', [0.3, -0.4, 2.2]],
    ['\\arcsinh(2t+1)', [0.3, -0.4, 2.2]],
    ['\\arctanh(t/2)', [0.3, -0.4, 0.45]],
  ];
  for (const [latex, points] of cases) {
    test(`d/dt ∫ ${latex} dt = ${latex}`, () => {
      const F = ce.parse(`\\int ${latex}\\,dt`).evaluate();
      expect(F.has('Integrate')).toBe(false);
      const dF = ce.box(['D', F, 't']).evaluate();
      for (const t0 of points) {
        const lhs = dF.subs({ t: ce.number(t0) }).N();
        const rhs = ce
          .parse(latex)
          .subs({ t: ce.number(t0) })
          .N();
        // `toBeCloseTo`, not `toBe(0)`: a derivative can evaluate to `-0`.
        expect(lhs.im).toBeCloseTo(0, 12);
        expect(lhs.re).toBeCloseTo(rhs.re, 6);
      }
    });
  }
});

describe('INTEGRATE: interior pole — hyperbolic, reciprocal and near-bound families', () => {
  const ce = new ComputeEngine();
  const inert = (latex: string) => ce.parse(latex).evaluate().has('Integrate');

  test('a hyperbolic pole of a linear argument is detected', () => {
    // csch² is positive on both sides of its pole: the integral diverges
    // to +∞, which is what the handler now answers.
    expect(
      ce.parse('\\int_{-1}^{1} \\csch^2 t\\,dt').evaluate().toString()
    ).toBe('+oo');
    expect(inert('\\int_{-1}^{1} \\coth t\\,dt')).toBe(true);
    expect(inert('\\int_{-1}^{1} \\frac{1}{\\sinh t} dt')).toBe(true);
  });

  test('the zeros of a circular divisor are poles: 1/tan is not canonicalized to cot', () => {
    expect(inert('\\int_{-1}^{1} \\frac{1}{\\tan t} dt')).toBe(true);
  });

  test('a root 1e-10 inside a bound is an interior pole, not an endpoint', () => {
    expect(
      ce.parse('\\int_0^1 (t-10^{-10})^{-2} dt').evaluate().toString()
    ).toBe('+oo');
  });

  test('a pole steep enough to overflow both samples is still a pole', () => {
    expect(ce.parse('\\int_{-1}^{1} t^{-300} dt').evaluate().toString()).toBe(
      '+oo'
    );
  });

  test('a double root AT the bound is an endpoint singularity, left as it was', () => {
    expect(
      ce.parse('\\int_0^1 \\frac{1}{(t-1)^2} dt').evaluate().toString()
    ).toBe('~oo');
  });
});

describe('INTEGRATE: a divergent integral is reported as such by evaluate() and N()', () => {
  const ce = new ComputeEngine();

  test('one-signed across the pole: ±∞ on both routes', () => {
    expect(
      ce.parse('\\int_{-1}^{1} \\frac{1}{t^2} dt').evaluate().toString()
    ).toBe('+oo');
    expect(ce.parse('\\int_{-1}^{1} \\frac{1}{t^2} dt').N().toString()).toBe(
      '+oo'
    );
    expect(ce.parse('\\int_{-1}^{1} \\frac{1}{t^4} dt').N().toString()).toBe(
      '+oo'
    );
    expect(
      ce.parse('\\int_{-1}^{1} -\\frac{1}{t^2} dt').evaluate().toString()
    ).toBe('-oo');
    expect(ce.parse('\\int_{-1}^{1} -\\frac{1}{t^2} dt').N().toString()).toBe(
      '-oo'
    );
  });

  test('sign-changing across the pole: inert under evaluate(), NaN under N()', () => {
    // The Cauchy principal value of ∫₋₁¹ dt/t is 0, but the integral itself
    // has no value; the quadrature used to report `−1.4 ± 3.6`.
    expect(ce.parse('\\int_{-1}^{1} \\frac{1}{t} dt').evaluate().operator).toBe(
      'Integrate'
    );
    expect(ce.parse('\\int_{-1}^{1} \\frac{1}{t} dt').N().isNaN).toBe(true);
    // sec is positive before π/2 and negative after: +∞ − ∞.
    expect(ce.parse('\\int_0^2 \\sec t\\,dt').N().isNaN).toBe(true);
  });

  test('a clean integral still integrates numerically', () => {
    expect(ce.parse('\\int_1^2 \\frac{1}{t} dt').N().re).toBeCloseTo(
      Math.LN2,
      10
    );
  });
});

describe('INTEGRATE: divergence verdict — orientation, sign crossings, truncation, iterated form', () => {
  const ce = new ComputeEngine();

  test('reversed bounds negate the infinity on both routes', () => {
    expect(
      ce.parse('\\int_{1}^{-1} \\frac{1}{t^2} dt').evaluate().toString()
    ).toBe('-oo');
    expect(ce.parse('\\int_{1}^{-1} \\frac{1}{t^2} dt').N().toString()).toBe(
      '-oo'
    );
    expect(ce.parse('\\int_{1}^{-1} -\\frac{1}{t^2} dt').N().toString()).toBe(
      '+oo'
    );
  });

  test('a zero between the samples does not hide the pole', () => {
    // 1/t − 1/(2000t²) is positive at t = 0.01 and negative at t = 0.0001 on
    // its way to −∞ from both sides; the closed form would answer 1/1000.
    const e = ce.parse(
      '\\int_{-1}^{1} \\left(\\frac{1}{t} - \\frac{1}{2000 t^2}\\right) dt'
    );
    expect(e.evaluate().toString()).toBe('-oo');
    expect(e.N().toString()).toBe('-oo');
  });

  test('a pole lattice cut short yields no direction: inert / NaN', () => {
    // sec² has 127 poles in [−200, 200], more than the enumeration cap; the
    // integral diverges, but the unexamined poles could go either way.
    const e = ce.parse('\\int_{-200}^{200} t \\sec^2(t)\\,dt');
    expect(e.evaluate().operator).toBe('Integrate');
    expect(e.N().isNaN).toBe(true);
  });

  test('the iterated form checks each constant-bound dimension', () => {
    expect(
      ce
        .box([
          'Integrate',
          ['Sec', 'x'],
          ['Limits', 'y', 0, 1],
          ['Limits', 'x', 0, 2],
        ])
        .N().isNaN
    ).toBe(true);
    expect(
      ce
        .box([
          'Integrate',
          ['Power', 'x', -2],
          ['Limits', 'y', 0, 1],
          ['Limits', 'x', -1, 1],
        ])
        .N()
        .toString()
    ).toBe('+oo');
    // A pole the integrand shows only jointly with the other variable is not
    // claimed: the quadrature runs as before.
    const joint = ce
      .box([
        'Integrate',
        ['Divide', 'y', ['Square', 'x']],
        ['Limits', 'y', 0, 1],
        ['Limits', 'x', 1, 2],
      ])
      .N();
    expect(joint.operator).toBe('Measurement');
  });

  test('a spare Function parameter is refused before the pole check runs', () => {
    ce.assign('q', ce.number(0));
    const r = ce
      .box([
        'Integrate',
        ['Function', ['Divide', 1, ['Add', ['Square', 'x'], 'q']], 'x', 'q'],
        ['Limits', 'x', -1, 1],
      ])
      .N();
    expect(r.operator).toBe('Integrate');
  });
});
