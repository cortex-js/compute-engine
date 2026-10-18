/**
 * `Sort` and `Ordering` refuse, when they are evaluated, a comparator (a
 * callback with two parameters) with a declared parameter type that is
 * disjoint from the element type of the source.
 *
 * The comparator option of the signature is `(any, any) any -> number |
 * boolean`: the type language allows a type variable in one option of a
 * union only, and the sort-key option holds it. So the static check did not
 * see the element type, and
 * `Sort([3, 1, 2], (a: string, b: string) ↦ Length(a) − Length(b))` was
 * admitted and answered an arbitrary order. The refusal has the shape of the
 * static refusal of a sort key: `incompatible-type` with the expected arrow
 * and the actual type of the callback, and the frame of the operator at
 * operand 2.
 *
 * Decision 2026-10-17: no change to the signature; the check is at run time.
 * The code is in `src/compute-engine/library/collections.ts`
 * (`comparatorParameterError`).
 */

import { ComputeEngine } from '../../src/compute-engine';

const stringComparator = [
  'Function',
  ['Subtract', ['Length', 'a'], ['Length', 'b']],
  ['Typed', 'a', "'string'"],
  ['Typed', 'b', "'string'"],
];
const integerComparator = [
  'Function',
  ['Subtract', 'b', 'a'],
  ['Typed', 'a', "'integer'"],
  ['Typed', 'b', "'integer'"],
];

describe('a comparator with a parameter type disjoint from the elements', () => {
  const ce = new ComputeEngine();

  test('Sort and Ordering refuse it', () => {
    for (const op of ['Sort', 'Ordering']) {
      const result = ce
        .box([op, ['List', 3, 1, 2], stringComparator])
        .evaluate();
      expect(result.operator).toBe('Error');
      expect(result.json).toEqual([
        'Error',
        [
          'ErrorCode',
          "'incompatible-type'",
          "'(integer, integer) any -> boolean | number'",
          "'(a: string, b: string) -> integer'",
        ],
        [
          'Function',
          ['Block', ['Add', ['Length', 'a'], ['Negate', ['Length', 'b']]]],
          ['Typed', 'a', "'string'"],
          ['Typed', 'b', "'string'"],
        ],
        ['ErrorTrace', ['ErrorFrame', `'${op}'`, 2]],
      ]);
    }
  });

  test('a string source and an integer comparator', () => {
    const result = ce
      .box(['Sort', { str: 'cab' }, integerComparator])
      .evaluate();
    expect(result.operator).toBe('Error');
    expect(JSON.stringify(result.json)).toMatch(
      /\(character, character\) any -> boolean \| number/
    );
  });

  test('a declared function symbol', () => {
    ce.declare('g', '(string, string) -> integer');
    const result = ce.box(['Sort', ['List', 3, 1, 2], 'g']).evaluate();
    expect(result.operator).toBe('Error');
    expect(JSON.stringify(result.json)).toMatch(/incompatible-type/);
  });

  test('parse route', () => {
    const result = ce
      .parse(
        '\\operatorname{Sort}([3, 1, 2], (a: \\operatorname{string}, b: \\operatorname{string}) \\mapsto 1)'
      )
      .evaluate();
    expect(result.operator).toBe('Error');
    expect(JSON.stringify(result.json)).toMatch(/incompatible-type/);
  });
});

describe('comparators that are not refused', () => {
  const ce = new ComputeEngine();

  test('a parameter type that admits the elements', () => {
    expect(
      ce.box(['Sort', ['List', 3, 1, 2], integerComparator]).evaluate().json
    ).toEqual(['List', 3, 2, 1]);
    expect(
      ce.box(['Ordering', ['List', 3, 1, 2], integerComparator]).evaluate().json
    ).toEqual(['List', 1, 3, 2]);
  });

  test('unannotated parameters', () => {
    expect(
      ce
        .box([
          'Sort',
          ['List', 3, 1, 2],
          ['Function', ['Subtract', 'b', 'a'], 'a', 'b'],
        ])
        .evaluate().json
    ).toEqual(['List', 3, 2, 1]);
  });

  test('a parameter type that overlaps the element type', () => {
    // `integer` and the element type of `[3, 1.5, 2]` share the integers,
    // so they are not disjoint and the run-time check does not apply.
    const result = ce
      .box(['Sort', ['List', 3, 1.5, 2], integerComparator])
      .evaluate();
    expect(result.operator).not.toBe('Error');
  });

  test('a sort key is checked statically, as before', () => {
    const result = ce.box([
      'Sort',
      ['List', 3, 1, 2],
      ['Function', ['Length', 'a'], ['Typed', 'a', "'string'"]],
    ]);
    expect(JSON.stringify(result.json)).toMatch(/incompatible-type/);
  });
});
