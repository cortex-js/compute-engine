import {
  bigErf,
  bigErfc,
  bigErfi,
  bigErfInv,
  erf,
  erfc,
  erfi,
  erfInv,
} from '../numerics/special-functions.js';
import { erfComplex, erfiComplex } from '../numerics/numeric-complex.js';
import { apply, shouldNumericize } from '../boxed-expression/apply.js';
import { isNumber, isSymbol } from '../boxed-expression/type-guards.js';
import {
  bigCorrelation,
  bigCovariance,
  bigInterquartileRange,
  bigKurtosis,
  bigMean,
  bigMedian,
  bigMode,
  bigPopulationCovariance,
  bigPopulationVariance,
  bigQuartiles,
  bigSkewness,
  bigVariance,
  correlation,
  covariance,
  interquartileRange,
  kurtosis,
  mean,
  median,
  mode,
  populationCovariance,
  populationVariance,
  quartiles,
  skewness,
  variance,
} from '../numerics/statistics.js';
import type {
  Expression,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { bignumPreferred } from '../boxed-expression/utils.js';
import { toInteger } from '../boxed-expression/numerics.js';
import { deterministicRandom, nextSeed } from '../numerics/random.js';
import {
  distributionMean,
  distributionStandardDeviation,
  distributionVariance,
  isDistributionExpression,
} from './distributions.js';

// Geometric mean:
// Harmonic mean:

/**
 * Shared binning for `Histogram`/`BinCounts`. Returns the bin edges and the
 * count in each bin, or `undefined` if the input is not a usable finite
 * numeric collection.
 *
 * The final bin is *closed* on both ends (`[edge, lastEdge]`) so the dataset
 * maximum is counted — every interior bin is half-open `[edge, next)`.
 * (Previously every bin was half-open, so the max value, which equals the
 * last edge, was never counted.)
 */
function computeBinning(
  xs: Expression,
  binsArg: Expression
): { binEdges: number[]; counts: number[] } | undefined {
  if (!xs.isFiniteCollection) return undefined;

  const data = (Array.from(xs.each()) as Expression[])
    .map((x) => x.re)
    .filter(Number.isFinite);
  if (data.length === 0) return undefined;

  const min = Math.min(...data);
  const max = Math.max(...data);

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
  if (binEdges.length < 2) return undefined;

  const counts = Array(binEdges.length - 1).fill(0);
  const lastBin = binEdges.length - 2;
  for (const x of data) {
    for (let i = 0; i <= lastBin; i++) {
      const inBin =
        x >= binEdges[i] &&
        (x < binEdges[i + 1] || (i === lastBin && x <= binEdges[i + 1]));
      if (inBin) {
        counts[i]++;
        break;
      }
    }
  }
  return { binEdges, counts };
}

export const STATISTICS_LIBRARY: SymbolDefinitions[] = [
  {
    //
    // Erf/Erfc/ErfInv/Erfi follow the same pattern as Gamma/Zeta in
    // `library/arithmetic.ts`: exact special values fold in `evaluate()`;
    // an inexact (float) argument numericizes even under plain `evaluate()`
    // (policy D2 — no exactness to preserve), and `numericApproximation`
    // (`.N()`) always numericizes. `shouldNumericize()` dispatches to the
    // machine kernel or, when the engine precision exceeds machine
    // precision, the bignum kernel. Complex arguments route through the
    // Γ(1/2, ·)-based complex kernel (Erf/Erfi); Erfc/ErfInv stay symbolic
    // for complex (no complex kernel).
    //
    Erf: {
      description: 'Gauss error function',
      complexity: 7500,
      signature: '(number) -> number',
      // Erf is entire and bounded on the reals (Erf(±∞) = ±1); a finite
      // complex argument gives a finite complex value.
      type: (ops) => {
        const x = ops[0];
        if (!x || x.isNaN) return 'number';
        if (x.isReal === false)
          return x.isFinite === true ? 'finite_complex' : 'number';
        return 'finite_real';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        if (x.im === 0) {
          // Exact special values, regardless of numericApproximation
          if (x.isSame(0)) return ce.Zero;
          if (x.isInfinity) return x.isPositive ? ce.One : ce.NegativeOne;
        }
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        // Real args use the machine/bignum kernel; complex args the
        // Γ(1/2, ·)-based kernel.
        return apply(
          x,
          (x) => erf(x),
          (x) => bigErf(ce, x),
          erfComplex
        );
      },
    },

    Erfc: {
      description: 'Complementary error function: 1 - Erf(x)',
      complexity: 7500,
      signature: '(number) -> number',
      type: () => 'finite_real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.One;
        if (x.isInfinity) return x.isPositive ? ce.Zero : ce.number(2);
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        return apply(
          x,
          (x) => erfc(x),
          (x) => bigErfc(ce, x)
        );
      },
    },

    ErfInv: {
      description: 'Inverse of the error function',
      complexity: 7500,
      signature: '(number) -> number',
      // Not finite_real: ErfInv(±1) = ±∞
      type: () => 'real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.Zero;
        if (x.isSame(1)) return ce.PositiveInfinity;
        if (x.isSame(-1)) return ce.NegativeInfinity;
        if (x.re < -1 || x.re > 1) return ce.NaN; // outside the domain
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        return apply(
          x,
          (x) => erfInv(x),
          (x) => bigErfInv(ce, x)
        );
      },
    },

    Erfi: {
      description: 'Imaginary error function: -i·Erf(i·x)',
      complexity: 7500,
      signature: '(number) -> number',
      // Not finite_real on the reals: Erfi(±∞) = ±∞. A finite complex
      // argument gives a finite complex value.
      type: (ops) => {
        const x = ops[0];
        if (!x || x.isNaN) return 'number';
        if (x.isReal === false)
          return x.isFinite === true ? 'finite_complex' : 'number';
        return x.isFinite === true ? 'finite_real' : 'real';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        if (x.im === 0) {
          // Exact special values, regardless of numericApproximation
          if (x.isSame(0)) return ce.Zero;
          if (x.isInfinity)
            return x.isPositive ? ce.PositiveInfinity : ce.NegativeInfinity;
        }
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        // Real args use the machine/bignum kernel; complex args the
        // Γ(1/2, ·)-based kernel.
        return apply(
          x,
          (x) => erfi(x),
          (x) => bigErfi(ce, x),
          erfiComplex
        );
      },
    },
  },
  {
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-geometric-harmonic-means-in-data-analysis-2a703e21ea0?gi=d56d047586c6
    // https://towardsdatascience.com/on-average-youre-using-the-wrong-average-part-ii-b32fcb41527e

    Mean: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection|number|distribution)+) -> number',
      type: () => 'finite_real',
      description: 'Arithmetic mean (average) of a collection of numbers.',
      keywords: ['average'],
      evaluate: (ops, { engine, numericApproximation }) => {
        if (ops.length === 1 && isDistributionExpression(ops[0])) {
          const r = distributionMean(engine, ops[0]);
          return numericApproximation ? r?.N() : r;
        }
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) return exactMean(engine, vals);
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigMean(flattenBigScalars(xs))
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
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) return exactMedianOf(engine, sortExact(vals));
        }
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
      signature: '((collection|number|distribution)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        if (ops.length === 1 && isDistributionExpression(ops[0])) {
          const r = distributionVariance(engine, ops[0]);
          return numericApproximation ? r?.N() : r;
        }
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) return exactVariance(engine, vals, false);
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigVariance(flattenBigScalars(xs))
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
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) return exactVariance(engine, vals, true);
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(flattenBigScalars(xs))
            : populationVariance(flattenScalars(xs))
        );
      },
    },

    StandardDeviation: {
      complexity: 1200,
      broadcastable: false,
      description: 'Sample Standard Deviation of a collection of numbers.',
      keywords: ['stdev', 'std'],
      signature: '((collection|number|distribution)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
        if (ops.length === 1 && isDistributionExpression(ops[0])) {
          const r = distributionStandardDeviation(engine, ops[0]);
          return numericApproximation ? r?.N() : r;
        }
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals)
            return engine
              .function('Sqrt', [exactVariance(engine, vals, false)])
              .evaluate();
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigVariance(flattenBigScalars(xs)).sqrt()
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
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals)
            return engine
              .function('Sqrt', [exactVariance(engine, vals, true)])
              .evaluate();
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(flattenBigScalars(xs)).sqrt()
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
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) return exactKurtosis(engine, vals);
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigKurtosis(flattenBigScalars(xs))
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
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) return exactSkewness(engine, vals);
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigSkewness(flattenBigScalars(xs))
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
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) return exactMode(engine, vals);
        }
        const xs = ops.map((x) => x.evaluate({ numericApproximation }));
        return engine.number(
          bignumPreferred(engine)
            ? bigMode(flattenBigScalars(xs))
            : mode(flattenScalars(xs))
        );
      },
    },

    Quartiles: {
      description:
        'Lower quartile, median, and upper quartile of a collection. ' +
        'Uses the Moore–McCabe (exclusive-hinges) convention: the sample is ' +
        'split at its median, and Q1/Q3 are the medians of the lower/upper ' +
        'halves with the overall median excluded from both halves when the ' +
        'sample size is odd.',
      complexity: 1200,
      broadcastable: false,
      signature:
        '((collection|number)+) -> tuple<mid:number, lower:number, upper:number>',
      examples: ['Quartiles([1, 2, 3, 4, 5])  // Returns (1.5, 3, 4.5)'],
      evaluate: (ops, { engine, numericApproximation }) => {
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) {
            const [q1, q2, q3] = exactQuartiles(engine, vals);
            return engine.tuple(q1, q2, q3);
          }
        }
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
        if (!numericApproximation) {
          const vals = exactData(ops);
          if (vals) {
            const [q1, , q3] = exactQuartiles(engine, vals);
            return subtract(engine, q3, q1);
          }
        }
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
      // The bin spec accepts any number so Desmos-style `histogram(L, .05)`
      // (bin *width*) parses; a non-integer count is inert at evaluate
      // (`computeBinning` returns undefined) — width semantics are the
      // importer's to translate (e.g. to explicit bin edges).
      signature:
        '(collection, number | list<number>) -> list<tuple<number, integer>>',
      examples: [
        'Histogram([1, 2, 2, 3], 3)  // Returns [(1,1), (1.6667,2), (2.3333,1)]',
      ],
      evaluate: ([xs, binsArg], { engine: ce }) => {
        const binning = computeBinning(xs, binsArg);
        if (!binning) return undefined;
        const { binEdges, counts } = binning;

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
      // Same widened bin spec as Histogram (non-integer counts stay inert).
      signature: '(collection, number | list<number>) -> list<number>',
      examples: ['BinCounts([1, 2, 2, 3], 3)  // Returns [1, 2, 1]'],
      evaluate: ([xs, binsArg], { engine: ce }) => {
        const binning = computeBinning(xs, binsArg);
        if (!binning) return undefined;

        return ce.function(
          'List',
          binning.counts.map((c) => ce.number(c))
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
    //
    // Bivariate data relationships (Phase 2). Both input conventions are
    // accepted and detected structurally by `extractPairs`: two equal-length
    // collections, or one collection of 2-element (x, y) pairs. Dual
    // exact/numeric path mirroring `Variance`: all-exact data → exact
    // rational/radical result; otherwise machine or BigDecimal kernels.
    //
    Covariance: {
      description:
        'Sample covariance (n − 1 denominator) of paired data, given as two ' +
        'equal-length collections or one collection of (x, y) pairs.',
      complexity: 1200,
      broadcastable: false,
      signature: '(collection, collection?) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine: ce, numericApproximation }) =>
        evaluateCovariance(ce, ops, !!numericApproximation, false),
    },

    PopulationCovariance: {
      description:
        'Population covariance (n denominator) of paired data, given as two ' +
        'equal-length collections or one collection of (x, y) pairs.',
      complexity: 1200,
      broadcastable: false,
      signature: '(collection, collection?) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine: ce, numericApproximation }) =>
        evaluateCovariance(ce, ops, !!numericApproximation, true),
    },

    Correlation: {
      description:
        "Pearson's correlation coefficient of paired data, given as two " +
        'equal-length collections or one collection of (x, y) pairs.',
      complexity: 1200,
      broadcastable: false,
      signature: '(collection, collection?) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine: ce, numericApproximation }) =>
        evaluateCorrelation(ce, ops, !!numericApproximation),
    },

    //
    // Least-squares fitting (Phase 2). `LinearRegression` returns
    // `Tuple(b0, b1)` for the fit `b0 + b1·x`; `PolynomialFit` returns the
    // ascending coefficient `List(c0, …, c_deg)`. An optional trailing
    // variable symbol returns the fitted *expression* in that variable
    // instead. Exact data → exact rational coefficients (normal equations
    // solved by exact Gaussian elimination); inexact data / `.N()` → floats.
    //
    LinearRegression: {
      description:
        'Least-squares linear fit b0 + b1·x. Returns Tuple(b0, b1), or the ' +
        'fitted expression if a trailing variable symbol is given.',
      complexity: 1200,
      broadcastable: false,
      signature: '(any+) -> tuple<number, number>',
      evaluate: (ops, { engine: ce, numericApproximation }) =>
        evaluateLinearRegression(ce, ops, !!numericApproximation),
    },

    PolynomialFit: {
      description:
        'Least-squares polynomial fit of the given degree. Returns the ' +
        'ascending coefficient List(c0, …, c_deg), or the fitted expression ' +
        'if a trailing variable symbol is given.',
      complexity: 1200,
      broadcastable: false,
      signature: '(any+) -> list<number>',
      evaluate: (ops, { engine: ce, numericApproximation }) =>
        evaluatePolynomialFit(ce, ops, !!numericApproximation),
    },
  },
  {
    Sample: {
      description:
        'Return a random sample of k elements from the collection, ' +
        'without replacement. With an optional `seed` argument, the sample ' +
        'is deterministic.',
      complexity: 8200,
      signature: '(collection, integer, real?) -> list',
      evaluate: ([xs, nArg, seedArg], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;

        const k = toInteger(nArg);
        if (k === null || k < 0) return undefined;

        const data = Array.from(xs.each()) as Expression[];
        if (k > data.length) return undefined;

        const seed = seedArg?.re;
        if (seed !== undefined && !Number.isNaN(seed)) {
          // Deterministic Fisher-Yates with advancing seed.
          let s = seed;
          for (let i = data.length - 1; i > 0; i--) {
            const j = Math.floor(deterministicRandom(s) * (i + 1));
            [data[i], data[j]] = [data[j], data[i]];
            s = nextSeed(s);
          }
        } else {
          // No explicit seed: draw from the engine's seeded stream when
          // `ce.randomSeed` is set, otherwise non-deterministic Fisher-Yates.
          for (let i = data.length - 1; i > 0; i--) {
            const j = Math.floor(ce._random() * (i + 1));
            [data[i], data[j]] = [data[j], data[i]];
          }
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

//
// Exact statistics: under `evaluate()` (not `.N()`), when every datum is an
// exact, finite real number, accumulate with exact rational/radical arithmetic
// so `Mean([1,2,3,4]) → 5/2` instead of the machine float `2.5`. Each exact
// formula mirrors its float/bignum counterpart in `numerics/statistics.ts`, so
// `evaluate().N()` agrees with `.N()`. Under `.N()` the existing float path is
// used unchanged.
//

/**
 * If every value flattened from `ops` is an exact, finite real number, return
 * them as boxed expressions; otherwise `null` (caller falls back to the float
 * path).
 */
function exactData(ops: ReadonlyArray<Expression>): Expression[] | null {
  const vals = [...flattenArguments(ops)];
  if (vals.length === 0) return null;
  for (const v of vals)
    if (!isNumber(v) || v.isExact !== true || v.im !== 0 || v.isFinite !== true)
      return null;
  return vals;
}

const add = (ce: ComputeEngine, xs: Expression[]): Expression =>
  ce.function('Add', xs).evaluate();
const powi = (ce: ComputeEngine, x: Expression, k: number): Expression =>
  ce.function('Power', [x, ce.number(k)]);
const divide = (ce: ComputeEngine, a: Expression, b: Expression): Expression =>
  ce.function('Divide', [a, b]).evaluate();
const subtract = (
  ce: ComputeEngine,
  a: Expression,
  b: Expression
): Expression => ce.function('Subtract', [a, b]).evaluate();
const multiply = (ce: ComputeEngine, xs: Expression[]): Expression =>
  ce.function('Multiply', xs).evaluate();

function exactMean(ce: ComputeEngine, vals: Expression[]): Expression {
  return divide(ce, add(ce, vals), ce.number(vals.length));
}

/** Sample (`population=false`) or population variance, exact. Mirrors
 * `variance`/`populationVariance`: (Σx² − (Σx)²/n) / (n−1 or n). */
function exactVariance(
  ce: ComputeEngine,
  vals: Expression[],
  population: boolean
): Expression {
  const n = vals.length;
  const sum = add(ce, vals);
  const sum2 = add(
    ce,
    vals.map((v) => powi(ce, v, 2))
  );
  const numerator = subtract(
    ce,
    sum2,
    divide(ce, powi(ce, sum, 2), ce.number(n))
  );
  return divide(ce, numerator, ce.number(population ? n : n - 1));
}

function exactMedianOf(ce: ComputeEngine, sorted: Expression[]): Expression {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0)
    return divide(ce, add(ce, [sorted[mid - 1], sorted[mid]]), ce.number(2));
  return sorted[mid];
}

function sortExact(vals: Expression[]): Expression[] {
  return [...vals].sort((a, b) => a.re - b.re);
}

// Same Moore–McCabe convention as `quartiles()`/`bigQuartiles()` in
// `numerics/statistics.ts`: exclude the overall median from both the lower
// and upper half when the sample size is odd, so Q1/Q3 are symmetric.
function exactQuartiles(
  ce: ComputeEngine,
  vals: Expression[]
): [Expression, Expression, Expression] {
  const sorted = sortExact(vals);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  const upperStart = mid + (n % 2);
  return [
    exactMedianOf(ce, sorted.slice(0, mid)),
    exactMedianOf(ce, sorted),
    exactMedianOf(ce, sorted.slice(upperStart)),
  ];
}

/** Central moment m_k = (1/n) Σ (x − mean)^k, computed exactly. */
function exactCentralMoment(
  ce: ComputeEngine,
  vals: Expression[],
  mean: Expression,
  k: number
): Expression {
  const n = vals.length;
  const terms = vals.map((v) => powi(ce, subtract(ce, v, mean), k));
  return divide(ce, add(ce, terms), ce.number(n));
}

function exactKurtosis(ce: ComputeEngine, vals: Expression[]): Expression {
  const mean = exactMean(ce, vals);
  const m2 = exactCentralMoment(ce, vals, mean, 2);
  const m4 = exactCentralMoment(ce, vals, mean, 4);
  // β₂ = m4 / m2²
  return divide(ce, m4, powi(ce, m2, 2));
}

function exactSkewness(ce: ComputeEngine, vals: Expression[]): Expression {
  const mean = exactMean(ce, vals);
  const m2 = exactCentralMoment(ce, vals, mean, 2);
  const m3 = exactCentralMoment(ce, vals, mean, 3);
  // g₁ = m3 / m2^(3/2) = m3 / (m2 · √m2)
  return divide(
    ce,
    m3,
    multiply(ce, [m2, ce.function('Sqrt', [m2]).evaluate()])
  );
}

function exactMode(ce: ComputeEngine, vals: Expression[]): Expression {
  // Tie-break by smallest value (matches the ascending numeric-key iteration
  // of the float `mode`, which keeps the first value reaching the max count).
  const sorted = sortExact(vals);
  const counts = new Map<string, { count: number; val: Expression }>();
  for (const v of sorted) {
    const key = v.toString();
    const e = counts.get(key);
    if (e) e.count += 1;
    else counts.set(key, { count: 1, val: v });
  }
  let best: { count: number; val: Expression } | undefined;
  for (const e of counts.values())
    if (best === undefined || e.count > best.count) best = e;
  return best ? best.val : ce.NaN;
}

//
// Bivariate data relationships and least-squares fitting (Phase 2).
//

/** True if every value is an exact, finite, real number literal. */
function allExact(vals: ReadonlyArray<Expression>): boolean {
  for (const v of vals)
    if (!isNumber(v) || v.isExact !== true || v.im !== 0 || v.isFinite !== true)
      return false;
  return true;
}

/**
 * Extract paired samples from the two accepted conventions: two equal-length
 * collections (`[xs, ys]`), or one collection of 2-element (x, y) pairs. Returns
 * `null` if the shape is not one of these (the caller turns that into an error).
 */
function extractPairs(
  ops: ReadonlyArray<Expression>
): { xs: Expression[]; ys: Expression[] } | null {
  if (ops.length === 1) {
    const arg = ops[0];
    if (!arg.isFiniteCollection) return null;
    const xs: Expression[] = [];
    const ys: Expression[] = [];
    for (const el of arg.each()) {
      if (!el.isFiniteCollection) return null;
      const pair = [...el.each()];
      if (pair.length !== 2) return null;
      xs.push(pair[0]);
      ys.push(pair[1]);
    }
    return { xs, ys };
  }
  if (ops.length === 2) {
    const [a, b] = ops;
    if (!a.isFiniteCollection || !b.isFiniteCollection) return null;
    return { xs: [...a.each()], ys: [...b.each()] };
  }
  return null;
}

const machineVals = (vals: ReadonlyArray<Expression>): number[] =>
  vals.map((v) => v.N().re);
const bigVals = (vals: ReadonlyArray<Expression>) =>
  vals.map((v) => {
    const n = v.N();
    return n.bignumRe ?? v.engine.bignum(n.re);
  });

function shapeError(ce: ComputeEngine, name: string): Expression {
  return ce.error(
    'unexpected-argument',
    `${name} expects two equal-length collections or one collection of (x, y) pairs`
  );
}

function evaluateCovariance(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean,
  population: boolean
): Expression {
  const name = population ? 'PopulationCovariance' : 'Covariance';
  const pairs = extractPairs(ops);
  if (!pairs) return shapeError(ce, name);
  const { xs, ys } = pairs;
  if (xs.length !== ys.length)
    return ce.error(
      'unexpected-argument',
      `${name}: collections differ in length`
    );
  if (xs.length < 2)
    return ce.error(
      'unexpected-argument',
      `${name}: at least 2 data points required`
    );

  if (!numericApproximation && allExact(xs) && allExact(ys))
    return exactCovariance(ce, xs, ys, population);

  if (bignumPreferred(ce))
    return ce.number(
      population
        ? bigPopulationCovariance(bigVals(xs), bigVals(ys))
        : bigCovariance(bigVals(xs), bigVals(ys))
    );
  return ce.number(
    population
      ? populationCovariance(machineVals(xs), machineVals(ys))
      : covariance(machineVals(xs), machineVals(ys))
  );
}

function evaluateCorrelation(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  const pairs = extractPairs(ops);
  if (!pairs) return shapeError(ce, 'Correlation');
  const { xs, ys } = pairs;
  if (xs.length !== ys.length)
    return ce.error(
      'unexpected-argument',
      'Correlation: collections differ in length'
    );
  if (xs.length < 2)
    return ce.error(
      'unexpected-argument',
      'Correlation: at least 2 data points required'
    );

  if (!numericApproximation && allExact(xs) && allExact(ys)) {
    const r = exactCorrelation(ce, xs, ys);
    return r ?? ce.error('unexpected-argument', 'Correlation: zero variance');
  }

  const r = bignumPreferred(ce)
    ? bigCorrelation(bigVals(xs), bigVals(ys))
    : correlation(machineVals(xs), machineVals(ys));
  const num = ce.number(r);
  return num.isNaN
    ? ce.error('unexpected-argument', 'Correlation: zero variance')
    : num;
}

/** Exact sample/population covariance: (Σxy − ΣxΣy/n)/(n−1 or n). */
function exactCovariance(
  ce: ComputeEngine,
  xs: Expression[],
  ys: Expression[],
  population: boolean
): Expression {
  const n = xs.length;
  const sx = add(ce, xs);
  const sy = add(ce, ys);
  const sxy = add(
    ce,
    xs.map((x, i) => multiply(ce, [x, ys[i]]))
  );
  const num = subtract(
    ce,
    sxy,
    divide(ce, multiply(ce, [sx, sy]), ce.number(n))
  );
  return divide(ce, num, ce.number(population ? n : n - 1));
}

/** Exact Pearson r; `null` if a variance is zero (division by zero). */
function exactCorrelation(
  ce: ComputeEngine,
  xs: Expression[],
  ys: Expression[]
): Expression | null {
  const n = xs.length;
  const sx = add(ce, xs);
  const sy = add(ce, ys);
  const sxy = add(
    ce,
    xs.map((x, i) => multiply(ce, [x, ys[i]]))
  );
  const sx2 = add(
    ce,
    xs.map((x) => powi(ce, x, 2))
  );
  const sy2 = add(
    ce,
    ys.map((y) => powi(ce, y, 2))
  );
  const cov = subtract(
    ce,
    sxy,
    divide(ce, multiply(ce, [sx, sy]), ce.number(n))
  );
  const vx = subtract(ce, sx2, divide(ce, powi(ce, sx, 2), ce.number(n)));
  const vy = subtract(ce, sy2, divide(ce, powi(ce, sy, 2), ce.number(n)));
  if (vx.isSame(0) || vy.isSame(0)) return null;
  const denom = ce.function('Sqrt', [multiply(ce, [vx, vy])]).evaluate();
  return divide(ce, cov, denom);
}

//
// Least-squares fitting.
//

const MAX_FIT_DEGREE = 12;

/**
 * Parse the regression argument list: an optional trailing variable symbol,
 * an optional trailing integer degree (for `PolynomialFit`), and the data as
 * either two collections or one collection of pairs.
 */
function parseFitArgs(
  ops: ReadonlyArray<Expression>,
  wantDegree: boolean
): {
  xs: Expression[];
  ys: Expression[];
  degree: number;
  variable?: string;
} | null {
  let rest = [...ops];

  // Optional trailing variable symbol.
  let variable: string | undefined;
  const last = rest[rest.length - 1];
  if (rest.length > 0 && isSymbol(last)) {
    variable = last.symbol;
    rest = rest.slice(0, -1);
  }

  // Optional/required trailing integer degree.
  let degree = 1;
  if (wantDegree) {
    if (rest.length === 0) return null;
    const d = toInteger(rest[rest.length - 1]);
    if (d === null) return null;
    degree = d;
    rest = rest.slice(0, -1);
  }

  const pairs = extractPairs(rest);
  if (!pairs) return null;
  return { xs: pairs.xs, ys: pairs.ys, degree, variable };
}

function evaluateLinearRegression(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  const parsed = parseFitArgs(ops, false);
  if (!parsed)
    return ce.error(
      'unexpected-argument',
      'LinearRegression: invalid arguments'
    );
  const coeffs = fitCoefficients(
    ce,
    parsed.xs,
    parsed.ys,
    1,
    numericApproximation
  );
  if (!coeffs)
    return ce.error('unexpected-argument', 'LinearRegression: degenerate data');
  const [b0, b1] = coeffs;
  if (parsed.variable !== undefined)
    return buildPolynomial(ce, coeffs, parsed.variable);
  return ce.tuple(b0, b1);
}

function evaluatePolynomialFit(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  const parsed = parseFitArgs(ops, true);
  if (!parsed)
    return ce.error('unexpected-argument', 'PolynomialFit: invalid arguments');
  const { xs, degree, variable } = parsed;
  if (!Number.isInteger(degree) || degree < 0 || degree > MAX_FIT_DEGREE)
    return ce.error(
      'unexpected-argument',
      `PolynomialFit: degree must be an integer in [0, ${MAX_FIT_DEGREE}]`
    );
  if (degree > xs.length - 1)
    return ce.error(
      'unexpected-argument',
      'PolynomialFit: not enough data points for the requested degree'
    );
  const coeffs = fitCoefficients(
    ce,
    parsed.xs,
    parsed.ys,
    degree,
    numericApproximation
  );
  if (!coeffs)
    return ce.error('unexpected-argument', 'PolynomialFit: degenerate data');
  if (variable !== undefined) return buildPolynomial(ce, coeffs, variable);
  return ce.function('List', coeffs);
}

/**
 * Ascending least-squares coefficients `[c0, …, c_deg]` for `y ≈ Σ c_j x^j`,
 * via the Vandermonde normal equations `(XᵀX)β = Xᵀy`. Exact data flows through
 * exact rational elimination; inexact data / `numericApproximation` yield
 * floats. Returns `null` for degenerate (singular) inputs.
 */
function fitCoefficients(
  ce: ComputeEngine,
  xs: Expression[],
  ys: Expression[],
  degree: number,
  numericApproximation: boolean
): Expression[] | null {
  const n = xs.length;
  if (n !== ys.length || n < degree + 1) return null;

  const exact = !numericApproximation && allExact(xs) && allExact(ys);
  // Under `.N()` or with inexact data, work with floats so the result is a
  // float; otherwise keep the boxed (exact) values.
  const X = exact ? xs : xs.map((x) => ce.number(x.N().re));
  const Y = exact ? ys : ys.map((y) => ce.number(y.N().re));

  // Powers x_i^j for j = 0 … 2·degree.
  const maxPow = 2 * degree;
  const powers: Expression[][] = X.map((x) => {
    const row: Expression[] = [ce.One];
    for (let j = 1; j <= maxPow; j++)
      row.push(ce.function('Power', [x, ce.number(j)]).evaluate());
    return row;
  });

  // Normal matrix A[j][k] = Σ x_i^{j+k}; RHS c[j] = Σ x_i^j · y_i.
  const m = degree + 1;
  const A: Expression[][] = [];
  const b: Expression[] = [];
  for (let j = 0; j < m; j++) {
    const rowA: Expression[] = [];
    for (let k = 0; k < m; k++)
      rowA.push(
        add(
          ce,
          powers.map((p) => p[j + k])
        )
      );
    A.push(rowA);
    b.push(
      add(
        ce,
        powers.map((p, i) => multiply(ce, [p[j], Y[i]]))
      )
    );
  }

  return gaussSolve(ce, A, b);
}

/**
 * Solve `A x = b` (A square) by Gaussian elimination with partial pivoting,
 * using boxed arithmetic so exact rational entries yield exact solutions.
 * Returns `null` on a singular system. This is *not* reachable from
 * simplification, so it never calls `.simplify()`.
 */
function gaussSolve(
  ce: ComputeEngine,
  A: Expression[][],
  b: Expression[]
): Expression[] | null {
  const n = A.length;
  const aug: Expression[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot on the largest magnitude (numeric proxy for exact too).
    let piv = col;
    let pivMag = Math.abs(aug[col][col].N().re);
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(aug[r][col].N().re);
      if (mag > pivMag) {
        pivMag = mag;
        piv = r;
      }
    }
    if (!(pivMag > 0)) return null; // singular
    if (piv !== col) [aug[col], aug[piv]] = [aug[piv], aug[col]];

    const pivot = aug[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = aug[r][col].div(pivot);
      for (let j = col; j <= n; j++)
        aug[r][j] = aug[r][j].sub(factor.mul(aug[col][j]));
    }
  }

  const x: Expression[] = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = aug[i][n];
    for (let j = i + 1; j < n; j++) s = s.sub(aug[i][j].mul(x[j]));
    x[i] = s.div(aug[i][i]);
  }
  return x;
}

/** Build `c0 + c1·v + c2·v² + …` with canonical construction (no simplify).
 * Terms with an exactly-zero coefficient are skipped so the fitted expression
 * reads `x² + 1`, not `x² + 0x + 1`. */
function buildPolynomial(
  ce: ComputeEngine,
  coeffs: Expression[],
  variable: string
): Expression {
  const v = ce.symbol(variable);
  const terms: Expression[] = [];
  for (let j = 0; j < coeffs.length; j++) {
    const c = coeffs[j];
    if (c.isSame(0) || (isNumber(c) && c.re === 0)) continue;
    if (j === 0) terms.push(c);
    else if (j === 1) terms.push(ce.function('Multiply', [c, v]));
    else
      terms.push(
        ce.function('Multiply', [c, ce.function('Power', [v, ce.number(j)])])
      );
  }
  if (terms.length === 0) return ce.Zero;
  return ce.function('Add', terms);
}
