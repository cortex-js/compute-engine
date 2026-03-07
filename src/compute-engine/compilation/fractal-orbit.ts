import { BigDecimal } from '../../big-decimal';
import type { HighPrecisionCoord } from './types';

/** Convert a HighPrecisionCoord to BigDecimal. */
function toBigDecimal(v: HighPrecisionCoord): BigDecimal {
  if (typeof v === 'object' && 'hi' in v)
    return new BigDecimal(v.hi).add(new BigDecimal(v.lo));
  return new BigDecimal(v);
}

/**
 * Convert a HighPrecisionCoord to a float64 number.
 * Used for uniform values where float64 precision is sufficient.
 */
export function hpToNumber(v: HighPrecisionCoord): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return v.hi + v.lo;
}

/**
 * Compute a Mandelbrot reference orbit at arbitrary precision.
 *
 * Iterates z -> z^2 + c starting from z = 0, using BigDecimal arithmetic
 * at the specified precision (decimal digits). Stops early if |z|^2 > 256
 * (well past the escape radius of 2, giving a margin for perturbation).
 *
 * @param center - Reference point [re, im] with extended precision
 * @param maxIter - Maximum number of iterations
 * @param precision - BigDecimal working precision (decimal digits)
 * @returns Float32Array of [re0, im0, re1, im1, ...] orbit points
 */
export function computeReferenceOrbit(
  center: [HighPrecisionCoord, HighPrecisionCoord],
  maxIter: number,
  precision: number
): Float32Array {
  const prevPrecision = BigDecimal.precision;
  BigDecimal.precision = precision;

  try {
    const cr = toBigDecimal(center[0]);
    const ci = toBigDecimal(center[1]);
    let zr = BigDecimal.ZERO;
    let zi = BigDecimal.ZERO;

    const ESCAPE = new BigDecimal(256);
    const points: number[] = [];

    for (let i = 0; i < maxIter; i++) {
      points.push(zr.toNumber(), zi.toNumber());

      // z = z^2 + c
      // Truncate to working precision after each multiply to prevent
      // exponential significand growth (mul doubles digit count).
      const zr2 = zr.mul(zr).toPrecision(precision);
      const zi2 = zi.mul(zi).toPrecision(precision);

      // |z|^2 > 256? (escape with margin)
      const mag2 = zr2.add(zi2);
      if (mag2.cmp(ESCAPE) > 0) break;

      const new_zi = zr.mul(zi).toPrecision(precision).mul(2).add(ci);
      zr = zr2.sub(zi2).add(cr);
      zi = new_zi;
    }

    return new Float32Array(points);
  } finally {
    BigDecimal.precision = prevPrecision;
  }
}
