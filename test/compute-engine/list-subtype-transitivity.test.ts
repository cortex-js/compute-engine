import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { isSubtype } from '../../src/common/type/subtype';
import { reduceType, typesOverlap } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';

/**
 * The subtype relation of lists reads every list type in one way (user
 * decisions of 2026-10-21, `docs/plans/2026-10-21-list-element-tensor-cell.md`):
 *
 * - A list with no dimensions, `list<E>`, is read by its elements: a matrix
 *   of integers is a `list<vector<integer>>` and a `list<list<integer>>`,
 *   never a `list<integer>`.
 * - A list with dimensions (`vector<U>`, `matrix<U>`, `list<U^dims>`) is
 *   read by its cells, and its elements are its rows. The cells of a named
 *   `vector`, `matrix` or `tensor` are numbers; a `list<U^dims>` may carry
 *   dimensions when `U` cannot hold a list (`matrix<boolean^(2x2)>`).
 * - `tensor<U>` is a tensor of unknown rank whose cells are `U`; its
 *   elements are `U | tensor<U>`.
 * - A list of numbers and an open-length vector of the same numbers denote
 *   the same values: `list<integer>` and `vector<integer>` are mutual
 *   subtypes.
 *
 * Until 2026-10-21 the relation applied three readings at once (the scalar
 * element and the rank, the rows with any number of outer axes peeled, and
 * the flat spelling of a nested list), was not transitive, and lost values
 * in union reductions and meets. The tables below pin chains `w <: x <: y`
 * under the element reading, the relations between the two families, and
 * the meets that the readings decide.
 */

new ComputeEngine();

const sub = (a: string, b: string): boolean =>
  isSubtype(parseType(a), parseType(b));
const meet = (a: string, b: string): string =>
  typeToString(
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
  );
const meetOf = (a: string, b: string) =>
  reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] });
const inMeet = (a: string, b: string, witness: string): boolean =>
  isSubtype(parseType(witness), meetOf(a, b));

describe('the subtype relation of lists is transitive', () => {
  // Each row is a chain `w <: x <: y`; the relation must give `w <: y` too.
  test.each([
    // A tensor of rank 2 is a list of its rows, a row is a list of its
    // cells, and a list of anything is a `list<any>`.
    ['matrix<integer^(2x2)>', 'matrix<integer>', 'list<vector<integer>>'],
    ['matrix<integer>', 'list<vector<integer>>', 'list<list<integer>>'],
    ['list<vector<integer>>', 'list<list<integer>>', 'list<any>'],
    // The length of a row is kept in the element type of the rows.
    [
      'matrix<integer^(2x3)>',
      'list<vector<integer^3>>',
      'list<vector<number>>',
    ],
    ['list<vector<integer^3>>', 'list<vector<number>>', 'list<list<number>>'],
    // An open axis admits a fixed one; the rows of an open-width matrix are
    // open-length vectors.
    ['matrix<integer^(2x2)>', 'matrix<number^(2x?)>', 'list<vector<number>>'],
    // A fixed-length vector is an open-length vector, which is a list of its
    // cells (the two spellings denote the same values).
    ['vector<integer^3>', 'vector<integer>', 'list<integer>'],
    ['vector<integer>', 'list<integer>', 'list<number>'],
    ['list<integer>', 'list<number>', 'collection<number>'],
    // A list of numbers is a rank-1 tensor, which is a tensor of unknown
    // rank, which is a `broadcastable` of its cells.
    ['list<integer>', 'vector<integer>', 'tensor<integer>'],
    ['vector<integer>', 'tensor<integer>', 'tensor'],
    ['tensor<integer>', 'tensor', 'broadcastable<number>'],
    ['vector<integer^3>', 'broadcastable<integer>', 'broadcastable<number>'],
    // `broadcastable<T>` is `T | tensor<T>` for a numeric `T`.
    ['broadcastable<integer>', 'broadcastable<number>', 'number | tensor'],
    // A rank-3 tensor is a list of matrices, which is a list of lists of
    // vectors.
    [
      'tensor<integer^(2x3x4)>',
      'list<matrix<integer^(3x4)>>',
      'list<matrix<integer>>',
    ],
    [
      'list<matrix<integer>>',
      'list<list<vector<integer>>>',
      'list<list<list<integer>>>',
    ],
    // The elements of a tensor of unknown rank are cells or tensors.
    [
      'tensor<integer>',
      'list<integer | tensor<integer>>',
      'list<number | tensor>',
    ],
    ['list<integer | tensor<integer>>', 'list<number | tensor>', 'list<any>'],
    // A dimensioned list of non-numbers is read by its cells too: its rows
    // are fixed-length lists of the cell type.
    ['matrix<boolean^(2x2)>', 'list<list<boolean^2>>', 'list<list<boolean>>'],
    [
      'list<list<boolean^2>>',
      'list<list<boolean>>',
      'list<collection<boolean>>',
    ],
    [
      'list<tuple<integer, integer>^3>',
      'list<tuple<integer, integer>>',
      'list<tuple<number, number>>',
    ],
    // `broadcastable<T>` is `T | list<T>` for a non-numeric `T`.
    [
      'list<tuple<integer, integer>>',
      'list<tuple<number, number>>',
      'broadcastable<tuple<number, number>>',
    ],
    [
      'matrix<string^(2x2)>',
      'list<list<string>>',
      'collection<collection<string>>',
    ],
    // The cells are covariant.
    ['vector<integer>', 'vector<value>', 'vector<any>'],
    // A matrix is an indexed collection of its rows, and a row is an indexed
    // collection of its cells.
    [
      'matrix<integer>',
      'indexed_collection<vector<integer>>',
      'indexed_collection<indexed_collection<number>>',
    ],
  ])('%s <: %s <: %s', (w, x, y) => {
    expect(sub(w, x)).toBe(true);
    expect(sub(x, y)).toBe(true);
    expect(sub(w, y)).toBe(true);
  });
});

describe('the elements of a tensor of rank 2 or more are its rows', () => {
  test.each([
    // A matrix of integers is a list, a collection, of its rows.
    ['matrix<integer>', 'list<vector<integer>>'],
    ['matrix<integer>', 'list<list<integer>>'],
    ['matrix<integer>', 'collection<collection<integer>>'],
    ['matrix<integer>', 'list<integer | list>'],
    // A rank-3 tensor is a list of matrices, and a list of lists of lists.
    ['tensor<integer^(2x2x2)>', 'list<integer | list>'],
    ['tensor<integer^(2x2x2)>', 'list<list<list<integer>>>'],
    ['tensor<integer^(2x2x2)>', 'list<matrix<integer^(2x2)>>'],
    // A dimensioned list of non-numbers has rows too.
    ['matrix<string^(2x2)>', 'list<list<string>>'],
    ['matrix<boolean^(2x2)>', 'list<collection<boolean>>'],
    // An open axis admits the fixed length.
    ['matrix<integer^(3x2)>', 'matrix<integer^(?x2)>'],
  ])('%s is a %s', (a, b) => {
    expect(sub(a, b)).toBe(true);
  });

  test.each([
    // A matrix is not a list of its cells: the element reading of `list<E>`
    // sees the rows, not the cells.
    ['matrix<integer>', 'list<integer>'],
    ['matrix<integer>', 'list<number>'],
    // A matrix is not a vector of anything: the rank differs.
    ['matrix<integer>', 'vector<integer>'],
    ['matrix<integer>', 'vector<unknown>'],
    ['matrix<integer>', 'vector<any>'],
    ['matrix<unknown>', 'vector<unknown>'],
    ['matrix<any>', 'vector<any>'],
    // The rows of a 2×2×2 tensor are 2×2 matrices, not 2-vectors.
    ['tensor<integer^(2x2x2)>', 'list<vector<integer^2>>'],
    // A fixed axis must agree with the target's axis.
    ['matrix<integer^(3x2)>', 'matrix<integer^(2x?)>'],
    ['matrix<integer^(3x2)>', 'list<vector<integer^3>>'],
  ])('%s is not a %s', (a, b) => {
    expect(sub(a, b)).toBe(false);
  });
});

describe('a plain list of vectors is not a tensor', () => {
  test.each([
    // The rows of a `list<vector<integer^3>>` may differ in number and the
    // rows of a `list<vector<integer>>` in length, so neither is a matrix.
    ['list<vector<integer^3>>', 'matrix<integer>'],
    ['list<vector<integer^3>>', 'matrix<integer^(?x3)>'],
    ['list<vector<integer>>', 'matrix'],
    ['list<list<integer>>', 'matrix<integer>'],
    // A list of vectors is not a list of numbers (decided 2026-10-21; this
    // reverses the earlier request that `list<vector<integer^1>>` be a
    // `list<integer>`).
    ['list<vector<integer>>', 'list<integer>'],
    ['list<vector<integer^1>>', 'list<integer>'],
    ['list<vector<integer^2>>', 'list<number>'],
  ])('%s is not a %s', (a, b) => {
    expect(sub(a, b)).toBe(false);
  });

  test.each([
    // The other way round holds: a matrix is a list of its rows, and a
    // vector is a list of its cells.
    ['matrix<integer>', 'list<vector<integer>>'],
    ['vector<integer^3>', 'list<number>'],
    ['vector<integer>', 'list<integer>'],
    ['list<integer>', 'vector<integer>'],
  ])('%s is a %s', (a, b) => {
    expect(sub(a, b)).toBe(true);
  });

  test('a union of a list of vectors and a list of numbers keeps both arms', () => {
    // Neither arm absorbs the other, so the union reduction keeps both and
    // a value of either arm is a value of the union.
    const u = reduceType({
      kind: 'union',
      types: [parseType('list<vector<integer^3>>'), parseType('list<integer>')],
    });
    expect(typeToString(u)).toBe('list<integer> | list<vector<integer^3>>');
    expect(isSubtype(parseType('matrix<integer^(2x3)>'), u)).toBe(true);
    expect(isSubtype(parseType('vector<integer^2>'), u)).toBe(true);
  });
});

describe('a collection reads the elements of a tensor as its rows', () => {
  test('a 2×2×2 tensor is a list of 2×2 matrices, and a collection of them', () => {
    expect(sub('tensor<integer^(2x2x2)>', 'list<matrix<integer^(2x2)>>')).toBe(
      true
    );
    expect(
      sub('tensor<integer^(2x2x2)>', 'collection<matrix<integer^(2x2)>>')
    ).toBe(true);
    expect(
      sub(
        'tensor<integer^(2x2x2)>',
        'indexed_collection<matrix<integer^(2x2)>>'
      )
    ).toBe(true);
    expect(
      typesOverlap(
        parseType('collection<matrix<integer^(2x2)>>'),
        parseType('tensor<integer^(2x2x2)>')
      )
    ).toBe(true);
  });

  test('a tensor is not a collection of rows of another shape', () => {
    expect(
      sub('tensor<integer^(2x2x2)>', 'collection<matrix<integer^(3x3)>>')
    ).toBe(false);
    expect(
      sub('tensor<integer^(2x2x2)>', 'collection<vector<integer^2>>')
    ).toBe(false);
  });
});

describe('the meet follows the readings', () => {
  // The witness is a value of both operands and must be a value of their
  // meet, whichever operand comes first.
  test.each([
    // A plain list of vectors beside a matrix: the meet is kept as an
    // intersection, and an integer matrix is in it.
    ['list<vector<integer>>', 'matrix<real>', 'matrix<integer^(2x2)>'],
    ['list<list<integer>>', 'matrix<real^(2x2)>', 'matrix<integer^(2x2)>'],
    // A `list<any>` holds every matrix, so the meet is the matrix type.
    ['list<any>', 'matrix<real>', 'matrix<integer^(2x2)>'],
    // A collection of integer vectors beside a matrix of numbers is a
    // matrix of integers.
    ['collection<vector<integer>>', 'matrix<number>', 'matrix<integer^(2x2)>'],
    ['list<list<number>>', 'list<vector<integer>>', 'matrix<integer^(2x2)>'],
    // A list of numbers and an open-length vector meet as the vector.
    ['vector<value>', 'list<integer>', 'vector<integer^2>'],
    ['vector<value>', 'collection<integer>', 'vector<integer^2>'],
    ['list<number^2>', 'list<integer>', 'vector<integer^2>'],
    ['list<unknown>', 'indexed_collection<boolean>', 'list<boolean^2>'],
    // A tensor of unknown rank beside a `list<any>` is the tensor; beside a
    // matrix it is the matrix with the cells met.
    ['tensor<integer>', 'list<any>', 'matrix<integer^(2x2)>'],
    ['tensor<integer>', 'matrix<real>', 'matrix<integer^(2x2)>'],
  ])('%s & %s holds %s', (a, b, w) => {
    expect(sub(w, a)).toBe(true);
    expect(sub(w, b)).toBe(true);
    expect(inMeet(a, b, w)).toBe(true);
    expect(inMeet(b, a, w)).toBe(true);
  });

  test('two plain lists meet elementwise, and the empty list is in both', () => {
    // `list<integer>` and `list<list<integer>>` share the empty list only:
    // the meet is `list<never>`, the type of `[]`.
    expect(meet('list<integer>', 'list<string>')).toBe('list<never>');
    expect(meet('list<integer>', 'list<list<integer>>')).toBe('list<never>');
    expect(meet('list<integer>', 'list<vector<integer>>')).toBe('list<never>');
  });

  test('a fixed length or a different rank gives an empty meet', () => {
    // A list of strings holds no list of integers of length 2, and a
    // rank-2 tensor is not a vector.
    expect(meet('list<string>', 'list<integer^2>')).toBe('never');
    expect(meet('matrix<any^(3x2)>', 'vector<any>')).toBe('never');
  });

  test('the meet of a list of vectors and a matrix is kept as written', () => {
    expect(meet('list<vector<integer>>', 'matrix<real>')).toBe(
      'list<vector<integer>> & matrix<real>'
    );
    expect(meet('list<any>', 'matrix<real>')).toBe('matrix<real>');
    expect(meet('collection<vector<integer>>', 'matrix<number>')).toBe(
      'matrix<integer>'
    );
  });

  test('an outer list with no dimensions of empty rows is not the empty list', () => {
    // `list<list<never^0>>` holds `[[], []]` (two empty rows), which a list
    // whose first axis has length 0 does not; the plain list is read by its
    // elements, so it is not a `vector<integer^0>`, the type of `[]` alone.
    const w = 'matrix<never^(2x0)>';
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
    // A list of 3×3 matrices and a `vector<unknown>` share the empty list
    // only: the meet holds it and is a subtype of both operands.
    const a = 'list<matrix<unknown^(3x3)>>';
    const b = 'vector<unknown>';
    expect(sub(a, b)).toBe(false);
    expect(sub(b, a)).toBe(false);
    const m = meetOf(a, b);
    expect(isSubtype(m, parseType(a))).toBe(true);
    expect(isSubtype(m, parseType(b))).toBe(true);
    expect(isSubtype(parseType('list<never>'), m)).toBe(true);
  });

  test('the elementwise meet applies to a list and an open-length vector', () => {
    // `list<E>` and `vector<U>` with an open length meet as
    // `vector<E & U>` (the two spellings denote the same values).
    expect(meet('list<number^2>', 'list<integer>')).toBe('vector<integer^2>');
    expect(meet('list<unknown>', 'indexed_collection<boolean>')).toBe(
      'list<boolean>'
    );
    expect(meet('vector<integer>', 'list<number>')).toBe('vector<integer>');
    expect(meet('vector<value>', 'list<integer>')).toBe('list<integer>');
  });
});
