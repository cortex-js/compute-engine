import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 157(4) (generalized, 2026-08-11): a `(broadcastable<value>)`
// parameter admitted a function-typed argument where the plain `(value)`
// spelling correctly rejects it.
//
// The filed case was one instance of a wholesale hole: `broadcastable<T>`
// admitted EVERYTHING. `(broadcastable<number>)` accepted a `function`, a
// `string` and a `boolean` — each rejected by the bare `(number)` spelling.
//
// Root cause was NOT in the admission path and NOT in `isSubtype`, both of
// which were already right (`isSubtype(function, broadcastable<value>)` is
// `false`). It was in `provablyDisjoint`: `broadcastable<T>` spans two
// category buckets (`T` and `indexed_collection<T>`), so the category test
// found no bucket and fell through to the conservative "may overlap".
//
// That answer is safe for the predicate alone, but `box.ts` only KEEPS an
// argument-type error when EVERY candidate parameter is provably disjoint
// from the operand — an un-rejection that exists so a bare symbol with a
// provisional type is not eagerly refused. A parameter kind that is never
// provably disjoint therefore admitted every operand carrying a free
// variable. `provablyDisjoint` now distributes over `broadcastable<T>` exactly
// as it does over a union, using the same `T | indexed_collection<T>`
// expansion `isSubtype` uses.

describe('Tycho item 157(4): broadcastable<T> admission mirrors T', () => {
  const boxCall = (paramType: string, argType: string) => {
    const ce = new ComputeEngine();
    ce.declare('a', argType);
    ce.declare('f', `(${paramType}) -> number`);
    return JSON.stringify(ce.box(['f', 'a']).json);
  };
  const rejects = (paramType: string, argType: string) =>
    boxCall(paramType, argType).includes('Error');

  describe('the filed case', () => {
    test('(value) rejects a function argument', () => {
      expect(rejects('value', 'function')).toBe(true);
    });

    test('(broadcastable<value>) rejects it too — the item 157(4) ask', () => {
      expect(rejects('broadcastable<value>', 'function')).toBe(true);
    });
  });

  describe('the general hole: broadcastable<T> agrees with T', () => {
    // Every row the bare spelling refuses, the broadcastable spelling must
    // refuse — and every row it admits, the broadcastable spelling must admit.
    for (const [elem, arg] of [
      ['number', 'function'],
      ['number', 'string'],
      ['number', 'boolean'],
      ['value', 'function'],
      ['value', 'string'],
      ['value', 'boolean'],
    ] as const) {
      test(`(broadcastable<${elem}>) treats a ${arg} argument like (${elem})`, () => {
        expect(rejects(`broadcastable<${elem}>`, arg)).toBe(rejects(elem, arg));
      });
    }

    test('specifically: broadcastable<number> now refuses string and boolean', () => {
      expect(rejects('broadcastable<number>', 'string')).toBe(true);
      expect(rejects('broadcastable<number>', 'boolean')).toBe(true);
    });

    test('and broadcastable<value> still ADMITS string and boolean', () => {
      // `value` includes them, so tightening must not over-reject.
      expect(rejects('broadcastable<value>', 'string')).toBe(false);
      expect(rejects('broadcastable<value>', 'boolean')).toBe(false);
    });
  });

  describe('what broadcastable is FOR must keep working', () => {
    test('a scalar argument is admitted', () => {
      expect(rejects('broadcastable<number>', 'number')).toBe(false);
    });

    test('a collection argument is admitted (the whole point)', () => {
      expect(rejects('broadcastable<number>', 'list<number>')).toBe(false);
    });

    test('a literal numeric argument is admitted', () => {
      const ce = new ComputeEngine();
      ce.declare('f', '(broadcastable<number>) -> number');
      expect(JSON.stringify(ce.box(['f', 3]).json)).not.toContain('Error');
    });

    test('a literal list argument is admitted', () => {
      const ce = new ComputeEngine();
      ce.declare('f', '(broadcastable<number>) -> number');
      expect(
        JSON.stringify(ce.box(['f', ['List', 1, 2, 3]]).json)
      ).not.toContain('Error');
    });
  });

  describe('the underlying predicate', () => {
    let ce: ComputeEngine;
    beforeEach(() => {
      ce = new ComputeEngine();
    });

    test('disjoint from BOTH arms => disjoint from the broadcastable', () => {
      expect(ce.type('function').isDisjointFrom('broadcastable<number>')).toBe(true);
      expect(ce.type('string').isDisjointFrom('broadcastable<number>')).toBe(true);
      expect(ce.type('boolean').isDisjointFrom('broadcastable<number>')).toBe(true);
      expect(ce.type('function').isDisjointFrom('broadcastable<value>')).toBe(true);
    });

    test('overlapping either arm => NOT disjoint', () => {
      // scalar arm
      expect(ce.type('number').isDisjointFrom('broadcastable<number>')).toBe(false);
      // indexed_collection arm
      expect(ce.type('list<number>').isDisjointFrom('broadcastable<number>')).toBe(
        false
      );
    });

    test('it is symmetric', () => {
      expect(ce.type('broadcastable<number>').isDisjointFrom('function')).toBe(true);
      expect(ce.type('broadcastable<number>').isDisjointFrom('number')).toBe(false);
    });

    test('isSubtype was already correct and is unchanged', () => {
      expect(ce.type('function').matches('broadcastable<value>')).toBe(false);
      expect(ce.type('number').matches('broadcastable<number>')).toBe(true);
      expect(ce.type('list<number>').matches('broadcastable<number>')).toBe(true);
    });
  });
});
