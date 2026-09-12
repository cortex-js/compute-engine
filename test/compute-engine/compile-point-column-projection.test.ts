/**
 * COLUMN PROJECTION of a point list built from columns.
 *
 * `PointList([x₁, x₂, x₃], [y₁, y₂, y₃], [z₁, z₂, z₃])` zips its columns into
 * three points, and `PointX` of it reads the first coordinate of each point
 * back out: the first column. The targets built every point and mapped over
 * them for each of the three accessors (the Tycho code-generation audit of
 * 0.128.9, records 683, 694, 721 and 748 in `art/n7uhaaoq1q`). The
 * target-independent pre-pass (`fixed-width-unroll.ts`) now folds such an
 * accessor to the column itself when every column is provably the same width,
 * so no point is built.
 *
 * The spine of every case is INTERPRETER PARITY, row by row.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
for (const s of ['u', 'v', 'x', 'y']) ce.declare(s, 'real');

// The three columns of the audit rows: sin(360u)·[v, 1, v], cos(360u)·[v, 1, v], [0, v, 1].
const COLUMN = (k: unknown) => ['Multiply', k, ['List', 'v', 1, 'v']];
const P = [
  'PointList',
  COLUMN(['Sin', ['Multiply', 360, 'u']]),
  COLUMN(['Cos', ['Multiply', 360, 'u']]),
  ['List', 0, 'v', 1],
];
const R = ['Range', 1, 4];
// One row of record 748: a point per (y, x) reading the three coordinates.
const ROW = [
  'PointList',
  [
    'Multiply',
    ['Subtract', 2, ['Multiply', 0.3, ['At', R, 'y']]],
    ['At', ['PointX', P], 'x'],
  ],
  [
    'Multiply',
    ['Subtract', 2, ['Multiply', 0.3, ['At', R, 'y']]],
    ['At', ['PointY', P], 'x'],
  ],
  [
    'Subtract',
    [
      'Subtract',
      ['Multiply', -0.2, ['At', ['PointZ', P], 'x']],
      ['Multiply', 0.1, ['At', R, 'y']],
    ],
    3.4,
  ],
];
const TABLE = [
  'Comprehension',
  ROW,
  ['Element', 'y', ['Range', 1, 4]],
  ['Element', 'x', ['Range', 1, 3]],
];
const U = 0.3;
const V = 0.7;

/** The interpreter's point for one (y, x) cell of `ROW`. */
function interpretedRow(y: number, x: number): number[] {
  const point = ce
    .box(ROW)
    .subs({
      u: ce.number(U),
      v: ce.number(V),
      x: ce.number(x),
      y: ce.number(y),
    })
    .N();
  return point.ops!.map((c) => c.valueOf() as number);
}

function compiled(json: unknown, options: Record<string, unknown> = {}) {
  const r = compile(ce.box(json), { fallback: false, ...options });
  expect(r.success).toBe(true);
  return { source: (r.preamble ?? '') + r.code, run: r.run! };
}

const buildsPoints = (source: string): boolean =>
  /\.map\(\(_pt\)/.test(source) || /new Array\(/.test(source);

describe('Column projection of a point list built from columns', () => {
  test('the audit row reads the columns and builds no point', () => {
    const { source, run } = compiled(TABLE);
    expect(buildsPoints(source)).toBe(false);
    const rows = run({ u: U, v: V }) as number[][];
    expect(rows).toHaveLength(12);
    let i = 0;
    for (let y = 1; y <= 4; y++)
      for (let x = 1; x <= 3; x++) {
        const want = interpretedRow(y, x);
        rows[i].forEach((c, k) => expect(c).toBeCloseTo(want[k], 12));
        i += 1;
      }
  });

  test('a plain accessor over column-built points is the column', () => {
    const json = ['PointY', P];
    const { source, run } = compiled(json);
    expect(buildsPoints(source)).toBe(false);
    const got = run({ u: U, v: V }) as number[];
    const want = ce
      .box(json)
      .subs({ u: ce.number(U), v: ce.number(V) })
      .N()
      .ops!.map((c) => c.valueOf() as number);
    expect(got).toHaveLength(3);
    got.forEach((c, k) => expect(c).toBeCloseTo(want[k], 12));
  });
});

describe('Column projection — when the point list is still built', () => {
  test('columns of different widths zip to the shortest', () => {
    const json = ['PointX', ['PointList', COLUMN(2), ['List', 'u', 'v']]];
    const { source, run } = compiled(json);
    expect(buildsPoints(source)).toBe(true);
    expect(run({ u: U, v: V })).toEqual([2 * V, 2]);
  });

  test('a discarded column with an effect is still evaluated', () => {
    const json = [
      'PointX',
      ['PointList', COLUMN(2), ['Multiply', ['Random'], ['List', 1, 2, 3]]],
    ];
    const { source } = compiled(json);
    expect(buildsPoints(source)).toBe(true);
  });

  test('a scalar slot at the read position repeats for every point', () => {
    const json = ['PointY', ['PointList', COLUMN(2), 'u']];
    const { source, run } = compiled(json);
    expect(buildsPoints(source)).toBe(true);
    expect(run({ u: U, v: V })).toEqual([U, U, U]);
  });

  test('a column wider than the iteration budget keeps the capped zip', () => {
    const { source, run } = compiled(['PointX', P], { iterationBudget: 2 });
    expect(buildsPoints(source)).toBe(true);
    expect(run({ u: U, v: V })).toHaveLength(2);
    // A fractional budget floors, as the zip's own cap does.
    const fractional = compiled(['PointX', P], { iterationBudget: 2.9 });
    expect(buildsPoints(fractional.source)).toBe(true);
    expect(fractional.run({ u: U, v: V })).toHaveLength(2);
  });

  test('a column exactly as wide as the budget is projected', () => {
    const { source, run } = compiled(['PointX', P], { iterationBudget: 3 });
    expect(buildsPoints(source)).toBe(false);
    const got = run({ u: U, v: V }) as number[];
    const want = ce
      .box(['PointX', P])
      .subs({ u: ce.number(U), v: ce.number(V) })
      .N()
      .ops!.map((c) => c.valueOf() as number);
    expect(got).toHaveLength(3);
    got.forEach((c, k) => expect(c).toBeCloseTo(want[k], 12));
  });

  test('a discarded column reading a live-source `vars` splice is still evaluated', () => {
    // `w` is spliced as source, which may count its reads.
    ce.declare('w', 'real');
    const json = ['PointX', ['PointList', COLUMN(2), COLUMN('w')]];
    const r = compile(ce.box(json), {
      fallback: false,
      vars: { w: '_.counter()' },
    });
    expect(r.success).toBe(true);
    expect(buildsPoints((r.preamble ?? '') + r.code)).toBe(true);
  });

  test('a point list whose head the caller overrode keeps the override', () => {
    const json = ['PointX', ['PointList', COLUMN(2), COLUMN(3)]];
    const r = compile(ce.box(json), {
      fallback: false,
      functions: { PointList: '_.myPointList' },
    });
    expect(r.success).toBe(true);
    expect((r.preamble ?? '') + r.code).toContain('myPointList');
  });

  test('a coordinate past the columns is rejected before any rewrite', () => {
    // The `PointZ` canonical handler rejects a third coordinate of 2-D
    // points (`incompatible-dimensions`); the pre-pass never sees a valid
    // node to fold, and the compiler refuses the invalid expression.
    const expr = ce.box(['PointZ', ['PointList', COLUMN(2), COLUMN(3)]]);
    expect(expr.isValid).toBe(false);
    expect(() => compile(expr, { fallback: false })).toThrow(/invalid/);
  });
});
