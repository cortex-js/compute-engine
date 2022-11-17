import { BoxedExpression, Rational } from '../public';

import Decimal from 'decimal.js';
import { asSmallInteger, chop, factorPower, gcd } from './numeric';
import { gcd as bigGcd, isInMachineRange } from './numeric-bignum';
import Complex from 'complex.js';

export function isRational(x: any | null): x is Rational {
  return x !== null && Array.isArray(x);
}

export function isMachineRational(x: any | null): x is [number, number] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'number';
}

export function isBigRational(x: any | null): x is [Decimal, Decimal] {
  return x !== null && Array.isArray(x) && x[0] instanceof Decimal;
}

export function isRationalZero(x: Rational): boolean {
  if (x[0] === 0) return true;
  return x[0] instanceof Decimal && x[0].isZero();
}

export function isRationalOne(x: Rational): boolean {
  if (x[0] === x[1]) return true;
  if (typeof x[0] === 'number') return false;
  return x[0].eq(x[1]);
}

export function isRationalNegativeOne(x: Rational): boolean {
  if (typeof x[0] === 'number') return x[0] === -x[1];
  return x[0].eq((x[1] as Decimal).neg());
}

export function machineNumerator(x: Rational): number {
  return typeof x[0] === 'number' ? x[0] : x[0].toNumber();
}

export function machineDenominator(x: Rational): number {
  return typeof x[1] === 'number' ? x[1] : x[1].toNumber();
}

export function isNeg(lhs: Rational): boolean {
  if (isMachineRational(lhs)) return lhs[0] < 0;
  return lhs[0].isNeg();
}

export function neg(lhs: [number, number]): [number, number];
export function neg(lhs: [Decimal, Decimal]): [Decimal, Decimal];
export function neg(lhs: Rational): Rational;
export function neg(lhs: Rational): Rational {
  if (isMachineRational(lhs)) return [-lhs[0], lhs[1]];
  return [lhs[0].neg(), lhs[1]];
}

export function inverse(lhs: [number, number]): [number, number];
export function inverse(lhs: [Decimal, Decimal]): [Decimal, Decimal];
export function inverse(lhs: Rational): Rational;
export function inverse(lhs: Rational): Rational {
  if (isMachineRational(lhs))
    return lhs[0] < 0 ? [-lhs[1], -lhs[0]] : [lhs[1], lhs[0]];
  return lhs[0].isNeg() ? [lhs[1].neg(), lhs[0].neg()] : [lhs[1], lhs[0]];
}

export function asRational(expr: BoxedExpression): Rational | undefined {
  const num = expr.numericValue;
  if (num === null) return undefined;
  if (Array.isArray(num)) return num;
  if (typeof num === 'number' && Number.isInteger(num)) return [num, 1];
  if (num instanceof Decimal && num.isInteger())
    return [num, expr.engine._BIGNUM_ONE];
  return undefined;
}

export function asMachineRational(r: Rational): [number, number] {
  if (isMachineRational(r)) return r;
  return [r[0].toNumber(), r[1].toNumber()];
}

/**
 * Add a literal numeric value to a rational.
 * If the rational is a bignum, this is a hint to do the calculation in bignum
 * (no need to check `bignumPreferred()`).
 * @param lhs
 * @param rhs
 * @returns
 */
export function add(lhs: Rational, rhs: BoxedExpression | Rational): Rational {
  console.assert(
    Array.isArray(rhs) ||
      (rhs.numericValue !== null && !(rhs instanceof Complex))
  );

  if (Array.isArray(rhs)) {
    if (isBigRational(rhs))
      return [rhs[1].mul(lhs[0]).add(rhs[0].mul(lhs[1])), rhs[1].mul(lhs[1])];
    if (isBigRational(lhs))
      return [lhs[0].mul(rhs[1]).add(lhs[1].mul(rhs[0])), lhs[1].mul(rhs[1])];
    return [rhs[1] * lhs[0] + rhs[0] * lhs[1], rhs[1] * lhs[1]];
  }

  const rhsNum = rhs.numericValue;
  if (rhsNum !== null && typeof rhsNum === 'number') {
    if (isMachineRational(lhs)) return [lhs[0] + lhs[1] * rhsNum, lhs[1]];
    return [lhs[0].add(lhs[1].mul(rhsNum)), lhs[1]];
  }

  if (rhsNum instanceof Decimal) {
    if (isMachineRational(lhs)) {
      const ce = rhs.engine;
      return [ce.bignum(rhsNum.mul(lhs[1]).add(lhs[0])), ce.bignum(lhs[1])];
    }
    return [lhs[0].add(lhs[1].mul(rhsNum)), lhs[1]];
  }

  if (Array.isArray(rhsNum)) {
    if (isBigRational(rhsNum))
      return [
        rhsNum[1].mul(lhs[0]).add(rhsNum[0].mul(lhs[1])),
        rhsNum[1].mul(lhs[1]),
      ];
    if (isBigRational(lhs))
      return [
        lhs[0].mul(rhsNum[1]).add(lhs[1].mul(rhsNum[0])),
        lhs[1].mul(rhsNum[1]),
      ];
    return [rhsNum[1] * lhs[0] + rhsNum[0] * lhs[1], rhsNum[1] * lhs[1]];
  }
  debugger;
  return lhs;
}

export function mul(lhs: Rational, rhs: BoxedExpression | Rational): Rational {
  console.assert(
    Array.isArray(rhs) ||
      (rhs.numericValue !== null && !(rhs instanceof Complex))
  );

  if (Array.isArray(rhs)) {
    if (isBigRational(lhs)) return [lhs[0].mul(rhs[0]), lhs[1].mul(rhs[1])];
    if (isBigRational(rhs)) return [rhs[0].mul(lhs[0]), rhs[1].mul(lhs[1])];
    return [rhs[0] * lhs[0], rhs[1] * lhs[1]];
  }

  const rhsNum = rhs.numericValue;
  if (rhsNum !== null && typeof rhsNum === 'number') {
    if (isMachineRational(lhs)) return [lhs[0] * rhsNum, lhs[1]];
    return [lhs[0].mul(rhsNum), lhs[1]];
  }

  if (rhsNum instanceof Decimal) {
    if (isMachineRational(lhs))
      return [rhsNum.mul(lhs[0]), rhs.engine.bignum(lhs[1])];
    return [rhsNum.mul(lhs[0]), lhs[1]];
  }

  if (Array.isArray(rhsNum)) {
    if (isBigRational(rhsNum))
      return [rhsNum[0].mul(lhs[0]), rhsNum[1].mul(lhs[1])];
    else if (isMachineRational(lhs))
      return [lhs[0] * rhsNum[0], lhs[1] * rhsNum[1]];
    return [lhs[0].mul(rhsNum[0]), lhs[1].mul(rhsNum[1])];
  }

  debugger;
  return lhs;
}

export function pow(r: Rational, exp: number): Rational {
  console.assert(Number.isInteger(exp));
  if (exp < 0) {
    r = inverse(r);
    exp = -exp;
  }
  if (exp === 0) return [1, 1];
  if (exp === 1) return r;

  if (isMachineRational(r)) return [Math.pow(r[0], exp), Math.pow(r[1], exp)];
  return [r[0].pow(exp), r[1].pow(exp)];
}

// export function rationalGcd(lhs: Rational, rhs: Rational): [number, number] {
//   return [gcd(a * d, b * c), b * d];
// }

// export function rationalLcm(
//   [a, b]: [number, number],
//   [c, d]: [number, number]
// ): [number, number] {
//   return [lcm(a, c), gcd(b, d)];
// }

//  Return the "reduced form" of the rational, that is a rational
// such that gcd(numer, denom) = 1 and denom > 0
export function reducedRational(r: [number, number]): [number, number];
export function reducedRational(r: [Decimal, Decimal]): [Decimal, Decimal];
export function reducedRational(r: Rational): Rational;
export function reducedRational(r: Rational): Rational {
  if (isMachineRational(r)) {
    if (r[0] === 1 || r[1] === 1) return r;
    if (r[1] < 0) r = [-r[0], -r[1]];
    const g = gcd(r[0], r[1]);
    //  If the gcd is 0, return the rational unchanged
    return g <= 1 ? r : [r[0] / g, r[1] / g];
  }

  if (r[0].equals(1) || r[1].equals(1)) return r;
  if (r[1].isNegative()) r = [r[0].neg(), r[1].neg()];
  const g = bigGcd(r[0], r[1]);
  //  If the gcd is 0, return the rational unchanged
  if (g.lessThanOrEqualTo(1)) return r;
  return [r[0].div(g), r[1].div(g)];
}

/** Return a rational approximation of x */
export function rationalize(x: number): [n: number, d: number] | number {
  if (!Number.isFinite(x)) return x;

  const fractional = x % 1;

  if (fractional === 0) return x;

  // const real = x - fractional;
  // const exponent = String(fractional).length - 2; // Number of fractional digits
  // const denominator = Math.pow(10, exponent);
  // const mantissa = fractional * denominator;
  // const numerator = real * denominator + mantissa;
  // const g = gcd(numerator, denominator);
  // return [numerator / g, denominator / g];

  const eps = 1.0e-15;

  let a = Math.floor(x);
  let h1 = 1;
  let k1 = 0;
  let h = a;
  let k = 1;

  while (x - a > eps * k * k) {
    x = 1 / (x - a);
    a = Math.floor(x);
    const h2 = h1;
    h1 = h;
    const k2 = k1;
    k1 = k;
    h = h2 + a * h1;
    k = k2 + a * k1;
  }

  return [h, k];
}

// export function asRationalRoot(
//   expr: BoxedExpression
// ): [numer: number, denom: number] | null {
//   if (expr.head !== 'Sqrt' || !expr.op1.isLiteral) return null;
//   return expr.asRational;
// }

// export function asBigRationalRoot(
//   expr: BoxedExpression
// ): [numer: Decimal, denom: Decimal] | null {
//   if (expr.head !== 'Sqrt' || !expr.op1.isLiteral) return null;
//   return expr.asBigRational;
// }

/**
 * Attempt to factor a rational coefficient `c` and a `rest` out of a
 * canonical expression `expr` such that `ce.mul(c, rest)` is equal to `expr`.
 *
 * Attempts to make `rest` a positive value (i.e. pulls out negative sign).
 *
 *
 * ['Multiply', 2, 'x', 3, 'a', ['Sqrt', 5]]
 *    -> [[6, 1], ['Multiply', 'x', 'a', ['Sqrt', 5]]]
 *
 * ['Divide', ['Multiply', 2, 'x'], ['Multiply', 3, 'y', 'a']]
 *    -> [[2, 3], ['Divide', 'x', ['Multiply, 'y', 'a']]]
 */
export function asCoefficient(
  expr: BoxedExpression
): [coef: Rational, rest: BoxedExpression] {
  console.assert(expr.isCanonical);

  const ce = expr.engine;

  //
  // Multiply
  //
  if (expr.head === 'Multiply') {
    const rest: BoxedExpression[] = [];
    let coef: Rational = [1, 1];
    for (const arg of expr.ops!) {
      // Only consider the value of literals
      const n = arg.numericValue;
      if (n === null || n instanceof Complex) rest.push(arg);
      else coef = mul(coef, arg);
    }

    coef = reducedRational(coef);

    if (isRationalOne(coef)) return [[1, 1], expr];
    if (rest.length === 0) return [coef, ce._ONE];
    if (rest.length === 1) return [coef, rest[0]];
    return [coef, ce.mul(rest)];
  }

  //
  // Divide
  //
  if (expr.head === 'Divide') {
    // eslint-disable-next-line prefer-const
    let [coef1, numer] = asCoefficient(expr.op1);
    const [coef2, denom] = asCoefficient(expr.op2);

    const coef = reducedRational(mul(coef1, inverse(coef2)));

    if (numer.isOne && denom.isOne) return [coef, ce._ONE];
    if (denom.isOne) return [coef, numer];
    return [coef, ce.fn('Divide', [numer, denom])];
  }

  //
  // Power
  //
  if (expr.head === 'Power') {
    // We can only extract a coef if the exponent is a literal
    if (expr.op2.numericValue === null) return [[1, 1], expr];

    // eslint-disable-next-line prefer-const
    let [coef, base] = asCoefficient(expr.op1);
    if (isRationalOne(coef)) return [[1, 1], expr];

    const exponent = expr.op2;

    const e = asSmallInteger(exponent);
    if (e === -1) return [inverse(coef), ce.inverse(base)];
    if (e !== null) return [pow(coef, e), ce.power(base, exponent)];

    // The exponent might be a rational (square root, cubic root...)
    if (
      exponent.numericValue !== null &&
      Array.isArray(exponent.numericValue)
    ) {
      const [en, ed] = asMachineRational(exponent.numericValue);
      const [numer, denom] = asMachineRational(coef);
      if (numer > 0 && Math.abs(en) === 1) {
        const [nCoef, nRest] = factorPower(numer, ed);
        const [dCoef, dRest] = factorPower(denom, ed);
        if (nCoef === 1 && dCoef === 1) return [[1, 1], expr];
        // en = -1 -> inverse the extracted coef
        return [
          en === 1 ? [nCoef, dCoef] : [dCoef, nCoef],
          ce.power(ce.mul([ce.number([nRest, dRest]), base]), exponent),
        ];
      }
    }

    return [[1, 1], expr];
  }

  //
  // Negate
  //
  if (expr.head === 'Negate') {
    const [coef, rest] = asCoefficient(expr.op1);
    return [neg(coef), rest];
  }

  // @todo:  could consider others.. `Ln`, `Abs`, trig functions

  //
  // Literal
  //
  const n = expr.numericValue;
  if (n !== null) {
    if (n instanceof Decimal) {
      if (n.isInteger() && isInMachineRange(n))
        return [[n.toNumber(), 1], ce._ONE];
      if (n.isNegative()) return [[-1, 1], ce.number(n.neg())];
    }

    if (typeof n === 'number') {
      if (Number.isInteger(n)) return [[n, 1], ce._ONE];
      if (n < 0) return [[-1, 1], ce.number(-n)];
    }

    if (Array.isArray(n)) return [n, ce._ONE];

    // Make the part positive if the real part is negative
    if (n instanceof Complex && n.re < 0)
      return [[-1, 1], ce.number(ce.complex(-n.re, -n.im))];
  }

  return [[1, 1], expr];
}

/**
 *
 * @param lhs
 * @param rhs
 * @returns the sign (-1, 0, 1) of the difference between `lhs` and `rhs`
 */
export function signDiff(
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  tolerance?: number
): -1 | 0 | 1 | undefined {
  if (lhs === rhs) return 0;

  const lhsN = lhs.N();
  const rhsN = rhs.N();

  const lhsNum = lhsN.numericValue;
  const rhsNum = rhsN.numericValue;

  if (lhsNum === null || rhsNum === null) {
    // Couldn't calculate a numeric value, use the `sgn`
    const lhsS = lhs.sgn;
    const rhsS = rhs.sgn;
    if (typeof lhsS !== 'number' || typeof rhsS !== 'number') return undefined;
    if (lhsS === 0 && rhsS === 0) return 0;
    if (lhsS < 0 && rhsS > 0) return -1;
    if (lhsS > 0 && rhsS < 0) return +1;
    return undefined;
  }

  tolerance ??= lhs.engine.tolerance;

  if (lhsNum instanceof Complex && rhsNum instanceof Complex)
    return chop(lhsNum.re - rhsNum.re, tolerance) === 0 &&
      chop(lhsNum.im - rhsNum.im, tolerance) === 0
      ? 0
      : undefined;

  if (lhsNum instanceof Complex || rhsNum instanceof Complex) return undefined;

  // In general, it is impossible to always prove equality
  // (Richardson's theorem) but this works often...

  const rhsR = asRational(rhsN);
  if (!rhsR) return undefined;
  const diff = add(neg(rhsR), lhsN);
  const delta = isMachineRational(diff)
    ? chop(diff[0] / diff[1], tolerance)
    : chop(diff[0].div(diff[1]), tolerance);

  if (delta === 0) return 0;
  if (typeof delta === 'number') return delta > 0 ? 1 : -1;
  return delta.isPos() ? 1 : -1;
}
