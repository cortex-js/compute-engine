import {
  skewness,
  kurtosis,
  bigSkewness,
  bigKurtosis,
} from '../../../src/compute-engine/numerics/statistics';
import { BigDecimal } from '../../../src/big-decimal';

// Regressions for the statistics formula bugs reported in REVIEW.md (D7):
// skewness/kurtosis used wrong central-moment terms (kurtosis even referenced
// sum² where it needed sum3) and were missing the 1/n normalization.
//
// Conventions: moment coefficient of skewness g₁ = m3 / m2^(3/2); non-excess
// kurtosis β₂ = m4 / m2² (a normal distribution gives 3). Central moments use
// the population (1/n) normalization.
describe('Statistics correctness (REVIEW.md D7)', () => {
  const data = [1, 2, 3, 4, 5];
  const big = (xs: number[]) => xs.map((x) => new BigDecimal(x));

  test('skewness of symmetric data is 0', () => {
    expect(skewness(data)).toBeCloseTo(0, 12);
    expect(bigSkewness(big(data)).toNumber()).toBeCloseTo(0, 12);
  });

  test('kurtosis of [1..5] is 1.7', () => {
    expect(kurtosis(data)).toBeCloseTo(1.7, 12);
    expect(bigKurtosis(big(data)).toNumber()).toBeCloseTo(1.7, 12);
  });

  test('skewness of right-skewed data is positive', () => {
    const skewed = [1, 1, 1, 1, 10];
    expect(skewness(skewed)).toBeGreaterThan(0);
    expect(bigSkewness(big(skewed)).toNumber()).toBeGreaterThan(0);
  });

  test('machine and bignum agree', () => {
    const xs = [2, 3, 5, 7, 11, 13];
    expect(bigSkewness(big(xs)).toNumber()).toBeCloseTo(skewness(xs), 10);
    expect(bigKurtosis(big(xs)).toNumber()).toBeCloseTo(kurtosis(xs), 10);
  });
});
