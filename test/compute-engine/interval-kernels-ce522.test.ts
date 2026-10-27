/**
 * The interval kernels fixed for the `Enclosure` value kind: ROADMAP entry
 * CE-522, items .1 to .4 and .6 to .9, and the three run-time helpers
 * `enclose`, `stripEnclosure` and `finiteOperand` (plan
 * `docs/plans/2026-10-26-value-kinds.md`, section 4.9.2).
 *
 * Each block states the answer the kernel gave before the fix. A containment
 * check compares the endpoints, which are doubles, with the EXACT value as a
 * fraction of two big integers, so the reference has no rounding at all.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';
import type {
  Interval,
  IntervalResult,
} from '../../src/compute-engine/interval/types';
import { nextUp } from '../../src/compute-engine/numerics/numeric';

const p = (lo: number, hi: number = lo): Interval => ({ lo, hi });

/** A rational number `n / d` with `d > 0`. */
type Fraction = [bigint, bigint];

/** The exact value of a finite double as a fraction. Doubling a double is
 *  exact, and a finite double becomes an integer after at most 1074
 *  doublings. */
function frac(x: number): Fraction {
  let m = x;
  let e = 0n;
  while (!Number.isInteger(m)) {
    m *= 2;
    e += 1n;
  }
  return [BigInt(m), 2n ** e];
}

/** `a ≤ b` for two fractions. */
const lte = ([a, b]: Fraction, [c, d]: Fraction): boolean => a * d <= c * b;
/** `a < b` for two fractions. */
const lt = ([a, b]: Fraction, [c, d]: Fraction): boolean => a * d < c * b;

/** π to 60 decimals, as a fraction: a reference for the side of a pole. */
const PI_FRACTION: Fraction = [
  314159265358979323846264338327950288419716939937510582097494459n,
  10n ** 62n,
];

/** The enclosure carried by a result (`interval`, `partial`, or a
 *  `singular` jump), failing the test when it has none. */
function valueOf(r: IntervalResult): Interval {
  const v = 'value' in r ? r.value : undefined;
  expect(v).toBeDefined();
  return v!;
}

/** Whether the enclosure of `r` contains the exact value `v`. */
function contains(r: IntervalResult, v: Fraction): boolean {
  const { lo, hi } = valueOf(r);
  const loOk = lo === -Infinity || lte(frac(lo), v);
  const hiOk = hi === Infinity || lte(v, frac(hi));
  return loOk && hiOk;
}

/** The exact floored modulo `mod(x, y)` of two rationals. */
function exactMod([a, b]: Fraction, [c, d]: Fraction): Fraction {
  // x / y = (a·d) / (b·c), with the sign of the denominator made positive.
  let num = a * d;
  let den = b * c;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  let q = num / den;
  if (num % den !== 0n && num < 0n) q -= 1n;
  // x − q·y = a/b − q·c/d
  return [a * d - q * c * b, b * d];
}

describe('CE-522.1 mod with a divisor interval that is not a point', () => {
  test('mod([5, 5], [2, 4]) contains mod(5, 3) = 2 and mod(5, 2.5) = 0', () => {
    // Before: [1, 1] (one ulp each side), as if the divisor were 4.
    const r = IA.mod(p(5), p(2, 4));
    expect(contains(r, [2n, 1n])).toBe(true);
    expect(contains(r, [0n, 1n])).toBe(true);
    // The hull of a jump: `[0, 4]`, a `singular` result with a value.
    expect(r).toMatchObject({ kind: 'singular', value: { lo: 0, hi: 4 } });
  });

  test('every value over the box is enclosed', () => {
    const cases: Array<[Interval, Interval]> = [
      [p(5), p(2, 4)],
      [p(5, 6), p(2.6, 4)],
      [p(-5), p(2, 4)],
      [p(5), p(-4, -2)],
      [p(-7, -6.5), p(-3.1, -2.2)],
      [p(0.3, 0.7), p(1.5, 2.5)],
      [p(10, 10.25), p(3.3, 3.4)],
    ];
    for (const [a, b] of cases) {
      const r = IA.mod(a, b);
      for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
          const x = a.lo + ((a.hi - a.lo) * i) / 8;
          const y = b.lo + ((b.hi - b.lo) * j) / 8;
          expect(contains(r, exactMod(frac(x), frac(y)))).toBe(true);
        }
      }
    }
  });

  test('a quotient with one floor over the box gives the continuous range', () => {
    // floor(5 / y) is 1 for every y in [2.6, 4], so mod is 5 − y there:
    // [1, 2.4], a plain interval (no jump).
    const r = IA.mod(p(5), p(2.6, 4));
    expect(r.kind).toBe('interval');
    const { lo, hi } = valueOf(r);
    expect(lo).toBeLessThanOrEqual(1);
    expect(lo).toBeGreaterThan(0.99);
    expect(hi).toBeGreaterThanOrEqual(2.4);
    expect(hi).toBeLessThan(2.41);
  });

  test('a point divisor is unchanged, and a divisor containing 0 is a pole', () => {
    expect(IA.mod(p(5), p(3))).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
    // The continuous case of a point divisor takes its one-ulp step, as
    // before.
    expect(IA.mod(p(1, 2), p(3))).toEqual({
      kind: 'interval',
      value: { lo: 0.9999999999999999, hi: 2.0000000000000004 },
    });
    expect(IA.mod(p(5), p(0, 4))).toEqual({ kind: 'singular' });
    expect(IA.mod(p(5), p(-1, 1))).toEqual({ kind: 'singular' });
  });
});

describe('CE-522.2 atanh at the boundary of its domain', () => {
  test('a boundary inside or at an endpoint gives an infinite bound', () => {
    // Before: `partial [0, 18.3684…]`, a clip to `1 − ε`.
    expect(IA.atanh(p(0, 1))).toEqual({
      kind: 'partial',
      value: { lo: 0, hi: Infinity },
      domainClipped: 'hi',
    });
    expect(IA.atanh(p(-1, 0))).toEqual({
      kind: 'partial',
      value: { lo: -Infinity, hi: 0 },
      domainClipped: 'lo',
    });
    expect(IA.atanh(p(-1, 1))).toEqual({
      kind: 'partial',
      value: { lo: -Infinity, hi: Infinity },
      domainClipped: 'both',
    });
    const r = IA.atanh(p(0.5, 2));
    expect(valueOf(r).hi).toBe(Infinity);
    expect(valueOf(r).lo).toBeLessThanOrEqual(Math.atanh(0.5));
  });

  test('the point at the boundary has no value', () => {
    expect(IA.atanh(p(1))).toEqual({ kind: 'empty' });
    expect(IA.atanh(p(-1))).toEqual({ kind: 'empty' });
  });
});

describe('CE-522.3 a pole at an endpoint gives a half-line', () => {
  const HALF_PI = Math.PI / 2;

  test('the double Math.PI / 2 is below π/2, and the next double is above', () => {
    // The side of the pole decides the answers below.
    const halfPi: Fraction = [PI_FRACTION[0], PI_FRACTION[1] * 2n];
    expect(lt(frac(HALF_PI), halfPi)).toBe(true);
    expect(lt(halfPi, frac(nextUp(HALF_PI)))).toBe(true);
  });

  test('tan', () => {
    // Before: `singular` at the pole, with no value (the whole line).
    expect(IA.tan(p(0, HALF_PI))).toEqual({
      kind: 'partial',
      value: { lo: 0, hi: Infinity },
      domainClipped: 'hi',
    });
    // The pole π/2 is INSIDE `[0, nextUp(π/2)]` and inside `[π/2, 3]` (the
    // double below it): the whole line.
    expect(IA.tan(p(0, nextUp(HALF_PI)))).toMatchObject({ kind: 'singular' });
    expect(getValueOf(IA.tan(p(0, nextUp(HALF_PI))))).toBeUndefined();
    expect(IA.tan(p(HALF_PI, 3))).toMatchObject({ kind: 'singular' });
    // The pole below the lower endpoint: `tan` tends to `−∞` there.
    const r = IA.tan(p(nextUp(HALF_PI), 3));
    expect(r.kind).toBe('partial');
    expect(valueOf(r).lo).toBe(-Infinity);
    expect(valueOf(r).hi).toBeGreaterThanOrEqual(Math.tan(3));
    // A point at the machine pole keeps the interpreter's pole rule.
    expect(IA.tan(p(HALF_PI))).toMatchObject({ kind: 'singular' });
  });

  test('cot, sec and csc', () => {
    // Before: `singular` at 0 for all of these.
    const c = IA.cot(p(0, 1));
    expect(c.kind).toBe('partial');
    expect(valueOf(c).hi).toBe(Infinity);
    expect(valueOf(c).lo).toBeLessThanOrEqual(1 / Math.tan(1));
    expect(valueOf(c).lo).toBeGreaterThan(0.64);
    const cNeg = IA.cot(p(-1, 0));
    expect(valueOf(cNeg).lo).toBe(-Infinity);
    expect(valueOf(cNeg).hi).toBeGreaterThanOrEqual(1 / Math.tan(-1));
    // The point 0 IS the pole. It stays `singular`, the answer of the
    // compiled code wherever the interpreter answers the pole `~oo`
    // (`compile-trig-poles.test.ts`); `gamma` and `pow` answer `empty`.
    expect(IA.cot(p(0))).toEqual({ kind: 'singular', at: 0 });
    expect(IA.csc(p(0))).toEqual({ kind: 'singular', at: 0 });

    const s = IA.sec(p(0, HALF_PI));
    expect(valueOf(s).hi).toBe(Infinity);
    expect(valueOf(s).lo).toBeLessThanOrEqual(1);
    const k = IA.csc(p(-1, 0));
    expect(valueOf(k).lo).toBe(-Infinity);
    expect(valueOf(k).hi).toBeGreaterThanOrEqual(1 / Math.sin(-1));
    expect(valueOf(k).hi).toBeLessThan(-1.18);
    // A pole inside stays the whole line.
    expect(IA.cot(p(-1, 1))).toEqual({ kind: 'singular', at: 0 });
  });

  test('gamma', () => {
    // Before: `singular` at the pole for each of these.
    const g = IA.gamma(p(0, 1));
    expect(g.kind).toBe('partial');
    expect(valueOf(g).hi).toBe(Infinity);
    expect(valueOf(g).lo).toBeLessThanOrEqual(1);
    expect(valueOf(g).lo).toBeGreaterThan(0.99);
    // Γ(−0.5) = −2√π ≈ −3.5449, and Γ decreases to −∞ at the pole 0.
    const gNeg = IA.gamma(p(-0.5, 0));
    expect(valueOf(gNeg).lo).toBe(-Infinity);
    expect(valueOf(gNeg).hi).toBeGreaterThanOrEqual(-2 * Math.sqrt(Math.PI));
    expect(valueOf(gNeg).hi).toBeLessThan(-3.54);
    // Both endpoints poles: the strip (−2, −1), where Γ > 0 with its minimum
    // Γ(−1.57349847316239…) = 2.30240725833968013582… (40-digit `.N()`).
    const strip = IA.gamma(p(-2, -1));
    expect(valueOf(strip).hi).toBe(Infinity);
    expect(valueOf(strip).lo).toBeLessThanOrEqual(2.3024072583396801);
    expect(valueOf(strip).lo).toBeGreaterThan(2.3);
    // A point at a pole has no value; a pole inside is the whole line.
    expect(IA.gamma(p(0))).toEqual({ kind: 'empty' });
    expect(IA.gamma(p(-3))).toEqual({ kind: 'empty' });
    expect(IA.gamma(p(-1, 0.5))).toEqual({ kind: 'singular', at: -1 });
  });

  test('powRational and powRealBranch', () => {
    // Before: `singular` at 0.
    expect(IA.powRational(p(-1, 0), -2, 3)).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: Infinity },
      domainClipped: 'hi',
    });
    expect(IA.powRational(p(-1, 0), -1, 3)).toEqual({
      kind: 'partial',
      value: { lo: -Infinity, hi: -1 },
      domainClipped: 'lo',
    });
    expect(IA.powRational(p(-1, 1), -1, 3)).toEqual({
      kind: 'singular',
      at: 0,
    });
    expect(IA.powRational(p(0), -1, 3)).toEqual({ kind: 'empty' });

    const odd = IA.powRealBranch(p(-1, 0), -1 / 3, true);
    expect(odd.kind).toBe('partial');
    expect(valueOf(odd).lo).toBe(-Infinity);
    expect(valueOf(odd).hi).toBeGreaterThanOrEqual(-1);
    const even = IA.powRealBranch(p(-1, 0), -2 / 3, false);
    expect(valueOf(even).hi).toBe(Infinity);
    expect(valueOf(even).lo).toBeLessThanOrEqual(1);
    expect(IA.powRealBranch(p(-1, 1), -1 / 3, true)).toEqual({
      kind: 'singular',
      at: 0,
    });
  });
});

describe('CE-522.4 a negative integer power over a base with a zero endpoint', () => {
  test('the half-line beside the pole, or no value at the pole', () => {
    // Before: `singular` with no value (the whole line) for all four.
    expect(IA.pow(p(0, 1), -1)).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: Infinity },
      domainClipped: 'hi',
    });
    expect(IA.pow(p(-1, 0), -1)).toEqual({
      kind: 'partial',
      value: { lo: -Infinity, hi: -1 },
      domainClipped: 'lo',
    });
    expect(IA.pow(p(-1, 0), -2)).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: Infinity },
      domainClipped: 'hi',
    });
    expect(IA.pow(p(0), -1)).toEqual({ kind: 'empty' });
    // 0 inside the base: a pole inside.
    expect(IA.pow(p(-1, 1), -1)).toEqual({ kind: 'singular' });
  });
});

describe('CE-522.6 a negative point base over an exponent interval', () => {
  test('the symmetric hull [−M, M]', () => {
    // Before: `empty`, while (−2)^1 and (−2)^2 exist.
    expect(IA.powInterval(p(-2), p(1, 2))).toEqual({
      kind: 'interval',
      value: { lo: -4, hi: 4 },
    });
    expect(IA.powInterval(p(-1), p(0.2, 0.8))).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: 1 },
    });
    // (−2)^(5/3) = −2^(5/3) ≈ −3.1748, a real-branch value.
    const r = IA.powInterval(p(-2), p(1.2, 1.8));
    expect(valueOf(r).lo).toBeLessThanOrEqual(-Math.pow(2, 5 / 3));
    expect(valueOf(r).hi).toBeGreaterThanOrEqual(Math.pow(2, 1.8));
    const small = IA.powInterval(p(-0.5), p(1, 2));
    expect(contains(small, [-1n, 2n])).toBe(true);
    expect(contains(small, [1n, 4n])).toBe(true);
  });

  test('a base interval with a negative part: the hull of the two parts', () => {
    // Before: `empty` for `[−3, −2]^[1, 2]`, and `partial [0, 1]` for
    // `[−1, 1]^[1, 2]`, which excluded `(−1)^1 = −1`.
    const neg = IA.powInterval(p(-3, -2), p(1, 2));
    expect(neg).toEqual({ kind: 'interval', value: { lo: -9, hi: 9 } });
    for (const v of [-2n, -3n, -9n, 4n, 9n])
      expect(contains(neg, [v, 1n])).toBe(true);

    const across = IA.powInterval(p(-1, 1), p(1, 2));
    expect(across).toEqual({ kind: 'interval', value: { lo: -1, hi: 1 } });
    for (const v of [-1n, 0n, 1n]) expect(contains(across, [v, 1n])).toBe(true);
    expect(contains(across, [1n, 4n])).toBe(true); // (−0.5)^2

    // A fractional exponent: the real-branch values (−2.5)^(5/3) ≈ −4.6 and
    // 2^1.8 ≈ 3.48 are inside.
    const frac53 = IA.powInterval(p(-2.5, 2), p(1.2, 1.8));
    expect(valueOf(frac53).lo).toBeLessThanOrEqual(-Math.pow(2.5, 5 / 3));
    expect(valueOf(frac53).hi).toBeGreaterThanOrEqual(Math.pow(2.5, 1.8));

    // The negative part reaching 0 with an exponent that can be negative is
    // unbounded on both sides.
    expect(IA.powInterval(p(-1, 0), p(-1, -0.5))).toEqual({
      kind: 'interval',
      value: { lo: -Infinity, hi: Infinity },
    });
  });

  test('a point exponent that is not an integer still has no value', () => {
    expect(IA.powInterval(p(-2), p(1.5))).toEqual({ kind: 'empty' });
  });
});

describe('CE-522.7 a negative integer power rounds outward at each step', () => {
  test('the subnormal intermediate of x^−3', () => {
    const x = 1.9678349534779586e-103;
    const r = IA.pow(p(x), -3);
    const [n, d] = frac(x);
    const exact: Fraction = [d ** 3n, n ** 3n];
    expect(contains(r, exact)).toBe(true);
    // The value before the fix excluded the true value.
    expect(lt(exact, frac(1.3123025984121744e308))).toBe(true);
  });

  test('exact powers stay exact', () => {
    expect(IA.pow(p(2), -1)).toEqual({
      kind: 'interval',
      value: { lo: 0.5, hi: 0.5 },
    });
    expect(IA.pow(p(0.5), -2)).toEqual({
      kind: 'interval',
      value: { lo: 4, hi: 4 },
    });
    expect(IA.pow(p(-2, -1), -3)).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: -0.125 },
    });
  });

  test('a sweep of points is enclosed', () => {
    // A deterministic sequence of points over many binades.
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 300; i++) {
      const x =
        (random() - 0.5) * Math.pow(10, Math.floor(random() * 120) - 60);
      if (x === 0) continue;
      const n = 1 + Math.floor(random() * 5);
      const r = IA.pow(p(x), -n);
      const [a, b] = frac(x);
      // x^−n = b^n / a^n, with the sign moved to the numerator.
      let num = b ** BigInt(n);
      let den = a ** BigInt(n);
      if (den < 0n) {
        num = -num;
        den = -den;
      }
      expect(contains(r, [num, den])).toBe(true);
    }
  });
});

describe('CE-522.8 the angular unit on interval-js uses exact factors', () => {
  test('Cos at a quarter turn contains 0', () => {
    const ce = new ComputeEngine();
    const ijs = ce._getCompilationTarget('interval-js')!;
    const cases = [
      ['turn', 0.25],
      ['deg', 90],
      ['grad', 100],
    ] as const;
    for (const [unit, quarter] of cases) {
      ce.angularUnit = unit;
      const cos = ijs.compile(ce.parse('\\cos(x)')).run!({
        x: { lo: quarter, hi: quarter },
      }) as IntervalResult;
      const { lo, hi } = valueOf(cos);
      expect(lo).toBeLessThanOrEqual(0);
      expect(hi).toBeGreaterThanOrEqual(0);
      // The inverse head scales its result by the reciprocal factor.
      const asin = ijs.compile(ce.parse('\\arcsin(x)')).run!({
        x: { lo: 1, hi: 1 },
      }) as IntervalResult;
      expect(valueOf(asin).lo).toBeLessThanOrEqual(quarter);
      expect(valueOf(asin).hi).toBeGreaterThanOrEqual(quarter);
    }
  });

  test('the other targets keep the float factors', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    const js = ce._getCompilationTarget('javascript')!;
    expect(js.compile(ce.parse('\\sin(x)')).run!({ x: 90 })).toBe(1);
  });
});

describe('CE-522.9 fract rounds the subtraction outward', () => {
  test('a tiny negative point', () => {
    // Before: the point `[1, 1]`, while the fractional part is below 1.
    const x = -1e-20;
    const r = IA.fract(p(x));
    const [n, d] = frac(x);
    const exact: Fraction = [d + n, d];
    expect(lt(exact, [1n, 1n])).toBe(true);
    expect(contains(r, exact)).toBe(true);
  });

  test('an exact difference is kept exact', () => {
    expect(IA.fract(p(2.5))).toEqual({
      kind: 'interval',
      value: { lo: 0.5, hi: 0.5 },
    });
    expect(IA.fract(p(-0.75, -0.5))).toEqual({
      kind: 'interval',
      value: { lo: 0.25, hi: 0.5 },
    });
  });
});

describe('The run-time helpers of the enclosure kind', () => {
  const whole = { kind: 'interval', value: { lo: -Infinity, hi: Infinity } };

  test('enclose', () => {
    expect(IA.enclose({ kind: 'interval', value: p(1, 2) })).toEqual({
      kind: 'interval',
      value: p(1, 2),
    });
    expect(
      IA.enclose({ kind: 'partial', value: p(0, 2), domainClipped: 'lo' })
    ).toEqual({ kind: 'interval', value: p(0, 2) });
    expect(IA.enclose({ kind: 'singular', at: 1, value: p(0, 1) })).toEqual({
      kind: 'interval',
      value: p(0, 1),
    });
    expect(IA.enclose({ kind: 'singular', at: 0 })).toEqual(whole);
    expect(IA.enclose({ kind: 'entire' })).toEqual(whole);
    expect(IA.enclose({ kind: 'empty' })).toEqual({ kind: 'empty' });
    expect(IA.enclose({ kind: 'empty', missing: true })).toEqual({
      kind: 'empty',
    });
    expect(IA.enclose({ kind: 'interval', value: p(NaN) })).toEqual({
      kind: 'empty',
    });
    expect(IA.enclose({ kind: 'interval', value: p(Infinity) })).toEqual({
      kind: 'empty',
    });
    expect(IA.enclose({ kind: 'interval', value: p(-Infinity) })).toEqual({
      kind: 'empty',
    });
    // An unbounded enclosure is kept.
    expect(IA.enclose({ kind: 'interval', value: p(0, Infinity) })).toEqual({
      kind: 'interval',
      value: p(0, Infinity),
    });
    // A bare `{ lo, hi }` (what `point` returns) is an enclosure.
    expect(IA.enclose(p(3))).toEqual({ kind: 'interval', value: p(3) });
  });

  test('stripEnclosure keeps an infinite singleton and the absence flag', () => {
    expect(
      IA.stripEnclosure({
        kind: 'partial',
        value: p(0, 2),
        domainClipped: 'lo',
      })
    ).toEqual({ kind: 'interval', value: p(0, 2) });
    expect(IA.stripEnclosure({ kind: 'singular' })).toEqual(whole);
    expect(IA.stripEnclosure({ kind: 'entire' })).toEqual(whole);
    expect(IA.stripEnclosure({ kind: 'interval', value: p(Infinity) })).toEqual(
      { kind: 'interval', value: p(Infinity) }
    );
    expect(IA.stripEnclosure({ kind: 'empty', missing: true })).toEqual({
      kind: 'empty',
      missing: true,
    });
    expect(IA.stripEnclosure({ kind: 'empty' })).toEqual({ kind: 'empty' });
  });

  test('finiteOperand', () => {
    expect(IA.finiteOperand(p(Infinity))).toEqual({ kind: 'empty' });
    expect(IA.finiteOperand({ kind: 'interval', value: p(-Infinity) })).toEqual(
      { kind: 'empty' }
    );
    const unbounded = p(0, Infinity);
    expect(IA.finiteOperand(unbounded)).toBe(unbounded);
    const finite = { kind: 'interval' as const, value: p(1, 2) };
    expect(IA.finiteOperand(finite)).toBe(finite);
    // With the guard, `[0, 1] · +∞` is `empty`, not the kernel's `[0, +∞]`.
    expect(IA.mul(p(0, 1), IA.finiteOperand(p(Infinity)))).toEqual({
      kind: 'empty',
    });
  });
});

/** The enclosure of a result, or `undefined` when it has none. */
function getValueOf(r: IntervalResult): Interval | undefined {
  return 'value' in r ? r.value : undefined;
}
