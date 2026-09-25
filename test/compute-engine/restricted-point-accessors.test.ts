/**
 * Coordinate accessors, element access and the cross product of a
 * RESTRICTED point or a restricted list of points whose condition is not
 * decided yet.
 *
 * With `t` free, the restricted point `(1, 2) {0 < t}` stays a `When` after
 * evaluation, and the restricted list `[(1, 2), (3, 4)] {0 < t}` evaluates to
 * the list of its restricted points `[(1, 2) {0 < t}, (3, 4) {0 < t}]`. The
 * operators below read the point in the restriction and move the restriction
 * to their result, so the value with `t` free agrees with the values once the
 * condition is decided (`t = 2`: present, `t = -1`: absent).
 *
 * Before, `PointX` of the restricted list was the first POINT `(1, 2) {0 < t}`
 * (element indexing), `PointX`/`First` of the restricted point were an
 * `incompatible-type` error, `At` of it was `Missing`, and `Cross` stayed
 * unevaluated with `t` free and was an `incompatible-type` error at `t = -1`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const c = ['Less', 0, 't'];
const RL = ['When', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], c];
const RL3 = ['When', ['List', ['Tuple', 1, 2, 3], ['Tuple', 3, 4, 5]], c];
const RP = ['When', ['Tuple', 1, 2], c];
const RP3 = ['When', ['Tuple', 1, 2, 3], c];

function value(json: unknown, t?: number): string {
  const ce = new ComputeEngine();
  if (t !== undefined) ce.assign('t', t);
  const e = ce.box(json as never);
  return e.evaluate().toString();
}

function type(json: unknown): string {
  return new ComputeEngine().box(json as never).type.toString();
}

describe('Coordinate accessors of a restricted point or list of points', () => {
  test.each([
    [
      'PointX of a restricted list',
      ['PointX', RL],
      '[1 {0 < t},3 {0 < t}]',
      '[1,3]',
      '"Missing"',
    ],
    [
      'PointY of a restricted list',
      ['PointY', RL],
      '[2 {0 < t},4 {0 < t}]',
      '[2,4]',
      '"Missing"',
    ],
    [
      'PointZ of a restricted list',
      ['PointZ', RL3],
      '[3 {0 < t},5 {0 < t}]',
      '[3,5]',
      '"Missing"',
    ],
    ['PointX of a restricted point', ['PointX', RP], '1 {0 < t}', '1', 'NaN'],
    ['PointY of a restricted point', ['PointY', RP], '2 {0 < t}', '2', 'NaN'],
    ['PointZ of a restricted point', ['PointZ', RP3], '3 {0 < t}', '3', 'NaN'],
    [
      'PointY of a list that holds a restricted point',
      ['PointY', ['List', RP, ['Tuple', 3, 4]]],
      '[2 {0 < t},4]',
      '[2,4]',
      '["Missing",4]',
    ],
  ])('%s', (_l, json, free, present, absent) => {
    expect(value(json)).toBe(free);
    expect(value(json, 2)).toBe(present);
    expect(value(json, -1)).toBe(absent);
  });

  test('an absent coordinate follows the unrestricted absent point', () => {
    // The restricted point at `t = -1` answers what `PointX(Missing)` does.
    expect(value(['PointX', 'Missing'])).toBe('NaN');
  });

  test('an absent first point does not decide the reading', () => {
    expect(value(['PointX', ['List', 'Missing', ['Tuple', 1, 2]]])).toBe(
      '["Missing",1]'
    );
    // A masked cell is `Missing`, and the list is typed `list<T | missing>`
    // (user decision of 2026-09-09, `docs/ERROR-MODEL.md`).
    expect(type(['PointX', ['List', 'Missing', ['Tuple', 1, 2]]])).toBe(
      'list<missing | number>'
    );
    // An element-wise restriction whose first condition is false.
    const elementwise = [
      'When',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['List', c, ['Less', 't', 0]],
    ];
    expect(value(['PointX', elementwise], -1)).toBe('["Missing",3]');
    expect(value(['PointX', elementwise], 2)).toBe('[1,"Missing"]');
  });

  test('PointZ of a restricted 2-D point is a dimension error while present', () => {
    // The error is the one of `PointZ((1, 2))`, with `t` free as when the
    // condition holds. An absent point answers the absence marker first, as
    // for `Dot` of points of different widths.
    for (const json of [
      ['PointZ', RP],
      ['PointZ', ['When', ['List', ['Tuple', 1, 2]], c]],
    ]) {
      expect(value(json)).toContain('incompatible-dimensions');
      expect(value(json, 2)).toContain('incompatible-dimensions');
    }
    expect(value(['PointZ', RP], -1)).toBe('NaN');
  });

  test('the types', () => {
    expect(type(['PointX', RL])).toBe('missing | vector<2>');
    expect(type(['PointX', RP])).toBe('number');
    expect(type(['PointY', ['List', RP, ['Tuple', 3, 4]]])).toBe(
      'list<missing | number>'
    );
  });
});

describe('Element access of a restricted point', () => {
  test.each([
    ['First', ['First', RP], '1 {0 < t}', '1', '"Missing"'],
    ['Last', ['Last', RP], '2 {0 < t}', '2', '"Missing"'],
    ['At', ['At', RP, 2], '2 {0 < t}', '2', '"Missing"'],
    [
      'At with two indices',
      ['At', ['When', ['List', ['List', 1, 2], ['List', 3, 4]], c], 2, 1],
      '3 {0 < t}',
      '3',
      '"Missing"',
    ],
  ])('%s', (_l, json, free, present, absent) => {
    expect(value(json)).toBe(free);
    expect(value(json, 2)).toBe(present);
    expect(value(json, -1)).toBe(absent);
  });
});

describe('Cross of a restricted point', () => {
  test.each([
    [
      'a restricted point and a point',
      ['Cross', RP3, ['Tuple', 1, 1, 1]],
      '(-1, 2, -1) {0 < t}',
      '(-1, 2, -1)',
      '"Missing"',
    ],
    [
      'a point and a restricted point',
      ['Cross', ['Tuple', 1, 1, 1], RP3],
      '(1, -2, 1) {0 < t}',
      '(1, -2, 1)',
      '"Missing"',
    ],
    [
      'two points restricted by the same condition',
      ['Cross', RP3, ['When', ['Tuple', 1, 1, 1], c]],
      '(-1, 2, -1) {0 < t}',
      '(-1, 2, -1)',
      '"Missing"',
    ],
    [
      'a restricted vector and a vector',
      ['Cross', ['When', ['List', 1, 2, 3], c], ['List', 1, 1, 1]],
      '[-1 {0 < t},2 {0 < t},-1 {0 < t}]',
      '[-1,2,-1]',
      '[NaN,NaN,NaN]',
    ],
    [
      'a vector and a restricted vector',
      ['Cross', ['List', 1, 1, 1], ['When', ['List', 1, 2, 3], c]],
      '[1 {0 < t},-2 {0 < t},1 {0 < t}]',
      '[1,-2,1]',
      '[NaN,NaN,NaN]',
    ],
  ])('%s', (_l, json, free, present, absent) => {
    expect(value(json)).toBe(free);
    expect(value(json, 2)).toBe(present);
    expect(value(json, -1)).toBe(absent);
  });

  test('an absent operand is admitted', () => {
    const ce = new ComputeEngine();
    for (const json of [
      ['Cross', 'Missing', ['Tuple', 1, 1, 1]],
      ['Cross', ['Tuple', 1, 1, 1], 'Missing'],
    ]) {
      const e = ce.box(json as never);
      expect(e.isValid).toBe(true);
      expect(e.evaluate().json).toBe('Missing');
    }
    expect(
      ce
        .box(['Cross', ['List', 1, 1, 1], 'Missing'] as never)
        .evaluate()
        .toString()
    ).toBe('[NaN,NaN,NaN]');
  });

  test('the type of a restricted point product carries the absent case', () => {
    expect(type(['Cross', RP3, ['Tuple', 1, 1, 1]])).toBe(
      'missing | tuple<number, number, number>'
    );
  });

  test('a restricted 2-D point is a dimension error while present', () => {
    const json = ['Cross', RP, ['Tuple', 1, 1, 1]];
    expect(value(json)).toContain('incompatible-dimensions');
    expect(value(json, 2)).toContain('incompatible-dimensions');
  });

  test('a restricted list of points is the error of a list of points', () => {
    // `Cross` does not take a list of points, with or without a condition.
    const ce = new ComputeEngine();
    const plain = ce.box([
      'Cross',
      ['List', ['Tuple', 1, 2, 3], ['Tuple', 3, 4, 5]],
      ['Tuple', 1, 1, 1],
    ] as never);
    const restricted = ce.box(['Cross', RL3, ['Tuple', 1, 1, 1]] as never);
    expect(plain.isValid).toBe(false);
    expect(restricted.isValid).toBe(false);
    expect(restricted.toString()).toContain('incompatible-type');
  });
});

describe('Dot of a restricted list of points of the wrong width', () => {
  test('is one error, whatever the value of the condition', () => {
    const json = ['Dot', RL, ['Tuple', 1, 1, 1]];
    expect(value(json)).toBe('Error("incompatible-dimensions", "2 vs 3")');
    expect(value(json, 2)).toBe('Error("incompatible-dimensions", "2 vs 3")');
  });
});

describe('Compiled accessors of a restricted point', () => {
  const ce = new ComputeEngine();
  function run(json: unknown, t: number): unknown {
    const r = compile(ce.box(json as never), { to: 'javascript' } as never);
    expect(r.success).toBe(true);
    return r.run!({ t } as never);
  }

  test('PointX of a list that holds a restricted point', () => {
    const json = ['PointX', ['List', ['Tuple', 1, 2], RP]];
    expect(run(json, 2)).toEqual([1, 1]);
    // The absent point's coordinate is NaN, where reading `undefined[0]`
    // threw a TypeError.
    const absent = run(json, -1) as number[];
    expect(absent[0]).toBe(1);
    expect(absent[1]).toBeNaN();
  });

  test('First of a restricted point', () => {
    expect(run(['First', RP], 2)).toBe(1);
    expect(run(['First', RP], -1)).toBeUndefined();
  });

  test('PointX of a restricted list and of a restricted point', () => {
    expect(run(['PointX', RL], 2)).toEqual([1, 3]);
    expect(run(['PointX', RP], 2)).toBe(1);
    expect(run(['PointX', RP], -1)).toBeNaN();
  });

  test.each(['javascript', 'python'])(
    'Cross of a restricted point fails closed on %s',
    (to) => {
      const r = compile(ce.box(['Cross', RP3, ['Tuple', 1, 1, 1]] as never), {
        to,
      } as never);
      expect(r.success).toBe(false);
    }
  );
});
