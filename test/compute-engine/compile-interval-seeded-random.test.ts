/**
 * A SEEDED list draw on the interval-js compile target (Tycho item 316).
 *
 * `WithRandomSeed(s, RandomChoice(domain, k))` is how the Desmos importer
 * spells `random(k)`. The frame starts at draw 0 at each entry and
 * `RandomChoice` makes exactly `k` draws in output order, so the value is a
 * fixed list of numbers: element `i` is draw `i` of the frame. The interval
 * target compiles it to that list of point intervals (`_IA.seededChoice`),
 * with the seed folded at compile time.
 *
 * What is pinned:
 *
 * - the values are bit-identical to `evaluate()` and to the `javascript`
 *   target, for an `Interval`, a `Range` and a literal `List` domain, with `k`
 *   a literal and with `k` a declared integer symbol supplied at call time;
 * - the draw compiles where a list is used whole: a reducer (`Min`), an
 *   element-wise kernel, a `PointList` source, and the Desmos field that
 *   nests all of these;
 * - what is not supported still fails closed: an unseeded draw, a symbolic
 *   seed, a body that is not a bare `RandomChoice`, a symbolic domain;
 * - a count that is not a point, or out of range, at run time throws from
 *   the run-time helper, which the compiled `run` reports as `entire`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic } from '../../src/compute-engine/interval/index';

const ce = new ComputeEngine();
ce.declare('t', 'real');
ce.declare('N', 'integer');

const pt = (v: number) => ({ lo: v, hi: v });

const draw = (
  seed: unknown,
  n: unknown,
  domain: unknown = ['Interval', 0, ['Open', 1]]
) => ['WithRandomSeed', seed, ['RandomChoice', domain, n]];

/** The Desmos field of the Tycho document that reported item 316. */
function field(n: unknown): unknown {
  const x = draw(1, n);
  const y = draw(2, n);
  const a = ['Add', ['Multiply', 2, 'Pi', draw(3, n)], 't'];
  const P = [
    'Add',
    ['PointList', x, y],
    ['Multiply', ['Divide', 1, n], ['PointList', ['Cos', a], ['Sin', a]]],
  ];
  return [
    'Sin',
    [
      'Multiply',
      6,
      n,
      [
        'Sqrt',
        [
          'Min',
          [
            'Add',
            ['Power', ['Subtract', 'x', ['PointX', P]], 2],
            ['Power', ['Subtract', 'y', ['PointY', P]], 2],
          ],
        ],
      ],
    ],
  ];
}

function compileJS(json: unknown) {
  const r = compile(ce.box(json as any), {
    to: 'javascript',
    fallback: false,
    constantFold: false,
  });
  expect(r.success).toBe(true);
  return r;
}

function compileInterval(json: unknown) {
  const r = compile(ce.box(json as any), {
    to: 'interval-js',
    fallback: false,
  });
  expect(r.success).toBe(true);
  return r;
}

function declines(json: unknown, pattern: RegExp): void {
  const r = compile(ce.box(json as any), {
    to: 'interval-js',
    fallback: false,
  });
  expect(r.success).toBe(false);
  expect(r.error).toMatch(pattern);
}

/** The numbers of an evaluated `List`. */
function evaluated(json: unknown, subs: Record<string, number> = {}): number[] {
  let expr = ce.box(json as any);
  if (Object.keys(subs).length > 0) expr = expr.subs(subs);
  const value = expr.evaluate();
  expect(value.operator).toBe('List');
  return value.ops!.map((x) => x.re);
}

/** The lower bounds of an array of intervals, after checking that each is a
 *  point. */
function points(value: any): number[] {
  expect(Array.isArray(value)).toBe(true);
  return value.map((iv: any) => {
    expect(iv.lo).toBe(iv.hi);
    return iv.lo;
  });
}

const DOMAINS: Record<string, unknown> = {
  'Interval [0, 1)': ['Interval', 0, ['Open', 1]],
  'Interval [-2, 3]': ['Interval', ['Closed', -2], 3],
  'Range 1..10': ['Range', 1, 10],
  'Range descending 7..2': ['Range', 7, 2],
  'Range with a real step': ['Range', 0.5, 3, 0.25],
  'Range(5)': ['Range', 5],
  'literal List': ['List', 3, -1, ['Rational', 1, 3], 7.5],
};

describe('Seeded RandomChoice — parity with evaluate() and the javascript target', () => {
  for (const [name, domain] of Object.entries(DOMAINS)) {
    test(`${name}, literal count`, () => {
      const json = draw("'seed'", 12, domain);
      const want = evaluated(json);
      expect(want.length).toBe(12);
      expect(compileJS(json).run!({})).toEqual(want);
      const ia = compileInterval(json);
      expect(ia.code).toContain('_IA.seededChoice(');
      expect(points(ia.run!({}))).toEqual(want);
    });

    test(`${name}, count a declared integer symbol`, () => {
      const json = draw(42, 'N', domain);
      const want = evaluated(json, { N: 20 });
      expect(want.length).toBe(20);
      expect(compileJS(json).run!({ N: 20 })).toEqual(want);
      const ia = compileInterval(json);
      expect(points(ia.run!({ N: 20 }))).toEqual(want);
      expect(points(ia.run!({ N: pt(20) }))).toEqual(want);
    });
  }

  test('a count of zero is the empty list', () => {
    expect(compileInterval(draw(1, 0)).run!({})).toEqual([]);
    expect(compileInterval(draw(1, 'N')).run!({ N: 0 })).toEqual([]);
  });
});

describe('Seeded RandomChoice — where a list is used whole', () => {
  test('a reducer: Min of the draw', () => {
    for (const n of [20, 'N'] as const) {
      const json = ['Min', draw(1, n)];
      const want = Math.min(...evaluated(draw(1, n), { N: 20 }));
      const out: any = compileInterval(json).run!({ N: 20 });
      const band = 'kind' in out ? out.value : out;
      expect(band).toEqual(pt(want));
      expect(compileJS(json).run!({ N: 20 })).toBe(want);
    }
  });

  test('an element-wise kernel over the draw', () => {
    const json = ['Sin', draw(1, 5)];
    const want = compileJS(json).run!({}) as number[];
    const out: any = compileInterval(json).run!({});
    expect(out.length).toBe(5);
    out.forEach((r: any, i: number) => {
      const band = 'kind' in r ? r.value : r;
      expect(band.lo).toBeLessThanOrEqual(want[i]);
      expect(band.hi).toBeGreaterThanOrEqual(want[i]);
      expect(band.hi - band.lo).toBeLessThan(1e-12);
    });
  });

  for (const n of [20, 'N'] as const) {
    test(`the Desmos field, count ${n}`, () => {
      const json = field(n);
      const js = compileJS(json);
      const ia = compileInterval(json);
      for (const [x, y, t] of [
        [0.3, 0.7, 0],
        [0.5, 0.5, 1.2],
        [-0.25, 1.1, 3.9],
      ]) {
        const want = js.run!({ x, y, t, N: 20 }) as number;
        expect(Number.isFinite(want)).toBe(true);
        const out: any = ia.run!({ x: pt(x), y: pt(y), t: pt(t), N: pt(20) });
        const band = 'kind' in out ? out.value : out;
        expect(band.lo).toBeLessThanOrEqual(want + 1e-12);
        expect(band.hi).toBeGreaterThanOrEqual(want - 1e-12);
        expect(band.hi - band.lo).toBeLessThan(1e-9);
      }
    });
  }
});

describe('Seeded RandomChoice — what still fails closed', () => {
  test('an unseeded RandomChoice', () => {
    declines(
      ['Min', ['RandomChoice', ['Interval', 0, 1], 3]],
      /RandomChoice.*whole body of a `WithRandomSeed`/
    );
  });

  test('a symbolic seed', () => {
    declines(
      ['Min', draw('s', 3)],
      /only a literal finite real or string seed/
    );
  });

  test('a body that is not a bare RandomChoice', () => {
    declines(
      [
        'WithRandomSeed',
        1,
        ['Add', ['RandomChoice', ['Interval', 0, 1], 3], 1],
      ],
      /RandomChoice.*whole body of a `WithRandomSeed`/
    );
  });

  test('a symbolic domain', () => {
    ce.declare('L', 'list<real>');
    declines(['Min', draw(1, 3, 'L')], /domain of a seeded draw/);
    declines(['Min', draw(1, 3, ['Range', 1, 'N'])], /domain of a seeded draw/);
  });

  test('a domain the interpreter refuses', () => {
    declines(
      ['Min', draw(1, 3, ['Interval', 1, 1])],
      /domain of a seeded draw/
    );
    declines(['Min', draw(1, 3, ['List'])], /domain of a seeded draw/);
  });

  test('a literal count out of range', () => {
    declines(
      ['Min', draw(1, -3)],
      /count of a seeded draw must be in 0\.\.1000000/
    );
  });

  test('in a position that takes one interval', () => {
    declines(['Less', draw(1, 3), 1], /seeded `RandomChoice` is a list/);
  });
});

describe('Seeded RandomChoice — the count at run time', () => {
  const domain = { lo: 0, hi: 1 };

  test('the run-time helper rounds a point count as the interpreter does', () => {
    expect(IntervalArithmetic.seededChoice(1, 2, domain, 2.5).length).toBe(3);
    expect(IntervalArithmetic.seededChoice(1, 2, domain, pt(4)).length).toBe(4);
  });

  test('the run-time helper throws on a wide, non-finite or out-of-range count', () => {
    for (const k of [{ lo: 2, hi: 3 }, -1, 1_000_001, NaN, Infinity, 'x'])
      expect(() => IntervalArithmetic.seededChoice(1, 2, domain, k)).toThrow(
        /RandomChoice: expected a count in 0\.\.1000000/
      );
  });

  test('the compiled run reports that error as `entire`', () => {
    const ia = compileInterval(['Min', draw(1, 'N')]);
    expect(ia.run!({ N: { lo: 2, hi: 3 } })).toEqual({ kind: 'entire' });
    expect(ia.run!({ N: -1 })).toEqual({ kind: 'entire' });
  });
});
