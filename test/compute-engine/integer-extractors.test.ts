import { engine as ce } from '../utils';
import {
  toInteger,
  toBigint,
  asBigint,
} from '../../src/compute-engine/boxed-expression/numerics';

// `toInteger` returns a *machine* integer and is meant for counts/indices/
// sizes. It rounds non-integers and — crucially — returns null rather than a
// precision-lost value once the magnitude exceeds the safe-integer range, so
// it can never silently return a wrong large integer (the bug that bit
// `isPrime`). Exact large integers must go through `toBigint`/`asBigint`.

describe('toInteger', () => {
  test('rounds an in-range non-integer real part', () => {
    expect(toInteger(ce.number(5.4))).toBe(5);
    expect(toInteger(ce.number(5.5))).toBe(6);
    expect(toInteger(ce.number(-2.5))).toBe(-2); // Math.round rounds toward +∞
  });

  test('returns exact value for in-range integers', () => {
    expect(toInteger(ce.number(0))).toBe(0);
    expect(toInteger(ce.number(42))).toBe(42);
    expect(toInteger(ce.number(-7))).toBe(-7);
  });

  test('returns null for non-numbers', () => {
    expect(toInteger(ce.symbol('x'))).toBeNull();
    expect(toInteger(ce.string('hello'))).toBeNull();
  });

  test('returns null for non-finite values', () => {
    expect(toInteger(ce.number(NaN))).toBeNull();
    expect(toInteger(ce.PositiveInfinity)).toBeNull();
    expect(toInteger(ce.NegativeInfinity)).toBeNull();
  });

  test('returns null beyond the safe-integer range (no silent precision loss)', () => {
    expect(toInteger(ce.number(2n ** 60n))).toBeNull();
    expect(toInteger(ce.number(-(2n ** 60n)))).toBeNull();
    // 2^61 - 1 (a Mersenne prime) is the value that used to be mis-rounded.
    expect(toInteger(ce.number(2305843009213693951n))).toBeNull();
  });

  test('the exact bigint extractors stay precise where toInteger bails out', () => {
    const big = 2305843009213693951n; // 2^61 - 1, not representable as a safe number
    expect(toBigint(ce.number(big))).toBe(big);
    expect(asBigint(ce.number(big))).toBe(big);
  });
});
