import { engine as ce } from '../utils';

/**
 * Radical-arithmetic improvements (Wester B13 cluster, round 1).
 *
 * 1. Rational-radicand perfect-power extraction: root of an exact rational
 *    factors numerator and denominator independently.
 * 2. Exactness-contract leak in `toNumericValue` for `Root`: an exact
 *    non-perfect-power radicand no longer floats its coefficient.
 */

describe('rational-radicand perfect-power extraction', () => {
  test('(1029/1000)^(1/3) -> (7/10)·3^(1/3)  (1029 = 3·7³, 1000 = 10³)', () => {
    const e = ce.box(['Power', ['Rational', 1029, 1000], ['Rational', 1, 3]]);
    // 3^(1/3) canonicalizes to Root(3,3)
    expect(e.json).toEqual([
      'Multiply',
      ['Rational', 7, 10],
      ['Root', 3, 3],
    ]);
  });

  test('10/7·(1029/1000)^(1/3) simplifies to 3^(1/3) (Root(3,3))', () => {
    const e = ce.box([
      'Multiply',
      ['Rational', 10, 7],
      ['Power', ['Rational', 1029, 1000], ['Rational', 1, 3]],
    ]);
    expect(e.simplify().json).toEqual(['Root', 3, 3]);
    // numeric sanity: value is unchanged and equals 3^(1/3)
    expect(e.N().re).toBeCloseTo(Math.cbrt(3), 12);
  });

  test('extraction preserves value at high precision', () => {
    const e = ce.box(['Power', ['Rational', 1029, 1000], ['Rational', 1, 3]]);
    // (7/10)·3^(1/3)
    expect(e.N().re).toBeCloseTo(0.7 * Math.cbrt(3), 12);
    expect(e.N().re).toBeCloseTo(Math.cbrt(1029 / 1000), 12);
  });

  test('numerator-only extraction: (24/54)^(1/3) reduces the fraction, no extraction', () => {
    // 24/54 = 4/9, and 4/9 has no cube factor -> stays a Root
    const e = ce.box(['Power', ['Rational', 24, 54], ['Rational', 1, 3]]);
    expect(e.json).toEqual(['Root', ['Rational', 4, 9], 3]);
    expect(e.N().re).toBeCloseTo(Math.cbrt(24 / 54), 12);
  });

  test('denominator perfect power: (5/8)^(1/3) -> (1/2)·5^(1/3)', () => {
    // 8 = 2³ so the whole denominator extracts
    const e = ce.box(['Power', ['Rational', 5, 8], ['Rational', 1, 3]]);
    expect(e.json).toEqual(['Multiply', ['Rational', 1, 2], ['Root', 5, 3]]);
    expect(e.N().re).toBeCloseTo(Math.cbrt(5 / 8), 12);
  });

  test('integer perfect power still reduces under evaluate: 8^(1/3) -> 2', () => {
    // Integer radicands (unlike rationals) stay symbolic at canonicalization
    // and reduce under evaluate(), a pre-existing convention this preserves.
    expect(ce.box(['Power', 8, ['Rational', 1, 3]]).json).toEqual(['Root', 8, 3]);
    expect(ce.box(['Power', 8, ['Rational', 1, 3]]).evaluate().json).toBe(2);
    expect(ce.box(['Power', 64, ['Rational', 1, 6]]).evaluate().json).toBe(2);
  });

  test('integer-radicand regression: root6(997³) -> √997', () => {
    expect(ce.parse('(997^3)^{\\frac16}').evaluate().json).toEqual([
      'Sqrt',
      997,
    ]);
    expect(ce.parse('\\sqrt{997} - (997^3)^{\\frac16}').simplify().json).toBe(0);
  });

  test('square-root regressions unchanged: (4/9)^(1/2) -> 2/3, 50^(1/2) -> 5√2', () => {
    expect(ce.box(['Power', ['Rational', 4, 9], ['Rational', 1, 2]]).json).toEqual(
      ['Rational', 2, 3]
    );
    expect(ce.box(['Power', 50, ['Rational', 1, 2]]).json).toEqual([
      'Multiply',
      5,
      ['Sqrt', 2],
    ]);
  });

  test('non-extractable rational radicand stays put: (1/2)^(1/3)', () => {
    const e = ce.box(['Power', ['Rational', 1, 2], ['Rational', 1, 3]]);
    expect(e.json).toEqual(['Root', ['Rational', 1, 2], 3]);
    expect(e.evaluate().json).toEqual(['Root', ['Rational', 1, 2], 3]);
    expect(e.N().re).toBeCloseTo(Math.cbrt(0.5), 12);
  });

  test('float radicand still numericizes', () => {
    const e = ce.box(['Power', 1.5, ['Rational', 1, 3]]);
    const v = e.evaluate();
    expect(v.re).toBeCloseTo(Math.cbrt(1.5), 12);
    // it is a float, not a symbolic Root
    expect(typeof v.re).toBe('number');
    expect(Array.isArray(v.json)).toBe(false);
  });
});

describe('exactness-contract leak in toNumericValue(Root)', () => {
  test('Root(2,3) does not float its coefficient', () => {
    const [coef, rest] = ce.box(['Root', 2, 3]).toNumericValue();
    expect(coef.isExact).toBe(true);
    expect(coef.toString()).toBe('1');
    expect(rest.json).toEqual(['Root', 2, 3]);
  });

  test('Root(24,3) does not leak a float coefficient', () => {
    // 24 = 8·3; a NumericValue cannot hold 2·∛3 exactly, so rather than
    // float the coefficient (the old leak: 2.884…·Root(1,3)) the whole
    // radical stays symbolic and exact.
    const [coef, rest] = ce.box(['Root', 24, 3]).toNumericValue();
    expect(coef.isExact).toBe(true);
    expect(coef.toString()).toBe('1');
    expect(rest.json).toEqual(['Root', 24, 3]);
  });

  test('Root(4,3) does not leak a float coefficient', () => {
    const [coef, rest] = ce.box(['Root', 4, 3]).toNumericValue();
    expect(coef.isExact).toBe(true);
    expect(coef.toString()).toBe('1');
    expect(rest.json).toEqual(['Root', 4, 3]);
  });

  test('Root(8,3) extracts to an exact coefficient (perfect cube)', () => {
    const [coef, rest] = ce.box(['Root', 8, 3]).toNumericValue();
    expect(coef.isExact).toBe(true);
    expect(coef.toString()).toBe('2');
    // remainder is numerically 1 (Root(1,3))
    expect(rest.N().re).toBeCloseTo(1, 12);
  });

  test('sum of cube roots evaluates without a float residue', () => {
    // Root(2,3) + Root(4,3): previously leaked 1.2599…·Root(1,3)
    const e = ce.box(['Add', ['Root', 2, 3], ['Power', 2, ['Rational', 2, 3]]]);
    const v = e.evaluate();
    // no machine-float number literals anywhere in the tree
    const s = JSON.stringify(v.json);
    expect(s).not.toMatch(/"num"/);
    expect(v.N().re).toBeCloseTo(Math.cbrt(2) + Math.pow(2, 2 / 3), 12);
  });

  test('Wester 28 residue: (2^(1/3)+4^(1/3))^3 - 6(...) - 6 leaves no float', () => {
    const e = ce.parse(
      '(2^{\\frac13} + 4^{\\frac13})^3 - 6(2^{\\frac13} + 4^{\\frac13}) - 6'
    );
    const v = e.evaluate();
    const s = JSON.stringify(v.json);
    // the exactness leak (a ~1e-20 float residue / float coefficients) is gone
    expect(s).not.toMatch(/"num"/);
    // value is (numerically) zero
    expect(Math.abs(e.N().re)).toBeLessThan(1e-12);
  });
});

/**
 * Rationalizing a two-term radical denominator in simplify()
 * (num / (p + q) -> num·(p − q) / (p² − q²)), next to `denestSqrt` in
 * `symbolic/simplify-power.ts`.
 */
describe('rationalize radical denominator', () => {
  test('(√3+√2)/(√3−√2) -> 5 + 2√6', () => {
    const e = ce.parse('\\frac{\\sqrt{3}+\\sqrt{2}}{\\sqrt{3}-\\sqrt{2}}');
    expect(e.simplify().json).toEqual(['Add', 5, ['Multiply', 2, ['Sqrt', 6]]]);
    // old (unrationalized) and new forms agree numerically
    expect(e.N().re).toBeCloseTo(e.simplify().N().re, 12);
  });

  test('1/(1+√2) -> √2 − 1', () => {
    const e = ce.parse('\\frac{1}{1+\\sqrt2}');
    const s = e.simplify();
    expect(s.isEqual(ce.parse('\\sqrt2-1'))).toBe(true);
    expect(Math.abs(e.N().re - s.N().re)).toBeLessThan(1e-12);
  });

  test('1/(√5−√3) -> (√5+√3)/2 (two-surd denominator)', () => {
    const e = ce.parse('\\frac{1}{\\sqrt5-\\sqrt3}');
    const s = e.simplify();
    expect(s.isEqual(ce.parse('\\frac{\\sqrt5+\\sqrt3}{2}'))).toBe(true);
    expect(Math.abs(e.N().re - s.N().re)).toBeLessThan(1e-12);
  });

  test('1/(1+2^{1/3}) declines (cube-root denominator stays put)', () => {
    const e = ce.parse('\\frac{1}{1+2^{1/3}}');
    // Not a two-term sum of exact-real (√) terms: no rationalization.
    expect(e.simplify().json).toEqual([
      'Divide',
      1,
      ['Add', 1, ['Root', 2, 3]],
    ]);
  });
});

/**
 * Same-base combination of Root(b,n) and Power(b,p/q) for a positive rational
 * base (arithmetic-mul-div.ts): 2^{1/3}·2^{2/3} -> 2^1 -> 2, exactly.
 */
describe('same-base numeric radical combination', () => {
  test('2^{1/3}·2^{2/3} -> 2 (Root × Power, same base)', () => {
    expect(ce.parse('2^{1/3}\\cdot 2^{2/3}').evaluate().json).toBe(2);
  });

  test('2^{1/3}·4^{1/3} -> 2 (same-exponent fusion, 8^{1/3})', () => {
    expect(ce.parse('2^{1/3}\\cdot 4^{1/3}').evaluate().json).toBe(2);
  });

  test('3^{1/4}·3^{1/4} -> √3', () => {
    expect(ce.parse('3^{1/4}\\cdot 3^{1/4}').evaluate().json).toEqual([
      'Sqrt',
      3,
    ]);
  });

  test('a lone numeric radical stays symbolic and exact', () => {
    expect(ce.parse('2^{1/3}').evaluate().json).toEqual(['Root', 2, 3]);
    expect(ce.parse('2^{2/3}').evaluate().json).toEqual([
      'Power',
      2,
      ['Rational', 2, 3],
    ]);
  });
});

/**
 * Three-surd nested-radical denesting (denestSqrt3, next to denestSqrt):
 * √(a + 2√p + 2√q + 2√r) -> √x + √y + √z.
 */
describe('three-surd sqrt denesting', () => {
  test('√(10+2√6+2√10+2√15) -> √2+√3+√5', () => {
    expect(
      ce.parse('\\sqrt{10+2\\sqrt6+2\\sqrt{10}+2\\sqrt{15}}').simplify().json
    ).toEqual(['Add', ['Sqrt', 2], ['Sqrt', 3], ['Sqrt', 5]]);
  });

  test('√(6+2√2+2√3+2√6) -> 1+√2+√3 (perfect-square unknown)', () => {
    const e = ce.parse('\\sqrt{6+2\\sqrt2+2\\sqrt3+2\\sqrt6}');
    const s = e.simplify();
    expect(s.isEqual(ce.parse('1+\\sqrt2+\\sqrt3'))).toBe(true);
    expect(Math.abs(e.N().re - s.N().re)).toBeLessThan(1e-12);
  });

  test('declines when the rational part does not match x+y+z', () => {
    // 9 ≠ 2+3+5: not a perfect (√x+√y+√z)² — stays put.
    const e = ce.parse('\\sqrt{9+2\\sqrt6+2\\sqrt{10}+2\\sqrt{15}}');
    expect(e.simplify().operator).toBe('Sqrt');
  });
});

/**
 * Regression: `ComputeEngine._numericValue` used to throw
 * `Unexpected value for radical part` when a numeric evaluation path landed on
 * an exact radical whose radicand was non-integer, or an integer at/above
 * SMALL_INTEGER (1_000_000). Such values arise, e.g., when the Rubi
 * antiderivative D-check substitutes random parameters and a `√(large)` appears
 * during `.N()`. The throw was caught at every Rubi call site (→ decline),
 * making D-verified closures seed-fragile. `_numericValue` now extracts any
 * perfect-square factor and either stays exact (square-free part below
 * SMALL_INTEGER) or falls back to the float lane, instead of throwing.
 */
describe('_numericValue with a large / non-integer radical (does not throw)', () => {
  const nv = (data: { radical: number; rational?: [number, number] }) =>
    (ce as any)._numericValue(data);

  test('perfect square at/above SMALL_INTEGER reduces to an exact integer', () => {
    // √2_250_000 = √(1500²) = 1500
    const r = ce.number(nv({ radical: 2_250_000 }));
    expect(r.isSame(1500)).toBe(true);
    expect(r.isInteger).toBe(true);
  });

  test('square factor above SMALL_INTEGER stays exact (k·√r)', () => {
    // √4_500_000 = √(1500²·2) = 1500·√2 — exact, square-free part 2
    const r = ce.number(nv({ radical: 4_500_000 }));
    expect(r.isNumberLiteral).toBe(true);
    // Exact (not a float): serializes with a symbolic radical.
    expect(r.toString()).toBe('1500sqrt(2)');
    expect(r.N().re).toBeCloseTo(1500 * Math.sqrt(2), 9);
  });

  test('huge square-free radicand falls back to a float', () => {
    // √1_500_001: square-free radicand ≥ SMALL_INTEGER — not exactly
    // representable, so return the numeric value.
    const r = ce.number(nv({ radical: 1_500_001 }));
    expect(r.re).toBeCloseTo(Math.sqrt(1_500_001), 9);
  });

  test('non-integer radical falls back to a float', () => {
    const r = ce.number(nv({ radical: 2.5 }));
    expect(r.re).toBeCloseTo(Math.sqrt(2.5), 12);
  });

  test('rational coefficient is preserved through the reduction', () => {
    // (1/3)·√4_500_000 = (1/3)·1500·√2 = 500·√2
    const r = ce.number(nv({ radical: 4_500_000, rational: [1, 3] }));
    expect(r.N().re).toBeCloseTo((1500 / 3) * Math.sqrt(2), 9);
  });

  // Public-API path that reaches the same branch: √a·√b folds through
  // `_numericValue({ radical: a·b })`. With a·b ≥ SMALL_INTEGER and a
  // square-free product, the old code threw during canonicalization.
  test('Multiply[√1234, √1235] canonicalizes to the correct float', () => {
    const e = ce.box(['Multiply', ['Sqrt', 1234], ['Sqrt', 1235]]);
    expect(e.N().re).toBeCloseTo(Math.sqrt(1234 * 1235), 6);
  });
});
