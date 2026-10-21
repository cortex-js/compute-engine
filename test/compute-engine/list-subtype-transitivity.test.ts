import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { isSubtype } from '../../src/common/type/subtype';
import { reduceType, typesOverlap } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';

/**
 * The subtype relation of lists reads a value in several ways: by its
 * scalar element and shape, as a list of its rows (any number of outer axes
 * peeled), and, for a declared nested spelling (`list<vector<integer^3>^2>`),
 * in its flat spelling (`list<integer^(2x3)>`). Until 2026-10-21 three rules
 * applied one reading or another depending on the spelling of the types,
 * and the relation was not transitive: a union reduction that drops an arm
 * because it is a subtype of another arm then dropped values, and the meet,
 * which distributes over unions, lost values that were in both operands.
 * The losses were found by a check that generated random list and
 * collection types (lists with and without dimensions, `collection<E>`,
 * `indexed_collection<E>`, unions of these), met each pair, and tested
 * every type of a concrete non-empty list value (`list<integer^(2x2)>`,
 * `list<list<integer>^3>`, …) that is a subtype of both operands against
 * the meet; 72,000 pairs gave 18 losses. The first table below pins those
 * 18 as triples `w <: x`, `x <: y`, `w <: y`.
 *
 * User decisions 2026-10-21, one per rule:
 * 1. The rows of a value are read whether or not its scalar element matches
 *    the target's element: `matrix<string>` is a `vector<collection>` as
 *    `matrix<integer>` is. The scalar top stays the exception: the elements
 *    of a `vector<unknown>` are scalars (decided earlier the same day).
 * 2. The flat spelling of a nested list type is compared with every target,
 *    not only with a target of two or more dimensions.
 * 3. `collection<E>` and `indexed_collection<E>` peel any number of outer
 *    axes, as `list<E>` does.
 * 4. An outer list with no dimensions admits any shape of its elements, so
 *    its flat spelling has no dimensions (`list<vector<integer^3>>` reads as
 *    `list<integer>`, the cells in any shape): it is not a `matrix<integer>`,
 *    and the dimension solver pins no length from it. (Its missing length
 *    was read as one axis of any length, which made it a matrix although it
 *    holds a 2×2 arrangement of 3-vectors.)
 */

new ComputeEngine();

const sub = (a: string, b: string): boolean =>
  isSubtype(parseType(a), parseType(b));
const meet = (a: string, b: string): string =>
  typeToString(
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
  );
const inMeet = (a: string, b: string, witness: string): boolean =>
  isSubtype(
    parseType(witness),
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
  );

describe('the subtype relation of lists is transitive', () => {
  // Each row is a value type `w`, a type `x` and a type `y` such that
  // `w <: x` and `x <: y` held while `w <: y` did not: `w` is the value type
  // the check above found missing from a meet, `x` and `y` are two arms of
  // that meet (`x` the arm that held `w`, `y` the arm that absorbed `x`).
  test.each([
    // The rank rule (cause 1): the scalar element matches, so the rank was
    // read and the rows were not.
    ['list<integer^(2x2)>', 'list<unknown^(2x2)>', 'vector<integer | list>'],
    [
      'list<set<string>^(2x2)>',
      'collection<indexed_collection<collection<string>>> & list<unknown^(2x2)>',
      'collection<indexed_collection<collection<string>>> & list<collection<any>^2>',
    ],
    [
      'list<list<integer>^(2x2)>',
      'list<collection<integer>^(2x?)>',
      'list<list<any>^2>',
    ],
    [
      'list<(tuple<integer, integer> | list<integer^1>)^(3x2x2)>',
      'list<indexed_collection<list>^3>',
      'list<collection^3>',
    ],
    [
      'list<list<integer>^(2x2x2)>',
      'matrix<indexed_collection<list>> & list<indexed_collection<list<list^2>>>',
      'vector<list<any>> & list<indexed_collection<list<list^2>>>',
    ],
    [
      'list<list<string>^(2x2)>',
      'list<indexed_collection<string>^(2x2)>',
      'list<list<unknown>^2>',
    ],
    [
      'list<(tuple<integer, integer> | list<integer^1>)^(3x2x2)>',
      'list<list<unknown>^(3x2)>',
      'list<indexed_collection<unknown>^(?x2)>',
    ],
    [
      'list<list<integer>^(2x2)>',
      'list<(collection | integer)^(2x?)> & indexed_collection<indexed_collection<number>>',
      'vector<list<any>> & indexed_collection<indexed_collection<number>>',
    ],
    [
      'list<list<integer>^(2x2x2)>',
      'list<collection<list>^(2x2)> & collection<list<list<real>^(?x2)>>',
      'list<list<any>^2> & collection<list<list<real>^(?x2)>>',
    ],
    [
      'list<list<integer>^(3x2)>',
      'list<list<any>^(3x2)>',
      'vector<list<unknown>>',
    ],
    // A string is a collection, so the scalar element matched.
    [
      'list<string^(2x2x2)>',
      'list<collection<string>^(?x2)>',
      'list<collection^(?x2)>',
    ],
    [
      'list<list<string^1>^(2x2x2)>',
      'list<list<unknown^(2x?)>^(?x2)>',
      'matrix<list<collection>>',
    ],
    [
      'list<(tuple<string, string> | list<string^1>)^(2x2x2)>',
      'matrix<list>',
      'vector<indexed_collection<collection>>',
    ],
    // The nested-rows rule (cause 2): the flat spelling was compared with a
    // target of two or more dimensions only.
    [
      'list<list<integer^1>^2>',
      'matrix<integer>',
      'indexed_collection<list<real>> & collection<number>',
    ],
    [
      'list<list<list<integer>^2>^2>',
      'list<indexed_collection<integer>^(?x2)>',
      'list<indexed_collection<real>> & indexed_collection<list<collection>>',
    ],
    ['list<list<integer^1>^2>', 'matrix', 'list<number>'],
    [
      'list<list<boolean^1>^2>',
      'matrix<boolean>',
      'list<boolean> & collection<list<unknown>>',
    ],
    // The peel depth (cause 3): a collection peeled one axis, a list any
    // number.
    [
      'list<boolean^(2x2x2)>',
      'list<indexed_collection<indexed_collection<unknown>>> & list<list<boolean^2>>',
      'list<indexed_collection<indexed_collection<unknown>>> & collection<list<unknown^2>>',
    ],
  ])('%s <: %s <: %s', (w, x, y) => {
    expect(sub(w, x)).toBe(true);
    expect(sub(x, y)).toBe(true);
    expect(sub(w, y)).toBe(true);
  });
});

describe('the rows of a value are read whether or not its scalar element matches (decision 1)', () => {
  test.each([
    // A string is a collection, an integer is not: both matrices are
    // vectors of collections, by their rows.
    ['matrix<string>', 'vector<collection>'],
    ['matrix<integer>', 'vector<collection>'],
    ['matrix<integer>', 'vector<integer | list>'],
    ['list<integer^(2x2x2)>', 'vector<integer | list>'],
    ['list<string^(2x2x2)>', 'list<collection^(?x2)>'],
    // The nested spelling: the element is a list and matches, and so do
    // the rows.
    ['list<list<integer>^(2x2)>', 'vector<list>'],
    ['list<list<integer>^(2x2)>', 'vector<list<any>>'],
    ['list<list<integer>^(2x2)>', 'vector<collection>'],
  ])('%s is a %s', (a, b) => {
    expect(sub(a, b)).toBe(true);
  });

  test.each([
    // The scalar top stays the exception: the elements of a list with
    // dimensions whose element type is `unknown` or `any` are scalars.
    ['matrix<integer>', 'vector<unknown>'],
    ['matrix<integer>', 'vector<any>'],
    ['matrix<unknown>', 'vector<unknown>'],
    ['matrix<any>', 'vector<any>'],
    ['list<list<unknown^(3x3)>^(?x2)>', 'vector<unknown>'],
    ['list<integer^(2x2x2)>', 'list<unknown^2>'],
    // A target whose element admits no list reads the scalar and the rank.
    ['matrix<integer>', 'vector<integer>'],
    ['matrix<boolean>', 'vector<boolean>'],
    // A fixed length on the outer axis must agree.
    ['list<integer^(3x2)>', 'list<collection^2>'],
  ])('%s is not a %s', (a, b) => {
    expect(sub(a, b)).toBe(false);
  });
});

describe('the flat spelling of a nested list is compared with every target (decision 2)', () => {
  test.each([
    ['list<vector<integer^1>^2>', 'list<number>'],
    ['list<vector<integer^1>^2>', 'collection<number>'],
    ['list<vector<integer^1>^2>', 'indexed_collection<real>'],
    ['list<vector<integer^2>^3>', 'list<integer>'],
    ['list<vector<integer^2>>', 'list<number>'],
    ['list<list<list<integer>^2>^2>', 'list<indexed_collection<real>>'],
  ])('%s is a %s, as its flat spelling is', (a, b) => {
    expect(sub(a, b)).toBe(true);
  });

  test.each([
    // The rows can differ in length, so there is no flat spelling.
    ['list<list<integer>^2>', 'list<number^(2x?)>'],
    ['list<vector<integer>^2>', 'matrix<number>'],
    // A vector of two 1-rows is a 2×1 matrix, not a vector of numbers.
    ['list<vector<integer^1>^2>', 'vector<number>'],
    // An outer list with no dimensions admits any shape of its rows, so
    // its flat spelling has no dimensions and matches no target with
    // dimensions (decision 4, 2026-10-21): it holds a 2×2 arrangement of
    // 3-vectors, which is not a matrix.
    ['list<vector<integer^3>>', 'matrix<integer>'],
    ['list<vector<integer^3>>', 'list<integer^(?x3)>'],
    ['list<list<list^2>>', 'list<value^(?x2)>'],
  ])('%s is not a %s', (a, b) => {
    expect(sub(a, b)).toBe(false);
  });
});

describe('a collection peels any number of outer axes (decision 3)', () => {
  test('a 2×2×2 tensor is a list of 2-vectors, and a collection of them', () => {
    expect(sub('list<boolean^(2x2x2)>', 'list<vector<boolean^2>>')).toBe(true);
    expect(sub('list<boolean^(2x2x2)>', 'collection<vector<boolean^2>>')).toBe(
      true
    );
    expect(
      sub('list<boolean^(2x2x2)>', 'indexed_collection<vector<boolean^2>>')
    ).toBe(true);
    expect(
      typesOverlap(
        parseType('collection<vector<integer^2>>'),
        parseType('list<integer^(2x2x2)>')
      )
    ).toBe(true);
  });

  test('a matrix is not a collection of vectors of another length', () => {
    expect(sub('list<boolean^(2x2x2)>', 'collection<vector<boolean^3>>')).toBe(
      false
    );
  });
});

describe('the meet follows the readings', () => {
  // The witness is a value of both operands and must be a value of their
  // meet. Before the decisions, these meets were `vector<string>`,
  // `vector<integer^3>` and `list<boolean^2>`, which do not hold the
  // witness; the intersection is now kept as written.
  test.each([
    ['list<string>', 'vector<collection>', 'list<string^(2x2)>'],
    [
      'collection<string>',
      'vector<indexed_collection<any>>',
      'list<string^(2x2)>',
    ],
    ['vector<collection>', 'indexed_collection<string>', 'list<string^(2x2)>'],
    [
      'collection<integer>',
      'list<(list<list> | real)^3>',
      'list<integer^(3x2x2)>',
    ],
    [
      'list<integer>',
      'list<(boolean | collection | real)^3>',
      'list<integer^(3x2)>',
    ],
    ['list<string>', 'list<(boolean | collection)^3>', 'list<string^(3x2)>'],
    [
      'list<list<collection^2>^2>',
      'list<indexed_collection<string>^2>',
      'list<string^(2x2x2)>',
    ],
    [
      'list<boolean>',
      'list<(boolean | matrix<collection> | string)^2>',
      'list<list<boolean^1>^(2x2x2)>',
    ],
    // A primitive that `list` is below (`value`, `expression`) admits the
    // rows too; these meets were `vector<integer>` and `vector<integer^2>`.
    ['vector<value>', 'list<integer>', 'list<integer^(2x2)>'],
    ['vector<expression>', 'list<integer>', 'list<integer^(2x2)>'],
    ['list<value^2>', 'list<integer>', 'list<integer^(2x2)>'],
    ['vector<value>', 'collection<integer>', 'list<integer^(2x2)>'],
  ])('%s & %s holds %s', (a, b, w) => {
    expect(sub(w, a)).toBe(true);
    expect(sub(w, b)).toBe(true);
    expect(inMeet(a, b, w)).toBe(true);
    expect(inMeet(b, a, w)).toBe(true);
  });

  test('an outer list with no dimensions is not absorbed by a list with dimensions', () => {
    // A fourth cause of the non-transitive relation (decision 4 above): the
    // missing outer length was merged as one axis, so `list<list<list^2>>` was a
    // `list<value^(?x2)>` and the union reduction dropped it, although it
    // holds a rank-3 value (a 1×1 arrangement of rows of two lists) that
    // the rank-2 arm does not.
    const w = 'list<list<integer>^(1x1x2)>';
    const u = reduceType({
      kind: 'union',
      types: [parseType('list<list<list^2>>'), parseType('list<value^(?x2)>')],
    });
    expect(sub(w, 'list<list<list^2>>')).toBe(true);
    expect(sub(w, 'list<value^(?x2)>')).toBe(false);
    expect(typeToString(u)).toBe('list<list<list^2>> | list<value^(?x2)>');
    expect(isSubtype(parseType(w), u)).toBe(true);
  });

  test('an outer list with no dimensions of empty rows is not the empty list', () => {
    // `list<list<never^0>>` holds `[[], []]` (two empty rows), which a list
    // whose first axis has length 0 does not; its flat spelling must not be
    // `list<never>`, the type of `[]` alone, which such a list admits.
    const w = 'list<never^(2x0)>';
    expect(sub(w, 'list<list<never^0>>')).toBe(true);
    expect(sub(w, 'vector<integer^0>')).toBe(false);
    expect(sub('list<list<never^0>>', 'vector<integer^0>')).toBe(false);
    expect(sub('list<never>', 'vector<integer^0>')).toBe(true);
    const u = reduceType({
      kind: 'union',
      types: [parseType('list<list<never^0>>'), parseType('vector<integer^0>')],
    });
    expect(isSubtype(parseType(w), u)).toBe(true);
  });

  test('a meet is never wider than its operands', () => {
    // `matrix<any>` is not a `vector<any>` (its elements are scalars), so
    // the meet has no non-empty value.
    expect(meet('list<any^(3x2)>', 'vector<any>')).toBe('never');
    // A matrix of 3×3 matrices is not a `vector<unknown>` either; the empty
    // list is in both, so the intersection is kept.
    const m = reduceType({
      kind: 'intersection',
      types: [
        parseType('list<list<unknown^(3x3)>^(?x2)>'),
        parseType('vector<unknown>'),
      ],
    });
    expect(isSubtype(m, parseType('vector<unknown>'))).toBe(true);
    expect(isSubtype(m, parseType('list<list<unknown^(3x3)>^(?x2)>'))).toBe(
      true
    );
  });

  test('the elementwise meet still applies when no row reading is shared', () => {
    expect(meet('list<number^2>', 'list<integer>')).toBe('vector<integer^2>');
    expect(meet('list<unknown>', 'indexed_collection<boolean>')).toBe(
      'list<boolean>'
    );
    expect(meet('vector<integer>', 'list<number>')).toBe('vector<integer>');
  });
});
