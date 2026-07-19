import { isSubtype } from '../../common/type/subtype.js';

import type {
  Expression,
  TensorInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isTensor } from './boxed-tensor.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  numericValue,
  isContinuationOperand,
} from './type-guards.js';
import {
  isNumericTuple,
  isTuple,
  hasAccessibleComponents,
  isFiniteIndexedCollection,
  isBroadcastableCollection,
  isUnknownLengthBroadcast,
  lazyBroadcastMap,
  broadcastOverIndexedCollections,
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
  rationalGcd,
  reducedRational,
  isZero,
} from '../numerics/rationals.js';
import { SMALL_INTEGER } from '../numerics/numeric.js';
import { bigint } from '../numerics/bigint.js';

import { sortProductOperands } from './order.js';
import { asRadical } from './arithmetic-power.js';
import { flatten } from './flatten.js';
import { asRational, asSmallInteger } from './numerics.js';
import { negateProduct } from './negate.js';
import { add } from './arithmetic-add.js';

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
 * Structural check: is `op` the number literal `n`?
 *
 * Canonicalization folds must NOT use plain `.isSame(n)` on an operand that
 * can be a symbol: `.isSame()` follows symbol value bindings, so a mutable
 * symbol whose *current* value happens to be `n` would be folded into the
 * canonical structure (`Divide(2, x)` → `2` while `x` holds `1`, →
 * `ComplexInfinity` while it holds `0`). The structure of a canonical
 * expression must never depend on a symbol's transient value — the fold is
 * only sound when the operand is the literal itself.
 */
function isLiteral(op: Expression, n: number): boolean {
  return isNumber(op) && op.isSame(n);
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
export class Product {
  engine: ComputeEngine;

  // Running literal products (if canonical)
  coefficient: NumericValue;

  // Other terms of the product, `term` is the key
  terms: {
    term: Expression;
    exponent: Rational;
  }[] = [];

  // If `false`, the running products are not calculated
  private _isCanonical = true;

  static from(expr: Expression): Product {
    return new Product(expr.engine, [expr]);
  }

  constructor(
    ce: ComputeEngine,
    xs?: ReadonlyArray<Expression>,
    readonly options?: { canonical?: boolean }
  ) {
    options = options ? { ...options } : {};
    if (!('canonical' in options)) options.canonical = true;
    this._isCanonical = options.canonical!;

    this.engine = ce;
    this.coefficient = ce._numericValue(1);

    if (xs) for (const x of xs) this.mul(x);
  }

  /**
   * Add a term to the product.
   *
   * If `this._isCanonical` a running product of exact terms is kept.
   * Otherwise, terms and their exponent are tallied.
   */
  mul(term: Expression, exp?: Rational) {
    console.assert(term.isCanonical || term.isStructural);
    if (this.coefficient.isNaN) return;

    if (term.isNaN) {
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
        for (const x of this.terms) {
          if (x.term.isSame(term)) {
            x.exponent = rationalAdd(x.exponent, e);
            return;
          }
        }
        this.terms.push({ term, exponent: e });
        return;
      }
      for (const t of term.ops) this.mul(t, exp);
      return;
    }

    if (isFunction(term, 'Negate')) {
      const e = exp ? reducedRational(exp) : ([1, 1] as Rational);
      if (!isIntegerRational(e)) {
        // (−u)^(p/q): the −1 cannot be split off — (−1)^(p/q) is a complex
        // phase, not ±1 (e.g. (−u)^(1/4) ≠ −u^(1/4)). Tally opaquely.
        for (const x of this.terms) {
          if (x.term.isSame(term)) {
            x.exponent = rationalAdd(x.exponent, e);
            return;
          }
        }
        this.terms.push({ term, exponent: e });
        return;
      }
      this.mul(term.op1, exp);
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
        if (term.isSame(1)) return;

        if (term.isSame(0)) {
          // infinity * 0 -> NaN (indeterminate form)
          if (
            this.coefficient.isPositiveInfinity ||
            this.coefficient.isNegativeInfinity
          ) {
            this.coefficient = this.engine._numericValue(NaN);
            return;
          }
          this.coefficient = this.engine._numericValue(isZero(exp) ? NaN : 0);
          return;
        }

        if (term.isSame(-1)) {
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
            this.coefficient = this.engine._numericValue(NaN);
            return;
          }
          if (isOne(exp)) {
            // Multiply the signs: coef * infinity
            // e.g., -2 * +∞ = -∞, 2 * -∞ = -∞, -2 * -∞ = +∞
            const coefSign = this.coefficient.sgn() ?? 1;
            const termSign = term.isNegative ? -1 : 1;
            const resultSign = coefSign * termSign;
            this.coefficient = this.engine._numericValue(
              resultSign < 0 ? -Infinity : Infinity
            );
          } else this.terms.push({ term, exponent: exp });
          return;
        }

        if (isOne(exp)) {
          this.coefficient = this.coefficient.mul(num);
        } else if (exactPowExceedsBudget(this.engine._numericValue(num), exp)) {
          // Materializing this exact power would exceed the digit budget:
          // keep it symbolic (an inert Power term) rather than folding it
          // into the coefficient — mirrors the guard in arithmetic-power.ts,
          // and avoids a `Maximum BigInt size exceeded` throw.
          this.terms.push({ term, exponent: exp });
        } else
          this.coefficient = this.coefficient.mul(
            this.engine._numericValue(num).pow(this.engine._numericValue(exp))
          );
        return;
      }

      const radical = asRadical(term);
      if (radical !== null) {
        this.coefficient = this.coefficient.mul(
          this.engine
            ._numericValue({
              radical: (radical[0] as number) * (radical[1] as number),
              rational: [1, Number(radical[1])],
            })
            .pow(this.engine._numericValue(exp))
        );
        return;
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
          if (!evenRootOfNegative) {
            this.coefficient = this.coefficient.mul(
              exp && !isOne(exp)
                ? coef.pow(this.engine._numericValue(exp))
                : coef
            );
            term = rest;
          }
        }
      }
    }

    // Note: term should be positive, so no need to handle the -1 case
    // (isLiteral, not isSame: a symbol whose current value is 1/0 must not
    // fold structurally; the value-following `isSame(0) === false` NEGATIVE
    // guard below stays — it conservatively blocks the x^0 → 1 fold when the
    // base is known to be 0.)
    if (isLiteral(term, 1) && (!exp || isOne(exp))) return;
    if (term.isSame(0) === false && exp && isZero(exp)) return;
    if (isLiteral(term, 0)) {
      if (exp && isZero(exp)) this.coefficient = this.engine._numericValue(NaN);
      else this.coefficient = this.engine._numericValue(0);
      return;
    }

    const exponent: Rational = exp ?? [1, 1];

    // If this is a power expression, extract the exponent
    if (isFunction(term, 'Power')) {
      // Term is `Power(op1, op2)`
      const r = asRational(term.op2);
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

        if (foldIsSound && (!baseIsNumeric || expIsInteger)) {
          this.mul(term.op1, rationalMul(exponent, r));
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
      if (!baseIsNumeric) {
        this.mul(term.op1, rationalMul(exponent, [1, 2]));
        return;
      }
      // Otherwise, keep the Sqrt expression as a single term
    }

    if (isFunction(term, 'Root')) {
      // Term is `Root(op1, op2)`
      const r = asRational(term.op2);
      if (r) {
        // Don't extract non-integer exponents for numeric bases
        // This keeps ∛2 symbolic instead of evaluating to 1.259...
        const baseIsNumeric = isNumber(term.op1);
        if (!baseIsNumeric) {
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
      const e = reducedRational(exponent);
      if (isIntegerRational(e) || term.op2.isNonNegative === true) {
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

    // Look for the base, and add the exponent if already in the list of terms
    let found = false;
    for (const x of this.terms) {
      if (x.term.isSame(tallyTerm)) {
        x.exponent = rationalAdd(x.exponent, tallyExp);
        found = true;
        break;
      }
    }
    if (!found) this.terms.push({ term: tallyTerm, exponent: tallyExp });
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

    const xs: { exponent: Rational; terms: Expression[] }[] = [];
    if (!this.coefficient.isOne) {
      if (mode === 'rational' && this.coefficient.type === 'finite_rational') {
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
      const mergeable =
        isIntegerRational(exponent) || t.term.isNonNegative === true;
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
        xs.push({ exponent, terms: [t.term] });
      }
    }
    return xs;
  }

  asExpression(
    options: { numericApproximation: boolean } = { numericApproximation: false }
  ): Expression {
    const ce = this.engine;

    const coef = this.coefficient;
    if (coef.isNaN) return ce.NaN;
    if (coef.isZero) return ce.Zero;

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
      const rest = termsAsExpression(ce, grouped);
      if (isLiteral(rest, 0)) return ce.NaN;
      if (rest.isPositive === true) return infinity;
      if (rest.isNegative === true)
        return coef.isPositiveInfinity
          ? ce.NegativeInfinity
          : ce.PositiveInfinity;
      return ce._fn('Multiply', [infinity, rest]);
    }

    // If the coef is -1, temporarily set it to 1
    const isNegativeOne = coef.isNegativeOne;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const groupedTerms = this.groupedByDegrees({
      mode: options.numericApproximation ? 'numeric' : 'expression',
    });
    if (groupedTerms === null) return ce.NaN;

    // If the coef is -1, negate the expression and reset the coef
    if (isNegativeOne) {
      const result = termsAsExpression(ce, groupedTerms).neg();
      this.coefficient = ce._numericValue(-1);
      return result;
    }

    return termsAsExpression(ce, groupedTerms);
  }

  /** The product, expressed as a numerator and denominator */
  asNumeratorDenominator(): [Expression, Expression] {
    const ce = this.engine;
    const coef = this.coefficient;
    if (coef.isZero) return [ce.Zero, ce.One];
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
      const rest = termsAsExpression(ce, grouped);
      if (isLiteral(rest, 0)) return [ce.NaN, ce.NaN];
      if (rest.isPositive === true) return [infinity, ce.One];
      if (rest.isNegative === true)
        return [
          coef.isPositiveInfinity ? ce.NegativeInfinity : ce.PositiveInfinity,
          ce.One,
        ];
      return [ce._fn('Multiply', [infinity, rest]), ce.One];
    }

    // If the coef is -1, temporarily set it to 1
    const isNegativeOne = coef.isNegativeOne;
    if (isNegativeOne) this.coefficient = ce._numericValue(1);

    const xs = this.groupedByDegrees({ mode: 'rational' });

    this.coefficient = coef;

    if (xs === null) return [ce.NaN, ce.NaN];

    const xsNumerator = xs.filter((x) => x.exponent[0] >= 0);
    const xsDenominator = xs
      .filter((x) => x.exponent[0] < 0)
      .map((x) => ({
        exponent: neg(x.exponent),
        terms: x.terms,
      }));

    const num = termsAsExpression(ce, xsNumerator);

    return [
      isNegativeOne ? num.neg() : num,
      termsAsExpression(ce, xsDenominator),
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

function termsAsExpression(
  ce: ComputeEngine,
  terms: { exponent: Rational; terms: ReadonlyArray<Expression> }[]
): Expression {
  let result = terms.map(({ terms, exponent }) => {
    const t = flatten(terms, 'Multiply');
    const base =
      t.length <= 1 ? t[0] : ce._fn('Multiply', sortProductOperands(t));
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

  return ce._fn('Multiply', sortProductOperands(result));
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

  if (op1.isNaN || op2.isNaN) return ce.NaN;

  // Numeric tuples (points/vectors in ℝⁿ): `tuple / scalar` scales
  // component-wise; `scalar / tuple` and `tuple / tuple` are undefined.
  {
    const op1Tuple = isNumericTuple(op1);
    const op2Tuple = isNumericTuple(op2);
    if (op1Tuple || op2Tuple) {
      // A tuple divisor has no defined reciprocal (no implicit dot/cross).
      if (op2Tuple) return ce.error(['incompatible-type', 'number', 'tuple']);
      // Strip trivial divisors: the generic a/1 rule below is unreachable
      // from this branch, and an inert Divide(tuple-typed, 1) sends the
      // pretty-JSON serializer into infinite recursion (Multiply →
      // asRationalExpression → Divide(same Multiply, 1) → …).
      if (isLiteral(op2, 1)) return op1;
      if (isLiteral(op2, -1)) return op1.neg();
      // `tuple / scalar`: scale each component when the divisor is provably a
      // scalar number and the components are accessible; else stay symbolic.
      if (
        hasAccessibleComponents(op1) &&
        isFunction(op1) &&
        isSubtype(op2.type.type, 'number')
      )
        return ce.tuple(...op1.ops.map((c) => canonicalDivide(c, op2)));
      return ce._fn('Divide', [op1, op2]);
    }
  }

  // A fully-determined expression (no free variables) that is not already a
  // literal. Such expressions may evaluate to 0 or ∞ (e.g. 1-1, tan(π/2))
  // and we want to avoid collapsing divisions like 0/(1-1) or
  // tan(π/2)/tan(π/2) during canonicalization. We use `unknowns` instead of
  // `symbols` because `symbols` includes mathematical constants like Pi and E,
  // which would let expressions like tan(π/2) slip through the guard.
  const op2IsConstantExpression = op2.unknowns.length === 0 && !isNumber(op2);

  // 0/0 = NaN, a/0 = ~∞ (a≠0)
  // Note: literal checks only — no value following (see isLiteral), and no
  // .N() either, because .N() can be expensive (e.g., Monte Carlo
  // integration) and canonicalization must be fast. Expressions like (1-1)/0
  // won't be detected as 0/0 here, but will be handled during simplification.
  if (isLiteral(op2, 0)) return isLiteral(op1, 0) ? ce.NaN : ce.ComplexInfinity;

  // 0/a = 0 (a≠0, a is finite)
  if (isLiteral(op1, 0) && op2.isFinite !== false) {
    // Be conservative with constant (no-unknown) denominators that aren't
    // already a literal number. Avoid 0/(1-1) -> 0 during canonicalization.
    // Use structural mode so the expression is bound and can evaluate later.
    if (op2IsConstantExpression)
      return ce.function('Divide', [op1, op2], {
        form: 'structural',
      });
    return ce.Zero;
  }

  // a/∞ = 0, ∞/∞ = NaN (check before a/a = 1 rule)
  if (op2.isInfinity) return op1.isInfinity ? ce.NaN : ce.Zero;

  // ∞/a = ±∞ for a finite and definitely nonzero (with a known sign). Mirrors
  // the a/∞ = 0 rule above and the Multiply path, which already reduces
  // ∞·√π → +∞. Without this, bound substitution into antiderivatives such as
  // √(π/2)·FresnelC(√(2/π)·x) collapsed to NaN at x = ∞: the FresnelC argument
  // is Divide(√2·∞, √π), and √π — a finite, positive constant whose isFinite
  // is undefined (finiteness is not propagated through Sqrt) — sent the
  // division to NaN. Requiring a definite sign on op2 keeps could-be-zero
  // constants (e.g. sin(π)) out; the sign of op1 (incl. complex ∞) is carried
  // by op1 / op1.neg().
  if (
    op1.isInfinity &&
    op2.isFinite !== false &&
    (op2.isPositive === true || op2.isNegative === true)
  )
    return op2.isPositive === true ? op1 : op1.neg();

  // a/a = 1 (if a ≠ 0 and a is finite)
  if (op2.isSame(0) === false && op2.isFinite !== false) {
    if (
      isSymbol(op1) &&
      isSymbol(op2) &&
      op1.symbol === op2.symbol &&
      op1.isConstant
    )
      return ce.One;

    // (x+1)/(x+1) = 1 (if x+1 ≠ 0)
    if (op1.isSame(op2)) {
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
      return ce.number(ce._numericValue({ radical: a * b, rational: [1, b] }));
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
      (typeof v1 !== 'number' && v1.im !== 0) ||
      (typeof v2 !== 'number' && v2.im !== 0)
    ) {
      // If we have an imaginary part, keep the division
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
      if (v2 === 0) return v1 === 0 ? ce.NaN : ce.ComplexInfinity;
      return ce.number([v1, v2]);
    }

    if (typeof v1 === 'number' && Number.isInteger(v1)) {
      if (v1 === 0) return ce.Zero;
      if (typeof v2 !== 'number' && isSubtype(v2.type, 'integer')) {
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
  const coefExact = c1.isExact && c2.isExact;

  if (c.isOne) return isLiteral(t2, 1) ? t1 : ce._fn('Divide', [t1, t2]);

  if (c.isNegativeOne)
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

export function div(num: Expression, denom: number | Expression): Expression {
  const ce = num.engine;

  num = num.canonical;
  if (typeof denom !== 'number') denom = denom.canonical;

  // If the numerator is NaN, return NaN
  if (num.isNaN) return ce.NaN;

  if (typeof denom === 'number') {
    if (isNaN(denom)) return ce.NaN;
    if (isLiteral(num, 0)) {
      // 0/0 = NaN, 0/±∞ = NaN
      if (denom === 0 || !isFinite(denom)) return ce.NaN;
      return num; // 0
    }
    // a/1 = a
    if (denom === 1) return num;
    // a/(-1) = -a
    if (denom === -1) return num.neg();
    // a/0 = ~∞ (a≠0) - ComplexInfinity as "better NaN"
    if (denom === 0) return ce.ComplexInfinity;

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
    if (denom.isNaN) return ce.NaN;
    if (isLiteral(num, 0)) {
      if (isLiteral(denom, 0) || denom.isFinite === false) return ce.NaN;
      return ce.Zero;
    }

    // a/1 = a
    if (isLiteral(denom, 1)) return num;

    // a/(-1) = -a
    if (isLiteral(denom, -1)) return num.neg();

    // a/0 = ~∞ (a≠0) — ComplexInfinity, consistent with the JS-number path
    // above (the boxed-zero case previously returned NaN).
    if (isLiteral(denom, 0)) return ce.ComplexInfinity;

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
        if (numV.isExact && denomV.isExact) {
          return ce.number(numV.asExact!.div(denomV.asExact!));
        }
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

  // Two or more numeric tuples (points/vectors) have no implicit product
  // (dot/cross); reject `tuple · tuple` at canonicalization when provable.
  // `scalar · tuple` is allowed and scales component-wise at evaluation.
  if (ops.filter((x) => isNumericTuple(x)).length >= 2)
    return ce.error(['incompatible-type', 'number', 'tuple']);

  //
  // Remove negations and negative numbers
  //
  let sign = 1;
  let xs: Expression[] = [];
  for (const op of ops) {
    const [o, s] = unnegate(op);
    sign *= s;
    xs.push(o);
  }

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
        // A machine/big Gaussian integer (e.g. the literal `3i`) is exactly
        // representable: fold it as an exact value.
        if (
          nv.im !== 0 &&
          Number.isSafeInteger(nv.re) &&
          Number.isSafeInteger(nv.im)
        ) {
          exactNumerics.push(
            ce._numericValue({
              rational: [nv.re, 1],
              imRational: [nv.im, 1],
            })
          );
          continue;
        }
      }
      nonNumeric.push(x);
    }
    if (exactNumerics.length >= 2) {
      let product = exactNumerics[0];
      for (let i = 1; i < exactNumerics.length; i++) {
        const next = exactNumerics[i];
        const candidate = product.mul(next);
        // Exactness guard for the complex extension: when a product with a
        // complex operand leaves the representable set (e.g. √2·(1+i)), do
        // NOT fold it into an inexact float at canonicalization — keep the
        // operand as a separate term. (Real-only products keep the historical
        // behavior: a radical-magnitude overflow still folds to a float.)
        if (
          !candidate.isExact &&
          !candidate.isNaN &&
          (product.im !== 0 || next.im !== 0)
        ) {
          nonNumeric.push(ce.number(next));
          continue;
        }
        product = candidate;
      }
      if (product.isZero) {
        // 0 * ±∞ = NaN, 0 * NaN = NaN
        if (nonNumeric.some((x) => x.isInfinity || x.isNaN)) return ce.NaN;
        return ce.Zero;
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

    if (isNumber(x)) {
      // Do we have a Sqrt expression?
      if (
        isFunction(next, 'Sqrt') &&
        isNumber(next.op1) &&
        next.op1.type.matches('finite_integer')
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

        // Is it preceded by a rational?
        if (x.type.matches('finite_rational')) {
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
          const r = asRational(x);
          if (r) {
            ys.push(
              ce.number(
                ce._numericValue({ rational: r, radical: nextNv.radical })
              )
            );
            i++;
            continue;
          }
        } else if (nextNv.re === 0 && nextNv.im === 1) {
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
          } else if (nv.im === 0) {
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
              ys.push(ce.number(ce.complex(0, nv.re)));
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
    if (ys.length === 1) return ys[0].neg();
    return negateProduct(ce, ys);
  }

  if (ys.length === 0) return ce.number(1);
  if (ys.length === 1) return ys[0];

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
  rhs: Readonly<Expression>
): Expression {
  if (isFunction(lhs, 'Negate') && isFunction(rhs) && rhs.operator === 'Negate')
    return expandProduct(lhs.op1, rhs.op1);

  const ce = lhs.engine;

  if (isFunction(lhs, 'Negate')) return expandProduct(lhs.op1, rhs).neg();
  if (isFunction(rhs, 'Negate')) return expandProduct(lhs, rhs.op1).neg();

  if (
    isFunction(lhs, 'Divide') &&
    isFunction(rhs) &&
    rhs.operator === 'Divide'
  ) {
    const denom = lhs.op2.mul(rhs.op2);
    return expandProduct(lhs.op1, rhs.op1).div(denom);
  }

  if (isFunction(lhs, 'Divide'))
    return expandProduct(lhs.op1, rhs).div(lhs.op2);
  if (isFunction(rhs, 'Divide'))
    return expandProduct(lhs, rhs.op1).div(rhs.op2);

  if (isFunction(lhs, 'Add')) {
    const terms: Expression[] = lhs.ops.map((x) => expandProduct(x, rhs));
    return add(...terms);
  }
  if (isFunction(rhs, 'Add')) {
    const terms: Expression[] = rhs.ops.map((x) => expandProduct(lhs, x));
    return add(...terms);
  }

  return new Product(ce, [lhs, rhs]).asExpression();
}

export function expandProducts(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | null {
  if (ops.length === 0) return null;
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) return expandProduct(ops[0], ops[1]);

  const rhs = expandProducts(ce, ops.slice(1));
  return rhs === null ? null : expandProduct(ops[0], rhs);
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
 */
export function mul(...xs: ReadonlyArray<Expression>): Expression {
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

  // An unknown/infinite-length indexed collection (a `Cycle`, a `Filter`, a
  // symbolic-length `Range`) can't be materialized or eagerly zipped without
  // truncating — return the lazy `Map` form. Checked BEFORE the tensor and
  // finite-broadcast branches so a mixed finite+infinite product (where a
  // finite `List` factor is a rank-1 tensor) maps ALL collections as `Map`
  // sources rather than routing to `mulTensors`. A finite tensor never triggers
  // this (its `count` is known-finite). Tuples stay atomic
  // (`isBroadcastableCollection` excludes them).
  if (xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      ce,
      'Multiply',
      xs,
      isBroadcastableCollection,
      false
    );

  // Tensor (matrix/vector) operands follow matrix-product / scalar-scaling
  // semantics rather than the scalar Product machinery.
  if (xs.some((x) => isTensor(x))) return mulTensors(ce, xs);

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
  if (xs.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))) {
    const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, false, true);
    if (r) return r;
  }

  // Tuples (points/vectors): scalar · tuple scales component-wise, including a
  // tuple with a collection component (`2·(1, 0.3n)` → `(2, 0.6n)`); the
  // explicit `PointList` operator — not plain `Tuple` — carries the Desmos
  // list-of-points reading.
  if (xs.some((x) => isTuple(x))) return mulTuples(ce, xs, false);

  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    if (isFunction(exp)) xs = exp.ops;
  }

  return new Product(ce, xs).asRationalExpression();
}

export function mulN(...xs: ReadonlyArray<Expression>): Expression {
  console.assert(xs.length > 0);
  const ce = xs[0].engine;
  // Ellipsis fold barrier: stay inert for a notational product.
  if (xs.some((x) => isContinuationOperand(x)))
    return ce._fn(
      'Multiply',
      xs.map((x) => x.canonical)
    );
  // Unknown/infinite-length indexed collection → lazy `Map` (see `mul`, which
  // documents why this precedes the tensor branch); the `N`-wrap threads
  // through so elements float on access.
  if (xs.some(isUnknownLengthBroadcast))
    return lazyBroadcastMap(
      ce,
      'Multiply',
      xs,
      isBroadcastableCollection,
      true
    );
  if (xs.some((x) => isTensor(x))) return mulTensors(ce, xs, true);
  // Broadcast over a non-tensor finite indexed collection (see `mul`).
  if (xs.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))) {
    const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, true, true);
    if (r) return r;
  }
  // An INERT result (still a `Multiply`) falls through to the post-evaluation
  // re-dispatch, mirroring `addN` (Tycho item 52).
  let tupleInert = false;
  if (xs.some((x) => isTuple(x))) {
    const r = mulTuples(ce, xs, true);
    if (r.operator !== 'Multiply') return r;
    tupleInert = true;
  }
  xs = xs.map((x) => x.N());
  // Post-evaluation re-dispatch (Tycho item 52): an operand may only have
  // BECOME a collection through the numeric evaluation above (`Mod(L,11)`
  // over a list `L` → a lazy `Map`) — the raw-operand dispatches missed it
  // and the product was left inert (`0.2·collection` unreduced). Mirrors the
  // pre-evaluation branches (see the matching comment in `addN`); linear, no
  // re-entry, and gated so the hot all-numeric path pays a single cheap
  // `isFunction` sweep.
  if (tupleInert || xs.some((x) => isFunction(x))) {
    if (xs.some(isUnknownLengthBroadcast))
      return lazyBroadcastMap(
        ce,
        'Multiply',
        xs,
        isBroadcastableCollection,
        true
      );
    if (xs.some((x) => isTensor(x))) return mulTensors(ce, xs, true);
    if (xs.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))) {
      const r = broadcastOverIndexedCollections(ce, 'Multiply', xs, true, true);
      if (r) return r;
    }
    if (xs.some((x) => isTuple(x))) return mulTuples(ce, xs, true);
  }
  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    if (isFunction(exp)) xs = exp.ops;
  }

  return new Product(ce, xs).asExpression({ numericApproximation: true });
}

/**
 * Multiply operands when at least one is a numeric tuple (point/vector in ℝⁿ).
 *
 * - **scalar · tuple**: scale every component by the product of the scalar
 *   factors (`2 · (1,2)` → `(2,4)`), staying exact through the scalar `mul`.
 * - **two or more tuples**: no implicit product (dot/cross) — return an
 *   `incompatible-type` error (T2 also rejects this at canonicalization).
 * - A symbolic tuple (no accessible components) stays a symbolic `Multiply`.
 */
function mulTuples(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  numericApproximation: boolean
): Expression {
  // Any tuple-typed operand counts — including a tuple with a collection
  // component (`(1, 0.3n)` with `n` a list), whose components scale via the
  // ordinary scalar·list broadcast below.
  const tuples = xs.filter((x) => isTuple(x));
  const scalars = xs.filter((x) => !isTuple(x));

  if (tuples.length >= 2)
    return ce.error(['incompatible-type', 'number', 'tuple']);

  const tuple = tuples[0];

  // No accessible components (symbolic tuple, e.g. `2·z`): stay symbolic.
  if (!hasAccessibleComponents(tuple) || !isFunction(tuple))
    return ce._fn('Multiply', sortProductOperands([...xs]));

  // Combine the scalar factors (commutative). `scalars` is non-empty because
  // `mul`/`mulN` short-circuit single-operand calls before reaching here.
  const scalar = numericApproximation ? mulN(...scalars) : mul(...scalars);

  // Evaluate each component first (mirrors `mulTensors`): a raw component like
  // `0.3n` with `n` a list must materialize before the scalar product, or the
  // recursive `mul`/`mulN` sees a non-iterable operand and stays inert.
  const components = tuple.ops.map((c) => {
    const cv = numericApproximation ? c.N() : c.evaluate();
    return numericApproximation ? mulN(scalar, cv) : mul(scalar, cv);
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
 * Returns an inert `Multiply` when the tensors have incompatible dimensions (so
 * the input is preserved rather than silently dropped).
 */
function mulTensors(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>,
  numericApproximation = false
): Expression {
  // Separate evaluated operands into tensors and scalars, preserving order.
  const tensors: (Expression & TensorInterface)[] = [];
  const scalars: Expression[] = [];
  for (const op of xs) {
    const x = numericApproximation ? op.N() : op.evaluate();
    if (isTensor(x)) tensors.push(x);
    else scalars.push(x);
  }

  // No tensors survived evaluation: fall back to an ordinary scalar product.
  if (tensors.length === 0)
    return numericApproximation ? mulN(...scalars) : mul(...scalars);

  // Combine the scalar factors (these are commutative).
  let scalar: Expression | null = null;
  for (const s of scalars) scalar = scalar === null ? s : scalar.mul(s);

  // Fold the tensors left to right, in order.
  let product: Expression = tensors[0];
  for (let i = 1; i < tensors.length; i++) {
    const nextTensor = tensors[i];

    // Two rank-1 vectors: element-wise (Hadamard) product, not the dot product
    // (Issue #29 — `Multiply` is element-wise for vectors, mirroring `Add`).
    // Any rank-2+ operand falls through to the matrix product below.
    if (
      isTensor(product) &&
      product.shape.length === 1 &&
      nextTensor.shape.length === 1
    ) {
      // Mismatched lengths: stay inert (mirrors the incompatible-dimension
      // behavior of the matrix-product fold below).
      if (product.shape[0] !== nextTensor.shape[0])
        return ce._fn('Multiply', xs);
      const n = product.shape[0];
      const elements: Expression[] = [];
      for (let k = 1; k <= n; k++) {
        const a = ce.expr(product.tensor.at(k) ?? ce.Zero);
        const b = ce.expr(nextTensor.tensor.at(k) ?? ce.Zero);
        // Use the module-level `mul`/`mulN` helpers (not `.mul()`) so exact
        // elements stay exact under `evaluate()`.
        elements.push(numericApproximation ? mulN(a, b) : mul(a, b));
      }
      product = ce.function('List', elements);
      continue;
    }

    const next = ce
      .function('MatrixMultiply', [product, nextTensor])
      .evaluate();
    // Incompatible dimensions, or a partial fold that didn't reduce (e.g. a
    // scalar dot-product result followed by another matrix): stay inert.
    if (!next.isValid || next.operator === 'MatrixMultiply')
      return ce._fn('Multiply', xs);
    product = next;
  }

  // Apply the combined scalar factor.
  if (scalar !== null && !isLiteral(scalar, 1)) {
    product = isTensor(product)
      ? scaleTensor(ce, product, scalar)
      : scalar.mul(product);
  }
  return product;
}

/** Scale every element of a vector or matrix `tensor` by the scalar `scalar`. */
function scaleTensor(
  ce: ComputeEngine,
  tensor: Expression & TensorInterface,
  scalar: Expression
): Expression {
  const shape = tensor.shape;

  // Vector (rank 1)
  if (shape.length === 1) {
    const result: Expression[] = [];
    for (let i = 0; i < shape[0]; i++) {
      const val = ce.expr(tensor.tensor.at(i + 1) ?? ce.Zero);
      result.push(scalar.mul(val).evaluate());
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
        const val = ce.expr(tensor.tensor.at(i + 1, j + 1) ?? ce.Zero);
        row.push(scalar.mul(val).evaluate());
      }
      rows.push(ce.function('List', row));
    }
    return ce.function('List', rows);
  }

  // Higher-rank tensors: leave the scaling inert.
  return ce._fn('Multiply', [scalar, tensor]);
}
