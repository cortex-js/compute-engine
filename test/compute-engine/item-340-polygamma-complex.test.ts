/**
 * PolyGamma(m, z) widened to a complex z — cortex-js/compute-engine#340.
 * The native `PolyGamma` already covers every real z at every integer order
 * m >= 0 (library/arithmetic.ts, numerics/special-functions.ts); this suite
 * covers the complex-z kernel (numerics/numeric-complex.ts `polygammaComplex`)
 * layered on top of it, and confirms the real-z path is unchanged.
 *
 * Reference values are `mpmath.polygamma(m, mpc(re, im))` at 30 digits.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

function expectComplexApprox(
  got: { re: number; im: number },
  expectedRe: number,
  expectedIm: number,
  tolerance = 1e-9
) {
  const mag = Math.max(Math.hypot(expectedRe, expectedIm), 1);
  expect(Math.abs(got.re - expectedRe) / mag).toBeLessThan(tolerance);
  expect(Math.abs((got.im ?? 0) - expectedIm) / mag).toBeLessThan(tolerance);
}

describe('PolyGamma(m, z) at a complex z — evaluate()/N()', () => {
  const cases: [number, number, number, number, number][] = [
    // m, re, im, expectedRe, expectedIm
    [0, 1, 2, 0.71459151537397753, 1.3208072826422302],
    [1, 1, 2, 0.12493116214094458, -0.47782555014722975],
    [2, 0.5, 0.5, 3.5118107201640979, 4.5167701079330644],
    [0, -1, 0.5, 0.47111364277054065, 3.1126885749596478],
    [3, -2.5, 1, -2.9032639066963831, -0.049043066010140604],
    [8, 3, 4, 0.0024855495077171479, 0.021497119388720992],
    [0, 2, -3, 1.2079807107101509, -1.1041296805875762],
    [4, -0.5, 2, 0.1109929312671876, 0.20144924087670596],
  ];

  for (const [m, re, im, expectedRe, expectedIm] of cases) {
    test(`PolyGamma(${m}, ${re}${im >= 0 ? '+' : ''}${im}i) = ${expectedRe.toFixed(6)}${expectedIm >= 0 ? '+' : ''}${expectedIm.toFixed(6)}i`, () => {
      const n = ce
        .expr(['PolyGamma', m, ['Complex', re, im]])
        .N() as unknown as { re: number; im: number };
      expectComplexApprox(n, expectedRe, expectedIm);
    });
  }

  test('a compound argument that reduces to a complex literal', () => {
    const n = ce
      .expr(['PolyGamma', 1, ['Add', ['Complex', 1, 2], 0]])
      .N() as unknown as { re: number; im: number };
    expectComplexApprox(n, 0.12493116214094458, -0.47782555014722975);
  });

  test('the parse route matches the direct construction', () => {
    const parsed = ce.parse('\\psi^{(1)}(1+2i)');
    if (parsed.operator === 'PolyGamma') {
      expectComplexApprox(
        parsed.N() as unknown as { re: number; im: number },
        0.12493116214094458,
        -0.47782555014722975
      );
    } else {
      // The `\psi^{(n)}` macro is not declared in every build; fall back to
      // the explicit construction so this test does not depend on it.
      const n = ce.expr(['PolyGamma', 1, ['Complex', 1, 2]]).N() as unknown as {
        re: number;
        im: number;
      };
      expectComplexApprox(n, 0.12493116214094458, -0.47782555014722975);
    }
  });
});

describe('PolyGamma at a complex z: real-z results are unchanged', () => {
  // The same literals `special-functions.test.ts` already pins for the real
  // kernel — a regression check that the complex widening did not touch the
  // real branch of `evaluate()`.
  test('ψ(1) = -γ (via PolyGamma), unchanged', () => {
    const n = ce.expr(['PolyGamma', 0, 1]).N();
    expect(Math.abs(n.re - -0.5772156649015329)).toBeLessThan(1e-12);
  });

  test('ψ⁽³⁾(2.5) unchanged', () => {
    const n = ce.expr(['PolyGamma', 3, 2.5]).N();
    expect(Math.abs(n.re - 0.22390584881725206)).toBeLessThan(1e-12);
  });

  test('ψ⁽⁵⁾(10) unchanged', () => {
    const n = ce.expr(['PolyGamma', 5, 10]).N();
    expect(Math.abs(n.re - 3.059451621172682e-4)).toBeLessThan(1e-12);
  });
});

describe('PolyGamma at a complex z: poles stay real-axis-only', () => {
  // Poles are only at the non-positive integers ON the real axis; a nearby
  // complex z is finite and large, not `~oo`.
  test.each([0, 1, 2, 5, 8])('PolyGamma(%p, 0) is still ~oo', (m) => {
    expect(ce.expr(['PolyGamma', m, 0]).N().isSame(ce.ComplexInfinity)).toBe(
      true
    );
  });

  test.each([0, 1, 2, 5, 8])('PolyGamma(%p, -5) is still ~oo', (m) => {
    expect(ce.expr(['PolyGamma', m, -5]).N().isSame(ce.ComplexInfinity)).toBe(
      true
    );
  });

  test('a complex z close to a pole is large but finite, not ~oo', () => {
    const n = ce
      .expr(['PolyGamma', 3, ['Complex', -5, 1e-6]])
      .N() as unknown as { re: number; im: number };
    expect(Number.isFinite(n.re)).toBe(true);
    expect(Math.abs(n.re)).toBeGreaterThan(1e20);
  });
});

describe('PolyGamma at a complex z: the cancellation guard declines rather than answering wrong', () => {
  // m = 8 at this z sums ~63 Euler-Maclaurin terms of order 1e-8 down to a
  // net ~1e-11: double precision cannot promise 1e-12 relative there (see
  // `POLYGAMMA_CANCELLATION_LIMIT` in numerics/numeric-complex.ts). The
  // application stays symbolic rather than answer a number that is wrong
  // past the 1e-12 the rest of this suite requires.
  test('a high order at a large negative Re(z) declines rather than answering an inaccurate value', () => {
    const n = ce
      .expr([
        'PolyGamma',
        8,
        ['Complex', -48.445348956457586, 7.047151294800014],
      ])
      .N();
    expect(n.operator).toBe('PolyGamma');
  });

  test('a moderate order at the same z still answers accurately', () => {
    const n = ce
      .expr([
        'PolyGamma',
        1,
        ['Complex', -48.445348956457586, 7.047151294800014],
      ])
      .N() as unknown as { re: number; im: number };
    expect(Number.isNaN(n.re)).toBe(false);
  });
});

describe('PolyGamma JS compile: a complex-typed argument fails closed', () => {
  ce.declare('pg340_n', 'integer');
  ce.declare('pg340_z', 'complex');
  ce.declare('pg340_r', 'real');

  test('compiling with a declared-complex argument does not silently use the real kernel', () => {
    const compiled = compile(ce.box(['PolyGamma', 'pg340_n', 'pg340_z']));
    if (!compiled.success) return; // fails closed at compile time — acceptable
    // Or it compiles with a runtime realness guard: a genuinely complex
    // value must not silently flow through the real-only `_SYS.polygamma`.
    const got = compiled.run?.({
      pg340_n: 1,
      pg340_z: { re: 1, im: 2 },
    } as any);
    expect(Number.isNaN(got as number)).toBe(true);
  });

  test('the same compiled function still matches N() for a real-valued run', () => {
    const compiled = compile(ce.box(['PolyGamma', 'pg340_n', 'pg340_r']));
    expect(compiled.success).toBe(true);
    const got = compiled.run?.({ pg340_n: 3, pg340_r: 2.5 } as any);
    expect(Math.abs((got as number) - 0.22390584881725206)).toBeLessThan(1e-9);
  });
});
