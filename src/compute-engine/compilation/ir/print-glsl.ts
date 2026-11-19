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
    // The reciprocal inverse functions, as `REAL_FUNCTIONS` computes them:
    // `Arccot` in (0, π), with no cancellation of `π/2 - atan(x)` for a
    // large positive `x`; a pole is ±∞, a value that is not real NaN.
    'acot': '($0 > 0.0 ? atan(1.0 / $0) : 1.5707964 - atan($0))',
    // \`acos\` of SwiftShader is wrong by 5e-5 (\`acos(0.5)\`): arccos y is
    // atan(√((1 - y)(1 + y)), y).
    'asec': {
      text: `(abs($0) >= 1.0 ? _gpu_ir_acos(1.0 / $0) : ${NAN})`,
      helpers: ['_gpu_ir_acos'],
    },
    'acsc': `(abs($0) >= 1.0 ? asin(1.0 / $0) : ${NAN})`,
    'acoth': {
      text: '_gpu_ir_acoth($0)',
      helpers: ['_gpu_ir_acoth'],
    },
    'asech': {
      text: '_gpu_ir_asech($0)',
      helpers: ['_gpu_ir_log1p', '_gpu_ir_asech'],
    },
    'acsch': {
      text: '_gpu_ir_acsch($0)',
      helpers: ['_gpu_ir_log1p', '_gpu_ir_acsch'],
    },
    'hav': {
      text: '_gpu_ir_hav($0)',
      helpers: ['_gpu_ir_sincospi', '_gpu_ir_hav'],
    },
    // `Arctan2(y, x)`; the interpreter's value at (0, 0) is 0.
    'atan2': '($0 == 0.0 && $1 == 0.0 ? 0.0 : atan($0, $1))',
    'hypot': 'length(vec2($0, $1))',
    'chop': '(abs($0) <= $1 ? 0.0 : $0)',
    'root': { text: '_gpu_ir_root($0, $1)', helpers: ['_gpu_ir_root'] },
    // A real operand declines (no `factorial` spelling): `Gamma(x + 1)`.
    'factorial.int': {
      text: '_gpu_ir_factorial($0)',
      helpers: ['_gpu_ir_factorial'],
    },
    'gcd': { text: '_gpu_ir_gcd($0, $1)', helpers: ['_gpu_ir_gcd'] },
    'lcm': {
      text: '_gpu_ir_lcm($0, $1)',
      helpers: ['_gpu_ir_gcd', '_gpu_ir_lcm'],
    },
    'binomial': {
      text: '_gpu_ir_binomial($0, $1)',
      helpers: ['_gpu_ir_binomial'],
    },
    // `n!` of a real: the product at an integer, `Γ(x + 1)` elsewhere.
    'factorial': {
      text: '(($0) == floor($0) ? _gpu_ir_factorial($0) : _gpu_ir_gamma(($0) + 1.0))',
      helpers: ['_gpu_ir_factorial', '_gpu_ir_sincospi', '_gpu_ir_gamma'],
    },
    'factorial2': {
      text: '_gpu_ir_factorial2($0)',
      helpers: ['_gpu_ir_factorial2'],
    },
    'gamma': {
      text: '_gpu_ir_gamma($0)',
      helpers: ['_gpu_ir_sincospi', '_gpu_ir_gamma'],
    },
    'gammaln': {
      text: '_gpu_ir_gammaln($0)',
      helpers: ['_gpu_ir_sincospi', '_gpu_ir_gammaln'],
    },
    'erf': {
      text: '_gpu_ir_erf($0)',
      helpers: ['_gpu_ir_erfc_pos', '_gpu_ir_erf'],
    },
    'erfc': {
      text: '_gpu_ir_erfc($0)',
      helpers: ['_gpu_ir_erfc_pos', '_gpu_ir_erf', '_gpu_ir_erfc'],
    },
    'zeta': {
      text: '_gpu_ir_zeta($0)',
      helpers: [
        '_gpu_ir_sincospi',
        '_gpu_ir_gamma',
        '_gpu_ir_gammaln',
        '_gpu_ir_zeta',
      ],
    },
    'heaviside': {
      text: '_gpu_ir_heaviside($0)',
      helpers: ['_gpu_ir_heaviside'],
    },
    'remainder.int': {
      text: '_gpu_ir_iremainder($0, $1)',
      helpers: ['_gpu_ir_iremainder'],
    },
    'remainder': {
      text: '_gpu_ir_remainder($0, $1)',
      helpers: ['_gpu_ir_fmod', '_gpu_ir_remainder'],
    },
    'smoothstep': {
      text: '_gpu_ir_smoothstep($0, $1, $2)',
      helpers: ['_gpu_ir_smoothstep'],
    },
    // InverseHaversine: 2 arcsin √x, real on [0, 1].
    'invhav': `($0 >= 0.0 && $0 <= 1.0 ? 2.0 * asin(sqrt($0)) : ${NAN})`,
    'erfinv': { text: '_gpu_ir_erfinv($0)', helpers: ['_gpu_ir_erfinv'] },
    'beta': {
      text: '_gpu_ir_beta($0, $1)',
      helpers: [
        '_gpu_ir_sincospi',
        '_gpu_ir_gamma',
        '_gpu_ir_gammaln',
        '_gpu_ir_beta',
      ],
    },
    'besselj': {
      text: '_gpu_ir_besselj($0, $1)',
      helpers: ['_gpu_ir_sincospi', '_gpu_ir_besselj'],
    },
    'digamma': {
      text: '_gpu_ir_digamma($0)',
      helpers: ['_gpu_ir_sincospi', '_gpu_ir_digamma'],
    },
    'trigamma': {
      text: '_gpu_ir_trigamma($0)',
      helpers: ['_gpu_ir_sincospi', '_gpu_ir_trigamma'],
    },
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
    'boole': '($0 ? 1.0 : 0.0)',
    'elem': '$0[int($1)]',
    'isnan': 'isnan($0)',
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
    // The least common multiple of two integers; 0 when one is 0.
    _gpu_ir_lcm: `float _gpu_ir_lcm(float a, float b) {
  if (a == 0.0 || b == 0.0) return 0.0;
  return abs(a) / _gpu_ir_gcd(a, b) * abs(b);
}`,
    // `C(n, k)` of integers, as `binomial()` of the runtime: a negative `k`
    // or `n` is reflected to `C(m, j)` with a sign, then the product
    // `C(n - j + i, i)` for i = 1..j, each quotient an integer (rounded to
    // it below 2^24, where a GLSL division need not be exact). From j = 131
    // the value is over the largest float.
    _gpu_ir_binomial: `float _gpu_ir_binomial(float n, float k) {
  float s = 1.0;
  if (k < 0.0) {
    if (n >= 0.0 || n < k) return 0.0;
    s = mod(n - k, 2.0) == 0.0 ? 1.0 : -1.0;
    float m = -k - 1.0;
    k = min(-n - 1.0, n - k);
    n = m;
  } else if (n < 0.0) {
    s = mod(k, 2.0) == 0.0 ? 1.0 : -1.0;
    float m = k - n - 1.0;
    k = min(k, -n - 1.0);
    n = m;
  }
  if (k > n) return 0.0;
  float j = min(k, n - k);
  if (j > 130.0) return s * uintBitsToFloat(0x7f800000u);
  float r = 1.0;
  for (int i = 1; i <= 130; i++) {
    if (float(i) > j) break;
    float p = r * (n - j + float(i));
    r = p < 16777216.0
      ? floor(p / float(i) + 0.5)
      : r * ((n - j + float(i)) / float(i));
  }
  return s * r;
}`,
    // n!! of a real, as `factorial2` of the runtime: NaN for a non-integer,
    // +∞ at a negative even integer (a pole), ±1/(m - 2)!! for a negative
    // odd -m, and +∞ from 57!! (over the largest float).
    _gpu_ir_factorial2: `float _gpu_ir_factorial2(float n) {
  if (n != floor(n)) return ${NAN};
  if (n < 0.0) {
    if (mod(n, 2.0) == 0.0) return uintBitsToFloat(0x7f800000u);
    float m = -n;
    float r = mod((m - 1.0) * 0.5, 2.0) == 0.0 ? 1.0 : -1.0;
    for (int k = 3; k < 200; k += 2) {
      if (float(k) > m - 2.0 || r == 0.0) break;
      r /= float(k);
    }
    return r;
  }
  if (n > 128.0) return uintBitsToFloat(0x7f800000u);
  float r = 1.0;
  for (int k = 0; k < 64; k++) {
    float v = n - 2.0 * float(k);
    if (v <= 1.0) break;
    r *= v;
  }
  return r;
}`,
    // Γ(x): +∞ at a pole (a non-positive integer); the product (x - 1)! at a
    // positive integer; for x >= 0.5 the Lanczos sum (g = 7, n = 9) at the
    // fraction of x in [1, 2), times the product of the steps up to x; for
    // x < 0.5 the reflection π / (sin(πx) Γ(1 - x)), the sine taken at the
    // exact distance of x to the nearest integer.
    _gpu_ir_gamma: `float _gpu_ir_gamma(float z) {
  if (z <= 0.0 && z == floor(z)) return uintBitsToFloat(0x7f800000u);
  if (z > 35.5) return uintBitsToFloat(0x7f800000u);
  float x = z < 0.5 ? 1.0 - z : z;
  float g;
  if (x == floor(x)) {
    g = 1.0;
    for (int i = 2; i < 36; i++) if (float(i) < x) g *= float(i);
  } else {
    float w = fract(x);
    float q = 1.0;
    for (int i = 1; i < 36; i++) if (float(i) + w < x) q *= float(i) + w;
    float a = 0.99999999999980993 + 676.5203681218851 / (w + 1.0) - 1259.1392167224028 / (w + 2.0) + 771.32342877765313 / (w + 3.0) - 176.61502916214059 / (w + 4.0) + 12.507343278686905 / (w + 5.0) - 0.13857109526572012 / (w + 6.0) + 9.9843695780195716e-6 / (w + 7.0) + 1.5056327351493116e-7 / (w + 8.0);
    float t = w + 7.5;
    g = 2.5066282746310002 * pow(t, w + 0.5) * exp(-t) * a * q;
    // The sum is Γ(w + 1): below 1, x is w.
    if (x < 1.0) g /= x;
  }
  if (z >= 0.5) return g;
  return 3.14159265 / (_gpu_ir_sincospi(z).x * g);
}`,
    // ln|Γ(x)|: +∞ at a pole; for x > 0 the Stirling series at x + n >= 8,
    // less the logarithm of the product x (x + 1) ... (x + n - 1); for
    // x < 0 the reflection ln π - ln|sin(πx)| - ln Γ(1 - x).
    _gpu_ir_gammaln: `float _gpu_ir_gammaln(float z) {
  if (z <= 0.0 && z == floor(z)) return uintBitsToFloat(0x7f800000u);
  float x = z < 0.0 ? 1.0 - z : z;
  float p = 1.0;
  for (int i = 0; i < 8; i++) {
    if (x >= 8.0) break;
    p *= x;
    x += 1.0;
  }
  float x2 = 1.0 / (x * x);
  float r = (x - 0.5) * log(x) - x + 0.91893853320467274 + (1.0 / 12.0 - x2 * (1.0 / 360.0 - x2 * (1.0 / 1260.0 - x2 / 1680.0))) / x - log(p);
  if (z > 0.0) return r;
  return 1.1447298858494002 - log(abs(_gpu_ir_sincospi(z).x)) - r;
}`,
    // erfc(y) for y >= 0, to a relative error of about 1.2e-7 (the
    // Chebyshev fit `erfcc` of Numerical Recipes); e^{-y²} is the product
    // of e^{-h²}, h = y rounded down to 1/16 (h² exact), and e^{-(y-h)(y+h)},
    // so the rounding of y² is not lost; 0 from y = 10 (below the smallest
    // float).
    _gpu_ir_erfc_pos: `float _gpu_ir_erfc_pos(float y) {
  if (y >= 10.0) return 0.0;
  float t = 1.0 / (1.0 + 0.5 * y);
  float p = -1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  float h = floor(y * 16.0) / 16.0;
  return t * exp(-h * h) * exp(p - (y - h) * (y + h));
}`,
    // erf(x): its Taylor polynomial below 0.5, 1 - erfc(|x|) above, odd.
    _gpu_ir_erf: `float _gpu_ir_erf(float x) {
  float y = abs(x);
  if (y < 0.5) {
    float s = x * x;
    return 1.1283791670955126 * x * (1.0 - s * (1.0 / 3.0 - s * (0.1 - s * (1.0 / 42.0 - s * (1.0 / 216.0 - s / 1320.0)))));
  }
  float r = 1.0 - _gpu_ir_erfc_pos(y);
  return x < 0.0 ? -r : r;
}`,
    _gpu_ir_erfc: `float _gpu_ir_erfc(float x) {
  if (abs(x) < 0.5) return 1.0 - _gpu_ir_erf(x);
  return x > 0.0 ? _gpu_ir_erfc_pos(x) : 2.0 - _gpu_ir_erfc_pos(-x);
}`,
    // ζ(s) of a real s: +∞ at the pole s = 1, 0 at a negative even integer;
    // for s >= 1/2 the Euler-Maclaurin sum with N = 10 and six Bernoulli
    // terms; below, the reflection 2 (2π)^(s-1) sin(πs/2) Γ(1 - s) ζ(1 - s).
    _gpu_ir_zeta: `float _gpu_ir_zeta(float s) {
  if (s == 1.0) return uintBitsToFloat(0x7f800000u);
  if (s == 0.0) return -0.5;
  if (s < 0.0 && mod(s, 2.0) == 0.0) return 0.0;
  float t = s < 0.5 ? 1.0 - s : s;
  float sum = 0.0;
  for (int k = 1; k < 10; k++) sum += pow(float(k), -t);
  float nt = pow(10.0, -t);
  sum += 10.0 * nt / (t - 1.0) + 0.5 * nt;
  float b[6] = float[6](1.0 / 12.0, -1.0 / 720.0, 1.0 / 30240.0, -1.0 / 1209600.0, 1.0 / 47900160.0, -691.0 / 1307674368000.0);
  float c = t * nt * 0.1;
  for (int k = 0; k < 6; k++) {
    sum += b[k] * c;
    float m = t + float(2 * k);
    c *= (m + 1.0) * (m + 2.0) * 0.01;
  }
  if (s >= 0.5) return sum;
  float sn = _gpu_ir_sincospi(0.5 * s).x;
  // (2π)^(s-1) Γ(1 - s), in log form where Γ(1 - s) overflows.
  float m = t > 34.0 ? exp(_gpu_ir_gammaln(t) + (s - 1.0) * 1.8378771) : pow(6.2831853, s - 1.0) * _gpu_ir_gamma(t);
  return 2.0 * sn * m * sum;
}`,
    // arcoth x = artanh(1/x) for |x| > 1, ±∞ at ±1, NaN between: the odd
    // series of artanh below 0.1 (the builtin is a quotient of logarithms
    // that loses the digits of a small operand), the logarithm above.
    _gpu_ir_acoth: `float _gpu_ir_acoth(float x) {
  float a = abs(x);
  if (!(a >= 1.0)) return ${NAN};
  float r;
  if (a == 1.0) r = uintBitsToFloat(0x7f800000u);
  else {
    float u = 1.0 / a;
    if (u < 0.1) {
      float u2 = u * u;
      r = u * (1.0 + u2 * (1.0 / 3.0 + u2 * (0.2 + u2 * (1.0 / 7.0 + u2 * (1.0 / 9.0 + u2 * (1.0 / 11.0 + u2 / 13.0))))));
    } else r = 0.5 * log((a + 1.0) / (a - 1.0));
  }
  return x < 0.0 ? -r : r;
}`,
    // arsech x = log1p(√((1 - x)(1 + x))) - ln x for 0 < x <= 1, +∞ at 0,
    // NaN outside.
    _gpu_ir_asech: `float _gpu_ir_asech(float x) {
  if (!(x >= 0.0 && x <= 1.0)) return ${NAN};
  if (x == 0.0) return uintBitsToFloat(0x7f800000u);
  return _gpu_ir_log1p(sqrt((1.0 - x) * (1.0 + x))) - log(x);
}`,
    // arcsch x = arsinh(1/x), odd, +∞ at 0: log1p(v) with
    // v = u + u²/(1 + √(1 + u²)), u = 1/|x|; ln 2 - ln|x| below 1e-10.
    _gpu_ir_acsch: `float _gpu_ir_acsch(float x) {
  if (x == 0.0) return uintBitsToFloat(0x7f800000u);
  float a = abs(x);
  float r;
  if (a < 1e-10) r = 0.69314718 - log(a);
  else {
    float u = 1.0 / a;
    r = _gpu_ir_log1p(u + u * u / (1.0 + sqrt(1.0 + u * u)));
  }
  return x < 0.0 ? -r : r;
}`,
    // H(x): 0 below 0, 1/2 at 0, 1 above; a NaN is returned as it is, tested
    // by its bits (a compiler may remove `isnan(x)` or `x != x`; ANGLE
    // Metal gave 0.5 for `0.5 + 0.0 * x` of a NaN, CE-520).
    _gpu_ir_heaviside: `float _gpu_ir_heaviside(float x) {
  if ((floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u) return x;
  if (x < 0.0) return 0.0;
  if (x > 0.0) return 1.0;
  return 0.5;
}`,
    // The remainder of a / b with the quotient rounded to the nearest
    // integer, a tie toward +∞ (the interpreter's `Remainder`), from the
    // remainder of the truncated quotient r: |r| - |b| where 2|r| > |b|,
    // and at a tie where r / b > 0. On `int`s (`%` of a negative operand is
    // undefined in GLSL ES 3.00), exact within 2^24; NaN for b = 0.
    _gpu_ir_iremainder: `float _gpu_ir_iremainder(float a, float b) {
  if (b == 0.0) return ${NAN};
  int ia = int(a), ib = abs(int(b));
  int r = abs(ia) % ib;
  if (ia < 0) r = -r;
  int h = 2 * abs(r);
  if (h > ib || (h == ib && (r > 0) == (b > 0.0))) r -= r > 0 ? ib : -ib;
  return float(r);
}`,
    // The same of reals, the truncated remainder from `_gpu_ir_fmod`.
    _gpu_ir_remainder: `float _gpu_ir_remainder(float a, float b) {
  if (b == 0.0) return ${NAN};
  float ib = abs(b);
  float r = _gpu_ir_fmod(abs(a), ib);
  if (a < 0.0) r = -r;
  float h = 2.0 * abs(r);
  if (h > ib || (h == ib && (r > 0.0) == (b > 0.0))) r -= r > 0.0 ? ib : -ib;
  return r;
}`,
    // smoothstep(e0, e1, x) of the interpreter: t²(3 - 2t), t the clamped
    // (x - e0)/(e1 - e0); the step at x = e0 when e0 = e1; NaN for a NaN
    // operand (tested by its bits: the builtin gives 0 on Apple GPUs, CE-520).
    _gpu_ir_smoothstep: `float _gpu_ir_smoothstep(float e0, float e1, float x) {
  if ((floatBitsToUint(e0) & 0x7FFFFFFFu) > 0x7F800000u || (floatBitsToUint(e1) & 0x7FFFFFFFu) > 0x7F800000u || (floatBitsToUint(x) & 0x7FFFFFFFu) > 0x7F800000u) return ${NAN};
  if (e0 == e1) return x < e0 ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}`,
    // erf⁻¹(x) for |x| < 1 (Giles, "Approximating the erfinv function",
    // the single-precision fit); ±∞ at ±1, NaN outside.
    _gpu_ir_erfinv: `float _gpu_ir_erfinv(float x) {
  if (abs(x) == 1.0) return x * uintBitsToFloat(0x7f800000u);
  if (!(abs(x) < 1.0)) return ${NAN};
  float w = -log((1.0 - x) * (1.0 + x));
  float p;
  if (w < 5.0) {
    w = w - 2.5;
    p = 2.81022636e-08;
    p = 3.43273939e-07 + p * w;
    p = -3.5233877e-06 + p * w;
    p = -4.39150654e-06 + p * w;
    p = 0.00021858087 + p * w;
    p = -0.00125372503 + p * w;
    p = -0.00417768164 + p * w;
    p = 0.246640727 + p * w;
    p = 1.50140941 + p * w;
  } else {
    w = sqrt(w) - 3.0;
    p = -0.000200214257;
    p = 0.000100950558 + p * w;
    p = 0.00134934322 + p * w;
    p = -0.00367342844 + p * w;
    p = 0.00573950773 + p * w;
    p = -0.0076224613 + p * w;
    p = 0.00943887047 + p * w;
    p = 1.00167406 + p * w;
    p = 2.83297682 + p * w;
  }
  return p * x;
}`,
    // B(a, b) = Γ(a) Γ(b) / Γ(a + b); in log form for a, b > 0 with
    // a + b > 30 (an error of about 2e-7 per unit of |ln B| there); for
    // integers -n <= 0 < m, the finite value of the cancelling poles
    // (-1/n) Π k/(k - n) when n >= m, a pole (NaN, as the runtime) when
    // n < m.
    _gpu_ir_beta: `float _gpu_ir_beta(float a, float b) {
  if (a == floor(a) && b == floor(b) && (a <= 0.0) != (b <= 0.0)) {
    float n = -min(a, b), m = max(a, b);
    if (n < m) return ${NAN};
    if (m <= 100.0) {
      float r = -1.0 / n;
      for (int k = 1; k < 100; k++) {
        if (float(k) >= m) break;
        r *= float(k) / (float(k) - n);
      }
      return r;
    }
  }
  if (a > 0.0 && b > 0.0 && a + b > 30.0)
    return exp(_gpu_ir_gammaln(a) + _gpu_ir_gammaln(b) - _gpu_ir_gammaln(a + b));
  return _gpu_ir_gamma(a) * _gpu_ir_gamma(b) / _gpu_ir_gamma(a + b);
}`,
    // ψ(x) and ψ₁(x) of a real x (the deleted GPU target's
    // helpers, measured there against the double kernels): +∞ at a pole (a
    // non-positive integer), NaN at -∞. ψ: the reflection for x < 0, the
    // recurrence up to 6, the asymptotic series to B₈; ψ₁ the same way.
    _gpu_ir_digamma: `float _gpu_ir_digamma(float x) {
  const float PI = 3.14159265358979;
  if (x <= 0.0 && x == floor(x))
    return x >= -3.4028234663852886e38 ? uintBitsToFloat(0x7f800000u) : ${NAN};
  float result = 0.0;
  float z = x;
  if (x < 0.0) {
    float r = x - floor(x + 0.5);
    vec2 sc = _gpu_ir_sincospi(x);
    result = -PI * sc.y / sc.x;
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
}`,
    _gpu_ir_trigamma: `float _gpu_ir_trigamma(float x) {
  const float PI = 3.14159265358979;
  if (x <= 0.0 && x == floor(x))
    return x >= -3.4028234663852886e38 ? uintBitsToFloat(0x7f800000u) : ${NAN};
  float result = 0.0;
  float sgn = 1.0;
  float z = x;
  if (x < 0.0) {
    float sr = _gpu_ir_sincospi(x).x;
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
}`,
    // J_n(x) of an integer order: the power series only for x² < 4(n + 1),
    // where its terms do not cancel in single precision; Hankel's
    // asymptotic expansion for x > 25 + n²/2, or where the recurrence would
    // need more than 400 steps; Miller's backward recurrence between
    // (normalized by J₀ + 2 Σ J₂ₖ = 1, rescaled to stay in range);
    // J₋ₙ = (-1)ⁿ Jₙ and Jₙ(-x) = (-1)ⁿ Jₙ(x). The deleted GPU target took
    // the series up to x < 5 + n, which is wrong by up to 175% near there
    // in single precision (J₂₅(29.9)).
    _gpu_ir_besselj: `float _gpu_ir_besselj(float order, float x) {
  int n = int(order);
  if (x == 0.0) return n == 0 ? 1.0 : 0.0;
  float sgn = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) sgn = -1.0;
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) sgn = -sgn;
  }
  int M = max(n + 20, int(ceil(x)) + 30);
  if (M % 2 != 0) M += 1;
  if (x > 25.0 + float(n * n) / 2.0 || M > 400) {
    float mu = 4.0 * float(n) * float(n);
    float P = 1.0, Q = 0.0, ak = 1.0, kf = 1.0;
    for (int k = 1; k <= 12; k++) {
      float c = float(2 * k - 1);
      ak *= mu - c * c;
      kf *= float(k);
      float contrib = ak / (kf * pow(8.0 * x, float(k)));
      if (k % 2 == 1) {
        if (((k - 1) / 2) % 2 == 0) Q += contrib;
        else Q -= contrib;
      } else {
        if ((k / 2) % 2 == 1) P -= contrib;
        else P += contrib;
      }
      if (abs(contrib) < 1e-7) break;
    }
    vec2 sc = _gpu_ir_sincospi(x * 0.31830988618379067 - (float(n) / 2.0 + 0.25));
    return sgn * sqrt(2.0 / (3.14159265358979 * x)) * (P * sc.y - Q * sc.x);
  }
  if (x * x < 4.0 * float(n + 1)) {
    float negQ = -(x * x) / 4.0;
    float term = 1.0;
    for (int i = 1; i <= n; i++) term *= (x / 2.0) / float(i);
    float s = term;
    for (int k = 1; k <= 60; k++) {
      term *= negQ / (float(k) * float(n + k));
      s += term;
      if (abs(term) < abs(s) * 1e-7) break;
    }
    return sgn * s;
  }
  float jp1 = 0.0;
  float jk = 1.0;
  float jn = M == n ? 1.0 : 0.0;
  float norm = 2.0;
  for (int i = 0; i < 400; i++) {
    int k = M - i;
    if (k < 1) break;
    float jm1 = (2.0 * float(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    if (k - 1 == n) jn = jk;
    if (k - 1 == 0) norm += jk;
    else if ((k - 1) % 2 == 0) norm += 2.0 * jk;
    if (abs(jk) > 1e15) {
      jk *= 1e-15; jp1 *= 1e-15; jn *= 1e-15; norm *= 1e-15;
    }
  }
  return sgn * jn / norm;
}`,
    // hav x = sin²(x/2).
    _gpu_ir_hav: `float _gpu_ir_hav(float x) {
  float s = _gpu_ir_sincospi(x * 0.15915494309189535).x;
  return s * s;
}`,
    // (sin πu, cos πu) of a finite u: the Taylor polynomials at the exact
    // distance f of u to the nearest integer k (|πf| <= π/2, an error below
    // 1e-9), the signs of k's parity. The builtins of a renderer are exact
    // to an absolute 1e-4 only (SwiftShader: \`sin(1.25)\`), and the product
    // π·x loses the fraction of a large x.
    _gpu_ir_sincospi: `vec2 _gpu_ir_sincospi(float u) {
  float k = floor(u + 0.5);
  float t = 3.14159265358979 * (u - k);
  float t2 = t * t;
  float s = t * (1.0 - t2 / 6.0 * (1.0 - t2 / 20.0 * (1.0 - t2 / 42.0 * (1.0 - t2 / 72.0 * (1.0 - t2 / 110.0 * (1.0 - t2 / 156.0))))));
  float c = 1.0 - t2 / 2.0 * (1.0 - t2 / 12.0 * (1.0 - t2 / 30.0 * (1.0 - t2 / 56.0 * (1.0 - t2 / 90.0 * (1.0 - t2 / 132.0 * (1.0 - t2 / 182.0))))));
  return mod(k, 2.0) == 0.0 ? vec2(s, c) : -vec2(s, c);
}`,
    // ln(1 + v) for v >= 0: its series below 0.1 (the builtin \`log\` is
    // exact to an absolute 1e-7 only, so ln of 1 + v loses a small v).
    _gpu_ir_log1p: `float _gpu_ir_log1p(float v) {
  if (v >= 0.1) return log(1.0 + v);
  return v * (1.0 - v * (0.5 - v * (1.0 / 3.0 - v * (0.25 - v * (0.2 - v * (1.0 / 6.0 - v * (1.0 / 7.0 - v * 0.125)))))));
}`,
    // arccos y = atan(√((1 - y)(1 + y)), y) for |y| <= 1.
    _gpu_ir_acos: `float _gpu_ir_acos(float y) {
  return atan(sqrt((1.0 - y) * (1.0 + y)), y);
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
