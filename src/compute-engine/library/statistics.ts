import {
  bigErf,
  bigErfc,
  bigErfi,
  bigErfInv,
  erf,
  erfc,
  erfi,
  erfInv,
} from '../numerics/special-functions';
import { apply } from '../boxed-expression/apply';
import { isNumber } from '../boxed-expression/type-guards';
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
import type {
  Expression,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { bignumPreferred } from '../boxed-expression/utils';
import { toInteger } from '../boxed-expression/numerics';
import { deterministicRandom, nextSeed } from '../numerics/random';

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
    // Note (REVIEW.md B23): Erf/Erfc/ErfInv follow the same pattern as
    // Gamma/Zeta in `library/arithmetic.ts`: exact special values fold in
    // `evaluate()`, anything else stays symbolic unless
    // `numericApproximation` is set, in which case `apply()` dispatches to
    // the machine kernel or, when the engine precision exceeds machine
    // precision, the bignum kernel. Complex arguments stay symbolic (no
    // complex kernel — previously the real part was used silently, which
    // was incorrect).
    //
    Erf: {
      description: 'Gauss error function',
      complexity: 7500,
      signature: '(number) -> number',
      type: () => 'finite_real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.Zero;
        if (x.isInfinity) return x.isPositive ? ce.One : ce.NegativeOne;
        if (!numericApproximation) return undefined;
        return apply(
          x,
          (x) => erf(x),
          (x) => bigErf(ce, x)
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
        if (!numericApproximation) return undefined;
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
        if (!numericApproximation) return undefined;
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
      // Not finite_real: Erfi(±∞) = ±∞
      type: () => 'real',
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x) || x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.Zero;
        if (x.isInfinity)
          return x.isPositive ? ce.PositiveInfinity : ce.NegativeInfinity;
        if (!numericApproximation) return undefined;
        return apply(
          x,
          (x) => erfi(x),
          (x) => bigErfi(ce, x)
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
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      description: 'Arithmetic mean of a collection of numbers.',
      evaluate: (ops, { engine, numericApproximation }) => {
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
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
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
      signature: '((collection|number)+) -> number',
      type: () => 'finite_real',
      evaluate: (ops, { engine, numericApproximation }) => {
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
      signature:
        '(collection, integer | list<number>) -> list<tuple<number, integer>>',
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
      signature: '(collection, integer | list<number>) -> list<number>',
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
          // Non-deterministic Fisher-Yates first k elements.
          for (let i = data.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
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
