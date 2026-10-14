import {
  fpmul,
  fpdiv,
  fpsqrt,
  fpln,
  bigintAbs,
  bigintSign,
  bigintDigits,
  bitLength,
} from '../../src/big-decimal/utils';

// The fixed-point kernels work on a *binary* grid: a value is `n / 2^bits`.
// `BITS` here is a representative working scale (~24 decimal digits).
const BITS = 80;
const SCALE = 1n << BigInt(BITS);

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

  // Regression: the old `< 2^53` fast path used `Math.floor(Math.log10(x)) + 1`,
  // and `Math.log10(999999999999999) === 15` (rounds up), so it returned 16 for
  // these two fifteen-nines-class values — over-counting the digits by one. That
  // corrupted magnitude-derived consumers (`cmp` ordering, `toPrecision`).
  test('does not over-count at a power-of-ten boundary (log10 round-up)', () => {
    expect(bigintDigits(999999999999999n)).toBe(15);
    expect(bigintDigits(999999999999998n)).toBe(15);
    expect(bigintDigits(999999999999997n)).toBe(15);
    expect(bigintDigits(1000000000000000n)).toBe(16); // 10^15, genuinely 16
  });

  test('exact digit count across every power-of-ten boundary and the 2^53 seam', () => {
    const oracle = (n: bigint) => (n < 0n ? -n : n).toString(10).length;
    for (let k = 0n; k <= 30n; k++) {
      const p = 10n ** k;
      for (let d = -2n; d <= 2n; d++) {
        const n = p + d;
        if (n <= 0n) continue;
        expect(bigintDigits(n)).toBe(oracle(n));
      }
    }
    // Exact seam at 2^53 where the fast path hands off to the large path.
    const seam = 0x20000000000000n;
    for (let d = -3n; d <= 3n; d++)
      expect(bigintDigits(seam + d)).toBe(oracle(seam + d));
  });

  // Past the pow10 cache the count comes from a log10 estimate, with one exact
  // comparison when the estimate cannot tell which side of 10^k the value is.
  test('exact digit count around large powers of ten', () => {
    const oracle = (n: bigint) => n.toString(10).length;
    // 99 998…100 002 straddle the cache limit; the rest are far past it.
    for (const k of [99998, 99999, 100000, 100001, 100002, 150000, 262144]) {
      const p = 10n ** BigInt(k);
      for (const n of [p - 1n, p, p + 1n, 2n * p - 1n, 9n * p, 10n * p - 1n])
        expect(bigintDigits(n)).toBe(oracle(n));
    }
  });

  test('exact digit count of large random values', () => {
    // A deterministic generator, so a failure reproduces.
    let seed = 0x2545f491;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 12; i++) {
      let n = 1n;
      const words = 11000 + (next() % 4000);
      for (let w = 0; w < words; w++) n = (n << 32n) | BigInt(next());
      expect(bigintDigits(n)).toBe(n.toString(10).length);
    }
  });
});

// ================================================================
// bitLength
// ================================================================

describe('bitLength', () => {
  test('zero has 0 bits', () => {
    expect(bitLength(0n)).toBe(0);
  });

  test('one has 1 bit', () => {
    expect(bitLength(1n)).toBe(1);
  });

  test('powers of two', () => {
    expect(bitLength(2n)).toBe(2);
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(256n)).toBe(9);
  });

  test('negative counts absolute bits', () => {
    expect(bitLength(-255n)).toBe(8);
  });

  test('large value', () => {
    expect(bitLength(1n << 1000n)).toBe(1001);
  });

  // The length is read from the hex string, so every leading-digit width
  // (1 to 4 bits) and both sides of each hex-digit boundary are pinned
  // against the base-2 string.
  test('matches toString(2).length at power-of-two boundaries', () => {
    for (const k of [
      1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 1023,
      1024, 4000,
    ]) {
      const p = 1n << BigInt(k);
      for (const n of [p - 1n, p, p + 1n, 3n * p, 15n * p, 15n * p + 7n])
        expect(bitLength(n)).toBe(n.toString(2).length);
    }
  });

  test('matches toString(2).length on a 200 000-digit value', () => {
    const n = 7n * 10n ** 200000n + 12345n;
    expect(bitLength(n)).toBe(n.toString(2).length);
    expect(bitLength(-n)).toBe(n.toString(2).length);
  });
});

// ================================================================
// fpmul (base-2 grid: (a*b) >> bits)
// ================================================================

describe('fpmul', () => {
  test('1.5 * 2.0 = 3.0', () => {
    const a = (3n * SCALE) / 2n; // 1.5
    const b = 2n * SCALE; // 2.0
    expect(fpmul(a, b, BITS)).toBe(3n * SCALE);
  });

  test('0.5 * 0.5 = 0.25', () => {
    const half = SCALE >> 1n;
    // 0.25 * scale = scale / 4 (exact on the binary grid)
    expect(fpmul(half, half, BITS)).toBe(SCALE >> 2n);
  });

  test('multiply by zero', () => {
    expect(fpmul(42n * SCALE, 0n, BITS)).toBe(0n);
  });

  test('multiply by one', () => {
    const a = 123n * SCALE;
    expect(fpmul(a, SCALE, BITS)).toBe(a);
  });
});

// ================================================================
// fpdiv (base-2 grid: (a << bits) / b)
// ================================================================

describe('fpdiv', () => {
  test('1.0 / 3.0 ≈ scale/3', () => {
    const result = fpdiv(SCALE, 3n * SCALE, BITS);
    // (SCALE << bits) / (3*SCALE) = 2^bits / 3, truncated
    expect(result).toBe(SCALE / 3n);
  });

  test('6.0 / 2.0 = 3.0', () => {
    expect(fpdiv(6n * SCALE, 2n * SCALE, BITS)).toBe(3n * SCALE);
  });

  test('divide by one', () => {
    const a = 42n * SCALE;
    expect(fpdiv(a, SCALE, BITS)).toBe(a);
  });
});

// ================================================================
// fpsqrt (base-2 grid)
// ================================================================

describe('fpsqrt', () => {
  test('sqrt(0) = 0', () => {
    expect(fpsqrt(0n, BITS)).toBe(0n);
  });

  test('sqrt(4) = 2 exactly', () => {
    expect(fpsqrt(4n * SCALE, BITS)).toBe(2n * SCALE);
  });

  test('sqrt(1) = 1 exactly', () => {
    expect(fpsqrt(SCALE, BITS)).toBe(SCALE);
  });

  test('sqrt(9) = 3 exactly', () => {
    expect(fpsqrt(9n * SCALE, BITS)).toBe(3n * SCALE);
  });

  test('sqrt(2) verified by squaring', () => {
    const two = 2n * SCALE;
    const sqrtTwo = fpsqrt(two, BITS);
    // sqrtTwo² / scale should be very close to 2 * scale. Squaring amplifies the
    // ≤1-ULP root error by ~2·√2, so allow a few ULP in the round-trip.
    const squared = (sqrtTwo * sqrtTwo) >> BigInt(BITS);
    expect(bigintAbs(squared - two) <= 4n).toBe(true);
  });

  test('sqrt(2) has the right value', () => {
    const bits = 160; // Number(2^160) is finite, so a float ratio is exact enough
    const scale = 1n << BigInt(bits);
    const result = fpsqrt(2n * scale, bits);
    const ratio = Number(result) / Number(scale);
    expect(Math.abs(ratio - Math.SQRT2)).toBeLessThan(1e-12);
  });

  test('sqrt of large perfect square', () => {
    expect(fpsqrt(10000n * SCALE, BITS)).toBe(100n * SCALE);
  });

  test('throws for negative input', () => {
    expect(() => fpsqrt(-1n * SCALE, BITS)).toThrow('negative');
  });

  test('sqrt with high precision (~100 decimal digits)', () => {
    const bits = 350; // ≳ 100 decimal digits
    const scale = 1n << BigInt(bits);
    const two = 2n * scale;
    const result = fpsqrt(two, bits);
    const squared = (result * result) >> BigInt(bits);
    expect(bigintAbs(squared - two) <= 4n).toBe(true);
  });
});

// ================================================================
// fpln (base-2 grid)
// ================================================================

describe('fpln', () => {
  // Defense in depth: a zero input used to hang forever in the sqrt-reduction
  // loop (fpsqrt(0) = 0). Callers now range-reduce so the kernel only ever sees
  // O(1) positive values; non-positive input is a caller bug and must fail fast.
  test('throws for zero input', () => {
    expect(() => fpln(0n, BITS)).toThrow(RangeError);
  });

  test('throws for negative input', () => {
    expect(() => fpln(-1n * SCALE, BITS)).toThrow(RangeError);
  });

  test('ln(1) = 0', () => {
    expect(fpln(SCALE, BITS)).toBe(0n);
  });

  test('ln(2) has the right value', () => {
    const bits = 160;
    const scale = 1n << BigInt(bits);
    const result = fpln(2n * scale, bits);
    const ratio = Number(result) / Number(scale);
    expect(Math.abs(ratio - Math.log(2))).toBeLessThan(1e-12);
  });

  test('ln(2) at high precision verified via exp identity', () => {
    // exp(ln(2)) should round-trip to 2 within a few ULP at ~100 digits.
    const bits = 350;
    const scale = 1n << BigInt(bits);
    const ln2 = fpln(2n * scale, bits);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { fpexp } = require('../../src/big-decimal/utils');
    const back = fpexp(ln2, bits) as bigint;
    expect(bigintAbs(back - 2n * scale) <= 8n).toBe(true);
  });
});
