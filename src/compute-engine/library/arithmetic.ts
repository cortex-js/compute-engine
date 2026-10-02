import { Complex } from 'complex-esm';
import type { BigNum } from '../numerics/types.js';
import type { MathJsonExpression } from '../../math-json/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { factsOf } from '../../common/type/facts.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  describeType,
  typeFact,
} from '../boxed-expression/operand-descriptor.js';
import { BigDecimal } from '../../big-decimal/index.js';

import {
  checkType,
  checkTypes,
  checkNumericArgs,
  absentableCollectionOperandValue,
  absentScalarMarker,
  hasAbsentScalarOperand,
  isAbsentScalarSymbol,
  listCoordinateTupleOperandError,
  markAbsentPointCells,
  nonNumericOperandError,
} from '../boxed-expression/validate.js';
import {
  admissionOf,
  evidenceAdmissionOf,
  heldNonNumericScalar,
} from '../boxed-expression/value-membership.js';
import { hasAsyncOnlyApplication } from '../boxed-expression/async-only-descendants.js';
import {
  bignumPreferred,
  boxBignumResult,
  numericFromExactValue,
  numericFromExactValueAsync,
} from '../boxed-expression/utils.js';
import {
  DEADLINE_STRIDE,
  holdsDoubles,
  machineListOf,
} from '../boxed-expression/machine-broadcast.js';
import { boxStoreElement } from '../boxed-expression/machine-number.js';
import { withEvaluationEffects } from '../effects-registry.js';
import { polynomialGCDMulti } from '../boxed-expression/polynomials.js';
import {
  asSmallInteger,
  asRational,
  asBignum,
  asBigint,
  toBigint,
  toInteger,
  provablyNonFiniteNumber,
  nearJumpTolerance,
  isNearRoundingJumpValue,
} from '../boxed-expression/numerics.js';
import { addOrder } from '../boxed-expression/order.js';
import { reduceModulo } from '../boxed-expression/modular-arithmetic.js';
import {
  hasInfiniteComponent,
  logarithmAtExceptionalPoint,
} from '../boxed-expression/logarithm.js';

import {
  apply,
  apply2,
  applyN,
  shouldNumericize,
  isExactNumber,
} from '../boxed-expression/apply.js';
import {
  asFloat,
  floatIfFloatOperand,
  hasFloatOperand,
} from '../boxed-expression/float-result.js';
import { flatten } from '../boxed-expression/flatten.js';
import { numericCanonicalHandler } from '../boxed-expression/canonical-numeric.js';
import { recordNumericCanonicalDefinitions } from '../boxed-expression/numeric-canonical-registry.js';
import { rangeCount } from '../numerics/range-count.js';

import {
  gamma as gammaComplex,
  gammaln as lngammaComplex,
  incompleteGammaUpperComplex,
  zetaComplex,
  hurwitzZetaComplexWithError,
  zetaGeneralizedComplexWithError,
  polygammaComplex,
  complexDivide,
} from '../numerics/numeric-complex.js';
import { lerchPhiComplex, DIRICHLET_NEAR_POLE } from '../numerics/lerch-phi.js';
import { EULERIAN_MAX_ORDER } from '../numerics/polylog.js';
import {
  factorial2 as bigFactorial2,
  gcd as bigGcd,
  lcm as bigLcm,
} from '../numerics/numeric-bignum.js';
import { factorial as bigFactorial } from '../numerics/numeric-bigint.js';
import {
  zetaEvenCoefficient,
  eulerEvenNumber,
  zetaNegativeInteger,
  hurwitzZetaNegativeInteger,
  generalizedZetaNegativeInteger,
  bernoulliPolynomialCoefficients,
  hurwitzZetaNegativeIntegerGaussianParts,
  type GaussianRational,
} from '../numerics/bernoulli.js';
import {
  gamma,
  gammaln,
  estimatedFactorialDigits,
  incompleteGammaUpper,
  bigGamma,
  bigGammaln,
  digamma,
  trigamma,
  polygamma,
  beta,
  zeta,
  lambertW,
  bigDigamma,
  bigTrigamma,
  bigPolygamma,
  bigBeta,
  bigZeta,
  bigDirichletEta,
  bigDirichletBeta,
  bigHurwitzZeta,
  bigDecimalQuotient,
  bigZetaGeneralized,
  bigLerchPhi,
  type HurwitzOperand,
  bigLambertW,
  besselJ,
  besselY,
  besselI,
  besselK,
  airyAi,
  airyBi,
  airyAiPrime,
  airyBiPrime,
} from '../numerics/special-functions.js';
import {
  factorial2,
  gcd,
  lcm,
  realGcd,
  realLcm,
  roundHalfAway,
  floorModDouble,
  MACHINE_PRECISION,
} from '../numerics/numeric.js';
import { rationalize } from '../numerics/rationals.js';
import type { NumberLiteralInterface } from '../types-expression.js';
import { isComposite, isPrime } from '../boxed-expression/predicates.js';

import {
  canonicalAdd,
  add,
  addNEvaluated,
  absorbScalarsIntoCells,
} from '../boxed-expression/arithmetic-add.js';
import {
  mulFactored,
  mulNEvaluated,
  isOutOfDoubleRangeLiteral,
} from '../boxed-expression/arithmetic-mul-div.js';
import { indexingSetSites } from '../boxed-expression/binding-sites.js';
import {
  evaluateBigOpTerm,
  evaluateBigOpTermAsync,
  canonicalBigop,
  reduceBigOp,
  NON_ENUMERABLE_DOMAIN,
  NON_ENUMERABLE_BOUNDS,
  bigOpBoundsError,
  classifyBigopDomain,
  DEGENERATE_CAPTURE_UNSAFE,
  degenerateBigOpTerm,
  symbolicSumClosedForm,
  symbolicProductClosedForm,
  infiniteSumClosedForm,
  infiniteProductClosedForm,
  acceleratedInfiniteSum,
  acceleratedInfiniteProduct,
  euclideanNormType,
  isTupleTypedOperand,
  operandChildren,
  pointNormType,
} from './utils.js';
import { inferContinuationPattern } from '../symbolic/interpret.js';
import {
  pow,
  realPowerBranchTerms,
  root,
} from '../boxed-expression/arithmetic-power.js';
import {
  broadcastCellType,
  broadcastElementType,
  broadcastResultType,
  collectionElementType,
  negateNumericType,
  nonNegativeRangeType,
  positiveRangeType,
  resolveTypeAlias,
  stripNumericRanges,
  widen,
  widenAll,
} from '../../common/type/utils.js';
import {
  couldMatch,
  isEmptyType,
  isSubtype,
} from '../../common/type/subtype.js';
import {
  negativeSign,
  nonNegativeSign,
  nonPositiveSign,
  positiveSign,
} from '../boxed-expression/sgn.js';
import {
  INDEXED_COLLECTION_SHAPE_TYPE,
  SIGNED_INFINITY_TYPE,
} from '../../common/type/primitive.js';
import type {
  ListType,
  NamedElement,
  TupleType,
  Type,
} from '../../common/type/types.js';
import {
  addIntervals,
  attachInterval,
  divIntervals,
  finalizeInterval,
  foldIntervalsOfTypes,
  intervalExcludesZero,
  intervalOfType,
  mulIntervals,
  powIntervalSigned,
} from '../numerics/interval-arithmetic.js';

/** The tier of a real quotient whose divisor may be zero: a finite real,
 * the projective `~oo` of `1/0`, or the `NaN` of `0/0` — never a non-real
 * finite complex, so this is strictly tighter than `number` (lattice
 * ruling L3: over-admit only within the `infinity` branch). */
// Built as a literal node, not `parseType(...)`: this runs at module
// initialization, and under jest's CommonJS module graph `parse.js` is not
// yet initialized when this file's top level executes (a temporal-dead-zone
// `ReferenceError`); `tsx` happened to order the modules differently.
// Frozen: returned BY REFERENCE from the Divide and Power handlers and
// stored as-is (the parse fast path and the widening walker both return a
// valid, unchanged node by identity), so an in-place mutation anywhere
// downstream would corrupt every later pole type in the process — the
// same rationale as `EXTENDED_REAL_TYPE` in `common/type/primitive.ts`.
const POSSIBLY_ZERO_QUOTIENT_TYPE: Type = Object.freeze({
  kind: 'union',
  types: Object.freeze(['real', 'infinity', 'nan']) as unknown as Type[],
}) as Type;
// The shared type-handler helpers take one `OperandDescriptor` per operand
// instead of the operand expression. They are imported under an `OnTypes`
// suffix: this file also defines value-path predicates of the same names
// over expressions (`isPointListType`, the interval helpers), and the suffix
// keeps the two families readable side by side.
import {
  kindClosureType,
  numericTypeHandler as numericTypeHandlerOnTypes,
  elementaryFunctionType as elementaryFunctionTypeOnTypes,
  gammaPoleType as gammaPoleTypeOnTypes,
  extremumType as extremumTypeOnTypes,
  elementExtremumType as elementExtremumTypeOnTypes,
  extremumRangeType as extremumRangeTypeOnTypes,
  roundingFunctionType as roundingFunctionTypeOnTypes,
  measurementType as measurementTypeOnTypes,
  bigOpResultType as bigOpResultTypeOnTypes,
  operandLiteralValue as operandLiteralValueOnTypes,
  operandSgn as operandSgnOnTypes,
  provablyLess as provablyLessOnTypes,
  provablyGreaterEqual as provablyGreaterEqualOnTypes,
  operandNonFiniteNumber as operandNonFiniteNumberOnTypes,
  absFunctionType as absFunctionTypeOnTypes,
  broadcastOperandType,
  finiteExtendedPart,
} from './type-handlers.js';
import {
  infinitePoint,
  isRealLiteral,
} from '../boxed-expression/infinite-point.js';
import type {
  OperandDescriptor,
  PureEngineView,
} from '../types-definitions.js';
import { isPrime as isPrimeNumber } from '../numerics/primes.js';
import { parseType } from '../../common/type/parse.js';

/** The carrier of the integer-membership predicates (`IsPrime`,
 * `IsComposite`, `IsOdd`, `IsEven`): all of `number` except the infinities.
 * See `infiniteOperandOfIntegerPredicate`, which enforces it. */
const INTEGER_PREDICATE_CARRIER_TYPE = parseType('complex | nan');

/** The carrier of `Power`'s EXPONENT slot: the finite complex numbers and
 * the signed infinities, excluding `~oo` (no base has a value there). The
 * `Power` evaluate handler enforces it — see the comment on the `Power`
 * signature. */
const POWER_EXPONENT_CARRIER_TYPE = parseType('complex | signed_infinity');

/**
 * Above this many decimal digits an exact factorial is impractical to
 * materialize: the bigint product grows with every step, so a STEP cap
 * cannot bound the work, and `Factorial(10^400)` — a result of about
 * 4·10^402 digits — never returned. The handlers stay symbolic above it on
 * the exact route and overflow to `+oo` under `numericApproximation`.
 * Mirrors `MAX_EXACT_COMBINATORICS_DIGITS` in `library/combinatorics.ts`
 * (same value, same convention: a dedicated per-file constant).
 */
const MAX_EXACT_FACTORIAL_DIGITS = 1_000_000;
import {
  foldQuantityOperands,
  isQuantity,
  quantityAdd,
  quantityMultiply,
  quantityDivide,
  quantityPower,
} from './quantity-arithmetic.js';
import {
  foldMeasurementOperands,
  isMeasurement,
  measurementAdd,
  measurementMultiply,
  measurementDivide,
  measurementNegate,
  measurementPower,
  measurementSqrt,
  measurementRoot,
  measurementLn,
  measurementLog,
  measurementLipschitzUnary,
} from './measurement-arithmetic.js';
import {
  range,
  rangeLast,
  hasSymbolicRangeBounds,
  enumerationDeclinedAfterWalk,
} from './collections.js';
import {
  run,
  runAsync,
  CancellationError,
  checkDeadline,
} from '../../common/interruptible.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
  Sign,
} from '../global-types.js';
import type { NumericValue } from '../numeric-value/types.js';
import {
  ExactNumericValue,
  withDoubleDigits,
} from '../numeric-value/exact-numeric-value.js';
import {
  isNumber,
  isFunction,
  isString,
  isCharacter,
  isSymbol,
  isContinuationOperand,
  isAbsentValue,
  isAbsentSymbol,
  isAbsentArithmeticOperand,
  isInexactOperand,
  nanOperandAnswer,
  indeterminateFormAnswer,
} from '../boxed-expression/type-guards.js';
import {
  cmp,
  exactConstantValue,
  exactFormOfConstant,
  exactOrder,
  isExactConstantExpression,
  refineExactConstants,
} from '../boxed-expression/compare.js';
import {
  isExactRealLiteral,
  exactRealValueOf,
} from '../boxed-expression/constraint-subject.js';
import { canonical } from '../boxed-expression/canonical-utils.js';
import { expand } from '../boxed-expression/expand.js';
import {
  typeCouldBeNumericTuple,
  typeCouldBeNumericTupleCollection,
  broadcastSiblingType,
  isTextAtom,
  isTuple,
  isShapedNumericType,
  resolveShapedTypeAlias,
  unionHasGenuineScalarBranch,
} from '../collection-utils.js';
import { signFromAssumedPart } from './complex.js';
import { complexParts } from './complex-parts.js';

// When processing an arithmetic expression, the following are the core
// canonical arithmetic operations to account for:
export type CanonicalArithmeticOperators =
  | 'Add'
  | 'Negate' // Distributed over mul/div/add
  | 'Multiply'
  | 'Divide'
  | 'Power'
  | 'Sqrt'
  | 'Root'
  | 'Ln';

// Non-canonical functions: the following functions get transformed during
// canonicalization, and can be ignored as they will not occur in a canonical
// expression (they are canonicalized to an equivalent canonical form):
//
// - Complex(re, im) -> Complex number (re + i im)
// - Rational(num, den) -> Rational number (num / den)
// - Exp(x) -> Power(E, x)
// - Square(x) -> Power(x, 2)
// - Subtract(a, b) -> Add(a, Negate(b))

/*

### THEORY OF OPERATIONS:  PRECEDENCE

PEMDAS is a lie. But the ambiguity is essentially around the ÷ (or solidus /)
sign and implicit multiplication.

Some calculators will interpret 6÷2(1+2) as 6÷(2(1+2)) others as (6÷2)(1+2)

References:
- Abstract Algebra- The Basic Graduate Year by Robert B. Ash https://faculty.math.illinois.edu/~r-ash/Algebra/SolutionsChap1-5.pdf p2
- The Feynman Lectures on Physics Vol. I Ch. 6: Probability https://www.feynmanlectures.caltech.edu/I_06.html
- Basics of Mechanical Engineering by Paul D. Ronney http://ronney.usc.edu/ame101/ame101-lecturenotes.pdfp7 (page 15 of the pdf)

- Oliver Knill - Ambiguous PEMDAS https://people.math.harvard.edu/~knill/pedagogy/ambiguity/index.html
- AMS Guide for Reviewers May 2000 https://web.archive.org/web/20000815202937/http://www.ams.org/authors/guide-reviewers.html
- APS Physical Review Style and Notation Guide https://cdn.journals.aps.org/files/styleguide-pr.pdf p21

- David Linkletter: https://plus.maths.org/content/pemdas-paradox
- Sass' article:
- First year algebra: https://archive.org/details/firstyearalgebra00well/page/18/mode/2up also p85
- First course in algebra:  https://archive.org/details/firstcourseinal01toutgoog/page/n23/mode/2up (p10) also p74 (page 90 of the pdf)
- Second course in algebra: https://archive.org/details/secondcourseinal00wellrich/page/4/mode/2up also  p64
- Lennes' article, 'Relating to the Order of Operations in Algebra': https://www.jstor.org/stable/2972726

- Sharp EL-512 manual:  https://www.manualslib.com/manual/1177727/Sharp-El-512.html?page=9#manual (p14)
- TI 81 manual: https://www.manualslib.com/manual/325929/Texas-Instruments-Ti-81.html?page=34#manual (p1-8)

- AMS Guide for Reviewers May 2000 https://web.archive.org/web/20000815202937/http://www.ams.org/authors/guide-reviewers.html
- APS Physical Review Style and Notation Guide  https://cdn.journals.aps.org/files/styleguide-pr.pdf p21
- AIP style guide:  http://web.mit.edu/me-ugoffice/communication/aip_style_4thed.pdf p23 (page 26 of the pdf)
*/

/** Computes the Sign of a number */
function numberSgn(x: number | undefined): Sign | undefined {
  if (x === undefined) return undefined;
  if (isNaN(x)) return 'unsigned';
  if (x > 0) return 'positive';
  if (x < 0) return 'negative';
  return 'zero';
}

/** Given the sgn of x, returns the sgn of -x */
function oppositeSgn(x: Sign | undefined): Sign | undefined {
  if (x === 'positive') return 'negative';
  if (x === 'non-negative') return 'non-positive';
  if (x === 'negative') return 'positive';
  if (x === 'non-positive') return 'non-negative';
  return x;
}

/** The rounding rule of `Floor`, `Ceil`, `Truncate` and `Round`. `round`
 * rounds a half away from zero (user decision, 2026-09-21). */
type RoundingMode = 'floor' | 'ceil' | 'trunc' | 'round';

/** The integer square root of a non-negative `bigint`: the largest `s` with
 * `s² ≤ n`. Newton's iteration from an upper estimate. */
function bigintSqrtFloor(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/**
 * The rounded value of an EXACT real number literal, computed with `bigint`
 * arithmetic, or `undefined` when `x` is not an exact real literal.
 *
 * An exact real literal is `(p/q)·√r` (`ExactNumericValue`; `r` is 1 for a
 * rational). The big-decimal lane of `apply()` rounds `bignumRe`, which is
 * the quotient `p/q` rounded to the working precision (21 digits by
 * default), and the machine lane rounds a double. So a value with more
 * integer digits than that precision lost its low digits before the
 * rounding: `Floor((25! − 1)/24!)` was `25`, not `24`, and `Floor(25! − 1)`
 * was `25!`. A value closer to a half-integer or an integer than the
 * precision can see was rounded to the wrong side:
 * `Round(1/2 − 10⁻³⁰)` was `1`.
 *
 * Here `|x| = √N / q` with `N = p²·r`, and for an integer `q > 0`,
 * `⌊√N / q⌋ = ⌊⌊√N⌋ / q⌋`. So `m = ⌊|x|⌋` needs only the integer square
 * root of `N`. `|x|` is an integer exactly when `N` is a perfect square and
 * `q` divides its root. `|x| ≥ m + ½` exactly when `4N ≥ (2m + 1)²·q²`,
 * which is the tie-away-from-zero test for `round`.
 *
 * Reported in cortex-js/compute-engine#382.
 */
function roundExactReal(x: Expression, mode: RoundingMode): bigint | undefined {
  if (!isNumber(x) || !x.isExact || x.isComplex) return undefined;
  const nv = x.numericValue;
  if (typeof nv === 'number')
    return Number.isInteger(nv) ? BigInt(nv) : undefined;
  if (!(nv instanceof ExactNumericValue)) return undefined;
  let p = BigInt(nv.rational[0]);
  let q = BigInt(nv.rational[1]);
  const r = BigInt(nv.radical);
  if (q === 0n || r <= 0n) return undefined;
  if (q < 0n) {
    p = -p;
    q = -q;
  }
  const negative = p < 0n;
  const a = negative ? -p : p;
  // `|x| = √n / q`. For a rational (`r = 1`) this is `a / q`, and the tests
  // below use `a` directly, which avoids squaring a large numerator.
  const n = r === 1n ? 0n : a * a * r;
  const root = r === 1n ? a : bigintSqrtFloor(n);
  const m = root / q;
  const isInteger =
    r === 1n ? a % q === 0n : root * root === n && root % q === 0n;
  // `k` is the rounded value of `|x|` in the direction the mode needs.
  let k: bigint;
  if (mode === 'trunc') k = m;
  else if (mode === 'round') {
    // Round up when `|x| ≥ m + 1/2`. For a rational this is
    // `2·(a mod q) ≥ q`; otherwise it is `4n ≥ (2m + 1)²·q²`, squared so that
    // no square root is needed.
    if (r === 1n) k = 2n * (a % q) >= q ? m + 1n : m;
    else {
      const twice = 2n * m + 1n;
      k = 4n * n >= twice * twice * q * q ? m + 1n : m;
    }
  } else {
    // `floor` of a negative value and `ceil` of a positive value move away
    // from zero unless the value is an integer.
    const awayFromZero = (mode === 'floor') === negative;
    k = awayFromZero && !isInteger ? m + 1n : m;
  }
  return negative ? -k : k;
}

/**
 * The rounded value of an EXACT constant expression that is not a number
 * literal (`π·10³⁰`, `e^10`, `√2 + √3`; see `isExactConstantExpression()`),
 * or `undefined` when it is not decided.
 *
 * The value is enclosed in an interval at a precision that is raised until
 * both ends of the interval round to the same integer
 * (`refineExactConstants()`). Each rounding mode is a non-decreasing
 * function, so the exact value, which is in the interval, rounds to that
 * integer too. A value that is exactly at a jump (`(√2 + √3)² − 2√6`, which
 * is `5`) is never decided: its interval always contains the jump.
 * Mathematica does the same (`Floor[Pi 10^30]` is
 * `3141592653589793238462643383279`, and `Floor[(Sqrt[2] + Sqrt[3])^2 -
 * 2 Sqrt[6]]` stays unevaluated).
 *
 * With `atJumpAtLimit` (under `.N()`), a value whose last enclosure still
 * contains a jump, and is narrower than `10^−(working + 50)` there (the
 * `narrowAtLimit` test of `refineExactConstants()`: the jumps are 1 apart),
 * is taken to be AT the jump nearest to the middle of the enclosure, and it
 * is rounded as that point: an integer for `floor`,
 * `ceil` and `trunc`, and a half-integer for `round`, which rounds away
 * from zero. Mathematica does the same under `N`
 * (`N[Floor[(Sqrt[2] + Sqrt[3])^2 - 2 Sqrt[6]]]` is `5`). A wider
 * enclosure (`sin(10⁶⁰⁰)`, whose error grows with its argument) is not
 * decided: the caller uses the float.
 *
 * `x` is evaluated exactly first (`exactFormOfConstant()`): an exact number
 * result is rounded exactly (`roundExactReal()`), and otherwise the
 * enclosures are computed for the evaluated form. A value that no
 * evaluation simplifies, and that is nearer to a jump than about
 * `10^−(working + 50)` times its largest term, is taken to be at the jump
 * under `.N()`.
 */
function roundExactConstant(
  x: Expression,
  mode: RoundingMode,
  atJumpAtLimit = false
): bigint | undefined {
  if (!isExactConstantExpression(x)) return undefined;
  const round = (v: BigDecimal): BigDecimal =>
    mode === 'floor'
      ? v.floor()
      : mode === 'ceil'
        ? v.ceil()
        : mode === 'trunc'
          ? v.trunc()
          : v.round();
  const exact = exactFormOfConstant(x);
  if (exact === undefined) return undefined;
  if (isExactRealLiteral(exact)) return roundExactReal(exact, mode);
  return refineExactConstants([exact], ([[lo, hi]], narrowAtLimit) => {
    const a = round(lo);
    if (a.eq(round(hi))) return a.toBigInt();
    if (!atJumpAtLimit || !narrowAtLimit(lo, hi)) return undefined;
    const middle = lo.add(hi).div(2);
    const jump =
      mode === 'round' ? middle.floor().add(BigDecimal.HALF) : middle.round();
    return round(jump).toBigInt();
  });
}

/**
 * True when the float `x` is so near a point where the rounding `mode`
 * jumps (an integer for `floor`, `ceil` and `trunc`, a half-integer for
 * `round`) that its rounding error can put it on the wrong side of that
 * point. The distance is relative to `max(1, |x|)` (`nearJumpTolerance()`),
 * so a float with no fractional digits left (`1.55e25` at 21 digits) is
 * always near a jump.
 */
function isNearRoundingJump(x: Expression, mode: RoundingMode): boolean {
  if (!isNumber(x) || x.isExact || x.isComplex || x.isFinite !== true)
    return false;
  return isNearRoundingJumpValue(x.engine, x.re, mode === 'round');
}

/**
 * Under `.N()`, the exact value of the operand of a rounding function, or
 * `undefined` when the numeric operand `x` decides the result.
 *
 * `x` is the operand after its numeric approximation, and `original` is the
 * same operand before it. `.N()` promises a result correct to the working
 * precision, and a rounding function jumps at a point: the float of an exact
 * operand near that point can be on its other side. The float of
 * `(25! − 1)/24!` at 21 digits is `25`, but its floor is `24`. So an exact
 * operand is rounded exactly (`roundExactReal()`), as Mathematica does
 * (`N[Floor[(25! − 1)/24!]]` is `24.`).
 *
 * An exact literal operand is always used, because this costs nothing. An
 * expression is evaluated again, exactly, only when `x` is near a jump
 * (`isNearRoundingJump()`) and the expression is pure
 * (`exactRealValueOf()`): an exact evaluation can cost much more than the
 * numeric one (the exact sum of 1000 fractions), and far from a jump the
 * float decides the result.
 */
function exactRoundingOperand(
  x: Expression,
  mode: RoundingMode,
  original: Expression | undefined
): Expression | undefined {
  if (isExactRealLiteral(x)) return x;
  if (original === undefined) return undefined;
  if (isNumber(original) || isNearRoundingJump(x, mode))
    return exactRealValueOf(original);
  return undefined;
}

/**
 * Under `.N()`, the operand of a function that jumps at 0 (`Sign`,
 * `Heaviside`): the exact value of the operand when the float `x` does not
 * decide the result, and `x` otherwise.
 *
 * The float of an exact operand near 0 can have the wrong sign, because its
 * rounding error can be larger than its value. So when the float is near 0
 * (or the operand is an exact literal), the operand is evaluated again
 * exactly (`exactRealValueOf()`, pure operands only), and an exact real
 * value gives the exact sign.
 */
function exactZeroJumpOperand(
  x: Expression,
  numericApproximation: boolean | undefined,
  expression: Expression | undefined
): Expression {
  // An exact constant expression that is not a number
  // (`π − 314159265358979323846264338327950289/10³⁵`) gets its sign from
  // enclosures (`exactConstantSign()`). Under `.N()`, the original operand
  // is used at any distance from 0, because its float can have the wrong
  // sign when its terms cancel, and a value that is at 0 at the precision
  // limit is taken to be 0.
  if (!numericApproximation) return exactConstantSign(x) ?? x;
  if (isExactRealLiteral(x)) return x;
  const original = originalOperand(expression, 0);
  if (original !== undefined) {
    const sign = exactConstantSign(original, true);
    if (sign !== undefined) return sign;
  }
  if (
    original !== undefined &&
    (isNumber(original) ||
      (isNumber(x) &&
        !x.isComplex &&
        x.isFinite === true &&
        Math.abs(x.re) <= nearJumpTolerance(x.engine)))
  )
    return exactRealValueOf(original) ?? x;
  return x;
}

/**
 * The sign of the exact constant expression `x` (see
 * `isExactConstantExpression()`), as the number `1` or `-1`, from enclosures
 * of its value (`refineExactConstants()`). `undefined` when `x` is not such
 * an expression, or when its enclosures all contain 0 (a value that is
 * exactly 0 is never decided), except with `zeroAtLimit` (under `.N()`):
 * then a value whose last enclosure contains 0, and is narrower than
 * `10^−(working + 50)` (the `narrowAtLimit` test of
 * `refineExactConstants()`), is taken to be 0, as Mathematica does
 * (`N[Sign[Log[6] - Log[2] - Log[3]]]` is `0`). The caller
 * uses the number in place of `x` only for its sign.
 *
 * `x` is evaluated exactly first (`exactFormOfConstant()`): an exact number
 * result gives its exact sign, and otherwise the enclosures are computed
 * for the evaluated form. A value that no evaluation simplifies, and that
 * is smaller than about `10^−(working + 50)` times its largest term, is
 * taken to be 0 under `.N()`.
 */
function exactConstantSign(
  x: Expression,
  zeroAtLimit = false
): Expression | undefined {
  if (!isExactConstantExpression(x)) return undefined;
  const exact = exactFormOfConstant(x);
  if (exact === undefined) return undefined;
  if (isExactRealLiteral(exact))
    return x.engine.number(exact.isSame(0) ? 0 : exact.isPositive ? 1 : -1);
  const sign = refineExactConstants([exact], ([[lo, hi]], narrowAtLimit) =>
    lo.isPositive()
      ? 1
      : hi.isNegative()
        ? -1
        : zeroAtLimit && narrowAtLimit(lo, hi)
          ? 0
          : undefined
  );
  return sign === undefined ? undefined : x.engine.number(sign);
}

/**
 * Under `.N()`, the value of `Mod(a, m)` computed from the EXACT values of
 * its operands and then approximated, or `undefined` when the floats `a`
 * and `m` decide the result.
 *
 * `Mod(a, m) = a − m·⌊a/m⌋` jumps where `a/m` is an integer, and the float
 * of an exact operand near such a point can be on its other side: at 21
 * digits, the float of `(25! − 1)/24!` is `25`, so `Mod` of it by `1` was
 * `0`, but its exact value is `1 − 1/24!`. So the exact values of both
 * operands are used when both are known. An exact literal is always used,
 * because this costs nothing. An expression is evaluated again, exactly,
 * only when `a/m` is near an integer and the expression is pure
 * (`exactRealValueOf()`).
 *
 * The result is the exact remainder approximated. When `a` or `m` is a
 * float, an integer result is boxed as a float, as the numeric result is:
 * the form of the result must not depend on which of the two ways computed
 * it.
 */
function exactModUnderN(
  a: Expression,
  m: Expression,
  expression: Expression | undefined
): Expression | undefined {
  const ce = a.engine;
  const near =
    isNumber(a) &&
    isNumber(m) &&
    !a.isComplex &&
    !m.isComplex &&
    a.isFinite === true &&
    m.isFinite === true &&
    m.re !== 0 &&
    isNearRoundingJumpValue(ce, a.re / m.re, false);
  const exactOf = (x: Expression, index: number): Expression | undefined => {
    if (isExactRealLiteral(x)) return x;
    const original = originalOperand(expression, index);
    if (original === undefined) return undefined;
    if (isNumber(original) || near) return exactRealValueOf(original);
    return undefined;
  };
  // An exact constant expression that is not a number (`π·10³⁰`) has no
  // exact number value: `Mod(a, m) = a − m·k` is built with `k` decided
  // from enclosures (`exactConstantModulo()`), and its value is computed at
  // a raised precision (`exactConstantValue()`), because at the working
  // precision `a` and `m·k` cancel. This is done at any distance from a
  // jump, since the floats of such operands can be wrong by more than that
  // distance. A value of `a/m` that is at an integer at the precision limit
  // (with a narrow enclosure) gives 0. When the value is not known, the
  // steps below and the float decide.
  const oa = originalOperand(expression, 0);
  const om = originalOperand(expression, 1);
  const modulo =
    oa === undefined || om === undefined
      ? undefined
      : exactConstantModulo(oa, om, true);
  if (modulo !== undefined) {
    if (isNumber(modulo)) return modulo.N();
    const value = exactConstantValue(modulo);
    if (value !== undefined) return ce.number(ce._numericValue(value));
  }
  const ea = exactOf(a, 0);
  if (ea === undefined) return undefined;
  const em = exactOf(m, 1);
  if (em === undefined || em.isSame(0)) return undefined;
  const k = roundExactReal(ce.function('Divide', [ea, em]).evaluate(), 'floor');
  if (k === undefined) return undefined;
  const exact = ce
    .function('Add', [ea, ce.function('Multiply', [ce.number(-k), em])])
    .evaluate();
  if (!isExactRealLiteral(exact)) return undefined;
  const fromFloat = (isNumber(a) && !a.isExact) || (isNumber(m) && !m.isExact);
  const n = exact.isInteger ? roundExactReal(exact, 'floor') : undefined;
  if (fromFloat && n !== undefined)
    return ce.number(ce._numericValue(new BigDecimal(n.toString())));
  return exact.N();
}

/**
 * `Mod(a, m)` as the exact expression `a − m·k`, where `k = ⌊a/m⌋`, when
 * `a` and `m` are exact (an exact real number or an exact constant
 * expression, see `isExactConstantExpression()`) and at least one of them
 * is an exact constant expression that is not a number. `undefined` when
 * `k` is not decided (`a/m` is exactly an integer that the enclosures of
 * `roundExactConstant()` do not separate from its neighbours), or when the
 * operands are not of that kind.
 *
 * With `atJumpAtLimit` (under `.N()`), `k` is decided at the precision
 * limit too: see `roundExactConstant()`.
 *
 * The result is canonical, not evaluated: the caller evaluates it, or
 * computes its value.
 */
function exactConstantModulo(
  a: Expression,
  m: Expression,
  atJumpAtLimit = false
): Expression | undefined {
  const isExact = (x: Expression) =>
    isExactRealLiteral(x) || isExactConstantExpression(x);
  if (!isExact(a) || !isExact(m)) return undefined;
  if (isExactRealLiteral(a) && isExactRealLiteral(m)) return undefined;
  if (m.isSame(0)) return undefined;
  const ce = a.engine;
  const q = ce.function('Divide', [a, m]);
  const k = isExactRealLiteral(q)
    ? roundExactReal(q, 'floor')
    : roundExactConstant(q, 'floor', atJumpAtLimit);
  if (k === undefined) return undefined;
  return ce.function('Subtract', [
    a,
    ce.function('Multiply', [ce.number(k), m]),
  ]);
}

/**
 * Under `.N()`, the value of `Power(b, k)` for an exact base `b` (an exact
 * real number or an exact constant expression, see
 * `isExactConstantExpression()`) and an exact integer `k` with `|k| ≥ 10`,
 * or `undefined` for other operands.
 *
 * A relative error `ε` of the base becomes about `|k|·ε` in `b^k`, so the
 * base is approximated with `⌈log10 |k|⌉ + 2` more digits than the working
 * precision, the power is computed at that precision, and the result is
 * rounded to the working precision. Mathematica: `N[Pi^1000000, 25]` is
 * `7.459232324491447863494856…·10^497149`; with the base at 21 digits, the
 * digits after the 17th were wrong.
 *
 * `expression` is the `Power` expression before its operands were
 * approximated (the operands that the handler receives are floats).
 */
function exactBaseIntegerPower(
  expression: Expression | undefined
): Expression | undefined {
  if (expression === undefined || !isFunction(expression)) return undefined;
  const [b, k] = expression.ops;
  if (b === undefined || k === undefined) return undefined;
  if (!isNumber(k) || !k.isExact || k.isInteger !== true) return undefined;
  const n = Math.abs(k.re);
  if (!(n >= 10) || !Number.isFinite(n)) return undefined;
  // An integer base (`2^100`, `3^1000000`) is raised to the power exactly
  // by `pow()` before the result is approximated: it is not handled here.
  // A rational base is: its float has the error of the working precision
  // (`(1/3)^1000000` had only 15 correct digits).
  if (isNumber(b) && b.isInteger === true) return undefined;
  if (!isExactRealLiteral(b) && !isExactConstantExpression(b)) return undefined;
  const ce = expression.engine;
  const working = ce.precision;
  const digits = working + Math.ceil(Math.log10(n)) + 2;
  const value = ce._withTransientPrecision(digits, () => {
    // `pow()` directly, not a `Power` expression: its `.N()` would call
    // this function again for an exact integer base (`10^-30`).
    const r = pow(b.N(), k, { numericApproximation: true });
    if (!isNumber(r) || r.isComplex || r.isFinite !== true) return undefined;
    return r.bignumRe;
  });
  if (value === undefined) return undefined;
  // At machine precision, the value is converted to a double directly:
  // rounding it first to the 15 digits of `ce.precision` made the result
  // less accurate than the double of the base raised to the power.
  if (working <= MACHINE_PRECISION) return ce.number(value.toNumber());
  return ce.number(ce._numericValue(value.toPrecision(working)));
}

/** The operand at `index` of the expression that an `evaluate` handler
 * receives in its options, before the operands were evaluated. */
function originalOperand(
  expression: Expression | undefined,
  index: number
): Expression | undefined {
  if (expression === undefined || !isFunction(expression)) return undefined;
  return expression.ops[index];
}

/**
 * Whether `x` is in the relation `rel` with `k`, for the `sgn` handlers of
 * the rounding functions: `true`, `false`, or `undefined` when it is not
 * known.
 *
 * For an operand with no unknowns the order is exact (`exactOrder()`). The
 * predicates `isLess()` and `isGreaterEqual()` compare two exact numbers
 * exactly, but a constant that is not an exact number (`π − 3`) within the
 * engine tolerance: with a tolerance, a value within `10⁻¹⁰` of `1/2` is
 * equal to `1/2`, and the sign of its `Round` can be wrong. For an operand
 * with unknowns (a symbol with assumed bounds), or when the exact order is
 * not known, the predicates are used.
 */
function isOrdered(
  x: Expression,
  rel: '<' | '<=' | '>' | '>=',
  k: Expression
): boolean | undefined {
  if (x.unknowns.length === 0) {
    const order = exactOrder(x, k);
    if (order !== undefined) {
      if (rel === '<') return order < 0;
      if (rel === '<=') return order <= 0;
      if (rel === '>') return order > 0;
      return order >= 0;
    }
  }
  if (rel === '<') return x.isLess(k);
  if (rel === '<=') return x.isLessEqual(k);
  if (rel === '>') return x.isGreater(k);
  return x.isGreaterEqual(k);
}

/**
 * Rounds a real number to an integer with `fn` (machine lane) or `bigFn`
 * (big-decimal lane), and boxes a finite result as an EXACT integer, also
 * when the argument is a float.
 *
 * The rounding family (`Round`, `Floor`, `Ceil`, `Truncate`) is an exception
 * to the rule that a float operand makes a numeric result a float: as in
 * Mathematica, `Floor(2.7)` is the integer `2`, not the float `2.0`. The
 * integer that a rounding function returns is exact even when its argument
 * is not, because there is no rounding error left to carry. The precision
 * form `Round(x, n)` builds on this: it divides the exact integer by the
 * exact `10ⁿ`, so `Round(3.14159, 2)` is the exact rational `157/50`.
 *
 * `apply()` boxes the result of a float argument as a float; this function
 * re-boxes it. A machine integer beyond the safe-integer range is still an
 * integer (a double of that size has no fractional part), so it is boxed
 * from a `bigint` and keeps all its digits. The non-finite results (`±∞`,
 * `NaN`) are returned unchanged. Under a numeric approximation (`.N()`)
 * the result stays a float: `Round(3.14159, 2).N()` is the float `3.14`.
 *
 * An EXACT real argument (a rational, or a rational times a square root)
 * does not go through `apply()`: `roundExactReal()` rounds it with `bigint`
 * arithmetic, because `apply()` sees only a double or a big decimal rounded
 * to the working precision (cortex-js/compute-engine#382).
 *
 * Reported in cortex-js/compute-engine#351.
 */
function applyRounding(
  x: Expression,
  mode: RoundingMode,
  fn: (x: number) => number,
  bigFn: (x: BigDecimal) => BigDecimal,
  numericApproximation: boolean | undefined,
  original?: Expression
): Expression | undefined {
  // Under `.N()`, an operand whose exact value is known is rounded exactly
  // too (`exactRoundingOperand()`). The integer is then boxed as a float, as
  // the result of `.N()` is when the operand is approximated: the form of the
  // result must not depend on which of the two ways computed it.
  const exactOperand = numericApproximation
    ? exactRoundingOperand(x, mode, original)
    : x;
  if (exactOperand !== undefined) {
    const exact = roundExactReal(exactOperand, mode);
    if (exact !== undefined) {
      const ce = x.engine;
      if (!numericApproximation) return ce.number(exact);
      return ce.number(ce._numericValue(new BigDecimal(exact.toString())));
    }
  }
  // An exact constant expression that is not a number (`π·10³⁰`) is rounded
  // from enclosures of its value (`roundExactConstant()`). Without `.N()`,
  // `x` is that expression. Under `.N()`, `x` is its float, which can be
  // wrong by much more than the distance to a jump when its terms cancel
  // (`√(10⁶⁰ + 10⁴⁰) − 10³⁰` is `10¹⁰` at 21 digits, and its floor is
  // `4999999999`), so the original operand is always used. The first
  // enclosure decides a value that is not near a jump. When the result is
  // not decided at the precision limit, it stays unevaluated without
  // `.N()`, and under `.N()` the value is taken to be at the jump.
  const constant = numericApproximation ? original : x;
  if (constant !== undefined) {
    const exact = roundExactConstant(constant, mode, numericApproximation);
    if (exact !== undefined) {
      const ce = x.engine;
      if (!numericApproximation) return ce.number(exact);
      return ce.number(ce._numericValue(new BigDecimal(exact.toString())));
    }
  }
  const result = apply(x, fn, bigFn);
  if (numericApproximation) return result;
  if (result === undefined || !isNumber(result) || result.isExact)
    return result;
  if (result.isFinite !== true || result.isComplex) return result;
  const ce = x.engine;
  const big = result.bignumRe;
  if (big !== undefined) {
    if (!big.isInteger()) return result;
    return ce.number(big.toBigInt());
  }
  const re = result.re;
  if (!Number.isInteger(re)) return result;
  // `Math.ceil(-0.3)` is `-0`; the exact integer zero has no sign.
  if (Number.isSafeInteger(re)) return ce.number(re === 0 ? 0 : re);
  return ce.number(BigInt(re));
}

/**
 * Determines sgn of ln(x).
 *
 * `x` is compared with 1 and 0 with no tolerance (see `exactOrder`): with
 * the engine tolerance, `1 − 10⁻³⁰` was equal to 1, so `ln(1 − 10⁻³⁰)` was
 * non-negative and `|ln(1 − 10⁻³⁰)|` evaluated to the negative
 * `ln(1 − 10⁻³⁰)`. A weak relation (`x ≥ 1`, from an assumption) gives a
 * weak sign.
 */
function lnSign(x: Expression): Sign | undefined {
  const ce = x.engine;
  // The relation of `x` to `y`, from both operand orders: some branches of
  // `cmp` decide only one of them.
  const relation = (y: Expression) => {
    const r = cmp(x, y, 0);
    if (r !== undefined) return r;
    const s = cmp(y, x, 0);
    if (s === '<') return '>';
    if (s === '>') return '<';
    if (s === '<=') return '>=';
    if (s === '>=') return '<=';
    return s;
  };
  const one = relation(ce.One);
  if (one === '>') return 'positive';
  if (one === '=') return 'zero';
  if (one === '>=') return 'non-negative';
  if (one === '<' || one === '<=') {
    const zero = relation(ce.Zero);
    if (one === '<' && zero === '>') return 'negative';
    if (zero === '>' || zero === '>=' || zero === '=') return 'non-positive';
  }
  if (x.isNegative || x.isExtendedReal === false) return 'unsigned';
  return undefined;
}

/**
 * Whether `(negative base)^exp` provably takes the principal *complex* branch
 * rather than a real root.
 *
 * Mirrors the branch convention implemented in
 * `boxed-expression/arithmetic-power.ts`: for a negative real base an exponent
 * that is a rational `p/q` in lowest terms with an **odd** denominator takes
 * the real root — `(−8)^(2/3) = 4`, matching `Root(−8, 3) = −2` — while an
 * **even** denominator takes the principal complex value
 * (`(−2)^0.3 = 0.7236… + 0.9960…i`).
 *
 * Returns `true` only when the complex branch is PROVABLE. An exponent whose
 * value cannot be pinned down at all (a symbol, or anything without a finite
 * real value) returns `false`, so the caller keeps its honest `number`
 * hedge rather than over-claiming complex.
 */
function negativeBaseIsComplexBranch(exp: OperandDescriptor): boolean {
  // Membership must be PROVEN either way: an operand whose type decides
  // neither real-ness nor integrality is no proof of the branch.
  if (!isExtendedRealOperand(exp)) return false;

  // The exponent's exact reduced terms, when it is a number literal holding
  // a rational: the structural view carries them because a literal's
  // handler-visible type does not (`66052794534767279/18014398509481986`
  // types `rational<3.6..3.7>`, whose denominator parity is unrecoverable).
  const structure = exp.structureOf?.();
  const literal = structure?.kind === 'number' ? structure : undefined;
  const exact = literal?.rational;
  // A LITERAL's integrality is settled by those terms: `asRational` — the
  // channel that fills them — answers for every exact rational and for
  // every machine float that is a whole number, so a literal with no terms
  // at all is not an integer. Everything else (a symbol, a compound) is
  // decided by the type, where an undecided answer hedges.
  const notInteger =
    literal !== undefined
      ? exact === undefined || exact[1] !== 1n
      : typeFact(exp.type, 'integer') === false;
  if (!notInteger) return false;

  // The exponent's exact (reduced) denominator when it has one, otherwise the
  // float reconstruction — `realPowerBranchTerms` is the single source of the
  // branch decision, shared with the numeric path and the compiled constant
  // fold so type, `.N()` and compiled code cannot tell different stories.
  // A literal exponent's value also travels in its handler-visible type
  // (`operandLiteralValue`), which is the channel that carries a float.
  const re = operandLiteralValueOnTypes(exp);
  const terms = realPowerBranchTerms(
    exact === undefined ? undefined : [exact[0], exact[1]],
    re ?? NaN
  );
  // No trustworthy rational is a PROOF of the complex branch, not an absence of
  // information — but only once the exponent has a definite value. A known
  // real non-integer with a finite value that is not an odd-denominator
  // rational takes the principal complex value, which is exactly what `.N()`
  // returns; reading `undefined` as "unknown" here made the type disagree with
  // the value (`(−2)^0.3333333333` typed `number`, and the compiler
  // lowered it to a real `Math.pow` that yields NaN). An exponent with no
  // finite value — `Ln(2)`, a free symbol — still hedges.
  //
  // A finite real number LITERAL that carries neither exact terms nor a
  // machine value is an irrational algebraic number — a radical such as
  // `√2`, whose type is a rounded range. It is not an odd-denominator
  // rational, so it takes the principal complex value too.
  if (terms === undefined) {
    if (re !== undefined) return Number.isFinite(re);
    return literal !== undefined && exp.facts.finite === true;
  }
  return terms[1] % 2 === 0;
}

/**
 * The component tier of a shaped quotient: the type of `el / den`, where `el`
 * is one component TYPE of a tuple- or collection-shaped `Divide` numerator
 * and `den` is the denominator expression.
 *
 * Mirrors the scalar branches of the `Divide` type handler exactly, including
 * their ratified possibly-zero-denominator convention (an unproven-nonzero
 * denominator still claims a finite tier; only a literal 0 yields the top
 * type — see the "Possibly-zero *denominators*" note in the handler), so a
 * component of a shaped numerator and a standalone scalar of the same tier
 * always type their quotients identically. The divergence shaped numerators
 * used to have — echoing the component type verbatim, so
 * `tuple<integer, integer> / integer` claimed INTEGER
 * components where `[6,2]/4 = [3/2,1/2]` is rational — is exactly what this
 * widening removes.
 */
function quotientComponentType(el: Type, den: OperandDescriptor): Type {
  // The handler checks the NaN and zero guards before its shape branches only
  // for the NUMERATOR side; re-check the denominator here so the
  // helper's per-component parity with the scalar path does not depend on
  // call order.
  if (provablyNaNOperand(den) || operandLiteralValueOnTypes(den) === 0)
    return 'number';
  if (operandNonFiniteNumberOnTypes(den)) {
    // The scalar path's symmetric claim: a provably finite real component
    // over a provably non-finite REAL denominator is exactly 0.
    if (factsOf(el).real && isExtendedRealOperand(den)) return 'integer';
    return 'number';
  }
  if (factsOf(den.type).integer && factsOf(el).integer) return 'rational';
  if (isExtendedRealOperand(den) && factsOf(el).real) return 'real';
  if (factsOf(den.type).complex && factsOf(el).complex) return 'complex';
  return 'number';
}

/**
 * Map a shaped `Divide`-numerator TYPE — a tuple, a (possibly dimensioned)
 * list/collection, or a union of shapes — to the quotient's type: the same
 * structure with every numeric component widened through
 * `quotientComponentType`. A scalar (a non-shape union arm such as the
 * `number` in `tuple | number`) widens as a single component; a bare kind
 * string (`'tuple'`, `'list'`) carries no component types to widen and passes
 * through unchanged.
 *
 * A TRANSPARENT alias reference is unfolded first: it IS its definition, so a
 * numerator declared with an alias of a tuple must widen component-wise like
 * the tuple it names instead of falling through to the scalar widening. The
 * alias NAME is not preserved in the result because the components change
 * (`tuple<integer, integer> / 4` is a tuple of rationals, which the alias no
 * longer describes). A NOMINAL reference never reaches here: it is refused by
 * the operand gate upstream.
 */
function quotientShapeType(t: Type, den: OperandDescriptor): Type {
  t = resolveTypeAlias(t);
  if (typeof t === 'string') {
    if (
      t === 'tuple' ||
      t === 'list' ||
      t === 'collection' ||
      t === 'indexed_collection'
    )
      return t;
    return quotientComponentType(t, den);
  }
  if (t.kind === 'union')
    return {
      kind: 'union',
      types: t.types.map((a) => quotientShapeType(a, den)),
    };
  if (t.kind === 'tuple')
    return {
      kind: 'tuple',
      elements: t.elements.map((e) => ({
        ...e,
        type: quotientComponentType(e.type, den),
      })),
    };
  if (
    t.kind === 'list' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection'
  )
    // Recurse (not `quotientComponentType`): a matrix is a list of lists, and
    // its inner rows must widen structurally too. Dimensions are preserved by
    // the spread.
    return { ...t, elements: quotientShapeType(t.elements, den) };
  return quotientComponentType(t, den);
}

/**
 * The ELEMENT type of a list/indexed-collection/collection-kind type, or
 * `undefined` when the type carries none — a bare kind name (`'list'`), a
 * tuple, a set, or a scalar. Used by the `Multiply` type handler to tell a
 * collection of scalars (which scales a paired point list element-wise) from
 * one whose elements are themselves shaped.
 */
function collectionElementTypeOf(t: Type): Type | undefined {
  if (typeof t === 'string') return undefined;
  if (
    t.kind === 'list' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'collection'
  )
    return t.elements;
  return undefined;
}

/**
 * True when `den` can stand as the divisor of a SHAPE-PRESERVING quotient —
 * one whose numerator's tuple structure survives because every division it
 * performs is `tuple / scalar`.
 *
 * Rejected, in each case because the divisor can present a TUPLE where a
 * scalar is required and a point has no reciprocal (`canonicalDivide` answers
 * `no-division-by-point`):
 * - a tuple itself;
 * - a `broadcastable<tuple<…>>`, whose runtime value MAY be that tuple;
 * - a collection of tuples, which pairs elementwise into `tuple / tuple`
 *   (`[(3,4),(6,8)] / [(1,2),(2,2)]` evaluates to a list of
 *   `no-division-by-point` errors).
 *
 * A MATRIX divisor is rejected for a different reason: the value path leaves
 * `p / M` inert (`(3, 4) / [1,2]`) rather than distributing it, so no
 * component-wise claim about the result holds.
 *
 * Admitted: a scalar, and a collection of scalars — dimensionless
 * (`list<number>`) or `vector<n>`, which a literal list such as `[5, 10]`
 * types as — since each divides one point by one scalar.
 */
function divisorKeepsNumeratorShape(den: OperandDescriptor): boolean {
  const dt = den.type;
  if (typeCouldBeNumericTuple(dt)) return false;
  if (typeCouldBeNumericTupleCollection(dt)) return false;
  if (
    typeof dt !== 'string' &&
    dt.kind === 'broadcastable' &&
    typeCouldBeNumericTuple(dt.elements)
  )
    return false;
  return !factsOf(dt).matrix;
}

/**
 * True when an evaluated `Add`/`Multiply` operand is a collection that is NOT
 * a tuple: a list, a set, a range, or a symbol declared with such a type and
 * not yet valued. Such an operand makes the application a broadcast over its
 * cells, which the collection kernels (`addTensors`, `mulTensors`, the
 * packing demotion) own; the whole-point absence arm in the `Add` and
 * `Multiply` handlers stands aside for it. A tuple is atomic under both
 * operators, so it is excluded here. Read as the type, not only as the
 * `isCollection` capability, for the reason `hasAbsentScalarOperand` gives.
 */
function isNonTupleCollectionOperand(x: Expression): boolean {
  if (isTuple(x)) return false;
  return x.isCollection || x.type.matches('collection<any>');
}

/**
 * The tuple shape a point operand contributes to one CELL of a broadcast:
 * the type itself for a tuple, and for a union the join of every tuple it
 * may hold — its tuple arms, and the tuple shape inside each dimensionless
 * collection arm (`tuple<integer, integer> | list<tuple<real, real>>` gives
 * `tuple<real, real>`; the mixed arm `indexed_collection<number | tuple<…>>`
 * contributes its element's tuple). A collection arm's own list rank is
 * left out on purpose: the broadcast re-adds it. The caller has established
 * `typeCouldBeNumericTuple`, so at least one tuple arm exists.
 */
function numericTupleArms(t0: Type): Type {
  const t = resolveTypeAlias(t0);
  if (typeof t === 'string' || t.kind !== 'union') return t as Type;
  const arms: Type[] = [];
  for (const arm of t.types) {
    if (typeCouldBeNumericTuple(arm)) {
      arms.push(numericTupleArms(arm));
      continue;
    }
    const element = dimensionlessIndexedElementType(arm);
    if (element !== undefined && typeCouldBeNumericTuple(element))
      arms.push(numericTupleArms(element));
  }
  return widen(...arms);
}

/**
 * The type of a numeric tuple scaled by scalar factors: each NUMERIC component
 * widened by the factors' types (`tuple<integer, integer>`
 * times a `number` is `tuple<number, number>`), arity preserved. A component
 * that is not provably numeric — an `unknown` component such as
 * `(S(x,y,0), S(x,y,1))` with `S: (…) -> unknown` — is left as written: the
 * tuple must stay a tuple (its scalar product is still a point, Tycho item
 * 30), and widening `unknown` would only dissolve it into `any`.
 */
function scaleTupleComponents(
  t: Readonly<Type>,
  scalarTypes: ReadonlyArray<Type>
): Type {
  // A transparent alias of a tuple is scaled like the tuple it names, and
  // the result is that tuple, not the alias name: `0.5 · p` for `p: ipt` (an
  // alias of `tuple<integer, integer>`) has real components, which `ipt` no
  // longer describes (the alias policy of the broadcast lift).
  t = resolveTypeAlias(t);
  if (scalarTypes.length === 0) return t as Type;
  // A plain numeric arm inside a scaled union (a symbol declared
  // `number | tuple<…>`, or the `number` element of the mixed
  // `indexed_collection<number | tuple<…>>` arm) is a number the factors
  // multiply, so it widens like a tuple component does; anything else that
  // is not a tuple, a union or a collection (`unknown`, a string, the bare
  // `tuple`) is left as written.
  if (typeof t === 'string')
    return factsOf(t).belowNumber
      ? (widen(t, ...scalarTypes.map((x) => stripNumericRanges(x))) as Type)
      : (t as Type);
  // A point-or-point-list union (`tuple<…> | list<tuple<…>>`) scales arm by
  // arm: the tuple arm as a tuple, a list or indexed-collection arm of
  // tuples as that collection of the scaled tuple. Any other arm — a plain
  // number, a collection of numbers — is left as written.
  if (t.kind === 'union')
    return {
      kind: 'union',
      types: t.types.map((arm) => scaleTupleComponents(arm, scalarTypes)),
    };
  // A collection arm scales its element, whatever shape it has: a tuple
  // element as a tuple, a union element (the mixed
  // `indexed_collection<number | tuple<…>>` arm) arm by arm.
  if (t.kind === 'list' || t.kind === 'indexed_collection')
    return { ...t, elements: scaleTupleComponents(t.elements, scalarTypes) };
  if (t.kind !== 'tuple')
    return factsOf(t).belowNumber
      ? (widen(
          stripNumericRanges(t),
          ...scalarTypes.map((x) => stripNumericRanges(x))
        ) as Type)
      : (t as Type);
  // Range decorations are stripped on BOTH sides of the join: a scaled
  // component does not lie in the union of the component's and the
  // factors' ranges (see `stripNumericRanges`).
  const factors = scalarTypes.map((x) => stripNumericRanges(x));
  return {
    kind: 'tuple',
    elements: t.elements.map((e) =>
      factsOf(e.type).belowNumber
        ? { ...e, type: widen(stripNumericRanges(e.type), ...factors) as Type }
        : e
    ),
  };
}

/**
 * The type `t` without its `nan` arm, when `t` is a union of `nan` with
 * numeric types (`nan | real`); `undefined` for any other type.
 */
function withoutNanArm(t0: Type): Type | undefined {
  const t = resolveTypeAlias(t0);
  if (typeof t !== 'object' || t.kind !== 'union' || !t.types.includes('nan'))
    return undefined;
  const rest = t.types.filter((x) => x !== 'nan');
  if (rest.length === 0 || !rest.every((x) => isSubtype(x, 'number')))
    return undefined;
  return rest.length === 1 ? rest[0] : { kind: 'union', types: rest };
}

/**
 * Is this operand PROVABLY the NaN marker? The descriptor twin of
 * `Expression.isNaN === true`.
 *
 * A function APPLICATION answers `false` unconditionally, which is what
 * `isNaN` answers for one: a compound's NaN-ness is settled by evaluating
 * it, and its result type is deliberately optimistic — a head that is
 * finite at a generic point claims a finite result even where some operand
 * makes it NaN. Reading a `nan` RESULT type as a proof here would make a
 * quotient or a power decline where the expression shape claimed a type,
 * which is a behavior change and not this conversion's to make.
 *
 * For a literal, a symbol and a type-only descriptor, the type decides it
 * outright when it is the `nan` singleton and refutes it when it is below
 * `infinity` (the infinite-magnitude values, `~oo` included) — those two
 * types are disjoint. What is left is an operand whose non-finiteness comes
 * from a held VALUE behind a wider declaration (`w: number := NaN`): the
 * descriptor records that as `finite === false` with an `unsigned` sign,
 * which is also what a held `~oo` records, so the two are indistinguishable
 * here and a held `~oo` is read as possibly-NaN. Every caller uses this to
 * widen or to decline, so the conflation costs precision, never soundness.
 */
function provablyNaNOperand(d: OperandDescriptor): boolean {
  // Fast path: an operand whose type is below `complex` is a finite number,
  // so it is not NaN — and this answers for nearly every operand of an
  // arithmetic derivation with one subtype test, before the structure view
  // below is built. The empty type is excluded: it is below every type, and
  // the general path answers `true` for it.
  const t = d.type;
  const f = factsOf(t);
  if (!isEmptyType(t) && f.complex) return false;
  const kind = d.structureOf?.()?.kind;
  if (
    kind === 'application' ||
    kind === 'tuple' ||
    kind === 'list-literal' ||
    kind === 'function-literal'
  )
    return false;
  if (f.nan) return true;
  if (f.infinity) return false;
  return d.facts.finite === false && d.facts.sgn === 'unsigned';
}

/**
 * Is this operand on the EXTENDED real line — the finite reals together
 * with `+∞` and `−∞`? The descriptor twin of
 * `Expression.isExtendedReal === true`.
 */
function isExtendedRealOperand(d: OperandDescriptor): boolean {
  // `real` first: it is a primitive, so the test is a lattice lookup, and
  // it answers for nearly every operand; the union `real | +oo | -oo` is
  // consulted only for a type that is not below `real`.
  return factsOf(d.type).extendedReal;
}

/**
 * Replace each numeric cell of a product type by `cellOf(cell)`: the
 * elements of a `list` or `indexed_collection` (recursively, for a nested
 * list), the components of a `tuple`, and each member of a union of such
 * types. `undefined` when a cell is not numeric or `cellOf` declines.
 */
function mapProductCells(
  t0: Type,
  cellOf: (cell: Type) => Type | undefined
): Type | undefined {
  const t = resolveTypeAlias(t0);
  if (isSubtype(t, 'number')) return cellOf(t);
  if (typeof t !== 'object') return undefined;
  if (t.kind === 'list' || t.kind === 'indexed_collection') {
    const elements = mapProductCells(t.elements, cellOf);
    return elements === undefined ? undefined : { ...t, elements };
  }
  if (t.kind === 'tuple') {
    const elements = t.elements.map((e) => {
      const type = mapProductCells(e.type, cellOf);
      return type === undefined ? undefined : { ...e, type };
    });
    return elements.some((e) => e === undefined)
      ? undefined
      : { ...t, elements: elements as typeof t.elements };
  }
  if (t.kind === 'union') {
    const types = t.types.map((x) => mapProductCells(x, cellOf));
    return types.some((x) => x === undefined)
      ? undefined
      : reduceType({ kind: 'union', types: types as Type[] });
  }
  return undefined;
}

/**
 * Add the `nan` arm to the type of `base^exp` when the power may be the
 * indeterminate form `0^0`, which evaluates to NaN: the base may be 0 and
 * the exponent may be 0. `x^n` with `x: real` and `n: integer<0..>` was
 * typed `real`, although `x = 0, n = 0` gives NaN. The claim is unchanged
 * when an operand is not an extended real, when the type already admits
 * NaN, or when it is `number`.
 */
function withZeroToZeroNaN(
  ops: ReadonlyArray<OperandDescriptor>,
  context: {
    engine: { _typeResolver: Parameters<typeof BoxedType.forResult>[1] };
  },
  claim: BoxedType | undefined
): BoxedType | undefined {
  if (claim === undefined || ops.length !== 2) return claim;
  const [base, exp] = ops;
  if (!isExtendedRealOperand(base) || !isExtendedRealOperand(exp)) return claim;
  const mayBeZero = (d: OperandDescriptor): boolean => {
    if (provablyNonZeroSign(d)) return false;
    const range = intervalOfType(d.type);
    return range === undefined || (range.lo <= 0 && range.hi >= 0);
  };
  if (!mayBeZero(base) || !mayBeZero(exp)) return claim;
  const t = claim.type;
  if (t === 'number' || !isSubtype(t, 'number') || isSubtype('nan', t))
    return claim;
  return BoxedType.forResult(
    reduceType({ kind: 'union', types: [t, 'nan'] }),
    context.engine._typeResolver
  );
}

/**
 * Can `base^exp` be the pole `0^−k = ~oo`? True when the base may be 0 (its
 * sign does not prove it non-zero and its interval, when known, contains 0)
 * and the exponent may be negative.
 */
function powerMayBePole(
  base: OperandDescriptor,
  expSgn: ReturnType<typeof operandSgnOnTypes>
): boolean {
  if (nonNegativeSign(expSgn) === true) return false;
  if (provablyNonZeroSign(base)) return false;
  const range = intervalOfType(base.type);
  return range === undefined || (range.lo <= 0 && range.hi >= 0);
}

/**
 * The type of `base^exp` when both are on the extended real line and at
 * least one of them is not provably finite (`y: real | signed_infinity`,
 * `Ln(0)`). A power of extended reals whose base is non-negative, or whose
 * exponent is an integer, is an extended real, zero, or NaN, never a complex
 * value, so it is typed without `number` (user decision 2026-09-25: a host
 * reads `number` as possibly complex). The finite part of the type is the
 * type of the same power with each operand restricted to its finite values,
 * typed by this handler. Then:
 * - `+oo` is added (`∞²`, `2^∞`);
 * - `-oo` is added unless the base is non-negative or the exponent is even
 *   (`(−∞)³ = −∞`);
 * - `0` is added when the exponent may be infinite (`2^−∞ = 0`), or when the
 *   base may be infinite and the exponent may be negative (`∞^−1 = 0`);
 * - `infinity` is added when the base may be 0 and the exponent may be
 *   negative: `0^−1` and `0^−∞` are the complex infinity `~oo`;
 * - `nan` is added when the exponent may be infinite and the base may be 1
 *   (`1^∞`), or when the base may be infinite and the exponent may be zero
 *   (`∞^0`).
 * `undefined` (the caller's own claim applies) when an operand is not an
 * extended real, when both are finite, or when the power may be complex: a
 * possibly negative base with an exponent that may be infinite, or with a
 * non-integer exponent when the base may be infinite (`(−∞)^½ = ~oo`).
 */
function extendedPowerType(
  base: OperandDescriptor,
  exp: OperandDescriptor,
  baseSgn: ReturnType<typeof operandSgnOnTypes>,
  expSgn: ReturnType<typeof operandSgnOnTypes>,
  context: { derive: (h: string, a: OperandDescriptor[]) => Type | undefined }
): Type | undefined {
  // An operand with a `nan` arm (`real | signed_infinity | nan`): the power
  // is NaN when that operand is NaN, and otherwise the power of the present
  // values, so it is typed without the arm, which is added back.
  const baseNaN = withoutNanArm(base.type);
  const expNaN = withoutNanArm(exp.type);
  if (baseNaN !== undefined || expNaN !== undefined) {
    const b = baseNaN === undefined ? base : describeType(baseNaN);
    const e = expNaN === undefined ? exp : describeType(expNaN);
    if (!isExtendedRealOperand(b) || !isExtendedRealOperand(e))
      return undefined;
    const t = extendedPowerType(
      b,
      e,
      operandSgnOnTypes(b),
      operandSgnOnTypes(e),
      context
    );
    // Both present operands finite (`n²` with `n: nan | real`): the power of
    // the present values, as the rest of this handler types it.
    const present = t ?? context.derive('Power', [b, e]);
    return present === undefined ||
      present === 'number' ||
      !isSubtype(present, 'number')
      ? undefined
      : reduceType({ kind: 'union', types: [present, 'nan'] });
  }
  if (!isExtendedRealOperand(base) || !isExtendedRealOperand(exp))
    return undefined;
  const baseInf = !isSubtype(base.type, 'real');
  const expInf = !isSubtype(exp.type, 'real');
  if (!baseInf && !expInf) return undefined;
  const nonNegativeBase = nonNegativeSign(baseSgn) === true;
  const finiteBase = finiteExtendedPart(base.type);
  const finiteExp = finiteExtendedPart(exp.type);
  const integerExp = finiteExp !== undefined && factsOf(finiteExp).integer;
  if (expInf && !nonNegativeBase) return undefined;
  if (baseInf && !integerExp && !nonNegativeBase) return undefined;
  const types: Type[] = [{ kind: 'value', value: Infinity }];
  let finite: Type | undefined;
  if (finiteBase !== undefined && finiteExp !== undefined) {
    finite = context.derive('Power', [
      baseInf ? describeType(finiteBase) : base,
      expInf ? describeType(finiteExp) : exp,
    ]);
    if (finite === undefined || !isSubtype(finite, 'number')) return undefined;
  }
  if (!nonNegativeBase && operandParityIsEven(exp) !== true)
    types.push({ kind: 'value', value: -Infinity });
  // The zero arm. A value type `0` would be widened to `integer` by the
  // result boxing, which drops the sign of a non-negative finite part, so
  // `e^y` would lose `real<0..>`: a non-negative finite part is widened to
  // `real<0..>` instead.
  const zero: Type = { kind: 'value', value: 0 };
  if (
    (expInf || (baseInf && positiveSign(expSgn) !== true)) &&
    (finite === undefined || !isSubtype(zero, finite))
  ) {
    if (finite !== undefined && isSubtype(finite, nonNegativeRangeType('real')))
      finite = nonNegativeRangeType('real');
    else types.push(zero);
  }
  if (finite !== undefined) types.push(finite);
  // `0^−1` and `0^−∞` are the complex infinity `~oo`, which only `infinity`
  // admits: a base that may be 0 with an exponent that may be negative.
  if (powerMayBePole(base, expSgn)) types.push('infinity');
  // `1^∞` is NaN: the base may be 1 unless its interval excludes 1.
  const bIv = baseInf ? undefined : intervalOfType(base.type);
  const baseMayBeOne = bIv === undefined || (bIv.lo <= 1 && bIv.hi >= 1);
  if ((expInf && baseMayBeOne) || (baseInf && !provablyNonZeroSign(exp)))
    types.push('nan');
  return reduceType({ kind: 'union', types });
}

/** Is this operand's sign a proof that it is not zero? */
function provablyNonZeroSign(d: OperandDescriptor): boolean {
  const s = operandSgnOnTypes(d);
  return s === 'positive' || s === 'negative' || s === 'not-zero';
}

/**
 * The machine value the operand's handler-visible TYPE carries: a value
 * type's value, or a singleton numeric range's bound. Unlike
 * `operandLiteralValue`, this does NOT require the operand to be a number
 * literal — a SYMBOL declared with a value (`ce.declare('j', { value: 0 })`)
 * has the value type `0`, and that type is the only channel through which
 * its held value reaches a handler.
 *
 * Use it only where the expression shape read a VALUE-derived fact
 * (`isEven`, `isOdd`), never where it read `isSame(k)`: `isSame` is
 * strictly syntactic and answers `false` for a symbol whatever it holds, so
 * a type-value read there would claim more than the shape it replaces.
 */
function operandTypeValue(d: OperandDescriptor): number | undefined {
  const t = d.type;
  if (typeof t === 'string') return undefined;
  if (t.kind === 'value' && typeof t.value === 'number') return t.value;
  if (
    t.kind === 'numeric' &&
    typeof t.lower === 'number' &&
    t.lower === t.upper
  )
    return t.lower;
  return undefined;
}

/**
 * Is this operand's value a provably even (resp. odd) integer? The
 * descriptor twin of `operandIsEven` / `operandIsOdd`
 * (`library/type-handlers.ts`), which consult the operand's `isEven` — a
 * VALUE-channel read — before falling back on a literal's value.
 *
 * The value channel reaches a descriptor through the operand's type, so the
 * parity is read from there (`operandTypeValue`) rather than from the
 * literal gate: a symbol declared with a held value carries that value in
 * its type and nowhere else, and reading only literals made `2^j` for
 * `j := 0` lose the non-negative range an even exponent proves.
 */
function operandParityIsEven(d: OperandDescriptor): boolean | undefined {
  const v = operandTypeValue(d);
  if (v !== undefined && Number.isInteger(v)) return v % 2 === 0;
  // A zero SIGN is a parity proof of its own — zero is even — and it is the
  // one part of the value channel that survives an assignment the type does
  // not record: `ce.assign('n', 0)` leaves the symbol typed `integer` while
  // the sign fact still reads `zero`.
  if (d.facts.sgn === 'zero') return true;
  return undefined;
}

function operandParityIsOdd(d: OperandDescriptor): boolean | undefined {
  const even = operandParityIsEven(d);
  return even === undefined ? undefined : !even;
}

/**
 * Is this operand a number LITERAL that is provably not zero? `undefined`
 * for everything that is not a literal, so a caller can fall back on the
 * sign channel for symbols and compounds.
 *
 * A literal whose exact value no machine number represents (`1/3`, `√2`, a
 * bigint beyond ±2⁵³) answers `true`: `operandLiteralValue` declines to give
 * a value for those, and none of them is zero — zero is representable.
 */
function nonZeroLiteral(d: OperandDescriptor): boolean | undefined {
  if (d.structureOf?.()?.kind !== 'number') return undefined;
  const v = operandLiteralValueOnTypes(d);
  return v === undefined ? true : v !== 0;
}

/* ------------------------------------------------------------------------ *
 * The `'types'`-shape twins of the operand predicates the `Add` and
 * `Multiply` type handlers share with the value paths
 * (`collection-utils.ts`, `boxed-expression/arithmetic-add.ts`). Those
 * predicates read an operand EXPRESSION; the ones below read the operand's
 * TYPE, and — where the question is genuinely structural — its descriptor's
 * structural view. They live here rather than in the shared modules because
 * those modules also serve the value paths, which keep the expression shape.
 * Each twin names the predicate it mirrors; the reasoning for every branch
 * is at that predicate and is not repeated.
 * ------------------------------------------------------------------------ */

/** Twin of `isLinearAlgebraCollection`: is this the kind of collection —
 * a list, a generic collection, an indexed collection or an index span —
 * that participates in linear-algebra arithmetic? Numeric tuples are
 * deliberately excluded; they are scaled component-wise instead. */
function isLinearAlgebraCollectionType(t0: Type): boolean {
  const t = resolveTypeAlias(t0);
  if (
    t === 'list' ||
    t === 'collection' ||
    t === 'indexed_collection' ||
    t === 'range'
  )
    return true;
  return (
    typeof t !== 'string' &&
    (t.kind === 'list' ||
      t.kind === 'collection' ||
      t.kind === 'indexed_collection')
  );
}

/** Twin of `isFixedShapeCollection`: a dimensioned list — a `vector<n>`, a
 * `matrix`, a higher-rank tensor. */
function isFixedShapeCollectionType(t0: Type): boolean {
  const t = resolveTypeAlias(t0);
  return (
    typeof t !== 'string' && t.kind === 'list' && t.dimensions !== undefined
  );
}

/**
 * Twin of the private `dimensionlessIndexedElement` of
 * `collection-utils.ts`: the element type of an unbounded 1-D list or
 * indexed collection, or `undefined` when the type is not one. A union
 * answers with its first collection branch's element.
 *
 * `seen` stops a self-referential transparent alias
 * (`type alias cyc = cyc | 0`) from spinning: an alias node already on the
 * path contributes nothing.
 */
function dimensionlessIndexedElementType(
  t0: Type,
  seen?: Set<object>,
  /** A call on one branch of a union that has a genuine scalar branch: a
   * dimensioned list branch counts, as in the `collection-utils.ts` original
   * (no tensor handler sees a union). */
  inUnion = false
): Type | undefined {
  if (typeof t0 === 'object' && t0.kind === 'reference') {
    if (seen?.has(t0) === true) return undefined;
    seen = new Set(seen).add(t0);
  }
  const t = resolveTypeAlias(t0);
  if (t === 'list' || t === 'indexed_collection') return 'any';
  // An index span is dimensionless and its elements are finite positive
  // integers — a known element type, unlike the bare types above.
  if (t === 'range') return 'integer';
  if (typeof t === 'string') return undefined;
  if (t.kind === 'indexed_collection') return t.elements;
  // A `list` broadcasts only when it is unbounded/dimensionless. A fixed
  // shape carries `dimensions` and is left to tensor typing — except as a
  // branch of a union.
  if (t.kind === 'list')
    return t.dimensions === undefined || inUnion ? t.elements : undefined;
  if (t.kind === 'union') {
    const scalarSibling = unionHasGenuineScalarBranch(t);
    for (const b of t.types) {
      const e = dimensionlessIndexedElementType(b, seen, scalarSibling);
      if (e !== undefined) return e;
    }
  }
  return undefined;
}

/** Twin of `isBroadcastCollectionType`. */
function isBroadcastCollectionTypeOf(t: Type): boolean {
  return dimensionlessIndexedElementType(t) !== undefined;
}

/** The element type of a dimensioned list type whose elements are provably
 * numbers (`vector<integer^2>`, `list<real^2x3>`), or `undefined` for any
 * other type — a list of points, a list of strings, a dimensionless list. */
function numericTensorElementType(t0: Type): Type | undefined {
  const t = resolveTypeAlias(t0);
  if (typeof t === 'string' || t.kind !== 'list') return undefined;
  if (t.dimensions === undefined) return undefined;
  return factsOf(t.elements).belowNumber ? t.elements : undefined;
}

/** Twin of `isTensorValue`: a literal `List` whose type carries dimensions.
 * Both halves are needed — the dimensions alone are a type claim, and the
 * literal `List` node is what the tensor value paths act on. */
function isTensorOperand(d: OperandDescriptor): boolean {
  // The type test comes first: it is a property read, while the structure
  // view allocates, and most operands of an arithmetic derivation are
  // scalars that fail it.
  const t = d.type;
  if (typeof t === 'string' || t.kind !== 'list' || t.dimensions === undefined)
    return false;
  return d.structureOf?.()?.kind === 'list-literal';
}

/** Twin of `isNumericTuple`: every component provably a number. */
function isNumericTupleType(t0: Type): boolean {
  const t = resolveTypeAlias(t0);
  if (typeof t === 'string' || t.kind !== 'tuple') return false;
  return t.elements.every((el) => factsOf(el.type).belowNumber);
}

/**
 * Twin of `isPossiblyCollectionTyped`: an operand whose collection-ness is
 * not statically visible, so an element-wise result must stay lifted.
 *
 * The expression predicate admits a top-typed operand only when it is a
 * function APPLICATION — a bare top-typed symbol is refined to a scalar by
 * the surrounding arithmetic's own inference, so treating it as
 * possibly-a-collection would be order-dependent. The descriptor's
 * structural view answers the same question: an operand with children is a
 * function expression, and a symbol has none.
 */
function isPossiblyCollectionTypedOperand(d: OperandDescriptor): boolean {
  const t = resolveTypeAlias(d.type);
  if (t === 'unknown' || t === 'any' || t === 'value')
    return operandChildren(d) !== undefined;
  if (typeof t === 'string') return false;
  if (t.kind === 'broadcastable') return true;
  if (t.kind !== 'union') return false;
  return t.types.some((branch) => {
    const b = resolveTypeAlias(branch);
    return typeof b !== 'string' && b.kind === 'broadcastable';
  });
}

/** Twin of `broadcastableResultTypeOf`. */
function broadcastableResultTypeOfOperands(
  ops: ReadonlyArray<OperandDescriptor>
): Type {
  const contributions = ops.map((op): Type => {
    const t = op.type;
    if (typeof t !== 'string' && t.kind === 'broadcastable') return t.elements;
    if (t === 'unknown' || t === 'any' || t === 'value') return 'number';
    return broadcastElementType(t);
  });
  let element = widenAll(contributions.map((t) => stripNumericRanges(t)));
  if (element === 'imaginary') element = 'complex';
  return { kind: 'broadcastable', elements: element };
}

/**
 * Twin of `isDeclaredScalarNumber`: a scalar number the USER stated, so its
 * numeric tier may be folded into a tuple's components or a collection's
 * cells. A merely INFERRED tier is retractable evidence and does not count.
 *
 * The symbol arm reads the inferred-type flag off the structural view. The
 * application arm looks the head's definition up in the engine, where the
 * expression predicate reads the definition the call was BOUND to: the two
 * differ only for a call bound through a scope the current one no longer
 * sees.
 */
function isDeclaredScalarNumberOperand(
  d: OperandDescriptor,
  engine: PureEngineView
): boolean {
  if (isNumericTupleType(d.type)) return false;
  if (!factsOf(d.type).belowNumber) return false;
  const s = d.structureOf?.();
  if (s === undefined) return false;
  if (s.kind === 'number') return true;
  if (s.kind === 'symbol') return s.inferred !== true;
  if (s.kind === 'application') {
    const def = engine.lookupDefinition(s.head);
    if (def?.operator !== undefined) return !def.operator.inferredSignature;
    const valueDef = def?.value;
    return valueDef !== undefined && !valueDef.inferredType;
  }
  return false;
}

/** Twin of the private `pointListElementType` of `arithmetic-add.ts`: the
 * tuple ELEMENT type of a type that is statically a rank-1 list of points. */
function pointListElementTypeOf(t0: Type): Type | undefined {
  const t = resolveTypeAlias(t0);
  if (typeof t === 'string') return undefined;
  if (t.kind !== 'list' && t.kind !== 'indexed_collection') return undefined;
  if (t.kind === 'list' && (t.dimensions?.length ?? 0) > 1) return undefined;
  const elt = t.elements;
  return typeof elt !== 'string' && elt.kind === 'tuple' ? elt : undefined;
}

/**
 * The `'types'`-shape twin of `addType`
 * (`boxed-expression/arithmetic-add.ts`), which is `Add`'s result type and
 * is also called from the value path. Every branch, and the reason for it,
 * is documented at that function; only the operand reads differ — a type
 * and a descriptor's facts here, an expression there.
 */
/**
 * The component-wise sum type of operands that are ALL tuples of one arity,
 * or `undefined` when the operands are not that shape (a non-tuple operand,
 * or tuples of different arities).
 *
 * At each position the component types combine the way `addTypeOnTypes`
 * combines whole operands: a list-shaped component absorbs the scalar
 * components at that position into its cells (`number + list<number>` is
 * `list<number>`), and scalar-only positions widen. The result keeps the
 * tuple kind, with the component names dropped: a sum has no field names to
 * preserve.
 *
 * All-scalar tuples take this path too. Widening the whole tuple types
 * instead answers a UNION when neither operand's type contains the other's:
 * `(a, b, 2) + (0, 0, 0.8)` with `a`, `b` real widened
 * `tuple<real, real, integer>` against `tuple<integer, integer, real>` to
 * the union of the two, a type no evaluated value has (the value is
 * `(a, b, 2.8)`, a `tuple<real, real, real>`), and a consumer that sizes a
 * value by its type — the shader targets' component count — read no point
 * there. The per-position widen is the exact type.
 */
function tupleComponentwiseAddType(
  args: ReadonlyArray<OperandDescriptor>
): Type | undefined {
  const tuples: TupleType[] = [];
  for (const x of args) {
    const t = resolveTypeAlias(x.type);
    if (typeof t === 'string' || t.kind !== 'tuple') return undefined;
    tuples.push(t);
  }
  const arity = tuples[0].elements.length;
  if (tuples.some((t) => t.elements.length !== arity)) return undefined;
  const isListShaped = (t: Type): boolean => {
    const r = resolveTypeAlias(t);
    return (
      r === 'list' ||
      (typeof r !== 'string' &&
        (r.kind === 'list' || r.kind === 'indexed_collection'))
    );
  };
  const elements: NamedElement[] = [];
  for (let i = 0; i < arity; i++) {
    const components = tuples.map((t) =>
      stripNumericRanges(t.elements[i].type)
    );
    const lists = components.filter(isListShaped);
    if (lists.length === 0) {
      // An `unknown` component stays `unknown`: the join drops `unknown` in
      // favour of the other type, but a component nothing is known about
      // (a helper declared `-> unknown`) may hold a list at run time, and
      // reporting the other operand's `number` for the position would let a
      // scalar-only lowering read it.
      if (components.some((c) => c === 'unknown')) {
        elements.push({ type: 'unknown' });
        continue;
      }
      // A sum is not closed over `imaginary` (`i + (−i) = 0` is real):
      // `complex` covers the closure — the same repair the scalar tail of
      // `addTypeOnTypes` applies, and `absorbScalarsIntoCells` applies to a
      // cell.
      const scalar = widen(...components);
      elements.push({ type: scalar === 'imaginary' ? 'complex' : scalar });
      continue;
    }
    const scalars = components.filter((c) => !isListShaped(c));
    elements.push({ type: absorbScalarsIntoCells(widen(...lists), scalars) });
  }
  return { kind: 'tuple', elements };
}

/**
 * The operand descriptor with any FUNCTION arm dropped from a union type.
 *
 * An arithmetic parameter is `number`, and the boxing seam admits an operand
 * typed `function | number` provisionally (its number arm overlaps the
 * parameter; a function value would be refused at evaluation). The result
 * type of the arithmetic must then come from the number arm alone: with the
 * union passed through, `Add(f(u), 1)` for `f: (T) -> T where T: number |
 * function` typed `function | number`, a type no sum can have. A union with
 * no number arm is left as it is — the seam's own rejection covers it.
 */
function withoutFunctionArm(x: OperandDescriptor): OperandDescriptor {
  const t = x.type;
  if (typeof t === 'string' || t.kind !== 'union') return x;
  const kept = t.types.filter((arm) => !isSubtype(arm, 'function'));
  if (kept.length === 0 || kept.length === t.types.length) return x;
  const type: Type =
    kept.length === 1 ? kept[0] : { kind: 'union', types: kept };
  // A synthetic descriptor for the narrowed type (a spread of the source
  // would copy no facts: they are getters on a class instance), keeping the
  // source's structural view.
  return { ...describeType(type, x.facts.closed), structureOf: x.structureOf };
}

/**
 * The scalar a term contributes to each cell of a sum: the term's type for a
 * scalar, the element type of a `list` or `indexed_collection` term,
 * `undefined` for any other shape.
 */
function sumCellType(t0: Type): Type | undefined {
  const t = resolveTypeAlias(t0);
  if (
    typeof t === 'object' &&
    (t.kind === 'list' || t.kind === 'indexed_collection')
  )
    return t.elements;
  return isSubtype(t, 'number') ? t : undefined;
}

/**
 * The type of a sum whose terms (whose cells, for a list term) are all on the
 * extended real line, with or without a `nan` arm, when at least one of them
 * may be infinite. Such a sum is an extended real or NaN, never a complex
 * value, so it is typed `real | +oo | -oo` (user decision 2026-09-25: a host
 * reads `number` and `infinity` as possibly complex). The join that types a
 * sum widens the signed infinities to `infinity`, and two infinite terms to
 * `number`, because it does not look at the other terms. The rules:
 * - no finite arm when a term is provably `±∞` (`∞ + y` is never finite);
 * - a `nan` arm when a term has one, or when two terms may be infinite
 *   (`+∞ + −∞` is NaN; `∞ + y` is NaN at `y = −∞`).
 * The shape of `result` (a list, an indexed collection, or a union of those
 * for a sum of two collections) is kept, and its cell type is replaced.
 * `result` is returned unchanged when a term is not an extended real, or when
 * no term may be infinite.
 */
function signedInfinitySum(
  ops: ReadonlyArray<OperandDescriptor>,
  result: Type
): Type {
  const cells = ops.map((x) => sumCellType(x.type));
  const infinities: Type[] = [
    { kind: 'value', value: Infinity },
    { kind: 'value', value: -Infinity },
  ];
  const extended: Type = {
    kind: 'union',
    types: ['real', 'nan', ...infinities],
  };
  if (cells.some((c) => c === undefined || !isSubtype(c, extended)))
    return result;
  const finite: Type = { kind: 'union', types: ['real', 'nan'] };
  const infinite = cells.filter((c) => !isSubtype(c!, finite)).length;
  if (infinite === 0) return result;
  const provablyInfinite = cells.some((c) =>
    isSubtype(c!, { kind: 'union', types: ['nan', ...infinities] })
  );
  const hasNaN =
    infinite >= 2 ||
    cells.some(
      (c) => !isSubtype(c!, { kind: 'union', types: ['real', ...infinities] })
    );
  const cell = reduceType({
    kind: 'union',
    types: [
      ...(provablyInfinite ? [] : ['real' as Type]),
      ...infinities,
      ...(hasNaN ? ['nan' as Type] : []),
    ],
  });
  const reshape = (t: Type): Type => {
    if (typeof t === 'object') {
      if (t.kind === 'list' || t.kind === 'indexed_collection')
        return { ...t, elements: cell };
      // A sum of two collections can be typed as the union of their
      // collection types (`indexed_collection<…> | list<…>`).
      if (
        t.kind === 'union' &&
        t.types.every(
          (x) =>
            typeof x === 'object' &&
            (x.kind === 'list' || x.kind === 'indexed_collection')
        )
      )
        return reduceType({ kind: 'union', types: t.types.map(reshape) });
    }
    return cell;
  };
  return reshape(resolveTypeAlias(result));
}

function addTypeOnTypes(args: ReadonlyArray<OperandDescriptor>): Type {
  if (args.length === 0) return 'integer'; // = 0
  if (args.length === 1) return args[0].type;
  // Numeric tuples (points/vectors) add component-wise, preserving the tuple
  // type. Handled before the NaN/finiteness early-returns: a tuple is not a
  // finite number, which would otherwise collapse the result to `number`.
  if (args.some((x) => typeCouldBeNumericTuple(x.type))) {
    // A point BROADCAST over a list of points: the sum is a list of points,
    // not the union `list<tuple<…>> | tuple<…>` the widen below reports.
    const pointLists = args.filter(
      (x) =>
        !typeCouldBeNumericTuple(x.type) &&
        pointListElementTypeOf(x.type) !== undefined
    );
    if (
      pointLists.length > 0 &&
      args.every(
        (x) =>
          typeCouldBeNumericTuple(x.type) ||
          pointListElementTypeOf(x.type) !== undefined
      )
    )
      // Only the TUPLE arms of a point operand reach the cell: a
      // point-or-point-list operand (`tuple<…> | list<tuple<…>>`) beside a
      // list of points sums to a list of points whichever arm it holds, and
      // widening its whole union into the cell nested the list arm
      // (`list<list<tuple<…>> | tuple<…>>`). A mixed collection arm
      // (`indexed_collection<number | tuple<…>>`) lands in the sibling's
      // cells like every other arm — the reading a scalar-or-list union
      // beside a definite collection already has — so only its tuple shape
      // reaches the cell; a number it may hold sums with a point to an
      // error the value path reports per cell, which no static type spells.
      return broadcastResultType(
        widenAll(
          args.map((x) =>
            stripNumericRanges(
              typeCouldBeNumericTuple(x.type)
                ? numericTupleArms(x.type)
                : pointListElementTypeOf(x.type)!
            )
          )
        )
      );
    // Tuples of the same arity add COMPONENT-WISE, and a component that is a
    // list broadcasts against the other operands' components at that
    // position: `(g_x, g_y) + (L, L₂)` evaluates to the tuple
    // `(g_x + L, g_y + L₂)` — a tuple of two lists. `widen` does not see
    // positions, so it reported the union
    // `tuple<list<number>, list<number>> | tuple<number, number>`, a type no
    // evaluated value ever has; a consumer that routes on the type (a layout
    // classifier over the JavaScript compile target's output) cannot admit a
    // union of two layouts (Tycho item 246). The same union came out of two
    // all-scalar tuples whose component types cross (`tuple<real, real,
    // integer>` plus `tuple<integer, integer, real>`), so every same-arity
    // tuple sum takes this branch; `tupleComponentwiseAddType` says why.
    const componentwise = tupleComponentwiseAddType(args);
    if (componentwise !== undefined) return componentwise;
    return widenAll(args.map((x) => stripNumericRanges(x.type)));
  }
  // Element-wise sum of a single tensor (vector/matrix) with scalars keeps
  // the tensor's shape/type.
  const tensors = args.filter((x) => isTensorOperand(x));
  if (tensors.length === 1) {
    const others = args.filter((x) => !isTensorOperand(x));
    // Only SCALAR co-operands fold into the cells: a collection-TYPED
    // co-operand is a sibling collection, not a cell contributor.
    if (
      others.every(
        (x) =>
          !isLinearAlgebraCollectionType(x.type) &&
          !isBroadcastCollectionTypeOf(x.type)
      )
    )
      return absorbScalarsIntoCells(
        tensors[0].type,
        others.map((x) => x.type)
      );
  }
  // Collection-typed operands widen to the collection type. Handled before
  // the NaN/finiteness early-returns for the same reason as the tuple branch.
  if (args.some((x) => isLinearAlgebraCollectionType(x.type))) {
    const isBroadcastShaped = (x: OperandDescriptor) =>
      isFixedShapeCollectionType(x.type) || isBroadcastCollectionTypeOf(x.type);
    const shaped = args.filter(isBroadcastShaped);
    if (
      shaped.length > 0 &&
      args.every((x) => isBroadcastShaped(x) || factsOf(x.type).belowNumber)
    ) {
      const collected = widenAll(
        shaped.map((x) => stripNumericRanges(broadcastSiblingType(x.type)))
      );
      const scalars = args.filter((x) => !isBroadcastShaped(x));
      return absorbScalarsIntoCells(
        collected,
        scalars.map((x) => x.type)
      );
    }
    return widenAll(args.map((x) => stripNumericRanges(x.type)));
  }
  // An operand whose collection-ness is not statically visible makes the sum
  // `broadcastable<T>`. Handled before the NaN/finiteness early-returns for
  // the same reason as the collection branch.
  if (args.some((x) => isPossiblyCollectionTypedOperand(x)))
    return broadcastableResultTypeOfOperands(args);
  if (args.some((x) => provablyNaNOperand(x))) return 'number';
  // (+∞) + (−∞) = NaN: two or more non-finite operands can cancel to NaN.
  const nonFinite = args.filter((x) => operandNonFiniteNumberOnTypes(x));
  if (nonFinite.length >= 2) return 'number';
  if (nonFinite.length === 1) {
    const nf = nonFinite[0];
    if (
      isExtendedRealOperand(nf) &&
      args.every((x) => x === nf || isExtendedRealOperand(x))
    )
      return SIGNED_INFINITY_TYPE;
    return 'number';
  }
  // Ranges and sign exclusions are stripped from the join inputs: a sum does
  // not lie in the union of its terms' ranges. The SOUND bound is recomputed
  // below by interval arithmetic over the operands.
  //
  // A term whose type admits NaN beside other values (`nan | real<0..>`, the
  // type of the square of an element read) is summed WITHOUT its `nan`
  // member, and the member is added back to the result: the sum is NaN when
  // that term is, and otherwise lies in the sum of the ranges. Read with the
  // member in place, the term has no interval at all, so the whole range was
  // dropped: `p² + q²` for `p, q: nan | real` typed `nan | real`, its square
  // root then typed `complex | nan`, and the compiled program carried the
  // distance `√(p² + q²)` as a complex object (Tycho item 332). `Multiply`,
  // `Power` and `Divide` already keep the range of such operands.
  const present = args.map((x) => withoutNaN(x.type));
  const hasNaN = present.some((p, i) => p !== args[i].type);
  const t = widenAll(present.map((p) => stripNumericRanges(p)));
  // `imaginary + imaginary` is not closed under addition: the imaginary
  // parts can cancel to 0, which is real. `complex` covers both.
  if (t === 'imaginary')
    return hasNaN
      ? reduceType({ kind: 'union', types: ['complex', 'nan'] })
      : 'complex';
  const ranged = attachInterval(t, foldIntervalsOfTypes(present, addIntervals));
  return hasNaN
    ? reduceType({ kind: 'union', types: [ranged, 'nan'] })
    : ranged;
}

/** A literal-only boolean claim for a number-theory predicate: when the
 * operand is a number LITERAL, the verdict is a type fact (boolean value
 * types, `docs/plans/2026-08-29-boolean-value-types.md` §3.1). Anything
 * else — a symbol, a compound — keeps `boolean`. Reads the literal's value
 * through `operandLiteralValue`. */
function literalPredicateType(
  ops: ReadonlyArray<OperandDescriptor>,
  decide: (n: number) => boolean
): Type {
  const v = ops.length === 1 ? operandLiteralValueOnTypes(ops[0]) : undefined;
  if (v === undefined || !Number.isFinite(v)) return 'boolean';
  return { kind: 'value', value: decide(v) };
}

/**
 * The value of a Γ-family head (`Gamma`, `GammaLn`, `Factorial`,
 * `Factorial2`) at an infinite argument, or `undefined` when the argument
 * is not infinite.
 *
 * - At `+∞` all four diverge to `+∞`. Verified numerically: Γ(x) grows
 *   past the double range between x = 171 and x = 1000, Γ(x+1) does the
 *   same one step later, and ln Γ(10⁶) ≈ 1.28·10⁷ while
 *   ln Γ(10¹²) ≈ 2.66·10¹³.
 * - At `−∞` there is NO limit, so the value is `Indeterminate` (`NaN`
 *   under `.N()`, see `indeterminateFormAnswer()`). Γ has a pole at
 *   every non-positive integer, so the function is undefined at infinitely
 *   many points of any neighbourhood of `−∞`, and between consecutive
 *   poles its sign alternates (Γ(−5.5) ≈ +1.09·10⁻², Γ(−10.5) ≈
 *   −2.64·10⁻⁷). `ln Γ` inherits both, and it is not even real-valued on
 *   the negative axis in this implementation.
 * - At the unsigned `~∞` there is no limit either — an argument approaching
 *   the single point at infinity from no fixed direction has none — so the
 *   value is `Indeterminate` as well. This arm makes the family uniform: `Gamma`,
 *   `GammaLn` and `Factorial` already reached `NaN` at `~∞` through their
 *   own numeric routes, while `Factorial2` stopped at its integrality test
 *   and stayed inert, which `docs/ERROR-MODEL.md` §1 forbids as the
 *   terminal answer to a decided question.
 *
 * - An "anonymous" infinity such as `∞ + i` (a complex literal with an
 *   infinite component, which neither `isInfinity` nor `isFinite` reports)
 *   carries no usable direction and is a float literal, so the value is
 *   `NaN`, the uniform rule for every special-function head of this file.
 *
 * The four heads declare the carrier `complex | infinity`, so every one of
 * these points is IN the carrier and the answer is a value, never a
 * boxing error (the Γ-family convention: the direction with a limit gets
 * it, the direction without one gets `Indeterminate`; ruling recorded in
 * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F batch 8).
 */
export function infiniteGammaFamilyValue(
  x: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const point = infinitePoint(x);
  if (point === undefined) return undefined;
  if (point === '+oo') return ce.PositiveInfinity;
  return indeterminateFormAnswer(ce, [x]);
}

/**
 * The value of a polygamma head `ψ⁽ⁿ⁾` (`Digamma` is n = 0, `Trigamma` is
 * n = 1, `PolyGamma(n, x)` in general) at an exceptional point of `x`, or
 * `undefined` at an ordinary point. Every answer is exact, so it is given
 * on `evaluate()` and `.N()` alike (ruling recorded in
 * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F batch 8;
 * each limit verified numerically at 10², 10⁴ and 10⁶):
 *
 * - `+∞`: `ψ(x) → +∞` (ψ(10⁶) = 13.8, growing like ln x) and every
 *   derivative `ψ⁽ⁿ⁾(x) → 0` for n ≥ 1 (ψ₁(10⁶) = 10⁻⁶, ψ₂ = −10⁻¹²,
 *   ψ₃ = 2·10⁻¹⁸). The Fungrim identity 1cbe83 states the same.
 * - `−∞` and `~∞`: no limit — the poles at the non-positive integers
 *   accumulate there, and between consecutive poles ψ₁ returns to ≈ π²
 *   (ψ₁(−10⁶ − ½) = 9.87) — so the value is `Indeterminate`. An anonymous
 *   infinity (`∞ + i`, a float literal) is `NaN`.
 * - A pole (a non-positive integer): `~∞` for every order. Near `−k`,
 *   `ψ⁽ⁿ⁾(x) ≈ (−1)ⁿ⁺¹ n!/(x + k)ⁿ⁺¹`; the engine spells such a pole
 *   `~∞` whatever the parity of n + 1, exactly as it folds `1/0²` to
 *   `~∞` (a complex pole has no direction), and as `Gamma(0)` answers.
 *   Mathematica agrees (`PolyGamma[1, 0]` is `ComplexInfinity`).
 *
 * The order must be a KNOWN non-negative integer for every arm: the value
 * at `+∞` depends on it, and the pole arm holds for the derivative orders
 * only — the kernels reject a negative order, and the generalized
 * negative-order polygammas do not all keep these poles. A symbolic or
 * negative order leaves the application symbolic at a pole.
 */
function polygammaValueAtExceptionalPoint(
  order: number | null,
  x: Expression,
  ce: ComputeEngine,
  orderExpr?: Expression
): Expression | undefined {
  if (!isNumber(x)) return undefined;
  const point = infinitePoint(x);
  // `orderExpr` is the order as an expression, when the caller has one: a
  // float order (`PolyGamma(1.0, −∞)`) makes the answer `NaN`, which the
  // JavaScript number `order` cannot tell.
  if (point !== undefined && point !== '+oo')
    return indeterminateFormAnswer(
      ce,
      orderExpr === undefined ? [x] : [orderExpr, x]
    );
  if (order === null || order < 0) return undefined;
  if (point === '+oo') return order === 0 ? ce.PositiveInfinity : ce.Zero;
  if (!x.isComplex && x.isInteger === true && x.isNonPositive === true)
    return ce.ComplexInfinity;
  return undefined;
}

/**
 * The value of a Bessel head at an exceptional point of its ARGUMENT `x`
 * (the order `n` is a known integer), or `undefined` at an ordinary point.
 * Exact, so given on `evaluate()` and `.N()` alike (ruling recorded in
 * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F batch 8;
 * each limit verified numerically at 10², 10⁴, 10⁶):
 *
 * - `J_n(±∞) = 0` and `Y_n(+∞) = 0`: the amplitude decays like `x^(−1/2)`
 *   (J₀(10⁶) = 3·10⁻⁴). `Y_n(−∞) = 0` as well: on the negative axis
 *   `Y_n(−x) = (−1)ⁿ(Y_n(x) + 2i·J_n(x))`, and both terms decay.
 * - `I_n(+∞) = +∞` (I₀(100) = 10⁴²). `I_n(−x) = (−1)ⁿ I_n(x)`, so
 *   `I_n(−∞)` is `+∞` for an even order and `−∞` for an odd one
 *   (I₁(−100) = −1.07·10⁴²).
 * - `K_n(+∞) = 0` (K₀(100) = 5·10⁻⁴⁵). `K_n(−x) = (−1)ⁿK_n(x) − iπ·I_n(x)`,
 *   whose modulus grows without bound in the imaginary direction: an
 *   infinite value in a non-real direction, which the engine spells `~∞`
 *   (`i·∞` itself boxes to `~∞`).
 * - `~∞`: `Indeterminate` (an anonymous infinity, a float literal: `NaN`).
 *   Every Bessel function grows
 *   exponentially in some direction of the complex plane and decays in
 *   another (`J_n(iy) = iⁿ I_n(y)`), so there is no value at the
 *   direction-less point.
 * - The origin: `J_n(0)` and `I_n(0)` are the finite values the kernels
 *   compute (1 for n = 0, else 0). `Y_n` and `K_n` have a pole there:
 *   `Y₀(x) ≈ (2/π) ln x → −∞` and `K₀(x) ≈ −ln x → +∞` (the imaginary
 *   part of the complex continuation stays bounded, the `Ln(0) = −∞`
 *   convention), while for n ≠ 0 the leading term is `1/xⁿ`, a complex
 *   pole, spelled `~∞`.
 */
function besselValueAtExceptionalPoint(
  kind: 'J' | 'Y' | 'I' | 'K',
  n: number,
  x: Expression,
  ce: ComputeEngine,
  orderExpr: Expression
): Expression | undefined {
  if (!isNumber(x)) return undefined;
  const point = infinitePoint(x);
  // The order is read as an expression too: a float order
  // (`BesselJ(0.0, ~oo)`) makes the answer `NaN`.
  if (point === '~oo' || point === 'anonymous')
    return indeterminateFormAnswer(ce, [orderExpr, x]);
  if (point === '+oo') return kind === 'I' ? ce.PositiveInfinity : ce.Zero;
  if (point === '-oo') {
    if (kind === 'J' || kind === 'Y') return ce.Zero;
    if (kind === 'K') return ce.ComplexInfinity;
    return n % 2 === 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
  }
  if ((kind === 'Y' || kind === 'K') && !x.isComplex && x.isSame(0)) {
    if (n !== 0) return ce.ComplexInfinity;
    return kind === 'Y' ? ce.NegativeInfinity : ce.PositiveInfinity;
  }
  return undefined;
}

/**
 * The shared evaluate handler of the four Bessel heads. The order must be
 * a known integer and the argument a real literal for the kernels to run;
 * the exceptional points of the argument are answered first, on both
 * routes (`besselValueAtExceptionalPoint`). Everything the real
 * integer-order kernels cannot compute — a non-integer order, a non-real
 * argument, a negative real argument for `Y`/`K` (a complex value there) —
 * stays symbolic.
 */
function evaluateBessel(
  kind: 'J' | 'Y' | 'I' | 'K',
  n: Expression,
  x: Expression,
  ce: ComputeEngine,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (!isNumber(n) || !isNumber(x)) return undefined;
  const order = asSmallInteger(n);
  if (order === null) return undefined;
  const special = besselValueAtExceptionalPoint(kind, order, x, ce, n);
  if (special !== undefined) return special;
  if (!isRealLiteral(x)) return undefined;
  if ((kind === 'Y' || kind === 'K') && x.isNegative === true) return undefined;
  if (!shouldNumericize(numericApproximation, n, x)) return undefined;
  const kernel =
    kind === 'J'
      ? besselJ
      : kind === 'Y'
        ? besselY
        : kind === 'I'
          ? besselI
          : besselK;
  return apply2(n, x, kernel);
}

/**
 * The value of an Airy head at an infinite argument, or `undefined` at a
 * finite one. Exact, so given on `evaluate()` and `.N()` alike (ruling
 * recorded in `docs/plans/2026-08-30-error-model-implementation.md`,
 * Phase F batch 8; each limit verified numerically at 10², 10⁴, 10⁶):
 *
 * - `+∞`: `Ai` and `Ai′` decay to 0 (Ai(100) = 3·10⁻²⁹¹); `Bi` and `Bi′`
 *   grow to `+∞`.
 * - `−∞`: `Ai` and `Bi` oscillate with an amplitude that decays like
 *   `|x|^(−1/4)`, so both tend to 0 (Ai(−10⁶) = −0.002). `Ai′` and `Bi′`
 *   oscillate with an amplitude that GROWS like `|x|^(1/4)` (Ai′(−10⁶) =
 *   17.7), so they have no limit: `Indeterminate`.
 * - `~∞`: `Indeterminate` (an anonymous infinity, a float literal: `NaN`)
 *   — the Airy functions grow
 *   exponentially in some sectors of the complex plane and decay in others.
 */
function airyValueAtInfinity(
  kind: 'Ai' | 'Bi' | 'AiPrime' | 'BiPrime',
  x: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const point = infinitePoint(x);
  if (point === undefined) return undefined;
  if (point === '+oo')
    return kind === 'Ai' || kind === 'AiPrime' ? ce.Zero : ce.PositiveInfinity;
  if (point === '-oo')
    return kind === 'Ai' || kind === 'Bi'
      ? ce.Zero
      : indeterminateFormAnswer(ce, [x]);
  return indeterminateFormAnswer(ce, [x]);
}

/**
 * The value of `Beta(a, b)` when at least one operand is infinite, or
 * `undefined` when both are finite (ruling recorded in
 * `docs/plans/2026-08-30-error-model-implementation.md`, Phase F batch 8;
 * each limit verified numerically at 10², 10⁴, 10⁶):
 *
 * - An anonymous infinity (`∞ + i`) in either slot: `NaN`, the uniform
 *   rule for every special-function head.
 * - When the other operand is a positive integer m, the exact rational
 *   form `B(a, m) = (m−1)!/(a(a+1)⋯(a+m−1))` holds at every point, and its
 *   denominator is infinite at `±∞` and at `~∞` alike: the value is 0.
 * - `B(+∞, b) → 0` whenever the real part of a finite b is positive
 *   (B(10⁶, ½) = 0.0018, decaying like `a^(−b)`); for a non-positive real
 *   part the modulus diverges with a sign that depends on b
 *   (B(10⁶, −½) = −3545), so the value is `NaN`.
 * - `−∞` and `~∞` otherwise: `Indeterminate`. The Γ-poles of the first
 *   operand accumulate at `−∞`, so there is no limit.
 * - Two infinite operands: `B(+∞, +∞) = 0` (`B(a, b) ≤ 1/a` for `b ≥ 1`;
 *   `B(10⁶, 10⁶) = 3.6·10⁻⁶⁰²⁰⁶³`, `B(10³, 10⁹) = 4.0·10⁻⁶⁴³⁶`); every
 *   other pair (`B(+∞, −∞)`, `B(+∞, ~∞)`, `B(−∞, +∞)`) has no limit
 *   (`B(10⁶, −10⁶ + ½) = 1.8·10⁻³` against `B(10⁶, −10⁶ − ¼) = 2.9·10⁻⁸`,
 *   with a pole at every integer in between): `Indeterminate`.
 */
function betaValueAtInfinity(
  a: Expression,
  b: Expression,
  ce: ComputeEngine
): Expression | undefined {
  if (!isNumber(a) || !isNumber(b)) return undefined;
  const pa = infinitePoint(a);
  const pb = infinitePoint(b);
  if (pa === undefined && pb === undefined) return undefined;
  if (pa === 'anonymous' || pb === 'anonymous') return ce.NaN;
  const positiveInteger = (x: Expression): boolean =>
    isNumber(x) &&
    infinitePoint(x) === undefined &&
    !x.isComplex &&
    x.isInteger === true &&
    x.isPositive === true;
  if (
    (pa !== undefined && positiveInteger(b)) ||
    (pb !== undefined && positiveInteger(a))
  )
    return ce.Zero;
  const positiveRealPart = (x: Expression): boolean =>
    isNumber(x) && infinitePoint(x) === undefined && x.re > 0;
  if (
    (pa === '+oo' && positiveRealPart(b)) ||
    (pb === '+oo' && positiveRealPart(a))
  )
    return ce.Zero;
  // Two infinite operands: `B(+∞, +∞) = 0` (`B(a, b) ≤ 1/a` for `b ≥ 1`;
  // `B(10⁶, 10⁶) = 3.6·10⁻⁶⁰²⁰⁶³`), every other pair has no limit.
  if (pa !== undefined && pb !== undefined)
    return pa === '+oo' && pb === '+oo'
      ? ce.Zero
      : indeterminateFormAnswer(ce, [a, b]);
  // One infinite operand. `B(+∞, b)` for a finite `b` with a non-positive
  // real part stays `NaN` (the sign of the divergence depends on `b`, see
  // above). At `−∞` and `~oo` there is no limit: the indeterminate form.
  if (pa === '+oo' || pb === '+oo') return ce.NaN;
  return indeterminateFormAnswer(ce, [a, b]);
}

/**
 * The value of the upper incomplete gamma `Gamma(s, z)` when at least one
 * operand is infinite, or `undefined` when both are finite (ruling
 * recorded in `docs/plans/2026-08-30-error-model-implementation.md`,
 * Phase F batch 8; each limit verified numerically):
 *
 * - `Γ(s, +∞) = 0` for every finite s, a symbolic parameter included (a
 *   parameter is implicitly finite unless its type says otherwise): the
 *   `e^(−t)` tail vanishes.
 * - `Γ(+∞, z) = +∞` for a finite positive real z (Γ(300, 5) overflows
 *   the double range). `Γ(−∞, z)` depends on where z sits against 1:
 *   the integrand `t^(s−1)` on `[z, ∞)` is dominated by `z^s`, which
 *   vanishes for z > 1 and explodes for z < 1 — `Γ(−∞, z) = 0` for z ≥ 1
 *   (Γ(−10⁴, 1.1) = 0; Γ(−10⁴, 1) = 3.7·10⁻⁵ and decreasing) and `+∞` for
 *   0 < z < 1 (Γ(−10⁴, 0.9) overflows the double range; the integrand is
 *   positive, so the sign is fixed). For any other finite z nothing is
 *   verified, so the application stays symbolic there.
 * - `Γ(s, −∞)`: `NaN`. For an integer s the value is `±∞` with a sign
 *   that alternates with the parity of s (Γ(2, −100) = −2.7·10⁴⁵,
 *   Γ(3, −100) = +2.6·10⁴⁷), and for a non-integer s it is a complex
 *   infinity, so there is no single limit to encode.
 * - `~∞` or two infinite operands: `Indeterminate` (`Γ(∞, ∞)` is an
 *   indeterminate form); an anonymous infinity (a float literal): `NaN`.
 */
function incompleteGammaValueAtInfinity(
  s: Expression,
  z: Expression,
  ce: ComputeEngine
): Expression | undefined {
  const ps = infinitePoint(s);
  const pz = infinitePoint(z);
  if (ps === undefined && pz === undefined) return undefined;
  if (ps !== undefined && pz !== undefined)
    return indeterminateFormAnswer(ce, [s, z]);
  if (pz === '+oo')
    return s.isFinite === false ? indeterminateFormAnswer(ce, [s, z]) : ce.Zero;
  // `Γ(s, −∞)` stays `NaN` (the sign of the divergence depends on `s`, see
  // above); `Γ(s, ~oo)` has no limit: the indeterminate form.
  if (pz === '-oo') return isNumber(s) ? ce.NaN : undefined;
  if (pz !== undefined)
    return isNumber(s) ? indeterminateFormAnswer(ce, [s, z]) : undefined;
  // s is the infinite operand and z is finite.
  if (ps === '~oo' || ps === 'anonymous')
    return indeterminateFormAnswer(ce, [s, z]);
  if (!isNumber(z) || z.isComplex || z.isPositive !== true) return undefined;
  if (ps === '+oo') return ce.PositiveInfinity;
  if (z.isGreaterEqual(1) === true) return ce.Zero;
  if (z.isLess(1) === true) return ce.PositiveInfinity;
  return undefined;
}

/**
 * The shared `'types'` handler of the special-function heads whose result
 * is otherwise the generic numeric claim. A provably-NaN operand DECLINES,
 * as `Sqrt` and `Erf` do: a handler answer is never widened, so a `number`
 * answer would suppress any sharper claim the framework could derive.
 * MEASURED consequence for these heads: the framework derives `number`,
 * not the sharp `nan` — the result-adjustment seam adds a `nan` arm only
 * to a NaN-FREE declared result (`typeHasNanFreeNumericCell`,
 * boxed-function.ts), and every head here keeps the wide `number` result
 * for the compiled lanes (`resultIsComplexValued`), exactly as `Sin(NaN)`
 * types `number`. The decline keeps the family uniform and lets a future
 * narrowing of the declared result pick up the sharp arm without a
 * handler change. Every other operand takes the generic claim (`real` for
 * proven-real finite operands, else `number`).
 */
function specialFunctionType(
  ops: ReadonlyArray<OperandDescriptor | undefined>
): Type | undefined {
  if (ops.some((d) => d !== undefined && factsOf(d.type).nan)) return undefined;
  return numericTypeHandlerOnTypes(
    ops.filter((d): d is OperandDescriptor => d !== undefined)
  );
}

/** `Sign`'s result on the extended real line: exactly {−1, 0, 1}. Off that
 * line the result is the complex sign `z/|z|`. The `| nan` forms are the
 * same claims for an operand that may be NaN. */
const SIGN_RANGE_TYPE = parseType('integer<-1..1>');
const SIGN_RANGE_NAN_TYPE = parseType('integer<-1..1> | nan');
const COMPLEX_NAN_TYPE = parseType('complex | nan');

/** `t` without its `nan` member: the type of the values an operand has when
 * it is not NaN, so a claim about them can be tested on a union such as
 * `real | nan`. A type that is not a union is returned unchanged. */
function withoutNaN(t: Type): Type {
  if (typeof t === 'string' || t.kind !== 'union') return t;
  const rest = t.types.filter((m) => !factsOf(m).nan);
  if (rest.length === t.types.length) return t;
  if (rest.length === 1) return rest[0];
  return { kind: 'union', types: rest };
}

/**
 * Thread the operands of a lazy `Add` or `Multiply` that BECAME a
 * restriction when they were evaluated (`2·[1,2]{c}` is `[2,4]{c}`, `2·x{c}`
 * is `2x{c}`): the operation is computed on the present values and
 * re-wrapped, so `2·[1,2]{c} + 3·[1,2]{c}` is `[5,10]{c}`.
 *
 * The threading step of the evaluation driver (step 4c, `boxed-function.ts`)
 * runs BEFORE the operator's handler, on the RAW operands, which is where a
 * lazy operator's operands still are: a raw `When` operand is threaded
 * there, one hidden inside a product was not, and the sum stayed symbolic,
 * `[2,4]{c} + [3,6]{c}` (and `2{c} + 3{c}` for scalars). So the evaluated
 * operands are handed back to the driver as raw operands. The re-entered
 * call sees the `When`s raw and does not come back here for them (its own
 * operands are already restrictions), so the re-entry happens at most once.
 * Answers `undefined` when no operand became a restriction.
 */
function threadOperandsThatBecameConditional(
  engine: ComputeEngine,
  op: 'Add' | 'Multiply',
  ops: ReadonlyArray<Expression>,
  evaluated: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined
): Expression | undefined {
  if (
    !evaluated.some(
      (x, i) =>
        (isFunction(x, 'When') || isFunction(x, 'Which')) &&
        !isFunction(ops[i], 'When') &&
        !isFunction(ops[i], 'Which')
    )
  )
    return undefined;
  return engine._fn(op, [...evaluated]).evaluate({ numericApproximation });
}

/**
 * Precision of the Gamma-family and L-function heads (LogGamma, BarnesG,
 * DirichletEta/Beta/L, StieltjesGamma, ClausenCl): a real result carries
 * `ce.precision` digits or the head stays unevaluated, never a double
 * printed at a higher precision; a complex result is a machine number, as
 * for the native complex special functions, boxed here.
 *
 * Box a machine complex result, dropping a near-zero imaginary part to real.
 * With `real` set, the caller has proven the value is real (real operands
 * on a real branch), so the imaginary part is rounding residue of any size
 * and is dropped: the reflection formula takes `ln sin(πs/2)` of a negative
 * number, and far left of 0 that leaves an imaginary part of relative size
 * about 5e-14, above the relative-noise threshold below.
 */
export function boxComplexResult(
  engine: ComputeEngine,
  z: { re: number; im: number },
  real = false
): Expression {
  // The value comes from a machine kernel, so it is a float even when it is
  // an integer: `engine.number(52)` would box an exact 52.
  if (real) return engine.number(engine._inexactNumericValue(z.re));
  // Drop a part only when it is rounding noise next to the other: an
  // absolute chop would zero a genuinely tiny result, e.g. ζ(18, 5) ≈ 2e-13.
  const noise = 1e-14 * Math.hypot(z.re, z.im);
  const re = Math.abs(z.re) <= noise ? 0 : z.re;
  const im = Math.abs(z.im) <= noise ? 0 : z.im;
  return engine.number(engine._inexactNumericValue(im === 0 ? re : { re, im }));
}

/**
 * Box a bignum result from `bigLerchPhi`/`bigPolyLog`. Both reach this only
 * once `.N()` or an inexact operand already means the answer is a numeric
 * approximation (`evaluateLerchPhi`'s `numeric`), so unlike `boxBignumResult`
 * this never exactifies a small integer: `LerchPhi(1/2,-3,2).N()` lands on
 * exactly 102, and `.N()`'s contract is an approximation regardless of
 * magnitude — the same reason `boxComplexResult` above never exactifies the
 * double kernels' integer-valued results.
 */
export function boxBignumApprox(
  engine: ComputeEngine,
  value: BigNum
): Expression {
  return engine.number(engine._numericValue(value));
}

/** Both components of a number literal are finite machine numbers. */
function isFiniteNumberLiteral(
  x: Expression
): x is Expression & NumberLiteralInterface {
  return isNumber(x) && Number.isFinite(x.re) && Number.isFinite(x.im);
}

/**
 * The value of `Zeta(s, a)` / `HurwitzZeta(s, a)` when an operand is an
 * infinite point. Answers `undefined` when neither operand is infinite (the
 * caller continues), `null` when an operand is infinite but no value is
 * decided here (the caller stays symbolic), and otherwise the value:
 *
 * - ζ(+∞, a) for a real a > 0: every term (k + a)^(−s) with k + a > 1 goes
 *   to 0, the term a^(−s) goes to 0, 1 or +∞ as a > 1, a = 1 or a < 1.
 * - ζ(s, +∞) = 0 for Re(s) > 1: the series tail vanishes.
 * - ζ(−∞, a), ζ(~oo, a) and an anonymous infinite s have no limit, the same
 *   decision as the one-operand `Zeta` (the values at the negative integers
 *   are Bernoulli polynomials, which oscillate and grow without bound).
 */
function zetaAtInfiniteOperand(
  engine: ComputeEngine,
  s: Expression,
  a: Expression
): Expression | null | undefined {
  const sPoint = infinitePoint(s);
  const aPoint = infinitePoint(a);
  if (sPoint === undefined && aPoint === undefined) return undefined;
  if (sPoint !== undefined && aPoint !== undefined) return null;
  if (sPoint !== undefined) {
    if (!isFiniteNumberLiteral(a)) return null;
    if (sPoint !== '+oo') return indeterminateFormAnswer(engine, [s, a]);
    if (a.isComplex || !(a.re > 0)) return null;
    if (a.re > 1) return engine.Zero;
    if (a.re === 1) return engine.One;
    return engine.PositiveInfinity;
  }
  if (aPoint === '+oo' && isFiniteNumberLiteral(s) && s.re > 1)
    return engine.Zero;
  return null;
}

/** The largest positive integer base point `a` for which the exact route
 * rewrites ζ(s, a) as ζ(s) − Σ_{k=1}^{a−1} k^(−s). Past it the rewrite is a
 * long symbolic sum, so the expression stays symbolic instead. */
const HURWITZ_PEEL_LIMIT = 20;

/**
 * The largest order n for which ζ(−n, a) is rewritten as the Bernoulli
 * polynomial −Bₙ₊₁(a)/(n+1) (DLMF 25.11.14), in `evaluateHurwitzZeta` and
 * `evaluateGeneralizedZeta`. Bₙ₊₁'s bigint numerator and denominator grow
 * with n (denominator via von Staudt–Clausen, numerator faster than n!), so
 * past this order the closed form is expensive to build for little benefit;
 * the general kernel below stays available for a numeric `a` past the cap.
 */
const HURWITZ_NEGATIVE_ORDER_LIMIT = 100;

/**
 * The largest order n for which ζ(−n, a) with a SYMBOLIC `a` (a free
 * variable, or an irrational constant such as `Pi`) is rewritten as the
 * Bernoulli polynomial in `a`. The polynomial has n + 2 terms whose
 * coefficients grow faster than n!: at n = 100 it is about 4700 characters
 * long, and for a compound `a` such as `x + y` the expansion takes more
 * than a second at n = 30. Past this order the expression stays symbolic.
 * The limit is the one `PolyLog` uses for its symbolic closed form
 * (`EULERIAN_MAX_ORDER` in `numerics/polylog.ts`, 12).
 */
const HURWITZ_SYMBOLIC_ORDER_LIMIT = 12;

/**
 * The largest size, in decimal digits, of the exact computation of ζ(−n, a)
 * as a Bernoulli polynomial at a numeric `a`. The size
 * (`gaussianRationalWorkDigits`) is (n + 1) times the total digit count of
 * the numerators and denominators of the real and imaginary parts of `a`,
 * which is about the digit count of the integers in that computation.
 *
 * For a float or complex literal `a` the result is rounded to the working
 * precision, with one division: at `HURWITZ_FLOAT_DIGIT_LIMIT` that takes
 * about 10 ms. A larger `a` (many digits, as at a high `ce.precision`, or a
 * large exponent, as in `1e-5000`) uses the numeric kernel instead.
 *
 * For an exact rational `a` the result is an exact rational, which must be
 * reduced: the gcd costs more, and at `HURWITZ_EXACT_DIGIT_LIMIT` building
 * and boxing the result takes about 15 ms. Past it the expression stays
 * symbolic under `evaluate()`.
 */
const HURWITZ_FLOAT_DIGIT_LIMIT = 120_000;
const HURWITZ_EXACT_DIGIT_LIMIT = 4_000;

/**
 * ζ(−n, a) = −Bₙ₊₁(a)/(n+1) (DLMF 25.11.14), as a compute-engine expression
 * in `a`, built by Horner's method from `bernoulliPolynomialCoefficients`
 * using CE's own (exact, symbolic) arithmetic.
 *
 * Used only for a symbolic `a` (a free variable somewhere in it, or an
 * irrational value with no exact rational form, such as `Sqrt(2)`): there is
 * no numeric value to extract a rational from, so this is the only route to
 * a closed form. A numeric `a` uses `hurwitzZetaNegativeInteger` (rational)
 * or `hurwitzZetaNegativeIntegerGaussian` (float or complex) instead — exact
 * bigint arithmetic throughout, never this expression's own `.mul`/`.add`,
 * which under `.N()` would repeat the cancellation documented on
 * `hurwitzZetaNegativeIntegerGaussian`.
 */
function hurwitzZetaNegativeIntegerExpression(
  engine: ComputeEngine,
  n: number,
  a: Expression
): Expression {
  const coefficients = bernoulliPolynomialCoefficients(n + 1);
  let polynomial: Expression = engine.number(coefficients[0]);
  for (let i = 1; i < coefficients.length; i++) {
    polynomial = polynomial.mul(a);
    const c = coefficients[i];
    if (c[0] !== 0n) polynomial = polynomial.add(engine.number(c));
  }
  return polynomial.mul(engine.number([-1n, BigInt(n + 1)]));
}

/**
 * The exact bigint rational for a finite `BigDecimal`'s decimal digits
 * (`value = significand · 10^exponent`). A literal such as `2.7` is stored
 * with `significand = 27n, exponent = -1` — its exact decimal value, not a
 * binary (double) rounding of it — so this is exact for any number literal
 * written in decimal, and for a computed value it is exact to the working
 * precision that value was rounded to.
 */
function rationalFromBigDecimal(
  bd: BigDecimal | undefined
): [bigint, bigint] | undefined {
  if (bd === undefined || !bd.isFinite()) return undefined;
  const { significand, exponent } = bd;
  return exponent >= 0
    ? [significand * 10n ** BigInt(exponent), 1n]
    : [significand, 10n ** BigInt(-exponent)];
}

/**
 * The exact Gaussian rational for a finite numeric literal `a` (float or
 * complex, real and imaginary parts each read from their `BigDecimal` via
 * `rationalFromBigDecimal`), or `undefined` when `a` carries no such exact
 * decimal value (a `NaN`/infinite component, or an exact irrational such as
 * a radical, which has no `bignumRe` decimal expansion to read as exact).
 * At machine precision a float has no `bignumRe`/`bignumIm`: its double
 * parts are read as the shortest decimal that rounds to them (`2.7` for the
 * double nearest 2.7), as a literal at a higher precision is.
 */
function gaussianRationalFromNumber(
  a: Expression & NumberLiteralInterface
): GaussianRational | undefined {
  const re = rationalFromBigDecimal(a.bignumRe ?? new BigDecimal(a.re));
  if (re === undefined) return undefined;
  if (!a.isComplex) return { re, im: [0n, 1n] };
  const im = rationalFromBigDecimal(a.bignumIm ?? new BigDecimal(a.im));
  if (im === undefined) return undefined;
  return { re, im };
}

/** The approximate number of decimal digits of the integers in the exact
 * computation of ζ(−n, a) at the Gaussian rational `a` (see
 * `HURWITZ_FLOAT_DIGIT_LIMIT`). */
function gaussianRationalWorkDigits(n: number, a: GaussianRational): number {
  const bits = (x: bigint) => (x < 0n ? -x : x).toString(2).length;
  const total = bits(a.re[0]) + bits(a.re[1]) + bits(a.im[0]) + bits(a.im[1]);
  return Math.ceil((n + 1) * total * Math.log10(2));
}

/** `gaussianRationalWorkDigits` for a real rational `a`. */
function rationalWorkDigits(
  n: number,
  a: [number | bigint, number | bigint]
): number {
  return gaussianRationalWorkDigits(n, {
    re: [BigInt(a[0]), BigInt(a[1])],
    im: [0n, 1n],
  });
}

/**
 * num/den, with den > 0, as a big decimal rounded to the precision of
 * `engine` (17 digits at machine precision, enough to round to the nearest
 * double), with `bigDecimalQuotient` (`numerics/special-functions.ts`),
 * which forms the quotient with one bigint division. It reads the engine's
 * precision, not the module-global `BigDecimal.precision`, which the
 * construction of another engine changes.
 */
function engineQuotient(
  engine: ComputeEngine,
  num: bigint,
  den: bigint
): BigDecimal {
  const digits = bignumPreferred(engine) ? engine.precision : 17;
  return bigDecimalQuotient(num, den, digits);
}

/**
 * Evaluate HurwitzZeta(s,a) = Σ (k+a)^-s, a pole at every non-positive
 * integer a when Re(s) > 0 (ported from enumeratio's `evaluateHurwitz`).
 * Shared by `HurwitzZeta` and by `Zeta`'s two-argument form for Re(a) > 0
 * or symbolic a (see `evaluateGeneralizedZeta`).
 */
function evaluateHurwitzZeta(
  engine: ComputeEngine,
  s: Expression,
  a: Expression,
  numericApproximation: boolean | undefined,
  symbolicPolynomial = true
): Expression | undefined {
  const atInfinity = zetaAtInfiniteOperand(engine, s, a);
  if (atInfinity !== undefined) return atInfinity ?? undefined;

  // ζ(-n,a) = -B_{n+1}(a)/(n+1), n ≥ 0 (DLMF 25.11.14). Checked before any
  // numeric path so N() reaches it too. Three routes, all exact bigint
  // arithmetic except the last:
  const sInt = asSmallInteger(s);
  if (sInt !== null && sInt <= 0 && -sInt <= HURWITZ_NEGATIVE_ORDER_LIMIT) {
    // 1. `a` is already tagged an exact rational or integer, with at most
    // `HURWITZ_EXACT_DIGIT_LIMIT` digits of work.
    const ra = asRational(a);
    if (
      ra !== undefined &&
      rationalWorkDigits(-sInt, ra) <= HURWITZ_EXACT_DIGIT_LIMIT
    ) {
      const exact = engine.number(
        hurwitzZetaNegativeInteger(-sInt, [BigInt(ra[0]), BigInt(ra[1])])
      );
      return numericApproximation ? exact.N() : exact;
    }

    // 2. `a` is a finite float or complex literal: its real/imaginary parts
    // are exact decimals (`rationalFromBigDecimal`), so the polynomial is
    // computed as an exact Gaussian rational and only rounded once, at the
    // end, converting to a float — never inside Horner's method, where
    // `.mul`/`.add` at the engine's working precision would lose digits to
    // the same cancellation `hurwitzZetaNegativeIntegerGaussian` avoids.
    // Float contagion: `a` is inexact, so the result is a float even under
    // plain `evaluate()`. The integers in that computation have about
    // `gaussianRationalWorkDigits` digits: past `HURWITZ_FLOAT_DIGIT_LIMIT`
    // the numeric kernel below answers instead.
    if (isNumber(a) && !a.isExact) {
      const gaussian = gaussianRationalFromNumber(a);
      if (
        gaussian !== undefined &&
        gaussianRationalWorkDigits(-sInt, gaussian) <= HURWITZ_FLOAT_DIGIT_LIMIT
      ) {
        const { re, im, den } = hurwitzZetaNegativeIntegerGaussianParts(
          -sInt,
          gaussian
        );
        if (im === 0n)
          return boxBignumResult(engine, engineQuotient(engine, re, den));
        return engine.number(
          engine._numericValue({
            re: engineQuotient(engine, re, den),
            im: engineQuotient(engine, im, den),
          })
        );
      }
    }

    // 3. `a` is symbolic — a free variable, or an irrational constant or
    // expression such as `Pi` (an exact radical literal such as `Sqrt(2)`
    // is a number literal, so it does not reach this route and stays
    // symbolic under `evaluate()`): build the polynomial as an expression
    // in `a`. `evaluate()` (and `.N()` with
    // `a` still a free variable, so nothing to cancel) return it directly.
    // `.N()` on a concrete irrational `a` has no exact route above to fall
    // back on and would repeat the cancellation route 2 exists to avoid, so
    // it declines here instead of guessing a guard-digit count; the general
    // kernel below is the fallback, at whatever accuracy it measures for a
    // numeric literal.
    // `symbolicPolynomial` is false when the caller's convention differs
    // from the Hurwitz one for some values of `a` (see
    // `evaluateGeneralizedZeta`). Past `HURWITZ_SYMBOLIC_ORDER_LIMIT` the
    // polynomial is too long to be useful, and the expression stays symbolic.
    if (
      !isNumber(a) &&
      symbolicPolynomial &&
      -sInt <= HURWITZ_SYMBOLIC_ORDER_LIMIT
    ) {
      const polynomial = hurwitzZetaNegativeIntegerExpression(engine, -sInt, a);
      if (!shouldNumericize(numericApproximation, a))
        return polynomial.evaluate();
      if (a.symbols.length > 0) return polynomial.N();
    }
  }

  if (sInt === 1) return engine.ComplexInfinity; // pole, every a

  const finite = isFiniteNumberLiteral;
  // The integer test reads the big decimal when there is one: the double
  // `a.re` of 1e−2000 is 0, which would make it a pole.
  const aNonposInt =
    isNumber(a) &&
    !a.isComplex &&
    (a.bignumRe?.isInteger() ?? Number.isInteger(a.re)) &&
    a.re <= 0;

  // a a non-positive integer: the (k+a) = 0 term diverges when Re(s) > 0,
  // and is indeterminate on Re(s) = 0 for a non-real s.
  if (aNonposInt && finite(s) && s.re > 0) return engine.ComplexInfinity;
  if (
    numericApproximation &&
    aNonposInt &&
    finite(s) &&
    s.re === 0 &&
    s.isComplex
  )
    return engine.NaN;

  const exactRoute = !shouldNumericize(numericApproximation, s, a);

  // ζ(s, 1/2) = (2^s − 1)·ζ(s): exact at an integer s ≥ 2, where ζ(s) has
  // the closed forms of the one-operand `Zeta` (ζ(2, 1/2) = π²/2).
  if (exactRoute && sInt !== null && sInt >= 2 && sInt <= 100) {
    const ra = asRational(a);
    if (ra !== undefined && Number(ra[0]) === 1 && Number(ra[1]) === 2)
      return engine
        .function('Multiply', [
          engine.number(2n ** BigInt(sInt) - 1n),
          engine.function('Zeta', [s]),
        ])
        .evaluate();
  }

  // ζ(s,m), positive integer m: ζ(s) − Σ_{k=1}^{m-1} k^{-s}. Skipped for a
  // concretely complex s, which falls through to the kernel below instead.
  // The difference cancels catastrophically in machine arithmetic when
  // ζ(s, m) is small next to ζ(s) (HurwitzZeta(100, 5) ≈ 5^(−100), but both
  // ζ(100) and the sum round to 1), so only the exact route rewrites, and
  // only for m ≤ HURWITZ_PEEL_LIMIT; a numeric request uses the kernel.
  const complexS = finite(s) && s.isComplex;
  if (
    !complexS &&
    isNumber(a) &&
    !a.isComplex &&
    Number.isInteger(a.re) &&
    a.re >= 1
  ) {
    const m = a.re;
    if (m === 1)
      return engine.function('Zeta', [s]).evaluate({ numericApproximation });
    if (exactRoute) {
      if (m > HURWITZ_PEEL_LIMIT) return undefined; // stay symbolic
      let tail = engine.number(1).pow(engine.function('Negate', [s]));
      for (let k = 2; k < m; k++)
        tail = tail.add(engine.number(k).pow(engine.function('Negate', [s])));
      return engine
        .function('Subtract', [engine.function('Zeta', [s]), tail])
        .evaluate({ numericApproximation });
    }
  }

  if (exactRoute || !finite(s) || !finite(a)) return undefined; // stay symbolic

  // Real s and real a: a term (k + a)^(−s) with k + a < 0 is complex for a
  // non-integer s, so the value is real when a ≥ 0 or s is an integer.
  const real =
    !s.isComplex && !a.isComplex && (a.re >= 0 || Number.isInteger(s.re));

  // At the engine's precision, real s and a: the bignum kernel follows
  // `ce.precision` the way `bigZeta` does for the one-operand form. A
  // complex operand stays on the double kernel below — the complex
  // special-function kernels run at machine precision at every engine
  // precision.
  if (real && bignumPreferred(engine)) {
    const big = bigHurwitzZeta(
      engine,
      hurwitzOperand(engine, s),
      hurwitzOperand(engine, a)
    );
    if (big !== undefined) return boxBignumResult(engine, big);
    // The bignum kernel declined. The double kernel's answer is used only
    // when it is finite: past the double range it overflows to ∞ or NaN
    // for a value that is finite, so the expression stays symbolic instead.
    const z = hurwitzZetaComplexWithError(
      new Complex(s.re, 0),
      new Complex(a.re, 0)
    )?.value;
    if (z === undefined || !Number.isFinite(z.re)) return undefined;
    return boxComplexResult(engine, z, real);
  }

  // The kernel reads the doubles `re`/`im`: the complex-esm kernels are
  // doubles by nature (docs/plans/2026-09-27-big-decimal-imaginary-part.md §5).
  // When the kernel declines (it cannot reach 1e−12 relative, or it would
  // take too long), the expression stays symbolic rather than showing a
  // value with wrong digits.
  const z = hurwitzZetaComplexWithError(
    new Complex(s.re, s.im),
    new Complex(a.re, a.im)
  );
  if (z === undefined) return undefined;
  return boxComplexResult(engine, z.value, real);
}

/**
 * A real operand for the bignum Hurwitz kernels. An exact rational stays a
 * `[numerator, denominator]` pair so the kernel converts it at its raised
 * working precision: `a.bignumRe` of 1/3 is already rounded to
 * `ce.precision` digits, and that rounding reaches the last digit of the
 * result.
 */
export function hurwitzOperand(
  engine: ComputeEngine,
  x: Expression
): HurwitzOperand {
  const r = asRational(x);
  if (r !== undefined) return [BigInt(r[0]), BigInt(r[1])];
  return x.bignumRe ?? engine.bignum(x.re);
}

/**
 * Evaluate Zeta(s,a), Wolfram's generalized zeta: identical to HurwitzZeta
 * for Re(a) > 0 or symbolic a; at a = 0, -1, -2, … it uses a different,
 * always-finite convention instead (`zetaGeneralizedComplex`), so
 * `Zeta(s, 0) = ζ(s)` where `HurwitzZeta(s, 0)` is a pole.
 */
function evaluateGeneralizedZeta(
  engine: ComputeEngine,
  s: Expression,
  a: Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  // s = 1 is a pole at every base point a, in this convention too: the
  // finitely many terms off the positive axis are finite, and the rest is
  // a Hurwitz ζ(1, ·).
  const sInt = asSmallInteger(s);
  if (sInt === 1) return engine.ComplexInfinity;

  // A symbolic `a` gets the Bernoulli polynomial of `evaluateHurwitzZeta`
  // only when `a` is known to be positive: for a negative `a` the terms with
  // k + a < 0 are |k + a|^(−s) here, so at a = −5/2 Zeta(−1, a) is 109/24,
  // while the polynomial −a²/2 + a/2 − 1/12 (the Hurwitz value) is −107/24.
  if (!isNumber(a) || a.re > 0)
    return evaluateHurwitzZeta(
      engine,
      s,
      a,
      numericApproximation,
      isNumber(a) || a.isPositive === true
    );

  if (!a.isComplex && a.re === 0)
    return engine.function('Zeta', [s]).evaluate({ numericApproximation });

  const atInfinity = zetaAtInfiniteOperand(engine, s, a);
  if (atInfinity !== undefined) return atInfinity ?? undefined;

  // Integer s = −n ≤ 0 and rational a < 0: every term |k + a|^n is rational
  // and the rest is the Bernoulli closed form of `evaluateHurwitzZeta`.
  if (sInt !== null && sInt <= 0 && -sInt <= HURWITZ_NEGATIVE_ORDER_LIMIT) {
    const ra = asRational(a);
    if (
      ra !== undefined &&
      rationalWorkDigits(-sInt, ra) <= HURWITZ_EXACT_DIGIT_LIMIT
    ) {
      const value = generalizedZetaNegativeInteger(-sInt, [
        BigInt(ra[0]),
        BigInt(ra[1]),
      ]);
      if (value !== undefined) {
        const exact = engine.number(value);
        return numericApproximation ? exact.N() : exact;
      }
    }
  }

  if (
    !shouldNumericize(numericApproximation, s, a) ||
    !isFiniteNumberLiteral(s) ||
    !isFiniteNumberLiteral(a)
  )
    return undefined; // stay symbolic

  // Real s and real a: the terms off the positive axis are |k + a|^(−s)
  // and the rest is a Hurwitz ζ at a positive base point, all real.
  const real = !s.isComplex && !a.isComplex;

  if (real && bignumPreferred(engine)) {
    const big = bigZetaGeneralized(
      engine,
      hurwitzOperand(engine, s),
      hurwitzOperand(engine, a)
    );
    if (big !== undefined) return boxBignumResult(engine, big);
    // As in `evaluateHurwitzZeta`: a non-finite double answer for a finite
    // value stays symbolic.
    const z = zetaGeneralizedComplexWithError(
      new Complex(s.re, 0),
      new Complex(a.re, 0)
    )?.value;
    if (z === undefined || !Number.isFinite(z.re)) return undefined;
    return boxComplexResult(engine, z, real);
  }

  // The kernel reads the doubles `re`/`im`: the complex-esm kernels are
  // doubles by nature (docs/plans/2026-09-27-big-decimal-imaginary-part.md §5).
  // A kernel decline leaves the expression symbolic, as in
  // `evaluateHurwitzZeta`.
  const z = zetaGeneralizedComplexWithError(
    new Complex(s.re, s.im),
    new Complex(a.re, a.im)
  );
  if (z === undefined) return undefined;
  return boxComplexResult(engine, z.value, real);
}

/**
 * Evaluate LerchPhi(z,s,a) = Σ_{k≥0} zᵏ(k+a)^(−s), the Lerch transcendent
 * (ported from enumeratio's `lerch-phi.ts`; the machine kernel is
 * `numerics/lerch-phi.ts`'s `lerchPhiComplex`). Generalizes `HurwitzZeta`
 * (z = 1), delegated below so it inherits the same exact closed forms.
 */
function evaluateLerchPhi(
  engine: ComputeEngine,
  z: Expression,
  s: Expression,
  a: Expression,
  numericApproximation: boolean | undefined,
  expression?: Expression
): Expression | undefined {
  const finite = isFiniteNumberLiteral;
  // A float operand makes every result a float, the shortcuts below
  // included: LerchPhi(1.0, 2, 1) is the float 1.6449…, not the exact π²/6.
  const numeric =
    numericApproximation || [z, s, a].some((x) => isNumber(x) && !x.isExact);
  const zIsZero = isNumber(z) && z.re === 0 && !z.isComplex;
  // The pole and the indeterminate case below need z ≠ 0: at z = 0 only the
  // k = 0 term remains. A symbolic z of unknown sign is not proven nonzero.
  const zNonZero =
    (isNumber(z) && !zIsZero) || z.isPositive === true || z.isNegative === true;

  // Φ(1,s,a) = ζ(s,a): the same exact closed forms and EM kernel as
  // `HurwitzZeta`.
  if (isNumber(z) && !z.isComplex && z.re === 1)
    return engine
      .function('HurwitzZeta', [s, a])
      .evaluate({ numericApproximation: numeric });

  // Φ(0,s,a) = a^(−s): only the k = 0 term survives (0⁰ = 1).
  if (zIsZero)
    return engine
      .function('Power', [a, engine.function('Negate', [s])])
      .evaluate({ numericApproximation: numeric });

  // Φ(z,0,a) = 1/(1 − z), independent of a — the geometric series and its
  // continuation.
  const sInt = asSmallInteger(s);
  if (sInt === 0)
    return engine
      .function('Divide', [
        engine.number(1),
        engine.function('Subtract', [engine.number(1), z]),
      ])
      .evaluate({ numericApproximation: numeric });

  // A negative integer order s = −n (n ≤ EULERIAN_MAX_ORDER), and an exact
  // rational z (z ≠ 1, taken above) and a: expand (k + a)ⁿ by the binomial
  // theorem,
  //   Φ(z, −n, a) = Σₖ (k + a)ⁿ zᵏ = aⁿ/(1 − z) + Σⱼ₌₁ⁿ C(n, j)·aⁿ⁻ʲ·Li₋ⱼ(z).
  // The j = 0 sum is the geometric series (its k = 0 term included); for
  // j ≥ 1 the k = 0 term is 0, and the sum is the polylogarithm Li₋ⱼ(z), a
  // rational function of z (`polylogReduce`). The value is exact, also at a
  // zero, where the numeric kernel declines because a zero has no relative
  // error it can vouch for: Φ(−1, −1, 1/2) = 0, as in Wolfram. The j = n
  // term has no power of a, so a = 0 does not make 0⁰.
  //
  // Under `.N()` the operands arrive approximated (1/2 as 0.5). An operand
  // that was an exact rational literal is read again from the expression
  // before evaluation, which costs nothing, as the rounding functions do
  // (`originalOperand()`). An exact radical (`√2`) is not used: the closed
  // form would be a large expression with radicals in its denominators.
  const isExactRational = (x: Expression | undefined): x is Expression =>
    x !== undefined &&
    isNumber(x) &&
    x.isExact &&
    !x.isComplex &&
    asRational(x) !== undefined;
  const exactOperand = (
    x: Expression,
    index: number
  ): Expression | undefined => {
    if (isExactRational(x)) return x;
    if (!numericApproximation) return undefined;
    const original = originalOperand(expression, index);
    return isExactRational(original) ? original : undefined;
  };
  const exactZ = exactOperand(z, 0);
  const exactA = exactOperand(a, 2);
  if (
    sInt !== null &&
    sInt < 0 &&
    -sInt <= EULERIAN_MAX_ORDER &&
    exactZ !== undefined &&
    !exactZ.isSame(1) &&
    exactA !== undefined
  ) {
    z = exactZ;
    a = exactA;
    const n = -sInt;
    const terms: Expression[] = [
      engine.function('Divide', [
        engine.function('Power', [a, engine.number(n)]),
        engine.function('Subtract', [engine.One, z]),
      ]),
    ];
    let binomial = 1;
    for (let j = 1; j <= n; j++) {
      binomial = (binomial * (n - j + 1)) / j;
      const polylog = engine.function('PolyLog', [engine.number(-j), z]);
      terms.push(
        engine.function(
          'Multiply',
          j === n
            ? [engine.number(binomial), polylog]
            : [
                engine.number(binomial),
                engine.function('Power', [a, engine.number(n - j)]),
                polylog,
              ]
        )
      );
    }
    const exact = engine.function('Add', terms).evaluate();
    // A float order (`s = -3.0`) makes the result a float, as any float
    // operand does.
    if (!numeric) return exact;
    // `.N()` of an exact integer is the exact integer: box it as a float,
    // since `.N()` promises a numeric approximation (Φ(1/2, −3, 1) is 52.0).
    const approx = exact.N();
    if (!isNumber(approx) || !approx.isExact) return approx;
    return engine.number(
      engine._inexactNumericValue(
        approx.isComplex
          ? { re: approx.re, im: approx.im }
          : (approx.bignumRe ?? approx.re)
      )
    );
  }

  // a a non-positive integer, Re(s) > 0, z ≠ 0: the (k+a) = 0 term
  // diverges — the same pole `evaluateHurwitzZeta` gives `HurwitzZeta` at a
  // non-positive integer base point, since a nonzero zᵏ never cancels it.
  // The integer test reads the big decimal when there is one: the double
  // `a.re` of 1e−2000 is 0, which would make it a pole.
  const aNonposInt =
    isNumber(a) &&
    !a.isComplex &&
    (a.bignumRe?.isInteger() ?? Number.isInteger(a.re)) &&
    a.re <= 0;
  if (aNonposInt && finite(s) && s.re > 0 && zNonZero)
    return engine.ComplexInfinity;
  // Re(s) = 0, s ≠ 0, same base point, z ≠ 0: 0^(−s) = 0^(−i·Im(s)) doesn't
  // converge to any value (it winds the unit circle) — the same
  // indeterminate case `evaluateHurwitzZeta` answers `NaN` for under `N()`.
  if (
    numeric &&
    aNonposInt &&
    finite(s) &&
    s.re === 0 &&
    s.isComplex &&
    zNonZero
  )
    return engine.NaN;

  if (
    !shouldNumericize(numericApproximation, z, s, a) ||
    !finite(z) ||
    !finite(s) ||
    !finite(a)
  )
    return undefined; // stay symbolic

  // Real z, s, a inside the series' disk of convergence, above machine
  // precision: the arbitrary-precision series (`bigLerchPhi`) answers the
  // requested digits directly, the way `bigHurwitzZeta` does for
  // `HurwitzZeta` (cortex-js/compute-engine#374). Outside |z| < 1, or for
  // a complex operand, the double continuation below is unchanged.
  if (
    !z.isComplex &&
    !s.isComplex &&
    !a.isComplex &&
    Math.abs(z.re) < 1 &&
    bignumPreferred(engine)
  ) {
    const big = bigLerchPhi(
      engine,
      hurwitzOperand(engine, z),
      hurwitzOperand(engine, s),
      hurwitzOperand(engine, a)
    );
    if (big !== undefined) return boxBignumApprox(engine, big);
  }

  const result = lerchPhiComplex(
    new Complex(z.re, z.im),
    new Complex(s.re, s.im),
    new Complex(a.re, a.im)
  );
  if (result === undefined) return undefined; // continuation declined; stay symbolic

  // Real when every operand is real, z is off the [1, ∞) branch cut, and
  // a ≥ 0 or s is an integer keeps every term real — the same predicate
  // `evaluateHurwitzZeta` uses, restricted to the cut-free side of z.
  const real =
    !z.isComplex &&
    !s.isComplex &&
    !a.isComplex &&
    z.re < 1 &&
    (a.re >= 0 || Number.isInteger(s.re));
  return boxComplexResult(engine, result, real);
}

/**
 * Largest |n| for which `DirichletEta(n)` and `DirichletBeta(n)` build their
 * exact closed form (a rational times a power of π, a Bernoulli or Euler
 * number): the numbers grow like n!, and past the limit the exact answer is
 * unreadable. Beyond it `.N()` still evaluates; the exact form stays symbolic.
 */
const DIRICHLET_EXACT_ORDER_LIMIT = 100;

/** The integer value of a real number literal, or `null`. */
function dirichletInteger(s: Expression): number | null {
  // `asSmallInteger` reads the exact value: 1 + 10^−30 projects to the double 1.
  const n = asSmallInteger(s);
  return n !== null && Math.abs(n) <= DIRICHLET_EXACT_ORDER_LIMIT ? n : null;
}

/**
 * The real operand as a big decimal, at `ce.precision` digits. An exact
 * rational is divided exactly: its double projection is wrong for
 * 1 + 10^−30, and `bignumRe` is absent for a rational.
 */
export function bigRealOperand(engine: ComputeEngine, s: Expression): BigNum {
  const operand = hurwitzOperand(engine, s);
  return operand instanceof BigDecimal
    ? operand
    : new BigDecimal(operand[0]).div(new BigDecimal(operand[1]));
}

/** The value of `expr` when it is a finite number literal. */
function finiteNumberOrUndefined(expr: Expression): Expression | undefined {
  return isFiniteNumberLiteral(expr) ? expr : undefined;
}

/** A double-kernel value as a machine number, as `boxComplexResult` boxes it. */
function machineNumberOrUndefined(expr: Expression): Expression | undefined {
  if (!isFiniteNumberLiteral(expr)) return undefined;
  return boxComplexResult(
    expr.engine,
    { re: expr.re, im: expr.im },
    !expr.isComplex
  );
}

/**
 * Evaluate DirichletEta(s) = Σ_{n≥1} (−1)^{n−1} n^{−s} = (1 − 2^{1−s}) ζ(s),
 * an entire function: η(1) = ln 2 (the pole of ζ cancels), η(0) = 1/2, and
 * at the even integers a rational multiple of a power of π.
 *
 * Real s runs on the arbitrary-precision kernel `bigDirichletEta`, which
 * adds the digits that the cancellation near s = 1 costs. A complex s, or a
 * precision at most the machine's, uses the double kernels; within
 * `DIRICHLET_NEAR_POLE` of s = 1 there the alternating series is summed as
 * Φ(−1, s, 1), which has no pole to cancel.
 */
function evaluateDirichletEta(
  engine: ComputeEngine,
  s: Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  const point = isNumber(s) ? infinitePoint(s) : undefined;
  if (point === '+oo') return engine.One;
  // No limit at −∞ or ~oo, as for ζ: the indeterminate form.
  if (point !== undefined) return indeterminateFormAnswer(engine, [s]);
  if (!isFiniteNumberLiteral(s)) return undefined;
  const numeric = shouldNumericize(numericApproximation, s);
  const finish = (e: Expression) => (numeric ? e.N() : e.evaluate());

  const n = dirichletInteger(s);
  if (n === 1) return finish(engine.function('Ln', [engine.number(2)]));
  // (1 − 2^{1−n}) ζ(n): ζ's closed forms at the even and nonpositive integers,
  // and the odd ones stay (1 − 2^{1−n}) ζ(n) with ζ(n) symbolic.
  if (n !== null) {
    const value = engine
      .function('Multiply', [
        engine.function('Subtract', [
          engine.One,
          engine.function('Power', [engine.number(2), engine.number(1 - n)]),
        ]),
        engine.function('Zeta', [engine.number(n)]),
      ])
      .evaluate();
    return numeric ? value.N() : value;
  }
  if (!numeric) return undefined;

  // A real result carries `ce.precision` digits or the head stays unevaluated.
  if (!s.isComplex && bignumPreferred(engine)) {
    const big = bigDirichletEta(engine, bigRealOperand(engine, s));
    return big === undefined ? undefined : boxBignumApprox(engine, big);
  }

  if (Math.hypot(s.re - 1, s.im) < DIRICHLET_NEAR_POLE)
    return machineNumberOrUndefined(
      engine
        .function('LerchPhi', [engine.number(-1), s, engine.One])
        .evaluate({ numericApproximation: true })
    );
  return machineNumberOrUndefined(
    engine
      .function('Multiply', [
        engine.function('Subtract', [
          engine.One,
          engine.function('Power', [
            engine.number(2),
            engine.function('Subtract', [engine.One, s]),
          ]),
        ]),
        engine.function('Zeta', [s]),
      ])
      .evaluate({ numericApproximation: true })
  );
}

/**
 * The exact β(n) at an integer n (Euler numbers E₂ₖ):
 *   β(1) = π/4, β(2) = G (Catalan), β(0) = 1/2,
 *   β(2k+1) = (−1)ᵏ E₂ₖ π^{2k+1} / (4^{k+1} (2k)!),
 *   β(−2k) = E₂ₖ / 2, β(−(2k+1)) = 0.
 * β at the even integers above 2 has no closed form. `undefined` there.
 */
function dirichletBetaInteger(
  engine: ComputeEngine,
  n: number
): Expression | undefined {
  if (n === 1) return engine.Pi.div(engine.number(4));
  if (n === 2) return engine.symbol('CatalanConstant');
  if (n > 2 && n % 2 === 1) {
    const k = (n - 1) / 2;
    let factorial = 1n;
    for (let i = 2n; i <= BigInt(2 * k); i++) factorial *= i;
    const euler = eulerEvenNumber(k) * (k % 2 === 0 ? 1n : -1n);
    return engine
      .number([euler, 4n ** BigInt(k + 1) * factorial])
      .mul(engine.Pi.pow(n));
  }
  if (n <= 0 && n % 2 === 0)
    return engine.number([eulerEvenNumber(-n / 2), 2n]);
  if (n < 0) return engine.Zero;
  return undefined;
}

/**
 * Evaluate DirichletBeta(s) = Σ_{n≥0} (−1)ⁿ (2n+1)^{−s}
 * = 4^{−s} (ζ(s, ¼) − ζ(s, ¾)), an entire function (the Dirichlet L-function
 * of the odd character mod 4). Computed as `evaluateDirichletEta` is: real s
 * on the arbitrary-precision Hurwitz kernel, complex s on the double one,
 * and within `DIRICHLET_NEAR_POLE` of s = 1 the double route sums
 * β(s) = 2^{−s} Φ(−1, s, ½).
 */
function evaluateDirichletBeta(
  engine: ComputeEngine,
  s: Expression,
  numericApproximation: boolean | undefined
): Expression | undefined {
  const point = isNumber(s) ? infinitePoint(s) : undefined;
  if (point === '+oo') return engine.One;
  // No limit at −∞ or ~oo, as for ζ: the indeterminate form.
  if (point !== undefined) return indeterminateFormAnswer(engine, [s]);
  if (!isFiniteNumberLiteral(s)) return undefined;
  const numeric = shouldNumericize(numericApproximation, s);

  const n = dirichletInteger(s);
  if (n !== null) {
    const exact = dirichletBetaInteger(engine, n);
    if (exact !== undefined) return numeric ? exact.N() : exact;
  }
  if (!numeric) return undefined;

  // A real result carries `ce.precision` digits or the head stays unevaluated.
  if (!s.isComplex && bignumPreferred(engine)) {
    const big = bigDirichletBeta(engine, bigRealOperand(engine, s));
    return big === undefined ? undefined : boxBignumApprox(engine, big);
  }

  const two = engine.number(2);
  if (Math.hypot(s.re - 1, s.im) < DIRICHLET_NEAR_POLE)
    return machineNumberOrUndefined(
      engine
        .function('Multiply', [
          engine.function('Power', [two, engine.function('Negate', [s])]),
          engine.function('LerchPhi', [
            engine.number(-1),
            s,
            engine.number([1, 2]),
          ]),
        ])
        .evaluate({ numericApproximation: true })
    );
  return machineNumberOrUndefined(
    engine
      .function('Multiply', [
        engine.function('Power', [
          engine.number(4),
          engine.function('Negate', [s]),
        ]),
        engine.function('Subtract', [
          engine.function('HurwitzZeta', [s, engine.number([1, 4])]),
          engine.function('HurwitzZeta', [s, engine.number([3, 4])]),
        ]),
      ])
      .evaluate({ numericApproximation: true })
  );
}

/**
 * The operands of a one-operand `Sum`/`Product` (`Sum(xs)`, no indexing set)
 * with an operand that can be ABSENT AS A WHOLE replaced by its value; the
 * operands unchanged when the rule does not apply; and `undefined` when the
 * operand is absent, in which case the caller answers `NaN`.
 *
 * The operand is typed `missing | list<…>`: a row read `At(x, i)` of a list
 * of lists, a lazy view over one (`Map(f, At(x, i))`), or a restricted list
 * `xs{c}`. `Sum` and `Product` hold their operands, so the absence test of
 * the evaluation (`hasAbsentScalarOperand`) does not see an absence that the
 * operand computes, and a lazy view over such an operand is not finite
 * before its source is evaluated, so the fold stayed unevaluated:
 * `Sum(Map(f, At(x, 7)))` for a list `x` with no seventh row, and
 * `Product(xs{c})` with `c` false. The operand is read with
 * `absentableCollectionOperandValue` (`validate.ts`).
 */
function withAbsentableOperandResolved(
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> | undefined {
  if (ops.length !== 1 || ops[0] === undefined) return ops;
  const value = absentableCollectionOperandValue(ops[0]);
  if (value === undefined) return ops;
  if (isAbsentScalarSymbol(value)) return undefined;
  return [value];
}

export const ARITHMETIC_LIBRARY: SymbolDefinitions[] = [
  {
    //
    // Functions
    //
    Abs: {
      description: 'Absolute value (magnitude) of a number.',
      keywords: ['magnitude', 'modulus'],
      wikidata: 'Q3317982', // magnitude 'Q120812 (for reals)
      broadcastable: true,
      idempotent: true,
      complexity: 1200,
      // The parameter carrier is every number except NaN: the modulus has
      // a value at every finite complex number and at every infinity
      // (`|±∞| = |~oo| = +∞`), so nothing is off-carrier; `NaN`
      // propagates (explicit: the carrier is not a subtype of `complex`,
      // so the policy derived from the signature would be `reject`). The
      // DECLARED result must admit every answer the type handler can
      // give, and `absFunctionType` legitimately claims `+oo | -oo`
      // for `±∞`/`~oo` and the top `number` where finiteness is not proven
      // (a NaN operand, in particular). Neither is below `real`, so the
      // declaration is the top numeric type and the handler tightens it
      // per call. A numeric tuple operand (a point, whose norm `Abs`
      // computes) is admitted by the numeric-argument validation's tuple
      // lane (`typeCouldBeNumericTuple`, validate.ts), not by this
      // carrier.
      signature: '(complex | infinity) -> number',
      examples: ['[Abs(-3), Abs(3 - 4i)]'],
      nanBehavior: 'propagate',
      // A TYPE test, not an `operator === 'Tuple'` check: a tuple-TYPED
      // symbol or lambda parameter is a point too, even without a literal
      // `Tuple` node.
      type: ([x], context) =>
        BoxedType.forResult(
          x && isTupleTypedOperand(x)
            ? pointNormType(x)
            : absFunctionTypeOnTypes(x),
          context.engine._typeResolver
        ),
      sgn: ([x], { engine: ce }) => {
        if (x.isNaN) return 'unsigned'; // |NaN| = NaN
        if (x.isSame(0)) return 'zero';
        if (isNumber(x)) return 'positive';
        // Symbol with no value: assumed bounds on `abs:x` may sharpen the
        // sign, e.g. `assume(|x| > 2)` entails 'positive'
        // (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1b)
        const assumed = signFromAssumedPart(ce, x, 'abs');
        if (assumed !== undefined) return assumed;
        return 'non-negative'; //|x^2+1| fails
      },
      evaluate: ([x], { numericApproximation }) =>
        evaluateAbs(x, numericApproximation),
    },

    Add: {
      description: 'Sum of two or more values.',
      wikidata: 'Q32043',
      associative: true,
      commutative: true,
      commutativeOrder: addOrder,
      broadcastable: true,
      // The Add handlers own these shapes: tensors and matrices (the matrix
      // sum, `addTensors`), numeric tuples (component-wise), collection-shaped
      // result types (`matrix + scalar` types `matrix`, computed by
      // `addType`), and operands that only become collections at evaluation.
      // The generic broadcast machinery must not re-map any of them.
      broadcastExemptions: [
        'tensors',
        'tuples',
        'collection-result',
        'evaluated-operands',
      ],
      idempotent: true,
      complexity: 1300,

      lazy: true,
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Add'),

      // Accept numbers, vectors, and matrices for element-wise addition
      signature: '(value+) -> value',
      examples: ['1 + x + 2 + x'],
      // The `value`-typed signature would default to `pass-through`; declare
      // `propagate` so an absent operand yields `NaN` (every cell `Add`
      // computes on is numeric — §3.A/§5 of the missing-value typing design).
      missingBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          signedInfinitySum(ops, addTypeOnTypes(ops.map(withoutFunctionArm))),
          context.engine._typeResolver
        ),

      sgn: (ops) => {
        if (ops.some((x) => x.isNaN)) return 'unsigned';
        if (ops.every((x) => x.isSame(0))) return 'zero';
        if (ops.every((x) => x.isNonNegative))
          return ops.some((x) => x.isPositive) ? 'positive' : 'non-negative';
        if (ops.every((x) => x.isNonPositive))
          return ops.some((x) => x.isNegative) ? 'negative' : 'non-positive';
        return undefined;
      },

      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      evaluate: (ops, { numericApproximation, engine, expression }) => {
        // Ellipsis fold barrier: an `Add` with a direct `ContinuationPlaceholder`
        // operand is a notational object; leave it unchanged rather than summing
        // across the elided terms.
        if (ops.some((x) => isContinuationOperand(x))) return undefined;
        // `Add` is `lazy`, so the driver did NOT evaluate the operands —
        // this map is the (single) operand evaluation, not a re-evaluation.
        // Under a numeric approximation the operands are evaluated
        // numerically too: the numeric branch below gives `addNEvaluated`
        // this numeric value (or the raw operand, for a number literal or a
        // symbol), never the exact value, and an exact evaluation can cost
        // much more than a numeric one (the exact value of a `Sum` of 1000
        // symbolic terms, where `.N()` adds 1000 floats). Without a numeric
        // approximation the call has no options: `evaluate()` with no
        // options is the form that the memo of a symbol's stored value
        // accepts.
        const evaluated = ops.map((x) =>
          numericApproximation
            ? x.evaluate({ numericApproximation: true })
            : x.evaluate()
        );
        const rethreaded = threadOperandsThatBecameConditional(
          engine!,
          'Add',
          ops,
          evaluated,
          numericApproximation
        );
        if (rethreaded !== undefined) return rethreaded;
        const nonNumeric = nonNumericOperandError(engine!, evaluated);
        if (nonNumeric !== undefined) return nonNumeric;
        // A tuple with a list coordinate is data, not a point: arithmetic
        // over it is an error (see `listCoordinateTupleOperandError`).
        const listTuple = listCoordinateTupleOperandError(engine!, evaluated);
        if (listTuple !== undefined) return listTuple;
        // The driver's missing-value gate saw the operands UNEVALUATED
        // (`Add` is lazy), so an absence produced by the evaluation above —
        // a piecewise with no default arm, `g(3)` — has not been absorbed
        // yet. Apply the same normalization here: the absence becomes the
        // quiet marker of the codomain (`docs/ERROR-MODEL.md` §3), which is
        // `NaN` in a numeric slot and `Missing` in any other. It runs
        // AFTER the non-numeric check, and only when every evaluated operand
        // is valid, because an error or a non-numeric operand outranks an
        // absence: `Error` is the absorbing element of evaluation, and a
        // type error names the offending operand where `NaN` would hide it.
        if (evaluated.every((x) => x.isValid)) {
          // An absent addend beside a POINT makes the point absent: the tuple
          // is atomic, so there is no cell for the absence to land in, and a
          // tuple of absent components is not a value any consumer reads.
          // This arm has to run before `addTuples` below, which would
          // otherwise leave the sum as symbolic residue. It stands aside when
          // a LIST (any non-tuple collection) is also an operand: that sum is
          // a broadcast over the list, and the absent point lands in each
          // cell through the collection kernel instead.
          //
          // A negated or scaled absence is an absent addend too:
          // `(1, 2) - Missing` is canonically `Add(Negate(Missing), (1, 2))`,
          // and the evaluation above made `-Missing` the number `NaN`
          // (a numeric codomain). The operand as it was written still says
          // that the term is absent (`isAbsentArithmeticOperand`), so the
          // difference is `Missing`, as the sum `(1, 2) + Missing` is.
          // Before, the `NaN` term met the point and the difference was
          // an `incompatible-type` error.
          if (
            evaluated.some(
              (x, i) =>
                isAbsentScalarSymbol(x) ||
                (x.isNaN === true && isAbsentArithmeticOperand(ops[i]))
            ) &&
            evaluated.some((x) => isTuple(x)) &&
            !evaluated.some((x) => isNonTupleCollectionOperand(x))
          )
            return engine!.Missing;
          if (hasAbsentScalarOperand(evaluated))
            return absentScalarMarker(engine!, expression);
        }
        if (evaluated.some((x) => x.operator === 'Quantity')) {
          const r = quantityAdd(engine!, evaluated);
          if (
            numericApproximation &&
            r &&
            isQuantity(r) &&
            isMeasurement(r.op1)
          )
            return r.N();
          return r;
        }
        if (evaluated.some((x) => x.operator === 'Measurement')) {
          const r = measurementAdd(engine!, evaluated);
          return numericApproximation ? r?.N() : r;
        }
        // Only a pure number literal or a pure symbol goes to
        // `addNEvaluated` raw, to be numericized there. Every other operand
        // goes as its numeric value from the map above, marked as already
        // numeric, so it is not numericized again.
        // - A function operand is evaluated once. When `addN` numericized
        //   the raw operand again, each nested `Add` or `Multiply` evaluated its
        //   operands two or three times, and the cost grew by that factor at
        //   each level (a polynomial in Horner form of degree 12 made about
        //   17 million evaluations).
        // - An IMPURE operand passes its evaluated form, so its side effects
        //   run once: a framed `Random()` consumed two draw indices under
        //   `N()` and one under `evaluate()`, which broke the rule that each
        //   evaluation consumes one draw.
        // - A number literal passes raw: `addNEvaluated` keeps a fraction
        //   exact until the final fold (late rounding, e.g.
        //   `\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}`).
        // - A symbol passes raw: a SELF-REFERENTIAL frame binding
        //   (`t → t + 1`, Tycho item 46) makes the evaluated form of the
        //   symbol loop, through the re-entry of this handler and through the
        //   type-level `isFinite` → value → `type` cycle. The guard that
        //   substitutes the value only once is on the `.N()` of the raw
        //   symbol.
        if (numericApproximation) {
          const raw = ops.map(
            (op) => op.isPure === true && (isNumber(op) || isSymbol(op))
          );
          const terms = ops.map((op, i) => (raw[i] ? op : evaluated[i]));
          // A pure operand whose float is 0, ±∞ or NaN can have an exact
          // value that is not (`10^{400}` is an integer above the largest
          // double). It is passed as its exact value, so that the exact terms
          // are added before the sum becomes a float: `10^{400} - 10^{400} +
          // 1` is then 1, not `∞ - ∞ + 1 = NaN`.
          for (let i = 0; i < ops.length; i++) {
            if (raw[i]) continue;
            const exact = exactValueOutOfDoubleRange(engine!, ops[i], terms[i]);
            if (exact !== undefined) {
              terms[i] = exact;
              raw[i] = true;
            }
          }
          const r = addNEvaluated(
            terms,
            raw.map((x) => !x)
          );
          // An operand may only have BECOME a Quantity or Measurement through
          // `addN`'s numericization, past the `evaluated` checks above
          // (Tycho item 101). Quantity first, matching the handler precedence.
          return (
            foldQuantityOperands(engine!, r) ??
            foldMeasurementOperands(engine!, r) ??
            markAbsentPointCells(engine!, expression, r)
          );
        }
        const result = add(...evaluated);
        // D2: an inexact (float) operand has no exactness to preserve, so it
        // numericizes the whole sum even when mixed with an exact symbolic
        // constant that the numeric-literal fold above can't reach (`Pi`,
        // `ExponentialE`, …) — `Add(0.5, Pi)` → 3.64…, matching
        // `Add(0.5, Sqrt(2))` (which already folds via the numeric-literal
        // path since `Sqrt(2)` is itself a number literal). Only when the
        // sum is a closed constant: `0.5 + x` must stay symbolic. The gate
        // is `isConstant` (lexical: every symbol is a constant binding), NOT
        // `unknowns.length === 0`: `unknowns` resolves through the *dynamic*
        // scope chain, so inside a function application a bound parameter
        // counts as known and a symbolic `0.3 + z²` body would fire a
        // full-subtree `N()` walk that cannot make progress — and since
        // nested `Add`/`Power` evaluates re-fire it at every level, the
        // cost compounds exponentially with nesting depth (the 2026-07-19
        // recursive-unwind blowup). `evaluate()` has already substituted
        // every valued symbol, so constants are exactly the symbols `N()`
        // can still numericize.
        // `isExactNumber` (not plain `isExact`) additionally protects a
        // Gaussian-integer term still carried by the inexact lane (e.g. the
        // machine `i` constant); exact complex literals (`1/2 + i`, since
        // D12-A an ExactNumericValue) are already covered by `isExact`.
        if (
          result.operator === 'Add' &&
          result.isConstant &&
          evaluated.some((x) => !isExactNumber(x))
        )
          return result.N();
        return markAbsentPointCells(engine!, expression, result);
      },
    },

    Ceil: {
      description: 'Rounds a number up to the next largest integer',
      keywords: ['round up', 'ceiling'],
      complexity: 1250,
      broadcastable: true,
      // The carrier is the extended real line: rounding depends on the
      // order of the real line, which the complex numbers lack, and
      // `Ceil(±∞) = ±∞` puts the signed infinities on both sides. A
      // proven off-carrier operand — a complex value, `~oo` — is a boxing
      // error; there is no component-wise ceiling of a complex number
      // (the compiled lanes agree — they are real-only for this
      // operator). The slim `'types'` handler only NARROWS: a proven
      // finite real sharpens the claim to `integer`, a proven ±∞ to the
      // signed pair, and everything else falls to the declared result
      // plus the derived `nan` arm exactly where the argument can carry
      // one. (Domain-signature doctrine: `docs/ERROR-MODEL.md` §4
      // "Choosing carriers".)
      signature: '(real | signed_infinity) -> integer | signed_infinity',
      examples: ['[Ceil(2.3), Ceil(-2.7)]'],
      // Explicit: the DERIVED default answers `reject` for an
      // extended-real carrier, and `Ceil(NaN)` must be `NaN`.
      nanBehavior: 'propagate',
      // Defined at every point of the carrier, and the numeric route
      // cannot fail (an exact real always has a ceiling): the strong claim
      // discharges the marker arm.
      partiality: 'total',
      type: ([x], context) =>
        BoxedType.forResult(
          roundingFunctionTypeOnTypes(x),
          context.engine._typeResolver
        ),
      sgn: ([x]) => {
        const minusOne = x.engine.NegativeOne;
        if (isOrdered(x, '<=', minusOne)) return 'negative';
        if (x.isPositive) return 'positive';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive && isOrdered(x, '>', minusOne)) return 'zero';
        if (x.isNonPositive) return 'non-positive';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, expression }) =>
        applyRounding(
          x,
          'ceil',
          Math.ceil,
          (x) => x.ceil(),
          numericApproximation,
          originalOperand(expression, 0)
        ),
    },

    Chop: {
      description: 'Replace tiny numeric values with zero.',
      associative: true,
      broadcastable: true,
      idempotent: true,
      complexity: 1200,

      signature: '(T) -> T where T: number',
      examples: ['Chop([1e-20, 0.5, 3 + 1e-15i])'],
      evaluate: (ops, { numericApproximation }) => {
        const op = ops[0];
        const ce = op.engine;
        // Exactness contract: an exact operand keeps its exact form under
        // `evaluate` unless something actually chops. A mixed exact complex
        // (one tiny component, one not — `1/3 + 10⁻²⁰i`) has no exact way to
        // drop a single component, so it falls through to the numeric chop,
        // matching the float path's component-wise behavior.
        if (!numericApproximation && isNumber(op) && op.isExact) {
          const reChops = ce.chop(op.re) === 0;
          const imChops = ce.chop(op.im ?? 0) === 0;
          if (reChops && imChops) return ce.Zero;
          const tinyRe = op.re !== 0 && reChops;
          const tinyIm = (op.im ?? 0) !== 0 && imChops;
          if (!tinyRe && !tinyIm) return op;
        }
        return apply(
          op,
          (x) => ce.chop(x),
          (x) => ce.chop(x),
          (x) => ce.complex(ce.chop(x.re), ce.chop(x.im))
        );
      },
    },

    Complex: {
      description:
        'Construct a complex number from real and imaginary parts. Converted directly to a BoxedNumber during boxing; this entry exists so `operatorInfo("Complex")` returns a signature.',
      wikidata: 'Q11567',
      complexity: 500,
      signature: '(real: number, imaginary: number) -> complex',
      examples: ['[Complex(3, 4), Complex(1, -2)]'],
    },

    Divide: {
      description: 'Quotient of a numerator and one or more denominators.',
      wikidata: 'Q1226939',
      complexity: 2500,
      broadcastable: true,
      // Numeric tuples divide component-wise in `canonicalDivide`, never
      // fanned into a List by the generic broadcast machinery.
      broadcastExemptions: ['tuples'],

      // The carrier is the whole extended complex plane, in every slot: a
      // quotient has a value at every pair of admitted operands, or the
      // pair is an indeterminate FORM whose value is `NaN` (`0/0`, `∞/∞`,
      // `~oo/~oo`, `~oo/∞`, `∞/~oo`) — the same arrangement `Power` makes
      // for `0^0`. There is therefore NO off-carrier point and no error
      // this declaration adds. `NaN` propagates, declared explicitly
      // because the extended carrier is not a subtype of `complex`, so the
      // policy derived from the signature would be `reject` (see
      // `docs/ERROR-MODEL.md` §4). The RESULT stays the wide `number`: the
      // compiled lanes' kind-preservation discipline relies on it
      // (`resultIsComplexValued`, javascript-target.ts), and the per-call
      // sharpness lives in the type handler below.
      //
      // The hot box route and `.div()` call `canonicalDivide` through the
      // numeric fast path, whose single `checkNumericArgs` pass enforces the
      // operand kinds. The definition handler below is only the generic
      // fallback; on that route its numeric check protects the rewrite, and
      // a surviving same-head result is checked against this signature by
      // the canonical-handler seam. Since the carrier has no error point, no
      // evaluate-handler refusal is needed to replace them.
      //
      // - if numer product of numbers, or denom product of numbers,
      // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x
      signature: '(complex | infinity, (complex | infinity)+) -> number',
      examples: ['[6 / 4, x / 2]'],
      nanBehavior: 'propagate',
      type: (ops, context) => {
        const [num, den] = ops;
        if (operandLiteralValueOnTypes(den) === 1)
          return BoxedType.forResult(num.type, context.engine._typeResolver);
        // A numeric tuple (point/vector) divided by a scalar keeps the tuple
        // type, mirroring the `Multiply` handler. `canonicalDivide` scales
        // component-wise only when the numerator's components are ACCESSIBLE
        // (a `Tuple`/`Pair`/`Triple`/`Single` head); every other tuple-typed
        // numerator — notably the `PointList` head importers emit — stays an
        // inert `Divide`, and without this branch that inert form collapsed to
        // `number`. That collapse propagated: a list of such quotients typed
        // `vector<n>` instead of `list<tuple<…>>`, so `PointX`/`PointY` over it
        // took the element-INDEX reading rather than the elementwise one, and a
        // mixed `p + p/n` failed outright with `incompatible-type` (Tycho item
        // 165). Hoisted above the NaN/finiteness early-returns for the same
        // reason `Multiply` hoists its tuple branch: a tuple is not a finite
        // number, which would otherwise collapse it to `number`.
        // COULD-semantics on the numerator, while the denominator must be one
        // a shape-preserving quotient can divide by at all — see
        // `divisorKeepsNumeratorShape`, which rules out every divisor that can
        // present a TUPLE (`tuple / tuple` has no defined quotient and
        // `canonicalDivide` rejects it) as well as a matrix, which the value
        // path leaves inert. The tuple-ness of the numerator is read from its
        // TYPE alone here (`typeCouldBeNumericTuple`), so a tuple that a
        // scalar declaration hides behind a symbol's held value is read as a
        // scalar. The STRUCTURE is preserved but
        // the components are NOT echoed: each is widened through
        // `quotientComponentType`, which applies the same tier rules as the
        // scalar branches below — echoing claimed integer components for
        // `tuple<integer, …> / integer` where the quotient is
        // rational (`[6,2]/4 = [3/2,1/2]`).
        if (
          typeCouldBeNumericTuple(num.type) &&
          divisorKeepsNumeratorShape(den)
        )
          return BoxedType.forResult(
            quotientShapeType(num.type, den),
            context.engine._typeResolver
          );
        // The ELEMENTWISE counterpart of the branch above (Tycho item 209): a
        // COLLECTION whose elements are numeric tuples — a point LIST, e.g.
        // the `N = P / l(P)` a Desmos document writes to normalize a set of
        // points — divides component-wise INSIDE each element, so the
        // quotient's elements stay tuples. Without this branch the scalar
        // widening below claimed `number`, and the broadcast wrapper in
        // `boxed-function.ts` lifted that scalar per-element result, typing
        // the quotient `list<number>`: `PointX`/`PointY` over it then took the
        // element-INDEX reading and folded to `NaN` at bind time, even though
        // the VALUE was a correct list of points. `Multiply` keeps the element
        // tuple through its own collection branch, so this also restores the
        // parity between `p / q` and the algebraically identical `p · (1/q)`.
        // The denominator carries the same obligation as the tuple branch —
        // `tuple / tuple` has no defined quotient — while a COLLECTION of
        // scalars is admitted: it divides the point list elementwise, one
        // scalar per point.
        if (
          typeCouldBeNumericTupleCollection(num.type) &&
          divisorKeepsNumeratorShape(den)
        )
          return BoxedType.forResult(
            quotientShapeType(num.type, den),
            context.engine._typeResolver
          );
        // The broadcast-lifted counterpart, one wrapper out (Tycho item 188):
        // a numerator typed `broadcastable<vector<n>>` — a vector-valued call
        // whose arguments' collection-ness is not statically knowable, e.g. a
        // document row above its callees' definitions — is not a finite
        // number, like the tuple above, so without this branch it
        // fell into the non-finite widening and the quotient dropped its shape
        // (`broadcastable<number>`) while `Add`/`Multiply`/`Subtract`/`Negate`
        // on the same operand keep it. Preserve the base's structure with the
        // same component widening as the tuple branch. The denominator may be
        // a scalar or a broadcast-lifted scalar (`broadcastable<number>` — a
        // scalar, or an indexed collection of scalars that divides
        // elementwise; the numerator's shape survives either way), but a
        // shaped or possibly-shaped denominator disqualifies the claim and
        // falls through to the scalar widening below.
        {
          const nt = num.type;
          if (
            typeof nt !== 'string' &&
            nt.kind === 'broadcastable' &&
            isShapedNumericType(nt.elements) &&
            !isShapedNumericType(den.type)
          )
            return BoxedType.forResult(
              {
                kind: 'broadcastable',
                elements: quotientShapeType(nt.elements, den),
              },
              context.engine._typeResolver
            );
        }
        // A proven-NaN operand: DECLINE, so the claim comes from the
        // declaration and the Contract B derivation rather than from this
        // handler. A handler answer is never widened NOR sharpened by the
        // framework, so answering `number` here would hide whatever the
        // derivation makes of the propagated `NaN` (the `Power`/`Sqrt`
        // precedent). With the declared result already the top numeric
        // type the two answers coincide today; declining is what keeps
        // them from diverging if that result ever narrows.
        if (provablyNaNOperand(den) || provablyNaNOperand(num))
          return undefined;
        // Division by zero: k/0 = ~oo, 0/0 = NaN — indeterminate.
        if (operandLiteralValueOnTypes(den) === 0)
          return BoxedType.forResult('number', context.engine._typeResolver);
        // A non-finite operand: `x/±∞ = 0`, `±∞/finite = ±∞`, but `∞/∞`,
        // `∞/i`, `i/∞` give NaN/~oo. Operands like `Ln(0)`, or a symbol
        // declared `+oo | -oo`, have no value to probe: the descriptor's
        // finiteness fact reads the static type on that path, so it decides
        // them too.
        const nonFinite = operandNonFiniteNumberOnTypes;
        if (nonFinite(den) || nonFinite(num)) {
          // Ruling 2026-08-03 (mirrors the Multiply handler): a provably
          // non-finite REAL numerator over a provably finite, real, provably
          // non-zero denominator is `real ±∞ / finite non-zero real = ±∞`. The
          // non-finite numerator needs no proven sign of its own (`±∞ ≠ 0` is
          // a theorem); the denominator keeps the full obligation.
          // Extended real-ness is required on both — `∞/i = ~oo` is not
          // `+oo | -oo`. The
          // denominator must be PROVABLY finite, not
          // merely "not provably infinite": unknown finiteness admits `∞/∞`,
          // which is NaN.
          if (
            nonFinite(num) &&
            isExtendedRealOperand(num) &&
            den.facts.finite === true &&
            isExtendedRealOperand(den) &&
            provablyNonZeroSign(den)
          )
            return BoxedType.forResult(
              '+oo | -oo',
              context.engine._typeResolver
            );
          // The symmetric claim: a provably finite, real numerator over a
          // provably non-finite REAL denominator is exactly `0`. Both
          // extended-real obligations are load-bearing: `i/∞` and `x/~oo`
          // are not `0`, and
          // an unknown-finiteness numerator admits `∞/∞` = NaN.
          if (
            num.facts.finite === true &&
            isExtendedRealOperand(num) &&
            nonFinite(den) &&
            isExtendedRealOperand(den)
          )
            return BoxedType.forResult('integer', context.engine._typeResolver);
          // Every other non-finite configuration (`∞/∞`, `∞/i`, `i/∞`, an
          // unknown-finiteness numerator or denominator) widens to the top
          // type.
          return BoxedType.forResult('number', context.engine._typeResolver);
        }
        // The two real-quotient rungs (interval-division plan,
        // `docs/plans/2026-08-29-interval-division.md` §3.4–§3.5).
        //
        // A divisor whose range ADMITS zero — and whose sign does not prove
        // it non-zero — makes the quotient a finite real, the projective
        // `~oo` of `1/0` (type `~oo <: infinity`), or the `NaN` of `0/0`:
        // the sound tier is `real | infinity | nan` (user-ruled 2026-08-29;
        // spelled with its branches per lattice ruling L3 rather than the
        // over-admitting `number`, which would also admit a non-real
        // finite complex that a real quotient can never be). Claiming
        // `real` here was a pre-existing unsoundness.
        //
        // A divisor that EXCLUDES zero keeps its tier and gains the
        // quotient interval. The handler reads two operands; a STRUCTURAL
        // n-ary `Divide(a, b, c)` (never canonical) must not get bounds
        // computed from `a / b` alone.
        const bothInteger =
          factsOf(den.type).integer && factsOf(num.type).integer;
        if (
          bothInteger ||
          (isExtendedRealOperand(den) && isExtendedRealOperand(num))
        ) {
          const tier: Type = bothInteger ? 'rational' : 'real';
          const dIv = intervalOfType(den.type);
          const provablyNonZero = provablyNonZeroSign(den);
          // A numerator whose finiteness is NOT proven (`x: real |
          // +oo | -oo`) may be `±∞`, and `∞ / finite` is `±∞`,
          // `∞ / ∞` NaN — neither in the finite tier. A PROVABLY infinite
          // numerator was answered by the non-finite arm above; this is
          // the unknown-finiteness residue (pre-existing: this rung
          // claimed `real` for it before the interval round too).
          if (num.facts.finite !== true)
            return BoxedType.forResult(
              POSSIBLY_ZERO_QUOTIENT_TYPE,
              context.engine._typeResolver
            );
          if (dIv === undefined || !intervalExcludesZero(dIv)) {
            if (!provablyNonZero)
              return BoxedType.forResult(
                POSSIBLY_ZERO_QUOTIENT_TYPE,
                context.engine._typeResolver
              );
            return BoxedType.forResult(tier, context.engine._typeResolver);
          }
          if (ops.length !== 2)
            return BoxedType.forResult(tier, context.engine._typeResolver);
          const nIv = intervalOfType(num.type);
          if (nIv === undefined)
            return BoxedType.forResult(tier, context.engine._typeResolver);
          const q = divIntervals(nIv, dIv);
          return BoxedType.forResult(
            q === undefined ? tier : attachInterval(tier, finalizeInterval(q)),
            context.engine._typeResolver
          );
        }
        // Real/pure-imaginary quotients (mirrors the Multiply type handler;
        // `imaginary`-typed operands are non-zero and non-real by type —
        // `imaginary ∩ real = nothing` in the lattice, and 0 is real):
        // - i/i → real; i/r → pure imaginary; r/i → pure imaginary iff
        //   r ≠ 0 (0/i = 0, which is real, NOT `imaginary`).
        // Possibly-zero *denominators* are treated like the real/real branch
        // above (which claims `real` even when `den` may be 0): only
        // a literal 0 denominator (caught earlier) yields the top type.
        {
          const isImag = (x: OperandDescriptor) => factsOf(x.type).imaginary;
          if (isImag(num) && isImag(den))
            return BoxedType.forResult('real', context.engine._typeResolver);
          if (isImag(num) && isExtendedRealOperand(den))
            return BoxedType.forResult(
              'imaginary',
              context.engine._typeResolver
            );
          if (isExtendedRealOperand(num) && isImag(den))
            return BoxedType.forResult(
              provablyNonZeroSign(num) ? 'imaginary' : 'complex',
              context.engine._typeResolver
            );
          // A quotient of finite complex operands is a finite complex number.
          if (factsOf(num.type).complex && factsOf(den.type).complex)
            return BoxedType.forResult('complex', context.engine._typeResolver);
        }
        return BoxedType.forResult('number', context.engine._typeResolver);
      },

      sgn: (ops) => {
        const [n, d] = [ops[0], ops[1]];
        if (d.isSame(0)) return 'unsigned';
        if (d.isPositive) return n.sgn;
        if (d.isNegative) return oppositeSgn(n.sgn);
        const s = d.sgn;
        if ((n.isSame(0) && s === 'not-zero') || (n.isFinite && d.isInfinity))
          return 'zero';
        if (n.sgn === 'not-zero' && s === 'not-zero') return 'not-zero';
        return undefined;
      },

      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Divide'),
      evaluate: ([num, den], { numericApproximation, engine, expression }) => {
        // Non-lazy operator: operands arrive already evaluated by the
        // driver (`_computeValue` step 4) — do not re-evaluate them.
        const nonNumeric = nonNumericOperandError(engine!, [num, den]);
        if (nonNumeric !== undefined) return nonNumeric;
        // A tuple with a list coordinate is data, not a point: arithmetic
        // over it is an error (see `listCoordinateTupleOperandError`).
        const listTuple = listCoordinateTupleOperandError(engine!, [num, den]);
        if (listTuple !== undefined) return listTuple;
        const evalNum = num;
        const evalDen = den;
        if (
          evalNum.operator === 'Quantity' ||
          evalDen.operator === 'Quantity'
        ) {
          const r = quantityDivide(engine!, evalNum, evalDen);
          if (
            numericApproximation &&
            r &&
            isQuantity(r) &&
            isMeasurement(r.op1)
          )
            return r.N();
          return r;
        }
        if (
          evalNum.operator === 'Measurement' ||
          evalDen.operator === 'Measurement'
        ) {
          const r = measurementDivide(engine!, evalNum, evalDen);
          return numericApproximation ? r?.N() : r;
        }
        // An operand whose float is 0 or ±∞ can have an exact value that is
        // not: `10^{400} + 1` is an integer above the largest double. The
        // quotient is then computed from the exact values, and it can be in
        // the double range: `10^{300} / (10^{400} + 1)` is about `1e-100`,
        // not `1e300 / ∞ = 0`. Only a pure operand is evaluated again.
        if (
          numericApproximation &&
          (isOutOfDoubleRangeLiteral(num) || isOutOfDoubleRangeLiteral(den))
        ) {
          const originals =
            expression && isFunction(expression) ? expression.ops : undefined;
          const q = divideFromExactValues(engine!, originals, [num, den]);
          if (q !== undefined) return q;
        }
        const res = num.div(den);
        if (numericApproximation && res.operator !== 'Divide') return res.N();
        // A quotient that stays a `Divide` can hold an exact factor that
        // the division made: `1/∛(2x + 2)` is `1/(∛2·∛(x + 1))`. Under `N()`
        // its operands are approximated, so `∛2` is a float.
        if (numericApproximation && isFunction(res, 'Divide'))
          return engine!.function('Divide', [res.op1.N(), res.op2.N()]);
        return res;
      },
    },

    Exp: {
      description:
        'Natural exponential function: e^x. Applied to a matrix (or any ' +
        'collection), it broadcasts ELEMENTWISE — it is NOT the matrix ' +
        'exponential e^M (which is not currently implemented).',
      wikidata: 'Q168698',
      broadcastable: true,
      complexity: 3500,

      // Deliberately NOT given a precise domain signature of its own:
      // `Exp(x)` canonicalizes to `Power(e, x)` below, so no `Exp`
      // application survives to be validated or evaluated — its behavior
      // at every exceptional point is `Power`'s, and a precise carrier
      // declared here would be a claim nothing enforces. `Power`'s own
      // flip landed 2026-09-01, and governs: `Exp(~oo)` is an
      // incompatible-type error (the exponent slot excludes `~oo`),
      // `Exp(NaN)` propagates, `Exp(±∞)` keeps its values (+∞ and 0).
      signature: '(number) -> number',
      examples: ['[Exp(1), Exp(Ln(x)), N(Exp(2))]'],
      // Because it gets canonicalized to Power, the sgn handler is not called
      // sgn: ([x]) => {
      //   if (
      //     (x.isNumberLiteral && x.re === -Infinity) ||
      //     (x.isNegative && x.isInfinity)
      //   )
      //     return 'zero';
      //   if (x.isExtendedReal == false && x.isNumberLiteral) {
      //     let n = chop(1 - x.im! / Math.PI) + 1;
      //     return n % 1 !== 0
      //       ? 'unsigned'
      //       : n % 2 === 0
      //         ? 'positive'
      //         : 'negative';
      //   }
      //   if (x.isExtendedReal || (x.isInfinity && x.isPositive))
      //     return 'positive';
      //   return undefined;
      // },
      // Exp(x) -> e^x. The canonical form is the one `makeNumericFunction`
      // (`box.ts`) also computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Exp'),
    },

    Exp2: {
      description: 'Base-2 exponential: 2^x',
      complexity: 3500,
      broadcastable: true,
      signature: '(number) -> number',
      examples: ['[Exp2(10), Exp2(1/2)]'],
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args, 1);
        // See the `Exp` guard above: `['Exp2', 11, 12]` used to canonicalize
        // to `Power(2, 11, Error(…))`.
        if (args.length !== 1 || !args.every((x) => x.isValid))
          return engine._fn('Exp2', args);
        return engine.function('Power', [engine.number(2), ...args]);
      },
    },

    Factorial: {
      description:
        'Factorial function: the product of all positive integers less than or equal to n',
      wikidata: 'Q120976',
      broadcastable: true,
      complexity: 9000,

      // `n!` extends to `Γ(n+1)` for real/complex arguments (as the `evaluate`
      // handler computes), so the signature is the same as `Gamma`'s rather
      // than `(integer) -> integer`. This keeps ill-typed calls (`Factorial("x")`)
      // invalid while honestly typing `Factorial(1/2)` (= Γ(3/2), a real) and
      // `Factorial(i)` (complex) instead of the unsound `integer`.
      //
      // The carrier is every number except NaN: every finite complex point
      // has a value (a pole, `~oo`, at the negative integers), and every
      // infinity is in the carrier with the Γ-family values (`+∞` at `+∞`,
      // `NaN` where there is no limit — `infiniteGammaFamilyValue`). `NaN`
      // propagates (explicit: the carrier is not a subtype of `complex`, so
      // the policy derived from the signature would be `reject`). The
      // result stays the wide `number`: the compiled lanes' kind-preservation
      // discipline reads it (`resultIsComplexValued`), and the type handler
      // carries the per-call sharpness. Its same-head canonical result is
      // checked against this signature by the boxing seam; with every
      // numeric point in the carrier, the evaluate handler then has nothing
      // to enforce but the NaN arm.
      signature: '(complex | infinity) -> number',
      examples: ['[5!, 20!]'],
      nanBehavior: 'propagate',
      // The negative-integer branch widens the claim to `number` on the
      // Γ(x+1) pole. On a compound operand (`Negate(Floor(Abs(r)))`) that
      // negative sign is an operator `sgn` handler's to prove, and the
      // descriptor's sign fact carries it (open item O7 of
      // `docs/plans/2026-08-22-type-handlers-on-types.md`). A provably-NaN
      // operand declines (`specialFunctionType` records what that buys:
      // the derived claim stays `number` for a `number`-result head).
      type: ([x], context) => {
        if (x !== undefined && factsOf(x.type).nan) return undefined;
        const s = x ? operandSgnOnTypes(x) : undefined;
        // A non-negative integer factorial is a (finite) positive integer.
        if (
          x !== undefined &&
          factsOf(x.type).integer &&
          nonNegativeSign(s) === true
        )
          return BoxedType.forResult('integer', context.engine._typeResolver);
        // A *negative* integer is a pole of Γ(x+1): the value is `~oo`,
        // which no finite type admits and which `+oo | -oo` — the
        // SIGNED pair — excludes, so the claim is the top type `number`
        // (non-finite typing convention).
        if (
          x !== undefined &&
          factsOf(x.type).integer &&
          negativeSign(s) === true
        )
          return BoxedType.forResult('number', context.engine._typeResolver);
        // Otherwise it is Γ(x+1); type it like `Gamma`.
        return BoxedType.forResult(
          numericTypeHandlerOnTypes([x]),
          context.engine._typeResolver
        );
      },

      // x! = Γ(x+1): positive for x ≥ 0; a pole (~oo) at negative integers.
      // For a negative NON-integer the value is real with alternating sign
      // between consecutive poles (Γ(1/2) = √π > 0, Γ(-1/2) < 0), so no
      // uniform claim is possible.
      sgn: ([x]) =>
        x.isNonNegative
          ? 'positive'
          : (x.isNegative && x.isInteger) || x.isExtendedReal === false
            ? 'unsigned'
            : undefined,
      canonical: (args, { engine }) => engine._fn('Factorial', [args[0]]),
      evaluate: ([x], { numericApproximation }) => {
        const ce = x.engine;

        // If argument is symbolic (not a number literal), keep unevaluated
        if (!isNumber(x)) return undefined;

        // A `NaN` argument propagates. This handler computes Γ(x+1) itself
        // rather than through the kernel dispatchers, so it does not inherit
        // their NaN-propagation guard (`apply2`, `boxed-expression/apply.ts`),
        // and the non-finiteness test below would otherwise leave `NaN!`
        // inert — inertness as the terminal answer to a decided question,
        // which `docs/ERROR-MODEL.md` §1 forbids.
        if (x.isNaN === true) return ce.NaN;

        // An infinite argument is a decided question as well: `+∞` at `+∞`,
        // NaN at `−∞`, at the unsigned `~∞` and at an anonymous infinity
        // such as `∞ + i` (no limit in any of those). This runs BEFORE the
        // complex arm below, which would otherwise hand `∞ + i` to the
        // complex kernel.
        const infinite = infiniteGammaFamilyValue(x, ce);
        if (infinite !== undefined) return infinite;

        // Is the argument a complex number? `isComplex` decides, but the
        // kernel reads the double `im`: the complex-esm kernels are doubles by
        // nature (docs/plans/2026-09-27-big-decimal-imaginary-part.md §5).
        if (x.isComplex && x.im !== undefined)
          return ce.number(gammaComplex(ce.complex(x.re, x.im).add(1)));

        // The argument is real...
        if (!x.isFinite) return undefined;

        // n! = Γ(n+1). Γ has poles at the non-positive integers, so the
        // factorial of a negative integer is the (unsigned) complex infinity.
        if (x.isNegative) {
          if (x.isInteger) return ce.ComplexInfinity;
          return ce.number(gamma(1 + x.re));
        }
        // A positive *non-integer* real is `Γ(x+1)`, not the rounded-integer
        // factorial — `Factorial(2.5)` is Γ(3.5) ≈ 3.323, not `2`.
        if (!x.isInteger) return ce.number(gamma(1 + x.re));
        // An integer whose factorial has more digits than the exact cap
        // stays symbolic on the exact route (the value is a perfectly good
        // integer the machine cannot hold) and overflows to `+oo` under
        // `numericApproximation`, the float reading of Γ(x+1) there.
        // A float argument with an integer value gives a float: `2.0!` is
        // the float `2`, and above the exact cap the float reading of Γ(x+1).
        const float = !x.isExact;
        if (estimatedFactorialDigits(x.re) > MAX_EXACT_FACTORIAL_DIGITS)
          return numericApproximation || float
            ? ce.number(gamma(1 + x.re))
            : undefined;
        try {
          const result = ce.number(
            run(
              bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
              ce._timeRemaining,
              ce._deadlineFrame
            )
          );
          return float ? asFloat(result) : result;
        } catch (e) {
          if (e instanceof CancellationError) throw e;
          // We can get here if the factorial is too large
          return undefined;
        }
      },
      evaluateAsync: async ([x], { signal, numericApproximation }) => {
        const ce = x.engine;

        // If argument is symbolic (not a number literal), keep unevaluated
        if (!isNumber(x)) return undefined;

        // A `NaN` argument propagates — see the synchronous handler above.
        if (x.isNaN === true) return ce.NaN;

        // `(±∞)!`, `(~∞)!` and `(∞ + i)!` — see the synchronous handler
        // above (this arm runs before the complex one for the same reason).
        const infinite = infiniteGammaFamilyValue(x, ce);
        if (infinite !== undefined) return infinite;

        // Is the argument a complex number? `isComplex` decides, but the
        // kernel reads the double `im`: the complex-esm kernels are doubles by
        // nature (docs/plans/2026-09-27-big-decimal-imaginary-part.md §5).
        if (x.isComplex && x.im !== undefined)
          return ce.number(gammaComplex(ce.complex(x.re, x.im).add(1)));

        // The argument is real...
        if (!x.isFinite) return undefined;

        // n! = Γ(n+1). Γ has poles at the non-positive integers, so the
        // factorial of a negative integer is the (unsigned) complex infinity.
        if (x.isNegative) {
          if (x.isInteger) return ce.ComplexInfinity;
          return ce.number(gamma(1 + x.re));
        }
        // A positive non-integer real is `Γ(x+1)`, not the rounded factorial.
        if (!x.isInteger) return ce.number(gamma(1 + x.re));
        // Above the exact digit cap, and a float argument — see the
        // synchronous handler above.
        const float = !x.isExact;
        if (estimatedFactorialDigits(x.re) > MAX_EXACT_FACTORIAL_DIGITS)
          return numericApproximation || float
            ? ce.number(gamma(1 + x.re))
            : undefined;

        try {
          const result = ce.number(
            await runAsync(
              bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
              (ce._deadline ?? Infinity) - Date.now(),
              signal,
              ce._deadlineFrame
            )
          );
          return float ? asFloat(result) : result;
        } catch (e) {
          if (e instanceof CancellationError) throw e;
          // We can get here if the factorial is too large
          return undefined;
        }
      },
    },

    Factorial2: {
      description: 'Double Factorial Function',
      complexity: 9000,
      broadcastable: true,

      // `n!!` is only computed for integer n (see `evaluate` below), but a
      // symbolic or real-typed argument must still be accepted and stay
      // symbolic rather than erroring — mirror `Factorial`'s signature
      // pattern rather than `(integer) -> integer`. The carrier, the NaN
      // policy and the wide result are `Factorial`'s (see there); the
      // infinite points take the Γ-family values. A non-integer finite
      // argument stays symbolic (no closed form here), which is a
      // capability gap, not an off-carrier point. No `canonical` handler,
      // so a proven off-carrier operand (a string) is rejected at boxing.
      signature: '(complex | infinity) -> number',
      examples: ['[Factorial2(7), Factorial2(8)]'],
      nanBehavior: 'propagate',
      // Same shape as `Factorial` above: the negative-integer branch widens
      // the claim to `number`, and on a compound operand that negative sign
      // is an operator `sgn` handler's to prove — carried by the
      // descriptor's sign fact (open item O7 of
      // `docs/plans/2026-08-22-type-handlers-on-types.md`). A provably-NaN
      // operand declines (`specialFunctionType` records what that buys:
      // the derived claim stays `number` for a `number`-result head).
      type: ([x], context) => {
        if (x !== undefined && factsOf(x.type).nan) return undefined;
        const s = x ? operandSgnOnTypes(x) : undefined;
        if (
          x !== undefined &&
          factsOf(x.type).integer &&
          nonNegativeSign(s) === true
        )
          return BoxedType.forResult('integer', context.engine._typeResolver);
        if (
          x !== undefined &&
          factsOf(x.type).integer &&
          negativeSign(s) === true
        )
          return BoxedType.forResult('number', context.engine._typeResolver);
        return BoxedType.forResult(
          numericTypeHandlerOnTypes([x]),
          context.engine._typeResolver
        );
      },
      // Positive for x ≥ 0; NaN at negative integers (see evaluate). A
      // negative non-integer stays symbolic (its continuation value can be a
      // positive real, e.g. (-1/2)!!), so make no claim.
      sgn: ([x]) =>
        x.isNonNegative
          ? 'positive'
          : (x.isNegative && x.isInteger) || x.isExtendedReal === false
            ? 'unsigned'
            : undefined,
      evaluate: (ops, { numericApproximation }) => {
        // 2^{\frac{n}{2}+\frac{1}{4}(1-\cos(\pi n))}\pi^{\frac{1}{4}(\cos(\pi n)-1)}\Gamma\left(\frac{n}{2}+1\right)

        const x = ops[0];
        // A `NaN` argument propagates, as in `Factorial` above: this handler
        // computes without the kernel dispatchers, so it does not inherit
        // their NaN guard, and the integrality test below would leave `NaN!!`
        // inert — inertness as the terminal answer to a decided question,
        // which `docs/ERROR-MODEL.md` §1 forbids.
        if (x.isNaN === true) return x.engine.NaN;
        // `n!!` at an infinite argument has the same limits as `n!`: the
        // double factorial only thins the product, so it still diverges to
        // `+∞` at `+∞`, and it inherits the poles of Γ going the other way.
        // This arm is also what stops `(~∞)!!` from staying inert on the
        // integrality test below, where the rest of the family answers NaN.
        const infinite = infiniteGammaFamilyValue(x, x.engine);
        if (infinite !== undefined) return infinite;
        // The double factorial of a non-integer is an exact constant with no
        // simple closed form here, so stay symbolic rather than rounding the
        // argument to an integer (which non-strict mode would otherwise allow).
        if (x.isInteger !== true) return undefined;
        const n = toInteger(x);
        if (n === null) return undefined;
        const ce = x.engine;
        // `n!!` has about half the digits of `n!`. Above the exact digit
        // cap the bignum loop below (one step per two integers up to `n`,
        // the operand growing at every step) is impractical, so the value
        // stays symbolic on the exact route and overflows to `+oo` under
        // `numericApproximation` — the `Factorial` convention. The cap
        // asks only for a non-negative `n`: the digit estimate is
        // `Infinity` for a negative one, whose kernels answer NaN below.
        if (
          n >= 0 &&
          estimatedFactorialDigits(n) / 2 > MAX_EXACT_FACTORIAL_DIGITS
        )
          return numericApproximation || hasFloatOperand([x])
            ? ce.number(factorial2(n))
            : undefined;
        // The big-decimal product of integers is exact, so the result is an
        // exact integer at any magnitude (`ce.number()` of an integer-valued
        // big decimal), not a numeric result. A float argument with an
        // integer value gives a float: `3.0!!` is the float `3`.
        if (bignumPreferred(ce))
          return floatIfFloatOperand(
            [x],
            ce.number(
              run(
                bigFactorial2(ce.bignum(n)),
                ce._timeRemaining,
                ce._deadlineFrame
              )
            )
          );

        return floatIfFloatOperand([x], ce.number(factorial2(n)));
      },
    },

    Floor: {
      description: 'Rounds a number down to the nearest integer.',
      keywords: ['round down', 'integer part'],
      wikidata: 'Q56860783',
      complexity: 1250,
      broadcastable: true,

      // Same domain-signature shape and rationale as `Ceil` above: the
      // extended-real carrier (`Floor(±∞) = ±∞`), `NaN` propagated by the
      // generic gate, a proven off-carrier operand a boxing error, and
      // the slim handler narrowing to `integer` / the signed pair where
      // the operand proves it.
      signature: '(real | signed_infinity) -> integer | signed_infinity',
      examples: ['[Floor(2.7), Floor(-2.3)]'],
      nanBehavior: 'propagate',
      partiality: 'total',
      type: ([x], context) =>
        BoxedType.forResult(
          roundingFunctionTypeOnTypes(x),
          context.engine._typeResolver
        ),
      sgn: ([x]) => {
        const one = x.engine.One;
        if (x.isNegative) return 'negative';
        if (isOrdered(x, '>=', one)) return 'positive';
        if (x.isNonNegative && isOrdered(x, '<', one)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, expression }) =>
        applyRounding(
          x,
          'floor',
          Math.floor,
          (x) => x.floor(),
          numericApproximation,
          originalOperand(expression, 0)
        ),
    },

    Fract: {
      description: 'Fractional part of a number: x - floor(x)',
      complexity: 1250,
      broadcastable: true,
      // The same carrier as `Floor`: `x − floor(x)` needs the order of the
      // real line, so a non-real operand is off-carrier (a boxing error —
      // this head has no `canonical` handler and no fast path, so the
      // boxing seam decides; `Fract(2 + 3i)` used to answer `0`). The
      // signed infinities are IN the carrier but have no fractional part:
      // `∞ − floor(∞)` is `∞ − ∞`, and `x − floor(x)` has no limit at
      // either end (it sweeps `[0, 1)` forever), so `definedWhen` names the
      // finiteness condition and the gate answers the codomain marker,
      // `Indeterminate` (the form `∞ − ∞`, as `x − Floor(x)` composes).
      // `NaN` propagates. The
      // successes lie in `[0, 1)`; `real<0..1>` is the closest declared
      // spelling, and it is sharp enough that no type handler is needed —
      // the framework adds `| nan` while the operand is not proven finite.
      // Ruling recorded in `docs/plans/2026-08-30-error-model-implementation.md`,
      // Phase F batch 10.
      signature: '(real | signed_infinity) -> real<0..1>',
      examples: ['[Fract(3.75), Fract(-3.25)]'],
      nanBehavior: 'propagate',
      definedWhen: ([x]) => {
        if (x === undefined) return undefined;
        // The STATIC type decides for a symbol or a compound (`Fract(r + 1)`
        // for `r: real`): bare `real` names the finite reals. The value
        // predicates are type-blind on compounds, so they are asked of a
        // literal only.
        if (x.type.matches('real')) return true;
        if (!isNumber(x)) return undefined;
        // Only the two SIGNED infinities are inside the carrier and decided
        // here; `~oo` and an anonymous infinity are outside it, and the
        // carrier — not this predicate — refuses them (a `false` would put
        // the marker where the carrier error belongs for a value a symbol
        // holds, because the partiality gate runs before the dispatch
        // conformance re-test).
        const point = infinitePoint(x);
        if (point === '+oo' || point === '-oo') return false;
        if (point !== undefined) return undefined;
        if (x.isFinite === true) return true;
        return undefined;
      },
      // The fractional part of EVERY finite real is in `[0, 1)` (the floored
      // convention: `Fract(−7/2) = 1/2`), so the claim does not depend on the
      // operand's sign. A NaN or an infinite operand has the NaN value.
      sgn: ([x]) => {
        if (x.isNaN === true || (isNumber(x) && x.isInfinity === true))
          return 'unsigned';
        if (x.isFinite === true && x.isExtendedReal === true)
          return 'non-negative';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, engine: ce, expression }) => {
        // Exact fractional part for an exact real argument: x - floor(x),
        // computed exactly (rational arithmetic) so `Fract(1/2) → 1/2`, not
        // `0.5`. Only an inexact (float) argument numericizes.
        if (!numericApproximation && isNumber(x) && x.isExact && !x.isComplex) {
          const fl = ce.function('Floor', [x]).evaluate();
          if (isNumber(fl) && fl.isExact)
            return ce.function('Subtract', [x, fl]).evaluate();
        }
        // An exact constant expression that is not a number: `x − k`, where
        // `k` is the floor of `x` decided from enclosures
        // (`roundExactConstant()`). `Fract(π)` is `π − 3`, as Mathematica's
        // `FractionalPart[Pi]`. Under `.N()`, the original operand is used,
        // as in `applyRounding()`, and the value of `x − k` is computed at a
        // raised precision (`exactConstantValue()`): at the working
        // precision, the float of `π·10³⁰` has no fractional digits. A value
        // that is at an integer at the precision limit (with a narrow
        // enclosure) has the fractional part 0 under `.N()`. When the value
        // is not known, the float decides (below).
        const constant = numericApproximation
          ? originalOperand(expression, 0)
          : x;
        if (constant !== undefined) {
          const k = roundExactConstant(constant, 'floor', numericApproximation);
          if (k !== undefined) {
            const fract = ce.function('Subtract', [constant, ce.number(k)]);
            if (!numericApproximation) return fract.evaluate();
            const value = exactConstantValue(fract);
            if (value !== undefined) return ce.number(ce._numericValue(value));
          }
        }
        // Under `.N()`, an operand whose exact value is known
        // (`exactRoundingOperand()`) has its fractional part computed
        // exactly, and the result is approximated. The float of
        // `(25! − 1)/3` at 21 digits has no fractional digits left, so
        // `x − floor(x)` of the float is `0`, not `0.666…`.
        if (numericApproximation) {
          const exact = exactRoundingOperand(
            x,
            'floor',
            originalOperand(expression, 0)
          );
          const k =
            exact === undefined ? undefined : roundExactReal(exact, 'floor');
          if (exact !== undefined && k !== undefined)
            return ce
              .function('Subtract', [exact, ce.number(k)])
              .evaluate()
              .N();
        }
        return apply(
          x,
          (x) => x - Math.floor(x),
          (x) => x.sub(x.floor()),
          (z) => z.sub(z.floor(0))
        );
      },
    },

    Gamma: {
      description:
        'Gamma function Γ(z); with two arguments, the upper incomplete gamma Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt.',
      wikidata: 'Q190573',
      complexity: 8000,
      broadcastable: true,
      // The carrier is every number except NaN, on both slots: every finite
      // complex point has a value (a pole, `~oo`, at the non-positive
      // integers), and every infinity is in the carrier with the Γ-family
      // values — `Γ(+∞) = +∞`, `NaN` at `−∞`, `~oo` and an anonymous
      // infinity (`infiniteGammaFamilyValue`); the incomplete form's
      // infinite points are `incompleteGammaValueAtInfinity`'s. `NaN`
      // propagates (explicit: the carrier is not a subtype of `complex`, so
      // the policy derived from the signature would be `reject`). The
      // result stays the wide `number` (the compiled lanes read it —
      // `resultIsComplexValued` — and the type handler carries the per-call
      // sharpness). No `canonical` handler and no fast path, so a proven
      // off-carrier operand is rejected at BOXING; with every numeric
      // point in the carrier, that seam only ever sees a non-number.
      signature: '(complex | infinity, (complex | infinity)?) -> number',
      examples: ['[Gamma(1/2), N(Gamma(1/2)), N(Gamma(5))]', 'N(Gamma(2, 1))'],
      nanBehavior: 'propagate',
      // Γ(z) has poles (value `~oo`) at the non-positive integers; the
      // incomplete Γ(s, z) keeps the generic handler. A provably-NaN
      // operand declines (`specialFunctionType` records what that buys:
      // the derived claim stays `number` for a `number`-result head).
      type: (ops, context) =>
        BoxedType.forResult(
          ops.length === 1
            ? gammaPoleTypeOnTypes(ops[0])
            : specialFunctionType(ops),
          context.engine._typeResolver
        ),

      // Γ is positive on the positive reals; 0 and the negative integers are
      // poles (value ~oo, hence 'unsigned' — NOT 'zero': Γ never vanishes).
      // On a negative non-integer the sign alternates between consecutive
      // poles, so make no claim.
      sgn: (ops) =>
        ops.length === 1
          ? ops[0].isPositive
            ? 'positive'
            : ops[0].isSame(0) ||
                (ops[0].isNegative && ops[0].isInteger) ||
                ops[0].isExtendedReal === false
              ? 'unsigned'
              : undefined
          : undefined,
      evaluate: (ops, { numericApproximation, engine }) => {
        // Upper incomplete gamma Γ(s, z) (Mathematica/Rubi `Gamma[s, z]`).
        if (ops.length === 2) {
          const [s, z] = ops;
          // The infinite points (`Γ(s, +∞) = 0`, `Γ(±∞, z)`, `NaN` for the
          // rest) are exact, so they are answered regardless of
          // numericApproximation.
          const infinite = incompleteGammaValueAtInfinity(s, z, engine);
          if (infinite !== undefined) return infinite;
          // Γ(s, 0) = Γ(s): reduce so the 1-arg exact paths (incl. poles)
          // apply.
          if (isNumber(z) && z.isSame(0))
            return engine.function('Gamma', [s]).evaluate({
              numericApproximation,
            });
          return shouldNumericize(numericApproximation, s, z)
            ? applyN(
                [s, z],
                (s, z) => incompleteGammaUpper(s, z),
                undefined,
                (s, z) => incompleteGammaUpperComplex(s, z)
              )
            : undefined;
        }

        const x = ops[0];
        // Gamma has poles at the non-positive integers (0, -1, -2, ...).
        // This is exact, so return it regardless of numericApproximation.
        if (isNumber(x) && !x.isComplex && x.isInteger && x.isNonPositive)
          return engine.ComplexInfinity;
        // Γ at an infinite argument. Also exact, so it does not wait for
        // `numericApproximation` either.
        const infinite = infiniteGammaFamilyValue(x, engine);
        if (infinite !== undefined) return infinite;
        return shouldNumericize(numericApproximation, x)
          ? apply(
              x,
              (x) => gamma(x),
              (x) => bigGamma(engine, x),
              (x) => gammaComplex(x)
            )
          : undefined;
      },
    },

    GammaLn: {
      description: 'Natural logarithm of the gamma function.',
      complexity: 8000,
      broadcastable: true,
      // Carrier, NaN policy, result and seam as for `Gamma` (see there):
      // `ln Γ` has a value at every finite complex point (`+∞` at the
      // poles) and takes the Γ-family values at the infinite points.
      signature: '(complex | infinity) -> number',
      examples: ['N(GammaLn(100))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          gammaPoleTypeOnTypes(ops[0]),
          context.engine._typeResolver
        ),

      evaluate: (ops, { numericApproximation, engine }) => {
        const x = ops[0];
        // At the poles of Γ (the non-positive integers) |Γ| → ∞, so
        // ln Γ → +∞ (as in Mathematica's LogGamma and SymPy's loggamma).
        // This is exact, so return it regardless of numericApproximation.
        if (isNumber(x) && !x.isComplex && x.isInteger && x.isNonPositive)
          return engine.PositiveInfinity;
        // ln Γ(x) → +∞ as x → +∞ (ln Γ(10¹²) ≈ 2.66·10¹³), and it has no
        // limit as x → −∞, nor at the unsigned `~∞` — same reasons as Γ
        // itself.
        const infinite = infiniteGammaFamilyValue(x, engine);
        if (infinite !== undefined) return infinite;
        return shouldNumericize(numericApproximation, x)
          ? apply(
              x,
              (x) => gammaln(x),
              (x) => bigGammaln(engine, x),
              (x) => lngammaComplex(x)
            )
          : undefined;
      },
    },

    // Digamma function ψ(x) = d/dx ln(Γ(x)) = Γ'(x)/Γ(x)
    // Also known as the psi function
    Digamma: {
      description:
        'Digamma function, the logarithmic derivative of the gamma function',
      wikidata: 'Q905326',
      complexity: 8200,
      broadcastable: true,
      // Carrier, NaN policy, result and seam as for `Gamma` (see there).
      // The values at the exceptional points — `ψ(+∞) = +∞`, `NaN` at `−∞`,
      // `~oo` and an anonymous infinity, `~oo` at the poles — are
      // `polygammaValueAtExceptionalPoint`'s, answered on both routes. A
      // non-real finite argument uses the complex kernel of `PolyGamma`
      // (`polygammaComplex` of order 0).
      signature: '(complex | infinity) -> number',
      examples: ['[Digamma(1), N(Digamma(1))]'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          gammaPoleTypeOnTypes(ops[0]),
          context.engine._typeResolver
        ),
      evaluate: ([x], { numericApproximation, engine }) => {
        const special = polygammaValueAtExceptionalPoint(0, x, engine);
        if (special !== undefined) return special;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        const result = apply(
          x,
          digamma,
          (x) => bigDigamma(engine, x),
          (x) => polygammaComplex(0, x)
        );
        // As for `PolyGamma` below: a NaN from the complex kernel is a
        // decline, and the application stays symbolic.
        if (result?.isNaN === true && isNumber(x) && x.isComplex && !x.isNaN)
          return undefined;
        return result;
      },
    },

    // Trigamma function ψ₁(x) = d/dx ψ(x) = d²/dx² ln(Γ(x))
    // The derivative of the digamma function
    Trigamma: {
      description: 'Trigamma function, the derivative of the digamma function',
      wikidata: 'Q1244426',
      complexity: 8400,
      broadcastable: true,
      // As `Digamma` above: the exceptional points are
      // `polygammaValueAtExceptionalPoint`'s (`ψ₁(+∞) = 0`).
      signature: '(complex | infinity) -> number',
      examples: ['N(Trigamma(1))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          gammaPoleTypeOnTypes(ops[0]),
          context.engine._typeResolver
        ),
      evaluate: ([x], { numericApproximation, engine }) => {
        const special = polygammaValueAtExceptionalPoint(1, x, engine);
        if (special !== undefined) return special;
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        const result = apply(
          x,
          trigamma,
          (x) => bigTrigamma(engine, x),
          (x) => polygammaComplex(1, x)
        );
        // As for `PolyGamma` below: a NaN from the complex kernel is a
        // decline, and the application stays symbolic.
        if (result?.isNaN === true && isNumber(x) && x.isComplex && !x.isNaN)
          return undefined;
        return result;
      },
    },

    // PolyGamma function ψₙ(x) = dⁿ/dxⁿ ψ(x)
    // The n-th derivative of the digamma function
    // PolyGamma(0, x) = Digamma(x), PolyGamma(1, x) = Trigamma(x)
    PolyGamma: {
      description:
        'Polygamma function, the n-th derivative of the digamma function',
      wikidata: 'Q857956',
      complexity: 8500,
      broadcastable: true,
      // The order stays `integer` (the kernels are defined for integer
      // orders only); the argument slot is the Γ-family carrier, as for
      // `Digamma` above. The exceptional points of the argument are
      // `polygammaValueAtExceptionalPoint`'s and need a KNOWN non-negative
      // order (`+∞` for order 0 at `+∞`, else 0; `~oo` at the poles); a
      // symbolic or negative order leaves them symbolic. A non-real finite
      // argument uses `polygammaComplex` (cortex-js/compute-engine#340),
      // shared with `Digamma` and `Trigamma`: ψ⁽ᵐ⁾(z) = (−1)^(m+1)·m!·ζ(m+1, z)
      // for m >= 1 (DLMF 5.15.2), an asymptotic series for m = 0, and the
      // reflection formula left of the imaginary axis.
      signature: '(order: integer, complex | infinity) -> number',
      examples: ['N(PolyGamma(2, 1))'],
      nanBehavior: 'propagate',
      // ψⁿ(x) has poles (value `~oo`) at the non-positive integers. A
      // provably-NaN operand declines (`specialFunctionType` records what
      // that buys: the derived claim stays `number` for a `number`-result
      // head).
      type: ([n, x], context) => {
        if (
          (n !== undefined && factsOf(n.type).nan) ||
          (x !== undefined && factsOf(x.type).nan)
        )
          return undefined;
        return BoxedType.forResult(
          x !== undefined &&
            factsOf(x.type).integer &&
            nonPositiveSign(operandSgnOnTypes(x)) === true
            ? 'number'
            : numericTypeHandlerOnTypes([n, x]),
          context.engine._typeResolver
        );
      },
      evaluate: ([n, x], { numericApproximation, engine }) => {
        const order = asSmallInteger(n);
        const special = polygammaValueAtExceptionalPoint(order, x, engine, n);
        if (special !== undefined) return special;
        // ψ⁽⁻¹⁾(z) = ln Γ(z), Wolfram's and mpmath's convention for the
        // antiderivative of the digamma: the continuation `LogGamma`
        // computes, not the principal `GammaLn`.
        if (order === -1) {
          const logGamma = engine.function('LogGamma', [x]);
          return numericApproximation ? logGamma.N() : logGamma.evaluate();
        }
        // The kernels implement the derivative orders only (n ≥ 0): any
        // other negative literal order is a capability gap, so the
        // application stays symbolic instead of reporting the kernel's `NaN`.
        if (order !== null && order < 0) return undefined;
        if (!shouldNumericize(numericApproximation, n, x)) return undefined;
        const result = apply2(
          n,
          x,
          (n, x) => polygamma(n, x),
          (n, x) => bigPolygamma(engine, n, x),
          (n, x) => polygammaComplex(n.re, x)
        );
        // The kernels answer NaN where they cannot give an accurate value:
        // the order is above `POLYGAMMA_MAX_ORDER` (all three kernels), the
        // value overflows or underflows a double (the machine and complex
        // kernels), or cancellation leaves no accurate digits (the complex
        // kernel). The argument is then a finite ordinary point (the
        // exceptional points and a negative order returned above), so stay
        // symbolic rather than report `NaN`. A NaN operand has no small
        // integer order or is itself NaN, and still propagates.
        if (result?.isNaN === true && order !== null && isNumber(x) && !x.isNaN)
          return undefined;
        return result;
      },
    },

    // Riemann zeta function ζ(s) = Σ_{n=1}^∞ 1/n^s, and its two-argument
    // (Hurwitz) form ζ(s,a) = Σ_{n=0}^∞ (n+a)^{-s} — Wolfram's `Zeta[s,a]`;
    // `HurwitzZeta` below is the same function under its own name.
    // Converges for Re(s) > 1, analytically continued elsewhere
    Zeta: {
      description:
        'Riemann zeta function; with two arguments, the Hurwitz zeta function ζ(s,a) = Σ_{n=0}^∞ (n+a)^{-s}.',
      wikidata: 'Q187235',
      complexity: 8500,
      broadcastable: true,
      // The carrier is every number except NaN: ζ has a value at every
      // finite complex point (the pole `~oo` at 1 — `ζ(1 ± 10⁻⁹) = ±10⁹`,
      // so the pole has no sign), and the infinite points are in the
      // carrier: `ζ(+∞) = 1` (ζ(100) = 1 to 30 digits), and
      // `Indeterminate` at `−∞` (the trivial zeros at the even negative
      // integers alternate with values like ζ(−10⁶ − ½) = −10^4767531: no
      // limit) and at `~oo`; `NaN` at an anonymous infinity (a float
      // literal). `NaN` propagates (explicit: the carrier is
      // not a subtype of `complex`). No `canonical` handler, so a proven
      // off-carrier operand is rejected at boxing. The two-argument form
      // keeps the generic `specialFunctionType` claim below rather than the
      // single-argument pole refinement.
      signature: '(complex | infinity, (complex | infinity)?) -> number',
      examples: ['[Zeta(2), Zeta(-1), N(Zeta(3))]'],
      nanBehavior: 'propagate',
      // ζ(1) is the pole; its value `~oo` is neither finite nor a member of
      // the signed pair `+oo | -oo`, so only `number` admits it. The
      // pole test is the literal-value channel: `isSame` is strictly
      // syntactic, so only a literal 1 ever answered `true` here, and
      // `operandLiteralValue` selects exactly that population. A
      // provably-NaN operand declines (`specialFunctionType` records what
      // that buys: the derived claim stays `number` for a `number`-result
      // head).
      type: (ops, context) => {
        // Two operands: real at real operands in Wolfram's convention (the
        // terms off the positive axis are |k + a|^(−s)), except at the pole
        // s = 1, detected on the same literal-value channel as below.
        if (ops.length === 2) {
          const t = specialFunctionType(ops);
          const pole =
            ops[0] !== undefined && operandLiteralValueOnTypes(ops[0]) === 1;
          return BoxedType.forResult(
            pole && t !== undefined ? 'number' : t,
            context.engine._typeResolver
          );
        }
        const x = ops[0];
        if (x !== undefined && factsOf(x.type).nan) return undefined;
        return BoxedType.forResult(
          x !== undefined && operandLiteralValueOnTypes(x) === 1
            ? 'number'
            : numericTypeHandlerOnTypes([x]),
          context.engine._typeResolver
        );
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        // Hurwitz zeta ζ(s,a) — Wolfram's `Zeta[s,a]`, the same function
        // `HurwitzZeta` below declares under its own name.
        if (ops.length === 2)
          return evaluateGeneralizedZeta(
            engine,
            ops[0],
            ops[1],
            numericApproximation
          );

        const x = ops[0];
        // The pole and the infinite points are exact, so they are answered
        // on both routes, before the kernel is consulted.
        if (isNumber(x)) {
          const point = infinitePoint(x);
          if (point === '+oo') return engine.One;
          // No limit at `−∞` or `~oo`: the indeterminate form (`NaN` for an
          // anonymous infinity such as `∞ + i`, a float literal).
          if (point !== undefined) return indeterminateFormAnswer(engine, [x]);
          if (!x.isComplex && x.isSame(1)) return engine.ComplexInfinity;
        }
        if (shouldNumericize(numericApproximation, x))
          return apply(x, zeta, (x) => bigZeta(engine, x), zetaComplex);

        // Exact values at integer literals (via exact Bernoulli rationals):
        // - ζ(2k) = (−1)^{k+1}·B₂ₖ·(2π)^{2k}/(2·(2k)!) → rational · π^{2k}
        //   (ζ(2) = π²/6, ζ(4) = π⁴/90, ζ(6) = π⁶/945, …)
        // - ζ(0) = −1/2; ζ(1) is a pole → ComplexInfinity
        // - ζ(−n) = −Bₙ₊₁/(n+1): ζ(−1) = −1/12, ζ(−3) = 1/120, and
        //   ζ(−2k) = 0 (the trivial zeros)
        // - ζ(3), ζ(5), … have no known closed form: stay symbolic
        // Capped at |s| ≤ 100 to avoid huge factorials; beyond, stay
        // symbolic (the numeric path is unaffected).
        const n = asSmallInteger(x);
        if (n === null || !Number.isInteger(n) || Math.abs(n) > 100)
          return undefined;
        if (n === 1) return engine.ComplexInfinity;
        if (n === 0) return engine.number([-1, 2]);
        if (n < 0) {
          if (n % 2 === 0) return engine.Zero;
          return engine.number(zetaNegativeInteger(-n));
        }
        if (n % 2 === 0)
          return engine
            .number(zetaEvenCoefficient(n / 2))
            .mul(engine.Pi.pow(n));
        return undefined;
      },
    },

    // Hurwitz zeta function ζ(s,a) = Σ_{n=0}^∞ (n+a)^{-s}, under Wolfram's
    // own name for it. An alias for the two-argument form of `Zeta` above —
    // both declarations share the same evaluation and closed forms; keeping
    // them as separate library entries (rather than a `Zeta` alias) matches
    // how the fungrim simplification rules already reference `HurwitzZeta`
    // as its own head.
    HurwitzZeta: {
      description: 'Hurwitz zeta function ζ(s,a) = Σ_{n=0}^∞ (n+a)^{-s}',
      wikidata: 'Q1638777',
      complexity: 8500,
      broadcastable: true,
      // The optional third operand is an nth-derivative order (fungrim's
      // `HurwitzZeta(s, a, n)`, the ∂ⁿ/∂aⁿ ζ(s,a) identity rules) — no
      // evaluate handler here implements it, so a 3-operand call stays
      // symbolic, but the signature still admits it: those rules box
      // against this same head and must not fail to box.
      signature: '(complex | infinity, complex | infinity, integer?) -> number',
      examples: ['HurwitzZeta(2, 2)'],
      nanBehavior: 'propagate',
      // Real operands give a real value only on the real branch: a proven
      // positive a (no (k + a) ≤ 0 term) and s not the pole 1 (the
      // literal-value channel, as for `Zeta`). Elsewhere the value can be
      // complex (HurwitzZeta(0.5, −0.5) = −0.605 − 1.414i) or the pole `~oo`
      // (a non-positive integer a with Re(s) > 0), so the claim is `number`.
      type: (ops, context) => {
        const t = specialFunctionType(ops);
        const [s, a] = ops;
        const realBranch =
          a !== undefined &&
          operandSgnOnTypes(a) === 'positive' &&
          !(s !== undefined && operandLiteralValueOnTypes(s) === 1);
        return BoxedType.forResult(
          t !== undefined && !realBranch ? 'number' : t,
          context.engine._typeResolver
        );
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        if (ops.length !== 2) return undefined;
        return evaluateHurwitzZeta(
          engine,
          ops[0],
          ops[1],
          numericApproximation
        );
      },
    },

    // Dirichlet eta η(s) = Σ_{n≥1} (−1)^(n−1) n^(−s), entire. Wolfram's
    // `DirichletEta`.
    DirichletEta: {
      description:
        'Dirichlet eta function η(s) = Σ_{n≥1} (−1)^(n−1)/n^s = (1 − 2^(1−s)) ζ(s), entire; η(1) = ln 2, η(+∞) = 1.',
      complexity: 8500,
      broadcastable: true,
      signature: '(complex | infinity) -> number',
      examples: ['[DirichletEta(2), DirichletEta(1), N(DirichletEta(1/2))]'],
      nanBehavior: 'propagate',
      evaluate: (ops, { numericApproximation, engine }) =>
        ops.length === 1
          ? evaluateDirichletEta(engine, ops[0], numericApproximation)
          : undefined,
    },

    // Dirichlet beta β(s) = Σ_{n≥0} (−1)^n (2n+1)^(−s), entire. Wolfram's
    // `DirichletBeta` (mpmath `dirichlet(s, [0, 1, 0, -1])`).
    DirichletBeta: {
      description:
        'Dirichlet beta function β(s) = Σ_{n≥0} (−1)^n/(2n+1)^s = 4^(−s) (ζ(s, 1/4) − ζ(s, 3/4)), entire; β(1) = π/4, β(2) = G, β(+∞) = 1.',
      complexity: 8500,
      broadcastable: true,
      signature: '(complex | infinity) -> number',
      examples: ['[DirichletBeta(1), DirichletBeta(3), N(DirichletBeta(1/2))]'],
      nanBehavior: 'propagate',
      evaluate: (ops, { numericApproximation, engine }) =>
        ops.length === 1
          ? evaluateDirichletBeta(engine, ops[0], numericApproximation)
          : undefined,
    },

    // Lerch transcendent Φ(z,s,a) = Σ_{k=0}^∞ zᵏ(k+a)^{-s} (Wolfram's
    // `LerchPhi[z,s,a]`), generalizing the Hurwitz zeta above (z = 1,
    // folded into `HurwitzZeta`) and the polylogarithm (a = 1, not wired
    // up here — a separate widening of `PolyLog`).
    LerchPhi: {
      description: 'Lerch transcendent Φ(z,s,a) = Σ_{k=0}^∞ zᵏ(k+a)^{-s}',
      complexity: 8600,
      broadcastable: true,
      // Every operand is a finite complex number: no infinite-point limit
      // is implemented here (unlike `Zeta`/`HurwitzZeta` above), so the
      // signature does not admit an infinite operand, and
      // `LerchPhi(0.5, +oo, 2)` is an `incompatible-type` error.
      signature: '(complex, complex, complex) -> number',
      nanBehavior: 'propagate',
      // Real only on the branch-cut-free, real-operand side: a > 0 keeps
      // every term's base (k+a) positive, so its (−s) power is real for a
      // real s, and a real z < 1 keeps z off the [1, ∞) branch cut, where
      // the value is complex (LerchPhi(3, 2, 1) ≈ 0.773 − 1.150i) or the
      // pole at z = 1 (LerchPhi(1, 1, 1)). z must be proven below 1: a
      // literal, or a type bounded below 1. Elsewhere (a ≤ 0, z not proven
      // below 1, or any non-real operand) the value can be complex, or the
      // pole `~oo` (a non-positive integer a with Re(s) > 0), so the claim
      // stays `number` there — matching `evaluateLerchPhi`'s `real`
      // predicate, less precisely since the s-integer case isn't visible
      // to the type layer.
      type: (ops, context) => {
        const t = specialFunctionType(ops);
        const [z, , a] = ops;
        const realBranch =
          z !== undefined &&
          provablyLessOnTypes(z, 1) &&
          a !== undefined &&
          operandSgnOnTypes(a) === 'positive';
        return BoxedType.forResult(
          t !== undefined && !realBranch ? 'number' : t,
          context.engine._typeResolver
        );
      },
      evaluate: (ops, { numericApproximation, engine, expression }) => {
        if (ops.length !== 3) return undefined;
        return evaluateLerchPhi(
          engine,
          ops[0],
          ops[1],
          ops[2],
          numericApproximation,
          expression
        );
      },
    },

    // Beta function B(a,b) = Γ(a)Γ(b)/Γ(a+b) = ∫₀¹ t^(a-1)(1-t)^(b-1) dt
    Beta: {
      description: 'Euler beta function',
      wikidata: 'Q468881',
      complexity: 8200,
      broadcastable: true,
      // Both slots take the Γ-family carrier (`Gamma` says why): every
      // finite complex point has a value (a Γ-pole, `~oo`, where an operand
      // is a non-positive integer and nothing cancels it), and the infinite
      // points are `betaValueAtInfinity`'s. `NaN` propagates (explicit: the
      // carrier is not a subtype of `complex`). No `canonical` handler, so
      // a proven off-carrier operand is rejected at boxing. A non-real
      // finite operand stays symbolic — no complex kernel.
      signature: '(complex | infinity, complex | infinity) -> number',
      examples: ['[Beta(2, 3), N(Beta(1/2, 1/2))]'],
      nanBehavior: 'propagate',
      // B(a, b) has Γ-poles (value `~oo`) where a or b is a non-positive
      // integer (unless cancelled). Such an argument may be a pole → claim the
      // top type `number` per the non-finite typing convention, rather than
      // `real`. (`B(−2, 2) = 1/2` is finite but `number` still admits it.)
      type: (ops, context) => {
        const nonposInt = (x: OperandDescriptor | undefined) =>
          x !== undefined &&
          factsOf(x.type).integer &&
          nonPositiveSign(operandSgnOnTypes(x)) === true;
        if (nonposInt(ops[0]) || nonposInt(ops[1]))
          return BoxedType.forResult('number', context.engine._typeResolver);
        return BoxedType.forResult(
          numericTypeHandlerOnTypes(ops),
          context.engine._typeResolver
        );
      },
      evaluate: ([a, b], { numericApproximation, engine }) => {
        // The infinite points are exact, so they are answered on both
        // routes (the exact rational form below already answered 0 for a
        // SIGNED infinity against a positive-integer partner; `~oo` and the
        // other combinations fell through to the kernel).
        const infinite = betaValueAtInfinity(a, b, engine);
        if (infinite !== undefined) return infinite;
        // Exact reductions and Γ-pole handling for real (im === 0) arguments.
        // The naive B(a,b) = Γ(a)Γ(b)/Γ(a+b) formula turns the Γ-pole at a
        // non-positive integer into silent overflow garbage (e.g. B(−1, 2)
        // → −2.97e49); the exact rational form below is correct on both the
        // finite (`B(−2, 2) = 1/2`) and the pole (`B(−1, 2) = ~oo`) branches.
        if (isNumber(a) && isNumber(b) && !a.isComplex && !b.isComplex) {
          const ai = a.isInteger ? asSmallInteger(a) : null;
          const bi = b.isInteger ? asSmallInteger(b) : null;
          // B(a, m) = (m−1)! / (a(a+1)…(a+m−1)) — an exact rational function of
          // a valid at every a (with a pole where the denominator vanishes).
          let reduced: Expression | undefined;
          if (bi !== null && bi > 0)
            reduced = betaPositiveIntegerArg(engine, a, bi);
          else if (ai !== null && ai > 0)
            reduced = betaPositiveIntegerArg(engine, b, ai);
          // A float argument gives a float: `B(1.0, 1)` is the float `1`.
          if (reduced !== undefined)
            return floatIfFloatOperand(
              [a, b],
              numericApproximation ? reduced.N() : reduced
            );
          // Remaining pole cases: a or b a non-positive integer with no
          // positive-integer partner to cancel it → Γ-pole (B is infinite).
          if ((ai !== null && ai <= 0) || (bi !== null && bi <= 0))
            return engine.ComplexInfinity;
        }
        return shouldNumericize(numericApproximation, a, b)
          ? apply2(a, b, beta, (a, b) => bigBeta(engine, a, b))
          : undefined;
      },
    },

    // Lambert W function: W(x)·e^(W(x)) = x
    // Also known as the product logarithm or omega function
    LambertW: {
      description: 'Lambert W function (product logarithm)',
      keywords: ['product log', 'omega function'],
      wikidata: 'Q429331',
      complexity: 8300,
      broadcastable: true,
      // Optional second argument: the (integer) branch index. The branch is
      // kept as a plain `number?` (not `integer`) in the signature — an
      // `integer`-typed parameter has broken rule boxing in this repo — and
      // validated in `evaluate` instead.
      //
      // The argument slot is the carrier `complex | infinity`: W has a
      // value at every finite complex point, and the infinite points are
      // decided here (ruling recorded in
      // `docs/plans/2026-08-30-error-model-implementation.md`, Phase F
      // batch 8; each limit verified numerically):
      // `W₀(+∞) = +∞` (W₀(10⁶) = 11.4, growing like ln x); `W₀(−∞)`
      // follows the `Ln(−∞)` treatment — `W₀(−x) ≈ ln x + iπ` (W₀(−10¹²) =
      // 24.4 + 3.02i, the imaginary part tending to π), an infinite real
      // part with a finite imaginary offset that no exact number spells,
      // so `evaluate()` stays symbolic and `.N()` answers the machine
      // complex `∞ + iπ`; `W(~oo) = ~oo` by the modulus rule
      // (|W(z)| grows without bound in every direction); an anonymous
      // infinity is `NaN`. The `~oo` and anonymous-infinity answers hold
      // for every branch (`W_k(z) ≈ ln z + 2πik` has an infinite modulus
      // in every direction on every branch); the `±∞` values are the
      // PRINCIPAL branch's, and the −1 branch stays symbolic at the two
      // real infinities (its values there are other complex infinities
      // that are not verified). Outside a
      // branch's real domain (`W₀(−1)`, `W₋₁(0.5)`) the value is a finite
      // complex number the real kernels cannot compute, so the application
      // stays SYMBOLIC: `NaN` there would misreport a capability gap as
      // an indeterminate value. `NaN` propagates (explicit: the carrier is
      // not a subtype of `complex`).
      // No `canonical` handler, so a proven off-carrier operand is rejected
      // at boxing.
      signature: '(complex | infinity, number?) -> number',
      examples: ['[LambertW(1), N(LambertW(1))]'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: (ops, { numericApproximation, engine }) => {
        const x = ops[0];
        // Branch index: default 0 (principal W₀). Only the real branches 0
        // and −1 are implemented; a symbolic, non-integer, or otherwise
        // unsupported branch keeps the expression inert.
        let branch = 0;
        if (ops[1] !== undefined) {
          const k = asSmallInteger(ops[1]);
          if (k === null || (k !== 0 && k !== -1)) return undefined;
          branch = k;
        }
        const point = infinitePoint(x);
        if (point !== undefined) {
          if (point === 'anonymous') return engine.NaN;
          if (point === '~oo') return engine.ComplexInfinity;
          if (branch !== 0) return undefined;
          if (point === '+oo') return engine.PositiveInfinity;
          return numericApproximation
            ? engine.number(engine.complex(Infinity, Math.PI))
            : undefined;
        }
        if (!shouldNumericize(numericApproximation, x)) return undefined;
        const result = apply(
          x,
          (v) => lambertW(v, branch),
          (v) => bigLambertW(engine, v, branch)
        );
        // A `NaN` from the kernel means "outside this branch's real
        // domain" (the argument itself is never NaN here: the dispatch
        // gate propagated it before the handler ran), and the value there
        // is complex — stay symbolic rather than report `NaN`.
        if (result !== undefined && result.isNaN === true) return undefined;
        return result;
      },
    },

    // Bessel function of the first kind J_n(x)
    // Solution to Bessel's differential equation that is finite at the origin
    //
    // The four Bessel heads share one signature shape. The ORDER slot is
    // finite-only (`complex`): an infinite order is a boxing error —
    // nobody means an infinite order, and the limits there depend on the
    // order in which the two slots go to infinity (ruling recorded in
    // `docs/plans/2026-08-30-error-model-implementation.md`, Phase F
    // batch 8). The ARGUMENT slot is the carrier `complex | infinity`,
    // with the values at its exceptional points in
    // `besselValueAtExceptionalPoint`, answered on both routes. The
    // kernels are real, integer-order kernels: a non-integer order, a
    // non-real argument, and a negative real argument for `Y`/`K` (whose
    // value is complex there) all stay SYMBOLIC — capability gaps, not
    // off-carrier points. `NaN` propagates (explicit: the argument
    // carrier is not a subtype of `complex`). No
    // `canonical` handler, so the order slot is enforced at BOXING.
    BesselJ: {
      description: 'Bessel function of the first kind',
      wikidata: 'Q219637',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: complex, complex | infinity) -> number',
      examples: ['N(BesselJ(0, 1))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([n, x], { numericApproximation, engine }) =>
        evaluateBessel('J', n, x, engine, numericApproximation),
    },

    // Bessel function of the second kind Y_n(x)
    // Also known as Neumann function or Weber function
    BesselY: {
      description: 'Bessel function of the second kind (Neumann function)',
      wikidata: 'Q109545924',
      complexity: 8500,
      broadcastable: true,
      // Signature shape and seams: see `BesselJ` above.
      signature: '(order: complex, complex | infinity) -> number',
      examples: ['N(BesselY(0, 1))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([n, x], { numericApproximation, engine }) =>
        evaluateBessel('Y', n, x, engine, numericApproximation),
    },

    // Modified Bessel function of the first kind I_n(x)
    BesselI: {
      description: 'Modified Bessel function of the first kind',
      wikidata: 'Q2607225',
      complexity: 8500,
      broadcastable: true,
      // Signature shape and seams: see `BesselJ` above.
      signature: '(order: complex, complex | infinity) -> number',
      examples: ['N(BesselI(0, 1))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([n, x], { numericApproximation, engine }) =>
        evaluateBessel('I', n, x, engine, numericApproximation),
    },

    // Modified Bessel function of the second kind K_n(x)
    // Also known as Macdonald function
    BesselK: {
      description:
        'Modified Bessel function of the second kind (Macdonald function)',
      wikidata: 'Q109559130',
      complexity: 8500,
      broadcastable: true,
      // Signature shape and seams: see `BesselJ` above.
      signature: '(order: complex, complex | infinity) -> number',
      examples: ['N(BesselK(0, 1))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([n, x], { numericApproximation, engine }) =>
        evaluateBessel('K', n, x, engine, numericApproximation),
    },

    // Airy function of the first kind Ai(x)
    // Solution to Airy differential equation y'' - xy = 0
    AiryAi: {
      description: 'Airy function of the first kind',
      wikidata: 'Q109729241',
      complexity: 8400,
      broadcastable: true,
      // The four Airy heads share one signature: the carrier
      // `complex | infinity` (an entire function has a value at every
      // finite complex point, and the infinite points are decided in
      // `airyValueAtInfinity`, answered on both routes). A non-real finite
      // argument stays symbolic: no complex kernel, a capability gap.
      // `NaN` propagates (explicit: the carrier is not a subtype of
      // `complex`). No `canonical` handler, so a proven off-carrier
      // operand is rejected at boxing.
      signature: '(complex | infinity) -> number',
      examples: ['N(AiryAi(1))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([x], { numericApproximation, engine }) =>
        airyValueAtInfinity('Ai', x, engine) ??
        (shouldNumericize(numericApproximation, x)
          ? apply(x, airyAi)
          : undefined),
    },

    // Airy function of the second kind Bi(x)
    AiryBi: {
      description: 'Airy function of the second kind',
      wikidata: 'Q109729257',
      complexity: 8400,
      broadcastable: true,
      // Signature and seams: see `AiryAi` above.
      signature: '(complex | infinity) -> number',
      examples: ['N(AiryBi(0))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([x], { numericApproximation, engine }) =>
        airyValueAtInfinity('Bi', x, engine) ??
        (shouldNumericize(numericApproximation, x)
          ? apply(x, airyBi)
          : undefined),
    },

    // Derivative of the Airy function of the first kind Ai'(x)
    AiryAiPrime: {
      description: 'Derivative of the Airy function of the first kind',
      wikidata: 'Q409415',
      complexity: 8400,
      broadcastable: true,
      // Signature and seams: see `AiryAi` above.
      signature: '(complex | infinity) -> number',
      examples: ['N(AiryAiPrime(0))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([x], { numericApproximation, engine }) =>
        airyValueAtInfinity('AiPrime', x, engine) ??
        (shouldNumericize(numericApproximation, x)
          ? apply(x, airyAiPrime)
          : undefined),
    },

    // Derivative of the Airy function of the second kind Bi'(x)
    AiryBiPrime: {
      description: 'Derivative of the Airy function of the second kind',
      wikidata: 'Q409415',
      complexity: 8400,
      broadcastable: true,
      // Signature and seams: see `AiryAi` above.
      signature: '(complex | infinity) -> number',
      examples: ['N(AiryBiPrime(0))'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          specialFunctionType(ops),
          context.engine._typeResolver
        ),
      evaluate: ([x], { numericApproximation, engine }) =>
        airyValueAtInfinity('BiPrime', x, engine) ??
        (shouldNumericize(numericApproximation, x)
          ? apply(x, airyBiPrime)
          : undefined),
    },

    Ln: {
      description: 'Natural Logarithm',
      examples: ['[Ln(1), Ln(2), N(Ln(2))]', 'Ln(8, 2)'],
      wikidata: 'Q204037',
      complexity: 4000,
      broadcastable: true,
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Ln'),

      // The carrier is every point where the logarithm has a value — all
      // of `number` except NaN: the finite complex numbers (`Ln(0) = −∞`
      // is an in-carrier pole VALUE; `Ln(−1) = iπ` is the complex
      // extension), the signed infinities (`Ln(+∞) = +∞`;
      // `Ln(−∞) = ∞ + iπ`, which is why the result carries the wide
      // `infinity` arm), and `~oo`: `Ln(~oo) = ~oo`, because the real
      // part grows without bound in every direction of approach while the
      // imaginary part stays bounded, so the modulus is infinite — the
      // point at infinity (ruled 2026-09-01, reversing the 2026-08-31
      // choice that made `~oo` an error here for uniformity with `Sin`;
      // the same modulus rule gives `Power(~oo, 1/2) = ~oo`). The values
      // at these points are the quotient rule of
      // `logarithmAtExceptionalPoint` (boxed-expression/logarithm.ts),
      // which the `Log` handler shares. `NaN` propagates (explicit: this
      // carrier is not a subtype of `complex`, so the policy derived from
      // the signature would be `reject`). The optional base slot is a
      // pass-through: `Ln(a, b)` canonicalizes to `Log(a, b)`, whose base
      // carrier applies.
      signature:
        '(complex | infinity, base: complex | infinity?) -> complex | infinity',
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          elementaryFunctionTypeOnTypes('Ln', ops),
          context.engine._typeResolver
        ),
      sgn: ([x]) => lnSign(x),
      evaluate: ([z], { numericApproximation, engine, expression }) => {
        // Ln(a, b) = Log(a, b), so no need to check second argument
        // Non-lazy: `z` is already evaluated by the driver.
        const nonNumeric = nonNumericOperandError(engine, [z]);
        if (nonNumeric !== undefined) return nonNumeric;
        const evalZ = z;
        if (isMeasurement(evalZ)) {
          const r = measurementLn(engine, evalZ);
          return numericApproximation ? r?.N() : r;
        }
        if (!numericApproximation) return z.ln();

        // An exact argument outside the double range (`10^{400}`) has a
        // logarithm in the double range.
        {
          const big = bigRealOf(
            exactValueOutOfDoubleRange(engine, operandOf(expression, 0), z)
          );
          if (big !== undefined) {
            const ln = boxBignumResult(
              engine,
              withDoubleDigits(() => big.abs().ln())
            );
            if (!big.isNegative()) return ln;
            return engine.number(engine.complex(ln.re, Math.PI));
          }
        }

        // The exceptional points answer the same exact values on the
        // numeric route (`Ln(+∞) = +∞`, `Ln(~oo) = ~oo`), and `Ln(−∞)` its
        // machine complex `∞ + iπ`.
        const special = logarithmAtExceptionalPoint(engine, z, undefined, true);
        if (special !== undefined) return special;

        // A negative real above machine precision: `ln(−x) = ln(x) + iπ`
        // with both parts at the working precision. The machine route below
        // (`engine.complex(x).log()`) gives a 16-digit imaginary part, and a
        // big-decimal kernel downstream then reads its rounding error as a
        // value (`Exp(Ln(−2)).N()` gave `−1.99…98 + 4.8e-16i`).
        if (
          isNumber(z) &&
          !z.isComplex &&
          z.isNegative === true &&
          bignumPreferred(engine)
        ) {
          const bigRe = z.bignumRe ?? engine.bignum(z.re);
          if (bigRe.isFinite())
            return engine.number(engine._numericValue(bigRe).ln());
        }

        return apply(
          z,
          (x) =>
            x === 0
              ? -Infinity
              : x >= 0
                ? Math.log(x)
                : engine.complex(x).log(),
          (x) =>
            x.isZero()
              ? -Infinity
              : !x.isNegative()
                ? x.ln()
                : engine.complex(x.toNumber()).log(),
          (z) => (z.isZero() ? NaN : z.log()),
          (z) => z.ln()
        );
      },
    },

    Log: {
      description: 'Log(z, b = 10) = Logarithm of base b',
      wikidata: 'Q11197',
      complexity: 4100,
      broadcastable: true,
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Log'),

      // `Log(x, b)` is DEFINED as `Ln(x) / Ln(b)` at every point (ruled
      // 2026-09-01), so both carriers are `Ln`'s — all of `number` except
      // NaN — and the values at the exceptional points are the quotient
      // rule of `logarithmAtExceptionalPoint` (boxed-expression/
      // logarithm.ts): `Log(8, 1) = ln 8 / 0 = ~oo`, `Log(8, 0) =
      // ln 8 / (−∞) = 0`, `Log(0, 1/2) = +∞`, `Log(8, ~oo) = 0`,
      // `Log(+∞, +∞) = NaN`, `Log(1, 1) = NaN`, and a negative base is a
      // finite complex quotient (`Log(8, −2) = ln 8 / (ln 2 + iπ)`). Every
      // route answers the same value; before the ruling `evaluate()`,
      // `.N()` and `simplify()` disagreed at most of these points. `NaN`
      // propagates (explicit, the carriers not being subtypes of
      // `complex`). The result stays the wide `number`: it ranges over the
      // finite complex numbers, every infinity, and NaN, and the per-call
      // sharpness lives in the type handler.
      signature: '(complex | infinity, base: complex | infinity?) -> number',
      examples: ['[Log(1000), Log(8, 2)]'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        BoxedType.forResult(
          elementaryFunctionTypeOnTypes('Log', ops),
          context.engine._typeResolver
        ),

      sgn: ([x, base]) => {
        if (!base) return lnSign(x);
        if (base.isSame(1) || base.isExtendedReal == false) return 'unsigned';
        if (base.isGreater(1)) return lnSign(x);
        // The sign only flips for a base in (0, 1) — a NEGATIVE base makes
        // ln(base) complex, so the quotient is not real.
        if (base.isPositive && base.isLess(1)) return oppositeSgn(lnSign(x));
        if (base.isNegative) return 'unsigned';
        return undefined;
      },
      // @fastpath: this doesn't get called. See makeNumericFunction()
      // canonical: (ce, [x, base]) => {
      //   if (!x) return ce._fn('Log', [ce.error('missing'), base]);
      //   return x.ln(base ?? 10);
      // },
      evaluate: (ops, { numericApproximation, engine, expression }) => {
        // Non-lazy: operands are already evaluated by the driver.
        // Covers the whole log family: Lb/Lg/Log2/Log10 canonicalize to Log.
        const nonNumeric = nonNumericOperandError(engine, ops);
        if (nonNumeric !== undefined) return nonNumeric;
        const evalArg = ops[0];
        if (evalArg && isMeasurement(evalArg)) {
          const base = ops[1] ?? engine.number(10);
          const r = measurementLog(engine, evalArg, base);
          return numericApproximation ? r?.N() : r;
        }
        if (!numericApproximation) return ops[0]?.ln(ops[1] ?? 10) ?? undefined;
        const ce = engine;
        // An exact argument or base outside the double range (`10^{400}`)
        // has a logarithm in the double range. The quotient of the two
        // natural logarithms is computed with big decimals.
        {
          const zBig = bigRealOf(
            exactValueOutOfDoubleRange(ce, operandOf(expression, 0), ops[0])
          );
          const bBig =
            ops[1] === undefined
              ? undefined
              : bigRealOf(
                  exactValueOutOfDoubleRange(
                    ce,
                    operandOf(expression, 1),
                    ops[1]
                  )
                );
          if (zBig !== undefined || bBig !== undefined) {
            const z = zBig ?? bigRealOf(ops[0]);
            const b =
              bBig ??
              (ops[1] === undefined ? new BigDecimal(10) : bigRealOf(ops[1]));
            if (
              z !== undefined &&
              b !== undefined &&
              z.isPositive() &&
              b.isPositive() &&
              !b.eq(1)
            )
              return boxBignumResult(
                ce,
                withDoubleDigits(() => z.ln().div(b.ln()))
              );
          }
        }
        // The exceptional points answer their exact quotient values on the
        // numeric route too (the machine kernels below would give the
        // wrong sign at `Log(0, 1/2)` and NaN at `Log(8, −∞)`), and
        // `Log(−∞, b)` its machine complex.
        {
          const special = logarithmAtExceptionalPoint(
            ce,
            ops[0],
            ops[1] ?? ce.number(10),
            true
          );
          if (special !== undefined) return special;
        }
        if (ops[1] === undefined)
          return apply(
            ops[0],
            (x) =>
              x === 0
                ? -Infinity
                : x >= 0
                  ? Math.log10(x)
                  : ce.complex(x).log().div(Math.LN10),
            (x) =>
              x.isZero()
                ? -Infinity
                : !x.isNegative()
                  ? BigDecimal.log10(x)
                  : ce.complex(x.toNumber()).log().div(Math.LN10),
            (z) => (z.isZero() ? NaN : z.log().div(Math.LN10))
          );
        // A negative real argument OR base has a complex logarithm
        // (`ln(−2) = ln 2 + iπ`); every lane routes it through the complex
        // logarithm, so `Log(−2, 10).N()` and `Log(8, −2).N()` are the
        // finite complex quotients and not NaN (a machine `Math.log` of a
        // negative number is NaN). The bignum lane falls back to machine
        // precision for a negative base: the quotient is then complex, and
        // the complex lane is machine-only.
        const lnOf = (v: number) => (v < 0 ? ce.complex(v).log() : Math.log(v));
        return apply2(
          ops[0],
          ops[1],
          (z, b) => {
            // One kernel per base, shared with the compile targets
            // (`BaseCompiler.fixedLogBase`): a base of 10 or 2 with a
            // non-negative argument goes through `Math.log10` / `Math.log2`,
            // so a folded `Log(x, 2)` and a compiled runtime one agree to the
            // last bit. `ln(x) / ln(b)` differs from those kernels on about
            // one argument in ten, and is one ulp off at the powers of the
            // base (Tycho item 240). A zero argument answers `-oo` on both
            // spellings.
            if (z >= 0 && b === 10) return Math.log10(z);
            if (z >= 0 && b === 2) return Math.log2(z);
            const lz = lnOf(z);
            const lb = lnOf(b);
            if (typeof lz === 'number' && typeof lb === 'number')
              return lz / lb;
            return ce.complex(lz).div(lb);
          },
          (z, b) =>
            z.isNegative() || b.isNegative()
              ? ce.complex(lnOf(z.toNumber())).div(lnOf(b.toNumber()))
              : z.log(b),
          (z, b) => z.log().div(typeof b === 'number' ? lnOf(b) : b.log())
        );
      },
    },

    Lb: {
      description: 'Base-2 Logarithm',
      wikidata: 'Q581168',
      complexity: 4100,
      broadcastable: true,

      signature: '(number) -> number',
      examples: ['[Lb(8), N(Lb(3))]'],
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x, engine.number(2)]),
    },

    Lg: {
      description: 'Base-10 Logarithm',
      wikidata: 'Q966582',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      examples: ['[Lg(100), N(Lg(2))]'],
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x]),
    },

    Log10: {
      description: 'Base-10 Logarithm',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      examples: ['[Log10(1000), N(Log10(2))]'],
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x]),
    },

    Log2: {
      description: 'Base-2 Logarithm',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      examples: ['[Log2(32), N(Log2(3))]'],
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x, engine.number(2)]),
    },

    Mod: {
      description:
        'Modulo: the remainder of the floored division of x by y. The sign of the result follows the sign of the divisor y (floored-division convention, matching most CAS). For a truncated/round-to-nearest remainder, see `Remainder`.',
      keywords: ['remainder', 'modulo', 'modulus'],
      wikidata: 'Q1799665',
      complexity: 2500,
      broadcastable: true,

      // The declaration `docs/ERROR-MODEL.md` §4 gives as its worked
      // example: both operands are FINITE reals (a floored remainder needs
      // the order of the real line, and `Mod(±∞, m)` has no limit — it
      // sweeps `[0, m)` forever), so an infinite or non-real operand is
      // off-carrier — an `incompatible-type` error at boxing (no `canonical`
      // handler, no fast path), where it used to answer `NaN`. `NaN`
      // propagates. The one failure INSIDE the carrier is the zero modulus,
      // named by `definedWhen` below, which the gate routes to the codomain
      // marker (`Mod(1, 0)` → `Indeterminate`, `NaN` with a float operand),
      // never to `Error`.
      signature: '(real, real) -> real',
      examples: ['[7 % 3, -7 % 3]'],
      nanBehavior: 'propagate',
      // The named domain condition (Contract B, `docs/ERROR-MODEL.md` §4):
      // inside the carrier, a floored remainder exists exactly for a
      // non-zero modulus. `false` routes to the codomain marker
      // (`Mod(1, 0)` → `Indeterminate`), never to `Error`; an undecidable modulus (a
      // symbol of unknown sign, a collection) answers `undefined`. The
      // operands are read from their STATIC types — the value predicates
      // are type-blind on compounds — and under a broadcast lift from the
      // ELEMENT type (`Mod([0, 1, 2], 2)` is decided per cell). An operand
      // OUTSIDE the carrier (infinite, non-real) is not this predicate's to
      // decide: the carrier refuses it — at boxing for a literal, by the
      // dispatch conformance re-test for a value a symbol holds — and a
      // `false` here would put the marker where the carrier error belongs,
      // because the partiality gate runs before that re-test.
      definedWhen: ([dividend, divisor]) => {
        if (dividend === undefined || divisor === undefined) return undefined;
        // The carrier test comes FIRST: `Mod(m, 0)` for an `m` that is not
        // proven real is not decided here either, or a symbol holding `+∞`
        // would take the marker instead of the carrier error.
        if (
          !factsOf(broadcastCellType(dividend.type.type)).real ||
          !factsOf(broadcastCellType(divisor.type.type)).real
        )
          return undefined;
        if (isNumber(divisor)) return !divisor.isSame(0);
        const s = divisor.sgn;
        if (positiveSign(s) === true || negativeSign(s) === true) return true;
        return s === 'not-zero' ? true : undefined;
      },
      type: ([a, b], context) => {
        if (!a || !b) return undefined;
        // A floored remainder is defined only for a finite real dividend and a
        // finite, non-zero real modulus, and it stays in the operands' common
        // numeric kind (`Mod(k, 900)` is an integer for an integer `k`). The
        // handler claims that kind when it is proven, and DECLINES otherwise:
        // a declined claim falls through to the declared `real` result and
        // the Contract B derivation, which answers exactly `nan` for a
        // provably NaN operand or a provably zero modulus and `real | nan`
        // while the `definedWhen` condition is undischarged (a modulus that
        // MAY be zero). A handler answer is never widened by the framework,
        // so claiming a kind here for a possibly-zero modulus would hide the
        // marker (`Mod(k, m)` claimed `integer` while `m = 0` yields NaN).
        // The 0-pole needs sgn-nonzero (the `poleReciprocalType` idiom).
        // Operand tests read the STATIC type — the value predicates
        // (`isFinite`, `isInteger`) are type-blind on compound operands like
        // `Mod(k + 29, 900)` — and under a broadcast lift the ELEMENT type,
        // so `Mod([0, 1, 2], 2)` claims `integer` per cell.
        //
        // A NaN operand needs no test of its own: NaN's type is `nan`, which
        // is not a subtype of any real tier, so the tier ladder below already
        // declines for it — as it does for an operand a wider declaration
        // hides a NaN behind, whose type is the top `number`.
        const bSgn = operandSgnOnTypes(b);
        const bNonZero =
          nonZeroLiteral(b) ??
          (positiveSign(bSgn) === true ||
            negativeSign(bSgn) === true ||
            bSgn === 'not-zero');
        if (!bNonZero) return undefined;
        const ta = broadcastCellType(a.type);
        const tb = broadcastCellType(b.type);
        if (factsOf(ta).integer && factsOf(tb).integer)
          return BoxedType.forResult('integer', context.engine._typeResolver);
        if (factsOf(ta).rational && factsOf(tb).rational)
          return BoxedType.forResult('rational', context.engine._typeResolver);
        if (factsOf(ta).real && factsOf(tb).real)
          return BoxedType.forResult('real', context.engine._typeResolver);
        return undefined;
      },
      sgn: (ops) => {
        const n = ops[1]; //base of Mod
        if (n === undefined || n.isExtendedReal == false) return undefined;
        if (n.isSame(0)) return 'unsigned';
        if (isNumber(ops[0]) && isNumber(n)) {
          const v = apply2(
            ops[0],
            n,
            // In JavaScript, the % is remainder, not modulo
            // so adapt it to return a modulo (floored: sign follows the
            // divisor). Both lanes must agree with the `evaluate` handler
            // below, or `.sgn` and `.evaluate()` disagree on the same
            // expression (P0-7).
            floorModDouble,
            (a, b) => a.mod(b).add(b).mod(b)
          );
          return v?.sgn ?? undefined;
        }
        return undefined;
      },
      evaluate: ([a, b], { engine: ce, numericApproximation, expression }) => {
        // Under `.N()`, `Mod` jumps where `a/b` is an integer: the exact
        // values of exact operands are used near such a point
        // (`exactModUnderN()`).
        if (numericApproximation) {
          const exact = exactModUnderN(a, b, expression);
          if (exact !== undefined) return exact;
        }
        // A float operand makes the result a float, even when its value is
        // an integer (`Mod(7.0, 3)` is the float `1`): the exact paths below
        // are for exact operands only, and a float operand takes the float
        // lanes of `apply2()`.
        if (hasFloatOperand([a, b])) return floorModFloat(a, b);

        // Exact-integer fast path for a non-negative dividend and a positive
        // modulus (where modulo and remainder coincide, so both `apply2` lanes
        // agree). This avoids the bignum float lane, which extracts operands
        // via `bignumRe` and rounds integers longer than `ce.precision` digits
        // (e.g. Mod(10^21+3, 10) → 0 instead of 3).
        if (a.isInteger && b.isInteger && a.isNonNegative && b.isPositive) {
          const ba = asBigint(a);
          const bb = asBigint(b);
          if (ba !== null && bb !== null && bb !== BigInt(0))
            return ce.number(ba % bb);
        }

        // Exact-rational fast path (any sign, integer or rational): compute
        // the floored modulo exactly with bigint arithmetic. This subsumes
        // the integer fast path above for negative operands (still exact,
        // unlike the bignum float lane below, which rounds `a`/`b` through
        // `bignumRe` at `ce.precision` digits) and also handles true
        // rationals exactly (e.g. `Mod(1/2, 1/3) = 1/6`, P0-16d), which the
        // float lanes below would otherwise numericize.
        if (a.isRational && b.isRational) {
          const ra = asRational(a);
          const rb = asRational(b);
          if (ra && rb) {
            const an = BigInt(ra[0]);
            const ad = BigInt(ra[1]); // > 0 by rational convention
            const bn = BigInt(rb[0]);
            const bd = BigInt(rb[1]); // > 0 by rational convention
            if (bn !== BigInt(0)) {
              // p = an/ad, q = bn/bd. floor(p/q) = floor((an·bd) / (ad·bn)).
              const num = an * bd;
              const den = ad * bn;
              let k = num / den; // bigint division truncates toward zero
              const r = num % den;
              if (r !== BigInt(0) && r < BigInt(0) !== den < BigInt(0))
                k -= BigInt(1); // truncated → floored correction
              // Mod(p, q) = p - k·q = (an·bd − k·bn·ad) / (ad·bd)
              return ce.number([an * bd - k * bn * ad, ad * bd]);
            }
          }
        }

        // Modular reduction of an integer dividend whose value would be
        // impractical (or impossible) to materialize — e.g.
        // `Mod(2^(3^20), 100)`. Reduce in ℤ/mℤ by walking the (canonical)
        // dividend tree (modular exponentiation, factorial reduction, …)
        // without ever forming the huge integer. Only concrete integer
        // moduli qualify; `a.isInteger` gates the dividend and `b.isInteger`
        // the modulus (`toBigint` ROUNDS a non-integer: without the gate
        // `Mod(5, 2.5)` reduced mod 3). On decline (the walker returns
        // null), fall through to the float lanes below.
        if (a.isInteger === true && b.isInteger === true) {
          const bm = toBigint(b);
          if (bm !== null && bm !== 0n) {
            const mAbs = bm < 0n ? -bm : bm;
            const r = reduceModulo(a, mAbs);
            if (r !== null) {
              // Floored convention: the result's sign follows the divisor.
              if (bm > 0n) return ce.number(r);
              return ce.number(r === 0n ? 0n : r + bm);
            }
          }
        }

        // An exact constant expression that is not a number (`π·10³⁰`):
        // `a − m·k`, where `k` is the floor of `a/m` decided from enclosures
        // (`exactConstantModulo()`). `Mod(π·10³⁰, 1)` is
        // `π·10³⁰ − 3141592653589793238462643383279`, as in Mathematica.
        const constantModulo = exactConstantModulo(a, b);
        if (constantModulo !== undefined) return constantModulo.evaluate();

        return floorModFloat(a, b);
      },
    },

    Multiply: {
      description: 'Product of two or more values.',
      wikidata: 'Q40276',
      associative: true,
      commutative: true,
      idempotent: true,
      complexity: 2100,
      broadcastable: true,
      // The Multiply handlers own these shapes: tensors and matrices (the
      // matrix PRODUCT, `mulTensors` — element-wise broadcasting would
      // Hadamard instead), numeric tuples (component-wise), collection-shaped
      // result types, and operands that only become collections at
      // evaluation. The generic broadcast machinery must not re-map any of
      // them.
      broadcastExemptions: [
        'tensors',
        'tuples',
        'collection-result',
        'evaluated-operands',
      ],

      lazy: true,
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Multiply'),
      signature: '(number*) -> number',
      examples: ['2 * x * 3 * x'],
      type: (ops, { engine, derive }) => {
        if (ops.length === 0)
          return BoxedType.forResult('integer', engine._typeResolver); // = 1
        if (ops.length === 1)
          return BoxedType.forResult(ops[0].type, engine._typeResolver);
        // A factor that is NaN or a number (`nan | real`, the type of an
        // element read `l[i]` whose index may fall outside the list): the
        // product is NaN when that factor is NaN, and otherwise the product
        // of the numbers. So it is typed from the factors without their
        // `nan` arm, and the `nan` arm is added back, as `Add` keeps it
        // (`addTypeOnTypes` joins `nan | real` terms to `nan | real`).
        // Without this, every tier test below failed on the `nan` arm and
        // `(1/4)·l[i]` over a `list<real>` typed `number`, which admits a
        // complex value.
        const present = ops.map((x) => withoutNanArm(x.type));
        if (present.some((t) => t !== undefined)) {
          // The narrowed descriptor keeps the structural view of the factor.
          // Without it, a declared `nan | real` factor read as an undeclared
          // scalar, which the single-collection branch leaves out of the
          // cell type: `a·L`, `a: real | nan`, `L: list<integer>`, was typed
          // `list<integer | nan>`, and `a = 0.5` gives a cell that is not an
          // integer.
          const t = derive(
            'Multiply',
            ops.map((x, i) =>
              present[i] === undefined
                ? x
                : {
                    ...describeType(present[i]!, x.facts.closed),
                    structureOf: x.structureOf,
                  }
            )
          );
          // Built as a union, not through `widen`, which joins `real` and
          // `nan` to their common supertype `number`.
          if (t !== undefined && isSubtype(t, 'number'))
            return BoxedType.forResult(
              reduceType({ kind: 'union', types: [t, 'nan'] }),
              engine._typeResolver
            );
          // A product with a list factor is a list: when the NaN factor is
          // NaN, every cell is NaN, so the `nan` arm is added to the cell
          // type. Without this, the product of a `nan | real` factor and a
          // `list<real>` typed `list<real>` when the factor was a function
          // parameter (whose descriptor carries a type and no declaration),
          // while the same product of a declared symbol typed
          // `list<nan | real>`. A factor that may also be infinite
          // (`real | signed_infinity | nan`) is typed by the single-collection
          // branch below, which types each cell as a scalar product, so its
          // `±∞` arm is already in the cell type.
          const list = t === undefined ? undefined : resolveTypeAlias(t);
          if (
            typeof list === 'object' &&
            list.kind === 'list' &&
            isSubtype(list.elements, 'number')
          )
            return BoxedType.forResult(
              {
                ...list,
                elements: reduceType({
                  kind: 'union',
                  types: [list.elements, 'nan'],
                }),
              },
              engine._typeResolver
            );
        }
        // A scalar factor on the extended real line that may be infinite
        // (`real | signed_infinity`, or a provably infinite `Ln(0)`) beside
        // collection factors: the shape of the product is the shape of the
        // same product with that factor finite, and each cell is the scalar
        // product of such a cell and the infinite factors, typed by this
        // handler. So a cell is `±∞`, or NaN (`∞ · 0`), as a scalar product
        // is (user decision 2026-09-25). The collection branches below join
        // the scalar into the cells, which widened `signed_infinity` to
        // `infinity` (a host reads it as possibly complex) with no `nan` arm,
        // or dropped the scalar when there are two collections.
        const infiniteScalars = ops.filter(
          (x) =>
            isSubtype(x.type, 'number') &&
            isExtendedRealOperand(x) &&
            !isSubtype(x.type, 'real')
        );
        if (
          infiniteScalars.length > 0 &&
          ops.some((x) => !isSubtype(x.type, 'number'))
        ) {
          const shape = derive(
            'Multiply',
            ops.map((x) =>
              infiniteScalars.includes(x) ? describeType('real') : x
            )
          );
          const cellOf = (c: Type): Type | undefined =>
            derive('Multiply', [describeType(c), ...infiniteScalars]);
          const product =
            shape === undefined ? undefined : mapProductCells(shape, cellOf);
          if (product !== undefined)
            return BoxedType.forResult(product, engine._typeResolver);
        }
        // A dimensionless list/indexed-collection factor together with a
        // numeric-tuple (point) factor broadcasts the collection while scaling
        // the point component-wise: the value path (`mul()`) checks the
        // collection BEFORE the tuple branch, yielding a `List` of `Tuple`s
        // (e.g. `Range(-2,2)·(2,3)`). The honest-typing wrapper is skip-listed
        // for `Multiply`-with-a-numeric-tuple, so the list type must come from
        // here. (The tuple-free broadcast — `2R`, `R·x` — is handled by the
        // wrapper.) Tensors keep their matrix-product typing below.
        const couldBeTuple = (x: OperandDescriptor) =>
          typeCouldBeNumericTuple(x.type);
        // A literal list is a TENSOR (`[1, 2]` types `vector<2>`,
        // `[[1, 2], [3, 4]]` a 2×2 matrix), and `mulTensors` scales the point
        // at every cell of it exactly as the dimensionless-list path does
        // (`[1, 2] · (3, 4)` is `[(3, 4), (6, 8)]`; the matrix gives a 2×2
        // nest of points) — a point is a scalar factor to the tensor kernel,
        // never a matrix-product operand. So a numeric tensor of any rank
        // takes this arm, and the result keeps the tensor's shape with the
        // scaled point as its cell type. Without this the arm was skipped
        // for every literal list and the single-tuple branch claimed
        // `tuple<integer, integer>` for a value that is a list of points.
        // Only a tensor of NUMBERS qualifies: a list of points is a point
        // list, whose product with a point is the `no-product-between-points`
        // error the value path answers.
        const isNumericTensorOperand = (x: OperandDescriptor) =>
          isTensorOperand(x) && numericTensorElementType(x.type) !== undefined;
        const scalesPoint = (x: OperandDescriptor) =>
          isBroadcastCollectionTypeOf(x.type) || isNumericTensorOperand(x);
        // The collection factor and the point factor must be DIFFERENT
        // operands: a point-or-point-list operand (`tuple<…> | list<tuple<…>>`)
        // answers both predicates by itself, and taking this arm for it
        // claimed a definite `list<…>` of the whole union for a value that
        // may be a single point. Such an operand scaled by scalars is typed
        // by the single-tuple branch below, arm by arm.
        if (
          !ops.some((x) => isTensorOperand(x) && !isNumericTensorOperand(x)) &&
          ops.some((x) => scalesPoint(x) && !couldBeTuple(x)) &&
          ops.some(couldBeTuple)
        ) {
          // Only the TUPLE arms of a point operand reach the cell: a
          // point-or-point-list operand (`tuple<…> | list<tuple<…>>`) beside
          // a list factor gives a list of scaled points whichever arm it
          // holds, and the broadcast wrapper re-adds the operand's own list
          // branch. Widening the whole union into the cell nested it
          // (`list<list<tuple<…>> | tuple<…>>`).
          const tupleType = widen(
            ...ops.filter(couldBeTuple).map((x) => numericTupleArms(x.type))
          );
          // Each element of the collection scales the point's COMPONENTS, so
          // the collection's element type widens them exactly as a declared
          // scalar factor does: `(Range(0,n)/n)·(1, 0)` is a list of points
          // with `number` components, not the literal's integer ones (the
          // static half of the component-type lie under Tycho item 212 — the
          // evaluated view is typed by the single-tuple branch below). A
          // collection whose element type is indeterminate (a bare
          // `indexed_collection`) still contributes SOME numeric factor per
          // element, so its contribution is `number` — echoing the literal's
          // integer tiers would claim coordinates the elements need not have.
          // A scalar factor whose number type is not declared leaves the
          // tuple type as written, as in the single-tuple branch below.
          const factorTypes = ops
            .filter((x) => !couldBeTuple(x))
            .map((x) => {
              if (scalesPoint(x)) {
                const elt =
                  dimensionlessIndexedElementType(x.type) ??
                  numericTensorElementType(x.type);
                return elt === undefined || elt === 'any' || elt === 'unknown'
                  ? 'number'
                  : elt;
              }
              return isDeclaredScalarNumberOperand(x, engine)
                ? x.type
                : undefined;
            });
          const scaled = factorTypes.every(
            (t) => t !== undefined && factsOf(t).belowNumber
          )
            ? scaleTupleComponents(tupleType, factorTypes as Type[])
            : tupleType;
          // A tensor factor gives the result its own shape (a 2×2 matrix of
          // scalars times a point is a 2×2 nest of points); a dimensionless
          // list gives a dimensionless list of points.
          const tensor = ops.find(isNumericTensorOperand);
          const dims =
            tensor === undefined
              ? undefined
              : (resolveTypeAlias(tensor.type) as ListType).dimensions;
          if (dims !== undefined)
            return BoxedType.forResult(
              { kind: 'list', elements: scaled, dimensions: dims },
              engine._typeResolver
            );
          return BoxedType.forResult(
            broadcastResultType(scaled),
            engine._typeResolver
          );
        }
        // A numeric tuple (point/vector) scaled by scalars keeps the tuple
        // type. Hoisted above the NaN/finiteness early-returns (a tuple is
        // not a finite number, which would otherwise collapse to `number`).
        // COULD-semantics (`couldBeNumericTuple`): a tuple with
        // `unknown`-component elements (e.g. `(S(x,y,0), S(x,y,1))` with
        // `S: (…) -> unknown`) is still statically a tuple — claiming `number`
        // for its scalar product would let the enclosing `Add`'s
        // scalar-plus-tuple guard bake `incompatible-type` (Tycho item 30).
        const tupleOps = ops.filter(couldBeTuple);
        if (tupleOps.length === 1) {
          // The scalar factors scale every COMPONENT, so they widen the
          // component types: `x · (1, 0)` with `x: number` has `number`
          // components. Echoing the tuple's own type claimed
          // `tuple<integer, integer>` for `(k/n) · (1, 0)`,
          // whose value is the rational point `(1/3, 0)` — the component-type
          // lie under the zip `Subtract` of Tycho item 212. Same rule as the
          // tensor branch below: only a factor whose number type is DECLARED
          // carries a tier to combine; an inferred or `unknown` factor leaves
          // the tuple type as written.
          const others = ops.filter((x) => x !== tupleOps[0]);
          if (others.every((x) => isDeclaredScalarNumberOperand(x, engine)))
            return BoxedType.forResult(
              scaleTupleComponents(
                tupleOps[0].type,
                others.map((x) => x.type)
              ),
              engine._typeResolver
            );
          // The echo unfolds a transparent alias: the product is typed by the
          // tuple it names (the alias policy of the broadcast lift).
          return BoxedType.forResult(
            resolveTypeAlias(tupleOps[0].type),
            engine._typeResolver
          );
        }
        // Element-wise product of a single tensor (vector/matrix) with scalars
        // keeps the tensor's shape/type. The list-broadcast wrapper is
        // skip-listed for tensor Multiply (mulTensors handles the value), so
        // the honest list type must come from here.
        const tensorOps = ops.filter((x) => isTensorOperand(x));
        if (tensorOps.length === 1) {
          const others = ops.filter((x) => !isTensorOperand(x));
          // Only SCALAR factors fold into the cells (see `addType`): a
          // collection-TYPED co-operand is a sibling collection (matrix
          // product / elementwise pair) — fall through to the collection
          // branch below for those. `isBroadcastCollectionType` is asked as
          // well because it is the only one of the two that descends a UNION:
          // a factor typed `number | list<number>` is a sibling collection
          // too, and folding its raw union into the cells claimed
          // `list<number | list<number>>` for a product whose every branch has
          // plain `number` cells.
          if (
            others.every(
              (x) =>
                !isLinearAlgebraCollectionType(x.type) &&
                !isBroadcastCollectionTypeOf(x.type)
            )
          ) {
            // Scalar factors fold INTO the cells elementwise: widen the
            // tensor's honest cell type with the scalar types so the
            // declared type stays a sound upper bound (`x·[0,0,1,1]` has
            // `number` cells, not `integer`).
            return BoxedType.forResult(
              absorbScalarsIntoCells(
                tensorOps[0].type,
                others.map((x) => x.type)
              ),
              engine._typeResolver
            );
          }
        }
        // Collection-typed operands (declared matrix/vector/list symbols, or
        // any operand whose type is a collection) make the product a
        // collection: `2Y`, `XY`, `X·Y` on declared-matrix symbols are
        // `matrix`, `2v` is `vector`. Scalar factors scale/combine
        // element-wise or via the matrix product, but the result carries the
        // collection type either way (shape-aware refinement is out of scope).
        // Mirrors `addType`'s widening. Numeric tuples are handled above, and
        // scalars/unknown-typed symbols are not collection types, so the
        // all-scalar numeric paths below are untouched.
        // A factor typed `scalar | list<E>` is a sibling collection ONLY when
        // another factor is definitely a collection: on its own it may still
        // be a scalar at runtime (`2u` with `u: number | list<number>` is a
        // number when `u` is), so its honest union has to survive. Paired with
        // a collection the product is a collection whichever branch holds, and
        // `broadcastSiblingType` (used in the widen below) collapses the union
        // to the one collection type they share.
        const definiteCollections = ops.filter((x) =>
          isLinearAlgebraCollectionType(x.type)
        );
        const collectionOps =
          definiteCollections.length > 0
            ? ops.filter(
                (x) =>
                  isLinearAlgebraCollectionType(x.type) ||
                  isBroadcastCollectionTypeOf(x.type)
              )
            : definiteCollections;
        if (collectionOps.length === 1) {
          // Scalar FACTORS fold into the cells elementwise — `(1..4)/2` (which
          // `canonicalDivide` rewrites to `Multiply(1/2, …)`), `0.5·L` — so
          // they must widen the ELEMENT type, exactly as in `addType`.
          // Echoing the collection operand's type verbatim claimed `integer`
          // cells for a product whose values are rationals.
          // Only DECLARED scalar numbers participate — a literal, or a symbol
          // or call whose numeric type the user stated. An `unknown`-typed
          // factor carries no tier to combine (and would widen every cell to
          // `any`); a merely INFERRED numeric type is retractable evidence —
          // the same rule `canonicalAdd` applies to its scalar-plus-tuple
          // rejection — and letting a guess of `number` widen the cells makes
          // the literal's result type disagree with a declared signature that
          // the operand types actually satisfy.
          const others = ops.filter(
            (x) => !isLinearAlgebraCollectionType(x.type)
          );
          if (others.every((x) => isDeclaredScalarNumberOperand(x, engine)))
            return BoxedType.forResult(
              absorbScalarsIntoCells(
                collectionOps[0].type,
                others.map((x) => x.type)
              ),
              engine._typeResolver
            );
          // The echo unfolds a transparent alias: the product is typed by the
          // collection it names (the alias policy of the broadcast lift).
          return BoxedType.forResult(
            resolveTypeAlias(collectionOps[0].type),
            engine._typeResolver
          );
        }
        if (collectionOps.length > 1) {
          // A point LIST paired with a sibling collection of SCALARS scales
          // each point by the scalar it is paired with, and the value path
          // returns a list of points (`[(3,4),(6,8)]·[5,10] = [(15,20),
          // (60,80)]`), so the element tuple-ness survives. The widen below
          // unions the two element types instead (`list<number | tuple<…>>`),
          // and `PointX`/`PointY` over that union take the element-INDEX
          // reading rather than the elementwise one, folding a normalized
          // point list to `NaN` (Tycho item 209, secondary defect; the
          // `Divide` twin is the point-list branch in its own type handler).
          // Narrow on purpose: exactly ONE operand is a point list and every
          // other collection operand must be a RANK-1 collection of SCALARS,
          // so a pairing of two point lists (which has no defined
          // component-wise reading) still widens, and so does a matrix
          // product. Excluding a matrix takes an explicit `matches('matrix')`
          // rather than a "carries dimensions" test: on a `list` kind a shape
          // lives in `dimensions` while `elements` stays the scalar base, so a
          // `matrix<2x2>` reports scalar elements exactly as a `vector<n>`
          // does — and a vector MUST stay admitted, since that is the type a
          // literal list of numbers (`[5, 10]`) carries.
          //
          // The scalars fold into the point's COMPONENTS rather than being
          // dropped: `list<tuple<integer, integer>>` times a list of reals has
          // real components (`[(3,4)]·[0.5] = [(1.5, 2)]`), so echoing the
          // point list's type verbatim would claim integer components the
          // value contradicts. `absorbScalarsIntoCells` performs the widening
          // — the same helper, and the same reason, as the single-collection
          // branch above.
          const tupleCollections = collectionOps.filter((x) =>
            typeCouldBeNumericTupleCollection(x.type)
          );
          const scalarSiblings: Type[] = [];
          const siblingsAreRank1Scalars =
            tupleCollections.length === 1 &&
            collectionOps.every((x) => {
              if (x === tupleCollections[0]) return true;
              if (factsOf(x.type).matrix) return false;
              const el = collectionElementTypeOf(x.type);
              if (el === undefined || !factsOf(el).belowNumber) return false;
              scalarSiblings.push(el);
              return true;
            });
          if (siblingsAreRank1Scalars)
            return BoxedType.forResult(
              absorbScalarsIntoCells(tupleCollections[0].type, scalarSiblings),
              engine._typeResolver
            );
          // Strip range decorations before the join: a product of two
          // `list<real<-1..>>` operands does not stay above −1
          // (see `stripNumericRanges`).
          return BoxedType.forResult(
            widen(
              ...collectionOps.map((x) =>
                stripNumericRanges(broadcastSiblingType(x.type))
              )
            ),
            engine._typeResolver
          );
        }
        // An operand whose collection-ness is not statically visible (a top
        // `unknown`/`any`/`value` leaf such as an undeclared `h(x)`, or an
        // already-`broadcastable<…>` inner node) makes the product
        // `broadcastable<T>`. Hoisted above the NaN/finiteness early-returns
        // for the same reason as `addType`'s branch: a broadcastable inner node
        // has no meaningful finiteness, and an `unknown`-typed leaf decides
        // neither NaN-ness nor finiteness. The `imaginary` → `complex`
        // closure (i·i = −1 is real) is applied inside the helper.
        if (ops.some((x) => isPossiblyCollectionTypedOperand(x)))
          return BoxedType.forResult(
            broadcastableResultTypeOfOperands(ops),
            engine._typeResolver
          );
        if (ops.some((x) => provablyNaNOperand(x)))
          return BoxedType.forResult('number', engine._typeResolver);
        // A provably non-finite factor may be visible only in its static
        // TYPE: `Ln(0)` types `+oo | -oo`, as does a symbol declared
        // `+oo | -oo`, and neither has a value to probe.
        // The descriptor's finiteness fact catches them; without
        // it `2·Ln(0)` fell through to the "every operand is finite" tail and
        // claimed `integer` (unsound; the value is −∞).
        if (ops.some((x) => operandNonFiniteNumberOnTypes(x))) {
          // 0 · ±∞ = NaN (indeterminate). With every factor real, NaN is the
          // only value (user decision 2026-09-25: not `number`, which a host
          // reads as possibly complex).
          if (ops.some((x) => operandLiteralValueOnTypes(x) === 0))
            return BoxedType.forResult(
              ops.every((x) => isExtendedRealOperand(x)) ? 'nan' : 'number',
              engine._typeResolver
            );
          // real · ±∞ = ±∞ (a non-finite real); a non-real factor (i, complex)
          // with ∞ gives ~oo or NaN, and a *possibly-zero* finite factor gives
          // NaN (0 · ∞). So every factor must be provably REAL, and every
          // FINITE factor must additionally have a proven non-zero sign.
          //
          // Ruling 2026-08-03: a provably non-finite real factor is implicitly
          // non-zero — `±∞ ≠ 0` is a theorem, so requiring a proven sign of it
          // is redundant (`Ln(0)` has sgn `non-positive`, yet `2·Ln(0) = −∞`).
          // Proven signs are required only of the finite factors. The
          // extended-real requirement stays for EVERY factor,
          // including the non-finite one: proven non-finiteness does
          // not imply real
          // (`~oo` is not finite and is not on the extended real line),
          // and `∞·i = ~oo` must not be claimed `+oo | -oo`.
          if (
            ops.every((x) => {
              if (!isExtendedRealOperand(x)) return false;
              if (operandNonFiniteNumberOnTypes(x)) return true;
              // Value/assumption channel first, then the TYPE channel (a
              // literal's value type, an `assume` range, `Abs`'s `<0..>`).
              return provablyNonZeroSign(x);
            })
          )
            return BoxedType.forResult('+oo | -oo', engine._typeResolver);
          // Extended-real factors with a factor that may be zero: the
          // product is ±∞, or NaN when that factor is zero (0 · ∞). No
          // complex value is possible, so the type is not `number`
          // (user decision 2026-09-25: a host reads `number` as possibly
          // complex).
          if (ops.every((x) => isExtendedRealOperand(x)))
            return BoxedType.forResult('+oo | -oo | nan', engine._typeResolver);
          return BoxedType.forResult('number', engine._typeResolver);
        }
        // A factor that MAY be infinite (`real | signed_infinity`, typed
        // neither finite nor provably infinite) makes the product possibly
        // infinite, and NaN when another factor may be zero (0 · ∞). The
        // finite tiers below must not claim it. With every factor on the
        // extended real line, the product is too, since no complex value can
        // arise (user decision 2026-09-25); otherwise it is `number`. The
        // `nan` arm is added when one factor may be infinite and a DIFFERENT
        // factor may be zero: `2y` and `y·p` with `p > 0` are never NaN.
        const mayBeInfinite = (x: OperandDescriptor) =>
          isSubtype(x.type, 'number') && !isSubtype(x.type, 'complex');
        if (ops.some(mayBeInfinite)) {
          if (!ops.every((x) => isExtendedRealOperand(x)))
            return BoxedType.forResult('number', engine._typeResolver);
          const mayBeNaN = ops.some(
            (x, i) =>
              mayBeInfinite(x) &&
              ops.some((y, j) => j !== i && !provablyNonZeroSign(y))
          );
          return BoxedType.forResult(
            mayBeNaN ? 'real | +oo | -oo | nan' : 'real | +oo | -oo',
            engine._typeResolver
          );
        }
        // From here every operand is finite (no `isFinite === false`).
        // The all-real tiers get an interval refinement (interval
        // MULTIPLICATION over the operands' ranged types — the
        // interval-arithmetic half of ROADMAP "Ranged types…", plan doc
        // `docs/plans/2026-08-27-interval-arithmetic-result-types.md`):
        // `x · y` under `assume(x > 2); assume(y > 3)` types
        // `real<6..>`. The claim aborts if any operand carries no
        // interval, and attaches only to the NaN-free tier chosen here.
        const refineMul = (tier: Type): Type =>
          attachInterval(
            tier,
            foldIntervalsOfTypes(
              ops.map((x) => x.type),
              mulIntervals
            )
          );
        if (ops.every((x) => factsOf(x.type).integer))
          return BoxedType.forResult(
            refineMul('integer'),
            engine._typeResolver
          );
        // The `rational` test must come before the `real` one: every rational
        // operand is also real, so in the other order a product of rationals
        // was typed `real`, and a broadcast element typed by this handler
        // (the lazy `Map` of `2k` over a list of rationals) disagreed with
        // the `rational` cells of the eager list.
        if (ops.every((x) => factsOf(x.type).rational))
          return BoxedType.forResult(
            refineMul('rational'),
            engine._typeResolver
          );
        if (ops.every((x) => isExtendedRealOperand(x)))
          return BoxedType.forResult(refineMul('real'), engine._typeResolver);

        // Real × pure-imaginary products: at least one factor is typed
        // `imaginary` and every other factor is provably real. Since
        // i² = −1, the imaginary factors pair up:
        // - even count → the product is real;
        // - odd count → the product is pure imaginary *iff it is non-zero*.
        //   In the lattice `imaginary` is a *pure* imaginary number,
        //   disjoint from the real chain (`imaginary ∩ real = nothing`,
        //   see `subtype.ts` / type-lattice tests), so 0 — which is real —
        //   is NOT an `imaginary` value. We may only claim `imaginary`
        //   when every real factor is provably non-zero (`imaginary`-typed
        //   factors are non-zero by type); otherwise the sound answer is
        //   `complex` (e.g. `x·i` with real x ∋ 0 may be 0, which
        //   is not `imaginary`).
        const isImaginary = (x: OperandDescriptor) => factsOf(x.type).imaginary;
        const imaginaryCount = ops.filter(isImaginary).length;
        if (
          imaginaryCount > 0 &&
          ops.every((x) => isImaginary(x) || isExtendedRealOperand(x))
        ) {
          if (imaginaryCount % 2 === 0)
            return BoxedType.forResult('real', engine._typeResolver);
          if (ops.every((x) => isImaginary(x) || provablyNonZeroSign(x)))
            return BoxedType.forResult('imaginary', engine._typeResolver);
          return BoxedType.forResult('complex', engine._typeResolver);
        }

        // A product of finite complex factors is itself a finite complex
        // number (e.g. `√2·(1+i)`): claim `complex` rather than the
        // complex-unaware top type `number`.
        if (ops.every((x) => factsOf(x.type).complex))
          return BoxedType.forResult('complex', engine._typeResolver);

        return BoxedType.forResult('number', engine._typeResolver);
      },
      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      //
      sgn: (ops) => {
        if (ops.some((x) => x.sgn === undefined || x.isExtendedReal === false))
          return undefined;
        if (ops.some((x) => x.isSame(0)))
          return ops.every((x) => x.isFinite)
            ? 'zero'
            : ops.some((x) => provablyNonFiniteNumber(x))
              ? 'unsigned'
              : undefined;
        if (
          ops.some(
            (x) => x.isFinite === undefined || provablyNonFiniteNumber(x)
          ) &&
          ops.some((x) => {
            const s = x.sgn;
            return s !== 'positive' && s !== 'negative' && s !== 'not-zero';
          })
        )
          return undefined;
        if (ops.every((x) => x.isPositive || x.isNegative)) {
          let sumNeg = 0;
          ops.forEach((x) => {
            if (x.isNegative) sumNeg++;
          });
          return sumNeg % 2 === 0 ? 'positive' : 'negative';
        }
        if (ops.every((x) => x.isNonPositive || x.isNonNegative)) {
          // An even number of non-positive factors gives a non-NEGATIVE
          // product (all factors non-negative → product ≥ 0).
          let sumNeg = 0;
          ops.forEach((x) => {
            if (x.isNonPositive) sumNeg++;
          });
          return sumNeg % 2 === 0 ? 'non-negative' : 'non-positive';
        }
        if (
          ops.every(
            (x) =>
              x.sgn === 'not-zero' ||
              x.sgn === 'positive' ||
              x.sgn === 'negative'
          )
        )
          return 'not-zero';
        return undefined;
      },
      evaluate: (ops, { numericApproximation, engine, expression }) => {
        // Ellipsis fold barrier: a `Multiply` with a direct
        // `ContinuationPlaceholder` operand is a notational object; leave it
        // unchanged rather than multiplying across the elided terms.
        if (ops.some((x) => isContinuationOperand(x))) return undefined;
        // `Multiply` is `lazy`, so the driver did NOT evaluate the operands —
        // this map is the (single) operand evaluation, not a re-evaluation.
        // Under a numeric approximation the operands are evaluated
        // numerically, for the reasons given in `Add`.
        const evaluated = ops.map((x) =>
          numericApproximation
            ? x.evaluate({ numericApproximation: true })
            : x.evaluate()
        );
        const rethreaded = threadOperandsThatBecameConditional(
          engine!,
          'Multiply',
          ops,
          evaluated,
          numericApproximation
        );
        if (rethreaded !== undefined) return rethreaded;
        const nonNumeric = nonNumericOperandError(engine!, evaluated);
        if (nonNumeric !== undefined) return nonNumeric;
        // A tuple with a list coordinate is data, not a point: arithmetic
        // over it is an error (see `listCoordinateTupleOperandError`).
        const listTuple = listCoordinateTupleOperandError(engine!, evaluated);
        if (listTuple !== undefined) return listTuple;
        // See the matching note in `Add`: `Multiply` is lazy, so the driver's
        // missing-value gate never saw the EVALUATED operands, and the
        // absence normalization to the codomain's quiet marker — `NaN` in a
        // numeric slot, `Missing` in any other — has to run here, after the
        // non-numeric check and only over valid operands.
        if (evaluated.every((x) => x.isValid)) {
          // An absent factor beside a POINT makes the point absent: the tuple
          // is atomic, so there is no cell for the absence to land in, and a
          // tuple of absent components is not a value any consumer reads.
          // This arm has to run before `mulTuples` below, which would
          // otherwise scale each coordinate into its own `Missing`. It
          // stands aside in two cases. When a LIST (any non-tuple collection)
          // is also a factor, the product is a broadcast over the list and
          // the absent point lands in each cell through the collection
          // kernel. When TWO points are factors, there is no product between
          // points, and that error outranks the absence: `mulTuples` reports
          // it, as it did before this arm existed.
          if (
            evaluated.some(isAbsentScalarSymbol) &&
            evaluated.filter((x) => isTuple(x)).length === 1 &&
            !evaluated.some((x) => isNonTupleCollectionOperand(x))
          )
            return engine!.Missing;
          if (hasAbsentScalarOperand(evaluated))
            return absentScalarMarker(engine!, expression);
        }
        if (evaluated.some((x) => x.operator === 'Quantity')) {
          const r = quantityMultiply(engine!, evaluated);
          if (
            numericApproximation &&
            r &&
            isQuantity(r) &&
            isMeasurement(r.op1)
          )
            return r.N();
          return r;
        }
        if (evaluated.some((x) => x.operator === 'Measurement')) {
          const r = measurementMultiply(engine!, evaluated);
          return numericApproximation ? r?.N() : r;
        }
        // Only a pure number literal or a pure symbol passes raw; every other
        // operand passes its numeric value, so it is evaluated once and its
        // side effects run once — see the matching comment in `Add`.
        // `mulNEvaluated` keeps a product of sums FACTORED exactly as
        // `mulFactored` does below — the two routes must agree on shape,
        // differing only in floats.
        if (numericApproximation) {
          const raw = ops.map(
            (op) => op.isPure === true && (isNumber(op) || isSymbol(op))
          );
          const factors = ops.map((op, i) => (raw[i] ? op : evaluated[i]));
          // A pure operand whose float is 0 or ±∞ can have an exact value
          // that is not (`10^{-400}` is `1/10^400`, `1 + 10^{400}` is an
          // integer). It is passed as its exact value, so that `mulNEvaluated`
          // can fold it with the other factors before it becomes a float:
          // `10^{-400}·10^{300}` is then `1e-100`, not `0·1e300`.
          for (let i = 0; i < ops.length; i++) {
            if (raw[i]) continue;
            const exact = exactValueOutOfDoubleRange(
              engine!,
              ops[i],
              factors[i]
            );
            if (exact !== undefined) {
              factors[i] = exact;
              raw[i] = true;
            }
          }
          rescueExactCoefficients(engine!, ops, factors, raw);
          const r = mulNEvaluated(
            factors,
            raw.map((x) => !x)
          );
          // See the matching comment in `Add` (Tycho item 101).
          return (
            foldQuantityOperands(engine!, r) ??
            foldMeasurementOperands(engine!, r) ??
            markAbsentPointCells(engine!, expression, r)
          );
        }
        // `mulFactored`, not `mul`: `evaluate()` promises the most EXACT form,
        // and a product of sums is exactly as exact factored as expanded while
        // being smaller — expanding multiplies the term count at every factor,
        // which is what made a `Product` of linear factors superlinear. So
        // `(a + b)(c + d)` reaches the user as written; `Expand` opens it and
        // reproduces the expanded form verbatim (user ruling, 2026-08-20).
        // Internal callers keep `mul()`, whose distribution several
        // normalization paths need to reach a fixpoint — see `mulFactored`.
        const result = mulFactored(...evaluated);
        // D2: see the matching comment in `Add` — an inexact (float) operand
        // numericizes the whole product even when mixed with an exact
        // symbolic constant (`Multiply(0.5, Pi)` → 1.57…). Only when the
        // product is a closed constant (`isConstant`, lexical — NOT the
        // dynamic-scope `unknowns`; see `Add`): `0.5 * x` must stay
        // symbolic, including a bound parameter `x` inside an application.
        if (
          result.operator === 'Multiply' &&
          result.isConstant &&
          evaluated.some((x) => !isExactNumber(x))
        )
          return result.N();
        return markAbsentPointCells(engine!, expression, result);
      },
    },

    Negate: {
      description: 'Additive Inverse',
      wikidata: 'Q715358',
      complexity: 2000,
      broadcastable: true,
      // Numeric tuples negate component-wise (`negate`), and the type handler
      // passes a collection operand's own type through — the generic
      // broadcast machinery must not fan the tuple out or re-wrap the type.
      broadcastExemptions: ['tuples', 'collection-result'],
      // Negation is TOTAL on the extended complex plane: every finite
      // complex number has an additive inverse, `−(±∞) = ∓∞`, and
      // `−~oo = ~oo` (an unsigned infinity is its own negation). So there
      // is no off-carrier point, no domain condition, and no error this
      // declaration adds — `partiality: 'total'`. `NaN` propagates,
      // declared explicitly because the extended carrier is not a subtype
      // of `complex`, so the policy derived from the signature would be
      // `reject` (see `docs/ERROR-MODEL.md` §4). With every parameter
      // numeric, the missing-value behavior now DERIVES to `propagate`
      // (`resolvedMissingBehavior`, boxed-operator-definition.ts), so the
      // former explicit `missingBehavior: 'propagate'` declaration — which
      // the old `(value) -> value` signature needed, since a `value`
      // carrier derives `pass-through` — is no longer written here;
      // `Negate(Missing)` still yields `NaN`.
      //
      // The hot box route runs `checkNumericArgs` once in
      // `makeNumericFunction()` and bypasses the definition handler and its
      // post-handler signature seam. That fast path is also what admits a
      // `Quantity` or a `Measurement` operand, which type `value` and would
      // be disjoint from this carrier. The handler below remains the guarded
      // generic fallback for routes that do reach the definition.
      //
      // That handler folds a literal `NaN` operand to `NaN` at
      // canonicalization (through `.neg()`), rather than letting the node
      // survive to the propagation gate as `Power`/`Multiply`/`Add` do.
      // The fold is kept for the reason `canonicalDivide` keeps its own
      // (see the note there): the carrier has no off-carrier point, so no
      // enforcement seam is being bypassed, the folded literal types more
      // sharply than the unfolded node, and the folded value is exactly
      // what the gate would answer.
      signature: '(complex | infinity) -> number',
      examples: ['-(x - 1)'],
      nanBehavior: 'propagate',
      partiality: 'total',
      // The echo must REFLECT any range the operand type carries: `−|x|`
      // echoing `real<0..>` verbatim claimed a sign the value contradicts.
      // Ranges reflect about zero, tiers are their own negation
      // (`negateNumericType`).
      // A transparent alias of a SHAPE is unfolded before the echo, so `-L`
      // for `L: nums` (an alias of `list<number>`) is `list<number>` — the
      // alias policy of the broadcast lift — while a scalar alias keeps its
      // name (`-m` for `m: meters` is `meters`, like `m + 1`).
      type: ([x], context) =>
        BoxedType.forResult(
          negateNumericType(resolveShapedTypeAlias(x.type)),
          context.engine._typeResolver
        ),
      sgn: ([x]) => oppositeSgn(x.sgn),
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Negate'),
      evaluate: ([x], { numericApproximation, engine }) => {
        // Non-lazy: `x` is already evaluated by the driver.
        const nonNumeric = nonNumericOperandError(engine!, [x]);
        if (nonNumeric !== undefined) return nonNumeric;
        // A tuple with a list coordinate is data, not a point: arithmetic
        // over it is an error (see `listCoordinateTupleOperandError`).
        const listTuple = listCoordinateTupleOperandError(engine!, [x]);
        if (listTuple !== undefined) return listTuple;
        const evalX = x;
        if (isQuantity(evalX)) {
          if (isMeasurement(evalX.op1)) {
            const negM = measurementNegate(engine, evalX.op1);
            if (negM !== undefined) {
              const r = engine._fn('Quantity', [negM, evalX.op2]);
              return numericApproximation ? r.N() : r;
            }
          }
          const mag = evalX.op1.re;
          if (mag !== undefined)
            return engine._fn('Quantity', [engine.number(-mag), evalX.op2]);
        }
        if (isMeasurement(evalX)) {
          const r = measurementNegate(engine, evalX);
          return numericApproximation ? r?.N() : r;
        }
        const neg = evalX.neg();
        // If the operand only became a collection (vector/matrix) *after*
        // evaluation — e.g. `Negate(Multiply(A, B))` — the broadcast path was
        // skipped (the raw operand wasn't yet a collection), leaving an
        // undistributed `Negate(matrix)`. A later matrix `Add`/`Subtract` would
        // then misclassify it as a scalar and broadcast it over the other
        // matrix, producing a bogus higher-rank result. Evaluating the negation
        // distributes it element-wise. (Guarded so symbolic scalars like
        // `Negate(a)` don't recurse — and, via the `Negate`-operator check, so
        // a symbolic collection the negation could NOT distribute over doesn't
        // either: for e.g. a `Range` with symbolic bounds, `neg()` returns
        // `Negate(Range(…))` unchanged, and re-evaluating it would re-enter
        // this handler with the same operand, recursing without progress.)
        return evalX.isIndexedCollection && !isFunction(neg, 'Negate')
          ? neg.evaluate()
          : neg;
      },
    },

    Measurement: {
      description: 'A nominal value carrying a 1σ absolute uncertainty.',
      complexity: 1200,
      lazy: true,
      signature: '(value, value) -> value',
      examples: [
        'Measurement(9.81, 0.02)',
        'N(Measurement(5, 0.2) * Measurement(3, 0.4))',
      ],
      type: (ops, context) =>
        BoxedType.forResult(
          measurementTypeOnTypes(ops),
          context.engine._typeResolver
        ),
      canonical: (args, { engine: ce }) => {
        if (args.length !== 2) return ce.error('incompatible-type');
        const value = args[0].canonical;
        const error = args[1].canonical;
        // A zero (or absent) error collapses to the exact value (decided
        // 2026-07-07: zero error is an exact value).
        if (error.isSame(0)) return value;
        // Dimensional-consistency repair. `5.1 \pm 0.2\,\mathrm{cm}` parses
        // with the unit attached to the error term only: unit juxtaposition
        // binds during primary parsing, tighter than any infix, so no `\pm`
        // precedence can prevent it. A dimensionless value with a dimensioned
        // error (or vice versa) is not a meaningful measurement — the unit
        // scopes over the whole measurement:
        //   Measurement(v, Quantity(e, u)) → Quantity(Measurement(v, e), u)
        //   Measurement(Quantity(v, u), e) → Quantity(Measurement(v, e), u)
        // (Both operands Quantity — an error in a different unit than the
        // value — is left as written; propagation handles conversion.)
        if (
          isQuantity(error) &&
          !isQuantity(value) &&
          value.type.matches('number') &&
          error.op1.type.matches('number')
        ) {
          return ce._fn('Quantity', [
            ce._fn('Measurement', [value, error.op1.abs()]),
            error.op2,
          ]);
        }
        if (
          isQuantity(value) &&
          error.type.matches('number') &&
          value.op1.type.matches('number')
        ) {
          return ce._fn('Quantity', [
            ce._fn('Measurement', [value.op1, error.abs()]),
            value.op2,
          ]);
        }
        // The error is a 1σ absolute magnitude: canonicalize to |error|.
        return ce._fn('Measurement', [value, error.abs()]);
      },
      evaluate: (ops, { numericApproximation, engine: ce }) => {
        const value = numericApproximation ? ops[0].N() : ops[0].evaluate();
        const error = numericApproximation ? ops[1].N() : ops[1].evaluate();
        if (error.isSame(0)) return value;
        return ce._fn('Measurement', [value, error.abs()]);
      },
    },

    PlusMinus: {
      description: 'Plus or Minus',
      wikidata: 'Q260387',
      complexity: 1200,
      signature: '(T, U) -> tuple<T, U> where T: value, U: value',
      examples: ['PlusMinus(1, 0.1)'],
      canonical: (args, { engine: ce }) => {
        args = checkNumericArgs(ce, args, 2);
        if (args.length === 0) return ce.error('missing');
        return ce._fn('PlusMinus', [args[0], args[1].abs()]);
      },
      // Complete precondition: the evaluate handler has no decline path — a
      // valid `PlusMinus` always builds the `(x - y, x + y)` tuple, symbolic
      // operands included. (An arity/type error makes the instance invalid,
      // which `isEnumerableCollection` rejects before consulting this.)
      canEnumerate: () => true,
      evaluate: ([x, y], { engine }) => engine.tuple(x.add(y.neg()), x.add(y)),
    },

    Power: {
      description: 'Exponentiation: raise a base to a power.',
      keywords: ['exponent', 'exponentiation'],
      wikidata: 'Q33456',
      broadcastable: true,
      complexity: 3500,
      // The signature declares, PER SLOT, exactly the points where the
      // power has a value (ruled 2026-09-01):
      // - The BASE admits the finite complex numbers, the signed
      //   infinities (`(+∞)^2 = +∞`), and `~oo` — a positive power of
      //   `~oo` is `~oo` and a negative power is 0 in every direction of
      //   approach, so those values are genuine (`(~oo)^-1 = 0`, agreeing
      //   with the `Divide` route's `1/~oo`).
      // - The EXPONENT excludes `~oo`: `b^z` has no value at `z = ~oo`
      //   for ANY base — the result depends on the direction of approach
      //   in every case — so `2^~oo`, `0^~oo`, `(~oo)^~oo`, and
      //   `Exp(~oo)`/`Exp2(~oo)` (which canonicalize to `Power`) are
      //   incompatible-type errors. Indeterminate FORMS between admitted
      //   operands keep their NaN value (`0^0`, `1^∞`, `(±∞)^0`).
      // A PROVABLE violation errors at boxing, through the validation
      // seam that checks a `canonical`-handler head against its
      // declaration; a violation only a VALUE reveals surfaces at
      // evaluation, inside the `evaluate` handler below, which is the
      // enforcement seam for it — the same arrangement as the
      // trigonometric heads' factory (`trigFunction`, trigonometry.ts).
      // `canonicalPower` deliberately leaves the off-carrier points
      // unfolded so the node survives to that seam. `NaN` in either slot
      // propagates (declared explicitly: these extended carriers are not
      // subtypes of `complex`, so the policy derived from the signature
      // would be `reject` — see `docs/ERROR-MODEL.md` §4). The RESULT
      // stays the wide `number`: the compiled lanes' kind-preservation
      // discipline relies on it (`resultIsComplexValued`,
      // javascript-target.ts), and the per-call sharpness lives in the
      // type handler below.
      signature: '(complex | infinity, complex | signed_infinity) -> number',
      examples: ['[2^10, 2^(1/2), x^2 * x^3]'],
      nanBehavior: 'propagate',
      type: (ops, context) =>
        withZeroToZeroNaN(
          ops,
          context,
          ((): BoxedType | undefined => {
            const [base, exp] = ops;
            // A proven-NaN operand: decline, so the framework's proven-NaN arm
            // answers the sharp `nan` from the propagate policy (the
            // `Sqrt`/`Erf` precedent).
            if (provablyNaNOperand(base) || provablyNaNOperand(exp))
              return undefined;
            // A non-finite base or exponent can produce ±∞ *or* NaN — `0^∞`,
            // `∞^0`, `1^∞`, `i^∞`, `∞^i` are all indeterminate. Only a
            // *non-negative real* base raised to a *positive finite real* exponent
            // is guaranteed non-finite (`(+∞)^2 = +∞`); everything else widens to
            // the top type (the old `+oo | -oo` ignored the NaN forms).
            // `=== true` (not truthiness): an operand whose finiteness the
            // descriptor cannot decide must not be treated as non-finite.
            // Sign reads combine the value channel with the TYPE channel
            // (`operandSgn`): a literal's sign travels in its handler-visible
            // type, and `assume(x > 0)` travels in the symbol's refined type.
            const baseSgn = operandSgnOnTypes(base);
            const expSgn = operandSgnOnTypes(exp);
            const extended = extendedPowerType(
              base,
              exp,
              baseSgn,
              expSgn,
              context
            );
            if (extended !== undefined)
              return BoxedType.forResult(
                extended,
                context.engine._typeResolver
              );
            if (
              operandNonFiniteNumberOnTypes(base) ||
              operandNonFiniteNumberOnTypes(exp)
            ) {
              if (
                nonNegativeSign(baseSgn) === true &&
                exp.facts.finite === true &&
                positiveSign(expSgn) === true &&
                operandNonFiniteNumberOnTypes(base)
              )
                return BoxedType.forResult(
                  '+oo | -oo',
                  context.engine._typeResolver
                );
              return BoxedType.forResult(
                'number',
                context.engine._typeResolver
              );
            }
            // `0` raised to a non-positive power is a pole: `0^0` is indeterminate
            // and `0^-k = ±∞` (P0-11: `0^(−0.5) = +∞`).
            if (
              operandLiteralValueOnTypes(base) === 0 &&
              positiveSign(expSgn) !== true
            )
              return BoxedType.forResult(
                'number',
                context.engine._typeResolver
              );
            // Interval refinement for a LITERAL positive integer exponent (the
            // ruled first-round scope of the interval-arithmetic plan,
            // `docs/plans/2026-08-27-interval-arithmetic-result-types.md`;
            // exponent ≤ 0 is deferred with `Divide` — the pole story): the
            // base's interval raised per the `powInterval` case table. `even`
            // clamps the lower bound at 0 — sound independently of the
            // interval (an even power is never negative), so a dropped lower
            // bound cannot lose the sign fact the arms below claim.
            const powN = (() => {
              const nv = operandLiteralValueOnTypes(exp);
              // SAFE integers only: every double at or beyond 2⁵³ is even, so
              // the parity-based sign logic in `powInterval` would lie about
              // an exact odd exponent that large. (The literal channel never
              // carries such values today — the exactness gate in
              // `boxed-number.ts` refuses the whole span — but the guard
              // keeps the invariant local.)
              // Any NONZERO safe integer: a negative exponent is the reciprocal
              // of the positive power (`powIntervalSigned`); `n = 0` stays out
              // — `0^0` is the pole guard's business above.
              return nv !== undefined && Number.isSafeInteger(nv) && nv !== 0
                ? nv
                : undefined;
            })();
            // A NEGATIVE literal exponent over a base that may be ZERO is a
            // pole: `0^-2 = ~oo` (the projective infinity, type `infinity`), so
            // the finite `rational`/`real` fallbacks the arms below reach for
            // are unsound there — the same obligation the `Divide` handler
            // meets with `POSSIBLY_ZERO_QUOTIENT_TYPE` (dual-review catch). The
            // base admits zero when its interval does not exclude it AND its
            // sign does not prove it non-zero.
            const negativePoleTier = (): Type | undefined => {
              if (powN === undefined || powN > 0) return undefined;
              const bIv = intervalOfType(base.type);
              if (bIv !== undefined && intervalExcludesZero(bIv))
                return undefined;
              if (provablyNonZeroSign(base)) return undefined;
              return POSSIBLY_ZERO_QUOTIENT_TYPE;
            };
            const refinePow = (
              tier: Type,
              opts?: { clampNonNegative?: boolean; requirePositive?: boolean }
            ): Type | undefined => {
              if (powN === undefined) return undefined;
              const bIv = intervalOfType(base.type);
              if (bIv === undefined) return undefined;
              const p = powIntervalSigned(bIv, powN);
              if (p === undefined) return undefined;
              const iv = finalizeInterval(p);
              if (opts?.clampNonNegative) iv.lo = Math.max(iv.lo, 0);
              if (opts?.requirePositive && !(iv.lo > 0)) return undefined;
              const r = attachInterval(tier, iv);
              return typeof r === 'string' ? undefined : r;
            };
            // `integer ^ (non-negative integer)` stays an integer; a possibly
            // *negative* integer exponent yields a (non-integer) rational
            // (P0-11: `2^-2 = 1/4`). An EVEN exponent adds the sign: x² ≥ 0
            // (and x⁻² ≥ 0) for any real x (ROADMAP "Ranged types should carry
            // sign…", work item 4 — the even-power head).
            // A base that may be 0 with an exponent that may be negative: `0^−k`
            // is the complex infinity `~oo` (`0^−1`, `k^j` at `k = 0, j = −1`),
            // so the finite tiers below are unsound there. The claim is the one
            // `Divide` makes for a divisor that may be zero. A literal exponent
            // is read by `negativePoleTier` in the same way. Only a power that
            // is real otherwise (a non-negative base, or an integer exponent):
            // `x^r` with a possibly negative base may be complex, and the
            // branches below keep the wider claim for it.
            if (
              isExtendedRealOperand(base) &&
              isExtendedRealOperand(exp) &&
              (nonNegativeSign(baseSgn) === true ||
                factsOf(exp.type).integer) &&
              powerMayBePole(base, expSgn)
            )
              return BoxedType.forResult(
                negativePoleTier() ?? POSSIBLY_ZERO_QUOTIENT_TYPE,
                context.engine._typeResolver
              );
            const baseIsInteger = factsOf(base.type).integer;
            const expIsInteger = factsOf(exp.type).integer;
            if (baseIsInteger && expIsInteger) {
              if (nonNegativeSign(expSgn) === true) {
                const even = operandParityIsEven(exp) === true;
                return BoxedType.forResult(
                  refinePow('integer', { clampNonNegative: even }) ??
                    (even ? nonNegativeRangeType('integer') : 'integer'),
                  context.engine._typeResolver
                );
              }
              {
                // A possibly-negative integer exponent: the quotient tier is
                // `rational`, refined by the reciprocal interval when the
                // literal exponent is known (`x: integer<2<..<3>`, `x^-2`) —
                // unless the base may be zero, a pole.
                const even = operandParityIsEven(exp) === true;
                return BoxedType.forResult(
                  negativePoleTier() ??
                    refinePow('rational', { clampNonNegative: even }) ??
                    (even ? nonNegativeRangeType('rational') : 'rational'),
                  context.engine._typeResolver
                );
              }
            }
            if (factsOf(base.type).rational && expIsInteger) {
              const even = operandParityIsEven(exp) === true;
              return BoxedType.forResult(
                negativePoleTier() ??
                  refinePow('rational', { clampNonNegative: even }) ??
                  (even ? nonNegativeRangeType('rational') : 'rational'),
                context.engine._typeResolver
              );
            }
            // A real result needs a non-negative base or an integer exponent;
            // otherwise the result may be complex (e.g. (−2)^0.5).
            if (isExtendedRealOperand(base) && isExtendedRealOperand(exp)) {
              // A provably positive base keeps a positive result — `b^x =
              // e^(x·ln b) > 0` for a real exponent (`Exp` canonicalizes to
              // `Power(e, x)`, so this arm is item 4's `Exp` head); a
              // non-negative base or an even exponent keeps a non-negative one.
              // Same generic-point convention as the plain `real` claims
              // these refine: an operand of unknown finiteness is treated as a
              // finite point.
              if (positiveSign(baseSgn) === true)
                // The refinement must keep the positivity this arm proves, so
                // it only replaces the `& !0` claim when its own lower bound
                // is strictly positive.
                return BoxedType.forResult(
                  refinePow('real', { requirePositive: true }) ??
                    positiveRangeType('real'),
                  context.engine._typeResolver
                );
              if (nonNegativeSign(baseSgn) === true)
                return BoxedType.forResult(
                  negativePoleTier() ??
                    refinePow('real', { clampNonNegative: true }) ??
                    nonNegativeRangeType('real'),
                  context.engine._typeResolver
                );
              if (operandParityIsEven(exp) === true)
                return BoxedType.forResult(
                  negativePoleTier() ??
                    refinePow('real', { clampNonNegative: true }) ??
                    nonNegativeRangeType('real'),
                  context.engine._typeResolver
                );
              if (expIsInteger)
                return BoxedType.forResult(
                  negativePoleTier() ?? refinePow('real') ?? 'real',
                  context.engine._typeResolver
                );
              // A *provably negative* base with an exponent that provably lands on
              // the complex branch (`(−2)^0.3`) is a finite complex value — the
              // `number` default below is true but too coarse for the
              // compiler, which then guesses real and emits NaN. `=== true`, and
              // an exponent whose branch cannot be proven keeps the wider default.
              // (Nested under the `isExtendedReal` guard so a complex-typed base
              // never pays for the extra sign query.)
              if (
                negativeSign(baseSgn) === true &&
                negativeBaseIsComplexBranch(exp)
              )
                return BoxedType.forResult(
                  'complex',
                  context.engine._typeResolver
                );
            }
            // A pure-imaginary base (non-zero by type: `imaginary ∩ real =
            // nothing` in the lattice, and 0 is real) raised to an integer power:
            // (bi)^n = bⁿ·iⁿ, so an even n is real, an odd n is pure imaginary
            // (non-zero since b ≠ 0), and an unknown-parity integer is one of the
            // two — both ⊂ `complex`.
            if (factsOf(base.type).imaginary && expIsInteger) {
              if (operandParityIsEven(exp) === true)
                return BoxedType.forResult(
                  'real',
                  context.engine._typeResolver
                );
              if (operandParityIsOdd(exp) === true)
                return BoxedType.forResult(
                  'imaginary',
                  context.engine._typeResolver
                );
              return BoxedType.forResult(
                'complex',
                context.engine._typeResolver
              );
            }
            // A positive real base raised to a finite complex power is
            // e^(exp·ln base): finite and non-zero, hence a finite complex
            // number (e.g. `e^i`, on the unit circle).
            if (
              isExtendedRealOperand(base) &&
              positiveSign(baseSgn) === true &&
              factsOf(exp.type).complex
            )
              return BoxedType.forResult(
                'complex',
                context.engine._typeResolver
              );
            return BoxedType.forResult('number', context.engine._typeResolver);
          })()
        ),
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Power'),
      sgn: ([a, b]) => {
        //Missing some cases like (-1)^{1/3}
        // A finite, provably non-real base is necessarily nonzero (0 is
        // real), so its finite integer powers are nonzero. A *pure-imaginary*
        // base cycles with period 4: (βi)^p is real with sign (-1)^(p/2) for
        // even integer p, and pure imaginary — hence unsigned — for odd p.
        // The proof is `isExtendedReal === false` (three-valued: a claimed
        // `imaginary` refutes real-ness, a bare `complex` claim is a hedge —
        // `Sqrt(x)` for an `x` of unknown sign, which IS 0 at `x = 0` — and
        // decides nothing). (The two `isFinite` reads are implied by the
        // tier tests beside them — every bare numeric name denotes a finite
        // value — and are kept as an explicit statement of what the rule
        // needs: `β^∞` is 0 for |β| < 1, so neither operand may be
        // infinite.)
        if (
          a.isExtendedReal === false &&
          a.isFinite === true &&
          b.isInteger === true &&
          b.isFinite === true
        ) {
          if (a.type.matches('imaginary')) {
            if (b.isEven === true) {
              const p = b.re;
              if (Number.isSafeInteger(p))
                return (p / 2) % 2 === 0 ? 'positive' : 'negative';
              return 'not-zero';
            }
            if (b.isOdd === true) return 'unsigned';
          }
          return 'not-zero';
        }
        const aSgn = a.sgn;
        const bSgn = b.sgn;
        if (
          a.isExtendedReal === false ||
          b.isExtendedReal === false ||
          a.isNaN ||
          b.isNaN ||
          aSgn === undefined ||
          bSgn === undefined
        )
          return undefined;

        if (a.isSame(0))
          return b.isNonPositive
            ? 'unsigned'
            : b.isPositive
              ? 'zero'
              : undefined;

        if (a.isSame(0) && b.isSame(0)) return 'unsigned';

        if (a.isNonNegative || (b.numerator.isOdd && b.denominator.isOdd))
          return a.sgn;

        if (b.numerator.isEven && b.denominator.isOdd) {
          if (a.isExtendedReal) {
            const s = a.sgn;
            return s === 'positive' || s === 'not-zero' || s === 'negative'
              ? 'positive'
              : 'non-negative';
          }
          // Non-real bases were handled before the `isExtendedReal === false`
          // bail above; here `a.isExtendedReal` is undefined.
          return !a.isSame(0) ? 'not-zero' : undefined; //already accounted for a.is(0)
        }

        if (
          b.isRational === false ||
          (b.numerator.isOdd && b.denominator.isEven && a.isNonPositive)
        )
          return 'unsigned'; //already account for a>=0

        return undefined;
      },
      // x^n
      // evaluate: (ops) => ops[0].pow(ops[1]),
      evaluate: ([x, n], { numericApproximation, engine, expression }) => {
        // Non-lazy operator: operands arrive already evaluated by the driver
        // (`_computeValue` step 4/`holdMap`) — do not re-evaluate them.
        // Handler-side re-evaluation re-descends the whole (unmemoized)
        // operand subtree; under nesting that compounded to 2^depth (the
        // 2026-07-19 symbolic-recursion re-walk). Only LAZY operators
        // (`Add`, `Multiply`, `Sum`, …) receive raw operands and own their
        // evaluation.
        const nonNumeric = nonNumericOperandError(engine!, [x, n]);
        if (nonNumeric !== undefined) return nonNumeric;
        // A tuple with a list coordinate is data, not a point: arithmetic
        // over it is an error (see `listCoordinateTupleOperandError`).
        const listTuple = listCoordinateTupleOperandError(engine!, [x, n]);
        if (listTuple !== undefined) return listTuple;
        // The exponent carrier, enforced at the evaluate seam (see the
        // comment on the signature above): a `~oo` exponent — infinite
        // with no signed direction — is off-carrier, and gets the same
        // incompatible-type error value that boxing validation would have
        // produced. `NaN` is not an error (it propagates), and the signed
        // infinities are admitted values. The BASE slot needs no twin
        // check: its carrier admits every non-finite number. When BOTH
        // conditions hold — `Power(NaN, ~oo)` — the NaN wins: the
        // dispatch-time NaN-propagation gate runs before this handler, so
        // a NaN operand short-circuits the whole application (matching
        // IEEE `pow(NaN, x) = NaN`); this check only ever sees NaN-free
        // operands.
        if (
          isNumber(n) &&
          n.isFinite === false &&
          n.isNaN !== true &&
          n.isPositive !== true &&
          n.isNegative !== true
        )
          return engine!.typeError(POWER_EXPONENT_CARRIER_TYPE, n.type, n);
        const evalBase = x;
        if (evalBase.operator === 'Quantity') {
          const r = quantityPower(engine!, evalBase, n);
          if (
            numericApproximation &&
            r &&
            isQuantity(r) &&
            isMeasurement(r.op1)
          )
            return r.N();
          return r;
        }
        const evalExp = n;
        if (
          evalBase.operator === 'Measurement' ||
          evalExp.operator === 'Measurement'
        ) {
          const r = measurementPower(engine!, evalBase, evalExp);
          return numericApproximation ? r?.N() : r;
        }
        // Under `.N()`, an exact base raised to a large exact integer `k`: the
        // relative error of the base is multiplied by `|k|`, so the float of
        // `π` at 21 digits gives only 17 correct digits of `π^1000000`. The
        // base is approximated again with `log10(|k|) + 2` more digits
        // (`exactBaseIntegerPower()`).
        if (numericApproximation) {
          const r = exactBaseIntegerPower(expression);
          if (r !== undefined) return r;
        }
        // D2: an inexact (float) base or exponent numericizes even under
        // plain evaluate() — `Power(2, 5.1)` → 34.29…, matching `Cos(5.1)`.
        // `isExactNumber` (not plain `isExact`) additionally protects the
        // exact power path for a Gaussian-integer base still carried by the
        // inexact lane (e.g. built from the machine `i` constant), so
        // `(1+i)^2 = 2i` — WP-2.16. Exact complex literals (since D12-A)
        // are already covered by `isExact`.
        return pow(x, n, {
          numericApproximation: shouldNumericize(numericApproximation, x, n),
          // The node's own exponent, BEFORE numericization: `n` above may be a
          // double by now, which loses the exact rational terms that decide the
          // branch of a negative base. `expression.ops` are the raw operands
          // this call's `[x, n]` were evaluated from, so `op2` is `n`'s
          // provenance. (Absent when the handler is invoked outside the
          // evaluation driver — `pow` then falls back to reconstruction.)
          rawExponent:
            expression !== undefined && isFunction(expression)
              ? expression.op2
              : undefined,
        });
      },
      // Defined as RealNumbers for all power in RealNumbers when base > 0;
      // when x < 0, only defined if n is an integer
      // if x is a non-zero complex, defined as ComplexNumbers
      // Square root of a prime is irrational (AlgebraicNumbers)
      // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
    },

    Rational: {
      description:
        'Construct a rational number from a numerator and denominator.',
      complexity: 2400,

      // Two distinct forms (ruled 2026-08-24): `Rational(x)` approximates a
      // real by a rational; `Rational(n, d)` CONSTRUCTS the rational `n/d`
      // from two integers. There is no `(number, number)` form — the
      // two-argument constructor rewrites to `Divide`, so a non-integer
      // argument would silently become plain division (`Rational(3, 2.5)`
      // evaluated to `1.2`), which almost always indicates a caller error.
      signature: '((real) -> rational) | ((integer, integer) -> rational)',
      examples: ['[Rational(3, 6), Rational(1.25)]'],
      sgn: ([n]) => n.sgn,
      canonical: (args, { engine }) => {
        const ce = engine;
        args = flatten(args);

        if (args.length === 0) return ce._fn('Rational', [ce.error('missing')]);

        if (args.length === 1)
          return ce._fn('Rational', [checkType(ce, args[0], 'real')]);

        // `checkType` admits a merely-OVERLAPPING operand (deferred
        // validation: a `number`-typed symbol may turn out integral), so a
        // concrete non-integer — a literal or a symbol holding one — slipped
        // through to the `Divide` rewrite. Decide exactly on the evidence:
        // proven non-integers are rejected here, while a valueless symbol
        // stays admitted and rewrites to `Divide` as before. (The box-time
        // numeric constructor in `box.ts` makes the same check; this branch
        // covers the structural/partial-canonicalization routes that reach
        // the handler instead.)
        args = checkTypes(ce, args, ['integer', 'integer']).map((arg) =>
          arg.isValid && evidenceAdmissionOf(arg, 'integer') === 'refute'
            ? ce.typeError('integer', arg.type, arg)
            : arg
        );

        if (args.length !== 2 || !args[0].isValid || !args[1].isValid)
          return ce._fn('Rational', args);

        return args[0].div(args[1]);
      },
      evaluate: (ops, { numericApproximation, engine }) => {
        const ce = engine;
        //
        // If there is a single argument, i.e. `['Rational', 'Pi']`
        // the function evaluates to a rational expression of the argument
        //
        if (ops.length === 1) {
          // A symbolic argument cannot numericize; skip the (potentially
          // exponential) `.N()` walk the `isNumber` test would then reject.
          if (ops[0].unknowns.length > 0) return undefined;
          const f = ops[0].N();
          if (!isNumber(f) || f.isComplex) return undefined;
          return ce.number(rationalize(f.re));
        }

        if (numericApproximation) {
          return apply2(
            ops[0],
            ops[1],
            (a, b) => a / b,
            (a, b) => a.div(b),
            (a, b) => complexDivide(a, b)
          );
        }
        const [n, d] = [asSmallInteger(ops[0]), asSmallInteger(ops[1])];
        if (n !== null && d !== null) return ce.number([n, d]);
        return undefined;
      },
    },

    Rationalize: {
      description:
        'Approximate a real number by a rational. With a second argument `tolerance`, return the rational with the smallest denominator that approximates the number to within `tolerance` (a continued-fraction convergent); with no tolerance, rationalize at full working precision, as single-argument `Rational`.',
      complexity: 2400,
      // The value is a FINITE real: no rational lies within any tolerance of
      // an infinity, and the continued-fraction expansion needs the order of
      // the real line, so every infinity and every non-real number is
      // off-carrier — an `incompatible-type` error at boxing (no `canonical`
      // handler, no fast path). `Rationalize(+∞)` used to answer `+∞` under
      // a `rational` claim. A NaN value propagates. The tolerance is a
      // NON-NEGATIVE finite real, spelled as the range type: a negative
      // literal is refused at boxing (it used to be read as its absolute
      // value), and a NaN tolerance is a contract violation (`reject`), not
      // a value to propagate — the derived policy for a `real` slot would
      // be `propagate`, hence the explicit pair. Ruling recorded in
      // `docs/plans/2026-08-30-error-model-implementation.md`, Phase F
      // batch 10.
      signature: '(real, real<0..>?) -> rational',
      nanBehavior: ['propagate', 'reject'],
      examples: [
        'Rationalize(1.75)  // 7/4',
        'Rationalize(Sqrt(3), 1/500)  // 26/15',
      ],
      evaluate: (ops, { engine }) => {
        const ce = engine;
        // See `Rational`: a symbolic argument cannot numericize.
        if (ops[0].unknowns.length > 0) return undefined;
        const f = ops[0].N();
        if (!isNumber(f) || f.isComplex) return undefined;
        if (ops.length >= 2) {
          const tol = ops[1].N();
          if (!isNumber(tol) || tol.isComplex) return undefined;
          return ce.number(rationalize(f.re, tol.re));
        }
        return ce.number(rationalize(f.re));
      },
    },

    Root: {
      description: 'n-th root of a value.',
      keywords: ['nth root', 'cube root'],
      complexity: 3200,
      broadcastable: true,

      // `Root(x, n)` IS `Power(x, 1/n)`, at every point (ruled 2026-09-01),
      // and both carriers follow from that: the radicand takes `Power`'s
      // base carrier — every number except NaN, `~oo` included
      // (`Root(~oo, 3) = ~oo` by the modulus rule, `Root(~oo, −2) = 0`) —
      // and the index admits every number except NaN too, because `1/n`
      // is then a signed infinity (`n = 0`), 0 (`n = ±∞` or `~oo`), or a
      // finite number, and `Power` decides from there: `Root(x, ±∞) =
      // x^0 = 1` for a finite non-zero `x` and NaN for `Root(0, ±∞)` and
      // `Root(±∞, ±∞)` (the `0^0`/`∞^0` forms), `Root(2, 1/2) = 2^2 = 4`.
      // The one index with NO value is 0: `1/0 = ~oo`, and a `~oo`
      // exponent is outside `Power`'s domain, so `Root(x, 0)` is an
      // Error — declared as the `requires` precondition, which the
      // dispatch gate answers before the handler runs. `NaN` in either
      // slot propagates (explicit: these carriers are not subtypes of
      // `complex`, so the policy derived from the signature would be
      // `reject`). The values are folded by `root()` (arithmetic-power.ts),
      // which delegates the non-finite cases to `pow`.
      signature: '(complex | infinity, complex | infinity) -> number',
      examples: ['[Root(8, 3), N(Root(2, 3))]'],
      nanBehavior: 'propagate',
      requires: ([, n]) => {
        if (n === undefined || !isNumber(n)) return undefined;
        return n.isSame(0) ? false : undefined;
      },
      type: ([base, exp], context) => {
        // A proven-NaN operand: decline, so the framework's proven-NaN arm
        // answers the sharp `nan` (the `Sqrt` precedent).
        if (provablyNaNOperand(base) || provablyNaNOperand(exp))
          return undefined;
        // Root(x, n) = x^(1/n). A non-finite base or index makes the result
        // indeterminate: Root(±∞, n) ∈ {0, ±∞, complex}, Root(x, ±∞) = x^0
        // (often 1 but 0^0/∞^0 are NaN). Widen to the top type.
        if (
          operandNonFiniteNumberOnTypes(base) ||
          operandNonFiniteNumberOnTypes(exp)
        )
          return BoxedType.forResult('number', context.engine._typeResolver);
        // Root(x, 0) = x^(1/0) = x^~oo: an Error at evaluation (the
        // `requires` precondition above); the type stays the wide hedge.
        if (operandLiteralValueOnTypes(exp) === 0)
          return BoxedType.forResult('number', context.engine._typeResolver);
        if (operandLiteralValueOnTypes(exp) === 1)
          return BoxedType.forResult(base.type, context.engine._typeResolver);
        // Root(0, n): 0 for n>0, a pole (±∞) for n≤0, NaN for a complex index.
        const rootExpSgn = operandSgnOnTypes(exp);
        if (operandLiteralValueOnTypes(base) === 0)
          return BoxedType.forResult(
            positiveSign(rootExpSgn) === true ? 'integer' : 'number',
            context.engine._typeResolver
          );
        if (isExtendedRealOperand(base) && isExtendedRealOperand(exp)) {
          const rootBaseSgn = operandSgnOnTypes(base);
          // A positive base always gives a positive real root.
          if (positiveSign(rootBaseSgn) === true)
            return BoxedType.forResult('real', context.engine._typeResolver);
          // A negative real base with a provably *even* degree has no real
          // value: Root(−8, 4) = 1.1892… + 1.1892…i. (An *odd* degree keeps
          // CE's real-root convention — Root(−8, 3) = −2 — and a degree of
          // unknown parity keeps the `number` hedge below.) `=== true`
          // throughout: a symbolic degree has no provable parity.
          if (
            negativeSign(rootBaseSgn) === true &&
            operandParityIsEven(exp) === true &&
            positiveSign(rootExpSgn) === true
          )
            return BoxedType.forResult('complex', context.engine._typeResolver);
          // A negative real base: a positive index yields a finite (real or
          // complex) value; a non-positive index can numericize to NaN in the
          // current evaluate path (e.g. Root(−2,−2)), so widen to `number`.
          if (positiveSign(rootExpSgn) === true)
            return BoxedType.forResult('number', context.engine._typeResolver);
          return BoxedType.forResult('number', context.engine._typeResolver);
        }
        return BoxedType.forResult('number', context.engine._typeResolver);
      },
      sgn: ([x, n]) => {
        // Note: we can't simplify this to a power, then get the sgn of that because this may cause an infinite loop
        if (x.isExtendedReal === false || n.isExtendedReal === false)
          return 'unsigned';
        if (x.isSame(0)) {
          if (n.isNonPositive) {
            return 'unsigned';
          }
          if (n.isPositive) return 'zero';
        }
        if (x.isPositive === true) return 'positive';
        if (x.isNonNegative === true) return 'non-negative';
        if (n.isOdd === true || (n.numerator.isOdd && n.denominator.isOdd)) {
          return x.sgn;
        }
        if (x.isNegative && n.isOdd === false) return 'unsigned';
        return undefined;
      },
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Root'),
      evaluate: ([x, n], { numericApproximation, engine, expression }) => {
        // Non-lazy: operands are already evaluated by the driver.
        const nonNumeric = nonNumericOperandError(engine, [x, n]);
        if (nonNumeric !== undefined) return nonNumeric;
        const evalX = x;
        if (evalX.operator === 'Quantity') {
          const nVal = n.re;
          if (nVal !== undefined && nVal !== 0) {
            const r = quantityPower(engine, evalX, engine.number(1 / nVal));
            if (
              numericApproximation &&
              r &&
              isQuantity(r) &&
              isMeasurement(r.op1)
            )
              return r.N();
            return r;
          }
        }
        if (isMeasurement(evalX)) {
          const r = measurementRoot(engine, evalX, n);
          return numericApproximation ? r?.N() : r;
        }
        // An exact radicand outside the double range (`10^{-900}`) can have
        // a root in the double range (`Root(10^{-900}, 3)` is `1e-300`). The
        // root is computed with big decimals, as `exp(ln(x) / n)`. A negative
        // radicand has a real root only for an odd integer index.
        if (numericApproximation && isNumber(n) && !n.isComplex) {
          const big = bigRealOf(
            exactValueOutOfDoubleRange(engine, operandOf(expression, 0), x)
          );
          const k = n.re;
          if (
            big !== undefined &&
            Number.isFinite(k) &&
            k !== 0 &&
            (!big.isNegative() || (Number.isInteger(k) && k % 2 !== 0))
          ) {
            const r = withDoubleDigits(() => big.abs().ln().div(k).exp());
            return boxBignumResult(engine, big.isNegative() ? r.neg() : r);
          }
        }
        // D2: an inexact (float) radicand or index numericizes even under
        // plain evaluate() — `Root(5.1, 3)` → 1.721…; `isExactNumber`
        // protects an exact Gaussian-integer radicand (see `Power`).
        return root(x, n, {
          numericApproximation: shouldNumericize(numericApproximation, x, n),
        });
      },
    },

    Remainder: {
      description:
        'IEEE remainder: the signed remainder after dividing x by y, with the quotient rounded to the nearest integer (ties round toward +Infinity, matching JavaScript `Math.round`)',
      complexity: 2500,
      broadcastable: true,
      signature: '(T, T) -> T where T: number',
      examples: ['[Remainder(7, 3), Remainder(-7, 3)]'],
      // A zero divisor has no remainder, as for `Mod(5, 0)`: the
      // indeterminate form `Indeterminate`, or `NaN` with a float operand
      // (`indeterminateFormAnswer()`). This is decided here, not with a
      // `definedWhen` predicate as for `Mod`: the codomain marker of that
      // predicate is read from the declared result, and the polytype `T`
      // of this signature is not provably a number, so it would answer
      // `Missing`.
      //
      // For the same reason, the result type is given by this handler, not
      // by `definedWhen`: a divisor that is provably zero gives `nan`, a
      // divisor that may be zero gives the operands' numeric kind joined
      // with `nan`, and a divisor that is provably not zero declines, so
      // that the polytype result `T` applies. The kind is read from the
      // static types of the operands (their element types under a
      // broadcast), as in the type handler of `Mod`.
      type: ([a, b], context) => {
        if (!a || !b) return undefined;
        const literalNonZero = nonZeroLiteral(b);
        if (literalNonZero === false)
          return BoxedType.forResult('nan', context.engine._typeResolver);
        const bSgn = operandSgnOnTypes(b);
        if (
          literalNonZero === true ||
          positiveSign(bSgn) === true ||
          negativeSign(bSgn) === true ||
          bSgn === 'not-zero'
        )
          return undefined;
        const ta = broadcastCellType(a.type);
        const tb = broadcastCellType(b.type);
        // An operand that is not provably a number (`unknown`) makes the
        // polytype result `unknown`, which already admits `nan`.
        if (!isSubtype(ta, 'number') || !isSubtype(tb, 'number'))
          return undefined;
        const kind: Type =
          factsOf(ta).integer && factsOf(tb).integer
            ? 'integer'
            : factsOf(ta).rational && factsOf(tb).rational
              ? 'rational'
              : factsOf(ta).real && factsOf(tb).real
                ? 'real'
                : 'number';
        return BoxedType.forResult(
          reduceType({ kind: 'union', types: [kind, 'nan'] }),
          context.engine._typeResolver
        );
      },
      evaluate: ([a, b], { engine }) => {
        if (isNumber(b) && b.isSame(0))
          return indeterminateFormAnswer(engine, [a, b]);
        return apply2(
          a,
          b,
          (a, b) => a - b * Math.round(a / b),
          // `BigDecimal.round()` rounds ties away from zero, which disagrees
          // with `Math.round`'s ties-toward-+Infinity at half-integer
          // quotients (e.g. Remainder(-5, 2): machine lane rounds -2.5 to
          // -2, bignum `.round()` would round it to -3, flipping the result
          // sign). `floor(x + 0.5)` reproduces `Math.round`'s tie-breaking
          // exactly, keeping both lanes in agreement.
          (a, b) => a.sub(b.mul(a.div(b).add(0.5).floor()))
        );
      },
    },

    Round: {
      description:
        'Rounds a number to the nearest integer, or (with a precision argument) to `n` decimal places.',
      complexity: 1250,
      broadcastable: true,
      // Optional precision arg (Desmos/spreadsheet `round(x, n)`): round to `n`
      // decimal places. Without it, rounds to the nearest integer.
      //
      // The carrier is the extended real line — rounding depends on the
      // order of the real line, and `Round(±∞) = ±∞` — so a proven
      // off-carrier operand (a complex value, `~oo`) is a boxing error,
      // and a `NaN` argument in the VALUE slot propagates through the
      // generic gate (an extended-real carrier derives `reject`, hence
      // the explicit declaration). The declared result is
      // `real | signed_infinity`, not the family's
      // `integer | signed_infinity`, because the precision form is
      // generally non-integer (`Round(3.14159, 2)` is the exact rational
      // `157/50`, see `applyRounding()`); the handler below restores the
      // sharp `integer` claim for the single-argument form. The precision
      // slot keeps the DERIVED `NaN` policy for an integer carrier
      // (`reject`): a `NaN` digit count is an error, not a value to
      // propagate — which is why `nanBehavior` is the one-element array
      // (slot 0 only) rather than operator-wide.
      // NO `partiality: 'total'` claim, deliberately: the precision form
      // computes `10^n` first, and an exact power beyond the
      // materialization limit stays symbolic, so an in-carrier call such
      // as `Round(1, 500001)` remains unevaluated — the omitted
      // (may-marker) default is the honest declaration.
      // (`docs/ERROR-MODEL.md` §4; the Phase F record in
      // `docs/plans/2026-08-30-error-model-implementation.md`.)
      signature: '(real | signed_infinity, integer?) -> real | signed_infinity',
      examples: ['[Round(2.5), Round(-2.5), Round(3.14159, 2)]'],
      nanBehavior: ['propagate'],
      type: ([x, n], context) => {
        const t = roundingFunctionTypeOnTypes(x);
        if (n === undefined)
          return BoxedType.forResult(t, context.engine._typeResolver);
        // With a precision arg the result is generally non-integer
        // (`Round(3.14159, 2)` is `157/50`): keep the non-finite
        // classification, but replace the integer claim by `real`.
        // The replacement must apply to EVERY operand that rounds to
        // `integer`, including a bare `real` symbol of unknown
        // finiteness — an earlier guard on `isFinite === true` let
        // `Round(x, 2)` with `x: real` fall through to `integer`.
        if (t === 'integer')
          return BoxedType.forResult('real', context.engine._typeResolver);
        if (t === undefined) return undefined;
        // A pure signed-infinity claim survives the precision arg
        // (`Round(±∞, n) = ±∞`); any mixed claim relaxes to
        // `real | signed_infinity`, which IS the declared result, so
        // decline and let it apply. Structural test, not object identity:
        // the helper's claim must not be tied to which constant it built
        // the type from.
        return BoxedType.forResult(
          isSubtype(t, SIGNED_INFINITY_TYPE) ? t : undefined,
          context.engine._typeResolver
        );
      },
      sgn: ([x, n]) => {
        // Only reason about the sign in the single-argument (round-to-integer)
        // case; a precision arg rescales the value and the interval reasoning
        // below no longer holds.
        if (n !== undefined) return undefined;
        if (x.isNaN) return 'unsigned';
        // The evaluate handler rounds a half AWAY FROM ZERO at every
        // precision (`Round(-1/2)` and `Round(-0.5)` are both `-1`; user
        // decision, 2026-09-21), so this sign uses the same rule.
        if (isNumber(x)) {
          // An exact literal is rounded exactly: the double `x.re` of
          // `1/2 − 10⁻³⁰` is `0.5`, which rounds to `1`, not `0`.
          const exact = roundExactReal(x, 'round');
          if (exact !== undefined)
            return exact > 0n ? 'positive' : exact < 0n ? 'negative' : 'zero';
          return numberSgn(roundHalfAway(x.re));
        }
        const half = x.engine.number([1, 2]);
        const minusHalf = x.engine.number([-1, 2]);
        if (isOrdered(x, '>=', half)) return 'positive';
        if (isOrdered(x, '<=', minusHalf)) return 'negative';
        if (isOrdered(x, '<', half) && isOrdered(x, '>', minusHalf))
          return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive) return 'non-positive';
        return undefined;
      },
      evaluate: ([x, n], { engine: ce, numericApproximation, expression }) => {
        // A half rounds AWAY FROM ZERO at every precision (`Round(-0.5)` is
        // `-1`, `Round(2.5)` is `3`; user decision, 2026-09-21). The
        // big-number lane `BigDecimal.round()` already does that; the machine
        // lane needs `roundHalfAway`, because JavaScript `Math.round` rounds
        // a half toward `+∞`. The precision form below inherits the rule: it
        // rounds the SCALED value with the same helper. `applyRounding()`
        // boxes the rounded value as an exact integer also for a float `x`,
        // so the precision form divides two exact numbers and its result is
        // an exact rational (`Round(3.14159, 2)` is `157/50`, as in
        // Mathematica).
        const original = originalOperand(expression, 0);
        const roundToInteger = (v: Expression, original?: Expression) =>
          applyRounding(
            v,
            'round',
            roundHalfAway,
            (v) => v.round(),
            numericApproximation,
            original
          );
        if (n === undefined) return roundToInteger(x, original);
        // Round(x, n) = Round(x·10ⁿ)/10ⁿ — round to `n` decimal places.
        if (!isNumber(n) || n.isFinite !== true) return undefined;
        const factor = ce.number(10).pow(n);
        if (numericApproximation) {
          // Under `.N()`, an operand whose exact value is known is rounded
          // exactly, as without `.N()`, and the RESULT is approximated
          // (`exactRoundingOperand()` says when the exact value is used).
          // The jump test reads the scaled float `x·10ⁿ`.
          const scaledFloat = x.mul(factor);
          const exactX = isExactRealLiteral(x)
            ? x
            : original !== undefined &&
                (isNumber(original) || isNearRoundingJump(scaledFloat, 'round'))
              ? exactRealValueOf(original)
              : undefined;
          let k =
            exactX === undefined
              ? undefined
              : roundExactReal(exactX.mul(factor), 'round');
          // An exact constant expression that is not a number (`π`) is
          // rounded from enclosures of its scaled value
          // (`roundExactConstant()`), at any distance from a jump, as in
          // `applyRounding()`.
          if (k === undefined && exactX === undefined && original !== undefined)
            k = roundExactConstant(
              ce.function('Multiply', [original, factor]),
              'round',
              true
            );
          if (k !== undefined) return ce.number(k).div(factor).N();
          const scaled = roundToInteger(scaledFloat);
          return scaled === undefined ? undefined : scaled.div(factor);
        }
        const scaled = roundToInteger(x.mul(factor));
        return scaled === undefined ? undefined : scaled.div(factor);
      },
    },

    /** Heaviside step function: H(x) = 0 for x < 0, 1/2 for x = 0, 1 for x > 0 */
    Heaviside: {
      description: 'Heaviside step function.',
      complexity: 1200,
      broadcastable: true,
      // The FIRST Contract B domain signature (`docs/ERROR-MODEL.md` §4's
      // worked example; the Phase F pilot of
      // `docs/plans/2026-08-30-error-model-implementation.md`, carrier
      // ruled 2026-08-31): the carrier is exactly where H has a value —
      // the extended real line, `H(±∞)` = 1/0 included — and the success
      // type is exactly its values {0, ½, 1}. The consequences, each
      // ruled: `Heaviside(i)` and `Heaviside(~oo)` are boxing errors
      // (they were inert forever); the application TYPE is the derived
      // `rational<0..1>` for a proven extended-real argument and
      // `rational<0..1> | nan` for a maybe-NaN one — no hand-written type
      // handler (the claim the retired real-only step-function handler
      // used to compute is now read off this declaration by the generic
      // derivation).
      signature: '(real | signed_infinity) -> rational<0..1>',
      examples: ['[Heaviside(-2), Heaviside(0), Heaviside(3)]'],
      // Explicit: the DERIVED default answers `reject` for this carrier
      // (an extended-real carrier is not a subtype of `complex`, which is
      // the mechanical propagate test), and `H(NaN)` must be `NaN` — the
      // conformed §4 behavior.
      nanBehavior: 'propagate',
      // H has a value at EVERY point of its carrier, and its three values
      // are exactly machine-representable, so the numeric route cannot
      // fail either: the strong claim is true, and it is what discharges
      // the marker arm so the derived type is exactly `rational<0..1>`
      // for an in-carrier argument.
      partiality: 'total',
      // H(x) ∈ {0, 1/2, 1} — non-negative wherever H has a value. Every
      // VALID operand is in the extended-real carrier now, but the sign
      // channel can be probed before validation settles, so the guard
      // stays: extended realness, matching the carrier.
      sgn: ([x]) => (x.type.facts.extendedReal ? 'non-negative' : undefined),
      evaluate: ([x], { engine, numericApproximation, expression }) => {
        // Only mathematics: the NaN arm this handler used to carry is the
        // generic policy gate's job now (`nanBehavior: 'propagate'`
        // above), and an off-carrier operand never reaches this handler.
        //
        // Under `.N()`, H jumps at 0, as `Sign` does: the exact value of an
        // exact operand near 0 is used (`exactZeroJumpOperand()`).
        x = exactZeroJumpOperand(x, numericApproximation, expression);
        if (x.isSame(0)) return engine.Half;
        if (x.isPositive) return engine.One;
        if (x.isNegative) return engine.Zero;
        return undefined;
      },
    },

    Sign: {
      description:
        'Sign of a number: -1, 0, or 1 for a real; `z/|z|`, the point of the unit circle in its direction, for a complex `z`.',
      complexity: 1200,
      broadcastable: true,
      // The carrier is every point where the sign is defined: the finite
      // complex plane, and the signed infinities (`Sign(±∞)` = ±1). On the
      // extended real line the result is exactly {−1, 0, 1}, the
      // finitely-valued tier WITH its range so type-channel consumers read
      // the bounds without consulting the sgn handler; off the real line
      // it is the usual convention `z/|z|` — `Sign(i)` is `i`,
      // `Sign(3 + 4i)` is `3/5 + 4i/5` — the reading Fungrim (entry
      // 09c107), SymPy and Mathematica share. `~oo` has no direction and
      // stays off the carrier, so `Sign(~oo)` is a boxing error. The type
      // handler keeps the sharp ranged tier for a proven extended-real
      // argument and answers `complex` otherwise; the generic policy gate
      // adds the `nan` arm exactly where the argument can carry one.
      // (Domain-signature doctrine: `docs/ERROR-MODEL.md` §4.)
      signature: '(complex | signed_infinity) -> complex',
      examples: ['[Sign(-3), Sign(0), Sign(3 + 4i)]'],
      type: ([x], context) => {
        if (x === undefined)
          return BoxedType.forResult('complex', context.engine._typeResolver);
        // Under a broadcast the handler describes ONE element and the call
        // site re-wraps the operand's shape (`broadcastOperandType`).
        const t = broadcastOperandType(x);
        // A NaN operand is the policy gate's answer (`nanBehavior:
        // 'propagate'` below makes it `nan`); `never` is a subtype of
        // everything and means "no value", not a proven NaN. A MAYBE-NaN
        // operand — a symbol typed `number`, a `real | nan` result — carries
        // the `nan` arm beside the sign's own type, which is read off the
        // NaN-free part: the NaN member alone must not turn a real operand
        // into a complex one.
        if (t !== 'never' && factsOf(t).nan) return undefined;
        const maybeNaN = couldMatch(t, 'nan');
        const real = factsOf(maybeNaN ? withoutNaN(t) : t).extendedReal;
        if (!maybeNaN)
          return BoxedType.forResult(
            real ? SIGN_RANGE_TYPE : 'complex',
            context.engine._typeResolver
          );
        return BoxedType.forResult(
          real ? SIGN_RANGE_NAN_TYPE : COMPLEX_NAN_TYPE,
          context.engine._typeResolver
        );
      },
      // Explicit: the DERIVED default for this carrier would propagate
      // already (a finite complex carrier is the mechanical propagate test),
      // and `Sign(NaN)` must be `NaN` — the conformed §4 behavior. Stated
      // so the declaration reads without deriving it.
      nanBehavior: 'propagate',
      // The sign is defined at EVERY point of the carrier and its three
      // values are exactly machine-representable, so the numeric route
      // cannot fail either: the strong claim is what discharges the marker
      // arm and keeps the derived type sharp for an in-carrier argument.
      partiality: 'total',
      // Forwarding the operand's own sign is sound on the carrier and for
      // a propagated NaN alike: `Sign(x)` and `x` have the same sign
      // wherever `Sign` has a value, and `Sign(NaN)` is `NaN`, whose sign
      // IS the operand's (`unsigned`). Unlike `Heaviside` above, no
      // carrier guard is needed: `Heaviside`'s handler asserts a CONSTANT
      // claim (`non-negative`) that is wrong off the carrier, while a
      // DIRECTIONAL answer from the operand's own sign channel
      // (`positive`/`negative`/`zero`…) already proves the operand is an
      // extended real — the sign channel answers `unsigned`/`undefined`,
      // never a direction, for an operand not proven on the real line.
      sgn: ([x]) => x.sgn,
      evaluate: ([x], { engine, numericApproximation, expression }) => {
        // Only mathematics: the NaN arm this handler used to carry is the
        // generic policy gate's job now (`nanBehavior: 'propagate'`
        // above), and an off-carrier operand never reaches this handler.
        //
        // Under `.N()`, the sign jumps at 0, and the float of an exact
        // operand near 0 can have the wrong sign: the exact value of the
        // operand is used then (`exactZeroJumpOperand()`).
        x = exactZeroJumpOperand(x, numericApproximation, expression);
        if (x.isSame(0)) return engine.Zero;
        if (x.isPositive) return engine.One;
        if (x.isNegative) return engine.NegativeOne;
        // A complex number literal off the real line: `z/|z|`, exact when
        // the modulus is (`Sign(3 + 4i)` is `3/5 + 4i/5`). A symbolic
        // operand stays symbolic.
        if (isNumber(x) && x.isComplex) {
          const unit = engine.function('Divide', [
            x,
            engine.function('Abs', [x]),
          ]);
          return numericApproximation ? unit.N() : unit.evaluate();
        }
        return undefined;
      },
    },

    // {% def "GammaSgn" %}

    // [&quot;**GammaSgn**&quot;, _z_]{.signature}

    // {% latex "\\operatorname{sgn}(\\gamma(z))" %}

    // The gamma function can be computed as \\( \operatorname{sgn}\Gamma(x) \cdot
    // \expoentialE^{\operatorname{LogGamma}(x)} \\)
    // `["Multiply", ["GammaSgn", "x"], ["Exp", ["LogGamma", "x"]]]`.

    Sqrt: {
      description: 'Square Root',
      keywords: ['square root', 'radical'],
      wikidata: 'Q134237',
      complexity: 3000,
      broadcastable: true,
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Sqrt'),

      // The carrier is every point where the square root has a value —
      // all of `number` except NaN: the finite complex numbers, the
      // signed infinities (`√(+∞) = +∞`, `√(−∞) = i·∞ = ~oo`), and
      // `~oo`: `√(~oo) = ~oo`, because the modulus grows without bound in
      // every direction of approach, so the value is the point at
      // infinity (ruled 2026-09-01 — the same modulus rule that gives
      // `Power(~oo, 1/2) = ~oo`; it reverses the 2026-08-31 choice that
      // made `~oo` an error here for uniformity with `Sin`). The values
      // live in `BoxedNumber.sqrt()`, which both routes call. The result
      // needs the `infinity` arm because `√(−∞)` and `√(~oo)` are `~oo`,
      // which the signed pair excludes.
      signature: '(complex | infinity) -> complex | infinity',
      examples: ['[Sqrt(8), Sqrt(-4), N(Sqrt(2))]'],
      // Explicit: the DERIVED default answers `reject` for a carrier that
      // is not a subtype of `complex`, and `Sqrt(NaN)` must be `NaN`.
      nanBehavior: 'propagate',
      type: ([x], context) => {
        // A proven-NaN operand: decline, so the framework's proven-NaN arm
        // answers the sharp `nan` (the propagated value's own type).
        if (provablyNaNOperand(x)) return undefined;
        // An operand whose TYPE admits NaN beside other values (`nan | real`,
        // the type of an element read whose index may be out of range) has
        // √NaN = NaN, so the claim keeps a `nan` member, and the other values
        // are typed from the operand WITHOUT that member: √q for
        // `q: nan | real<0..>` is `nan | real`, not the top `number` the
        // non-finite arm below answered for it. That top type sent
        // `2√max(0, k)` — `k` an element read — through the complex square
        // root in the compiled program, and every later coordinate became a
        // complex object where the interpreter kept a real (Tycho item 332).
        // (`Abs` treats a NaN-admitting operand the same way, user decision
        // 2026-09-26.) A bare `number` also admits NaN, but has no member to
        // strip and keeps its own arm below.
        let nanArm = false;
        if (x.type !== 'nan' && isSubtype('nan', x.type)) {
          const present = withoutNaN(x.type);
          if (present !== x.type) {
            nanArm = true;
            x = { type: present, facts: x.facts, structureOf: x.structureOf };
          }
        }
        const result = (t: string) =>
          BoxedType.forResult(
            nanArm ? `${t} | nan` : t,
            context.engine._typeResolver
          );
        if (operandNonFiniteNumberOnTypes(x)) {
          // √(−∞) = i·∞ = ~oo (complex infinity), not a real ±∞ — and the
          // signed pair `+oo | -oo` excludes `~oo`, so only the top
          // type admits it (non-finite typing convention).
          const s = operandSgnOnTypes(x);
          if (negativeSign(s) === true) return result('number');
          if (nonNegativeSign(s) === true) return result('+oo | -oo');
          return result('number');
        }
        // Whether the operand's TYPE proves it finite.
        // A subtype test against `complex` is the engine's canonical
        // finiteness test:
        // every bare name under `number` denotes finite values alone, and
        // `complex` is the widest of them. It separates an operand whose type NAMES a non-finite
        // disjunct — the `real<0..> | +oo | -oo` that `Abs` claims
        // for a `number` operand — from one that is finite outright, and the
        // extended-real arm below needs that distinction: `√(+∞) = +∞`, so a
        // `finite_*` claim over a type that spells out `+oo | -oo`
        // would be a lie.
        const finiteOperand = factsOf(x.type).complex;
        if (isExtendedRealOperand(x)) {
          // √x of a provably non-negative real is real; otherwise the value
          // may be a finite pure-imaginary (`√−2 = 1.414…i`), so an
          // unknown-sign real must not claim `real` (same ruling as
          // the bounded inverse-trig heads, 2026-07-30). A finite operand
          // gives a finite result: `complex`, not `complex`. Where
          // finiteness is not proven the non-negative arm adds the signed
          // pair (`√(+∞) = +∞`) and the unknown-sign arm reaches the top
          // numeric type, because `√(−∞) = ~oo`, which only `number` admits.
          // The sign combines the value channel with the TYPE channel, so
          // a ranged operand type — `assume(a > 0)`, a literal's value
          // type, `x²`'s non-negative range — answers here too.
          //
          // An unknown sign INCLUDES a closed float radicand (`1 − 0.2²`):
          // machine floats are not folded at canonicalization, so its `sgn`
          // is undecided even though its value is knowable. This handler
          // deliberately does NOT numericize to find out — a type derivation
          // must not evaluate (the retired `closedRealSign` fold did, for
          // the sole benefit of the compile targets). The consumer that
          // needs the value's shape is the compiler, and it folds constants
          // itself before deciding lowerings (`constantFoldValue` /
          // `isComplexValued`'s Sqrt carve-out in
          // `compilation/base-compiler.ts`), so such a radicand now types
          // the `complex` hedge while its compiled bytes are
          // unchanged. See the §5.4 `Sqrt` row of
          // `docs/plans/2026-08-22-type-handlers-on-types.md`.
          // The sign is read from the value channel (`sgn`) AND from the
          // type's lower bound: the descriptor built above for a NaN-admitting
          // operand carries the original facts, whose sign is undecided
          // because NaN is unsigned, while its type (`real<0..>`) states the
          // bound outright.
          if (
            nonNegativeSign(operandSgnOnTypes(x)) === true ||
            provablyGreaterEqualOnTypes(x, 0)
          )
            return result(finiteOperand ? 'real' : 'real | +oo | -oo');
          return result(finiteOperand ? 'complex' : 'number');
        }
        // An operand that is not on the extended real line keeps the generic-
        // point convention the other numeric handlers use (`numericTypeHandler`,
        // `library/type-handlers.ts`): merely-possible non-finiteness does not
        // demote the claim, only a PROVABLE one does, and that was answered
        // above.
        return result('number');
      },
      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      // canonical: (ops, { engine: ce }) => {
      //   ops = flatten(ops);
      //   if (ops.length !== 1) return ce._fn('Sqrt', ops);
      //   return ops[0].sqrt();
      // },
      sgn: ([x]) => {
        if (x.isPositive) return 'positive';
        if (x.isNegative) return 'unsigned';
        if (x.isNonNegative) return 'non-negative';
        if (x.sgn === 'not-zero') return 'not-zero';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, engine, expression }) => {
        // Non-lazy: `x` is already evaluated by the driver.
        const nonNumeric = nonNumericOperandError(engine, [x]);
        if (nonNumeric !== undefined) return nonNumeric;
        const evalX = x;
        if (evalX.operator === 'Quantity') {
          const r = quantityPower(engine, evalX, engine.number(0.5));
          if (
            numericApproximation &&
            r &&
            isQuantity(r) &&
            isMeasurement(r.op1)
          )
            return r.N();
          return r;
        }

        if (isMeasurement(evalX)) {
          const r = measurementSqrt(engine, evalX);
          return numericApproximation ? r?.N() : r;
        }

        if (!numericApproximation) return sqrtOfSquareFactors(x) ?? x.sqrt();

        // An exact radicand outside the double range (`10^{-401}`) can have
        // a square root in the double range (`3.16e-201`).
        {
          const big = bigRealOf(
            exactValueOutOfDoubleRange(engine, operandOf(expression, 0), x)
          );
          if (big !== undefined) {
            const r = withDoubleDigits(() => big.abs().sqrt());
            if (!big.isNegative()) return boxBignumResult(engine, r);
            return engine.number(engine.complex(0, r.toNumber()));
          }
        }

        // An infinite radicand — a named infinity, or an "anonymous" one
        // with an infinite component (`∞ + i`) — has an exact value on the
        // numeric route too (`BoxedNumber.sqrt()`); the numeric-value
        // kernel below answers NaN for `~oo` and `∞ − ∞` for `∞ + i`.
        if (
          isNumber(x) &&
          (x.isInfinity === true || hasInfiniteComponent(x.numericValue))
        )
          return x.sqrt();

        const [c, rest] = x.toNumericValue();
        const cSqrt = engine.number(c.sqrt().N());
        if (rest.isSame(1)) return cSqrt;
        // √(c·rest) = √c · √rest. The square root must be applied to the
        // symbolic part too — returning `rest` un-rooted dropped the radical
        // (e.g. √(4y) → 2y instead of 2√y, and Sqrt(y).N() → y instead of √y).
        return cSqrt.mul(rest.sqrt());
      },
      // evalDomain: Square root of a prime is irrational
      // https://proofwiki.org/wiki/Square_Root_of_Prime_is_Irrational
    },

    Square: {
      description: 'Square of a number: x^2.',
      wikidata: 'Q3075175',
      complexity: 3100,
      broadcastable: true,
      // Deliberately NOT given a precise domain signature of its own, for
      // the same reason as `Exp` above: the `canonical` handler below
      // rewrites `Square(x)` to `Power(x, 2)`, so no well-formed unary
      // `Square` application survives to be validated or evaluated (only
      // an arity error keeps the head, which is why the `sgn` handler
      // below is effectively unreachable). `Power`'s BASE slot carrier —
      // `complex | infinity` with `nanBehavior: 'propagate'` — governs
      // every exceptional point: `Square(NaN)` propagates to `NaN`,
      // `Square(±∞) = +∞`, and `Square(~oo) = ~oo` (a positive power of
      // `~oo` is `~oo` in every direction of approach). A precise carrier
      // declared here would be a claim nothing consults.
      signature: '(number) -> number',
      examples: ['[Square(3), Square(x + 1)]'],
      sgn: ([x]) => {
        if (x.isSame(0)) return 'zero';
        if (x.isExtendedReal) {
          const s = x.sgn;
          return s === 'not-zero' || s === 'positive' || s === 'negative'
            ? 'positive'
            : 'non-negative';
        }
        // x² of a pure-imaginary x is real and negative: (βi)² = -β², with
        // β ≠ 0 since `imaginary` excludes 0. For any other finite,
        // PROVABLY non-real x (`isExtendedReal === false`; a bare `complex`
        // claim is a hedge that may hold 0 and decides nothing), x² is
        // nonzero but may be negative-real (x pure imaginary at runtime) or
        // non-real, so only `not-zero` is sound — `unsigned` would claim a
        // definite imaginary part.
        if (x.type.matches('imaginary')) return 'negative';
        if (x.isExtendedReal === false && x.isFinite === true)
          return 'not-zero';
        if (x.isNaN) return 'unsigned';
        return undefined;
      },
      // The canonical form is the one `makeNumericFunction` (`box.ts`) also
      // computes by name. See `numericCanonicalHandler`.
      canonical: numericCanonicalHandler('Square'),
    },

    Subtract: {
      description: 'Difference between two or more values.',
      wikidata: 'Q40754',
      complexity: 1350,
      broadcastable: true,
      // Numeric tuples subtract component-wise, never fanned into a List by
      // the generic broadcast machinery.
      broadcastExemptions: ['tuples'],
      // We accept from 1 to n arguments (see https://github.com/cortex-js/compute-engine/issues/171)
      // left-associative: a - b - c -> (a - b) - c
      signature: '(number+) -> number',
      examples: ['5 - 3 - x'],
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args);
        if (args.length === 0) return engine.error('missing');
        // Unary `Subtract(x)` folds to `x` through `canonicalAdd`, erasing
        // the operator before the arithmetic evaluate guard can examine the
        // operand — `checkNumericArgs` flags concrete literals but passes
        // symbols, so a symbol holding a string flowed through as-is. Reject
        // concrete non-numeric scalar evidence; a lone collection operand
        // still folds (broadcast identity), and a valueless symbol stays
        // admitted.
        if (args.length === 1 && heldNonNumericScalar(args[0]))
          return engine.typeError('number', args[0].type, args[0]);
        const first = args[0];
        const rest = args.slice(1);
        return canonicalAdd(engine, [first, ...rest.map((x) => x.neg())]);
      },
    },

    Truncate: {
      description: 'Rounds a number towards zero (removes the fractional part)',
      complexity: 1250,
      broadcastable: true,
      // Same domain-signature shape and rationale as `Ceil`/`Floor`
      // above.
      signature: '(real | signed_infinity) -> integer | signed_infinity',
      examples: ['[Truncate(2.7), Truncate(-2.7)]'],
      nanBehavior: 'propagate',
      partiality: 'total',
      type: ([x], context) =>
        BoxedType.forResult(
          roundingFunctionTypeOnTypes(x),
          context.engine._typeResolver
        ),
      // trunc(x) = 0 for |x| < 1, so the sign of x alone is not enough
      // (trunc(1/2) = 0, not positive). Mirror the Floor/Ceil interval logic.
      sgn: ([x]) => {
        const one = x.engine.One;
        const minusOne = x.engine.NegativeOne;
        if (isOrdered(x, '>=', one)) return 'positive';
        if (isOrdered(x, '<=', minusOne)) return 'negative';
        if (isOrdered(x, '>', minusOne) && isOrdered(x, '<', one))
          return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive) return 'non-positive';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, expression }) =>
        applyRounding(
          x,
          'trunc',
          Math.trunc,
          (x) => x.trunc(),
          numericApproximation,
          originalOperand(expression, 0)
        ),
    },
  },
  {
    //
    // Constants
    // Note: constants are put in a separate section because
    // some of the values (CatalanConstant) reference some function names
    // (Add...) that are defined above. This avoid circular references.
    //
    ImaginaryUnit: {
      description: 'The imaginary unit, whose square is −1.',
      examples: ['[ImaginaryUnit^2, Sqrt(-9)]'],
      type: 'imaginary',
      isConstant: true,
      holdUntil: 'never',
      wikidata: 'Q193796',
      value: (engine) => engine.I,
    },

    // Alias of 'ImaginaryUnit'
    i: {
      description: 'The imaginary unit, whose square is −1.',
      examples: ['[i^2, (1 + i)^2]'],
      type: 'imaginary',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.I,
    },

    ExponentialE: {
      description:
        "Euler's number e ≈ 2.71828, the base of the natural logarithm.",
      examples: ['[Ln(ExponentialE^2), N(ExponentialE)]'],
      keywords: ['euler number'],
      // The declared type brackets the value (the lower bound is the
      // machine double of e), so the TYPE channel alone proves e > 0 —
      // `e^x` claims its positive range and `e^i` stays admissible at a
      // `(complex)` parameter even where the value channel is not
      // consulted (ROADMAP "Ranged types should carry sign…").
      type: 'real<2.718281828459045..2.718281828459046>',
      wikidata: 'Q82435',
      isConstant: true,
      holdUntil: 'N',

      value: (engine) =>
        boxBignumResult(
          engine,
          bignumPreferred(engine) ? BigDecimal.ONE.exp() : Math.exp(1)
        ),
    },

    e: {
      description:
        "Euler's number e ≈ 2.71828, the base of the natural logarithm.",
      examples: ['[Ln(e^3), N(e)]'],
      // Same value bracket as `ExponentialE`: the alias's value is that
      // SYMBOL, whose static type carries the bracket, so the declaration
      // check accepts it — unlike `GoldenRatio`, whose value is an
      // unevaluated arithmetic expression with a bare static type.
      type: 'real<2.718281828459045..2.718281828459046>',
      isConstant: true,
      holdUntil: 'never',
      value: 'ExponentialE',
    },

    ComplexInfinity: {
      description:
        'Complex infinity, a single unsigned infinity in the complex plane.',
      examples: ['[1/0, ComplexInfinity + 1]'],
      // `number`, not `complex`: the non-finite typing convention
      // (ARCHITECTURE.md, "Non-finite typing convention for type handlers")
      // admits `~oo` and NaN at the top type only, which is how every derived
      // pole already types (`Gamma(-2)`, `Zeta(1)`, `(-1)!`, `sqrt(-oo)`).
      type: 'number',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.ComplexInfinity,
    },

    PositiveInfinity: {
      description: 'Positive infinity (+∞).',
      examples: ['[PositiveInfinity + 1, PositiveInfinity > 10^100]'],
      // The exact singleton, not the signed pair `+oo | -oo`: this
      // constant has one value, and its value's own type is that singleton,
      // so declaring the pair would make the declaration weaker than the
      // thing it declares.
      type: '+oo',
      isConstant: true,
      holdUntil: 'never',
      value: +Infinity,
    },

    NegativeInfinity: {
      description: 'Negative infinity (−∞).',
      examples: ['[NegativeInfinity - 1, NegativeInfinity < -10^100]'],
      // The exact singleton, for the same reason as `PositiveInfinity`.
      type: '-oo',
      isConstant: true,
      holdUntil: 'never',
      value: -Infinity,
    },

    NaN: {
      description:
        'Not a Number, the result of a floating-point operation that is undefined or unrepresentable, such as 0.0/0.0. An exact form with no value, such as 0/0, is Indeterminate.',
      examples: ['[NaN + 1, 0.0/0.0]'],
      type: 'number',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.NaN,
    },

    // The symbol spelling of the `Indeterminate` number literal. It has its
    // own definition, of the same shape as `NaN` above, because the value of
    // the `NaN` symbol is the `NaN` literal: the string `"Indeterminate"`
    // boxes to this symbol, whose value is `ce.Indeterminate`.
    Indeterminate: {
      description:
        'Indeterminate, the exact answer to an indeterminate form such as 0/0: a number with no value. Its numeric approximation is NaN.',
      examples: ['[0/0, Indeterminate + 1, N(0/0)]'],
      type: 'number',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.Indeterminate,
    },

    ContinuationPlaceholder: {
      description:
        'This symbol indicates that some elements in a collection have been omitted, for example in a long list of numbers, or in an infinite set',
      examples: ['[1, 2, ContinuationPlaceholder, 10]'],
      type: 'unknown',
      isConstant: true,
    },

    MachineEpsilon: {
      /**
       * The difference between 1 and the next larger floating point number
       *
       *    2^{−52}
       *
       * See https://en.wikipedia.org/wiki/Machine_epsilon
       */
      description:
        'The difference between 1 and the next larger floating point number (machine epsilon).',
      examples: ['N(MachineEpsilon)'],
      type: 'real',
      holdUntil: 'N',
      isConstant: true,
      value: { num: Number.EPSILON.toString() },
    },
    Half: {
      description: 'The rational number one half (1/2).',
      examples: ['[Half, Half + 1]'],
      // NOT value-bracketed like `EulerGamma`: `holdUntil: 'never'` means
      // every use substitutes the literal `1/2` at canonicalization, whose
      // own handler-visible type already carries the exact value — a
      // ranged declaration here would never be read.
      type: 'rational',
      isConstant: true,
      holdUntil: 'never',
      value: ['Rational', 1, 2],
    },
    GoldenRatio: {
      description: 'The golden ratio φ = (1+√5)/2 ≈ 1.618.',
      examples: ['N(GoldenRatio)'],
      // Value-bracket ranged type. The value is the EXPRESSION `(1+√5)/2`,
      // whose static type cannot witness the bracket — the declaration is
      // accepted because standard-library definitions are TRUSTED
      // (user-ruled 2026-08-23) and validated empirically under
      // `console.assert` instead (`trustedValueInhabitsDeclaredType`).
      // The decimal bounds strictly bracket φ = 1.61803398874989484….
      type: 'real<1.618033988749894..1.618033988749895>',
      wikidata: 'Q41690',
      isConstant: true,
      holdUntil: 'N',
      value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
    },
    CatalanConstant: {
      description: "Catalan's constant G ≈ 0.9160.",
      examples: ['N(CatalanConstant)'],
      // Value-bracket ranged type (G = 0.91596559417721901…); see
      // `GoldenRatio`.
      type: 'real<0.915965594177219..0.9159655941772191>',
      wikidata: 'Q855282',
      isConstant: true,
      holdUntil: 'N',
      value: {
        // From http://www.fullbooks.com/Miscellaneous-Mathematical-Constants1.html
        num: `0.91596559417721901505460351493238411077414937428167
                  21342664981196217630197762547694793565129261151062
                  48574422619196199579035898803325859059431594737481
                  15840699533202877331946051903872747816408786590902
                  47064841521630002287276409423882599577415088163974
                  70252482011560707644883807873370489900864775113225
                  99713434074854075532307685653357680958352602193823
                  23950800720680355761048235733942319149829836189977
                  06903640418086217941101917532743149978233976105512
                  24779530324875371878665828082360570225594194818097
                  53509711315712615804242723636439850017382875977976
                  53068370092980873887495610893659771940968726844441
                  66804621624339864838916280448281506273022742073884
                  31172218272190472255870531908685735423498539498309
                  91911596738846450861515249962423704374517773723517
                  75440708538464401321748392999947572446199754961975
                  87064007474870701490937678873045869979860644874974
                  64387206238513712392736304998503539223928787979063
                  36440323547845358519277777872709060830319943013323
                  16712476158709792455479119092126201854803963934243
                  `,
      },
    },
    EulerGamma: {
      description: 'The Euler–Mascheroni constant γ ≈ 0.5772.',
      examples: ['N(EulerGamma)'],
      keywords: ['euler-mascheroni', 'euler gamma'],
      // Value-bracket ranged type (γ = 0.57721566490153286…); see
      // `GoldenRatio`.
      type: 'real<0.5772156649015328..0.5772156649015329>',
      wikidata: 'Q273023',
      holdUntil: 'N',
      isConstant: true,
      // γ is computed on demand to the engine's working precision via the
      // Brent–McMillan algorithm (`BigDecimal.EULER_GAMMA`). The prior
      // hardcoded ~858-digit literal capped γ-dependent results at higher
      // precision (ROADMAP B12). Machine mode uses the double value.
      value: (engine) =>
        boxBignumResult(
          engine,
          bignumPreferred(engine)
            ? BigDecimal.EULER_GAMMA
            : 0.5772156649015328606
        ),
    },
  },

  {
    PreIncrement: {
      examples: ['PreIncrement(5)'],
      description: 'Increment a number by one.',
      signature: '(number) -> number',
      // The value `x + 1`, built with `ce.function` (the `.add()` method folds
      // exact literals to a float). It had no evaluate handler, so
      // `PreIncrement(5)` stayed unevaluated.
      evaluate: ([x], { engine: ce }) =>
        ce.function('Add', [x, ce.One]).evaluate(),
      // n + 1 stays in the operand's numeric kind (except `imaginary`, which
      // the handler widens to complex), so the result claims that kind.
      type: (ops, context) =>
        BoxedType.forResult(kindClosureType(ops), context.engine._typeResolver),
    },
    PreDecrement: {
      examples: ['PreDecrement(5)'],
      description: 'Decrement a number by one.',
      signature: '(number) -> number',
      // The value `x − 1`, built with `ce.function` (the `.add()` method folds
      // exact literals to a float). It had no evaluate handler, so
      // `PreDecrement(5)` stayed unevaluated.
      evaluate: ([x], { engine: ce }) =>
        ce.function('Subtract', [x, ce.One]).evaluate(),
      // n - 1 stays in the operand's numeric kind (except `imaginary`, which
      // the handler widens to complex), so the result claims that kind.
      type: (ops, context) =>
        BoxedType.forResult(kindClosureType(ops), context.engine._typeResolver),
    },
  },

  //
  // Property predicates
  //

  {
    IsPrime: {
      type: (ops, context) =>
        BoxedType.forResult(
          literalPredicateType(
            ops,
            (n) => Number.isInteger(n) && isPrimeNumber(n)
          ),
          context.engine._typeResolver
        ),
      description: '`IsPrime(n)` returns `True` if `n` is a prime number',
      wikidata: 'Q49008',
      complexity: 1200,
      broadcastable: true,
      // A membership predicate takes the WIDE numeric carrier and answers
      // `False` for a non-member: "is 3.5 prime?" is a well-formed question
      // whose answer is no, and a narrow `(integer)` carrier would turn that
      // answer into a type error (`docs/SIGNATURE-GUIDELINES.md` §3.3). `NaN`
      // rides in on that same carrier and is answered `False` by the handler
      // rather than propagated — what Contract B will express as
      // `nanBehavior: 'handle'` (`docs/ERROR-MODEL.md` §4).
      //
      // The infinities are the one part of `number` primality does not accept,
      // and the DECLARATION deliberately does not say so. A narrower spelling
      // (`complex | nan`) is a working carrier, but a declared parameter type
      // is also what an undeclared argument symbol is inferred FROM, so it
      // stamps the exclusion on the user's own symbol: `IsPrime(n)` declared
      // `n: complex | nan` — an implementation detail of this predicate
      // appearing in a name the program will use elsewhere. The carrier is
      // enforced in the handler instead, where it answers the same
      // `incompatible-type` error without touching inference.
      signature: '(number) -> boolean',
      examples: ['[IsPrime(17), IsPrime(21)]'],
      nanBehavior: 'handle',
      evaluate: ([n], { engine }) => {
        const outOfDomain = infiniteOperandOfIntegerPredicate(engine, n);
        if (outOfDomain !== undefined) return outOfDomain;
        const result = isPrime(n);
        if (result === undefined) return undefined;
        return engine.symbol(result ? 'True' : 'False');
      },
    },
    IsComposite: {
      type: (ops, context) =>
        BoxedType.forResult(
          literalPredicateType(
            ops,
            (n) => Number.isInteger(n) && n > 3 && !isPrimeNumber(n)
          ),
          context.engine._typeResolver
        ),
      description:
        '`IsComposite(n)` returns `True` if `n` is a composite number',
      complexity: 1200,
      broadcastable: true,
      // The same carrier as `IsPrime`, for the same reasons — see there.
      signature: '(number) -> boolean',
      examples: ['[IsComposite(21), IsComposite(7)]'],
      nanBehavior: 'handle',
      // A composite number is a positive integer greater than 1 that is not
      // prime, so `0`, `1`, the negative integers and every non-integer are
      // neither prime nor composite. Compositeness is therefore not the
      // negation of primality, and `Not(IsPrime(n))` is the wrong definition
      // for it. `isComposite` is the shared one, used by the `:composite`
      // pattern guard in `rules.ts` as well.
      evaluate: ([n], { engine }) => {
        const outOfDomain = infiniteOperandOfIntegerPredicate(engine, n);
        if (outOfDomain !== undefined) return outOfDomain;
        const result = isComposite(n);
        if (result === undefined) return undefined;
        return engine.symbol(result ? 'True' : 'False');
      },
    },

    IsOdd: {
      type: (ops, context) =>
        BoxedType.forResult(
          literalPredicateType(
            ops,
            (n) => Number.isInteger(n) && Math.abs(n % 2) === 1
          ),
          context.engine._typeResolver
        ),
      description: '`IsOdd(n)` returns `True` if `n` is an odd number',
      complexity: 1200,
      broadcastable: true,
      // The same arrangement as `IsPrime`: the wide carrier with the
      // infinities enforced by the handler, `NaN` handled (answered `False`,
      // as every non-integer is — "is 2.5 odd?" is a well-formed question
      // whose answer is no). See the `IsPrime` comment for why the exclusion
      // of the infinities is not written into the declaration.
      signature: '(number) -> boolean',
      examples: ['[IsOdd(7), IsOdd(8)]'],
      nanBehavior: 'handle',
      evaluate: ([n], { engine }) => parityPredicate(engine, n, 'odd'),
    },
    IsEven: {
      type: (ops, context) =>
        BoxedType.forResult(
          literalPredicateType(ops, (n) => Number.isInteger(n) && n % 2 === 0),
          context.engine._typeResolver
        ),
      description: '`IsEven(n)` returns `True` if `n` is an even number',
      complexity: 1200,
      broadcastable: true,
      // Its own head, NOT `Not(IsOdd(n))`: a non-integer is neither odd nor
      // even, so the negation answered `True` for `2.5`, `NaN` and `2 + 3i`
      // (and `IsEven(x)` printed as `¬IsOdd(x)`). Same carrier and NaN
      // policy as `IsOdd`.
      signature: '(number) -> boolean',
      examples: ['[IsEven(7), IsEven(8)]'],
      nanBehavior: 'handle',
      evaluate: ([n], { engine }) => parityPredicate(engine, n, 'even'),
    },
    // @todo: Divisor:
  },
  {
    GCD: {
      description: 'Greatest Common Divisor',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(any*) -> number',
      examples: ['[GCD(12, 18), GCD(12, 18, 27)]'],
      // Integer operands → a positive integer; polynomial operands → a
      // (monic) polynomial whose type and sign aren't known statically.
      type: (ops, context) =>
        BoxedType.forResult(
          ops.every((x) => factsOf(x.type).integer) ? 'integer' : 'number',
          context.engine._typeResolver
        ),
      // gcd ≥ 0, and positive iff some argument is nonzero (gcd(0,…,0) = 0).
      sgn: (ops) => {
        if (!ops.every((x) => x.isInteger)) return undefined;
        if (
          ops.some((x) => {
            const s = x.sgn;
            return s === 'positive' || s === 'negative' || s === 'not-zero';
          })
        )
          return 'positive';
        return 'non-negative';
      },
      evaluate: (xs, { engine }) => {
        // Integer operands take the fast numeric path. Otherwise, attempt a
        // univariate polynomial GCD (e.g. GCD(x²+3x+2, x²+4x+3) → x+1),
        // falling back to the numeric path — which folds any integer operands
        // and leaves the rest as an unevaluated GCD.
        if (!xs.every((x) => x.isInteger)) {
          const poly = polynomialGCDMulti(xs);
          if (poly !== undefined) return poly;
        }
        return evaluateGcdLcm(engine, xs, 'GCD');
      },
    },
    LCM: {
      description: 'Least Common Multiple',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      // Integer operands → a positive integer; non-integer real operands →
      // a (non-negative) real via the tolerant float LCM.
      signature: '(any*) -> number',
      examples: ['[LCM(4, 6), LCM(4, 6, 10)]'],
      type: (ops, context) =>
        BoxedType.forResult(
          ops.every((x) => factsOf(x.type).integer) ? 'integer' : 'number',
          context.engine._typeResolver
        ),
      // lcm ≥ 0; zero as soon as ANY argument is zero (lcm(0, n) = 0), and
      // positive only when every argument is provably nonzero.
      sgn: (ops) => {
        if (!ops.every((x) => x.isInteger)) return undefined;
        if (
          ops.every((x) => {
            const s = x.sgn;
            return s === 'positive' || s === 'negative' || s === 'not-zero';
          })
        )
          return 'positive';
        if (ops.some((x) => x.isSame(0))) return 'zero';
        return 'non-negative';
      },
      evaluate: (xs, { engine }) => evaluateGcdLcm(engine, xs, 'LCM'),
    },

    Numerator: {
      description: 'Numerator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      // A STRUCTURAL accessor, not a numeric function: it reads the
      // numerator of whatever it is given, a symbol included, and the
      // invariant `Numerator(v) / Denominator(v) = v` holds at every point
      // of `number`. A number that is not a quotient is its own numerator
      // over the denominator `1` — `NaN` and the infinities included
      // (`NumeratorDenominator(NaN)` is `(NaN, 1)`), which is why the
      // carrier stays the whole of `number` and `NaN` is HANDLED rather
      // than propagated (`Denominator(NaN)` is `1`, not `NaN`). Ruling
      // recorded in `docs/plans/2026-08-30-error-model-implementation.md`,
      // Phase F batch 10. The same holds for `Denominator` and
      // `NumeratorDenominator` below.
      signature: '(number) -> number | nothing',
      examples: ['[Numerator(3/4), Numerator(x / y)]'],
      nanBehavior: 'handle',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want Numerator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reducible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op1;
        return engine._fn('Numerator', canonical(engine, ops));
      },
      sgn: ([x]) => x.sgn,
      evaluate: (ops, { engine, numericApproximation }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op1.evaluate({ numericApproximation });
        // The operand is HELD (`lazy`), so it must be evaluated here before
        // its numerator is read: a symbol holding `1/2` has the numerator
        // `1`, not itself. Exactly, then numericized: the numerator of
        // `1/2` is `1` on both routes, while `0.5` has no numerator but
        // itself.
        const v = accessorOperand(ce, op);
        if (!v.isValid) return v;
        const result = v.numerator;
        return numericApproximation ? result.N() : result;
      },
    },

    Denominator: {
      description: 'Denominator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      // A structural accessor over the whole of `number`, `NaN` handled —
      // see `Numerator`.
      signature: '(number) -> number | nothing',
      examples: ['[Denominator(3/4), Denominator(x / y)]'],
      nanBehavior: 'handle',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want Denominator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reductible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op2;
        const num = asRational(op);
        if (num !== undefined) return engine.number(num[1]);
        return engine._fn('Denominator', canonical(engine, ops));
      },
      sgn: () => 'positive',
      evaluate: (ops, { engine, numericApproximation }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op2.evaluate({ numericApproximation });
        // The held operand is evaluated first — see `Numerator`.
        const v = accessorOperand(ce, op);
        if (!v.isValid) return v;
        const result = v.denominator;
        return numericApproximation ? result.N() : result;
      },
    },

    NumeratorDenominator: {
      description: 'Sequence of Numerator and Denominator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      // A structural accessor over the whole of `number`, `NaN` handled —
      // see `Numerator`.
      signature: '(number) -> tuple<number, number> | nothing',
      examples: ['NumeratorDenominator(3/4)'],
      nanBehavior: 'handle',
      canonical: (ops, { engine }) => {
        // **IMPORTANT**: We want NumeratorDenominator to work on non-canonical
        // expressions, so that you can determine if a user input is
        // reductible, for example.
        if (ops.length === 0) return engine.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return engine.tuple(...op.ops);
        // Canonicalization is value-blind (the same rule as `Denominator`
        // above): a rational LITERAL folds here, a symbol holding one does
        // not — its pair is read by `evaluate`, so the canonical form does
        // not depend on the symbol's current assignment.
        const num = asRational(op);
        if (num !== undefined)
          return engine.tuple(engine.number(num[0]), engine.number(num[1]));
        return engine._fn('NumeratorDenominator', canonical(engine, ops));
      },

      evaluate: (ops, { engine, numericApproximation }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return ce.tuple(
            op.op1.evaluate({ numericApproximation }),
            op.op2.evaluate({ numericApproximation })
          );

        // The held operand is evaluated first — see `Numerator`.
        const v = accessorOperand(ce, op);
        if (!v.isValid) return v;
        const [num, den] = v.numeratorDenominator;
        return numericApproximation
          ? ce.tuple(num.N(), den.N())
          : ce.tuple(num, den);
      },
    },
  },

  //
  // Arithmetic on collections: Min, Max, Sum, Product
  //
  {
    Max: {
      description: 'Maximum of two or more numbers',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(value*) -> number',
      examples: ['[Max(3, 7, 2), Max([3, 7, 2])]'],
      // A data-consuming aggregate: it OWNS its `Missing` runtime (§3.C). An
      // absent datum (a `Missing` operand or element, or a `NaN`) or empty
      // input evaluates to `NaN` (I6 absorption). `missingStrip: 'all'` (the
      // default) lets a `Missing` operand validate against `(value*)`.
      missingBehavior: 'handle',
      type: (ops, context) =>
        BoxedType.forResult(
          extremumTypeOnTypes(ops, 'max'),
          context.engine._typeResolver
        ),
      sgn: (ops) => {
        if (ops.some((x) => x.isExtendedReal == false || x.isNaN))
          return 'unsigned';
        if (ops.some((x) => x.isExtendedReal == false || x.isNaN !== false))
          return undefined;
        if (ops.some((x) => x.isPositive)) return 'positive';
        if (ops.every((x) => x.isNonPositive))
          return ops.some((x) => x.isSame(0)) ? 'zero' : 'non-positive';
        if (ops.some((x) => x.isNonNegative)) return 'non-negative';
        if (ops.every((x) => x.isNegative)) return 'negative';
        // The max of operands that are EACH provably nonzero is one of them,
        // hence nonzero. (Some-quantified this would be wrong: one nonzero
        // negative operand does not prevent the max from being 0.)
        if (
          ops.every((x) => {
            const s = x.sgn;
            return s === 'positive' || s === 'negative' || s === 'not-zero';
          })
        )
          return 'not-zero';
        return undefined;
      },
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Max'),
    },

    Min: {
      description: 'Minimum of two or more numbers',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections
      signature: '(value+) -> number',
      examples: ['[Min(3, 7, 2), Min([3, 7, 2])]'],
      missingBehavior: 'handle',
      type: (ops, context) =>
        BoxedType.forResult(
          extremumTypeOnTypes(ops, 'min'),
          context.engine._typeResolver
        ),
      sgn: (ops) => {
        if (ops.some((x) => x.isExtendedReal == false || x.isNaN))
          return 'unsigned';
        if (ops.some((x) => x.isExtendedReal == false || x.isNaN !== false))
          return undefined;
        if (ops.some((x) => x.isNegative)) return 'negative';
        if (ops.every((x) => x.isNonNegative))
          return ops.some((x) => x.isSame(0)) ? 'zero' : 'non-negative';
        if (ops.some((x) => x.isNonPositive)) return 'non-positive';
        if (ops.every((x) => x.isPositive)) return 'positive';
        return undefined;
      },
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Min'),
    },

    // Element-wise binary max/min (the NumPy `maximum`/`minimum` primitive).
    // Unlike `Max`/`Min` — which *reduce* all operands (including a
    // collection's elements) to a single scalar — these broadcast: a scalar and
    // a collection give a collection of the per-element extremum, two
    // collections zip, two scalars give a scalar.
    //
    // `ElementMax`, `ElementMin` and `Clamp` share one Contract B
    // declaration, because they are one piece of mathematics: an extremum
    // (and the `min(max(x, lo), hi)` clamp built from two of them) is
    // defined by the ORDER of the real line, which the complex numbers
    // lack — the criterion `docs/ERROR-MODEL.md` §4 gives for the
    // real-vs-complex choice. So the carrier is the EXTENDED real line in
    // every slot: `±∞` are ordinary values here (`max(+∞, 1) = +∞`,
    // `clamp(−∞, 0, 1) = 0`), while a non-real operand and `~oo` are
    // off-carrier — an `incompatible-type` error at BOXING, where they
    // used to leave the application inert forever. These heads have no
    // `canonical` handler and no fast path, so the boxing-time signature
    // validation is the seam, and the dispatch-time conformance re-test
    // refutes an off-carrier value that only arrives later (a symbol
    // assigned `i` after boxing). The order is total on the whole carrier,
    // `lo > hi` included (`Clamp(5, 1, 0) = 0`), so there is no domain
    // condition: `partiality: 'total'`. `NaN` propagates — declared
    // explicitly, since the extended carrier is not a subtype of `complex`
    // and the derived policy would be `reject` — and the framework's gate,
    // not `scalarExtremum`'s own NaN test, is what answers it now.
    ElementMax: {
      description:
        'Element-wise maximum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.',
      examples: ['ElementMax([1, 5, 3], [4, 2, 6])'],
      complexity: 1200,
      broadcastable: true,
      // See the shared note above the `ElementMax` entry for the carrier.
      signature:
        '(real | signed_infinity, (real | signed_infinity)+) -> real | signed_infinity',
      nanBehavior: 'propagate',
      partiality: 'total',
      type: (ops, context) =>
        BoxedType.forResult(
          extremumRangeTypeOnTypes('max', ops) ??
            elementExtremumTypeOnTypes(ops),
          context.engine._typeResolver
        ),
      evaluate: (ops, { numericApproximation }) =>
        foldExtremum(ops, true, numericApproximation === true),
    },

    ElementMin: {
      description:
        'Element-wise minimum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.',
      examples: ['ElementMin([1, 5, 3], [4, 2, 6])'],
      complexity: 1200,
      broadcastable: true,
      // See the shared note above the `ElementMax` entry for the carrier.
      signature:
        '(real | signed_infinity, (real | signed_infinity)+) -> real | signed_infinity',
      nanBehavior: 'propagate',
      partiality: 'total',
      type: (ops, context) =>
        BoxedType.forResult(
          extremumRangeTypeOnTypes('min', ops) ??
            elementExtremumTypeOnTypes(ops),
          context.engine._typeResolver
        ),
      evaluate: (ops, { numericApproximation }) =>
        foldExtremum(ops, false, numericApproximation === true),
    },

    Clamp: {
      description:
        'Clamp a value to the range [lo, hi] = min(max(x, lo), hi). Broadcasts over collection arguments.',
      examples: ['[Clamp(12, 0, 10), Clamp(-3, 0, 10), Clamp(5, 0, 10)]'],
      complexity: 1200,
      broadcastable: true,
      // See the shared note above the `ElementMax` entry for the carrier.
      signature:
        '(real | signed_infinity, real | signed_infinity, real | signed_infinity) -> real | signed_infinity',
      nanBehavior: 'propagate',
      partiality: 'total',
      type: (ops, context) =>
        BoxedType.forResult(
          extremumRangeTypeOnTypes('clamp', ops) ??
            elementExtremumTypeOnTypes(ops),
          context.engine._typeResolver
        ),
      evaluate: ([x, lo, hi], { numericApproximation }) => {
        // max(x, lo) then min(·, hi). Keep the intermediate exact; numericize
        // only the final result. Stays symbolic if any comparison is undecided.
        const lower = scalarExtremum(x, lo, true, false);
        if (lower === undefined) return undefined;
        return scalarExtremum(lower, hi, false, numericApproximation === true);
      },
    },

    Supremum: {
      description: 'Like Max, but defined for open sets',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections

      signature: '(value*) -> number',
      examples: ['[Supremum(1, 3, 2), Supremum(Interval(0, 1))]'],
      missingBehavior: 'handle',
      type: (ops, context) =>
        BoxedType.forResult(
          extremumTypeOnTypes(ops),
          context.engine._typeResolver
        ),
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Supremum'),
    },

    Infimum: {
      description: 'Like Min, but defined for open sets',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections

      signature: '(value*) -> number',
      examples: ['[Infimum(1, 3, 2), Infimum(Interval(0, 1))]'],
      missingBehavior: 'handle',
      type: (ops, context) =>
        BoxedType.forResult(
          extremumTypeOnTypes(ops),
          context.engine._typeResolver
        ),
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Infimum'),
    },

    Distance: {
      description:
        'Euclidean distance between two points, broadcasting over a list of points.',
      examples: ['[Distance((0, 0), (3, 4)), Distance([1, 2, 3], [4, 6, 3])]'],
      complexity: 6000,
      // The parameter admits a POINT (a `tuple`, or the flat `list<number>`
      // spelling a data import produces) and a LIST of points (`list<tuple>`,
      // or the `list<list<number>>` spelling — which types as `list<number>`
      // when the rows are equal-length, i.e. a matrix). Deliberately NOT
      // `value`/`any`: a scalar or a string must still be rejected at the call
      // boundary (Tycho items 130/138).
      signature:
        '(tuple | list<tuple> | list<number> | list<list<number>>, tuple | list<tuple> | list<number> | list<list<number>>) -> number',
      // An `At` access types `missing | tuple<…>` (the out-of-range arm);
      // strip-before-validate (§3.B) admits it, or `Distance(S[n], p)` errors
      // at canonicalization (Tycho item 164's sibling). The runtime marker is
      // answered by the §3.E gate of the evaluation driver for a bare absent
      // operand (since 2026-09-25 the gate stands aside beside a collection
      // operand for a broadcastable operator only, and `Distance` is not
      // one), and by `evaluate` below for the routes that reach it directly.
      missingBehavior: 'propagate',
      // A restricted point `P {c}`, or a restricted list of points, whose
      // condition is not decided moves out of the application:
      // `Distance((3, 4) {0 < t}, (0, 0))` is `5 {0 < t}`
      // (`threadsConditionals`, see `types-definitions.ts`).
      threadsConditionals: true,
      // A point-list operand broadcasts: one distance per point.
      type: ([a, b], context) => {
        const pa = a ? isPointListType(a.type) : false;
        const pb = b ? isPointListType(b.type) : false;
        if (pa === true || pb === true)
          return BoxedType.forResult(
            { kind: 'list', elements: 'number' },
            context.engine._typeResolver
          );
        // An operand that COULD be a list of points — an indexed collection
        // whose ELEMENT type is unknown, e.g. a base declared with the bare
        // `indexed_collection` type — must not be reported as the scalar: a
        // compile target that trusts a bare `number` here lowers
        // `Min(Distance(S, p))` to `Math.min(<array>)`, a silent `NaN` behind
        // `success: true` (Tycho item 143). Report the union instead, so the
        // consumer (and the lowering) sees that both shapes are possible.
        if (pa === undefined || pb === undefined)
          return BoxedType.forResult(
            'number | list<number>',
            context.engine._typeResolver
          );
        // Point-to-point: a distance is the norm of the difference, so it is
        // real whatever the coordinates are — and `number` (which admits
        // complex) is refused by every `real`-declared slot. Read off the
        // coordinates both literal points expose; a point-TYPED symbol has
        // none, and keeps the wide `number`.
        //
        // Every coordinate must be PROVEN finite for the norm claim to carry
        // over to a distance. `euclideanNormType` says `real | +oo` for
        // components on the extended real line, on the grounds that a norm
        // takes the modulus of each component and so can never be NaN. A
        // distance norms the DIFFERENCES instead, and `∞ − ∞` is NaN — which
        // `real | +oo` excludes — so an unproven coordinate demotes to the top
        // numeric type here where a plain `Norm` may still be sharp.
        const ca = a ? operandChildren(a) : undefined;
        const cb = b ? operandChildren(b) : undefined;
        if (ca !== undefined && cb !== undefined) {
          const coords = [...ca, ...cb];
          if (
            !coords.every(
              (c) => c.facts.finite === true || factsOf(c.type).complex
            )
          )
            return BoxedType.forResult('number', context.engine._typeResolver);
          return BoxedType.forResult(
            euclideanNormType(coords),
            context.engine._typeResolver
          );
        }
        return BoxedType.forResult('number', context.engine._typeResolver);
      },
      evaluate: ([a, b], { engine: ce, numericApproximation, expression }) => {
        // An absent point absorbs — substituted here because the §3.E gate
        // defers to the collection operand (see `missingBehavior` above).
        // The marker is the one of the codomain, read off the type of the
        // application (`absentScalarMarker`): `NaN` for the distance between
        // two points, a number (§3.C), and `Missing` for the distances of a
        // list of points, a list — the value of a restricted list of points
        // whose condition is false, as for `Dot` and `Norm`. Both symbols
        // that name an absent datum are read here (user ruling of
        // 2026-09-22); the same two names are tested by
        // `isAbsentScalarSymbol` (`boxed-expression/validate.ts`).
        if (isAbsentSymbol(a) || isAbsentSymbol(b))
          return absentScalarMarker(ce, expression);
        const pa = pointOperand(a);
        const pb = pointOperand(b);
        // Point-to-point: the scalar distance.
        if (pa && pb) return pointDistance(pa, pb, ce, numericApproximation);

        const la = pa ? undefined : pointListOperand(a);
        const lb = pb ? undefined : pointListOperand(b);
        // Neither a point nor a list of points (a list of scalars, a symbolic
        // operand, an oversized collection): reject as before.
        if (!(pa || la) || !(pb || lb)) return ce.error('incompatible-type');

        // Broadcast: a point against a list of points, or two lists of points
        // pairwise. Two lists must have the SAME length — the lifted-operator
        // convention (docs/BROADCAST-MODEL.md), no truncation to the shortest.
        if (la && lb && la.length !== lb.length)
          return ce.error('incompatible-dimensions');
        const n = (la ?? lb!).length;
        const results: Expression[] = [];
        for (let i = 0; i < n; i++) {
          const ca = la ? la[i] : pa!;
          const cb = lb ? lb[i] : pb!;
          // A cell that is not a point (`pointListOperand`): an absent point
          // has no distance, and the marker of a numeric cell is `NaN`; a
          // restricted point is applied `Distance` again, and the
          // conditional-value lift moves its condition to its distance.
          if (!Array.isArray(ca) || !Array.isArray(cb)) {
            // The other side of the pair is the point at position `i`: the
            // point operand itself, or the cell `i` of a list of points, not
            // the whole list (which would broadcast a second time and put a
            // list in cell `i`).
            const xa = Array.isArray(ca)
              ? la
                ? ce.function('Tuple', ca)
                : a
              : (ca as Expression);
            const xb = Array.isArray(cb)
              ? lb
                ? ce.function('Tuple', cb)
                : b
              : (cb as Expression);
            if (isAbsentSymbol(xa) || isAbsentSymbol(xb)) {
              results.push(ce.NaN);
              continue;
            }
            const d = ce
              .function('Distance', [xa, xb])
              .evaluate({ numericApproximation });
            if (isFunction(d, 'Error')) return d;
            results.push(d);
            continue;
          }
          const d = pointDistance(ca, cb, ce, numericApproximation);
          // A malformed point (a dimension mismatch, a non-numeric coordinate)
          // is the whole call's error, not one element of the result list. A
          // non-finite coordinate is not malformed and has an in-band value,
          // so it produces an ordinary element (`+oo` or NaN).
          if (isFunction(d, 'Error')) return d;
          results.push(d);
        }
        return ce.function('List', results);
      },
    },

    Product: {
      description:
        '`Product(f, a, b)` computes the product of `f` from `a` to `b`',
      wikidata: 'Q901718',
      complexity: 1000,
      broadcastable: false,

      // The index of each indexing-set operand (from operand 1) is this
      // operator's BOUND variable, declared in its own scope: `integer` for a
      // range-shaped clause (`Limits`, a bounds tuple, a bare symbol), and
      // the collection's element type for an `Element` clause
      // (`canonicalIndexingSet`, `library/utils.ts`).
      scoped: indexingSetSites(1, 'integer'),
      lazy: true,
      signature: '(any, tuple*) -> number',
      examples: ['Product(k, (k, 1, 5))', 'Product(1 - 1/k^2, (k, 2, 10))'],
      type: (ops, context) =>
        BoxedType.forResult(
          bigOpResultTypeOnTypes(ops, 'Product'),
          context.engine._typeResolver
        ),

      canonical: ([body, ...bounds], { scope, engine: ce }) =>
        // With no operand, `canonicalBigop` read the engine of an undefined
        // body and threw; the operand is reported missing, as for `Mean()`.
        body === undefined
          ? ce._fn('Product', [ce.error('missing')])
          : canonicalBigop('Product', body, bounds, scope),

      evaluate: (ops, options) => {
        const ce = options.engine;
        // One-operand form over an operand that can be absent as a whole
        // (`missing | list<…>`, a restricted list or a row read): as in
        // `Sum.evaluate`. The product of an absent collection is `NaN`; a
        // present collection is folded below.
        const resolved = withAbsentableOperandResolved(ops);
        if (resolved === undefined) return ce.NaN;
        ops = resolved;
        // EL-4 (revised): see the matching comment in `Sum.evaluate` — an
        // infinite domain stays symbolic under exact evaluate (`.N()` owns
        // the truncated numeric path); free bounds/body are never enumerable.
        const numeric = options.numericApproximation;
        const bounds = ops.slice(1);
        const mode = classifyBigopDomain(ops[0], bounds, ce);
        if (mode === 'absent') return ce.NaN;
        if (mode === 'symbolic') {
          if (bounds.length === 1) {
            // Degenerate bounds (`Π_{i=x}^{x}`): one term, no enumeration.
            const term = degenerateBigOpTerm(ops[0], bounds[0], numeric);
            // A capture-unsafe decline must NOT fall through: the closed forms
            // substitute the same way, without a capture guard.
            if (term === DEGENERATE_CAPTURE_UNSAFE) return undefined;
            if (term !== undefined) return term;
            return symbolicProductClosedForm(ops[0], bounds[0], ce);
          }
          return undefined;
        }
        if (mode === 'numeric' && !numeric) {
          if (bounds.length === 1)
            return infiniteProductClosedForm(ops[0], bounds[0], ce);
          return undefined;
        }
        if (mode === 'numeric' && numeric) {
          if (bounds.length === 1) {
            const accel = acceleratedInfiniteProduct(ops[0], bounds[0], ce);
            if (accel !== undefined) return accel;
          }
          // Acceleration could not establish convergence (divergent,
          // oscillating, sign-changing, or non-smoothly decaying factors) —
          // or the infinite domain is multi-index. The historical fallback
          // truncated at the iteration limit and returned the PARTIAL
          // product as if it were the value (`Π n, n=1..∞` answered a huge
          // finite integer). A truncation whose convergence is unestablished
          // is a silently wrong number, so stay unevaluated instead
          // (user-ruled 2026-08-14; the compile-time constant folder guards
          // against the same hazard in `BaseCompiler.containsUnboundedBigOp`).
          return undefined;
        }
        // A capture-unsafe term (`evaluateBigOpTerm` declined) must keep the
        // WHOLE operator symbolic: `fn` returning null stops the fold, but
        // the fold's `undefined` result would fall through to the `?? NaN`
        // below and report a wrong value, so the decline is carried out of
        // the closure by this flag instead.
        let captureUnsafe = false;
        const nonFinite = new NonFiniteTerm();
        // No fold of a whole list exists for a product, so the options that
        // `Sum` passes (the fold, and with it the numeric-route evaluation of
        // a body with no indexing set) are not passed here: the body is
        // evaluated exactly and the factors are numericized one by one.
        const result = run(
          reduceBigOp(
            ops[0],
            bounds,
            (acc: Expression, x, bindings) => {
              const xe = evaluateBigOpTerm(x, bindings, numeric);
              if (xe === undefined) {
                captureUnsafe = true;
                return null;
              }
              if (numeric)
                noteNonFiniteTerm(nonFinite, options.expression, xe, () =>
                  evaluateBigOpTerm(x, bindings, false)
                );
              return productAccumulate(acc, xe, numeric);
            },
            ce.One
          ),
          ce._timeRemaining,
          ce._deadlineFrame
        );
        if (captureUnsafe) return undefined;
        // If domain is non-enumerable, keep expression unevaluated (symbolic)
        if (result === NON_ENUMERABLE_DOMAIN) {
          return undefined; // Return undefined to keep expression symbolic
        }
        // Bounds we cannot walk: surface an error rather than truncate.
        if (result === NON_ENUMERABLE_BOUNDS)
          return bigOpBoundsError(ce, bounds);
        // Evaluate the accumulated result to combine numeric factors
        const product = result?.evaluate({ numericApproximation: numeric });
        if (product === undefined) return ce.NaN;
        // A factor above the largest double is ±∞ at machine precision, and
        // `∞ · 0` is NaN. The float of the exact product is used then.
        if (!numeric) return product;
        return numericOfFold(ce, options.expression, product, nonFinite);
      },

      evaluateAsync: async (ops, options) => {
        const ce = options.engine;
        // As in the synchronous handler: a one-operand form over an operand
        // that can be absent as a whole.
        const resolved = withAbsentableOperandResolved(ops);
        if (resolved === undefined) return ce.NaN;
        ops = resolved;
        const numeric = options.numericApproximation;
        const bounds = ops.slice(1);
        // A body holding an asynchronous-only application is evaluated per
        // term with `evaluateBigOpTermAsync`, whose promise the fold yields
        // to `runAsync`; the synchronous term evaluation cannot run such a
        // handler and would keep the application unevaluated in every term.
        // The degenerate one-term case awaits its term the same way; the
        // closed forms and the accelerated infinite product evaluate terms
        // synchronously, so for such a body they are declined.
        const asyncTerms = hasAsyncOnlyApplication(ops[0]);
        {
          const mode = classifyBigopDomain(ops[0], bounds, ce);
          if (mode === 'absent') return ce.NaN;
          if (mode === 'symbolic') {
            if (bounds.length === 1) {
              // Degenerate bounds (`Π_{i=x}^{x}`): one term, no enumeration.
              const term = degenerateBigOpTerm(ops[0], bounds[0], numeric);
              // A capture-unsafe decline must NOT fall through: the closed
              // forms substitute the same way, without a capture guard.
              if (term === DEGENERATE_CAPTURE_UNSAFE) return undefined;
              if (term !== undefined)
                return asyncTerms
                  ? term.evaluateAsync({
                      numericApproximation: numeric,
                      signal: options.signal,
                      _effects: options.effects,
                    })
                  : term;
              if (asyncTerms) return undefined;
              return symbolicProductClosedForm(ops[0], bounds[0], ce);
            }
            return undefined;
          }
          if (mode === 'numeric' && asyncTerms) return undefined;
          if (mode === 'numeric' && !numeric) {
            if (bounds.length === 1)
              return infiniteProductClosedForm(ops[0], bounds[0], ce);
            return undefined;
          }
          if (mode === 'numeric' && numeric) {
            if (bounds.length === 1) {
              const accel = acceleratedInfiniteProduct(ops[0], bounds[0], ce);
              if (accel !== undefined) return accel;
            }
            // Unestablished convergence stays unevaluated — see the matching
            // comment in the sync `evaluate` handler above.
            return undefined;
          }
        }
        // Capture-unsafe decline flag — see the Product sync handler.
        let captureUnsafe = false;
        // The first factor that is not finite: see the sync handler. The
        // factors of an asynchronous-only application are not recorded. A
        // recorded factor whose exact value is infinite decides the result
        // whatever the other factors are, so the exact evaluation is skipped
        // only when such a factor exists and the result is not NaN.
        const nonFinite = new NonFiniteTerm();
        const accumulate = (
          acc: Expression,
          xe: Expression | undefined
        ): Expression | null => {
          if (xe === undefined) {
            captureUnsafe = true;
            return null;
          }
          return productAccumulate(acc, xe, numeric);
        };
        const numericTerm = (
          x: Expression,
          bindings: Parameters<typeof evaluateBigOpTerm>[1]
        ): Expression | undefined => {
          const xe = evaluateBigOpTerm(x, bindings, numeric);
          if (numeric)
            noteNonFiniteTerm(nonFinite, options.expression, xe, () =>
              evaluateBigOpTerm(x, bindings, false)
            );
          return xe;
        };
        const result = await runAsync(
          // The terms are evaluated synchronously, and `runAsync`
          // suspends this handler between time slices: every step must run
          // with the host capability registry this evaluation captured.
          withEvaluationEffects(
            ce,
            options.effects,
            reduceBigOp(
              ops[0],
              bounds,
              (acc: Expression, x, bindings) =>
                asyncTerms
                  ? evaluateBigOpTermAsync(
                      x,
                      bindings,
                      numeric,
                      options.signal,
                      options.effects
                    ).then((xe) => accumulate(acc, xe))
                  : accumulate(acc, numericTerm(x, bindings)),
              ce.One
            )
          ),
          ce._timeRemaining,
          options.signal,
          ce._deadlineFrame
        );
        if (captureUnsafe) return undefined;
        // If domain is non-enumerable, keep expression unevaluated (symbolic)
        if (result === NON_ENUMERABLE_DOMAIN) {
          return undefined; // Return undefined to keep expression symbolic
        }
        if (result === NON_ENUMERABLE_BOUNDS)
          return bigOpBoundsError(ce, bounds);
        const product = result?.evaluate({ numericApproximation: numeric });
        if (product === undefined) return ce.NaN;
        // The same recovery as the sync handler, with an asynchronous exact
        // evaluation.
        if (!numeric) return product;
        return numericOfFoldAsync(ce, options.expression, product, nonFinite, {
          signal: options.signal,
          _effects: options.effects,
        });
      },
    },

    Sum: {
      description:
        '`Sum(f, [a, b])` computes the sum of `f` from `a` to `b`; `Sum(L)` sums the elements of a collection `L`',
      keywords: ['summation', 'sigma'],
      wikidata: 'Q218005',
      complexity: 1000,
      broadcastable: false,

      // The index of each indexing-set operand (from operand 1) is this
      // operator's BOUND variable, declared in its own scope: `integer` for a
      // range-shaped clause (`Limits`, a bounds tuple, a bare symbol), and
      // the collection's element type for an `Element` clause
      // (`canonicalIndexingSet`, `library/utils.ts`).
      scoped: indexingSetSites(1, 'integer'),
      lazy: true,
      signature: '(any, tuple*) -> number',
      examples: ['Sum(k^2, (k, 1, 10))', 'Sum(1/k^2, (k, 1, oo))'],
      type: (ops, context) =>
        BoxedType.forResult(
          bigOpResultTypeOnTypes(ops, 'Sum'),
          context.engine._typeResolver
        ),

      canonical: ([body, ...bounds], { scope, engine: ce }) => {
        // Arity-1 collection-reducer form: bypass canonicalBigop, which would
        // rewrite Sum(L) as Reduce(L, 'Add', 0). Keeping the `Sum` head lets
        // dot-notation serialization (`L.total`) round-trip.
        // With no operand, `canonicalBigop` read the engine of an undefined
        // body and threw; the operand is reported missing, as for `Mean()`.
        if (body === undefined) return ce._fn('Sum', [ce.error('missing')]);
        if (bounds.length === 0) {
          const canon = body.canonical;
          if (canon.isCollection) return ce._fn('Sum', [canon]);
        }
        return canonicalBigop('Sum', body, bounds, scope);
      },

      evaluate: (
        [first, ...rest],
        { engine, numericApproximation, expression }
      ) => {
        // Arity-1 form over an operand that can be absent as a whole (typed
        // `missing | list<…>`: a lazy view over a row read of a list of
        // lists, `Sum(Map(f, At(x, 1)))`, or over a restricted list). `Sum`
        // holds its operand, and such a view is not finite before its source
        // is evaluated, so the sum stayed unevaluated. The operand is
        // evaluated here (`withAbsentableOperandResolved`): the sum of an
        // absent collection is `NaN`, as `Sum(Missing)` is, and a present
        // collection is summed below.
        const resolved = withAbsentableOperandResolved([first, ...rest]);
        if (resolved === undefined) return engine.NaN;
        first = resolved[0];
        // Arity-1 collection-reducer form: Sum(L).
        if (rest.length === 0 && first?.isCollection) {
          // Non-finite collections stay symbolic — infinite iteration would
          // hang the thread and bypass `engine._timeRemaining`. A finite
          // collection whose iterator declines (symbolic elements) would
          // silently fold to 0 — stay symbolic too.
          if (first.isFiniteCollection !== true) return undefined;
          // A `List` of machine numbers is summed on its doubles: see
          // `machineSum`.
          const summed = machineSum(first);
          if (typeof summed === 'number' || Array.isArray(summed))
            return boxMachineTotal(engine, summed);
          // The operand `machineSum` evaluated is walked below in place of
          // `first`, so that it is not evaluated a second time.
          const source = summed ?? first;
          // The decline is read off the fold's OWN walk (below) rather than
          // probed first: probing starts a second enumeration, which re-runs
          // the element callback of a lazy `Map`/`Filter` once more than there
          // are elements.
          let walked = 0;
          const nonFinite = new NonFiniteTerm();
          const result = run(
            reduceCollection(source, new SumTerms(), (acc, x) => {
              walked += 1;
              const term = x.evaluate({ numericApproximation });
              if (numericApproximation)
                noteNonFiniteTerm(nonFinite, expression, term, () =>
                  x.evaluate()
                );
              return addSumTerm(acc, term, numericApproximation);
            }),
            engine._timeRemaining,
            engine._deadlineFrame
          );
          if (enumerationDeclinedAfterWalk(first, walked)) return undefined;
          if (result === undefined) return engine.NaN;
          const sum = finishSum(engine, result, numericApproximation);
          if (!numericApproximation) return sum;
          return numericOfFold(engine, expression, sum, nonFinite);
        }

        // Big-op form: Sum(body, [i, a, b], …).
        // EL-4 (revised): an infinite (capped) domain is only a truncated
        // approximation — it has no exact value, so exact `evaluate()` stays
        // symbolic and `.N()` owns the numeric path. Free (symbolic) bounds
        // or a body with free variables beyond the index are never
        // enumerable, under either mode.
        const numeric = numericApproximation;
        const mode = classifyBigopDomain(first, rest, engine);
        if (mode === 'absent') return engine.NaN;
        if (mode === 'symbolic') {
          if (rest.length === 1) {
            // Degenerate bounds (`Σ_{i=x}^{x}`): one term, no enumeration.
            const term = degenerateBigOpTerm(first, rest[0], numeric);
            // A capture-unsafe decline must NOT fall through: the closed forms
            // substitute the same way, without a capture guard.
            if (term === DEGENERATE_CAPTURE_UNSAFE) return undefined;
            if (term !== undefined) return term;
            return symbolicSumClosedForm(first, rest[0], engine);
          }
          return undefined;
        }
        if (mode === 'numeric' && !numeric) {
          if (rest.length === 1)
            return infiniteSumClosedForm(first, rest[0], engine);
          return undefined;
        }
        // Infinite domain under `.N()`: accelerate with Richardson
        // extrapolation, which also serves as the convergence check.
        if (mode === 'numeric' && numeric) {
          if (rest.length === 1) {
            const accel = acceleratedInfiniteSum(first, rest[0], engine);
            if (accel !== undefined) return accel;
          }
          // Acceleration could not establish convergence (divergent,
          // oscillating, or non-smoothly decaying series) — or the infinite
          // domain is multi-index. The historical fallback truncated at the
          // iteration limit and returned the PARTIAL sum as if it were the
          // value (`Σ i, i=1..∞` answered 50015001, the 10001-term prefix).
          // A truncation whose convergence is unestablished is a silently
          // wrong number, so stay unevaluated instead (user-ruled
          // 2026-08-14; the compile-time constant folder guards against the
          // same hazard in `BaseCompiler.containsUnboundedBigOp`).
          return undefined;
        }
        // Capture-unsafe decline flag — see the Product sync handler.
        let captureUnsafe = false;
        const nonFinite = new NonFiniteTerm();
        const result = run(
          reduceBigOp(
            first,
            rest,
            (acc: SumTerms, x, bindings) => {
              const term = evaluateBigOpTerm(x, bindings, numeric);
              if (term === undefined) {
                captureUnsafe = true;
                return null;
              }
              if (numeric)
                noteNonFiniteTerm(nonFinite, expression, term, () =>
                  evaluateBigOpTerm(x, bindings, false)
                );
              return addSumTerm(acc, term, numeric);
            },
            new SumTerms(),
            {
              // A body that evaluates to a list of machine numbers
              // (`Sum(PointX(C))`) is summed on its doubles: `machineSum`.
              foldValue: (collection) => {
                const total = machineListTotal(collection);
                return total === undefined
                  ? undefined
                  : sumOf(boxMachineTotal(engine, total));
              },
              numericApproximation: numeric,
            }
          ),
          engine._timeRemaining,
          engine._deadlineFrame
        );
        if (captureUnsafe) return undefined;
        // Non-enumerable domain: keep the expression symbolic.
        if (result === NON_ENUMERABLE_DOMAIN) return undefined;
        // Bounds we cannot walk: surface an error rather than truncate.
        if (result === NON_ENUMERABLE_BOUNDS)
          return bigOpBoundsError(engine, rest);
        if (result === undefined || result === null) return engine.NaN;
        // Evaluate to combine numeric terms (e.g., 3x + 1 + 2 + 3 → 3x + 6).
        const sum = finishSum(engine, result, numeric);
        if (!numeric) return sum;
        return numericOfFold(engine, expression, sum, nonFinite);
      },

      evaluateAsync: async (
        [first, ...rest],
        { engine, signal, numericApproximation, effects, expression }
      ) => {
        // Arity-1 form over an operand that can be absent as a whole: as in
        // the synchronous handler.
        const resolved = withAbsentableOperandResolved([first, ...rest]);
        if (resolved === undefined) return engine.NaN;
        first = resolved[0];
        // Arity-1 collection-reducer form: Sum(L). A literal collection
        // whose elements hold an asynchronous-only application is evaluated
        // first, which awaits them (`List` evaluates its elements); the
        // synchronous per-element evaluation below cannot.
        if (rest.length === 0 && first?.isCollection) {
          const asyncOnly = hasAsyncOnlyApplication(first);
          if (asyncOnly)
            first = await first.evaluateAsync({
              numericApproximation,
              signal,
              _effects: effects,
            });
          if (first.isFiniteCollection !== true) return undefined;
          // Decline read off the fold's own walk — see the sync handler.
          let walked = 0;
          const nonFinite = new NonFiniteTerm();
          const result = await runAsync(
            // The elements are evaluated synchronously, and `runAsync`
            // suspends this handler between time slices: every step must run
            // with the host capability registry this evaluation captured.
            withEvaluationEffects(
              engine,
              effects,
              reduceCollection(first, new SumTerms(), (acc, x) => {
                walked += 1;
                const term = x.evaluate({ numericApproximation });
                if (numericApproximation)
                  noteNonFiniteTerm(nonFinite, expression, term, () =>
                    x.evaluate()
                  );
                return addSumTerm(acc, term, numericApproximation);
              })
            ),
            engine._timeRemaining,
            signal,
            engine._deadlineFrame
          );
          if (enumerationDeclinedAfterWalk(first, walked)) return undefined;
          if (result === undefined) return engine.NaN;
          const sum = finishSum(engine, result, numericApproximation);
          // The same recovery as the synchronous handler, with an
          // asynchronous exact evaluation.
          if (!numericApproximation) return sum;
          return numericOfFoldAsync(engine, expression, sum, nonFinite, {
            signal,
            _effects: effects,
          });
        }

        const numeric = numericApproximation;
        // Per-term asynchronous evaluation for a body holding an
        // asynchronous-only application — see the `Product` handler.
        const asyncTerms = hasAsyncOnlyApplication(first);
        {
          const mode = classifyBigopDomain(first, rest, engine);
          if (mode === 'absent') return engine.NaN;
          if (mode === 'symbolic') {
            if (rest.length === 1) {
              // Degenerate bounds (`Σ_{i=x}^{x}`): one term, no enumeration.
              const term = degenerateBigOpTerm(first, rest[0], numeric);
              // A capture-unsafe decline must NOT fall through: the closed
              // forms substitute the same way, without a capture guard.
              if (term === DEGENERATE_CAPTURE_UNSAFE) return undefined;
              if (term !== undefined)
                return asyncTerms
                  ? term.evaluateAsync({
                      numericApproximation: numeric,
                      signal,
                      _effects: effects,
                    })
                  : term;
              if (asyncTerms) return undefined;
              return symbolicSumClosedForm(first, rest[0], engine);
            }
            return undefined;
          }
          if (mode === 'numeric' && asyncTerms) return undefined;
          if (mode === 'numeric' && !numeric) {
            if (rest.length === 1)
              return infiniteSumClosedForm(first, rest[0], engine);
            return undefined;
          }
          if (mode === 'numeric' && numeric) {
            if (rest.length === 1) {
              const accel = acceleratedInfiniteSum(first, rest[0], engine);
              if (accel !== undefined) return accel;
            }
            // Unestablished convergence stays unevaluated — see the matching
            // comment in the sync `evaluate` handler above.
            return undefined;
          }
        }
        // Capture-unsafe decline flag — see the Product sync handler.
        let captureUnsafe = false;
        // The first term that is not finite: see the `Product` handler.
        const nonFinite = new NonFiniteTerm();
        const accumulate = (
          acc: SumTerms,
          term: Expression | undefined
        ): SumTerms | null => {
          if (term === undefined) {
            captureUnsafe = true;
            return null;
          }
          return addSumTerm(acc, term, numeric);
        };
        const numericTerm = (
          x: Expression,
          bindings: Parameters<typeof evaluateBigOpTerm>[1]
        ): Expression | undefined => {
          const term = evaluateBigOpTerm(x, bindings, numeric);
          if (numeric)
            noteNonFiniteTerm(nonFinite, expression, term, () =>
              evaluateBigOpTerm(x, bindings, false)
            );
          return term;
        };
        const result = await runAsync(
          // The terms are evaluated synchronously, and `runAsync`
          // suspends this handler between time slices: every step must run
          // with the host capability registry this evaluation captured.
          withEvaluationEffects(
            engine,
            effects,
            reduceBigOp(
              first,
              rest,
              (acc: SumTerms, x, bindings) =>
                asyncTerms
                  ? evaluateBigOpTermAsync(
                      x,
                      bindings,
                      numeric,
                      signal,
                      effects
                    ).then((term) => accumulate(acc, term))
                  : accumulate(acc, numericTerm(x, bindings)),
              new SumTerms(),
              {
                // The same fold as the synchronous handler, so that both
                // answer the same value for a body that is a list of machine
                // numbers.
                foldValue: (collection) => {
                  const total = machineListTotal(collection);
                  return total === undefined
                    ? undefined
                    : sumOf(boxMachineTotal(engine, total));
                },
                numericApproximation: numeric,
              }
            )
          ),
          engine._timeRemaining,
          signal,
          engine._deadlineFrame
        );
        if (captureUnsafe) return undefined;
        if (result === NON_ENUMERABLE_DOMAIN) return undefined;
        if (result === NON_ENUMERABLE_BOUNDS)
          return bigOpBoundsError(engine, rest);
        if (result === undefined || result === null) return engine.NaN;
        const sum = finishSum(engine, result, numeric);
        // The same recovery as the synchronous handler, with an asynchronous
        // exact evaluation.
        if (!numeric) return sum;
        return numericOfFoldAsync(engine, expression, sum, nonFinite, {
          signal,
          _effects: effects,
        });
      },
    },

    Interpret: {
      examples: ['Interpret(1 + 2 + ContinuationPlaceholder + n)'],
      description:
        'Interpret a notational expression as its mathematical meaning. In v1: a continuation-bearing `Add`/`Multiply` (e.g. `1 + 2 + \\dots + n`) becomes a `Sum`/`Product`. Returns the argument unchanged when the (strict) inference gate does not pass',
      complexity: 9000,
      broadcastable: false,

      // The argument is an inert notational object; keep it unevaluated so the
      // recognizer sees the original operand order and structure.
      lazy: true,
      signature: '(any) -> any',

      evaluate: ([arg], { engine: ce }) => {
        if (!arg) return undefined;
        // Epsil (and any left-associative parse) builds `1 + 2 + … + n` as a
        // nested `Add(Add(Add(1, 2), …), n)`; the recognizer reads one flat
        // `Add` in written order. Flatten same-head chains without folding or
        // reordering (a full canonicalization would fold `1 + 2` to `3`).
        const flat = flattenSameHeadChain(arg.json);
        const operand = flat === arg.json ? arg : ce.box(flat, { form: 'raw' });
        return inferContinuationPattern(operand) ?? arg;
      },
    },
  },
];

// Record, for each arithmetic operator with a `numericCanonicalHandler`, the
// fields of its library definition that its canonical form depends on
// (signature, `lazy` and the `associative`/`commutative`/`idempotent`/
// `involution` flags). A redeclaration keeps the handler only when it has the
// same name and the same values for these fields
// (`numeric-canonical-registry.ts`).
for (const table of ARITHMETIC_LIBRARY)
  recordNumericCanonicalDefinitions(table);

/**
 * `json` with its LEFT-nested chain of the same `Add` or `Multiply` head
 * spliced into one node, in written order: `Add(Add(Add(1, 2), c), n)` is
 * `Add(1, 2, c, n)`. A left-associative parse nests only through the first
 * operand, so only that operand is followed: a same-head operand elsewhere
 * is a term the author wrote (the `2n` anchor of `2 · 4 · … · 2n` is the
 * operand `Multiply(2, n)`) and is kept whole. Returns `json` itself when
 * nothing was spliced.
 */
function flattenSameHeadChain(json: MathJsonExpression): MathJsonExpression {
  if (!Array.isArray(json)) return json;
  const [head, first, ...rest] = json as [
    string,
    MathJsonExpression,
    ...MathJsonExpression[],
  ];
  if (head !== 'Add' && head !== 'Multiply') return json;
  if (!Array.isArray(first) || first[0] !== head) return json;
  const inner = flattenSameHeadChain(first) as unknown as MathJsonExpression[];
  return [head, ...inner.slice(1), ...rest] as MathJsonExpression;
}

/**
 * Exact Beta reduction when one argument is a positive integer `m`:
 *   B(a, m) = (m−1)! / (a (a+1) … (a+m−1))
 * This is an exact rational function of `a`, valid at every `a`. It returns
 * `ComplexInfinity` at a Γ-pole (a factor of the denominator is exactly 0,
 * i.e. `a ∈ {0, −1, …, −(m−1)}`), the exact rational otherwise, or `undefined`
 * when `m` is too large to expand exactly (the numeric kernel handles those).
 */
function betaPositiveIntegerArg(
  ce: ComputeEngine,
  a: Expression,
  m: number
): Expression | undefined {
  if (m > 100) return undefined;

  // Build the product with `ce.function(...)`, NOT the `.add()`/`.mul()`
  // methods: those fold two exact literals to a machine float, so an exact
  // irrational argument lost its exactness on the very first factor
  // (`B(√2, 2)`: `√2 + 1` → 2.41421356…) and the whole result numericized, in
  // violation of the evaluate/N contract. Integer and rational arguments were
  // unaffected — they fold exactly — which is why only the irrational case
  // showed it. See CLAUDE.md, "`.add()`/`.mul()` methods fold exact literals
  // to floats".
  const factors: Expression[] = [];
  for (let k = 0; k < m; k++) {
    const factor = k === 0 ? a : ce.function('Add', [a, ce.number(k)]);
    // A vanishing factor is a Γ-pole (`B(−1, 2)`). Integer arithmetic still
    // folds exactly through `ce.function`, so this stays detectable.
    if (factor.isSame(0)) return ce.ComplexInfinity;
    factors.push(factor);
  }
  const denom =
    factors.length === 1 ? factors[0] : ce.function('Multiply', factors);

  let numer = 1n;
  for (let k = 2; k < m; k++) numer *= BigInt(k);
  const result = ce.function('Divide', [ce.number(numer), denom]);

  // The other half of the evaluate/N contract: an INEXACT argument must still
  // numericize. That used to come free from `.mul()` folding the floats; with
  // the structural construction above, `B(2.5, 2)` would otherwise return the
  // unevaluated `1 / (2.5 * (1 + 2.5))`.
  if (isNumber(a) && a.isExact === false) return result.N();
  return result;
}

/**
 * Guard for `Sum`/`Product` accumulation over a collection: an already-failed
 * accumulator propagates, and a non-numeric (string) element is rejected with
 * an `incompatible-type` error rather than silently poisoning the result
 * (`Sum([a, b])` used to fold to `NaN`). Returns the error to short-circuit
 * with, or `undefined` to accumulate normally. Keeps `Sum` and `Product`
 * consistent (both surface the same typed error on a string element).
 */
function reducerElementError(
  acc: Expression,
  term: Expression
): Expression | undefined {
  if (acc.operator === 'Error') return acc;
  // Text elements — a string, or a CHARACTER (which is what walking a string
  // source now yields) — get a typed error rather than silently folding to
  // `NaN`. Both kinds are covered so `Sum`/`Product` surface the same
  // diagnostic whichever text shape reaches the fold.
  if (isString(term) || isCharacter(term))
    return acc.engine.typeError('number', term.type);
  return undefined;
}

/**
 * Accumulate one factor of a `Product` without EXPANDING it.
 *
 * The `.mul()` **method** distributes over sums: `k·(a+b)` becomes `ka+kb`.
 * Folding a product of sums with it therefore multiplies the term count at
 * every step, so `∏_{k=1..8}(kn-1)` came back as a nine-term polynomial
 * (`40320n^8 - 109584n^7 + …`) rather than as the eight compact factors, and a
 * product of such products grows superlinearly in the number of factors.
 *
 * Expansion is not what `evaluate()` promises. Its contract is the most EXACT
 * form, and an unexpanded product of linear factors is exactly as exact as the
 * polynomial while being dramatically smaller; opening it is `expand()`'s job,
 * and `Expand` still recovers the polynomial verbatim. So when either side is a
 * sum, the factors are joined with a canonical `Multiply` — which does not
 * distribute — instead of with `.mul()`.
 *
 * This guard is still needed even though `Multiply`'s evaluate handler no
 * longer expands (it uses `mulFactored`): the `.mul()` METHOD is a different
 * path and still distributes, so an unguarded accumulator would expand the
 * product before the handler ever sees it.
 *
 * Everything else keeps `.mul()`, which is what folds the numeric cases to a
 * single literal (`∏_{k=1..4} k` = 24) and what `.N()` needs: under
 * `numericApproximation` every factor is a float, distribution cannot arise,
 * and folding is the desired behavior.
 */
function productAccumulate(
  acc: Expression,
  term: Expression,
  numericApproximation: boolean | undefined
): Expression {
  const err = reducerElementError(acc, term);
  if (err) return err;
  if (numericApproximation) return acc.mul(term);
  if (isFunction(acc, 'Add') || isFunction(term, 'Add'))
    return acc.engine.function('Multiply', [acc, term]);
  return acc.mul(term);
}

/**
 * The `incompatible-type` error for an operand of `IsPrime`/`IsComposite`
 * that is outside their carrier, or `undefined` when the operand is inside
 * it.
 *
 * Primality is a question about finite integers, so an infinite argument is
 * out of domain — a contract violation, not a `False` answer. The rest of
 * `number` is in: a non-integer, a complex value and `NaN` are all decidable
 * non-members and get `False`.
 *
 * This lives in the handler rather than in the declared signature because a
 * declared parameter type is what an undeclared argument symbol is inferred
 * FROM: writing the exclusion into the signature declared the caller's own
 * `n` as `complex | nan`. The error is minted with the carrier the signature
 * would have spelled, so the diagnostic a caller reads is the same either
 * way.
 */
/**
 * The held operand of a structural accessor (`Numerator`, `Denominator`,
 * `NumeratorDenominator`), evaluated. These heads are `lazy`, so the
 * generic runtime conformance re-test never sees the value the operand
 * resolves to; a value that refutes the `number` carrier (a string, a
 * boolean) is refused here instead, as the same `incompatible-type` error.
 * An error value is returned as is; a still-symbolic value passes through
 * and is its own numerator over `1`.
 */
function accessorOperand(ce: ComputeEngine, op: Expression): Expression {
  const v = op.evaluate();
  if (!v.isValid) return v;
  if (admissionOf(v, 'number') === 'refute')
    return ce.typeError('number', v.type, v);
  return v;
}

/**
 * The `incompatible-type` error an integer-membership predicate (`IsPrime`,
 * `IsComposite`, `IsOdd`, `IsEven`) answers for an infinite operand, or
 * `undefined` when the operand is not provably infinite. The predicates
 * declare the wide `number` carrier so that a caller's own symbol is not
 * inferred narrower than `number` (see the `IsPrime` comment), and enforce
 * the exclusion of the infinities here instead.
 */
function infiniteOperandOfIntegerPredicate(
  ce: ComputeEngine,
  n: Expression | undefined
): Expression | undefined {
  if (n === undefined || !n.type.matches('infinity')) return undefined;
  return ce.typeError(INTEGER_PREDICATE_CARRIER_TYPE, n.type, n);
}

/**
 * The verdict of `IsOdd` / `IsEven` for one operand: a membership predicate
 * over the integers, so every provable non-integer — `NaN`, a non-integer
 * real, a non-real number — is a `False`, and an infinite operand is the
 * carrier error above. A symbol answers through the parity channel
 * (`isOdd` / `isEven` read an assigned value or an assumption); an operand
 * whose parity is not decided stays inert. The parity of an integer literal
 * comes from the exact channel (`BoxedNumber.isOdd`), never from the
 * machine projection `.re`, which rounds past 2^53.
 *
 * The non-integer test is asked of a literal or a symbol only. A compound
 * answers `isInteger` from its claimed type, three-valued (`k / 2` for an
 * integer `k` claims `real` and answers `undefined`), so it could be asked
 * too; but a compound reaches this handler only when it stayed symbolic
 * under evaluation, and its parity channel is the honest answer for it —
 * inert until the value is known.
 */
function parityPredicate(
  ce: ComputeEngine,
  n: Expression | undefined,
  parity: 'odd' | 'even'
): Expression | undefined {
  if (n === undefined) return undefined;
  const outOfDomain = infiniteOperandOfIntegerPredicate(ce, n);
  if (outOfDomain !== undefined) return outOfDomain;
  if (n.isNaN === true) return ce.False;
  if ((isNumber(n) || isSymbol(n)) && n.isInteger === false) return ce.False;
  const verdict = parity === 'odd' ? n.isOdd : n.isEven;
  if (verdict === undefined) return undefined;
  return verdict ? ce.True : ce.False;
}

/**
 * The terms of a `Sum` fold, combined once at the end (`finishSum`).
 *
 * Adding each term to the sum of the terms before it builds a new `Add` of
 * all the terms at every step, which is then canonicalized again (its like
 * terms collected and its operands sorted), so a sum of `n` symbolic terms
 * cost `O(n²)`: `Sum(sin i, i, 1, 1000).evaluate()` took about 0.7 s. The
 * fold keeps the symbolic terms and builds one canonical `Add` of them.
 *
 * A number literal is added at once to `literal`, in the order of the walk,
 * so a numeric sum keeps one number, as before, and under `N()` the floats
 * are added in the same order as before (a canonical `Add` sorts its
 * operands, which changes the rounding). On the exact route two literals are
 * combined only when their sum stays exact: the `.add()` method makes a float
 * of `1 + √2`, so such a term goes to `terms`, where the canonical `Add`
 * keeps it exact (`Sum(√k, 1..5)` is `3 + √2 + √3 + √5`).
 *
 * The first term that `Add` refuses (a string or a character, a boolean, a
 * dictionary, or a tuple or list that holds one of these: see
 * `isRefusedSumTerm`) is kept as the type error the sum answers.
 */
/**
 * Whether `term` is a value that `Add` refuses as an operand: a dictionary, a
 * boolean, a string or character inside a tuple or a list, or a tuple or
 * list literal that holds one of these at any depth. A tuple or list of
 * numbers is a term (`Sum([(1, 2)])` is `(1, 2)`: points add coordinate by
 * coordinate). Only literal `Tuple` and `List` operands are read, so a lazy
 * collection is not walked here. `never` is a subtype of every type, so a
 * term typed `never` is not taken for a boolean.
 */
function isRefusedSumTerm(term: Expression): boolean {
  if (term.operator === 'Dictionary') return true;
  if (term.type.matches('boolean') && !term.type.matches('never')) return true;
  if (isFunction(term, 'Tuple') || isFunction(term, 'List'))
    return term.ops.some(
      (x) => isString(x) || isCharacter(x) || isRefusedSumTerm(x)
    );
  return false;
}

class SumTerms {
  readonly terms: Expression[] = [];
  literal: Expression | undefined = undefined;
  error: Expression | undefined = undefined;
}

function addSumTerm(
  acc: SumTerms,
  term: Expression,
  numericApproximation: boolean | undefined
): SumTerms {
  if (acc.error !== undefined) return acc;
  if (isString(term) || isCharacter(term)) {
    acc.error = term.engine.typeError('number', term.type);
    return acc;
  }
  // A term that `Add` refuses: a dictionary, a boolean, or a tuple or list
  // literal that holds a text, boolean or dictionary value at any depth (a
  // dictionary entry such as `("a", 3)`). With two or more terms the `Add`
  // built by `finishSum` refuses such a term, but a sum of one term is that
  // term: `Sum([{"a" -> 3}])` was `{"a" -> 3}`, `Sum([True])` was `True`, and
  // `Sum({"a" -> 3})` was `("a", 3)`. The error has the code, the type and the
  // operand of the error `Add` gives for two terms (`Sum([True, 1])`), without
  // the trace frame of the internal `Add`.
  if (isRefusedSumTerm(term)) {
    acc.error = term.engine.typeError('number', term.type, term);
    return acc;
  }
  // An absent term (`Missing`, `Undefined`) is `NaN` in a sum, as in any
  // arithmetic. Kept as a term, a sum of that one term answered the term
  // itself: `Sum([Missing])` was `Missing`, where `Sum([0, Missing])` is
  // `NaN`.
  if (isAbsentScalarSymbol(term)) term = term.engine.NaN;
  if (isNumber(term)) {
    const literal = acc.literal;
    if (literal === undefined) {
      acc.literal = term;
      return acc;
    }
    const sum = literal.add(term);
    if (
      !numericApproximation &&
      isNumber(literal) &&
      literal.isExact &&
      term.isExact &&
      !(isNumber(sum) && sum.isExact)
    ) {
      acc.terms.push(term);
      return acc;
    }
    acc.literal = sum;
    return acc;
  }
  acc.terms.push(term);
  return acc;
}

/** The sum a `Sum` fold answers, evaluated on the route of the fold: see
 * `SumTerms`. */
function finishSum(
  ce: ComputeEngine,
  acc: SumTerms,
  numericApproximation: boolean | undefined
): Expression {
  if (acc.error !== undefined) return acc.error;
  const terms =
    acc.literal === undefined ? acc.terms : [acc.literal, ...acc.terms];
  const sum =
    terms.length === 0
      ? ce.Zero
      : terms.length === 1
        ? terms[0]
        : ce.function('Add', terms);
  const value = sum.evaluate({ numericApproximation });
  // The pole `~oo` is the symbol `ComplexInfinity`, as the running sum
  // answered before. At machine precision `N()` of an `Add` that holds it
  // answers the number `Complex(+oo, +oo)` instead, where `evaluate()`
  // answers the symbol (an open entry of ROADMAP.md).
  if (isNumber(value) && value.re === Infinity && value.im === Infinity)
    return ce.ComplexInfinity;
  return value;
}

/** A `SumTerms` that holds the one number `term`. */
function sumOf(term: Expression): SumTerms {
  const acc = new SumTerms();
  acc.literal = term;
  return acc;
}

/**
 * The first term of a numeric `Sum` or `Product` fold whose numeric value
 * is not finite, and the reason for it.
 *
 * When the numeric value of a fold is NaN or infinite, the fold is
 * evaluated again exactly (`numericFromExactValue`), because at machine
 * precision the double of a finite exact term can be ±∞ (`10^{400}`). That
 * second evaluation is not necessary when a term has an exact value that is
 * not finite (`ln 0` is exactly -∞): then a numeric value of ±∞ is also the
 * float of the exact value. Each term has the same sign in the two
 * evaluations, and with a term that is exactly infinite, a finite sum or
 * product of the other terms cannot change the result. The terms of opposite
 * infinities, and the product of an infinity and a zero (also a zero from a
 * double that is too small), give NaN, and the exact evaluation is done
 * then. Without this record, `Σ_{k=0}^{20000} ln k` evaluated the 20001
 * logarithms again exactly, for the same -∞.
 *
 * - `'exact'`: the exact value of the first such term is not finite.
 * - `'overflow'`: the exact value of that term is finite (or is not known),
 *   and the exact evaluation of the fold is necessary.
 *
 * Only the first term that is not finite is evaluated exactly, so a fold
 * pays one test on each term, and at most one exact term evaluation.
 */
class NonFiniteTerm {
  kind: 'exact' | 'overflow' | undefined = undefined;
}

/**
 * Records in `seen` the first term of a numeric fold that is not finite.
 * `exact` gives the exact value of that term. It is called only when
 * `expression` (the whole fold) is pure: the exact value of an impure term
 * (a random number) is a new value, and the exact evaluation of an impure
 * fold is not done.
 */
function noteNonFiniteTerm(
  seen: NonFiniteTerm,
  expression: Expression | undefined,
  term: Expression | null | undefined,
  exact: () => Expression | undefined
): void {
  if (seen.kind !== undefined || !term || !isNumber(term)) return;
  if (term.isFinite !== false) return;
  if (expression?.isPure !== true) {
    seen.kind = 'overflow';
    return;
  }
  const v = exact();
  seen.kind =
    v !== undefined && isNumber(v) && v.isFinite === false
      ? 'exact'
      : 'overflow';
}

/**
 * The numeric value of a `Sum` or `Product` fold: `value`, or the float of
 * the exact value of `expression` when `value` is NaN or infinite and a term
 * can have overflowed (see `NonFiniteTerm`). A finite `value` costs one test.
 */
function numericOfFold(
  ce: ComputeEngine,
  expression: Expression | undefined,
  value: Expression,
  seen: NonFiniteTerm
): Expression {
  if (seen.kind === 'exact' && value.isNaN !== true) return value;
  return numericFromExactValue(ce, expression, value) ?? value;
}

/** The asynchronous form of `numericOfFold()`: see
 * `numericFromExactValueAsync()`. */
async function numericOfFoldAsync(
  ce: ComputeEngine,
  expression: Expression | undefined,
  value: Expression,
  seen: NonFiniteTerm,
  options: Parameters<Expression['evaluateAsync']>[0]
): Promise<Expression> {
  if (seen.kind === 'exact' && value.isNaN !== true) return value;
  return (
    (await numericFromExactValueAsync(ce, expression, value, options)) ?? value
  );
}

/** Generator-based reducer over a finite collection. Yields between
 * iterations so callers can wrap it with `run`/`runAsync` for timeout
 * and cancellation. Caller is responsible for finiteness checks.
 */
function* reduceCollection<T>(
  collection: Expression,
  init: T,
  combine: (acc: T, x: Expression) => T
): Generator<T, T> {
  let acc = init;
  for (const x of collection.each()) {
    acc = combine(acc, x);
    yield acc;
  }
  return acc;
}

/** The most points `Distance` broadcasts over. Beyond it the operator stays
 *  symbolic rather than materialize an unbounded list of radicals. */
const MAX_DISTANCE_BROADCAST = 10000;

/**
 * The coordinates of `x` read as a single POINT, or `undefined` when `x` is
 * not one. Both spellings are points: a `Tuple` — `(3, 4)` — and the flat
 * numeric `List` a data import produces — `[3, 4]`. A list whose elements are
 * themselves lists is a list of points, not a point: see `pointListOperand`.
 */
function pointOperand(x: Expression): readonly Expression[] | undefined {
  if (isFunction(x, 'Tuple')) return x.ops!.length > 0 ? x.ops! : undefined;
  // Any finite indexed collection of numbers — a `List` literal, a `Range`,
  // a lazy `Map` — is the flat spelling. The count bound keeps a large domain
  // from materializing here (an oversized operand stays symbolic).
  if (x.isFiniteCollection !== true || x.isIndexedCollection !== true)
    return undefined;
  const count = x.count;
  if (count === undefined || count === 0 || count > MAX_DISTANCE_BROADCAST)
    return undefined;
  // An absent element (`Missing` or `Undefined`) is an absent coordinate, as
  // it is in a `Tuple`: `[1, Missing]` is a point whose distance to any other
  // point is `NaN`, and so is `[Missing, Missing]` (a list of absent POINTS
  // holds tuples, not bare symbols, so it cannot be mistaken for this).
  const coords: Expression[] = [];
  for (const el of x.each()) {
    if (!isAbsentSymbol(el) && !isCoordinate(el)) return undefined;
    coords.push(el);
  }
  return coords;
}

/**
 * True when `x` can be a coordinate of a point for `Distance`: a number
 * literal, or a constant expression with a numeric value (`π`, `1 − π`,
 * `1 + √2·i`). A symbol with no value is not a coordinate.
 */
function isCoordinate(x: Expression): boolean {
  return isNumber(x) || (x.isConstant && x.type.matches('number'));
}

/**
 * The points of `xs` read as a LIST of points, or `undefined` when `xs` is not
 * one. Both spellings broadcast: a list of tuples `[(0,0),(3,4)]` and the list
 * of lists `[[0,0],[3,4]]` a data import produces (Tycho item 138).
 *
 * A cell of a written-out `List` may also be an absent point (`Missing` or
 * `Undefined`, such as the point of an element-wise restriction whose
 * condition is false) or a restricted point whose condition is not decided
 * (`When`, `Which`). Such a cell is returned as the expression itself, not
 * as coordinates, and the caller answers for it. At least one cell must be
 * a point or a restricted point, so a list of absent values is not read as a
 * list of points.
 */
function pointListOperand(
  xs: Expression
): readonly (readonly Expression[] | Expression)[] | undefined {
  if (xs.isFiniteCollection !== true || xs.isIndexedCollection !== true)
    return undefined;
  const count = xs.count;
  if (count === undefined || count > MAX_DISTANCE_BROADCAST) return undefined;
  const cells = isFunction(xs, 'List');
  const points: (readonly Expression[] | Expression)[] = [];
  let sawPoint = false;
  for (const el of xs.each()) {
    const p = pointOperand(el);
    if (p !== undefined) {
      sawPoint = true;
      points.push(p);
    } else if (cells && (isFunction(el, 'When') || isFunction(el, 'Which'))) {
      sawPoint = true;
      points.push(el);
    } else if (cells && isAbsentSymbol(el)) points.push(el);
    else return undefined;
  }
  if (!sawPoint && points.length > 0) return undefined;
  return points;
}

/** Whether the STATIC type of `x` says it holds a list of points — used by
 *  the `Distance` type handler to report the broadcast result type.
 *  Three-valued: `true` when proven, `false` when ruled out, and `undefined`
 *  when it CANNOT be decided statically (Tycho item 143). */
function isPointListType(t: Type): boolean | undefined {
  // A rank ≥ 2 numeric tensor (`matrix<number^(3x2)>`) is a list of rows: its
  // `elements` is the SCALAR type, so the dimensions carry the shape.
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    (t.dimensions?.length ?? 0) >= 2
  )
    return true;
  const elt = collectionElementType(t);
  if (elt === undefined) return false;
  if (elt === 'unknown' || elt === 'any') {
    // The element type is unknown, so a list of points is not ruled out. Only
    // a type that COULD be an indexed collection can be one: a bare `tuple` is
    // always read as a single point (`pointOperand` takes the `Tuple` branch
    // first), and a non-indexed collection (set/dictionary/record) never
    // broadcasts. A base declared with the bare `collection` type — the
    // SUPERTYPE of `indexed_collection` — is undecidable too, not a scalar.
    const kind = typeof t === 'string' ? t : t.kind;
    return kind === 'list' ||
      kind === 'indexed_collection' ||
      kind === 'collection'
      ? undefined
      : false;
  }
  // A list of absent values only (`[Missing, Missing]`, typed `list<missing>`)
  // is read by `pointOperand` as ONE point with absent coordinates (its
  // distance is `NaN`), but it could as well be a list of absent points, so
  // the static answer is undecided, as for an unknown element type.
  // The handler receives the operand type with `missing` stripped, so that
  // list reaches here as `list<never>`; `never` is a subtype of every type
  // and would count as a point.
  const e = resolveTypeAlias(elt);
  if (e === 'missing' || e === 'never') return undefined;
  // A tuple, a nested list, or a union of those: an element that is itself an
  // indexed collection is a point.
  return isSubtype(elt, INDEXED_COLLECTION_SHAPE_TYPE);
}

/** The Euclidean distance between two points, as an EXPRESSION: the
 *  2-norm of the coordinate differences, `Norm(p − q)`, evaluated once, so
 *  the exact path is honored (`Distance((0,0),(1,1)) → √2`, not the machine
 *  float) — mirroring `Hypot`. `.N()` still numericizes. */
function pointDistance(
  a: readonly Expression[],
  b: readonly Expression[],
  ce: ComputeEngine,
  numericApproximation?: boolean
): Expression {
  if (a.length !== b.length || a.length === 0)
    return ce.error('incompatible-dimensions');
  // The coordinate differences — `Distance(p, q)` is `Norm(p − q)`, so these
  // are the legs the norm is taken of. They are evaluated here for two
  // reasons: the infinite-leg test below reads a number literal, and `∞ − ∞`
  // is NaN, a cancellation only the difference shows and never the two
  // coordinates on their own.
  // An ABSENT coordinate (`Missing` or `Undefined`, such as the value of a
  // restricted coordinate whose condition is false) makes the distance `NaN`,
  // as it makes `Norm((1, Missing))` `NaN`: the numeric slot's absence marker
  // absorbs, even beside an infinite leg (`Norm((+oo, Missing))` is `NaN`
  // too). It used to reach the coordinate test below and answer an
  // `expected-value` error.
  if (a.some((c) => isAbsentSymbol(c)) || b.some((c) => isAbsentSymbol(c)))
    return ce.NaN;
  const legs: Expression[] = [];
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    // A coordinate that is not a number at all is a malformed point — a
    // violated contract rather than a value — so it is an error. A constant
    // with a numeric value (`π`, `1 − π`) is a coordinate. A non-finite
    // coordinate is not malformed and is not an error: it has an in-band
    // answer, given by the norm.
    if (!isCoordinate(ai) || !isCoordinate(bi))
      return ce.error('expected-value');
    legs.push(ce.function('Subtract', [ai, bi]).evaluate());
  }
  // A distance is the norm of the difference, so the vector 2-norm computes
  // it, with the rules of the norm: each term is the squared modulus of a
  // leg, so the distance between complex points is real
  // (`Distance((2, i), (1, 1))` is `√3`); an infinite leg — signed, `~oo`,
  // or a directed infinity such as `∞ + i` — makes the distance `+oo`
  // whatever the other legs are, a NaN leg included
  // (`hasInfiniteMagnitudeComponent`, tested by the norm before the sum of
  // squares); with no infinite leg, a NaN leg makes it NaN. The compiled
  // code answers the same way: it emits `Math.hypot`, and
  // `Math.hypot(Infinity, NaN)` is `Infinity`.
  return ce
    .function('Norm', [ce.function('Tuple', legs)])
    .evaluate({ numericApproximation });
}

/**
 * The square root of a constant radicand that has the square of a real
 * constant as a factor, with that factor taken out: `√(π²)` is `π`,
 * `√((1 − π)²)` is `π − 1`, `√(2π²)` is `√2·π` and `√(e²π²)` is `e·π`. A
 * factor `c^(2k)`, with `c` a real constant and `k` a positive integer, gives
 * `|c|^k`, because `√(c²) = |c|` for every real `c`. The other factors stay
 * under the root (`√(8π²)` is `π·√8`, which is `2√2·π`).
 *
 * Returns `undefined` when the radicand has no such factor, or is not
 * constant: `√(x²)` stays `√(x²)` under `evaluate()`, since `x` may be
 * complex, and `|x|` is the answer of `simplify()` only when `x` is known
 * to be real.
 *
 * The value `|c|` is found by `Abs` (`evaluateAbs`), from the sign of `c`.
 * When that sign is not known, `Abs(c)` stays unevaluated, and the factor
 * stays under the root. The canonical form does not take the square out
 * (`\sqrt{\pi^2}` parses to `Sqrt(Power(Pi, 2))`), and the evaluation of
 * `Sqrt` does not either, so without this `evaluate()` left `√(π²)` as it
 * is, and the modulus `|π·i| = √(π²)` was not reduced.
 */
function sqrtOfSquareFactors(x: Expression): Expression | undefined {
  if (!isFunction(x) || !x.isConstant) return undefined;
  const ce = x.engine;
  const factors = isFunction(x, 'Multiply') ? x.ops : [x];
  const outside: Expression[] = [];
  const inside: Expression[] = [];
  for (const factor of factors) {
    const base = isFunction(factor, 'Power') ? factor.op1 : undefined;
    const abs =
      base !== undefined && base.type.matches('real')
        ? ce.function('Abs', [base]).evaluate()
        : undefined;
    const n = isFunction(factor, 'Power') ? factor.op2 : undefined;
    // An unevaluated `Abs(base)` means the sign of `base` is not known,
    // unless `base` is itself an `Abs`, which is non-negative:
    // `√(|w|²) = |w|`.
    if (
      abs === undefined ||
      (isFunction(abs, 'Abs') && !isFunction(base, 'Abs')) ||
      n === undefined ||
      !isNumber(n) ||
      n.isComplex ||
      !Number.isInteger(n.re) ||
      n.re <= 0 ||
      n.re % 2 !== 0
    ) {
      inside.push(factor);
      continue;
    }
    const k = n.re / 2;
    outside.push(k === 1 ? abs : ce.function('Power', [abs, ce.number(k)]));
  }
  if (outside.length === 0) return undefined;
  if (inside.length > 0)
    outside.push(
      ce.function('Sqrt', [
        inside.length === 1 ? inside[0] : ce.function('Multiply', inside),
      ])
    );
  return ce.function('Multiply', outside).evaluate();
}

function evaluateAbs(
  arg: Expression,
  numericApproximation?: boolean
): Expression | undefined {
  const ce = arg.engine;
  // A fixed-arity point: |(x,y)| is the Euclidean norm — the single-bar
  // spelling of the vector magnitude (Desmos convention; matches the
  // `\lVert…\rVert` parse). `isTuple` is type-based, so a tuple-typed
  // symbol routes too (staying an inert `Norm` until it has a value). Only
  // tuples route: `Abs` over a `List` keeps broadcasting elementwise
  // (`Abs([3,-4]) → [3,4]`).
  if (isTuple(arg))
    return ce.function('Norm', [arg]).evaluate({ numericApproximation });
  // `Abs(Measurement(v, σ))` is `Measurement(Abs(v), σ)` (see
  // `measurementLipschitzUnary`).
  const m = measurementLipschitzUnary(ce, 'Abs', arg);
  if (m !== undefined) return numericApproximation ? m.N() : m;
  if (isNumber(arg)) {
    const num = arg.numericValue;
    if (typeof num === 'number') return ce.number(Math.abs(num));
    // Exact modulus of a Gaussian (integer) complex number:
    // |a+bi| = √(a²+b²), built exactly (`|1+i| → √2`) instead of the machine
    // hypot float. `Abs(3+4i)` already gave 5 because 25 is a perfect square;
    // this extends the exact path to every integer a, b. `.N()` numericizes.
    if (num.isComplex) {
      // An exact complex value `√r·(a+bi)`: its modulus `√(r·(a²+b²))` is
      // exact when the root has an exact form (`|√2·(1000+1000i)|` is 2000,
      // `|√3·(1+2i)|` is `√15`).
      if (num.isExact) {
        const modulus = num.abs();
        if (modulus.isExact)
          return numericApproximation
            ? ce.number(modulus).N()
            : ce.number(modulus);
      }
      const re = num.re;
      const im = num.im;
      const s = re * re + im * im;
      if (
        Number.isInteger(re) &&
        Number.isInteger(im) &&
        Number.isSafeInteger(s)
      )
        return ce
          .function('Sqrt', [ce.number(s)])
          .evaluate({ numericApproximation });
      // The exactness contract: `evaluate()` of an exact argument never
      // gives a float. The modulus has no exact form here (the root of a
      // large non-square), so `Abs` stays unevaluated; `.N()` gives the
      // float.
      if (num.isExact && !numericApproximation) return undefined;
    }
    return ce.number(num.abs());
  }
  if (arg.isNonNegative) return arg;
  if (arg.isNegative) return arg.neg();
  // A real constant whose sign `isNonNegative` does not know, such as the
  // sum `1 − π`: the sign comes from the exact comparison with zero
  // (`exactOrder`), which is `undefined` when the value is too near zero to
  // be decided at the working precision. Then `Abs` stays unevaluated.
  if (arg.isConstant && arg.type.matches('real')) {
    const sign = exactOrder(arg, ce.Zero);
    if (sign === undefined) return undefined;
    const result = sign < 0 ? arg.neg() : arg;
    return numericApproximation ? result.N() : result;
  }

  // Exact modulus of a complex expression with radical/rational real and
  // imaginary parts, e.g. |3 − √7 + i√(6√7 − 15)| → 1 (W. Kahan). Split
  // z = a + b·i, then |z| = √(a² + b²) with the square expanded so exact
  // arithmetic folds the radicals. Fire only when the squared modulus folds
  // to a concrete non-negative real number AND the exact result matches |z|
  // numerically — this rejects an incorrect real/imaginary split (the split
  // reads the realness of a leaf from its type, and a declared type can be
  // wrong: see `complexParts`) and keeps every non-reducing complex `Abs`
  // symbolic. The square root of
  // the squared modulus takes the square factors out (`sqrtOfSquareFactors`),
  // so `|π·i| = √(π²)` is `π` and `|π·(1 + i)| = √(2π²)` is `√2·π`.
  //
  // Gate on a closed-constant operand first: a symbolic `Abs(f(x))` can never
  // fold to a numeric modulus, and this cheap check avoids the `arg.N()`
  // numeric probe below on every symbolic Abs in a hot simplify loop.
  // (`isConstant`, not the dynamic-scope `unknowns` — a bound parameter
  // inside a function application is not a foldable constant; see the D2
  // comment on `Add`.)
  if (arg.isConstant) {
    const zn = arg.N();
    const zre = zn.re;
    const zim = zn.im;
    if (Number.isFinite(zre) && Number.isFinite(zim) && zim !== 0) {
      const parts = complexParts(arg);
      if (parts) {
        const [a, b] = parts.map((part) => part.evaluate());
        // A value on an axis: `|a + 0·i|` is `|a|`, and `|0 + b·i|` is `|b|`.
        // The squared modulus below would be `b²` expanded (for `i(1 − π)`,
        // `1 − 2π + π²`), whose sign `isNonNegative` does not know.
        if (a.isSame(0))
          return ce.function('Abs', [b]).evaluate({ numericApproximation });
        if (b.isSame(0))
          return ce.function('Abs', [a]).evaluate({ numericApproximation });
        const m = ce.function('Add', [
          ce.function('Multiply', [a, a]),
          ce.function('Multiply', [b, b]),
        ]);
        const mVal = expand(m).evaluate();
        // The squared modulus is a number literal (`|1 + √2·i|²` is 3) or a
        // real constant expression (`|e + π·i|²` is `e² + π²`, and the
        // result is `√(e² + π²)`).
        const isRealConstant = isNumber(mVal)
          ? !mVal.isComplex
          : mVal.isConstant && mVal.type.matches('real');
        if (isRealConstant && mVal.isNonNegative === true) {
          const modSq = zre * zre + zim * zim;
          const mn = isNumber(mVal) ? mVal.re : mVal.N().re;
          if (
            Number.isFinite(mn) &&
            Math.abs(mn - modSq) <= 1e-10 * (1 + Math.abs(modSq))
          )
            return ce
              .function('Sqrt', [mVal])
              .evaluate({ numericApproximation });
        }
      }
    }
  }

  return undefined;
}

/**
 * What the walk of `Max`/`Min` saw that decides between `Indeterminate` and
 * `NaN`: an `Indeterminate` operand gives `Indeterminate` only when no operand
 * is inexact (`isInexactOperand()`). `inexact` records an inexact value met
 * as an operand or an element. A list folded on its doubles
 * (`isMachineDoubleList`) is recorded in `machineLists` instead: its doubles
 * do not say which elements are floats (an exact `1/2` is the double `0.5`),
 * so its elements are read only when an `Indeterminate` was seen.
 */
type ExtremumWalk = { inexact: boolean; machineLists: Expression[] };

function processMinMaxItem(
  item: Expression,
  mode: 'Min' | 'Max' | 'Supremum' | 'Infimum',
  walk: ExtremumWalk = { inexact: false, machineLists: [] }
): [Expression | undefined, ReadonlyArray<Expression>] {
  const ce = item.engine;
  const upper = mode === 'Max' || mode === 'Supremum';

  // An ABSENT datum (the `Missing` symbol or a `NaN` number) makes the whole
  // extremum absent, and in a numeric result absence is `NaN`. It is reported
  // as this item's value, and the caller's `NaN` check absorbs it. The test is
  // made here, on the walk that folds the elements, and not by a separate walk
  // before the fold: a lazy collection computes its elements again on every
  // walk, so a second walk doubles the work (and doubles the runs of a
  // callback that has a side effect). Because this function recurses into
  // nested collections, an absent datum at any depth is found.
  if (isAbsentValue(item)) return [ce.NaN, []];

  // An interval is continuous
  if (isFunction(item, 'Interval')) {
    let b = upper ? item.op2 : item.op1;
    // An endpoint marked `Closed(a)` is attained, so it is the maximum or
    // minimum. One marked `Open(a)` is still the supremum or infimum — the
    // least upper bound need not belong to the set — but the interval has no
    // maximum or minimum there, so `Max`/`Min` stay symbolic.
    if (isFunction(b, 'Closed')) b = b.op1;
    else if (
      isFunction(b, 'Open') &&
      (mode === 'Supremum' || mode === 'Infimum')
    )
      b = b.op1;

    if (!b.isNumber || !isNumber(b)) return [undefined, [item]];
    return [b, []];
  }

  // A range is discrete, the last element may not be included
  if (item.operator === 'Range') {
    // Symbolic bounds (e.g. Range(1, n)): the extremum is indeterminate
    if (hasSymbolicRangeBounds(item)) return [undefined, [item]];
    // The run may descend (`Range(1, -oo)` is 1, 0, -1, …), so the
    // extremum is the larger or smaller of the first and last elements, as
    // for `Max`. Reading the first element for `Min` answered 1 for that
    // range, whose minimum is -oo.
    const r = range(item);
    // An empty range (`Range(1, 5, -1)`) contributes no value, as an empty
    // list does: `Min(1, Range(1, 5, -1))` is 1, and a call whose every
    // operand is empty is NaN (`evaluateMinMax`). `rangeLast` would answer
    // `lower - step` for it, a value that is not an element.
    if (rangeCount(r[0], r[1], r[2]) === 0) return [undefined, []];
    const last = rangeLast(r);
    return [ce.number(upper ? Math.max(r[0], last) : Math.min(r[0], last)), []];
  }

  if (isFunction(item, 'Linspace')) {
    // `Linspace(start, end, count)` spreads its elements from one endpoint to
    // the other inclusive, and the run may DESCEND: `Linspace(5, 1, 3)` is
    // [5, 3, 1]. So the extremum is the larger/smaller OF THE TWO ENDPOINTS,
    // not a fixed one of them — taking `end` for the maximum answered 1 for
    // that collection, whose largest element is 5 (and `start` for the
    // minimum answered 5, its smallest being 1). The one-operand form
    // `Linspace(n)` runs from 1 to `n`.
    // A count that is not statically known (`Linspace(1, 5, m)`) leaves the
    // sample set unknown, and with it the extremum.
    if (item.isFiniteCollection !== true) return [undefined, [item]];
    const start = item.nops === 1 ? ce.One : item.op1;
    const end = item.nops === 1 ? item.op1 : item.op2;
    const count = item.count;
    // The COUNT decides which endpoints are actually sampled. A single-sample
    // `Linspace` sits at `start` and never reaches `end` (`Linspace(1, 5, 1)`
    // is [1], the NumPy convention the `at`/`iterator` handlers implement), so
    // reading the extremum off both endpoints would answer 5 for a collection
    // whose only element is 1. A zero-sample `Linspace` is an empty
    // collection: it contributes no value and nothing symbolic, so that
    // `evaluateMinMax` answers `NaN` when no other operand supplies data.
    if (count === 0) return [undefined, []];
    if (count === 1) return [start, []];
    // Two or more samples span both endpoints inclusive, so the extremum is
    // the larger/smaller OF THE TWO — endpoints that cannot be ordered (a
    // symbolic one, as in `Linspace(a, 1, 3)`) leave it unknown, and the
    // operand stays symbolic rather than guess an endpoint.
    const endpoint = scalarExtremum(start, end, upper, false);
    if (endpoint === undefined) return [undefined, [item]];
    return [endpoint, []];
  }

  // TEXT is ATOMIC in an extremum. A string is an indexed collection of its
  // grapheme clusters, so without this guard `Max("abc")` would fold the
  // collection branch below and answer `max("a", "b", "c")` — the extremum of
  // the CHARACTERS, which is not what any reader of `Max("abc")` asks for.
  // Falling through to the non-number arm at the end leaves the string operand
  // symbolic, which is exactly what it produced before strings became
  // collections (`docs/STRING_ROADMAP.md`, design constraint 5).
  if (isTextAtom(item)) return [undefined, [item]];

  // A `List` of machine numbers is folded on its doubles: see
  // `machineExtremum`.
  if (isMachineDoubleList(item)) {
    walk.machineLists.push(item);
    const extremum = machineExtremum(item.array, upper, ce);
    // The extremum is one of the elements, boxed as the list boxes it: an
    // integer value is a float in a list of floats (`_machineFloats`).
    if (extremum !== undefined)
      return [
        boxStoreElement(
          ce,
          extremum,
          isFunction(item) && item._machineFloats === true
        ),
        [],
      ];
  }

  // A DICTIONARY is a collection of key-value entries, and an entry is not a
  // number. Walking it as a collection compared its keys with its values:
  // `Max({"a" -> 3, "b" -> 5})` was `max(5, "a", "b")`. The answer is the
  // `incompatible-type` error that `Sum` and `Mean` give for the same
  // operand, which names the first entry. An empty dictionary has no entry
  // and contributes no value, as an empty list does.
  if (item.operator === 'Dictionary') {
    for (const entry of item.each())
      return [ce.typeError('number', entry.type, entry), []];
    return [undefined, []];
  }

  if (item.isCollection) {
    // Only a finite, enumerable collection can be folded for an extremum.
    // An infinite one (an Interval's dyadic sampler, a Map over it) would
    // grind until the evaluation deadline; one that reports elements but
    // declines enumeration (e.g. Map over a Linspace with a symbolic
    // endpoint) would silently VANISH from the result — Min(Map(...), 5)
    // returned 5. Keep the operand symbolic instead. (A genuinely empty
    // lazy collection — Filter over a finite source with no matches — has
    // isEmptyCollection === true, is not "declined", and still folds away.)
    // The decline is read off the fold's OWN walk (below) rather than probed
    // first: probing starts a second enumeration, which re-runs the element
    // callback of a lazy `Map`/`Filter`.
    if (item.isFiniteCollection !== true) return [undefined, [item]];
    let result: Expression | undefined = undefined;
    const rest: Expression[] = [];
    let walked = 0;
    let sawIndeterminate = false;
    let sawNaN = false;
    for (const op of item.each()) {
      walked += 1;
      // A dictionary ELEMENT is not a number. The error names the whole
      // dictionary, as the error of `Sum([1, {"a" -> 3}])` does.
      if (op.operator === 'Dictionary')
        return [ce.typeError('number', op.type, op), []];
      const [val, others] = processMinMaxItem(op, mode, walk);
      // An error is the answer of the whole extremum.
      if (isFunction(val, 'Error')) return [val, []];
      if (val) {
        // NaN absorbs, mirroring the top-level convention: an indeterminate
        // element makes the whole extremum indeterminate (Max([1, NaN, 3]) →
        // NaN, matching Max(1, NaN, 3)). Returning NaN as this item's value
        // lets the caller's top-level NaN check absorb it.
        // An `Indeterminate` element absorbs too, but a `NaN` element
        // anywhere in the walk still wins: the walk continues, and the
        // caller (`evaluateMinMax`) answers `Indeterminate` only when no
        // element is `NaN` or inexact (`Max([1, Indeterminate])` is
        // `Indeterminate`, `Max([Indeterminate, NaN])` and
        // `Max([1.5, Indeterminate])` are `NaN`).
        // The walk continues after a `NaN` too, so that an error found
        // later (a dictionary element) is the answer whatever the order of
        // the elements: `Max([NaN, d])` and `Max([d, NaN])` are both the
        // error, as for `Sum`.
        if (val.isNaN) {
          if (!val.isIndeterminate) sawNaN = true;
          else sawIndeterminate = true;
          continue;
        }
        if (isInexactOperand(val)) walk.inexact = true;
        result = foldExtremumValue(val, result, rest, upper);
      }
      rest.push(...others);
    }
    if (sawNaN) return [ce.NaN, []];
    if (enumerationDeclinedAfterWalk(item, walked)) return [undefined, [item]];
    if (sawIndeterminate) return [ce.Indeterminate, []];
    return [result, rest];
  }

  if (isNumber(item)) return [item, []];
  // A real constant that is not a number literal (`π`, `√10`, `e²`) has a
  // value, and `exactOrder` orders it against the other values:
  // `Max(π, 3)` is `π`. Any other operand (a symbol with no value, a complex
  // constant such as `π + i`) stays in the unevaluated result.
  if (item.isConstant && item.type.matches('real')) return [item, []];
  // A constant of type `number` can be real (`tan(π/2 − 1/10)`: the type of
  // `Tan` does not exclude the complex numbers). Its value decides, as it
  // does for `Sort` and `Clamp`, which order any operands with `exactOrder`:
  // a value that is not real stays in the unevaluated result.
  if (item.isConstant && item.type.matches('number')) {
    const value = item.N();
    if (isNumber(value) && !value.isComplex && !value.isNaN) return [item, []];
  }
  return [undefined, [item]];
}

/**
 * Is `x` a `List` of machine numbers that the interpreter computes with as
 * doubles: the engine is at machine precision, and every element is stored
 * as a double or is exact (`holdsDoubles`)? At a higher precision a float is
 * a big-number value, whose arithmetic and comparisons are decimal.
 */
function isMachineDoubleList(
  x: Expression
): x is Expression & { array: readonly number[] } {
  return (
    isFunction(x, 'List') &&
    x._machineFloats !== undefined &&
    !bignumPreferred(x.engine) &&
    holdsDoubles(x)
  );
}

/**
 * The sum of the operand of `Sum(L)` computed on doubles, when the operand
 * is, or holds, or evaluates to, a `List` of machine numbers at machine
 * precision (`isMachineDoubleList`). Answers the sum, or the collection the
 * caller must fold in place of the operand, or `undefined` when the caller
 * folds the operand itself.
 *
 * The fold adds the elements in order with `add()`, starting from `0`. Each
 * `add()` of a float is the addition of two doubles, in the same order as
 * here. A partial sum of exact integers is an EXACT integer in the fold,
 * which adds integers exactly, past the safe range too; once a float term
 * is added the partial sum is a float, even when its value is an integer
 * (`0.5 + 0.5` is the float `1`). This function declines as soon as a
 * partial sum is an integer past the safe range, where a double may no
 * longer hold what the fold holds. A non-finite element declines: the
 * fold decides `∞ − ∞` and `NaN`.
 *
 * The value of a symbol is read, never evaluated (`machineListOf`). An
 * operand that is a function with no iterator of its own is evaluated here:
 * walking such an operand evaluates it in the same way
 * (`BoxedFunction.each()`). When this function evaluated the operand and
 * then declines, it answers the evaluated collection, and the caller walks
 * that one, so the operand is evaluated once. A lazy collection with its own
 * iterator (`Map`, `Range`) is left to the fold.
 */
function machineSum(
  operand: Expression
): number | [number] | Expression | undefined {
  const evaluatedByWalk =
    isFunction(operand) &&
    operand.operator !== 'List' &&
    operand.operatorDefinition?.collection?.iterator === undefined &&
    operand.isPure;
  const evaluated = evaluatedByWalk ? operand.evaluate() : undefined;
  const declined =
    evaluated?.isFiniteCollection === true ? evaluated : undefined;
  const list = machineListOf(evaluated ?? operand);
  if (list === undefined) return declined;
  return machineListTotal(list) ?? declined;
}

/**
 * The sum of the doubles of `list`, when `list` is a `List` of machine
 * numbers at machine precision (`isMachineDoubleList`) and the doubles give
 * the value the element-by-element fold gives: see `machineSum` for the
 * rules. `undefined` otherwise. The sum is a number when every element is
 * an exact integer, and a one-element array when some element is a float:
 * the sum is then a float, even when its value is an integer (`0.5 + 0.5`
 * is the float `1`).
 */
function machineListTotal(list: Expression): number | [number] | undefined {
  if (!isMachineDoubleList(list)) return undefined;
  const values = list.array;
  const frame = list.engine._deadlineFrame;
  let float = isFunction(list) && list._machineFloats === true;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    if ((i & DEADLINE_STRIDE) === DEADLINE_STRIDE) checkDeadline(frame);
    const v = values[i];
    if (!Number.isFinite(v)) return undefined;
    if (!Number.isInteger(v)) float = true;
    total += v;
    if (Number.isInteger(total) && !Number.isSafeInteger(total))
      return undefined;
  }
  if (total === 0) total = 0;
  return float ? [total] : total;
}

/** The boxed sum that `machineListTotal()` answers: an exact integer or a
 * float for a number, a float for a one-element array. */
function boxMachineTotal(
  ce: ComputeEngine,
  total: number | [number]
): Expression {
  if (typeof total === 'number') return ce.number(total);
  return ce.number(ce._inexactNumericValue(total[0]));
}

/**
 * The maximum (`upper`) or the minimum of a non-empty array of doubles, as the
 * element-by-element fold of `processMinMaxItem` answers it, or `undefined`
 * when the fold must answer (an empty array, an integer past the safe range).
 *
 * The fold orders two values exactly, with no tolerance (`exactOrder`), and
 * so does this scan: the result is the value `Math.max`/`Math.min` give,
 * which is what the compiled JavaScript calls. This includes signed zero:
 * of `0` and `-0`, the maximum is `0` and the minimum is `-0`. (A machine
 * list stores `+0` for `-0`, as `ce.number(-0)` boxes to `+0`, so the scan
 * does not see `-0` today.) `NaN` absorbs, as in the fold. Boxing each of
 * ten thousand doubles to compare it cost about 10 ms; the scan costs
 * microseconds.
 */
function machineExtremum(
  values: readonly number[],
  upper: boolean,
  ce: ComputeEngine
): number | undefined {
  if (values.length === 0) return undefined;
  let result = values[0];
  if (Number.isNaN(result)) return NaN;
  if (Number.isInteger(result) && !Number.isSafeInteger(result))
    return undefined;
  for (let i = 1; i < values.length; i++) {
    if ((i & DEADLINE_STRIDE) === DEADLINE_STRIDE)
      checkDeadline(ce._deadlineFrame);
    const v = values[i];
    if (Number.isNaN(v)) return NaN;
    // An integer past the safe range may be an exact big integer in the
    // list, which the double would box again as a float (only a safe-integer
    // double is boxed as an exact integer): the fold answers.
    if (Number.isInteger(v) && !Number.isSafeInteger(v)) return undefined;
    if (upper ? v > result : v < result) result = v;
    // `0 === -0`, so the comparison above does not choose between them.
    else if (v === 0 && result === 0 && Object.is(upper ? result : v, -0))
      result = v;
  }
  return result;
}

/**
 * The scalar maximum (`upper`) or minimum of two operands, preserving
 * exactness: returns the winning operand itself (so `max(√2, 1)` stays `√2`),
 * or its numeric approximation under `numericApproximation`. Used by the
 * broadcastable `ElementMax`/`ElementMin`/`Clamp` operators — the broadcasting
 * machinery reduces a collection argument to per-element scalar calls, so this
 * only ever sees scalars. Returns `undefined` (stay symbolic) when the ordering
 * is undecidable, mirroring `evaluateMinMax`'s three-valued discipline:
 * - a `NaN` operand absorbs to `NaN`;
 * - a non-real (complex) operand is unordered → symbolic (both operand orders
 *   then agree);
 * - a free/undecidable comparison → symbolic.
 */
function scalarExtremum(
  a: Expression,
  b: Expression,
  upper: boolean,
  numericApproximation: boolean
): Expression | undefined {
  const ce = a.engine;
  // A `NaN` operand gives `NaN`; an `Indeterminate` operand gives
  // `Indeterminate` when the other operand is neither `NaN` nor inexact
  // (`nanOperandAnswer()`, the rule of the reducers, see `evaluateMinMax`).
  if (a.isNaN === true || b.isNaN === true) return nanOperandAnswer(ce, [a, b]);
  if ((isNumber(a) && a.isComplex) || (isNumber(b) && b.isComplex))
    return undefined;
  // `undefined` when the comparison is not decidable (a free symbol); ties
  // keep `a`, unless `b` is a number literal and `a` is not (see
  // `extremumOrder`).
  const bWins = extremumOrder(b, a, upper, true);
  if (bWins === undefined) return undefined;
  const winner = bWins ? b : a;
  return numericApproximation ? winner.N() : winner;
}

/**
 * Whether `candidate` is strictly greater (`upper`) or strictly less than
 * `current`: `undefined` when the order is not decidable. Two different
 * numbers are ordered exactly (`exactOrder`), however close they are:
 * `isGreater`/`isLess` apply the engine tolerance, and with them
 * `Max(1e-12, 2e-12)` answered `1e-12`. Two equal values are a tie, and the
 * caller keeps `current`. Two constants whose order is not decided at a
 * higher precision either are a tie when they agree within the engine
 * tolerance (`tieWithinTolerance`, the last step of `exactOrder`).
 *
 * With `preferLiteralOnTie`, a tie replaces `current` when `candidate` is a
 * number literal and `current` is not: of two equal values, the result is
 * the literal (`Max(sin²1 + cos²1, 1)` is `1`, `Max(ln 2 + ln 3 − ln 6, 0)`
 * is `0`), whatever the order of the operands. A tie within the tolerance
 * is most often a constant that is nearly equal to a literal
 * (`cos(10⁻³⁰) − 1` and `0`), and the literal is then the better answer.
 */
function extremumOrder(
  candidate: Expression,
  current: Expression,
  upper: boolean,
  preferLiteralOnTie = false
): boolean | undefined {
  const order = exactOrder(candidate, current, { tieWithinTolerance: true });
  if (order === undefined) return undefined;
  if (order === 0)
    return preferLiteralOnTie && isNumber(candidate) && !isNumber(current);
  return upper ? order > 0 : order < 0;
}

/**
 * Fold the value `val` into the extremum `current` of `Max`/`Min`: return
 * the new extremum. A value that cannot be ordered against `current` is
 * pushed to `rest`, which stays in the unevaluated result, and `current` is
 * kept. This is the case for a complex number literal (complex numbers have
 * no order: `Max(i, 2)` and `Max(2, i)` both stay unevaluated) and for a
 * value whose order `exactOrder` does not decide. Discarding such a value
 * instead would make the result wrong.
 */
function foldExtremumValue(
  val: Expression,
  current: Expression | undefined,
  rest: Expression[],
  upper: boolean
): Expression | undefined {
  if (isNumber(val) && val.isComplex) {
    rest.push(val);
    return current;
  }
  if (current === undefined) return val;
  const replaces = extremumOrder(val, current, upper, true);
  if (replaces === undefined) rest.push(val);
  if (replaces !== true) return current;
  // A value that was not ordered against the previous extremum can be
  // ordered against the new one: in `Max(L, 0, 1)` with `L` near 0, `L`
  // cannot be ordered against 0, but it is less than 1. A value that the
  // new extremum is not less than is removed (`extremumOrder` is `false`).
  // A symbolic operand or a complex number is never ordered, and stays. A
  // collection that could not be folded stays too, and is not compared: the
  // comparison would subtract the value from each of its elements.
  for (let i = rest.length - 1; i >= 0; i--)
    if (
      rest[i].isCollection !== true &&
      extremumOrder(rest[i], val, upper) === false
    )
      rest.splice(i, 1);
  return val;
}

/**
 * Variadic element-wise extremum: left-fold {@link scalarExtremum} over the
 * operands (which the broadcasting machinery has already reduced to per-element
 * scalars). Intermediates stay exact; only the final result is numericized
 * under `numericApproximation`. Returns `undefined` (stay symbolic) if any
 * pairwise comparison is undecidable. Backs `ElementMax`/`ElementMin`.
 */
function foldExtremum(
  ops: ReadonlyArray<Expression>,
  upper: boolean,
  numericApproximation: boolean
): Expression | undefined {
  if (ops.length === 0) return undefined;
  let acc: Expression = ops[0];
  for (let i = 1; i < ops.length; i++) {
    const next = scalarExtremum(acc, ops[i], upper, false);
    if (next === undefined) return undefined;
    acc = next;
  }
  return numericApproximation ? acc.N() : acc;
}

function evaluateMinMax(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  mode: 'Min' | 'Max' | 'Supremum' | 'Infimum'
): Expression {
  const upper = mode === 'Max' || mode === 'Supremum';

  // The rule for an aggregate that consumes data: an absent datum (`Missing`
  // or `NaN`, as an operand or as an element at any depth) or an empty input
  // gives `NaN`. Both halves are decided by the ONE walk below:
  // `processMinMaxItem` reports an absent datum as a `NaN` value, and an input
  // that supplied no value and nothing symbolic is empty.
  ops = flatten(ops);

  let result: Expression | undefined = undefined;
  const rest: Expression[] = [];
  let sawIndeterminate = false;
  let sawNaN = false;
  const walk: ExtremumWalk = { inexact: false, machineLists: [] };

  for (const op of ops) {
    const [val, others] = processMinMaxItem(op, mode, walk);
    // An error (a dictionary operand or element) is the answer of the whole
    // extremum, as it is for `Sum`.
    if (isFunction(val, 'Error')) return val;
    if (val) {
      // NaN absorbs: Min/Max of an indeterminate value is indeterminate.
      // (Comparisons with NaN are themselves indeterminate, so without this
      // guard a NaN operand would be silently dropped.)
      // The `Indeterminate` literal absorbs as well, unless a `NaN` operand
      // is found later in the walk: `Max(1, Indeterminate)` is
      // `Indeterminate`, `Max(Indeterminate, NaN)` and
      // `Max(NaN, Indeterminate)` are `NaN`, and so is an extremum with an
      // inexact operand or element (`Max(1.5, Indeterminate)`), as a float
      // operand makes a numeric result a float
      // (`docs/plans/2026-09-28-indeterminate-value.md` §4).
      // The walk continues after a `NaN`, so that an error found in a later
      // operand (a dictionary) is the answer whatever the order of the
      // operands: `Max(NaN, d)` and `Max(d, NaN)` are both the error, as for
      // `Sum`.
      if (val.isNaN) {
        if (!val.isIndeterminate) sawNaN = true;
        else sawIndeterminate = true;
        continue;
      }
      if (isInexactOperand(val)) walk.inexact = true;
      result = foldExtremumValue(val, result, rest, upper);
    }
    rest.push(...others);
  }
  if (sawNaN) return ce.NaN;
  if (sawIndeterminate)
    return walk.inexact ||
      walk.machineLists.some(
        (list) => isFunction(list) && list.ops.some(isInexactOperand)
      )
      ? ce.NaN
      : ce.Indeterminate;

  if (rest.length > 0)
    return ce.expr(result ? [mode, result, ...rest] : [mode, ...rest]);
  // No orderable value and nothing left symbolic: every operand contributed no
  // data at all, i.e. the input was EMPTY. That is an absent result (`NaN`)
  // under the rule above, not an identity element — `Max([])` is not
  // `-Infinity`. The emptiness of a lazy collection (a `Filter` with no match)
  // is known only after a walk, so the verdict is read off the walk this
  // function just performed.
  if (result === undefined) return ce.NaN;
  return result;
}

function evaluateGcdLcm(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  mode: 'LCM' | 'GCD'
): Expression {
  const fn = mode === 'LCM' ? lcm : gcd;
  const bigFn = mode === 'LCM' ? bigLcm : bigGcd;

  // Zero-argument identities, consistent with the empty-collection case below:
  // `GCD() → 0`, `LCM() → 1`.
  if (ops.length === 0) return mode === 'LCM' ? ce.One : ce.Zero;

  // A finite collection operand contributes its elements: `gcd([12, 18]) → 6`,
  // `lcm([4, 6]) → 12` (a list argument is reduced, matching Desmos). Nested
  // collections are flattened by repeating the pass until no collection operand
  // remains (`gcd([[12, 18], 24]) → 6` in one evaluation). An infinite or
  // enumeration-declined collection would grind to the deadline or silently
  // vanish, so it stays symbolic instead (mirrors the Min/Max fold).
  //
  // TEXT is ATOMIC here and contributes ITSELF. A string is an indexed
  // collection of its grapheme clusters, so without this exclusion
  // `GCD("abc", 4)` would expand to `gcd(4, "a", "b", "c")`; the string falls
  // through to the non-integer arm below and leaves the call symbolic, which
  // is what it produced before strings became collections
  // (`docs/STRING_ROADMAP.md`, design constraint 5).
  const expandable = (x: Expression): boolean =>
    x.isCollection === true && !isTextAtom(x);
  if (ops.some(expandable)) {
    let ok = true;
    let current: Expression[] = [...ops];
    while (ok && current.some(expandable)) {
      const expanded: Expression[] = [];
      for (const op of current) {
        if (expandable(op)) {
          if (op.isFiniteCollection !== true) {
            ok = false;
            break;
          }
          // Decline read off this walk, not probed before it: a probe starts a
          // second enumeration and re-runs a lazy element callback.
          let walked = 0;
          for (const el of op.each()) {
            walked += 1;
            expanded.push(el);
          }
          if (enumerationDeclinedAfterWalk(op, walked)) {
            ok = false;
            break;
          }
        } else expanded.push(op);
      }
      if (ok) current = expanded;
    }
    if (ok) {
      if (current.length === 0) return mode === 'LCM' ? ce.One : ce.Zero;
      ops = current;
    }
  }

  // A `NaN` operand propagates. Both branches below defer a non-integer,
  // non-finite operand to the symbolic tail, so without this arm `gcd(NaN, 2)`
  // came back as itself — inertness as the terminal answer to a decided
  // question, which `docs/ERROR-MODEL.md` §1 forbids. GCD/LCM take a numeric
  // carrier and answer a number, which is the condition for the derived
  // `propagate` NaN policy of §4.
  if (ops.some((x) => x.isNaN === true)) return ce.NaN;

  // Exactness contract: an inexact (float) argument numericizes, like
  // `cos(5.1) → 0.377`. GCD/LCM of non-integer reals fold via the tolerant
  // floating Euclidean algorithm (`realGcd`/`realLcm`, ε = REAL_GCD_TOLERANCE).
  // Applies only when every operand is a finite real number and at least one is
  // inexact; exact integers/rationals and symbolic operands keep their
  // exact/symbolic paths.
  if (
    ops.length > 0 &&
    ops.some((x) => isNumber(x) && !x.isExact) &&
    ops.every((x) => isNumber(x) && Number.isFinite(x.re) && !x.isComplex)
  ) {
    const rfn = mode === 'LCM' ? realLcm : realGcd;
    let acc = Math.abs(ops[0].re);
    for (let i = 1; i < ops.length; i++) acc = rfn(acc, ops[i].re);
    // The result is a float, even when its value is an integer:
    // `GCD(4.0, 6)` is the float `2`. (Mathematica refuses the GCD of a
    // real number; the float reading keeps the result a number.)
    return ce.number(ce._inexactNumericValue(acc));
  }

  const rest: Expression[] = [];
  if (bignumPreferred(ce)) {
    let result: BigDecimal | null = null;
    for (const op of ops) {
      if (result === null) {
        // Seed the accumulator with the first integer operand; defer the rest.
        // GCD/LCM are non-negative, so seed with the magnitude.
        const d = asBignum(op);
        if (d !== null && d.isInteger()) result = d.abs();
        else rest.push(op);
      } else {
        const d = asBignum(op);
        if (d && d.isInteger()) result = bigFn(result, d);
        else rest.push(op);
      }
    }

    // The GCD or LCM of exact integers is an exact integer at any magnitude
    // (`ce.number()` of an integer-valued big decimal). Float operands took
    // the `realGcd`/`realLcm` branch above.
    if (rest.length === 0) return result === null ? ce.One : ce.number(result);
    if (result === null) return ce._fn(mode, rest);
    return ce._fn(mode, [ce.number(result), ...rest]);
  }

  let result: number | null = null;
  for (const op of ops) {
    if (result === null) {
      // Seed the accumulator with the first integer operand; defer the rest.
      // GCD/LCM are non-negative, so seed with the magnitude.
      if (op.isInteger) result = Math.abs(op.re);
      else rest.push(op);
    } else {
      if (op.isInteger) result = fn(result, op.re);
      else rest.push(op);
    }
  }
  if (rest.length === 0) return result === null ? ce.One : ce.number(result);
  if (result === null) return ce._fn(mode, rest);
  return ce._fn(mode, [ce.number(result), ...rest]);
}

/**
 * The numeric value of `num / den`, where `num` and `den` are the operands
 * after a numeric evaluation, and one of them is a real float literal whose
 * value is 0 or ±∞. `originals` are the operands before the evaluation.
 *
 * Each such operand is replaced by the exact value of its original when the
 * original is pure and evaluates to an exact, non-zero, real number. The
 * quotient is then computed with the numeric values, which use the
 * big-decimal value of an exact operand whose double is out of range.
 *
 * Returns `undefined` when no operand has such an exact value, or when an
 * operand is not a real number literal. The caller then divides as usual.
 */
function divideFromExactValues(
  ce: ComputeEngine,
  originals: ReadonlyArray<Expression> | undefined,
  operands: [Expression, Expression]
): Expression | undefined {
  if (originals?.length !== 2) return undefined;
  let rescued = false;
  const values: NumericValue[] = [];
  for (let i = 0; i < 2; i++) {
    let x = operands[i];
    const exact = exactValueOutOfDoubleRange(ce, originals[i], x);
    if (exact !== undefined) {
      x = exact;
      rescued = true;
    }
    if (!isNumber(x) || x.isComplex) return undefined;
    const nv = x.numericValue;
    values.push(typeof nv === 'number' ? ce._numericValue(nv) : nv);
  }
  if (!rescued) return undefined;
  return ce.number(values[0].div(values[1])).N();
}

/**
 * The exact value of `original`, when `value` (the numeric value of
 * `original`) is a real literal outside the normal double range (0, ±∞, NaN
 * or subnormal, see `isOutOfDoubleRangeLiteral()`), while the exact value is
 * a finite number that is not zero. Otherwise, `undefined`.
 *
 * At machine precision, a numeric evaluation gives a double, and the double
 * of `10^{-401}` is 0 and the double of `10^{401}` is +∞. An operation with
 * this operand must then use its exact value: `\sqrt{10^{-401}}` is about
 * `3.16e-201`, not 0. Only a pure `original` is evaluated again. An engine
 * whose numeric values are big decimals does not have this limit.
 *
 * The usual operand costs one comparison.
 */
function exactValueOutOfDoubleRange(
  ce: ComputeEngine,
  original: Expression | undefined,
  value: Expression
): Expression | undefined {
  if (!isOutOfDoubleRangeLiteral(value)) return undefined;
  if (original === undefined || original.isPure !== true) return undefined;
  if (bignumPreferred(ce)) return undefined;
  const exact = isNumber(original) ? original : original.evaluate();
  if (
    !isNumber(exact) ||
    !exact.isExact ||
    exact.isFinite !== true ||
    exact.isSame(0)
  )
    return undefined;
  return exact;
}

/**
 * Replace a factor of a numeric product by its exact value when the
 * coefficient of its numeric value is 0, ±∞ or subnormal. `ops` are the
 * factors before the evaluation, `factors` the factors that go to
 * `mulNEvaluated()`, and `raw[i]` is true when `factors[i]` is not evaluated
 * yet.
 *
 * At machine precision, the numeric value of `10^{400}/y` is `∞ · (1/y)`,
 * because the float of its exact coefficient `10^{400}` is ∞. In the product
 * `(10^{400}/y) · 10^{-399}`, the exact coefficient must be folded with the
 * other number factors before it becomes a float: the result is then `10/y`,
 * not `∞ · 0 · (1/y) = NaN`. The replaced factor stays marked as evaluated,
 * so it goes to `mulNEvaluated()` with its exact coefficient, and
 * `mulNEvaluated()` folds this coefficient with the number factors and
 * floats the product: `(10^{400}/y) · 2` is `∞ · (1/y)`. Only a pure factor
 * is evaluated again. An engine whose numeric values are big decimals does
 * not have this limit.
 *
 * The usual product costs one scan of the factors.
 */
function rescueExactCoefficients(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  factors: Expression[],
  raw: ReadonlyArray<boolean>
): void {
  const hasOutOfRangeCoefficient = (x: Expression): boolean =>
    isFunction(x) &&
    (x.operator === 'Multiply' || x.operator === 'Divide') &&
    isOutOfDoubleRangeLiteral(x.ops[0]);
  if (!factors.some((x, i) => !raw[i] && hasOutOfRangeCoefficient(x))) return;
  if (bignumPreferred(ce)) return;
  for (let i = 0; i < factors.length; i++) {
    if (raw[i] || !hasOutOfRangeCoefficient(factors[i])) continue;
    if (ops[i].isPure !== true) continue;
    const exact = ops[i].evaluate();
    if (
      isFunction(exact) &&
      (exact.operator === 'Multiply' || exact.operator === 'Divide') &&
      isNumber(exact.ops[0]) &&
      exact.ops[0].isExact
    )
      factors[i] = exact;
  }
}

/** The operand `i` of `expression` before its evaluation, if any. */
function operandOf(
  expression: Expression | undefined,
  i: number
): Expression | undefined {
  return expression !== undefined && isFunction(expression)
    ? expression.ops[i]
    : undefined;
}

/**
 * The big-decimal value of `x`, when `x` is a real finite number literal.
 * The big-decimal value of an exact value keeps a magnitude that its double
 * cannot hold (`10^{400}`). Otherwise, `undefined`.
 */
function bigRealOf(x: Expression | undefined): BigDecimal | undefined {
  if (x === undefined || !isNumber(x)) return undefined;
  const nv = x.numericValue;
  if (typeof nv === 'number')
    return Number.isFinite(nv) ? new BigDecimal(nv) : undefined;
  if (nv.isComplex) return undefined;
  const big = nv.bignumRe ?? new BigDecimal(nv.re);
  return big.isFinite() ? big : undefined;
}

/**
 * The floored remainder of `a` by `b` computed with the float lanes of
 * `apply2()` (machine or big decimal). In JavaScript, `%` is the truncated
 * remainder, so it is adapted to a floored modulo: the sign of the result
 * follows the divisor, as in the exact paths of the `Mod` handler. The
 * double lane adds the divisor only when it is needed (`floorModDouble`);
 * the big-decimal lane always adds it, which is safe because
 * `BigDecimal.add()` is exact.
 */
function floorModFloat(a: Expression, b: Expression): Expression | undefined {
  return apply2(a, b, floorModDouble, (a, b) => a.mod(b).add(b).mod(b));
}
