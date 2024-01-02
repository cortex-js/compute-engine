import { Complex } from 'complex.js';
import { Decimal } from 'decimal.js';

import { BoxedExpression, Rational } from '../public';

import { factorPower, gcd } from './numeric';
import {
  bigint,
  gcd as bigGcd,
  factorPower as bigFactorPower,
} from './numeric-bigint';

export function isRational(x: any | null): x is Rational {
  return x !== null && Array.isArray(x);
}

export function isMachineRational(x: any | null): x is [number, number] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'number';
}

export function isBigRational(x: any | null): x is [bigint, bigint] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'bigint';
}

export function isRationalZero(x: Rational): boolean {
  // Note '==' to convert bigint to number
  return x[0] == 0;
}

export function isRationalOne(x: Rational): boolean {
  return x[0] === x[1];
}

// True if the denominator is 1
export function isRationalInteger(x: Rational): boolean {
  return x[1] === 1 || x[1] === BigInt(1);
}

export function isRationalNegativeOne(x: Rational): boolean {
  return x[0] === -x[1];
}

export function machineNumerator(x: Rational): number {
  return Number(x[0]);
}

export function machineDenominator(x: Rational): number {
  return Number(x[1]);
}

export function isNeg(x: Rational): boolean {
  return x[0] < 0;
}

export function neg(x: [number, number]): [number, number];
export function neg(x: [bigint, bigint]): [bigint, bigint];
export function neg(x: Rational): Rational;
export function neg(x: Rational): Rational {
  return [-x[0], x[1]] as Rational;
}

export function inverse(x: [number, number]): [number, number];
export function inverse(x: [bigint, bigint]): [bigint, bigint];
export function inverse(x: Rational): Rational;
export function inverse(x: Rational): Rational {
  return (x[0] < 0 ? [-x[1], -x[0]] : [x[1], x[0]]) as Rational;
}

export function asRational(expr: BoxedExpression): Rational | undefined {
  const num = expr.numericValue;
  if (Array.isArray(num)) return num;
  if (num === null) return undefined;
  if (typeof num === 'number' && Number.isInteger(num)) {
    if (num > 1e9 || num < -1e9) return [bigint(num), BigInt(1)];
    return [num, 1];
  }
  if (num instanceof Decimal && num.isInteger())
    return [bigint(num), BigInt(1)];
  return undefined;
}

function asMachineRational(r: Rational): [number, number] {
  return [Number(r[0]), Number(r[1])];
}

/**
 * Add a literal numeric value to a rational.
 * If the rational is a bigint, this is a hint to do the calculation in bigint
 * (no need to check `bignumPreferred()`).
 * @param lhs
 * @param rhs
 * @returns
 */
export function add(lhs: Rational, rhs: BoxedExpression | Rational): Rational {
  console.assert(
    Array.isArray(rhs) ||
      (rhs.numericValue !== null && !(rhs.numericValue instanceof Complex))
  );
  // If the lhs is infinity (or NaN) return as is
  // (note that bigint cannot be infinite)
  if (typeof lhs[0] === 'number' && !Number.isFinite(lhs[0])) return lhs;

  const rhsNum = Array.isArray(rhs) ? rhs : rhs.numericValue;

  if (rhsNum === null) return lhs;

  if (Array.isArray(rhsNum)) {
    if (isBigRational(rhsNum)) {
      lhs = [BigInt(lhs[0]), BigInt(lhs[1])];
      return [rhsNum[1] * lhs[0] + rhsNum[0] * lhs[1], rhsNum[1] * lhs[1]];
    }
    if (!Number.isFinite(rhsNum[0])) return rhsNum;
    if (isBigRational(lhs)) {
      const bigRhs = [BigInt(rhsNum[0]), BigInt(rhsNum[1])];
      return [bigRhs[1] * lhs[0] + bigRhs[0] * lhs[1], bigRhs[1] * lhs[1]];
    }
    return [rhsNum[1] * lhs[0] + rhsNum[0] * lhs[1], rhsNum[1] * lhs[1]];
  }

  if (rhsNum instanceof Decimal) {
    if (rhsNum.isNaN()) return [Number.NaN, 1];
    if (!rhsNum.isFinite())
      return [rhsNum.isNegative() ? -Infinity : Infinity, 1];

    console.assert(rhsNum.isInteger());

    if (isMachineRational(lhs)) lhs = [BigInt(lhs[0]), BigInt(lhs[1])];
    // Decimal and Rational return a bigRational
    return [lhs[0] + lhs[1] * bigint(rhsNum.toString()), lhs[1]];
  }

  // Can't add a complex to a rational
  if (rhsNum instanceof Complex) return [Number.NaN, 1];

  console.assert(!Number.isFinite(rhsNum) || Number.isInteger(rhsNum));

  if (!Number.isFinite(rhsNum)) return [rhsNum, 1];

  if (isMachineRational(lhs)) return [lhs[0] + lhs[1] * rhsNum, lhs[1]];

  // By this point, lhs is a bigRational, rhsNum is a number
  return [lhs[0] + lhs[1] * bigint(rhsNum), lhs[1]];
}

export function mul(lhs: Rational, rhs: BoxedExpression | Rational): Rational {
  console.assert(
    Array.isArray(rhs) ||
      (rhs.numericValue !== null && !(rhs instanceof Complex))
  );

  if (Array.isArray(rhs)) {
    if (isMachineRational(lhs) && isMachineRational(rhs))
      return [lhs[0] * rhs[0], lhs[1] * rhs[1]];
    if (isMachineRational(lhs)) lhs = [bigint(lhs[0]), bigint(lhs[1])];
    if (isMachineRational(rhs)) rhs = [bigint(rhs[0]), bigint(rhs[1])];
    return [lhs[0] * rhs[0], lhs[1] * rhs[1]];
  }

  const rhsNum = rhs.numericValue;
  if (rhsNum !== null && typeof rhsNum === 'number') {
    console.assert(Number.isInteger(rhsNum));
    if (isMachineRational(lhs)) return [lhs[0] * rhsNum, lhs[1]];
    return [lhs[0] * bigint(rhsNum), lhs[1]];
  }

  if (rhsNum instanceof Decimal) {
    console.assert(rhsNum.isInteger());
    if (isMachineRational(lhs))
      return [bigint(rhsNum.toString()) * bigint(lhs[0]), bigint(lhs[1])];
    return [bigint(rhsNum.toString()) * lhs[0], lhs[1]];
  }

  if (Array.isArray(rhsNum)) {
    if (isBigRational(rhsNum))
      return [rhsNum[0] * bigint(lhs[0]), rhsNum[1] * bigint(lhs[1])];
    else if (isMachineRational(lhs))
      return [lhs[0] * rhsNum[0], lhs[1] * rhsNum[1]];

    return [lhs[0] * bigint(rhsNum[0]), lhs[1] * bigint(rhsNum[1])];
  }

  // If we've reached this point, rhsNum is a Complex
  debugger;
  return lhs;
}

export function div(lhs: Rational, rhs: Rational): Rational {
  return mul(lhs, inverse(rhs));
}

export function pow(r: Rational, exp: number): Rational {
  console.assert(Number.isInteger(exp));
  if (exp === 0) return [1, 1];
  if (exp < 0) {
    r = inverse(r);
    exp = -exp;
  }
  if (exp === 1) return r;

  if (isMachineRational(r)) return [Math.pow(r[0], exp), Math.pow(r[1], exp)];
  const bigexp = bigint(exp);
  return [r[0] ** bigexp, r[1] ** bigexp];
}

export function sqrt(r: Rational): Rational | undefined {
  const num = Math.sqrt(Number(r[0]));
  const den = Math.sqrt(Number(r[1]));
  if (Number.isInteger(num) && Number.isInteger(den)) return [num, den];

  return undefined;
}

// export function rationalGcd(lhs: Rational, rhs: Rational): Rational {
//   return [gcd(lhs[0] * rhs[1], lhs[1] * rhs[0]), lhs[1] * rhs[1]] as Rational;
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
export function reducedRational(r: [bigint, bigint]): [bigint, bigint];
export function reducedRational(r: Rational): Rational;
export function reducedRational(r: Rational): Rational {
  if (isMachineRational(r)) {
    if (r[0] === 1 || r[1] === 1) return r;
    if (r[1] < 0) r = [-r[0], -r[1]];
    if (!Number.isFinite(r[1])) return [0, 1];
    const g = gcd(r[0], r[1]);
    //  If the gcd is 0, return the rational unchanged
    return g <= 1 ? r : [r[0] / g, r[1] / g];
  }

  if (r[0] === BigInt(1) || r[1] === BigInt(1)) return r;
  if (r[1] < 0) r = [-r[0], -r[1]];
  const g = bigGcd(r[0], r[1]);
  //  If the gcd is 0, return the rational unchanged
  if (g <= 1) return r;
  return [r[0] / g, r[1] / g];
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

/** Return [factor, root] such that factor * sqrt(root) = n
 * when factor and root are rationals
 */
export function reduceRationalSquareRoot(
  n: Rational
): [factor: Rational, root: Rational] {
  if (isBigRational(n)) {
    const [num, den] = n;
    const [nFactor, nRoot] = bigFactorPower(num, 2);
    const [dFactor, dRoot] = bigFactorPower(den, 2);
    return [
      reducedRational([nFactor, dFactor]),
      reducedRational([nRoot, dRoot]),
    ];
  }
  const [num, den] = n;
  const [nFactor, nRoot] = factorPower(num, 2);
  const [dFactor, dRoot] = factorPower(den, 2);
  return [reducedRational([nFactor, dFactor]), reducedRational([nRoot, dRoot])];
}
