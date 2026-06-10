/**
 * Exact values of the Riemann zeta function at integer literals
 * (library/arithmetic.ts `Zeta` exact evaluate path, backed by exact
 * bigint-rational Bernoulli numbers in numerics/bernoulli.ts), plus the
 * curated symbolic trivial-zero rule `fungrim:zeta-trivial-zeros`
 * (Zeta(−2n) → 0 for positive integer n).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { loadIdentities } from '../../src/identities';
import {
  bernoulliRational,
  zetaEvenCoefficient,
  zetaNegativeInteger,
} from '../../src/compute-engine/numerics/bernoulli';

const ce = new ComputeEngine();

function zeta(s: number) {
  return ce.box(['Zeta', s]).evaluate();
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
    expect(ce.box(['Zeta', 2.5]).N().re).toBeCloseTo(1.3414872572509171, 8);
  });
});

describe('Symbolic trivial zeros (fungrim:zeta-trivial-zeros)', () => {
  test('with loadIdentities and n a positive integer, Zeta(−2n) simplifies to 0', () => {
    const ce2 = new ComputeEngine();
    loadIdentities(ce2);
    ce2.declare('n', 'integer');
    ce2.assume(ce2.box(['Greater', 'n', 0]));
    expect(
      ce2.box(['Zeta', ['Multiply', -2, 'n']]).simplify().isSame(0)
    ).toBe(true);
  });

  test('without the positivity guard, Zeta(−2m) stays symbolic', () => {
    const ce2 = new ComputeEngine();
    loadIdentities(ce2);
    ce2.declare('m', 'integer');
    const r = ce2.box(['Zeta', ['Multiply', -2, 'm']]).simplify();
    expect(r.operator).toBe('Zeta');
  });
});
