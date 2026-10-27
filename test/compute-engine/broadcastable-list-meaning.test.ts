import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import {
  couldMatch,
  isSubtype,
  isSubtypeOfBroadcastOrIndexed,
  provablyDisjoint,
} from '../../src/common/type/subtype';
import { reduceType, typesOverlap } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';

/**
 * `broadcastable<T>` is the union `T | tensor<T>` for a numeric `T` (a
 * scalar, or a tensor of any rank whose cells are `T`) and `T | list<T>`
 * otherwise (a scalar, or a list of `T`): the collection an element-wise
 * operator maps over. It used to be `T | indexed_collection<T>`, with a
 * rule that refused tuples and strings. Because
 * `tuple<T> <: indexed_collection<T>`, that relation was not transitive:
 * `tuple<integer> <: indexed_collection<integer> <: broadcastable<integer>`,
 * but `tuple<integer>` was not a subtype of `broadcastable<integer>`. With
 * the tensor meaning, every list of numbers and every matrix is a subtype of
 * `broadcastable<number>`, and a tuple, which is not a list, is outside both.
 *
 * A list with no dimensions is read by its elements (user decision of
 * 2026-10-21, `docs/plans/2026-10-21-list-element-tensor-cell.md`): a
 * matrix of integers is a `list<vector<integer>>`, never a `list<integer>`,
 * and two plain lists always share the empty list, so their meet is the
 * list of the meet of the elements (`list<never>` when the elements share
 * nothing) and they overlap. The tests below pin the meets and the overlaps
 * that follow.
 *
 * Evaluation is unchanged where the old relation is what a check needs. The
 * engine checks that ask "is this operand a number, or a collection that
 * broadcast reaches" use `isSubtypeOfBroadcastOrIndexed`, which keeps the
 * older relation, so point arithmetic and the broadcast of a declared
 * function give the same values and types as before. Two results change,
 * and are pinned below: assigning a value typed `indexed_collection<T>` to a
 * symbol declared `broadcastable<T>` is refused, and `Map` of a callback
 * declared over `broadcastable<number>` refuses a list of points.
 */

const sub = (a: string, b: string) => isSubtype(parseType(a), parseType(b));

describe('broadcastable<T> is T | tensor<T> for a numeric T', () => {
  const lists = [
    'list<integer>',
    'vector<integer>',
    'matrix<integer>',
    'matrix<integer^(2x3)>',
    'range',
  ];
  const notLists = [
    'tuple<integer>',
    'tuple<integer, integer>',
    'indexed_collection<integer>',
    'string',
    'set<integer>',
  ];

  for (const rhs of ['broadcastable<integer>', 'broadcastable<number>']) {
    it.each(lists)(`%s is a subtype of ${rhs}`, (lhs) => {
      expect(sub(lhs, rhs)).toBe(true);
    });
    it.each(notLists)(`%s is not a subtype of ${rhs}`, (lhs) => {
      expect(sub(lhs, rhs)).toBe(false);
    });
  }

  it('is transitive through list<T>', () => {
    for (const lhs of [...lists, ...notLists]) {
      if (sub(lhs, 'list<integer>'))
        expect(sub(lhs, 'broadcastable<integer>')).toBe(true);
    }
  });

  it('a tuple is an indexed collection, but not a list', () => {
    expect(sub('tuple<integer>', 'indexed_collection<integer>')).toBe(true);
    expect(sub('tuple<integer>', 'list<integer>')).toBe(false);
  });

  it('is a subtype of T | tensor<T>, and of neither arm alone', () => {
    expect(sub('broadcastable<integer>', 'integer | tensor<integer>')).toBe(
      true
    );
    // A `broadcastable<integer>` holds matrices, which a list of integers
    // (read by its elements) does not.
    expect(sub('broadcastable<integer>', 'integer | list<integer>')).toBe(
      false
    );
    expect(sub('broadcastable<integer>', 'tensor<integer>')).toBe(false);
    expect(sub('broadcastable<integer>', 'list<integer>')).toBe(false);
    expect(sub('broadcastable<integer>', 'integer')).toBe(false);
  });

  it('a tuple is disjoint from broadcastable<number>, and cannot match it', () => {
    for (const t of ['tuple<integer>', 'tuple<integer, integer>']) {
      const a = parseType(t);
      const b = parseType('broadcastable<number>');
      expect(provablyDisjoint(a, b)).toBe(true);
      expect(couldMatch(a, b)).toBe(false);
    }
  });

  it('an abstract indexed collection may overlap broadcastable<number>', () => {
    // A value typed `indexed_collection<number>` may be a list.
    const a = parseType('indexed_collection<number>');
    const b = parseType('broadcastable<number>');
    expect(provablyDisjoint(a, b)).toBe(false);
    expect(couldMatch(a, b)).toBe(true);
  });
});

describe('isSubtypeOfBroadcastOrIndexed keeps the older relation', () => {
  const fits = (t: string, elements: string) =>
    isSubtypeOfBroadcastOrIndexed(parseType(t), parseType(elements));

  it('admits a number, a list and an abstract indexed collection', () => {
    expect(fits('integer', 'number')).toBe(true);
    expect(fits('list<integer>', 'number')).toBe(true);
    expect(fits('matrix<integer>', 'number')).toBe(true);
    expect(fits('range', 'number')).toBe(true);
    expect(fits('indexed_collection<integer>', 'number')).toBe(true);
    expect(fits('broadcastable<integer>', 'number')).toBe(true);
    expect(fits('integer | indexed_collection<integer>', 'number')).toBe(true);
  });

  it('refuses a tuple, a string, a set and a non-numeric element', () => {
    expect(fits('tuple<integer, integer>', 'number')).toBe(false);
    expect(fits('string', 'number')).toBe(false);
    expect(fits('set<integer>', 'number')).toBe(false);
    expect(fits('indexed_collection<string>', 'number')).toBe(false);
    expect(fits('number | tuple<number, number>', 'number')).toBe(false);
  });

  it('admits an abstract indexed collection at each nested level', () => {
    const color3 = 'broadcastable<broadcastable<broadcastable<color>>>';
    expect(fits('color', color3)).toBe(true);
    expect(fits('indexed_collection<indexed_collection<color>>', color3)).toBe(
      true
    );
    expect(fits('list<indexed_collection<list<color>>>', color3)).toBe(true);
    expect(fits('tuple<color, color>', color3)).toBe(false);
    expect(fits('list<number>', color3)).toBe(false);
  });
});

describe('point arithmetic keeps its values and types', () => {
  const ce = new ComputeEngine();

  it('(1,2) + (3,4)', () => {
    const e = ce.parse('(1,2)+(3,4)');
    expect(e.type.toString()).toBe('tuple<integer, integer>');
    expect(e.evaluate().toString()).toBe('(4, 6)');
  });

  it('a point times a number', () => {
    const e = ce.box(['Multiply', ['Tuple', 1, 2], 3]);
    expect(e.type.toString()).toBe('tuple<integer, integer>');
    expect(e.evaluate().toString()).toBe('(3, 6)');
    expect(ce.parse('3(1,2)').evaluate().toString()).toBe('(3, 6)');
  });

  it('a list of points divided by a number', () => {
    const e = ce.box(['Divide', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], 2]);
    expect(e.type.toString()).toBe('list<tuple<rational, rational>^2>');
    expect(e.evaluate().toString()).toBe('[(1/2, 1),(3/2, 2)]');
  });

  it('the dot product of two points', () => {
    const e = ce.box(['Dot', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    expect(e.type.toString()).toBe('integer');
    expect(e.evaluate().toString()).toBe('11');
  });
});

describe('a declared (broadcastable<number>) -> broadcastable<number> function', () => {
  // The values and types below are the ones the engine gave before
  // `broadcastable<T>` meant `T | list<T>`.
  const ce = new ComputeEngine();
  ce.declare('f', '(broadcastable<number>) -> broadcastable<number>');
  ce.assign('f', ce.parse('x \\mapsto 2x + 1'));
  ce.declare('xs', 'indexed_collection<number>');
  ce.assign('xs', ce.box(['List', 1, 2, 3]));

  it('maps over a list', () => {
    const e = ce.box(['f', ['List', 1, 2, 3]]);
    expect(e.type.toString()).toBe('vector<integer^3>');
    expect(e.evaluate().toString()).toBe('[3,5,7]');
  });

  it('binds a tuple whole, which the scalar body refuses', () => {
    const e = ce.box(['f', ['Tuple', 1, 2]]);
    expect(e.type.toString()).toBe('broadcastable<number>');
    const v = e.evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "broadcastable<number>", "tuple<integer, integer>"), (1, 2))'
    );
  });

  it('maps over a symbol typed indexed_collection<number> that holds a list', () => {
    const e = ce.box(['f', 'xs']);
    expect(e.type.toString()).toBe('list<number>');
    expect(e.evaluate().toString()).toBe('[3,5,7]');
  });

  it('applies to a scalar', () => {
    const e = ce.box(['f', 5]);
    expect(e.evaluate().toString()).toBe('11');
  });
});

describe('isSubtypeOfBroadcastOrIndexed with a structural alias', () => {
  // The alias guard holds the aliases of the current descent only, so two
  // arms of a union can each unfold the same alias.
  it('accepts a union whose arms use the same alias', () => {
    const ce = new ComputeEngine();
    ce.declareType('Colors', 'indexed_collection<color>', { alias: true });
    const nested = parseType(
      'broadcastable<broadcastable<broadcastable<color>>>'
    );
    const elements = (
      nested as {
        elements: Parameters<typeof isSubtypeOfBroadcastOrIndexed>[1];
      }
    ).elements;
    // An alias of a collection cannot be the cell type of a list with a
    // length, so the arms are plain lists.
    for (const t of ['list<Colors>', 'list<Colors> | list<list<Colors>>'])
      expect(isSubtypeOfBroadcastOrIndexed(ce.type(t).type, elements)).toBe(
        true
      );
  });

  it('stops on a self-referential alias', () => {
    const ce = new ComputeEngine();
    ce.declareType('json', 'list<json> | integer', { alias: true });
    expect(isSubtypeOfBroadcastOrIndexed(ce.type('json').type, 'integer')).toBe(
      false
    );
  });
});

describe('a list meets an indexed collection or a collection', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) &&
    typesOverlap(parseType(b), parseType(a));

  it('is the list of the meet of the elements', () => {
    expect(meet('list<number>', 'indexed_collection<integer>')).toBe(
      'list<integer>'
    );
    // The tensor arm of a `broadcastable<number>` meets an indexed
    // collection of integers at rank 1 only: the rows of a matrix are not
    // integers.
    expect(meet('broadcastable<number>', 'indexed_collection<integer>')).toBe(
      'vector<integer>'
    );
    expect(meet('indexed_collection<real>', 'collection<integer>')).toBe(
      'indexed_collection<integer>'
    );
  });

  it('overlaps when the elements overlap, or when both can be empty', () => {
    expect(
      overlap('broadcastable<number>', 'indexed_collection<integer>')
    ).toBe(true);
    // Two lists with no dimensions always share the empty list.
    expect(overlap('list<integer>', 'collection<string>')).toBe(true);
    expect(overlap('list<integer>', 'list<string>')).toBe(true);
    // A list with a fixed length is never empty, so its elements decide.
    expect(overlap('list<integer^3>', 'collection<string>')).toBe(false);
    expect(overlap('list<integer^3>', 'list<string>')).toBe(false);
  });

  it('admits an indexed collection at a union parameter with broadcastable', () => {
    const ce = new ComputeEngine();
    ce.declare('b', '(broadcastable<number> | string) -> number');
    ce.assign('b', ce.box(['Function', 1, 'x']));
    ce.declare('icL', 'indexed_collection<integer>');
    ce.assign('icL', ce.box(['List', 1, 2]));
    expect(ce.box(['b', 'icL']).evaluate().toString()).toBe('1');
  });
});

describe('results that follow from the list meaning', () => {
  it('refuses to assign an indexed collection to a broadcastable symbol', () => {
    // As for a symbol declared `list<number>`: the type
    // `indexed_collection<integer>` also holds tuples.
    const ce = new ComputeEngine();
    ce.declare('icL', 'indexed_collection<integer>');
    ce.assign('icL', ce.box(['List', 1, 2]));
    ce.declare('bA', 'broadcastable<number>');
    expect(() => ce.assign('bA', ce.box('icL'))).toThrow(/not compatible/);
  });

  it('refuses a list of points for a callback over broadcastable<number>', () => {
    // A point is passed whole, and a point is not a `broadcastable<number>`.
    const ce = new ComputeEngine();
    ce.declare('f', '(broadcastable<number>) -> number');
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    const e = ce.box(['Map', 'f', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]]);
    expect(e.isValid).toBe(false);
  });

  it('types a union of a list and a broadcastable as a scalar or a tensor', () => {
    // `broadcastable<integer>` is `integer | tensor<integer>`, and a list
    // of integers is a tensor of integers, so the union is that union.
    const ce = new ComputeEngine();
    ce.declare('u', 'list<integer> | broadcastable<integer>');
    expect(ce.box(['Add', 'u', 1]).type.toString()).toBe(
      'integer | tensor<integer>'
    );
    expect(ce.box(['Multiply', 2, 'u']).type.toString()).toBe(
      'integer | tensor<integer>'
    );
  });
});

describe('a matrix beside a wider collection', () => {
  // The elements of a matrix are its rows: an element of `collection<E>`
  // must be a row of the matrix, never a cell.
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b));
  it('overlaps when a row can be an element', () => {
    expect(overlap('matrix<integer^(2x3)>', 'collection<list<integer>>')).toBe(
      true
    );
  });
  it('does not overlap when no row can be one', () => {
    expect(overlap('matrix<integer^(2x3)>', 'collection<integer>')).toBe(false);
    expect(overlap('matrix<integer^(2x3)>', 'collection<string>')).toBe(false);
  });
});

describe('isSubtypeOfBroadcastOrIndexed with a generic alias', () => {
  it('reads the alias with its type argument', () => {
    const ce = new ComputeEngine();
    ce.declareType('Seq', 'indexed_collection<T>', {
      alias: true,
      typeParams: ['T'],
    });
    expect(
      isSubtypeOfBroadcastOrIndexed(ce.type('Seq<integer>').type, 'number')
    ).toBe(true);
    expect(
      isSubtypeOfBroadcastOrIndexed(ce.type('Seq<string>').type, 'number')
    ).toBe(false);
  });
});

describe('the meet of a matrix with a wider collection', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  it('is empty when no cell and no row can be an element', () => {
    expect(meet('matrix<integer^(2x3)>', 'collection<string>')).toBe('never');
  });
  it('is empty when the rows of a grid cannot be elements', () => {
    // The elements of a 2×3 grid of sets are its rows, which are not sets.
    expect(meet('matrix<set<integer>^(2x3)>', 'collection<set<string>>')).toBe(
      'never'
    );
    // A list with no dimensions of empty sets is in both types.
    expect(meet('list<set<integer>>', 'collection<set<string>>')).toBe(
      'list<set<never>>'
    );
  });
});

describe('isSubtypeOfBroadcastOrIndexed with a recursive alias', () => {
  it('reads a bare recursive arm from the other arms', () => {
    const ce = new ComputeEngine();
    ce.declareType('C', 'C | indexed_collection<number>', { alias: true });
    expect(isSubtypeOfBroadcastOrIndexed(ce.type('C').type, 'number')).toBe(
      true
    );
    ce.declareType('D', 'D | string', { alias: true });
    expect(isSubtypeOfBroadcastOrIndexed(ce.type('D').type, 'number')).toBe(
      false
    );
  });
});

describe('the meet of a fixed-length list with a wider collection', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  it('is empty when the elements have no common value', () => {
    // A list of length 3 is not empty, so it cannot be the only common value.
    expect(meet('list<integer^3>', 'collection<string>')).toBe('never');
    // A list of any length can be empty: the empty list is in both.
    expect(meet('list<integer>', 'collection<string>')).toBe('list<never>');
  });
});

describe('a matrix is in a collection of its rows, not of its cells', () => {
  // A matrix of integers is a `list<vector<integer>>` and a
  // `list<list<integer>>`; it is not a `list<number>`.
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) &&
    typesOverlap(parseType(b), parseType(a));
  it('a matrix of numbers and a collection of integer rows overlap, and their meet is kept', () => {
    expect(overlap('matrix<number>', 'collection<list<integer>>')).toBe(true);
    expect(meet('matrix<number>', 'collection<list<integer>>')).not.toBe(
      'never'
    );
    expect(
      isSubtype(
        parseType('matrix<integer^(2x2)>'),
        reduceType({
          kind: 'intersection',
          types: [
            parseType('matrix<number>'),
            parseType('collection<list<integer>>'),
          ],
        })
      )
    ).toBe(true);
  });
  it('a list of numbers and a collection of rows share the empty list only', () => {
    expect(overlap('list<number>', 'collection<list<integer>>')).toBe(true);
    expect(meet('list<number>', 'collection<list<integer>>')).toBe(
      'list<never>'
    );
  });
  it.each([
    // Two lists with no dimensions share the empty list.
    ['list<integer>', 'list<string>'],
    ['list<integer>', 'list<list<string>>'],
    ['list<integer>', 'collection<string>'],
  ])('%s and %s overlap, through the empty list', (a, b) => {
    expect(overlap(a, b)).toBe(true);
    expect(meet(a, b)).toBe('list<never>');
  });
  it.each([
    // A list with a fixed length is never empty.
    ['list<integer^3>', 'list<string>'],
    ['list<integer^3>', 'list<list<string>>'],
    ['vector<integer^3>', 'collection<string>'],
  ])('%s and %s do not overlap', (a, b) => {
    expect(overlap(a, b)).toBe(false);
  });
});

describe('more meets of a list with a wider collection', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) &&
    typesOverlap(parseType(b), parseType(a));
  it('meets the elements: a list of empty lists is in both', () => {
    // The elements `number | list<string>` and `boolean | list<integer>`
    // share the empty list, so the lists of empty lists are in both types.
    expect(
      meet('list<number | list<string>>', 'collection<boolean | list<integer>>')
    ).toBe('list<list<never>>');
    // A list of integer vectors or strings beside a collection of booleans
    // or integer rows: the lists of integer rows are in both.
    expect(
      meet(
        'list<vector<number> | list<string>>',
        'collection<boolean | list<integer>>'
      )
    ).toBe('list<list<integer>>');
  });
  it('two lists with no dimensions overlap whatever their elements', () => {
    // Both hold the empty list, and `list<set<never>>` (lists of empty
    // sets) is a subtype of `list<set<integer>>` besides.
    expect(overlap('list<set<never>>', 'list<set<integer>>')).toBe(true);
    expect(overlap('list<set<never>>', 'collection<set<integer>>')).toBe(true);
    // A list with a fixed length of empty sets is never empty, and the
    // empty set is the only value its cells share with `set<integer>`,
    // which the protocol rule of `typesOverlap()` does not count.
    expect(overlap('list<set<never>^2>', 'collection<set<integer>>')).toBe(
      false
    );
  });
});

describe('no false overlap through nested lists', () => {
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) ||
    typesOverlap(parseType(b), parseType(a));
  it('reads the rows of a matrix as its elements', () => {
    // The rows of a 3×2 integer matrix are integer 2-vectors, not lists of
    // two strings.
    expect(overlap('matrix<integer^(3x2)>', 'collection<list<string^2>>')).toBe(
      false
    );
  });
  it('does not take the empty list as a matrix row', () => {
    // A 2-vector of integers holds no boolean and no list of strings; the
    // lists with no dimensions would share the empty list.
    expect(overlap('list<integer^2>', 'list<boolean | list<string>>')).toBe(
      false
    );
    expect(overlap('list<integer>', 'list<boolean | list<string>>')).toBe(true);
  });
});

describe('the empty list is a value of every list with no dimensions', () => {
  it('list<never> and list<any> overlap, and their meet is list<never>', () => {
    const p = (s: string) => parseType(s);
    expect(typesOverlap(p('list<never>'), p('list<any>'))).toBe(true);
    expect(typesOverlap(p('list<any>'), p('list<never>'))).toBe(true);
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [p('list<never>'), p('list<any>')],
        })
      )
    ).toBe('list<never>');
  });
});

describe('a matrix in a fixed-length list of rows', () => {
  it('meets a matrix of 3 rows with a collection of its rows, not of its cells', () => {
    // The elements of a 3-row integer matrix are its rows: a collection of
    // numbers holds none of them, a collection of number vectors all.
    const a = parseType('matrix<integer^(3x?)>');
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [a, parseType('collection<number>')],
        })
      )
    ).toBe('never');
    expect(typesOverlap(a, parseType('collection<number>'))).toBe(false);
    const b = parseType('collection<vector<number>>');
    expect(
      typeToString(reduceType({ kind: 'intersection', types: [a, b] }))
    ).toBe('matrix<integer^(3x?)>');
    expect(typesOverlap(a, b)).toBe(true);
  });

  it('reads a transparent alias as its definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('Empty', 'list<never>', { alias: true });
    const T = (s: string) => ce.type(s).type;
    // A list of integers and a list of empty lists share the empty list,
    // through the alias as through its definition; a 2-vector of integers
    // shares nothing with either.
    const meet = (a: string, b: string) =>
      typeToString(reduceType({ kind: 'intersection', types: [T(a), T(b)] }));
    expect(meet('list<integer>', 'list<Empty>')).toBe('list<never>');
    expect(meet('list<integer>', 'list<list<never>>')).toBe('list<never>');
    expect(typesOverlap(T('vector<integer^2>'), T('list<Empty>'))).toBe(false);
    expect(typesOverlap(T('vector<integer^2>'), T('list<list<never>>'))).toBe(
      false
    );
  });
});

describe('a matrix witness and a fixed-length list', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) ||
    typesOverlap(parseType(b), parseType(a));
  it('does not take the elements of a fixed-length list as cells', () => {
    // The elements of `list<integer^3>` are integers, which are not rows.
    expect(overlap('list<integer^3>', 'collection<list<integer>>')).toBe(false);
    expect(meet('list<integer^3>', 'collection<list<integer>>')).toBe('never');
  });
  it('meets the elements when they can be empty lists', () => {
    // `boolean | list<integer>` and `number | list<string>` share the
    // empty list, so the lists of empty lists are in both types.
    expect(
      meet('list<boolean | list<integer>>', 'collection<number | list<string>>')
    ).toBe('list<list<never>>');
  });
});

describe('empty collections in the meet and in the overlap test', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) ||
    typesOverlap(parseType(b), parseType(a));
  it('meets a list of sets and a collection of rows as the empty list', () => {
    // A set is not a row: the elements share nothing, and the empty list is
    // the one value in both.
    expect(meet('list<set<integer>>', 'collection<list<set<string>>>')).toBe(
      'list<never>'
    );
  });
  it('does not count a list of length 0 as an overlap', () => {
    expect(overlap('list<number^0>', 'collection<integer>')).toBe(false);
  });
});

describe('more spellings of empty lists', () => {
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) &&
    typesOverlap(parseType(b), parseType(a));
  it('reads only the outer dimension as the length', () => {
    // `[[], []]` is a list of two empty rows.
    expect(
      overlap('matrix<integer^(2x0)>', 'collection<list<integer^0>>')
    ).toBe(true);
  });
  it('reads broadcastable<never> as never | tensor<never>', () => {
    // No integer is a `broadcastable<never>`, so the two lists share the
    // empty list only.
    expect(overlap('list<integer>', 'list<broadcastable<never>>')).toBe(true);
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [
            parseType('list<integer>'),
            parseType('list<broadcastable<never>>'),
          ],
        })
      )
    ).toBe('list<never>');
  });
});

describe('a kept intersection inside a larger type', () => {
  it('is not refuted when met again', () => {
    // `list<vector<integer>> & matrix<real>` is kept as written (an integer
    // matrix is in both); met again with `list<list<integer>>` it still
    // holds that matrix.
    const m = reduceType(
      parseType(
        '((list<vector<integer>> & matrix<real>) | boolean) & list<list<integer>>'
      )
    );
    expect(typeToString(m)).not.toBe('never');
    expect(isSubtype(parseType('matrix<integer^(2x2)>'), m)).toBe(true);
  });
  it('reads an intersection of rows member by member', () => {
    // The cells of a 2-vector of integers are not lists, whatever the
    // members of the intersection say.
    const a = parseType('vector<integer^2>');
    const b = parseType('list<list<never> & list<any>>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a kept intersection beside a disjoint type', () => {
  it('is refuted when it is provably disjoint', () => {
    const O = '((number) -> number) & ((string) -> string)';
    expect(
      typeToString(reduceType(parseType(`(${O} | boolean) & integer`)))
    ).toBe('never');
    expect(
      typesOverlap(parseType(`${O} | boolean`), parseType('integer'))
    ).toBe(false);
  });
});

describe('tensors of higher rank and long alias chains', () => {
  it('finds a rank-3 tensor in both types', () => {
    // A 2×2×2 integer tensor is a list of number matrices, and a collection
    // of lists of integer rows.
    const a = parseType('list<matrix<number>>');
    const b = parseType('collection<list<list<integer>>>');
    expect(typesOverlap(a, b) && typesOverlap(b, a)).toBe(true);
    const m = reduceType({ kind: 'intersection', types: [a, b] });
    expect(typeToString(m)).not.toBe('never');
    expect(isSubtype(parseType('tensor<integer^(2x2x2)>'), m)).toBe(true);
    // A list of numbers holds no matrix: the two share the empty list only.
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [parseType('list<number>'), b],
        })
      )
    ).toBe('list<never>');
  });
  it('follows a chain of aliases to the empty list', () => {
    const ce = new ComputeEngine();
    ce.declareType('A0', 'list<never>', { alias: true });
    for (let k = 1; k <= 9; k++)
      ce.declareType(`A${k}`, `A${k - 1}`, { alias: true });
    // The cells of a 2-vector of integers are not lists.
    const a = ce.type('vector<integer^2>').type;
    const b = ce.type('list<A9>').type;
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
    // A list of numbers and a list of empty lists share the empty list.
    const c = ce.type('list<number>').type;
    expect(typesOverlap(c, b) && typesOverlap(b, c)).toBe(true);
    expect(
      typeToString(reduceType({ kind: 'intersection', types: [c, b] }))
    ).toBe('list<never>');
  });
});

describe('an intersection of rows with no common row', () => {
  it('holds no row, so it gives no overlap', () => {
    // A 2-vector of integers is never empty, and its cells are not rows.
    const a = parseType('list<integer^2>');
    const b = parseType('list<list<integer^2> & list<integer^3>>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('the search budget and tensors through dimensioned lists', () => {
  it('terminates on a recursive alias with an intersection', () => {
    const ce = new ComputeEngine();
    ce.declareType('R', 'list<number | R> & list<list<number> | R>', {
      alias: true,
    });
    expect(() =>
      reduceType({
        kind: 'intersection',
        types: [ce.type('R').type, ce.type('list<integer>').type],
      })
    ).not.toThrow();
  });
  it('keeps a rank-3 tensor in a collection of its matrices', () => {
    // The elements of a 2×3×2 integer tensor are 3×2 integer matrices,
    // which are matrices of numbers.
    const a = parseType('tensor<integer^(2x3x2)>');
    const b = parseType('collection<matrix<number>>');
    expect(typesOverlap(a, b)).toBe(true);
    expect(
      typeToString(reduceType({ kind: 'intersection', types: [a, b] }))
    ).toBe('tensor<integer^(2x3x2)>');
  });
});

describe('an intersection that does not reduce', () => {
  it('is not a proof of overlap', () => {
    // Each member holds a row, but no row is in both members, and the
    // cells of a fixed-length list of booleans or strings are not rows.
    const ce = new ComputeEngine();
    ce.declareType(
      'R',
      'list<integer | list<string>> & list<boolean | list<integer>>',
      { alias: true }
    );
    const a = ce.type('list<(boolean | string)^2>').type;
    const b = ce.type('list<R>').type;
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a cell type with no value', () => {
  it('gives no overlap for a fixed-length list of it', () => {
    // `tuple<list<never^1>>` has no value, although it is not `never`, so
    // a list of two of them has none; the list with no dimensions holds
    // the empty list, which is in both.
    const a = parseType('list<tuple<list<never^1>>^2>');
    const b = parseType('list<list<any>>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
    const c = parseType('list<tuple<list<never^1>>>');
    expect(typesOverlap(c, b) && typesOverlap(b, c)).toBe(true);
  });
});

describe('a list with dimensions and a list with none', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  it('meets with the shape of the dimensioned list', () => {
    expect(meet('list<number^2>', 'list<integer>')).toBe('vector<integer^2>');
    // A list of number 2-vectors beside a collection of integer lists: the
    // rows keep their length and take the integer cells.
    expect(meet('list<vector<number^2>>', 'collection<list<integer>>')).toBe(
      'list<vector<integer^2>>'
    );
  });
  it('keeps the intersection when a matrix can be in both', () => {
    expect(meet('list<list<integer>>', 'matrix<number^(2x2)>')).not.toBe(
      'never'
    );
  });
  it('is empty when a vector cannot hold the elements', () => {
    expect(meet('list<string>', 'list<integer^2>')).toBe('never');
  });
});

describe('a matrix with no common cell or row', () => {
  it('meets a list of strings as never', () => {
    const a = parseType('list<string>');
    const b = parseType('matrix<integer^(2x2)>');
    expect(
      typeToString(reduceType({ kind: 'intersection', types: [a, b] }))
    ).toBe('never');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a matrix through rows when the element meet is not empty', () => {
  it('keeps the intersection', () => {
    // A 2×2 integer matrix: number cells on the left, integer rows on the
    // right. The elementwise meet, a 2×2 list of strings, does not hold it.
    const a = parseType('matrix<(number | string)^(2x2)>');
    const b = parseType('list<string | list<integer>>');
    const m = reduceType({ kind: 'intersection', types: [a, b] });
    expect(typeof m === 'object' && m.kind === 'intersection').toBe(true);
  });
});

describe('rows of every rank and lists of length 0', () => {
  it('reads the rows of a rank-3 tensor as matrices', () => {
    // The rows of a 2×2×2 tensor are 2×2 matrices: a list of strings or
    // integer 2-vectors holds none, a list of strings or 2×2 integer
    // matrices holds a 2×2×2 integer tensor.
    const a = parseType('tensor<(number | string)^(2x2x2)>');
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [a, parseType('list<string | list<integer^2>>')],
        })
      )
    ).toBe('never');
    const m = reduceType({
      kind: 'intersection',
      types: [a, parseType('list<string | matrix<integer^(2x2)>>')],
    });
    expect(typeof m === 'object' && m.kind === 'intersection').toBe(true);
    expect(isSubtype(parseType('tensor<integer^(2x2x2)>'), m)).toBe(true);
  });
  it('a list of length 0 is the empty list, which every plain list holds', () => {
    const a = parseType('list<string>');
    expect(typesOverlap(a, parseType('list<integer^0>'))).toBe(true);
    // A list of length 3 is never empty.
    expect(typesOverlap(a, parseType('list<integer^3>'))).toBe(false);
  });
});

describe('a dimensioned matrix of empty collections', () => {
  it('keeps the meet with a list of rows', () => {
    // A 2×2 matrix of empty sets is in both.
    const m = reduceType({
      kind: 'intersection',
      types: [
        parseType('matrix<set<integer>^(2x2)>'),
        parseType('list<list<set<string>>>'),
      ],
    });
    expect(typeToString(m)).not.toBe('never');
  });
});

describe('cases of the final review', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) &&
    typesOverlap(parseType(b), parseType(a));

  it('admits an alias of an indexed collection at a union parameter', () => {
    const ce = new ComputeEngine();
    ce.declareType('Q2', 'indexed_collection<integer>', { alias: true });
    ce.declare('f', '(broadcastable<number> | string) -> integer');
    ce.assign('f', ce.box(['Function', 1, 'x']));
    ce.declare('v', 'Q2');
    ce.assign('v', ce.box(['List', 1, 2]));
    expect(ce.box(['f', 'v']).evaluate().toString()).toBe('1');
  });

  it('meets a set and a tuple with a wider collection', () => {
    expect(meet('set<number>', 'collection<integer>')).toBe('set<integer>');
    expect(meet('tuple<number, number>', 'indexed_collection<integer>')).toBe(
      'tuple<integer, integer>'
    );
  });

  it('does not refute a bare collection name', () => {
    expect(meet('list', 'collection<integer>')).not.toBe('never');
    expect(overlap('list', 'collection<integer>')).toBe(true);
  });

  it('compares two broadcastables by their meet', () => {
    // `[1, 2]` is a `broadcastable<integer>` and a
    // `broadcastable<list<integer>>`.
    expect(
      overlap('broadcastable<integer>', 'broadcastable<list<integer>>')
    ).toBe(true);
  });

  it('meets deeply nested lists quickly', () => {
    const nest = (n: number, leaf: string) => {
      let t = leaf;
      for (let i = 0; i < n; i++) t = `list<${t}>`;
      return t;
    };
    const start = Date.now();
    meet(nest(32, 'number'), nest(33, 'integer'));
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('cells of nested rows, and two broadcastables', () => {
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) ||
    typesOverlap(parseType(b), parseType(a));
  it('needs rows that can match, not only cells that are strings', () => {
    // The rows of a 3×2 grid of strings are string 2-lists, not numbers.
    expect(overlap('matrix<string^(3x2)>', 'collection<number>')).toBe(false);
  });
  it('two broadcastables share the empty list', () => {
    // `broadcastable<integer>` is `integer | tensor<integer>` and
    // `broadcastable<string>` is `string | tensor<string>` (a string
    // cannot hold a list): the meet is a tensor whose cells are `never`,
    // which holds the empty list (it was `list<never>` while the string arm
    // was `list<string>`).
    expect(overlap('broadcastable<integer>', 'broadcastable<string>')).toBe(
      true
    );
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [
            parseType('broadcastable<integer>'),
            parseType('broadcastable<string>'),
          ],
        })
      )
    ).toBe('tensor<never>');
  });
});

describe('cases of the second review', () => {
  it('compares an alias through its definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('A', 'list<integer>', { alias: true });
    const T = (s: string) => ce.type(s).type;
    const meet = (a: string, b: string) =>
      typeToString(reduceType({ kind: 'intersection', types: [T(a), T(b)] }));
    // As `list<list<integer>>`: its meet with `list<list<string>>` is the
    // lists of empty lists, and `list<list<integer>>` is kept whole.
    expect(meet('list<A>', 'list<list<string>>')).toBe('list<list<never>>');
    expect(meet('list<A>', 'list<list<integer>>')).toBe('list<A>');
    expect(typesOverlap(T('list<A>'), T('list<list<integer>>'))).toBe(true);
    ce.declareType('U', 'integer | string', { alias: true });
    expect(
      typeToString(
        reduceType({ kind: 'intersection', types: [T('U'), T('number')] })
      )
    ).toBe('integer');
  });

  it('meets a bare set and a bare tuple with a wider collection', () => {
    const meet = (a: string, b: string) =>
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [parseType(a), parseType(b)],
        })
      );
    expect(meet('set', 'collection<integer>')).toBe('set<integer>');
    expect(meet('tuple', 'indexed_collection<integer>')).not.toBe('never');
  });

  it('compares a union arm by arm', () => {
    // Neither arm of `vector<integer^2> | integer` shares a value with
    // `collection<string>`; the arm `list<integer>` would, through `[]`.
    const a = parseType('vector<integer^2> | integer');
    const b = parseType('collection<string>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
    expect(typesOverlap(parseType('list<integer> | integer'), b)).toBe(true);
  });
});

describe('recursive and row aliases', () => {
  it('reads a bare recursive arm as no value', () => {
    // The values of `C = C | integer` are those of `integer`.
    const ce = new ComputeEngine();
    ce.declareType('C', 'C | integer', { alias: true });
    const T = (s: string) => ce.type(s).type;
    expect(typesOverlap(T('C'), T('string'))).toBe(false);
    expect(typesOverlap(T('C'), T('number'))).toBe(true);
  });
  it('reads a row alias as its definition', () => {
    // An integer 2×2 matrix is in both.
    const ce = new ComputeEngine();
    ce.declareType('Row', 'list<integer>', { alias: true });
    const T = (s: string) => ce.type(s).type;
    expect(typesOverlap(T('list<number>'), T('collection<Row>'))).toBe(true);
  });
});

describe('aliases that name each other', () => {
  it('meet in a bounded time', () => {
    const ce = new ComputeEngine();
    ce.declareType('X', 'list<X> | set<X> | collection<X> | integer', {
      alias: true,
    });
    ce.declareType('Y', 'list<Y | X> | collection<Y> | set<Y | X> | string', {
      alias: true,
    });
    ce.declareType(
      'Z',
      'list<Z | Y> | set<Z | X> | indexed_collection<Z | Y> | boolean',
      { alias: true }
    );
    ce.declareType(
      'V',
      'list<V | X> | set<V | Y> | collection<V | Z> | number',
      { alias: true }
    );
    const T = (s: string) => ce.type(s).type;
    const start = Date.now();
    reduceType({
      kind: 'intersection',
      types: [T('set<V | X>'), T('collection<Y | Z>')],
    });
    // It did not finish in 300 s when each alias could unfold twice.
    expect(Date.now() - start).toBeLessThan(20000);
  });
});

describe('a cut alias and rows with an empty axis', () => {
  it('refutes a cut alias that is provably disjoint', () => {
    const ce = new ComputeEngine();
    ce.declareType('A', 'tuple<A> | integer', { alias: true });
    const T = (s: string) => ce.type(s).type;
    expect(typesOverlap(T('A'), T('tuple<string>'))).toBe(false);
    expect(typesOverlap(T('A'), T('tuple<integer>'))).toBe(true);
  });
  it('does not take the cells of a matrix element as the elements', () => {
    // The elements of a list of matrices are matrices, never numbers,
    // whether the matrices have cells (2×3) or not (2×0): the meet with a
    // list of numbers is the empty list in both cases.
    const meet = (a: string, b: string) =>
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [parseType(a), parseType(b)],
        })
      );
    expect(meet('list<matrix<integer^(2x0)>>', 'list<number>')).toBe(
      'list<never>'
    );
    expect(meet('list<matrix<integer^(2x3)>>', 'list<number>')).toBe(
      'list<never>'
    );
  });
});

describe('two simple aliases and deep tensors', () => {
  it('meets two aliases of nominal types through their definitions', () => {
    const ce = new ComputeEngine();
    ce.declareType('NX', 'record{v: integer}');
    ce.declareType('NY', 'record{v: integer}');
    ce.declareType('AA', 'NX', { alias: true });
    ce.declareType('BB', 'NY', { alias: true });
    const T = (s: string) => ce.type(s).type;
    expect(
      typeToString(
        reduceType({ kind: 'intersection', types: [T('AA'), T('BB')] })
      )
    ).toBe('never');
    expect(typesOverlap(T('record{v: AA}'), T('record{v: BB}'))).toBe(false);
  });
  it('a list nested six deep shares the empty list with a list of numbers', () => {
    // Its elements are lists, not numbers, so the empty list is the one
    // value in both.
    let l6 = 'integer';
    for (let i = 0; i < 6; i++) l6 = `list<${l6}>`;
    expect(typesOverlap(parseType(l6), parseType('list<number>'))).toBe(true);
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [parseType(l6), parseType('list<number>')],
        })
      )
    ).toBe('list<never>');
  });
});

describe('a long chain of aliases with no cycle', () => {
  it('is followed to its end', () => {
    const ce = new ComputeEngine();
    ce.declareType('A0', 'list<integer>', { alias: true });
    for (let i = 1; i <= 5; i++)
      ce.declareType(`A${i}`, `A${i - 1}`, { alias: true });
    const T = (s: string) => ce.type(s).type;
    // An integer matrix is in both.
    expect(typesOverlap(T('list<number>'), T('collection<A5>'))).toBe(true);
  });
});

describe('chains of aliases of nominal types', () => {
  it('are unfolded both', () => {
    const ce = new ComputeEngine();
    ce.declareType('NX', 'record{v: integer}');
    ce.declareType('NY', 'record{v: integer}');
    ce.declareType('A0', 'NX', { alias: true });
    ce.declareType('A1', 'A0', { alias: true });
    ce.declareType('B0', 'NY', { alias: true });
    ce.declareType('B1', 'B0', { alias: true });
    const T = (s: string) => ce.type(s).type;
    expect(typesOverlap(T('record{v: A1}'), T('record{v: B1}'))).toBe(false);
  });
});

describe('the protocol rule for nested cells', () => {
  it('does not count cells that share empty collections only', () => {
    // A fixed-length list of empty sets is never empty, and the empty set
    // is the only value `set<never>` shares with `set<integer>`.
    const a = parseType('list<set<never>^2>');
    const b = parseType('collection<set<integer>>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a branching chain of row aliases', () => {
  it('is searched in a bounded time', () => {
    const ce = new ComputeEngine();
    ce.declareType('R0', 'string', { alias: true });
    // The cells of a list with a length cannot be lists, and an alias of a
    // list is refused as such a cell, so the chain uses tuples of fixed
    // lengths.
    for (let n = 1; n <= 20; n++)
      ce.declareType(
        `R${n}`,
        `tuple<R${n - 1}, R${n - 1}> | tuple<R${n - 1}, R${n - 1}, R${n - 1}>`,
        { alias: true }
      );
    const T = (s: string) => ce.type(s).type;
    const start = Date.now();
    // Every arm of `R20` is a tuple of fixed length: never empty, and its
    // elements are not numbers.
    expect(typesOverlap(T('R20'), T('collection<number>'))).toBe(false);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('the meet of two collections of the same kind', () => {
  const meetOf = (a: string, b: string) =>
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] });
  const meet = (a: string, b: string) => typeToString(meetOf(a, b));
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) ||
    typesOverlap(parseType(b), parseType(a));
  // `witness` is a value of `a` and of `b`, and must be a value of the meet.
  const holds = (a: string, b: string, witness: string) => {
    const w = parseType(witness);
    expect(sub(witness, a) && sub(witness, b)).toBe(true);
    expect(isSubtype(w, meetOf(a, b))).toBe(true);
    expect(isSubtype(w, meetOf(b, a))).toBe(true);
    expect(overlap(a, b)).toBe(true);
  };

  it('keeps two lists whose elements are rows', () => {
    // An integer matrix is a list of number vectors and a list of integer
    // lists; the meet is the list of integer vectors.
    holds(
      'list<vector<number>>',
      'list<list<integer>>',
      'matrix<integer^(2x2)>'
    );
    // `vector<number> & list<integer>` is spelled `list<integer>`: a list
    // of integers and an open-length vector of integers are the same values.
    expect(meet('list<vector<number>>', 'list<list<integer>>')).toBe(
      'list<list<integer>>'
    );
    // Two lists whose elements share nothing share the empty list.
    expect(meet('list<integer>', 'list<string>')).toBe('list<never>');
    expect(meet('list<number>', 'list<list<integer>>')).toBe('list<never>');
  });

  it('keeps two collections whose elements are rows', () => {
    holds(
      'collection<indexed_collection<integer>>',
      'collection<vector<number>>',
      'matrix<integer^(2x2)>'
    );
    // The rows of a 2×2×2 boolean grid are 2×2 boolean grids, which are
    // lists of boolean 2-lists.
    holds(
      'indexed_collection<list<list<boolean>>>',
      'indexed_collection<list<list<boolean^2>> | boolean>',
      'tensor<boolean^(2x2x2)>'
    );
  });

  it('meets two fixed shapes axis by axis', () => {
    // An open axis meets a fixed one as the fixed one; the cells are met.
    expect(meet('matrix<number^(2x2)>', 'matrix<integer^(2x?)>')).toBe(
      'matrix<integer^(2x2)>'
    );
    expect(meet('matrix<integer^(2x?)>', 'matrix<number^(2x3)>')).toBe(
      'matrix<integer^(2x3)>'
    );
    expect(meet('matrix<number^(-1x2)>', 'matrix<integer^(3x?)>')).toBe(
      'matrix<integer^(3x2)>'
    );
    expect(meet('list<number^2>', 'list<integer^-1>')).toBe(
      'vector<integer^2>'
    );
    expect(overlap('matrix<number^(2x2)>', 'matrix<integer^(2x?)>')).toBe(true);
  });

  it('refutes two fixed shapes with no common value', () => {
    // Two different fixed lengths, two different ranks, or two cell types
    // with no common value.
    expect(meet('matrix<number^(2x2)>', 'matrix<number^(2x3)>')).toBe('never');
    expect(meet('matrix<number^(2x2)>', 'list<number^2>')).toBe('never');
    expect(meet('list<number^2>', 'matrix<integer^(2x?)>')).toBe('never');
    expect(meet('list<number^2>', 'list<string^2>')).toBe('never');
  });

  it('reads the rows of a matrix with an open first axis', () => {
    // The rows of a `matrix<integer^(?x2)>` are integer 2-vectors, never
    // lists of strings; a list of length 0 and a matrix with a first axis
    // of length 0 differ in rank.
    expect(overlap('matrix<integer^(-1x2)>', 'list<list<string>>')).toBe(false);
    expect(overlap('list<integer^0>', 'matrix<integer^(0x2)>')).toBe(false);
  });

  it('does not give a matrix that a list with one axis does not hold', () => {
    // `matrix<number^(3x2)>` is not a `list<unknown^3>`: its cells are in
    // `unknown`, so the subtype rule reads it with two axes.
    const m = meetOf('list<unknown^3>', 'matrix<number^(3x2)>');
    expect(typeToString(m)).not.toBe('matrix<3x2>');
    expect(sub('matrix<number^(3x2)>', 'list<unknown^3>')).toBe(false);
    // Rows with an axis of length -1 can differ in length.
    expect(meet('list<unknown^-1>', 'matrix<number^(3x-1)>')).not.toBe(
      'list<vector^3>'
    );
  });

  it('keeps a list of matrices in a bare list of lists', () => {
    // A 3×2×2 integer tensor is a list of three 2×2 matrices, and a list
    // of lists.
    holds(
      'list<list>',
      'list<matrix<integer^(2x2)>>',
      'tensor<integer^(3x2x2)>'
    );
    expect(meet('list<list>', 'list<matrix<integer^(2x2)>>')).toBe(
      'list<matrix<integer^(2x2)>>'
    );
    // A list of integers of length 3 is a `list<unknown^3>`.
    expect(meet('list<unknown^3>', 'list<integer>')).toBe('vector<integer^3>');
  });

  it('reads the rows of a rank-3 tensor as matrices, two levels down', () => {
    // The rows of a 2×2×2 integer tensor are 2×2 matrices, which are lists
    // of integer lists and lists of number vectors.
    holds(
      'list<list<list<integer>>>',
      'list<list<vector<number>>>',
      'tensor<integer^(2x2x2)>'
    );
    holds(
      'list<list<list<boolean>>>',
      'list<list<list<boolean^2>>>',
      'tensor<boolean^(2x2x2)>'
    );
  });

  it('reads a bare collection name as its unrestricted form', () => {
    expect(meet('list<any^3>', 'list')).toBe('list<any^3>');
    expect(overlap('list<any^3>', 'list')).toBe(true);
  });
});

describe('the meet of two collections of the same kind: precision', () => {
  const meetOf = (a: string, b: string) =>
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] });
  const meet = (a: string, b: string) => typeToString(meetOf(a, b));

  it('does not merge a list of 2-lists into a 2×2 grid', () => {
    const a = 'list<unknown^2>';
    const b = 'list<list<any^2>>';
    expect(meet(a, b)).not.toBe('matrix<any^(2x2)>');
    // A rank-3 tensor is in neither type: it has rank 3, not 1, and its
    // rows are matrices, not 2-lists.
    expect(sub('tensor<integer^(2x2x2)>', a)).toBe(false);
    expect(sub('tensor<integer^(2x2x2)>', b)).toBe(false);
  });

  it('meets two lists with no dimensions elementwise when that holds every value', () => {
    // The meet `list<…>` reads its values at any depth.
    expect(meet('list<list<integer>>', 'list<list<number^2>>')).toBe(
      'list<vector<integer^2>>'
    );
    expect(meet('list<string>', 'list<list<integer>>')).toBe('list<never>');
  });
});

describe('recursive aliases', () => {
  const ce = new ComputeEngine();
  const alias = (name: string, def: string) =>
    ce.declareType(name, def, { alias: true });
  alias('json', 'list<json> | integer');
  alias('C', 'C | integer');
  alias('TA', 'tuple<TA> | integer');
  alias('TB', 'tuple<TB> | string');
  alias('LA', 'list<LA> | integer');
  alias('LB', 'list<LB> | string');
  alias('RA', 'record{v: RA} | integer');
  alias('RB', 'record{v: RB} | string');
  const T = (s: string) => ce.type(s).type;
  const meetOf = (a: string, b: string) =>
    reduceType({ kind: 'intersection', types: [T(a), T(b)] });
  const overlap = (a: string, b: string) =>
    typesOverlap(T(a), T(b)) || typesOverlap(T(b), T(a));

  it('couldMatch reads the arms of a recursive alias', () => {
    // `json` and `number` share every integer.
    expect(couldMatch(T('number'), T('json'))).toBe(true);
    expect(couldMatch(T('json'), T('number'))).toBe(true);
    expect(couldMatch(T('string'), T('json'))).toBe(false);
    expect(couldMatch(T('list<integer>'), T('json'))).toBe(true);
    expect(couldMatch(T('json'), T('json'))).toBe(true);
    // The values of `C = C | integer` are those of `integer`.
    expect(couldMatch(T('C'), T('number'))).toBe(true);
    expect(couldMatch(T('C'), T('string'))).toBe(false);
  });

  it('refutes two recursive aliases that share no finite value', () => {
    // A shared tuple would hold a smaller shared value in its slot.
    expect(typeToString(meetOf('TA', 'TB'))).toBe('never');
    expect(overlap('TA', 'TB')).toBe(false);
    expect(typeToString(meetOf('RA', 'RB'))).toBe('never');
    expect(overlap('RA', 'RB')).toBe(false);
    expect(overlap('tuple<TA>', 'tuple<TB>')).toBe(false);
    expect(overlap('TA', 'tuple<integer>')).toBe(true);
    expect(overlap('TA', 'TA')).toBe(true);
  });

  it('keeps two recursive aliases that share lists', () => {
    // `[]` and `[[]]` are in both.
    const m = meetOf('LA', 'LB');
    expect(typeToString(m)).not.toBe('never');
    expect(isSubtype(T('list<never>'), m)).toBe(true);
    expect(isSubtype(T('list<list<never>>'), m)).toBe(true);
    // They share empty lists only, which the protocol rule does not count,
    // but no proof refutes the pair, so the overlap test keeps the safe
    // answer.
    expect(overlap('LA', 'LB')).toBe(true);
  });
});

describe('chains of aliases with two branches at each level', () => {
  it('are compared in a time that grows with the depth only', () => {
    const ce = new ComputeEngine();
    ce.declareType('A0', 'integer', { alias: true });
    ce.declareType('B0', 'string', { alias: true });
    ce.declareType('R0', 'integer', { alias: true });
    ce.declareType('S0', 'number', { alias: true });
    // The cells of a list with a length cannot be lists, and an alias of a
    // list is refused as such a cell, so the chains use tuples.
    const pairOrTriple = (x: string) =>
      `tuple<${x}, ${x}> | tuple<${x}, ${x}, ${x}>`;
    for (let n = 1; n <= 32; n++) {
      ce.declareType(`A${n}`, pairOrTriple(`A${n - 1}`), { alias: true });
      ce.declareType(`B${n}`, pairOrTriple(`B${n - 1}`), { alias: true });
      ce.declareType(`R${n}`, pairOrTriple(`R${n - 1}`), { alias: true });
      ce.declareType(
        `S${n}`,
        `tuple<S${n - 1}> | tuple<S${n - 1}, S${n - 1}>`,
        { alias: true }
      );
    }
    const T = (s: string) => ce.type(s).type;
    const meet = (a: string, b: string) =>
      reduceType({ kind: 'intersection', types: [T(a), T(b)] });
    // Each of these took seconds to minutes at depth 20 (the work doubled
    // at each level). They now take milliseconds at depth 32.
    const start = Date.now();
    expect(typesOverlap(T('A32'), T('B32'))).toBe(false);
    expect(couldMatch(T('A32'), T('B32'))).toBe(false);
    expect(provablyDisjoint(T('A32'), T('B32'))).toBe(true);
    meet('A32', 'B32');
    meet('R32', 'S32');
    meet('tuple<R32, R32>', 'tuple<S32, S32>');
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('cases of the review of the recursive-alias fixes', () => {
  it('compares a chain of self-recursive aliases in a bounded time', () => {
    const ce = new ComputeEngine();
    const alias = (name: string, def: string) =>
      ce.declareType(name, def, { alias: true });
    alias('A0', 'integer');
    alias('B0', 'string');
    for (let k = 1; k <= 32; k++) {
      alias(
        `A${k}`,
        `tuple<A${k - 1}> | tuple<A${k - 1}, integer> | tuple<type A${k}>`
      );
      alias(
        `B${k}`,
        `tuple<B${k - 1}> | tuple<B${k - 1}, integer> | tuple<type B${k}>`
      );
    }
    const T = (s: string) => ce.type(s).type;
    // It did not finish in 60 s at depth 12 when a `false` reached through
    // the self arm was never kept.
    const start = Date.now();
    expect(couldMatch(T('A32'), T('B32'))).toBe(false);
    expect(
      typeToString(
        reduceType({ kind: 'intersection', types: [T('A12'), T('B12')] })
      )
    ).toBe('never');
    expect(typesOverlap(T('A12'), T('B12'))).toBe(false);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('does not overflow the stack on a generic alias whose arguments grow', () => {
    const ce = new ComputeEngine();
    ce.declareType('GA', 'type GB<list<T>> | integer', {
      alias: true,
      typeParams: ['T'],
    });
    ce.declareType('GB', 'GA<T>', { alias: true, typeParams: ['T'] });
    const T = (s: string) => ce.type(s).type;
    const g = T('GA<integer>');
    for (const other of ['any', 'string', 'integer', 'list<string>']) {
      const t = T(other);
      expect(() => couldMatch(g, t)).not.toThrow();
      expect(() => isSubtype(g, t)).not.toThrow();
      expect(() => isSubtype(t, g)).not.toThrow();
      expect(() => provablyDisjoint(g, t)).not.toThrow();
      expect(() => typesOverlap(g, t)).not.toThrow();
      expect(() =>
        reduceType({ kind: 'intersection', types: [g, t] })
      ).not.toThrow();
    }
    expect(isSubtype(T('integer'), g)).toBe(true);
  });

  it('meets lists of recursive aliases elementwise when that holds every value', () => {
    const ce = new ComputeEngine();
    const alias = (name: string, def: string) =>
      ce.declareType(name, def, { alias: true });
    alias('json', 'list<json> | integer');
    alias('M', 'list<M^2> | integer');
    alias('Y', 'collection<Y> | integer');
    const T = (s: string) => ce.type(s).type;
    const meet = (a: string, b: string) =>
      typeToString(reduceType({ kind: 'intersection', types: [T(a), T(b)] }));
    // `json` holds every element of its lists, so an integer matrix, which
    // is in both, is a `list<integer>`.
    expect(meet('list<number>', 'list<json>')).toBe('list<integer>');
    expect(meet('list<string>', 'list<json>')).toBe('list<never>');
    // A list of `M` has two elements: it is never empty.
    expect(meet('list<string>', 'M')).toBe('never');
    expect(meet('list<string>', 'Y')).toBe('list<never>');
  });
});

describe('cases of the third review', () => {
  it('does not refute a cut alias without a proof', () => {
    const ce = new ComputeEngine();
    ce.declareType('NA', 'list<NA> | (number & !integer)', { alias: true });
    ce.declareType('FA', 'list<FA> | ((integer) -> integer)', { alias: true });
    const T = (s: string) => ce.type(s).type;
    // `[[[0.5]]]` is in both.
    expect(typesOverlap(T('NA'), T('list<list<list<real>>>'))).toBe(true);
    // A function `(number) -> integer` is in both.
    expect(
      typesOverlap(T('FA'), T('list<list<list<(number) -> number>>>'))
    ).toBe(true);
  });

  it('keeps matrices whose cells share values that couldMatch does not see', () => {
    const holds = (a: string, b: string, witness: string) => {
      const w = parseType(witness);
      expect(sub(witness, a) && sub(witness, b)).toBe(true);
      const m = reduceType({
        kind: 'intersection',
        types: [parseType(a), parseType(b)],
      });
      expect(isSubtype(w, m)).toBe(true);
    };
    // The elements of a 2×2 grid are its rows: each operand must admit the
    // rows, and the meet is read row by row.
    holds(
      'list<list<tuple<number & !integer>>>',
      'collection<list<tuple<real>>>',
      'matrix<tuple<real & !integer>^(2x2)>'
    );
    holds(
      'list<list<record{a: (integer) -> integer}>>',
      'collection<list<record{a: (number) -> number}>>',
      'matrix<record{a: (number) -> integer}^(2x2)>'
    );
    holds(
      'list<list<(integer) -> integer>>',
      'list<list<(number) -> number>>',
      'matrix<((number) -> integer)^(2x2)>'
    );
    holds(
      'list<list<(integer) -> integer>>',
      'collection<list<(number) -> number>>',
      'matrix<((number) -> integer)^(2x2)>'
    );
  });

  it('does not take an application of a generic alias as a repeat', () => {
    const ce = new ComputeEngine();
    ce.declareType('Id', 'T', { alias: true, typeParams: ['T'] });
    const T = (s: string) => ce.type(s).type;
    // An integer matrix is a list of integer lists (through the alias) and
    // a collection of number lists.
    const a = T('list<Id<Id<list<integer>>>>');
    const b = T('collection<list<number>>');
    const w = T('matrix<integer^(2x2)>');
    expect(isSubtype(w, a) && isSubtype(w, b)).toBe(true);
    expect(
      isSubtype(w, reduceType({ kind: 'intersection', types: [a, b] }))
    ).toBe(true);
  });

  it('follows a long chain of aliases to its end', () => {
    const ce = new ComputeEngine();
    ce.declareType('C0', 'integer', { alias: true });
    for (let n = 1; n <= 300; n++)
      ce.declareType(`C${n}`, `C${n - 1}`, { alias: true });
    const T = (s: string) => ce.type(s).type;
    expect(isSubtype(T('C300'), T('number'))).toBe(true);
    expect(isSubtype(T('list<C300>'), T('list<number>'))).toBe(true);
  });

  it('compares a graph of aliases that reach one alias twice in a bounded time', () => {
    const ce = new ComputeEngine();
    const alias = (name: string, def: string) =>
      ce.declareType(name, def, { alias: true });
    alias('V0', 'integer');
    for (let n = 1; n <= 32; n++) {
      alias(`A${n}`, `V${n - 1}`);
      alias(`B${n}`, `V${n - 1} | integer`);
      alias(`V${n}`, `A${n} | B${n}`);
    }
    alias('R0', 'list<R0> | integer');
    alias('S0', 'list<integer | list<integer | list<number>>> | integer');
    // The cells of a list with a length cannot be lists, and an alias of a
    // list is refused as such a cell, so the chains use tuples.
    for (let n = 1; n <= 22; n++) {
      const r = `R${n - 1}`;
      const s = `S${n - 1}`;
      alias(`R${n}`, `tuple<${r}, ${r}> | tuple<${r}, ${r}, ${r}>`);
      alias(`S${n}`, `tuple<${s}, ${s}> | tuple<${s}, ${s}, ${s}>`);
    }
    const T = (s: string) => ce.type(s).type;
    // About 100 s at depth 24 before, and 23 s for the subtype test.
    const start = Date.now();
    expect(
      typeToString(
        reduceType({
          kind: 'intersection',
          types: [T('list<V32>'), T('list<list<string>>')],
        })
      )
    ).toBe('list<never>');
    // Two lists with no dimensions share the empty list.
    expect(typesOverlap(T('list<V32>'), T('list<list<string>>'))).toBe(true);
    isSubtype(T('R22'), T('S22'));
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('a list with dimensions holds no list as a cell', () => {
  // A list with dimensions is read by its cells and its rank: a matrix is
  // not a vector of anything, and a plain list of vectors has no fixed
  // length.
  it('does not hold a list of rows', () => {
    expect(sub('matrix<integer>', 'vector<unknown>')).toBe(false);
    expect(sub('list<matrix<integer^(2x2)>>', 'vector<unknown>')).toBe(false);
    expect(sub('tensor<integer^(2x2x2)>', 'list<any^2>')).toBe(false);
    expect(sub('list<vector<integer^2>>', 'list<unknown^3>')).toBe(false);
  });

  it('is transitive with the rank rule', () => {
    // `tensor<integer^(2x2x2)>` is a list of two 2×2 matrices, and neither
    // it nor that list is a `vector<unknown>`.
    expect(sub('tensor<integer^(2x2x2)>', 'list<matrix<integer^(2x2)>>')).toBe(
      true
    );
    expect(sub('tensor<integer^(2x2x2)>', 'vector<unknown>')).toBe(false);
    expect(sub('list<matrix<integer^(2x2)>>', 'vector<unknown>')).toBe(false);
  });

  it('holds scalars, tuples and sets', () => {
    expect(sub('list<integer^3>', 'vector<unknown>')).toBe(true);
    expect(sub('list<unknown^3>', 'list<unknown^3>')).toBe(true);
    expect(sub('list<tuple<real, real>^3>', 'vector<unknown>')).toBe(true);
    expect(sub('list<string^3>', 'vector<unknown>')).toBe(true);
    expect(sub('list<set<integer>^2>', 'vector<unknown>')).toBe(true);
  });

  it('leaves a list with no dimensions unchanged', () => {
    // A plain list of lists is a plain list of anything, and a plain list
    // of 3-vectors is a plain list of lists.
    expect(sub('list<list>', 'list<unknown>')).toBe(true);
    expect(sub('list<vector<integer^3>>', 'list<list>')).toBe(true);
  });
});

describe('the meet of a list with dimensions', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  it('keeps the cells of the other type under its shape', () => {
    // A list of three integers is a `list<any^3>` and a `list<integer>`.
    expect(meet('list<any^3>', 'list<integer>')).toBe('vector<integer^3>');
    expect(meet('list<unknown^3>', 'list<integer>')).toBe('vector<integer^3>');
    // A bare `list` admits any contents, as `list<any>` does.
    expect(meet('list<any^3>', 'list')).toBe('list<any^3>');
  });
  it('is empty when the shapes exclude each other', () => {
    // A 2-vector of integers is not a list of strings, and a vector is not
    // a matrix.
    expect(meet('list<string>', 'list<integer^2>')).toBe('never');
    expect(meet('vector<integer>', 'matrix<integer>')).toBe('never');
    expect(meet('matrix<any^(3x2)>', 'vector<any>')).toBe('never');
  });
});

describe('cases of the review of the scalar elements of a vector', () => {
  it('solves a generic list parameter from the cells and the length', () => {
    // `list<T^N>` binds `T` to the cells and `N` to the length of a
    // dimensioned list; a plain list of rows has no length, so `N` stays
    // unsolved (its type is a non-negative integer) and `T` is unknown.
    const ce = new ComputeEngine();
    ce.declare('v2', 'list<integer^2>');
    ce.declare('vv', 'list<list<integer>>');
    ce.declare('mm', 'matrix<integer^(2x2)>');
    ce.declare('g', '(list<T^N>) -> T where T, N');
    ce.declare('k', '(list<T^N>) -> N where T, N');
    ce.declare('gv', '(vector<T^N>) -> T where T, N');
    ce.declare('m', '(matrix<T^(M x N)>) -> T where T, M, N');
    const call = (f: string, x: string) =>
      ce.function(f, [ce.symbol(x)]).type.toString();
    expect(call('g', 'v2')).toBe('integer');
    expect(call('k', 'v2')).toBe('2');
    expect(call('gv', 'v2')).toBe('integer');
    expect(call('m', 'mm')).toBe('integer');
    expect(call('g', 'vv')).toBe('unknown');
    expect(call('k', 'vv')).toBe('integer<0..>');
  });

  it('a plain list of vectors is a plain list of anything', () => {
    expect(
      typesOverlap(
        parseType('list<vector<integer^3>>'),
        parseType('list<unknown>')
      )
    ).toBe(true);
    expect(sub('list<vector<integer^3>>', 'list<unknown>')).toBe(true);
    expect(sub('list<vector<integer^3>>', 'list<unknown^3>')).toBe(false);
  });

  it('keeps the shape of a generic parameter in its loosest reading', () => {
    const ce = new ComputeEngine();
    ce.declare('mtt', 'matrix<integer^(2x3)>');
    ce.declare('vfive', 'list<integer^5>');
    ce.declare('s', 'string');
    ce.declare('g3', '(list<T^3>) -> T where T');
    ce.declare('m', '(matrix<T^(M x N)>) -> T where T, M, N');
    ce.declare('h', '(list<T^3>, T) -> T where T');
    const call = (f: string, ...xs: string[]) =>
      ce
        .function(
          f,
          xs.map((x) => ce.symbol(x))
        )
        .type.toString();
    // An operand of another length or rank gives no bound to `T`. Such an
    // operand shares no value with the parameter (no 2×3 matrix is a list
    // of length 3, no list of length 5 is a matrix), so the call is refused
    // when it is boxed, as a library operator refuses it.
    expect(call('g3', 'mtt')).toBe('error');
    expect(call('m', 'vfive')).toBe('error');
    expect(call('h', 'vfive', 's')).toBe('error');
    // A generic nominal constructor refuses a payload of another length.
    ce.declareType('vthree', 'list<T^3>', { typeParams: ['T'] });
    ce.assign(
      'vthree',
      ce.box([
        'Function',
        ['List', 'x', 'x', 'x', 'x', 'x'],
        ['Typed', 'x', { str: 'integer' }],
      ])
    );
    expect(ce.box(['vthree', 4]).evaluate().toString()).toBe('vthree(4)');
  });

  it('a range is a list, so it cannot be the cell of a list with dimensions', () => {
    expect(() => parseType('list<range^2>')).toThrow(
      /cells of a list with a length cannot be lists/
    );
    expect(sub('list<range>', 'list<unknown>')).toBe(true);
  });

  it('reads no element in a list with an axis of length 0', () => {
    expect(sub('list<never^0>', 'list<unknown^0>')).toBe(true);
    expect(sub('matrix<never^(2x0)>', 'matrix<unknown^(2x0)>')).toBe(true);
  });
});

/**
 * A broadcast over an operand whose rank is not known maps a value of the
 * operand at its leaves, at whatever depth they are. The result type must
 * hold every value the call can evaluate to. Before 2026-10-22 three
 * readings gave one list level (`list<R>`), a type that does not hold the
 * value when the operand holds a matrix:
 *
 * - an operand declared `broadcastable<T>`, `any` or `list<any>`
 *   (`broadcastShapedResultType`, `common/type/utils.ts`);
 * - a `broadcastable<T>` trigger of the arm-by-arm typing of tuple cells,
 *   read as a rank-1 `list<T>` (`broadcastLiftType`);
 * - the call of a generic function literal over such an operand, or over an
 *   `indexed_collection` of lists (`genericLiftLevels`, `boxed-function.ts`,
 *   and `liftedElementTypeOf`, `common/type/instantiate.ts`).
 */
describe('a broadcast over an operand of unknown rank holds the value', () => {
  const MATRIX = ['List', ['List', 1, 2], ['List', 3, 4]];
  const RAGGED = ['List', ['List', 1, 2], ['List', 3]];

  /** The static type of `expr` with `name` declared `decl` and assigned
   * `value`, after a check that the evaluated value is in it. */
  const typed = (
    decl: string,
    value: any,
    expr: any,
    setup?: (ce: ComputeEngine) => void
  ): string => {
    const ce = new ComputeEngine();
    setup?.(ce);
    ce.declare('b', decl);
    ce.assign('b', ce.box(value));
    const e = ce.box(expr);
    const evaluated = e.evaluate();
    expect(evaluated.type.matches(e.type)).toBe(true);
    expect(isSubtype(evaluated.type.type, e.type.type)).toBe(true);
    return e.type.toString();
  };

  it('a broadcastable of numbers that holds a matrix gives a tensor', () => {
    const d = 'broadcastable<number>';
    expect(typed(d, MATRIX, ['Negate', 'b'])).toBe('tensor');
    expect(typed(d, MATRIX, ['Sin', 'b'])).toBe('tensor');
    expect(typed(d, MATRIX, ['Add', 'b', 1])).toBe('tensor');
    expect(typed(d, MATRIX, ['Less', 'b', 2])).toBe('tensor<boolean>');
  });

  it('an operand of any depth gives a list of cells or lists', () => {
    for (const d of ['any', 'list<any>']) {
      expect(typed(d, MATRIX, ['Negate', 'b'])).toBe('list<any>');
      expect(typed(d, MATRIX, ['Sin', 'b'])).toBe('list<list<any> | number>');
      expect(typed(d, MATRIX, ['Add', 'b', 1])).toBe('list<any>');
      expect(typed(d, MATRIX, ['Less', 'b', 2])).toBe(
        'list<boolean | list<any>>'
      );
    }
  });

  it('a broadcastable of points that holds rows of points gives a tensor', () => {
    const d = 'broadcastable<tuple<number, number>>';
    const rows = ['List', ['List', ['Tuple', 3, 4]], ['List', ['Tuple', 6, 8]]];
    const points = ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]];
    for (const value of [rows, points]) {
      expect(typed(d, value, ['Negate', 'b'])).toBe(
        'tensor<tuple<number, number>>'
      );
      expect(typed(d, value, ['Multiply', 2, 'b'])).toBe(
        'tensor<tuple<number, number>>'
      );
      expect(typed(d, value, ['Add', 'b', 'b'])).toBe(
        'tensor<tuple<number, number>>'
      );
      expect(typed(d, value, ['Sin', 'b'])).toBe(
        'tensor<tuple<number, number>>'
      );
    }
    // The norm of each point. The value `[[5], [10]]` is typed with
    // `integer` cells, which do not state the sign, so the check is on a
    // type that states it.
    const ce = new ComputeEngine();
    ce.declare('b', d);
    ce.assign('b', ce.box(rows as any));
    const abs = ce.box(['Abs', 'b']);
    expect(abs.type.toString()).toBe('tensor<real<0..> | signed_infinity>');
    expect(abs.evaluate().toString()).toBe('[[5],[10]]');
    expect(
      isSubtype(parseType('matrix<integer<0..>^(2x1)>'), abs.type.type)
    ).toBe(true);
  });

  const generic = (ce: ComputeEngine) => {
    ce.declare('g', '(x: T) -> tuple<T, T> where T');
    ce.assign('g', ce.box(['Function', ['Tuple', 'x', 'x'], 'x'] as any));
  };

  it('a generic call over a broadcastable or an operand of any depth', () => {
    expect(typed('broadcastable<integer>', MATRIX, ['g', 'b'], generic)).toBe(
      'tensor<tuple<integer, integer>>'
    );
    expect(
      typed('broadcastable<integer>', ['List', 1, 2], ['g', 'b'], generic)
    ).toBe('tensor<tuple<integer, integer>>');
    for (const d of ['any', 'list<any>'])
      for (const value of [MATRIX, RAGGED, ['List', 1, 2]])
        expect(typed(d, value, ['g', 'b'], generic)).toBe(
          'list<list<any> | tuple<any, any>>'
        );
    // A broadcastable whose element is a list holds a list of rank 1 or 2.
    for (const value of [MATRIX, ['List', 1, 2]])
      expect(
        typed('broadcastable<list<integer^2>>', value, ['g', 'b'], generic)
      ).toBe('list<list<any> | tuple<integer, integer>>');
  });

  it('a generic call over an indexed collection of lists maps the leaves', () => {
    for (const value of [MATRIX, RAGGED])
      expect(
        typed('indexed_collection<list<integer>>', value, ['g', 'b'], generic)
      ).toBe('list<list<tuple<integer, integer>>>');
  });
});

describe('chains of aliases of plain lists, sets and tuples', () => {
  it('are met and compared in a bounded time', () => {
    const ce = new ComputeEngine();
    const alias = (name: string, def: string) =>
      ce.declareType(name, def, { alias: true });
    for (const [a, b] of [
      ['A', 'B'],
      ['P', 'Q'],
      ['C', 'D'],
    ]) {
      alias(`${a}0`, 'integer');
      alias(`${b}0`, 'string');
    }
    for (let n = 1; n <= 32; n++) {
      const [a, b, p, q, c, d] = ['A', 'B', 'P', 'Q', 'C', 'D'].map(
        (x) => `${x}${n - 1}`
      );
      alias(`A${n}`, `list<${a}> | list<list<${a}>>`);
      alias(`B${n}`, `list<${b}> | list<list<${b}>>`);
      alias(`P${n}`, `list<${p}> | set<${p}>`);
      alias(`Q${n}`, `list<${q}> | set<${q}>`);
      alias(`C${n}`, `tuple<${c}, ${c}> | list<${c}>`);
      alias(`D${n}`, `list<list<${d}>> | tuple<${d}, ${d}>`);
    }
    const T = (s: string) => ce.type(s).type;
    // The meet of two chains of depth 10 took 4.8 s, and the overlap of two
    // chains of tuples and lists of depth 16 took 23 s; at depth 32 neither
    // finished. Each pair below shares the empty list, and nothing else.
    const start = Date.now();
    for (const [a, b] of [
      ['A32', 'B32'],
      ['P32', 'Q32'],
      ['C32', 'D32'],
    ]) {
      const m = reduceType({ kind: 'intersection', types: [T(a), T(b)] });
      expect(isSubtype(T('list<never>'), m)).toBe(true);
      // The meet holds no value outside either operand.
      expect(isSubtype(m, T(a))).toBe(true);
      expect(isSubtype(m, T(b))).toBe(true);
      expect(typesOverlap(T(a), T(b))).toBe(true);
    }
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('keeps the meets of short chains in full', () => {
    const ce = new ComputeEngine();
    const alias = (name: string, def: string) =>
      ce.declareType(name, def, { alias: true });
    alias('C0', 'integer');
    alias('D0', 'string');
    for (let n = 1; n <= 2; n++) {
      alias(`C${n}`, `tuple<C${n - 1}, C${n - 1}> | list<C${n - 1}>`);
      alias(`D${n}`, `list<list<D${n - 1}>> | tuple<D${n - 1}, D${n - 1}>`);
    }
    const T = (s: string) => ce.type(s).type;
    expect(
      typeToString(
        reduceType({ kind: 'intersection', types: [T('C2'), T('D2')] })
      )
    ).toBe(
      'list<list<never>> | tuple<list<never>, list<never>>'
    );
  });
});

describe('an intersection against an alias of a union', () => {
  it('is a subtype of each of its members', () => {
    const ce = new ComputeEngine();
    ce.declareType('Z', 'list<integer> | set<integer>', { alias: true });
    ce.declareType('W', 'list<string> | set<string>', { alias: true });
    const T = (s: string) => ce.type(s).type;
    const m = { kind: 'intersection' as const, types: [T('Z'), T('W')] };
    expect(isSubtype(m, T('Z'))).toBe(true);
    expect(isSubtype(m, T('W'))).toBe(true);
    expect(isSubtype(m, T('list<integer> | set<integer>'))).toBe(true);
    expect(isSubtype(m, T('list<integer>'))).toBe(false);
  });
});
