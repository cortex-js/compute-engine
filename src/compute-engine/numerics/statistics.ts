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
  let sum4 = 0;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!Number.isFinite(v)) return NaN;
    sum += v;
    sum2 += v * v;
    sum4 += v * v * v * v;
    count++;
  }
  if (count === 0) return NaN;
  const s2 = (sum2 - (sum * sum) / count) / (count - 1);
  return (
    (sum4 -
      (4 * sum * sum2) / count +
      (6 * sum * sum * sum) / count / count -
      (3 * sum * sum * sum * sum) / count / count / count) /
    (s2 * s2)
  );
}

export function bigKurtosis(values: Iterable<BigDecimal>): BigDecimal {
  let sum = BigDecimal.ZERO;
  let sum2 = BigDecimal.ZERO;
  let sum4 = BigDecimal.ZERO;
  let count = 0;
  for (const op of values) {
    const v = op;
    if (!v.isFinite()) return BigDecimal.NAN;
    sum = sum.add(v);
    sum2 = sum2.add(v.mul(v));
    sum4 = sum4.add(v.mul(v).mul(v).mul(v));
    count++;
  }
  if (count === 0) return BigDecimal.NAN;
  const bdCount = new BigDecimal(count);
  const s2 = sum2.sub(sum.mul(sum).div(bdCount)).div(new BigDecimal(count - 1));
  return sum4
    .sub(sum.mul(sum2).mul(new BigDecimal(4)).div(bdCount))
    .add(sum.mul(sum).mul(sum).mul(new BigDecimal(6)).div(bdCount).div(bdCount))
    .sub(
      sum
        .mul(sum)
        .mul(sum)
        .mul(sum)
        .mul(new BigDecimal(3))
        .div(bdCount)
        .div(bdCount)
        .div(bdCount)
    )
    .div(s2.mul(s2));
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
  const s2 = (sum2 - (sum * sum) / count) / (count - 1);
  const s3 = (sum3 - (sum2 * sum) / count) / (count - 1);
  return (s3 / Math.pow(s2, 3 / 2)) * Math.sqrt(count * 1);
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
  const bdCount = new BigDecimal(count);
  const s2 = sum2.sub(sum.mul(sum).div(bdCount)).div(new BigDecimal(count - 1));
  const s3 = sum3
    .sub(sum2.mul(sum).div(bdCount))
    .div(new BigDecimal(count - 1));
  return s3.div(s2.pow(new BigDecimal(1.5))).mul(bdCount.sqrt());
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
