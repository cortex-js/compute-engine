/**
 * `powReal` of the interval library (`interval/elementary.ts`): the power of
 * the interval mode of the IR pipeline. A point exponent that is not an
 * integer is widened by one ulp on each side, so that a negative base gives
 * the symmetric hull where the interpreter can give a real root.
 */

import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';

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

  test('a negative base over a float exponent is the symmetric hull', () => {
    // `x^0.2` at -8 is -1.5157… in the interpreter (`0.2` read as `1/5`).
    const r = IA.powReal(I(-8, -1), I(0.2, 0.2));
    expect(r.kind).toBe('interval');
    const v = (r as { value: { lo: number; hi: number } }).value;
    expect(v.lo).toBeLessThanOrEqual(-1.5157165665103982);
    expect(v.hi).toBeGreaterThanOrEqual(1.5157165665103982);
    // `powInterval` alone gives no value there.
    expect(IA.powInterval(I(-8, -1), I(0.2, 0.2))).toEqual({ kind: 'empty' });
  });

  test('a multiple of 1/1024 is not widened: no real value over a negative base', () => {
    // The interpreter reads no such float as a rational of odd denominator.
    expect(IA.powReal(I(-8, -1), I(1.5, 1.5))).toEqual({ kind: 'empty' });
    expect(IA.powReal(I(-8, -1), I(2.5, 2.5))).toEqual({ kind: 'empty' });
    expect(IA.powReal(I(-8, -1), I(0.75, 0.75))).toEqual({ kind: 'empty' });
    expect(IA.powReal(I(-1, 4), I(1.5, 1.5))).toEqual(
      IA.powInterval(I(-1, 4), I(1.5, 1.5))
    );
    // `0.6` is not such a multiple: widened.
    expect(IA.powReal(I(-8, -1), I(0.6, 0.6)).kind).toBe('interval');
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
