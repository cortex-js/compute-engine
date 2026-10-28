/**
 * CE-571 (Tycho ledger row 461): `WGSLTarget.compileFieldFunction()` gives a
 * scalar field function that a host compute shader calls over a 3-D grid,
 * its helper functions by name, and the layout of one uniform struct that
 * holds its parameters.
 *
 * The witnesses are Tycho's showcases `gyroid` (one scalar parameter `c`) and
 * `metaballs` (the sum of ten fields, with user functions of the time `T`;
 * also written with the ten centers in one list parameter `P`). The shader
 * text is run by the f32 evaluator of `gpu-shader-f32-eval.ts`, with the
 * parameter struct given as a global object, and compared with the
 * `javascript` target.
 *
 * Design record: `docs/plans/2026-10-27-tycho-rows-461-463-gpu-design-answers.md`,
 * "Recommendation for 461".
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import type { FieldFunctionResult } from '../../src/compute-engine/compilation/types';
import { shaderFunctions } from './gpu-shader-f32-eval';

const GYROID = '\\sin(x)\\cos(y) + \\sin(y)\\cos(z) + \\sin(z)\\cos(x) - c';
const METABALLS =
  '\\sum_{k=1}^{10} \\frac{2}{5((x - a(k))^2 + (y - b(k))^2 + (z - c(k))^2)} - 1';
const METABALLS_LIST =
  '\\sum_{k=1}^{10} \\frac{2}{5((x - P_{3k-2})^2 + (y - P_{3k-1})^2 + (z - P_{3k})^2)} - 1';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const s of ['x', 'y', 'z']) ce.declare(s, 'real');
  return ce;
}

function gyroidEngine(): ComputeEngine {
  const ce = engine();
  ce.declare('c', 'real');
  return ce;
}

/** The `metaballs` showcase: each ball moves on a closed-form orbit. */
function metaballsEngine(): ComputeEngine {
  const ce = engine();
  ce.declare('T', 'real');
  ce.parse('a(k) := 2.3\\sin((0.3 + 0.05k)T + 1.7k)').evaluate();
  ce.parse('b(k) := 2.3\\sin((0.25 + 0.04k)T + 2.9k)').evaluate();
  ce.parse('c(k) := 1.8\\cos((0.2 + 0.06k)T + 4.1k)').evaluate();
  return ce;
}

const XYZ = ['x', 'y', 'z'];

/**
 * The struct global of a parameter buffer: a scalar is a number, and a list
 * of n elements is `⌈n/4⌉` arrays of 4 numbers (the `vec4f` entries), with
 * the padding lanes at NaN, which no read may return.
 */
function struct(
  r: FieldFunctionResult,
  values: Record<string, number | number[]>
): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const p of r.params) {
    const v = values[p.name];
    if (typeof v === 'number') {
      s[p.name] = Math.fround(v);
      continue;
    }
    const entries: number[][] = [];
    for (let e = 0; e < p.size / 16; e++)
      entries.push(
        [0, 1, 2, 3].map((j) => {
          const w = v[4 * e + j];
          return w === undefined ? NaN : Math.fround(w);
        })
      );
    s[p.name] = entries;
  }
  return s;
}

/** Run the field function `r` (named `name`) on the f32 evaluator. */
function runner(
  r: FieldFunctionResult,
  name: string,
  values: Record<string, number | number[]>,
  variable = 'ce_params'
): (...args: number[]) => number {
  const src = [...Object.values(r.helpers), r.function].join('\n');
  const f = shaderFunctions(src, 'wgsl', { [variable]: struct(r, values) });
  return (...args) => f(name, ...args) as number;
}

const POINTS = [
  [0.3, -1.2, 2.1],
  [-2.4, 0.7, -0.4],
  [1.9, 1.1, 0.5],
  [0.0, -0.6, -2.2],
];

describe('CE-571 compileFieldFunction: the gyroid witness', () => {
  const ce = gyroidEngine();
  const w = new WGSLTarget();
  const expr = ce.parse(GYROID);
  const r = w.compileFieldFunction(expr, { name: 'gyroid', coordinates: XYZ });

  test('the function, the struct and the layout', () => {
    expect(r.success).toBe(true);
    // A parameter read from the struct is a host input of its declared type
    // (`real`), so `sin` and `cos` are the built-ins, with no NaN guard.
    expect(r.function).toBe(
      'fn gyroid(x: f32, y: f32, z: f32) -> f32 {\n' +
        '  return -ce_params.c + sin(z) * cos(x) + sin(x) * cos(y) + sin(y) * cos(z);\n' +
        '}\n'
    );
    expect(r.helpers).toEqual({});
    expect(r.paramsStructSource).toBe('struct CEParams {\n  c: f32,\n}\n');
    expect(r.params).toEqual([
      { name: 'c', ceType: 'real', wgslType: 'f32', offset: 0, size: 4 },
    ]);
    expect(r.paramsSize).toBe(16);
  });

  test('two parameter values, one compiled text, the values of JavaScript', () => {
    const js = compile(expr, { to: 'javascript' });
    for (const c of [0, 0.5, -0.8]) {
      const run = runner(r, 'gyroid', { c });
      for (const [x, y, z] of POINTS)
        expect(run(x, y, z)).toBeCloseTo(js.run!({ x, y, z, c }) as number, 5);
    }
    // A second compilation, on the same engine and on a new one, gives the
    // same text: a parameter change is a buffer write only.
    expect(
      w.compileFieldFunction(expr, { name: 'gyroid', coordinates: XYZ })
    ).toEqual(r);
    const other = gyroidEngine();
    expect(
      new WGSLTarget().compileFieldFunction(other.parse(GYROID), {
        name: 'gyroid',
        coordinates: XYZ,
      })
    ).toEqual(r);
  });

  test('a struct-field parameter keeps no NaN guard that a self-mapped one drops', () => {
    // `compile()` with `vars: { c: 'ce_params.c' }` cannot tell a struct
    // field from other source of the caller, and keeps the guard.
    const e = ce.parse('\\sin(x + c)');
    const plain = compile(e, {
      to: 'wgsl',
      vars: { x: 'x', c: 'ce_params.c' },
    });
    expect(plain.code).toBe('_gpu_sin(ce_params.c + x)');
    const f = w.compileFieldFunction(e, { name: 'f', coordinates: ['x'] });
    expect(f.function).toContain('return sin(ce_params.c + x);');
    expect(f.helpers).toEqual({});
  });
});

describe('CE-571 compileFieldFunction: the metaballs witness', () => {
  test('user functions of the time T, prefixed with the field name', () => {
    const ce = metaballsEngine();
    const expr = ce.parse(METABALLS);
    const r = new WGSLTarget().compileFieldFunction(expr, {
      name: 'metaballs',
      coordinates: XYZ,
    });
    expect(r.success).toBe(true);
    expect(r.params).toEqual([
      { name: 'T', ceType: 'real', wgslType: 'f32', offset: 0, size: 4 },
    ]);
    expect(r.paramsSize).toBe(16);
    expect(Object.keys(r.helpers)).toEqual(
      expect.arrayContaining([
        '_fn_9_metaballs_a',
        '_fn_9_metaballs_b',
        '_fn_9_metaballs_c',
      ])
    );
    expect(r.function).not.toMatch(/(?<![\w.])_fn_[abc]\(/);
    expect(r.helpers._fn_9_metaballs_a).toMatch(
      /^fn _fn_9_metaballs_a\(k: f32\) -> f32 \{/
    );
    expect(r.helpers._fn_9_metaballs_a).toContain('ce_params.T');

    const js = compile(expr, { to: 'javascript' });
    for (const T of [13, 27.5]) {
      const run = runner(r, 'metaballs', { T });
      for (const [x, y, z] of POINTS) {
        const want = js.run!({ x, y, z, T }) as number;
        expect(Math.abs(run(x, y, z) - want)).toBeLessThan(
          1e-4 * (1 + Math.abs(want))
        );
      }
    }
  });

  test('the ten centers in one list parameter, packed as vec4f entries', () => {
    const ce = engine();
    ce.declare('P', 'list<number^30>');
    const expr = ce.parse(METABALLS_LIST);
    const r = new WGSLTarget().compileFieldFunction(expr, {
      name: 'metaballs',
      coordinates: XYZ,
    });
    expect(r.success).toBe(true);
    expect(r.params).toEqual([
      {
        name: 'P',
        ceType: 'vector<30>',
        wgslType: 'array<vec4f, 8>',
        offset: 0,
        size: 128,
        length: 30,
      },
    ]);
    expect(r.paramsStructSource).toBe(
      'struct CEParams {\n  P: array<vec4f, 8>,\n}\n'
    );
    // Each read indexes the uniform variable: no copy of the array.
    expect(r.helpers._gpu_pat30_9_ce_params_P).toContain(
      'return ce_params.P[i32(_gpu_e)][i32(_gpu_s - 4.0 * _gpu_e)];'
    );
    expect(Object.values(r.helpers).join('\n')).not.toMatch(/var \w+ = /);
    expect(r.helpers._gpu_nan).toBeDefined();

    const js = compile(expr, { to: 'javascript' });
    const P = Array.from(
      { length: 30 },
      (_, i) => 2.2 * Math.sin(1.3 * i + 0.4)
    );
    const run = runner(r, 'metaballs', { P });
    for (const [x, y, z] of POINTS) {
      const want = js.run!({ x, y, z, P }) as number;
      expect(Math.abs(run(x, y, z) - want)).toBeLessThan(
        1e-4 * (1 + Math.abs(want))
      );
    }
  });
});

describe('CE-571 compileFieldFunction: a list parameter read by position', () => {
  const ce = engine();
  ce.declare('Q', 'list<number^6>');
  ce.declare('n', 'real');
  const expr = ce.parse('Q_{n} + x');
  const r = new WGSLTarget().compileFieldFunction(expr, {
    name: 'g',
    coordinates: ['x'],
  });
  const js = compile(expr, { to: 'javascript' });
  const Q = [10, 20, 30, 40, 50, 60];

  test('the index rules of At, against the javascript target', () => {
    expect(r.success).toBe(true);
    expect(r.function).toBe(
      'fn g(x: f32) -> f32 {\n  return x + _gpu_pat6_9_ce_params_Q(ce_params.n);\n}\n'
    );
    // 1-based; a negative index counts from the end; 0, a non-integer and
    // an index out of range give NaN.
    for (const n of [1, 2, 4, 5, 6, -1, -2, -6, 0, 7, -7, 2.5, 1e9]) {
      const run = runner(r, 'g', { Q, n });
      const want = js.run!({ x: 0.25, Q, n }) as number;
      const got = run(0.25);
      if (Number.isNaN(want)) expect(got).toBeNaN();
      else expect(got).toBe(Math.fround(want));
    }
  });

  test('a list of 6 elements uses two vec4f entries after the scalars', () => {
    expect(r.params).toEqual([
      { name: 'n', ceType: 'real', wgslType: 'f32', offset: 0, size: 4 },
      {
        name: 'Q',
        ceType: 'vector<6>',
        wgslType: 'array<vec4f, 2>',
        offset: 16,
        size: 32,
        length: 6,
      },
    ]);
    expect(r.paramsSize).toBe(48);
  });

  test('a reference to the whole list declines', () => {
    const m = new WGSLTarget().compileFieldFunction(ce.parse('\\max(Q) + x'), {
      name: 'g',
      coordinates: ['x'],
    });
    expect(m.success).toBe(false);
    expect(m.diagnostic?.message).toMatch(
      /can be read only through a positional access/
    );
  });
});

describe('CE-571 compileFieldFunction: the struct layout', () => {
  test('scalars first in name order, then lists, each list 16-byte aligned', () => {
    const ce = engine();
    for (const s of ['c', 'n', 'k', 'd', 'e']) ce.declare(s, 'real');
    ce.declare('m', 'integer');
    ce.declare('P', 'list<number^30>');
    ce.declare('Q', 'list<number^5>');
    const r = new WGSLTarget().compileFieldFunction(
      ce.parse('c + d + e + k + m + n + P_1 + Q_5 + x'),
      {
        name: 'f',
        coordinates: XYZ,
        paramsStruct: 'FParams',
        paramsVariable: 'f_params',
      }
    );
    expect(r.success).toBe(true);
    expect(r.params.map((p) => [p.name, p.wgslType, p.offset, p.size])).toEqual(
      [
        ['c', 'f32', 0, 4],
        ['d', 'f32', 4, 4],
        ['e', 'f32', 8, 4],
        ['k', 'f32', 12, 4],
        ['m', 'f32', 16, 4],
        ['n', 'f32', 20, 4],
        ['P', 'array<vec4f, 8>', 32, 128],
        ['Q', 'array<vec4f, 2>', 160, 32],
      ]
    );
    expect(r.params.find((p) => p.name === 'm')?.ceType).toBe('integer');
    expect(r.paramsSize).toBe(192);
    expect(r.paramsStructSource).toBe(
      'struct FParams {\n  c: f32,\n  d: f32,\n  e: f32,\n  k: f32,\n  m: f32,\n  n: f32,\n' +
        '  P: array<vec4f, 8>,\n  Q: array<vec4f, 2>,\n}\n'
    );
    expect(r.function).toContain('f_params.c');
    expect(Object.keys(r.helpers)).toEqual(
      expect.arrayContaining([
        '_gpu_pat30_8_f_params_P',
        '_gpu_pat5_8_f_params_Q',
      ])
    );
  });

  test('the buffer size is a multiple of 16; no parameter gives no struct', () => {
    const ce = engine();
    for (const s of ['a1', 'a2', 'a3', 'a4', 'a5']) ce.declare(s, 'real');
    const five = new WGSLTarget().compileFieldFunction(
      ce.parse('a_1 + a_2 + a_3 + a_4 + a_5 + x'),
      { name: 'f', coordinates: XYZ }
    );
    expect(five.params.map((p) => p.offset)).toEqual([0, 4, 8, 12, 16]);
    expect(five.paramsSize).toBe(32);
    const none = new WGSLTarget().compileFieldFunction(ce.parse('x y + z'), {
      name: 'f',
      coordinates: XYZ,
    });
    expect(none.success).toBe(true);
    expect(none.params).toEqual([]);
    expect(none.paramsStructSource).toBe('');
    expect(none.paramsSize).toBe(0);
  });
});

describe('CE-571 compileFieldFunction: two fields in one module', () => {
  test('the helper maps merge by name; the user functions have two names', () => {
    const ce = engine();
    ce.declare('c', 'real');
    ce.declare('s', 'real');
    ce.parse('h(t) := \\sin(t s) + t').evaluate();
    const w = new WGSLTarget();
    const a = w.compileFieldFunction(ce.parse('h(x) + \\sin(y z) - c'), {
      name: 'fieldA',
      coordinates: XYZ,
      paramsStruct: 'AParams',
      paramsVariable: 'a_params',
    });
    const b = w.compileFieldFunction(ce.parse('h(y) \\cos(x z) + c'), {
      name: 'fieldB',
      coordinates: XYZ,
      paramsStruct: 'BParams',
      paramsVariable: 'b_params',
    });
    expect(a.success && b.success).toBe(true);
    expect(a.helpers._fn_6_fieldA_h).toBeDefined();
    expect(b.helpers._fn_6_fieldB_h).toBeDefined();
    expect(a.helpers._fn_h).toBeUndefined();
    // A name that both maps hold has one source text.
    const shared = Object.keys(a.helpers).filter((k) => k in b.helpers);
    expect(shared).toEqual(expect.arrayContaining(['_gpu_sin']));
    for (const k of shared) expect(a.helpers[k]).toBe(b.helpers[k]);

    // The merged module runs both functions.
    const helpers = { ...a.helpers, ...b.helpers };
    const f = shaderFunctions(
      [...Object.values(helpers), a.function, b.function].join('\n'),
      'wgsl',
      {
        a_params: { c: Math.fround(0.3), s: Math.fround(1.5) },
        b_params: { c: Math.fround(-0.2), s: Math.fround(0.5) },
      }
    );
    const ja = compile(ce.parse('h(x) + \\sin(y z) - c'), { to: 'javascript' });
    const jb = compile(ce.parse('h(y) \\cos(x z) + c'), { to: 'javascript' });
    for (const [x, y, z] of POINTS) {
      expect(f('fieldA', x, y, z) as number).toBeCloseTo(
        ja.run!({ x, y, z, c: 0.3, s: 1.5 }) as number,
        4
      );
      expect(f('fieldB', x, y, z) as number).toBeCloseTo(
        jb.run!({ x, y, z, c: -0.2, s: 0.5 }) as number,
        4
      );
    }
  });

  test('the field length is in a user-function name: two fields cannot give one name', () => {
    // Without the length, the field `my` with the function `field_h` and
    // the field `my_field` with the function `h` both give `_fn_my_field_h`.
    const ce = engine();
    ce.box([
      'Assign',
      'field_h',
      ['Function', ['Add', ['Power', 't', 2], 1], 't'],
    ]).evaluate();
    ce.parse('h(t) := 3t - 2').evaluate();
    const w = new WGSLTarget();
    const a = w.compileFieldFunction(ce.box(['Add', ['field_h', 'x'], 'y']), {
      name: 'my',
      coordinates: XYZ,
      paramsVariable: 'my_params',
      paramsStruct: 'MyParams',
    });
    const b = w.compileFieldFunction(ce.parse('h(x) + z'), {
      name: 'my_field',
      coordinates: XYZ,
      paramsVariable: 'my_field_params',
      paramsStruct: 'MyFieldParams',
    });
    expect(a.success && b.success).toBe(true);
    const fa = Object.keys(a.helpers).filter((k) => k.startsWith('_fn_'));
    const fb = Object.keys(b.helpers).filter((k) => k.startsWith('_fn_'));
    expect(fa).toEqual(['_fn_2_my_field_h']);
    expect(fb).toEqual(['_fn_8_my_field_h']);
    expect(a.function).toContain('_fn_2_my_field_h(x)');
    expect(b.function).toContain('_fn_8_my_field_h(x)');

    // Both run in one module, with the values of JavaScript.
    const f = shaderFunctions(
      [
        ...Object.values({ ...a.helpers, ...b.helpers }),
        a.function,
        b.function,
      ].join('\n'),
      'wgsl'
    );
    expect(f('my', 1.5, 2, 0) as number).toBeCloseTo(1.5 ** 2 + 1 + 2, 5);
    expect(f('my_field', 1.5, 0, 4) as number).toBeCloseTo(3 * 1.5 - 2 + 4, 5);
  });

  test('over many compilations, a helper name has one source text', () => {
    const ce = engine();
    ce.declare('c', 'real');
    ce.declare('P', 'list<number^30>');
    ce.declare('Q', 'list<number^7>');
    const rows = [
      GYROID,
      METABALLS_LIST,
      '\\sin(x + c) \\cos(P_{2})',
      '\\tanh(x) + Q_{3} + \\lfloor y \\rfloor',
      '\\sqrt{x^2 + y^2} - c',
      '\\exp(-x^2) \\sin(c y) + |z|',
      '\\operatorname{mod}(x, 2) + \\arctan(y)',
    ];
    const seen = new Map<string, string>();
    for (const [i, row] of rows.entries())
      for (const variable of ['ce_params', 'p2']) {
        const r = new WGSLTarget().compileFieldFunction(ce.parse(row), {
          name: `f${i}`,
          coordinates: XYZ,
          paramsVariable: variable,
        });
        expect(r.success).toBe(true);
        for (const [k, v] of Object.entries(r.helpers)) {
          if (seen.has(k)) expect(v).toBe(seen.get(k));
          else seen.set(k, v);
        }
      }
  });

  test('a seeded draw sets its counter to 0 at each call', () => {
    const ce = engine();
    const r = new WGSLTarget().compileFieldFunction(
      ce.box(['WithRandomSeed', 7, ['Add', 'x', ['Random']]]),
      { name: 'noise', coordinates: XYZ }
    );
    expect(r.success).toBe(true);
    expect(r.function).toMatch(
      /^fn noise\(x: f32, y: f32, z: f32\) -> f32 \{\n {2}_gpu_rnd_n0 = 0u;\n/
    );
    expect(r.helpers._gpu_rnd_n0).toBe('var<private> _gpu_rnd_n0: u32 = 0u;\n');
  });
});

describe('CE-571 compileFieldFunction: declines', () => {
  const ce = engine();
  ce.declare('L', 'list<number>');
  ce.declare('Big', 'list<number^1025>');
  ce.declare('Edge', 'list<number^1024>');
  ce.declare('B', 'boolean');
  ce.declare('S', 'string');
  ce.declare('W', 'complex');
  ce.declare('V', 'list<complex^3>');
  ce.parse('f(n) := \\operatorname{If}(n < 1, 1, n f(n-1))').evaluate();
  const w = new WGSLTarget();
  const field = (e: ReturnType<ComputeEngine['box']>) =>
    w.compileFieldFunction(e, { name: 'g', coordinates: XYZ });

  test.each([
    ['a list of unknown length', ['Add', ['At', 'L', 2], 'x']],
    ['a list above the limit', ['Add', ['At', 'Big', 2], 'x']],
    ['a boolean', ['If', 'B', 'x', 'y']],
    ['a complex number', ['Add', ['Real', 'W'], 'x']],
    ['a list of complex numbers', ['Add', ['Real', ['At', 'V', 1]], 'x']],
  ])('a parameter that is %s', (_label, json) => {
    const r = field(ce.box(json as never));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsupported-parameter');
    expect(r.diagnostic?.kind).toBe('capability');
    expect(r.diagnostic?.message).toContain(
      "storage: { <name>: { kind: 'storage-buffer', group, binding } }"
    );
    expect(r.diagnostic?.message).toMatch(
      /cannot hold complex numbers, text, booleans or lists of lists/
    );
    expect(r.diagnostic?.message).not.toMatch(/ROADMAP|CE-572|not available/);
    expect(r.function).toBe('');
    expect(r.helpers).toEqual({});
  });

  test('a string parameter declines', () => {
    const r = field(ce.box(['Add', ['StringLength', 'S'], 'x'] as never));
    expect(r.success).toBe(false);
  });

  test('a list of 1024 elements is accepted', () => {
    const r = field(ce.box(['Add', ['At', 'Edge', -1], 'x']));
    expect(r.success).toBe(true);
    expect(r.params[0].size).toBe(4096);
  });

  test.each([
    ['complex', ['Add', 'x', ['Multiply', 'ImaginaryUnit', 'y']]],
    ['vector', ['Tuple', 'x', 'y']],
    ['boolean', ['Less', 'x', 'y']],
    ['list', ['List', 'x', 'y', 'z', 'x', 'y']],
  ])('a %s result declines as a capability', (_label, json) => {
    const r = field(ce.box(json as never));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.kind).toBe('capability');
  });

  test.each([
    ['recursion', ['f', 'x']],
    ['an unseeded Random', ['Add', ['Random'], 'x']],
    ['Integrate', ['Integrate', 't', ['Limits', 't', 0, 'x']]],
  ])('%s declines with the diagnostic of compile()', (_label, json) => {
    const e = ce.box(json as never);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const plain = compile(e, { to: 'wgsl' });
    warn.mockRestore();
    expect(plain.success).toBe(false);
    const r = field(e);
    expect(r.success).toBe(false);
    expect(r.diagnostic).toEqual(plain.diagnostic);
  });

  test('a wrong option is an error of the caller', () => {
    const e = ce.parse('x + y');
    expect(() =>
      w.compileFieldFunction(e, { name: 'fn', coordinates: XYZ })
    ).toThrow(/reserved word/);
    expect(() =>
      w.compileFieldFunction(e, { name: 'x', coordinates: XYZ })
    ).toThrow(/used for two/);
    expect(() =>
      w.compileFieldFunction(e, {
        name: 'g',
        coordinates: XYZ,
        storage: { x: 'sampler2D' },
      })
    ).toThrow(/coordinate "x"/);
  });
});

describe('CE-571 compileFieldFunction: review findings', () => {
  const w = new WGSLTarget();
  const field = (e: ReturnType<ComputeEngine['box']>, options = {}) =>
    w.compileFieldFunction(e, { name: 'f', coordinates: XYZ, ...options });

  test('a user function that reads a coordinate it does not take declines', () => {
    const ce = engine();
    ce.parse('h(t) := t + x').evaluate();
    const r = field(ce.parse('h(y)'));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/reads the coordinate "x"/);
    // A function that takes the coordinate as a parameter is fine.
    ce.parse('g(t, u) := t + u').evaluate();
    expect(field(ce.parse('g(y, x)')).success).toBe(true);
  });

  test('a user function that shadows a library operator: its free symbols are parameters', () => {
    const ce = engine();
    ce.declare('c', 'real');
    ce.box([
      'Assign',
      'Gamma',
      ['Function', ['Add', 't', 'c'], 't'],
    ]).evaluate();
    const r = field(ce.box(['Gamma', 'x']));
    expect(r.success).toBe(true);
    expect(r.params.map((p) => p.name)).toEqual(['c']);
    const helper = Object.entries(r.helpers).find(([k]) =>
      k.startsWith('_fn_')
    );
    expect(helper?.[1]).toContain('ce_params.c');
    expect(helper?.[1]).not.toMatch(/(?<![\w.])c(?![\w])/);
  });

  test('a user function that declares the name of the struct variable declines', () => {
    const ce = engine();
    ce.declare('c', 'real');
    ce.parse('g(p) := p + c').evaluate();
    const r = field(ce.parse('g(x)'), { paramsVariable: 'p' });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/declares "p"/);
    expect(field(ce.parse('g(x)'), { paramsVariable: 'q' }).success).toBe(true);
  });

  test('the type of a list parameter comes from the expression, not from the current scope', () => {
    const ce = engine();
    ce.pushScope();
    ce.declare('P', 'list<number^6>');
    const e = ce.box(['Add', ['At', 'P', 5], 'x']);
    ce.popScope();
    ce.declare('P', 'list<number^3>');
    const r = field(e);
    expect(r.success).toBe(true);
    expect(r.params).toEqual([
      expect.objectContaining({ name: 'P', length: 6, size: 32 }),
    ]);
    expect(r.function).toContain('_gpu_pat6_9_ce_params_P(5.0)');
  });

  test('two user functions with no ASCII name, in two fields', () => {
    const ce = engine();
    ce.declare('α', 'function');
    ce.assign('α', ce.box(['Function', ['Multiply', 't', 2], 't']));
    ce.declare('β', 'function');
    ce.assign('β', ce.box(['Function', ['Multiply', 't', 3], 't']));
    const e = ce.box(['Add', ['α', 'x'], ['β', 'y']]);
    const f = field(e, { name: 'f' });
    const g = field(e, { name: 'g' });
    expect(Object.keys(f.helpers).sort()).toEqual(['_fn_1_f', '_fn_1_f_2']);
    expect(Object.keys(g.helpers).sort()).toEqual(['_fn_1_g', '_fn_1_g_2']);
    expect(f.function).toContain('_fn_1_f(x) + _fn_1_f_2(y)');
    const run = shaderFunctions(
      [
        ...Object.values({ ...f.helpers, ...g.helpers }),
        f.function,
        g.function,
      ].join('\n'),
      'wgsl'
    );
    expect(run('f', 1.5, 2, 0)).toBe(9);
    expect(run('g', 1.5, 2, 0)).toBe(9);
  });

  test('a body with no value declines, as with compileFunction()', () => {
    const ce = engine();
    const r = field(ce.box(['Declare', 's', "'real'"] as never));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/declaration/);
    expect(field(ce.box(['Assign', 's', 'x'])).success).toBe(false);
  });

  test('a body that assigns a parameter or a coordinate declines; a local is fine', () => {
    const ce = engine();
    ce.declare('c', 'real');
    const param = field(
      ce.box([
        'Block',
        ['Assign', 'c', ['Add', 'c', 1]],
        ['Multiply', 'c', 'x'],
      ])
    );
    expect(param.success).toBe(false);
    expect(param.diagnostic?.message).toMatch(
      /assigns "c", which is a parameter/
    );
    const coordinate = field(
      ce.box([
        'Block',
        ['Assign', 'x', ['Add', 'x', 1]],
        ['Multiply', 'x', 'y'],
      ])
    );
    expect(coordinate.success).toBe(false);
    expect(coordinate.diagnostic?.message).toMatch(
      /assigns "x", which is a coordinate/
    );
    // Names that only the block assigns are its locals, not parameters.
    const local = field(
      ce.box(['Block', ['Assign', 's', 'x'], ['Assign', 't', ['Add', 's', 1]]])
    );
    expect(local.success).toBe(true);
    expect(local.params).toEqual([]);
    const run = shaderFunctions(local.function, 'wgsl');
    expect(run('f', 2, 0, 0)).toBe(3);
  });

  test('a symbol with a value is a parameter: a new value gives the same text', () => {
    const ce = engine();
    ce.assign('w2', 5);
    const a = field(ce.box(['Add', 'w2', 'x']));
    ce.assign('w2', 7);
    const b = field(ce.box(['Add', 'w2', 'x']));
    expect(a.success).toBe(true);
    expect(b).toEqual(a);
    expect(a.function).toContain('ce_params.w2 + x');
    expect(a.params.map((p) => [p.name, p.wgslType])).toEqual([['w2', 'f32']]);
    // A library constant stays folded.
    const pi = field(ce.box(['Multiply', 'Pi', 'x']));
    expect(pi.params).toEqual([]);
    expect(pi.function).toContain('3.14159');
  });

  test('a predeclared WGSL name is refused as a declared name', () => {
    const ce = engine();
    const e = ce.parse('x + y');
    // `vec4f` and `f32` are also reserved words in the reserved-word list
    // of the shader targets, which gives its own message.
    for (const name of ['sin', 'max', 'select', 'textureLoad'])
      expect(() => field(e, { name })).toThrow(/predeclared/);
    expect(() => field(e, { name: 'vec4f' })).toThrow(/reserved|predeclared/);
    expect(() => field(e, { paramsStruct: 'mat2x2' })).toThrow(
      /reserved|predeclared/
    );
    expect(() => field(e, { paramsVariable: 'dot' })).toThrow(/predeclared/);
    expect(() => field(e, { paramsVariable: 'f32' })).toThrow(
      /reserved|predeclared/
    );
    expect(() => field(e, { name: '_fn_x' })).toThrow(/starts with a letter/);
    expect(() => field(e, { name: '_gpu_x' })).toThrow(/starts with a letter/);
  });
});

describe('CE-571 compileFieldFunction: second review', () => {
  const w = new WGSLTarget();
  const field = (e: ReturnType<ComputeEngine['box']>, options = {}) =>
    w.compileFieldFunction(e, { name: 'f', coordinates: ['x'], ...options });

  test('a parameter with an inferred type: no fact of its value reaches the code', () => {
    const ce = engine();
    const rows = [
      ['Abs', 'a'],
      ['Sqrt', 'a'],
      ['Power', 'a', ['Rational', 1, 2]],
    ] as const;
    const texts: Record<string, string[]> = {};
    for (const v of [5, -5]) {
      ce.assign('a', v);
      const before = ce.box('a').type.toString();
      for (const row of rows) {
        const r = field(ce.box(row as never));
        expect(r.success).toBe(true);
        expect(r.params.map((p) => p.name)).toEqual(['a']);
        (texts[JSON.stringify(row)] ??= []).push(r.function);
      }
      // The definition is restored: its value, its type and the facts.
      expect(ce.box('a').type.toString()).toBe(before);
      expect(ce.box('a').value?.re).toBe(v);
      expect(ce.box('a').isNonNegative).toBe(v >= 0);
    }
    for (const [row, [a, b]] of Object.entries(texts)) {
      expect(b).toBe(a);
      if (row.includes('Abs')) expect(a).toContain('abs(ce_params.a)');
      else expect(a).toContain('sqrt(ce_params.a)');
    }
    // The buffer value decides the result: |−5| is 5.
    const r = field(ce.box(['Abs', 'a']));
    expect(runner(r, 'f', { a: -5 })(0)).toBe(5);
  });

  test('a valued symbol that a user function also binds is a parameter where it is free', () => {
    const ce = engine();
    ce.declare('a', 'real');
    ce.assign('a', 5);
    ce.parse('h(a) := a + 1').evaluate();
    const r = field(ce.parse('a + h(x)'));
    expect(r.success).toBe(true);
    expect(r.params.map((p) => p.name)).toEqual(['a']);
    expect(r.function).toContain('ce_params.a + _fn_1_f_h(x)');
    expect(r.helpers._fn_1_f_h).toContain('return a + 1.0;');
    expect(runner(r, 'f', { a: 2 })(3)).toBe(6);
    // A `Sum` index with the name of a valued symbol stays the index.
    ce.assign('k', 3);
    const s = field(ce.parse('k + \\sum_{k=1}^{3} k x'));
    expect(s.params.map((p) => p.name)).toEqual(['k']);
    expect(runner(s, 'f', { k: 10 })(1)).toBe(16);
  });

  test('a coordinate free in a user function beside an index of that name declines', () => {
    const ce = engine();
    ce.declare('n', 'integer');
    ce.parse('g(t) := t + x + \\sum_{x=1}^{n} x').evaluate();
    const r = w.compileFieldFunction(ce.parse('g(y)'), {
      name: 'f',
      coordinates: XYZ,
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/"g" reads the coordinate "x"/);
    // Only the index: no coordinate is read, and the function compiles.
    ce.parse('q(t) := t + \\sum_{x=1}^{n} x').evaluate();
    expect(
      w.compileFieldFunction(ce.parse('q(y)'), { name: 'f', coordinates: XYZ })
        .success
    ).toBe(true);
  });

  test('a shared library helper with another prefix (Mandelbrot)', () => {
    const ce = engine();
    const r = w.compileFieldFunction(
      ce.parse('\\operatorname{Mandelbrot}(x + iy, 50)'),
      { name: 'f', coordinates: XYZ }
    );
    expect(r.success).toBe(true);
    expect(Object.keys(r.helpers)).toContain('_fractal_mandelbrot');
    expect(r.function).toContain('_fractal_mandelbrot(');
  });
});

describe('CE-571 compileFieldFunction: third review', () => {
  // A coordinate and a parameter, each with a value, declared or with a type
  // inferred from the value. The compiled text must not depend on the value
  // (5 or -5) or on the facts it gives, and each definition must be the same
  // after the call as before.
  test.each([
    ['inferred', false],
    ['declared real', true],
  ])('a valued coordinate and a valued parameter, %s', (_label, declared) => {
    const ce = new ComputeEngine();
    if (declared) {
      ce.declare('x', 'real');
      ce.declare('a', 'real');
    }
    const state = (s: string) => {
      const e = ce.box(s);
      return [e.type.toString(), e.value?.re, e.isNonNegative, e.isNegative];
    };
    const texts = new Map<string, string>();
    for (const v of [5, -5]) {
      ce.assign('x', v);
      ce.assign('a', v);
      for (const sym of ['x', 'a'])
        for (const row of [
          ['Abs', sym],
          ['Sqrt', sym],
          ['Power', sym, ['Rational', 1, 2]],
        ]) {
          const before = [state('x'), state('a')];
          const r = new WGSLTarget().compileFieldFunction(
            ce.box(row as never),
            { name: 'f', coordinates: ['x'] }
          );
          expect(r.success).toBe(true);
          expect([state('x'), state('a')]).toEqual(before);
          const read = sym === 'x' ? 'x' : 'ce_params.a';
          expect(r.function).toContain(
            row[0] === 'Abs' ? `abs(${read})` : `sqrt(${read})`
          );
          const key = JSON.stringify(row);
          if (texts.has(key)) expect(r.function).toBe(texts.get(key));
          else texts.set(key, r.function);
        }
    }
    expect(texts.size).toBe(6);
    // The argument decides the value: |-5| is 5 at the coordinate -5.
    const r = new WGSLTarget().compileFieldFunction(ce.box(['Abs', 'x']), {
      name: 'f',
      coordinates: ['x'],
    });
    expect(shaderFunctions(r.function, 'wgsl')('f', -5)).toBe(5);
  });
});

describe('CE-571 compileFieldFunction: integration with CE-572 and fourth review', () => {
  const w = new WGSLTarget();
  const SB = {
    S: { kind: 'storage-buffer' as const, group: 1, binding: 0 },
  };

  test('a coordinate free in a function that an intermediate function calls declines', () => {
    const ce = engine();
    ce.parse('g(t) := t + x').evaluate();
    ce.parse('h(x) := g(x)').evaluate();
    const r = w.compileFieldFunction(ce.parse('h(y)'), {
      name: 'f',
      coordinates: XYZ,
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/"g" reads the coordinate "x"/);
  });

  test('every Return of the body is checked as f32', () => {
    const ce = engine();
    const bad = w.compileFieldFunction(
      ce.box(['Block', ['Return', 'True'], 'x']),
      { name: 'f', coordinates: XYZ }
    );
    expect(bad.success).toBe(false);
    expect(bad.diagnostic?.message).toMatch(
      /`Return` in the body yields a `bool`/
    );
    const good = w.compileFieldFunction(ce.box(['Block', ['Return', 0], 'x']), {
      name: 'f',
      coordinates: XYZ,
    });
    expect(good.success).toBe(true);
  });

  test('a storage-buffer list: declarations in helpers, layout in storageBuffers', () => {
    const ce = engine();
    ce.declare('S', 'list<real>');
    ce.declare('c', 'real');
    const r = w.compileFieldFunction(
      ce.parse('c + \\sum_{k=1}^{\\operatorname{Length}(S)} S_k \\sin(k x)'),
      { name: 'f', coordinates: XYZ, storage: SB }
    );
    expect(r.success).toBe(true);
    expect(r.params.map((p) => p.name)).toEqual(['c']);
    expect(r.helpers.CE_List_f32).toMatch(/^struct CE_List_f32 \{/);
    expect(r.helpers.S).toBe(
      '@group(1) @binding(0) var<storage, read> S: CE_List_f32;\n'
    );
    expect(r.storageBuffers).toEqual([
      expect.objectContaining({
        symbol: 'S',
        name: 'S',
        struct: 'CE_List_f32',
        group: 1,
        binding: 0,
      }),
    ]);
    expect(r.function).toContain('arrayLength(&S.data)');
    expect(r.function).toContain('ce_params.c');
  });

  test('a storage-buffer list read in a user function and by the reductions', () => {
    const ce = engine();
    ce.declare('S', 'list<real>');
    ce.declare('c', 'real');
    ce.parse('u(t) := t \\operatorname{Length}(S) + S_1').evaluate();
    const inUser = w.compileFieldFunction(ce.parse('u(x) + c'), {
      name: 'f',
      coordinates: XYZ,
      storage: SB,
    });
    expect(inUser.success).toBe(true);
    expect(inUser.helpers._fn_1_f_u).toContain('_gpu_sbat_S(');
    expect(inUser.helpers.S).toBeDefined();
    for (const row of [
      ['Add', ['Max', 'S'], 'x'],
      ['Add', ['Min', 'S'], 'x'],
      ['Add', ['Mean', 'S'], 'x'],
      ['Add', ['Sum', 'S'], 'x'],
      ['Add', ['Length', 'S'], 'x'],
    ]) {
      const r = w.compileFieldFunction(ce.box(row as never), {
        name: 'f',
        coordinates: XYZ,
        storage: SB,
      });
      expect(r.success).toBe(true);
      expect(r.params).toEqual([]);
      expect(r.storageBuffers?.[0]?.name).toBe('S');
    }
  });

  test('two fields that read one buffer with one binding merge by name', () => {
    const ce = engine();
    ce.declare('S', 'list<real>');
    const a = w.compileFieldFunction(ce.box(['Add', ['At', 'S', 1], 'x']), {
      name: 'fa',
      coordinates: XYZ,
      storage: SB,
    });
    const b = w.compileFieldFunction(ce.box(['Add', ['Max', 'S'], 'y']), {
      name: 'fb',
      coordinates: XYZ,
      storage: SB,
    });
    for (const k of Object.keys(a.helpers))
      if (k in b.helpers) expect(a.helpers[k]).toBe(b.helpers[k]);
    expect(Object.keys(a.helpers)).toEqual(
      expect.arrayContaining(['CE_List_f32', 'S'])
    );
  });
});

describe('CE-571 compileFieldFunction: review of the integration', () => {
  const w = new WGSLTarget();

  test('a buffer declaration has one text only for one hint: two bindings differ', () => {
    const ce = engine();
    ce.declare('S', 'list<real>');
    const fa = w.compileFieldFunction(ce.box(['Add', ['At', 'S', 1], 'x']), {
      name: 'fa',
      coordinates: XYZ,
      storage: { S: { kind: 'storage-buffer', group: 1, binding: 0 } },
    });
    const fb = w.compileFieldFunction(ce.box(['Add', ['At', 'S', 1], 'y']), {
      name: 'fb',
      coordinates: XYZ,
      storage: { S: { kind: 'storage-buffer', group: 1, binding: 5 } },
    });
    expect(fa.success && fb.success).toBe(true);
    // The struct has one text; the declaration of the buffer does not: the
    // hints disagree, which a host that merges the fields treats as an error.
    expect(fa.helpers.CE_List_f32).toBe(fb.helpers.CE_List_f32);
    expect(fa.helpers.S).toContain('@binding(0)');
    expect(fb.helpers.S).toContain('@binding(5)');
    expect(fa.helpers.S).not.toBe(fb.helpers.S);
  });

  test('a declared name that starts with CE_List_ is refused', () => {
    const ce = engine();
    const e = ce.parse('x + y');
    for (const option of ['name', 'paramsStruct', 'paramsVariable'])
      expect(() =>
        w.compileFieldFunction(e, {
          name: 'f',
          coordinates: XYZ,
          [option]: 'CE_List_f32',
        })
      ).toThrow(/starts with `CE_List_`/);
  });

  test('a storage buffer named like a predeclared WGSL name declines, in compile() too', () => {
    const ce = engine();
    ce.declare('S', 'list<real>');
    const e = ce.box(['Add', ['Length', 'S'], 'x']);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // `f32` is also a reserved word of the shader targets, which declines
    // first with its own message.
    for (const name of ['min', 'select', 'arrayLength']) {
      const r = compile(e, {
        to: 'wgsl',
        vars: { S: name },
        storage: { S: { kind: 'storage-buffer', group: 1, binding: 0 } },
      });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/predeclared function or type of WGSL/);
    }
    warn.mockRestore();
    // Another name compiles.
    const ok = compile(e, {
      to: 'wgsl',
      vars: { S: 'board' },
      storage: { S: { kind: 'storage-buffer', group: 1, binding: 0 } },
    });
    expect(ok.success).toBe(true);
  });

  test('a parameter struct above 65,536 bytes declines', () => {
    const ce = engine();
    const names = Array.from(
      { length: 17 },
      (_, i) => `L${String.fromCharCode(97 + i)}`
    );
    for (const n of names) ce.declare(n, 'list<number^1024>');
    const sum = (k: number) =>
      ce.box([
        'Add',
        'x',
        ...names.slice(0, k).map((n) => ['At', n, 1]),
      ] as never);
    const sixteen = w.compileFieldFunction(sum(16), {
      name: 'f',
      coordinates: XYZ,
    });
    expect(sixteen.success).toBe(true);
    expect(sixteen.paramsSize).toBe(65536);
    const seventeen = w.compileFieldFunction(sum(17), {
      name: 'f',
      coordinates: XYZ,
    });
    expect(seventeen.success).toBe(false);
    expect(seventeen.diagnostic?.message).toMatch(
      /69632 bytes, more than the 65536 bytes/
    );
    expect(seventeen.diagnostic?.message).toContain("kind: 'storage-buffer'");
  });

  test('the walks visit a shared node once: a 40-level DAG', () => {
    const ce = engine();
    ce.declare('B', 'boolean');
    ce.parse('h(t) := t + 1').evaluate();
    let e = ce.function('Add', [
      ce.symbol('x'),
      ce.function('If', [ce.symbol('B'), ce.number(1), ce.number(0)]),
      ce.function('h', [ce.symbol('x')]),
    ]);
    // Each level reads the previous node twice: the tree has 2^40 leaves.
    for (let i = 0; i < 40; i++)
      e = ce.function('Add', [e, ce.function('Sin', [e])]);
    // The boolean parameter declines after the walks that find the
    // parameters, the assignments and the captured coordinates, and before
    // the compilation.
    const start = performance.now();
    const r = w.compileFieldFunction(e, { name: 'f', coordinates: ['x'] });
    expect(performance.now() - start).toBeLessThan(2000);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toMatch(/"B" is a boolean/);
  });
});
