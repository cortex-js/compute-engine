/**
 * The profile `ir` (batch G12; README of `src/compute-engine/compilation/ir/`,
 * "Loops and the runtime", "Lists"): a `Sum` or a `Product` with bounds of a
 * real type, a `Range` of a real first element or step, and `Apply` of a
 * function literal.
 *
 * - A real bound is floored, as the interpreter counts
 *   (`normalizeIndexingSet()`): `Sum(k, Limits(k, 0.5, 3.7))` is 6, an empty
 *   range is the identity. The elements of a real `Range` are
 *   `lo + k·step`, with the count of `rangeCount()`.
 * - `Apply(Function(body, p…), a…)` is the body with each parameter bound to
 *   its argument, evaluated once, before it.
 * - The witnesses of Tycho's corpus, with stand-in definitions.
 * - The values on JavaScript against the interpreter (1e-12), and on GLSL in
 *   WebGL2 (the headless Chromium of `scripts/glsl-check/glsl-driver.ts`)
 *   against the profile's JavaScript value within single-float precision.
 *   Without the browser, these tests are skipped.
 * - The declines that stay, the bigint mode, and the three robustness tests.
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
type Point = Record<string, number | number[]>;

const ce = new ComputeEngine();
for (const name of ['x', 'y', 'r', 's', 't']) ce.declare(name, 'real');
ce.declare('n', 'integer');
ce.declare('Z', 'complex');
ce.declare('L', 'list<real^3>');
// The inputs of the corpus records.
ce.declare('N', 'real<-10..10>');
ce.declare('a', 'real<0..512>');
ce.declare('theta', 'real<-1.8849555921538759..39.58406743523139>');
// Stand-ins of the corpus functions: an undeclared parameter as a bound
// (neyret/4hi9use9t2), a bound that is an input (neyret/cf56wfb4cm), a bound
// that is the call of another function (neyret/nsgmgxnou6).
ce.assign(
  'X',
  ce.box([
    'Function',
    [
      'Sum',
      ['Divide', ['Cos', ['Multiply', 'k', 'u']], 'k'],
      ['Limits', 'k', 1, 'u'],
    ],
    'u',
  ] as never)
);
ce.assign(
  'S',
  ce.box([
    'Function',
    [
      'Sum',
      ['Add', ['Sin', ['Multiply', 'k', 'u']], 'v'],
      ['Limits', 'k', 1, 'N'],
    ],
    'u',
    'v',
  ] as never)
);
ce.assign('F', ce.box(['Function', ['Divide', 'u', 2], 'u'] as never));
ce.assign(
  'G',
  ce.box([
    'Function',
    ['Product', ['Add', 1, ['Divide', 1, 'k']], ['Limits', 'k', 1, ['F', 'u']]],
    'u',
  ] as never)
);
// A function of two scalars, called with a list (neyret/rwhqbsp4wq).
ce.declare('P', '(real, real) -> real');
ce.assign('P', ce.box(['Function', ['Add', 'p', 'q'], 'p', 'q'] as never));

const IR = { profile: 'ir', fallback: false } as const;
const js = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, ...options });
const glsl = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), { ...IR, to: 'glsl', ...options });

/** The diagnostic of a compilation that throws, or `undefined`. */
function failure(
  f: () => unknown
): { code: string; message: string } | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { code: string; message: string } }).diagnostic;
  }
  return undefined;
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

/** The interpreter's value of `json` with the inputs of `point` assigned
 *  for the evaluation (a parameter of the same name is not substituted). */
function interpreted(json: Json, point: Point): unknown {
  const values = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      Array.isArray(v)
        ? ce.function(
            'List',
            v.map((x) => ce.number(x))
          )
        : ce.number(v),
    ])
  );
  return ce.withValues(values as never, () =>
    read(
      ce
        .box(json as never)
        .evaluate()
        .N()
    )
  );
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

function check(json: Json, points: Point[], options: object = {}) {
  const r = js(json, options);
  expect(r).toMatchObject({ success: true, profile: 'ir' });
  for (const p of points) {
    const got = r.run!(p as never);
    const want = interpreted(json, p);
    expect([p, got, agree(got, want)]).toEqual([p, got, true]);
  }
  return r;
}

const fn = (body: Json, ...params: Json[]) => ['Function', body, ...params];

// Programs of scalar inputs that compile on both targets, with points that
// cross an integer on each side, negative bounds, an empty range and an
// upper bound below the lower one.
// prettier-ignore
const PROGRAMS: [label: string, json: Json, points: Point[]][] = [
  ['Sum to a real bound', ['Sum', 'k', ['Limits', 'k', 1, 'r']],
    [{ r: 3.7 }, { r: 3.2 }, { r: 2.999 }, { r: 0.5 }, { r: -2 }, { r: -0.5 }]],
  ['Sum between two real bounds', ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 'r', 's']],
    [{ r: 0.5, s: 3.7, x: 1.5 }, { r: 1.5, s: 3.5, x: 1 }, { r: -0.5, s: 2, x: 1 },
     { r: 2.5, s: 4, x: -2 }, { r: 2.5, s: -0.5, x: 1 }, { r: -1.5, s: -0.5, x: 1 }, { r: -2.5, s: 1, x: 0.25 }]],
  ['Product to a real bound', ['Product', ['Add', 'k', 'x'], ['Limits', 'k', 1, 'r']],
    [{ r: 3.7, x: 0.5 }, { r: 0.5, x: 2 }, { r: -2, x: 1 }, { r: -0.5, x: 1 }]],
  ['a real lower bound, an integer upper one', ['Sum', ['Sin', 'k'], ['Limits', 'k', 'r', 'n']],
    [{ r: -1.5, n: 2 }, { r: 2.5, n: 2 }, { r: 0.2, n: 5 }]],
  ['a bound of a product by a real (art/4fbrilmr4x)', ['Add', ['Mod', ['Sum', 1, ['Limits', 'j', 0, ['Multiply', 26, 'theta']]], ['Multiply', 2, ['Sqrt', 2]]], 1],
    [{ theta: 0.3 }, { theta: 1.234 }, { theta: -0.5 }, { theta: 39 }]],
  ['an input as a bound (art/h2rbqjefo3)', ['Sum', ['Multiply', 'k', ['Sin', ['Multiply', 'a', 'k']]], ['Limits', 'k', 0, 'x']],
    [{ x: 4.5, a: 0.3 }, { x: -1, a: 2 }, { x: 0.99, a: 1 }]],
  ['an undeclared parameter as a bound (neyret/4hi9use9t2)', ['X', 't'],
    [{ t: 3.7 }, { t: 0.5 }, { t: 7.25 }, { t: -1 }]],
  ['an input real<-10..10> as a bound (neyret/cf56wfb4cm)', ['S', 't', 0],
    [{ t: 0.5, N: 4.5 }, { t: 1.5, N: -3 }, { t: 0.25, N: 9.99 }]],
  ['a bound that is a call (neyret/nsgmgxnou6)', ['G', 't'],
    [{ t: 7.5 }, { t: 1 }, { t: -3 }]],
  ['nested real bounds', ['Sum', ['Sum', ['Multiply', 'i', 'j', 'x'], ['Limits', 'j', 0.5, 2.5]], ['Limits', 'i', -1.5, 3.7]],
    [{ x: 0.5 }, { x: -2 }]],
  ['Apply of a literal (sunflower)', ['Apply', fn(['Block', ['Sqrt', 'z']], 'z'), 'x'],
    [{ x: 4 }, { x: 0.3 }]],
  ['Apply whose parameter shadows an input', ['Apply', fn(['Add', 'x', 1], 'x'), 'y'],
    [{ x: 10, y: 2 }]],
  ['Apply whose argument reads the parameter name', ['Apply', fn(['Multiply', 'x', 2], 'x'), ['Add', 'x', 1]],
    [{ x: 10 }, { x: -0.25 }]],
  ['Apply of two parameters', ['Apply', fn(['Subtract', 'p', ['Power', 'q', 2]], 'p', 'q'), 'x', ['Sin', 'y']],
    [{ x: 10, y: 3 }]],
  ['Apply whose parameter shadows a local', ['Block', ['Declare', 'w', 'real', 5], ['Add', 'w', ['Apply', fn(['Multiply', 'w', 3], 'w'), 'x']]],
    [{ x: 2 }]],
  ['nested Apply', ['Apply', fn(['Apply', fn(['Add', 'z', 'w'], 'w'), ['Multiply', 'z', 2]], 'z'), 'x'],
    [{ x: 3 }]],
  ['Apply in a Sum of a real bound', ['Sum', ['Apply', fn(['Sqrt', 'z'], 'z'), 'k'], ['Limits', 'k', 1, 'r']],
    [{ r: 5.5 }, { r: -1 }]],
];

describe('IR profile, batch G12: real bounds, real Ranges and Apply', () => {
  test.each(PROGRAMS)(
    '%s: JavaScript against the interpreter',
    (_, json, points) => void check(json, points)
  );

  test.each(PROGRAMS.map(([l, j]) => [l, j] as const))(
    '%s: GLSL compiles',
    (_, json) => {
      expect(glsl(json)).toMatchObject({ success: true, profile: 'ir' });
    }
  );

  test('the measured values of the interpreter', () => {
    const sum = ['Sum', 'k', ['Limits', 'k', 'r', 's']];
    const at = (r: number, s: number) => interpreted(sum, { r, s });
    expect([
      at(1, 3.7),
      at(1, 0.5),
      at(1, -2),
      at(0.5, 3.7),
      at(1.5, 3.5),
    ]).toEqual([6, 0, 0, 6, 6]);
    expect([at(-0.5, 2), at(2.5, 4), at(-2.5, 1)]).toEqual([2, 9, -5]);
    expect(
      interpreted(['Product', 'k', ['Limits', 'k', 1, 'r']], { r: 0.5 })
    ).toBe(1);
    expect(interpreted(['Range', 'r', 's'], { r: 0.5, s: 3.7 })).toEqual([
      0.5, 1.5, 2.5, 3.5,
    ]);
  });

  test('a Range of a real first element or step (neyret/de8mjxikqu)', () => {
    check(
      ['Range', 'r', 's'],
      [
        { r: -2.5, s: 2.5 },
        { r: 0.3, s: 0.2 },
        { r: 2.5, s: -1 },
        { r: -0.5, s: -0.5 },
      ]
    );
    check(['Range', 1, 5, 's'], [{ s: 1.5 }, { s: 0.4 }, { s: -1 }]);
    check(['Range', 'r', 5, 's'], [{ r: 0.25, s: 1.5 }]);
    check(
      ['Divide', ['Range', ['Negate', 'h'], 'h'], 'h'],
      [{ h: 2.5 }, { h: 0.75 }, { h: -1.5 }],
      { symbolic: ['h'] }
    );
    check(['Multiply', 'x', ['Range', 0, 1, 0.1]], [{ x: 2 }]);
    check(
      ['Sum', ['Map', fn(['Sin', 'z'], 'z'), ['Range', 'r', 3, 0.25]]],
      [{ r: -0.6 }, { r: 4 }]
    );
    // On GLSL a count of a closed Range is folded; a run-time count has no
    // spelling there.
    expect(glsl(['Max', ['Range', 0, 1, 0.1], 'x']).success).toBe(true);
    // An inner bound read from the outer index is a run-time count in a
    // loop: JavaScript compiles it, GLSL declines (the passes multiply).
    const inner = [
      'Sum',
      ['Sum', ['Multiply', 'i', 'j'], ['Limits', 'j', 0.5, ['Divide', 'i', 2]]],
      ['Limits', 'i', 1, 4.5],
    ];
    check(inner, [{}]);
    expect(failure(() => glsl(inner))?.message).toMatch(/iterationBudget/);
    expect(failure(() => glsl(['Sum', ['Range', 'r', 3]]))?.message).toMatch(
      /rangecount/
    );
  });

  test('the sunflower: a Comprehension of two Apply calls (showcase/sunflower)', () => {
    const sqrt = fn(['Block', ['Sqrt', 'ceArg_0']], 'ceArg_0');
    const angle = ['Multiply', 'm', ['Degrees', 'b']];
    const json = [
      'Comprehension',
      [
        'Tuple',
        ['Multiply', ['Cos', angle], ['Apply', sqrt, 'm']],
        ['Multiply', ['Sin', angle], ['Apply', sqrt, 'm']],
      ],
      ['Element', 'm', ['Range', 1, 'K']],
    ];
    const options = {
      mode: 'strict',
      iterationBudget: 1_000_000,
      symbolic: ['K', 'b'],
    };
    const r = check(
      json,
      [
        { K: 5, b: 137.5 },
        { K: 7.5, b: 30 },
        { K: 0.5, b: 1 },
      ],
      options
    );
    expect(
      (r.run!({ K: 3, b: 90 } as never) as unknown as number[][]).length
    ).toBe(3);
  });

  test('the interpreter maps Apply of a literal over a list', () => {
    const L = [1, 4, 9];
    expect(
      interpreted(['Apply', fn(['Max', 'z', 5], 'z'), 'L'], { L })
    ).toEqual([5, 5, 9]);
    expect(
      interpreted(['Apply', fn(['Max', 'p', 'q'], 'p', 'q'), 'L', 'x'], {
        L,
        x: 2,
      })
    ).toEqual([2, 4, 9]);
  });

  test('the interpreter has a value for an infinite bound', () => {
    const series = [
      'Sum',
      ['Divide', ['Power', 'x', 'k'], ['Factorial', 'k']],
      ['Limits', 'k', 0, 'PositiveInfinity'],
    ];
    expect(interpreted(series, { x: 0.5 })).toBeCloseTo(Math.exp(0.5), 12);
  });

  test('a real bound read from a vars name that hides a value (a slider)', () => {
    // `Tv` has a value in the engine; `vars` reads the host's text instead.
    ce.assign('Tv', 3);
    const json = ['Sum', 'k', ['Limits', 'k', 1, 'Tv']];
    const r = js(json, { vars: { Tv: '_.Tv' } });
    expect(r.run!({ Tv: 4.7 } as never)).toBe(10);
    expect(r.run!({ Tv: -0.5 } as never)).toBe(0);
    const want = ce
      .box(json as never)
      .subs({ Tv: ce.number(4.7) })
      .evaluate().re;
    expect(want).toBe(10);
    // On GLSL a vars name with a value in the engine declines (README); a
    // vars name with no value is floored.
    expect(failure(() => glsl(json, { vars: { Tv: 'u_T' } }))?.message).toMatch(
      /the vars entry of Tv/
    );
    expect(
      glsl(['Sum', 'k', ['Limits', 'k', 1, 'r']], { vars: { r: 'u_r' } }).code
    ).toMatch(/floor\(u_r\)/);
  });

  test('Apply: each argument is evaluated once, before the body', () => {
    // A draw as the argument: `z - z` is 0, and `z + Random()` draws the
    // argument first, as the interpreter.
    check(
      [
        'WithRandomSeed',
        7,
        ['Apply', fn(['Subtract', 'z', 'z'], 'z'), ['Random']],
      ],
      [{}]
    );
    check(
      [
        'WithRandomSeed',
        7,
        ['Apply', fn(['Add', 'z', ['Random']], 'z'), ['Random']],
      ],
      [{}]
    );
    // `Apply(g, x)` of a name is the call `g(x)` in the canonical form.
    expect(ce.box(['Apply', 'F', 'x'] as never).operator).toBe('F');
  });

  test('Apply of a list maps, as the interpreter (batch G18, CE-1344)', () => {
    const points = [{ L: [1, 7, -2] }, { L: [0.5, 5, 6] }];
    for (const json of [
      ['Apply', fn(['Max', 'z', 5], 'z'), 'L'],
      ['Apply', fn(7, 'z'), 'L'],
    ]) {
      check(json, points);
      expect(glsl(json)).toMatchObject({ success: true });
    }
    // A list of points: JavaScript; GLSL has no list of points.
    const point = [
      'Apply',
      fn(['Tuple', ['Cos', 'z'], ['Sin', 'z']], 'z'),
      'L',
    ];
    check(point, points);
    expect(failure(() => glsl(point))?.message).toMatch(/a list of rank 2/);
  });

  // prettier-ignore
  test.each([
    ['Apply of a wrong number of arguments', ['Apply', fn(['Subtract', 'p', 'q'], 'p', 'q'), 'x'], /Apply of a value that is not a function literal/],
    ['Apply of a typed parameter', ['Apply', fn(['Add', 'z', 1], ['Typed', 'z', "'integer'"]), 'x'], /Apply of a value that is not a function literal/],
    ['a complex bound', ['Sum', 'k', ['Limits', 'k', 1, 'Z']], /a bound that is not a real number/],
    ['a complex Range', ['Range', 'Z', 5], /a Range of an operand that is not a real number/],
    ['Apply of a tuple', ['Apply', fn(['Add', 'z', 1], 'z'), ['Tuple', 'x', 'y']], /may map the function over it/],
    ['an infinite upper bound', ['Sum', ['Divide', ['Power', 'x', 'k'], ['Factorial', 'k']], ['Limits', 'k', 0, 'PositiveInfinity']], /a bound that is a constant infinity or NaN/],
    ['an infinite bound of a series', ['Sum', ['Divide', 1, ['Power', 'k', 2]], ['Limits', 'k', 1, 'PositiveInfinity']], /a bound that is a constant infinity or NaN/],
    ['an infinite bound of a Product', ['Product', ['Subtract', 1, ['Power', 'x', 'k']], ['Limits', 'k', 1, 'PositiveInfinity']], /a bound that is a constant infinity or NaN/],
    ['an infinite lower bound', ['Sum', ['Exp', ['Multiply', 'k', 'x']], ['Limits', 'k', 'NegativeInfinity', 0]], /a bound that is a constant infinity or NaN/],
    ['a Range to NaN', ['Sum', ['Range', 0.5, 'NaN']], /a Range of an operand that is a constant infinity or NaN/],
    ['a Range from NaN', ['Sum', ['Range', 'NaN', 5]], /a Range of an operand that is a constant infinity or NaN/],
    ['a Range of a NaN step', ['Sum', ['Range', 1, 5, 'NaN']], /a Range of an operand that is a constant infinity or NaN/],
    ['a Range of an infinite step', ['Multiply', 'x', ['Range', 0, 1, 'PositiveInfinity']], /a Range of an operand that is a constant infinity or NaN/],
    ['an element of an infinite Range', ['At', ['Range', 0.5, 'PositiveInfinity'], 3], /a Range of an operand that is a constant infinity or NaN/],
  ])('%s declines, with the cause', (_, json, cause) => {
    for (const run of [js, glsl]) {
      const d = failure(() => run(json));
      expect(d?.code).toBe('outside-profile');
      expect(d?.message).toMatch(cause);
    }
  });

  test('Apply of a literal of two parameters to a list and a scalar maps over the list', () => {
    // It declined before batch G32 ("the interpreter may map the function
    // over it"): the interpreter maps, each element with the scalar.
    check(
      ['Apply', fn(['Max', 'p', 'q'], 'p', 'q'), 'L', 'x'],
      [
        { x: 0.5, L: [1, 7, -2] },
        { x: -3, L: [0.5, 5, 6] },
      ]
    );
  });

  test('a list argument for a scalar parameter is the function mapped over the list (neyret/rwhqbsp4wq)', () => {
    // prettier-ignore
    const json = ['Multiply', ['P', ['Multiply', 0.1, 'x'], ['Multiply', 6000, ['Range', 0, 1, 0.1]]], ['Power', 10, -12]];
    check(json, [{ x: 0.5 }, { x: -3 }]);
    // A Range of constants is the list of its elements, of a constant
    // length on GLSL too.
    expect(glsl(json).success).toBe(true);
  });

  test('GLSL: nested loops of run-time counts still decline (neyret/4hi9use9t2)', () => {
    const inner = (hi: Json) => [
      'Sum',
      [
        'Add',
        [
          'Multiply',
          2,
          [
            'Mod',
            [
              'Multiply',
              10000,
              ['Sin', ['Add', 'T', ['Multiply', 10000, 'k']]],
            ],
            1,
          ],
        ],
        -1,
      ],
      ['Limits', 'k', 1, hi],
    ];
    const json = [
      'Add',
      ['Sum', ['Sin', inner('i')], ['Limits', 'i', 0, ['Floor', 't']]],
      ['Multiply', ['Sin', inner(['Add', ['Floor', 't'], 1])], ['Mod', 't', 1]],
    ];
    const d = failure(() => glsl(json, { symbolic: ['T'] }));
    expect(d?.message).toMatch(/iterationBudget \(10000\) on glsl/);
    expect(js(json, { symbolic: ['T'] }).success).toBe(true);
  });

  test('the bigint mode: an integer bound compiles, a real one declines', () => {
    const r = js(['Sum', 'k', ['Limits', 'k', 1, 'n']], { mode: 'bigint' });
    expect(r.run!({ n: 4 } as never)).toBe(10n);
    for (const json of [
      ['Sum', 'k', ['Limits', 'k', 1, 'r']],
      ['Sum', 'k', ['Limits', 'k', 1, ['Divide', 'n', 2]]],
      ['Range', 'r', 5],
    ])
      expect(failure(() => js(json, { mode: 'bigint' }))?.code).toBe(
        'outside-profile'
      );
    expect(
      js(['Apply', fn(['Multiply', 'z', 'z'], 'z'), 'n'], { mode: 'bigint' })
        .run!({ n: 2n ** 40n } as never)
    ).toBe(2n ** 80n);
  });
});

//
// Robustness
//

describe('IR profile, batch G12: robustness', () => {
  const x = ce.box('x');
  const square = ce.box(fn(['Multiply', 'z', 'z'], 'z') as never);
  const apply = (f: Expression, ...args: Expression[]) =>
    ce.function('Apply', [f, ...args]);

  test('a shared graph of 2^20 paths', () => {
    let e: Expression = ce.box([
      'Sum',
      ['Sin', ['Multiply', 'k', 'x']],
      ['Limits', 'k', 1, ['Multiply', 3, 'x']],
    ] as never);
    for (let i = 0; i < 20; i++)
      e = ce.function('Add', [e, apply(square, ce.function('Sin', [e]))]);
    for (const to of ['javascript', 'glsl'] as const) {
      const start = performance.now();
      const r = compile(e, { ...IR, to });
      expect(r.code.length + (r.preamble ?? '').length).toBeLessThan(20_000);
      // A guard against a walk by paths (a hang), not a measure.
      expect(performance.now() - start).toBeLessThan(30_000);
    }
  });

  test('a chain of 1,000 operands and one of 1,000 nested Apply', () => {
    const sum = ce.function(
      'Add',
      Array.from({ length: 1_000 }, (_, i) =>
        apply(square, ce.function('Add', [x, ce.number(i)]))
      )
    );
    const next = ce.box(fn(['Add', 'z', 1], 'z') as never);
    let nested: Expression = x;
    for (let i = 0; i < 1_000; i++) nested = apply(next, nested);
    for (const to of ['javascript', 'glsl'] as const) {
      // Hang guards, not measures.
      let start = performance.now();
      const r = compile(sum, { ...IR, to });
      expect(r.code.length).toBeLessThan(200_000);
      expect(performance.now() - start).toBeLessThan(30_000);
      // Near the depth at which a walk exceeds the call stack, which
      // depends on the host: it compiles or declines.
      start = performance.now();
      const d = failure(() => compile(nested, { ...IR, to }));
      if (d !== undefined) expect(d.message).toMatch(/too deep to compile/);
      expect(performance.now() - start).toBeLessThan(30_000);
    }
    expect(compile(sum, IR).run!({ x: 0.5 } as never)).toBeCloseTo(
      Array.from({ length: 1_000 }, (_, i) => (0.5 + i) ** 2).reduce(
        (a, b) => a + b
      ),
      3
    );
    const n =
      failure(() => compile(nested, IR)) ??
      compile(nested, IR).run!({ x: 0.5 } as never);
    if (typeof n === 'number') expect(n).toBe(1000.5);
  });

  test('nested loops with real bounds', () => {
    // Six Sums, each bound a real input: JavaScript compiles one loop per
    // Sum (a loop of blocks and a loop in a block); GLSL declines (the passes
    // multiply past the budget).
    let e: Json = ['Multiply', 'x', 'k0'];
    for (let i = 0; i < 6; i++)
      e = ['Sum', e, ['Limits', `k${i}`, 0.5, ['Add', 'r', i]]];
    const start = performance.now();
    const r = js(e);
    expect(r.code.match(/for \(/g)?.length).toBe(12);
    expect(failure(() => glsl(e))?.message).toMatch(/iterationBudget/);
    expect(performance.now() - start).toBeLessThan(30_000);
    check(e, [
      { x: 0.5, r: 1.5 },
      { x: 1, r: -0.5 },
    ]);
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

/** The fragment shader of a host that writes the result: a `float` uniform
 *  per scalar input, a `float[n]` uniform per list (passed as a `vecN` for
 *  a list lowered to one: the driver sets `float` uniforms only). */
function shader(r: ReturnType<typeof glsl>): string {
  const inputs = r.freeSymbols!;
  const type = (n: string) => r.freeSymbolTypes![n].lowered;
  const vec = (n: string) => Number(/^vec(\d)$/.exec(type(n))?.[1] ?? 0);
  const uniform = (n: string) =>
    vec(n) > 0
      ? `uniform float u_${n}[${vec(n)}];`
      : `uniform ${type(n)} u_${n};`;
  const arg = (n: string) =>
    vec(n) > 0
      ? `${type(n)}(${Array.from({ length: vec(n) }, (_, i) => `u_${n}[${i}]`).join(', ')})`
      : `u_${n}`;
  const body = r.code.includes(';') ? r.code : `return ${r.code};`;
  return [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    ...inputs.map(uniform),
    'out vec4 fragColor;',
    r.preamble ?? '',
    `float userFn(${inputs.map((n) => `${type(n)} ${n}`).join(', ')}) {`,
    body,
    '}',
    'void main() {',
    `  fragColor = vec4(userFn(${inputs.map(arg).join(', ')}), 0.0, 0.0, 0.0);`,
    '}',
  ].join('\n');
}

(chromiumAvailable() ? describe : describe.skip)(
  'IR profile, batch G12: the values in WebGL2',
  () => {
    let driver: GlslDriver;
    beforeAll(async () => {
      driver = await GlslDriver.start();
    }, 60_000);
    afterAll(async () => driver?.stop());

    test("each shader agrees with the profile's JavaScript value within single-float precision", async () => {
      const items = PROGRAMS.flatMap(([label, json, points]) => {
        const f = js(json);
        const r = glsl(json);
        return points.map((p) => ({
          name: `${label} at ${JSON.stringify(p)}`,
          source: shader(r),
          uniforms: Object.fromEntries(
            Object.entries(p).map(([n, v]) => [`u_${n}`, v])
          ),
          expected: f.run!(p as never) as unknown as number,
        }));
      });
      const values = await driver.evaluate(items);
      const failures: string[] = [];
      values.forEach((v, k) => {
        const { name, expected } = items[k];
        if (!v.ok) return failures.push(`${name}: ${v.log}`);
        if (
          !(
            Math.abs(v.value - expected) <=
            1e-4 * Math.max(1, Math.abs(expected))
          )
        )
          failures.push(`${name}: ${v.value} vs ${expected}`);
      });
      expect(failures).toEqual([]);
      expect(items.length).toBeGreaterThanOrEqual(40);
    }, 180_000);
  }
);
