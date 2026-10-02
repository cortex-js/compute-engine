import { ComputeEngine } from '../../src/compute-engine';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

/**
 * A definite integral with a pole AT a finite bound is an improper integral:
 * the one-sided limit from inside the interval. When that limit is infinite,
 * the integral diverges with the sign of the integrand next to the bound,
 * inside the interval, times the orientation of the interval. The order of
 * the pole does not decide the sign: `1/t` is positive on `(0, 1]` and
 * negative on `[−1, 0)`.
 *
 * Before this was fixed, `∫₀¹ t⁻² dt` gave `~∞` (`ComplexInfinity`) under
 * `.evaluate()` (the antiderivative `−1/t` evaluated at `0`) and `NaN` under
 * `.N()` (the quadrature found a divergence, with no sign).
 *
 * An integrable singularity at a bound (`t^(−1/2)`, `t^(−0.95)`, `ln t`,
 * `1/√(1 − t²)`) keeps its finite value.
 */

const ce = new ComputeEngine();

const integral = (body: unknown, v: string, a: unknown, b: unknown) =>
  ce.box(['Integrate', body, ['Limits', v, a, b]] as any);

const nIntegrate = (body: unknown, a: unknown, b: unknown) =>
  ce.box(['NIntegrate', ['Function', body, 't'], a, b] as any).evaluate();

describe('INTEGRAL WITH A POLE AT A BOUND', () => {
  const cases: [string, unknown, string, unknown, unknown, string][] = [
    ['∫₀¹ t⁻² dt', ['Power', 't', -2], 't', 0, 1, '+oo'],
    ['∫₋₁⁰ t⁻² dt', ['Power', 't', -2], 't', -1, 0, '+oo'],
    ['∫₀¹ −t⁻² dt', ['Negate', ['Power', 't', -2]], 't', 0, 1, '-oo'],
    ['∫₁⁰ t⁻² dt', ['Power', 't', -2], 't', 1, 0, '-oo'],
    ['∫₋₁⁰ t⁻³ dt', ['Power', 't', -3], 't', -1, 0, '-oo'],
    ['∫₀¹ dt/t', ['Divide', 1, 't'], 't', 0, 1, '+oo'],
    ['∫₋₁⁰ dt/t', ['Divide', 1, 't'], 't', -1, 0, '-oo'],
    ['∫₁⁰ dt/t', ['Divide', 1, 't'], 't', 1, 0, '-oo'],
    [
      '∫₀^π (y − π)⁻² dy',
      ['Power', ['Subtract', 'y', 'Pi'], -2],
      'y',
      0,
      'Pi',
      '+oo',
    ],
    ['∫₀^(π/2) tan t dt', ['Tan', 't'], 't', 0, ['Divide', 'Pi', 2], '+oo'],
    [
      '∫₀¹ (1/t + 1/(1 − t)) dt',
      ['Add', ['Divide', 1, 't'], ['Divide', 1, ['Subtract', 1, 't']]],
      't',
      0,
      1,
      '+oo',
    ],
  ];

  test.each(cases)('%s under evaluate()', (_, body, v, a, b, expected) => {
    expect(integral(body, v, a, b).evaluate().toString()).toBe(expected);
  });

  test.each(cases)('%s under N()', (_, body, v, a, b, expected) => {
    expect(integral(body, v, a, b).N().toString()).toBe(expected);
  });

  test.each(cases)('%s with NIntegrate', (_, body, v, a, b, expected) => {
    // `NIntegrate` takes a function of `t`.
    const f = ce.box(body as any).subs({ [v]: ce.symbol('t') }).json;
    expect(nIntegrate(f, a, b).toString()).toBe(expected);
  });

  test('the multi-limit form', () => {
    const f = ['Function', ['Power', 't', -2], 't', 'x'];
    const forward = ce.box([
      'Integrate',
      f,
      ['Limits', 't', 0, 1],
      ['Limits', 'x', 0, 2],
    ] as any);
    expect(forward.evaluate().toString()).toBe('+oo');
    expect(forward.N().toString()).toBe('+oo');
    // The reversed outer dimension negates the integral.
    const reversed = ce.box([
      'Integrate',
      f,
      ['Limits', 't', 0, 1],
      ['Limits', 'x', 2, 0],
    ] as any);
    expect(reversed.evaluate().toString()).toBe('-oo');
    expect(reversed.N().toString()).toBe('-oo');
  });

  test('a symbol with a value moves the pole to the bound', () => {
    const engine = new ComputeEngine();
    engine.assign('q', 1);
    const e = engine.box([
      'Integrate',
      ['Power', ['Subtract', 'y', 'q'], -2],
      ['Limits', 'y', 0, 1],
    ] as any);
    expect(e.evaluate().toString()).toBe('+oo');
    expect(e.N().toString()).toBe('+oo');
  });

  test('poles at both bounds with different signs have no value', () => {
    // `∫₀¹ (1/t − 1/(1 − t)) dt`: `+∞` at 0, `−∞` at 1.
    const e = integral(
      ['Subtract', ['Divide', 1, 't'], ['Divide', 1, ['Subtract', 1, 't']]],
      't',
      0,
      1
    );
    // `Indeterminate` under evaluate(), as for an interior pole across
    // which the integrand changes sign.
    expect(e.evaluate().toString()).toBe('Indeterminate');
    expect(e.N().isNaN).toBe(true);
  });
});

describe('INTEGRABLE SINGULARITY AT A BOUND', () => {
  test('∫₀¹ t^(−1/2) dt = 2', () => {
    const e = integral(['Power', 't', ['Rational', -1, 2]], 't', 0, 1);
    expect(e.evaluate().toString()).toBe('2');
    expect(e.N().re).toBeCloseTo(2, 8);
    expect(
      nIntegrate(['Power', 't', ['Rational', -1, 2]], 0, 1).re
    ).toBeCloseTo(2, 8);
  });

  test('∫₀¹ t^(−0.95) dt = 20', () => {
    // The order of this singularity is close to 1, but it is integrable.
    const e = integral(['Power', 't', -0.95], 't', 0, 1);
    expect(e.evaluate().re).toBeCloseTo(20, 6);
    expect(e.N().re).toBeCloseTo(20, 6);
    expect(nIntegrate(['Power', 't', -0.95], 0, 1).re).toBeCloseTo(20, 6);
  });

  test('∫₀¹ ln t dt = −1', () => {
    const e = integral(['Ln', 't'], 't', 0, 1);
    expect(e.N().re).toBeCloseTo(-1, 8);
    expect(nIntegrate(['Ln', 't'], 0, 1).re).toBeCloseTo(-1, 8);
  });

  test('∫₋₁¹ 1/√(1 − t²) dt = π', () => {
    const body = ['Divide', 1, ['Sqrt', ['Subtract', 1, ['Power', 't', 2]]]];
    const e = integral(body, 't', -1, 1);
    expect(e.evaluate().toString()).toBe('pi');
    expect(e.N().re).toBeCloseTo(Math.PI, 6);
    expect(nIntegrate(body, -1, 1).re).toBeCloseTo(Math.PI, 6);
  });
});

describe('INTEGRABLE SINGULARITY WITH A LOGARITHMIC FACTOR', () => {
  // A logarithmic factor raises the pole order measured next to the bound
  // above 1, but the integral converges. `∫₀¹ t^(−p)·ln t dt = −1/(1 − p)²`
  // and `∫₀¹ t^(−p)·ln²t dt = 2/(1 − p)³`.
  test('∫₀¹ t^(−0.95)·ln t dt = −400', () => {
    const body = ['Multiply', ['Power', 't', -0.95], ['Ln', 't']];
    const e = integral(body, 't', 0, 1);
    expect(e.evaluate().isInfinity).not.toBe(true);
    expect(e.N().re).toBeCloseTo(-400, 4);
    expect(nIntegrate(body, 0, 1).re).toBeCloseTo(-400, 4);
  });

  test('∫₀¹ t^(−0.9)·ln²t dt = 2000', () => {
    const body = ['Multiply', ['Power', 't', -0.9], ['Power', ['Ln', 't'], 2]];
    const e = integral(body, 't', 0, 1);
    expect(e.evaluate().isInfinity).not.toBe(true);
    expect(e.N().re).toBeCloseTo(2000, 3);
    expect(nIntegrate(body, 0, 1).re).toBeCloseTo(2000, 3);
  });

  test('an order very close to 1 gives no infinity', () => {
    // `∫₀¹ t^(−0.995)·ln t dt = −40000`. The quadrature cannot separate this
    // from a divergence, and the endpoint check must not give `−∞`.
    const body = ['Multiply', ['Power', 't', -0.995], ['Ln', 't']];
    expect(integral(body, 't', 0, 1).N().isInfinity).not.toBe(true);
    expect(nIntegrate(body, 0, 1).isInfinity).not.toBe(true);
  });

  test('∫₀¹ ln t / t dt = −∞', () => {
    const body = ['Divide', ['Ln', 't'], 't'];
    expect(integral(body, 't', 0, 1).evaluate().toString()).toBe('-oo');
    expect(integral(body, 't', 0, 1).N().toString()).toBe('-oo');
    expect(nIntegrate(body, 0, 1).toString()).toBe('-oo');
  });

  test('next to a nonzero bound, an uncertain verdict gives no infinity', () => {
    // `∫₀¹ (1 − t)^(−0.95)·ln(1 − t) dt = −400`. Next to `t = 1` the
    // floating-point numbers do not resolve the tail of the integral, so the
    // quadrature cannot give the value, but it must not give `−∞` either.
    const body = [
      'Multiply',
      ['Power', ['Subtract', 1, 't'], -0.95],
      ['Ln', ['Subtract', 1, 't']],
    ];
    const e = integral(body, 't', 0, 1);
    expect(e.N().isInfinity).not.toBe(true);
    expect(nIntegrate(body, 0, 1).isInfinity).not.toBe(true);
  });
});

describe('POLE AT A BOUND WITH A LARGE REGULAR PART', () => {
  test('∫₀¹ (1/t − 100) dt = +∞', () => {
    const body = ['Subtract', ['Divide', 1, 't'], 100];
    expect(integral(body, 't', 0, 1).N().toString()).toBe('+oo');
    expect(nIntegrate(body, 0, 1).toString()).toBe('+oo');
  });

  test('∫₀¹ (1/(1 − t) − 10⁴) dt = +∞', () => {
    const body = ['Subtract', ['Divide', 1, ['Subtract', 1, 't']], 10000];
    expect(integral(body, 't', 0, 1).evaluate().toString()).toBe('+oo');
    expect(integral(body, 't', 0, 1).N().toString()).toBe('+oo');
    expect(nIntegrate(body, 0, 1).toString()).toBe('+oo');
  });
});

describe('A LOGARITHM IN A DENOMINATOR', () => {
  // `1/(t·ln²t)` behaves as `1/(t − 1)²` next to `t = 1`, and is positive.
  const body = ['Divide', 1, ['Multiply', 't', ['Power', ['Ln', 't'], 2]]];

  test('∫₀¹ 1/(t·ln²t) dt = +∞', () => {
    const e = integral(body, 't', 0, 1);
    expect(e.evaluate().toString()).toBe('+oo');
    expect(e.N().toString()).toBe('+oo');
    expect(nIntegrate(body, 0, 1).toString()).toBe('+oo');
  });

  test('∫₀^½ 1/(t·ln²t) dt = 1/ln 2', () => {
    // The singularity at 0 is integrable: the antiderivative is `−1/ln t`.
    const e = integral(body, 't', 0, ['Rational', 1, 2]);
    expect(e.evaluate().N().re).toBeCloseTo(1 / Math.LN2, 10);
  });

  test('∫₀² 1/(t·ln²t) dt = +∞ (a pole inside)', () => {
    expect(integral(body, 't', 0, 2).evaluate().toString()).toBe('+oo');
  });

  test('∫ from ½ to 2 of 1/ln t has no value', () => {
    // `1/ln t` changes sign across `t = 1`.
    const e = integral(['Divide', 1, ['Ln', 't']], 't', ['Rational', 1, 2], 2);
    expect(e.evaluate().toString()).toBe('Indeterminate');
    expect(e.N().isNaN).toBe(true);
  });
});

describe('ITERATED INTEGRAL WITH A POLE THAT MOVES WITH ANOTHER VARIABLE', () => {
  // For each `y` in `(3, 4)`, the inner integral over `x ∈ [3, 4]` has an
  // interior pole at `x = y`.
  const iterated = (body: unknown, y: [number, number]) =>
    ce.box([
      'Integrate',
      body,
      ['Limits', 'y', y[0], y[1]],
      ['Limits', 'x', 3, 4],
    ] as any);
  const inverseSquare = ['Power', ['Subtract', 'y', 'x'], -2];

  test('a pole of order 2 diverges to +∞', () => {
    expect(iterated(inverseSquare, [0, 10]).N().toString()).toBe('+oo');
  });

  test('the orientation of the other dimension gives the sign', () => {
    expect(iterated(inverseSquare, [10, 0]).N().toString()).toBe('-oo');
    expect(iterated(['Negate', inverseSquare], [0, 10]).N().toString()).toBe(
      '-oo'
    );
  });

  test('a sign change across the pole has no value', () => {
    expect(
      iterated(['Power', ['Subtract', 'y', 'x'], -3], [0, 10]).N().isNaN
    ).toBe(true);
  });

  test('no pole in the range keeps the quadrature value', () => {
    // `∫₅¹⁰ ∫₃⁴ (y − x)⁻² dx dy = ln(12/7)`.
    expect(iterated(inverseSquare, [5, 10]).N().re).toBeCloseTo(
      Math.log(12 / 7),
      8
    );
  });
});

describe('QUADRATURE DIVERGENCE TEST', () => {
  test('a logarithmic factor is not a divergence', () => {
    // `∫₀¹ t^(−0.95)·ln(c·t) dt = 20·ln c − 400`, at every scale `c`.
    for (const k of [-6, -3, 0, 3, 6]) {
      const c = 10 ** k;
      const r = adaptiveQuadrature((t) => t ** -0.95 * Math.log(c * t), 0, 1);
      expect(r.divergent).toBe(false);
      expect(r.estimate).toBeCloseTo(20 * Math.log(c) - 400, 4);
    }
  });

  test('a pole is a divergence', () => {
    const divergent = (f: (t: number) => number, a: number, b: number) =>
      adaptiveQuadrature(f, a, b).divergent;
    expect(divergent((t) => 1 / t, 0, 1)).toBe(true);
    expect(divergent((t) => t ** -2, 0, 1)).toBe(true);
    expect(divergent((t) => Math.tan(t), 0, Math.PI / 2)).toBe(true);
    expect(divergent((t) => Math.log(t) / t, 0, 1)).toBe(true);
    expect(divergent((t) => t ** -1.1 * Math.log(t), 0, 1)).toBe(true);
    expect(divergent((t) => 1 / (1 - t) - 100, 0, 1)).toBe(true);
    expect(divergent((t) => 1 / t, 1, Infinity)).toBe(true);
  });
});
