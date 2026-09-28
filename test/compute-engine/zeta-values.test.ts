/**
 * Exact values of the Riemann zeta function at integer literals
 * (library/arithmetic.ts `Zeta` exact evaluate path, backed by exact
 * bigint-rational Bernoulli numbers in numerics/bernoulli.ts), plus the
 * curated symbolic trivial-zero rule `fungrim:zeta-trivial-zeros`
 * (Zeta(−2n) → 0 for positive integer n).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { loadIdentities } from '../../src/identities';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { zeta as zetaReal } from '../../src/compute-engine/numerics/special-functions';
import {
  bernoulliRational,
  zetaEvenCoefficient,
  zetaNegativeInteger,
} from '../../src/compute-engine/numerics/bernoulli';

const ce = new ComputeEngine();

function zeta(s: number) {
  return ce.expr(['Zeta', s]).evaluate();
}

describe('Bernoulli rationals (numerics/bernoulli.ts)', () => {
  test('B_0 … B_12 match the known table', () => {
    expect(bernoulliRational(0)).toEqual([1n, 1n]);
    expect(bernoulliRational(1)).toEqual([-1n, 2n]);
    expect(bernoulliRational(2)).toEqual([1n, 6n]);
    expect(bernoulliRational(3)).toEqual([0n, 1n]);
    expect(bernoulliRational(4)).toEqual([-1n, 30n]);
    expect(bernoulliRational(6)).toEqual([1n, 42n]);
    expect(bernoulliRational(8)).toEqual([-1n, 30n]);
    expect(bernoulliRational(10)).toEqual([5n, 66n]);
    expect(bernoulliRational(12)).toEqual([-691n, 2730n]);
  });

  test('zetaEvenCoefficient: ζ(2k)/π^{2k} for k = 1…4', () => {
    expect(zetaEvenCoefficient(1)).toEqual([1n, 6n]);
    expect(zetaEvenCoefficient(2)).toEqual([1n, 90n]);
    expect(zetaEvenCoefficient(3)).toEqual([1n, 945n]);
    expect(zetaEvenCoefficient(4)).toEqual([1n, 9450n]);
  });

  test('zetaNegativeInteger: ζ(−n) for small n', () => {
    expect(zetaNegativeInteger(1)).toEqual([-1n, 12n]);
    expect(zetaNegativeInteger(2)).toEqual([0n, 1n]);
    expect(zetaNegativeInteger(3)).toEqual([1n, 120n]);
    expect(zetaNegativeInteger(4)).toEqual([0n, 1n]);
    expect(zetaNegativeInteger(5)).toEqual([-1n, 252n]);
  });
});

describe('Zeta at positive even integers: exact rational × π^{2k}', () => {
  test('ζ(2) = π²/6', () => {
    expect(zeta(2).isSame(ce.number([1, 6]).mul(ce.Pi.pow(2)))).toBe(true);
  });

  test('ζ(4) = π⁴/90', () => {
    expect(zeta(4).isSame(ce.number([1, 90]).mul(ce.Pi.pow(4)))).toBe(true);
  });

  test('ζ(6) = π⁶/945', () => {
    expect(zeta(6).isSame(ce.number([1, 945]).mul(ce.Pi.pow(6)))).toBe(true);
  });

  test('ζ(8) = π⁸/9450', () => {
    expect(zeta(8).isSame(ce.number([1, 9450]).mul(ce.Pi.pow(8)))).toBe(true);
  });
});

describe('Zeta at non-positive integers: exact rationals', () => {
  test('ζ(0) = −1/2', () => {
    expect(zeta(0).isSame(ce.number([-1, 2]))).toBe(true);
  });

  test('ζ(1) = ComplexInfinity (pole)', () => {
    expect(zeta(1).isSame(ce.ComplexInfinity)).toBe(true);
  });

  test('ζ(−1) = −1/12', () => {
    expect(zeta(-1).isSame(ce.number([-1, 12]))).toBe(true);
  });

  test('ζ(−3) = 1/120', () => {
    expect(zeta(-3).isSame(ce.number([1, 120]))).toBe(true);
  });

  test('ζ(−5) = −1/252', () => {
    expect(zeta(-5).isSame(ce.number([-1, 252]))).toBe(true);
  });

  test('trivial zeros: ζ(−2k) = 0 for literal even negatives', () => {
    for (const s of [-2, -4, -6, -8, -100])
      expect(zeta(s).isSame(0)).toBe(true);
  });
});

describe('Zeta at odd positive integers: stays symbolic in exact mode', () => {
  test('ζ(3), ζ(5), ζ(7) do not evaluate exactly', () => {
    for (const s of [3, 5, 7]) {
      const r = zeta(s);
      expect(r.operator).toBe('Zeta');
      expect(r.json).toEqual(['Zeta', s]);
    }
  });

  test('ζ(3) still evaluates numerically (Apéry constant)', () => {
    // The machine-precision zeta is accurate to ~1e-9 here (same tolerance
    // as the existing special-functions.test.ts Apéry test)
    expect(zeta(3).N().re).toBeCloseTo(1.2020569031595942, 7);
  });
});

describe('Zeta exact-path size cap (|s| ≤ 100)', () => {
  test('ζ(100) is exact (at the cap)', () => {
    const r = zeta(100);
    expect(r.operator).toBe('Multiply');
    expect(r.has('Pi')).toBe(true);
  });

  test('ζ(102) and ζ(−101) stay symbolic in exact mode', () => {
    expect(zeta(102).json).toEqual(['Zeta', 102]);
    expect(zeta(-101).json).toEqual(['Zeta', -101]);
  });

  test('beyond the cap, the numeric path still works', () => {
    expect(zeta(102).N().re).toBeCloseTo(1, 10);
  });
});

describe('Zeta N() consistency', () => {
  test('ζ(4).N() ≈ π⁴/90', () => {
    expect(zeta(4).N().re).toBeCloseTo(Math.PI ** 4 / 90, 10);
  });

  test('ζ(−1).N() ≈ −1/12', () => {
    expect(zeta(-1).N().re).toBeCloseTo(-1 / 12, 10);
  });

  test('non-integer arguments are untouched by the exact path', () => {
    expect(ce.expr(['Zeta', 2.5]).N().re).toBeCloseTo(1.3414872572509171, 8);
  });
});

describe('Symbolic trivial zeros (fungrim:zeta-trivial-zeros)', () => {
  test('with loadIdentities and n a positive integer, Zeta(−2n) simplifies to 0', () => {
    const ce2 = new ComputeEngine();
    loadIdentities(ce2);
    ce2.declare('n', 'integer');
    ce2.assume(ce2.expr(['Greater', 'n', 0]));
    expect(
      ce2
        .expr(['Zeta', ['Multiply', -2, 'n']])
        .simplify()
        .isSame(0)
    ).toBe(true);
  });

  test('without the positivity guard, Zeta(−2m) stays symbolic', () => {
    const ce2 = new ComputeEngine();
    loadIdentities(ce2);
    ce2.declare('m', 'integer');
    const r = ce2.expr(['Zeta', ['Multiply', -2, 'm']]).simplify();
    expect(r.operator).toBe('Zeta');
  });
});

describe('An exact rational within a double of an integer is not that integer', () => {
  // `asSmallInteger` (`boxed-expression/numerics.ts`) read the double
  // projection of an exact rational, so `(10^30 + 1)/10^30` counted as the
  // integer 1 and `Zeta` of it took the pole branch and answered `~oo`.
  test('Zeta(1 + 10^-30) is not the pole', () => {
    const ce = new ComputeEngine();
    const z = ce.box(['Zeta', ['Add', 1, ['Power', 10, -30]]]).evaluate();
    expect(z.symbol).not.toBe('ComplexInfinity');
    expect(z.operator).toBe('Zeta');
    // Its numeric value is about 1/ε + γ = 10^30 + 0.577…
    const n = ce.box(['Zeta', ['Add', 1, ['Power', 10, -30]]]).N().re;
    expect(Math.abs(n - 1e30) / 1e30).toBeLessThan(1e-12);
    expect(ce.box(['Zeta', 1]).evaluate().json).toBe('ComplexInfinity');
  });
});

describe('Zeta at complex s', () => {
  test('ζ(0.5 + 14i) matches the mpmath reference value', () => {
    // mpmath: zeta(0.5+14j) = 0.0222411 − 0.1032581j
    const z = ce.expr(['Zeta', ['Complex', 0.5, 14]]).N();
    expect(z.re).toBeCloseTo(0.0222411, 6);
    expect(z.im).toBeCloseTo(-0.1032581, 6);
  });

  test('a negative-real-part complex argument agrees with the real ζ on the real axis', () => {
    // Re(s) < 0 goes through the functional equation on both the real
    // (`zeta`) and complex (`zetaComplex`) kernels — two independent
    // implementations of the same reduction, cross-checked here.
    const z = ce.expr(['Zeta', ['Complex', -10.5, 0]]).N();
    expect(z.im).toBeCloseTo(0, 10);
    expect(z.re).toBeCloseTo(zetaReal(-10.5), 10);
  });

  test('a complex pole is still ~oo, not a finite complex NaN', () => {
    expect(
      ce
        .expr(['Zeta', ['Complex', 1, 0]])
        .evaluate()
        .isSame(ce.ComplexInfinity)
    ).toBe(true);
  });
});

describe('Two-argument Zeta (Hurwitz) and HurwitzZeta', () => {
  test('ζ(s,1) = ζ(s)', () => {
    expect(
      ce
        .expr(['Zeta', 4, 1])
        .evaluate()
        .isSame(ce.expr(['Zeta', 4]).evaluate())
    ).toBe(true);
    expect(ce.expr(['Zeta', 4, 1]).N().re).toBeCloseTo(Math.PI ** 4 / 90, 10);
  });

  test('ζ(2, 1/3) matches a direct summation of the defining series', () => {
    let sum = 0;
    for (let k = 0; k < 2_000_000; k++) sum += (1 / 3 + k) ** -2;
    expect(ce.expr(['Zeta', 2, ['Rational', 1, 3]]).N().re).toBeCloseTo(sum, 5);
  });

  test('ζ(0.5 + 14i, 1/3) is complex and finite', () => {
    const z = ce.expr(['Zeta', ['Complex', 0.5, 14], ['Rational', 1, 3]]).N();
    expect(Number.isFinite(z.re)).toBe(true);
    expect(Number.isFinite(z.im)).toBe(true);
  });

  test('ζ(−n, a) = −Bₙ₊₁(a)/(n+1): exact rational at a rational base point', () => {
    // B_2(1/3) = 1/9 − 1/3 + 1/6 = −1/18, so ζ(−1, 1/3) = −B_2(1/3)/2 = 1/36.
    expect(
      ce
        .expr(['Zeta', -1, ['Rational', 1, 3]])
        .evaluate()
        .isSame(ce.number([1, 36]))
    ).toBe(true);
    expect(
      ce
        .expr(['HurwitzZeta', -1, ['Rational', 1, 3]])
        .evaluate()
        .isSame(ce.number([1, 36]))
    ).toBe(true);
  });

  test('ζ(1, a) is the pole for every base point a', () => {
    expect(
      ce
        .expr(['Zeta', 1, ['Rational', 1, 3]])
        .evaluate()
        .isSame(ce.ComplexInfinity)
    ).toBe(true);
    expect(
      ce.expr(['HurwitzZeta', 1, 2]).evaluate().isSame(ce.ComplexInfinity)
    ).toBe(true);
  });

  test('HurwitzZeta(s,a) agrees with the two-argument Zeta(s,a)', () => {
    expect(ce.expr(['HurwitzZeta', 3, ['Rational', 1, 4]]).N().re).toBeCloseTo(
      ce.expr(['Zeta', 3, ['Rational', 1, 4]]).N().re,
      10
    );
  });
});

describe('Zeta / HurwitzZeta JS compile', () => {
  test('a runtime one-argument Zeta matches the interpreted value', () => {
    ce.declare('cz_x', 'real');
    const run = compile(ce.box(['Zeta', 'cz_x']))?.run;
    expect(run?.({ cz_x: 2 })).toBeCloseTo(Math.PI ** 2 / 6, 10);
    // Re(s) < 0: the compiled kernel must take the functional-equation
    // branch, not the direct (cancellation-prone) Euler-Maclaurin series.
    expect(run?.({ cz_x: -10.5 })).toBeCloseTo(zetaReal(-10.5), 8);
  });

  test('a runtime two-argument Zeta and HurwitzZeta match the interpreted value', () => {
    ce.declare('cz_s', 'real');
    ce.declare('cz_a', 'real');
    const runZeta = compile(ce.box(['Zeta', 'cz_s', 'cz_a']))?.run;
    const runHZ = compile(ce.box(['HurwitzZeta', 'cz_s', 'cz_a']))?.run;
    const expected = ce.expr(['Zeta', 2, ['Rational', 1, 3]]).N().re;
    expect(runZeta?.({ cz_s: 2, cz_a: 1 / 3 })).toBeCloseTo(expected, 8);
    expect(runHZ?.({ cz_s: 2, cz_a: 1 / 3 })).toBeCloseTo(expected, 8);
  });
});

describe('Two-argument Zeta/HurwitzZeta precision at Re(s) << 0, a != 1', () => {
  // A naive Euler-Maclaurin at a very negative Re(s) cancels heavily when
  // a != 1; hurwitzZetaComplex instead shifts a and expands ζ(s,1+h) as a
  // Taylor series of Riemann zetas (each reflected to Re >= 0), avoiding it.
  test('HurwitzZeta(-20.5, 0.25) matches mpmath to ~1e-13 relative', () => {
    const z = ce.expr(['HurwitzZeta', -20.5, 0.25]).N();
    expect(z.im).toBeCloseTo(0, 8);
    expect(Math.abs(z.re / 108.21747504680551109 - 1)).toBeLessThan(1e-13);
  });

  test('HurwitzZeta(-8.5, 0.3) matches mpmath to ~1e-13 relative', () => {
    const z = ce.expr(['HurwitzZeta', -8.5, 0.3]).N();
    expect(Math.abs(z.re / 0.005557849602182534 - 1)).toBeLessThan(1e-13);
  });

  test('HurwitzZeta(-2.5+i, 1/3) matches mpmath to ~1e-11 relative', () => {
    const z = ce
      .expr(['HurwitzZeta', ['Complex', -2.5, 1], ['Rational', 1, 3]])
      .N();
    expect(Math.abs(z.re / -0.014434340959835304646 - 1)).toBeLessThan(1e-11);
    expect(Math.abs(z.im / -0.017476965783826936444 - 1)).toBeLessThan(1e-11);
  });
});

/** Run `fn` at the working precision `precision`, then restore it. */
function atPrecision<T>(precision: number, fn: () => T): T {
  const saved = ce.precision;
  try {
    ce.precision = precision;
    return fn();
  } finally {
    ce.precision = saved;
  }
}

describe('Two-argument Zeta/HurwitzZeta beyond double precision (bigHurwitzZeta / bigZetaGeneralized)', () => {
  // Real s and a follow `ce.precision`, the way the one-operand `Zeta`
  // already does via `bigZeta`; a complex operand stays on the double
  // `hurwitzZetaComplex` kernel above. Every expected value was computed
  // independently with Python mpmath at dps 90, then rounded to the
  // working precision (`mpmath.nstr(x, precision)`) — comfortably more
  // digits than any case here needs, since mpmath's own Hurwitz zeta is
  // not always accurate to its nominal `dps` at extreme arguments (e.g.
  // `zeta(20, 10)` at dps 60 first disagrees with its dps-100 value around
  // digit 48).
  const cases: [
    op: 'HurwitzZeta' | 'Zeta',
    s: number,
    a: number | [number, number],
    precision: number,
    expected: string,
  ][] = [
    // Positive integer a past `HURWITZ_PEEL_LIMIT`'s exact route (N()
    // always numericizes, so this is the kernel, not the peel rewrite).
    ['HurwitzZeta', 3, [1, 2], 30, '8.41439832211715999779816713058'],
    [
      'HurwitzZeta',
      3,
      [1, 2],
      50,
      '8.4143983221171599977981671305801499353549040463835',
    ],
    // Re(s) << 0: the direct Euler-Maclaurin terms cancel heavily: the
    // working precision is raised by the digits the cancellation costs
    // (`hurwitzZetaBigPlan`'s `largest`) rather than reflected, since
    // a != 1 has no single reflection point the way ζ(s) = ζ(s,1) does.
    ['HurwitzZeta', -20.5, [1, 4], 30, '108.217475046805511094674035008'],
    [
      'HurwitzZeta',
      -20.5,
      [1, 4],
      50,
      '108.21747504680551109467403500768857532969106471109',
    ],
    // a < 0, real only because s is an integer (a term (k+a)^{-s} with
    // k+a < 0 is complex for a non-integer s).
    ['HurwitzZeta', 6, [-5, 2], 30, '128.184500400219198408324643294'],
    // Zeta(s,a), a <= 0: the generalized (always-finite) convention —
    // terms off the positive axis are |k+a|^{-s}, real for any real s.
    [
      'Zeta',
      4,
      [-7, 2],
      50,
      '32.464643259910417981002559240261738285452281190459',
    ],
    ['Zeta', 5, [-5, 2], 30, '64.2866876522428216257373506563'],
    [
      'Zeta',
      5,
      [-5, 2],
      50,
      '64.286687652242821625737350656299746452567862414024',
    ],
    ['Zeta', 2.5, -6, 50, '2.642892756568173658272776649181863820806977067801'],
    // Large s, tiny result: `bigHurwitzZeta`'s two-attempt widening
    // (`short`) catches a result smaller than 1 having fewer correct
    // significant digits than the first pass carried.
    [
      'HurwitzZeta',
      20,
      10,
      50,
      '1.18160477582516795534661414027181923713723074538e-20',
    ],
  ];

  for (const [op, s, a, precision, expected] of cases) {
    const aExpr = Array.isArray(a) ? ['Rational', a[0], a[1]] : a;
    test(`${op}(${s}, ${JSON.stringify(a)}) at precision ${precision} = ${expected}`, () => {
      // The value's displayed digit count follows the *current* engine
      // precision, not just the precision it was computed at: `toString()`
      // must run inside `atPrecision`, before it restores.
      atPrecision(precision, () => {
        expect(ce.box([op, s, aExpr]).N().toString()).toBe(expected);
      });
    });
  }

  test('the bignum kernel returns more digits than the double kernel carries', () => {
    atPrecision(50, () => {
      const z = ce.expr(['HurwitzZeta', 3, ['Rational', 1, 2]]).N();
      expect(z.toString().replace(/[-.]/g, '').length).toBeGreaterThan(30);
    });
  });
});

describe('HurwitzZeta vs Zeta at a <= 0 (Wolfram distinguishes the two)', () => {
  // Zeta[s,a] drops the (k+a) = 0 term and stays real there; HurwitzZeta[s,a]
  // (mpmath's zeta(s,a)) is the plain series and is genuinely complex at a
  // non-positive, non-integer a — arithmetic.ts must route each convention
  // through its own kernel rather than reusing one for both.
  test('Zeta(0.5, -2.5) is real, matching the Wolfram Zeta[s,a] convention', () => {
    const z = ce.expr(['Zeta', 0.5, -2.5]).N();
    expect(z.im ?? 0).toBeCloseTo(0, 10);
    expect(Math.abs(z.re / 2.25826703191286657769 - 1)).toBeLessThan(1e-13);
  });

  test('HurwitzZeta(0.5, -2.5) is complex, matching mpmath', () => {
    const z = ce.expr(['HurwitzZeta', 0.5, -2.5]).N();
    expect(Math.abs(z.re / -0.60489864342163037025 - 1)).toBeLessThan(1e-13);
    expect(Math.abs(z.im / -2.8631656753344969479 - 1)).toBeLessThan(1e-13);
  });
});

describe('HurwitzZeta at large s', () => {
  test('HurwitzZeta(18.199, 4.933) keeps a tiny value (mpmath 2.5226160559690445e-13)', () => {
    const z = ce.expr(['HurwitzZeta', 18.199, 4.933]).N();
    expect(Math.abs(z.re / 2.5226160559690445e-13 - 1)).toBeLessThan(1e-12);
  });
});

// A sample of @enumeratio/analytic's Zeta.examples.yaml / HurwitzZeta.examples.yaml,
// each cross-checked against mpmath/Wolfram there.
describe('Reference examples (enumeratio)', () => {
  test('Zeta(3, -1/2) = 8 + Zeta(3, 1/2), Wolfram convention for a <= 0', () => {
    expect(ce.expr(['Zeta', 3, ['Rational', -1, 2]]).N().re).toBeCloseTo(
      16.4143983221171599978,
      10
    );
  });

  test('Zeta(-1, -2) = 35/12, exactly and numerically', () => {
    // |−2| + |−1| + (the a = 0 term dropped) + ζ(−1, 1) = 3 − 1/12.
    expect(
      ce
        .expr(['Zeta', -1, -2])
        .evaluate()
        .isSame(ce.number([35, 12]))
    ).toBe(true);
    expect(ce.expr(['Zeta', -1, -2]).N().re).toBeCloseTo(35 / 12, 10);
  });

  test('Zeta(-1, 5) = -B_2(5)/2 = -121/12 exactly', () => {
    expect(
      ce
        .expr(['Zeta', -1, 5])
        .evaluate()
        .isSame(ce.number([-121, 12]))
    ).toBe(true);
  });

  test('Zeta(3, 0) = Zeta(3): the dropped-pole convention holds at any s', () => {
    expect(
      ce
        .expr(['Zeta', 3, 0])
        .evaluate()
        .isSame(ce.expr(['Zeta', 3]))
    ).toBe(true);
  });

  test('HurwitzZeta(-3, 7/3) = -B_4(7/3)/4 = -7813/3240 exactly', () => {
    expect(
      ce
        .expr(['HurwitzZeta', -3, ['Rational', 7, 3]])
        .evaluate()
        .isSame(ce.number([-7813, 3240]))
    ).toBe(true);
  });

  test('HurwitzZeta(0.51, 0.87), inside the critical strip', () => {
    expect(ce.expr(['HurwitzZeta', 0.51, 0.87]).N().re).toBeCloseTo(
      -1.32015502369495837551,
      10
    );
  });

  test('HurwitzZeta(2.3, Complex(8,1)), complex a', () => {
    const z = ce.expr(['HurwitzZeta', 2.3, ['Complex', 8, 1]]).N();
    expect(z.re).toBeCloseTo(0.05447008273213067, 10);
    expect(z.im).toBeCloseTo(-0.009448515336470249, 10);
  });

  test('HurwitzZeta([2,3,4], 0.5) threads over a list of orders', () => {
    const z = ce.expr(['HurwitzZeta', ['List', 2, 3, 4], 0.5]).evaluate();
    const got = z.ops?.map((op) => op.N().re) ?? [];
    const expected = [4.934802200544679, 8.41439832211716, 16.234848505667074];
    expect(got.length).toBe(3);
    got.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 10));
  });

  test('HurwitzZeta(7, 5) peels off the first terms: Zeta(7) - sum_{k=1}^{4} k^-7', () => {
    const z = ce.expr(['HurwitzZeta', 7, 5]).evaluate();
    expect(z.has('Zeta')).toBe(true);
    expect(z.N().re).toBeCloseTo(
      ce.expr(['Zeta', 7]).N().re - 36130315 / 35831808,
      10
    );
  });
});

describe('Zeta(0, a) = 1/2 − a exactly', () => {
  test.each([
    [
      ['Rational', 1, 3],
      [1, 6],
    ],
    [
      ['Rational', 7, 3],
      [-11, 6],
    ],
    [1, [-1, 2]],
  ])('Zeta(0, %j)', (a, expected) => {
    expect(
      ce
        .expr(['Zeta', 0, a])
        .evaluate()
        .isSame(ce.number(expected as [number, number]))
    ).toBe(true);
    expect(
      ce
        .expr(['HurwitzZeta', 0, a])
        .evaluate()
        .isSame(ce.number(expected as [number, number]))
    ).toBe(true);
  });
});

describe('Two-operand Zeta at edge operands', () => {
  test('a non-finite base point does not hang', () => {
    expect(ce.expr(['Zeta', 2, 'NegativeInfinity']).N().isNumberLiteral).toBe(
      false
    );
    expect(ce.expr(['HurwitzZeta', 2, 'NegativeInfinity']).N().re).toBeNaN();
  });

  test('s = 1 is the pole at a negative base point too', () => {
    expect(ce.expr(['Zeta', 1, -2.5]).N().isSame(ce.ComplexInfinity)).toBe(
      true
    );
    expect(
      ce
        .expr(['Zeta', 1, ['Rational', -5, 2]])
        .evaluate()
        .isSame(ce.ComplexInfinity)
    ).toBe(true);
  });

  test('a large positive integer base point uses the kernel under N()', () => {
    // ζ(100, 5) = 5^(−100) + 6^(−100) + …, where ζ(100) − Σ_{k<5} k^(−100)
    // cancels to 0 or noise. The direct sum of a few terms is exact to 1 ulp.
    let expected = 0;
    for (let k = 5; k < 20; k++) expected += k ** -100;
    const z = ce.expr(['HurwitzZeta', 100, 5]).N();
    expect(Math.abs(z.re / expected - 1)).toBeLessThan(1e-12);
    // ζ(2, 2000) ≈ 1/1999.5, and must not build a 2000-term symbolic sum.
    const t0 = Date.now();
    const w = ce.expr(['Zeta', 2, 2000]).N();
    expect(Date.now() - t0).toBeLessThan(200);
    expect(w.re).toBeCloseTo(0.0005001250208333, 13);
    // The exact route stays symbolic past 20 terms.
    expect(ce.expr(['Zeta', 2, 25]).evaluate().operator).toBe('Zeta');
  });

  test('real s far below 0 with a real a > 0 is real', () => {
    const z = ce.expr(['HurwitzZeta', -60.5, 0.3]).N();
    expect(z.im).toBe(0);
    expect(z.re).toBeGreaterThan(9e33);
    const w = ce.expr(['Zeta', -101, ['Rational', 1, 2]]).N();
    expect(w.im).toBe(0);
    expect(w.re).toBeGreaterThan(7e78);
  });

  test('ζ(s, 1/2) = (2^s − 1)·ζ(s)', () => {
    expect(
      ce
        .expr(['Zeta', 2, ['Rational', 1, 2]])
        .evaluate()
        .isSame(ce.parse('\\frac{\\pi^2}{2}'))
    ).toBe(true);
    const z3 = ce.expr(['Zeta', 3, ['Rational', 1, 2]]).evaluate();
    expect(z3.N().re).toBeCloseTo(ce.expr(['HurwitzZeta', 3, 0.5]).N().re, 12);
  });

  test('infinite operands have their limits', () => {
    expect(ce.expr(['Zeta', 'PositiveInfinity', 2]).N().re).toBe(0);
    expect(ce.expr(['Zeta', 'PositiveInfinity', 1]).evaluate().re).toBe(1);
    expect(
      ce
        .expr(['Zeta', 'PositiveInfinity', ['Rational', 1, 2]])
        .evaluate()
        .isSame(ce.PositiveInfinity)
    ).toBe(true);
    expect(ce.expr(['Zeta', 2, 'PositiveInfinity']).evaluate().re).toBe(0);
    expect(ce.expr(['HurwitzZeta', 2, 'PositiveInfinity']).N().re).toBe(0);
  });
});

describe('Zeta / HurwitzZeta result types', () => {
  test('the poles and the complex branch are typed number', () => {
    expect(ce.expr(['Zeta', 1, 2]).type.toString()).toBe('number');
    expect(ce.expr(['HurwitzZeta', 1, 2]).type.toString()).toBe('number');
    expect(ce.expr(['HurwitzZeta', 2, 0]).type.toString()).toBe('number');
    expect(ce.expr(['HurwitzZeta', 0.5, -0.5]).type.toString()).toBe('number');
  });

  test('real operands on the real branch are typed real', () => {
    expect(ce.expr(['HurwitzZeta', 2, 3]).type.toString()).toBe('real');
    // Wolfram's generalized Zeta is real at every real a.
    expect(ce.expr(['Zeta', 0.5, -0.5]).type.toString()).toBe('real');
  });
});

describe('Zeta / HurwitzZeta LaTeX round trip', () => {
  test.each([[['Zeta', 's', 'a']], [['HurwitzZeta', 's', 'a']]])('%j', (e) => {
    const expr = ce.expr(e);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });
});

describe('Compiled Zeta / HurwitzZeta match N()', () => {
  ce.declare('cp_s', 'real');
  ce.declare('cp_a', 'real');
  const runZ1 = compile(ce.box(['Zeta', 'cp_s']))?.run;
  const runZ = compile(ce.box(['Zeta', 'cp_s', 'cp_a']))?.run;
  const runH = compile(ce.box(['HurwitzZeta', 'cp_s', 'cp_a']))?.run;

  // Compare a compiled value with the interpreter's `.N()`: `~oo` is
  // `+Infinity` compiled; a complex value is NaN compiled.
  function expectParity(got: unknown, expr: any) {
    const n = ce.expr(expr).N();
    if (n.isSame(ce.ComplexInfinity)) expect(got).toBe(Infinity);
    else if (n.im !== 0) expect(got).toBeNaN();
    else
      expect(Math.abs((got as number) - n.re)).toBeLessThan(
        1e-10 * Math.max(1, Math.abs(n.re))
      );
  }

  test.each([2, 0.5, -3, -10.5, 1])('Zeta(%p)', (s) => {
    expectParity(runZ1?.({ cp_s: s }), ['Zeta', s]);
  });

  test.each([
    [2, 1 / 3],
    [0.5, -0.5],
    [3, -0.5],
    [2, 0],
    [2, -2],
    [0, -2],
    [-2.5, -1.5],
    [1, 2],
    [1, -2.5],
  ])('Zeta(%p, %p)', (s, a) => {
    expectParity(runZ?.({ cp_s: s, cp_a: a }), ['Zeta', s, a]);
  });

  test.each([
    [2, 1 / 3],
    [2, -0.5],
    [0.5, -0.5],
    [0.5, -2.5],
    [-3, 0.3],
    [0, 0],
    [0, -2],
    [1, 2],
    [2, 0],
    [2, -3],
  ])('HurwitzZeta(%p, %p)', (s, a) => {
    expectParity(runH?.({ cp_s: s, cp_a: a }), ['HurwitzZeta', s, a]);
  });

  test('the three-operand HurwitzZeta does not compile', () => {
    expect(compile(ce.box(['HurwitzZeta', 'cp_s', 'cp_a', 2])).success).toBe(
      false
    );
  });
});

describe('GPU Zeta / HurwitzZeta preamble', () => {
  ce.declare('gz_s', 'real');
  ce.declare('gz_a', 'real');
  const targets = [
    ['GLSL', new GLSLTarget(), 'float _gpu_gamma('],
    ['WGSL', new WGSLTarget(), 'fn _gpu_gamma('],
  ] as const;

  test.each(targets)(
    '%s: HurwitzZeta(s, a) and Zeta(s, a) define _gpu_gamma',
    (_name, target, gammaDecl) => {
      for (const e of [
        ['HurwitzZeta', 'gz_s', 'gz_a'],
        ['Zeta', 'gz_s', 'gz_a'],
      ]) {
        const r = target.compile(ce.box(e));
        expect(r.success).toBe(true);
        expect(r.preamble ?? '').toContain(gammaDecl);
      }
    }
  );

  test('the two-operand Zeta lowers to the generalized helper', () => {
    const r = new GLSLTarget().compile(ce.box(['Zeta', 'gz_s', 'gz_a']));
    expect(r.code).toBe('_gpu_zeta_generalized(gz_s, gz_a)');
  });
});
