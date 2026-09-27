/**
 * The interpreter fallback of a compiled function spells an ABSENT result
 * (`Missing`) the way compiled code spells it (user decision of 2026-09-27):
 * `NaN` in a numeric position, `undefined` in an object-domain position — a
 * point, a tuple, a list, a colour — and in a position whose type admits
 * `missing`, since a written absence symbol lowers to `undefined` on the
 * JavaScript target. An absent cell of a list or tuple result is spelled by
 * the cell's type the same way. Before, every absent result of the fallback
 * was `NaN`, so a host could tell from the value which route ran.
 *
 * Each case compares the fallback (forced with an unregistered target) with
 * the JavaScript compilation of the same expression.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('P', 'list<tuple<number, number>>');
ce.assign('P', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));

// Using an unregistered target deterministically forces the fallback.
const FORCE = { to: 'no-such-target' };

/** `v` shown only when `1 < t`: absent at `t = 0`. */
const gated = (v: unknown) => ['When', v, ['Less', 1, 't']];

function fallbackRun(json: unknown, t: number): unknown {
  const r = compile(ce.box(json as never), FORCE as never);
  expect(r.success).toBe(false);
  return r.run!({ t } as never);
}

function compiledRun(json: unknown, t: number): unknown {
  const r = compile(ce.box(json as never), { to: 'javascript' } as never);
  expect(r.success).toBe(true);
  return r.run!({ t } as never);
}

describe('Compilation fallback: the spelling of an absent value', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    // The fallback intentionally warns; silence it for clean test output.
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test.each([
    ['a number', gated(['Add', 't', 1]), NaN],
    ['a point', gated(['Tuple', 't', 1]), undefined],
    ['a point read from a list of points', ['At', 'P', 5], undefined],
    ['a list of numbers', gated(['List', 't', 1]), undefined],
    [
      'a list of points',
      gated(['List', ['Tuple', 't', 1], ['Tuple', 2, 3]]),
      undefined,
    ],
    ['a colour', gated(['Rgb', 't', 0.5, 0.5]), undefined],
    ['a boolean', gated(['Less', 't', 1]), undefined],
    ['a string', gated({ str: 'abc' }), undefined],
    ['the written symbol', 'Missing', undefined],
    [
      'a number read from a list with a written absence',
      ['First', ['List', 'Missing', 1]],
      undefined,
    ],
  ])('%s', (_label, json, expected) => {
    const fallback = fallbackRun(json, 0);
    expect(fallback).toEqual(expected);
    expect(fallback).toEqual(compiledRun(json, 0));
    if (expected === undefined) expect(fallback).toBeUndefined();
  });

  test.each([
    ['a list of numbers, numeric cell', ['List', 't', gated(2)], [0, NaN]],
    [
      'a list of numbers, written absence',
      ['List', 1, 'Missing'],
      [1, undefined],
    ],
    [
      'a list of points',
      ['List', ['Tuple', 't', 1], gated(['Tuple', 2, 3])],
      [[0, 1], undefined],
    ],
    [
      'a list of points read from a list',
      ['List', ['At', 'P', 5], ['Tuple', 't', 1]],
      [undefined, [0, 1]],
    ],
    ['a tuple, numeric coordinate', ['Tuple', 't', gated(2)], [0, NaN]],
    ['a tuple, written absence', ['Tuple', 't', 'Missing'], [0, undefined]],
    [
      'a nested list',
      ['List', ['List', 1, 'Missing'], ['List', 't', 2]],
      [
        [1, undefined],
        [0, 2],
      ],
    ],
  ])('an absent cell in %s', (_label, json, expected) => {
    const fallback = fallbackRun(json, 0);
    // `toStrictEqual` tells an `undefined` cell from a missing one and from
    // `NaN`.
    expect(fallback).toStrictEqual(expected);
    expect(fallback).toStrictEqual(compiledRun(json, 0));
  });

  test('a present value is unchanged', () => {
    const json = gated(['Tuple', 't', 1]);
    expect(fallbackRun(json, 2)).toEqual([2, 1]);
    expect(compiledRun(json, 2)).toEqual([2, 1]);
  });

  test('the lambda calling convention spells an absent point undefined', () => {
    const f = ce.box([
      'Function',
      ['When', ['Tuple', 'x', 1], ['Less', 1, 'x']],
      'x',
    ] as never);
    const fallback = compile(f, FORCE as never);
    const compiled = compile(f, { to: 'javascript' } as never);
    expect(fallback.success).toBe(false);
    expect(compiled.success).toBe(true);
    expect(fallback.run!(0 as never)).toBeUndefined();
    expect(compiled.run!(0 as never)).toBeUndefined();
    expect(fallback.run!(2 as never)).toEqual([2, 1]);
  });

  test('a target without an object null keeps the numeric marker', () => {
    // GLSL declares no object axis for absence, so its compiled code spells
    // every absent value `NaN`; its fallback does the same.
    const r = compile(
      new ComputeEngine().box(['Tuple', 't', 'Missing'] as never),
      {
        to: 'glsl',
      } as never
    );
    expect(r.success).toBe(false);
    expect(r.run!({ t: 0 } as never)).toEqual([0, NaN]);
  });
});

/**
 * The interval-js target has no object null. Its compiled code gives `empty`
 * where there is no value at run time — a restriction whose condition fails,
 * for a number, a point or a list alike — and its fallback now does the same
 * (it gave `{ lo: NaN, hi: NaN }`). The fallback is forced by `First`, which
 * the interval target does not lower: `First([v])` is `v`.
 */
describe('Interval fallback: the spelling of an absent value', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  const intervalRun = (json: unknown, t: number): unknown => {
    const r = compile(ce.box(json as never), { to: 'interval-js' } as never);
    return { success: r.success, value: r.run!({ t } as never) };
  };

  test.each([
    ['a number', gated(['Add', 't', 1])],
    ['a point', gated(['Tuple', 't', 1])],
    ['a list of numbers', gated(['List', 't', 1])],
    ['a list with an absent cell', ['List', 't', gated(2)]],
    [
      'a list of points with an absent point',
      ['List', ['Tuple', 't', 1], gated(['Tuple', 2, 3])],
    ],
  ])('%s', (_label, json) => {
    const compiled = intervalRun(json, 0) as {
      success: boolean;
      value: unknown;
    };
    const fallback = intervalRun(['First', ['List', json]], 0) as {
      success: boolean;
      value: unknown;
    };
    expect(compiled.success).toBe(true);
    expect(fallback.success).toBe(false);
    expect(fallback.value).toEqual(compiled.value);
  });

  test('an absent number is empty, not a NaN interval', () => {
    const { value } = intervalRun(
      ['First', ['List', gated(['Add', 't', 1])]],
      0
    ) as { value: unknown };
    expect(value).toEqual({ kind: 'empty' });
  });
});
