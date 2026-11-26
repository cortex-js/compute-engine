/**
 * The GLSL read of a mutable array input (`array<T>`,
 * `docs/plans/2026-11-25-mutable-arrays-spec.md`, section 11; acceptance
 * case 15 without the browser part): `At(A, i)` and `Length(A)` of an
 * input, a sampler `A` and an `int` uniform `A_count` that the host binds;
 * every other use of an array declines with a message that names it.
 *
 * The emitted text pinned here is the text that
 * `scripts/repros/2026-11-26-array-glsl-texel-read.mjs` ran in a WebGL 2
 * context (SwiftShader) for each texture format, with the cells of the
 * uploaded array as the values.
 */

import { compile } from '../../src/compile';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const ce = new ComputeEngine();
const program = executeEpsil(
  ce,
  `type alias Byte = integer<0..255>
type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>
let V = arrayFrom([1, 2, 3], "Byte")
let at2 = (x, k) => x[k] + length(x)
`
);
if (program.diagnostics.some((d) => d.severity === 'error'))
  throw new Error('the Epsil source has an error');
const BYTE = 'integer<0..255>';
ce.declare('A', `array<${BYTE}>`);
ce.declare('G', `array<${BYTE}>`);
ce.declare('S', 'array<integer<-30000..30000>>');
ce.declare('R', 'array<real>');
ce.declare('T', `array<tuple<${BYTE}, ${BYTE}, ${BYTE}, ${BYTE}>>`);
ce.declare('P', 'array<Pixel>');
ce.declare('W', 'array<integer<0..4294967295>>');
ce.declare('Q', `tuple<w: integer, px: array<${BYTE}>>`);
ce.declare('i', 'integer');
ce.declare('c', 'boolean');
ce.declare('A_count', 'real');
ce.declare('x', 'real');

const glsl = (json: unknown, options: Record<string, unknown> = {}) =>
  compile(ce.box(json as never), {
    to: 'glsl',
    fallback: false,
    ...options,
  } as never);

/** The texel helper `name` of the sampler `sampler`. */
const helper = (name: string, result: string, sampler: string, value: string) =>
  `${result} ${name}(highp ${sampler} v, int k) {
  int w = textureSize(v, 0).x;
  return ${value.replace('$', 'texelFetch(v, ivec2(k % w, k / w), 0)')};
}`;

const NAN = 'uintBitsToFloat(0x7fc00000u)';

/** The read of the cell at `i` of `a` by the helper `h`. */
const read = (a: string, h: string, nan = NAN) =>
  `(i == floor(i) && i != 0.0 && abs(i) <= float(${a}_count) ? ${h}(${a}, i > 0.0 ? int(i) - 1 : ${a}_count + int(i)) : ${nan})`;

describe('THE READ OF A CELL (acceptance case 15)', () => {
  test('unsigned integer cells: a highp usampler2D, the red channel', () => {
    const r = glsl(['At', 'A', 'i']);
    expect(r.preamble).toBe(
      helper('_gpu_ir_cell_u', 'float', 'usampler2D', 'float($.r)')
    );
    expect(r.code).toBe(
      `float v2 = ${read('A', '_gpu_ir_cell_u')};\nreturn v2;`
    );
    expect(r.freeSymbols).toEqual(['A', 'i']);
    expect(r.freeSymbolTypes!.A).toEqual({
      type: `array<${BYTE}>`,
      lowered: 'highp usampler2D',
      provenance: 'declared',
      count: 'A_count',
    });
    expect(r.freeSymbolTypes!.i.count).toBeUndefined();
  });

  test('signed integer cells: a highp isampler2D', () => {
    const r = glsl(['At', 'S', 'i']);
    expect(r.preamble).toBe(
      helper('_gpu_ir_cell_i', 'float', 'isampler2D', 'float($.r)')
    );
    expect(r.code).toBe(
      `float v2 = ${read('S', '_gpu_ir_cell_i')};\nreturn v2;`
    );
    expect(r.freeSymbolTypes!.S.lowered).toBe('highp isampler2D');
  });

  test('real cells: a highp sampler2D of 32-bit floats', () => {
    const r = glsl(['At', 'R', 'i']);
    expect(r.preamble).toBe(
      helper('_gpu_ir_cell_f', 'float', 'sampler2D', '$.r')
    );
    expect(r.code).toBe(
      `float v2 = ${read('R', '_gpu_ir_cell_f')};\nreturn v2;`
    );
    expect(r.freeSymbolTypes!.R.lowered).toBe('highp sampler2D');
  });

  test('a tuple cell of four bytes (RGBA8UI): one fetch and one test, a vec4', () => {
    const r = glsl(['At', 'T', 'i']);
    expect(r.preamble).toBe(
      helper('_gpu_ir_cell4_u', 'vec4', 'usampler2D', 'vec4($)')
    );
    expect(r.code).toBe(
      `vec4 v2 = ${read('T', '_gpu_ir_cell4_u', `vec4(${NAN})`)};\nreturn v2;`
    );
    expect(r.freeSymbolTypes!.T.lowered).toBe('highp usampler2D');
  });

  test('a tuple cell from a normalized RGBA8 texture (storage sampler2D)', () => {
    const r = glsl(['At', 'T', 'i'], { storage: { T: 'sampler2D' } });
    expect(r.preamble).toBe(
      helper('_gpu_ir_cell4_n', 'vec4', 'sampler2D', 'floor(255.0 * $ + 0.5)')
    );
    expect(r.code).toBe(
      `vec4 v2 = ${read('T', '_gpu_ir_cell4_n', `vec4(${NAN})`)};\nreturn v2;`
    );
    expect(r.freeSymbolTypes!.T).toMatchObject({
      lowered: 'highp sampler2D',
      count: 'T_count',
    });
  });

  test('bytes from a normalized R8 texture (storage sampler2D)', () => {
    const r = glsl(['At', 'A', 'i'], { storage: { A: 'sampler2D' } });
    expect(r.preamble).toBe(
      helper('_gpu_ir_cell_n', 'float', 'sampler2D', 'floor(255.0 * $.r + 0.5)')
    );
    expect(r.code).toBe(
      `float v2 = ${read('A', '_gpu_ir_cell_n')};\nreturn v2;`
    );
  });

  test('a field of a tuple cell of a nominal type: an element of the texel', () => {
    const r = glsl(['Field', ['At', 'P', 'i'], "'g'"]);
    expect(r.code).toBe(
      `vec4 v2 = ${read('P', '_gpu_ir_cell4_u', `vec4(${NAN})`)};\nreturn v2[int(1.0)];`
    );
  });

  test('a whole cell of a nominal tuple type: the vec4 of the texel', () => {
    const r = glsl(['At', 'P', 'i']);
    expect(r.code).toBe(
      `vec4 v2 = ${read('P', '_gpu_ir_cell4_u', `vec4(${NAN})`)};\nreturn v2;`
    );
  });

  test('a constant index other than 0 has the run-time test', () => {
    const r = glsl(['At', 'A', 3]);
    expect(r.code).toBe(
      `float v2 = ${read('A', '_gpu_ir_cell_u').replace(/\bi\b/g, '3.0')};\nreturn v2;`
    );
  });

  test('a name of the inputs option whose value is an array', () => {
    const r = glsl(['At', 'V', 'i'], {
      inputs: { V: `array<${BYTE}>` },
      storage: { V: 'sampler2D' },
    });
    expect(r.code).toBe(
      `float v2 = ${read('V', '_gpu_ir_cell_n')};\nreturn v2;`
    );
    expect(r.freeSymbolTypes!.V.count).toBe('V_count');
  });
});

describe('THE COUNT AND THE USER FUNCTIONS', () => {
  test('Length(A) is the count uniform', () => {
    const r = glsl(['Length', 'A']);
    expect(r.code).toBe('float v1 = float(A_count);\nreturn v1;');
    expect(r.preamble).toBeUndefined();
  });

  test('an array argument of a user function is its sampler and its count', () => {
    const r = glsl(['Add', ['at2', 'A', 'i'], ['at2', 'G', 'i']]);
    expect(r.preamble).toBe(
      [
        helper('_gpu_ir_cell_u', 'float', 'usampler2D', 'float($.r)'),
        'float _fn_ir_u0_at2(highp usampler2D v2, int v2_count, float v3) {',
        `  float v4 = ${read('v2', '_gpu_ir_cell_u').replace(/\bi\b/g, 'v3')};`,
        '  float v5 = float(v2_count);',
        '  return (v4 + v5);',
        '}',
      ].join('\n')
    );
    expect(r.code).toBe(
      'float v7 = _fn_ir_u0_at2(A, A_count, i);\nfloat v9 = _fn_ir_u0_at2(G, G_count, i);\nreturn (v7 + v9);'
    );
  });
});

describe('THE PARAMETERS OF THE SLICE', () => {
  test.each([
    ['A', 'highp usampler2D'],
    ['T', 'highp usampler2D'],
  ])('the metadata of At(%s, i) is the emitted parameter list', (a, sampler) => {
    const g = compileSlice(ce.box(['At', a, 'i']), {
      target: 'glsl',
      bareInputs: true,
    });
    expect(g.parameters).toEqual([
      { input: a, name: a, type: sampler },
      { input: a, name: `${a}_count`, type: 'int', count: true },
      { input: 'i', name: 'i', type: 'float' },
    ]);
    const emitted = /\bf\(([^)]*)\) \{/.exec(g.code)![1];
    expect(emitted).toBe(
      g.parameters.map((p) => `${p.type} ${p.name}`).join(', ')
    );
  });

  // `compile()` ignores the option on javascript (spec section 12); the
  // slice compiler refuses it there, as for any input that is not a list.
  test('the javascript slice keeps the refusal of a storage hint on an array', () => {
    expect(() =>
      compileSlice(ce.box(['At', 'A', 'i']), {
        target: 'javascript',
        storage: ['A'],
      })
    ).toThrow('the storage of A, which is not a list of numbers on javascript');
    expect(
      compile(ce.box(['At', 'A', 'i']), {
        to: 'javascript',
        fallback: false,
        storage: { A: 'sampler2D' },
      } as never).success
    ).toBe(true);
  });
});

describe('THE DECLINES', () => {
  const where =
    'on glsl, where an array is an input of the program that the code reads with At and Length';
  test.each([
    [
      'a name with an array value, not in inputs',
      ['At', 'V', 'i'],
      {},
      `the name V, which holds an array value (not an input: a name declared with an array type and no value, or a name of the inputs option) ${where}`,
    ],
    [
      'a store',
      ['Block', ['Assign', ['At', 'A', 'i'], 3], 1],
      {},
      `a store to a cell of an array ${where}`,
    ],
    [
      'AddTo of a cell',
      ['Block', ['AddTo', ['At', 'A', 'i'], 3], 1],
      {},
      `AddTo of a cell of an array ${where}`,
    ],
    ['Swap', ['Block', ['Swap', 'A', 'G'], 1], {}, `Swap of two arrays ${where}`],
    [
      'ArrayFrom',
      ['At', ['ArrayFrom', ['List', 1, 2], "'integer<0..255>'"], 1],
      {},
      `ArrayFrom (a construction) ${where}`,
    ],
    ['ListFrom', ['Length', ['ListFrom', 'A']], {}, `ListFrom of an array ${where}`],
    [
      'a range as the index',
      ['At', ['At', 'A', ['Range', 1, 3]], 1],
      {},
      `a range or a list as the index of an array ${where}`,
    ],
    [
      'a list as the index',
      ['At', ['At', 'A', ['List', 1, 3]], 1],
      {},
      `a range or a list as the index of an array ${where}`,
    ],
    [
      'an array result',
      'A',
      {},
      'an array as the result of the compiled code, alone or in a record or a list',
    ],
    [
      'an If of two arrays',
      ['At', ['If', 'c', 'A', 'G'], 1],
      {},
      'an array as a value (a result, an arm of an If, a local assigned in a loop) on glsl',
    ],
    [
      'an array in a record',
      ['At', ['Field', 'Q', "'px'"], 'i'],
      {},
      `the input Q of type tuple<w: integer, px: array<${BYTE}>>`,
    ],
    [
      'integer cells of a range outside ±2^24',
      ['At', 'W', 'i'],
      {},
      'an array<integer<0..4294967295>> on glsl, where an integer is exact within -16777216 to 16777216 only',
    ],
    [
      'the constant index 0',
      ['At', 'A', 0],
      {},
      'the index 0 of At of an array, which names no cell, on glsl',
    ],
    [
      'a constant index that is not an integer',
      ['At', 'A', 1.5],
      {},
      'the index 1.5 of At of an array, which names no cell, on glsl',
    ],
    [
      'another input named as the count',
      ['Add', ['At', 'A', 'i'], 'A_count'],
      {},
      'the input A_count, spelled A_count, which is the name of the count of the array A, on glsl',
    ],
    [
      'a vars text spelled as the count',
      ['Add', ['At', 'A', 'i'], 'x'],
      { vars: { x: 'A_count' } },
      'the input x, spelled A_count, which is the name of the count of the array A, on glsl',
    ],
    [
      'a vars text spelled as the sampler',
      ['Add', ['At', 'A', 'i'], 'x'],
      { vars: { x: 'A.y' } },
      'the input x, spelled A, which is the name of the sampler of the array A, on glsl',
    ],
    [
      'a vars entry for an array',
      ['At', 'A', 'i'],
      { vars: { A: 'u_A' } },
      'the vars entry of A, an array, on glsl',
    ],
    [
      'a normalized texture of cells that are not bytes',
      ['At', 'S', 'i'],
      { storage: { S: 'sampler2D' } },
      'the storage sampler2D of S, an array<integer<-30000..30000>>: a normalized texture holds cells of 0 to 255',
    ],
    [
      'a function called with arrays in two kinds of texture',
      ['Add', ['at2', 'A', 'i'], ['at2', 'G', 'i']],
      { storage: { A: 'sampler2D' } },
      'a call of u0_at2 with arrays in two kinds of texture on glsl',
    ],
    [
      'the complex mode',
      ['At', 'A', 'i'],
      { mode: 'complex' },
      'an array (array<T>), which compiles on javascript and glsl in the default mode only',
    ],
  ])('%s', (_, json, options, message) => {
    expect(() => glsl(json, options)).toThrow(message);
  });
});

/** The values of a nominal type that is a tuple cell of four bytes are a
 *  `vec4` on GLSL: the constructor, the read of a cell, a parameter and a
 *  result of a user function, and `Equal` of two values of the type. The
 *  value keeps its type: with an unnamed tuple or another nominal type it
 *  declines, as on JavaScript. */
describe('A VALUE OF A NOMINAL PIXEL TYPE', () => {
  const pe = new ComputeEngine();
  const source = executeEpsil(
    pe,
    `type alias Byte = integer<0..255>
type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>
type Quad = tuple<w: Byte, x: Byte, y: Byte, z: Byte>
function invert(p: Pixel) -> Pixel { Pixel(min(max(255 - p.r, 0), 255), min(max(255 - p.g, 0), 255), min(max(255 - p.b, 0), 255), p.a) }
function rgba(r: real, g: real, b: real, a: real) -> Pixel { Pixel(min(max(round(r), 0), 255), min(max(round(g), 0), 255), min(max(round(b), 0), 255), min(max(round(a), 0), 255)) }
function green(p) { p.g }
function tup(t: tuple<Byte, Byte, Byte, Byte>) { t[1] }
function opaque() -> Pixel { (1, 2, 3, 4) }
`
  );
  if (source.diagnostics.some((d) => d.severity === 'error'))
    throw new Error('the Epsil source has an error');
  pe.declare('src', 'array<Pixel>');
  pe.declare('i', 'integer');
  pe.declare('x', 'integer');
  pe.declare('y', 'integer');
  pe.declare('v', 'real');
  pe.declare('c', 'boolean');
  pe.declare('q', 'Pixel');
  const shader = (json: unknown) =>
    compile(pe.box(json as never), { to: 'glsl', fallback: false } as never);
  const cell = read('src', '_gpu_ir_cell4_u', `vec4(${NAN})`);
  const texel = helper('_gpu_ir_cell4_u', 'vec4', 'usampler2D', 'vec4($)');
  const round = `float _gpu_ir_round(float x) {
  float a = abs(x);
  float r = floor(a);
  if (a - r >= 0.5) r += 1.0;
  return x < 0.0 ? -r : r;
}`;
  const white = ['Pixel', 255, 255, 255, 255];
  const byteOf = (k: number, p: string) => `${p}[int(${k}.0)]`;
  const equal = (p: string, q: (k: number) => string) =>
    `((((${byteOf(0, p)} == ${q(0)}) && (${byteOf(1, p)} == ${q(1)})) && (${byteOf(2, p)} == ${q(2)})) && (${byteOf(3, p)} == ${q(3)}))`;

  test('the constructor is the vec4 of its operands, each proved a Byte', () => {
    const r = shader([
      'Pixel',
      ['Min', ['Max', ['Round', 'v'], 0], 255],
      2,
      3,
      255,
    ]);
    expect(r.preamble).toBe(round);
    expect(r.code).toBe(
      'vec4(min(max(_gpu_ir_round(v), 0.0), 255.0), 2.0, 3.0, 255.0)'
    );
  });

  test('the read of a cell is the vec4 of one fetch, as a result and a local', () => {
    const expected = `vec4 v2 = ${cell};\nreturn v2;`;
    expect(shader(['At', 'src', 'i']).code).toBe(expected);
    // `do { let p = src[i]; p }`
    expect(
      shader([
        'Block',
        [
          'Declare',
          'p',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, ['At', 'src', 'i']]],
        ],
        'p',
      ]).code
    ).toBe(expected);
    // A field read by name is one element of the vec4.
    expect(shader(['Field', ['At', 'src', 'i'], "'g'"]).code).toBe(
      `vec4 v2 = ${cell};\nreturn v2[int(1.0)];`
    );
  });

  test('an If whose two arms are Pixel values is a vec4', () => {
    expect(
      shader(['If', 'c', ['At', 'src', 'i'], ['Pixel', 1, 2, 3, 4]]).code
    ).toBe(
      [
        'vec4 v9;',
        'if (c) {',
        `  vec4 v3 = ${cell};`,
        '  v9 = v3;',
        '} else {',
        '  v9 = vec4(1.0, 2.0, 3.0, 4.0);',
        '}',
        'return v9;',
      ].join('\n')
    );
  });

  test('a user function Pixel -> Pixel takes and returns a vec4', () => {
    const r = shader(['invert', ['At', 'src', 'i']]);
    const channel = (k: number) =>
      `min(max(((-v3[int(${k}.0)]) + 255.0), 0.0), 255.0)`;
    expect(r.preamble).toBe(
      [
        texel,
        'vec4 _fn_ir_u0_invert(vec4 v3) {',
        `  return vec4(${channel(0)}, ${channel(1)}, ${channel(2)}, v3[int(3.0)]);`,
        '}',
      ].join('\n')
    );
    expect(r.code).toBe(
      `vec4 v2 = ${cell};\nvec4 v26 = _fn_ir_u0_invert(v2);\nreturn v26;`
    );
  });

  test('a function that makes a Pixel of its numbers, and one of no type that reads a field', () => {
    const r = shader(['rgba', 'x', 'y', 0, 255]);
    const channel = (k: number) =>
      `min(max(_gpu_ir_round(v${k}), 0.0), 255.0)`;
    expect(r.preamble).toBe(
      [
        round,
        'vec4 _fn_ir_u0_rgba(float v0, float v1, float v2, float v3) {',
        `  return vec4(${[0, 1, 2, 3].map(channel).join(', ')});`,
        '}',
      ].join('\n')
    );
    expect(r.code).toBe(
      'vec4 v23 = _fn_ir_u0_rgba(x, y, 0.0, 255.0);\nreturn v23;'
    );
    expect(shader(['green', ['At', 'src', 'i']]).preamble).toBe(
      `${texel}\nfloat _fn_ir_u0_green(vec4 v3) {\n  return v3[int(1.0)];\n}`
    );
  });

  test('Equal and NotEqual of two Pixel values: the equality of the four bytes', () => {
    const constant = () => '255.0';
    expect(shader(['Equal', ['At', 'src', 'i'], white]).code).toBe(
      `vec4 v2 = ${cell};\nreturn ${equal('v2', constant)};`
    );
    expect(shader(['NotEqual', ['At', 'src', 'i'], white]).code).toBe(
      `vec4 v2 = ${cell};\nreturn (!${equal('v2', constant)});`
    );
  });

  test.each([
    [
      'an operand that does not prove a Byte',
      ['Pixel', ['Mod', 'x', 256], 1, 2, 3],
      'Mod(x, 256): the field r of Pixel: a value of type integer, which does not prove Byte',
    ],
    [
      'Equal of a Pixel and an unnamed tuple (False in the interpreter)',
      ['Equal', ['At', 'src', 'i'], ['Tuple', 255, 255, 255, 255]],
      'Equal of a tuple: its value on a tuple is not its value on a list',
    ],
    [
      'NotEqual of a Pixel and an unnamed tuple',
      ['NotEqual', ['At', 'src', 'i'], ['Tuple', 255, 255, 255, 255]],
      'Equal of a tuple: its value on a tuple is not its value on a list',
    ],
    [
      'Equal of two nominal types',
      ['Equal', ['At', 'src', 'i'], ['Quad', 255, 255, 255, 255]],
      'Equal of Pixel(r: integer, g: integer, b: integer, a: integer), Quad(w: integer, x: integer, y: integer, z: integer)',
    ],
    [
      'an If of a Pixel arm and a tuple arm',
      ['If', 'c', ['At', 'src', 'i'], ['Tuple', 1, 2, 3, 4]],
      'arms of two types',
    ],
    [
      'an If of two nominal types',
      ['If', 'c', ['At', 'src', 'i'], ['Quad', 1, 2, 3, 4]],
      'arms of two types',
    ],
    [
      'a Pixel for a parameter declared tuple (an error in the interpreter)',
      ['tup', ['At', 'src', 'i']],
      'a scalar argument of tup for the parameter 1, a list or a point',
    ],
    [
      'a tuple for a parameter declared Pixel (an error in the interpreter)',
      ['invert', ['Tuple', 1, 2, 3, 4]],
      'Field(p, "r"): Field of a value that is not a record',
    ],
    [
      'a tuple returned where Pixel is declared (an error in the interpreter)',
      ['opaque'],
      'the result of opaque is not a scalar (Pixel)',
    ],
    [
      'IsMissing (an out-of-range read is a tuple of NaN)',
      ['IsMissing', ['At', 'src', 'i']],
      'IsMissing of a value of a nominal type that is a tuple cell (array<Pixel>): the read of such a cell out of range is a tuple of NaN, which compiled code does not test',
    ],
    [
      'Coalesce',
      ['Coalesce', ['At', 'src', 'i'], ['Pixel', 0, 0, 0, 0]],
      'Coalesce of a value of a nominal type that is a tuple cell (array<Pixel>)',
    ],
    [
      'AssertPresent',
      ['AssertPresent', ['At', 'src', 'i']],
      'AssertPresent of a value of a nominal type that is a tuple cell (array<Pixel>)',
    ],
    [
      'arithmetic on a whole Pixel (an error in the interpreter)',
      ['Add', ['At', 'src', 'i'], 1],
      'a sub-expression of the static type error',
    ],
    [
      'a Pixel read by position (an error in the interpreter)',
      ['At', ['At', 'src', 'i'], 2],
      'a sub-expression of the static type error',
    ],
    ['an input declared Pixel (CE-1871)', ['Field', 'q', "'g'"], 'the input q of type Pixel'],
    [
      'a list of Pixel values',
      ['List', ['Pixel', 1, 2, 3, 4], ['Pixel', 5, 6, 7, 8]],
      'a list of records',
    ],
  ])('%s declines', (_, json, message) => {
    expect(() => shader(json)).toThrow(message);
  });

  // The same functions compile on JavaScript, with the interpreter's
  // values (an out-of-range read of `invert` is an error in the
  // interpreter, outside the comparison).
  test('on javascript the same pixel functions give the interpreter\'s values', () => {
    executeEpsil(
      pe,
      `let px = arrayFrom([Pixel(1, 2, 3, 4), Pixel(255, 255, 255, 255)], "Pixel")
let inverted = (i: integer) => invert(px[i])
let made = (x: integer, y: integer) => rgba(x, y, 0, 255)
let isWhite = (i: integer) => px[i] == Pixel(255, 255, 255, 255)`
    );
    const run = (name: string, ...args: number[]) => {
      const r = compile(pe.box(name).evaluate(), { fallback: false });
      expect(r.success).toBe(true);
      return r.run!(...args);
    };
    const interpreted = (call: string) => {
      const x = executeEpsil(pe, call).value!;
      return x.operator === 'Pixel' ? x.ops!.map((y) => y.re) : x.symbol;
    };
    const bytes = (p: { r: number; g: number; b: number; a: number }) => [
      p.r,
      p.g,
      p.b,
      p.a,
    ];
    for (const i of [1, 2])
      expect(bytes(run('inverted', i) as never)).toEqual(
        interpreted(`inverted(${i})`)
      );
    for (const [x, y] of [
      [3, 300],
      [-5, 128],
    ])
      expect(bytes(run('made', x, y) as never)).toEqual(
        interpreted(`made(${x}, ${y})`)
      );
    for (const i of [1, 2, 3, -1])
      expect(run('isWhite', i) ? 'True' : 'False').toBe(
        interpreted(`isWhite(${i})`)
      );
  });
});
