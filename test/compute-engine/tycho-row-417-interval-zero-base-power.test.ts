/**
 * Tycho ledger row 417: on the `interval-js` target, `0^x` over an exponent
 * interval answered `empty`, where the value is 0 at every point of the
 * interval above 0.
 *
 * The interval-exponent kernel `powIntervalRaw()` (`interval/elementary.ts`)
 * read a base with `hi <= 0` as a negative base, which has no real value at a
 * non-integer exponent, so the point base `[0, 0]` (the literal `0^{x}`, or
 * a declared symbol holding 0) made the whole box `empty`. The scalar sibling
 * `powRaw()` tested `hi < 0` and was right. Tycho's adaptive line sampler
 * reads a row through the interval leg, so a row with a slider at 0 drew
 * nothing.
 *
 * A base whose only point in the domain is 0 has three readings of the
 * exponent: positive (the value 0), zero (the value 1, the file's own
 * convention for `x^0`), negative (undefined). A wholly negative exponent
 * leaves no defined point in the box, so the answer is `empty`, not a
 * clipped enclosure with an infinite bound; both kernels gave the latter.
 */

import { ComputeEngine, compile } from '../../src/compute-engine';
import { pow, powInterval } from '../../src/compute-engine/interval/elementary';

const I = (lo: number, hi: number) => ({ lo, hi });

/** The result as `[kind, lo, hi]`, for compact pinning. */
function shape(r: unknown): [string, number, number] | [string] {
  const v = r as { kind: string; value?: { lo: number; hi: number } };
  if (v.value === undefined) return [v.kind];
  return [v.kind, v.value.lo, v.value.hi];
}

describe('Tycho 417 — the point base 0 under an interval exponent', () => {
  test('a positive exponent interval gives the value 0', () => {
    expect(shape(powInterval(I(0, 0), I(0.2, 0.4)))).toEqual([
      'interval',
      0,
      0,
    ]);
    expect(shape(powInterval(I(0, 0), I(0.5, 0.5)))).toEqual([
      'interval',
      0,
      0,
    ]);
    expect(shape(powInterval(I(0, 0), I(1.5, 100)))).toEqual([
      'interval',
      0,
      0,
    ]);
  });

  test('an exponent interval reaching 0 from above contains the value 1', () => {
    expect(shape(powInterval(I(0, 0), I(0, 0.5)))).toEqual(['interval', 0, 1]);
  });

  test('an exponent interval reaching below 0 is clipped', () => {
    // Both limits are reached: 0 for the positive exponents, 1 at 0.
    expect(shape(powInterval(I(0, 0), I(-0.5, 0.5)))).toEqual([
      'partial',
      0,
      1,
    ]);
    // Only the exponent 0 has a value.
    expect(shape(powInterval(I(0, 0), I(-0.5, 0)))).toEqual(['partial', 1, 1]);
  });

  test('a wholly negative exponent interval leaves no defined point', () => {
    expect(shape(powInterval(I(0, 0), I(-1.5, -0.5)))).toEqual(['empty']);
  });

  test('a base reaching 0 from below is clipped to its one defined point', () => {
    // At a non-integer POINT exponent the negative part of the base has no
    // real value, and the box is clipped to the point 0.
    expect(shape(powInterval(I(-1, 0), I(0.3, 0.3)))).toEqual([
      'partial',
      0,
      0,
    ]);
    expect(shape(powInterval(I(-1, 0), I(-0.5, -0.5)))).toEqual(['empty']);
    // Over an exponent INTERVAL the negative part has real values at every
    // exponent that is a rational with an odd denominator (CE-522.6). The
    // old answers excluded them: `partial [0, 0]` left out `(−1)^(1/3) = −1`,
    // and `empty` left out `(−1)^−1 = −1`. The answer is the hull `[−M, M]`
    // of the negative part joined with the image of the point 0.
    expect(shape(powInterval(I(-1, 0), I(0.2, 0.4)))).toEqual([
      'interval',
      -1.0000000000000002,
      1.0000000000000002,
    ]);
    expect(shape(powInterval(I(-1, 0), I(-1.5, -0.5)))).toEqual([
      'interval',
      -Infinity,
      Infinity,
    ]);
  });

  test('the neighbouring cases are unchanged', () => {
    // CE-522.6: `[−2, −1]^[1.5, 2.5]` was `empty`, which excluded
    // `(−1.5)^2 = 2.25`, a real value on the box (the exponent interval
    // holds 2). The answer is `[−M, M]` with `M = 2^2.5`, rounded outward.
    const [hullKind, hullLo, hullHi] = shape(
      powInterval(I(-2, -1), I(1.5, 2.5))
    ) as [string, number, number];
    expect(hullKind).toBe('interval');
    expect(hullLo).toBeLessThanOrEqual(-(2 ** 2.5));
    expect(hullHi).toBeGreaterThanOrEqual(2 ** 2.5);
    expect(hullHi).toBeLessThan(5.6569);
    // A non-integer point exponent over a negative base has no real value.
    expect(shape(powInterval(I(-2, -1), I(1.5, 1.5)))).toEqual(['empty']);
    expect(shape(powInterval(I(-1, -1), I(1.5, 2.5)))).toEqual([
      'interval',
      -1,
      1,
    ]);
    expect(shape(powInterval(I(0, 0), I(2, 2)))).toEqual(['interval', 0, 0]);
    expect(shape(powInterval(I(0, 0), I(0, 0)))).toEqual(['interval', 1, 1]);
    const [kind, lo] = shape(powInterval(I(0, 2), I(0.2, 0.4)));
    expect(kind).toBe('interval');
    expect(lo).toBe(0);
  });
});

describe('Tycho 417 — the point base 0 under a scalar exponent', () => {
  test('a positive fractional exponent gives the value 0', () => {
    expect(shape(pow(I(0, 0), 0.5))).toEqual(['interval', 0, 0]);
    expect(shape(pow(I(-1, 0), 0.5))).toEqual(['partial', 0, 0]);
  });

  test('a negative fractional exponent leaves no defined point', () => {
    expect(shape(pow(I(0, 0), -0.5))).toEqual(['empty']);
    expect(shape(pow(I(-1, 0), -0.5))).toEqual(['empty']);
  });

  test('an absent operand stays absent', () => {
    // A NaN bound is the compile target's absence marker (an absent list
    // element): a power with one answers a NaN interval, not a value.
    const absent = I(NaN, NaN);
    const isAbsent = (r: unknown): boolean => {
      const [kind, lo, hi] = shape(r);
      return kind === 'interval' && Number.isNaN(lo) && Number.isNaN(hi);
    };
    expect(isAbsent(pow(I(0, 0), NaN))).toBe(true);
    expect(isAbsent(pow(absent, 0.5))).toBe(true);
    expect(isAbsent(powInterval(I(0, 0), absent))).toBe(true);
    expect(isAbsent(powInterval(I(-1, 0), absent))).toBe(true);
    expect(isAbsent(powInterval(absent, I(0.2, 0.4)))).toBe(true);
  });

  test('a base reaching above 0 keeps its pole', () => {
    // The lower bound `1^{-0.5}` is not certified exact, so the export
    // moves it one ulp outward.
    const [kind, lo, hi] = shape(pow(I(0, 1), -0.5));
    expect(kind).toBe('partial');
    expect(lo).toBeCloseTo(1, 12);
    expect(hi).toBe(Infinity);
  });
});

describe('Tycho 417 — the compile route', () => {
  const ce = new ComputeEngine();
  type Run = (vars: Record<string, unknown>) => unknown;
  const compiled = (latex: string): Run => {
    const out = compile(ce.parse(latex), { to: 'interval-js' }) as unknown as {
      success: boolean;
      run: Run;
      error?: unknown;
    };
    if (!out.success)
      throw new Error(`${latex} did not compile: ${String(out.error)}`);
    return out.run;
  };

  test('`0^{x}` answers 0 over a positive exponent interval', () => {
    const zero = compiled('0^{x}');
    expect(shape(zero({ x: I(0.2, 0.4) }))).toEqual(['interval', 0, 0]);
    expect(shape(zero({ x: I(0.5, 0.5) }))).toEqual(['interval', 0, 0]);
    expect(shape(zero({ x: I(-1, -0.5) }))).toEqual(['empty']);
    // The control of the instrument.
    const [kind, lo, hi] = shape(compiled('0.5^{x}')({ x: I(0.2, 0.4) }));
    expect(kind).toBe('interval');
    expect(lo).toBeCloseTo(0.5 ** 0.4, 12);
    expect(hi).toBeCloseTo(0.5 ** 0.2, 12);
  });

  test('a declared base holding 0 answers the same', () => {
    ce.assign('T', 0);
    const run = compiled('T^{x}');
    expect(shape(run({ x: I(0.2, 0.4) }))).toEqual(['interval', 0, 0]);
  });

  test("Tycho's row with the slider at 0 has a value", () => {
    // `(1 - x^2 (1 - T^x))^{V / x^3}` with `T = 0`, `V = 1`, the Desmos row
    // D-346 of the report: the interval leg must answer a finite interval
    // on a box inside the row's domain, not `empty`.
    ce.assign('T', 0);
    ce.assign('V', 1);
    const run = compiled('(1 - x^2 (1 - T^{x}))^{V / x^3}');
    const [kind, lo, hi] = shape(run({ x: I(0.2, 0.4) }));
    expect(kind).toBe('interval');
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeLessThan(1);
  });
});
