/**
 * Error propagation of a `Measurement(nominal, error)` operand through the
 * numeric operators that did not handle one. Each operator was applied to
 * `Measurement(0.7468, 0.001)` under `.N()` and the result compared with the
 * same operator on the bare nominal.
 *
 * The rules:
 * - a differentiable unary function propagates `|f′(a)|·σ`, with the
 *   derivative from the engine's derivative table, in the engine's angular
 *   unit (`measurementUnaryByHead`);
 * - a comparison decides by the nominal (`Less(M, 1)` is `True`);
 * - a step function (`Floor`, `Ceil`, `Round`, `Mod`) answers the bare value
 *   of the nominal: its slope is zero almost everywhere;
 * - the statistics propagate through their gradient; `Median` orders by the
 *   nominal and returns the middle datum.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/types';

const ce = new ComputeEngine();
ce.precision = 'machine';

const A = 0.7468;
const S = 0.001;
const M = ['Measurement', A, S];

function nominal(e: Expression): number {
  return e.operator === 'Measurement' ? (e.op1.re ?? NaN) : (e.re ?? NaN);
}
function error(e: Expression): number {
  return e.operator === 'Measurement' ? (e.op2.re ?? NaN) : 0;
}

/** `head(M).N()` is a Measurement with nominal `f(A)` and error `|f′(A)|·S`. */
function expectPropagation(
  head: string,
  f: (a: number) => number,
  fPrime: (a: number) => number
): void {
  const r = ce.box([head, M]).N();
  expect(r.operator).toBe('Measurement');
  expect(nominal(r)).toBeCloseTo(f(A), 12);
  expect(error(r)).toBeCloseTo(Math.abs(fPrime(A)) * S, 12);
}

describe('Measurement — propagation through the circular functions', () => {
  test('Cot, Sec and Csc no longer read the measurement as 0', () => {
    expectPropagation('Cot', (a) => 1 / Math.tan(a), (a) => -1 / Math.sin(a) ** 2);
    expectPropagation('Sec', (a) => 1 / Math.cos(a), (a) => Math.tan(a) / Math.cos(a));
    expectPropagation('Csc', (a) => 1 / Math.sin(a), (a) => -Math.cos(a) / Math.sin(a) ** 2);
  });

  test('Sin, Cos and Tan propagate as before', () => {
    expectPropagation('Sin', Math.sin, Math.cos);
    expectPropagation('Cos', Math.cos, (a) => -Math.sin(a));
    expectPropagation('Tan', Math.tan, (a) => 1 / Math.cos(a) ** 2);
  });

  test('the inverse functions propagate', () => {
    expectPropagation('Arcsin', Math.asin, (a) => 1 / Math.sqrt(1 - a * a));
    expectPropagation('Arccos', Math.acos, (a) => -1 / Math.sqrt(1 - a * a));
    expectPropagation('Arctan', Math.atan, (a) => 1 / (1 + a * a));
  });

  test('Arctan2 propagates through both operands', () => {
    const r = ce.box(['Arctan2', M, 1]).N();
    expect(nominal(r)).toBeCloseTo(Math.atan2(A, 1), 12);
    expect(error(r)).toBeCloseTo(S / (1 + A * A), 12);
    const both = ce.box(['Arctan2', M, ['Measurement', 1, 0.01]]).N();
    const r2 = 1 + A * A;
    expect(error(both)).toBeCloseTo(Math.sqrt((1 * S) ** 2 + (A * 0.01) ** 2) / r2, 12);
    // Neither operand a measurement: the ordinary value.
    expect(ce.box(['Arctan2', 1, 1]).N().json).toBeCloseTo(Math.PI / 4, 12);
  });

  test('an argument where the slope is infinite leaves the call unevaluated (decision 4)', () => {
    // arcsin has an infinite slope at 1: no first-order uncertainty.
    const r = ce.box(['Arcsin', ['Measurement', 1, 0.01]]).N();
    expect(r.operator).toBe('Arcsin');
    expect(r.op1.operator).toBe('Measurement');
  });

  test('exact input keeps an exact nominal and error under evaluate()', () => {
    const r = ce
      .box(['Arcsin', ['Measurement', ['Rational', 1, 2], ['Rational', 1, 100]]])
      .evaluate();
    expect(r.operator).toBe('Measurement');
    expect(r.op1.json).toEqual(['Multiply', ['Rational', 1, 6], 'Pi']);
    // σ = (1/100) / √(1 − 1/4) = (1/100)·(2/√3) = √3/150
    expect(r.op2.json).toEqual(['Divide', ['Sqrt', 3], 150]);
  });

  test('the derivative is taken in the angular unit of the engine', () => {
    const deg = new ComputeEngine();
    deg.precision = 'machine';
    deg.angularUnit = 'deg';
    const k = Math.PI / 180;
    const sin = deg.box(['Sin', ['Measurement', 30, 1]]).N();
    expect(nominal(sin)).toBeCloseTo(0.5, 12);
    expect(error(sin)).toBeCloseTo(Math.cos(30 * k) * k, 12);
    // An inverse function returns degrees: its derivative is divided by k.
    const atan = deg.box(['Arctan', ['Measurement', 1, 0.01]]).N();
    expect(nominal(atan)).toBeCloseTo(45, 12);
    expect(error(atan)).toBeCloseTo(0.01 / 2 / k, 12);
    const atan2 = deg.box(['Arctan2', ['Measurement', 1, 0.01], 1]).N();
    expect(error(atan2)).toBeCloseTo(0.01 / 2 / k, 12);
  });
});

describe('Measurement — propagation through the hyperbolic functions', () => {
  test('direct functions', () => {
    expectPropagation('Sinh', Math.sinh, Math.cosh);
    expectPropagation('Cosh', Math.cosh, Math.sinh);
    expectPropagation('Tanh', Math.tanh, (a) => 1 / Math.cosh(a) ** 2);
  });
  test('inverse functions', () => {
    expectPropagation('Arsinh', Math.asinh, (a) => 1 / Math.sqrt(a * a + 1));
    expectPropagation('Artanh', Math.atanh, (a) => 1 / (1 - a * a));
  });
});

describe('Measurement — propagation through the special functions', () => {
  test('Gamma: Γ(a) ± |Γ(a)ψ(a)|σ', () => {
    const r = ce.box(['Gamma', M]).N();
    const gamma = ce.box(['Gamma', A]).N().re;
    const digamma = ce.box(['Digamma', A]).N().re;
    expect(nominal(r)).toBeCloseTo(gamma, 12);
    expect(error(r)).toBeCloseTo(Math.abs(gamma * digamma) * S, 12);
  });

  test('LogGamma: lnΓ(a) ± |ψ(a)|σ', () => {
    const r = ce.box(['LogGamma', M]).N();
    const digamma = ce.box(['Digamma', A]).N().re;
    expect(nominal(r)).toBeCloseTo(ce.box(['LogGamma', A]).N().re, 12);
    expect(error(r)).toBeCloseTo(Math.abs(digamma) * S, 12);
  });

  test('Erf and Erfc: ±(2/√π)e^(−a²)σ', () => {
    const slope = (2 / Math.sqrt(Math.PI)) * Math.exp(-A * A);
    const erf = ce.box(['Erf', M]).N();
    expect(nominal(erf)).toBeCloseTo(ce.box(['Erf', A]).N().re, 12);
    expect(error(erf)).toBeCloseTo(slope * S, 12);
    const erfc = ce.box(['Erfc', M]).N();
    expect(nominal(erfc)).toBeCloseTo(1 - nominal(erf), 12);
    expect(error(erfc)).toBeCloseTo(slope * S, 12);
  });

  test('Factorial: (a ± σ)! is Γ(a + 1) with the uncertainty propagated', () => {
    const r = ce.box(['Factorial', ['Measurement', 4, 0.1]]).N();
    expect(nominal(r)).toBeCloseTo(24, 12);
    const digamma5 = ce.box(['Digamma', 5]).N().re;
    expect(error(r)).toBeCloseTo(24 * digamma5 * 0.1, 10);
  });
});

describe('Measurement — step functions answer the bare value of the nominal', () => {
  test('Floor, Ceil, Round', () => {
    expect(ce.box(['Floor', M]).N().re).toBe(0);
    expect(ce.box(['Ceil', M]).N().re).toBe(1);
    expect(ce.box(['Round', M]).N().re).toBe(1);
    expect(ce.box(['Floor', M, 0.5]).N().re).toBe(0.5);
    expect(
      ce.box(['Floor', ['Measurement', ['Rational', 7, 2], ['Rational', 1, 10]]]).evaluate().json
    ).toEqual(3);
  });

  test('Mod, with a measurement dividend or divisor, propagates to first order (decision 2)', () => {
    // Slope 1 in the dividend, −⌊a/b⌋ = −2 in the divisor.
    expect(ce.box(['Mod', ['Measurement', 2.5, 0.2], 1]).N().json).toEqual([
      'Measurement',
      0.5,
      0.2,
    ]);
    const r = ce.box(['Mod', 7, ['Measurement', 2.5, 0.1]]).N();
    expect(nominal(r)).toBe(2);
    expect(error(r)).toBeCloseTo(0.2, 12);
  });
});

describe('Measurement — comparisons decide by the nominal', () => {
  test('Less, Greater, LessEqual, Equal', () => {
    expect(ce.box(['Less', M, 1]).evaluate().symbol).toBe('True');
    expect(ce.box(['Greater', M, 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['LessEqual', M, A]).evaluate().symbol).toBe('True');
    expect(ce.box(['Equal', M, A]).evaluate().symbol).toBe('True');
    expect(ce.box(['Equal', M, 1]).evaluate().symbol).toBe('False');
    // A chain, and two measurements.
    expect(ce.box(['Less', 0, M, 1]).evaluate().symbol).toBe('True');
    expect(ce.box(['Less', M, ['Measurement', 0.8, 0.5]]).evaluate().symbol).toBe('True');
  });

  test('a Which whose condition compares an integral evaluates under .N()', () => {
    const r = ce.parse('\\begin{cases} 1 & \\int_0^1 e^{-x^2}dx < 1 \\\\ 2 & \\text{otherwise} \\end{cases}').N();
    expect(r.json).toEqual(1);
    expect(ce.box(['Boole', ['Less', M, 1]]).N().json).toEqual(1);
  });
});

describe('Measurement — statistics', () => {
  const L = ['List', M, 0.5, 0.9];

  test('Mean propagates through the sum: σ/n', () => {
    const r = ce.box(['Mean', L]).N();
    expect(nominal(r)).toBeCloseTo((A + 0.5 + 0.9) / 3, 12);
    expect(error(r)).toBeCloseTo(S / 3, 12);
  });

  test('Median orders by the nominal and returns the middle datum', () => {
    expect(ce.box(['Median', L]).N().json).toEqual(M);
    // An even count: the mean of the two middle data, uncertainty propagated.
    const even = ce.box(['Median', ['List', M, 0.5, 0.9, 2]]).N();
    expect(nominal(even)).toBeCloseTo((A + 0.9) / 2, 12);
    expect(error(even)).toBeCloseTo(S / 2, 12);
  });

  test('Variance and StandardDeviation propagate through the gradient', () => {
    const data = [A, 0.5, 0.9];
    const mean = data.reduce((s, x) => s + x, 0) / 3;
    const variance = data.reduce((s, x) => s + (x - mean) ** 2, 0) / 2;
    const dVar = (2 * (A - mean)) / 2;
    const v = ce.box(['Variance', L]).N();
    expect(nominal(v)).toBeCloseTo(variance, 12);
    expect(error(v)).toBeCloseTo(Math.abs(dVar) * S, 12);
    // The nominal is the plain-data value, digit for digit.
    expect(nominal(v)).toBe(ce.box(['Variance', ['List', A, 0.5, 0.9]]).N().re);
    const s = ce.box(['StandardDeviation', L]).N();
    expect(nominal(s)).toBeCloseTo(Math.sqrt(variance), 12);
    expect(error(s)).toBeCloseTo((Math.abs(dVar) * S) / (2 * Math.sqrt(variance)), 12);
  });

  test('the population forms', () => {
    const data = [A, 0.5, 0.9];
    const mean = data.reduce((s, x) => s + x, 0) / 3;
    const variance = data.reduce((s, x) => s + (x - mean) ** 2, 0) / 3;
    const dVar = (2 * (A - mean)) / 3;
    const v = ce.box(['PopulationVariance', L]).N();
    expect(nominal(v)).toBeCloseTo(variance, 12);
    expect(error(v)).toBeCloseTo(Math.abs(dVar) * S, 12);
    const s = ce.box(['PopulationStandardDeviation', L]).N();
    expect(error(s)).toBeCloseTo((Math.abs(dVar) * S) / (2 * Math.sqrt(variance)), 12);
  });

  test('exact data keep an exact answer under evaluate()', () => {
    const v = ce
      .box(['Variance', ['List', ['Measurement', 1, ['Rational', 1, 10]], 2, 3]])
      .evaluate();
    expect(v.json).toEqual(['Measurement', 1, ['Rational', 1, 10]]);
  });

  test('no sample variance of one datum: NaN, as for plain data', () => {
    expect(ce.box(['Variance', ['List', M]]).N().isNaN).toBe(true);
  });
});

describe('Measurement — folds keep the uncertainty under .N()', () => {
  test('Product of a list', () => {
    const r = ce.box(['Product', ['List', M, 0.5, 0.9]]).N();
    expect(nominal(r)).toBeCloseTo(A * 0.45, 12);
    expect(error(r)).toBeCloseTo(0.45 * S, 12);
  });

  test('Reduce with and without a seed', () => {
    expect(ce.box(['Reduce', ['List', M, 0.5], 'Multiply']).N().json).toEqual([
      'Measurement',
      0.3734,
      0.0005,
    ]);
    expect(ce.box(['Reduce', ['List', M, 0.5], 'Add', 1]).N().json).toEqual([
      'Measurement',
      2.2468,
      0.001,
    ]);
  });
});

describe('Measurement — statistics edge cases', () => {
  test('a statistic with no propagation rule stays unevaluated', () => {
    const L = ['List', ['Measurement', 1, 0.1], 2, 4, 7];
    for (const head of ['Kurtosis', 'Skewness', 'Mode', 'InterquartileRange'])
      expect(ce.box([head, L]).N().operator).toBe(head);
    expect(ce.box(['Quartiles', ['List', ['Measurement', 1, 0.1], 2, 3]]).N().operator).toBe(
      'Quartiles'
    );
  });

  test('a measurement whose nominal is symbolic or complex keeps the statistic inert', () => {
    expect(ce.box(['Mean', ['List', ['Measurement', 'x', 0.1], 3]]).N().operator).toBe('Mean');
    expect(
      ce.box(['Variance', ['List', ['Measurement', ['Complex', 1, 2], 0.1], 3]]).N().operator
    ).toBe('Variance');
  });

  test('a plain datum that is not finite gives the statistic of the nominals', () => {
    expect(ce.box(['Mean', ['List', ['Measurement', 1, 0.1], 'PositiveInfinity']]).N().json).toBe(
      'PositiveInfinity'
    );
  });

  test('a complex plain datum: the gradient uses the real part of the deviation', () => {
    // Mean 1 + i/2; the measured datum deviates along the imaginary axis
    // only, so its uncertainty does not reach E[|X − μ|²].
    const v = ce.box(['Variance', ['List', ['Measurement', 1, 0.1], ['Complex', 1, 1]]]).N();
    expect(v.json).toEqual(0.5);
  });

  test('Median of equal nominals with different uncertainties is their mean', () => {
    const m = ce.box(['Median', ['List', ['Measurement', 1, 0.1], ['Measurement', 1, 0.2]]]).N();
    expect(nominal(m)).toBe(1);
    expect(error(m)).toBeCloseTo(Math.sqrt(0.01 + 0.04) / 2, 12);
  });

  test('Median of float data is a float under evaluate(), as for plain data', () => {
    const m = ce.box(['Median', ['List', ['Measurement', 1.5, 0.1], 2.5, 4.5, 7.5]]).evaluate();
    expect(m.json).toEqual(3.5);
  });

  test('Mean of an exact radical nominal stays exact under evaluate()', () => {
    const m = ce
      .box(['Mean', ['List', ['Measurement', ['Sqrt', 2], ['Rational', 1, 10]], 1]])
      .evaluate();
    expect(m.json).toEqual([
      'Measurement',
      ['Multiply', ['Rational', 1, 2], ['Add', 1, ['Sqrt', 2]]],
      ['Rational', 1, 20],
    ]);
  });
});

describe('Measurement — step functions near a rounding jump, Truncate and Fract', () => {
  test('the exact nominal decides a jump that the float cannot', () => {
    // 1 − 10⁻³⁰ is the double 1, but its floor is 0. The uncertainty is
    // smaller than the distance to the jump at 1 (with an uncertainty of
    // 1/100 the jump is within one σ, and the call stays unevaluated:
    // decision 1).
    const m = ['Measurement', ['Subtract', 1, ['Power', 10, -30]], ['Power', 10, -40]];
    expect(ce.box(['Floor', m]).N().re).toBe(0);
    expect(ce.box(['Ceil', m]).N().re).toBe(1);
  });

  test('Truncate reads the nominal; Fract keeps the uncertainty (slope 1)', () => {
    expect(ce.box(['Truncate', ['Measurement', 2.5, 0.01]]).N().re).toBe(2);
    expect(ce.box(['Fract', ['Measurement', 2.5, 0.01]]).N().json).toEqual([
      'Measurement',
      0.5,
      0.01,
    ]);
    expect(
      ce.box(['Fract', ['Measurement', ['Rational', 5, 2], ['Rational', 1, 100]]]).evaluate().json
    ).toEqual(['Measurement', ['Rational', 1, 2], ['Rational', 1, 100]]);
  });
});

describe('Measurement — comparison on the asynchronous route', () => {
  test('evaluateAsync decides by the nominal too', async () => {
    const r = await ce.box(['Less', M, 1]).evaluateAsync();
    expect(r.symbol).toBe('True');
    const chain = await ce.box(['Less', 0, M, 1]).evaluateAsync();
    expect(chain.symbol).toBe('True');
  });
});

describe('Measurement — imaginary part of a real measurement', () => {
  test('Im is exactly 0, with no uncertainty', () => {
    expect(ce.box(['Im', M]).N().json).toEqual(0);
    // The real part keeps the uncertainty.
    expect(ce.box(['Re', M]).N().json).toEqual(M);
  });
});
