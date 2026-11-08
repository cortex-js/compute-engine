import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { adaptiveQuadrature } from '../../src/compute-engine/numerics/gauss-kronrod';

// `∫₀^½ dt/(t·(−ln t)^p) = (ln 2)^(1−p)/(p − 1)` converges for every `p > 1`.
// The shells of the quadrature next to 0 decrease as `k^(−p)` at the depth
// `k`, and for `p` near 1 most of the integral is closer to 0 than the
// deepest shell. The divergence test read these shells as divergent, and
// `.N()` gave `+∞` for `p = 1.001` (exact `1000.37`) and `p = 1.005` (exact
// `200.37`). An exponent near 1 now does not decide: the refinement goes on,
// and the extrapolation of the shells gives the value when the shells are
// deep enough. Otherwise the result has no value and no sign (`undecided`),
// and only the antiderivative can give `+∞`, as for `p = 1`.

const ce = new ComputeEngine();

const exact = (p: number) => Math.LN2 ** (1 - p) / (p - 1);
const latex = (p: number) => `\\int_0^{1/2} \\frac{dt}{t(-\\ln t)^{${p}}}`;
const integrand = (p: number) => (t: number) => 1 / (t * (-Math.log(t)) ** p);

describe('CE-1055: 1/(t·(−ln t)^p) with p slightly above 1', () => {
  test.each([1.003, 1.005, 1.008])('.N() of ∫₀^½ dt/(t·(−ln t)^%s)', (p) => {
    const r = ce.parse(latex(p)).N();
    expect(r.operator).toBe('Measurement');
    expect(Math.abs(r.op1.re - exact(p))).toBeLessThanOrEqual(r.op2.re);
    expect(r.op2.re).toBeLessThanOrEqual(1e-3 * exact(p));
  });

  test('.N() of ∫₀^½ dt/(t·(−ln t)^1.001) has no value, not +∞', () => {
    expect(ce.parse(latex(1.001)).N().toString()).toBe('NaN');
    const nIntegrate = ce.box([
      'NIntegrate',
      [
        'Function',
        [
          'Divide',
          1,
          ['Multiply', 't', ['Power', ['Negate', ['Ln', 't']], 1.001]],
        ],
        't',
      ],
      0,
      0.5,
    ]);
    expect(nIntegrate.evaluate().toString()).toBe('NaN');
  });

  test('an integral with two variables has no value, not +∞', () => {
    // One `Integrate` with the limits of `t` and of `x`: the iterated
    // quadrature, whose inner level is undecided.
    const r = ce
      .box([
        'Integrate',
        [
          'Function',
          [
            'Divide',
            1,
            ['Multiply', 't', ['Power', ['Negate', ['Ln', 't']], 1.001]],
          ],
          't',
          'x',
        ],
        ['Limits', 't', 0, 0.5],
        ['Limits', 'x', 0, 1],
      ])
      .N();
    expect(r.toString()).toBe('NaN');
  });

  test('compiled code gives the value or NaN, not +∞', () => {
    const at = (p: number) => {
      const f = compile(ce.parse(latex(p)));
      expect(f.success).toBe(true);
      return f.run!({}) as number;
    };
    expect(Number.isNaN(at(1.001))).toBe(true);
    expect(Math.abs(at(1.005) - exact(1.005))).toBeLessThan(0.1);
  });

  test('the divergent p = 1 is still +∞, from the antiderivative', () => {
    expect(ce.parse(latex(1)).N().toString()).toBe('+oo');
  });

  test('the quadrature does not decide for an exponent near 1', () => {
    // With the panel budget of an interpreted integrand, the shells of
    // `p = 1.001` and of the divergent `p = 1` are the same within the
    // error of the estimate of the exponent.
    for (const p of [1, 1.001, 1.005]) {
      const r = adaptiveQuadrature(integrand(p), 0, 0.5, {
        maxIntervals: 330,
        singularEndpoints: true,
      });
      expect(r.divergent).toBe(true);
      expect(r.undecided).toBe(true);
    }
    // Without the extrapolation of the shells, the result is also
    // `undecided`.
    const plain = adaptiveQuadrature(integrand(1.001), 0, 0.5);
    expect(plain.divergent).toBe(true);
    expect(plain.undecided).toBe(true);
    // An exponent clearly below 1 is a divergence.
    for (const p of [0.9, 0.99]) {
      const r = adaptiveQuadrature(integrand(p), 0, 0.5, {
        singularEndpoints: true,
      });
      expect(r.divergent).toBe(true);
      expect(r.undecided).toBeUndefined();
    }
  });

  test('with 1500 panels the extrapolation finds the value', () => {
    for (const p of [1.003, 1.005, 1.008]) {
      const r = adaptiveQuadrature(integrand(p), 0, 0.5, {
        singularEndpoints: true,
      });
      expect(r.divergent).toBe(false);
      expect(r.extrapolated).toBe(true);
      expect(Math.abs(r.estimate - exact(p))).toBeLessThanOrEqual(r.error);
    }
  });
});
