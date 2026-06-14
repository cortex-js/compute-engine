import { BigDecimal } from '../../src/big-decimal';
import {
  bigintSqrt,
  piChudnovskyDecimal,
} from '../../src/big-decimal/utils';

// ROADMAP item 17 #5: on-demand Chudnovsky π removes the ~2350-digit ceiling.

const DEFAULT_PRECISION = 50;
afterAll(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});

// ================================================================
// bigintSqrt (floor integer square root, used by Chudnovsky)
// ================================================================

describe('bigintSqrt', () => {
  test('small values (floor)', () => {
    expect(bigintSqrt(0n)).toBe(0n);
    expect(bigintSqrt(1n)).toBe(1n);
    expect(bigintSqrt(15n)).toBe(3n);
    expect(bigintSqrt(16n)).toBe(4n);
    expect(bigintSqrt(17n)).toBe(4n);
    expect(bigintSqrt(9_999_999n)).toBe(3162n);
  });

  test('exact floor for a large value', () => {
    const n = 10n ** 200n + 12345n;
    const r = bigintSqrt(n);
    expect(r * r <= n && (r + 1n) * (r + 1n) > n).toBe(true);
  });

  test('throws on negative', () => {
    expect(() => bigintSqrt(-1n)).toThrow('negative');
  });
});

// ================================================================
// piChudnovskyDecimal
// ================================================================

describe('piChudnovskyDecimal', () => {
  test('leading digits of π', () => {
    // floor(π · 10^40) = 3.1415926535897932384626433832795028841971...
    const pi40 = piChudnovskyDecimal(40).toString();
    expect(pi40.startsWith('31415926535897932384626433832795028841971')).toBe(
      true
    );
  });

  test('agrees with the hardcoded table in the overlap', () => {
    // Compute π to 2000 digits via Chudnovsky, compare to the trusted table.
    // (Compare a safe prefix; the very last digit differs by floor-vs-round.)
    const chud = piChudnovskyDecimal(2000).toString();
    BigDecimal.precision = 2010;
    const table = BigDecimal.PI.toPrecision(2005).toString().replace('.', '');
    expect(chud.slice(0, 1990)).toBe(table.slice(0, 1990));
  });
});

// ================================================================
// BigDecimal.PI beyond the table
// ================================================================

describe('BigDecimal.PI beyond the stored table', () => {
  test('Chudnovsky π matches the table in the overlap region', () => {
    BigDecimal.precision = 2300; // ≤ table → table path
    const tablePi = BigDecimal.PI.toPrecision(2300).toString();
    BigDecimal.precision = 2400; // > table → Chudnovsky path
    const chudPi = BigDecimal.PI.toPrecision(2300).toString();
    expect(chudPi).toBe(tablePi);
  });

  test('high-precision π has correct leading digits', () => {
    BigDecimal.precision = 3000;
    const pi = BigDecimal.PI.toString();
    expect(
      pi.startsWith(
        '3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798'
      )
    ).toBe(true);
    expect(pi.length).toBeGreaterThan(3000);
  });
});

// ================================================================
// Trig beyond the old ceiling (sin/cos/tan + inverse trig via PI)
// ================================================================

describe('trig beyond the old ~2350-digit ceiling', () => {
  test('sin/cos no longer NaN at high precision', () => {
    BigDecimal.precision = 2600;
    const s = new BigDecimal('1.2').sin();
    const c = new BigDecimal('1.2').cos();
    expect(s.isNaN()).toBe(false);
    expect(c.isNaN()).toBe(false);
    // sin² + cos² = 1 to ~2600 digits
    const err = s.mul(s).add(c.mul(c)).sub(BigDecimal.ONE).abs();
    expect(err.lt(new BigDecimal('1e-2590'))).toBe(true);
  });

  test('inverse trig (uses BigDecimal.PI) is accurate at high precision', () => {
    BigDecimal.precision = 2600;
    // acos(1/2) = π/3
    const acosHalf = new BigDecimal('0.5').acos();
    const piOver3 = BigDecimal.PI.div(new BigDecimal('3'));
    expect(acosHalf.sub(piOver3).abs().lt(new BigDecimal('1e-2590'))).toBe(true);
  });
});
