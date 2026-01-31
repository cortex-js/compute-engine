import type { NumericPrimitiveType, Type } from '../../common/type/types';
import type { BoxedExpression } from '../global-types';
import { SMALL_INTEGER } from '../numerics/numeric';
import type { Rational } from '../numerics/types';

import { asRational } from './numerics';
import { canonicalAngle, getImaginaryFactor } from './utils';
import { apply, apply2 } from './apply';

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

/**
 *
 * Produce the canonical form of the operands of a Power expression, returning either the operation
 * result (e.g. 'a^1 -> a'), an alternate expr. representation ('a^{1/2} -> Sqrt(a)'), or an
 * unchanged 'Power' expression. Operations include:
 * 
 * - @todo
 * 
 * Both the given base and exponent can either be canonical or non-canonical: with fully
 * canonicalized args. lending to more simplifications.
 * 
 * Returns a canonical expr. is both operands are canonical.
 
 * @export
 * @param a
 * @param b
 * @returns
 */
export function canonicalPower(
  a: BoxedExpression,
  b: BoxedExpression
): BoxedExpression {
  const ce = a.engine;

  const fullyCanonical = a.isCanonical && b.isCanonical;
  const unchanged = () =>
    ce._fn('Power', [a, b], { canonical: fullyCanonical });

  if (a.operator === 'Power') {
    const [base, aPow] = a.ops!;
    return ce._fn('Power', [
      base,
      ce.box(['Multiply', aPow, b], {
        canonical: fullyCanonical || 'Power',
      }),
    ]);
  }

  // (a/b)^{-n} -> a^{-n} / b^{-n} = b^n / a^n
  // Only distribute when exponent is negative to normalize negative exponents on fractions
  // e.g., (a/b)^{-2} -> b^2 / a^2
  if (a.operator === 'Divide' && a.op1 && a.op2 && b.isNegative === true) {
    const num = a.op1;
    const denom = a.op2;
    // Use the pow function to recursively canonicalize
    return pow(num, b, { numericApproximation: false }).div(
      pow(denom, b, { numericApproximation: false })
    );
  }

  // Onwards, the focus on operations is where is a *numeric* exponent.
  // Therefore, exclude cases - which may otherwise be valid - of the exponent either: being a function (e.g.
  // '0 + 0'), a symbol, or of a non-numeric type.
  //
  // @consider:possible exceptions where function-expressions are reasonable :Rational,Half,
  // Negate... (However, provided that canonicalNumber provided prior, should not be missing anything
  // here)
  if (
    b.isFunctionExpression ||
    b.symbol !== null ||
    !b.type.matches('number' as Type)
  )
    return unchanged();

  // Zero as base
  if (a.isNumberLiteral && a.is(0)) {
    if (b.type.matches('imaginary' as NumericPrimitiveType) || b.isNaN)
      return ce.NaN;

    if (b.is(0)) return ce.NaN;

    if (b.isInfinity) {
      // 0^∞ = 0 (because for all complex numbers z near 0, z^∞ -> 0).
      if (b.isPositive) return ce.Zero; // 0^∞ = 0
      // 0^-∞ = ~∞
      if (b.isNegative) return ce.ComplexInfinity;
      return ce.NaN; // 0^~∞ = NaN
    }
    //(note: these should be applicable only to the reals)
    if (b.isGreater(0)) return ce.Zero;
    if (b.isLess(0)) return ce.ComplexInfinity;

    return unchanged(); // No other canonicalization cases with this base
  }

  // 'a'/base has an associated number value (excludes numeric functions)
  // (this should at this stage include library-defined symbols such as 'Pi')
  // @note: include 'Negate', because this could be wrapped around a
  // number-valued symbol, such as 'Pi'...
  // ^there could exist other exceptions: perhaps consider a util. such as
  //  'maybeNumber'?
  const aIsNum =
    a.type.matches('number' as NumericPrimitiveType) &&
    (a.isFunctionExpression === false || a.operator === 'Negate');

  // Zero as exponent
  if (b.is(0)) {
    // If 'isFinite' is a boolean, then 'a' has a value.
    if (aIsNum && a.isFinite !== undefined) return a.isFinite ? ce.One : ce.NaN;
    return unchanged();
  }

  // One as base
  // (note: 1^∞ = NaN - Because there are various cases where lim(x(t),t)=1, lim(y(t),t)=∞ (or -∞),
  // but lim( x(t)^y(t), t) != 1.)
  if (aIsNum && a.is(1)) return b.isFinite ? ce.One : ce.NaN;

  // One as exponent
  // (Permit the base to be a FN-expr. here, too...)
  if (b.is(1) && a.type.matches('number' as NumericPrimitiveType)) return a;

  // -1 exponent
  if (b.is(-1)) {
    if (aIsNum) {
      // (-∞)^-1 = 0, ∞^-1 = 0  (exclude ~oo)
      if (a.isInfinity && (a.isNegative || a.isPositive)) return ce.Zero;

      // (-1)^-1 = -1
      if (a.is(-1)) return ce.NegativeOne;

      // 1^-1 = 1
      if (a.is(1)) return ce.One;
    }

    // (note: case of `0^-1 = ~∞` is covered prior...)
    if (!a.isCanonical)
      return ce._fn('Power', [a, ce.number(-1)], { canonical: false });
    return a.inv();
  }

  //Infinity exponents
  if (b.isInfinity && aIsNum) {
    // x^oo
    if (b.isPositive) {
      // (note: 0^∞ = 0, 1^∞ = NaN, covered prior)

      // (-1)^∞ = NaN
      // Because of oscillations in the limit.
      if (a.is(-1)) return ce.NaN;

      //↓note:the case for all infinites.
      if (a.isInfinity) return ce.ComplexInfinity;

      if (a.isNaN) return ce.NaN;

      //↓numeric-expr. bases included: e.g. '{2+3}^oo'
      if (a.isReal) {
        if (a.isGreater(1)) return ce.PositiveInfinity;
        if (a.isLess(-1)) return ce.ComplexInfinity;
        // Must be '-1 < a < 1', excluding zero
        return ce.Zero;
      }

      return unchanged();
    }

    // x^-oo
    if (b.isNegative) {
      if (a.is(-1)) return ce.NaN;
      //Same result for all infinity types...
      if (a.isInfinity) return ce.Zero;

      if (a.isNaN) return ce.NaN;

      if (a.isReal) {
        if (a.isGreater(0)) return a.isLess(1) ? ce.PositiveInfinity : ce.Zero;
        // Must be < 0
        return a.isGreater(-1) ? ce.ComplexInfinity : ce.Zero;
      }
      return unchanged();
    }

    //Must be 'x^ComplexInfinity'
    // b^~∞ = NaN
    // Because b^z has no limit as z -> ~∞.
    return ce.NaN;
  }

  //'AnyInfinity^{~oo}' (i.e. ComplexInfinity)
  if (a.isNumberLiteral && a.isInfinity) {
    // If the exponent is pure imaginary, the result is NaN
    //(↓fix?:ensure both these cases narrow down to 'b' being a num./symbol literal)
    if (b.type.matches('imaginary')) return ce.NaN;
    if (b.type.matches('complex') && !isNaN(b.re)) {
      if (b.re > 0) return ce.ComplexInfinity;
      if (b.re < 0) return ce.Zero;
    }
  }

  // Fractional exponents
  //---------------------
  if (b.is(0.5))
    return a.isCanonical
      ? canonicalRoot(a, 2)
      : ce._fn('Sqrt', [a], { canonical: false });
  const r = asRational(b);

  //1/3, 1/4...
  if (r !== undefined && r[0] === 1 && r[1] !== 1)
    return a.isCanonical
      ? canonicalRoot(a, ce.number(r[1]))
      : ce._fn('Root', [a, ce.number(r[1])], { canonical: false });

  return unchanged();
}

export function canonicalRoot(
  a: BoxedExpression,
  b: BoxedExpression | number
): BoxedExpression {
  const ce = a.engine;
  let exp: number | undefined = undefined;
  if (typeof b === 'number') exp = b;
  else {
    if (b.isNumberLiteral && b.im === 0) exp = b.re;
  }

  if (exp === 1) return a;
  if (exp === 2) {
    if (a.isNumberLiteral && a.type.matches('rational')) {
      if (a.re < SMALL_INTEGER) {
        const v = a.sqrt();
        if (typeof v.numericValue === 'number') return v;
        if (v.numericValue!.isExact) return v;
      }
    }
    return ce._fn('Sqrt', [a], { canonical: a.isCanonical });
  }

  return ce._fn('Root', [a, typeof b === 'number' ? ce.number(b) : b], {
    canonical: a.isCanonical && (typeof b === 'number' || b.isCanonical),
  });
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
  if (!x.isCanonical || (typeof exp !== 'number' && !exp.isCanonical))
    return x.engine._fn('Power', [x, x.engine.box(exp)], { canonical: false });

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

  // 'canonicalPower' deals with a set of basic operations.
  // If the result is not 'Power', can assume an op. has occurred
  // In some cases, an op. may apply, but a 'Power' expr. is still the result ('(a^b)^c -> a^(b*c)'
  // for instance). For these cases, proceed.
  const canonicalResult = canonicalPower(x, ce.box(exp));
  if (canonicalResult.operator !== 'Power') return canonicalResult;

  const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

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
    } else {
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
      return (
        apply(
          x,
          (x) => Math.pow(x, e as number),
          (x) => x.pow(e as number),
          (x) => x.pow(e as number)
        ) ?? ce._fn('Power', [x, ce.box(exp)])
      );
    } else {
      return ce.number(n!.pow(e!));
    }
  }

  return ce._fn('Power', [x, ce.box(exp)]);
}

export function root(
  a: BoxedExpression,
  b: BoxedExpression,
  { numericApproximation }: { numericApproximation: boolean }
): BoxedExpression {
  if (!a.isCanonical || !b.isCanonical)
    return a.engine._fn('Root', [a, b], { canonical: false });

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
