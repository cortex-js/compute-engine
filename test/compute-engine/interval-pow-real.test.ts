/**
 * `powReal` of the interval library (`interval/elementary.ts`): the power of
 * the interval mode of the IR pipeline. A point exponent that is not an
 * integer is read as the interpreter reads a float exponent
 * (`realPowerBranchTerms()`): a rational of odd denominator is the real
 * root of a negative base, anything else has no real value there.
 */

import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';
import { realPowerBranchTerms } from '../../src/compute-engine/numerics/real-power';

const I = (lo: number, hi: number) => ({ lo, hi });

describe('powReal', () => {
  test('a point integer exponent is the integer power', () => {
    expect(IA.powReal(I(-1, 2), I(2, 2))).toEqual(
      IA.powInterval(I(-1, 2), I(2, 2))
    );
    expect(IA.powReal(I(-1, 2), I(2, 2))).toEqual({
      kind: 'interval',
      value: I(0, 4),
    });
    expect(IA.powReal(I(-2, -1), I(3, 3))).toEqual({
      kind: 'interval',
      value: I(-8, -1),
    });
    expect(IA.powReal(I(-1, 8), I(-2, -2)).kind).toBe('singular');
  });

  test('a point integer exponent above 1024 is not widened', () => {
    const even = IA.powReal(I(-1.001, -1), I(2000, 2000));
    expect(even).toEqual(IA.powInterval(I(-1.001, -1), I(2000, 2000)));
    expect(even.kind).toBe('interval');
    expect((even as { value: { lo: number } }).value.lo).toBeGreaterThan(0);
    const odd = IA.powReal(I(-1.001, -1), I(2001, 2001));
    expect(odd).toEqual(IA.powInterval(I(-1.001, -1), I(2001, 2001)));
    expect(odd.kind).toBe('interval');
    expect((odd as { value: { hi: number } }).value.hi).toBeLessThan(0);
  });

  test('a float read as a rational of odd denominator is the real root', () => {
    // `x^0.2` at -8 is -1.5157… in the interpreter (`0.2` read as `1/5`).
    const r = IA.powReal(I(-8, -1), I(0.2, 0.2));
    expect(r).toEqual(IA.powRealBranch(I(-8, -1), 0.2, true));
    const v = (r as { value: { lo: number; hi: number } }).value;
    expect(v.lo).toBeLessThanOrEqual(-1.5157165665103982);
    expect(v.hi).toBeGreaterThanOrEqual(-1);
    expect(v.hi).toBeLessThan(-0.999);
    // `0.4` is `2/5`: an even numerator, a positive root.
    const even = IA.powReal(I(-32, -32), I(0.4, 0.4));
    expect(even).toEqual(IA.powRealBranch(I(-32, -32), 0.4, false));
    expect((even as { value: { lo: number } }).value.lo).toBeGreaterThan(3.99);
    // Over a base across 0: the hull of both sides.
    expect(IA.powReal(I(-8, 8), I(0.2, 0.2))).toEqual(
      IA.powRealBranch(I(-8, 8), 0.2, true)
    );
    // `powInterval` alone gives no value over the negative base.
    expect(IA.powInterval(I(-8, -1), I(0.2, 0.2))).toEqual({ kind: 'empty' });
  });

  test('any other float has no real value over a negative base', () => {
    // An even denominator (`1.5` is `3/2`), or no rational (`3.87` is
    // `387/100`, an even denominator; `Math.PI` none).
    for (const e of [1.5, 2.5, 0.75, 3.87, Math.PI]) {
      expect(IA.powReal(I(-8, -1), I(e, e))).toEqual({ kind: 'empty' });
      expect(IA.powReal(I(-1, 4), I(e, e))).toEqual(
        IA.powInterval(I(-1, 4), I(e, e))
      );
    }
  });

  test('the digits of the reading', () => {
    // `0.333333333333333` (15 digits) is `1/3` when read to 15 digits, and
    // no rational of odd denominator when read to 17.
    const e = 0.333333333333333;
    expect(realPowerBranchTerms(undefined, e, 15)).toEqual([1, 3]);
    expect(realPowerBranchTerms(undefined, e, 17)).toBeUndefined();
    expect(IA.powReal(I(-8, -8), I(e, e), 15).kind).toBe('interval');
    expect(IA.powReal(I(-8, -8), I(e, e), 17)).toEqual({ kind: 'empty' });
  });

  test('the digits are clamped to [15, 17]; any other value is the default', () => {
    // NaN digits would make every reconstruction pass; 3 digits would
    // read almost any float as a small rational.
    const e = 0.333333333333333;
    const b = I(-8, -8);
    expect(IA.powReal(b, I(e, e), 3)).toEqual(IA.powReal(b, I(e, e), 15));
    expect(IA.powReal(b, I(e, e), 40)).toEqual(IA.powReal(b, I(e, e), 17));
    expect(IA.powReal(b, I(e, e), NaN)).toEqual(IA.powReal(b, I(e, e)));
    expect(IA.powReal(b, I(3.87, 3.87), NaN)).toEqual({ kind: 'empty' });
  });

  test('an exponent at an edge of the doubles gives a sound value', () => {
    // NaN, the infinities, the zeros, a subnormal, 2^53 and 2^53 + 2: the
    // reading is bounded, and each result is a kinded value.
    const edges = [NaN, Infinity, -Infinity, 0, -0, 5e-324, -5e-324,
      2 ** 53, 2 ** 53 + 2, 1e308, 1e-308];
    for (const e of edges) {
      // The reading ends: terms or none.
      const terms = realPowerBranchTerms(undefined, e);
      expect(terms === undefined || terms.length === 2).toBe(true);
      for (const b of [I(-8, -1), I(-2, 3), I(0.5, 4)]) {
        const r = IA.powReal(b, I(e, e), 17);
        expect(typeof r.kind).toBe('string');
      }
    }
    // `x^0` is 1, `x^NaN` has no value.
    expect(IA.powReal(I(-2, 3), I(0, 0))).toEqual({ kind: 'interval', value: I(1, 1) });
    // A subnormal is read as `0/1`, an odd denominator: the real root of
    // magnitude about 1, as the interpreter gives.
    const tiny = IA.powReal(I(-8, -1), I(5e-324, 5e-324));
    expect(tiny.kind).toBe('interval');
    const v = (tiny as { value: { lo: number; hi: number } }).value;
    expect(v.lo).toBeLessThanOrEqual(1);
    expect(v.hi).toBeGreaterThanOrEqual(1);
    // `2^53 + 2` is an integer: the integer power, an even one.
    const big = IA.powReal(I(-1, -1), I(2 ** 53 + 2, 2 ** 53 + 2));
    expect(big).toEqual(IA.powInterval(I(-1, -1), I(2 ** 53 + 2, 2 ** 53 + 2)));
  });

  test('a positive base over a float exponent encloses the power', () => {
    const r = IA.powReal(I(1, 8), I(0.2, 0.2));
    const v = (r as { value: { lo: number; hi: number } }).value;
    expect(v.lo).toBeLessThanOrEqual(1);
    expect(v.hi).toBeGreaterThanOrEqual(Math.pow(8, 0.2));
    expect(v.hi - Math.pow(8, 0.2)).toBeLessThan(1e-15);
  });

  test('the marks of a kinded operand are kept', () => {
    const jump = IA.floor(I(0.5, 1.5));
    expect(IA.powReal(I(2, 3), jump)).toMatchObject({
      kind: 'singular',
      at: 1,
    });
    const partial = IA.sqrt(I(-1, 4));
    // As `powInterval` gives it: an operation does not know which end of
    // its result the edge of the domain maps to.
    expect(IA.powReal(partial, I(0.5, 0.5))).toEqual(
      IA.powInterval(partial, I(0.5, 0.5))
    );
    expect(IA.powReal(partial, I(0.5, 0.5)).kind).toBe('partial');
    expect(IA.powReal({ kind: 'empty' }, I(0.5, 0.5))).toEqual({
      kind: 'empty',
    });
    expect(IA.powReal(I(1, 2), { kind: 'entire' })).toEqual({ kind: 'entire' });
  });
});
