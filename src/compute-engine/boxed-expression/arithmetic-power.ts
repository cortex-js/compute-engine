import type { BoxedExpression } from '../public';
import { asRational } from './numerics';

import type { Rational } from '../numerics/rationals';
import { NumericValue } from '../numeric-value/public';
import { canonicalAngle } from './trigonometry';
import { getImaginaryFactor } from './utils';
import { isSubtype } from '../../common/type/subtype';

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

  if (expr.operator === 'Divide' && expr.op1.isEqual(1) && isSqrt(expr.op2)) {
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
    if (a.isNumberLiteral && isSubtype(a.type, 'rational')) {
      const v = a.sqrt();
      if (typeof v.numericValue === 'number') return v;
      if (v.numericValue!.isExact) return v;
    }
    return ce._fn('Sqrt', [a]);
  }

  return ce._fn('Root', [a, typeof b === 'number' ? ce.number(b) : b]);
}

/**
 * The power function.
 *
 * It follows the same conventions as SymPy, which do not always
 * conform to IEEE 754 floating point arithmetic.
 *
 * See https://docs.sympy.org/latest/modules/core.html#sympy.core.power.Pow
 *
 */
export function pow(
  x: BoxedExpression,
  exp: number | BoxedExpression
): BoxedExpression {
  if (!x.isCanonical) return x.canonical.pow(exp);

  const ce = x.engine;

  if (typeof exp !== 'number') exp = exp.canonical;

  const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

  // x^0 = 1
  if (e === 0) return ce.One;
  // x^1 = x
  if (e === 1) return x;

  if (e === -1) {
    // (-∞)^-1 = 0
    if (x.isInfinity && x.isNegative) return ce.Zero;

    // (-1)^-1 = -1
    if (x.isEqual(-1)) return ce.NegativeOne;

    // 0^-1 = ~∞
    // This is not strictly true, as 0^-1 may be undefined, but is convenient in some contexts where the base is assumed to be positive.
    if (x.isEqual(0)) return ce.ComplexInfinity;

    // 1^-1 = 1
    if (x.isEqual(1)) return ce.One;

    // ∞^-1 = 0
    if (x.isInfinity && x.isPositive) return ce.Zero;

    return x.inv();
  }

  if (e === Number.POSITIVE_INFINITY) {
    // 0^∞ = 0
    // Because for all complex numbers z near 0, z^∞ -> 0.
    if (x.isEqual(0)) return ce.Zero;

    // 1^∞ = NaN
    // Because there are various cases where lim(x(t),t)=1, lim(y(t),t)=∞ (or -∞), but lim( x(t)^y(t), t) != 1.
    if (x.isEqual(1)) return ce.NaN;

    // (-1)^∞ = NaN
    // Because of oscillations in the limit.
    if (x.isEqual(-1)) return ce.NaN;

    if (x.isInfinity) {
      if (x.isPositive) return ce.PositiveInfinity;
      if (x.isNegative) return ce.NaN;
    }
  }

  if (e === Number.NEGATIVE_INFINITY) {
    if (x.isEqual(-1)) return ce.NaN;
    if (x.isInfinity) {
      if (x.isPositive) return ce.Zero;
      if (x.isNegative) return ce.NegativeInfinity;
    }
  }

  if (typeof exp !== 'number') {
    if (exp.isInfinity && !exp.isPositive && !exp.isNegative) {
      // b^~∞ = NaN
      // Because b^z has no limit as z -> ~∞.
      return ce.NaN;
    }

    if (x.isInfinity) {
      // If the exponent is pure imaginary, the result is NaN
      if (exp.type === 'imaginary') return ce.NaN;
      if (exp.type === 'complex' && exp.re !== undefined) {
        if (exp.re > 0) return ce.ComplexInfinity;
        if (exp.re < 0) return ce.Zero;
      }
    }
  }

  //   // if (this.isNegative) {
  //   //   if (exp % 2 === 1) return this.neg().pow(exp).neg();
  //   //   if (exp % 2 === 0) return this.neg().pow(exp);
  //   // }

  if (e === Number.POSITIVE_INFINITY) {
    if (x.isGreater(1)) return ce.PositiveInfinity;
    if (x.isPositive && x.isLess(1)) return ce.Zero;
  }
  if (e === Number.NEGATIVE_INFINITY) {
    if (x.isGreater(1)) return ce.Zero;
    if (x.isPositive && x.isLess(1)) return ce.PositiveInfinity;
  }

  if (typeof exp !== 'number' && exp.operator === 'Negate')
    return x.pow(exp.op1).inv();

  // @todo: this should be canonicalized to a number, so it should never happen here
  if (x.symbol === 'ComplexInfinity') return ce.NaN;

  if (x.symbol === 'ExponentialE') {
    // Is the argument an imaginary or complex number?
    let theta = getImaginaryFactor(exp);
    if (theta !== undefined) {
      // We have an expression of the form `e^(i theta)`
      theta = canonicalAngle(theta);
      if (theta !== undefined) {
        // Use Euler's formula to return a complex trigonometric expression
        return ce
          .function('Cos', [theta])
          .add(ce.function('Sin', [theta]).mul(ce.I))
          .simplify();
        // } else if (theta) {
        //   // Return simplify angle
        //   return ce._fn('Power', [ce.E, radiansToAngle(theta)!.mul(ce.I)]);
      }
    } else if (typeof exp === 'number') {
      return ce.number(ce._numericValue(ce.E.N().numericValue!).pow(exp));
    } else if (exp.isNumberLiteral) {
      return ce.number(
        ce._numericValue(ce.E.N().numericValue!).pow(exp.numericValue!)
      );
    }
  }

  // (a^b)^c -> a^(b*c)
  if (x.operator === 'Power') {
    const [base, power] = x.ops!;
    return base.pow(power.mul(exp));
  }

  // (a/b)^c -> a^c / b^c
  if (x.operator === 'Divide') {
    const [num, denom] = x.ops!;
    return num.pow(exp).div(denom.pow(exp));
  }

  if (x.operator === 'Negate') {
    // (-x)^n = (-1)^n x^n
    if (e !== undefined) {
      if (e % 2 === 0) return x.op1.pow(exp);
      return x.op1.pow(exp).neg();
    }
  }

  // (√a)^b -> a^(b/2) or √(a^b)
  if (x.operator === 'Sqrt') {
    if (e === 2) return x.op1;
    if (e !== undefined && e % 2 === 0) return x.op1.pow(e / 2);
    return x.op1.pow(exp).sqrt();
  }

  // exp(a)^b -> e^(a*b)
  if (x.operator === 'Exp') return ce.E.pow(x.op1.mul(exp));

  // (a*b)^c -> a^c * b^c
  if (x.operator === 'Multiply') {
    const ops = x.ops!.map((x) => x.pow(exp));
    // return mul(...ops);  // don't call: infinite recursion
    return ce._fn('Multiply', ops);
  }

  // a^(b/c) -> root(a, c)^b if b = 1 or c = 1
  if (
    typeof exp !== 'number' &&
    exp.isNumberLiteral &&
    exp.type === 'rational'
  ) {
    const v = exp.numericValue as NumericValue;

    if (v.numerator.isOne) return x.root(v.denominator.re);
    if (v.denominator.isOne) return x.pow(v.numerator.re);
  }

  // (a^(1/b))^c -> a^(c/b)
  if (x.operator === 'Root') {
    const [base, root] = x.ops!;
    return base.pow(ce.box(exp).div(root));
  }

  if (x.isNumberLiteral && Number.isInteger(e)) {
    // x^e: evaluate if e is an integer and x is exact
    const n = x.numericValue!;
    if (typeof n === 'number') {
      if (Number.isInteger(n)) return ce.number(Math.pow(n, e!));
    } else {
      if (n.isExact) {
        // @todo the result should always be exact if e is an integer
        const v = n.asExact!.pow(e!);
        if (v.isExact) return ce.number(v);
      }
    }
  }

  return ce._fn('Power', [x, ce.box(exp)]);
}

export function root(a: BoxedExpression, b: BoxedExpression): BoxedExpression {
  return a.engine._fn('Root', [a, b]);
}
