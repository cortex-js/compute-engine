import type { BoxedExpression } from '../global-types';

import { isRelationalOperator } from './utils';

import { Product, commonTerms } from './product';

import { NumericValue } from '../numeric-value/types';

import { mul } from './arithmetic-mul-div';
import { add } from './arithmetic-add';

/** Combine rational expressions into a single fraction */
export function together(op: BoxedExpression): BoxedExpression {
  const ce = op.engine;
  const h = op.operator;

  // Thread over inequality
  if (isRelationalOperator(h)) return ce.function(h, op.ops!.map(together));

  if (h === 'Divide') return op.ops![0].div(op.ops![1]);

  if (h === 'Negate') return together(op.ops![0]).neg();

  if (h === 'Add') {
    const [numer, denom] = op.ops!.reduce(
      (acc, x) => {
        if (x.operator === 'Divide') {
          acc[0].push(x.ops![0]);
          acc[1].push(x.ops![1]);
        } else acc[0].push(x);
        return acc;
      },
      [[], []] as BoxedExpression[][]
    );
    return add(...numer).div(add(...denom));
  }

  return op;
}

/**
 * Return an expression factored as a product.
 * - 2x + 4 -> 2(x + 2)
 * - 2x < 4 -> x < 2
 * - (2x) * (2y) -> 4xy
 */
export function factor(expr: BoxedExpression): BoxedExpression {
  const h = expr.operator;
  if (isRelationalOperator(h)) {
    let lhs = Product.from(expr.op1);
    let rhs = Product.from(expr.op2);
    const [coef, common] = commonTerms(lhs, rhs);

    let flip = coef.sgn() === -1;

    if (!coef.isOne) {
      lhs.div(coef);
      rhs.div(coef);
    }

    if (!common.is(1)) {
      // We have some symbolic factor in common ("x", etc...)
      if (common.isPositive) {
        lhs.div(common);
        rhs.div(common);
      } else if (common.isNegative) {
        lhs.div(common.neg());
        rhs.div(common.neg());
        flip = !flip;
      }
    }

    if (flip) [lhs, rhs] = [rhs, lhs];

    return expr.engine.function(h, [lhs.asExpression(), rhs.asExpression()]);
  }

  if (h === 'Negate') return factor(expr.ops![0]).neg();

  if (h === 'Add') {
    const ce = expr.engine;
    let common: NumericValue | undefined = undefined;

    // Calculate the GCD of all coefficients
    const terms: { coeff: NumericValue; term: BoxedExpression }[] = [];
    for (const op of expr.ops!) {
      const [coeff, term] = op.toNumericValue();
      common = common ? common.gcd(coeff) : coeff;
      if (!coeff.isZero) terms.push({ coeff, term });
    }

    if (!common || common.isOne) return expr;

    const newTerms = terms.map(({ coeff, term }) =>
      mul(term, ce.box(coeff.div(common)))
    );

    return mul(ce.number(common), add(...newTerms));
  }

  return Product.from(together(expr)).asExpression();
}
