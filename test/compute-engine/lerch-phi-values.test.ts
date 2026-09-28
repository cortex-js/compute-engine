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

  test('a cancellation too severe to certify stays symbolic rather than answer a wrong number', () => {
    // mpmath: lerchphi(10,10,10) = -4.4621307271021857e-11 - ..., but every
    // term feeding it is of order 1 — the continuation declines rather than
    // ship a value with no correct digits (see lerchContinuedComplex).
    const z = phi(10, 10, 10).N();
    expect(z.numericValue).toBeUndefined();
  });
});

describe('LerchPhi at real z < −1: declines rather than trust the incomplete Γ near its branch cut', () => {
  // For real z < −1, log z = ln|z| + iπ, so the continuation's incomplete-Γ
  // argument always lands close to the negative real axis, where
  // `incompleteGammaUpperComplex` is unreliable (cortex-js/compute-engine#353).
  // A 300-point mpmath sweep found wrong, uncaught values here (the
  // cancellation estimate in `lerchContinuedComplex` does not see the
  // error); these five are the reported witnesses, each confirmed against
  // mpmath's `lerchphi` to differ from the naive continued value by more
  // than 1e-9 relative. `LerchPhi` declines the whole z < −1 branch instead
  // (see `lerchPhiComplex`).
  test.each([
    [-3, 3.118, 2.864], // mpmath: 0.018570430819231976 (we returned 0.018570430815360785, 2e-10 off)
    [-3, 4.269, 3.146], // mpmath: 0.0041635178924785445 (we returned 0.004163517891707492, 2e-10 off)
    [-3, 4.042, 3.537], // mpmath: 0.003075314138589726 (we returned 0.003075314096555882, 1.4e-8 off)
    [-1.5, 3.918, 4.669], // mpmath: 0.0014362416140569338 (we returned 0.0014362408083850166, 5.6e-7 off)
    [-1.5, 2.391, 3.584], // mpmath: 0.02650423891863705 (we returned 0.026504238895593942, 9e-10 off)
  ])('LerchPhi(%p, %p, %p) stays symbolic under N()', (z, s, a) => {
    const r = phi(z, s, a).N();
    expect(r.numericValue).toBeUndefined();
  });

  test('the decline covers the whole z < −1 real axis, not only these five points', () => {
    // Every (s, a) in a grid at a few representative z < −1 declines too —
    // the branch is dropped outright rather than patched pointwise.
    for (const z of [-1.01, -1.5, -2, -3.7, -5]) {
      for (const s of [-3.5, 0.5, 2, 5.5]) {
        for (const a of [0.25, 1.5, 4.5]) {
          expect(phi(z, s, a).N().numericValue).toBeUndefined();
        }
      }
    }
  });

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
  test('the real branch (a ≥ 0) types real', () => {
    const t = phi(0.5, 2, 1).type;
    expect(t.matches('real')).toBe(true);
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
  ])('LerchPhi(%p, %p, %p)', (z, s, a) => {
    expectParity(run?.({ lp_z: z, lp_s: s, lp_a: a }), z, s, a);
  });

  test('past |z| = 1 the real-only compiled lane is NaN (no GPU/JS incomplete-Γ kernel)', () => {
    expect(run?.({ lp_z: 3, lp_s: 2, lp_a: 1 })).toBeNaN();
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

  test('LerchPhi lowers to the _gpu_lerch_phi helper', () => {
    const r = new GLSLTarget().compile(
      ce.box(['LerchPhi', 'gl_z', 'gl_s', 'gl_a'])
    );
    expect(r.code).toBe('_gpu_lerch_phi(gl_z, gl_s, gl_a)');
  });
});
