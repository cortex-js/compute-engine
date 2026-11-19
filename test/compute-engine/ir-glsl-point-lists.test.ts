/**
 * A list of points of a stated length on the `glsl` target (CE-1474;
 * README of `src/compute-engine/compilation/ir/`, "Tuples"). GLSL has no
 * list of rank 2: `PointList` of a list component of a constant length is
 * written out, a point per index, and a reader of the points (`Abs`,
 * `PointX`, `Add` of a point, `Divide` by a list of numbers) is the list of
 * its values at each point, a `vecN` or a `float[n]`. The list of points
 * itself is not a value of the shader.
 *
 * - Compiles with `fallback: false`: Tycho's witness `|(x - [1/2, 1], y)|`
 *   and its `\min(|(x-[1/2,1], y, z+2)|)`.
 * - Declines: a list of points as the result, a component of a run-time
 *   length.
 * - The values: the JavaScript compile against the interpreter, and the
 *   shader in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`) against the interpreter within
 *   single-float precision. Without the browser, these tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import {
  agrees,
  interpret,
  makeEngine,
  type Expected,
  type Point,
} from './ir-slice-oracle';

const ce = makeEngine();
ce.declare('z', 'real');

const glsl = (json: unknown) =>
  compile(ce.box(json as never), { to: 'glsl', fallback: false });
const js = (json: unknown) =>
  compile(ce.box(json as never), { to: 'javascript', fallback: false });

const HALF_ONE = ['List', ['Rational', 1, 2], 1];

// prettier-ignore
const PROGRAMS: [string, unknown][] = [
  // A literal List of points is read the same way.
  ['|[(x, 1), (2, y)]|', ['Abs', ['List', ['Tuple', 'x', 1], ['Tuple', 2, 'y']]]],
  // The witness of CE-1474.
  ['|(x - [1/2, 1], y)|', ['Abs', ['PointList', ['Subtract', 'x', HALF_ONE], 'y']]],
  // Tycho's `\min(|(x-[1/2,1], y, z+2)|)`.
  ['min |(x - [1/2, 1], y, z + 2)|', ['Min', ['Abs', ['PointList', ['Subtract', 'x', HALF_ONE], 'y', ['Add', 'z', 2]]]]],
  ['|(x - [1/2, 1, 3], y)|', ['Abs', ['PointList', ['Subtract', 'x', ['List', ['Rational', 1, 2], 1, 3]], 'y']]],
  // A `float[5]`.
  ['|(x - [1/2, 1, 3, 4, 5], y)|', ['Abs', ['PointList', ['Subtract', 'x', ['List', ['Rational', 1, 2], 1, 3, 4, 5]], 'y']]],
  // Components of two lengths: as long as the shorter.
  ['|(x - [1, 2], [3, 4, 5])|', ['Abs', ['PointList', ['Subtract', 'x', ['List', 1, 2]], ['List', 3, 4, 5]]]],
  // A stated input.
  ['|(L, y)|', ['Abs', ['PointList', 'L', 'y']]],
  ['PointX of (L, L)', ['PointX', ['PointList', 'L', 'L']]],
  ['PointX of (x - [1/2, 1], y)', ['PointX', ['PointList', ['Subtract', 'x', HALF_ONE], 'y']]],
  ['PointY of (x - [1/2, 1], y)', ['PointY', ['PointList', ['Subtract', 'x', HALF_ONE], 'y']]],
  ['Distance((x, y), ([1/2, 1], [2, 3]))', ['Distance', ['Tuple', 'x', 'y'], ['PointList', HALF_ONE, ['List', 2, 3]]]],
  ['|(x, y) + ([1/2, 1], [2, 3])|', ['Abs', ['Add', ['Tuple', 'x', 'y'], ['PointList', HALF_ONE, ['List', 2, 3]]]]],
  ['|(x - [1/2, 1], y) / [2, z]|', ['Abs', ['Divide', ['PointList', ['Subtract', 'x', HALF_ONE], 'y'], ['List', 2, 'z']]]],
  ['|[2, z] (x - [1/2, 1], y)|', ['Abs', ['Multiply', ['List', 2, 'z'], ['PointList', ['Subtract', 'x', HALF_ONE], 'y']]]],
  ['PointZ of (x - [1/2, 1], y, z)', ['PointZ', ['PointList', ['Subtract', 'x', HALF_ONE], 'y', 'z']]],
];

const POINTS: Point[] = [
  { x: 0.3, y: 0.7, z: 0.1, L: [1, -2, 0.5] },
  { x: -1.25, y: 2, z: -3, L: [0, 4, -1] },
  { x: 0.5, y: 0, z: 1.5, L: [2.5, 2.5, -0.75] },
];

/** The inputs of `json` at `p`. */
const at = (r: { freeSymbols?: string[] }, p: Point): Point =>
  Object.fromEntries(r.freeSymbols!.map((n) => [n, p[n]]));

describe('IR on GLSL: a list of points of a stated length (CE-1474)', () => {
  test.each(PROGRAMS)('%s compiles on glsl', (_, json) => {
    const r = glsl(json);
    expect(r.success).toBe(true);
  });

  test('the witness is the list of the distances, a vec2', () => {
    const r = glsl(PROGRAMS[0][1]);
    expect(r.code).toMatch(/^return vec2\(sqrt\(.*\), sqrt\(.*\)\);$/m);
  });

  test.each([
    // A list of points is not a value of the shader.
    [['PointList', ['Subtract', 'x', HALF_ONE], 'y'], /a list of rank 2/],
    // A component of a run-time length.
    [['Abs', ['PointList', 'D', 'y']], /D has a run-time length/],
    // Past 64 points (`SCALARIZE_LIMIT`), the build of the points stays.
    [['Abs', ['PointList', ['Range', 1, 65], 'y']], /the region build/],
  ])('%j declines on glsl', (json, message) => {
    expect(() => glsl(json)).toThrow(message);
  });

  test.each(PROGRAMS)(
    '%s on javascript gives the interpreter value',
    (_, json) => {
      const r = js(json);
      expect(r.success).toBe(true);
      for (const p of POINTS) {
        const v = r.run!(at(r, p) as never);
        const expected = interpret(ce, ce.box(json as never), at(r, p));
        expect([p, agrees(v, expected)]).toEqual([p, true]);
      }
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

(chromiumAvailable() ? describe : describe.skip)(
  'IR on GLSL: the values of a list of points in WebGL2 (CE-1474)',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('the shaders give the interpreter values within single-float precision', async () => {
      const items = PROGRAMS.flatMap(([label, json]) => {
        const r = glsl(json);
        const inputs = r.freeSymbols!;
        const type = (n: string) => r.freeSymbolTypes![n].lowered;
        const vec = (n: string) => Number(/^vec(\d)$/.exec(type(n))?.[1] ?? 0);
        // A `vecN` input is passed as a `float[N]` uniform: the driver
        // sets `float` uniforms only.
        const uniform = (n: string) =>
          vec(n) > 0
            ? `uniform float u_${n}[${vec(n)}];`
            : `uniform ${type(n)} u_${n};`;
        const arg = (n: string) =>
          vec(n) > 0
            ? `${type(n)}(${Array.from({ length: vec(n) }, (_, i) => `u_${n}[${i}]`).join(', ')})`
            : `u_${n}`;
        const body = r.code.includes(';') ? r.code : `return ${r.code};`;
        return POINTS.flatMap((p) => {
          const expected = interpret(ce, ce.box(json as never), at(r, p));
          const values = (
            Array.isArray(expected) ? expected : [expected]
          ) as Expected[];
          // A list of 2 to 4 reals is a `vecN`, another length a `float[n]`.
          const n = values.length;
          const result = !Array.isArray(expected)
            ? 'float'
            : n >= 2 && n <= 4
              ? `vec${n}`
              : `float[${n}]`;
          return values.map((e, k) => ({
            name: `${label} at ${JSON.stringify(at(r, p))}, element ${k}`,
            source: [
              '#version 300 es',
              'precision highp float;',
              'precision highp int;',
              ...inputs.map(uniform),
              'out vec4 fragColor;',
              r.preamble ?? '',
              `${result} userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
              body,
              '}',
              'void main() {',
              `  fragColor = vec4(userFn(${inputs.map(arg).join(', ')})${Array.isArray(expected) ? `[${k}]` : ''}, 0.0, 0.0, 0.0);`,
              '}',
            ].join('\n'),
            uniforms: Object.fromEntries(
              inputs.map((n) => [`u_${n}`, p[n] as number | number[]])
            ),
            expected: e,
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (
          typeof expected !== 'number' ||
          !(
            Math.abs(v.value - expected) <=
            1e-5 * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${JSON.stringify(expected)}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBe(105);
    }, 120_000);
  }
);
