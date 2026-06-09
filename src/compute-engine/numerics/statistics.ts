import { BigDecimal } from '../../big-decimal';

export function mean(values: Iterable<number>): number {
  let sum = 0;
  let count = 0;
  for (const op of values) {
    sum += op;
    count++;
  }
  if (count === 0) return NaN;
  return sum / count;
}

export function bigMean(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    sum = sum.add(op);
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  return sum.div(new BigDecimal(count));
}

export function median(values: Iterable<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function bigMedian(values: Iterable<BigDecimal>): BigDecimal {
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0)
    return sorted[mid - 1].add(sorted[mid]).div(BigDecimal.TWO);
  return sorted[mid];
}

export function variance(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (const op of values) {
    sum += op;
    sum2 += op * op;
    count++;
  }
  if (count === 0) return NaN;
  return (sum2 - (sum * sum) / count) / (count - 1);
}

export function bigVariance(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    sum = sum.add(op);
    sum2 = sum2.add(op.mul(op));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  return sum2
    .sub(sum.mul(sum).div(new BigDecimal(count)))
    .div(new BigDecimal(count - 1));
}

export function populationVariance(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let count = 0;
  for (const op of values) {
    sum += op;
    sum2 += op * op;
    count++;
  }
  if (count === 0) return NaN;
  return (sum2 - (sum * sum) / count) / count;
}

export function bigPopulationVariance(
  values: Iterable<BigDecimal>
): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    sum = sum.add(op);
    sum2 = sum2.add(op.mul(op));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  return sum2
    .sub(sum.mul(sum).div(new BigDecimal(count)))
    .div(new BigDecimal(count));
}

export function standardDeviation(values: Iterable<number>): number {
  return Math.sqrt(variance(values));
}

export function bigStandardDeviation(values: Iterable<BigDecimal>): BigDecimal {
  return bigVariance(values).sqrt();
}

export function populationStandardDeviation(values: Iterable<number>): number {
  return Math.sqrt(populationVariance(values));
}

export function bigPopulationStandardDeviation(
  values: Iterable<BigDecimal>
): BigDecimal {
  return bigPopulationVariance(values).sqrt();
}

export function kurtosis(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let sum3 = 0;
  let sum4 = 0;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!Number.isFinite(v)) return NaN;
    sum += v;
    sum2 += v * v;
    sum3 += v * v * v;
    sum4 += v * v * v * v;
    count++;
  }
  if (count === 0) return NaN;
  const n = count;
  const m = sum / n;
  // Central moments: m2 = (1/n)Σ(x−m)², m4 = (1/n)Σ(x−m)⁴.
  const m2 = (sum2 - (sum * sum) / n) / n;
  const m4 =
    (sum4 -
      4 * m * sum3 +
      6 * m * m * sum2 -
      4 * m * m * m * sum +
      n * m * m * m * m) /
    n;
  // Non-excess kurtosis β₂ = m4 / m2² (a normal distribution gives 3).
  return m4 / (m2 * m2);
}

export function bigKurtosis(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let sum3 = BigDecimal.ZERO;
  let sum4 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!v.isFinite()) return BigDecimal.NAN;
    sum = sum.add(v);
    sum2 = sum2.add(v.mul(v));
    sum3 = sum3.add(v.mul(v).mul(v));
    sum4 = sum4.add(v.mul(v).mul(v).mul(v));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  const m = sum.div(count); // mean
  // Central moments: m2 = (1/n)Σ(x−m)², m4 = (1/n)Σ(x−m)⁴.
  const m2 = sum2.sub(sum.mul(sum).div(count)).div(count);
  const m4 = sum4
    .sub(m.mul(sum3).mul(4))
    .add(m.mul(m).mul(sum2).mul(6))
    .sub(m.mul(m).mul(m).mul(sum).mul(4))
    .add(m.mul(m).mul(m).mul(m).mul(count))
    .div(count);
  // Non-excess kurtosis β₂ = m4 / m2² (a normal distribution gives 3).
  return m4.div(m2.mul(m2));
}

export function skewness(values: Iterable<number>): number {
  let sum = 0;
  let sum2 = 0;
  let sum3 = 0;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!Number.isFinite(v)) return NaN;
    sum += v;
    sum2 += v * v;
    sum3 += v * v * v;
    count++;
  }
  if (count === 0) return NaN;
  const n = count;
  const m = sum / n;
  // Central moments: m2 = (1/n)Σ(x−m)², m3 = (1/n)Σ(x−m)³.
  const m2 = (sum2 - (sum * sum) / n) / n;
  const m3 = (sum3 - 3 * m * sum2 + 3 * m * m * sum - n * m * m * m) / n;
  // Moment coefficient of skewness g₁ = m3 / m2^(3/2).
  return m3 / Math.pow(m2, 3 / 2);
}

export function bigSkewness(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let sum3 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!v.isFinite()) return BigDecimal.NAN;
    sum = sum.add(v);
    sum2 = sum2.add(v.mul(v));
    sum3 = sum3.add(v.mul(v).mul(v));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  const m = sum.div(count); // mean
  // Central moments: m2 = (1/n)Σ(x−m)², m3 = (1/n)Σ(x−m)³.
  const m2 = sum2.sub(sum.mul(sum).div(count)).div(count);
  const m3 = sum3
    .sub(m.mul(sum2).mul(3))
    .add(m.mul(m).mul(sum).mul(3))
    .sub(m.mul(m).mul(m).mul(count))
    .div(count);
  // Moment coefficient of skewness g₁ = m3 / m2^(3/2) = m3 / (m2·√m2).
  return m3.div(m2.mul(m2.sqrt()));
}

export function mode(values: Iterable<number>): number {
  const counts: Record<number, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] ?? 0) + 1;
  }
  let max = 0;
  let mode = NaN;
  for (const v in counts) {
    const c = counts[v];
    if (c > max) {
      max = c;
      mode = +v;
    }
  }
  return mode;
}

export function bigMode(values: Iterable<BigDecimal>): BigDecimal {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v.toString()] = (counts[v.toString()] ?? 0) + 1;
  }
  let max = 0;
  let mode = BigDecimal.NAN;
  for (const v in counts) {
    const c = counts[v];
    if (c > max) {
      max = c;
      mode = new BigDecimal(v);
    }
  }
  return mode;
}

export function quartiles(values: Iterable<number>): [number, number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  const q1 = median(sorted.slice(0, mid));
  const q2 = median(sorted);
  const q3 = median(sorted.slice(mid));

  return [q1, q2, q3];
}

export function bigQuartiles(
  values: Iterable<BigDecimal>
): [BigDecimal, BigDecimal, BigDecimal] {
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const mid = Math.floor(sorted.length / 2);

  const q1 = bigMedian(sorted.slice(0, mid));
  const q2 = bigMedian(sorted);
  const q3 = bigMedian(sorted.slice(mid));

  return [q1, q2, q3];
}

export function interquartileRange(values: Iterable<number>): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  const lower = sorted.slice(0, mid);
  const upper = sorted.slice(mid + 1);

  return median(upper) - median(lower);
}

export function bigInterquartileRange(
  values: Iterable<BigDecimal>
): BigDecimal {
  const sorted = [...values].sort((a, b) => a.cmp(b));
  const mid = Math.floor(sorted.length / 2);

  const lower = sorted.slice(0, mid);
  const upper = sorted.slice(mid + 1);

  return bigMedian(upper).sub(bigMedian(lower));
}
