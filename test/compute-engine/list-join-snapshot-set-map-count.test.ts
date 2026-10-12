/**
 * The snapshot of a list literal with a spread (`snapshotListJoin`,
 * `src/compute-engine/library/collections.ts`) reads the count of an operand
 * before the walk only when the count is known without a walk
 * (`hasConstantTimeCount`). A set-producing `Map` (a `Map` over a `Set`)
 * counts its DISTINCT results by walking `each()`, which calls the callback
 * on every element, so its count is not read before the walk. Its source
 * count supplies a callback-free upper bound instead. A fitting snapshot
 * calls the callback once per source element. An impure snapshot whose
 * upper bound exceeds the collection size limit stays lazy before any
 * callback runs, so a later drain does not repeat discarded effects.
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
  return {
    get calls() {
      return calls;
    },
    value,
  };
}

describe('SNAPSHOT OF A SPREAD SET-PRODUCING MAP', () => {
  test('the callback runs once per element', () => {
    const { calls, value } = countedSnapshot(1000);
    expect(value.operator).toBe('List');
    expect(calls).toBe(10);
  });

  test('past the collection size limit, callbacks wait for the drain', () => {
    const snapshot = countedSnapshot(5);
    const { value } = snapshot;
    // The source count bounds the set map without calling Tick. The view
    // is kept before a partial snapshot can consume and discard effects.
    expect(value.operator).toBe('ListJoin');
    expect(snapshot.calls).toBe(0);
    const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0];
    expect([...value.each()].map((x) => x.re)).toEqual(expected);
    expect(snapshot.calls).toBe(10);
    expect([...value.each()].map((x) => x.re)).toEqual(expected);
    expect(snapshot.calls).toBe(10);
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
