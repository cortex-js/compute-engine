import { ComputeEngine } from '../../src/compute-engine';

/**
 * Numeric evaluation of rational multiples of π, and of a rational times a
 * constant, at machine precision and at the default precision; large angles
 * with a π factor in degree mode.
 *
 * Three defects, found 2026-09-25 (ROADMAP) and fixed together:
 *
 * 1. At machine precision, an exact rational was converted to a float
 *    through a 15-digit big decimal (the global `BigDecimal.precision` of a
 *    machine-precision engine), fewer than the 17 digits a double carries:
 *    `(1/6).N()` was `0.166666666666667`, and `Divide(Pi, 6).N()` was nine
 *    units in the last place from `Math.PI / 6`.
 * 2. A product of an exact rational and a float rounded the quotient first
 *    and then the product: `sin(π/6)` at 21 digits was `0.500…001`, and so
 *    was `sin(30)` in degree mode, where `canonicalAngle` also converted the
 *    multiple of π to a float before its product with π.
 * 3. In degree mode an angle with a π factor (`10^{30}\pi`) was rounded to
 *    the working precision before the reduction modulo 2π, and `\sin` of it
 *    was `0` where the value is `0.3501…`.
 */

describe('at machine precision a rational is the correctly rounded double', () => {
  const m = new ComputeEngine({ precision: 'machine' });

  test('a rational literal', () => {
    expect(m.box(['Rational', 1, 6]).N().re).toBe(1 / 6);
    expect(m.box(['Rational', 2, 3]).N().toString()).toBe('0.6666666666666666');
  });

  test.each([
    ['\\frac{\\pi}{6}', Math.PI / 6],
    ['\\frac{7\\pi}{6}', (Math.PI * 7) / 6],
    ['\\frac{e}{3}', Math.E / 3],
    ['\\exp(\\frac{\\pi}{6})', Math.exp(Math.PI / 6)],
  ])('%s is the double of the same arithmetic', (tex, expected) => {
    expect(m.parse(tex).N().re).toBe(expected);
  });

  test('trigonometric values of rational multiples of π', () => {
    expect(m.parse('\\sin(\\frac{7\\pi}{6})').N().re).toBe(
      Math.sin((Math.PI * 7) / 6)
    );
    expect(m.parse('\\sin(\\frac{\\pi}{6})').N().re).toBe(
      Math.sin(Math.PI / 6)
    );
    expect(m.parse('\\cos(\\frac{\\pi}{3})').N().re).toBe(
      Math.cos(Math.PI / 3)
    );
  });

  test('a negative multiple of π', () => {
    expect(m.parse('\\sin(-\\frac{7\\pi}{6})').N().re).toBe(
      Math.sin(-(Math.PI * 7) / 6)
    );
  });

  test('a product whose numerator form overflows stays finite', () => {
    // `(2/3)·1.5e308`: `1.5e308 · 2` overflows a double, so the quotient
    // form `1.5e308 · (2/3)` is kept.
    expect(m.box(['Multiply', ['Rational', 2, 3], 1.5e308]).N().re).toBe(
      1.5e308 * (2 / 3)
    );
  });

  test('cot at a zero on the exact-angle route is 0, as cos is', () => {
    // `5π/2` is reduced exactly to `π/2` and the big-decimal kernel runs at
    // 20 digits; its rounding dust is chopped for `cot` as it is for `cos`.
    expect(m.parse('\\cot(\\frac{5\\pi}{2})').N().re).toBe(0);
    expect(m.parse('\\cos(\\frac{5\\pi}{2})').N().re).toBe(0);
  });
});

describe('at 21 digits a rational multiple of π is rounded once', () => {
  const ce = new ComputeEngine();

  test('sin(π/6) and cos(π/3) are exactly 1/2', () => {
    expect(ce.parse('\\sin(\\frac{\\pi}{6})').N().toString()).toBe('0.5');
    expect(ce.parse('\\cos(\\frac{\\pi}{3})').N().toString()).toBe('0.5');
  });

  test('a product with a symbolic factor floats every literal', () => {
    // The exact literal is held only in an all-number product: with a
    // symbol, `(1/3)·(1/x)` must not come back as the exact `1/(3x)`.
    expect(ce.parse('\\frac13\\cdot\\frac1x').N().json).toEqual([
      'Divide',
      { num: '0.333333333333333333333' },
      'x',
    ]);
  });

  test('an angle near a special angle keeps its guard digits', () => {
    // `π/2 − 10⁻¹²` must carry more than 21 digits for the cosine to be
    // `10⁻¹²` to 9 digits: the product `(1/2)·π` keeps its guard digits.
    const cos = ce.parse('\\cos(\\frac{\\pi}{2}-10^{-12})').N();
    expect(cos.re / 1e-12).toBeCloseTo(1, 9);
  });
});

describe('degree mode', () => {
  const d = new ComputeEngine();
  d.angularUnit = 'deg';

  test('sin(30) and cos(60) are exactly 1/2 at 21 digits', () => {
    expect(d.parse('\\sin(30)').N().toString()).toBe('0.5');
    expect(d.parse('\\cos(60)').N().toString()).toBe('0.5');
  });

  test('a large angle with a π factor is reduced from its exact value', () => {
    // sin(10³⁰·π degrees) = sin(10³⁰·π²/180 radians) = 0.35016022992…
    expect(d.parse('\\sin(10^{30}\\pi)').N().toString()).toBe(
      '0.350160229920896711994'
    );
    const m = new ComputeEngine({ precision: 'machine' });
    m.angularUnit = 'deg';
    expect(m.parse('\\sin(10^{30}\\pi)').N().re).toBeCloseTo(
      0.35016022992089671,
      15
    );
  });

  test('a negative large angle, and the gradian and turn units', () => {
    // The reference is the radian route at 60 digits, where the rounded
    // angle keeps 29 fractional digits.
    const ref = (radians: string) =>
      new ComputeEngine({ precision: 60 }).parse(radians).N().re;
    expect(d.parse('\\sin(-10^{30}\\pi)').N().re).toBeCloseTo(
      ref('\\sin(-10^{30}\\pi^2/180)'),
      12
    );
    const g = new ComputeEngine();
    g.angularUnit = 'grad';
    expect(g.parse('\\sin(10^{30}\\pi)').N().re).toBeCloseTo(
      ref('\\sin(10^{30}\\pi^2/200)'),
      12
    );
    const t = new ComputeEngine();
    t.angularUnit = 'turn';
    expect(t.parse('\\sin(10^{30}\\pi)').N().re).toBeCloseTo(
      ref('\\sin(2\\cdot10^{30}\\pi^2)'),
      12
    );
    // A rational part beside the π factor: `10^{30}π + 720` degrees is
    // `10^{30}π` degrees plus two turns.
    expect(d.parse('\\sin(10^{30}\\pi+720)').N().toString()).toBe(
      d.parse('\\sin(10^{30}\\pi)').N().toString()
    );
  });

  test('a small angle with a π factor keeps the usual route', () => {
    // `π` degrees is `π²/180` radians, about 0.0548 rad.
    expect(d.parse('\\sin(\\pi)').N().re).toBeCloseTo(
      Math.sin((Math.PI * Math.PI) / 180),
      15
    );
  });
});
