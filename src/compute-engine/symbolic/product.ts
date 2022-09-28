import { BoxedExpression, IComputeEngine } from '../public';

import { flattenOps } from './flatten';
import { order } from '../boxed-expression/order';
import { asCoefficient } from './utils';
import { reducedRational } from '../numerics/numeric';

/**
 * Group terms in a product by common term.
 *
 * All the terms should be canonical.
 * - the arguments should have been flattened for `Multiply`
 *
 * - any argument of power been factored out, i.e.
 *      (ab)^2 ->  a^2 b^2
 * *
 * 3 + √5 + √(x+1) + x^2 + (a+b)^2 + d
 *  -> [ [[3, "d"], [1, 1]],
 *       [[5, "x+1"], [1, 2]],
 *       [[x, "a+b"], [2, 1]]
 *      ]
 *
 */
export class Product {
  engine: IComputeEngine;
  // The terms of the product, grouped by term (i.e. `term` is the key)
  private _terms: {
    exponent: [exponentNumer: number, exponentDenom: number];
    term: BoxedExpression;
  }[] = [];

  // The product of the small (<10,000) rational literals
  private _literal: [number, number] = [1, 1];
  private _hasInfinity = false;
  private _hasZero = false;

  constructor(ce: IComputeEngine, xs?: BoxedExpression[]) {
    this.engine = ce;
    if (xs) for (const x of xs) this.addTerm(x);
  }

  get isEmpty(): boolean {
    return (
      this._hasInfinity === false &&
      this._hasZero === false &&
      this._literal[0] === this._literal[1] &&
      this._terms.length === 0
    );
  }

  /**
   * Add a term to the product.
   * If the term is a literal rational, it is added to `this._literal`.
   * Otherwise, if the term is already in the product, its degree is modified
   * as appropriate.
   */
  addTerm(term: BoxedExpression) {
    console.assert(term.isCanonical);

    if (term.isNothing) return;
    if (term.isLiteral) {
      if (term.isOne) return;

      if (term.isZero) {
        this._hasZero = true;
        return;
      }

      if (term.isNegativeOne) {
        this._literal[0] *= -1;
        return;
      }

      if (term.isInfinity) {
        this._hasInfinity = true;
        if (term.isNegative) this._literal[0] *= -1;
        return;
      }
    }

    // eslint-disable-next-line prefer-const
    let [coef, rest] = asCoefficient(term);

    console.assert(rest.head !== 'Multiply');

    this._literal = [this._literal[0] * coef[0], this._literal[1] * coef[1]];

    if (rest.isLiteral && rest.isOne) return;

    // If this is a power expression, extract the exponent
    let exponent: [number, number] = [1, 1];
    if (rest.head === 'Power' && rest.op2.isLiteral) {
      // Term is `Power(op1, op2)`
      const [n, d] = rest.op2.asRational;
      if (n !== null && d !== null) {
        exponent = [n, d];
        rest = rest.op1;
      }
    }

    // Find the term, and add the exponent if already there
    // if the exponent is an integer, or if the base is non-negative
    let found = false;
    if (exponent[1] === 1 || rest.isNonNegative)
      for (const x of this._terms) {
        if (x.term.isSame(rest)) {
          const [a, b] = x.exponent;
          const [c, d] = exponent;
          x.exponent = [a * d + b * c, b * d];
          found = true;
          break;
        }
      }

    if (!found) this._terms.push({ exponent, term: rest });
  }

  /** The terms of the product, grouped by degrees */
  groupedByDegrees(options?: { splitRational: boolean }): {
    exponent: [exponentNumer: number, exponentDenom: number];
    terms: BoxedExpression[];
  }[] {
    const ce = this.engine;
    const xs: { exponent: [number, number]; terms: BoxedExpression[] }[] = [];

    // Terms of degree 1 (exponent = [1,1])
    const unitTerms: BoxedExpression[] = [];
    if (this._hasInfinity) unitTerms.push(ce._POSITIVE_INFINITY);

    this._literal = reducedRational(this._literal);

    if (this._literal[0] !== 1 || this._literal[1] !== 1) {
      if (options?.splitRational) {
        if (this._literal[0] !== 1)
          unitTerms.push(ce.number(this._literal[0]).canonical);
        if (this._literal[1] !== 1)
          xs.push({
            exponent: [-1, 1],
            terms: [ce.number(this._literal[1]).canonical],
          });
      } else {
        unitTerms.push(ce.number(this._literal).canonical);
      }
    }

    if (unitTerms.length > 0) xs.push({ exponent: [1, 1], terms: unitTerms });

    for (const t of this._terms) {
      // Exponent of 0 indicate a term that has been simplified, i.e. `x/x`
      if (t.exponent[0] === 0) continue;
      let found = false;
      for (const x of xs) {
        if (
          t.exponent[0] === x.exponent[0] &&
          t.exponent[1] === x.exponent[1]
        ) {
          x.terms.push(t.term);
          found = true;
          break;
        }
      }
      if (!found)
        xs.push({ exponent: reducedRational(t.exponent), terms: [t.term] });
    }

    return xs;
  }

  terms(): BoxedExpression[] {
    return termsAsExpressions(this.engine, this.groupedByDegrees());
  }

  /** The product, expressed as a numerator and denominator */
  asNumeratorDenominator(): [BoxedExpression, BoxedExpression] {
    const xs = this.groupedByDegrees();
    const xsNumerator: {
      exponent: [exponentNumer: number, exponentDenom: number];
      terms: BoxedExpression[];
    }[] = [];
    const xsDenominator: {
      exponent: [exponentNumer: number, exponentDenom: number];
      terms: BoxedExpression[];
    }[] = [];

    for (const x of xs)
      if (x.exponent[0] >= 0) {
        xsNumerator.push(x);
      } else {
        xsDenominator.push({
          exponent: [-x.exponent[0], x.exponent[1]],
          terms: x.terms,
        });
      }

    const ce = this.engine;

    let numeratorTerms = termsAsExpressions(ce, xsNumerator);
    numeratorTerms = flattenOps(numeratorTerms, 'Multiply') ?? numeratorTerms;
    let numerator = ce._ONE;
    if (numeratorTerms.length === 1) numerator = numeratorTerms[0];
    else if (numeratorTerms.length > 0)
      numerator = ce._fn('Multiply', numeratorTerms);

    let denominatorTerms = termsAsExpressions(ce, xsDenominator);
    denominatorTerms =
      flattenOps(denominatorTerms, 'Multiply') ?? denominatorTerms;
    let denominator = ce._ONE;
    if (denominatorTerms.length === 1) denominator = denominatorTerms[0];
    else if (denominatorTerms.length > 0)
      denominator = ce._fn('Multiply', denominatorTerms);

    return [numerator, denominator];
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    if (this._hasInfinity) {
      if (this._hasZero) return ce._NAN;
      if (this._terms.length === 0) {
        if (this._literal[0] > 0) return ce._POSITIVE_INFINITY;
        return ce._NEGATIVE_INFINITY;
      }
    }

    if (this._hasZero) return ce._ZERO;

    if (this._terms.length === 0) return ce.number(this._literal).canonical;

    let terms = termsAsExpressions(
      ce,
      this.groupedByDegrees({ splitRational: false })
    );

    if (this._hasInfinity) terms.push(ce._POSITIVE_INFINITY);

    terms = flattenOps(terms, 'Multiply') ?? terms;
    if (terms.length === 0) return ce._ONE;
    if (terms.length === 1) return terms[0];
    return this.engine._fn('Multiply', terms);
  }

  asRationalExpression(): BoxedExpression {
    const [numerator, denominator] = this.asNumeratorDenominator();
    if (denominator.isOne) return numerator;
    if (denominator.isNegativeOne) return this.engine.negate(numerator);
    return this.engine._fn('Divide', [numerator, denominator]);
  }
}

// Put the exponents in a bucket:
// - exponent 1
// - positive integer exponents
// - positive fractional exponents
// - negative integer exponents
// - negative fractional exponents
function degreeKey(exponent: [number, number]): number {
  const [n, d] = exponent;
  if (n === d) return 0;
  if (n > 0 && Number.isInteger(n / d)) return 1;
  if (n > 0) return 2;
  if (Number.isInteger(n / d)) return 3;
  return 4;
}

function degreeOrder(
  a: {
    exponent: [exponentNumer: number, exponentDenom: number];
    terms: BoxedExpression[];
  },
  b: {
    exponent: [exponentNumer: number, exponentDenom: number];
    terms: BoxedExpression[];
  }
): number {
  const keyA = degreeKey(a.exponent);
  const keyB = degreeKey(b.exponent);
  if (keyA !== keyB) return keyA - keyB;
  return a.exponent[0] / a.exponent[1] - b.exponent[0] / b.exponent[1];
}

function termsAsExpressions(
  ce: IComputeEngine,
  terms: {
    exponent: [exponentNumer: number, exponentDenom: number];
    terms: BoxedExpression[];
  }[]
): BoxedExpression[] {
  terms = terms.sort(degreeOrder);
  const result = terms.map((x) => {
    const t = flattenOps(x.terms, 'Multiply') ?? x.terms;
    const base = t.length <= 1 ? t[0] : ce._fn('Multiply', t.sort(order));
    if (x.exponent[0] === x.exponent[1]) return base;
    return ce.power(base, x.exponent);
  });
  return flattenOps(result, 'Multiply') ?? result;
}
