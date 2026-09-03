import { operandLiteralValue } from './type-handlers.js';
import {
  type DataConstraint,
  dataConstraintError,
  hasNonFiniteImaginaryPart,
  isComplexDatum,
  nonFiniteDatum,
  nonRealDataError,
  nonRealDatum,
  realProjection,
} from './statistics-data.js';
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
import { infinitePoint } from '../boxed-expression/infinite-point.js';
import {
  isAbsentValue,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  MAX_SIZE_EAGER_COLLECTION,
  canEnumerateFiniteSource,
  groundEnumerationOperand,
  typeCouldBeCollection,
} from '../collection-utils.js';
import {
  enumerationDeclinedAfterWalk,
  innerRun,
  joinCharacters,
  stringAwareWindowedCollectionOps,
} from './collections.js';
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
  OperandDescriptor,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { EXTENDED_REAL_TYPE } from '../../common/type/primitive.js';
import { typeFact } from '../boxed-expression/operand-descriptor.js';
import {
  bignumPreferred,
  withDrawRollback,
} from '../boxed-expression/utils.js';
import {
  numberLiteralOf,
  toInteger,
  provablyNonFiniteNumber,
} from '../boxed-expression/numerics.js';
import { randomCount } from './random-utils.js';
import { checkDeadline } from '../../common/interruptible.js';
import { findFit } from '../nonlinear-fit.js';
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
 * count in each bin, `{ rejected }` naming a datum or bin edge the binning
 * refuses and the constraint it failed, or `undefined` if the input is not a
 * usable finite numeric collection.
 *
 * The final bin is *closed* on both ends (`[edge, lastEdge]`) so the dataset
 * maximum is counted — every interior bin is half-open `[edge, next)`.
 * (Previously every bin was half-open, so the max value, which equals the
 * last edge, was never counted.)
 *
 * Binning is an order statistic: a bin is an interval of the real line, and
 * the complex plane has no canonical ordering to cut into intervals. Both the
 * sample and the explicit bin edges are read through `realProjection` below,
 * so a complex value there would bin data nobody supplied; the caller turns
 * the `real` rejection into the same `incompatible-type` error the other
 * order-based statistics answer. The scan shares the single enumeration of the
 * source: walking it twice would re-run a lazy element callback per datum.
 *
 * A datum with no FINITE real reading — `NaN`, a real `±∞`, or the complex
 * infinity `~oo` — is rejected the same way, as `real`. It used to be
 * dropped from the sample (`data.filter(Number.isFinite)`), so
 * `BinCounts([1, +oo, 5], 2)` reported the counts of the two-point dataset
 * `[1, 5]` with no hint that a value had been discarded, and a non-finite
 * explicit EDGE made every interval comparison false and fabricated a row of
 * zero counts. Unlike `Mean`/`Variance`, these heads cannot absorb the value
 * into their answer: a histogram's result is a vector of COUNTS, and no count
 * means "unreadable" — see `dataConstraintError` in `statistics-data.ts`.
 *
 * The third rejection, `machine_range`, is this kernel's own limit rather than
 * a statement about the value: everything below — the sample min and max, the
 * bin width, and every interval comparison — is machine-float arithmetic, so a
 * datum whose magnitude exceeds the double range (`10^400`, an exact finite
 * integer) projects to `Infinity` and would produce infinite bin edges and
 * counts describing no dataset. The statistics that sum their data exactly
 * (`Mean`, `Covariance`, the least-squares fits) have no such limit and accept
 * such a value.
 *
 * An element that is not a NUMBER LITERAL declines instead, the same way
 * `empiricalQuantile` (`library/distributions.ts`) does: `Sqrt(-2)` is a
 * function expression during ordinary evaluation, so the complex scan cannot
 * see it, and it used to project to `NaN` and be silently DROPPED from the
 * sample — `BinCounts([1, Sqrt(-2), 5], 2)` reported counts for the two-point
 * dataset `[1, 5]`. Staying inert leaves the answer to `.N()`, where the
 * element numericizes to a literal and the complex scan rejects it.
 */
function computeBinning(
  xs: Expression,
  binsArg: Expression
):
  | { binEdges: number[]; counts: number[]; rejected?: undefined }
  | { rejected: { value: Expression; constraint: DataConstraint } }
  | undefined {
  if (!xs.isFiniteCollection) return undefined;

  const elements = Array.from(xs.each()) as Expression[];
  if (!elements.every(isNumber)) return undefined;
  const nonRealElement = nonRealDatum(elements);
  if (nonRealElement)
    return { rejected: { value: nonRealElement, constraint: 'real' } };
  const nonFiniteElement = nonFiniteDatum(elements);
  if (nonFiniteElement)
    return { rejected: { value: nonFiniteElement, constraint: 'real' } };
  const data = elements.map(realProjection);
  // Every value that survived the two scans above is a finite real, so a
  // projection that is not finite means only one thing: the magnitude is
  // outside the double range this kernel bins in.
  const unreadable = data.findIndex((x) => !Number.isFinite(x));
  if (unreadable >= 0)
    return {
      rejected: { value: elements[unreadable], constraint: 'machine_range' },
    };
  if (data.length === 0) return undefined;

  const min = Math.min(...data);
  const max = Math.max(...data);

  let binEdges: number[];
  if (binsArg.isCollection) {
    const edges = [...binsArg.each()];
    if (!edges.every(isNumber)) return undefined;
    const nonRealEdge = nonRealDatum(edges);
    if (nonRealEdge)
      return { rejected: { value: nonRealEdge, constraint: 'real' } };
    const nonFiniteEdge = nonFiniteDatum(edges);
    if (nonFiniteEdge)
      return { rejected: { value: nonFiniteEdge, constraint: 'real' } };
    binEdges = edges.map(realProjection);
    // As for the data above: a finite real edge whose projection is not finite
    // is one this kernel's machine-float comparisons cannot place.
    const unreadableEdge = binEdges.findIndex((x) => !Number.isFinite(x));
    if (unreadableEdge >= 0)
      return {
        rejected: { value: edges[unreadableEdge], constraint: 'machine_range' },
      };
  } else {
    // The scalar spec is a bin COUNT, and a NON-INTEGER scalar declines
    // rather than rounding: the declared `number` deliberately admits
    // Desmos-style bin-WIDTH spellings (`histogram(L, .05)`) so they
    // parse, and the contract (see the `Histogram` signature note) is that
    // they stay INERT for the importer to translate — `toInteger` alone
    // Math.rounds, so `BinCounts(L, 2.5)` silently answered the 3-bin
    // question instead. Integrality is tested with the EXACT `isInteger`
    // predicate, not by comparing against `.re`: `.re` is a rounded double
    // for bignum operands, so a high-precision near-integer would slip
    // through a `.re` comparison.
    if (!isNumber(binsArg) || binsArg.isInteger !== true) return undefined;
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

/** Data whose every element is a proven finite real. */
const FINITE_REAL_DATA = parseType('collection<real>')!;

/** The pair form of the same data: one collection of (x, y) points. */
const FINITE_REAL_PAIRS = parseType('collection<tuple<real, real>>')!;

/**
 * Result type of `Covariance`, `PopulationCovariance` and `Correlation`,
 * which all accept their paired data either as two equal-length collections
 * or as one collection of (x, y) pairs.
 *
 * Each is a sum of products of deviations from a mean, divided by a count, so
 * a single non-finite data value poisons the whole result: with `NaN` or `±∞`
 * anywhere in the data the answer is `NaN`
 * (`Covariance([1, NaN], [2, 3])` evaluates to `NaN`). That is why the
 * DECLARED result of all three carries a `nan` arm. This gate drops the arm —
 * narrowing to the bare `real` — only when the operand types PROVE every data
 * value is a finite real, in whichever of the two input forms was used.
 *
 * Otherwise it DECLINES, and the declared `real | nan` stands. Answering the
 * wide `number` here instead, as it used to, would have HIDDEN that sharper
 * declaration: a type-handler answer is never widened, and it is never
 * narrowed either, so a handler that answers `number` is what the application
 * reports.
 *
 * That claim describes the numeric answer only. An input the operator rejects
 * — fewer than two data points, two collections of different lengths, a
 * complex or non-numeric data value, or (for `Correlation`) zero variance —
 * satisfies the type gate but evaluates to an `Error(...)`, whose own type is
 * outside the numeric lattice, so it neither confirms nor contradicts a
 * `real` result type.
 *
 * The `real` narrowing has one gap the operand types cannot close: finite real
 * data large enough to overflow the sums of squares (values around `1e200` at
 * machine precision) saturates to `+oo`. It is not a soundness hole — the
 * engine-wide convention is that a declared type describes the MATHEMATICAL
 * value and a machine-precision artifact does not falsify it (`Exp(1000)` is
 * typed finite while its machine-precision `.N()` is `+oo`; ruling L6(a),
 * `docs/SIGNATURE-GUIDELINES.md` §2.4). What is left open is the numeric path
 * itself, recorded in `ROADMAP.md` under the items left open by the
 * type-handler retirement sweep: whether these kernels should scale their
 * sums so machine-range data gets a finite answer at machine precision too.
 */
function pairedStatisticType(
  ops: ReadonlyArray<OperandDescriptor>
): Type | undefined {
  const [xs, ys] = ops;
  if (xs === undefined) return undefined;
  if (ys === undefined)
    return typeFact(xs.type, FINITE_REAL_PAIRS) === true ? 'real' : undefined;
  return typeFact(xs.type, FINITE_REAL_DATA) === true &&
    typeFact(ys.type, FINITE_REAL_DATA) === true
    ? 'real'
    : undefined;
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
      // The carrier is every point where erf has a value: the finite
      // complex numbers (erf is entire) and the signed infinities
      // (`Erf(±∞) = ±1` — which is also why the RESULT is plain
      // `complex`: every value is finite). `~oo` is off-carrier — an
      // incompatible-type error — by the family-wide ruling (2026-08-31);
      // it used to answer `~oo`, a value erf does not have (erf has no
      // limit at complex infinity). `NaN` propagates (explicit: this
      // carrier is not a subtype of `complex`, so the derived default
      // would be `reject`).
      signature: '(complex | signed_infinity) -> complex',
      nanBehavior: 'propagate',
      // Erf is entire and bounded on the reals (Erf(±∞) = ±1); a finite
      // complex argument gives a finite complex value. An operand of unproven
      // realness (a `number`-typed symbol) keeps the generic finite hedge —
      // its value may be complex, so it must not claim real.
      type: (ops) => {
        const x = ops[0];
        // A proven-NaN operand: decline, so the framework's proven-NaN
        // arm answers the sharp `nan`.
        if (!x || x.isNaN) return undefined;
        if (x.isExtendedReal === false)
          return x.isFinite === true ? 'complex' : 'number';
        if (x.isExtendedReal === true) return 'real';
        // Unknown realness: exclude a non-finite value (~oo) before hedging.
        if (provablyNonFiniteNumber(x)) return 'number';
        return 'number';
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
      // The same carrier as `Erf` (erfc = 1 − erf): the finite complex
      // numbers plus the signed infinities, where the values are genuine
      // (`Erfc(+∞) = 0`, `Erfc(−∞) = 2`) — and finite, which is why the
      // RESULT is plain `complex`. `~oo` is off-carrier — erfc has no
      // limit at complex infinity — and errors at BOXING (nothing
      // bypasses validation here); it used to stay inert. `NaN`
      // propagates (explicit: this carrier is not a subtype of
      // `complex`, so the derived default would be `reject`).
      signature: '(complex | signed_infinity) -> complex',
      nanBehavior: 'propagate',
      // Same shape as Erf: entire, bounded on the reals (Erfc(±∞) = 2, 0).
      type: (ops) => {
        const x = ops[0];
        // A proven-NaN operand: decline, so the framework's proven-NaN
        // arm answers the sharp `nan`.
        if (!x || x.isNaN) return undefined;
        if (x.isExtendedReal === false)
          return x.isFinite === true ? 'complex' : 'number';
        if (x.isExtendedReal === true) return 'real';
        // Unknown realness: exclude a non-finite value (~oo) before hedging.
        if (provablyNonFiniteNumber(x)) return 'number';
        return 'number';
      },
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
      // The engine has a REAL kernel only. On the real segment (−1, 1) the
      // value is a finite real, ±1 are the ±∞ poles, and everywhere else on
      // the carrier the application has a value the engine cannot compute
      // — erf is entire and non-constant, so `erf(z) = 2` has complex
      // solutions — and stays SYMBOLIC (a capability gap, the `LambertW`
      // off-branch precedent; ruled 2026-09-02, batch 9 of
      // `docs/plans/2026-08-30-error-model-implementation.md`). Every
      // infinity is decided: erfinv has no limit there, so `±∞`, `~oo` and
      // an anonymous infinity answer NaN. `NaN` propagates (explicit: the
      // carrier is not below `complex`).
      signature: '(complex | infinity) -> number',
      nanBehavior: 'propagate',
      type: ([x]) => {
        // A proven-NaN operand declines, so the framework's proven-NaN arm
        // answers; an infinite literal is a decided NaN.
        if (!x || x.isNaN === true) return undefined;
        if (infinitePoint(x) !== undefined) return 'nan';
        if (provablyNonFiniteNumber(x)) return 'number';
        if (x.isExtendedReal !== true) return 'number';
        // A literal's handler-visible value classifies exactly — and it is
        // never a rounded double, so it cannot put `1 − 10⁻³⁰` at a pole
        // (`operandLiteralValue` is the channel that survives when the
        // value reads are unavailable to a type handler).
        const v = operandLiteralValue(x);
        if (v !== undefined) {
          if (v > -1 && v < 1) return 'real';
          if (v === 1 || v === -1) return '+oo | -oo';
          return 'number';
        }
        if (x.isGreater(-1) === true && x.isLess(1) === true) return 'real';
        // Exact pole check for literals: `isEqual` is tolerance-based and
        // would put `1 + 10⁻²⁰` (whose value is NaN, not ±∞) at the pole.
        if (
          isNumber(x)
            ? x.isSame(1) || x.isSame(-1)
            : x.isEqual(1) === true || x.isEqual(-1) === true
        )
          return '+oo | -oo';
        return 'number';
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        if (!isNumber(x)) return undefined;
        if (x.isNaN === true) return ce.NaN;
        // No limit at any infinity: NaN on both routes (the real kernel used
        // to answer NaN for ±∞ and the others stayed inert).
        if (infinitePoint(x) !== undefined) return ce.NaN;
        // A non-real argument, or a real one outside [−1, 1], has a value
        // the real kernel cannot compute: stay symbolic, under N() too.
        if (x.im !== 0) return undefined;
        // Exact special values, regardless of numericApproximation
        if (x.isSame(0)) return ce.Zero;
        if (x.isSame(1)) return ce.PositiveInfinity;
        if (x.isSame(-1)) return ce.NegativeInfinity;
        if (x.re < -1 || x.re > 1) return undefined;
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
      // The carrier is every point where erfi has a value: the finite
      // complex numbers (erfi is entire) and the signed infinities
      // (`Erfi(±∞) = ±∞`). `~oo` is off-carrier — an `incompatible-type`
      // error, the `Erf` arrangement: erfi is bounded on the imaginary axis
      // (`erfi(iy) = i·erf(y)`, so `|erfi(iy)| ≤ 1`) while it grows without
      // bound on the real axis, so it has no limit at complex infinity (it
      // used to answer `~oo`, a value erfi does not have). `NaN` propagates
      // (explicit: the carrier is not below `complex`).
      signature: '(complex | signed_infinity) -> complex | signed_infinity',
      nanBehavior: 'propagate',
      // Erfi is entire and odd: a finite real → finite real, but Erfi(±∞) =
      // ±∞, so an argument only known to be on the EXTENDED real line needs
      // the extended real line as its claim — the bare name `real` denotes the
      // finite reals and would exclude ±∞. A finite complex argument gives a
      // finite complex value. Unproven realness → `number` (Erfi is unbounded,
      // so no finite hedge is available). A proven-NaN operand declines, so
      // the framework's proven-NaN arm answers the sharp `nan`.
      type: (ops) => {
        const x = ops[0];
        if (!x || x.isNaN) return undefined;
        if (x.isExtendedReal === false)
          return x.isFinite === true ? 'complex' : 'number';
        if (x.isExtendedReal === true)
          return x.isFinite === true ? 'real' : EXTENDED_REAL_TYPE;
        return 'number';
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
      signature: '((collection<any>|number|distribution)+) -> number',
      // A data-consuming aggregate (§3.C): result type is the numeric base
      // with NO `| missing` arm (I6 absorption) — `number`, NOT `real`,
      // because every arm of the wide type is reachable. An absent datum or
      // empty input evaluates to `NaN` (`Mean([1, NaN, 3])`, `Mean([])`);
      // infinite data keeps its limit (`Mean([1, +oo, 3])` is `+oo`); and
      // complex data has a complex mean (`Mean([1, 1+2i])` is `1 + i`).
      // Three named arms would be needed to say less, so the base type says
      // it in one token.
      //
      // The operand carrier stays `collection<any>` — the ABSENCE-admitting
      // top — because the §3.C rule requires `[1, Missing, 3]` to REACH this
      // handler: the bare spelling `collection` is the values-only
      // `collection<unknown>`, which `list<integer|missing>` does not match,
      // so it would refuse the very input the rule is about.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      description: 'Arithmetic mean (average) of a collection of numbers.',
      keywords: ['average'],
      evaluate: (ops, { engine, numericApproximation }) => {
        if (ops.length === 1 && isDistributionExpression(ops[0])) {
          const r = distributionMean(engine, ops[0]);
          return numericApproximation ? r?.N() : r;
        }
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'Mean', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        // Complex data: the arithmetic mean is linear over the complex
        // numbers, so no convention has to be chosen and the answer is the
        // complex mean — `Mean([1, 1+2i])` is `1 + i`. The boxed accumulation
        // serves both paths: it is exact on exact data, and `.N()`
        // numericizes what it returns.
        if (nonRealDatum(xs)) {
          if (hasNonFiniteDatum(xs)) return engine.NaN;
          const m = boxedMean(engine, xs);
          return numericApproximation ? m.N() : m;
        }
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) return boxedMean(engine, vals);
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigMean(bigScalarsOf(xs))
            : mean(scalarsOf(xs))
        );
      },
    },

    Median: {
      complexity: 1200,
      broadcastable: false,
      signature: '((collection<any>|number)+) -> real | signed_infinity | nan',
      // Complex data is REJECTED here (`nonRealUnivariateError`) and a
      // non-numeric datum with it (`collectData`); an `Error(...)` has a type
      // outside the numeric lattice, so it neither confirms nor contradicts
      // this claim. The three arms are each witnessed: a real answer for
      // ordinary data, an infinite one for infinite data
      // (`Median([+oo, +oo])` is `+oo`), and `NaN` for an absent datum or empty
      // input (§3.C). The `handle` policies below say so: the derived NaN
      // policy for a carrier that already admits `nan` is `inert`, which
      // would leave unsaid that this head ANSWERS `NaN` for absent data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      description: 'Median of a collection of numbers.',
      examples: ['Mode([1, 2, 2, 3])  // Returns 2'],
      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'Median', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        const nonReal = nonRealUnivariateError(engine, 'Median', xs);
        if (nonReal) return nonReal;
        // A datum with no real value leaves the sort with nothing to order by
        // — see `hasValuelessDatum`.
        if (hasValuelessDatum(xs)) return engine.NaN;
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) return exactMedianOf(engine, sortExact(vals));
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigMedian(bigScalarsOf(xs))
            : median(scalarsOf(xs))
        );
      },
    },

    Variance: {
      description: 'Sample variance of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection<any>|number|distribution)+) -> real<0..> | nan',
      // The variance is a mean of SQUARED deviations, so it is real and
      // non-negative even for complex data (`Variance([1, 1+2i, 3])` is
      // `8/3` — see `complexVariance`), and infinite data has no variance at
      // all: every infinite datum makes the deviations `∞ − ∞` and the
      // answer `NaN` (`Variance([1, +oo, 3])` and `Variance([+oo, +oo])` are
      // both `NaN`, measured). Absent data and empty input are `NaN` too
      // (§3.C), which is the second arm. The `handle` policies say so: the
      // derived NaN policy for a carrier that already admits `nan` is
      // `inert`, which would leave unsaid that this head ANSWERS `NaN`.
      //
      // Two documented gaps in the `real<0..>` half, neither a value the
      // claim contradicts. Data large enough to overflow the machine sums of
      // squares saturates to `+oo` at `ce.precision = 'machine'`; the
      // engine-wide convention is that a declared type describes the
      // MATHEMATICAL value and a machine-precision artifact does not falsify
      // it (`Exp(1000)` settles it — see ruling L6(a) in
      // `docs/SIGNATURE-GUIDELINES.md` §2.4). And a DISTRIBUTION operand with
      // a symbolic parameter answers a symbolic expression whose static type
      // is wider (`Variance(ExponentialDistribution(l))` is `l^-2`, typed
      // `real | infinity | nan`); its VALUE is non-negative for every legal
      // parameter, which is what the declaration describes.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      evaluate: (ops, { engine, numericApproximation }) => {
        if (ops.length === 1 && isDistributionExpression(ops[0])) {
          const r = distributionVariance(engine, ops[0]);
          return numericApproximation ? r?.N() : r;
        }
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'Variance', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        // Complex data: the variance is E[|X − μ|²] — a real, non-negative
        // number (see `complexVariance`).
        if (nonRealDatum(xs)) {
          if (hasNonFiniteDatum(xs)) return engine.NaN;
          const v = complexVariance(engine, xs, false);
          return numericApproximation ? v.N() : v;
        }
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) return exactVariance(engine, vals, false);
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigVariance(bigScalarsOf(xs))
            : variance(scalarsOf(xs))
        );
      },
    },

    PopulationVariance: {
      description: 'Population variance of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection<any>|number)+) -> real<0..> | nan',
      // The population variance is the same mean of SQUARED deviations the
      // sample variance is, over the divisor `n`: real and non-negative even
      // for complex data (`PopulationVariance([1, 1+2i, 3])` is `16/9` — see
      // `complexVariance`).
      // Infinite data has no variance at all: every infinite datum makes the
      // deviations `∞ − ∞` and the answer `NaN`, which is also the answer for
      // absent data and empty input (§3.C). That is the second arm. The
      // `handle` policies say so: the derived NaN policy for a carrier that
      // already admits `nan` is `inert`, which would leave unsaid that this
      // head ANSWERS `NaN`.
      //
      // Data large enough to overflow the machine sums of squares saturates
      // to `+oo` at `ce.precision = 'machine'`. That does not falsify
      // `real<0..>`: the engine-wide convention is that a declared type
      // describes the MATHEMATICAL value, and a machine-precision artifact
      // does not (`Exp(1000)` settles it — ruling L6(a),
      // `docs/SIGNATURE-GUIDELINES.md` §2.4).
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'PopulationVariance', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        // Complex data: the variance is E[|X − μ|²] — a real, non-negative
        // number (see `complexVariance`).
        if (nonRealDatum(xs)) {
          if (hasNonFiniteDatum(xs)) return engine.NaN;
          const v = complexVariance(engine, xs, true);
          return numericApproximation ? v.N() : v;
        }
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) return exactVariance(engine, vals, true);
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(bigScalarsOf(xs))
            : populationVariance(scalarsOf(xs))
        );
      },
    },

    StandardDeviation: {
      complexity: 1200,
      broadcastable: false,
      description: 'Sample Standard Deviation of a collection of numbers.',
      keywords: ['stdev', 'std'],
      signature: '((collection<any>|number|distribution)+) -> real<0..> | nan',
      // The standard deviation is the square root of a mean of SQUARED
      // deviations, so it is real and non-negative even for complex data
      // (`StandardDeviation([1, 1+2i, 3])` is `2/3·√6` — see
      // `complexVariance`).
      // Infinite data has no standard deviation at all: every infinite datum makes the
      // deviations `∞ − ∞` and the answer `NaN`, which is also the answer for
      // absent data and empty input (§3.C). That is the second arm. The
      // `handle` policies say so: the derived NaN policy for a carrier that
      // already admits `nan` is `inert`, which would leave unsaid that this
      // head ANSWERS `NaN`.
      //
      // Data large enough to overflow the machine sums of squares saturates
      // to `+oo` at `ce.precision = 'machine'`. That does not falsify
      // `real<0..>`: the engine-wide convention is that a declared type
      // describes the MATHEMATICAL value, and a machine-precision artifact
      // does not (`Exp(1000)` settles it — ruling L6(a),
      // `docs/SIGNATURE-GUIDELINES.md` §2.4).
      // A DISTRIBUTION operand with a symbolic parameter is the other gap:
      // the answer is then a symbolic expression whose static type is wider
      // (`StandardDeviation(NormalDistribution(0, s))` is `s`, typed `real`),
      // while its VALUE is non-negative for every legal parameter — which is
      // what the declaration describes.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      evaluate: (ops, { engine, numericApproximation }) => {
        if (ops.length === 1 && isDistributionExpression(ops[0])) {
          const r = distributionStandardDeviation(engine, ops[0]);
          return numericApproximation ? r?.N() : r;
        }
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'StandardDeviation', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        // Complex data: the standard deviation is the square root of
        // E[|X − μ|²], which is real and non-negative (see `complexVariance`).
        if (nonRealDatum(xs)) {
          if (hasNonFiniteDatum(xs)) return engine.NaN;
          const s = engine
            .function('Sqrt', [complexVariance(engine, xs, false)])
            .evaluate();
          return numericApproximation ? s.N() : s;
        }
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals)
            return engine
              .function('Sqrt', [exactVariance(engine, vals, false)])
              .evaluate();
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigVariance(bigScalarsOf(xs)).sqrt()
            : Math.sqrt(variance(scalarsOf(xs)))
        );
      },
    },

    PopulationStandardDeviation: {
      complexity: 1200,
      broadcastable: false,
      description: 'Population Standard Deviation of a collection of numbers.',
      signature: '((collection<any>|number)+) -> real<0..> | nan',
      // The population standard deviation is the square root of a mean of
      // SQUARED deviations over the divisor `n`, so it is real and
      // non-negative even for complex data
      // (`PopulationStandardDeviation([1, 1+2i, 3])` is `4/3` — see
      // `complexVariance`).
      // Infinite data has no standard deviation at all: every infinite datum makes the
      // deviations `∞ − ∞` and the answer `NaN`, which is also the answer for
      // absent data and empty input (§3.C). That is the second arm. The
      // `handle` policies say so: the derived NaN policy for a carrier that
      // already admits `nan` is `inert`, which would leave unsaid that this
      // head ANSWERS `NaN`.
      //
      // Data large enough to overflow the machine sums of squares saturates
      // to `+oo` at `ce.precision = 'machine'`. That does not falsify
      // `real<0..>`: the engine-wide convention is that a declared type
      // describes the MATHEMATICAL value, and a machine-precision artifact
      // does not (`Exp(1000)` settles it — ruling L6(a),
      // `docs/SIGNATURE-GUIDELINES.md` §2.4).
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'PopulationStandardDeviation', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        // Complex data: the standard deviation is the square root of
        // E[|X − μ|²], which is real and non-negative (see `complexVariance`).
        if (nonRealDatum(xs)) {
          if (hasNonFiniteDatum(xs)) return engine.NaN;
          const s = engine
            .function('Sqrt', [complexVariance(engine, xs, true)])
            .evaluate();
          return numericApproximation ? s.N() : s;
        }
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals)
            return engine
              .function('Sqrt', [exactVariance(engine, vals, true)])
              .evaluate();
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigPopulationVariance(bigScalarsOf(xs)).sqrt()
            : Math.sqrt(populationVariance(scalarsOf(xs)))
        );
      },
    },

    Kurtosis: {
      description: 'Kurtosis of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection<any>|number)+) -> real | nan',
      // Complex data is REJECTED here (`nonRealUnivariateError`) and a
      // non-numeric datum with it (`collectData`); an `Error(...)` has a type
      // outside the numeric lattice, so it neither confirms nor contradicts
      // this claim. A standardized moment divides by a power of the standard
      // deviation, so an infinite datum makes both parts non-finite and the
      // answer `NaN` (`Kurtosis([1, +oo, 3])` is `NaN`, measured) — there is
      // no infinite arm. Absent data and empty input are `NaN` too (§3.C).
      // The `handle` policies say so: the derived NaN policy for a carrier
      // that already admits `nan` is `inert`, which would leave unsaid that
      // this head ANSWERS `NaN` for absent data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'Kurtosis', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        const nonReal = nonRealUnivariateError(engine, 'Kurtosis', xs);
        if (nonReal) return nonReal;
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) return exactKurtosis(engine, vals);
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigKurtosis(bigScalarsOf(xs))
            : kurtosis(scalarsOf(xs))
        );
      },
    },

    Skewness: {
      description: 'Skewness of a collection of numbers.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection<any>|number)+) -> real | nan',
      // Complex data is REJECTED here (`nonRealUnivariateError`) and a
      // non-numeric datum with it (`collectData`); an `Error(...)` has a type
      // outside the numeric lattice, so it neither confirms nor contradicts
      // this claim. A standardized moment divides by a power of the standard
      // deviation, so an infinite datum makes both parts non-finite and the
      // answer `NaN` (`Skewness([1, +oo, 3])` is `NaN`, measured) — there is
      // no infinite arm. Absent data and empty input are `NaN` too (§3.C).
      // The `handle` policies say so: the derived NaN policy for a carrier
      // that already admits `nan` is `inert`, which would leave unsaid that
      // this head ANSWERS `NaN` for absent data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'Skewness', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        const nonReal = nonRealUnivariateError(engine, 'Skewness', xs);
        if (nonReal) return nonReal;
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) return exactSkewness(engine, vals);
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigSkewness(bigScalarsOf(xs))
            : skewness(scalarsOf(xs))
        );
      },
    },

    Mode: {
      description: 'Most frequently occurring value in a collection.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection<any>|number)+) -> real | signed_infinity | nan',
      // Complex data is REJECTED here (`nonRealUnivariateError`) and a
      // non-numeric datum with it (`collectData`); an `Error(...)` has a type
      // outside the numeric lattice, so it neither confirms nor contradicts
      // this claim. The three arms are each witnessed: a real answer for
      // ordinary data, an infinite one for infinite data
      // (`Mode([+oo, +oo])` is `+oo`), and `NaN` for an absent datum or empty
      // input (§3.C). The `handle` policies below say so: the derived NaN
      // policy for a carrier that already admits `nan` is `inert`, which
      // would leave unsaid that this head ANSWERS `NaN` for absent data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'Mode', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        const nonReal = nonRealUnivariateError(engine, 'Mode', xs);
        if (nonReal) return nonReal;
        // A datum with no real value leaves the counting key undefined — see
        // `hasValuelessDatum`.
        if (hasValuelessDatum(xs)) return engine.NaN;
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) return exactMode(engine, vals);
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigMode(bigScalarsOf(xs))
            : mode(scalarsOf(xs))
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
      keywords: ['percentile'],
      complexity: 1200,
      broadcastable: false,
      // Each component carries the same claim `Median` does, for the same
      // reasons: it IS a median, of the sample or of one of its halves. Real
      // for ordinary data, infinite for infinite data
      // (`Quartiles([1, +oo, 3])` is `(1, 3, +oo)`), and `NaN` for an absent
      // datum or empty input (§3.C), which fills the whole triple.
      //
      // The component names run in the order the tuple does — lower quartile,
      // median, upper quartile. They used to read `mid, lower, upper` while
      // the handler built `(Q1, Q2, Q3)`, so every name was attached to the
      // wrong component and `Quartiles([1,2,3,4]).mid` read the LOWER
      // quartile.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      signature:
        '((collection<any>|number)+) -> tuple<lower: real | signed_infinity | nan, mid: real | signed_infinity | nan, upper: real | signed_infinity | nan>',
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      examples: ['Quartiles([1, 2, 3, 4, 5])  // Returns (1.5, 3, 4.5)'],
      // Decline-only: a definitively-unavailable datum (a valueless symbol)
      // leaves the operator inert — see the symbolic-data guard in the
      // evaluate handler. Success is not cheaply decidable (exact/absence
      // semantics), so never `true`.
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        for (const op of expr.ops)
          if (groundEnumerationOperand(op) === null) return false;
        return undefined;
      },
      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts. An absent datum or
        // empty input fills the whole triple with `NaN` (§3.C), which is why
        // this head passes its own absent answer. A provably non-numeric datum
        // is an error. And SYMBOLIC data (a valueless symbol, an unresolved
        // expression) has no numeric reading: stay inert rather than sort NaN
        // placeholders into the quantile split and bake a definite
        // `(…, NaN, …)` tuple that a later assignment contradicts. See
        // `collectData`, which is the rule the whole aggregate family shares —
        // and whose single walk feeds both the exact and the float path below.
        const xs = collectData(engine, 'Quartiles', ops, (ce) =>
          ce.tuple(ce.NaN, ce.NaN, ce.NaN)
        );
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        const nonReal = nonRealUnivariateError(engine, 'Quartiles', xs);
        if (nonReal) return nonReal;
        // A datum with no real value leaves the sort with nothing to order by
        // (`hasValuelessDatum`), so all three quartiles are unknown — the same
        // triple an absent datum produces.
        if (hasValuelessDatum(xs))
          return engine.tuple(engine.NaN, engine.NaN, engine.NaN);
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) {
            const [q1, q2, q3] = exactQuartiles(engine, vals);
            return engine.tuple(q1, q2, q3);
          }
        }
        const [lower, mid, upper] = (
          bignumPreferred(engine)
            ? bigQuartiles(bigScalarsOf(xs))
            : quartiles(scalarsOf(xs))
        ).map((v) => engine.number(v));
        return engine.tuple(lower, mid, upper);
      },
    },

    InterquartileRange: {
      description: 'Interquartile range (Q3 - Q1) of a collection.',
      complexity: 1200,
      broadcastable: false,
      signature: '((collection<any>|number)+) -> real<0..> | +oo | nan',
      // Complex data is REJECTED here (`nonRealUnivariateError`) and a
      // non-numeric datum with it (`collectData`); an `Error(...)` has a type
      // outside the numeric lattice, so it neither confirms nor contradicts
      // this claim. Q3 − Q1 over a sorted sample is never negative, and the
      // only infinity it can reach is `+oo`, from a sample whose quartiles
      // straddle an infinite datum (`InterquartileRange([1, +oo, 3])` is
      // `+oo`, and so is `InterquartileRange([1, -oo, 3])`). Two infinities
      // of the SAME sign cancel to `NaN` instead
      // (`InterquartileRange([+oo, +oo])`), which is also the answer for an
      // absent datum or empty input (§3.C). The `handle` policies say so: the
      // derived NaN policy for a carrier that already admits `nan` is
      // `inert`, which would leave unsaid that this head ANSWERS `NaN` for
      // absent data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',

      evaluate: (ops, { engine, numericApproximation }) => {
        // ONE walk of the data decides all three verdicts — an absent datum
        // or empty input (`NaN`), a provably non-numeric datum (an error), or
        // symbolic data (stay inert rather than fold a valueless symbol to
        // `NaN`) — and feeds both paths below. See `collectData`.
        const xs = collectData(engine, 'InterquartileRange', ops);
        if (xs === null) return undefined;
        if (!Array.isArray(xs)) return xs;
        const nonReal = nonRealUnivariateError(
          engine,
          'InterquartileRange',
          xs
        );
        if (nonReal) return nonReal;
        // A datum with no real value leaves the sort with nothing to order by
        // — see `hasValuelessDatum`.
        if (hasValuelessDatum(xs)) return engine.NaN;
        if (!numericApproximation) {
          const vals = exactData(xs);
          if (vals) {
            const [q1, , q3] = exactQuartiles(engine, vals);
            return subtract(engine, q3, q1);
          }
        }
        return engine.number(
          bignumPreferred(engine)
            ? bigInterquartileRange(bigScalarsOf(xs))
            : interquartileRange(scalarsOf(xs))
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
        '(collection<any>, number | list<number>) -> list<tuple<number, integer>>',
      examples: [
        'Histogram([1, 2, 2, 3], 3)  // Returns [(1,1), (1.6667,2), (2.3333,1)]',
      ],
      // Decline-only: `computeBinning` opens with `if (!xs.isFiniteCollection)
      // return undefined`, so an unwalkable or infinite source is a provable
      // decline. Success also needs a non-empty finite numeric sample and a
      // usable bin spec, neither cheaply decidable — never `true`.
      canEnumerate: canEnumerateFiniteSource,
      evaluate: ([xs, binsArg], { engine: ce }) => {
        const binning = computeBinning(xs, binsArg);
        if (!binning) return undefined;
        if (binning.rejected)
          return dataConstraintError(
            ce,
            'Histogram',
            binning.rejected.value,
            binning.rejected.constraint
          );
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
      signature: '(collection<any>, number | list<number>) -> list<number>',
      examples: ['BinCounts([1, 2, 2, 3], 3)  // Returns [1, 2, 1]'],
      // Decline-only, same `computeBinning` precondition as `Histogram`.
      canEnumerate: canEnumerateFiniteSource,
      evaluate: ([xs, binsArg], { engine: ce }) => {
        const binning = computeBinning(xs, binsArg);
        if (!binning) return undefined;
        if (binning.rejected)
          return dataConstraintError(
            ce,
            'BinCounts',
            binning.rejected.value,
            binning.rejected.constraint
          );

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
      // The LEADING arm is the string rule: each window is a contiguous run of
      // the source's own characters, so it is itself a string and
      // `SlidingWindow("abcd", 2)` is `["ab","bc","cd"]` (ruling D9(b),
      // 2026-08-16; see `innerRun` in `library/collections.ts`). Spelled as a
      // BOUNDED type variable (`S where S: string`), never the ground type
      // `string`: an `unknown`- or `any`-typed operand refutes no arm, so a
      // ground `string` parameter would win most-specific-wins on every
      // untyped operand.
      signature:
        '((S, integer, integer?) -> list<string> where S: string) & ((collection, integer, integer?) -> list<list>)',
      examples: [
        'SlidingWindow([1, 2, 3, 4], 2)  // Returns [[1,2], [2,3], [3,4]]',
        'SlidingWindow("abcd", 2)  // Returns ["ab", "bc", "cd"]',
      ],
      evaluate: ([xs, winArg, stepArg], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;
        // Small finite sources materialize eagerly (all existing semantics);
        // larger — or unknown-length — sources stay symbolic and are served
        // lazily by the `collection` handlers below (Tycho item 52).
        const size = xs.count;
        if (size === undefined || size > MAX_SIZE_EAGER_COLLECTION)
          return undefined;
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

        // Each window is emitted through `innerRun`, which makes it a STRING
        // when the source is a string. Joining a window's grapheme clusters
        // re-runs segmentation, and two adjacent clusters can merge — but only
        // when the source itself contained a lone combining mark, the only way
        // a cluster can begin with a character that attaches to what precedes
        // it (`docs/STRING_ROADMAP.md`, design constraint 3).
        for (let i = 0; i <= data.length - windowSize; i += stepSize) {
          result.push(innerRun(ce, xs, data.slice(i, i + windowSize)));
        }

        return ce.function('List', result);
      },
      // Lazy view: complete windows only (`keepPartial = false`), default
      // step 1. Invalid params (`size <= 0`, `step <= 0`, non-integer) make
      // `getParams` return `undefined`, leaving every facet inert.
      collection: stringAwareWindowedCollectionOps((expr) => {
        if (!isFunction(expr)) return undefined;
        const winSize = toInteger(expr.op2);
        if (winSize === null || winSize <= 0) return undefined;
        const step = expr.nops >= 3 ? toInteger(expr.op3) : 1;
        if (step === null || step <= 0) return undefined;
        return { src: expr.op1, size: winSize, step, keepPartial: false };
      }),
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
      signature: '(collection<any>, collection<any>?) -> real | nan',
      // A data-consuming aggregate (§3.C). The `nan` arm is the codomain
      // vocabulary the `handle` policies need: a `NaN` or an infinite datum,
      // an absent (`Missing`) datum, and empty input all make the answer
      // `NaN`, and the derived policies would say otherwise — the derived NaN
      // policy for a `collection` slot is `reject` and the derived missing
      // policy `pass-through`, neither of which describes a head that ANSWERS
      // `NaN` for such data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      typeHandlerKind: 'types',
      type: (ops) => pairedStatisticType(ops),
      evaluate: (ops, { engine: ce, numericApproximation }) =>
        evaluateCovariance(ce, ops, !!numericApproximation, false),
    },

    PopulationCovariance: {
      description:
        'Population covariance (n denominator) of paired data, given as two ' +
        'equal-length collections or one collection of (x, y) pairs.',
      complexity: 1200,
      broadcastable: false,
      signature: '(collection<any>, collection<any>?) -> real | nan',
      // A data-consuming aggregate (§3.C). The `nan` arm is the codomain
      // vocabulary the `handle` policies need: a `NaN` or an infinite datum,
      // an absent (`Missing`) datum, and empty input all make the answer
      // `NaN`, and the derived policies would say otherwise — the derived NaN
      // policy for a `collection` slot is `reject` and the derived missing
      // policy `pass-through`, neither of which describes a head that ANSWERS
      // `NaN` for such data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      typeHandlerKind: 'types',
      type: (ops) => pairedStatisticType(ops),
      evaluate: (ops, { engine: ce, numericApproximation }) =>
        evaluateCovariance(ce, ops, !!numericApproximation, true),
    },

    Correlation: {
      description:
        "Pearson's correlation coefficient of paired data, given as two " +
        'equal-length collections or one collection of (x, y) pairs.',
      complexity: 1200,
      broadcastable: false,
      signature: '(collection<any>, collection<any>?) -> real | nan',
      // Pearson's r lies in [−1, 1] mathematically, and the range is
      // deliberately NOT declared: at `ce.precision = 'machine'` the kernel's
      // cancellation exceeds it on ORDINARY data — a random two-point sample,
      // whose r is exactly ±1, measured 1.0000000000063 — so a declared
      // `real<-1..1>` would be a bound the head's own values break.
      // A data-consuming aggregate (§3.C). The `nan` arm is the codomain
      // vocabulary the `handle` policies need: a `NaN` or an infinite datum,
      // an absent (`Missing`) datum, and empty input all make the answer
      // `NaN`, and the derived policies would say otherwise — the derived NaN
      // policy for a `collection` slot is `reject` and the derived missing
      // policy `pass-through`, neither of which describes a head that ANSWERS
      // `NaN` for such data.
      //
      // The operand carrier stays `collection<any>` — the absence-admitting
      // top — because §3.C requires `[1, Missing, 3]` to reach this handler;
      // the bare spelling `collection` is the values-only
      // `collection<unknown>` and would not match it.
      nanBehavior: 'handle',
      missingBehavior: 'handle',
      typeHandlerKind: 'types',
      type: (ops) => pairedStatisticType(ops),
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

    FindFit: {
      description:
        'Nonlinear least-squares fit of a model to data. ' +
        'FindFit(data, model, params, vars): fit `model` (an expression in ' +
        '`vars` and the parameters) to `data`, a list of (x…, y) tuples or a ' +
        'plain list of y values. Each parameter spec is a bare symbol, ' +
        '(a, a0), or (a, a0, lo, hi) with box constraints. Returns a record ' +
        '{parameters, converged, residualNorm, iterations}. The joint form ' +
        'takes a list of models and matching datasets sharing parameters.',
      complexity: 1200,
      broadcastable: false,
      // Hold the arguments: a parameter symbol may carry a seeded document
      // value that must NOT be substituted before the fit (model/params/vars
      // stay held; the data operand is evaluated inside the handler).
      lazy: true,
      signature: '(any, any, any, any) -> dictionary',
      evaluate: (ops, { engine: ce }) => findFit(ce, ops),
    },
  },
  {
    // `k` elements drawn WITHOUT replacement — the twin of `RandomChoice`
    // (with replacement). See
    // `docs/RANDOMNESS-MODEL.md` §5.
    RandomSample: {
      description:
        'RandomSample(xs, k): a list of k elements drawn from the indexed ' +
        'collection `xs`, without replacement. "Without replacement" is over ' +
        'POSITIONS, not values: on a multiset, repeats are expected — ' +
        'RandomSample([1, 1, 2], 2) can return [1, 1]. Sampling a string ' +
        'yields a string. Wrap the call in ' +
        '`WithRandomSeed(seed, ...)` to make it deterministic.',
      complexity: 8200,
      // Carries `random` for the same reason as `RandomShuffle`: it draws from
      // the engine stream, hence impure. Without it, `isConstant` is true for
      // a sample of a literal list.
      // `k` is typed `number`, not `integer`: a caller who computes a count
      // should not have to round it first (it is rounded on evaluation).
      // The domain gate is `indexed_collection` — an `Interval` and a `Set`
      // are invalid, while a lazy indexed view (`Filter` over a `Range`)
      // passes.
      // The LEADING arm is the string-preservation rule: a sample drawn from a
      // string's own characters is a string (`docs/STRING_ROADMAP.md`, "String
      // preservation rule"; promoted in Phase 2 as an ELEMENT-PRESERVING
      // list-out operator). `RandomSample` is eager and has no lazy collection
      // handlers, so the join happens in the `evaluate` handler below.
      // Re-segmentation caveat: rejoining the sampled characters can merge or
      // split grapheme clusters, so the result may hold a different number of
      // characters than `k` — a sampled combining mark attaches to whichever
      // character now precedes it.
      // Spelled as a BOUNDED type variable (`T where T: string`), never the
      // ground type `string`: an `unknown`- or `any`-typed operand refutes no
      // arm, so a ground `string` parameter would win most-specific-wins on
      // every untyped operand and claim `string` for a call that usually
      // returns a list. A bounded variable with no call-site binding does not.
      signature:
        '((T, number) random -> T where T: string) & ((indexed_collection, number) random -> list)',
      // IMPURE producer: decline-only from the source facet — zero draws,
      // never `true` (see `RandomShuffle`/`RandomChoice`).
      canEnumerate: (expr) => {
        if (!isFunction(expr)) return undefined;
        return expr.op1.isEnumerableCollection === false ? false : undefined;
      },
      evaluate: ([xs, kOp], { engine: ce }) => {
        if (!xs.isIndexedCollection) return undefined;
        const n = xs.count;
        if (n === undefined) return undefined;
        if (!Number.isFinite(n))
          return ce.error([
            'out-of-range',
            'a finite collection',
            xs.toString(),
          ]);

        const k = randomCount(ce, kOp);
        if (k === null) return undefined;
        if (typeof k !== 'number') return k;
        // Unlike `RandomChoice`, `k` may not exceed the domain size: there
        // are only `n` positions to draw without replacement.
        if (k > n)
          return ce.error(['out-of-range', `a count in 0..${n}`, k.toString()]);
        // The string arm, here and at the return below: a sample of a string's
        // characters is a string (`docs/STRING_ROADMAP.md`, "String
        // preservation rule"). `RandomSample` is eager and has no lazy
        // collection handlers, so the join happens here rather than in
        // `evaluateStringPreservingCollection`. Re-segmentation caveat:
        // rejoining the sampled characters can merge or split grapheme
        // clusters, so the result may hold a different number of characters
        // than `k`.
        if (k === 0)
          return isString(xs) ? ce.string('') : ce.function('List', []);

        // SPARSE Fisher-Yates over the INDEX space: `k` partial steps,
        // holding only the touched positions (an absent key is the identity
        // position). O(k) time and memory — the previous implementation
        // materialized the whole collection and ran a full Fisher-Yates, so
        // `Sample(Range(1, 1000000), 3)` allocated a million boxed numbers.
        // Exactly `k` draws, one per step — and zero if a step bails after
        // drawing (a lazy view that shrank between the count and the `at()`);
        // `withDrawRollback` restores the frame counter so a symbolic result
        // still consumes nothing (`docs/RANDOMNESS-MODEL.md` §5).
        return withDrawRollback(ce, () => {
          const swapped = new Map<number, number>();
          const at = (i: number): number => swapped.get(i) ?? i;
          const out: Expression[] = [];
          for (let i = 0; i < k; i++) {
            if ((i & 0x3ff) === 0) checkDeadline(ce._deadlineFrame);
            const j = i + Math.floor(ce._random() * (n - i));
            const vi = at(i);
            const vj = at(j);
            swapped.set(i, vj);
            swapped.set(j, vi);
            const element = xs.at(vj + 1);
            if (element === undefined) return undefined;
            out.push(element);
          }
          if (isString(xs)) return joinCharacters(ce, out);
          return ce.function('List', out);
        });
      },
    },
  },
];

/**
 * The data an aggregate consumes, flattened ONCE: each operand contributes
 * either its elements (a finite collection) or itself (a scalar).
 *
 * This single walk decides all three of the verdicts a data-consuming
 * aggregate can reach, so its return value is either the flattened data or the
 * answer the head must give instead:
 *
 * - An `Expression[]`: the numeric data, ready for the exact and float paths.
 * - An `Expression`: the answer. Either the `Error(incompatible-type)` a
 *   provably non-numeric datum earns, or the ABSENT answer — `NaN` by default,
 *   or whatever `absentAnswer` builds for a head whose codomain is not a
 *   number (`Quartiles` answers the triple `(NaN, NaN, NaN)`).
 * - `null`: no verdict, so the aggregate must stay INERT.
 *
 * A datum is refused when its type proves it is NOT a number — a string, a
 * character, a boolean, a nested collection. Such a datum used to fall in with
 * the symbolic ones below and leave every head inert, so `Mean([1, "a", 3])`
 * and `Mean("a")` reported themselves back with no diagnosis. A string OPERAND
 * is refused whole rather than one character at a time: a string is an indexed
 * collection of its characters, so the walk would otherwise blame `"a"` for
 * input the caller spelled `"abc"`.
 *
 * The ABSENT verdict is §3.C of `docs/ERROR-MODEL.md`: an aggregate over data
 * that contains a `Missing` symbol or a `NaN`, and an aggregate over EMPTY
 * input, is itself absent, normalized to `NaN` in a numeric result cell (I6
 * absorption — there is no `| missing` arm). A non-finite collection operand,
 * and one that DECLINES to enumerate, make the empty-input half undecidable:
 * the head stays inert instead of claiming its input was empty.
 *
 * An aggregate stays INERT when some datum has no numeric reading yet. Two
 * shapes qualify:
 *
 * - A valueless symbol — declared scalar (`y`), or declared `list<number>` and
 *   not yet assigned — flattens to itself, and every numeric kernel reads it as
 *   `NaN` via `.re`. Folding that produces a definite `NaN` that the same
 *   expression contradicts once the symbol is assigned (`Mean(L)` answered
 *   `NaN`, and `2` once `L := [1,2,3]`).
 * - A collection that reports a definite size yet produces NO elements
 *   DECLINED to enumerate: `Linspace(a, 1, 3)` has three elements, but with a
 *   symbolic endpoint none of them has a numeric reading. The kernels fold that
 *   empty flatten to a definite `NaN` too (`Mean(Linspace(a, 1, 3))` answered
 *   `NaN`). A genuinely EMPTY collection is not "declined": it is empty input,
 *   and empty input is absent.
 *
 * The three verdicts are ranked ERROR > ABSENT > INERT, and the ranking is why
 * the walk runs to the end instead of answering the first thing it finds. The
 * Error channel beats a quiet marker (`docs/ERROR-MODEL.md`): a datum whose
 * type is statically wrong must be diagnosed even when an absent datum sits
 * beside it, so `Mean([Missing, "a"])` is the `incompatible-type` error, not
 * `NaN`. Absence in turn beats inertness, so a `Missing` alongside a valueless
 * symbol still answers `NaN`.
 *
 * Collecting the data ONCE is load-bearing, not a tidiness measure. The
 * absence gate, the validation walk, the exact-path walk and the float-path
 * walk used to be separate enumerations of the same operand, so
 * `Mean(Map(f, xs))` ran `f` two or three times per element. With mutation in
 * the language the number of callback runs is observable — ruling B8 ("pinned
 * everywhere operands evaluate", `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B)
 * requires lazy materialization not to duplicate evaluations. Counts are
 * pinned in `test/compute-engine/lazy-callback-count.test.ts`.
 */
function collectData(
  ce: ComputeEngine,
  name: string,
  ops: ReadonlyArray<Expression>,
  absentAnswer?: (ce: ComputeEngine) => Expression
): Expression[] | Expression | null {
  const data: Expression[] = [];
  // An absent datum was seen: the head answers absent unless a refused datum
  // outranks it later in the walk.
  let absent = false;
  // Some datum has no numeric reading: the head stays inert unless something
  // that outranks inertness is found.
  let inert = false;
  // At least one operand contributed a datum, so the input is not empty.
  let sawData = false;
  // An operand may hold data this walk cannot see, so an input that looks
  // empty must not be judged empty.
  let undecidable = false;
  for (const op of ops) {
    if (isString(op)) return dataConstraintError(ce, name, op, 'number');
    if (op.isCollection && op.isFiniteCollection !== true) {
      // A non-finite collection (a symbolic-length range) cannot be
      // flattened. It supplies no data, and it is not evidence of emptiness.
      inert = true;
      undecidable = true;
      continue;
    }
    if (op.isFiniteCollection) {
      let walked = 0;
      for (const v of op.each()) {
        walked += 1;
        sawData = true;
        if (isAbsentValue(v)) absent = true;
        else if (!isNumber(v)) {
          if (isNonNumericDatum(v))
            return dataConstraintError(ce, name, v, 'number');
          inert = true;
        } else data.push(v);
      }
      if (enumerationDeclinedAfterWalk(op, walked)) {
        inert = true;
        undecidable = true;
      }
    } else {
      sawData = true;
      if (isAbsentValue(op)) absent = true;
      else if (!isNumber(op)) {
        // A COLLECTION-typed operand is a container, not a datum, even when
        // it has no value yet to enumerate: `Mean(L)` for a declared but
        // unassigned `L: list<number>` stays inert so a later assignment can
        // answer it. Only an operand that can be neither a number nor a
        // collection is refused.
        if (isNonNumericDatum(op) && !typeCouldBeCollection(op.type.type))
          return dataConstraintError(ce, name, op, 'number');
        inert = true;
      } else data.push(op);
    }
  }
  // Empty input is absent — but only when every operand was decidably finite
  // and enumerable, since an undecidable one may yet hold the data.
  if (!sawData && !undecidable) absent = true;
  if (absent) return absentAnswer?.(ce) ?? ce.NaN;
  if (inert) return null;
  return data;
}

/**
 * True when a datum's own type proves it can never be a number, so no
 * statistic has a reading for it: a string, a character, a boolean, a nested
 * collection.
 *
 * The test is DISJOINTNESS, not "is a number literal": a datum that merely
 * has no literal reading yet — a valueless symbol, or a numeric expression
 * such as `Sqrt(-2)` that stays symbolic under `evaluate()` — overlaps
 * `number` and must leave the aggregate inert instead, so that a later
 * assignment or a `.N()` can still answer.
 *
 * An ABSENT datum is never reached here: `Missing` is the Kleene absence
 * marker, which `collectData` absorbs into `NaN` for this whole family (§3.C
 * of `docs/ERROR-MODEL.md`), not a wrong KIND of value to refuse. The guard
 * below keeps that true for any other caller. An `error`
 * datum is exempt for the same reason in the other direction — it already
 * speaks the Error channel and the engine propagates it on its own.
 */
function isNonNumericDatum(v: Expression): boolean {
  if (isAbsentValue(v)) return false;
  if (v.type.matches('error')) return false;
  return v.type.isDisjointFrom('number');
}

// The float and bignum kernels read each datum's REAL PART, so these two
// projections are sound only for real data. Every head that feeds them first
// disposes of complex data: `Mean` and the variance family compute the complex
// answer themselves (`boxedMean`, `complexVariance`), and the order-based and
// higher-moment heads reject it (`nonRealUnivariateError`).
//
// What is left is the complex infinity `~oo`, which is not complex DATA — it
// is the single point at infinity — and still flows through here. It goes
// through `realProjection` (`statistics-data.ts`) like every other real-valued
// path, which reads it as `NaN` rather than as the real part its spelling
// happens to report. A real `±∞` is unaffected and keeps the behavior it has
// always had.
function* scalarsOf(data: ReadonlyArray<Expression>) {
  for (const op of data) yield realProjection(op);
}

function* bigScalarsOf(data: ReadonlyArray<Expression>) {
  for (const op of data) yield bigProjection(op);
}

//
// Exact statistics: under `evaluate()` (not `.N()`), when every datum is an
// exact, finite real number, accumulate with exact rational/radical arithmetic
// so `Mean([1,2,3,4]) → 5/2` instead of the machine float `2.5`. Each exact
// formula mirrors its float/bignum counterpart in `numerics/statistics.ts`, so
// `evaluate().N()` agrees with `.N()`. Under `.N()` the existing float path is
// used unchanged.
//
// The same boxed arithmetic carries the two statistics that are defined for
// COMPLEX data — the mean and the variance family — on both paths, exact and
// numeric: complex values in this engine are machine-precision, so there is no
// bignum kernel to prefer, and `boxedMean`/`complexVariance` numericize their
// result under `.N()` instead.
//

/**
 * If every already-collected datum is an exact, finite real number, return them
 * as boxed expressions; otherwise `null` (caller falls back to the float path).
 */
function exactData(data: ReadonlyArray<Expression>): Expression[] | null {
  if (data.length === 0) return null;
  for (const v of data)
    if (!isNumber(v) || v.isExact !== true || v.im !== 0 || v.isFinite !== true)
      return null;
  return [...data];
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

/**
 * The arithmetic mean Σx / n, accumulated with boxed arithmetic so exact
 * operands yield an exact result (`Mean([1,2,3,4])` is `5/2`, not `2.5`).
 *
 * This is also the mean of COMPLEX data, with no separate formula: `Add` and
 * `Divide` are linear over the complex numbers, so the same accumulation gives
 * `Mean([1, i]) = (1 + i)/2` exactly. `.add()`/`.mul()` are deliberately not
 * used here — the methods fold exact literals to machine floats.
 */
function boxedMean(ce: ComputeEngine, vals: Expression[]): Expression {
  return divide(ce, add(ce, vals), ce.number(vals.length));
}

/**
 * True when some datum is not a finite number — `±∞`, `~oo`, or `NaN`.
 *
 * The complex branches of `Mean` and the variance family use this to answer
 * `NaN` before doing any arithmetic. They are only reached when some datum is
 * genuinely complex, and a complex sample point together with a point at
 * infinity has no reading: `+∞` is a limit along the real axis, and no
 * direction in the plane makes it a value a complex number can be averaged
 * with or subtracted from. Boxed arithmetic nevertheless folded
 * `Mean([1 + 2i, +∞])` and `Variance([1 + 2i, +∞])` to `+∞` — a definite real
 * answer for data that has none, and, for the variance, a contradiction of the
 * real-only path, which answers `NaN` for `Variance([1, +∞])`.
 *
 * The real-only paths do NOT go through this: `Mean([1, +∞])` is `+∞` there,
 * which is the limit of the sample mean and a reading the data supports.
 */
function hasNonFiniteDatum(vals: ReadonlyArray<Expression>): boolean {
  return vals.some((v) => v.isFinite !== true);
}

/**
 * The variance of complex data: `E[|X − μ|²]`, with the sample (`n − 1`) or
 * population (`n`) divisor — the same divisors the real formulas use.
 *
 * The squared MAGNITUDE of each deviation is what makes this real and
 * non-negative; `(x − μ)²` would be complex and is not the variance.
 * `Conjugate` is deliberately avoided: it returns a machine-float complex for
 * an exact operand with rational parts, which would lose that exactness.
 */
function complexVariance(
  ce: ComputeEngine,
  vals: Expression[],
  population: boolean
): Expression {
  const n = vals.length;
  const mean = boxedMean(ce, vals);
  const terms = vals.map((v) => squaredMagnitude(ce, subtract(ce, v, mean)));
  return divide(ce, add(ce, terms), ce.number(population ? n : n - 1));
}

/**
 * `|d|²` for a deviation from the mean, in whichever channel loses the least.
 *
 * A REAL deviation squares directly, which keeps the numeric channel it
 * carries — a bignum stays a bignum, an exact rational stays exact.
 *
 * A complex deviation would otherwise go through `Abs`. That is right when the
 * deviation is EXACT, because `Abs` is exact on an exact complex operand
 * (`Abs(1/3 + 2/5i)` is `√61/15`) and squaring recovers the exact squared
 * magnitude. On an INEXACT operand the square root is rounded before it is
 * squared again, and the round trip costs an ulp: `Variance([1.5, 1 + 2i])`
 * read `2.1250…02` instead of `2.125`. There the two parts are combined
 * directly instead. Complex values in this engine are machine-precision, so
 * `.re`/`.im` give up nothing on that branch.
 */
function squaredMagnitude(ce: ComputeEngine, d: Expression): Expression {
  if (d.im === 0) return multiply(ce, [d, d]);
  if (isNumber(d) && d.isExact)
    return powi(ce, ce.function('Abs', [d]).evaluate(), 2);
  return ce.number(d.re * d.re + d.im * d.im);
}

/**
 * The rejection an order-based or higher-moment univariate statistic answers
 * for complex data, or `null` when the data is real-valued throughout.
 *
 * Every one of those heads reads a datum through its real part — the sorts
 * behind the median and the quartiles, the counting key of the mode, the
 * powers of the standardized moments — so complex data would answer the
 * question for the projected sample with no hint that it had been projected.
 * Unlike the mean and the variance family, there is no answer to give
 * instead: an order statistic needs a total order, and the complex plane has
 * no canonical one, while skewness and kurtosis have only convention-laden,
 * branch-dependent complex extensions. That is the same reason a complex
 * covariance is not implemented.
 */
function nonRealUnivariateError(
  ce: ComputeEngine,
  name: string,
  data: ReadonlyArray<Expression>
): Expression | null {
  const nonReal = nonRealDatum(data);
  return nonReal ? nonRealDataError(ce, name, nonReal) : null;
}

/**
 * True when some datum is the complex infinity `~oo` and therefore has no real
 * value at all (see `realProjection`, `library/statistics-data.ts`).
 *
 * The heads that SUM their data need no such test: `realProjection` hands them
 * a `NaN` and the arithmetic carries it to the answer. The ORDER-based heads
 * do, because a `NaN` does not propagate through a comparison: a sort
 * comparator that returns `NaN` leaves the sample in its original order, and
 * `Median`, `Mode`, `Quartiles` and `InterquartileRange` then read whatever
 * element the ranks happen to land on — `Mode([1, ~oo, 5])` reported `1`, and
 * `InterquartileRange([1, ~oo, 5])` reported `4`, neither of which is a
 * statistic of the sample that was supplied. `NaN` is, and it is the same
 * answer `Covariance`/`Correlation` give for such a datum.
 *
 * A real `±∞` has a real value and is NOT caught here: `Median([1, +∞, 5])`
 * remains `5`.
 */
function hasValuelessDatum(data: ReadonlyArray<Expression>): boolean {
  return data.some(hasNonFiniteImaginaryPart);
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
// and upper half when the sample size is odd, so Q1/Q3 are symmetric — the
// one-point sample included, where a single datum is all three quartiles.
function exactQuartiles(
  ce: ComputeEngine,
  vals: Expression[]
): [Expression, Expression, Expression] {
  const sorted = sortExact(vals);
  const n = sorted.length;
  if (n === 1) return [sorted[0], sorted[0], sorted[0]];
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
  const mean = boxedMean(ce, vals);
  const m2 = exactCentralMoment(ce, vals, mean, 2);
  const m4 = exactCentralMoment(ce, vals, mean, 4);
  // β₂ = m4 / m2²
  return divide(ce, m4, powi(ce, m2, 2));
}

function exactSkewness(ce: ComputeEngine, vals: Expression[]): Expression {
  const mean = boxedMean(ce, vals);
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
 *
 * Every extracted datum must be a NUMBER, the same precondition `collectData`
 * enforces for the one-sample statistics. Without it the non-numeric elements
 * reached `machineVals`, which reads `numberLiteralOf(v)?.re ?? NaN`, and the
 * regression handlers returned `NaN` coefficients — a definite wrong answer
 * where staying inert is the honest one. A string source makes this concrete:
 * a string is an indexed collection of its characters, so
 * `Covariance("abc", "abc")` walked three characters per side and answered
 * `NaN`.
 *
 * `walked` collects every element this walk materializes, INCLUDING the ones
 * that made it fail. The error path needs to know whether some datum was
 * complex or not a number at all before it blames the shape, and
 * re-enumerating the operands to find out would run a lazy element callback a
 * second time (ruling B8, pinned in
 * `test/compute-engine/lazy-callback-count.test.ts`). Handing the already
 * materialized elements to `shapeError` keeps the enumeration single.
 *
 * `admitAbsent` accepts an ABSENT datum — the `Missing` symbol — as data
 * alongside the numbers. `Covariance`, `PopulationCovariance` and
 * `Correlation` pass it because §3.C makes an absent datum their answer's
 * `NaN`, the same as an explicit `NaN` datum; admitting it here is what puts
 * that verdict AFTER the shape checks, so a length mismatch still wins the
 * Error channel (`Covariance([1,2,3,4], [1, Missing, 3])` is the
 * `incompatible-dimensions` error, not `NaN`). The least-squares fits do NOT
 * pass it: a fit has no absent-datum convention, and mis-shaped data is what
 * its `Error` reports.
 */
function extractPairs(
  ops: ReadonlyArray<Expression>,
  walked?: Expression[],
  admitAbsent = false
): { xs: Expression[]; ys: Expression[] } | null {
  const isDatum = (v: Expression): boolean =>
    isNumber(v) || (admitAbsent && isAbsentValue(v));
  if (ops.length === 1) {
    const arg = ops[0];
    if (!arg.isFiniteCollection) return null;
    const xs: Expression[] = [];
    const ys: Expression[] = [];
    for (const el of arg.each()) {
      if (!el.isFiniteCollection) {
        walked?.push(el);
        return null;
      }
      const pair = [...el.each()];
      walked?.push(...pair);
      if (pair.length !== 2) return null;
      if (!isDatum(pair[0]) || !isDatum(pair[1])) return null;
      xs.push(pair[0]);
      ys.push(pair[1]);
    }
    return { xs, ys };
  }
  if (ops.length === 2) {
    const [a, b] = ops;
    if (!a.isFiniteCollection || !b.isFiniteCollection) return null;
    const xs = [...a.each()];
    const ys = [...b.each()];
    walked?.push(...xs, ...ys);
    if (!xs.every(isDatum) || !ys.every(isDatum)) return null;
    return { xs, ys };
  }
  return null;
}

// Both kernels read a datum through `realProjection` (`statistics-data.ts`),
// which answers `NaN` for a datum with no real value — the complex infinity
// `~oo` under either spelling — and passes a real `±∞` through.
const machineVals = (vals: ReadonlyArray<Expression>): number[] =>
  vals.map(realProjection);
const bigVals = (vals: ReadonlyArray<Expression>) =>
  vals.map((v) => bigProjection(v));

/**
 * `realProjection` in the bignum channel: the datum's real part as a
 * `BigDecimal`, keeping the full precision when the literal carries a bignum,
 * and `NaN` for a datum with no real value — so a `NaN` projection poisons the
 * bignum kernels exactly as it poisons the machine ones.
 */
function bigProjection(v: Expression) {
  const n = numberLiteralOf(v);
  if (!n || !Number.isFinite(n.im)) return v.engine.bignum(NaN);
  return n.bignumRe ?? v.engine.bignum(n.re);
}

/**
 * The error a bivariate statistic answers when it cannot read its DATA
 * operands as two equal-length columns of numbers.
 *
 * A non-real datum reaches this path too — `extractPairs` only accepts number
 * literals, and `Sqrt(-2)` is a function expression — so the data is scanned
 * for one before the shape is blamed. Otherwise
 * `Covariance([1, Sqrt(-2)], [2, 3])` would be told its collections are
 * mis-shaped, which is not true of the input. A datum that is provably not a
 * number at all — a string, a character, a boolean, a nested collection — is
 * scanned for in the same pass and named the same way
 * (`Covariance([1,2,3], [1, "a", 3])` used to be blamed on the shape), as is a
 * data operand that is itself a STRING: a string is an indexed collection of
 * its characters, so `Covariance("abc", "abc")` walked three characters per
 * side and would otherwise blame the first character for input the caller
 * spelled `"abc"`.
 *
 * `dataOps` are the operands that carry data, and ONLY those: a
 * `PolynomialFit` degree or a trailing variable symbol is not a datum, and
 * scanning it would report a complex degree as bad data instead of letting the
 * caller answer its own diagnostic. `walked` are the elements `extractPairs`
 * already materialized out of those operands; the scan consults them instead
 * of enumerating the collections a second time, and numericizes only the
 * scalar operands (which no lazy callback stands behind). The whole scan runs
 * on the error path only, never on the accepted one.
 */
function shapeError(
  ce: ComputeEngine,
  name: string,
  dataOps: ReadonlyArray<Expression>,
  walked: ReadonlyArray<Expression>,
  message = `${name} expects two equal-length collections or one collection of (x, y) pairs`
): Expression {
  for (const op of dataOps)
    if (isString(op)) return dataConstraintError(ce, name, op, 'number');
  // Only the ELEMENTS are scanned. An OPERAND of a bivariate statistic is a
  // container, not a datum: its own type (`list<integer>`, or the
  // `collection<any>` a bare symbol is inferred to hold) is disjoint from
  // `number`, so scanning it would refuse every well-formed input and turn
  // `Covariance(xs, ys)` over undeclared symbols into a type error.
  const nonNumeric = walked.find(isNonNumericDatum);
  if (nonNumeric) return dataConstraintError(ce, name, nonNumeric, 'number');
  const nonReal = nonRealOperand(dataOps, walked);
  if (nonReal) return nonRealDataError(ce, name, nonReal);
  return ce.error('unexpected-argument', message);
}

/**
 * The first datum that numericizes to a complex number — or `null` when none
 * does.
 *
 * `walked` are the elements a previous `extractPairs` walk materialized;
 * `dataOps` supplies the operands that are not collections and so contributed
 * no elements to that walk (a scalar datum). Collections are NOT enumerated
 * here: their elements are already in `walked`.
 *
 * Unlike `nonRealDatum` this accepts values that are not number literals, by
 * numericizing them, so it catches `Sqrt(-2)`. That costs an evaluation per
 * element, so it belongs on error paths only.
 */
function nonRealOperand(
  dataOps: ReadonlyArray<Expression>,
  walked: ReadonlyArray<Expression>
): Expression | null {
  for (const item of walked) if (isComplexDatum(item.N())) return item;
  for (const op of dataOps)
    if (op.isFiniteCollection !== true && isComplexDatum(op.N())) return op;
  return null;
}

/**
 * True if some datum makes the statistic `NaN`: the datum is `NaN` itself, it
 * is ABSENT (the `Missing` symbol), or it is the complex infinity `~oo`, whose
 * imaginary part is infinite and whose real part carries no information (see
 * `realProjection` in `library/statistics-data.ts`).
 *
 * The absent case is §3.C — an aggregate over data with an absent datum is
 * itself absent, normalized to `NaN` in a numeric cell (I6 absorption). It is
 * reached only because `extractPairs` was asked to admit such a datum; before
 * that, `Covariance([1,2,3], [1, Missing, 3])` was refused as MIS-SHAPED data
 * while the identical input spelled with a `NaN` answered `NaN`.
 */
function hasNaNDatum(
  ...data: ReadonlyArray<ReadonlyArray<Expression>>
): boolean {
  for (const vals of data)
    for (const v of vals) {
      if (isAbsentValue(v)) return true;
      if (isNumber(v) && (v.isNaN === true || !Number.isFinite(v.im)))
        return true;
    }
  return false;
}

/**
 * True if every datum projects to the same finite real number — the only
 * dataset for which Pearson's r is undefined because a standard deviation is
 * genuinely zero.
 *
 * The comparison runs in the SAME numeric channel the correlation kernel just
 * summed, because that is the channel whose `NaN` is being diagnosed. Reading
 * the machine projection unconditionally got the default (bignum) route wrong:
 * a constant column of values outside the double range projects to `±∞` in a
 * machine float, `Number.isFinite` rejected it, and
 * `Correlation([10^400, 10^400, 10^400], [1, 2, 3])` lost its zero-variance
 * error and answered `NaN` instead.
 *
 * The projections, not the boxed values, are what is compared: `[2, 2.0]` is a
 * constant column even though the exact `2` and the float `2.0` are not the
 * same expression.
 */
function isConstantColumn(
  ce: ComputeEngine,
  vals: ReadonlyArray<Expression>
): boolean {
  if (bignumPreferred(ce)) {
    const projected = bigVals(vals);
    const first = projected[0];
    return first.isFinite() && projected.every((x) => x.eq(first));
  }
  const projected = machineVals(vals);
  const first = projected[0];
  return Number.isFinite(first) && projected.every((x) => x === first);
}

function evaluateCovariance(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean,
  population: boolean
): Expression {
  const name = population ? 'PopulationCovariance' : 'Covariance';
  // Every operand of a covariance is data, so the whole list is scanned when
  // the shape is rejected.
  const walked: Expression[] = [];
  // `true`: an absent (`Missing`) datum is admitted as data so the §3.C
  // verdict below is reached, AFTER the shape checks — see `extractPairs`.
  const pairs = extractPairs(ops, walked, true);
  if (!pairs) return shapeError(ce, name, ops, walked);
  const { xs, ys } = pairs;
  // Same error as every broadcast-path mismatch (`docs/BROADCAST-MODEL.md`):
  // a pairwise reducer over two collections is strict on length agreement.
  if (xs.length !== ys.length)
    return ce.error('incompatible-dimensions', `${xs.length} vs ${ys.length}`);
  if (xs.length < 2)
    return ce.error(
      'unexpected-argument',
      `${name}: at least 2 data points required`
    );
  const nonReal = nonRealDatum(xs, ys);
  if (nonReal) return nonRealDataError(ce, name, nonReal);
  // A datum with no real value makes the covariance unknown on every path,
  // including the exact one, which would otherwise carry `~oo` into a
  // symbolic sum.
  if (hasNaNDatum(xs, ys)) return ce.NaN;

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
  // Every operand of a correlation is data, so the whole list is scanned when
  // the shape is rejected.
  const walked: Expression[] = [];
  // `true`: as in `evaluateCovariance` — an absent datum is data here, and
  // §3.C makes it the answer's `NaN`.
  const pairs = extractPairs(ops, walked, true);
  if (!pairs) return shapeError(ce, 'Correlation', ops, walked);
  const { xs, ys } = pairs;
  // Same error as every broadcast-path mismatch (`docs/BROADCAST-MODEL.md`).
  if (xs.length !== ys.length)
    return ce.error('incompatible-dimensions', `${xs.length} vs ${ys.length}`);
  if (xs.length < 2)
    return ce.error(
      'unexpected-argument',
      'Correlation: at least 2 data points required'
    );
  const nonReal = nonRealDatum(xs, ys);
  if (nonReal) return nonRealDataError(ce, 'Correlation', nonReal);
  // An unknown datum makes the whole coefficient unknown, exactly as it does
  // for `Covariance`.
  if (hasNaNDatum(xs, ys)) return ce.NaN;

  if (!numericApproximation && allExact(xs) && allExact(ys)) {
    const r = exactCorrelation(ce, xs, ys);
    return r ?? zeroVarianceError(ce);
  }

  const r = bignumPreferred(ce)
    ? bigCorrelation(bigVals(xs), bigVals(ys))
    : correlation(machineVals(xs), machineVals(ys));
  const num = ce.number(r);
  if (!num.isNaN) return num;
  // A `NaN` from the kernel is not by itself evidence of a zero variance: the
  // machine kernel also answers `NaN` when the sums of squares overflow, which
  // they do for perfectly correlated data around `1e200`. So the degenerate
  // case is diagnosed directly, from a column that is actually constant.
  // Everything else — non-finite data included — propagates `NaN`, which is
  // what `Covariance` answers for the same input.
  return isConstantColumn(ce, xs) || isConstantColumn(ce, ys)
    ? zeroVarianceError(ce)
    : ce.NaN;
}

function zeroVarianceError(ce: ComputeEngine): Expression {
  return ce.error('unexpected-argument', 'Correlation: zero variance');
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
 *
 * A failure reports which operands were the DATA (`dataOps`) and which of
 * their elements the walk already materialized (`walked`), so the caller's
 * error path can tell a complex datum from a mis-shaped argument list without
 * re-enumerating anything — see `shapeError`.
 */
type FitArgs =
  | {
      ok: true;
      xs: Expression[];
      ys: Expression[];
      degree: number;
      variable?: string;
    }
  | { ok: false; dataOps: Expression[]; walked: Expression[] };

function parseFitArgs(
  ops: ReadonlyArray<Expression>,
  wantDegree: boolean
): FitArgs {
  let rest = [...ops];
  const walked: Expression[] = [];

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
    if (rest.length === 0) return { ok: false, dataOps: rest, walked };
    const degreeArg = rest[rest.length - 1];
    // A NUMBER in the degree position is a degree, however badly spelled, and
    // every bad spelling is answered by the caller's own degree diagnostic,
    // which names the range a degree must lie in — a better answer than
    // blaming the data or the argument shape. `NaN` is how this parse says
    // "not a degree". Integrality is tested with the EXACT `isInteger`
    // predicate for the same reason the bin-count spec of `computeBinning`
    // above tests it that way: `toInteger` reads a number's real part and
    // ROUNDS it, so `PolynomialFit(xs, ys, Complex(1, 2))` silently fitted a
    // degree-1 polynomial and `PolynomialFit(xs, ys, 2.5)` a degree-3 one,
    // while `NaN` and `±∞` made `toInteger` answer null and the whole call was
    // reported as a mis-shaped argument list. `toInteger` still has the last
    // word on the safe-integer range, which no degree in [0, 12] approaches.
    // A NON-number trailing operand keeps the shape-error route, because it
    // may be the second data collection of a two-collection call.
    if (!isNumber(degreeArg))
      return { ok: false, dataOps: rest.slice(0, -1), walked };
    degree =
      (degreeArg.isInteger === true ? toInteger(degreeArg) : null) ?? NaN;
    rest = rest.slice(0, -1);
  }

  const pairs = extractPairs(rest, walked);
  if (!pairs) return { ok: false, dataOps: rest, walked };
  return { ok: true, xs: pairs.xs, ys: pairs.ys, degree, variable };
}

function evaluateLinearRegression(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  const parsed = parseFitArgs(ops, false);
  if (!parsed.ok)
    return shapeError(
      ce,
      'LinearRegression',
      parsed.dataOps,
      parsed.walked,
      'LinearRegression: invalid arguments'
    );
  const { xs, ys, variable } = parsed;
  // Same error as every broadcast-path mismatch (`docs/BROADCAST-MODEL.md`)
  // and as the bivariate statistics: a pairwise fit over two collections is
  // strict on length agreement. Without this check the mismatch fell through
  // to the kernel's rank guard and was misreported as "degenerate data".
  if (xs.length !== ys.length)
    return ce.error('incompatible-dimensions', `${xs.length} vs ${ys.length}`);
  // Fewer than two points determine no line, whatever the values are, so the
  // sample geometry is reported ahead of everything the data could say about
  // itself — the same order `PolynomialFit` below uses for its own
  // degree-versus-points check. Without it a one-point sample answered
  // `(NaN, NaN)` when the point was `NaN` (propagation winning over a fact
  // that does not depend on the value) and `degenerate data` when it was
  // finite (naming a rank deficiency instead of the missing point).
  if (xs.length < 2)
    return ce.error(
      'unexpected-argument',
      'LinearRegression: not enough data points'
    );
  // The fit reads each datum's real part, so complex data would silently
  // return the fit of different points: `[1, 1+2i, 5]` would be fitted as
  // `[1, 1, 5]`.
  const nonReal = nonRealDatum(xs, ys);
  if (nonReal) return nonRealDataError(ce, 'LinearRegression', nonReal);
  const coeffs =
    nanCoefficients(ce, xs, ys, 1) ??
    fitCoefficients(ce, xs, ys, 1, numericApproximation);
  if (!coeffs)
    return ce.error('unexpected-argument', 'LinearRegression: degenerate data');
  const [b0, b1] = coeffs;
  if (variable !== undefined) return buildPolynomial(ce, coeffs, variable);
  return ce.tuple(b0, b1);
}

function evaluatePolynomialFit(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  const parsed = parseFitArgs(ops, true);
  if (!parsed.ok)
    return shapeError(
      ce,
      'PolynomialFit',
      parsed.dataOps,
      parsed.walked,
      'PolynomialFit: invalid arguments'
    );
  const { xs, ys, degree, variable } = parsed;
  // Same strict length agreement as `LinearRegression` and the bivariate
  // statistics — a mismatch is a dimension error, not "degenerate data".
  if (xs.length !== ys.length)
    return ce.error('incompatible-dimensions', `${xs.length} vs ${ys.length}`);
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
  // The fit reads each datum's real part, so complex data would silently
  // return the fit of different points.
  const nonReal = nonRealDatum(xs, ys);
  if (nonReal) return nonRealDataError(ce, 'PolynomialFit', nonReal);
  const coeffs =
    nanCoefficients(ce, xs, ys, degree) ??
    fitCoefficients(ce, xs, ys, degree, numericApproximation);
  if (!coeffs)
    return ce.error('unexpected-argument', 'PolynomialFit: degenerate data');
  if (variable !== undefined) return buildPolynomial(ce, coeffs, variable);
  return ce.function('List', coeffs);
}

/**
 * The all-`NaN` coefficient vector `[NaN, …, NaN]` (length `degree + 1`) when
 * the data contains a value with no finite real reading — `NaN`, a real `±∞`,
 * or the complex infinity `~oo` under either spelling — and `null` when every
 * data value is a finite real, in which case the caller runs the real fit.
 *
 * A least-squares fit is a ratio of sums of products of the data, so a single
 * unreadable value poisons every coefficient, exactly as it poisons
 * `Covariance`/`Correlation`. Deciding that here, rather than leaving it to
 * the Gaussian elimination to stumble into, keeps the answer in the shape the
 * head declares: a pair for `LinearRegression`, a `degree + 1` coefficient
 * list for `PolynomialFit` (the degree is validated by the caller before this
 * runs, so the length is always well defined), or the fitted expression with
 * `NaN` coefficients when a trailing variable was given. It also makes the two
 * data columns agree — the Y column already answered this way.
 *
 * `degenerate data` survives for its real case: rank-deficient FINITE real
 * data, such as `LinearRegression([2, 2, 2], [1, 2, 3])`, where no line is
 * determined because every sample shares one x.
 */
function nanCoefficients(
  ce: ComputeEngine,
  xs: Expression[],
  ys: Expression[],
  degree: number
): Expression[] | null {
  if (!nonFiniteDatum(xs, ys)) return null;
  return Array.from({ length: degree + 1 }, () => ce.NaN);
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
  const X = exact ? xs : xs.map((x) => ce.number(realProjection(x)));
  const Y = exact ? ys : ys.map((y) => ce.number(realProjection(y)));

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
    let pivMag = Math.abs(numberLiteralOf(aug[col][col])?.re ?? NaN);
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(numberLiteralOf(aug[r][col])?.re ?? NaN);
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
