import { BoxedExpression, IComputeEngine, Rational } from '../public';
import { asCoefficient } from './factor';

export class Terms {
  private engine: IComputeEngine;
  private terms: { coef: BoxedExpression; term: BoxedExpression }[] = [];

  constructor(expr: BoxedExpression) {
    this.engine = expr.engine;
    this.add(expr);
  }

  sub(term: BoxedExpression): void {
    this.add(term, this.engine.NegativeOne);
  }

  add(term2: BoxedExpression, coef2?: BoxedExpression): void {
    coef2 ??= this.engine.One;
    let [coef, term] = asCoefficient(term2);
    coef = this.engine.mul(coef, coef2);
    if (coef.isZero) return;
    const i = this.find(term);
    if (i >= 0) {
      this.terms[i].coef = this.engine.add(this.terms[i].coef, coef);
      return;
    }
    this.terms.push({ coef, term });
  }

  find(term: BoxedExpression): number {
    return this.terms.findIndex((x) => x.term.isSame(term));
  }

  reduceNumbers(): void {
    const ce = this.engine;
    let num = ce.Zero;
    let terms = this.terms;
    this.terms = [];
    for (const { coef, term } of terms) {
      const v = term.N();
      const c = coef.N();
      if (v.numericValue === null) this.terms.push({ coef: c, term });
      else num = ce.add(num, ce.mul(c, term));
    }
    num = num.N();
    if (!num.isZero) this.terms.push({ coef: num, term: this.engine.One });
  }

  reduceExactNumbers(): void {
    // Check if there is any non-exact term
    for (const x of this.terms) {
      if (x.term.numericValue !== null && !x.term.isExact)
        return this.reduceNumbers();
      if (x.coef.numericValue !== null && !x.coef.isExact)
        return this.reduceNumbers();
    }

    const ce = this.engine;
    let terms = this.terms;
    this.terms = [];
    // @todo: sum gaussian_im, im, rational, other numeric
    let num = ce.Zero;
    for (const { coef, term } of terms) {
      if (term.isExact) num = ce.add(num, ce.mul(coef, term));
      else this.terms.push({ coef, term });
    }
    if (!num.isZero) this.terms.push({ coef: num, term: this.engine.One });
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;

    const terms = this.terms.filter(
      ({ coef, term }) => !coef.isZero && !term.isZero
    );

    if (terms.length === 0) return ce.Zero;
    if (terms.length === 1) {
      const { coef, term } = terms[0];
      if (coef.isOne) return term;
      if (coef.isNegativeOne) return ce.neg(term);
      return ce.mul(coef, term);
    }

    return ce._fn(
      'Add',
      terms.map(({ coef, term }) => ce.mul(coef, term))
    );
  }
}
