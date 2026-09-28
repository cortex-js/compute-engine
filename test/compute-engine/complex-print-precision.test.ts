/**
 * The printed real part of a big-decimal complex value is rounded to the
 * working precision, as a real big-decimal value is.
 *
 * The value keeps its extra digits (guard digits from the `Sqrt` kernel, or
 * the unrounded product of `Multiply`); `toJSON()` shows them. Only
 * `toString()` rounds. The real-only branch of `BigNumericValue.toString()`
 * rounded to `BigDecimal.precision`, but the complex branch printed every
 * digit of the real part: `(1.414213562373095048801689 + 1.4142135623730951i)`
 * and `(5.224851674121679747327997452771991010463873012 + 5.22485167412168i)`
 * at the default 21 digits.
 *
 * The imaginary part is a big decimal too (design note
 * `docs/plans/2026-09-27-big-decimal-imaginary-part.md`, Phase 2), and it is
 * rounded to the working precision in the same way. It was a machine double
 * and printed 17 digits.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** The number of significant digits of a decimal spelling. */
function significantDigits(s: string): number {
  const mantissa = s.replace(/^[+-]/, '').replace(/e.*$/i, '');
  return mantissa.replace('.', '').replace(/^0+/, '').length;
}

/** The real part of a printed complex value `(re ± im i)`. */
function printedRealPart(s: string): string {
  const match = /^\(([^ ]+) [+-] /.exec(s);
  if (!match) throw new Error(`not a complex value: ${s}`);
  return match[1];
}

describe('COMPLEX PRINT PRECISION', () => {
  test('the working precision is 21 digits', () => {
    expect(ce.precision).toBe(21);
  });

  test('√2 + √2i under N()', () => {
    const s = ce.parse('\\sqrt2+\\sqrt2 i').N().toString();
    const re = printedRealPart(s);
    expect(significantDigits(re)).toBeLessThanOrEqual(ce.precision);
    // √2 = 1.41421356237309504880168872…, rounded to 21 digits.
    expect(re).toBe('1.4142135623730950488');
    expect(s).toBe('(1.4142135623730950488 + 1.4142135623730950488i)');
  });

  test('(√2/2)(1 + i) · e² under N()', () => {
    const x = ce
      .box([
        'Multiply',
        ['Complex', ['Divide', ['Sqrt', 2], 2], ['Divide', ['Sqrt', 2], 2]],
        ['Power', 'ExponentialE', 2],
      ])
      .N();
    const re = printedRealPart(x.toString());
    expect(significantDigits(re)).toBeLessThanOrEqual(ce.precision);
    // (√2/2) · e² = 5.22485167412167974732799745…, rounded to 21 digits.
    expect(re).toBe('5.22485167412167974733');
    expect(Number(re)).toBeCloseTo(Math.SQRT1_2 * Math.exp(2), 13);
    expect(x.im).toBeCloseTo(Math.SQRT1_2 * Math.exp(2), 13);
  });

  test('the printed real value is unchanged', () => {
    expect(ce.parse('\\sqrt2').N().toString()).toBe('1.4142135623730950488');
    expect(
      ce
        .box([
          'Multiply',
          ['Divide', ['Sqrt', 2], 2],
          ['Power', 'ExponentialE', 2],
        ])
        .N()
        .toString()
    ).toBe('5.22485167412167974733');
  });
});
