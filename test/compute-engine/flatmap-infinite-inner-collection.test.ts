import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// `FlatMap` materializes its result when its source is finite. A finite source
// is not enough for a finite result: the callback can return an INFINITE
// collection, and splicing it never ended — `FlatMap([1, 2], n ↦ Range(1, ∞))`
// under `evaluate({ materialization: true })`, and also its `toString()` and
// `latex`, which materialize a display preview, ran until a time limit.
//
// The evaluate handler now checks each inner result before it walks it:
// - a provably infinite inner result stops a full materialization with the
//   `out-of-range` error "a finite collection" (the error `RandomShuffle`
//   gives for an infinite collection), and leaves the view lazy for a bounded
//   materialization (the display preview), so the expression prints as
//   written;
// - an inner result whose finiteness is not known is walked, but the result
//   is bounded by `maxCollectionSize`: past it, the view stays lazy.
// A read of a prefix of the lazy view (`At`, `First`) is still answered.
//
// Every expectation runs inside a time limit, so a regression fails with a
// `Timeout exceeded` error instead of hanging the suite.

const ce = new ComputeEngine();

const LIMIT = { ms: 3000, label: 'test:flatmap-infinite-inner' };

function limited<T>(fn: () => T): T {
  return ce.withTimeLimit(
    LIMIT,
    fn as () => T extends Promise<unknown> ? never : T
  );
}

const RANGE_INF = ['Range', 1, 'PositiveInfinity'];
const INF_CALLBACK = ['Function', RANGE_INF, 'n'];

/** The error code and the frames of an `Error` value, as plain strings. */
function errorShape(x: Expression): string {
  return JSON.stringify(x.json);
}

describe('FlatMap with a callback that returns an infinite collection', () => {
  test('box route: full materialization is an out-of-range error', () => {
    const r = limited(() =>
      ce
        .box(['FlatMap', ['List', 1, 2], INF_CALLBACK])
        .evaluate({ materialization: true })
    );
    expect(r.operator).toBe('Error');
    expect(errorShape(r)).toBe(
      `["Error",["ErrorCode","'out-of-range'","'a finite collection'","'[1,2,3,4,5,...]'"],["ErrorTrace",["ErrorFrame","'FlatMap'",2]]]`
    );
  });

  test('parse route: full materialization is an out-of-range error', () => {
    const expr = ce.parse(
      '\\operatorname{FlatMap}([1, 2], n \\mapsto \\operatorname{Range}(1, \\infty))'
    );
    expect(expr.operator).toBe('FlatMap');
    const r = limited(() => expr.evaluate({ materialization: true }));
    expect(r.operator).toBe('Error');
    expect(errorShape(r)).toContain("'out-of-range'");
    expect(errorShape(r)).toContain("'a finite collection'");
  });

  test.each([
    ['Repeat', ['Function', ['Repeat', 'n'], 'n']],
    ['Cycle', ['Function', ['Cycle', ['List', 'n']], 'n']],
    ['Integers', ['Function', 'Integers', 'n']],
  ])('box route: an inner %s is an out-of-range error', (_, fn) => {
    const r = limited(() =>
      ce
        .box(['FlatMap', ['List', 1, 2], fn])
        .evaluate({ materialization: true })
    );
    expect(r.operator).toBe('Error');
    expect(errorShape(r)).toContain("'out-of-range'");
  });

  test('the error comes from the first infinite inner result', () => {
    // The first inner result is finite, the second one is infinite.
    const r = limited(() =>
      ce
        .box([
          'FlatMap',
          ['List', 1, 2],
          [
            'Function',
            ['If', ['Equal', 'n', 1], ['List', 'n', 'n'], RANGE_INF],
            'n',
          ],
        ])
        .evaluate({ materialization: true })
    );
    expect(r.operator).toBe('Error');
    expect(errorShape(r)).toContain("'a finite collection'");
  });

  test('plain evaluate leaves the view lazy', () => {
    const r = limited(() =>
      ce.box(['FlatMap', ['List', 1, 2], INF_CALLBACK]).evaluate()
    );
    expect(r.operator).toBe('FlatMap');
  });

  test('a bounded materialization leaves the view lazy', () => {
    const r = limited(() =>
      ce
        .box(['FlatMap', ['List', 1, 2], INF_CALLBACK])
        .evaluate({ materialization: 5 })
    );
    expect(r.operator).toBe('FlatMap');
  });

  test('box route: toString() and latex print the expression as written', () => {
    const expr = ce.box(['FlatMap', ['List', 1, 2], INF_CALLBACK]);
    expect(limited(() => expr.toString())).toBe(
      'FlatMap([1,2], (n) => Range(1, +oo))'
    );
    expect(limited(() => expr.latex)).toBe(
      '\\mathrm{FlatMap}(\\bigl\\lbrack1, 2\\bigr\\rbrack, n\\mapsto1..\\infty)'
    );
  });

  test('parse route: toString() prints the expression as written', () => {
    const expr = ce.parse(
      '\\operatorname{FlatMap}([1, 2], n \\mapsto \\operatorname{Range}(1, \\infty))'
    );
    expect(limited(() => expr.toString())).toBe(
      'FlatMap([1,2], (n) => Range(1, +oo))'
    );
  });

  test.each([
    [['At', ['FlatMap', ['List', 1, 2], INF_CALLBACK], 3], '3'],
    [['First', ['FlatMap', ['List', 1, 2], INF_CALLBACK]], '1'],
  ])('box route: a prefix read %j is still answered', (json, expected) => {
    for (const materialization of [false, true]) {
      const r = limited(() => ce.box(json).evaluate({ materialization }));
      expect(r.toString()).toBe(expected);
    }
  });

  test('parse route: a prefix read is still answered', () => {
    const expr = ce.parse(
      '\\operatorname{At}(\\operatorname{FlatMap}([1, 2], n \\mapsto \\operatorname{Range}(1, \\infty)), 3)'
    );
    expect(limited(() => expr.evaluate()).toString()).toBe('3');
  });

  test('an inner result of unknown finiteness is bounded by maxCollectionSize', () => {
    // The inner `FlatMap` has a callback with no declared result type, so its
    // finiteness is not known, but it is infinite.
    const r = limited(() =>
      ce
        .box([
          'FlatMap',
          ['List', 1, 2],
          ['Function', ['FlatMap', ['List', 'n'], INF_CALLBACK], 'n'],
        ])
        .evaluate({ materialization: true })
    );
    expect(r.operator).toBe('FlatMap');
  });
});

describe('FlatMap with a callback that returns a finite collection', () => {
  test.each([
    [
      ['FlatMap', ['List', 1, 2], ['Function', ['List', 'x', 'x'], 'x']],
      '[1,1,2,2]',
    ],
    [
      ['FlatMap', ['List', 1, 2], ['Function', ['Range', 1, 3], 'n']],
      '[1,2,3,1,2,3]',
    ],
    [['FlatMap', ['List', 1, 2], ['Function', ['Square', 'x'], 'x']], '[1,4]'],
    [['FlatMap', ['List', 1, 2], ['Function', "'ab'", 'x']], '["ab","ab"]'],
    [
      [
        'FlatMap',
        ['List', 1, 2],
        [
          'Function',
          ['FlatMap', ['List', 'n'], ['Function', ['List', 'm', 'm'], 'm']],
          'n',
        ],
      ],
      '[1,1,2,2]',
    ],
  ])('box route: %j', (json, expected) => {
    const r = limited(() => ce.box(json).evaluate({ materialization: true }));
    expect(r.toString()).toBe(expected);
  });

  test('parse route: the list is materialized', () => {
    const r = limited(() =>
      ce
        .parse('\\operatorname{FlatMap}([1, 2], x \\mapsto [x, x])')
        .evaluate({ materialization: true })
    );
    expect(r.toString()).toBe('[1,1,2,2]');
  });

  test('a result larger than maxCollectionSize stays lazy', () => {
    const big = ce.maxCollectionSize;
    const r = limited(() =>
      ce
        .box(['FlatMap', ['List', 1, 2], ['Function', ['Range', 1, big], 'n']])
        .evaluate({ materialization: true })
    );
    expect(r.operator).toBe('FlatMap');
  });
});
