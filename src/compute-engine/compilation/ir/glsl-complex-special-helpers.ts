/**
 * The GLSL helpers of `Gamma`, `Zeta`, `HurwitzZeta`, `PolyGamma`,
 * `LerchPhi` and `PolyLog` of a complex operand for the IR printer
 * (`print-glsl.ts`), on the `vec2` (re, im) of the complex lane, float32
 * (CE-1600).
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
 * - `Zeta(s, a)` of a real a (`_gpu_ir_czeta_generalized`), Wolfram's
 *   generalized zeta Σ |k + a|^-s (CE-1732): ζ(s, a) for a > 0, ζ(s) for
 *   a = 0; below, the terms (-(a + k))^-s while a + k < 0, then ζ(s, c) at
 *   c = a + ceil(-a) (ζ(s) at c = 0: the term a + k = 0 is left out), as
 *   the interpreter's `zetaGeneralizedComplexWithError`. As for ζ(s, a),
 *   the error is about 1e-5 of the sum of the sizes of these terms and of
 *   those of ζ(s, c), absolute next to a zero and where the terms cancel.
 *   NaN below a = -4200 (the shift limit of ζ(s, a)). `Digamma(z)` is
 *   ψ⁽⁰⁾(z) (`_gpu_ir_cpolygamma(0.0, z)`).
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
 * - Li_s(z) (`_gpu_ir_cpolylog`): z Φ(z, s, 1) by the series for
 *   |z| <= 1/2, the expansion in powers of ln z for |ln z| <= 3.5
 *   (`_gpu_ir_cpolylog_mu`, which holds 1/2 < |z| <= 2), the inversion
 *   formula past it (`_gpu_ir_cpolylog_inv`; NaN there for a Re s > 1 that
 *   is not an integer, and for an integer above 24).
 * - Φ(z, s, a) (`_gpu_ir_clerch_phi`): the series for |z| <= 1/2,
 *   Li_s(z)/z for a = 1, ζ(s, a) at z = 1, the series up to a large base
 *   point and its asymptotic expansion there for |z| <= 1
 *   (`_gpu_ir_clerch_asym`); NaN past the unit circle for a != 1, and
 *   where |ln z| < (|s| + 24)/1400 (next to z = 1, where the base point
 *   would pass 4,200 terms).
 *   Each of these sums keeps the sizes of its terms, and is NaN where they
 *   pass 100 times the value (`_gpu_ir_clerch_checked`): mostly
 *   `LerchPhi` for Re s < 0, whose terms grow as k^(-Re s).
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
  return _gpu_ir_churwitz_emm(s, s - vec2(1.0, 0.0), a).xy;
}`,
  // ζ(s, a) and the sum of the sizes of its terms, with sm1 = s - 1 from a
  // caller that knows it more exactly than s (the distance to the pole:
  // 1 - s rounds next to s = 0).
  _gpu_ir_churwitz_emm: `vec3 _gpu_ir_churwitz_emm(vec2 s, vec2 sm1, vec2 a) {
  if ((floatBitsToUint(s.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(s.y) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(a.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(a.y) & 0x7FFFFFFFu) >= 0x7F800000u) return vec3(${NAN});
  if (sm1.x == 0.0 && sm1.y == 0.0) return vec3(${INF});
  float r = max(3.0, 0.17507043740108486 * (_gpu_ir_chypot(s.x, s.y) + 32.0));
  float nf = max(0.0, ceil(r - a.x));
  if (nf > 4200.0) return vec3(${NAN});
  int n = int(nf);
  vec2 sum = vec2(0.0);
  float mag = 0.0;
  vec2 w = a;
  for (int k = 0; k < 4200; k++) {
    if (k >= n) break;
    if (w.x == 0.0 && w.y == 0.0) {
      if (s.x > 0.0) return vec3(${INF});
      if (s.x == 0.0) return vec3(${NAN});
    } else {
      vec2 t = _gpu_ir_cz_powm(w, s);
      sum += t;
      mag += abs(t.x) + abs(t.y);
    }
    w.x += 1.0;
  }
  vec2 p = _gpu_ir_cz_powm(w, s);
  vec2 iw = _gpu_ir_cinv(w);
  vec2 t1 = _gpu_ir_cz_mul(_gpu_ir_cz_mul(p, w), _gpu_ir_cinv(sm1));
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
  if (!(last <= 3.0e-5 * mag) || !(mag <= 3.4028234663852886e38)) return vec3(${NAN});
  return vec3(sum, mag);
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
  vec2 l = s * 0.6931471805599453 + (s - vec2(1.0, 0.0)) * 1.1447298858494002 + _gpu_ir_clnsinpi(0.5 * s) + _gpu_ir_clngamma_lanczos(u) + _gpu_ir_cz_ln(_gpu_ir_churwitz_emm(u, -s, vec2(1.0, 0.0)).xy);
  return _gpu_ir_cz_exp(l);
}`,
  // Zeta(s, a) of a real a, Wolfram's generalized zeta (see the header).
  _gpu_ir_czeta_generalized: `vec2 _gpu_ir_czeta_generalized(vec2 s, float a) {
  if (s.y == 0.0) return vec2(_gpu_ir_zeta_generalized(s.x, a), 0.0);
  if (a > 0.0) return _gpu_ir_churwitz_zeta(s, vec2(a, 0.0));
  if (a == 0.0) return _gpu_ir_czeta(s);
  if (!(a >= -4200.0)) return vec2(${NAN});
  int n = int(ceil(-a));
  vec2 sum = vec2(0.0);
  for (int k = 0; k < 4200; k++) {
    if (k >= n) break;
    sum += _gpu_ir_cz_powm(vec2(-(a + float(k)), 0.0), s);
  }
  float c = a + float(n);
  return sum + (c == 0.0 ? _gpu_ir_czeta(s) : _gpu_ir_churwitz_zeta(s, vec2(c, 0.0)));
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
  // ln Γ(z) (up to a multiple of 2πi): the Lanczos sum for Re z >= 1/2,
  // the reflection below.
  _gpu_ir_clngamma: `vec2 _gpu_ir_clngamma(vec2 z) {
  return z.x >= 0.5 ? _gpu_ir_clngamma_lanczos(z) : vec2(1.1447298858494002, 0.0) - _gpu_ir_clnsinpi(z) - _gpu_ir_clngamma_lanczos(vec2(1.0, 0.0) - z);
}`,
  // Γ(z): the real helper on the real axis (+∞ at a pole).
  _gpu_ir_cgamma: `vec2 _gpu_ir_cgamma(vec2 z) {
  if (z.y == 0.0) return vec2(_gpu_ir_gamma(z.x), 0.0);
  return _gpu_ir_cz_exp(_gpu_ir_clngamma(z));
}`,
  // z^k w^-s for an integer k >= 0 and w != 0, as one exp, from
  // l = (ln|z|, the argument of z in units of π in two parts, the first
  // with 10 bits after the point): k times the first part is exact for
  // k < 8192, so the phase k arg z keeps its digits when |z| = 1.
  _gpu_ir_clerch_term: `vec2 _gpu_ir_clerch_term(vec3 l, float k, vec2 w, vec2 s) {
  float lr = _gpu_ir_cz_log(_gpu_ir_chypot(w.x, w.y));
  float th = w.y == 0.0 ? (w.x < 0.0 ? 1.0 : 0.0) : _gpu_ir_carg(w) * 0.3183098861837907;
  float m = exp((k == 0.0 ? 0.0 : k * l.x) + s.y * th * 3.14159265358979 - s.x * lr);
  vec2 sc = _gpu_ir_sincospi(mod(k * l.y, 2.0) + k * l.z - (s.x * th + s.y * (lr * 0.3183098861837907)));
  return m * vec2(sc.y, sc.x);
}`,
  // The l of _gpu_ir_clerch_term for z.
  _gpu_ir_clerch_zl: `vec3 _gpu_ir_clerch_zl(vec2 z) {
  float th = z.y == 0.0 ? (z.x < 0.0 ? 1.0 : 0.0) : _gpu_ir_carg(z) * 0.3183098861837907;
  float hi = floor(th * 1024.0) / 1024.0;
  return vec3(_gpu_ir_cz_log(_gpu_ir_chypot(z.x, z.y)), hi, th - hi);
}`,
  // Σ_{k<n} z^k (a+k)^-s, n <= 4200, and the sum of the sizes of its terms
  // (z of the result). A term a + k = 0 is a pole for Re s > 0 (+∞, with
  // the size -1 that _gpu_ir_clerch_checked reads as a pole), NaN for
  // Re s = 0, and 0 for Re s < 0.
  _gpu_ir_clerch_head: `vec3 _gpu_ir_clerch_head(vec3 l, vec2 s, vec2 a, int n) {
  vec3 r = vec3(0.0);
  vec2 w = a;
  for (int k = 0; k < 4200; k++) {
    if (k >= n) break;
    if (w.x == 0.0 && w.y == 0.0) {
      if (s.x > 0.0) return vec3(${INF}, ${INF}, -1.0);
      if (s.x == 0.0) return vec3(${NAN});
    } else {
      vec2 t = _gpu_ir_clerch_term(l, float(k), w, s);
      r += vec3(t, abs(t.x) + abs(t.y));
    }
    w.x += 1.0;
  }
  return r;
}`,
  // Φ(z, s, a) for |z| <= 1/2 by its series, as (value, sum of the sizes of
  // the terms). It stops after three terms in a row that decrease, each
  // below 1e-9 of the sum of the sizes, past Re(a + k) > 0; NaN after 1,000
  // terms.
  _gpu_ir_clerch_series: `vec3 _gpu_ir_clerch_series(vec2 z, vec2 s, vec2 a) {
  vec3 l = _gpu_ir_clerch_zl(z);
  vec3 r = vec3(0.0);
  vec2 w = a;
  float prev = ${INF};
  int small = 0;
  for (int k = 0; k < 1000; k++) {
    float st = 0.0;
    if (w.x == 0.0 && w.y == 0.0) {
      if (s.x > 0.0) return vec3(${INF}, ${INF}, -1.0);
      if (s.x == 0.0) return vec3(${NAN});
    } else {
      vec2 t = _gpu_ir_clerch_term(l, float(k), w, s);
      st = abs(t.x) + abs(t.y);
      r += vec3(t, st);
    }
    small = w.x > 0.0 && st <= prev && st <= 1.0e-9 * r.z ? small + 1 : 0;
    if (small == 3) return r;
    prev = st;
    w.x += 1.0;
  }
  return vec3(${NAN});
}`,
  // Φ(z, s, a) for |z| <= 1, z != 0, 1: the series for k < n, then
  // z^n Φ(z, s, w), w = a + n, by its asymptotic expansion for a large w,
  // w^-s Σ_k b_k (s)_k w^-k, where Σ b_k t^k = 1/(1 - z e^-t) (Watson's
  // lemma on Φ = 1/Γ(s) ∫ t^(s-1) e^(-wt) / (1 - z e^-t) dt; for |z| <= 1
  // the function has no pole in Re t > 0). Its terms shrink by about
  // |s + k| / (|w| |ln z|): n makes Re w >= 3 (|s| + 24) / |ln z|, and
  // Re w >= |Im a|. As (value, sum of the sizes of the terms); NaN where n
  // passes 4,200 (next to z = 1).
  _gpu_ir_clerch_asym: `vec3 _gpu_ir_clerch_asym(vec2 z, vec2 s, vec2 a) {
  vec2 lz = _gpu_ir_cz_ln(z);
  float r = _gpu_ir_chypot(lz.x, lz.y);
  float nf = max(0.0, ceil(max(3.0 * (_gpu_ir_chypot(s.x, s.y) + 24.0) / r, abs(a.y)) - a.x));
  if (!(nf <= 4200.0)) return vec3(${NAN});
  vec3 l = _gpu_ir_clerch_zl(z);
  vec3 h = _gpu_ir_clerch_head(l, s, a, int(nf));
  if (h.z < 0.0) return h;
  vec2 w = vec2(a.x + nf, a.y);
  vec2 f = _gpu_ir_clerch_term(l, nf, w, s);
  vec2 iw = _gpu_ir_cinv(w);
  vec2 b[24];
  b[0] = _gpu_ir_cinv(vec2(1.0 - z.x, -z.y));
  for (int k = 0; k < 23; k++) {
    vec2 acc = b[k];
    for (int j = 0; j <= k; j++) acc -= _gpu_ir_cz_mul(b[j], b[k - j]);
    b[k + 1] = acc / float(k + 1);
  }
  vec2 sum = vec2(0.0);
  float mag = 0.0;
  float last = ${INF};
  float t1 = ${INF};
  vec2 q = vec2(1.0, 0.0);
  for (int k = 0; k < 24; k++) {
    vec2 t = _gpu_ir_cz_mul(b[k], q);
    sum += t;
    float t2 = t1;
    t1 = abs(t.x) + abs(t.y);
    mag += t1;
    // Two terms: at z = -1 every other b_k is 0.
    last = max(t1, t2);
    if (last <= 1.0e-9 * mag) break;
    q = _gpu_ir_cz_mul(q, _gpu_ir_cz_mul(s + vec2(float(k), 0.0), iw));
  }
  if (!(last <= 1.0e-7 * mag)) return vec3(${NAN});
  vec2 tail = _gpu_ir_cz_mul(f, sum);
  return vec3(h.xy + tail, h.z + (abs(f.x) + abs(f.y)) * mag);
}`,
  // (value, sum of the sizes of the terms) to vec2: NaN where the sum of
  // the sizes passes 100 times the size of the value (its float32 error,
  // up to about 3e-7 of that sum, would pass 3e-5 of the value). A pole
  // (the size -1) stays +∞; any other sum of sizes that is not finite (a
  // term that overflows at a point that is not a pole) is NaN.
  _gpu_ir_clerch_checked: `vec2 _gpu_ir_clerch_checked(vec3 r) {
  if (r.z < 0.0) return r.xy;
  if (!(r.z <= 3.4028234663852886e38)) return vec2(${NAN});
  if (!(r.z <= 100.0 * (abs(r.x) + abs(r.y)))) return vec2(${NAN});
  return r.xy;
}`,
  // Li_s(z) for 1/2 < |z| and |ln z| <= 3.5, z != 1, from μ = ln z
  // (|μ| < 2π): Γ(1-s)(-μ)^(s-1) + Σ_k ζ(s-k) μ^k / k!, and for an
  // integer s = m >= 1, the limit μ^(m-1)/(m-1)! (H_(m-1) - ln(-μ)) in place
  // of the first term and of the term k = m - 1. On the cut z > 1 the side
  // Im z < 0, as the interpreter (the argument of -μ is π). As (value, sum
  // of the sizes of the terms). The sum stops when two terms in a row are
  // below 1e-9 of the sizes, past k = max(Re s + 2, 1.7|s|): there the
  // terms shrink by about |μ|/2π (1 + |s|/(k+1)) <= 0.89 each (two terms,
  // since ζ(s-k) is 0 at a negative even integer). NaN after 128 terms.
  _gpu_ir_cpolylog_mu: `vec3 _gpu_ir_cpolylog_mu(vec2 s, vec2 z) {
  vec2 mu = _gpu_ir_cz_ln(z);
  vec2 lnm = _gpu_ir_cz_ln(-mu);
  bool isint = s.y == 0.0 && s.x == floor(s.x);
  float m = s.x;
  vec2 sing = vec2(0.0);
  if (isint && m >= 1.0) {
    if (m <= 200.0) {
      vec2 p = vec2(1.0, 0.0);
      float h = 0.0;
      for (int j = 1; j < 200; j++) {
        if (float(j) >= m) break;
        p = _gpu_ir_cz_mul(p, mu) / float(j);
        h += 1.0 / float(j);
      }
      sing = _gpu_ir_cz_mul(p, vec2(h, 0.0) - lnm);
    }
  } else {
    sing = _gpu_ir_cz_exp(_gpu_ir_clngamma(vec2(1.0 - s.x, -s.y)) + _gpu_ir_cz_mul(s - vec2(1.0, 0.0), lnm));
  }
  vec2 sum = sing;
  float mag = abs(sing.x) + abs(sing.y);
  float kmin = max(s.x + 2.0, 1.7 * _gpu_ir_chypot(s.x, s.y));
  vec2 p = vec2(1.0, 0.0);
  float t1 = ${INF};
  float t2 = ${INF};
  for (int k = 0; k < 128; k++) {
    if (!(isint && float(k) == m - 1.0)) {
      vec2 t = _gpu_ir_cz_mul(_gpu_ir_czeta(vec2(s.x - float(k), s.y)), p);
      t2 = t1;
      t1 = abs(t.x) + abs(t.y);
      sum += t;
      mag += t1;
    }
    if (float(k) >= kmin && max(t1, t2) <= 1.0e-9 * mag) break;
    p = _gpu_ir_cz_mul(p, mu) / float(k + 1);
  }
  if (!(max(t1, t2) <= 1.0e-9 * mag)) return vec3(${NAN});
  // The error of ζ(s - k) and of the first term, relative to their sizes,
  // grows with |Im s| (their phases): the sizes count 1 + |Im s| times, so
  // that _gpu_ir_clerch_checked gives NaN before the error passes 3e-5 of
  // the value (8.8e-5 at s = 4 + 10i, z = -6 - 2.25i without it).
  return vec3(sum, mag * (1.0 + abs(s.y)));
}`,
  // Li_s(z) for |z| > 2 by the inversion formula, with Li_s(1/z) by the
  // series and L = ln(-z) (on the cut z > 1, arg(-z) = π: the side
  // Im z < 0): for an integer m from 1 to 24,
  // Li_m(z) = -(2πi)^m/m! B_m(1/2 + L/(2πi)) - (-1)^m Li_m(1/z); for an
  // integer m <= 0, Li_0(z) = z/(1 - z) and Li_m(z) = (-1)^(m+1) Li_m(1/z);
  // otherwise, for Re s <= 1, with σ = ±1 the sign of Im s (+1 at 0),
  // Li_s(z) = (2π)^s/Γ(s) e^(σiπs/2) ζ(1-s, 1/2 + σL/(2πi)) - e^(σiπs) Li_s(1/z).
  // NaN for Re s > 1 that is not an integer, and for an integer above 24.
  _gpu_ir_cpolylog_inv: `vec3 _gpu_ir_cpolylog_inv(vec2 s, vec2 z) {
  vec2 iz = _gpu_ir_cinv(z);
  bool isint = s.y == 0.0 && s.x == floor(s.x);
  if (isint && s.x == 0.0) return vec3(_gpu_ir_cz_mul(z, _gpu_ir_cinv(vec2(1.0 - z.x, -z.y))), 0.0);
  if ((!isint && s.x > 1.0) || (isint && s.x > 24.0)) return vec3(${NAN});
  vec3 r = _gpu_ir_clerch_series(iz, s, vec2(1.0, 0.0));
  vec2 li = _gpu_ir_cz_mul(iz, r.xy);
  float mag = r.z * (abs(iz.x) + abs(iz.y));
  if (isint && s.x < 0.0) return vec3(mod(s.x, 2.0) == 0.0 ? -li : li, mag);
  vec2 lm = _gpu_ir_cz_ln(-z);
  vec2 rhs;
  vec2 other;
  // The sum of the sizes of the terms of rhs.
  float rsz;
  if (isint) {
    int m = int(s.x);
    float B[25] = float[25](1.0, -0.5, 1.0 / 6.0, 0.0, -1.0 / 30.0, 0.0, 1.0 / 42.0, 0.0, -1.0 / 30.0, 0.0, 5.0 / 66.0, 0.0, -691.0 / 2730.0, 0.0, 7.0 / 6.0, 0.0, -3617.0 / 510.0, 0.0, 43867.0 / 798.0, 0.0, -174611.0 / 330.0, 0.0, 854513.0 / 138.0, 0.0, -236364091.0 / 2730.0);
    vec2 x = vec2(0.5 + lm.y * 0.15915494309189535, -lm.x * 0.15915494309189535);
    vec2 bp = vec2(0.0);
    float bsz = 0.0;
    vec2 xp = vec2(1.0, 0.0);
    float c = 1.0;
    float f = 1.0;
    for (int j = 0; j <= 24; j++) {
      if (j > m) break;
      vec2 t = c * B[m - j] * xp;
      bp += t;
      bsz += abs(t.x) + abs(t.y);
      xp = _gpu_ir_cz_mul(xp, x);
      c = c * float(m - j) / float(j + 1);
      if (j > 0) f *= 6.283185307179586 / float(j);
    }
    // f = (2π)^m / m!, times i^m.
    vec2 im = m % 4 == 0 ? vec2(1.0, 0.0) : m % 4 == 1 ? vec2(0.0, 1.0) : m % 4 == 2 ? vec2(-1.0, 0.0) : vec2(0.0, -1.0);
    rhs = -f * _gpu_ir_cz_mul(im, bp);
    rsz = f * bsz;
    other = m % 2 == 0 ? li : -li;
  } else {
    float sg = s.y < 0.0 ? -1.0 : 1.0;
    vec2 q = vec2(0.5 + sg * lm.y * 0.15915494309189535, -sg * lm.x * 0.15915494309189535);
    vec2 lf = s * 1.8378770664093453 - _gpu_ir_clngamma(s) + sg * 1.5707963267948966 * vec2(-s.y, s.x);
    vec2 e = _gpu_ir_cz_exp(lf);
    // -s is the exact distance of 1 - s to the pole of ζ.
    vec3 h = _gpu_ir_churwitz_emm(vec2(1.0 - s.x, -s.y), -s, q);
    rhs = _gpu_ir_cz_mul(e, h.xy);
    rsz = (abs(e.x) + abs(e.y)) * h.z;
    other = _gpu_ir_cz_mul(_gpu_ir_cz_exp(sg * 3.14159265358979 * vec2(-s.y, s.x)), li);
  }
  vec2 v = rhs - other;
  return vec3(v, rsz + abs(other.x) + abs(other.y) + mag);
}`,
  // PolyLog(s, z): the real helper on the real axis where it has a value;
  // ζ(s) at z = 1; z Φ(z, s, 1) by the series for |z| <= 1/2; then
  // _gpu_ir_cpolylog_mu for |ln z| <= 3.5, which holds 1/2 < |z| <= 2;
  // then _gpu_ir_cpolylog_inv.
  _gpu_ir_cpolylog: `vec2 _gpu_ir_cpolylog(vec2 s, vec2 z) {
  if ((floatBitsToUint(s.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(s.y) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(z.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(z.y) & 0x7FFFFFFFu) >= 0x7F800000u) return vec2(${NAN});
  if (s.y == 0.0 && z.y == 0.0) {
    float r = _gpu_ir_poly_log(s.x, z.x);
    if ((floatBitsToUint(r) & 0x7FFFFFFFu) <= 0x7F800000u) return vec2(r, 0.0);
  }
  if (z.x == 1.0 && z.y == 0.0) return _gpu_ir_czeta(s);
  if (_gpu_ir_chypot(z.x, z.y) <= 0.5) {
    vec3 r = _gpu_ir_clerch_series(z, s, vec2(1.0, 0.0));
    return _gpu_ir_cz_mul(z, _gpu_ir_clerch_checked(r));
  }
  vec2 mu = _gpu_ir_cz_ln(z);
  if (_gpu_ir_chypot(mu.x, mu.y) <= 3.5) return _gpu_ir_clerch_checked(_gpu_ir_cpolylog_mu(s, z));
  return _gpu_ir_clerch_checked(_gpu_ir_cpolylog_inv(s, z));
}`,
  // LerchPhi(z, s, a): the real helper on the real axis where it has a
  // value; the series for |z| <= 1/2; Li_s(z)/z for a = 1; ζ(s, a) at
  // z = 1; _gpu_ir_clerch_asym for |z| <= 1; NaN past the unit circle.
  _gpu_ir_clerch_phi: `vec2 _gpu_ir_clerch_phi(vec2 z, vec2 s, vec2 a) {
  if ((floatBitsToUint(z.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(z.y) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(s.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(s.y) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(a.x) & 0x7FFFFFFFu) >= 0x7F800000u || (floatBitsToUint(a.y) & 0x7FFFFFFFu) >= 0x7F800000u) return vec2(${NAN});
  if (z.y == 0.0 && s.y == 0.0 && a.y == 0.0) {
    float r = _gpu_ir_lerch_phi(z.x, s.x, a.x);
    if ((floatBitsToUint(r) & 0x7FFFFFFFu) <= 0x7F800000u) return vec2(r, 0.0);
  }
  float rz = _gpu_ir_chypot(z.x, z.y);
  if (rz <= 0.5) return _gpu_ir_clerch_checked(_gpu_ir_clerch_series(z, s, a));
  if (a.x == 1.0 && a.y == 0.0) return _gpu_ir_cz_mul(_gpu_ir_cpolylog(s, z), _gpu_ir_cinv(z));
  if (z.x == 1.0 && z.y == 0.0) return _gpu_ir_churwitz_zeta(s, a);
  if (rz <= 1.0) return _gpu_ir_clerch_checked(_gpu_ir_clerch_asym(z, s, a));
  return vec2(${NAN});
}`,
};
