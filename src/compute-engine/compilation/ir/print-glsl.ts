/**
 * The GLSL ES 3.00 printer of the slice compiler: a function whose
 * parameters are the inputs, in the order of the entry's parameters.
 *
 * Both numeric lanes are `float`: an integer is exact up to 2^24 on this
 * target. A complex value is a `vec2` (re, im), a colour an OKLCh `vec3`.
 * `pow` of a negative base and a non-integer exponent is NaN (GLSL leaves
 * the builtin undefined there; `_gpu_ir_pow`). The driver may reorder and
 * round: no bits are promised. A boolean is `bool`; a list is a vector of
 * 2 to 4 elements, `vec3`, or an array, `float[5]` (GLSL ES 3.00 has no
 * array of arrays, and the target declines a nested list). A loop counts
 * with an `int`. The target has no element-wise operations: the
 * `scalarize` pass runs first.
 */

import { entryOf, type IRType, type Program } from './ir.js';
import { deepFreeze, type OperatorRow } from './operators.js';
import {
  ARITHMETIC,
  calls,
  COMPARISONS,
  LOGIC,
  printProgram,
  type Printed,
  type Syntax,
} from './print.js';

const NAN = 'uintBitsToFloat(0x7fc00000u)';

/** `float`, `bool`; a list of 2 to 4 elements is a vector (`vec2`,
 *  `bvec3`: a point of the host), another list an array (`float[5]`); a
 *  list in storage the kind of the storage (`sampler2D`). */
export function typeName(t: IRType): string {
  if (t.storage !== undefined) return t.storage;
  if (t.lane === 'color' && t.shape.length === 0) return 'vec3';
  if (t.lane === 'complex' && t.shape.length === 0) return 'vec2';
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
  // The shortest decimal that reads back as the same float32 (`0.1`, not
  // `0.10000000149011612`); `String()` of its double drops the exponent of
  // `toPrecision()` where it can (`250`, not `2.5e+2`).
  let s = Object.is(f, -0) ? '-0.0' : String(f);
  for (let p = 1; p <= 9 && !Object.is(f, -0); p++) {
    const d = Number(f.toPrecision(p));
    // Not a decimal above the largest float (`3.4028235e+38`), which a
    // compiler can read as Infinity.
    if (Math.fround(d) === f && Math.abs(d) <= 3.4028234663852886e38) {
      s = String(d);
      break;
    }
  }
  const literal = /[.e]/.test(s) ? s : `${s}.0`;
  return f < 0 || Object.is(f, -0) ? `(${literal})` : literal;
}

/** The name of the parameter `index` of the entry for the input `name`:
 *  ASCII letters and digits only (GLSL reserves `__` and `gl_`). */
function glslParameterName(name: string, index: number): string {
  return `in${index}_${name.replace(/[^A-Za-z0-9]/g, '')}`;
}

/** The complex functions of a `vec2` (re, im) that GLSL's vectors do not
 *  have, one helper `_gpu_ir_c<name>` each: whether it has a second operand
 *  `b`, and its body over `a` (and `b`). The textbook formulas of the
 *  principal branch, with no guard (README, "The complex lane"). A body
 *  that reads the argument calls `_gpu_ir_carg`. */
// prettier-ignore
const COMPLEX: Record<string, [binary: boolean, ...body: string[]]> = {
  mul: [true, 'return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);'],
  div: [true, 'return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b);'],
  // A product for an integer exponent from 1 to 16, as `_gpu_ir_pow` (no
  // `ln` of the base: `z^2 + c` at `z = 0`); otherwise `exp(b·ln(a))`.
  pow: [true,
    'if (b.y == 0.0 && b.x == floor(b.x) && b.x >= 1.0 && b.x <= 16.0) {',
    '  vec2 r = a;',
    '  for (int i = 1; i < int(b.x); i++) r = vec2(r.x * a.x - r.y * a.y, r.x * a.y + r.y * a.x);',
    '  return r;',
    '}',
    'vec2 l = vec2(log(length(a)), _gpu_ir_carg(a));',
    'vec2 w = vec2(b.x * l.x - b.y * l.y, b.x * l.y + b.y * l.x);',
    'return exp(w.x) * vec2(cos(w.y), sin(w.y));'],
  exp: [false, 'return exp(a.x) * vec2(cos(a.y), sin(a.y));'],
  ln: [false, 'return vec2(log(length(a)), _gpu_ir_carg(a));'],
  // The form with no cancellation of `|a| - |re a|`.
  sqrt: [false,
    'float t = sqrt(0.5 * (length(a) + abs(a.x)));',
    'if (a.x >= 0.0) return vec2(t, 0.5 * a.y / t);',
    'return vec2(0.5 * abs(a.y) / t, a.y < 0.0 ? -t : t);'],
  sin: [false, 'return vec2(sin(a.x) * cosh(a.y), cos(a.x) * sinh(a.y));'],
  cos: [false, 'return vec2(cos(a.x) * cosh(a.y), -sin(a.x) * sinh(a.y));'],
  tan: [false, 'return vec2(sin(2.0 * a.x), sinh(2.0 * a.y)) / (cos(2.0 * a.x) + cosh(2.0 * a.y));'],
  sinh: [false, 'return vec2(sinh(a.x) * cos(a.y), cosh(a.x) * sin(a.y));'],
  cosh: [false, 'return vec2(cosh(a.x) * cos(a.y), sinh(a.x) * sin(a.y));'],
  tanh: [false, 'return vec2(sinh(2.0 * a.x), sin(2.0 * a.y)) / (cosh(2.0 * a.x) + cos(2.0 * a.y));'],
};

/** `At`: the element read by `read` of its index from 0 in range, NaN
 *  outside. */
const at = (read: (k: string) => string) =>
  `($1 == floor($1) && $1 != 0.0 && abs($1) <= float($#0) ? ${read('$1 > 0.0 ? int($1) - 1 : $#0 + int($1)')} : ${NAN})`;

export const GLSL: Syntax = deepFreeze({
  ops: {
    ...ARITHMETIC,
    'div.q': { text: '_gpu_ir_quot($0, $1)', helpers: ['_gpu_ir_quot'] },
    'pow': { text: '_gpu_ir_pow($0, $1)', helpers: ['_gpu_ir_pow'] },
    // A base `>= 0` (`print.ts`, `nonnegative()`): the builtin, NaN at
    // `0^b` for `b <= 0` (where it is undefined).
    'pow.nonnegative': {
      text: '_gpu_ir_pow_nonnegative($0, $1)',
      helpers: ['_gpu_ir_pow_nonnegative'],
    },
    ...calls('', ['sqrt', 'abs', 'exp']),
    // A builtin that GLSL ES 3.00 leaves undefined at some reals is spelled
    // with its domain: NaN outside it, where the interpreter's real value
    // is not real (or is a pole), so no value depends on the driver.
    'ln': `($0 > 0.0 ? log($0) : ${NAN})`,
    'log10': `($0 > 0.0 ? log($0) * 0.4342944819032518 : ${NAN})`,
    'log2': `($0 > 0.0 ? log2($0) : ${NAN})`,
    ...calls('', ['sin', 'cos', 'tan']),
    'cot': '(1.0 / tan($0))',
    'sec': '(1.0 / cos($0))',
    'csc': '(1.0 / sin($0))',
    ...calls('', ['sinh', 'cosh']),
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
    // Below 0.5 its Taylor polynomial (error 2e-11): a renderer's `sin` is
    // wrong by 3e-5 there (`Sinc(1e-6)` was 1.03, `Sinc(1e-30)` 0).
    'sinc':
      '(abs($0) < 0.5 ? 1.0 - $0 * $0 * (0.16666666666666666 - $0 * $0 * (0.008333333333333333 - $0 * $0 * (0.0001984126984126984 - $0 * $0 * 2.7557319223985893e-6))) : sin($0) / $0)',
    'fresnelc': {
      text: '_gpu_ir_fresnelc($0)',
      helpers: ['_gpu_ir_polevl', '_gpu_ir_fresnel_fg', '_gpu_ir_fresnelc'],
    },
    'fresnels': {
      text: '_gpu_ir_fresnels($0)',
      helpers: ['_gpu_ir_polevl', '_gpu_ir_fresnel_fg', '_gpu_ir_fresnels'],
    },
    'deg': 'radians($0)',
    ...calls('', ['floor', 'ceil']),
    'round': { text: '_gpu_ir_round($0)', helpers: ['_gpu_ir_round'] },
    'mod': { text: '_gpu_ir_fmod($0, $1)', helpers: ['_gpu_ir_fmod'] },
    'mod.int': { text: '_gpu_ir_imod($0, $1)', helpers: ['_gpu_ir_imod'] },
    'max': 'max($0, $1)',
    'min': 'min($0, $1)',
    'emax': 'max($0, $1)',
    'emin': 'min($0, $1)',
    ...COMPARISONS,
    'eq': '($0 == $1)',
    'ne': '($0 != $1)',
    ...LOGIC,
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
    ...calls('', ['trunc', 'sign', 'fract', 'atan']),
    // Odd: the builtin loses `x + sqrt(x^2 + 1)` for a negative `x`.
    'asinh': '(sign($0) * asinh(abs($0)))',
    // A colour is an OKLCh `vec3`; `asoklab` and `asrgb` give the channels
    // of their space, only as the result of the program (`resultOnly`).
    'oklch': 'vec3($0, $1, $2)',
    'oklab': {
      text: '_gpu_ir_lch(vec3($0, $1, $2))',
      helpers: ['_gpu_ir_lch'],
    },
    'rgb': {
      text: '_gpu_ir_lch(_gpu_ir_srgb_lab(vec3($0, $1, $2)))',
      helpers: ['_gpu_ir_lch', '_gpu_ir_srgb_lab'],
    },
    'hsv': {
      text: '_gpu_ir_lch(_gpu_ir_srgb_lab(_gpu_ir_hsv(vec3($0, $1, $2))))',
      helpers: ['_gpu_ir_lch', '_gpu_ir_srgb_lab', '_gpu_ir_hsv'],
    },
    'hsl': {
      text: '_gpu_ir_lch(_gpu_ir_srgb_lab(_gpu_ir_hsl(vec3($0, $1, $2))))',
      helpers: ['_gpu_ir_lch', '_gpu_ir_srgb_lab', '_gpu_ir_hsl'],
    },
    // A complex value is a `vec2` (re, im): the ring operations of GLSL's
    // vectors where they are the complex ones, a helper for the others
    // (the textbook formulas; no fidelity at a pole, a branch point or cut,
    // or on overflow of an intermediate).
    'cplx': 'vec2($0, 0.0)',
    'cadd': '($0 + $1)',
    'csub': '($0 - $1)',
    'cneg': '(-$0)',
    'cre': '$0.x',
    'cim': '$0.y',
    'cconj': '($0 * vec2(1.0, -1.0))',
    'cabs': 'length($0)',
    'carg': { text: '_gpu_ir_carg($0)', helpers: ['_gpu_ir_carg'] },
    'ceq': '($0 == $1)',
    'cne': '($0 != $1)',
    // A helper that calls `_gpu_ir_carg` lists it first, so that it is
    // defined before.
    ...Object.fromEntries(
      Object.entries(COMPLEX).map(([f, [b, ...body]]) => [
        `c${f}`,
        {
          text: `_gpu_ir_c${f}($0${b ? ', $1' : ''})`,
          helpers: [
            ...(body.some((s) => s.includes('_gpu_ir_carg('))
              ? ['_gpu_ir_carg']
              : []),
            `_gpu_ir_c${f}`,
          ],
        },
      ])
    ),
    'asoklch': '$0',
    'asoklab': { text: '_gpu_ir_lab($0)', helpers: ['_gpu_ir_lab'] },
    'asrgb': {
      text: '_gpu_ir_lab_srgb(_gpu_ir_lab($0))',
      helpers: ['_gpu_ir_lab', '_gpu_ir_lab_srgb'],
    },
  },
  helpers: {
    // The real power: an exact product for an integer exponent from 1 to 16
    // (the builtin is off by ulps: `10^3` is 999.99994), the sign of an
    // integer exponent of a negative base, NaN for a non-integer one, at
    // 0^0 and for a NaN operand (SwiftShader's `pow(NaN, 0.5)` is finite),
    // ∞ at 0^b for b < 0 (where `pow` is undefined). Each case is a select
    // of `mix`, with no branch and no loop, which SwiftShader renders
    // faster.
    _gpu_ir_pow: `float _gpu_ir_pow(float a, float b) {
  int n = int(clamp(b, 0.0, 16.0));
  float a2 = a * a, a4 = a2 * a2, a8 = a4 * a4;
  float q = mix(1.0, a, (n & 1) != 0) * mix(1.0, a2, (n & 2) != 0) * mix(1.0, a4, (n & 4) != 0) * mix(1.0, a8, n >= 8) * mix(1.0, a8, n == 16);
  bool k = b == floor(b);
  float r = pow(abs(a), b);
  r = mix(r, mix(${NAN}, mix(-r, r, mod(b, 2.0) == 0.0), k), a < 0.0);
  r = mix(r, 1.0, b == 0.0);
  r = mix(r, uintBitsToFloat(0x7f800000u), a == 0.0 && b < 0.0);
  r = mix(r, ${NAN}, isnan(a) || isnan(b) || (b == 0.0 && (a == 0.0 || isinf(a))));
  return mix(r, q, k && b >= 1.0 && b <= 16.0);
}`,
    // A base `>= 0` or NaN: the builtin, within a few ulps also for an
    // integer exponent (the product costs half the render time of a loop
    // that calls it), NaN at `0^b` for `b <= 0` and for a NaN operand
    // (`!(a >= 0.0)` is the NaN test of such a base, cheaper than `isnan`).
    _gpu_ir_pow_nonnegative: `float _gpu_ir_pow_nonnegative(float a, float b) {
  return mix(pow(a, b), ${NAN}, !(a >= 0.0) || isnan(b) || (a == 0.0 && b <= 0.0));
}`,
    // Half away from zero, with no addition of 0.5 (which rounds up just
    // below 0.5 and near 2^23).
    _gpu_ir_round: `float _gpu_ir_round(float x) {
  float a = abs(x);
  float r = floor(a);
  if (a - r >= 0.5) r += 1.0;
  return x < 0.0 ? -r : r;
}`,
    // `mod` rounds its quotient: `mod(1e8, 3.0)` is -2 on ANGLE Metal.
    _gpu_ir_fmod: `float _gpu_ir_fmod(float x, float y) {
  float r = mod(mod(x, y), y);
  r = r + y * (1.0 - step(0.0, r * sign(y)));
  return r - y * step(abs(y), r * sign(y));
}`,
    // The floored modulo of integers, on `int`s: exact for every operand
    // within 2^24, intermediate values included (a `float` product `b * q`
    // rounds: `Mod(-15000000, 6000001)`).
    _gpu_ir_imod: `float _gpu_ir_imod(float a, float b) {
  if (b == 0.0) return ${NAN};
  int ia = int(a), ib = int(b);
  int r = ia - ib * (ia / ib);
  if (r != 0 && (r < 0) != (ib < 0)) r += ib;
  return float(r);
}`,
    // `Root(x, n)`: the real root of a negative radicand for an odd
    // integer index, as `root` of `REAL_FUNCTIONS`; NaN for another index of
    // a negative radicand (the interpreter's real root of an odd
    // denominator, `Root(-8, 2.5)`, is not computed).
    _gpu_ir_root: `float _gpu_ir_root(float x, float n) {
  if (x == 0.0 && n > 0.0) return 0.0;
  if (n == 0.0) return ${NAN};
  if (x >= 0.0) return pow(x, 1.0 / n);
  return n == floor(n) && mod(n, 2.0) == 1.0 ? -pow(-x, 1.0 / n) : ${NAN};
}`,
    // `a / q` by the denominator `q` of a rational factor. A GLSL division
    // need not be correctly rounded (SwiftShader gives `(29.0 * -14.0) /
    // 7.0` just below -58): a quotient that is an integer or a half of one
    // is that value, as the correctly rounded division gives it, for a
    // dividend below 2^23, where `m * q` is exact.
    _gpu_ir_quot: `float _gpu_ir_quot(float a, float q) {
  float r = a / q;
  float m = floor(2.0 * r + 0.5);
  return abs(a) < 8388608.0 && m * q == 2.0 * a ? 0.5 * m : r;
}`,
    // `n!` of an integer: +∞ for a negative operand (a pole) and over 34
    // (35! is over the largest float).
    _gpu_ir_factorial: `float _gpu_ir_factorial(float n) {
  if (n < 0.0 || n > 34.0) return uintBitsToFloat(0x7f800000u);
  float r = 1.0;
  for (int i = 2; i <= 34; i++) if (float(i) <= n) r *= float(i);
  return r;
}`,
    // The greatest common divisor of two integers, on `int`s.
    _gpu_ir_gcd: `float _gpu_ir_gcd(float a, float b) {
  int x = abs(int(a)), y = abs(int(b));
  for (int i = 0; i < 64 && y != 0; i++) { int t = x % y; x = y; y = t; }
  return float(x);
}`,
    // The Fresnel integrals: the rational approximations of the kernels
    // `fresnelC` and `fresnelS` (Cephes). GLSL has no conversion between
    // array sizes, so every table is a `float[12]`, padded with zeros after
    // its `n` coefficients.
    _gpu_ir_polevl: `float _gpu_ir_polevl(float x, float c[12], int n) {
  float r = c[0];
  for (int i = 1; i < n; i++) r = r * x + c[i];
  return r;
}`,
    // For x >= 1.6: (f·sin z - g·cos z, f·cos z + g·sin z), z = πx²/2 of
    // the asymptotic expansion. The phase is reduced as (π/2)·(x² mod 4),
    // from x = n + r: n² mod 4 on `int`s, 2nr mod 4 (n·r is exact in
    // float) and r²: the float `(π/2)·x²` loses the phase as x grows. Then
    // (π/2)·q + w, q an integer, |w| <= π/4: the sine and cosine of w are
    // their Taylor polynomials (an error below 2e-9), not the builtins,
    // which a renderer can compute to 1e-5 only (SwiftShader).
    _gpu_ir_fresnel_fg: `vec2 _gpu_ir_fresnel_fg(float x) {
  float fn[12] = float[12](4.21543555043677546506e-1, 1.43407919780758885261e-1, 1.15220955073585758835e-2, 3.450179397825740279e-4, 4.63613749287867322088e-6, 3.05568983790257605827e-8, 1.02304514164907233465e-10, 1.72010743268161828879e-13, 1.34283276233062758925e-16, 3.76329711269987889006e-20, 0.0, 0.0);
  float fd[12] = float[12](1.0, 7.51586398353378947175e-1, 1.16888925859191382142e-1, 6.44051526508858611005e-3, 1.55934409164153020873e-4, 1.8462756734893054587e-6, 1.12699224763999035261e-8, 3.60140029589371370404e-11, 5.8875453362157841001e-14, 4.52001434074129701496e-17, 1.25443237090011264384e-20, 0.0);
  float gn[12] = float[12](5.04442073643383265887e-1, 1.97102833525523411709e-1, 1.87648584092575249293e-2, 6.84079380915393090172e-4, 1.15138826111884280931e-5, 9.82852443688422223854e-8, 4.45344415861750144738e-10, 1.08268041139020870318e-12, 1.37555460633261799868e-15, 8.36354435630677421531e-19, 1.86958710162783235106e-22, 0.0);
  float gd[12] = float[12](1.0, 1.47495759925128324529, 3.37748989120019970451e-1, 2.53603741420338795122e-2, 8.14679107184306179049e-4, 1.27545075667729118702e-5, 1.04314589657571990585e-7, 4.60680728146520428211e-10, 1.10273215066240270757e-12, 1.38796531259578871258e-15, 8.39158816283118707363e-19, 1.86958710162783236342e-22);
  float t = 3.14159265 * x * x;
  float u = 1.0 / (t * t);
  float f = 1.0 - u * _gpu_ir_polevl(u, fn, 10) / _gpu_ir_polevl(u, fd, 11);
  float g = _gpu_ir_polevl(u, gn, 11) / (t * _gpu_ir_polevl(u, gd, 12));
  float n = floor(x);
  float r = x - n;
  int k = int(mod(n, 4.0));
  float m = mod(float((k * k) % 4) + 2.0 * mod(n * r, 2.0) + r * r, 4.0);
  float q = floor(m + 0.5);
  float w = 1.57079633 * (m - q);
  float w2 = w * w;
  float s0 = w * (1.0 - w2 / 6.0 * (1.0 - w2 / 20.0 * (1.0 - w2 / 42.0 * (1.0 - w2 / 72.0))));
  float c0 = 1.0 - w2 / 2.0 * (1.0 - w2 / 12.0 * (1.0 - w2 / 30.0 * (1.0 - w2 / 56.0 * (1.0 - w2 / 90.0))));
  int j = int(q) % 4;
  float s = j == 0 ? s0 : j == 1 ? c0 : j == 2 ? -s0 : -c0;
  float c = j == 0 ? c0 : j == 1 ? -s0 : j == 2 ? -c0 : s0;
  return vec2(f * s - g * c, f * c + g * s);
}`,
    // C(x) and S(x), odd; ±1/2 from |x| = 1e7, where the oscillation
    // 1/(πx) is about one ulp of 1/2.
    _gpu_ir_fresnelc: `float _gpu_ir_fresnelc(float x_in) {
  float x = abs(x_in);
  float v;
  if (x < 1.6) {
    float cn[12] = float[12](-4.98843114573573548651e-8, 9.50428062829859605134e-6, -6.45191435683965050962e-4, 1.88843319396703850064e-2, -2.05525900955013891793e-1, 9.99999999999999998822e-1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    float cd[12] = float[12](3.99982968972495980367e-12, 9.15439215774657478799e-10, 1.25001862479598821474e-7, 1.22262789024179030997e-5, 8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    float t = x * x * x * x;
    v = x * _gpu_ir_polevl(t, cn, 6) / _gpu_ir_polevl(t, cd, 7);
  } else if (x < 1e7) {
    v = 0.5 + _gpu_ir_fresnel_fg(x).x / (3.14159265 * x);
  } else v = 0.5;
  return x_in < 0.0 ? -v : v;
}`,
    _gpu_ir_fresnels: `float _gpu_ir_fresnels(float x_in) {
  float x = abs(x_in);
  float v;
  if (x < 1.6) {
    float sn[12] = float[12](-2.99181919401019853726e3, 7.08840045257738576863e5, -6.29741486205862506537e7, 2.54890880573376359104e9, -4.42979518059697779103e10, 3.18016297876567817986e11, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    float sd[12] = float[12](1.0, 2.81376268889994315696e2, 4.55847810806532581675e4, 5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10, 6.07366389490084914091e11, 0.0, 0.0, 0.0, 0.0, 0.0);
    float t = x * x * x * x;
    v = x * x * x * _gpu_ir_polevl(t, sn, 6) / _gpu_ir_polevl(t, sd, 7);
  } else if (x < 1e7) {
    v = 0.5 - _gpu_ir_fresnel_fg(x).y / (3.14159265 * x);
  } else v = 0.5;
  return x_in < 0.0 ? -v : v;
}`,
    // The colour conversions of the interpreter (`@arnog/colors`): OKLab to
    // OKLCh (hue in degrees, in [0, 360)) and back; extended sRGB (a
    // channel outside [0, 1] keeps the sign of the transfer) to OKLab and
    // back, with no clamp and no gamut mapping.
    _gpu_ir_lch: `vec3 _gpu_ir_lch(vec3 c) {
  float h = c.y == 0.0 && c.z == 0.0 ? 0.0 : degrees(atan(c.z, c.y));
  return vec3(c.x, length(c.yz), h < 0.0 ? h + 360.0 : h);
}`,
    _gpu_ir_lab: `vec3 _gpu_ir_lab(vec3 c) {
  float h = radians(c.z);
  return vec3(c.x, c.y * cos(h), c.y * sin(h));
}`,
    _gpu_ir_srgb_lab: `vec3 _gpu_ir_srgb_lab(vec3 c) {
  vec3 a = abs(c);
  vec3 l = sign(c) * mix(pow((a + 0.055) / 1.055, vec3(2.4)), a / 12.92, lessThanEqual(a, vec3(0.04045)));
  vec3 m = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * l;
  m = sign(m) * pow(abs(m), vec3(1.0 / 3.0));
  return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.793617785, -2.428592205, 0.7827717662, -0.0040720468, 0.4505937099, -0.808675766) * m;
}`,
    // HSV and HSL (hue in degrees, wrapped; saturation, value and lightness
    // clamped into [0, 1]) to sRGB, the piecewise-linear formulas of the
    // interpreter (`hsvToRgb`, `hslToRgb255`) in closed form.
    _gpu_ir_hsv: `vec3 _gpu_ir_hsv(vec3 c) {
  vec3 k = clamp(abs(mod(c.x / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return clamp(c.z, 0.0, 1.0) * mix(vec3(1.0), k, clamp(c.y, 0.0, 1.0));
}`,
    _gpu_ir_hsl: `vec3 _gpu_ir_hsl(vec3 c) {
  vec3 k = clamp(abs(mod(c.x / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  float l = clamp(c.z, 0.0, 1.0);
  return l + clamp(c.y, 0.0, 1.0) * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0));
}`,
    _gpu_ir_lab_srgb: `vec3 _gpu_ir_lab_srgb(vec3 c) {
  vec3 m = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.291485548) * c;
  vec3 l = mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.707614701) * (m * m * m);
  vec3 a = abs(l);
  return sign(l) * mix(1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, 12.92 * a, lessThanEqual(a, vec3(0.0031308)));
}`,
    // The argument of a complex, in (-π, π]: on an axis it is written,
    // since a renderer's `atan(y, x)` with a zero part computed as -0 is
    // wrong there (SwiftShader: `atan(-0, 3)` is π; a GPU: the sign of
    // `atan(2, -0)`). `Argument(0)` is 0, as in the interpreter.
    _gpu_ir_carg: `float _gpu_ir_carg(vec2 a) {
  if (a.y == 0.0) {
    if (a.x < 0.0) return 3.1415927;
    return 0.0;
  }
  if (a.x == 0.0) {
    if (a.y < 0.0) return -1.5707964;
    return 1.5707964;
  }
  return atan(a.y, a.x);
}`,
    ...Object.fromEntries(
      Object.entries(COMPLEX).map(([f, [b, ...body]]) => [
        `_gpu_ir_c${f}`,
        [
          `vec2 _gpu_ir_c${f}(vec2 a${b ? ', vec2 b' : ''}) {`,
          ...body.map((s) => `  ${s}`),
          '}',
        ].join('\n'),
      ])
    ),
    // The element `k` (from 0) of a list in a sampler (README, `storage`).
    _gpu_ir_texel: `float _gpu_ir_texel(sampler2D v, int k) {
  int w = textureSize(v, 0).x;
  return texelFetch(v, ivec2(k % w, k / w), 0).r;
}`,
  },
  regions: {},
  // A complex constant is a `vec2` (re, im).
  constant: ({ value: x }) =>
    typeof x === 'number'
      ? float(x)
      : typeof x === 'object'
        ? `vec2(${float(x.re)}, ${float(x.im)})`
        : String(x),
  input: glslParameterName,
  positional: glslParameterName,
  length: () => {
    throw new Error('slice GLSL printer: a run-time length');
  },
  list: (elements, t) => `${typeName(t)}(${elements.join(', ')})`,
  declare: (t, name, value) =>
    `${declarator(t, name)}${value === undefined ? '' : ` = ${value}`};`,
  // An `int` counter: a `float` one stops advancing at 2^24. The bounds are
  // clamped to ±2^30 before the conversion.
  loopOpen: (k, lo, hi, _passes, done) => [
    `int ${k}_hi = int(clamp(${hi}, -1073741824.0, 1073741824.0));`,
    `for (int ${k}_i = int(clamp(${lo}, -1073741824.0, 1073741824.0)); ${k}_i <= ${k}_hi${done === undefined ? '' : ` && !${done}`}; ${k}_i++) {`,
    `  float ${k} = float(${k}_i);`,
  ],
  // A helper is named `_gpu_ir_…` and a user function `_fn_ir_…`: a host
  // that joins two compilations in one shader renames by `_gpu_` and `_fn_`,
  // and the `ir_` keeps them apart from the names of other GLSL code.
  call: (fn, args) => `_fn_ir_${fn}(${args.join(', ')})`,
  fn: (name, params, result, body) =>
    [
      `${typeName(result)} _fn_ir_${name}(${params.map((p) => declarator(p.type, p.name)).join(', ')}) {`,
      ...body,
      '}',
    ].join('\n'),
});

export type GlslResult = {
  /** The helper functions, the other functions and the definition of the
   *  function `f`. */
  readonly code: string;
  /** The parameters, in order: the input, the GLSL name, the GLSL type. */
  readonly parameters: { input: string; name: string; type: string }[];
  readonly returnType: string;
  readonly printed: Printed;
};

export function printGlsl(
  p: Program,
  rows: readonly OperatorRow[],
  syntax: Syntax
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
    `${returnType} f(${params.join(', ')}) {`,
    ...printed.body,
    '}',
  ].join('\n');
  return { code, parameters, returnType, printed };
}
