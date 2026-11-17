/**
 * The pass `inline` of the profile `ir` (batch G21; README of
 * `src/compute-engine/compilation/ir/`, "User functions"): a call of a small
 * user function in a loop is a copy of the callee's lowered body, so that
 * `cse` and `invariants` see the calls it makes.
 *
 * The witness is Tycho's `showcase/voronoi-diagram`: `n(x, y, k)` calls
 * `F(x, y)`, which holds a loop, and is called at each pass of the loops of
 * `Z`, `v`, `u` and `H`. Copied, the call of `F` reads no index and is made
 * once, before the loop.
 *
 * Each program is compared with the same compilation without the pass
 * (`compileSlice()` with `inline: false`; with `unrollSums: false`, so that
 * a `Sum` of constant bounds stays the loop whose calls the rule `'loop'`
 * copies, as on JavaScript before sums were written out there; the written
 * out sums are in `ir-js-unroll.test.ts`): on JavaScript the values are the
 * same bit for bit, and they agree with the interpreter. On GLSL the
 * programs run in WebGL2 (the headless Chromium of
 * `scripts/glsl-check/glsl-driver.ts`, skipped without the browser) and
 * agree with JavaScript within 2e-3 (the `sin` of the driver is good to
 * about 1e-4). In the interval mode the result encloses the JavaScript
 * value.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';
import { compileSlice } from '../../src/compute-engine/compilation/ir/index';
import {
  ALL_PASSES,
  INLINE_BUDGET,
  INLINE_SIZE,
} from '../../src/compute-engine/compilation/ir/passes';

type Json = unknown;
type Point = Record<string, number>;

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('n', 'integer');

const box = (json: Json): Expression => ce.box(json as never);
function define(name: string, json: Json, signature = 'function') {
  ce.declare(name, signature);
  ce.assign(name, box(json));
}

// A function with a loop of its own, and a small one that calls it.
// prettier-ignore
define('G', ['Function', ['Sum', ['Sin', ['Add', 'p', 'j']], ['Limits', 'j', 1, 4]], 'p']);
define('h', ['Function', ['Exp', ['Multiply', -1, 'k', ['G', 'p']]], 'p', 'k']);
// prettier-ignore
define('h1', ['Function', ['Add', ['Multiply', 'p', 'q'], ['Sin', 'p']], 'p', 'q']);
const WITNESS = ['Sum', ['h', 'x', 'k'], ['Limits', 'k', 1, 8]];

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });
const glsl = (json: Json) => compile(box(json), { ...IR, to: 'glsl' });
const interval = (json: Json) =>
  compile(box(json), { ...IR, to: 'interval-js' });

/** The compilation of `json` by `compileSlice()`, with or without the pass. */
const slice = (json: Json, inline: boolean) =>
  compileSlice(box(json), {
    target: 'javascript',
    passes: { ...ALL_PASSES, inline: inline && 'loop' },
    unrollSums: false,
  } as never);

function interpreted(json: Json, point: Point): number {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, ce.number(v)])
  );
  return ce.withValues(values as never, () => {
    const v = box(json).evaluate().N();
    if (!isNumber(v)) throw new Error(`no value: ${v.toString()}`);
    return v.re;
  });
}

const agree = (v: unknown, w: number, tolerance = 1e-12) =>
  typeof v === 'number' &&
  (Object.is(v, w) || Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w)));

const POINTS: Point[] = [{ x: 0.3 }, { x: -1.2 }, { x: 2.5 }, { x: 7 }];

/** The compilation of `json` with the pass: its values are those of the
 *  compilation without it, bit for bit, and the interpreter's. */
function check(json: Json, points: Point[] = POINTS, interpreter = true) {
  const [on, off] = [slice(json, true), slice(json, false)];
  for (const p of points) {
    const [a, b] = [on.run(p), off.run(p)];
    expect([json, p, a]).toEqual([json, p, b]);
    if (interpreter && !agree(a, interpreted(json, p)))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${String(a)}, the interpreter ${interpreted(json, p)}`
      );
  }
  return on;
}

/** The number of matches of `re` in `s`. */
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

/** The number of calls of the user function `name` in the entry. */
const calls = (r: { code: string }, name: string) =>
  count(r.code, new RegExp(`u\\d+_${name}\\(`, 'g'));

describe('IR profile, batch G21: a call in a loop is a copy of its body', () => {
  test('the witness: the call of G is made once, before the loop', () => {
    const r = check(WITNESS);
    expect(calls(r, 'h')).toBe(0);
    expect(calls(r, 'G')).toBe(1);
    expect(r.code.indexOf('_G(')).toBeLessThan(r.code.indexOf('for ('));
    // Without the pass, the call of h is in the loop.
    expect(calls(slice(WITNESS, false), 'h')).toBe(1);
    // Through compile().
    const c = js(WITNESS);
    expect(c).toMatchObject({ success: true, profile: 'ir' });
    expect(c.run!({ x: 0.3 } as never)).toBe(
      slice(WITNESS, true).run({ x: 0.3 })
    );
  });

  test('on GLSL: G is called once, before the loop', () => {
    const r = glsl(WITNESS);
    expect(r).toMatchObject({ success: true });
    expect(count(r.code, /_fn_ir_u\d+_G\(/g)).toBe(1);
    expect(count(r.code, /_fn_ir_u\d+_h\(/g)).toBe(0);
    expect(r.code.indexOf('_G(')).toBeLessThan(r.code.indexOf('for ('));
  });

  test('in the interval mode: the copy, and the result encloses the JavaScript value', () => {
    // A Sum of more than 100 passes is a loop in the interval mode.
    const json = [
      'Sum',
      ['h', 'x', ['Divide', 'k', 50]],
      ['Limits', 'k', 1, 120],
    ];
    const r = interval(json);
    expect(r).toMatchObject({ success: true });
    // The mode writes out the Sum of G: G is copied too, and its sines are
    // computed before the loop.
    expect(calls(r, 'h')).toBe(0);
    expect(calls(r, 'G')).toBe(0);
    expect(r.code.lastIndexOf('_IA.sin(')).toBeLessThan(
      r.code.indexOf('for (')
    );
    const f = check(json, POINTS, false);
    for (const p of POINTS) {
      const v = r.run!(p as never) as { value: { lo: number; hi: number } };
      const want = f.run(p) as number;
      expect([p, v.value.lo <= want && want <= v.value.hi]).toEqual([p, true]);
    }
  });

  test('a call in a loop of no pass at run time', () => {
    const json = ['Sum', ['h', 'x', 'k'], ['Limits', 'k', 1, 'n']];
    const r = check(json, [
      { x: 0.3, n: 0 },
      { x: 0.3, n: 3 },
      { x: -2, n: 5 },
    ]);
    expect(r.run({ x: 0.3, n: 0 })).toBe(0);
    expect(calls(r, 'h')).toBe(0);
    // G may fail (a loop): it stays in a loop of a run-time count.
    expect(r.code.indexOf('_G(')).toBeGreaterThan(r.code.indexOf('for ('));
  });

  test('the same call twice, with equal and with other arguments', () => {
    const equal = check([
      'Sum',
      ['Add', ['h1', 'x', 'k'], ['h1', 'x', 'k']],
      ['Limits', 'k', 1, 5],
    ]);
    expect(calls(equal, 'h1')).toBe(0);
    // `Sin(x)` of the two copies, once and before the loop.
    expect(count(equal.code, /Math\.sin\(/g)).toBe(1);
    expect(equal.code.indexOf('Math.sin(')).toBeLessThan(
      equal.code.indexOf('for (')
    );
    const other = check([
      'Sum',
      ['Add', ['h1', 'x', 'k'], ['h1', 'k', 'x']],
      ['Limits', 'k', 1, 5],
    ]);
    expect(calls(other, 'h1')).toBe(0);
  });

  test('an integer argument of a real parameter: the operations of the callee', () => {
    define('md', ['Function', ['Mod', 'q', 3], 'q'], '(real) -> real');
    const json = ['Sum', ['Multiply', ['md', 'k'], 'x'], ['Limits', 'k', 1, 7]];
    expect(calls(check(json), 'md')).toBe(0);
    // `Mod` of a real parameter is the real `mod`, not the integer one.
    const g = glsl(json);
    expect(g.code).toMatch(/mod\(v\d+, 3\.0\)/);
    expect(`${g.preamble ?? ''}${g.code}`).not.toMatch(/_gpu_ir_imod/);
    // A declared real result of an integer body: the lanes differ, the call
    // stays.
    define('ir', ['Function', ['Add', 'q', 1], 'q'], '(integer) -> real');
    check(['Sum', ['Multiply', ['ir', 'k'], 'x'], ['Limits', 'k', 1, 7]]);
  });

  test('a body with an If of a missing arm, a Which, a nested call, a Block with a local', () => {
    define('wm', ['Function', ['If', ['Greater', 'q', 0], ['Sqrt', 'q']], 'q']);
    const missing = [
      'Sum',
      ['wm', ['Subtract', 'x', 'k']],
      ['Limits', 'k', 1, 3],
    ];
    const r = check(missing, [{ x: 3.5 }, { x: 7 }]);
    expect(calls(r, 'wm')).toBe(0);
    // A missing arm is NaN, as in the call.
    check(missing, [{ x: 0.5 }], false);
    expect(r.run({ x: 0.5 })).toBeNaN();
    // prettier-ignore
    define('wh', ['Function', ['Which', ['Less', 'q', 0], ['Negate', 'q'], ['Less', 'q', 1], ['Square', 'q'], 'True', 1], 'q']);
    // prettier-ignore
    expect(calls(check(['Sum', ['wh', ['Subtract', 'x', ['Multiply', 0.4, 'k']]], ['Limits', 'k', 1, 9]]), 'wh')).toBe(0);
    // `wc` calls `wh` and `h1`, which are copied too.
    define('wc', ['Function', ['Add', ['wh', 'q'], ['h1', 'q', 2]], 'q']);
    const nested = check([
      'Sum',
      ['wc', ['Multiply', 'x', 'k']],
      ['Limits', 'k', 1, 5],
    ]);
    for (const f of ['wc', 'wh', 'h1'])
      expect([f, calls(nested, f)]).toEqual([f, 0]);
    // prettier-ignore
    define('bl', ['Function', ['Block', ['Declare', 't', "'real'", ['Square', 'q']], ['Add', 't', ['Sin', 't']]], 'q']);
    expect(
      calls(
        check(['Sum', ['bl', ['Add', 'x', 'k']], ['Limits', 'k', 1, 4]]),
        'bl'
      )
    ).toBe(0);
  });

  test('an argument with a draw is evaluated once; the warnings are those without the pass', () => {
    define('hd', ['Function', ['Add', 'q', ['Multiply', 'q', 'k']], 'q', 'k']);
    // prettier-ignore
    const json = ['WithRandomSeed', 3, ['Sum', ['hd', ['Random'], 'k'], ['Limits', 'k', 1, 3]]];
    const [on, off] = [slice(json, true), slice(json, false)];
    expect(calls(on, 'hd')).toBe(0);
    expect(count(`${on.preambleOnce}${on.code}`, /drawNextRandomNumber/g)).toBe(
      1
    );
    expect(on.warnings).toEqual(off.warnings);
    expect(on.warnings.map((w) => w.code)).toEqual(['seeded-draw-order']);
    expect(on.run({})).toBe(off.run({}));
    expect(on.run({})).toBe(on.run({}));
  });
});

describe('IR profile, batch G21: the defects of a copy lowered again', () => {
  test('a constant argument: the body keeps the signature of the call (Sqrt stays real)', () => {
    define('ss', [
      'Function',
      ['If', ['GreaterEqual', 'q', 0], ['Sqrt', 'q'], 0],
      'q',
    ], '(real) -> real');
    define('su', [
      'Function',
      ['If', ['GreaterEqual', 'q', 0], ['Sqrt', 'q'], 0],
      'q',
    ]);
    for (const f of ['ss', 'su']) {
      // prettier-ignore
      const json = ['Sum', ['Add', [f, -1.5], [f, 2.25], ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 3]];
      const r = check(json);
      expect([f, calls(r, f)]).toEqual([f, 0]);
      expect(r.run({ x: 0.5 })).toBe(3 * 1.5 + 3);
    }
  });

  test('an input that the callee reads has the type of the option inputs', () => {
    define('fa', ['Function', ['Multiply', 'a', 't'], 't']);
    const json = ['Add', ['Sum', ['fa', 'k'], ['Limits', 'k', 1, 3]], 'a'];
    const r = compile(box(json), { ...IR, inputs: { a: 'integer' } } as never);
    expect(r).toMatchObject({ success: true, profile: 'ir' });
    expect(r.code).not.toMatch(/u\d+_fa\(/);
    expect(r.run!({ a: 2 } as never)).toBe(14);
    expect(r.run!({ a: -3 } as never)).toBe(-21);
  });

  test('symbolDeps names a function whose calls are all copies', () => {
    const symbolDeps = new Set<string>();
    const r = js(WITNESS, { symbolDeps });
    expect(r.code).not.toMatch(/u\d+_h\(/);
    expect([...symbolDeps].sort()).toEqual(['G', 'h']);
  });
});

describe('IR profile, batch G21: a call that stays a call', () => {
  test('a recursive function, direct and mutual', () => {
    // prettier-ignore
    define('fact', ['Function', ['If', ['LessEqual', 'q', 1], 1, ['Multiply', 'q', ['fact', ['Subtract', 'q', 1]]]], 'q'], '(integer) -> integer');
    const r = check(['Sum', ['fact', 'k'], ['Limits', 'k', 1, 5]], [{}]);
    expect(r.run({})).toBe(1 + 2 + 6 + 24 + 120);
    expect(calls(r, 'fact')).toBe(1);
    ce.declare('ev', '(integer) -> integer');
    ce.declare('od', '(integer) -> integer');
    // prettier-ignore
    ce.assign('ev', box(['Function', ['If', ['LessEqual', 'q', 0], 1, ['od', ['Subtract', 'q', 1]]], 'q']));
    // prettier-ignore
    ce.assign('od', box(['Function', ['If', ['LessEqual', 'q', 0], 0, ['ev', ['Subtract', 'q', 1]]], 'q']));
    const m = check(['Sum', ['ev', 'k'], ['Limits', 'k', 1, 6]], [{}]);
    expect(m.run({})).toBe(3);
    expect(calls(m, 'ev')).toBe(1);
  });

  test('a function with a draw: the call, and its warning', () => {
    define('rd', ['Function', ['Add', 'q', ['Random']], 'q']);
    // prettier-ignore
    const json = ['WithRandomSeed', 5, ['Sum', ['rd', 'k'], ['Limits', 'k', 1, 3]]];
    const [on, off] = [slice(json, true), slice(json, false)];
    expect(calls(on, 'rd')).toBe(1);
    expect(on.code).toBe(off.code);
    expect(on.warnings).toEqual(off.warnings);
  });

  test('a function with a loop', () => {
    // prettier-ignore
    const json = ['Sum', ['G', ['Multiply', 'x', 'k']], ['Limits', 'k', 1, 4]];
    expect(calls(check(json), 'G')).toBe(1);
  });

  test('a body over the size limit', () => {
    // Each term is a constant, a sum, a sine, a product and a sum.
    const terms = Math.ceil(INLINE_SIZE / 4);
    // prettier-ignore
    define('big', ['Function', ['Add', ...Array.from({ length: terms }, (_, i) => ['Multiply', i + 2, ['Sin', ['Add', 'q', i + 1]]])], 'q']);
    const json = [
      'Sum',
      ['big', ['Multiply', 'x', 'k']],
      ['Limits', 'k', 1, 3],
    ];
    expect(calls(check(json), 'big')).toBe(1);
  });

  test('past the budget of the program', () => {
    // A body under the size limit, called with 80 other arguments in one
    // loop: the copies stop at the budget.
    // prettier-ignore
    define('s1', ['Function', ['Add', ...Array.from({ length: 6 }, (_, i) => ['Multiply', i + 2, ['Sin', 'q']])], 'q']);
    // prettier-ignore
    const json = ['Sum', ['Add', ...Array.from({ length: 80 }, (_, i) => ['s1', ['Add', 'x', 'k', i]])], ['Limits', 'k', 1, 2]];
    const r = check(json, [{ x: 0.3 }, { x: 2.5 }]);
    const left = calls(r, 's1');
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(80);
    expect(80 - left).toBeLessThanOrEqual(INLINE_BUDGET.loop);
  });

  test('the budget of the rule of repeated calls is larger', () => {
    // The interval mode's shape: a small function that calls one with a
    // loop, read at the 16 written-out terms of each of four sums. With the
    // budget of the rule 'loop' the copies stop in the second sum (16 calls
    // of `h` stay); with the one of 'repeated' no call of `h` stays, and
    // `cse` leaves one call of `G`, the function with the loop.
    // prettier-ignore
    const sum = (w: number) => ['Sum', ['Multiply', w, ['h', 'x', 'k']], ['Limits', 'k', 1, 16]];
    const json = ['Add', sum(2), sum(3), sum(5), sum(7)];
    const p = compileSlice(box(json), {
      target: 'javascript',
      mode: 'interval',
      passes: ALL_PASSES,
    });
    const text = `${p.preambleOnce}\n${p.preamblePerCall ?? ''}\n${p.code}`;
    const callsOf = (name: string) =>
      (text.match(new RegExp(`\\bu\\d+_${name}\\(`, 'g')) ?? []).length;
    expect(callsOf('h')).toBe(0);
    expect(callsOf('G')).toBe(1);
    const r = interval(json);
    expect(r).toMatchObject({ success: true });
    const at = r.run!({ x: { lo: 0.3, hi: 0.3 } }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    const w = interpreted(json, { x: 0.3 });
    expect(at.kind).toBe('interval');
    expect(at.value.lo).toBeLessThanOrEqual(w);
    expect(at.value.hi).toBeGreaterThanOrEqual(w);
  });

  test('a call that is not in a loop', () => {
    expect(calls(check(['Add', ['h1', 'x', 2], 1]), 'h1')).toBe(1);
  });

  test('a result that is a parameter of another lane than its argument', () => {
    // `id(k)` of an integer `k` would read the integer where the build
    // yields a real: the call stays. Another body is copied.
    define('id', ['Function', 'q', 'q'], '(real) -> real');
    define('id2', ['Function', ['Add', 'q', 0.5], 'q'], '(real) -> real');
    for (const [f, left] of [
      ['id', 1],
      ['id2', 0],
    ] as const) {
      // prettier-ignore
      const json = ['Sum', ['Map', ['Function', [f, 'k'], 'k'], ['Range', 1, 'n']]];
      const r = check(json, [{ n: 0 }, { n: 4 }]);
      expect([f, calls(r, f)]).toEqual([f, left]);
    }
  });
});

/** A second engine, with lists for the GLSL storage and `At`. */
const ce2 = new ComputeEngine();
ce2.declare('x', 'real');
ce2.declare('n', 'integer');
ce2.declare('A', 'list<real^3>');
ce2.declare('H', 'list<real^7>');
ce2.declare('H_1', 'list<real^90001>');
function define2(name: string, json: Json, signature = 'function') {
  ce2.declare(name, signature);
  ce2.assign(name, ce2.box(json as never));
}
// prettier-ignore
define2('c', ['Function', ['Multiply', ['At', 'H', ['Add', ['Floor', 't'], 1]], 't'], 'H', 't'], '(list<real^90001>, real) -> real');
define2('gl', ['Function', ['Multiply', ['At', 'H', 'j'], 2], 'j']);
define2(
  'la',
  ['Function', ['At', 'L', 'j'], 'L', 'j'],
  '(list<real^3>, integer) -> real'
);
define2(
  'lar',
  ['Function', ['At', 'L', 'j'], 'L', 'j'],
  '(list<real^3>, real) -> real'
);
define2(
  'la7',
  ['Function', ['At', 'L', 'j'], 'L', 'j'],
  '(list<real^7>, integer) -> real'
);
// prettier-ignore
define2('pk', ['Function', ['If', ['LessEqual', 'j', 3], ['At', 'L', 'j'], 0], 'L', 'j'], '(list<real^3>, integer) -> real');
// prettier-ignore
define2('pk5', ['Function', ['If', ['LessEqual', 'j', 3], ['At', 'L', 'j'], 0.5], 'L', 'j'], '(list<real^3>, integer) -> real');
// prettier-ignore
define2('sa', ['Function', ['If', ['And', ['GreaterEqual', 'j', 1], ['LessEqual', 'j', ['Length', 'L']]], ['At', 'L', 'j'], 0], 'L', 'j'], '(list<real^3>, integer) -> real');
// Wrappers that reach the `At` through another function.
// prettier-ignore
define2('nx', ['Function', ['la', 'L', ['Add', 'j', 1]], 'L', 'j'], '(list<real^3>, integer) -> real');
// prettier-ignore
define2('prev', ['Function', ['sa', 'L', ['Subtract', 'j', 1]], 'L', 'j'], '(list<real^3>, integer) -> real');
// prettier-ignore
define2('sel', ['Function', ['la', 'L', ['If', ['Greater', 'c', 0], 1, 5]], 'L', 'c'], '(list<real^3>, real) -> real');
const glsl2 = (json: Json, options: object = {}) =>
  compile(ce2.box(json as never), { ...IR, to: 'glsl', ...options });
const sum = (body: Json, hi: Json = 'n') => [
  'Sum',
  body,
  ['Limits', 'k', 1, hi],
];
/** The program of F1: 16 reads of a list of 90,001 elements in storage. */
const STORAGE = sum(['c', 'H_1', ['Multiply', 'k', 'x']], 16);

describe('IR profile, batch G21: a function with no call left, and At', () => {
  test('a function whose calls are all copies is not printed: its list is in storage', () => {
    const r = glsl2(STORAGE, { storage: { H_1: 'sampler2D' } });
    expect(r).toMatchObject({ success: true });
    const text = `${r.preamble ?? ''}\n${r.code}`;
    expect(text).not.toMatch(/\[90001\]/);
    expect(text).not.toMatch(/_fn_ir_u\d+_c\b/);
    const symbolDeps = new Set<string>();
    compile(ce2.box(STORAGE as never), {
      ...IR,
      to: 'glsl',
      storage: { H_1: 'sampler2D' },
      symbolDeps,
    });
    expect([...symbolDeps]).toEqual(['c']);
  });

  test('a function that reads an input in storage, whose calls are all copies, compiles', () => {
    const r = glsl2(sum(['Multiply', 'x', ['gl', 'k']], 5), {
      storage: { H: 'sampler2D' },
    });
    expect(r).toMatchObject({ success: true });
  });

  // prettier-ignore
  const AT: [string, Json, object?][] = [
    ['la(A, 5)', sum(['Multiply', 'k', ['la', 'A', 5]])],
    ['la(A, 0)', sum(['Multiply', 'k', ['la', 'A', 0]])],
    ['la(A, 1.5) of a real index', sum(['Multiply', 'k', ['lar', 'A', 1.5]])],
    ['la7(H, 9) of a list in storage', sum(['Multiply', 'k', ['la7', 'H', 9]]), { storage: { H: 'sampler2D' } }],
    ['pk(A, 5), a guarded At', sum(['Multiply', 'k', ['pk', 'A', 5]])],
    ['pk(A, 5), a guarded At with a real arm', sum(['Multiply', 'k', ['pk5', 'A', 5]])],
    ['sa(A, 0) + sa(A, 2), a guard by Length', sum(['Multiply', 'k', ['Add', ['sa', 'A', 0], ['sa', 'A', 2]]])],
    ['nx(A, 4), an At in a function that the callee calls', sum(['Multiply', 'k', ['nx', 'A', 4]])],
    ['prev(A, 1) + prev(A, 3), a guarded At two calls down', sum(['Multiply', 'k', ['Add', ['prev', 'A', 1], ['prev', 'A', 3]]])],
    ['sel(A, 2) + sel(A, -2), an index chosen by a constant', sum(['Multiply', 'k', ['Add', ['sel', 'A', 2], ['sel', 'A', -2]]])],
  ];
  test.each(AT)(
    'a call of a constant argument whose callee holds an At stays a call: %s',
    (_, json, options = {}) => {
      expect(glsl2(json, options)).toMatchObject({ success: true });
      if ('storage' in options) return;
      const slice2 = (inline: boolean) =>
        compileSlice(ce2.box(json as never), {
          target: 'javascript',
          passes: { ...ALL_PASSES, inline: inline && 'loop' },
        });
      const [on, off] = [slice2(true), slice2(false)];
      for (const point of [
        { A: [0.5, -2, 3], n: 0 },
        { A: [0.5, -2, 3], n: 4 },
      ])
        expect(on.run(point)).toEqual(off.run(point));
    }
  );

  test('a copied call of a function that runs a Loop moves out of the loop, within the iteration budget', () => {
    // prettier-ignore
    define2('LL', ['Function', ['Block', ['Declare', 's', "'real'", 0], ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'p', 'i']]], ['Element', 'i', ['Range', 1, 100]]], 's'], 'p']);
    define2('hh', ['Function', ['Multiply', 'k', ['LL', 'p']], 'p', 'k']);
    const json = sum(['hh', 'x', 'k'], 3);
    const slice2 = (inline: boolean) =>
      compileSlice(ce2.box(json as never), {
        target: 'javascript',
        iterationBudget: 150,
        passes: { ...ALL_PASSES, inline: inline && 'loop' },
      });
    expect(slice2(true).run({ x: 0.3 })).toBeCloseTo(9090, 9);
    expect(() => slice2(false).run({ x: 0.3 })).toThrow(/iteration/);
  });
});

describe('IR profile, batch G21: robustness', () => {
  // The times are bounded by the timeouts of the tests, not by assertions.
  test('a chain of 15 functions, each calling the previous three times, in a Sum', () => {
    define('d0', ['Function', ['Square', 'q'], 'q']);
    for (let i = 1; i <= 15; i++)
      // prettier-ignore
      define(`d${i}`, ['Function', ['Add', ...[0, 1, 2].map((m) => [`d${i - 1}`, ['Add', 'q', m]])], 'q']);
    // d_i(q) = Σ_m d_{i-1}(q + m), computed by shift.
    const reference = (x: number) => {
      let c = new Map<number, number>([[0, 1]]);
      for (let i = 0; i < 15; i++) {
        const next = new Map<number, number>();
        for (const [s, w] of c)
          for (let m = 0; m < 3; m++)
            next.set(s + m, (next.get(s + m) ?? 0) + w);
        c = next;
      }
      let sum = 0;
      for (let k = 1; k <= 3; k++)
        for (const [s, w] of c) sum += w * (x + k + s) ** 2;
      return sum;
    };
    const json = ['Sum', ['d15', ['Add', 'x', 'k']], ['Limits', 'k', 1, 3]];
    const r = check(json, [{ x: 0.3 }, { x: -2 }], false);
    for (const x of [0.3, -2])
      expect(agree(r.run({ x }), reference(x), 1e-10)).toBe(true);
    expect(glsl(json)).toMatchObject({ success: true });
    expect(interval(json)).toMatchObject({ success: true });
  }, 60_000);

  test('a shared graph of 2^20 paths through 20 functions', () => {
    define('g0', ['Function', 'q', 'q']);
    for (let i = 1; i <= 20; i++)
      // prettier-ignore
      define(`g${i}`, ['Function', ['Add', [`g${i - 1}`, 'q'], ['Sin', [`g${i - 1}`, 'q']]], 'q']);
    const reference = (x: number) => {
      let sum = 0;
      for (let k = 1; k <= 3; k++) {
        let g = x * k;
        for (let i = 0; i < 20; i++) g = g + Math.sin(g);
        sum += g;
      }
      return sum;
    };
    const json = [
      'Sum',
      ['g20', ['Multiply', 'x', 'k']],
      ['Limits', 'k', 1, 3],
    ];
    const r = check(json, [{ x: 0.3 }, { x: -2 }], false);
    for (const x of [0.3, -2])
      expect(agree(r.run({ x }), reference(x))).toBe(true);
    expect(glsl(json)).toMatchObject({ success: true });
    expect(interval(json)).toMatchObject({ success: true });
  }, 60_000);

  test('three nested loops with a call at each level', () => {
    const inner = ['Sum', ['h1', 'j', 'm'], ['Limits', 'm', 1, 4]];
    // prettier-ignore
    const middle = ['Sum', ['Multiply', ['h1', 'i', 'j'], inner], ['Limits', 'j', 1, 4]];
    // prettier-ignore
    const json = ['Sum', ['Multiply', ['h1', 'x', 'i'], middle], ['Limits', 'i', 1, 4]];
    const r = check(json, [{ x: 0.3 }, { x: -1.2 }]);
    expect(calls(r, 'h1')).toBe(0);
    expect(glsl(json)).toMatchObject({ success: true });
  }, 60_000);
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
  'IR profile, batch G21: copies of calls in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test('a copy that reads a list of 90,001 elements in storage', async () => {
      const r = glsl2(STORAGE, { storage: { H_1: 'sampler2D' } });
      const source = [
        '#version 300 es',
        'precision highp float;',
        'uniform float u_x;',
        'uniform sampler2D H_1;',
        'out vec4 fragColor;',
        r.preamble ?? '',
        'float userFn(float x) {',
        r.code.includes(';') ? r.code : `return ${r.code};`,
        '}',
        'void main() { fragColor = vec4(userFn(u_x), 0.0, 0.0, 0.0); }',
      ].join('\n');
      const values = Array.from({ length: 90001 }, (_, i) => (i % 97) / 7);
      let want = 0;
      for (let k = 1; k <= 16; k++)
        want += values[Math.floor(k * 2.5)] * k * 2.5;
      const [v] = await driver.evaluate([
        {
          name: 'storage',
          source,
          uniforms: { u_x: 2.5 },
          textures: { H_1: { width: 512, values } },
        },
      ]);
      if (!v.ok) throw new Error(v.log);
      expect(agree(v.value, want, 1e-5)).toBe(true);
    }, 120_000);

    // prettier-ignore
    const programs: [string, Json][] = [
      ['the witness', WITNESS],
      ['an integer argument of a real parameter', ['Sum', ['Multiply', ['md', 'k'], 'x'], ['Limits', 'k', 1, 7]]],
      ['a Which', ['Sum', ['wh', ['Subtract', 'x', ['Multiply', 0.4, 'k']]], ['Limits', 'k', 1, 9]]],
      ['a constant argument', ['Sum', ['Add', ['ss', -1.5], ['ss', 2.25], ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 3]]],
      ['three nested loops', ['Sum', ['Multiply', ['h1', 'x', 'i'], ['Sum', ['Multiply', ['h1', 'i', 'j'], ['Sum', ['h1', 'j', 'm'], ['Limits', 'm', 1, 4]]], ['Limits', 'j', 1, 4]]], ['Limits', 'i', 1, 4]]],
    ];

    test.each(programs)(
      '%s agrees with JavaScript',
      async (_, json) => {
        const r = glsl(json);
        expect(r).toMatchObject({ success: true });
        const f = js(json);
        const source = (body: string) =>
          [
            '#version 300 es',
            'precision highp float;',
            'uniform float u_x;',
            'out vec4 fragColor;',
            r.preamble ?? '',
            'float userFn(float x) {',
            r.code.includes(';') ? body : `return ${body};`,
            '}',
            'void main() { fragColor = vec4(userFn(u_x), 0.0, 0.0, 0.0); }',
          ].join('\n');
        const items = POINTS.map((p) => ({
          name: JSON.stringify(p),
          source: source(r.code),
          uniforms: { u_x: p.x } as Record<string, number | number[]>,
          expected: f.run!(p as never) as number,
        }));
        const values = await driver.evaluate(items);
        for (const [i, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          expect(agree(v.value, items[i].expected, 2e-3)).toBe(true);
        }
      },
      120_000
    );
  }
);
