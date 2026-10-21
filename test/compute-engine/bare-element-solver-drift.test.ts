import { ComputeEngine } from '../../src/compute-engine';

// Bare family names admit arbitrary contents. Element inference must agree
// with explicit <any> contracts, including keyed collection entry tuples.
let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
});

describe('type-variable binding over bare collection operands', () => {
  test('Unique over each bare constructor stays in the collection family', () => {
    for (const t of [
      'collection',
      'indexed_collection',
      'list',
      'set',
      'dictionary',
      'record',
    ]) {
      ce.declare(`v_${t}`, t);
      const result = ce.box(['Unique', `v_${t}`]).type;
      // A `collection` or an `indexed_collection` can be a string, and
      // `Unique` of a string is a string, so the result type is the join of
      // the list and the string results. The other constructors exclude a
      // string and select the list result.
      const admitsString = t === 'collection' || t === 'indexed_collection';
      // The discriminating pin: a values-only `list` admits the list result;
      // the drifted `list<any>` did NOT match bare `list`.
      expect(result.matches(admitsString ? 'list | string' : 'list')).toBe(
        true
      );
      expect(result.toString()).toBe(
        admitsString
          ? 'list<any> | string'
          : t === 'dictionary' || t === 'record'
            ? 'list<tuple<string, any>>'
            : 'list<any>'
      );
    }
  });

  test('a parameterized operand still binds its concrete element type', () => {
    ce.declare('U', 'indexed_collection<integer>');
    expect(ce.box(['Unique', 'U']).type.toString()).toBe('list<integer>');
  });

  test('a bare actual at a broadcastable<T> pattern binds T to any', () => {
    // The third drift site (`walkPattern`'s broadcastable case, dual-review
    // catch): a bare `list` actual bound `T := any`. The broadcast lift
    // wraps the per-element result (`list<T>`) in one collection level, so
    // the values-only binding reads `list<list<unknown>>` — matching the
    // parameterized control's shape.
    ce.declare('f', '(broadcastable<T>) -> list<T> where T');
    ce.declare('pl', 'list<integer>');
    expect(ce.box(['f', 'pl']).type.toString()).toBe('list<list<integer>>');
    ce.declare('bl', 'list');
    expect(ce.box(['f', 'bl']).type.toString()).toBe('list<list<any>>');
    ce.declare('bic', 'indexed_collection');
    expect(ce.box(['f', 'bic']).type.toString()).toBe('list<list<any>>');
  });
});
