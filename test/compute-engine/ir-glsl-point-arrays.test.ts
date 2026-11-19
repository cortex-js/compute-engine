/**
 * A list of points of a constant length as a value on the `glsl` target
 * (CE-1538; README of `src/compute-engine/compilation/ir/`, "Tuples"): an
 * array of vectors, `vec2[3]`, as the old GLSL compiler of 0.193.0 wrote
 * it. Tycho's witness is a list of calls of a function whose body is
 * `PointList` of two scalars, a point.
 *
 * - Compiles with `fallback: false` on glsl: Tycho's four programs, a
 *   literal list of points, the readers of such a list, and an input
 *   declared a list of points of a stated length (a `vec2[3]` uniform).
 * - The values: the JavaScript compile against the interpreter, and the
 *   shader in WebGL2 (the headless Chromium of
 *   `scripts/glsl-check/glsl-driver.ts`) against the interpreter within
 *   single-float precision. Without the browser, these tests are skipped.
 */

import { existsSync } from 'node:fs';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import {
  agrees,
  interpret,
  type Expected,
  type Point,
} from './ir-slice-oracle';

const ce = new ComputeEngine();
for (const s of ['x', 'y', 'n']) ce.declare(s, 'real');
ce.declare('S', 'list<tuple<real, real>^3>');
ce.declare('L2', 'list<real^2>');
ce.declare('L3', 'list<real^3>');
ce.declare('M', 'matrix<real^(2x2)>');
const define = (name: string, body: unknown) => {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(['Function', ['Block', body], 'a', 'b'] as never));
};
define('P', [
  'Multiply',
  ['Divide', 1, 'n'],
  ['PointList', ['Floor', 'a'], ['Floor', 'b']],
]);
define('Q', ['Multiply', 2, ['PointList', 'a', 'b']]);
define('R', ['PointList', 'a', 'b']);
// A parameter that is a list of points: declared of a stated length, of a
// run-time length, and not declared.
const fn = (name: string, type: string | undefined, body: unknown) => {
  if (type !== undefined) ce.declare(name, type);
  ce.assign(name, ce.box(['Function', body, 'L'] as never));
};
fn('fs', '(list<tuple<real, real>^3>) -> real', ['Sum', ['PointY', 'L']]);
fn('fp', '(list<tuple<real, real>>) -> real', ['Sum', ['Abs', 'L']]);
fn('gu', undefined, ['Sum', ['PointX', 'L']]);

const glsl = (json: unknown) =>
  compile(ce.box(json as never), { to: 'glsl', fallback: false });
const js = (json: unknown) =>
  compile(ce.box(json as never), { to: 'javascript', fallback: false });

const three = (f: string) => [
  'List',
  [f, 'x', 'y'],
  [f, ['Add', 'x', 1], 'y'],
  [f, 'x', ['Add', 'y', 1]],
];

// prettier-ignore
const PROGRAMS: [string, unknown][] = [
  // Tycho's four programs.
  ['P(x, y)', ['P', 'x', 'y']],
  ['[P(x, y), P(x + 1, y), P(x, y + 1)]', three('P')],
  ['[Q(x, y), Q(x + 1, y), Q(x, y + 1)]', three('Q')],
  ['[R(x, y), R(x + 1, y), R(x, y + 1)]', three('R')],
  ['[(x, y), (y, x)]', ['List', ['Tuple', 'x', 'y'], ['Tuple', 'y', 'x']]],
  ['[(x, y, 1), (y, x, 2)]', ['List', ['Tuple', 'x', 'y', 1], ['Tuple', 'y', 'x', 2]]],
  ['(x - [1, 2], y)', ['PointList', ['Subtract', 'x', ['List', 1, 2]], 'y']],
  ['(1, 2) + [R(x, y), …]', ['Add', ['Tuple', 1, 2], three('R')]],
  ['Reverse([R(x, y), …])', ['Reverse', three('R')]],
  ['[R(x, y), …][2]', ['At', three('R'), 2]],
  ['If(x < 0, [R(x, y), …], [Q(x, y), …])', ['If', ['Less', 'x', 0], three('R'), three('Q')]],
  ['S', 'S'],
  ['S[2]', ['At', 'S', 2]],
  ['S + (x, y)', ['Add', 'S', ['Tuple', 'x', 'y']]],
  ['PointX(S[2])', ['PointX', ['At', 'S', 2]]],
  ['fs(S)', ['fs', 'S']],
  ['fp(S)', ['fp', 'S']],
  ['gu(S)', ['gu', 'S']],
  ['(L2, L2)', ['PointList', 'L2', 'L2']],
  ['Map(k ↦ (k, k), L3)', ['Map', ['Function', ['Tuple', 'k', 'k'], 'k'], 'L3']],
  ['Apply(z ↦ (cos z, sin z), L3)', ['Apply', ['Function', ['Tuple', ['Cos', 'z'], ['Sin', 'z']], 'z'], 'L3']],
  ['Which(3 < L3, (1, 2), True, (3, 4))', ['Which', ['Less', 3, 'L3'], ['Tuple', 1, 2], 'True', ['Tuple', 3, 4]]],
  // Any list of rank 2 of rows of 2 to 4 elements: a matrix too.
  ['sin(M) + 1', ['Add', ['Sin', 'M'], 1]],
  ['[[x, 1], [2, y], [y, x]]', ['List', ['List', 'x', 1], ['List', 2, 'y'], ['List', 'y', 'x']]],
];

const POINTS: Point[] = [
  {
    x: 0.3,
    y: 0.7,
    n: 2,
    L2: [0.5, 7],
    L3: [1, 4, 2.5],
    M: [
      [0, 1],
      [2, 3],
    ],
    S: [
      [1, 2],
      [-3, 0.5],
      [0, 4],
    ],
  },
  {
    x: -1.25,
    y: 2,
    n: -0.5,
    L2: [-1, 2.5],
    L3: [5, -2, 3.5],
    M: [
      [-1, 0.5],
      [4, -2],
    ],
    S: [
      [0, 0],
      [2.5, -1],
      [7, 3],
    ],
  },
  {
    x: 2.5,
    y: -3.5,
    n: 4,
    L2: [0, 0],
    L3: [0, 3, 6],
    M: [
      [1.5, 1],
      [0, 0.25],
    ],
    S: [
      [-1, -2],
      [0.25, 8],
      [1, 1],
    ],
  },
];

/** The inputs of `json` at `p`. */
const at = (r: { freeSymbols?: string[] }, p: Point): Point =>
  Object.fromEntries(r.freeSymbols!.map((n) => [n, p[n]]));

/** The interpreter's value of `json` at `p`. The value of `S` is a literal
 *  `List` of `Tuple`s in the expression: `interpret()` boxes a list of
 *  lists, which is not a value of the type of `S`. */
const expectedOf = (json: unknown, p: Point) => {
  const points = [
    'List',
    ...((p.S ?? []) as number[][]).map((q) => ['Tuple', ...q]),
  ];
  const subst = (x: unknown): unknown =>
    x === 'S' ? points : Array.isArray(x) ? x.map(subst) : x;
  const { S: _, ...rest } = p;
  return interpret(ce, ce.box(subst(json) as never), rest);
};

describe('IR on GLSL: a list of points is an array of vectors (CE-1538)', () => {
  test.each(PROGRAMS)('%s compiles on glsl', (_, json) => {
    expect(glsl(json).success).toBe(true);
  });

  test('a list of three calls that each give a point is a vec2[3]', () => {
    expect(glsl(three('R')).code).toMatch(
      /^return vec2\[3\]\(v\d+, v\d+, v\d+\);$/m
    );
  });

  test('an input that is a list of points of a stated length is a vec2[3]', () => {
    expect(glsl(['At', 'S', 2]).freeSymbolTypes!.S.lowered).toBe('vec2[3]');
  });

  test.each(PROGRAMS)(
    '%s on javascript gives the interpreter value',
    (_, json) => {
      const r = js(json);
      expect(r.success).toBe(true);
      for (const p of POINTS) {
        const v = r.run!(at(r, p) as never);
        const expected = expectedOf(json, at(r, p));
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

/** The elements of `v`, a number or a list of any depth, with the GLSL
 *  index of each (`[2][1]`). */
const leaves = (v: Expected, path = ''): [string, Expected][] =>
  Array.isArray(v)
    ? v.flatMap((e, k) => leaves(e, `${path}[${k}]`))
    : [[path, v]];

(chromiumAvailable() ? describe : describe.skip)(
  'IR on GLSL: the values of an array of vectors in WebGL2 (CE-1538)',
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
        // The driver sets `float` uniforms only: a `vecK` input is a
        // `float[K]` uniform, a `vecK[n]` input a `float[nK]` uniform, read
        // back vector by vector.
        const shape = (n: string) => {
          const m = /^vec(\d)(?:\[(\d+)\])?$/.exec(type(n));
          return m === null ? undefined : [Number(m[1]), Number(m[2] ?? 0)];
        };
        const uniform = (n: string) => {
          const s = shape(n);
          return s === undefined
            ? `uniform ${type(n)} u_${n};`
            : `uniform float u_${n}[${s[0] * Math.max(1, s[1])}];`;
        };
        const vector = (n: string, k: number, i: number) =>
          `vec${k}(${Array.from({ length: k }, (_, j) => `u_${n}[${i * k + j}]`).join(', ')})`;
        const arg = (n: string) => {
          const s = shape(n);
          if (s === undefined) return `u_${n}`;
          const [k, m] = s;
          return m === 0
            ? vector(n, k, 0)
            : `vec${k}[${m}](${Array.from({ length: m }, (_, i) => vector(n, k, i)).join(', ')})`;
        };
        const param = (n: string) => {
          const [base, length] = type(n).split('[');
          return length === undefined
            ? `${base} ${n}`
            : `${base} ${n}[${length}`;
        };
        const body = r.code.includes(';') ? r.code : `return ${r.code};`;
        // The GLSL type of the interpreter's value: a point is a `vecN`, a
        // list of points a `vecN[n]`.
        const result = (expected: Expected) => {
          if (!Array.isArray(expected)) return 'float';
          const n = expected.length;
          const k = Array.isArray(expected[0]) ? expected[0].length : 0;
          return k > 0 ? `vec${k}[${n}]` : `vec${n}`;
        };
        return POINTS.flatMap((p) => {
          const expected = expectedOf(json, at(r, p));
          if (expected === 'engine-error')
            throw new Error(`${label}: the interpreter failed`);
          return leaves(expected).map(([index, e]) => ({
            name: `${label} at ${JSON.stringify(at(r, p))}, element ${index}`,
            source: [
              '#version 300 es',
              'precision highp float;',
              'precision highp int;',
              ...inputs.map(uniform),
              'out vec4 fragColor;',
              r.preamble ?? '',
              `${result(expected)} userFn(${inputs.map(param).join(', ')}) {`,
              body,
              '}',
              'void main() {',
              `  fragColor = vec4(userFn(${inputs.map(arg).join(', ')})${index}, 0.0, 0.0, 0.0);`,
              '}',
            ].join('\n'),
            uniforms: Object.fromEntries(
              inputs.map((n) => [
                `u_${n}`,
                Array.isArray(p[n])
                  ? (p[n] as number[][]).flat()
                  : (p[n] as number),
              ])
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
        // The `sin` and `cos` of SwiftShader are within about 2e-4.
        if (
          typeof expected !== 'number' ||
          !(
            Math.abs(v.value - expected) <=
            5e-4 * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${JSON.stringify(expected)}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBe(312);
    }, 120_000);
  }
);
