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

IntervalResult ia_partial(vec2 v, float clip) {
  return IntervalResult(v, clip);
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

// Sign function
IntervalResult ia_sign(vec2 x) {
  if (x.x > 0.0) return ia_ok(vec2(1.0, 1.0));
  if (x.y < 0.0) return ia_ok(vec2(-1.0, -1.0));
  if (x.x == 0.0 && x.y == 0.0) return ia_ok(vec2(0.0, 0.0));
  if (x.x < 0.0 && x.y > 0.0) return ia_ok(vec2(-1.0, 1.0));
  if (x.x == 0.0) return ia_ok(vec2(0.0, 1.0));
  return ia_ok(vec2(-1.0, 0.0));
}

// Floor
IntervalResult ia_floor(vec2 x) {
  return ia_ok(vec2(floor(x.x), floor(x.y)));
}

// Ceiling
IntervalResult ia_ceil(vec2 x) {
  return ia_ok(vec2(ceil(x.x), ceil(x.y)));
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
  Ceiling: (args, compile) => `ia_ceil(${compile(args[0])})`,
  Exp: (args, compile) => `ia_exp(${compile(args[0])})`,
  Floor: (args, compile) => `ia_floor(${compile(args[0])})`,
  Ln: (args, compile) => `ia_ln(${compile(args[0])})`,
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
  Sgn: (args, compile) => `ia_sign(${compile(args[0])})`,
  Sqrt: (args, compile) => `ia_sqrt(${compile(args[0])})`,
  Square: (args, compile) => `ia_square(${compile(args[0])})`,

  // Trigonometric functions
  Sin: (args, compile) => `ia_sin(${compile(args[0])})`,
  Cos: (args, compile) => `ia_cos(${compile(args[0])})`,
  Tan: (args, compile) => `ia_tan(${compile(args[0])})`,
  Arcsin: (args, compile) => `ia_asin(${compile(args[0])})`,
  Arccos: (args, compile) => `ia_acos(${compile(args[0])})`,
  Arctan: (args, compile) => `ia_atan(${compile(args[0])})`,

  // Hyperbolic functions
  Sinh: (args, compile) => `ia_sinh(${compile(args[0])})`,
  Cosh: (args, compile) => `ia_cosh(${compile(args[0])})`,
  Tanh: (args, compile) => `ia_tanh(${compile(args[0])})`,
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
