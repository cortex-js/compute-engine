/**
 * The GLSL ES 3.00 printer of the slice compiler: a function whose
 * parameters are the inputs, in the order of the entry's parameters.
 *
 * Both numeric lanes are `float`: an integer is exact up to 2^24 on this
 * target. `pow` of a negative base and a non-integer exponent is what the
 * driver gives (GLSL leaves it undefined; NaN is inside the caveats). The
 * driver may reorder and round: no bits are promised. A boolean is `bool`; a list is
 * a vector of 2 to 4 elements, `vec3`, or an array, `float[5]` (GLSL ES 3.00
 * has no array of arrays, and the target declines a nested list). A loop
 * counts with an `int`. The target has no element-wise operations: the
 * `scalarize` pass runs first.
 */

import { entryOf, type IRType, type Program } from './ir.js';
import type { OperatorRow } from './operators.js';
import { printProgram, type Printed, type Syntax } from './print.js';

const NAN = 'uintBitsToFloat(0x7fc00000u)';

/** `float`, `bool`; a list of 2 to 4 elements is a vector (`vec2`,
 *  `bvec3`: a point of the host), another list an array (`float[5]`); a
 *  list in storage the kind of the storage (`sampler2D`). */
export function typeName(t: IRType): string {
  if (t.storage !== undefined) return t.storage;
  if (t.lane === 'color' && t.shape.length === 0) return 'vec3';
  const scalar = t.lane === 'boolean' ? 'bool' : 'float';
  const n = t.shape[0];
  if (t.shape.length > 1 || typeof n === 'object')
    throw new Error(
      `slice GLSL printer: no type for ${JSON.stringify(t.shape)}`
    );
  if (n === undefined) return scalar;
  if (n >= 2 && n <= 4) return `${t.lane === 'boolean' ? 'b' : ''}vec${n}`;
  return `${scalar}[${n}]`;
}

/** A declarator: `float x` or `float x[3]`. */
function declarator(t: IRType, name: string): string {
  const [base, length] = typeName(t).split('[');
  return length === undefined ? `${base} ${name}` : `${base} ${name}[${length}`;
}

function float(x: number): string {
  const f = Math.fround(x);
  if (Number.isNaN(f)) return NAN;
  if (!Number.isFinite(f))
    return f > 0
      ? 'uintBitsToFloat(0x7f800000u)'
      : 'uintBitsToFloat(0xff800000u)';
  const s = Object.is(f, -0) ? '-0.0' : String(f);
  const literal = /[.e]/.test(s) ? s : `${s}.0`;
  return f < 0 || Object.is(f, -0) ? `(${literal})` : literal;
}

/** The name of the parameter `index` of the entry for the input `name`:
 *  ASCII letters and digits only (GLSL reserves `__` and `gl_`). */
export function glslParameterName(name: string, index: number): string {
  return `in${index}_${name.replace(/[^A-Za-z0-9]/g, '')}`;
}

/** `At`: the element read by `read` of its index from 0 in range, NaN
 *  outside. */
const at = (read: (k: string) => string) =>
  `($1 == floor($1) && $1 != 0.0 && abs($1) <= float($#0) ? ${read('$1 > 0.0 ? int($1) - 1 : $#0 + int($1)')} : ${NAN})`;

export const GLSL: Syntax = Object.freeze({
  ops: {
    'add': '($0 + $1)',
    'sub': '($0 - $1)',
    'neg': '(-$0)',
    'mul': '($0 * $1)',
    'div': '($0 / $1)',
    'pow': { text: '_gpu_ir_pow($0, $1)', helpers: ['_gpu_ir_pow'] },
    'sqrt': 'sqrt($0)',
    'abs': 'abs($0)',
    'exp': 'exp($0)',
    // A builtin that GLSL ES 3.00 leaves undefined at some reals is spelled
    // with its domain: NaN outside it, where the interpreter's real value
    // is not real (or is a pole), so no value depends on the driver.
    'ln': `($0 > 0.0 ? log($0) : ${NAN})`,
    'log10': `($0 > 0.0 ? log($0) * 0.4342944819032518 : ${NAN})`,
    'log2': `($0 > 0.0 ? log2($0) : ${NAN})`,
    'sin': 'sin($0)',
    'cos': 'cos($0)',
    'tan': 'tan($0)',
    'cot': '(1.0 / tan($0))',
    'sec': '(1.0 / cos($0))',
    'csc': '(1.0 / sin($0))',
    'sinh': 'sinh($0)',
    'cosh': 'cosh($0)',
    // A renderer can compute `tanh` as a quotient of exponentials, NaN
    // from |x| = 89: it is ±1 to float precision from |x| = 20.
    'tanh': '(abs($0) > 20.0 ? sign($0) : tanh($0))',
    'coth': '(1.0 / (abs($0) > 20.0 ? sign($0) : tanh($0)))',
    'sech': '(1.0 / cosh($0))',
    'csch': '(1.0 / sinh($0))',
    'asin': `(abs($0) <= 1.0 ? asin($0) : ${NAN})`,
    'acos': `(abs($0) <= 1.0 ? acos($0) : ${NAN})`,
    'acosh': `($0 >= 1.0 ? acosh($0) : ${NAN})`,
    'atanh': `(abs($0) < 1.0 ? atanh($0) : ${NAN})`,
    // `Arctan2(y, x)`; the interpreter's value at (0, 0) is 0.
    'atan2': '($0 == 0.0 && $1 == 0.0 ? 0.0 : atan($0, $1))',
    'hypot': 'length(vec2($0, $1))',
    'root': { text: '_gpu_ir_root($0, $1)', helpers: ['_gpu_ir_root'] },
    // A real operand declines (no `factorial` spelling): `Gamma(x + 1)`.
    'factorial.int': {
      text: '_gpu_ir_factorial($0)',
      helpers: ['_gpu_ir_factorial'],
    },
    'gcd': { text: '_gpu_ir_gcd($0, $1)', helpers: ['_gpu_ir_gcd'] },
    'deg': 'radians($0)',
    'floor': 'floor($0)',
    'ceil': 'ceil($0)',
    'round': { text: '_gpu_ir_round($0)', helpers: ['_gpu_ir_round'] },
    'mod': 'mod($0, $1)',
    'mod.int': { text: '_gpu_ir_imod($0, $1)', helpers: ['_gpu_ir_imod'] },
    'max': 'max($0, $1)',
    'min': 'min($0, $1)',
    'emax': 'max($0, $1)',
    'emin': 'min($0, $1)',
    'lt': '($0 < $1)',
    'le': '($0 <= $1)',
    'gt': '($0 > $1)',
    'ge': '($0 >= $1)',
    'eq': '($0 == $1)',
    'ne': '($0 != $1)',
    'and': '($0 && $1)',
    'or': '($0 || $1)',
    'not': '(!$0)',
    'elem': '$0[int($1)]',
    // `At`: from 1, from the end when negative, NaN for an index that is 0,
    // not an integer or out of range; the arm that reads is taken only in
    // range. `$#0` is the length of the list (an `int` literal). The index
    // is clamped too: a compiler folds a constant index and rejects one out
    // of range, also in an arm that is not taken (`At(L, 7)` of a
    // `float[6]`).
    'at': at((k) => `$0[clamp(${k}, 0, $#0 - 1)]`),
    // A list in a sampler (`storage`): the texel of the element, read as
    // `elem` and `at` read an array (`_gpu_ir_texel`).
    'elem.sampler2D': {
      text: '_gpu_ir_texel($0, int($1))',
      helpers: ['_gpu_ir_texel'],
    },
    'at.sampler2D': {
      text: at((k) => `_gpu_ir_texel($0, ${k})`),
      helpers: ['_gpu_ir_texel'],
    },
    'rangestep': '($1 >= $0 ? 1.0 : -1.0)',
    'trunc': 'trunc($0)',
    'sign': 'sign($0)',
    'fract': 'fract($0)',
    'atan': 'atan($0)',
    'asinh': 'asinh($0)',
    // A colour is an OKLCh `vec3`; `asoklab` and `asrgb` give the channels
    // of their space, only as the result of the program (`resultOnly`).
    'oklch': 'vec3($0, $1, $2)',
    'oklab': { text: '_gpu_ir_lch(vec3($0, $1, $2))', helpers: ['_gpu_ir_lch'] },
    'rgb': {
      text: '_gpu_ir_lch(_gpu_ir_srgb_lab(vec3($0, $1, $2)))',
      helpers: ['_gpu_ir_lch', '_gpu_ir_srgb_lab'],
    },
    'asoklch': '$0',
    'asoklab': { text: '_gpu_ir_lab($0)', helpers: ['_gpu_ir_lab'] },
    'asrgb': {
      text: '_gpu_ir_lab_srgb(_gpu_ir_lab($0))',
      helpers: ['_gpu_ir_lab', '_gpu_ir_lab_srgb'],
    },
  },
  helpers: {
    _gpu_ir_pow: [
      'float _gpu_ir_pow(float a, float b) {',
      '  if (b == floor(b) && b >= 1.0 && b <= 16.0) {',
      '    float r = a;',
      '    for (int i = 1; i < int(b); i++) r *= a;',
      '    return r;',
      '  }',
      `  if (b == 0.0) return a == 0.0 || isnan(a) || isinf(a) ? ${NAN} : 1.0;`,
      '  if (a >= 0.0) return pow(a, b);',
      `  if (b != floor(b)) return ${NAN};`,
      '  float r = pow(-a, b);',
      '  return mod(b, 2.0) == 0.0 ? r : -r;',
      '}',
    ].join('\n'),
    // Half away from zero, with no addition of 0.5 (which rounds up just
    // below 0.5 and near 2^23).
    _gpu_ir_round: [
      'float _gpu_ir_round(float x) {',
      '  float a = abs(x);',
      '  float r = floor(a);',
      '  if (a - r >= 0.5) r += 1.0;',
      '  return x < 0.0 ? -r : r;',
      '}',
    ].join('\n'),
    // The floored modulo of integers, on `int`s: exact for every operand
    // within 2^24, intermediate values included (a `float` product `b * q`
    // rounds: `Mod(-15000000, 6000001)`).
    _gpu_ir_imod: [
      'float _gpu_ir_imod(float a, float b) {',
      `  if (b == 0.0) return ${NAN};`,
      '  int ia = int(a), ib = int(b);',
      '  int r = ia - ib * (ia / ib);',
      '  if (r != 0 && (r < 0) != (ib < 0)) r += ib;',
      '  return float(r);',
      '}',
    ].join('\n'),
    // `Root(x, n)`: the real root of a negative radicand for an odd
    // integer index, as `root` of `REAL_FUNCTIONS`; NaN for another index of
    // a negative radicand (the interpreter's real root of an odd
    // denominator, `Root(-8, 2.5)`, is not computed).
    _gpu_ir_root: [
      'float _gpu_ir_root(float x, float n) {',
      '  if (x == 0.0 && n > 0.0) return 0.0;',
      `  if (n == 0.0) return ${NAN};`,
      '  if (x >= 0.0) return pow(x, 1.0 / n);',
      `  return n == floor(n) && mod(n, 2.0) == 1.0 ? -pow(-x, 1.0 / n) : ${NAN};`,
      '}',
    ].join('\n'),
    // `n!` of an integer: +∞ for a negative operand (a pole) and over 34
    // (35! is over the largest float).
    _gpu_ir_factorial: [
      'float _gpu_ir_factorial(float n) {',
      '  if (n < 0.0 || n > 34.0) return uintBitsToFloat(0x7f800000u);',
      '  float r = 1.0;',
      '  for (int i = 2; i <= 34; i++) if (float(i) <= n) r *= float(i);',
      '  return r;',
      '}',
    ].join('\n'),
    // The greatest common divisor of two integers, on `int`s.
    _gpu_ir_gcd: [
      'float _gpu_ir_gcd(float a, float b) {',
      '  int x = abs(int(a)), y = abs(int(b));',
      '  for (int i = 0; i < 64 && y != 0; i++) { int t = x % y; x = y; y = t; }',
      '  return float(x);',
      '}',
    ].join('\n'),
    // The colour conversions of the interpreter (`@arnog/colors`): OKLab to
    // OKLCh (hue in degrees, in [0, 360)) and back; extended sRGB (a
    // channel outside [0, 1] keeps the sign of the transfer) to OKLab and
    // back, with no clamp and no gamut mapping.
    _gpu_ir_lch: [
      'vec3 _gpu_ir_lch(vec3 c) {',
      '  float h = c.y == 0.0 && c.z == 0.0 ? 0.0 : degrees(atan(c.z, c.y));',
      '  return vec3(c.x, length(c.yz), h < 0.0 ? h + 360.0 : h);',
      '}',
    ].join('\n'),
    _gpu_ir_lab: [
      'vec3 _gpu_ir_lab(vec3 c) {',
      '  float h = radians(c.z);',
      '  return vec3(c.x, c.y * cos(h), c.y * sin(h));',
      '}',
    ].join('\n'),
    _gpu_ir_srgb_lab: [
      'vec3 _gpu_ir_srgb_lab(vec3 c) {',
      '  vec3 a = abs(c);',
      '  vec3 l = sign(c) * mix(pow((a + 0.055) / 1.055, vec3(2.4)), a / 12.92, lessThanEqual(a, vec3(0.04045)));',
      '  vec3 m = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * l;',
      '  m = sign(m) * pow(abs(m), vec3(1.0 / 3.0));',
      '  return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.793617785, -2.428592205, 0.7827717662, -0.0040720468, 0.4505937099, -0.808675766) * m;',
      '}',
    ].join('\n'),
    _gpu_ir_lab_srgb: [
      'vec3 _gpu_ir_lab_srgb(vec3 c) {',
      '  vec3 m = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.291485548) * c;',
      '  vec3 l = mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.707614701) * (m * m * m);',
      '  vec3 a = abs(l);',
      '  return sign(l) * mix(1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, 12.92 * a, lessThanEqual(a, vec3(0.0031308)));',
      '}',
    ].join('\n'),
    // The element `k` (from 0) of a list in a sampler (README, `storage`).
    _gpu_ir_texel: [
      'float _gpu_ir_texel(sampler2D v, int k) {',
      '  int w = textureSize(v, 0).x;',
      '  return texelFetch(v, ivec2(k % w, k / w), 0).r;',
      '}',
    ].join('\n'),
  },
  regions: {},
  // The profile has no complex lane (`TARGETS.glsl.lanes`).
  constant: ({ value: x }) => (typeof x === 'number' ? float(x) : String(x)),
  input: glslParameterName,
  positional: glslParameterName,
  length: () => {
    throw new Error('slice GLSL printer: a run-time length');
  },
  list: (elements, t) => `${typeName(t)}(${elements.join(', ')})`,
  declare: (t, name, value) =>
    `${declarator(t, name)}${value === undefined ? '' : ` = ${value}`};`,
  assign: (name, value) => `${name} = ${value};`,
  ifOpen: (cond) => `if (${cond}) {`,
  elseOpen: '} else {',
  // An `int` counter: a `float` one stops advancing at 2^24. The bounds are
  // clamped to ±2^30 before the conversion.
  loopOpen: (k, lo, hi) => [
    `int ${k}_hi = int(clamp(${hi}, -1073741824.0, 1073741824.0));`,
    `for (int ${k}_i = int(clamp(${lo}, -1073741824.0, 1073741824.0)); ${k}_i <= ${k}_hi; ${k}_i++) {`,
    `  float ${k} = float(${k}_i);`,
  ],
  close: '}',
  ret: (value) => `return ${value};`,
  // A helper is named `_gpu_ir_…` and a user function `_fn_ir_…`: a host
  // that joins two compilations in one shader renames by `_gpu_` and `_fn_`,
  // and the `ir_` keeps them apart from the existing GLSL target's names.
  call: (fn, args) => `_fn_ir_${fn}(${args.join(', ')})`,
  fn: (name, params, result, body) =>
    [
      `${typeName(result)} _fn_ir_${name}(${params.map((p) => declarator(p.type, p.name)).join(', ')}) {`,
      ...body,
      '}',
    ].join('\n'),
});

[GLSL.ops, GLSL.regions, GLSL.helpers].forEach((t) => Object.freeze(t));

export type GlslResult = {
  /** The helper functions, the other functions and the definition of the
   *  function `name`. */
  readonly code: string;
  readonly name: string;
  /** The parameters, in order: the input, the GLSL name, the GLSL type. */
  readonly parameters: { input: string; name: string; type: string }[];
  readonly returnType: string;
  readonly printed: Printed;
};

export function printGlsl(
  p: Program,
  rows: readonly OperatorRow[],
  syntax: Syntax = GLSL,
  name = 'f'
): GlslResult {
  const printed = printProgram(p, syntax, rows);
  const entry = entryOf(p);
  const parameters = entry.body.params.map((v, k) => ({
    input: entry.paramNames[k],
    name: syntax.input(entry.paramNames[k], k),
    type: typeName(p.types[v]),
  }));
  const returnType = typeName(entry.results[0]);
  const params = entry.body.params.map((v, k) =>
    declarator(p.types[v], parameters[k].name)
  );
  const code = [
    ...printed.helpers,
    ...printed.functions,
    `${returnType} ${name}(${params.join(', ')}) {`,
    ...printed.body,
    '}',
  ].join('\n');
  return { code, name, parameters, returnType, printed };
}
