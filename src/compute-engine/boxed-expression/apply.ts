import { Complex } from 'complex-esm';
import { Decimal } from 'decimal.js';

import type { BoxedExpression } from '../global-types';

import { bignumPreferred } from './utils';

export function apply(
  expr: BoxedExpression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: Decimal) => Decimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex
): BoxedExpression | undefined {
  if (expr?.numericValue === undefined) return undefined;
  const ce = expr.engine;

  let result: number | Complex | Decimal | undefined = undefined;
  if (expr.im !== 0) result = complexFn?.(ce.complex(expr.re, expr.im));
  else {
    const bigRe = expr.bignumRe;
    if (bigRe !== undefined && bignumPreferred(ce) && bigFn)
      result = bigFn(bigRe);
    else {
      const re = expr.re;
      if (bignumPreferred(ce) && bigFn) result = bigFn(ce.bignum(re));
      else result = fn(re);
    }
  }

  if (result === undefined) return undefined;
  if (result instanceof Complex)
    return ce.number(ce._numericValue({ re: result.re, im: result.im }));
  return ce.number(result);
}

export function apply2(
  expr1: BoxedExpression,
  expr2: BoxedExpression,
  fn: (x1: number, x2: number) => number | Complex,
  bigFn?: (x1: Decimal, x2: Decimal) => Decimal | Complex | number,
  complexFn?: (x1: Complex, x2: number | Complex) => Complex | number
): BoxedExpression | undefined {
  if (expr1.numericValue === undefined || expr2.numericValue === undefined)
    return undefined;

  const ce = expr1.engine;

  let result: number | Complex | Decimal | undefined = undefined;
  if (expr1.im !== 0 || expr2.im !== 0) {
    result = complexFn?.(
      ce.complex(expr1.re, expr1.im),
      ce.complex(expr2.re, expr2.im)
    );
  }

  if (result === undefined && bigFn) {
    let bigRe1 = expr1.bignumRe;
    let bigRe2 = expr2.bignumRe;
    if (bigRe1 !== undefined || bigRe2 !== undefined) {
      bigRe1 ??= ce.bignum(expr1.re);
      bigRe2 ??= ce.bignum(expr2.re);
      result = bigFn(bigRe1, bigRe2);
    }
  }
  if (result === undefined) {
    const re1 = expr1.re;
    const re2 = expr2.re;
    if (!isNaN(re1) && !isNaN(re2)) {
      if (bignumPreferred(ce) && bigFn)
        result = bigFn(
          ce.bignum(expr1.bignumRe ?? re1),
          ce.bignum(expr2.bignumRe ?? re2)
        );
      else result = fn(re1, re2);
    }
  }

  if (result === undefined) return undefined;
  if (result instanceof Complex)
    return ce.number(
      ce._numericValue({ re: ce.chop(result.re), im: ce.chop(result.im) })
    );
  return ce.number(ce.chop(result));
}
