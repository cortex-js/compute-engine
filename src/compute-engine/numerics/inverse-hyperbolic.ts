/**
 * The machine kernels of the reciprocal inverse hyperbolic functions on a
 * real argument: the interpreter's (`boxed-expression/trigonometry.ts`) and
 * the compiled code's (`compilation/ir/operators.ts`). Each is NaN where the
 * value is not real.
 */

/** arcoth x = ½·ln((x + 1)/(x − 1)), real for |x| > 1. A ratio near 1 (a
 *  large |x|) loses digits in the logarithm, so this is ½·log1p(2/(|x| − 1))
 *  with the sign of x. */
export function arcothReal(x: number): number {
  const r = 0.5 * Math.log1p(2 / (Math.abs(x) - 1));
  return x < 0 ? -r : r;
}

/** arcsch x = arsinh(1/x). Below 10⁻³⁰⁰ in magnitude, `1/x` can overflow:
 *  there arsinh(1/x) is ln(2/|x|) with the sign of x, to a relative error of
 *  about x². */
export function arcschReal(x: number): number {
  if (x === 0) return Infinity;
  if (Math.abs(x) < 1e-300) {
    const r = Math.LN2 - Math.log(Math.abs(x));
    return x < 0 ? -r : r;
  }
  return Math.asinh(1 / x);
}

/** arsech x = ln((1 + t)/x) with t = √(1 − x²), real for 0 < x ≤ 1. Near
 *  x = 1, ln(1 + t) loses digits, so this is log1p(t) − ln x (two positive
 *  terms). */
export function arsechReal(x: number): number {
  return Math.log1p(Math.sqrt((1 - x) * (1 + x))) - Math.log(x);
}
