import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  Rational,
  isBigRational,
  isMachineRational,
} from '../numerics/rationals';
import { BoxedExpression, IComputeEngine } from '../public';
import {
  asFloat,
  asRational,
  asMachineInteger,
} from '../boxed-expression/numerics';
import { mul } from './arithmetic-multiply';

export function square(
  ce: IComputeEngine,
  base: BoxedExpression
): BoxedExpression {
  const num = base.numericValue;
  if (typeof num === 'number') return ce.number(num * num);
  if (num instanceof Decimal) return ce.number(num.pow(2));
  if (num instanceof Complex) return ce.number(num.pow(2));
  if (isMachineRational(num))
    return ce.number([num[1] * num[1], num[0] * num[0]]);
  if (isBigRational(num)) return ce.number([num[1] * num[1], num[0] * num[0]]);

  if (base.head === 'Multiply')
    return ce._fn(
      'Multiply',
      base.ops!.map((x) => square(ce, x))
    ); // Don't call ce.mul() to avoid infinite loops

  if (base.head === 'Power') {
    const exp = asMachineInteger(base.op2);
    if (exp !== null) return base.op1.pow(exp * 2);
    return base.op1.pow(ce.number(2).mul(base.op2));
  }

  return base.pow(2);
}

export function processPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  // Distribute multiplication over power
  if (base.head === 'Multiply') {
    const ops = base.ops!.map(
      (x) =>
        processPower(ce, x, exponent, mode) ?? ce._fn('Power', [x, exponent])
    );
    return mul(...ops);
  }

  if (base.numericValue && exponent.numericValue) {
    const n = ce._numericValue(base.numericValue);
    const e = ce._numericValue(exponent.numericValue);
    const v = n.pow(e);
    return ce.box(mode === 'N' ? v.N() : v);
  }

  return base.pow(exponent);
}

export function isSqrt(expr: BoxedExpression): boolean {
  return (
    expr.head === 'Sqrt' || (expr.head === 'Power' && asFloat(expr.op2) === 0.5)
  );
}

export function asRationalSqrt(expr: BoxedExpression): Rational | null {
  if (!isSqrt(expr)) return null;
  return asRational(expr.op1) ?? null;
}
