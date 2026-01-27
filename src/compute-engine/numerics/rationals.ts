import { canonicalInteger, gcd, lcm } from './numeric';
import {
  gcd as bigGcd,
  lcm as bigLcm,
  canonicalInteger as bigCanonicalInteger,
} from './numeric-bigint';
import { Rational, SmallInteger } from './types';

export function isRational(x: any | null): x is Rational {
  return x !== null && Array.isArray(x);
}

export function isMachineRational(
  x: any | null
): x is [SmallInteger, SmallInteger] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'number';
}

export function isBigRational(x: any | null): x is [bigint, bigint] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'bigint';
}

export function isZero(x: Rational): boolean {
  // Note '==' to convert bigint to number
  return x[0] == 0;
}

export function isPositive(x: Rational): boolean {
  return x[0] > 0;
}

export function isOne(x: Rational): boolean {
  return x[0] == x[1];
}

export function isNegativeOne(x: Rational): boolean {
  return x[0] === -x[1];
}

// True if the denominator is 1
export function isInteger(x: Rational): boolean {
  // Note '==' to convert bigint to number
  return x[1] == 1;
}

export function machineNumerator(x: Rational): number {
  return Number(x[0]);
}

export function machineDenominator(x: Rational): number {
  return Number(x[1]);
}

export function rationalAsFloat(x: Rational): number {
  return Number(x[0]) / Number(x[1]);
}

export function isNeg(x: Rational): boolean {
  return x[0] < 0;
}

export function div(lhs: Rational, rhs: Rational): Rational {
  return mul(lhs, inverse(rhs));
}

/**
 * Add a literal numeric value to a rational.
 * If the rational is a bigint, this is a hint to do the calculation in bigint
 * (no need to check `bignumPreferred()`).
 * @param lhs
 * @param rhs
 * @returns
 */
export function add(lhs: Rational, rhs: Rational): Rational {
  if (typeof lhs[0] === 'number' && !Number.isFinite(lhs[0])) return lhs;

  const rhsNum = rhs;

  if (rhsNum === null) return lhs;

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

export function mul(lhs: Rational, rhs: Rational): Rational {
  if (isMachineRational(lhs) && isMachineRational(rhs))
    return [lhs[0] * rhs[0], lhs[1] * rhs[1]];
  if (isMachineRational(lhs))
    return [
      BigInt(lhs[0]) * (rhs[0] as bigint),
      BigInt(lhs[1]) * (rhs[1] as bigint),
    ];
  if (isMachineRational(rhs))
    return [
      BigInt(rhs[0]) * (lhs[0] as bigint),
      BigInt(rhs[1]) * (lhs[1] as bigint),
    ];
  return [lhs[0] * rhs[0], lhs[1] * rhs[1]];
}

export function neg(
  x: [SmallInteger, SmallInteger]
): [SmallInteger, SmallInteger];
export function neg(x: [bigint, bigint]): [bigint, bigint];
export function neg(x: Rational): Rational;
export function neg(x: Rational): Rational {
  return [-x[0], x[1]] as Rational;
}

export function inverse(
  x: [SmallInteger, SmallInteger]
): [SmallInteger, SmallInteger];
export function inverse(x: [bigint, bigint]): [bigint, bigint];
export function inverse(x: Rational): Rational;
export function inverse(x: Rational): Rational {
  return (x[0] < 0 ? [-x[1], -x[0]] : [x[1], x[0]]) as Rational;
}

export function asMachineRational(r: Rational): [SmallInteger, SmallInteger] {
  return [Number(r[0]), Number(r[1])];
}

export function pow(r: Rational, exp: SmallInteger): Rational {
  console.assert(Number.isInteger(exp));
  if (exp === 0) return [1, 1];
  if (exp < 0) {
    r = inverse(r);
    exp = -exp;
  }
  if (exp === 1) return r;

  // Always use bigint to calculate powers. Avoids underflow/overflow.

  const bigexp = BigInt(exp);
  return [BigInt(r[0]) ** bigexp, BigInt(r[1]) ** bigexp];
}

export function sqrt(r: Rational): Rational | undefined {
  const num = Math.sqrt(Number(r[0]));
  const den = Math.sqrt(Number(r[1]));
  if (Number.isInteger(num) && Number.isInteger(den)) return [num, den];

  return undefined;
}

export function rationalGcd(lhs: Rational, rhs: Rational): Rational {
  if (isMachineRational(lhs) && isMachineRational(rhs)) {
    if (lhs[1] === 1 && rhs[1] === 1) return [gcd(lhs[0], rhs[0]), 1];
    return [gcd(lhs[0], rhs[0]), lcm(lhs[1], rhs[1])];
  }

  if (lhs[1] === 1 && rhs[1] === 1)
    return [bigGcd(BigInt(lhs[0]), BigInt(rhs[0])), BigInt(1)];

  return [
    bigGcd(BigInt(lhs[0]), BigInt(rhs[0])),
    bigLcm(BigInt(lhs[1]), BigInt(rhs[1])),
  ] as Rational;
}

// export function rationalLcm(
//   [a, b]: [number, number],
//   [c, d]: [number, number]
// ): [number, number] {
//   return [lcm(a, c), gcd(b, d)];
// }

//  Return the "reduced form" of the rational, that is a rational
// such that gcd(numer, denom) = 1 and denom > 0
export function reducedRational(
  r: [SmallInteger, SmallInteger]
): [SmallInteger, SmallInteger];
export function reducedRational(r: [bigint, bigint]): [bigint, bigint];
export function reducedRational(r: Rational): Rational;
export function reducedRational(r: Rational): Rational {
  if (isMachineRational(r)) {
    // Normalize negative denominator first (before early return)
    if (r[1] < 0) r = [-r[0], -r[1]];
    if (r[0] === 1 || r[1] === 1) return r;
    if (!Number.isFinite(r[1])) return [0, 1];
    const g = gcd(r[0], r[1]);
    //  If the gcd is 0, return the rational unchanged
    return g <= 1 ? r : [r[0] / g, r[1] / g];
  }

  if (r[1] < 0) r = [-r[0], -r[1]];

  const g = bigGcd(r[0], r[1]);

  //  If the gcd is 0, return the rational unchanged
  const [n, d] = g <= 1 ? r : [r[0] / g, r[1] / g];

  if (
    n <= Number.MAX_SAFE_INTEGER &&
    n >= Number.MIN_SAFE_INTEGER &&
    d <= Number.MAX_SAFE_INTEGER
  )
    return [Number(n), Number(d)];
  return [n, d];
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

/** Return [factor, root] such that factor * sqrt(root) = sqrt(n)
 * when factor and root are rationals
 */
export function reduceRationalSquareRoot(
  n: Rational
): [factor: Rational, root: number | bigint] {
  if (isBigRational(n)) {
    const [num, den] = n;
    const [nFactor, nRoot] = bigCanonicalInteger(num, 2);
    const [dFactor, dRoot] = bigCanonicalInteger(den, 2);
    return [reducedRational([nFactor, dFactor * dRoot]), nRoot * dRoot];
  }
  const [num, den] = n;
  const [nFactor, nRoot] = canonicalInteger(num, 2);
  const [dFactor, dRoot] = canonicalInteger(den, 2);
  return [reducedRational([nFactor, dFactor * dRoot]), nRoot * dRoot];
}
