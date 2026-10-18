/**
 * `Count`, `Length`, `IsEmpty` and `Contains` look through `Sort`,
 * `Reverse` and `RandomShuffle` when the call is boxed, to read the
 * collection inside without sorting it. These three wrappers accept only an
 * indexed collection: with `c := Set(3, 1, 5)`, `Sort(c)` is an
 * `incompatible-type` error, because a set has no order. The look-through
 * made `Count(Sort(c))` answer `3`.
 *
 * User decision 2026-10-18: look through these wrappers only when the type
 * of the source is known to be an indexed collection, so that
 * `Count(Sort(c))` is the same error as `Sort(c)`.
 *
 * The code is in `src/compute-engine/library/collections.ts`
 * (`peekWrappers`).
 */

import { ComputeEngine } from '../../src/compute-engine';

describe('a size or membership query of an order wrapper over a set', () => {
  const ce = new ComputeEngine();
  ce.assign('c', ce.box(['Set', 3, 1, 5]));
  ce.assign('l', ce.box(['List', 3, 1, 5]));

  // The error of `Sort(c)` without its trace: a query of it adds the frame
  // of the query operator to the trace.
  const withoutTrace = (json: any) =>
    Array.isArray(json) ? json.slice(0, 3) : json;
  const sortError = withoutTrace(ce.box(['Sort', 'c']).evaluate().json);

  test('the error of the wrapper', () => {
    expect(JSON.stringify(sortError)).toMatch(/incompatible-type/);
    for (const wrapper of ['Sort', 'Reverse', 'RandomShuffle']) {
      for (const query of [
        ['Count', [wrapper, 'c']],
        ['Length', [wrapper, 'c']],
        ['IsEmpty', [wrapper, 'c']],
        ['Contains', [wrapper, 'c'], 3],
      ]) {
        const result = ce.box(query).evaluate();
        expect(result.operator).toBe('Error');
        expect(withoutTrace(result.json)).toEqual(sortError);
      }
    }
  });

  test('an indexed source is still read without the wrapper', () => {
    for (const wrapper of ['Sort', 'Reverse', 'RandomShuffle']) {
      const count = ce.box(['Count', [wrapper, 'l']]);
      expect(count.json).toEqual(['Count', 'l']);
      expect(count.evaluate().json).toBe(3);
    }
  });

  test('Unique keeps the look-through for membership', () => {
    expect(ce.box(['Count', ['Unique', 'c']]).evaluate().json).toBe(3);
    expect(ce.box(['Contains', ['Unique', 'c'], 3]).json).toEqual([
      'Contains',
      'c',
      3,
    ]);
  });

  test('parse route', () => {
    expect(
      withoutTrace(
        ce.parse('\\operatorname{Count}(\\operatorname{Sort}(c))').evaluate()
          .json
      )
    ).toEqual(sortError);
    expect(
      ce.parse('\\operatorname{Count}(\\operatorname{Sort}(l))').evaluate().json
    ).toBe(3);
  });
});
