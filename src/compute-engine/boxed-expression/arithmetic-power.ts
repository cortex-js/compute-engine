import type { BoxedExpression } from '../public';
import { asRational } from './numerics';

import type { Rational } from '../numerics/rationals';
import { canonicalAngle } from './trigonometry';
import { getImaginaryFactor } from './utils';
import { isSubtype } from '../../common/type/subtype';
import { apply, apply2 } from './apply';
import { SMALL_INTEGER } from '../numerics/numeric';

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

  if (expr.operator === 'Divide' && expr.op1.is(1) && isSqrt(expr.op2)) {
    const n = expr.op2.re;
    if (!Number.isInteger(n)) return null;
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
  if (a.is(0)) {
    if (b.is(0)) return ce.NaN;
    if (b.isPositive) return ce.Zero;
    if (b.isNegative) return ce.ComplexInfinity;
  }
  if (a.is(1) || b.is(0)) return ce.One;
  if (b.is(1)) return a;
  if (b.is(0.5)) return canonicalRoot(a, 2);

  const r = asRational(b);
  if (r !== undefined && r[0] === 1) return canonicalRoot(a, ce.number(r[1]));

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
    if (b.isNumberLiteral && b.im === 0) exp = b.re;
  }

  if (exp === 1) return a;
  if (exp === 2) {
    if (a.isNumberLiteral && isSubtype(a.type, 'rational')) {
      if (a.re < SMALL_INTEGER) {
        const v = a.sqrt();
        if (typeof v.numericValue === 'number') return v;
        if (v.numericValue!.isExact) return v;
      }
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
  exp: number | BoxedExpression,
  { numericApproximation }: { numericApproximation: boolean }
): BoxedExpression {
  if (!x.isCanonical) return x.canonical.pow(exp);

  //
  // If a numeric approximation is requested, we try to evaluate the expression
  //
  if (numericApproximation) {
    if (x.isNumberLiteral) {
      if (typeof exp === 'number') {
        return (
          apply(
            x,
            (x) => Math.pow(x, exp as number),
            (x) => x.pow(exp as number),
            (x) => x.pow(exp as number)
          ) ?? pow(x, exp, { numericApproximation: false })
        );
      } else if (exp.isNumberLiteral)
        return (
          apply2(
            x,
            exp,
            (x, exp) => Math.pow(x, exp),
            (x, exp) => x.pow(exp),
            (x, exp) => x.pow(exp)
          ) ?? pow(x, exp, { numericApproximation: false })
        );
    }
  }

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
    if (x.is(-1)) return ce.NegativeOne;

    // 0^-1 = ~∞
    // This is not strictly true, as 0^-1 may be undefined, but is convenient in some contexts where the base is assumed to be positive.
    if (x.is(0)) return ce.ComplexInfinity;

    // 1^-1 = 1
    if (x.is(1)) return ce.One;

    // ∞^-1 = 0
    if (x.isInfinity && x.isPositive) return ce.Zero;

    return x.inv();
  }

  if (e === Number.POSITIVE_INFINITY) {
    // 0^∞ = 0
    // Because for all complex numbers z near 0, z^∞ -> 0.
    if (x.is(0)) return ce.Zero;

    // 1^∞ = NaN
    // Because there are various cases where lim(x(t),t)=1, lim(y(t),t)=∞ (or -∞), but lim( x(t)^y(t), t) != 1.
    if (x.is(1)) return ce.NaN;

    // (-1)^∞ = NaN
    // Because of oscillations in the limit.
    if (x.is(-1)) return ce.NaN;

    if (x.isInfinity) {
      if (x.isPositive) return ce.PositiveInfinity;
      if (x.isNegative) return ce.NaN;
    }
  }

  if (e === Number.NEGATIVE_INFINITY) {
    if (x.is(-1)) return ce.NaN;
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
      if (exp.type === 'complex' && !isNaN(exp.re)) {
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
    return pow(x, exp.op1, { numericApproximation }).inv();

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
    } else if (numericApproximation) {
      if (typeof exp === 'number') {
        return ce.number(ce._numericValue(ce.E.N().numericValue!).pow(exp));
      } else if (exp.isNumberLiteral) {
        return ce.number(
          ce._numericValue(ce.E.N().numericValue!).pow(exp.numericValue!)
        );
      }
    }
  }

  // (a^b)^c -> a^(b*c)
  if (x.operator === 'Power') {
    const [base, power] = x.ops!;
    return pow(base, power.mul(exp), { numericApproximation });
  }

  // (a/b)^c -> a^c / b^c
  if (x.operator === 'Divide') {
    const [num, denom] = x.ops!;
    return pow(num, exp, { numericApproximation }).div(
      pow(denom, exp, { numericApproximation })
    );
  }

  if (x.operator === 'Negate') {
    // (-x)^n = (-1)^n x^n
    if (e !== undefined) {
      if (e % 2 === 0) return pow(x.op1, exp, { numericApproximation });
      return pow(x.op1, exp, { numericApproximation }).neg();
    }
  }

  // (√a)^b -> a^(b/2) or √(a^b)
  if (x.operator === 'Sqrt') {
    if (e === 2) return x.op1;
    if (e !== undefined && e % 2 === 0) return x.op1.pow(e / 2);
    return pow(x.op1, exp, { numericApproximation }).sqrt();
  }

  // exp(a)^b -> e^(a*b)
  if (x.operator === 'Exp')
    return pow(ce.E, x.op1.mul(exp), { numericApproximation });

  // (a*b)^c -> a^c * b^c
  if (x.operator === 'Multiply') {
    const ops = x.ops!.map((x) => pow(x, exp, { numericApproximation }));
    // return mul(...ops);  // don't call: infinite recursion
    return ce._fn('Multiply', ops);
  }

  // a^(b/c) -> root(a, c)^b if b = 1 or c = 1
  if (typeof exp !== 'number' && exp.isNumberLiteral) {
    const r = asRational(exp);
    if (r !== undefined && r[0] === 1)
      return root(x, ce.number(r[1]), { numericApproximation });
  }

  // (a^(1/b))^c -> a^(c/b)
  if (x.operator === 'Root') {
    const [base, root] = x.ops!;
    return pow(base, ce.box(exp).div(root), { numericApproximation });
  }

  //
  // We were not requested for a numeric approximation,
  // so we evaluate a numeric expression only if exact
  //
  if (x.isNumberLiteral && Number.isInteger(e)) {
    // x^e: evaluate if e is an integer and x is exact

    const n = x.numericValue!;
    if (typeof n === 'number') {
      if (Number.isInteger(n))
        return (
          apply(
            x,
            (x) => Math.pow(x, e as number),
            (x) => x.pow(e as number),
            (x) => x.pow(e as number)
          ) ?? ce._fn('Power', [x, ce.box(exp)])
        );
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

export function root(
  a: BoxedExpression,
  b: BoxedExpression,
  { numericApproximation }: { numericApproximation: boolean }
): BoxedExpression {
  if (numericApproximation) {
    if (a.isNumberLiteral && b.isNumberLiteral) {
      // (-x)^n = (-1)^n x^n
      const isNegative = a.isNegative;
      const isEven = b.isEven;
      if (isNegative) a = a.neg();

      return (
        apply2(
          a,
          b,
          (a, b) => {
            const result = Math.pow(a, 1 / b);
            if (isNegative && !isEven) return -result;
            return result;
          },
          (a, b) => {
            const result = a.pow(b.pow(-1));
            if (isNegative && !isEven) return result.neg();
            return result;
          },
          (a, b) => {
            const result = a.pow(typeof b === 'number' ? 1 / b : b.inverse());
            if (isNegative && !isEven) return result.neg();
            return result;
          }
        ) ?? root(a, b, { numericApproximation: false })
      );
    }
  }

  if (a.isNumberLiteral && b.isNumberLiteral && b.isInteger) {
    const e = typeof b === 'number' ? b : b.im === 0 ? b.re : undefined;

    // a^(1/b): evaluate if b is an integer and a is exact

    // @todo the result should always be exact if e is an integer
    if (e !== undefined) {
      if (typeof a.numericValue === 'number') {
        const v = a.engine._numericValue(a.numericValue)?.root(e);
        if (v?.isExact) return a.engine.number(v);
      } else {
        const v = a.numericValue!.asExact?.root(e);
        if (v?.isExact) return a.engine.number(v);
      }
    }
  }

  return a.engine._fn('Root', [a, b]);
}
