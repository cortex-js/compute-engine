import { ComputeEngine } from '../../src/compute-engine';

// The reported error of `∫₀¹ x^(−p) dx = 1/(1 − p)` for an exponent `p` close
// to 1 covers the true error. The shells of the corner next to 0 decrease by
// the ratio `2^(p − 1)`, which is close to 1, so the extrapolation of their
// partial sums amplifies the rounding of the sums. The two orders of the
// ε-algorithm read almost the same sums and change in the same way, so their
// difference was smaller than the true error: for `p = 0.9998` the result
// was `5000.000000338735 ± 1.5e-8`, for a true error of `3.4e-7`. The error
// now also includes the change of the extrapolation when each sum changes by
// its rounding (`roundingSensitivity` in `numerics/endpoint-quadrature.ts`).

const ce = new ComputeEngine();

describe('the error of a power singularity close to 1/x', () => {
  test.each([0.999, 0.9997, 0.9998, 0.9999, 0.99993, 0.99997])(
    '∫₀¹ x^(−%s) dx',
    (p) => {
      const r = ce.parse(`\\int_0^1 x^{-${p}}\\,dx`).N();
      expect(r.operator).toBe('Measurement');
      const value = r.op1.re;
      const error = r.op2.re;
      const exact = 1 / (1 - p);
      expect(Math.abs(value - exact)).toBeLessThanOrEqual(error);
      // The error stays small relative to the value.
      expect(error).toBeLessThanOrEqual(1e-7 * exact);
    }
  );
});
