/**
 * A COORDINATE read through POINT ARITHMETIC over a wide list of points.
 *
 * `PointX(0.3·(t, t) + 4·[(x₁, y₁), …])` adds one point to every point of a
 * scaled list and reads the first coordinate of each result. Points add and
 * scale coordinate by coordinate, so that is `0.3·t + 4·[x₁, …]`: ordinary
 * arithmetic of a number and a list of numbers, in which no point is built.
 * The targets built every point, transformed both coordinates, and read one
 * back (the Tycho code-generation audit of 0.131.3, document `woeywky0kj`: a
 * list of 7,225 points, a 295,869-character JavaScript kernel). The
 * target-independent pre-pass (`fixed-width-unroll.ts`, `foldPointAccessor`)
 * now folds the accessor through the arithmetic.
 *
 * Every value case is checked against the INTERPRETER.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { unrollFixedWidthCollections } from '../../src/compute-engine/compilation/fixed-width-unroll';

const ce = new ComputeEngine();
for (const s of ['t', 'a', 'b', 'c']) ce.declare(s, 'real');

// Seven constant points, as the audit row has 7,225 of them.
const CONSTANT_POINTS = [
  'List',
  ...[0, 0.25, 0.5, 0.75, 1, 1.25, 1.5].map((x, i) => ['Tuple', x, i % 2]),
];
// Five points with coordinates computed at run time.
const COMPUTED_POINTS = [
  'List',
  ['Tuple', 'a', 'b'],
  ['Tuple', 'b', 1],
  ['Tuple', 2, 'a'],
  ['Tuple', 'c', 'c'],
  ['Tuple', 3, 4],
];
/** The arithmetic of the audit row: `0.3·(t, t) + 4·points`. */
const transformed = (points: unknown) => [
  'Add',
  ['Multiply', 0.3, ['PointList', 't', 't']],
  ['Multiply', 4, points],
];
const VALUES = { t: 0.5, a: 1.5, b: -2, c: 0.25 };

function compiled(json: unknown, options: Record<string, unknown> = {}) {
  const r = compile(ce.box(json as never), { fallback: false, ...options });
  expect(r.success).toBe(true);
  return { source: (r.preamble ?? '') + r.code, run: r.run! };
}

/** The interpreter's list of numbers for `json` at `VALUES`. */
function interpreted(json: unknown, values = VALUES): number[] {
  const bindings = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, ce.number(v)])
  );
  return ce
    .box(json as never)
    .subs(bindings)
    .N()
    .ops!.map((c) => c.valueOf() as number);
}

function expectParity(json: unknown, run: (vars: object) => unknown) {
  for (const t of [0, 0.5, 2]) {
    const values = { ...VALUES, t };
    const got = run(values) as number[];
    const want = interpreted(json, values);
    expect(got).toHaveLength(want.length);
    got.forEach((c, k) => expect(c).toBeCloseTo(want[k], 12));
  }
}

/** Does the emitted code build points and read a coordinate back out? */
const readsPointsBack = (source: string) =>
  /_pt\b|pointComponent/.test(source);

describe('A coordinate of point arithmetic over a wide list of points', () => {
  test('the audit shape adds numbers and builds no point', () => {
    const json = [
      'Add',
      ['Multiply', -0.7, 't'],
      ['Sin', ['Add', ['Cos', ['Add', 't', 0.628]], ['PointX', transformed(CONSTANT_POINTS)]]],
    ];
    const { source, run } = compiled(json);
    expect(readsPointsBack(source)).toBe(false);
    // The y coordinates are not in the kernel at all: no nested pair is.
    expect(source).not.toMatch(/\[\[/);
    // One fused loop over the list, not one loop per operation.
    expect(source.match(/_SYS\.bcast\(/g)).toHaveLength(1);
    expectParity(json, run);
  });

  test('the second coordinate, through a negation', () => {
    const json = ['PointY', ['Negate', transformed(CONSTANT_POINTS)]];
    const { source, run } = compiled(json);
    expect(readsPointsBack(source)).toBe(false);
    expectParity(json, run);
  });

  test('a list of computed points, scaled by a symbol', () => {
    const json = ['PointX', ['Add', ['Multiply', 'c', COMPUTED_POINTS], ['Tuple', 'a', 'b']]];
    const { source, run } = compiled(json);
    expect(readsPointsBack(source)).toBe(false);
    expectParity(json, run);
  });

  test('two lists of the same width pair element by element', () => {
    const json = [
      'PointY',
      ['Add', COMPUTED_POINTS, ['Multiply', 2, COMPUTED_POINTS]],
    ];
    const { source, run } = compiled(json);
    expect(readsPointsBack(source)).toBe(false);
    expectParity(json, run);
  });

  test('the shader targets compile a list of computed points', () => {
    // A list of points has no shader lowering, so this was a decline. The
    // coordinates are a `float[5]` array of scalar expressions.
    const r = compile(ce.box(['PointX', transformed(COMPUTED_POINTS)] as never), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/^float\[5\]\(/);
  });

  test('the interval target reads computed points as scalar intervals', () => {
    const json = ['PointX', transformed(COMPUTED_POINTS)];
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toMatch(/bcastPoint|pointComponent/);
    const point = (v: number) => ({ lo: v, hi: v });
    const got = r.run!(
      Object.fromEntries(Object.entries(VALUES).map(([k, v]) => [k, point(v)]))
    ) as unknown as { value: { lo: number; hi: number } }[];
    const want = interpreted(json);
    expect(got).toHaveLength(want.length);
    got.forEach((cell, k) => {
      expect(cell.value.lo).toBeLessThanOrEqual(want[k] + 1e-12);
      expect(cell.value.hi).toBeGreaterThanOrEqual(want[k] - 1e-12);
    });
  });
});

describe('Point arithmetic — when the points are still built', () => {
  test('a narrow list is left to the target', () => {
    const json = [
      'PointX',
      transformed(['List', ['Tuple', 'a', 'b'], ['Tuple', 'b', 1]]),
    ];
    const { source, run } = compiled(json);
    expect(readsPointsBack(source)).toBe(true);
    expectParity(json, run);
  });

  test('arithmetic over single points is left to the target', () => {
    // The shader targets answer this with a native vector and a swizzle.
    const json = ['PointX', ['Add', ['Tuple', 'a', 'b'], ['Tuple', 'b', 'c']]];
    const r = compile(ce.box(json as never), { to: 'glsl', fallback: false });
    expect(r.code).toBe('(vec2(a, b) + vec2(b, c)).x');
  });

  test('a discarded coordinate with an effect is still evaluated', () => {
    const points = [
      'List',
      ['Tuple', 'a', ['Random']],
      ...COMPUTED_POINTS.slice(2),
    ];
    const { source } = compiled(['PointX', transformed(points)]);
    expect(source).toContain('drawNextRandomNumber');
  });

  test('a discarded coordinate reading a live-source `vars` splice is still evaluated', () => {
    // `w` is spliced as source, which may count its reads.
    ce.declare('w', 'real');
    const points = ['List', ['Tuple', 'a', 'w'], ...COMPUTED_POINTS.slice(2)];
    for (const json of [
      ['PointX', transformed(points)],
      // The same guard on the accessor directly over a wide list.
      ['PointX', points],
    ]) {
      const { source } = compiled(json, { vars: { w: '_.counter()' } });
      expect(source).toContain('_.counter()');
    }
  });

  test('a head the caller overrode, at any depth, receives its points', () => {
    const operators = { Multiply: ['MYMUL', 12] };
    for (const json of [
      ['PointX', ['Add', ['Multiply', 'c', COMPUTED_POINTS], ['Tuple', 'a', 'b']]],
      // The same guard under the accessor directly over a wide list.
      ['PointX', ['List', ['Multiply', 3, ['Tuple', 'a', 'b']], ...COMPUTED_POINTS.slice(2)]],
    ]) {
      const { source } = compiled(json, { operators });
      // The override is handed a point (an array), not one coordinate.
      expect(source).toMatch(/MYMUL\([^()]*\[/);
    }
  });

  test('points of different arities do not add, and are not folded', () => {
    // The interpreter answers `incompatible-type` for the sum. The coordinates
    // alone would add (`a + 1`), which is a number where there is none.
    const points = [
      'List',
      ['Add', ['Tuple', 'a', 'b'], ['Tuple', 1, 2, 3]],
      ...COMPUTED_POINTS.slice(2),
    ];
    // The list keeps the failed sum as a cell (`docs/ERROR-MODEL.md` §3), so
    // the projection holds the error and gives no number for it. (Before
    // 2026-10-19 the list was typed `error`, and the whole projection was the
    // `Error`; whether a projection over a list with a failed cell maps the
    // cells or answers the error is an open question in ROADMAP.md.)
    const projected = ce.box(['PointX', points] as never).evaluate();
    expect(projected.errors.length).toBeGreaterThan(0);
    expect(projected.isNumber).not.toBe(true);
    const { run } = compiled(['PointX', points]);
    const got = run(VALUES) as number[];
    expect(got[0]).toBeNaN();
    expect(got.slice(1)).toEqual([VALUES.b, 2, VALUES.c, 3]);
  });

  test('a point of unknown arity keeps the check the target makes at run time', () => {
    // `q` is a bare `tuple`: it may hold three coordinates, which do not add
    // to two-coordinate points. The coordinates alone would add.
    ce.declare('q', 'tuple');
    const json = ['PointX', ['Add', 'q', COMPUTED_POINTS]];
    const { source, run } = compiled(json);
    expect(readsPointsBack(source)).toBe(true);
    expect(run({ ...VALUES, q: [10, 20] })).toEqual([11.5, 8, 12, 10.25, 13]);
    const mismatched = run({ ...VALUES, q: [10, 20, 30] }) as number[];
    mismatched.forEach((c) => expect(c).toBeNaN());
  });

  test('two lists of different widths do not add, and are not folded', () => {
    const six = [...COMPUTED_POINTS, ['Tuple', 5, 6]];
    const json = ['PointX', ['Add', COMPUTED_POINTS, ['Multiply', 2, six]]];
    expect(ce.box(json as never).evaluate().operator).toBe('Error');
    const { source } = compiled(json);
    expect(readsPointsBack(source)).toBe(true);
  });

  test('a constant list beside a computed one stays a table on the interval target', () => {
    const constants = ['List', ...CONSTANT_POINTS.slice(1, 6)];
    const json = ['PointX', ['Add', ['Multiply', 4, constants], COMPUTED_POINTS]];
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_IA.bcastPoint');
  });

  test('a constant list stays one table on the interval target', () => {
    // That target writes a constant list out element by element, at any
    // width, so the projected list would become one term per point. The
    // unprojected arithmetic reads the table through the run-time broadcast.
    const r = compile(ce.box(['PointX', transformed(CONSTANT_POINTS)] as never), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_IA.bcastPoint');
  });
});

/**
 * A list of points held by a SYMBOL, known only by its type (ROADMAP
 * CE-333.2; records 687 and 688 of the targeted Tycho audit, the
 * `woeywky0kj` setup rows). The accessor is applied to the symbol itself:
 * `PointX(4·P + 0.3·(t, t))` is `4·PointX(P) + 0.3·t`. Only the JavaScript
 * and interval targets ask for it (`UnrollOptions.typedPointLists`): the
 * width of `P` is not known, and a narrow list of points is a native vector
 * on the shader targets.
 */
describe('A coordinate of point arithmetic over a list of points held by a symbol', () => {
  const ceP = new ComputeEngine();
  ceP.declare('t', 'real');
  ceP.declare('P', 'list<tuple<number, number>>');
  ceP.declare('Q', 'list<tuple<number, number>>');
  ceP.declare('U', 'tuple<number, number> | list<tuple<number, number>>');
  const POINTS = [
    [1, 2],
    [3, -4],
    [0.5, 0.25],
  ];
  const scaled = (p: string) => [
    'Add',
    ['Multiply', 4, p],
    ['Multiply', 0.3, ['Tuple', 't', 't']],
  ];

  function interpretedP(json: unknown, t: number, points = POINTS): number[] {
    const P = ceP.box(['List', ...points.map((p) => ['Tuple', ...p])] as never);
    const v = ceP
      .box(json as never)
      .subs({ P, Q: P, U: P, t: ceP.number(t) })
      .N();
    return Array.from(v.each()).map((c) => c.re);
  }

  function compileP(json: unknown, to: string) {
    return compile(ceP.box(json as never), {
      to: to as never,
      fallback: false,
    });
  }

  test('javascript reads one coordinate of P and builds no point', () => {
    for (const [accessor, json] of [
      [0, ['PointX', scaled('P')]],
      [1, ['PointY', ['Negate', scaled('P')]]],
      [0, ['Sin', ['PointX', scaled('P')]]],
    ] as const) {
      const r = compileP(json, 'javascript');
      expect(r.success).toBe(true);
      // One pass over P, reading the one coordinate.
      expect(r.code.match(/\.map\(/g)).toHaveLength(1);
      expect(r.code).toContain(`(_.P).map((_pt) => _pt[${accessor}] ?? NaN)`);
      expect(r.code).not.toContain(`_pt[${1 - accessor}]`);
      for (const t of [0, 0.5, 2])
        for (const points of [POINTS, []]) {
          const got = r.run!({ t, P: points }) as number[];
          const want = interpretedP(json, t, points);
          expect(got).toHaveLength(want.length);
          got.forEach((c, k) => expect(c).toBeCloseTo(want[k], 12));
        }
    }
  });

  test('interval-js reads one coordinate of P and builds no point', () => {
    const json = ['PointX', scaled('P')];
    const r = compileP(json, 'interval-js');
    expect(r.success).toBe(true);
    expect(r.code).toContain('_IA.pointComponent(_.P, 0, true, true)');
    expect(r.code).not.toContain('bcastPoint');
    for (const t of [0, 0.5, 2]) {
      const got = r.run!({ t: { lo: t, hi: t }, P: POINTS }) as unknown as {
        value: { lo: number; hi: number };
      }[];
      const want = interpretedP(json, t);
      expect(got).toHaveLength(want.length);
      got.forEach((cell, k) => {
        expect(cell.value.lo).toBeLessThanOrEqual(want[k] + 1e-12);
        expect(cell.value.hi).toBeGreaterThanOrEqual(want[k] - 1e-12);
      });
    }
  });

  test('the shader targets do not ask for the rewrite', () => {
    const json = ceP.box(['PointX', scaled('P')] as never);
    expect(unrollFixedWidthCollections(json).isSame(json)).toBe(true);
    expect(
      unrollFixedWidthCollections(json, { typedPointLists: true }).toString()
    ).toBe('4PointX(P) + 0.3 * t');
  });

  test('a union of a point and a list of points keeps the run-time dispatch', () => {
    const r = compileP(['PointX', scaled('U')], 'javascript');
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.pointComponent(');
    expect(r.run!({ t: 0.5, U: POINTS })).toEqual(
      interpretedP(['PointX', scaled('U')], 0.5)
    );
  });

  test('two lists of unknown width are not folded: their widths can differ', () => {
    const r = compileP(['PointX', ['Add', 'P', 'Q']], 'javascript');
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), _.P, _.Q)');
  });

  test('points of another arity are not folded', () => {
    const json = ['PointX', ['Add', 'P', ['Tuple', 1, 2, 3]]];
    const folded = unrollFixedWidthCollections(ceP.box(json as never), {
      typedPointLists: true,
    });
    expect(folded.operator).toBe('PointX');
  });

  test('a list of bare tuples is not folded: a coordinate can be a string', () => {
    // The interpreter reports `incompatible-type` for `4·("a", 2)`.
    ceP.declare('R', 'list<tuple>');
    for (const json of [
      ['PointX', ['Multiply', 4, 'R']],
      ['PointX', ['Negate', 'R']],
    ]) {
      const folded = unrollFixedWidthCollections(ceP.box(json as never), {
        typedPointLists: true,
      });
      expect(folded.operator).toBe('PointX');
    }
  });

  test('a point whose coordinate may be a list is not folded', () => {
    // With `S = [10, 20]`, the interpreter reports `incompatible-type` for
    // `P + (S, S)`. The folded form `PointX(P) + S` added the lists
    // element-wise.
    ceP.declare('S', 'number | list<number>');
    const json = ['PointX', ['Add', 'P', ['Tuple', 'S', 'S']]];
    const folded = unrollFixedWidthCollections(ceP.box(json as never), {
      typedPointLists: true,
    });
    expect(folded.operator).toBe('PointX');
  });

  test('a point whose DROPPED coordinate may be a list is not folded', () => {
    // `PointX(P + (t, S2))` reads only `t`, but with `S2 = [10, 20]` the
    // interpreter reports `incompatible-type` for the sum. The folded form
    // `PointX(P) + t` dropped `S2` and answered.
    ceP.declare('S2', 'number | list<number>');
    const json = ['PointX', ['Add', 'P', ['Tuple', 't', 'S2']]];
    const folded = unrollFixedWidthCollections(ceP.box(json as never), {
      typedPointLists: true,
    });
    expect(folded.operator).toBe('PointX');
  });

  test('interval-js: the folded sum adds the terms in the order of the points', () => {
    // Canonical order would be `PointX(P) + 1e16 + 0.1 + 0.7`, which gives
    // the bounds 9999999999999994 and 10000000000000006. The expected cells
    // are the result before the fold existed, when the target added the
    // points at run time (`_IA.bcastPoint`).
    const json = [
      'PointX',
      [
        'Add',
        'P',
        ['Tuple', 0.7, 0.3],
        ['Tuple', 1e16, 0.2],
        ['Tuple', 0.1, 0.2],
      ],
    ];
    const r = compileP(json, 'interval-js');
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('bcastPoint');
    const got = r.run!({
      P: [
        [0.1, 0.2],
        [0.3, -0.7],
        [1e-17, 3],
      ],
    }) as unknown as { value: { lo: number; hi: number } }[];
    expect(got.map((cell) => cell.value)).toEqual([
      { lo: 9999999999999996, hi: 10000000000000004 },
      { lo: 9999999999999996, hi: 10000000000000006 },
      { lo: 9999999999999996, hi: 10000000000000004 },
    ]);
  });
});
