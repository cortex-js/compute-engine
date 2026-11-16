/**
 * The JavaScript results of the profile `ir` that are lists (batch G19;
 * README of `src/compute-engine/compilation/ir/`, "Lists"), under the
 * contract of `run()` in `docs/COMPILATION-MODEL.md`: inputs of the shape
 * the compiled code reads, results read-only.
 *
 * - A result comes back as the code built it, with no copy: it can be an
 *   input, hold a part of one, or be a constant that every call shares.
 * - A list of at least 16 constants is computed once, when the code is
 *   loaded, and every call reads that array.
 * - Compiled code never writes to an input or to such a list.
 *
 * Speed is measured, not asserted: the only time limits are hang guards.
 */

import { performance } from 'node:perf_hooks';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  createJavaScriptRuntime,
  type StoredJavaScript,
} from '../../src/compute-engine/compilation/javascript-runtime';

type Json = unknown;
type Point = Record<string, unknown>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('n', 'integer');
ce.declare('Q', 'list<real>');
ce.declare('R', 'list<real>');
ce.declare('N', 'list<list<real^2>>');
for (const name of ['A', 'B', 'C', 'D']) ce.declare(name, 'tuple<real, real>');
ce.declare('P', 'list<tuple<real, real>>');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });
const existing = (json: Json, options: object = {}) =>
  compile(box(json), { fallback: false, ...options });
const run = (r: { run?: unknown }, point: Point): any =>
  (r.run as (p: Point) => unknown)(point);

const CONSTANTS = Array.from({ length: 20 }, (_, k) => k / 4 + 0.5);
const point = (): Point => ({
  x: 0.5,
  Q: [1, -2, 3],
  R: [4, 5],
  N: [
    [1, 2],
    [3, 4],
  ],
  A: [1, 2],
  B: [3, 4],
  C: [5, 6],
  D: [7, 8],
  P: [
    [1, 2],
    [3, 4],
  ],
});

describe('a result comes back as the code built it, with no copy', () => {
  test.each(['Q', 'A', 'P', 'N'])('the input %s is the result', (name) => {
    const r = js(name);
    expect(r.code).not.toMatch(/structuredClone|_copy|slice\(/);
    const p = point();
    expect(run(r, p)).toBe(p[name]);
    expect(run(r, p)).toEqual(run(existing(name), point()));
  });

  test('a list of inputs holds the input points', () => {
    const json = ['List', 'A', 'B', 'C', 'D'];
    const r = js(json);
    expect(r.code).toContain('return [_.A, _.B, _.C, _.D];');
    const p = point();
    const value = run(r, p);
    ['A', 'B', 'C', 'D'].forEach((k, i) => expect(value[i]).toBe(p[k]));
    expect(value).toEqual(run(existing(json), point()));
  });

  test('a root Tuple holds the input list', () => {
    const r = js(['Tuple', 'Q', 'x']);
    expect(r.code).not.toMatch(/structuredClone|_copy/);
    const p = point();
    expect(run(r, p)[0]).toBe(p.Q);
  });

  test('a complex or a colour result', () => {
    ce.declare('z', 'complex');
    for (const json of [
      ['Multiply', 'z', 'z'],
      ['Rgb', 'x', 0, 0],
    ]) {
      const r = js(json);
      expect(r.code).not.toMatch(/structuredClone|_copy/);
      const p = { z: { re: 1, im: 2 }, x: 0.5 };
      expect(run(r, p)).toEqual(run(existing(json), p));
    }
  });
});

describe('compiled code never writes to an input or to a list computed once', () => {
  const K = ['List', ...CONSTANTS];
  const programs: Json[] = [
    ['Add', ['Multiply', 2, 'Q'], 1],
    ['Add', 'Q', ['List', 1, 2, 3]],
    ['Multiply', 2, K],
    ['Filter', 'Q', ['Function', ['Greater', 'z', 0], 'z']],
    ['Filter', K, ['Function', ['Greater', 'z', 2], 'z']],
    ['RandomShuffle', 'Q'],
    ['RandomShuffle', K],
    ['ListJoin', 'Q', 'R'],
    ['ListJoin', K, 'Q'],
    ['Map', ['Function', ['Negate', 'z'], 'z'], K],
    [
      'Block',
      ['Declare', 'L', "'unknown'", 'Q'],
      ['Add', ['Multiply', 3, 'L'], 'x'],
    ],
  ];
  test.each(programs.map((json) => [json]))('%j', (json) => {
    const r = js(json);
    const p = point();
    const before = structuredClone(p);
    // The second call reads the list computed once after the first.
    run(r, p);
    const value = run(r, p);
    expect(p).toEqual(before);
    if (!JSON.stringify(json).includes('Random'))
      expect(value).toEqual(run(existing(json), structuredClone(before)));
  });

  test('a write to a list local declines, a write to an element too', () => {
    for (const json of [
      [
        'Block',
        ['Declare', 'L', "'unknown'", 'Q'],
        ['Assign', 'L', ['Multiply', 2, 'L']],
        'L',
      ],
      [
        'Block',
        ['Declare', 'L', "'unknown'", K],
        ['Assign', 'L', ['Multiply', 2, 'L']],
        'L',
      ],
    ])
      expect(() => js(json)).toThrow(/a list local/);
    expect(() =>
      js([
        'Block',
        ['Declare', 'L', "'unknown'", K],
        ['Assign', ['At', 'L', 1], 'x'],
        ['At', 'L', 1],
      ])
    ).toThrow(/static type error/);
  });

  test('a list computed once is the same array at each call, and unchanged', () => {
    const r = js(K);
    const a = run(r, {});
    expect(run(r, {})).toBe(a);
    expect(a).toEqual(CONSTANTS);
    // A read of it, at each call, after other programs ran.
    const at = js(['At', K, ['Floor', 'x']]);
    for (const x of [1, 7, 20]) expect(run(at, { x })).toBe(CONSTANTS[x - 1]);
  });
});

describe('a list of constants is computed once', () => {
  const at = ['Add', ['At', ['List', ...CONSTANTS], ['Floor', 'x']], -7];

  test('the array is written once, out of the per-call code', () => {
    const r = js(at);
    expect(r.preambleOnce).toContain(`[${CONSTANTS.slice(0, 3).join(', ')}`);
    expect(r.code).not.toContain('[');
    for (const x of [1, 3.5, 20, 21, -2])
      expect(run(r, { x })).toEqual(run(existing(at), { x }));
  });

  test('a short list stays in the per-call code', () => {
    const r = js(['At', ['List', 1.5, 2.5, 3.5], ['Floor', 'x']]);
    expect(r.code).toContain('[1.5, 2.5, 3.5]');
    expect(run(r, { x: 2 })).toBe(2.5);
  });

  test('a list of lists and a list of complex numbers', () => {
    const rows = ['List', ...CONSTANTS.slice(0, 10).map((c) => ['List', c, 1])];
    const r = js(rows);
    expect(r.code).not.toContain('[');
    expect(run(r, {})).toEqual(run(existing(rows), {}));
    const complex = ['List', ...CONSTANTS.map((c) => ['Complex', c, 1])];
    const z = js(complex);
    expect(z.preambleOnce).toMatch(/const v\d+ = \[\(\{ re: 0\.5, im: 1 \}\)/);
    const cells = run(z, {});
    expect(run(z, {})).toBe(cells);
    expect(cells[1]).toEqual({ re: 0.75, im: 1 });
    // A filter of the list holds its cells; the list is unchanged.
    const kept = run(
      js(['Filter', complex, ['Function', ['Greater', ['Re', 'w'], 2], 'w']]),
      {}
    );
    expect(kept).toHaveLength(13);
  });

  test('stored code, bigint mode, a batch and shippable code', () => {
    const r = js(at);
    expect(r.shippable).toBe(true);
    const stored = JSON.parse(
      JSON.stringify({
        code: r.code,
        preamble: r.preamble,
        preambleOnce: r.preambleOnce,
        reconstructionDigits: r.reconstructionDigits,
        calling: r.calling,
        entryPlan: r.entryPlan,
        mode: r.mode,
        runtimeVersion: r.runtimeVersion,
        shippable: r.shippable,
        profile: r.profile,
      })
    ) as StoredJavaScript;
    const f = createJavaScriptRuntime().load(stored) as (p: Point) => unknown;
    for (const x of [1, 4.5, 19]) expect(f({ x })).toBe(run(r, { x }));
    const xs = [1, 2.5, 7, 30];
    const column = Float64Array.from(xs);
    expect(
      Array.from(r.broadcast!({ x: column }) as ArrayLike<number>)
    ).toEqual(xs.map((x) => run(r, { x })));
    const ints = Array.from({ length: 20 }, (_, k) => 3 * k - 10);
    const big = js(['Add', ['At', ['List', ...ints], 'n'], 1], {
      mode: 'bigint',
    });
    expect(big.preambleOnce).toContain('(-10n), (-7n)');
    expect(run(big, { n: 3 })).toBe(BigInt(ints[2] + 1));
  });

  test('GLSL and the interval mode do not compute the list once', () => {
    const glsl = compile(box(at), { ...IR, to: 'glsl' });
    const interval = compile(box(at), { ...IR, to: 'interval-js' });
    expect(glsl.code).toContain(String(CONSTANTS[1]));
    expect(`${interval.preambleOnce ?? ''}${interval.code}`).not.toMatch(
      /_copy/
    );
  });

  test('robustness: a list of 40,000 constants, and one of 100,000', () => {
    const list = (n: number) =>
      box([
        'At',
        ['List', ...Array.from({ length: n }, (_, k) => k + 0.5)],
        ['Floor', 'x'],
      ]);
    const e = list(40_000);
    let start = performance.now();
    const r = compile(e, IR);
    // A hang guard, not a speed measure.
    expect(performance.now() - start).toBeLessThan(20_000);
    expect(r.code!.length).toBeLessThan(200);
    expect(run(r, { x: 30_000 })).toBe(29_999.5);
    // Beyond the count of nodes that the lowering reads, a decline.
    const f = list(100_000);
    start = performance.now();
    expect(() => compile(f, IR)).toThrow(/more than 50000 nodes/);
    expect(performance.now() - start).toBeLessThan(20_000);
  });
});
