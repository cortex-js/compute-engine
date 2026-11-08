/**
 * The derivative of a `ListJoin` (the canonical form of a list literal with
 * a spread, and the form of a Desmos `join`) is the `ListJoin` of the
 * derivatives of its operands: a single point is one element, and a list,
 * or an expression whose value is a list (a `Block`), gives its elements.
 * A coordinate accessor of the join then reads the derivative of each
 * element, in order. Before this rule, each of these derivatives stayed
 * `D(…)` unevaluated.
 *
 * A `ListJoin` with an operand that is a set or a string declines: the
 * derivative of a set does not keep the order or the number of its
 * elements.
 *
 * Corpus: the "Sorry" text of the Desmos document `art/2ki2hjsouf` (Tycho)
 * is `join(piece_1, …, piece_25)`, offset along its normal with
 * `d/du S(u).y`.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const a = ['Tuple', 'u', ['Power', 'u', 2]];
const b = ['Tuple', 'u', ['Power', 'u', 3]];
const c = ['Tuple', ['Sin', 'u'], ['Cos', 'u']];
/** A Desmos `with` binding whose value is a list of points. */
const W = [
  'Block',
  ['Declare', 'k', "'unknown'", 2],
  ['List', ['Tuple', 'u', ['Multiply', 'k', 'u']], b],
];

function d(json: unknown): unknown {
  return ce.box(json as never).evaluate().json;
}

describe('CE-1116: the derivative of a ListJoin', () => {
  test('a coordinate of a join of single points', () => {
    expect(d(['D', ['PointY', ['ListJoin', a, b]], 'u'])).toEqual(
      d(['List', ['Multiply', 2, 'u'], ['Multiply', 3, ['Power', 'u', 2]]])
    );
  });

  test('a coordinate of a join of a point and a list of points', () => {
    expect(
      d(['D', ['PointX', ['ListJoin', a, ['List', b, c]]], 'u'])
    ).toEqual(['List', 1, 1, ['Cos', 'u']]);
  });

  test('a coordinate of a join with a Block whose value is a list', () => {
    expect(d(['D', ['PointY', ['ListJoin', ['List', a], W]], 'u'])).toEqual(
      d([
        'List',
        ['Multiply', 2, 'u'],
        2,
        ['Multiply', 3, ['Power', 'u', 2]],
      ])
    );
  });

  test('the join itself gives a list of the derivative points', () => {
    expect(d(['D', ['ListJoin', a, b], 'u'])).toEqual(
      d([
        'List',
        ['Tuple', 1, ['Multiply', 2, 'u']],
        ['Tuple', 1, ['Multiply', 3, ['Power', 'u', 2]]],
      ])
    );
  });

  test('a constant point and a constant list give zero points', () => {
    expect(
      d([
        'D',
        [
          'PointY',
          [
            'ListJoin',
            a,
            ['Tuple', 1, 2],
            ['List', ['Tuple', 3, 4], ['Tuple', 5, 6]],
          ],
        ],
        'u',
      ])
    ).toEqual(d(['List', ['Multiply', 2, 'u'], 0, 0, 0]));
  });

  test('a selector of the join reads the same element', () => {
    expect(d(['D', ['At', ['ListJoin', a, b], 2], 'u'])).toEqual(
      d(['Tuple', 1, ['Multiply', 3, ['Power', 'u', 2]]])
    );
    expect(d(['D', ['Last', ['ListJoin', a, ['List', b, c]]], 'u'])).toEqual(
      d(['Tuple', ['Cos', 'u'], ['Negate', ['Sin', 'u']]])
    );
  });

  test('a join with a set or a string operand declines', () => {
    const withSet = d([
      'D',
      ['ListJoin', a, ['Set', 'u', ['Add', 'u', 1]]],
      'u',
    ]) as unknown[];
    expect(withSet[0]).toBe('D');
    const withString = d(['D', ['ListJoin', a, "'ab'"], 'u']) as unknown[];
    expect(withString[0]).toBe('D');
  });
});
