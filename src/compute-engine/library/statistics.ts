import { each, isFiniteCollection } from '../collection-utils';
import { erf, erfInv } from '../numerics/special-functions';
import type { BoxedExpression, IdentifierDefinitions } from '../public';
import { choose } from '../boxed-expression/expand';
import { bignumPreferred } from '../private';
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
      signature: '((collection|number)...) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigMean(engine.bignum.bind(engine), flattenBigScalars(ops))
            : mean(flattenScalars(ops))
        ),
    },

    Median: {
      complexity: 1200,
      threadable: false,
      signature: '((collection|number)...) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigMedian(flattenBigScalars(ops))
            : median(flattenScalars(ops))
        ),
    },

    Variance: {
      complexity: 1200,
      threadable: false,
      signature: '((collection|number)...) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigVariance(engine.bignum.bind(engine), flattenBigScalars(ops))
            : variance(flattenScalars(ops))
        ),
    },

    PopulationVariance: {
      complexity: 1200,
      threadable: false,
      signature: '((collection|number)...) -> number',
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
      threadable: false,
      description: 'Sample Standard Deviation of a collection of numbers.',
      signature: '((collection|number)...) -> number',
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
      threadable: false,
      description: 'Population Standard Deviation of a collection of numbers.',
      signature: '((collection|number)...) -> number',
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
      threadable: false,
      signature: '((collection|number)...) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigKurtosis(engine.bignum.bind(engine), flattenBigScalars(ops))
            : kurtosis(flattenScalars(ops))
        ),
    },

    Skewness: {
      complexity: 1200,
      threadable: false,
      signature: '((collection|number)...) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigSkewness(engine.bignum.bind(engine), flattenBigScalars(ops))
            : skewness(flattenScalars(ops))
        ),
    },

    Mode: {
      complexity: 1200,
      threadable: false,
      signature: '((collection|number)...) -> number',
      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigMode(engine.bignum.bind(engine), flattenBigScalars(ops))
            : mode(flattenScalars(ops))
        ),
    },

    Quartiles: {
      complexity: 1200,
      threadable: false,
      signature:
        '((collection|number)...) -> tuple<mid:number, lower:number, upper:number>',
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
      threadable: false,
      signature: '((collection|number)...) -> number',

      evaluate: (ops, { engine }) =>
        engine.number(
          bignumPreferred(engine)
            ? bigInterquartileRange(flattenBigScalars(ops))
            : interquartileRange(flattenScalars(ops))
        ),
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

function* flattenArguments(
  args: ReadonlyArray<BoxedExpression>
): Generator<BoxedExpression> {
  if (args.length === 1 && isFiniteCollection(args[0])) yield* each(args[0]);
  else {
    // Go over each argument and yield it if a scalar, otherwise yield its elements
    for (const arg of args) {
      if (isFiniteCollection(arg)) {
        yield* each(arg);
      } else {
        yield arg;
      }
    }
  }
}

function* flattenScalars(args: ReadonlyArray<BoxedExpression>) {
  for (const op of flattenArguments(args)) yield op.re;
}

function* flattenBigScalars(args: ReadonlyArray<BoxedExpression>) {
  for (const op of flattenArguments(args))
    yield op.bignumRe ?? op.engine.bignum(op.re);
}
