import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  range,
  literalRange,
} from '../../src/compute-engine/library/collections';
import { integerRangeElements } from '../../src/compute-engine/boxed-expression/type-guards';

// `Range(n)` is `Range(1, n)`: the one operand is the upper bound and the
// lower bound is 1 (the reference of `Range`). With no step, a range counts
// toward its upper bound in either direction, so `Range(0)` is the
// descending range `[1, 0]` and `Range(-2)` is `[1, 0, -1, -2]`. The
// canonical form `Range(1, 0)` had this meaning, but the readers of a raw
// one-operand `Range` used the step 1, which gave an empty range
// (ROADMAP CE-497).

const ce = new ComputeEngine();

function elementsOf(expr: any): number[] {
  return [...expr.each()].map((x) => x.re);
}

describe('A one-operand Range counts from 1 to its operand', () => {
  test.each([
    [0, [1, 0]],
    [-2, [1, 0, -1, -2]],
    [3, [1, 2, 3]],
  ])('Range(%d)', (n, elements) => {
    // Box route: the canonical form.
    const canonical = ce.box(['Range', n]);
    expect(elementsOf(canonical.evaluate())).toEqual(elements);

    // The raw form, read by the `Range` helpers.
    const raw = ce.box(['Range', n], { form: 'raw' });
    const [lower, upper, step] = range(raw);
    expect([lower, upper]).toEqual([1, n]);
    expect(step).toBe(n >= 1 ? 1 : -1);
    expect(literalRange(raw)).toEqual([lower, upper, step]);
    expect(elementsOf(raw)).toEqual(elements);
    expect(elementsOf(raw.evaluate())).toEqual(elements);

    // A raw `Range(n)` is the same element as the list of its integers.
    expect(integerRangeElements(raw)).toEqual({
      start: 1,
      step: n >= 1 ? 1 : -1,
      count: elements.length,
    });
  });

  test('parse route', () => {
    expect(elementsOf(ce.parse('\\operatorname{Range}(0)').evaluate())).toEqual(
      [1, 0]
    );
  });

  test('compiled to JavaScript', () => {
    for (const n of [0, -2, 3]) {
      const expected = elementsOf(ce.box(['Range', n]).evaluate());
      for (const form of ['raw', 'canonical'] as const) {
        const fn = compile(ce.box(['Range', 'n'], { form }));
        expect(fn.success).toBe(true);
        expect(fn.run!({ n })).toEqual(expected);
      }
    }
  });
});
