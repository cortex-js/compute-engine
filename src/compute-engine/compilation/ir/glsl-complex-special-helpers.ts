/**
 * The GLSL helpers of `Gamma`, `Zeta`, `HurwitzZeta` and `PolyGamma` of a
 * complex operand for the IR printer (`print-glsl.ts`), on the `vec2`
 * (re, im) of the complex lane, float32 (CE-1600).
 *
 * - ζ(s, a) (`_gpu_ir_churwitz_em`): the Euler-Maclaurin sum after a shift
 *   of a by N terms, Σ_{k<N} (a+k)^-s + w^(1-s)/(s-1) + w^-s/2 +
 *   Σ_{j=1..16} B_2j/(2j)! s(s+1)…(s+2j-2) w^(-s-2j+1), w = a + N, with
 *   Re w >= max(3, 1.1 (|s| + 32)/(2π)): the least shift whose truncation
 *   stays below 1e-8 of the sizes of the terms in a double model, from
 *   Re s = -4 to 26 and |Im s| <= 60 (the terms, and their float32
 *   errors, grow as |w|^(1 - Re s)). NaN where the shift passes 4,200
 *   terms, and where the last Bernoulli term passes 3e-5 of the sum of the
 *   sizes of the terms (the float32 scale of the value). The error is
 *   absolute at that scale, not relative to the value: next to a zero, and
 *   for Re s < 0, where the terms are much larger than the value
 *   (`docs/COMPILATION-MODEL.md`, known limitations). `_gpu_ir_czeta`
 *   takes the functional equation for Re s < 0. +∞ (both parts) at s = 1
 *   and where a + k = 0 for Re s > 0; NaN where an intermediate overflows
 *   (next to the largest float, and Re s below about -30).
 * - ψ⁽ⁿ⁾(z), n >= 1 (`_gpu_ir_cpolygamma`): (-1)^(n+1) n! ζ(n+1, z) by the
 *   kernel above; n = 0 (`_gpu_ir_cdigamma`): the recurrence
 *   ψ(z) = ψ(z+1) - 1/z up to Re z >= 10, then ln z - 1/(2z) -
 *   Σ B_2k/(2k z^2k); NaN below Re z = -4096 and for an order that is not
 *   an integer from 0 to 24 (the real helper's range); the order -1, ln Γ,
 *   is NaN off the real axis.
 * - Γ(z) (`_gpu_ir_cgamma`): the Lanczos sum (g = 7, n = 9) in log form
 *   for Re z >= 1/2, the reflection π / (sin(πz) Γ(1 - z)) below, also in
 *   log form, so that sin(πz) for a large |Im z| does not overflow; exp of
 *   the logarithm last.
 *
 * On the real axis each one is the real helper (`_gpu_ir_zeta`,
 * `_gpu_ir_hurwitz_zeta`, `_gpu_ir_polygamma`, `_gpu_ir_gamma`) where that
 * is not NaN, as the JavaScript kernels (`continuedKernel()` of
 * `javascript-runtime.ts`). The logarithms are `_gpu_ir_cz_log`, exact to
 * about an ulp: a phase t·ln|w| at t = 40 multiplies the error of the
 * builtin `log` (2^-21 absolute on [0.5, 2]) by 40. The sines and cosines
 * are `_gpu_ir_sincospi` of the phase in units of π. `print-glsl.ts` finds
 * the helpers that each one calls in its text, and removes the comments.
 */

const NAN = 'uintBitsToFloat(0x7fc00000u)';
const INF = 'uintBitsToFloat(0x7f800000u)';

// prettier-ignore
export const GLSL_COMPLEX_SPECIAL_HELPERS: Readonly<Record<string, string>> = {
  // ln x of a positive float: x = m 2^e with m in [√½, √2), ln m by the
  // series of 2 atanh((m - 1)/(m + 1)), e ln 2 in two parts.
  _gpu_ir_cz_log: `float _gpu_ir_cz_log(float x) {
  if (x == 0.0) return -${INF};
  if (x > 3.4028234663852886e38) return x;
  uint b = floatBitsToUint(x);
  float e = float(int((b >> 23) & 0xffu) - 127);
  float m = uintBitsToFloat((b & 0x7fffffu) | 0x3f800000u);
  if (m > 1.4142135) {
    m *= 0.5;
    e += 1.0;
  }
  float s = (m - 1.0) / (m + 1.0);
  float t = s * s;
  float l = 2.0 * s * (1.0 + t * (0.3333333333 + t * (0.2 + t * (0.14285714 + t * (0.11111111 + t * 0.09090909)))));
  return e * 0.693145751953125 + (l + e * 1.4286068203094172e-6);
}`,
  _gpu_ir_cz_mul: `vec2 _gpu_ir_cz_mul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
  // The principal ln w, of a w != 0.
  _gpu_ir_cz_ln: `vec2 _gpu_ir_cz_ln(vec2 w) {
  return vec2(_gpu_ir_cz_log(_gpu_ir_chypot(w.x, w.y)), _gpu_ir_carg(w));
}`,
  // exp(l), the phase by _gpu_ir_sincospi.
  _gpu_ir_cz_exp: `vec2 _gpu_ir_cz_exp(vec2 l) {
  vec2 sc = _gpu_ir_sincospi(l.y * 0.3183098861837907);
  return exp(l.x) * vec2(sc.y, sc.x);
}`,
  // w^-s, principal branch, of a w != 0: exp(-s ln w), the argument of w in
  // units of π (exactly 1 on the negative axis, so that an integer power
  // of a negative real is real).
  _gpu_ir_cz_powm: `vec2 _gpu_ir_cz_powm(vec2 w, vec2 s) {
  float lr = _gpu_ir_cz_log(_gpu_ir_chypot(w.x, w.y));
  float th = w.y == 0.0 ? (w.x < 0.0 ? 1.0 : 0.0) : _gpu_ir_carg(w) * 0.3183098861837907;
  float mag = exp(s.y * th * 3.14159265358979 - s.x * lr);
  vec2 sc = _gpu_ir_sincospi(-(s.x * th + s.y * (lr * 0.3183098861837907)));
  return mag * vec2(sc.y, sc.x);
}`,
  // ζ(s, a) of complex s and a, by Euler-Maclaurin (see the header).
  _gpu_ir_churwitz_em: `vec2 _gpu_ir_churwitz_em(vec2 s, vec2 a) {
  if ((floatBitsToUint(s.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(s.y) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(a.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(a.y) & 0x7FFFFFFFu) >= 0x7F800000u) return vec2(${NAN});
  if (s.x == 1.0 && s.y == 0.0) return vec2(${INF});
  float r = max(3.0, 0.17507043740108486 * (_gpu_ir_chypot(s.x, s.y) + 32.0));
  float nf = max(0.0, ceil(r - a.x));
  if (nf > 4200.0) return vec2(${NAN});
  int n = int(nf);
  vec2 sum = vec2(0.0);
  float mag = 0.0;
  vec2 w = a;
  for (int k = 0; k < 4200; k++) {
    if (k >= n) break;
    if (w.x == 0.0 && w.y == 0.0) {
      if (s.x > 0.0) return vec2(${INF});
      if (s.x == 0.0) return vec2(${NAN});
    } else {
      vec2 t = _gpu_ir_cz_powm(w, s);
      sum += t;
      mag += abs(t.x) + abs(t.y);
    }
    w.x += 1.0;
  }
  vec2 p = _gpu_ir_cz_powm(w, s);
  vec2 iw = _gpu_ir_cinv(w);
  vec2 t1 = _gpu_ir_cz_mul(_gpu_ir_cz_mul(p, w), _gpu_ir_cinv(s - vec2(1.0, 0.0)));
  sum += t1 + 0.5 * p;
  mag += abs(t1.x) + abs(t1.y) + 0.5 * (abs(p.x) + abs(p.y));
  float c[16] = float[16](
    0.083333333333333329, -0.0013888888888888889, 3.3068783068783064e-5,
    -8.2671957671957675e-7, 2.0876756987868100e-8, -5.2841901386874932e-10,
    1.3382536530684680e-11, -3.3896802963225827e-13, 8.5860620562778452e-15,
    -2.1748686985580619e-16, 5.5090028283602295e-18, -1.3954464685812525e-19,
    3.5347070396294673e-21, -8.9535174270375486e-23, 2.2679524523376833e-24,
    -5.7447906688722025e-26);
  vec2 iw2 = _gpu_ir_cz_mul(iw, iw);
  vec2 q = _gpu_ir_cz_mul(s, _gpu_ir_cz_mul(p, iw));
  float last = 0.0;
  for (int j = 0; j < 16; j++) {
    vec2 term = c[j] * q;
    sum += term;
    last = abs(term.x) + abs(term.y);
    mag += last;
    if (last <= 1.0e-9 * mag) break;
    float m = float(2 * j);
    q = _gpu_ir_cz_mul(_gpu_ir_cz_mul(q, iw2), _gpu_ir_cz_mul(s + vec2(m + 1.0, 0.0), s + vec2(m + 2.0, 0.0)));
  }
  if (!(last <= 3.0e-5 * mag) || !(mag <= 3.4028234663852886e38)) return vec2(${NAN});
  return sum;
}`,
  // HurwitzZeta(s, a): the real helper on the real axis. Its NaN there
  // means a complex value (a < 0 and s not an integer), which the sum
  // computes, or terms that cancel, which the sum would not detect.
  _gpu_ir_churwitz_zeta: `vec2 _gpu_ir_churwitz_zeta(vec2 s, vec2 a) {
  if (s.y == 0.0 && a.y == 0.0) {
    float r = _gpu_ir_hurwitz_zeta(s.x, a.x);
    if ((floatBitsToUint(r) & 0x7FFFFFFFu) <= 0x7F800000u) return vec2(r, 0.0);
    if (!(a.x < 0.0 && s.x != floor(s.x))) return vec2(${NAN});
  }
  return _gpu_ir_churwitz_em(s, a);
}`,
  // ζ(s) = ζ(s, 1); the real helper on the real axis. For Re s < 0 the
  // functional equation ζ(s) = 2^s π^(s-1) sin(πs/2) Γ(1-s) ζ(1-s) in log
  // form: the terms of the sum grow as |w|^(1-Re s), and at s = -4 - 7.5i
  // the sum was 2e-3 off a value of 2.9.
  _gpu_ir_czeta: `vec2 _gpu_ir_czeta(vec2 s) {
  if (s.y == 0.0) return vec2(_gpu_ir_zeta(s.x), 0.0);
  if (s.x >= 0.0) return _gpu_ir_churwitz_em(s, vec2(1.0, 0.0));
  vec2 u = vec2(1.0, 0.0) - s;
  vec2 l = s * 0.6931471805599453 + (s - vec2(1.0, 0.0)) * 1.1447298858494002 + _gpu_ir_clnsinpi(0.5 * s) + _gpu_ir_clngamma_lanczos(u) + _gpu_ir_cz_ln(_gpu_ir_churwitz_em(u, vec2(1.0, 0.0)));
  return _gpu_ir_cz_exp(l);
}`,
  // ψ(z) off the real axis (see the header).
  _gpu_ir_cdigamma: `vec2 _gpu_ir_cdigamma(vec2 z) {
  if (z.x < -4096.0) return vec2(${NAN});
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 4110; k++) {
    if (z.x >= 10.0) break;
    acc -= _gpu_ir_cinv(z);
    z.x += 1.0;
  }
  vec2 iz = _gpu_ir_cinv(z);
  vec2 iz2 = _gpu_ir_cz_mul(iz, iz);
  vec2 ser = vec2(1.0 / 132.0, 0.0);
  ser = vec2(-1.0 / 240.0, 0.0) + _gpu_ir_cz_mul(ser, iz2);
  ser = vec2(1.0 / 252.0, 0.0) + _gpu_ir_cz_mul(ser, iz2);
  ser = vec2(-1.0 / 120.0, 0.0) + _gpu_ir_cz_mul(ser, iz2);
  ser = vec2(1.0 / 12.0, 0.0) + _gpu_ir_cz_mul(ser, iz2);
  ser = _gpu_ir_cz_mul(ser, iz2);
  return _gpu_ir_cz_ln(z) - 0.5 * iz - ser + acc;
}`,
  // ψ⁽ⁿ⁾(z): the real helper on the real axis, +∞ at a pole. Its NaN
  // there means terms that cancel, which the sum would not detect.
  _gpu_ir_cpolygamma: `vec2 _gpu_ir_cpolygamma(float n, vec2 z) {
  if (z.y == 0.0) {
    float r = _gpu_ir_polygamma(n, z.x);
    if ((floatBitsToUint(r) & 0x7FFFFFFFu) <= 0x7F800000u) return vec2(r, 0.0);
    if (z.x <= 0.0 && z.x == floor(z.x)) return vec2(${INF}, 0.0);
    return vec2(${NAN});
  }
  if (n != floor(n) || n < 0.0 || n > 24.0) return vec2(${NAN});
  if (n == 0.0) return _gpu_ir_cdigamma(z);
  float fact = 1.0;
  for (int j = 2; j <= 24; j++) {
    if (float(j) > n) break;
    fact *= float(j);
  }
  vec2 h = _gpu_ir_churwitz_em(vec2(n + 1.0, 0.0), z);
  return (mod(n, 2.0) == 0.0 ? -fact : fact) * h;
}`,
  // ln Γ(z) for Re z >= 1/2 (up to a multiple of 2πi): the Lanczos sum
  // (g = 7, n = 9) of _gpu_ir_gamma.
  _gpu_ir_clngamma_lanczos: `vec2 _gpu_ir_clngamma_lanczos(vec2 z) {
  vec2 w = z - vec2(1.0, 0.0);
  vec2 x = vec2(0.99999999999980993, 0.0)
    + 676.5203681218851 * _gpu_ir_cinv(w + vec2(1.0, 0.0))
    - 1259.1392167224028 * _gpu_ir_cinv(w + vec2(2.0, 0.0))
    + 771.32342877765313 * _gpu_ir_cinv(w + vec2(3.0, 0.0))
    - 176.61502916214059 * _gpu_ir_cinv(w + vec2(4.0, 0.0))
    + 12.507343278686905 * _gpu_ir_cinv(w + vec2(5.0, 0.0))
    - 0.13857109526572012 * _gpu_ir_cinv(w + vec2(6.0, 0.0))
    + 9.9843695780195716e-6 * _gpu_ir_cinv(w + vec2(7.0, 0.0))
    + 1.5056327351493116e-7 * _gpu_ir_cinv(w + vec2(8.0, 0.0));
  vec2 t = w + vec2(7.5, 0.0);
  return vec2(0.9189385332046727, 0.0) + _gpu_ir_cz_mul(w + vec2(0.5, 0.0), _gpu_ir_cz_ln(t)) - t + _gpu_ir_cz_ln(x);
}`,
  // ln sin(πz) (up to a multiple of 2πi): from the parts below |Im z| = 1;
  // above, πy - ln 2 + iπ(1/2 - x) + ln(1 - e^(2πiz)) for y > 0, and the
  // conjugate for y < 0, so that nothing overflows.
  _gpu_ir_clnsinpi: `vec2 _gpu_ir_clnsinpi(vec2 z) {
  float y = abs(z.y);
  if (y < 1.0) {
    vec2 sx = _gpu_ir_sincospi(z.x);
    float u = 3.14159265358979 * z.y;
    float u2 = u * u;
    float sh = abs(u) < 0.5 ? u * (1.0 + u2 / 6.0 * (1.0 + u2 / 20.0 * (1.0 + u2 / 42.0 * (1.0 + u2 / 72.0)))) : sinh(u);
    return _gpu_ir_cz_ln(vec2(sx.x * sqrt(1.0 + sh * sh), sx.y * sh));
  }
  vec2 q = _gpu_ir_sincospi(2.0 * z.x);
  float e = exp(-6.283185307179586 * y);
  vec2 l = _gpu_ir_cz_ln(vec2(1.0 - e * q.y, -e * q.x)) + vec2(3.14159265358979 * y - 0.6931471805599453, 3.14159265358979 * (0.5 - z.x));
  return z.y < 0.0 ? vec2(l.x, -l.y) : l;
}`,
  // Γ(z): the real helper on the real axis (+∞ at a pole).
  _gpu_ir_cgamma: `vec2 _gpu_ir_cgamma(vec2 z) {
  if (z.y == 0.0) return vec2(_gpu_ir_gamma(z.x), 0.0);
  vec2 l = z.x >= 0.5 ? _gpu_ir_clngamma_lanczos(z) : vec2(1.1447298858494002, 0.0) - _gpu_ir_clnsinpi(z) - _gpu_ir_clngamma_lanczos(vec2(1.0, 0.0) - z);
  return _gpu_ir_cz_exp(l);
}`,
};
