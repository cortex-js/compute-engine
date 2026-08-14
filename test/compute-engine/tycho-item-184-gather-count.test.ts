/**
 * Tycho item 184 — a gather member defeated the count and emptiness facets of
 * the collection that carried it.
 *
 * `At(xs, I)` with an integer-collection index is a GATHER: it is typed
 * `list<T>` and iterates fine, but it produces its elements eagerly and
 * carries no `collection` handlers, so it is not itself `isCollection` until
 * evaluated. Two facets fell through that gap:
 *
 *  - `count` had no `elementCount` tier on `At`, so a raw gather answered
 *    `undefined`. `Zip` takes the MINIMUM over its members' counts, so one
 *    gather member erased the count of the whole `Zip` — and a `Map` over
 *    that `Zip` delegates its count to its source, so the count was gone
 *    there too, even though the gather and the `Zip` both count fine once
 *    evaluated.
 *
 *  - `isEmptyCollection` short-circuits to `undefined` whenever
 *    `isCollection` is false, so a gather member also left the `Zip`'s
 *    emptiness UNKNOWN. `materialize()` returns the lazy form unchanged when
 *    emptiness is indeterminate, so `Map(f, Zip(At(xs, I), ys))` stayed
 *    symbolic instead of producing its elements.
 *
 * The gather's length is decidable from the operands alone — it is
 * POSITION-PRESERVING (an out-of-range index contributes the absence marker
 * rather than being dropped), so the result has exactly as many elements as
 * the index. A boolean MASK is deliberately excluded: it filters, so its
 * length is the number of `True` entries, which cannot be known without
 * walking it.
 *
 * Filed by Tycho against 0.107.0, found by their elementwise min/max
 * lowering, whose emitted shape is exactly `Map(f, Zip(…))`.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('Tycho item 184 — gather count and emptiness', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  const L3 = ['List', 5, 6, 7] as any;
  const I = ['List', 2, 1, 3] as any;
  /** Elementwise `max` over a zipped pair — Tycho's min/max lowering shape. */
  const maxOfPair = [
    'Function',
    ['Max', ['At', 'Z', 1], ['At', 'Z', 2]],
    'Z',
  ] as any;

  describe('the gather itself', () => {
    test('counts WITHOUT being evaluated', () => {
      expect(ce.box(['At', L3, I]).count).toBe(3);
    });

    test('still counts after evaluating, and gathers by position', () => {
      const v = ce.box(['At', L3, I]).evaluate();
      expect(v.count).toBe(3);
      expect(v.toString()).toBe('[6,5,7]');
    });

    test('an out-of-range index keeps its position, so the count holds', () => {
      const gather = ce.box(['At', L3, ['List', 2, 99] as any]);
      expect(gather.count).toBe(2);
      expect(gather.evaluate().toString()).toBe('[6,NaN]');
    });

    test('an empty gather counts zero', () => {
      expect(ce.box(['At', L3, ['List'] as any]).count).toBe(0);
    });
  });

  describe('shapes that must NOT claim a count', () => {
    test('a boolean MASK filters, so its length is not statically known', () => {
      const mask = ['List', 'True', 'False', 'True'] as any;
      expect(ce.box(['At', L3, mask]).count).toBeUndefined();
      // ...and the true length differs from the index length, which is
      // exactly why claiming the index count there would be wrong.
      expect(ce.box(['At', L3, mask]).evaluate().count).toBe(2);
    });

    test('a scalar index selects one element, not a collection', () => {
      expect(ce.box(['At', L3, 2]).count).toBeUndefined();
    });

    test('a chained access peels one level at a time', () => {
      const m = ['List', ['List', 1, 2], ['List', 3, 4]] as any;
      expect(ce.box(['At', m, 1, 2]).count).toBeUndefined();
    });
  });

  describe('the carrier collections', () => {
    test('Zip over a gather member counts', () => {
      const zip = ce.box(['Zip', ['At', L3, I], L3]);
      expect(zip.count).toBe(3);
      expect(zip.isEmptyCollection).toBe(false);
    });

    test('Map over a Zip carrying a gather counts AND materializes', () => {
      const v = ce.box(['Map', maxOfPair, ['Zip', ['At', L3, I], L3]]).evaluate();
      expect(v.count).toBe(3);
      // Elementwise max of the gather [6,5,7] against [5,6,7].
      expect(v.toString()).toBe('[6,6,7]');
    });

    test('parity: the same Map over plain lists is unchanged', () => {
      const v = ce.box(['Map', maxOfPair, ['Zip', I, L3]]).evaluate();
      expect(v.count).toBe(3);
      expect(v.toString()).toBe('[5,6,7]');
    });

    test('Map directly over a gather materializes', () => {
      const double = ['Function', ['Multiply', 'Z', 2], 'Z'] as any;
      const v = ce.box(['Map', double, ['At', L3, I]]).evaluate();
      expect(v.count).toBe(3);
      expect(v.toString()).toBe('[12,10,14]');
    });
  });

  describe('emptiness fallback stays honest', () => {
    test('an empty gather makes the Zip empty', () => {
      const zip = ce.box(['Zip', ['At', L3, ['List'] as any], L3]);
      expect(zip.isEmptyCollection).toBe(true);
      expect(zip.evaluate().toString()).toBe('[]');
    });

    test('an infinite member is not empty, and the finite member bounds it', () => {
      const zip = ce.box([
        'Zip',
        ['Range', 1, 'PositiveInfinity'] as any,
        L3,
      ]);
      expect(zip.isEmptyCollection).toBe(false);
      expect(zip.count).toBe(3);
    });

    test('a mask member leaves the Zip count unknown but still evaluates', () => {
      const mask = ['List', 'True', 'False', 'True'] as any;
      const zip = ce.box(['Zip', ['At', L3, mask], L3]);
      expect(zip.count).toBeUndefined();
      expect(zip.evaluate().count).toBe(2);
    });
  });
});
