/**
 * Exact values of Gamma, GammaLn, LogGamma, Digamma, PolyGamma, Trigamma and
 * Beta at exact operands: `evaluate()` gives the closed form and `.N()` of the
 * closed form agrees with `.N()` of the call (and with mpmath).
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

type Json = any;

/** `evaluate()` of `json` is not the call itself, and its `.N()` is `value`. */
function expectClosedForm(json: Json, value: number | [number, number]) {
  const call = ce.expr(json);
  const exact = call.evaluate();
  expect(exact.isSame(call)).toBe(false);
  const n = exact.N();
  const [re, im] = Array.isArray(value) ? value : [value, 0];
  expect(n.re).toBeCloseTo(re, 12);
  expect(n.im).toBeCloseTo(im, 12);
  // `.N()` of the call is the same number
  expect(call.N().re).toBeCloseTo(re, 12);
  expect(call.N().im).toBeCloseTo(im, 12);
}

const half = (n: number) => ['Rational', n, 2];

describe('Gamma at a half-integer', () => {
  const cases: [Json, number, string][] = [
    [['Gamma', half(1)], 1.772453850905516, 'sqrt(pi)'],
    [['Gamma', half(5)], 1.329340388179137, '3/4 * sqrt(pi)'],
    [['Gamma', half(-1)], -3.544907701811032, '-2sqrt(pi)'],
    [['Gamma', half(-5)], -0.9453087204829419, '-8/15 * sqrt(pi)'],
  ];
  for (const [json, value, text] of cases) {
    test(`${JSON.stringify(json)} = ${text} (evaluate, N)`, () => {
      expectClosedForm(json, value);
      expect(ce.expr(json).evaluate().toString()).toBe(text);
    });
  }

  test('parse route', () => {
    expect(ce.parse('\\Gamma(\\frac12)').evaluate().toString()).toBe(
      'sqrt(pi)'
    );
  });

  test('a compound argument that reduces to the half-integer', () => {
    expect(
      ce
        .expr(['Gamma', ['Add', half(1), ['Subtract', 'x', 'x']]])
        .evaluate()
        .toString()
    ).toBe('sqrt(pi)');
  });

  test('past the cap the call stays unevaluated', () => {
    const big = ['Rational', 2 * 500 + 1, 2];
    expect(ce.expr(['Gamma', big]).evaluate().operator).toBe('Gamma');
  });

  test('a float stays a float', () => {
    expect(ce.expr(['Gamma', 0.5]).evaluate().isExact).not.toBe(true);
  });
});

describe('GammaLn and LogGamma at an exact argument', () => {
  test('GammaLn(5) = Ln(24)', () => {
    expectClosedForm(['GammaLn', 5], 3.178053830347946);
  });
  test('GammaLn(3/2) = Ln(Sqrt(Pi)/2), LogGamma the same', () => {
    expectClosedForm(['GammaLn', half(3)], -0.12078223763524522);
    expectClosedForm(['LogGamma', half(3)], -0.12078223763524522);
  });
  test('GammaLn(7/2)', () => {
    expectClosedForm(['GammaLn', half(7)], 1.2009736023470743);
  });
  test('GammaLn of a negative half-integer is ln|Γ|, LogGamma the continuous branch', () => {
    // Γ(−3/2) > 0 and Γ(−1/2) < 0
    expectClosedForm(['LogGamma', half(-3)], [0.860047015376481, -2 * Math.PI]);
    expectClosedForm(['GammaLn', half(-3)], [0.860047015376481, 0]);
    expectClosedForm(['LogGamma', half(-1)], [1.2655121234846454, -Math.PI]);
    expectClosedForm(['GammaLn', half(-1)], [1.2655121234846454, 0]);
  });
});

describe('Digamma at a rational with denominator 1, 2, 3 or 4', () => {
  const cases: [Json, number][] = [
    [['Digamma', 5], 1.5061176684318005],
    [['Digamma', half(1)], -1.9635100260214235],
    [['Digamma', half(-1)], 0.03648997397857652],
    [['Digamma', ['Rational', 1, 4]], -4.227453533376265],
    [['Digamma', ['Rational', 3, 4]], -1.0858608797864722],
    [['Digamma', ['Rational', 1, 3]], -3.1320337800208063],
    [['Digamma', ['Rational', 2, 3]], -1.3182344157865885],
    [['Digamma', ['Rational', 11, 4]], 0.8189010249754326],
    [['Digamma', ['Rational', -7, 3]], 2.8603370127848401],
    [['Digamma', ['Rational', -3, 4]], -2.894120200042932],
  ];
  for (const [json, value] of cases)
    test(`${JSON.stringify(json)} (evaluate, N)`, () =>
      expectClosedForm(json, value));

  test('Digamma(1/4) is -EulerGamma - Pi/2 - 3 Ln(2)', () => {
    expect(
      ce
        .expr(['Digamma', ['Rational', 1, 4]])
        .evaluate()
        .isSame(
          ce.expr([
            'Subtract',
            ['Subtract', ['Negate', 'EulerGamma'], ['Divide', 'Pi', 2]],
            ['Multiply', 3, ['Ln', 2]],
          ])
        )
    ).toBe(true);
  });

  test('poles and other denominators are left alone', () => {
    expect(ce.expr(['Digamma', 0]).evaluate().toString()).toBe('~oo');
    expect(ce.expr(['Digamma', ['Rational', 1, 5]]).evaluate().operator).toBe(
      'Digamma'
    );
    expect(ce.expr(['Digamma', 100000]).evaluate().operator).toBe('Digamma');
  });

  test('PolyGamma(0, x) agrees with Digamma(x)', () => {
    expect(
      ce
        .expr(['PolyGamma', 0, ['Rational', 1, 4]])
        .evaluate()
        .isSame(ce.expr(['Digamma', ['Rational', 1, 4]]).evaluate())
    ).toBe(true);
  });

  test('parse route', () => {
    expect(ce.parse('\\psi(5)').evaluate().operator).not.toBe('Digamma');
  });
});

describe('PolyGamma and Trigamma at an exact argument', () => {
  const cases: [Json, number][] = [
    [['PolyGamma', 2, 3], -0.15411380631918857],
    [['PolyGamma', 3, 5], 0.02142782819275507],
    [['PolyGamma', 1, ['Rational', 1, 4]], 17.197329154507111],
    [['PolyGamma', 1, ['Rational', 9, 4]], 0.5573291545071107],
    [['PolyGamma', 1, half(7)], 0.33035775610023486],
    [['PolyGamma', 4, half(1)], -771.4742498266672],
    [['Trigamma', 2], 0.6449340668482264],
    [['Trigamma', ['Rational', 3, 4]], 2.5418796476716065],
  ];
  for (const [json, value] of cases)
    test(`${JSON.stringify(json)} (evaluate, N)`, () =>
      expectClosedForm(json, value));

  test('PolyGamma(2, 3) = 9/4 - 2 Zeta(3)', () => {
    expect(ce.expr(['PolyGamma', 2, 3]).evaluate().toString()).toBe(
      '9/4 - 2Zeta(3)'
    );
  });

  test('PolyGamma(1, 1/4) = Pi^2 + 8 Catalan', () => {
    expect(
      ce
        .expr(['PolyGamma', 1, ['Rational', 1, 4]])
        .evaluate()
        .isSame(
          ce.expr(['Add', ['Square', 'Pi'], ['Multiply', 8, 'CatalanConstant']])
        )
    ).toBe(true);
  });

  test('past the order and shift caps, or at a pole, the call stays', () => {
    expect(ce.expr(['PolyGamma', 41, 3]).evaluate().operator).toBe('PolyGamma');
    expect(ce.expr(['PolyGamma', 2, 1000]).evaluate().operator).toBe(
      'PolyGamma'
    );
    expect(ce.expr(['PolyGamma', 2, 0]).evaluate().toString()).toBe('~oo');
    expect(ce.expr(['PolyGamma', 'n', 3]).evaluate().operator).toBe(
      'PolyGamma'
    );
  });

  test('a closed form whose terms cancel more than 6 digits stays a call', () => {
    // ψ⁽⁴⁰⁾(3) = 40!·(ζ(41) − 1 − 2⁻⁴¹) cancels about 20 digits: .N() of
    // the difference was 9% off at the default precision.
    expect(ce.expr(['PolyGamma', 40, 3]).evaluate().operator).toBe('PolyGamma');
    expect(ce.expr(['PolyGamma', 20, 30]).evaluate().operator).toBe(
      'PolyGamma'
    );
  });

  test('an even zeta value is folded: Trigamma(1) = Pi^2/6', () => {
    expect(
      ce
        .expr(['Trigamma', 1])
        .evaluate()
        .isSame(ce.expr(['Divide', ['Square', 'Pi'], 6]).evaluate())
    ).toBe(true);
  });
});

describe('Beta at two half-integers', () => {
  test('Beta(1/2, 1/2) = Pi', () => {
    expect(
      ce
        .expr(['Beta', half(1), half(1)])
        .evaluate()
        .toString()
    ).toBe('pi');
  });
  test('Beta(3/2, 5/2) = Pi/16', () => {
    expectClosedForm(['Beta', half(3), half(5)], 0.19634954084936207);
  });
  test('an integer and a half-integer is rational (already exact)', () => {
    expectClosedForm(['Beta', half(1), 2], 1.3333333333333333);
  });
});
