/**
 * `ListJoin` with a tuple operand, in the profile `ir` (CE-1565): the
 * interpreter appends a tuple as one element (it does not splice), so
 * `ListJoin(S, (0, 0))` of a list of points `S` is `S` with one more point.
 * The compiled value is the same list of points. A tuple beside a list
 * whose elements are not tuples of the same arity declines (two element
 * shapes).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

type Json = unknown;
type Pair = [number, number];

const ce = new ComputeEngine();
ce.declare('S', 'list<tuple<real, real>>');
ce.declare('T', 'list<tuple<real, real, real>>');
ce.declare('L', 'list<real>');
ce.declare('p', 'tuple<real, real>');
ce.declare('x', 'real');

const IR = { profile: 'ir', fallback: false } as const;
const box = (json: Json) => ce.box(json as never);

const POINTS: { S: Pair[]; p: Pair; x: number }[] = [
  { S: [], p: [7, 8], x: 0.5 },
  { S: [[1, 2]], p: [-1, 0], x: -2 },
  {
    S: [
      [1, 2],
      [3, 4],
      [5, -6],
    ],
    p: [0.25, 9],
    x: 3,
  },
];

/** The interpreter's value of `json` at `pt`, as nested arrays. */
function interpret(json: Json, pt: (typeof POINTS)[number]): unknown {
  ce.pushScope();
  try {
    ce.declare('S', 'list<tuple<real, real>>');
    ce.declare('p', 'tuple<real, real>');
    ce.declare('x', 'real');
    ce.assign('S', box(['List', ...pt.S.map((q) => ['Tuple', ...q])]));
    ce.assign('p', box(['Tuple', ...pt.p]));
    ce.assign('x', pt.x);
    const v = box(json).evaluate();
    return v.ops!.map((t) => t.ops!.map((c) => c.re));
  } finally {
    ce.popScope();
  }
}

const S = ['PointList', ['PointX', 'S'], ['PointY', 'S']];

describe('ListJoin of a tuple operand (CE-1565)', () => {
  test.each([
    // The witness: Desmos `join(L, (0, 0))`.
    ['a list of points and a point', ['ListJoin', S, ['PointList', 0, 0]]],
    ['an input list and a tuple', ['ListJoin', 'S', ['Tuple', 0, 0]]],
    [
      'a tuple first and a tuple input',
      ['ListJoin', ['Tuple', 'x', 1], 'S', 'p'],
    ],
    ['tuples only', ['ListJoin', 'p', ['Tuple', 'x', 2], 'p']],
    ['one tuple', ['ListJoin', 'p']],
    [
      'a tuple of an If',
      [
        'ListJoin',
        'S',
        ['If', ['Greater', 'x', 0], ['Tuple', 1, 1], ['Tuple', 'x', 2]],
      ],
    ],
  ])('%s', (_name, json) => {
    const f = compile(box(json), IR);
    for (const pt of POINTS) expect(f.run(pt)).toEqual(interpret(json, pt));
  });

  test.each([
    ['a list of reals', ['ListJoin', 'L', ['Tuple', 0, 0]]],
    ['a list of triples', ['ListJoin', 'T', ['Tuple', 0, 0]]],
  ])('beside %s, declines', (_name, json) => {
    expect(() => compile(box(json), IR)).toThrow(/arms of two types/);
  });
});
