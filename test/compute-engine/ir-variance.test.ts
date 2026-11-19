/**
 * CE-1473: `Variance`, `PopulationVariance`, `StandardDeviation` and
 * `PopulationStandardDeviation` of the profile `ir` (README of
 * `src/compute-engine/compilation/ir/`, "Lists", the list operators).
 *
 * The compiled value is computed in two passes, the corrected form (the
 * mean, then `Σd² - (Σd)²/n` of the deviations `d` from it). JavaScript
 * agrees with the interpreter within 1e-12 at each point: an empty list
 * (NaN), a list of one element (NaN for a sample, 0 for a population), data
 * with a large common offset, constant data (exactly 0), a NaN or an infinite
 * element (NaN), integers whose interpreter value is exact (`2/3·√3`), data
 * far from 0, several operands, a `Range` and a built list. In the interval
 * mode the result encloses the interpreter's value at the ends and the
 * middle of the input boxes (NaN is the empty result). GLSL compiles them for
 * a list of a stated length; the shaders give the interpreter's values in
 * WebGL2 (without the headless Chromium, that test is skipped). Complex
 * elements and a distribution decline.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('n', 'integer');
ce.declare('L', 'list<real>');
ce.declare('X', 'list<nan | real | signed_infinity>');
ce.declare('I', 'list<integer>');
ce.declare('L1', 'list<real^1>');
ce.declare('L3', 'list<real^3>');

const box = (json: Json): Expression => ce.box(json as never);

/** The interpreter's numeric value at `point` (a list input is a `List`). */
function interpret(json: Json, point: Point): number {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((y) => ce.number(y))
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(
    values as never,
    () => (box(json).evaluate().N() as { re: number }).re
  );
}

/** `a` and `b` agree: NaN with NaN, numbers within `tolerance` relative. */
function agree(a: unknown, b: number, tolerance = 1e-12): boolean {
  return (
    typeof a === 'number' &&
    (a === b ||
      (Number.isNaN(a) && Number.isNaN(b)) ||
      Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)))
  );
}

const HEADS = [
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
];

const L = [1.5, -2, 3, 0.25];
// prettier-ignore
const LISTS: [label: string, json: (h: string) => Json, points: Point[]][] = [
  ['of L', (h) => [h, 'L'], [
    { L: [3, 1, 3] },
    { L },
    { L: [0.1, 0.2, 0.3] },
    { L: [] },
    { L: [5.5] },
    { L: [1e8 + 0.125, 1e8 + 0.25, 1e8 + 0.5] },
    { L: [4503599627370496, 4503599627370497] },
    { L: [0.1, 0.1, 0.1] },
  ]],
  ['of NaN and infinite elements', (h) => [h, 'X'], [
    { X: [1, NaN, 3] },
    { X: [1, Infinity, 3] },
    { X: [Infinity] },
    { X: [-Infinity, Infinity] },
  ]],
  ['of integers', (h) => [h, 'I'], [{ I: [3, 1, 3] }, { I: [2, 7, 1, 8, 2, 8] }, { I: [4] }]],
  ['of a scalar and a list', (h) => [h, 'x', 'L'], [{ x: 2, L }, { x: 0.5, L: [] }]],
  ['of scalars', (h) => [h, 'x', 1, 4], [{ x: -2.5 }]],
  ['of a literal list', (h) => [h, ['List', 1, ['Sin', 'x'], 3]], [{ x: 0.7 }]],
  ['of a Range', (h) => [h, ['Range', 1, 'n']], [{ n: 10 }, { n: 1 }, { n: -3 }]],
  ['of a built list', (h) => [h, ['Map', ['Function', ['Multiply', 't', 't'], 't'], 'L']], [{ L }]],
  ['of a stated length of 1', (h) => [h, 'L1'], [{ L1: [2.5] }]],
  ['of a stated length of 3', (h) => [h, 'L3'], [{ L3: [1.5, 2, 3] }]],
];

const PROGRAMS = HEADS.flatMap((h) =>
  LISTS.map(
    ([label, json, points]) => [`${h} ${label}`, json(h), points] as const
  )
);

describe('IR variances on JavaScript', () => {
  test('the witness of CE-1473', () => {
    const r = compile(box(['StandardDeviation', 'L']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ L: [3, 1, 3] } as never)).toBe(1.1547005383792515);
  });

  test('a large common offset and constant data are exact', () => {
    // The corrected two-pass form cancels the rounding of the mean: the
    // interpreter gives exactly 0.5 and 0.
    const v = compile(box(['Variance', 'L']), { fallback: false });
    expect(v.run!({ L: [4503599627370496, 4503599627370497] } as never)).toBe(
      0.5
    );
    const sd = compile(box(['StandardDeviation', 'L']), { fallback: false });
    expect(sd.run!({ L: [0.1, 0.1, 0.1] } as never)).toBe(0);
  });

  test.each(PROGRAMS)(
    '%s gives the interpreter value',
    (_label, json, points) => {
      const r = compile(box(json), { fallback: false });
      expect(r.success).toBe(true);
      for (const p of points) {
        const got = r.run!(p as never);
        const want = interpret(json, p);
        if (!agree(got, want))
          throw new Error(`at ${JSON.stringify(p)}: ${got} vs ${want}`);
      }
    }
  );
});

// prettier-ignore
const DECLINES: [label: string, json: Json, options: object, cause: string][] = [
  ['complex elements', ['Variance', ['List', 1, ['Complex', 1, 2], 'x']], {}, 'Variance of complex numbers'],
  ['a complex scalar', ['StandardDeviation', 'L', ['Multiply', 'ImaginaryUnit', 'x']], {}, 'StandardDeviation of complex numbers'],
  ['a distribution', ['StandardDeviation', ['NormalDistribution', 0, 1]], {}, 'StandardDeviation of other than numbers and lists of numbers'],
  ['a run-time length on GLSL', ['Variance', 'L'], { to: 'glsl' }, 'run-time length'],
];

describe('IR variances: declines', () => {
  test.each(DECLINES)('%s declines', (_label, json, options, cause) => {
    let message: string | undefined;
    try {
      compile(box(json), { ...options, fallback: false } as never);
    } catch (x) {
      message = (x as { diagnostic?: { message: string } }).diagnostic?.message;
    }
    expect(message).toContain(cause);
  });
});

type Bounds = { lo: number; hi: number };
type IntervalPoint = Record<string, number | Bounds | (number | Bounds)[]>;

/** The points of `p` for the interpreter: each box at its two ends and its
 *  middle (every box at the same place in it). */
function samples(p: IntervalPoint): Point[] {
  const at = (v: number | Bounds, t: number) =>
    typeof v === 'number' ? v : v.lo + t * (v.hi - v.lo);
  return [0, 0.5, 1].map((t) =>
    Object.fromEntries(
      Object.entries(p).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.map((y) => at(y, t)) : at(v, t),
      ])
    )
  );
}

/** `got` (the value of `run()`) encloses `want`; NaN is the empty result. */
function encloses(got: unknown, want: number): boolean {
  const g = got as { kind: string; value?: Bounds };
  if (Number.isNaN(want)) return g.kind === 'empty';
  return (
    (g.kind === 'interval' || g.kind === 'singular') &&
    g.value !== undefined &&
    g.value.lo <= want &&
    want <= g.value.hi
  );
}

const B = { lo: 2, hi: 3 };
// prettier-ignore
const BOXES: [label: string, json: (h: string) => Json, points: IntervalPoint[]][] = [
  ['of L3', (h) => [h, 'L3'], [{ L3: [1, B, -4] }, { L3: [1, 1, 1] }]],
  ['of L', (h) => [h, 'L'], [{ L: [1, B, -4, 0.5] }, { L: [B] }, { L: [] }]],
  ['of L1', (h) => [h, 'L1'], [{ L1: [B] }]],
  ['of a scalar and a list', (h) => [h, 'x', 'L3'], [{ x: B, L3: [1, { lo: -1, hi: 5 }, 0] }]],
];

describe('IR variances on interval-js', () => {
  test.each(
    HEADS.flatMap((h) =>
      BOXES.map(
        ([label, json, points]) => [`${h} ${label}`, json(h), points] as const
      )
    )
  )('%s encloses the interpreter', (_label, json, points) => {
    const r = compile(box(json), {
      to: 'interval-js',
      fallback: false,
    } as never) as unknown as { run: (p: IntervalPoint) => unknown };
    for (const p of points) {
      const got = r.run(p);
      for (const q of samples(p)) {
        const want = interpret(json, q);
        if (!encloses(got, want))
          throw new Error(
            `at ${JSON.stringify(q)}: ${JSON.stringify(got)} vs ${want}`
          );
      }
    }
  });
});

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** A fragment shader whose first channel is the host's function
 *  `float userFn(<inputs>)`, with each input made from `float` uniforms. */
function shader(r: ReturnType<typeof compile>): string {
  const type = (n: string) => r.freeSymbolTypes![n].lowered!;
  const size = (n: string) =>
    Number(
      /^vec(\d)$|\[(\d+)\]$/.exec(type(n))?.find((x, k) => k > 0 && x) ?? 1
    );
  const value = (n: string) =>
    !/vec|\[/.test(type(n))
      ? `u_${n}_0`
      : `${type(n)}(${Array.from({ length: size(n) }, (_, k) => `u_${n}_${k}`).join(', ')})`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...r.freeSymbols!.flatMap((n) =>
      Array.from({ length: size(n) }, (_, j) => `uniform float u_${n}_${j};`)
    ),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${r.freeSymbols!.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${r.freeSymbols!.map(value).join(', ')}), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

// prettier-ignore
const SHADERS: [label: string, json: (h: string) => Json, point: Point][] = [
  ['of L3', (h) => [h, 'L3'], { L3: [1.5, 2, 3] }],
  ['of a scalar and a list', (h) => [h, 'x', 'L3'], { x: 0.5, L3: [1.5, 2, -3] }],
];

(chromiumAvailable() ? describe : describe.skip)(
  'IR variances on GLSL in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each shader gives the interpreter value within single-float precision', async () => {
      const items = HEADS.flatMap((h) =>
        SHADERS.map(([label, json, p]) => {
          const r = compile(box(json(h)), { to: 'glsl', fallback: false });
          expect(r.success).toBe(true);
          return {
            name: `${h} ${label} at ${JSON.stringify(p)}`,
            source: shader(r),
            uniforms: Object.fromEntries(
              r.freeSymbols!.flatMap((n) =>
                [p[n]].flat().map((x, j) => [`u_${n}_${j}`, x])
              )
            ),
            expected: interpret(json(h), p),
          };
        })
      );
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (!agree(v.value, expected, 1e-5))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
    }, 60_000);
  }
);
