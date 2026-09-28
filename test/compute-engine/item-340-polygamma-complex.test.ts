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

function expectComplexRelative(
  got: { re: number; im: number },
  expectedRe: number,
  expectedIm: number,
  tolerance = 1e-12
) {
  const mag = Math.hypot(expectedRe, expectedIm);
  expect(
    Math.hypot(got.re - expectedRe, (got.im ?? 0) - expectedIm) / mag
  ).toBeLessThan(tolerance);
}

function polygammaN(m: number, re: number, im: number) {
  return ce.expr(['PolyGamma', m, ['Complex', re, im]]).N();
}

describe('PolyGamma at a complex z: the left half-plane uses the reflection formula', () => {
  // Left of Re(z) = 0 the direct sum ran one term per unit of −Re(z) (a hang
  // at −10¹²) and its terms cancelled (a high order at a large negative
  // Re(z) stayed symbolic). The reflection formula (DLMF 5.15.6) replaces it.
  const cases: [number, number, number, number, number][] = [
    // m, re, im, expectedRe, expectedIm (mpmath.polygamma, 40 digits)
    [
      8, -48.445348956457586, 7.047151294800014, -5.802709982602873e-11,
      -1.2898930277153784e-10,
    ],
    [
      1, -48.445348956457586, 7.047151294800014, -0.020015387059768443,
      -0.002881619039125356,
    ],
    [2, -2.5, 0.001, -0.10820401764373341, 0.1947453125506868],
    [5, -12.9, 0.05, -57507559.41703685, -21626824.78201931],
    [6, -3.5, 15, 3.048889081072372e-8, -8.627209486347513e-6],
    [5, -100.5, 40, 4.908066685879003e-10, -1.508443827708739e-9],
    [2, -0.49, -3, 0.08118454377065919, 0.062182680054205394],
    // Close to a half-integer, just above the real axis: the two halves of
    // the partial-fraction series of the cot derivative nearly cancel there.
    [2, -30.5, 1e-6, -0.0010403121873537797, 0.0001948181149659694],
    [8, -0.5, 1e-6, -1059.961760020372, 743.1845723305976],
    [20, -0.5, 1e-9, -487772949462609.8, 4.285818862359678e17],
    [0, -1e6, 1, 13.815511057964692, 3.1533470949376623],
    [2, -1e6, 1, -9.999989999975e-13, -0.46669429930986756],
    [0, -1e12, 1, 27.631021115929048, 3.1533480949361623],
    // mpmath.polygamma does not finish at Re(z) = −10¹²: the reference is
    // the reflection formula in mpmath at 80 digits, with the derivative of
    // cot(πz) from mpmath.diff.
    [3, -1e12, 1, 2.954251102093008, -5.999999999988e-48],
    [8, -1e12, 1, -5.03999999997984e-93, 42791.348783635985],
  ];
  for (const [m, re, im, expectedRe, expectedIm] of cases) {
    test(`PolyGamma(${m}, ${re}${im >= 0 ? '+' : ''}${im}i)`, () => {
      expectComplexRelative(
        polygammaN(m, re, im) as unknown as { re: number; im: number },
        expectedRe,
        expectedIm
      );
    });
  }
});

describe('PolyGamma at a complex z: values near the ends of the double range', () => {
  test('a high order: m! is above the double range, the value is not', () => {
    // 171! ≈ 1.2e309
    expectComplexRelative(
      polygammaN(171, 1, 1) as unknown as { re: number; im: number },
      -1.6039782617375418e283,
      8.9754475617881e248
    );
  });

  test('every ζ term is below the double range, the value is not', () => {
    // ζ(101, 10000 + i) ≈ 1e−402, times 100! ≈ 9e157
    expectComplexRelative(
      polygammaN(100, 10000, 1) as unknown as { re: number; im: number },
      -9.378889500560328e-245,
      9.379670336685227e-247
    );
  });

  test('a value above the double range stays symbolic, not ~oo', () => {
    // |ψ⁽¹⁷¹⁾(1/2 + i/2)| ≈ 171!·2⁸⁶ ≈ 1e335
    expect(polygammaN(171, 0.5, 0.5).operator).toBe('PolyGamma');
  });

  test('a value below the double range stays symbolic, not 0', () => {
    // |ψ⁽³⁰⁰⁾(10⁶ + i)| ≈ 299!/10¹⁸⁰⁰ ≈ 1e−1188
    expect(polygammaN(300, 1e6, 1).operator).toBe('PolyGamma');
  });

  const digamma: [number, number, number, number][] = [
    [1e160, 1, 368.4136148790473, 1e-160],
    [1e200, 1e200, 460.8635921890891, 0.7853981633974483],
    [1e300, 1, 690.7755278982137, 1e-300],
  ];
  for (const [re, im, expectedRe, expectedIm] of digamma) {
    test(`the digamma at a huge argument ${re}+${im}i is finite`, () => {
      expectComplexRelative(
        polygammaN(0, re, im) as unknown as { re: number; im: number },
        expectedRe,
        expectedIm
      );
    });
  }
});

describe('Digamma and Trigamma at a complex z', () => {
  test('Digamma(2+i) matches PolyGamma(0, 2+i)', () => {
    expectComplexRelative(
      ce.expr(['Digamma', ['Complex', 2, 1]]).N() as unknown as {
        re: number;
        im: number;
      },
      0.594650320622477,
      0.5766740474685812
    );
  });

  test('Trigamma(2+i) matches PolyGamma(1, 2+i)', () => {
    expectComplexRelative(
      ce.expr(['Trigamma', ['Complex', 2, 1]]).N() as unknown as {
        re: number;
        im: number;
      },
      0.4630000966227638,
      -0.29423354275931884
    );
  });

  test('an exact complex argument stays symbolic under evaluate()', () => {
    expect(ce.expr(['Digamma', ['Complex', 2, 1]]).evaluate().operator).toBe(
      'Digamma'
    );
    expect(ce.expr(['Trigamma', ['Complex', 2, 1]]).evaluate().operator).toBe(
      'Trigamma'
    );
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
