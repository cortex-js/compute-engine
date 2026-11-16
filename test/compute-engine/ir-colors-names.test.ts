/**
 * The colour lane of the profile `ir` (batch G9; README of
 * `src/compute-engine/compilation/ir/`, "The colour lane"): a name that
 * holds a colour, `Hsv` and `Hsl` on GLSL, and a user function whose result
 * is a colour.
 *
 * - JavaScript: each program against the interpreter (its colour read in
 *   the space of the compiled value), channel by channel, within 1e-12.
 * - GLSL: the shader runs in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`), and each channel agrees with the
 *   JavaScript value within single-float precision. Without the browser,
 *   these tests are skipped.
 * - Tycho's two function shapes, the declines and their causes, the
 *   shadowing cases, `symbolDeps`, and the three robustness tests.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Color = {
  space: string;
  c0: number;
  c1: number;
  c2: number;
  alpha: number | undefined;
};

const ce = new ComputeEngine();
for (const name of ['x', 'y', 'z']) ce.declare(name, 'real');
// A name declared with a colour value (the Desmos importer writes `Hsv`,
// the hue in degrees), and names assigned one.
ce.declare('Cv', { type: 'color', value: ce.box(['Hsv', 270, 0.4, 0.95]) });
ce.assign('Cr', ce.box(['Rgb', 0.2, 0.4, 0.6]));
ce.assign('Cl', ce.box(['Oklab', 0.6, 0.1, -0.05]));
// A value that declines (an alpha), and a value with a channel that is a
// name, which is that expression where the name is read.
ce.declare('Ca', {
  type: 'color',
  value: ce.box(['Hsv', 270, 0.4, 0.95, 0.5]),
});
ce.assign('Cs', ce.box(['Rgb', 'y', 0.4, 0.6]));
// A function whose body reads a colour name; its result type is inferred.
ce.assign(
  'g',
  ce.box([
    'Function',
    ['If', ['Less', 't', 0.5], 'Cv', ['Oklch', 't', 0.1, 250]],
    't',
  ])
);
// A parameter with the name of a colour name: the parameter is read.
ce.assign('hp', ce.box(['Function', ['Rgb', 'Cv', 0, 0], 'Cv']));
// The stand-ins of Tycho's `tone` and `channel`.
ce.assign('tone', ce.box(['Function', ['Power', 'z', 'q'], 'z', 'q']));
ce.assign(
  'channel',
  ce.box(['Function', ['Fract', ['Multiply', 'z', 'k', 0.37]], 'z', 'k'])
);
// Tycho's `shade: (z: real) -> color`.
ce.declare('shade', '(real) -> color');
ce.assign(
  'shade',
  ce.box([
    'Function',
    [
      'Block',
      [
        'Typed',
        ['Rgb', ['channel', 'z', 1], ['channel', 'z', 2], ['channel', 'z', 3]],
        { str: 'color' },
      ],
    ],
    ['Typed', 'z', { str: 'real' }],
  ])
);
// Tycho's `c: (H: list<integer>, x, y, z) -> color` (on GLSL, `H` takes the
// stated length of its argument), and the same body with a list of a stated
// length.
const TYCHO_C = [
  'Function',
  [
    'Block',
    [
      'Typed',
      [
        'If',
        ['Greater', 'x', 0],
        [
          'Block',
          ['Declare', 'i', { str: 'integer' }, ['At', 'H', 1]],
          ['Declare', 'n', { str: 'integer' }, ['Length', 'H']],
          [
            'Rgb',
            ['tone', 'z', 0.1],
            ['tone', 'z', ['Divide', 'i', 'n']],
            ['tone', 'y', 0.5],
          ],
        ],
        ['Block', ['Rgb', 0.1, 0.16, 0.33]],
      ],
      { str: 'color' },
    ],
  ],
  'H',
  'x',
  'y',
  'z',
];
ce.declare('c', '(list<integer>, real, real, real) -> color');
ce.assign('c', ce.box(TYCHO_C as never));
ce.declare('c3', '(list<integer^3>, real, real, real) -> color');
ce.assign('c3', ce.box(TYCHO_C as never));
// A conversion in the body of a function.
ce.assign(
  'fz',
  ce.box(['Function', ['AsOklab', ['Oklch', 't', 0.1, 250]], 't'])
);
// A colour parameter.
ce.declare('fk', '(color) -> color');
ce.assign('fk', ce.box(['Function', 'q', 'q']));

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

const AS: Record<string, string> = {
  oklch: 'AsOklch',
  oklab: 'AsOklab',
  rgb: 'AsRgb',
  hsl: 'AsHsl',
  hsv: 'AsHsv',
};

/** The channels of the interpreter's colour of `expr` at `point`, read in
 *  the space `space`. */
function interpreted(expr: Expression, point: object, space: string): number[] {
  const value = expr.subs(point as never).evaluate();
  const read = expr.engine.box([AS[space], value.json] as never).evaluate();
  if (!isFunction(read)) throw new Error(`not a colour: ${read}`);
  return read.ops.slice(0, 3).map((op) => op.re);
}

const near = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

/** The space of the colour that `expr` gives: the space that a conversion
 *  at its result position (the root, or the last operand of a root `Block`)
 *  names, otherwise OKLCh (the lane's space of a constructor). */
function spaceOf(expr: Expression): string {
  const result =
    isFunction(expr) && expr.operator === 'Block' ? expr.ops.at(-1)! : expr;
  const head = isFunction(result) ? result.operator : '';
  const space = Object.keys(AS).find((s) => AS[s] === head);
  return space ?? 'oklch';
}

/** The compiled colour of `r` at each point against the interpreter, in
 *  the space that the program names. */
function againstInterpreter(
  r: ReturnType<typeof js>,
  expr: Expression,
  points: object[]
) {
  for (const p of points) {
    const v = r.run!(p as never) as unknown as Color;
    expect(Object.keys(v)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
    expect(v.space).toBe(spaceOf(expr));
    const got = [v.c0, v.c1, v.c2];
    const want = interpreted(expr, p, v.space);
    want.forEach((x, k) => {
      if (!near(got[k], x, 1e-12))
        throw new Error(`${JSON.stringify(p)}: ${got} vs ${want}`);
    });
  }
}

const HUES = [0, 60, 137, 359.5, 360, 400, -30];
// Channels that the interpreter clamps into [0, 1]: a saturation, a value or
// a lightness outside it.
const CLAMPED = [
  { x: 200, y: 1.5, z: 0.4 },
  { x: 200, y: 0.5, z: 1.4 },
  { x: 30, y: -0.2, z: 0.6 },
  { x: 300, y: 0.7, z: -0.3 },
];

// Programs that compile on both targets.
// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: object[]][] = [
  ['a declared Hsv name at the root', ['AsOklab', 'Cv'], [{}]],
  ['an assigned Rgb name at the root', ['AsOklab', 'Cr'], [{}]],
  ['an assigned Oklab name at the root, in OKLCh', 'Cl', [{}]],
  ['a name as the result in sRGB', ['AsRgb', 'Cv'], [{}]],
  ['names in the arms of an If', ['AsOklab', ['If', ['Less', 'x', 0.5], 'Cv', 'Cr']], [{ x: 0.25 }, { x: 0.75 }]],
  ['names in a Which', ['AsOklab', ['Which', ['Less', 'x', 0], 'Cl', ['Less', 'x', 1], 'Cv', 'True', ['Rgb', 'x', 0, 0]]], [{ x: -1 }, { x: 0.5 }, { x: 1.5 }]],
  ['a name read in a function body (an inferred colour result)', ['AsOklab', ['g', 'x']], [{ x: 0.2 }, { x: 0.8 }]],
  ['a parameter that has the name of a colour name', ['AsOklab', ['hp', 'x']], [{ x: 0.2 }, { x: 0.9 }]],
  ['a local that has the name of a colour name', ['Block', ['Declare', 'Cv', { str: 'unknown' }, ['Oklch', 'x', 0.1, 250]], ['AsOklab', 'Cv']], [{ x: 0.2 }]],
  ["Tycho's shade", ['AsOklab', ['shade', 'x']], [{ x: 0.3 }, { x: 1.7 }, { x: -0.4 }]],
  ["Tycho's shade in sRGB", ['AsRgb', ['shade', 'x']], [{ x: 0.3 }, { x: 1.7 }]],
  ["Tycho's c, of a list of a stated length", ['AsOklab', ['c3', ['List', 1, 2, 3], 'x', 'y', 'z']], [{ x: 0.7, y: 0.3, z: 0.4 }, { x: -1, y: 0.3, z: 0.4 }]],
  ["Tycho's c, whose list parameter takes the length of its argument on GLSL", ['AsOklab', ['c', ['List', 1, 2, 3], 'x', 'y', 'z']], [{ x: 0.7, y: 0.3, z: 0.4 }, { x: -1, y: 0.3, z: 0.4 }]],
  ['Hsv of a product (Tycho)', ['AsOklab', ['Hsv', ['Multiply', 'x', 'y'], 1, 1]], [{ x: 3, y: 50 }, { x: -2, y: 17 }, { x: 10, y: 41 }]],
  ['Hsv of three inputs, in OKLCh', ['Hsv', 'x', 'y', 'z'], [{ x: 200, y: 0.3, z: 0.9 }]],
  ['Hsl of three inputs, in sRGB', ['AsRgb', ['Hsl', 'x', 'y', 'z']], [{ x: 200, y: 0.3, z: 0.4 }, { x: -30, y: 1, z: 0.7 }]],
];

// Programs that compile on JavaScript only, with the cause on GLSL.
// prettier-ignore
const JS_ONLY: [label: string, json: Json, points: object[], glsl: RegExp][] = [
  ['a conversion in a function body', ['AsOklab', ['fz', 'x']], [{ x: 0.4 }], /AsOklab other than as the result/],
];

describe('IR profile, batch G9: colours on JavaScript', () => {
  test.each([...PROGRAMS, ...JS_ONLY].map(([l, j, p]) => [l, j, p] as const))(
    '%s: the interpreter',
    (_, json, points) => {
      const r = js(json);
      expect(r).toMatchObject({ success: true, profile: 'ir' });
      againstInterpreter(r, ce.box(json as never), points);
    }
  );

  test('Hsv and Hsl over a grid of hues', () => {
    for (const head of ['Hsv', 'Hsl']) {
      const json = ['AsRgb', [head, 'x', 'y', 'z']];
      const points = HUES.flatMap((x) =>
        [0.25, 1].flatMap((y) => [0.5, 1].map((z) => ({ x, y, z })))
      ).concat(CLAMPED);
      againstInterpreter(js(json), ce.box(json as never), points);
    }
  });

  test('symbolDeps names each colour name and function', () => {
    const cases: [Json, string[]][] = [
      [
        ['AsOklab', ['If', ['Less', 'x', 0.5], 'Cv', 'Cr']],
        ['Cr', 'Cv'],
      ],
      [
        ['AsOklab', ['g', 'x']],
        ['Cv', 'g'],
      ],
      [['AsOklab', ['hp', 'x']], ['hp']],
      [
        ['AsOklab', ['shade', 'x']],
        ['channel', 'shade'],
      ],
    ];
    for (const [json, names] of cases)
      for (const to of ['javascript', 'glsl'] as const) {
        const symbolDeps = new Set<string>();
        compile(ce.box(json as never), { ...IR, to, symbolDeps });
        expect([...symbolDeps].sort()).toEqual(names);
      }
  });

  test('the value is read at the compilation, as for a number', () => {
    const e = new ComputeEngine();
    e.assign('Cw', e.box(['Rgb', 0.1, 0.2, 0.3]));
    const r = compile(e.box(['AsOklab', 'Cw']), IR);
    e.assign('Cw', e.box(['Rgb', 0.9, 0.2, 0.3]));
    expect((r.run!({} as never) as unknown as Color).c0).toBeLessThan(0.4);
  });
});

describe('IR profile, batch G9: a colour name of a popped scope', () => {
  test('compile() reads the scope of the boxing; a direct compilation in the outer scope declines', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.pushScope();
    e.declare('Cp', { type: 'color', value: e.box(['Rgb', 0.1, 0.2, 0.3]) });
    e.assign(
      'fp',
      e.box([
        'Function',
        ['If', ['Less', 's', 0], 'Cp', ['Rgb', 's', 0, 0]],
        's',
      ])
    );
    const inBody = e.box(['AsOklab', ['fp', 'x']]);
    const atRoot = e.box(['AsOklab', 'Cp']);
    e.popScope();
    for (const expr of [inBody, atRoot]) {
      againstInterpreter(compile(expr, IR), expr, [{ x: -1 }, { x: 0.5 }]);
      expect(compile(expr, { ...IR, to: 'glsl' }).success).toBe(true);
    }
    for (const target of ['javascript', 'glsl'] as const) {
      expect(() => compileSlice(inBody, { target })).toThrow(
        /the function fp reads Cp, which is not a parameter/
      );
      expect(() => compileSlice(atRoot, { target })).toThrow(
        /the input Cp of type color/
      );
    }
  });
});

//
// GLSL
//

describe('IR profile, batch G9: colours on GLSL, the text', () => {
  test.each(PROGRAMS.map(([l, j]) => [l, j] as const))('%s', (_, json) => {
    const r = glsl(json);
    expect(r).toMatchObject({ success: true, profile: 'ir', unsupported: [] });
    const defined = [
      ...(r.preamble ?? '').matchAll(/^(?:float|bool|vec3) (\w+)\(/gm),
    ].map((m) => m[1]);
    for (const name of defined) expect(name).toMatch(/^(_gpu_ir_|_fn_ir_)/);
  });

  test("a colour function's result is a vec3, and Hsv a helper", () => {
    expect(glsl(['AsOklab', ['shade', 'x']]).preamble).toMatch(
      /^vec3 _fn_ir_u\d+_shade\(float v\d+\) \{$/m
    );
    const r = glsl(['AsOklab', ['Hsv', ['Multiply', 'x', 'y'], 1, 1]]);
    expect(r.code).toBe(
      '_gpu_ir_lab(_gpu_ir_lch(_gpu_ir_srgb_lab(_gpu_ir_hsv(vec3((x * y), 1.0, 1.0)))))'
    );
  });

  test("Tycho's c of an input list of a stated length takes that length", () => {
    for (const storage of [undefined, { H: 'sampler2D' }]) {
      const r = glsl(['AsOklab', ['c', 'H', 'x', 'y', 'z']], {
        inputs: { H: 'list<integer^5>' },
        ...(storage ? { storage } : {}),
      });
      expect(r.preamble).toMatch(
        storage
          ? /^vec3 _fn_ir_u\d+_c\(sampler2D v\d+, float/m
          : /^vec3 _fn_ir_u\d+_c\(float v\d+\[5\], float/m
      );
    }
  });

  test.each(JS_ONLY.map(([l, j, , cause]) => [l, j, cause] as const))(
    '%s declines',
    (_, json, cause) => {
      const d = failure(() => glsl(json));
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(cause);
    }
  );
});

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** The fragment shader of a host that reads the channel `k` of the colour. */
function shader(r: ReturnType<typeof glsl>, k: number): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map((n) => `uniform ${type(n)} u_${n};`),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `vec3 userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map((n) => `u_${n}`).join(', ')})[${k}], 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G9: colours on GLSL, the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test("each channel of the profile's shader agrees with the JavaScript value within single-float precision", async () => {
      const grid = HUES.flatMap((x) =>
        [0.25, 0.6, 1].flatMap((y) => [0.3, 1].map((z) => ({ x, y, z })))
      );
      const programs: [string, Json, object[]][] = [
        ...PROGRAMS,
        [
          'Hsv over a grid, in OKLab',
          ['AsOklab', ['Hsv', 'x', 'y', 'z']],
          grid,
        ],
        ['Hsv over a grid, in sRGB', ['AsRgb', ['Hsv', 'x', 'y', 'z']], grid],
        ['Hsl over a grid, in sRGB', ['AsRgb', ['Hsl', 'x', 'y', 'z']], grid],
        [
          'Hsv of clamped channels, in OKLab',
          ['AsOklab', ['Hsv', 'x', 'y', 'z']],
          CLAMPED,
        ],
        [
          'Hsl of clamped channels, in OKLab',
          ['AsOklab', ['Hsl', 'x', 'y', 'z']],
          CLAMPED,
        ],
      ];
      const items = programs.flatMap(([label, json, points]) => {
        const f = js(json);
        const r = glsl(json);
        return points.flatMap((p) => {
          const v = f.run!(p as never) as unknown as Color;
          return [v.c0, v.c1, v.c2].map((expected, k) => ({
            name: `${label} at ${JSON.stringify(p)}, channel ${k}`,
            source: shader(r, k),
            uniforms: Object.fromEntries(
              r.freeSymbols!.map((n) => [
                `u_${n}`,
                (p as Record<string, number>)[n],
              ])
            ),
            expected,
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        // `AsRgb` goes through OKLab and back, which loses up to 5e-4 in
        // float32 (ir-colors.test.ts); a hue is in degrees.
        const tolerance = /sRGB/.test(name) ? 1e-3 : 1e-4;
        const scale =
          /in OKLCh/.test(name) && name.endsWith('channel 2') ? 360 : 1;
        if (
          !(
            Math.abs(v.value - expected) <=
            tolerance * Math.max(scale, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(300);
    }, 180_000);
  }
);

//
// Declines
//

// prettier-ignore
const DECLINES: [label: string, json: Json, cause: RegExp][] = [
  ['a colour name with an alpha', ['AsOklab', 'Ca'], /Hsv with 4 operands/],
  ['a colour parameter', ['AsOklab', ['fk', ['Rgb', 'x', 0, 0]]], /the parameter q of fk is not a scalar \(color\)/],
  ['a list of colour names', ['List', 'Cv', 'Cr'], /a list of colours/],
];

describe('IR profile, batch G9: the declines', () => {
  test.each(DECLINES)('%s', (_, json, cause) => {
    for (const to of ['javascript', 'glsl'] as const) {
      const d = failure(() => compile(ce.box(json as never), { ...IR, to }));
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(cause);
    }
  });

  test('a colour name of another value declines with the cause', () => {
    const e = new ComputeEngine();
    e.declare('Cm', {
      type: 'color',
      value: e.box(['ColorMix', ['Rgb', 1, 0, 0], ['Rgb', 0, 0, 1], 0.5]),
    });
    for (const to of ['javascript', 'glsl'] as const) {
      const d = failure(() => compile(e.box(['AsOklab', 'Cm']), { ...IR, to }));
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(/the operator ColorMix is not in the slice/);
    }
  });

  test('a colour name whose channel is a name is its expression', () => {
    for (const to of ['javascript', 'glsl'] as const)
      expect(compile(ce.box(['AsOklab', 'Cs']), { ...IR, to }).success).toBe(
        true
      );
    const run = (json: Json) =>
      compile(ce.box(json as never), { ...IR, fallback: false }).run!({
        y: 0.3,
      } as never);
    expect(run(['AsOklab', 'Cs'])).toEqual(
      run(['AsOklab', ['Rgb', 'y', 0.4, 0.6]])
    );
  });
});

//
// Robustness
//

describe('IR profile, batch G9: robustness', () => {
  const x = ce.box('x');

  test('a shared graph of 2^20 paths through a colour function and a colour name, on both targets', () => {
    let e: Expression = x;
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [e, ce.function('Sin', [e])]);
    const color = ce.function('AsOklab', [
      ce.function('If', [
        ce.function('Greater', [e, ce.number(0)]),
        ce.function('shade', [e]),
        ce.box('Cv'),
      ]),
    ]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(color, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(20_000);
      // A guard against a walk by paths (a hang), not a measure.
      expect(performance.now() - start).toBeLessThan(30_000);
    }
  });

  test('a chain of 1,000 conditionals between colour names and calls, and a chain of 1,000 operations in an argument', () => {
    const clauses: Expression[] = [];
    let chain: Expression = x;
    for (let i = 0; i < 1_000; i++) {
      clauses.push(
        ce.function('Greater', [x, ce.number(i)]),
        i % 2 === 0
          ? ce.box('Cv')
          : ce.function('shade', [ce.function('Add', [x, ce.number(i)])])
      );
      chain = ce.function('Sin', [chain]);
    }
    const which = ce.function('AsOklab', [
      ce.function('Which', [...clauses, ce.True, ce.box('Cr')]),
    ]);
    const deep = ce.function('AsOklab', [ce.function('shade', [chain])]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(which, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(1_000_000);
      expect(performance.now() - start).toBeLessThan(30_000);
      if (to === 'javascript')
        againstInterpreter(r, which, [{ x: -1 }, { x: 0.5 }, { x: 1.5 }]);
      // The chain is near the depth at which a walk exceeds the call
      // stack, which depends on the host: it compiles or declines.
      let d: ReturnType<typeof failure>;
      const t0 = performance.now();
      d = failure(() => compile(deep, { ...IR, to }));
      if (d !== undefined) expect(d.message).toMatch(/too deep to compile/);
      expect(performance.now() - t0).toBeLessThan(30_000);
    }
  });

  test('a colour assigned in a nested loop from a colour function and a colour name', () => {
    const loop = (n: number) => [
      'Block',
      ['Declare', 'k', { str: 'unknown' }, 'Cv'],
      [
        'Loop',
        [
          'Assign',
          'k',
          [
            'If',
            ['Less', 'i', 'j'],
            ['shade', ['Divide', ['Multiply', 'i', 'x'], 'j']],
            'Cv',
          ],
        ],
        ['Element', 'i', ['Range', 1, n]],
        ['Element', 'j', ['Range', 1, n]],
      ],
      ['AsOklab', 'k'],
    ];
    const r = js(loop(10));
    againstInterpreter(r, ce.box(loop(10) as never), [{ x: 0.3 }]);
    expect(glsl(loop(10)).success).toBe(true);
    const d = failure(() => glsl(loop(200)));
    expect(d?.code).toBe('outside-profile');
    expect(d?.message).toMatch(/iterationBudget/);
    expect(js(loop(200)).run!({ x: 0.3 } as never)).toMatchObject({
      space: 'oklab',
    });
  });
});
