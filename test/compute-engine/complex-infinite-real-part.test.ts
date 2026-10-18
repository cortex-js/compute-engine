import { Complex } from 'complex.js';
import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

/**
 * A complex value with an infinite real part and a finite imaginary part
 * (`∞ + i`) is boxed as the real infinity of the sign of its real part
 * (user decision 2026-10-18). Its argument tends to `0` (or `π`) as the real
 * part grows, so it has the direction of the real axis. Before, such a value
 * kept its `Complex` spelling: it reported `isFinite === true`, `0 · (∞ + i)`
 * was `0` and `2 · (∞ + i)` was `NaN`.
 *
 * A complex value with an infinite IMAGINARY part is complex infinity
 * (`~oo`), whatever its real part, as `Add` and `Multiply` already give.
 */

describe('A COMPLEX VALUE WITH AN INFINITE REAL PART AND A FINITE IMAGINARY PART', () => {
  const ce = new ComputeEngine();
  const POS = 'PositiveInfinity';
  const NEG = 'NegativeInfinity';

  test('every number producer gives the real infinity', () => {
    // The MathJSON `Complex` constructor, on the box route
    expect(ce.box(['Complex', POS, 1]).json).toBe(POS);
    expect(ce.box(['Complex', NEG, 1]).json).toBe(NEG);
    expect(ce.box(['Complex', { num: '+Infinity' }, 2.5]).json).toBe(POS);
    // A high-precision imaginary part (the bignum numeric value)
    expect(
      ce.box(['Complex', POS, { num: '1.00000000000000000000000001' }]).json
    ).toBe(POS);
    // A host complex, and a `{re, im}` object
    expect(ce.number(new Complex(Infinity, 1)).json).toBe(POS);
    expect(ce.number(new Complex(-Infinity, -3)).json).toBe(NEG);
    expect(ce.number({ re: Infinity, im: 1 }).json).toBe(POS);
    expect(ce.number(ce._numericValue({ re: -Infinity, im: 4 })).json).toBe(
      NEG
    );
    // The shared instance, so `isSame` and identity agree
    expect(ce.number(new Complex(Infinity, 1))).toBe(ce.PositiveInfinity);
  });

  test('the machine-precision lane gives the real infinity too', () => {
    const saved = BigDecimal.precision;
    const ceMachine = new ComputeEngine();
    ceMachine.precision = 'machine';
    try {
      expect(ceMachine.box(['Complex', POS, 1]).json).toBe(POS);
      expect(ceMachine.number(new Complex(-Infinity, 1)).json).toBe(NEG);
    } finally {
      BigDecimal.precision = saved;
    }
  });

  test('the value is infinite, so arithmetic follows the rules of ±∞', () => {
    const z = ce.box(['Complex', POS, 1]);
    expect(z.isFinite).toBe(false);
    expect(z.isInfinity).toBe(true);
    expect(z.type.toString()).toBe('+oo');
    // `0 · ∞` is the indeterminate form (it was `0`)
    expect(ce.box(['Multiply', 0, ['Complex', POS, 1]]).evaluate().json).toBe(
      'Indeterminate'
    );
    // `2 · ∞ = ∞` (it was `NaN`)
    expect(ce.box(['Multiply', 2, ['Complex', POS, 1]]).evaluate().json).toBe(
      POS
    );
    expect(
      ce.box(['Multiply', -2, ['Complex', POS, 1]]).evaluate().json
    ).toBe(NEG);
    // `Add` already gave `+∞` for `∞ + i`
    expect(ce.box(['Add', POS, 'ImaginaryUnit']).evaluate().json).toBe(POS);
  });

  test('an infinite imaginary part is complex infinity', () => {
    for (const [re, im] of [
      [1, POS],
      [0, POS],
      [POS, POS],
      [NEG, NEG],
    ])
      expect(ce.box(['Complex', re, im]).json).toBe('ComplexInfinity');
    expect(ce.number(new Complex(1, Infinity)).json).toBe('ComplexInfinity');
    expect(ce.number(new Complex(Infinity, -Infinity)).json).toBe(
      'ComplexInfinity'
    );
    expect(
      ce.box(['Add', 1, ['Multiply', POS, 'ImaginaryUnit']]).evaluate().json
    ).toBe('ComplexInfinity');
    expect(
      ce.box(['Multiply', 2, ['Complex', 1, POS]]).evaluate().json
    ).toBe('ComplexInfinity');
  });

  test('a NaN part is NaN', () => {
    expect(ce.number(new Complex(Infinity, NaN)).isNaN).toBe(true);
    expect(ce.number(new Complex(NaN, 1)).isNaN).toBe(true);
  });

  test('a finite real part beyond the double range is not infinite', () => {
    // `10^800 + i` is a finite value: its double projection is `Infinity`,
    // but its big decimal is finite.
    const z = ce.box(['Complex', ['Power', 10, 800], 1]).evaluate();
    expect(z.isFinite).not.toBe(false);
    expect(z.json).not.toBe(POS);
  });
});

describe('LIMITS THAT TEND TO ∞ + iθ ARE THE REAL INFINITY', () => {
  const ce = new ComputeEngine();
  const NEG = 'NegativeInfinity';
  const POS = 'PositiveInfinity';

  // Each of these values has a real part that grows without bound and an
  // imaginary part that tends to a finite multiple of π (measured below), so
  // the limit is `+∞` on `evaluate()`, on `.N()` and on `simplify()`.
  test.each([
    [['Arcosh', NEG], POS],
    [['Ln', NEG], POS],
    [['Log', NEG, 10], POS],
    [['Log', NEG, ['Rational', 1, 2]], NEG],
    [['LambertW', NEG], POS],
    [['LambertW', POS, 1], POS],
    [['LambertW', NEG, -1], POS],
    [['CoshIntegral', NEG], POS],
  ])('%j is %s', (expr, expected) => {
    expect(ce.box(expr as any).evaluate().json).toBe(expected);
    expect(ce.box(expr as any).N().json).toBe(expected);
    expect(ce.box(expr as any).simplify().json).toBe(expected);
  });

  test('the parse route agrees', () => {
    expect(ce.parse('\\operatorname{arcosh}(-\\infty)').evaluate().json).toBe(
      POS
    );
    expect(ce.parse('\\ln(-\\infty)').evaluate().json).toBe(POS);
    expect(ce.parse('\\log_{10}(-\\infty)').N().json).toBe(POS);
  });

  test('the finite values tend to an infinite real part and a bounded imaginary part', () => {
    for (const [expr, im] of [
      [['Arcosh', -1e100], Math.PI],
      [['Ln', -1e100], Math.PI],
      [['LambertW', -1e100], Math.PI],
      [['LambertW', 1e100, 1], 2 * Math.PI],
      [['LambertW', -1e100, -1], -Math.PI],
      [['CoshIntegral', -50], Math.PI],
    ] as const) {
      const v = ce.box(expr as any).N();
      expect(v.re).toBeGreaterThan(200);
      expect(Math.abs(v.im - im)).toBeLessThan(0.05);
    }
  });

  test('a complex base leaves no real direction', () => {
    // `ln(−∞) / ln(−2)` = `+∞ / (ln 2 + iπ)`: both parts are infinite.
    expect(ce.box(['Log', NEG, -2]).evaluate().json).toBe('ComplexInfinity');
  });
});
