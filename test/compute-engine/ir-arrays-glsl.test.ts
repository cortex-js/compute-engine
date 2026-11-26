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
      'a whole cell of a nominal tuple type (a record)',
      ['At', 'P', 'i'],
      {},
      'the lane record on glsl',
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
