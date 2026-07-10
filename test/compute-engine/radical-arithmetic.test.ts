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
