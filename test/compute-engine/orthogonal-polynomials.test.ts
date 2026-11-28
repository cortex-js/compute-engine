/**
 * `ChebyshevT`, `ChebyshevU`, `LegendreP`, `HermiteH` and `LaguerreL` of an
 * integer degree: the expanded polynomial of a symbolic x, the exact value
 * of a rational x, the recurrence value of a float x or under `N()`. The
 * compiled values are in `ir-special-functions.test.ts` (JavaScript) and
 * `ir-glsl-special.test.ts` (GLSL).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

const ce = new ComputeEngine();

const evaluate = (json: unknown) => ce.box(json as never).evaluate().toString();
const N = (json: unknown) => ce.box(json as never).N().re;

describe('the polynomial of a symbolic x', () => {
  test.each([
    [['ChebyshevT', 0, 'x'], '1'],
    [['ChebyshevT', 1, 'x'], 'x'],
    [['ChebyshevT', 3, 'x'], '4x^3 - 3x'],
    [['ChebyshevT', 4, 'x'], '8x^4 - 8x^2 + 1'],
    [['ChebyshevU', 2, 'x'], '4x^2 - 1'],
    [['ChebyshevU', 3, 'x'], '8x^3 - 4x'],
    [['LegendreP', 2, 'x'], '3/2 * x^2 - 1/2'],
    [['LegendreP', 3, 'x'], '5/2 * x^3 - 3/2 * x'],
    [['HermiteH', 3, 'x'], '8x^3 - 12x'],
    [['HermiteH', 4, 'x'], '16x^4 - 48x^2 + 12'],
    [['LaguerreL', 2, 'x'], '1/2 * x^2 - 2x + 1'],
    [['LaguerreL', 3, 'x'], '-1/6 * x^3 + 3/2 * x^2 - 3x + 1'],
  ])('%j is %s', (json, expected) => {
    expect(evaluate(json)).toBe(expected);
  });

  test('a negative degree of the Chebyshev and Legendre polynomials', () => {
    // T₋ₙ = Tₙ, U₋₁ = 0, U₋ₙ = −Uₙ₋₂, P₋ₙ = Pₙ₋₁
    expect(evaluate(['ChebyshevT', -3, 'x'])).toBe('4x^3 - 3x');
    expect(evaluate(['ChebyshevU', -1, 'x'])).toBe('0');
    expect(evaluate(['ChebyshevU', -4, 'x'])).toBe('-4x^2 + 1');
    expect(evaluate(['LegendreP', -3, 'x'])).toBe('3/2 * x^2 - 1/2');
  });

  test('a degree with no value, or that is not a literal, stays unevaluated', () => {
    expect(evaluate(['HermiteH', -1, 'x'])).toBe('HermiteH(-1, x)');
    expect(evaluate(['LaguerreL', -2, 0.5])).toBe('LaguerreL(-2, 0.5)');
    expect(evaluate(['ChebyshevT', 'n', 'x'])).toBe('ChebyshevT(n, x)');
  });

  test('a degree that is not an integer stays unevaluated', () => {
    expect(ce.box(['ChebyshevT', 1.5, 'x']).isValid).toBe(true);
    expect(evaluate(['ChebyshevT', 1.5, 'x'])).toBe('ChebyshevT(1.5, x)');
  });

  test('N() of a symbolic x is the polynomial with numeric coefficients', () => {
    expect(ce.box(['LegendreP', 2, 'x']).N().toString()).toBe(
      '1.5 * x^2 - 0.5'
    );
  });
});

describe('the value at a number', () => {
  test('an exact rational x gives an exact value', () => {
    expect(evaluate(['ChebyshevT', 3, ['Rational', 1, 2]])).toBe('-1');
    expect(evaluate(['LegendreP', 3, ['Rational', 1, 3]])).toBe('-11/27');
    expect(evaluate(['LaguerreL', 3, 2])).toBe('-1/3');
    expect(evaluate(['HermiteH', 5, -2])).toBe('16');
    // T₅₀(3/10): a large numerator and denominator, reduced
    const t50 = ce.box(['ChebyshevT', 50, ['Rational', 3, 10]]).evaluate();
    expect(isNumber(t50) && t50.isExact).toBe(true);
  });

  test('another exact number folds', () => {
    expect(evaluate(['ChebyshevT', 2, ['Sqrt', 2]])).toBe('3');
    expect(evaluate(['ChebyshevT', 2, ['Complex', 1, 1]])).toBe('(-1 + 4i)');
    expect(evaluate(['HermiteH', 2, 'Pi'])).toBe('-2 + 4pi^2');
  });

  test('a float x gives the value of the recurrence', () => {
    expect(N(['ChebyshevT', 3, 0.5])).toBe(-1);
    expect(N(['ChebyshevT', 50, 0.3])).toBeCloseTo(
      Math.cos(50 * Math.acos(0.3)),
      13
    );
    // The closed forms at x = 1: Tₙ(1) = 1, Uₙ(1) = n + 1, Pₙ(1) = 1
    expect(N(['ChebyshevT', 101, 1])).toBe(1);
    expect(N(['ChebyshevU', 101, 1])).toBe(102);
    expect(N(['LegendreP', 101, 1])).toBeCloseTo(1, 14);
  });

  test('N() agrees with the exact value', () => {
    for (const op of [
      'ChebyshevT',
      'ChebyshevU',
      'LegendreP',
      'HermiteH',
      'LaguerreL',
    ]) {
      const json = [op, 9, ['Rational', -3, 7]];
      const exact = ce.box(json as never).evaluate();
      expect(N(json)).toBeCloseTo(exact.re, 14);
    }
  });

  test('N() at a higher precision', () => {
    const engine = new ComputeEngine();
    engine.precision = 40;
    const exact = engine
      .box(['LegendreP', 30, ['Rational', 7, 10]])
      .evaluate();
    const approx = engine.box(['LegendreP', 30, 0.7]).N();
    expect(approx.toString().slice(0, 35)).toBe(
      exact.N().toString().slice(0, 35)
    );
  });

  test('a complex x', () => {
    const v = ce.box(['LegendreP', 2, ['Complex', 0.5, 0.25]]).N();
    // (3z² − 1)/2 with z = 0.5 + 0.25i: z² = 0.1875 + 0.25i
    expect(v.re).toBeCloseTo((3 * 0.1875 - 1) / 2, 15);
    expect(v.im).toBeCloseTo((3 * 0.25) / 2, 15);
  });

  test('NaN propagates', () => {
    expect(evaluate(['ChebyshevT', 2, 'NaN'])).toBe('NaN');
  });

  test('a list of x applies to each element', () => {
    expect(evaluate(['ChebyshevT', 3, ['List', 0.5, 1]])).toBe('[-1,1]');
  });
});

describe('LaTeX', () => {
  test('a name in \\operatorname parses and round trips', () => {
    expect(ce.parse('\\operatorname{ChebyshevT}(3, x)').json).toEqual([
      'ChebyshevT',
      3,
      'x',
    ]);
    const latex = ce.box(['LaguerreL', 2, 'x']).latex;
    expect(ce.parse(latex).json).toEqual(['LaguerreL', 2, 'x']);
  });
});
