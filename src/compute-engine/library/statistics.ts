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
import type { BoxedExpression, SymbolDefinitions } from '../global-types';
import { bignumPreferred } from '../boxed-expression/utils';
import { toInteger } from '../boxed-expression/numerics';
import { isBoxedFunction } from '../boxed-expression/type-guards';

// Geometric mean:
// Harmonic mean:

export const STATISTICS_LIBRARY: SymbolDefinitions[] = [
  {
    Erf: {
      complexity: 7500,
      signature: '(number) -> number',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(erf(x));
      },
    },

    Erfc: {
      complexity: 7500,
      signature: '(number) -> number',
      evaluate: (ops, { engine: ce }) => {
        const x = ops[0].re;
        if (!Number.isFinite(x)) return undefined;
        return ce.number(1 - erf(x));
      },
    },

    ErfInv: {
      complexity: 7500,
      signature: '(number) -> number',
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
      description: 'The most frequently occurring value in the collection.',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigMean(engine.bignum.bind(engine), flattenBigScalars(ops))
            : mean(flattenScalars(ops))
        ),
    },

    Median: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      description: 'The most frequently occurring value in the collection.',
      examples: ['Mode([1, 2, 2, 3])  // Returns 2'],
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigMedian(flattenBigScalars(ops))
            : median(flattenScalars(ops))
        ),
    },

    Variance: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigVariance(engine.bignum.bind(engine), flattenBigScalars(ops))
            : variance(flattenScalars(ops))
        ),
    },

    PopulationVariance: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(
                engine.bignum.bind(engine),
                flattenBigScalars(ops)
              )
            : populationVariance(flattenScalars(ops))
        ),
    },

    StandardDeviation: {
      complexity: 1200,
      broadcastable: false,
      description: 'Sample Standard Deviation of a collection of numbers.',
      signature: '((collection|number)+) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigVariance(
                engine.bignum.bind(engine),
                flattenBigScalars(ops)
              ).sqrt()
            : Math.sqrt(variance(flattenScalars(ops)))
        ),
    },

    PopulationStandardDeviation: {
      complexity: 1200,
      broadcastable: false,
      description: 'Population Standard Deviation of a collection of numbers.',
      signature: '((collection|number)+) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(
                engine.bignum.bind(engine),
                flattenBigScalars(ops)
              ).sqrt()
            : Math.sqrt(populationVariance(flattenScalars(ops)))
        ),
    },

    Kurtosis: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigKurtosis(engine.bignum.bind(engine), flattenBigScalars(ops))
            : kurtosis(flattenScalars(ops))
        ),
    },

    Skewness: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigSkewness(engine.bignum.bind(engine), flattenBigScalars(ops))
            : skewness(flattenScalars(ops))
        ),
    },

    Mode: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigMode(engine.bignum.bind(engine), flattenBigScalars(ops))
            : mode(flattenScalars(ops))
        ),
    },

    Quartiles: {
      complexity: 1200,
      broadcastable: false,
      signature:
        '((collection|number)+) -> tuple<mid:number, lower:number, upper:number>',
      examples: ['Quartiles([1, 2, 3, 4, 5])  // Returns (3, 2, 4)'],
      evaluate: (ops, { engine }) => {
        const [mid, lower, upper] = (
          bignumPreferred(engine)
            ? bigQuartiles(flattenBigScalars(ops))
            : quartiles(flattenScalars(ops))
        ).map((v) => engine.number(v));
        return engine.tuple(mid, lower, upper);
      },
    },

    InterquartileRange: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number)+) -> number',

      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigInterquartileRange(flattenBigScalars(ops))
            : interquartileRange(flattenScalars(ops))
        ),
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

        const data = (Array.from(xs.each()) as BoxedExpression[])
          .map((x) => x.re)
          .filter(Number.isFinite);
        if (data.length === 0) return undefined;

        const min = Math.min(...data);
        const max = Math.max(...data);

        // Determine bins
        let binEdges: number[];
        if (binsArg?.operator === 'List' && isBoxedFunction(binsArg)) {
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

        const data = (Array.from(xs.each()) as BoxedExpression[])
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

        const data = Array.from(xs.each()) as BoxedExpression[];
        const result: BoxedExpression[] = [];

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

        const data = Array.from(xs.each()) as BoxedExpression[];
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
  args: ReadonlyArray<BoxedExpression>
): Generator<BoxedExpression> {
  // Go over each argument and yield it if a scalar, otherwise yield its elements
  for (const arg of args) {
    if (arg.isFiniteCollection) yield* arg.each();
    else yield arg;
  }
}

function* flattenScalars(args: ReadonlyArray<BoxedExpression>) {
  for (const op of flattenArguments(args)) yield op.re;
}

function* flattenBigScalars(args: ReadonlyArray<BoxedExpression>) {
  for (const op of flattenArguments(args))
    yield op.bignumRe ?? op.engine.bignum(op.re);
}
