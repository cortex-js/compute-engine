import { BigDecimal } from '../../src/big-decimal';

// ROADMAP item 17 #2: AGM logarithm is used for ln above ~1250 digits.
// The cross-validation suite only reaches p1000 (Newton); these cases exercise
// the AGM path and verify it against a higher-precision reference + identities.

const DEFAULT_PRECISION = 50;
afterAll(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});

function atPrecision<T>(p: number, fn: () => T): T {
  const saved = BigDecimal.precision;
  BigDecimal.precision = p;
  try {
    return fn();
  } finally {
    BigDecimal.precision = saved;
  }
}

function firstDigits(x: BigDecimal, n: number): string {
  return x.toPrecision(n).toString();
}

describe('AGM logarithm (high precision)', () => {
  // p = 1500 is inside the AGM window (≈ 1250–2375 digits).
  const P = 1500;

  test('ln matches a higher-precision reference', () => {
    for (const v of ['2', '10', '3.7', '123.456', '0.001']) {
      const ref = atPrecision(P + 40, () => firstDigits(new BigDecimal(v).ln(), P));
      const got = atPrecision(P, () => firstDigits(new BigDecimal(v).ln(), P));
      expect(got).toBe(ref);
    }
  });

  test('ln(a·b) = ln(a) + ln(b)', () => {
    atPrecision(P, () => {
      const a = new BigDecimal('3.14159');
      const b = new BigDecimal('2.71828');
      const lhs = a.mul(b).ln();
      const rhs = a.ln().add(b.ln());
      // agree to P − a few guard digits
      expect(firstDigits(lhs, P - 5)).toBe(firstDigits(rhs, P - 5));
    });
  });

  test('exp(ln(x)) = x', () => {
    atPrecision(P, () => {
      const x = new BigDecimal('42.5');
      expect(firstDigits(x.ln().exp(), P - 5)).toBe(firstDigits(x, P - 5));
    });
  });

  test('continuity across the AGM/Newton boundary', () => {
    // Just below (Newton) and inside (AGM) the window must agree where they overlap.
    const below = atPrecision(1000, () => firstDigits(new BigDecimal('7').ln(), 1000));
    const inside = atPrecision(1500, () =>
      firstDigits(new BigDecimal('7').ln(), 1000)
    );
    expect(inside).toBe(below);
  });

  test('ln is accurate well past the old ln(2)-table cap (binary-split ln 2)', () => {
    // p = 3000 needs ln 2 beyond the 2400-digit table → binary splitting.
    const P3 = 3000;
    const ref = atPrecision(P3 + 40, () =>
      firstDigits(new BigDecimal('5').ln(), P3)
    );
    const got = atPrecision(P3, () => firstDigits(new BigDecimal('5').ln(), P3));
    expect(got).toBe(ref);
  });
});

describe('ln2ChudnovskyBits (binary splitting)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ln2ChudnovskyBits } = require('../../src/big-decimal/utils');

  test('matches the known value of ln 2', () => {
    const bits = Math.ceil(80 * 3.3219) + 20;
    const v = ln2ChudnovskyBits(bits) as bigint;
    // ln2 ≈ v / 2^bits; render 60 digits
    const dec = (v * 10n ** 60n) >> BigInt(bits);
    expect(dec.toString().startsWith('693147180559945309417232121458176568075500')).toBe(
      true
    );
  });
});
