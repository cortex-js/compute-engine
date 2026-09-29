/**
 * The Lerch transcendent Φ(z,s,a) = Σ_{k=0}^∞ zᵏ(k+a)^(−s)
 * (library/arithmetic.ts `LerchPhi`, backed by the machine kernel in
 * numerics/lerch-phi.ts). Reference values below are cross-checked against
 * mpmath's `lerchphi` at 40 digits; the comment on each case carries the
 * value mpmath reports.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();

function phi(z: unknown, s: unknown, a: unknown) {
  return ce.expr(['LerchPhi', z as any, s as any, a as any]);
}

describe('LerchPhi at z = 1: reduces to HurwitzZeta', () => {
  test('Φ(1,3,1) = ζ(3)', () => {
    expect(
      phi(1, 3, 1)
        .evaluate()
        .isSame(ce.expr(['HurwitzZeta', 3, 1]).evaluate())
    ).toBe(true);
    // mpmath: lerchphi(1,3,1) = 1.2020569031595943 (Apéry's constant)
    expect(phi(1, 3, 1).N().re).toBeCloseTo(1.2020569031595943, 10);
  });

  test('Φ(1,−3,5/4) is the exact Bernoulli closed form ζ(−3,5/4)', () => {
    // mpmath: lerchphi(1,-3,1.25) = -0.016080729166666667
    const exact = phi(1, -3, ['Rational', 5, 4]).evaluate();
    expect(
      exact.isSame(ce.expr(['HurwitzZeta', -3, ['Rational', 5, 4]]).evaluate())
    ).toBe(true);
    expect(exact.N().re).toBeCloseTo(-0.016080729166666667, 12);
  });
});

describe('LerchPhi at the other exact reductions', () => {
  test('Φ(0,s,a) = a^(−s): only the k = 0 term survives', () => {
    expect(
      phi(0, ['Rational', 5, 2], 3)
        .evaluate()
        .isSame(ce.expr(['Power', 3, ['Rational', -5, 2]]).evaluate())
    ).toBe(true);
    // mpmath: lerchphi(0,2.5,3) = 0.064150029909958418
    expect(phi(0, 2.5, 3).N().re).toBeCloseTo(0.064150029909958418, 12);
  });

  test('Φ(z,0,a) = 1/(1 − z), independent of a', () => {
    expect(
      phi(0.7, 0, 5)
        .evaluate()
        .isSame(ce.expr(['Divide', 1, ['Subtract', 1, 0.7]]).evaluate())
    ).toBe(true);
    // mpmath: lerchphi(0.7,0,5) = 3.3333333333333328 = 1/0.3
    expect(phi(0.7, 0, 5).N().re).toBeCloseTo(1 / 0.3, 10);
  });
});

describe('LerchPhi: pole and indeterminate at a non-positive integer base point', () => {
  test('a non-positive integer, Re(s) > 0, z ≠ 0: the pole ~oo', () => {
    expect(phi(0.4, 2, 0).evaluate().isSame(ce.ComplexInfinity)).toBe(true);
    expect(phi(0.4, 2, -3).evaluate().isSame(ce.ComplexInfinity)).toBe(true);
  });

  test('z = 0 escapes the pole: Φ(0,s,a) = a^(−s) even at a a non-positive integer', () => {
    // 0^(−2) is itself a pole (Power's own convention), so this reduces to
    // ComplexInfinity too, but via Power, not because LerchPhi special-cased it.
    expect(
      phi(0, 2, 0)
        .evaluate()
        .isSame(ce.expr(['Power', 0, -2]).evaluate())
    ).toBe(true);
  });

  test('Re(s) = 0, s ≠ 0, a non-positive integer: indeterminate under N()', () => {
    const z = phi(0.4, ['Complex', 0, 2], -1).N();
    expect(z.isSame(ce.NaN)).toBe(true);
  });

  test('a near, but not exactly, a non-positive integer is not a pole', () => {
    // mpmath: lerchphi(0.4,2,-1e-7) = 100000000000000.46 — huge, but finite.
    const z = phi(0.4, 2, -0.0000001).N();
    expect(Number.isFinite(z.re)).toBe(true);
    expect(z.re).toBeCloseTo(1e14, -8);
  });
});

describe('LerchPhi inside the unit disk: direct summation', () => {
  test('Φ(1/2,2,1) matches mpmath', () => {
    // mpmath: lerchphi(0.5,2,1) = 1.164481052930025
    expect(phi(0.5, 2, 1).N().re).toBeCloseTo(1.164481052930025, 13);
  });

  test('Φ(1/4,3,2) matches mpmath', () => {
    // mpmath: lerchphi(0.25,3,2) = 0.13538233274517288
    expect(phi(0.25, 3, 2).N().re).toBeCloseTo(0.13538233274517288, 13);
  });

  test('Φ(0.3+0.4i, 2, 1.5), a complex z inside the disk, matches mpmath', () => {
    // mpmath: lerchphi(0.3+0.4j,2,1.5) = 0.4794701373018355 + 0.083808105300108231j
    const z = phi(['Complex', 0.3, 0.4], 2, 1.5).N();
    expect(z.re).toBeCloseTo(0.4794701373018355, 12);
    expect(z.im).toBeCloseTo(0.083808105300108231, 12);
  });

  test('a complex s and a inside the disk match mpmath', () => {
    // mpmath: lerchphi(0.3+0.2j, 1.5, 0.7+0.1j) = 1.7962726730668766 - 0.24341454893678925j
    const z = phi(['Complex', 0.3, 0.2], 1.5, ['Complex', 0.7, 0.1]).N();
    expect(z.re).toBeCloseTo(1.7962726730668766, 12);
    expect(z.im).toBeCloseTo(-0.24341454893678925, 12);
  });
});

describe('LerchPhi at real z < 0: the van Wijngaarden Euler transform', () => {
  test('Φ(−1/2,3,1) matches mpmath', () => {
    // mpmath: lerchphi(-0.5,3,1) = 0.94519568931779375
    expect(phi(-0.5, 3, 1).N().re).toBeCloseTo(0.94519568931779375, 12);
  });

  test('Φ(−1,1,1) = ln 2, on the rim where direct summation stalls', () => {
    expect(phi(-1, 1, 1).N().re).toBeCloseTo(Math.LN2, 10);
  });

  test('Φ(−1,3,1/2) matches mpmath', () => {
    // mpmath: lerchphi(-1,3,0.5) = 7.751569170074955
    expect(phi(-1, 3, ['Rational', 1, 2]).N().re).toBeCloseTo(
      7.751569170074955,
      10
    );
  });
});

describe('LerchPhi on the complex |z| = 1 rim: the continuation', () => {
  test('Φ(i,2,1) matches mpmath', () => {
    // mpmath: lerchphi(1j,2,1) = 0.91596559417721902 + 0.2056167583560283j
    const z = phi(['Complex', 0, 1], 2, 1).N();
    expect(z.re).toBeCloseTo(0.91596559417721902, 10);
    expect(z.im).toBeCloseTo(0.2056167583560283, 10);
  });

  test('Φ(0.6+0.8i, 3/2, 1/2), |z| = 1 exactly off the axes, matches mpmath', () => {
    // mpmath: lerchphi(0.6+0.8j,1.5,0.5) = 2.9173364355924776 + 0.61042646890580278j
    const z = phi(['Complex', 0.6, 0.8], 1.5, 0.5).N();
    expect(z.re).toBeCloseTo(2.9173364355924776, 9);
    expect(z.im).toBeCloseTo(0.61042646890580278, 9);
  });
});

describe('LerchPhi past |z| = 1: the Hermite integral continuation', () => {
  test('Φ(3,2,1) matches mpmath', () => {
    // mpmath: lerchphi(3,2,1) = 0.77339347443769947 - 1.1504640984077342j
    const z = phi(3, 2, 1).N();
    expect(z.re).toBeCloseTo(0.77339347443769947, 9);
    expect(z.im).toBeCloseTo(-1.1504640984077342, 9);
  });

  test('Φ(2+i, 3/2, 2) matches mpmath', () => {
    // mpmath: lerchphi(2+1j,1.5,2) = 0.067911036902367556 + 0.42359421137216241j
    const z = phi(['Complex', 2, 1], 1.5, 2).N();
    expect(z.re).toBeCloseTo(0.067911036902367556, 9);
    expect(z.im).toBeCloseTo(0.42359421137216241, 9);
  });

  test('Φ(z,s,a) very close to the z = 1 branch point still reaches full precision', () => {
    // The direct series alone cannot converge within its term cap this
    // close to z = 1 (see numerics/lerch-phi.ts); the continuation covers
    // it instead. mpmath: lerchphi(1.0000000001,2,1) = 1.6449340690863183.
    const z = phi(1.0000000001, 2, 1).N();
    expect(z.re).toBeCloseTo(1.6449340690863183, 9);
  });

  test('Φ(10,10,10), a value far below 1, matches mpmath', () => {
    // mpmath: lerchphi(10,10,10) = -4.4621307271021857e-11 - 1.5751721989810962e-12j
    // The terms of the continuation are of order 1e-10 here, so the value
    // loses about one digit to their cancellation.
    const z = phi(10, 10, 10).N();
    expect(
      Math.hypot(z.re + 4.4621307271021857e-11, z.im + 1.5751721989810962e-12)
    ).toBeLessThan(1e-11 * 4.465e-11);
  });

  test('a cancellation too severe to certify stays symbolic rather than answer a wrong number', () => {
    // mpmath: lerchphi(-2,-3.5,1.5) = 0.0024505235336676858. The closed
    // incomplete-gamma term of the continuation is about 400 times the
    // value, so the incomplete gamma's error bound (3e-13 relative) could
    // cost more than the 1e-11 the continuation must vouch for: it declines
    // (see lerchContinuedComplex).
    expect(phi(-2, -3.5, 1.5).N().numericValue).toBeUndefined();
  });

  test('s next to a positive integer, with −a·log z next to the negative real axis, stays symbolic', () => {
    // mpmath: lerchphi(2,3.000001,3.5) = 0.0090998751173185692 - 0.066706054562371451j
    // The continuation needs Γ(1 − s, −a·log z) = Γ(−2.000001, −2.43), and
    // the incomplete gamma kernel declines within about 3e-6 of a pole of
    // Γ(1 − s) when its argument is next to the negative real axis (its
    // power series cancels there), so LerchPhi declines too.
    expect(phi(2, 3.000001, 3.5).N().numericValue).toBeUndefined();
  });
});

describe('LerchPhi at real z < −1: the continuation', () => {
  // For real z < −1, log z = ln|z| + iπ, so the continuation's incomplete
  // gamma argument x = −b·log z has Re(x) = −b·ln|z| < 0 and Im(x) = −π·b.
  // The incomplete gamma kernel was inaccurate for Re(x) < 0 until
  // cortex-js/compute-engine#353 was fixed, and the continuation declined
  // there. These five are the points where the continuation, before it
  // declined, returned a wrong value (off by 2e-10 to 5.6e-7 relative); each
  // must now match mpmath.
  test.each([
    [-3, 3.118, 2.864, 0.018570430819231975658],
    [-3, 4.269, 3.146, 0.0041635178924785441229],
    [-3, 4.042, 3.537, 0.0030753141385897259203],
    [-1.5, 3.918, 4.669, 0.0014362416140569337228],
    [-1.5, 2.391, 3.584, 0.026504238918637052638],
  ])('LerchPhi(%p, %p, %p) matches mpmath', (z, s, a, expected) => {
    const r = phi(z, s, a).N();
    expect(Math.abs(r.re - expected)).toBeLessThan(1e-11 * expected);
    expect(Math.abs(r.im)).toBeLessThan(1e-11 * expected);
  });

  test.each([
    // mpmath: lerchphi(z, s, a) at 30 digits
    [-1.01, 0.5, 0.25, 1.4709349591715623],
    [-1.01, 0.5, 4.5, 0.24744551131833717],
    [-1.01, 2, 0.25, 15.492681670195115],
    [-1.01, 2, 4.5, 0.029824430242265],
    [-1.01, 5.5, 0.25, 2047.7144805960681],
    [-1.01, 5.5, 4.5, 0.00019376378566498765],
    [-2, 0.5, 0.25, 1.2391355966597745],
    [-2, 0.5, 4.5, 0.16927061087345504],
    [-2, 2, 0.25, 15.146982468211989],
    [-2, 2, 4.5, 0.021667771419308846],
    [-2, 5.5, 0.25, 2047.4513904471591],
    [-2, 5.5, 4.5, 0.00015853845832973147],
    [-5, 0.5, 0.25, 0.92904285522783136],
    [-5, 0.5, 4.5, 0.086661791641087889],
    [-5, 2, 0.25, 14.459403578802184],
    [-5, 2, 4.5, 0.011953424074192604],
    [-5, 5.5, 0.25, 2046.7252291566221],
    [-5, 5.5, 4.5, 0.00010425620683240273],
  ])(
    'the whole z < −1 real axis answers: LerchPhi(%p, %p, %p) matches mpmath',
    (z, s, a, expected) => {
      const r = phi(z, s, a).N();
      expect(Math.abs(r.re - expected)).toBeLessThan(1e-11 * expected);
    }
  );

  test('z = −1 itself is unaffected: it is the Euler-transform rim, not the continuation', () => {
    expect(phi(-1, 1, 1).N().re).toBeCloseTo(Math.LN2, 10);
  });

  test('the exact Φ(z,0,a) = 1/(1−z) closed form is unaffected: it never reaches the continuation', () => {
    expect(
      phi(-3, 0, 2.5)
        .evaluate()
        .isSame(ce.expr(['Divide', 1, ['Subtract', 1, -3]]).evaluate())
    ).toBe(true);
  });
});

describe('LerchPhi: convergence is checked, not assumed', () => {
  test('the terms at a negative base point are summed before any convergence test', () => {
    // The term at k = 9 is (9 − 9.000000001)² ≈ 1e-18, which used to stop
    // the sum and drop a tail of about 0.0117.
    // mpmath: lerchphi(0.5,-2,-9.000000001) = 132.000000032
    const z = phi(0.5, -2, -9.000000001).N();
    expect(Math.abs(z.re - 132.000000032)).toBeLessThan(1e-11 * 132);
  });

  test.each([
    // mpmath: lerchphi(-0.99,-12,1) = -13.854855276583912
    [-0.99, -12, 1, -13.854855276583912],
    // mpmath: lerchphi(-0.3,-30,1) = -76976750575807653.0
    [-0.3, -30, 1, -76976750575807653],
    // mpmath: lerchphi(-1,-2.5,1) = -0.087841120721362842
    [-1, -2.5, 1, -0.087841120721362842],
  ])(
    'Re(s) < 0 at real z < 0: LerchPhi(%p, %p, %p) matches mpmath',
    (zv, s, a, expected) => {
      // The Euler transform assumes decreasing terms and is not used here.
      const z = phi(zv, s, a).N();
      expect(Math.abs(z.re - expected)).toBeLessThan(
        1e-11 * Math.abs(expected)
      );
    }
  );

  test('terms that cancel too far stay symbolic rather than answer a wrong value', () => {
    // mpmath: lerchphi(-0.999,-6,1) = 0.0010640944052320294, from terms of
    // order 1e6: this used to return 0.278.
    expect(phi(-0.999, -6, 1).N().numericValue).toBeUndefined();
  });

  test('a base point too far left to shift stays symbolic, promptly', () => {
    // Adding 1 to −1e20 does not change the double: the shift used to
    // loop forever.
    expect(phi(2, -1, -1e20).N().numericValue).toBeUndefined();
    expect(phi(0.5, 2, -1000000.5).N().numericValue).toBeUndefined();
  });

  test('the rim at a large base point answers within 1e-11', () => {
    // The continuation's incomplete gamma argument is −20·log(i) = −10πi,
    // on the imaginary axis, where that kernel used to be inaccurate and the
    // continuation declined (cortex-js/compute-engine#353).
    // mpmath: lerchphi(1j,2,20) = 0.0013737855467179791 + 0.0012408125223750873j
    const z = phi(['Complex', 0, 1], 2, 20).N();
    expect(
      Math.hypot(z.re - 0.0013737855467179791, z.im - 0.0012408125223750873)
    ).toBeLessThan(1e-11 * 0.00185);
  });
});

describe('LerchPhi: exactness', () => {
  test('a symbolic z is not assumed nonzero at the pole', () => {
    // z = 0 gives Φ(0,2,−1) = (−1)^(−2) = 1, not a pole.
    expect(phi('z', 2, -1).evaluate().operator).toBe('LerchPhi');
    expect(phi(0.4, 2, -1).evaluate().isSame(ce.ComplexInfinity)).toBe(true);
  });

  test('a float operand gives a float, through the shortcuts too', () => {
    const atOne = phi(ce.number('1.0'), 2, 1).evaluate();
    expect(atOne.isNumberLiteral && !atOne.isExact).toBe(true);
    expect(atOne.re).toBeCloseTo(Math.PI ** 2 / 6, 14);
    const atZero = phi(ce.number('0.0'), 2, 3).evaluate();
    expect(atZero.isNumberLiteral && !atZero.isExact).toBe(true);
    expect(atZero.re).toBeCloseTo(1 / 9, 15);
  });

  test('an integer-valued machine result is a float, not an exact integer', () => {
    // mpmath: lerchphi(0.5,-3,1) = 52.0
    for (const e of [
      phi(['Rational', 1, 2], -3, 1).N(),
      phi(0.5, -3, 1).evaluate(),
    ]) {
      expect(e.isExact).toBe(false);
      expect(e.re).toBeCloseTo(52, 12);
    }
    // The same boxing serves HurwitzZeta. mpmath: zeta(-3,0.5) = -0.0072916666666666667
    const hz = ce.expr(['HurwitzZeta', -3, 0.5]).N();
    expect(hz.isExact).toBe(false);
    expect(hz.re).toBeCloseTo(-0.0072916666666666667, 15);
  });

  test('an exact operand set stays symbolic under evaluate()', () => {
    expect(phi(['Rational', 1, 2], -3, 1).evaluate().operator).toBe('LerchPhi');
  });
});

describe('LerchPhi at a negative base point', () => {
  test('a negative, s an integer: real', () => {
    // mpmath: lerchphi(0.5,2,-0.5) = 6.1385727502904749
    const z = phi(0.5, 2, -0.5).N();
    expect(z.im ?? 0).toBeCloseTo(0, 10);
    expect(z.re).toBeCloseTo(6.1385727502904749, 10);
  });

  test('a negative, s not an integer: complex, matching mpmath', () => {
    // mpmath: lerchphi(0.5,1.5,-0.5) = 1.5967485540318857 + 2.8284271247461901j
    const z = phi(0.5, 1.5, -0.5).N();
    expect(z.re).toBeCloseTo(1.5967485540318857, 10);
    expect(z.im).toBeCloseTo(2.8284271247461901, 10);
  });

  test('a negative and non-integer: matches mpmath', () => {
    // mpmath: lerchphi(0.5,2,-2.3) = 3.5453728270757678
    const z = phi(0.5, 2, -2.3).N();
    expect(z.im ?? 0).toBeCloseTo(0, 8);
    expect(z.re).toBeCloseTo(3.5453728270757678, 10);
  });
});

describe('LerchPhi result types', () => {
  test('the real branch (real z < 1, a > 0) types real', () => {
    const t = phi(0.5, 2, 1).type;
    expect(t.matches('real')).toBe(true);
  });

  test('z on the [1, ∞) branch cut or at the z = 1 pole does not type real', () => {
    // mpmath: lerchphi(3,2,1) = 0.77339347443769947 - 1.1504640984077342j
    expect(phi(3, 2, 1).type.matches('real')).toBe(false);
    expect(phi(1, 1, 1).type.matches('real')).toBe(false);
    // A real z of unknown size is not proven below 1.
    ce.declare('lp_real_z', 'real');
    expect(phi('lp_real_z', 2, 1).type.matches('real')).toBe(false);
  });

  test('the imaginary part of a value on the cut is not folded to 0', () => {
    const im = ce.expr(['Imaginary', ['LerchPhi', 3, 2, 1]]);
    expect(im.evaluate().isSame(0)).toBe(false);
    expect(im.N().re).toBeCloseTo(-1.1504640984077342, 12);
  });

  test('a negative base point types the wider number', () => {
    const t = phi(0.5, 1.5, -0.5).type;
    expect(t.matches('number')).toBe(true);
  });
});

describe('LerchPhi JS compile', () => {
  ce.declare('lp_z', 'real');
  ce.declare('lp_s', 'real');
  ce.declare('lp_a', 'real');
  const run = compile(ce.box(['LerchPhi', 'lp_z', 'lp_s', 'lp_a']))?.run;

  function expectParity(got: unknown, z: number, s: number, a: number) {
    const n = phi(z, s, a).N();
    if (n.im !== 0) expect(got).toBeNaN();
    else
      expect(Math.abs((got as number) - n.re)).toBeLessThan(
        1e-9 * Math.max(1, Math.abs(n.re))
      );
  }

  test.each([
    [0.5, 2, 1],
    [0.25, 3, 2],
    [-0.5, 3, 1],
    [-1, 1, 1],
    [0, 2.5, 3],
    [0.7, 0, 5],
    [0.5, 2, -0.5],
    [0.5, 1.5, -0.5],
    // Real z < −1: the value is real. mpmath: lerchphi(-3,1.5,0.7) = 1.1065755952407515
    [-3, 1.5, 0.7],
  ])('LerchPhi(%p, %p, %p)', (z, s, a) => {
    expectParity(run?.({ lp_z: z, lp_s: s, lp_a: a }), z, s, a);
  });

  test('real z > 1 is on the branch cut, where the value is complex: NaN', () => {
    expect(run?.({ lp_z: 3, lp_s: 2, lp_a: 1 })).toBeNaN();
    // Just past z = 1 the imaginary part is tiny (mpmath: lerchphi(1.0000000001,
    // 2, 1) = 1.6449340690863183 − 3.1415929e-10j), but it is not rounding
    // noise: the value is complex.
    expect(run?.({ lp_z: 1.0000000001, lp_s: 2, lp_a: 1 })).toBeNaN();
    expect(phi(1.0000000001, 2, 1).N().im).toBeCloseTo(
      -3.141592913055096e-10,
      15
    );
  });

  test('the poles match the interpreter: +Infinity where it is ComplexInfinity', () => {
    for (const [z, s, a] of [
      [0.5, 2, 0],
      [0.5, 2, -3],
      [-0.5, 1.5, -1],
    ]) {
      expect(phi(z, s, a).N().isSame(ce.ComplexInfinity)).toBe(true);
      expect(run?.({ lp_z: z, lp_s: s, lp_a: a })).toBe(Infinity);
    }
    // z = 1 is the Hurwitz zeta, whose pole is s = 1.
    expect(phi(1, 1, 1).evaluate().isSame(ce.ComplexInfinity)).toBe(true);
    expect(run?.({ lp_z: 1, lp_s: 1, lp_a: 1 })).toBe(Infinity);
  });

  test('real z < −1 answers the real value, not NaN', () => {
    // mpmath: lerchphi(-3,1.5,0.7) = 1.1065755952407514722
    expect(
      Math.abs(
        (run?.({ lp_z: -3, lp_s: 1.5, lp_a: 0.7 }) as number) -
          1.1065755952407515
      )
    ).toBeLessThan(1e-11);
  });

  test('a real value past |z| = 1 (s a non-positive integer, no branch cut)', () => {
    // Φ(2,−1,1) = 1/(1−2)² = 1. mpmath: lerchphi(2,-1,1) = 1.0
    expect(run?.({ lp_z: 2, lp_s: -1, lp_a: 1 })).toBeCloseTo(1, 12);
  });
});

describe('GPU LerchPhi preamble', () => {
  ce.declare('gl_z', 'real');
  ce.declare('gl_s', 'real');
  ce.declare('gl_a', 'real');
  const targets = [
    ['GLSL', new GLSLTarget(), 'float _gpu_hurwitz_zeta('],
    ['WGSL', new WGSLTarget(), 'fn _gpu_hurwitz_zeta('],
  ] as const;

  test.each(targets)(
    '%s: LerchPhi(z,s,a) pulls in the Hurwitz zeta helper (z = 1 reduction)',
    (_name, target, hzDecl) => {
      const r = target.compile(ce.box(['LerchPhi', 'gl_z', 'gl_s', 'gl_a']));
      expect(r.success).toBe(true);
      expect(r.preamble ?? '').toContain(hzDecl);
    }
  );

  test.each(targets)(
    '%s: z = −1 reaches the Euler transform (only |z| > 1 is NaN)',
    (_name, target) => {
      const r = target.compile(ce.box(['LerchPhi', 'gl_z', 'gl_s', 'gl_a']));
      expect(r.preamble ?? '').toMatch(/abs\(z\) > 1\.0/);
      expect(r.preamble ?? '').not.toMatch(/abs\(z\) >= 1\.0/);
    }
  );

  test('LerchPhi lowers to the _gpu_lerch_phi helper', () => {
    const r = new GLSLTarget().compile(
      ce.box(['LerchPhi', 'gl_z', 'gl_s', 'gl_a'])
    );
    expect(r.code).toBe('_gpu_lerch_phi(gl_z, gl_s, gl_a)');
  });
});
