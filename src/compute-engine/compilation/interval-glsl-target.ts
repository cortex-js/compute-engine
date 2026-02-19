/**
 * GLSL interval arithmetic compilation target
 *
 * Compiles mathematical expressions to GLSL code using interval arithmetic
 * for reliable function evaluation in shaders.
 *
 * Intervals are represented as vec2(lo, hi).
 * Status flags use float constants for shader compatibility.
 *
 * @module compilation/interval-glsl-target
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
 * Foundation code for the GLSL interval arithmetic library.
 *
 * Always included in the preamble. Contains status constants, the
 * IntervalResult struct, and lightweight constructors.
 */
const GLSL_IA_FOUNDATION = `
// Interval Arithmetic Library for GLSL
// Intervals are represented as vec2(lo, hi)
// Results use IntervalResult struct with status flags

// Status constants
const float IA_NORMAL = 0.0;
const float IA_EMPTY = 1.0;
const float IA_ENTIRE = 2.0;
const float IA_SINGULAR = 3.0;
const float IA_PARTIAL_LO = 4.0;
const float IA_PARTIAL_HI = 5.0;
const float IA_PARTIAL_BOTH = 6.0;
const float IA_SINGULAR_RIGHT = 7.0;
const float IA_SINGULAR_LEFT = 8.0;

// Boolean interval comparison constants
const float IA_TRUE = 1.0;
const float IA_FALSE = 0.0;
const float IA_MAYBE = 0.5;

// Interval result struct
struct IntervalResult {
  vec2 value;      // (lo, hi)
  float status;    // Status flag
};

// Epsilon for conservative bounds
const float IA_EPS = 1e-6;
const float IA_HUGE = 1e38;

// Create a point interval
vec2 ia_point(float x) {
  return vec2(x, x);
}

// Create interval result
IntervalResult ia_ok(vec2 v) {
  return IntervalResult(v, IA_NORMAL);
}

IntervalResult ia_empty() {
  return IntervalResult(vec2(0.0), IA_EMPTY);
}

IntervalResult ia_entire() {
  return IntervalResult(vec2(-IA_HUGE, IA_HUGE), IA_ENTIRE);
}

IntervalResult ia_singular(float at) {
  return IntervalResult(vec2(at, at), IA_SINGULAR);
}

IntervalResult ia_singular_right(float at) {
  return IntervalResult(vec2(at, at), IA_SINGULAR_RIGHT);
}

IntervalResult ia_singular_left(float at) {
  return IntervalResult(vec2(at, at), IA_SINGULAR_LEFT);
}

IntervalResult ia_partial(vec2 v, float clip) {
  return IntervalResult(v, clip);
}

bool ia_is_error(float status) {
  return status == IA_EMPTY || status == IA_ENTIRE || status == IA_SINGULAR || status == IA_SINGULAR_RIGHT || status == IA_SINGULAR_LEFT;
}
`;

/**
 * Individual GLSL interval function definitions.
 *
 * Each entry contains:
 * - `source`: GLSL source code for all overloads of this function
 * - `deps`: Names of other entries this function depends on
 *
 * The `buildIntervalPreamble()` function scans compiled code for function
 * names, resolves transitive dependencies, and emits only needed functions
 * in topological (dependency-first) order.
 */
interface IntervalFunctionDef {
  source: string;
  deps: string[];
}

const GLSL_IA_FUNCTIONS: Record<string, IntervalFunctionDef> = {

// ── Core Arithmetic ──────────────────────────────────────────────────

ia_add: {
  deps: [],
  source: `
IntervalResult ia_add(vec2 a, vec2 b) {
  return ia_ok(vec2(a.x + b.x - IA_EPS, a.y + b.y + IA_EPS));
}
IntervalResult ia_add(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_add(a.value, b.value);
}
IntervalResult ia_add(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_add(a.value, b);
}
IntervalResult ia_add(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_add(a, b.value);
}`,
},

ia_sub: {
  deps: [],
  source: `
IntervalResult ia_sub(vec2 a, vec2 b) {
  return ia_ok(vec2(a.x - b.y - IA_EPS, a.y - b.x + IA_EPS));
}
IntervalResult ia_sub(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_sub(a.value, b.value);
}
IntervalResult ia_sub(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_sub(a.value, b);
}
IntervalResult ia_sub(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_sub(a, b.value);
}`,
},

ia_negate: {
  deps: [],
  source: `
IntervalResult ia_negate(vec2 x) {
  return ia_ok(vec2(-x.y, -x.x));
}
IntervalResult ia_negate(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_negate(x.value);
}`,
},

ia_mul_raw: {
  deps: [],
  source: `
vec2 ia_mul_raw(vec2 a, vec2 b) {
  float p1 = a.x * b.x;
  float p2 = a.x * b.y;
  float p3 = a.y * b.x;
  float p4 = a.y * b.y;
  return vec2(
    min(min(p1, p2), min(p3, p4)) - IA_EPS,
    max(max(p1, p2), max(p3, p4)) + IA_EPS
  );
}`,
},

ia_mul: {
  deps: ['ia_mul_raw'],
  source: `
IntervalResult ia_mul(vec2 a, vec2 b) {
  return ia_ok(ia_mul_raw(a, b));
}
IntervalResult ia_mul(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_mul(a.value, b.value);
}
IntervalResult ia_mul(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_mul(a.value, b);
}
IntervalResult ia_mul(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_mul(a, b.value);
}`,
},

ia_div: {
  deps: ['ia_mul_raw'],
  source: `
IntervalResult ia_div(vec2 a, vec2 b) {
  if (b.x > 0.0 || b.y < 0.0) {
    return ia_ok(ia_mul_raw(a, vec2(1.0 / b.y, 1.0 / b.x)));
  }
  if (b.x < 0.0 && b.y > 0.0) {
    return ia_singular(0.0);
  }
  if (b.x == 0.0 && b.y > 0.0) {
    if (a.x >= 0.0) {
      return ia_partial(vec2(a.x / b.y, IA_HUGE), IA_PARTIAL_HI);
    } else if (a.y <= 0.0) {
      return ia_partial(vec2(-IA_HUGE, a.y / b.y), IA_PARTIAL_LO);
    } else {
      return ia_entire();
    }
  }
  if (b.y == 0.0 && b.x < 0.0) {
    if (a.x >= 0.0) {
      return ia_partial(vec2(-IA_HUGE, a.x / b.x), IA_PARTIAL_LO);
    } else if (a.y <= 0.0) {
      return ia_partial(vec2(a.y / b.x, IA_HUGE), IA_PARTIAL_HI);
    } else {
      return ia_entire();
    }
  }
  return ia_empty();
}
IntervalResult ia_div(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_div(a.value, b.value);
}
IntervalResult ia_div(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_div(a.value, b);
}
IntervalResult ia_div(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_div(a, b.value);
}`,
},

// ── Elementary Functions ─────────────────────────────────────────────

ia_sqrt: {
  deps: [],
  source: `
IntervalResult ia_sqrt(vec2 x) {
  if (x.y < 0.0) {
    return ia_empty();
  }
  if (x.x >= 0.0) {
    return ia_ok(vec2(sqrt(x.x), sqrt(x.y) + IA_EPS));
  }
  return ia_partial(vec2(0.0, sqrt(x.y) + IA_EPS), IA_PARTIAL_LO);
}
IntervalResult ia_sqrt(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sqrt(x.value);
}`,
},

ia_square: {
  deps: [],
  source: `
IntervalResult ia_square(vec2 x) {
  if (x.x >= 0.0) {
    return ia_ok(vec2(x.x * x.x - IA_EPS, x.y * x.y + IA_EPS));
  } else if (x.y <= 0.0) {
    return ia_ok(vec2(x.y * x.y - IA_EPS, x.x * x.x + IA_EPS));
  } else {
    float m = max(-x.x, x.y);
    return ia_ok(vec2(0.0, m * m + IA_EPS));
  }
}
IntervalResult ia_square(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_square(x.value);
}`,
},

ia_exp: {
  deps: [],
  source: `
IntervalResult ia_exp(vec2 x) {
  return ia_ok(vec2(exp(x.x) - IA_EPS, exp(x.y) + IA_EPS));
}
IntervalResult ia_exp(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_exp(x.value);
}`,
},

ia_ln: {
  deps: [],
  source: `
IntervalResult ia_ln(vec2 x) {
  if (x.y <= 0.0) {
    return ia_empty();
  }
  if (x.x > 0.0) {
    return ia_ok(vec2(log(x.x) - IA_EPS, log(x.y) + IA_EPS));
  }
  return ia_partial(vec2(-IA_HUGE, log(x.y) + IA_EPS), IA_PARTIAL_LO);
}
IntervalResult ia_ln(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_ln(x.value);
}`,
},

ia_log2: {
  deps: [],
  source: `
IntervalResult ia_log2(vec2 x) {
  const float INV_LN2 = 1.44269504089;
  if (x.y <= 0.0) return ia_empty();
  if (x.x > 0.0) return ia_ok(vec2(log2(x.x) - IA_EPS, log2(x.y) + IA_EPS));
  return ia_partial(vec2(-IA_HUGE, log2(x.y) + IA_EPS), IA_PARTIAL_LO);
}
IntervalResult ia_log2(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_log2(x.value);
}`,
},

ia_log10: {
  deps: [],
  source: `
IntervalResult ia_log10(vec2 x) {
  const float INV_LN10 = 0.43429448190;
  if (x.y <= 0.0) return ia_empty();
  if (x.x > 0.0) return ia_ok(vec2(log(x.x) * INV_LN10 - IA_EPS, log(x.y) * INV_LN10 + IA_EPS));
  return ia_partial(vec2(-IA_HUGE, log(x.y) * INV_LN10 + IA_EPS), IA_PARTIAL_LO);
}
IntervalResult ia_log10(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_log10(x.value);
}`,
},

ia_abs: {
  deps: [],
  source: `
IntervalResult ia_abs(vec2 x) {
  if (x.x >= 0.0) {
    return ia_ok(x);
  }
  if (x.y <= 0.0) {
    return ia_ok(vec2(-x.y, -x.x));
  }
  return ia_ok(vec2(0.0, max(-x.x, x.y)));
}
IntervalResult ia_abs(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_abs(x.value);
}`,
},

// ── Rounding / Step Functions ────────────────────────────────────────

ia_sign: {
  deps: [],
  source: `
IntervalResult ia_sign(vec2 x) {
  if (x.x > 0.0) return ia_ok(vec2(1.0, 1.0));
  if (x.y < 0.0) return ia_ok(vec2(-1.0, -1.0));
  if (x.x == 0.0 && x.y == 0.0) return ia_ok(vec2(0.0, 0.0));
  return ia_singular(0.0);
}
IntervalResult ia_sign(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sign(x.value);
}`,
},

ia_floor: {
  deps: [],
  source: `
IntervalResult ia_floor(vec2 x) {
  float flo = floor(x.x);
  float fhi = floor(x.y);
  if (flo == fhi) {
    return ia_ok(vec2(flo, fhi));
  }
  return ia_singular_right(flo + 1.0);
}
IntervalResult ia_floor(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_floor(x.value);
}`,
},

ia_ceil: {
  deps: [],
  source: `
IntervalResult ia_ceil(vec2 x) {
  float clo = ceil(x.x);
  float chi = ceil(x.y);
  if (clo == chi) {
    return ia_ok(vec2(clo, chi));
  }
  return ia_singular_left(clo);
}
IntervalResult ia_ceil(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_ceil(x.value);
}`,
},

ia_round: {
  deps: [],
  source: `
IntervalResult ia_round(vec2 x) {
  float rlo = round(x.x);
  float rhi = round(x.y);
  if (rlo == rhi) {
    return ia_ok(vec2(rlo, rhi));
  }
  return ia_singular_right(rlo + 0.5);
}
IntervalResult ia_round(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_round(x.value);
}`,
},

ia_fract: {
  deps: [],
  source: `
IntervalResult ia_fract(vec2 x) {
  float flo = floor(x.x);
  float fhi = floor(x.y);
  if (flo == fhi) {
    return ia_ok(vec2(fract(x.x) - IA_EPS, fract(x.y) + IA_EPS));
  }
  return ia_singular_right(flo + 1.0);
}
IntervalResult ia_fract(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_fract(x.value);
}`,
},

ia_trunc: {
  deps: [],
  source: `
IntervalResult ia_trunc(vec2 x) {
  float tlo = trunc(x.x);
  float thi = trunc(x.y);
  if (tlo == thi) return ia_ok(vec2(tlo, thi));
  if (x.x >= 0.0) return ia_singular_right(tlo + 1.0);
  float firstInt = ceil(x.x);
  if (firstInt != 0.0) return ia_singular_left(firstInt);
  return ia_singular_right(1.0);
}
IntervalResult ia_trunc(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_trunc(x.value);
}`,
},

// ── Modular Arithmetic ───────────────────────────────────────────────

ia_mod: {
  deps: ['ia_div', 'ia_floor', 'ia_sub', 'ia_mul_raw'],
  source: `
IntervalResult ia_mod(vec2 x, vec2 y) {
  if (y.x <= 0.0 && y.y >= 0.0) {
    return ia_singular(0.0);
  }
  if (y.x == y.y) {
    float period = abs(y.x);
    float flo = floor(x.x / period);
    float fhi = floor(x.y / period);
    if (flo == fhi) {
      float mlo = x.x - period * flo;
      float mhi = x.y - period * flo;
      return ia_ok(vec2(min(mlo, mhi) - IA_EPS, max(mlo, mhi) + IA_EPS));
    }
    return ia_singular_right((flo + 1.0) * period);
  }
  IntervalResult q = ia_div(x, y);
  if (ia_is_error(q.status)) return q;
  IntervalResult fq = ia_floor(q.value);
  if (ia_is_error(fq.status)) return fq;
  return ia_sub(x, ia_mul_raw(y, fq.value));
}
IntervalResult ia_mod(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_mod(a.value, b.value);
}
IntervalResult ia_mod(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_mod(a.value, b);
}
IntervalResult ia_mod(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_mod(a, b.value);
}`,
},

ia_remainder: {
  deps: ['ia_div', 'ia_round', 'ia_sub', 'ia_mul_raw'],
  source: `
IntervalResult ia_remainder(vec2 a, vec2 b) {
  IntervalResult q = ia_div(a, b);
  if (ia_is_error(q.status)) return q;
  IntervalResult rq = ia_round(q.value);
  if (ia_is_error(rq.status)) return rq;
  return ia_sub(a, ia_mul_raw(b, rq.value));
}
IntervalResult ia_remainder(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_remainder(a.value, b.value);
}
IntervalResult ia_remainder(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_remainder(a.value, b);
}
IntervalResult ia_remainder(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_remainder(a, b.value);
}`,
},

// ── Min / Max ────────────────────────────────────────────────────────

ia_min: {
  deps: [],
  source: `
IntervalResult ia_min(vec2 a, vec2 b) {
  return ia_ok(vec2(min(a.x, b.x), min(a.y, b.y)));
}
IntervalResult ia_min(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_min(a.value, b.value);
}
IntervalResult ia_min(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_min(a.value, b);
}
IntervalResult ia_min(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_min(a, b.value);
}`,
},

ia_max: {
  deps: [],
  source: `
IntervalResult ia_max(vec2 a, vec2 b) {
  return ia_ok(vec2(max(a.x, b.x), max(a.y, b.y)));
}
IntervalResult ia_max(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status)) return a;
  if (ia_is_error(b.status)) return b;
  return ia_max(a.value, b.value);
}
IntervalResult ia_max(IntervalResult a, vec2 b) {
  if (ia_is_error(a.status)) return a;
  return ia_max(a.value, b);
}
IntervalResult ia_max(vec2 a, IntervalResult b) {
  if (ia_is_error(b.status)) return b;
  return ia_max(a, b.value);
}`,
},

// ── Power Functions ──────────────────────────────────────────────────

ia_pow: {
  deps: ['ia_square', 'ia_sqrt'],
  source: `
IntervalResult ia_pow(vec2 base, float exp) {
  if (exp == 0.0) return ia_ok(vec2(1.0, 1.0));
  if (exp == 1.0) return ia_ok(base);
  if (exp == 2.0) return ia_square(base);
  if (exp == 0.5) return ia_sqrt(base);
  if (base.y < 0.0) {
    return ia_empty();
  }
  if (base.x < 0.0) {
    if (exp > 0.0) {
      return ia_partial(vec2(0.0, pow(base.y, exp) + IA_EPS), IA_PARTIAL_LO);
    } else {
      return ia_partial(vec2(pow(base.y, exp) - IA_EPS, IA_HUGE), IA_PARTIAL_LO);
    }
  }
  if (exp > 0.0) {
    return ia_ok(vec2(pow(base.x, exp) - IA_EPS, pow(base.y, exp) + IA_EPS));
  } else {
    if (base.x == 0.0) {
      return ia_partial(vec2(pow(base.y, exp) - IA_EPS, IA_HUGE), IA_PARTIAL_HI);
    }
    return ia_ok(vec2(pow(base.y, exp) - IA_EPS, pow(base.x, exp) + IA_EPS));
  }
}
IntervalResult ia_pow(IntervalResult base, float exp) {
  if (ia_is_error(base.status)) return base;
  return ia_pow(base.value, exp);
}`,
},

ia_contains_extremum: {
  deps: [],
  source: `
bool ia_contains_extremum(vec2 x, float extremum, float period) {
  float n = ceil((x.x - extremum) / period);
  float candidate = extremum + n * period;
  return candidate >= x.x - 1e-7 && candidate <= x.y + 1e-7;
}`,
},

ia_pow_interval: {
  deps: ['ia_pow'],
  source: `
IntervalResult ia_pow_interval(vec2 base, vec2 exp) {
  if (exp.x == exp.y && fract(exp.x) == 0.0) {
    return ia_pow(base, exp.x);
  }
  if (base.x == -1.0 && base.y == -1.0 && (exp.y - exp.x) >= 2.0) {
    return ia_ok(vec2(-1.0, 1.0));
  }
  if (base.y <= 0.0) {
    return ia_empty();
  }
  float bLo = max(base.x, 1e-300);
  float bHi = base.y;
  float lnLo = log(bLo);
  float lnHi = log(bHi);
  float c1 = exp.x * lnLo;
  float c2 = exp.x * lnHi;
  float c3 = exp.y * lnLo;
  float c4 = exp.y * lnHi;
  float minC = min(min(c1, c2), min(c3, c4));
  float maxC = max(max(c1, c2), max(c3, c4));
  float lo = exp(minC) - IA_EPS;
  float hi = exp(maxC) + IA_EPS;
  if (base.x < 0.0) {
    return ia_partial(vec2(lo, hi), IA_PARTIAL_LO);
  }
  return ia_ok(vec2(lo, hi));
}
IntervalResult ia_pow_interval(IntervalResult base, IntervalResult exp) {
  if (ia_is_error(base.status)) return base;
  if (ia_is_error(exp.status)) return exp;
  return ia_pow_interval(base.value, exp.value);
}
IntervalResult ia_pow_interval(vec2 base, IntervalResult exp) {
  if (ia_is_error(exp.status)) return exp;
  return ia_pow_interval(base, exp.value);
}
IntervalResult ia_pow_interval(IntervalResult base, vec2 exp) {
  if (ia_is_error(base.status)) return base;
  return ia_pow_interval(base.value, exp);
}`,
},

// ── Trigonometric Functions ──────────────────────────────────────────

ia_sin: {
  deps: ['ia_contains_extremum'],
  source: `
IntervalResult ia_sin(vec2 x) {
  const float TWO_PI = 6.28318530718;
  const float HALF_PI = 1.57079632679;
  const float THREE_HALF_PI = 4.71238898038;
  if (x.y - x.x >= TWO_PI) {
    return ia_ok(vec2(-1.0, 1.0));
  }
  float sinLo = sin(x.x);
  float sinHi = sin(x.y);
  float lo = min(sinLo, sinHi);
  float hi = max(sinLo, sinHi);
  if (ia_contains_extremum(x, HALF_PI, TWO_PI)) hi = 1.0;
  if (ia_contains_extremum(x, THREE_HALF_PI, TWO_PI)) lo = -1.0;
  return ia_ok(vec2(lo - IA_EPS, hi + IA_EPS));
}
IntervalResult ia_sin(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sin(x.value);
}`,
},

ia_cos: {
  deps: ['ia_contains_extremum'],
  source: `
IntervalResult ia_cos(vec2 x) {
  const float TWO_PI = 6.28318530718;
  const float PI = 3.14159265359;
  if (x.y - x.x >= TWO_PI) {
    return ia_ok(vec2(-1.0, 1.0));
  }
  float cosLo = cos(x.x);
  float cosHi = cos(x.y);
  float lo = min(cosLo, cosHi);
  float hi = max(cosLo, cosHi);
  if (ia_contains_extremum(x, 0.0, TWO_PI)) hi = 1.0;
  if (ia_contains_extremum(x, PI, TWO_PI)) lo = -1.0;
  return ia_ok(vec2(lo - IA_EPS, hi + IA_EPS));
}
IntervalResult ia_cos(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_cos(x.value);
}`,
},

ia_tan: {
  deps: ['ia_contains_extremum'],
  source: `
IntervalResult ia_tan(vec2 x) {
  const float PI = 3.14159265359;
  const float HALF_PI = 1.57079632679;
  if (x.y - x.x >= PI) {
    return ia_singular(0.0);
  }
  if (ia_contains_extremum(x, HALF_PI, PI)) {
    float n = ceil((x.x - HALF_PI) / PI);
    float poleAt = HALF_PI + n * PI;
    return ia_singular(poleAt);
  }
  float tanLo = tan(x.x);
  float tanHi = tan(x.y);
  if ((tanLo > 1e10 && tanHi < -1e10) || (tanLo < -1e10 && tanHi > 1e10)) {
    return ia_singular(0.0);
  }
  return ia_ok(vec2(tanLo - IA_EPS, tanHi + IA_EPS));
}
IntervalResult ia_tan(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_tan(x.value);
}`,
},

// ── Inverse Trigonometric Functions ──────────────────────────────────

ia_asin: {
  deps: [],
  source: `
IntervalResult ia_asin(vec2 x) {
  if (x.x > 1.0 || x.y < -1.0) {
    return ia_empty();
  }
  vec2 clipped = vec2(max(x.x, -1.0), min(x.y, 1.0));
  if (x.x < -1.0 || x.y > 1.0) {
    float clip = (x.x < -1.0 && x.y > 1.0) ? IA_PARTIAL_BOTH :
                 (x.x < -1.0) ? IA_PARTIAL_LO : IA_PARTIAL_HI;
    return ia_partial(vec2(asin(clipped.x) - IA_EPS, asin(clipped.y) + IA_EPS), clip);
  }
  return ia_ok(vec2(asin(x.x) - IA_EPS, asin(x.y) + IA_EPS));
}
IntervalResult ia_asin(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asin(x.value);
}`,
},

ia_acos: {
  deps: [],
  source: `
IntervalResult ia_acos(vec2 x) {
  if (x.x > 1.0 || x.y < -1.0) {
    return ia_empty();
  }
  vec2 clipped = vec2(max(x.x, -1.0), min(x.y, 1.0));
  if (x.x < -1.0 || x.y > 1.0) {
    float clip = (x.x < -1.0 && x.y > 1.0) ? IA_PARTIAL_BOTH :
                 (x.x < -1.0) ? IA_PARTIAL_LO : IA_PARTIAL_HI;
    return ia_partial(vec2(acos(clipped.y) - IA_EPS, acos(clipped.x) + IA_EPS), clip);
  }
  return ia_ok(vec2(acos(x.y) - IA_EPS, acos(x.x) + IA_EPS));
}
IntervalResult ia_acos(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acos(x.value);
}`,
},

ia_atan: {
  deps: [],
  source: `
IntervalResult ia_atan(vec2 x) {
  return ia_ok(vec2(atan(x.x) - IA_EPS, atan(x.y) + IA_EPS));
}
IntervalResult ia_atan(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_atan(x.value);
}`,
},

// ── Hyperbolic Functions ─────────────────────────────────────────────

ia_sinh: {
  deps: [],
  source: `
IntervalResult ia_sinh(vec2 x) {
  return ia_ok(vec2(sinh(x.x) - IA_EPS, sinh(x.y) + IA_EPS));
}
IntervalResult ia_sinh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sinh(x.value);
}`,
},

ia_cosh: {
  deps: [],
  source: `
IntervalResult ia_cosh(vec2 x) {
  if (x.x >= 0.0) {
    return ia_ok(vec2(cosh(x.x) - IA_EPS, cosh(x.y) + IA_EPS));
  } else if (x.y <= 0.0) {
    return ia_ok(vec2(cosh(x.y) - IA_EPS, cosh(x.x) + IA_EPS));
  } else {
    return ia_ok(vec2(1.0 - IA_EPS, max(cosh(x.x), cosh(x.y)) + IA_EPS));
  }
}
IntervalResult ia_cosh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_cosh(x.value);
}`,
},

ia_tanh: {
  deps: [],
  source: `
IntervalResult ia_tanh(vec2 x) {
  return ia_ok(vec2(tanh(x.x) - IA_EPS, tanh(x.y) + IA_EPS));
}
IntervalResult ia_tanh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_tanh(x.value);
}`,
},

// ── Reciprocal Trigonometric Functions ────────────────────────────────

ia_cot: {
  deps: ['ia_div', 'ia_cos', 'ia_sin'],
  source: `
IntervalResult ia_cot(vec2 x) {
  return ia_div(ia_cos(x), ia_sin(x));
}
IntervalResult ia_cot(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_cot(x.value);
}`,
},

ia_csc: {
  deps: ['ia_div', 'ia_sin'],
  source: `
IntervalResult ia_csc(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_sin(x));
}
IntervalResult ia_csc(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_csc(x.value);
}`,
},

ia_sec: {
  deps: ['ia_div', 'ia_cos'],
  source: `
IntervalResult ia_sec(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_cos(x));
}
IntervalResult ia_sec(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sec(x.value);
}`,
},

// ── Inverse Reciprocal Trigonometric Functions ───────────────────────

ia_acot: {
  deps: ['ia_atan', 'ia_div'],
  source: `
IntervalResult ia_acot(vec2 x) {
  return ia_atan(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}
IntervalResult ia_acot(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acot(x.value);
}`,
},

ia_acsc: {
  deps: ['ia_asin', 'ia_div'],
  source: `
IntervalResult ia_acsc(vec2 x) {
  return ia_asin(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}
IntervalResult ia_acsc(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acsc(x.value);
}`,
},

ia_asec: {
  deps: ['ia_acos', 'ia_div'],
  source: `
IntervalResult ia_asec(vec2 x) {
  return ia_acos(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}
IntervalResult ia_asec(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asec(x.value);
}`,
},

// ── Reciprocal Hyperbolic Functions ──────────────────────────────────

ia_coth: {
  deps: ['ia_div', 'ia_cosh', 'ia_sinh'],
  source: `
IntervalResult ia_coth(vec2 x) {
  return ia_div(ia_cosh(x), ia_sinh(x));
}
IntervalResult ia_coth(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_coth(x.value);
}`,
},

ia_csch: {
  deps: ['ia_div', 'ia_sinh'],
  source: `
IntervalResult ia_csch(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_sinh(x));
}
IntervalResult ia_csch(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_csch(x.value);
}`,
},

ia_sech: {
  deps: ['ia_div', 'ia_cosh'],
  source: `
IntervalResult ia_sech(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_cosh(x));
}
IntervalResult ia_sech(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sech(x.value);
}`,
},

// ── Inverse Hyperbolic Functions ─────────────────────────────────────

ia_asinh: {
  deps: [],
  source: `
IntervalResult ia_asinh(vec2 x) {
  return ia_ok(vec2(asinh(x.x) - IA_EPS, asinh(x.y) + IA_EPS));
}
IntervalResult ia_asinh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asinh(x.value);
}`,
},

ia_acosh: {
  deps: [],
  source: `
IntervalResult ia_acosh(vec2 x) {
  if (x.y < 1.0) {
    return ia_empty();
  }
  if (x.x >= 1.0) {
    return ia_ok(vec2(acosh(x.x) - IA_EPS, acosh(x.y) + IA_EPS));
  }
  return ia_partial(vec2(0.0, acosh(x.y) + IA_EPS), IA_PARTIAL_LO);
}
IntervalResult ia_acosh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acosh(x.value);
}`,
},

ia_atanh: {
  deps: [],
  source: `
IntervalResult ia_atanh(vec2 x) {
  if (x.x >= 1.0 || x.y <= -1.0) {
    return ia_empty();
  }
  vec2 clipped = vec2(max(x.x, -1.0 + IA_EPS), min(x.y, 1.0 - IA_EPS));
  if (x.x < -1.0 || x.y > 1.0) {
    float clip = (x.x < -1.0 && x.y > 1.0) ? IA_PARTIAL_BOTH :
                 (x.x < -1.0) ? IA_PARTIAL_LO : IA_PARTIAL_HI;
    return ia_partial(vec2(atanh(clipped.x) - IA_EPS, atanh(clipped.y) + IA_EPS), clip);
  }
  return ia_ok(vec2(atanh(x.x) - IA_EPS, atanh(x.y) + IA_EPS));
}
IntervalResult ia_atanh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_atanh(x.value);
}`,
},

// ── Inverse Reciprocal Hyperbolic Functions ──────────────────────────

ia_acoth: {
  deps: ['ia_atanh', 'ia_div'],
  source: `
IntervalResult ia_acoth(vec2 x) {
  return ia_atanh(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}
IntervalResult ia_acoth(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acoth(x.value);
}`,
},

ia_acsch: {
  deps: ['ia_asinh', 'ia_div'],
  source: `
IntervalResult ia_acsch(vec2 x) {
  return ia_asinh(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}
IntervalResult ia_acsch(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acsch(x.value);
}`,
},

ia_asech: {
  deps: ['ia_acosh', 'ia_div'],
  source: `
IntervalResult ia_asech(vec2 x) {
  return ia_acosh(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}
IntervalResult ia_asech(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asech(x.value);
}`,
},

// ── Gamma / Factorial Functions ──────────────────────────────────────

_gpu_gamma: {
  deps: [],
  source: `
float _gpu_gamma(float z) {
  const float PI = 3.14159265358979;
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
}`,
},

ia_gamma: {
  deps: ['_gpu_gamma'],
  source: `
IntervalResult ia_gamma(vec2 x) {
  const float GAMMA_MIN_X = 1.4616321;
  const float GAMMA_MIN_Y = 0.8856032;
  if (x.x <= 0.0 && x.y >= 0.0) {
    return ia_singular(0.0);
  }
  if (x.x < 0.0) {
    float ceilLo = ceil(x.x);
    float floorHi = floor(x.y);
    if (ceilLo <= floorHi) {
      return ia_singular(ceilLo);
    }
    float gLo = _gpu_gamma(x.x);
    float gHi = _gpu_gamma(x.y);
    return ia_ok(vec2(min(gLo, gHi) - IA_EPS, max(gLo, gHi) + IA_EPS));
  }
  if (x.x >= GAMMA_MIN_X) {
    return ia_ok(vec2(_gpu_gamma(x.x) - IA_EPS, _gpu_gamma(x.y) + IA_EPS));
  }
  if (x.y <= GAMMA_MIN_X) {
    return ia_ok(vec2(_gpu_gamma(x.y) - IA_EPS, _gpu_gamma(x.x) + IA_EPS));
  }
  float gMax = max(_gpu_gamma(x.x), _gpu_gamma(x.y));
  return ia_ok(vec2(GAMMA_MIN_Y - IA_EPS, gMax + IA_EPS));
}
IntervalResult ia_gamma(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_gamma(x.value);
}`,
},

_gpu_gammaln: {
  deps: [],
  source: `
float _gpu_gammaln(float z) {
  float z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}`,
},

ia_gammaln: {
  deps: ['_gpu_gammaln'],
  source: `
IntervalResult ia_gammaln(vec2 x) {
  if (x.y <= 0.0) return ia_empty();
  if (x.x > 0.0) {
    return ia_ok(vec2(_gpu_gammaln(x.x) - IA_EPS, _gpu_gammaln(x.y) + IA_EPS));
  }
  return ia_partial(vec2(0.0, _gpu_gammaln(x.y) + IA_EPS), IA_PARTIAL_LO);
}
IntervalResult ia_gammaln(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_gammaln(x.value);
}`,
},

ia_factorial: {
  deps: ['ia_gamma', 'ia_add'],
  source: `
IntervalResult ia_factorial(vec2 x) {
  return ia_gamma(ia_add(ia_ok(x), ia_point(1.0)));
}
IntervalResult ia_factorial(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_factorial(x.value);
}`,
},

// ── Comparison / Logic Functions ─────────────────────────────────────

ia_less: {
  deps: [],
  source: `
float ia_less(vec2 a, vec2 b) {
  if (a.y < b.x) return IA_TRUE;
  if (a.x >= b.y) return IA_FALSE;
  return IA_MAYBE;
}
float ia_less(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_less(a.value, b.value);
}`,
},

ia_lessEqual: {
  deps: [],
  source: `
float ia_lessEqual(vec2 a, vec2 b) {
  if (a.y <= b.x) return IA_TRUE;
  if (a.x > b.y) return IA_FALSE;
  return IA_MAYBE;
}
float ia_lessEqual(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_lessEqual(a.value, b.value);
}`,
},

ia_greater: {
  deps: [],
  source: `
float ia_greater(vec2 a, vec2 b) {
  if (a.x > b.y) return IA_TRUE;
  if (a.y <= b.x) return IA_FALSE;
  return IA_MAYBE;
}
float ia_greater(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_greater(a.value, b.value);
}`,
},

ia_greaterEqual: {
  deps: [],
  source: `
float ia_greaterEqual(vec2 a, vec2 b) {
  if (a.x >= b.y) return IA_TRUE;
  if (a.y < b.x) return IA_FALSE;
  return IA_MAYBE;
}
float ia_greaterEqual(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_greaterEqual(a.value, b.value);
}`,
},

ia_equal: {
  deps: [],
  source: `
float ia_equal(vec2 a, vec2 b) {
  if (a.x == a.y && b.x == b.y && a.x == b.x) return IA_TRUE;
  if (a.y < b.x || b.y < a.x) return IA_FALSE;
  return IA_MAYBE;
}
float ia_equal(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_equal(a.value, b.value);
}`,
},

ia_notEqual: {
  deps: ['ia_equal'],
  source: `
float ia_notEqual(vec2 a, vec2 b) {
  float eq = ia_equal(a, b);
  if (eq == IA_TRUE) return IA_FALSE;
  if (eq == IA_FALSE) return IA_TRUE;
  return IA_MAYBE;
}
float ia_notEqual(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_notEqual(a.value, b.value);
}`,
},

ia_and: {
  deps: [],
  source: `
float ia_and(float a, float b) {
  if (a == IA_FALSE || b == IA_FALSE) return IA_FALSE;
  if (a == IA_TRUE && b == IA_TRUE) return IA_TRUE;
  return IA_MAYBE;
}`,
},

ia_or: {
  deps: [],
  source: `
float ia_or(float a, float b) {
  if (a == IA_TRUE || b == IA_TRUE) return IA_TRUE;
  if (a == IA_FALSE && b == IA_FALSE) return IA_FALSE;
  return IA_MAYBE;
}`,
},

ia_not: {
  deps: [],
  source: `
float ia_not(float a) {
  if (a == IA_TRUE) return IA_FALSE;
  if (a == IA_FALSE) return IA_TRUE;
  return IA_MAYBE;
}`,
},

}; // end GLSL_IA_FUNCTIONS

/**
 * Build a minimal interval preamble containing only the helper functions
 * actually referenced by `code`, plus their transitive dependencies,
 * emitted in topological (dependency-first) order.
 *
 * The foundation (struct, constants, constructors) is always included.
 */
function buildIntervalPreamble(code: string): string {
  // 1. Find all ia_* / _gpu_* calls in the compiled code
  const needed = new Set<string>();
  for (const name of Object.keys(GLSL_IA_FUNCTIONS)) {
    if (code.includes(name)) needed.add(name);
  }

  if (needed.size === 0) return GLSL_IA_FOUNDATION;

  // 2. Resolve transitive dependencies
  const resolved = new Set<string>();
  function resolve(name: string): void {
    if (resolved.has(name)) return;
    const def = GLSL_IA_FUNCTIONS[name];
    if (!def) return;
    for (const dep of def.deps) resolve(dep);
    resolved.add(name);
  }
  for (const name of needed) resolve(name);

  // 3. `resolved` is already in topological order (deps before dependents)
  const parts: string[] = [GLSL_IA_FOUNDATION];
  for (const name of resolved) {
    parts.push(GLSL_IA_FUNCTIONS[name].source);
  }
  return parts.join('\n');
}

/**
 * Reconstruct the full interval library from foundation + all registry entries.
 */
function getFullIntervalLibrary(): string {
  const parts: string[] = [GLSL_IA_FOUNDATION];
  for (const name of Object.keys(GLSL_IA_FUNCTIONS)) {
    parts.push(GLSL_IA_FUNCTIONS[name].source);
  }
  return parts.join('\n');
}

/**
 * GLSL interval operators - all become function calls
 */
const INTERVAL_GLSL_OPERATORS: CompiledOperators = {
  Add: ['ia_add', 20],
  Negate: ['ia_negate', 20],
  Subtract: ['ia_sub', 20],
  Multiply: ['ia_mul', 20],
  Divide: ['ia_div', 20],
};

/**
 * GLSL interval function implementations
 */
const INTERVAL_GLSL_FUNCTIONS: CompiledFunctions<Expression> = {
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
    // Check if this is e^x (base is ExponentialE)
    if (isSymbol(base) && base.symbol === 'ExponentialE') {
      return `ia_exp(${compile(exp)})`;
    }
    if (exp && isNumber(exp) && exp.im === 0) {
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
    if (exp && isNumber(exp) && exp.im === 0) {
      return `ia_pow(${compile(arg)}, ${1 / exp.re})`;
    }
    throw new Error('Interval GLSL does not support variable root indices');
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

  // Comparison and logic (return float: 1.0=true, 0.0=false, 0.5=maybe)
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
 * GLSL interval arithmetic target implementation.
 */
export class IntervalGLSLTarget implements LanguageTarget<Expression> {
  getOperators(): CompiledOperators {
    return INTERVAL_GLSL_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return INTERVAL_GLSL_FUNCTIONS;
  }

  /**
   * Get the full GLSL interval library code (all functions).
   *
   * This should be included in shaders that use interval arithmetic.
   */
  getLibrary(): string {
    return getFullIntervalLibrary();
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    return {
      language: 'interval-glsl',
      // Don't use operators - all arithmetic goes through functions
      // because interval arithmetic returns IntervalResult, not numbers
      operators: () => undefined,
      functions: (id) => INTERVAL_GLSL_FUNCTIONS[id],
      var: (id) => {
        const constants: Record<string, string> = {
          Pi: 'ia_point(3.14159265359)',
          ExponentialE: 'ia_point(2.71828182846)',
          GoldenRatio: 'ia_point(1.61803398875)',
          CatalanConstant: 'ia_point(0.91596559417)',
          EulerGamma: 'ia_point(0.57721566490)',
        };
        if (id in constants) return constants[id];
        return id; // Variables use their names directly
      },
      string: (str) => JSON.stringify(str),
      number: (n) => {
        // GLSL requires float literals with decimal point
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
  ): CompilationResult {
    const { functions, vars } = options;

    const target = this.createTarget({
      functions: (id) => {
        if (functions && id in functions) {
          const fn = functions[id];
          if (typeof fn === 'string') return fn;
          if (typeof fn === 'function') return fn.name || id;
        }
        return INTERVAL_GLSL_FUNCTIONS[id];
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

    const glslCode = BaseCompiler.compile(expr, target);

    return {
      target: 'interval-glsl',
      success: true,
      code: glslCode,
      preamble: buildIntervalPreamble(glslCode),
    };
  }

  /**
   * Compile an expression to GLSL interval code string.
   */
  compileToSource(
    expr: Expression,
    _options: CompilationOptions<Expression> = {}
  ): string {
    const target = this.createTarget();
    return BaseCompiler.compile(expr, target);
  }

  /**
   * Create a complete GLSL interval function from an expression.
   *
   * @param expr - The expression to compile
   * @param functionName - Name of the GLSL function
   * @param parameters - Parameter names (each becomes a vec2 interval input)
   */
  compileFunction(
    expr: Expression,
    functionName: string,
    parameters: string[]
  ): string {
    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);

    const params = parameters.map((name) => `vec2 ${name}`).join(', ');

    return `IntervalResult ${functionName}(${params}) {
  return ${body};
}`;
  }

  /**
   * Create a complete GLSL fragment shader for interval function plotting.
   *
   * @param expr - The expression to compile
   * @param options - Shader options
   */
  compileShaderFunction(
    expr: Expression,
    options: {
      functionName?: string;
      version?: string;
      parameters?: string[];
    } = {}
  ): string {
    const {
      functionName = 'evaluateInterval',
      version = '300 es',
      parameters = ['x'],
    } = options;

    const target = this.createTarget();
    const body = BaseCompiler.compile(expr, target);
    const params = parameters.map((name) => `vec2 ${name}`).join(', ');
    const preamble = buildIntervalPreamble(body);

    return `#version ${version}
precision highp float;

${preamble}

IntervalResult ${functionName}(${params}) {
  return ${body};
}
`;
  }
}
