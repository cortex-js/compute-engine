/**
 * The three readings of a list type (user decisions of 2026-10-21,
 * `docs/plans/2026-10-21-list-element-tensor-cell.md`):
 *
 * - `list<E>` holds ELEMENTS `E`: a matrix of integers is a
 *   `list<vector<integer>>`, never a `list<integer>`.
 * - `vector<U>`, `matrix<U>`, `list<U^n>` and `tensor<U^(…)>` are tensors
 *   whose CELLS are `U`; their elements are their rows.
 * - `tensor<U>` is a tensor of unknown rank whose cells are `U`.
 *
 * Option U of `docs/plans/2026-10-22-list-lengths-and-tensor-shapes.md`
 * (user decision of 2026-10-22): every head accepts every cell type that
 * cannot hold a list, and a `list` has one axis at most.
 *
 * This file pins the representation and its round trips, the parse errors
 * for a cell type that can be a list and for a list with two or more axes,
 * the element type, the subtype relation, the
 * meet and the join, and runs a corpus check for covariance, transitivity,
 * antisymmetry and the soundness of `narrow`.
 */
import { ComputeEngine } from '../../../src/compute-engine';
import { parseType } from '../../../src/common/type/parse';
import {
  cannotHoldAList,
  couldMatch,
  isSubtype,
  narrow,
  provablyDisjoint,
  widen,
} from '../../../src/common/type/subtype';
import { reduceType, typesOverlap } from '../../../src/common/type/reduce';
import {
  typeToDedupKey,
  typeToString,
} from '../../../src/common/type/serialize';
import { internType } from '../../../src/common/type/intern';
import {
  broadcastElementType,
  broadcastShapedResultType,
  cellTypeMayCarryDimensions,
  collectionElementType,
  staticCollectionDims,
} from '../../../src/common/type/utils';
import {
  listTensorRank,
  type FunctionSignature,
  type Type,
} from '../../../src/common/type/types';
import { inferTypeArguments } from '../../../src/common/type/instantiate';
import { cellTypeCanHoldANumber } from '../../../src/common/type/primitive';
import { conditionalTargetInstance } from '../../../src/common/type/conditional-conformance';
import { ComputeEngine } from '../../../src/compute-engine';
import { executeEpsil } from '../../../src/epsil/execute-epsil';

const t = (s: string): Type => parseType(s);
const str = (x: Type): string => typeToString(x);
const sub = (a: string, b: string): boolean => isSubtype(t(a), t(b));
const meet = (a: string, b: string): string =>
  str(reduceType({ kind: 'intersection', types: [t(a), t(b)] }));
const nrw = (a: string, b: string): string => str(narrow(t(a), t(b)));

describe('REPRESENTATION (section 3.1)', () => {
  test('a plain list has no dimensions', () => {
    const x = t('list<number>') as Exclude<Type, string>;
    expect(x).toEqual({ kind: 'list', elements: 'number' });
    expect(listTensorRank(x as never)).toBeUndefined();
  });

  test('a tensor with a dimension list stores its axes', () => {
    expect(t('vector<integer>')).toEqual({
      kind: 'list',
      elements: 'integer',
      dimensions: [-1],
    });
    expect(t('matrix<2x3>')).toEqual({
      kind: 'list',
      elements: 'number',
      dimensions: [2, 3],
    });
    expect(listTensorRank(t('tensor<integer^(2x3x4)>') as never)).toBe(3);
  });

  test('tensor and tensor<U> store null dimensions', () => {
    expect(t('tensor')).toEqual({
      kind: 'list',
      elements: 'number',
      dimensions: null,
    });
    expect(t('tensor<integer>')).toEqual({
      kind: 'list',
      elements: 'integer',
      dimensions: null,
    });
    expect(listTensorRank(t('tensor') as never)).toBeUndefined();
  });

  test.each([
    'tensor',
    'tensor<integer>',
    'tensor<real<0..1>>',
    'list<number>',
    'list<integer>',
    'list<list<integer>>',
    'list<vector<integer>>',
    'list<boolean>',
    'list<string>',
    'vector',
    'vector<3>',
    'vector<integer>',
    'vector<integer^3>',
    'vector<any>',
    'vector<value>',
    'matrix',
    'matrix<2x3>',
    'matrix<integer>',
    'matrix<integer^(2x3)>',
    'matrix<integer^(2x?)>',
    'tensor<integer^(2x3x4)>',
    'tensor<integer^(2x?x4)>',
    'tensor<any^(2x2x2)>',
    'broadcastable<number>',
    'broadcastable<boolean>',
    'collection<vector<integer>>',
    'tensor<boolean>',
    'tensor<tuple<number, number>>',
    'tensor<string>',
    'tensor<integer | missing>',
  ])('round trip of %s', (s) => {
    const parsed = t(s);
    const spelled = str(parsed);
    expect(parseType(spelled)).toEqual(parsed);
  });

  test('the spelling of each form', () => {
    expect(str(t('tensor'))).toBe('tensor');
    expect(str(t('tensor<integer>'))).toBe('tensor<integer>');
    expect(str(t('list<number>'))).toBe('list<number>');
    expect(str(t('vector<number>'))).toBe('vector');
    expect(str(t('matrix<number^(2x3)>'))).toBe('matrix<2x3>');
    expect(str(t('list<integer^3>'))).toBe('vector<integer^3>');
    expect(str(t('matrix<integer^(2x3)>'))).toBe('matrix<integer^(2x3)>');
    // At rank 1, a fixed length with a cell type that is not a numeric
    // name keeps the `list` head. Rank 2 is always `matrix`.
    expect(str(t('list<unknown^2>'))).toBe('list<unknown^2>');
    expect(str(t('matrix<any^(2x2)>'))).toBe('matrix<any^(2x2)>');
    expect(str(t('vector<any>'))).toBe('vector<any>');
  });

  test('a plain list, a vector and a tensor of unknown rank are distinct', () => {
    const spellings = ['list<number>', 'vector<number>', 'tensor'].map((s) =>
      str(reduceType(t(s)))
    );
    expect(new Set(spellings).size).toBe(3);
  });
});

describe('EVERY HEAD TAKES THE SAME CELLS (option U)', () => {
  // User decision of 2026-10-22 (option U of
  // `docs/plans/2026-10-22-list-lengths-and-tensor-shapes.md`): `vector<U>`
  // and `matrix<U>` accept every cell type that cannot hold a list, as
  // `tensor<U>` and `list<U^n>` do. Until then a `vector` or `matrix` cell
  // had to be able to hold a number. A rank-1 list whose cells cannot hold
  // a number prints with the `list` head; rank 2 prints with `matrix`.
  test.each([
    ['vector<string>', 'list<string^?>'],
    ['vector<boolean>', 'list<boolean^?>'],
    ['vector<string^3>', 'list<string^3>'],
    ['matrix<string^(2x2)>', 'matrix<string^(2x2)>'],
    ['vector<tuple<number, number>>', 'list<tuple<number, number>^?>'],
    ['vector<symbol>', 'list<symbol^?>'],
    ['vector<"a" | "b">', 'list<"a" | "b"^?>'],
    ['matrix<boolean>', 'matrix<boolean>'],
  ])('%s is accepted and prints as %s', (s, printed) => {
    const parsed = t(s);
    expect(str(parsed)).toBe(printed);
    expect(parseType(printed)).toEqual(parsed);
  });

  test('a matrix of booleans is not a numeric matrix: Determinant refuses it', () => {
    // The bare names keep number cells, and the linear-algebra signatures
    // use the bare names, so accepting `matrix<boolean>` as a type does not
    // make a matrix of booleans an operand of `Determinant`.
    const ce = new ComputeEngine();
    expect(isSubtype(t('matrix<boolean>'), t('matrix'))).toBe(false);
    const det = ce.box([
      'Determinant',
      ['List', ['List', 'True', 'False'], ['List', 'False', 'True']],
    ]);
    expect(det.isValid).toBe(false);
    expect(JSON.stringify(det.json)).toContain(
      `["ErrorCode","'incompatible-type'","'matrix'","'matrix<boolean^(2x2)>'"]`
    );
  });

  // The cells of a named head cannot be lists either, even when they can
  // also hold a number: the shape is spelled in one place.
  test.each([
    ['matrix<list<integer>>', 'matrix'],
    ['vector<integer | list>', 'vector'],
    ['vector<integer | list<integer>>', 'vector'],
    ['matrix<integer | list<integer>>', 'matrix'],
    ['tensor<integer | list>', 'tensor'],
    ['tensor<list<integer>>', 'tensor'],
    ['tensor<vector<integer>>', 'tensor'],
    ['list<(integer | list<integer>)^3>', 'list with a length'],
  ])('%s is a parse error: its cells can be lists', (s, head) => {
    expect(() => t(s)).toThrow(`The cells of a ${head} cannot be lists`);
  });

  // `tensor<U>` accepts every cell type that `list<U^dims>` accepts: a type
  // that cannot hold a list.
  test.each([
    'tensor<boolean>',
    'tensor<string>',
    'tensor<tuple<number, number>>',
    'tensor<integer | missing>',
    'tensor<value>',
  ])('%s parses as a tensor of unknown rank', (s) => {
    expect(t(s)).toMatchObject({ kind: 'list', dimensions: null });
  });

  test('a list with two or more axes is refused, and the error names the matrix or tensor spelling', () => {
    // A list has one axis at most, its length. The message is never empty:
    // it says how many axes the type has and which spelling to write.
    expect(() => t('list<boolean^(2x2)>')).toThrow(
      'A list type has one axis at most, its length (`list<T^n>`), but this type has 2 axes. Write `matrix<boolean^(2x2)>` instead'
    );
    expect(() => t('list<integer^2x3>')).toThrow(
      'Write `matrix<integer^(2x3)>` instead'
    );
    expect(() => t('list<string^(2x3x4)>')).toThrow(
      'this type has 3 axes. Write `tensor<string^(2x3x4)>` instead'
    );
    expect(() => t('list<integer^(2x?x3)>')).toThrow(
      'Write `tensor<integer^(2x?x3)>` instead'
    );
    // Numbers have the short form; a leading shape is refused too.
    expect(() => t('list<number^(2x3)>')).toThrow(
      'Write `matrix<2x3>` instead'
    );
    expect(() => t('list<2x3>')).toThrow('Write `matrix<any^(2x3)>` instead');
    // Dimension variables.
    expect(() => parseType('(x: list<T^(MxN)>) -> T where T, M, N')).toThrow(
      'Write `matrix<T^(MxN)>` instead'
    );
    // One axis is a list with a length, and stays valid.
    expect(str(t('list<integer^3>'))).toBe('vector<integer^3>');
    expect(str(t('list<boolean^3>'))).toBe('list<boolean^3>');
  });

  test('a list with a length whose cells are lists is refused, and the error names the spelling with one shape', () => {
    expect(() => t('list<list<integer^3>^2>')).toThrow(
      'Write `matrix<integer^(2x3)>`, with the shape in one place'
    );
    expect(() => t('matrix<vector<integer^3>^(2x2)>')).toThrow(
      'Write `tensor<integer^(2x2x3)>`, with the shape in one place'
    );
    expect(() => t('matrix<list<integer>>')).toThrow(
      'The cells of a matrix cannot be lists'
    );
  });

  test('a cell that is a plain list is advised as nested lists, a cell with a length or a shape as one shape', () => {
    // A plain list admits rows of different lengths, so a rectangular
    // spelling such as `matrix<integer^(2x?)>` would refuse values that the
    // written type allows.
    expect(() => t('list<list<integer>^2>')).toThrow(
      'Write `list<list<integer>>` for rows of any lengths'
    );
    expect(() => t('list<vector<integer>^2>')).toThrow(
      'Write `matrix<integer^(2x?)>`, with the shape in one place'
    );
    expect(() => t('list<list<integer^3>^2>')).toThrow(
      'Write `matrix<integer^(2x3)>`, with the shape in one place'
    );
  });

  // A `^` with no dimension after it, or an empty group `^()`, is a parse
  // error for every head. It was dropped before, so `tensor<integer^>` was a
  // tensor of unknown rank and `list<number^>` a plain list.
  test.each([
    'list<number^>',
    'list<number^()>',
    'vector<integer^>',
    'vector<integer^()>',
    'matrix<integer^>',
    'matrix<integer^()>',
    'tensor<integer^>',
    'tensor<integer^()>',
  ])('%s is a parse error: a ^ needs a dimension', (s) => {
    expect(() => t(s)).toThrow(
      'Expected a positive integer, `?` or a dimension variable after ^'
    );
  });

  test('a matrix shape with other than two axes is refused, and the error names the spelling the printer gives', () => {
    expect(() => t('matrix<integer^(2x3x4)>')).toThrow(
      'A matrix type has two axes, but this type has 3 axes. Write `tensor<integer^(2x3x4)>` instead'
    );
    expect(() => t('matrix<integer^3>')).toThrow(
      'A matrix type has two axes, but this type has 1 axis. Write `vector<integer^3>` instead'
    );
    expect(() => t('matrix<2x3x4>')).toThrow(
      'Write `tensor<number^(2x3x4)>` instead'
    );
    expect(() => t('matrix<3>')).toThrow('Write `vector<3>` instead');
    // With declared dimension variables the axis count is checked too.
    expect(() => parseType('(x: matrix<T^N>) -> T where T, N')).toThrow(
      'this type has 1 axis. Write `vector<T^N>` instead'
    );
    // A dimension that names an undeclared variable reports that variable
    // first: `Mxidx` is one name, not `M x idx`.
    expect(() =>
      parseType('(x: matrix<T^(Mxidx)>) -> T where T, M, idx')
    ).toThrow('`Mxidx` is not quantified');
    // The advised spellings parse.
    expect(str(t('tensor<integer^(2x3x4)>'))).toBe('tensor<integer^(2x3x4)>');
    expect(str(t('vector<integer^3>'))).toBe('vector<integer^3>');
  });

  test('a tensor has no leading shape: a numeral after `<` is a literal cell type', () => {
    // `tensor<0>` is an array of zeros of any rank, so `tensor<2x3x4>` cannot
    // be read as a shape; the error names the spelling to use.
    expect(t('tensor<0>')).toEqual({
      kind: 'list',
      elements: { kind: 'value', value: 0 },
      dimensions: null,
    });
    expect(() => t('tensor<2x3x4>')).toThrow('tensor<number^(2x3x4)>');
    expect(() => t('tensor<2x3>')).toThrow('no leading shape');
    expect(str(t('tensor<number^(2x3x4)>'))).toBe('tensor<number^(2x3x4)>');
    // A type variable after `<` is still the cell type.
    expect(str(parseType('(x: tensor<T>) -> T where T'))).toBe(
      '(x: tensor<T>) -> T where T'
    );
  });

  test.each([
    'vector<any>',
    'vector<unknown>',
    'vector<never>',
    'vector<value>',
    'vector<expression>',
    'vector<scalar>',
    'matrix<integer | string>',
    'tensor<!string>',
    'vector<real<0..1>>',
    'vector<expression<Add>>',
  ])('%s is accepted', (s) => {
    expect(() => t(s)).not.toThrow();
  });

  // The Epsil parser checks the parameter annotations of a definition
  // before it parses the definition's `where` clause, and its type resolver
  // returns a name that the clause binds as the name itself (the string
  // `'T'`), not as a type variable node. Such a name says nothing about the
  // cells, so it is accepted, as the variable node of `parseType` with the
  // clause is.
  test('a clause variable that the resolver returns by name is a cell type that can hold a number', () => {
    expect(cellTypeCanHoldANumber('T' as Type)).toBe(true);
    expect(cellTypeMayCarryDimensions('T' as Type)).toBe(true);
    expect(cellTypeCanHoldANumber('string')).toBe(false);
    expect(cellTypeCanHoldANumber('boolean')).toBe(false);
  });

  test.each([
    'function mm(a: matrix<T^(MxN)>, b: matrix<T^(NxP)>) -> matrix<T^(MxP)> where T, M, N, P { a }',
    'function vv(a: vector<T>) -> T where T { a[1] }',
    'function tt(a: tensor<T>) -> tensor<T> where T { a }',
    'function dot(a: vector<real^N>, b: vector<real^N>) -> real where N { 0 }',
  ])('the Epsil definition %s has no diagnostic', (source) => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, source).diagnostics).toEqual([]);
  });

  test('a generic matrix function defined in Epsil applies to a matrix', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function mm(a: matrix<T^(MxN)>, b: matrix<T^(NxP)>) -> matrix<T^(MxP)> where T, M, N, P { a }\nmm([[1, 2], [3, 4]], [[1], [2]])'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('[[1,2],[3,4]]');
  });

  test('a non-numeric cell type is accepted on the Epsil route', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(
        ce,
        'function ok(a: vector<string>, b: matrix<boolean>) -> string { "x" }'
      ).diagnostics
    ).toEqual([]);
  });

  test('a list with two axes is refused on the Epsil route, with the message', () => {
    const ce = new ComputeEngine();
    const messages = executeEpsil(
      ce,
      'function bad(a: list<boolean^(2x2)>) -> string { "x" }'
    ).diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message.join(' ') : String(d.message)
    );
    expect(messages.join('\n')).toContain(
      'but this type has 2 axes. Write `matrix<boolean^(2x2)>` instead'
    );
  });
});

describe('CONDITIONAL CONFORMANCE BINDS THE ELEMENTS OF A PLAIN LIST PATTERN', () => {
  // The instantiated head of a conditional conformance whose head is
  // `head` and whose clause binds `T`, at a receiver of type `subject`, or
  // `null` when the head does not match. Every conformance question is
  // answered `true`, so only the match is tested.
  const instance = (head: string, subject: string): string | null => {
    const T = { name: 'T' };
    const r = conditionalTargetInstance(
      parseType(head, undefined, [T]),
      [T],
      t(subject),
      () => true
    );
    return r === null ? null : str(r);
  };

  test('`list<T>` binds the elements: the rows of a tensor of rank 2 or more', () => {
    // `[["a"], ["b"]]` types `matrix<string^(2x1)>`: its elements are
    // `list<string^1>`, not its cells `string`.
    expect(instance('list<T>', 'matrix<string^(2x1)>')).toBe(
      'list<list<string^1>>'
    );
    expect(instance('list<T>', 'list<string^2>')).toBe('list<string>');
    expect(instance('list<T>', 'list<list<string>>')).toBe(
      'list<list<string>>'
    );
    expect(instance('list<T>', 'tensor<integer>')).toBe(
      'list<integer | tensor<integer>>'
    );
  });

  test('a tensor pattern binds the cells of a receiver whose shape fits it', () => {
    expect(instance('tensor<T>', 'matrix<integer^(2x2)>')).toBe(
      'tensor<integer>'
    );
    expect(instance('tensor<T>', 'tensor<real>')).toBe('tensor<real>');
    expect(instance('tensor<T>', 'list<integer>')).toBe('tensor<integer>');
    expect(instance('matrix<T>', 'matrix<integer^(2x2)>')).toBe(
      'matrix<integer>'
    );
    expect(instance('vector<T>', 'vector<integer^3>')).toBe('vector<integer>');
    // A plain list of numbers is a vector with an open length.
    expect(instance('vector<T>', 'list<integer>')).toBe('vector<integer>');
    // A shape that does not fit, or a rank that is not known.
    expect(instance('matrix<T>', 'vector<integer>')).toBeNull();
    expect(instance('matrix<T>', 'tensor<integer>')).toBeNull();
  });

  test('a plain list fits a tensor pattern only where the subtype relation says so', () => {
    // A `list<string>` is not a vector, and a `list<list<integer>>` or a
    // `list<any>` is not a tensor (its elements can be lists).
    expect(instance('vector<T>', 'list<string>')).toBeNull();
    expect(instance('vector<T>', 'list<any>')).toBeNull();
    expect(instance('tensor<T>', 'list<list<integer>>')).toBeNull();
    expect(instance('tensor<T>', 'list<any>')).toBeNull();
    // A list of booleans is a rank-1 tensor of booleans.
    expect(instance('tensor<T>', 'list<boolean>')).toBe('tensor<boolean>');
    // Every admitted instance is a supertype of the receiver.
    for (const [head, subject] of [
      ['tensor<T>', 'list<boolean>'],
      ['tensor<T>', 'list<integer>'],
      ['vector<T>', 'list<integer>'],
      ['tensor<T>', 'matrix<integer^(2x2)>'],
    ])
      expect(sub(subject, instance(head, subject)!)).toBe(true);
  });
});

describe('THE CELLS OF A LIST WITH DIMENSIONS CANNOT BE LISTS', () => {
  test.each([
    'list<boolean^2>',
    'list<string^2>',
    'matrix<boolean^(2x2)>',
    'list<tuple<number, number>^3>',
    'matrix<string^(2x2)>',
    'list<symbol^2>',
    'list<record{a: integer}^2>',
    'list<set<integer>^2>',
    'list<integer | string^2>',
    'tensor<any^(2x2x2)>',
    'list<unknown^2>',
    'list<never^2>',
  ])('%s parses', (s) => {
    expect(() => t(s)).not.toThrow();
  });

  test('the parsed form of a dimensioned list of non-numbers', () => {
    expect(t('list<boolean^2>')).toEqual({
      kind: 'list',
      elements: 'boolean',
      dimensions: [2],
    });
    expect(t('matrix<boolean^(2x2)>')).toEqual({
      kind: 'list',
      elements: 'boolean',
      dimensions: [2, 2],
    });
  });

  test.each([
    'list<list<integer>^2>',
    'list<list<number^2>^3>',
    'list<vector<3>^2>',
    'list<collection<integer>^2>',
    'list<indexed_collection<integer>^2>',
    'list<broadcastable<number>^2>',
    'list<list^2>',
    'list<range^2>',
    'list<(integer | list<integer>)^2>',
  ])('%s is a parse error', (s) => {
    expect(() => t(s)).toThrow(/cells of a list with a length cannot be lists/);
    // The message names a spelling to write: nested plain lists when the
    // cell is a plain list (`list<list<integer>>`), the merged shape when it
    // can be read (`matrix<integer^(2x?)>`), else the example
    // `matrix<T^(2x3)>`.
    expect(() => t(s)).toThrow(/`(matrix|list)</);
  });

  test('cellTypeMayCarryDimensions is the one predicate', () => {
    expect(cellTypeMayCarryDimensions('boolean')).toBe(true);
    expect(cellTypeMayCarryDimensions('string')).toBe(true);
    expect(cellTypeMayCarryDimensions('any')).toBe(true);
    expect(cellTypeMayCarryDimensions('never')).toBe(true);
    expect(cellTypeMayCarryDimensions('value')).toBe(true);
    expect(cellTypeMayCarryDimensions(t('tuple<number, number>'))).toBe(true);
    expect(cellTypeMayCarryDimensions('list')).toBe(false);
    expect(cellTypeMayCarryDimensions('collection')).toBe(false);
    expect(cellTypeMayCarryDimensions('range')).toBe(false);
    expect(cellTypeMayCarryDimensions(t('list<integer>'))).toBe(false);
    expect(cellTypeMayCarryDimensions(t('tensor'))).toBe(false);
    expect(cellTypeMayCarryDimensions(t('broadcastable<number>'))).toBe(false);
    expect(cellTypeMayCarryDimensions(t('integer | list<integer>'))).toBe(
      false
    );
  });

  test('the serializer keeps the list head for non-numeric cells at rank 1', () => {
    expect(str(t('list<boolean^2>'))).toBe('list<boolean^2>');
    expect(str(t('matrix<boolean^(2x2)>'))).toBe('matrix<boolean^(2x2)>');
    expect(str(t('list<tuple<number, number>^3>'))).toBe(
      'list<tuple<number, number>^3>'
    );
    // An all-open rank 1 with non-numeric cells is spelled with `?`, which
    // parses back to the same shape. An all-open rank 2 is `matrix<U>`,
    // for every cell type that cannot hold a list.
    const openRow: Type = {
      kind: 'list',
      elements: 'boolean',
      dimensions: [-1],
    };
    expect(str(openRow)).toBe('list<boolean^?>');
    expect(parseType(str(openRow))).toEqual(openRow);
    const openMatrix: Type = {
      kind: 'list',
      elements: 'boolean',
      dimensions: [-1, -1],
    };
    expect(str(openMatrix)).toBe('matrix<boolean>');
    expect(parseType(str(openMatrix))).toEqual(openMatrix);
    // A tensor of unknown rank with non-numeric cells is spelled
    // `tensor<boolean>`, which parses back to it.
    const unknownRank: Type = {
      kind: 'list',
      elements: 'boolean',
      dimensions: null,
    };
    expect(str(unknownRank)).toBe('tensor<boolean>');
    expect(parseType(str(unknownRank))).toEqual(unknownRank);
  });

  test('a tensor of unknown rank and the plain list of its cells have different interning keys', () => {
    // `internType` keys a type by its spelling, so a tensor of unknown rank
    // that printed as the plain list of its cells was replaced by that list.
    for (const cells of ['boolean', 'integer', 'string'] as const) {
      const tensor: Type = { kind: 'list', elements: cells, dimensions: null };
      const plain: Type = { kind: 'list', elements: cells };
      const interned = internType(plain);
      expect(internType(tensor)).not.toBe(interned);
      expect(internType(tensor)).toEqual(tensor);
      expect(typeToDedupKey(tensor)).not.toBe(typeToDedupKey(plain));
    }
    // A cell type that the parser refuses still has a key of its own.
    const listCells: Type = {
      kind: 'list',
      elements: { kind: 'list', elements: 'integer' },
      dimensions: null,
    };
    expect(str(listCells)).toBe('tensor<list<integer>>');
  });

  test('a type variable and a reference are accepted as cells', () => {
    expect(() => t('(vector<T^N>) -> T where T, N')).not.toThrow();
    expect(() => t('(matrix<T>) -> T where T')).not.toThrow();
  });

  test('broadcastable keeps its node for a non-numeric type', () => {
    expect(t('broadcastable<boolean>')).toEqual({
      kind: 'broadcastable',
      elements: 'boolean',
    });
    expect(t('broadcastable<tuple<number, number>>')).toMatchObject({
      kind: 'broadcastable',
    });
  });
});

describe('ELEMENT TYPE (section 3.2)', () => {
  const el = (s: string): string => str(collectionElementType(t(s))!);
  test('list<E> yields E', () => {
    expect(el('list<integer>')).toBe('integer');
    expect(el('list<list<integer>>')).toBe('list<integer>');
    expect(el('list<boolean>')).toBe('boolean');
  });
  test('a rank-1 tensor yields its cells', () => {
    expect(el('vector<integer>')).toBe('integer');
    expect(el('vector<3>')).toBe('number');
  });
  test('a tensor of rank 2 or more yields its rows', () => {
    expect(el('matrix<integer>')).toBe('vector<integer>');
    expect(el('matrix<integer^(2x3)>')).toBe('vector<integer^3>');
    expect(el('tensor<integer^(2x3x4)>')).toBe('matrix<integer^(3x4)>');
  });
  test('tensor<U> yields U | tensor<U>', () => {
    expect(el('tensor<integer>')).toBe('integer | tensor<integer>');
    expect(el('tensor')).toBe('number | tensor');
  });
  test('set<E> yields E', () => {
    expect(el('set<integer>')).toBe('integer');
  });
  test('broadcastable<T> yields T | tensor<T> when T cannot hold a list, T otherwise', () => {
    expect(el('broadcastable<number>')).toBe('number | tensor');
    expect(el('broadcastable<integer>')).toBe('integer | tensor<integer>');
    // The collection arm of `broadcastable<boolean>` is `tensor<boolean>`
    // since the rule change of 2026-10-22 (it was `list<boolean>`).
    expect(el('broadcastable<boolean>')).toBe('boolean | tensor<boolean>');
    expect(el('broadcastable<tuple<number, number>>')).toBe(
      'tensor<tuple<number, number>> | tuple<number, number>'
    );
    expect(el('broadcastable<any>')).toBe('any');
  });
  test('the tuple branch keeps the unknown arm beside markers', () => {
    expect(el('tuple<unknown, missing>')).toBe('missing | unknown');
  });
});

describe('SUBTYPE (section 3.3)', () => {
  describe('lists with no dimensions', () => {
    test('list<E1> <: list<E2> iff E1 <: E2', () => {
      expect(sub('list<integer>', 'list<number>')).toBe(true);
      expect(sub('list<number>', 'list<integer>')).toBe(false);
      expect(sub('list<integer>', 'list<list<integer>>')).toBe(false);
      expect(sub('list<list<integer>>', 'list<integer>')).toBe(false);
      expect(sub('list<list<integer>>', 'list<list<number>>')).toBe(true);
    });
    test('list<E> <: collection<F>, indexed_collection<F> iff E <: F', () => {
      expect(sub('list<integer>', 'collection<number>')).toBe(true);
      expect(sub('list<integer>', 'indexed_collection<number>')).toBe(true);
      expect(sub('list<list<integer>>', 'collection<number>')).toBe(false);
      expect(sub('list<list<integer>>', 'collection<list<number>>')).toBe(true);
    });
    test('list<E> <: vector<U> (open length) iff E <: U, E numeric (decision D5)', () => {
      expect(sub('list<integer>', 'vector<number>')).toBe(true);
      expect(sub('list<integer>', 'vector<integer>')).toBe(true);
      expect(sub('list<integer>', 'vector<any>')).toBe(true);
      expect(sub('vector<integer>', 'list<integer>')).toBe(true);
      // A `list<value>` holds matrices, which a rank-1 `vector<value>` does
      // not: the rule is for lists of numbers.
      expect(sub('list<value>', 'vector<value>')).toBe(false);
      expect(sub('list<any>', 'vector<any>')).toBe(false);
      expect(sub('list<integer>', 'vector<3>')).toBe(false);
      expect(sub('list<integer>', 'vector<integer^3>')).toBe(false);
      expect(sub('list<integer>', 'matrix<integer>')).toBe(false);
      expect(sub('list<list<integer>>', 'matrix<integer>')).toBe(false);
      expect(sub('list<vector<integer>>', 'matrix<integer>')).toBe(false);
      expect(sub('list<string>', 'vector<number>')).toBe(false);
    });
    test('list<E> <: tensor<U> iff E <: U and E cannot hold a list', () => {
      expect(sub('list<integer>', 'tensor')).toBe(true);
      expect(sub('list<integer>', 'tensor<integer>')).toBe(true);
      expect(sub('list<integer>', 'tensor<any>')).toBe(true);
      expect(sub('list<real>', 'tensor<integer>')).toBe(false);
      expect(sub('list<list<integer>>', 'tensor')).toBe(false);
      expect(sub('list<string>', 'tensor')).toBe(false);
      expect(sub('list<boolean>', 'tensor<boolean>')).toBe(true);
      expect(sub('list<string>', 'tensor<string>')).toBe(true);
      expect(
        sub('list<tuple<number, number>>', 'tensor<tuple<number, number>>')
      ).toBe(true);
      expect(sub('list<integer | missing>', 'tensor<integer | missing>')).toBe(
        true
      );
      expect(sub('matrix<boolean^(2x2)>', 'tensor<boolean>')).toBe(true);
      expect(sub('list<list<boolean>>', 'tensor<boolean>')).toBe(false);
      // A `list<value>` holds lists of matrices, which are not cells of a
      // `tensor<value>`: a non-numeric element type is not read at rank 1.
      expect(sub('list<value>', 'tensor<value>')).toBe(false);
      expect(sub('list<any>', 'tensor<any>')).toBe(false);
    });
    test('the empty list fits a zero-length or open-length axis', () => {
      expect(sub('list<never>', 'vector<integer^0>')).toBe(true);
      expect(sub('list<never>', 'vector<integer>')).toBe(true);
      expect(sub('list<never>', 'matrix<integer^(0x2)>')).toBe(true);
      expect(sub('list<never>', 'vector<integer^3>')).toBe(false);
    });
  });

  describe('tensors with a dimension list', () => {
    test('same rank, cells covariant, each axis open or equal', () => {
      expect(sub('matrix<integer^(2x2)>', 'matrix<integer>')).toBe(true);
      expect(sub('matrix<integer^(2x2)>', 'matrix<number^(2x?)>')).toBe(true);
      expect(sub('matrix<integer>', 'matrix<integer^(2x2)>')).toBe(false);
      expect(sub('matrix<integer^(2x2)>', 'matrix<integer^(3x2)>')).toBe(false);
      expect(sub('matrix<number>', 'matrix<integer>')).toBe(false);
      expect(sub('vector<integer^3>', 'matrix<integer>')).toBe(false);
      expect(sub('matrix<integer>', 'vector<integer>')).toBe(false);
      expect(sub('tensor<integer^(2x3x4)>', 'tensor<number^(2x?x4)>')).toBe(
        true
      );
    });
    test('covariance is restored in the cells', () => {
      expect(sub('vector<value>', 'vector<any>')).toBe(true);
      expect(sub('list<expression^3>', 'list<any^3>')).toBe(true);
      expect(sub('vector<integer>', 'vector<unknown>')).toBe(true);
      expect(sub('matrix<integer>', 'matrix<any>')).toBe(true);
    });
    test('a tensor fits tensor<V> iff its cells are V', () => {
      expect(sub('matrix<integer>', 'tensor')).toBe(true);
      expect(sub('vector<integer^3>', 'tensor<integer>')).toBe(true);
      expect(sub('tensor<integer^(2x3x4)>', 'tensor<real>')).toBe(true);
      expect(sub('matrix<real>', 'tensor<integer>')).toBe(false);
    });
    test('a tensor fits list<E> iff its rows are E', () => {
      expect(sub('matrix<integer>', 'list<vector<integer>>')).toBe(true);
      expect(sub('matrix<integer>', 'list<list<integer>>')).toBe(true);
      expect(sub('matrix<integer>', 'list<vector<number>>')).toBe(true);
      expect(sub('matrix<integer>', 'list<integer>')).toBe(false);
      expect(sub('matrix<integer>', 'list<number>')).toBe(false);
      expect(sub('vector<integer>', 'list<integer>')).toBe(true);
      expect(sub('vector<integer^3>', 'list<number>')).toBe(true);
      expect(sub('matrix<integer^(2x3)>', 'list<vector<integer^3>>')).toBe(
        true
      );
      expect(sub('matrix<integer^(2x3)>', 'list<vector<integer^2>>')).toBe(
        false
      );
      expect(
        sub('tensor<integer^(2x3x4)>', 'list<matrix<integer^(3x4)>>')
      ).toBe(true);
      expect(sub('tensor<integer^(2x3x4)>', 'list<list<list<integer>>>')).toBe(
        true
      );
    });
    test('a tensor fits collection<F> iff its rows are F', () => {
      expect(sub('matrix<integer>', 'collection<vector<integer>>')).toBe(true);
      expect(sub('matrix<integer>', 'indexed_collection<list<number>>')).toBe(
        true
      );
      expect(sub('matrix<integer>', 'collection<number>')).toBe(false);
      expect(sub('matrix<integer>', 'collection<any>')).toBe(true);
      expect(sub('vector<integer>', 'collection<number>')).toBe(true);
    });
    test('a tensor fits broadcastable<V> iff its cells are V', () => {
      expect(sub('matrix<integer>', 'broadcastable<number>')).toBe(true);
      expect(sub('vector<integer^3>', 'broadcastable<integer>')).toBe(true);
      expect(sub('tensor<integer^(2x3x4)>', 'broadcastable<real>')).toBe(true);
      expect(sub('matrix<real>', 'broadcastable<integer>')).toBe(false);
    });
  });

  describe('tensors of unknown rank', () => {
    test('tensor<U> <: tensor<V> iff U <: V', () => {
      expect(sub('tensor<integer>', 'tensor')).toBe(true);
      expect(sub('tensor', 'tensor<integer>')).toBe(false);
      expect(sub('tensor<integer>', 'tensor<integer>')).toBe(true);
    });
    test('tensor<U> <: list<E>, collection<E> iff U | tensor<U> <: E', () => {
      expect(sub('tensor<integer>', 'list<integer | tensor<integer>>')).toBe(
        true
      );
      expect(sub('tensor<integer>', 'list<number | tensor>')).toBe(true);
      expect(sub('tensor<integer>', 'list<any>')).toBe(true);
      expect(sub('tensor<integer>', 'list<integer>')).toBe(false);
      expect(sub('tensor<integer>', 'list<list<integer>>')).toBe(false);
      expect(
        sub('tensor<integer>', 'collection<integer | tensor<integer>>')
      ).toBe(true);
      expect(sub('tensor<integer>', 'collection<number>')).toBe(false);
      expect(sub('tensor<integer>', 'collection<any>')).toBe(true);
      expect(sub('tensor<integer>', 'indexed_collection<any>')).toBe(true);
    });
    test('tensor<U> never fits a tensor with a dimension list', () => {
      expect(sub('tensor<integer>', 'matrix<integer>')).toBe(false);
      expect(sub('tensor<integer>', 'vector<integer>')).toBe(false);
      expect(sub('tensor<integer>', 'tensor<any^(2x2x2)>')).toBe(false);
    });
    test('tensor<U> <: broadcastable<V> iff U <: V', () => {
      expect(sub('tensor<integer>', 'broadcastable<number>')).toBe(true);
      expect(sub('tensor', 'broadcastable<integer>')).toBe(false);
    });
  });

  describe('broadcastable (decision D4)', () => {
    test('broadcastable<T> is T | tensor<T> for a numeric T', () => {
      expect(sub('broadcastable<number>', 'number | tensor')).toBe(true);
      expect(sub('number | tensor', 'broadcastable<number>')).toBe(true);
      expect(sub('broadcastable<number>', 'number | list<number>')).toBe(false);
      expect(sub('list<integer>', 'broadcastable<number>')).toBe(true);
      expect(sub('list<list<integer>>', 'broadcastable<number>')).toBe(false);
      expect(sub('integer', 'broadcastable<number>')).toBe(true);
      expect(sub('broadcastable<integer>', 'broadcastable<number>')).toBe(true);
      expect(sub('broadcastable<number>', 'broadcastable<integer>')).toBe(
        false
      );
      // The collection arm is a tensor on both sides when neither element
      // type can hold a list (it was `list<integer | string>` on the right
      // before the rule change of 2026-10-22, and the answer was `false`).
      expect(
        sub('broadcastable<integer>', 'broadcastable<integer | string>')
      ).toBe(true);
      expect(
        sub('broadcastable<boolean>', 'broadcastable<boolean | string>')
      ).toBe(true);
      // The arm changes where the element type can hold a list: a
      // `broadcastable<integer>` holds tensors of rank 3, which a
      // `broadcastable<integer | list<integer>>` (a list of its elements)
      // does not.
      expect(
        sub('broadcastable<integer>', 'broadcastable<integer | list<integer>>')
      ).toBe(false);
      expect(sub('broadcastable<integer>', 'broadcastable<any>')).toBe(true);
    });
    test('broadcastable<T> is T | tensor<T> when T cannot hold a list', () => {
      expect(sub('list<boolean>', 'broadcastable<boolean>')).toBe(true);
      expect(sub('list<list<boolean>>', 'broadcastable<boolean>')).toBe(false);
      expect(sub('matrix<boolean^(2x2)>', 'broadcastable<boolean>')).toBe(true);
      expect(
        sub(
          'list<tuple<number, number>>',
          'broadcastable<tuple<number, number>>'
        )
      ).toBe(true);
      expect(sub('broadcastable<boolean>', 'boolean | tensor<boolean>')).toBe(
        true
      );
      expect(sub('boolean | tensor<boolean>', 'broadcastable<boolean>')).toBe(
        true
      );
      // Reversed by the rule change of 2026-10-22: a `broadcastable<boolean>`
      // holds matrices of booleans, which `list<boolean>` does not.
      expect(sub('broadcastable<boolean>', 'boolean | list<boolean>')).toBe(
        false
      );
      expect(sub('boolean | list<boolean>', 'broadcastable<boolean>')).toBe(
        true
      );
    });
    test('a cell type with a `missing` arm keeps the tensor arm', () => {
      expect(sub('matrix<integer>', 'broadcastable<integer | missing>')).toBe(
        true
      );
      expect(
        sub('broadcastable<integer>', 'broadcastable<integer | missing>')
      ).toBe(true);
      expect(
        sub(
          'matrix<(integer | missing)^(2x2)>',
          'broadcastable<integer | missing>'
        )
      ).toBe(true);
    });
    test('broadcastable<T> is T | list<T> when T can hold a list', () => {
      expect(sub('list<any>', 'broadcastable<any>')).toBe(true);
      expect(sub('list<value>', 'broadcastable<value>')).toBe(true);
      expect(sub('broadcastable<value>', 'value | list<value>')).toBe(true);
    });
    test('a tuple, a string and an abstract collection are not broadcastable', () => {
      expect(sub('tuple<number, number>', 'broadcastable<number>')).toBe(false);
      expect(sub('string', 'broadcastable<character>')).toBe(false);
      expect(sub('indexed_collection<number>', 'broadcastable<number>')).toBe(
        false
      );
    });
  });

  describe('overlap and couldMatch follow the meet', () => {
    test('typesOverlap', () => {
      // Two plain lists always share the empty list.
      expect(typesOverlap(t('list<integer>'), t('list<list<integer>>'))).toBe(
        true
      );
      expect(typesOverlap(t('list<integer>'), t('list<string>'))).toBe(true);
      expect(typesOverlap(t('tensor<integer>'), t('list<list<integer>>'))).toBe(
        true
      );
      // Two tensors of unknown rank share the empty list whatever their
      // cells.
      expect(typesOverlap(t('tensor<integer>'), t('tensor<string>'))).toBe(
        true
      );
      expect(typesOverlap(t('tensor<integer>'), t('list<string^?>'))).toBe(
        true
      );
      expect(typesOverlap(t('tensor<integer>'), t('list<string^3>'))).toBe(
        false
      );
      // The empty list is not a matrix.
      expect(typesOverlap(t('list<number>'), t('matrix<integer>'))).toBe(false);
      expect(typesOverlap(t('list<list<integer>>'), t('matrix<number>'))).toBe(
        true
      );
      // A rank-1 tensor with an open length admits the empty list.
      expect(typesOverlap(t('list<string>'), t('vector<integer>'))).toBe(true);
      expect(typesOverlap(t('list<string>'), t('vector<integer^3>'))).toBe(
        false
      );
      expect(typesOverlap(t('matrix<2x?>'), t('matrix<?x3>'))).toBe(true);
      expect(typesOverlap(t('matrix<2x2>'), t('matrix<3x3>'))).toBe(false);
      expect(typesOverlap(t('vector<integer^2>'), t('vector<integer^3>'))).toBe(
        false
      );
      expect(typesOverlap(t('matrix<integer>'), t('collection<number>'))).toBe(
        false
      );
      expect(
        typesOverlap(t('matrix<integer>'), t('collection<list<integer>>'))
      ).toBe(true);
    });
    test('couldMatch', () => {
      expect(couldMatch(t('list<integer>'), t('list<list<integer>>'))).toBe(
        true
      );
      expect(couldMatch(t('list<integer>'), t('list<string>'))).toBe(true);
      expect(couldMatch(t('tensor<integer>'), t('list<list<integer>>'))).toBe(
        true
      );
      expect(couldMatch(t('list<number>'), t('matrix<integer>'))).toBe(false);
      expect(couldMatch(t('list<list<integer>>'), t('matrix<number>'))).toBe(
        true
      );
      expect(couldMatch(t('list<integer>'), t('vector<number>'))).toBe(true);
      expect(couldMatch(t('list<string>'), t('vector<integer>'))).toBe(true);
      expect(couldMatch(t('list<string>'), t('vector<integer^3>'))).toBe(false);
      expect(couldMatch(t('vector<integer^2>'), t('vector<integer^3>'))).toBe(
        false
      );
      expect(couldMatch(t('vector<integer>'), t('vector<never>'))).toBe(true);
      expect(couldMatch(t('matrix<integer>'), t('broadcastable<number>'))).toBe(
        true
      );
    });
  });
});

describe('MEET AND JOIN (section 3.4)', () => {
  test('two plain lists meet elementwise; the empty list is in both', () => {
    expect(meet('list<integer>', 'list<real | string>')).toBe('list<integer>');
    expect(meet('list<integer>', 'list<string>')).toBe('list<never>');
    expect(meet('list<never>', 'list<integer>')).toBe('list<never>');
    expect(meet('list<integer>', 'list<list<integer>>')).toBe('list<never>');
    // Both collection arms are tensors since the rule change of 2026-10-22,
    // so the meet is a tensor whose cells meet to `never` (it holds `[]`
    // and `[[]]`); it was `list<never>` when the string arm was a list.
    expect(meet('broadcastable<integer>', 'broadcastable<string>')).toBe(
      'tensor<never>'
    );
  });
  test('two tensors meet cellwise with their axes met', () => {
    expect(meet('matrix<2x?>', 'matrix<?x3>')).toBe('matrix<2x3>');
    expect(meet('matrix<integer>', 'matrix<real^(2x2)>')).toBe(
      'matrix<integer^(2x2)>'
    );
    expect(meet('matrix<2x2>', 'matrix<3x3>')).toBe('never');
    expect(meet('vector<integer^2>', 'vector<integer^3>')).toBe('never');
    expect(meet('vector<integer>', 'matrix<integer>')).toBe('never');
    // An open axis admits the length 0, so a tensor of `never` cells holds
    // the empty list and the meet is not empty.
    expect(meet('vector<integer>', 'vector<never>')).toBe('vector<never>');
    // A ranged cell type is not a bare numeric name, so the spelling keeps
    // the `list` head, as before this change.
    expect(meet('vector<integer^2>', 'vector<real<0..1>^2>')).toBe(
      'list<integer<0..1>^2>'
    );
  });
  test('a plain list and a rank-1 tensor meet as the tensor (decision D5)', () => {
    expect(meet('list<integer>', 'vector<number>')).toBe('list<integer>');
    expect(meet('list<number>', 'vector<integer>')).toBe('vector<integer>');
    expect(meet('list<integer>', 'vector<3>')).toBe('vector<integer^3>');
    expect(meet('list<string>', 'vector<integer>')).toBe('vector<never>');
    expect(meet('list<string>', 'vector<integer^3>')).toBe('never');
  });
  test('tensors of unknown rank', () => {
    expect(meet('tensor<integer>', 'tensor<real>')).toBe('tensor<integer>');
    expect(meet('tensor<integer>', 'matrix<real>')).toBe('matrix<integer>');
    expect(meet('tensor<integer>', 'matrix<2x2>')).toBe(
      'matrix<integer^(2x2)>'
    );
    expect(meet('tensor<integer>', 'list<any>')).toBe('tensor<integer>');
    expect(meet('tensor<integer>', 'list<string>')).toBe('list<never>');
    expect(meet('tensor<integer>', 'list<list<integer>>')).toBe(
      'tensor<integer> & list<list<integer>>'
    );
  });
  test('a plain list and a tensor of rank 2 or more', () => {
    expect(meet('list<any>', 'matrix<real>')).toBe('matrix<real>');
    expect(meet('list<vector<real>>', 'matrix<integer>')).toBe(
      'matrix<integer>'
    );
    expect(meet('list<integer>', 'matrix<real>')).toBe('never');
    expect(meet('list<vector<integer>>', 'matrix<real>')).toBe(
      'list<vector<integer>> & matrix<real>'
    );
  });
  test('a tensor and a collection of a different kind', () => {
    expect(meet('matrix<number>', 'collection<vector<integer>>')).toBe(
      'matrix<integer>'
    );
    expect(meet('matrix<integer>', 'collection<number>')).toBe('never');
    expect(meet('vector<number>', 'collection<integer>')).toBe(
      'vector<integer>'
    );
  });
  test('a tensor of unknown rank and a collection', () => {
    // The elements of the tensor (a cell or a tensor) are all in `E`.
    expect(meet('tensor<integer>', 'collection<any>')).toBe('tensor<integer>');
    expect(meet('tensor', 'collection<integer | tensor<integer>>')).toBe(
      'tensor<integer>'
    );
    // `E` admits no tensor: only the rank-1 reading, lists of cells.
    expect(meet('tensor', 'indexed_collection<integer>')).toBe(
      'vector<integer>'
    );
    expect(meet('tensor<integer>', 'collection<string>')).toBe('list<never>');
    // `E` admits some tensors but not every sub-tensor: kept as written.
    expect(
      meet('tensor<integer>', 'collection<integer | matrix<integer>>')
    ).toBe('tensor<integer> & collection<integer | matrix<integer>>');
    // The rank-1 reading (cells `number & tensor<integer>`, empty) and the
    // higher-rank reading (rows `tensor<integer>`) give different cells:
    // the integer matrices are in both, so the meet is not `tensor<never>`.
    expect(meet('tensor<number>', 'collection<tensor<integer>>')).toBe(
      'tensor & collection<tensor<integer>>'
    );
    expect(sub('matrix<integer>', 'tensor<number>')).toBe(true);
    expect(sub('matrix<integer>', 'collection<tensor<integer>>')).toBe(true);
  });
  test('narrow answers as the reducer for the list pairs', () => {
    for (const [a, b] of [
      ['list<integer>', 'list<real | string>'],
      ['list<integer>', 'list<string>'],
      ['matrix<2x?>', 'matrix<?x3>'],
      ['matrix<2x2>', 'matrix<3x3>'],
      ['list<integer>', 'vector<number>'],
      ['list<number>', 'vector<integer>'],
      ['tensor<integer>', 'tensor<real>'],
      ['tensor<integer>', 'matrix<real>'],
      ['list<any>', 'matrix<real>'],
      ['list<integer>', 'matrix<real>'],
      ['tensor<integer>', 'list<string>'],
    ])
      expect([a, b, nrw(a, b)]).toEqual([a, b, meet(a, b)]);
  });
  test('the join of a tensor and a plain list is a plain list', () => {
    expect(str(widen(t('matrix<integer>'), t('list<string>')))).toBe(
      'list<string | vector<integer>>'
    );
    expect(str(widen(t('vector<integer>'), t('list<string>')))).toBe(
      'list<integer | string>'
    );
    expect(str(widen(t('list<integer>'), t('list<string>')))).toBe(
      'list<integer> | list<string>'
    );
  });
});

describe('A TENSOR OF UNKNOWN RANK AGAINST A RECURSIVE ALIAS', () => {
  // `tensor<integer> <: nest` asks whether the elements of the tensor,
  // `integer | tensor<integer>`, are `nest | integer`, which asks
  // `tensor<integer> <: nest` again. Every query overflowed the stack.
  const ce = new ComputeEngine();
  ce.declareType('nest', 'list<nest | integer>', { alias: true });
  const nest = ce.type('nest').type as Type;
  const ten = t('tensor<integer>');
  test('isSubtype answers coinductively', () => {
    expect(isSubtype(ten, nest)).toBe(true);
    expect(isSubtype(t('matrix<integer>'), nest)).toBe(true);
    expect(isSubtype(t('tensor<string>'), nest)).toBe(false);
    expect(isSubtype(nest, ten)).toBe(false);
  });
  test('the other relations terminate', () => {
    expect(provablyDisjoint(ten, nest)).toBe(false);
    expect(str(reduceType({ kind: 'intersection', types: [ten, nest] }))).toBe(
      'tensor<integer>'
    );
    expect(str(narrow(ten, nest))).toBe('tensor<integer>');
    expect(str(widen(ten, nest))).toBe('nest');
    expect(couldMatch(ten, nest)).toBe(true);
  });
});

describe('GENERIC INFERENCE READS THE ELEMENTS OF A TENSOR OF UNKNOWN RANK', () => {
  // The engine installs the type algebra the solver needs.
  new ComputeEngine();
  const bindT = (param: string, actual: string): string => {
    const r = inferTypeArguments(
      parseType(`(${param}) -> T where T`) as FunctionSignature,
      [t(actual)]
    );
    return r === null ? 'none' : str(r.T);
  };
  test('a list or indexed_collection pattern binds U | tensor<U>', () => {
    expect(bindT('list<T>', 'tensor<integer>')).toBe(
      'integer | tensor<integer>'
    );
    expect(bindT('indexed_collection<T>', 'tensor<integer>')).toBe(
      'integer | tensor<integer>'
    );
  });
  test('a tensor or broadcastable pattern binds the cells', () => {
    expect(bindT('tensor<T>', 'tensor<integer>')).toBe('integer');
    expect(bindT('broadcastable<T>', 'tensor<integer>')).toBe('integer');
  });
});

describe('STATIC SHAPE READERS', () => {
  test('staticCollectionDims reads a tensor, not a nested plain list', () => {
    expect(staticCollectionDims(t('matrix<2x3>'))).toEqual([2, 3]);
    expect(staticCollectionDims(t('vector<integer>'))).toEqual([-1]);
    expect(staticCollectionDims(t('tensor'))).toBeNull();
    expect(staticCollectionDims(t('list<number>'))).toEqual([-1]);
    expect(staticCollectionDims(t('list<list<number>>'))).toBeNull();
    expect(staticCollectionDims(t('list<vector<3>>'))).toBeNull();
    expect(staticCollectionDims(t('list<any>'))).toBeNull();
    expect(staticCollectionDims(t('list'))).toBeNull();
  });
  test('broadcastShapedResultType mirrors a tensor and keeps an unknown rank', () => {
    expect(str(broadcastShapedResultType([t('matrix<2x2>')], 'real'))).toBe(
      'matrix<real^(2x2)>'
    );
    expect(str(broadcastShapedResultType([t('tensor')], 'real'))).toBe(
      'tensor<real>'
    );
    // A list of tensors is not one tensor: its elements can have different
    // ranks (`[[1, 2], [[3]]]`). Each element of the result is a cell or a
    // tensor of cells.
    expect(str(broadcastShapedResultType([t('list<tensor>')], 'real'))).toBe(
      'list<broadcastable<real>>'
    );
    expect(
      str(
        broadcastShapedResultType(
          [t('list<broadcastable<number>>'), t('vector<real^3>')],
          'number'
        )
      )
    ).toBe('list<broadcastable<number>>');
    // A result for one cell that may itself be a tensor gives elements whose
    // rows can differ in length: the depth of the value is not known.
    expect(
      str(
        broadcastShapedResultType(
          [t('list<broadcastable<number>>')],
          t('broadcastable<number>')
        )
      )
    ).toBe('list<broadcastable<number> | list<any>>');
    expect(str(broadcastShapedResultType([t('list<number>')], 'real'))).toBe(
      'list<real>'
    );
    expect(
      str(broadcastShapedResultType([t('list<list<number>>')], 'real'))
    ).toBe('list<list<real>>');
    // A list whose elements can be lists has values of any depth, which
    // the broadcast maps at their leaves: an element of the result is a
    // cell or a list.
    expect(str(broadcastShapedResultType([t('list<any>')], 'real'))).toBe(
      'list<list<any> | real>'
    );
    // An unknown rank for another reason gives the plain list of the cell
    // result.
    expect(str(broadcastShapedResultType(['range'], 'real'))).toBe(
      'list<real>'
    );
    expect(
      str(broadcastShapedResultType([t('indexed_collection<integer>')], 'real'))
    ).toBe('list<real>');
  });
  test('broadcastShapedResultType gives a tensor of unknown rank when the ranks differ', () => {
    // Two operands of different known ranks: a vector against a matrix
    // broadcasts over the rows, so the value has the larger rank, which a
    // `list<real>` does not describe.
    expect(
      str(broadcastShapedResultType([t('vector<3>'), t('matrix<2x2>')], 'real'))
    ).toBe('tensor<real>');
    expect(
      str(broadcastShapedResultType([t('list<number>'), t('matrix')], 'real'))
    ).toBe('tensor<real>');
    // One operand whose type is a union of tensors of different ranks.
    expect(
      str(
        broadcastShapedResultType(
          [t('list<integer> | matrix<integer>')],
          'integer'
        )
      )
    ).toBe('tensor<integer>');
    expect(
      str(
        broadcastShapedResultType(
          [t('list<integer> | tensor<integer>')],
          'real'
        )
      )
    ).toBe('tensor<real>');
    // A union of tensors of one rank keeps that rank, with the lengths the
    // arms share.
    expect(
      str(broadcastShapedResultType([t('matrix<2x2> | matrix<2x3>')], 'real'))
    ).toBe('matrix<real^(2x?)>');
    expect(
      str(
        broadcastShapedResultType(
          [t('vector<integer^2> | vector<integer^3>')],
          'real'
        )
      )
    ).toBe('list<real>');
    // Rows that may differ in length are not a tensor. With two operands of
    // known ranks the result has the larger rank: one plain list level per
    // axis (`[1, 2]` against `[[1], [2, 3]]` gives `[[f(1, 1)], [f(2, 2),
    // f(2, 3)]]`).
    expect(
      str(
        broadcastShapedResultType(
          [t('list<number>'), t('list<list<number>>')],
          'real'
        )
      )
    ).toBe('list<list<real>>');
    // One operand whose value can be a list or a list of lists of different
    // lengths: the depth is not known, and the result is a list of cells or
    // lists.
    expect(
      str(
        broadcastShapedResultType(
          [t('list<integer> | list<list<integer>>')],
          'real'
        )
      )
    ).toBe('list<list<any> | real>');
    // An operand of unknown rank beside one whose rows differ in length.
    expect(
      str(
        broadcastShapedResultType(
          [t('tensor<integer>'), t('list<list<integer>>')],
          'real'
        )
      )
    ).toBe('list<list<any> | real>');
    // The uniformity of every operand is read, wherever the operand of
    // unknown rank is.
    expect(
      str(
        broadcastShapedResultType(
          [t('list<list<integer>>'), t('tensor<integer>')],
          'real'
        )
      )
    ).toBe('list<list<any> | real>');
    // A union with a scalar arm has no list shape.
    expect(
      str(broadcastShapedResultType([t('integer | list<integer>')], 'real'))
    ).toBe('list<real>');
    // A cell result that cannot hold a list gives a tensor of unknown rank
    // too (the answer was the plain `list<boolean>` before the rule change
    // of 2026-10-22, which a rank-2 value is not in).
    expect(
      str(
        broadcastShapedResultType([t('vector<3>'), t('matrix<2x2>')], 'boolean')
      )
    ).toBe('tensor<boolean>');
    expect(
      str(
        broadcastShapedResultType(
          [t('list<integer> | matrix<integer>')],
          'boolean'
        )
      )
    ).toBe('tensor<boolean>');
    expect(str(broadcastShapedResultType([t('tensor')], 'boolean'))).toBe(
      'tensor<boolean>'
    );
    expect(
      str(broadcastShapedResultType([t('tensor')], t('tuple<number, number>')))
    ).toBe('tensor<tuple<number, number>>');
    // A cell result that can hold a list is not a cell of a tensor: the
    // nested list of any depth.
    expect(str(broadcastShapedResultType([t('tensor')], 'value'))).toBe(
      'list<value>'
    );
    expect(
      str(
        broadcastShapedResultType([t('tensor')], t('integer | list<integer>'))
      )
    ).toBe('list<integer | list<any> | list<integer>>');
  });

  test('the broadcast result type holds the value (engine)', () => {
    // Each check uses a fresh engine, so a declaration does not leak.
    const check = (decls: Record<string, [string, string]>, latex: string) => {
      const ce = new ComputeEngine();
      for (const [name, [type, value]] of Object.entries(decls)) {
        ce.declare(name, type);
        ce.assign(name, ce.parse(value));
      }
      const expr = ce.parse(latex);
      const value = expr.evaluate();
      return {
        type: expr.type.toString(),
        member: value.type.matches(expr.type),
      };
    };
    // A tensor of unknown rank holding a matrix, compared with a number.
    expect(check({ T: ['tensor<integer>', '[[1,2],[3,4]]'] }, 'T < 3')).toEqual(
      { type: 'tensor<boolean>', member: true }
    );
    // A union of ranks holding a matrix.
    expect(
      check(
        { U: ['list<integer> | matrix<integer>', '[[1,2],[3,4]]'] },
        'U < 3'
      )
    ).toEqual({ type: 'tensor<boolean>', member: true });
    // A vector against a matrix, with a boolean result.
    expect(
      check(
        {
          V: ['vector<integer>', '[1, 2]'],
          M: ['matrix<integer>', '[[1,2],[3,4]]'],
        },
        'V < M'
      )
    ).toEqual({ type: 'tensor<boolean>', member: true });
    // An operand of unknown rank beside a ragged list: the value
    // `[[0], [0, 2]]` is not a tensor.
    const r = check(
      {
        T: ['tensor<integer>', '[1, 2]'],
        R: ['list<list<integer>>', '[[1], [2, 3]]'],
      },
      '\\operatorname{Mod}(T, R)'
    );
    expect(r).toEqual({ type: 'list<list<any> | nan | real>', member: true });
    // Two operands of known ranks, one ragged: one list level per axis.
    expect(
      check(
        {
          V: ['list<integer>', '[1, 2]'],
          R: ['list<list<integer>>', '[[1], [2, 3]]'],
        },
        '\\operatorname{Mod}(V, R)'
      )
    ).toEqual({ type: 'list<list<nan | real>>', member: true });
  });
  test('broadcastElementType reads the cells of a tensor and the T of a broadcastable', () => {
    expect(str(broadcastElementType(t('broadcastable<number>')))).toBe(
      'number'
    );
    expect(str(broadcastElementType(t('broadcastable<boolean>')))).toBe(
      'boolean'
    );
    expect(str(broadcastElementType(t('matrix<integer>')))).toBe('integer');
    expect(str(broadcastElementType(t('tensor<integer>')))).toBe('integer');
    expect(str(broadcastElementType(t('list<integer>')))).toBe('integer');
    expect(str(broadcastElementType(t('list<list<integer>>')))).toBe(
      'list<integer>'
    );
  });
});

describe('CORPUS CHECK', () => {
  const atoms = [
    'integer',
    'number',
    'real',
    'value',
    'any',
    'unknown',
    'never',
    'boolean',
    'string',
  ];
  const constructors = [
    (x: string) => `list<${x}>`,
    (x: string) => `vector<${x}>`,
    (x: string) => `vector<${x}^3>`,
    (x: string) => `matrix<${x}>`,
    (x: string) => `matrix<${x}^(2x2)>`,
    (x: string) => `tensor<${x}>`,
    (x: string) => `tensor<${x}^(2x2x2)>`,
    (x: string) => `collection<${x}>`,
    (x: string) => `indexed_collection<${x}>`,
    (x: string) => `broadcastable<${x}>`,
    (x: string) => `set<${x}>`,
  ];
  // The constructors above are covariant in their argument. A tuple is
  // covariant slot by slot and a union arm by arm; both are built below from
  // pairs of atoms.
  const legal = (s: string): boolean => {
    try {
      t(s);
      return true;
    } catch {
      return false;
    }
  };
  const level1: string[] = [];
  for (const c of constructors)
    for (const a of atoms) if (legal(c(a))) level1.push(c(a));
  for (const [a, b] of [
    ['integer', 'string'],
    ['number', 'boolean'],
    ['any', 'never'],
    ['unknown', 'integer'],
  ]) {
    level1.push(`tuple<${a}, ${b}>`);
    level1.push(`${a} | ${b}`);
  }
  const level2: string[] = [];
  const inner = [
    'list<integer>',
    'vector<integer>',
    'matrix<number>',
    'tensor<integer>',
    'integer | string',
    'tuple<integer, string>',
    'broadcastable<number>',
    'collection<any>',
  ];
  for (const c of constructors)
    for (const a of inner) if (legal(c(a))) level2.push(c(a));
  const corpus = [...atoms, ...level1, ...level2];
  const types = corpus.map(t);
  const n = corpus.length;

  // The subtype matrix, computed once.
  const R: boolean[][] = [];
  beforeAll(() => {
    for (let i = 0; i < n; i++) {
      R.push([]);
      for (let j = 0; j < n; j++) R[i].push(isSubtype(types[i], types[j]));
    }
  });

  test('the corpus has about 120 types', () => {
    expect(n).toBeGreaterThanOrEqual(120);
  });

  test('reflexivity', () => {
    for (let i = 0; i < n; i++)
      expect([corpus[i], R[i][i]]).toEqual([corpus[i], true]);
  });

  test('covariance of every constructor', () => {
    const violations: string[] = [];
    const args = [...atoms, ...inner];
    const flat = (s: string): boolean => cannotHoldAList(t(s));
    for (const c of constructors)
      for (const a of args)
        for (const b of args) {
          const ca = c(a);
          const cb = c(b);
          if (!legal(ca) || !legal(cb)) continue;
          // `broadcastable<T>` is covariant in `T` on each side of the
          // boundary between the types that cannot hold a list and those
          // that can: its collection arm is `tensor<T>` for the first and
          // `list<T>` for the second, and a `tensor<integer>` (which holds
          // tensors of rank 3) is not a `list<integer | list<integer>>`.
          if (ca.startsWith('broadcastable<') && flat(a) !== flat(b)) continue;
          if (sub(a, b) && !sub(ca, cb)) violations.push(`${ca} <: ${cb}`);
        }
    expect(violations).toEqual([]);
  });

  test('transitivity of isSubtype', () => {
    const violations: string[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (!R[i][j]) continue;
        for (let k = 0; k < n; k++)
          if (R[j][k] && !R[i][k])
            violations.push(`${corpus[i]} <: ${corpus[j]} <: ${corpus[k]}`);
      }
    expect(violations).toEqual([]);
  });

  // Two spellings of one set of values: `unknown` and `any` denote the same
  // set (user decision D1 of 2026-10-21), `list<U>` and `vector<U>` denote the
  // same set for a numeric `U` (decision D5), `broadcastable<T>` and the
  // union it denotes, and a union that reduces to one of its arms.
  const canonicalNode = (x: Type): Type => {
    if (x === 'unknown') return 'any';
    if (typeof x === 'string') return x;
    switch (x.kind) {
      case 'list': {
        const elements = canonicalNode(x.elements);
        // A rank-1 tensor with an open length and numeric cells denotes the
        // same values as the plain list of its cells.
        if (
          x.dimensions &&
          x.dimensions.length === 1 &&
          x.dimensions[0] === -1 &&
          isSubtype(elements, 'number')
        )
          return { kind: 'list', elements };
        return { ...x, elements };
      }
      case 'set':
      case 'collection':
      case 'indexed_collection':
        return { ...x, elements: canonicalNode(x.elements) };
      case 'broadcastable': {
        const inner = canonicalNode(x.elements);
        const arm: Type = cannotHoldAList(inner)
          ? { kind: 'list', elements: inner, dimensions: null }
          : { kind: 'list', elements: inner };
        return { kind: 'union', types: [inner, arm] };
      }
      case 'union':
        return { kind: 'union', types: x.types.map(canonicalNode) };
      case 'tuple':
        return {
          kind: 'tuple',
          elements: x.elements.map((e) => ({
            ...e,
            type: canonicalNode(e.type),
          })),
        };
      default:
        return x;
    }
  };
  const canonical = (x: Type): string => str(reduceType(canonicalNode(x)));

  test('antisymmetry up to equal spelling', () => {
    const violations: string[] = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (R[i][j] && R[j][i] && canonical(types[i]) !== canonical(types[j]))
          violations.push(`${corpus[i]} == ${corpus[j]}`);
    expect(violations).toEqual([]);
  });

  test('narrow(a, b) is a subtype of both a and b', () => {
    const violations: string[] = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const m = narrow(types[i], types[j]);
        if (!isSubtype(m, types[i]) || !isSubtype(m, types[j]))
          violations.push(`narrow(${corpus[i]}, ${corpus[j]}) = ${str(m)}`);
      }
    expect(violations).toEqual([]);
  }, 120000);
});

describe('an alias as a cell type', () => {
  // An alias denotes the values of its definition, so an alias of a list
  // is refused as a cell type, as the spelled-out definition is. A nominal
  // type is opaque and stays accepted.
  const ce = new ComputeEngine();
  ce.declareType('Row', 'vector<integer^3>', { alias: true });
  ce.declareType('Num', 'integer | rational', { alias: true });
  ce.declareType('NominalRow', 'vector<integer^3>');

  test.each(['list<Row^2>', 'matrix<Row^(2x2)>', 'tensor<Row>', 'vector<Row>'])(
    '%s is refused',
    (s) => {
      expect(() => ce.declare(`x${s.length}${s[0]}`, s)).toThrow(
        /cannot be lists/
      );
    }
  );

  test('the message names the spelling with one shape', () => {
    expect(() => ce.declare('r2', 'list<Row^2>')).toThrow(
      '`matrix<integer^(2x3)>`'
    );
  });

  test.each(['list<Row>', 'list<Num^2>', 'list<NominalRow^2>'])(
    '%s is accepted',
    (s) => {
      expect(() => ce.type(s)).not.toThrow();
    }
  );
});
