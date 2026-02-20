import { erf, erfInv } from '../numerics/special-functions';
import {
  bigInterquartileRange,
  bigKurtosis,
  bigMean,
  bigMedian,
  bigMode,
  bigPopulationVariance,
  bigQuartiles,
  bigSkewness,
  bigVariance,
  interquartileRange,
  kurtosis,
  mean,
  median,
  mode,
  populationVariance,
  quartiles,
  skewness,
  variance,
} from '../numerics/statistics';
import type { Expression, SymbolDefinitions } from '../global-types';
import { bignumPreferred } from '../boxed-expression/utils';
import { toInteger } from '../boxed-expression/numerics';
import { isFunction } from '../boxed-expression/type-guards';

// Geometric mean:
// Harmonic mean:

export const STATISTICS_LIBRARY: SymbolDefinitions[] = [
  {
    Erf: {
      description: 'Gauss error function',
      complexity: 7500,
      signature: '(number) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(erf(x));
      },
    },

    Erfc: {
      description: 'Complementary error function: 1 - Erf(x)',
      complexity: 7500,
      signature: '(number) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(1 - erf(x));
      },
    },

    ErfInv: {
      description: 'Inverse of the error function',
      complexity: 7500,
      signature: '(number) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(erfInv(x));
      },
    },
  },
  {
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-geometric-harmonic-means-in-data-analysis-2a703e21ea0?gi=d56d047586c6
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-part-ii-b32fcb41527e

    Mean: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      description: 'Arithmetic mean of a collection of numbers.',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigMean(engine.bignum.bind(engine), flattenBigScalars(xs))
            : mean(flattenScalars(xs))
        );
      },
    },

    Median: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      description: 'Median of a collection of numbers.',
      examples: ['Mode([1, 2, 2, 3])  // Returns 2'],
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigMedian(flattenBigScalars(xs))
            : median(flattenScalars(xs))
        );
      },
    },

    Variance: {
      description: 'Sample variance of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigVariance(engine.bignum.bind(engine), flattenBigScalars(xs))
            : variance(flattenScalars(xs))
        );
      },
    },

    PopulationVariance: {
      description: 'Population variance of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(
                engine.bignum.bind(engine),
                flattenBigScalars(xs)
              )
            : populationVariance(flattenScalars(xs))
        );
      },
    },

    StandardDeviation: {
      complexity: 1200,
      broadcastable: false,
      description: 'Sample Standard Deviation of a collection of numbers.',
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigVariance(
                engine.bignum.bind(engine),
                flattenBigScalars(xs)
              ).sqrt()
            : Math.sqrt(variance(flattenScalars(xs)))
        );
      },
    },

    PopulationStandardDeviation: {
      complexity: 1200,
      broadcastable: false,
      description: 'Population Standard Deviation of a collection of numbers.',
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(
                engine.bignum.bind(engine),
                flattenBigScalars(xs)
              ).sqrt()
            : Math.sqrt(populationVariance(flattenScalars(xs)))
        );
      },
    },

    Kurtosis: {
      description: 'Kurtosis of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigKurtosis(engine.bignum.bind(engine), flattenBigScalars(xs))
            : kurtosis(flattenScalars(xs))
        );
      },
    },

    Skewness: {
      description: 'Skewness of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigSkewness(engine.bignum.bind(engine), flattenBigScalars(xs))
            : skewness(flattenScalars(xs))
        );
      },
    },

    Mode: {
      description: 'Most frequently occurring value in a collection.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigMode(engine.bignum.bind(engine), flattenBigScalars(xs))
            : mode(flattenScalars(xs))
        );
      },
    },

    Quartiles: {
      description:
        'Lower quartile, median, and upper quartile of a collection.',
      complexity: 1200,
      broadcastable: false,
      signature:
        '((collection|number)+) -> tuple<mid:number, lower:number, upper:number>',
      examples: ['Quartiles([1, 2, 3, 4, 5])  // Returns (3, 2, 4)'],
      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        const [mid, lower, upper] = (
          bignumPreferred(engine)
            ? bigQuartiles(flattenBigScalars(xs))
            : quartiles(flattenScalars(xs))
        ).map((v) => engine.number(v));
        return engine.tuple(mid, lower, upper);
      },
    },

    InterquartileRange: {
      description: 'Interquartile range (Q3 - Q1) of a collection.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',

      evaluate: (ops, { engine, numericApproximation }) => {
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigInterquartileRange(flattenBigScalars(xs))
            : interquartileRange(flattenScalars(xs))
        );
      },
    },

    Histogram: {
      description:
        'Compute a histogram of the values in a collection. Returns a list of (bin start, count) tuples.',
      complexity: 8200,
      signature:
        '(collection, integer | list<number>) -> list<tuple<number, integer>>',
      examples: [
        'Histogram([1, 2, 2, 3], 3)  // Returns [(1,1), (1.6667,2), (2.3333,1)]',
      ],
      evaluate: ([xs, binsArg], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;

        const data = (Array.from(xs.each()) as Expression[])
          .map((x) => x.re)
          .filter(Number.isFinite);
        if (data.length === 0) return undefined;

        const min = Math.min(...data);
        const max = Math.max(...data);

        // Determine bins
        let binEdges: number[];
        if (isFunction(binsArg, 'List')) {
          binEdges = binsArg.ops.map((op) => op.re);
        } else {
          const binCount = toInteger(binsArg);
          if (binCount === null || binCount <= 0) return undefined;
          const binWidth = (max - min) / binCount;
          binEdges = Array.from(
            { length: binCount + 1 },
            (_, i) => min + i * binWidth
          );
        }

        const counts = Array(binEdges.length - 1).fill(0);
        for (const x of data) {
          for (let i = 0; i < binEdges.length - 1; i++) {
            if (x >= binEdges[i] && x < binEdges[i + 1]) {
              counts[i]++;
              break;
            }
          }
        }

        return ce.function(
          'List',
          counts.map((count, i) =>
            ce._fn('Tuple', [ce.number(binEdges[i]), ce.number(count)])
          )
        );
      },
    },

    BinCounts: {
      description: 'Count the number of elements falling into each bin.',
      complexity: 8200,
      signature: '(collection, integer | list<number>) -> list<number>',
      examples: ['BinCounts([1, 2, 2, 3], 3)  // Returns [1, 2, 1]'],
      evaluate: ([xs, binsArg], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;

        const data = (Array.from(xs.each()) as Expression[])
          .map((x) => x.re)
          .filter(Number.isFinite);
        if (data.length === 0) return undefined;

        const min = Math.min(...data);
        const max = Math.max(...data);

        // Determine bins
        let binEdges: number[];
        if (binsArg.isCollection) {
          binEdges = [...binsArg.each()].map((op) => op.re);
        } else {
          const binCount = toInteger(binsArg);
          if (binCount === null || binCount <= 0) return undefined;
          const binWidth = (max - min) / binCount;
          binEdges = Array.from(
            { length: binCount + 1 },
            (_, i) => min + i * binWidth
          );
        }

        const counts = Array(binEdges.length - 1).fill(0);
        for (const x of data) {
          for (let i = 0; i < binEdges.length - 1; i++) {
            if (x >= binEdges[i] && x < binEdges[i + 1]) {
              counts[i]++;
              break;
            }
          }
        }

        return ce.function(
          'List',
          counts.map((c) => ce.number(c))
        );
      },
    },

    SlidingWindow: {
      description:
        'Return overlapping sliding windows of fixed size over the collection.',
      complexity: 8200,
      signature: '(collection, integer, integer?) -> list<list>',
      examples: [
        'SlidingWindow([1, 2, 3, 4], 2)  // Returns [[1,2], [2,3], [3,4]]',
      ],
      evaluate: ([xs, winArg, stepArg], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;
        const windowSize = toInteger(winArg);
        const stepSize = stepArg ? toInteger(stepArg) : 1;
        if (
          windowSize === null ||
          windowSize <= 0 ||
          stepSize === null ||
          stepSize <= 0
        )
          return undefined;

        const data = Array.from(xs.each()) as Expression[];
        const result: Expression[] = [];

        for (let i = 0; i <= data.length - windowSize; i += stepSize) {
          result.push(ce.function('List', data.slice(i, i + windowSize)));
        }

        return ce.function('List', result);
      },
    },
  },
  {
    Sample: {
      description:
        'Return a random sample of k elements from the collection, without replacement.',
      complexity: 8200,
      signature: '(collection, integer) -> list',
      evaluate: ([xs, nArg], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;

        const k = toInteger(nArg);
        if (k === null || k < 0) return undefined;

        const data = Array.from(xs.each()) as Expression[];
        if (k > data.length) return undefined;

        // Fisher-Yates shuffle first k elements
        for (let i = data.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [data[i], data[j]] = [data[j], data[i]];
        }

        const sample = data.slice(0, k);
        return ce.function('List', sample);
      },
    },
  },
];

function* flattenArguments(
  args: ReadonlyArray<Expression>
): Generator<Expression> {
  // Go over each argument and yield it if a scalar, otherwise yield its elements
  for (const arg of args) {
    if (arg.isFiniteCollection) yield* arg.each();
    else yield arg;
  }
}

function* flattenScalars(args: ReadonlyArray<Expression>) {
  for (const op of flattenArguments(args)) yield op.re;
}

function* flattenBigScalars(args: ReadonlyArray<Expression>) {
  for (const op of flattenArguments(args))
    yield op.bignumRe ?? op.engine.bignum(op.re);
}
