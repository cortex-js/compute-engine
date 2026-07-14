import { engine } from '../utils';

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

  // Cyclic integration patterns (e^x with trig)
  test('e^x*sin(x) (cyclic integration)', () =>
    expect(evaluate('\\int e^x \\sin x dx')).toMatchInlineSnapshot(
      `-1/2 * cos(x) * e^x + 1/2 * sin(x) * e^x`
    ));

  test('e^x*cos(x) (cyclic integration)', () =>
    expect(evaluate('\\int e^x \\cos x dx')).toMatchInlineSnapshot(
      `1/2 * sin(x) * e^x + 1/2 * cos(x) * e^x`
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

  // Rational integrands with repeated linear/irreducible-quadratic factors,
  // closed via full partial-fraction decomposition (exact bigint solve).
  // ∫(1+x²+x³)/((x−1)x(1+x²)²(1+x+x²)) previously returned a WRONG 0; the
  // others returned an inert integral. Verify D(F) = integrand numerically.
  describe('repeated-factor rational integration', () => {
    const verify = (latex: string, timeLimit = engine.timeLimit) => {
      const savedTimeLimit = engine.timeLimit;
      engine.timeLimit = timeLimit;
      try {
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
      } finally {
        engine.timeLimit = savedTimeLimit;
      }
    };
    test('∫1/(x²(x+1)) dx', () => verify('\\frac{1}{x^2(x+1)}'));
    test('∫1/(x(1+x²)²) dx', () => verify('\\frac{1}{x(1+x^2)^2}'));
    test('∫(1+x²+x³)/((x-1)x(1+x²)²(1+x+x²)) dx (was wrongly 0)', () =>
      verify('\\frac{1+x^2+x^3}{(x-1)x(1+x^2)^2(1+x+x^2)}', 10_000));
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
      `1/3 * ln(|x + 1|) + sqrt(3)/3 * arctan(2/3sqrt(3) * x - sqrt(3)/3) - 1/6 * ln(|x^2 - x + 1|)`
    ));

  test('∫1/(x²−x+1) dx is exact (irreducible quadratic with Negate term)', () =>
    expect(
      noFloats(evaluate('\\int \\frac{1}{x^2-x+1} dx'))
    ).toMatchInlineSnapshot(`2/3sqrt(3) * arctan(2/3sqrt(3) * x - sqrt(3)/3)`));

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
    ).toMatchInlineSnapshot(`1/2 * x - 1/2 * arctan(x)`));

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
    ).toMatchInlineSnapshot(`arsinh(2/3sqrt(3) * x + sqrt(3)/3)`);
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
    // uninterruptible loop — N() of this limit ran >30 s with a 2 s
    // ce.timeLimit. With the probe iteration budget the over-budget rungs
    // read as NaN, the ladder stops at its clean prefix, and extrapolation
    // converges to γ from the remaining rungs — in milliseconds.
    const start = Date.now();
    const r = engine
      .parse('\\lim_{n\\to\\infty} \\left(\\sum_{k=1}^{n} \\frac{1}{k} - \\ln n\\right)')
      .N();
    expect(r.re).toBeCloseTo(0.5772156649015329, 9); // Euler–Mascheroni γ
    expect(Date.now() - start).toBeLessThan(5000);
  });

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
        engine
          .box(['Limit', ['Divide', ['Sin', 'x'], 'x'], 'x', 0])
          .evaluate()
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
      expect(
        engine.box(['Limit', ['Divide', 1, 'x'], 'a', 1]).json
      ).toEqual([
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
        engine
          .parse('\\lim_{x\\to 0} \\frac{\\sin x}{x}')
          .evaluate()
          .toString()
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
  // these sums evaluated to 0
  //
  // These tests assert VALUES, not timing. Under a fully-parallel jest sweep
  // the default 2 s wall-clock deadline can expire from CPU contention alone
  // (observed flake), so give them a generous limit.
  let savedTimeLimit: number;
  beforeAll(() => {
    savedTimeLimit = engine.timeLimit;
    engine.timeLimit = 20_000;
  });
  afterAll(() => {
    engine.timeLimit = savedTimeLimit;
  });

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
