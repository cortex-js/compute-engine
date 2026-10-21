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

const ce = new ComputeEngine();
ce.declare('L', 'list<integer | missing>');
ce.assign('L', ce.box(['List', 1, 'Missing', 3]));
ce.declare('S', 'set<integer | missing>');
ce.assign('S', ce.box(['Set', 1, 'Missing']));
ce.declare('t', 'tuple<integer, missing>');
ce.assign('t', ce.box(['Tuple', 1, 'Missing']));

/** The value as a literal collection, typed from its elements. */
function listed(v: Expression): Expression {
  if (!v.isCollection || v.isFiniteCollection !== true) return v;
  if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
  return ce.function(v.type.matches('set<any>') ? 'Set' : 'List', [
    ...v.each(),
  ]);
}

type Case = [name: string, json: unknown, latex: string, type: string];

const CASES: Case[] = [
  [
    'Join of a list',
    ['Join', 'L', ['List', 2]],
    '\\mathrm{Join}(L, \\lbrack 2\\rbrack)',
    'list<integer | missing>',
  ],
  [
    'Join of a tuple with an absent slot',
    ['Join', 't', ['List', 3, 4]],
    '\\mathrm{Join}(t, \\lbrack 3, 4\\rbrack)',
    'list<integer | tuple<integer, missing>>',
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
  [
    'DeleteAt',
    ['DeleteAt', 'L', 1],
    '\\mathrm{DeleteAt}(L, 1)',
    'list<integer | missing>',
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
  [
    'RandomShuffle',
    ['RandomShuffle', 'L'],
    '\\mathrm{RandomShuffle}(L)',
    'list<integer | missing>',
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
    'list<integer | missing>',
  ],
  [
    'Find',
    ['Find', 'L', ['Function', ['IsMissing', 'x'], 'x']],
    '\\mathrm{Find}(L, x \\mapsto \\mathrm{IsMissing}(x))',
    'integer | missing | nothing',
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
  ['Flatten', ['Flatten', 'L'], '\\mathrm{Flatten}(L)', 'list<any>'],
  [
    'Flatten of a nested list',
    ['Flatten', ['List', 'L', ['List', 2]]],
    '\\mathrm{Flatten}(\\lbrack L, \\lbrack 2\\rbrack\\rbrack)',
    'list<any>',
  ],
];

describe('AN ABSENT ELEMENT KEEPS ITS MISSING ARM IN THE RESULT TYPE', () => {
  test.each(CASES)('%s, box route', (_name, json, _latex, type) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe(type);
    const value = listed(expr.evaluate());
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test.each(CASES)('%s, parse route', (_name, json, latex, type) => {
    const expr = ce.parse(latex);
    // The parsed function literal has a `Block` body, so only the operator
    // is compared with the MathJSON form.
    expect(expr.operator).toBe((json as string[])[0]);
    expect(expr.type.toString()).toBe(type);
    const value = listed(expr.evaluate());
    expect(value.type.matches(expr.type)).toBe(true);
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

  test('Join is typed as Append is', () => {
    expect(ce.box(['Join', 'L', ['List', 2]]).type.toString()).toBe(
      ce.box(['Append', 'L', 2]).type.toString()
    );
  });
});

//
// A callback whose result type is DECLARED (a library operator, a function
// symbol with a declared signature) says nothing about an absent cell. The
// call answers the absence marker of its result there: `NaN` for a number
// (`Sqrt(Missing)`), `Missing` for a point. So the element type of `Map`
// takes the numeric absorption: `Map(Sqrt, L)` is `list<number>`, not the
// declared `list<complex | infinity>`, which does not admit `NaN`. A
// declared result with a `missing` arm says what the callback answers for
// the absent cell, and is kept.
//
describe('A DECLARED CALLBACK ON AN ABSENT CELL', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('L', 'list<integer | missing>');
  ce2.assign('L', ce2.box(['List', 1, 'Missing', 3]));
  ce2.declare('K', 'list<string | missing>');
  ce2.assign('K', ce2.box(['List', "'ab'", 'Missing']));
  ce2.declare('P', 'list<tuple<integer, integer> | missing>');
  ce2.assign('P', ce2.box(['List', ['Tuple', 1, 2], 'Missing']));
  ce2.declare('g', '(integer) -> integer');
  ce2.assign('g', ce2.box(['Function', ['Add', 'x', 1], 'x']));
  ce2.declare('a', '(integer | missing) -> integer | missing');
  ce2.assign('a', ce2.box(['Function', 'x', 'x']));
  ce2.declare('b', '(integer) -> boolean');
  ce2.assign('b', ce2.box(['Function', ['Greater', 'x', 1], 'x']));

  const listedIn = (v: Expression): Expression => {
    if (!v.isCollection || v.isFiniteCollection !== true) return v;
    if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
    return ce2.function('List', [...v.each()]);
  };

  test.each([
    [['Map', 'Sqrt', 'L'], 'list<number>', '[1,NaN,sqrt(3)]'],
    [['Map', 'Ln', 'L'], 'list<number>', '[0,NaN,ln(3)]'],
    [['Map', 'Floor', 'L'], 'list<number>', '[1,NaN,3]'],
    [['Map', 'g', 'L'], 'list<number>', '[2,NaN,4]'],
    [['Map', 'Length', 'K'], 'list<number>', '[2,NaN]'],
    [['Map', 'Sqrt', ['Take', 'L', 3]], 'list<number>', '[1,NaN,sqrt(3)]'],
    // An absent point gives an absent point.
    [
      ['Map', 'Negate', 'P'],
      'list<missing | tuple<number, number>>',
      '[(-1, -2),"Missing"]',
    ],
    [['Map', 'a', 'L'], 'list<integer | missing>', '[1,"Missing",3]'],
    // The operators below call the function on a cell, but their result is
    // a position, a count or a cell, not what the function answers.
    [['IndexWhere', 'L', 'b'], 'integer', '3'],
    [['Position', 'L', 'b'], 'list<integer>', '[3]'],
    [['CountIf', 'L', 'b'], 'integer', '1'],
    [['Find', 'L', 'b'], 'integer | missing | nothing', '3'],
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
  ce3.declare('S', 'set<integer | missing>');
  ce3.assign('S', ce3.box(['Set', 1, 'Missing']));
  ce3.declare('L', 'list<integer | missing>');
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
    [['Join', 'L', ['List', 2.5]], 'list<missing | real>'],
  ])('%j', (json, type) => {
    expect(ce3.box(json as any).type.toString()).toBe(type);
  });
});

describe('WITH NO ABSENT ELEMENT, THE DECLARED RESULT IS KEPT', () => {
  test.each([
    [['Union', ['Set', 1], ['Set', 2]], 'set'],
    [['SetMinus', ['Set', 1, 2], 1], 'set'],
    [['Join', ['Set', 1], ['Set', 2]], 'set'],
    [['Flatten', ['List', ['List', 1], ['List', 2]]], 'list'],
    [['DictionaryFrom', ['List', ['Tuple', "'a'", 1]]], 'dictionary'],
    [['Chunk', ['List', 1, 2, 3], 2], 'list<list>'],
    [['Cycle', ['List', 1, 2]], 'list'],
    [['GroupBy', ['List', 1, 2], ['Function', 'x', 'x']], 'dictionary<list>'],
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
// which admits values only, and evaluated to `[1, Missing, 2]`. A type that
// excludes absence (`list<integer>`, bare `list`, `list<unknown>`) keeps
// the declared result.
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
    [['Map', 'Sqrt', 'B'], 'list<indexed_collection<any> | number>'],
    [['Map', 'g', 'B'], 'list<number>'],
  ])('%j', (json, type) => {
    const expr = ce4.box(json as any);
    expect(expr.type.toString()).toBe(type);
    const value = listedIn(expr.evaluate());
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test.each([
    [['Flatten', 'N'], 'list'],
    [['Flatten', 'I'], 'list'],
    [['Flatten', 'Bare'], 'list'],
    [['Chunk', 'I', 2], 'list<list>'],
    [['Cycle', 'I'], 'list'],
    [['Zip', 'I', 'I'], 'list<tuple<integer, integer>>'],
    [['Join', 'N', ['Set', 2]], 'set'],
    [['Map', 'Sqrt', 'I'], 'list<complex | infinity>'],
  ])('%j keeps the declared result', (json, type) => {
    expect(ce4.box(json as any).type.toString()).toBe(type);
  });
});
