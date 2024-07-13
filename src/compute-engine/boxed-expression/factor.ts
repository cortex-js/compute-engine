import { BoxedExpression } from './public';
import { isRelationalOperator } from './utils';
import { Product, commonTerms } from '../symbolic/product';
import { NumericValue } from '../numeric-value/public';

/** Combine rational expressions into a single fraction */
export function together(op: BoxedExpression): BoxedExpression {
  const ce = op.engine;
  const h = op.head;

  // Thread over inequality
  if (isRelationalOperator(h)) return ce.function(h, op.ops!.map(together));

  if (h === 'Divide') return ce.div(op.ops![0], op.ops![1]);

  if (h === 'Negate') return together(op.ops![0]).neg();

  if (h === 'Add') {
    const [numer, denom] = op.ops!.reduce(
      (acc, x) => {
        if (x.head === 'Divide') {
          acc[0].push(x.ops![0]);
          acc[1].push(x.ops![1]);
        } else acc[0].push(x);
        return acc;
      },
      [[], []] as BoxedExpression[][]
    );
    return ce.div(ce.add(...numer), ce.add(...denom));
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
  const h = expr.head;
  if (isRelationalOperator(h)) {
    const lhs = Product.from(expr.op1);
    const rhs = Product.from(expr.op2);
    const common = commonTerms(lhs, rhs);
    if (!common.isOne) {
      lhs.div(common);
      rhs.div(common);
    }
    return expr.engine.function(h, [lhs.asExpression(), rhs.asExpression()]);
  }

  if (h === 'Negate') return factor(expr.ops![0]).neg();

  if (h === 'Add') {
    const ce = expr.engine;
    let common: NumericValue | undefined = undefined;

    // Calculate the GCD of all coefficients
    const terms: { coeff: NumericValue; term: BoxedExpression }[] = [];
    for (const op of expr.ops!) {
      const [coeff, term] = ce._toNumericValue(op);
      common = common ? common.gcd(coeff) : coeff;
      if (!coeff.isZero) terms.push({ coeff, term });
    }

    if (!common || common?.isOne) return expr;

    const newTerms = terms.map(({ coeff, term }) =>
      ce._fromNumericValue(coeff.div(common), term)
    );

    return ce._fromNumericValue(common, ce.add(...newTerms));
  }

  return Product.from(together(expr)).asExpression();
}
