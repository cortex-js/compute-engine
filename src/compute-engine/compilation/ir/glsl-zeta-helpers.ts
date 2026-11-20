/**
 * The GLSL helpers of the zeta family for the IR printer (`print-glsl.ts`):
 * `PolyGamma` of an integer order, the Hurwitz zeta function, Wolfram's
 * generalized `Zeta(s, a)`, the Lerch transcendent, the polylogarithm and
 * the harmonic numbers, of real operands, real-valued (float32).
 *
 * The text of the deleted GPU target's preambles
 * (`GPU_POLYGAMMA_PREAMBLE_GLSL`, `GPU_ZETA_PREAMBLE_GLSL` and
 * `GPU_LERCH_PREAMBLE_GLSL` in `git show
 * 384222963:src/compute-engine/compilation/gpu-preambles.ts`, whose doc
 * comments give the methods, the regions and the accuracy measured on a GPU
 * against mpmath), one entry per function, with the names of this printer:
 * `_gpu_` is `_gpu_ir_`, the Riemann zeta of these helpers is
 * `_gpu_ir_zeta_riemann` (`_gpu_ir_zeta` is the printer's own), Γ, ln Γ, ψ
 * and ψ₁ are the printer's `_gpu_ir_gamma`, `_gpu_ir_gammaln`,
 * `_gpu_ir_digamma` and `_gpu_ir_trigamma`, and NaN and +∞ are their bit
 * patterns. `_gpu_ir_polygamma` answers the order -1, ln Γ(x), as the
 * JavaScript kernel. The sine of the reduced argument of
 * `_gpu_ir_riemann_zeta` and `_gpu_ir_zeta_fourier` is `_gpu_ir_sincospi`:
 * a renderer's `sin` is 6e-5 off at π/4 (SwiftShader).
 * `test/compute-engine/gpu-lerch-f32-model.ts` is a float32 model of the
 * zeta and Lerch functions, statement by statement. The harmonic numbers
 * (`_gpu_ir_harmonic`, `_gpu_ir_harmonic2`) are not from that target.
 *
 * A helper is NaN where the value is complex, and where its terms cancel or
 * no method vouches for its value: `_gpu_ir_polygamma` next to a zero for
 * x < 0, and for an order above 24; `_gpu_ir_zeta_shifted` next to a zero
 * of ζ(s, a); `_gpu_ir_lerch_phi` and `_gpu_ir_poly_log` where their error
 * estimates exceed 3e-5 of the value; `_gpu_ir_harmonic` and
 * `_gpu_ir_harmonic2` likewise (the IR README lists the points).
 * `print-glsl.ts` finds the helpers that each one calls in its text.
 */

// prettier-ignore
export const GLSL_ZETA_HELPERS: Readonly<Record<string, string>> = {
  _gpu_ir_polygamma: `float _gpu_ir_polygamma(float n, float x) {
  // The order -1 is ln Γ(x) for x > 0, +∞ at a pole, NaN elsewhere.
  if (n == -1.0)
    return x > 0.0 ? _gpu_ir_gammaln(x) : x == floor(x) && x >= -3.4028234663852886e38 ? uintBitsToFloat(0x7f800000u) : uintBitsToFloat(0x7fc00000u);
  if (n == 0.0) return _gpu_ir_digamma(x);
  if (n == 1.0) return _gpu_ir_trigamma(x);
  if (n != floor(n) || n < 0.0 || n > 24.0) return uintBitsToFloat(0x7fc00000u);
  if (x <= 0.0 && x == floor(x)) // a pole, and -inf: see _gpu_ir_digamma
    return x >= -3.4028234663852886e38 ? uintBitsToFloat(0x7f800000u) : uintBitsToFloat(0x7fc00000u);
  if (x < -4096.0) return uintBitsToFloat(0x7fc00000u); // one term per unit of |x|
  if (x > 3.4e38) return 0.0; // +inf
  float fact = 1.0;
  for (int j = 2; j <= 24; j++) {
    if (float(j) > n) break;
    fact *= float(j);
  }
  float lf = log(fact);
  float n1 = n + 1.0;
  // With an odd power n + 1, a term at a negative z is negative.
  bool oddPower = mod(n1, 2.0) == 1.0;
  float sum = 0.0;
  float mag = 0.0;
  float xmax = 0.0;
  float z = x;
  for (int k = 0; k < 4132; k++) {
    if (z >= n + 10.0) break;
    float e = lf - n1 * log(abs(z));
    float t = exp(e);
    sum += (z < 0.0 && oddPower) ? -t : t;
    mag += t;
    xmax = max(xmax, abs(e));
    z += 1.0;
  }
  // The asymptotic series of the double kernel:
  // (n-1)!/z^n + n!/(2 z^(n+1)) + sum B_2k (2k+n-1)!/((2k)! z^(2k+n)),
  // summed in units of its leading term A = (n-1)!/z^n, so that no term
  // underflows to a subnormal (which a GPU flushes to 0) before the last
  // product: n!/z^(n+1) is 5e-39 at n = 20, z = 500, where the value is
  // -1.3e-37.
  float A = exp(lf - log(n) - n * log(z));
  float tail = 1.0 + 0.5 * n / z;
  float f = n * n1 / (2.0 * z * z);
  float b[10] = float[10](
    1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0, 5.0 / 66.0,
    -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0, 43867.0 / 798.0,
    -174611.0 / 330.0
  );
  float prev = 3.0e38;
  for (int k = 1; k <= 10; k++) {
    float term = b[k - 1] * f;
    if (abs(term) >= prev) break;
    tail += term;
    prev = abs(term);
    float m = float(2 * k);
    f = f * (m + n) * (m + n + 1.0) / ((m + 1.0) * (m + 2.0) * z * z);
  }
  tail *= A;
  float res = sum + tail;
  // 500 = 3e-5 / 6e-8: the terms of both signs cancel where res is small
  // against their sizes. The ratio, not a product, so that nothing
  // overflows next to f32's largest value.
  if (x < 0.0 && oddPower && !((mag + abs(tail)) / abs(res) <= 500.0 / (6.0 + xmax)))
    return uintBitsToFloat(0x7fc00000u);
  return mod(n, 2.0) == 0.0 ? -res : res;
}`,
  _gpu_ir_zeta_pow: `float _gpu_ir_zeta_pow(float x, float e) {
  if (x >= 0.0) return pow(x, e);
  if (e != floor(e)) return uintBitsToFloat(0x7fc00000u);
  float r = pow(-x, e);
  if (mod(abs(e), 2.0) == 1.0) return -r;
  return r;
}`,
  _gpu_ir_hurwitz_zeta_em: `float _gpu_ir_hurwitz_zeta_em(float s, float a, float sm1) {
  int n = int(ceil(15.0 - a));
  if (n < 0) n = 0;
  float sum = 0.0;
  float z = a;
  for (int k = 0; k < n; k++) {
    sum += _gpu_ir_zeta_pow(z, -s);
    z += 1.0;
  }
  // Tail: closed-form integral + half-term (DLMF 25.11.9). The integral
  // term is the pole at s = 1: it uses sm1 = s - 1 as the caller knows it.
  sum += pow(z, -sm1) / sm1 + 0.5 * pow(z, -s);
  // Bernoulli correction series, same ten B_2j as BERNOULLI_2K
  // (special-functions.ts); u carries the term divided by B_2j.
  float b[10] = float[10](
    1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0, 5.0 / 66.0,
    -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0, 43867.0 / 798.0,
    -174611.0 / 330.0
  );
  float u = (s / 2.0) * pow(z, -(s + 1.0));
  float prevAbs = 3.0e38;
  for (int j = 1; j <= 10; j++) {
    float term = u * b[j - 1];
    if (abs(term) >= prevAbs) break;
    sum += term;
    prevAbs = abs(term);
    float m = float(2 * j);
    u = u * (s + m - 1.0) * (s + m) / ((m + 1.0) * (m + 2.0) * z * z);
  }
  return sum;
}`,
  _gpu_ir_zeta_gamma_2pi: `// Gamma(x) / (2 pi)^x for x >= 1, as vec2(value, error estimate in units of
// the f32 rounding error 6e-8). Stirling's series after a shift to y >= 8:
// (y/(2 pi e))^y sqrt(2 pi/y) e^corr, divided by x (x+1) ... (y-1) and
// multiplied by (2 pi)^(y-x). Neither Gamma(x) nor (2 pi)^x is formed (they
// overflow f32 near x = 35 and x = 48), and the largest pow argument is
// about y log2(y/(2 pi e)), 15 at x = 25.5, where the Lanczos _gpu_ir_gamma
// calls pow with an argument of about 126, and 122 at x = 64, the end of
// the range _gpu_ir_riemann_zeta uses.
vec2 _gpu_ir_zeta_gamma_2pi(float x) {
  const float PI = 3.14159265358979;
  float p = 1.0;
  float y = x;
  for (int k = 0; k < 8; k++) {
    if (y >= 8.0) break;
    p *= y;
    y += 1.0;
  }
  float y2 = y * y;
  float corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * y2)) / y2) / y;
  float base = y / 17.079468445347132; // y / (2 pi e)
  float v = pow(base, y) * sqrt(2.0 * PI / y) * (exp(corr) / p) *
    pow(2.0 * PI, y - x);
  return vec2(v, abs(v) * (12.0 + abs(y * log2(base)) + y));
}`,
  _gpu_ir_riemann_zeta: `// zeta(s), with sm1 = s - 1 passed by a caller that knows it more exactly
// than s - 1.0 can recover it from a rounded s.
float _gpu_ir_riemann_zeta(float s, float sm1) {
  const float PI = 3.14159265358979;
  if (sm1 == 0.0) return uintBitsToFloat(0x7f800000u); // pole
  if (s == 0.0) return -0.5;
  if (s < 0.0) {
    if (s == floor(s) && mod(s, 2.0) == 0.0) return 0.0; // trivial zero
    // Below s = -63 the f32 error passes 3e-5 in an f32 model whose log2 is
    // 2.5 ulp off, and near s = -64.8 pow(y / (2 pi e), y) overflows.
    if (s < -63.0) return uintBitsToFloat(0x7fc00000u);
    // sin(PI s/2) = (-1)^n sin(PI (s/2 - n)): s/2 - n is exact, so the
    // sine keeps its relative accuracy next to an even s.
    float hs = s / 2.0;
    float n = floor(hs + 0.5);
    float sinHalfPiS = _gpu_ir_sincospi(hs - n).x;
    if (mod(n, 2.0) != 0.0) sinHalfPiS = -sinHalfPiS;
    // 1 - s is rounded, but its distance to the pole, -s, is exact.
    float oneMinusS = 1.0 - s;
    // 2^s pi^(s-1) Gamma(1-s) = 2 Gamma(1-s)/(2 pi)^(1-s). From 1 - s = 8
    // on, from Stirling's series: with the Lanczos Gamma, zeta(s) was up to
    // 3.3e-5 off near s = -22 in an f32 model whose log2 is 2.5 ulp off.
    if (oneMinusS >= 8.0)
      return 2.0 * _gpu_ir_zeta_gamma_2pi(oneMinusS).x * sinHalfPiS *
        _gpu_ir_hurwitz_zeta_em(oneMinusS, 1.0, -s);
    return pow(2.0, s) * pow(PI, s - 1.0) * sinHalfPiS *
      _gpu_ir_gamma(oneMinusS) * _gpu_ir_hurwitz_zeta_em(oneMinusS, 1.0, -s);
  }
  return _gpu_ir_hurwitz_zeta_em(s, 1.0, sm1);
}`,
  _gpu_ir_zeta_riemann: `float _gpu_ir_zeta_riemann(float s) {
  return _gpu_ir_riemann_zeta(s, s - 1.0);
}`,
  _gpu_ir_zeta_near_one_mag: `// zeta(s, 1+h) = sum C(-s,k) h^k zeta(s+k), |h| < 1 — no cancellation,
// since each zeta(s+k) reflects to Re >= 0. See zetaNearOneComplex. The
// stop tolerance is near the f32 epsilon (1.2e-7), and 100 terms reach it
// for every s >= -24.5. Below, the series answers NaN: with _gpu_ir_zeta_riemann
// defined down to s = -63, 46 of 1500 values of zeta(s, a) for s from -63.5
// to -24.5 were more than 3e-5 off.
// vec2(the value, the sum of the sizes of its terms).
vec2 _gpu_ir_zeta_near_one_mag(float s, float h) {
  if (s < -24.5) return vec2(uintBitsToFloat(0x7fc00000u));
  float sum = _gpu_ir_zeta_riemann(s);
  float mag = abs(sum);
  float c = 1.0;
  float hk = 1.0;
  float largest = abs(sum);
  int small = 0;
  for (int k = 1; k < 100; k++) {
    hk *= h;
    if (hk == 0.0) break;
    // f = 1 - k - s is exact when s is near 1 - k, and s + k - 1 = -f is
    // then the exact distance from s + k to the pole of zeta.
    float f = float(1 - k) - s;
    if (f == 0.0) {
      float last = c * hk * (-1.0 / float(k));
      return vec2(sum + last, mag + abs(last));
    }
    c = c * f / float(k);
    float term = c * hk * _gpu_ir_riemann_zeta(s + float(k), -f);
    sum += term;
    float size = abs(term);
    mag += size;
    largest = max(largest, size);
    if (size <= 1e-7 * largest) {
      if (++small == 2) break;
    } else small = 0;
  }
  return vec2(sum, mag);
}`,
  _gpu_ir_zeta_near_one: `float _gpu_ir_zeta_near_one(float s, float h) {
  return _gpu_ir_zeta_near_one_mag(s, h).x;
}`,
  _gpu_ir_zeta_em1: `// 1 - e^(-y) for y >= 0, without the cancellation of 1.0 - exp(-y) at a
// small y (a Taylor polynomial below y = 0.25).
float _gpu_ir_zeta_em1(float y) {
  if (y < 0.25) {
    float r = 1.0 - y / 7.0;
    r = 1.0 - y / 6.0 * r;
    r = 1.0 - y / 5.0 * r;
    r = 1.0 - y / 4.0 * r;
    r = 1.0 - y / 3.0 * r;
    r = 1.0 - y / 2.0 * r;
    return y * r;
  }
  return 1.0 - exp(-y);
}`,
  _gpu_ir_zeta_hermite: `// zeta(s, b) for 0 < b <= 1 and s < 1 by Hermite's integral (DLMF
// 25.11.29): b^(-s)/2 + b^(1-s)/(s-1) plus
// 2 int_0^inf sin(s atan(t/b)) (b^2 + t^2)^(-s/2) / (e^(2 pi t) - 1) dt.
// The two closed terms are one product, b^(-s) (s - 1 + 2b) / (2 (s - 1)):
// 2b - 1 is exact for b >= 1/4, so the factor s + (2b - 1) has a single
// rounding, relative to itself, where the two terms cancel (at s = 1/2,
// b = 0.3 they are 0.91 and -1.10 and the value is 0.011). The integrand is formed
// in one exp, so that a large -s does not overflow before e^(-2 pi t)
// applies. 8-point Gauss-Legendre panels, b/2 wide from t = 0 and doubling
// up to 1 wide (the integrand varies on the scale b next to t = 0, and has
// poles at t = +-i), until the panel mean is below 1e-9 of the largest one
// past the peak of the envelope at t = -s/(2 pi). Returns vec2(value, error
// estimate in units of the f32 rounding error 6e-8): the rounding of the
// closed product and, for each node, of its exp argument, of the log of
// b^2 + t^2 (times s/2), and of the sine argument s atan(t/b). vec2(0,
// 3e38) when 40 panels do not reach the stopping test (b >= 2^-10 takes
// at most 17 on s from -3 to 1).
vec2 _gpu_ir_zeta_hermite(float s, float b) {
  const float PI = 3.14159265358979;
  const float gx[4] = float[4](0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  const float gw[4] = float[4](0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  float k = pow(b, -s) / (2.0 * (s - 1.0));
  // max() keeps a fast-math compiler from reassociating the sum into
  // (s + 2b) - 1, which loses s next to s = 0 (6.7% off at s = -1e-6,
  // b = 1/2 on an Apple GPU, where 2b - 1 = 0).
  float c = s + max(2.0 * b - 1.0, -1.0);
  float closed = k * c;
  float err = abs(k) * (abs(c) + (b < 0.25 ? 1.0 : 0.0)) +
    abs(closed) * (4.0 + abs(s * log2(b)));
  float b2 = b * b;
  float tPeak = max(0.0, -s / (2.0 * PI));
  float sum = 0.0;
  float largest = 0.0;
  float x = 0.0;
  bool done = false;
  for (int p = 0; p < 40; p++) {
    float w = x == 0.0 ? 0.5 * b : min(x, 1.0);
    float cc = x + 0.5 * w;
    float r = 0.5 * w;
    float size = 0.0;
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 2; j++) {
        float t = cc + (j == 0 ? -r : r) * gx[i];
        float y = 2.0 * PI * t;
        float lr = log(b2 + t * t);
        float ex = -0.5 * s * lr - y - log(_gpu_ir_zeta_em1(y));
        float th = s * atan(t / b);
        float q = r * gw[i] * exp(ex);
        float f = q * sin(th);
        sum += f;
        size += abs(f);
        err += 2.0 * (abs(f) * (6.0 + abs(ex) + 0.5 * abs(s) * (2.0 + abs(lr))) +
          q * abs(th));
      }
    }
    x += w;
    float mean = size / w;
    largest = max(largest, mean);
    if (x > tPeak && x >= 1.0 && mean <= 1e-9 * largest) {
      done = true;
      break;
    }
  }
  if (!done) return vec2(0.0, 3.0e38);
  float v = closed + 2.0 * sum;
  return vec2(v, err + 2.0 * abs(v));
}`,
  _gpu_ir_zeta_fourier: `// zeta(s, b) for s <= -3 and 0 < b <= 1 by Hurwitz's formula, the Fourier
// series in the base point:
// 2 Gamma(1-s)/(2 pi)^(1-s) sum_k sin(2 pi k b + pi s/2) / k^(1-s). Its
// terms fall like k^(s-1) and do not cancel; 64 of them leave a tail below
// 64^s/(-s) of the prefactor, 1.3e-6 at s = -3. The sine argument is
// reduced exactly: pi (2 frac(k b) + (s/2 mod 2)), minus its nearest
// integer n, with the sign (-1)^n. Returns vec2(value, error estimate in
// units of 6e-8): the pow roundings, the rounding of the argument (about
// 20 k units of each term's size), the tail and the prefactor.
vec2 _gpu_ir_zeta_fourier(float s, float b) {
  const float PI = 3.14159265358979;
  vec2 g = _gpu_ir_zeta_gamma_2pi(1.0 - s);
  float hs = s / 2.0;
  float ps = hs - 2.0 * floor(hs / 2.0);
  float sum = 0.0;
  float err = 0.0;
  for (int k = 1; k <= 64; k++) {
    float fk = float(k);
    float kb = fk * b;
    float ph = 2.0 * (kb - floor(kb)) + ps;
    float n = floor(ph + 0.5);
    float sn = _gpu_ir_sincospi(ph - n).x;
    if (mod(n, 2.0) != 0.0) sn = -sn;
    float pk = pow(fk, s - 1.0);
    float t = sn * pk;
    sum += t;
    err += abs(t) * (4.0 + abs((s - 1.0) * log2(fk))) + pk * (fk * 20.0);
  }
  float tail = pow(64.0, s) / (-s);
  return vec2(2.0 * g.x * sum,
    2.0 * g.x * (err + tail / 6.0e-8 + 2.0 * abs(sum)) + 2.0 * g.y * abs(sum));
}`,
  _gpu_ir_zeta_shifted: `// zeta(s, a) for a > 0 and -24.5 <= s < 1 from the base point b = a - m in
// (0, 1]: zeta(s, a) = zeta(s, b) - sum_{j<m} (b + j)^(-s). zeta(s, b) is
// the Fourier series for s <= -3, the Taylor series in b for b < 2^-10
// (zeta(s, b) = b^(-s) + zeta(s, 1 + b), where Hermite's integral would
// need more panels), and Hermite's integral otherwise. NaN when the error
// estimate exceeds 3e-5 of the value (next to a zero of zeta(s, a)).
float _gpu_ir_zeta_shifted(float s, float a) {
  float m = ceil(a) - 1.0;
  float b = a - m;
  vec2 r;
  if (s <= -3.0) r = _gpu_ir_zeta_fourier(s, b);
  else if (b < 0.0009765625) {
    float t = pow(b, -s);
    float zn = _gpu_ir_zeta_near_one(s, b);
    r = vec2(zn + t, 64.0 * abs(zn) + abs(t) * (3.0 + abs(s * log2(b))));
  } else r = _gpu_ir_zeta_hermite(s, b);
  float z = r.x;
  float err = r.y;
  // m <= 123: the caller keeps a below 4 * edge <= 124.
  for (int j = 0; j < 128; j++) {
    if (float(j) >= m) break;
    float br = b + float(j);
    float t = pow(br, -s);
    z -= t;
    err += abs(t) * (3.0 + float(j) + abs(s * log2(br)));
  }
  err += abs(z) * (m + 2.0);
  if (!(6.0e-8 * err <= 3.0e-5 * abs(z))) return uintBitsToFloat(0x7fc00000u);
  return z;
}`,
  _gpu_ir_zeta_negative_terms: `// The sum of the sizes |a + k|^(-s) of the terms of zeta(s, a) with
// a + k < 0: of an integer s > 0 they cancel those of a + k > 0 (exactly at
// a half-integer a for an odd s).
float _gpu_ir_zeta_negative_terms(float s, float a) {
  float e = 0.0;
  int n = int(ceil(-a));
  for (int k = 0; k < n; k++) e += pow(abs(a + float(k)), -s);
  return e;
}`,
  _gpu_ir_hurwitz_zeta: `float _gpu_ir_hurwitz_zeta(float s, float a) {
  if (s == 1.0) return uintBitsToFloat(0x7f800000u); // pole, every base point a
  if (s == 0.0) return 0.5 - a;
  if (a == 1.0) return _gpu_ir_zeta_riemann(s);
  bool aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) return uintBitsToFloat(0x7f800000u); // (a+k) = 0 term diverges
  if (a < 0.0 && s != floor(s)) return uintBitsToFloat(0x7fc00000u); // complex value
  if (a < -1.0e6) return uintBitsToFloat(0x7fc00000u);
  float edge = max(12.0, ceil(abs(s)) + 6.0);
  // Where the Euler-Maclaurin terms cancel: s < 1/2 short of a = 4 * edge,
  // and 1/2 <= s < 1 below a = 1 (the zeros of zeta(s, a) there).
  if (a > 0.0 && s >= -24.5 && s < 1.0 && (s < 0.5 ? a < 4.0 * edge : a < 1.0))
    return _gpu_ir_zeta_shifted(s, a);
  if (s >= 0.0 || a >= 4.0 * edge) {
    float z = _gpu_ir_hurwitz_zeta_em(s, a, s - 1.0);
    // Below a = 0 the terms (a + k)^(-s) of both signs cancel (exactly at a
    // half-integer a for an odd s: zeta(25, -1.5) is 1.1e-10 from terms of
    // 2^25): NaN where the error of their sizes passes 3e-5 of the value.
    if (a < 0.0 && !(6.0e-8 * 8.0 * _gpu_ir_zeta_negative_terms(s, a) <= 3.0e-5 * abs(z)))
      return uintBitsToFloat(0x7fc00000u);
    return z;
  }
  // Shift a to 1+h (|h| <= 3/4) and expand in Taylor series — see
  // hurwitzZetaComplex's doc comment for why EM alone cancels here.
  float m = floor(a - 0.5);
  float h = a - m - 1.0;
  if (abs(h) > 0.75) return _gpu_ir_hurwitz_zeta_em(s, a, s - 1.0);
  // NaN where the error estimate, in units of the float32 rounding error
  // 6e-8, passes 3e-5 of the value, as in _gpu_ir_zeta_shifted: the terms
  // of the series (8 units each) and of the shift cancel next to a zero
  // (zeta(-24, -1/2) is 0.5^24 from terms of 1e3, and was 0.0197). On
  // SwiftShader, 300 points with an integer s from -24 to -1 and a from
  // -10 to 0 are within 2.1e-5, none NaN.
  vec2 r = _gpu_ir_zeta_near_one_mag(s, h);
  float z = r.x;
  float err = 8.0 * r.y;
  int steps = int(abs(m));
  for (int j = 0; j < steps; j++) {
    float br = m > 0.0 ? h + 1.0 + float(j) : a + float(j);
    if (br == 0.0) continue;
    float t = _gpu_ir_zeta_pow(br, -s);
    z = m > 0.0 ? z - t : z + t;
    err += abs(t) * (3.0 + float(j) + abs(s * log2(abs(br))));
  }
  err += abs(z) * (abs(m) + 2.0);
  if (!(6.0e-8 * err <= 3.0e-5 * abs(z))) return uintBitsToFloat(0x7fc00000u);
  return z;
}`,
  _gpu_ir_zeta_generalized: `float _gpu_ir_zeta_generalized(float s, float a) {
  if (s == 1.0) return uintBitsToFloat(0x7f800000u); // pole, every base point a
  if (s == 0.0) return 0.5 - a; // every term is 1, the omitted one included
  if (a > 0.0) return _gpu_ir_hurwitz_zeta(s, a);
  if (a == 0.0) return _gpu_ir_zeta_riemann(s);
  if (a < -1.0e6) return uintBitsToFloat(0x7fc00000u);
  int n = int(ceil(-a));
  float sum = 0.0;
  for (int k = 0; k < n; k++) sum += pow(-(a + float(k)), -s);
  float cur = a + float(n);
  if (cur == 0.0) cur = 1.0; // drop the (k + a) = 0 term
  return sum + _gpu_ir_hurwitz_zeta(s, cur);
}`,
  _gpu_ir_lerch_series: `vec2 _gpu_ir_lerch_series(float z, float s, float a) {
  int n0 = a < 0.0 ? int(ceil(-a)) : 0;
  float az = abs(z);
  float sum = 0.0;
  float zk = 1.0;
  float prev = 3.0e38;
  // For the error estimate: the terms weighted by the roundings of z^k (k
  // of them), their moduli, and the range of |a + k| (pow(b, -s) is within
  // about 6e-8 (2 + |s log2 b|) relative on a GPU).
  float err = 0.0;
  float sizes = 0.0;
  float bmin = 3.0e38;
  float bmax = 0.0;
  int settled = 0;
  for (int k = 0; k < n0 + 4096; k++) {
    float b = a + float(k);
    float t = (b != 0.0) ? zk * _gpu_ir_zeta_pow(b, -s) : 0.0;
    sum += t;
    float size = abs(t);
    err += size * (2.0 + float(k));
    sizes += size;
    if (b != 0.0) {
      bmin = min(bmin, abs(b));
      bmax = max(bmax, abs(b));
    }
    if (b > 0.0) {
      float rho = max(size / prev, az);
      if (size == 0.0 ||
          (size < prev && rho < 1.0 &&
           size * rho / (1.0 - rho) <= 1e-7 * abs(sum))) {
        settled++;
        if (settled == 3) {
          float lb = max(abs(log2(bmin)), abs(log2(bmax)));
          float bound = 6.0e-8 * (err + sizes * (2.0 + abs(s * lb)));
          if (!(bound <= 3.0e-5 * abs(sum))) return vec2(0.0);
          // A GPU flushes a term below the smallest normal f32 (1.2e-38) to
          // zero. The flushed tail is at most 1.2e-38 / (1 - |z|): decline
          // unless that is below 2^-24 of the sum. (Not rho: after a flushed
          // term, prev can be 0 and rho 0/0.)
          if (abs(sum) * (1.0 - az) < 1.9721523e-31) return vec2(0.0);
          return vec2(sum, 1.0);
        }
      } else {
        settled = 0;
      }
      prev = size;
    }
    zk *= z;
  }
  return vec2(0.0);
}`,
  _gpu_ir_lerch_euler: `vec2 _gpu_ir_lerch_euler(float z, float s, float a) {
  int n0 = a <= 0.0 ? int(floor(-a)) + 1 : 0;
  float head = 0.0;
  float zn = 1.0;
  float largest = 0.0;
  for (int k = 0; k < n0; k++) {
    float b = a + float(k);
    float t = (b != 0.0) ? zn * _gpu_ir_zeta_pow(b, -s) : 0.0;
    head += t;
    largest = max(largest, abs(t));
    zn *= z;
  }
  float b0 = a + float(n0);
  float w[65];
  int nterm = 0;
  float sum = 0.0;
  float zPow = 1.0;
  int settled = 0;
  for (int k = 0; k < 64; k++) {
    float cur = zPow * pow(b0 + float(k), -s);
    float inc;
    if (k == 0) {
      nterm = 1;
      w[1] = cur;
      inc = 0.5 * cur;
    } else {
      float tmp = w[1];
      w[1] = cur;
      for (int j = 1; j <= nterm - 1; j++) {
        float dum = w[j + 1];
        w[j + 1] = 0.5 * (w[j] + tmp);
        tmp = dum;
      }
      if (nterm >= 64) return vec2(0.0);
      w[nterm + 1] = 0.5 * (w[nterm] + tmp);
      if (abs(w[nterm + 1]) <= abs(w[nterm])) {
        nterm++;
        inc = 0.5 * w[nterm];
      } else {
        inc = w[nterm + 1];
      }
    }
    sum += inc;
    zPow *= z;
    if (k > 4 && abs(inc) <= 1e-7 * abs(sum)) {
      settled++;
      if (settled == 3) {
        // A GPU flushes a term below the smallest normal f32 (1.2e-38) to
        // zero: decline unless the terms the stopping rule reads, down to
        // 1e-7 of the sum, are normal.
        if (abs(sum) < 1.9721523e-31) return vec2(0.0);
        float tail = zn * sum;
        float res = head + tail;
        if (max(largest, abs(tail)) > 100.0 * abs(res)) return vec2(0.0);
        return vec2(res, 1.0);
      }
    } else {
      settled = 0;
    }
  }
  return vec2(0.0);
}`,
  _gpu_ir_lerch_em: `// 1 - e^(-t) for t >= 0, by its Taylor series below 1/4, where
// 1.0 - exp(-t) would cancel.
float _gpu_ir_lerch_em(float t) {
  if (t < 0.25)
    return t * (1.0 - t / 2.0 * (1.0 - t / 3.0 * (1.0 - t / 4.0 *
      (1.0 - t / 5.0 * (1.0 - t / 6.0 * (1.0 - t / 7.0))))));
  return 1.0 - exp(-t);
}`,
  _gpu_ir_lerch_lgamma: `// ln Gamma(s) for s > 0: shift the argument to x >= 8 (ln Gamma(s) =
// ln Gamma(x) - ln(s (s+1) ... (x-1))), then the Stirling series. Within
// about 1e-6 absolute. _gpu_ir_gamma is not used here: its Lanczos sum
// cancels in f32 near s = 0.
float _gpu_ir_lerch_lgamma(float s) {
  float p = 1.0;
  float x = s;
  for (int k = 0; k < 8; k++) {
    if (x >= 8.0) break;
    p *= x;
    x += 1.0;
  }
  float x2 = x * x;
  float corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * x2)) / x2) / x;
  return (x - 0.5) * log(x) - x + (0.91893853320467274 + corr) - log(p);
}`,
  _gpu_ir_lerch_g: `// 1 / (1 - z e^(-t)) for t >= 0 and z < 1, without cancellation: for
// 0 < z < 1 the denominator is (1 - z) + z (1 - e^(-t)), two terms >= 0.
float _gpu_ir_lerch_g(float z, float t) {
  if (z < 0.0) return 1.0 / (1.0 - z * exp(-t));
  return 1.0 / ((1.0 - z) + z * _gpu_ir_lerch_em(t));
}`,
  _gpu_ir_lerch_pstep: `// One step of the polynomials P_m(w) = (1 - w)^(m+1) Phi(w, -m, a), in
// place: P_(m+1)(w) = (1 - w)(a P_m + w P_m') + (m + 1) w P_m, that is
// p'_k = (a + k) p_k + (m + 2 - a - k) p_(k-1), from P_0 = 1. It follows from
// Phi(w, -m-1, a) = (a + w d/dw) Phi(w, -m, a). Updated from the top so
// each entry still reads the previous row's values. c holds
// LERCH_MAX_N + 2 entries.
void _gpu_ir_lerch_pstep(inout float c[18], float a, int m) {
  for (int k = m + 1; k >= 0; k--) {
    float hi = k <= m ? (a + float(k)) * c[k] : 0.0;
    float lo = k >= 1 ? (float(m + 2) - a - float(k)) * c[k - 1] : 0.0;
    c[k] = hi + lo;
  }
}`,
  _gpu_ir_lerch_poly: `// Phi(w, -n, a) = v sum_k p_k u^k v^(n-k), v = 1/(1 - w), u = w v, from
// the coefficients of P_n: returns vec2(the sum without its factor v, the
// sum of the moduli of its terms), by Horner in u with the powers of v
// carried along. For w < -1, |u| and |v| are at most 1, so nothing
// overflows. The caller applies the factor v, or folds it into an
// exponent (see _gpu_ir_lerch_integral).
vec2 _gpu_ir_lerch_poly(float c[18], int n, float u, float v) {
  float au = abs(u);
  float av = abs(v);
  float r = c[n];
  float ra = abs(c[n]);
  float vp = v;
  float avp = av;
  for (int k = n - 1; k >= 0; k--) {
    r = r * u + c[k] * vp;
    ra = ra * au + abs(c[k]) * avp;
    vp *= v;
    avp *= av;
  }
  return vec2(r, ra);
}`,
  _gpu_ir_lerch_rational: `// Phi(z, -n, a) for an integer 0 <= n <= LERCH_MAX_N: a rational function
// of z, for every real z != 1 and every a (the (k + a) = 0 term is 0^n = 0,
// dropped as the series drops it). It has no branch cut, so it holds for
// z > 1 too. Returns vec2(value, 1), or vec2(0, 0) when the terms cancel so
// far that the error estimate exceeds 3e-5 of the value (next to a zero of
// Phi); the caller then tries its other methods.
vec2 _gpu_ir_lerch_rational(float z, int n, float a) {
  const float EPS = 6.0e-8;
  float c[18];
  for (int i = 0; i < 18; i++) c[i] = 0.0;
  c[0] = 1.0;
  for (int m = 0; m < n; m++) _gpu_ir_lerch_pstep(c, a, m);
  float v = 1.0 / (1.0 - z);
  vec2 q = _gpu_ir_lerch_poly(c, n, z * v, v);
  if (!(EPS * (float(n + 4) * q.y) <= 3.0e-5 * abs(q.x))) return vec2(0.0);
  return vec2(q.x * v, 1.0);
}`,
  _gpu_ir_lerch_integral: `// Phi(z,s,a) for real z < 1 (z != 0) and a > 0, from
//   Phi(z,s,a) = 1/Gamma(s) Int_0^inf t^(s-1) e^(-a t) / (1 - z e^(-t)) dt
// for s > 0, whose integrand is positive, so the sum has no cancellation at
// any z. For s <= 0 (not an integer) it integrates by parts n = ceil(-s)
// times first:
//   Phi(z,s,a) = 1/Gamma(s+n) Int_0^inf t^(s+n-1) e^(-a t) R_n(z e^(-t)) dt,
// R_n(w) = Phi(w, -n, a): the n-th derivative in t of
// e^(-a t)/(1 - z e^(-t)) is (-1)^n e^(-a t) R_n(z e^(-t)), and the n signs
// (-1) of the parts cancel it. That integrand is positive for 0 < z < 1
// and changes sign for z < 0, where the error estimate measures the
// cancellation. A negative a (s > 0 is then an integer) is first shifted to
// a + n0 in (0, 1] by Phi(a) = sum_{k<n0} z^k (a+k)^(-s) + z^n0 Phi(a+n0).
// With tau = a t the integral is a^(-(s+n)) times an integral against the
// density tau^(s+n-1) e^(-tau) / Gamma(s+n). Its pieces: [0, e0] in closed
// form from the first two Taylor terms of the integrand's smooth factor,
// R_n(z) and -R_(n+1)(z); [e0, lam] (lam = min(1, 1/a)) in panels of width
// <= 3 in ln t, which resolves the t^(s+n-1) singularity and, for z near 1,
// the pole at t = ln z < 0; then panels in t up to where 1/(1 - z e^(-t))
// has reached 1 (t = ln(-z) + 17 for z < 0) and the density is negligible
// (tau = s + n + 30; for a > 1 and z < 0 the integrand decays like
// e^(-(a-1) t) before that). A linear panel starting at x is at most 2x
// wide (the singularity at t = 0), at most 8/a wide (e^(-a t)), and at most
// max(4/(1 + n/4), 0.6 |x - L|) wide, L = ln|z|: the poles of the integrand
// sit at t = L +- i pi (of order n + 1), so a panel far from the step at L
// may be a fixed fraction of its distance to it, and next to it the panels
// narrow as n grows. So the panel count does not grow with |z|: in
// measurements the whole f32 range (|z| up to 3.4e38) takes at most 22
// panels. Below z = -1 the factor 1/(1 - z e^(-t)) is carried as its log,
// -softplus(L - t), inside the exponent of the density: the factor runs from
// about 1/|z| to 1 and the density e^(-a t) down past e^(-88), so each alone
// can fall under the smallest normal f32, which a GPU flushes to zero (the
// value at z = -3e38 was 3% off), where their product does not. Every panel
// is an 8-point Gauss-Legendre rule, at most 28 panels (224 integrand
// values, each a Horner sum of n + 1 terms); past that it declines.
// Returns vec2(value, 1) or vec2(0, 0) where it cannot vouch for the value:
// the error estimate adds, in units of the f32 rounding error EPS, the
// errors of the shifted terms, of each node (its exp argument, and the
// moduli of the terms of R_n), of the closed-form head, of ln Gamma(s+n)
// and of a^(-(s+n)), and declines above 3e-5 of the value.
vec2 _gpu_ir_lerch_integral(float z, float s, float a) {
  const float EPS = 6.0e-8;
  const float PI = 3.14159265358979;
  const float gx[4] = float[4](0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  const float gw[4] = float[4](0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  int n = s > 0.0 ? 0 : int(ceil(-s));
  float sn = s + float(n);
  int n0 = a < 0.0 ? int(ceil(-a)) : 0;
  float head = 0.0;
  float zk = 1.0;
  float err = 0.0;
  for (int k = 0; k < n0; k++) {
    float bk = a + float(k);
    float t = zk * _gpu_ir_zeta_pow(bk, -s);
    head += t;
    err += abs(t) * (2.0 + float(k) + abs(s * log2(abs(bk))));
    zk *= z;
  }
  a += float(n0);
  float c[18];
  for (int i = 0; i < 18; i++) c[i] = 0.0;
  c[0] = 1.0;
  for (int m = 0; m < n; m++) _gpu_ir_lerch_pstep(c, a, m);
  float lg = _gpu_ir_lerch_lgamma(sn);
  float lam = min(1.0, 1.0 / a);
  float delta = z > 0.0 ? -log(z) : PI;
  float e0 = 1e-3 * min(lam, delta);
  float la = log(a);
  float tau0 = a * e0;
  float L = z < 0.0 ? log(-z) : log(z);
  bool big = z < -1.0;
  // With the factor in the exponent, every node also carries e^S,
  // S = min(a, 1) L, the size of the largest nodes (about |z|^(-min(a,1))),
  // so that the nodes of a value near the smallest normal f32 do not flush
  // to zero one by one; the sum is divided by e^S at the end, inside one
  // exp (at z = -1e35 a value of 6e-37 was 0.4% off without it).
  float S = big ? min(a, 1.0) * L : 0.0;
  float lG0 = 0.0;
  float v0h = 1.0 / (1.0 - z);
  float u0 = z * v0h;
  if (big) {
    lG0 = -(L + log(1.0 + exp(-L)));
    v0h = exp(lG0);
    u0 = -exp(L + lG0);
  }
  vec2 f0 = _gpu_ir_lerch_poly(c, n, u0, v0h);
  float c1[18] = c;
  _gpu_ir_lerch_pstep(c1, a, n);
  vec2 f1 = _gpu_ir_lerch_poly(c1, n + 1, u0, v0h);
  float p0 = big ? exp(sn * log(tau0) - lg + lG0 + S) : exp(sn * log(tau0) - lg) * v0h;
  float d1 = -f1.x / a;
  float sum = p0 * (f0.x / sn + d1 * tau0 / (sn + 1.0));
  // The head's error: the rounding of Phi(z, -n, a) and Phi(z, -n-1, a),
  // bounded by the moduli of their terms, and the exp that gives p0.
  float ferr = abs(p0) * ((f0.y / sn + f1.y / a * tau0 / (sn + 1.0)) * float(n + 5)) +
    abs(sum) * (abs(sn * log(tau0)) + abs(lg) + abs(L));
  float v0 = log(e0);
  float v1 = log(lam);
  float nlog = max(1.0, ceil((v1 - v0) / 3.0));
  float hv = (v1 - v0) / nlog;
  float TG = max(L, 0.0) + 17.0;
  float tw = (sn + 30.0) / a;
  float tEnd = tw;
  if (z < 0.0) tEnd = max(tw, a > 1.0 ? min(TG, (sn + 30.0) / (a - 1.0)) : TG);
  float hW = 8.0 / a;
  float x = lam;
  for (int p = 0; p < 28; p++) {
    bool logPanel = float(p) < nlog;
    if (!logPanel && x >= tEnd) break;
    float w = logPanel ? hv :
      min(min(2.0 * x, hW), max(4.0 / (1.0 + 0.25 * float(n)), 0.6 * abs(x - L)));
    float cc = logPanel ? v0 + (float(p) + 0.5) * hv : x + 0.5 * w;
    float r = 0.5 * w;
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 2; j++) {
        float u = cc + (j == 0 ? -r : r) * gx[i];
        float t = logPanel ? exp(u) : u;
        float tau = a * t;
        float e = logPanel ? sn * (u + la) : (sn - 1.0) * log(tau);
        float vn;
        float un;
        float lG = 0.0;
        if (big) {
          float xs = L - t;
          lG = -(max(xs, 0.0) + log(1.0 + exp(-abs(xs))));
          vn = exp(lG);
          un = -exp(xs + lG);
        } else {
          vn = _gpu_ir_lerch_g(z, t);
          un = z * exp(-t) * vn;
        }
        vec2 pv = _gpu_ir_lerch_poly(c, n, un, vn);
        float ex = e - tau - lg;
        float q = r * gw[i] * ((logPanel ? 1.0 : a) * (big ? exp(ex + lG + S) : exp(ex) * vn));
        sum += q * pv.x;
        ferr += q * (abs(pv.x) * ((abs(e) + tau) + (abs(lG) + abs(L))) +
          pv.y * (float(n + 3) + t));
      }
    }
    if (!logPanel) x += w;
  }
  if (x < tEnd) return vec2(0.0); // the panel budget ran out
  // The integral past T = x, which the panels omit: at most the density
  // tail Q(sn, aT) <= d(aT) aT / (aT - sn + 1) (d the density, decreasing
  // past sn - 1), times a bound of the smooth factor there (the moduli of
  // R_n at T; 1/(1 - z e^-t) <= 1 for z < 0, decreasing for 0 < z < 1).
  // LerchPhi(-3, 50, 1) stopped at aT = 81, where the tail of Gamma(50)
  // alone passes 3e-5.
  float tauT = a * x;
  float omitted = 3.0e38;
  if (tauT > sn) {
    float vT = big ? 1.0 / (1.0 + exp(L - x)) : _gpu_ir_lerch_g(z, x);
    float uT = big ? -exp(L - x) * vT : z * exp(-x) * vT;
    float mT = _gpu_ir_lerch_poly(c, n, uT, vT).y * (z < 0.0 ? 1.0 : vT);
    omitted = exp((sn - 1.0) * log(tauT) - tauT - lg + S) * tauT / (tauT - sn + 1.0) * mT;
  }
  float scaled = big ? (sum < 0.0 ? -1.0 : 1.0) * exp(log(abs(sum)) - (S + sn * la))
                     : pow(a, -sn) * sum;
  float tail = zk * scaled;
  float res = head + tail;
  float rel = ferr / abs(sum) + (8.0 + abs(lg)) +
    ((float(n0) + 2.0) + (abs(sn * log2(a)) + S));
  float bound = EPS * (err + abs(tail) * rel) + abs(tail) * (omitted / abs(sum));
  if (!(bound <= 3.0e-5 * abs(res))) return vec2(0.0);
  return vec2(res, 1.0);
}`,
  _gpu_ir_lerch_h_integer: `// The three ways _gpu_ir_lerch_hermite computes h = e^x x^(-sig) Gamma(sig, x)
// at a complex x = (x.x, x.y), sig >= 1. Each returns vec4(Re h, Im h,
// err, ok), with err an estimate of the absolute error of h in units of
// the f32 rounding error.
//
// An integer sig = n + 1: Gamma(n+1, x) = n! e^(-x) sum_{k<=n} x^k / k!,
// so h = (1/x) sum_{j<=n} n!/(n-j)! x^(-j), summed from the inside out.
vec4 _gpu_ir_lerch_h_integer(float sig, vec2 x) {
  int n = int(sig) - 1;
  float d = x.x * x.x + x.y * x.y;
  float ir = x.x / d;
  float ii = -x.y / d;
  float ix = sqrt(ir * ir + ii * ii);
  float rr = 1.0;
  float ri = 0.0;
  float ra = 1.0; // the same sum over the moduli
  for (int j = 1; j <= n; j++) {
    float tr = ir * rr - ii * ri;
    float ti = ir * ri + ii * rr;
    rr = 1.0 + float(j) * tr;
    ri = float(j) * ti;
    ra = 1.0 + float(j) * ix * ra;
  }
  return vec4(rr * ir - ri * ii, rr * ii + ri * ir, (float(n) + 3.0) * ra * ix, 1.0);
}`,
  _gpu_ir_lerch_h_series: `// |x| < sig: h = e^x x^(-sig) Gamma(sig) - sum_k x^k / (sig (sig+1) ... (sig+k)),
// whose terms decrease from the first. (The continued fraction loses
// digits in f32 there: 8% at sig = 12.9, x = -0.01 - 3.14i.)
vec4 _gpu_ir_lerch_h_series(float sig, vec2 x) {
  float tr = 1.0 / sig;
  float ti = 0.0;
  float sr = tr;
  float si = 0.0;
  float sa = tr;
  int k = 1;
  for (k = 1; k < 100; k++) {
    float f = sig + float(k);
    float nr = (tr * x.x - ti * x.y) / f;
    ti = (tr * x.y + ti * x.x) / f;
    tr = nr;
    sr += tr;
    si += ti;
    float ta = abs(tr) + abs(ti);
    sa += ta;
    if (ta < 1e-8 * (abs(sr) + abs(si))) break;
  }
  float er = x.x - sig * log(sqrt(x.x * x.x + x.y * x.y)) + _gpu_ir_lerch_lgamma(sig);
  // arg x. At z = -1, x.x is -0.0, and the two-argument atan of Apple's
  // GPU (ANGLE Metal and WebGPU) then answers the wrong branch, so the
  // imaginary axis is taken explicitly.
  float arg = x.x == 0.0 ? (x.y < 0.0 ? -1.5707963267949 : 1.5707963267949) : atan(x.y, x.x);
  float ei = x.y - sig * arg;
  float m = exp(er);
  return vec4(m * cos(ei) - sr, m * sin(ei) - si,
    m * (24.0 + abs(er) + abs(ei)) + (float(k) + 3.0) * sa, 1.0);
}`,
  _gpu_ir_lerch_h_cf: `// |x| >= sig: Legendre's continued fraction for h, by the modified Lentz
// method, at most 200 steps.
vec4 _gpu_ir_lerch_h_cf(float sig, vec2 x) {
  const float FPMIN = 1e-30;
  float br = x.x - sig + 1.0;
  float bi = x.y;
  float cr = 1e30;
  float ci = 0.0;
  float dd = br * br + bi * bi;
  float dr = br / dd;
  float di = -bi / dd;
  float hr = dr;
  float hi = di;
  for (int i = 1; i < 200; i++) {
    float an = -float(i) * (float(i) - sig);
    br += 2.0;
    dr = an * dr + br;
    di = an * di + bi;
    if (abs(dr) + abs(di) < FPMIN) dr = FPMIN;
    float cc = cr * cr + ci * ci;
    cr = br + an * cr / cc;
    ci = bi - an * ci / cc;
    if (abs(cr) + abs(ci) < FPMIN) cr = FPMIN;
    dd = dr * dr + di * di;
    dr = dr / dd;
    di = -di / dd;
    float er = dr * cr - di * ci;
    float ei = dr * ci + di * cr;
    float nr = hr * er - hi * ei;
    hi = hr * ei + hi * er;
    hr = nr;
    if (abs(er - 1.0) + abs(ei) < 1e-7)
      return vec4(hr, hi, 35.0 * sqrt(hr * hr + hi * hi), 1.0);
  }
  return vec4(0.0);
}`,
  _gpu_ir_lerch_hermite: `// Phi(z,s,a) for real z != 0, 1 and s <= 0, from the Hermite-type
// representation (valid for a > 0):
//   Phi(z,s,a) = 1/(2 a^s) + a^(1-s) h - 2 Int_0^inf
//     sin(t log z - s arctan(t/a)) / ((a^2+t^2)^(s/2) (e^(2 pi t) - 1)) dt,
// with h = e^x x^(s-1) Gamma(1-s, x) at x = -a log z. (The middle term is
// z^(-a) (-log z)^(s-1) Gamma(1-s, -a log z): e^x = z^(-a) and
// x^(1-s) = a^(1-s) (-log z)^(1-s) for a real a > 0.) For z < 0,
// log z = ln|z| + i pi; the three terms are then complex and their sum is
// real, so only the real parts are summed, and the integrand's real part
// is sin(t ln|z| - s arctan(t/a)) cosh(pi t) / (e^(2 pi t) - 1). First a is
// shifted to b = a + m >= 1, which keeps |Im x| = pi b >= pi and the
// integrand's branch points at t = +-ib clear of the real axis. The
// integral is an 8-point Gauss-Legendre rule on at most 16 panels up to
// where e^(-pi t) (b^2+t^2)^(-s/2) is negligible, each panel at most 1.5
// wide (poles at t = +-i) and at most 4/|ln|z|| wide (the oscillation);
// past 16 panels it declines. Returns vec2(value, 1) or vec2(0, 0) where
// the error estimate (the pow and exp arguments, h's own error, and the
// cancellation between the terms) exceeds 3e-5 of the value.
vec2 _gpu_ir_lerch_hermite(float z, float s, float a) {
  const float EPS = 6.0e-8;
  const float PI = 3.14159265358979;
  const float gx[4] = float[4](0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  const float gw[4] = float[4](0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  if (s < -30.0) return vec2(0.0);
  int m = a < 1.0 ? int(ceil(1.0 - a)) : 0;
  float head = 0.0;
  float zk = 1.0;
  float err = 0.0;
  for (int k = 0; k < m; k++) {
    float bk = a + float(k);
    if (bk != 0.0) {
      float t = zk * _gpu_ir_zeta_pow(bk, -s);
      head += t;
      err += abs(t) * (2.0 + float(k) + abs(s * log2(abs(bk))));
    }
    zk *= z;
  }
  float b = a + float(m);
  float L = log(abs(z));
  float sig = 1.0 - s;
  vec2 x = vec2(-b * L, z < 0.0 ? -b * PI : 0.0);
  vec4 h;
  if (sig == floor(sig)) h = _gpu_ir_lerch_h_integer(sig, x);
  else if (sqrt(x.x * x.x + x.y * x.y) < sig) h = _gpu_ir_lerch_h_series(sig, x);
  else h = _gpu_ir_lerch_h_cf(sig, x);
  if (h.w < 0.5) return vec2(0.0);
  float t1 = 0.5 * pow(b, -s);
  float bs = pow(b, sig);
  float t2 = bs * h.x;
  // |h| up to a factor sqrt(2), without squaring: near z = 1 an integer
  // order gives an h near 1e25, whose square overflows f32.
  float t2abs = bs * (abs(h.x) + abs(h.y));
  float q3 = max(-s, 0.0);
  float t3end = (21.0 + q3 * log(1.0 + (q3 + 7.0) / b)) / PI;
  float n3 = ceil(t3end / min(1.5, 4.0 / max(abs(L), 1e-3)));
  if (n3 > 16.0) return vec2(0.0);
  float h3 = t3end / n3;
  float t3 = 0.0;
  float a3 = 0.0;
  float b2 = b * b;
  for (int p = 0; p < 16; p++) {
    if (float(p) >= n3) break;
    float c = (float(p) + 0.5) * h3;
    float r = 0.5 * h3;
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 2; j++) {
        float t = c + (j == 0 ? -r : r) * gx[i];
        float y = 2.0 * PI * t;
        float q = exp(-y);
        float omq = _gpu_ir_lerch_em(y);
        float K = z < 0.0 ? exp(-PI * t) * (1.0 + q) / (2.0 * omq) : q / omq;
        float f = sin(t * L - s * atan(t / b)) *
          exp(-0.5 * s * log(b2 + t * t)) * K;
        float wf = r * gw[i] * f;
        t3 += wf;
        a3 += abs(wf) * ((6.0 + 10.0 * t) +
          (abs(s) * (2.0 + 0.5 * log2(b2 + t * t)) + abs(t * L)));
      }
    }
  }
  t3 = -2.0 * t3;
  a3 = 2.0 * a3;
  float phi = t1 + t2 + t3;
  float res = head + zk * phi;
  float e1 = t1 * (2.0 + abs(s * log2(b)));
  float e2 = t2abs * (2.0 + abs(sig * log2(b))) + bs * h.z;
  float ephi = (e1 + e2) + (a3 + 3.0 * (t1 + t2abs + abs(t3)));
  float bound = EPS * (err + abs(zk) * (ephi + (float(m) + 2.0) * abs(phi)) + abs(res));
  // An infinite res passes the test above (inf <= inf) although it is a
  // term past the f32 range, not the value: Phi(-0.5, -30, 10) = 8.0e28
  // was -inf. The other methods then answer, or the call is NaN.
  if (!(bound <= 3.0e-5 * abs(res)) || !(abs(res) < 3.4e38)) return vec2(0.0);
  return vec2(res, 1.0);
}`,
  _gpu_ir_lerch_negative: `// Phi(z,s,a) for s <= 0: the integral after n integrations by parts (a
// non-integer s >= -LERCH_MAX_N with a > 0), and where it declines the
// Hermite form.
vec2 _gpu_ir_lerch_negative(float z, float s, float a) {
  if (s != floor(s) && a > 0.0 && s >= -16.0) {
    vec2 r = _gpu_ir_lerch_integral(z, s, a);
    if (r.y > 0.5) return r;
  }
  return _gpu_ir_lerch_hermite(z, s, a);
}`,
  _gpu_ir_lerch_core: `// Phi(z,s,a) as vec2(value, 1), or vec2(0, 0) where the value is complex
// or no method can vouch for it. The cases, in order: z = 1 is the Hurwitz
// zeta; z = 0 keeps only the k = 0 term; s = 0 is 1/(1 - z); a
// non-positive integer s >= -LERCH_MAX_N is the rational function of
// _gpu_ir_lerch_rational, for every z, where it does not decline; a
// non-positive integer a with s > 0 is the pole (+inf); a < 0 with a
// non-integer s is complex; z > 1 is on the branch cut unless s is a
// non-positive integer, where Phi has no cut (the Hermite form). Past
// z = -1 and at z = -1: the positive integral for s > 0, and for s <= 0
// _gpu_ir_lerch_negative. Inside the unit interval: the Euler transform
// (z < 0, s > 0) or the direct series, and where those decline the
// integral (s > 0) or _gpu_ir_lerch_negative (s <= 0).
vec2 _gpu_ir_lerch_core(float z, float s, float a) {
  if (z == 1.0) return vec2(_gpu_ir_hurwitz_zeta(s, a), 1.0);
  if (z == 0.0) return vec2(_gpu_ir_zeta_pow(a, -s), 1.0); // only the k = 0 term survives
  if (s == 0.0) return vec2(1.0 / (1.0 - z), 1.0);
  if (s < 0.0 && s == floor(s) && s >= -16.0) {
    vec2 q = _gpu_ir_lerch_rational(z, int(-s), a);
    if (q.y > 0.5) return q;
  }
  bool aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) return vec2(uintBitsToFloat(0x7f800000u), 1.0); // (k+a) = 0 diverges, z != 0
  if (a < 0.0 && s != floor(s)) return vec2(0.0); // complex value
  if (a < -1.0e6) return vec2(0.0); // one term per unit of -a
  if (z > 1.0) {
    if (s > 0.0 || s != floor(s)) return vec2(0.0); // on the branch cut
    return _gpu_ir_lerch_hermite(z, s, a);
  }
  if (z < -1.0) return s > 0.0 ? _gpu_ir_lerch_integral(z, s, a) : _gpu_ir_lerch_negative(z, s, a);
  if (z < 0.0 && s > 0.0) {
    vec2 e = _gpu_ir_lerch_euler(z, s, a);
    return e.y > 0.5 ? e : _gpu_ir_lerch_integral(z, s, a);
  }
  if (z == -1.0) return _gpu_ir_lerch_negative(z, s, a); // s < 0: the series diverges
  vec2 r = _gpu_ir_lerch_series(z, s, a);
  if (r.y > 0.5) return r;
  return s > 0.0 ? _gpu_ir_lerch_integral(z, s, a) : _gpu_ir_lerch_negative(z, s, a);
}`,
  _gpu_ir_lerch_modes: `// Phi(z, s, a) for z < 0, -30 <= s <= -3 and |a| < 100, from the Fourier
// modes of the base point b = a moved into (0, 1] (the form of
// lerchModesComplex, numerics/lerch-phi.ts, for a real z < 0):
//   Phi(z, s, b) = 2 Gamma(1-s) e^(-b L) sum_{m = 1, 3, 5, ...}
//     (L^2 + pi^2 m^2)^((s-1)/2) cos(pi (b m + (s-1) (1/2 + atan(L/(pi m))/pi))),
// L = ln|z|: the modes n and 1 - n of the sum over all integers n, paired.
// The terms fall like m^(s-1) and do not cancel the way the Hermite form's
// terms do below z = -1. The sum stops when the bound m (pi m)^(s-1)/(2|s|)
// on the modes left out, taken against the first one, is below 1e-9, and
// after 128 modes at most (ln|z| near 7 at s = -4). The phase is kept in
// units of pi and reduced to [-1/2, 1/2] before the cosine; b m and
// (s-1)/2 are reduced modulo 2 exactly. The modes are summed relative to
// the first one, and the factor 2 Gamma(1-s) e^(-bL) (L^2 + pi^2)^((s-1)/2)
// is one exp. a <= 0 adds the terms z^j (a+j)^(-s) before b; a > 1 uses
// Phi(z,s,a) = z^(-m) (Phi(z,s,b) - sum_{j<m} z^j (b+j)^(-s)). With c = 1
// (only with a = 1) the value is z Phi(z, s, 1) = Li_s(z): the factor
// z = -e^L goes into the exponent of the scale, so that Li_s(z) does not
// pass through Phi, which falls below the smallest normal f32 (1.18e-38)
// before Li_s(z) does. Returns vec2(value, 1), or vec2(0, 0) when the error
// estimate (the roundings of the exp and log arguments and of the phase,
// the modes left out, ln Gamma and the shift, in units of 6e-8) exceeds
// 3e-5 of the value, when the value is not a finite normal f32, or when
// z^(-m), the shifted sum or z^m is not: a GPU flushes a value below
// 1.18e-38 to 0, and a value past 3.4e38 is inf. The test is
// rerr <= 500 |res| (500 = 3e-5 / 6e-8): EPS rerr and 3e-5 |res| themselves
// fall below 1.18e-38 when |res| is below about 4e-34.
vec2 _gpu_ir_lerch_modes(float z, float s, float a, float c) {
  const float EPS = 6.0e-8;
  const float FLUSH = 2.0e-31; // 1.18e-38 / EPS
  const float PI = 3.14159265358979;
  if (s < -30.0 || abs(a) >= 100.0) return vec2(0.0);
  float b = a;
  float pre = 0.0;
  float post = 0.0;
  if (a <= 0.0) {
    pre = floor(-a) + 1.0;
    b = a + pre;
  } else if (a > 1.0) {
    post = ceil(a) - 1.0;
    b = a - post;
  }
  float head = 0.0;
  float herr = 0.0;
  float zk = 1.0;
  for (int j = 0; j < 128; j++) {
    if (float(j) >= pre) break;
    float bj = a + float(j);
    if (bj != 0.0) {
      float t = zk * _gpu_ir_zeta_pow(bj, -s);
      head += t;
      herr += abs(t) * (3.0 + float(j) + abs(s * log2(abs(bj))));
    }
    zk *= z;
  }
  float L = log(-z);
  float sm1 = s - 1.0;
  float hs = 0.5 * sm1;
  float ps = hs - 2.0 * floor(0.5 * hs); // (s-1)/2 modulo 2
  float L2 = L * L;
  float lr1 = log(L2 + PI * PI);
  float sum = 0.0;
  float err = 0.0;
  float tail = 0.0;
  for (int n = 1; n <= 128; n++) {
    float m = float(2 * n - 1);
    float x = PI * m;
    float lr = log(L2 + x * x);
    float at = atan(L / x) / PI;
    float bm = b * m;
    float P = (bm - 2.0 * floor(0.5 * bm)) + ps + sm1 * at;
    float k = floor(P + 0.5);
    float cs = cos(PI * (P - k));
    if (mod(k, 2.0) != 0.0) cs = -cs;
    float ex = hs * (lr - lr1);
    float mag = exp(ex);
    float t = mag * cs;
    sum += t;
    err += abs(t) * (4.0 + abs(ex)) +
      mag * (abs(hs) * (abs(lr) + abs(lr1)) + PI * (abs(P) + abs(sm1) * abs(at) + b * m));
    tail = mag * m / (-2.0 * s);
    if (tail <= 1e-9) break;
  }
  float lg = _gpu_ir_lerch_lgamma(1.0 - s);
  float scale = 2.0 * exp(lg + hs * lr1 - (b - c) * L);
  float phib = scale * sum;
  if (!(scale < 3.4e38 && abs(phib) < 3.4e38)) return vec2(0.0);
  float eb = scale * (err + tail / EPS + 4.0 * abs(sum)) +
    abs(phib) * (abs(lg) + abs(hs * lr1) + abs((b - c) * L) + 12.0);
  // A GPU flushes a scale or Phi(z, s, b) below 1.18e-38 to 0: count the
  // loss (FLUSH = 1.18e-38 in units of EPS) rather than decline, since
  // next to the terms that a > 1 subtracts it can be negligible.
  if (scale < 1.18e-38 || abs(phib) < 1.18e-38) eb += FLUSH * (1.0 + abs(sum));
  if (c > 0.5) phib = -phib; // z = -e^L
  float res;
  float rerr;
  if (post > 0.0) {
    float acc = phib;
    float aerr = eb;
    float zj = 1.0;
    for (int j = 0; j < 128; j++) {
      if (float(j) >= post) break;
      float bj = b + float(j);
      float t = zj * pow(bj, -s);
      acc -= t;
      aerr += abs(t) * (3.0 + float(j) + abs(s * log2(bj)));
      zj *= z;
    }
    float zinv = pow(-z, -post);
    if (!(zinv >= 1.18e-38 && zinv < 3.4e38 && abs(acc) >= 1.18e-38 && abs(acc) < 3.4e38))
      return vec2(0.0);
    float sg = mod(post, 2.0) == 0.0 ? 1.0 : -1.0;
    res = sg * zinv * acc;
    rerr = zinv * (aerr + abs(acc) * (post + 2.0)) + abs(res) * abs(post * log2(-z));
  } else {
    if (!(abs(zk) >= 1.18e-38 && abs(zk) < 3.4e38)) return vec2(0.0);
    res = head + zk * phib;
    rerr = herr + abs(zk) * (eb + abs(phib) * (pre + 2.0));
  }
  // 500.0 * abs(res) is +inf for abs(res) > 6.8e35, and an error estimate
  // that overflowed to +inf passed the test inf <= inf: an infinite
  // estimate must decline.
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) ||
      !(rerr < 3.4e38 && rerr <= 500.0 * abs(res)))
    return vec2(0.0);
  return vec2(res, 1.0);
}`,
  _gpu_ir_lerch_phi: `// Where every method of _gpu_ir_lerch_core declines, z < 0 with s <= -3 tries
// the Fourier modes last, so that the values the other methods answer do
// not change.
float _gpu_ir_lerch_phi(float z, float s, float a) {
  vec2 r = _gpu_ir_lerch_core(z, s, a);
  if (r.y > 0.5) return r.x;
  if (z < 0.0 && s <= -3.0 && !(a < 0.0 && s != floor(s))) {
    r = _gpu_ir_lerch_modes(z, s, a, 0.0);
    if (r.y > 0.5) return r.x;
  }
  return uintBitsToFloat(0x7fc00000u);
}`,
  _gpu_ir_poly_log_inversion: `// Li_s(z) for z < -1 and a real s < 0 that is not an integer, by
// Jonquiere's inversion formula (DLMF 25.12.13 with the Hurwitz zeta form):
//   Li_s(z) = Re[(2 pi)^s e^(i pi s/2) / Gamma(s) zeta(1 - s, A)]
//             - cos(pi s) Li_s(1/z),   A = 1/2 - i ln(-z) / (2 pi).
// zeta(1 - s, A) (1 - s > 1) is summed by Euler-Maclaurin: 12 terms, the
// tail integral, the half term and up to 8 Bernoulli corrections, in
// complex f32. 1/Gamma(s) = sin(pi s) Gamma(1 - s) / pi, with sin(pi s)
// taken from the distance of s to its nearest integer. Returns
// vec2(value, 1), or vec2(0, 0) when Li_s(1/z) declines, when the value is
// not a finite normal f32, or when the error estimate exceeds 3e-5 of the
// value. The estimate counts, for each value that a GPU can flush to 0
// (below 1.18e-38), the loss of 1.18e-38 (FLUSH, in units of EPS): the
// terms of zeta(1 - s, A), of which |A|^(s-1) falls below 1.18e-38 near
// z = -1e38 when s is near -30, and the terms of Li_s(1/z).
vec2 _gpu_ir_poly_log_inversion(float s, float z) {
  const float EPS = 6.0e-8;
  const float FLUSH = 2.0e-31; // 1.18e-38 / EPS
  const float PI = 3.14159265358979;
  const float B[8] = float[8](1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0,
    5.0 / 66.0, -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0);
  float ai = -log(-z) / (2.0 * PI);
  float sig = 1.0 - s;
  float zr = 0.0;
  float zi = 0.0;
  float zerr = 0.0;
  for (int k = 0; k < 12; k++) {
    float wr = 0.5 + float(k);
    float lnw = 0.5 * log(wr * wr + ai * ai);
    float ph = -sig * atan(ai, wr);
    float m = exp(-sig * lnw);
    zr += m * cos(ph);
    zi += m * sin(ph);
    zerr += m * (4.0 + abs(sig * lnw) + abs(ph));
  }
  float wr = 12.5;
  float lnw = 0.5 * log(wr * wr + ai * ai);
  float th = atan(ai, wr);
  // w^(1 - sig) / (sig - 1), with 1 - sig = s taken from s itself: near
  // s = 0, (1 - s) - 1 would keep only a few digits of s.
  float m1 = exp(s * lnw) / -s;
  float p1 = s * th;
  zr += m1 * cos(p1);
  zi += m1 * sin(p1);
  zerr += abs(m1) * (4.0 + abs(s * lnw) + abs(p1));
  // w^(-sig) / 2
  float m0 = exp(-sig * lnw);
  float p0 = -sig * th;
  zr += 0.5 * m0 * cos(p0);
  zi += 0.5 * m0 * sin(p0);
  zerr += 0.5 * m0 * (4.0 + abs(sig * lnw) + abs(p0));
  // Bernoulli terms B_2j (sig)_(2j-1) / (2j)! w^(-sig-2j+1): u starts at
  // (sig/2) w^(-sig-1) and gains (sig+2j-1)(sig+2j) / ((2j+1)(2j+2) w^2).
  float mu1 = exp((-sig - 1.0) * lnw);
  float pu1 = (-sig - 1.0) * th;
  float ur = sig / 2.0 * mu1 * cos(pu1);
  float ui = sig / 2.0 * mu1 * sin(pu1);
  float w2r = wr * wr - ai * ai;
  float w2i = 2.0 * wr * ai;
  float w2d = w2r * w2r + w2i * w2i;
  float iw2r = w2r / w2d;
  float iw2i = -w2i / w2d;
  float prev = 3.0e38;
  for (int j = 1; j <= 8; j++) {
    float tr = ur * B[j - 1];
    float ti = ui * B[j - 1];
    float ta = abs(tr) + abs(ti);
    if (ta >= prev) break;
    zr += tr;
    zi += ti;
    zerr += ta * (10.0 + abs(sig * lnw));
    prev = ta;
    float mm = float(2 * j);
    float c = (sig + mm - 1.0) * (sig + mm) / ((mm + 1.0) * (mm + 2.0));
    float nr = c * (ur * iw2r - ui * iw2i);
    ui = c * (ur * iw2i + ui * iw2r);
    ur = nr;
  }
  zerr += 44.0 * FLUSH; // at most 22 terms in each of zr and zi
  float n = floor(s + 0.5);
  float d = s - n;
  float sgn = mod(n, 2.0) == 0.0 ? 1.0 : -1.0;
  float lg1 = _gpu_ir_lerch_lgamma(sig);
  float fm = sgn * sin(PI * d) * exp(s * log(2.0 * PI) + lg1) / PI;
  float fre = fm * cos(0.5 * PI * s);
  float fim = fm * sin(0.5 * PI * s);
  float first = fre * zr - fim * zi;
  float firstErr = abs(fm) * zerr +
    abs(fm) * sqrt(zr * zr + zi * zi) * (30.0 + abs(lg1) + abs(s * 2.7));
  // Li_s(1/z): for |1/z| <= 1/2 its own series sum_k (1/z)^k k^(-s), with
  // an error estimate, stopped when the tail after the term t is below
  // t rho/(1-rho) <= 1e-8 of the sum, rho = |1/z| ((k+1)/k)^(-s): the ratio
  // of the next term to t, which bounds every later ratio because it
  // decreases with k for s < 0. (The ratio |1/z| alone does not bound it:
  // the second term is 2^(-s) |1/z| times the first, 0.6 of it at
  // z = -8.7e8, s = -29, where the sum stopped after one term and the value
  // was 9.6 times too large.) Closer to the rim _gpu_ir_lerch_negative (the
  // integral, then the Hermite form) at 1/z.
  float iz = 1.0 / z;
  float li = 0.0;
  float lierr = 0.0;
  if (iz >= -0.5) {
    float wk = 1.0;
    float prev = 3.0e38;
    bool done = false;
    for (int k = 1; k < 200; k++) {
      wk *= iz;
      float t = wk * pow(float(k), -s);
      li += t;
      float size = abs(t);
      lierr += size * (2.0 + float(k) + abs(s * log2(float(k)))) + FLUSH;
      float rho = -iz * pow(float(k + 1) / float(k), -s);
      if (size < prev && rho < 1.0 && size * rho / (1.0 - rho) <= 1e-8 * abs(li)) {
        done = true;
        break;
      }
      prev = size;
    }
    if (!done) return vec2(0.0);
  } else {
    vec2 inner = _gpu_ir_lerch_negative(iz, s, 1.0);
    if (inner.y < 0.5) return vec2(0.0);
    li = iz * inner.x;
    lierr = 500.0 * abs(li); // the inner value is within 3e-5 = 500 EPS
  }
  float res = first - sgn * cos(PI * d) * li;
  // In units of EPS; the test is bound <= (3e-5 / EPS) |res|, since
  // EPS bound and 3e-5 |res| fall below 1.18e-38 for a small |res|.
  float bound = ((firstErr + 4.0 * abs(first)) + (lierr + 2.0 * abs(li))) + 4.0 * FLUSH;
  // An estimate that overflowed to +inf declines (500.0 * abs(res) is +inf
  // for abs(res) > 6.8e35, and inf <= inf passes).
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) ||
      !(bound < 3.4e38 && bound <= 500.0 * abs(res)))
    return vec2(0.0);
  return vec2(res, 1.0);
}`,
  _gpu_ir_poly_log: `// PolyLog(s, z). The integer orders the interpreter answers in closed form
// come first, so the shader agrees with it there: z = 0 is 0; the orders 1,
// 0 and -1 are -ln(1 - z), z/(1 - z) and z/(1 - z)^2, with a pole (+inf)
// at z = 1; an order -n, 2 <= n <= 12, is the Eulerian closed form
// z * sum_k A(n,k) z^k / (1 - z)^(n+1), which for |z| > 1 is summed in
// u = z/(1 - z) and v = 1/(1 - z) (|u|, |v| <= 1 for z < -1) so that it does
// not overflow. Every other order uses Li_s(z) = z * Phi(z, s, 1), and where
// that declines below z = -1 with a negative non-integer order, Jonquiere's
// inversion formula (_gpu_ir_poly_log_inversion). NaN on the cut z > 1 (except
// the orders above) and where both decline.
float _gpu_ir_poly_log(float s, float z) {
  if (z == 0.0) return 0.0;
  if (s == 1.0) {
    if (z == 1.0) return uintBitsToFloat(0x7f800000u);
    // -ln(1 - z) by the series of _gpu_ir_clog1p below |z| = 0.25, where
    // 1.0 - z loses the digits of z (it rounds to 1 at z = 1e-8).
    if (z < 1.0) return abs(z) < 0.25 ? -_gpu_ir_clog1p(-z) : -log(1.0 - z);
    return uintBitsToFloat(0x7fc00000u);
  }
  if (s == 0.0) {
    if (z == 1.0) return uintBitsToFloat(0x7f800000u);
    return z / (1.0 - z);
  }
  if (s == -1.0) {
    if (z == 1.0) return uintBitsToFloat(0x7f800000u);
    // Not (1 - z)², which overflows for |z| above 1.8e19.
    return (z / (1.0 - z)) / (1.0 - z);
  }
  if (s <= -2.0 && s >= -12.0 && s == floor(s) && z != 1.0) {
    int n = int(-s);
    // Row n of the Eulerian numbers, built in place from row 0 = [1]:
    // A(m,k) = (k+1) A(m-1,k) + (m-k) A(m-1,k-1), updated from the top so
    // each entry still reads the previous row's values.
    float row[13];
    row[0] = 1.0;
    for (int i = 1; i < 13; i++) row[i] = 0.0;
    for (int m = 1; m <= n; m++) {
      for (int k = m - 1; k >= 1; k--)
        row[k] = float(k + 1) * row[k] + float(m - k) * row[k - 1];
    }
    if (abs(z) > 1.0) {
      // sum_k A(n,k) u^(k+1) v^(n-k) = u v sum_k A(n,k) u^k v^(n-1-k)
      float v = 1.0 / (1.0 - z);
      float u = z * v;
      float r = row[n - 1];
      float vp = v;
      for (int k = n - 2; k >= 0; k--) {
        r = r * u + row[k] * vp;
        vp *= v;
      }
      return u * v * r;
    }
    float p = 0.0;
    for (int k = n - 1; k >= 0; k--) p = p * z + row[k];
    float den = 1.0;
    for (int i = 0; i <= n; i++) den *= 1.0 - z;
    return z * p / den;
  }
  // Below z = -1, Phi(z, s, 1) = Li_s(z)/z falls below the smallest normal
  // f32 before Li_s(z) does, and the 3e-5 test of the methods behind
  // _gpu_ir_lerch_core falls below it (a GPU flushes both sides to 0) when
  // |Phi| < 1.18e-38 / 3e-5 = 3.9e-34: the inversion and the modes (with the
  // factor z in the exponent) answer there instead.
  vec2 r = _gpu_ir_lerch_core(z, s, 1.0);
  if (r.y > 0.5 && (z >= -1.0 || (abs(r.x) >= 3.9e-34 && abs(z * r.x) < 3.4e38)))
    return z * r.x;
  if (z < -1.0 && s < 0.0 && s != floor(s)) {
    vec2 v = _gpu_ir_poly_log_inversion(s, z);
    if (v.y > 0.5) return v.x;
  }
  if (z < 0.0 && s <= -3.0) {
    r = _gpu_ir_lerch_modes(z, s, 1.0, 1.0);
    if (r.y > 0.5) return r.x;
  }
  return uintBitsToFloat(0x7fc00000u);
}`,
  _gpu_ir_harmonic_pos: `// H(m) = psi(m + 1) + gamma for m > -1. Below |m| = 0.1, where the two
// cancel, its Taylor series m sum_{j>=0} zeta(j + 2) (-m)^j (error 1e-11).
float _gpu_ir_harmonic_pos(float m) {
  if (m > 3.4028234663852886e38) return m;
  if (abs(m) < 0.1) {
    float z[11] = float[11](
      1.6449340668482264, 1.2020569031595942, 1.0823232337111381,
      1.03692775514337, 1.0173430619844492, 1.008349277381923,
      1.0040773561979444, 1.0020083928260821, 1.000994575127818,
      1.0004941886041194, 1.000246086553308
    );
    float s = 0.0;
    for (int j = 10; j >= 0; j--) s = s * -m + z[j];
    return s * m;
  }
  return _gpu_ir_digamma(m + 1.0) + 0.5772156649015329;
}`,
  _gpu_ir_harmonic: `// HarmonicNumber(n) = psi(n + 1) + gamma: 0 at 0, +inf at a negative
// integer, NaN at -inf. Below -1 the reflection H(n) = H(-n - 1) - pi
// cot(pi n), NaN where its terms cancel to less than 3e-5 of the value (next
// to the zero of H in each interval (-k - 1, -k), k >= 1).
float _gpu_ir_harmonic(float n) {
  if (n <= 0.0 && n == floor(n)) {
    if (n == 0.0) return 0.0;
    return n >= -3.4028234663852886e38 ? uintBitsToFloat(0x7f800000u) : uintBitsToFloat(0x7fc00000u);
  }
  if (n >= -1.0) return _gpu_ir_harmonic_pos(n);
  float a = _gpu_ir_harmonic_pos(-n - 1.0);
  vec2 sc = _gpu_ir_sincospi(n);
  float b = 3.14159265358979 * sc.y / sc.x;
  float v = a - b;
  if (!(6.0e-8 * 4.0 * abs(a) + 6.0e-8 * 4.0 * abs(b) <= 3.0e-5 * abs(v))) return uintBitsToFloat(0x7fc00000u);
  return v;
}`,
  _gpu_ir_harmonic_series: `// HarmonicNumber(n, r) = -sum_{k>=1} C(-r, k) n^k zeta(r + k), for |n| < 1:
// the series of _gpu_ir_zeta_near_one_mag less its term k = 0, zeta(r), which
// zeta(r) - zeta(r, 1 + n) cancels. At an integer r <= 0 the term of
// zeta(1) is its limit and the series ends: a polynomial, for every n.
// vec2(the value, the sum of the sizes of its terms), or vec2(0, +inf) where
// it does not converge in 100 terms or overflows.
vec2 _gpu_ir_harmonic_series(float n, float r) {
  vec2 fail = vec2(0.0, uintBitsToFloat(0x7f800000u));
  if (r < -24.5) return fail;
  float sum = 0.0;
  float mag = 0.0;
  float largest = 0.0;
  float c = 1.0;
  float hk = 1.0;
  int small = 0;
  for (int k = 1; k < 100; k++) {
    hk *= n;
    if (hk == 0.0) return vec2(sum, mag);
    float f = float(1 - k) - r;
    if (f == 0.0) {
      float last = c * hk / float(k);
      sum += last;
      mag += abs(last);
      return mag < 3.4028234663852886e38 ? vec2(sum, mag) : fail;
    }
    c = c * f / float(k);
    float term = c * hk * _gpu_ir_riemann_zeta(r + float(k), -f);
    sum -= term;
    float size = abs(term);
    mag += size;
    if (!(mag < 3.4028234663852886e38)) return fail;
    largest = max(largest, size);
    if (size <= 1e-7 * largest) {
      if (++small == 2) return vec2(sum, mag);
    } else small = 0;
  }
  return fail;
}`,
  _gpu_ir_harmonic2: `// HarmonicNumber(n, r) = sum_{k=1}^n k^(-r) = zeta(r) - zeta(r, n + 1), as
// the JavaScript kernel: 0 at n = 0; at a negative integer n, +inf for
// r > 0 and NaN otherwise; at n = +inf, zeta(r) for r > 1 (1 for r = +inf)
// and NaN otherwise; at r = +inf and a finite n, 1 for n > 0, -inf for
// -1 < n < 0 and NaN below; NaN for r = -inf. The sum for an
// integer n up to 256 (the smallest terms first). For another n from -256.5
// to 256.5 (to 1/2 for r >= 2), the value at n' = n - m in [-1/2, 1/2) and
// the recurrence H(n) = H(n - 1) + n^(-r) (below n' = -1 a negative base,
// real for an integer r only); H(n') is the series of
// _gpu_ir_harmonic_series, else zeta(r) - zeta(r, n' + 1). Elsewhere the
// series for an integer r <= 0 (a polynomial), else the difference. NaN
// where the error estimate (each term's size times its rounding error, a
// multiple of 6e-8, so that it does not overflow) passes 3e-5 of the value:
// next to r = 1 the difference cancels (each zeta is about 1/(r - 1)), next
// to a zero the recurrence.
float _gpu_ir_harmonic2(float n, float r) {
  const float NAN = uintBitsToFloat(0x7fc00000u);
  if (n > 3.4028234663852886e38)
    return r > 3.4028234663852886e38 ? 1.0 : r > 1.0 ? _gpu_ir_zeta_riemann(r) : NAN;
  if (r == 1.0) return _gpu_ir_harmonic(n);
  // H(n, +inf): the term 1 of k = 1, less (n + 1)^(-r) below n = 0.
  if (r > 3.4028234663852886e38) {
    if (n <= 0.0 && n == floor(n))
      return n == 0.0 ? 0.0 : n >= -3.4028234663852886e38 ? uintBitsToFloat(0x7f800000u) : NAN;
    return n > 0.0 ? 1.0 : n > -1.0 ? uintBitsToFloat(0xff800000u) : NAN;
  }
  if (r < -3.4028234663852886e38) return NAN;
  if (n <= 0.0 && n == floor(n)) {
    if (n == 0.0) return 0.0;
    return n >= -3.4028234663852886e38 && r > 0.0 ? uintBitsToFloat(0x7f800000u) : NAN;
  }
  if (n == floor(n) && n <= 256.0) {
    int m = int(n);
    float s = 0.0;
    if (r > 0.0) {
      for (int k = m; k >= 1; k--) s += pow(float(k), -r);
    } else {
      for (int k = 1; k <= m; k++) s += pow(float(k), -r);
    }
    return s;
  }
  // Above n = 1/2 for r >= 2 the terms of the recurrence cancel H(n') < 0
  // (n'^(-r) is large), and the difference does not cancel.
  bool shifted = n < -0.5 ? n > -256.5 : n < 256.5 && (r < 2.0 || n < 0.5);
  float shift = 0.0;
  float err = 0.0;
  if (shifted) {
    float m = floor(n + 0.5);
    if (n < -1.0 && r != floor(r)) return NAN; // complex value
    // The terms n - j for j = 0 .. m - 1 above n', n' + j for j = 1 .. -m
    // below.
    for (int j = 0; j < 257; j++) {
      if (float(j) >= abs(m)) break;
      float b = m > 0.0 ? n - float(j) : n + float(j + 1);
      float t = _gpu_ir_zeta_pow(b, -r);
      shift += m > 0.0 ? t : -t;
      err += 6.0e-8 * abs(t) * (3.0 + abs(r * log2(abs(b))));
    }
    n -= m;
  }
  float v;
  vec2 t = vec2(0.0, uintBitsToFloat(0x7f800000u));
  if (shifted || (r <= 0.0 && r == floor(r)))
    t = _gpu_ir_harmonic_series(n, r);
  // The series, unless its error passes 3e-5 of the larger of H(n') and the
  // recurrence (H(n', -2k) is 0 at n' = -1/2).
  if (6.0e-8 * 4.0 * t.y <= 3.0e-5 * max(abs(t.x), abs(shift))) {
    v = t.x;
    err += 6.0e-8 * 4.0 * t.y;
  } else {
    float a = _gpu_ir_zeta_riemann(r);
    float b;
    // Below n = -1 (r an integer), the terms of zeta(r, n + 1) cancel: their
    // sizes go in the estimate, which _gpu_ir_hurwitz_zeta makes relative to
    // its own value.
    if (n < -1.0 && r > 0.0) {
      // Both loops take -n steps: NaN below n = -10^6, as
      // _gpu_ir_hurwitz_zeta below a = -10^6.
      if (n < -1.0e6) return NAN;
      b = _gpu_ir_hurwitz_zeta_em(r, n + 1.0, r - 1.0);
      err += 6.0e-8 * 8.0 * _gpu_ir_zeta_negative_terms(r, n + 1.0);
    } else b = _gpu_ir_hurwitz_zeta(r, n + 1.0);
    v = a - b;
    err += 6.0e-8 * 16.0 * abs(a) + 6.0e-8 * 16.0 * abs(b);
  }
  v += shift;
  err += 6.0e-8 * abs(v);
  if (!(err <= 3.0e-5 * abs(v))) return NAN;
  return v;
}`,
};
