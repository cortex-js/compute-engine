import { ComputeEngine } from '../../../src/compute-engine';
import { ExpressionMap } from '../../../src/compute-engine/boxed-expression/expression-map';

import '../../utils'; // For snapshot serializers

// SYM P2-12: `ExpressionMap.delete` must key on `isSame` (structural/value
// equality) like `has`/`get`/`set`, not on object identity. An identity-based
// delete silently no-ops when handed a structurally-equal but distinct
// instance, leaving stale entries (e.g. a re-boxed assumption) behind.
describe('ExpressionMap.delete is isSame-based (SYM P2-12)', () => {
  const ce = new ComputeEngine();

  test('delete removes an entry given a distinct but equal key', () => {
    const map = new ExpressionMap<boolean>();
    map.set(ce.box(['Greater', 'x', 0]), true);
    expect(map.has(ce.box(['Greater', 'x', 0]))).toBe(true);

    // A freshly-boxed, structurally-identical (but !== ) expression.
    map.delete(ce.box(['Greater', 'x', 0]));
    expect(map.has(ce.box(['Greater', 'x', 0]))).toBe(false);
    expect(map.get(ce.box(['Greater', 'x', 0]))).toBe(undefined);
  });

  test('delete still removes the exact stored instance', () => {
    const map = new ExpressionMap<number>();
    const key = ce.box(['Add', 'a', 1]);
    map.set(key, 42);
    map.delete(key);
    expect(map.has(key)).toBe(false);
  });

  test('delete of an absent key is a no-op', () => {
    const map = new ExpressionMap<boolean>();
    map.set(ce.box('a'), true);
    map.delete(ce.box('b'));
    expect(map.has(ce.box('a'))).toBe(true);
  });
});
