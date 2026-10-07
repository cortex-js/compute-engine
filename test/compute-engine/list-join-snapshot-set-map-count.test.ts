/**
 * The snapshot of a list literal with a spread (`snapshotListJoin`,
 * `src/compute-engine/library/collections.ts`) reads the count of an operand
 * before the walk only when the count is known without a walk
 * (`hasConstantTimeCount`). A set-producing `Map` (a `Map` over a `Set`)
 * counts its DISTINCT results by walking `each()`, which calls the callback
 * on every element, so its count is not read before the walk. What must
 * remain true: the callback runs once per element that the walk reads, also
 * when the snapshot is abandoned at the collection size limit.
 */
import { ComputeEngine } from '../../src/compute-engine';

const TICKED_SET = ['Map', 'Tick', ['Set', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];

/**
 * Evaluates `ListJoin(operand, [0])` with `Tick` counting its calls, where
 * `operand` is built from the set-producing map `Map(Tick, {1, …, 10})`.
 */
function countedSnapshot(
  maxCollectionSize: number,
  operand: any = TICKED_SET
): { calls: number; value: any } {
  const ce = new ComputeEngine();
  ce.maxCollectionSize = maxCollectionSize;
  let calls = 0;
  ce.declare('Tick', {
    signature: '(number) -> number',
    pure: false,
    evaluate: ([x]) => {
      calls += 1;
      return x;
    },
  });
  const value = ce.box(['ListJoin', operand, ['List', 0]]).evaluate();
  return { calls, value };
}

describe('SNAPSHOT OF A SPREAD SET-PRODUCING MAP', () => {
  test('the callback runs once per element', () => {
    const { calls, value } = countedSnapshot(1000);
    expect(value.operator).toBe('List');
    expect(calls).toBe(10);
  });

  test('past the collection size limit, once per walked element', () => {
    const { calls, value } = countedSnapshot(5);
    // The view is kept. The single walk lists five elements, pulls a sixth
    // from the iterator, and stops at the budget: six calls, not twelve.
    expect(value.operator).toBe('ListJoin');
    expect(calls).toBe(6);
  });

  test('a set-producing map that is an ELEMENT of a spread operand', () => {
    // `listedElement` lists a nested lazy element, and reads its count
    // before the walk under the same predicate. A literal list operand is
    // folded at canonicalization, so the nested map is reached through a
    // lazy operand whose one element is the map.
    const { calls, value } = countedSnapshot(1000, [
      'Map',
      ['Function', TICKED_SET, 'u'],
      ['List', 1],
    ]);
    expect(value.json).toEqual([
      'List',
      ['Set', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      0,
    ]);
    expect(calls).toBe(10);
  });
});
