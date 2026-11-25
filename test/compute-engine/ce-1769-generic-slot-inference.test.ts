import { ComputeEngine } from '../../src/compute-engine';

/**
 * An operand at a parameter that the signature declares as a bare type
 * variable is narrowed at most to the bound of the variable, not to the type
 * that the other operands give the variable (`inferenceTypeWithKindsAt`,
 * `validate.ts`). A stored value typed `unknown` stays in the element type
 * of `Insert` and `ReplaceAt` (`listWithUnknownStored`, `collections.ts`).
 */

const ce = new ComputeEngine();

describe('CE-1769: a parameter at a bare type variable keeps its type', () => {
  test('a function that inserts its argument into a range', () => {
    ce.assign(
      'ins1769',
      ce.expr(['Function', ['Insert', ['Range', 1, 'u'], 1, 't'], 'u', 't'])
    );
    expect(ce.expr('ins1769').type.toString()).toBe(
      '(u: unknown, t: unknown) -> list<unknown>'
    );
    const call = ce.expr(['ins1769', 2, 0.5]);
    expect(call.type.toString()).toBe('list<real>');
    expect(call.evaluate().toString()).toBe('[0.5,1,2]');
  });

  test('a function that writes its argument over one element of a range', () => {
    ce.assign(
      'rep1769',
      ce.expr(['Function', ['ReplaceAt', ['Range', 1, 'u'], 1, 't'], 'u', 't'])
    );
    expect(ce.expr('rep1769').type.toString()).toBe(
      '(u: unknown, t: unknown) -> list<unknown>'
    );
    const call = ce.expr(['rep1769', 2, 0.5]);
    expect(call.type.toString()).toBe('list<real>');
    expect(call.evaluate().toString()).toBe('[0.5,2]');
  });

  test('a write over a list literal does not keep its type for an unknown value', () => {
    ce.assign(
      'rep2_1769',
      ce.expr(['Function', ['ReplaceAt', ['List', 1, 2], 1, 't'], 't'])
    );
    expect(ce.expr('rep2_1769').type.toString()).toBe(
      '(t: unknown) -> list<unknown>'
    );
    expect(ce.expr(['rep2_1769', 0.5]).evaluate().toString()).toBe('[0.5,2]');
  });

  test('values with known types still give the join', () => {
    expect(
      ce.expr(['Insert', ['Range', 1, 'u'], 1, 0.5]).type.toString()
    ).toBe('list<real>');
    expect(
      ce.expr(['ReplaceAt', ['List', 1, 2], 1, 0.5]).type.toString()
    ).toBe('list<real>');
    expect(ce.expr(['ReplaceAt', ['List', 1, 2], 1, 3]).type.toString()).toBe(
      'vector<integer^2>'
    );
  });

  // A generic signature declared by the user has no `type` handler that
  // keeps the `unknown` value: CE-1798.
  test.todo(
    'a user-declared `(indexed_collection<T>, T) -> list<T>` with an unknown value gives list<unknown>'
  );

  test('the other operand of a bounded variable does not narrow the operand', () => {
    // `Remainder` is `(T, T) -> T where T: number`: the integer `3` does not
    // make `t` an integer, so the result is not typed `integer | nan`.
    ce.assign('rem1769', ce.expr(['Function', ['Remainder', 3, 't'], 't']));
    expect(ce.expr('rem1769').type.toString()).toBe('(t: unknown) -> number');
    expect(ce.expr(['rem1769', 0.5]).evaluate().toString()).toBe('0');
    expect(ce.expr(['rem1769', 0.7]).evaluate().toString()).toBe('0.2');
  });
});
