/**
 * ROADMAP CE-374 (landed 2026-10-23): a seeded `Add` or `Multiply` fold
 * over elements of unknown type, or over rows, was typed `unknown`.
 *
 * `Product(L)` of an operand that is not a list literal becomes
 * `Reduce(L, Multiply, 1)` at canonicalization, and the result type of a
 * `Reduce` is the reducer's own result type, which is `unknown` for
 * `Multiply` over an element of unknown type. With `L: list<unknown>`,
 * `Sum(Rest(L))` was a `broadcastable<number>` and `Product(Rest(L))` was
 * `unknown`. A seeded `Add` or `Multiply` fold with the identity as its seed
 * is now typed as `Sum` or `Product` type the collection
 * (`elementsFoldAsBigOp`, `library/collections.ts`) when the elements are of
 * unknown type or are numbers or rows; a tuple arm keeps the reducer's
 * typing, and `Scan` keeps its running values.
 */
import { ComputeEngine } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<unknown>');
  ce.declare('V', 'list<vector<2>>');
  ce.declare('U', 'list<number | vector<2>>');
  ce.declare('T', 'list<tuple<number, number>>');
  ce.declare('M', 'list<number>');
  ce.declare('LM', 'list<unknown | missing>');
  ce.declare('VM', 'list<vector<2> | missing>');
  return ce;
}

describe('A SEEDED ADD OR MULTIPLY FOLD IS TYPED AS SUM OR PRODUCT (CE-374)', () => {
  test.each([
    // Elements of unknown type: a number or a tensor, as `Sum(L)` says.
    [['Product', ['Rest', 'L']], 'broadcastable<number>'],
    [['Reduce', ['Rest', 'L'], 'Multiply', 1], 'broadcastable<number>'],
    [['Reduce', ['Rest', 'L'], 'Add', 0], 'broadcastable<number>'],
    [['Sum', ['Rest', 'L']], 'broadcastable<number>'],
    // Rows: the fold is a row, or the seed for an empty collection.
    [['Product', ['Rest', 'V']], 'integer | vector<2>'],
    [['Reduce', 'V', 'Multiply', 1], 'integer | vector<2>'],
    [['Reduce', 'V', 'Add', 0], 'integer | vector<2>'],
    // Numbers or rows (the shape the rule read before).
    [['Reduce', 'U', 'Add', 0], 'number | vector<2>'],
    // Elements that may be absent: the `missing` arm is dropped before the
    // elements are read, and an absent cell gives `NaN`.
    [['Product', ['Rest', 'LM']], 'broadcastable<number>'],
    [['Reduce', 'LM', 'Add', 0], 'broadcastable<number>'],
    [['Reduce', 'VM', 'Multiply', 1], 'integer | nan | vector<2>'],
    // Numbers only: unchanged.
    [['Reduce', 'M', 'Add', 0], 'number'],
    [['Reduce', 'M', 'Multiply', 1], 'number'],
  ] as [unknown, string][])('%j is %s', (json, expected) => {
    expect(
      engine()
        .box(json as any)
        .type.toString()
    ).toBe(expected);
  });

  test('a tuple arm keeps the reducer typing, and Scan keeps its running values', () => {
    const ce = engine();
    expect(ce.box(['Reduce', 'T', 'Add', 0]).type.toString()).toBe('unknown');
    expect(ce.box(['Scan', 'L', 'Add', 0]).type.toString()).toBe(
      'list<unknown>'
    );
  });

  test('the values fit the types', () => {
    const ce = engine();
    const rows = ['List', ['List', 1, 2], ['List', 3, 4], ['List', 5, 6]];
    ce.assign('V', ce.box(rows as any));
    expect(
      ce
        .box(['Product', ['Rest', 'V']])
        .evaluate()
        .toString()
    ).toBe('[15,24]');
    ce.assign('V', ce.box(['List']));
    expect(
      ce
        .box(['Product', ['Rest', 'V']])
        .evaluate()
        .toString()
    ).toBe('1');
  });
});
