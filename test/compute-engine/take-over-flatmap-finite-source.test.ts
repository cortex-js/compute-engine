/**
 * `Take` over a `FlatMap` with a finite source.
 *
 * The emptiness of `FlatMap([1, 2, 3], x ↦ [x, x])` depends on the results
 * of its callback, and a facet does not apply a callback, so the `isEmpty`
 * facet gives no answer. The emptiness of a `Take` of it is not known either,
 * and the materialization kept the lazy form: `Take(FlatMap([1, 2, 3],
 * x ↦ [x, x]), 3)` stayed unevaluated. The materialization now pulls the
 * first element of a finite, enumerable collection whose emptiness is not
 * known (`walkDecidesEmptiness`, `boxed-expression/boxed-function.ts`).
 *
 * The same `FlatMap` has no count. Three views read their source by a
 * position computed from the count (`Reverse`, `Most`, `RotateLeft`), and a
 * negative index needs the count too. Their walks gave nothing, and the
 * consumers read that as an empty collection: `Sum(Reverse(FlatMap(…)))`
 * was `0`, `Last(FlatMap(…))` was `NaN`. These now stay unevaluated
 * (`enumerableFromSmallSource`, `isProvablyOutOfRange`,
 * `library/collections.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';

const doubled = [
  'FlatMap',
  ['List', 1, 2, 3],
  ['Function', ['List', 'x', 'x'], 'x'],
];

describe('Take over a FlatMap with a finite source', () => {
  const ce = new ComputeEngine();

  test('box route', () => {
    expect(
      ce.box(['Take', doubled, 3]).evaluate({ materialization: true }).json
    ).toEqual(['List', 1, 1, 2]);
    expect(
      ce.box(['Take', doubled, 10]).evaluate({ materialization: true }).json
    ).toEqual(['List', 1, 1, 2, 2, 3, 3]);
    expect(
      ce.box(['Drop', doubled, 4]).evaluate({ materialization: true }).json
    ).toEqual(['List', 3, 3]);
    expect(ce.box(['Sum', ['Take', doubled, 3]]).evaluate().json).toBe(4);
  });

  test('parse route', () => {
    expect(
      ce
        .parse(
          '\\operatorname{Take}(\\operatorname{FlatMap}([1, 2, 3], x \\mapsto [x, x]), 3)'
        )
        .evaluate({ materialization: true }).json
    ).toEqual(['List', 1, 1, 2]);
  });

  test('a Filter whose emptiness the walk cannot decide stays lazy', () => {
    const filtered = ce
      .box(['Filter', ['Range', 1, 5000], ['Function', ['Less', 'x', 0], 'x']])
      .evaluate();
    expect(filtered.operator).toBe('Filter');
  });
});

describe('a view that needs the count of a FlatMap', () => {
  const ce = new ComputeEngine();

  test('is not read as an empty collection', () => {
    for (const view of [
      ['Reverse', doubled],
      ['Most', doubled],
      ['RotateLeft', doubled, 1],
    ]) {
      const sum = ce.box(['Sum', view]).evaluate();
      expect(sum.json).not.toBe(0);
      expect(ce.box(view).evaluate().json).not.toEqual(['List']);
    }
  });

  test('a negative index is not out of range', () => {
    expect(ce.box(['Last', doubled]).evaluate().isNaN).not.toBe(true);
    expect(ce.box(['At', doubled, -1]).evaluate().isNaN).not.toBe(true);
  });
});

describe('the callback of the FlatMap is applied once for each element', () => {
  // The walk that decides the emptiness pulls the first element, and the
  // materialization continues that walk. Before, the materialization walked
  // the collection again from the start: a callback that is not pure ran
  // twice for the first element, and the first result was lost.
  function counting(): { ce: ComputeEngine; calls: () => number } {
    const ce = new ComputeEngine();
    let n = 0;
    ce.declare('Tick', {
      signature: '() -> number',
      pure: false,
      evaluate: () => ce.number(++n),
    });
    return { ce, calls: () => n };
  }

  function take(ce: ComputeEngine) {
    return ce.box([
      'Take',
      ['FlatMap', ['List', 1, 2], ['Function', ['List', ['Tick']], 'x']],
      1,
    ]);
  }

  test('Take of a FlatMap', () => {
    // A full materialization also counts the elements before it evaluates
    // them: the count walk and the walk that evaluates give the same
    // elements, from one walk of the collection.
    const { ce, calls } = counting();
    expect(take(ce).evaluate({ materialization: true }).json).toEqual([
      'List',
      1,
    ]);
    expect(calls()).toBe(1);
  });

  test('the display of a Take of a FlatMap', () => {
    // `evaluate()` keeps the lazy form, and its display materializes the
    // first elements.
    const { ce, calls } = counting();
    expect(take(ce).evaluate().toString()).toBe('[1]');
    expect(calls()).toBe(1);
  });
});
