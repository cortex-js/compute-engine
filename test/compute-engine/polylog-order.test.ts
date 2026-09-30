/**
 * `PolyLog(s, z)` widened to a non-integer or complex order s
 * (cortex-js/compute-engine#340). An integer order ≥ 2 still uses the
 * dedicated kernel. `polylogReduce` (`library/special-functions.ts`) gives
 * the exact reductions: the orders 1, 0 and −1, ζ(s) at z = 1 and the
 * Dirichlet eta identity at z = −1 for every order, and the Eulerian closed
 * form for an order −2 … −12. The `PolyLog` evaluate handler sends every
 * other order to `numerics/polylog.ts`: `Liₛ(z) = z·Φ(z,s,1)` through the
 * Lerch transcendent kernel (`numerics/lerch-phi.ts`), and Jonquière's
 * inversion formula past |z| = 1 where the Lerch continuation declines.
 * Reference values below are cross-checked against mpmath's `polylog` at
 * 30 digits; the comment on each case carries the value mpmath reports.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const ce = new ComputeEngine();

function li(s: unknown, z: unknown) {
  return ce.expr(['PolyLog', s as any, z as any]);
}

describe('PolyLog integer order is unchanged', () => {
  test('Li₂(1/2) still goes through the dedicated dilog kernel', () => {
    // mpmath: polylog(2,0.5) = 0.58224052646501256
    expect(li(2, 0.5).N().re).toBeCloseTo(0.58224052646501256, 12);
  });

  test('Li₃(1+i), past |z| = 1, still goes through the dedicated kernel', () => {
    // mpmath: polylog(3,1+1j) = 0.871158883410938016854465530638 + 1.26708344188892396368665020021j
    const z = li(3, ['Complex', 1, 1]).N();
    expect(z.re).toBeCloseTo(0.871158883410938017, 9);
    expect(z.im).toBeCloseTo(1.267083441888923964, 9);
  });
});

describe('PolyLog inside the unit disk, non-integer real order', () => {
  test('Li_2.5(1/2) matches mpmath', () => {
    // mpmath: polylog(2.5,0.5) = 0.554997278717512293210503619063
    expect(li(2.5, 0.5).N().re).toBeCloseTo(0.554997278717512293, 12);
  });

  test('Li_3.2(1/4) matches mpmath', () => {
    // mpmath: polylog(3.2,0.25) = 0.257318578351651844719155193242
    expect(li(3.2, 0.25).N().re).toBeCloseTo(0.257318578351651845, 12);
  });

  test('Li_-2.5(-1/2) matches mpmath, real order and z both negative', () => {
    // mpmath: polylog(-2.5,-0.5) = 0.00453609342767960862848869515272
    expect(li(-2.5, -0.5).N().re).toBeCloseTo(0.00453609342767960863, 12);
  });
});

describe('PolyLog with a complex order or a complex z inside the disk', () => {
  test('Li_2.5(0.3+0.4i) matches mpmath', () => {
    // mpmath: polylog(2.5,0.3+0.4j) = 0.278624749921204797 + 0.443563036302095125j
    const z = li(2.5, ['Complex', 0.3, 0.4]).N();
    expect(z.re).toBeCloseTo(0.278624749921204797, 11);
    expect(z.im).toBeCloseTo(0.443563036302095125, 11);
  });

  test('Li_1.5+0.5i(1/2) matches mpmath, a complex order', () => {
    // mpmath: polylog(1.5+0.5j,0.5) = 0.612640388900115359 - 0.051032104258903724j
    const z = li(['Complex', 1.5, 0.5], 0.5).N();
    expect(z.re).toBeCloseTo(0.612640388900115359, 11);
    expect(z.im).toBeCloseTo(-0.051032104258903724, 11);
  });
});

describe('PolyLog at z = 1: reduces to Zeta, any order', () => {
  test('Li_2.5(1) = ζ(2.5), a non-integer order the native handler skips', () => {
    expect(
      li(2.5, 1)
        .evaluate()
        .isSame(ce.expr(['Zeta', 2.5]).evaluate())
    ).toBe(true);
    // mpmath: polylog(2.5,1) = zeta(2.5) = 1.34148725725091717975676969335
    expect(li(2.5, 1).N().re).toBeCloseTo(1.34148725725091718, 12);
  });

  test('Li_-3.5(1) = ζ(-3.5), a negative order', () => {
    // mpmath: polylog(-3.5,1) = zeta(-3.5) = 0.00444101133547943195853465801782
    expect(li(-3.5, 1).N().re).toBeCloseTo(0.00444101133547943196, 12);
  });

  test('Li_-2(1) = ζ(-2) = 0, a negative INTEGER order outside the native elementary forms', () => {
    // mpmath: polylog(-2,1) = zeta(-2) = 0 — the point value by the
    // Hurwitz-zeta continuation, not the honest z → 1 limit of the
    // rational closed form (which is a pole); this matches mpmath and
    // Wolfram's own `PolyLog[s,1] = Zeta[s]` identity for every s ≠ 1.
    expect(li(-2, 1).N().re).toBeCloseTo(0, 12);
  });
});

describe('PolyLog at z = −1: the Dirichlet eta identity, any order', () => {
  test('Li_2.5(−1) matches mpmath and reduces exactly, via Zeta', () => {
    expect(
      li(2.5, -1)
        .evaluate()
        .isSame(
          ce
            .expr([
              'Multiply',
              ['Subtract', ['Power', 2, -1.5], 1],
              ['Zeta', 2.5],
            ])
            .evaluate()
        )
    ).toBe(true);
    // mpmath: polylog(2.5,-1) = -0.867199889012184138191347177679
    expect(li(2.5, -1).N().re).toBeCloseTo(-0.867199889012184138, 12);
  });

  test('Li_-2(−1) = ζ(-2)·(2³ − 1) = 0, a negative integer order outside the elementary forms', () => {
    // mpmath: polylog(-2,-1) = 0.0
    expect(li(-2, -1).N().re).toBeCloseTo(0, 12);
  });
});

describe('PolyLog past |z| = 1 and on the rim, non-integer order', () => {
  test('Li_2.5(3), past |z| = 1, matches mpmath', () => {
    // mpmath: polylog(2.5,3) = 3.28282271089122689894959850666 - 2.7213246265012425534246121864j
    const z = li(2.5, 3).N();
    expect(z.re).toBeCloseTo(3.2828227108912269, 9);
    expect(z.im).toBeCloseTo(-2.72132462650124255, 9);
  });

  test('Li_2.5(2), on the cut z ∈ (1, ∞), takes the below-the-cut value like mpmath', () => {
    // mpmath: polylog(2.5,2) = 2.78966033238277714404754430876 - 1.36380370053935279437171941141j
    const z = li(2.5, 2).N();
    expect(z.re).toBeCloseTo(2.78966033238277714, 9);
    expect(z.im).toBeCloseTo(-1.36380370053935279, 9);
  });

  test('Li_2.5(i), on the |z| = 1 rim off the cut, matches mpmath', () => {
    // mpmath: polylog(2.5,1j) = -0.153300730541184197047913152001 + 0.948622174037054707445675768037j
    const z = li(2.5, ['Complex', 0, 1]).N();
    expect(z.re).toBeCloseTo(-0.153300730541184197, 9);
    expect(z.im).toBeCloseTo(0.948622174037054707, 9);
  });
});

describe('PolyLog past |z| = 1: the continuation, or the inversion formula where it declines', () => {
  test.each([
    // mpmath: polylog(1.5,-3) = -1.6790897305048281353
    [1.5, -3, -1.6790897305048281353],
    // mpmath: polylog(2.5,-1.5) = -1.2315115793252009745
    [2.5, -1.5, -1.2315115793252009745],
    // mpmath: polylog(-0.5,-2) = -0.43748088858023395075
    [-0.5, -2, -0.43748088858023395075],
    // mpmath: polylog(0.5,-5) = -1.2972654048194184803
    [0.5, -5, -1.2972654048194184803],
    // mpmath: polylog(1.5,-1.01) = -0.77118480262567375903
    [1.5, -1.01, -0.77118480262567375903],
  ])('Li_%p(%p), on the real axis below −1, is real', (s, z, expected) => {
    const v = li(s, z).N();
    expect(v.im).toBe(0);
    expect(Math.abs(v.re - expected)).toBeLessThan(1e-13 * Math.abs(expected));
  });

  test('an order near a positive integer at a large |z| matches mpmath', () => {
    // mpmath: polylog(4.02,-61) = -27.863090147910881766
    const v = li(4.02, -61).N();
    expect(Math.abs(v.re + 27.863090147910881766)).toBeLessThan(1e-11 * 27.87);
  });

  test('a complex order below −1 matches mpmath', () => {
    // mpmath: polylog(1.5+0.5j,-3) = -1.695817331186100915 - 0.27884681338230110013j
    const v = li(['Complex', 1.5, 0.5], -3).N();
    expect(v.re).toBeCloseTo(-1.695817331186100915, 12);
    expect(v.im).toBeCloseTo(-0.27884681338230110013, 12);
  });

  test('a complex z past the disk matches mpmath', () => {
    // mpmath: polylog(2.5,-2+1j) = -1.6125833346456794631 + 0.63412545532810159467j
    const v = li(2.5, ['Complex', -2, 1]).N();
    expect(v.re).toBeCloseTo(-1.6125833346456794631, 12);
    expect(v.im).toBeCloseTo(0.63412545532810159467, 12);
  });
});

describe('PolyLog of a negative integer order: the Eulerian closed form', () => {
  test('Li₋₂(1/2) is the exact 6', () => {
    // mpmath: polylog(-2,0.5) = 6.0
    expect(li(-2, ['Rational', 1, 2]).evaluate().isSame(6)).toBe(true);
    expect(li(-2, ['Rational', 1, 2]).N().re).toBe(6);
  });

  test('Li₋₂(−2) is the exact 2/27', () => {
    // mpmath: polylog(-2,-2) = 0.074074074074074074074
    expect(
      li(-2, -2)
        .evaluate()
        .isSame(ce.number([2, 27]))
    ).toBe(true);
  });

  test('Li₋₃(1/3) is the exact 33/8', () => {
    // mpmath: polylog(-3,1/3) = 4.125
    expect(
      li(-3, ['Rational', 1, 3])
        .evaluate()
        .isSame(ce.number([33, 8]))
    ).toBe(true);
  });

  test('Li₋₅(0.3) matches mpmath', () => {
    // mpmath: polylog(-5,0.3) = 39.397104947768354556
    expect(li(-5, 0.3).N().re).toBeCloseTo(39.397104947768354556, 11);
  });

  test('Li₋₁₂(1/2) is exact, at the largest order the closed form covers', () => {
    // mpmath: polylog(-12,0.5) = 56183135190.0
    expect(li(-12, ['Rational', 1, 2]).evaluate().isSame(56183135190)).toBe(
      true
    );
  });

  test('a symbolic z stays symbolic', () => {
    expect(li(-2, 'x').evaluate().operator).toBe('PolyLog');
  });
});

describe('PolyLog at z = 1 and z = −1 for the elementary orders', () => {
  // The orders 1, 0 and −1 have closed forms that `polylogReduce` applies
  // before the ζ point value at z = 1, so these are poles, not ζ(1), ζ(0)
  // and ζ(−1).
  test('Li₁(1) is +∞', () => {
    expect(li(1, 1).evaluate().json).toBe('PositiveInfinity');
  });

  test('Li₀(1) and Li₋₁(1) are ComplexInfinity', () => {
    expect(li(0, 1).evaluate().json).toBe('ComplexInfinity');
    expect(li(-1, 1).evaluate().json).toBe('ComplexInfinity');
  });

  test('Li_{1/2}(1) stays the exact Zeta(1/2)', () => {
    const v = li(['Rational', 1, 2], 1).evaluate();
    expect(v.operator).toBe('Zeta');
    // mpmath: zeta(0.5) = -1.4603545088095868129
    expect(v.N().re).toBeCloseTo(-1.4603545088095868129, 14);
  });

  test('Li₁(−1) is −ln 2', () => {
    expect(
      li(1, -1)
        .evaluate()
        .isSame(ce.expr(['Negate', ['Ln', 2]]))
    ).toBe(true);
  });

  test('a float order near 1 at z = −1 uses the kernel, not the eta identity', () => {
    // The identity multiplies 2^(1−s) − 1 ≈ 0 by ζ(s) ≈ ∞ and lost about
    // 12 of the 21 working digits here (−0.6931471810004).
    // mpmath: polylog(1.000000000001,-1) = -0.69314718056010519253
    const v = li(1.000000000001, -1).N();
    expect(Math.abs(v.re - -0.69314718056010519253)).toBeLessThan(1e-15);
  });

  test('a float order makes a closed-form result a float', () => {
    // `{ num: '0.0' }` is the float 0 (a JavaScript `0.0` is the integer 0).
    const v = li({ num: '0.0' }, ['Rational', 1, 2]).evaluate();
    expect(v.re).toBe(1);
    expect(isNumber(v) && v.isExact).toBe(false);
  });
});

describe('PolyLog declines rather than certify an unreliable widened value', () => {
  test('a large negative order near, but not at, z = −1 now answers, via the arbitrary-precision series', () => {
    // z = −1 exactly goes through the exact Dirichlet eta reduction below,
    // not this numeric kernel — z = −0.99 does not. This used to decline:
    // the double kernel's Euler transform (`seriesUnreliable`) conservatively
    // assumes itself unreliable past its linear bound here. At the default
    // engine precision (above machine, cortex-js/compute-engine#374),
    // `bigPolyLog`'s series answers directly and with a proven tail bound
    // instead, ahead of that double kernel.
    // mpmath: polylog(-1.5,-0.99) = -0.119558829589013870122988613502
    expect(li(-1.5, -0.99).N().re).toBeCloseTo(
      -0.119558829589013870122988613502,
      14
    );
  });

  test('a milder negative order at z = −1 answers exactly, via the Dirichlet eta reduction', () => {
    // z = −1 is an exact reduction for any order (see below), so this
    // does not exercise `seriesUnreliable` at all.
    // mpmath: polylog(-0.9,-1) = -0.276474007004826964393747323089
    expect(li(-0.9, -1).N().re).toBeCloseTo(-0.276474007004826964, 12);
  });

  test('close to the z = 1 branch point declines rather than trust the continuation there', () => {
    // The Hermite-integral continuation's cancellation grows faster than
    // its own `lost` guard catches within 1e−3 of the branch point (see
    // `nearBranchPointUnreliable`); z = 1 itself is unaffected (the exact
    // ζ(s) reduction above). The order 3.5 is far from an integer, so only
    // that guard applies.
    expect(li(3.5, 1.0001).N().numericValue).toBeUndefined();
  });

  test('just outside the branch-point guard the kernel answers', () => {
    // mpmath: polylog(2.5,0.999) = 1.3389476332802494862
    expect(li(2.5, 0.999).N().re).toBeCloseTo(1.3389476332802494862, 12);
  });

  test('a complex order next to a positive integer on the rim matches mpmath', () => {
    // mpmath: polylog(5+1e-6j, -0.86-0.51j) = -0.84520374989768012881 - 0.48601214735116938011j
    // (z from the doubles −0.86 and −0.51). Until the incomplete gamma fix
    // (#353) a guard declined every order within 0.05 of a positive integer
    // on or past the unit circle; the continuation is accurate here.
    const v = li(['Complex', 5, 1e-6], ['Complex', -0.86, -0.51]).N();
    expect(
      Math.hypot(v.re + 0.84520374989768012881, v.im + 0.48601214735116938011)
    ).toBeLessThan(1e-12);
  });

  test('an order next to a positive integer, with z on the cut, still declines', () => {
    // mpmath: polylog(3.000001,2) = 2.7620716611878396 - 0.75469285643604317j
    // The continuation needs Γ(1 − s, −log 2) next to a pole of Γ(1 − s)
    // with its argument on the negative real axis, where the incomplete
    // gamma kernel declines; the inversion formula declines within 1e-3 of
    // an integer order.
    expect(li(3.000001, 2).N().numericValue).toBeUndefined();
  });

  test('a negative order at a positive z answers (every term is positive)', () => {
    // mpmath: polylog(-3.5,0.5) = 60.53011239698513298
    expect(li(-3.5, 0.5).N().re).toBeCloseTo(60.53011239698513298, 11);
  });

  test('z = 1 itself is unaffected by the near-branch-point decline', () => {
    expect(li(4.98972, 1).N().re).toBeCloseTo(
      ce.expr(['Zeta', 4.98972]).N().re,
      10
    );
  });
});

describe('PolyLog result types', () => {
  test('a non-integer real order and real z < 1 type real', () => {
    expect(li(2.5, 0.5).type.matches('real')).toBe(true);
  });

  test('a real order and a real z > 1 is not typed real (the value is complex)', () => {
    // mpmath: polylog(1.5,2) = 1.5488677485243837586 - 2.9513292532712117788j
    expect(li(1.5, 2).type.matches('real')).toBe(false);
    expect(li(1.5, 2).N().im).toBeCloseTo(-2.9513292532712117788, 12);
  });

  test('a negative integer order is real on the whole real axis', () => {
    expect(li(-2, 5).type.matches('real')).toBe(true);
  });
});

describe('PolyLog JS compile', () => {
  ce.declare('pl_s', 'real');
  ce.declare('pl_z', 'real');
  const run = compile(ce.box(['PolyLog', 'pl_s', 'pl_z']))?.run;

  // The compiled lane (`polylogOrderReal`) answers the integer orders the
  // way the interpreter does. At z = −1 the interpreter uses the exact
  // Dirichlet eta identity and the compiled lane the Euler transform, so
  // the two agree to the 1e−9 tolerance below rather than bit for bit.
  function expectParity(got: unknown, s: number, z: number) {
    const n = li(s, z).N();
    // Every row has a numeric interpreter value, so a NaN from both sides
    // cannot pass as agreement.
    expect(isNumber(n)).toBe(true);
    if (n.im !== 0) expect(got).toBeNaN();
    else
      expect(Math.abs((got as number) - n.re)).toBeLessThan(
        1e-9 * Math.max(1, Math.abs(n.re))
      );
  }

  test.each([
    [2, 0.5],
    [2.5, 0.5],
    [3.2, 0.25],
    [-2.5, -0.5],
    [-0.9, -1],
    [2.5, -0.5],
    // Integer orders: the closed forms and the dedicated kernel.
    [3, -2],
    [2, -3],
    [1, -3],
    [-6, 0],
    [2, 0.99],
    [-3, -5],
    // Below z = −1, through the inversion formula.
    [1.5, -3],
    [0.5, -5],
  ])('PolyLog(%p, %p)', (s, z) => {
    expectParity(run?.({ pl_s: s, pl_z: z }), s, z);
  });

  test('the poles at z = 1 of the orders 1, 0 and −1 are Infinity', () => {
    expect(run?.({ pl_s: 1, pl_z: 1 })).toBe(Infinity);
    expect(run?.({ pl_s: 0, pl_z: 1 })).toBe(Infinity);
    expect(run?.({ pl_s: -1, pl_z: 1 })).toBe(Infinity);
  });

  test('a complex value on the cut z > 1 is NaN in the real-only compiled lane', () => {
    expect(run?.({ pl_s: 2.5, pl_z: 3 })).toBeNaN();
    expect(run?.({ pl_s: 2, pl_z: 3 })).toBeNaN();
  });
});

describe('GPU PolyLog preamble', () => {
  ce.declare('gl_s', 'real');
  ce.declare('gl_z', 'real');
  const targets = [
    ['GLSL', new GLSLTarget(), 'float _gpu_lerch_phi('],
    ['WGSL', new WGSLTarget(), 'fn _gpu_lerch_phi('],
  ] as const;

  test.each(targets)(
    '%s: PolyLog(s,z) pulls in the Lerch transcendent helper it reuses',
    (_name, target, lerchDecl) => {
      const r = target.compile(ce.box(['PolyLog', 'gl_s', 'gl_z']));
      expect(r.success).toBe(true);
      expect(r.preamble ?? '').toContain(lerchDecl);
    }
  );

  test('PolyLog lowers to the _gpu_poly_log helper', () => {
    const r = new GLSLTarget().compile(ce.box(['PolyLog', 'gl_s', 'gl_z']));
    expect(r.code).toBe('_gpu_poly_log(gl_s, gl_z)');
  });
});
