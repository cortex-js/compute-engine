/**
 * The GLSL input of a named tuple whose fields are numbers and mutable
 * arrays (CE-1892): `type Raster = tuple<width: integer, height: integer,
 * pixels: array<Pixel>>`. Each scalar field is a uniform `<name>_<field>`,
 * each array field a sampler `<name>_<field>` with its count
 * `<name>_<field>_count`, as for an array input; a function whose
 * parameter has the type takes the fields as separate arguments. The
 * witness is Tycho's `scripts/repros/2026-11-26-ce1892-glsl-raster-reads.mts`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const DEFINITIONS = `
type alias Byte = integer<0..255>
type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>
protocol RasterReads {
  function get(self: Self, x: integer, y: integer) -> Pixel
}
type Raster = tuple<width: integer, height: integer, pixels: array<Pixel>> is RasterReads {
  function get(self: Raster, x: integer, y: integer) -> Pixel {
    if x >= 0 && x < self.width && y >= 0 && y < self.height {
      self.pixels[y * self.width + x + 1]
    } else {
      Pixel(0, 0, 0, 0)
    }
  }
}
type Gray = tuple<width: integer, scale: real, cells: array<Byte>>
function sample(r: Raster, a: integer, b: integer) -> Pixel { r.get(a, b) }
function same(r: Raster) -> Raster { r }
`;

/** An engine with the definitions, `x` and `y` integers and `kernel`, a
 *  function of `(a, b)` whose body is `body`; `board` is declared with the
 *  declaration `board`. */
function engine(
  body: string,
  board: (ce: ComputeEngine) => Parameters<ComputeEngine['declare']>[1] = () =>
    'Raster'
) {
  const ce = new ComputeEngine();
  const defined = executeEpsil(ce, DEFINITIONS);
  if (defined.diagnostics.length > 0)
    throw new Error(defined.diagnostics.map((d) => d.message).join('\n'));
  ce.declare('x', 'integer');
  ce.declare('y', 'integer');
  ce.declare('i', 'integer');
  ce.declare('c', 'boolean');
  ce.declare('g', 'Gray');
  ce.declare('other', 'Raster');
  ce.declare('board', board(ce) as never);
  const kernel = executeEpsil(
    ce,
    `function kernel(a: integer, b: integer) -> Pixel { ${body} }`
  );
  if (kernel.diagnostics.length > 0)
    throw new Error(kernel.diagnostics.map((d) => d.message).join('\n'));
  return ce;
}

const glsl = (
  ce: ComputeEngine,
  json: unknown,
  options: Record<string, unknown> = {}
) =>
  compile(ce.box(json as never), {
    to: 'glsl',
    fallback: false,
    ...options,
  } as never);

const RASTER = {
  type: 'Raster',
  lowered: 'fields',
  provenance: 'declared',
  fields: {
    width: { name: 'board_width', lowered: 'float' },
    height: { name: 'board_height', lowered: 'float' },
    pixels: {
      name: 'board_pixels',
      lowered: 'highp usampler2D',
      count: 'board_pixels_count',
    },
  },
};

const NAN = 'uintBitsToFloat(0x7fc00000u)';

describe('THE THREE READ FORMS OF THE WITNESS', () => {
  // Free integer coordinates and no constant folding, as in the witness.
  const options = { constantFold: false };
  const call = `_fn_ir_u0_kernel(x, y, board_width, board_height, board_pixels, board_pixels_count)`;

  test.each([
    ['a direct field read', 'board.pixels[b * board.width + a + 1]'],
    ['a protocol method', 'board.get(a, b)'],
    ['a user function that calls the method', 'sample(board, a, b)'],
  ])('%s compiles, the fields passed as arguments', (_, body) => {
    const r = glsl(engine(body), ['kernel', 'x', 'y'], options);
    expect(r.success).toBe(true);
    expect(r.code).toMatch(
      new RegExp(`^vec4 (v\\d+) = ${call.replace(/[()]/g, '\\$&')};\nreturn \\1;$`)
    );
    // Each function takes a raster as its fields: two floats, a sampler
    // and its count.
    for (const fn of r.preamble!.match(/^vec4 _fn_ir_\w+\(.*\)/gm)!)
      expect(fn).toMatch(
        /float v\d+, float v\d+, highp usampler2D (v\d+), int \1_count/
      );
    expect(r.preamble).toContain('vec4 _gpu_ir_cell4_u(highp usampler2D v, int k)');
    expect(r.freeSymbols).toEqual(['x', 'y', 'board']);
    expect(r.freeSymbolTypes!.board).toEqual(RASTER);
  });

  test('the method reads the fields of its own parameters', () => {
    const r = glsl(engine('board.get(a, b)'), ['kernel', 'x', 'y'], options);
    expect(r.preamble).toMatch(
      /vec4 _fn_ir_u1_get\(float (v\d+), float (v\d+), highp usampler2D (v\d+), int \3_count, float (v\d+), float (v\d+)\) \{\n {2}vec4 v\d+;\n {2}if \(\(\(0\.0 <= \4\) && \(\(\4 < \1\) && \(\(0\.0 <= \5\) && \(\5 < \2\)\)\)\)\) \{/
    );
  });

  test('JavaScript is unchanged: a captured raster compiles there', () => {
    const ce = engine('board.get(a, b)', (ce) => ({
      type: 'Raster',
      value: ce.function('Raster', [
        ce.number(2),
        ce.number(1),
        ce.array(new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255]), 'Pixel'),
      ]),
      isConstant: true,
    }));
    expect(ce.box(['kernel', 1, 0]).evaluate().json).toEqual([
      'Pixel',
      20,
      0,
      0,
      255,
    ]);
    const r = compile(ce.box(['kernel', 'x', 'y']), { fallback: false });
    expect((r.run as (v: object) => unknown)({ x: 1, y: 0 })).toEqual({
      r: 20,
      g: 0,
      b: 0,
      a: 255,
    });
  });
});

describe('THE READS AT THE ENTRY', () => {
  const ce = engine('Pixel(0, 0, 0, 0)');

  test('a scalar field is its uniform', () => {
    const r = glsl(ce, ['Add', ['Field', 'board', "'width'"], ['Field', 'board', "'height'"]]);
    expect(r.code).toBe('(board_width + board_height)');
    expect(r.freeSymbols).toEqual(['board']);
    expect(r.freeSymbolTypes).toEqual({ board: RASTER });
  });

  test('the length of an array field is its count uniform', () => {
    const r = glsl(ce, ['Length', ['Field', 'board', "'pixels'"]]);
    expect(r.code).toBe('float v3 = float(board_pixels_count);\nreturn v3;');
  });

  test('a cell of an array field is a texel of its sampler', () => {
    const r = glsl(ce, ['At', ['Field', 'board', "'pixels'"], 'i']);
    expect(r.code).toBe(
      `vec4 v4 = (i == floor(i) && i != 0.0 && abs(i) <= float(board_pixels_count) ? _gpu_ir_cell4_u(board_pixels, i > 0.0 ? int(i) - 1 : board_pixels_count + int(i)) : vec4(${NAN}));\nreturn v4;`
    );
    expect(r.freeSymbols).toEqual(['board', 'i']);
  });

  test('storage selects the normalized texture of an array field by its path', () => {
    const json = ['Add', ['At', ['Field', 'g', "'cells'"], 'i'], ['Field', 'g', "'scale'"]];
    const plain = glsl(ce, json);
    expect(plain.preamble).toContain('float _gpu_ir_cell_u(highp usampler2D v, int k)');
    const r = glsl(ce, json, { storage: { 'g.cells': 'sampler2D' } });
    expect(r.code).toBe(
      `float v6 = (i == floor(i) && i != 0.0 && abs(i) <= float(g_cells_count) ? _gpu_ir_cell_n(g_cells, i > 0.0 ? int(i) - 1 : g_cells_count + int(i)) : ${NAN});\nreturn (g_scale + v6);`
    );
    expect(r.preamble).toContain('floor(255.0 * texelFetch(v, ivec2(k % w, k / w), 0).r + 0.5)');
    expect(r.freeSymbolTypes!.g.fields).toEqual({
      width: { name: 'g_width', lowered: 'float' },
      scale: { name: 'g_scale', lowered: 'float' },
      cells: { name: 'g_cells', lowered: 'highp sampler2D', count: 'g_cells_count' },
    });
  });

  test.each([
    ['the record', 'g', 'g'],
    ['a scalar field', 'g.width', 'g.width'],
    ['a field it does not have', 'g.depth', 'g.depth'],
  ])('storage of %s declines', (_, key, name) => {
    expect(() =>
      glsl(ce, ['At', ['Field', 'g', "'cells'"], 'i'], {
        storage: { [key]: 'sampler2D' },
      })
    ).toThrow(
      `the storage sampler2D of ${name}: a record input is in storage by its array fields, each named by its path (g.cells) on glsl`
    );
  });
});

describe('A NAME THAT HOLDS A RASTER', () => {
  const value = (ce: ComputeEngine) => ({
    type: 'Raster',
    value: ce.function('Raster', [
      ce.number(2),
      ce.number(1),
      ce.array(new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255]), 'Pixel'),
    ]),
  });

  test('is an input when the inputs option names it; its value is not in the code', () => {
    const ce = engine('sample(board, a, b)', value);
    const r = glsl(ce, ['kernel', 'x', 'y'], {
      constantFold: false,
      inputs: { board: 'Raster' },
    });
    expect(r.code).toContain(
      '_fn_ir_u0_kernel(x, y, board_width, board_height, board_pixels, board_pixels_count)'
    );
    expect(r.freeSymbols).toEqual(['x', 'y', 'board']);
    expect(r.freeSymbolTypes!.board).toEqual(RASTER);
    expect(`${r.code}\n${r.preamble}`).not.toMatch(/\b255\b|\b20\.0\b/);
  });

  test.each([
    ['a direct field read', 'board.pixels[b * board.width + a + 1]'],
    ['a protocol method', 'board.get(a, b)'],
    ['a user function that calls the method', 'sample(board, a, b)'],
  ])(
    'a constant raster named by inputs is the input: %s, no value in the code',
    (_, body) => {
      const ce = engine(body, (ce) => ({ ...value(ce), isConstant: true }));
      const r = glsl(ce, ['kernel', 'x', 'y'], {
        constantFold: false,
        inputs: { board: 'Raster' },
      });
      expect(r.code).toContain(
        '_fn_ir_u0_kernel(x, y, board_width, board_height, board_pixels, board_pixels_count)'
      );
      expect(r.freeSymbols).toEqual(['x', 'y', 'board']);
      expect(r.freeSymbolTypes!.board).toEqual(RASTER);
      expect(`${r.code}\n${r.preamble}`).not.toMatch(/\b255\b|\b20\.0\b|\b2\.0\b/);
      // The interpreter still reads the constant.
      expect(ce.box(['kernel', 1, 0]).evaluate().json).toEqual([
        'Pixel',
        20,
        0,
        0,
        255,
      ]);
    }
  );

  test('every other constant in inputs keeps the refusal', () => {
    const ce = engine('Pixel(0, 0, 0, 0)');
    executeEpsil(ce, 'type P2 = tuple<x: real, y: real>');
    ce.declare('pc', {
      type: 'P2',
      value: ce.function('P2', [ce.number(1), ce.number(2)]),
      isConstant: true,
    });
    ce.declare('kc', { type: 'real', value: 3, isConstant: true });
    executeEpsil(
      ce,
      `function readP(t: real) -> real { pc.x + t }
function readK(t: real) -> real { kc + t }`
    );
    for (const [fn, name, type] of [
      ['readP', 'pc', 'P2'],
      ['readK', 'kc', 'real'],
    ])
      for (const to of ['glsl', 'javascript'])
        expect(() =>
          compile(ce.box([fn, 'x'] as never), {
            to,
            fallback: false,
            inputs: { [name]: type },
          } as never)
        ).toThrow(`the name "${name}" of the \`inputs\` option is a constant.`);
    // A constant raster on javascript, where it is not an input.
    const raster = engine('board.get(a, b)', (ce) => ({
      ...value(ce),
      isConstant: true,
    }));
    expect(() =>
      compile(raster.box(['kernel', 'x', 'y']), {
        fallback: false,
        inputs: { board: 'Raster' },
      } as never)
    ).toThrow('the name "board" of the `inputs` option is a constant.');
  });

  test('declines without the inputs option: its value is never folded', () => {
    const ce = engine('sample(board, a, b)', value);
    expect(() =>
      glsl(ce, ['kernel', 'x', 'y'], { constantFold: false })
    ).toThrow(
      'a value of the type Raster, a record whose field pixels is of type array<Pixel>, not a real or an integer number'
    );
  });
});

describe('THE DECLINES', () => {
  test.each([
    [
      'a store to a cell of an array field',
      'board.pixels[1] = Pixel(1, 2, 3, 4); Pixel(0, 0, 0, 0)',
      'a store to a cell of an array on glsl, where an array is an input of the program that the code reads with At and Length',
    ],
    [
      'the whole value as the result of a function',
      'same(board).get(a, b)',
      'a record of the type Raster as a value (a result, an arm of an If, a local assigned in a loop): its fields are inputs of the shader, read one by one on glsl',
    ],
  ])('%s', (_, body, message) => {
    expect(() =>
      glsl(engine(body), ['kernel', 'x', 'y'], { constantFold: false })
    ).toThrow(message);
  });

  const ce = engine('Pixel(0, 0, 0, 0)');
  test.each([
    [
      'a field store',
      ['Block', ['Assign', ['Field', 'board', "'width'"], 3], 1],
      'a sub-expression of the static type error',
    ],
    [
      'a store of the whole value',
      ['Block', ['Assign', 'board', 'other'], 1],
      'Assign("board", "other"): a write to a name that is not a local',
    ],
    [
      'the whole value as the result',
      'board',
      'an array as the result of the compiled code, alone or in a record or a list',
    ],
    [
      'an arm of an If',
      ['Field', ['If', 'c', 'board', 'other'], "'width'"],
      'a record of the type Raster as a value (a result, an arm of an If, a local assigned in a loop)',
    ],
    [
      'an equality of two such values',
      ['Equal', 'board', 'other'],
      'Equal of Raster(width: integer, height: integer, pixels: array<Pixel>), Raster(width: integer, height: integer, pixels: array<Pixel>)',
    ],
    [
      'another input named as the uniform of a field',
      ['Add', ['Field', 'board', "'width'"], 'board_width'],
      'the input board_width, which is the name of a uniform of the field board.width on glsl',
    ],
    [
      'another input named as the count of an array field',
      ['Add', ['Field', 'board', "'width'"], 'board_pixels_count'],
      'the input board_pixels_count, which is the name of a uniform of the field board.pixels on glsl',
    ],
  ])('%s', (_, json, message) => {
    expect(() => glsl(ce, json)).toThrow(message);
  });

  test('a captured list of more than 4 elements after a split record parameter', () => {
    // The parameters of `readL` are `r`, then the captures `L` and `board`:
    // `L` is a lifted input after `r` is split into its fields.
    const ce = engine('Pixel(0, 0, 0, 0)');
    ce.declare('L', 'list<real^6>');
    executeEpsil(
      ce,
      'function readL(r: Raster) -> real { L[1] + board.width + r.width }'
    );
    expect(() => glsl(ce, ['readL', 'other'])).toThrow(
      'the function readL reads the input L, a list of 6 elements, which glsl would copy at each call'
    );
  });

  test('a name of a field that the older input checks refuse names the field', () => {
    const ce = engine('Pixel(0, 0, 0, 0)');
    ce.declare('v1', 'Raster');
    let error: unknown;
    try {
      glsl(ce, ['Field', 'v1', "'width'"]);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({
      message: expect.stringContaining(
        'the input name `v1_width` of the field v1.width on glsl'
      ),
      diagnostic: { binding: 'v1' },
    });
  });
});

describe('THE VARS OPTION', () => {
  test('does not rename the uniform of a field', () => {
    const r = glsl(engine('Pixel(0, 0, 0, 0)'), ['Field', 'board', "'width'"], {
      vars: { board_width: 'u_width' },
    });
    expect(r.code).toBe('board_width');
    expect(r.freeSymbolTypes!.board).toEqual(RASTER);
  });
});
