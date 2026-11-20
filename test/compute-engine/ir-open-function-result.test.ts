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

/**
 * A user function declared `(real) -> unknown` whose body has the static
 * type `complex` (`Sqrt(1 - e^2)` with `e: real<-10..10>`): the assignment
 * narrows the result to `complex`, and in `mode: 'strict'` the result is
 * the type of the lowered body, a real, as the body is in place (CE-1588).
 */
describe('A user function whose declared unknown result is narrowed to complex', () => {
  const BODY = [
    'Multiply',
    ['Sin', 'w'],
    ['Sqrt', ['Add', ['Negate', ['Power', 'e', 2]], 1]],
  ];

  function kepler(signature: string, body: Json = BODY) {
    const ce = new ComputeEngine();
    ce.declare('e', 'real<-10..10>');
    ce.declare('t', 'real');
    ce.declare('z', 'complex');
    ce.declare('F', { signature });
    ce.assign('F', ce.box(['Function', body, 'w'] as never));
    return ce;
  }

  function compiled(ce: ComputeEngine, json: Json, options: object = {}) {
    const r = compile(ce.box(json as never), {
      to: 'javascript',
      fallback: false,
      ...options,
    } as never) as {
      success: boolean;
      code: string;
      preamble?: string;
      run: (a: object) => unknown;
    };
    expect(r.success).toBe(true);
    return r;
  }

  test('a point of a call compiles on GLSL, with a real function', () => {
    for (const signature of [
      '(real) -> unknown',
      '(real | signed_infinity | nan) -> unknown',
    ]) {
      const ce = kepler(signature);
      const r = compiled(ce, ['Tuple', ['F', 't'], 't'], {
        to: 'glsl',
        callerLocals: ['t'],
        symbolic: ['t', 'e'],
      });
      expect(r.preamble).toMatch(/^float _fn_ir_u0_F\(/m);
      expect(r.code).toMatch(/return vec2\(v\d+, t\);/);
    }
  });

  test('a function declared with a literal, then assigned, is real too', () => {
    const ce = new ComputeEngine();
    ce.declare('e', 'real<-10..10>');
    ce.declare('t', 'real');
    ce.declare('F', {
      signature: '(real) -> unknown',
      evaluate: ce.box(['Function', 'w', 'w']),
    } as never);
    ce.assign('F', ce.box(['Function', BODY, 'w'] as never));
    const r = compiled(ce, ['Tuple', ['F', 't'], 't'], {
      to: 'glsl',
      callerLocals: ['t'],
      symbolic: ['t', 'e'],
    });
    expect(r.preamble).toMatch(/^float _fn_ir_u0_F\(/m);
  });

  test('the real value of the strict mode: the interpreter value, NaN where it is complex', () => {
    const ce = kepler('(real) -> unknown');
    const r = compiled(ce, ['F', 't']);
    expect(r.preamble).not.toMatch(/cplx/);
    expect(r.run({ t: 0.7, e: 0.5 })).toBeCloseTo(
      Math.sin(0.7) * Math.sqrt(0.75),
      14
    );
    expect(r.run({ t: 0.7, e: 2 })).toBeNaN();
  });

  test('a complex body stays complex', () => {
    const ce = kepler('(real) -> unknown', ['Multiply', 'w', 'z']);
    const r = compiled(ce, ['Add', ['F', 't'], 1]);
    expect(r.run({ t: 2, z: { re: 1, im: 1 } })).toEqual({ re: 3, im: 2 });
  });

  test('a result declared complex stays complex', () => {
    const ce = kepler('(real) -> complex');
    const r = compiled(ce, ['F', 't']);
    expect(r.preamble).toMatch(/return _SYS\.ir\.cplx\(/);
  });

  test('the complex mode keeps the complex value', () => {
    const ce = kepler('(real) -> unknown');
    const r = compiled(ce, ['F', 't'], { mode: 'complex' });
    const v = r.run({ t: 0.7, e: 2 }) as { re: number; im: number };
    expect(v.re).toBeCloseTo(0, 14);
    expect(v.im).toBeCloseTo(Math.sin(0.7) * Math.sqrt(3), 14);
  });
});
