import { ComputeEngine } from '../../src/compute-engine';

// The statistics operators accept real constants (`π`, `e`, `ln 2`) as data,
// like number literals (user ruling of 2026-09-24). Under `evaluate()` the
// answer is exact; under `.N()` it is a float. The order-based heads order the
// data with `exactOrder`, the order `Max`, `Min` and `Sort` use; a pair that
// `exactOrder` cannot order leaves the head unevaluated.
//
// Every expected value is checked against an independent computation with
// the JavaScript `Math` constants.

const ce = new ComputeEngine();
const L = (...xs: any[]) => ['List', ...xs] as any;

const PI = Math.PI;
const E = Math.E;

function sampleVariance(xs: number[], population = false): number {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return ss / (population ? n : n - 1);
}

function exact(expr: any): string {
  return ce.box(expr).evaluate().toString();
}

function exactThenN(expr: any): number {
  return ce.box(expr).evaluate().N().re;
}

function numeric(expr: any): number {
  return ce.box(expr).N().re;
}

describe('Statistics over real constants', () => {
  test('Median([π, 3, e]) is 3 (e < 3 < π)', () => {
    expect(E < 3 && 3 < PI).toBe(true);
    expect(exact(['Median', L('Pi', 3, 'ExponentialE')])).toBe('3');
    expect(numeric(['Median', L('Pi', 3, 'ExponentialE')])).toBe(3);
  });

  test('Median of an even count is the exact mean of the two middle data', () => {
    const expr = ['Median', L('Pi', 1, 'ExponentialE', 4)];
    expect(exact(expr)).toBe('1/2 * (e + pi)');
    expect(exactThenN(expr)).toBeCloseTo((E + PI) / 2, 14);
    expect(numeric(expr)).toBeCloseTo((E + PI) / 2, 14);
  });

  test('Mean([π, 3]) is (π + 3)/2 under evaluate(), a float under N()', () => {
    const expr = ['Mean', L('Pi', 3)];
    expect(exact(expr)).toBe('1/2 * (3 + pi)');
    expect(exactThenN(expr)).toBeCloseTo((PI + 3) / 2, 14);
    const n = ce.box(expr).N();
    expect(n.isNumberLiteral).toBe(true);
    expect(n.re).toBeCloseTo((PI + 3) / 2, 14);
  });

  test('an inexact datum makes the answer a float under evaluate()', () => {
    const r = ce.box(['Mean', L('Pi', 1.5)]).evaluate();
    expect(r.isNumberLiteral).toBe(true);
    expect(r.re).toBeCloseTo((PI + 1.5) / 2, 14);
  });

  test('Variance and StandardDeviation are exact and agree with N()', () => {
    const xs = [PI, 3, E];
    const data = L('Pi', 3, 'ExponentialE');
    const cases: [string, number][] = [
      ['Variance', sampleVariance(xs)],
      ['PopulationVariance', sampleVariance(xs, true)],
      ['StandardDeviation', Math.sqrt(sampleVariance(xs))],
      ['PopulationStandardDeviation', Math.sqrt(sampleVariance(xs, true))],
    ];
    for (const [head, expected] of cases) {
      const r = ce.box([head, data]).evaluate();
      // Exact: the answer is not a float literal.
      expect(r.isNumberLiteral).toBe(false);
      expect(r.N().re).toBeCloseTo(expected, 14);
      expect(numeric([head, data])).toBeCloseTo(expected, 14);
    }
  });

  test('Quartiles and InterquartileRange order the constants exactly', () => {
    // Sorted: 1 < e < 3 < π. Q1 = (1 + e)/2, Q2 = (e + 3)/2, Q3 = (3 + π)/2.
    const data = L('Pi', 3, 'ExponentialE', 1);
    expect(exact(['Quartiles', data])).toBe(
      '(1/2 * (1 + e), 1/2 * (3 + e), 1/2 * (3 + pi))'
    );
    const q = ce.box(['Quartiles', data]).N();
    expect(q.ops!.map((x) => x.re)).toEqual([
      expect.closeTo((1 + E) / 2, 14),
      expect.closeTo((E + 3) / 2, 14),
      expect.closeTo((3 + PI) / 2, 14),
    ]);
    const iqr = (3 + PI) / 2 - (1 + E) / 2;
    expect(exactThenN(['InterquartileRange', data])).toBeCloseTo(iqr, 14);
    expect(numeric(['InterquartileRange', data])).toBeCloseTo(iqr, 14);
  });

  test('Mode counts two spellings of one constant as one value', () => {
    expect(exact(['Mode', L('Pi', 3, 'Pi')])).toBe('pi');
    // ln 6 = ln 2 + ln 3: a symbolic proof makes them equal.
    expect(
      exact(['Mode', L(['Ln', 6], ['Add', ['Ln', 2], ['Ln', 3]], 1)])
    ).toBe('ln(6)');
    // All distinct: the smallest value wins the tie (1 < e < π).
    expect(exact(['Mode', L('Pi', 1, 'ExponentialE')])).toBe('1');
  });

  test('Mode under N() breaks a tie as evaluate() does: the smallest value', () => {
    // All distinct: e < 3 < π, so e wins, as under evaluate().
    expect(exact(['Mode', L('Pi', 3, 'ExponentialE')])).toBe('e');
    expect(numeric(['Mode', L('Pi', 3, 'ExponentialE')])).toBeCloseTo(E, 15);
    // Decimal and integer data use the same tie rule.
    expect(ce.parse('\\operatorname{Mode}([3.5, 2.5, 1.5])').N().re).toBe(1.5);
    expect(ce.parse('\\operatorname{Mode}([3, 2, 1])').N().re).toBe(1);
    expect(ce.parse('\\operatorname{Mode}([1, 2, 2, 3])').N().re).toBe(2);
  });

  test('Mode under N() counts two spellings of one constant as one value', () => {
    // ln 6 and ln 2 + ln 3 are computed by different operations and differ
    // in the last digit at the working precision; they still count together.
    expect(
      numeric(['Mode', L(['Ln', 6], ['Add', ['Ln', 2], ['Ln', 3]], 1)])
    ).toBeCloseTo(Math.log(6), 15);
  });

  test('Max and Min agree with the order the statistics use', () => {
    const data = L('Pi', 3, 'ExponentialE');
    expect(exact(['Max', data])).toBe('pi');
    expect(exact(['Min', data])).toBe('e');
    expect(exact(['Median', data])).toBe('3');
  });

  test('Skewness and Kurtosis are exact and agree with N()', () => {
    const xs = [PI, 3, E];
    const n = xs.length;
    const m = xs.reduce((a, b) => a + b, 0) / n;
    const mk = (k: number) => xs.reduce((a, x) => a + (x - m) ** k, 0) / n;
    const skew = mk(3) / mk(2) ** 1.5;
    const kurt = mk(4) / mk(2) ** 2;
    const data = L('Pi', 3, 'ExponentialE');
    expect(exactThenN(['Skewness', data])).toBeCloseTo(skew, 12);
    expect(exactThenN(['Kurtosis', data])).toBeCloseTo(kurt, 12);
  });

  test('a real constant beside complex data: Mean and Variance', () => {
    const data = L('Pi', ['Complex', 1, 2]);
    expect(exact(['Mean', data])).toBe('1/2 * ((1 + 2i) + pi)');
    // Sample variance of complex data: Σ|x − μ|² / (n − 1).
    // μ = ((π + 1) + 2i)/2; |π − μ|² = |1 + 2i − μ|² = ((π − 1)/2)² + 1.
    const expected = 2 * (((PI - 1) / 2) ** 2 + 1);
    expect(exactThenN(['Variance', data])).toBeCloseTo(expected, 14);
    expect(numeric(['Variance', data])).toBeCloseTo(expected, 14);
  });

  test('a pair that exactOrder cannot order leaves the head unevaluated', () => {
    // arctan(1/2) = π/4 − arctan(1/3) (Machin-like identity), which neither a
    // symbolic proof nor a higher precision decides.
    expect(Math.atan(1 / 2)).toBeCloseTo(PI / 4 - Math.atan(1 / 3), 15);
    const data = L(
      ['Arctan', ['Rational', 1, 2]],
      ['Subtract', ['Divide', 'Pi', 4], ['Arctan', ['Rational', 1, 3]]],
      0
    );
    expect(ce.box(['Median', data]).evaluate().operator).toBe('Median');
    expect(ce.box(['Quartiles', data]).evaluate().operator).toBe('Quartiles');
  });

  test('what is not a real constant keeps its previous behavior', () => {
    // A free symbol: inert.
    expect(exact(['Mean', L('Pi', 'x')])).toBe('Mean([pi,x])');
    // A constant with a complex value (√-2) is not a real constant: inert
    // under evaluate(), numeric under N().
    expect(exact(['Mean', L('Pi', ['Sqrt', -2])])).toBe('Mean([pi,sqrt(-2)])');
    // Infinite and absent data keep their answers.
    expect(exact(['Mean', L('Pi', 'PositiveInfinity')])).toBe('+oo');
    expect(exact(['Median', L('Pi', 'NaN')])).toBe('NaN');
  });
});
