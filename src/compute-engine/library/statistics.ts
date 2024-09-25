import { each } from '../collection-utils';
import { erf, erfInv } from '../numerics/special-functions';
import { IdentifierDefinitions } from '../public';
import { choose } from '../boxed-expression/expand';

// Geometric mean:
// Harmonic mean:

export const STATISTICS_LIBRARY: IdentifierDefinitions[] = [
  {
    Choose: {
      complexity: 1200,
      signature: '(n:number, m:number) -> number',

      evaluate: (ops, { engine: ce }) => {
        const n = ops[0].re;
        const k = ops[1].re;
        if (!Number.isFinite(n) || !Number.isFinite(k)) return undefined;
        if (n < 0 || k < 0 || k > n) return ce.NaN;
        return ce.number(choose(n, k));
      },
    },
  },
  {
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-geometric-harmonic-means-in-data-analysis-2a703e21ea0?gi=d56d047586c6
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-part-ii-b32fcb41527e

    Mean: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> number',
      evaluate: (ops, { engine: ce }) => {
        // @todo: do bignum version
        let sum = 0;
        let count = 0;
        for (const op of each(ops[0])) {
          sum += op.re;
          count++;
        }
        if (count === 0) return ce.NaN;
        return ce.number(sum / count);
      },
    },

    Median: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> number',
      evaluate: (ops, { engine: ce }) => {
        // @todo: do bignum version
        const values: number[] = [];
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.NaN;
          values.push(v);
        }

        if (values.length === 0) return ce.NaN;
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);

        if (values.length % 2 === 0)
          return ce.number((values[mid - 1] + values[mid]) / 2);

        return ce.number(values[mid]);
      },
    },

    Variance: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> number',
      evaluate: (ops, { engine: ce }) => {
        let sum = 0;
        let sum2 = 0;
        let count = 0;
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.NaN;
          sum += v;
          sum2 += v * v;
          count++;
        }
        if (count === 0) return ce.NaN;
        return ce.number((sum2 - (sum * sum) / count) / (count - 1));
      },
    },

    StandardDeviation: {
      complexity: 1200,
      threadable: false,
      description: 'Sample Standard Deviation of a collection of numbers.',
      signature: 'collection -> number',
      evaluate: (ops, { engine: ce }) => {
        let sum = 0;
        let sum2 = 0;
        let count = 0;
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.NaN;
          sum += v;
          sum2 += v * v;
          count++;
        }
        if (count === 0) return ce.NaN;
        return ce.number(Math.sqrt((sum2 - (sum * sum) / count) / (count - 1)));
      },
    },

    Kurtosis: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> number',
      evaluate: (ops, { engine: ce }) => {
        let sum = 0;
        let sum2 = 0;
        let sum4 = 0;
        let count = 0;
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.NaN;
          sum += v;
          sum2 += v * v;
          sum4 += v * v * v * v;
          count++;
        }
        if (count === 0) return ce.NaN;
        // const m = sum / count;
        const s2 = (sum2 - (sum * sum) / count) / (count - 1);
        const s4 = (sum4 - (sum2 * sum2) / count) / (count - 1);
        return ce.number(((s4 / (s2 * s2) - 3) * (count * (count + 1))) / 6);
      },
    },

    Skewness: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> number',
      evaluate: (ops, { engine: ce }) => {
        let sum = 0;
        let sum2 = 0;
        let sum3 = 0;
        let count = 0;
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.NaN;
          sum += v;
          sum2 += v * v;
          sum3 += v * v * v;
          count++;
        }
        if (count === 0) return ce.NaN;
        // const m = sum / count;
        const s2 = (sum2 - (sum * sum) / count) / (count - 1);
        const s3 = (sum3 - (sum2 * sum) / count) / (count - 1);
        return ce.number((s3 / Math.pow(s2, 3 / 2)) * Math.sqrt(count * 1));
      },
    },

    Mode: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> number',
      evaluate: (ops, { engine: ce }) => {
        const values: number[] = [];
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.NaN;
          values.push(v);
        }
        if (values.length === 0) return ce.NaN;
        values.sort((a, b) => a - b);
        const counts: Record<number, number> = {};
        for (const v of values) {
          counts[v] = (counts[v] ?? 0) + 1;
        }
        let max = 0;
        let mode = values[0];
        for (const v of values) {
          const c = counts[v];
          if (c > max) {
            max = c;
            mode = v;
          }
        }
        return ce.number(mode);
      },
    },

    Quartiles: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> tuple<mid:number, lower:number, upper:number>',
      evaluate: (ops, { engine: ce }) => {
        const values: number[] = [];
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.tuple(ce.NaN, ce.NaN, ce.NaN);
          values.push(v);
        }
        if (values.length === 0) return ce.tuple(ce.NaN, ce.NaN, ce.NaN);
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        const lower = values.slice(0, mid);
        const upper = values.slice(mid + 1);
        return ce.tuple(
          ce.number(values[mid]),
          ce.number(lower[Math.floor(lower.length / 2)]),
          ce.number(upper[Math.floor(upper.length / 2)])
        );
      },
    },

    InterquartileRange: {
      complexity: 1200,
      threadable: false,
      signature: 'collection -> number',

      evaluate: (ops, { engine: ce }) => {
        const values: number[] = [];
        for (const op of each(ops[0])) {
          const v = op.re;
          if (!Number.isFinite(v)) return ce.NaN;
          values.push(v);
        }
        if (values.length === 0) return ce.NaN;
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        const lower = values.slice(0, mid);
        const upper = values.slice(mid + 1);
        return ce.number(
          upper[Math.floor(upper.length / 2)] -
            lower[Math.floor(lower.length / 2)]
        );
      },
    },

    Erf: {
      complexity: 7500,
      signature: 'number -> number',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(erf(x));
      },
    },

    Erfc: {
      complexity: 7500,
      signature: 'number -> number',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(1 - erf(x));
      },
    },

    ErfInv: {
      complexity: 7500,
      signature: 'number -> number',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(erfInv(x));
      },
    },
  },
];
