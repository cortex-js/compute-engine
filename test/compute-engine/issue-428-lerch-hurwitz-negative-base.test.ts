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
    // A FLOAT order with an integer value (`3.0` in JavaScript is the
    // integer 3, so the literal is spelled as a MathJSON float): real.
    const float = ce.expr(['LerchPhi', 0, { num: '3.0' }, -2.5]).N();
    expect(float.im).toBe(0);
    expect(float.re).toBeCloseTo(-0.064, 12);
  });

  test('LerchPhi(0, 1/2, −4) = −i/2 (exact, principal)', () => {
    const v = ce.expr(['LerchPhi', 0, ['Rational', 1, 2], -4]).N();
    expect(v.re).toBeCloseTo(0, 12);
    expect(v.im).toBeCloseTo(-0.5, 12);
    // An even denominator: `Power` already gives the principal value, and
    // the exact form is kept.
    expect(
      ce
        .expr(['LerchPhi', 0, ['Rational', 1, 2], -4])
        .evaluate()
        .toString()
    ).toBe('-1/2i');
  });

  test('LerchPhi(0, 1/3, −8): the exact route is the principal power too', () => {
    // `Power` takes the real root for an odd denominator (`(−8)^(−1/3)` is
    // `−1/2`), so the exact value is the exponential form, whose `.N()` is
    // the principal `(1/2)·e^(−iπ/3)`.
    const e = ce.expr(['LerchPhi', 0, ['Rational', 1, 3], -8]);
    const exact = e.evaluate();
    expect(exact.toString()).toBe('e^(-1/3 * ln(-8))');
    for (const v of [exact.N(), e.N()]) {
      expect(v.re).toBeCloseTo(0.25, 12);
      expect(v.im).toBeCloseTo(-0.4330127018922193, 12);
    }
    // Mathematica sums `|k + a|^(−s)` and answers `1/2` here; the engine
    // follows the series it sums for every other `z` (DLMF 25.14.1).
    expect(exact.toString()).not.toBe('-1/2');
  });

  // A base that is not a perfect power: `Power` leaves the symbolic real
  // root `−1/root(3)(3)` (typed `real`), which is read off the type; an
  // exact base that is not a literal (`−√2`) is read off its sign.
  test.each([
    ['−3', -3],
    ['−2', -2],
    ['−√2', ['Negate', ['Sqrt', 2]]],
  ])('LerchPhi(0, 1/3, %s): evaluate() and N() agree', (_, a) => {
    const e = ce.expr(['LerchPhi', 0, ['Rational', 1, 3], a as any]);
    const exact = e.evaluate();
    expect(exact.toString()).toMatch(/^e\^\(-1\/3 \* ln\(/);
    const viaExact = exact.N();
    const direct = e.N();
    expect(viaExact.re).toBeCloseTo(direct.re, 12);
    expect(viaExact.im).toBeCloseTo(direct.im, 12);
    expect(direct.im).toBeLessThan(0);
  });

  test('a complex base keeps the Power form, which is the principal value', () => {
    const e = ce.expr(['LerchPhi', 0, ['Rational', 1, 3], ['Complex', -1, 1]]);
    expect(e.evaluate().N().re).toBeCloseTo(e.N().re, 12);
    expect(e.evaluate().N().im).toBeCloseTo(e.N().im, 12);
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
