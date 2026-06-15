import type { NumericPrimitiveType, Type } from '../../common/type/types';
import { BoxedType } from '../../common/type/boxed-type';
import type { Expression } from '../global-types';
import { SMALL_INTEGER } from '../numerics/numeric';
import { rationalize } from '../numerics/rationals';
import type { Rational } from '../numerics/types';

import { asRational } from './numerics';
import { bignumPreferred, canonicalAngle, getImaginaryFactor } from './utils';
import { apply, apply2 } from './apply';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards';

function isSqrt(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
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
export function asRadical(expr: Expression): Rational | null {
  if (isSqrt(expr) && isFunction(expr)) {
    const r = asRational(expr.op1);
    // Reject negative radicands (imaginary results, not real radicals)
    if (r === undefined || r[0] < 0 || r[1] < 0) return null;
    return r;
  }

  if (isFunction(expr, 'Divide') && expr.op1.isSame(1) && isSqrt(expr.op2)) {
    const n = expr.op2.re;
    if (!Number.isInteger(n) || n <= 0) return null;
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
export function canonicalPower(a: Expression, b: Expression): Expression {
  const ce = a.engine;

  const fullyCanonical =
    (a.isCanonical || a.isStructural) && (b.isCanonical || b.isStructural);
  const unchanged = () =>
    ce._fn('Power', [a, b], { canonical: fullyCanonical });

  if (isFunction(a, 'Power')) {
    const [base, aPow] = a.ops;
    // (a^n)^m -> a^{n*m} only when mathematically safe:
    // - base is non-negative (no sign info to lose), or
    // - outer exponent m is integer (repeated multiplication is safe).
    // An odd inner exponent n is NOT sufficient: on the principal branch
    // (a^n)^m = a^{nm}·e^{-2πi·m·k}, where k is how many times arg(a^n) wraps
    // out of (-π, π]. For odd n and a < 0, k != 0 (e.g. n=3 ⇒ k=1), so the
    // phase factor e^{-2πi·m·k} != 1 unless m is an integer. Concretely
    // (x^3)^{1/2} = √(x^3) (= 8i at x=-4), not x^{3/2} (= -8i) — combining
    // here is unsound and breaks confluence with the Sqrt(x^3) form.
    const outerIsInteger = b.isInteger === true;
    const baseNonNeg = base.isNonNegative === true;

    if (baseNonNeg || outerIsInteger) {
      return ce._fn('Power', [
        base,
        ce.expr(['Multiply', aPow, b], {
          form: fullyCanonical ? 'canonical' : 'Power',
        }),
      ]);
    }
    // Unsafe to combine — leave as nested Power, fall through
  }

  // (a/b)^{-n} -> a^{-n} / b^{-n} = b^n / a^n
  // Only distribute when exponent is negative to normalize negative exponents on fractions
  // e.g., (a/b)^{-2} -> b^2 / a^2
  if (isFunction(a, 'Divide') && b.isNegative === true) {
    const num = a.op1;
    const denom = a.op2;
    // Only distribute when exponent is integer or both operands are non-negative
    // (distributing non-integer exponents over negative operands changes sign)
    if (
      b.isInteger === true ||
      (num.isNonNegative === true && denom.isNonNegative === true)
    ) {
      return pow(num, b, { numericApproximation: false }).div(
        pow(denom, b, { numericApproximation: false })
      );
    }
  }

  // Handle special base cases that only need sign/infinity info from the
  // exponent, before the numeric-exponent guard below.
  if (isNumber(a) && a.isSame(0) && !b.isSame(0) && !b.isInfinity) {
    // 0^positive = 0, 0^negative = ComplexInfinity
    if (b.isPositive === true) return ce.Zero;
    if (b.isNegative === true) return ce.ComplexInfinity;
  }

  // Onwards, the focus on operations is where is a *numeric* exponent.
  // Therefore, exclude cases - which may otherwise be valid - of the exponent either: being a function (e.g.
  // '0 + 0'), a symbol, or of a non-numeric type.
  //
  // @consider:possible exceptions where function-expressions are reasonable :Rational,Half,
  // Negate... (However, provided that canonicalNumber provided prior, should not be missing anything
  // here)
  if (isFunction(b) || isSymbol(b) || !b.type.matches('number' as Type))
    return unchanged();

  // Zero as base
  if (isNumber(a) && a.isSame(0)) {
    if (b.type.matches('imaginary' as NumericPrimitiveType) || b.isNaN)
      return ce.NaN;

    if (b.isSame(0)) return ce.NaN;

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
    (!isFunction(a) || a.operator === 'Negate');

  // Zero as exponent
  if (b.isSame(0)) {
    // If 'isFinite' is a boolean, then 'a' has a value.
    if (aIsNum && a.isFinite !== undefined) return a.isFinite ? ce.One : ce.NaN;
    return unchanged();
  }

  // One as base
  // (note: 1^∞ = NaN - Because there are various cases where lim(x(t),t)=1, lim(y(t),t)=∞ (or -∞),
  // but lim( x(t)^y(t), t) != 1.)
  if (aIsNum && a.isSame(1)) return b.isFinite ? ce.One : ce.NaN;

  // One as exponent
  // (Permit the base to be a FN-expr. here, too...)
  if (b.isSame(1) && a.type.matches('number' as NumericPrimitiveType)) return a;

  // -1 exponent
  if (b.isSame(-1)) {
    if (aIsNum) {
      // (-∞)^-1 = 0, ∞^-1 = 0  (exclude ~oo)
      if (a.isInfinity && (a.isNegative || a.isPositive)) return ce.Zero;

      // (-1)^-1 = -1
      if (a.isSame(-1)) return ce.NegativeOne;

      // 1^-1 = 1
      if (a.isSame(1)) return ce.One;
    }

    // Matrix inverse: A^{-1} -> Inverse(A)
    if (a.type.matches(new BoxedType('matrix')))
      return ce.function('Inverse', [a]);

    // (note: case of `0^-1 = ~∞` is covered prior...)
    if (!(a.isCanonical || a.isStructural))
      return ce._fn('Power', [a, ce.number(-1)], { canonical: false });
    return a.inv();
  }

  //Infinity exponents
  if (b.isInfinity && aIsNum) {
    // x^oo
    if (b.isPositive) {
      // (note: 0^∞ = 0, 1^∞ = NaN, covered prior)

      // e^∞ = ∞ (handle explicitly before general case)
      if (isSymbol(a, 'ExponentialE')) return ce.PositiveInfinity;

      // (-1)^∞ = NaN
      // Because of oscillations in the limit.
      if (a.isSame(-1)) return ce.NaN;

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
      // e^(-∞) = 0 (handle explicitly before general case)
      if (isSymbol(a, 'ExponentialE')) return ce.Zero;

      if (a.isSame(-1)) return ce.NaN;
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

  //'AnyInfinity^b'
  if (isNumber(a) && a.isInfinity) {
    // Special handling for NegativeInfinity with integer/rational exponents
    if (a.isNegative) {
      // (-inf)^n for negative exponents -> 0
      if (b.isNegative === true) return ce.Zero;

      // (-inf)^n for positive integer n
      if (b.isInteger === true) {
        if (b.isEven === true) return ce.PositiveInfinity; // (-inf)^(even) -> +inf
        if (b.isOdd === true) return ce.NegativeInfinity; // (-inf)^(odd) -> -inf
      }

      // (-inf)^(n/m) for rational n/m
      if (b.isRational === true) {
        const [numExpr, denomExpr] = b.numeratorDenominator;
        const num = numExpr.re;
        const denom = denomExpr.re;

        if (
          typeof num === 'number' &&
          typeof denom === 'number' &&
          Number.isInteger(num) &&
          Number.isInteger(denom)
        ) {
          const numIsEven = num % 2 === 0;
          const numIsOdd = num % 2 !== 0;
          const denomIsOdd = denom % 2 !== 0;

          // n even, m odd -> +inf
          if (numIsEven && denomIsOdd) return ce.PositiveInfinity;

          // n odd, m odd -> -inf (real interpretation)
          if (numIsOdd && denomIsOdd) return ce.NegativeInfinity;
        }
      }
    }

    // PositiveInfinity^b for real b
    if (a.isPositive) {
      if (b.isPositive === true) return ce.PositiveInfinity; // +inf^positive -> +inf
      if (b.isNegative === true) return ce.Zero; // +inf^negative -> 0
    }

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
  if (b.isSame(0.5))
    return a.isCanonical || a.isStructural
      ? canonicalRoot(a, 2)
      : ce._fn('Sqrt', [a], { canonical: false });
  const r = asRational(b);

  //1/3, 1/4...
  if (r !== undefined && r[0] === 1 && r[1] !== 1)
    return a.isCanonical || a.isStructural
      ? canonicalRoot(a, ce.number(r[1]))
      : ce._fn('Root', [a, ce.number(r[1])], { canonical: false });

  // Negative unit fractions: a^{-1/n} -> 1/Root(a, n) (1/Sqrt(a) for n=2).
  // a^{-1/n} = 1/a^{1/n} is exact on the principal branch (no sign info
  // lost — unlike the unsound 1/√u -> √(1/u)), so this is branch-safe.
  // Without it, x^{-1/2} stayed a Power node and did NOT unify with the
  // Divide(1, Sqrt(x)) form that 1/Sqrt(x), Sqrt(x)^{-1} and 1/x^{1/2} all
  // canonicalize to — so e.g. D(arcsin x) = (1-x^2)^{-1/2} would not cancel
  // against the integrand 1/Sqrt(1-x^2), breaking antiderivative checks.
  if (r !== undefined && r[0] === -1 && Math.abs(Number(r[1])) !== 1) {
    const root = canonicalRoot(a, ce.number(Math.abs(Number(r[1]))));
    return a.isCanonical || a.isStructural
      ? ce.function('Divide', [ce.One, root])
      : ce._fn('Divide', [ce.One, root], { canonical: false });
  }

  // Fold exact numeric powers: Power(2, 3) → 8, Power(1/2, 2) → 1/4
  // Only when both base and exponent are exact, and exponent is a real
  // integer (a pure-imaginary exponent like `i` has re = 0, which must NOT
  // fold as a^0)
  if (isNumber(a) && isNumber(b) && b.im === 0) {
    const e = b.re;
    if (typeof e === 'number' && Number.isInteger(e) && Math.abs(e) <= 64) {
      const n = a.numericValue;
      if (typeof n === 'number') {
        const result = Math.pow(n, e);
        if (Number.isSafeInteger(result)) return ce.number(result);
      } else if (n.isExact) {
        return ce.number(n.pow(e));
      }
    }
  }

  return unchanged();
}

export function canonicalRoot(
  a: Expression,
  b: Expression | number
): Expression {
  const ce = a.engine;
  let exp: number | undefined = undefined;
  if (typeof b === 'number') exp = b;
  else {
    if (isNumber(b) && b.im === 0) exp = b.re;
  }

  if (exp === 1) return a;
  if (exp === 2) {
    if (isNumber(a) && a.type.matches('rational')) {
      if (a.re < SMALL_INTEGER) {
        const v = a.sqrt();
        if (isNumber(v)) {
          if (typeof v.numericValue === 'number') return v;
          if (v.numericValue.isExact) return v;
        }
      }
    }
    return ce._fn('Sqrt', [a], { canonical: a.isCanonical || a.isStructural });
  }

  return ce._fn('Root', [a, typeof b === 'number' ? ce.number(b) : b], {
    canonical:
      (a.isCanonical || a.isStructural) &&
      (typeof b === 'number' || b.isCanonical || b.isStructural),
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
  x: Expression,
  exp: number | Expression,
  { numericApproximation }: { numericApproximation: boolean }
): Expression {
  if (
    !(x.isCanonical || x.isStructural) ||
    (typeof exp !== 'number' && !(exp.isCanonical || exp.isStructural))
  )
    return x.engine._fn('Power', [x, x.engine.expr(exp)], { canonical: false });

  //
  // If a numeric approximation is requested, we try to evaluate the expression
  //
  if (numericApproximation) {
    if (isNumber(x)) {
      // e^exp, fast path. Exp(x) canonicalizes to Power(E, x), and under N()
      // the E base is numericized to e *before* reaching pow(). Evaluating
      // e^exp through the generic base.pow(exp) = exp(exp·ln(base)) would
      // recompute ln(e) ≈ 1 — a full high-precision logarithm — on every call,
      // which is the bulk of Exp(x).N()'s cost at high precision. The base is
      // the interned numeric value of the E constant, so an O(1) reference
      // check against the cached `E.N()` detects it; compute exp(exp) directly.
      // Gated to bignum: at machine precision the generic path is a single
      // `Math.pow(e, x)` (no separate ln, so nothing to save) and `exp(x)`
      // would differ by 1 ULP. (A complex exponent falls through to the
      // e^(a+bi) handling below.)
      const ce = x.engine;
      if (bignumPreferred(ce) && x === ce.E.N()) {
        if (typeof exp === 'number')
          return ce.number(ce._numericValue(exp).exp());
        if (isNumber(exp) && exp.im === 0)
          return ce.number(ce._numericValue(exp.numericValue).exp());
      }

      // Negative real base with a non-integer real exponent. `Math.pow` (and
      // the bignum path) return NaN here, so compute the value explicitly. We
      // honor CE's branch conventions: an exact rational p/q with an *odd*
      // denominator uses the real root (e.g. (-8)^{2/3} = 4, (-8)^{5/3} = -32),
      // matching `Root(-8, 3) = -2`; everything else (even denominator, or an
      // inexact exponent) takes the principal complex value, x = |x|·e^{iπ},
      // so (x^e) = |x|^e·e^{iπe} (e.g. (-4)^{3/2} = -8i, consistent with
      // Sqrt(-4) = 2i). Unit fractions never reach here — they canonicalize to
      // Sqrt/Root, which already handle negative radicands.
      {
        const eVal =
          typeof exp === 'number'
            ? exp
            : isNumber(exp) && exp.im === 0
              ? exp.re
              : undefined;
        if (
          x.isNegative === true &&
          x.im === 0 &&
          eVal !== undefined &&
          !Number.isInteger(eVal)
        ) {
          // |x|^e, computed on the positive base (no re-entry: base > 0).
          const absPow = pow(x.neg(), exp, { numericApproximation: true });
          // Recover the exponent's rational p/q. Under .N() the exponent
          // reaches here already numericized to a float, so asRational sees no
          // exact value — reconstruct p/q from the float via continued
          // fractions (faithful for the rationals that produced it).
          const exact = typeof exp === 'number' ? undefined : asRational(exp);
          let p: number | undefined;
          let q: number | undefined;
          if (exact !== undefined) {
            p = Number(exact[0]);
            q = Number(exact[1]);
          } else {
            const rr = rationalize(eVal);
            if (Array.isArray(rr)) [p, q] = rr;
          }
          if (
            q !== undefined &&
            q % 2 !== 0 &&
            Math.abs((p as number) / q - eVal) < 1e-12
          ) {
            // Odd denominator: real root. Sign from the numerator's parity.
            return (p as number) % 2 !== 0 ? absPow.neg() : absPow;
          }
          // Even denominator or inexact exponent: principal complex value.
          const angle = eVal * Math.PI;
          let re = Math.cos(angle);
          let im = Math.sin(angle);
          // Snap the phase's exact zeros (e.g. half-integer e ⇒ ±i) so the
          // result is clean: cos/sin of pπ/q is exactly 0 only at odd
          // multiples of π/2, never merely small for a genuine value.
          if (Math.abs(re) < 1e-12) re = 0;
          if (Math.abs(im) < 1e-12) im = 0;
          return absPow.mul(ce.number(ce.complex(re, im)));
        }
      }

      if (typeof exp === 'number') {
        return (
          apply(
            x,
            (x) => Math.pow(x, exp as number),
            (x) => x.pow(exp as number),
            (x) => x.pow(exp as number)
          ) ?? pow(x, exp, { numericApproximation: false })
        );
      } else if (isNumber(exp))
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
  const canonicalResult = canonicalPower(x, ce.expr(exp));
  if (canonicalResult.operator !== 'Power') return canonicalResult;

  const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

  // @todo: this should be canonicalized to a number, so it should never happen here
  if (isSymbol(x, 'ComplexInfinity')) return ce.NaN;

  if (isSymbol(x, 'ExponentialE')) {
    // e^(ln(y)) = y. (Previously this only reduced because `ln(y)` of a
    // numeric `y` evaluated to a float and `e^float` was computed; now that
    // `ln(2)` stays the exact symbol `Ln(2)`, reduce the inverse pair here.)
    if (typeof exp !== 'number' && isFunction(exp, 'Ln')) return exp.op1;

    // Is the argument an imaginary or complex number?
    let theta = getImaginaryFactor(exp);
    if (theta !== undefined) {
      // We have an expression of the form `e^(i theta)`
      theta = canonicalAngle(theta);
      if (theta !== undefined) {
        // Use Euler's formula: e^{i*theta} = cos(theta) + i*sin(theta)
        // IMPORTANT: Use .evaluate() not .simplify() to avoid infinite
        // recursion when pow() is called from simplification rules.
        // canonicalAngle always returns a numeric angle, so evaluate
        // will compute the trig values directly.
        const cosVal = ce.function('Cos', [theta]).evaluate();
        const sinVal = ce.function('Sin', [theta]).evaluate();
        return cosVal.add(sinVal.mul(ce.I));
        // } else if (theta) {
        //   // Return simplify angle
        //   return ce._fn('Power', [ce.E, radiansToAngle(theta)!.mul(ce.I)]);
      }
    } else if (numericApproximation) {
      // e^x = exp(x): evaluate exp directly. Going through e.pow(x) would
      // compute exp(x·ln(e)) — recomputing ln(e) ≈ 1, a full high-precision
      // logarithm per call. (Real exponents take the direct path; a general
      // complex exponent keeps the e.pow(x) path, unchanged.)
      if (typeof exp === 'number') {
        return ce.number(ce._numericValue(exp).exp());
      } else if (isNumber(exp)) {
        const xv = ce._numericValue(exp.numericValue);
        if (xv.im === 0) return ce.number(xv.exp());
        const eNv = numericValue(ce.E.N());
        if (eNv !== undefined) return ce.number(ce._numericValue(eNv).pow(xv));
      }
    }
  }

  // (a^b)^c -> a^(b*c) only when mathematically safe: base non-negative, or
  // outer exponent c integer. An odd inner exponent is NOT sufficient — see
  // the matching note in canonicalPower for why (principal-branch phase).
  if (isFunction(x, 'Power')) {
    const [base, power] = x.ops;
    const expExpr = typeof exp === 'number' ? ce.number(exp) : exp;
    const outerIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    const baseNonNeg = base.isNonNegative === true;

    if (baseNonNeg || outerIsInteger) {
      return pow(base, power.mul(expExpr), { numericApproximation });
    }
  }

  // (a/b)^c -> a^c / b^c
  // Only distribute when exponent is integer or both operands are non-negative
  if (isFunction(x, 'Divide')) {
    const [num, denom] = x.ops;
    const expIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    if (
      expIsInteger ||
      (num.isNonNegative === true && denom.isNonNegative === true)
    ) {
      return pow(num, exp, { numericApproximation }).div(
        pow(denom, exp, { numericApproximation })
      );
    }
  }

  if (isFunction(x, 'Negate')) {
    // (-x)^n = (-1)^n x^n — only valid when n is integer
    if (e !== undefined && Number.isInteger(e)) {
      if (e % 2 === 0) return pow(x.op1, exp, { numericApproximation });
      return pow(x.op1, exp, { numericApproximation }).neg();
    }
  }

  // (√a)^b -> a^(b/2) or √(a^b)
  if (isFunction(x, 'Sqrt')) {
    // (√a)^2 -> a (integer outer exponent, always safe)
    if (e === 2) return x.op1;
    // (√a)^{2k} -> a^k (even integer outer exponent, always safe)
    if (e !== undefined && e % 2 === 0) return x.op1.pow(e / 2);
    // (√a)^b -> √(a^b) — rearranges (a^{1/2})^b to (a^b)^{1/2},
    // only valid when a >= 0 (negative a changes sign under rearrangement)
    if (x.op1.isNonNegative === true)
      return pow(x.op1, exp, { numericApproximation }).sqrt();
  }

  // exp(a)^b -> e^(a*b)
  if (isFunction(x, 'Exp'))
    return pow(ce.E, x.op1.mul(exp), { numericApproximation });

  // (a*b)^c -> a^c * b^c — only valid when c is integer
  if (isFunction(x, 'Multiply')) {
    const expIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    if (expIsInteger) {
      const ops = x.ops.map((x) => pow(x, exp, { numericApproximation }));
      // return mul(...ops);  // don't call: infinite recursion
      return ce._fn('Multiply', ops);
    }
  }

  // a^(b/c) -> root(a, c)^b if b = 1 or c = 1
  if (typeof exp !== 'number' && isNumber(exp)) {
    const r = asRational(exp);
    if (r !== undefined && r[0] === 1)
      return root(x, ce.number(r[1]), { numericApproximation });
  }

  // (a^(1/b))^c -> a^(c/b) — combines exponents, only safe when
  // base is non-negative or outer exponent c is integer
  if (isFunction(x, 'Root')) {
    const [base, rootIdx] = x.ops;
    const expIsInteger =
      typeof exp === 'number' ? Number.isInteger(exp) : exp.isInteger === true;
    if (base.isNonNegative === true || expIsInteger)
      return pow(base, ce.expr(exp).div(rootIdx), { numericApproximation });
  }

  //
  // We were not requested for a numeric approximation,
  // so we evaluate a numeric expression only if exact
  //
  if (isNumber(x) && Number.isInteger(e)) {
    // x^e: evaluate if e is an integer and x is exact

    const n = x.numericValue;
    if (typeof n === 'number') {
      return (
        apply(
          x,
          (x) => Math.pow(x, e as number),
          (x) => x.pow(e as number),
          (x) => x.pow(e as number)
        ) ?? ce._fn('Power', [x, ce.expr(exp)])
      );
    } else {
      return ce.number(n!.pow(e!));
    }
  }

  // Real base with an exact non-integer rational exponent p/q: reduce via the
  // root, x^{p/q} = root(x, q)^p, but only when root(x, q) is itself an exact
  // value (a perfect power) — otherwise the power stays symbolic (e.g.
  // 2^{2/3}). This extends the unit-fraction reduction (8^{1/3} = 2,
  // (-8)^{1/3} = -2) to non-unit numerators (8^{2/3} = 4, (-8)^{2/3} = 4,
  // (-8)^{5/3} = -32) and agrees with what N() computes. For a negative base
  // only an odd denominator is admitted: an even root is complex (e.g.
  // (-4)^{3/2} = -8i), whose exact value only arises through dusty complex
  // arithmetic, so it is left symbolic here and evaluated by N().
  if (isNumber(x) && x.im === 0 && typeof exp !== 'number' && isNumber(exp)) {
    const r = asRational(exp);
    if (r !== undefined) {
      const p = Number(r[0]);
      const q = Number(r[1]);
      const realRootExists = x.isNegative !== true || q % 2 !== 0;
      if (
        Number.isInteger(p) &&
        Number.isInteger(q) &&
        q > 1 &&
        realRootExists
      ) {
        const rt = root(x, ce.number(q), { numericApproximation: false });
        if (isNumber(rt)) return pow(rt, p, { numericApproximation: false });
      }
    }
  }

  return ce._fn('Power', [x, ce.expr(exp)]);
}

export function root(
  a: Expression,
  b: Expression,
  { numericApproximation }: { numericApproximation: boolean }
): Expression {
  if (!(a.isCanonical || a.isStructural) || !(b.isCanonical || b.isStructural))
    return a.engine._fn('Root', [a, b], { canonical: false });

  if (numericApproximation) {
    if (isNumber(a) && isNumber(b)) {
      // (-x)^n = (-1)^n x^n
      const isNegative = a.isNegative;
      const isEven = b.isEven;
      if (isNegative && isEven) {
        // An even root of a negative real has no real value. Return the
        // complex principal root |a|^(1/n)·(cos(π/n) + i·sin(π/n)) — consistent
        // with `Sqrt(-4).N()` → 2i. (The old code returned the real root of
        // |a|, e.g. `Root(-16, 4).N()` → 2 instead of √2 + √2·i.)
        const n = b.re;
        const mod = Math.pow(-a.re, 1 / n);
        const angle = Math.PI / n;
        return a.engine.number(
          a.engine.complex(mod * Math.cos(angle), mod * Math.sin(angle))
        );
      }
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

  if (isNumber(a) && isNumber(b) && b.isInteger) {
    const e = typeof b === 'number' ? b : b.im === 0 ? b.re : undefined;

    // a^(1/b): evaluate if b is an integer and a is exact

    // @todo the result should always be exact if e is an integer
    if (e !== undefined) {
      if (typeof a.numericValue === 'number') {
        const v = a.engine._numericValue(a.numericValue).root(e);
        if (v?.isExact) return a.engine.number(v);
      } else {
        const v = a.numericValue.asExact?.root(e);
        if (v?.isExact) return a.engine.number(v);
      }
    }
  }

  return a.engine._fn('Root', [a, b]);
}
