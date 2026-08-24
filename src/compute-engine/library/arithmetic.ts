import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';

import {
  checkType,
  checkTypes,
  checkNumericArgs,
  nonNumericOperandError,
} from '../boxed-expression/validate.js';
import {
  evidenceAdmissionOf,
  heldNonNumericScalar,
} from '../boxed-expression/value-membership.js';
import { bignumPreferred } from '../boxed-expression/utils.js';
import { polynomialGCDMulti } from '../boxed-expression/polynomials.js';
import {
  asSmallInteger,
  asRational,
  asBignum,
  asBigint,
  toBigint,
  toInteger,
  provablyNonFiniteNumber,
} from '../boxed-expression/numerics.js';
import { addOrder } from '../boxed-expression/order.js';
import { reduceModulo } from '../boxed-expression/modular-arithmetic.js';

import {
  apply,
  apply2,
  applyN,
  shouldNumericize,
  isExactNumber,
} from '../boxed-expression/apply.js';
import { flatten } from '../boxed-expression/flatten.js';

import {
  gamma as gammaComplex,
  gammaln as lngammaComplex,
  incompleteGammaUpperComplex,
} from '../numerics/numeric-complex.js';
import {
  factorial2 as bigFactorial2,
  gcd as bigGcd,
  lcm as bigLcm,
} from '../numerics/numeric-bignum.js';
import { factorial as bigFactorial } from '../numerics/numeric-bigint.js';
import {
  zetaEvenCoefficient,
  zetaNegativeInteger,
} from '../numerics/bernoulli.js';
import {
  gamma,
  gammaln,
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
import { factorial2, gcd, lcm, realGcd, realLcm } from '../numerics/numeric.js';
import { rationalize } from '../numerics/rationals.js';
import { isPrime } from '../boxed-expression/predicates.js';

import {
  canonicalAdd,
  add,
  addType,
  addN,
  absorbScalarsIntoCells,
} from '../boxed-expression/arithmetic-add.js';
import {
  mulFactored,
  mulN,
  canonicalDivide,
} from '../boxed-expression/arithmetic-mul-div.js';
import { indexingSetSites } from '../boxed-expression/binding-sites.js';
import {
  evaluateBigOpTerm,
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
  pointNormType,
  euclideanNormType,
} from './utils.js';
import { inferContinuationPattern } from '../symbolic/interpret.js';
import {
  canonicalPower,
  canonicalRoot,
  pow,
  realPowerBranchTerms,
  root,
} from '../boxed-expression/arithmetic-power.js';
import {
  broadcastResultType,
  collectionElementType,
  isNonRealNumber,
  negateNumericType,
  nonNegativeRangeType,
  positiveRangeType,
  resolveTypeAlias,
  stripNumericRanges,
  widen,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  negativeSign,
  nonNegativeSign,
  nonPositiveSign,
  positiveSign,
} from '../boxed-expression/sgn.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import type { Type } from '../../common/type/types.js';
import {
  numericTypeHandler,
  elementaryFunctionType,
  gammaPoleType,
  absFunctionType,
  operandIsEven,
  operandIsOdd,
  operandLiteralValue,
  operandSgn,
} from './type-handlers.js';
// The `'types'`-shape twins of the helpers above: they take one
// `OperandDescriptor` per operand instead of the operand expression, and are
// wired to the definitions that declare `typeHandlerKind: 'types'`. The two
// modules export the same names on purpose (a converted call site otherwise
// changes only its import path), so the twins are aliased with an `OnTypes`
// suffix here to keep both shapes readable side by side while the migration
// runs.
import {
  realOnlyStepType,
  numericTypeHandler as numericTypeHandlerOnTypes,
  extremumType as extremumTypeOnTypes,
  roundingFunctionType as roundingFunctionTypeOnTypes,
  measurementType as measurementTypeOnTypes,
  bigOpResultType as bigOpResultTypeOnTypes,
  operandLiteralValue as operandLiteralValueOnTypes,
} from './type-handlers-types.js';
import { parseType } from '../../common/type/parse.js';

// The proven-real result claims of the two step functions, parsed once at
// module load. `Heaviside` takes exactly the values 0, 1/2 and 1 on the
// real line (H(0) = 1/2 is this engine's convention) and `Sign` exactly
// −1, 0 and 1, so each claim is the finitely-valued tier WITH its range —
// the range is what lets a type-channel consumer (`signOfType`, compile
// lowerings) read the sign and bounds without consulting the sgn handler.
const HEAVISIDE_REAL_TYPE = parseType('finite_rational<0..1>');
const SIGN_REAL_TYPE = parseType('finite_integer<-1..1>');
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
} from '../../common/interruptible.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  SymbolDefinitions,
  Sign,
} from '../global-types.js';
import {
  isNumber,
  isFunction,
  isString,
  isCharacter,
  isSymbol,
  isContinuationOperand,
} from '../boxed-expression/type-guards.js';
import { canonical } from '../boxed-expression/canonical-utils.js';
import { aggregateAbsence } from './missing-data.js';
import { expand } from '../boxed-expression/expand.js';
import {
  couldBeNumericTuple,
  typeCouldBeNumericTuple,
  typeCouldBeNumericTupleCollection,
  isLinearAlgebraCollection,
  isBroadcastCollectionType,
  broadcastSiblingType,
  broadcastCollectionElementType,
  isDeclaredScalarNumber,
  isPossiblyCollectionTyped,
  broadcastableResultTypeOf,
  isTextAtom,
  isTuple,
} from '../collection-utils.js';
import { isTensorValue } from '../boxed-expression/tensor-view.js';
import { signFromAssumedPart } from './complex.js';

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

/** Determines sgn of ln(x) */
function lnSign(x: Expression): Sign | undefined {
  if (x.isGreater(1)) return 'positive';
  if (x.isGreaterEqual(1)) return 'non-negative';
  if (x.isLessEqual(1) && x.isGreaterEqual(0)) return 'non-positive';
  if (x.isLess(1) && x.isGreaterEqual(0)) return 'negative';
  if (x.isSame(1)) return 'zero';
  if (x.isNegative || x.isReal === false) return 'unsigned';
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
 * real value) returns `false`, so the caller keeps its honest `finite_number`
 * hedge rather than over-claiming complex.
 */
function negativeBaseIsComplexBranch(exp: Expression): boolean {
  // `=== true` / `=== false`: a symbolic operand has `isReal`/`isInteger ===
  // undefined, which must not be read as a proof either way.
  if (exp.isReal !== true || exp.isInteger !== false) return false;

  // The exponent's exact (reduced) denominator when it has one, otherwise the
  // float reconstruction — `realPowerBranchTerms` is the single source of the
  // branch decision, shared with the numeric path and the compiled constant
  // fold so type, `.N()` and compiled code cannot tell different stories.
  // A literal exponent's value also travels in its handler-visible type
  // (`operandLiteralValue`), which is the channel that survives when the
  // value reads are unavailable.
  const re = operandLiteralValue(exp) ?? exp.re;
  const terms = realPowerBranchTerms(asRational(exp), re);
  // No trustworthy rational is a PROOF of the complex branch, not an absence of
  // information — but only once the exponent has a definite value. A known
  // real non-integer with a finite value that is not an odd-denominator
  // rational takes the principal complex value, which is exactly what `.N()`
  // returns; reading `undefined` as "unknown" here made the type disagree with
  // the value (`(−2)^0.3333333333` typed `finite_number`, and the compiler
  // lowered it to a real `Math.pow` that yields NaN). An exponent with no
  // finite value — `Ln(2)`, a free symbol — still hedges.
  if (terms === undefined) return Number.isFinite(re);
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
 * `tuple<finite_integer, finite_integer> / finite_integer` claimed INTEGER
 * components where `[6,2]/4 = [3/2,1/2]` is rational — is exactly what this
 * widening removes.
 */
function quotientComponentType(el: Type, den: Expression): Type {
  // The handler checks `isNaN`/`isSame(0)` before its shape branches only for
  // the NUMERATOR side of those guards; re-check the denominator here so the
  // helper's per-component parity with the scalar path does not depend on
  // call order.
  if (den.isNaN || den.isSame(0)) return 'number';
  if (provablyNonFiniteNumber(den)) {
    // The scalar path's symmetric claim: a provably finite real component
    // over a provably non-finite REAL denominator is exactly 0.
    if (isSubtype(el, 'finite_real') && den.isReal === true)
      return 'finite_integer';
    return 'number';
  }
  if (den.isInteger && isSubtype(el, 'integer')) return 'finite_rational';
  if (den.isReal && isSubtype(el, 'real')) return 'finite_real';
  if (den.type.matches('finite_complex') && isSubtype(el, 'finite_complex'))
    return 'finite_complex';
  return 'finite_number';
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
function quotientShapeType(t: Type, den: Expression): Type {
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
function divisorKeepsNumeratorShape(den: Expression): boolean {
  if (couldBeNumericTuple(den)) return false;
  const dt = den.type.type;
  if (typeCouldBeNumericTupleCollection(dt)) return false;
  if (
    typeof dt !== 'string' &&
    dt.kind === 'broadcastable' &&
    typeCouldBeNumericTuple(dt.elements)
  )
    return false;
  return !den.type.matches('matrix');
}

/**
 * True when a type statically carries a SHAPE a quotient must preserve: a
 * tuple, a list/collection kind, or a broadcast lift of one.
 * `broadcastable<number>` is NOT shaped — its runtime value may be a plain
 * scalar, which is precisely why the lift exists.
 *
 * Used by the `Divide` type handler on both sides: a shaped (or
 * broadcast-lifted shaped) NUMERATOR keeps its structure with widened
 * components, while a shaped or possibly-shaped DENOMINATOR disqualifies that
 * claim (`tuple / tuple` has no defined quotient — `canonicalDivide` rejects
 * it — so the handler falls through to the scalar widening instead).
 */
function isShapedNumericType(t: Type): boolean {
  if (typeof t === 'string')
    return (
      t === 'tuple' ||
      t === 'list' ||
      t === 'collection' ||
      t === 'indexed_collection' ||
      t === 'set'
    );
  if (t.kind === 'union') return t.types.some((a) => isShapedNumericType(a));
  if (t.kind === 'broadcastable') return isShapedNumericType(t.elements);
  return (
    t.kind === 'tuple' ||
    t.kind === 'list' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'set'
  );
}

/**
 * The type of a numeric tuple scaled by scalar factors: each NUMERIC component
 * widened by the factors' types (`tuple<finite_integer, finite_integer>`
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
  if (typeof t === 'string' || t.kind !== 'tuple' || scalarTypes.length === 0)
    return t as Type;
  // Range decorations are stripped on BOTH sides of the join: a scaled
  // component does not lie in the union of the component's and the
  // factors' ranges (see `stripNumericRanges`).
  const factors = scalarTypes.map((x) => stripNumericRanges(x));
  return {
    kind: 'tuple',
    elements: t.elements.map((e) =>
      isSubtype(e.type, 'number')
        ? { ...e, type: widen(stripNumericRanges(e.type), ...factors) as Type }
        : e
    ),
  };
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
      signature: '(number) -> real',
      // `isTuple` (type-based, follows symbol value bindings), not an
      // `operator === 'Tuple'` check: a tuple-TYPED symbol or lambda
      // parameter is a point too, even without a literal `Tuple` node.
      type: ([x]) => (x && isTuple(x) ? pointNormType(x) : absFunctionType(x)),
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
      idempotent: true,
      complexity: 1300,

      lazy: true,

      // Accept numbers, vectors, and matrices for element-wise addition
      signature: '(value+) -> value',
      // The `value`-typed signature would default to `pass-through`; declare
      // `propagate` so an absent operand yields `NaN` (every cell `Add`
      // computes on is numeric — §3.A/§5 of the missing-value typing design).
      missingBehavior: 'propagate',
      type: addType,

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
      evaluate: (ops, { numericApproximation, engine }) => {
        // Ellipsis fold barrier: an `Add` with a direct `ContinuationPlaceholder`
        // operand is a notational object; leave it unchanged rather than summing
        // across the elided terms.
        if (ops.some((x) => isContinuationOperand(x))) return undefined;
        // `Add` is `lazy`, so the driver did NOT evaluate the operands —
        // this map is the (single) operand evaluation, not a re-evaluation.
        const evaluated = ops.map((x) => x.evaluate());
        const nonNumeric = nonNumericOperandError(engine!, evaluated);
        if (nonNumeric !== undefined) return nonNumeric;
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
        // For an IMPURE operand, pass its evaluated form: re-evaluating it
        // inside `addN`'s numericization would repeat its side effects — a
        // framed `Random()` consumed two draw indices under `N()` and one
        // under `evaluate()`, breaking the draw-consumption contract. An
        // impure operand evaluates to a drawn VALUE (literals), which is safe
        // to hand on. A PURE operand keeps the raw path: its re-evaluation is
        // free of side effects, `addN`'s number-literal gate keeps fractions
        // exact until the final fold (late rounding, e.g.
        // `\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}`),
        // and — decisive — a SELF-REFERENTIAL frame binding (`t → t + 1`,
        // Tycho item 46) makes the pure operand's evaluated form loop, both
        // through this handler's re-entry and through the type-level
        // `isFinite` → value → `type` cycle; the substitute-once guard lives
        // on the raw symbol's own `.N()` path.
        if (numericApproximation) {
          const r = addN(
            ...ops.map((op, i) => (op.isPure ? op : evaluated[i]))
          );
          // An operand may only have BECOME a Quantity or Measurement through
          // `addN`'s numericization, past the `evaluated` checks above
          // (Tycho item 101). Quantity first, matching the handler precedence.
          return (
            foldQuantityOperands(engine!, r) ??
            foldMeasurementOperands(engine!, r) ??
            r
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
        return result;
      },
    },

    Ceil: {
      description: 'Rounds a number up to the next largest integer',
      keywords: ['round up', 'ceiling'],
      complexity: 1250,
      broadcastable: true,
      signature: '(number) -> integer',
      typeHandlerKind: 'types',
      type: ([x]) => roundingFunctionTypeOnTypes(x),
      sgn: ([x]) => {
        if (x.isLessEqual(-1)) return 'negative';
        if (x.isPositive) return 'positive';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive && x.isGreater(-1)) return 'zero';
        if (x.isNonPositive) return 'non-positive';
        // Component-wise ceiling of a complex: real result iff ⌈im⌉ = 0
        // (im ∈ (-1, 0]), and then the sign is that of ⌈re⌉ — not of re
        // itself (⌈-0.5 - 0.5i⌉ = 0, not negative).
        if (x.isReal == false && isNumber(x))
          return x.im! > 0 || x.im! <= -1
            ? 'unsigned'
            : numberSgn(Math.ceil(x.re)); //.re and .im should be more general.
        return undefined;
      },
      evaluate: ([x]) =>
        apply(
          x,
          Math.ceil,
          (x) => x.ceil(),
          (z) => z.ceil(0)
        ),
    },

    Chop: {
      description: 'Replace tiny numeric values with zero.',
      associative: true,
      broadcastable: true,
      idempotent: true,
      complexity: 1200,

      signature: '(T) -> T where T: number',
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
    },

    Divide: {
      description: 'Quotient of a numerator and one or more denominators.',
      wikidata: 'Q1226939',
      complexity: 2500,
      broadcastable: true,

      // - if numer product of numbers, or denom product of numbers,
      // i.e. √2x/2 -> 0.707x, 2/√2x -> 1.4142x
      signature: '(number, number+) -> number',
      type: ([num, den]) => {
        if (den.isSame(1)) return num.type;
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
        // reason `Multiply` hoists its tuple branch: a tuple's `isFinite` is
        // `false`, which would otherwise collapse it to `number`.
        // COULD-semantics on the numerator, while the denominator must be one
        // a shape-preserving quotient can divide by at all — see
        // `divisorKeepsNumeratorShape`, which rules out every divisor that can
        // present a TUPLE (`tuple / tuple` has no defined quotient and
        // `canonicalDivide` rejects it) as well as a matrix, which the value
        // path leaves inert. The STRUCTURE is preserved but
        // the components are NOT echoed: each is widened through
        // `quotientComponentType`, which applies the same tier rules as the
        // scalar branches below — echoing claimed integer components for
        // `tuple<finite_integer, …> / finite_integer` where the quotient is
        // rational (`[6,2]/4 = [3/2,1/2]`).
        if (couldBeNumericTuple(num) && divisorKeepsNumeratorShape(den))
          return quotientShapeType(num.type.type, den);
        // The ELEMENTWISE counterpart of the branch above (Tycho item 209): a
        // COLLECTION whose elements are numeric tuples — a point LIST, e.g.
        // the `N = P / l(P)` a Desmos document writes to normalize a set of
        // points — divides component-wise INSIDE each element, so the
        // quotient's elements stay tuples. Without this branch the scalar
        // widening below claimed `finite_number`, and the broadcast wrapper in
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
          typeCouldBeNumericTupleCollection(num.type.type) &&
          divisorKeepsNumeratorShape(den)
        )
          return quotientShapeType(num.type.type, den);
        // The broadcast-lifted counterpart, one wrapper out (Tycho item 188):
        // a numerator typed `broadcastable<vector<n>>` — a vector-valued call
        // whose arguments' collection-ness is not statically knowable, e.g. a
        // document row above its callees' definitions — reports
        // `isFinite === false` like the tuple above, so without this branch it
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
          const nt = num.type.type;
          if (
            typeof nt !== 'string' &&
            nt.kind === 'broadcastable' &&
            isShapedNumericType(nt.elements) &&
            !isShapedNumericType(den.type.type)
          )
            return {
              kind: 'broadcastable',
              elements: quotientShapeType(nt.elements, den),
            };
        }
        if (den.isNaN || num.isNaN) return 'number';
        // Division by zero: k/0 = ~oo, 0/0 = NaN — indeterminate.
        if (den.isSame(0)) return 'number';
        // A non-finite operand: `x/±∞ = 0`, `±∞/finite = ±∞`, but `∞/∞`,
        // `∞/i`, `i/∞` give NaN/~oo. Operands like `Ln(0)`, or a symbol
        // declared `non_finite_number`, have no value to probe: `isFinite`
        // consults the static type on that path (see `BoxedFunction`/
        // `BoxedSymbol` `isInfinity`), so it decides them too.
        const nonFinite = (x: Expression) => provablyNonFiniteNumber(x);
        if (nonFinite(den) || nonFinite(num)) {
          // Ruling 2026-08-03 (mirrors the Multiply handler): a provably
          // non-finite REAL numerator over a provably finite, real, provably
          // non-zero denominator is `real ±∞ / finite non-zero real = ±∞`. The
          // non-finite numerator needs no proven sign of its own (`±∞ ≠ 0` is
          // a theorem); the denominator keeps the full obligation. `isReal` is
          // required on both — `∞/i = ~oo` is not `non_finite_number`. The
          // denominator must be provably finite (`isFinite === true`), not
          // merely "not provably infinite": unknown finiteness admits `∞/∞`,
          // which is NaN.
          if (
            nonFinite(num) &&
            num.isReal === true &&
            den.isFinite === true &&
            den.isReal === true
          ) {
            const s = operandSgn(den);
            if (s === 'positive' || s === 'negative' || s === 'not-zero')
              return 'non_finite_number';
          }
          // The symmetric claim: a provably finite, real numerator over a
          // provably non-finite REAL denominator is exactly `0`. Both `isReal`
          // obligations are load-bearing: `i/∞` and `x/~oo` are not `0`, and
          // an unknown-finiteness numerator admits `∞/∞` = NaN.
          if (
            num.isFinite === true &&
            num.isReal === true &&
            nonFinite(den) &&
            den.isReal === true
          )
            return 'finite_integer';
          // Every other non-finite configuration (`∞/∞`, `∞/i`, `i/∞`, an
          // unknown-finiteness numerator or denominator) widens to the top
          // type.
          return 'number';
        }
        if (den.isInteger && num.isInteger) return 'finite_rational';
        if (den.isReal && num.isReal) return 'finite_real';
        // Real/pure-imaginary quotients (mirrors the Multiply type handler;
        // `imaginary`-typed operands are non-zero and non-real by type —
        // `imaginary ∩ real = nothing` in the lattice, and 0 is real):
        // - i/i → real; i/r → pure imaginary; r/i → pure imaginary iff
        //   r ≠ 0 (0/i = 0, which is real, NOT `imaginary`).
        // Possibly-zero *denominators* are treated like the real/real branch
        // above (which claims `finite_real` even when `den` may be 0): only
        // a literal 0 denominator (caught earlier) yields the top type.
        {
          const isImag = (x: Expression) => x.type.matches('imaginary');
          if (isImag(num) && isImag(den)) return 'finite_real';
          if (isImag(num) && den.isReal === true) return 'imaginary';
          if (num.isReal === true && isImag(den)) {
            const s = num.sgn;
            return s === 'positive' || s === 'negative' || s === 'not-zero'
              ? 'imaginary'
              : 'finite_complex';
          }
          // A quotient of finite complex operands is a finite complex number.
          if (
            num.type.matches('finite_complex') &&
            den.type.matches('finite_complex')
          )
            return 'finite_complex';
        }
        return 'finite_number';
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

      canonical: (args, { engine }) => {
        const ce = engine;
        // @fastpath: this code path is never taken, canonicalDivide is called directly
        args = checkNumericArgs(ce, args);
        let result = args[0];
        if (result === undefined) return ce.error('missing');
        if (args.length < 2) return result;

        const rest = args.slice(1);
        for (const x of rest) result = canonicalDivide(result, x);

        return result;
      },
      evaluate: ([num, den], { numericApproximation, engine }) => {
        // Non-lazy operator: operands arrive already evaluated by the
        // driver (`_computeValue` step 4) — do not re-evaluate them.
        const nonNumeric = nonNumericOperandError(engine!, [num, den]);
        if (nonNumeric !== undefined) return nonNumeric;
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
        const res = num.div(den);
        if (numericApproximation && res.operator !== 'Divide') return res.N();
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

      signature: '(number) -> number',
      // Because it gets canonicalized to Power, the sgn handler is not called
      // sgn: ([x]) => {
      //   if (
      //     (x.isNumberLiteral && x.re === -Infinity) ||
      //     (x.isNegative && x.isInfinity)
      //   )
      //     return 'zero';
      //   if (x.isReal == false && x.isNumberLiteral) {
      //     let n = chop(1 - x.im! / Math.PI) + 1;
      //     return n % 1 !== 0
      //       ? 'unsigned'
      //       : n % 2 === 0
      //         ? 'positive'
      //         : 'negative';
      //   }
      //   if (x.isReal || (x.isInfinity && x.isPositive)) return 'positive';
      //   return undefined;
      // },
      // Exp(x) -> e^x
      canonical: (args, { engine }) => {
        // The canonical handler is responsible for arg validation
        args = checkNumericArgs(engine, args, 1);
        // An arity/type error stays on the inert head: splicing the flagged
        // args into `Power` would produce a malformed 3-operand `Power` with
        // a double-wrapped error (cf. the `Rational` guard).
        if (args.length !== 1 || !args.every((x) => x.isValid))
          return engine._fn('Exp', args);
        return engine.function('Power', [engine.E, ...args]);
      },
    },

    Exp2: {
      description: 'Base-2 exponential: 2^x',
      complexity: 3500,
      broadcastable: true,
      signature: '(number) -> number',
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
      // `Factorial(i)` (complex) instead of the unsound `finite_integer`.
      signature: '(number) -> number',
      // NOT yet converted to the `'types'` handler shape, deliberately: the
      // negative-integer branch below widens the claim to `number` on the
      // Γ(x+1) pole, and on a COMPOUND operand that negative sign can come
      // from an operator `sgn` handler (`Negate(Floor(Abs(r)))`, whose result
      // type is a bare `finite_integer`) — a channel the operand descriptors
      // deliberately do not carry, their sign being type-derived only.
      // Converting today would claim `finite_real` where this handler proves
      // the pole and answers `number` — a type claim NARROWER than before,
      // which is never acceptable (a narrower claim can be an unsound
      // over-claim, where a wider one only loses precision). Same hold as
      // `binomialType` (`library/combinatorics.ts`) and `gammaPoleType`
      // (`library/type-handlers-types.ts`, where the hold note lives on the
      // twin); it
      // lifts when the audited sign channel for function expressions lands
      // (open item O7 of
      // `docs/plans/2026-08-22-type-handlers-on-types.md`).
      type: ([x]) => {
        const s = x ? operandSgn(x) : undefined;
        // A non-negative integer factorial is a (finite) positive integer.
        if (x?.isInteger === true && nonNegativeSign(s) === true)
          return 'finite_integer';
        // A *negative* integer is a pole of Γ(x+1): the value is `~oo`,
        // representable only by `number` (non-finite typing convention).
        if (x?.isInteger === true && negativeSign(s) === true) return 'number';
        // Otherwise it is Γ(x+1); type it like `Gamma`.
        return numericTypeHandler([x]);
      },

      // x! = Γ(x+1): positive for x ≥ 0; a pole (~oo) at negative integers.
      // For a negative NON-integer the value is real with alternating sign
      // between consecutive poles (Γ(1/2) = √π > 0, Γ(-1/2) < 0), so no
      // uniform claim is possible.
      sgn: ([x]) =>
        x.isNonNegative
          ? 'positive'
          : (x.isNegative && x.isInteger) || x.isReal === false
            ? 'unsigned'
            : undefined,
      canonical: (args, { engine }) => engine._fn('Factorial', [args[0]]),
      evaluate: ([x]) => {
        const ce = x.engine;

        // If argument is symbolic (not a number literal), keep unevaluated
        if (!isNumber(x)) return undefined;

        // Is the argument a complex number?
        if (x.im !== 0 && x.im !== undefined)
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
        try {
          return ce.number(
            run(
              bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
              ce._timeRemaining,
              ce._deadlineFrame
            )
          );
        } catch (e) {
          if (e instanceof CancellationError) throw e;
          // We can get here if the factorial is too large
          return undefined;
        }
      },
      evaluateAsync: async ([x], { signal }) => {
        const ce = x.engine;

        // If argument is symbolic (not a number literal), keep unevaluated
        if (!isNumber(x)) return undefined;

        // Is the argument a complex number?
        if (x.im !== 0 && x.im !== undefined)
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

        try {
          return ce.number(
            await runAsync(
              bigFactorial(BigInt((x.bignumRe ?? x.re).toFixed())),
              (ce._deadline ?? Infinity) - Date.now(),
              signal,
              ce._deadlineFrame
            )
          );
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
      // pattern rather than `(integer) -> integer`.
      signature: '(number) -> number',
      // NOT yet converted to the `'types'` handler shape, for the same reason
      // as `Factorial` above: the negative-integer branch widens the claim to
      // `number`, and on a COMPOUND operand that negative sign is only an
      // operator `sgn` handler's to prove — a channel the operand descriptors
      // do not carry. Converting today would answer `finite_real` where this
      // handler answers `number`, i.e. a NARROWER claim, which is never
      // acceptable. Lifts with open item O7 of
      // `docs/plans/2026-08-22-type-handlers-on-types.md`.
      type: ([x]) => {
        const s = x ? operandSgn(x) : undefined;
        if (x?.isInteger === true && nonNegativeSign(s) === true)
          return 'finite_integer';
        if (x?.isInteger === true && negativeSign(s) === true) return 'number';
        return numericTypeHandler([x]);
      },
      // Positive for x ≥ 0; NaN at negative integers (see evaluate). A
      // negative non-integer stays symbolic (its continuation value can be a
      // positive real, e.g. (-1/2)!!), so make no claim.
      sgn: ([x]) =>
        x.isNonNegative
          ? 'positive'
          : (x.isNegative && x.isInteger) || x.isReal === false
            ? 'unsigned'
            : undefined,
      evaluate: (ops) => {
        // 2^{\frac{n}{2}+\frac{1}{4}(1-\cos(\pi n))}\pi^{\frac{1}{4}(\cos(\pi n)-1)}\Gamma\left(\frac{n}{2}+1\right)

        const x = ops[0];
        // The double factorial of a non-integer is an exact constant with no
        // simple closed form here, so stay symbolic rather than rounding the
        // argument to an integer (which non-strict mode would otherwise allow).
        if (x.isInteger !== true) return undefined;
        const n = toInteger(x);
        if (n === null) return undefined;
        const ce = x.engine;
        if (bignumPreferred(ce))
          return ce.number(
            run(
              bigFactorial2(ce.bignum(n)),
              ce._timeRemaining,
              ce._deadlineFrame
            )
          );

        return ce.number(factorial2(n));
      },
    },

    Floor: {
      description: 'Rounds a number down to the nearest integer.',
      keywords: ['round down', 'integer part'],
      wikidata: 'Q56860783',
      complexity: 1250,
      broadcastable: true,

      signature: '(number) -> integer',
      typeHandlerKind: 'types',
      type: ([x]) => roundingFunctionTypeOnTypes(x),
      sgn: ([x]) => {
        if (x.isNegative) return 'negative';
        if (x.isGreaterEqual(1)) return 'positive';
        if (x.isNonNegative && x.isLess(1)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        // Component-wise floor of a complex: real result iff ⌊im⌋ = 0
        // (im ∈ [0, 1)), and then the sign is that of ⌊re⌋ — not of re
        // itself (⌊0.5 + 0.5i⌋ = 0, not positive).
        if (x.isReal == false && isNumber(x))
          return x.im! < 0 || x.im! >= 1
            ? 'unsigned'
            : numberSgn(Math.floor(x.re)); //.re and .im should be more general.
        return undefined;
      },
      evaluate: ([x]) =>
        apply(
          x,
          Math.floor,
          (x) => x.floor(),
          (z) => z.floor(0)
        ),
    },

    Fract: {
      description: 'Fractional part of a number: x - floor(x)',
      complexity: 1250,
      broadcastable: true,
      signature: '(number) -> number',
      typeHandlerKind: 'types',
      type: ([x]) => numericTypeHandlerOnTypes([x]),
      sgn: ([x]) => {
        if (x.isNonNegative) return 'non-negative';
        return undefined;
      },
      evaluate: ([x], { numericApproximation, engine: ce }) => {
        // Exact fractional part for an exact real argument: x - floor(x),
        // computed exactly (rational arithmetic) so `Fract(1/2) → 1/2`, not
        // `0.5`. Only an inexact (float) argument numericizes.
        if (!numericApproximation && isNumber(x) && x.isExact && x.im === 0) {
          const fl = ce.function('Floor', [x]).evaluate();
          if (isNumber(fl) && fl.isExact)
            return ce.function('Subtract', [x, fl]).evaluate();
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
      signature: '(number, number?) -> number',
      // Γ(z) has poles (value `~oo`) at the non-positive integers; the
      // incomplete Γ(s, z) keeps the generic handler.
      type: (ops) =>
        ops.length === 1 ? gammaPoleType(ops[0]) : numericTypeHandler(ops),

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
                ops[0].isReal === false
              ? 'unsigned'
              : undefined
          : undefined,
      evaluate: (ops, { numericApproximation, engine }) => {
        // Upper incomplete gamma Γ(s, z) (Mathematica/Rubi `Gamma[s, z]`).
        if (ops.length === 2) {
          const [s, z] = ops;
          // Γ(s, +∞) = ∫_{+∞}^∞ tˢ⁻¹e⁻ᵗ dt = 0 for any finite s (the e⁻ᵗ tail
          // vanishes). Exact, so return it regardless of numericApproximation.
          // A non-finite s (Γ(∞, ∞)) is indeterminate — leave it symbolic.
          if (
            z.isInfinity === true &&
            z.isPositive === true &&
            s.isFinite !== false
          )
            return engine.Zero;
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
        if (isNumber(x) && x.im === 0 && x.isInteger && x.isNonPositive)
          return engine.ComplexInfinity;
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
      signature: '(number) -> number',
      type: (ops) => gammaPoleType(ops[0]),

      evaluate: (ops, { numericApproximation, engine }) => {
        const x = ops[0];
        // At the poles of Γ (the non-positive integers) |Γ| → ∞, so
        // ln Γ → +∞ (as in Mathematica's LogGamma and SymPy's loggamma).
        // This is exact, so return it regardless of numericApproximation.
        if (isNumber(x) && x.im === 0 && x.isInteger && x.isNonPositive)
          return engine.PositiveInfinity;
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
      wikidata: 'Q1142755',
      complexity: 8200,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => gammaPoleType(ops[0]),
      evaluate: ([x], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, digamma, (x) => bigDigamma(engine, x))
          : undefined,
    },

    // Trigamma function ψ₁(x) = d/dx ψ(x) = d²/dx² ln(Γ(x))
    // The derivative of the digamma function
    Trigamma: {
      description: 'Trigamma function, the derivative of the digamma function',
      wikidata: 'Q2371722',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      type: (ops) => gammaPoleType(ops[0]),
      evaluate: ([x], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, trigamma, (x) => bigTrigamma(engine, x))
          : undefined,
    },

    // PolyGamma function ψₙ(x) = dⁿ/dxⁿ ψ(x)
    // The n-th derivative of the digamma function
    // PolyGamma(0, x) = Digamma(x), PolyGamma(1, x) = Trigamma(x)
    PolyGamma: {
      description:
        'Polygamma function, the n-th derivative of the digamma function',
      wikidata: 'Q1817679',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: integer, number) -> number',
      // ψⁿ(x) has poles (value `~oo`) at the non-positive integers.
      type: ([n, x]) =>
        x?.isInteger === true && nonPositiveSign(operandSgn(x)) === true
          ? 'number'
          : numericTypeHandler([n, x]),
      evaluate: ([n, x], { numericApproximation, engine }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(
              n,
              x,
              (n, x) => polygamma(n, x),
              (n, x) => bigPolygamma(engine, n, x)
            )
          : undefined,
    },

    // Riemann zeta function ζ(s) = Σ_{n=1}^∞ 1/n^s
    // Converges for Re(s) > 1, analytically continued elsewhere
    Zeta: {
      description: 'Riemann zeta function',
      wikidata: 'Q187235',
      complexity: 8500,
      broadcastable: true,
      signature: '(number) -> number',
      // ζ(1) is the pole (value `~oo`, representable only by `number`). The
      // pole test is the literal-value channel: `isSame` is strictly
      // syntactic, so only a literal 1 ever answered `true` here, and
      // `operandLiteralValue` selects exactly that population.
      typeHandlerKind: 'types',
      type: ([x]) =>
        x !== undefined && operandLiteralValueOnTypes(x) === 1
          ? 'number'
          : numericTypeHandlerOnTypes([x]),
      evaluate: ([x], { numericApproximation, engine }) => {
        if (shouldNumericize(numericApproximation, x))
          return apply(x, zeta, (x) => bigZeta(engine, x));

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

    // Beta function B(a,b) = Γ(a)Γ(b)/Γ(a+b) = ∫₀¹ t^(a-1)(1-t)^(b-1) dt
    Beta: {
      description: 'Euler beta function',
      wikidata: 'Q189062',
      complexity: 8200,
      broadcastable: true,
      signature: '(number, number) -> number',
      // B(a, b) has Γ-poles (value `~oo`) where a or b is a non-positive
      // integer (unless cancelled). Such an argument may be a pole → claim the
      // top type `number` per the non-finite typing convention, rather than
      // `finite_real`. (`B(−2, 2) = 1/2` is finite but `number` still admits it.)
      type: (ops) => {
        const nonposInt = (x: Expression | undefined) =>
          x?.isInteger === true && nonPositiveSign(operandSgn(x)) === true;
        if (nonposInt(ops[0]) || nonposInt(ops[1])) return 'number';
        return numericTypeHandler(ops);
      },
      evaluate: ([a, b], { numericApproximation, engine }) => {
        // Exact reductions and Γ-pole handling for real (im === 0) arguments.
        // The naive B(a,b) = Γ(a)Γ(b)/Γ(a+b) formula turns the Γ-pole at a
        // non-positive integer into silent overflow garbage (e.g. B(−1, 2)
        // → −2.97e49); the exact rational form below is correct on both the
        // finite (`B(−2, 2) = 1/2`) and the pole (`B(−1, 2) = ~oo`) branches.
        if (isNumber(a) && isNumber(b) && a.im === 0 && b.im === 0) {
          const ai = a.isInteger ? asSmallInteger(a) : null;
          const bi = b.isInteger ? asSmallInteger(b) : null;
          // B(a, m) = (m−1)! / (a(a+1)…(a+m−1)) — an exact rational function of
          // a valid at every a (with a pole where the denominator vanishes).
          let reduced: Expression | undefined;
          if (bi !== null && bi > 0)
            reduced = betaPositiveIntegerArg(engine, a, bi);
          else if (ai !== null && ai > 0)
            reduced = betaPositiveIntegerArg(engine, b, ai);
          if (reduced !== undefined)
            return numericApproximation ? reduced.N() : reduced;
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
      wikidata: 'Q429963',
      complexity: 8300,
      broadcastable: true,
      // Optional second argument: the (integer) branch index. The branch is
      // kept as a plain `number?` (not `integer`) in the signature — an
      // `integer`-typed parameter has broken rule boxing in this repo — and
      // validated in `evaluate` instead.
      signature: '(number, number?) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
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
        return shouldNumericize(numericApproximation, x)
          ? apply(
              x,
              (v) => lambertW(v, branch),
              (v) => bigLambertW(engine, v, branch)
            )
          : undefined;
      },
    },

    // Bessel function of the first kind J_n(x)
    // Solution to Bessel's differential equation that is finite at the origin
    BesselJ: {
      description: 'Bessel function of the first kind',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselJ)
          : undefined,
    },

    // Bessel function of the second kind Y_n(x)
    // Also known as Neumann function or Weber function
    BesselY: {
      description: 'Bessel function of the second kind (Neumann function)',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselY)
          : undefined,
    },

    // Modified Bessel function of the first kind I_n(x)
    BesselI: {
      description: 'Modified Bessel function of the first kind',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselI)
          : undefined,
    },

    // Modified Bessel function of the second kind K_n(x)
    // Also known as Macdonald function
    BesselK: {
      description:
        'Modified Bessel function of the second kind (Macdonald function)',
      wikidata: 'Q627488',
      complexity: 8500,
      broadcastable: true,
      signature: '(order: number, number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([n, x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, n, x)
          ? apply2(n, x, besselK)
          : undefined,
    },

    // Airy function of the first kind Ai(x)
    // Solution to Airy differential equation y'' - xy = 0
    AiryAi: {
      description: 'Airy function of the first kind',
      wikidata: 'Q403629',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, airyAi)
          : undefined,
    },

    // Airy function of the second kind Bi(x)
    AiryBi: {
      description: 'Airy function of the second kind',
      wikidata: 'Q403629',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, airyBi)
          : undefined,
    },

    // Derivative of the Airy function of the first kind Ai'(x)
    AiryAiPrime: {
      description: 'Derivative of the Airy function of the first kind',
      wikidata: 'Q403629',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, airyAiPrime)
          : undefined,
    },

    // Derivative of the Airy function of the second kind Bi'(x)
    AiryBiPrime: {
      description: 'Derivative of the Airy function of the second kind',
      wikidata: 'Q403629',
      complexity: 8400,
      broadcastable: true,
      signature: '(number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: ([x], { numericApproximation }) =>
        shouldNumericize(numericApproximation, x)
          ? apply(x, airyBiPrime)
          : undefined,
    },

    Ln: {
      description: 'Natural Logarithm',
      wikidata: 'Q204037',
      complexity: 4000,
      broadcastable: true,

      signature: '(number, base: number?) -> number',
      type: (ops) => elementaryFunctionType('Ln', ops),
      sgn: ([x]) => lnSign(x),
      // @fastpath: this doesn't get called. See makeNumericFunction()
      evaluate: ([z], { numericApproximation, engine }) => {
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
          (z) => (z.isZero() ? NaN : z.log())
        );
      },
    },

    Log: {
      description: 'Log(z, b = 10) = Logarithm of base b',
      wikidata: 'Q11197',
      complexity: 4100,
      broadcastable: true,

      signature: '(number, base: number?) -> number',
      type: (ops) => elementaryFunctionType('Log', ops),

      sgn: ([x, base]) => {
        if (!base) return lnSign(x);
        if (base.isSame(1) || base.isReal == false) return 'unsigned';
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
      evaluate: (ops, { numericApproximation, engine }) => {
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
        return apply2(
          ops[0],
          ops[1],
          // A negative real argument has a complex logarithm; the one-arg
          // path already falls back to `ce.complex(...).log()`, so the
          // two-arg lanes must too (otherwise `Log(-2, 10).N()` → NaN while
          // `Ln(-2).N()` → complex).
          (z, b) =>
            z < 0
              ? ce.complex(z).log().div(Math.log(b))
              : Math.log(z) / Math.log(b),
          (z, b) =>
            z.isNegative()
              ? ce.complex(z.toNumber()).log().div(Math.log(b.toNumber()))
              : z.log(b),
          (z, b) => z.log().div(typeof b === 'number' ? Math.log(b) : b.log())
        );
      },
    },

    Lb: {
      description: 'Base-2 Logarithm',
      wikidata: 'Q581168',
      complexity: 4100,
      broadcastable: true,

      signature: '(number) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x, engine.number(2)]),
    },

    Lg: {
      description: 'Base-10 Logarithm',
      wikidata: 'Q966582',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x]),
    },

    Log10: {
      description: 'Base-10 Logarithm',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
      sgn: ([x]) => lnSign(x),
      canonical: ([x], { engine }) => engine._fn('Log', [x]),
    },

    Log2: {
      description: 'Base-2 Logarithm',
      complexity: 4100,
      broadcastable: true,
      signature: '(number) -> number',
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

      signature: '(number, number) -> number',
      type: ([a, b]) => {
        if (!a || !b) return 'number';
        // A floored remainder is defined only for a finite real dividend and a
        // finite, non-zero real modulus. A zero/complex/infinite modulus, or an
        // infinite dividend, yields NaN (the old `widen(...)` claimed e.g.
        // `finite_rational` for `Mod(1/2, 0)` and `imaginary` for `Mod(i, i)`).
        // The 0-pole needs sgn-nonzero (the `poleReciprocalType` idiom): a
        // `finite_integer` modulus MAY be zero, so `b.isSame(0)` alone was
        // unsound (`Mod(k, m)` claimed `finite_integer` while `m = 0` yields
        // NaN). Operand tests read the STATIC type — the value predicates
        // (`isFinite`, `isInteger`) are type-blind on compound operands like
        // `Mod(k + 29, 900)`.
        const bSgn = operandSgn(b);
        const bNonZero = isNumber(b)
          ? !b.isSame(0)
          : positiveSign(bSgn) === true ||
            negativeSign(bSgn) === true ||
            bSgn === 'not-zero';
        if (!bNonZero) return 'number';
        const ta = a.type;
        const tb = b.type;
        if (ta.matches('finite_integer') && tb.matches('finite_integer'))
          return 'finite_integer';
        if (ta.matches('finite_rational') && tb.matches('finite_rational'))
          return 'finite_rational';
        if (ta.matches('finite_real') && tb.matches('finite_real'))
          return 'finite_real';
        return 'number';
      },
      sgn: (ops) => {
        const n = ops[1]; //base of Mod
        if (n === undefined || n.isReal == false) return undefined;
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
            (a, b) => ((a % b) + b) % b,
            (a, b) => a.mod(b).add(b).mod(b)
          );
          return v?.sgn ?? undefined;
        }
        return undefined;
      },
      evaluate: ([a, b], { engine: ce }) => {
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

        return apply2(
          a,
          b,
          // In JavaScript, the % is remainder, not modulo
          // so adapt it to return a modulo (floored: sign follows the
          // divisor, matching the machine lane and the fast paths above).
          (a, b) => ((a % b) + b) % b,
          (a, b) => a.mod(b).add(b).mod(b)
        );
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

      lazy: true,
      signature: '(number*) -> number',
      type: (ops) => {
        if (ops.length === 0) return 'finite_integer'; // = 1
        if (ops.length === 1) return ops[0].type;
        // A dimensionless list/indexed-collection factor together with a
        // numeric-tuple (point) factor broadcasts the collection while scaling
        // the point component-wise: the value path (`mul()`) checks the
        // collection BEFORE the tuple branch, yielding a `List` of `Tuple`s
        // (e.g. `Range(-2,2)·(2,3)`). The honest-typing wrapper is skip-listed
        // for `Multiply`-with-a-numeric-tuple, so the list type must come from
        // here. (The tuple-free broadcast — `2R`, `R·x` — is handled by the
        // wrapper.) Tensors keep their matrix-product typing below.
        if (
          !ops.some((x) => isTensorValue(x)) &&
          ops.some((x) => isBroadcastCollectionType(x)) &&
          ops.some((x) => couldBeNumericTuple(x))
        ) {
          const tupleType = widen(
            ...ops.filter((x) => couldBeNumericTuple(x)).map((x) => x.type.type)
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
            .filter((x) => !couldBeNumericTuple(x))
            .map((x) => {
              if (isBroadcastCollectionType(x)) {
                const elt = broadcastCollectionElementType(x);
                return elt === undefined || elt === 'any' || elt === 'unknown'
                  ? 'number'
                  : elt;
              }
              return isDeclaredScalarNumber(x) ? x.type.type : undefined;
            });
          if (
            factorTypes.every((t) => t !== undefined && isSubtype(t, 'number'))
          )
            return broadcastResultType(
              scaleTupleComponents(tupleType, factorTypes as Type[])
            );
          return broadcastResultType(tupleType);
        }
        // A numeric tuple (point/vector) scaled by scalars keeps the tuple
        // type. Hoisted above the NaN/finiteness early-returns (a tuple's
        // `isFinite` is `false`, which would otherwise collapse to `number`).
        // COULD-semantics (`couldBeNumericTuple`): a tuple with
        // `unknown`-component elements (e.g. `(S(x,y,0), S(x,y,1))` with
        // `S: (…) -> unknown`) is still statically a tuple — claiming `number`
        // for its scalar product would let the enclosing `Add`'s
        // scalar-plus-tuple guard bake `incompatible-type` (Tycho item 30).
        const tupleOps = ops.filter((x) => couldBeNumericTuple(x));
        if (tupleOps.length === 1) {
          // The scalar factors scale every COMPONENT, so they widen the
          // component types: `x · (1, 0)` with `x: number` has `number`
          // components. Echoing the tuple's own type claimed
          // `tuple<finite_integer, finite_integer>` for `(k/n) · (1, 0)`,
          // whose value is the rational point `(1/3, 0)` — the component-type
          // lie under the zip `Subtract` of Tycho item 212. Same rule as the
          // tensor branch below: only a factor whose number type is DECLARED
          // carries a tier to combine; an inferred or `unknown` factor leaves
          // the tuple type as written.
          const others = ops.filter((x) => x !== tupleOps[0]);
          if (others.every((x) => isDeclaredScalarNumber(x)))
            return scaleTupleComponents(
              tupleOps[0].type.type,
              others.map((x) => x.type.type)
            );
          return tupleOps[0].type;
        }
        // Element-wise product of a single tensor (vector/matrix) with scalars
        // keeps the tensor's shape/type. The list-broadcast wrapper is
        // skip-listed for tensor Multiply (mulTensors handles the value), so
        // the honest list type must come from here.
        const tensorOps = ops.filter((x) => isTensorValue(x));
        if (tensorOps.length === 1) {
          const others = ops.filter((x) => !isTensorValue(x));
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
                !isLinearAlgebraCollection(x) && !isBroadcastCollectionType(x)
            )
          ) {
            // Scalar factors fold INTO the cells elementwise: widen the
            // tensor's honest cell type with the scalar types so the
            // declared type stays a sound upper bound (`x·[0,0,1,1]` has
            // `number` cells, not `finite_integer`).
            return absorbScalarsIntoCells(
              tensorOps[0].type.type,
              others.map((x) => x.type.type)
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
          isLinearAlgebraCollection(x)
        );
        const collectionOps =
          definiteCollections.length > 0
            ? ops.filter(
                (x) =>
                  isLinearAlgebraCollection(x) || isBroadcastCollectionType(x)
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
          const others = ops.filter((x) => !isLinearAlgebraCollection(x));
          if (others.every((x) => isDeclaredScalarNumber(x)))
            return absorbScalarsIntoCells(
              collectionOps[0].type.type,
              others.map((x) => x.type.type)
            );
          return collectionOps[0].type;
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
            typeCouldBeNumericTupleCollection(x.type.type)
          );
          const scalarSiblings: Type[] = [];
          const siblingsAreRank1Scalars =
            tupleCollections.length === 1 &&
            collectionOps.every((x) => {
              if (x === tupleCollections[0]) return true;
              if (x.type.matches('matrix')) return false;
              const el = collectionElementTypeOf(x.type.type);
              if (el === undefined || !isSubtype(el, 'number')) return false;
              scalarSiblings.push(el);
              return true;
            });
          if (siblingsAreRank1Scalars)
            return absorbScalarsIntoCells(
              tupleCollections[0].type.type,
              scalarSiblings
            );
          // Strip range decorations before the join: a product of two
          // `list<real<-1..>>` operands does not stay above −1
          // (see `stripNumericRanges`).
          return widen(
            ...collectionOps.map((x) =>
              stripNumericRanges(broadcastSiblingType(x.type.type))
            )
          );
        }
        // An operand whose collection-ness is not statically visible (a top
        // `unknown`/`any`/`value` leaf such as an undeclared `h(x)`, or an
        // already-`broadcastable<…>` inner node) makes the product
        // `broadcastable<T>`. Hoisted above the NaN/finiteness early-returns
        // for the same reason as `addType`'s branch: a broadcastable inner node
        // has no meaningful `isFinite`, and an `unknown`-typed leaf's
        // `isNaN`/`isFinite` are `undefined`. The `imaginary` → `finite_complex`
        // closure (i·i = −1 is real) is applied inside the helper.
        if (ops.some((x) => isPossiblyCollectionTyped(x)))
          return broadcastableResultTypeOf(ops);
        if (ops.some((x) => x.isNaN)) return 'number';
        // A provably non-finite factor may be visible only in its static
        // TYPE: `Ln(0)` types `non_finite_number`, as does a symbol declared
        // `non_finite_number`, and neither has a value to probe.
        // `provablyNonFiniteNumber`  catches them; without
        // it `2·Ln(0)` fell through to the "every operand is finite" tail and
        // claimed `finite_integer` (unsound; the value is −∞).
        if (ops.some((x) => provablyNonFiniteNumber(x))) {
          // 0 · ±∞ = NaN (indeterminate).
          if (ops.some((x) => x.isSame(0))) return 'number';
          // real · ±∞ = ±∞ (a non-finite real); a non-real factor (i, complex)
          // with ∞ gives ~oo or NaN, and a *possibly-zero* finite factor gives
          // NaN (0 · ∞). So every factor must be provably REAL, and every
          // FINITE factor must additionally have a proven non-zero sign.
          //
          // Ruling 2026-08-03: a provably non-finite real factor is implicitly
          // non-zero — `±∞ ≠ 0` is a theorem, so requiring a proven sign of it
          // is redundant (`Ln(0)` has sgn `non-positive`, yet `2·Ln(0) = −∞`).
          // Proven signs are required only of the finite factors. The
          // `isReal === true` requirement stays for EVERY factor, including the
          // non-finite one: structural `isFinite === false` does not imply real
          // (`ComplexInfinity` has `isFinite === false` with type `complex`),
          // and `∞·i = ~oo` must not be claimed `non_finite_number`.
          if (
            ops.every((x) => {
              if (x.isReal !== true) return false;
              if (provablyNonFiniteNumber(x)) return true;
              // Value/assumption channel first, then the TYPE channel (a
              // literal's value type, an `assume` range, `Abs`'s `<0..>`).
              const s = operandSgn(x);
              return s === 'positive' || s === 'negative' || s === 'not-zero';
            })
          )
            return 'non_finite_number';
          return 'number';
        }
        // From here every operand is finite (no `isFinite === false`).
        if (ops.every((x) => x.isInteger)) return 'finite_integer';
        if (ops.every((x) => x.isReal)) return 'finite_real';
        if (ops.every((x) => x.isRational)) return 'finite_rational';

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
        //   `finite_complex` (e.g. `x·i` with real x ∋ 0 may be 0, which
        //   is not `imaginary`).
        const isImaginary = (x: Expression) => x.type.matches('imaginary');
        const imaginaryCount = ops.filter(isImaginary).length;
        if (
          imaginaryCount > 0 &&
          ops.every((x) => isImaginary(x) || x.isReal === true)
        ) {
          if (imaginaryCount % 2 === 0) return 'finite_real';
          const isNonZero = (x: Expression) => {
            const s = operandSgn(x);
            return s === 'positive' || s === 'negative' || s === 'not-zero';
          };
          if (ops.every((x) => isImaginary(x) || isNonZero(x)))
            return 'imaginary';
          return 'finite_complex';
        }

        // A product of finite complex factors is itself a finite complex
        // number (e.g. `√2·(1+i)`): claim `finite_complex` (⊂ `complex`)
        // rather than the complex-unaware `finite_number`.
        if (ops.every((x) => x.type.matches('finite_complex')))
          return 'finite_complex';

        return 'finite_number';
      },
      // @fastpath: canonicalization is done in the function
      // makeNumericFunction().
      //
      sgn: (ops) => {
        if (ops.some((x) => x.sgn === undefined || x.isReal === false))
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
      evaluate: (ops, { numericApproximation, engine }) => {
        // Ellipsis fold barrier: a `Multiply` with a direct
        // `ContinuationPlaceholder` operand is a notational object; leave it
        // unchanged rather than multiplying across the elided terms.
        if (ops.some((x) => isContinuationOperand(x))) return undefined;
        // `Multiply` is `lazy`, so the driver did NOT evaluate the operands —
        // this map is the (single) operand evaluation, not a re-evaluation.
        const evaluated = ops.map((x) => x.evaluate());
        const nonNumeric = nonNumericOperandError(engine!, evaluated);
        if (nonNumeric !== undefined) return nonNumeric;
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
        // Impure operands pass their evaluated form so their side effects run
        // once; pure operands keep the raw, substitute-once-guarded path
        // (Tycho item 46) — see the matching comment in `Add`. `mulN` keeps a
        // product of sums FACTORED exactly as `mulFactored` does below — the
        // two routes must agree on shape, differing only in floats.
        if (numericApproximation) {
          const r = mulN(
            ...ops.map((op, i) => (op.isPure ? op : evaluated[i]))
          );
          // See the matching comment in `Add` (Tycho item 101).
          return (
            foldQuantityOperands(engine!, r) ??
            foldMeasurementOperands(engine!, r) ??
            r
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
        return result;
      },
    },

    Negate: {
      description: 'Additive Inverse',
      wikidata: 'Q715358',
      complexity: 2000,
      broadcastable: true,
      signature: '(value) -> value',
      // `value`-typed signature defaults to `pass-through`; declare `propagate`
      // (§3.A/§5) so `Negate(Missing)` yields `NaN`.
      missingBehavior: 'propagate',
      // The echo must REFLECT any range the operand type carries: `−|x|`
      // echoing `real<0..>` verbatim claimed a sign the value contradicts.
      // Ranges reflect about zero, tiers are their own negation
      // (`negateNumericType`).
      typeHandlerKind: 'types',
      type: ([x]) => negateNumericType(x.type),
      sgn: ([x]) => oppositeSgn(x.sgn),
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args);
        if (args.length === 0) return engine.error('missing');

        return args[0].neg();
      },
      evaluate: ([x], { numericApproximation, engine }) => {
        // Non-lazy: `x` is already evaluated by the driver.
        const nonNumeric = nonNumericOperandError(engine!, [x]);
        if (nonNumeric !== undefined) return nonNumeric;
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
      typeHandlerKind: 'types',
      type: measurementTypeOnTypes,
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
      wikidata: 'Q120812',
      complexity: 1200,
      signature: '(T, U) -> tuple<T, U> where T: value, U: value',
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
      signature: '(number, number) -> number',
      type: ([base, exp]) => {
        if (base.isNaN || exp.isNaN) return 'number';
        // A non-finite base or exponent can produce ±∞ *or* NaN — `0^∞`,
        // `∞^0`, `1^∞`, `i^∞`, `∞^i` are all indeterminate. Only a
        // *non-negative real* base raised to a *positive finite real* exponent
        // is guaranteed non-finite (`(+∞)^2 = +∞`); everything else widens to
        // the top type (the old `non_finite_number` ignored the NaN forms).
        // `=== false` (not `!`): a symbolic operand has `isFinite ===
        // undefined`, which must not be treated as non-finite.
        // Sign reads combine the value channel with the TYPE channel
        // (`operandSgn`): a literal's sign travels in its handler-visible
        // type, and `assume(x > 0)` travels in the symbol's refined type.
        const baseSgn = operandSgn(base);
        const expSgn = operandSgn(exp);
        if (provablyNonFiniteNumber(base) || provablyNonFiniteNumber(exp)) {
          if (
            nonNegativeSign(baseSgn) === true &&
            exp.isFinite === true &&
            positiveSign(expSgn) === true &&
            provablyNonFiniteNumber(base)
          )
            return 'non_finite_number';
          return 'number';
        }
        // `0` raised to a non-positive power is a pole: `0^0` is indeterminate
        // and `0^-k = ±∞` (P0-11: `0^(−0.5) = +∞`).
        if (base.isSame(0) && positiveSign(expSgn) !== true) return 'number';
        // `integer ^ (non-negative integer)` stays an integer; a possibly
        // *negative* integer exponent yields a (non-integer) rational
        // (P0-11: `2^-2 = 1/4`). An EVEN exponent adds the sign: x² ≥ 0
        // (and x⁻² ≥ 0) for any real x (ROADMAP "Ranged types should carry
        // sign…", work item 4 — the even-power head).
        if (base.isInteger && exp.isInteger) {
          if (nonNegativeSign(expSgn) === true)
            return operandIsEven(exp) === true
              ? nonNegativeRangeType('finite_integer')
              : 'finite_integer';
          return operandIsEven(exp) === true
            ? nonNegativeRangeType('finite_rational')
            : 'finite_rational';
        }
        if (base.isRational && exp.isInteger)
          return operandIsEven(exp) === true
            ? nonNegativeRangeType('finite_rational')
            : 'finite_rational';
        // A real result needs a non-negative base or an integer exponent;
        // otherwise the result may be complex (e.g. (−2)^0.5).
        if (base.isReal && exp.isReal) {
          // A provably positive base keeps a positive result — `b^x =
          // e^(x·ln b) > 0` for a real exponent (`Exp` canonicalizes to
          // `Power(e, x)`, so this arm is item 4's `Exp` head); a
          // non-negative base or an even exponent keeps a non-negative one.
          // Same generic-point convention as the plain `finite_real` claims
          // these refine: an operand of unknown finiteness is treated as a
          // finite point.
          if (positiveSign(baseSgn) === true)
            return positiveRangeType('finite_real');
          if (nonNegativeSign(baseSgn) === true)
            return nonNegativeRangeType('finite_real');
          if (operandIsEven(exp) === true)
            return nonNegativeRangeType('finite_real');
          if (exp.isInteger) return 'finite_real';
          // A *provably negative* base with an exponent that provably lands on
          // the complex branch (`(−2)^0.3`) is a finite complex value — the
          // `finite_number` default below is true but too coarse for the
          // compiler, which then guesses real and emits NaN. `=== true`, and
          // an exponent whose branch cannot be proven keeps the wider default.
          // (Nested under the `isReal` guard so a complex-typed base never
          // pays for the extra sign query.)
          if (
            negativeSign(baseSgn) === true &&
            negativeBaseIsComplexBranch(exp)
          )
            return 'finite_complex';
        }
        // A pure-imaginary base (non-zero by type: `imaginary ∩ real =
        // nothing` in the lattice, and 0 is real) raised to an integer power:
        // (bi)^n = bⁿ·iⁿ, so an even n is real, an odd n is pure imaginary
        // (non-zero since b ≠ 0), and an unknown-parity integer is one of the
        // two — both ⊂ `finite_complex`.
        if (base.type.matches('imaginary') && exp.isInteger === true) {
          if (operandIsEven(exp) === true) return 'finite_real';
          if (operandIsOdd(exp) === true) return 'imaginary';
          return 'finite_complex';
        }
        // A positive real base raised to a finite complex power is
        // e^(exp·ln base): finite and non-zero, hence a finite complex
        // number (e.g. `e^i`, on the unit circle).
        if (
          base.isReal === true &&
          positiveSign(baseSgn) === true &&
          exp.type.matches('finite_complex')
        )
          return 'finite_complex';
        return 'finite_number';
      },
      canonical: (args, { engine }) => {
        // @fastpath: See also shortcut in makeNumericFunction()
        args = checkNumericArgs(engine, args, 2);
        if (args.length !== 2) return engine._fn('Power', args);
        const [base, exp] = args;
        return canonicalPower(base, exp);
      },
      sgn: ([a, b]) => {
        //Missing some cases like (-1)^{1/3}
        // A finite, provably non-real base is necessarily nonzero (0 is
        // real), so its finite integer powers are nonzero. A *pure-imaginary*
        // base cycles with period 4: (βi)^p is real with sign (-1)^(p/2) for
        // even integer p, and pure imaginary — hence unsigned — for odd p.
        // (Both exactness guards matter: `integer` admits ±∞, and β^∞ can be
        // 0 for |β| < 1.)
        if (
          isNonRealNumber(a.type.type) &&
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
          a.isReal === false ||
          b.isReal === false ||
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
          if (a.isReal) {
            const s = a.sgn;
            return s === 'positive' || s === 'not-zero' || s === 'negative'
              ? 'positive'
              : 'non-negative';
          }
          // Non-real bases were handled before the `isReal === false` bail
          // above; here `a.isReal` is undefined.
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
          if (!isNumber(f) || f.im !== 0) return undefined;
          return ce.number(rationalize(f.re));
        }

        if (numericApproximation) {
          return apply2(
            ops[0],
            ops[1],
            (a, b) => a / b,
            (a, b) => a.div(b),
            (a, b) => a.div(b)
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
      signature: '(number, number?) -> rational',
      examples: [
        'Rationalize(1.75)  // 7/4',
        'Rationalize(Sqrt(3), 1/500)  // 26/15',
      ],
      evaluate: (ops, { engine }) => {
        const ce = engine;
        // See `Rational`: a symbolic argument cannot numericize.
        if (ops[0].unknowns.length > 0) return undefined;
        const f = ops[0].N();
        if (!isNumber(f) || f.im !== 0) return undefined;
        if (ops.length >= 2) {
          const tol = ops[1].N();
          if (!isNumber(tol) || tol.im !== 0) return undefined;
          return ce.number(rationalize(f.re, Math.abs(tol.re)));
        }
        return ce.number(rationalize(f.re));
      },
    },

    Root: {
      description: 'n-th root of a value.',
      keywords: ['nth root', 'cube root'],
      complexity: 3200,
      broadcastable: true,

      signature: '(number, number) -> number',
      type: ([base, exp]) => {
        if (base.isNaN || exp.isNaN) return 'number';
        // Root(x, n) = x^(1/n). A non-finite base or index makes the result
        // indeterminate: Root(±∞, n) ∈ {0, ±∞, complex}, Root(x, ±∞) = x^0
        // (often 1 but 0^0/∞^0 are NaN). Widen to the top type.
        if (provablyNonFiniteNumber(base) || provablyNonFiniteNumber(exp))
          return 'number';
        // Root(x, 0) = x^(1/0): a pole (the old `finite_integer` was wrong —
        // Root(2,0), Root(0,0), Root(−2,0) all evaluate to NaN).
        if (exp.isSame(0)) return 'number';
        if (exp.isSame(1)) return base.type;
        // Root(0, n): 0 for n>0, a pole (±∞) for n≤0, NaN for a complex index.
        const rootExpSgn = operandSgn(exp);
        if (base.isSame(0))
          return positiveSign(rootExpSgn) === true
            ? 'finite_integer'
            : 'number';
        if (base.isReal && exp.isReal) {
          const rootBaseSgn = operandSgn(base);
          // A positive base always gives a positive real root.
          if (positiveSign(rootBaseSgn) === true) return 'finite_real';
          // A negative real base with a provably *even* degree has no real
          // value: Root(−8, 4) = 1.1892… + 1.1892…i. (An *odd* degree keeps
          // CE's real-root convention — Root(−8, 3) = −2 — and a degree of
          // unknown parity keeps the `finite_number` hedge below.) `=== true`
          // throughout: a symbolic degree has `isEven === undefined`.
          if (
            negativeSign(rootBaseSgn) === true &&
            operandIsEven(exp) === true &&
            positiveSign(rootExpSgn) === true
          )
            return 'finite_complex';
          // A negative real base: a positive index yields a finite (real or
          // complex) value; a non-positive index can numericize to NaN in the
          // current evaluate path (e.g. Root(−2,−2)), so widen to `number`.
          if (positiveSign(rootExpSgn) === true) return 'finite_number';
          return 'number';
        }
        return 'finite_number';
      },
      sgn: ([x, n]) => {
        // Note: we can't simplify this to a power, then get the sgn of that because this may cause an infinite loop
        if (x.isReal === false || n.isReal === false) return 'unsigned';
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
      canonical: (args, { engine }) => {
        args = checkNumericArgs(engine, args, 2);
        const [base, exp] = args;
        //note: args. are canonicalized prior.
        return canonicalRoot(base, exp);
      },
      evaluate: ([x, n], { numericApproximation, engine }) => {
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
      evaluate: ([a, b]) =>
        apply2(
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
        ),
    },

    Round: {
      description:
        'Rounds a number to the nearest integer, or (with a precision argument) to `n` decimal places.',
      complexity: 1250,
      broadcastable: true,
      // Optional precision arg (Desmos/spreadsheet `round(x, n)`): round to `n`
      // decimal places. Without it, rounds to the nearest integer.
      signature: '(number, integer?) -> number',
      typeHandlerKind: 'types',
      type: ([x, n]) => {
        const t = roundingFunctionTypeOnTypes(x);
        // With a precision arg the result is generally non-integer
        // (`Round(3.14159, 2)` is `3.14`): keep the complex/non-finite/NaN
        // classification, but replace the integer claim by `finite_real`.
        // The replacement must apply to EVERY operand that rounds to
        // `finite_integer`, including a bare `real` symbol of unknown
        // finiteness — an earlier guard on `isFinite === true` let
        // `Round(x, 2)` with `x: real` fall through to `finite_integer`.
        return n !== undefined && t === 'finite_integer' ? 'finite_real' : t;
      },
      sgn: ([x, n]) => {
        // Only reason about the sign in the single-argument (round-to-integer)
        // case; a precision arg rescales the value and the interval reasoning
        // below no longer holds.
        if (n !== undefined) return undefined;
        if (x.isNaN) return 'unsigned';
        // The evaluate handler rounds halves AWAY from zero in every lane
        // (Round(-1/2) = -1); Math.round ties toward +∞, so negate-and-round
        // for negative reals or `.sgn` and `.evaluate()` disagree at -0.5.
        if (isNumber(x))
          return x.im! >= 0.5 || x.im! <= -0.5
            ? 'unsigned'
            : numberSgn(x.re < 0 ? -Math.round(-x.re) : Math.round(x.re));
        if (x.isGreaterEqual(0.5)) return 'positive';
        if (x.isLessEqual(-0.5)) return 'negative';
        if (x.isLess(0.5) && x.isGreater(-0.5)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive) return 'non-positive';
        return undefined;
      },
      evaluate: ([x, n], { engine: ce }) => {
        const roundToInteger = (v: Expression) =>
          apply(
            v,
            Math.round,
            (v) => v.round(),
            (v) => v.round(0)
          );
        if (n === undefined) return roundToInteger(x);
        // Round(x, n) = Round(x·10ⁿ)/10ⁿ — round to `n` decimal places.
        if (!isNumber(n) || n.isFinite !== true) return undefined;
        const factor = ce.number(10).pow(n);
        const scaled = roundToInteger(x.mul(factor));
        return scaled === undefined ? undefined : scaled.div(factor);
      },
    },

    /** Heaviside step function: H(x) = 0 for x < 0, 1/2 for x = 0, 1 for x > 0 */
    Heaviside: {
      description: 'Heaviside step function.',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> number',
      // H's values on the real line are exactly 0, 1/2 and 1, so the tight
      // per-element claim is a finite rational in [0, 1] — the range carries
      // the non-negativity through the type channel (`signOfType`), matching
      // the gated `sgn` handler below. The claim holds at the ends of the
      // line too (H(±∞) is 0 or 1). Everywhere else H has no value, so the
      // gate answers the wide `number`; see `realOnlyStepType`.
      typeHandlerKind: 'types',
      type: ([x]) => realOnlyStepType(x, HEAVISIDE_REAL_TYPE),
      // H(x) ∈ {0, 1/2, 1} — non-negative — but only where H has a value at
      // all, i.e. on the real line. At NaN, at `~oo` and off the real axis
      // there is no value, and the unconditional `non-negative` this
      // definition used to claim asserted a sign for those inputs anyway
      // (`Heaviside(NaN).isNonNegative` was `true`). Realness is read from
      // the TYPE, which is the same gate the `type` handler above uses: a
      // NaN literal answers `isReal === true` while typing `number`.
      sgn: ([x]) => (x.type.matches('real') ? 'non-negative' : undefined),
      evaluate: ([x], { engine }) => {
        if (x.isSame(0)) return engine.Half;
        if (x.isPositive) return engine.One;
        if (x.isNegative) return engine.Zero;
        return undefined;
      },
    },

    Sign: {
      description: 'Sign of a number: -1, 0, or 1.',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> number',
      // The sign of a real — ±∞ included — is exactly −1, 0 or 1, so the
      // tight per-element claim is a finite integer in [−1, 1]. Off the real
      // line the usual convention `z/|z|` is complex and this operator
      // declines, so an unproven-real argument keeps the wide `number`; see
      // `realOnlyStepType`.
      typeHandlerKind: 'types',
      type: ([x]) => realOnlyStepType(x, SIGN_REAL_TYPE),
      sgn: ([x]) => x.sgn,
      evaluate: ([x], { engine }) => {
        if (x.isSame(0)) return engine.Zero;
        if (x.isPositive) return engine.One;
        if (x.isNegative) return engine.NegativeOne;
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

      signature: '(number) -> number',
      type: ([x]) => {
        if (x.isNaN) return 'number';
        if (provablyNonFiniteNumber(x)) {
          // √(−∞) = i·∞ = ~oo (complex infinity), not a real ±∞ — and `~oo`
          // is representable only by `number` (non-finite typing convention).
          if (x.isNegative === true) return 'number';
          if (x.isNonNegative === true) return 'non_finite_number';
          return 'number';
        }
        if (x.isReal) {
          // √x of a provably non-negative real is real; otherwise the value
          // may be a finite pure-imaginary (`√−2 = 1.414…i`), so an
          // unknown-sign real must not claim `finite_real` (same ruling as
          // the bounded inverse-trig heads, 2026-07-30). Finite operand
          // (checked above) ⇒ finite result: `finite_complex`, not `complex`.
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
          // the `finite_complex` hedge while its compiled bytes are
          // unchanged. See the §5.4 `Sqrt` row of
          // `docs/plans/2026-08-22-type-handlers-on-types.md`.
          if (nonNegativeSign(operandSgn(x)) === true) return 'finite_real';
          return 'finite_complex';
        }
        return 'finite_number';
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
      evaluate: ([x], { numericApproximation, engine }) => {
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

        if (!numericApproximation) return x.sqrt();

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
      signature: '(number) -> number',
      sgn: ([x]) => {
        if (x.isSame(0)) return 'zero';
        if (x.isReal) {
          const s = x.sgn;
          return s === 'not-zero' || s === 'positive' || s === 'negative'
            ? 'positive'
            : 'non-negative';
        }
        // x² of a pure-imaginary x is real and negative: (βi)² = -β², with
        // β ≠ 0 since `imaginary` excludes 0. For any other finite non-real
        // x, x² is nonzero but may be negative-real (x pure imaginary at
        // runtime) or non-real, so only `not-zero` is sound — `unsigned`
        // would claim a definite imaginary part.
        if (x.type.matches('imaginary')) return 'negative';
        if (isNonRealNumber(x.type.type) && x.isFinite === true)
          return 'not-zero';
        if (x.isNaN) return 'unsigned';
        return undefined;
      },
      canonical: (args, { engine }) => {
        const ce = engine;
        args = flatten(args);
        if (args.length !== 1) return ce._fn('Square', args);
        return ce._fn('Power', [args[0], ce.number(2)]).canonical;
      },
    },

    Subtract: {
      description: 'Difference between two or more values.',
      wikidata: 'Q40754',
      complexity: 1350,
      broadcastable: true,
      // We accept from 1 to n arguments (see https://github.com/cortex-js/compute-engine/issues/171)
      // left-associative: a - b - c -> (a - b) - c
      signature: '(number+) -> number',
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
      signature: '(number) -> integer',
      typeHandlerKind: 'types',
      type: ([x]) => roundingFunctionTypeOnTypes(x),
      // trunc(x) = 0 for |x| < 1, so the sign of x alone is not enough
      // (trunc(1/2) = 0, not positive). Mirror the Floor/Ceil interval logic.
      sgn: ([x]) => {
        if (x.isGreaterEqual(1)) return 'positive';
        if (x.isLessEqual(-1)) return 'negative';
        if (x.isGreater(-1) && x.isLess(1)) return 'zero';
        if (x.isNonNegative) return 'non-negative';
        if (x.isNonPositive) return 'non-positive';
        // Component-wise truncation of a complex: real result iff |im| < 1,
        // and then the sign is that of trunc(re).
        if (x.isReal === false && isNumber(x))
          return x.im! >= 1 || x.im! <= -1
            ? 'unsigned'
            : numberSgn(Math.trunc(x.re));
        return undefined;
      },
      evaluate: ([x]) =>
        apply(
          x,
          Math.trunc,
          (x) => x.trunc(),
          (z) => new Complex(Math.trunc(z.re), Math.trunc(z.im))
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
      type: 'imaginary',
      isConstant: true,
      holdUntil: 'never',
      wikidata: 'Q193796',
      value: (engine) => engine.I,
    },

    // Alias of 'ImaginaryUnit'
    i: {
      description: 'The imaginary unit, whose square is −1.',
      type: 'imaginary',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.I,
    },

    ExponentialE: {
      description:
        "Euler's number e ≈ 2.71828, the base of the natural logarithm.",
      keywords: ['euler number'],
      // The declared type brackets the value (the lower bound is the
      // machine double of e), so the TYPE channel alone proves e > 0 —
      // `e^x` claims its positive range and `e^i` stays admissible at a
      // `(complex)` parameter even where the value channel is not
      // consulted (ROADMAP "Ranged types should carry sign…").
      type: 'finite_real<2.718281828459045..2.718281828459046>',
      wikidata: 'Q82435',
      isConstant: true,
      holdUntil: 'N',

      value: (engine) =>
        engine.number(
          bignumPreferred(engine) ? BigDecimal.ONE.exp() : Math.exp(1)
        ),
    },

    e: {
      description:
        "Euler's number e ≈ 2.71828, the base of the natural logarithm.",
      // Same value bracket as `ExponentialE`: the alias's value is that
      // SYMBOL, whose static type carries the bracket, so the declaration
      // check accepts it — unlike `GoldenRatio`, whose value is an
      // unevaluated arithmetic expression with a bare static type.
      type: 'finite_real<2.718281828459045..2.718281828459046>',
      isConstant: true,
      holdUntil: 'never',
      value: 'ExponentialE',
    },

    ComplexInfinity: {
      description:
        'Complex infinity, a single unsigned infinity in the complex plane.',
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
      type: 'non_finite_number',
      isConstant: true,
      holdUntil: 'never',
      value: +Infinity,
    },

    NegativeInfinity: {
      description: 'Negative infinity (−∞).',
      type: 'non_finite_number',
      isConstant: true,
      holdUntil: 'never',
      value: -Infinity,
    },

    NaN: {
      description:
        'Not a Number, the result of an undefined or unrepresentable numeric operation.',
      type: 'number',
      isConstant: true,
      holdUntil: 'never',
      value: (engine) => engine.NaN,
    },

    ContinuationPlaceholder: {
      description:
        'This symbol indicates that some elements in a collection have been omitted, for example in a long list of numbers, or in an infinite set',
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
      type: 'finite_real',
      holdUntil: 'N',
      isConstant: true,
      value: { num: Number.EPSILON.toString() },
    },
    Half: {
      description: 'The rational number one half (1/2).',
      // NOT value-bracketed like `EulerGamma`: `holdUntil: 'never'` means
      // every use substitutes the literal `1/2` at canonicalization, whose
      // own handler-visible type already carries the exact value — a
      // ranged declaration here would never be read.
      type: 'finite_rational',
      isConstant: true,
      holdUntil: 'never',
      value: ['Rational', 1, 2],
    },
    GoldenRatio: {
      description: 'The golden ratio φ = (1+√5)/2 ≈ 1.618.',
      // Value-bracket ranged type. The value is the EXPRESSION `(1+√5)/2`,
      // whose static type cannot witness the bracket — the declaration is
      // accepted because standard-library definitions are TRUSTED
      // (user-ruled 2026-08-23) and validated empirically under
      // `console.assert` instead (`trustedValueInhabitsDeclaredType`).
      // The decimal bounds strictly bracket φ = 1.61803398874989484….
      type: 'finite_real<1.618033988749894..1.618033988749895>',
      wikidata: 'Q41690',
      isConstant: true,
      holdUntil: 'N',
      value: ['Divide', ['Add', 1, ['Sqrt', 5]], 2],
    },
    CatalanConstant: {
      description: "Catalan's constant G ≈ 0.9160.",
      // Value-bracket ranged type (G = 0.91596559417721901…); see
      // `GoldenRatio`.
      type: 'finite_real<0.915965594177219..0.9159655941772191>',
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
      keywords: ['euler-mascheroni', 'euler gamma'],
      // Value-bracket ranged type (γ = 0.57721566490153286…); see
      // `GoldenRatio`.
      type: 'finite_real<0.5772156649015328..0.5772156649015329>',
      wikidata: 'Q273023',
      holdUntil: 'N',
      isConstant: true,
      // γ is computed on demand to the engine's working precision via the
      // Brent–McMillan algorithm (`BigDecimal.EULER_GAMMA`). The prior
      // hardcoded ~858-digit literal capped γ-dependent results at higher
      // precision (ROADMAP B12). Machine mode uses the double value.
      value: (engine) =>
        engine.number(
          bignumPreferred(engine)
            ? BigDecimal.EULER_GAMMA
            : 0.5772156649015328606
        ),
    },
  },

  {
    PreIncrement: {
      description: 'Increment a number by one.',
      signature: '(number) -> number',
    },
    PreDecrement: {
      description: 'Decrement a number by one.',
      signature: '(number) -> number',
    },
  },

  //
  // Property predicates
  //

  {
    IsPrime: {
      description: '`IsPrime(n)` returns `True` if `n` is a prime number',
      wikidata: 'Q49008',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      evaluate: ([n], { engine }) => {
        const result = isPrime(n);
        if (result === undefined) return undefined;
        return engine.symbol(result ? 'True' : 'False');
      },
    },
    IsComposite: {
      description:
        '`IsComposite(n)` returns `True` if `n` is not a prime number',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      canonical: (ops, { engine }) => engine.expr(['Not', ['IsPrime', ...ops]]),
    },

    IsOdd: {
      description: '`IsOdd(n)` returns `True` if `n` is an odd number',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      evaluate: (ops, { engine }) => {
        let fail = false;
        const result = ops.every((op) => {
          if (op.im !== 0) return false;

          const b = asBigint(op);
          if (b !== null) return b % BigInt(2) !== BigInt(0);

          const n = op.re;
          if (Number.isInteger(n)) return n % 2 !== 0;

          fail = true;
          return false;
        });
        if (fail) return undefined;
        return engine.symbol(result ? 'True' : 'False');
      },
    },
    IsEven: {
      description: 'Even Number',
      complexity: 1200,
      broadcastable: true,
      signature: '(number) -> boolean',
      canonical: (ops, { engine }) => engine.expr(['Not', ['IsOdd', ...ops]]),
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
      // Integer operands → a positive integer; polynomial operands → a
      // (monic) polynomial whose type and sign aren't known statically.
      type: (ops) =>
        ops.every((x) => x.isInteger) ? 'finite_integer' : 'number',
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
      type: (ops) =>
        ops.every((x) => x.isInteger) ? 'finite_integer' : 'number',
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
      signature: '(number) -> number | nothing',
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
      evaluate: (ops, { engine }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op1.evaluate();
        return op.numerator;
      },
    },

    Denominator: {
      description: 'Denominator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      signature: '(number) -> number | nothing',
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
      evaluate: (ops, { engine }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return op.op2.evaluate();
        return op.denominator;
      },
    },

    NumeratorDenominator: {
      description: 'Sequence of Numerator and Denominator of an expression',
      complexity: 1200,
      broadcastable: true,

      lazy: true,
      signature: '(number) -> tuple<number, number> | nothing',
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
        const num = asRational(op.evaluate());
        if (num !== undefined)
          return engine.tuple(engine.number(num[0]), engine.number(num[1]));
        return engine._fn(
          'NumeratorDenominator',
          ops.map((x) => x.evaluate())
        );
      },

      evaluate: (ops, { engine }) => {
        const ce = engine;
        if (ops.length === 0) return ce.Nothing;
        const op = ops[0];
        if (
          (op.operator === 'Rational' || op.operator === 'Divide') &&
          isFunction(op)
        )
          return ce.tuple(...op.ops);

        return ce.tuple(...op.numeratorDenominator);
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
      // A data-consuming aggregate: it OWNS its `Missing` runtime (§3.C). An
      // absent datum (a `Missing` operand or element, or a `NaN`) or empty
      // input evaluates to `NaN` (I6 absorption). `missingStrip: 'all'` (the
      // default) lets a `Missing` operand validate against `(value*)`.
      missingBehavior: 'handle',
      typeHandlerKind: 'types',
      type: (ops) => extremumTypeOnTypes(ops),
      sgn: (ops) => {
        if (ops.some((x) => x.isReal == false || x.isNaN)) return 'unsigned';
        if (ops.some((x) => x.isReal == false || x.isNaN !== false))
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
      missingBehavior: 'handle',
      typeHandlerKind: 'types',
      type: (ops) => extremumTypeOnTypes(ops),
      sgn: (ops) => {
        if (ops.some((x) => x.isReal == false || x.isNaN)) return 'unsigned';
        if (ops.some((x) => x.isReal == false || x.isNaN !== false))
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
    ElementMax: {
      description:
        'Element-wise maximum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.',
      complexity: 1200,
      broadcastable: true,
      signature: '(number, number+) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: (ops, { numericApproximation }) =>
        foldExtremum(ops, true, numericApproximation === true),
    },

    ElementMin: {
      description:
        'Element-wise minimum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. Variadic.',
      complexity: 1200,
      broadcastable: true,
      signature: '(number, number+) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
      evaluate: (ops, { numericApproximation }) =>
        foldExtremum(ops, false, numericApproximation === true),
    },

    Clamp: {
      description:
        'Clamp a value to the range [lo, hi] = min(max(x, lo), hi). Broadcasts over collection arguments.',
      complexity: 1200,
      broadcastable: true,
      signature: '(number, number, number) -> number',
      typeHandlerKind: 'types',
      type: (ops) => numericTypeHandlerOnTypes(ops),
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
      missingBehavior: 'handle',
      typeHandlerKind: 'types',
      type: (ops) => extremumTypeOnTypes(ops),
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Supremum'),
    },

    Infimum: {
      description: 'Like Min, but defined for open sets',
      complexity: 1200,
      broadcastable: false, // The function take a variable number of arguments,
      // including collections

      signature: '(value*) -> number',
      missingBehavior: 'handle',
      typeHandlerKind: 'types',
      type: (ops) => extremumTypeOnTypes(ops),
      evaluate: (xs, { engine }) => evaluateMinMax(engine, xs, 'Infimum'),
    },

    Distance: {
      description:
        'Euclidean distance between two points, broadcasting over a list of points.',
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
      // handled in `evaluate` below: the §3.E gate cannot substitute the NaN
      // because a tuple operand IS a collection, which the gate defers to.
      missingBehavior: 'propagate',
      // A point-list operand broadcasts: one distance per point.
      type: ([a, b]) => {
        const pa = a ? isPointListType(a) : false;
        const pb = b ? isPointListType(b) : false;
        if (pa === true || pb === true)
          return { kind: 'list', elements: 'number' };
        // An operand that COULD be a list of points — an indexed collection
        // whose ELEMENT type is unknown, e.g. a base declared with the bare
        // `indexed_collection` type — must not be reported as the scalar: a
        // compile target that trusts a bare `number` here lowers
        // `Min(Distance(S, p))` to `Math.min(<array>)`, a silent `NaN` behind
        // `success: true` (Tycho item 143). Report the union instead, so the
        // consumer (and the lowering) sees that both shapes are possible.
        if (pa === undefined || pb === undefined)
          return 'number | list<number>';
        // Point-to-point: a distance is the norm of the difference, so it is
        // real whatever the coordinates are — and `number` (which admits
        // complex) is refused by every `real`-declared slot. Read off the
        // coordinates both literal points expose; a point-TYPED symbol has
        // none, and keeps the wide `number`.
        if (isFunction(a) && isFunction(b))
          return euclideanNormType([...a.ops, ...b.ops]);
        return 'number';
      },
      evaluate: ([a, b], { engine: ce, numericApproximation }) => {
        // An absent point absorbs: a distance is numeric, so the marker is
        // `NaN` (§3.C) — substituted here because the §3.E gate defers to the
        // collection operand (see `missingBehavior` above).
        if (isSymbol(a, 'Missing') || isSymbol(b, 'Missing')) return ce.NaN;
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
          const d = pointDistance(
            la ? la[i] : pa!,
            lb ? lb[i] : pb!,
            ce,
            numericApproximation
          );
          // A malformed point (a dimension mismatch, a non-finite coordinate)
          // is the whole call's error, not one element of the result list.
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
      // operator's BOUND variable, declared `integer` in its own scope.
      scoped: indexingSetSites(1, 'integer'),
      lazy: true,
      signature: '(any, tuple*) -> number',
      typeHandlerKind: 'types',
      type: bigOpResultTypeOnTypes,

      canonical: ([body, ...bounds], { scope }) =>
        canonicalBigop('Product', body, bounds, scope),

      evaluate: (ops, options) => {
        const ce = options.engine;
        // EL-4 (revised): see the matching comment in `Sum.evaluate` — an
        // infinite domain stays symbolic under exact evaluate (`.N()` owns
        // the truncated numeric path); free bounds/body are never enumerable.
        const numeric = options.numericApproximation;
        const bounds = ops.slice(1);
        const mode = classifyBigopDomain(ops[0], bounds, ce);
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
        return result?.evaluate({ numericApproximation: numeric }) ?? ce.NaN;
      },

      evaluateAsync: async (ops, options) => {
        const ce = options.engine;
        const numeric = options.numericApproximation;
        const bounds = ops.slice(1);
        {
          const mode = classifyBigopDomain(ops[0], bounds, ce);
          if (mode === 'symbolic') {
            if (bounds.length === 1) {
              // Degenerate bounds (`Π_{i=x}^{x}`): one term, no enumeration.
              const term = degenerateBigOpTerm(ops[0], bounds[0], numeric);
              // A capture-unsafe decline must NOT fall through: the closed
              // forms substitute the same way, without a capture guard.
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
            // Unestablished convergence stays unevaluated — see the matching
            // comment in the sync `evaluate` handler above.
            return undefined;
          }
        }
        // Capture-unsafe decline flag — see the Product sync handler.
        let captureUnsafe = false;
        const result = await runAsync(
          reduceBigOp(
            ops[0],
            bounds,
            (acc: Expression, x, bindings) => {
              const xe = evaluateBigOpTerm(x, bindings, numeric);
              if (xe === undefined) {
                captureUnsafe = true;
                return null;
              }
              return productAccumulate(acc, xe, numeric);
            },
            ce.One
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
        return result?.evaluate({ numericApproximation: numeric }) ?? ce.NaN;
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
      // operator's BOUND variable, declared `integer` in its own scope.
      scoped: indexingSetSites(1, 'integer'),
      lazy: true,
      signature: '(any, tuple*) -> number',
      typeHandlerKind: 'types',
      type: bigOpResultTypeOnTypes,

      canonical: ([body, ...bounds], { scope, engine: ce }) => {
        // Arity-1 collection-reducer form: bypass canonicalBigop, which would
        // rewrite Sum(L) as Reduce(L, 'Add', 0). Keeping the `Sum` head lets
        // dot-notation serialization (`L.total`) round-trip.
        if (bounds.length === 0) {
          const canon = body?.canonical;
          if (canon?.isCollection) return ce._fn('Sum', [canon]);
        }
        return canonicalBigop('Sum', body, bounds, scope);
      },

      evaluate: ([first, ...rest], { engine, numericApproximation }) => {
        // Arity-1 collection-reducer form: Sum(L).
        if (rest.length === 0 && first?.isCollection) {
          // Non-finite collections stay symbolic — infinite iteration would
          // hang the thread and bypass `engine._timeRemaining`. A finite
          // collection whose iterator declines (symbolic elements) would
          // silently fold to 0 — stay symbolic too.
          if (first.isFiniteCollection !== true) return undefined;
          // The decline is read off the fold's OWN walk (below) rather than
          // probed first: probing starts a second enumeration, which re-runs
          // the element callback of a lazy `Map`/`Filter` once more than there
          // are elements.
          let walked = 0;
          const result = run(
            reduceCollection(first, engine.Zero, (acc, x) => {
              walked += 1;
              return sumAccumulate(
                acc,
                x.evaluate({ numericApproximation }),
                numericApproximation
              );
            }),
            engine._timeRemaining,
            engine._deadlineFrame
          );
          if (enumerationDeclinedAfterWalk(first, walked)) return undefined;
          return result?.evaluate({ numericApproximation }) ?? engine.NaN;
        }

        // Big-op form: Sum(body, [i, a, b], …).
        // EL-4 (revised): an infinite (capped) domain is only a truncated
        // approximation — it has no exact value, so exact `evaluate()` stays
        // symbolic and `.N()` owns the numeric path. Free (symbolic) bounds
        // or a body with free variables beyond the index are never
        // enumerable, under either mode.
        const numeric = numericApproximation;
        const mode = classifyBigopDomain(first, rest, engine);
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
        const result = run(
          reduceBigOp(
            first,
            rest,
            (acc: Expression, x, bindings) => {
              const term = evaluateBigOpTerm(x, bindings, numeric);
              if (term === undefined) {
                captureUnsafe = true;
                return null;
              }
              return sumAccumulate(acc, term, numeric);
            },
            engine.Zero
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
        // Re-evaluate to combine numeric terms (e.g., 3x + 1 + 2 + 3 → 3x + 6).
        return (
          result?.evaluate({ numericApproximation: numeric }) ?? engine.NaN
        );
      },

      evaluateAsync: async (
        [first, ...rest],
        { engine, signal, numericApproximation }
      ) => {
        // Arity-1 collection-reducer form: Sum(L).
        if (rest.length === 0 && first?.isCollection) {
          if (first.isFiniteCollection !== true) return undefined;
          // Decline read off the fold's own walk — see the sync handler.
          let walked = 0;
          const result = await runAsync(
            reduceCollection(first, engine.Zero, (acc, x) => {
              walked += 1;
              return sumAccumulate(
                acc,
                x.evaluate({ numericApproximation }),
                numericApproximation
              );
            }),
            engine._timeRemaining,
            signal,
            engine._deadlineFrame
          );
          if (enumerationDeclinedAfterWalk(first, walked)) return undefined;
          return result?.evaluate({ numericApproximation }) ?? engine.NaN;
        }

        const numeric = numericApproximation;
        {
          const mode = classifyBigopDomain(first, rest, engine);
          if (mode === 'symbolic') {
            if (rest.length === 1) {
              // Degenerate bounds (`Σ_{i=x}^{x}`): one term, no enumeration.
              const term = degenerateBigOpTerm(first, rest[0], numeric);
              // A capture-unsafe decline must NOT fall through: the closed
              // forms substitute the same way, without a capture guard.
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
        const result = await runAsync(
          reduceBigOp(
            first,
            rest,
            (acc: Expression, x, bindings) => {
              const term = evaluateBigOpTerm(x, bindings, numeric);
              if (term === undefined) {
                captureUnsafe = true;
                return null;
              }
              return sumAccumulate(acc, term, numeric);
            },
            engine.Zero
          ),
          engine._timeRemaining,
          signal,
          engine._deadlineFrame
        );
        if (captureUnsafe) return undefined;
        if (result === NON_ENUMERABLE_DOMAIN) return undefined;
        if (result === NON_ENUMERABLE_BOUNDS)
          return bigOpBoundsError(engine, rest);
        return (
          result?.evaluate({ numericApproximation: numeric }) ?? engine.NaN
        );
      },
    },

    Interpret: {
      description:
        'Interpret a notational expression as its mathematical meaning. In v1: a continuation-bearing `Add`/`Multiply` (e.g. `1 + 2 + \\dots + n`) becomes a `Sum`/`Product`. Returns the argument unchanged when the (strict) inference gate does not pass',
      complexity: 9000,
      broadcastable: false,

      // The argument is an inert notational object; keep it unevaluated so the
      // recognizer sees the original operand order and structure.
      lazy: true,
      signature: '(any) -> any',

      evaluate: ([arg]) => {
        if (!arg) return undefined;
        return inferContinuationPattern(arg) ?? arg;
      },
    },
  },
];

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

/** Accumulate one term of a `Sum` without the `.add()` float-folding pitfall.
 *
 * The `.add()` **method** folds two exact-but-non-combinable number literals
 * (e.g. `1 + √2`, `2 + √3`) into a machine float. For `Sum().evaluate()` we
 * want to preserve exactness, so when both operands are exact literals whose
 * sum is *not* exact we build a symbolic `Add` instead. A canonical `Add` still
 * folds combinable exact operands (integers, rationals, like radicals), so a
 * numeric sum such as `Sum(k, 1..n)` keeps the accumulator to a single literal
 * (O(1) memory) while `Sum(√k, 1..5)` stays exact (`3 + √2 + √3 + √5`).
 *
 * Under `numericApproximation` (i.e. `.N()`), folding to a float is the desired
 * behavior and no symbolic accumulation is done.
 */
function sumAccumulate(
  acc: Expression,
  term: Expression,
  numericApproximation: boolean | undefined
): Expression {
  const err = reducerElementError(acc, term);
  if (err) return err;
  const sum = acc.add(term);
  if (numericApproximation) return sum;
  // Only two exact number literals can be silently floated by `.add()`. Once
  // `acc` is a symbolic `Add`, `.add()` already keeps the result symbolic.
  if (
    isNumber(acc) &&
    acc.isExact &&
    isNumber(term) &&
    term.isExact &&
    isNumber(sum) &&
    !sum.isExact
  )
    return acc.engine.function('Add', [acc, term]);
  return sum;
}

/** Generator-based reducer over a finite collection. Yields between
 * iterations so callers can wrap it with `run`/`runAsync` for timeout
 * and cancellation. Caller is responsible for finiteness checks.
 */
function* reduceCollection(
  collection: Expression,
  init: Expression,
  combine: (acc: Expression, x: Expression) => Expression
): Generator<Expression, Expression> {
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
  const coords: Expression[] = [];
  for (const el of x.each()) {
    if (!isNumber(el)) return undefined;
    coords.push(el);
  }
  return coords;
}

/**
 * The points of `xs` read as a LIST of points, or `undefined` when `xs` is not
 * one. Both spellings broadcast: a list of tuples `[(0,0),(3,4)]` and the list
 * of lists `[[0,0],[3,4]]` a data import produces (Tycho item 138).
 */
function pointListOperand(
  xs: Expression
): readonly (readonly Expression[])[] | undefined {
  if (xs.isFiniteCollection !== true || xs.isIndexedCollection !== true)
    return undefined;
  const count = xs.count;
  if (count === undefined || count > MAX_DISTANCE_BROADCAST) return undefined;
  const points: (readonly Expression[])[] = [];
  for (const el of xs.each()) {
    const p = pointOperand(el);
    if (p === undefined) return undefined;
    points.push(p);
  }
  return points;
}

/** Whether the STATIC type of `x` says it holds a list of points — used by
 *  the `Distance` type handler to report the broadcast result type.
 *  Three-valued: `true` when proven, `false` when ruled out, and `undefined`
 *  when it CANNOT be decided statically (Tycho item 143). */
function isPointListType(x: Expression): boolean | undefined {
  const t = x.type.type;
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
  // A tuple, a nested list, or a union of those: an element that is itself an
  // indexed collection is a point.
  return isSubtype(elt, INDEXED_COLLECTION_SHAPE_TYPE);
}

/** The Euclidean distance between two points, as an EXPRESSION:
 *  √(Σ (aᵢ − bᵢ)²) built and evaluated once, so the exact path is honored
 *  (`Distance((0,0),(1,1)) → √2`, not the machine float) — mirroring `Hypot`.
 *  `.N()` still numericizes. */
function pointDistance(
  a: readonly Expression[],
  b: readonly Expression[],
  ce: ComputeEngine,
  numericApproximation?: boolean
): Expression {
  if (a.length !== b.length || a.length === 0)
    return ce.error('incompatible-dimensions');
  const terms: Expression[] = [];
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (
      !isNumber(ai) ||
      !isNumber(bi) ||
      ai.isFinite === false ||
      bi.isFinite === false
    )
      return ce.error('expected-value');
    terms.push(
      ce.function('Power', [ce.function('Subtract', [ai, bi]), ce.number(2)])
    );
  }
  return ce
    .function('Sqrt', [ce.function('Add', terms)])
    .evaluate({ numericApproximation });
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
  if (isNumber(arg)) {
    const num = arg.numericValue;
    if (typeof num === 'number') return ce.number(Math.abs(num));
    // Exact modulus of a Gaussian (integer) complex number:
    // |a+bi| = √(a²+b²), built exactly (`|1+i| → √2`) instead of the machine
    // hypot float. `Abs(3+4i)` already gave 5 because 25 is a perfect square;
    // this extends the exact path to every integer a, b. `.N()` numericizes.
    if (num.im !== 0) {
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
    }
    return ce.number(num.abs());
  }
  if (arg.isNonNegative) return arg;
  if (arg.isNegative) return arg.neg();

  // Exact modulus of a complex expression with radical/rational real and
  // imaginary parts, e.g. |3 − √7 + i√(6√7 − 15)| → 1 (W. Kahan). Split
  // z = a + b·i, then |z| = √(a² + b²) with the square expanded so exact
  // arithmetic folds the radicals. Fire only when the squared modulus folds
  // to a concrete non-negative real number AND the exact result matches |z|
  // numerically — this rejects an incorrect real/imaginary split (e.g. a
  // radical whose radicand is actually negative, so √(…) is itself imaginary)
  // and keeps every non-reducing complex `Abs` symbolic.
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
      const parts = splitComplexParts(arg);
      if (parts) {
        const [a, b] = parts;
        const m = ce.function('Add', [
          ce.function('Multiply', [a, a]),
          ce.function('Multiply', [b, b]),
        ]);
        const mVal = expand(m).evaluate();
        if (isNumber(mVal) && mVal.im === 0 && mVal.isNonNegative === true) {
          const modSq = zre * zre + zim * zim;
          const mn = mVal.re;
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
 * Split a complex expression `z` into `[a, b]` such that `z = a + b·i`, with
 * `a` and `b` real expressions, or `undefined` if `z` cannot be put in that
 * form structurally. The realness of `a` and `b` is not fully trusted here (a
 * `Sqrt` of an unresolved-sign radicand reports `isReal === true`
 * optimistically); callers confirm the split numerically before relying on it.
 */
function splitComplexParts(
  z: Expression
): [Expression, Expression] | undefined {
  const ce = z.engine;

  // A numeric leaf. Its `.json` is a lossless exact representation: a complex
  // exact number serializes as `['Complex', reExpr, imExpr]` with exact-shape
  // components (e.g. `['Complex', 0, ['Sqrt', 3]]`), so boxing them preserves
  // the radicals. A real number contributes only a real part.
  if (isNumber(z)) {
    const j = z.json;
    if (Array.isArray(j) && j[0] === 'Complex')
      return [ce.box(j[1]), ce.box(j[2])];
    return [z, ce.Zero];
  }

  if (isFunction(z)) {
    const op = z.operator;

    if (op === 'Add') {
      const as: Expression[] = [];
      const bs: Expression[] = [];
      for (const t of z.ops) {
        const p = splitComplexParts(t);
        if (!p) return undefined;
        as.push(p[0]);
        bs.push(p[1]);
      }
      return [ce.function('Add', as), ce.function('Add', bs)];
    }

    if (op === 'Negate') {
      const p = splitComplexParts(z.op1);
      if (!p) return undefined;
      return [p[0].neg(), p[1].neg()];
    }

    if (op === 'Subtract') {
      const p1 = splitComplexParts(z.op1);
      const p2 = splitComplexParts(z.op2);
      if (!p1 || !p2) return undefined;
      return [
        ce.function('Subtract', [p1[0], p2[0]]),
        ce.function('Subtract', [p1[1], p2[1]]),
      ];
    }

    if (op === 'Multiply') {
      let a: Expression = ce.One;
      let b: Expression = ce.Zero;
      for (const t of z.ops) {
        const p = splitComplexParts(t);
        if (!p) return undefined;
        const [fa, fb] = p;
        // (a + b·i)(fa + fb·i) = (a·fa − b·fb) + (a·fb + b·fa)·i
        const na = ce.function('Subtract', [
          ce.function('Multiply', [a, fa]),
          ce.function('Multiply', [b, fb]),
        ]);
        const nb = ce.function('Add', [
          ce.function('Multiply', [a, fb]),
          ce.function('Multiply', [b, fa]),
        ]);
        a = na;
        b = nb;
      }
      return [a, b];
    }

    if (op === 'Complex') return [z.op1, z.op2];
  }

  // A leaf: treat it as a real contribution. If it is in fact imaginary (an
  // unresolved-sign radical), the caller's numeric confirmation rejects the
  // split.
  return [z, ce.Zero];
}

function processMinMaxItem(
  item: Expression,
  mode: 'Min' | 'Max' | 'Supremum' | 'Infimum'
): [Expression | undefined, ReadonlyArray<Expression>] {
  const ce = item.engine;
  const upper = mode === 'Max' || mode === 'Supremum';

  // An interval is continuous
  if (isFunction(item, 'Interval')) {
    const b = upper ? item.op2 : item.op1;

    if (!b.isNumber || !isNumber(b)) return [undefined, [item]];
    return [b, []];
  }

  // A range is discrete, the last element may not be included
  if (item.operator === 'Range') {
    // Symbolic bounds (e.g. Range(1, n)): the extremum is indeterminate
    if (hasSymbolicRangeBounds(item)) return [undefined, [item]];
    if (upper) {
      const r = range(item);
      const last = rangeLast(r);
      return [ce.number(Math.max(r[0], last)), []];
    } else {
      return [ce.number(range(item)[0]), []];
    }
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
    // whose only element is 1. A zero-sample `Linspace` has no extremum at
    // all; it is an empty collection, which the absent-datum gate answers as
    // `NaN` before this runs — declining here too is consistent either way.
    if (count === 0) return [undefined, [item]];
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
    for (const op of item.each()) {
      walked += 1;
      const [val, others] = processMinMaxItem(op, mode);
      if (val) {
        // NaN absorbs, mirroring the top-level convention: an indeterminate
        // element makes the whole extremum indeterminate (Max([1, NaN, 3]) →
        // NaN, matching Max(1, NaN, 3)). Returning NaN as this item's value
        // lets the caller's top-level NaN check absorb it.
        if (val.isNaN) return [ce.NaN, []];
        // A non-real (complex) value is unordered: keep it symbolic rather
        // than silently absorbing it in an order-dependent way.
        if (val.im !== 0) rest.push(val);
        else if (!result) result = val;
        else {
          if (
            (upper && val.isGreater(result)) ||
            (!upper && val.isLess(result))
          )
            result = val;
        }
      }
      rest.push(...others);
    }
    if (enumerationDeclinedAfterWalk(item, walked)) return [undefined, [item]];
    return [result, rest];
  }

  if (!item.isNumber || !isNumber(item)) return [undefined, [item]];
  return [item, []];
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
  if (a.isNaN === true || b.isNaN === true) return ce.NaN;
  if ((isNumber(a) && a.im !== 0) || (isNumber(b) && b.im !== 0))
    return undefined;
  // `isGreater`/`isLess` return `undefined` when the comparison is not
  // decidable (a free symbol); ties keep `a`.
  const bWins = upper ? b.isGreater(a) : b.isLess(a);
  if (bWins === undefined) return undefined;
  const winner = bWins ? b : a;
  return numericApproximation ? winner.N() : winner;
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

  // Absent-datum / empty-input gate (§3.C): any absent datum (`Missing` or
  // `NaN`, scalar operand or flattened element) or empty input ⇒ `NaN`.
  const absent = aggregateAbsence(ce, ops);
  if (absent) return absent;

  ops = flatten(ops);

  if (ops.length === 0)
    return upper ? ce.NegativeInfinity : ce.PositiveInfinity;

  let result: Expression | undefined = undefined;
  const rest: Expression[] = [];

  for (const op of ops) {
    const [val, others] = processMinMaxItem(op, mode);
    if (val) {
      // NaN absorbs: Min/Max of an indeterminate value is indeterminate.
      // (Comparisons with NaN are themselves indeterminate, so without this
      // guard a NaN operand would be silently dropped.)
      if (val.isNaN) return ce.NaN;
      // A non-real (complex) value is unordered. Ordering comparisons return
      // `undefined` for it, which previously left it silently absorbed in an
      // order-dependent way (Max(i, 2) = i but Max(2, i) = 2). Keep it symbolic
      // instead so both operand orders agree.
      if (val.im !== 0) rest.push(val);
      else if (!result) result = val;
      else {
        if ((upper && val.isGreater(result)) || (!upper && val.isLess(result)))
          result = val;
      }
    }
    rest.push(...others);
  }

  if (rest.length > 0)
    return ce.expr(result ? [mode, result, ...rest] : [mode, ...rest]);
  // No orderable value and nothing left symbolic: every operand contributed no
  // data at all, i.e. the input was EMPTY. That is an absent result (`NaN`)
  // under the §3.C aggregate rule, not an identity element — `Max([])` is not
  // `-Infinity`. The absent-datum gate above answers this case whenever it can
  // decide emptiness itself; it DECLINES for a collection whose emptiness only
  // a walk can settle (a lazy `Filter`), which is why the verdict is repeated
  // here off the walk this function just performed.
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

  // Exactness contract: an inexact (float) argument numericizes, like
  // `cos(5.1) → 0.377`. GCD/LCM of non-integer reals fold via the tolerant
  // floating Euclidean algorithm (`realGcd`/`realLcm`, ε = REAL_GCD_TOLERANCE).
  // Applies only when every operand is a finite real number and at least one is
  // inexact; exact integers/rationals and symbolic operands keep their
  // exact/symbolic paths.
  if (
    ops.length > 0 &&
    ops.some((x) => isNumber(x) && !x.isExact) &&
    ops.every((x) => isNumber(x) && Number.isFinite(x.re) && !x.im)
  ) {
    const rfn = mode === 'LCM' ? realLcm : realGcd;
    let acc = Math.abs(ops[0].re);
    for (let i = 1; i < ops.length; i++) acc = rfn(acc, ops[i].re);
    return ce.number(acc);
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
