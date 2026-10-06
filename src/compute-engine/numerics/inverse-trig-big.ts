import { Complex } from 'complex.js';
import { BigDecimal } from '../../big-decimal/index.js';
import {
  complexAcos,
  complexAcosh,
  complexAcot,
  complexAcoth,
  complexAcsc,
  complexAcsch,
  complexAsec,
  complexAsech,
  complexAsin,
  complexAsinh,
  complexAtan,
  complexAtanh,
} from './numeric-complex.js';

// The twelve inverse trigonometric and inverse hyperbolic functions at an
// argument with a part outside the range of a normal double: larger than
// `Number.MAX_VALUE`, or not zero and smaller than 2⁻¹⁰²² (a subnormal double
// keeps fewer digits, and a smaller value is 0 as a double). The double
// kernels of `numeric-complex.ts` read such a part as `±Infinity`, `0` or a
// subnormal, so `arcsin(10⁴⁰⁰)` was `NaN` and `arcsec(10⁻³²⁰)` had 5 correct
// digits. The functions here take the argument as big decimals.
//
// - A real argument gives a value at the working precision of `BigDecimal`,
//   from the real big-decimal functions and the identities of each head on
//   its branch cut. The side of each cut is the side the double kernels take
//   at the largest and smallest normal doubles (`arcsin(10³⁰⁰)` is
//   `π/2 − 691.47i`, `arcsin(−10³⁰⁰)` is `−π/2 + 691.47i`).
// - A complex argument gives a value with the digits of a double, as the
//   double kernels give at every precision. The value comes from the double
//   kernel at a point in the same direction as the argument and of a modulus
//   that a double holds, and the first term of the expansion of the head at
//   0 or at infinity. So the side of each cut is the side of the kernel.

export type InverseTrigHead =
  | 'Arcsin'
  | 'Arccos'
  | 'Arctan'
  | 'Arccot'
  | 'Arcsec'
  | 'Arccsc'
  | 'Arsinh'
  | 'Arcosh'
  | 'Artanh'
  | 'Arcoth'
  | 'Arsech'
  | 'Arcsch';

/** A complex value with big-decimal parts. */
export interface BigComplexValue {
  re: BigDecimal;
  im: BigDecimal;
}

const DOUBLE_MAX = new BigDecimal('1.7976931348623157e308');
const DOUBLE_MIN_NORMAL = new BigDecimal('2.2250738585072014e-308');

/** `x` is finite, not zero, and outside the range of a normal double. */
export function isOutsideDoubleRange(x: BigDecimal): boolean {
  if (x.isZero() || !x.isFinite()) return false;
  const a = x.abs();
  return a.gt(DOUBLE_MAX) || a.lt(DOUBLE_MIN_NORMAL);
}

const value = (re: BigDecimal, im = BigDecimal.ZERO): BigComplexValue => ({
  re,
  im,
});

/**
 * The value of `head` at a real `x` with `|x| ≠ 1`, at the working precision
 * of `BigDecimal`. The callers pass an `x` outside the range of a double, an
 * `x` at which the value is not real, or an `x` next to ±1 read with the
 * digits that hold |x| ∓ 1 (the big-decimal functions then keep the digits
 * of the value, which depends on |x| ∓ 1 there).
 */
export function realInverseTrig(
  head: InverseTrigHead,
  x: BigDecimal
): BigComplexValue {
  const sign = x.isNegative() ? -1 : 1;
  const ax = x.abs();
  const outside = ax.gt(BigDecimal.ONE);
  const pi = BigDecimal.PI;
  const halfPi = pi.div(BigDecimal.TWO);
  switch (head) {
    // |x| > 1: arcsin x = sign(x)·(π/2 − i·arcosh|x|).
    case 'Arcsin':
      return outside
        ? value(halfPi.mul(sign), ax.acosh().mul(-sign))
        : value(x.asin());
    // |x| > 1: arccos x = i·arcosh x for x > 1, π − i·arcosh|x| for x < −1.
    case 'Arccos':
      if (!outside) return value(x.acos());
      return sign > 0
        ? value(BigDecimal.ZERO, ax.acosh())
        : value(pi, ax.acosh().neg());
    case 'Arctan':
      return value(x.atan());
    // The real kernel is atan2(1, x): the value is in (0, π).
    case 'Arccot':
      return value(BigDecimal.atan2(BigDecimal.ONE, x));
    case 'Arsinh':
      return value(x.asinh());
    // x < −1: arcosh x = arcosh|x| + iπ. |x| < 1: arcosh x = i·arccos x.
    case 'Arcosh':
      if (!outside) return value(BigDecimal.ZERO, x.acos());
      return value(ax.acosh(), sign > 0 ? BigDecimal.ZERO : pi);
    // |x| > 1: artanh x = artanh(1/x) − sign(x)·iπ/2.
    case 'Artanh':
      return outside
        ? value(x.inv().atanh(), halfPi.mul(-sign))
        : value(x.atanh());
    case 'Arccsc':
      return realInverseTrig('Arcsin', x.inv());
    case 'Arcsec':
      return realInverseTrig('Arccos', x.inv());
    case 'Arcsch':
      return realInverseTrig('Arsinh', x.inv());
    case 'Arsech':
      return realInverseTrig('Arcosh', x.inv());
    case 'Arcoth':
      return realInverseTrig('Artanh', x.inv());
  }
}

const KERNELS: Record<InverseTrigHead, (z: Complex) => Complex | number> = {
  Arcsin: complexAsin,
  Arccos: complexAcos,
  Arctan: complexAtan,
  Arccot: complexAcot,
  Arcsec: complexAsec,
  Arccsc: complexAcsc,
  Arsinh: complexAsinh,
  Arcosh: complexAcosh,
  Artanh: complexAtanh,
  Arcoth: complexAcoth,
  Arsech: complexAsech,
  Arcsch: complexAcsch,
};

/** The heads that grow as B·ln z at infinity (B = ±1 or ±i). The others
 * tend to a constant A, as A + C/z. */
const LOGARITHMIC_AT_INFINITY = new Set<InverseTrigHead>([
  'Arcsin',
  'Arccos',
  'Arsinh',
  'Arcosh',
]);

/** The heads that grow as B·ln z at 0: the heads above at 1/z. The others
 * tend to a constant A, as A + C·z. */
const LOGARITHMIC_AT_ZERO = new Set<InverseTrigHead>([
  'Arccsc',
  'Arcsec',
  'Arcsch',
  'Arsech',
]);

/** The smallest ratio of the smaller part of the argument to the larger one
 * that the double kernels are given: the direction of the argument is
 * scaled to a modulus of 10⁻²⁰ at the least, and the smaller part must stay
 * a normal double there. A smaller ratio is raised to this one, keeping its
 * sign, and the parts of the value that depend on it are scaled back. */
const SMALLEST_PART_RATIO = 1e-280;

/** A part of a kernel value below this size is read as one that the small
 * part of the argument makes nonzero (of the order of the ratio 10⁻²⁸⁰, or
 * of its square root 10⁻¹⁴⁰ at a branch point), not as an O(1) part. */
const DEPENDENT_PART = 1e-100;

/** `d` within 10⁻⁶ of 1, −1, i or −i, as `[re, im]`, or `undefined`. */
function unit(d: Complex): [number, number] | undefined {
  for (const [re, im] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const)
    if (Math.abs(d.re - re) < 1e-6 && Math.abs(d.im - im) < 1e-6)
      return [re, im];
  return undefined;
}

/** `x` within 10⁻⁶ of a multiple k of π/2, as k, or `undefined`. */
function halfPiMultiple(x: number): number | undefined {
  const k = Math.round(x / (Math.PI / 2));
  return Math.abs(x - (k * Math.PI) / 2) < 1e-6 ? k : undefined;
}

function kernelValue(
  head: InverseTrigHead,
  re: number,
  im: number
): Complex | undefined {
  const r = KERNELS[head](new Complex(re, im));
  const c = typeof r === 'number' ? new Complex(r, 0) : r;
  return Number.isFinite(c.re) && Number.isFinite(c.im) ? c : undefined;
}

/**
 * A part `v1` of a kernel value at a point whose small part is `δ`, given the
 * same part `v4` at the point whose small part is `4δ`, scaled to the small
 * part `factor·δ`. `undefined` for a growth that is none of these:
 * - A part that the small part makes nonzero grows as δ (off a branch
 *   point) or as √δ (at an algebraic branch point,
 *   `arccos(1 + iδ) ≈ (1 − i)·√(δ/2)`), which `v4/v1` (4 or 2) tells apart.
 * - A part that the small part does not change is kept.
 * - At a logarithmic branch point (`artanh(1 + iδ) ≈ ½·ln(2/δ) + iπ/4`) a
 *   part changes by a multiple of ½·ln 4 from δ to 4δ, and is extrapolated
 *   along the logarithm: v1 + (v4 − v1)·ln(factor)/ln 4.
 */
function scalePart(
  v1: number,
  v4: number,
  factor: BigDecimal | undefined
): BigDecimal | undefined {
  if (factor === undefined) return new BigDecimal(v1);
  if (Math.abs(v1) < DEPENDENT_PART && Math.abs(v4) < DEPENDENT_PART) {
    if (v1 === 0 && v4 === 0) return BigDecimal.ZERO;
    if (v1 === 0) return undefined;
    const growth = v4 / v1;
    if (Math.abs(growth - 4) < 0.01) return new BigDecimal(v1).mul(factor);
    if (Math.abs(growth - 2) < 0.01)
      return new BigDecimal(v1).mul(factor.sqrt());
    return undefined;
  }
  const change = v4 - v1;
  if (Math.abs(change) <= 1e-10 * Math.max(1, Math.abs(v1)))
    return new BigDecimal(v1);
  // In units of ½·ln 4 = ln 2.
  const halves = change / Math.LN2;
  const k = Math.round(halves);
  if (k === 0 || Math.abs(k) > 4 || Math.abs(halves - k) > 1e-6)
    return undefined;
  // The slope along ln δ is (v4 − v1)/ln 4 = k/2, exactly.
  return new BigDecimal(v1).add(factor.ln().mul(k).div(BigDecimal.TWO));
}

/**
 * The value of `head` at the complex `re + i·im`, a part of which is outside
 * the range of a double, with the digits of a double. `undefined` when a
 * kernel value does not have the expected form.
 *
 * Let M be the larger of |re| and |im|.
 *
 * - 10⁻²⁰ ≤ M ≤ 10²⁰: the larger part is a double, and the smaller one is
 *   below 2.3·10⁻³⁰⁸, too small for a double (`2 + 10⁻⁴⁰⁰i`). The kernel
 *   runs at the larger part and a small part δ = 10⁻²⁸⁰·M of the same sign,
 *   which selects the side of a branch cut on the axis, and the parts of
 *   the value that the small part makes nonzero are scaled to its true size
 *   (`scalePart`).
 * - M > 10²⁰ or M < 10⁻²⁰: let u = (re + i·im)/M, a direction that doubles
 *   hold (a smaller part below 10⁻²⁸⁰·M is raised to 10⁻²⁸⁰·M, with its
 *   sign). A head that grows as B·ln z (arcsin z ~ −i·ln(2iz) at infinity,
 *   for example): f(z) = f(t·u) + B·ln(M/t) + O(1/t²) at infinity, or O(t²)
 *   at 0, with t = 10²⁰ or 10⁻²⁰; B is read from f(2t·u) − f(t·u) = B·ln 2.
 *   A head that tends to a constant A: f(z) = A + C·w + O(w³), with w = 1/z
 *   at infinity and w = z at 0 (every such head is odd about its limit, so
 *   the next term is of order w³). C is read from two kernel values at
 *   |w| = 10⁻⁴ and 2·10⁻⁴, and A, a multiple of π/2 in each part, from one
 *   of them. The value of C·w is exact, so a part of the result that is
 *   outside the range of a double (arcsin(10⁻⁴⁰⁰·(1 + i))) is kept.
 */
export function complexInverseTrig(
  head: InverseTrigHead,
  re: BigDecimal,
  im: BigDecimal
): BigComplexValue | undefined {
  const ar = re.abs();
  const ai = im.abs();
  const realLarger = ar.gte(ai);
  const m = realLarger ? ar : ai;
  if (m.isZero()) return undefined;
  const smaller = realLarger ? ai : ar;
  const ratio = smaller.div(m);
  // The factor by which the small part was raised, when it was.
  const raised =
    !smaller.isZero() && ratio.lt(new BigDecimal(SMALLEST_PART_RATIO))
      ? ratio.div(new BigDecimal(SMALLEST_PART_RATIO))
      : undefined;
  const smallSign = (realLarger ? im : re).isNegative() ? -1 : 1;
  const small = raised ? smallSign * SMALLEST_PART_RATIO : undefined;

  if (m.lte(new BigDecimal('1e20')) && m.gte(new BigDecimal('1e-20'))) {
    if (small === undefined) return undefined;
    const big = (realLarger ? re : im).toNumber();
    const at = (k: number) =>
      realLarger
        ? kernelValue(head, big, k * small * Math.abs(big))
        : kernelValue(head, k * small * Math.abs(big), big);
    const v1 = at(1);
    const v4 = at(4);
    if (v1 === undefined || v4 === undefined) return undefined;
    // The true small part over the one the kernel was given.
    const factor = smaller.div(
      new BigDecimal(SMALLEST_PART_RATIO * Math.abs(big))
    );
    const r = scalePart(v1.re, v4.re, factor);
    const i = scalePart(v1.im, v4.im, factor);
    return r === undefined || i === undefined ? undefined : value(r, i);
  }

  const u: [number, number] = realLarger
    ? [re.isNegative() ? -1 : 1, small ?? im.div(m).toNumber()]
    : [small ?? re.div(m).toNumber(), im.isNegative() ? -1 : 1];
  const at = (t: number, k = 1): Complex | undefined =>
    realLarger
      ? kernelValue(head, u[0] * t, k * u[1] * t)
      : kernelValue(head, k * u[0] * t, u[1] * t);
  const large = m.gt(BigDecimal.ONE);

  if ((large ? LOGARITHMIC_AT_INFINITY : LOGARITHMIC_AT_ZERO).has(head)) {
    const t = large ? 1e20 : 1e-20;
    const f1 = at(t);
    const f2 = at(2 * t);
    if (f1 === undefined || f2 === undefined) return undefined;
    const b = unit(f2.sub(f1).div(Math.LN2));
    if (b === undefined) return undefined;
    // A part that depends on a raised small part is scaled back to it.
    const f4 = raised ? at(t, 4) : f1;
    if (f4 === undefined) return undefined;
    const kr = scalePart(f1.re, f4.re, raised);
    const ki = scalePart(f1.im, f4.im, raised);
    if (kr === undefined || ki === undefined) return undefined;
    const log = m.ln().sub(new BigDecimal(t).ln());
    return value(kr.add(log.mul(b[0])), ki.add(log.mul(b[1])));
  }

  // w = 1/(t·u) at infinity, t·u at 0.
  const t = large ? 1e4 : 1e-4;
  const w = (s: number): Complex => {
    const z = new Complex(u[0] * s, u[1] * s);
    return large ? new Complex(1, 0).div(z) : z;
  };
  const f1 = at(t);
  const f2 = at(2 * t);
  if (f1 === undefined || f2 === undefined) return undefined;
  const c = unit(f1.sub(f2).div(w(t).sub(w(2 * t))));
  if (c === undefined) return undefined;
  const a = f1.sub(w(t).mul(new Complex(c[0], c[1])));
  const kr = halfPiMultiple(a.re);
  const ki = halfPiMultiple(a.im);
  if (kr === undefined || ki === undefined) return undefined;
  // w as big decimals: 1/z = (re − i·im)/(re² + im²).
  let wr = re;
  let wi = im;
  if (large) {
    const d = re.mul(re).add(im.mul(im));
    wr = re.div(d);
    wi = im.neg().div(d);
  }
  const halfPi = BigDecimal.PI.div(BigDecimal.TWO);
  // C·w, with C = c[0] + i·c[1] one of 1, −1, i, −i.
  return value(
    halfPi.mul(kr).add(wr.mul(c[0]).sub(wi.mul(c[1]))),
    halfPi.mul(ki).add(wi.mul(c[0]).add(wr.mul(c[1])))
  );
}
