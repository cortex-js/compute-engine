import { ComputeEngine } from '../../src/compute-engine';

// Bare collection constructors are their `<unknown>` synonyms (user ruling
// 2026-08-17): their elements are VALUES. `collectionElementType`
// (`common/type/utils.ts`) was updated in that round, but its documented
// mirror `elementTypeOf` in `common/type/instantiate.ts` — duplicated only
// to break an import cycle — had drifted and kept answering `any`. The
// drift leaked into type-variable bindings: `Unique` over a bare-typed
// operand instantiated `(collection<T>) -> list<T>` with `T := any`,
// producing `list<any>` — an absence-admitting type OUTSIDE the values-only
// collection family the operand came from (`list<any> ⊄ collection`).

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
});

describe('type-variable binding over bare collection operands', () => {
  test('Unique over each bare constructor stays in the values-only family', () => {
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
      // The discriminating pin: a values-only `list` admits the result;
      // the drifted `list<any>` did NOT match bare `list`.
      expect(result.matches('list')).toBe(true);
      expect(result.toString()).toBe('list<unknown>');
    }
  });

  test('a parameterized operand still binds its concrete element type', () => {
    ce.declare('U', 'indexed_collection<integer>');
    expect(ce.box(['Unique', 'U']).type.toString()).toBe('list<integer>');
  });

  test('a bare actual at a broadcastable<T> pattern binds T to unknown', () => {
    // The third drift site (`walkPattern`'s broadcastable case, dual-review
    // catch): a bare `list` actual bound `T := any`. The broadcast lift
    // wraps the per-element result (`list<T>`) in one collection level, so
    // the values-only binding reads `list<list<unknown>>` — matching the
    // parameterized control's shape.
    ce.declare('f', '(broadcastable<T>) -> list<T> where T');
    ce.declare('pl', 'list<integer>');
    expect(ce.box(['f', 'pl']).type.toString()).toBe('list<list<integer>>');
    ce.declare('bl', 'list');
    expect(ce.box(['f', 'bl']).type.toString()).toBe('list<list<unknown>>');
    ce.declare('bic', 'indexed_collection');
    expect(ce.box(['f', 'bic']).type.toString()).toBe('list<list<unknown>>');
  });
});
