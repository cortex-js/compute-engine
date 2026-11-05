import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

//
// A collection operator that does not compute from a cell keeps an absent
// cell as it is: `Join([1, Missing], [2])` is `[1, Missing, 2]`
// (`docs/ERROR-MODEL.md`, "Absent values in collection operators", rule A).
// Its static type must then keep the `missing` arm of the cells, or the type
// says that the value holds no absent element while it holds one.
//
// Before, the type handler of `Join` and `ListJoin` got each operand with
// `missing` replaced by `nan`, and `Join(L, [2])` with `L` typed
// `list<integer | missing>` was typed `list<number>`, while
// `Append(L, 2)` was typed `list<integer | missing>`. Other operators had
// the same defect: the selection and regrouping operators (`DeleteAt`,
// `Partition`, `Chunk`, `Zip`, …) typed the cells `number` or `unknown`,
// and the operators whose declared result is a bare collection type
// (`Union` and the other set operations, `Flatten`, `DictionaryFrom`)
// answered a type that admits values only.
//
// Each test checks the static type, and that the type of the value is a
// subtype of it. A lazy value (a `Join` of two sets, a `Zip`) is typed
// from the same derivation as the static type, so it is first listed into
// a `List` or a `Set` literal, which is typed from its elements.
//
// A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
// is a result only — user decision of 2026-11-02"). So the symbols below are
// assigned without a declaration, and their type is inferred from the value:
// `L` is a `list<integer | missing^3>`, `S` a `set<integer | missing>` and
// `t` a `tuple<integer, missing>`.
//

const ce = new ComputeEngine();
ce.assign('L', ce.box(['List', 1, 'Missing', 3]));
ce.assign('S', ce.box(['Set', 1, 'Missing']));
ce.assign('t', ce.box(['Tuple', 1, 'Missing']));

/** The value as a literal collection, typed from its elements. */
function listed(v: Expression): Expression {
  if (!v.isCollection || v.isFiniteCollection !== true) return v;
  if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
  return ce.function(v.type.matches('set<any>') ? 'Set' : 'List', [
    ...v.each(),
  ]);
}

/**
 * Whether `value` is a value of `type`. The type of a list literal has no
 * length (`[(1, Missing), 3, 4]` is typed `list<integer | tuple<integer,
 * missing>>`), so a list literal is also a value of a list type with a
 * length when it has that number of elements and each element is a value of
 * the element type.
 */
function holds(value: Expression, type: Expression['type']): boolean {
  if (value.type.matches(type)) return true;
  const t = type.type;
  if (value.operator !== 'List' || typeof t !== 'object' || t.kind !== 'list')
    return false;
  const dims = t.dimensions;
  if (dims && (dims.length !== 1 || dims[0] !== value.count)) return false;
  return [...value.each()].every((x) => x.type.matches(t.elements));
}

type Case = [name: string, json: unknown, latex: string, type: string];

const CASES: Case[] = [
  [
    'Join of a list',
    ['Join', 'L', ['List', 2]],
    '\\mathrm{Join}(L, \\lbrack 2\\rbrack)',
    'list<integer | missing^4>',
  ],
  // The type has a length, and the type of the list literal of the value
  // has none: `holds()` checks that the value is a value of the type.
  [
    'Join of a tuple with an absent slot',
    ['Join', 't', ['List', 3, 4]],
    '\\mathrm{Join}(t, \\lbrack 3, 4\\rbrack)',
    'list<(integer | tuple<integer, missing>)^3>',
  ],
  [
    'Join of a set',
    ['Join', 'S', ['Set', 2]],
    '\\mathrm{Join}(S, \\lbrace 2\\rbrace)',
    'set<integer | missing>',
  ],
  [
    'ListJoin of a list (a list literal with a spread)',
    ['ListJoin', 'L', ['List', 2]],
    '\\lbrack \\mathrm{Spread}(L), 2\\rbrack',
    'list<integer | missing>',
  ],
  [
    'ListJoin of a tuple with an absent slot',
    ['ListJoin', 't', ['List', 3, 4]],
    '\\mathrm{ListJoin}(t, \\lbrack 3, 4\\rbrack)',
    'list<integer | tuple<integer, missing>>',
  ],
  // The type is wider than the type of the value, `list<integer |
  // missing>`, but it holds the value.
  [
    'DeleteAt',
    ['DeleteAt', 'L', 1],
    '\\mathrm{DeleteAt}(L, 1)',
    'list<any> | string',
  ],
  [
    'Partition',
    ['Partition', 'L', 2],
    '\\mathrm{Partition}(L, 2)',
    'list<list<integer | missing>>',
  ],
  [
    'Chunk',
    ['Chunk', 'L', 2],
    '\\mathrm{Chunk}(L, 2)',
    'list<list<integer | missing>>',
  ],
  [
    'ChunkBy',
    ['ChunkBy', 'L', ['Function', 'x', 'x']],
    '\\mathrm{ChunkBy}(L, x \\mapsto x)',
    'list<list<integer | missing>>',
  ],
  [
    'GroupBy',
    ['GroupBy', 'L', ['Function', 'x', 'x']],
    '\\mathrm{GroupBy}(L, x \\mapsto x)',
    'dictionary<list<integer | missing>>',
  ],
  [
    'TakeWhile',
    ['TakeWhile', 'L', ['Function', 'True', 'x']],
    '\\mathrm{TakeWhile}(L, x \\mapsto \\top)',
    'list<integer | missing>',
  ],
  [
    'DropWhile',
    ['DropWhile', 'L', ['Function', 'False', 'x']],
    '\\mathrm{DropWhile}(L, x \\mapsto \\bot)',
    'list<integer | missing>',
  ],
  // The type is wider than the type of the value, `list<integer |
  // missing>`, but it holds the value.
  [
    'RandomShuffle',
    ['RandomShuffle', 'L'],
    '\\mathrm{RandomShuffle}(L)',
    'list<any> | string',
  ],
  ['Dedup', ['Dedup', 'L'], '\\mathrm{Dedup}(L)', 'list<integer | missing>'],
  [
    'Take of a Cycle',
    ['Take', ['Cycle', 'L'], 4],
    '\\mathrm{Take}(\\mathrm{Cycle}(L), 4)',
    'list<integer | missing>',
  ],
  // The pair of two absent cells is `Missing` (a tuple whose every
  // coordinate is absent is the absent value), so the element type keeps a
  // `missing` arm.
  [
    'Zip',
    ['Zip', 'L', 'L'],
    '\\mathrm{Zip}(L, L)',
    'list<tuple<integer | missing, integer | missing>>',
  ],
  [
    'ListFrom',
    ['ListFrom', 'S'],
    '\\mathrm{ListFrom}(S)',
    'list<integer | missing>',
  ],
  [
    'SetFrom',
    ['SetFrom', 'L'],
    '\\mathrm{SetFrom}(L)',
    'set<integer | missing>',
  ],
  [
    'DictionaryFrom',
    ['DictionaryFrom', ['List', ['Tuple', "'a'", 'Missing']]],
    '\\mathrm{DictionaryFrom}(\\lbrack (\\text{a}, \\mathrm{Missing})\\rbrack)',
    'dictionary<any>',
  ],
  [
    'Map of the identity',
    ['Map', ['Function', 'x', 'x'], 'L'],
    '\\mathrm{Map}(x \\mapsto x, L)',
    'list<integer | missing^3>',
  ],
  [
    'Find',
    ['Find', 'L', ['Function', ['IsMissing', 'x'], 'x']],
    '\\mathrm{Find}(L, x \\mapsto \\mathrm{IsMissing}(x))',
    'integer | missing | nan',
  ],
  [
    'Union',
    ['Union', 'S', ['Set', 2]],
    'S \\cup \\lbrace 2\\rbrace',
    'set<integer | missing>',
  ],
  [
    'Intersection',
    ['Intersection', 'S', ['Set', 1, 'Missing']],
    'S \\cap \\lbrace 1, \\mathrm{Missing}\\rbrace',
    'set<integer | missing>',
  ],
  [
    'SetMinus',
    ['SetMinus', 'S', 1],
    'S \\setminus 1',
    'set<integer | missing>',
  ],
  [
    'Complement',
    ['Complement', 'S', ['Set', 1]],
    '\\mathrm{Complement}(S, \\lbrace 1\\rbrace)',
    'set<integer | missing>',
  ],
  [
    'SymmetricDifference',
    ['SymmetricDifference', 'S', ['Set', 2]],
    'S \\triangle \\lbrace 2\\rbrace',
    'set<integer | missing>',
  ],
  [
    'Flatten',
    ['Flatten', 'L'],
    '\\mathrm{Flatten}(L)',
    'list<integer | missing>',
  ],
  [
    'Flatten of a nested list',
    ['Flatten', ['List', 'L', ['List', 2]]],
    '\\mathrm{Flatten}(\\lbrack L, \\lbrack 2\\rbrack\\rbrack)',
    'list<integer | missing>',
  ],
];

describe('AN ABSENT ELEMENT KEEPS ITS MISSING ARM IN THE RESULT TYPE', () => {
  test.each(CASES)('%s, box route', (_name, json, _latex, type) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe(type);
    const value = listed(expr.evaluate());
    expect(holds(value, expr.type)).toBe(true);
  });

  test.each(CASES)('%s, parse route', (_name, json, latex, type) => {
    const expr = ce.parse(latex);
    // The parsed function literal has a `Block` body, so only the operator
    // is compared with the MathJSON form.
    expect(expr.operator).toBe((json as string[])[0]);
    expect(expr.type.toString()).toBe(type);
    const value = listed(expr.evaluate());
    expect(holds(value, expr.type)).toBe(true);
  });

  // No LaTeX syntax beyond the generic `\mathrm{…}` call, which needs a
  // dictionary operand or a function literal with a conditional: box only.
  test.each([
    [
      'Values',
      ['Values', ['Dictionary', ['KeyValuePair', "'a'", 'Missing']]],
      'list<missing>',
    ],
    [
      'MaxBy',
      ['MaxBy', 'L', ['Function', ['If', ['IsMissing', 'x'], 10, 0], 'x']],
      'integer | missing',
    ],
    [
      'MinBy',
      ['MinBy', 'L', ['Function', ['If', ['IsMissing', 'x'], 0, 10], 'x']],
      'integer | missing',
    ],
  ])('%s, box route', (_name, json, type) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe(type);
    const value = listed(expr.evaluate());
    expect(value.type.matches(expr.type)).toBe(true);
  });

  // `Join` states the length of its result (`list<integer | missing^4>`),
  // and `Append` does not (`list<integer | missing>`): the type of `Join`
  // is a subtype of the type of `Append`.
  test('Join is typed as Append is', () => {
    expect(
      ce
        .box(['Join', 'L', ['List', 2]])
        .type.matches(ce.box(['Append', 'L', 2]).type)
    ).toBe(true);
  });
});

//
// A callback whose result type is DECLARED (a library operator, a function
// symbol with a declared signature) says nothing about an absent cell. The
// call answers `Missing` there (`Sqrt(Missing)` is `Missing`, and a call of
// a function with a numeric parameter over `Missing` is `Missing`), so the
// element type of `Map` gains a `missing` arm: `Map(Sqrt, L)` is
// `list<complex | missing^3>` (`docs/ERROR-MODEL.md`, "`Missing` is a result
// only — user decision of 2026-11-02").
//
describe('A DECLARED CALLBACK ON AN ABSENT CELL', () => {
  // The lists are assigned without a declaration: a declared type cannot
  // name `missing`, and the inferred type of each has a `missing` arm.
  const ce2 = new ComputeEngine();
  ce2.assign('L', ce2.box(['List', 1, 'Missing', 3]));
  ce2.assign('K', ce2.box(['List', "'ab'", 'Missing']));
  ce2.assign('P', ce2.box(['List', ['Tuple', 1, 2], 'Missing']));
  ce2.declare('g', '(integer) -> integer');
  ce2.assign('g', ce2.box(['Function', ['Add', 'x', 1], 'x']));
  ce2.declare('b', '(integer) -> boolean');
  ce2.assign('b', ce2.box(['Function', ['Greater', 'x', 1], 'x']));

  const listedIn = (v: Expression): Expression => {
    if (!v.isCollection || v.isFiniteCollection !== true) return v;
    if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
    return ce2.function('List', [...v.each()]);
  };

  // A library operator given by name is typed by its own type handler, as
  // the lambda spelling is (user decision 2026-10-25, ROADMAP CE-45.2).
  test.each([
    [['Map', 'Sqrt', 'L'], 'list<complex | missing^3>', '[1,"Missing",sqrt(3)]'],
    [
      ['Map', 'Ln', 'L'],
      'list<complex | missing | signed_infinity^3>',
      '[0,"Missing",ln(3)]',
    ],
    [['Map', 'Floor', 'L'], 'list<integer | missing^3>', '[1,"Missing",3]'],
    [['Map', 'g', 'L'], 'list<integer | missing^3>', '[2,"Missing",4]'],
    [['Map', 'Length', 'K'], 'list<integer | missing>', '[2,"Missing"]'],
    // The type is wider than the type of the value, `list<complex |
    // missing>`, but it holds the value.
    [
      ['Map', 'Sqrt', ['Take', 'L', 3]],
      'list<complex | indexed_collection<any> | infinity | missing>',
      '[1,"Missing",sqrt(3)]',
    ],
    // An absent point gives an absent point.
    [
      ['Map', 'Negate', 'P'],
      'list<(missing | tuple<integer, integer>)^2>',
      '[(-1, -2),"Missing"]',
    ],
    // The operators below call the function on a cell, but their result is
    // a position, a count or a cell, not what the function answers.
    [['IndexWhere', 'L', 'b'], 'integer', '3'],
    [['Position', 'L', 'b'], 'list<integer>', '[3]'],
    [['CountIf', 'L', 'b'], 'integer', '1'],
    [['Find', 'L', 'b'], 'integer | missing | nan', '3'],
    [['TakeWhile', 'L', 'b'], 'list<integer | missing>', '[]'],
    [['DropWhile', 'L', 'b'], 'list<integer | missing>', '[1,"Missing",3]'],
    [['ChunkBy', 'L', 'g'], 'list<list<integer | missing>>', undefined],
    [['GroupBy', 'L', 'g'], 'dictionary<list<integer | missing>>', undefined],
  ] as [unknown, string, string | undefined][])(
    '%j, box route',
    (json, type, value) => {
      const expr = ce2.box(json as any);
      expect(expr.type.toString()).toBe(type);
      const v = listedIn(expr.evaluate());
      if (value !== undefined) expect(v.toString()).toBe(value);
      expect(v.type.matches(expr.type)).toBe(true);
    }
  );

  // `ArgMax`, `ArgMin`, `MaxBy` and `MinBy` with a numeric key stay
  // unevaluated when a key is `NaN`; the static type is checked.
  test.each([
    [['ArgMax', 'L', 'g'], 'integer'],
    [['ArgMin', 'L', 'g'], 'integer'],
    [['MaxBy', 'L', 'g'], 'integer | missing'],
    [['MinBy', 'L', 'g'], 'integer | missing'],
  ])('%j, box route', (json, type) => {
    expect(ce2.box(json as any).type.toString()).toBe(type);
  });

  // The positions and counts are integers, also over an absent cell.
  test.each([
    [
      ['IndexWhere', 'L', ['Function', ['IsMissing', 'x'], 'x']],
      'integer',
      '2',
    ],
    [
      ['Position', 'L', ['Function', ['IsMissing', 'x'], 'x']],
      'list<integer>',
      '[2]',
    ],
    [['CountIf', 'L', ['Function', ['IsMissing', 'x'], 'x']], 'integer', '1'],
    [
      ['ArgMax', 'L', ['Function', ['If', ['IsMissing', 'x'], 10, 0], 'x']],
      'integer',
      '2',
    ],
    [
      ['ArgMin', 'L', ['Function', ['If', ['IsMissing', 'x'], 10, 0], 'x']],
      'integer',
      '1',
    ],
  ])('%j, box route', (json, type, value) => {
    const expr = ce2.box(json as any);
    expect(expr.type.toString()).toBe(type);
    const v = expr.evaluate();
    expect(v.toString()).toBe(value);
    expect(v.type.matches(expr.type)).toBe(true);
  });
});

describe('THE ELEMENT TYPE OF A SET RESULT WITH AN ABSENT ELEMENT', () => {
  const ce3 = new ComputeEngine();
  ce3.assign('S', ce3.box(['Set', 1, 'Missing']));
  ce3.assign('L', ce3.box(['List', 1, 'Missing', 3]));
  // A function with no value, declared to return anything: `q(1)` can hold
  // strings, so the element type of the result is not known.
  ce3.declare('q', '(integer) -> unknown');

  test.each([
    [['Join', 'S', ['q', 1]], 'set<any>'],
    [['Union', 'S', ['q', 1]], 'set<any>'],
    // The numeric arms are merged: `integer` is a subtype of `real`.
    [['Union', 'S', ['Set', 2.5]], 'set<missing | real>'],
    [['Join', 'S', ['Set', 2.5]], 'set<missing | real>'],
    [['Join', 'L', ['List', 2.5]], 'list<missing | real^4>'],
  ])('%j', (json, type) => {
    expect(ce3.box(json as any).type.toString()).toBe(type);
  });
});

// With no absent element, the result has the element type of the operands:
// these operators keep each element as it is, so the type of an element of
// the result is the type of an element of an operand.
describe('WITH NO ABSENT ELEMENT, THE RESULT HAS THE ELEMENT TYPE OF THE OPERANDS', () => {
  test.each([
    [['Union', ['Set', 1], ['Set', 2]], 'set<integer>'],
    [['SetMinus', ['Set', 1, 2], 1], 'set<integer>'],
    [['Join', ['Set', 1], ['Set', 2]], 'set<integer>'],
    [['Flatten', ['List', ['List', 1], ['List', 2]]], 'list<integer>'],
    [['DictionaryFrom', ['List', ['Tuple', "'a'", 1]]], 'dictionary'],
    [['Chunk', ['List', 1, 2, 3], 2], 'list<list<integer>>'],
    [['Cycle', ['List', 1, 2]], 'list<integer>'],
    [
      ['GroupBy', ['List', 1, 2], ['Function', 'x', 'x']],
      'dictionary<list<integer>>',
    ],
    [['Zip', ['List', 1, 2], ['List', 3, 4]], 'list<tuple<integer, integer>>'],
    // A cell of one source only may be absent: the pair is a tuple.
    [
      ['Zip', 'L', ['List', 3, 4, 5]],
      'list<tuple<integer | missing, integer>>',
    ],
  ])('%j', (json, type) => {
    expect(ce.box(json as any).type.toString()).toBe(type);
  });
});

//
// `any` admits the absence markers: a value typed `any` or `list<any>` can
// be `Missing` or hold a `Missing` cell. So an operand typed with `any` at
// some position makes the result admit an absent element, as an operand
// with a `missing` arm does (`typeCouldHoldMissing`). Before, `Flatten(M)`
// with `M: list<list<any>>` holding `[[1, Missing], [2]]` was typed `list`,
// which admits values only, and evaluated to `[1, Missing, 2]`. An operand
// whose type excludes absence gives the element type of its value: `N`,
// `Bare` and `I` hold `[1, 2]` or `[1, 2, 3]`, so their type is a
// `list<integer>` whatever their declared type (`list<unknown>`, `list`,
// `list<integer>`).
//
describe('AN OPERAND TYPED WITH `any` CAN HOLD AN ABSENT ELEMENT', () => {
  const ce4 = new ComputeEngine();
  const declare = (name: string, type: string, value: unknown) => {
    ce4.declare(name, type);
    ce4.assign(name, ce4.box(value as any));
  };
  declare('M', 'list<list<any>>', [
    'List',
    ['List', 1, 'Missing'],
    ['List', 2],
  ]);
  declare('B', 'list<any>', ['List', 1, 'Missing', 3]);
  declare('U', 'any', ['List', ['List', 1, 'Missing'], ['List', 2]]);
  declare('A', 'set<any>', ['Set', 1, 'Missing']);
  declare('Q', 'list<any>', ['List', ['Tuple', "'a'", 'Missing']]);
  declare('N', 'list<unknown>', ['List', 1, 2]);
  declare('I', 'list<integer>', ['List', 1, 2, 3]);
  declare('Bare', 'list', ['List', 1, 2]);
  ce4.declare('g', '(integer) -> integer');
  ce4.assign('g', ce4.box(['Function', ['Add', 'x', 1], 'x']));

  const listedIn = (v: Expression): Expression => {
    if (!v.isCollection || v.isFiniteCollection !== true) return v;
    if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
    return ce4.function(v.type.matches('set<any>') ? 'Set' : 'List', [
      ...v.each(),
    ]);
  };

  test.each([
    [['Flatten', 'M'], 'list<any>'],
    [['Flatten', 'B'], 'list<any>'],
    [['Flatten', 'U'], 'list<any>'],
    [['Union', 'A', ['Set', 2]], 'set<any>'],
    [['Join', 'A', ['Set', 2]], 'set<any>'],
    [['SetMinus', 'A', 1], 'set<any>'],
    [['Chunk', 'B', 2], 'list<list<any>>'],
    [['GroupBy', 'B', ['Function', 'x', 'x']], 'dictionary<list<any>>'],
    [['Take', ['Cycle', 'B'], 4], 'list<any>'],
    [['Zip', 'B', 'B'], 'list<tuple<any, any>>'],
    [['DictionaryFrom', 'Q'], 'dictionary<any>'],
    // An element typed `any` can be a list, nested to any depth, which
    // `Sqrt` maps over: the element of the result is a number or a list.
    [
      ['Map', 'Sqrt', 'B'],
      'list<complex | indexed_collection<any> | infinity | missing>',
    ],
    // `g` has only scalar parameters, so it maps over an element that is a
    // list, as `Sqrt` does (ROADMAP CE-485).
    [
      ['Map', 'g', 'B'],
      'list<indexed_collection<any> | integer | missing>',
    ],
  ])('%j', (json, type) => {
    const expr = ce4.box(json as any);
    expect(expr.type.toString()).toBe(type);
    const value = listedIn(expr.evaluate());
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test.each([
    [['Flatten', 'N'], 'list<integer>'],
    [['Flatten', 'I'], 'list<integer>'],
    [['Flatten', 'Bare'], 'list<integer>'],
    [['Chunk', 'I', 2], 'list<list<integer>>'],
    [['Cycle', 'I'], 'list<integer>'],
    [['Zip', 'I', 'I'], 'list<tuple<integer, integer>>'],
    [['Join', 'N', ['Set', 2]], 'set<integer>'],
    // The `Sqrt` type handler types the elements (ROADMAP CE-45.2).
    [['Map', 'Sqrt', 'I'], 'list<complex>'],
  ])('%j has the element type of the operand', (json, type) => {
    expect(ce4.box(json as any).type.toString()).toBe(type);
  });
});
