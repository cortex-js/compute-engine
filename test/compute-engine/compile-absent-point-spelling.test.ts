/**
 * Compiled JavaScript spells an ABSENT POINT `undefined`, also when the
 * point is the result of arithmetic (user decision of 2026-09-27).
 *
 * The restricted point `P{c}` (`When(PointList(t, 1), 1 < t)`) is typed
 * `missing | tuple<…>` and lowers to `c ? [t, 1] : undefined`. The
 * interpreter answers `Missing` for arithmetic on an absent point: `t·P`,
 * `P + Q`, `−P`, `P / t`. Before this decision the compiled broadcast applied
 * its closure to the absent value as to a number, so `t·P` ran to `NaN` and
 * `P + Q` to the point `[NaN, NaN]`, while a restricted point, `At(P, 5)`
 * and the interpreter fallback already answered `undefined`. Now:
 *
 * - arithmetic whose result is a point answers `undefined` for the whole
 *   point when a point operand is absent;
 * - a result that is a list of points answers `undefined` in each cell that
 *   is absent (`[1, 2, 3]·P{c}`, `[P{c}, Q]·2`);
 * - a numeric read of an absent point (`PointX`) stays `NaN`, the absent
 *   value of a numeric slot.
 *
 * Each case is compiled without a fallback (`fallback: false`), so the value
 * comes from the lowering, and compared with the interpreter fallback forced
 * by an unregistered target.
 *
 * Since 2026-11-01 the compiled value of arithmetic with an absent operand
 * is not specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code",
 * the bullet "Everything computed from an absent value, except at a
 * discharge"; R4 of `docs/plans/2026-11-01-absent-value-contract.md`). The
 * tests check the compiled value for a present point only, and the
 * interpreter fallback for both.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('c', 'real');
ce.declare('d', 'real');

// Using an unregistered target deterministically forces the fallback.
const FORCE = { to: 'no-such-target' };

/** `v` shown only when `1 < t`: absent at `t = 0`, present at `t = 2`. */
const gated = (v: unknown = ['PointList', 't', 1]) => [
  'When',
  v,
  ['Less', 1, 't'],
];
const Q = ['PointList', 2, 't'];

function compiledRun(json: unknown, t: number): unknown {
  const r = compile(ce.box(json as never), {
    to: 'javascript',
    fallback: false,
  } as never);
  expect(r.success).toBe(true);
  return r.run!({ t } as never);
}

function fallbackRun(json: unknown, t: number): unknown {
  const r = compile(ce.box(json as never), FORCE as never);
  expect(r.success).toBe(false);
  return r.run!({ t } as never);
}

describe('Compiled arithmetic on an absent point', () => {
  // The compiled value with an absent point is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`). Only the interpreter
  // fallback is checked for it.
  let warn: jest.SpyInstance;
  beforeAll(() => {
    // The fallback intentionally warns; silence it for clean test output.
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  const pointResults: Array<[string, unknown, number[]]> = [
    ['a scalar times the point', ['Multiply', 't', gated()], [4, 2]],
    ['the point times a scalar', ['Multiply', gated(), 't'], [4, 2]],
    ['a number times the point', ['Multiply', 2, gated()], [4, 2]],
    ['the point divided by a scalar', ['Divide', gated(), 't'], [1, 0.5]],
    ['the negated point', ['Negate', gated()], [-2, -1]],
    ['the point plus a point', ['Add', gated(), Q], [4, 3]],
    ['a point plus the point', ['Add', Q, gated()], [4, 3]],
    ['the point minus a point', ['Subtract', gated(), Q], [0, -1]],
    ['a point minus the point', ['Subtract', Q, gated()], [0, 1]],
    ['two absent points', ['Add', gated(), gated(Q)], [4, 3]],
    [
      'a scaled absent point plus a point',
      ['Add', ['Multiply', 't', gated()], Q],
      [6, 4],
    ],
  ];

  test.each(pointResults)(
    '%s is undefined in the interpreter when the point is absent',
    (_label, json) => {
      expect(fallbackRun(json, 0)).toBeUndefined();
    }
  );

  test.each(pointResults)(
    '%s is the point when the point is present',
    (_label, json, expected) => {
      expect(compiledRun(json, 2)).toEqual(expected);
      expect(fallbackRun(json, 2)).toEqual(expected);
    }
  );

  test('a list of numbers times the absent point is undefined per cell', () => {
    const json = ['Multiply', ['List', 1, 2, 3], gated()];
    const expected = [undefined, undefined, undefined];
    // `toStrictEqual` tells an `undefined` cell from `NaN`.
    expect(fallbackRun(json, 0)).toStrictEqual(expected);
    expect(compiledRun(json, 2)).toEqual([
      [2, 1],
      [4, 2],
      [6, 3],
    ]);
  });

  test('a list of points with an absent cell keeps the cell absent', () => {
    const json = [
      'Multiply',
      ['List', gated(['Tuple', 1, 2]), ['Tuple', 3, 4]],
      2,
    ];
    const expected = [undefined, [6, 8]];
    expect(fallbackRun(json, 0)).toStrictEqual(expected);
    // The compiled cell of the absent point is not specified; the cell of
    // the present point is.
    const compiled = compiledRun(json, 0) as unknown[];
    expect(compiled).toHaveLength(2);
    expect(compiled[1]).toEqual([6, 8]);
    expect(compiledRun(json, 2)).toEqual([
      [2, 4],
      [6, 8],
    ]);
  });

  // `[P{c}, Q]{d}` can be absent itself (when `d` fails), and, when it is
  // present, its first element can be absent (when `c` fails). The second
  // level was ignored: with `d` true and `c` false, `2·[P{c}, Q]{d}` compiled
  // to a first cell of `NaN` instead of the absent point.
  test('a restricted list of points with an absent cell', () => {
    const json = [
      'Multiply',
      [
        'When',
        ['List', ['When', ['Tuple', 1, 2], ['Less', 0, 'c']], ['Tuple', 3, 4]],
        ['Less', 0, 'd'],
      ],
      2,
    ];
    const run = (route: 'compiled' | 'fallback', c: number, d: number) => {
      const r = compile(
        ce.box(json as never),
        (route === 'compiled'
          ? { to: 'javascript', fallback: false }
          : FORCE) as never
      );
      expect(r.success).toBe(route === 'compiled');
      return r.run!({ c, d } as never);
    };
    const cases: Array<[number, number, unknown]> = [
      [
        1,
        1,
        [
          [2, 4],
          [6, 8],
        ],
      ],
      [-1, 1, [undefined, [6, 8]]],
      [1, -1, undefined],
      [-1, -1, undefined],
    ];
    for (const [c, d, expected] of cases) {
      // `toStrictEqual` tells an `undefined` cell from `NaN`.
      expect(run('fallback', c, d)).toStrictEqual(expected);
    }
    // The compiled value is checked where no point is absent, and in the
    // cell of the present point when only the first point is absent. With
    // `d` false the whole list is absent, and its compiled value is not
    // specified.
    expect(run('compiled', 1, 1)).toStrictEqual(cases[0][2]);
    const partial = run('compiled', -1, 1) as unknown[];
    expect(partial).toHaveLength(2);
    expect(partial[1]).toEqual([6, 8]);
  });

  test('a coordinate of the absent point is NaN (a numeric slot)', () => {
    for (const head of ['PointX', 'PointY']) {
      const json = [head, gated()];
      expect(compiledRun(json, 0)).toBeNaN();
      expect(fallbackRun(json, 0)).toBeNaN();
    }
  });

  test('the norm of the absent point is NaN (a numeric slot)', () => {
    const json = ['Abs', gated()];
    expect(compiledRun(json, 0)).toBeNaN();
    expect(fallbackRun(json, 0)).toBeNaN();
  });

  // An absent LIST is an absent object as well.
  test('a restricted list plus a number is undefined when absent', () => {
    const json = ['Add', gated(['List', 1, 2, 3]), 1];
    expect(fallbackRun(json, 0)).toBeUndefined();
    expect(compiledRun(json, 2)).toEqual([2, 3, 4]);
  });

  // A present list gives the shape, and the absent list is `NaN` in each
  // numeric cell: the interpreter answers `[NaN, NaN]`, typed `vector<2>`.
  // The compiled value is not specified.
  test('a list plus an absent list is a list of NaN', () => {
    const json = ['Add', ['List', 1, 2], gated(['List', 1, 2])];
    expect(fallbackRun(json, 0)).toEqual([NaN, NaN]);
  });

  test('a present point times a scalar', () => {
    const r = compile(
      ce.box(['Multiply', 't', ['PointList', 't', 1]] as never),
      { to: 'javascript', fallback: false } as never
    );
    expect(r.success).toBe(true);
    expect(r.run!({ t: 2 } as never)).toEqual([4, 2]);
  });
});
