/**
 * A `PointList` component that is a point (a tuple) is refused.
 *
 * A coordinate of `PointList` is a number or a list of numbers. A whole
 * point in the place of one coordinate is almost certainly an error of the
 * author. Before, `PointList([1, 2], (5, 6))` put the whole point in each
 * second coordinate, `[(1, (5, 6)), (2, (5, 6))]`, and with `P: tuple`,
 * `PointList([1, 2], P)` was typed `list<tuple<integer, unknown>>`, because
 * the bare `tuple` is a subtype of `indexed_collection` and was read as a
 * list component.
 *
 * Now:
 * - a component whose type is a tuple (any spelling, possibly absent) is
 *   refused when the call is boxed, with the error in place;
 * - a component whose VALUE is a tuple (a symbol declared `unknown` that
 *   holds a point) is refused when the call is evaluated, with a bare error
 *   that carries the frame `{PointList, index}`.
 *
 * A string, a number, a list and a matrix component are admitted as before.
 * The refusal is the `canonical` and `evaluate` handlers of `PointList` in
 * `src/compute-engine/library/collections.ts`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const json = (x: Expression) => JSON.stringify(x.json);

const EXPECTED = "'list<number> | number'";

describe('a tuple-typed component is refused when the call is boxed', () => {
  const ce = new ComputeEngine();
  ce.declare('P', 'tuple');
  ce.declare('Q', 'tuple<integer, integer>');
  ce.declare('W', 'missing | tuple<integer, integer>');

  const cases: [unknown, number][] = [
    [['PointList', ['List', 1, 2], ['Tuple', 5, 6]], 1],
    [['PointList', ['List', 1, 2], 'P'], 1],
    [['PointList', ['List', 1, 2], 'Q'], 1],
    [['PointList', ['List', 1, 2], 'W'], 1],
    [['PointList', ['Tuple', 5, 6], 3], 0],
    [['PointList', 'P', 3], 0],
    [['PointList', ['Tuple', 5, 6]], 0],
  ];
  test.each(cases)('%j', (input, index) => {
    const expr = ce.box(input as never);
    expect(expr.isValid).toBe(false);
    expect(expr.type.toString()).toBe('error');
    const refused = expr.ops![index];
    expect(refused.operator).toBe('Error');
    expect(json(refused)).toContain("'incompatible-type'");
    expect(json(refused)).toContain(EXPECTED);
  });

  test('the error names the expected and the actual types', () => {
    expect(
      ce.box(['PointList', ['List', 1, 2], ['Tuple', 5, 6]]).toString()
    ).toBe(
      'PointList([1,2], Error(ErrorCode("incompatible-type", "list<number> | number", "tuple<integer, integer>"), (5, 6)))'
    );
  });

  test('the ce.function route gives the same expression', () => {
    expect(
      ce
        .function('PointList', [
          ce.box(['List', 1, 2]),
          ce.box(['Tuple', 5, 6]),
        ])
        .toString()
    ).toBe(
      'PointList([1,2], Error(ErrorCode("incompatible-type", "list<number> | number", "tuple<integer, integer>"), (5, 6)))'
    );
  });
});

describe('a component whose value is a tuple is refused at evaluation', () => {
  test('a symbol declared unknown that holds a point', () => {
    const ce = new ComputeEngine();
    ce.declare('U', 'unknown');
    ce.assign('U', ce.box(['Tuple', 5, 6]));
    const expr = ce.box(['PointList', ['List', 1, 2], 'U']);
    // The canonical form does not read the value of the symbol.
    expect(expr.isValid).toBe(true);
    expect(json(expr.evaluate())).toBe(
      JSON.stringify([
        'Error',
        [
          'ErrorCode',
          "'incompatible-type'",
          EXPECTED,
          "'tuple<integer, integer>'",
        ],
        ['Tuple', 5, 6],
        ['ErrorTrace', ['ErrorFrame', "'PointList'", 2]],
      ])
    );
    // Once the symbol holds a list, the same call zips.
    ce.assign('U', ce.box(['List', 7, 8]));
    expect(
      ce
        .box(['PointList', ['List', 1, 2], 'U'])
        .evaluate()
        .toString()
    ).toBe('[(1, 7),(2, 8)]');
  });
});

describe('the other components are admitted as before', () => {
  const ce = new ComputeEngine();
  const cases: [unknown, string][] = [
    [['PointList', ['List', 1, 2], ['List', 3, 4]], '[(1, 3),(2, 4)]'],
    [['PointList', ['List', 1, 2], 7], '[(1, 7),(2, 7)]'],
    [['PointList', ['List', 1, 2], "'ab'"], '[(1, "ab"),(2, "ab")]'],
    [['PointList', 5, 6], '(5, 6)'],
  ];
  test.each(cases)('%j', (input, expected) => {
    const expr = ce.box(input as never);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe(expected);
  });

  test('a restricted list source keeps its absent arm', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'missing | list<integer>');
    expect(ce.box(['PointList', ['List', 1, 2], 'M']).type.toString()).toBe(
      'list<tuple<integer, integer>> | missing'
    );
  });
});
