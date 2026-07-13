import { canonicalInteger, gcd, lcm } from './numeric.js';
import {
  gcd as bigGcd,
  lcm as bigLcm,
  canonicalInteger as bigCanonicalInteger,
} from './numeric-bigint.js';
import { Rational, SmallInteger } from './types.js';

export function isRational(x: unknown | null): x is Rational {
  return x !== null && Array.isArray(x);
}

export function isMachineRational(
  x: unknown | null
): x is [SmallInteger, SmallInteger] {
  return x !== null && Array.isArray(x) && typeof x[0] === 'number';
}

export function isBigRational(x: unknown | null): x is [bigint, bigint] {
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

  const n =
    (rhsNum[1] as number) * (lhs[0] as number) +
    (rhsNum[0] as number) * (lhs[1] as number);
  const d = (rhsNum[1] as number) * (lhs[1] as number);

  if (n <= 9007199254740991 && n >= -9007199254740991 && d <= 9007199254740991)
    return [n, d];

  // Only map to NaN when an *input* is non-finite (e.g. a `[1, Infinity]`
  // denominator): those cannot be promoted to BigInt (`BigInt(Infinity)`
  // throws). Finite inputs whose machine sum merely overflowed fall through
  // to the exact BigInt promotion below.
  if (
    !Number.isFinite(lhs[0]) ||
    !Number.isFinite(lhs[1]) ||
    !Number.isFinite(rhsNum[0]) ||
    !Number.isFinite(rhsNum[1])
  )
    return [NaN, 1];

  return [
    BigInt(rhsNum[1]) * BigInt(lhs[0]) + BigInt(rhsNum[0]) * BigInt(lhs[1]),
    BigInt(rhsNum[1]) * BigInt(lhs[1]),
  ];
}

export function mul(lhs: Rational, rhs: Rational): Rational {
  // A non-finite machine rational ([NaN, 1] is the NaN encoding, and
  // inverse() can produce [1, NaN]) cannot be promoted to bigint:
  // BigInt(NaN) throws. Propagate NaN instead.
  if (
    isMachineRational(lhs) &&
    (!Number.isFinite(lhs[0]) || !Number.isFinite(lhs[1]))
  )
    return [NaN, 1];
  if (
    isMachineRational(rhs) &&
    (!Number.isFinite(rhs[0]) || !Number.isFinite(rhs[1]))
  )
    return [NaN, 1];

  if (isMachineRational(lhs) && isMachineRational(rhs)) {
    const n = lhs[0] * rhs[0];
    const d = lhs[1] * rhs[1];
    if (
      n <= 9007199254740991 &&
      n >= -9007199254740991 &&
      d <= 9007199254740991
    )
      return [n, d];

    // If we reach here, the machine product overflowed (n or d is non-finite)
    // or exceeded the safe-integer range. The inputs are guaranteed finite
    // (the non-finite guards above already returned), so promoting the finite
    // integer operands to BigInt is exact. (Do NOT map overflow to NaN here:
    // that conflates finite-input overflow with genuinely non-finite inputs.)
    return [BigInt(lhs[0]) * BigInt(rhs[0]), BigInt(lhs[1]) * BigInt(rhs[1])];
  }

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

/**
 * Return `value / denom` as an exact reduced machine rational, or `null` if
 * no exact representation is reachable.
 *
 * `value` may have a short decimal part (e.g. a DMS angle total in seconds
 * with decimal seconds): it is scaled by a power of ten (up to 10^6) until
 * it lands on a safe integer. Returns `null` for dirty floats that never
 * scale to an integer and for magnitudes beyond safe-integer range — callers
 * should then fall back to float arithmetic rather than feed non-integers to
 * `reducedRational()`, which would produce NaN.
 */
export function reducedRationalFromDecimal(
  value: number,
  denom: SmallInteger
): [SmallInteger, SmallInteger] | null {
  if (!Number.isFinite(value)) return null;
  for (let scale = 1; scale <= 1e6; scale *= 10) {
    // Scale from `value` each time (a single rounding) rather than
    // multiplying the previous iterate by 10 (compounding roundings).
    const n = value * scale;
    if (Number.isInteger(n)) {
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(denom * scale))
        return null;
      return reducedRational([n, denom * scale]);
    }
  }
  return null;
}

/** Return a rational approximation of x */
/**
 * Approximate `x` by a rational `[n, d]` via its continued-fraction
 * convergents.
 *
 * With no `tolerance`, expand to full working precision. With a positive
 * `tolerance`, stop at the first convergent that approximates `x` to within it
 * — the rational with the smallest denominator inside the bound
 * (`rationalize(Math.sqrt(3), 1/500)` → `[26, 15]`).
 */
export function rationalize(
  x: number,
  tolerance?: number
): [n: number, d: number] | number {
  if (!Number.isFinite(x)) return x;

  const fractional = x % 1;

  if (fractional === 0) return x;

  const eps = 1.0e-15;
  const tol = tolerance !== undefined && tolerance > 0 ? tolerance : 0;
  const x0 = x;

  let a = Math.floor(x);
  let h1 = 1;
  let k1 = 0;
  let h = a;
  let k = 1;

  if (tol > 0 && Math.abs(h / k - x0) <= tol) return [h, k];

  while (x - a > eps * k * k) {
    x = 1 / (x - a);
    a = Math.floor(x);
    const h2 = h1;
    h1 = h;
    const k2 = k1;
    k1 = k;
    h = h2 + a * h1;
    k = k2 + a * k1;
    if (tol > 0 && Math.abs(h / k - x0) <= tol) return [h, k];
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

/**
 * Return `[factor, radicand]` (both rationals) such that
 *   factor * root(radicand, exponent) = root(n, exponent)
 *
 * Perfect `exponent`-th power factors are extracted from the numerator and
 * denominator of `n` independently, mirroring `reduceRationalSquareRoot` for
 * the general index. The denominator is NOT rationalized: a non-extractable
 * radicand comes back unchanged with `factor = 1`.
 *
 *   reduceRationalRoot(1029/1000, 3) -> [7/10, 3/1]   (1029 = 3·7³, 1000 = 10³)
 *   reduceRationalRoot(1/2, 3)       -> [1/1, 1/2]     (nothing to extract)
 *
 * The factoring effort is bounded by `canonicalInteger`, which declines to
 * factor magnitudes at/above `Number.MAX_SAFE_INTEGER`.
 */
export function reduceRationalRoot(
  n: Rational,
  exponent: number
): [factor: Rational, radicand: Rational] {
  if (isBigRational(n)) {
    const [num, den] = n;
    const [nFactor, nRoot] = bigCanonicalInteger(num, exponent);
    const [dFactor, dRoot] = bigCanonicalInteger(den, exponent);
    return [
      reducedRational([nFactor, dFactor]),
      reducedRational([nRoot, dRoot]),
    ];
  }
  const [num, den] = n;
  const [nFactor, nRoot] = canonicalInteger(num, exponent);
  const [dFactor, dRoot] = canonicalInteger(den, exponent);
  return [reducedRational([nFactor, dFactor]), reducedRational([nRoot, dRoot])];
}
