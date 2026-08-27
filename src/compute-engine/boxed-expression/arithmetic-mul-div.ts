import { isSubtype } from '../../common/type/subtype.js';

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isTensorValue, packTensor } from './tensor-view.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  numericValue,
  isContinuationOperand,
  containsContinuationOperand,
} from './type-guards.js';
import {
  isTuple,
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
import { flatten, flattenHoldingBarriers } from './flatten.js';
import { asRational, asSmallInteger } from './numerics.js';
import { heldNonNumericScalar } from './value-membership.js';
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
 * The structure of a canonical expression must never depend on a symbol's
 * transient value — a fold is only sound when the operand is the literal
 * itself. `.isSame()` is strictly syntactic (a symbol never compares equal to
 * a literal), so a bare `.isSame(n)` could no longer mis-fold; the `isNumber`
 * guard is kept because it states the intent and short-circuits cheaply.
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
            // `~oo` first, because it has NO direction and so cannot take a
            // sign from the coefficient: 2·~oo, -2·~oo and i·~oo are all
            // `~oo`. The signed rule below would answer `+oo` for the first
            // and `-oo` for the second, which contradicts `Negate(~oo)` —
            // that correctly stays `~oo`, so `-2·~oo` and `-(2·~oo)` used to
            // disagree. An infinity with a non-zero imaginary part is exactly
            // the undirected one: a real ±∞ has `im === 0`, and a value like
            // `∞ + i` (finite imaginary part) is not `isInfinity` at all.
            //
            // A NON-REAL coefficient reaches the same place from the other
            // side: it turns a real ±∞ off the real line, and the product
            // keeps no sign either (`i · ln(0)` is `~oo`, not `-oo`). The
            // signed rule below cannot express that — `sgn()` of a non-real
            // coefficient is `undefined`, which it reads as positive.
            if (
              (isNumber(term) && term.im !== 0) ||
              this.coefficient.im !== 0
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

    // Note: term should be positive, so no need to handle the -1 case.
    // (isLiteral for the value-independent folds. `.isSame()` is strictly
    // syntactic, so the `isSame(0) === false` guard admits ANY non-literal
    // base to the x^0 → 1 fold — a generic-symbol fold like x/x → 1: `z^0`
    // canonicalizes to 1 even while `z := 0`. Only the literal `0^0` falls
    // through and canonicalizes to NaN.)
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
      const nonNumeric = this.terms.find((t) =>
        t.term.type.isDisjointFrom('broadcastable<number> | missing | nothing')
      );
      if (nonNumeric !== undefined)
        return ce.typeError('number', nonNumeric.term.type, nonNumeric.term);
      return ce.Zero;
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
    // A NaN coefficient absorbs the whole product, as in `asExpression()`.
    // `mul()` stops accumulating once it sees a NaN operand but leaves the
    // terms pushed BEFORE it in place, so without this guard a product such
    // as `(x + 1) · NaN` came back as an inert `NaN * (x + 1)` — which does
    // not even report `isNaN`, since an unevaluated function node cannot.
    if (coef.isNaN) return [ce.NaN, ce.One];
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
  const arities = ops.filter((x) => isTuple(x)).map(tupleArity);
  const known = arities.filter((n): n is number => n !== undefined);
  // `Dot` rejects a pair whose component counts differ, so two points of
  // KNOWN and different arity have no alternative to offer at all.
  const mismatched = known.length > 1 && known.some((n) => n !== known[0]);
  const crossApplies =
    !mismatched && arities.every((n) => n === undefined || n === 3);
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
  return numericTupleArity(expr) ?? numericTupleArity(expr.value ?? expr);
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
    if (isTuple(op2)) return ce.error(['no-division-by-point']);
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
    // The purely structural `isTuple` used for the DIVISOR above is not the
    // right test here: it does not unfold a transparent type alias, so an
    // alias of a numeric tuple (`p: pt` with `type pt = tuple<number,
    // number>`) would miss this branch, canonicalize to a `Multiply`, and
    // report the alias name as the quotient type — claiming a shape the
    // component-widened quotient no longer has.
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
  if (isLiteral(op2, 0)) {
    if (typeMayCarryQuotientShape(op1.type.type))
      return ce._fn('Divide', [op1, op2]);
    return isLiteral(op1, 0) ? ce.NaN : ce.ComplexInfinity;
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
    return ce.Zero;
  }

  // a/∞ = 0, ∞/∞ = NaN (check before a/a = 1 rule)
  if (op2.isInfinity) {
    if (op1.isInfinity) return ce.NaN;
    // Same shape exemption as the a/0 rule above: [1,2]/∞ broadcasts to
    // [0, 0] at evaluation rather than collapsing to the scalar 0.
    if (typeMayCarryQuotientShape(op1.type.type))
      return ce._fn('Divide', [op1, op2]);
    return ce.Zero;
  }

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
    if (!d.isNaN && isSubtype(d.type.type, 'number'))
      // Evaluate each component quotient, mirroring `mulTuples`: a component
      // that is itself a collection (`[1,2]` in a zipped point list) divides
      // to an inert `Multiply(1/d, [1,2])`, because `div()` builds a
      // `Product` rather than broadcasting. Only evaluation distributes the
      // scale over the elements, and the `Divide` evaluate handler returns
      // this result as-is on the exact route, so an unevaluated component
      // would reach the user.
      return ce.tuple(...num.ops.map((c) => c.div(d).evaluate()));
  }

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
    // A shape-carrying numerator is exempt, exactly as in `canonicalDivide`:
    // the quotient stays an inert `Divide` so evaluation broadcasts the
    // division over the elements ([1,2]/0 → [~oo, ~oo]) instead of
    // collapsing the shape to one scalar.
    if (denom === 0) {
      if (typeMayCarryQuotientShape(num.type.type))
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
    // above (the boxed-zero case previously returned NaN). A shape-carrying
    // numerator stays an inert `Divide` that broadcasts at evaluation, as in
    // the JS-number path and `canonicalDivide`.
    if (isLiteral(denom, 0)) {
      if (typeMayCarryQuotientShape(num.type.type))
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

  // Two or more tuples (points/vectors) have no implicit product (dot/cross);
  // reject `tuple · tuple` at canonicalization. Counted by tuple-ness
  // (`isTuple`, like `mulTuples` on the evaluation path), not provable element
  // numericity: a `tuple<broadcastable<number>, …>` operand — whatever its
  // elements refine to — still has no product with another tuple, and the
  // narrower `isNumericTuple` deferred the identical rejection to evaluation,
  // making validity depend on refinement order (Tycho item 158). Use `Dot`
  // for the explicit inner product. `scalar · tuple` is allowed and scales
  // component-wise at evaluation.
  if (ops.filter((x) => isTuple(x)).length >= 2)
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
      // The fold can produce a NEGATIVE real coefficient even though the sign
      // pass above normalized every literal positive — only a product with
      // complex operands can (e.g. `i·i = -1`). Re-enter the sign channel so
      // the fold result spells the same as literal input:
      // `Multiply(i, i, a, b)` → `Negate(Multiply(a, b))`, exactly like
      // `Multiply(-1, a, b)`. A stranded `-1` operand serializes as `-(ab…)`,
      // which reparses as `Negate(Multiply(…))` — a second canonical spelling
      // of the same negated product (round-trip class
      // negate-vs-multiply-minus-one).
      if (product.im === 0 && product.sgn() === -1) {
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

function mulImpl(xs: ReadonlyArray<Expression>, expand: boolean): Expression {
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

  // Tensor (matrix/vector) operands follow matrix-product / scalar-scaling
  // semantics rather than the scalar Product machinery.
  if (!unresolvedFactor && xs.some((x) => isTensorValue(x))) {
    const r = mulTensors(ce, xs, false, expand);
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

  // `expandProducts` does two things: it distributes over sums, and — as a
  // side effect of walking the operands pairwise — it folds the product two at
  // a time. Only the DISTRIBUTION is what `mulFactored` declines, so the fold
  // is skipped only when a sum is actually reachable. Skipping it
  // unconditionally changed the folding ORDER of an ordinary numeric product,
  // and `-2 · 3.1 · ∞ · ∞ · x` then came back `+∞·x` at machine precision
  // instead of `-∞·x`. With no reachable sum, `mulFactored` is `mul`.
  if (expand || !xs.some(hasDistributableSum)) {
    const exp = expandProducts(ce, xs);
    if (exp) {
      if (exp.operator !== 'Multiply') return exp;
      if (isFunction(exp)) xs = exp.ops;
    }
  }

  return new Product(ce, xs).asRationalExpression();
}

export function mulN(...xs: ReadonlyArray<Expression>): Expression {
  console.assert(xs.length > 0);
  // A single factor is its own product, floated. `mulTuples` combines the
  // scalar factors with a recursive call and `mulTensors` buckets a numeric
  // tuple as a scalar, so `N([0, 1/3] · (1, 0))` reached `mulN((1, 0))`,
  // whose tuple branch then called `mulN()` with NO factors and crashed on
  // `xs[0]` — the short-circuit `mul` has always had.
  if (xs.length === 1) return xs[0].N();
  const ce = xs[0].engine;
  // Ellipsis fold barrier: stay inert for a notational product.
  if (xs.some((x) => isContinuationOperand(x)))
    return ce._fn(
      'Multiply',
      xs.map((x) => x.canonical)
    );
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
  if (!unresolvedFactor && xs.some((x) => isTensorValue(x))) {
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
  xs = xs.map((x) => x.N());
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

  const exp = expandProducts(ce, xs);
  if (exp) {
    if (exp.operator !== 'Multiply') return exp;
    if (isFunction(exp)) xs = exp.ops;
  }

  return new Product(ce, xs).asExpression({ numericApproximation: true });
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

  const tuple = tuples[0];

  // No accessible components (symbolic tuple, e.g. `2·z`): stay symbolic.
  if (!hasAccessibleComponents(tuple) || !isFunction(tuple))
    return ce._fn('Multiply', sortProductOperands([...xs]));

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
    const cv = numericApproximation ? c.N() : c.evaluate();
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
 * Returns an inert `Multiply` when the tensors have incompatible dimensions (so
 * the input is preserved rather than silently dropped).
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
  expand = true
): Expression | undefined {
  const multiply = numericApproximation ? mulN : expand ? mul : mulFactored;
  // A CELL product on the exact routes is finished with `.evaluate()`, so the
  // `Multiply` handler's closed-inexact-constant rule applies to it exactly as
  // to a scalar product: `0.5 · [π, 1]` is `[1.57…, 0.5]`, not `[0.5π, 0.5]`.
  // The `.N()` route has already floated every cell.
  const multiplyCell = numericApproximation
    ? multiply
    : (...xs: ReadonlyArray<Expression>) => multiply(...xs).evaluate();
  // Separate evaluated operands into tensors and scalars, preserving order.
  const tensors: Expression[] = [];
  const scalars: Expression[] = [];
  for (const op of xs) {
    const x = numericApproximation ? op.N() : op.evaluate();
    if (isTensorValue(x)) {
      // A tensor-valued operand that does not pack (e.g. a list of
      // non-kernel-admissible cells such as tuples/points) means the tensor
      // kernels do not apply — decline so the caller falls through to the
      // generic broadcast / tuple path (behave as if not a tensor).
      if (packTensor(ce, x) === undefined) return undefined;
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
      if (isBroadcastableCollection(x)) return undefined;
      scalars.push(x);
    }
  }

  // No tensors survived evaluation: let the caller fall through to the generic
  // (broadcast / tuple / Product) path.
  if (tensors.length === 0) return undefined;

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
      const n = product.shape[0];
      const elements: Expression[] = [];
      for (let k = 1; k <= n; k++) {
        const a = ce.expr(productTensor.at(k) ?? ce.Zero);
        const b = ce.expr(nextTensorPacked.at(k) ?? ce.Zero);
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
    // Incompatible dimensions, or a partial fold that didn't reduce (e.g. a
    // scalar dot-product result followed by another matrix): stay inert.
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

  // Pack once for the whole scaling. A pack failure leaves the scaling inert.
  const packed = packTensor(ce, tensor);
  if (!packed) return ce._fn('Multiply', [scalar, tensor]);

  // Vector (rank 1)
  if (shape.length === 1) {
    const result: Expression[] = [];
    for (let i = 0; i < shape[0]; i++) {
      const val = ce.expr(packed.at(i + 1) ?? ce.Zero);
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
        const val = ce.expr(packed.at(i + 1, j + 1) ?? ce.Zero);
        row.push(multiply(scalar, val));
      }
      rows.push(ce.function('List', row));
    }
    return ce.function('List', rows);
  }

  // Higher-rank tensors: leave the scaling inert.
  return ce._fn('Multiply', [scalar, tensor]);
}
