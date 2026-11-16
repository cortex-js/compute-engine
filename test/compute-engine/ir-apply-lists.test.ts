/**
 * `Apply` of a function literal over a scalar or a flat list, and `Map` of a
 * list of a constant length on GLSL, in the profile `ir` (batch G18, issue
 * CE-1344; README of `src/compute-engine/compilation/ir/`, "User functions"
 * and "Lists").
 *
 * The witness is Tycho's instrument
 * (`scripts/repros/2026-11-15-ce1344-broadcast-apply-lowering.mts` in the
 * Tycho repository): `Min(Apply(k ↦ Which(k = m, 10^9, True, k), d))` of a
 * scalar `d` and of a list `d`, and the same with `Map`. JavaScript agrees
 * with the interpreter within 1e-12. On GLSL the programs run in WebGL2 (the
 * headless Chromium of `scripts/glsl-check/glsl-driver.ts`) and agree with
 * JavaScript within single-float precision; without the browser, those
 * tests are skipped.
 */

import { existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
for (const name of ['x', 'm']) ce.declare(name, 'real');
ce.declare('n', 'integer');
ce.declare('L', 'list<real^3>');
ce.declare('D', 'list<real>');
ce.declare('g', 'function');
ce.assign('g', ce.box(['Function', ['Multiply', 2, 'u'], 'u'] as never));

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, to: 'glsl', ...options });

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  // A lazy collection (`Map` of an input).
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((n) => ce.number(n))
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () => read(box(json).evaluate().N()));
}

/** `v` and `w` have one shape and agree within `tolerance`. */
function agree(v: unknown, w: unknown, tolerance = 1e-12): boolean {
  if (Array.isArray(w))
    return (
      Array.isArray(v) &&
      v.length === w.length &&
      w.every((x, i) => agree(v[i], x, tolerance))
    );
  return (
    typeof v === 'number' &&
    typeof w === 'number' &&
    Math.abs(v - w) <= tolerance * Math.max(1, Math.abs(w))
  );
}

function check(json: Json, points: Point[]) {
  const r = js(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    if (!agree(got, want))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${JSON.stringify(got)}, the interpreter ${JSON.stringify(want)}`
      );
  }
  return r;
}

const W = ['Function', ['Which', ['Equal', 'k', 'm'], 1e9, 'True', 'k'], 'k'];
const sq = (d: number) => ['Square', ['Subtract', 'x', d]];
const LIST3 = ['List', ['Square', 'x'], sq(1), sq(2)];
const LIST6 = ['List', ['Square', 'x'], sq(1), sq(2), sq(3), sq(4), sq(5)];
const witness = (op: string, d: Json) => ['Min', [op, W, d]];

// Each arm of the `Which` is taken: m is the square of x, of x - 1, of
// x - 2, of none. The values are exact in single floats too.
// prettier-ignore
const POINTS: Point[] = [
  { x: 0.3, m: 0.09, L: [0.09, 2, 3] },
  { x: 0.5, m: 0.25, L: [1, 0.25, 4] },
  { x: 1.5, m: 0.25, L: [5, 6, 0.25] },
  { x: 2.5, m: 0.25, L: [-1, 2, 3] },
  { x: 2.5, m: 7, L: [7, 7, 7] },
];

describe('IR profile, batch G18: Min and Max of one operand', () => {
  test('of one scalar: the operand, on the three targets', () => {
    for (const head of ['Min', 'Max']) {
      check([head, 'x'], POINTS);
      check([head, ['Floor', 'x']], POINTS);
      expect(glsl([head, 'x']).code).toBe('x');
      expect(
        compile(box([head, 'x']), { ...IR, to: 'interval-js' })
      ).toMatchObject({
        success: true,
      });
    }
    expect(
      js(['Max', ['Multiply', 'n', 7]], { mode: 'bigint' }).run!({
        n: 3n,
      } as never)
    ).toBe(21n);
  });

  test('of one list or one tuple: its elements, as before', () => {
    check(['Min', 'L'], POINTS);
    check(['Max', ['List', 1, 'x']], POINTS);
    check(['Max', ['Tuple', 'x', 2]], POINTS);
  });

  test('of a literal list of one element: the interpreter value, with no array', () => {
    for (const json of [
      ['Max', ['List', 'x']],
      ['Min', ['List', ['Floor', 'x']]],
      ['Sum', ['List', 'x']],
    ]) {
      const r = check(json, POINTS);
      expect(r.code).not.toMatch(/\[|for \(/);
      for (const p of POINTS)
        expect(r.run!(p as never)).toBe(interpreted(json, p));
      const interval = compile(box(json), { ...IR, to: 'interval-js' });
      expect(interval.code).not.toMatch(/\[|for \(/);
      const v = interval.run!({ x: 0.3 } as never) as {
        value: { lo: number; hi: number };
      };
      const want = interpreted(json, { x: 0.3 }) as number;
      expect(v.value.lo <= want && want <= v.value.hi).toBe(true);
    }
  });

  test('of a boolean or a complex number: a decline (the interpreter has no value)', () => {
    expect(failure(() => js(['Min', ['Less', 'x', 1]]))).toMatch(
      /Min with 1 operands/
    );
    expect(failure(() => js(['Max', ['Complex', 'x', 1]]))).toMatch(
      /Max with 1 operands/
    );
  });
});

describe('IR profile, batch G18: Apply of a literal over a list (CE-1344)', () => {
  test('the witness: a scalar, a literal list, an input list<real^3>, a list of 6', () => {
    const r = check(witness('Apply', ['Square', 'x']), POINTS);
    expect(r.run!({ x: 0.3, m: 0.09 } as never)).toBe(1e9);
    expect(
      check(witness('Apply', LIST3), POINTS).run!({ x: 0.3, m: 0.09 } as never)
    ).toBeCloseTo(0.49, 12);
    check(witness('Apply', 'L'), POINTS);
    check(witness('Apply', LIST6), POINTS);
    // The list itself, of the mapped shape.
    check(['Apply', W, LIST3], POINTS);
    check(['Apply', W, 'L'], POINTS);
  });

  test('is the code of Map', () => {
    for (const d of [LIST3, 'L', LIST6]) {
      expect(js(witness('Apply', d)).code).toBe(js(witness('Map', d)).code);
      expect(glsl(witness('Apply', d)).code).toBe(glsl(witness('Map', d)).code);
    }
    expect(js(['Apply', W, 'D']).code).toBe(js(['Map', W, 'D']).code);
  });

  test('in the body of a Sum that reads the index, and a list that reads it', () => {
    // prettier-ignore
    const json = ['Sum', ['Sum', ['Apply', ['Function', ['Multiply', 'k', 'j'], 'k'], ['List', 1, 'x', 'j']]], ['Limits', 'j', 1, 'n']];
    check(
      json,
      [0, 1, 4].map((n) => ({ x: 0.3, n }))
    );
  });

  test('the list argument is lowered once: a write or a draw in it runs once', () => {
    // prettier-ignore
    const write = ['Block', ['Declare', 't', "'real'", 1], ['Sum', ['Apply', ['Function', ['Multiply', 2, 'k'], 'k'], ['Block', ['Assign', 't', ['Add', 't', 'x']], ['List', 't', 't']]]]];
    for (const x of [0.3, 1.5])
      expect(js(write).run!({ x } as never)).toBeCloseTo(4 * (1 + x), 12);
    expect(agree(js(write).run!({ x: 0.3 } as never), interpreted(write, { x: 0.3 }))).toBe(true);
    // prettier-ignore
    const draws = ['WithRandomSeed', 5, ['Apply', ['Function', ['Add', 'k', 1], 'k'], ['List', ['Random'], ['Random']]]];
    expect(agree(js(draws).run!(), interpreted(draws, {}))).toBe(true);
    // A read of a host name: the code of `Map`, with the same reads.
    const host = (op: string) =>
      js(['Min', [op, W, ['List', 'T', ['Square', 'T'], 'x']]], {
        vars: { T: 'T' },
      }).code;
    expect(host('Apply')).toBe(host('Map'));
  });

  test('a body with a draw: one draw per element, the interpreter’s numbers', () => {
    // prettier-ignore
    const json = ['WithRandomSeed', 7, ['Apply', ['Function', ['Add', 'k', ['Random']], 'k'], ['List', 1, 'x', 3]]];
    const r = check(json, [{ x: 0.5 }]);
    expect((r.run!({ x: 0.5 } as never) as number[]).length).toBe(3);
  });

  test('an argument of run-time length (JavaScript)', () => {
    check(
      ['Apply', W, 'D'],
      [
        { m: 2, D: [] },
        { m: 2, D: [2] },
        { m: 2, D: [1, 2, 3] },
      ]
    );
  });

  // Each name gives the interpreter's value.
  // prettier-ignore
  test.each([
    ['a nested list (maps to the leaves: [[2, 2.3], [4, 5]])', ['Apply', ['Function', ['Add', 'k', 1], 'k'], ['List', ['List', 1, 'x'], ['List', 3, 4]]], /a list or a tuple argument of Apply/],
    ['a tuple (atomic: an incompatible-type error)', ['Apply', ['Function', ['Add', 'k', 1], 'k'], ['Tuple', 1, 'x']], /a list or a tuple argument of Apply/],
    ['a list of points (a point is atomic: a list of errors)', ['Apply', ['Function', ['Add', 'k', 1], 'k'], ['List', ['Tuple', 1, 'x'], ['Tuple', 3, 4]]], /a list or a tuple argument of Apply/],
    ['several parameters with a list (maps: [4, 3.3])', ['Apply', ['Function', ['Add', 'a', 'b'], 'a', 'b'], ['List', 1, 'x'], 3], /a list or a tuple argument of Apply/],
    ['a literal whose parameter is a collection by its signature (bound whole: 2)', ['Apply', ['Function', ['Length', 'k'], 'k'], ['List', 1, 'x']], /a list or a tuple argument of Apply/],
    ['a list of booleans (maps: [False, True])', ['Apply', ['Function', ['Not', 'k'], 'k'], ['List', 'True', ['Less', 'x', 0]]], /a list or a tuple argument of Apply/],
    ['a typed parameter (maps: [2, 1.3]; every typed parameter of an Apply declines)', ['Apply', ['Function', ['Add', 'k', 1], ['Typed', 'k', "'real'"]], ['List', 1, 'x']], /one untyped parameter per argument/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => js(json))).toMatch(cause);
  });
});

describe('IR profile, batch G18: Map of a list of a constant length on GLSL', () => {
  // prettier-ignore
  test.each([
    ['the witness, Apply of a scalar', witness('Apply', ['Square', 'x'])],
    ['the witness, Apply of a literal list', witness('Apply', LIST3)],
    ['the witness, Apply of a list<real^3>', witness('Apply', 'L')],
    ['the witness, Apply of a list of 6 (an array)', witness('Apply', LIST6)],
    ['the control, Map of a literal list', witness('Map', LIST3)],
    ['a list result, a vec3', ['Map', W, 'L']],
    ['a body that calls a user function', ['Sum', ['Map', ['Function', ['g', 'k'], 'k'], LIST3]]],
    ['a list of 4 (a vec4)', ['Sum', ['Map', W, ['List', 'x', 1, 2, 'm']]]],
    ['a list of 5 (an array)', ['Sum', ['Map', W, ['List', 'x', 1, 2, 'm', 4]]]],
    ['a one-clause Comprehension', ['Sum', ['Comprehension', ['Sin', 'k'], ['Element', 'k', 'L']]]],
    ['a user function of a scalar parameter over a literal list', ['Sum', ['g', LIST3]]],
    ['a user function of a scalar parameter over a list<real^3>', ['At', ['g', 'L'], 2]],
  ])('%s compiles', (_, json) => {
    expect(glsl(json)).toMatchObject({ success: true, profile: 'ir' });
    check(json, POINTS);
  });

  test('the list of 6 is a float[6], the list of 4 a vec4', () => {
    expect(glsl(['Apply', W, LIST6]).code).toMatch(/^return float\[6\]\(/m);
    expect(glsl(['Map', W, ['List', 'x', 1, 2, 'm']]).code).toMatch(
      /^return vec4\(/m
    );
  });

  // prettier-ignore
  test.each([
    ['a list of run-time length', ['Sum', ['Map', W, 'D']], /it needs a stated length/],
    ['a Filter', ['Sum', ['Filter', 'L', ['Function', ['Less', 'k', 2], 'k']]], /the region filter/],
    ['a Range of a run-time length', ['Sum', ['Map', W, ['Range', 1, 'n']]], /rangecount/],
    ['a Comprehension of two clauses', ['Sum', ['Comprehension', ['Multiply', 'k', 'j'], ['Element', 'k', 'L'], ['Element', 'j', 'L']]], /the region build/],
    ['a list of more than 64 elements', ['Sum', ['Map', W, ['List', ...Array.from({ length: 65 }, (_, i) => ['Add', 'x', i])]]], /the region build/],
    ['a body of a point', ['Map', ['Function', ['Tuple', 'k', 'k'], 'k'], 'L'], /a list of rank 2/],
    ['a draw', ['Map', ['Function', ['Add', 'k', ['Random']], 'k'], 'L'], /Random/],
  ])('%s declines', (_, json, cause) => {
    expect(failure(() => glsl(json))).toMatch(cause);
  });
});

describe('IR profile, batch G18: robustness', () => {
  /** a(i + 1) = Apply(k ↦ k + Sum(a(i)), a(i)) over `levels`: each level
   *  reads a(i) twice, a graph of 2^levels paths. Sum(a(n)) = 4^n · Sum(L).
   *  With `distinct`, the parameter of each level has a name of its own. */
  const graph = (levels: number, distinct: boolean): Expression => {
    let a: Expression = ce.box('L');
    for (let i = 0; i < levels; i++) {
      const k = ce.box(distinct ? `k${i}` : 'k');
      a = ce.function('Apply', [
        ce.function('Function', [
          ce.function('Add', [k, ce.function('Sum', [a])]),
          k,
        ]),
        a,
      ]);
    }
    return ce.function('Sum', [a]);
  };
  // The time is bounded by the timeout of the test, not by an assertion: a
  // loaded machine stalls a compile of 14 ms for seconds. The engine builds
  // the graph itself in a time that doubles at each level (CE-1345): 16
  // levels.
  test('a shared graph of 2^16 paths through Apply', () => {
    // One parameter name for every level: a(i) reads `k`, which each body
    // binds again, so the lowering does not share it, and declines.
    const same = graph(16, false);
    expect(failure(() => compile(same, IR))).toMatch(
      /more than 50000 nodes to lower/
    );
    expect(failure(() => compile(same, { ...IR, to: 'glsl' }))).toMatch(
      /builds of more than 4096 elements/
    );
    const root = graph(16, true);
    const r = compile(root, IR);
    expect(r.code.length).toBeLessThan(60_000);
    expect(r.run!({ L: [1, 2, 3] } as never)).toBe(6 * 4 ** 16);
    // On GLSL the reference analysis of the adapter (`analyzeReferences()`)
    // walks the graph by paths (CE-1348): 12 levels.
    expect(compile(graph(12, true), { ...IR, to: 'glsl' }).success).toBe(true);
  }, 60_000);

  test('a chain of 1,000 operands', () => {
    const root = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, i) =>
        ce.function('Min', [
          ce.function('Apply', [
            box(['Function', ['Multiply', 'k', i + 1], 'k']),
            ce.box('L'),
          ]),
        ])
      )
    );
    for (const to of ['javascript', 'glsl'] as const)
      expect(compile(root, { ...IR, to })).toMatchObject({ success: true });
    // Min(L) · (1 + 2 + … + 1000) for a positive L.
    expect(compile(root, IR).run!({ L: [2, 3, 4] } as never)).toBe(2 * 500_500);
  }, 60_000);

  test('nested builds: unrolled on GLSL up to 4,096 elements, then a decline', () => {
    const L8 = [
      'List',
      ...Array.from({ length: 8 }, (_, i) => ['Add', 'x', i]),
    ];
    // prettier-ignore
    const inner = (j: string) => ['Sum', ['Map', ['Function', ['Multiply', 'k', j], 'k'], L8]];
    // prettier-ignore
    const json = ['Sum', ['Map', ['Function', inner('j'), 'j'], L8]];
    check(json, [{ x: 0.5 }]);
    expect(glsl(json)).toMatchObject({ success: true });
    const L64 = [
      'List',
      ...Array.from({ length: 64 }, (_, i) => ['Add', 'x', i]),
    ];
    // prettier-ignore
    const wide = ['Sum', ['Map', ['Function', ['Sum', ['Map', ['Function', ['Multiply', 'k', 'j'], 'k'], L64]], 'j'], L64]];
    expect(failure(() => glsl(wide))).toMatch(/more than 4096 elements/);
  }, 60_000);

  test('a loop bound at 2^53: the loop ends', () => {
    // prettier-ignore
    const json = ['Sum', ['Min', ['Apply', ['Function', ['Multiply', 'k', 'j'], 'k'], ['List', 1, 'x']]], ['Limits', 'j', 'n', ['Add', 'n', 2]]];
    const start = performance.now();
    const got = js(json).run!({ x: 0.5, n: 2 ** 53 } as never);
    expect(typeof got).toBe('number');
    expect(performance.now() - start).toBeLessThan(30_000);
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
  'IR profile, batch G18: Apply and Map in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    // prettier-ignore
    const programs: [string, Json][] = [
      ['Apply of a scalar', witness('Apply', ['Square', 'x'])],
      ['Apply of a literal list', witness('Apply', LIST3)],
      ['Apply of a list<real^3>', witness('Apply', 'L')],
      ['Apply of a list of 6', witness('Apply', LIST6)],
      ['Map of a literal list', witness('Map', LIST3)],
      ['a body that calls a user function', ['Sum', ['Map', ['Function', ['g', 'k'], 'k'], LIST3]]],
      ['a list of 4', ['Sum', ['Map', W, ['List', 'x', 1, 2, 'm']]]],
      ['a list of 5', ['Sum', ['Map', W, ['List', 'x', 1, 2, 'm', 4]]]],
      ['a user function over a literal list', ['Sum', ['g', LIST3]]],
      ['a user function over a list<real^3>', ['At', ['g', 'L'], 2]],
      ['a user function over a list of 6', ['Sum', ['g', LIST6]]],
    ];

    test.each(programs)(
      '%s agrees with JavaScript',
      async (_, json) => {
        const r = glsl(json);
        const f = js(json);
        const source = (body: string) =>
          [
            '#version 300 es',
            'precision highp float;',
            'uniform float u_x;',
            'uniform float u_m;',
            'uniform float u_L[3];',
            'out vec4 fragColor;',
            r.preamble ?? '',
            'float userFn(float x, float m, vec3 L) {',
            r.code.includes(';') ? body : `return ${body};`,
            '}',
            'void main() { fragColor = vec4(userFn(u_x, u_m, vec3(u_L[0], u_L[1], u_L[2])), 0.0, 0.0, 0.0); }',
          ].join('\n');
        const items = POINTS.map((p) => ({
          name: JSON.stringify(p),
          source: source(r.code),
          uniforms: { u_x: p.x, u_m: p.m, u_L: p.L } as Record<
            string,
            number | number[]
          >,
          expected: f.run!(p as never) as number,
        }));
        const values = await driver.evaluate(items);
        for (const [i, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          expect(agree(v.value, items[i].expected, 1e-6)).toBe(true);
        }
      },
      120_000
    );
  }
);
