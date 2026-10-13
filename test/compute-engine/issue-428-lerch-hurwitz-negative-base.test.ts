/**
 * cortex-js/compute-engine#428: the terms (k + a)^(−s) of LerchPhi and
 * HurwitzZeta with a < 0 and a non-integer s are principal powers
 * (DLMF 25.14.1), complex; the two-argument Zeta is Wolfram's generalized
 * zeta. Reference values are mpmath at 30 digits (`lerchphi`, `zeta`).
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// [z, s, a, re, im]
const lerch: [number, number, number, number, number][] = [
  [0, 2.976, -2.664, -0.0539976089936225, -0.00407905639770441],
  [0.5, 2.976, -2.664, 2.2328652159993195, -0.0760508042577282],
  [-0.3, 2.976, -2.664, -0.9819723664507069, -0.0220448990545442],
  [0, 2.97612, -2.664, -0.0539927941081969, -0.0040582222977166],
  [0.5, 2.97612, -2.664, 2.2332271270726038, -0.0756733996806792],
  [-0.3, 2.97612, -2.664, -0.9820840969586557, -0.0219358277780691],
];

describe('LerchPhi with a negative base point and a float order', () => {
  for (const [z, s, a, re, im] of lerch) {
    for (const mode of ['evaluate', 'N'] as const) {
      test(`LerchPhi(${z}, ${s}, ${a}) = ${re} ${im}i (${mode})`, () => {
        const v = ce.expr(['LerchPhi', z, s, a])[mode]();
        expect(v.re).toBeCloseTo(re, 10);
        expect(v.im).toBeCloseTo(im, 10);
      });
    }
  }

  // The z = 1 reduction is the Hurwitz zeta, complex for the same terms.
  test('LerchPhi(1, 2.976, −2.664) = HurwitzZeta(2.976, −2.664) = 22.600263 − 0.275416i', () => {
    for (const e of [
      ce.expr(['LerchPhi', 1, 2.976, -2.664]),
      ce.expr(['HurwitzZeta', 2.976, -2.664]),
    ]) {
      expect(e.N().re).toBeCloseTo(22.600262690249538, 10);
      expect(e.N().im).toBeCloseTo(-0.2754160758111979, 10);
    }
  });

  test('LerchPhi(0, 2.976, −2.664) at 30 digits', () => {
    const prev = ce.precision;
    ce.precision = 30;
    try {
      const v = ce.expr(['LerchPhi', 0, 2.976, -2.664]).N();
      expect(v.re).toBeCloseTo(-0.0539976089936225, 14);
      expect(v.im).toBeCloseTo(-0.00407905639770441, 14);
    } finally {
      ce.precision = prev;
    }
  });

  // mpmath: lerchphi(z, s, a) for a > 0, unchanged
  const positive: [number, number, number, number][] = [
    [0, 2.976, 2.664, 0.0541514586887906],
    [0.5, 2.976, 2.664, 0.0682461527042395],
    [-0.3, 2.976, 1.5, 0.281465752349335],
    [0.5, 2.97612, 0.7, 3.0102289177383332],
  ];
  for (const [z, s, a, re] of positive) {
    test(`LerchPhi(${z}, ${s}, ${a}) = ${re} (real, N)`, () => {
      const v = ce.expr(['LerchPhi', z, s, a]).N();
      expect(v.im).toBe(0);
      expect(v.re).toBeCloseTo(re, 10);
    });
  }

  // An integer order keeps the terms real for a < 0: Φ(0, 3, −2) = (−2)^(−3)
  test('LerchPhi(0, 3, −2) = −0.125 (integer s, real)', () => {
    expect(ce.expr(['LerchPhi', 0, 3, -2]).evaluate().re).toBe(-0.125);
    expect(ce.expr(['LerchPhi', 0, 3.0, -2.5]).N().im).toBe(0);
  });

  test('LerchPhi(0, 1/2, −4) = −i/2 (exact, principal)', () => {
    const v = ce.expr(['LerchPhi', 0, ['Rational', 1, 2], -4]).N();
    expect(v.re).toBeCloseTo(0, 12);
    expect(v.im).toBeCloseTo(-0.5, 12);
  });
});

describe('the two-argument Zeta is the generalized zeta', () => {
  test('the operator description names Wolfram generalized zeta and HurwitzZeta', () => {
    const d = ce.lookupDefinition('Zeta');
    const text = JSON.stringify(d);
    expect(text).toContain('generalized zeta');
    expect(text).toContain('HurwitzZeta');
    expect(text).not.toContain('the Hurwitz zeta function ζ(s,a)');
  });

  // Σ |n + a|^(−s) = 2.664^(−s) + 1.664^(−s) + 0.664^(−s) + ζ(s, 0.336);
  // mpmath: 29.902439693855728. HurwitzZeta sums the complex (n + a)^(−s).
  test('Zeta(2.976, −2.664) is real and differs from HurwitzZeta there', () => {
    const z = ce.expr(['Zeta', 2.976, -2.664]).N();
    expect(z.im).toBe(0);
    expect(z.re).toBeCloseTo(29.902439693855728, 10);
  });
});
