/**
 * A list parameter of a user function whose declared type states no length,
 * on a target without run-time lengths (GLSL; batch G10, README of
 * `src/compute-engine/compilation/ir/`, "User functions"): it takes the
 * stated length of the argument of the first call, and a call with another
 * length declines. On JavaScript the parameter keeps its hidden length.
 *
 * - Tycho's `c` (showcase `buddhabrot`), with its list in a sampler and as a
 *   uniform array: the shader runs in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`) and agrees with the profile's
 *   JavaScript value. Without the browser, these tests are skipped.
 * - The parameter passed on, two call sites, the arguments of each kind, a
 *   stated parameter length, recursion, JavaScript unchanged.
 * - The three robustness tests, through such a function.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';

type Json = unknown;
type Point = Record<string, number | number[]>;
type Color = { space: string; c0: number; c1: number; c2: number };

const ce = new ComputeEngine();
for (const name of ['x', 'y', 'z']) ce.declare(name, 'real');
ce.assign('tone', ce.box(['Function', ['Power', 'z', 'q'], 'z', 'q']));

/** Tycho's `c` over a grid of `w` by `h` cells, which reads a list of
 *  `3·w·h + 1` integers: the last one is the scale, then three channels.
 *  `corpus`: the locals in the form of Tycho's corpus (`Declare(i, {value,
 *  constant})`); otherwise declared `integer`. */
const tychoC = (w: number, h: number, corpus = true) => {
  const m = w * h;
  const local = (name: string, value: Json) =>
    corpus
      ? [
          'Declare',
          name,
          [
            'Dictionary',
            ['Tuple', "'value'", value],
            ['Tuple', "'constant'", 'True'],
          ],
        ]
      : ['Declare', name, { str: 'integer' }, value];
  const at = (lo: number, hi: number) => [
    'At',
    'H',
    ['Max', lo, ['Min', hi, ['Add', lo, 'i']]],
  ];
  // prettier-ignore
  return [
    'Function',
    ['Block', ['Typed', ['If',
      ['And', ['LessEqual', 0, 'x'], ['Less', 'x', w], ['LessEqual', 0, 'y'], ['Less', 'y', h]],
      ['Block',
        local('i', ['Add', ['Floor', 'x'], ['Multiply', w, ['Floor', 'y']]]),
        local('n', ['Add', ['At', 'H', 3 * m + 1], 1]),
        ['Rgb',
          ['tone', 'z', 0.1],
          ['tone', ['Divide', ['Multiply', 1700, at(m + 1, 2 * m)], 'n'], 0.16],
          ['tone', ['Divide', ['Multiply', 3600, at(2 * m + 1, 3 * m)], 'n'], 0.33]]],
      ['Block', ['Rgb', 0.1, 0.16, 0.33]]], { str: 'color' }]],
    'H', 'x', 'y', 'z',
  ];
};
// The signature of Tycho's corpus.
const C_TYPE = '(H: list<integer>, x: real, y: real, z: real) -> color';
ce.declare('c', C_TYPE);
ce.assign('c', ce.box(tychoC(150, 200) as never));
ce.declare('c10', C_TYPE);
ce.assign('c10', ce.box(tychoC(3, 1) as never));
ce.declare('c10t', '(list<integer>, real, real, real) -> color');
ce.assign('c10t', ce.box(tychoC(3, 1, false) as never));
ce.declare('H_1', 'list<integer^90001>');
ce.declare('H10', 'list<integer^10>');
ce.declare('H7', 'list<integer^7>');
ce.declare('H3', 'list<integer^3>');

// A list parameter passed on to another function of a list parameter.
ce.declare('d', '(list<integer>, integer) -> real');
ce.assign('d', ce.box(['Function', ['At', 'H', 'k'], 'H', 'k']));
ce.declare('c2', '(list<integer>, real) -> real');
ce.assign(
  'c2',
  ce.box([
    'Function',
    ['Add', ['d', 'H', 2], ['Multiply', ['d', 'H', ['Length', 'H']], 't']],
    'H',
    't',
  ])
);

// A function of a list of reals, and one of a stated length.
ce.declare('f', '(list<real>) -> real');
ce.assign(
  'f',
  ce.box([
    'Function',
    ['Add', ['At', 'L', 1], ['Multiply', ['Length', 'L'], ['At', 'L', -1]]],
    'L',
  ])
);
ce.declare('f3', '(list<real^3>) -> real');
ce.assign('f3', ce.box(['Function', ['Sum', 'L'], 'L']));
ce.declare('A', 'list<real^3>');
ce.declare('B', 'list<real^3>');
ce.declare('D4', 'list<real^4>');
ce.declare('R', 'list<real>');
ce.declare('pl', '(real) -> list<real^3>');
ce.assign(
  'pl',
  ce.box(['Function', ['List', 'a', ['Multiply', 2, 'a'], 3], 'a'])
);
// A recursive function of a list parameter.
ce.declare('rec', '(list<real>, integer) -> real');
ce.assign(
  'rec',
  ce.box([
    'Function',
    [
      'If',
      ['Less', 'k', 1],
      ['At', 'L', 1],
      ['Add', ['At', 'L', 'k'], ['rec', 'L', ['Subtract', 'k', 1]]],
    ],
    'L',
    'k',
  ])
);
// The function of the robustness tests.
ce.declare('g', '(list<integer>, real) -> real');
ce.assign(
  'g',
  ce.box([
    'Function',
    ['Add', ['Multiply', ['At', 'H', 1], 't'], ['At', 'H', -1]],
    'H',
    't',
  ])
);
ce.declare('k2', '(list<integer>, real) -> real');
ce.assign(
  'k2',
  ce.box(['Function', ['g', 'H', ['g', 'H', ['g', 'H', 't']]], 'H', 't'])
);

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl', ...options });

/** The diagnostic of a compilation that throws, or `undefined`. */
function failure(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

// The scale (the last element) keeps each channel in [0, 1]: far out of the
// gamut, the chroma is large, and the error of the software renderer's `sin`
// and `cos` in `_gpu_ir_lab` (up to 1.6e-4 relative) exceeds the tolerance.
const H_1 = Array.from({ length: 90_001 }, (_, k) =>
  k === 90_000 ? 35_999 : (k * 37) % 10
);
const H10 = [5, 1, 2, 3, 4, 5, 6, 7, 8, 35_999];
const H7 = [3, 1, 4, 1, 5, 9, 2];
/** `g(G10, g(G10, g(G10, 0.5)))` is 25. */
const G10 = [2, 1, 2, 3, 4, 5, 6, 7, 8, 3];
const STORAGE = { storage: { H_1: 'sampler2D' } } as const;

// prettier-ignore
const WITNESS_POINTS: Point[] = [
  { x: 0.5, y: 0.5, z: 0.4 }, { x: 149.9, y: 199.9, z: 0.7 },
  { x: 75.2, y: 100.7, z: 0.2 }, { x: -1, y: 3, z: 0.4 }, { x: 150, y: 0, z: 0.4 },
];
// prettier-ignore
const SMALL_POINTS: Point[] = [
  { x: 0.5, y: 0.5, z: 0.4 }, { x: 2.9, y: 0.2, z: 0.7 }, { x: 1.5, y: 0.5, z: 0.3 },
  { x: 3, y: 0.5, z: 0.4 }, { x: 1, y: -0.5, z: 0.4 },
];

// Programs that compile on both targets, with the points of their values.
// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: Point[]][] = [
  ['the witness at a length of 10', ['AsOklab', ['c10', 'H10', 'x', 'y', 'z']], SMALL_POINTS.map((p) => ({ ...p, H10 }))],
  ['the witness with typed locals', ['AsOklab', ['c10t', 'H10', 'x', 'y', 'z']], SMALL_POINTS.map((p) => ({ ...p, H10 }))],
  ['g of a call of g of a call of g', ['g', 'H10', ['g', 'H10', ['g', 'H10', 'x']]], [{ H10: G10, x: 0.5 }, { H10: G10, x: -3 }]],
  ['the same in a function body', ['k2', 'H10', 'x'], [{ H10: G10, x: 0.5 }]],
  ['the parameter passed on to d', ['c2', 'H10', 'x'], [{ H10, x: 0.5 }, { H10, x: -2 }]],
  ['two calls of f of one length', ['Add', ['f', 'A'], ['f', 'B']], [{ A: [1, 2, 3], B: [-1, 0.5, 4] }]],
  ['a literal list', ['f', ['List', 'x', 2, 3, 5]], [{ x: 0.5 }]],
  ['a local list', ['Block', ['Declare', 'M', { str: 'unknown' }, ['List', 'x', 'y', 3]], ['f', 'M']], [{ x: 0.5, y: 2 }]],
  ['the list result of another function', ['f', ['pl', 'x']], [{ x: 1.25 }]],
  ['a parameter of a stated length', ['f3', 'A'], [{ A: [1, 2, 3.5] }]],
];

/** The interpreter's value of `json` at `point`: a number, or the channels
 *  of a colour in OKLab. */
function interpreted(json: Json, point: Point): number[] {
  const subs = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v) ? ce.box(['List', ...v]) : ce.number(v),
    ])
  );
  const value = ce
    .box(json as never)
    .subs(subs)
    .evaluate();
  const j = value.json;
  return Array.isArray(j) ? (j.slice(1, 4) as number[]) : [value.re];
}

/** The profile's JavaScript value: a number, or the channels of a colour. */
function jsValue(r: ReturnType<typeof js>, point: Point): number[] {
  const v = r.run!(point as never) as unknown as number | Color;
  return typeof v === 'number' ? [v] : [v.c0, v.c1, v.c2];
}

describe('IR profile, batch G10: a list parameter that takes the length of its argument', () => {
  test.each(PROGRAMS)(
    '%s: JavaScript against the interpreter',
    (_, json, points) => {
      const r = js(json);
      expect(r).toMatchObject({ success: true, profile: 'ir' });
      for (const p of points) {
        const got = jsValue(r, p);
        interpreted(json, p).forEach((want, k) =>
          expect(got[k]).toBeCloseTo(want, 10)
        );
      }
    }
  );

  test.each(PROGRAMS.map(([l, j]) => [l, j] as const))(
    '%s: GLSL compiles',
    (_, json) => {
      expect(glsl(json)).toMatchObject({
        success: true,
        profile: 'ir',
        unsupported: [],
      });
    }
  );

  test("Tycho's c on GLSL: a sampler2D parameter with storage, an array of the stated length without", () => {
    const json = ['AsOklab', ['c', 'H_1', 'x', 'y', 'z']];
    expect(glsl(json, STORAGE).preamble).toMatch(
      /^vec3 _fn_ir_u\d+_c\(sampler2D v\d+, float v\d+, float v\d+, float v\d+\) \{$/m
    );
    expect(glsl(['AsOklab', ['c10', 'H10', 'x', 'y', 'z']]).preamble).toMatch(
      /^vec3 _fn_ir_u\d+_c10\(float v\d+\[10\], float/m
    );
    // The index 90001 is within the stated length.
    expect(js(json).success).toBe(true);
  });

  test('d, reached from c2, takes the length of the parameter of c2, in storage too', () => {
    const r = glsl(['c2', 'H10', 'x'], { storage: { H10: 'sampler2D' } });
    expect(r.preamble).toMatch(/^float _fn_ir_u\d+_d\(sampler2D v\d+, float/m);
    expect(r.preamble).toMatch(/^float _fn_ir_u\d+_c2\(sampler2D v\d+, float/m);
  });

  test('one function per binding: two calls of one length share it', () => {
    const r = glsl(['Add', ['f', 'A'], ['f', 'B']]);
    expect(r.preamble!.match(/^float _fn_ir_\w+_f\(/gm)).toHaveLength(1);
  });

  test('a first call in an argument of a call of the same function: one definition', () => {
    const nested = ['g', 'H10', ['g', 'H10', ['g', 'H10', 'x']]];
    for (const json of [nested, ['k2', 'H10', 'x']]) {
      const r = glsl(json);
      expect(r.preamble!.match(/^float _fn_ir_\w+_g\(/gm)).toHaveLength(1);
    }
  });

  // prettier-ignore
  test.each([
    ['f of two lengths', ['Add', ['f', 'A'], ['f', 'D4']], /"D4": an argument of f of another length than at its first call: the list parameter L has the length 3 of that call \(list<real\^4> here/],
    ['f of a stated length, then of a literal of another', ['Add', ['f', 'A'], ['f', ['List', 1, 2]]], /the list parameter L has the length 3/],
    ['d of two lengths, one through c2', ['Add', ['c2', 'H10', 'x'], ['d', 'H7', 1]], /an argument of d of another length than at its first call: the list parameter H has the length (7|10)/],
    ['f of an input of no stated length', ['f', 'R'], /the list R has a run-time length/],
    ['f of a stated length, then of no stated length', ['Add', ['f', 'A'], ['f', 'R']], /the list parameter L has the length 3 of that call/],
    ['a parameter of a stated length, a list of another', ['f3', 'D4'], /a sub-expression of the static type error/],
    ['a recursive function', ['rec', 'A', 2], /a recursive function \(u0_rec\)/],
    ['g of two lengths', ['Add', ['g', 'H10', 'x'], ['g', 'H7', 'x']], /an argument of g of another length than at its first call: the list parameter H has the length (7|10)/],
    ['g of a call of g of another length', ['g', 'H10', ['g', 'H7', 'x']], /"H10": an argument of g of another length than at its first call: the list parameter H has the length 7/],
    ['g of three lengths, nested', ['g', 'H10', ['g', 'H7', ['g', 'H3', 'x']]], /"H7": an argument of g of another length than at its first call: the list parameter H has the length 3/],
    ['f of a stated length, then of no stated length: the message', ['Add', ['f', 'A'], ['f', 'R']], /\(a list of no stated length here;/],
  ])('GLSL declines %s, with the cause', (_, json, cause) => {
    const d = failure(() => glsl(json));
    // A sub-expression of the static type error has the code of the
    // existing compiler.
    expect(d?.code).toBe(
      /static type error/.test(cause.source)
        ? 'static-type-error'
        : 'outside-profile'
    );
    expect(d?.message).toMatch(cause);
  });

  test('on JavaScript a list parameter keeps one function with a hidden length', () => {
    const json = ['Add', ['f', 'D4'], ['f', ['List', 1, 2]], ['f', 'R']];
    const r = js(json);
    expect(r.preamble!.match(/^const u\d+_f = \(/gm)).toHaveLength(1);
    const point = { D4: [1, 2, 3, 4], R: [7] };
    expect(r.run!(point as never)).toBeCloseTo(interpreted(json, point)[0], 12);
    const rec = js(['rec', 'R', 3]);
    expect(rec.run!({ R: [1, 2, 4] } as never)).toBe(4 + 2 + 1 + 1);
  });
});

//
// Robustness
//

describe('IR profile, batch G10: robustness through a function of such a parameter', () => {
  const x = ce.box('x');
  const H = ce.box('H10');
  const g = (t: Expression) => ce.function('g', [H, t]);

  test('a shared graph of 2^20 paths', () => {
    let e: Expression = g(x);
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [e, g(ce.function('Sin', [e]))]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(e, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(20_000);
      // A guard against a walk by paths (a hang), not a measure.
      expect(performance.now() - start).toBeLessThan(30_000);
    }
  });

  test('a chain of 1,000 operands and one of 1,000 nested calls', () => {
    const sum = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, i) =>
        g(ce.function('Add', [x, ce.number(i)]))
      )
    );
    let nested: Expression = x;
    for (let i = 0; i < 1_000; i++) nested = g(nested);
    const definitions = (r: ReturnType<typeof glsl>) =>
      (r.preamble ?? '').match(/^(?:float _fn_ir_\w+_g\(|const u\d+_g = )/gm)
        ?.length;
    for (const to of ['javascript', 'glsl'] as const) {
      // Hang guards, not measures.
      let start = performance.now();
      const r = compile(sum, { ...IR, to });
      expect(definitions(r)).toBe(1);
      expect(r.code.length).toBeLessThan(200_000);
      expect(performance.now() - start).toBeLessThan(30_000);
      // Near the depth at which a walk exceeds the call stack, which
      // depends on the host: it compiles, with one definition of g, or
      // declines.
      start = performance.now();
      let n: ReturnType<typeof glsl> | undefined;
      const d = failure(() => (n = compile(nested, { ...IR, to })));
      if (d !== undefined) expect(d.message).toMatch(/too deep to compile/);
      else expect(definitions(n!)).toBe(1);
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    expect(compile(sum, IR).run!({ H10, x: 0.5 } as never)).toBeCloseTo(
      Array.from({ length: 1_000 }, (_, i) => 5 * (0.5 + i) + 35_999).reduce(
        (a, b) => a + b
      ),
      6
    );
  });

  test('a nested loop', () => {
    const loop = (n: number) => [
      'Block',
      ['Declare', 'k', { str: 'real' }, 0],
      [
        'Loop',
        [
          'Assign',
          'k',
          ['Add', 'k', ['g', 'H10', ['Divide', ['Multiply', 'i', 'x'], 'j']]],
        ],
        ['Element', 'i', ['Range', 1, n]],
        ['Element', 'j', ['Range', 1, n]],
      ],
      'k',
    ];
    const r = js(loop(10));
    expect(r.run!({ H10, x: 0.3 } as never)).toBeCloseTo(
      interpreted(loop(10), { H10, x: 0.3 })[0],
      9
    );
    expect(glsl(loop(10)).success).toBe(true);
    const d = failure(() => glsl(loop(200)));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(/iterationBudget/);
  });
});

//
// WebGL2
//

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host that writes the component `k` of the
 *  result (a `vec3` for a colour): a `float` uniform per scalar input, a
 *  `float[n]` uniform per list (passed as a `vecN` for a list lowered to
 *  one: the driver sets `float` uniforms only), a `sampler2D` per name of
 *  `samplers`. */
function shader(
  r: ReturnType<typeof glsl>,
  k: number,
  colour: boolean,
  samplers: readonly string[]
): string {
  const inputs = r.freeSymbols!.filter((n) => !samplers.includes(n));
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const vec = (n: string) => Number(/^vec(\d)$/.exec(type(n))?.[1] ?? 0);
  const uniform = (n: string) => {
    const m = /^(\w+)\[(\d+)\]$/.exec(type(n));
    if (m) return `uniform ${m[1]} u_${n}[${m[2]}];`;
    return vec(n) > 0
      ? `uniform float u_${n}[${vec(n)}];`
      : `uniform ${type(n)} u_${n};`;
  };
  const arg = (n: string) =>
    vec(n) > 0
      ? `${type(n)}(${Array.from({ length: vec(n) }, (_, i) => `u_${n}[${i}]`).join(', ')})`
      : `u_${n}`;
  const param = (n: string) => {
    const m = /^(\w+)\[(\d+)\]$/.exec(type(n));
    return m ? `${m[1]} ${n}[${m[2]}]` : `${type(n)} ${n}`;
  };
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    ...samplers.map((n) => `uniform sampler2D ${n};`),
    ...inputs.map(uniform),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `${colour ? 'vec3' : 'float'} userFn(${inputs.map(param).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map(arg).join(', ')})${colour ? `[${k}]` : ''}, 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G10: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test("each shader agrees with the profile's JavaScript value within single-float precision", async () => {
      const programs: [string, Json, Point[], object, string[]][] = [
        ...PROGRAMS.map(
          ([l, j, p]) =>
            [l, j, p, {}, []] as [string, Json, Point[], object, string[]]
        ),
        [
          "Tycho's c with H_1 in a sampler",
          ['AsOklab', ['c', 'H_1', 'x', 'y', 'z']],
          WITNESS_POINTS.map((p) => ({ ...p, H_1 })),
          STORAGE,
          ['H_1'],
        ],
        [
          'c2 with H10 in a sampler',
          ['c2', 'H10', 'x'],
          [
            { H10, x: 0.5 },
            { H10, x: -2 },
          ],
          { storage: { H10: 'sampler2D' } },
          ['H10'],
        ],
        [
          'g of H7 in a sampler',
          ['g', 'H7', 'x'],
          [{ H7, x: 1.5 }],
          { storage: { H7: 'sampler2D' } },
          ['H7'],
        ],
      ];
      const items = programs.flatMap(
        ([label, json, points, options, samplers]) => {
          const f = js(json);
          const r = glsl(json, options);
          return points.flatMap((p) =>
            jsValue(f, p).map((expected, k, all) => ({
              name: `${label} at ${JSON.stringify(p, (_, v) => (Array.isArray(v) && v.length > 20 ? `[${v.length}]` : v))}, component ${k}`,
              source: shader(r, k, all.length === 3, samplers),
              uniforms: Object.fromEntries(
                Object.entries(p)
                  .filter(([n]) => !samplers.includes(n))
                  .map(([n, v]) => [`u_${n}`, v])
              ),
              textures: Object.fromEntries(
                samplers.map((n) => [
                  n,
                  { width: n === 'H_1' ? 300 : 3, values: p[n] as number[] },
                ])
              ),
              expected,
            }))
          );
        }
      );
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (
          !(
            Math.abs(v.value - expected) <=
            1e-4 * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(40);
    }, 180_000);
  }
);
