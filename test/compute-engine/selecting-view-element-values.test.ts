/**
 * A selecting view (`Filter`, `TakeWhile`, `DropWhile`, `Dedup`) emits the
 * VALUE of each source element, the value its predicate judged.
 *
 * A pure list literal is walked by its operands as written, so with
 * `x := 5` the walk of `[x]` gives the symbol `x`. The predicate evaluates
 * its argument and judges `5`, but the view emitted `x`:
 * `First(Filter([x], y ↦ y > 0))` was `x` and
 * `Element(5, Filter([x], y ↦ y > 0))` was `False`, while the materialized
 * result is `[5]`. `Dedup([x, 5])` compared `x` with `5` as written and
 * materialized as `[5, 5]`.
 *
 * The code is in `src/compute-engine/library/collections.ts`
 * (`selectedElementValue`, `selectedSourceContains`).
 */

import { ComputeEngine } from '../../src/compute-engine';

const positive = ['Function', ['Greater', 'y', 0], 'y'];
const large = ['Function', ['Greater', 'y', 10], 'y'];

describe('a lazy Filter emits the values of its source elements', () => {
  const ce = new ComputeEngine();
  ce.assign('x', 5);

  test('box route', () => {
    const filtered = ['Filter', ['List', 'x'], positive];
    expect(ce.box(['First', filtered]).evaluate().json).toBe(5);
    expect(ce.box(['Element', 5, filtered]).evaluate().json).toBe('True');
    expect(ce.box(['Element', 7, filtered]).evaluate().json).toBe('False');
    expect(ce.box(filtered).evaluate({ materialization: true }).json).toEqual([
      'List',
      5,
    ]);
    const items = [...ce.box(filtered).evaluate().each()].map((e) => e.json);
    expect(items).toEqual([5]);
  });

  test('an element that may erase does not change the answer', () => {
    const filtered = [
      'Filter',
      ['List', 'x', ['If', ['Greater', 'z', 0], 1, 'Nothing']],
      positive,
    ];
    expect(ce.box(['Element', 5, filtered]).evaluate().json).toBe('True');
  });

  test('a view over a literal, a set and a tuple', () => {
    for (const source of [
      ['Reverse', ['List', 'x']],
      ['Take', ['List', 'x', 'x'], 1],
      ['Set', 'x'],
      ['Tuple', 'x', 1],
    ]) {
      const filtered = ['Filter', source, positive];
      expect(ce.box(['Element', 5, filtered]).evaluate().json).toBe('True');
    }
  });

  test('parse route', () => {
    expect(
      ce
        .parse(
          '\\operatorname{First}(\\operatorname{Filter}([x], y \\mapsto y > 0))'
        )
        .evaluate().json
    ).toBe(5);
    expect(
      ce
        .parse('5 \\in \\operatorname{Filter}([x], y \\mapsto y > 0)')
        .evaluate().json
    ).toBe('True');
  });
});

describe('TakeWhile and DropWhile emit the values of their source elements', () => {
  const ce = new ComputeEngine();
  ce.assign('x', 5);

  test('TakeWhile', () => {
    const taken = ['TakeWhile', ['List', 'x', 'x'], positive];
    expect(ce.box(['First', taken]).evaluate().json).toBe(5);
    expect(ce.box(['Element', 5, taken]).evaluate().json).toBe('True');
  });

  test('DropWhile', () => {
    const rest = ['DropWhile', ['List', 'x', 'x'], large];
    expect(ce.box(['First', rest]).evaluate().json).toBe(5);
    expect(ce.box(['Element', 5, rest]).evaluate().json).toBe('True');
  });

  test('an impure element is judged and emitted as one draw', () => {
    const taken = [
      'TakeWhile',
      ['List', ['Random'], 2],
      ['Function', ['Less', 'y', 1], 'y'],
    ];
    const first = ce.box(['First', taken]).evaluate();
    expect(first.re).toBeGreaterThanOrEqual(0);
    expect(first.re).toBeLessThan(1);
  });

  test('parse route', () => {
    expect(
      ce
        .parse(
          '\\operatorname{First}(\\operatorname{TakeWhile}([x, x], y \\mapsto y > 0))'
        )
        .evaluate().json
    ).toBe(5);
    expect(
      ce
        .parse(
          '\\operatorname{First}(\\operatorname{DropWhile}([x, x], y \\mapsto y > 10))'
        )
        .evaluate().json
    ).toBe(5);
  });
});

describe('Dedup compares the values of its source elements', () => {
  const ce = new ComputeEngine();
  ce.assign('x', 5);

  test('box route', () => {
    const deduped = ['Dedup', ['List', 'x', 5]];
    expect(ce.box(deduped).evaluate({ materialization: true }).json).toEqual([
      'List',
      5,
    ]);
    expect(ce.box(['Count', deduped]).evaluate().json).toBe(1);
    expect(ce.box(['First', deduped]).evaluate().json).toBe(5);
  });

  test('parse route', () => {
    expect(
      ce
        .parse('\\operatorname{Dedup}([x, 5])')
        .evaluate({ materialization: true }).json
    ).toEqual(['List', 5]);
  });
});
