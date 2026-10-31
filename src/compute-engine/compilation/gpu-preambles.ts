// Shader preamble source text, in GLSL and WGSL, for the library functions
// (gamma, zeta, Lerch, Bessel, color, ...).

/**
 * GPU gamma function using Lanczos approximation (g=7, n=9 coefficients).
 *
 * Uses reflection formula for z < 0.5 (with inlined, non-recursive Lanczos)
 * and Lanczos for z >= 0.5. `_gpu_gammaln` is ln|Gamma(z)|: the Stirling
 * asymptotic expansion for z > 0, the reflection formula for z < 0, and
 * +Infinity at a pole. GLSL syntax.
 */
export const GPU_GAMMA_PREAMBLE_GLSL = `
float _gpu_gamma(float z) {
  const float PI = 3.14159265358979;
  // Gamma has a pole at every non-positive integer, and the reflection
  // formula below cannot see it: sin(PI * z) is not exactly 0 there in
  // floating point, so Gamma(-2.0) came back as a large finite number. The
  // interpreter answers the undirected infinity at a pole; its float
  // projection is Infinity (pole-encoding ruling 2026-08-28 — the magnitude
  // survives, the missing direction does not). The lower bound keeps
  // -Infinity out of the guard: it satisfies z == floor(z) but is not a
  // pole, and Gamma(-Infinity) is NaN in the interpreter's numeric lane.
  if (z <= 0.0 && z == floor(z) && z >= -3.4028234663852886e38) return _gpu_inf();
  // Gamma(+Infinity) is +Infinity; the Lanczos sum below gives NaN for it.
  if (z > 3.4028234663852886e38) return z;
  float w = z;
  if (z < 0.5) w = 1.0 - z;
  w -= 1.0;
  float x = 0.99999999999980993;
  x += 676.5203681218851 / (w + 1.0);
  x += -1259.1392167224028 / (w + 2.0);
  x += 771.32342877765313 / (w + 3.0);
  x += -176.61502916214059 / (w + 4.0);
  x += 12.507343278686905 / (w + 5.0);
  x += -0.13857109526572012 / (w + 6.0);
  x += 9.9843695780195716e-6 / (w + 7.0);
  x += 1.5056327351493116e-7 / (w + 8.0);
  float t = w + 7.5;
  float g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) return PI / (sin(PI * z) * g);
  return g;
}

float _gpu_gammaln(float z) {
  const float PI = 3.14159265358979;
  // ln|Gamma(z)|, as the interpreter answers on the real axis: +Infinity at
  // a pole (a non-positive integer), and the reflection formula
  // ln(PI) - ln|sin(PI z)| - lnGamma(1 - z) for z < 0. |sin(PI z)| is
  // sin(PI fract(z)); the product PI z loses its fraction for a large |z|.
  if (z <= 0.0 && z == floor(z) && z >= -3.4028234663852886e38) return _gpu_inf();
  if (z < 0.0) {
    float w = 1.0 - z;
    float w3 = w * w * w;
    float lw = w * log(w) - w - 0.5 * log(w)
      + 0.5 * log(2.0 * PI)
      + 1.0 / (12.0 * w)
      - 1.0 / (360.0 * w3)
      + 1.0 / (1260.0 * w3 * w * w);
    return log(PI) - log(sin(PI * (z - floor(z)))) - lw;
  }
  float z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * PI)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU Gamma function preamble (WGSL syntax). WGSL has no implicit GLSL-style
 * `float`/braceless-`if` syntax, so a `_WGSL` variant is required (the GLSL
 * preamble does not compile as WGSL).
 */
export const GPU_GAMMA_PREAMBLE_WGSL = `
fn _gpu_gamma(z: f32) -> f32 {
  let PI = 3.14159265358979;
  // See the GLSL preamble: a non-positive integer is a pole the reflection
  // formula misses; the pole answers the float projection of the undirected
  // infinity, which is +Infinity (pole-encoding ruling 2026-08-28), from the
  // WGSL _gpu_inf() helper (GPU_INF_PREAMBLE_WGSL). The lower
  // bound keeps -Infinity out of the guard (it is not a pole). (No
  // backticks in this comment: it lives inside a TypeScript template
  // literal, which one would terminate.)
  if (z <= 0.0 && z == floor(z) && z >= -3.4028234663852886e38) { return _gpu_inf(); }
  // Gamma(+Infinity) is +Infinity; the Lanczos sum below gives NaN for it.
  if (z > 3.4028234663852886e38) { return z; }
  var w = z;
  if (z < 0.5) { w = 1.0 - z; }
  w = w - 1.0;
  var x = 0.99999999999980993;
  x = x + 676.5203681218851 / (w + 1.0);
  x = x + -1259.1392167224028 / (w + 2.0);
  x = x + 771.32342877765313 / (w + 3.0);
  x = x + -176.61502916214059 / (w + 4.0);
  x = x + 12.507343278686905 / (w + 5.0);
  x = x + -0.13857109526572012 / (w + 6.0);
  x = x + 9.9843695780195716e-6 / (w + 7.0);
  x = x + 1.5056327351493116e-7 / (w + 8.0);
  let t = w + 7.5;
  let g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) { return PI / (sin(PI * z) * g); }
  return g;
}

fn _gpu_gammaln(z: f32) -> f32 {
  let PI = 3.14159265358979;
  // See the GLSL preamble: ln|Gamma(z)|, +Infinity at a pole, reflection for
  // z < 0.
  if (z <= 0.0 && z == floor(z) && z >= -3.4028234663852886e38) { return _gpu_inf(); }
  if (z < 0.0) {
    let w = 1.0 - z;
    let w3 = w * w * w;
    let lw = w * log(w) - w - 0.5 * log(w)
      + 0.5 * log(2.0 * PI)
      + 1.0 / (12.0 * w)
      - 1.0 / (360.0 * w3)
      + 1.0 / (1260.0 * w3 * w * w);
    return log(PI) - log(sin(PI * (z - floor(z)))) - lw;
  }
  let z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * PI)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU digamma, trigamma and polygamma functions, real-valued (f32), ported
 * from `digamma`, `trigamma` and `polygamma` in
 * `numerics/special-functions.ts`. GLSL syntax.
 *
 * - `_gpu_digamma(x)` is ψ(x): for x < 0 the reflection
 *   ψ(x) = ψ(1 − x) − π cot(πr), with r = x − round(x) exact, then the
 *   recurrence ψ(z) = ψ(z + 1) − 1/z up to z >= 6, then the asymptotic
 *   series ln z − 1/(2z) − Σ B₂ₖ/(2k z^(2k)) to B₈. `_gpu_trigamma(x)` is
 *   ψ₁(x), the same way: ψ₁(x) = π²/sin²(πr) − ψ₁(1 − x), ψ₁(z) =
 *   ψ₁(z + 1) + 1/z², and 1/z + 1/(2z²) + Σ B₂ₖ/z^(2k+1) to B₈.
 * - `_gpu_polygamma(n, x)` is ψ⁽ⁿ⁾(x) for an integer order 0 <= n <= 24
 *   (n = 0 and 1 call the two helpers above): the sum of the terms
 *   (−1)^(n+1) n!/(x + k)^(n+1) up to x + k >= n + 10, then the asymptotic
 *   series of the double kernel. Each term is exp(ln n! − (n + 1) ln|z|),
 *   so that neither n! nor z^(n+1) overflows. A negative x with an even n
 *   gives terms of both signs, and the helper answers NaN when the
 *   estimated error, 6e−8·(6 + the largest exponent)·(the sum of the term
 *   sizes), exceeds 3e−5 of the value: next to a zero, and next to a
 *   half-integer x, where the two largest terms cancel (about 1% of the
 *   points of the grid below with x < 0).
 *
 * At a pole (a non-positive integer x) the three helpers answer +∞, the
 * float projection of the interpreter's undirected infinity, as
 * `_gpu_gamma` does and as a pole folded at compile time is spelled
 * (pole-encoding ruling of 2026-08-28, `docs/COMPILATION-MODEL.md`); the
 * double kernels answer NaN there. NaN: −∞, a non-integer order, an order
 * outside 0..24, and x < −4096 for n >= 2 (the recurrence costs one term
 * per unit of |x|; ψ and ψ₁ use the reflection instead and have no such
 * limit). At +∞, ψ is +∞ and ψ₁ and ψ⁽ⁿ⁾ are 0, as in the interpreter.
 * Cost: ψ and ψ₁ at most 6 recurrence steps; ψ⁽ⁿ⁾ at most |x| + n + 11
 * terms, each with an exp and a log, and 10 series terms.
 *
 * Accuracy, measured with an f32 model of this text (every operation
 * rounded to f32 with `Math.fround`, every built-in the double result
 * rounded once; `test/compute-engine/compile-gpu-polygamma.test.ts`)
 * against the double kernels at the f32 operands, on x from −30 to 60 in
 * steps of 0.01, |x| from 1e−8 to 1e8, and the points 1e−6, 1e−4 and 1e−2
 * from 0, −1, −2, −5, −10, −25 and −1000: ψ is within 9.3e−7 relative
 * where |ψ(x)| is at least 1/10 of the size of its parts (the reflection
 * term, the recurrence terms and ln z), and within 2.2e−7 of that size
 * everywhere (next to a zero of ψ, such as x = 1.4616…, the error is
 * absolute); ψ₁ is within 2.9e−7 relative; ψ⁽ⁿ⁾ for 2 <= n <= 24 is
 * within 1.0e−5 relative where it is not NaN. With exp, log and pow that
 * scale their argument the way GPU drivers do and a log2 2.5 ulp off (a
 * worse GPU than an Apple M5 Max): ψ 2.2e−6 and 4.6e−7, ψ₁ 2.9e−7, ψ⁽ⁿ⁾
 * 3.2e−5 for n <= 16 and 5.0e−5 for n <= 24 (the exponents of the terms
 * reach about 90, and the error of exp grows with its argument). On an
 * Apple M5 Max GPU (headless Chromium, WebGL2 through ANGLE Metal and
 * WebGPU, which gave the same values), on the same grid for n = 0, 1, 2,
 * 3, 4, 6, 10, 16 and 24: ψ within 5.9e−6 relative where |ψ(x)| >= 0.1,
 * ψ₁ within 3.7e−7, ψ⁽ⁿ⁾ within 1.5e−5 where it is not NaN.
 */
export const GPU_POLYGAMMA_PREAMBLE_GLSL = `
float _gpu_digamma(float x) {
  const float PI = 3.14159265358979;
  // A pole (a non-positive integer) answers the float projection of the
  // interpreter's undirected infinity, +Infinity, as _gpu_gamma does. The
  // lower bound keeps -inf out: it satisfies x == floor(x), and the
  // interpreter answers NaN there.
  if (x <= 0.0 && x == floor(x))
    return x >= -3.4028234663852886e38 ? _gpu_inf() : _gpu_nan();
  float result = 0.0;
  float z = x;
  if (x < 0.0) {
    // cot(PI x) = cot(PI r) with r = x - round(x), which is exact: the
    // product PI x keeps only an absolute accuracy next to an integer.
    float r = x - floor(x + 0.5);
    result = -PI / tan(PI * r);
    z = 1.0 - x;
  }
  for (int k = 0; k < 6; k++) {
    if (z >= 6.0) break;
    result -= 1.0 / z;
    z += 1.0;
  }
  float z2 = 1.0 / (z * z);
  return result + (log(z) - 0.5 / z -
    z2 * (1.0 / 12.0 - z2 * (1.0 / 120.0 - z2 * (1.0 / 252.0 - z2 / 240.0))));
}

float _gpu_trigamma(float x) {
  const float PI = 3.14159265358979;
  if (x <= 0.0 && x == floor(x)) // a pole, and -inf: see _gpu_digamma
    return x >= -3.4028234663852886e38 ? _gpu_inf() : _gpu_nan();
  float result = 0.0;
  float sgn = 1.0;
  float z = x;
  if (x < 0.0) {
    float sr = sin(PI * (x - floor(x + 0.5)));
    result = PI * PI / (sr * sr);
    sgn = -1.0;
    z = 1.0 - x;
  }
  float t = 0.0;
  for (int k = 0; k < 6; k++) {
    if (z >= 6.0) break;
    t += 1.0 / (z * z);
    z += 1.0;
  }
  float z2 = 1.0 / (z * z);
  t += 1.0 / z + 0.5 * z2 +
    z2 / z * (1.0 / 6.0 - z2 * (1.0 / 30.0 - z2 * (1.0 / 42.0 - z2 / 30.0)));
  return result + sgn * t;
}

float _gpu_polygamma(float n, float x) {
  if (n == 0.0) return _gpu_digamma(x);
  if (n == 1.0) return _gpu_trigamma(x);
  if (n != floor(n) || n < 0.0 || n > 24.0) return _gpu_nan();
  if (x <= 0.0 && x == floor(x)) // a pole, and -inf: see _gpu_digamma
    return x >= -3.4028234663852886e38 ? _gpu_inf() : _gpu_nan();
  if (x < -4096.0) return _gpu_nan(); // one term per unit of |x|
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
  // The asymptotic series of the double kernel, from a = n!/z^(n+1):
  // (n-1)!/z^n + n!/(2 z^(n+1)) + sum B_2k (2k+n-1)!/((2k)! z^(2k+n)).
  float a = exp(lf - n1 * log(z));
  float tail = a * z / n + 0.5 * a;
  float f = a * n1 / (2.0 * z);
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
  float res = sum + tail;
  // 500 = 3e-5 / 6e-8: the terms of both signs cancel where res is small
  // against their sizes. The ratio, not a product, so that nothing
  // overflows next to f32's largest value.
  if (x < 0.0 && oddPower && !((mag + abs(tail)) / abs(res) <= 500.0 / (6.0 + xmax)))
    return _gpu_nan();
  return mod(n, 2.0) == 0.0 ? -res : res;
}
`;

/**
 * GPU digamma, trigamma and polygamma preamble (WGSL syntax). See
 * `GPU_POLYGAMMA_PREAMBLE_GLSL`.
 */
export const GPU_POLYGAMMA_PREAMBLE_WGSL = `
fn _gpu_digamma(x: f32) -> f32 {
  let PI = 3.14159265358979;
  // See the GLSL preamble: +Infinity at a pole, NaN at -inf.
  if (x <= 0.0 && x == floor(x)) {
    return select(_gpu_nan(), _gpu_inf(), x >= -3.4028234663852886e38);
  }
  var result: f32 = 0.0;
  var z: f32 = x;
  if (x < 0.0) {
    let r = x - floor(x + 0.5);
    result = -PI / tan(PI * r);
    z = 1.0 - x;
  }
  for (var k: i32 = 0; k < 6; k = k + 1) {
    if (z >= 6.0) { break; }
    result = result - 1.0 / z;
    z = z + 1.0;
  }
  let z2 = 1.0 / (z * z);
  return result + (log(z) - 0.5 / z -
    z2 * (1.0 / 12.0 - z2 * (1.0 / 120.0 - z2 * (1.0 / 252.0 - z2 / 240.0))));
}

fn _gpu_trigamma(x: f32) -> f32 {
  let PI = 3.14159265358979;
  if (x <= 0.0 && x == floor(x)) { // a pole, and -inf: see _gpu_digamma
    return select(_gpu_nan(), _gpu_inf(), x >= -3.4028234663852886e38);
  }
  var result: f32 = 0.0;
  var sgn: f32 = 1.0;
  var z: f32 = x;
  if (x < 0.0) {
    let sr = sin(PI * (x - floor(x + 0.5)));
    result = PI * PI / (sr * sr);
    sgn = -1.0;
    z = 1.0 - x;
  }
  var t: f32 = 0.0;
  for (var k: i32 = 0; k < 6; k = k + 1) {
    if (z >= 6.0) { break; }
    t = t + 1.0 / (z * z);
    z = z + 1.0;
  }
  let z2 = 1.0 / (z * z);
  t = t + (1.0 / z + 0.5 * z2 +
    z2 / z * (1.0 / 6.0 - z2 * (1.0 / 30.0 - z2 * (1.0 / 42.0 - z2 / 30.0))));
  return result + sgn * t;
}

fn _gpu_polygamma(n: f32, x: f32) -> f32 {
  if (n == 0.0) { return _gpu_digamma(x); }
  if (n == 1.0) { return _gpu_trigamma(x); }
  if (n != floor(n) || n < 0.0 || n > 24.0) { return _gpu_nan(); }
  if (x <= 0.0 && x == floor(x)) { // a pole, and -inf: see _gpu_digamma
    return select(_gpu_nan(), _gpu_inf(), x >= -3.4028234663852886e38);
  }
  if (x < -4096.0) { return _gpu_nan(); } // one term per unit of |x|
  if (x > 3.4e38) { return 0.0; } // +inf
  var fact: f32 = 1.0;
  for (var j: i32 = 2; j <= 24; j = j + 1) {
    if (f32(j) > n) { break; }
    fact = fact * f32(j);
  }
  let lf = log(fact);
  let n1 = n + 1.0;
  // With an odd power n + 1, a term at a negative z is negative.
  let oddPower = (n1 % 2.0) == 1.0;
  var sum: f32 = 0.0;
  var mag: f32 = 0.0;
  var xmax: f32 = 0.0;
  var z: f32 = x;
  for (var k: i32 = 0; k < 4132; k = k + 1) {
    if (z >= n + 10.0) { break; }
    let e = lf - n1 * log(abs(z));
    let t = exp(e);
    sum = sum + select(t, -t, z < 0.0 && oddPower);
    mag = mag + t;
    xmax = max(xmax, abs(e));
    z = z + 1.0;
  }
  // See the GLSL preamble: the asymptotic series from a = n!/z^(n+1).
  let a = exp(lf - n1 * log(z));
  var tail: f32 = a * z / n + 0.5 * a;
  var f: f32 = a * n1 / (2.0 * z);
  let b = array<f32, 10>(
    1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0, 5.0 / 66.0,
    -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0, 43867.0 / 798.0,
    -174611.0 / 330.0
  );
  var prev: f32 = 3.0e38;
  for (var k: i32 = 1; k <= 10; k = k + 1) {
    let term = b[k - 1] * f;
    if (abs(term) >= prev) { break; }
    tail = tail + term;
    prev = abs(term);
    let m = f32(2 * k);
    f = f * (m + n) * (m + n + 1.0) / ((m + 1.0) * (m + 2.0) * z * z);
  }
  let res = sum + tail;
  // See the GLSL preamble: 500 = 3e-5 / 6e-8, as a ratio.
  if (x < 0.0 && oddPower && !((mag + abs(tail)) / abs(res) <= 500.0 / (6.0 + xmax))) {
    return _gpu_nan();
  }
  return select(res, -res, (n % 2.0) == 0.0);
}
`;

/**
 * GPU Hurwitz/Riemann/generalized zeta, real-valued (f32) — ported from
 * `hurwitzEMComplex` and `hurwitzZetaComplex` in
 * `numerics/numeric-complex.ts`, at im = 0 throughout, with the value
 * conventions of the JavaScript helpers `hurwitzZeta` and `zetaGeneralized`
 * (`numerics/special-functions.ts`). GLSL syntax.
 *
 * - `_gpu_zeta_pow(x, e)` is x^e with a real value: `pow` is undefined for
 *   x < 0 in GLSL and WGSL, so a negative x with an integer e is |x|^e with
 *   the sign (−1)^e, and a negative x with a non-integer e (a complex
 *   value) answers NaN.
 * - `_gpu_hurwitz_zeta_em` is the raw Euler-Maclaurin sum; `_gpu_zeta` and
 *   `_gpu_hurwitz_zeta` add the functional-equation / base-point dispatch
 *   that avoids its cancellation at s < 1/2.
 * - `_gpu_zeta` reflects only for s < 0 and returns NaN below s = −63. The
 *   limit was s = −24.5, where the Lanczos `_gpu_gamma(1 − s)` used to
 *   overflow; Stirling's series below carries the reflection further, and
 *   near s = −64.8 its pow(y/(2πe), y) overflows. Against mpmath at 1864
 *   f32 values of s from −80 to −24.5 (steps of 1/16, the points 1e−6 to
 *   0.3 from each integer, and 400 random values), the f32 model of this
 *   text is within 5.2e−6 relative from −24.5 to −63 (1.2e−5 from −63
 *   to −64); with its log2 2.5 ulp off, within 2.9e−5 (3.5e−5 from −63 to
 *   −64). On an Apple M5 Max GPU (WebGL2 and WebGPU), the 1306 of these
 *   points from −63 to −24.5 are within 7.3e−6, and every point below −63
 *   is NaN (or 0 at an even integer). `_gpu_zeta_near_one` keeps the old
 *   limit (see there). The
 *   reflection
 *   takes 2^s π^(s−1) Γ(1 − s) = 2 Γ(1 − s)/(2π)^(1−s) from the Lanczos
 *   `_gpu_gamma` for 1 − s < 8, and from Stirling's series
 *   (`_gpu_zeta_gamma_2pi`) from 1 − s = 8 on: the pow arguments of the
 *   Lanczos form grow to about 126 at s = −24, and in an f32 model whose
 *   log2 is 2.5 ulp off (a worse GPU than the one measured) ζ(s) was up to
 *   3.3e−5 off near s = −22; with Stirling's series that model is within
 *   4.7e−6 for s <= −7.
 * - `_gpu_riemann_zeta(s, sm1)` is ζ(s) with sm1 = s − 1 given by the
 *   caller. The reflection needs ζ(1 − s) next to its pole when s is near
 *   0, and the rounded 1 − s leaves the pole term a relative error of about
 *   6e−8/|s| (at s = −1e−8, 1 − s rounds to 1, and IEEE f32 arithmetic
 *   gave an infinite result); the exact distance −s is passed instead.
 *   The Taylor series in `_gpu_zeta_near_one` passes the exact distance
 *   the same way. The reflection's sin(πs/2) is reduced by the nearest
 *   integer to s/2 first, since next to an even s the product π·s/2 kept
 *   only an absolute accuracy (up to 0.5 relative error in an f32
 *   simulation at s = −8 ± 1e−6; on an Apple GPU, ζ(−4.0000005) was
 *   −5.7e−9 instead of −3.807e−9). Simulated in f32 against mpmath at the
 *   f32-rounded s, at distances 1e−7 to 0.3 from 0, 1 and each negative
 *   integer down to −12: `_gpu_zeta` is within 5.6e−6 relative (next to
 *   s = 0) and 2.4e−6 elsewhere.
 * - `_gpu_hurwitz_zeta(s, a)` is the pole (+∞) at s = 1 and at a
 *   non-positive integer a with s > 0, 1/2 − a at s = 0, and NaN at a < 0
 *   with a non-integer s, where the true value is complex. For a > 0 it
 *   uses the Euler-Maclaurin sum only where its terms do not cancel: for
 *   s >= 1, for 1/2 <= s < 1 with a >= 1, and for s < 1/2 with
 *   a >= 4·max(12, ⌈|s|⌉ + 6) (as `hurwitzZetaComplex` does). Elsewhere
 *   (`_gpu_zeta_shifted`, for s >= −24.5) it moves a to the base point
 *   b = a − ⌈a⌉ + 1 in (0, 1], subtracts the terms (b + j)^(−s) passed
 *   over, and takes ζ(s, b) from Hurwitz's formula, the Fourier series in
 *   b, for s <= −3 (`_gpu_zeta_fourier`, 64 terms that fall like k^(s−1)),
 *   from Hermite's integral for −3 < s < 1 (`_gpu_zeta_hermite`), or, for
 *   b < 2^−10, from b^(−s) + ζ(s, 1 + b) with the Taylor series in b. The
 *   Euler-Maclaurin sum had cancelled there: ζ(1/2, 0.3) = 0.011 was
 *   2.3e−5 off on the GPU, ζ(−23, 1/4) = −2.2e−4 answered 0.016, and 795
 *   (GLSL) and 817 (WGSL) of the 18361 points below were more than 1.5e−5
 *   off, all without a NaN. Each of the three methods returns an error
 *   estimate (in units of the f32 rounding error, the rounding of each pow,
 *   exp, log and sine argument, and the cancellation between the terms),
 *   and `_gpu_zeta_shifted` answers NaN
 *   when the estimate exceeds 3e−5 of the value: next to a zero of
 *   ζ(s, a), where the value is small against the terms. Measured on an
 *   Apple M5 Max GPU (WebGL2 through ANGLE Metal, and WebGPU; the two agree
 *   within 5.5e−6) against mpmath at the f32-rounded operands, on 18361
 *   points (317 values of s from −24.5 to 12: the integers, the
 *   half-integers, the points 1e−6, 1e−4 and 1e−2 from each integer from
 *   −24 to 1, and 80 random values; 58 values of a from 0.01 to 30): every
 *   value that is not NaN is within 1e−5 relative (worst 8.1e−6), and 432
 *   are NaN, 387 of them where a half-ulp change of s or a alone moves the
 *   value by more than 1e−5. The f32 model of this text
 *   (`test/compute-engine/gpu-lerch-f32-model.ts`) gives the same counts
 *   and the same NaN (worst 6.6e−6); with its log2 2.5 ulp off, 17 values
 *   with a > 16 and s < −21 are up to 1.7e−5 off (the pow of the
 *   passed-over terms has an argument near 100).
 * - `_gpu_zeta_generalized(s, a)` is Wolfram's `Zeta[s, a]`: the terms with
 *   k + a < 0 are |k + a|^(−s), the (k + a) = 0 term is dropped, so it is
 *   real for every real s and a and its only pole is s = 1.
 *
 * Both base-point walks cost one term per unit of |a|, so a < −10⁶ answers
 * NaN instead of looping for that long. For a > 0, `_gpu_zeta_shifted`
 * costs at most 123 passed-over terms (a < 124) plus 64 Fourier terms, or
 * at most 17 Hermite panels of 8 nodes (136 nodes, each with an exp, two
 * logs, an atan and a sine), or the Taylor series of `_gpu_zeta_near_one`
 * (up to 100 terms, a few for b < 2^−10).
 */
export const GPU_ZETA_PREAMBLE_GLSL = `
float _gpu_zeta_pow(float x, float e) {
  if (x >= 0.0) return pow(x, e);
  if (e != floor(e)) return _gpu_nan();
  float r = pow(-x, e);
  if (mod(abs(e), 2.0) == 1.0) return -r;
  return r;
}

float _gpu_hurwitz_zeta_em(float s, float a, float sm1) {
  int n = int(ceil(15.0 - a));
  if (n < 0) n = 0;
  float sum = 0.0;
  float z = a;
  for (int k = 0; k < n; k++) {
    sum += _gpu_zeta_pow(z, -s);
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
}

// Gamma(x) / (2 pi)^x for x >= 1, as vec2(value, error estimate in units of
// the f32 rounding error 6e-8). Stirling's series after a shift to y >= 8:
// (y/(2 pi e))^y sqrt(2 pi/y) e^corr, divided by x (x+1) ... (y-1) and
// multiplied by (2 pi)^(y-x). Neither Gamma(x) nor (2 pi)^x is formed (they
// overflow f32 near x = 35 and x = 48), and the largest pow argument is
// about y log2(y/(2 pi e)), 15 at x = 25.5, where the Lanczos _gpu_gamma
// calls pow with an argument of about 126, and 122 at x = 64, the end of
// the range _gpu_riemann_zeta uses.
vec2 _gpu_zeta_gamma_2pi(float x) {
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
}

// zeta(s), with sm1 = s - 1 passed by a caller that knows it more exactly
// than s - 1.0 can recover it from a rounded s.
float _gpu_riemann_zeta(float s, float sm1) {
  const float PI = 3.14159265358979;
  if (sm1 == 0.0) return _gpu_inf(); // pole
  if (s == 0.0) return -0.5;
  if (s < 0.0) {
    if (s == floor(s) && mod(s, 2.0) == 0.0) return 0.0; // trivial zero
    // Below s = -63 the f32 error passes 3e-5 in an f32 model whose log2 is
    // 2.5 ulp off, and near s = -64.8 pow(y / (2 pi e), y) overflows.
    if (s < -63.0) return _gpu_nan();
    // sin(PI s/2) = (-1)^n sin(PI (s/2 - n)): s/2 - n is exact, so the
    // sine keeps its relative accuracy next to an even s.
    float hs = s / 2.0;
    float n = floor(hs + 0.5);
    float sinHalfPiS = sin(PI * (hs - n));
    if (mod(n, 2.0) != 0.0) sinHalfPiS = -sinHalfPiS;
    // 1 - s is rounded, but its distance to the pole, -s, is exact.
    float oneMinusS = 1.0 - s;
    // 2^s pi^(s-1) Gamma(1-s) = 2 Gamma(1-s)/(2 pi)^(1-s). From 1 - s = 8
    // on, from Stirling's series: with the Lanczos Gamma, zeta(s) was up to
    // 3.3e-5 off near s = -22 in an f32 model whose log2 is 2.5 ulp off.
    if (oneMinusS >= 8.0)
      return 2.0 * _gpu_zeta_gamma_2pi(oneMinusS).x * sinHalfPiS *
        _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
    return pow(2.0, s) * pow(PI, s - 1.0) * sinHalfPiS *
      _gpu_gamma(oneMinusS) * _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
  }
  return _gpu_hurwitz_zeta_em(s, 1.0, sm1);
}

float _gpu_zeta(float s) {
  return _gpu_riemann_zeta(s, s - 1.0);
}

// zeta(s, 1+h) = sum C(-s,k) h^k zeta(s+k), |h| < 1 — no cancellation,
// since each zeta(s+k) reflects to Re >= 0. See zetaNearOneComplex. The
// stop tolerance is near the f32 epsilon (1.2e-7), and 100 terms reach it
// for every s >= -24.5. Below, the series answers NaN: with _gpu_zeta
// defined down to s = -63, 46 of 1500 values of zeta(s, a) for s from -63.5
// to -24.5 were more than 3e-5 off.
float _gpu_zeta_near_one(float s, float h) {
  if (s < -24.5) return _gpu_nan();
  float sum = _gpu_zeta(s);
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
    if (f == 0.0) return sum + c * hk * (-1.0 / float(k));
    c = c * f / float(k);
    float term = c * hk * _gpu_riemann_zeta(s + float(k), -f);
    sum += term;
    float size = abs(term);
    largest = max(largest, size);
    if (size <= 1e-7 * largest) {
      if (++small == 2) break;
    } else small = 0;
  }
  return sum;
}

// 1 - e^(-y) for y >= 0, without the cancellation of 1.0 - exp(-y) at a
// small y (a Taylor polynomial below y = 0.25).
float _gpu_zeta_em1(float y) {
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
}

// zeta(s, b) for 0 < b <= 1 and s < 1 by Hermite's integral (DLMF
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
vec2 _gpu_zeta_hermite(float s, float b) {
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
        float ex = -0.5 * s * lr - y - log(_gpu_zeta_em1(y));
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
}

// zeta(s, b) for s <= -3 and 0 < b <= 1 by Hurwitz's formula, the Fourier
// series in the base point:
// 2 Gamma(1-s)/(2 pi)^(1-s) sum_k sin(2 pi k b + pi s/2) / k^(1-s). Its
// terms fall like k^(s-1) and do not cancel; 64 of them leave a tail below
// 64^s/(-s) of the prefactor, 1.3e-6 at s = -3. The sine argument is
// reduced exactly: pi (2 frac(k b) + (s/2 mod 2)), minus its nearest
// integer n, with the sign (-1)^n. Returns vec2(value, error estimate in
// units of 6e-8): the pow roundings, the rounding of the argument (about
// 20 k units of each term's size), the tail and the prefactor.
vec2 _gpu_zeta_fourier(float s, float b) {
  const float PI = 3.14159265358979;
  vec2 g = _gpu_zeta_gamma_2pi(1.0 - s);
  float hs = s / 2.0;
  float ps = hs - 2.0 * floor(hs / 2.0);
  float sum = 0.0;
  float err = 0.0;
  for (int k = 1; k <= 64; k++) {
    float fk = float(k);
    float kb = fk * b;
    float ph = 2.0 * (kb - floor(kb)) + ps;
    float n = floor(ph + 0.5);
    float sn = sin(PI * (ph - n));
    if (mod(n, 2.0) != 0.0) sn = -sn;
    float pk = pow(fk, s - 1.0);
    float t = sn * pk;
    sum += t;
    err += abs(t) * (4.0 + abs((s - 1.0) * log2(fk))) + pk * (fk * 20.0);
  }
  float tail = pow(64.0, s) / (-s);
  return vec2(2.0 * g.x * sum,
    2.0 * g.x * (err + tail / 6.0e-8 + 2.0 * abs(sum)) + 2.0 * g.y * abs(sum));
}

// zeta(s, a) for a > 0 and -24.5 <= s < 1 from the base point b = a - m in
// (0, 1]: zeta(s, a) = zeta(s, b) - sum_{j<m} (b + j)^(-s). zeta(s, b) is
// the Fourier series for s <= -3, the Taylor series in b for b < 2^-10
// (zeta(s, b) = b^(-s) + zeta(s, 1 + b), where Hermite's integral would
// need more panels), and Hermite's integral otherwise. NaN when the error
// estimate exceeds 3e-5 of the value (next to a zero of zeta(s, a)).
float _gpu_zeta_shifted(float s, float a) {
  float m = ceil(a) - 1.0;
  float b = a - m;
  vec2 r;
  if (s <= -3.0) r = _gpu_zeta_fourier(s, b);
  else if (b < 0.0009765625) {
    float t = pow(b, -s);
    float zn = _gpu_zeta_near_one(s, b);
    r = vec2(zn + t, 64.0 * abs(zn) + abs(t) * (3.0 + abs(s * log2(b))));
  } else r = _gpu_zeta_hermite(s, b);
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
  if (!(6.0e-8 * err <= 3.0e-5 * abs(z))) return _gpu_nan();
  return z;
}

float _gpu_hurwitz_zeta(float s, float a) {
  if (s == 1.0) return _gpu_inf(); // pole, every base point a
  if (s == 0.0) return 0.5 - a;
  if (a == 1.0) return _gpu_zeta(s);
  bool aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) return _gpu_inf(); // (a+k) = 0 term diverges
  if (a < 0.0 && s != floor(s)) return _gpu_nan(); // complex value
  if (a < -1.0e6) return _gpu_nan();
  float edge = max(12.0, ceil(abs(s)) + 6.0);
  // Where the Euler-Maclaurin terms cancel: s < 1/2 short of a = 4 * edge,
  // and 1/2 <= s < 1 below a = 1 (the zeros of zeta(s, a) there).
  if (a > 0.0 && s >= -24.5 && s < 1.0 && (s < 0.5 ? a < 4.0 * edge : a < 1.0))
    return _gpu_zeta_shifted(s, a);
  if (s >= 0.0 || a >= 4.0 * edge) return _gpu_hurwitz_zeta_em(s, a, s - 1.0);
  // Shift a to 1+h (|h| <= 3/4) and expand in Taylor series — see
  // hurwitzZetaComplex's doc comment for why EM alone cancels here.
  float m = floor(a - 0.5);
  float h = a - m - 1.0;
  if (abs(h) > 0.75) return _gpu_hurwitz_zeta_em(s, a, s - 1.0);
  float z = _gpu_zeta_near_one(s, h);
  int steps = int(abs(m));
  for (int j = 0; j < steps; j++) {
    float br = m > 0.0 ? h + 1.0 + float(j) : a + float(j);
    if (br == 0.0) continue;
    float t = _gpu_zeta_pow(br, -s);
    z = m > 0.0 ? z - t : z + t;
  }
  return z;
}

float _gpu_zeta_generalized(float s, float a) {
  if (s == 1.0) return _gpu_inf(); // pole, every base point a
  if (a > 0.0) return _gpu_hurwitz_zeta(s, a);
  if (a == 0.0) return _gpu_zeta(s);
  if (a < -1.0e6) return _gpu_nan();
  int n = int(ceil(-a));
  float sum = 0.0;
  for (int k = 0; k < n; k++) sum += pow(-(a + float(k)), -s);
  float cur = a + float(n);
  if (cur == 0.0) cur = 1.0; // drop the (k + a) = 0 term
  return sum + _gpu_hurwitz_zeta(s, cur);
}
`;

/**
 * GPU Hurwitz/Riemann/generalized zeta functions (WGSL syntax). See
 * `GPU_ZETA_PREAMBLE_GLSL`; WGSL has no implicit GLSL-style `float`/
 * braceless-`if` syntax, so a separate variant is required. The pole and NaN
 * come from the WGSL `_gpu_inf()` / `_gpu_nan()` helpers
 * (`GPU_NAN_PREAMBLE_WGSL`).
 */
export const GPU_ZETA_PREAMBLE_WGSL = `
fn _gpu_zeta_pow(x: f32, e: f32) -> f32 {
  if (x >= 0.0) { return pow(x, e); }
  if (e != floor(e)) { return _gpu_nan(); }
  let r = pow(-x, e);
  if ((abs(e) % 2.0) == 1.0) { return -r; }
  return r;
}

fn _gpu_hurwitz_zeta_em(s: f32, a: f32, sm1: f32) -> f32 {
  var n: i32 = i32(ceil(15.0 - a));
  if (n < 0) { n = 0; }
  var sum: f32 = 0.0;
  var z: f32 = a;
  for (var k: i32 = 0; k < n; k = k + 1) {
    sum = sum + _gpu_zeta_pow(z, -s);
    z = z + 1.0;
  }
  // The integral term is the pole at s = 1: it uses sm1 = s - 1 as the
  // caller knows it.
  sum = sum + pow(z, -sm1) / sm1 + 0.5 * pow(z, -s);
  let b = array<f32, 10>(
    1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0, 5.0 / 66.0,
    -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0, 43867.0 / 798.0,
    -174611.0 / 330.0
  );
  var u: f32 = (s / 2.0) * pow(z, -(s + 1.0));
  var prevAbs: f32 = 3.0e38;
  for (var j: i32 = 1; j <= 10; j = j + 1) {
    let term = u * b[j - 1];
    if (abs(term) >= prevAbs) { break; }
    sum = sum + term;
    prevAbs = abs(term);
    let m = f32(2 * j);
    u = u * (s + m - 1.0) * (s + m) / ((m + 1.0) * (m + 2.0) * z * z);
  }
  return sum;
}

// Gamma(x) / (2 pi)^x for x >= 1, with an error estimate, from Stirling's
// series — see GLSL's _gpu_zeta_gamma_2pi.
fn _gpu_zeta_gamma_2pi(x: f32) -> vec2<f32> {
  let PI = 3.14159265358979;
  var p: f32 = 1.0;
  var y: f32 = x;
  for (var k: i32 = 0; k < 8; k = k + 1) {
    if (y >= 8.0) { break; }
    p = p * y;
    y = y + 1.0;
  }
  let y2 = y * y;
  let corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * y2)) / y2) / y;
  let base = y / 17.079468445347132; // y / (2 pi e)
  let v = pow(base, y) * sqrt(2.0 * PI / y) * (exp(corr) / p) *
    pow(2.0 * PI, y - x);
  return vec2<f32>(v, abs(v) * (12.0 + abs(y * log2(base)) + y));
}

// zeta(s), with sm1 = s - 1 — see GLSL's _gpu_riemann_zeta.
fn _gpu_riemann_zeta(s: f32, sm1: f32) -> f32 {
  let PI = 3.14159265358979;
  if (sm1 == 0.0) { return _gpu_inf(); } // pole
  if (s == 0.0) { return -0.5; }
  if (s < 0.0) {
    if (s == floor(s) && (s % 2.0) == 0.0) { return 0.0; } // trivial zero
    if (s < -63.0) { return _gpu_nan(); } // see the GLSL version
    // sin(PI s/2) = (-1)^n sin(PI (s/2 - n)), with s/2 - n exact.
    let hs = s / 2.0;
    let n = floor(hs + 0.5);
    var sinHalfPiS = sin(PI * (hs - n));
    if ((n % 2.0) != 0.0) { sinHalfPiS = -sinHalfPiS; }
    // 1 - s is rounded, but its distance to the pole, -s, is exact.
    let oneMinusS = 1.0 - s;
    // 2 Gamma(1-s)/(2 pi)^(1-s) from Stirling's series from 1 - s = 8 on.
    if (oneMinusS >= 8.0) {
      return 2.0 * _gpu_zeta_gamma_2pi(oneMinusS).x * sinHalfPiS *
        _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
    }
    return pow(2.0, s) * pow(PI, s - 1.0) * sinHalfPiS *
      _gpu_gamma(oneMinusS) * _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
  }
  return _gpu_hurwitz_zeta_em(s, 1.0, sm1);
}

fn _gpu_zeta(s: f32) -> f32 {
  return _gpu_riemann_zeta(s, s - 1.0);
}

// zeta(s, 1+h) = sum C(-s,k) h^k zeta(s+k) — see GLSL's _gpu_zeta_near_one.
fn _gpu_zeta_near_one(s: f32, h: f32) -> f32 {
  if (s < -24.5) { return _gpu_nan(); } // see the GLSL version
  var sum = _gpu_zeta(s);
  var c = 1.0;
  var hk = 1.0;
  var largest = abs(sum);
  var small = 0;
  for (var k = 1; k < 100; k = k + 1) {
    hk = hk * h;
    if (hk == 0.0) { break; }
    // f = 1 - k - s, exact when s is near 1 - k (see the GLSL version).
    let f = f32(1 - k) - s;
    if (f == 0.0) { return sum + c * hk * (-1.0 / f32(k)); }
    c = c * f / f32(k);
    let term = c * hk * _gpu_riemann_zeta(s + f32(k), -f);
    sum = sum + term;
    let size = abs(term);
    largest = max(largest, size);
    if (size <= 1e-7 * largest) {
      small = small + 1;
      if (small == 2) { break; }
    } else { small = 0; }
  }
  return sum;
}

// 1 - e^(-y) for y >= 0 — see GLSL's _gpu_zeta_em1.
fn _gpu_zeta_em1(y: f32) -> f32 {
  if (y < 0.25) {
    var r = 1.0 - y / 7.0;
    r = 1.0 - y / 6.0 * r;
    r = 1.0 - y / 5.0 * r;
    r = 1.0 - y / 4.0 * r;
    r = 1.0 - y / 3.0 * r;
    r = 1.0 - y / 2.0 * r;
    return y * r;
  }
  return 1.0 - exp(-y);
}

// zeta(s, b) for 0 < b <= 1 and s < 1 by Hermite's integral, as
// vec2(value, error estimate) — see GLSL's _gpu_zeta_hermite.
fn _gpu_zeta_hermite(s: f32, b: f32) -> vec2<f32> {
  let PI = 3.14159265358979;
  let gx = array<f32, 4>(0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  let gw = array<f32, 4>(0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  let k = pow(b, -s) / (2.0 * (s - 1.0));
  // max() blocks a fast-math reassociation — see the GLSL version.
  let c = s + max(2.0 * b - 1.0, -1.0);
  let closed = k * c;
  var lowB: f32 = 0.0;
  if (b < 0.25) { lowB = 1.0; }
  var err = abs(k) * (abs(c) + lowB) + abs(closed) * (4.0 + abs(s * log2(b)));
  let b2 = b * b;
  let tPeak = max(0.0, -s / (2.0 * PI));
  var sum: f32 = 0.0;
  var largest: f32 = 0.0;
  var x: f32 = 0.0;
  var done = false;
  for (var p: i32 = 0; p < 40; p = p + 1) {
    var w: f32 = min(x, 1.0);
    if (x == 0.0) { w = 0.5 * b; }
    let cc = x + 0.5 * w;
    let r = 0.5 * w;
    var size: f32 = 0.0;
    for (var i: i32 = 0; i < 4; i = i + 1) {
      for (var j: i32 = 0; j < 2; j = j + 1) {
        var d = r;
        if (j == 0) { d = -r; }
        let t = cc + d * gx[i];
        let y = 2.0 * PI * t;
        let lr = log(b2 + t * t);
        let ex = -0.5 * s * lr - y - log(_gpu_zeta_em1(y));
        let th = s * atan(t / b);
        let q = r * gw[i] * exp(ex);
        let f = q * sin(th);
        sum = sum + f;
        size = size + abs(f);
        err = err + 2.0 * (abs(f) * (6.0 + abs(ex) + 0.5 * abs(s) * (2.0 + abs(lr))) +
          q * abs(th));
      }
    }
    x = x + w;
    let mean = size / w;
    largest = max(largest, mean);
    if (x > tPeak && x >= 1.0 && mean <= 1e-9 * largest) {
      done = true;
      break;
    }
  }
  if (!done) { return vec2<f32>(0.0, 3.0e38); }
  let v = closed + 2.0 * sum;
  return vec2<f32>(v, err + 2.0 * abs(v));
}

// zeta(s, b) for s <= -3 and 0 < b <= 1 by Hurwitz's formula, as
// vec2(value, error estimate) — see GLSL's _gpu_zeta_fourier.
fn _gpu_zeta_fourier(s: f32, b: f32) -> vec2<f32> {
  let PI = 3.14159265358979;
  let g = _gpu_zeta_gamma_2pi(1.0 - s);
  let hs = s / 2.0;
  let ps = hs - 2.0 * floor(hs / 2.0);
  var sum: f32 = 0.0;
  var err: f32 = 0.0;
  for (var k: i32 = 1; k <= 64; k = k + 1) {
    let fk = f32(k);
    let kb = fk * b;
    let ph = 2.0 * (kb - floor(kb)) + ps;
    let n = floor(ph + 0.5);
    var sn = sin(PI * (ph - n));
    if ((n % 2.0) != 0.0) { sn = -sn; }
    let pk = pow(fk, s - 1.0);
    let t = sn * pk;
    sum = sum + t;
    err = err + abs(t) * (4.0 + abs((s - 1.0) * log2(fk))) + pk * (fk * 20.0);
  }
  let tail = pow(64.0, s) / (-s);
  return vec2<f32>(2.0 * g.x * sum,
    2.0 * g.x * (err + tail / 6.0e-8 + 2.0 * abs(sum)) + 2.0 * g.y * abs(sum));
}

// zeta(s, a) for a > 0 and -24.5 <= s < 1 from the base point b = a - m
// in (0, 1] — see GLSL's _gpu_zeta_shifted.
fn _gpu_zeta_shifted(s: f32, a: f32) -> f32 {
  let m = ceil(a) - 1.0;
  let b = a - m;
  var r: vec2<f32>;
  if (s <= -3.0) {
    r = _gpu_zeta_fourier(s, b);
  } else if (b < 0.0009765625) {
    let t = pow(b, -s);
    let zn = _gpu_zeta_near_one(s, b);
    r = vec2<f32>(zn + t, 64.0 * abs(zn) + abs(t) * (3.0 + abs(s * log2(b))));
  } else {
    r = _gpu_zeta_hermite(s, b);
  }
  var z = r.x;
  var err = r.y;
  // m <= 123: the caller keeps a below 4 * edge <= 124.
  for (var j: i32 = 0; j < 128; j = j + 1) {
    if (f32(j) >= m) { break; }
    let br = b + f32(j);
    let t = pow(br, -s);
    z = z - t;
    err = err + abs(t) * (3.0 + f32(j) + abs(s * log2(br)));
  }
  err = err + abs(z) * (m + 2.0);
  if (!(6.0e-8 * err <= 3.0e-5 * abs(z))) { return _gpu_nan(); }
  return z;
}

fn _gpu_hurwitz_zeta(s: f32, a: f32) -> f32 {
  if (s == 1.0) { return _gpu_inf(); } // pole, every base point a
  if (s == 0.0) { return 0.5 - a; }
  if (a == 1.0) { return _gpu_zeta(s); }
  let aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) { return _gpu_inf(); } // (a+k) = 0 diverges
  if (a < 0.0 && s != floor(s)) { return _gpu_nan(); } // complex value
  if (a < -1.0e6) { return _gpu_nan(); }
  let edge = max(12.0, ceil(abs(s)) + 6.0);
  // Where the Euler-Maclaurin terms cancel — see the GLSL version.
  var shifted = false;
  if (s < 0.5) { shifted = a < 4.0 * edge; } else { shifted = a < 1.0; }
  if (a > 0.0 && s >= -24.5 && s < 1.0 && shifted) { return _gpu_zeta_shifted(s, a); }
  if (s >= 0.0 || a >= 4.0 * edge) { return _gpu_hurwitz_zeta_em(s, a, s - 1.0); }
  // Shift a to 1+h (|h| <= 3/4) and expand in Taylor series — see
  // hurwitzZetaComplex's doc comment for why EM alone cancels here.
  let m = floor(a - 0.5);
  let h = a - m - 1.0;
  if (abs(h) > 0.75) { return _gpu_hurwitz_zeta_em(s, a, s - 1.0); }
  var z = _gpu_zeta_near_one(s, h);
  let steps = i32(abs(m));
  for (var j = 0; j < steps; j = j + 1) {
    var br: f32;
    if (m > 0.0) { br = h + 1.0 + f32(j); } else { br = a + f32(j); }
    if (br == 0.0) { continue; }
    let t = _gpu_zeta_pow(br, -s);
    if (m > 0.0) { z = z - t; } else { z = z + t; }
  }
  return z;
}

fn _gpu_zeta_generalized(s: f32, a: f32) -> f32 {
  if (s == 1.0) { return _gpu_inf(); } // pole, every base point a
  if (a > 0.0) { return _gpu_hurwitz_zeta(s, a); }
  if (a == 0.0) { return _gpu_zeta(s); }
  if (a < -1.0e6) { return _gpu_nan(); }
  let n = i32(ceil(-a));
  var sum: f32 = 0.0;
  for (var k: i32 = 0; k < n; k = k + 1) { sum = sum + pow(-(a + f32(k)), -s); }
  var cur = a + f32(n);
  if (cur == 0.0) { cur = 1.0; } // drop the (k + a) = 0 term
  return sum + _gpu_hurwitz_zeta(s, cur);
}
`;

/**
 * GPU Lerch transcendent Φ(z,s,a) = Σ zᵏ(k+a)^(−s) and polylogarithm
 * Liₛ(z) = z·Φ(z,s,1), for real operands, real-valued (f32). GLSL syntax.
 *
 * `_gpu_lerch_phi` answers NaN where the value is complex: a real z > 1 is on
 * the branch cut (unless s is a non-positive integer, where Φ is a rational
 * function of z and has no cut), and a < 0 with a non-integer s has complex
 * terms. It also answers NaN where no method below can vouch for its value.
 * The helpers behind it return vec2(value, 1), or vec2(0, 0) to decline, so
 * that the dispatcher (`_gpu_lerch_core`) can try the next method: a NaN
 * test (isnan, or x != x) is not reliable under the drivers' fast-math.
 *
 * The methods, in the order `_gpu_lerch_core` tries them:
 * - z = 1 is the Hurwitz zeta ζ(s,a); z = 0 keeps only the k = 0 term;
 *   s = 0 is 1/(1 − z).
 * - A non-positive integer s = −n, n <= `LERCH_MAX_N`:
 *   `_gpu_lerch_rational`, the rational function Φ(z,−n,a) = P_n(z)/(1−z)^(n+1),
 *   for every z and every a, summed in u = z/(1 − z) and v = 1/(1 − z) (both
 *   at most 1 in size below z = −1), where the old closed forms for s = −1
 *   and −2 cancelled (2.9e−5 at Φ(−95.07, −2, 1.098)).
 * - `_gpu_lerch_series`, the direct sum, for real |z| < 1 (and for z < 0
 *   with s < 0, where the Euler transform is not valid). The terms with
 *   a + k <= 0 are summed first, without a convergence test, since they need
 *   not decrease. After them the sum stops when three consecutive terms each
 *   shrink and bound the tail below 1e−7 of the sum: the bound is
 *   |term|·ρ/(1−ρ), where ρ, the larger of the current term ratio and |z|,
 *   bounds every later ratio. It declines when 4096 terms past the prefix
 *   do not reach that (|z| above about 0.995 for s near 0, closer to 1 when
 *   s is larger), or when its error estimate exceeds 3e−5 of the sum: the
 *   terms weighted by the roundings of zᵏ and of pow(a + k, −s), whose GPU
 *   error grows with |s·log2(a + k)|. (A cap of 100 on the ratio of the
 *   largest term to the sum let 5.6e−4 through at Φ(−0.645, −10, 8.99).)
 *   It also declines when |sum|·(1 − |z|) < 2^24 · 1.2e−38: a GPU flushes a
 *   term below the smallest normal f32 (1.2e−38) to zero, and the flushed
 *   tail, at most 1.2e−38/(1 − |z|), must stay below 2^−24 of the sum
 *   (0.72% was lost at Φ(0.5, 12, 1000) ≈ 1.98e−36 without this test).
 * - `_gpu_lerch_euler`, the van Wijngaarden Euler transform (Numerical
 *   Recipes' `eulsum`), for −1 <= z < 0 and s > 0: direct summation there is
 *   only conditionally convergent and stalls approaching the rim. The terms
 *   with a + k <= 0 are summed first, as in the series. It stops when three
 *   consecutive increments are below 1e−7 of the sum, and declines when the
 *   `LERCH_EULER_TERMS` budget runs out first (GLSL/WGSL arrays need a
 *   compile-time size) or when the sum is below 1/100 of its largest term.
 *   It also declines when the transformed sum is below 2^24 · 1.2e−38, so
 *   that the terms the stopping rule reads (down to 1e−7 of the sum) are
 *   normal f32 values that a GPU does not flush to zero.
 * - `_gpu_lerch_integral`, for s > 0 below z = −1 and where the series or
 *   the transform declines: Φ = (1/Γ(s)) ∫₀^∞ t^(s−1) e^(−at) / (1 − z e^(−t)) dt,
 *   whose integrand is positive for every z < 1. For a non-integer s < 0
 *   (`_gpu_lerch_negative`, below z = −1, at z = −1 and where the series
 *   declines) the same integral after n = ⌈−s⌉ integrations by parts, with
 *   Φ(z e^(−t), −n, a) in the integrand; that integrand changes sign for
 *   z < 0 and the error estimate measures the cancellation. 8-point
 *   Gauss-Legendre panels that follow the step of the integrand at
 *   t = ln|z|, so the whole f32 range (|z| up to 3.4e38) takes at most 22
 *   of the 28 panels allowed.
 * - `_gpu_lerch_hermite`, where the integral declines for s <= 0, and for
 *   z > 1 with an integer s where the rational form declines: the
 *   Hermite-type representation (mpmath's), with the upper incomplete gamma
 *   at the complex argument −a·log z computed in f32 (series, continued
 *   fraction, or the closed form for an integer s) and an integral of at
 *   most 16 panels. Its terms cancel as |z| grows. The panels are not cut
 *   by the phase rate |s|/b of the integrand (the interpreter's
 *   `hermiteTail` cuts its panels to 12 radians): the 16-panel limit
 *   already declines every call with b = 1 below s ≈ −16.9 (at s = −30 it
 *   would need 28 panels), and where a panel holds up to 27 radians the
 *   phase changes fast only near t = 0, where e^(−2πt) is not yet small
 *   but (b² + t²)^(−s/2) is. In the f32 model, on 60000 random points (s
 *   from −30 to −1, half of them integers, z from −1100 to −0.05 and from
 *   1.1 to 150, a from 0.05 to 6), the 16100 values it answers are within
 *   4.9e−6, and computed in double the quadrature error of the panels is
 *   at most 3.8e−6 of |Φ| on the 33589 points of a denser grid it
 *   answers. Cutting the panels to 12 radians answered 1927 fewer of the
 *   60000 values, with about the same worst error (4.6e−6), because more
 *   calls passed the 16-panel limit (CE-235). It also declines an infinite
 *   result: a term past the f32 range passed its error test (∞ <= ∞).
 * - PolyLog below z = −1 with a negative non-integer order, where those
 *   decline: Jonquière's inversion formula (`_gpu_poly_log_inversion`).
 * - Last, for z < 0 and −30 <= s <= −3, where every method above declines
 *   (in `_gpu_lerch_phi` and `_gpu_poly_log`, so that no value they answer
 *   changes): the sum over the Fourier modes of the base point
 *   (`_gpu_lerch_modes`, the form of `lerchModesComplex` in
 *   `numerics/lerch-phi.ts`). With b = a moved into (0, 1] and L = ln|z|,
 *   Φ(z,s,b) = 2Γ(1−s)e^(−bL) Σ_{m odd} (L² + π²m²)^((s−1)/2)
 *   cos(π(bm + (s−1)(1/2 + atan(L/(πm))/π))). The terms fall like m^(s−1)
 *   and do not cancel, where the Hermite form's terms cancel next to and
 *   below z = −1: Φ(−1, −6.5, 1.3) = 0.10992 was NaN. For PolyLog the
 *   factor z of Liₛ(z) = z·Φ(z,s,1) goes into the exponent of the scale,
 *   so that Liₛ(z) does not pass through Φ, which falls below the smallest
 *   normal f32 before Liₛ(z) does.
 *
 * The integral, rational, Hermite, inversion and mode methods and the
 * series decline when their own error estimate exceeds 3e−5 of the
 * value. The inversion and the modes also decline when the value, or a
 * factor that multiplies it (z^(−m), z^m, the shifted sum), is not a
 * finite normal f32: a GPU flushes a value below 1.18e−38 to 0, and a
 * value past 3.4e38 is inf, and the test passed 0 and inf whatever the
 * estimate. Their estimates count each value that a GPU can flush as a
 * loss of 1.18e−38, and they test err <= 500·|value| (500 = 3e−5 / 6e−8),
 * since 6e−8·err and 3e−5·|value| both flush to 0 for a value below about
 * 4e−34. For PolyLog below z = −1, a Φ(z,s,1) below 3.9e−34 from the
 * other methods goes to the inversion and the modes for the same reason.
 * The
 * estimate adds, in units of the f32 rounding error, the error of each exp
 * and pow call (on a GPU it grows with the size of the argument: pow(b, e)
 * is within about 6e−8·(2 + |e·log2 b|) relative) and the cancellation
 * between the terms.
 *
 * Cost of one call, in loop iterations: the series up to 4096 terms (plus
 * one per unit of −a for a < 0); the transform up to 64 terms; the
 * rational form up to 16 rows of at most 18 coefficients; the integral up
 * to 224 integrand values, each with a Horner sum of n + 1 <= 17 terms;
 * the Hermite form up to 199 continued-fraction steps and 128 integrand
 * values; the inversion 20 terms and an inner series of up to 199 terms (or
 * the integral and Hermite form again); the Fourier modes up to 128 modes
 * and up to 100 shift terms. The dispatcher tries at most three of these
 * per call, and the modes after them: the worst case, near z = 1 with
 * s < 0, is the 4096 series terms, then the integral, then the Hermite form
 * (about 4700 iterations plus the Horner sums); below z = −1 at most about
 * 1100, and 230 more for the modes.
 *
 * Accuracy, measured on an Apple M5 Max GPU (WebGL2 through ANGLE Metal, and
 * WebGPU; the two agree within 2.6e−6 relative) against mpmath's lerchphi
 * and polylog at the f32-rounded operands, on 4130 random real points (z
 * from −1e6 to 1, and up to 1e3 for an integer s <= −3; s from −12 to 12
 * with integers, half-integers and near-integers; a from 0.05 to 50, and
 * negative a with an integer s), and on 63 points with |z| from 1e8 to 3e38
 * against 40-digit quadrature: every value that is not NaN is within 1.5e−5
 * relative (worst 1.34e−5, from the Hermite form next to z = 1; every other
 * method within 8.5e−6). A true value below the smallest normal f32
 * (1.2e−38) comes back as 0 or a wrong subnormal: GPUs flush subnormals to
 * zero. A value above it does not lose terms to the flush: the series and
 * the Euler transform decline when a term they need can be below 1.2e−38
 * (see above), and the integral sums nodes without the factor a^(−s) (and,
 * below z = −1, with e^S) and applies that factor once at the end. An f32
 * model whose log2 is 2.5 ulp off (a worse GPU than the one measured) puts
 * some values at up to 2.4e−5: the error grows with the size of the pow and
 * exp arguments, |s·log2 a| for a large |s|.
 *
 * The Fourier modes, measured the same way on 900 points with z <= −0.3
 * and s from −16 to −3 (600 of LerchPhi at z = −1, below it with |z| up to
 * 1e6, and between −1 and −0.3; 300 of PolyLog below z = −1, half with s
 * within 1 of −12), where the other methods left 234 values NaN: 40 are
 * NaN now, and every value is within 1.4e−5 (worst 1.38e−5 for PolyLog,
 * 8.5e−6 for LerchPhi). On 1500 further random points over the whole domain
 * above (z from −1e6 to 1e3, s from −12 to 12, a from 0.05 to 50 and
 * negative a with an integer s), 1469 answer instead of 1388, all within
 * 1.05e−5, and the 1388 values answered before are bit-identical.
 *
 * Far below z = −1, on the same GPU against the CPU kernels (which agree
 * with mpmath at 100 digits within 8e−13 on a sample of 350), on 4000
 * PolyLog points (z from −1e38 to −1 with a log-uniform size, s from −30
 * to −3) and 2000 LerchPhi points (the same z and s, a from 0.1 to 10):
 * 3485 PolyLog values and 960 LerchPhi values answer. Before the
 * finite-normal tests and the stopping rule of Liₛ(1/z) in the inversion
 * (see `_gpu_poly_log_inversion`), 3792 and 1141 answered, of which 786
 * and 170 were more than 1.5e−5 off: 0 for Li_{−24.8}(−1.1e35) = −3.7e−25,
 * +inf for Φ(−7.6e6, −20.44, 5.78) = 1.02e7, 9.6 times too large for
 * Li_{−28.97}(−8.7e8). Every value whose true value is a normal f32 is now
 * within 2.1e−5: 16 PolyLog values (the inversion with s below −20 and |z|
 * above 1e20, and the modes) and 2 LerchPhi values (the modes) are between
 * 1.5e−5 and 2.04e−5, where the error estimates are just below 3e−5. 15
 * LerchPhi values whose true value is below 1.18e−38 come back as 0 or a
 * wrong subnormal, as above. On 3000 points each over the domain above
 * (z from −1e6 to 1, s from −12 to 12, a from 0.05 to 50), the LerchPhi
 * values are bit-identical to those before these changes; 92 PolyLog
 * values of the modes moved by at most 2e−6 relative (the factor z is now
 * in the exponent); one LerchPhi and one PolyLog value of the modes, off
 * by the same amount before, are 1.85e−5 and 1.7e−5 off.
 */
const LERCH_EULER_TERMS = 64;
/** The largest n for which the Lerch helpers build the rational function
 * Φ(w, −n, a) (their coefficient arrays hold n + 2 entries). */
const LERCH_MAX_N = 16;
export const GPU_LERCH_PREAMBLE_GLSL = `
vec2 _gpu_lerch_series(float z, float s, float a) {
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
    float t = (b != 0.0) ? zk * _gpu_zeta_pow(b, -s) : 0.0;
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
}

vec2 _gpu_lerch_euler(float z, float s, float a) {
  int n0 = a <= 0.0 ? int(floor(-a)) + 1 : 0;
  float head = 0.0;
  float zn = 1.0;
  float largest = 0.0;
  for (int k = 0; k < n0; k++) {
    float b = a + float(k);
    float t = (b != 0.0) ? zn * _gpu_zeta_pow(b, -s) : 0.0;
    head += t;
    largest = max(largest, abs(t));
    zn *= z;
  }
  float b0 = a + float(n0);
  float w[${LERCH_EULER_TERMS + 1}];
  int nterm = 0;
  float sum = 0.0;
  float zPow = 1.0;
  int settled = 0;
  for (int k = 0; k < ${LERCH_EULER_TERMS}; k++) {
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
      if (nterm >= ${LERCH_EULER_TERMS}) return vec2(0.0);
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
}

// 1 - e^(-t) for t >= 0, by its Taylor series below 1/4, where
// 1.0 - exp(-t) would cancel.
float _gpu_lerch_em(float t) {
  if (t < 0.25)
    return t * (1.0 - t / 2.0 * (1.0 - t / 3.0 * (1.0 - t / 4.0 *
      (1.0 - t / 5.0 * (1.0 - t / 6.0 * (1.0 - t / 7.0))))));
  return 1.0 - exp(-t);
}

// ln Gamma(s) for s > 0: shift the argument to x >= 8 (ln Gamma(s) =
// ln Gamma(x) - ln(s (s+1) ... (x-1))), then the Stirling series. Within
// about 1e-6 absolute. _gpu_gamma is not used here: its Lanczos sum
// cancels in f32 near s = 0.
float _gpu_lerch_lgamma(float s) {
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
}

// 1 / (1 - z e^(-t)) for t >= 0 and z < 1, without cancellation: for
// 0 < z < 1 the denominator is (1 - z) + z (1 - e^(-t)), two terms >= 0.
float _gpu_lerch_g(float z, float t) {
  if (z < 0.0) return 1.0 / (1.0 - z * exp(-t));
  return 1.0 / ((1.0 - z) + z * _gpu_lerch_em(t));
}

// One step of the polynomials P_m(w) = (1 - w)^(m+1) Phi(w, -m, a), in
// place: P_(m+1)(w) = (1 - w)(a P_m + w P_m') + (m + 1) w P_m, that is
// p'_k = (a + k) p_k + (m + 2 - a - k) p_(k-1), from P_0 = 1. It follows from
// Phi(w, -m-1, a) = (a + w d/dw) Phi(w, -m, a). Updated from the top so
// each entry still reads the previous row's values. c holds
// LERCH_MAX_N + 2 entries.
void _gpu_lerch_pstep(inout float c[${LERCH_MAX_N + 2}], float a, int m) {
  for (int k = m + 1; k >= 0; k--) {
    float hi = k <= m ? (a + float(k)) * c[k] : 0.0;
    float lo = k >= 1 ? (float(m + 2) - a - float(k)) * c[k - 1] : 0.0;
    c[k] = hi + lo;
  }
}

// Phi(w, -n, a) = v sum_k p_k u^k v^(n-k), v = 1/(1 - w), u = w v, from
// the coefficients of P_n: returns vec2(the sum without its factor v, the
// sum of the moduli of its terms), by Horner in u with the powers of v
// carried along. For w < -1, |u| and |v| are at most 1, so nothing
// overflows. The caller applies the factor v, or folds it into an
// exponent (see _gpu_lerch_integral).
vec2 _gpu_lerch_poly(float c[${LERCH_MAX_N + 2}], int n, float u, float v) {
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
}

// Phi(z, -n, a) for an integer 0 <= n <= LERCH_MAX_N: a rational function
// of z, for every real z != 1 and every a (the (k + a) = 0 term is 0^n = 0,
// dropped as the series drops it). It has no branch cut, so it holds for
// z > 1 too. Returns vec2(value, 1), or vec2(0, 0) when the terms cancel so
// far that the error estimate exceeds 3e-5 of the value (next to a zero of
// Phi); the caller then tries its other methods.
vec2 _gpu_lerch_rational(float z, int n, float a) {
  const float EPS = 6.0e-8;
  float c[${LERCH_MAX_N + 2}];
  for (int i = 0; i < ${LERCH_MAX_N + 2}; i++) c[i] = 0.0;
  c[0] = 1.0;
  for (int m = 0; m < n; m++) _gpu_lerch_pstep(c, a, m);
  float v = 1.0 / (1.0 - z);
  vec2 q = _gpu_lerch_poly(c, n, z * v, v);
  if (!(EPS * (float(n + 4) * q.y) <= 3.0e-5 * abs(q.x))) return vec2(0.0);
  return vec2(q.x * v, 1.0);
}

// Phi(z,s,a) for real z < 1 (z != 0) and a > 0, from
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
vec2 _gpu_lerch_integral(float z, float s, float a) {
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
    float t = zk * _gpu_zeta_pow(bk, -s);
    head += t;
    err += abs(t) * (2.0 + float(k) + abs(s * log2(abs(bk))));
    zk *= z;
  }
  a += float(n0);
  float c[${LERCH_MAX_N + 2}];
  for (int i = 0; i < ${LERCH_MAX_N + 2}; i++) c[i] = 0.0;
  c[0] = 1.0;
  for (int m = 0; m < n; m++) _gpu_lerch_pstep(c, a, m);
  float lg = _gpu_lerch_lgamma(sn);
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
  vec2 f0 = _gpu_lerch_poly(c, n, u0, v0h);
  float c1[${LERCH_MAX_N + 2}] = c;
  _gpu_lerch_pstep(c1, a, n);
  vec2 f1 = _gpu_lerch_poly(c1, n + 1, u0, v0h);
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
          vn = _gpu_lerch_g(z, t);
          un = z * exp(-t) * vn;
        }
        vec2 pv = _gpu_lerch_poly(c, n, un, vn);
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
  float scaled = big ? (sum < 0.0 ? -1.0 : 1.0) * exp(log(abs(sum)) - (S + sn * la))
                     : pow(a, -sn) * sum;
  float tail = zk * scaled;
  float res = head + tail;
  float rel = ferr / abs(sum) + (8.0 + abs(lg)) +
    ((float(n0) + 2.0) + (abs(sn * log2(a)) + S));
  float bound = EPS * (err + abs(tail) * rel);
  if (!(bound <= 3.0e-5 * abs(res))) return vec2(0.0);
  return vec2(res, 1.0);
}

// The three ways _gpu_lerch_hermite computes h = e^x x^(-sig) Gamma(sig, x)
// at a complex x = (x.x, x.y), sig >= 1. Each returns vec4(Re h, Im h,
// err, ok), with err an estimate of the absolute error of h in units of
// the f32 rounding error.
//
// An integer sig = n + 1: Gamma(n+1, x) = n! e^(-x) sum_{k<=n} x^k / k!,
// so h = (1/x) sum_{j<=n} n!/(n-j)! x^(-j), summed from the inside out.
vec4 _gpu_lerch_h_integer(float sig, vec2 x) {
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
}

// |x| < sig: h = e^x x^(-sig) Gamma(sig) - sum_k x^k / (sig (sig+1) ... (sig+k)),
// whose terms decrease from the first. (The continued fraction loses
// digits in f32 there: 8% at sig = 12.9, x = -0.01 - 3.14i.)
vec4 _gpu_lerch_h_series(float sig, vec2 x) {
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
  float er = x.x - sig * log(sqrt(x.x * x.x + x.y * x.y)) + _gpu_lerch_lgamma(sig);
  // arg x. At z = -1, x.x is -0.0, and the two-argument atan of Apple's
  // GPU (ANGLE Metal and WebGPU) then answers the wrong branch, so the
  // imaginary axis is taken explicitly.
  float arg = x.x == 0.0 ? (x.y < 0.0 ? -1.5707963267949 : 1.5707963267949) : atan(x.y, x.x);
  float ei = x.y - sig * arg;
  float m = exp(er);
  return vec4(m * cos(ei) - sr, m * sin(ei) - si,
    m * (24.0 + abs(er) + abs(ei)) + (float(k) + 3.0) * sa, 1.0);
}

// |x| >= sig: Legendre's continued fraction for h, by the modified Lentz
// method, at most 200 steps.
vec4 _gpu_lerch_h_cf(float sig, vec2 x) {
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
}

// Phi(z,s,a) for real z != 0, 1 and s <= 0, from the Hermite-type
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
vec2 _gpu_lerch_hermite(float z, float s, float a) {
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
      float t = zk * _gpu_zeta_pow(bk, -s);
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
  if (sig == floor(sig)) h = _gpu_lerch_h_integer(sig, x);
  else if (sqrt(x.x * x.x + x.y * x.y) < sig) h = _gpu_lerch_h_series(sig, x);
  else h = _gpu_lerch_h_cf(sig, x);
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
        float omq = _gpu_lerch_em(y);
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
}

// Phi(z,s,a) for s <= 0: the integral after n integrations by parts (a
// non-integer s >= -LERCH_MAX_N with a > 0), and where it declines the
// Hermite form.
vec2 _gpu_lerch_negative(float z, float s, float a) {
  if (s != floor(s) && a > 0.0 && s >= -${LERCH_MAX_N}.0) {
    vec2 r = _gpu_lerch_integral(z, s, a);
    if (r.y > 0.5) return r;
  }
  return _gpu_lerch_hermite(z, s, a);
}

// Phi(z,s,a) as vec2(value, 1), or vec2(0, 0) where the value is complex
// or no method can vouch for it. The cases, in order: z = 1 is the Hurwitz
// zeta; z = 0 keeps only the k = 0 term; s = 0 is 1/(1 - z); a
// non-positive integer s >= -LERCH_MAX_N is the rational function of
// _gpu_lerch_rational, for every z, where it does not decline; a
// non-positive integer a with s > 0 is the pole (+inf); a < 0 with a
// non-integer s is complex; z > 1 is on the branch cut unless s is a
// non-positive integer, where Phi has no cut (the Hermite form). Past
// z = -1 and at z = -1: the positive integral for s > 0, and for s <= 0
// _gpu_lerch_negative. Inside the unit interval: the Euler transform
// (z < 0, s > 0) or the direct series, and where those decline the
// integral (s > 0) or _gpu_lerch_negative (s <= 0).
vec2 _gpu_lerch_core(float z, float s, float a) {
  if (z == 1.0) return vec2(_gpu_hurwitz_zeta(s, a), 1.0);
  if (z == 0.0) return vec2(_gpu_zeta_pow(a, -s), 1.0); // only the k = 0 term survives
  if (s == 0.0) return vec2(1.0 / (1.0 - z), 1.0);
  if (s < 0.0 && s == floor(s) && s >= -${LERCH_MAX_N}.0) {
    vec2 q = _gpu_lerch_rational(z, int(-s), a);
    if (q.y > 0.5) return q;
  }
  bool aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) return vec2(_gpu_inf(), 1.0); // (k+a) = 0 diverges, z != 0
  if (a < 0.0 && s != floor(s)) return vec2(0.0); // complex value
  if (a < -1.0e6) return vec2(0.0); // one term per unit of -a
  if (z > 1.0) {
    if (s > 0.0 || s != floor(s)) return vec2(0.0); // on the branch cut
    return _gpu_lerch_hermite(z, s, a);
  }
  if (z < -1.0) return s > 0.0 ? _gpu_lerch_integral(z, s, a) : _gpu_lerch_negative(z, s, a);
  if (z < 0.0 && s > 0.0) {
    vec2 e = _gpu_lerch_euler(z, s, a);
    return e.y > 0.5 ? e : _gpu_lerch_integral(z, s, a);
  }
  if (z == -1.0) return _gpu_lerch_negative(z, s, a); // s < 0: the series diverges
  vec2 r = _gpu_lerch_series(z, s, a);
  if (r.y > 0.5) return r;
  return s > 0.0 ? _gpu_lerch_integral(z, s, a) : _gpu_lerch_negative(z, s, a);
}

// Phi(z, s, a) for z < 0, -30 <= s <= -3 and |a| < 100, from the Fourier
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
vec2 _gpu_lerch_modes(float z, float s, float a, float c) {
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
      float t = zk * _gpu_zeta_pow(bj, -s);
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
  float lg = _gpu_lerch_lgamma(1.0 - s);
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
}

// Where every method of _gpu_lerch_core declines, z < 0 with s <= -3 tries
// the Fourier modes last, so that the values the other methods answer do
// not change.
float _gpu_lerch_phi(float z, float s, float a) {
  vec2 r = _gpu_lerch_core(z, s, a);
  if (r.y > 0.5) return r.x;
  if (z < 0.0 && s <= -3.0 && !(a < 0.0 && s != floor(s))) {
    r = _gpu_lerch_modes(z, s, a, 0.0);
    if (r.y > 0.5) return r.x;
  }
  return _gpu_nan();
}

// Li_s(z) for z < -1 and a real s < 0 that is not an integer, by
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
vec2 _gpu_poly_log_inversion(float s, float z) {
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
  float lg1 = _gpu_lerch_lgamma(sig);
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
  // was 9.6 times too large.) Closer to the rim _gpu_lerch_negative (the
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
    vec2 inner = _gpu_lerch_negative(iz, s, 1.0);
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
}

// PolyLog(s, z). The integer orders the interpreter answers in closed form
// come first, so the shader agrees with it there: z = 0 is 0; the orders 1,
// 0 and -1 are -ln(1 - z), z/(1 - z) and z/(1 - z)^2, with a pole (+inf)
// at z = 1; an order -n, 2 <= n <= 12, is the Eulerian closed form
// z * sum_k A(n,k) z^k / (1 - z)^(n+1), which for |z| > 1 is summed in
// u = z/(1 - z) and v = 1/(1 - z) (|u|, |v| <= 1 for z < -1) so that it does
// not overflow. Every other order uses Li_s(z) = z * Phi(z, s, 1), and where
// that declines below z = -1 with a negative non-integer order, Jonquiere's
// inversion formula (_gpu_poly_log_inversion). NaN on the cut z > 1 (except
// the orders above) and where both decline.
float _gpu_poly_log(float s, float z) {
  if (z == 0.0) return 0.0;
  if (s == 1.0) {
    if (z == 1.0) return _gpu_inf();
    return z < 1.0 ? -log(1.0 - z) : _gpu_nan();
  }
  if (s == 0.0) {
    if (z == 1.0) return _gpu_inf();
    return z / (1.0 - z);
  }
  if (s == -1.0) {
    if (z == 1.0) return _gpu_inf();
    return z / ((1.0 - z) * (1.0 - z));
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
  // _gpu_lerch_core falls below it (a GPU flushes both sides to 0) when
  // |Phi| < 1.18e-38 / 3e-5 = 3.9e-34: the inversion and the modes (with the
  // factor z in the exponent) answer there instead.
  vec2 r = _gpu_lerch_core(z, s, 1.0);
  if (r.y > 0.5 && (z >= -1.0 || (abs(r.x) >= 3.9e-34 && abs(z * r.x) < 3.4e38)))
    return z * r.x;
  if (z < -1.0 && s < 0.0 && s != floor(s)) {
    vec2 v = _gpu_poly_log_inversion(s, z);
    if (v.y > 0.5) return v.x;
  }
  if (z < 0.0 && s <= -3.0) {
    r = _gpu_lerch_modes(z, s, 1.0, 1.0);
    if (r.y > 0.5) return r.x;
  }
  return _gpu_nan();
}
`;

/**
 * GPU Lerch transcendent and polylogarithm (WGSL syntax). See
 * `GPU_LERCH_PREAMBLE_GLSL` for the methods and their accuracy; the WGSL
 * text follows the GLSL one statement by statement. The Euler-transform
 * table is a fixed-size `array<f32, N>`, and the pole and NaN come from the
 * WGSL `_gpu_inf()` / `_gpu_nan()` helpers (`GPU_NAN_PREAMBLE_WGSL`).
 */
export const GPU_LERCH_PREAMBLE_WGSL = `
fn _gpu_lerch_series(z: f32, s: f32, a: f32) -> vec2<f32> {
  var n0: i32 = 0;
  if (a < 0.0) { n0 = i32(ceil(-a)); }
  let az = abs(z);
  var sum: f32 = 0.0;
  var zk: f32 = 1.0;
  var prev: f32 = 3.0e38;
  // The error estimate: see the GLSL preamble.
  var err: f32 = 0.0;
  var sizes: f32 = 0.0;
  var bmin: f32 = 3.0e38;
  var bmax: f32 = 0.0;
  var settled: i32 = 0;
  for (var k: i32 = 0; k < n0 + 4096; k = k + 1) {
    let b = a + f32(k);
    var t: f32 = 0.0;
    if (b != 0.0) { t = zk * _gpu_zeta_pow(b, -s); }
    sum = sum + t;
    let size = abs(t);
    err = err + size * (2.0 + f32(k));
    sizes = sizes + size;
    if (b != 0.0) {
      bmin = min(bmin, abs(b));
      bmax = max(bmax, abs(b));
    }
    if (b > 0.0) {
      let rho = max(size / prev, az);
      if (size == 0.0 ||
          (size < prev && rho < 1.0 &&
           size * rho / (1.0 - rho) <= 1e-7 * abs(sum))) {
        settled = settled + 1;
        if (settled == 3) {
          let lb = max(abs(log2(bmin)), abs(log2(bmax)));
          let bound = 6.0e-8 * (err + sizes * (2.0 + abs(s * lb)));
          if (!(bound <= 3.0e-5 * abs(sum))) { return vec2<f32>(0.0); }
          if (abs(sum) * (1.0 - az) < 1.9721523e-31) { return vec2<f32>(0.0); }
          return vec2<f32>(sum, 1.0);
        }
      } else {
        settled = 0;
      }
      prev = size;
    }
    zk = zk * z;
  }
  return vec2<f32>(0.0);
}

fn _gpu_lerch_euler(z: f32, s: f32, a: f32) -> vec2<f32> {
  var n0: i32 = 0;
  if (a <= 0.0) { n0 = i32(floor(-a)) + 1; }
  var head: f32 = 0.0;
  var zn: f32 = 1.0;
  var largest: f32 = 0.0;
  for (var k: i32 = 0; k < n0; k = k + 1) {
    let b = a + f32(k);
    var t: f32 = 0.0;
    if (b != 0.0) { t = zn * _gpu_zeta_pow(b, -s); }
    head = head + t;
    largest = max(largest, abs(t));
    zn = zn * z;
  }
  let b0 = a + f32(n0);
  var w: array<f32, ${LERCH_EULER_TERMS + 1}>;
  var nterm: i32 = 0;
  var sum: f32 = 0.0;
  var zPow: f32 = 1.0;
  var settled: i32 = 0;
  for (var k: i32 = 0; k < ${LERCH_EULER_TERMS}; k = k + 1) {
    let cur = zPow * pow(b0 + f32(k), -s);
    var inc: f32;
    if (k == 0) {
      nterm = 1;
      w[1] = cur;
      inc = 0.5 * cur;
    } else {
      var tmp = w[1];
      w[1] = cur;
      for (var j: i32 = 1; j <= nterm - 1; j = j + 1) {
        let dum = w[j + 1];
        w[j + 1] = 0.5 * (w[j] + tmp);
        tmp = dum;
      }
      if (nterm >= ${LERCH_EULER_TERMS}) { return vec2<f32>(0.0); }
      w[nterm + 1] = 0.5 * (w[nterm] + tmp);
      if (abs(w[nterm + 1]) <= abs(w[nterm])) {
        nterm = nterm + 1;
        inc = 0.5 * w[nterm];
      } else {
        inc = w[nterm + 1];
      }
    }
    sum = sum + inc;
    zPow = zPow * z;
    if (k > 4 && abs(inc) <= 1e-7 * abs(sum)) {
      settled = settled + 1;
      if (settled == 3) {
        if (abs(sum) < 1.9721523e-31) { return vec2<f32>(0.0); }
        let tail = zn * sum;
        let res = head + tail;
        if (max(largest, abs(tail)) > 100.0 * abs(res)) { return vec2<f32>(0.0); }
        return vec2<f32>(res, 1.0);
      }
    } else {
      settled = 0;
    }
  }
  return vec2<f32>(0.0);
}

// 1 - e^(-t), t >= 0: see the GLSL preamble.
fn _gpu_lerch_em(t: f32) -> f32 {
  if (t < 0.25) {
    return t * (1.0 - t / 2.0 * (1.0 - t / 3.0 * (1.0 - t / 4.0 *
      (1.0 - t / 5.0 * (1.0 - t / 6.0 * (1.0 - t / 7.0))))));
  }
  return 1.0 - exp(-t);
}

// ln Gamma(s) for s > 0: see the GLSL preamble.
fn _gpu_lerch_lgamma(s: f32) -> f32 {
  var p: f32 = 1.0;
  var x: f32 = s;
  for (var k: i32 = 0; k < 8; k = k + 1) {
    if (x >= 8.0) { break; }
    p = p * x;
    x = x + 1.0;
  }
  let x2 = x * x;
  let corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * x2)) / x2) / x;
  return (x - 0.5) * log(x) - x + (0.91893853320467274 + corr) - log(p);
}

fn _gpu_lerch_g(z: f32, t: f32) -> f32 {
  if (z < 0.0) { return 1.0 / (1.0 - z * exp(-t)); }
  return 1.0 / ((1.0 - z) + z * _gpu_lerch_em(t));
}

// One step of the polynomials P_m of Phi(w, -m, a): see the GLSL preamble.
fn _gpu_lerch_pstep(c: ptr<function, array<f32, ${LERCH_MAX_N + 2}>>, a: f32, m: i32) {
  for (var k: i32 = m + 1; k >= 0; k = k - 1) {
    var hi: f32 = 0.0;
    var lo: f32 = 0.0;
    if (k <= m) { hi = (a + f32(k)) * (*c)[k]; }
    if (k >= 1) { lo = (f32(m + 2) - a - f32(k)) * (*c)[k - 1]; }
    (*c)[k] = hi + lo;
  }
}

// Phi(w, -n, a) without its factor v, and the sum of the moduli of its
// terms: see the GLSL preamble.
fn _gpu_lerch_poly(c: ptr<function, array<f32, ${LERCH_MAX_N + 2}>>, n: i32, u: f32, v: f32) -> vec2<f32> {
  let au = abs(u);
  let av = abs(v);
  var r = (*c)[n];
  var ra = abs((*c)[n]);
  var vp = v;
  var avp = av;
  for (var k: i32 = n - 1; k >= 0; k = k - 1) {
    r = r * u + (*c)[k] * vp;
    ra = ra * au + abs((*c)[k]) * avp;
    vp = vp * v;
    avp = avp * av;
  }
  return vec2<f32>(r, ra);
}

// Phi(z, -n, a) for an integer n, in closed form: see the GLSL preamble.
fn _gpu_lerch_rational(z: f32, n: i32, a: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  var c: array<f32, ${LERCH_MAX_N + 2}>;
  c[0] = 1.0;
  for (var m: i32 = 0; m < n; m = m + 1) { _gpu_lerch_pstep(&c, a, m); }
  let v = 1.0 / (1.0 - z);
  let q = _gpu_lerch_poly(&c, n, z * v, v);
  if (!(EPS * (f32(n + 4) * q.y) <= 3.0e-5 * abs(q.x))) { return vec2<f32>(0.0); }
  return vec2<f32>(q.x * v, 1.0);
}

// Phi(z,s,a) for z < 1 by the integral (after n integrations by parts for
// s <= 0): see the GLSL preamble.
fn _gpu_lerch_integral(z: f32, s: f32, a0: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let PI = 3.14159265358979;
  let gx = array<f32, 4>(0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  let gw = array<f32, 4>(0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  var n: i32 = 0;
  if (s <= 0.0) { n = i32(ceil(-s)); }
  let sn = s + f32(n);
  var n0: i32 = 0;
  if (a0 < 0.0) { n0 = i32(ceil(-a0)); }
  var head: f32 = 0.0;
  var zk: f32 = 1.0;
  var err: f32 = 0.0;
  for (var k: i32 = 0; k < n0; k = k + 1) {
    let bk = a0 + f32(k);
    let t = zk * _gpu_zeta_pow(bk, -s);
    head = head + t;
    err = err + abs(t) * (2.0 + f32(k) + abs(s * log2(abs(bk))));
    zk = zk * z;
  }
  let a = a0 + f32(n0);
  var c: array<f32, ${LERCH_MAX_N + 2}>;
  c[0] = 1.0;
  for (var m: i32 = 0; m < n; m = m + 1) { _gpu_lerch_pstep(&c, a, m); }
  let lg = _gpu_lerch_lgamma(sn);
  let lam = min(1.0, 1.0 / a);
  var delta = PI;
  if (z > 0.0) { delta = -log(z); }
  let e0 = 1e-3 * min(lam, delta);
  let la = log(a);
  let tau0 = a * e0;
  var L: f32;
  if (z < 0.0) { L = log(-z); } else { L = log(z); }
  let big = z < -1.0;
  // The shift S: see the GLSL preamble.
  var S: f32 = 0.0;
  if (big) { S = min(a, 1.0) * L; }
  var lG0: f32 = 0.0;
  var v0h = 1.0 / (1.0 - z);
  var u0 = z * v0h;
  if (big) {
    lG0 = -(L + log(1.0 + exp(-L)));
    v0h = exp(lG0);
    u0 = -exp(L + lG0);
  }
  let f0 = _gpu_lerch_poly(&c, n, u0, v0h);
  var c1 = c;
  _gpu_lerch_pstep(&c1, a, n);
  let f1 = _gpu_lerch_poly(&c1, n + 1, u0, v0h);
  var p0: f32;
  if (big) { p0 = exp(sn * log(tau0) - lg + lG0 + S); } else { p0 = exp(sn * log(tau0) - lg) * v0h; }
  let d1 = -f1.x / a;
  var sum = p0 * (f0.x / sn + d1 * tau0 / (sn + 1.0));
  var ferr = abs(p0) * ((f0.y / sn + f1.y / a * tau0 / (sn + 1.0)) * f32(n + 5)) +
    abs(sum) * (abs(sn * log(tau0)) + abs(lg) + abs(L));
  let v0 = log(e0);
  let v1 = log(lam);
  let nlog = max(1.0, ceil((v1 - v0) / 3.0));
  let hv = (v1 - v0) / nlog;
  let TG = max(L, 0.0) + 17.0;
  let tw = (sn + 30.0) / a;
  var tEnd = tw;
  if (z < 0.0) {
    if (a > 1.0) { tEnd = max(tw, min(TG, (sn + 30.0) / (a - 1.0))); } else { tEnd = max(tw, TG); }
  }
  let hW = 8.0 / a;
  var x = lam;
  for (var p: i32 = 0; p < 28; p = p + 1) {
    let logPanel = f32(p) < nlog;
    if (!logPanel && x >= tEnd) { break; }
    var w: f32;
    var cc: f32;
    if (logPanel) {
      w = hv;
      cc = v0 + (f32(p) + 0.5) * hv;
    } else {
      w = min(min(2.0 * x, hW), max(4.0 / (1.0 + 0.25 * f32(n)), 0.6 * abs(x - L)));
      cc = x + 0.5 * w;
    }
    let r = 0.5 * w;
    for (var i: i32 = 0; i < 4; i = i + 1) {
      for (var j: i32 = 0; j < 2; j = j + 1) {
        let u = cc + select(r, -r, j == 0) * gx[i];
        var t = u;
        var e: f32;
        var scale: f32 = a;
        if (logPanel) {
          t = exp(u);
          e = sn * (u + la);
          scale = 1.0;
        } else {
          e = (sn - 1.0) * log(a * t);
        }
        let tau = a * t;
        var vn: f32;
        var un: f32;
        var lG: f32 = 0.0;
        if (big) {
          let xs = L - t;
          lG = -(max(xs, 0.0) + log(1.0 + exp(-abs(xs))));
          vn = exp(lG);
          un = -exp(xs + lG);
        } else {
          vn = _gpu_lerch_g(z, t);
          un = z * exp(-t) * vn;
        }
        let pv = _gpu_lerch_poly(&c, n, un, vn);
        let ex = e - tau - lg;
        var f: f32;
        if (big) { f = exp(ex + lG + S); } else { f = exp(ex) * vn; }
        let q = r * gw[i] * (scale * f);
        sum = sum + q * pv.x;
        ferr = ferr + q * (abs(pv.x) * ((abs(e) + tau) + (abs(lG) + abs(L))) +
          pv.y * (f32(n + 3) + t));
      }
    }
    if (!logPanel) { x = x + w; }
  }
  if (x < tEnd) { return vec2<f32>(0.0); } // the panel budget ran out
  var scaled: f32;
  if (big) {
    scaled = select(1.0, -1.0, sum < 0.0) * exp(log(abs(sum)) - (S + sn * la));
  } else {
    scaled = pow(a, -sn) * sum;
  }
  let tail = zk * scaled;
  let res = head + tail;
  let rel = ferr / abs(sum) + (8.0 + abs(lg)) +
    ((f32(n0) + 2.0) + (abs(sn * log2(a)) + S));
  let bound = EPS * (err + abs(tail) * rel);
  if (!(bound <= 3.0e-5 * abs(res))) { return vec2<f32>(0.0); }
  return vec2<f32>(res, 1.0);
}

// h = e^x x^(-sig) Gamma(sig, x), integer sig: see the GLSL preamble.
fn _gpu_lerch_h_integer(sig: f32, x: vec2<f32>) -> vec4<f32> {
  let n = i32(sig) - 1;
  let d = x.x * x.x + x.y * x.y;
  let ir = x.x / d;
  let ii = -x.y / d;
  let ix = sqrt(ir * ir + ii * ii);
  var rr: f32 = 1.0;
  var ri: f32 = 0.0;
  var ra: f32 = 1.0;
  for (var j: i32 = 1; j <= n; j = j + 1) {
    let tr = ir * rr - ii * ri;
    let ti = ir * ri + ii * rr;
    rr = 1.0 + f32(j) * tr;
    ri = f32(j) * ti;
    ra = 1.0 + f32(j) * ix * ra;
  }
  return vec4<f32>(rr * ir - ri * ii, rr * ii + ri * ir, (f32(n) + 3.0) * ra * ix, 1.0);
}

// h for |x| < sig, by the series: see the GLSL preamble.
fn _gpu_lerch_h_series(sig: f32, x: vec2<f32>) -> vec4<f32> {
  var tr: f32 = 1.0 / sig;
  var ti: f32 = 0.0;
  var sr: f32 = tr;
  var si: f32 = 0.0;
  var sa: f32 = tr;
  var k: i32 = 1;
  for (k = 1; k < 100; k = k + 1) {
    let f = sig + f32(k);
    let nr = (tr * x.x - ti * x.y) / f;
    ti = (tr * x.y + ti * x.x) / f;
    tr = nr;
    sr = sr + tr;
    si = si + ti;
    let ta = abs(tr) + abs(ti);
    sa = sa + ta;
    if (ta < 1e-8 * (abs(sr) + abs(si))) { break; }
  }
  let er = x.x - sig * log(sqrt(x.x * x.x + x.y * x.y)) + _gpu_lerch_lgamma(sig);
  // arg x, with the imaginary axis taken explicitly (see the GLSL preamble:
  // atan2 of Apple's GPU answers the wrong branch at x.x = -0.0).
  var arg = atan2(x.y, x.x);
  if (x.x == 0.0) { arg = select(1.5707963267949, -1.5707963267949, x.y < 0.0); }
  let ei = x.y - sig * arg;
  let m = exp(er);
  return vec4<f32>(m * cos(ei) - sr, m * sin(ei) - si,
    m * (24.0 + abs(er) + abs(ei)) + (f32(k) + 3.0) * sa, 1.0);
}

// h for |x| >= sig, by the continued fraction: see the GLSL preamble.
fn _gpu_lerch_h_cf(sig: f32, x: vec2<f32>) -> vec4<f32> {
  let FPMIN = 1e-30;
  var br = x.x - sig + 1.0;
  let bi = x.y;
  var cr: f32 = 1e30;
  var ci: f32 = 0.0;
  var dd = br * br + bi * bi;
  var dr = br / dd;
  var di = -bi / dd;
  var hr = dr;
  var hi = di;
  for (var i: i32 = 1; i < 200; i = i + 1) {
    let an = -f32(i) * (f32(i) - sig);
    br = br + 2.0;
    dr = an * dr + br;
    di = an * di + bi;
    if (abs(dr) + abs(di) < FPMIN) { dr = FPMIN; }
    let cc = cr * cr + ci * ci;
    cr = br + an * cr / cc;
    ci = bi - an * ci / cc;
    if (abs(cr) + abs(ci) < FPMIN) { cr = FPMIN; }
    dd = dr * dr + di * di;
    dr = dr / dd;
    di = -di / dd;
    let er = dr * cr - di * ci;
    let ei = dr * ci + di * cr;
    let nr = hr * er - hi * ei;
    hi = hr * ei + hi * er;
    hr = nr;
    if (abs(er - 1.0) + abs(ei) < 1e-7) {
      return vec4<f32>(hr, hi, 35.0 * sqrt(hr * hr + hi * hi), 1.0);
    }
  }
  return vec4<f32>(0.0);
}

// Phi(z,s,a) for s <= 0 by the Hermite-type representation: see the GLSL
// preamble.
fn _gpu_lerch_hermite(z: f32, s: f32, a: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let PI = 3.14159265358979;
  let gx = array<f32, 4>(0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  let gw = array<f32, 4>(0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  if (s < -30.0) { return vec2<f32>(0.0); }
  var m: i32 = 0;
  if (a < 1.0) { m = i32(ceil(1.0 - a)); }
  var head: f32 = 0.0;
  var zk: f32 = 1.0;
  var err: f32 = 0.0;
  for (var k: i32 = 0; k < m; k = k + 1) {
    let bk = a + f32(k);
    if (bk != 0.0) {
      let t = zk * _gpu_zeta_pow(bk, -s);
      head = head + t;
      err = err + abs(t) * (2.0 + f32(k) + abs(s * log2(abs(bk))));
    }
    zk = zk * z;
  }
  let b = a + f32(m);
  let L = log(abs(z));
  let sig = 1.0 - s;
  var xi: f32 = 0.0;
  if (z < 0.0) { xi = -b * PI; }
  let x = vec2<f32>(-b * L, xi);
  var h: vec4<f32>;
  if (sig == floor(sig)) {
    h = _gpu_lerch_h_integer(sig, x);
  } else if (sqrt(x.x * x.x + x.y * x.y) < sig) {
    h = _gpu_lerch_h_series(sig, x);
  } else {
    h = _gpu_lerch_h_cf(sig, x);
  }
  if (h.w < 0.5) { return vec2<f32>(0.0); }
  let t1 = 0.5 * pow(b, -s);
  let bs = pow(b, sig);
  let t2 = bs * h.x;
  let t2abs = bs * (abs(h.x) + abs(h.y)); // no square: see the GLSL preamble
  let q3 = max(-s, 0.0);
  let t3end = (21.0 + q3 * log(1.0 + (q3 + 7.0) / b)) / PI;
  let n3 = ceil(t3end / min(1.5, 4.0 / max(abs(L), 1e-3)));
  if (n3 > 16.0) { return vec2<f32>(0.0); }
  let h3 = t3end / n3;
  var t3: f32 = 0.0;
  var a3: f32 = 0.0;
  let b2 = b * b;
  for (var p: i32 = 0; p < 16; p = p + 1) {
    if (f32(p) >= n3) { break; }
    let c = (f32(p) + 0.5) * h3;
    let r = 0.5 * h3;
    for (var i: i32 = 0; i < 4; i = i + 1) {
      for (var j: i32 = 0; j < 2; j = j + 1) {
        let t = c + select(r, -r, j == 0) * gx[i];
        let y = 2.0 * PI * t;
        let q = exp(-y);
        let omq = _gpu_lerch_em(y);
        var K = q / omq;
        if (z < 0.0) { K = exp(-PI * t) * (1.0 + q) / (2.0 * omq); }
        let f = sin(t * L - s * atan(t / b)) *
          exp(-0.5 * s * log(b2 + t * t)) * K;
        let wf = r * gw[i] * f;
        t3 = t3 + wf;
        a3 = a3 + abs(wf) * ((6.0 + 10.0 * t) +
          (abs(s) * (2.0 + 0.5 * log2(b2 + t * t)) + abs(t * L)));
      }
    }
  }
  t3 = -2.0 * t3;
  a3 = 2.0 * a3;
  let phi = t1 + t2 + t3;
  let res = head + zk * phi;
  let e1 = t1 * (2.0 + abs(s * log2(b)));
  let e2 = t2abs * (2.0 + abs(sig * log2(b))) + bs * h.z;
  let ephi = (e1 + e2) + (a3 + 3.0 * (t1 + t2abs + abs(t3)));
  let bound = EPS * (err + abs(zk) * (ephi + (f32(m) + 2.0) * abs(phi)) + abs(res));
  // See the GLSL version: an infinite res is a term that overflowed.
  if (!(bound <= 3.0e-5 * abs(res)) || !(abs(res) < 3.4e38)) { return vec2<f32>(0.0); }
  return vec2<f32>(res, 1.0);
}

// Phi(z,s,a) for s <= 0: the integral after n integrations by parts, then
// the Hermite form (see the GLSL preamble).
fn _gpu_lerch_negative(z: f32, s: f32, a: f32) -> vec2<f32> {
  if (s != floor(s) && a > 0.0 && s >= -${LERCH_MAX_N}.0) {
    let r = _gpu_lerch_integral(z, s, a);
    if (r.y > 0.5) { return r; }
  }
  return _gpu_lerch_hermite(z, s, a);
}

// Phi(z,s,a) as vec2(value, 1), or vec2(0, 0): see the GLSL preamble.
fn _gpu_lerch_core(z: f32, s: f32, a: f32) -> vec2<f32> {
  if (z == 1.0) { return vec2<f32>(_gpu_hurwitz_zeta(s, a), 1.0); }
  if (z == 0.0) { return vec2<f32>(_gpu_zeta_pow(a, -s), 1.0); }
  if (s == 0.0) { return vec2<f32>(1.0 / (1.0 - z), 1.0); }
  if (s < 0.0 && s == floor(s) && s >= -${LERCH_MAX_N}.0) {
    let q = _gpu_lerch_rational(z, i32(-s), a);
    if (q.y > 0.5) { return q; }
  }
  let aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) { return vec2<f32>(_gpu_inf(), 1.0); }
  if (a < 0.0 && s != floor(s)) { return vec2<f32>(0.0); }
  if (a < -1.0e6) { return vec2<f32>(0.0); }
  if (z > 1.0) {
    if (s > 0.0 || s != floor(s)) { return vec2<f32>(0.0); }
    return _gpu_lerch_hermite(z, s, a);
  }
  if (z < -1.0) {
    if (s > 0.0) { return _gpu_lerch_integral(z, s, a); }
    return _gpu_lerch_negative(z, s, a);
  }
  if (z < 0.0 && s > 0.0) {
    let e = _gpu_lerch_euler(z, s, a);
    if (e.y > 0.5) { return e; }
    return _gpu_lerch_integral(z, s, a);
  }
  if (z == -1.0) { return _gpu_lerch_negative(z, s, a); }
  let r = _gpu_lerch_series(z, s, a);
  if (r.y > 0.5) { return r; }
  if (s > 0.0) { return _gpu_lerch_integral(z, s, a); }
  return _gpu_lerch_negative(z, s, a);
}

// Phi(z, s, a) for z < 0 and -30 <= s <= -3 from the Fourier modes of the
// base point: see the GLSL preamble.
fn _gpu_lerch_modes(z: f32, s: f32, a: f32, c: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let FLUSH = 2.0e-31; // 1.18e-38 / EPS
  let PI = 3.14159265358979;
  if (s < -30.0 || abs(a) >= 100.0) { return vec2<f32>(0.0); }
  var b = a;
  var pre: f32 = 0.0;
  var post: f32 = 0.0;
  if (a <= 0.0) {
    pre = floor(-a) + 1.0;
    b = a + pre;
  } else if (a > 1.0) {
    post = ceil(a) - 1.0;
    b = a - post;
  }
  var head: f32 = 0.0;
  var herr: f32 = 0.0;
  var zk: f32 = 1.0;
  for (var j: i32 = 0; j < 128; j = j + 1) {
    if (f32(j) >= pre) { break; }
    let bj = a + f32(j);
    if (bj != 0.0) {
      let t = zk * _gpu_zeta_pow(bj, -s);
      head = head + t;
      herr = herr + abs(t) * (3.0 + f32(j) + abs(s * log2(abs(bj))));
    }
    zk = zk * z;
  }
  let L = log(-z);
  let sm1 = s - 1.0;
  let hs = 0.5 * sm1;
  let ps = hs - 2.0 * floor(0.5 * hs); // (s-1)/2 modulo 2
  let L2 = L * L;
  let lr1 = log(L2 + PI * PI);
  var sum: f32 = 0.0;
  var err: f32 = 0.0;
  var tail: f32 = 0.0;
  for (var n: i32 = 1; n <= 128; n = n + 1) {
    let m = f32(2 * n - 1);
    let x = PI * m;
    let lr = log(L2 + x * x);
    let at = atan(L / x) / PI;
    let bm = b * m;
    let P = (bm - 2.0 * floor(0.5 * bm)) + ps + sm1 * at;
    let k = floor(P + 0.5);
    var cs = cos(PI * (P - k));
    if ((k % 2.0) != 0.0) { cs = -cs; }
    let ex = hs * (lr - lr1);
    let mag = exp(ex);
    let t = mag * cs;
    sum = sum + t;
    err = err + abs(t) * (4.0 + abs(ex)) +
      mag * (abs(hs) * (abs(lr) + abs(lr1)) + PI * (abs(P) + abs(sm1) * abs(at) + b * m));
    tail = mag * m / (-2.0 * s);
    if (tail <= 1e-9) { break; }
  }
  let lg = _gpu_lerch_lgamma(1.0 - s);
  let scale = 2.0 * exp(lg + hs * lr1 - (b - c) * L);
  var phib = scale * sum;
  if (!(scale < 3.4e38 && abs(phib) < 3.4e38)) { return vec2<f32>(0.0); }
  var eb = scale * (err + tail / EPS + 4.0 * abs(sum)) +
    abs(phib) * (abs(lg) + abs(hs * lr1) + abs((b - c) * L) + 12.0);
  if (scale < 1.18e-38 || abs(phib) < 1.18e-38) { eb = eb + FLUSH * (1.0 + abs(sum)); }
  if (c > 0.5) { phib = -phib; } // z = -e^L
  var res: f32;
  var rerr: f32;
  if (post > 0.0) {
    var acc = phib;
    var aerr = eb;
    var zj: f32 = 1.0;
    for (var j: i32 = 0; j < 128; j = j + 1) {
      if (f32(j) >= post) { break; }
      let bj = b + f32(j);
      let t = zj * pow(bj, -s);
      acc = acc - t;
      aerr = aerr + abs(t) * (3.0 + f32(j) + abs(s * log2(bj)));
      zj = zj * z;
    }
    let zinv = pow(-z, -post);
    if (!(zinv >= 1.18e-38 && zinv < 3.4e38 && abs(acc) >= 1.18e-38 && abs(acc) < 3.4e38)) {
      return vec2<f32>(0.0);
    }
    var sg: f32 = -1.0;
    if ((post % 2.0) == 0.0) { sg = 1.0; }
    res = sg * zinv * acc;
    rerr = zinv * (aerr + abs(acc) * (post + 2.0)) + abs(res) * abs(post * log2(-z));
  } else {
    if (!(abs(zk) >= 1.18e-38 && abs(zk) < 3.4e38)) { return vec2<f32>(0.0); }
    res = head + zk * phib;
    rerr = herr + abs(zk) * (eb + abs(phib) * (pre + 2.0));
  }
  // An estimate that overflowed to +inf declines: see the GLSL form.
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) ||
      !(rerr < 3.4e38 && rerr <= 500.0 * abs(res))) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(res, 1.0);
}

// The Fourier modes last, where every other method declines — see the GLSL
// preamble.
fn _gpu_lerch_phi(z: f32, s: f32, a: f32) -> f32 {
  let r = _gpu_lerch_core(z, s, a);
  if (r.y > 0.5) { return r.x; }
  if (z < 0.0 && s <= -3.0 && !(a < 0.0 && s != floor(s))) {
    let q = _gpu_lerch_modes(z, s, a, 0.0);
    if (q.y > 0.5) { return q.x; }
  }
  return _gpu_nan();
}

// Li_s(z) for z < -1 and a negative non-integer s, by Jonquiere's
// inversion formula: see the GLSL preamble.
fn _gpu_poly_log_inversion(s: f32, z: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let FLUSH = 2.0e-31; // 1.18e-38 / EPS
  let PI = 3.14159265358979;
  let B = array<f32, 8>(1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0,
    5.0 / 66.0, -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0);
  let ai = -log(-z) / (2.0 * PI);
  let sig = 1.0 - s;
  var zr: f32 = 0.0;
  var zi: f32 = 0.0;
  var zerr: f32 = 0.0;
  for (var k: i32 = 0; k < 12; k = k + 1) {
    let wk = 0.5 + f32(k);
    let lnwk = 0.5 * log(wk * wk + ai * ai);
    let ph = -sig * atan2(ai, wk);
    let m = exp(-sig * lnwk);
    zr = zr + m * cos(ph);
    zi = zi + m * sin(ph);
    zerr = zerr + m * (4.0 + abs(sig * lnwk) + abs(ph));
  }
  let wr = 12.5;
  let lnw = 0.5 * log(wr * wr + ai * ai);
  let th = atan2(ai, wr);
  // w^(1 - sig) / (sig - 1), from s itself (see the GLSL preamble).
  let m1 = exp(s * lnw) / -s;
  let p1 = s * th;
  zr = zr + m1 * cos(p1);
  zi = zi + m1 * sin(p1);
  zerr = zerr + abs(m1) * (4.0 + abs(s * lnw) + abs(p1));
  let m0 = exp(-sig * lnw);
  let p0 = -sig * th;
  zr = zr + 0.5 * m0 * cos(p0);
  zi = zi + 0.5 * m0 * sin(p0);
  zerr = zerr + 0.5 * m0 * (4.0 + abs(sig * lnw) + abs(p0));
  let mu1 = exp((-sig - 1.0) * lnw);
  let pu1 = (-sig - 1.0) * th;
  var ur = sig / 2.0 * mu1 * cos(pu1);
  var ui = sig / 2.0 * mu1 * sin(pu1);
  let w2r = wr * wr - ai * ai;
  let w2i = 2.0 * wr * ai;
  let w2d = w2r * w2r + w2i * w2i;
  let iw2r = w2r / w2d;
  let iw2i = -w2i / w2d;
  var prev: f32 = 3.0e38;
  for (var j: i32 = 1; j <= 8; j = j + 1) {
    let tr = ur * B[j - 1];
    let ti = ui * B[j - 1];
    let ta = abs(tr) + abs(ti);
    if (ta >= prev) { break; }
    zr = zr + tr;
    zi = zi + ti;
    zerr = zerr + ta * (10.0 + abs(sig * lnw));
    prev = ta;
    let mm = f32(2 * j);
    let c = (sig + mm - 1.0) * (sig + mm) / ((mm + 1.0) * (mm + 2.0));
    let nr = c * (ur * iw2r - ui * iw2i);
    ui = c * (ur * iw2i + ui * iw2r);
    ur = nr;
  }
  zerr = zerr + 44.0 * FLUSH; // at most 22 terms in each of zr and zi
  let n = floor(s + 0.5);
  let d = s - n;
  let sgn = select(-1.0, 1.0, n % 2.0 == 0.0);
  let lg1 = _gpu_lerch_lgamma(sig);
  let fm = sgn * sin(PI * d) * exp(s * log(2.0 * PI) + lg1) / PI;
  let fre = fm * cos(0.5 * PI * s);
  let fim = fm * sin(0.5 * PI * s);
  let first = fre * zr - fim * zi;
  let firstErr = abs(fm) * zerr +
    abs(fm) * sqrt(zr * zr + zi * zi) * (30.0 + abs(lg1) + abs(s * 2.7));
  let iz = 1.0 / z;
  var li: f32 = 0.0;
  var lierr: f32 = 0.0;
  if (iz >= -0.5) {
    var wk: f32 = 1.0;
    var prevT: f32 = 3.0e38;
    var done = false;
    for (var k: i32 = 1; k < 200; k = k + 1) {
      wk = wk * iz;
      let t = wk * pow(f32(k), -s);
      li = li + t;
      let size = abs(t);
      lierr = lierr + size * (2.0 + f32(k) + abs(s * log2(f32(k)))) + FLUSH;
      let rho = -iz * pow(f32(k + 1) / f32(k), -s);
      if (size < prevT && rho < 1.0 && size * rho / (1.0 - rho) <= 1e-8 * abs(li)) {
        done = true;
        break;
      }
      prevT = size;
    }
    if (!done) { return vec2<f32>(0.0); }
  } else {
    let inner = _gpu_lerch_negative(iz, s, 1.0);
    if (inner.y < 0.5) { return vec2<f32>(0.0); }
    li = iz * inner.x;
    lierr = 500.0 * abs(li);
  }
  let res = first - sgn * cos(PI * d) * li;
  let bound = ((firstErr + 4.0 * abs(first)) + (lierr + 2.0 * abs(li))) + 4.0 * FLUSH;
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) ||
      !(bound < 3.4e38 && bound <= 500.0 * abs(res))) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(res, 1.0);
}

// PolyLog(s, z): see _gpu_poly_log in GPU_LERCH_PREAMBLE_GLSL for the
// cases (closed forms for the orders 1, 0, -1 and -2 ... -12, then
// z * Phi(z, s, 1), then the inversion formula).
fn _gpu_poly_log(s: f32, z: f32) -> f32 {
  if (z == 0.0) { return 0.0; }
  if (s == 1.0) {
    if (z == 1.0) { return _gpu_inf(); }
    if (z < 1.0) { return -log(1.0 - z); }
    return _gpu_nan();
  }
  if (s == 0.0) {
    if (z == 1.0) { return _gpu_inf(); }
    return z / (1.0 - z);
  }
  if (s == -1.0) {
    if (z == 1.0) { return _gpu_inf(); }
    return z / ((1.0 - z) * (1.0 - z));
  }
  if (s <= -2.0 && s >= -12.0 && s == floor(s) && z != 1.0) {
    let n = i32(-s);
    var row: array<f32, 13>;
    row[0] = 1.0;
    for (var i: i32 = 1; i < 13; i = i + 1) { row[i] = 0.0; }
    for (var m: i32 = 1; m <= n; m = m + 1) {
      for (var k: i32 = m - 1; k >= 1; k = k - 1) {
        row[k] = f32(k + 1) * row[k] + f32(m - k) * row[k - 1];
      }
    }
    if (abs(z) > 1.0) {
      let v = 1.0 / (1.0 - z);
      let u = z * v;
      var r = row[n - 1];
      var vp = v;
      for (var k: i32 = n - 2; k >= 0; k = k - 1) {
        r = r * u + row[k] * vp;
        vp = vp * v;
      }
      return u * v * r;
    }
    var p: f32 = 0.0;
    for (var k: i32 = n - 1; k >= 0; k = k - 1) { p = p * z + row[k]; }
    var den: f32 = 1.0;
    for (var i: i32 = 0; i <= n; i = i + 1) { den = den * (1.0 - z); }
    return z * p / den;
  }
  // Below z = -1 a small Phi(z, s, 1) is left to the inversion and the
  // modes: see the GLSL preamble.
  let r = _gpu_lerch_core(z, s, 1.0);
  if (r.y > 0.5 && (z >= -1.0 || (abs(r.x) >= 3.9e-34 && abs(z * r.x) < 3.4e38))) {
    return z * r.x;
  }
  if (z < -1.0 && s < 0.0 && s != floor(s)) {
    let v = _gpu_poly_log_inversion(s, z);
    if (v.y > 0.5) { return v.x; }
  }
  if (z < 0.0 && s <= -3.0) {
    let q = _gpu_lerch_modes(z, s, 1.0, 1.0);
    if (q.y > 0.5) { return q.x; }
  }
  return _gpu_nan();
}
`;

/**
 * GPU error function using Abramowitz & Stegun approximation.
 * Maximum error: |epsilon(x)| <= 1.5e-7. GLSL syntax.
 */
export const GPU_ERF_PREAMBLE_GLSL = `
float _gpu_erf(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  float result = 1.0 - y * exp(-ax * ax);
  return x < 0.0 ? -result : result;
}

float _gpu_erfinv(float x) {
  float pi = 3.14159265358979;
  float x2 = x * x;
  float x3 = x * x2;
  float x5 = x3 * x2;
  float x7 = x5 * x2;
  float x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU error function preamble (WGSL syntax). See GPU_GAMMA_PREAMBLE_WGSL.
 */
export const GPU_ERF_PREAMBLE_WGSL = `
fn _gpu_erf(x: f32) -> f32 {
  let ax = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * ax);
  let y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  let result = 1.0 - y * exp(-ax * ax);
  if (x < 0.0) { return -result; }
  return result;
}

fn _gpu_erfinv(x: f32) -> f32 {
  let pi = 3.14159265358979;
  let x2 = x * x;
  let x3 = x * x2;
  let x5 = x3 * x2;
  let x7 = x5 * x2;
  let x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU Heaviside step function preamble (GLSL syntax).
 * Returns 0 for x<0, 0.5 at x=0, 1 for x>0.
 *
 * A NaN argument is returned as it is (Contract B `propagate`, ratified
 * 2026-08-27). The first line tests its bit pattern: a value is NaN when its
 * bits without the sign are larger than those of +∞ (0x7F800000). `isnan`
 * and `x != x` are not used, because a compiler may assume that no NaN
 * occurs and remove them; carrying the NaN through `0.5 + 0.0 * x` gave 0.5
 * on WebGL2 over ANGLE Metal (Apple M5 Max, 2026-10-26; CE-520). Only `0` and
 * `-0.0` reach the last line.
 */
export const GPU_HEAVISIDE_PREAMBLE_GLSL = `
float _gpu_heaviside(float x) {
  if ((floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u) return x;
  if (x < 0.0) return 0.0;
  if (x > 0.0) return 1.0;
  return 0.5;
}
`;

/**
 * GPU Heaviside step function preamble (WGSL syntax).
 * Same NaN-propagating final arm as the GLSL preamble above.
 */
export const GPU_HEAVISIDE_PREAMBLE_WGSL = `
fn _gpu_heaviside(x: f32) -> f32 {
  if ((bitcast<u32>(x) & 0x7FFFFFFFu) > 0x7F800000u) { return x; }
  if (x < 0.0) { return 0.0; }
  if (x > 0.0) { return 1.0; }
  return 0.5;
}
`;

/**
 * GPU sinc function preamble (GLSL syntax).
 * sinc(x) = sin(x)/x, sinc(0) = 1.
 */
export const GPU_SINC_PREAMBLE_GLSL = `
float _gpu_sinc(float x) {
  if (abs(x) < 1e-10) return 1.0;
  return sin(x) / x;
}
`;

/**
 * GPU sinc function preamble (WGSL syntax).
 */
export const GPU_SINC_PREAMBLE_WGSL = `
fn _gpu_sinc(x: f32) -> f32 {
  if (abs(x) < 1e-10) { return 1.0; }
  return sin(x) / x;
}
`;

/**
 * GPU Horner polynomial evaluation helper (GLSL syntax).
 * Shared by FresnelC and FresnelS preambles.
 */
export const GPU_POLEVL_PREAMBLE_GLSL = `
float _gpu_polevl(float x, float c[12], int n) {
  float ans = c[0];
  for (int i = 1; i < n; i++) ans = ans * x + c[i];
  return ans;
}
`;

/**
 * GPU Horner polynomial evaluation helper (WGSL syntax).
 */
export const GPU_POLEVL_PREAMBLE_WGSL = `
fn _gpu_polevl(x: f32, c: array<f32, 12>, n: i32) -> f32 {
  var ans = c[0];
  for (var i: i32 = 1; i < n; i++) { ans = ans * x + c[i]; }
  return ans;
}
`;

/**
 * GPU Fresnel cosine integral preamble (GLSL syntax).
 *
 * C(x) = integral from 0 to x of cos(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions:
 * |x|<1.6, 1.6<=|x|<36, |x|>=36.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_GLSL = `
float _gpu_fresnelC(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float cn[6] = float[6](
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1
    );
    float cd[7] = float[7](
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel cosine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_WGSL = `
fn _gpu_fresnelC(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var cn = array<f32, 12>(
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var cd = array<f32, 12>(
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (GLSL syntax).
 *
 * S(x) = integral from 0 to x of sin(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_GLSL = `
float _gpu_fresnelS(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float sn[6] = float[6](
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11
    );
    float sd[7] = float[7](
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_WGSL = `
fn _gpu_fresnelS(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var sn = array<f32, 12>(
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var sd = array<f32, 12>(
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Bessel J function preamble (GLSL syntax).
 *
 * J_n(x) for integer order n. Uses three algorithms:
 * - Power series for small x (x < 5+n)
 * - Hankel asymptotic for large x (x > 25+n^2/2)
 * - Miller's backward recurrence for intermediate x
 */
export const GPU_BESSELJ_PREAMBLE_GLSL = `
float _gpu_factorial(int n) {
  float f = 1.0;
  for (int i = 2; i <= n; i++) f *= float(i);
  return f;
}

float _gpu_besselJ_series(int n, float x) {
  float halfX = x / 2.0;
  float negQ = -(x * x) / 4.0;
  float term = 1.0;
  for (int i = 1; i <= n; i++) term /= float(i);
  float s = term;
  for (int k = 1; k <= 60; k++) {
    term *= negQ / (float(k) * float(n + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) break;
  }
  return s * pow(halfX, float(n));
}

float _gpu_besselJ_asymptotic(int n, float x) {
  float mu = 4.0 * float(n) * float(n);
  float P = 1.0;
  float Q = 0.0;
  float ak = 1.0;
  float e8x = 8.0 * x;
  for (int k = 1; k <= 12; k++) {
    float twokm1 = float(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    float denom = _gpu_factorial(k) * pow(e8x, float(k));
    float contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      if (((k - 1) / 2) % 2 == 0) Q += contrib;
      else Q -= contrib;
    } else {
      if ((k / 2) % 2 == 1) P -= contrib;
      else P += contrib;
    }
    if (abs(contrib) < 1e-7) break;
  }
  float chi = x - (float(n) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

float _gpu_besselJ(int n, float x) {
  if (x == 0.0) return n == 0 ? 1.0 : 0.0;
  float sgn = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) sgn = -1.0;
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) sgn *= -1.0;
  }
  if (x > 25.0 + float(n * n) / 2.0) return sgn * _gpu_besselJ_asymptotic(n, x);
  if (x < 5.0 + float(n)) return sgn * _gpu_besselJ_series(n, x);
  int M = max(n + 20, int(ceil(x)) + 30);
  if (M > 200) return sgn * _gpu_besselJ_series(n, x);
  float vals[201];
  float jp1 = 0.0;
  float jk = 1.0;
  vals[M] = jk;
  for (int k = M; k >= 1; k--) {
    float jm1 = (2.0 * float(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  float norm = vals[0];
  for (int k = 2; k <= M; k += 2) norm += 2.0 * vals[k];
  return sgn * vals[n] / norm;
}
`;

/**
 * GPU Bessel J function preamble (WGSL syntax).
 */
export const GPU_BESSELJ_PREAMBLE_WGSL = `
fn _gpu_factorial(n: i32) -> f32 {
  var f: f32 = 1.0;
  for (var i: i32 = 2; i <= n; i++) { f *= f32(i); }
  return f;
}

fn _gpu_besselJ_series(n_in: i32, x: f32) -> f32 {
  let halfX = x / 2.0;
  let negQ = -(x * x) / 4.0;
  var term: f32 = 1.0;
  for (var i: i32 = 1; i <= n_in; i++) { term /= f32(i); }
  var s = term;
  for (var k: i32 = 1; k <= 60; k++) {
    term *= negQ / (f32(k) * f32(n_in + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) { break; }
  }
  return s * pow(halfX, f32(n_in));
}

fn _gpu_besselJ_asymptotic(n_in: i32, x: f32) -> f32 {
  let mu = 4.0 * f32(n_in) * f32(n_in);
  var P: f32 = 1.0;
  var Q: f32 = 0.0;
  var ak: f32 = 1.0;
  let e8x = 8.0 * x;
  for (var k: i32 = 1; k <= 12; k++) {
    let twokm1 = f32(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    let denom = _gpu_factorial(k) * pow(e8x, f32(k));
    let contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      if (((k - 1) / 2) % 2 == 0) { Q += contrib; }
      else { Q -= contrib; }
    } else {
      if ((k / 2) % 2 == 1) { P -= contrib; }
      else { P += contrib; }
    }
    if (abs(contrib) < 1e-7) { break; }
  }
  let chi = x - (f32(n_in) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

fn _gpu_besselJ(n_in: i32, x_in: f32) -> f32 {
  var n = n_in;
  var x = x_in;
  if (x == 0.0) { return select(0.0, 1.0, n == 0); }
  var sgn: f32 = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) { sgn = -1.0; }
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) { sgn *= -1.0; }
  }
  if (x > 25.0 + f32(n * n) / 2.0) { return sgn * _gpu_besselJ_asymptotic(n, x); }
  if (x < 5.0 + f32(n)) { return sgn * _gpu_besselJ_series(n, x); }
  var M = max(n + 20, i32(ceil(x)) + 30);
  if (M > 200) { return sgn * _gpu_besselJ_series(n, x); }
  var vals: array<f32, 201>;
  var jp1: f32 = 0.0;
  var jk: f32 = 1.0;
  vals[M] = jk;
  for (var k: i32 = M; k >= 1; k--) {
    let jm1 = (2.0 * f32(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  var norm = vals[0];
  for (var k2: i32 = 2; k2 <= M; k2 += 2) { norm += 2.0 * vals[k2]; }
  return sgn * vals[n] / norm;
}
`;

/**
 * Fractal preamble (GLSL syntax).
 *
 * Smooth escape-time iteration for Mandelbrot and Julia sets.
 * Both functions return a normalized float in [0, 1] with smooth coloring
 * (log2(log2(|z|²)) formula) to avoid banding.
 */
export const GPU_FRACTAL_PREAMBLE_GLSL = `
float _fractal_mandelbrot(vec2 c, int maxIter) {
  vec2 z = vec2(0.0, 0.0);
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}

float _fractal_julia(vec2 z, vec2 c, int maxIter) {
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}
`;

/**
 * Fractal preamble (WGSL syntax).
 */
export const GPU_FRACTAL_PREAMBLE_WGSL = `
fn _fractal_mandelbrot(c: vec2f, maxIter: i32) -> f32 {
  var z = vec2f(0.0, 0.0);
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}

fn _fractal_julia(z_in: vec2f, c: vec2f, maxIter: i32) -> f32 {
  var z = z_in;
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}
`;

// ─── Statistical preambles ────────────────────────────────────────────────────

/**
 * GPU GCD preamble (GLSL syntax).
 * Tolerant floating Euclidean algorithm: terminates when the remainder falls
 * below `ε · max(|a|, |b|)` (ε = 1e-6, the f32 float-GCD tolerance) rather than
 * exact zero, so it handles non-integer reals (e.g. Desmos-style
 * `gcd(θ², θ+a)`) as well as integer-valued inputs.
 *
 * Integer inputs within the f32 exact-integer range (< 2^24) take a plain
 * Euclid path with no tolerance — mirrors the JS realGcd so integer inputs
 * never regress (e.g. `_gpu_gcd(4000000.0, 2.0) == 2.0`). The final
 * scale-mismatch guard keeps the result <= min(|a|, |b|).
 *
 * `_gpu_lcm` is `|a| / gcd(a, b) · |b|`, and 0 when an operand is 0, the
 * value the javascript target gives for real operands (`LCM(4.5, 6)` is 18).
 * Dividing before multiplying keeps the intermediate value no larger than
 * the result.
 */
export const GPU_GCD_PREAMBLE_GLSL = `
float _gpu_gcd(float a, float b) {
  a = abs(a); b = abs(b);
  if (a == 0.0) return b;
  if (b == 0.0) return a;
  if (floor(a) == a && floor(b) == b && a < 16777216.0 && b < 16777216.0) {
    for (int i = 0; i < 64; i++) {
      if (b == 0.0) break;
      float t = mod(a, b);
      a = b;
      b = t;
    }
    return a;
  }
  float mn = min(a, b);
  float tol = 1e-6 * max(a, b);
  for (int i = 0; i < 64; i++) {
    if (b <= tol) break;
    float t = mod(a, b);
    a = b;
    b = t;
  }
  return a > mn ? mn : a;
}

float _gpu_lcm(float a, float b) {
  if (a == 0.0 || b == 0.0) return 0.0;
  return abs(a) / _gpu_gcd(a, b) * abs(b);
}
`;

/**
 * GPU GCD preamble (WGSL syntax). See GPU_GCD_PREAMBLE_GLSL for the
 * algorithm notes (integer fast path, tolerance, scale-mismatch guard).
 */
export const GPU_GCD_PREAMBLE_WGSL = `
fn _gpu_gcd(a_in: f32, b_in: f32) -> f32 {
  var a = abs(a_in); var b = abs(b_in);
  if (a == 0.0) { return b; }
  if (b == 0.0) { return a; }
  if (floor(a) == a && floor(b) == b && a < 16777216.0 && b < 16777216.0) {
    for (var i: i32 = 0; i < 64; i++) {
      if (b == 0.0) { break; }
      let t = a % b;
      a = b;
      b = t;
    }
    return a;
  }
  let mn = min(a, b);
  let tol = 1e-6 * max(a, b);
  for (var i: i32 = 0; i < 64; i++) {
    if (b <= tol) { break; }
    let t = a % b;
    a = b;
    b = t;
  }
  if (a > mn) { return mn; }
  return a;
}

fn _gpu_lcm(a: f32, b: f32) -> f32 {
  if (a == 0.0 || b == 0.0) { return 0.0; }
  return abs(a) / _gpu_gcd(a, b) * abs(b);
}
`;

/**
 * GPU Random preamble (GLSL syntax) — PCG3D.
 *
 * `_gpu_pcg3d` is transcribed VERBATIM from Jarzynski & Olano, *Hash Functions
 * for GPU Rendering*, JCGT 2020, §6 — the same listing `pcg3d()` in
 * `numerics/random.ts` transcribes. Pure u32 arithmetic (exact on ES 3.00+),
 * so the shader computes the identical integer words as the host for identical
 * inputs; changing a constant or the operation order is a BREAKING change to
 * the seed→stream mapping, pinned by `test/compute-engine/random-vectors.test.ts`.
 *
 * The cross-multiply-adds are SEQUENTIAL — `v.y += v.z*v.x` reads the `v.x`
 * just updated.
 *
 * `_gpu_rnd_draw` presents `w0` as `(w0 >> 8) * 2⁻²⁴`: the top 24 bits scaled
 * by an exact power of two, never implementation-rounded float math. It
 * advances the caller's invocation-local counter, taken by `inout`, so
 * repeated draws in one frame decorrelate.
 */
export const GPU_PCG3D_PREAMBLE_GLSL = `
uvec3 _gpu_pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
float _gpu_rnd_draw(uvec2 seed, inout uint n) {
  uvec3 w = _gpu_pcg3d(uvec3(seed.x, seed.y, n));
  n = n + 1u;
  return float(w.x >> 8u) * (1.0 / 16777216.0);
}
`;

/**
 * GPU Random preamble (WGSL syntax) — PCG3D. See
 * `GPU_PCG3D_PREAMBLE_GLSL` for the algorithm notes; this is the same
 * transcription with WGSL's `var<private>` counters passed by pointer.
 */
export const GPU_PCG3D_PREAMBLE_WGSL = `
fn _gpu_pcg3d(v_in: vec3<u32>) -> vec3<u32> {
  var v = v_in * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
fn _gpu_rnd_draw(seed: vec2<u32>, n: ptr<private, u32>) -> f32 {
  let w = _gpu_pcg3d(vec3<u32>(seed.x, seed.y, *n));
  *n = *n + 1u;
  return f32(w.x >> 8u) * (1.0 / 16777216.0);
}
`;

/**
 * GPU Median preamble (GLSL syntax).
 *
 * One function per supported list size (2..8) using sorting networks
 * encoded entirely as min/max calls (e.g. the 9-comparator Bose-Nelson
 * network for N=5, where v2 holds the median).
 */
export const GPU_MEDIAN_PREAMBLE_GLSL = `
float _gpu_median_2(float a, float b) {
  return (a + b) * 0.5;
}
float _gpu_median_3(float a, float b, float c) {
  return max(min(a, b), min(max(a, b), c));
}
float _gpu_median_4(float a, float b, float c, float d) {
  float lo = max(min(a, b), min(c, d));
  float hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
float _gpu_median_5(float a, float b, float c, float d, float e) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
float _gpu_median_6(float a, float b, float c, float d, float e, float f) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
float _gpu_median_7(float a, float b, float c, float d, float e, float f, float g) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
float _gpu_median_8(float a, float b, float c, float d, float e, float f, float g, float h) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g,v7=h;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

/**
 * GPU Median preamble (WGSL syntax).
 *
 * Same sorting-network logic as the GLSL version with WGSL syntax.
 */
export const GPU_MEDIAN_PREAMBLE_WGSL = `
fn _gpu_median_2(a: f32, b: f32) -> f32 {
  return (a + b) * 0.5;
}
fn _gpu_median_3(a: f32, b: f32, c: f32) -> f32 {
  return max(min(a, b), min(max(a, b), c));
}
fn _gpu_median_4(a: f32, b: f32, c: f32, d: f32) -> f32 {
  let lo = max(min(a, b), min(c, d));
  let hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
fn _gpu_median_5(a: f32, b: f32, c: f32, d: f32, e: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
fn _gpu_median_6(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
fn _gpu_median_7(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
fn _gpu_median_8(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32, h: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var v7=h; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

// ─── Color preamble ────────────────────────────────────────────────────────────

/**
 * GPU color space conversion preamble (GLSL syntax).
 *
 * Canonical color value: vec3 OKLCh `(L, C, H_deg)` — same convention as the
 * interpreted/JS-runtime layer. Shaders that write to a sRGB framebuffer must
 * wrap the final color in `_gpu_gamut_map_oklch()` at the boundary: it maps
 * the color into the sRGB gamut with the CSS Color 4 gamut mapping (below),
 * as the interpreter does at output. `_gpu_oklch_to_srgb()` does no mapping
 * and answers extended sRGB channels, which the canvas would clip one by one,
 * changing the hue of a color outside the gamut.
 *
 * Hue is in degrees throughout (matching the boxed-expression convention);
 * HSL/HSV saturation, lightness and value are in 0-1.
 *
 * The channels follow the rule of the interpreter and of the JavaScript
 * runtime (`readColorChannels`, `numerics/color-conversion.ts`):
 *
 * - sRGB channels are EXTENDED sRGB. A channel below 0 or above 1 is a color
 *   outside the sRGB gamut, and no conversion helper clamps it or maps it
 *   into the gamut: only the output does (`_gpu_gamut_map_oklch`, and the
 *   conversions to HSV and HSL). The transfer functions
 *   (`_gpu_srgb_to_linear`, `_gpu_linear_to_srgb`) are sign-extended,
 *   `sign(c)·f(|c|)`, as for extended sRGB in CSS Color 4, and the cube
 *   roots in `_gpu_srgb_to_oklab` are sign-extended too, because `pow` is
 *   undefined for a negative base. So a conversion to OKLab and back returns
 *   the same extended channels.
 * - `_gpu_hsv_to_rgb` and `_gpu_hsl_to_rgb` reduce the hue modulo 360 and
 *   clamp the saturation, the value and the lightness into `[0, 1]`: HSV and
 *   HSL describe only the sRGB gamut. `clamp` also reads an infinite channel
 *   as its bound, `+inf` as 1 and `-inf` as 0. An infinite hue has no
 *   reduction: it becomes `NaN`, and so does the whole triple (next item).
 * - `_gpu_rgb_to_hsv` and `_gpu_rgb_to_hsl` first map the color into the
 *   sRGB gamut (`_gpu_gamut_map_srgb`), because HSV and HSL cannot hold an
 *   extended color.
 * - `_gpu_gamut_map_oklch` is the CSS Color 4 gamut mapping of the
 *   interpreter (`gamutMapOklch`, `numerics/color-conversion.ts`), step for
 *   step: a triple with a `NaN` or an infinite channel is the `NaN` triple
 *   (this test comes first, so that an infinite lightness is not read as
 *   white); a lightness of 1 or more is white and 0 or less is black; a
 *   negative chroma is the positive chroma at the hue plus 180; a color
 *   inside the gamut (each channel within 1e-6 of `[0, 1]`) is its own
 *   channels, clamped; otherwise the chroma is searched in `[0, C]` at
 *   constant lightness and hue, and the search stops at the first chroma
 *   whose clamped color is within ΔE_OK 0.02 of it (and within 0.0001 of that
 *   bound), or when the interval is narrower than 0.0001. The loop has the
 *   constant bound 24, which a shader requires; 24 halvings bring a chroma
 *   below 1000 under 0.0001, so the bound does not stop the search first for
 *   any chroma a color has. `_gpu_gamut_map_oklch_p3` does the same in the
 *   Display-P3 gamut and answers the result in extended sRGB channels. The
 *   Display-P3 matrices are those of `LINEAR_SRGB_TO_LINEAR_P3` and
 *   `LINEAR_P3_TO_LINEAR_SRGB` in that module, rounded to 10 decimals.
 *   `_gpu_in_srgb_gamut` tests that each channel is in `[0, 1]`, within 1e-6,
 *   so it is also the test of Display-P3 coordinates.
 * - `_gpu_gamut_map_srgb` maps an extended sRGB color: a color inside the
 *   gamut is its own channels, clamped, and any other finite color goes
 *   through OKLCh and `_gpu_gamut_map_oklch`, as `gamutMapSrgb` does.
 * - An infinite sRGB channel or OKLab/OKLCh channel is not clamped: the
 *   arithmetic of the conversion makes it `NaN` (`inf - inf`), the NaN color
 *   of the interpreter's `incompatible-type` error.
 * - A `NaN` channel gives the `NaN` triple, as the interpreter refuses a
 *   `NaN` channel. GLSL and WGSL do not specify `min`, `max` or `clamp` of
 *   `NaN`, nor `sign(NaN)`, so a clamp or a sign step can change a `NaN`
 *   into a finite number. Each helper that clamps, takes a sign or compares
 *   (the HSV and HSL conversions, the sign-extended transfer functions and
 *   cube roots, `_gpu_apca_luma` and `_gpu_apca`) therefore first tests its
 *   input with a self-comparison (`x != x`, true only for `NaN`) and returns
 *   `NaN` channels. The `NaN` it returns is the sum of the tested values,
 *   which is `NaN` because one of them is, so the helpers do not depend on
 *   `_gpu_nan()`. This is best effort, as every `NaN` test on a shader is: a
 *   driver that assumes no `NaN` occurs (fast-math in GLSL, and WGSL, whose
 *   implementations may assume finite values) can fold the test to false.
 *
 * `_gpu_color_mix` interpolates directly in OKLCh — no sRGB pinch — and
 * special-cases achromatic endpoints (C ≈ 0) so e.g. mixing red with white
 * preserves red's hue rather than drifting through arbitrary hues.
 *
 * `_gpu_apca` is the APCA contrast the interpreter's `ColorContrast` answers,
 * component for component: the simple 2.4-power luminance the APCA method
 * asks for (NOT the piecewise sRGB transfer), sign-extended for an extended
 * sRGB channel as the interpreter's is, the black-level soft clamp, the
 * separate light-on-dark and dark-on-light exponents, the low-contrast clip
 * and its offset. The value is the APCA Lc divided by 100, so black text on
 * white is about 1.06 and white on black about -1.08. An earlier
 * approximation dropped every correction and multiplied by 100 instead, so
 * the same expression answered about -114 on a shader and about -1.08 in the
 * interpreter.
 *
 * WGSL targets must adapt syntax (vec3f, atan2→atan2, etc.).
 */
export const GPU_COLOR_PREAMBLE_GLSL = `
float _gpu_srgb_to_linear(float c) {
  if (c != c) return c;
  float a = abs(c);
  if (a <= 0.04045) return c / 12.92;
  return sign(c) * pow((a + 0.055) / 1.055, 2.4);
}

float _gpu_linear_to_srgb(float c) {
  if (c != c) return c;
  float a = abs(c);
  if (a <= 0.0031308) return 12.92 * c;
  return sign(c) * (1.055 * pow(a, 1.0 / 2.4) - 0.055);
}

vec3 _gpu_srgb_to_oklab(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  float lc = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  float mc = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  float sc = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  if (lc != lc || mc != mc || sc != sc) return vec3(lc + mc + sc);
  float l_ = sign(lc) * pow(abs(lc), 1.0 / 3.0);
  float m_ = sign(mc) * pow(abs(mc), 1.0 / 3.0);
  float s_ = sign(sc) * pow(abs(sc), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

vec3 _gpu_oklab_to_srgb(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  float r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  float g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  float b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return vec3(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b));
}

vec3 _gpu_oklab_to_oklch(vec3 lab) {
  float C = length(lab.yz);
  float H = atan(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) H += 360.0;
  return vec3(lab.x, C, H);
}

vec3 _gpu_oklch_to_oklab(vec3 lch) {
  float h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

vec3 _gpu_srgb_to_oklch(vec3 rgb) {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

vec3 _gpu_oklch_to_srgb(vec3 lch) {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

bool _gpu_in_srgb_gamut(vec3 rgb) {
  return all(greaterThanEqual(rgb, vec3(-1e-6))) && all(lessThanEqual(rgb, vec3(1.000001)));
}

vec3 _gpu_srgb_to_p3(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  return vec3(
    _gpu_linear_to_srgb(0.8224619687 * r + 0.1775380313 * g),
    _gpu_linear_to_srgb(0.0331941989 * r + 0.9668058011 * g),
    _gpu_linear_to_srgb(0.0170826307 * r + 0.0723974407 * g + 0.9105199286 * b)
  );
}

vec3 _gpu_p3_to_srgb(vec3 p3) {
  float r = _gpu_srgb_to_linear(p3.x);
  float g = _gpu_srgb_to_linear(p3.y);
  float b = _gpu_srgb_to_linear(p3.z);
  return vec3(
    _gpu_linear_to_srgb(1.2249401763 * r - 0.2249401763 * g),
    _gpu_linear_to_srgb(-0.0420569547 * r + 1.0420569547 * g),
    _gpu_linear_to_srgb(-0.0196375546 * r - 0.0786360456 * g + 1.0982736 * b)
  );
}

vec3 _gpu_oklch_to_gamut(vec3 lch, bool p3) {
  vec3 rgb = _gpu_oklch_to_srgb(lch);
  if (p3) return _gpu_srgb_to_p3(rgb);
  return rgb;
}

float _gpu_gamut_delta_e(vec3 c, vec3 lch, bool p3) {
  vec3 a = _gpu_srgb_to_oklab(p3 ? _gpu_p3_to_srgb(c) : c);
  vec3 b = _gpu_oklch_to_oklab(lch);
  float dL = a.x - b.x;
  float da = a.y - b.y;
  float db = a.z - b.z;
  return sqrt(dL * dL + da * da + db * db);
}

vec3 _gpu_gamut_map_oklch_in(vec3 lch, bool p3) {
  float L = lch.x;
  float C = lch.y;
  float H = lch.z;
  if (L != L || C != C || H != H) return vec3(L + C + H);
  if (!(abs(L) <= 3.4028234663852886e38 && abs(C) <= 3.4028234663852886e38 && abs(H) <= 3.4028234663852886e38))
    return vec3(intBitsToFloat(0x7FC00000));
  if (L >= 1.0) return vec3(1.0);
  if (L <= 0.0) return vec3(0.0);
  if (C < 0.0) {
    C = -C;
    H = H + 180.0;
  }
  vec3 origin = _gpu_oklch_to_gamut(vec3(L, C, H), p3);
  vec3 clipped = clamp(origin, 0.0, 1.0);
  if (_gpu_in_srgb_gamut(origin)) return clipped;
  if (_gpu_gamut_delta_e(clipped, vec3(L, C, H), p3) < 0.02) return clipped;
  float lo = 0.0;
  float hi = C;
  bool loInGamut = true;
  for (int i = 0; i < 24; i++) {
    if (hi - lo <= 0.0001) break;
    float chroma = (lo + hi) / 2.0;
    vec3 current = _gpu_oklch_to_gamut(vec3(L, chroma, H), p3);
    if (loInGamut && _gpu_in_srgb_gamut(current)) {
      lo = chroma;
    } else {
      clipped = clamp(current, 0.0, 1.0);
      float e = _gpu_gamut_delta_e(clipped, vec3(L, chroma, H), p3);
      if (e < 0.02) {
        if (0.02 - e < 0.0001) return clipped;
        loInGamut = false;
        lo = chroma;
      } else {
        hi = chroma;
      }
    }
  }
  return clipped;
}

vec3 _gpu_gamut_map_oklch(vec3 lch) {
  return _gpu_gamut_map_oklch_in(lch, false);
}

vec3 _gpu_gamut_map_oklch_p3(vec3 lch) {
  return _gpu_p3_to_srgb(_gpu_gamut_map_oklch_in(lch, true));
}

vec3 _gpu_gamut_map_srgb(vec3 rgb) {
  if (rgb.x != rgb.x || rgb.y != rgb.y || rgb.z != rgb.z)
    return vec3(rgb.x + rgb.y + rgb.z);
  if (_gpu_in_srgb_gamut(rgb)) return clamp(rgb, 0.0, 1.0);
  if (!(abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38))
    return clamp(rgb, 0.0, 1.0);
  return _gpu_gamut_map_oklch(_gpu_srgb_to_oklch(rgb));
}

vec3 _gpu_hsl_to_rgb(vec3 hsl) {
  float h = mod(hsl.x, 360.0);
  if (h != h || hsl.y != hsl.y || hsl.z != hsl.z) return vec3(h + hsl.y + hsl.z);
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = l - c / 2.0;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsl(vec3 rgb_in) {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z)
    return vec3(rgb_in.x + rgb_in.y + rgb_in.z);
  vec3 rgb = _gpu_gamut_map_srgb(rgb_in);
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float l = (maxc + minc) / 2.0;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0));
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, l);
}

vec3 _gpu_hsv_to_rgb(vec3 hsv) {
  float h = mod(hsv.x, 360.0);
  if (h != h || hsv.y != hsv.y || hsv.z != hsv.z) return vec3(h + hsv.y + hsv.z);
  float s = clamp(hsv.y, 0.0, 1.0);
  float v = clamp(hsv.z, 0.0, 1.0);
  float c = v * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = v - c;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsv(vec3 rgb_in) {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z)
    return vec3(rgb_in.x + rgb_in.y + rgb_in.z);
  vec3 rgb = _gpu_gamut_map_srgb(rgb_in);
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float v = maxc;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, v);
  float s = (maxc < 1e-6) ? 0.0 : d / maxc;
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, v);
}

vec3 _gpu_color_mix(vec3 lch1, vec3 lch2, float t) {
  float L = mix(lch1.x, lch2.x, t);
  float C = mix(lch1.y, lch2.y, t);
  bool a1 = lch1.y < 1e-6;
  bool a2 = lch2.y < 1e-6;
  float H;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    float dh = lch2.z - lch1.z;
    if (dh > 180.0) dh -= 360.0;
    if (dh < -180.0) dh += 360.0;
    H = lch1.z + dh * t;
    if (H < 0.0) H += 360.0;
    if (H >= 360.0) H -= 360.0;
  }
  return vec3(L, C, H);
}

float _gpu_apca_luma(vec3 srgb) {
  if (srgb.x != srgb.x || srgb.y != srgb.y || srgb.z != srgb.z)
    return srgb.x + srgb.y + srgb.z;
  float Y = 0.2126729 * sign(srgb.x) * pow(abs(srgb.x), 2.4)
          + 0.7151522 * sign(srgb.y) * pow(abs(srgb.y), 2.4)
          + 0.0721750 * sign(srgb.z) * pow(abs(srgb.z), 2.4);
  return Y >= 0.022 ? Y : Y + pow(0.022 - Y, 1.414);
}

float _gpu_apca(vec3 lch_bg, vec3 lch_fg) {
  float Ybg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_bg));
  float Yfg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_fg));
  if (Ybg != Ybg || Yfg != Yfg) return Ybg + Yfg;
  float C = 0.0;
  if (abs(Ybg - Yfg) >= 0.0005) {
    if (Ybg > Yfg) C = (pow(Ybg, 0.56) - pow(Yfg, 0.57)) * 1.14;
    else           C = (pow(Ybg, 0.65) - pow(Yfg, 0.62)) * 1.14;
  }
  if (abs(C) < 0.1) return 0.0;
  return C > 0.0 ? C - 0.027 : C + 0.027;
}
`;

/**
 * GPU color space conversion preamble (WGSL syntax).
 *
 * Same convention as the GLSL preamble: canonical color value is `vec3f`
 * OKLCh `(L, C, H_deg)`. Shaders writing to a sRGB framebuffer must wrap
 * their final color in `_gpu_gamut_map_oklch()`.
 */
export const GPU_COLOR_PREAMBLE_WGSL = `
fn _gpu_srgb_to_linear(c: f32) -> f32 {
  if (c != c) { return c; }
  let a = abs(c);
  if (a <= 0.04045) { return c / 12.92; }
  return sign(c) * pow((a + 0.055) / 1.055, 2.4);
}

fn _gpu_linear_to_srgb(c: f32) -> f32 {
  if (c != c) { return c; }
  let a = abs(c);
  if (a <= 0.0031308) { return 12.92 * c; }
  return sign(c) * (1.055 * pow(a, 1.0 / 2.4) - 0.055);
}

fn _gpu_srgb_to_oklab(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  let lc = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  let mc = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  let sc = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  if (lc != lc || mc != mc || sc != sc) { return vec3f(lc + mc + sc); }
  let l_ = sign(lc) * pow(abs(lc), 1.0 / 3.0);
  let m_ = sign(mc) * pow(abs(mc), 1.0 / 3.0);
  let s_ = sign(sc) * pow(abs(sc), 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

fn _gpu_oklab_to_srgb(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return vec3f(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b));
}

fn _gpu_oklab_to_oklch(lab: vec3f) -> vec3f {
  let C = length(lab.yz);
  var H = atan2(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) { H = H + 360.0; }
  return vec3f(lab.x, C, H);
}

fn _gpu_oklch_to_oklab(lch: vec3f) -> vec3f {
  let h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3f(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

fn _gpu_srgb_to_oklch(rgb: vec3f) -> vec3f {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

fn _gpu_oklch_to_srgb(lch: vec3f) -> vec3f {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

fn _gpu_in_srgb_gamut(rgb: vec3f) -> bool {
  return all(rgb >= vec3f(-1e-6)) && all(rgb <= vec3f(1.000001));
}

fn _gpu_srgb_to_p3(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  return vec3f(
    _gpu_linear_to_srgb(0.8224619687 * r + 0.1775380313 * g),
    _gpu_linear_to_srgb(0.0331941989 * r + 0.9668058011 * g),
    _gpu_linear_to_srgb(0.0170826307 * r + 0.0723974407 * g + 0.9105199286 * b)
  );
}

fn _gpu_p3_to_srgb(p3: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(p3.x);
  let g = _gpu_srgb_to_linear(p3.y);
  let b = _gpu_srgb_to_linear(p3.z);
  return vec3f(
    _gpu_linear_to_srgb(1.2249401763 * r - 0.2249401763 * g),
    _gpu_linear_to_srgb(-0.0420569547 * r + 1.0420569547 * g),
    _gpu_linear_to_srgb(-0.0196375546 * r - 0.0786360456 * g + 1.0982736 * b)
  );
}

fn _gpu_oklch_to_gamut(lch: vec3f, p3: bool) -> vec3f {
  let rgb = _gpu_oklch_to_srgb(lch);
  if (p3) { return _gpu_srgb_to_p3(rgb); }
  return rgb;
}

fn _gpu_gamut_delta_e(c: vec3f, lch: vec3f, p3: bool) -> f32 {
  let a = _gpu_srgb_to_oklab(select(c, _gpu_p3_to_srgb(c), p3));
  let b = _gpu_oklch_to_oklab(lch);
  let dL = a.x - b.x;
  let da = a.y - b.y;
  let db = a.z - b.z;
  return sqrt(dL * dL + da * da + db * db);
}

fn _gpu_gamut_map_oklch_in(lch: vec3f, p3: bool) -> vec3f {
  let L = lch.x;
  var C = lch.y;
  var H = lch.z;
  if (L != L || C != C || H != H) { return vec3f(L + C + H); }
  if (!(abs(L) <= 3.4028234663852886e38 && abs(C) <= 3.4028234663852886e38 && abs(H) <= 3.4028234663852886e38)) {
    return vec3f(_gpu_nan());
  }
  if (L >= 1.0) { return vec3f(1.0); }
  if (L <= 0.0) { return vec3f(0.0); }
  if (C < 0.0) {
    C = -C;
    H = H + 180.0;
  }
  let origin = _gpu_oklch_to_gamut(vec3f(L, C, H), p3);
  var clipped = clamp(origin, vec3f(0.0), vec3f(1.0));
  if (_gpu_in_srgb_gamut(origin)) { return clipped; }
  if (_gpu_gamut_delta_e(clipped, vec3f(L, C, H), p3) < 0.02) { return clipped; }
  var lo: f32 = 0.0;
  var hi: f32 = C;
  var loInGamut = true;
  for (var i: i32 = 0; i < 24; i = i + 1) {
    if (hi - lo <= 0.0001) { break; }
    let chroma = (lo + hi) / 2.0;
    let current = _gpu_oklch_to_gamut(vec3f(L, chroma, H), p3);
    if (loInGamut && _gpu_in_srgb_gamut(current)) {
      lo = chroma;
    } else {
      clipped = clamp(current, vec3f(0.0), vec3f(1.0));
      let e = _gpu_gamut_delta_e(clipped, vec3f(L, chroma, H), p3);
      if (e < 0.02) {
        if (0.02 - e < 0.0001) { return clipped; }
        loInGamut = false;
        lo = chroma;
      } else {
        hi = chroma;
      }
    }
  }
  return clipped;
}

fn _gpu_gamut_map_oklch(lch: vec3f) -> vec3f {
  return _gpu_gamut_map_oklch_in(lch, false);
}

fn _gpu_gamut_map_oklch_p3(lch: vec3f) -> vec3f {
  return _gpu_p3_to_srgb(_gpu_gamut_map_oklch_in(lch, true));
}

fn _gpu_gamut_map_srgb(rgb: vec3f) -> vec3f {
  if (rgb.x != rgb.x || rgb.y != rgb.y || rgb.z != rgb.z) {
    return vec3f(rgb.x + rgb.y + rgb.z);
  }
  if (_gpu_in_srgb_gamut(rgb)) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
  if (!(abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38)) {
    return clamp(rgb, vec3f(0.0), vec3f(1.0));
  }
  return _gpu_gamut_map_oklch(_gpu_srgb_to_oklch(rgb));
}

fn _gpu_hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = hsl.x - 360.0 * floor(hsl.x / 360.0);
  if (h != h || hsl.y != hsl.y || hsl.z != hsl.z) { return vec3f(h + hsl.y + hsl.z); }
  let s = clamp(hsl.y, 0.0, 1.0);
  let l = clamp(hsl.z, 0.0, 1.0);
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = l - c / 2.0;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsl(rgb_in: vec3f) -> vec3f {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z) {
    return vec3f(rgb_in.x + rgb_in.y + rgb_in.z);
  }
  let rgb = _gpu_gamut_map_srgb(rgb_in);
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let l = (maxc + minc) / 2.0;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, l); }
  let s = d / (1.0 - abs(2.0 * l - 1.0));
  var h: f32;
  if (maxc == rgb.x) {
    let v = (rgb.y - rgb.z) / d;
    h = v - 6.0 * floor(v / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, l);
}

fn _gpu_hsv_to_rgb(hsv: vec3f) -> vec3f {
  let h = hsv.x - 360.0 * floor(hsv.x / 360.0);
  if (h != h || hsv.y != hsv.y || hsv.z != hsv.z) { return vec3f(h + hsv.y + hsv.z); }
  let s = clamp(hsv.y, 0.0, 1.0);
  let v = clamp(hsv.z, 0.0, 1.0);
  let c = v * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = v - c;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsv(rgb_in: vec3f) -> vec3f {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z) {
    return vec3f(rgb_in.x + rgb_in.y + rgb_in.z);
  }
  let rgb = _gpu_gamut_map_srgb(rgb_in);
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let v = maxc;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, v); }
  var s: f32 = 0.0;
  if (maxc >= 1e-6) { s = d / maxc; }
  var h: f32;
  if (maxc == rgb.x) {
    let q = (rgb.y - rgb.z) / d;
    h = q - 6.0 * floor(q / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, v);
}

fn _gpu_color_mix(lch1: vec3f, lch2: vec3f, t: f32) -> vec3f {
  let L = mix(lch1.x, lch2.x, t);
  let C = mix(lch1.y, lch2.y, t);
  let a1 = lch1.y < 1e-6;
  let a2 = lch2.y < 1e-6;
  var H: f32;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    var dh = lch2.z - lch1.z;
    if (dh > 180.0) { dh = dh - 360.0; }
    if (dh < -180.0) { dh = dh + 360.0; }
    H = lch1.z + dh * t;
    if (H < 0.0) { H = H + 360.0; }
    if (H >= 360.0) { H = H - 360.0; }
  }
  return vec3f(L, C, H);
}

fn _gpu_apca_luma(srgb: vec3f) -> f32 {
  if (srgb.x != srgb.x || srgb.y != srgb.y || srgb.z != srgb.z) {
    return srgb.x + srgb.y + srgb.z;
  }
  let Y = 0.2126729 * sign(srgb.x) * pow(abs(srgb.x), 2.4)
        + 0.7151522 * sign(srgb.y) * pow(abs(srgb.y), 2.4)
        + 0.0721750 * sign(srgb.z) * pow(abs(srgb.z), 2.4);
  return select(Y + pow(0.022 - Y, 1.414), Y, Y >= 0.022);
}

fn _gpu_apca(lch_bg: vec3f, lch_fg: vec3f) -> f32 {
  let Ybg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_bg));
  let Yfg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_fg));
  if (Ybg != Ybg || Yfg != Yfg) { return Ybg + Yfg; }
  var C = 0.0;
  if (abs(Ybg - Yfg) >= 0.0005) {
    if (Ybg > Yfg) {
      C = (pow(Ybg, 0.56) - pow(Yfg, 0.57)) * 1.14;
    } else {
      C = (pow(Ybg, 0.65) - pow(Yfg, 0.62)) * 1.14;
    }
  }
  if (abs(C) < 0.1) { return 0.0; }
  return select(C + 0.027, C - 0.027, C > 0.0);
}
`;

/**
 * The sRGB round trip (GLSL syntax): an sRGB triple converted to OKLCh and
 * back, which the `AsRgb(Rgb(…))`, `AsRgb(Hsv(…))` and `AsRgb(Hsl(…))`
 * lowerings emit (`gpuRgbBoundary`).
 *
 * The conversions keep extended sRGB channels (a channel below 0 or above 1
 * is a color outside the sRGB gamut, and the canvas clamps it at output), and
 * they do no gamut mapping. So for a finite triple the round trip is the
 * identity, and the helper returns the triple without the two conversions.
 * A triple with an infinite or `NaN` channel goes through the conversions,
 * which answer `NaN` channels: an infinite sRGB channel is not a color, as on
 * the interpreter (`readColorChannels`). An infinite channel becomes `NaN` in
 * the arithmetic of the conversion (`inf - inf`), and the conversions test
 * for a `NaN` channel before each sign step and return `NaN` channels, so a
 * `NaN` channel stays `NaN` (best effort, as the colour preamble comment
 * says). The test is against `3.4028234663852886e38`, the largest finite 32-bit
 * float, because WGSL has no `isinf`: every finite channel passes it, and
 * only an infinite one (or `NaN`) fails.
 *
 * It stands apart from the colour preamble above only because it is a later
 * addition to the same library; it calls two of that library's functions,
 * so it is appended to it (`GPU_COLOR_LIBRARY_GLSL`) and the per-function
 * inclusion pass pulls in whatever it needs.
 */
const GPU_SRGB_ROUNDTRIP_GLSL = `
vec3 _gpu_srgb_roundtrip(vec3 rgb) {
  if (abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38) return rgb;
  return _gpu_oklch_to_srgb(_gpu_srgb_to_oklch(rgb));
}
`;

/** The sRGB round trip (WGSL syntax). See `GPU_SRGB_ROUNDTRIP_GLSL`. */
const GPU_SRGB_ROUNDTRIP_WGSL = `
fn _gpu_srgb_roundtrip(rgb: vec3f) -> vec3f {
  if (abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38) { return rgb; }
  return _gpu_oklch_to_srgb(_gpu_srgb_to_oklch(rgb));
}
`;

/**
 * The channel check of the `Oklch` and `Oklab` lowerings (GLSL syntax): the
 * triple itself when its three channels are finite, and the `NaN` color
 * (three `NaN` channels) otherwise.
 *
 * OKLab and OKLCh channels have no bound, so an infinite or `NaN` channel is
 * not a color: the interpreter refuses it with `incompatible-type`, and the
 * javascript target answers the `NaN` color (`readColorChannels`,
 * `numerics/color-conversion.ts`). The `Oklch` lowering passes its channels
 * through without a conversion, and `_gpu_oklab_to_oklch` keeps the lightness
 * as it is, so without this check `Oklch(+oo, 0.1, 30)` gave the raw channels
 * `(Inf, 0.1, 30)`. The test is against `3.4028234663852886e38`, the largest
 * finite 32-bit float, because WGSL has no `isinf`: every finite channel
 * passes it, and an infinite or `NaN` channel fails it.
 */
const GPU_FINITE_COLOR_GLSL = `
vec3 _gpu_finite_color(vec3 c) {
  if (abs(c.x) <= 3.4028234663852886e38 && abs(c.y) <= 3.4028234663852886e38 && abs(c.z) <= 3.4028234663852886e38) return c;
  return vec3(intBitsToFloat(0x7FC00000));
}
`;

/** The channel check (WGSL syntax). See `GPU_FINITE_COLOR_GLSL`. */
const GPU_FINITE_COLOR_WGSL = `
fn _gpu_finite_color(c: vec3f) -> vec3f {
  if (abs(c.x) <= 3.4028234663852886e38 && abs(c.y) <= 3.4028234663852886e38 && abs(c.z) <= 3.4028234663852886e38) { return c; }
  return vec3f(_gpu_nan());
}
`;

/** The whole colour library, round trip included, in one dependency order. */
export const GPU_COLOR_LIBRARY_GLSL =
  GPU_COLOR_PREAMBLE_GLSL + GPU_SRGB_ROUNDTRIP_GLSL + GPU_FINITE_COLOR_GLSL;
export const GPU_COLOR_LIBRARY_WGSL =
  GPU_COLOR_PREAMBLE_WGSL + GPU_SRGB_ROUNDTRIP_WGSL + GPU_FINITE_COLOR_WGSL;

/**
 * GLSL NaN helper preamble. Centralizes the masked/else-branch NaN (`When` /
 * `Which` fall-through) into a single overridable symbol.
 *
 * GLSL has no `NaN` literal. The target assumes GLSL ES 3.00 (`#version
 * 300 es`), where `intBitsToFloat(0x7FC00000)` yields a guaranteed NaN bit
 * pattern. Routing every masked NaN through one helper lets a host redefine
 * what a masked branch produces (e.g. a sentinel value) without touching the
 * generated code. The current body is pinned by `compile-glsl.test.ts`.
 */
export const GPU_NAN_PREAMBLE_GLSL = `
float _gpu_nan() {
  return intBitsToFloat(0x7FC00000);
}
`;

/**
 * GLSL infinity helper preamble — the `+∞` counterpart of
 * `GPU_NAN_PREAMBLE_GLSL`, structured identically so a host can redefine it in
 * the same way.
 *
 * `intBitsToFloat(0x7F800000)` is the IEEE-754 `+∞` bit pattern (same
 * GLSL ES 3.00 builtin the NaN helper uses, so no extra version requirement).
 * Deliberately NOT `1.0 / 0.0`: fast-math is licensed to fold a division by a
 * constant zero, and this project has already been bitten by ANGLE→Metal
 * fast-math. A bit pattern is not foldable.
 */
export const GPU_INF_PREAMBLE_GLSL = `
float _gpu_inf() {
  return intBitsToFloat(0x7F800000);
}
`;

/**
 * WGSL NaN and +∞ helpers, the WGSL counterparts of `GPU_NAN_PREAMBLE_GLSL`
 * and `GPU_INF_PREAMBLE_GLSL`, with the same names so that emitted code and
 * helper bodies spell a non-finite value the same way on both targets.
 *
 * WGSL has no NaN or infinity literal, and it cannot build one from a
 * constant: a const-expression that evaluates to NaN or an infinity is a
 * shader-creation error, so the inline constant `bitcast<f32>(0x7fc00000u)`
 * and `0.0 / 0.0` are both rejected (Chrome's WGSL compiler reports "value nan cannot be
 * represented as 'f32'"). A `let` is not a const-expression, so the bitcast
 * of a `let` holding the bit pattern is evaluated at run time and gives the
 * value. Measured in Chrome 153 on an Apple M5 GPU: the helpers compile and
 * read back as NaN and +∞. WGSL declarations are order-independent, so
 * `preambleFor` adds these after scanning the whole preamble.
 */
export const GPU_NAN_PREAMBLE_WGSL = `
fn _gpu_nan() -> f32 {
  let bits = 0x7fc00000u;
  return bitcast<f32>(bits);
}
`;

export const GPU_INF_PREAMBLE_WGSL = `
fn _gpu_inf() -> f32 {
  let bits = 0x7f800000u;
  return bitcast<f32>(bits);
}
`;

/**
 * Sign-preserving integer power (GLSL syntax). GLSL `pow(x, n)` is
 * `exp2(n·log2(x))`, undefined for a negative base — it returns `+8` for
 * `pow(-2.0, 3.0)` (wrong sign) and NaN for even powers of a negative. Compute
 * the magnitude from `abs(x)` and restore the sign for odd exponents. `n` is an
 * integer value of EITHER sign (a run-time exponent declared `integer` can be
 * negative); matches JS `Math.pow` for integer exponents (including
 * `0^0 = 1`). The parity test is taken on `abs(n)` because the two languages
 * disagree on the remainder of a negative operand: GLSL `mod` is floored
 * (`mod(-3.0, 2.0)` is 1.0) while WGSL `%` is truncated (`-3.0 % 2.0` is
 * -1.0), so a bare `n` would miss the odd branch on WGSL and answer `+0.125`
 * for `_gpu_powi(-2.0, -3.0)` where -0.125 is right.
 */
export const GPU_POWI_PREAMBLE_GLSL = `
float _gpu_powi(float x, float n) {
  if (n == 0.0) return 1.0;
  if (n == 2.0) return x * x;
  if (n == 3.0) return x * x * x;
  if (n == 4.0) { float s = x * x; return s * s; }
  float r = pow(abs(x), n);
  if (x < 0.0 && mod(abs(n), 2.0) == 1.0) return -r;
  return r;
}
`;

/**
 * Sign-preserving integer power (WGSL syntax). See GPU_POWI_PREAMBLE_GLSL.
 */
export const GPU_POWI_PREAMBLE_WGSL = `
fn _gpu_powi(x: f32, n: f32) -> f32 {
  if (n == 0.0) { return 1.0; }
  if (n == 2.0) { return x * x; }
  if (n == 3.0) { return x * x * x; }
  if (n == 4.0) { let s = x * x; return s * s; }
  let r = pow(abs(x), n);
  if (x < 0.0 && (abs(n) % 2.0) == 1.0) { return -r; }
  return r;
}
`;

/**
 * `cos(πu)` and `sin(πu)` (GLSL syntax), with the angle `u` in half-turns
 * reduced exactly before the multiplication by π, as `cosSinPi()`
 * (`numerics/numeric-complex.ts`) does: `u` is written `t + q/2` with
 * `|t| ≤ 1/4`, both steps exact in floating point, so the value at an
 * integer or a half-integer `u` has an exact zero part. `sin(πx)` at `x = 2`
 * is `0`, where `sin(3.14159274 * 2.0)` is not. A zero part is `+0.0`
 * (`1/sin(πx)` at `x = 1` is `+∞`). `_gpu_cossinpi(u)` is also `e^{iπu}` as
 * a `vec2`. See `BaseCompiler.piMultiple`. `_gpu_tanpi(u)` at a pole (a
 * half-integer `u`) is `+∞`, the compiled spelling of the interpreter's
 * `~oo`; the quotient `sin/cos` gave `+∞` or `−∞` from the sign of the zero
 * cosine, and the sign was not the same on WebGL2 and WebGPU (CE-520).
 *
 * A NaN or infinite `u` gives a NaN in each part, from a test of its bit
 * pattern on the first line (a test `u != u` can be removed by the
 * compiler). The NaN is built from its bit pattern, as `_gpu_nan()` builds
 * it: the WebGL2 compiler on ANGLE Metal folded `u - u` to 0. Without the
 * test, the reduced angle of such a `u` is NaN, and `cos` and `sin` of it
 * gave 0 on Apple GPUs (CE-520).
 *
 * `_gpu_ipi_sinh(u)` … `_gpu_ipi_coth(u)` are `sinh`, `cosh`, `tanh`,
 * `csch`, `sech` and `coth` of `iπu` as a `vec2`: `sinh(iθ) = i·sin θ`,
 * `cosh(iθ) = cos θ`, `tanh(iθ) = i·tan θ`, `csch(iθ) = −i/sin θ`,
 * `sech(iθ) = 1/cos θ` and `coth(iθ) = −i·cot θ`. A zero is exact, and a
 * pole is `vec2(+∞, +∞)`, the compiled spelling of the interpreter's `~oo`.
 * They call `_gpu_inf()`, so a compilation that names one of them forces
 * the GLSL Infinity helper in. See `BaseCompiler.imaginaryPiMultiple`.
 */
export const GPU_PI_TRIG_PREAMBLE_GLSL = `
vec2 _gpu_cossinpi(float u) {
  if ((floatBitsToUint(u) & 0x7FFFFFFFu) >= 0x7F800000u) return vec2(intBitsToFloat(0x7FC00000));
  float r = u - 2.0 * floor(u / 2.0 + 0.5);
  float q = floor(2.0 * r + 0.5);
  float t = r - q / 2.0;
  float c = cos(3.141592653589793 * t);
  float s = sin(3.141592653589793 * t);
  float k = q + 4.0 - 4.0 * floor((q + 4.0) / 4.0);
  vec2 v = vec2(s, -c);
  if (k == 0.0) v = vec2(c, s);
  if (k == 1.0) v = vec2(-s, c);
  if (k == 2.0) v = vec2(-c, -s);
  return vec2(v.x == 0.0 ? 0.0 : v.x, v.y == 0.0 ? 0.0 : v.y);
}
float _gpu_sinpi(float u) {
  return _gpu_cossinpi(u).y;
}
float _gpu_cospi(float u) {
  return _gpu_cossinpi(u).x;
}
float _gpu_tanpi(float u) {
  vec2 cs = _gpu_cossinpi(u);
  if (cs.x == 0.0) return _gpu_inf();
  return cs.y == 0.0 ? 0.0 : cs.y / cs.x;
}
vec2 _gpu_ipi_sinh(float u) {
  return vec2(0.0, _gpu_cossinpi(u).y);
}
vec2 _gpu_ipi_cosh(float u) {
  return vec2(_gpu_cossinpi(u).x, 0.0);
}
vec2 _gpu_ipi_tanh(float u) {
  vec2 cs = _gpu_cossinpi(u);
  if (cs.x == 0.0) return vec2(_gpu_inf(), _gpu_inf());
  return vec2(0.0, cs.y == 0.0 ? 0.0 : cs.y / cs.x);
}
vec2 _gpu_ipi_csch(float u) {
  vec2 cs = _gpu_cossinpi(u);
  if (cs.y == 0.0) return vec2(_gpu_inf(), _gpu_inf());
  return vec2(0.0, -1.0 / cs.y);
}
vec2 _gpu_ipi_sech(float u) {
  vec2 cs = _gpu_cossinpi(u);
  if (cs.x == 0.0) return vec2(_gpu_inf(), _gpu_inf());
  return vec2(1.0 / cs.x, 0.0);
}
vec2 _gpu_ipi_coth(float u) {
  vec2 cs = _gpu_cossinpi(u);
  if (cs.y == 0.0) return vec2(_gpu_inf(), _gpu_inf());
  return vec2(0.0, cs.x == 0.0 ? 0.0 : -cs.x / cs.y);
}
`;

/** `cos(πu)` and `sin(πu)` (WGSL syntax). See `GPU_PI_TRIG_PREAMBLE_GLSL`. */
export const GPU_PI_TRIG_PREAMBLE_WGSL = `
fn _gpu_cossinpi(u: f32) -> vec2f {
  let bits = 0x7fc00000u;
  if ((bitcast<u32>(u) & 0x7FFFFFFFu) >= 0x7F800000u) { return vec2f(bitcast<f32>(bits)); }
  let r = u - 2.0 * floor(u / 2.0 + 0.5);
  let q = floor(2.0 * r + 0.5);
  let t = r - q / 2.0;
  let c = cos(3.141592653589793 * t);
  let s = sin(3.141592653589793 * t);
  let k = q + 4.0 - 4.0 * floor((q + 4.0) / 4.0);
  var v = vec2f(s, -c);
  if (k == 0.0) { v = vec2f(c, s); }
  if (k == 1.0) { v = vec2f(-s, c); }
  if (k == 2.0) { v = vec2f(-c, -s); }
  return vec2f(select(v.x, 0.0, v.x == 0.0), select(v.y, 0.0, v.y == 0.0));
}
fn _gpu_sinpi(u: f32) -> f32 {
  return _gpu_cossinpi(u).y;
}
fn _gpu_cospi(u: f32) -> f32 {
  return _gpu_cossinpi(u).x;
}
fn _gpu_tanpi(u: f32) -> f32 {
  let cs = _gpu_cossinpi(u);
  if (cs.x == 0.0) { return _gpu_inf(); }
  return select(cs.y / cs.x, 0.0, cs.y == 0.0);
}
fn _gpu_ipi_sinh(u: f32) -> vec2f {
  return vec2f(0.0, _gpu_cossinpi(u).y);
}
fn _gpu_ipi_cosh(u: f32) -> vec2f {
  return vec2f(_gpu_cossinpi(u).x, 0.0);
}
fn _gpu_ipi_tanh(u: f32) -> vec2f {
  let cs = _gpu_cossinpi(u);
  if (cs.x == 0.0) { return vec2f(_gpu_inf(), _gpu_inf()); }
  return vec2f(0.0, select(cs.y / cs.x, 0.0, cs.y == 0.0));
}
fn _gpu_ipi_csch(u: f32) -> vec2f {
  let cs = _gpu_cossinpi(u);
  if (cs.y == 0.0) { return vec2f(_gpu_inf(), _gpu_inf()); }
  return vec2f(0.0, -1.0 / cs.y);
}
fn _gpu_ipi_sech(u: f32) -> vec2f {
  let cs = _gpu_cossinpi(u);
  if (cs.x == 0.0) { return vec2f(_gpu_inf(), _gpu_inf()); }
  return vec2f(1.0 / cs.x, 0.0);
}
fn _gpu_ipi_coth(u: f32) -> vec2f {
  let cs = _gpu_cossinpi(u);
  if (cs.y == 0.0) { return vec2f(_gpu_inf(), _gpu_inf()); }
  return vec2f(0.0, select(-cs.x / cs.y, 0.0, cs.x == 0.0));
}
`;

/**
 * The rounding helpers of `Round` for a scalar operand (GLSL syntax), one
 * for each tie rule other than `to-even` (see `gpuRoundToInteger()`):
 * `_gpu_round` rounds a tie away from zero (`Round(-2.5)` is -3,
 * `Round(2.5)` is 3), `_gpu_round_tz` toward zero, `_gpu_round_up` toward
 * `+∞` and `_gpu_round_down` toward `−∞`. `_gpu_step_quotient` and
 * `_gpu_half_step_quotient` are the quotients of the step forms, and
 * `_gpu_step_fix` their result when the quotient overflows
 * (`gpuRoundToStep()`). `gpuLibrarySubset()` keeps
 * only the helpers that a compilation calls.
 *
 * `step(0.5, d)` is `1` when `d ≥ 0.5`, and `1 - step(d, 0.5)` is `1` when
 * `d > 0.5`; it is added to `m` as one term, because `m + 1.0` is rounded
 * when `m ≥ 2²⁴`. The distance `d` to the floor (or the ceiling) is exact for a
 * magnitude, and for the other two helpers it can only be rounded UP to
 * `0.5`, from a value that must round the same way.
 */
export const GPU_ROUND_PREAMBLE_GLSL = `
float _gpu_round(float x) {
  float a = abs(x);
  float m = floor(a);
  return sign(x) * (m + step(0.5, a - m));
}
float _gpu_round_tz(float x) {
  float a = abs(x);
  float m = floor(a);
  return sign(x) * (m + (1.0 - step(a - m, 0.5)));
}
float _gpu_round_up(float x) {
  float m = floor(x);
  return m + step(0.5, x - m);
}
float _gpu_round_down(float x) {
  float m = ceil(x);
  return m - step(0.5, m - x);
}
float _gpu_step_quotient(float x, float k) {
  float q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) return sign(x) * 1.17549435e-38;
  float r = round(q);
  return abs(q - r) <= 4.8e-7 * abs(q) ? r : q;
}
float _gpu_half_step_quotient(float x, float k) {
  float q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) return sign(x) * 1.17549435e-38;
  float r = round(q * 2.0) * 0.5;
  return abs(q - r) <= 4.8e-7 * abs(q) ? r : q;
}
float _gpu_step_fix(float m, float x, float k) {
  return k != 0.0 && abs(x / k) > 3.4e38 ? x : m;
}
`;

/** The rounding helpers of `Round` (WGSL syntax). See
 * `GPU_ROUND_PREAMBLE_GLSL`. */
export const GPU_ROUND_PREAMBLE_WGSL = `
fn _gpu_round(x: f32) -> f32 {
  let a = abs(x);
  let m = floor(a);
  return sign(x) * (m + step(0.5, a - m));
}
fn _gpu_round_tz(x: f32) -> f32 {
  let a = abs(x);
  let m = floor(a);
  return sign(x) * (m + (1.0 - step(a - m, 0.5)));
}
fn _gpu_round_up(x: f32) -> f32 {
  let m = floor(x);
  return m + step(0.5, x - m);
}
fn _gpu_round_down(x: f32) -> f32 {
  let m = ceil(x);
  return m - step(0.5, m - x);
}
fn _gpu_step_quotient(x: f32, k: f32) -> f32 {
  let q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) { return sign(x) * 1.17549435e-38; }
  let r = round(q);
  return select(q, r, abs(q - r) <= 4.8e-7 * abs(q));
}
fn _gpu_half_step_quotient(x: f32, k: f32) -> f32 {
  let q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) { return sign(x) * 1.17549435e-38; }
  let r = round(q * 2.0) * 0.5;
  return select(q, r, abs(q - r) <= 4.8e-7 * abs(q));
}
fn _gpu_step_fix(m: f32, x: f32, k: f32) -> f32 {
  return select(m, x, k != 0.0 && abs(x / k) > 3.4e38);
}
`;
