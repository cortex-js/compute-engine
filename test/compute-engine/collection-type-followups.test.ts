import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { broadcastCallbackResultType } from '../../src/compute-engine/boxed-expression/callback-broadcast-admission';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

//
// Type defects of the collection operators found by the tuple-source fix
// (ROADMAP.md, "Defects found by the tuple-source fix" and "Collection
// results that can hold an absent element, after the `Join` fix"). Each case
// checks that the static type of the expression holds its value
// (`value.type.matches(expr.type)`), on the `ce.box` route, on the `ce.parse`
// route where the call can be written in LaTeX, and on the Epsil route where
// it is practical. A lazy value is first listed into a literal, which is
// typed from its elements.
//

/** The value as a literal collection, typed from its elements. A keyed
 * view is materialized (into a `Dictionary`), a string is kept as it is. */
function listed(engine: ComputeEngine, v: Expression): Expression {
  if (v.type.matches('string')) return v;
  if (!v.isCollection || v.isFiniteCollection !== true) return v;
  if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
  if (v.type.matches('dictionary<any>') || v.type.matches('record'))
    return v.evaluate({ materialization: true });
  return engine.function(v.type.matches('set<any>') ? 'Set' : 'List', [
    ...v.each(),
  ]);
}

/** Check the static type of `expr`, and that it holds the value. Answer the
 * value, printed. */
function expectTypeHoldsValue(
  engine: ComputeEngine,
  expr: Expression,
  type: string
): string {
  expect(expr.isValid).toBe(true);
  expect(expr.type.toString()).toBe(type);
  const value = listed(engine, expr.evaluate());
  expect(value.type.matches(expr.type)).toBe(true);
  return value.toString();
}

/** Run an Epsil program; answer its value and the type of the value. */
function epsil(source: string): [string, string] {
  const engine = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    engine.parse(latex).json;
  const { value, diagnostics } = executeEpsil(engine, source, { parseLatex });
  expect(diagnostics).toEqual([]);
  return [value.toString(), value.type.toString()];
}

const ADD_10: MathJsonExpression = ['Function', ['Add', 'x', 10], 'x'];
const POSITIVE: MathJsonExpression = ['Function', ['Greater', 'x', 0], 'x'];

describe('1. FLATMAP OVER A SOURCE WITH ABSENT CELLS', () => {
  // The callback gets an absent cell as it is: `x ↦ [x, x]` gives
  // `[Missing, Missing]` for it. Before, the result was typed `list<number>`.
  const engine = new ComputeEngine();
  engine.declare('l', 'list<integer | missing>');
  engine.assign('l', engine.box(['List', 1, 'Missing']));

  test.each([
    [
      ['Function', ['List', 'x', 'x'], 'x'],
      'list<integer | missing>',
      '[1,1,"Missing","Missing"]',
    ],
    [['Function', 'x', 'x'], 'list<missing | unknown>', '[1,"Missing"]'],
    [['Function', ['Add', 'x', 1], 'x'], 'list<number>', '[2,NaN]'],
    ['Sqrt', 'list<number>', '[1,NaN]'],
    // `IsPrime(Missing)` is `Missing`: before, typed `list<boolean>`.
    ['IsPrime', 'list<boolean | missing>', '["False","Missing"]'],
    // An annotated parameter refuses the absent cell, which gives `NaN`: the
    // result is widened as for a declared callback.
    [
      ['Function', ['List', 'x'], ['Typed', 'x', "'integer'"]],
      'list<number>',
      '[1,NaN]',
    ],
    // A `Missing` the callback returns for a present cell is kept beside the
    // `NaN` of the absent cell.
    [
      ['Function', ['List', 'x', 'Missing'], ['Typed', 'x', "'integer'"]],
      'list<missing | number>',
      '[1,"Missing",NaN,"Missing"]',
    ],
  ] as [MathJsonExpression, string, string][])('%j', (fn, type, value) => {
    expect(
      expectTypeHoldsValue(engine, engine.box(['FlatMap', 'l', fn]), type)
    ).toBe(value);
  });

  test('the parse route', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse('\\operatorname{FlatMap}(l, x \\mapsto [x, x])'),
        'list<integer | missing>'
      )
    ).toBe('[1,1,"Missing","Missing"]');
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse(
          '\\operatorname{FlatMap}(l, (x: \\mathrm{integer}) \\mapsto [x])'
        ),
        'list<number>'
      )
    ).toBe('[1,NaN]');
  });

  test('the parse route: a returned Missing beside an absent cell', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse(
          '\\operatorname{FlatMap}(l, (x: \\mathrm{integer}) \\mapsto [x, \\mathrm{Missing}])'
        ),
        'list<missing | number>'
      )
    ).toBe('[1,"Missing",NaN,"Missing"]');
  });

  test('the Epsil route', () => {
    expect(
      epsil(
        'let l: list<integer | missing> = [1, Missing]\nflatMap(l, x => [x, x])'
      )
    ).toEqual(['[1,1,"Missing","Missing"]', 'list<integer | missing>']);
  });

  test('a callback result that is a union of a list and an absent value', () => {
    // `Reverse(x)` over cells `list<integer> | missing` is a list or
    // `Missing`: the list is spliced, `Missing` is one element.
    const e = new ComputeEngine();
    for (const expr of [
      e.box([
        'FlatMap',
        ['List', ['List', 1, 2], 'Missing'],
        ['Function', ['Reverse', 'x'], 'x'],
      ]),
      e.parse(
        '\\operatorname{FlatMap}([[1, 2], \\mathrm{Missing}], x \\mapsto \\operatorname{Reverse}(x))'
      ),
    ])
      expect(expectTypeHoldsValue(e, expr, 'list<integer | missing>')).toBe(
        '[2,1,"Missing"]'
      );
  });

  test('a callback result typed with a self-referential alias', () => {
    // `cyc = cyc | list<integer>`: the splice walk unfolded it forever.
    const e = new ComputeEngine();
    e.declareType('cyc', 'cyc | list<integer>', { alias: true });
    e.declare('f', '(integer) -> cyc');
    e.assign('f', e.box(['Function', ['List', 'x', 'x'], 'x']));
    for (const expr of [
      e.box(['FlatMap', ['List', 1], 'f']),
      e.parse('\\operatorname{FlatMap}([1], f)'),
      e.function('FlatMap', [e.box(['List', 1]), e.symbol('f')]),
    ])
      expect(expectTypeHoldsValue(e, expr, 'list<integer>')).toBe('[1,1]');
  });

  test('a source with no absent cell keeps its type', () => {
    const e = new ComputeEngine();
    e.declare('i', 'list<integer>');
    e.assign('i', e.box(['List', 1, 2]));
    expect(
      e
        .box(['FlatMap', 'i', ['Function', ['List', 'x', 'x'], 'x']])
        .type.toString()
    ).toBe('list<integer>');
  });
});

describe('1b. MAP OF A LITERAL WITH AN ANNOTATED PARAMETER OVER ABSENT CELLS', () => {
  // The annotation gives the body `NaN` for an absent cell. Before,
  // `Map((x: integer) ↦ x + 1, m)` was typed `list<integer>` for `[2, NaN]`.
  const engine = new ComputeEngine();
  engine.declare('m', 'list<integer | missing>');
  engine.assign('m', engine.box(['List', 1, 'Missing']));
  const annotated = (body: MathJsonExpression): MathJsonExpression => [
    'Function',
    body,
    ['Typed', 'x', "'integer'"],
  ];

  test.each([
    [['Add', 'x', 1], 'list<number>', '[2,NaN]'],
    [['List', 'x'], 'list<vector<1>>', '[[1],[NaN]]'],
    // A `Missing` that the body returns for a present cell is kept. For the
    // absent cell `x` is `NaN`, and `NaN > 0` is `False` (user decision
    // 2026-10-20), so the else arm gives `NaN` (before the decision the `If`
    // took no arm and gave `Missing`).
    [
      ['If', ['Greater', 'x', 0], 'Missing', 'x'],
      'list<missing | number>',
      '["Missing",NaN]',
    ],
    [['Greater', 'x', 0], 'list<boolean>', '["True","False"]'],
  ] as [MathJsonExpression, string, string][])('%j', (body, type, value) => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.box(['Map', annotated(body), 'm']),
        type
      )
    ).toBe(value);
  });

  test('several sources of an abstract collection type', () => {
    // The result is an `indexed_collection`: the `Missing` that the body
    // returns for a present cell is kept. The absent cell gives `NaN`: the
    // else arm of `NaN > 0` (user decision 2026-10-20).
    const e = new ComputeEngine();
    e.declare('ca', 'collection<integer | missing>');
    e.assign('ca', e.box(['List', 1, 'Missing']));
    e.declare('cb', 'collection<integer | missing>');
    e.assign('cb', e.box(['List', 2, 3]));
    for (const expr of [
      e.box([
        'Map',
        [
          'Function',
          ['If', ['Greater', 'x', 0], 'Missing', 'x'],
          ['Typed', 'x', "'integer'"],
          ['Typed', 'y', "'integer'"],
        ],
        'ca',
        'cb',
      ]),
      e.parse(
        '\\operatorname{Map}((x: \\mathrm{integer}, y: \\mathrm{integer}) \\mapsto \\operatorname{If}(x > 0, \\mathrm{Missing}, x), \\mathrm{ca}, \\mathrm{cb})'
      ),
    ])
      expect(
        expectTypeHoldsValue(e, expr, 'indexed_collection<missing | number>')
      ).toBe('["Missing",NaN]');
  });

  test('the parse route', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse(
          '\\operatorname{Map}((x: \\mathrm{integer}) \\mapsto x + 1, m)'
        ),
        'list<number>'
      )
    ).toBe('[2,NaN]');
  });
});

describe('2. THE PREVIEW OF A VIEW OVER A SOURCE THAT CAN BE ABSENT', () => {
  // A view typed `list<integer> | missing` printed as a `Set`.
  const engine = new ComputeEngine();
  engine.declare('c', 'missing | list<integer>');
  engine.assign('c', engine.box(['List', 1, 2]));

  test.each([
    [['Map', ADD_10, 'c'], '[11,12]'],
    [['Filter', 'c', POSITIVE], '[1,2]'],
  ] as [MathJsonExpression, string][])('%j', (json, printed) => {
    const expr = engine.box(json);
    expect(expr.type.toString()).toBe('list<integer> | missing');
    expect(expr.toString()).toBe(printed);
    expect(expr.evaluate().toString()).toBe(printed);
  });

  test('the parse route', () => {
    const expr = engine.parse('\\operatorname{Map}(x \\mapsto x + 10, c)');
    expect(expr.toString()).toBe('[11,12]');
    expect(expectTypeHoldsValue(engine, expr, 'list<integer> | missing')).toBe(
      '[11,12]'
    );
  });

  test('an absent source keeps the view as written', () => {
    const e = new ComputeEngine();
    e.declare('c', 'missing | list<integer>');
    e.assign('c', 'Missing');
    const expr = e.box(['Map', ADD_10, 'c']);
    expect(expr.toString()).toBe('Map((x) => x + 10, c)');
    expect(expr.evaluate().toString()).toBe('"Missing"');
  });
});

describe('3. A TUPLE WHOSE EVERY SLOT IS ABSENT STAYS REFUSED AT A LAZY SOURCE', () => {
  // Not fixed: such a tuple evaluates to `Missing` (an open question of
  // `docs/plans/2026-10-20-bare-tuple-record-any.md`), so no type of the
  // tuple holds its value, and admitting it at a lazy source gave types
  // that do not hold the values (`Scan(m, Add)` typed `list<number>`
  // evaluates to `Missing`).
  test.each([['Map'], ['Scan'], ['Reduce'], ['Any'], ['ArgMax']])(
    '%s',
    (op) => {
      const engine = new ComputeEngine();
      engine.declare('m', 'tuple<missing, missing>');
      engine.assign('m', engine.box(['Tuple', 'Missing', 'Missing']));
      const json: MathJsonExpression =
        op === 'Map'
          ? ['Map', ADD_10, 'm']
          : op === 'Scan'
            ? ['Scan', 'm', 'Add']
            : op === 'Reduce'
              ? ['Reduce', 'm', 'Add', 0]
              : op === 'Any'
                ? ['Any', 'm', POSITIVE]
                : ['ArgMax', 'm'];
      expect(engine.box(json).isValid).toBe(false);
    }
  );
});

describe('6. THE RESULT KIND OVER A STRING HELD BY A SYMBOL OF A WIDER TYPE', () => {
  // `Dedup("aab")` is the string `"ab"`. Over `c: list<integer> | string`,
  // a string literal held by `c` gave the list `["a", "b"]`, and an
  // application that evaluates to a string gave the string.
  const HELD: [string, (e: ComputeEngine) => void][] = [
    ['a string literal', (e) => e.assign('c', e.box("'aab'"))],
    [
      'a StringJoin application',
      (e) => e.assign('c', e.box(['StringJoin', ['List', "'a'", "'ab'"]])),
    ],
  ];
  test.each(HELD)('%s', (_, assign) => {
    const engine = new ComputeEngine();
    engine.declare('c', 'list<integer> | string');
    assign(engine);
    for (const [json, value] of [
      [['Dedup', 'c'], '"ab"'],
      [['Filter', 'c', ['Function', 'True', 'x']], '"aab"'],
      [['TakeWhile', 'c', ['Function', 'True', 'x']], '"aab"'],
    ] as [MathJsonExpression, string][]) {
      const expr = engine.box(json);
      const v = expr.evaluate();
      expect(v.toString()).toBe(value);
      expect(v.type.matches(expr.type)).toBe(true);
    }
    expect(engine.box(['Dedup', "'aab'"]).evaluate().toString()).toBe('"ab"');
  });

  test('a view over the symbol gives a string too', () => {
    // Before, `Dedup(Filter(c, p))` was the list `["a", "b"]`.
    const engine = new ComputeEngine();
    engine.declare('c', 'list<integer> | string');
    engine.assign('c', engine.box("'aab'"));
    for (const expr of [
      engine.box(['Dedup', ['Filter', 'c', ['Function', 'True', 'x']]]),
      engine.parse(
        '\\operatorname{Dedup}(\\operatorname{Filter}(c, x \\mapsto \\mathrm{True}))'
      ),
    ]) {
      expect(expr.type.toString()).toBe(
        'list<character> | list<integer> | string'
      );
      const v = expr.evaluate();
      expect(v.toString()).toBe('"ab"');
      expect(v.type.matches(expr.type)).toBe(true);
    }
  });

  test('a view over the symbol holding a list stays a view', () => {
    const engine = new ComputeEngine();
    engine.declare('c', 'list<integer> | string');
    engine.assign('c', engine.box(['List', 1, 1, 2]));
    const expr = engine.box([
      'Dedup',
      ['Filter', 'c', ['Function', 'True', 'x']],
    ]);
    const v = expr.evaluate();
    expect(v.operator).toBe('Dedup');
    const items = listed(engine, v);
    expect(items.toString()).toBe('[1,2]');
    expect(items.type.matches(expr.type)).toBe(true);
  });

  test('Map keeps the symbol', () => {
    const engine = new ComputeEngine();
    engine.declare('c', 'list<integer> | string');
    engine.assign('c', engine.box("'aab'"));
    expect(
      expectTypeHoldsValue(
        engine,
        engine.box(['Map', ['Function', 'x', 'x'], 'c']),
        'list'
      )
    ).toBe('["a","a","b"]');
  });

  test('the parse route', () => {
    const engine = new ComputeEngine();
    engine.declare('c', 'list<integer> | string');
    engine.assign('c', engine.parse('\\text{aab}'));
    const expr = engine.parse('\\operatorname{Dedup}(c)');
    const v = expr.evaluate();
    expect(v.toString()).toBe('"ab"');
    expect(v.type.matches(expr.type)).toBe(true);
  });

  test('the Epsil route', () => {
    expect(epsil('let c: list<integer> | string = "aab"\ndedup(c)')).toEqual([
      '"ab"',
      'string',
    ]);
  });
});

describe('7. A SOURCE THAT CAN BE AN ABSENT VALUE OR A STRING', () => {
  // Before, `missing | string` was an `incompatible-type` error at `Dedup`,
  // `Filter` and `Map`, while `missing | list<integer>` was admitted.
  test.each([
    [['Dedup', 'c'], 'missing | string', '"ab"'],
    [['Filter', 'c', ['Function', 'True', 'x']], 'missing | string', '"aab"'],
    [
      ['Map', ['Function', 'x', 'x'], 'c'],
      'list<character> | missing',
      '["a","a","b"]',
    ],
  ] as [MathJsonExpression, string, string][])('%j', (json, type, value) => {
    const engine = new ComputeEngine();
    engine.declare('c', 'missing | string');
    engine.assign('c', engine.box("'aab'"));
    expect(expectTypeHoldsValue(engine, engine.box(json), type)).toBe(value);
    engine.assign('c', engine.box('Missing'));
    expect(engine.box(json).evaluate().toString()).toBe('"Missing"');
  });

  test('the parse route', () => {
    const engine = new ComputeEngine();
    engine.declare('c', 'missing | string');
    engine.assign('c', engine.box("'aab'"));
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse('\\operatorname{Dedup}(c)'),
        'missing | string'
      )
    ).toBe('"ab"');
  });

  test('a union with no collection arm is still refused', () => {
    const engine = new ComputeEngine();
    engine.declare('n', 'missing | integer');
    expect(engine.box(['Dedup', 'n']).isValid).toBe(false);
  });

  test.each([
    ['dedup(s)', '"ab"'],
    ['filter(s, x => true)', '"aab"'],
    ['map(x => x, s)', '["a","a","b"]'],
  ])('the Epsil route: %s', (call, value) => {
    expect(epsil(`let s: missing | string = "aab"\n${call}`)[0]).toBe(value);
  });
});

describe('8. MAP OVER AN ALIAS OF A TUPLE', () => {
  // `q: P`, with `P` an alias of `tuple<integer, missing>`, was typed
  // `collection<number>`: the alias was not read as its definition.
  const engine = new ComputeEngine();
  engine.declareType('P', 'tuple<integer, missing>', { alias: true });
  engine.declare('q', 'P');
  engine.assign('q', engine.box(['Tuple', 1, 'Missing']));

  test.each([
    [ADD_10, 'list<number>', '[11,NaN]'],
    ['Sqrt', 'list<number>', '[1,NaN]'],
  ] as [MathJsonExpression, string, string][])('%j', (fn, type, value) => {
    expect(
      expectTypeHoldsValue(engine, engine.box(['Map', fn, 'q']), type)
    ).toBe(value);
  });

  test('the parse route', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse('\\operatorname{Map}(x \\mapsto x + 10, q)'),
        'list<number>'
      )
    ).toBe('[11,NaN]');
  });

  test('a self-referential alias does not unfold forever', () => {
    const e = new ComputeEngine();
    e.declareType('cyc', 'cyc | list<integer>', { alias: true });
    e.declare('k', 'cyc');
    e.assign('k', e.box(['List', 1, 2]));
    const expr = e.box(['Map', ADD_10, 'k']);
    expect(() => expr.type.toString()).not.toThrow();
    const items = e.function('List', [...expr.evaluate().each()]);
    expect(items.toString()).toBe('[11,12]');
    expect(items.type.matches(expr.type)).toBe(true);
  });
});

describe('9. FILTER AND DEDUP OVER A DICTIONARY', () => {
  // A filtered or deduplicated dictionary is a dictionary. Before, the view
  // was listed as a `Set` of entry tuples.
  const SECOND_POSITIVE: MathJsonExpression = [
    'Function',
    ['Greater', ['Second', 'p'], 0],
    'p',
  ];
  const DICT: MathJsonExpression = [
    'Dictionary',
    ['Tuple', "'a'", 1],
    ['Tuple', "'b'", -1],
  ];

  test.each([
    [['Filter', 'd', SECOND_POSITIVE], '{"a" -> 1}'],
    [['Dedup', 'd'], '{"a" -> 1, "b" -> -1}'],
  ] as [MathJsonExpression, string][])('%j', (json, value) => {
    const engine = new ComputeEngine();
    engine.declare('d', 'dictionary<integer>');
    engine.assign('d', engine.box(DICT));
    const expr = engine.box(json);
    expect(expr.type.toString()).toBe('dictionary<integer>');
    expect(expr.toString()).toBe(value);
    const v = expr.evaluate({ materialization: true });
    expect(v.operator).toBe('Dictionary');
    expect(v.toString()).toBe(value);
    expect(v.type.matches(expr.type)).toBe(true);
  });

  test('a record source gives a dictionary', () => {
    // Filtering can remove fields, so the result is not the record. Its
    // values are `any`: an open record can hold more fields, of any type,
    // absent values included.
    const engine = new ComputeEngine();
    const expr = engine.box(['Filter', DICT, SECOND_POSITIVE]);
    expect(expr.type.toString()).toBe('dictionary<any>');
    const v = expr.evaluate({ materialization: true });
    expect(v.toString()).toBe('{"a" -> 1}');
    expect(v.type.matches(expr.type)).toBe(true);
    const absent = engine.box([
      'Filter',
      ['Dictionary', ['Tuple', "'a'", 'Missing']],
      ['Function', 'True', 'p'],
    ]);
    const w = absent.evaluate({ materialization: true });
    expect(w.toString()).toBe('{"a" -> "Missing"}');
    expect(w.type.matches(absent.type)).toBe(true);
  });

  test('the parse route', () => {
    const engine = new ComputeEngine();
    engine.declare('d', 'dictionary<integer>');
    engine.assign('d', engine.box(DICT));
    const expr = engine.parse(
      '\\operatorname{Filter}(d, p \\mapsto \\operatorname{Second}(p) > 0)'
    );
    expect(expr.type.toString()).toBe('dictionary<integer>');
    const v = expr.evaluate({ materialization: true });
    expect(v.toString()).toBe('{"a" -> 1}');
    expect(v.type.matches(expr.type)).toBe(true);
  });

  test('a dictionary arm of a union', () => {
    const engine = new ComputeEngine();
    engine.declare('v', 'tuple<integer, missing> | dictionary<integer>');
    engine.assign('v', engine.box(DICT));
    for (const json of [
      ['Filter', 'v', SECOND_POSITIVE],
      ['Dedup', 'v'],
    ] as MathJsonExpression[]) {
      const expr = engine.box(json);
      const v = expr.evaluate({ materialization: true });
      expect(v.operator).toBe('Dictionary');
      expect(v.type.matches(expr.type)).toBe(true);
    }
  });

  test.each([[6], [7], [12]])(
    'the display of a view over a dictionary of %i entries',
    (n) => {
      // The preview lists five entries and a continuation marker, which a
      // `Dictionary` does not hold: the view printed as an
      // `incompatible-type` error. A dictionary has no form for "and more
      // entries", so the view prints as written.
      const engine = new ComputeEngine();
      engine.declare('d', 'dictionary<integer>');
      engine.assign(
        'd',
        engine.box([
          'Dictionary',
          ...Array.from({ length: n }, (_, i): MathJsonExpression => [
            'Tuple',
            `'k${i}'`,
            i + 1,
          ]),
        ])
      );
      for (const [expr, printed] of [
        [engine.box(['Dedup', 'd']), 'Dedup(d)'],
        [
          engine.box(['Filter', 'd', SECOND_POSITIVE]),
          'Filter(d, (p) => 0 < Second(p))',
        ],
        [engine.parse('\\operatorname{Dedup}(d)'), 'Dedup(d)'],
      ] as [Expression, string][]) {
        expect(expr.toString()).toBe(printed);
        expect(JSON.stringify(expr.json)).not.toContain('Error');
        expect(expr.evaluate({ materialization: 3 }).toString()).toBe(printed);
        const v = expr.evaluate({ materialization: true });
        expect(v.operator).toBe('Dictionary');
        expect(v.count).toBe(n);
        expect(v.type.matches(expr.type)).toBe(true);
      }
    }
  );

  test('Map over a dictionary arm whose values can be absent', () => {
    // A callback can answer the absent value of an entry.
    const engine = new ComputeEngine();
    engine.declare(
      'w',
      'tuple<integer, missing> | dictionary<integer | missing>'
    );
    engine.assign('w', engine.box(['Dictionary', ['Tuple', "'a'", 'Missing']]));
    for (const expr of [
      engine.box(['Map', ['Function', ['At', 'x', 2], 'x'], 'w']),
      engine.parse(
        '\\operatorname{Map}(x \\mapsto \\operatorname{At}(x, 2), w)'
      ),
    ]) {
      expect(expr.type.toString()).toBe('collection<missing | unknown>');
      const value = expr.evaluate({ materialization: true });
      expect(value.toString()).toBe('Set("Missing")');
      expect(value.type.matches(expr.type)).toBe(true);
    }
  });

  test('nested views over a dictionary arm of a union', () => {
    // The kind is read through the sources of the inner views: before, the
    // outer view was listed as a `Set` of entries.
    const engine = new ComputeEngine();
    engine.declare('v', 'tuple<integer, missing> | dictionary<integer>');
    engine.assign('v', engine.box(DICT));
    for (const expr of [
      engine.box([
        'Filter',
        ['Filter', 'v', ['Function', 'True', 'p']],
        SECOND_POSITIVE,
      ]),
      engine.box(['Dedup', ['Filter', 'v', SECOND_POSITIVE]]),
      engine.parse(
        '\\operatorname{Filter}(\\operatorname{Filter}(v, p \\mapsto \\mathrm{True}), p \\mapsto \\operatorname{Second}(p) > 0)'
      ),
    ]) {
      const value = expr.evaluate({ materialization: true });
      expect(value.toString()).toBe('{"a" -> 1}');
      expect(value.type.matches(expr.type)).toBe(true);
    }
  });

  test('Dedup over a bare record', () => {
    const engine = new ComputeEngine();
    engine.declare('r', 'record');
    engine.assign('r', engine.box(['Dictionary', ['Tuple', "'a'", 1]]));
    for (const expr of [
      engine.box(['Dedup', 'r']),
      engine.parse('\\operatorname{Dedup}(r)'),
    ]) {
      expect(expr.type.toString()).toBe('record');
      const value = expr.evaluate({ materialization: true });
      expect(value.toString()).toBe('{"a" -> 1}');
      expect(value.type.matches(expr.type)).toBe(true);
    }
  });

  test('Map over a dictionary arm of a union', () => {
    // The arm was echoed: `dictionary<integer> | list<missing | unknown>`
    // for a value that is a set of entries.
    const engine = new ComputeEngine();
    engine.declare('v', 'tuple<integer, missing> | dictionary<integer>');
    engine.assign('v', engine.box(DICT));
    for (const expr of [
      engine.box(['Map', ['Function', 'x', 'x'], 'v']),
      engine.parse('\\operatorname{Map}(x \\mapsto x, v)'),
    ]) {
      expect(expr.type.toString()).toBe(
        'collection<unknown> | list<missing | unknown>'
      );
      const value = expr.evaluate({ materialization: true });
      expect(value.toString()).toBe('Set(("b", -1), ("a", 1))');
      expect(value.type.matches(expr.type)).toBe(true);
    }
  });

  test('the Epsil route', () => {
    expect(
      epsil(
        'let d: dictionary<integer> = {"a" -> 1, "b" -> -1}\nfilter(d, (p) => p[2] > 0)'
      )
    ).toEqual(['{"a" -> 1}', 'dictionary<integer>']);
  });
});

describe('10. MAP OF AN OPERATOR WHOSE DECLARED RESULT IS `any`', () => {
  // The source type was copied: the elements are of the declared result.
  const engine = new ComputeEngine();

  test.each([
    // The elements are characters, or `Missing` for an empty string; a
    // value that mixes the two is typed with no length.
    [
      ['Map', 'PointX', ['List', "'a'", "'b'"]],
      'list<character | missing>',
      '["a","b"]',
    ],
    [
      ['Map', 'First', ['List', ['List', 1, 2], ['List', 3]]],
      'list<any>',
      '[1,3]',
    ],
    [
      ['Map', 'First', ['List', ['List'], ['List', 3]]],
      'list<any>',
      '["Missing",3]',
    ],
  ] as [MathJsonExpression, string, string][])('%j', (json, type, value) => {
    expect(expectTypeHoldsValue(engine, engine.box(json), type)).toBe(value);
  });

  test('the parse route', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse(
          '\\operatorname{Map}(\\operatorname{First}, [[1, 2], [3]])'
        ),
        'list<any>'
      )
    ).toBe('[1,3]');
  });
});

describe('11. MAP OF A FUNCTION LITERAL OVER ELEMENTS THAT MAY BE LISTS', () => {
  // The type of `x ↦ Sqrt(x)` is computed with a scalar parameter. With
  // `U: any` holding lists, the element type also allows a collection. An
  // element of `U` can be `Nothing`, which `Map` passes through, so every
  // result type here has a `nothing` arm.
  const engine = new ComputeEngine();
  engine.declare('U', 'any');
  engine.assign('U', engine.box(['List', ['List', 1, 4], ['List', 9]]));

  test('a bare parameter', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.box(['Map', ['Function', ['Sqrt', 'x'], 'x'], 'U']),
        'list<indexed_collection<any> | nothing | number>'
      )
    ).toBe('[[1,2],[3]]');
  });

  test('the parse route', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse('\\operatorname{Map}(x \\mapsto \\sqrt{x}, U)'),
        'list<indexed_collection<any> | nothing | number>'
      )
    ).toBe('[[1,2],[3]]');
  });

  test.each([
    // A body that does not read its parameter: every element is the
    // constant.
    [
      ['Function', 1, 'x'],
      '\\operatorname{Map}(x \\mapsto 1, U)',
      'list<nothing | number>',
      '[1,1]',
    ],
    // A parameter whose type the literal states from its use (`collection`,
    // by `Length`): the own result type holds.
    [
      ['Function', ['Length', 'x'], 'x'],
      '\\operatorname{Map}(x \\mapsto \\operatorname{Length}(x), U)',
      'list<integer | nothing | signed_infinity>',
      '[2,1]',
    ],
  ] as [MathJsonExpression, string, string, string][])(
    'no wider type for %j',
    (fn, latex, type, value) => {
      for (const expr of [engine.box(['Map', fn, 'U']), engine.parse(latex)])
        expect(expectTypeHoldsValue(engine, expr, type)).toBe(value);
    }
  );

  test('a recursive alias source does not unfold forever', () => {
    // `R = list<R>`: the walk that looks for an element type of open depth
    // reached `R` again and again (a stack overflow on the `ce.function`
    // route).
    const e = new ComputeEngine();
    e.declareType('R', 'list<R>', { alias: true });
    e.declare('r', 'list<R>');
    e.assign('r', e.box(['List', ['List'], ['List']]));
    for (const expr of [
      e.function('Map', [
        e.function('Function', [e.number(5), e.symbol('x')]),
        e.symbol('r'),
      ]),
      e.box(['Map', ['Function', 5, 'x'], 'r']),
      e.parse('\\operatorname{Map}(x \\mapsto 5, r)'),
    ]) {
      expect(() => expr.type.toString()).not.toThrow();
      const v = listed(e, expr.evaluate());
      expect(v.toString()).toBe('[5,5]');
      expect(v.type.matches(expr.type)).toBe(true);
    }
  });

  test('a source of known scalar elements keeps the type', () => {
    const e = new ComputeEngine();
    e.declare('li', 'list<integer>');
    e.assign('li', e.box(['List', 1, 4]));
    expect(
      e.box(['Map', ['Function', ['Add', 'x', 1], 'x'], 'li']).type.toString()
    ).toBe('list<integer>');
  });
});

describe('12. MAP OF A BROADCASTABLE OPERATOR OVER RAGGED ROWS', () => {
  // The rows of `[[1, 4], [9]]` are `vector<integer^1> | vector<integer^2>`.
  // The callback check did not descend into such a union, and the call was
  // an `incompatible-type` error.
  test.each([['unknown'], ['list']])('a source declared `%s`', (declared) => {
    const engine = new ComputeEngine();
    engine.declare('u', declared);
    engine.assign('u', engine.box(['List', ['List', 1, 4], ['List', 9]]));
    expect(
      expectTypeHoldsValue(
        engine,
        engine.box(['Map', 'Sqrt', 'u']),
        'list<vector<1> | vector<2>>'
      )
    ).toBe('[[1,2],[3]]');
  });

  test('a list literal', () => {
    const engine = new ComputeEngine();
    expect(
      expectTypeHoldsValue(
        engine,
        engine.box(['Map', 'Sqrt', ['List', ['List', 1, 4], ['List', 9]]]),
        'list<vector<1> | vector<2>>'
      )
    ).toBe('[[1,2],[3]]');
  });

  test('the parse route', () => {
    const engine = new ComputeEngine();
    expect(
      expectTypeHoldsValue(
        engine,
        engine.parse(
          '\\operatorname{Map}(\\operatorname{Sqrt}, [[1, 4], [9]])'
        ),
        'list<vector<1> | vector<2>>'
      )
    ).toBe('[[1,2],[3]]');
  });

  test('a union of tuples stays atomic', () => {
    // A tuple is bound whole: a `(x: integer)` callback refuses an element
    // that is a tuple of either arity.
    const engine = new ComputeEngine();
    engine.declare(
      'pp',
      'list<tuple<integer, integer> | tuple<integer, integer, integer>>'
    );
    engine.assign(
      'pp',
      engine.box(['List', ['Tuple', 1, 2], ['Tuple', 1, 2, 3]])
    );
    expect(
      engine.box([
        'Map',
        ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]],
        'pp',
      ]).isValid
    ).toBe(false);
    expect(
      engine.parse(
        '\\operatorname{Map}((x: \\mathrm{integer}) \\mapsto x + 1, \\mathrm{pp})'
      ).isValid
    ).toBe(false);
  });

  test.each([
    [
      'list<vector<integer^2> | vector<integer^3>>',
      ['List', ['List', 1, 2], ['List', 3, 4, 5]],
      '[[2,4],[6,8,10]]',
    ],
    [
      'list<vector<integer^2>>',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      '[[2,4],[6,8]]',
    ],
  ] as [string, MathJsonExpression, string][])(
    'rows of %s',
    (declared, held, doubled) => {
      const engine = new ComputeEngine();
      engine.declare('pr', declared);
      engine.assign('pr', engine.box(held));
      // An annotated literal is applied to a row whole, and its annotation
      // refuses it: refused at boxing.
      expect(
        engine.box([
          'Map',
          ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]],
          'pr',
        ]).isValid
      ).toBe(false);
      expect(
        engine.parse(
          '\\operatorname{Map}((x: \\mathrm{integer}) \\mapsto x + 1, \\mathrm{pr})'
        ).isValid
      ).toBe(false);
      // A named function with a scalar parameter broadcasts over each row
      // (user ruling of 2026-09-22), and the type says so.
      engine.declare('f', '(number) -> number');
      engine.assign('f', engine.box(['Function', ['Multiply', 'x', 2], 'x']));
      engine.assign(
        'h',
        engine.box([
          'Function',
          ['Multiply', 'x', 2],
          ['Typed', 'x', "'number'"],
        ])
      );
      for (const fn of ['f', 'h'])
        for (const expr of [
          engine.box(['Map', fn, 'pr']),
          engine.parse(`\\operatorname{Map}(${fn}, \\mathrm{pr})`),
        ])
          expect(expectTypeHoldsValue(engine, expr, 'list<list<number>>')).toBe(
            doubled
          );
    }
  );

  test.each([
    ['(T) -> T where T', ['Function', 'x', 'x'], '[[1,2],[3]]'],
    [
      '(T) -> T where T: number',
      ['Function', ['Multiply', 'x', 2], 'x'],
      '[[2,4],[6]]',
    ],
  ] as [string, MathJsonExpression, string][])(
    'a polymorphic user callback %s over rows',
    (signature, body, value) => {
      // The type variable is bound to the leaf type: before, the lifted
      // result named it, and boxing the type threw.
      const engine = new ComputeEngine();
      engine.declare('g', signature);
      engine.assign('g', engine.box(body));
      engine.declare('rows', 'list<list<integer>>');
      engine.assign('rows', engine.box(['List', ['List', 1, 2], ['List', 3]]));
      for (const expr of [
        engine.box(['Map', 'g', 'rows']),
        engine.parse('\\operatorname{Map}(g, \\mathrm{rows})'),
        engine.function('Map', [engine.symbol('g'), engine.symbol('rows')]),
      ])
        expect(expectTypeHoldsValue(engine, expr, 'list<list<integer>>')).toBe(
          value
        );
    }
  );

  test('a bounded type variable is not bound to a leaf that breaks the bound', () => {
    // `where T: number` over rows of strings: `T` cannot be `string`, so the
    // result is not read as `list<list<string>>`. Each call is an error, which
    // is not part of a type (docs/ERROR-MODEL.md §4).
    const engine = new ComputeEngine();
    engine.declare('g', '(T) -> T where T: number');
    engine.assign('g', engine.box(['Function', ['Multiply', 'x', 2], 'x']));
    engine.declare('srows', 'list<list<string>>');
    engine.assign(
      'srows',
      engine.box(['List', ['List', { str: 'a' }], ['List', { str: 'b' }]])
    );
    const expr = engine.box(['Map', 'g', 'srows']);
    expect(expr.type.toString()).not.toBe('list<list<string>>');
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  test('the type variable is bound only when it is the parameter', () => {
    // `((integer) -> T) -> T` over function leaves needs a solve of `T`:
    // the lifted type is not given, and the older call typing decides.
    const lifted = (signature: string, element: string): string | undefined => {
      const t = broadcastCallbackResultType(
        parseType(signature),
        parseType(element)
      );
      return t === undefined ? undefined : typeToString(t);
    };
    expect(
      lifted('((integer) -> T) -> T where T', 'list<(integer) -> integer>')
    ).toBeUndefined();
    expect(lifted('(T) -> T where T', 'list<integer>')).toBe('list<integer>');
  });

  test('rows of different depths are not descended into', () => {
    // The arms `list<integer>` and `list<list<integer>>` reach different
    // depths: the broadcast admission declines, as at HEAD.
    const engine = new ComputeEngine();
    engine.declare('f', '(number) -> number');
    engine.assign('f', engine.box(['Function', ['Multiply', 'x', 2], 'x']));
    engine.declare('mx', 'list<list<integer> | list<list<integer>>>');
    engine.assign(
      'mx',
      engine.box(['List', ['List', 1, 2], ['List', ['List', 3]]])
    );
    expect(engine.box(['Map', 'f', 'mx']).isValid).toBe(false);
    expect(engine.parse('\\operatorname{Map}(f, \\mathrm{mx})').isValid).toBe(
      false
    );
    expect(
      broadcastCallbackResultType(
        parseType('(number) -> number'),
        parseType('list<integer> | list<list<integer>>')
      )
    ).toBeUndefined();
  });

  test('a callback that the leaves cannot reach is still refused', () => {
    const engine = new ComputeEngine();
    expect(
      engine.box(['Map', 'ToUpperCase', ['List', ['List', 1, 4], ['List', 9]]])
        .isValid
    ).toBe(false);
  });
});

describe('13. MAP WITH A RESULT OF MIXED ELEMENTS', () => {
  // A list literal of mixed elements states no length (`["x", 6]` is
  // `list<integer | string>`), so the type of `Map` does not either.
  const engine = new ComputeEngine();

  test('several sources', () => {
    expect(
      expectTypeHoldsValue(
        engine,
        engine.box([
          'Map',
          ['Function', ['If', ['Equal', 'a', 1], "'x'", 'b'], 'a', 'b'],
          ['List', 1, 2],
          ['List', 5, 6],
        ]),
        'list<integer | string>'
      )
    ).toBe('["x",6]');
  });

  test('one source', () => {
    const expr = engine.box([
      'Map',
      ['Function', ['If', ['Equal', 'x', 1], "'x'", 'x'], 'x'],
      ['List', 1, 2],
    ]);
    expect(expr.type.toString()).toBe('list<integer | string>');
    const v = expr.evaluate({ materialization: true });
    expect(v.toString()).toBe('["x",2]');
    expect(v.type.matches(expr.type)).toBe(true);
  });

  test('numeric elements keep the length', () => {
    expect(
      engine
        .box(['Map', ['Function', ['Add', 'x', 1], 'x'], ['List', 1, 2]])
        .type.toString()
    ).toBe('vector<integer^2>');
  });
});

describe('THE BROADCAST READING OF A CALLBACK OVER ROWS DECLINES', () => {
  test('a recursive alias through a union arm does not overflow the stack', () => {
    // `R = list<R | list<integer>>`: the depth check of the union arms calls
    // the descent again for the `R` arm, with a smaller budget each time.
    const engine = new ComputeEngine();
    engine.declareType('R', 'list<R | list<integer>>', { alias: true });
    engine.declare('r', 'R');
    engine.declare('f', '(number) -> number');
    engine.assign('f', engine.box(['Function', ['Multiply', 2, 'x'], 'x']));
    expect(() => engine.box(['Map', 'f', 'r']).type).not.toThrow();
  });

  test('a leaf that can still hold collections is not read as a scalar', () => {
    // Rows of `list<any>` can hold lists, and the run-time broadcast descends
    // into them: the value of `Map(f, rows)` is one level deeper than the
    // declared rows.
    const engine = new ComputeEngine();
    engine.declare('f', '(number) -> number');
    engine.assign('f', engine.box(['Function', ['Multiply', 2, 'x'], 'x']));
    engine.declare('rows', 'list<list<any>>');
    engine.assign('rows', engine.box(['List', ['List', ['List', 1, 2]]]));
    const expr = engine.box(['Map', 'f', 'rows']);
    const value = expr.evaluate();
    expect(value.toString()).toBe('[[[2,4]]]');
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('an unresolved callback result is not lifted to a row type', () => {
    // An inferred identity callback answers `unknown`; lifted to
    // `list<unknown>`, the type of the `Map` excluded the nested `Missing`.
    const engine = new ComputeEngine();
    engine.declare('rows', 'list<list<any>>');
    engine.assign('rows', engine.box(['List', ['List', 1, 'Missing']]));
    engine.assign('id', engine.box(['Function', 'x', 'x']));
    for (const expr of [
      engine.box(['Map', 'id', 'rows']),
      engine.parse('\\operatorname{Map}(id, \\mathrm{rows})'),
    ])
      expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });
});
