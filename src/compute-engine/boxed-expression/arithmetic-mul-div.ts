import { isSubtype } from '../../common/type/subtype.js';
import { BigDecimal } from '../../big-decimal/index.js';

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  elementFloatMask,
  isMatrixProductOfValues,
  isTensorValue,
  isLazyCollectionOfUnknownElements,
  absentCellsAsNaN,
  isNumericVectorSource,
  lazyCollectionAsList,
  lazyCollectionRank,
  numericCollectionAsList,
  tensorShape,
  packTensor,
  tensorCellExpression,
} from './tensor-view.js';
import { machineNumberOf, isExactNonInteger } from './machine-number.js';
import { sgn } from './sgn.js';
import { isStoredAsDouble } from './machine-broadcast.js';
import {
  bignumPreferred,
  hasAssignedVariable,
  indeterminateAnswerReadsVariable,
} from './utils.js';
import {
  isNumber,
  isFunction,
  isString,
  isSymbol,
  isAbsentSymbol,
  isAbsentArithmeticOperand,
  numericValue,
  isContinuationOperand,
  containsContinuationOperand,
  isNotationalProduct,
  isInexactOperand,
  nanOperandAnswer,
  indeterminateFormAnswer,
} from './type-guards.js';
import { asFloat, hasFloatOperand } from './float-result.js';
import {
  isImaginaryPartFinite,
  isImaginaryUnitValue,
} from './imaginary-part.js';
import {
  isTuple,
  isTupleCarrier,
  isPointListCarrier,
  pointListCarrierArity,
  tupleCarrierArity,
  couldBeNumericTuple,
  numericTupleArity,
  hasAccessibleComponents,
  isFiniteBroadcastParticipant,
  isBroadcastableCollection,
  isUnknownLengthBroadcast,
  hasUnresolvedCollectionOperand,
  isUnresolvedCollectionOperand,
  lazyBroadcastMap,
  isBroadcastCollectionType,
  broadcastLengthMismatch,
  broadcastOverIndexedCollections,
  typeMayCarryQuotientShape,
  isTupleWithListCoordinate,
  isAbsentScalarTerm,
  isCollectionShaped,
} from '../collection-utils.js';
import { NumericValue } from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import type { Rational } from '../numerics/types.js';
import {
  add as rationalAdd,
  mul as rationalMul,
  asMachineRational,
  inverse,
  isOne,
  isInteger as isIntegerRational,
  neg,
  isNeg,
  rationalGcd,
  reducedRational,
  isZero,
} from '../numerics/rationals.js';
import {
  isOutsideNormalDoubleRange,
  SMALL_INTEGER,
} from '../numerics/numeric.js';
import { bigint } from '../numerics/bigint.js';

import {
  hasCollectionShape,
  mayBeTensorProductOperand,
  sortProductOperands,
} from './order.js';
import { asRadical, isMatrixTyped } from './arithmetic-power.js';
import { mayBeMatrixPowerBase, typeMayHoldMatrix } from './matrix-operand.js';
import {
  flatten,
  flattenHoldingBarriers,
  flattenKeepingNotationalProducts,
} from './flatten.js';
import { asRational, asSmallInteger } from './numerics.js';
import { heldNonNumericScalar } from './value-membership.js';
import { negateProduct } from './negate.js';
import { addArray } from './arithmetic-add.js';
import { holdsKindValue } from './residue-class.js';
import { kindArithmetic } from './kind-dispatch.js';
import { isMergeable } from './effects-of.js';

// Maximum number of decimal digits allowed in a *materialized* exact power
// folded into a product's coefficient. Beyond this the factor is kept symbolic
// (an inert `Power` term) instead of being computed — mirrors the identical
// guard in `arithmetic-power.ts`. Building a multi-million-digit integer is
// pathological (and can overflow `bigint`); `.N()` still yields the float /
// overflow-to-infinity.
const MAX_EXACT_POW_DIGITS = 1_000_000;

/** (Rough upper bound on) the decimal digit count of an integer value. */
function integerDigitCount(v: bigint | number): number {
  if (typeof v === 'bigint') return (v < 0n ? -v : v).toString().length;
  if (!Number.isFinite(v)) return Infinity;
  const a = Math.abs(v);
  return a < 1 ? 1 : Math.floor(Math.log10(a)) + 1;
}

/**
 * Would materializing `base^exp` (an exact base with a rational exponent)
 * exceed the digit budget? If so, the caller keeps the factor symbolic rather
 * than folding it into the product's coefficient.
 */
function exactPowExceedsBudget(base: NumericValue, exp: Rational): boolean {
  const e = reducedRational(exp);
  const exponent = Math.abs(Number(e[0]) / Number(e[1]));
  if (Number.isNaN(exponent)) return false;
  const exact = base.asExact;
  if (!(exact instanceof ExactNumericValue)) return false;
  const baseDigits = Math.max(
    integerDigitCount(exact.rational[0]),
    integerDigitCount(exact.rational[1]),
    integerDigitCount(exact.radical)
  );
  return baseDigits * exponent > MAX_EXACT_POW_DIGITS;
}

/**
 * Split a real exact value `q·√r`, with `r > 1` and `q ≠ 1`, into its
 * rational part `q` and its radical part `√r`. Return `undefined` for any
 * other value: a value that is not exact, a complex value, a rational, or a
 * radical with no rational part (`√r`).
 *
 * A product folds a radical factor into its coefficient only when the
 * result is an exact value, and an exact value holds one radical. When two
 * radicals cannot combine (`√1009·√1013`), the products use this split to
 * keep only the radical as a separate factor and to fold the rational part
 * into the coefficient: `2√1009·3√1013` is `6√1009·√1013`.
 */
function splitRationalRadical(
  v: NumericValue
): [NumericValue, NumericValue] | undefined {
  if (!(v instanceof ExactNumericValue) || v.isComplex) return undefined;
  if (v.radical === 1 || isOne(v.rational)) return undefined;
  return [
    v.clone({ rational: v.rational, radical: 1 }),
    v.clone({ rational: [1, 1], radical: v.radical }),
  ];
}

/**
 * Structural check: is `op` the number literal `n`?
 *
 * The structure of a canonical expression must never depend on a symbol's
 * transient value — a fold is only sound when the operand is the literal
 * itself. `.isSame()` is strictly syntactic (a symbol never compares equal to
 * a literal), so a bare `.isSame(n)` could no longer mis-fold; the `isNumber`
 * guard is kept because it states the intent and short-circuits cheaply.
 *
 * For `n = ±1` the literal must also be exact. A float `1` (the literal `1.0`)
 * is not removed from a product or a quotient: like any other float factor it
 * makes the product numeric, so `1.0x` stays a product with a float
 * coefficient, as `2.0x` does, and `1.0/3` is a float quotient. A float `0`
 * still absorbs the product, as an exact `0` does.
 */
function isLiteral(op: Expression, n: number): boolean {
  if (!isNumber(op)) return false;
  if (n !== 0 && !op.isExact) return false;
  return op.isSame(n);
}

/**
 * Whether the numerator `x` of a quotient by zero is provably not zero, so
 * that `x/0` is a pole and folds to `ComplexInfinity`. A numerator that may be
 * zero keeps the quotient: `x/0` is `0/0`, the indeterminate form, when `x`
 * is 0. With `x: real` and no value, `x/0` stays `x/0` until `x` has a value
 * (user decision of 2026-10-23, ROADMAP CE-95).
 *
 * A number literal other than 0 is not zero (the caller handles the literal
 * 0 and `NaN` first). Any other numerator is not zero when its sign, known
 * from its type and the assumptions, excludes 0: `positive` (`π`,
 * `x^2 + 1` with `x: real`, `e^x`), `negative`, or `not-zero` (a symbol
 * declared `real & !0`, or one with the assumption `d ≠ 0`).
 * A numerator that reads a variable with an assigned value keeps the
 * quotient, because its sign comes from the value that the variable holds
 * now, and a canonical form must not depend on that value: with `a := 5`, a
 * folded `a/0` stayed `ComplexInfinity` after `a := 0`.
 */
function isProvablyNonZeroNumerator(x: Expression): boolean {
  if (isNumber(x)) return !x.isNaN && !x.isSame(0);
  const s = sgn(x);
  if (s !== 'positive' && s !== 'negative' && s !== 'not-zero') return false;
  return !hasAssignedVariable(x);
}

/**
 * The exponent `x` of a power (or the index of a root) as a rational, when
 * it is exact. A float exponent is not read as a rational, also when its
 * value is an integer: `x^{2.0}` keeps its float exponent, and is grouped as
 * a term with an exponent that is not a rational, as `x^{2.5}` is. Reading
 * `2.0` as the rational `2` made `3x^{2.0}` evaluate to `3x^2`.
 */
function exactRationalExponent(x: Expression): Rational | undefined {
  if (isNumber(x) && !x.isExact) return undefined;
  return asRational(x);
}

//
// ── Product class ──────────────────────────────────────────────────────
//

/**
 * Group terms in a product by common term.
 *
 * All the terms should be canonical.
 * - the arguments should have been flattened for `Multiply`
 *
 * - any argument of power been distributed, i.e.
 *      (ab)^2 ->  a^2 b^2
 * *
 * 3 + √5 + √(x+1) + x^2 + (a+b)^2 + d
 *  -> [ [[3, "d"], [1, 1]],
 *       [[5, "x+1"], [1, 2]],
 *       [[1, "a+b"], [2, 1]]
 *      ]
 *
 */

/**
 * Is the factor `x` of a product a matrix or another collection, or can its
 * value be a matrix by its type (`typeMayHoldMatrix()`: `any`,
 * `broadcastable<number>`, `number | matrix`), or is it a power of such a
 * factor? The matrix product does not commute, so a product with such a
 * factor does not move a factor that may be a matrix past another one:
 * `p·q·p` is not `p^2·q`.
 */
function isMatrixFactor(x: Expression): boolean {
  if (hasCollectionShape(x) || typeMayHoldMatrix(x)) return true;
  return (
    isFunction(x, 'Power') &&
    (hasCollectionShape(x.op1) || typeMayHoldMatrix(x.op1))
  );
}

/**
 * A term of a `Product`: a base and its exponent.
 *
 * `quotient` is `true` when a negative exponent was added to the term by a
 * quotient (`Divide(1, g(x))`, `div()`), not by a negative power
 * (`Power(g(x), -1)`). For a term that can be a matrix, the two are
 * different: the quotient is element-wise, the power is the matrix inverse
 * (see `isMatrixInversePower()`).
 */
type ProductTerm = {
  term: Expression;
  exponent: Rational;
  quotient?: boolean;
};

export class Product {
  engine: ComputeEngine;

  // Running literal products (if canonical)
  coefficient: NumericValue;

  // Other terms of the product, `term` is the key (see `ProductTerm`). The
  // list is read-only outside `addTerm` and `removeTermAt`, so that every
  // change to it also changes `termIndex`. The fields of an entry can be
  // changed in place.
  private _terms: ProductTerm[] = [];
  get terms(): ReadonlyArray<ProductTerm> {
    return this._terms;
  }

  /** The entries of `terms` whose `term` has a given hash, in the order of
   * `terms`. `findTerm` reads only the entries with the hash of its
   * argument, so finding the term of a factor does not scan all the terms:
   * the scan made a product of n distinct symbols take a time of the order
   * of n². This is correct because two expressions that are `isSame` have
   * the same hash. Entries with the same hash that are not `isSame` (a hash
   * collision) are told apart by the `isSame` test in `findTerm`. Every
   * change to `terms` goes through `addTerm` and `removeTermAt`, which keep
   * this index up to date. */
  private termIndex = new Map<number, ProductTerm[]>();

  // If `false`, the running products are not calculated
  private _isCanonical = true;

  // The `NaN` coefficient absorbs the product, and its answer is `NaN`,
  // except that a product whose `NaN` came from an `Indeterminate` factor,
  // with no inexact factor (a float, the `NaN` literal, an absent value), is
  // `Indeterminate`: `2·Indeterminate` is `Indeterminate` and
  // `Indeterminate·2.0` is `NaN`, as a float operand makes a numeric result
  // a float. `_nanFromIndeterminate` is `true` when the coefficient became
  // `NaN` from `Indeterminate` factors only, `false` when another `NaN`-valued
  // factor was seen, and `undefined` when no factor made it `NaN` (the
  // coefficient product itself did). `_sawInexact` records an inexact factor
  // at any position, before or after the `NaN`.
  private _nanFromIndeterminate: boolean | undefined = undefined;
  private _sawInexact = false;
  // `true` when the coefficient became `NaN` because the product is an
  // indeterminate form of its own (`0·∞`, `0·~oo`), not because of a
  // `NaN`-valued factor. Such a product is `Indeterminate` when no factor is
  // inexact (`0·∞`), and `NaN` otherwise (`0.0·∞`).
  private _indeterminateForm = false;

  // The operands given to the constructor. `hasMatrixFactor()` reads them to
  // know if a matrix comes later in the product than the term being tallied.
  private readonly _operands: ReadonlyArray<Expression> | undefined;

  // `true` when this product is a part of a larger product that has a
  // matrix (the option `matrixContext`). A factor that can be a matrix
  // (`g(x)`) then keeps its order, although no factor of this part is a
  // matrix: see `expandProducts()`.
  private readonly _matrixContext: boolean;

  // The answer of `hasMatrixFactor()`, or `undefined` before it is first
  // computed. Terms are only added to a product, so the answer can change
  // only from `false` to `true`: `mul()` sets it to `true` when it receives a
  // matrix after the answer was computed.
  private _hasMatrix: boolean | undefined = undefined;

  static from(expr: Expression): Product {
    return new Product(expr.engine, [expr]);
  }

  constructor(
    ce: ComputeEngine,
    xs?: ReadonlyArray<Expression>,
    readonly options?: { canonical?: boolean; matrixContext?: boolean }
  ) {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;
    this._isCanonical = options.canonical!;
    this._matrixContext = options.matrixContext === true;

    this.engine = ce;
    this.coefficient = ce._numericValue(1);
    this._operands = xs;

    if (xs) for (const x of xs) this.mul(x);
  }

  /**
   * Is a factor of this product a matrix (or another collection)? The terms
   * tallied so far are read, and the operands given to the constructor
   * (with the operands of a `Multiply` operand), since a matrix can come
   * after the term being tallied. It is also `true` when this product is a
   * part of a larger product that has a matrix (`_matrixContext`). The
   * answer is computed once, and kept in `_hasMatrix`.
   */
  private hasMatrixFactor(): boolean {
    this._hasMatrix ??=
      this._matrixContext ||
      this.terms.some((t) => isMatrixFactor(t.term)) ||
      (this._operands ?? []).some(
        (x) =>
          isMatrixFactor(x) ||
          (isFunction(x, 'Multiply') && x.ops.some(isMatrixFactor))
      );
    return this._hasMatrix;
  }

  /**
   * Can the term `x` be a matrix that does not commute with another factor
   * of this product? This is `true` for a matrix (or another collection),
   * and, in a product that has a matrix, for a term whose type does not
   * exclude a matrix (`g(x)` with `g` a function that was not declared, see
   * `mayBeTensorProductOperand()`). In a product with no matrix, such a term
   * is a scalar, as before.
   */
  private isNoncommutingTerm(x: Expression): boolean {
    if (hasCollectionShape(x)) return true;
    return mayBeTensorProductOperand(x) && this.hasMatrixFactor();
  }

  /**
   * Add a term to the product.
   *
   * If `this._isCanonical` a running product of exact terms is kept.
   * Otherwise, terms and their exponent are tallied.
   */
  mul(term: Expression, exp?: Rational, inversePower = false) {
    console.assert(term.isCanonical || term.isStructural);
    if (this._hasMatrix === false && isMatrixFactor(term))
      this._hasMatrix = true;
    if (isInexactOperand(term) || isAbsentSymbol(term)) this._sawInexact = true;
    // Only a NUMBER LITERAL whose value is `NaN` makes the coefficient `NaN`.
    // `isNaN` of a symbol reads its current value, and a product built from
    // the symbol must not depend on it (with `w := NaN`, `w·2` stayed `NaN`
    // after `w := 4`): the symbol stays a factor, and `evaluate()` reads its
    // value.
    if (this.coefficient.isNaN) {
      if (isNumber(term) && term.isNaN && !term.isIndeterminate)
        this._nanFromIndeterminate = false;
      return;
    }

    if (isNumber(term) && term.isNaN) {
      this._nanFromIndeterminate = term.isIndeterminate;
      this.coefficient = this.engine._numericValue(NaN);
      return;
    }

    if (isFunction(term, 'Multiply')) {
      const e = exp ? reducedRational(exp) : ([1, 1] as Rational);
      if (
        !isIntegerRational(e) &&
        Number(e[1]) % 2 === 0 &&
        term.ops.some((o) => isNumber(o) && o.isNegative === true)
      ) {
        // (k·u)^(p/q) with k < 0 and q even: k^(p/q) is a complex phase,
        // and splitting it off is only sound when the cofactor is ≥ 0 —
        // √(k·u)/√u would collapse to the CONSTANT √k, but the true value
        // is region-dependent (±√k across u = 0). Tally opaquely, like
        // (−u)^(p/q) above.
        this.tally(term, e);
        return;
      }
      for (const t of term.ops) this.mul(t, exp, inversePower);
      return;
    }

    if (isFunction(term, 'Negate')) {
      const e = exp ? reducedRational(exp) : ([1, 1] as Rational);
      if (!isIntegerRational(e)) {
        // (−u)^(p/q): the −1 cannot be split off — (−1)^(p/q) is a complex
        // phase, not ±1 (e.g. (−u)^(1/4) ≠ −u^(1/4)). Tally opaquely.
        this.tally(term, e);
        return;
      }
      this.mul(term.op1, exp, inversePower);
      // (−u)^k = (−1)^k·u^k: sign only flips for odd integer exponents
      if (Number(e[0]) % 2 !== 0) this.coefficient = this.coefficient.neg();
      return;
    }

    if (this._isCanonical) {
      if (isSymbol(term, 'Nothing')) return;

      exp ??= [1, 1];

      // If we're calculating a canonical product, fold exact literals into
      // running terms
      const num = numericValue(term);
      if (num !== undefined) {
        // An exact 1 is dropped; a float 1 folds into the coefficient below
        if (isLiteral(term, 1)) return;

        if (term.isSame(0)) {
          // infinity * 0 -> NaN (indeterminate form). The unsigned complex
          // infinity counts too. Canonical sorting places `~oo` before the
          // zero, so `Multiply(~oo, 0)` — and with it every broadcast
          // element such as `[0,1]·~oo` — reaches this arm with `~oo`
          // already in the coefficient; without the `isComplexInfinity`
          // disjunct it collapsed to 0. The reverse order, `Multiply(0,
          // ~oo)`, already answered NaN through the zero-coefficient check
          // in the isInfinity arm below.
          if (
            this.coefficient.isPositiveInfinity ||
            this.coefficient.isNegativeInfinity ||
            this.coefficient.isComplexInfinity
          ) {
            this._indeterminateForm = true;
            this.coefficient = this.engine._numericValue(NaN);
            return;
          }
          // A float `0` absorbs the product and keeps it a float: `0.0·x`
          // is the float `0`. A zero exponent is the indeterminate form `0^0`.
          if (isZero(exp)) this._indeterminateForm = true;
          this.coefficient =
            isZero(exp) || !isNumber(term) || term.isExact
              ? this.engine._numericValue(isZero(exp) ? NaN : 0)
              : this.engine._numericValue(num);
          return;
        }

        if (isLiteral(term, -1)) {
          if (isOne(exp)) this.coefficient = this.coefficient.neg();
          else {
            this.coefficient = this.coefficient.mul(
              this.engine._numericValue(-1).pow(this.engine._numericValue(exp))
            );
          }
          return;
        }

        if (term.isInfinity) {
          // 0 * infinity -> NaN (indeterminate form)
          if (this.coefficient.isZero) {
            this._indeterminateForm = true;
            this.coefficient = this.engine._numericValue(NaN);
            return;
          }
          if (isOne(exp)) {
            // `~oo` first, because it has NO direction and so cannot take a
            // sign from the coefficient: 2·~oo, -2·~oo and i·~oo are all
            // `~oo`. The signed rule below would answer `+oo` for the first
            // and `-oo` for the second, which contradicts `Negate(~oo)` —
            // that correctly stays `~oo`, so `-2·~oo` and `-(2·~oo)` used to
            // disagree. An infinity with a non-zero imaginary part is exactly
            // the undirected one: a real ±∞ has `im === 0`, and a value like
            // `∞ + i` (finite imaginary part) boxes to the real `+∞`
            // (`canonicalNumber()`).
            //
            // A NON-REAL coefficient reaches the same place from the other
            // side: it turns a real ±∞ off the real line, and the product
            // keeps no sign either (`i · ln(0)` is `~oo`, not `-oo`). The
            // signed rule below cannot express that — `sgn()` of a non-real
            // coefficient is `undefined`, which it reads as positive.
            if (
              (isNumber(term) && term.isComplex) ||
              this.coefficient.isComplex
            ) {
              this.coefficient = this.engine._numericValue({
                re: Infinity,
                im: Infinity,
              });
              return;
            }
            // Multiply the signs: coef * infinity
            // e.g., -2 * +∞ = -∞, 2 * -∞ = -∞, -2 * -∞ = +∞
            const coefSign = this.coefficient.sgn() ?? 1;
            const termSign = term.isNegative ? -1 : 1;
            const resultSign = coefSign * termSign;
            this.coefficient = this.engine._numericValue(
              resultSign < 0 ? -Infinity : Infinity
            );
          } else this.addTerm({ term, exponent: exp });
          return;
        }

        if (isOne(exp)) {
          if (!this.foldIntoCoefficient(num, true)) this.tally(term, exp);
        } else if (exactPowExceedsBudget(this.engine._numericValue(num), exp)) {
          // Materializing this exact power would exceed the digit budget:
          // keep it symbolic (an inert Power term) rather than folding it
          // into the coefficient — mirrors the guard in arithmetic-power.ts,
          // and avoids a `Maximum BigInt size exceeded` throw.
          this.addTerm({ term, exponent: exp });
        } else {
          // An exact number raised to a fractional power folds into the
          // coefficient only when the power is exact (`8^(2/3)` is `4`).
          // Otherwise it stays a symbolic `Power` term: `2^(2/3)` computed
          // as a float would make the product of exact operands a float.
          const base = this.engine._numericValue(num);
          const power = base.pow(this.engine._numericValue(exp));
          if (base.isExact && !power.isExact && !isIntegerRational(exp))
            this.tallyNumericPower(term, exp);
          else if (!this.foldIntoCoefficient(power, !isNeg(exp)))
            this.tally(term, exp);
        }
        return;
      }

      const radical = asRadical(term);
      if (radical !== null) {
        // √(p/q) = √(p·q)/q. The radicand `p·q` of an exact numeric value
        // is a safe integer. When it is not (`√(1 + 10⁻³⁰)`, where `p·q`
        // has 61 digits), or when the value is not exact (a radicand with
        // a large square-free part is held as a float), the factor stays a
        // symbolic term: a float would round it, and `2·√(1 + 10⁻³⁰) − 2`
        // was an exact `0`.
        const radicand = BigInt(radical[0]) * BigInt(radical[1]);
        const denominator = BigInt(radical[1]);
        if (
          radicand > BigInt(Number.MAX_SAFE_INTEGER) ||
          denominator > BigInt(Number.MAX_SAFE_INTEGER)
        ) {
          this.tally(term, exp);
          return;
        }
        const root = this.engine._numericValue({
          radical: Number(radicand),
          rational: [1, Number(denominator)],
        });
        if (!root.isExact) {
          this.tally(term, exp);
          return;
        }
        const factor = root.pow(this.engine._numericValue(exp));
        if (!this.foldIntoCoefficient(factor, !isNeg(exp)))
          this.tally(term, exp);
        return;
      }

      // √(−c), with `c` a positive integer, is the exact imaginary value
      // `i·√c`. It is folded into the coefficient as the square root of a
      // positive integer is above. The numeric value takes the square
      // factors out of `c` (`√(−52000000) = 2000·√13·i`), so an integer
      // coefficient is folded as a rational one is:
      // `2000·√(−13) = 2000·√13·i`. A radicand whose square-free part is
      // above 10⁶ has no exact value: the factor stays a symbolic term. Only
      // an integer exponent is folded: `(−13)^(1/4)` is not `(i·√13)^(1/2)`
      // in general.
      if (
        isFunction(term, 'Sqrt') &&
        isNumber(term.op1) &&
        term.op1.isExact &&
        isIntegerRational(exp)
      ) {
        const radicand = asRational(term.op1);
        if (
          radicand !== undefined &&
          radicand[1] == 1 &&
          radicand[0] < 0 &&
          radicand[0] >= -Number.MAX_SAFE_INTEGER
        ) {
          const root = this.engine._numericValue({
            radical: Number(radicand[0]),
          });
          if (root.isExact) {
            const factor = root.pow(this.engine._numericValue(exp));
            if (factor.isExact && this.foldIntoCoefficient(factor)) return;
          }
          this.tally(term, exp);
          return;
        }
      }

      if (!isSymbol(term)) {
        // Skip numeric coefficient extraction for symbolic radicals like √2, ∛2, 2^{1/3}
        // These should stay symbolic rather than evaluating to floats
        const isSymbolicRadical =
          isFunction(term) &&
          (term.operator === 'Sqrt' ||
            term.operator === 'Root' ||
            term.operator === 'Power') &&
          isNumber(term.op1);

        if (!isSymbolicRadical) {
          // If possible, factor out a rational coefficient
          const [coef, rest] = term.toNumericValue();
          // ...but not a negative one under an even fractional power:
          // (−1)^(p/q) with q even is a complex phase (e.g. e^{iπ/4}),
          // and NumericValue.pow would apply the real-root convention,
          // silently turning (−u)^(1/4) into −u^(1/4)
          const e = exp ? reducedRational(exp) : ([1, 1] as Rational);
          const evenRootOfNegative =
            !isIntegerRational(e) &&
            Number(e[1]) % 2 === 0 &&
            coef.sgn() === -1;
          const power =
            exp && !isOne(exp)
              ? coef.pow(this.engine._numericValue(exp))
              : coef;
          if (
            !evenRootOfNegative &&
            coef.isExact &&
            !power.isExact &&
            !isIntegerRational(e)
          ) {
            // An exact coefficient under a fractional power whose value is
            // not exact (`2^(2/3)` in `(2x + 2)^(2/3)`) is kept as a
            // symbolic `Power` term, not folded as a float:
            // `(2x + 2)^(2/3)` is `2^(2/3)·(x + 1)^(2/3)`.
            if (!coef.isOne) {
              this.tallyNumericPower(this.engine.number(coef), e);
              term = rest;
            }
          } else if (!evenRootOfNegative && this.foldIntoCoefficient(power))
            term = rest;
        }
      }
    }

    // Note: term should be positive, so no need to handle the -1 case.
    // (isLiteral for the value-independent folds. `.isSame()` is strictly
    // syntactic, so the `isSame(0) === false` guard admits ANY non-literal
    // base to the x^0 → 1 fold — a generic-symbol fold like x/x → 1: `z^0`
    // canonicalizes to 1 even while `z := 0`. Only the literal `0^0` falls
    // through and canonicalizes to NaN.)
    // An exact 1 is dropped at any exponent: `exp` is a rational, and 1 to a
    // rational power is 1. The numerator of `(1/x)^2` reaches here as `1`
    // with the exponent 2; kept as a term, it was written as a factor
    // `1\times` next to a float coefficient, which does not fold with it.
    if (isLiteral(term, 1)) return;
    if (term.isSame(0) === false && exp && isZero(exp)) return;
    if (isLiteral(term, 0)) {
      if (exp && isZero(exp)) this.coefficient = this.engine._numericValue(NaN);
      else this.coefficient = this.engine._numericValue(0);
      return;
    }

    const exponent: Rational = exp ?? [1, 1];

    // A matrix (or another collection) raised to a non-integer power is
    // element-wise, but `Multiply` of two matrices is the matrix product. So
    // the base and the exponent of `√A`, `∛A` or `A^{1/3}` are not extracted
    // for a collection `A`: `√A·√A` is not `A`. The term is tallied as it is,
    // and `√A·√A` becomes `(√A)^2`, the matrix power. An integer power of a
    // matrix is the matrix power, and is extracted as for a scalar.
    const collectionShaped =
      isFunction(term) &&
      (term.operator === 'Power' ||
        term.operator === 'Sqrt' ||
        term.operator === 'Root') &&
      isCollectionShaped(term);

    // `MatrixPower(A, n)` with a positive integer `n` is the matrix product
    // `A·A·…·A` of `n` factors. It is read as the base `A` with the exponent
    // `n`, so that it merges with a factor of the same base: `A^2·A^3` is
    // `A^5` and `A·A^2` is `A^3`. The powers of one matrix commute with each
    // other, but not with another matrix: the tally below does not merge two
    // factors when a different matrix is between them (`A^2·B·A^3` stays as
    // it is). Only a positive `n` in a product with a positive integer
    // exponent is read. `MatrixPower(A, 0)` is the identity matrix, not the
    // number `1`, and the merge of a positive and a negative power
    // (`A^2·A^{-1} = A`) is correct only when `A` is invertible.
    //
    // The base is tallied as one factor: it is not given to `mul()` again,
    // because `mul()` splits a product into its factors and gives the
    // exponent to each one. `(A·B)^2` is `A·B·A·B`, not `A^2·B^2`. For the
    // same reason, a `MatrixPower` whose base is a product is not read: it
    // stays one factor with the exponent `1`.
    if (
      isFunction(term, 'MatrixPower') &&
      isMatrixTyped(term.op1) &&
      !isFunction(term.op1, 'Multiply')
    ) {
      const n = exactRationalExponent(term.op2);
      const outer = reducedRational(exponent);
      if (
        n !== undefined &&
        isIntegerRational(reducedRational(n)) &&
        !isNeg(n) &&
        !isZero(n) &&
        isIntegerRational(outer) &&
        !isNeg(outer) &&
        !isZero(outer)
      ) {
        this.tallyInOrder(term.op1, rationalMul(outer, n));
        return;
      }
    }

    // If this is a power expression, extract the exponent
    if (isFunction(term, 'Power')) {
      // Term is `Power(op1, op2)`. The exponent is read as a rational only
      // when it is exact (`exactRationalExponent()`).
      const r = exactRationalExponent(term.op2);
      if (r) {
        // Don't extract non-integer exponents for numeric bases
        // This would cause 2^{3/5} to evaluate numerically instead of staying symbolic
        // Only extract when: base is not a number, or exponent is an integer
        const baseIsNumeric = isNumber(term.op1);
        const expIsInteger = r[1] === 1 || r[1] === -1; // denominator is ±1

        // Folding `(base^r)^exponent` → `base^(r·exponent)` can lose the
        // sign of the base: (x²)^(-1/2) is 1/|x|, not 1/x. Mirror the
        // canonicalPower()/pow() gate: fold only when the outer exponent is
        // an integer, the inner exponent is an odd integer (sign-preserving),
        // or the base is known non-negative.
        const outer = reducedRational(exponent);
        const numeratorIsOdd =
          typeof r[0] === 'bigint' ? r[0] % 2n !== 0n : r[0] % 2 !== 0;
        const foldIsSound =
          outer[1] == 1 ||
          outer[1] == -1 ||
          (expIsInteger && numeratorIsOdd) ||
          term.op1.isNonNegative === true;

        // A negative power of a base that can be a matrix (`g(x)^{-2}` in
        // `A·g(x)^{-2}·A`) is kept as one term, which keeps its position. A
        // term with a negative exponent goes to the denominator of the
        // quotient that `asNumeratorDenominator()` makes, and
        // `(A·A)/g(x)^2` is a different value.
        const product = rationalMul(exponent, r);
        if (
          foldIsSound &&
          (!baseIsNumeric || expIsInteger) &&
          (!collectionShaped || expIsInteger) &&
          !(isNeg(product) && this.isNoncommutingTerm(term.op1))
        ) {
          // A negative integer power of a base that can be a matrix is
          // tallied as a power, not as a quotient (see `quotient`)
          this.mul(
            term.op1,
            product,
            inversePower ||
              (isNeg(product) &&
                isIntegerRational(product) &&
                mayBeMatrixPowerBase(term.op1))
          );
          return;
        }
        // Otherwise, keep the Power expression as a single term
      }
    }

    if (isFunction(term, 'Sqrt')) {
      // Term is `Sqrt(op1)`
      // Don't extract non-integer exponents for numeric bases
      // This keeps √2 symbolic instead of evaluating to 1.414...
      const baseIsNumeric = isNumber(term.op1);
      if (!baseIsNumeric && !collectionShaped) {
        this.mul(term.op1, rationalMul(exponent, [1, 2]));
        return;
      }
      // Otherwise, keep the Sqrt expression as a single term
    }

    if (isFunction(term, 'Root')) {
      // Term is `Root(op1, op2)`
      const r = exactRationalExponent(term.op2);
      if (r) {
        // Don't extract non-integer exponents for numeric bases
        // This keeps ∛2 symbolic instead of evaluating to 1.259...
        const baseIsNumeric = isNumber(term.op1);
        if (!baseIsNumeric && !collectionShaped) {
          this.mul(term.op1, rationalMul(exponent, inverse(r)));
          return;
        }
        // Otherwise, keep the Root expression as a single term
      }
    }

    if (isFunction(term, 'Divide')) {
      // In order to correctly account for the denominator, invert it.
      // For example, in the case `a^4/a^2' we want to add
      // `a^(-2)` to the product, not `1/a^2`. The former will get the exponent
      // extracted, while the latter will consider the denominator as a
      // separate term.
      //
      // For a FRACTIONAL exponent the split (u/v)^r → u^r·v^(−r) flips
      // the principal branch when v < 0 ((u/v)^(1/4) vs u^(1/4)·v^(−1/4)
      // differ by a phase) — only split when sound.
      //
      // A denominator that can be a matrix (see `isNoncommutingTerm()`) is
      // not split either. The quotient of two matrices is element-wise, and
      // so is `1/M`: it is not the inverse of `M`. So `A/M` is not `A·M^{-1}`,
      // and `(A/g(x))·A` is not `(A·A)/g(x)`. The quotient is tallied as one
      // term, which keeps its position in the product.
      //
      // A quotient by the number 0 is not split either. `canonicalDivide`
      // keeps `x/0` when `x` may be zero, and its value is `0/0` or a pole
      // depending on `x`. Split, the factor `0^{-1}` reached the zero arm
      // above, which made the whole product 0: `(x/0)/2` was 0.
      const e = reducedRational(exponent);
      if (
        (isIntegerRational(e) || term.op2.isNonNegative === true) &&
        !this.isNoncommutingTerm(term.op2) &&
        !isLiteral(term.op2, 0)
      ) {
        this.mul(term.op1, exponent);
        this.mul(term.op2, neg(exponent));
        return;
      }
      // fall through: tally the Divide expression as an opaque term
    }

    // Unify numeric-base radical representations for a positive rational base
    // so same-base factors combine exactly: `Root(2,3)` and `Power(2,2/3)` both
    // tally on base 2, and 1/3 + 2/3 = 1 gives `2^1 → 2`. The materialization
    // path (termsAsExpression) rebuilds `base^exp` symbolically, so a lone
    // radical stays exact (e.g. `2^{1/3}` → `Root(2,3)`).
    let tallyTerm = term;
    let tallyExp = exponent;
    const norm = numericRadicalBaseExp(term);
    if (norm && norm.base.isPositive === true) {
      tallyTerm = norm.base;
      tallyExp = rationalMul(exponent, norm.exp);
    }

    this.tallyInOrder(tallyTerm, tallyExp, inversePower);
  }

  /**
   * Look for the base `tallyTerm`, and add `tallyExp` to its exponent if it
   * is already in the list of terms. Otherwise, add it as a new term.
   *
   * The matrix product is not commutative, so a matrix (or another
   * collection) is not merged with an earlier term of the same base when a
   * different collection-shaped term is between them: `A·B·A` is not
   * `A^2·B`, and `√A·B·√A` is not `(√A)^2·B`. Scalar terms commute with all
   * terms, so they do not prevent the merge.
   *
   * Two terms of the same collection-shaped base are also not merged when
   * one exponent is positive and the other is negative: `A^2·A^{-1}` is `A`
   * only when `A` is invertible. A term with the exponent `0` would be
   * dropped as if it were the number `1`, but `A^0` is the identity matrix.
   *
   * In a product that has a matrix, a term whose type does not exclude a
   * matrix (`g(x)` with `g` a function that was not declared) is also not
   * moved past a matrix or past another such term: `A·g(x)·A` is not
   * `A^2·g(x)`, and `g(x)·A·g(x)` is not `g(x)^2·A`. Two such terms with
   * the same base and exponents of opposite signs are not merged either:
   * `A·g(x)^{-1}·g(x)·A` is not `A^2`.
   */
  private tallyInOrder(
    tallyTerm: Expression,
    tallyExp: Rational,
    inversePower = false
  ): void {
    // A negative exponent that does not come from a negative power is a
    // quotient (see `quotient`)
    const quotient = isNeg(tallyExp) && !inversePower;
    const tallyShaped = hasCollectionShape(tallyTerm);
    const noncommuting = tallyShaped || this.isNoncommutingTerm(tallyTerm);
    // A term that commutes with all the terms merges with the first term of
    // the same base, found from the index. A term that does not commute
    // reads the terms between the two, so it scans the list.
    if (!noncommuting) {
      const x = this.findTerm(tallyTerm);
      if (x) {
        x.exponent = rationalAdd(x.exponent, tallyExp);
        if (quotient) x.quotient = true;
      } else
        this.addTerm(
          quotient
            ? { term: tallyTerm, exponent: tallyExp, quotient }
            : { term: tallyTerm, exponent: tallyExp }
        );
      return;
    }
    let found = false;
    for (const [i, x] of this.terms.entries()) {
      if (!x.term.isSame(tallyTerm)) continue;
      // A term that draws is never merged (see `findTerm`).
      if (!isMergeable(tallyTerm)) break;
      // A different term between the two that does not commute with them
      if (
        this.terms.some(
          (y, j) =>
            j > i &&
            !y.term.isSame(tallyTerm) &&
            (tallyShaped
              ? hasCollectionShape(y.term) || mayBeTensorProductOperand(y.term)
              : this.isNoncommutingTerm(y.term))
        )
      )
        continue;
      // One exponent is positive and the other is negative: when the term
      // is a matrix, the two powers do not cancel in general
      if (isNeg(x.exponent) !== isNeg(tallyExp)) continue;
      x.exponent = rationalAdd(x.exponent, tallyExp);
      if (quotient) x.quotient = true;
      found = true;
      break;
    }
    if (!found)
      this.addTerm(
        quotient
          ? { term: tallyTerm, exponent: tallyExp, quotient }
          : { term: tallyTerm, exponent: tallyExp }
      );
  }

  /**
   * Multiply `factor` into the running coefficient and return `true`, or
   * return `false` and leave the coefficient unchanged when the product
   * would lose exactness.
   *
   * An `ExactNumericValue` holds one radical times a Gaussian rational
   * (`√2·(1 + i)`). The radicand is at most 10⁶ (`SMALL_INTEGER`). The
   * product of two exact values is not exact when it leaves this set: the
   * radicand of `√1009·√1013` is 1022117, which has no square factor, and
   * `√2·(1 + i)·√3·i` has two different radicals. `ExactNumericValue.mul`
   * then returns a float. This method returns `false` instead, so that the
   * caller keeps the factor as a separate term and the product stays exact.
   *
   * Before it returns `false`, it looks for a number term that was kept
   * separate in this way and whose product with `factor` is exact
   * (`√1013·√1013 = 1013`). It removes that term and folds the product of
   * the two in its place.
   *
   * When `splitRadical` is `true` and no such term is found, a real factor
   * `q·√r` is split instead: `q` is folded into the coefficient, `√r` is
   * added as a separate number term, and the method returns `true`.
   */
  private foldIntoCoefficient(
    factor: number | NumericValue,
    splitRadical = false
  ): boolean {
    const product = this.coefficient.mul(factor);
    if (
      typeof factor !== 'number' &&
      !product.isExact &&
      !product.isNaN &&
      this.coefficient.isExact &&
      factor.isExact
    ) {
      const i = this.terms.findIndex(
        (t) =>
          isNumber(t.term) &&
          t.term.isExact &&
          t.term.isFinite === true &&
          (isOne(t.exponent) || isOne(neg(t.exponent))) &&
          this.termValue(t).mul(factor).isExact
      );
      if (i < 0) {
        // With `splitRadical`, only the radical of a real factor is kept
        // separate, and its rational part is folded into the coefficient:
        // `1009√1009·1013√1013` is `1022117·√1009·√1013`. The callers pass
        // it only for a factor of the numerator. The value of a factor of
        // the denominator is rationalized (`1/√1013` is `√1013/1013`), and
        // a split of it would rewrite the quotient `√1009/√1013`, which the
        // canonical `Divide` keeps, as `√1009·√1013/1013`.
        const split = splitRadical ? splitRationalRadical(factor) : undefined;
        if (split === undefined) return false;
        const scaled = this.coefficient.mul(split[0]);
        if (!scaled.isExact) return false;
        this.coefficient = scaled;
        if (!this.foldIntoCoefficient(split[1]))
          this.tally(this.engine.number(split[1]), [1, 1]);
        return true;
      }
      const paired = this.termValue(this.terms[i]).mul(factor);
      this.removeTermAt(i);
      if (!this.foldIntoCoefficient(paired))
        this.tally(this.engine.number(paired), [1, 1]);
      return true;
    }
    this.coefficient = product;
    return true;
  }

  /** The value of a number term with the exponent `1` or `-1`. */
  private termValue(t: { term: Expression; exponent: Rational }): NumericValue {
    const v = this.engine._numericValue(numericValue(t.term)!);
    return isOne(t.exponent) ? v : v.inv();
  }

  /**
   * Add an exact number raised to a fractional power (`2^(2/3)`, `∛2`) as one
   * symbolic factor, with the exponent `1` or `-1`. Tallied as the number
   * with the exponent `p/q`, it is grouped with the other terms that have
   * the same exponent: `2^(1/3)·x^(1/3)` becomes `∛(2x)`, which the inverse
   * and root operations split again into `∛2·∛x`, and inverting such a
   * product did not terminate.
   */
  private tallyNumericPower(base: Expression, exponent: Rational): void {
    const e = reducedRational(exponent);
    const negative = isNeg(e);
    const power = this.engine.function('Power', [
      base,
      this.engine.number(negative ? neg(e) : e),
    ]);
    this.tally(power, negative ? [-1, 1] : [1, 1]);
  }

  /** Add `exponent` to the exponent of `term`, or add `term` as a new term. */
  private tally(term: Expression, exponent: Rational): void {
    const x = this.findTerm(term);
    if (x) x.exponent = rationalAdd(x.exponent, exponent);
    else this.addTerm({ term, exponent });
  }

  /** The first entry of `terms` whose `term` is the same as `term`, read
   * from `termIndex`.
   *
   * A term that draws (`Random()`, a call of a function with the `random`
   * effect) has no like term: two draws are two independent values, and
   * `Random()·Random()` is not `Random()²`. The test is made only when an
   * entry was found, so a product with no repeated term does not pay for it.
   */
  private findTerm(term: Expression): ProductTerm | undefined {
    const x = this.termIndex.get(term.hash)?.find((x) => x.term.isSame(term));
    return x !== undefined && isMergeable(term) ? x : undefined;
  }

  /** Add `entry` at the end of `terms`, and to `termIndex`. */
  private addTerm(entry: ProductTerm): void {
    this._terms.push(entry);
    const h = entry.term.hash;
    const bucket = this.termIndex.get(h);
    if (bucket) bucket.push(entry);
    else this.termIndex.set(h, [entry]);
  }

  /** Remove the entry at position `i` of `terms`, and from `termIndex`. */
  private removeTermAt(i: number): void {
    const entry = this._terms[i];
    if (entry === undefined) return;
    this._terms.splice(i, 1);
    const h = entry.term.hash;
    const bucket = this.termIndex.get(h);
    const j = bucket ? bucket.indexOf(entry) : -1;
    console.assert(j >= 0, 'Product: the term index lost an entry of terms');
    if (!bucket || j < 0) return;
    bucket.splice(j, 1);
    if (bucket.length === 0) this.termIndex.delete(h);
  }

  /** Divide the product by a term of coefficient */
  div(term: NumericValue | Expression) {
    if (term instanceof NumericValue)
      this.coefficient = this.coefficient.div(term);
    else this.mul(term, [-1, 1]);
  }

  /** The terms of the product, grouped by degrees.
   *
   * If `mode` is `rational`, rationals are split into separate numerator and
   * denominator, so that a rational expression can be created later
   * If `mode` is `expression`, a boxed expression is returned, without
   * splitting rationals
   * If `mode` is `numeric`, the literals are combined into one expression
   *
   */
  groupedByDegrees(options?: { mode?: 'rational' | 'expression' | 'numeric' }):
    | {
        exponent: Rational;
        terms: Expression[];
        /** A negative power of a term that can be a matrix, kept as a
         * power (see `isMatrixInversePower()`) */
        inversePower?: boolean;
      }[]
    | null {
    options ??= {};
    if (!('mode' in options)) options.mode = 'expression';
    const mode = options.mode;

    if (
      mode === 'numeric' &&
      (this.coefficient.isNegativeInfinity ||
        this.coefficient.isPositiveInfinity)
    )
      return [];

    //
    // Add the coefficient
    //
    if (this.coefficient.isZero) return [];
    const ce = this.engine;

    // If we have no terms (i.e. it's a literal), just return the coeff
    if (this.terms.length === 0) {
      if (mode === 'numeric') {
        const c = this.coefficient.N();
        return [{ exponent: [1, 1], terms: [ce.number(c)] }];
      } else {
        return [{ exponent: [1, 1], terms: [ce.number(this.coefficient)] }];
      }
    }

    const xs: {
      exponent: Rational;
      terms: Expression[];
      inversePower?: boolean;
    }[] = [];
    // A float coefficient of 1 (from the literal `1.0`) is kept: it makes the
    // product numeric, as any other float coefficient does.
    if (!this.coefficient.isOne || !this.coefficient.isExact) {
      if (
        mode === 'rational' &&
        this.coefficient.isExact &&
        this.coefficient.type === 'rational'
      ) {
        // Numerator
        const num = this.coefficient.numerator;
        if (!num.isOne) xs.push({ exponent: [1, 1], terms: [ce.number(num)] });
        // Denominator
        const denom = this.coefficient.denominator;
        if (!denom.isOne)
          xs.push({ exponent: [-1, 1], terms: [ce.number(denom)] });
      } else if (mode === 'numeric') {
        const c = this.coefficient.N();
        xs.push({ exponent: [1, 1], terms: [ce.number(c)] });
      } else {
        xs.push({ exponent: [1, 1], terms: [ce.number(this.coefficient)] });
      }
    }

    //
    // Other terms
    //
    // groups created by a non-mergeable fractional-power term: other
    // terms with the same exponent must not join them
    const sealed = new Set<number>();
    for (const t of this.terms) {
      // Exponent of 0 indicate a term that has been simplified, i.e. `x/x`
      const exponent = reducedRational(t.exponent);
      if (exponent[0] === 0) continue;
      // Grouping same-exponent terms renders them as (u·v)^r. For
      // fractional r that merge is only sound when the term is known
      // non-negative: (−u)^(1/4)·v^(1/4) ≠ (−u·v)^(1/4) in general (the
      // principal-branch phases differ).
      //
      // A matrix (or another collection) is never grouped with another term:
      // the matrix product is not commutative, so `A^2·B^2` is not
      // `(A·B)^2`, and `A^2·B·A^2` is not `(A·A)^2·B`. Each such term is a
      // group of its own, and the groups keep the order of the terms. In a
      // product that has a matrix, a term whose type does not exclude a
      // matrix (`g(x)`) is also a group of its own: `g(x)·A·h(x)` is not
      // `g(x)·h(x)·A`.
      //
      // A negative integer power of a term that can be a matrix (`g(x)^{-1}`,
      // see `mayBeMatrixPowerBase()`) is also a group of its own: it stays a
      // power of that term, which is the matrix inverse when the term is a
      // matrix (`asNumeratorDenominator()` keeps it in the numerator).
      const inversePower = isMatrixInversePower(t, exponent);
      const shaped = this.isNoncommutingTerm(t.term) || inversePower;
      const mergeable =
        !shaped &&
        (isIntegerRational(exponent) || t.term.isNonNegative === true);
      let found = false;
      if (mergeable) {
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i];
          if (
            !sealed.has(i) &&
            exponent[0] === x.exponent[0] &&
            exponent[1] === x.exponent[1]
          ) {
            x.terms.push(t.term);
            found = true;
            break;
          }
        }
      }
      if (!found) {
        if (!mergeable) sealed.add(xs.length);
        xs.push(
          inversePower
            ? { exponent, terms: [t.term], inversePower }
            : { exponent, terms: [t.term] }
        );
      }
    }
    return xs;
  }

  asExpression(
    options: { numericApproximation: boolean } = { numericApproximation: false }
  ): Expression {
    const ce = this.engine;

    const coef = this.coefficient;
    if (coef.isNaN)
      return options.numericApproximation ? ce.NaN : this._nanAnswer();
    if (coef.isZero) {
      // `0 · x → 0` is sound for any term that could still be a NUMBER at
      // run time (a free symbol, a `value`-typed operand). But a term whose
      // type PROVES it is neither a number nor numeric-broadcastable — a
      // concrete string or boolean substituted at evaluation time, e.g.
      // `0a` with `a: value` bound to `"hello"` — must not be absorbed:
      // collapsing would convert a type error into a plain `0`. Arithmetic
      // is deliberately permissive at boxing time (`checkNumericArgs`
      // admits could-be-a-number operands), so this is where the mistake
      // surfaces. Absence markers are exempt: they propagate, not error.
      // A term that is already an error (the evaluated value of `Sin((A, B))`
      // with `A`, `B` lists) is the result as it is. Wrapping it in a second
      // `incompatible-type` error ("expected `number`, got `error`") hides
      // the real error.
      const error = this.terms.find((t) => t.term.operator === 'Error');
      if (error !== undefined) return error.term;
      const nonNumeric = this.terms.find((t) =>
        t.term.type.isDisjointFrom(
          'number | indexed_collection<number> | missing | nothing'
        )
      );
      if (nonNumeric !== undefined)
        return ce.typeError('number', nonNumeric.term.type, nonNumeric.term);
      // A float `0` coefficient gives a float `0` (`0.0·x`)
      return coef.isExact ? ce.Zero : ce.number(coef);
    }

    if (coef.isPositiveInfinity || coef.isNegativeInfinity) {
      const infinity = coef.isPositiveInfinity
        ? ce.PositiveInfinity
        : ce.NegativeInfinity;
      // A bare infinite literal (no symbolic factors) → the signed infinity.
      if (this.terms.length === 0) return infinity;
      // `∞ · (remaining factors)`: the result's sign follows the sign of the
      // remaining factors' product. A provably-zero factor makes it the
      // indeterminate form `0 · ∞ = NaN`; an unknown sign must stay symbolic
      // (do NOT collapse `x · ∞` to `∞`, which is wrong for `x < 0` or `x = 0`).
      this.coefficient = ce._numericValue(1);
      const grouped = this.groupedByDegrees({
        mode: options.numericApproximation ? 'numeric' : 'expression',
      });
      this.coefficient = coef;
      if (grouped === null) return ce.NaN;
      const rest = termsAsExpression(ce, this._matrixContext, grouped);
      if (isLiteral(rest, 0)) return this._formAnswer(rest);
      if (rest.isPositive === true) return infinity;
      if (rest.isNegative === true)
        return coef.isPositiveInfinity
          ? ce.NegativeInfinity
          : ce.PositiveInfinity;
      return ce._fn('Multiply', [infinity, rest]);
    }

    // If the coef is -1, temporarily set it to 1 (only an exact -1: a float
    // -1 is kept as a coefficient, as any other float coefficient is)
    const isNegativeOne = coef.isNegativeOne && coef.isExact;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const groupedTerms = this.groupedByDegrees({
      mode: options.numericApproximation ? 'numeric' : 'expression',
    });
    if (groupedTerms === null) return ce.NaN;

    // If the coef is -1, negate the expression and reset the coef
    if (isNegativeOne) {
      const result = termsAsExpression(
        ce,
        this._matrixContext,
        groupedTerms
      ).neg();
      this.coefficient = ce._numericValue(-1);
      return result;
    }

    return termsAsExpression(ce, this._matrixContext, groupedTerms);
  }

  /** The answer of a product whose coefficient is `NaN`: see
   * `_nanFromIndeterminate` and `_indeterminateForm`. */
  private _nanAnswer(): Expression {
    const fromIndeterminate =
      this._nanFromIndeterminate === true ||
      (this._nanFromIndeterminate === undefined && this._indeterminateForm);
    return fromIndeterminate && !this._sawInexact
      ? this.engine.Indeterminate
      : this.engine.NaN;
  }

  /** The answer of the form `∞·0`, where the factors other than the infinite
   * coefficient multiply to the literal `rest` = 0: `Indeterminate`, or `NaN`
   * when a factor is inexact (`indeterminateFormAnswer()`). */
  private _formAnswer(rest: Expression): Expression {
    return this._sawInexact
      ? this.engine.NaN
      : indeterminateFormAnswer(this.engine, [rest]);
  }

  /** The product, expressed as a numerator and denominator */
  asNumeratorDenominator(): [Expression, Expression] {
    const ce = this.engine;
    const coef = this.coefficient;
    // A NaN coefficient absorbs the whole product, as in `asExpression()`.
    // `mul()` stops accumulating once it sees a NaN operand but leaves the
    // terms pushed BEFORE it in place, so without this guard a product such
    // as `(x + 1) · NaN` came back as an inert `NaN * (x + 1)` — which does
    // not even report `isNaN`, since an unevaluated function node cannot.
    if (coef.isNaN) return [this._nanAnswer(), ce.One];
    if (coef.isZero) return [coef.isExact ? ce.Zero : ce.number(coef), ce.One];
    if (coef.isPositiveInfinity || coef.isNegativeInfinity) {
      const infinity = coef.isPositiveInfinity
        ? ce.PositiveInfinity
        : ce.NegativeInfinity;
      if (this.terms.length === 0) return [infinity, ce.One];
      // `∞ · (remaining factors)`: the sign of the result follows the sign of
      // the remaining factors' product; a provably-zero factor is the
      // indeterminate `0 · ∞ = NaN`; an unknown sign stays symbolic (`∞ · x`).
      this.coefficient = ce._numericValue(1);
      const grouped = this.groupedByDegrees({ mode: 'expression' });
      this.coefficient = coef;
      if (grouped === null) return [ce.NaN, ce.NaN];
      const rest = termsAsExpression(ce, this._matrixContext, grouped);
      if (isLiteral(rest, 0)) {
        const answer = this._formAnswer(rest);
        return [answer, answer];
      }
      if (rest.isPositive === true) return [infinity, ce.One];
      if (rest.isNegative === true)
        return [
          coef.isPositiveInfinity ? ce.NegativeInfinity : ce.PositiveInfinity,
          ce.One,
        ];
      return [ce._fn('Multiply', [infinity, rest]), ce.One];
    }

    // If the coef is -1, temporarily set it to 1 (only an exact -1: a float
    // -1 is kept as a coefficient, as any other float coefficient is)
    const isNegativeOne = coef.isNegativeOne && coef.isExact;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const xs = this.groupedByDegrees({ mode: 'rational' });

    this.coefficient = coef;

    if (xs === null) return [ce.NaN, ce.NaN];

    // A negative integer power of a term that can be a matrix stays in the
    // numerator as a power: `2·g(x)^{-1}` is not `2/g(x)`, which is
    // element-wise when `g(x)` is a matrix (see `mayBeMatrixPowerBase()`)
    const inNumerator = (x: { exponent: Rational; inversePower?: boolean }) =>
      x.exponent[0] >= 0 || x.inversePower === true;
    const xsNumerator = xs.filter(inNumerator);
    const xsDenominator = xs
      .filter((x) => !inNumerator(x))
      .map((x) => ({
        exponent: neg(x.exponent),
        terms: x.terms,
      }));

    const num = termsAsExpression(ce, this._matrixContext, xsNumerator);

    return [
      isNegativeOne ? num.neg() : num,
      termsAsExpression(ce, this._matrixContext, xsDenominator),
    ];
  }

  asRationalExpression(): Expression {
    const [numerator, denominator] = this.asNumeratorDenominator();
    return canonicalDivide(numerator, denominator);
  }
}

export function commonTerms(
  lhs: Product,
  rhs: Product
): [NumericValue, Expression] {
  const ce = lhs.engine;

  //
  // Extract common number literal between the two products
  //
  const coef = lhs.coefficient.gcd(rhs.coefficient);

  // Note: do NOT early-return when `coef` is 1 — a unit numeric gcd does not
  // mean there are no common factors. The two products may still share
  // symbolic terms (e.g. `x` in `x·y` and `x·z`), extracted below.

  //
  // Extract common terms between the two products
  //

  const xs: Expression[] = [];

  for (const x of lhs.terms) {
    // A factor that draws is never common: the draw on each side is
    // independent, so dividing both sides by it would add a new draw to
    // each side rather than cancel one (`x·e^Random() = y·e^Random()`).
    if (!isMergeable(x.term)) continue;
    // Find the term in the rhs product
    const y = rhs.terms.find((y) => x.term.isSame(y.term));
    if (!y) continue;
    const exponent = rationalGcd(x.exponent, y.exponent);
    if (isOne(exponent)) xs.push(x.term);
    else {
      const [n, d] = asMachineRational(exponent);
      if (d === 1) xs.push(x.term.pow(n));
      else if (n === 1) xs.push(x.term.root(d));
      else xs.push(x.term.pow(n).root(d));
    }
  }

  // Put everything together
  return [coef, xs.length === 0 ? ce.One : mul(...xs)];
}

/**
 * A numeric-base radical `Root(b, n)`, `Power(b, p/q)` (fractional exponent)
 * — normalized to a `(base, exponent)` pair so the two representations of the
 * same base unify (e.g. `Root(2,3)` and `Power(2, 2/3)` both key on base 2).
 * Returns undefined for integer exponents (folded elsewhere), non-numeric
 * bases, and other operators.
 */
function numericRadicalBaseExp(
  term: Expression
): { base: Expression; exp: Rational } | undefined {
  if (isFunction(term, 'Power') && term.op1 && term.op2 && isNumber(term.op1)) {
    const r = asRational(term.op2);
    // Only fractional exponents (integer powers of a numeric base fold into
    // the coefficient before reaching here).
    if (r && r[1] !== 1 && r[1] !== -1) return { base: term.op1, exp: r };
  }
  if (isFunction(term, 'Root') && term.op1 && term.op2 && isNumber(term.op1)) {
    const r = asRational(term.op2);
    if (r) return { base: term.op1, exp: inverse(r) };
  }
  return undefined;
}

/**
 * True when the term `t` with the reduced exponent `exponent` is a negative
 * integer power of a term that can be a matrix (`g(x)^{-1}` with `g` a
 * function that was not declared, see `mayBeMatrixPowerBase()`), and no part
 * of its exponent comes from a quotient (`t.quotient`). Such a power is the
 * matrix inverse (or a power of it) when the term is a matrix, so a product
 * keeps it as a power: it is not grouped with the other terms of the same
 * exponent, and it is not moved to a denominator. The quotient `1/g(x)` is
 * element-wise for a matrix, and it stays a quotient.
 */
function isMatrixInversePower(
  t: { term: Expression; quotient?: boolean },
  exponent: Rational
): boolean {
  return (
    isNeg(exponent) &&
    isIntegerRational(exponent) &&
    t.quotient !== true &&
    mayBeMatrixPowerBase(t.term)
  );
}

function termsAsExpression(
  ce: ComputeEngine,
  matrixContext: boolean,
  terms: { exponent: Rational; terms: ReadonlyArray<Expression> }[]
): Expression {
  let result = terms.map(({ terms, exponent }) => {
    const t = flatten(terms, 'Multiply');
    const base =
      t.length <= 1
        ? t[0]
        : ce._fn('Multiply', sortProductOperands(t, matrixContext));
    if (isOne(exponent)) return base;
    // Numeric rational powers may expose an exact coefficient plus a proper
    // radical (`2^(5/3) -> 2*2^(2/3)`). Route them through evaluation so
    // same-base tallying produces the canonical exact form, not an improper
    // Power that later terms cannot recognize as like.
    if (isNumber(base))
      return ce.function('Power', [base, ce.number(exponent)]).evaluate();
    return base.pow(ce.number(exponent));
  });

  result = flatten(result, 'Multiply');
  if (result.length === 0) return ce.One;
  if (result.length === 1) return result[0];

  return ce._fn('Multiply', sortProductOperands(result, matrixContext));
}

/**
 * The error for a juxtaposition, `\cdot` or `\times` between two POINTS.
 *
 * `tuple · tuple` is correctly rejected — there is no implicit product between
 * points, a ruling the `Dot` definition in `library/linear-algebra.ts` records
 * — but a generic `incompatible-type "number" "tuple"` report says only that
 * something wanted a number and got a tuple, and it surfaces wherever the
 * product was CONSUMED, which can be far from the spelling that caused it.
 * Since `\times`, `\cdot` and juxtaposition all parse to the same `Multiply`,
 * someone who meant a cross product gets no pointer at all from such a report.
 *
 * A named alternative must be one the engine will actually accept, or the
 * message just moves the user to a second error. `Dot` needs the two points to
 * have the SAME number of components and `Cross` needs both to have three, so
 * each is named only when no operand is provably incompatible with it: known
 * arities that disagree suppress both and the message reports the mismatch
 * instead. An arity that is not statically known suppresses nothing — the
 * suggestion is a prompt, not a promise.
 *
 * The payload's first element is that decision as a discrete marker, so a
 * presentation layer (the LaTeX tooltip in
 * `latex-syntax/dictionary/definitions-core.ts`) can branch on it instead of
 * matching the prose, which would break the moment the wording changes.
 */
function pointProductError(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  // `tupleArity` rather than `numericTupleArity`: `isTuple` also accepts a
  // SYMBOL whose bound value is a tuple, and reading only the symbol's own
  // type would call that arity unknown and wrongly leave `Cross` in.
  // A list of points (`isPointListCarrier`) counts with the component count
  // of its points: the product applies to each point.
  const arities = ops
    .filter((x) => isTupleCarrier(x) || isPointListCarrier(x))
    .map((x) => (isTupleCarrier(x) ? tupleArity(x) : pointListCarrierArity(x)));
  const known = arities.filter((n): n is number => n !== undefined);
  // `Dot` rejects a pair whose component counts differ, so two points of
  // KNOWN and different arity have no alternative to offer at all.
  const mismatched = known.length > 1 && known.some((n) => n !== known[0]);
  // `Cross` does not accept a list of points (`Dot` does, point by point),
  // so a product with a list of points never suggests it.
  const crossApplies =
    !mismatched &&
    !ops.some((x) => !isTupleCarrier(x) && isPointListCarrier(x)) &&
    arities.every((n) => n === undefined || n === 3);
  if (mismatched)
    return ce.error([
      'no-product-between-points',
      'dimension-mismatch',
      `these points have different dimensions (${known.join(' and ')})`,
    ]);
  return ce.error([
    'no-product-between-points',
    crossApplies ? 'cross-applies' : 'no-cross',
    crossApplies
      ? '`Dot(a, b)` is the inner product, `Cross(a, b)` the cross product'
      : '`Dot(a, b)` is the inner product',
  ]);
}

/**
 * The component count of a tuple-shaped operand, or `undefined` when it is not
 * statically known.
 *
 * `numericTupleArity` reads only `expr.type`, but `isTuple` recognizes a tuple
 * two ways: by the expression's own type, OR — for a symbol whose declared type
 * is not tuple-shaped — through the tuple-typed VALUE bound to it. For that
 * second kind the arity is available on the value and must be used, or an
 * operand `isTuple` admitted would report an unknown arity purely because the
 * two predicates consulted different places.
 */
function tupleArity(expr: Expression): number | undefined {
  return (
    numericTupleArity(expr) ??
    numericTupleArity(expr.value ?? expr) ??
    tupleCarrierArity(expr)
  );
}

//
// ── Divide ─────────────────────────────────────────────────────────────
//

/**
 * Canonical form of 'Divide' (and 'Rational')
 * - remove denominator of 1
 * - simplify the signs
 * - factor out negate (make the numerator and denominator positive)
 * - if numerator and denominator are integer literals, return a rational number
 *   or Rational expression
 * - evaluate number literals
 */
export function canonicalDivide(op1: Expression, op2: Expression): Expression {
  const ce = op1.engine;
  if (!op1.isValid || !op2.isValid) return ce._fn('Divide', [op1, op2]);

  // An operand with the EMPTY type `never` (for example a symbol declared
  // with an empty range, `integer<2<..<3>`) has no value — but the bottom
  // type is a subtype of every type, so it answers TRUE to every
  // type-channel predicate. Without this early-out the folds below, which
  // are keyed on exactly such predicates (`isNaN`, `isInfinity`, the sign
  // reads), all fire for it: `Divide(m, 2)` folded to `NaN` through the
  // NaN arm and `Divide(2, m)` to `0` through the `a/∞` arm. No fold
  // applies to a valueless operand, so the node is left unchanged and its
  // type stays `never`. `canonicalPower` carries the same guard, for the
  // same reason.
  //
  // A divisor that is the literal `1` or `-1` is stripped FIRST: removing it
  // reads nothing from the numerator's value, so it is sound for a `never`
  // operand, and an inert `Divide(never-typed, 1)` is not harmless — the
  // pretty-JSON serializer rewrites every `Multiply` through
  // `asRationalExpression()`, which reaches this function with a denominator
  // of `1`, and the `Divide(same Multiply, 1)` it got back was rewritten
  // again, without end (a `Maximum call stack size exceeded` on
  // `ce.parse("f(f(b)) - f(f(a)) = (f'(c))^2 (b - a)").latex`, where `f`
  // types `never`). The tuple branch below strips the same divisors for the
  // same reason.
  if (op1.type.type === 'never' || op2.type.type === 'never') {
    if (isLiteral(op2, 1)) return op1;
    if (isLiteral(op2, -1)) return op1.neg();
    return ce._fn('Divide', [op1, op2]);
  }

  // A `NaN` operand folds to `NaN` HERE, at canonicalization, unlike the
  // other arithmetic hubs (`Power`, `Multiply`, `Add` all leave such a node
  // unfolded and let the dispatch-time NaN gate propagate at evaluation).
  // The divergence is deliberate, and was measured before it was kept
  // (the arithmetic-core record in
  // `docs/plans/2026-08-30-error-model-implementation.md`):
  // - This is not an ERROR fold. `Divide` declares
  //   `nanBehavior: 'propagate'`, and the value this fold produces is
  //   exactly what the gate would produce, so nothing an enforcement seam
  //   would report is being swallowed — the carrier
  //   `(complex | infinity, (complex | infinity)+)` has no off-carrier
  //   point at all. `canonicalPower` keeps the analogous in-carrier folds
  //   (`0^0`, `1^∞`) for the same reason; what it had to stop folding was
  //   the OFF-carrier points, which do carry an error.
  // - The fold is SHARPER. `Divide` declares the top numeric result
  //   `number` (the compiled lanes' kind preservation relies on it), and
  //   the Contract B derivation leaves a result that already admits `nan`
  //   untouched, so an unfolded `Divide(NaN, 2)` types the wide `number`
  //   where the folded literal types `NaN`.
  // - Removing the fold introduced a route divergence: `NaN / NaN` reached
  //   the `a/a -> 1` rule of `simplifyDivide` (symbolic/simplify-divide.ts),
  //   whose guards exclude 0 and the infinities but not `NaN`, and
  //   simplified to `1` against evaluation's `NaN`.
  // The fold forwards an `Indeterminate` operand when the other operand is
  // not inexact, as a product does (`nanOperandAnswer()`):
  // `Indeterminate / 2` is `Indeterminate`, `Indeterminate / 2.0` is `NaN`.
  // Only a NUMBER LITERAL folds here: `isNaN` of a symbol reads its current
  // value, and a canonical form must not depend on it (with `w := NaN`, a
  // folded `w / 2` stayed `NaN` after `w := 4`). A symbol is left to
  // `evaluate()`, which substitutes its value first. For the same reason,
  // `Indeterminate / w` is not folded when `w` has an assigned value: the
  // answer is `NaN` or `Indeterminate` depending on that value
  // (`indeterminateAnswerReadsVariable()`).
  if ((isNumber(op1) && op1.isNaN) || (isNumber(op2) && op2.isNaN)) {
    if (indeterminateAnswerReadsVariable([op1, op2]))
      return ce._fn('Divide', [op1, op2]);
    return nanOperandAnswer(ce, [op1, op2]);
  }

  // Tuples (points/vectors in ℝⁿ): `tuple / scalar` scales component-wise;
  // `scalar / tuple` and `tuple / tuple` are undefined.
  {
    // A tuple divisor has no defined reciprocal (no implicit dot/cross).
    // Counted by tuple-ness (`isTuple`), not provable element numericity:
    // like the `Multiply` tuple·tuple guard (Tycho item 158), a divisor that
    // is a tuple under ANY element refinement never divides, and the strict
    // `isNumericTuple` merely deferred the identical rejection to evaluation.
    // Same reporting problem as the product between two points, and the same
    // remedy: name the situation instead of reporting that something wanted a
    // number and got a tuple. There is no alternative operator to suggest here
    // — a point has no reciprocal — so the message says only what is undefined.
    // A divisor typed `missing | tuple<…>` (a restricted point, `When((0,1),
    // c)`) is rejected the same way (`isTupleCarrier`): when present it is a
    // point, so `t / P` has no meaning whatever the condition, and Desmos
    // rejects it the same way.
    // A divisor that is a list of points (`isPointListCarrier`) is rejected
    // too: the division applies to each point, so every element is a
    // division by a point. Desmos rejects `t/L` and `2/[(1,2),(3,4)]` for a
    // list of points `L` ("Cannot divide a number by a list of points").
    if (isTupleCarrier(op2) || isPointListCarrier(op2))
      return ce.error(['no-division-by-point']);
    // The numerator is admitted with COULD-semantics, the same
    // `couldBeNumericTuple` the `Divide` TYPE handler uses to decide that a
    // quotient keeps its tuple shape, so the value route and the type route
    // cannot disagree about what a point quotient is.
    //
    // It replaces the stricter `isNumericTuple`, which requires every element
    // TYPE to be a subtype of `number` and so excluded a "zipped" point list —
    // a tuple whose components are lists of coordinates, such as
    // `([1,2], [3,4])`. Such a numerator fell through to the generic rational
    // rules, where `tuple / 0` collapsed to a bare scalar `~oo` instead of
    // dividing each component, and `tuple / s` with a declared scalar symbol
    // stayed an inert `Divide` that never folded.
    //
    // The structural `isTuple` used for the DIVISOR above is not the right
    // test here: this branch must admit every tuple `checkNumericArgs`
    // admits, including one whose components are not yet proven numeric
    // (`unknown`-typed components), which only the COULD-semantics
    // `couldBeNumericTuple` answers. Both predicates unfold a transparent
    // alias, so an alias of a numeric tuple (`p: pt` with `type pt =
    // tuple<number, number>`) takes this branch and its quotient is typed by
    // the component-widened tuple, not by the alias name.
    const op1Tuple = couldBeNumericTuple(op1);
    if (op1Tuple) {
      // Strip trivial divisors: the generic a/1 rule below is unreachable
      // from this branch, and an inert Divide(tuple-typed, 1) sends the
      // pretty-JSON serializer into infinite recursion (Multiply →
      // asRationalExpression → Divide(same Multiply, 1) → …).
      if (isLiteral(op2, 1)) return op1;
      if (isLiteral(op2, -1)) return op1.neg();
      // `tuple / scalar`: scale each component when the divisor is provably a
      // scalar number and the components are accessible; else stay symbolic.
      // A tuple with a LIST coordinate is data, not a point: it is not
      // scaled here, so the `Divide` stays and its evaluate handler reports
      // the error (see `isTupleWithListCoordinate`).
      //
      // An absent divisor is not scaled into the components either: a point
      // divided by an absent value is the absent point `Missing`, which
      // `div()` answers when the `Divide` is evaluated. A negation or product
      // of an absent value (`−Missing`, `2·Missing`) is read as the bare
      // `Missing` here, because `Divide` evaluates its operands first and
      // `−Missing` alone evaluates to the number `NaN`, which would hide the
      // absence. Scaled, `(1, 2) / −Missing` was `(NaN, NaN)`.
      if (isAbsentScalarTerm(op2) && !isAbsentSymbol(op2))
        return canonicalDivide(op1, ce.Missing);
      if (
        hasAccessibleComponents(op1) &&
        isFunction(op1) &&
        isSubtype(op2.type.type, 'number') &&
        !isTupleWithListCoordinate(op1) &&
        !isAbsentScalarTerm(op2)
      )
        return ce.tuple(...op1.ops.map((c) => canonicalDivide(c, op2)));
      return ce._fn('Divide', [op1, op2]);
    }
  }

  // A quotient with a residue class is kept as it is: only the residue rules
  // of the evaluate handler know its ring. The rules below would read
  // `c/c` as 1 when `c` has no inverse, `c/0` as `~∞` and `c/∞` as 0 (see
  // `holdsKindValue()`). A point divisor was rejected above, as for
  // any numerator. Division by an exact 1 is the same in every ring.
  if (holdsKindValue(op1) || holdsKindValue(op2))
    return isLiteral(op2, 1) ? op1 : ce._fn('Divide', [op1, op2]);

  // An absent operand (`Missing` or `Undefined`) folds to `NaN` here, as a
  // `NaN` operand does above and for the same reasons: arithmetic with an
  // absent operand is `NaN` (user decision of 2026-09-25), and the folds
  // below would otherwise erase the absence — `Missing / 1` was `Missing`
  // and `Missing / Missing` was `1` (the `a/a` fold). A point numerator was
  // handled above: a tuple divided by an absent value is not a number. An
  // operand that is or may be a collection (`[1, 2, 3] / Missing`) keeps
  // the `Divide`, so evaluation broadcasts the absence over the cells
  // (`[NaN, NaN, NaN]`) instead of collapsing the shape to one scalar.
  if (
    (isAbsentSymbol(op1) || isAbsentSymbol(op2)) &&
    !typeMayCarryQuotientShape(op1.type.type) &&
    !typeMayCarryQuotientShape(op2.type.type)
  )
    return ce.NaN;

  // A fully-determined expression (no free variables) that is not already a
  // literal. Such expressions may evaluate to 0 or ∞ (e.g. 1-1, tan(π/2))
  // and we want to avoid collapsing divisions like 0/(1-1) or
  // tan(π/2)/tan(π/2) during canonicalization. We use `unknowns` instead of
  // `symbols` because `symbols` includes mathematical constants like Pi and E,
  // which would let expressions like tan(π/2) slip through the guard.
  const op2IsConstantExpression = op2.unknowns.length === 0 && !isNumber(op2);

  // 0/0 = Indeterminate (`NaN` with a float operand), a/0 = ~∞ (a≠0)
  // Note: literal checks only — no value following (see isLiteral), and no
  // .N() either, because .N() can be expensive (e.g., Monte Carlo
  // integration) and canonicalization must be fast. Expressions like (1-1)/0
  // won't be detected as 0/0 here, but will be handled during simplification.
  //
  // A numerator that carries — or may carry — a collection shape (a list,
  // vector, matrix, a `broadcastable<number>` lift, an alias of one; tuples
  // were dispatched above) is exempt from this scalar rule and from the a/∞
  // rule below: the quotient stays an inert `Divide`, and evaluation settles
  // it once the value is known — a collection value broadcasts the division
  // over its elements ([1,2]/0 → [~oo, ~oo], [0,1]/0 → [NaN, ~oo]), a scalar
  // value takes the scalar answer through `div()` then. This matches the
  // algebraically identical [1,2]·(1/0), the component-wise tuple answer
  // (1,2)/0 → (~oo, ~oo), and the shape the `Divide` TYPE handler claims for
  // the quotient. The type read is confined to these two degenerate-divisor
  // branches — an ordinary quotient never pays for it.
  //
  // A numerator that may be zero keeps the quotient (`isProvablyNonZeroNumerator()`):
  // with `x: real` and no value, `x/0` is `0/0` when `x` is 0, so it is not
  // folded to `ComplexInfinity`.
  if (isLiteral(op2, 0)) {
    if (typeMayCarryQuotientShape(op1.type.type))
      return ce._fn('Divide', [op1, op2]);
    if (isLiteral(op1, 0)) return indeterminateFormAnswer(ce, [op1, op2]);
    return isProvablyNonZeroNumerator(op1)
      ? ce.ComplexInfinity
      : ce._fn('Divide', [op1, op2]);
  }

  // 0/a = 0 (a≠0, a is finite)
  if (isLiteral(op1, 0) && op2.isFinite !== false) {
    // Be conservative with constant (no-unknown) denominators that aren't
    // already a literal number. Avoid 0/(1-1) -> 0 during canonicalization.
    // Use structural mode so the expression is bound and can evaluate later.
    if (op2IsConstantExpression)
      return ce.function('Divide', [op1, op2], {
        form: 'structural',
      });
    // A float `0` gives a float `0`. A float divisor gives a float `0` too
    // (`0/2.5` is `0.0`): a float operand makes a numeric result a float.
    if (isNumber(op1) && !op1.isExact) return op1;
    return hasFloatOperand([op2]) ? asFloat(ce.Zero) : ce.Zero;
  }

  // a/∞ = 0, ∞/∞ = Indeterminate (check before a/a = 1 rule)
  if (op2.isInfinity) {
    if (op1.isInfinity) return indeterminateFormAnswer(ce, [op1, op2]);
    // Same shape exemption as the a/0 rule above: [1,2]/∞ broadcasts to
    // [0, 0] at evaluation rather than collapsing to the scalar 0.
    if (typeMayCarryQuotientShape(op1.type.type))
      return ce._fn('Divide', [op1, op2]);
    // A float numerator gives the float `0` (`2.5/∞` is `0.0`): a float
    // operand makes a numeric result a float.
    return isNumber(op1) && !op1.isExact ? asFloat(ce.Zero) : ce.Zero;
  }

  // ∞/a = ±∞ for a finite and definitely nonzero (with a known sign). Mirrors
  // the a/∞ = 0 rule above and the Multiply path, which already reduces
  // ∞·√π → +∞. Without this, bound substitution into antiderivatives such as
  // √(π/2)·FresnelC(√(2/π)·x) collapsed to NaN at x = ∞: the FresnelC argument
  // is Divide(√2·∞, √π), and √π — a finite, positive constant whose isFinite
  // is undefined (finiteness is not propagated through Sqrt) — sent the
  // division to NaN. Requiring a definite sign on op2 keeps could-be-zero
  // constants (e.g. sin(π)) out; the sign of op1 (incl. complex ∞) is carried
  // by op1 / op1.neg(). The denominator must be finite by its flag or by its
  // type: an unevaluated sum of infinities (`∞ + ∞`, which the canonical
  // form does not fold) has no finiteness flag but the type
  // `nan | signed_infinity`, and `∞/(∞ + ∞)` has no value; it was `+∞`, and
  // the evaluation of `∞ − (−∞)` as a denominator gave the same answer.
  if (
    op1.isInfinity &&
    (op2.isFinite === true || op2.type.matches('finite_number')) &&
    (op2.isPositive === true || op2.isNegative === true)
  )
    return op2.isPositive === true ? op1 : op1.neg();

  // a/a = 1 (if a ≠ 0 and a is finite). Not for a float literal: `2.0/2.0`
  // is a float quotient, computed when it is evaluated. Not for an operand
  // that is or may be a collection either, for the reason given at the a/0
  // rule above: `L / L` with `L: list<integer>` is a list of ones (or of
  // `Indeterminate` for a zero cell), not the scalar `1`.
  if (
    op2.isSame(0) === false &&
    op2.isFinite !== false &&
    !(isNumber(op1) && !op1.isExact) &&
    !(isNumber(op2) && !op2.isExact) &&
    !typeMayCarryQuotientShape(op1.type.type)
  ) {
    if (
      isSymbol(op1) &&
      isSymbol(op2) &&
      op1.symbol === op2.symbol &&
      op1.isConstant
    )
      return ce.One;

    // (x+1)/(x+1) = 1 (if x+1 ≠ 0). Not for an operand that draws: the two
    // occurrences of `Random()` in `Random()/Random()` are two independent
    // values.
    if (op1.isSame(op2) && isMergeable(op1)) {
      // Same conservative guard as above: don't collapse constant expressions
      // like (1-1)/(1-1) or tan(π/2)/tan(π/2) into 1 during canonicalization.
      // Use structural mode so the expression is bound and can evaluate later.
      if (op2IsConstantExpression)
        return ce.function('Divide', [op1, op2], {
          form: 'structural',
        });
      return ce.One;
    }
  }

  // -a/-b = a/b
  if (
    isFunction(op1, 'Negate') &&
    isFunction(op2) &&
    op2.operator === 'Negate'
  ) {
    op1 = op1.op1;
    op2 = op2.op1;
  }

  // A divisor that is a quotient by the number 0 (`x/0`, kept because `x`
  // may be zero) is not inverted: `1/(x/0)` would become `(1·0)/x`, which is
  // 0, although its value at `x = 0` is `1/(0/0)`, which has none.
  if (isFunction(op2, 'Divide') && isLiteral(op2.op2, 0))
    return ce._fn('Divide', [op1, op2]);

  // (a/b)/(c/d) = (a*d)/(b*c)
  if (
    isFunction(op1, 'Divide') &&
    isFunction(op2) &&
    op2.operator === 'Divide'
  ) {
    return canonicalDivide(
      canonicalMultiply(ce, [op1.op1, op2.op2]),
      canonicalMultiply(ce, [op1.op2, op2.op1])
    );
  }

  // (a/b)/c = a/(b*c)
  if (isFunction(op1, 'Divide'))
    return canonicalDivide(op1.op1, canonicalMultiply(ce, [op1.op2, op2]));

  // a/(b/c) = (a*c)/b
  if (isFunction(op2, 'Divide'))
    return canonicalDivide(canonicalMultiply(ce, [op1, op2.op2]), op2.op1);

  // a/1 = a
  if (isLiteral(op2, 1)) return op1;

  // a/(-1) = -a
  if (isLiteral(op2, -1)) return op1.neg();

  // 1/a = a^-1
  if (isLiteral(op1, 1)) return op2.inv();

  // Note: (-1)/a ≠ -(a^-1). We distribute Negate over Divide.

  // √a/√b = (1/b)√(ab) as a numeric value
  if (isFunction(op1, 'Sqrt') && isFunction(op2) && op2.operator === 'Sqrt') {
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2.op1);
    if (a !== null && b !== null)
      // √a/√b = √(ab)/b, except √a/√b = √(ab)/|b| when both are negative:
      // (i√|a|)/(i√|b|) is positive.
      return ce.number(
        ce._numericValue({
          radical: a * b,
          rational: [1, a < 0 && b < 0 ? -b : b],
        })
      );
  } else if (isFunction(op1, 'Sqrt')) {
    // √a/b = (1/b)√a as a numeric value
    const a = asSmallInteger(op1.op1);
    const b = asSmallInteger(op2);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: a, rational: [1, b] }));
  } else if (isFunction(op2, 'Sqrt')) {
    // a/√b = (a/b)√b as a numeric value
    const a = asSmallInteger(op1);
    const b = asSmallInteger(op2.op1);
    if (a !== null && b !== null)
      return ce.number(ce._numericValue({ radical: b, rational: [a, b] }));
  }

  // Are both op1 and op2 a numeric value?
  const v1 = numericValue(op1);
  const v2 = numericValue(op2);
  if (v1 !== undefined && v2 !== undefined) {
    if (
      (typeof v1 !== 'number' && v1.isComplex) ||
      (typeof v2 !== 'number' && v2.isComplex)
    ) {
      // An exact complex quotient folds to an exact number literal, as an
      // exact real quotient does below and as `canonicalMultiply` folds an
      // exact complex product: `i/3` is the literal `(1/3)i`, `(3+i)/2` is
      // `3/2 + (1/2)i`, `2/i` is `-2i`. Without this fold,
      // `Multiply(3/2, Pi, Divide(i, 3))` kept its imaginary factor inside a
      // `Divide`, and the readers of an imaginary multiple of π
      // (`getImaginaryFactor()`) did not see it.
      // A float operand keeps the division, also when its value is an
      // integer: `1.0i / 3` is a float quotient, computed when it is
      // evaluated, as `1.0 / 3` is. A quotient that is not exact keeps the
      // division too.
      const exact = (v: number | NumericValue): NumericValue | undefined =>
        typeof v === 'number' ? ce._numericValue(v) : v.isExact ? v : undefined;
      const nv1 = exact(v1);
      const nv2 = exact(v2);
      if (nv1 !== undefined && nv2 !== undefined && !nv2.isZero) {
        const q = nv1.div(nv2);
        if (q.isExact) return ce.number(q);
      }
      return ce._fn('Divide', [op1, op2]);
    }

    // a/b with a and b integer literals -> a/b rational
    // But handle division by zero: 0/0 = NaN, a/0 = ~∞
    if (
      typeof v1 === 'number' &&
      Number.isInteger(v1) &&
      typeof v2 === 'number' &&
      Number.isInteger(v2)
    ) {
      if (v2 === 0)
        return v1 === 0
          ? indeterminateFormAnswer(ce, [op1, op2])
          : ce.ComplexInfinity;
      return ce.number([v1, v2]);
    }

    if (typeof v1 === 'number' && Number.isInteger(v1)) {
      if (v1 === 0) return ce.Zero;
      // Only an exact divisor folds to a rational: `2/2.0` is a float
      // quotient, computed when it is evaluated.
      if (
        typeof v2 !== 'number' &&
        v2.isExact &&
        isSubtype(v2.type, 'integer')
      ) {
        const b = v2.bignumRe;
        if (b !== undefined) {
          if (b.isInteger()) return ce.number([bigint(v1)!, bigint(b)!]);
        } else {
          const d = v2.re;
          if (Number.isInteger(d)) return ce.number([v1, d]);
        }
      }
    }

    // Exact ÷ exact folds to an exact number literal (√3/3 → the literal
    // (1/3)√3, (1/2)/3 → 1/6), mirroring the exact-operand folding that
    // canonicalMultiply already does. This is what makes a serialized
    // radical quotient like `["Divide",["Sqrt",3],3]` re-box to the same
    // number literal that produced it (RT-P1-1 round-trip identity).
    // Inexact (float) operands deliberately do not fold at canonicalization;
    // division by an exact zero was handled above.
    {
      const nv1 = typeof v1 === 'number' ? ce._numericValue(v1) : v1;
      const nv2 = typeof v2 === 'number' ? ce._numericValue(v2) : v2;
      if (nv1.isExact && nv2.isExact && !nv2.isZero) {
        const q = nv1.div(nv2);
        if (q.isExact) return ce.number(q);
        // The quotient is not exact when its radicand is too large to store
        // (`(√1009/1009)/√1013`). Write it as one fraction with the integer
        // parts of the two denominators moved to the other side:
        // `√1009/(1009√1013)`, not `(√1009/1009)/√1013`.
        if (!nv1.isComplex && !nv2.isComplex) {
          const a = nv1.asExact!;
          const b = nv2.asExact!;
          let n = a.numerator.mul(b.denominator);
          let d = a.denominator.mul(b.numerator);
          // Divide out the common factor of the two sides:
          // `(2√1009)/(4√1013)` is `√1009/(2√1013)`
          if (n.isExact && d.isExact) {
            const g = n.gcd(d);
            if (g.isExact && !g.isOne && !g.isZero) {
              const n1 = n.div(g);
              const d1 = d.div(g);
              if (n1.isExact && d1.isExact) {
                n = n1;
                d = d1;
              }
            }
          }
          if (n.isExact && d.isExact) {
            if (d.sgn() === -1) {
              n = n.neg();
              d = d.neg();
            }
            return ce._fn('Divide', [ce.number(n), ce.number(d)]);
          }
        }
      }
    }

    return ce._fn('Divide', [op1, op2]);
  }

  // At least one of op1 or op2 are not numeric value.
  // Try to factor them.

  // Exact numeric values in operands are now pre-folded by canonicalMultiply,
  // so toNumericValue here just extracts the remaining coefficient+term.
  // A ZERO coefficient is still possible: machine-float zeros (`0.0·x`) are
  // deliberately excluded from canonical folding.
  const [c1, t1] = op1.toNumericValue();
  const [c2, t2] = op2.toNumericValue();

  // A zero-coefficient numerator factors out fine (0·(t1/t2)), but a
  // zero-coefficient denominator must NOT: c1/0 = ±∞ would assume a sign
  // for `x/(0.0·y)`. Keep the division structural.
  if (c2.isZero) return ce._fn('Divide', [op1, op2]);

  const c = c1.div(c2);

  // Float coefficients must not mint an exact cancellation. Binary `0.3/0.1`
  // is not exactly `3`, yet `c1.div(c2)` on the decimal coefficients yields an
  // exact `3` — so `(0.3x)/(0.1y)` used to fold to an *exact* `(3x)/y`, while
  // `Divide(0.3, 0.1)` stays a float and `canonicalMultiply`/`canonicalAdd`
  // exclude floats from folding. Align with that float-exclusion convention:
  // only fold the extracted coefficient when both source coefficients are
  // exact; otherwise keep the division as-is (#12).
  // A unit coefficient (`c = ±1`) is only *removed* here, never minted, so it
  // is safe to drop even for float coefficients (e.g. `0.2/0.2 = 1`). Only the
  // coefficient-*minting* fold below is gated on exactness.
  // The unit is not removed when exactly one of the two coefficients is a
  // float: `x/1.0` keeps its float divisor, as `x/2.0` does, because a float
  // operand makes the quotient numeric.
  const coefExact = c1.isExact && c2.isExact;
  const unitRemovable = c1.isExact === c2.isExact;

  if (c.isOne && unitRemovable)
    return isLiteral(t2, 1) ? t1 : ce._fn('Divide', [t1, t2]);

  if (c.isNegativeOne && unitRemovable)
    return isLiteral(t2, 1) ? t1.neg() : ce._fn('Divide', [t1.neg(), t2]);

  // If c is exact, use as a product: `c * (t1/t2)`
  // So, π/4 -> 1/4 * π (prefer multiplication over division)
  if (coefExact && c.isExact) {
    if (isLiteral(t1, 1) && isLiteral(t2, 1)) return ce.number(c);
    if (isLiteral(t2, 1)) return canonicalMultiply(ce, [ce.number(c), t1]);

    return ce._fn('Divide', [
      canonicalMultiply(ce, [ce.number(c.numerator), t1]),
      canonicalMultiply(ce, [ce.number(c.denominator), t2]),
    ]);
  }
  return ce._fn('Divide', [op1, op2]);
}

/** True when the factors `xs` hold a point (a tuple) and a tensor of rank 3
 * or more, which `mulTensors` leaves unevaluated. */
function isPointTimesHighRankTensor(xs: ReadonlyArray<Expression>): boolean {
  return (
    xs.some((x) => isTuple(x)) &&
    xs.some((x) => isTensorValue(x) && x.shape.length > 2)
  );
}

export function div(num: Expression, denom: number | Expression): Expression {
  const ce = num.engine;

  num = num.canonical;
  if (typeof denom !== 'number') denom = denom.canonical;

  // If the numerator is NaN, return NaN (or `Indeterminate`, forwarded by the
  // rule of `canonicalDivide`). A number literal only, for the reason given
  // in `canonicalDivide`, and not when the answer depends on the value of a
  // variable that the divisor reads.
  if (isNumber(num) && num.isNaN) {
    const d = typeof denom === 'number' ? ce.number(denom) : denom;
    if (indeterminateAnswerReadsVariable([num, d]))
      return ce._fn('Divide', [num, d]);
    return nanOperandAnswer(ce, [num, d]);
  }

  // A divisor that is a point or a list of points has no quotient, as in
  // `canonicalDivide`, which answers the same error at boxing. The test
  // runs before any cancellation: the `Product` at the end of this function
  // reduces `a / a` to `1`, so a `Divide(U, U)` boxed while `U` had no value
  // evaluated to `1` once `U` held the point `(1, 2)`, and to `[1, 1]` once
  // it held a list of two points.
  if (
    typeof denom !== 'number' &&
    (isTupleCarrier(denom) || isPointListCarrier(denom))
  )
    return ce.error(['no-division-by-point']);

  // Tuple (point/vector in ℝⁿ) numerator: `tuple / scalar` scales
  // component-wise — the value-level twin of the tuple branch in
  // `canonicalDivide`, and the counterpart of the `mulTuples` dispatch in
  // `mulImpl`. Without it `div()` has no tuple arm at all, and the `Product`
  // fall-through at the end of this function returns an inert
  // `Multiply(1/d, tuple)` (or, through `asRationalExpression` →
  // `canonicalDivide`, a tuple of unevaluated component quotients).
  //
  // A `Divide` built with `ce._fn` skips `canonicalDivide`, so a tuple
  // numerator arriving that way has no other chance to fold: that is how the
  // broadcast zip in `BoxedFunction._computeValue` builds each element of
  // `Divide(list<tuple>, list<number>)`, and the `Divide` evaluate handler
  // hands back whatever this function returns.
  //
  // A NaN or not-provably-numeric divisor falls through to the rules below,
  // matching `canonicalDivide`. The structural `hasAccessibleComponents` (a
  // `Tuple`/`Pair`/… head with operands) is tested FIRST so an ordinary
  // quotient never pays the `type` computations behind the other two tests.
  //
  // Tuple-ness is counted with the same COULD-semantics `canonicalDivide`
  // uses, so a "zipped" point list — a tuple whose components are lists of
  // coordinates, such as `([1,2], [3,4])` — folds here instead of falling
  // through to an inert `Multiply(1/d, tuple)`.
  if (
    hasAccessibleComponents(num) &&
    isFunction(num) &&
    couldBeNumericTuple(num)
  ) {
    const d = typeof denom === 'number' ? ce.number(denom) : denom;
    // An absent divisor (`Negate(Missing)` is typed as a number) is not a
    // scale: the absence rule below answers `Missing` for the point.
    if (
      !d.isNaN &&
      !isAbsentArithmeticOperand(d) &&
      isSubtype(d.type.type, 'number')
    )
      // Evaluate each component quotient, mirroring `mulTuples`: a component
      // that is itself a collection (`[1,2]` in a zipped point list) divides
      // to an inert `Multiply(1/d, [1,2])`, because `div()` builds a
      // `Product` rather than broadcasting. Only evaluation distributes the
      // scale over the elements, and the `Divide` evaluate handler returns
      // this result as-is on the exact route, so an unevaluated component
      // would reach the user.
      return ce.tuple(...num.ops.map((c) => c.div(d).evaluate()));
    // A point divided by a finite collection of numbers is the list of the
    // point divided by each element: `(1, 2) / [1, 2]` is
    // `[(1, 2), (1/2, 1)]`, the same list of points that the product
    // `(1, 2) · [1, 1/2]` gives (`mulImpl`). The generic broadcast of the
    // `Divide` operator stands aside for a tuple operand, so without this
    // the quotient stayed an inert `Divide`. A matrix divisor is distributed
    // the same way, cell by cell: `(1, 2) / [[1, 2], [3, 4]]` is the matrix
    // of points `[[(1, 2), (1/2, 1)], [(1/3, 2/3), (1/4, 1/2)]]`, as the
    // product `(1, 2) · [[1, 2], [3, 4]]` is the matrix of the scaled
    // points. A division by a matrix is element-wise for a list numerator
    // too (`[1, 2] / [[1, 2], [3, 4]]`); it is never a product with the
    // inverse matrix.
    if (isFiniteBroadcastParticipant(d)) {
      const r = broadcastOverIndexedCollections(ce, 'Divide', [num, d], false);
      if (r !== undefined) return r;
    }
  }

  // A kind value in the quotient (a residue class): only the hooks of the
  // kinds apply, after the point numerator above (`kindArithmetic()`).
  const residue = kindArithmetic(ce, 'Divide', [
    num,
    typeof denom === 'number' ? ce.number(denom) : denom,
  ]);
  if (residue !== undefined) return residue;

  // An absent operand (`Missing`, `Undefined`, or a product or negation of
  // one): arithmetic with an absent operand is `NaN` (user decision of
  // 2026-09-25), as the `Divide` operator answers at evaluation. Before,
  // `ce.box('Missing').div(ce.box(2))` was `½·"Missing"`. A point divided by
  // an absent value is an absent point, `Missing`, as for a product: a tuple
  // is atomic, so there is no cell for the absence to land in. An operand
  // that is or may be a collection keeps the quotient, for the reason given
  // in `canonicalDivide`. This applies to a JavaScript number divisor too:
  // `Multiply(Missing, L).div(2)`, with `L` a list, keeps the list shape.
  if (
    (isAbsentArithmeticOperand(num) ||
      (typeof denom !== 'number' && isAbsentArithmeticOperand(denom))) &&
    (isTuple(num) ||
      (!typeMayCarryQuotientShape(num.type.type) &&
        (typeof denom === 'number' ||
          !typeMayCarryQuotientShape(denom.type.type))))
  )
    return isTuple(num) ? ce.Missing : ce.NaN;

  if (typeof denom === 'number') {
    if (isNaN(denom)) return ce.NaN;
    if (isLiteral(num, 0)) {
      // 0/0 is the indeterminate form (`NaN` with a float zero). 0/±∞ is 0,
      // as `canonicalDivide` answers for `Divide(0, ∞)`: it is not an
      // indeterminate form (it answered `NaN` here before).
      if (denom === 0) return indeterminateFormAnswer(ce, [num, ce.Zero]);
      // A JavaScript number that is not an integer is a float (`ce.number()`
      // boxes it as a float), so the exact `0` divided by it is the float
      // `0`, as for a boxed float divisor below.
      if (Number.isFinite(denom) && !Number.isInteger(denom))
        return asFloat(num);
      return num; // 0
    }
    // a/1 = a
    if (denom === 1) return num;
    // a/(-1) = -a
    if (denom === -1) return num.neg();
    // a/0 = ~∞ (a≠0) - ComplexInfinity as "better NaN"
    // A shape-carrying numerator is exempt, exactly as in `canonicalDivide`:
    // the quotient stays an inert `Divide` so evaluation broadcasts the
    // division over the elements ([1,2]/0 → [~oo, ~oo]) instead of
    // collapsing the shape to one scalar. A numerator that may be zero keeps
    // the quotient too, as in `canonicalDivide` (`isProvablyNonZeroNumerator()`).
    if (denom === 0) {
      if (
        typeMayCarryQuotientShape(num.type.type) ||
        !isProvablyNonZeroNumerator(num)
      )
        return ce._fn('Divide', [num, ce.number(0)]);
      return ce.ComplexInfinity;
    }
    // An infinite divisor reaches a/∞ = 0 through the Product tail below,
    // which would collapse a shaped numerator the same way — keep it inert
    // instead ([1,2]/∞ → [0, 0] at evaluation). NaN was handled above.
    if (!Number.isFinite(denom) && typeMayCarryQuotientShape(num.type.type))
      return ce._fn('Divide', [num, ce.number(denom)]);

    if (isNumber(num)) {
      const n = num.numericValue;
      // If num and denom are literal integers, we keep an exact result
      if (typeof n === 'number') {
        if (Number.isInteger(n) && Number.isInteger(denom))
          return ce.number(ce._numericValue({ rational: [n, denom] }));
      } else if (n.isExact && Number.isInteger(denom)) {
        return ce.number(n.asExact!.div(denom));
      }
    }
  } else {
    if (isNumber(denom) && denom.isNaN) {
      // As for a `NaN` numerator above.
      if (indeterminateAnswerReadsVariable([num, denom]))
        return ce._fn('Divide', [num, denom]);
      return nanOperandAnswer(ce, [num, denom]);
    }
    if (isLiteral(num, 0)) {
      // 0/0 is the indeterminate form. 0/∞ and 0/~oo are 0, as
      // `canonicalDivide` answers (not an indeterminate form; this answered
      // `NaN` before). A `NaN` divisor was handled above.
      if (isLiteral(denom, 0)) return indeterminateFormAnswer(ce, [num, denom]);
      // A float `0` numerator is kept (`0.0/∞` is the float `0`), as in the
      // JavaScript-number branch above. A float divisor gives a float `0`
      // (`0/2.5` is `0.0`).
      if (isNumber(num) && !num.isExact) return num;
      return hasFloatOperand([denom]) ? asFloat(ce.Zero) : ce.Zero;
    }

    // a/1 = a
    if (isLiteral(denom, 1)) return num;

    // a/(-1) = -a
    if (isLiteral(denom, -1)) return num.neg();

    // a/0 = ~∞ (a≠0) — ComplexInfinity, consistent with the JS-number path
    // above (the boxed-zero case previously returned NaN). A shape-carrying
    // numerator stays an inert `Divide` that broadcasts at evaluation, as in
    // the JS-number path and `canonicalDivide`.
    //
    // A numerator that may be zero keeps the quotient too
    // (`isProvablyNonZeroNumerator()`).
    if (isLiteral(denom, 0)) {
      if (
        typeMayCarryQuotientShape(num.type.type) ||
        !isProvablyNonZeroNumerator(num)
      )
        return ce._fn('Divide', [num, denom]);
      return ce.ComplexInfinity;
    }

    // An infinite divisor reaches a/∞ = 0 through the Product tail below,
    // which would collapse a shaped numerator the same way — keep it inert
    // instead ([1,2]/∞ → [0, 0] at evaluation). A NaN divisor was handled
    // above.
    if (denom.isInfinity && typeMayCarryQuotientShape(num.type.type))
      return ce._fn('Divide', [num, denom]);

    // ∞/a = ±∞ for a finite and definitely nonzero (a known sign). The Product
    // path below returns NaN for an infinite numerator over a symbolic finite
    // denominator (asNumeratorDenominator bails when the coefficient is ∞ and
    // any terms remain), which blocked Fresnel improper integrals: the bound
    // substitution into √(π/2)·FresnelC(√(2/π)·x) forms Divide(√2·∞, √π), and
    // √π is a finite positive constant whose isFinite is undefined. Requiring a
    // definite sign on `denom` keeps could-be-zero constants (e.g. sin(π)) out.
    if (
      num.isInfinity &&
      denom.isFinite !== false &&
      (denom.isPositive === true || denom.isNegative === true)
    )
      return denom.isPositive === true ? num : num.neg();

    if (isNumber(num) && isNumber(denom)) {
      const numV = num.numericValue;
      const denomV = denom.numericValue;
      if (
        typeof numV === 'number' &&
        typeof denomV === 'number' &&
        Number.isInteger(numV) &&
        Number.isInteger(denomV)
      ) {
        return ce.number(ce._numericValue({ rational: [numV, denomV] }));
      } else if (
        typeof numV === 'number' &&
        Number.isInteger(numV) &&
        typeof denomV !== 'number'
      ) {
        if (denomV.isExact) {
          return ce.number(ce._numericValue(numV).div(denomV.asExact!));
        }
      } else if (
        typeof denomV === 'number' &&
        Number.isInteger(denomV) &&
        typeof numV !== 'number'
      ) {
        if (numV.isExact) {
          return ce.number(numV.asExact!.div(denomV));
        }
      } else if (typeof numV !== 'number' && typeof denomV !== 'number') {
        // The quotient of two exact values is not exact when its radicand
        // is too large to store (`√1009/√1013 = √1022117/1013`). The
        // `Product` below then keeps the two factors, as in a product.
        if (numV.isExact && denomV.isExact) {
          const q = numV.asExact!.div(denomV.asExact!);
          if (q.isExact) return ce.number(q);
        }
      }
      // A finite float divisor: one division of the two values. The
      // `Product` below multiplies by the inverse of the divisor, and the
      // inverse of a float is rounded, so the quotient was rounded twice:
      // `0.3/0.3` was `0.999999999999999999999`, and `Floor(0.3, 0.3)` was
      // `0`. An EXACT divisor keeps the `Product`: its inverse is exact (the
      // inverse of `1/7` is `7`), while `NumericValue.div` would round it
      // first (`1.0/(1/7)` would be `6.99…`). An infinite or NaN operand
      // keeps the rules of the `Product` too. (A zero divisor returned
      // above.)
      if (!denom.isExact && num.isFinite === true && denom.isFinite === true) {
        const a = typeof numV === 'number' ? ce._numericValue(numV) : numV;
        const b =
          typeof denomV === 'number' ? ce._numericValue(denomV) : denomV;
        return ce.number(a.div(b));
      }
    }
  }
  const result = new Product(ce, [num]);
  result.div(typeof denom === 'number' ? ce._numericValue(denom) : denom);
  return result.asRationalExpression();
}

//
// ── Multiply ───────────────────────────────────────────────────────────
//

/**
 * True if `x` carries a continuation operand anywhere in the subtree that
 * `flatten(…, 'Multiply')` would lift into the enclosing product. The check
 * must be as deep as `flatten` is recursive: a placeholder two levels down,
 * e.g. `Multiply(a, Multiply(b, ContinuationPlaceholder))`, is spliced into
 * the enclosing product just the same.
 */

/**
 * The canonical form of `Multiply`:
 * - removes `1` and `-1`
 * - simplifies the signs:
 *    - i.e. `-y \times -x` -> `x \times y`
 *    - `2 \times -x` -> `-2 \times x`
 * - arguments are sorted
 * - complex numbers promoted (['Multiply', 2, 'ImaginaryUnit'] -> 2i)
 * - Numeric values are promoted (['Multiply', 2, 'Sqrt', 3] -> 2√3)
 *
 * The input ops may not be canonical, the result is canonical.
 */

export function canonicalMultiply(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  // Ellipsis fold barrier: a `Multiply` with a direct `ContinuationPlaceholder`
  // operand (from `\dots`/`\cdots` in a product) is a *notational* object, not
  // an arithmetic one. Do not unnegate, filter ones, fold numerics, or sort —
  // preserve the source operand order and structure so the elided pattern reads
  // correctly, e.g. `2 · 4 · … · 2n` keeps the `2n` anchor as `Multiply(2, n)`.
  if (ops.some((x) => isContinuationOperand(x)))
    return ce._fn(
      'Multiply',
      ops.map((x) => x.canonical)
    );

  //
  // Flatten nested products: `Multiply` is associative, so a canonical
  // `Multiply` never has a `Multiply` operand. Most callers arrive via
  // `ce.function('Multiply', …)`, which flattens in `checkNumericArgs`, but
  // direct callers (notably the `InvisibleOperator` canonical handler, which
  // hands us the operands of a product it built itself) do not — so `2f(ab)`
  // used to canonicalize to `Multiply(2, f, Multiply(a, b))`. `flatten` bails
  // out without allocating when there is nothing to lift.
  //
  // A nested product that is itself an ellipsis-fold barrier is left alone:
  // lifting its operands would smuggle a `ContinuationPlaceholder` past the
  // check above and fold across it. Because `flatten` also descends `Sequence`,
  // the barrier may sit behind a `Sequence` wrapper — the hold has to be
  // recursive too. Only the barrier-bearing operands are held back — the
  // unrelated ones still flatten, so the result is as flat as the barrier
  // allows.
  //
  if (ops.some((x) => containsContinuationOperand(x)))
    ops = flattenHoldingBarriers(ops, 'Multiply', false);
  else ops = flatten(ops, 'Multiply', false);

  // A product with a residue class is only flattened and sorted: only the
  // residue rules of the evaluate handler know its ring. The folds below
  // would read `0·c` as the integer 0, `c·(1/c)` as 1 and `0.0·c` as `0.0`
  // (see `holdsKindValue()`).
  if (ops.some(holdsKindValue))
    return ops.length === 1
      ? ops[0]
      : ce._fn('Multiply', sortProductOperands(ops));

  // Two or more tuples (points/vectors) have no implicit product (dot/cross);
  // reject `tuple · tuple` at canonicalization. Counted by tuple-ness
  // (`isTuple`, like `mulTuples` on the evaluation path), not provable element
  // numericity: a `tuple<broadcastable<number>, …>` operand — whatever its
  // elements refine to — still has no product with another tuple, and the
  // narrower `isNumericTuple` deferred the identical rejection to evaluation,
  // making validity depend on refinement order (Tycho item 158). Use `Dot`
  // for the explicit inner product. `scalar · tuple` is allowed and scales
  // component-wise at evaluation. An operand typed `missing | tuple<…>` (a
  // restricted point, `When((0,1), c)`, or a `Which` with point branches and
  // no default) counts as a tuple here (`isTupleCarrier`): when present it is
  // a point, so the product has no meaning whatever the condition, and
  // Desmos rejects it the same way. A list of points
  // (`isPointListCarrier`) counts as a point too: the product applies to each
  // point, so `[(1,2),(3,4)]·(1,1)` is a list of products of two points, and
  // Desmos rejects it ("Cannot multiply a list of points by a point"). A list
  // of NUMBERS times a point (`[1,2,3]·(0,1)`) has one point operand and stays
  // valid: it is a list of scaled points.
  if (ops.filter((x) => isTupleCarrier(x) || isPointListCarrier(x)).length >= 2)
    return pointProductError(ce, ops);

  //
  // Remove negations and negative numbers
  //
  // Stripping a `Negate` can EXPOSE a nested product that the flatten pass
  // above could not see: `Multiply(Negate(Multiply(a, b)), c)` has no direct
  // `Multiply` operand, but `unnegate` leaves one behind. A canonical
  // `Multiply` must never have a `Multiply` operand — `.json` flattens on
  // serialization, so an unflattened node serializes identically to a
  // flattened one while `isSame`/`hash` disagree about them (Tycho item 170).
  // Re-enter the lifted operands so the sign channel and the flattening stay
  // in lockstep, at any depth. A nested product that is an ellipsis-fold
  // barrier is left alone, as in the pass above.
  let sign = 1;
  let xs: Expression[] = [];
  {
    const unnegateInto = (op: Expression) => {
      const [o, s] = unnegate(op);
      sign *= s;
      if (isFunction(o, 'Multiply') && !containsContinuationOperand(o))
        for (const x of o.ops) unnegateInto(x);
      else xs.push(o);
    };
    for (const op of ops) unnegateInto(op);
  }

  // A product of several factors that folds down to a lone absent factor
  // (`Multiply(Missing, 1)`) is `NaN`, not the bare symbol: arithmetic with
  // an absent operand is `NaN` (user decision of 2026-09-25), and removing
  // the `· 1` must not turn the product into the absent value itself.
  // `Multiply(Missing, 2)` is not folded here: it stays a product, and its
  // evaluation answers `NaN`.
  const severalFactors = xs.length > 1;
  const hasAbsentFactor = xs.some((x) => isAbsentSymbol(x));

  //
  // Filter out ones
  //
  xs = xs.filter((x) => !isLiteral(x, 1));

  //
  // Fold exact numeric operands (integers, rationals, radicals, exact
  // complex values and Gaussian integers)
  // e.g. Multiply(2, x, 5) → Multiply(10, x), Multiply(2, 3i) → 6i (exact)
  //
  {
    const exactNumerics: NumericValue[] = [];
    const nonNumeric: Expression[] = [];
    for (const x of xs) {
      if (isNumber(x) && !x.isInfinity && !x.isNaN) {
        const nv = x.numericValue;
        if (typeof nv === 'number' || nv.isExact) {
          exactNumerics.push(
            typeof nv === 'number' ? ce._numericValue(nv) : nv
          );
          continue;
        }
      }
      nonNumeric.push(x);
    }
    if (exactNumerics.length >= 2) {
      // The factors are folded in the order of their radicands, smallest
      // first (a rational has the radicand 1). The result does not depend on
      // the order of the operands then, also when a factor is kept separate
      // (see below): `2·√1009·√1013` and `√1013·2·√1009` both give the
      // factors `2√1009` and `√1013`.
      const radicand = (v: NumericValue): number =>
        v instanceof ExactNumericValue
          ? v.radical !== 1
            ? v.radical
            : v.imRadical
          : 1;
      exactNumerics.sort((a, b) => radicand(a) - radicand(b));
      let product = exactNumerics[0];
      // The exact factors that are kept separate because their product with
      // `product` is not exact (see below)
      const separate: NumericValue[] = [];
      for (let i = 1; i < exactNumerics.length; i++) {
        let next = exactNumerics[i];
        // Exactness guard: an exact value holds one radical with a radicand
        // of at most 10⁶ (`SMALL_INTEGER`) times a Gaussian rational. When
        // the product leaves that set (`√1009·√1013 = √1022117`, whose
        // radicand has no square factor, or `√2·(1+i)`), the product is
        // computed as a float. Do NOT fold it at canonicalization: keep the
        // factor as a separate term, so the product stays exact. A factor
        // that was kept separate can still combine with a later one
        // (`√1013·√1013 = 1013`): that product is then folded in its place.
        let candidate = product.mul(next);
        while (!candidate.isExact && !candidate.isNaN) {
          const j = separate.findIndex((s) => s.mul(next).isExact);
          if (j < 0) break;
          next = separate[j].mul(next);
          separate.splice(j, 1);
          candidate = product.mul(next);
        }
        if (!candidate.isExact && !candidate.isNaN) {
          // Only the radical of a real factor is kept separate. Its
          // rational part is folded into `product`, which stays exact:
          // `2√1009·3√1013` is `6√1009·√1013`, not `2√1009·3√1013`.
          const split = splitRationalRadical(next);
          if (split !== undefined) {
            const scaled = product.mul(split[0]);
            if (scaled.isExact) {
              product = scaled;
              next = split[1];
            }
          }
          separate.push(next);
          continue;
        }
        product = candidate;
      }
      // A separate factor made from two complex factors can be a negative
      // real (`i·i`): its sign goes to the sign channel, as for `product`
      // below.
      for (const s of separate) {
        if (!s.isComplex && s.sgn() === -1) {
          sign = -sign;
          nonNumeric.push(ce.number(s.neg()));
        } else nonNumeric.push(ce.number(s));
      }
      if (product.isZero) {
        // 0 * ±∞ is the indeterminate form (`Indeterminate`, or `NaN` when
        // a factor is a float), 0 * NaN = NaN, 0 * Indeterminate is
        // `Indeterminate`, and 0 times an absent factor is NaN (arithmetic
        // with an absent operand is `NaN`)
        if (hasAbsentFactor) return ce.NaN;
        // A factor that reads a variable with an assigned value keeps the
        // product: its value is the one the variable holds when the product
        // is evaluated, and the fold must not read the value it holds now.
        // With `w := 4`, `Multiply(0, 2, w)` is `0w`, which evaluates to
        // `NaN` after `w := NaN`. This is the rule of `Multiply(0, w)`, where
        // there is only one exact factor and nothing to fold, and of `mul()`.
        // A NaN or infinite literal factor is the indeterminate form below.
        if (
          !nonNumeric.some(
            (x) => isNumber(x) && (x.isInfinity === true || x.isNaN === true)
          ) &&
          nonNumeric.some((x) => hasAssignedVariable(x))
        )
          return ce._fn(
            'Multiply',
            sortProductOperands([ce.Zero, ...nonNumeric])
          );
        if (nonNumeric.some((x) => x.isInfinity || x.isNaN))
          return indeterminateFormAnswer(ce, nonNumeric);
        // A factor typed `error` always evaluates to an error (such as
        // `Sin((A, B))` with `A`, `B` lists). The zero must not erase it:
        // keep the product as `0` times the other factors, so that
        // evaluation reports that error.
        if (!nonNumeric.some((x) => x.type.type === 'error'))
          return product.isExact ? ce.Zero : ce.number(product);
      }
      // The fold can produce a NEGATIVE real coefficient even though the sign
      // pass above normalized every literal positive — only a product with
      // complex operands can (e.g. `i·i = -1`). Re-enter the sign channel so
      // the fold result spells the same as literal input:
      // `Multiply(i, i, a, b)` → `Negate(Multiply(a, b))`, exactly like
      // `Multiply(-1, a, b)`. A stranded `-1` operand serializes as `-(ab…)`,
      // which reparses as `Negate(Multiply(…))` — a second canonical spelling
      // of the same negated product (round-trip class
      // negate-vs-multiply-minus-one).
      if (!product.isComplex && product.sgn() === -1) {
        sign = -sign;
        product = product.neg();
      }
      if (!product.eq(1)) nonNumeric.unshift(ce.number(product));
      xs = nonNumeric;
    }
    // else: 0 or 1 exact numerics — xs is unchanged, no folding needed
  }

  //
  // If an integer or a rational is followed by a sqrt or an imaginary unit
  // we promote it
  //
  const ys: Expression[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    // Last item?
    if (i + 1 >= xs.length) {
      ys.push(x);
      continue;
    }
    const next = xs[i + 1];

    // Do we have a number literal followed either by a sqrt or an imaginary unit?
    // Non-finite literals are excluded from this promotion, as they are from
    // the exact fold above: `∞·i` has no exact pure-imaginary form, and
    // promoting it built a bogus value out of an infinite component
    // (`∞·i` canonicalized to NaN, while the other operand order stayed
    // symbolic — see the canonicalization contract in CLAUDE.md: machine
    // floats, infinity and NaN are excluded from folding).

    if (isNumber(x) && !x.isInfinity && !x.isNaN) {
      // Do we have a Sqrt expression?
      if (
        isFunction(next, 'Sqrt') &&
        isNumber(next.op1) &&
        next.op1.type.matches('integer')
      ) {
        // Next is a sqrt of a literal integer
        let radical: number | NumericValue = next.op1.numericValue;
        if (typeof radical !== 'number') radical = radical.re;

        // An ExactNumericValue radical must be a positive small integer:
        // √(negative) is an imaginary value that can't be promoted here.
        if (radical >= SMALL_INTEGER || radical < 1) {
          ys.push(x);
          continue;
        }

        // Is it preceded by an exact rational? A float (`2.0·√2`) is not
        // folded into an exact radical: the product is a float.
        if (x.isExact && x.type.matches('rational')) {
          const rational = x.numericValue;
          const [num, den] =
            typeof rational === 'number'
              ? [rational, 1]
              : [rational.numerator.re, rational.denominator.re];
          ys.push(
            ce.number(ce._numericValue({ rational: [num, den], radical }))
          );
          i++;
          continue;
        }
      } else if (isNumber(next) && next.numericValue instanceof NumericValue) {
        // Do we have a radical as a numeric value?
        const nextNv = next.numericValue;
        if (
          nextNv instanceof ExactNumericValue &&
          isOne(nextNv.rational) &&
          nextNv.radical !== 1
        ) {
          // We have a number (n) followed by a radical (r)
          // Convert to a numeric value
          // (only an exact number: a float `2.0` times `√2` is a float)
          const r = x.isExact ? asRational(x) : undefined;
          if (r) {
            ys.push(
              ce.number(
                ce._numericValue({ rational: r, radical: nextNv.radical })
              )
            );
            i++;
            continue;
          }
        } else if (isImaginaryUnitValue(nextNv)) {
          // "Next" is an imaginary unit. Is it preceded by a real number?
          const nv = x.numericValue;
          if (typeof nv === 'number') {
            // An integer literal: exact pure-imaginary (`2·i` → the exact 2i)
            ys.push(
              ce.number(
                ce._numericValue({ rational: [0, 1], imRational: [nv, 1] })
              )
            );
            i++;
            continue;
          } else if (!nv.isComplex) {
            const exact = nv.asExact;
            if (exact instanceof ExactNumericValue) {
              // An exact real (integer, rational or radical): promote to an
              // exact pure-imaginary value (`√2·i`, `(1/2)·i` stay exact)
              ys.push(
                ce.number(
                  ce._numericValue({
                    rational: [0, 1],
                    imRational: exact.rational,
                    imRadical: exact.radical,
                  })
                )
              );
              i++;
              continue;
            } else if (!nv.isExact) {
              // Keep the big decimal of the coefficient: the double
              // constructor `ce.complex()` would round `2·10^{-800}` to `0`
              // and drop the digits beyond 16 of a high-precision value.
              ys.push(
                ce.number(ce._numericValue({ re: 0, im: nv.bignumRe ?? nv.re }))
              );
              i++;
              continue;
            }
          }
        }
      }
    }
    ys.push(x);
  }

  // Account for the sign (if negative)
  if (sign < 0) {
    if (ys.length === 0) return ce.number(-1);
    if (ys.length === 1) {
      // Same wrong-kind rejection as the unsigned unary return below.
      if (heldNonNumericScalar(ys[0]))
        return ce.typeError('number', ys[0].type, ys[0]);
      return ys[0].neg();
    }
    return negateProduct(ce, ys);
  }

  if (ys.length === 0) return ce.number(1);
  if (ys.length === 1) {
    // The unary fold erases the `Multiply` operator, so the arithmetic
    // evaluate guard never sees this operand — a symbol holding a string
    // or boolean would flow through as-is (`Multiply(s)` with `s := "str"`
    // evaluated to `"str"` while the literal `Multiply("str")` refused at
    // boxing). Reject concrete non-numeric scalar evidence here; a lone
    // collection operand still folds (broadcast identity), and a valueless
    // symbol stays admitted.
    if (heldNonNumericScalar(ys[0]))
      return ce.typeError('number', ys[0].type, ys[0]);
    if (severalFactors && isAbsentSymbol(ys[0])) return ce.NaN;
    return ys[0];
  }

  return ce._fn('Multiply', sortProductOperands(ys));
}

// Tensor-aware product ordering (matrix products are non-commutative) is
// shared with the serializer and `negateProduct`: see `sortProductOperands`
// and `isTensorProductOperand` in `./order` (CORRECTNESS_FINDINGS P0-26).

function unnegate(op: Expression): [Expression, sign: number] {
  let sign = 1;
  while (isFunction(op, 'Negate')) {
    sign = -sign;
    op = op.op1;
  }

  // If a negative number, make it positive
  if (isNumber(op) && op.isNegative) {
    sign = -sign;
    op = op.neg();
  }

  return [op, sign];
}

// Moved from expand.ts to break expand ↔ arithmetic-mul-div cycle
/**
 * Multiply two expressions, distributing over any `Add` operand:
 * `expandProduct(k, a + b)` → `k·a + k·b`. This is the distribution step
 * behind {@link mul}; it is what makes `mul()` expand rather than preserve a
 * factored product.
 */
function expandProduct(
  lhs: Readonly<Expression>,
  rhs: Readonly<Expression>,
  matrixContext = false
): Expression {
  if (isFunction(lhs, 'Negate') && isFunction(rhs) && rhs.operator === 'Negate')
    return expandProduct(lhs.op1, rhs.op1, matrixContext);

  const ce = lhs.engine;

  if (isFunction(lhs, 'Negate'))
    return expandProduct(lhs.op1, rhs, matrixContext).neg();
  if (isFunction(rhs, 'Negate'))
    return expandProduct(lhs, rhs.op1, matrixContext).neg();

  // In a product with a matrix, a quotient whose denominator can be a matrix
  // is kept as one factor: the quotient is element-wise, so `(A/g(x))·A` is
  // not `(A·A)/g(x)`.
  const lhsDivide =
    isFunction(lhs, 'Divide') && (!matrixContext || isScalarFactor(lhs.op2));
  const rhsDivide =
    isFunction(rhs, 'Divide') && (!matrixContext || isScalarFactor(rhs.op2));

  if (lhsDivide && rhsDivide) {
    const denom = lhs.op2.mul(rhs.op2);
    return expandProduct(lhs.op1, rhs.op1, matrixContext).div(denom);
  }

  if (lhsDivide) return expandProduct(lhs.op1, rhs, matrixContext).div(lhs.op2);
  if (rhsDivide) return expandProduct(lhs, rhs.op1, matrixContext).div(rhs.op2);

  if (isFunction(lhs, 'Add')) {
    const terms: Expression[] = lhs.ops.map((x) =>
      expandProduct(x, rhs, matrixContext)
    );
    return addArray(terms);
  }
  if (isFunction(rhs, 'Add')) {
    const terms: Expression[] = rhs.ops.map((x) =>
      expandProduct(lhs, x, matrixContext)
    );
    return addArray(terms);
  }

  // A notational product (`2 · 4 · … · 2n`) is kept whole: the `Product`
  // below would lift its factors and fold them across the ellipsis.
  if (containsContinuationOperand(lhs) || containsContinuationOperand(rhs))
    return mulAroundNotationalProducts([lhs, rhs], (rest) =>
      rest.length === 1
        ? rest[0]
        : new Product(ce, rest, { matrixContext }).asExpression()
    );

  return new Product(ce, [lhs, rhs], { matrixContext }).asExpression();
}

/**
 * Is the factor `x` a matrix (or another collection), or does it have one as
 * a term or a factor? A `Negate` and the numerator of a `Divide` are read, as
 * `hasDistributableSum()` reads them.
 */
function hasMatrixPart(x: Expression): boolean {
  if (isFunction(x, 'Negate')) return hasMatrixPart(x.op1);
  if (isFunction(x, 'Divide')) return hasMatrixPart(x.op1);
  if (hasCollectionShape(x) || typeMayHoldMatrix(x)) return true;
  return (
    (isFunction(x, 'Add') || isFunction(x, 'Multiply')) &&
    x.ops.some((t) => hasCollectionShape(t) || typeMayHoldMatrix(t))
  );
}

/**
 * Is the factor `x` a scalar: is its type known to exclude a matrix? A
 * scalar commutes with every factor of a product, and its product with a sum
 * of matrices is distributed: `r·(B + C)` is `r·B + r·C`.
 */
function isScalarFactor(x: Expression): boolean {
  return !hasCollectionShape(x) && !mayBeTensorProductOperand(x);
}

/**
 * If the factor `x` is a sum of matrices that a product with matrices can be
 * distributed over, the terms of the sum. A `Negate`, and a `Divide` by a
 * scalar, are distributed with the sum: `-(B + C)` gives `-B` and `-C`.
 *
 * Each term of the sum must be a matrix (or another collection). The sum of a
 * matrix and a scalar adds the scalar to each element of the matrix, so the
 * product of a matrix and such a sum is not distributed: `A·(B + r)` is not
 * `A·B + r·A`. A term that can be a matrix (`g(x)`) can also be a scalar, so
 * a sum with such a term is not distributed either.
 */
function matrixSumTerms(x: Expression): Expression[] | undefined {
  if (isFunction(x, 'Negate'))
    return matrixSumTerms(x.op1)?.map((t) => t.neg());
  if (isFunction(x, 'Divide')) {
    if (!isScalarFactor(x.op2)) return undefined;
    const den = x.op2;
    return matrixSumTerms(x.op1)?.map((t) => t.div(den));
  }
  // A term that only MAY be a matrix (`any`, `broadcastable<number>`) may be a
  // number too: the sum of a matrix and a number adds the number to every
  // entry, so such a sum is not distributed.
  if (isFunction(x, 'Add') && x.ops.every(hasCollectionShape))
    return [...x.ops];
  return undefined;
}

/**
 * Expand the product of the factors `ops`, where a factor is or has a matrix
 * and a factor has a sum to distribute.
 *
 * The scalar factors (see `isScalarFactor()`) commute with the other
 * factors, so their product is expanded first, as for a product with no
 * matrix. The other factors keep their order. They are multiplied from left
 * to right, and each sum of matrices (see `matrixSumTerms()`) is distributed
 * in turn. The like terms are combined after each sum, so the number of terms
 * does not grow more than necessary. A sum with a term that is not a matrix
 * is kept as a factor. Last, the product of the scalar factors is distributed
 * over the result.
 *
 * Each product is made with the option `matrixContext`, so that a factor that
 * can be a matrix (`g(x)`) keeps its position. A sum makes its terms
 * canonical again, without that option. This is correct because each term
 * of a sum made here has a matrix, which a sum of matrices gives to each of
 * its terms, and the canonical form of a term with a matrix keeps the order
 * of its factors again.
 */
function expandMatrixProduct(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression {
  const scalars = ops.filter(isScalarFactor);
  let terms: Expression[] | undefined;
  for (const op of ops) {
    if (isScalarFactor(op)) continue;
    const choices = matrixSumTerms(op) ?? [op];
    if (terms === undefined) {
      terms = choices;
      continue;
    }
    const products = terms.flatMap((p) =>
      choices.map((t) =>
        new Product(ce, [p, t], { matrixContext: true }).asExpression()
      )
    );
    if (choices.length === 1) terms = products;
    else {
      const sum = addArray(products);
      terms = isFunction(sum, 'Add') ? [...sum.ops] : [sum];
    }
  }
  const scalar =
    scalars.length <= 1 ? scalars[0] : expandProducts(ce, scalars)!;
  if (terms === undefined) return scalar ?? ce.One;
  const rest = terms.length === 1 ? terms[0] : addArray(terms);
  if (scalar === undefined) return rest;
  return expandProduct(scalar, rest, true);
}

/**
 * Would {@link expandProduct} find a sum to distribute in `x`?
 *
 * This MIRRORS that function's recursion and must be changed with it: it peels
 * a `Negate`, and the NUMERATOR of a `Divide` (the denominator is carried
 * along by `.div()`, never distributed into), before asking whether what
 * remains is an `Add`. Testing only the top-level operand missed exactly those
 * shapes — `((a + b)/c)·d` still came back `(ad + bd)/c`, expanded, which is
 * the rational-linear-factor form a factored product is most wanted for.
 */
function hasDistributableSum(x: Expression): boolean {
  if (isFunction(x, 'Negate')) return hasDistributableSum(x.op1);
  if (isFunction(x, 'Divide')) return hasDistributableSum(x.op1);
  return isFunction(x, 'Add');
}

/**
 * Whether the fold of {@link expandProducts} over the factors `ops` can give
 * something other than the product of the factors. It changes a product
 * through a factor it reads specially: a sum it distributes over, a `Negate`
 * it takes out, a `Divide` whose numerator it multiplies, or a matrix (see
 * `hasMatrixPart()`) that makes it keep the order of the factors. It also
 * changes a product that has a power, a root or a square root of a sum: the
 * product of two such factors can be the sum itself, which the next step of
 * the fold distributes over (`2·√(x+1)·√(x+1)` is `2x + 2`). And it keeps an
 * invalid factor as the result (`Error·1` is the `Error`), where
 * `asRationalExpression()` divides it by `1`. Without such a factor, each
 * step of the fold is `new Product(…).asExpression()`, the product of the
 * factors that a caller can build once.
 */
export function expandProductsChanges(ops: ReadonlyArray<Expression>): boolean {
  return ops.some(
    (x) =>
      !x.isValid ||
      isFunction(x, 'Add') ||
      isFunction(x, 'Negate') ||
      isFunction(x, 'Divide') ||
      ((isFunction(x, 'Power') ||
        isFunction(x, 'Root') ||
        isFunction(x, 'Sqrt')) &&
        hasDistributableSum(x.op1)) ||
      hasMatrixPart(x)
  );
}

export function expandProducts(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | null {
  if (ops.length === 0) return null;
  if (ops.length === 1) return ops[0];
  // The product is folded from the right, `ops[0]·(ops[1]·(… · ops[n-1]))`,
  // in a loop: a recursion on `ops.slice(1)` used one stack frame and one
  // copy of the remaining operands per factor, so a product of about 8 000
  // factors threw `RangeError: Maximum call stack size exceeded`.
  //
  // A part of the fold, such as the product of the last two factors, does
  // not see a matrix in an earlier factor. When the product has a matrix, a
  // factor that can be a matrix (`g(x)` with `g` a function that was not
  // declared) must keep its order in each part too, or `A·g(x)·k(x)·g(x)`
  // becomes `A·k(x)·g(x)^2`. Each part is told so with `matrixContext`.
  //
  // A product with a matrix and a sum to distribute is expanded by
  // `expandMatrixProduct()`: the matrix product is not commutative, and the
  // sum of a matrix and a scalar is element-wise, so not every sum can be
  // distributed.
  const matrixContext = ops.some(hasMatrixPart);
  if (matrixContext && ops.some(hasDistributableSum))
    return expandMatrixProduct(ce, ops);
  let rhs = expandProduct(
    ops[ops.length - 2],
    ops[ops.length - 1],
    matrixContext
  );
  for (let i = ops.length - 3; i >= 0; i--)
    rhs = expandProduct(ops[i], rhs, matrixContext);
  return rhs;
}

/**
 * Multiply expressions, **expanding** products over sums.
 *
 * Unlike a canonical `Multiply` node (built via `ce.function('Multiply', …)`
 * or `ce.expr(['Multiply', …])`, which leaves `k·(a + b)` as-is), `mul()` runs
 * {@link expandProducts} first, so a factor is distributed across any sum
 * operand:
 *
 * ```
 * mul(2, ce.expr(['Add', 'a', 'b']))            // => 2a + 2b   (an Add)
 * ce.expr(['Multiply', 2, ['Add', 'a', 'b']])   // => 2(a + b)  (a Multiply)
 * ```
 *
 * Use `mul()` when you want the expanded/normalized product (the usual case in
 * canonicalization). Do **not** use it to build a deliberately *factored*
 * result — the distribution will undo the factoring. Use a canonical
 * `Multiply` node instead (see `factor()`'s Add case).
 *
 * `mulFactored()` is the same fold WITHOUT the distribution: it is what
 * `Multiply`'s evaluate handler uses, so a product of sums reaches the user
 * factored (user ruling, 2026-08-20). Internal callers keep `mul()`, whose
 * expansion several normalization paths depend on to reach a fixpoint.
 */
export function mul(...xs: ReadonlyArray<Expression>): Expression {
  return mulImpl(xs, true);
}

/**
 * `mul()` without the distribution over sums — `mulFactored(2, a + b)` is
 * `2(a + b)`, where `mul()` gives `2a + 2b`.
 *
 * `Multiply`'s evaluate handler uses this so that a product of sums reaches
 * the user FACTORED: `evaluate()` promises the most EXACT form, and a factored
 * product is exactly as exact as the polynomial it expands to while being
 * smaller — often dramatically so, since expanding multiplies the term count at
 * every factor. `Expand` still opens it and reproduces the old output verbatim.
 * `mulN`, the handler's `.N()` route, declines the distribution the same way,
 * so the two routes agree on shape (`2(x+1).N()` is `2(x + 1)`, not
 * `2x + 2`); and the tuple/tensor arms (`mulTuples`, `mulTensors`) carry the
 * same rule into the components.
 *
 * The distribution is NOT gone: `mul()` keeps it, because several
 * normalization paths depend on it to reach a fixpoint (sum simplification,
 * the cyclic integration-by-parts family, series at infinity, and the 3×3
 * symbolic determinant behind `CharacteristicPolynomial` — see
 * `tensor/tensor-fields.ts`). Removing it engine-wide left the rule engine
 * non-terminating.
 */
export function mulFactored(...xs: ReadonlyArray<Expression>): Expression {
  return mulImpl(xs, false);
}

/**
 * `mulFactored()` with the factors given as one array. A caller that holds the
 * factors of a product of arbitrary length (the operands of a `Multiply`
 * expression) uses this form: the call `mulFactored(...xs)` passes each factor
 * as a separate argument, and JavaScript throws `RangeError: Maximum call
 * stack size exceeded` when the number of arguments is too large (about
 * 100 000 factors or more).
 *
 * `operandsAreValues` is `true` when each factor is already the value of an
 * operand of the product (the `Multiply` evaluate handler): a vector or
 * matrix factor is then not evaluated again (see `mulTensors()`).
 */
export function mulFactoredArray(
  xs: ReadonlyArray<Expression>,
  operandsAreValues = false
): Expression {
  return mulImpl(xs, false, operandsAreValues);
}

/**
 * True when two or more of the factors `xs` are each a point or a list of
 * points (`isTupleCarrier`, `isPointListCarrier`). Such a product has no
 * value: `canonicalMultiply` answers the `no-product-between-points` error
 * at boxing, and the evaluation must give the same answer for a product that
 * was boxed before its operands had values. Without this test, the
 * evaluation of `x·x[1]` in the body of `x ↦ x·x[1]`, with `x` bound to
 * `[(3, 2), (1, 4)]`, mapped the product over the list of points and gave a
 * list of two errors, where the same product written with the list
 * (`[(3, 2), (1, 4)]·(3, 2)`) is one error, and the call was typed `error`
 * (ROADMAP CE-491). This is the twin of the test for a divisor that is a
 * point or a list of points in `div()`.
 */
function hasPointProductOperands(xs: ReadonlyArray<Expression>): boolean {
  let count = 0;
  for (const x of xs)
    if (isTupleCarrier(x) || isPointListCarrier(x)) {
      count += 1;
      if (count >= 2) return true;
    }
  return false;
}

function mulImpl(
  xs: ReadonlyArray<Expression>,
  expand: boolean,
  operandsAreValues = false
): Expression {
  console.assert(xs.length > 0);
  if (xs.length === 1) return xs[0];

  const ce = xs[0].engine;

  // Ellipsis fold barrier: a direct `ContinuationPlaceholder` operand makes
  // this a notational product; stay inert (do not fold via `Product`).
  if (xs.some((x) => isContinuationOperand(x)))
    return ce._fn(
      'Multiply',
      xs.map((x) => x.canonical)
    );
  // A factor that is (or holds) a notational product: multiply the other
  // factors and keep the notational product whole.
  if (xs.some((x) => containsContinuationOperand(x)))
    return mulAroundNotationalProducts(xs, (rest) => mulImpl(rest, expand));

  // An `Indeterminate` factor beside a factor that reads a variable with an
  // assigned value: the answer is `NaN` or `Indeterminate` depending on the
  // value the variable holds when the product is evaluated, so the product
  // is kept (`indeterminateAnswerReadsVariable()`).
  if (indeterminateAnswerReadsVariable(xs))
    return ce.function('Multiply', [...xs]);

  // Two factors that are each a point or a list of points have no product
  // (`hasPointProductOperands()`).
  if (hasPointProductOperands(xs)) return pointProductError(ce, xs);

  // A factor that is collection-TYPED but has no collection value yet (a
  // declared-but-unassigned `list<number>` symbol) is not a broadcast
  // participant, so each branch below would splice it whole into every cell as
  // if it were a scalar — freezing an outer product into the stored form.
  // Decline the element-wise dispatch and leave the product inert; once the
  // operand resolves, re-evaluating that product zips.
  const unresolvedFactor = hasUnresolvedCollectionOperand(
    xs,
    isBroadcastableCollection
  );
  // The one thing that outranks the veto: a length disagreement among the
  // factors that DO have values. No assignment to the unresolved factor can
  // reconcile 2 elements against 3, so the product is reported as an error
  // instead of held — the same error `Multiply([1,2], [3,4,5])` gives without
  // the unresolved factor.
  if (unresolvedFactor) {
    const mismatch = broadcastLengthMismatch(ce, xs);
    if (mismatch) return mismatch;
  }

  // An unknown/infinite-length indexed collection (a `Cycle`, a `Filter`, a
  // symbolic-length `Range`) can't be materialized or eagerly zipped without
  // truncating — return the lazy `Map` form. Checked BEFORE the tensor and
  // finite-broadcast branches so a mixed finite+infinite product (where a
  // finite `List` factor is a rank-1 tensor) maps ALL collections as `Map`
  // sources rather than routing to `mulTensors`. A finite tensor never triggers
  // this (its `count` is known-finite). Tuples stay atomic
  // (`isBroadcastableCollection` excludes them).
  if (!unresolvedFactor && xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      ce,
      'Multiply',
      xs,
      isBroadcastableCollection,
      false
    );

  // A point times a tensor of rank 3 or more scales the point at every cell
  // of the tensor, as for a vector or a matrix: each element of the tensor
  // (a tensor of rank one less) scales the point, down to the rank 2 that
  // `mulTensors` handles. `mulTensors` leaves a product with a tensor of
  // rank 3 unevaluated, and `div()` divides a point by such a tensor cell by
  // cell, so `(1, 2) · T` stayed unevaluated where `(1, 2) / T` did not.
  if (!unresolvedFactor && isPointTimesHighRankTensor(xs)) {
    const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, false, true);
    if (r) return r;
  }

  // Tensor (matrix/vector) operands follow matrix-product / scalar-scaling
  // semantics rather than the scalar Product machinery. A matrix held by a
  // symbol is a matrix too (`isMatrixProductOfValues()`): the broadcast
  // below would multiply each entry.
  if (
    !unresolvedFactor &&
    (xs.some((x) => isTensorValue(x)) || isMatrixProductOfValues(xs))
  ) {
    const r = mulTensors(ce, xs, false, expand, operandsAreValues);
    if (r) return r;
  }

  // A non-tensor finite indexed collection (a lazy `Range`, or a `List` that
  // emerged from evaluating a broadcast operand): broadcast the product over
  // its elements, keeping any numeric-tuple factor whole. This makes
  // `Range(-2,2)·(2,3)` a `List` of `Tuple`s — matching the eager-`List`
  // behavior (`mulTensors`) — instead of the transposed tuple `mulTuples`
  // would otherwise produce. Checked BEFORE the tuple branch so the collection
  // wins the dispatch; an unknown/infinite length returns `undefined` and
  // falls through (to `mulTuples`/`Product`, leaving an inert product).
  // Tuples (points/vectors, incl. Desmos point-lists like `(1, 0.3n)` with a
  // list component) are EXCLUDED — they scale component-wise via `mulTuples`,
  // never broadcast as a list.
  if (!unresolvedFactor && xs.some((x) => isFiniteBroadcastParticipant(x))) {
    const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, false, true);
    if (r) return r;
  }

  // Tuples (points/vectors): scalar · tuple scales component-wise, including a
  // tuple with a collection component (`2·(1, 0.3n)` → `(2, 0.6n)`); the
  // explicit `PointList` operator — not plain `Tuple` — carries the Desmos
  // list-of-points reading.
  if (xs.some((x) => isTuple(x)) && !hasUnresolvedTupleCofactor(xs))
    return mulTuples(ce, xs, false, expand);

  // An absent factor (`Missing`, `Undefined`, or a product or negation of
  // one) makes the product `NaN`, as the `Multiply` operator answers at
  // evaluation: arithmetic with an absent operand is `NaN` (user decision of
  // 2026-09-25). Before, `ce.box('Missing').mul(ce.box(2))` was
  // `2·"Missing"`. A tuple co-factor was handled above: an absent factor
  // beside a point makes the whole point absent (`mulTuples`). A factor that
  // is collection-typed but has no value yet (`L: list<number>`) keeps the
  // product inert: once it resolves, the absence is broadcast over its cells.
  if (
    xs.some((x) => isAbsentArithmeticOperand(x)) &&
    !xs.some((x) => !isAbsentSymbol(x) && isUnresolvedCollectionOperand(x))
  )
    return ce.NaN;

  // A kind value among the factors (a residue class): only the hooks of the
  // kinds apply, after the broadcast over a collection above
  // (`kindArithmetic()`). The factors that hold no kind value are multiplied
  // by this function.
  const residue = kindArithmetic(ce, 'Multiply', xs, (rest) =>
    mulImpl(rest, expand)
  );
  if (residue !== undefined) return residue;

  // A zero factor beside a factor that reads a variable with an assigned
  // value is not folded to `0`: the product must keep the value the variable
  // holds when it is evaluated, not the value it holds now. With `w := NaN`,
  // `0·w` evaluates to `NaN`, and after `w := 4` it evaluates to `0`. This is
  // the rule of `BoxedSymbol.mul(0)` (`boxed-symbol.ts`) and of a canonical
  // `Multiply(0, w)`, so `w.mul(0)`, `w.mul(ce.Zero)` and `ce.Zero.mul(w)`
  // give the same product. The other factors are dropped, as the fold drops
  // them: a free symbol or a finite number times `0` is `0`. The fold below
  // handles three cases instead: a `NaN` or an infinite literal factor (the
  // indeterminate form), and a factor that cannot be a number (an `Error`, a
  // string, a boolean), which the fold keeps or reports as an error rather
  // than absorbing it in the zero. This rule is for scalar factors: a point
  // or a list factor was handled above, where the product is computed per
  // component from the values the components hold now.
  const zero = xs.find((x) => isNumber(x) && x.isSame(0));
  if (
    zero !== undefined &&
    !xs.some((x) => isNumber(x) && (x.isNaN || x.isInfinity === true)) &&
    !xs.some(
      (x) =>
        x.operator === 'Error' ||
        x.type.isDisjointFrom(
          'number | indexed_collection<number> | missing | nothing'
        )
    )
  ) {
    const held = xs.filter((x) => !isNumber(x) && hasAssignedVariable(x));
    // A float factor is kept beside the held factors: it is what makes the
    // product `NaN` instead of `Indeterminate` when a held factor evaluates
    // to an infinity (`0 · 2.5 · w` with `w := ∞`), as the canonical
    // `Multiply(0, 2.5, w)` does. The zero itself is excluded from them: a
    // float zero is inexact too, and `0.0.mul(w)` was `0 · 0 · w`.
    if (held.length > 0)
      return ce.function('Multiply', [
        zero,
        ...xs.filter((x) => x !== zero && isNumber(x) && !x.isExact),
        ...held,
      ]);
  }

  // `expandProducts` does two things: it distributes over sums, and — as a
  // side effect of walking the operands pairwise — it folds the product two at
  // a time. Only the DISTRIBUTION is what `mulFactored` declines, so the fold
  // is skipped only when a sum is actually reachable. Skipping it
  // unconditionally changed the folding ORDER of an ordinary numeric product,
  // and `-2 · 3.1 · ∞ · ∞ · x` then came back `+∞·x` at machine precision
  // instead of `-∞·x`. With no reachable sum, `mulFactored` is `mul`.
  // The pairwise fold of `expandProducts` can lose a float factor before the
  // product meets its indeterminate form: `0 · 2.5` folds to the exact `0`,
  // and `0 · ∞` is then `Indeterminate`. A float operand makes the answer
  // `NaN` (`indeterminateFormAnswer()`), so the operands are read again when
  // the product is `Indeterminate`.
  const operands = xs;
  const floatContact = (result: Expression): Expression =>
    result.isIndeterminate && operands.some((x) => isInexactOperand(x))
      ? ce.NaN
      : result;
  if (expand || !xs.some(hasDistributableSum)) {
    // Without a factor that `expandProducts` reads specially
    // (`expandProductsChanges`), its fold builds the product that
    // `asRationalExpression` below builds again from its factors, so the
    // product is built once. Only for a finite nonzero coefficient: for a
    // zero, `NaN` or infinite coefficient, `asExpression()` (the fold) and
    // `asRationalExpression()` give different answers (the fold keeps an
    // `Error` factor of `0 · Sin((A, B))`, `asRationalExpression()` gives
    // `0`), and the fold's answer is the one to keep.
    if (!expandProductsChanges(xs)) {
      const product = new Product(ce, xs);
      const c = product.coefficient;
      if (
        !c.isZero &&
        !c.isNaN &&
        !c.isPositiveInfinity &&
        !c.isNegativeInfinity &&
        !c.isComplexInfinity
      )
        return floatContact(product.asRationalExpression());
    }
    const exp = expandProducts(ce, xs);
    if (exp) {
      if (exp.operator !== 'Multiply') return floatContact(exp);
      if (isFunction(exp)) xs = exp.ops;
    }
  }

  return floatContact(new Product(ce, xs).asRationalExpression());
}

/**
 * Whether `x` is a number literal holding an exact integer or rational. A
 * radical is not included: its product with a big-decimal factor would keep
 * the unrounded digits of both factors (`√2·π` came out with 50 digits), so
 * it is numericized first, as before.
 */
function isExactRealLiteral(x: Expression): boolean {
  if (!isNumber(x)) return false;
  const nv = x.numericValue;
  if (typeof nv === 'number') return Number.isInteger(nv);
  return (
    nv.isExact &&
    !nv.isComplex &&
    nv instanceof ExactNumericValue &&
    nv.radical === 1
  );
}

/**
 * Whether `x` is a real number literal whose value is 0, ±∞, NaN or a
 * subnormal double (see `isOutsideNormalDoubleRange()`). After a numeric
 * evaluation, this is what an exact factor such as `1/10^400`, `10^400` or
 * `10^{-320}` becomes at machine precision, because a double cannot hold it
 * exactly enough. The usual literal costs one comparison.
 */
export function isOutOfDoubleRangeLiteral(x: Expression): boolean {
  if (!isNumber(x)) return false;
  const nv = x.numericValue;
  if (typeof nv === 'number') return isOutsideNormalDoubleRange(nv);
  if (nv.isComplex || !isOutsideNormalDoubleRange(nv.re)) return false;
  if (nv.isZero || nv.isNaN || nv.isPositiveInfinity || nv.isNegativeInfinity)
    return true;
  // A value with a big-decimal part (an exact value, or a big decimal) holds
  // a tiny or a huge magnitude without loss: only a double can be out of the
  // range.
  return nv.bignumRe === undefined;
}

/**
 * Whether `x` is a number literal with an exact real value: an integer, a
 * rational, or a rational multiple of a square root (`√2/10^400`). This is
 * the test for the factors that `foldOutOfDoubleRange()` can use. It is wider
 * than `isExactRealLiteral()`, which excludes the radicals of an ordinary
 * product.
 */
function isExactRealValue(x: Expression): boolean {
  if (!isNumber(x)) return false;
  const nv = x.numericValue;
  if (typeof nv === 'number') return Number.isInteger(nv);
  return nv instanceof ExactNumericValue && !nv.isComplex;
}

/**
 * The numeric product of the number factors of `xs`, computed from the exact
 * values where the float of a factor is out of the normal double range (see
 * `isOutOfDoubleRangeLiteral`) while its exact value is not zero.
 *
 * `xs` are the factors after the numeric evaluation, `originals` the factors
 * before it, `exactFactors[i]` the exact literal of `originals[i]` if it is
 * one. A factor that is not a literal, and was not already evaluated
 * (`numeric[i]`), gets its exact value from `evaluate()`: `10^{-400}` is the
 * exact rational `1/10^400`.
 *
 * The product is computed with big decimals: a big-decimal product is exact,
 * so the only rounding is the conversion of the result to the working lane.
 * `1e300 · 1/10^400` is then `1e-100`, not `1e300 · 0`, whatever the order
 * of the factors. The result is the numeric product as one literal, followed
 * by the factors that are not numbers.
 *
 * A complex number factor with a finite value is multiplied into the numeric
 * product after the fold of the real factors, so that the result has one
 * number factor, as at the default precision. Returns `undefined` when no
 * factor has an exact value that is not zero (the 0 or ±∞ is then the true
 * value of the factor), or when another number factor is not real.
 */
function foldOutOfDoubleRange(
  ce: ComputeEngine,
  originals: ReadonlyArray<Expression>,
  xs: ReadonlyArray<Expression>,
  exactFactors: ReadonlyArray<Expression | undefined>,
  numeric?: ReadonlyArray<boolean>
): Expression[] | undefined {
  const rest: Expression[] = [];
  const complexFactors: Expression[] = [];
  let rescued = false;
  let product = BigDecimal.ONE;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (!isNumber(x)) {
      // A factor such as `10^{400}/x` keeps its exact coefficient after the
      // numeric evaluation, because its double would be ∞. The coefficient
      // is taken out and folded with the other number factors:
      // `(10^{400}/x)·10^{-399}` is then `10/x`, not `0·(10^{400}/x)`.
      const split = exactCoefficientOutOfRange(ce, x);
      if (split === undefined) rest.push(x);
      else {
        product = product.mul(split[0]);
        rest.push(split[1]);
        rescued = true;
      }
      continue;
    }
    const outOfRange = isOutOfDoubleRangeLiteral(x);
    let ex = exactFactors[i];
    if (ex === undefined && outOfRange && !numeric?.[i]) {
      const v = isNumber(originals[i]) ? originals[i] : originals[i].evaluate();
      if (isExactRealValue(v)) ex = v;
    }
    const y = ex ?? x;
    // A complex factor with a finite value (`1 + i`) is not folded with the
    // big decimals, which are real. It is multiplied into the result of the
    // fold below: `(10^{400}/y) · 10^{-399} · (1 + i)` is then
    // `(10 + 10i)/y`.
    if (
      isNumber(y) &&
      y.isComplex &&
      !outOfRange &&
      Number.isFinite(y.re) &&
      isImaginaryPartFinite(y)
    ) {
      complexFactors.push(y);
      continue;
    }
    if (!isNumber(y) || y.isComplex) return undefined;
    const nv = y.numericValue!;
    if (ex !== undefined && outOfRange && !ex.isSame(0)) rescued = true;
    // `bignumRe` of an exact rational has at least 25 digits (see
    // `ExactNumericValue`); a double converts to a big decimal exactly.
    product = product.mul(
      typeof nv === 'number' ? new BigDecimal(nv) : (nv.bignumRe ?? nv.re)
    );
  }
  if (!rescued) return undefined;
  let coefficient = ce.number(ce._numericValue(product)).N();
  for (const z of complexFactors) coefficient = coefficient.mul(z);
  return [coefficient, ...rest];
}

/**
 * If `x` is `Divide(c, d)` or `Multiply(c, …)` where `c` is an exact real
 * number literal whose double is outside the normal double range, the
 * big-decimal value of `c` and the factor without `c` (`1/d`, or the product
 * of the other operands). Otherwise, `undefined`.
 */
function exactCoefficientOutOfRange(
  ce: ComputeEngine,
  x: Expression
): [BigDecimal, Expression] | undefined {
  if (!isFunction(x)) return undefined;
  const op = x.operator;
  if (op !== 'Divide' && op !== 'Multiply') return undefined;
  const c = x.ops[0];
  if (!isNumber(c) || !(c.numericValue instanceof ExactNumericValue))
    return undefined;
  const nv = c.numericValue;
  if (nv.isComplex || nv.isZero || !isOutsideNormalDoubleRange(nv.re))
    return undefined;
  const rest =
    op === 'Divide'
      ? ce.function('Divide', [ce.One, x.ops[1]])
      : ce.function('Multiply', x.ops.slice(1));
  return [nv.bignumRe, rest];
}

/**
 * The product of the factors `xs` when one or more of them is a product
 * with a direct `ContinuationPlaceholder` operand (`isNotationalProduct()`),
 * such as the `2 · 4 · … · 2n` of `3(2 · 4 · … · 2n)`, or holds one in a
 * nested product.
 *
 * Such a product is a notation, not an arithmetic value. When its operands
 * are lifted into the enclosing product, the factors on each side of the
 * ellipsis are folded together and the last sample `2n` becomes the two
 * factors `2` and `n`: `3(2 · 4 · … · 2n)` became `48 · … · n`. So the
 * notational products are kept whole, the other factors are multiplied with
 * `mulRest`, and the result is that product times the notational products:
 * `3 · 5 · (2 · 4 · … · 2n)` is `15 · (2 · 4 · … · 2n)`. `expand()` keeps
 * such a product whole for the same reason. `negate()` does not: it negates
 * the first sample, and `-(2 · 4 · … · 2n)` is `(-2) · 4 · … · 2n`
 * (`test/compute-engine/ce-163-negated-continuation.test.ts`). A coefficient
 * `0`, `NaN` or `Indeterminate` gives the answer of `Product` for that
 * coefficient (`0`, `NaN` or `Indeterminate`). (ROADMAP CE-462.)
 */
export function mulAroundNotationalProducts(
  xs: ReadonlyArray<Expression>,
  mulRest: (rest: ReadonlyArray<Expression>) => Expression
): Expression {
  const ce = xs[0].engine;
  const flat = flattenKeepingNotationalProducts(xs, 'Multiply');
  const notational = flat.filter((x) => isNotationalProduct(x));
  const rest = flat.filter((x) => !isNotationalProduct(x));
  const factors: Expression[] = [];
  if (rest.length > 0) {
    const coefficient = mulRest(rest);
    // A `0`, `NaN` or `Indeterminate` coefficient follows the usual rules of
    // a product: `Product` answers `0` (or the `NaN` of `0 · ∞`) for a zero
    // coefficient and `NaN` or `Indeterminate` for a `NaN`-valued one. With
    // such a coefficient, `Product` does not lift the factors of the
    // notational products into the result.
    if (isNumber(coefficient) && (coefficient.isNaN || coefficient.isSame(0)))
      return new Product(ce, [coefficient, ...notational]).asExpression();
    if (!(isNumber(coefficient) && coefficient.isSame(1)))
      factors.push(coefficient);
  }
  factors.push(...notational);
  const result = flattenKeepingNotationalProducts(factors, 'Multiply');
  if (result.length === 0) return ce.One;
  if (result.length === 1) return result[0];
  return ce._fn('Multiply', result);
}

export function mulN(...xs: ReadonlyArray<Expression>): Expression {
  return mulNEvaluated(xs);
}

/**
 * The same as `mulN`, but a factor `xs[i]` with `numeric[i] === true` is
 * already the result of a numeric evaluation, and it is not numericized
 * again. The `Multiply` evaluate handler uses this: it has already evaluated
 * its operands numerically, and a second numeric evaluation of each operand
 * made the cost of nested sums and products double at each level.
 */
export function mulNEvaluated(
  xs: ReadonlyArray<Expression>,
  numeric?: ReadonlyArray<boolean>
): Expression {
  console.assert(xs.length > 0);
  // A single factor is its own product, floated. `mulTuples` combines the
  // scalar factors with a recursive call and `mulTensors` buckets a numeric
  // tuple as a scalar, so `N([0, 1/3] · (1, 0))` reached `mulN((1, 0))`,
  // whose tuple branch then called `mulN()` with NO factors and crashed on
  // `xs[0]` — the short-circuit `mul` has always had.
  if (xs.length === 1) return numeric?.[0] ? xs[0] : xs[0].N();
  const ce = xs[0].engine;
  // Ellipsis fold barrier: stay inert for a notational product.
  if (xs.some((x) => isContinuationOperand(x)))
    return ce._fn(
      'Multiply',
      xs.map((x) => x.canonical)
    );
  // A factor that is (or holds) a notational product: multiply the other
  // factors and keep the notational product whole.
  if (xs.some((x) => containsContinuationOperand(x)))
    return mulAroundNotationalProducts(xs, (rest) => mulNEvaluated(rest));
  // Two factors that are each a point or a list of points have no product
  // (see `mulImpl`).
  if (hasPointProductOperands(xs)) return pointProductError(ce, xs);
  // A collection-TYPED but valueless co-factor vetoes the element-wise
  // dispatch here exactly as it does on the exact route (see `mulImpl`).
  let unresolvedFactor = hasUnresolvedCollectionOperand(
    xs,
    isBroadcastableCollection
  );
  // A definite length disagreement outranks the veto here too (see `mulImpl`).
  if (unresolvedFactor) {
    const mismatch = broadcastLengthMismatch(ce, xs);
    if (mismatch) return mismatch;
  }
  // Unknown/infinite-length indexed collection → lazy `Map` (see `mul`, which
  // documents why this precedes the tensor branch); the `N`-wrap threads
  // through so elements float on access.
  if (!unresolvedFactor && xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      ce,
      'Multiply',
      xs,
      isBroadcastableCollection,
      true
    );
  // A point times a tensor of rank 3 or more (see `mulImpl`).
  if (!unresolvedFactor && isPointTimesHighRankTensor(xs)) {
    const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, true, true);
    if (r) return r;
  }
  // The `Multiply` evaluate handler passes a symbol as it is here, so a
  // matrix held by a symbol is read by `isMatrixProductOfValues()` (see
  // `mulImpl`).
  if (
    !unresolvedFactor &&
    (xs.some((x) => isTensorValue(x)) || isMatrixProductOfValues(xs))
  ) {
    const r = mulTensors(ce, xs, true);
    if (r) return r;
  }
  // Broadcast over a non-tensor finite indexed collection (see `mul`).
  if (!unresolvedFactor && xs.some((x) => isFiniteBroadcastParticipant(x))) {
    const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, true, true);
    if (r) return r;
  }
  // An INERT result (still a `Multiply`) falls through to the post-evaluation
  // re-dispatch, mirroring `addN` (Tycho item 52).
  // A co-factor whose TYPE is a collection but whose collection-ness is not
  // yet a capability — a pure raw operand such as `Divide(Range(0, n), n)`,
  // handed in unevaluated so its evaluation runs exactly once below — becomes
  // a collection under the `.N()` map. Scaling the tuple by it HERE would
  // transpose a point view into a tuple of coordinate views (`N((k/n)·(1, 0))`
  // came back `(Map(…), Map(…))` while `evaluate()` kept the view of points).
  // Leave it to the post-evaluation re-dispatch, where the collection wins the
  // dispatch exactly as it does on the exact route (`mulImpl`).
  let tupleInert = false;
  if (xs.some((x) => isTuple(x))) {
    if (xs.some((x) => !isTuple(x) && isBroadcastCollectionType(x)))
      tupleInert = true;
    else {
      const r = mulTuples(ce, xs, true);
      if (r.operator !== 'Multiply') return r;
      tupleInert = true;
    }
  }
  // An exact integer or rational literal is remembered here and, when every
  // factor is a number literal, folded into the product's coefficient as is
  // in the scalar assembly at the end: its product with a float factor is
  // then `(x · p) / q` in the float lane, the numerator first (one rounding
  // in the big-decimal lane, and in the machine lane the double JavaScript's
  // `x * p / q` gives). Numericizing it first rounded the quotient and then
  // the product, and `sin(π/6)` at 21 digits was `0.500…001` where the
  // kernel answers `0.5` for the correctly rounded angle. Every other
  // product floats each literal as before: the collection, tensor and tuple
  // dispatches below see floats (`PointX` of an exact point list under
  // `.N()` floats), and a product with a symbolic factor keeps no exact
  // coefficient that `expandProducts` could rebuild into a `Divide`
  // (`(1/3)·(1/x)` under `.N()` is `0.333…/x`, not `1/(3x)`).
  let exactFactors = xs.map((x, i) =>
    !numeric?.[i] && isExactRealLiteral(x) ? x : undefined
  );
  const originals = xs;
  xs = xs.map((x, i) => (numeric?.[i] ? x : x.N()));
  // A factor whose float underflows to 0, overflows to ±∞ or is subnormal
  // while its exact value is not (see `foldOutOfDoubleRange`) is folded with
  // the other number factors from its exact value. A factor with an exact
  // coefficient outside the double range (`10^{400}/y`, see
  // `exactCoefficientOutOfRange`) is folded in the same way. The test is one
  // scan of the factors, so the usual product pays nothing more.
  if (
    xs.some(
      (x) =>
        isOutOfDoubleRangeLiteral(x) ||
        (isFunction(x) && exactCoefficientOutOfRange(ce, x) !== undefined)
    )
  ) {
    const folded = foldOutOfDoubleRange(
      ce,
      originals,
      xs,
      exactFactors,
      numeric
    );
    if (folded) {
      if (folded.length === 1) return folded[0];
      xs = folded;
      exactFactors = xs.map(() => undefined);
    }
  }
  // Post-evaluation re-dispatch (Tycho item 52): an operand may only have
  // BECOME a collection through the numeric evaluation above (`Mod(L,11)`
  // over a list `L` → a lazy `Map`) — the raw-operand dispatches missed it
  // and the product was left inert (`0.2·collection` unreduced). Mirrors the
  // pre-evaluation branches (see the matching comment in `addN`); linear, no
  // re-entry, and gated so the hot all-numeric path pays a single cheap
  // `isFunction` sweep.
  if (tupleInert || xs.some((x) => isFunction(x))) {
    // Recomputed over the numericized operands: `.N()` can turn a raw operand
    // into a collection, which changes who the participants are.
    unresolvedFactor = hasUnresolvedCollectionOperand(
      xs,
      isBroadcastableCollection
    );
    if (unresolvedFactor) {
      const mismatch = broadcastLengthMismatch(ce, xs);
      if (mismatch) return mismatch;
    }
    if (!unresolvedFactor && xs.some(isUnknownLengthBroadcast))
      return lazyBroadcastMap(
        ce,
        'Multiply',
        xs,
        isBroadcastableCollection,
        true
      );
    if (!unresolvedFactor && xs.some((x) => isTensorValue(x))) {
      const rt = mulTensors(ce, xs, true);
      if (rt) return rt;
    }
    if (!unresolvedFactor && xs.some((x) => isFiniteBroadcastParticipant(x))) {
      const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, true, true);
      if (r) return r;
    }
    if (xs.some((x) => isTuple(x)) && !hasUnresolvedTupleCofactor(xs))
      return mulTuples(ce, xs, true);
  }
  // Same gate as `mulFactored`: `.N()` is `evaluate()` with floats, so a
  // product of sums must reach the user FACTORED on this route too —
  // `2(x+1).N()` is `2(x + 1)`, matching `evaluate()`, not `2x + 2`. Only the
  // DISTRIBUTION is declined; with no reachable sum, `expandProducts` still
  // runs for its pairwise fold (see `mulImpl` for why skipping it
  // unconditionally reorders an ordinary numeric fold). A sum that is a
  // closed constant has already been numericized by the `.N()` map above, so
  // it is a number literal here and the gate does not see it.
  //
  // With a sum kept, the product is assembled as a RATIONAL expression, the
  // way `mulImpl` does, so a `Divide` factor keeps its quotient shape:
  // `((a+b)/c)·d` is `(d(a + b))/c`, matching `evaluate()`. The plain
  // numeric assembly below renders a denominator as a `1/c` FACTOR
  // (`d · 1/c · (a + b)`), because that is the form `expandProducts` used to
  // fold away before it was skipped. The two assemblies differ only in how
  // the coefficient is spelled, and every operand has already been
  // numericized above, so no exactness is at stake.
  if (xs.some(hasDistributableSum))
    return new Product(ce, xs).asRationalExpression();

  // The scalar assembly, with the exact integer and rational literals when
  // every factor is a number literal (see the numericizing map above). A
  // product that folds to an exact literal (`(1/3)·(2/3)`) is floated, since
  // this is the numeric route. In the machine lane, an exact complex literal
  // is floated too: an exact factor lifts a float Gaussian integer such as
  // `i` back to an exact value, and `(10^{400} + 1)·i` then folded to an
  // exact complex literal whose imaginary part is above the largest double.
  // `.N()` promises a float, so the result is the complex float (here the
  // complex infinity). The big-decimal lane is not changed by this test.
  let factors: ReadonlyArray<Expression> = xs.every((x) => isNumber(x))
    ? xs.map((x, i) => exactFactors[i] ?? x)
    : xs;
  const floatLiteral = (r: Expression): Expression =>
    isExactRealLiteral(r) || (isNumber(r) && !bignumPreferred(ce)) ? r.N() : r;
  // Without a factor that `expandProducts` reads specially
  // (`expandProductsChanges`), its fold builds, at each step, the product of
  // the factors that `Product` builds here once, as `mulImpl` does. The fold
  // builds a new `Product` for each factor, and each one compares the new
  // factor with the factors it holds, so a product of n distinct symbols
  // took a time of the order of n³: 2000 factors took 8.6 s. The same guard
  // on the coefficient as in `mulImpl`: for a zero, `NaN` or infinite
  // coefficient the fold gives a different answer, which is kept. A product
  // of number literals only keeps the fold: it has no terms to compare, so
  // its fold is fast, and the order of its float products is kept (the
  // fold multiplies from the right, `Product` from the left, and the last
  // digit of a machine float can differ).
  if (!factors.every((x) => isNumber(x)) && !expandProductsChanges(factors)) {
    const product = new Product(ce, factors);
    const c = product.coefficient;
    if (
      !c.isZero &&
      !c.isNaN &&
      !c.isPositiveInfinity &&
      !c.isNegativeInfinity &&
      !c.isComplexInfinity
    ) {
      const r = product.asExpression({ numericApproximation: true });
      return r.operator === 'Multiply' ? r : floatLiteral(r);
    }
  }
  const exp = expandProducts(ce, factors);
  if (exp) {
    if (exp.operator !== 'Multiply') return floatLiteral(exp);
    if (isFunction(exp)) factors = exp.ops;
  }

  return new Product(ce, factors).asExpression({
    numericApproximation: true,
  });
}

/**
 * Does a product with a tuple factor carry a CO-FACTOR that is
 * collection-typed but has no collection value yet?
 *
 * `mulTuples` splices every non-tuple factor into each COMPONENT of the tuple,
 * which is the same per-cell capture the broadcast branches above decline —
 * one rank up. `Multiply(Tuple(1, 2), s)` for a valueless `s: list<number>`
 * stored the tuple of products `(s, 2s)`, which materializes as the tuple of
 * lists `([10,20], [20,40])` once `s := [10, 20]`, where evaluating the same
 * product fresh transposes to the point list `[(10, 20), (20, 40)]`.
 *
 * Asked separately from `hasUnresolvedCollectionOperand`, which requires an
 * actual broadcast PARTICIPANT: a tuple is not one — it is atomic under
 * broadcast — so a tuple-and-symbol product has no participant at all and that
 * veto stays silent. Keeping the participant requirement there is what lets an
 * ordinary symbolic product such as `2·s` or `s^2`, which has no tuple either,
 * keep folding.
 */
function hasUnresolvedTupleCofactor(xs: ReadonlyArray<Expression>): boolean {
  return xs.some((x) => !isTuple(x) && isUnresolvedCollectionOperand(x));
}

/** True when `expr` names a symbol that holds a value which a later
 * assignment can change (a constant never changes). */
function readsAssignedVariable(ce: ComputeEngine, expr: Expression): boolean {
  return expr.symbols.some((name) => {
    const def = ce.lookupDefinition(name);
    return (
      def !== undefined &&
      'value' in def &&
      !def.value.isConstant &&
      def.value.value !== undefined
    );
  });
}

/**
 * Multiply operands when at least one is a numeric tuple (point/vector in ℝⁿ).
 *
 * - **scalar · tuple**: scale every component by the product of the scalar
 *   factors (`2 · (1,2)` → `(2,4)`), staying exact through the scalar `mul`.
 * - **two or more tuples**: no implicit product (dot/cross) — return a
 *   `no-product-between-points` error naming `Dot`/`Cross`
 *   (`pointProductError`; canonicalization rejects the same shape, so this arm
 *   is reached only when the product was built without it).
 * - A symbolic tuple (no accessible components) stays a symbolic `Multiply`.
 */
function mulTuples(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  numericApproximation: boolean,
  // `false` on the `Multiply` evaluate route (via `mulFactored`), so a
  // component that is a sum stays factored like a scalar product would:
  // `(1,2)·(x+1)` evaluates to `(x + 1, 2(x + 1))`. The `.N()` route is
  // always factored (`mulN`), so the flag only steers the exact route.
  expand = true
): Expression {
  const multiply = numericApproximation ? mulN : expand ? mul : mulFactored;
  // Any tuple-typed operand counts — including a tuple with a collection
  // component (`(1, 0.3n)` with `n` a list), whose components scale via the
  // ordinary scalar·list broadcast below.
  const tuples = xs.filter((x) => isTuple(x));
  const scalars = xs.filter((x) => !isTuple(x));

  if (tuples.length >= 2) return pointProductError(ce, xs);

  // An absent factor (`Missing` or `Undefined`) beside a point makes the
  // whole point absent: a tuple is atomic, so there is no cell for the
  // absence to land in (`docs/ERROR-MODEL.md` §3). The `Multiply` operator
  // already answers `Missing` at evaluation; the `.mul()` method answered the
  // half-absent point `("Missing", NaN)` for `Missing · (1, 2)`. A negated
  // or scaled absence (`-Missing`, `2·Missing`) is an absent factor too, as
  // in `addTuples`: scaled into the components it gave `(NaN, NaN)`.
  if (scalars.some((x) => isAbsentScalarTerm(x))) return ce.Missing;

  const tuple = tuples[0];

  // No accessible components (symbolic tuple, e.g. `2·z`): stay symbolic.
  // A unit scalar factor is dropped first, so the cell a list broadcast
  // builds for `[1, 2] · p` is `p`, not `1p`: `_fn` bypasses the `1 · x`
  // fold the canonical `Multiply` applies. With every scalar a unit the
  // product IS the tuple.
  if (!hasAccessibleComponents(tuple) || !isFunction(tuple)) {
    const factors = xs.filter((x) => !isLiteral(x, 1));
    if (factors.length === 1) return factors[0];
    return ce._fn('Multiply', sortProductOperands(factors));
  }

  // Combine the scalar factors (commutative). `scalars` is non-empty because
  // `mul`/`mulN` short-circuit single-operand calls before reaching here.
  const scalar = multiply(...scalars);

  // Evaluate each component first (mirrors `mulTensors`): a raw component like
  // `0.3n` with `n` a list must materialize before the scalar product, or the
  // recursive `mul`/`mulN` sees a non-iterable operand and stays inert.
  // On the exact routes the component product is finished with `.evaluate()`
  // so the `Multiply` handler's closed-inexact-constant rule applies to each
  // component as to a scalar product (`0.5 · (π, 1)` is `(1.57…, 0.5)`, like
  // `0.5 · π`); the `.N()` route has already floated it. See `mulTensors`.
  const components = tuple.ops.map((c) => {
    // A component that names an assigned variable stays a product on the
    // exact routes, as a scalar factor does: evaluating it would store the
    // value that the variable holds now (`2·(w, 2)` with `w := 4` would be
    // `(8, 4)` and would not follow a later `w := 5`). A collection component
    // is still evaluated, because a cell product needs its elements.
    // (CE-121)
    if (
      !numericApproximation &&
      !c.type.matches('collection') &&
      readsAssignedVariable(ce, c)
    )
      return multiply(scalar, c);
    const cv = numericApproximation ? c.N() : c.evaluate();
    // An absent component (`Missing` or `Undefined`) is `NaN` in this numeric
    // slot. `mulN()` keeps the symbol, so without this `(2·(1, Missing)).N()`
    // was `(2, 2·Missing)` while the exact route gave `(2, NaN)`.
    if (isAbsentSymbol(cv)) return ce.NaN;
    const product = multiply(scalar, cv);
    return numericApproximation ? product : product.evaluate();
  });
  return ce.tuple(...components);
}

/**
 * Multiply operands when at least one is a tensor (vector or matrix),
 * following the matrix-product convention:
 *
 * - **Scalar × tensor**: scale every element by the product of the scalar
 *   factors (`2 * [1,2,3]` → `[2,4,6]`).
 * - **Two or more tensors**: folded left-to-right in the given order. Any fold
 *   step involving a rank-2+ tensor (`matrix·matrix`, `matrix·vector`,
 *   `vector·matrix`) is the **matrix product**. A step between two rank-1
 *   vectors is the **element-wise (Hadamard) product** — `[1,2,3]·[4,5,6]` →
 *   `[4,10,18]` — matching `Add`'s element-wise semantics (Issue #29); it is
 *   *not* the dot product (use the explicit `Dot`/`MatrixMultiply` operators
 *   for that). The rank test is **per step**, on the accumulated product: a
 *   contraction that reduces to a vector then combines element-wise with a
 *   following vector (`M·u·v` = `(M·u) ⊙ v`, not the scalar `(M·u)·v`) — a
 *   step's semantics never depend on operands elsewhere in the chain. Matrix
 *   product is *not* commutative, so order matters: the canonical form of
 *   `Multiply` floats scalar factors to the front while preserving the
 *   relative order of the tensor operands, so `xs` is already in the order the
 *   user wrote.
 *
 * Returns the `incompatible-dimensions` error of `MatrixMultiply` when a
 * matrix step has incompatible dimensions. Declines (`undefined`) for a
 * product of tensors that all have rank 3 or more and the same length,
 * which the caller broadcasts, and stays inert for a tensor of rank 3 or
 * more beside a vector or a matrix.
 */
function mulTensors(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  numericApproximation = false,
  // `false` on the `Multiply` evaluate route (via `mulFactored`): a scalar
  // factor that is a sum is NOT distributed into the cells — `[1,2]·(x+1)`
  // evaluates to `[x + 1, 2(x + 1)]`, the same rule a scalar product follows.
  // The `.N()` route is always factored (`mulN`); internal `mul()` callers
  // keep the expansion.
  expand = true,
  // `true` when `xs` are already evaluated: see `mulFactoredArray()`.
  operandsAreValues = false
): Expression | undefined {
  const multiply = numericApproximation ? mulN : expand ? mul : mulFactored;
  // A CELL product on the exact routes is finished with `.evaluate()`, so the
  // `Multiply` handler's closed-inexact-constant rule applies to it exactly as
  // to a scalar product: `0.5 · [π, 1]` is `[1.57…, 0.5]`, not `[0.5π, 0.5]`.
  // The `.N()` route has already floated every cell.
  const multiplyCell = numericApproximation
    ? multiply
    : (...xs: ReadonlyArray<Expression>) => multiply(...xs).evaluate();
  // A flat list literal whose cells name assigned variables, times scalars:
  // each cell stays a product on the exact routes, as a scalar factor does.
  // Evaluating the cells would store the values that the variables hold now
  // (`2·[w, 2]` with `w := 4` would be `[8, 4]` and would not follow a later
  // `w := 5`). (CE-121)
  if (!numericApproximation && xs.length >= 2) {
    const lists = xs.filter((x) => isFunction(x, 'List'));
    const list = lists[0];
    if (
      lists.length === 1 &&
      isFunction(list) &&
      list.ops.every((c) => c.type.matches('number')) &&
      list.ops.some((c) => readsAssignedVariable(ce, c)) &&
      xs.every(
        (x) => x === list || (x.type.matches('number') && !x.isCollection)
      )
    ) {
      const scalar = multiply(...xs.filter((x) => x !== list));
      // Only the cells that read an assigned variable stay products; the
      // other cells are evaluated as the cell product below does, so
      // `0.5·[w, π]` still floats the `π` cell.
      return ce._fn(
        'List',
        list.ops.map((c) => {
          if (readsAssignedVariable(ce, c)) return multiply(scalar, c);
          const cv = c.evaluate();
          return multiplyCell(scalar, isAbsentSymbol(cv) ? ce.NaN : cv);
        })
      );
    }
  }
  // Separate evaluated operands into tensors and scalars, preserving order.
  const tensors: Expression[] = [];
  const scalars: Expression[] = [];
  // The evaluated operands, in order, and whether one is a collection that
  // is not a tensor value (a list of points, a `Range`).
  const values: Expression[] = [];
  let otherCollection = false;
  // Beside a matrix, a finite collection of numbers that is not a list (a
  // `Range`) is a vector: `M·Range(1, 2)` is the matrix-vector product, as
  // `M·[1, 2]` is, and not the product of each row.
  // An absent cell of a matrix of numbers is read as `NaN` here, before the
  // operands are classified: such a matrix is then a tensor value, and a
  // `Range` beside it is read as a vector (`[[2, Missing], [3, 4]]·Range(1, 2)`
  // is the matrix-vector product `[NaN, 11]`).
  // On the `Multiply` evaluate route the operands are already the values of
  // the operands of the product (`operandsAreValues`), and they are not
  // evaluated again. A list of symbolic cells is not data, so its
  // evaluation evaluates every cell again: a list of six unevaluated
  // integrals tried each antiderivative once more (ROADMAP CE-604).
  const evaluated = xs.map((op) =>
    absentCellsAsNaN(
      ce,
      numericApproximation ? op.N() : operandsAreValues ? op : op.evaluate()
    )
  );
  // The rank of each operand that is a lazy collection of vectors or
  // matrices, read once from its type (`lazyCollectionRank()`).
  const lazyRanks = evaluated.map((x) => lazyCollectionRank(x));
  // A matrix whose shape is known: a matrix value, or a lazy collection of
  // vectors or matrices.
  const knownMatrix = evaluated.some(
    (x, i) =>
      (isTensorValue(x) && (tensorShape(x)?.length ?? 0) >= 2) ||
      lazyRanks[i] !== undefined
  );
  // A lazy collection is read as the `List` of its elements, so the rules
  // below apply to it as to the same list literal:
  // - a collection of vectors or matrices (`Scan(L, Add, 0)` with
  //   `L: list<matrix<number>>`), always. A tensor of rank 3 beside a matrix
  //   then leaves the product unevaluated. Over the limit of
  //   `lazyCollectionAsList()` the product stays unevaluated.
  // - a collection whose elements have no known type (`Map(Reverse, L)`,
  //   typed `list<unknown>`), only beside a matrix whose shape is known:
  //   two such collections keep the product of each entry, as compiled code
  //   computes it (a list that may hold points is not read as a matrix
  //   there). Over the limit the collection is kept, and the caller
  //   broadcasts over it as before.
  const operands: Expression[] = [];
  for (const [i, x] of evaluated.entries()) {
    if (lazyRanks[i] !== undefined) {
      const list = lazyCollectionAsList(x);
      if (list === undefined) return ce._fn('Multiply', xs);
      // The list can hold absent cells, read as `NaN` as above.
      operands.push(absentCellsAsNaN(ce, list));
    } else if (knownMatrix && isLazyCollectionOfUnknownElements(x)) {
      const list = lazyCollectionAsList(x);
      operands.push(list === undefined ? x : absentCellsAsNaN(ce, list));
    } else operands.push(x);
  }
  // The matrices once the lazy collections are read: a `Range` beside one
  // is a vector.
  const hasMatrix = operands.some(
    (x) => isTensorValue(x) && (tensorShape(x)?.length ?? 0) >= 2
  );
  for (const [i, _op] of xs.entries()) {
    let x = operands[i];
    if (hasMatrix && isNumericVectorSource(x)) {
      // A collection over the limit of `numericCollectionAsList()` is not
      // read as a vector, and is not broadcast either (that would change the
      // operation): the product stays unevaluated.
      const list = numericCollectionAsList(x);
      if (list === undefined) return ce._fn('Multiply', xs);
      x = list;
    }
    values.push(x);
    if (isTensorValue(x)) {
      // A tensor-valued operand that does not pack (e.g. a list of
      // non-kernel-admissible cells such as tuples/points) means the tensor
      // kernels do not apply — decline so the caller falls through to the
      // generic broadcast / tuple path (behave as if not a tensor), after
      // the matrices beside it are multiplied (`otherCollection` below).
      if (packTensor(ce, x) === undefined) {
        otherCollection = true;
        continue;
      }
      tensors.push(x);
    } else {
      // A COLLECTION that is not a tensor value (a `Range`, or a `Filter`/
      // `Take`/`Reverse` view) must NOT fall into the scalar bucket: the fold
      // below ends at `scaleTensor`, which multiplies every CELL by the scalar
      // factor, so a collection factor turned each cell into a list —
      // `Range(1,3)·[1,2,3]` became `[[1,2,3],[2,4,6],[3,6,9]]` instead of the
      // element-wise `[1,4,9]`, at matched lengths, while `Add` on the same
      // operands was element-wise. Decline the kernel so the caller falls
      // through to `broadcastOverIndexedCollections`, which zips it.
      //
      // `addTensors` carries the same guard, for the same reason. It does NOT
      // get the effect for free from its `tensors.length < 2` decline — two
      // plain lists plus one collection view leaves exactly two tensors, and
      // that gap is what made `[1,2,3] + [4,5,6] + Range(1,3)` return a
      // nested `[[6,7,8],…]`. Its `< 2` decline is not mirrored here for a
      // different reason: it would also move plain scalar·vector products off
      // the tensor path and change their result typing. Tuples are excluded —
      // they scale component-wise by design (`mulTuples`).
      if (isBroadcastableCollection(x)) {
        otherCollection = true;
        continue;
      }
      // An absent scalar factor (`Missing` or `Undefined`) is read as `NaN`:
      // every cell of a packed tensor is a number, and the absence marker of
      // a numeric cell is `NaN` (`docs/ERROR-MODEL.md`, the codomain rule).
      // Kept as the symbol, the cell products disagreed: `Missing · 2` is
      // `NaN` through the `Multiply` absence gate, but `Missing · 1` folds
      // the identity factor away and answered the bare `Missing`, so
      // `Missing · [1, 2, 3]` was `[Missing, NaN, NaN]`.
      scalars.push(isAbsentSymbol(x) ? ce.NaN : x);
    }
  }

  // No tensors survived evaluation: let the caller fall through to the generic
  // (broadcast / tuple / Product) path.
  if (tensors.length === 0) return undefined;

  // A collection that is not a tensor value is broadcast by the caller. The
  // vectors and matrices beside it are first multiplied together, in order,
  // when one of them is a matrix: `m·m·P` with `P` a list of points is
  // `(m·m)·P`, as `m^2·P` is. Without this, the broadcast multiplied each
  // row of the first `m` by a row of the second one.
  if (otherCollection) {
    if (
      tensors.length < 2 ||
      !tensors.some((t) => t.shape.length === 2) ||
      tensors.some((t) => t.shape.length > 2)
    )
      return undefined;
    // The tensors are values (from `evaluated` above).
    const product = mulTensors(ce, tensors, numericApproximation, expand, true);
    if (product === undefined) return undefined;
    if (isFunction(product, 'Error')) return product;
    if (!isTensorValue(product)) return undefined;
    const first = values.indexOf(tensors[0]);
    const rest = values.filter((x) => !tensors.includes(x));
    rest.splice(first, 0, product);
    return multiply(...rest);
  }

  // Two tensors, one of rank 3 or more. When every tensor has rank 3 or more
  // and they have the same length, decline, so that the caller broadcasts
  // the product over the elements of the tensors: the product of two
  // tensors of rank 3 is then the matrix product of each pair of matrices
  // inside them, as `Power` gives the matrix power of each matrix inside
  // such a tensor, and as the same product of two symbols that hold these
  // tensors (`isMatrixProductOfValues()` leaves them to the broadcast).
  // Beside a vector or a matrix, a tensor of rank 3 has no product: the
  // broadcast would multiply each of its matrices by one row of the matrix.
  // The product stays unevaluated, as `MatrixMultiply` refuses a tensor of
  // rank 3.
  if (tensors.length >= 2 && tensors.some((t) => t.shape.length >= 3)) {
    if (tensors.every((t) => t.shape.length >= 3)) {
      // Tensors of rank 3 or more with different lengths: the broadcast of
      // the same symbols gives this error.
      const other = tensors.find((t) => t.shape[0] !== tensors[0].shape[0]);
      if (other === undefined) return undefined;
      return ce.error(
        'incompatible-dimensions',
        `${tensors[0].shape[0]} vs ${other.shape[0]}`
      );
    }
    return ce._fn('Multiply', xs);
  }

  // Combine the scalar factors (these are commutative). Through `multiply`,
  // not the `.mul()` method: the method always distributes, which would
  // open `(x+1)·2` into `2x + 2` before it ever reached a cell.
  const scalar: Expression | null =
    scalars.length === 0 ? null : multiply(...scalars);

  // Fold the tensors left to right, in order.
  let product: Expression = tensors[0];
  for (let i = 1; i < tensors.length; i++) {
    const nextTensor = tensors[i];

    // Two rank-1 vectors: element-wise (Hadamard) product, not the dot product
    // (Issue #29 — `Multiply` is element-wise for vectors, mirroring `Add`).
    // Any rank-2+ operand falls through to the matrix product below.
    if (
      isTensorValue(product) &&
      product.shape.length === 1 &&
      nextTensor.shape.length === 1
    ) {
      // Mismatched lengths: `Multiply` is LIFTED over these operands, so the
      // broadcast length ruling applies (docs/BROADCAST-MODEL.md) — the same
      // `incompatible-dimensions` `Add` reports on the same shape. Routed
      // through the shared check so the diagnostic can't drift.
      if (product.shape[0] !== nextTensor.shape[0])
        return (
          broadcastLengthMismatch(ce, [product, nextTensor]) ??
          ce._fn('Multiply', xs)
        );
      // Pack both vector operands once for the element-wise fold. A pack
      // failure falls back to an inert product.
      const productTensor = packTensor(ce, product);
      const nextTensorPacked = packTensor(ce, nextTensor);
      if (!productTensor || !nextTensorPacked) return ce._fn('Multiply', xs);
      // Each element is a float when its own element of the list is a float
      // (`elementFloatMask()`).
      const aFloats = elementFloatMask(product, productTensor);
      const bFloats = elementFloatMask(nextTensor, nextTensorPacked);
      const n = product.shape[0];
      const elements: Expression[] = [];
      for (let k = 1; k <= n; k++) {
        const a = tensorCellExpression(
          ce,
          productTensor.at(k) ?? ce.Zero,
          aFloats?.[k - 1] === true
        );
        const b = tensorCellExpression(
          ce,
          nextTensorPacked.at(k) ?? ce.Zero,
          bFloats?.[k - 1] === true
        );
        // Use the module-level `mul`/`mulN` helpers (not `.mul()`) so exact
        // elements stay exact under `evaluate()`; finished as a cell product
        // so an inexact element floats an exact-constant one (`[0.5,1]·[π,1]`
        // is `[1.57…, 1]`), as for a scalar-scaled tensor.
        elements.push(multiplyCell(a, b));
      }
      product = ce.function('List', elements);
      continue;
    }

    const next = ce
      .function('MatrixMultiply', [product, nextTensor])
      .evaluate();
    // Incompatible dimensions: the product of two matrices is the matrix
    // product, so it is the error `MatrixMultiply` answers for the same
    // operands (`incompatible-dimensions`), not an inert product. Another
    // error (a tensor of rank 3, which `MatrixMultiply` refuses) keeps the
    // inert product below.
    if (
      isFunction(next, 'Error') &&
      isString(next.op1) &&
      next.op1.string === 'incompatible-dimensions'
    )
      return next;
    // A partial fold that didn't reduce (e.g. a scalar dot-product result
    // followed by another matrix): stay inert.
    if (!next.isValid || next.operator === 'MatrixMultiply')
      return ce._fn('Multiply', xs);
    product = next;
  }

  // Apply the combined scalar factor.
  if (scalar !== null && !isLiteral(scalar, 1)) {
    product = isTensorValue(product)
      ? scaleTensor(ce, product, scalar, multiplyCell)
      : multiply(scalar, product);
  }
  return product;
}

/**
 * `scalar · vector` computed on doubles, when that is what the cell products
 * of {@link scaleTensor} answer, or `undefined` when it is not.
 *
 * The general route boxes every cell and builds a symbolic product for it,
 * about 3.5 µs a cell: `Sum(2·L)` over ten thousand numbers took 48 ms, most
 * of it here. The doubles are the same values under these conditions:
 *
 * - the vector is a list of machine numbers (`_machineFloats` is defined):
 *   every element is a machine number and none is an exact rational such as
 *   `1/2`, whose product must stay exact; the scalar is one too;
 * - a product with a float factor is a float, even when its value is an
 *   integer (`2 · 0.5` is the float `1`), and a product of two exact
 *   integers is exact; one flag of the answer records which it is for all
 *   the integer-valued products, so a mix of the two declines;
 * - every value is finite, so no `0 · ∞` or `NaN` is decided here;
 * - the products are exact integers (both factors integers, the product a
 *   safe integer), or the engine computes floats as doubles (machine
 *   precision) AND the scalar is stored as a double (`isStoredAsDouble`). At
 *   a higher precision a float product carries more digits than a double
 *   holds. A scalar made at a higher precision keeps its decimal digits when
 *   the engine is later set to machine precision, and the cell product
 *   multiplies those digits: `0.1 · [3]` is `[0.3]` for such a `0.1`, where
 *   the doubles give `0.30000000000000004`. The ELEMENTS need no such test:
 *   the cell products read them from the packed tensor, which holds doubles.
 *
 * The answer is a list that holds its numbers unboxed (`ce._list`).
 */
function scaleMachineVector(
  ce: ComputeEngine,
  vector: Expression,
  scalar: Expression
): Expression | undefined {
  if (!isFunction(vector, 'List')) return undefined;
  // `true` when the integer-valued elements are floats (`[0.5, 2.0]`)
  const vectorFloats = vector._machineFloats;
  if (vectorFloats === undefined) return undefined;
  const k = machineNumberOf(scalar);
  if (k === undefined || !Number.isFinite(k) || isExactNonInteger(scalar, k))
    return undefined;
  const values = vector.array;
  if (values === undefined) return undefined;
  const floatsAreDoubles = !bignumPreferred(ce) && isStoredAsDouble(scalar);
  const exactIntegerScalar =
    Number.isInteger(k) && isNumber(scalar) && scalar.isExact;
  // A product with a float factor is a float, even when its value is an
  // integer (`2 · 0.5` is the float `1`). The list records it for all its
  // integer-valued elements, so a result that would mix exact integers and
  // integer-valued floats declines.
  let exactInteger = false;
  let floatInteger = false;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) return undefined;
    const p = k * v;
    // An integer past the safe range is declined whatever the factors are:
    // with two integer factors the interpreter's product is an exact big
    // integer, and `ce.number()` of the double is a float (only a
    // safe-integer double is boxed as an exact integer).
    if (Number.isInteger(p) && !Number.isSafeInteger(p)) return undefined;
    const exactCell =
      exactIntegerScalar && Number.isInteger(v) && !vectorFloats;
    if (!exactCell && !floatsAreDoubles) return undefined;
    if (Number.isInteger(p)) {
      if (exactCell) exactInteger = true;
      else floatInteger = true;
      if (exactInteger && floatInteger) return undefined;
    }
    // `-0` is stored as `0`, as the `array` of a list stores it.
    out[i] = p === 0 ? 0 : p;
  }
  return ce._list(out, floatInteger);
}

/**
 * Scale every element of a vector or matrix `tensor` by the scalar `scalar`,
 * multiplying each cell with `multiply` — the route's own product helper
 * (`mul`, `mulFactored` or `mulN`), so the cells follow the same
 * factored/expanded and exact/float rule as a scalar product on that route.
 */
function scaleTensor(
  ce: ComputeEngine,
  tensor: Expression,
  scalar: Expression,
  multiply: (...xs: ReadonlyArray<Expression>) => Expression
): Expression {
  const shape = tensor.shape;

  // A vector of machine numbers is scaled on its doubles, which needs no
  // packed tensor: packing boxes every element of a list that holds its
  // numbers unboxed.
  if (shape.length === 1) {
    const scaled = scaleMachineVector(ce, tensor, scalar);
    if (scaled !== undefined) return scaled;
  }

  // Pack once for the whole scaling. A pack failure leaves the scaling inert.
  const packed = packTensor(ce, tensor);
  if (!packed) return ce._fn('Multiply', [scalar, tensor]);
  // Each element is a float when its own element of the list is a float
  // (`elementFloatMask()`).
  const floats = elementFloatMask(tensor, packed);

  // Vector (rank 1)
  if (shape.length === 1) {
    const result: Expression[] = [];
    for (let i = 0; i < shape[0]; i++) {
      const val = tensorCellExpression(
        ce,
        packed.at(i + 1) ?? ce.Zero,
        floats?.[i] === true
      );
      result.push(multiply(scalar, val));
    }
    return ce.function('List', result);
  }

  // Matrix (rank 2)
  if (shape.length === 2) {
    const [m, n] = shape;
    const rows: Expression[] = [];
    for (let i = 0; i < m; i++) {
      const row: Expression[] = [];
      for (let j = 0; j < n; j++) {
        const val = tensorCellExpression(
          ce,
          packed.at(i + 1, j + 1) ?? ce.Zero,
          floats?.[i * n + j] === true
        );
        row.push(multiply(scalar, val));
      }
      rows.push(ce.function('List', row));
    }
    return ce.function('List', rows);
  }

  // A tensor of rank 3 or more: scale each of its elements, a tensor of
  // rank one less, so that every cell is scaled, as for a matrix.
  if (isFunction(tensor, 'List'))
    return ce.function(
      'List',
      tensor.ops.map((x) =>
        isTensorValue(x)
          ? scaleTensor(ce, x, scalar, multiply)
          : multiply(scalar, x)
      )
    );
  return ce._fn('Multiply', [scalar, tensor]);
}
