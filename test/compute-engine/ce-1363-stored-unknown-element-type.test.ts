import { ComputeEngine } from '../../src/compute-engine';

/**
 * A value typed `unknown` that `Append`, or `ReplaceAt` with more than one
 * position, stores as an element can be any value, so the element type of
 * the result keeps it (`storedElementType`, `collections.ts`): it is not the
 * element type of the source alone.
 */

const ce = new ComputeEngine();

describe('CE-1363: a stored value typed unknown widens the element type', () => {
  test('a function that appends its argument to a range', () => {
    ce.assign(
      'ap1363',
      ce.expr(['Function', ['Append', ['Range', 1, 'u'], 't'], 'u', 't'])
    );
    expect(ce.expr('ap1363').type.toString()).toBe(
      '(u: unknown, t: unknown) -> list<unknown>'
    );
    const call = ce.expr(['ap1363', 2, 0.5]);
    expect(call.type.toString()).toBe('list<real>');
    expect(call.evaluate().toString()).toBe('[1,2,0.5]');
  });

  test('Append of a call typed unknown, with more than one value', () => {
    expect(
      ce.expr(['Append', ['Range', 1, 'u'], ['g1363', 'u']]).type.toString()
    ).toBe('list<unknown>');
    expect(
      ce.expr(['Append', ['Range', 1, 'u'], ['g1363', 'u'], 2]).type.toString()
    ).toBe('list<unknown>');
  });

  test('Append of values with known types still widens', () => {
    expect(ce.expr(['Append', ['Range', 1, 'u'], 0.5]).type.toString()).toBe(
      'list<real>'
    );
  });

  test('ReplaceAt with two positions and a value typed unknown', () => {
    expect(
      ce
        .expr(['ReplaceAt', ['List', ['Range', 1, 3]], 1, 1, ['g1363', 'u']])
        .type.toString()
    ).toBe('list<list<unknown>>');
  });
});
