/**
 * Double-double arithmetic.
 *
 * A double-double is an unevaluated sum hi + lo of two doubles with
 * |lo| ≤ ½ ulp(hi). It carries about 32 significant decimal digits (106
 * bits), twice the precision of a double, at the cost of a few floating
 * point operations for each operation.
 *
 * The primitives are the error-free transformations of T.J. Dekker,
 * Numer. Math. 18 (1971) 224–242, and J.R. Shewchuk, Discrete Comput.
 * Geom. 18 (1997) 305–363. They are EXACT: the returned pair sums to the
 * exact result of the operation on the two doubles (when no overflow
 * occurs):
 * - `twoSum(a, b)`: a + b = s + e, for any a and b (Knuth).
 * - `quickTwoSum(a, b)`: a + b = s + e, when |a| ≥ |b| (or a = 0).
 * - `twoProd(a, b)`: a·b = p + e, by Dekker's splitting (JavaScript has no
 *   fused multiply-add). Exact when no product of the halves overflows or
 *   underflows.
 *
 * The operations on double-doubles are ROUNDED: `ddAdd`, `ddMul`, `ddMulD`
 * and `ddDivD` return a double-double within a few units of 2⁻¹⁰⁶ of the
 * exact result (relative), not the exact result.
 *
 * This module has no imports, so every numeric module can use it without
 * an import cycle.
 */

/** A double-double value: the unevaluated sum hi + lo. */
export type DD = [hi: number, lo: number];

const DD_SPLITTER = 134217729; // 2^27 + 1 (Dekker splitting constant)

/** Exact: a + b = s + e with s = fl(a + b) (Knuth two-sum). */
export function twoSum(a: number, b: number): DD {
  const s = a + b;
  const bb = s - a;
  return [s, a - (s - bb) + (b - bb)];
}

/** Exact: a + b = s + e, assuming |a| ≥ |b| (fast two-sum). */
export function quickTwoSum(a: number, b: number): DD {
  const s = a + b;
  return [s, b - (s - a)];
}

/** Exact: a·b = p + e with p = fl(a·b) (Dekker two-product). */
export function twoProd(a: number, b: number): DD {
  const p = a * b;
  const ca = DD_SPLITTER * a;
  const ahi = ca - (ca - a);
  const alo = a - ahi;
  const cb = DD_SPLITTER * b;
  const bhi = cb - (cb - b);
  const blo = b - bhi;
  return [p, ahi * bhi - p + ahi * blo + alo * bhi + alo * blo];
}

/** Rounded: a + b for two double-doubles. */
export function ddAdd(a: DD, b: DD): DD {
  const [s1, s2] = twoSum(a[0], b[0]);
  const [t1, t2] = twoSum(a[1], b[1]);
  const [hi, lo] = quickTwoSum(s1, s2 + t1);
  return quickTwoSum(hi, lo + t2);
}

/** Rounded: a·b for two double-doubles. */
export function ddMul(a: DD, b: DD): DD {
  const [p, e] = twoProd(a[0], b[0]);
  return quickTwoSum(p, e + a[0] * b[1] + a[1] * b[0]);
}

/** Rounded: a·b for a double-double a and a double b. */
export function ddMulD(a: DD, b: number): DD {
  const [p, e] = twoProd(a[0], b);
  return quickTwoSum(p, e + a[1] * b);
}

/**
 * Rounded: a/b for a double-double a and a double b. The first quotient
 * q = fl(a.hi/b) is corrected by the remainder a − q·b, which is formed
 * in double-double (q·b exactly by `twoProd`).
 */
export function ddDivD(a: DD, b: number): DD {
  const q1 = a[0] / b;
  const [p, e] = twoProd(q1, b);
  const r = ddAdd(a, [-p, -e]);
  return quickTwoSum(q1, (r[0] + r[1]) / b);
}
