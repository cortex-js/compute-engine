import {
  fpmul,
  fpdiv,
  fpsqrt,
  bigintAbs,
  bigintSign,
  bigintDigits,
} from '../../src/big-decimal/utils';

const SCALE20 = 10n ** 20n;

// ================================================================
// bigintAbs
// ================================================================

describe('bigintAbs', () => {
  test('positive', () => {
    expect(bigintAbs(42n)).toBe(42n);
  });

  test('negative', () => {
    expect(bigintAbs(-42n)).toBe(42n);
  });

  test('zero', () => {
    expect(bigintAbs(0n)).toBe(0n);
  });

  test('large negative', () => {
    const n = -(10n ** 100n);
    expect(bigintAbs(n)).toBe(10n ** 100n);
  });
});

// ================================================================
// bigintSign
// ================================================================

describe('bigintSign', () => {
  test('positive', () => {
    expect(bigintSign(42n)).toBe(1n);
  });

  test('negative', () => {
    expect(bigintSign(-42n)).toBe(-1n);
  });

  test('zero', () => {
    expect(bigintSign(0n)).toBe(0n);
  });
});

// ================================================================
// bigintDigits
// ================================================================

describe('bigintDigits', () => {
  test('zero has 1 digit', () => {
    expect(bigintDigits(0n)).toBe(1);
  });

  test('single digit', () => {
    expect(bigintDigits(7n)).toBe(1);
  });

  test('two digits', () => {
    expect(bigintDigits(42n)).toBe(2);
  });

  test('negative number counts absolute digits', () => {
    expect(bigintDigits(-123n)).toBe(3);
  });

  test('large number', () => {
    expect(bigintDigits(10n ** 99n)).toBe(100);
  });

  test('power of 10', () => {
    expect(bigintDigits(1000n)).toBe(4);
  });
});

// ================================================================
// fpmul
// ================================================================

describe('fpmul', () => {
  test('1.5 * 2.0 = 3.0 at scale 10^20', () => {
    // 1.5 in fixed-point = 15 * 10^19
    const a = 15n * 10n ** 19n;
    // 2.0 in fixed-point = 2 * 10^20
    const b = 2n * SCALE20;

    const result = fpmul(a, b, SCALE20);
    // Expected: 3.0 in fixed-point = 3 * 10^20
    expect(result).toBe(3n * SCALE20);
  });

  test('0.5 * 0.5 = 0.25', () => {
    const half = SCALE20 / 2n;
    const result = fpmul(half, half, SCALE20);
    // 0.25 * scale = scale / 4
    expect(result).toBe(SCALE20 / 4n);
  });

  test('multiply by zero', () => {
    expect(fpmul(42n * SCALE20, 0n, SCALE20)).toBe(0n);
  });

  test('multiply by one', () => {
    const a = 123n * SCALE20;
    expect(fpmul(a, SCALE20, SCALE20)).toBe(a);
  });
});

// ================================================================
// fpdiv
// ================================================================

describe('fpdiv', () => {
  test('1.0 / 3.0 approximation at scale 10^20', () => {
    const one = SCALE20;
    const three = 3n * SCALE20;

    const result = fpdiv(one, three, SCALE20);
    // result / scale should be close to 1/3
    // 1/3 * 10^20 = 33333333333333333333.333...
    // bigint division truncates, so result = 33333333333333333333n
    const expected = 33333333333333333333n;
    expect(result).toBe(expected);
  });

  test('6.0 / 2.0 = 3.0', () => {
    const six = 6n * SCALE20;
    const two = 2n * SCALE20;
    const result = fpdiv(six, two, SCALE20);
    expect(result).toBe(3n * SCALE20);
  });

  test('divide by one', () => {
    const a = 42n * SCALE20;
    expect(fpdiv(a, SCALE20, SCALE20)).toBe(a);
  });
});

// ================================================================
// fpsqrt
// ================================================================

describe('fpsqrt', () => {
  test('sqrt(0) = 0', () => {
    expect(fpsqrt(0n, SCALE20)).toBe(0n);
  });

  test('sqrt(4) = 2 exactly', () => {
    // 4 in fixed-point = 4 * scale
    const four = 4n * SCALE20;
    const result = fpsqrt(four, SCALE20);
    // Should be 2 * scale
    expect(result).toBe(2n * SCALE20);
  });

  test('sqrt(1) = 1 exactly', () => {
    const one = SCALE20;
    const result = fpsqrt(one, SCALE20);
    expect(result).toBe(SCALE20);
  });

  test('sqrt(9) = 3 exactly', () => {
    const nine = 9n * SCALE20;
    const result = fpsqrt(nine, SCALE20);
    expect(result).toBe(3n * SCALE20);
  });

  test('sqrt(2) verified by squaring', () => {
    const two = 2n * SCALE20;
    const sqrtTwo = fpsqrt(two, SCALE20);

    // sqrtTwo^2 / scale should be very close to 2 * scale
    const squared = (sqrtTwo * sqrtTwo) / SCALE20;
    const diff = bigintAbs(squared - two);

    // Difference should be at most a few ULPs
    expect(diff <= 2n).toBe(true);
  });

  test('sqrt(2) starts with correct digits', () => {
    const scale50 = 10n ** 50n;
    const two = 2n * scale50;
    const result = fpsqrt(two, scale50);

    // sqrt(2) = 1.41421356237309504880168872420969807856967187537694...
    // In fixed-point at scale 10^50, this is:
    // 141421356237309504880168872420969807856967187537694...
    const resultStr = result.toString();
    expect(resultStr.startsWith('14142135623730950488')).toBe(true);
  });

  test('sqrt of large perfect square', () => {
    // 10000 = 100^2
    const val = 10000n * SCALE20;
    const result = fpsqrt(val, SCALE20);
    expect(result).toBe(100n * SCALE20);
  });

  test('throws for negative input', () => {
    expect(() => fpsqrt(-1n * SCALE20, SCALE20)).toThrow('negative');
  });

  test('sqrt with high precision (scale 10^100)', () => {
    const scale100 = 10n ** 100n;
    const two = 2n * scale100;
    const result = fpsqrt(two, scale100);

    // Verify by squaring
    const squared = (result * result) / scale100;
    const diff = bigintAbs(squared - two);
    expect(diff <= 2n).toBe(true);
  });
});
