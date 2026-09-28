/**
 * `PolyLog(s, z)` widened to a non-integer or complex order s
 * (cortex-js/compute-engine#340). Native `PolyLog` already evaluates an
 * integer order ≥ 2 (unchanged here) and the elementary/ζ exact
 * reductions in `library/special-functions.ts`'s `polylogReduce`
 * (unchanged here); `evaluatePolyLog`'s new branch widens everything
 * else via `numerics/polylog.ts`'s `Liₛ(z) = z·Φ(z,s,1)`, reusing the
 * Lerch transcendent kernel (`numerics/lerch-phi.ts`). Reference values
 * below are cross-checked against mpmath's `polylog` at 30 digits; the
 * comment on each case carries the value mpmath reports.
 */

import { ComputeEngine } from '../../src/compute-engine';
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

describe('PolyLog declines rather than certify an unreliable widened value', () => {
  test('a large negative order near, but not at, z = −1 (van Wijngaarden Euler transform) declines', () => {
    // z = −1 exactly goes through the exact Dirichlet eta reduction below,
    // not this numeric kernel — z = −0.99 does not. mpmath:
    // polylog(-1.5,-0.99) = -0.119558829589013870122988613502, but the
    // Euler transform's own accuracy there (see `seriesUnreliable`) is
    // conservatively assumed unreliable past its linear bound.
    expect(li(-1.5, -0.99).N().numericValue).toBeUndefined();
  });

  test('a milder negative order at z = −1 answers exactly, via the Dirichlet eta reduction', () => {
    // z = −1 is an exact reduction for any order (see below), so this
    // does not exercise `seriesUnreliable` at all.
    // mpmath: polylog(-0.9,-1) = -0.276474007004826964393747323089
    expect(li(-0.9, -1).N().re).toBeCloseTo(-0.276474007004826964, 12);
  });

  test('close to the z = 1 branch point declines rather than trust the continuation there', () => {
    // The Hermite-integral continuation's cancellation widens faster than
    // its own `lost` guard catches this close to the branch point (see
    // `nearBranchPointUnreliable`); z = 1 itself is unaffected (the exact
    // ζ(s) reduction above).
    expect(li(4.98972, 1.001).N().numericValue).toBeUndefined();
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
    const t = li(2.5, 0.5).type;
    expect(t.matches('number')).toBe(true);
  });
});

describe('PolyLog JS compile', () => {
  ce.declare('pl_s', 'real');
  ce.declare('pl_z', 'real');
  const run = compile(ce.box(['PolyLog', 'pl_s', 'pl_z']))?.run;

  // z = ±1 go through `polylogReduce`'s exact `Zeta`-based reduction under
  // `evaluate()`/`N()`, a different (more accurate) route than the
  // compiled lane's direct kernel call, so parity is not expected there —
  // excluded here the same way `lerch-phi-values.test.ts` excludes z = 1.
  function expectParity(got: unknown, s: number, z: number) {
    const n = li(s, z).N();
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
  ])('PolyLog(%p, %p)', (s, z) => {
    expectParity(run?.({ pl_s: s, pl_z: z }), s, z);
  });

  test('past |z| = 1 the real-only compiled lane is NaN (no GPU/JS incomplete-Γ kernel)', () => {
    expect(run?.({ pl_s: 2.5, pl_z: 3 })).toBeNaN();
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
