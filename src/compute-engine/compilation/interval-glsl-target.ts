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

import type { BoxedExpression } from '../global-types';
import type { MathJsonSymbol } from '../../math-json/types';

import { BaseCompiler } from './base-compiler';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompiledExecutable,
} from './types';

/**
 * GLSL interval library code.
 *
 * This is prepended to compiled shaders to provide interval arithmetic functions.
 * Uses vec2 for intervals and float status flags.
 */
const GLSL_INTERVAL_LIBRARY = `
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

// Addition
IntervalResult ia_add(vec2 a, vec2 b) {
  return ia_ok(vec2(a.x + b.x - IA_EPS, a.y + b.y + IA_EPS));
}

// Subtraction
IntervalResult ia_sub(vec2 a, vec2 b) {
  return ia_ok(vec2(a.x - b.y - IA_EPS, a.y - b.x + IA_EPS));
}

// Negation
IntervalResult ia_negate(vec2 x) {
  return ia_ok(vec2(-x.y, -x.x));
}

// Multiplication helper (returns vec2)
vec2 ia_mul_raw(vec2 a, vec2 b) {
  float p1 = a.x * b.x;
  float p2 = a.x * b.y;
  float p3 = a.y * b.x;
  float p4 = a.y * b.y;
  return vec2(
    min(min(p1, p2), min(p3, p4)) - IA_EPS,
    max(max(p1, p2), max(p3, p4)) + IA_EPS
  );
}

// Multiplication
IntervalResult ia_mul(vec2 a, vec2 b) {
  return ia_ok(ia_mul_raw(a, b));
}

// Division
IntervalResult ia_div(vec2 a, vec2 b) {
  // Case 1: Divisor entirely positive or negative
  if (b.x > 0.0 || b.y < 0.0) {
    return ia_ok(ia_mul_raw(a, vec2(1.0 / b.y, 1.0 / b.x)));
  }

  // Case 2: Divisor strictly contains zero
  if (b.x < 0.0 && b.y > 0.0) {
    return ia_singular(0.0);
  }

  // Case 3: Divisor touches zero at lower bound [0, c]
  if (b.x == 0.0 && b.y > 0.0) {
    if (a.x >= 0.0) {
      return ia_partial(vec2(a.x / b.y, IA_HUGE), IA_PARTIAL_HI);
    } else if (a.y <= 0.0) {
      return ia_partial(vec2(-IA_HUGE, a.y / b.y), IA_PARTIAL_LO);
    } else {
      return ia_entire();
    }
  }

  // Case 4: Divisor touches zero at upper bound [c, 0]
  if (b.y == 0.0 && b.x < 0.0) {
    if (a.x >= 0.0) {
      return ia_partial(vec2(-IA_HUGE, a.x / b.x), IA_PARTIAL_LO);
    } else if (a.y <= 0.0) {
      return ia_partial(vec2(a.y / b.x, IA_HUGE), IA_PARTIAL_HI);
    } else {
      return ia_entire();
    }
  }

  // Case 5: Divisor is [0, 0]
  return ia_empty();
}

// Square root
IntervalResult ia_sqrt(vec2 x) {
  if (x.y < 0.0) {
    return ia_empty();
  }
  if (x.x >= 0.0) {
    return ia_ok(vec2(sqrt(x.x), sqrt(x.y) + IA_EPS));
  }
  return ia_partial(vec2(0.0, sqrt(x.y) + IA_EPS), IA_PARTIAL_LO);
}

// Square
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

// Exponential
IntervalResult ia_exp(vec2 x) {
  return ia_ok(vec2(exp(x.x) - IA_EPS, exp(x.y) + IA_EPS));
}

// Natural logarithm
IntervalResult ia_ln(vec2 x) {
  if (x.y <= 0.0) {
    return ia_empty();
  }
  if (x.x > 0.0) {
    return ia_ok(vec2(log(x.x) - IA_EPS, log(x.y) + IA_EPS));
  }
  return ia_partial(vec2(-IA_HUGE, log(x.y) + IA_EPS), IA_PARTIAL_LO);
}

// Log base 2
IntervalResult ia_log2(vec2 x) {
  const float INV_LN2 = 1.44269504089;
  if (x.y <= 0.0) return ia_empty();
  if (x.x > 0.0) return ia_ok(vec2(log2(x.x) - IA_EPS, log2(x.y) + IA_EPS));
  return ia_partial(vec2(-IA_HUGE, log2(x.y) + IA_EPS), IA_PARTIAL_LO);
}

// Log base 10
IntervalResult ia_log10(vec2 x) {
  const float INV_LN10 = 0.43429448190;
  if (x.y <= 0.0) return ia_empty();
  if (x.x > 0.0) return ia_ok(vec2(log(x.x) * INV_LN10 - IA_EPS, log(x.y) * INV_LN10 + IA_EPS));
  return ia_partial(vec2(-IA_HUGE, log(x.y) * INV_LN10 + IA_EPS), IA_PARTIAL_LO);
}

// Absolute value
IntervalResult ia_abs(vec2 x) {
  if (x.x >= 0.0) {
    return ia_ok(x);
  }
  if (x.y <= 0.0) {
    return ia_ok(vec2(-x.y, -x.x));
  }
  return ia_ok(vec2(0.0, max(-x.x, x.y)));
}

// Sign function - has jump discontinuity at 0
IntervalResult ia_sign(vec2 x) {
  if (x.x > 0.0) return ia_ok(vec2(1.0, 1.0));
  if (x.y < 0.0) return ia_ok(vec2(-1.0, -1.0));
  if (x.x == 0.0 && x.y == 0.0) return ia_ok(vec2(0.0, 0.0));
  // Interval spans 0 - discontinuity
  return ia_singular(0.0);
}

// Floor - has jump discontinuities at every integer
IntervalResult ia_floor(vec2 x) {
  float flo = floor(x.x);
  float fhi = floor(x.y);
  if (flo == fhi) {
    return ia_ok(vec2(flo, fhi));
  }
  // Interval spans an integer boundary - discontinuity at first integer > x.x
  // floor is right-continuous
  return ia_singular_right(flo + 1.0);
}

// Ceiling - has jump discontinuities at every integer
IntervalResult ia_ceil(vec2 x) {
  float clo = ceil(x.x);
  float chi = ceil(x.y);
  if (clo == chi) {
    return ia_ok(vec2(clo, chi));
  }
  // Interval spans an integer boundary - discontinuity at ceil(x.x)
  // ceil is left-continuous
  return ia_singular_left(clo);
}

// Round - has jump discontinuities at every half-integer
// Note: GLSL round() uses IEEE 754 round-half-to-even, while JS Math.round
// uses round-half-up. They differ only AT half-integers; discontinuity
// detection is safe because intervals spanning half-integers return singular.
IntervalResult ia_round(vec2 x) {
  float rlo = round(x.x);
  float rhi = round(x.y);
  if (rlo == rhi) {
    return ia_ok(vec2(rlo, rhi));
  }
  // Interval spans a half-integer boundary - discontinuity
  // round is right-continuous (with round-half-up convention)
  return ia_singular_right(rlo + 0.5);
}

// Fract - sawtooth discontinuities at every integer
// fract(x) = x - floor(x), jumps from ~1 back to 0 at each integer
IntervalResult ia_fract(vec2 x) {
  float flo = floor(x.x);
  float fhi = floor(x.y);
  if (flo == fhi) {
    // No integer crossing - fract is continuous (linear) on this interval
    return ia_ok(vec2(fract(x.x) - IA_EPS, fract(x.y) + IA_EPS));
  }
  // Interval spans an integer - sawtooth discontinuity
  // fract is right-continuous (inherits from floor)
  return ia_singular_right(flo + 1.0);
}

// Truncate toward zero - floor for positive, ceil for negative
// Discontinuous at every non-zero integer, continuous at zero
IntervalResult ia_trunc(vec2 x) {
  float tlo = trunc(x.x);
  float thi = trunc(x.y);
  if (tlo == thi) return ia_ok(vec2(tlo, thi));
  if (x.x >= 0.0) return ia_singular_right(tlo + 1.0);  // like floor
  float firstInt = ceil(x.x);
  if (firstInt != 0.0) return ia_singular_left(firstInt); // like ceil
  return ia_singular_right(1.0); // spans zero, first discontinuity at +1
}

// Mod - periodic discontinuities at multiples of the modulus
// mod(x, y) = x - y * floor(x / y)
IntervalResult ia_mod(vec2 x, vec2 y) {
  // y contains zero - undefined
  if (y.x <= 0.0 && y.y >= 0.0) {
    return ia_singular(0.0);
  }

  // Constant modulus (point interval) - common case
  if (y.x == y.y) {
    float period = abs(y.x);
    float flo = floor(x.x / period);
    float fhi = floor(x.y / period);
    if (flo == fhi) {
      // No discontinuity - mod is continuous (linear) on this interval
      float mlo = x.x - period * flo;
      float mhi = x.y - period * flo;
      return ia_ok(vec2(min(mlo, mhi) - IA_EPS, max(mlo, mhi) + IA_EPS));
    }
    // Discontinuity at first multiple of period in the interval
    // mod has sawtooth discontinuities, right-continuous
    return ia_singular_right((flo + 1.0) * period);
  }

  // General case: compose from existing operations
  // Discontinuity detection comes from ia_floor
  IntervalResult q = ia_div(x, y);
  if (ia_is_error(q.status)) return q;
  IntervalResult fq = ia_floor(q.value);
  if (ia_is_error(fq.status)) return fq;
  return ia_sub(x, ia_mul_raw(y, fq.value));
}

// Min of two intervals
IntervalResult ia_min(vec2 a, vec2 b) {
  return ia_ok(vec2(min(a.x, b.x), min(a.y, b.y)));
}

// Max of two intervals
IntervalResult ia_max(vec2 a, vec2 b) {
  return ia_ok(vec2(max(a.x, b.x), max(a.y, b.y)));
}

// Power with constant exponent
IntervalResult ia_pow(vec2 base, float exp) {
  if (exp == 0.0) return ia_ok(vec2(1.0, 1.0));
  if (exp == 1.0) return ia_ok(base);
  if (exp == 2.0) return ia_square(base);
  if (exp == 0.5) return ia_sqrt(base);

  // General case - requires positive base for non-integer exponents
  if (base.y < 0.0) {
    return ia_empty();
  }
  if (base.x < 0.0) {
    // Partial domain
    if (exp > 0.0) {
      return ia_partial(vec2(0.0, pow(base.y, exp) + IA_EPS), IA_PARTIAL_LO);
    } else {
      return ia_partial(vec2(pow(base.y, exp) - IA_EPS, IA_HUGE), IA_PARTIAL_LO);
    }
  }

  // Entirely non-negative
  if (exp > 0.0) {
    return ia_ok(vec2(pow(base.x, exp) - IA_EPS, pow(base.y, exp) + IA_EPS));
  } else {
    if (base.x == 0.0) {
      return ia_partial(vec2(pow(base.y, exp) - IA_EPS, IA_HUGE), IA_PARTIAL_HI);
    }
    return ia_ok(vec2(pow(base.y, exp) - IA_EPS, pow(base.x, exp) + IA_EPS));
  }
}

// Check if interval contains extremum at (extremum + n * period)
bool ia_contains_extremum(vec2 x, float extremum, float period) {
  float n = ceil((x.x - extremum) / period);
  float candidate = extremum + n * period;
  return candidate >= x.x - 1e-7 && candidate <= x.y + 1e-7;
}

// Sine
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

// Cosine
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

// Tangent
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

// Arc sine
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

// Arc cosine
IntervalResult ia_acos(vec2 x) {
  if (x.x > 1.0 || x.y < -1.0) {
    return ia_empty();
  }

  vec2 clipped = vec2(max(x.x, -1.0), min(x.y, 1.0));

  if (x.x < -1.0 || x.y > 1.0) {
    float clip = (x.x < -1.0 && x.y > 1.0) ? IA_PARTIAL_BOTH :
                 (x.x < -1.0) ? IA_PARTIAL_LO : IA_PARTIAL_HI;
    // acos is decreasing, so bounds swap
    return ia_partial(vec2(acos(clipped.y) - IA_EPS, acos(clipped.x) + IA_EPS), clip);
  }

  // acos is decreasing
  return ia_ok(vec2(acos(x.y) - IA_EPS, acos(x.x) + IA_EPS));
}

// Arc tangent
IntervalResult ia_atan(vec2 x) {
  return ia_ok(vec2(atan(x.x) - IA_EPS, atan(x.y) + IA_EPS));
}

// Hyperbolic sine
IntervalResult ia_sinh(vec2 x) {
  return ia_ok(vec2(sinh(x.x) - IA_EPS, sinh(x.y) + IA_EPS));
}

// Hyperbolic cosine
IntervalResult ia_cosh(vec2 x) {
  if (x.x >= 0.0) {
    return ia_ok(vec2(cosh(x.x) - IA_EPS, cosh(x.y) + IA_EPS));
  } else if (x.y <= 0.0) {
    return ia_ok(vec2(cosh(x.y) - IA_EPS, cosh(x.x) + IA_EPS));
  } else {
    return ia_ok(vec2(1.0 - IA_EPS, max(cosh(x.x), cosh(x.y)) + IA_EPS));
  }
}

// Hyperbolic tangent
IntervalResult ia_tanh(vec2 x) {
  return ia_ok(vec2(tanh(x.x) - IA_EPS, tanh(x.y) + IA_EPS));
}

// IntervalResult overloads for propagation
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
}

IntervalResult ia_negate(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_negate(x.value);
}

IntervalResult ia_sqrt(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sqrt(x.value);
}

IntervalResult ia_square(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_square(x.value);
}

IntervalResult ia_exp(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_exp(x.value);
}

IntervalResult ia_ln(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_ln(x.value);
}

IntervalResult ia_log2(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_log2(x.value);
}

IntervalResult ia_log10(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_log10(x.value);
}

IntervalResult ia_abs(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_abs(x.value);
}

IntervalResult ia_sign(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sign(x.value);
}

IntervalResult ia_floor(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_floor(x.value);
}

IntervalResult ia_ceil(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_ceil(x.value);
}

IntervalResult ia_round(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_round(x.value);
}

IntervalResult ia_fract(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_fract(x.value);
}

IntervalResult ia_trunc(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_trunc(x.value);
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
}

IntervalResult ia_pow(IntervalResult base, float exp) {
  if (ia_is_error(base.status)) return base;
  return ia_pow(base.value, exp);
}

IntervalResult ia_sin(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sin(x.value);
}

IntervalResult ia_cos(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_cos(x.value);
}

IntervalResult ia_tan(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_tan(x.value);
}

IntervalResult ia_asin(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asin(x.value);
}

IntervalResult ia_acos(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acos(x.value);
}

IntervalResult ia_atan(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_atan(x.value);
}

IntervalResult ia_sinh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sinh(x.value);
}

IntervalResult ia_cosh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_cosh(x.value);
}

IntervalResult ia_tanh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_tanh(x.value);
}

// Cotangent (derived from cos/sin)
IntervalResult ia_cot(vec2 x) {
  return ia_div(ia_cos(x), ia_sin(x));
}

IntervalResult ia_cot(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_cot(x.value);
}

// Cosecant (derived from 1/sin)
IntervalResult ia_csc(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_sin(x));
}

IntervalResult ia_csc(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_csc(x.value);
}

// Secant (derived from 1/cos)
IntervalResult ia_sec(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_cos(x));
}

IntervalResult ia_sec(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sec(x.value);
}

// Inverse cotangent
IntervalResult ia_acot(vec2 x) {
  return ia_atan(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}

IntervalResult ia_acot(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acot(x.value);
}

// Inverse cosecant
IntervalResult ia_acsc(vec2 x) {
  return ia_asin(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}

IntervalResult ia_acsc(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acsc(x.value);
}

// Inverse secant
IntervalResult ia_asec(vec2 x) {
  return ia_acos(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}

IntervalResult ia_asec(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asec(x.value);
}

// Hyperbolic cotangent
IntervalResult ia_coth(vec2 x) {
  return ia_div(ia_cosh(x), ia_sinh(x));
}

IntervalResult ia_coth(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_coth(x.value);
}

// Hyperbolic cosecant
IntervalResult ia_csch(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_sinh(x));
}

IntervalResult ia_csch(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_csch(x.value);
}

// Hyperbolic secant
IntervalResult ia_sech(vec2 x) {
  return ia_div(ia_ok(vec2(1.0, 1.0)), ia_cosh(x));
}

IntervalResult ia_sech(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_sech(x.value);
}

// Inverse hyperbolic sine
IntervalResult ia_asinh(vec2 x) {
  return ia_ok(vec2(asinh(x.x) - IA_EPS, asinh(x.y) + IA_EPS));
}

IntervalResult ia_asinh(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asinh(x.value);
}

// Inverse hyperbolic cosine
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
}

// Inverse hyperbolic tangent
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
}

// Inverse hyperbolic cotangent
IntervalResult ia_acoth(vec2 x) {
  return ia_atanh(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}

IntervalResult ia_acoth(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acoth(x.value);
}

// Inverse hyperbolic cosecant
IntervalResult ia_acsch(vec2 x) {
  return ia_asinh(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}

IntervalResult ia_acsch(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_acsch(x.value);
}

// Inverse hyperbolic secant
IntervalResult ia_asech(vec2 x) {
  return ia_acosh(ia_div(ia_ok(vec2(1.0, 1.0)), ia_ok(x)));
}

IntervalResult ia_asech(IntervalResult x) {
  if (ia_is_error(x.status)) return x;
  return ia_asech(x.value);
}

// Boolean interval comparisons
// Returns 1.0 = true, 0.0 = false, 0.5 = maybe
const float IA_TRUE = 1.0;
const float IA_FALSE = 0.0;
const float IA_MAYBE = 0.5;

float ia_less(vec2 a, vec2 b) {
  if (a.y < b.x) return IA_TRUE;
  if (a.x >= b.y) return IA_FALSE;
  return IA_MAYBE;
}

float ia_lessEqual(vec2 a, vec2 b) {
  if (a.y <= b.x) return IA_TRUE;
  if (a.x > b.y) return IA_FALSE;
  return IA_MAYBE;
}

float ia_greater(vec2 a, vec2 b) {
  if (a.x > b.y) return IA_TRUE;
  if (a.y <= b.x) return IA_FALSE;
  return IA_MAYBE;
}

float ia_greaterEqual(vec2 a, vec2 b) {
  if (a.x >= b.y) return IA_TRUE;
  if (a.y < b.x) return IA_FALSE;
  return IA_MAYBE;
}

float ia_equal(vec2 a, vec2 b) {
  if (a.x == a.y && b.x == b.y && a.x == b.x) return IA_TRUE;
  if (a.y < b.x || b.y < a.x) return IA_FALSE;
  return IA_MAYBE;
}

float ia_notEqual(vec2 a, vec2 b) {
  float eq = ia_equal(a, b);
  if (eq == IA_TRUE) return IA_FALSE;
  if (eq == IA_FALSE) return IA_TRUE;
  return IA_MAYBE;
}

float ia_and(float a, float b) {
  if (a == IA_FALSE || b == IA_FALSE) return IA_FALSE;
  if (a == IA_TRUE && b == IA_TRUE) return IA_TRUE;
  return IA_MAYBE;
}

float ia_or(float a, float b) {
  if (a == IA_TRUE || b == IA_TRUE) return IA_TRUE;
  if (a == IA_FALSE && b == IA_FALSE) return IA_FALSE;
  return IA_MAYBE;
}

float ia_not(float a) {
  if (a == IA_TRUE) return IA_FALSE;
  if (a == IA_FALSE) return IA_TRUE;
  return IA_MAYBE;
}

// IntervalResult overloads for comparisons
float ia_less(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_less(a.value, b.value);
}

float ia_lessEqual(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_lessEqual(a.value, b.value);
}

float ia_greater(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_greater(a.value, b.value);
}

float ia_greaterEqual(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_greaterEqual(a.value, b.value);
}

float ia_equal(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_equal(a.value, b.value);
}

float ia_notEqual(IntervalResult a, IntervalResult b) {
  if (ia_is_error(a.status) || ia_is_error(b.status)) return IA_MAYBE;
  return ia_notEqual(a.value, b.value);
}
`;

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
const INTERVAL_GLSL_FUNCTIONS: CompiledFunctions = {
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
    if (base.symbol === 'ExponentialE') {
      return `ia_exp(${compile(exp)})`;
    }
    if (exp?.isNumberLiteral && exp.im === 0) {
      const expVal = exp.re;
      if (expVal === 2) return `ia_square(${compile(base)})`;
      return `ia_pow(${compile(base)}, ${expVal})`;
    }
    // Variable exponent - not fully supported in this simple implementation
    throw new Error('Interval GLSL does not support variable exponents');
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
export class IntervalGLSLTarget implements LanguageTarget {
  getOperators(): CompiledOperators {
    return INTERVAL_GLSL_OPERATORS;
  }

  getFunctions(): CompiledFunctions {
    return INTERVAL_GLSL_FUNCTIONS;
  }

  /**
   * Get the GLSL interval library code.
   *
   * This should be included in shaders that use interval arithmetic.
   */
  getLibrary(): string {
    return GLSL_INTERVAL_LIBRARY;
  }

  createTarget(options: Partial<CompileTarget> = {}): CompileTarget {
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

  compileToExecutable(
    expr: BoxedExpression,
    options: CompilationOptions = {}
  ): CompiledExecutable {
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

    // Return a "compiled" object containing the GLSL code
    const result = function () {
      return glslCode;
    };

    Object.defineProperty(result, 'toString', {
      value: () => glslCode,
    });

    Object.defineProperty(result, 'isCompiled', {
      value: true,
    });

    return result as CompiledExecutable;
  }

  /**
   * Compile an expression to GLSL interval code.
   */
  compile(expr: BoxedExpression, options: CompilationOptions = {}): string {
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
    expr: BoxedExpression,
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
    expr: BoxedExpression,
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

    return `#version ${version}
precision highp float;

${GLSL_INTERVAL_LIBRARY}

IntervalResult ${functionName}(${params}) {
  return ${body};
}
`;
  }
}
