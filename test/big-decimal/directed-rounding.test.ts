import { BigDecimal } from '../../src/big-decimal';

// ROADMAP item 17 #7: directed rounding (toward −∞ / +∞) on the inexact ops
// (div, sqrt) — the enabling primitive for a future interval-arithmetic mode.

const DEFAULT_PRECISION = 50;
beforeEach(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});
afterAll(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});

describe('divToward', () => {
  test('brackets the true quotient (1 ULP apart when inexact)', () => {
    BigDecimal.precision = 10;
    const lo = new BigDecimal('1').divToward(3, 'floor');
    const hi = new BigDecimal('1').divToward(3, 'ceiling');
    expect(lo.toString()).toBe('0.3333333333');
    expect(hi.toString()).toBe('0.3333333334');
    expect(lo.lt(hi)).toBe(true);
  });

  test('floor rounds toward −∞ for negatives', () => {
    BigDecimal.precision = 10;
    const lo = new BigDecimal('-1').divToward(3, 'floor');
    const hi = new BigDecimal('-1').divToward(3, 'ceiling');
    expect(lo.toString()).toBe('-0.3333333334'); // more negative
    expect(hi.toString()).toBe('-0.3333333333');
    expect(lo.lt(hi)).toBe(true);
  });

  test('exact division: floor == ceiling == exact', () => {
    const lo = new BigDecimal('6').divToward(2, 'floor');
    const hi = new BigDecimal('6').divToward(2, 'ceiling');
    expect(lo.eq(3)).toBe(true);
    expect(hi.eq(3)).toBe(true);
  });

  test('bracket contains the high-precision true value', () => {
    const cases: [string, string][] = [
      ['22', '7'],
      ['1', '7'],
      ['355', '113'],
      ['-2', '3'],
    ];
    for (const [a, b] of cases) {
      BigDecimal.precision = 60;
      const ref = new BigDecimal(a).div(b); // 60-digit reference
      BigDecimal.precision = 30;
      const lo = new BigDecimal(a).divToward(b, 'floor');
      const hi = new BigDecimal(a).divToward(b, 'ceiling');
      expect(lo.lte(ref)).toBe(true);
      expect(hi.gte(ref)).toBe(true);
      expect(lo.lte(hi)).toBe(true);
    }
  });

  test('special cases defer to div', () => {
    expect(new BigDecimal('0').divToward(5, 'floor').isZero()).toBe(true);
    expect(new BigDecimal('1').divToward(0, 'floor').isFinite()).toBe(false);
    expect(BigDecimal.NAN.divToward(1, 'ceiling').isNaN()).toBe(true);
  });
});

describe('sqrtToward', () => {
  test('brackets the true root (1 ULP apart when inexact)', () => {
    BigDecimal.precision = 10;
    const lo = new BigDecimal('2').sqrtToward('floor');
    const hi = new BigDecimal('2').sqrtToward('ceiling');
    expect(lo.toString()).toBe('1.414213562');
    expect(hi.toString()).toBe('1.414213563');
    expect(lo.lt(hi)).toBe(true);
  });

  test('perfect squares: floor == ceiling == exact', () => {
    expect(new BigDecimal('4').sqrtToward('floor').eq(2)).toBe(true);
    expect(new BigDecimal('4').sqrtToward('ceiling').eq(2)).toBe(true);
    expect(new BigDecimal('0.0625').sqrtToward('floor').eq(new BigDecimal('0.25'))).toBe(
      true
    );
  });

  test('bracket squares back around the radicand', () => {
    for (const v of ['2', '10', '0.5', '123.456', '1e-20', '7e30']) {
      BigDecimal.precision = 40;
      const x = new BigDecimal(v);
      const lo = x.sqrtToward('floor');
      const hi = x.sqrtToward('ceiling');
      expect(lo.mul(lo).lte(x)).toBe(true); // floor² ≤ v
      expect(hi.mul(hi).gte(x)).toBe(true); // ceiling² ≥ v
      expect(lo.lte(hi)).toBe(true);
    }
  });

  test('floor/ceiling bracket the nearest-rounded sqrt', () => {
    BigDecimal.precision = 40;
    const x = new BigDecimal('3');
    const lo = x.sqrtToward('floor');
    const hi = x.sqrtToward('ceiling');
    const mid = x.sqrt();
    expect(lo.lte(mid)).toBe(true);
    expect(mid.lte(hi)).toBe(true);
  });

  test('negative → NaN, zero → 0', () => {
    expect(new BigDecimal('-1').sqrtToward('floor').isNaN()).toBe(true);
    expect(new BigDecimal('0').sqrtToward('ceiling').isZero()).toBe(true);
  });
});

describe('interval arithmetic foundation', () => {
  test('an outward-rounded quotient interval is rigorous', () => {
    // [lo, hi] must contain a/b at every precision; +,−,× are exact so need no
    // directed variant — only div/sqrt do.
    BigDecimal.precision = 25;
    const a = new BigDecimal('17');
    const b = new BigDecimal('13');
    const lo = a.divToward(b, 'floor');
    const hi = a.divToward(b, 'ceiling');
    // Verify against a much higher precision value.
    BigDecimal.precision = 80;
    const exact = new BigDecimal('17').div(13);
    expect(lo.lte(exact) && exact.lte(hi)).toBe(true);
  });
});
