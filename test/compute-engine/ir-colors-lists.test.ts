/**
 * The colour lane of the profile `ir` (batch G24; README of
 * `src/compute-engine/compilation/ir/`, "The colour lane"): a colour
 * operation of constants is computed once on JavaScript, and a colour row
 * threads over a list operand.
 *
 * - JavaScript: each program against the interpreter (its colour read in
 *   the space of the compiled value), channel by channel, within 1e-12, and
 *   the shape of the result against the existing compiler.
 * - GLSL: the text, and three programs in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`), each channel within single-float
 *   precision of the JavaScript value. Without the browser, those tests are
 *   skipped.
 * - The interval mode has no colour: these programs decline there.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Color = { space: string; c0: number; c1: number; c2: number };
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
for (const name of ['x', 'y']) ce.declare(name, 'real');
ce.declare('D', 'list<real>');
ce.declare('L', 'list<real^3>');
// Colour names: of numbers, of constants that the engine computes, of an
// input, and of a list.
ce.declare('Cv', { type: 'color', value: ce.box(['Hsv', 270, 0.4, 0.95]) });
ce.assign('Cr', ce.box(['Rgb', 0.2, 0.4, 0.6]));
ce.assign('Ck', ce.box(['Rgb', ['Divide', 1, 3], 0.4, ['Sqrt', 0.3]]));
ce.assign('Cx', ce.box(['Rgb', 'x', 0.4, 0.5]));
ce.assign('Cl', ce.box(['Hsv', ['List', 10, 200, 300], 0.5, 0.5]));
// A function whose body reads a colour name, and one with a list result.
ce.assign(
  'gc',
  ce.box([
    'Function',
    ['If', ['Less', 't', 0.5], 'Cv', ['Oklch', 't', 0.1, 250]],
    't',
  ])
);
ce.assign('half', ce.box(['Function', ['Multiply', 0.5, 'u'], 'u']));
// Lists of colours read by an index that the passes make a constant.
ce.assign('NL', ce.box(['List', 3, 1, 2]));
// prettier-ignore
ce.assign('PAL', ce.box(['List', ['Hsv', 10, 0.5, 0.5], ['Rgb', 0.1, 0.2, 0.3], ['Oklch', 0.5, 0.1, 100]]));
ce.assign('P', ce.box(['List', 'Cv', 'Cr', ['Rgb', 'x', 0.4, 0.5]]));

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json) => compile(box(json), IR);
const glsl = (json: Json) => compile(box(json), { ...IR, to: 'glsl' });

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

const AS: Record<string, string> = {
  oklch: 'AsOklch',
  oklab: 'AsOklab',
  rgb: 'AsRgb',
};

/** The channels of the interpreter's colour `value`, read in `space`. */
function channels(value: Expression, space: string): number[] {
  const read = ce.box([AS[space], value.json] as never).evaluate();
  if (!isFunction(read)) throw new Error(`not a colour: ${read}`);
  return read.ops.slice(0, 3).map((op) => op.re);
}

/** The interpreter's value of `json` at `point`. */
function interpreted(json: Json, point: Point): Expression {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v) ? ce.box(['List', ...v]) : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () => {
    const v = box(json).evaluate();
    // A lazy collection (`Map` of an input).
    return isFunction(v) && v.operator !== 'List' && v.isCollection
      ? ce.function('ListFrom', [v]).evaluate()
      : v;
  });
}

const near = (a: number, b: number, tolerance: number) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b));

/** The compiled value `got` (a colour or a list of them) against the
 *  interpreter's value `want`, channel by channel, within 1e-12. */
function agree(got: unknown, want: Expression): void {
  if (Array.isArray(got)) {
    expect(isFunction(want, 'List')).toBe(true);
    const ops = (want as Expression & { ops: Expression[] }).ops;
    expect(got.length).toBe(ops.length);
    got.forEach((g, k) => agree(g, ops[k]));
    return;
  }
  const c = got as Color;
  expect(Object.keys(c)).toEqual(['space', 'c0', 'c1', 'c2', 'alpha']);
  const w = channels(want, c.space);
  [c.c0, c.c1, c.c2].forEach((x, k) => {
    if (!near(x, w[k], 1e-12)) throw new Error(`${[c.c0, c.c1, c.c2]} vs ${w}`);
  });
}

/** `json` on JavaScript against the interpreter at each point. */
function check(json: Json, points: Point[]) {
  const r = js(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) agree(r.run!(p as never), interpreted(json, p));
  return r;
}

/** The shape of a value: a number, or the keys of an object, or the
 *  shapes of the elements of an array. */
const shape = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(shape)
    : typeof v === 'object' && v !== null
      ? Object.keys(v)
      : typeof v;

//
// A colour of constants is computed once
//

describe('IR profile, batch G24: a colour of constants is computed once', () => {
  /** The per-call code calls no colour member of `_SYS`. */
  const once = (r: ReturnType<typeof js>) => {
    expect(r.code).not.toMatch(/_SYS\.(as)?(rgb|hsv|hsl|oklab|oklch)\(/i);
    return r;
  };

  test('a name of constants: the conversion is in the preamble', () => {
    const r = once(check(['AsOklab', 'Cv'], [{}]));
    expect(r.preambleOnce).toMatch(/= _SYS\.hsv\(270, 0\.4, 0\.95\);/);
    expect(r.preambleOnce).toMatch(/= _SYS\.asOklab\(v\d+\);/);
    // Every call shares the object (results are read-only).
    expect(r.run!({} as never)).toBe(r.run!({} as never));
    // A name whose channels the engine computes.
    once(check(['AsOklab', 'Ck'], [{}]));
  });

  test('a name read twice in one program, and in two programs', () => {
    const r = once(check(['List', ['AsOklab', 'Cv'], ['AsRgb', 'Cv']], [{}]));
    expect(r.preambleOnce).toMatch(/_SYS\.asRgb\(/);
    for (const json of [
      ['AsRgb', 'Cv'],
      ['AsOklch', 'Cr'],
    ])
      once(check(json, [{}]));
  });

  test('a name whose value reads an input is computed at each call', () => {
    const r = check(['AsOklab', 'Cx'], [{ x: 0.1 }, { x: 0.7 }]);
    expect(r.code).toMatch(/_SYS\.asOklab\(_SYS\.rgb\(_\.x, 0\.4, 0\.5\)\)/);
    expect(r.preambleOnce ?? '').toBe('');
    const [a, b] = [0.1, 0.7].map((x) => r.run!({ x } as never) as Color);
    expect(a.c0).not.toBe(b.c0);
  });

  test('a colour with a draw is computed at each call, in the seeded order', () => {
    // prettier-ignore
    const json = ['WithRandomSeed', 7, ['List', ['AsOklab', ['Hsv', ['Multiply', 360, ['Random']], 0.5, 0.5]], ['Hsv', ['Multiply', 360, ['Random']], 0.5, 0.5]]];
    const r = check(json, [{}]);
    expect(r.code).toMatch(/_SYS\.hsv\(/);
    expect(r.preambleOnce ?? '').not.toMatch(/_SYS\.hsv\(/);
    const [p, q] = r.run!({} as never) as Color[];
    expect([p.space, q.space]).toEqual(['oklab', 'oklch']);
    // Two draws: two hues.
    expect(r.code.match(/_SYS\.drawNextRandomNumber\(\)/g)).toHaveLength(2);
  });

  test('a constant colour in an If arm, in a Map body and in a user function', () => {
    // An arm at the root.
    const arm = check(
      ['AsOklab', ['If', ['Less', 'x', 0.5], 'Cv', 'Cx']],
      [{ x: 0.2 }, { x: 0.8 }]
    );
    expect(arm.preambleOnce).toMatch(/_SYS\.hsv\(270, 0\.4, 0\.95\)/);
    expect(arm.code).not.toMatch(/_SYS\.hsv\(/);
    // A build body.
    const body = check(
      [
        'Map',
        [
          'Function',
          [
            'If',
            ['Less', 'k', 0.5],
            ['AsOklab', 'Cv'],
            ['AsOklab', ['Hsv', 0, 0, 'k']],
          ],
          'k',
        ],
        'D',
      ],
      [{ D: [0.1, 0.6, 0.3] }, { D: [] }]
    );
    expect(body.preambleOnce).toMatch(/_SYS\.hsv\(270, 0\.4, 0\.95\)/);
    expect(body.code).not.toMatch(/_SYS\.hsv\(270/);
    // The body of a user function: the constant is bound before it.
    const fn = check(['AsOklab', ['gc', 'x']], [{ x: 0.2 }, { x: 0.8 }]);
    const preamble = fn.preambleOnce!;
    expect(preamble.match(/_SYS\.hsv\(270/g)).toHaveLength(1);
    expect(preamble).toMatch(/^const v\d+ = _SYS\.hsv\(270, 0\.4, 0\.95\);$/m);
  });

  test('a Sum body cannot hold a colour', () => {
    expect(
      failure(() => js(['Sum', ['AsOklab', 'Cv'], ['Limits', 'k', 1, 3]]))
    ).toBeDefined();
  });

  test('GLSL writes the operation of constants in the shader text', () => {
    expect(glsl(['AsOklab', 'Cv']).code).toBe(
      '_gpu_ir_lab(_gpu_ir_lch(_gpu_ir_srgb_lab(_gpu_ir_hsv(vec3(270.0, 0.4, 0.95)))))'
    );
  });
});

//
// A colour row of a list
//

const D3: Point = { x: 0.3, D: [0.1, 0.45, 0.8] };
const POINTS: Point[] = [D3, { x: 0.6, D: [0.25] }, { x: 0.6, D: [] }];

/** For each constructor, its channels with one list operand at `k`. */
const HEADS = ['Hsv', 'Hsl', 'Rgb', 'Oklch', 'Oklab'];
const SCALARS = [0.3, 0.6, 0.2];
const ops = (list: Json, k = 0, other?: Json) =>
  SCALARS.map((s, j) =>
    j === k ? list : j === (k + 1) % 3 && other ? other : s
  );

describe('IR profile, batch G24: a colour constructor of a list (JavaScript)', () => {
  test.each(HEADS)(
    '%s of one list operand, of two, of a scalar and a list',
    (head) => {
      check([head, ...ops('D')], POINTS);
      check([head, ...ops('D', 1)], POINTS);
      check([head, ...ops('D', 0, ['Multiply', 0.5, 'D'])], POINTS);
      check([head, ...ops('D', 2, 'x')], POINTS);
    }
  );

  test.each(HEADS)('%s of lists of two stated lengths declines', (head) => {
    const json = [head, ['List', 0.1, 0.2], ['List', 0.3, 0.4, 0.5], 0.6];
    for (const f of [js, glsl])
      expect(failure(() => f(json))).toMatch(/lists of different lengths/);
  });

  test.each(HEADS)(
    '%s of a stated length, a Range, a Map and a user function',
    (head) => {
      check([head, ...ops('L')], [{ L: [0.1, 0.5, 0.9] }]);
      check(
        [head, ...ops(['Divide', ['Range', 1, 'x'], 10])],
        [{ x: 4 }, { x: 0 }]
      );
      check(
        [head, ...ops(['Map', ['Function', ['Power', 'k', 2], 'k'], 'D'])],
        POINTS
      );
      check([head, ...ops(['half', 'D'])], POINTS);
    }
  );

  test('the corpus shapes', () => {
    check(
      ['Hsv', 210, ['Multiply', ['Rational', 1, 40], ['Range', 1, 10]], 1],
      [{}]
    );
    // A grey has no hue: read in OKLab.
    check(['AsOklab', ['Hsv', 0, 0, ['Multiply', 0.8, 'D']]], POINTS);
    check(
      ['Hsv', ['Add', ['Multiply', 90, ['Sign', 'D']], 90], 0.1, ['Abs', 'D']],
      [{ D: [-0.5, 0.2, 0] }]
    );
    // A nested list: a list of lists of colours, as the interpreter maps it.
    check(
      [
        'AsOklab',
        ['Hsv', 0, 0, ['List', ['List', 0.1, 0.2], ['List', 0.3, 0.4]]],
      ],
      [{}]
    );
  });

  test('AsOklab of a list of colours, and of a name that holds one', () => {
    check(['AsOklab', ['Hsv', ...ops('D')]], POINTS);
    check(['AsRgb', ['Oklch', 0.6, 0.1, ['Multiply', 300, 'D']]], POINTS);
    const r = check(['AsOklab', 'Cl'], [{}]);
    // A list of constants: computed once.
    expect(r.code).not.toMatch(/_SYS\./);
  });

  test('the result read by At, Length and Sum', () => {
    check(['At', ['Hsv', ...ops('L')], 2], [{ L: [0.1, 0.5, 0.9] }]);
    check(
      ['AsOklab', ['At', ['Rgb', ...ops('L')], -1]],
      [{ L: [0.1, 0.5, 0.9] }]
    );
    // An index that can be out of range: the interpreter gives `Missing`.
    for (const json of [
      ['At', ['Hsv', ...ops('D')], 2],
      ['At', ['Hsv', ...ops('L')], 'x'],
      ['At', ['Hsv', ...ops('L')], 4],
    ])
      expect(failure(() => js(json))).toMatch(/of a list of colours/);
    const n = js(['Length', ['Rgb', ...ops('D')]]);
    expect(n.run!(D3 as never)).toBe(3);
    // The interpreter gives an `incompatible-type` error.
    expect(failure(() => js(['Sum', ['Hsv', ...ops('D')]]))).toMatch(
      /not a number/
    );
  });

  test('the shape of the result is that of the existing compiler', () => {
    for (const json of [
      ['Hsv', ...ops('D')],
      ['AsOklab', ['Rgb', ...ops('D', 2, 'D')]],
      ['List', 'Cv', 'Cr'],
      ['Hsv', 0, 0, ['List', ['List', 0.1, 0.2], ['List', 0.3, 0.4]]],
    ]) {
      const profile = js(json).run!(D3 as never);
      const existing = compile(box(json), { fallback: false }).run!(
        D3 as never
      );
      expect(shape(profile)).toEqual(shape(existing));
      expect(JSON.stringify(profile)).toBe(JSON.stringify(existing));
    }
  });

  test('a tuple operand declines', () => {
    expect(failure(() => js(['Hsv', ['Tuple', 1, 2], 0, 0.5]))).toMatch(
      /Hsv of a tuple/
    );
    // A conversion of a tuple of colours: an `incompatible-type` error of
    // the interpreter.
    for (const head of ['AsOklab', 'AsRgb', 'AsOklch', 'AsHsv'])
      for (const f of [js, glsl])
        expect(failure(() => f([head, ['Tuple', 'Cv', 'Cr']]))).toMatch(
          `${head} of a tuple: its value on a tuple is not its value on a list`
        );
    // prettier-ignore
    expect(failure(() => js(['AsOklab', ['List', ['Tuple', 'Cv', 'Cr'], ['Tuple', 'Cr', 'Cv']]]))).toMatch(/AsOklab of a tuple/);
  });
});

// An index that becomes a constant in range in the `fold` pass.
// prettier-ignore
const FOLDED: [label: string, json: Json][] = [
  ['an index read from a list', ['At', 'P', ['At', 'NL', 3]]],
  ['a palette of three constructors', ['At', 'PAL', ['At', 'NL', 3]]],
  ['a local index', ['Block', ['Declare', 'i', { str: 'unknown' }, ['At', 'NL', 3]], ['At', 'P', 'i']]],
  ['an index assigned twice', ['Block', ['Declare', 'j', { str: 'unknown' }, 1], ['Assign', 'j', ['Add', 'j', 1]], ['At', 'P', 'j']]],
  ['the Max of an index', ['At', 'P', ['Max', 1, ['At', 'NL', 2]]]],
];

describe('IR profile, batch G24: At of a list of colours', () => {
  test.each(FOLDED)('%s compiles on both targets', (_, json) => {
    check(json, [{ x: 0.3 }, { x: 0.9 }]);
    expect(glsl(json).success).toBe(true);
  });

  test('an index that is not a constant in range after the passes declines', () => {
    for (const json of [
      ['At', 'P', 'x'],
      ['At', 'P', 4],
      ['At', 'P', ['Add', ['At', 'NL', 1], 2]],
    ])
      for (const f of [js, glsl])
        // GLSL refuses the list of colours that the `at` reads first.
        expect(failure(() => f(json))).toMatch(/a list of colours/);
  });

  test('a constant index without the fold, and without the passes', () => {
    // The `fold` pass makes `At(P, 3)` an element. With `constantFold:
    // false` `scalarize` does, P being a short list ("Lists", the short
    // lists); with no pass (`compileSlice()`) the `at` stays, and declines.
    check(['At', 'P', 3], [{ x: 0.3 }]);
    const unfolded = compile(box(['At', 'P', 3]), {
      ...IR,
      constantFold: false,
    });
    for (const p of [{ x: 0.3 }, { x: -2 }])
      agree(unfolded.run!(p as never), interpreted(['At', 'P', 3], p));
    expect(() =>
      compileSlice(box(['At', 'P', 3]), {
        target: 'javascript',
        passes: false,
      })
    ).toThrow(/of a list of colours/);
  });
});

describe('IR profile, batch G24: a deadline while the code is loaded', () => {
  test('a cancellation, not an internal error', () => {
    const list = ['List', ...Array.from({ length: 3000 }, (_, k) => k / 10)];
    // prettier-ignore
    const json = ['If', ['Less', 'x', 0], ['Hsv', list, 0.5, 0.5], ['Hsv', list, 'x', 0.5]];
    const engine = ce as unknown as { _deadline: number | undefined };
    engine._deadline = Date.now() - 1000;
    let error: unknown;
    try {
      js(json);
    } catch (e) {
      error = e;
    } finally {
      engine._deadline = undefined;
    }
    expect((error as Error | undefined)?.name).toBe('CancellationError');
  });
});

describe('IR profile, batch G24: a colour of a list on GLSL and in the interval mode', () => {
  test('a list of colours declines on GLSL; an element of one compiles', () => {
    for (const json of [
      ['Hsv', ...ops('L')],
      ['List', 'Cv', 'Cr'],
    ])
      expect(failure(() => glsl(json))).toMatch(/a list of colours/);
    expect(failure(() => glsl(['AsOklab', ['Hsv', ...ops('L')]]))).toMatch(
      /AsOklab other than as the result/
    );
    expect(failure(() => glsl(['Hsv', ...ops('D')]))).toMatch(
      /run-time length/
    );
    expect(glsl(['At', ['Hsv', ...ops('L')], 2]).code).toBe(
      '_gpu_ir_lch(_gpu_ir_srgb_lab(_gpu_ir_hsv(vec3(L[int(1.0)], 0.6, 0.2))))'
    );
    // A conversion that is not the result position of the expression.
    expect(
      failure(() => glsl(['At', ['AsOklab', ['Hsv', ...ops('L')]], 2]))
    ).toMatch(/not the result position/);
  });

  test('the interval mode has no colour', () => {
    for (const json of [
      ['Hsv', ...ops('D')],
      ['AsOklab', 'Cv'],
      ['At', ['Hsv', ...ops('L')], 2],
    ])
      expect(
        failure(() => compile(box(json), { ...IR, to: 'interval-js' }))
      ).toMatch(/Hsv|Rgb/);
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

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G24: an element of a list of colours in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    // prettier-ignore
    const programs: [string, Json][] = [
      ['At of Hsv of a list, in OKLCh', ['At', ['Hsv', ['Multiply', 300, 'L'], 0.6, 0.7], 2]],
      ['AsOklab of At of Rgb of a list', ['AsOklab', ['At', ['Rgb', 'L', 'x', 0.2], 3]]],
      ['AsOklab of At of Oklab of two lists', ['AsOklab', ['At', ['Oklab', 'L', ['Multiply', 0.2, 'L'], -0.1], 1]]],
      // The JavaScript value is the interpreter's (`FOLDED` above).
      ...FOLDED.map(([label, json]): [string, Json] => [`${label}, in OKLCh`, json]),
    ];
    const points = [
      { x: 0.3, L: [0.1, 0.5, 0.9] },
      { x: 0.8, L: [0.7, 0.2, 0.4] },
    ];

    test.each(programs)(
      '%s agrees with JavaScript',
      async (label, json) => {
        const r = glsl(json);
        const f = js(json);
        const source = (k: number) =>
          [
            '#version 300 es',
            'precision highp float;',
            'precision highp int;',
            'uniform float u_x;',
            'uniform float u_L[3];',
            'out vec4 fragColor;',
            r.preamble ?? '',
            'vec3 userFn(float x, float L[3]) {',
            r.code.includes(';') ? r.code : `return ${r.code};`,
            '}',
            `void main() { fragColor = vec4(userFn(u_x, u_L)[${k}], 0.0, 0.0, 0.0); }`,
          ].join('\n');
        const items = points.flatMap((p) => {
          const c = f.run!(p as never) as unknown as Color;
          return [c.c0, c.c1, c.c2].map((expected, k) => ({
            name: `${label} at ${JSON.stringify(p)}, channel ${k}`,
            source: source(k),
            uniforms: { u_x: p.x, u_L: p.L } as Record<
              string,
              number | number[]
            >,
            expected,
          }));
        });
        const values = await driver.evaluate(items);
        values.forEach((v, k) => {
          if (!v.ok) throw new Error(v.log);
          // A hue is in degrees.
          const scale =
            items[k].name.endsWith('channel 2') && /OKLCh/.test(label)
              ? 360
              : 1;
          expect(Math.abs(v.value - items[k].expected)).toBeLessThanOrEqual(
            1e-4 * Math.max(scale, Math.abs(items[k].expected))
          );
        });
      },
      120_000
    );
  }
);
