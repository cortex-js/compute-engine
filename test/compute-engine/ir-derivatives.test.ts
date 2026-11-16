/**
 * Derivatives and a coordinate of a literal list of points in the profile
 * `ir` (batch G22, issue CE-1354; README of
 * `src/compute-engine/compilation/ir/`, "User functions" and "Tuples").
 *
 * A `D(f, x, …)` and an `Apply(Derivative(g, n…), a…)` are lowered as the
 * expression that the engine gives for them at compile time, as the existing
 * compilers do, and decline when there is none. `PointX`, `PointY` and
 * `PointZ` of a literal `List` of points are the list of the coordinate of
 * each point, with no list of points: the witness is the Voronoi reader of
 * Tycho's document `neyret/62urmx2dcm`, `Min((x − PointX(L))² + (y −
 * PointY(L))²)` of a literal list `L` of nine points, which GLSL declined as
 * "a list of rank 2".
 *
 * JavaScript agrees with the interpreter within 1e-12; the interval result
 * contains the JavaScript value. On GLSL the programs run in WebGL2 (the
 * headless Chromium of `scripts/glsl-check/glsl-driver.ts`) and agree with
 * JavaScript within single-float precision; without the browser, those
 * tests are skipped.
 */

import { existsSync } from 'node:fs';
import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { GlslDriver } from '../../scripts/glsl-check/glsl-driver';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Point = Record<string, number>;

const ce = new ComputeEngine();
for (const name of ['x', 'y', 'n', 'h']) ce.declare(name, 'real');
ce.declare('L', 'list<tuple<real, real>^3>');
const define = (name: string, json: Json) => {
  ce.declare(name, 'function');
  ce.assign(name, ce.box(json as never));
};
define('g', ['Function', ['Add', ['Power', 't', 3], ['Sin', 't']], 't']);
// A function whose body is a derivative.
define('hd', ['Function', ['D', ['Multiply', 's', ['Sin', 's']], 's'], 's']);
// A function whose body reads the free name `a`, which has a value.
ce.declare('a', 'real');
ce.assign('a', 5);
define('w', ['Function', ['Multiply', 'a', ['Power', 't', 2]], 't']);
define('h2', ['Function', ['Multiply', 'p', ['Sin', 'q']], 'p', 'q']);

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json): Expression => ce.box(json as never);
const js = (json: Json, options: object = {}) =>
  compile(box(json), { ...IR, ...options });
const glsl = (json: Json) => compile(box(json), { ...IR, to: 'glsl' });
const interval = (json: Json) =>
  compile(box(json), { ...IR, to: 'interval-js' });

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
  throw new Error(`no value: ${e.toString()}`);
}

function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, ce.number(v)])
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

function check(json: Json, points: Point[] = POINTS) {
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

/** The interval result contains the JavaScript value at each point. */
function contains(json: Json, points: Point[] = POINTS) {
  const f = js(json);
  const r = interval(json);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) {
    const v = f.run!(p as never) as number;
    const { lo, hi } = (
      r.run!(p as never) as { value: { lo: number; hi: number } }
    ).value;
    if (!(lo <= v && v <= hi))
      throw new Error(
        `${JSON.stringify(json)} at ${JSON.stringify(p)}: ${v} is not in [${lo}, ${hi}]`
      );
  }
}

// Away from 0, where the derivative of `Abs` does not exist.
// prettier-ignore
const POINTS: Point[] = [
  { x: 0.7, y: 0.4, n: 3, h: 0.25 },
  { x: -1.3, y: 0.9, n: 5, h: 0.125 },
  { x: 2.1, y: -0.6, n: 8, h: 0.5 },
];

const ABS = ['D', ['Abs', 'x'], 'x'];
const XSIN = ['D', ['Multiply', 'x', ['Sin', 'x']], 'x'];
const COS = ['Apply', ['Derivative', 'Sin'], 'x'];

describe('IR profile, batch G22: derivatives (CE-1354)', () => {
  test('the issue: D(Abs(x), x), D(x·Sin(x), x), Apply(Derivative(Sin), x)', () => {
    expect(check(ABS).code).toMatch(/return Math\.sign\(_\.x\);/);
    expect(check(XSIN).code).toMatch(
      /return \(\(_\.x \* Math\.cos\(_\.x\)\) \+ Math\.sin\(_\.x\)\);/
    );
    expect(check(COS).code).toMatch(/return Math\.cos\(_\.x\);/);
    expect(glsl(ABS).code).toBe('sign(x)');
    expect(glsl(XSIN).code).toBe('((x * cos(x)) + sin(x))');
    expect(glsl(COS).code).toBe('cos(x)');
    for (const json of [ABS, XSIN, COS]) contains(json);
  });

  test('a second derivative, a mixed one, and a derivative of a derivative', () => {
    check(['D', ['Sin', 'x'], 'x', 'x']);
    check(['D', ['Multiply', 'x', 'y', 'y'], 'x', 'y']);
    check(['D', ['D', ['Multiply', 'x', ['Exp', 'x']], 'x'], 'x']);
    check(['Apply', ['Derivative', 'Sin', 2], 'x']);
    // A function of two arguments: a derivative of each multi-index.
    for (const [i, j] of [
      [1, 0],
      [1, 1],
      [0, 2],
    ])
      check(['Apply', ['Derivative', 'h2', i, j], 'x', 'y']);
  });

  test('the form D(f, (x, 2)): no closed form in the engine, a decline', () => {
    expect(failure(() => js(['D', ['Sin', 'x'], ['Tuple', 'x', 2]]))).toMatch(
      /D\(Sin\(x\), Tuple\(x, 2\)\): a derivative with no closed form/
    );
  });

  test('in a Sum: of the index, and with respect to the index', () => {
    check(['Sum', ['D', ['Power', 'x', 'k'], 'x'], ['Limits', 'k', 1, 3]]);
    check([
      'Sum',
      ['D', ['Multiply', 'k', ['Sin', 'x']], 'x'],
      ['Limits', 'k', 1, 3],
    ]);
    check(['Sum', ['D', ['Multiply', 'k', 'x'], 'k'], ['Limits', 'k', 1, 3]]);
    check(['Sum', ['Apply', ['Derivative', 'g'], 'k'], ['Limits', 'k', 1, 3]]);
  });

  test('of a parameter of a function literal, and in a user function', () => {
    // prettier-ignore
    check(['Apply', ['Function', ['D', ['Multiply', 't', ['Sin', 't']], 't'], 't'], 'x']);
    // The derivative with respect to `x` of an expression of `t`.
    // prettier-ignore
    check(['Apply', ['Function', ['D', ['Multiply', 't', ['Sin', 'x']], 'x'], 't'], 'x']);
    check(['hd', 'x']);
    check(['Add', ['hd', 'x'], ['hd', 'y']]);
  });

  test('of a user function: D(g(x), x), Apply(Derivative(g), x), the second', () => {
    check(['D', ['g', 'x'], 'x']);
    check(['Apply', ['Derivative', 'g'], 'x']);
    check(['Apply', ['Derivative', 'g', 2], 'x']);
    check([
      'Apply',
      ['Derivative', ['Function', ['Multiply', 'u', 'u'], 'u']],
      'x',
    ]);
    expect(glsl(['Apply', ['Derivative', 'g'], 'x']).code).toBe(
      '((3.0 * (x * x)) + cos(x))'
    );
  });

  test('a closed form that reads a name the walk binds as an index: a decline', () => {
    // The literal of the derivative of `w` reads `a`, whose value is 5 in the
    // interpreter (2·5·x per pass); the index `a` would hide it.
    const json = [
      'Sum',
      ['Apply', ['Derivative', 'w'], 'x'],
      ['Limits', 'a', 1, 3],
    ];
    expect(interpreted(json, { x: 0.7 })).toBeCloseTo(21, 12);
    expect(failure(() => js(json))).toMatch(
      /Derivative\(w\): a derivative with no closed form/
    );
    // `D(w(x), x)` is `10x`: the engine reads the value of `a`.
    check(['Sum', ['D', ['w', 'x'], 'x'], ['Limits', 'a', 1, 3]]);
  });

  test('a derivative whose closed form holds a head outside the slice: a decline with its cause', () => {
    expect(failure(() => js(['Apply', ['Derivative', 'Gamma'], 'x']))).toMatch(
      /Digamma\(x\): the operator Digamma is not in the slice/
    );
  });

  test('under an angular unit other than radians: a decline', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    engine.angularUnit = 'deg';
    expect(
      failure(() => compile(engine.box(['D', ['Sin', 'x'], 'x'] as never), IR))
    ).toMatch(
      /a derivative with no closed form of at most 10000 nodes in radians/
    );
  });

  test('robustness: a derivative of a sum of 1,000 terms, a nest five deep', () => {
    // About 1 s for the sum (the engine's differentiation and a closed form
    // of 1,000 terms), a few milliseconds for the nest.
    const terms = Array.from({ length: 1000 }, (_, k) => [
      'Sin',
      ['Multiply', k + 1, 'x'],
    ]);
    const sum = ['D', ['Add', ...terms], 'x'];
    const r = js(sum);
    const want = terms.reduce(
      (s, _, k) => s + (k + 1) * Math.cos((k + 1) * 0.7),
      0
    );
    expect(r.run!({ x: 0.7 } as never)).toBeCloseTo(want, 8);
    let nest: Json = ['Sin', 'x'];
    for (let i = 0; i < 5; i++) nest = ['D', nest, 'x'];
    check(nest);
  }, 120_000);
});

//
// A coordinate of a literal list of points
//

/** A point of the witness's shape: `(1/n)·(Floor(n(x + i·h)), Floor(n(y +
 *  j·h))) + (1/n)·(Mod(7·Floor(n(x + i·h)), 3) / 4, 0.5)`. An integer
 *  `Mod`: the witness's hash is `Mod(10⁴·Sin(…), 1)`, whose value at a
 *  multiple of the divisor is the rounding of the target. */
const cell = (i: number, j: number): Json => {
  const fx = ['Floor', ['Multiply', 'n', ['Add', 'x', ['Multiply', i, 'h']]]];
  const fy = ['Floor', ['Multiply', 'n', ['Add', 'y', ['Multiply', j, 'h']]]];
  return [
    'Add',
    ['Multiply', ['Divide', 1, 'n'], ['PointList', fx, fy]],
    [
      'Multiply',
      ['Divide', 1, 'n'],
      ['PointList', ['Multiply', 0.25, ['Mod', ['Multiply', 7, fx], 3]], 0.5],
    ],
  ];
};
const CELLS = ['List', cell(-1, 0), cell(0, 0), cell(1, 1)];
const VORONOI = [
  'Min',
  [
    'Add',
    ['Power', ['Subtract', 'x', ['PointX', CELLS]], 2],
    ['Power', ['Subtract', 'y', ['PointY', CELLS]], 2],
  ],
];

//
// The numeric derivative of a derivative with no closed form
//

// The engine has no derivative of `Min`: `D(Min(L), x)` of a list keeps
// `Derivative(Min, 1)`. The witness is the implicit reader of Tycho's
// `neyret/lwuwgb9ic5`, `‖∇(Min(…) − Min(…))‖` of two lists of distances.
const MIN = ['Min', ['List', ['Power', 'x', 2], ['Multiply', 2, 'x']]];
define('m', [
  'Function',
  ['Min', ['List', ['Power', 't', 2], ['Multiply', 2, 't']]],
  't',
]);
// prettier-ignore
define('dm', ['Function', ['D', ['Min', ['List', ['Power', 's', 2], ['Multiply', 's', 'y']]], 's'], 's']);
// More than 40 nodes: the existing compiler's forward-mode lowering.
// prettier-ignore
define('big', ['Function', ['Min', ['List', ...Array.from({ length: 12 }, (_, k) => ['Power', ['Add', 't', k], 2])]], 't']);

/** The existing compiler's code: the profile's value is its value, bit for
 *  bit (the same helper `_SYS.nd`, of the same function). */
function sameAsExisting(json: Json, options: object = {}) {
  const r = js(json, options);
  const old = compile(box(json), { fallback: false, ...options });
  expect(r.code + (r.preamble ?? '')).toMatch(/_SYS\.nd\(/);
  for (const p of POINTS)
    expect(Object.is(r.run!(p as never), old.run!(p as never))).toBe(true);
  return r;
}

describe('IR profile, batch G22: the numeric derivative (JavaScript)', () => {
  test('D with no closed form: the existing compiler’s value', () => {
    const r = sameAsExisting(['D', MIN, 'x']);
    // Away from x = 2, where the branches of the Min meet: 2x below.
    expect(r.run!({ x: 0.7 } as never)).toBeCloseTo(1.4, 9);
    expect(r.run!({ x: 2.5 } as never)).toBeCloseTo(2, 9);
    // `Apply(Derivative(g), a)` has no stencil: it declines.
    for (const k of [1, 2])
      expect(failure(() => js(['Apply', ['Derivative', 'm', k], 'x']))).toMatch(
        /a derivative with no closed form/
      );
  });

  test('in a Sum, with respect to its index, in an arm, in a user function', () => {
    // prettier-ignore
    sameAsExisting(['Sum', ['D', ['Min', ['List', ['Power', 'x', 'k'], ['Multiply', 2, 'x']]], 'x'], ['Limits', 'k', 1, 3]]);
    // prettier-ignore
    sameAsExisting(['Sum', ['D', ['Min', ['List', ['Power', 'k', 2], ['Multiply', 'k', 'x']]], 'k'], ['Limits', 'k', 1, 3]]);
    sameAsExisting(['If', ['Less', 'x', 1], ['D', MIN, 'x'], 0]);
    sameAsExisting(['dm', 'x']);
  });

  test('declines: a body with an effect, a list body, an order that is not a number', () => {
    // prettier-ignore
    expect(failure(() => js(['D', ['Min', ['List', ['Multiply', ['Random'], 'x'], 'x']], 'x']))).toMatch(/a derivative with no closed form/);
    // prettier-ignore
    expect(failure(() => js(['D', ['Min', ['List', ['Multiply', 'T', 'x'], 'x']], 'x'], { vars: { T: '_.T' } }))).toMatch(/a derivative with an effect/);
    expect(failure(() => js(['D', ['List', MIN, 'x'], 'x']))).toMatch(
      /a list where a scalar is required/
    );
    // prettier-ignore
    expect(failure(() => js(['Apply', ['Derivative', 'm', 'y'], 'x']))).toMatch(/a derivative with no closed form/);
  });

  test('declines where the existing compiler takes its forward-mode lowering', () => {
    expect(failure(() => js(['Apply', ['Derivative', 'big'], 'x']))).toMatch(
      /a derivative with no closed form/
    );
  });

  test('GLSL and the interval mode decline, with the cause', () => {
    for (const f of [glsl, interval])
      expect(failure(() => f(['D', MIN, 'x']))).toMatch(
        /D\(Min\(List\(Power\(x, 2\), Multiply\(2, x\)\)\), x\): a derivative with no closed form/
      );
  });
});

//
// The fixes of the review (F1 to F4)
//

/** An engine of the review's cases: `T = 2` and `a` declared, `w(t) = a·t²`. */
function reviewEngine(): ComputeEngine {
  const engine = new ComputeEngine();
  for (const n of ['x', 'y', 'a', 'T']) engine.declare(n, 'real');
  engine.assign('T', 2);
  const def = (name: string, json: Json) => {
    engine.declare(name, 'function');
    engine.assign(name, engine.box(json as never));
  };
  def('w', ['Function', ['Multiply', 'a', ['Power', 't', 2]], 't']);
  def('wT', ['Function', ['Multiply', 'T', ['Power', 't', 2]], 't']);
  def('v', ['Function', ['Multiply', 3, ['w', 's']], 's']);
  def('m', ['Function', MIN.map((x) => x), 't'] as never);
  def('faa', ['Function', ['Apply', ['Derivative', 'w'], 'a'], 'a']);
  def('g3', ['Function', ['Add', ['Power', 't', 3], ['Sin', 't']], 't']);
  def('fg', ['Function', ['D', ['g3', 'x'], 'x'], 'x']);
  def('r4', ['Function', NESTED, 't']);
  return engine;
}
let NESTED: Json = ['Add', 't', 't'];
for (let i = 0; i < 4; i++) NESTED = ['Sqrt', ['Add', 't', NESTED]];

describe('IR profile, batch G22: the review’s fixes', () => {
  const engine = reviewEngine();
  const run = (json: Json, options: object, p: Point) => {
    const box = engine.box(json as never);
    const r = compile(box, { ...IR, ...options });
    const want = engine.withValues(
      Object.fromEntries(
        Object.entries(p).map(([k, v]) => [k, engine.number(v)])
      ) as never,
      () =>
        engine
          .box(json as never)
          .evaluate()
          .N().re
    );
    return [r.run!(p as never) as number, want];
  };
  const fails = (json: Json, options: object = {}) =>
    failure(() => compile(engine.box(json as never), { ...IR, ...options }));

  test('F1: the value of a vars name is not read by the closed form', () => {
    const vars = { vars: { T: '_.T' } };
    // prettier-ignore
    for (const json of [
      ['D', ['Multiply', 'T', ['Power', 'x', 2]], 'x'],
      ['D', ['Sin', ['Multiply', 'T', 'x']], 'x'],
      ['D', ['Power', 'x', 'T'], 'x'],
      ['D', ['Multiply', 'T', ['Power', 'x', 3]], 'x', 'x'],
      ['Sum', ['D', ['Multiply', 'T', ['Power', 'x', 'k']], 'x'], ['Limits', 'k', 1, 3]],
      ['D', ['wT', 'x'], 'x'],
    ]) {
      const [got, want] = run(json, vars, { x: 0.7, T: 3 });
      expect(agree(got, want)).toBe(true);
    }
    // `D(T·x², x)` at T = 3: 4.2 (it gave 2.8, the value 2 of `T`).
    expect(
      run(['D', ['Multiply', 'T', ['Power', 'x', 2]], 'x'], vars, {
        x: 0.7,
        T: 3,
      })[0]
    ).toBeCloseTo(4.2, 12);
    // The order: `Derivative(m, T)` has no closed form with `T` hidden.
    expect(fails(['Apply', ['Derivative', 'm', 'T'], 'x'], vars)).toMatch(
      /no closed form/
    );
  });

  test('F2: a variable of D that holds a value declines; an input or a bound name compiles', () => {
    const json = ['D', ['Multiply', ['Power', 'T', 2], 'x'], 'T'];
    for (const options of [{ symbolic: ['T'] }, {}])
      expect(fails(json, options)).toMatch(
        /a variable of a derivative that holds a value/
      );
    expect(
      fails(
        [
          'D',
          MIN.map((x) =>
            JSON.parse(JSON.stringify(x).replaceAll('"x"', '"T"'))
          ),
          'T',
        ],
        { symbolic: ['T'] }
      )
    ).toMatch(/holds a value/);
    const input = new ComputeEngine();
    input.declare('x', 'real');
    const r = compile(input.box(json as never), {
      ...IR,
      inputs: { T: 'real' },
    });
    expect(r.run!({ x: 0.7, T: 3 } as never)).toBeCloseTo(4.2, 12);
    const bound = ['Sum', json, ['Limits', 'T', 1, 3]];
    const [got, want] = run(bound, {}, { x: 0.7 });
    expect(agree(got, want)).toBe(true);
  });

  test('F3: a closed form that reads a name of a function body hidden at the site declines', () => {
    // At a = 5 the interpreter gives 60, 42, 4, 4 and 180.
    // prettier-ignore
    for (const json of [
      ['Sum', ['Apply', ['Derivative', 'w'], 'a'], ['Limits', 'a', 1, 3]],
      ['Sum', ['D', ['Multiply', 'a', ['w', 'x']], 'x'], ['Limits', 'a', 1, 3]],
      ['Block', ['Declare', 'a', "'real'", 'y'], ['Apply', ['Derivative', 'w'], 'a']],
      ['faa', 'y'],
      ['Sum', ['Apply', ['Derivative', 'v'], 'a'], ['Limits', 'a', 1, 3]],
    ])
      expect(fails(json)).toMatch(/a derivative with no closed form/);
    // A function that reads no free name, and a body that is a derivative.
    for (const json of [
      ['fg', 'x'],
      [
        'Sum',
        ['D', ['Multiply', 'k', ['g3', 'x']], 'x'],
        ['Limits', 'k', 1, 3],
      ],
    ]) {
      const [got, want] = run(json, {}, { x: 0.7 });
      expect(agree(got, want)).toBe(true);
    }
  });

  test('F4: an order of 3 or more of a large body declines before the engine is asked', () => {
    // The closed form took 1.9 s to compute and declined.
    expect(fails(['Apply', ['Derivative', 'r4', 3], 'x'])).toMatch(
      /Derivative\("r4", 3\): a derivative with no closed form/
    );
  });

  test('a name read through a function that is named, not called, or through a held expression declines', () => {
    const e = reviewEngine();
    const def = (name: string, json: Json) => {
      e.declare(name, 'function');
      e.assign(name, e.box(json as never));
    };
    def('vd', ['Function', ['Apply', ['Derivative', 'w'], 's'], 's']);
    def('ap', ['Function', ['f', 's'], 'f', 's']);
    e.assign('q2', e.box(['Add', 'a', 1]));
    const dw = ['Apply', ['Derivative', 'w'], 'x'];
    const sum = (term: Json): Json => [
      'Sum',
      ['D', ['Multiply', 'a', term], 'x'],
      ['Limits', 'a', 1, 3],
    ];
    // Each compiled to the value with `a` read as the index (28, 28, 19.6,
    // 28, 0.32); at a = 5 the interpreter gives 60, 60, 42, 50.4 and 4.
    for (const json of [
      sum(dw),
      sum(['vd', 'x']),
      sum(['ap', 'w', 'x']),
      sum(['Multiply', 'q2', ['Power', 'x', 2]]),
      ['Apply', ['Function', ['D', ['Multiply', 'a', dw], 'x'], 'a'], 'y'],
    ])
      expect(failure(() => compile(e.box(json as never), IR))).toMatch(
        /a derivative with no closed form/
      );
    // The same names with no binding at the site: the value.
    const r = compile(
      e.box(['D', ['Multiply', 'q2', ['Power', 'x', 2]], 'x'] as never),
      IR
    );
    expect(agree(r.run!({ x: 0.7, a: 5 } as never), 8.4)).toBe(true);
  });

  test('a vars name whose value cannot be hidden (an inferred type, a constant) declines', () => {
    // Each compiled to `4 * _.x`, with the stored value 2 of the name.
    const body = ['D', ['Multiply', 'U', ['Power', 'x', 2]], 'x'];
    for (const constant of [false, true]) {
      const e = new ComputeEngine();
      e.declare('x', 'real');
      if (constant)
        e.declare('U', { type: 'real', value: 2, isConstant: true });
      else e.assign('U', 2);
      expect(
        failure(() =>
          compile(e.box(body as never), { ...IR, vars: { U: '_.U' } })
        )
      ).toMatch(/a derivative with no closed form/);
    }
  });

  test('a mixed derivative of a total order of 3 or more of a large body declines before the engine is asked', () => {
    const e = reviewEngine();
    let nested: Json = ['Add', 'p', 'r'];
    for (let i = 0; i < 4; i++)
      nested = ['Sqrt', ['Add', 'p', ['Multiply', 'r', nested]]];
    e.declare('h4', 'function');
    e.assign('h4', e.box(['Function', nested, 'p', 'r'] as never));
    e.declare('h2', 'function');
    e.assign(
      'h2',
      e.box([
        'Function',
        ['Multiply', ['Power', 'p', 2], ['Sin', 'r']],
        'p',
        'r',
      ] as never)
    );
    // The closed form of the order (2, 2) took 5.6 s to compute and declined.
    for (const orders of [
      [2, 2],
      [2, 1],
    ])
      expect(
        failure(() =>
          compile(
            e.box([
              'Apply',
              ['Derivative', 'h4', ...orders],
              'x',
              'y',
            ] as never),
            IR
          )
        )
      ).toMatch(/a derivative with no closed form/);
    // A small body keeps its closed form: 2·cos(y).
    const r = compile(
      e.box(['Apply', ['Derivative', 'h2', 2, 1], 'x', 'y'] as never),
      IR
    );
    expect(agree(r.run!({ x: 0.7, y: 0.4 } as never), 2 * Math.cos(0.4))).toBe(
      true
    );
  });

  test('D(Gamma(x), x): Digamma is not in the slice, on JavaScript and interval-js', () => {
    for (const to of ['javascript', 'interval-js'])
      expect(fails(['D', ['Gamma', 'x'], 'x'], { to })).toMatch(
        /Digamma\(x\): the operator Digamma is not in the slice/
      );
  });

  test('Apply(Derivative(ft), x) of a typed parameter: the literal of the derivative keeps the type, a decline', () => {
    engine.declare('ft', 'function');
    engine.assign(
      'ft',
      engine.box([
        'Function',
        ['Power', 't', 3],
        ['Typed', 't', "'real'"],
      ] as never)
    );
    expect(fails(['Apply', ['Derivative', 'ft'], 'x'])).toMatch(
      /untyped parameter per argument/
    );
    const [got, want] = run(['D', ['ft', 'x'], 'x'], {}, { x: 0.7 });
    expect(agree(got, want, 1e-9)).toBe(true);
  });
});

describe('IR profile, batch G22: a coordinate of a literal list of points', () => {
  test('the reduced witness: the interpreter’s value, no list of points', () => {
    check(VORONOI);
    check(['PointX', CELLS]);
    check(['PointY', ['List', ['Tuple', 'x', 1], ['Tuple', 2, 'y']]]);
    const r = glsl(VORONOI);
    expect(r.success).toBe(true);
    expect(r.code + (r.preamble ?? '')).not.toMatch(/vec2\s*\[|vec2\[/);
    contains(VORONOI);
  });

  test('PointZ, and a point of three coordinates', () => {
    check(['PointZ', ['List', ['Tuple', 'x', 1, 'y'], ['Tuple', 2, 'y', 3]]]);
  });

  test('a list of points that is not literal: GLSL still declines', () => {
    // prettier-ignore
    expect(js(['PointX', 'L']).run!({ L: [[1, 2], [3, 4], [5, 6]] } as never)).toEqual([1, 3, 5]);
    expect(failure(() => glsl(['PointX', 'L']))).toMatch(/rank 2/);
  });

  test('each point is lowered once: a draw in a point runs once', () => {
    // prettier-ignore
    const json = ['WithRandomSeed', 3, ['PointX', ['List', ['Tuple', ['Random'], 1], ['Tuple', 2, ['Random']]]]];
    expect(agree(js(json).run!(), interpreted(json, {}))).toBe(true);
  });
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
  'IR profile, batch G22: derivatives and coordinates in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    const programs: [string, Json][] = [
      ['D(Abs(x), x)', ABS],
      ['D(x·Sin(x), x)', XSIN],
      ['Apply(Derivative(Sin), x)', COS],
      ['D(g(x), x)', ['D', ['g', 'x'], 'x']],
      ['the reduced Voronoi witness', VORONOI],
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
            'uniform float u_y;',
            'uniform float u_n;',
            'uniform float u_h;',
            'out vec4 fragColor;',
            r.preamble ?? '',
            'float userFn(float x, float y, float n, float h) {',
            body.includes(';') ? body : `return ${body};`,
            '}',
            'void main() { fragColor = vec4(userFn(u_x, u_y, u_n, u_h), 0.0, 0.0, 0.0); }',
          ].join('\n');
        const items = POINTS.map((p) => ({
          name: JSON.stringify(p),
          source: source(r.code),
          uniforms: { u_x: p.x, u_y: p.y, u_n: p.n, u_h: p.h },
          expected: f.run!(p as never) as number,
        }));
        const values = await driver.evaluate(items);
        for (const [i, v] of values.entries()) {
          if (!v.ok) throw new Error(v.log);
          // The trigonometric builtins of the driver (SwiftShader) are
          // within about 5e-5.
          expect(agree(v.value, items[i].expected, 2e-4)).toBe(true);
        }
      },
      120_000
    );
  }
);
