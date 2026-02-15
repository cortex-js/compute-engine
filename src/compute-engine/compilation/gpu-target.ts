import type { Expression } from '../global-types';
import { isFunction } from '../boxed-expression/type-guards';

import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types';
import { BaseCompiler } from './base-compiler';

/**
 * GPU shader operators shared by GLSL and WGSL.
 *
 * Both languages use identical C-style operators for arithmetic,
 * comparison, and logical operations.
 */
export const GPU_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14],
  Subtract: ['-', 11],
  Multiply: ['*', 12],
  Divide: ['/', 13],
  Equal: ['==', 8],
  NotEqual: ['!=', 8],
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14],
};

/**
 * GPU shader functions shared by GLSL and WGSL.
 *
 * Both languages share identical built-in math functions. Language-specific
 * functions (inversesqrt naming, mod, vector constructors) are provided
 * by subclass overrides.
 */
export const GPU_FUNCTIONS: CompiledFunctions<Expression> = {
  // Variadic arithmetic (for function-call form, e.g., with vectors)
  Add: (args, compile) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' + ');
  },
  Multiply: (args, compile) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    return args.map((x) => compile(x)).join(' * ');
  },
  Subtract: (args, compile) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2) return `${compile(args[0])} - ${compile(args[1])}`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} - ${compile(args[i])}`;
    }
    return result;
  },
  Divide: (args, compile) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    if (args.length === 2) return `${compile(args[0])} / ${compile(args[1])}`;
    let result = compile(args[0]);
    for (let i = 1; i < args.length; i++) {
      result = `${result} / ${compile(args[i])}`;
    }
    return result;
  },

  // Standard math functions (identical names in both GLSL and WGSL)
  Abs: 'abs',
  Arccos: 'acos',
  Arcsin: 'asin',
  Arctan: 'atan',
  Ceil: 'ceil',
  Clamp: 'clamp',
  Cos: 'cos',
  Degrees: 'degrees',
  Exp: 'exp',
  Exp2: 'exp2',
  Floor: 'floor',
  Fract: 'fract',
  Ln: 'log',
  Log2: 'log2',
  Max: 'max',
  Min: 'min',
  Mix: 'mix',
  Power: 'pow',
  Radians: 'radians',
  Round: 'round',
  Sign: 'sign',
  Sin: 'sin',
  Smoothstep: 'smoothstep',
  Sqrt: 'sqrt',
  Step: 'step',
  Tan: 'tan',
  Truncate: 'trunc',

  Remainder: ([a, b], compile) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
    return `(${compile(a)} - ${compile(b)} * round(${compile(a)} / ${compile(b)}))`;
  },

  // Reciprocal trigonometric functions (no GPU built-ins)
  Cot: ([x], compile) => {
    if (x === null) throw new Error('Cot: no argument');
    const arg = compile(x);
    return `(cos(${arg}) / sin(${arg}))`;
  },
  Csc: ([x], compile) => {
    if (x === null) throw new Error('Csc: no argument');
    return `(1.0 / sin(${compile(x)}))`;
  },
  Sec: ([x], compile) => {
    if (x === null) throw new Error('Sec: no argument');
    return `(1.0 / cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    return `atan(1.0 / (${compile(x)}))`;
  },
  Arccsc: ([x], compile) => {
    if (x === null) throw new Error('Arccsc: no argument');
    return `asin(1.0 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile) => {
    if (x === null) throw new Error('Arcsec: no argument');
    return `acos(1.0 / (${compile(x)}))`;
  },

  // Hyperbolic functions
  Sinh: 'sinh',
  Cosh: 'cosh',
  Tanh: 'tanh',

  // Reciprocal hyperbolic functions
  Coth: ([x], compile) => {
    if (x === null) throw new Error('Coth: no argument');
    const arg = compile(x);
    return `(cosh(${arg}) / sinh(${arg}))`;
  },
  Csch: ([x], compile) => {
    if (x === null) throw new Error('Csch: no argument');
    return `(1.0 / sinh(${compile(x)}))`;
  },
  Sech: ([x], compile) => {
    if (x === null) throw new Error('Sech: no argument');
    return `(1.0 / cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic functions
  Arcosh: 'acosh',
  Arsinh: 'asinh',
  Artanh: 'atanh',

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile) => {
    if (x === null) throw new Error('Arcoth: no argument');
    return `atanh(1.0 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `asinh(1.0 / (${compile(x)}))`;
  },
  Arsech: ([x], compile) => {
    if (x === null) throw new Error('Arsech: no argument');
    return `acosh(1.0 / (${compile(x)}))`;
  },

  // Trigonometric (additional)
  Arctan2: (args, compile) => {
    if (args.length < 2) throw new Error('Arctan2: need two arguments');
    return `atan(${compile(args[0])}, ${compile(args[1])})`;
  },
  Hypot: ([x, y], compile) => {
    if (x === null || y === null) throw new Error('Hypot: need two arguments');
    return `length(vec2(${compile(x)}, ${compile(y)}))`;
  },
  Haversine: ([x], compile) => {
    if (x === null) throw new Error('Haversine: no argument');
    return `((1.0 - cos(${compile(x)})) * 0.5)`;
  },
  InverseHaversine: ([x], compile) => {
    if (x === null) throw new Error('InverseHaversine: no argument');
    return `(2.0 * asin(sqrt(${compile(x)})))`;
  },

  // Special functions
  Gamma: ([x], compile) => {
    if (x === null) throw new Error('Gamma: no argument');
    return `_gpu_gamma(${compile(x)})`;
  },
  GammaLn: ([x], compile) => {
    if (x === null) throw new Error('GammaLn: no argument');
    return `_gpu_gammaln(${compile(x)})`;
  },
  Factorial: ([x], compile) => {
    if (x === null) throw new Error('Factorial: no argument');
    return `_gpu_gamma(${compile(x)} + 1.0)`;
  },
  Beta: ([a, b], compile) => {
    if (a === null || b === null) throw new Error('Beta: need two arguments');
    const ca = compile(a);
    const cb = compile(b);
    return `(_gpu_gamma(${ca}) * _gpu_gamma(${cb}) / _gpu_gamma(${ca} + ${cb}))`;
  },
  Erf: ([x], compile) => {
    if (x === null) throw new Error('Erf: no argument');
    return `_gpu_erf(${compile(x)})`;
  },
  Erfc: ([x], compile) => {
    if (x === null) throw new Error('Erfc: no argument');
    return `(1.0 - _gpu_erf(${compile(x)}))`;
  },
  ErfInv: ([x], compile) => {
    if (x === null) throw new Error('ErfInv: no argument');
    return `_gpu_erfinv(${compile(x)})`;
  },

  // Additional math functions
  Lb: 'log2',
  Log: (args, compile) => {
    if (args.length === 0) throw new Error('Log: no argument');
    if (args.length === 1) return `(log(${compile(args[0])}) / log(10.0))`;
    return `(log(${compile(args[0])}) / log(${compile(args[1])}))`;
  },
  Log10: ([x], compile) => {
    if (x === null) throw new Error('Log10: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Lg: ([x], compile) => {
    if (x === null) throw new Error('Lg: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    const arg = compile(x);
    return `(${arg} * ${arg})`;
  },
  Root: ([x, n], compile) => {
    if (x === null) throw new Error('Root: no argument');
    if (n === null || n === undefined) return `sqrt(${compile(x)})`;
    if (n?.re === 2) return `sqrt(${compile(x)})`;
    return `pow(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Color functions (pure-math, GPU-compilable)
  ColorMix: (args, compile) => {
    if (args.length < 2) throw new Error('ColorMix: need two colors');
    const c1 = compile(args[0]);
    const c2 = compile(args[1]);
    const ratio = args.length >= 3 ? compile(args[2]) : '0.5';
    return `_gpu_color_mix(${c1}, ${c2}, ${ratio})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('ColorContrast: need two colors');
    return `_gpu_apca(${compile(bg)}, ${compile(fg)})`;
  },
  ContrastingColor: (args, compile, target) => {
    if (args.length === 0) throw new Error('ContrastingColor: no argument');
    const bg = compile(args[0]);
    if (args.length >= 3) {
      const fg1 = compile(args[1]);
      const fg2 = compile(args[2]);
      return `(abs(_gpu_apca(${bg}, ${fg1})) >= abs(_gpu_apca(${bg}, ${fg2})) ? ${fg1} : ${fg2})`;
    }
    const isWGSL = target?.language === 'wgsl';
    const v3 = isWGSL ? 'vec3f' : 'vec3';
    return `((_gpu_apca(${bg}, ${v3}(0.0)) > 50.0) ? ${v3}(0.0) : ${v3}(1.0))`;
  },
  ColorToColorspace: ([color, space], compile) => {
    if (color === null || space === null)
      throw new Error('ColorToColorspace: need color and space');
    return `_gpu_srgb_to_oklab(${compile(color)})`;
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error('ColorFromColorspace: need components and space');
    return `_gpu_oklab_to_srgb(${compile(components)})`;
  },

  // Vector/Matrix operations
  Cross: 'cross',
  Distance: 'distance',
  Dot: 'dot',
  Length: 'length',
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',
};

/**
 * Compile a Matrix expression to GPU-native types when possible.
 *
 * Handles two optimizations:
 * - Column vectors (Nx1): flatten to vecN instead of nested single-element arrays
 * - Square matrices (NxN, N=2,3,4): use native matN types with column-major transposition
 *
 * Falls back to compiling the nested List structure for other shapes.
 */
export function compileGPUMatrix(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  vecFn: (n: number) => string,
  matFn: (n: number) => string,
  arrayFn: (n: number) => string
): string {
  const body = args[0];
  if (!isFunction(body)) return compile(body);

  const rows = body.ops;
  if (rows.length === 0) return compile(body);

  const numRows = rows.length;
  const firstRow = rows[0];
  const numCols = isFunction(firstRow) ? firstRow.nops : 0;

  // Column vector (Nx1): flatten to vecN or array<f32, N>
  if (numCols === 1 && rows.every((row) => isFunction(row) && row.nops === 1)) {
    const elements = rows.map((row) =>
      compile(isFunction(row) ? row.ops[0] : row)
    );
    if (numRows >= 2 && numRows <= 4)
      return `${vecFn(numRows)}(${elements.join(', ')})`;
    return `${arrayFn(numRows)}(${elements.join(', ')})`;
  }

  // Square matrix NxN (N=2,3,4): use native matrix type
  // GPU matrices are column-major, our Matrix is row-major → transpose
  if (
    numRows === numCols &&
    numRows >= 2 &&
    numRows <= 4 &&
    rows.every((row) => isFunction(row) && row.nops === numCols)
  ) {
    const cols: string[] = [];
    for (let c = 0; c < numCols; c++) {
      const colElements = rows.map((row) =>
        compile(isFunction(row) ? row.ops[c] : row)
      );
      cols.push(`${vecFn(numRows)}(${colElements.join(', ')})`);
    }
    return `${matFn(numRows)}(${cols.join(', ')})`;
  }

  // Default: compile the nested list structure as-is
  return compile(body);
}

/**
 * GPU gamma function using Lanczos approximation (g=7, n=9 coefficients).
 *
 * Uses reflection formula for z < 0.5 and Lanczos for z >= 0.5.
 * Valid for both GLSL and WGSL (uses standard math builtins).
 */
export const GPU_GAMMA_PREAMBLE = `
float _gpu_gamma(float z) {
  const float PI = 3.14159265358979;
  if (z < 0.5) {
    return PI / (sin(PI * z) * _gpu_gamma(1.0 - z));
  }
  z -= 1.0;
  float x = 0.99999999999980993;
  x += 676.5203681218851 / (z + 1.0);
  x += -1259.1392167224028 / (z + 2.0);
  x += 771.32342877765313 / (z + 3.0);
  x += -176.61502916214059 / (z + 4.0);
  x += 12.507343278686905 / (z + 5.0);
  x += -0.13857109526572012 / (z + 6.0);
  x += 9.9843695780195716e-6 / (z + 7.0);
  x += 1.5056327351493116e-7 / (z + 8.0);
  float t = z + 7.5;
  return sqrt(2.0 * PI) * pow(t, z + 0.5) * exp(-t) * x;
}

float _gpu_gammaln(float z) {
  // Stirling asymptotic expansion for ln(Gamma(z)), z > 0
  float z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU error function using Abramowitz & Stegun approximation.
 * Maximum error: |epsilon(x)| <= 1.5e-7.
 */
export const GPU_ERF_PREAMBLE = `
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
 * GPU color space conversion preamble (GLSL syntax).
 *
 * Provides sRGB ↔ OKLab ↔ OKLCh conversions, color mixing in OKLCh
 * with shorter-arc hue interpolation, and APCA contrast calculation.
 *
 * WGSL targets must adapt syntax (vec3f, atan2→atan2, etc.).
 */
export const GPU_COLOR_PREAMBLE_GLSL = `
float _gpu_srgb_to_linear(float c) {
  if (c <= 0.04045) return c / 12.92;
  return pow((c + 0.055) / 1.055, 2.4);
}

float _gpu_linear_to_srgb(float c) {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 _gpu_srgb_to_oklab(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  float l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  float m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  float s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
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
  return clamp(vec3(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), 0.0, 1.0);
}

vec3 _gpu_oklab_to_oklch(vec3 lab) {
  float C = length(lab.yz);
  float H = atan(lab.z, lab.y);
  return vec3(lab.x, C, H);
}

vec3 _gpu_oklch_to_oklab(vec3 lch) {
  return vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
}

vec3 _gpu_color_mix(vec3 rgb1, vec3 rgb2, float t) {
  vec3 lch1 = _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb1));
  vec3 lch2 = _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb2));
  float L = mix(lch1.x, lch2.x, t);
  float C = mix(lch1.y, lch2.y, t);
  float dh = lch2.z - lch1.z;
  const float PI = 3.14159265359;
  if (dh > PI) dh -= 2.0 * PI;
  if (dh < -PI) dh += 2.0 * PI;
  float H = lch1.z + dh * t;
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(vec3(L, C, H)));
}

float _gpu_apca(vec3 bg, vec3 fg) {
  float bgR = _gpu_srgb_to_linear(bg.x);
  float bgG = _gpu_srgb_to_linear(bg.y);
  float bgB = _gpu_srgb_to_linear(bg.z);
  float fgR = _gpu_srgb_to_linear(fg.x);
  float fgG = _gpu_srgb_to_linear(fg.y);
  float fgB = _gpu_srgb_to_linear(fg.z);
  float bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  float fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  float bgC = pow(bgY, 0.56);
  float fgC = pow(fgY, 0.57);
  float contrast = (bgC > fgC)
    ? (bgC - fgC) * 1.14
    : (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

/**
 * GPU color space conversion preamble (WGSL syntax).
 */
export const GPU_COLOR_PREAMBLE_WGSL = `
fn _gpu_srgb_to_linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}

fn _gpu_linear_to_srgb(c: f32) -> f32 {
  if (c <= 0.0031308) { return 12.92 * c; }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn _gpu_srgb_to_oklab(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  let l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  let m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  let s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
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
  return clamp(vec3f(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), vec3f(0.0), vec3f(1.0));
}

fn _gpu_oklab_to_oklch(lab: vec3f) -> vec3f {
  let C = length(lab.yz);
  let H = atan2(lab.z, lab.y);
  return vec3f(lab.x, C, H);
}

fn _gpu_oklch_to_oklab(lch: vec3f) -> vec3f {
  return vec3f(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z));
}

fn _gpu_color_mix(rgb1: vec3f, rgb2: vec3f, t: f32) -> vec3f {
  let lch1 = _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb1));
  let lch2 = _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb2));
  let L = mix(lch1.x, lch2.x, t);
  let C = mix(lch1.y, lch2.y, t);
  let PI = 3.14159265359;
  var dh = lch2.z - lch1.z;
  if (dh > PI) { dh -= 2.0 * PI; }
  if (dh < -PI) { dh += 2.0 * PI; }
  let H = lch1.z + dh * t;
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(vec3f(L, C, H)));
}

fn _gpu_apca(bg: vec3f, fg: vec3f) -> f32 {
  let bgR = _gpu_srgb_to_linear(bg.x);
  let bgG = _gpu_srgb_to_linear(bg.y);
  let bgB = _gpu_srgb_to_linear(bg.z);
  let fgR = _gpu_srgb_to_linear(fg.x);
  let fgG = _gpu_srgb_to_linear(fg.y);
  let fgB = _gpu_srgb_to_linear(fg.z);
  let bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  let fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  let bgC = pow(bgY, 0.56);
  let fgC = pow(fgY, 0.57);
  let contrast = (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

/** Constants shared by both GLSL and WGSL */
const GPU_CONSTANTS: Record<string, string> = {
  Pi: '3.14159265359',
  ExponentialE: '2.71828182846',
  GoldenRatio: '1.61803398875',
  CatalanConstant: '0.91596559417',
  EulerGamma: '0.57721566490',
};

/**
 * Format a number as a GPU float literal.
 *
 * Both GLSL and WGSL require float literals to have a decimal point.
 */
function formatGPUNumber(n: number): string {
  const str = n.toString();
  if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
    return `${str}.0`;
  }
  return str;
}

/**
 * Abstract base class for GPU shader compilation targets.
 *
 * Provides shared operators, math functions, constants, and number formatting
 * for both GLSL and WGSL. Subclasses implement language-specific details:
 * function naming differences, vector constructors, function declaration
 * syntax, and shader structure.
 */
export abstract class GPUShaderTarget implements LanguageTarget<Expression> {
  /** Language identifier (e.g., 'glsl', 'wgsl') */
  protected abstract readonly languageId: string;

  /**
   * Return language-specific function overrides.
   *
   * These are merged on top of the shared GPU_FUNCTIONS, allowing
   * subclasses to override specific entries (e.g., `Inversesqrt`, `Mod`, `List`).
   */
  protected abstract getLanguageSpecificFunctions(): CompiledFunctions<Expression>;

  /**
   * Create a complete function declaration in the target language.
   */
  abstract compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>
  ): string;

  /**
   * Create a complete shader program in the target language.
   */
  abstract compileShader(options: Record<string, unknown>): string;

  getOperators(): CompiledOperators {
    return GPU_OPERATORS;
  }

  getFunctions(): CompiledFunctions<Expression> {
    return { ...GPU_FUNCTIONS, ...this.getLanguageSpecificFunctions() };
  }

  getConstants(): Record<string, string> {
    return GPU_CONSTANTS;
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const functions = this.getFunctions();
    const constants = this.getConstants();
    return {
      language: this.languageId,
      operators: (op) => GPU_OPERATORS[op],
      functions: (id) => functions[id],
      var: (id) => {
        if (id in constants) return constants[id];
        return id;
      },
      string: (str) => JSON.stringify(str),
      number: formatGPUNumber,
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
    const { functions: userFunctions, vars } = options;
    const allFunctions = this.getFunctions();
    const constants = this.getConstants();

    const target = this.createTarget({
      functions: (id) => {
        if (userFunctions && id in userFunctions) {
          const fn = userFunctions[id];
          if (typeof fn === 'string') return fn;
          if (typeof fn === 'function') return fn.name || id;
        }
        return allFunctions[id];
      },
      var: (id) => {
        if (vars && id in vars) return vars[id] as string;
        if (id in constants) return constants[id];
        return id;
      },
    });

    const code = BaseCompiler.compile(expr, target);
    const result: CompilationResult = {
      target: this.languageId,
      success: true,
      code,
    };
    let preamble = '';
    if (code.includes('_gpu_gamma')) preamble += GPU_GAMMA_PREAMBLE;
    if (code.includes('_gpu_erf')) preamble += GPU_ERF_PREAMBLE;
    if (code.includes('_gpu_srgb_to') || code.includes('_gpu_oklab') ||
        code.includes('_gpu_oklch') || code.includes('_gpu_color_mix') ||
        code.includes('_gpu_apca')) {
      preamble += this.languageId === 'wgsl'
        ? GPU_COLOR_PREAMBLE_WGSL
        : GPU_COLOR_PREAMBLE_GLSL;
    }
    if (preamble) result.preamble = preamble;
    return result;
  }

  compileToSource(
    expr: Expression,
    _options: CompilationOptions<Expression> = {}
  ): string {
    const target = this.createTarget();
    return BaseCompiler.compile(expr, target);
  }
}
