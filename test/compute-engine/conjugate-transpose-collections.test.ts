import { ComputeEngine } from '../../src/compute-engine';
import { MAX_SIZE_EAGER_COLLECTION } from '../../src/compute-engine/collection-utils';

/**
 * `ConjugateTranspose` over a vector that arrives as a LAZY collection.
 *
 * A broadcast over more than `MAX_SIZE_EAGER_COLLECTION` elements produces a
 * lazy `Map`, not a `List` literal. The handler packed its operand as a
 * tensor, which refuses a lazy collection, so `z^\star` over such a vector
 * stayed symbolic while `Conjugate` over the same vector evaluated (Tycho
 * ask 300: the witness of ask 296 evaluated with `Conjugate` and stayed a
 * symbolic `Which` of 8 MB with `ConjugateTranspose`).
 */

function pointList(ce: ComputeEngine, n: number) {
  const pts: unknown[] = [];
  for (let k = 0; k < n; k++)
    pts.push(['Tuple', Math.cos(k), Math.sin(k), k / n]);
  ce.declare('C', 'unknown');
  ce.assign('C', ce.box(['List', ...pts] as never));
}

const Z_OVER_XY = [
  'Divide',
  ['PointZ', 'C'],
  ['Add', ['PointX', 'C'], ['Multiply', ['PointY', 'C'], 'ImaginaryUnit']],
];

describe('CONJUGATE TRANSPOSE OF A VECTOR', () => {
  test('a lazy vector is conjugated element-wise, like an eager one', () => {
    for (const n of [3, MAX_SIZE_EAGER_COLLECTION + 100]) {
      const ce = new ComputeEngine();
      pointList(ce, n);
      const transposed = ce.box(['ConjugateTranspose', Z_OVER_XY]).evaluate();
      const conjugated = ce.box(['Conjugate', Z_OVER_XY]).evaluate();
      // Past the eager size the value is a lazy `Map`, so the check is on
      // the collection, not on the operator.
      expect([n, transposed.isIndexedCollection]).toEqual([n, true]);
      expect([...transposed.each()]).toHaveLength(n);
      expect(transposed.isSame(conjugated)).toBe(true);
    }
  });

  test('a selection over such a vector selects per element', () => {
    const ce = new ComputeEngine();
    pointList(ce, MAX_SIZE_EAGER_COLLECTION + 100);
    const v = ce
      .box([
        'Which',
        ['Greater', ['Abs', ['ConjugateTranspose', Z_OVER_XY]], 0.5],
        1,
        'True',
        0,
      ])
      .evaluate();
    expect(v.operator).toBe('List');
    expect(v.nops).toBe(MAX_SIZE_EAGER_COLLECTION + 100);
  });

  test('an integer range is a vector too', () => {
    // `Range(1, 200)` types `range`, `Range(0, 200)` types
    // `indexed_collection<integer>`: both are vectors of numbers.
    const ce = new ComputeEngine();
    for (const range of [
      ['Range', 1, 200],
      ['Range', 0, 200],
      ['Range', 1, 10, 2],
    ]) {
      const v = ce.box(['ConjugateTranspose', range] as never).evaluate();
      const expected = ce.box(range as never).evaluate();
      expect([range, v.isIndexedCollection]).toEqual([range, true]);
      expect([...v.each()].map((x) => x.re)).toEqual(
        [...expected.each()].map((x) => x.re)
      );
    }
  });

  test('a matrix is still transposed and a scalar still conjugated', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'ConjugateTranspose',
          ['List', ['List', ['Complex', 1, 1], 2], ['List', 3, 4]],
        ])
        .evaluate().json
    ).toEqual(['List', ['List', ['Complex', 1, -1], 3], ['List', 2, 4]]);
    expect(
      ce.box(['ConjugateTranspose', ['Complex', 1, 1]]).evaluate().json
    ).toEqual(['Complex', 1, -1]);
  });
});
