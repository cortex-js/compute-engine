/**
 * A user function declared `(unknown, unknown) -> unknown` whose body is a
 * `Dot`: the assignment narrows the declared result to the type of the
 * body, `value`, which states no shape, so the result is the type of the
 * lowered body, as for a result of no stated type (CE-1497; README of
 * `src/compute-engine/compilation/ir/`, "User functions").
 *
 * Each case checks the compiled value against the interpreter's value at
 * the same inputs.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

type Json = unknown;

/** An engine with `x, y: real`, `p := (a, b) ↦ (cos a, sin a)` and the
 *  function `d` of the parameters `u, v` and the body `body`, declared
 *  with the signature `signature`. */
function engine(body: Json, signature = '(unknown, unknown) -> unknown') {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('p', 'function');
  ce.assign(
    'p',
    ce.box(['Function', ['PointList', ['Cos', 'a'], ['Sin', 'a']], 'a', 'b'])
  );
  ce.declare('d', { signature });
  ce.assign('d', ce.box(['Function', body, 'u', 'v'] as never));
  return ce;
}

/** The interpreter's value of `json` at `at`. */
function interpret(ce: ComputeEngine, json: Json, at: Record<string, number>) {
  const subs = Object.fromEntries(
    Object.entries(at).map(([k, v]) => [k, ce.number(v)])
  );
  return ce
    .box(json as never)
    .subs(subs)
    .N().re;
}

/** The compiled value of `json` at `at`, with `fallback: false`. */
function run(ce: ComputeEngine, json: Json, at: Record<string, number>) {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  } as never) as { success: boolean; run: (a: object) => unknown };
  expect(r.success).toBe(true);
  return r.run(at);
}

const WITNESS = ['Dot', ['p', 'u', 'v'], ['PointList', 'u', 'v']];
const POINTS = [
  { x: 0.3, y: 0.4 },
  { x: -1.2, y: 2 },
  { x: 2.5, y: -0.75 },
];

describe('A user function whose declared unknown result is narrowed to value', () => {
  test('the declared result is value after the assignment', () => {
    const ce = engine(WITNESS);
    expect(ce.box('d').type.toString()).toBe('(unknown, unknown) -> value');
    expect(ce.box(['d', 'x', 'y']).type.toString()).toBe('real');
  });

  for (const signature of [
    '(unknown, unknown) -> unknown',
    '(unknown, unknown) -> value',
    // Positive controls: compiled before CE-1497.
    '(real, real) -> unknown',
    '(unknown, unknown) -> real',
  ])
    test(`Dot(p(u, v), (u, v)) with the signature ${signature}`, () => {
      const ce = engine(WITNESS, signature);
      for (const at of POINTS) {
        const got = run(ce, ['d', 'x', 'y'], at);
        expect(got).toBeCloseTo(interpret(ce, ['d', 'x', 'y'], at), 12);
      }
    });

  test('the witness value at x = 0.3, y = 0.4', () => {
    const ce = engine(WITNESS);
    expect(run(ce, ['d', 'x', 'y'], { x: 0.3, y: 0.4 })).toBeCloseTo(
      0.40480902940221763,
      12
    );
  });

  test('Dot of two lists of the parameters', () => {
    const ce = engine(['Dot', ['List', 'u', 'v'], ['List', 'v', 'u']]);
    for (const at of POINTS) {
      const got = run(ce, ['d', 'x', 'y'], at);
      expect(got).toBeCloseTo(interpret(ce, ['d', 'x', 'y'], at), 12);
    }
  });

  test('a boolean body of a result declared value', () => {
    const ce = engine(['Less', 'u', 'v'], '(unknown, unknown) -> value');
    expect(run(ce, ['d', 'x', 'y'], { x: 0.3, y: 0.4 })).toBe(true);
    expect(run(ce, ['d', 'x', 'y'], { x: 0.5, y: 0.4 })).toBe(false);
  });

  test('a point body of a result declared value', () => {
    const ce = engine(['PointList', 'u', 'v'], '(unknown, unknown) -> value');
    const json = [
      'Add',
      ['PointX', ['d', 'x', 'y']],
      ['PointY', ['d', 'y', 'x']],
    ];
    for (const at of POINTS) {
      const got = run(ce, json, at);
      expect(got).toBeCloseTo(interpret(ce, json, at), 12);
    }
  });

  test('a list body of a result declared value declines', () => {
    const ce = engine(['List', 'u', 'v'], '(unknown, unknown) -> value');
    expect(() =>
      compile(ce.box(['d', 'x', 'y']), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow(/not a scalar or a point of numbers/);
  });
});
