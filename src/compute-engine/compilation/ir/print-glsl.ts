/**
 * The GLSL ES 3.00 printer of the slice compiler: a function whose
 * parameters are the inputs, in the order of the entry's parameters.
 *
 * Both numeric lanes are `float`: an integer is exact up to 2^24 on this
 * target. `pow` of a negative base and a non-integer exponent is what the
 * driver gives (GLSL leaves it undefined; NaN is inside the caveats). The
 * driver may reorder and round: no bits are promised. A boolean is `bool`; a list is
 * an array, `float[3]` (GLSL ES 3.00 has no array of arrays, and the target
 * declines a nested list). A loop counts with an `int`. The target has no
 * element-wise operations: the `scalarize` pass runs first.
 */

import { entryOf, type IRType, type Program } from './ir.js';
import type { OperatorRow } from './operators.js';
import { printProgram, type Printed, type Syntax } from './print.js';

const NAN = 'uintBitsToFloat(0x7fc00000u)';

function typeName(t: IRType): string {
  const scalar = t.lane === 'boolean' ? 'bool' : 'float';
  if (t.shape.length > 1 || typeof t.shape[0] === 'object')
    throw new Error(
      `slice GLSL printer: no type for ${JSON.stringify(t.shape)}`
    );
  return t.shape.length === 0 ? scalar : `${scalar}[${t.shape[0]}]`;
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

export const GLSL: Syntax = Object.freeze({
  ops: {
    'add': '($0 + $1)',
    'sub': '($0 - $1)',
    'neg': '(-$0)',
    'mul': '($0 * $1)',
    'div': '($0 / $1)',
    'pow': { text: '_pow($0, $1)', helpers: ['_pow'] },
    'sqrt': 'sqrt($0)',
    'abs': 'abs($0)',
    'exp': 'exp($0)',
    'ln': 'log($0)',
    'sin': 'sin($0)',
    'cos': 'cos($0)',
    'tan': 'tan($0)',
    'floor': 'floor($0)',
    'ceil': 'ceil($0)',
    'round': { text: '_round($0)', helpers: ['_round'] },
    'mod': 'mod($0, $1)',
    'mod.int': { text: '_imod($0, $1)', helpers: ['_imod'] },
    'max': 'max($0, $1)',
    'min': 'min($0, $1)',
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
    'rangestep': '($1 >= $0 ? 1.0 : -1.0)',
    // Only the builtins defined on every real: `asin`, `acos`, `acosh`,
    // `atanh` and `atan(y, x)` are undefined at some reals in GLSL ES 3.00,
    // and their rows decline on this target.
    'trunc': 'trunc($0)',
    'sign': 'sign($0)',
    'fract': 'fract($0)',
    'atan': 'atan($0)',
    'asinh': 'asinh($0)',
  },
  helpers: {
    _pow: [
      'float _pow(float a, float b) {',
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
    _round: [
      'float _round(float x) {',
      '  float a = abs(x);',
      '  float r = floor(a);',
      '  if (a - r >= 0.5) r += 1.0;',
      '  return x < 0.0 ? -r : r;',
      '}',
    ].join('\n'),
    // The floored modulo of integers, on `int`s: exact for every operand
    // within 2^24, intermediate values included (a `float` product `b * q`
    // rounds: `Mod(-15000000, 6000001)`).
    _imod: [
      'float _imod(float a, float b) {',
      `  if (b == 0.0) return ${NAN};`,
      '  int ia = int(a), ib = int(b);',
      '  int r = ia - ib * (ia / ib);',
      '  if (r != 0 && (r < 0) != (ib < 0)) r += ib;',
      '  return float(r);',
      '}',
    ].join('\n'),
  },
  regions: {},
  constant: ({ value: x }) => (typeof x === 'boolean' ? String(x) : float(x)),
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
  call: (fn, args) => `${fn}(${args.join(', ')})`,
  fn: (name, params, result, body) =>
    [
      `${typeName(result)} ${name}(${params.map((p) => declarator(p.type, p.name)).join(', ')}) {`,
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
    name: glslParameterName(entry.paramNames[k], k),
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
