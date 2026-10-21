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
 * `broadcastable<T>` is the union `T | list<T>`: a scalar `T`, or a list of
 * `T` that an element-wise operator maps over. It used to be
 * `T | indexed_collection<T>`, with a rule that refused tuples and strings.
 * Because `tuple<T> <: indexed_collection<T>`, that relation was not
 * transitive: `tuple<integer> <: indexed_collection<integer> <:
 * broadcastable<integer>`, but `tuple<integer>` was not a subtype of
 * `broadcastable<integer>`. With the list meaning, every subtype of
 * `list<T>` is a subtype of `broadcastable<T>`, and a tuple, which is not a
 * list, is outside both.
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

describe('broadcastable<T> is T | list<T>', () => {
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

  it('is a subtype of both T | list<T> and T | indexed_collection<T>', () => {
    expect(sub('broadcastable<integer>', 'integer | list<integer>')).toBe(true);
    expect(
      sub('broadcastable<integer>', 'integer | indexed_collection<integer>')
    ).toBe(true);
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
    for (const t of ['list<Colors^3>', 'list<Colors^2> | list<Colors^3>'])
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
    expect(meet('broadcastable<number>', 'indexed_collection<integer>')).toBe(
      'list<integer>'
    );
    expect(meet('indexed_collection<real>', 'collection<integer>')).toBe(
      'indexed_collection<integer>'
    );
  });

  it('overlaps when the elements overlap, as for two lists', () => {
    expect(
      overlap('broadcastable<number>', 'indexed_collection<integer>')
    ).toBe(true);
    expect(overlap('list<integer>', 'collection<string>')).toBe(false);
    expect(overlap('list<integer>', 'list<string>')).toBe(false);
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

  it('types a union of a list and a broadcastable as a list', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'list<integer> | broadcastable<integer>');
    expect(ce.box(['Add', 'u', 1]).type.toString()).toBe(
      'integer | list<integer>'
    );
    expect(ce.box(['Multiply', 2, 'u']).type.toString()).toBe(
      'integer | list<integer>'
    );
  });
});

describe('a matrix beside a wider collection', () => {
  // An element of `collection<E>` is a cell or a row of the matrix.
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b));
  it('overlaps when a cell or a row can be an element', () => {
    expect(overlap('list<integer^(2x3)>', 'collection<integer>')).toBe(true);
    expect(overlap('list<integer^(2x3)>', 'collection<list<integer>>')).toBe(
      true
    );
  });
  it('does not overlap when neither can be one', () => {
    expect(overlap('list<integer^(2x3)>', 'collection<string>')).toBe(false);
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
    expect(meet('list<integer^(2x3)>', 'collection<string>')).toBe('never');
  });
  it('is kept when cells can be empty collections of both types', () => {
    // A 2×3 grid of empty sets is in both types.
    expect(meet('list<set<integer>^(2x3)>', 'collection<set<string>>')).toBe(
      'list<set<integer>^(2x3)> & collection<set<string>>'
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

describe('a matrix can be in two collection types', () => {
  // A matrix of integers is a `list<number>` (its cells are numbers) and a
  // `list<list<integer>>` (its rows are lists of integers).
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) &&
    typesOverlap(parseType(b), parseType(a));
  it.each([
    // Two lists (`list<number>` and `list<list<integer>>`) still meet
    // elementwise, as before the change: see ROADMAP.md.
    ['list<number>', 'collection<list<integer>>'],
    ['indexed_collection<number>', 'collection<list<integer>>'],
  ])('%s and %s overlap, and their meet is kept', (a, b) => {
    expect(overlap(a, b)).toBe(true);
    expect(meet(a, b)).toBe(`${a} & ${b}`);
  });
  it.each([
    ['list<integer>', 'list<string>'],
    ['list<integer>', 'list<list<string>>'],
    ['list<integer>', 'collection<string>'],
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
  it('keeps the intersection when a matrix is in both', () => {
    // An integer matrix: its cells are numbers, its rows lists of integers.
    expect(
      meet('list<number | list<string>>', 'collection<boolean | list<integer>>')
    ).toBe('list<list<string> | number> & collection<boolean | list<integer>>');
  });
  it('applies the empty-collection rule at every level, for every kind', () => {
    // Two collections that share only the empty collection do not overlap
    // (the protocol rule of `typesOverlap()`), and the rule is applied to
    // the elements too: `list<set<never>>` and `list<set<integer>>` do not
    // overlap, so `list<set<never>>` and `collection<set<integer>>` do not
    // either.
    expect(overlap('list<set<never>>', 'list<set<integer>>')).toBe(false);
    expect(overlap('list<set<never>>', 'collection<set<integer>>')).toBe(false);
  });
});

describe('no false overlap through nested lists', () => {
  const overlap = (a: string, b: string) =>
    typesOverlap(parseType(a), parseType(b)) ||
    typesOverlap(parseType(b), parseType(a));
  it('reads a fixed-length list of nothing as empty', () => {
    expect(
      overlap('list<list<integer^2>^3>', 'collection<list<string^2>>')
    ).toBe(false);
  });
  it('does not take the empty list as a matrix row', () => {
    expect(overlap('list<integer>', 'list<boolean | list<string>>')).toBe(
      false
    );
  });
});

describe('a list of nothing is not a matrix row', () => {
  it('list<never> and list<any> share only the empty list', () => {
    const p = (s: string) => parseType(s);
    expect(typesOverlap(p('list<never>'), p('list<any>'))).toBe(false);
    expect(typesOverlap(p('list<any>'), p('list<never>'))).toBe(false);
  });
});

describe('a matrix in a fixed-length list of rows', () => {
  it('keeps the meet of a list of 3 rows with a collection of numbers', () => {
    // An integer 3×2 matrix: 3 rows on the left, integer cells on the right.
    const a = parseType('list<list<integer>^3>');
    const b = parseType('collection<number>');
    expect(
      typeToString(reduceType({ kind: 'intersection', types: [a, b] }))
    ).toBe('list<list<integer>^3> & collection<number>');
    expect(typesOverlap(a, b)).toBe(true);
  });

  it('reads a transparent alias as its definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('Empty', 'list<never>', { alias: true });
    const T = (s: string) => ce.type(s).type;
    expect(typesOverlap(T('list<integer>'), T('list<Empty>'))).toBe(false);
    expect(typesOverlap(T('list<integer>'), T('list<list<never>>'))).toBe(
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
  it('keeps the meet when the elements can be rows of a common matrix', () => {
    expect(
      meet(
        'list<(boolean | list<integer>)^3>',
        'collection<number | list<string>>'
      )
    ).toBe(
      'list<(boolean | list<integer>)^3> & collection<list<string> | number>'
    );
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
  it('keeps the meet when a matrix of empty sets is in both', () => {
    expect(meet('list<set<integer>>', 'collection<list<set<string>>>')).toBe(
      'list<set<integer>> & collection<list<set<string>>>'
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
    expect(overlap('list<integer^(2x0)>', 'collection<list<integer^0>>')).toBe(
      true
    );
  });
  it('reads broadcastable<never> as never | list<never>', () => {
    expect(overlap('list<integer>', 'list<broadcastable<never>>')).toBe(false);
  });
});

describe('a kept intersection inside a larger type', () => {
  it('is not refuted when met again', () => {
    expect(
      typeToString(
        reduceType(
          parseType(
            '((list<number> & collection<list<integer>>) | boolean) & list<integer>'
          )
        )
      )
    ).toBe('list<number> & collection<list<integer>> & list<integer>');
  });
  it('reads an intersection of rows member by member', () => {
    const a = parseType('list<integer>');
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
    // A 2×2×2 integer tensor: number cells, 2×2 rows.
    const a = parseType('list<number>');
    const b = parseType('collection<list<list<integer>>>');
    expect(typesOverlap(a, b) && typesOverlap(b, a)).toBe(true);
    expect(
      typeToString(reduceType({ kind: 'intersection', types: [a, b] }))
    ).toBe('list<number> & collection<list<list<integer>>>');
  });
  it('claims no overlap past the search limit', () => {
    const ce = new ComputeEngine();
    ce.declareType('A0', 'list<never>', { alias: true });
    for (let k = 1; k <= 9; k++)
      ce.declareType(`A${k}`, `A${k - 1}`, { alias: true });
    const a = ce.type('list<number>').type;
    const b = ce.type('list<A9>').type;
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('an intersection of rows with no common row', () => {
  it('holds no row, so it gives no overlap', () => {
    const a = parseType('list<integer>');
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
  it('keeps a rank-3 tensor of a dimensioned list of rows', () => {
    // A 2×3×2 integer tensor is in both.
    const a = parseType('list<list<integer^2>^(2x3)>');
    const b = parseType('collection<number>');
    expect(typesOverlap(a, b)).toBe(true);
    expect(
      typeToString(reduceType({ kind: 'intersection', types: [a, b] }))
    ).not.toBe('never');
  });
});

describe('an intersection that does not reduce', () => {
  it('is not a proof of overlap', () => {
    // Each member holds a row, but no row is in both members.
    const ce = new ComputeEngine();
    ce.declareType(
      'R',
      'list<integer | list<string>> & list<boolean | list<integer>>',
      { alias: true }
    );
    const a = ce.type('list<boolean | string>').type;
    const b = ce.type('list<R>').type;
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a cell type with no value', () => {
  it('gives no matrix witness', () => {
    // `tuple<list<never^1>>` has no value, although it is not `never`.
    const a = parseType('list<tuple<list<never^1>>>');
    const b = parseType('list<list<any>>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a list with dimensions and a list with none', () => {
  const meet = (a: string, b: string) =>
    typeToString(
      reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] })
    );
  it('meets with the shape of the dimensioned list', () => {
    expect(meet('list<number^2>', 'list<integer>')).toBe('vector<integer^2>');
    expect(meet('list<list<number^2>^3>', 'collection<list<integer>>')).toBe(
      'list<vector<integer^2>^3>'
    );
  });
  it('keeps the intersection when a matrix can be in both', () => {
    expect(meet('list<list<integer>>', 'list<number^(2x2)>')).not.toBe('never');
  });
  it('is empty when a vector cannot hold the elements', () => {
    expect(meet('list<string>', 'list<integer^2>')).toBe('never');
  });
});

describe('a matrix with no common cell or row', () => {
  it('meets a list of strings as never', () => {
    const a = parseType('list<string>');
    const b = parseType('list<integer^(2x2)>');
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
    const a = parseType('list<(number | string)^(2x2)>');
    const b = parseType('list<string | list<integer>>');
    const m = reduceType({ kind: 'intersection', types: [a, b] });
    expect(typeof m === 'object' && m.kind === 'intersection').toBe(true);
  });
});

describe('rows of every rank and lists of length 0', () => {
  it('finds a tensor through rows two levels down', () => {
    // A 2×2×2 integer tensor: number cells, rows of rows are integer
    // vectors.
    const a = parseType('list<(number | string)^(2x2x2)>');
    const b = parseType('list<string | list<integer^2>>');
    const m = reduceType({ kind: 'intersection', types: [a, b] });
    expect(typeof m === 'object' && m.kind === 'intersection').toBe(true);
  });
  it('does not count a list of length 0 as an overlap', () => {
    const a = parseType('list<string>');
    const b = parseType('list<integer^0>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a dimensioned matrix of empty collections', () => {
  it('keeps the meet with a list of rows', () => {
    // A 2×2 matrix of empty sets is in both.
    const m = reduceType({
      kind: 'intersection',
      types: [
        parseType('list<set<integer>^(2x2)>'),
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
  it('needs cells that can match, not only rows that are lists', () => {
    // Every cell of `list<list<string^2>^3>` is a string.
    expect(overlap('list<list<string^2>^3>', 'collection<number>')).toBe(false);
  });
  it('does not count two broadcastables that share the empty list only', () => {
    expect(overlap('broadcastable<integer>', 'broadcastable<string>')).toBe(
      false
    );
  });
});

describe('cases of the second review', () => {
  it('compares an alias through its definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('A', 'list<integer>', { alias: true });
    const T = (s: string) => ce.type(s).type;
    // As `list<list<integer>>` and `list<list<string>>`, which do not overlap.
    expect(typesOverlap(T('list<A>'), T('list<list<string>>'))).toBe(false);
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
    // `list<integer> | integer` and `collection<string>` share only `[]`.
    const a = parseType('list<integer> | integer');
    const b = parseType('collection<string>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
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
  it('does not take an empty inner axis as cells', () => {
    // Each `2×0` row holds two empty rows and no cell.
    const a = parseType('list<list<integer^(2x0)>>');
    const b = parseType('list<number>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
    expect(typesOverlap(parseType('list<list<integer^(2x3)>>'), b)).toBe(true);
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
  it('finds a rank-6 tensor', () => {
    let l6 = 'integer';
    for (let i = 0; i < 6; i++) l6 = `list<${l6}>`;
    expect(typesOverlap(parseType(l6), parseType('list<number>'))).toBe(true);
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
    const a = parseType('list<list<set<never>>>');
    const b = parseType('collection<set<integer>>');
    expect(typesOverlap(a, b) || typesOverlap(b, a)).toBe(false);
  });
});

describe('a branching chain of row aliases', () => {
  it('is searched in a bounded time', () => {
    const ce = new ComputeEngine();
    ce.declareType('R0', 'string', { alias: true });
    for (let n = 1; n <= 20; n++)
      ce.declareType(`R${n}`, `list<R${n - 1}^2> | list<R${n - 1}^3>`, {
        alias: true,
      });
    const T = (s: string) => ce.type(s).type;
    const start = Date.now();
    expect(typesOverlap(T('list<R20>'), T('collection<number>'))).toBe(false);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
