import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// An integrand that does not compile — here, operators declared with only a
// JavaScript `evaluate` handler — must still be integrated by the adaptive
// Gauss–Kronrod quadrature, not only by the 1e4-sample Monte-Carlo estimate.
// The Monte-Carlo estimate has a relative error of about 1e-2; the quadrature
// reaches about 1e-10 on these integrands.

const ce = new ComputeEngine();
let calls = 0;

function declareNumeric(
  name: string,
  fn: (x: number) => number | [re: number, im: number]
): void {
  ce.declare(name, {
    signature: '(number) -> number',
    evaluate: ([x], { engine }) => {
      if (!x.isNumberLiteral) return undefined;
      calls += 1;
      const v = fn(x.re);
      return Array.isArray(v)
        ? engine.number(engine.complex(v[0], v[1]))
        : engine.number(v);
    },
  });
}

declareNumeric('Sq', (x) => x * x);
declareNumeric('InvSqrt', (x) => 1 / Math.sqrt(x));
declareNumeric('CosTwenty', (x) => Math.cos(20 * x));
declareNumeric('Gauss', (x) => Math.exp(-x * x));
declareNumeric('Cis', (x) => [Math.cos(x), Math.sin(x)]);
declareNumeric('Inv', (x) => 1 / x);
declareNumeric('SinInv', (x) => Math.sin(1 / x));
declareNumeric('SinInvOverX', (x) => Math.sin(1 / x) / x);
declareNumeric('Bad', () => NaN);

function integrate(body: unknown, lower: unknown, upper: unknown): Expression {
  calls = 0;
  return ce.box(['Integrate', body, ['Limits', 'x', lower, upper]] as any).N();
}

function value(r: Expression): { re: number; im: number; error: number } {
  expect(r.operator).toBe('Measurement');
  const [v, e] = (r as any).ops as Expression[];
  return { re: v.re, im: v.im, error: e.re };
}

describe('Integrate(...).N() of an integrand that does not compile', () => {
  test('a smooth integrand uses the quadrature', () => {
    const r = value(integrate(['Sq', 'x'], 0, 1));
    expect(Math.abs(r.re - 1 / 3)).toBeLessThan(1e-12);
    expect(r.error).toBeLessThan(1e-10);
    // A few panels of 15 nodes each, not 1e4 samples.
    expect(calls).toBeLessThan(1000);
  });

  test('an endpoint-singular integrand: ∫₀¹ x^(-1/2) dx = 2', () => {
    const r = value(integrate(['InvSqrt', 'x'], 0, 1));
    expect(Math.abs(r.re - 2)).toBeLessThan(1e-9);
    expect(r.error).toBeLessThan(1e-8);
    expect(calls).toBeLessThan(1e4);
  });

  test('an oscillatory integrand: ∫₀³ cos(20x) dx = sin(60)/20', () => {
    const r = value(integrate(['CosTwenty', 'x'], 0, 3));
    expect(Math.abs(r.re - Math.sin(60) / 20)).toBeLessThan(1e-12);
  });

  test('a doubly-infinite interval: ∫ e^(-x²) dx = √π', () => {
    const r = value(
      integrate(['Gauss', 'x'], 'NegativeInfinity', 'PositiveInfinity')
    );
    expect(Math.abs(r.re - Math.sqrt(Math.PI))).toBeLessThan(1e-12);
  });

  test('a complex-valued integrand: ∫₀^π e^(ix) dx = 2i', () => {
    const r = value(integrate(['Cis', 'x'], 0, 'Pi'));
    expect(Math.abs(r.re)).toBeLessThan(1e-12);
    expect(Math.abs(r.im - 2)).toBeLessThan(1e-12);
  });

  test('a divergent integrand answers NaN, not a Monte-Carlo mean', () => {
    // Before, Monte Carlo reported a finite value such as `10.9 ± 1.4`.
    expect(integrate(['Inv', 'x'], 0, 1).isNaN).toBe(true);
    expect(integrate(['Inv', 'x'], 1, 'PositiveInfinity').isNaN).toBe(true);
  });

  test('the quadrature of an interpreted integrand has a bounded cost', () => {
    // `sin(1/x)` does not converge: the panel budget stops the quadrature
    // after 240 + 314 × 30 = 9 660 evaluations. Its error bound still beats
    // the 1e4-sample Monte-Carlo estimate, so the quadrature result is kept.
    // The value of ∫₀¹ sin(1/x) dx is 0.50406706190692837...
    const r = value(integrate(['SinInv', 'x'], 0, 1));
    expect(calls).toBeLessThanOrEqual(9660);
    expect(Math.abs(r.re - 0.5040670619069283)).toBeLessThanOrEqual(
      Math.max(r.error, 1e-4)
    );
  });

  test('when the quadrature fails, Monte Carlo is still the fallback', () => {
    // `sin(1/x)/x` on [0, 1] neither converges nor gives a bound that beats
    // the 1e4-sample estimate: after the quadrature's budget, the 1e4
    // Monte-Carlo samples are drawn, and the result is still a measurement.
    const r = integrate(['SinInvOverX', 'x'], 0, 1);
    expect(r.operator).toBe('Measurement');
    expect(calls).toBeGreaterThan(9660);
  });

  test('an integrand that is NaN everywhere stays symbolic', () => {
    // No sample is a number, so nothing was integrated: the `Integrate`
    // expression is kept, as it was with Monte Carlo alone.
    expect(integrate(['Bad', 'x'], 0, 1).operator).toBe('Integrate');
  });

  test('a compiled integrand is unchanged', () => {
    const r = value(integrate(['Power', 'x', 2], 0, 1));
    expect(Math.abs(r.re - 1 / 3)).toBeLessThan(1e-15);
    // The compiled integrand does not call the `evaluate` handlers.
    expect(calls).toBe(0);
  });
});
