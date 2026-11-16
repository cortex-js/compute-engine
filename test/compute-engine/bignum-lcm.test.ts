import { BigDecimal } from '../../src/big-decimal';
import { bignumGcd, bignumLcm } from '../../src/numerics';

// `bignumLcm` is exact: the product of the operands can have more digits than
// any precision.
const big = (s: string | bigint) => new BigDecimal(s);

describe('bignumLcm', () => {
  test('a product with more digits than the default precision is exact', () => {
    const a = 10n ** 40n + 7n;
    const b = 3n * 10n ** 40n + 1n;
    expect(bignumLcm(big(a), big(b)).toBigInt()).toBe(a * b);
  });

  test('common factors are divided out exactly', () => {
    // 10^40 holds one significant digit; 2^40 divides it.
    expect(bignumLcm(big('1e40'), big(2n ** 40n)).toBigInt()).toBe(10n ** 40n);
    expect(bignumLcm(big(12n), big(18n)).toBigInt()).toBe(36n);
  });

  test('the result is non-negative, and 0 for a zero operand', () => {
    expect(bignumLcm(big(-4n), big(6n)).toBigInt()).toBe(12n);
    expect(bignumLcm(big(-4n), big(-6n)).toBigInt()).toBe(12n);
    expect(bignumLcm(big(0n), big(5n)).isZero()).toBe(true);
  });

  test('gcd and lcm of large integers multiply to the product', () => {
    const a = 2n ** 90n * 3n ** 20n;
    const b = 2n ** 30n * 5n ** 40n;
    const g = bignumGcd(big(a), big(b)).toBigInt();
    expect(g * bignumLcm(big(a), big(b)).toBigInt()).toBe(a * b);
  });
});
