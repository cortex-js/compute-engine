import { factorPower, gcd } from './numeric';
import { gcd as bigGcd, factorPower as bigFactorPower } from './numeric-bigint';

/**
 * @category Boxed Expression
 */
export type Rational = [number, number] | [bigint, bigint];

export function isRational(x: any | null): x is Rational {
  return x !== null && Array.isArray(x);
}

export function isMachineRational(x: any | null): x is [number, number] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'number';
}

export function isBigRational(x: any | null): x is [bigint, bigint] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'bigint';
}

export function isZero(x: Rational): boolean {
  // Note '==' to convert bigint to number
  return x[0] == 0;
}

export function isOne(x: Rational): boolean {
  return x[0] === x[1];
}

export function isNegativeOne(x: Rational): boolean {
  return x[0] === -x[1];
}

// True if the denominator is 1
export function isInteger(x: Rational): boolean {
  return x[1] === 1 || x[1] === BigInt(1);
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

function asMachineRational(r: Rational): [number, number] {
  return [Number(r[0]), Number(r[1])];
}

export function pow(r: Rational, exp: number): Rational {
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
  return [
    bigGcd(BigInt(lhs[0]), BigInt(rhs[1])),
    bigGcd(BigInt(lhs[1]), BigInt(rhs[0])),
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

/** Return [factor, root] such that factor * sqrt(root) = sqrt(n)
 * when factor and root are rationals
 */
export function reduceRationalSquareRoot(
  n: Rational
): [factor: Rational, root: number | bigint] {
  if (isBigRational(n)) {
    const [num, den] = n;
    const [nFactor, nRoot] = bigFactorPower(num, 2);
    const [dFactor, dRoot] = bigFactorPower(den, 2);
    return [reducedRational([nFactor, dFactor * dRoot]), nRoot * dRoot];
  }
  const [num, den] = n;
  const [nFactor, nRoot] = factorPower(num, 2);
  const [dFactor, dRoot] = factorPower(den, 2);
  return [reducedRational([nFactor, dFactor * dRoot]), nRoot * dRoot];
}
