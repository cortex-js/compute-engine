import { Complex } from 'complex-esm';
import { erfComplex } from './numeric-complex.js';

const C_NAN = new Complex(NaN, NaN);

/** (a + ib)/(c + id) by Smith's method, which does not overflow or
 *  underflow in the intermediate products when the quotient is in range. */
function divide(a: number, b: number, c: number, d: number): Complex {
  if (Math.abs(c) >= Math.abs(d)) {
    const r = d / c;
    const t = c + d * r;
    return new Complex((a + b * r) / t, (b - a * r) / t);
  }
  const r = c / d;
  const t = c * r + d;
  return new Complex((a * r + b) / t, (b * r - a) / t);
}

/**
 * The unnormalized cardinal sine sinc(z) = sin(z)/z for a complex z, with
 * sinc(0) = 1.
 *
 * Method:
 *   - |z| < 2: the Maclaurin series Σ (−1)ⁿ z²ⁿ/(2n + 1)!. The quotient
 *     sin(z)/z loses accuracy near 0, where the imaginary part of the
 *     quotient is the difference of two nearly equal products.
 *   - |Im z| < 20: sin(z) = sin x·cosh y + i·cos x·sinh y, divided by z.
 *   - |Im z| ≥ 20: sin(z) = (e^|y|/2)·(sin x + i·sgn(y)·cos x) (the terms in
 *     e^−|y| are below the roundoff), with the factor e^|y| applied last, in
 *     the exponent, so that the result is finite whenever the value is in the
 *     range of doubles.
 * Measured against mpmath (`sinc`, 40 digits) on 1,600 points with |z| from
 * 10⁻⁸ to 700 in every direction: the largest relative error (in the
 * modulus) is 4.3·10⁻¹⁶.
 *
 * Returns a non-finite part when the value is past the range of doubles
 * (`sinc(800 + 800i)`), and `NaN` parts when z is not finite.
 */
export function sincComplex(z: Complex): Complex {
  const x = z.re;
  const y = z.im;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return C_NAN;
  if (x === 0 && y === 0) return new Complex(1, 0);

  if (Math.hypot(x, y) < 2) {
    // −z², and the terms (−1)ⁿ z²ⁿ/(2n + 1)!: each term is at most |z|²/6
    // times the previous one, which is below 2/3.
    const mz2 = new Complex(y * y - x * x, -2 * x * y);
    let term = new Complex(1, 0);
    let sum = term;
    for (let n = 1; n < 30; n++) {
      term = term.mul(mz2).div(2 * n * (2 * n + 1));
      sum = sum.add(term);
      if (term.abs() <= 1e-17 * sum.abs()) break;
    }
    return sum;
  }

  if (Math.abs(y) < 20)
    return divide(Math.sin(x) * Math.cosh(y), Math.cos(x) * Math.sinh(y), x, y);

  // (sin x + i·sgn(y)·cos x)/z, then times e^|y|/2.
  const q = divide(Math.sin(x), Math.sign(y) * Math.cos(x), x, y);
  // `Math.exp` is more accurate than the exponent form below, which rounds
  // |y| − ln 2 + ln|q| (an error of |y| units in the last place).
  const ay = Math.abs(y);
  if (ay < 709) {
    const scale = Math.exp(ay) / 2;
    return new Complex(q.re * scale, q.im * scale);
  }
  // e^|y| itself overflows: it is applied as e^(|y|/2) twice, so a product
  // overflows only when the value does (|q| is about 1/|z|).
  if (ay < 1418) {
    const half = Math.exp(ay / 2);
    return new Complex(q.re * half * (half / 2), q.im * half * (half / 2));
  }
  // `Math.hypot`, not `q.abs()`: complex-esm squares the parts, which
  // underflows for |q| below 10⁻¹⁵⁴ (at z = 10²⁰⁰ + 2000i).
  const m = Math.hypot(q.re, q.im);
  const scale = Math.exp(ay - Math.LN2 + Math.log(m));
  return new Complex((q.re / m) * scale, (q.im / m) * scale);
}

/**
 * sinc(iy) = sinh(y)/y for a real y ≠ 0: the value of `Sinc` on the
 * imaginary axis, which is real. Past |y| = 709, sinh(y) overflows before
 * the division by y; there sinh(y)/y = e^|y|/(2|y|) (e^−|y| is below the
 * last digit), computed as e^(|y|/2)/(2|y|) times e^(|y|/2), which
 * overflows only when the value does (past |y| = 716.3).
 */
export function sincImaginaryAxis(y: number): number {
  const ay = Math.abs(y);
  if (ay < 709) return Math.sinh(y) / y;
  const half = Math.exp(ay / 2);
  return (half / (2 * ay)) * half;
}

/**
 * The integral F(z) = ∫₀ᶻ e^{iπt²/2} dt = C(z) + i·S(z) of the Fresnel
 * integrals by its Maclaurin series z·Σ (iπz²/2)^m/(m!·(2m + 1)), for
 * a small |z|. Returns [C(z), S(z)].
 *
 * The real and imaginary parts of the terms are the terms of C and S, so the
 * two integrals are summed apart: the series of C has the even powers m, the
 * series of S the odd ones.
 */
function fresnelSeries(z: Complex): [c: Complex, s: Complex] {
  // u = πz²/2, and the terms t_m = u^m/m!.
  const u = z.mul(z).mul(Math.PI / 2);
  let t = new Complex(1, 0);
  let c = new Complex(1, 0);
  let s = new Complex(0, 0);
  for (let m = 1; m < 80; m++) {
    t = t.mul(u).div(m);
    // (i)^m: the sign of the term in C (m even) or in S (m odd).
    const sign = (m & 3) < 2 ? 1 : -1;
    const term = t.mul(sign / (2 * m + 1));
    if (m % 2 === 0) c = c.add(term);
    else s = s.add(term);
    if (term.abs() <= 1e-17 * Math.min(c.abs(), s.abs())) break;
  }
  return [c.mul(z), s.mul(z)];
}

/**
 * The Fresnel integrals from the complex error function:
 *   S(z) = (1 + i)/4·[erf(a) − i·erf(b)],
 *   C(z) = (1 − i)/4·[erf(a) + i·erf(b)],
 * with a = (1 + i)·√π·z/2 and b = (1 − i)·√π·z/2 (DLMF 7.2.5 with 7.2.7 and
 * 7.2.8). Returns [C(z), S(z)].
 */
function fresnelFromErf(z: Complex): [c: Complex, s: Complex] {
  const h = Math.sqrt(Math.PI) / 2;
  const ea = erfComplex(new Complex(h * (z.re - z.im), h * (z.re + z.im)));
  const eb = erfComplex(new Complex(h * (z.re + z.im), h * (z.im - z.re)));
  // i·erf(b)
  const ieb = new Complex(-eb.im, eb.re);
  const s = new Complex(0.25, 0.25).mul(ea.sub(ieb));
  const c = new Complex(0.25, -0.25).mul(ea.add(ieb));
  return [c, s];
}

/** Below this |z|, the Fresnel integrals use their Maclaurin series. */
const FRESNEL_SERIES_RADIUS = 1.5;

/**
 * The Fresnel sine integral S(z) = ∫₀ᶻ sin(πt²/2) dt for a complex z (the
 * normalization of the real kernel `fresnelS` and of mpmath's `fresnels`).
 *
 * Method: for |z| < 1.5, the Maclaurin series (the formula from erf below
 * subtracts values of about 1 to give a value of about z³ near 0);
 * otherwise S(z) = (1 + i)/4·[erf(a) − i·erf(b)], a = (1 + i)·√π·z/2,
 * b = (1 − i)·√π·z/2, with the complex error function `erfComplex`.
 * Measured against mpmath (`fresnels`, `fresnelc`, 40 digits) on 1,300
 * points with |z| from 10⁻⁸ to 10⁴ in every direction, the largest relative
 * error (in the modulus) is 4·10⁻¹⁶ for |z| < 1, 5.3·10⁻¹⁴ for |z| < 10,
 * 7.6·10⁻¹³ for |z| < 100 and 2.4·10⁻¹² for |z| < 10⁴. Away from 0 the
 * error follows the relative condition number of S and C, which grows like
 * π|z|²: z² is rounded to a double before the phase πz²/2 is computed.
 *
 * Returns a non-finite or `NaN` part when the value is past the range of
 * doubles (|S(z)| grows like e^{π|xy|}), and `NaN` parts when z is not
 * finite.
 */
export function fresnelSComplex(z: Complex): Complex {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return C_NAN;
  if (z.abs() < FRESNEL_SERIES_RADIUS) return fresnelSeries(z)[1];
  return fresnelFromErf(z)[1];
}

/**
 * The Fresnel cosine integral C(z) = ∫₀ᶻ cos(πt²/2) dt for a complex z (the
 * normalization of the real kernel `fresnelC` and of mpmath's `fresnelc`).
 *
 * Method: for |z| < 1.5, the Maclaurin series; otherwise
 * C(z) = (1 − i)/4·[erf(a) + i·erf(b)], a = (1 + i)·√π·z/2,
 * b = (1 − i)·√π·z/2, with the complex error function `erfComplex`.
 * Measured against mpmath (`fresnels`, `fresnelc`, 40 digits) on 1,300
 * points with |z| from 10⁻⁸ to 10⁴ in every direction, the largest relative
 * error (in the modulus) is 4·10⁻¹⁶ for |z| < 1, 5.3·10⁻¹⁴ for |z| < 10,
 * 7.6·10⁻¹³ for |z| < 100 and 2.4·10⁻¹² for |z| < 10⁴. Away from 0 the
 * error follows the relative condition number of S and C, which grows like
 * π|z|²: z² is rounded to a double before the phase πz²/2 is computed.
 *
 * Returns a non-finite or `NaN` part when the value is past the range of
 * doubles, and `NaN` parts when z is not finite.
 */
export function fresnelCComplex(z: Complex): Complex {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return C_NAN;
  if (z.abs() < FRESNEL_SERIES_RADIUS) return fresnelSeries(z)[0];
  return fresnelFromErf(z)[0];
}
