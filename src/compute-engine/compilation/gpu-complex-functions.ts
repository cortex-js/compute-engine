// The table of complex-valued shader functions and the preamble built from it.

/**
 * Per-function complex arithmetic definitions with dependency metadata.
 *
 * Each entry maps a helper function name to its GLSL source, WGSL source,
 * and the list of other helper functions it calls. The preamble builder
 * uses this to emit only the functions actually referenced by compiled code,
 * in topological (dependency) order.
 *
 * Addition, subtraction, negation, and scalar multiplication use native
 * vec2 operators and do not need helper functions.
 */
interface ComplexFunctionDef {
  glsl: string;
  wgsl: string;
  deps: string[];
}

/**
 * The first statements of a complex shader helper whose operand `v` (a
 * `vec2`) may have a NaN part: return the first NaN part in both
 * components. On Apple GPUs (WebGL2 over ANGLE Metal, WebGPU over Metal) the
 * built-ins `sin` and `cos` of a NaN give 0, so `exp(z) = e^x (cos y, sin y)`
 * with a NaN `y` gave `(0, 0)`, where the interpreter gives NaN (measured
 * for `exp`, `sin`, `cos`, `sinh` and `cosh`). The test reads the bits (the
 * NaN test of `gpuNaNSafeLibrary`, written out because the complex helpers
 * are placed before that library in the preamble), and the NaN is returned
 * by selection, with no arithmetic, because WGSL refuses a NaN produced by a
 * constant expression.
 */
function gpuNaNPartGuard(v: string, isWGSL: boolean): string {
  return ['x', 'y']
    .map((p) =>
      isWGSL
        ? `if ((bitcast<u32>(${v}.${p}) & 0x7FFFFFFFu) > 0x7F800000u) { return vec2f(${v}.${p}); }`
        : `if ((floatBitsToUint(${v}.${p}) & 0x7FFFFFFFu) > 0x7F800000u) return vec2(${v}.${p});`
    )
    .join('\n  ');
}

// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const GPU_COMPLEX_FUNCTIONS: Record<string, ComplexFunctionDef> = {
  __proto__: null as never,
  _gpu_cmul: {
    deps: [],
    glsl: `vec2 _gpu_cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
    wgsl: `fn _gpu_cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
  },
  _gpu_cdiv: {
    deps: [],
    glsl: `vec2 _gpu_cdiv(vec2 a, vec2 b) {
  float d = b.x * b.x + b.y * b.y;
  return vec2((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
    wgsl: `fn _gpu_cdiv(a: vec2f, b: vec2f) -> vec2f {
  let d = b.x * b.x + b.y * b.y;
  return vec2f((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
  },
  _gpu_cexp: {
    deps: [],
    glsl: `vec2 _gpu_cexp(vec2 z) {
  ${gpuNaNPartGuard('z', false)}
  float e = exp(z.x);
  return vec2(e * cos(z.y), e * sin(z.y));
}`,
    wgsl: `fn _gpu_cexp(z: vec2f) -> vec2f {
  ${gpuNaNPartGuard('z', true)}
  let e = exp(z.x);
  return vec2f(e * cos(z.y), e * sin(z.y));
}`,
  },
  _gpu_cln: {
    deps: [],
    glsl: `vec2 _gpu_cln(vec2 z) {
  ${gpuNaNPartGuard('z', false)}
  return vec2(log(length(z)), atan(z.y, z.x));
}`,
    wgsl: `fn _gpu_cln(z: vec2f) -> vec2f {
  ${gpuNaNPartGuard('z', true)}
  return vec2f(log(length(z)), atan2(z.y, z.x));
}`,
  },
  // `z^w` is `exp(w · ln z)`. At `z = 0`, `ln z` is `(−∞, 0)`, and the
  // product with `w` has the imaginary part `w.x · 0 + w.y · (−∞)`, which is
  // NaN even when `w.y` is 0 (`0 · −∞`). The interpreter answers 0 for
  // `0^w` when the real part of `w` is positive (`Root(0, n)` for a positive
  // degree `n`, `0^(1/2 + i)`), so that case is answered first. For any
  // other `w`, the interpreter has no finite value, and the formula answers
  // NaN.
  _gpu_cpow: {
    deps: ['_gpu_cexp', '_gpu_cmul', '_gpu_cln'],
    glsl: `vec2 _gpu_cpow(vec2 z, vec2 w) {
  if (z.x == 0.0 && z.y == 0.0 && w.x > 0.0) return vec2(0.0);
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
    wgsl: `fn _gpu_cpow(z: vec2f, w: vec2f) -> vec2f {
  if (z.x == 0.0 && z.y == 0.0 && w.x > 0.0) { return vec2f(0.0); }
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
  },
  // `z^e` for a real exponent `e` whose recovered rational has an odd
  // denominator, decided when the shader is generated
  // (`BaseCompiler.negativeBaseFloatPower`): a negative real `z` has the real
  // root `s·|z|^e` (`s` is `−1.0` for an odd numerator), as in the
  // interpreter, and any other `z` the principal value.
  _gpu_cpowrr: {
    deps: ['_gpu_cpow'],
    glsl: `vec2 _gpu_cpowrr(vec2 z, float e, float s) {
  if (z.y == 0.0 && z.x < 0.0) return vec2(s * pow(-z.x, e), 0.0);
  return _gpu_cpow(z, vec2(e, 0.0));
}`,
    wgsl: `fn _gpu_cpowrr(z: vec2f, e: f32, s: f32) -> vec2f {
  if (z.y == 0.0 && z.x < 0.0) { return vec2f(s * pow(-z.x, e), 0.0); }
  return _gpu_cpow(z, vec2f(e, 0.0));
}`,
  },
  _gpu_csqrt: {
    deps: [],
    glsl: `vec2 _gpu_csqrt(vec2 z) {
  ${gpuNaNPartGuard('z', false)}
  float r = length(z);
  float theta = atan(z.y, z.x);
  return sqrt(r) * vec2(cos(theta * 0.5), sin(theta * 0.5));
}`,
    wgsl: `fn _gpu_csqrt(z: vec2f) -> vec2f {
  ${gpuNaNPartGuard('z', true)}
  let r = length(z);
  let theta = atan2(z.y, z.x);
  return sqrt(r) * vec2f(cos(theta * 0.5), sin(theta * 0.5));
}`,
  },
  _gpu_csin: {
    deps: [],
    glsl: `vec2 _gpu_csin(vec2 z) {
  ${gpuNaNPartGuard('z', false)}
  return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_csin(z: vec2f) -> vec2f {
  ${gpuNaNPartGuard('z', true)}
  return vec2f(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
  },
  _gpu_ccos: {
    deps: [],
    glsl: `vec2 _gpu_ccos(vec2 z) {
  ${gpuNaNPartGuard('z', false)}
  return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_ccos(z: vec2f) -> vec2f {
  ${gpuNaNPartGuard('z', true)}
  return vec2f(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
  },
  _gpu_ctan: {
    deps: ['_gpu_cdiv', '_gpu_csin', '_gpu_ccos'],
    glsl: `vec2 _gpu_ctan(vec2 z) {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
    wgsl: `fn _gpu_ctan(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
  },
  _gpu_csinh: {
    deps: [],
    glsl: `vec2 _gpu_csinh(vec2 z) {
  ${gpuNaNPartGuard('z', false)}
  return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_csinh(z: vec2f) -> vec2f {
  ${gpuNaNPartGuard('z', true)}
  return vec2f(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
  },
  _gpu_ccosh: {
    deps: [],
    glsl: `vec2 _gpu_ccosh(vec2 z) {
  ${gpuNaNPartGuard('z', false)}
  return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_ccosh(z: vec2f) -> vec2f {
  ${gpuNaNPartGuard('z', true)}
  return vec2f(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
  },
  _gpu_ctanh: {
    deps: ['_gpu_cdiv', '_gpu_csinh', '_gpu_ccosh'],
    glsl: `vec2 _gpu_ctanh(vec2 z) {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
    wgsl: `fn _gpu_ctanh(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
  },
  //
  // Inverse trigonometric and inverse hyperbolic functions of a complex value
  //
  // These kernels use the formulas of W. Kahan, "Branch Cuts for Complex
  // Elementary Functions, or Much Ado About Nothing's Sign Bit" (1987), as
  // the interpreter and the JavaScript target do (`complexAsin()` and the
  // others in `numerics/numeric-complex.ts`). The textbook logarithm
  // formulas (`asin z = −i·ln(iz + √(1 − z²))`) cancel on one side of the
  // plane and overflow when `z²` leaves the f32 range (about 3.4·10³⁸): in
  // f32 they gave `asin(1000)` a real part of 1.66 instead of π/2, and
  // `asin(10⁴)` a real part of π. The formulas below take a product of two
  // square roots in place of `√(1 − z²)`, so there is no cancellation, and
  // no overflow below `|z| ≈ 10³⁷`. Above that, a function uses its value at
  // `z/16`, whose logarithmic part differs by `ln 16` (2.7725887…).
  //
  // A shader cannot rely on the sign of a zero (WGSL does not keep it), so
  // the side of a branch cut is not read from a zero part. Each kernel
  // passes a third argument `s` (+1 or −1), the sign that a zero part
  // takes, and the kernels pick the same side as the interpreter:
  // - `asin`, `acos`, `atanh` on the real axis: the side below the axis for
  //   `x > 1`, the side above it for `x < −1` (`asin 2` is
  //   `π/2 − 1.317i`).
  // - `acosh` on the real axis (`x < 1`): the side above the axis
  //   (`acosh(−2)` is `1.317 + πi`).
  // - `asinh` on the imaginary axis: the side right of the axis for
  //   `y > 1`, left of it for `y < −1` (`asinh 2i` is `1.317 + (π/2)i`).
  // - `atan` on the imaginary axis: the side right of the axis for
  //   `y > 1`, left of it for `y < −1` (`atan 2i` is `π/2 + 0.549i`,
  //   `atan(−2i)` is `−π/2 − 0.549i`).
  //
  // `_gpu_chypot` is `√(x² + y²)` without an overflow of `x²`;
  // `_gpu_clog1p` is `ln(1 + x)` for `x ≥ 0`, accurate for a small `x`
  // (neither language has `log1p`, see below); `_gpu_casinhr` is `asinh` of a real
  // value, accurate for a small and a large value (a driver's `asinh` can
  // be the formula `ln(x + √(x² + 1))`, which loses a small value and
  // overflows for a large one); `_gpu_czsign` is the sign of `y`, with `s`
  // as the sign of a zero; `_gpu_csqrts` is the principal square root, with
  // `s` as the sign of a zero imaginary part (`√(−4 − 0i)` is `−2i`).
  //
  _gpu_chypot: {
    deps: [],
    glsl: `float _gpu_chypot(float x, float y) {
  float ax = abs(x);
  float ay = abs(y);
  float m = max(ax, ay);
  if (m == 0.0) return 0.0;
  float n = min(ax, ay) / m;
  return m * sqrt(1.0 + n * n);
}`,
    wgsl: `fn _gpu_chypot(x: f32, y: f32) -> f32 {
  let ax = abs(x);
  let ay = abs(y);
  let m = max(ax, ay);
  if (m == 0.0) { return 0.0; }
  let n = min(ax, ay) / m;
  return m * sqrt(1.0 + n * n);
}`,
  },
  // `ln(1 + x)` for `x ≥ 0` (every caller passes a non-negative value).
  // For `x < 0.5` it is `2·atanh(s)` with `s = x/(2 + x)`, from the series
  // `2s·(1 + s²/3 + s⁴/5 + … + s¹⁰/11)`: `s ≤ 0.2`, so the first omitted
  // term is below `0.04⁶/13 ≈ 3·10⁻¹⁰` of the value. The built-in `log` is
  // not used there: GLSL.std.450 and WGSL allow it an ABSOLUTE error of 2⁻²¹
  // on [0.5, 2], a relative error of 0.5% for `ln(1 + 10⁻⁴)`, and the
  // classic `log(u)·x/(u − 1)` correction depends on `(1 + x) − 1` not being
  // folded to `x` by a fast-math compiler. For `x ≥ 0.5`, `ln(1 + x) ≥ 0.4`
  // and `log` is accurate enough.
  _gpu_clog1p: {
    deps: [],
    glsl: `float _gpu_clog1p(float x) {
  if (x >= 0.5) return log(1.0 + x);
  float s = x / (2.0 + x);
  float t = s * s;
  return 2.0 * s * (1.0 + t * (0.3333333333333333 + t * (0.2 + t * (0.14285714285714285 + t * (0.1111111111111111 + t * 0.09090909090909091)))));
}`,
    wgsl: `fn _gpu_clog1p(x: f32) -> f32 {
  if (x >= 0.5) { return log(1.0 + x); }
  let s = x / (2.0 + x);
  let t = s * s;
  return 2.0 * s * (1.0 + t * (0.3333333333333333 + t * (0.2 + t * (0.14285714285714285 + t * (0.1111111111111111 + t * 0.09090909090909091)))));
}`,
  },
  _gpu_casinhr: {
    deps: ['_gpu_clog1p'],
    glsl: `float _gpu_casinhr(float v) {
  float a = abs(v);
  float r = a > 1.0e9 ? log(a) + 0.6931471805599453 : _gpu_clog1p(a + a * a / (1.0 + sqrt(1.0 + a * a)));
  return v < 0.0 ? -r : r;
}`,
    wgsl: `fn _gpu_casinhr(v: f32) -> f32 {
  let a = abs(v);
  let r = select(_gpu_clog1p(a + a * a / (1.0 + sqrt(1.0 + a * a))), log(a) + 0.6931471805599453, a > 1.0e9);
  return select(r, -r, v < 0.0);
}`,
  },
  _gpu_czsign: {
    deps: [],
    glsl: `float _gpu_czsign(float y, float s) {
  return (y < 0.0 || (y == 0.0 && s < 0.0)) ? -1.0 : 1.0;
}`,
    wgsl: `fn _gpu_czsign(y: f32, s: f32) -> f32 {
  return select(1.0, -1.0, y < 0.0 || (y == 0.0 && s < 0.0));
}`,
  },
  _gpu_csqrts: {
    deps: ['_gpu_chypot', '_gpu_czsign'],
    glsl: `vec2 _gpu_csqrts(float x, float y, float s) {
  if (x == 0.0 && y == 0.0) return vec2(0.0);
  float h = _gpu_chypot(x, y);
  if (x >= 0.0) {
    float t = sqrt(0.5 * x + 0.5 * h);
    return vec2(t, y / (2.0 * t));
  }
  float t = sqrt(0.5 * h - 0.5 * x);
  return vec2(abs(y) / (2.0 * t), _gpu_czsign(y, s) * t);
}`,
    wgsl: `fn _gpu_csqrts(x: f32, y: f32, s: f32) -> vec2f {
  if (x == 0.0 && y == 0.0) { return vec2f(0.0); }
  let h = _gpu_chypot(x, y);
  if (x >= 0.0) {
    let t = sqrt(0.5 * x + 0.5 * h);
    return vec2f(t, y / (2.0 * t));
  }
  let t = sqrt(0.5 * h - 0.5 * x);
  return vec2f(abs(y) / (2.0 * t), _gpu_czsign(y, s) * t);
}`,
  },
  // `asin(x + iy)`, with `s` the sign of a zero `y`.
  // Re: atan2(x, Re(√(1 − z)·√(1 + z))).
  // Im: asinh(Im(conj(√(1 − z))·√(1 + z))).
  _gpu_casin_core: {
    deps: ['_gpu_csqrts', '_gpu_casinhr'],
    glsl: `vec2 _gpu_casin_core(float x0, float y0, float s) {
  float x = x0;
  float y = y0;
  float k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  vec2 a = _gpu_csqrts(1.0 - x, -y, -s);
  vec2 b = _gpu_csqrts(1.0 + x, y, s);
  float im = _gpu_casinhr(a.x * b.y - a.y * b.x);
  return vec2(atan(x, a.x * b.x - a.y * b.y), im < 0.0 ? im - k : im + k);
}`,
    wgsl: `fn _gpu_casin_core(x0: f32, y0: f32, s: f32) -> vec2f {
  var x = x0;
  var y = y0;
  var k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  let a = _gpu_csqrts(1.0 - x, -y, -s);
  let b = _gpu_csqrts(1.0 + x, y, s);
  let im = _gpu_casinhr(a.x * b.y - a.y * b.x);
  return vec2f(atan2(x, a.x * b.x - a.y * b.y), select(im + k, im - k, im < 0.0));
}`,
  },
  _gpu_casin: {
    deps: ['_gpu_casin_core'],
    glsl: `vec2 _gpu_casin(vec2 z) {
  return _gpu_casin_core(z.x, z.y, z.x > 0.0 ? -1.0 : 1.0);
}`,
    wgsl: `fn _gpu_casin(z: vec2f) -> vec2f {
  return _gpu_casin_core(z.x, z.y, select(1.0, -1.0, z.x > 0.0));
}`,
  },
  // Re: 2·atan2(Re √(1 − z), Re √(1 + z)).
  // Im: asinh(Im(conj(√(1 + z))·√(1 − z))).
  _gpu_cacos: {
    deps: ['_gpu_csqrts', '_gpu_casinhr'],
    glsl: `vec2 _gpu_cacos(vec2 z) {
  float x = z.x;
  float y = z.y;
  float k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  float s = z.x > 0.0 ? -1.0 : 1.0;
  vec2 a = _gpu_csqrts(1.0 - x, -y, -s);
  vec2 b = _gpu_csqrts(1.0 + x, y, s);
  float im = _gpu_casinhr(b.x * a.y - b.y * a.x);
  return vec2(2.0 * atan(a.x, b.x), im < 0.0 ? im - k : im + k);
}`,
    wgsl: `fn _gpu_cacos(z: vec2f) -> vec2f {
  var x = z.x;
  var y = z.y;
  var k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  let s = select(1.0, -1.0, z.x > 0.0);
  let a = _gpu_csqrts(1.0 - x, -y, -s);
  let b = _gpu_csqrts(1.0 + x, y, s);
  let im = _gpu_casinhr(b.x * a.y - b.y * a.x);
  return vec2f(2.0 * atan2(a.x, b.x), select(im + k, im - k, im < 0.0));
}`,
  },
  // `atanh(x + iy)`, with `s` the sign of a zero `y`.
  // Re: ¼·ln(1 + 4|x|/|1 − |x| − iy|²), with the sign of x.
  // Im: ½·atan2(2y, (1 − x)(1 + x) − y²).
  // For |z| > 10¹⁸, where |z|² could overflow, the value is 1/z to a
  // relative error of about 1/|z|²: the real part is x/|z|², the imaginary
  // part ½·atan2(2y/|z|², −1), and |z|/4 (`h4`) is used in place of |z|.
  // When |1 − z|² is below 10⁻³⁰ (z very close to ±1), the real part is the
  // difference of two logarithms, which has no cancellation there.
  _gpu_catanh_core: {
    deps: ['_gpu_chypot', '_gpu_clog1p', '_gpu_czsign'],
    glsl: `vec2 _gpu_catanh_core(float x, float y, float s) {
  if (_gpu_chypot(x, y) > 1.0e18) {
    float h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    float q = y / 8.0 / h4 / h4;
    return vec2(x / 16.0 / h4 / h4, q == 0.0 ? _gpu_czsign(y, s) * 1.5707963267948966 : 0.5 * atan(q, -1.0));
  }
  float ax = abs(x);
  float u = 1.0 - ax;
  float d = u * u + y * y;
  float re = d < 1.0e-30 ? 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))) : 0.25 * _gpu_clog1p(4.0 * ax / d);
  float m = u * (1.0 + ax) - y * y;
  float im = 2.0 * y == 0.0 ? (m < 0.0 ? _gpu_czsign(y, s) * 1.5707963267948966 : 0.0) : 0.5 * atan(2.0 * y, m);
  return vec2(x < 0.0 ? -re : re, im);
}`,
    wgsl: `fn _gpu_catanh_core(x: f32, y: f32, s: f32) -> vec2f {
  if (_gpu_chypot(x, y) > 1.0e18) {
    let h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    let q = y / 8.0 / h4 / h4;
    return vec2f(x / 16.0 / h4 / h4, select(0.5 * atan2(q, -1.0), _gpu_czsign(y, s) * 1.5707963267948966, q == 0.0));
  }
  let ax = abs(x);
  let u = 1.0 - ax;
  let d = u * u + y * y;
  let re = select(0.25 * _gpu_clog1p(4.0 * ax / d), 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))), d < 1.0e-30);
  let m = u * (1.0 + ax) - y * y;
  let im = select(0.5 * atan2(2.0 * y, m), select(0.0, _gpu_czsign(y, s) * 1.5707963267948966, m < 0.0), 2.0 * y == 0.0);
  return vec2f(select(re, -re, x < 0.0), im);
}`,
  },
  _gpu_catanh: {
    deps: ['_gpu_catanh_core'],
    glsl: `vec2 _gpu_catanh(vec2 z) {
  return _gpu_catanh_core(z.x, z.y, z.x > 0.0 ? -1.0 : 1.0);
}`,
    wgsl: `fn _gpu_catanh(z: vec2f) -> vec2f {
  return _gpu_catanh_core(z.x, z.y, select(1.0, -1.0, z.x > 0.0));
}`,
  },
  // atan z = −i·atanh(iz), with iz = −y + ix. A zero x takes the sign of y:
  // the side right of the imaginary axis for y > 1, left of it for y < −1
  // (`atan(−2i)` is `−π/2 − 0.549i`, so atan is odd on the cut). At the
  // poles ±i the interpreter gives the unsigned infinity `~oo`, which a
  // `vec2` holds as `(∞, ∞)`, as the JavaScript target does (`complexPole()`
  // in `javascript-target.ts`).
  _gpu_catan: {
    deps: ['_gpu_catanh_core', '_gpu_inf'],
    glsl: `vec2 _gpu_catan(vec2 z) {
  if (z.x == 0.0 && abs(z.y) == 1.0) return vec2(_gpu_inf(), _gpu_inf());
  vec2 r = _gpu_catanh_core(-z.y, z.x, z.y < 0.0 ? -1.0 : 1.0);
  return vec2(r.y, -r.x);
}`,
    wgsl: `fn _gpu_catan(z: vec2f) -> vec2f {
  if (z.x == 0.0 && abs(z.y) == 1.0) { return vec2f(_gpu_inf(), _gpu_inf()); }
  let r = _gpu_catanh_core(-z.y, z.x, select(1.0, -1.0, z.y < 0.0));
  return vec2f(r.y, -r.x);
}`,
  },
  // asinh z = −i·asin(iz), with iz = −y + ix. A zero x takes the sign of y:
  // the side right of the imaginary axis for y > 1, left of it for y < −1.
  _gpu_casinh: {
    deps: ['_gpu_casin_core'],
    glsl: `vec2 _gpu_casinh(vec2 z) {
  vec2 r = _gpu_casin_core(-z.y, z.x, z.y < 0.0 ? -1.0 : 1.0);
  return vec2(r.y, -r.x);
}`,
    wgsl: `fn _gpu_casinh(z: vec2f) -> vec2f {
  let r = _gpu_casin_core(-z.y, z.x, select(1.0, -1.0, z.y < 0.0));
  return vec2f(r.y, -r.x);
}`,
  },
  // Re: asinh(Re(conj(√(z − 1))·√(z + 1))).
  // Im: 2·atan2(Im √(z − 1), Re √(z + 1)).
  // A zero y takes the sign +1: the side above the real axis.
  _gpu_cacosh: {
    deps: ['_gpu_csqrts', '_gpu_casinhr'],
    glsl: `vec2 _gpu_cacosh(vec2 z) {
  float x = z.x;
  float y = z.y;
  float k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  vec2 a = _gpu_csqrts(x - 1.0, y, 1.0);
  vec2 b = _gpu_csqrts(x + 1.0, y, 1.0);
  return vec2(_gpu_casinhr(a.x * b.x + a.y * b.y) + k, 2.0 * atan(a.y, b.x));
}`,
    wgsl: `fn _gpu_cacosh(z: vec2f) -> vec2f {
  var x = z.x;
  var y = z.y;
  var k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  let a = _gpu_csqrts(x - 1.0, y, 1.0);
  let b = _gpu_csqrts(x + 1.0, y, 1.0);
  return vec2f(_gpu_casinhr(a.x * b.x + a.y * b.y) + k, 2.0 * atan2(a.y, b.x));
}`,
  },
  // `1/z` by Smith's method: the quotient is formed from the ratio of the
  // smaller part to the larger, so `|z|²` is never computed and does not
  // overflow for |z| above 1.8·10¹⁹ (`_gpu_cdiv` forms `|z|²`). The inverse
  // reciprocal functions (`_gpu_cacsc`, `_gpu_casec`, `_gpu_casech`) use it.
  _gpu_cinv: {
    deps: [],
    glsl: `vec2 _gpu_cinv(vec2 z) {
  if (abs(z.x) >= abs(z.y)) {
    float r = z.y / z.x;
    float d = z.x + z.y * r;
    return vec2(1.0 / d, -r / d);
  }
  float r = z.x / z.y;
  float d = z.x * r + z.y;
  return vec2(r / d, -1.0 / d);
}`,
    wgsl: `fn _gpu_cinv(z: vec2f) -> vec2f {
  if (abs(z.x) >= abs(z.y)) {
    let r = z.y / z.x;
    let d = z.x + z.y * r;
    return vec2f(1.0 / d, -r / d);
  }
  let r = z.x / z.y;
  let d = z.x * r + z.y;
  return vec2f(r / d, -1.0 / d);
}`,
  },
  //
  // The inverse reciprocal functions: arccsc z = asin(1/z),
  // arcsec z = acos(1/z), arsech z = acosh(1/z), arcoth z = atanh(1/z).
  //
  // They use the formulas of `asin`, `acos`, `acosh` and `atanh` above, but
  // they do not compute `w = 1/z` and then `1 ± w`: near a branch point
  // (`z = ±1`), `1 ± w` cancels and the rounding of `1/z` is amplified. For
  // `|z| ≤ 2`, `1 ± w` is computed as `(z ± 1)·(1/z)`, where `z ± 1` is
  // exact or nearly so; for `|z| > 2`, `|w| < 1/2` and `1 ± w` does not
  // cancel. This is the method of the interpreter (`complexAcsc()` and the
  // others in `numerics/numeric-complex.ts`). `arcoth` is computed from `z`
  // directly, as `½·ln((z + 1)/(z − 1))`.
  //
  // The side of each branch cut is the interpreter's: for a real `z`, the
  // side the function of `w` takes for the real `w = 1/z` (`arccsc 0.5` is
  // `asin 2`, `π/2 − 1.317i`; `arsech(−0.5)` is `1.317 + πi`; `arcoth 0.5`
  // is `0.549 − (π/2)i`, `arcoth(−0.5)` is `−0.549 + (π/2)i`). For a
  // non-real `z`, a part of `1 ± w` that rounds to zero takes the sign of
  // that part of `w`, whose imaginary part has the sign of `−Im z`.
  //
  // For `|z| < 10⁻¹⁸`, `1/z` can overflow (above 3.4·10³⁸ for a subnormal
  // `|z|`), and `arccsc`, `arcsec` and `arsech` use the first term of their
  // expansion at `w = 1/z = ∞`, whose relative error is about `|z|²`. With
  // `l = ln(2/|z|)` and `s` the sign of a zero imaginary part of `w` (see
  // below): `arccsc z = atan2(x, |y|) + s·l·i`,
  // `arcsec z = atan2(|y|, x) − s·l·i`, and
  // `arsech z = l − arg(z)·i`, with `π` in place of `−π` on the negative
  // real axis. `arsech 0` is `+∞`, as in the interpreter.
  // `_gpu_cln2z(z)` is `l`; `z` is scaled by 2⁶⁴ (exactly) before the
  // logarithm so that a subnormal `|z|` keeps its digits.
  _gpu_cln2z: {
    deps: ['_gpu_chypot'],
    glsl: `float _gpu_cln2z(vec2 z) {
  return 45.054566736396445 - log(_gpu_chypot(z.x * 18446744073709551616.0, z.y * 18446744073709551616.0));
}`,
    wgsl: `fn _gpu_cln2z(z: vec2f) -> f32 {
  return 45.054566736396445 - log(_gpu_chypot(z.x * 18446744073709551616.0, z.y * 18446744073709551616.0));
}`,
  },
  // `_gpu_cinvpm(z, t)` is `1 + t/z`, for `t` = ±1.
  _gpu_cinvpm: {
    deps: ['_gpu_cinv', '_gpu_chypot'],
    glsl: `vec2 _gpu_cinvpm(vec2 z, float t) {
  vec2 w = _gpu_cinv(z);
  if (_gpu_chypot(z.x, z.y) > 2.0) return vec2(1.0 + t * w.x, t * w.y);
  float nx = z.x + t;
  return vec2(nx * w.x - z.y * w.y, nx * w.y + z.y * w.x);
}`,
    wgsl: `fn _gpu_cinvpm(z: vec2f, t: f32) -> vec2f {
  let w = _gpu_cinv(z);
  if (_gpu_chypot(z.x, z.y) > 2.0) { return vec2f(1.0 + t * w.x, t * w.y); }
  let nx = z.x + t;
  return vec2f(nx * w.x - z.y * w.y, nx * w.y + z.y * w.x);
}`,
  },
  // asin(w): Re atan2(Re w, Re(√(1 − w)·√(1 + w))),
  // Im asinh(Im(conj(√(1 − w))·√(1 + w))). `s` is the sign of a zero
  // imaginary part of `w`.
  _gpu_cacsc: {
    deps: [
      '_gpu_cinv',
      '_gpu_cinvpm',
      '_gpu_csqrts',
      '_gpu_casinhr',
      '_gpu_cln2z',
    ],
    glsl: `vec2 _gpu_cacsc(vec2 z) {
  float s = z.y == 0.0 ? (z.x > 0.0 ? -1.0 : 1.0) : (z.y > 0.0 ? -1.0 : 1.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) return vec2(atan(z.x, abs(z.y)), s * _gpu_cln2z(z));
  vec2 w = _gpu_cinv(z);
  vec2 p = _gpu_cinvpm(z, -1.0);
  vec2 q = _gpu_cinvpm(z, 1.0);
  vec2 a = _gpu_csqrts(p.x, p.y, -s);
  vec2 b = _gpu_csqrts(q.x, q.y, s);
  return vec2(atan(w.x, a.x * b.x - a.y * b.y), _gpu_casinhr(a.x * b.y - a.y * b.x));
}`,
    wgsl: `fn _gpu_cacsc(z: vec2f) -> vec2f {
  let s = select(select(1.0, -1.0, z.y > 0.0), select(1.0, -1.0, z.x > 0.0), z.y == 0.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) { return vec2f(atan2(z.x, abs(z.y)), s * _gpu_cln2z(z)); }
  let w = _gpu_cinv(z);
  let p = _gpu_cinvpm(z, -1.0);
  let q = _gpu_cinvpm(z, 1.0);
  let a = _gpu_csqrts(p.x, p.y, -s);
  let b = _gpu_csqrts(q.x, q.y, s);
  return vec2f(atan2(w.x, a.x * b.x - a.y * b.y), _gpu_casinhr(a.x * b.y - a.y * b.x));
}`,
  },
  // acos(w): Re 2·atan2(Re √(1 − w), Re √(1 + w)),
  // Im asinh(Im(conj(√(1 + w))·√(1 − w))).
  _gpu_casec: {
    deps: ['_gpu_cinvpm', '_gpu_csqrts', '_gpu_casinhr', '_gpu_cln2z'],
    glsl: `vec2 _gpu_casec(vec2 z) {
  float s = z.y == 0.0 ? (z.x > 0.0 ? -1.0 : 1.0) : (z.y > 0.0 ? -1.0 : 1.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) return vec2(atan(abs(z.y), z.x), -s * _gpu_cln2z(z));
  vec2 p = _gpu_cinvpm(z, -1.0);
  vec2 q = _gpu_cinvpm(z, 1.0);
  vec2 a = _gpu_csqrts(p.x, p.y, -s);
  vec2 b = _gpu_csqrts(q.x, q.y, s);
  return vec2(2.0 * atan(a.x, b.x), _gpu_casinhr(b.x * a.y - b.y * a.x));
}`,
    wgsl: `fn _gpu_casec(z: vec2f) -> vec2f {
  let s = select(select(1.0, -1.0, z.y > 0.0), select(1.0, -1.0, z.x > 0.0), z.y == 0.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) { return vec2f(atan2(abs(z.y), z.x), -s * _gpu_cln2z(z)); }
  let p = _gpu_cinvpm(z, -1.0);
  let q = _gpu_cinvpm(z, 1.0);
  let a = _gpu_csqrts(p.x, p.y, -s);
  let b = _gpu_csqrts(q.x, q.y, s);
  return vec2f(2.0 * atan2(a.x, b.x), _gpu_casinhr(b.x * a.y - b.y * a.x));
}`,
  },
  // acosh(w): Re asinh(Re(conj(√(w − 1))·√(w + 1))),
  // Im 2·atan2(Im √(w − 1), Re √(w + 1)). For a real z, a zero imaginary
  // part takes the sign +1: the side above the cut.
  _gpu_casech: {
    // `_gpu_inf` is not a complex helper: `preambleFor()` adds it, before
    // the complex helpers on GLSL, when a complex helper calls it.
    deps: [
      '_gpu_cinvpm',
      '_gpu_csqrts',
      '_gpu_casinhr',
      '_gpu_cln2z',
      '_gpu_inf',
    ],
    glsl: `vec2 _gpu_casech(vec2 z) {
  if (z.x == 0.0 && z.y == 0.0) return vec2(_gpu_inf(), 0.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18) return vec2(_gpu_cln2z(z), z.y == 0.0 && z.x < 0.0 ? 3.141592653589793 : -atan(z.y, z.x));
  float s = z.y > 0.0 ? -1.0 : 1.0;
  vec2 p = _gpu_cinvpm(z, -1.0);
  vec2 q = _gpu_cinvpm(z, 1.0);
  vec2 a = _gpu_csqrts(-p.x, -p.y, s);
  vec2 b = _gpu_csqrts(q.x, q.y, s);
  return vec2(_gpu_casinhr(a.x * b.x + a.y * b.y), 2.0 * atan(a.y, b.x));
}`,
    wgsl: `fn _gpu_casech(z: vec2f) -> vec2f {
  if (z.x == 0.0 && z.y == 0.0) { return vec2f(_gpu_inf(), 0.0); }
  if (_gpu_chypot(z.x, z.y) < 1.0e-18) { return vec2f(_gpu_cln2z(z), select(-atan2(z.y, z.x), 3.141592653589793, z.y == 0.0 && z.x < 0.0)); }
  let s = select(1.0, -1.0, z.y > 0.0);
  let p = _gpu_cinvpm(z, -1.0);
  let q = _gpu_cinvpm(z, 1.0);
  let a = _gpu_csqrts(-p.x, -p.y, s);
  let b = _gpu_csqrts(q.x, q.y, s);
  return vec2f(_gpu_casinhr(a.x * b.x + a.y * b.y), 2.0 * atan2(a.y, b.x));
}`,
  },
  // arcoth z = ½·ln((z + 1)/(z − 1)). Re: ¼·ln(1 + 4|x|/|1 − |x| − iy|²),
  // with the sign of x, as in `_gpu_catanh_core`. Im: ½·atan2(−2y,
  // x² + y² − 1); for a real z in (−1, 1), −π/2 when z > 0 and π/2
  // otherwise. For |z| > 10¹⁸ the value is 1/z to a relative error of about
  // 1/|z|², with |z|/4 (`h4`) in place of |z|.
  _gpu_cacoth: {
    deps: ['_gpu_chypot', '_gpu_clog1p'],
    glsl: `vec2 _gpu_cacoth(vec2 z) {
  float x = z.x;
  float y = z.y;
  if (_gpu_chypot(x, y) > 1.0e18) {
    float h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    return vec2(x / 16.0 / h4 / h4, -y / 16.0 / h4 / h4);
  }
  float ax = abs(x);
  float u = 1.0 - ax;
  float d = u * u + y * y;
  float re = d < 1.0e-30 ? 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))) : 0.25 * _gpu_clog1p(4.0 * ax / d);
  float m = (ax - 1.0) * (ax + 1.0) + y * y;
  float im = 2.0 * y == 0.0 ? (m < 0.0 ? (x > 0.0 ? -1.5707963267948966 : 1.5707963267948966) : 0.0) : 0.5 * atan(-2.0 * y, m);
  return vec2(x < 0.0 ? -re : re, im);
}`,
    wgsl: `fn _gpu_cacoth(z: vec2f) -> vec2f {
  let x = z.x;
  let y = z.y;
  if (_gpu_chypot(x, y) > 1.0e18) {
    let h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    return vec2f(x / 16.0 / h4 / h4, -y / 16.0 / h4 / h4);
  }
  let ax = abs(x);
  let u = 1.0 - ax;
  let d = u * u + y * y;
  let re = select(0.25 * _gpu_clog1p(4.0 * ax / d), 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))), d < 1.0e-30);
  let m = (ax - 1.0) * (ax + 1.0) + y * y;
  let im = select(0.5 * atan2(-2.0 * y, m), select(0.0, select(1.5707963267948966, -1.5707963267948966, x > 0.0), m < 0.0), 2.0 * y == 0.0);
  return vec2f(select(re, -re, x < 0.0), im);
}`,
  },
};

/**
 * Build a minimal complex preamble containing only the helper functions
 * actually referenced by `code`, plus their transitive dependencies,
 * emitted in topological (dependency-first) order.
 */
export function buildComplexPreamble(code: string, language: string): string {
  // 1. Find all _gpu_c* calls in the compiled code
  const needed = new Set<string>();
  for (const name of Object.keys(GPU_COMPLEX_FUNCTIONS)) {
    if (code.includes(name)) needed.add(name);
  }
  if (needed.size === 0) return '';

  // 2. Resolve transitive dependencies
  const resolved = new Set<string>();
  function resolve(name: string): void {
    if (resolved.has(name)) return;
    const def = GPU_COMPLEX_FUNCTIONS[name];
    if (!def) return;
    for (const dep of def.deps) resolve(dep);
    resolved.add(name);
  }
  for (const name of needed) resolve(name);

  // 3. `resolved` is already in topological order (deps before dependents)
  const lang = language === 'wgsl' ? 'wgsl' : 'glsl';
  const parts: string[] = [];
  for (const name of resolved) {
    parts.push(GPU_COMPLEX_FUNCTIONS[name][lang]);
  }
  return '\n' + parts.join('\n\n') + '\n';
}
