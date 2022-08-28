import { BoxedExpression, IComputeEngine } from '../public';
import { sortAdd } from '../boxed-expression/order';
import { asCoefficient } from './utils';
import { flattenOps } from './flatten';
import { SMALL_INTEGER } from '../numerics/numeric';

export class Sum {
  private engine: IComputeEngine;

  // Factor out "small" rationals (numer and denom < SMALL_INTEGER).
  private _literal: [number, number] = [0, 1];
  private _imaginary = 0;

  private _posInfinityCount = 0;
  private _negInfinityCount = 0;

  private _terms: { coef: [number, number]; term: BoxedExpression }[] = [];

  constructor(engine: IComputeEngine, terms?: BoxedExpression[]) {
    this.engine = engine;

    if (terms) for (const arg of terms) this.addTerm(arg);
  }

  get isEmpty(): boolean {
    return (
      this._terms.length === 0 &&
      this._literal[0] === 0 &&
      this._imaginary === 0 &&
      this._negInfinityCount === 0 &&
      this._posInfinityCount === 0
    );
  }
  /**
   * Add a new term to the sum.
   * A term is a rational coefficient and an expression.
   * Optionally, the term is multiplied by the constant `c` before being added.
   *
   * If the sum already has this term, the coefficient is added
   * to the previous one. Otherwise, a new entry is added.
   *
   * E.g. "2x + x + 1/5 y"
   *  -> [['x', [3, 1]], ['y', [1, 5]]]
   */
  addTerm(term: BoxedExpression, c?: [number, number]) {
    if (term.symbol === 'Nothing') return;

    if (c === undefined) c = [1, 1];

    if (term.isLiteral) {
      if (term.isInfinity) {
        if (term.isPositive) this._posInfinityCount += 1;
        else this._negInfinityCount += 1;
        return;
      }

      const [numer, denom] = term.asRational;
      if (numer !== null && denom !== null) {
        this._literal = [
          c[0] * (this._literal[0] * denom + numer * this._literal[1]),
          c[1] * denom * this._literal[1],
        ];
        return;
      }

      if (term.complexValue) {
        let re = term.complexValue.re;
        let im = term.complexValue.im;
        if (Number.isInteger(re) && Math.abs(re) <= SMALL_INTEGER) {
          this._literal[0] += (this._literal[1] * re * c[0]) / c[1];
          re = 0;
        }
        if (Number.isInteger(im) && Math.abs(im) <= SMALL_INTEGER) {
          this._imaginary += (im * c[0]) / c[1];
          im = 0;
        }
        if (re === 0 && im === 0) return;
        term = this.engine.number(this.engine.complex(re, im)).canonical;
      }
    }

    let coef: [number, number];
    [coef, term] = asCoefficient(term);

    if (coef[0] === 0) return;

    coef = [coef[0] * c[0], coef[1] * c[1]];

    if (term.head === 'Add') {
      for (const x of term.ops!) this.addTerm(x, coef);
      return;
    }

    let hasTerm = false;
    if (!term.isLiteral) {
      // There's an overhead to calculate the hash.
      // For best results, only use the hash if there are many terms
      if (this._terms.length > 500) {
        const h = term.hash;
        for (let i = 0; i < this._terms.length; i++) {
          if (
            !this._terms[i].term.isLiteral &&
            h === this._terms[i].term.hash &&
            term.isSame(this._terms[i].term)
          ) {
            const [a, b] = this._terms[i].coef;
            const [c, d] = coef;
            this._terms[i].coef = [a * d + b * c, b * d];
            hasTerm = true;
            break;
          }
        }
      } else {
        for (let i = 0; i < this._terms.length; i++) {
          if (
            !this._terms[i].term.isLiteral &&
            term.isSame(this._terms[i].term)
          ) {
            const [a, b] = this._terms[i].coef;
            const [c, d] = coef;
            this._terms[i].coef = [a * d + b * c, b * d];
            hasTerm = true;
            break;
          }
        }
      }
    }

    if (!hasTerm) this._terms.push({ term, coef });
  }

  terms(): BoxedExpression[] {
    const ce = this.engine;

    if (this._posInfinityCount > 0 && this._negInfinityCount > 0)
      return [ce._NAN];
    if (this._posInfinityCount > 0) return [ce._POSITIVE_INFINITY];
    if (this._negInfinityCount > 0) return [ce._NEGATIVE_INFINITY];

    if (this._terms.length === 0) {
      if (this._literal[0] === 0 && this._imaginary === 0) return [];
      if (this._imaginary === 0) return [ce.number(this._literal).canonical];

      // if (!complexAllowed(ce)) return [ce.NAN];

      if (this._literal[0] === 0)
        return [ce.number(ce.complex(0, this._imaginary)).canonical];

      return [
        ce.number(this._literal).canonical,
        ce.number(ce.complex(0, this._imaginary)).canonical,
      ];
    }

    const xs: BoxedExpression[] = [];
    for (const {
      coef: [n, d],
      term,
    } of this._terms) {
      if (n !== 0) {
        if (n === d) xs.push(term);
        else if (n === -d) xs.push(ce.negate(term));
        else if (d === 1) xs.push(ce.mul([ce.number(n).canonical, term]));
        else if (n === 1) xs.push(ce.divide(term, ce.number(d).canonical));
        else if (n !== 0) xs.push(ce.mul([ce.number([n, d]).canonical, term]));
      }
    }

    if (this._literal[0] !== 0) xs.push(ce.number(this._literal).canonical);
    if (this._imaginary !== 0)
      xs.push(ce.number(ce.complex(0, this._imaginary)).canonical);

    return flattenOps(xs, 'Add') ?? xs;
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    const xs = this.terms();
    if (xs.length === 0) return ce._ZERO;
    if (xs.length === 1) return xs[0];

    return ce._fn('Add', sortAdd(ce, xs));
  }
}
