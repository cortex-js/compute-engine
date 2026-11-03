import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';
import { stripMissingFromType } from '../../src/common/type/utils';
import { isSubtype } from '../../src/common/type/subtype';

//
// A tuple source of a lazy collection operator, with a slot that may be
// absent. A lazy collection operator (`Map`, `Filter`, `Reduce`, `Any`,
// `ArgMax`, `Dedup`, …) reads the slots of a tuple as its elements, so
// `t: tuple<integer, missing>` is read as a collection of `integer | missing`,
// as `l: list<integer | missing>` is. Before, the source check of these
// operators (`checkCollectionOperand`, `validate.ts`) read the tuple slot by
// slot and refused it, because a `missing` slot is not a value:
// `Map(x ↦ x + 10, t)` was an `incompatible-type` error, while the same call
// over `l` was typed `list<number>`. The eager operators with the same
// parameter (`CountIf`, `Find`, `Sort`) already admitted the tuple.
//
// Each case checks three sources: the tuple with an absent slot (admitted,
// typed as the list control, and the static type holds the value), a tuple
// of values (the type it had before), and the list with an absent element
// (the control, unchanged). A lazy value is typed from the same derivation as
// the static type, so it is first listed into a `List` literal, which is
// typed from its elements.
//
// Background: `docs/plans/2026-10-20-bare-tuple-record-any.md`, item 1.
//

// A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
// is a result only"): `t` and `l` are not declared, and their types are
// inferred from their values.
const ce = new ComputeEngine();
ce.assign('t', ce.box(['Tuple', 1, 'Missing']));
ce.declare('u', 'tuple<integer, integer>');
ce.assign('u', ce.box(['Tuple', 1, 2]));
ce.assign('l', ce.box(['List', 1, 'Missing']));

/** The value as a literal collection, typed from its elements. */
function listed(v: Expression): Expression {
  if (!v.isCollection || v.isFiniteCollection !== true) return v;
  if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
  return ce.function(v.type.matches('set<any>') ? 'Set' : 'List', [
    ...v.each(),
  ]);
}

/** Check the static type of `expr`, and that it holds the value. The
 * marker `Missing` is implicit in a result type (`docs/ERROR-MODEL.md`,
 * "`Missing` is a result only"): `Reduce` over `[1, Missing]` is typed
 * `number` and gives `Missing`. So the `missing` arms of the type of the
 * value are removed before it is compared with the static type. */
function expectTypeHoldsValue(expr: Expression, type: string): string {
  expect(expr.isValid).toBe(true);
  expect(expr.type.toString()).toBe(type);
  const value = listed(expr.evaluate());
  expect(isSubtype(stripMissingFromType(value.type.type), expr.type.type)).toBe(
    true
  );
  return value.toString();
}

const ADD_10: MathJsonExpression = ['Function', ['Add', 'x', 10], 'x'];
const POSITIVE: MathJsonExpression = ['Function', ['Greater', 'x', 0], 'x'];
const ABOVE_5: MathJsonExpression = ['Function', ['Greater', 'x', 5], 'x'];
const SUM: MathJsonExpression = ['Function', ['Add', 'a', 'x'], 'a', 'x'];

type Row = {
  /** The operator. */
  name: string;
  /** The call over the source `s`, as MathJSON. */
  json: (s: string) => MathJsonExpression;
  /** The same call as LaTeX, with `%` for the source. */
  latex: string;
  /** The type and value over `t: tuple<integer, missing>`. */
  absentSlot: [string, string];
  /** The type over `u: tuple<integer, integer>`. */
  values: string;
  /** The type over `l: list<integer | missing>`. */
  list: string;
};

// `ArgMax`, `ArgMin`, `MaxBy` and `MinBy` stay unevaluated over a source
// with an absent element, for the tuple as for the list control.
const ROWS: Row[] = [
  {
    name: 'Map',
    json: (s) => ['Map', ADD_10, s],
    latex: '\\operatorname{Map}(x \\mapsto x + 10, %)',
    absentSlot: ['list<integer | missing>', '[11,"Missing"]'],
    values: 'list<integer>',
    list: 'list<integer | missing^2>',
  },
  {
    name: 'Filter',
    json: (s) => ['Filter', s, POSITIVE],
    latex: '\\operatorname{Filter}(%, x \\mapsto x > 0)',
    absentSlot: ['list<integer | missing>', '[1]'],
    values: 'list<integer>',
    list: 'list<integer | missing>',
  },
  {
    name: 'Reduce',
    json: (s) => ['Reduce', s, SUM, 0],
    latex: '\\operatorname{Reduce}(%, (a, x) \\mapsto a + x, 0)',
    absentSlot: ['number', '"Missing"'],
    values: 'number',
    list: 'number',
  },
  {
    name: 'Fold',
    json: (s) => ['Fold', SUM, 0, s],
    latex: '\\operatorname{Fold}((a, x) \\mapsto a + x, 0, %)',
    absentSlot: ['number', '"Missing"'],
    values: 'number',
    list: 'number',
  },
  {
    name: 'Scan',
    json: (s) => ['Scan', s, SUM, 0],
    latex: '\\operatorname{Scan}(%, (a, x) \\mapsto a + x, 0)',
    // Over the tuple, the result type has a `missing` arm, as a non-tuple
    // result over a tuple with an absent slot has. The list control has a
    // value of two elements, so its type has a length.
    absentSlot: ['list<number> | missing', '[1,"Missing"]'],
    values: 'list<number>',
    list: 'vector<2>',
  },
  {
    name: 'TakeWhile',
    json: (s) => ['TakeWhile', s, POSITIVE],
    latex: '\\operatorname{TakeWhile}(%, x \\mapsto x > 0)',
    absentSlot: ['list<integer | missing>', '[1]'],
    values: 'list<integer>',
    list: 'list<integer | missing>',
  },
  {
    name: 'DropWhile',
    json: (s) => ['DropWhile', s, ABOVE_5],
    latex: '\\operatorname{DropWhile}(%, x \\mapsto x > 5)',
    absentSlot: ['list<integer | missing>', '[1,"Missing"]'],
    values: 'list<integer>',
    list: 'list<integer | missing>',
  },
  {
    name: 'FlatMap',
    json: (s) => ['FlatMap', s, ['Function', ['List', ['Add', 'x', 1]], 'x']],
    latex: '\\operatorname{FlatMap}(%, x \\mapsto [x + 1])',
    absentSlot: ['list<integer | missing>', '[2,"Missing"]'],
    values: 'list<integer>',
    list: 'list<integer | missing>',
  },
  {
    name: 'Any',
    json: (s) => ['Any', s, POSITIVE],
    latex: '\\operatorname{Any}(%, x \\mapsto x > 0)',
    // An absent element reads as `False` (user decision of 2026-11-02,
    // two-valued comparisons), so the answer is a boolean.
    absentSlot: ['boolean', '"True"'],
    values: 'boolean',
    list: 'boolean',
  },
  {
    name: 'All',
    json: (s) => ['All', s, ABOVE_5],
    latex: '\\operatorname{All}(%, x \\mapsto x > 5)',
    // An absent element reads as `False` (see `Any`).
    absentSlot: ['boolean', '"False"'],
    values: 'boolean',
    list: 'boolean',
  },
  {
    name: 'MaxBy',
    json: (s) => ['MaxBy', s, ['Function', ['Negate', 'x'], 'x']],
    latex: '\\operatorname{MaxBy}(%, x \\mapsto -x)',
    absentSlot: ['integer | missing', 'MaxBy(t, (x) => -x)'],
    values: 'integer',
    list: 'integer | missing',
  },
  {
    name: 'MinBy',
    json: (s) => ['MinBy', s, ['Function', 'x', 'x']],
    latex: '\\operatorname{MinBy}(%, x \\mapsto x)',
    absentSlot: ['integer | missing', 'MinBy(t, (x) => x)'],
    values: 'integer',
    list: 'integer | missing',
  },
  {
    name: 'ArgMax',
    json: (s) => ['ArgMax', s],
    latex: '\\operatorname{ArgMax}(%)',
    absentSlot: ['integer', 'ArgMax(t)'],
    values: 'integer',
    list: 'integer',
  },
  {
    name: 'ArgMin',
    json: (s) => ['ArgMin', s],
    latex: '\\operatorname{ArgMin}(%)',
    absentSlot: ['integer', 'ArgMin(t)'],
    values: 'integer',
    list: 'integer',
  },
  {
    name: 'Dedup',
    json: (s) => ['Dedup', s],
    latex: '\\operatorname{Dedup}(%)',
    absentSlot: ['list<integer | missing>', '[1,"Missing"]'],
    values: 'list<integer>',
    list: 'list<integer | missing>',
  },
  {
    name: 'Differences',
    json: (s) => ['Differences', s],
    latex: '\\operatorname{Differences}(%)',
    // `integer` joined with `nan` keeps the `nan` arm (it was `number`,
    // which also admits complex numbers). The difference with an absent
    // element is `Missing`. Over the tuple, the result type has a
    // `missing` arm, as a non-tuple result over a tuple with an absent slot
    // has; the list control has the marker implicit.
    absentSlot: ['list<integer | nan> | missing', '["Missing"]'],
    values: 'list<integer>',
    list: 'list<integer>',
  },
];

describe('A TUPLE WITH AN ABSENT SLOT AT THE SOURCE OF A LAZY OPERATOR', () => {
  test.each(ROWS.map((r) => [r.name, r] as const))(
    '%s: the box route',
    (_, row) => {
      const [type, value] = row.absentSlot;
      expect(expectTypeHoldsValue(ce.box(row.json('t')), type)).toBe(value);
    }
  );

  test.each(ROWS.map((r) => [r.name, r] as const))(
    '%s: the parse route',
    (_, row) => {
      const [type, value] = row.absentSlot;
      expect(
        expectTypeHoldsValue(ce.parse(row.latex.replace('%', 't')), type)
      ).toBe(value);
    }
  );

  test.each(ROWS.map((r) => [r.name, r] as const))(
    '%s: a tuple of values keeps its type',
    (_, row) => {
      expectTypeHoldsValue(ce.box(row.json('u')), row.values);
      expectTypeHoldsValue(ce.parse(row.latex.replace('%', 'u')), row.values);
    }
  );

  test.each(ROWS.map((r) => [r.name, r] as const))(
    '%s: the list control is unchanged',
    (_, row) => {
      expectTypeHoldsValue(ce.box(row.json('l')), row.list);
      expectTypeHoldsValue(ce.parse(row.latex.replace('%', 'l')), row.list);
    }
  );
});

describe('THE LIMITS OF THE ADMISSION', () => {
  test.each(['tuple<any, integer>'])('%s belongs to the collection family', (type) => {
    const engine = new ComputeEngine();
    engine.declare('v', type);
    expect(engine.box(['Map', ADD_10, 'v']).isValid).toBe(true);
  });

  test.each(['tuple<integer, integer> | boolean'])('%s still admits a non-collection whole value', (type) => {
    const engine = new ComputeEngine();
    engine.declare('v', type);
    expect(engine.box(['Map', ADD_10, 'v']).isValid).toBe(false);
  });

  test('an alias of the tuple, in a union that is refused', () => {
    const engine = new ComputeEngine();
    engine.declareType('P', 'tuple<integer, integer>', { alias: true });
    engine.declare('p', 'P | boolean');
    expect(engine.box(['Map', ADD_10, 'p']).isValid).toBe(false);
    engine.declare('q', 'P');
    expect(engine.box(['Map', ADD_10, 'q']).isValid).toBe(true);
  });

  test.each([
    // Admitted: both arms are collections.
    ['tuple<integer, integer> | dictionary<integer>'],
  ])('%s is admitted', (type) => {
    const engine = new ComputeEngine();
    engine.declare('v', type);
    expect(engine.box(['Map', ADD_10, 'v']).isValid).toBe(true);
  });

  test('an identity mapping keeps the absent slot', () => {
    expect(
      expectTypeHoldsValue(
        ce.box(['Map', ['Function', 'x', 'x'], 't']),
        'list<missing | unknown>'
      )
    ).toBe('[1,"Missing"]');
  });
});

// An operand that can be absent as a whole cannot be declared: a declared
// type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing` is a result
// only").
describe('AN OPERAND DECLARED ABSENT AS A WHOLE', () => {
  test('is a static error', () => {
    expect(() =>
      new ComputeEngine().declare('w', 'missing | list<integer | missing>')
    ).toThrow();
  });
});

describe('DEDUP DOES NOT KEEP A LENGTH THE SOURCE TYPE STATES', () => {
  // `Dedup` can remove elements, so a result typed with the length of the
  // source would claim more elements than the value has.
  test.each([
    [['Dedup', ['Tuple', 1, 1]], 'list<integer>', '[1]'],
    [['Dedup', ['List', 1, 1, 2]], 'list<integer>', '[1,2]'],
    [
      ['Dedup', ['Tuple', 1, 'Missing', 'Missing']],
      'list<integer | missing>',
      '[1,"Missing"]',
    ],
  ] as [MathJsonExpression, string, string][])('%j', (json, type, value) => {
    expect(expectTypeHoldsValue(ce.box(json), type)).toBe(value);
  });

  test.each([
    // A `string` arm of a union gives `list<character> | string`: see
    // "A STRING ARM OF A UNION SOURCE" below.
    [
      'tuple<integer, integer> | string',
      ['Tuple', 1, 1],
      'list<character> | list<integer> | string',
      '[1]',
    ],
    [
      'tuple<integer, integer> | set<integer>',
      ['Tuple', 1, 1],
      'list<integer> | set<integer>',
      '[1]',
    ],
  ] as [string, MathJsonExpression, string, string][])(
    'a union source %s is read arm by arm',
    (declared, held, type, value) => {
      const engine = new ComputeEngine();
      engine.declare('d', declared);
      engine.assign('d', engine.box(held));
      const expr = engine.box(['Dedup', 'd']);
      expect(expr.type.toString()).toBe(type);
      const result = expr.evaluate();
      const items = engine.function('List', [...result.each()]);
      expect(items.toString()).toBe(value);
      expect(items.type.matches(expr.type)).toBe(true);
    }
  );

  test('a set source keeps its type', () => {
    expect(ce.box(['Dedup', ['Set', 1, 2]]).type.toString()).toBe(
      'set<integer>'
    );
  });
});

//
// A `string` arm of a union source of `Dedup` and `Filter`. For the same
// declared type, the result is a list of characters when the symbol holds a
// string literal (the result stays a view over the symbol, typed from the
// union), and a string when it holds an application that evaluates to a
// string (the handler builds the operator again over the string literal).
// So the arm gives `list<character> | string`. A source typed `string`
// alone gives a string on every route. `Map` gives a list on every route.
//
describe('A STRING ARM OF A UNION SOURCE', () => {
  /** The value as a literal: a string as it is, a collection as a list. */
  function settled(engine: ComputeEngine, v: Expression): Expression {
    if (v.type.matches('string')) return v;
    if (!v.isCollection || v.isFiniteCollection !== true) return v;
    return engine.function('List', [...v.each()]);
  }

  const CONSTRUCTIONS: [string, (engine: ComputeEngine) => void][] = [
    ['a string literal', (e) => e.assign('c', e.box("'aab'"))],
    ['ce.string()', (e) => e.assign('c', e.string('aab'))],
    ['a JavaScript string', (e) => e.assign('c', 'aab')],
    ['the parse route', (e) => e.assign('c', e.parse('\\text{aab}'))],
    ['a String application', (e) => e.assign('c', e.box(['String', 'aab']))],
    [
      'a StringJoin application',
      (e) => e.assign('c', e.box(['StringJoin', ['List', "'a'", "'ab'"]])),
    ],
  ];
  const OPERATORS: [string, MathJsonExpression][] = [
    ['Dedup', ['Dedup', 'c']],
    ['Filter', ['Filter', 'c', ['Function', 'True', 'x']]],
    ['Map', ['Map', ['Function', 'x', 'x'], 'c']],
  ];
  const DECLARED: [string, Record<string, string>][] = [
    ['string', { Dedup: 'string', Filter: 'string', Map: 'list<character>' }],
    [
      'list<integer> | string',
      {
        Dedup: 'list<character> | list<integer> | string',
        Filter: 'list<character> | list<integer> | string',
        Map: 'list<nothing | unknown>',
      },
    ],
    [
      'tuple<integer, integer> | string',
      {
        Dedup: 'list<character> | list<integer> | string',
        Filter: 'list<character> | list<integer> | string',
        Map: 'list<nothing | unknown>',
      },
    ],
  ];

  for (const [declared, types] of DECLARED)
    for (const [construction, assign] of CONSTRUCTIONS)
      test.each(OPERATORS)(`${declared}, ${construction}: %s`, (name, json) => {
        const engine = new ComputeEngine();
        engine.declare('c', declared);
        assign(engine);
        const expr = engine.box(json);
        expect(expr.type.toString()).toBe(types[name]);
        const value = settled(engine, expr.evaluate());
        expect(value.type.matches(expr.type)).toBe(true);
      });

  // The result is a string however the symbol holds its string. Before, a
  // string literal gave the list `["a","b"]`.
  test('the result kind does not depend on how the string is held', () => {
    const literal = new ComputeEngine();
    literal.declare('c', 'list<integer> | string');
    literal.assign('c', literal.box("'aab'"));
    expect(literal.box(['Dedup', 'c']).evaluate().toString()).toBe('"ab"');
    const application = new ComputeEngine();
    application.declare('c', 'list<integer> | string');
    application.assign(
      'c',
      application.box(['StringJoin', ['List', "'a'", "'ab'"]])
    );
    expect(application.box(['Dedup', 'c']).evaluate().toString()).toBe('"ab"');
  });

  test.each([
    ['dedup(c)', 'string', '"ab"'],
    ['filter(c, x => true)', 'string', '"aab"'],
    ['map(x => x, c)', 'list<nothing | unknown>', '["a","a","b"]'],
  ])('the Epsil route: %s', (call, type, value) => {
    const engine = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      engine.parse(latex).json;
    const result = executeEpsil(
      engine,
      `let c: list<integer> | string = "aab"\n${call}`,
      { parseLatex }
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.toString()).toBe(value);
    expect(result.value.type.toString()).toBe(type);
  });
});

describe('A SELF-REFERENTIAL ALIAS SOURCE', () => {
  test('Dedup does not unfold it forever', () => {
    const engine = new ComputeEngine();
    engine.declareType('cyc', 'cyc | list<integer>', { alias: true });
    engine.declare('k', 'cyc');
    engine.assign('k', engine.box(['List', 1, 1, 2]));
    const expr = engine.box(['Dedup', 'k']);
    expect(() => expr.type.toString()).not.toThrow();
    const value = expr.evaluate();
    const items = engine.function('List', [...value.each()]);
    expect(items.toString()).toBe('[1,2]');
    expect(items.type.matches(expr.type)).toBe(true);
  });
});

//
// A union source of `Map` (with a callback whose result is not known) and of
// `Filter` is read arm by arm: the value is in one of the arms. Echoed whole,
// `tuple<integer, integer> | dictionary<integer>` claimed a tuple for a
// value that is a list. For `Map`, the arm of the dictionary is
// `collection<unknown>`, and the union reducer keeps it as the supertype of
// the arm of the tuple, so the union reduces to `collection<unknown>` (user
// decision 2026-10-23: the reduction is accepted).
//
describe('A UNION SOURCE OF MAP AND FILTER', () => {
  test.each([
    [
      'tuple<integer, integer> | dictionary<integer>',
      ['Tuple', 1, 2],
      ['Map', ['Function', 'x', 'x'], 'v'],
      'collection<unknown>',
      '[1,2]',
    ],
    [
      'tuple<integer, integer> | dictionary<integer>',
      ['Tuple', 1, 2],
      ['Filter', 'v', POSITIVE],
      'dictionary<integer> | list<integer>',
      '[1,2]',
    ],
    [
      'tuple<integer, integer> | set<integer>',
      ['Tuple', 1, 2],
      ['Filter', 'v', POSITIVE],
      'list<integer> | set<integer>',
      '[1,2]',
    ],
  ] as [string, MathJsonExpression, MathJsonExpression, string, string][])(
    '%s: %j',
    (declared, held, json, type, value) => {
      const engine = new ComputeEngine();
      engine.declare('v', declared);
      engine.assign('v', engine.box(held));
      const expr = engine.box(json);
      expect(expr.type.toString()).toBe(type);
      const items = engine.function('List', [...expr.evaluate().each()]);
      expect(items.toString()).toBe(value);
      expect(items.type.matches(expr.type)).toBe(true);
    }
  );

  test('an unconstrained mapping preserves its explicit result uncertainty', () => {
    // The absent cell is inside a slot, not a slot: no element is `Missing`.
    // The type of `n` is inferred from its value,
    // `tuple<tuple<integer, missing>, integer>`: a declared type cannot name
    // `missing`.
    const engine = new ComputeEngine();
    engine.assign('n', engine.box(['Tuple', ['Tuple', 1, 'Missing'], 2]));
    expect(
      engine.box(['Map', ['Function', 'x', 'x'], 'n']).type.toString()
    ).toBe('list<nothing | unknown>');
  });
});

describe('THE EPSIL ROUTE', () => {
  function run(source: string): string {
    const engine = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      engine.parse(latex).json;
    const { value, diagnostics } = executeEpsil(engine, source, {
      parseLatex,
    });
    expect(diagnostics).toEqual([]);
    return value.toString();
  }

  test.each([
    ['map(x => x + 10, t)', '[11,"Missing"]'],
    ['filter(t, x => x > 0)', '[1]'],
    ['reduce(t, (a, x) => a + x, 0)', '"Missing"'],
    ['any(t, x => x > 0)', '"True"'],
  ])('%s', (call, expected) => {
    expect(run(`let t = (1, Missing)\n${call}`)).toBe(
      expected
    );
  });
});
