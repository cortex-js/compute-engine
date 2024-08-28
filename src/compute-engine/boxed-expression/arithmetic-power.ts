import type { BoxedExpression } from '../public';
import { asRational } from './numerics';

import type { Rational } from '../numerics/rationals';

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

export function canonicalPower(
  a: BoxedExpression,
  b: BoxedExpression
): BoxedExpression {
  const ce = a.engine;
  a = a.canonical;
  b = b.canonical;
  const exp = b.re;
  if (exp !== undefined) {
    if (exp === 0) return ce.One;
    if (exp === 1) return a;
    if (exp === 0.5) return canonicalRoot(a, 2);
  }
  return ce._fn('Power', [a, b]);
}

export function canonicalRoot(
  a: BoxedExpression,
  b: BoxedExpression | number
): BoxedExpression {
  a = a.canonical;
  const ce = a.engine;
  let exp: number | undefined = undefined;
  if (typeof b === 'number') exp = b;
  else {
    b = b.canonical;
    if (b.isNumberLiteral && b.im === 0) exp = b.re!;
  }

  if (exp === 1) return a;
  if (exp === 2) {
    if (a.isNumberLiteral && (a.type === 'integer' || a.type === 'rational')) {
      const v = a.sqrt();
      if (typeof v.numericValue === 'number') return v;
      if (v.numericValue!.isExact) return v;
    }
    return ce._fn('Sqrt', [a]);
  }

  return ce._fn('Root', [a, typeof b === 'number' ? ce.number(b) : b]);
}

export function pow(a: BoxedExpression, b: BoxedExpression): BoxedExpression {
  return a.engine._fn('Power', [a, b]);
}

export function root(a: BoxedExpression, b: BoxedExpression): BoxedExpression {
  return a.engine._fn('Root', [a, b]);
}
