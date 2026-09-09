/**
 * `powInterval` — the interval-exponent power — collapsed two different
 * situations into one clipped result, and got the clipped one wrong as well.
 *
 * A base interval reaching 0 was handled by substituting `Number.EPSILON` for
 * the zero endpoint and reporting `partial` unconditionally. Two defects:
 *
 *  1. A base TOUCHING zero from the right with a wholly POSITIVE exponent is
 *     entirely inside the domain — `0^e = 0` for every `e > 0` — so the box has
 *     a value everywhere and nothing is clipped. Reporting `partial` made a
 *     smooth field read as discontinuous on every box, and a consumer that
 *     treats `partial` as a break saw one in every cell: Tycho's
 *     `M(i) = ∫|x|^i e^{-x²}dx` answered `partial` for every non-integer `i`
 *     (item 260). The scalar-exponent sibling `powRaw` was always right here,
 *     which is why a constant exponent behaved and a symbolic one did not.
 *
 *  2. `EPSILON^e` is not a bound. For a NEGATIVE exponent the true supremum is
 *     `+∞` (`x^e → +∞` as `x → 0+`), but the substitution answered an arbitrary
 *     finite number — `1.36e39` for `e = -2.5`. An enclosure that does not
 *     contain the true range is unsound rather than merely imprecise, and could
 *     hide a pole from a consumer scanning for one. This was not reported by
 *     the consumer; it was found while fixing (1).
 *
 * The exponent now has three readings over a base reaching zero: wholly
 * positive (infimum 0, attained), spanning zero (the whole non-negative line,
 * since `x → 0+` drives the positive exponents to 0 and the negative ones to
 * `+∞`), and wholly non-positive (infimum at the far endpoint, supremum `+∞`).
 */

import { powInterval } from '../../src/compute-engine/interval/elementary';

const I = (lo: number, hi: number) => ({ lo, hi });

/** The result as `[kind, lo, hi]`, for compact pinning. */
function shape(r: unknown): [string, number, number] | [string] {
  const v = r as { kind: string; value?: { lo: number; hi: number } };
  if (v.value === undefined) return [v.kind];
  return [v.kind, v.value.lo, v.value.hi];
}

/**
 * The result's kind, with each finite bound checked as an ENCLOSING bound of
 * the value it is computed from rather than as an exact double.
 *
 * The library rounds every endpoint it cannot prove exact one ulp outward
 * (`interval/rounding.ts`), so a `Math.pow` corner comes back one ulp wide of
 * the nominal value. What these tests pin is WHICH corner (or which literal
 * bound) the routine reports, not the last bit of it.
 */
function expectShape(r: unknown, kind: string, lo: number, hi: number): void {
  const s = shape(r);
  expect(s[0]).toBe(kind);
  const [, alo, ahi] = s as [string, number, number];
  expect(alo).toBeLessThanOrEqual(lo);
  expect(ahi).toBeGreaterThanOrEqual(hi);
  if (Number.isFinite(lo)) expect(alo).toBeCloseTo(lo, 12);
  if (Number.isFinite(hi)) expect(ahi).toBeCloseTo(hi, 12);
  else expect(ahi).toBe(hi);
}

/**
 * Does the reported enclosure contain the true range? Sampled on a grid — a
 * coarse but independent check that the fix did not trade a wrong `partial`
 * for a wrong bound.
 */
function containsTrueRange(
  base: { lo: number; hi: number },
  exp: { lo: number; hi: number }
): boolean {
  const r = powInterval(base, exp) as {
    value?: { lo: number; hi: number };
  };
  if (r.value === undefined) return true;
  const N = 200;
  for (let i = 0; i <= N; i++) {
    const x = base.lo + ((base.hi - base.lo) * i) / N;
    if (x < 0) continue;
    for (let j = 0; j <= N; j++) {
      const e = exp.lo + ((exp.hi - exp.lo) * j) / N;
      const v = Math.pow(x, e);
      if (!Number.isFinite(v)) continue;
      if (v < r.value.lo - 1e-12 || v > r.value.hi + 1e-12) return false;
    }
  }
  return true;
}

describe('Tycho 260 — a base touching zero is not automatically clipped', () => {
  test('a wholly positive exponent is entirely in the domain', () => {
    expectShape(powInterval(I(0, 2), I(1.9, 2.1)), 'interval', 0, 2 ** 2.1);
    expectShape(powInterval(I(0, 2), I(0.5, 0.5)), 'interval', 0, Math.SQRT2);
    // A base below 1, where the supremum is at the LOWER exponent.
    expectShape(
      powInterval(I(0, 0.5), I(1.9, 2.1)),
      'interval',
      0,
      0.5 ** 1.9
    );
  });

  // A pole needs a NEGATIVE exponent. An exponent of exactly 0 gives `x^0 = 1`
  // for every `x`, `x = 0` included — this file's own convention, since
  // `pow([0,2], 0)` answers `[1, 1]`. Treating `expVal.lo === 0` as a pole
  // answered `+∞` for `[0,2]^[0,1]`, whose true range is `[0,2]`: sound, but it
  // discards the bound and reports the very discontinuity this fix removes.
  test('an exponent whose lower bound is exactly zero is not a pole', () => {
    expectShape(powInterval(I(0, 2), I(0, 1)), 'interval', 0, 2);
    expectShape(powInterval(I(0, 2), I(0, 3)), 'interval', 0, 8);
    expect(containsTrueRange(I(0, 2), I(0, 1))).toBe(true);
    expect(containsTrueRange(I(0, 2), I(0, 3))).toBe(true);
  });

  test('a straddling base is still partial', () => {
    const [kind, lo] = shape(powInterval(I(-1, 2), I(1.9, 2.1)));
    expect(kind).toBe('partial');
    expect(lo).toBe(0);
  });

  test('an integer point exponent is unchanged', () => {
    expect(shape(powInterval(I(0, 2), I(2, 2)))).toEqual(['interval', 0, 4]);
  });

  test('an entirely negative base has no real value', () => {
    expect(shape(powInterval(I(-2, -1), I(1.5, 2.5)))).toEqual(['empty']);
  });

  test('a wholly positive base is unchanged', () => {
    expectShape(powInterval(I(1, 2), I(1.9, 2.1)), 'interval', 1, 2 ** 2.1);
  });

  describe('a pole at zero reports an infinite supremum, not a finite one', () => {
    test('a wholly negative exponent', () => {
      expectShape(
        powInterval(I(0, 2), I(-2.5, -1.5)),
        'partial',
        2 ** -2.5,
        Infinity
      );
    });

    test('an exponent spanning zero reaches both limits', () => {
      // The infimum is 0 (the positive exponents drive it there as x -> 0+),
      // NOT the far-endpoint corner: `[0,2]^[-1,3]` contains `0.5^3 = 0.125`,
      // well under the `2^-1 = 0.5` the corners alone suggest.
      expect(shape(powInterval(I(0, 2), I(-1, 3)))).toEqual([
        'partial',
        0,
        Infinity,
      ]);
    });

    test('an exponent reaching zero from below', () => {
      expectShape(powInterval(I(0, 2), I(-1, 0)), 'partial', 0.5, Infinity);
    });
  });

  test('every reported enclosure contains the true range', () => {
    const cases: Array<[number, number, number, number]> = [
      [0, 2, 1.9, 2.1],
      [0, 2, 0.5, 0.5],
      [0, 0.5, 1.9, 2.1],
      [0, 2, -2.5, -1.5],
      [0, 2, -1, 3],
      [0, 2, -1, 0],
      [0, 2, 0, 1],
      [0, 2, 0, 3],
      [1, 2, 1.9, 2.1],
      [-1, 2, 1.9, 2.1],
    ];
    for (const [bl, bh, el, eh] of cases)
      expect([bl, bh, el, eh, containsTrueRange(I(bl, bh), I(el, eh))]).toEqual([
        bl,
        bh,
        el,
        eh,
        true,
      ]);
  });
});
