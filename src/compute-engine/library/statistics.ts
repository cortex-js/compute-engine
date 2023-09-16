import { asFloat, erf } from '../numerics/numeric';
import { BoxedExpression, IdTable } from '../public';

//   // mean
//   // median
//   // variance = size(l) * stddev(l)^2 / (size(l) - 1)
//   // stddev
//   // quantile
// Quartiles

// Geometric mean:
// Harmonic mean:

// max, sum, product, min

export const STATISTICS_LIBRARY: IdTable[] = [
  {
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-geometric-harmonic-means-in-data-analysis-2a703e21ea0?gi=d56d047586c6
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-part-ii-b32fcb41527e

    Mean: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          let sum = 0;
          let count = 0;
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            sum += v;
            count++;
          }
          if (count === 0) return ce._NAN;
          return ce.number(sum / count);
        },
      },
    },
    Median: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          const values: number[] = [];
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            values.push(v);
          }
          if (values.length === 0) return ce._NAN;
          values.sort((a, b) => a - b);
          const mid = Math.floor(values.length / 2);
          if (values.length % 2 === 0)
            return ce.number((values[mid - 1] + values[mid]) / 2);

          return ce.number(values[mid]);
        },
      },
    },
    Variance: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          let sum = 0;
          let sum2 = 0;
          let count = 0;
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            sum += v;
            sum2 += v * v;
            count++;
          }
          if (count === 0) return ce._NAN;
          return ce.number((sum2 - (sum * sum) / count) / (count - 1));
        },
      },
    },
    StandardDeviation: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          let sum = 0;
          let sum2 = 0;
          let count = 0;
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            sum += v;
            sum2 += v * v;
            count++;
          }
          if (count === 0) return ce._NAN;
          return ce.number(
            Math.sqrt((sum2 - (sum * sum) / count) / (count - 1))
          );
        },
      },
    },
    Kurtosis: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          let sum = 0;
          let sum2 = 0;
          let sum4 = 0;
          let count = 0;
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            sum += v;
            sum2 += v * v;
            sum4 += v * v * v * v;
            count++;
          }
          if (count === 0) return ce._NAN;
          // const m = sum / count;
          const s2 = (sum2 - (sum * sum) / count) / (count - 1);
          const s4 = (sum4 - (sum2 * sum2) / count) / (count - 1);
          return ce.number(((s4 / (s2 * s2) - 3) * (count * (count + 1))) / 6);
        },
      },
    },
    Skewness: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          let sum = 0;
          let sum2 = 0;
          let sum3 = 0;
          let count = 0;
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            sum += v;
            sum2 += v * v;
            sum3 += v * v * v;
            count++;
          }
          if (count === 0) return ce._NAN;
          // const m = sum / count;
          const s2 = (sum2 - (sum * sum) / count) / (count - 1);
          const s3 = (sum3 - (sum2 * sum) / count) / (count - 1);
          return ce.number((s3 / Math.pow(s2, 3 / 2)) * Math.sqrt(count * 1));
        },
      },
    },
    Mode: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          const values: number[] = [];
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            values.push(v);
          }
          if (values.length === 0) return ce._NAN;
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
    },
    Quartiles: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'List'],
        evaluate: (ce, ops) => {
          const values: number[] = [];
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            values.push(v);
          }
          if (values.length === 0) return ce._NAN;
          values.sort((a, b) => a - b);
          const mid = Math.floor(values.length / 2);
          const lower = values.slice(0, mid);
          const upper = values.slice(mid + 1);
          return ce.box([
            'List',
            ce.number(values[mid]),
            ce.number(lower[Math.floor(lower.length / 2)]),
            ce.number(upper[Math.floor(upper.length / 2)]),
          ]);
        },
      },
    },
    InterquartileRange: {
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          const values: number[] = [];
          for (const op of each(ops)) {
            const v = asFloat(op);
            if (v === null) return undefined;
            values.push(v);
          }
          if (values.length === 0) return ce._NAN;
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
    },
    Count: {
      threadable: true,
      complexity: 1200,
      signature: {
        domain: ['Function', ['Sequence', 'Value'], 'Number'],
        evaluate: (ce, ops) => {
          let count = 0;
          for (const _op of each(ops)) count++;
          return ce.number(count);
        },
      },
    },
    Erf: {
      complexity: 7500,
      signature: {
        domain: ['Function', 'Number', 'Number'],
        evaluate: (ce, ops) => {
          const x = asFloat(ops[0]);
          if (x === null) return undefined;
          return ce.number(erf(x));
        },
      },
    },
    Erfc: {
      complexity: 7500,
      signature: {
        domain: ['Function', 'Number', 'Number'],
        evaluate: (ce, ops) => {
          const x = asFloat(ops[0]);
          if (x === null) return undefined;
          return ce.number(1 - erf(x));
        },
      },
    },
  },
];

/**
 * Iterate over all the expressions in an expression tree with
 * the following form:
 * - ops: []
 * - ops: [op, op, op, ...]
 * - ops: [["List", op, op, ...]]
 * - ops: [["List", ["List", op, op...], ["List", op, op...], ...]]
 * - ops: [["Range", upper]]
 * - ops: [["Range", lower, upper]]
 * - ops: [["Range", lower, upper, step]]
 */
function* each(ops: BoxedExpression[]): Generator<BoxedExpression> {
  if (ops.length === 0) return;

  const ce = ops[0].engine;

  for (const op of ops) {
    const h = op.head;
    if (h === 'Range') {
      let lower = asFloat(op[1]);
      if (lower === null) return;
      let upper = asFloat(op[2]);
      if (upper === null) {
        upper = lower;
        lower = 1;
      }

      if (lower > upper) {
        const step = asFloat(op[3] ?? -1) ?? -1;
        if (step >= 0) return;
        for (let i = lower; i <= upper; i += step) yield ce.number(i);
        return;
      }

      const step = asFloat(op[3] ?? 1) ?? 1;
      if (step <= 0) return;
      for (let i = lower; i <= upper; i += step) yield ce.number(i);
      return;
    }
    if (h === 'Linspace') {
      let start = asFloat(op[1]);
      if (start === null) return;
      let stop = asFloat(op[2]);
      if (stop === null) {
        stop = start;
        start = 0;
      }
      const num = asFloat(op[3]) ?? 50;
      if (!Number.isInteger(num)) return;
      if (num <= 0) return;

      const step = (stop - start) / (num - 1);

      for (let i = start; i <= stop; i += step) yield ce.number(i);
      return;
    }

    if (
      typeof h === 'string' &&
      /^(List|Sequence|Tuple|Single|Pair|Triple)$/.test(h)
    ) {
      yield* each(op.ops!);
      return;
    }
    yield op;
  }
}
