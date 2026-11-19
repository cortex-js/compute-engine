/**
 * The list operators of the profile `ir` (README of
 * `src/compute-engine/compilation/ir/`, "Lists", the list operators):
 * `First`, `Second`, `Third`, `Last`, `Count`, `IsEmpty`, `Rest`, `Most`,
 * `Reverse`, `Take`, `Drop`, `RotateLeft`, `RotateRight`, `Mean`, `Median`,
 * `Sort`, `Ordering`, `Unique`, `Dot` and `Norm`.
 *
 * JavaScript agrees with the interpreter within 1e-12 at each point, also
 * for an empty list, a count out of range and a NaN element. GLSL compiles
 * them for a list of a stated length (the elements written out), and the
 * shaders give the interpreter's values in WebGL2 (the headless Chromium of
 * `scripts/glsl-check/glsl-driver.ts`; without the browser, that test is
 * skipped). The declines: a list of a run-time length on GLSL, `Median`,
 * `Sort`, `Ordering` and `Unique` on GLSL and in the interval mode, a
 * built list of a run-time length in the interval mode. In the interval
 * mode each element encloses the interpreter's value at the ends and the
 * middle of the input boxes.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number | number[] | number[][]>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('n', 'integer');
ce.declare('L', 'list<real>');
ce.declare('K', 'list<real>');
ce.declare('X', 'list<nan | real | signed_infinity>');
ce.declare('I', 'list<integer>');
ce.declare('L3', 'list<real^3>');
ce.declare('K3', 'list<real^3>');
ce.declare('L4', 'list<real^4>');
ce.declare('P', 'tuple<real, real>');
ce.declare('Q', 'list<tuple<real, real>>');
ce.declare('M', 'list<tuple<real, real>>');

const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json) =>
  compile(box(json), { profile: 'ir', fallback: false });
const glsl = (json: Json) =>
  compile(box(json), { to: 'glsl', profile: 'ir', fallback: false });

/** The interpreter's value at `point`: a number (NaN for `Missing`), a
 *  boolean, or an array of them. A list input is a `List`, a point a
 *  `Tuple`, a list of points a `List` of `Tuple`s. */
function interpret(json: Json, point: Point): unknown {
  const read = (e: Expression): unknown => {
    if (isFunction(e, 'Tuple') || isFunction(e, 'List')) return e.ops.map(read);
    if (isSymbol(e, 'True') || isSymbol(e, 'False')) return isSymbol(e, 'True');
    if (e.isFiniteCollection) return [...e.each()].map((x) => read(x.N()));
    return (e as { re: number }).re;
  };
  const item = (v: number | number[]): Expression =>
    Array.isArray(v)
      ? ce.function(
          'Tuple',
          v.map((n) => ce.number(n))
        )
      : ce.number(v);
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      !Array.isArray(v)
        ? ce.number(v)
        : k === 'P'
          ? item(v as number[])
          : ce.function('List', (v as (number | number[])[]).map(item)),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `a` and `b` agree: NaN with NaN, numbers within `tolerance` relative. */
function agree(a: unknown, b: unknown, tolerance = 1e-12): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((x, k) => agree(x, b[k], tolerance))
    );
  if (typeof a === 'number' && typeof b === 'number')
    return (
      a === b ||
      (Number.isNaN(a) && Number.isNaN(b)) ||
      Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b))
    );
  return a === b;
}

const L = [1.5, -2, 3, 0.25];
// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: Point[]][] = [
  ['First(L)', ['First', 'L'], [{ L }, { L: [] }]],
  ['Second(L)', ['Second', 'L'], [{ L }, { L: [4] }]],
  ['Third(L3)', ['Third', 'L3'], [{ L3: [1, 2, 3] }]],
  ['Last(L)', ['Last', 'L'], [{ L }, { L: [] }]],
  ['First of a tuple', ['First', ['Tuple', ['Multiply', 2, 'x'], 5]], [{ x: 0.3 }]],
  ['Second of a tuple', ['Second', ['Tuple', ['Multiply', 2, 'x'], 5]], [{ x: 0.3 }]],
  ['Last(Q) of points', ['Last', 'Q'], [{ Q: [[1, 2], [3, 4]] }]],
  ['Count(L)', ['Count', 'L'], [{ L }, { L: [] }]],
  ['Count(L, t > 0)', ['Count', 'L', ['Function', ['Greater', 't', 0], 't']], [{ L }, { L: [] }]],
  ['IsEmpty(L)', ['IsEmpty', 'L'], [{ L }, { L: [] }]],
  ['Rest(L)', ['Rest', 'L'], [{ L }, { L: [4] }, { L: [] }]],
  ['Most(L)', ['Most', 'L'], [{ L }, { L: [4] }, { L: [] }]],
  ['Reverse(L)', ['Reverse', 'L'], [{ L }, { L: [] }]],
  ['Reverse of a tuple', ['Reverse', ['Tuple', 'x', 2]], [{ x: 0.5 }]],
  ['Reverse(Q) of points', ['Reverse', 'Q'], [{ Q: [[1, 2], [3, 4]] }]],
  ['Take(L, n)', ['Take', 'L', 'n'], [-5, -2, 0, 2, 7].map((n) => ({ L, n }))],
  ['Drop(L, n)', ['Drop', 'L', 'n'], [-5, -1, 0, 1, 7].map((n) => ({ L, n }))],
  ['Take(L3, -2)', ['Take', 'L3', -2], [{ L3: [1, 2, 3] }]],
  ['Drop(L3, 1)', ['Drop', 'L3', 1], [{ L3: [1, 2, 3] }]],
  ['RotateLeft(L)', ['RotateLeft', 'L'], [{ L }, { L: [] }]],
  ['RotateLeft(L, n)', ['RotateLeft', 'L', 'n'], [-1, 1, 9].map((n) => ({ L, n }))],
  ['RotateRight(L, n)', ['RotateRight', 'L', 'n'], [-1, 1, 9].map((n) => ({ L, n }))],
  ['RotateLeft(Q, 3) of points', ['RotateLeft', 'Q', 3], [{ Q: [[1, 2], [3, 4], [5, 6]] }]],
  ['Sum(Rest(L))', ['Sum', ['Rest', 'L']], [{ L }]],
  ['Mean(L)', ['Mean', 'L'], [{ L }, { L: [0.1, 0.2, 0.3] }, { L: [] }]],
  ['Mean(X) of a NaN element', ['Mean', 'X'], [{ X: [1, NaN] }, { X: [1, Infinity] }]],
  ['Mean(I)', ['Mean', 'I'], [{ I: [1, 2] }]],
  ['Mean(x, L)', ['Mean', 'x', 'L'], [{ x: 2, L }]],
  ['x + Mean of constants', ['Add', 'x', ['Mean', ['List', 1, 2, 4]]], [{ x: 0.5 }]],
  ['Median(L)', ['Median', 'L'], [{ L }, { L: [3, 1, 2] }, { L: [] }]],
  ['Median(X) of a NaN element', ['Median', 'X'], [{ X: [1, NaN, 3] }, { X: [Infinity, 1, 2] }]],
  ['Median(I)', ['Median', 'I'], [{ I: [3, 1, 2, 10] }]],
  ['x + Median of constants', ['Add', 'x', ['Median', ['List', 1, 2, 4, 8]]], [{ x: 0.5 }]],
  ['Sort(L)', ['Sort', 'L'], [{ L }, { L: [] }]],
  ['Sort(X) of a NaN element', ['Sort', 'X'], [{ X: [3, NaN, 1, -Infinity] }]],
  ['Sort(I)', ['Sort', 'I'], [{ I: [3, 1, 2] }]],
  ['Ordering(L)', ['Ordering', 'L'], [{ L }, { L: [3, 1, 2, 1] }, { L: [] }]],
  ['Ordering(X) of a NaN element', ['Ordering', 'X'], [{ X: [3, NaN, 1] }]],
  ['At(K, Ordering(L))', ['At', 'K', ['Ordering', 'L']], [{ K: [10, 20, 30], L: [3, 1, 2] }]],
  ['Unique(L)', ['Unique', 'L'], [{ L: [3, 1, 3, 2, 1] }, { L: [] }]],
  ['Unique(X) of NaN elements', ['Unique', 'X'], [{ X: [0, NaN, NaN, 1.5, 1.5] }]],
  ['Dot(L, K)', ['Dot', 'L', 'K'], [{ L: [1, 2, 3], K: [4, 5, 6.5] }]],
  ['Dot(P, Q)', ['Dot', 'P', 'Q'], [{ P: [1, 2], Q: [[3, 4], [5, 6.5]] }]],
  ['Dot(Q, M) pair by pair', ['Dot', 'Q', 'M'], [{ Q: [[3, 4], [5, 6.5]], M: [[1, 2], [0.5, 1]] }]],
  ['Dot(P, PointList(0, Range(1, n)))', ['Dot', 'P', ['PointList', 0, ['Range', 1, 'n']]], [{ P: [1, 2], n: 3 }]],
  ['Norm(L)', ['Norm', 'L'], [{ L }, { L: [3, 4] }]],
  ['Norm(L, 1)', ['Norm', 'L', 1], [{ L }]],
  ['Norm(L, Infinity)', ['Norm', 'L', 'PositiveInfinity'], [{ L }, { L: [] }]],
  ['Norm(P)', ['Norm', 'P'], [{ P: [3, 4] }]],
  ['Norm(Q) of points', ['Norm', 'Q'], [{ Q: [[3, 4], [5, 12]] }]],
  ['Norm(x)', ['Norm', 'x'], [{ x: -3 }]],
];

describe('IR list operators on JavaScript', () => {
  test.each(PROGRAMS)(
    '%s gives the interpreter value',
    (_label, json, points) => {
      const r = js(json);
      expect(r.success).toBe(true);
      for (const p of points) {
        const got = r.run!(p as never);
        const want = interpret(json, p);
        if (!agree(got, want))
          throw new Error(
            `at ${JSON.stringify(p)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`
          );
      }
    }
  );
});

// prettier-ignore
const DECLINES: [label: string, json: Json, to: string, cause: string][] = [
  ['Rest of a run-time length on GLSL', ['Rest', 'L'], 'glsl', 'run-time length'],
  ['Take of a run-time count on GLSL', ['Take', 'L3', 'n'], 'glsl', 'build'],
  ['Median on GLSL', ['Median', 'L3'], 'glsl', 'median'],
  ['Sort on GLSL', ['Sort', 'L3'], 'glsl', 'sort'],
  ['Unique on GLSL', ['Unique', 'L3'], 'glsl', 'filter'],
  ['Median on interval-js', ['Median', 'L3'], 'interval-js', 'Median on interval-js'],
  ['Unique on interval-js', ['Unique', 'L3'], 'interval-js', 'Unique on interval-js'],
  ['Rest of a run-time length on interval-js', ['Rest', 'L'], 'interval-js', 'not one number'],
  ['Take of a run-time length on interval-js', ['Take', 'L', 2], 'interval-js', 'not one number'],
  ['Take of a run-time count on interval-js', ['Take', 'L3', 'n'], 'interval-js', 'not one number'],
  ['a real count of Take', ['Take', 'L', 'x'], 'javascript', 'a count that is not an integer'],
  ['Dot of two lengths', ['Dot', ['Tuple', 1, 2], ['Tuple', 3, 4, 5]], 'javascript', 'Dot of vectors of two lengths'],
  ['Norm of order 3', ['Norm', 'L', 3], 'javascript', 'an order other than 1, 2 and Infinity'],
  ['Sort by a chain operator', ['Sort', 'L', 'Greater'], 'javascript', 'Sort by a function that is not a literal of one or two parameters'],
  ['Rest of a list with an effect', ['Rest', ['Map', ['Function', ['Add', 't', ['Random']], 't'], 'L']], 'javascript', 'with an effect'],
];

type Box = { lo: number; hi: number };
type IntervalPoint = Record<string, number | Box | (number | Box)[]>;

/** The points of `p` for the interpreter: each box at its two ends and
 *  its middle (every box at the same place in it). */
function samples(p: IntervalPoint): Point[] {
  const at = (v: number | Box, t: number) =>
    typeof v === 'number' ? v : v.lo + t * (v.hi - v.lo);
  return [0, 0.5, 1].map((t) =>
    Object.fromEntries(
      Object.entries(p).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.map((x) => at(x, t)) : at(v, t),
      ])
    )
  ) as Point[];
}

/** `got` (the value of `run()`) encloses `want`: an interval that holds
 *  the number, element by element for a list; an empty list for `[]`. */
function encloses(got: unknown, want: unknown): boolean {
  if (Array.isArray(want))
    return (
      Array.isArray(got) &&
      got.length === want.length &&
      want.every((w, k) => encloses(got[k], w))
    );
  const g = got as { kind: string; value?: Box };
  if (typeof want !== 'number') return false;
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
const ENCLOSURES: [label: string, json: Json, points: IntervalPoint[]][] = [
  ['Rest(L3)', ['Rest', 'L3'], [{ L3: [1, B, -4] }]],
  ['Most(L3)', ['Most', 'L3'], [{ L3: [1, B, -4] }]],
  ['Reverse(L3)', ['Reverse', 'L3'], [{ L3: [1, B, -4] }]],
  ['Reverse(L)', ['Reverse', 'L'], [{ L: [1, B, -4, 0.5] }, { L: [] }]],
  ['Reverse of a tuple', ['Reverse', ['Tuple', 'x', 2]], [{ x: B }]],
  ['Take(L3, -2)', ['Take', 'L3', -2], [{ L3: [1, B, -4] }]],
  ['Take(L3, 5)', ['Take', 'L3', 5], [{ L3: [1, B, -4] }]],
  ['Drop(L3, 1)', ['Drop', 'L3', 1], [{ L3: [1, B, -4] }]],
  ['Drop(L3, -1)', ['Drop', 'L3', -1], [{ L3: [1, B, -4] }]],
  ['RotateLeft(L)', ['RotateLeft', 'L'], [{ L: [1, B, -4] }, { L: [] }]],
  ['RotateLeft(L, n)', ['RotateLeft', 'L', 'n'], [-1, 2, 7].map((n) => ({ L: [1, B, -4, 0.5], n }))],
  ['RotateRight(L3, n)', ['RotateRight', 'L3', 'n'], [-4, 1].map((n) => ({ L3: [1, B, -4], n }))],
  ['Sum(Rest(L3))', ['Sum', ['Rest', 'L3']], [{ L3: [1, B, -4] }]],
  ['Mean(L)', ['Mean', 'L'], [{ L: [1, B, -4] }, { L: [0.1, 0.2, 0.3] }, { L: [] }]],
  ['Mean(x, L)', ['Mean', 'x', 'L'], [{ x: B, L: [1, { lo: -1, hi: 5 }] }]],
  ['Mean of a list of expressions', ['Mean', ['List', 1, ['Sin', 'x'], 3]], [{ x: { lo: 0.5, hi: 1 } }]],
];

describe('IR list operators on interval-js', () => {
  test.each(ENCLOSURES)(
    '%s encloses the interpreter',
    (_label, json, points) => {
      const r = compile(box(json), {
        to: 'interval-js',
        profile: 'ir',
        fallback: false,
      } as never) as unknown as { run: (p: IntervalPoint) => unknown };
      for (const p of points) {
        const got = r.run(p);
        for (const q of samples(p)) {
          const want = interpret(json, q);
          if (!encloses(got, want))
            throw new Error(
              `at ${JSON.stringify(q)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`
            );
        }
      }
    }
  );

  test('a count that is a box of several integers has no bound', () => {
    const r = compile(box(['RotateLeft', 'L3', 'n']), {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as { run: (p: IntervalPoint) => unknown };
    expect(r.run({ L3: [1, 2, 3], n: { lo: 1, hi: 2 } })).toEqual({
      kind: 'entire',
    });
  });
});

describe('IR list operators: declines', () => {
  test.each(DECLINES)('%s declines', (_label, json, to, cause) => {
    let message: string | undefined;
    try {
      compile(box(json), { to, profile: 'ir', fallback: false } as never);
    } catch (x) {
      message = (x as { diagnostic?: { message: string } }).diagnostic?.message;
    }
    expect(message).toContain(cause);
  });
});

// prettier-ignore
const SHADERS: [label: string, json: Json, points: Point[]][] = [
  ['First(L3)', ['First', 'L3'], [{ L3: [1.5, 2, 3] }]],
  ['Last(L3) + Second(L3)', ['Add', ['Last', 'L3'], ['Second', 'L3']], [{ L3: [1.5, 2, 3] }]],
  ['Count(L3) + x', ['Add', ['Count', 'L3'], 'x'], [{ L3: [1.5, 2, 3], x: 0.5 }]],
  ['Rest(L3)', ['Rest', 'L3'], [{ L3: [1.5, 2, 3] }]],
  ['Most(L4)', ['Most', 'L4'], [{ L4: [1.5, 2, 3, -4] }]],
  ['Reverse(L4)', ['Reverse', 'L4'], [{ L4: [1.5, 2, 3, -4] }]],
  ['Take(L4, -3)', ['Take', 'L4', -3], [{ L4: [1.5, 2, 3, -4] }]],
  ['Drop(L4, 1)', ['Drop', 'L4', 1], [{ L4: [1.5, 2, 3, -4] }]],
  ['RotateLeft(L4, 3)', ['RotateLeft', 'L4', 3], [{ L4: [1.5, 2, 3, -4] }]],
  ['RotateRight(L4)', ['RotateRight', 'L4', 1], [{ L4: [1.5, 2, 3, -4] }]],
  ['Mean(L3)', ['Mean', 'L3'], [{ L3: [1.5, 2, 3] }]],
  ['Dot(L3, K3)', ['Dot', 'L3', 'K3'], [{ L3: [1.5, 2, 3], K3: [4, -5, 0.5] }]],
  ['Norm(L3)', ['Norm', 'L3'], [{ L3: [1, 2, -3] }]],
  ['Norm(P)', ['Norm', 'P'], [{ P: [3, 4] }]],
  ['Dot(P, P)', ['Dot', 'P', 'P'], [{ P: [3, 4] }]],
];

function chromiumAvailable(): boolean {
  try {
    const { chromium } = require('playwright-core');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/** One fragment shader per element of the result: the host's function
 *  `<result> userFn(<inputs>)`, whose list and point inputs are made from
 *  `float` uniforms (`u_L3_0`, ...). */
function shaders(r: ReturnType<typeof glsl>, expected: unknown): string[] {
  const type = (n: string) => r.freeSymbolTypes![n].lowered!;
  const size = (n: string) =>
    Number(
      /^vec(\d)$|\[(\d+)\]$/.exec(type(n))?.find((x, k) => k > 0 && x) ?? 1
    );
  const value = (n: string) =>
    !/vec|\[/.test(type(n))
      ? `u_${n}_0`
      : `${type(n)}(${Array.from({ length: size(n) }, (_, k) => `u_${n}_${k}`).join(', ')})`;
  const count = Array.isArray(expected) ? expected.length : undefined;
  const result =
    count === undefined
      ? 'float'
      : count >= 2 && count <= 4
        ? `vec${count}`
        : `float[${count}]`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return Array.from({ length: count ?? 1 }, (_, k) =>
    [
      '#version 300 es',
      'precision highp float;',
      'precision highp int;',
      ...r.freeSymbols!.flatMap((n) =>
        Array.from({ length: size(n) }, (_, j) => `uniform float u_${n}_${j};`)
      ),
      'out vec4 fragColor;',
      r.preamble ?? '',
      `${result} userFn(${r.freeSymbols!.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
      body,
      '}',
      'void main() {',
      `  fragColor = vec4(float(userFn(${r.freeSymbols!.map(value).join(', ')})${count === undefined ? '' : `[${k}]`}), 0.0, 0.0, 0.0);`,
      '}',
    ].join('\n')
  );
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR list operators on GLSL in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('each element gives the interpreter value within single-float precision', async () => {
      const items = SHADERS.flatMap(([label, json, points]) => {
        const r = glsl(json);
        expect(r.success).toBe(true);
        return points.flatMap((p) => {
          const expected = interpret(json, p);
          const sources = shaders(r, expected);
          const uniforms = Object.fromEntries(
            r.freeSymbols!.flatMap((n) =>
              [p[n]].flat().map((x, j) => [`u_${n}_${j}`, x])
            )
          );
          return sources.map((source, k) => ({
            name: `${label} [${k}] at ${JSON.stringify(p)}`,
            source,
            uniforms,
            expected: [expected].flat()[k] as number,
          }));
        });
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (!agree(v.value, expected, 1e-5))
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(30);
    }, 120_000);
  }
);
