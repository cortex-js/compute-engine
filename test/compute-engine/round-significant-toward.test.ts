import { BigDecimal } from '../../src/big-decimal/index';
import {
  MIN_NORMAL_DOUBLE,
  roundSignificantToward,
} from '../../src/compute-engine/numerics/interval-arithmetic';

// `roundSignificantToward` is the double-arithmetic replacement for the
// decimal rounding `new BigDecimal(x).toPrecisionToward(n, dir).toNumber()`
// that coarsens every derived range bound and every literal enclosure. Its
// contract is to give the SAME double as the decimal route on every finite
// normal input, so this test compares the two on a fixed sample set that
// covers the ways the double route could drift: grid points and their
// neighbours (where the mantissa division rounds across an integer), values
// next to a power of ten (where `log10` rounds to the wrong decade), the
// exponent range beyond ±22 (where a power of ten is no longer exact),
// integers of magnitude 2⁵³ and above (where the decimal route reads the
// exact binary integer), subnormals (where an outward rounding can re-enter
// the normal range), and both signs.

function decimalRoute(x: number, digits: number, dir: 'floor' | 'ceiling') {
  return new BigDecimal(x).toPrecisionToward(digits, dir).toNumber();
}

function sampleSet(): number[] {
  const xs: number[] = [];
  let seed = 424242;
  const rnd = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 4000; i++) {
    const e = Math.floor(rnd() * 600) - 300;
    xs.push((1 + rnd() * 9) * 10 ** e);
  }
  for (const digits of [2, 4]) {
    const step = digits === 2 ? 1 : 97;
    for (let k = -30; k <= 30; k += 3)
      for (let r = 10 ** (digits - 1); r < 10 ** digits; r += step) {
        const g = Number(`${r}e${k}`);
        xs.push(
          g,
          g * (1 + Number.EPSILON),
          g * (1 - Number.EPSILON),
          g * (1 + 2 * Number.EPSILON),
          g * (1 - 2 * Number.EPSILON),
          g + 1.4 * 10 ** k,
          g * 1.4
        );
      }
  }
  for (let k = -300; k <= 300; k++) {
    const p = 10 ** k;
    xs.push(p, p * (1 - Number.EPSILON), p * (1 + Number.EPSILON));
  }
  xs.push(
    9.999999999999999e-6, // `log10` answers exactly -5 here
    2.4 + 1.4,
    2.4 * 1.4,
    0.1 + 0.2,
    Math.SQRT2,
    Math.sqrt(6),
    Math.PI,
    2 ** 53,
    2 ** 53 + 2,
    4.73e21,
    4.83e21,
    12345678901234567890,
    1e22,
    1e23,
    1.7976931348623157e308,
    // subnormals, including the largest one
    5e-324,
    1e-310,
    2.225073858507201e-308,
    MIN_NORMAL_DOUBLE
  );
  return xs.filter((x) => Number.isFinite(x) && x !== 0);
}

describe('roundSignificantToward agrees with the decimal route', () => {
  const xs = sampleSet();

  test('sample set is large', () => {
    expect(xs.length).toBeGreaterThan(5000);
  });

  for (const digits of [2, 4]) {
    for (const dir of ['floor', 'ceiling'] as const) {
      test(`${digits} digits, ${dir}`, () => {
        const mismatches: string[] = [];
        for (const x0 of xs) {
          for (const x of [x0, -x0]) {
            const a = roundSignificantToward(x, digits, dir);
            const b = decimalRoute(x, digits, dir);
            if (a !== b && !(Number.isNaN(a) && Number.isNaN(b)))
              mismatches.push(`${x}: ${a} vs ${b}`);
          }
        }
        expect(mismatches.slice(0, 5)).toEqual([]);
      });
    }
  }

  test('a bound never crosses the value and prints compactly', () => {
    expect(roundSignificantToward(1.2, 2, 'floor')).toBe(1.2);
    expect(roundSignificantToward(1.2, 2, 'ceiling')).toBe(1.2);
    expect(roundSignificantToward(Math.sqrt(6), 2, 'floor')).toBe(2.4);
    expect(roundSignificantToward(Math.sqrt(6), 2, 'ceiling')).toBe(2.5);
    expect(roundSignificantToward(-Math.sqrt(6), 2, 'floor')).toBe(-2.5);
    expect(roundSignificantToward(-Math.sqrt(6), 2, 'ceiling')).toBe(-2.4);
    expect(roundSignificantToward(9.999999999999999e-6, 2, 'floor')).toBe(
      9.9e-6
    );
    expect(
      roundSignificantToward(9.9e29 * (1 + Number.EPSILON), 2, 'floor')
    ).toBe(9.9e29);
    expect(String(roundSignificantToward(1.234567, 4, 'ceiling'))).toBe(
      '1.235'
    );
  });
});
