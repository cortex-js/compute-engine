import { BigDecimal } from '../../big-decimal';

/**
 * Compute a Mandelbrot reference orbit at arbitrary precision.
 *
 * Iterates z -> z^2 + c starting from z = 0, using BigDecimal arithmetic
 * at the specified precision (decimal digits). Stops early if |z|^2 > 256
 * (well past the escape radius of 2, giving a margin for perturbation).
 *
 * @param center - Reference point [re, im] as numbers (converted to BigDecimal)
 * @param maxIter - Maximum number of iterations
 * @param precision - BigDecimal working precision (decimal digits)
 * @returns Float32Array of [re0, im0, re1, im1, ...] orbit points
 */
export function computeReferenceOrbit(
  center: [number, number],
  maxIter: number,
  precision: number
): Float32Array {
  const prevPrecision = BigDecimal.precision;
  BigDecimal.precision = precision;

  try {
    const cr = new BigDecimal(center[0]);
    const ci = new BigDecimal(center[1]);
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
