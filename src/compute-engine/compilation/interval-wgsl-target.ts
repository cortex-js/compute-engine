/**
 * WGSL interval arithmetic compilation target
 *
 * Compiles mathematical expressions to WGSL code using interval arithmetic
 * for reliable function evaluation in WebGPU shaders.
 *
 * Intervals are represented as vec2f(lo, hi).
 * Status flags use f32 constants for shader compatibility.
 *
 * Since WGSL does not support function overloading, internal vec2f-parameter
 * implementations use a `_v` suffix (e.g., `ia_add_v`), while the public
 * IntervalResult wrappers keep the base name (e.g., `ia_add`).
 *
 * @module compilation/interval-wgsl-target
 */

import type { Expression } from '../global-types';
import { isSymbol, isNumber } from '../boxed-expression/type-guards';

import { BaseCompiler } from './base-compiler';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types';

/**
 * WGSL interval library code.
 *
 * This is prepended to compiled shaders to provide interval arithmetic functions.
 * Uses vec2f for intervals and f32 status flags.
 *
 * Naming convention (no overloading in WGSL):
 *   _v  suffix  = vec2f parameters
 *   _rv suffix  = (IntervalResult, vec2f)
 *   _vr suffix  = (vec2f, IntervalResult)
 *   no suffix   = IntervalResult parameters (called by compiled code)
 */
const WGSL_INTERVAL_LIBRARY = `
// Interval Arithmetic Library for WGSL
// Intervals are represented as vec2f(lo, hi)
// Results use IntervalResult struct with status flags

// Status constants
const IA_NORMAL: f32 = 0.0;
const IA_EMPTY: f32 = 1.0;
const IA_ENTIRE: f32 = 2.0;
const IA_SINGULAR: f32 = 3.0;
const IA_PARTIAL_LO: f32 = 4.0;
const IA_PARTIAL_HI: f32 = 5.0;
const IA_PARTIAL_BOTH: f32 = 6.0;
const IA_SINGULAR_RIGHT: f32 = 7.0;
const IA_SINGULAR_LEFT: f32 = 8.0;

// Interval result struct
struct IntervalResult {
  value: vec2f,
  status: f32,
}

// Epsilon for conservative bounds
const IA_EPS: f32 = 1e-6;
const IA_HUGE: f32 = 1e38;

// Create a point interval
fn ia_point(x: f32) -> IntervalResult {
  return IntervalResult(vec2f(x, x), IA_NORMAL);
}

// Create interval result
fn ia_ok(v: vec2f) -> IntervalResult {
  return IntervalResult(v, IA_NORMAL);
}

fn ia_empty() -> IntervalResult {
  return IntervalResult(vec2f(0.0), IA_EMPTY);
}

fn ia_entire() -> IntervalResult {
  return IntervalResult(vec2f(-IA_HUGE, IA_HUGE), IA_ENTIRE);
}

fn ia_singular(at: f32) -> IntervalResult {
  return IntervalResult(vec2f(at, at), IA_SINGULAR);
}

fn ia_singular_right(at: f32) -> IntervalResult {
  return IntervalResult(vec2f(at, at), IA_SINGULAR_RIGHT);
}

fn ia_singular_left(at: f32) -> IntervalResult {
  return IntervalResult(vec2f(at, at), IA_SINGULAR_LEFT);
}

fn ia_partial(v: vec2f, clip: f32) -> IntervalResult {
  return IntervalResult(v, clip);
}

fn ia_is_error(status: f32) -> bool {
  return status == IA_EMPTY || status == IA_ENTIRE || status == IA_SINGULAR || status == IA_SINGULAR_RIGHT || status == IA_SINGULAR_LEFT;
}

// Addition (vec2f)
fn ia_add_v(a: vec2f, b: vec2f) -> IntervalResult {
  return ia_ok(vec2f(a.x + b.x - IA_EPS, a.y + b.y + IA_EPS));
}

// Subtraction (vec2f)
fn ia_sub_v(a: vec2f, b: vec2f) -> IntervalResult {
  return ia_ok(vec2f(a.x - b.y - IA_EPS, a.y - b.x + IA_EPS));
}

// Negation (vec2f)
fn ia_negate_v(x: vec2f) -> IntervalResult {
  return ia_ok(vec2f(-x.y, -x.x));
}

// Multiplication helper (returns vec2f)
fn ia_mul_raw(a: vec2f, b: vec2f) -> vec2f {
  let p1 = a.x * b.x;
  let p2 = a.x * b.y;
  let p3 = a.y * b.x;
  let p4 = a.y * b.y;
  return vec2f(
    min(min(p1, p2), min(p3, p4)) - IA_EPS,
    max(max(p1, p2), max(p3, p4)) + IA_EPS
  );
}

// Multiplication (vec2f)
fn ia_mul_v(a: vec2f, b: vec2f) -> IntervalResult {
  return ia_ok(ia_mul_raw(a, b));
}

// Division (vec2f)
fn ia_div_v(a: vec2f, b: vec2f) -> IntervalResult {
  // Case 1: Divisor entirely positive or negative
  if (b.x > 0.0 || b.y < 0.0) {
    return ia_ok(ia_mul_raw(a, vec2f(1.0 / b.y, 1.0 / b.x)));
  }

  // Case 2: Divisor strictly contains zero
  if (b.x < 0.0 && b.y > 0.0) {
    return ia_singular(0.0);
  }

  // Case 3: Divisor touches zero at lower bound [0, c]
  if (b.x == 0.0 && b.y > 0.0) {
    if (a.x >= 0.0) {
      return ia_partial(vec2f(a.x / b.y, IA_HUGE), IA_PARTIAL_HI);
    } else if (a.y <= 0.0) {
      return ia_partial(vec2f(-IA_HUGE, a.y / b.y), IA_PARTIAL_LO);
    } else {
      return ia_entire();
    }
  }

  // Case 4: Divisor touches zero at upper bound [c, 0]
  if (b.y == 0.0 && b.x < 0.0) {
    if (a.x >= 0.0) {
      return ia_partial(vec2f(-IA_HUGE, a.x / b.x), IA_PARTIAL_LO);
    } else if (a.y <= 0.0) {
      return ia_partial(vec2f(a.y / b.x, IA_HUGE), IA_PARTIAL_HI);
    } else {
      return ia_entire();
    }
  }

  // Case 5: Divisor is [0, 0]
  return ia_empty();
}

// Square root (vec2f)
fn ia_sqrt_v(x: vec2f) -> IntervalResult {
  if (x.y < 0.0) {
    return ia_empty();
  }
  if (x.x >= 0.0) {
    return ia_ok(vec2f(sqrt(x.x), sqrt(x.y) + IA_EPS));
  }
  return ia_partial(vec2f(0.0, sqrt(x.y) + IA_EPS), IA_PARTIAL_LO);
}

// Square (vec2f)
fn ia_square_v(x: vec2f) -> IntervalResult {
  if (x.x >= 0.0) {
    return ia_ok(vec2f(x.x * x.x - IA_EPS, x.y * x.y + IA_EPS));
  } else if (x.y <= 0.0) {
    return ia_ok(vec2f(x.y * x.y - IA_EPS, x.x * x.x + IA_EPS));
  } else {
    let m = max(-x.x, x.y);
    return ia_ok(vec2f(0.0, m * m + IA_EPS));
  }
}

// Exponential (vec2f)
fn ia_exp_v(x: vec2f) -> IntervalResult {
  return ia_ok(vec2f(exp(x.x) - IA_EPS, exp(x.y) + IA_EPS));
}

// Natural logarithm (vec2f)
fn ia_ln_v(x: vec2f) -> IntervalResult {
  if (x.y <= 0.0) {
    return ia_empty();
  }
  if (x.x > 0.0) {
    return ia_ok(vec2f(log(x.x) - IA_EPS, log(x.y) + IA_EPS));
  }
  return ia_partial(vec2f(-IA_HUGE, log(x.y) + IA_EPS), IA_PARTIAL_LO);
}

// Log base 2 (vec2f)
fn ia_log2_v(x: vec2f) -> IntervalResult {
  if (x.y <= 0.0) { return ia_empty(); }
  if (x.x > 0.0) { return ia_ok(vec2f(log2(x.x) - IA_EPS, log2(x.y) + IA_EPS)); }
  return ia_partial(vec2f(-IA_HUGE, log2(x.y) + IA_EPS), IA_PARTIAL_LO);
}

// Log base 10 (vec2f)
fn ia_log10_v(x: vec2f) -> IntervalResult {
  const INV_LN10: f32 = 0.43429448190;
  if (x.y <= 0.0) { return ia_empty(); }
  if (x.x > 0.0) { return ia_ok(vec2f(log(x.x) * INV_LN10 - IA_EPS, log(x.y) * INV_LN10 + IA_EPS)); }
  return ia_partial(vec2f(-IA_HUGE, log(x.y) * INV_LN10 + IA_EPS), IA_PARTIAL_LO);
}

// Absolute value (vec2f)
fn ia_abs_v(x: vec2f) -> IntervalResult {
  if (x.x >= 0.0) {
    return ia_ok(x);
  }
  if (x.y <= 0.0) {
    return ia_ok(vec2f(-x.y, -x.x));
  }
  return ia_ok(vec2f(0.0, max(-x.x, x.y)));
}

// Sign function (vec2f)
fn ia_sign_v(x: vec2f) -> IntervalResult {
  if (x.x > 0.0) { return ia_ok(vec2f(1.0, 1.0)); }
  if (x.y < 0.0) { return ia_ok(vec2f(-1.0, -1.0)); }
  if (x.x == 0.0 && x.y == 0.0) { return ia_ok(vec2f(0.0, 0.0)); }
  return ia_singular(0.0);
}

// Floor (vec2f)
fn ia_floor_v(x: vec2f) -> IntervalResult {
  let flo = floor(x.x);
  let fhi = floor(x.y);
  if (flo == fhi) {
    return ia_ok(vec2f(flo, fhi));
  }
  return ia_singular_right(flo + 1.0);
}

// Ceiling (vec2f)
fn ia_ceil_v(x: vec2f) -> IntervalResult {
  let clo = ceil(x.x);
  let chi = ceil(x.y);
  if (clo == chi) {
    return ia_ok(vec2f(clo, chi));
  }
  return ia_singular_left(clo);
}

// Round (vec2f)
fn ia_round_v(x: vec2f) -> IntervalResult {
  let rlo = round(x.x);
  let rhi = round(x.y);
  if (rlo == rhi) {
    return ia_ok(vec2f(rlo, rhi));
  }
  return ia_singular_right(rlo + 0.5);
}

// Fract (vec2f)
fn ia_fract_v(x: vec2f) -> IntervalResult {
  let flo = floor(x.x);
  let fhi = floor(x.y);
  if (flo == fhi) {
    return ia_ok(vec2f(fract(x.x) - IA_EPS, fract(x.y) + IA_EPS));
  }
  return ia_singular_right(flo + 1.0);
}

// Truncate (vec2f)
fn ia_trunc_v(x: vec2f) -> IntervalResult {
  let tlo = trunc(x.x);
  let thi = trunc(x.y);
  if (tlo == thi) { return ia_ok(vec2f(tlo, thi)); }
  if (x.x >= 0.0) { return ia_singular_right(tlo + 1.0); }
  let firstInt = ceil(x.x);
  if (firstInt != 0.0) { return ia_singular_left(firstInt); }
  return ia_singular_right(1.0);
}

// Mod (vec2f)
fn ia_mod_v(x: vec2f, y: vec2f) -> IntervalResult {
  if (y.x <= 0.0 && y.y >= 0.0) {
    return ia_singular(0.0);
  }

  if (y.x == y.y) {
    let period = abs(y.x);
    let flo = floor(x.x / period);
    let fhi = floor(x.y / period);
    if (flo == fhi) {
      let mlo = x.x - period * flo;
      let mhi = x.y - period * flo;
      return ia_ok(vec2f(min(mlo, mhi) - IA_EPS, max(mlo, mhi) + IA_EPS));
    }
    return ia_singular_right((flo + 1.0) * period);
  }

  let q = ia_div_v(x, y);
  if (ia_is_error(q.status)) { return q; }
  let fq = ia_floor_v(q.value);
  if (ia_is_error(fq.status)) { return fq; }
  return ia_sub_v(x, ia_mul_raw(y, fq.value));
}

// IEEE remainder (vec2f)
fn ia_remainder_v(a: vec2f, b: vec2f) -> IntervalResult {
  let q = ia_div_v(a, b);
  if (ia_is_error(q.status)) { return q; }
  let rq = ia_round_v(q.value);
  if (ia_is_error(rq.status)) { return rq; }
  return ia_sub_v(a, ia_mul_raw(b, rq.value));
}

// Min of two intervals (vec2f)
fn ia_min_v(a: vec2f, b: vec2f) -> IntervalResult {
  return ia_ok(vec2f(min(a.x, b.x), min(a.y, b.y)));
}

// Max of two intervals (vec2f)
fn ia_max_v(a: vec2f, b: vec2f) -> IntervalResult {
  return ia_ok(vec2f(max(a.x, b.x), max(a.y, b.y)));
}

// Power with constant exponent (vec2f base)
fn ia_pow_v(base: vec2f, e: f32) -> IntervalResult {
  if (e == 0.0) { return ia_ok(vec2f(1.0, 1.0)); }
  if (e == 1.0) { return ia_ok(base); }
  if (e == 2.0) { return ia_square_v(base); }
  if (e == 0.5) { return ia_sqrt_v(base); }

  if (base.y < 0.0) {
    return ia_empty();
  }
  if (base.x < 0.0) {
    if (e > 0.0) {
      return ia_partial(vec2f(0.0, pow(base.y, e) + IA_EPS), IA_PARTIAL_LO);
    } else {
      return ia_partial(vec2f(pow(base.y, e) - IA_EPS, IA_HUGE), IA_PARTIAL_LO);
    }
  }

  if (e > 0.0) {
    return ia_ok(vec2f(pow(base.x, e) - IA_EPS, pow(base.y, e) + IA_EPS));
  } else {
    if (base.x == 0.0) {
      return ia_partial(vec2f(pow(base.y, e) - IA_EPS, IA_HUGE), IA_PARTIAL_HI);
    }
    return ia_ok(vec2f(pow(base.y, e) - IA_EPS, pow(base.x, e) + IA_EPS));
  }
}

// Check if interval contains extremum
fn ia_contains_extremum(x: vec2f, extremum: f32, period: f32) -> bool {
  let n = ceil((x.x - extremum) / period);
  let candidate = extremum + n * period;
  return candidate >= x.x - 1e-7 && candidate <= x.y + 1e-7;
}

// Sine (vec2f)
fn ia_sin_v(x: vec2f) -> IntervalResult {
  const TWO_PI: f32 = 6.28318530718;
  const HALF_PI: f32 = 1.57079632679;
  const THREE_HALF_PI: f32 = 4.71238898038;

  if (x.y - x.x >= TWO_PI) {
    return ia_ok(vec2f(-1.0, 1.0));
  }

  let sinLo = sin(x.x);
  let sinHi = sin(x.y);
  var lo = min(sinLo, sinHi);
  var hi = max(sinLo, sinHi);

  if (ia_contains_extremum(x, HALF_PI, TWO_PI)) { hi = 1.0; }
  if (ia_contains_extremum(x, THREE_HALF_PI, TWO_PI)) { lo = -1.0; }

  return ia_ok(vec2f(lo - IA_EPS, hi + IA_EPS));
}

// Cosine (vec2f)
fn ia_cos_v(x: vec2f) -> IntervalResult {
  const TWO_PI: f32 = 6.28318530718;
  const PI: f32 = 3.14159265359;

  if (x.y - x.x >= TWO_PI) {
    return ia_ok(vec2f(-1.0, 1.0));
  }

  let cosLo = cos(x.x);
  let cosHi = cos(x.y);
  var lo = min(cosLo, cosHi);
  var hi = max(cosLo, cosHi);

  if (ia_contains_extremum(x, 0.0, TWO_PI)) { hi = 1.0; }
  if (ia_contains_extremum(x, PI, TWO_PI)) { lo = -1.0; }

  return ia_ok(vec2f(lo - IA_EPS, hi + IA_EPS));
}

// Tangent (vec2f)
fn ia_tan_v(x: vec2f) -> IntervalResult {
  const PI: f32 = 3.14159265359;
  const HALF_PI: f32 = 1.57079632679;

  if (x.y - x.x >= PI) {
    return ia_singular(0.0);
  }

  if (ia_contains_extremum(x, HALF_PI, PI)) {
    let n = ceil((x.x - HALF_PI) / PI);
    let poleAt = HALF_PI + n * PI;
    return ia_singular(poleAt);
  }

  let tanLo = tan(x.x);
  let tanHi = tan(x.y);

  if ((tanLo > 1e10 && tanHi < -1e10) || (tanLo < -1e10 && tanHi > 1e10)) {
    return ia_singular(0.0);
  }

  return ia_ok(vec2f(tanLo - IA_EPS, tanHi + IA_EPS));
}

// Arc sine (vec2f)
fn ia_asin_v(x: vec2f) -> IntervalResult {
  if (x.x > 1.0 || x.y < -1.0) {
    return ia_empty();
  }

  let clipped = vec2f(max(x.x, -1.0), min(x.y, 1.0));

  if (x.x < -1.0 || x.y > 1.0) {
    var clip: f32;
    if (x.x < -1.0 && x.y > 1.0) { clip = IA_PARTIAL_BOTH; }
    else if (x.x < -1.0) { clip = IA_PARTIAL_LO; }
    else { clip = IA_PARTIAL_HI; }
    return ia_partial(vec2f(asin(clipped.x) - IA_EPS, asin(clipped.y) + IA_EPS), clip);
  }

  return ia_ok(vec2f(asin(x.x) - IA_EPS, asin(x.y) + IA_EPS));
}

// Arc cosine (vec2f)
fn ia_acos_v(x: vec2f) -> IntervalResult {
  if (x.x > 1.0 || x.y < -1.0) {
    return ia_empty();
  }

  let clipped = vec2f(max(x.x, -1.0), min(x.y, 1.0));

  if (x.x < -1.0 || x.y > 1.0) {
    var clip: f32;
    if (x.x < -1.0 && x.y > 1.0) { clip = IA_PARTIAL_BOTH; }
    else if (x.x < -1.0) { clip = IA_PARTIAL_LO; }
    else { clip = IA_PARTIAL_HI; }
    return ia_partial(vec2f(acos(clipped.y) - IA_EPS, acos(clipped.x) + IA_EPS), clip);
  }

  return ia_ok(vec2f(acos(x.y) - IA_EPS, acos(x.x) + IA_EPS));
}

// Arc tangent (vec2f)
fn ia_atan_v(x: vec2f) -> IntervalResult {
  return ia_ok(vec2f(atan(x.x) - IA_EPS, atan(x.y) + IA_EPS));
}

// Hyperbolic sine (vec2f)
fn ia_sinh_v(x: vec2f) -> IntervalResult {
  return ia_ok(vec2f(sinh(x.x) - IA_EPS, sinh(x.y) + IA_EPS));
}

// Hyperbolic cosine (vec2f)
fn ia_cosh_v(x: vec2f) -> IntervalResult {
  if (x.x >= 0.0) {
    return ia_ok(vec2f(cosh(x.x) - IA_EPS, cosh(x.y) + IA_EPS));
  } else if (x.y <= 0.0) {
    return ia_ok(vec2f(cosh(x.y) - IA_EPS, cosh(x.x) + IA_EPS));
  } else {
    return ia_ok(vec2f(1.0 - IA_EPS, max(cosh(x.x), cosh(x.y)) + IA_EPS));
  }
}

// Hyperbolic tangent (vec2f)
fn ia_tanh_v(x: vec2f) -> IntervalResult {
  return ia_ok(vec2f(tanh(x.x) - IA_EPS, tanh(x.y) + IA_EPS));
}

// IntervalResult wrappers — binary arithmetic
fn ia_add(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_add_v(a.value, b.value);
}

fn ia_add_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_add_v(a.value, b);
}

fn ia_add_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_add_v(a, b.value);
}

fn ia_sub(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_sub_v(a.value, b.value);
}

fn ia_sub_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_sub_v(a.value, b);
}

fn ia_sub_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_sub_v(a, b.value);
}

fn ia_mul(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_mul_v(a.value, b.value);
}

fn ia_mul_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_mul_v(a.value, b);
}

fn ia_mul_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_mul_v(a, b.value);
}

fn ia_div(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_div_v(a.value, b.value);
}

fn ia_div_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_div_v(a.value, b);
}

fn ia_div_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_div_v(a, b.value);
}

// IntervalResult wrappers — unary
fn ia_negate(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_negate_v(x.value);
}

fn ia_sqrt(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_sqrt_v(x.value);
}

fn ia_square(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_square_v(x.value);
}

fn ia_exp(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_exp_v(x.value);
}

fn ia_ln(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_ln_v(x.value);
}

fn ia_log2(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_log2_v(x.value);
}

fn ia_log10(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_log10_v(x.value);
}

fn ia_abs(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_abs_v(x.value);
}

fn ia_sign(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_sign_v(x.value);
}

fn ia_floor(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_floor_v(x.value);
}

fn ia_ceil(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_ceil_v(x.value);
}

fn ia_round(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_round_v(x.value);
}

fn ia_fract(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_fract_v(x.value);
}

fn ia_trunc(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_trunc_v(x.value);
}

fn ia_mod(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_mod_v(a.value, b.value);
}

fn ia_mod_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_mod_v(a.value, b);
}

fn ia_mod_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_mod_v(a, b.value);
}

fn ia_remainder(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_remainder_v(a.value, b.value);
}

fn ia_remainder_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_remainder_v(a.value, b);
}

fn ia_remainder_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_remainder_v(a, b.value);
}

fn ia_min(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_min_v(a.value, b.value);
}

fn ia_min_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_min_v(a.value, b);
}

fn ia_min_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_min_v(a, b.value);
}

fn ia_max(a: IntervalResult, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  if (ia_is_error(b.status)) { return b; }
  return ia_max_v(a.value, b.value);
}

fn ia_max_rv(a: IntervalResult, b: vec2f) -> IntervalResult {
  if (ia_is_error(a.status)) { return a; }
  return ia_max_v(a.value, b);
}

fn ia_max_vr(a: vec2f, b: IntervalResult) -> IntervalResult {
  if (ia_is_error(b.status)) { return b; }
  return ia_max_v(a, b.value);
}

fn ia_pow(base: IntervalResult, e: f32) -> IntervalResult {
  if (ia_is_error(base.status)) { return base; }
  return ia_pow_v(base.value, e);
}

// Power with interval exponent
fn ia_pow_interval_v(base: vec2f, e: vec2f) -> IntervalResult {
  // Point integer exponent: delegate to constant-exponent ia_pow_v
  if (e.x == e.y && fract(e.x) == 0.0) {
    return ia_pow_v(base, e.x);
  }
  // base == [-1, -1] and exponent spans >=2 integers
  if (base.x == -1.0 && base.y == -1.0 && (e.y - e.x) >= 2.0) {
    return ia_ok(vec2f(-1.0, 1.0));
  }
  // Entirely non-positive base: undefined for non-integer exponents
  if (base.y <= 0.0) {
    return ia_empty();
  }
  // Positive part of base: exp(exp * ln(base))
  let bLo = max(base.x, 1e-300);
  let bHi = base.y;
  let lnLo = log(bLo);
  let lnHi = log(bHi);
  // Four corners of exp * ln(base)
  let c1 = e.x * lnLo;
  let c2 = e.x * lnHi;
  let c3 = e.y * lnLo;
  let c4 = e.y * lnHi;
  let minC = min(min(c1, c2), min(c3, c4));
  let maxC = max(max(c1, c2), max(c3, c4));
  let lo = exp(minC) - IA_EPS;
  let hi = exp(maxC) + IA_EPS;
  if (base.x < 0.0) {
    return ia_partial(vec2f(lo, hi), IA_PARTIAL_LO);
  }
  return ia_ok(vec2f(lo, hi));
}

fn ia_pow_interval(base: IntervalResult, e: IntervalResult) -> IntervalResult {
  if (ia_is_error(base.status)) { return base; }
  if (ia_is_error(e.status)) { return e; }
  return ia_pow_interval_v(base.value, e.value);
}

fn ia_sin(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_sin_v(x.value);
}

fn ia_cos(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_cos_v(x.value);
}

fn ia_tan(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_tan_v(x.value);
}

fn ia_asin(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_asin_v(x.value);
}

fn ia_acos(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_acos_v(x.value);
}

fn ia_atan(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_atan_v(x.value);
}

fn ia_sinh(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_sinh_v(x.value);
}

fn ia_cosh(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_cosh_v(x.value);
}

fn ia_tanh(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_tanh_v(x.value);
}

// Derived trig (vec2f)
fn ia_cot_v(x: vec2f) -> IntervalResult {
  return ia_div(ia_cos_v(x), ia_sin_v(x));
}

fn ia_cot(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_cot_v(x.value);
}

fn ia_csc_v(x: vec2f) -> IntervalResult {
  return ia_div(ia_ok(vec2f(1.0, 1.0)), ia_sin_v(x));
}

fn ia_csc(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_csc_v(x.value);
}

fn ia_sec_v(x: vec2f) -> IntervalResult {
  return ia_div(ia_ok(vec2f(1.0, 1.0)), ia_cos_v(x));
}

fn ia_sec(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_sec_v(x.value);
}

// Inverse trig (derived, vec2f)
fn ia_acot_v(x: vec2f) -> IntervalResult {
  return ia_atan(ia_div(ia_ok(vec2f(1.0, 1.0)), ia_ok(x)));
}

fn ia_acot(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_acot_v(x.value);
}

fn ia_acsc_v(x: vec2f) -> IntervalResult {
  return ia_asin(ia_div(ia_ok(vec2f(1.0, 1.0)), ia_ok(x)));
}

fn ia_acsc(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_acsc_v(x.value);
}

fn ia_asec_v(x: vec2f) -> IntervalResult {
  return ia_acos(ia_div(ia_ok(vec2f(1.0, 1.0)), ia_ok(x)));
}

fn ia_asec(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_asec_v(x.value);
}

// Hyperbolic derived (vec2f)
fn ia_coth_v(x: vec2f) -> IntervalResult {
  return ia_div(ia_cosh_v(x), ia_sinh_v(x));
}

fn ia_coth(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_coth_v(x.value);
}

fn ia_csch_v(x: vec2f) -> IntervalResult {
  return ia_div(ia_ok(vec2f(1.0, 1.0)), ia_sinh_v(x));
}

fn ia_csch(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_csch_v(x.value);
}

fn ia_sech_v(x: vec2f) -> IntervalResult {
  return ia_div(ia_ok(vec2f(1.0, 1.0)), ia_cosh_v(x));
}

fn ia_sech(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_sech_v(x.value);
}

// Inverse hyperbolic (vec2f)
fn ia_asinh_v(x: vec2f) -> IntervalResult {
  return ia_ok(vec2f(asinh(x.x) - IA_EPS, asinh(x.y) + IA_EPS));
}

fn ia_asinh(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_asinh_v(x.value);
}

fn ia_acosh_v(x: vec2f) -> IntervalResult {
  if (x.y < 1.0) {
    return ia_empty();
  }
  if (x.x >= 1.0) {
    return ia_ok(vec2f(acosh(x.x) - IA_EPS, acosh(x.y) + IA_EPS));
  }
  return ia_partial(vec2f(0.0, acosh(x.y) + IA_EPS), IA_PARTIAL_LO);
}

fn ia_acosh(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_acosh_v(x.value);
}

fn ia_atanh_v(x: vec2f) -> IntervalResult {
  if (x.x >= 1.0 || x.y <= -1.0) {
    return ia_empty();
  }
  let clipped = vec2f(max(x.x, -1.0 + IA_EPS), min(x.y, 1.0 - IA_EPS));
  if (x.x < -1.0 || x.y > 1.0) {
    var clip: f32;
    if (x.x < -1.0 && x.y > 1.0) { clip = IA_PARTIAL_BOTH; }
    else if (x.x < -1.0) { clip = IA_PARTIAL_LO; }
    else { clip = IA_PARTIAL_HI; }
    return ia_partial(vec2f(atanh(clipped.x) - IA_EPS, atanh(clipped.y) + IA_EPS), clip);
  }
  return ia_ok(vec2f(atanh(x.x) - IA_EPS, atanh(x.y) + IA_EPS));
}

fn ia_atanh(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_atanh_v(x.value);
}

// Inverse hyperbolic derived (vec2f)
fn ia_acoth_v(x: vec2f) -> IntervalResult {
  return ia_atanh(ia_div(ia_ok(vec2f(1.0, 1.0)), ia_ok(x)));
}

fn ia_acoth(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_acoth_v(x.value);
}

fn ia_acsch_v(x: vec2f) -> IntervalResult {
  return ia_asinh(ia_div(ia_ok(vec2f(1.0, 1.0)), ia_ok(x)));
}

fn ia_acsch(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_acsch_v(x.value);
}

fn ia_asech_v(x: vec2f) -> IntervalResult {
  return ia_acosh(ia_div(ia_ok(vec2f(1.0, 1.0)), ia_ok(x)));
}

fn ia_asech(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_asech_v(x.value);
}

// Gamma function using Lanczos approximation (g=7, n=9 coefficients)
// Poles at non-positive integers; minimum at x ≈ 1.4616
fn _gpu_gamma(z_in: f32) -> f32 {
  let PI = 3.14159265358979;
  var z = z_in;
  if (z < 0.5) {
    return PI / (sin(PI * z) * _gpu_gamma(1.0 - z));
  }
  z -= 1.0;
  var x = 0.99999999999980993;
  x += 676.5203681218851 / (z + 1.0);
  x += -1259.1392167224028 / (z + 2.0);
  x += 771.32342877765313 / (z + 3.0);
  x += -176.61502916214059 / (z + 4.0);
  x += 12.507343278686905 / (z + 5.0);
  x += -0.13857109526572012 / (z + 6.0);
  x += 9.9843695780195716e-6 / (z + 7.0);
  x += 1.5056327351493116e-7 / (z + 8.0);
  let t = z + 7.5;
  return sqrt(2.0 * PI) * pow(t, z + 0.5) * exp(-t) * x;
}

// Interval gamma function
// Handles poles at non-positive integers and the minimum at x ≈ 1.4616
fn ia_gamma_v(x: vec2f) -> IntervalResult {
  let GAMMA_MIN_X = 1.4616321;
  let GAMMA_MIN_Y = 0.8856032;

  // Check for poles: interval crosses or touches zero
  if (x.x <= 0.0 && x.y >= 0.0) {
    return ia_singular(0.0);
  }

  // Entirely negative: check if interval spans a negative integer
  if (x.x < 0.0) {
    let ceilLo = ceil(x.x);
    let floorHi = floor(x.y);
    if (ceilLo <= floorHi) {
      return ia_singular(ceilLo);
    }
    // No pole — both endpoints between same consecutive negative integers
    let gLo = _gpu_gamma(x.x);
    let gHi = _gpu_gamma(x.y);
    return ia_ok(vec2f(min(gLo, gHi) - IA_EPS, max(gLo, gHi) + IA_EPS));
  }

  // Entirely positive
  if (x.x >= GAMMA_MIN_X) {
    // Monotonically increasing
    return ia_ok(vec2f(_gpu_gamma(x.x) - IA_EPS, _gpu_gamma(x.y) + IA_EPS));
  }
  if (x.y <= GAMMA_MIN_X) {
    // Monotonically decreasing
    return ia_ok(vec2f(_gpu_gamma(x.y) - IA_EPS, _gpu_gamma(x.x) + IA_EPS));
  }
  // Crosses the minimum
  let gMax = max(_gpu_gamma(x.x), _gpu_gamma(x.y));
  return ia_ok(vec2f(GAMMA_MIN_Y - IA_EPS, gMax + IA_EPS));
}

fn ia_gamma(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_gamma_v(x.value);
}

// Log-gamma using Stirling asymptotic expansion, z > 0
fn _gpu_gammaln(z: f32) -> f32 {
  let z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}

// Interval log-gamma — monotonically increasing for x > 0
fn ia_gammaln_v(x: vec2f) -> IntervalResult {
  if (x.y <= 0.0) { return ia_empty(); }
  if (x.x > 0.0) {
    return ia_ok(vec2f(_gpu_gammaln(x.x) - IA_EPS, _gpu_gammaln(x.y) + IA_EPS));
  }
  // Partial: clipped at lo
  return ia_partial(vec2f(0.0, _gpu_gammaln(x.y) + IA_EPS), IA_PARTIAL_LO);
}

fn ia_gammaln(x: IntervalResult) -> IntervalResult {
  if (ia_is_error(x.status)) { return x; }
  return ia_gammaln_v(x.value);
}

// Factorial via gamma: n! = gamma(n+1)
fn ia_factorial(x: IntervalResult) -> IntervalResult {
  return ia_gamma(ia_add(x, ia_point(1.0)));
}

// Boolean interval comparisons
// Returns 1.0 = true, 0.0 = false, 0.5 = maybe
const IA_TRUE: f32 = 1.0;
const IA_FALSE: f32 = 0.0;
const IA_MAYBE: f32 = 0.5;

fn ia_less_v(a: vec2f, b: vec2f) -> f32 {
  if (a.y < b.x) { return IA_TRUE; }
  if (a.x >= b.y) { return IA_FALSE; }
  return IA_MAYBE;
}

fn ia_lessEqual_v(a: vec2f, b: vec2f) -> f32 {
  if (a.y <= b.x) { return IA_TRUE; }
  if (a.x > b.y) { return IA_FALSE; }
  return IA_MAYBE;
}

fn ia_greater_v(a: vec2f, b: vec2f) -> f32 {
  if (a.x > b.y) { return IA_TRUE; }
  if (a.y <= b.x) { return IA_FALSE; }
  return IA_MAYBE;
}

fn ia_greaterEqual_v(a: vec2f, b: vec2f) -> f32 {
  if (a.x >= b.y) { return IA_TRUE; }
  if (a.y < b.x) { return IA_FALSE; }
  return IA_MAYBE;
}

fn ia_equal_v(a: vec2f, b: vec2f) -> f32 {
  if (a.x == a.y && b.x == b.y && a.x == b.x) { return IA_TRUE; }
  if (a.y < b.x || b.y < a.x) { return IA_FALSE; }
  return IA_MAYBE;
}

fn ia_notEqual_v(a: vec2f, b: vec2f) -> f32 {
  let eq = ia_equal_v(a, b);
  if (eq == IA_TRUE) { return IA_FALSE; }
  if (eq == IA_FALSE) { return IA_TRUE; }
  return IA_MAYBE;
}

fn ia_and(a: f32, b: f32) -> f32 {
  if (a == IA_FALSE || b == IA_FALSE) { return IA_FALSE; }
  if (a == IA_TRUE && b == IA_TRUE) { return IA_TRUE; }
  return IA_MAYBE;
}

fn ia_or(a: f32, b: f32) -> f32 {
  if (a == IA_TRUE || b == IA_TRUE) { return IA_TRUE; }
  if (a == IA_FALSE && b == IA_FALSE) { return IA_FALSE; }
  return IA_MAYBE;
}

fn ia_not(a: f32) -> f32 {
  if (a == IA_TRUE) { return IA_FALSE; }
  if (a == IA_FALSE) { return IA_TRUE; }
  return IA_MAYBE;
}

// IntervalResult wrappers for comparisons
fn ia_less(a: IntervalResult, b: IntervalResult) -> f32 {
  if (ia_is_error(a.status) || ia_is_error(b.status)) { return IA_MAYBE; }
  return ia_less_v(a.value, b.value);
}

fn ia_lessEqual(a: IntervalResult, b: IntervalResult) -> f32 {
  if (ia_is_error(a.status) || ia_is_error(b.status)) { return IA_MAYBE; }
  return ia_lessEqual_v(a.value, b.value);
}

fn ia_greater(a: IntervalResult, b: IntervalResult) -> f32 {
  if (ia_is_error(a.status) || ia_is_error(b.status)) { return IA_MAYBE; }
  return ia_greater_v(a.value, b.value);
}

fn ia_greaterEqual(a: IntervalResult, b: IntervalResult) -> f32 {
  if (ia_is_error(a.status) || ia_is_error(b.status)) { return IA_MAYBE; }
  return ia_greaterEqual_v(a.value, b.value);
}

fn ia_equal(a: IntervalResult, b: IntervalResult) -> f32 {
  if (ia_is_error(a.status) || ia_is_error(b.status)) { return IA_MAYBE; }
  return ia_equal_v(a.value, b.value);
}

fn ia_notEqual(a: IntervalResult, b: IntervalResult) -> f32 {
  if (ia_is_error(a.status) || ia_is_error(b.status)) { return IA_MAYBE; }
  return ia_notEqual_v(a.value, b.value);
}
`;

// ---------------------------------------------------------------------------
// Selective preamble builder
//
// Parses the monolithic WGSL_INTERVAL_LIBRARY into individual function blocks
// with auto-detected dependencies. At compile time, only the functions
// referenced by the compiled expression (plus their transitive dependencies)
// are emitted.
// ---------------------------------------------------------------------------

interface WGSLFunctionBlock {
  /** The function name (e.g. "ia_sin_v") */
  name: string;
  /** Full source text of the function (including preceding comment lines) */
  source: string;
  /** Names of other ia_ or _gpu_ functions called from this function's body */
  deps: string[];
}

/** Header: constants, struct, epsilon — always emitted */
let _wgslPreambleHeader = '';
/** Mid-preamble constant blocks (e.g. IA_TRUE/FALSE/MAYBE) keyed by marker */
const _wgslPreambleConstants: Map<string, string> = new Map();
/** Individual function blocks keyed by function name */
const _wgslPreambleFunctions: Map<string, WGSLFunctionBlock> = new Map();
/** Set to true once parsing is done */
let _wgslPreambleParsed = false;

/** Regex matching function declarations in the WGSL preamble: `fn ia_xxx(` */
const WGSL_FUNC_RE = /^fn\s+(ia_\w+|_gpu_\w+)\s*\(/;

/** Regex to find calls to ia_ or _gpu_ functions within a body */
const WGSL_CALL_RE = /\b(ia_\w+|_gpu_\w+)\s*\(/g;

/** Regex for constant declarations like `const IA_TRUE: f32 = 1.0;` */
const WGSL_CONST_RE = /^const\s+(IA_\w+)\s*:/;

function parseWGSLPreamble(): void {
  if (_wgslPreambleParsed) return;
  _wgslPreambleParsed = true;

  const lines = WGSL_INTERVAL_LIBRARY.split('\n');
  let headerDone = false;
  const headerLines: string[] = [];
  let currentBlock: string[] = [];
  let currentName: string | null = null;
  let braceDepth = 0;
  let inFunction = false;
  let pendingComments: string[] = [];
  let pendingConstants: string[] = [];

  for (const line of lines) {
    // Check if this is a constant declaration outside a function
    const constMatch = !inFunction && WGSL_CONST_RE.exec(line);
    if (constMatch && headerDone) {
      // Mid-preamble constant (e.g. IA_TRUE) — accumulate
      pendingConstants.push(line);
      continue;
    }

    const funcMatch = !inFunction && WGSL_FUNC_RE.exec(line);

    if (funcMatch) {
      if (!headerDone) {
        _wgslPreambleHeader = headerLines.join('\n');
        headerDone = true;
      }

      currentName = funcMatch[1];
      currentBlock = [...pendingComments, ...pendingConstants, line];
      pendingComments = [];
      pendingConstants = [];
      inFunction = true;
      braceDepth = 0;

      // Count braces on this line
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) {
        // Single-line function
        finishWGSLFunction(currentName, currentBlock.join('\n'));
        inFunction = false;
        currentName = null;
      }
    } else if (inFunction) {
      currentBlock.push(line);
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) {
        finishWGSLFunction(currentName!, currentBlock.join('\n'));
        inFunction = false;
        currentName = null;
      }
    } else if (!headerDone) {
      headerLines.push(line);
    } else {
      // Between functions — could be comment or blank
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed === '') {
        pendingComments.push(line);
      }
    }
  }

  // Flush any remaining pending constants into the header
  if (pendingConstants.length > 0) {
    _wgslPreambleHeader += '\n' + pendingConstants.join('\n');
  }
}

function finishWGSLFunction(name: string, source: string): void {
  // Auto-detect dependencies by scanning the body for ia_ or _gpu_ calls
  const deps = new Set<string>();
  let match: RegExpExecArray | null;
  const callRe = new RegExp(WGSL_CALL_RE.source, 'g');
  while ((match = callRe.exec(source)) !== null) {
    const callee = match[1];
    if (callee !== name) deps.add(callee);
  }

  // WGSL uses _v/_rv/_vr suffixes instead of overloading, so each function
  // has a unique name and we don't need to merge overloads.

  _wgslPreambleFunctions.set(name, {
    name,
    source,
    deps: [...deps],
  });
}

/**
 * Build a minimal interval WGSL preamble containing only the functions
 * that the compiled code actually uses (plus transitive dependencies).
 */
function buildIntervalWGSLPreamble(code: string): string {
  parseWGSLPreamble();

  // 1. Find all ia_ or _gpu_ calls in the compiled expression code
  const needed = new Set<string>();
  let match: RegExpExecArray | null;
  const callRe = new RegExp(WGSL_CALL_RE.source, 'g');
  while ((match = callRe.exec(code)) !== null) {
    needed.add(match[1]);
  }

  if (needed.size === 0) return _wgslPreambleHeader;

  // 2. Resolve transitive dependencies
  const resolved = new Set<string>();
  function resolve(name: string): void {
    if (resolved.has(name)) return;
    const block = _wgslPreambleFunctions.get(name);
    if (!block) return;
    for (const dep of block.deps) resolve(dep);
    resolved.add(name);
  }
  for (const name of needed) resolve(name);

  // 3. Emit in dependency order (resolved set preserves insertion order,
  //    and deps are resolved before dependents)
  const parts: string[] = [_wgslPreambleHeader];

  // Check if any comparison functions are needed — if so, include IA_TRUE/FALSE/MAYBE
  const needsComparisonConstants = [...resolved].some(
    (name) =>
      name.startsWith('ia_less') ||
      name.startsWith('ia_greater') ||
      name.startsWith('ia_equal') ||
      name.startsWith('ia_notEqual') ||
      name === 'ia_and' ||
      name === 'ia_or' ||
      name === 'ia_not'
  );
  if (needsComparisonConstants) {
    parts.push(
      '\nconst IA_TRUE: f32 = 1.0;\nconst IA_FALSE: f32 = 0.0;\nconst IA_MAYBE: f32 = 0.5;'
    );
  }

  for (const name of resolved) {
    const block = _wgslPreambleFunctions.get(name);
    if (block) parts.push('\n' + block.source);
  }

  return parts.join('\n');
}

/**
 * WGSL interval operators - all become function calls
 */
const INTERVAL_WGSL_OPERATORS: CompiledOperators = {
  Add: ['ia_add', 20],
  Negate: ['ia_negate', 20],
  Subtract: ['ia_sub', 20],
  Multiply: ['ia_mul', 20],
  Divide: ['ia_div', 20],
};

/**
 * WGSL interval function implementations.
 *
 * Identical to INTERVAL_GLSL_FUNCTIONS since the compiled expression output
 * uses the same `ia_*` function names — the library handles the WGSL syntax
 * differences internally via `_v` suffixed implementations.
 */
const INTERVAL_WGSL_FUNCTIONS: CompiledFunctions<Expression> = {
  Add: (args, compile) => {
    if (args.length === 0) return 'ia_point(0.0)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `ia_add(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Subtract: (args, compile) => {
    if (args.length === 0) return 'ia_point(0.0)';
    if (args.length === 1) return `ia_negate(${compile(args[0])})`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `ia_sub(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return 'ia_point(1.0)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `ia_mul(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Divide: (args, compile) => {
    if (args.length === 0) return 'ia_point(1.0)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `ia_div(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Negate: (args, compile) => `ia_negate(${compile(args[0])})`,

  // Special functions
  Gamma: (args, compile) => `ia_gamma(${compile(args[0])})`,
  GammaLn: (args, compile) => `ia_gammaln(${compile(args[0])})`,
  Factorial: (args, compile) => `ia_factorial(${compile(args[0])})`,

  // Elementary functions
  Abs: (args, compile) => `ia_abs(${compile(args[0])})`,
  Ceil: (args, compile) => `ia_ceil(${compile(args[0])})`,
  Exp: (args, compile) => `ia_exp(${compile(args[0])})`,
  Floor: (args, compile) => `ia_floor(${compile(args[0])})`,
  Fract: (args, compile) => `ia_fract(${compile(args[0])})`,
  Truncate: (args, compile) => `ia_trunc(${compile(args[0])})`,
  Lb: (args, compile) => `ia_log2(${compile(args[0])})`,
  Ln: (args, compile) => `ia_ln(${compile(args[0])})`,
  Log: (args, compile) => {
    if (args.length === 1) return `ia_log10(${compile(args[0])})`;
    return `ia_div(ia_ln(${compile(args[0])}), ia_ln(${compile(args[1])}))`;
  },
  Mod: (args, compile) => `ia_mod(${compile(args[0])}, ${compile(args[1])})`,
  Remainder: (args, compile) =>
    `ia_remainder(${compile(args[0])}, ${compile(args[1])})`,
  Max: (args, compile) => {
    if (args.length === 0) return 'ia_point(-1e38)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `ia_max(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Min: (args, compile) => {
    if (args.length === 0) return 'ia_point(1e38)';
    if (args.length === 1) return compile(args[0]);
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `ia_min(${result}, ${compile(args[i])})`;
    }
    return result;
  },
  Power: (args, compile) => {
    const base = args[0];
    const exp = args[1];
    if (base === null) throw new Error('Power: no argument');
    if (isSymbol(base, 'ExponentialE')) {
      return `ia_exp(${compile(exp)})`;
    }
    if (isNumber(exp) && exp.im === 0) {
      const expVal = exp.re;
      if (expVal === 2) return `ia_square(${compile(base)})`;
      return `ia_pow(${compile(base)}, ${expVal})`;
    }
    // Variable exponent - use interval pow
    return `ia_pow_interval(${compile(base)}, ${compile(exp)})`;
  },
  Root: (args, compile) => {
    const [arg, exp] = args;
    if (arg === null) throw new Error('Root: no argument');
    if (exp === null || exp?.re === 2) return `ia_sqrt(${compile(arg)})`;
    if (isNumber(exp) && exp.im === 0) {
      return `ia_pow(${compile(arg)}, ${1 / exp.re})`;
    }
    throw new Error('Interval WGSL does not support variable root indices');
  },
  Round: (args, compile) => `ia_round(${compile(args[0])})`,
  Sign: (args, compile) => `ia_sign(${compile(args[0])})`,
  Sqrt: (args, compile) => `ia_sqrt(${compile(args[0])})`,
  Square: (args, compile) => `ia_square(${compile(args[0])})`,

  // Trigonometric functions
  Sin: (args, compile) => `ia_sin(${compile(args[0])})`,
  Cos: (args, compile) => `ia_cos(${compile(args[0])})`,
  Tan: (args, compile) => `ia_tan(${compile(args[0])})`,
  Arcsin: (args, compile) => `ia_asin(${compile(args[0])})`,
  Arccos: (args, compile) => `ia_acos(${compile(args[0])})`,
  Arctan: (args, compile) => `ia_atan(${compile(args[0])})`,

  // Reciprocal trigonometric functions
  Cot: (args, compile) => `ia_cot(${compile(args[0])})`,
  Csc: (args, compile) => `ia_csc(${compile(args[0])})`,
  Sec: (args, compile) => `ia_sec(${compile(args[0])})`,

  // Inverse trigonometric (reciprocal)
  Arccot: (args, compile) => `ia_acot(${compile(args[0])})`,
  Arccsc: (args, compile) => `ia_acsc(${compile(args[0])})`,
  Arcsec: (args, compile) => `ia_asec(${compile(args[0])})`,

  // Hyperbolic functions
  Sinh: (args, compile) => `ia_sinh(${compile(args[0])})`,
  Cosh: (args, compile) => `ia_cosh(${compile(args[0])})`,
  Tanh: (args, compile) => `ia_tanh(${compile(args[0])})`,

  // Reciprocal hyperbolic functions
  Coth: (args, compile) => `ia_coth(${compile(args[0])})`,
  Csch: (args, compile) => `ia_csch(${compile(args[0])})`,
  Sech: (args, compile) => `ia_sech(${compile(args[0])})`,

  // Inverse hyperbolic functions
  Arsinh: (args, compile) => `ia_asinh(${compile(args[0])})`,
  Arcosh: (args, compile) => `ia_acosh(${compile(args[0])})`,
  Artanh: (args, compile) => `ia_atanh(${compile(args[0])})`,

  // Inverse hyperbolic (reciprocal)
  Arcoth: (args, compile) => `ia_acoth(${compile(args[0])})`,
  Arcsch: (args, compile) => `ia_acsch(${compile(args[0])})`,
  Arsech: (args, compile) => `ia_asech(${compile(args[0])})`,

  // Comparison and logic (return f32: 1.0=true, 0.0=false, 0.5=maybe)
  Equal: (args, compile) =>
    `ia_equal(${compile(args[0])}, ${compile(args[1])})`,
  NotEqual: (args, compile) =>
    `ia_notEqual(${compile(args[0])}, ${compile(args[1])})`,
  Less: (args, compile) => `ia_less(${compile(args[0])}, ${compile(args[1])})`,
  LessEqual: (args, compile) =>
    `ia_lessEqual(${compile(args[0])}, ${compile(args[1])})`,
  Greater: (args, compile) =>
    `ia_greater(${compile(args[0])}, ${compile(args[1])})`,
  GreaterEqual: (args, compile) =>
    `ia_greaterEqual(${compile(args[0])}, ${compile(args[1])})`,
  And: (args, compile) => `ia_and(${compile(args[0])}, ${compile(args[1])})`,
  Or: (args, compile) => `ia_or(${compile(args[0])}, ${compile(args[1])})`,
  Not: (args, compile) => `ia_not(${compile(args[0])})`,
};

/**
 * WGSL interval arithmetic target implementation.
 */
export class IntervalWGSLTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return INTERVAL_WGSL_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return INTERVAL_WGSL_FUNCTIONS;
  }

  /**
   * Get the WGSL interval library code.
   *
   * This should be included in shaders that use interval arithmetic.
   */
  getLibrary(): string {
    return WGSL_INTERVAL_LIBRARY;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'interval-wgsl',
      operators: () => undefined,
      functions: (id) => INTERVAL_WGSL_FUNCTIONS[id],
      var: (id) => {
        const constants: Record<string, string> = {
          Pi: 'ia_point(3.14159265359)',
          ExponentialE: 'ia_point(2.71828182846)',
          GoldenRatio: 'ia_point(1.61803398875)',
          CatalanConstant: 'ia_point(0.91596559417)',
          EulerGamma: 'ia_point(0.57721566490)',
        };
        if (id in constants) return constants[id];
        return id;
      },
      string: (str) => JSON.stringify(str),
      number: (n) => {
        const str = n.toString();
        const numStr =
          !str.includes('.') && !str.includes('e') && !str.includes('E')
            ? `${str}.0`
            : str;
        return `ia_point(${numStr})`;
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      ...options,
    };
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult<'interval-wgsl'> {
    const { functions, vars } = options;

    const target = this.createTarget({
      functions: (id) => {
        if (functions && id in functions) {
          const fn = functions[id];
          if (typeof fn === 'string') return fn;
          if (typeof fn === 'function') return fn.name || id;
        }
        return INTERVAL_WGSL_FUNCTIONS[id];
      },
      var: (id) => {
        if (vars && id in vars) return vars[id] as string;
        const constants: Record<string, string> = {
          Pi: 'ia_point(3.14159265359)',
          ExponentialE: 'ia_point(2.71828182846)',
          GoldenRatio: 'ia_point(1.61803398875)',
          CatalanConstant: 'ia_point(0.91596559417)',
          EulerGamma: 'ia_point(0.57721566490)',
        };
        if (id in constants) return constants[id];
        return id;
      },
    });

    const wgslCode = BaseCompiler.compile(expr, target);

    return {
      target: 'interval-wgsl',
      success: true,
      code: wgslCode,
      preamble: buildIntervalWGSLPreamble(wgslCode),
    };
  }

  /**
   * Compile an expression to WGSL interval code string.
   */
  compileToSource(
    expr: Expression,
    _options: CompilationOptions<Expression> = {}
  ): string {
    const target = this.createTarget();
    return BaseCompiler.compile(expr, target);
  }

  /**
   * Create a complete WGSL interval function from an expression.
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the WGSL function
   * @param parameters - Parameter names (each becomes a vec2f interval input)
   */
  compileFunction(
    expr: Expression,
    functionName: string,
    parameters: string[]
  ): string {
    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);

    const params = parameters.map((name) => `${name}: vec2f`).join(', ');

    return `fn ${functionName}(${params}) -> IntervalResult {
  return ${body};
}`;
  }

  /**
   * Create a complete WGSL compute shader for interval function evaluation.
   *
   * @param expr - The expression to compile
   * @param options - Shader options
   */
  compileShaderFunction(
    expr: Expression,
    options: {
      functionName?: string;
      parameters?: string[];
    } = {}
  ): string {
    const { functionName = 'evaluateInterval', parameters = ['x'] } = options;

    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);
    const params = parameters.map((name) => `${name}: vec2f`).join(', ');

    const preamble = buildIntervalWGSLPreamble(body);

    return `${preamble}

fn ${functionName}(${params}) -> IntervalResult {
  return ${body};
}
`;
  }
}
