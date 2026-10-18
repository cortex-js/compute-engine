/**
 * An operator whose answer depends on the order of its source refuses a set.
 *
 * A set has no order. `TakeWhile(Set(3, 1), x > 2)` gave `Set(3)`, and the
 * other iteration order gives the empty set: the answer depended on the
 * order in which the set was stored. The operators below read their source
 * by position or in order, and they now give
 * `Error(incompatible-type, indexed_collection, set<…>)` for a set:
 * - a set written in the call is refused when the call is boxed, with the
 *   error in place of the operand, as for `Sort(Set(3, 1))`;
 * - a set held by a symbol of a wider declared type (`collection<integer>`,
 *   `unknown`) is refused when the call is evaluated, with the frame
 *   `{operator, 1}`.
 * A list, a string and a range still work.
 *
 * The lazy `collection` handlers of an unevaluated call over a held set
 * (`count`, `at`, ...) answer "unknown", and do not read the set in its
 * iteration order. A `PointList` coordinate that is a set or a list of
 * points is an `incompatible-type` error.
 *
 * The code is in `src/compute-engine/library/collections.ts`
 * (`unindexedCollectionOperandError`, `refusingUnindexedSource`,
 * `isRefusedPointListComponentType`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const json = (x: Expression) => JSON.stringify(x.json);

const GREATER_2 = ['Function', ['Greater', 'x', 2], 'x'];
const PARITY = ['Function', ['Mod', 'x', 2], 'x'];
const ADD = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

/** The calls over a source `xs`, with the operands that follow it. */
const CALLS: [string, unknown[]][] = [
  ['TakeWhile', [GREATER_2]],
  ['DropWhile', [GREATER_2]],
  ['Find', [GREATER_2]],
  ['Position', [GREATER_2]],
  ['Partition', [2]],
  ['Partition', [GREATER_2]],
  ['Chunk', [2]],
  ['ChunkBy', [PARITY]],
  ['Scan', [ADD]],
];

function heldSetEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('c', 'collection<integer>');
  ce.assign('c', ce.box(['Set', 3, 1, 5]));
  ce.declare('u', 'unknown');
  ce.assign('u', ce.box(['Set', 3, 1, 5]));
  return ce;
}

function heldSetError(operator: string): string {
  return JSON.stringify([
    'Error',
    [
      'ErrorCode',
      "'incompatible-type'",
      "'indexed_collection'",
      "'set<integer>'",
    ],
    ['Set', 3, 1, 5],
    ['ErrorTrace', ['ErrorFrame', `'${operator}'`, 1]],
  ]);
}

describe('a set written in the call is refused when the call is boxed', () => {
  const ce = new ComputeEngine();
  test.each(CALLS)('%s', (operator, rest) => {
    const expr = ce.box([operator, ['Set', 3, 1, 5], ...rest] as never);
    expect(expr.isValid).toBe(false);
    expect(json(expr.ops![0])).toBe(
      JSON.stringify([
        'Error',
        [
          'ErrorCode',
          "'incompatible-type'",
          "'indexed_collection'",
          "'set<integer>'",
        ],
        ['Set', 3, 1, 5],
      ])
    );
    expect(expr.evaluate().isValid).toBe(false);
  });

  test('the parse route gives the same expression', () => {
    for (const [operator, latex] of [
      ['TakeWhile', '\\operatorname{TakeWhile}(\\{3,1\\}, x \\mapsto x>2)'],
      ['DropWhile', '\\operatorname{DropWhile}(\\{3,1\\}, x \\mapsto x>2)'],
      ['Find', '\\operatorname{Find}(\\{3,1\\}, x \\mapsto x>2)'],
      ['Partition', '\\operatorname{Partition}(\\{3,1,5\\}, 2)'],
      ['Chunk', '\\operatorname{Chunk}(\\{3,1,5\\}, 2)'],
    ]) {
      const expr = ce.parse(latex);
      expect(expr.operator).toBe(operator);
      expect(expr.isValid).toBe(false);
      expect(json(expr.ops![0])).toContain("'indexed_collection'");
      expect(expr.evaluate().isValid).toBe(false);
    }
  });
});

describe('a set held by a symbol is refused when the call is evaluated', () => {
  const ce = heldSetEngine();
  test.each(CALLS)('%s', (operator, rest) => {
    for (const symbol of ['c', 'u']) {
      const expr = ce.box([operator, symbol, ...rest] as never);
      // The canonical form does not read the value of the symbol.
      expect(expr.isValid).toBe(true);
      expect(json(expr.evaluate())).toBe(heldSetError(operator));
    }
  });

  test('the same calls over a list are evaluated once the symbol holds one', () => {
    const ce = heldSetEngine();
    ce.assign('c', ce.box(['List', 3, 1, 5]));
    const value = (x: unknown) =>
      ce
        .box(x as never)
        .evaluate()
        .toString();
    expect(value(['TakeWhile', 'c', GREATER_2])).toBe('[3]');
    expect(value(['DropWhile', 'c', GREATER_2])).toBe('[1,5]');
    expect(value(['Find', 'c', GREATER_2])).toBe('3');
    expect(value(['Position', 'c', GREATER_2])).toBe('[1,3]');
    expect(value(['Partition', 'c', 2])).toBe('[[3,1],[5]]');
    expect(value(['Chunk', 'c', 2])).toBe('[[3,1],[5]]');
    expect(value(['ChunkBy', 'c', PARITY])).toBe('[[3,1,5]]');
    expect(value(['Scan', 'c', ADD])).toBe('[3,4,9]');
  });
});

describe('a list, a string and a range still work', () => {
  const ce = new ComputeEngine();
  const value = (x: unknown) =>
    ce
      .box(x as never)
      .evaluate({ materialization: true })
      .toString();
  test.each([
    [['TakeWhile', ['List', 3, 1], GREATER_2], '[3]'],
    [['TakeWhile', ['Range', 4, 1, -1], GREATER_2], '[4,3]'],
    [['TakeWhile', "'aab'", ['Function', ['Equal', 'x', "'a'"], 'x']], '"aa"'],
    [['DropWhile', ['List', 3, 1], GREATER_2], '[1]'],
    [['DropWhile', ['Range', 4, 1, -1], GREATER_2], '[2,1]'],
    [['Find', ['Range', 1, 5], GREATER_2], '3'],
    [['Position', ['List', 1, 3, 4], GREATER_2], '[2,3]'],
    [['Partition', ['Range', 1, 5], 2], '[[1,2],[3,4],[5]]'],
    [['Partition', "'abc'", 2], '["ab","c"]'],
    [['Chunk', ['Range', 1, 5], 2], '[[1,2,3],[4,5]]'],
    [['ChunkBy', ['List', 1, 3, 2], PARITY], '[[1,3],[2]]'],
    [['Scan', ['Range', 1, 3], ADD], '[1,3,6]'],
  ])('%j', (input, expected) => expect(value(input)).toBe(expected));
});

describe('the result type of TakeWhile and DropWhile is never a set', () => {
  const ce = heldSetEngine();
  test.each([
    // The run can be shorter than the source: the list has no length.
    [['TakeWhile', ['List', 3, 1], GREATER_2], 'list<integer>'],
    [['DropWhile', ['List', 3, 1], GREATER_2], 'list<integer>'],
    [['TakeWhile', 'c', GREATER_2], 'list<integer>'],
    [['TakeWhile', ['Range', 1, 5], GREATER_2], 'list<integer>'],
    [['TakeWhile', "'ab'", ['Function', ['Equal', 'x', "'a'"], 'x']], 'string'],
  ])('%j', (input, expected) =>
    expect(ce.box(input as never).type.toString()).toBe(expected)
  );
});

describe('a restricted list is threaded by Position and ChunkBy', () => {
  // Before, the predicate of `Position` received the restricted cells and the
  // evaluation threw, and the runs of `ChunkBy` held the restricted cells.
  const W = ['When', ['List', 1, 3, 5], ['Less', 0, 't']];
  test.each([
    [['Position', W, GREATER_2], '[2,3] {0 < t}', '[2,3]'],
    [['ChunkBy', W, PARITY], '[[1,3,5]] {0 < t}', '[[1,3,5]]'],
  ])('%j', (input, free, present) => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(input as never)
        .evaluate()
        .toString()
    ).toBe(free);
    ce.assign('t', 2);
    expect(
      ce
        .box(input as never)
        .evaluate()
        .toString()
    ).toBe(present);
  });
});

describe('the lazy handlers of an unevaluated call over a held set answer "unknown"', () => {
  const ce = heldSetEngine();
  test.each([
    ['DeleteAt', ['DeleteAt', 'c', 1]],
    ['ReplaceAt', ['ReplaceAt', 'c', 1, 7]],
    ['Insert', ['Insert', 'c', 1, 7]],
    ['TakeWhile', ['TakeWhile', 'c', GREATER_2]],
    ['DropWhile', ['DropWhile', 'c', GREATER_2]],
    ['Partition', ['Partition', 'c', 1]],
    ['Chunk', ['Chunk', 'c', 1]],
    ['ChunkBy', ['ChunkBy', 'c', PARITY]],
    ['Scan', ['Scan', 'c', ADD]],
    ['Reverse', ['Reverse', 'c']],
    ['Take', ['Take', 'c', 2]],
    ['Drop', ['Drop', 'c', 1]],
    ['Rest', ['Rest', 'c']],
    ['Most', ['Most', 'c']],
    ['Slice', ['Slice', 'c', 1, 2]],
    ['RotateLeft', ['RotateLeft', 'c']],
    ['RotateRight', ['RotateRight', 'c']],
    ['Differences', ['Differences', 'c']],
    ['Zip', ['Zip', ['List', 1, 2, 3], 'c']],
    ['Sort', ['Sort', 'c']],
    ['Ordering', ['Ordering', 'c']],
    ['RandomShuffle', ['RandomShuffle', 'c']],
  ])('%s', (_operator, input) => {
    const expr = ce.box(input as never);
    expect(expr.count).toBeUndefined();
    expect(expr.at(1)).toBeUndefined();
    expect(expr.isEnumerableCollection).not.toBe(true);
    expect(expr.isFiniteCollection).not.toBe(true);
    expect(expr.isEmptyCollection).toBeUndefined();
    expect(expr.evaluate().isValid).toBe(false);
  });

  test('a broadcast over the unevaluated call is an error, not a list', () => {
    // Before, `1 + Reverse(c)` was `[]` and `1 + Differences(c)` was
    // `[-1, 5]`, the differences of the set in its iteration order.
    for (const inner of [
      ['Reverse', 'c'],
      ['Take', 'c', 2],
      ['Rest', 'c'],
      ['Differences', 'c'],
      ['DeleteAt', 'c', 1],
    ]) {
      const result = ce.box(['Add', 1, inner] as never).evaluate();
      expect(result.isValid).toBe(false);
      expect(json(result)).toContain("'indexed_collection'");
    }
  });

  test('the same calls over a held list are read as before', () => {
    const ce = heldSetEngine();
    ce.assign('c', ce.box(['List', 3, 1, 5]));
    const expr = ce.box(['DeleteAt', 'c', 1]);
    expect(expr.count).toBe(2);
    expect(expr.at(1)?.toString()).toBe('1');
    expect(ce.box(['Reverse', 'c']).count).toBe(3);
    expect(ce.box(['Insert', 'c', 1, 7]).at(1)?.toString()).toBe('7');
  });
});

describe('a PointList coordinate is a number or a list of numbers', () => {
  const EXPECTED = "'list<number> | number'";

  test.each([
    [['PointList', ['List', 1, 2], ['Set', 3, 4]], 1, "'set<integer>'"],
    [
      ['PointList', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], ['List', 5, 6]],
      0,
      "'list<tuple<integer, integer>^2>'",
    ],
    [
      ['PointList', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
      0,
      "'list<tuple<integer, integer>^2>'",
    ],
    [['PointList', ['List', 1, 2], 'Integers'], 1, "'set<integer>'"],
  ])('%j is refused when it is boxed', (input, index, actual) => {
    const ce = new ComputeEngine();
    const expr = ce.box(input as never);
    expect(expr.isValid).toBe(false);
    expect(expr.type.toString()).toBe('error');
    const refused = json(expr.ops![index]);
    expect(refused).toContain("'incompatible-type'");
    expect(refused).toContain(EXPECTED);
    expect(refused).toContain(actual);
  });

  test('the parse route gives the same expression', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{PointList}([1,2], \\{3,4\\})');
    expect(expr.isValid).toBe(false);
    expect(json(expr.ops![1])).toContain(EXPECTED);
  });

  test('a held set or list of points is refused when it is evaluated', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'unknown');
    ce.assign('s', ce.box(['Set', 3, 4]));
    ce.declare('q', 'unknown');
    ce.assign('q', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const held = ce.box(['PointList', ['List', 1, 2], 's']);
    expect(held.isValid).toBe(true);
    expect(json(held.evaluate())).toBe(
      JSON.stringify([
        'Error',
        ['ErrorCode', "'incompatible-type'", EXPECTED, "'set<integer>'"],
        ['Set', 3, 4],
        ['ErrorTrace', ['ErrorFrame', "'PointList'", 2]],
      ])
    );
    const points = ce.box(['PointList', 'q', ['List', 1, 2]]);
    expect(points.isValid).toBe(true);
    const result = points.evaluate();
    expect(result.isValid).toBe(false);
    expect(json(result)).toContain(EXPECTED);
    expect(json(result)).toContain(`["ErrorFrame","'PointList'",1]`);
  });

  test.each([
    [['PointList', ['List', 1, 2], ['List', 3, 4]], '[(1, 3),(2, 4)]'],
    [['PointList', ['List', 1, 2], 5], '[(1, 5),(2, 5)]'],
    [
      ['PointList', ['List', 1, 2], ['List', ['List', 1, 2], ['List', 3, 4]]],
      '[(1, [1,2]),(2, [3,4])]',
    ],
    [['PointList', ['List', 1, 2], "'ab'"], '[(1, "ab"),(2, "ab")]'],
    [['PointList', ['List'], ['List', 1]], '[]'],
    [['PointList', 1, 2], '(1, 2)'],
  ])('%j is admitted as before', (input, expected) => {
    const ce = new ComputeEngine();
    const expr = ce.box(input as never);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe(expected);
  });
});
