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
import { Complex } from 'complex-esm';
import {
  hurwitzZetaComplex,
  hurwitzZetaComplexWithError,
  zetaGeneralizedComplexWithError,
} from '../../src/compute-engine/numerics/numeric-complex';
import {
  bernoulliRational,
  zetaEvenCoefficient,
  zetaNegativeInteger,
} from '../../src/compute-engine/numerics/bernoulli';

const ce = new ComputeEngine();

// Timing is load-dependent (12 jest workers share the machine), so the
// time limits are checked only in a `CE_PERF=1` run (`npm run test:perf`).
// The default run checks the answer or the decline: the old code ran for
// seconds or minutes, past the jest timeout of the test.
const PERF = process.env.CE_PERF === '1';

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
    // Large s, tiny result: the kernel sizes its absolute target from the
    // magnitude of the result, so a result far below 1 keeps every
    // significant digit.
    [
      'HurwitzZeta',
      20,
      10,
      50,
      '1.18160477582516795534661414027181923713723074538e-20',
    ],
    [
      'HurwitzZeta',
      200,
      10,
      50,
      '1.0000000052657832700923535130413277541009039345515e-200',
    ],
    // The first term alone is 1e-300: the absolute target must follow it.
    [
      'HurwitzZeta',
      300,
      10,
      50,
      '1.000000000000382115322198140527897353092511626405e-300',
    ],
    // Far left of the strip, the value is past the double range: the
    // cancellation allowance is relative to the size of the result.
    [
      'HurwitzZeta',
      -400.5,
      [3, 10],
      50,
      '7.7543378591304661179704156019730554339937054497715e+549',
    ],
    [
      'HurwitzZeta',
      -1000.5,
      [3, 10],
      50,
      '9.5187462016086319918612913868370220573301387092098e+1769',
    ],
    // A shift by 10^6 or 10^8 terms off the positive axis: summed as a
    // difference of two Hurwitz values, not term by term. Zeta(2, −10^8) is
    // 2ζ(2) − ζ(2, 10^8 + 1) (mpmath).
    [
      'Zeta',
      2,
      [-2000001, 2],
      50,
      '9.869603401090358617917825083208955302292865909473',
    ],
    [
      'Zeta',
      2,
      -100000000,
      50,
      '3.2898681236964529229448301666253837117712364690803',
    ],
    // An odd integer s with a < 0: the terms off the positive axis are
    // negative, (k + a)^(−3), and cancel the tail ζ(3, 1/2) to about 1e-9.
    [
      'HurwitzZeta',
      3,
      [-40001, 2],
      50,
      '1.2498750085932812706698405172720947685614585123452e-9',
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

  test('an exact rational base point keeps every digit (mpmath at dps 120)', () => {
    // A float s puts the call on the numeric branch of `.evaluate()`, which
    // keeps the rational a exact; the kernel converts it at its own working
    // precision. (`.N()` rounds 1/3 to `ce.precision` digits before the
    // handler sees it; see ROADMAP.md.)
    atPrecision(50, () => {
      const f = (op: string, a: [number, number]) =>
        ce
          .box([op, { num: '3.0' }, ['Rational', ...a]])
          .evaluate()
          .toString();
      expect(f('HurwitzZeta', [1, 3])).toBe(
        '27.561061199700803776227877977407509284542095313015'
      );
      expect(f('HurwitzZeta', [-1, 3])).toBe(
        '-23.307581717551352355834685778109809524652451712162'
      );
      expect(f('Zeta', [-1, 3])).toBe(
        '30.692418282448647644165314221890190475347548287838'
      );
    });
  });

  test('s = −2 + 10^−30 is not the integer −2 (mpmath at dps 80)', () => {
    // As a double, s is −2, and (s + 2) = 0 would end the Euler-Maclaurin
    // corrections as if s were the integer −2.
    atPrecision(50, () => {
      const s = ce.box(['Add', -2, ['Power', 10, -30]]);
      expect(ce.box(['HurwitzZeta', s, 2]).N().toString()).toBe(
        '-1.0000000000000000000000000000000304484570583932708'
      );
    });
  });

  test('an integer s ≤ 0 at a zero of the Bernoulli polynomial is 0', () => {
    // ζ(−2, 1/2) = −B₃(1/2)/3 = 0: the terminating series leaves only a
    // rounding residue, which no relative-precision check can accept.
    atPrecision(50, () => {
      expect(
        ce
          .box(['HurwitzZeta', { num: '-2.0' }, { num: '0.5' }])
          .N()
          .toString()
      ).toBe('0');
    });
  });

  test('beyond the kernel, a value past the double range stays symbolic', () => {
    // s < −1279 needs more Bernoulli pairs than the kernel allows; the
    // double kernel overflows there, so the call does not become +oo.
    atPrecision(50, () => {
      const z = ce.box(['HurwitzZeta', -2000.5, ['Rational', 3, 10]]).N();
      expect(z.operator).toBe('HurwitzZeta');
    });
  });

  test('a machine-precision engine keeps the double kernel', () => {
    const mce = new ComputeEngine({ precision: 'machine' });
    const z = mce.box(['HurwitzZeta', 3, ['Rational', 1, 2]]).N();
    expect(typeof z.re).toBe('number');
    expect(z.re).toBeCloseTo(8.41439832211716, 13);
    expect(z.toString().replace(/[-.]/g, '').length).toBeLessThanOrEqual(17);
  });

  test('the exact form at an integer s ≤ 0 is unchanged', () => {
    atPrecision(50, () => {
      expect(
        ce
          .box(['HurwitzZeta', -3, ['Rational', 1, 2]])
          .evaluate()
          .toString()
      ).toBe('-7/960');
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
    if (PERF) expect(Date.now() - t0).toBeLessThan(200);
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

/** The relative distance from `got` to `re + i·im`. */
function relErr(got: { re: number; im: number }, re: number, im = 0): number {
  return Math.hypot(got.re - re, got.im - im) / Math.hypot(re, im);
}

describe('Machine-precision Zeta next to s = 0 and next to a negative even integer', () => {
  // The reflection formula uses ζ(1 − s), which is next to its pole when s
  // is next to 0: the rounded 1 − s left the result a relative error of
  // about 1e−16/|s| (8e−8 at s = −1e−9, and −Infinity at s = −1e−17, where
  // 1 − s rounds to 1). Next to a negative even integer, sin(πs/2) lost its
  // relative accuracy the same way. The references are mpmath at 40 digits,
  // at the double the literal rounds to.
  ce.declare('zs_s', 'real');
  ce.declare('zs_a', 'real');
  ce.declare('zs_z', 'real');
  const runZeta = compile(ce.box(['Zeta', 'zs_s']))?.run;
  const runHurwitz = compile(ce.box(['HurwitzZeta', 'zs_s', 'zs_a']))?.run;
  const runPolyLog = compile(ce.box(['PolyLog', 'zs_s', 'zs_z']))?.run;

  test.each([
    // mpmath: zeta(-1e-9) = -0.4999999990810614678
    [-1e-9, -0.4999999990810614678],
    // mpmath: zeta(-1e-6) = -0.49999908106246997255
    [-1e-6, -0.49999908106246997255],
    // mpmath: zeta(-1e-17) = -0.49999999999999999081
    [-1e-17, -0.49999999999999999081],
    // mpmath: zeta(-4.000000001) = -7.9838121079834372631e-12
    [-4.000000001, -7.9838121079834372631e-12],
    // mpmath: zeta(-2.00000001) = 3.0448456544526081345e-10
    [-2.00000001, 3.0448456544526081345e-10],
  ])('ζ(%p): the real kernel and the compiled Zeta', (s, expected) => {
    expect(Math.abs(zetaReal(s) / expected - 1)).toBeLessThan(1e-14);
    expect(
      Math.abs((runZeta?.({ zs_s: s }) as number) / expected - 1)
    ).toBeLessThan(1e-14);
  });

  test('the compiled PolyLog(s, 1) is ζ(s) next to s = 0', () => {
    // mpmath: polylog(-1e-9, 1) = -0.4999999990810614678
    const got = runPolyLog?.({ zs_s: -1e-9, zs_z: 1 }) as number;
    expect(Math.abs(got / -0.4999999990810614678 - 1)).toBeLessThan(1e-14);
  });

  test('the compiled HurwitzZeta(s, a) next to s = 0, a ≠ 1', () => {
    // The Taylor series in a has a term ζ(1 + s) next to its pole.
    // mpmath: zeta(-1e-9, 0.3) = 0.19999999982314054921
    const got = runHurwitz?.({ zs_s: -1e-9, zs_a: 0.3 }) as number;
    expect(Math.abs(got / 0.19999999982314054921 - 1)).toBeLessThan(1e-14);
  });

  test('Zeta at a complex s next to 0', () => {
    // mpmath: zeta(-1e-9+1e-9j) = -0.4999999990810614668 - 9.1893853119831634511e-10j
    const z = ce.box(['Zeta', ['Complex', -1e-9, 1e-9]]).N();
    expect(
      relErr(z, -0.4999999990810614668, -9.1893853119831634511e-10)
    ).toBeLessThan(1e-14);
  });

  test('HurwitzZeta at a complex s next to 0', () => {
    // mpmath: zeta(-1e-8+1e-8j, 0.3) = 0.19999999823140539497 + 1.7685946720934388093e-9j
    const z = ce.box(['HurwitzZeta', ['Complex', -1e-8, 1e-8], 0.3]).N();
    expect(
      relErr(z, 0.19999999823140539497, 1.7685946720934388093e-9)
    ).toBeLessThan(1e-14);
  });
});

describe('HurwitzZeta(s, a) at a complex a with Re(s) < 0', () => {
  // Off the real axis, the Euler-Maclaurin sum cancels for Re(s) < 0 (the
  // first witness was 2.2188 + 50.186i); the kernel uses Hermite's integral
  // there. The references are mpmath at 40 digits.
  test.each([
    // mpmath: zeta(-11.801, 0.4265-1.271j) = 5.6234447340525381513 + 46.076938317428173499j
    [-11.801, 0, 0.4265, -1.271, 5.6234447340525381513, 46.076938317428173499],
    // mpmath: zeta(-11.5, 0.5-1.0994j) = -9.5260854219889552473 + 9.5260650281217040009j
    [-11.5, 0, 0.5, -1.0994, -9.5260854219889552473, 9.5260650281217040009],
    // mpmath: zeta(-2.9, 0.5-0.7329j) = -0.1476884840925461205 - 0.023378779140114999706j
    [-2.9, 0, 0.5, -0.7329, -0.1476884840925461205, -0.023378779140114999706],
    // mpmath: zeta(-20.3+2j, 0.7+15j) = 1.1644214205768092134e+25 - 5.4324870735228747795e+24j
    [-20.3, 2, 0.7, 15, 1.1644214205768092134e25, -5.4324870735228747795e24],
  ])('HurwitzZeta(%p + %pi, %p + %pi)', (sRe, sIm, aRe, aIm, re, im) => {
    const z = ce
      .box(['HurwitzZeta', ['Complex', sRe, sIm], ['Complex', aRe, aIm]])
      .N();
    expect(relErr(z, re, im)).toBeLessThan(1e-12);
  });

  test.each([
    // mpmath: lerchphi(-1, -28.5, 5+2.4j) = -6337899538601815050.4 - 1238951242543507877.6j
    [-28.5, 5, 2.4, -6337899538601815050.4, -1238951242543507877.6, 1e-12],
    // mpmath: lerchphi(-1, -29, 5.5+0.001j) = 8767125475330398785.9 + 56421349704498153.511j
    [-29, 5.5, 0.001, 8767125475330398785.9, 56421349704498153.511, 1e-12],
    // mpmath: lerchphi(-1, -4.2, 0.1-0.00025j) = 0.00037341097979179704743 - 0.00013408919037676011523j
    // The odd term ζ(−4.2, 0.55 − 0.000125i) = 3.2e−5 has a condition
    // number of 1400 (a one-ulp change of its operands moves it by about
    // 1.5e−13 relative), and the difference multiplies that by 18; the
    // bound is the accuracy `lerchPhiComplex` states, 1e−11.
    [
      -4.2, 0.1, -0.00025, 0.00037341097979179704743,
      -0.00013408919037676011523, 1e-11,
    ],
  ])(
    'LerchPhi(−1, %p, %p + %pi) uses the two Hurwitz zeta values',
    (s, aRe, aIm, re, im, bound) => {
      // Φ(−1, s, a) = 2^(−s)·(ζ(s, a/2) − ζ(s, (a+1)/2)). The continuation
      // declines these points, so they stayed unevaluated before the Hurwitz
      // zeta kernel was accurate for a complex a.
      const z = ce.box(['LerchPhi', -1, s, ['Complex', aRe, aIm]]).N();
      expect(relErr(z, re, im)).toBeLessThan(bound);
    }
  );
});

describe('Machine-precision HurwitzZeta for a real a left of the critical strip', () => {
  // The references are mpmath at 40 digits, at the double each literal
  // rounds to. Each value is within a few units in the last place.
  ce.declare('hw_s', 'real');
  ce.declare('hw_a', 'real');
  const run = compile(ce.box(['HurwitzZeta', 'hw_s', 'hw_a']))?.run;

  test.each([
    // mpmath: zeta(-1.5, 0.3) = -0.0081855604858359760572
    [-1.5, 0.3, -0.0081855604858359760572],
    // mpmath: zeta(-200.5, 0.3) = 2.9233713806280506208e+215
    [-200.5, 0.3, 2.9233713806280506208e215],
    // ζ(−12, 3/2) = ζ(−12, 1/2) − 2⁻¹² = −2⁻¹², exactly
    [-12, 1.5, -0.000244140625],
    // mpmath: zeta(1e-8, 0.5000001) = -1.0346573788938122525e-7
    [1e-8, 0.5000001, -1.0346573788938122525e-7],
    // mpmath: zeta(-1e-8, 0.4999999) = 1.0346573386645774404e-7
    [-1e-8, 0.4999999, 1.0346573386645774404e-7],
  ])('the compiled HurwitzZeta(%p, %p)', (s, a, expected) => {
    const got = run?.({ hw_s: s, hw_a: a }) as number;
    expect(Math.abs(got / expected - 1)).toBeLessThan(2e-15);
  });

  test('HurwitzZeta(0, a) is 1/2 − a in the kernel', () => {
    // It was 0.1999999999999993 at a = 0.3 (the Euler-Maclaurin terms
    // cancel to the small result).
    const z = hurwitzZetaComplex(new Complex(0, 0), new Complex(0.3, 0));
    expect(z.re).toBe(0.2);
    expect(z.im).toBe(0);
  });

  test('HurwitzZeta next to a negative integer order, at a complex s', () => {
    // mpmath: zeta(-12+1e-5j, 1.5) = -0.00024414062934736560327 - 6.3424361808430054027e-7j
    const z = ce.box(['HurwitzZeta', ['Complex', -12, 1e-5], 1.5]).N();
    expect(
      relErr(z, -0.00024414062934736560327, -6.3424361808430054027e-7)
    ).toBeLessThan(2e-15);
  });

  test('HurwitzZeta at a complex a left of the imaginary axis', () => {
    // mpmath: zeta(-2.0179750353517525+4.791454460430932j, -26.746414464915123-0.7123398723351617j)
    //   = 0.0051691933507619109354 - 0.0033016657734743167424j
    // It was 0.005169193351002762 − 0.0033016657735622477i (4.2e−11).
    const z = ce
      .box([
        'HurwitzZeta',
        ['Complex', -2.0179750353517525, 4.791454460430932],
        ['Complex', -26.746414464915123, -0.7123398723351617],
      ])
      .N();
    expect(
      relErr(z, 0.0051691933507619109354, -0.0033016657734743167424)
    ).toBeLessThan(2e-15);
  });
});

describe('HurwitzZeta at a complex order with a large imaginary part', () => {
  // A power w^(−s) has the modulus |w|^(−Re s)·e^(Im s·arg w). With a large
  // |Im s|, the terms of the kernel's routes were much larger than the value
  // (up to about e^(|Im s|·π/2) in Hermite's integral at a small base
  // point), and the result lost digits, or all of them. The kernel now
  // chooses the route and the base point by the size of their terms. Each
  // reference is mpmath at 40 digits; the comment gives the relative error
  // before the change.
  test.each([
    // mpmath: zeta(mpc('-0.93','28.85'), '0.1334')
    //   = -10.482272320167377 - 5.5459737349648873j (was 4.6e+8 off)
    [-0.93, 28.85, 0.1334, 0, -10.482272320167377, -5.5459737349648873, 1e-14],
    // mpmath: zeta(mpc('-0.76','8.33'), '0.067')
    //   = 1.4969924804763189 - 0.066410360940659531j (was 2.4e-11 off)
    [-0.76, 8.33, 0.067, 0, 1.4969924804763189, -0.066410360940659531, 1e-14],
    // mpmath: zeta(mpc('0.17','6.9'), '0.016')
    //   = -0.94147445326456275 - 0.16203090246493993j (was 1.3e-11 off)
    [0.17, 6.9, 0.016, 0, -0.94147445326456275, -0.16203090246493993, 1e-14],
    // mpmath: zeta(mpc('-5.7','-29.8'), '5.03')
    //   = -12925.875141277155 + 7019.9658488894265j (was 1.7e+3 off)
    [-5.7, -29.8, 5.03, 0, -12925.875141277155, 7019.9658488894265, 1e-14],
    // mpmath: zeta(mpc('0.54','12.9'), mpc('0.12','-3.55'))
    //   = -1.398892661921259e-10 - 9.9672977305178443e-11j (was 1.1e-6 off)
    [
      0.54, 12.9, 0.12, -3.55, -1.398892661921259e-10, -9.9672977305178443e-11,
      1e-12,
    ],
    // mpmath: zeta(mpc('1.83','-23.4'), mpc('0.04','4.66'))
    //   = 2.9111883161193008e-14 + 1.6454120785878907e-14j (was 3.0e-5 off)
    [
      1.83, -23.4, 0.04, 4.66, 2.9111883161193008e-14, 1.6454120785878907e-14,
      1e-12,
    ],
    // mpmath: zeta(mpc('-2.4','28'), mpc('40','3.9'))
    //   = -112930.43293920609 + 106594.24997242139j (was 5.9e-3 off)
    [-2.4, 28, 40, 3.9, -112930.43293920609, 106594.24997242139, 1e-14],
    // mpmath: zeta(mpc('0.32','26.2'), mpc('-9.8','-0.41'))
    //   = 0.064546075073258998 + 0.072218860217818693j (was 4.3e+3 off)
    [
      0.32, 26.2, -9.8, -0.41, 0.064546075073258998, 0.072218860217818693,
      1e-14,
    ],
  ])(
    'hurwitzZetaComplex(%p + %pi, %p + %pi)',
    (sRe, sIm, aRe, aIm, re, im, bound) => {
      const z = hurwitzZetaComplex(
        new Complex(sRe, sIm),
        new Complex(aRe, aIm)
      );
      expect(relErr(z, re, im)).toBeLessThan(bound);
    }
  );
});

describe('HurwitzZeta declines rather than returning wrong digits', () => {
  // The kernel estimates its rounding error from the terms it sums. When
  // the estimate is above 1e−12 of the value even with the powers formed in
  // double-double, or when every route would take too long, it declines,
  // and the expression stays symbolic.
  test('a value much smaller than every term stays symbolic', () => {
    // mpmath: zeta(mpc(-0.22, 12.28), mpc(-6.93, -4.78))
    //   = -1.98655…e-14 - 1.45171…e-13j, while the terms that sum to it are
    //   about 1e-7: the double kernel was off by about 1e-9 relative.
    const s = new Complex(-0.22, 12.28);
    const a = new Complex(-6.93, -4.78);
    expect(hurwitzZetaComplexWithError(s, a)).toBeUndefined();
    expect(hurwitzZetaComplex(s, a).isNaN()).toBe(true);
    const z = ce
      .box([
        'HurwitzZeta',
        ['Complex', -0.22, 12.28],
        ['Complex', -6.93, -4.78],
      ])
      .N();
    expect(z.operator).toBe('HurwitzZeta');
  });

  test('a value the double-double powers recover is answered', () => {
    // mpmath: zeta(mpc(0.26, 18.16), mpc(0.0065, -4.513))
    //   = 5.8578692545746872804e-13 - 2.2172937502747674893e-13j
    // In doubles the powers are only accurate to about |s·ln w|·ε, and the
    // value was 3.6e-12 off; with the powers in double-double it is within
    // about 1e-13.
    const r = hurwitzZetaComplexWithError(
      new Complex(0.26, 18.16),
      new Complex(0.0065, -4.513)
    );
    expect(r).toBeDefined();
    const err = relErr(
      r!.value,
      5.8578692545746872804e-13,
      -2.2172937502747674893e-13
    );
    expect(err).toBeLessThan(1e-12);
    expect(err).toBeLessThanOrEqual(r!.error / r!.value.abs());
  });

  test('Zeta(s, a) answers next to a zero where HurwitzZeta(s, a) does', () => {
    // s is the double nearest to the first nontrivial zero of ζ, so the
    // value is small next to its terms, and the Hurwitz kernel accepts it
    // through its condition allowance. With Re(a) ≥ 0 there are no terms
    // left of the imaginary axis, and the generalized zeta must give the
    // same value (it declined: its estimate was checked again without the
    // allowance).
    // mpmath: zeta(mpc(0.5, 14.134725141734694))
    //   = -1.0483650805588237e-16 + 6.5852592776051578e-16j
    const s = new Complex(0.5, 14.134725141734694);
    const h = hurwitzZetaComplexWithError(s, new Complex(1, 0));
    expect(h).toBeDefined();
    for (const a of [1, 0]) {
      const z = zetaGeneralizedComplexWithError(s, new Complex(a, 0));
      expect(z).toBeDefined();
      expect(z!.value.re).toBe(h!.value.re);
      expect(z!.value.im).toBe(h!.value.im);
      const err = Math.hypot(
        z!.value.re + 1.0483650805588237e-16,
        z!.value.im - 6.5852592776051578e-16
      );
      expect(err).toBeLessThanOrEqual(z!.error);
    }
  });

  test('a NaN operand still gives NaN', () => {
    expect(ce.box(['HurwitzZeta', 'NaN', 2]).N().isNaN).toBe(true);
    expect(ce.box(['HurwitzZeta', 2, 'NaN']).N().isNaN).toBe(true);
    expect(ce.box(['Zeta', 2, 'NaN']).N().isNaN).toBe(true);
    const r = hurwitzZetaComplexWithError(
      new Complex(NaN, 0),
      new Complex(2, 0)
    );
    expect(r?.value.isNaN()).toBe(true);
  });

  test.each([
    // mpmath: zeta(2, mpc(0, 1e9)) = -5.0e-19 - 9.9999999999999999983e-10j
    [2, 0, 0, 1e9, -5.0e-19, -9.9999999999999999983e-10],
    // mpmath: zeta(mpc(0.7, 1000), 0.3)
    //   = -0.27937899228169315784 - 0.86566654248732822318j
    [0.7, 1000, 0.3, 0, -0.27937899228169315784, -0.86566654248732822318],
  ])(
    'hurwitzZetaComplex(%p + %pi, %p + %pi) is quick and accurate',
    (sRe, sIm, aRe, aIm, re, im) => {
      const start = Date.now();
      const z = hurwitzZetaComplex(
        new Complex(sRe, sIm),
        new Complex(aRe, aIm)
      );
      if (PERF) expect(Date.now() - start).toBeLessThan(500);
      expect(relErr(z, re, im)).toBeLessThan(1e-12);
    }
  );

  test.each([
    // The Euler-Maclaurin sum would have 1e7 terms (it took 1.9 s), and no
    // base point of Hermite's integral within reach is far enough right.
    [['Complex', 0.7, 1e7], 0.3],
    [['Complex', 0.3, 1e5], 0.3],
    // 1e12 terms from a to the right half-plane.
    [2, ['Complex', -1e12, 1]],
  ])('HurwitzZeta(%j, %j) stays symbolic, quickly', (s, a) => {
    const start = Date.now();
    const z = ce.box(['HurwitzZeta', s, a] as any).N();
    if (PERF) expect(Date.now() - start).toBeLessThan(500);
    expect(z.operator).toBe('HurwitzZeta');
  });

  test('a huge real order ends after the terms that matter', () => {
    // It ran for 77 s, adding about 1e9 terms after the first one.
    const start = Date.now();
    const z = hurwitzZetaComplex(new Complex(1e9, 0), new Complex(0.5, 0));
    if (PERF) expect(Date.now() - start).toBeLessThan(500);
    expect(z.re).toBe(Infinity);
    // mpmath: zeta(40, 0.5) = 1099511627776.0000000000909…
    expect(hurwitzZetaComplex(new Complex(40, 0), new Complex(0.5, 0)).re).toBe(
      1099511627776
    );
  });

  test('the compiled HurwitzZeta reads a decline as NaN', () => {
    ce.declare('hd_s', 'real');
    ce.declare('hd_a', 'real');
    const run = compile(ce.box(['HurwitzZeta', 'hd_s', 'hd_a']))?.run;
    // A real a below −2^20: every route declines.
    expect(run?.({ hd_s: 2, hd_a: -1e7 - 0.5 })).toBeNaN();
    // mpmath: zeta(3, 0.25) = 64.663869968768460167
    expect(run?.({ hd_s: 3, hd_a: 0.25 })).toBeCloseTo(64.66386996876846, 9);
  });
});
