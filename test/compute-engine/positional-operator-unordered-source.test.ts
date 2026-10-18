/**
 * An operator that reads its source by position refuses a collection without
 * positions (a set, a dictionary, `Integers`) on both routes.
 *
 * A set has no order. The declared `indexed_collection` parameter refuses a
 * literal set when the call is boxed: the error is kept in place,
 * `DeleteAt(Error(…), 1)`. A symbol of a wider declared type
 * (`collection<integer>`, `unknown`) can hold a set, and the operators read
 * it in its iteration order: `DeleteAt(c, 1)` with `c := Set(3, 1)` gave
 * `[1]`. Now the evaluation of the call gives the bare error
 * `Error(incompatible-type, indexed_collection, set<integer>)` with the
 * frame of the operator, as `Sort(c)` does.
 *
 * `Differences` is declared on `indexed_collection`: `Differences(Set(3, 1))`
 * is refused, where it gave `[-2]`. The lazy operators with a slot declared
 * `indexed_collection` (`Differences`, `ArgMax`, `ArgMin`) refuse a held set
 * when they are evaluated (`settleHeldEagerSources()` in
 * `src/compute-engine/boxed-expression/boxed-function.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const json = (x: Expression) => JSON.stringify(x.json);

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('c', 'collection<integer>');
  ce.assign('c', ce.box(['Set', 3, 1]));
  ce.declare('u', 'unknown');
  ce.assign('u', ce.box(['Set', 3, 1]));
  ce.declare('L', 'collection<integer>');
  ce.assign('L', ce.box(['List', 3, 1, 7]));
  ce.declare('Z', 'unknown');
  ce.assign('Z', ce.box('Integers'));
  ce.declare('t', 'unknown');
  ce.assign('t', ce.box(['Tuple', ['Set', 3, 1], ['List', 4, 9]]));
  return ce;
}

function heldSetError(operator: string): string {
  return JSON.stringify([
    'Error',
    [
      'ErrorCode',
      "'incompatible-type'",
      "'indexed_collection'",
      "'set<integer>'",
    ],
    ['Set', 3, 1],
    ['ErrorTrace', ['ErrorFrame', `'${operator}'`, 1]],
  ]);
}

describe('DeleteAt, ReplaceAt and Insert refuse a held set', () => {
  const ce = engine();
  const cases: [string, unknown][] = [
    ['DeleteAt', ['DeleteAt', 'c', 1]],
    ['ReplaceAt', ['ReplaceAt', 'c', 1, 2]],
    ['Insert', ['Insert', 'c', 1, 2]],
    ['DeleteAt', ['DeleteAt', 'u', 1]],
    ['ReplaceAt', ['ReplaceAt', 'u', 1, 2]],
    ['Insert', ['Insert', 'u', 1, 2]],
  ];
  test.each(cases)('%s over a held set: %j', (operator, input) => {
    const expr = ce.box(input as never);
    // The boxing admits the symbol: its declared type is not refuted.
    expect(expr.isValid).toBe(true);
    expect(json(expr.evaluate())).toBe(heldSetError(operator));
  });

  test('the asynchronous evaluation gives the same error', async () => {
    const value = await ce.box(['DeleteAt', 'c', 1]).evaluateAsync();
    expect(json(value)).toBe(heldSetError('DeleteAt'));
  });

  test('the literal set keeps its error in place', () => {
    expect(ce.box(['DeleteAt', ['Set', 3, 1], 1]).toString()).toBe(
      'DeleteAt(Error(ErrorCode("incompatible-type", "indexed_collection", "set<integer>"), Set(3, 1)), 1)'
    );
  });

  test('a held infinite set is refused, not walked', () => {
    expect(ce.box(['DeleteAt', 'Z', 1]).evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "indexed_collection", "set<integer>"), "Integers")'
    );
  });

  test('a held list, a string and a lazy list view are still read', () => {
    expect(ce.box(['DeleteAt', 'L', 1]).evaluate().toString()).toBe('[1,7]');
    expect(ce.box(['ReplaceAt', 'L', 1, 0]).evaluate().toString()).toBe(
      '[0,1,7]'
    );
    expect(ce.box(['Insert', 'L', 1, 0]).evaluate().toString()).toBe(
      '[0,3,1,7]'
    );
    expect(ce.box(['DeleteAt', "'abc'", 1]).evaluate().toString()).toBe('"bc"');
    expect(
      ce
        .box([
          'DeleteAt',
          ['Map', ['Function', ['Multiply', 'x', 2], 'x'], ['List', 1, 2, 3]],
          1,
        ])
        .evaluate()
        .toString()
    ).toBe('[4,6]');
  });

  test('the parse route gives the same error', () => {
    const ce = engine();
    expect(json(ce.parse('\\operatorname{DeleteAt}(c, 1)').evaluate())).toBe(
      heldSetError('DeleteAt')
    );
  });
});

describe('Differences is declared on indexed_collection', () => {
  const ce = engine();

  test('the literal set is refused when the call is boxed', () => {
    const expr = ce.box(['Differences', ['Set', 3, 1]]);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toBe(
      'Differences(Error(ErrorCode("incompatible-type", "indexed_collection", "set<integer>"), Set(3, 1)))'
    );
  });

  test('the parse route refuses the literal set too', () => {
    expect(
      ce.parse('\\operatorname{Differences}(\\lbrace 3, 1\\rbrace)').isValid
    ).toBe(false);
  });

  test('a held set is refused when the call is evaluated', () => {
    const expr = ce.box(['Differences', 'c']);
    expect(expr.isValid).toBe(true);
    expect(json(expr.evaluate())).toBe(heldSetError('Differences'));
  });

  test('a lazy view over a held set is refused', () => {
    expect(
      ce
        .box([
          'Differences',
          ['Filter', 'c', ['Function', ['Greater', 'x', 0], 'x']],
        ])
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "indexed_collection", "collection<integer>"), Filter(c, (x) => 0 < x))'
    );
  });

  test('an indexed source is still differenced', () => {
    expect(ce.box(['Differences', 'L']).evaluate().toString()).toBe('[-2,6]');
    expect(
      ce
        .box(['Differences', ['List', 1, 4, 9]])
        .evaluate()
        .toString()
    ).toBe('[3,5]');
    expect(
      ce
        .box(['Differences', ['At', 't', 2]])
        .evaluate()
        .toString()
    ).toBe('[5]');
  });
});

describe('ArgMax and ArgMin refuse a held set', () => {
  const ce = engine();

  test.each(['ArgMax', 'ArgMin'])('%s(c)', (operator) => {
    const expr = ce.box([operator, 'c']);
    expect(expr.isValid).toBe(true);
    expect(json(expr.evaluate())).toBe(heldSetError(operator));
  });

  test('a held list is still read', () => {
    expect(ce.box(['ArgMax', 'L']).evaluate().toString()).toBe('3');
    expect(ce.box(['ArgMin', 'L']).evaluate().toString()).toBe('2');
  });
});
