import { Rational } from '../numerics/rationals';
import { BoxedExpression } from '../public';
import { asRational } from '../boxed-expression/numerics';

function isSqrt(expr: BoxedExpression): boolean {
  return (
    expr.operator === 'Sqrt' ||
    (expr.operator === 'Power' && expr.op2.im === 0 && expr.op2.re === 0.5) ||
    (expr.operator === 'Root' && expr.op2.im === 0 && expr.op2.re === 2)
  );
}

// If the expression is of the form
// : sqrt(n), return n/1
// : sqrt(n/m), return n/m
// : 1/sqrt(n), return 1/n
// : (could do): sqrt(n)/m, return n/m^2
export function asRadical(expr: BoxedExpression): Rational | null {
  if (isSqrt(expr)) return asRational(expr.op1) ?? null;

  if (expr.operator === 'Divide' && expr.op1.isOne && isSqrt(expr.op2)) {
    const n = expr.op2.re;
    if (n === undefined || !Number.isInteger(n)) return null;
    return [1, n];
  }

  return null;
}
