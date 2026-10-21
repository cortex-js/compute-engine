import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isSymbol } from '../../src/compute-engine/boxed-expression/type-guards';
import { formatValue } from '../../src/cli/format';

//
// Two user decisions of 2026-10-20.
//
// 1. The absence marker of a read outside a DECLARED list that holds no
//    element comes from the declared type (rule 5 of `docs/ERROR-MODEL.md`:
//    `NaN` for a numeric element, `Missing` otherwise). With
//    `E: list<integer>` and `E := []`, `First(E)` is typed `integer | nan`;
//    its value was `Missing`, because the marker was read from the held
//    value `[]` (`list<never>`), which does not show the domain of its
//    elements. It is now `NaN`, and the type holds the value. An operand
//    with no declaration (`E := []`, the literal `First([])`) keeps
//    `Missing`: its type is the type of its value.
//
// 2. The printed value of a lazy `Map` keeps a `Nothing` result.
//    `Map(x ↦ If(x > 1, Nothing, x), [1, 2])` has 2 elements (`Length`,
//    `.count`, `.at(2)` and `.each()` all say so), but it printed `[1]`. It
//    now prints `[1, Nothing]`. The other lazy views with a callback
//    (`Tabulate`, `Table`, `Scan`, `Iterate`) printed the same way and are
//    fixed with it. Only an indexed view keeps `Nothing`, in its position
//    (user decision 2026-10-20). A list built from the view erases it, as a
//    list LITERAL does (`[1, Nothing]` is `[1]`), so that the list agrees
//    with itself (it prints `[1]` and has one element): the materialization
//    `evaluate({ materialization: true })`, `ListFrom`, the `--json` output
//    of the Epsil CLI, a list literal or a spread that holds the view,
//    `ListJoin`, a fold accumulator, `Sort`, `Tally`. A set has no positions,
//    and a set view does not hold `Nothing` either.
//
// 3. A chained `At` keeps the declared domain at every step: the marker of
//    a gather followed by an index, and of an absent intermediate row, is
//    `NaN` for a declared numeric element.
//

/** The name of `e` when it is a symbol, `undefined` otherwise. */
function symbolOf(e: Expression | undefined): string | undefined {
  return isSymbol(e) ? e.symbol : undefined;
}

function runEpsil(source: string): {
  engine: ComputeEngine;
  value: Expression;
} {
  const engine = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    engine.parse(latex).json;
  const { value, diagnostics } = executeEpsil(engine, source, { parseLatex });
  expect(diagnostics).toEqual([]);
  return { engine, value };
}

/** The name of a symbol (`Missing`), or the printed form of any other
 *  value (`NaN`, which is a number). */
function markerName(e: Expression): string {
  return symbolOf(e) ?? e.toString();
}

/** Evaluate `expr`, check that its static type holds the value, and return
 *  the name of the value (`markerName()`). */
function markerOf(expr: Expression): string {
  const value = expr.evaluate();
  expect(value.type.matches(expr.type)).toBe(true);
  return markerName(value);
}

describe('THE MARKER OF A READ OUTSIDE A DECLARED LIST THAT HOLDS NO ELEMENT', () => {
  const ce = new ComputeEngine();
  ce.declare('Ei', 'list<integer>');
  ce.assign('Ei', ce.box(['List']));
  ce.declare('Er', 'list<real>');
  ce.assign('Er', ce.box(['List']));
  ce.declare('Em', 'list<integer | missing>');
  ce.assign('Em', ce.box(['List']));
  ce.declare('Es', 'list<string>');
  ce.assign('Es', ce.box(['List']));
  // No declaration: the type is inferred from the value `[]`.
  ce.assign('Eu', ce.box(['List']));
  // The same declared types, with elements.
  ce.declare('Ni', 'list<integer>');
  ce.assign('Ni', ce.box(['List', 1, 2]));
  ce.declare('Nm', 'list<integer | missing>');
  ce.assign('Nm', ce.box(['List', 1, 2]));
  ce.declare('Ns', 'list<string>');
  ce.assign('Ns', ce.box(['List', "'a'"]));

  const reads = (name: string): [string, MathJsonExpression][] => [
    ['First', ['First', name]],
    ['Second', ['Second', name]],
    ['Third', ['Third', name]],
    ['Last', ['Last', name]],
    ['At, positive index out of range', ['At', name, 5]],
    ['At, negative index out of range', ['At', name, -5]],
    ['At, index 1', ['At', name, 1]],
  ];

  describe.each([
    ['list<integer>', 'Ei', 'integer | nan'],
    ['list<real>', 'Er', 'nan | real'],
    // The `missing` arm of the element type says nothing about the domain of
    // the other cells: the marker is `NaN`, as for `Nm` below.
    ['list<integer | missing>', 'Em', 'integer | missing | nan'],
  ])('declared %s, assigned []: NaN', (_type, name, type) => {
    test.each(reads(name))('%s', (_label, json) => {
      const expr = ce.box(json);
      expect(expr.type.toString()).toBe(type);
      expect(markerOf(expr)).toBe('NaN');
    });
  });

  test.each(reads('Es'))(
    'declared list<string>, assigned []: Missing (%s)',
    (_label, json) => {
      const expr = ce.box(json);
      expect(expr.type.toString()).toBe('missing | string');
      expect(markerOf(expr)).toBe('Missing');
    }
  );

  test.each(reads('Eu'))(
    'no declaration, assigned []: Missing (%s)',
    (_label, json) => {
      const expr = ce.box(json);
      expect(expr.type.toString()).toBe('missing');
      expect(markerOf(expr)).toBe('Missing');
    }
  );

  test.each([
    ['First', ['First', ['List']]],
    ['Last', ['Last', ['List']]],
    ['At', ['At', ['List'], 2]],
  ] as [string, MathJsonExpression][])(
    'a literal empty list: Missing (%s)',
    (_label, json) => {
      const expr = ce.box(json);
      expect(expr.type.toString()).toBe('missing');
      expect(markerOf(expr)).toBe('Missing');
    }
  );

  test('a declared list with elements gives the same marker', () => {
    expect(markerOf(ce.box(['At', 'Ni', 5]))).toBe('NaN');
    expect(markerOf(ce.box(['Third', 'Ni']))).toBe('NaN');
    expect(markerOf(ce.box(['At', 'Nm', 5]))).toBe('NaN');
    expect(markerOf(ce.box(['At', 'Nm', -5]))).toBe('NaN');
    expect(markerOf(ce.box(['At', 'Ns', 5]))).toBe('Missing');
  });

  test('a gather, an absent index and a chained read', () => {
    const engine = new ComputeEngine();
    engine.declare('E', 'list<integer>');
    engine.assign('E', engine.box(['List']));
    engine.declare('F', 'list<list<integer>>');
    engine.assign('F', engine.box(['List', ['List']]));

    const gather = engine.box(['At', 'E', ['List', 1, 5]]);
    expect(gather.type.toString()).toBe('list<integer | nan>');
    const value = gather.evaluate();
    expect(value.toString()).toBe('[NaN,NaN]');
    expect(value.type.matches(gather.type)).toBe(true);

    expect(markerOf(engine.box(['At', 'E', 'NaN']))).toBe('NaN');
    expect(markerOf(engine.box(['At', 'F', 1, 1]))).toBe('NaN');
    expect(markerOf(engine.box(['At', 'F', 2, 1]))).toBe('NaN');
  });

  test.each([
    ['\\mathrm{Ei}_1', 'NaN'],
    ['\\mathrm{Ei}[1]', 'NaN'],
    ['\\mathrm{Ei}[-1]', 'NaN'],
    ['\\mathrm{First}(\\mathrm{Ei})', 'NaN'],
    ['\\mathrm{Last}(\\mathrm{Ei})', 'NaN'],
    ['\\mathrm{At}(\\mathrm{Ei}, 3)', 'NaN'],
    ['\\mathrm{First}(\\mathrm{Er})', 'NaN'],
    ['\\mathrm{First}(\\mathrm{Em})', 'NaN'],
    ['\\mathrm{First}(\\mathrm{Es})', 'Missing'],
    ['\\mathrm{Es}[1]', 'Missing'],
    ['\\mathrm{First}(\\mathrm{Eu})', 'Missing'],
    ['\\mathrm{First}([])', 'Missing'],
  ])('parse route: %s is %s', (latex, marker) => {
    const expr = ce.parse(latex);
    expect(['At', 'First', 'Last']).toContain(expr.operator);
    expect(markerOf(expr)).toBe(marker);
  });

  test.each([
    ['let E: list<integer> = []\nfirst(E)', 'NaN'],
    ['let E: list<integer> = []\nlast(E)', 'NaN'],
    ['let E: list<integer> = []\nE[1]', 'NaN'],
    ['let E: list<real> = []\nE[-1]', 'NaN'],
    ['let E: list<string> = []\nfirst(E)', 'Missing'],
    ['let E = []\nfirst(E)', 'Missing'],
    ['first([])', 'Missing'],
  ])('Epsil route: %j is %s', (source, marker) => {
    const { value } = runEpsil(source);
    expect(markerName(value)).toBe(marker);
  });
});

describe('THE PRINTED VALUE OF A LAZY VIEW KEEPS A NOTHING RESULT', () => {
  const ce = new ComputeEngine();
  const NOTHING_ABOVE_ONE: MathJsonExpression = [
    'Function',
    ['If', ['Greater', 'x', 1], 'Nothing', 'x'],
    'x',
  ];
  const MAP: MathJsonExpression = ['Map', NOTHING_ABOVE_ONE, ['List', 1, 2]];

  test('Map: every view has two elements', () => {
    const map = ce.box(MAP);
    expect(map.type.toString()).toBe('list<integer | nothing^2>');
    expect(map.count).toBe(2);
    expect(symbolOf(map.at(2))).toBe('Nothing');
    expect([...map.each()].map((x) => x.toString())).toEqual([
      '1',
      '"Nothing"',
    ]);
    expect(ce.box(['Length', MAP]).evaluate().toString()).toBe('2');

    expect(map.toString()).toBe('[1,"Nothing"]');
    expect(map.evaluate().toString()).toBe('[1,"Nothing"]');
  });

  // A list built from the view erases `Nothing`, as a list literal does
  // (user decision 2026-10-20).
  test('Map turned into a list: the list erases Nothing', () => {
    const map = ce.box(MAP);
    const listed = map.evaluate({ materialization: true });
    expect(listed.operator).toBe('List');
    expect(listed.toString()).toBe('[1]');
    expect(listed.count).toBe(1);
    expect([...listed.each()].map((x) => x.toString())).toEqual(['1']);
    expect(ce.box(['Length', listed]).evaluate().toString()).toBe('1');

    const listFrom = ce.box(['ListFrom', MAP]).evaluate();
    expect(listFrom.toString()).toBe('[1]');
    expect(listFrom.count).toBe(1);
  });

  test('Map whose every result is Nothing', () => {
    const map = ce.box([
      'Map',
      ['Function', 'Nothing', 'x'],
      ['List', 1, 2, 3],
    ]);
    expect(map.evaluate().toString()).toBe('["Nothing","Nothing","Nothing"]');
  });

  test('Map over two sources and over a range', () => {
    expect(
      ce
        .box([
          'Map',
          ['Function', ['If', ['Greater', 'x', 1], 'Nothing', 'y'], 'x', 'y'],
          ['List', 1, 2],
          ['List', 5, 6],
        ])
        .toString()
    ).toBe('[5,"Nothing"]');
    expect(ce.box(['Map', NOTHING_ABOVE_ONE, ['Range', 1, 2]]).toString()).toBe(
      '[1,"Nothing"]'
    );
  });

  // A list literal is a value: its evaluation lists the view it holds, and
  // that list erases `Nothing` (user decision 2026-10-20).
  test('a list literal that holds the Map', () => {
    const value = ce.box(['List', MAP]).evaluate();
    expect(value.toString()).toBe('[[1]]');
    const inner = value.at(1)!;
    expect(inner.count).toBe(1);
    expect([...inner.each()].map((x) => x.toString())).toEqual(['1']);
  });

  test('a list literal that holds the Map, turned into a list', () => {
    // The materialization of the literal lists the view, and the list erases
    // `Nothing` (user decision 2026-10-20).
    expect(
      ce.box(['List', MAP]).evaluate({ materialization: true }).toString()
    ).toBe('[[1]]');
  });

  test('Tabulate and Table', () => {
    const tabulate = ce.box(['Tabulate', NOTHING_ABOVE_ONE, 2]);
    expect(tabulate.count).toBe(2);
    expect(tabulate.toString()).toBe('[1,"Nothing"]');
    const table = ce.box([
      'Table',
      ['If', ['Greater', 'i', 1], 'Nothing', 'i'],
      ['Tuple', 'i', 1, 2],
    ]);
    expect(table.toString()).toBe('[1,"Nothing"]');
  });

  test('Scan', () => {
    const scan = ce.box([
      'Scan',
      ['List', 1, 2, 3],
      ['Function', ['If', ['Greater', 'b', 1], 'Nothing', 'b'], 'a', 'b'],
    ]);
    expect(scan.count).toBe(3);
    expect(scan.toString()).toBe('[1,"Nothing","Nothing"]');
  });

  test('Iterate', () => {
    const iterate = ce.box([
      'Take',
      [
        'Iterate',
        [
          'Function',
          ['If', ['Greater', 'x', 1], 'Nothing', ['Add', 'x', 1]],
          'x',
        ],
        1,
      ],
      2,
    ]);
    expect(iterate.count).toBe(2);
    expect(iterate.toString()).toBe('[2,"Nothing"]');
  });

  test('a list literal still erases a Nothing element', () => {
    const literal = ce.box(['List', 1, 'Nothing']);
    expect(literal.toString()).toBe('[1]');
    expect(literal.count).toBe(1);
  });

  test('parse route', () => {
    const engine = new ComputeEngine();
    engine.declare('g', 'function');
    engine.assign('g', engine.box(NOTHING_ABOVE_ONE));
    const map = engine.parse('\\mathrm{Map}(g, [1, 2])');
    expect(map.count).toBe(2);
    expect(map.toString()).toBe('[1,"Nothing"]');
    expect(map.evaluate().toString()).toBe('[1,"Nothing"]');
  });

  test('Epsil route', () => {
    const { value } = runEpsil('map(x => Nothing if x > 1 else x, [1, 2])');
    expect(value.count).toBe(2);
    expect(value.toString()).toBe('[1,"Nothing"]');
  });

  // The printed result of a program is a display of the view, and keeps
  // `Nothing`. The `--json` output lists the view, and erases it, as a list
  // does (user decision 2026-10-20).
  test('Epsil CLI: the printed value and the JSON value', () => {
    const source = 'map(x => Nothing if x > 1 else x, [1, 2])';
    const engine = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      engine.parse(latex).json;
    const result = executeEpsil(engine, source, { parseLatex });
    expect(result.diagnostics).toEqual([]);
    const evaluated = { ...result, source, elapsedMs: 0 };
    expect(formatValue(evaluated, 'value')).toBe('[1,"Nothing"]');
    expect(JSON.parse(formatValue(evaluated, 'json'))).toEqual(['List', 1]);
  });
});

describe('A LIST BUILT FROM A VIEW THAT YIELDS NOTHING AGREES WITH ITSELF', () => {
  // Each of these builds a list (or a set) from a lazy view that yields
  // `Nothing`. A list erases a `Nothing` element as a list literal does, and
  // a set has no positions, so the printed value, the count and the
  // elements of the result must all leave `Nothing` out (user decision
  // 2026-10-20).
  const ce = new ComputeEngine();
  const NOTHING_ABOVE_ONE: MathJsonExpression = [
    'Function',
    ['If', ['Greater', 'x', 1], 'Nothing', 'x'],
    'x',
  ];
  const MAP: MathJsonExpression = ['Map', NOTHING_ABOVE_ONE, ['List', 1, 2, 3]];
  const EPSIL_MAP = 'map(x => Nothing if x > 1 else x, [1, 2, 3])';

  /** The printed value, the count, the elements and `Length` of `json`. */
  function views(json: MathJsonExpression): {
    printed: string;
    count: number | bigint | undefined;
    elements: string[];
    length: string;
  } {
    const value = ce.box(json).evaluate();
    return {
      printed: value.toString(),
      count: value.count,
      elements: [...value.each()].map((x) => x.toString()),
      length: ce.box(['Length', json]).evaluate().toString(),
    };
  }

  test.each([
    ['a spread in a list literal', ['List', ['Spread', MAP], 9]],
    ['ListJoin', ['ListJoin', MAP, ['List', 9]]],
  ] as [string, MathJsonExpression][])('%s', (_label, json) => {
    expect(views(json)).toEqual({
      printed: '[1,9]',
      count: 2,
      elements: ['1', '9'],
      length: '2',
    });
  });

  test('a Join accumulator of a fold', () => {
    const json: MathJsonExpression = [
      'Fold',
      [
        'Function',
        ['Join', 'acc', ['Map', NOTHING_ABOVE_ONE, ['List', 'y', 'y']]],
        'acc',
        'y',
      ],
      ['List', 0],
      ['List', 1, 2],
    ];
    expect(views(json)).toEqual({
      printed: '[0,1,1]',
      count: 3,
      elements: ['0', '1', '1'],
      length: '3',
    });
  });

  test('Epsil route: a spread', () => {
    const { value } = runEpsil(`[...${EPSIL_MAP}, 9]`);
    expect(value.toString()).toBe('[1,9]');
    expect(value.count).toBe(2);
  });

  test('a set view does not hold Nothing', () => {
    const set = ce.box(['Map', NOTHING_ABOVE_ONE, ['Set', 1, 2, 3]]);
    expect(set.toString()).toBe('Set(1)');
    expect(set.count).toBe(1);
    expect([...set.each()].map((x) => x.toString())).toEqual(['1']);
    const join = ce.box([
      'Join',
      ['Set', 1],
      ['Map', NOTHING_ABOVE_ONE, ['Set', 2, 3]],
    ]);
    expect(join.count).toBe(1);
    expect(join.toString()).toBe('Set(1)');
  });

  test('Tally', () => {
    expect(ce.box(['Tally', MAP]).evaluate().toString()).toBe('([1], [1])');
    expect(runEpsil(`tally(${EPSIL_MAP})`).value.toString()).toBe('([1], [1])');
  });

  test.each([['Sort'], ['RandomShuffle'], ['Unique'], ['Ordering']])(
    '%s builds a list: its count is the count of its value',
    (op) => {
      const json: MathJsonExpression = [op, MAP];
      const v = views(json);
      expect(v.count).toBe(v.elements.length);
      expect(v.length).toBe(String(v.elements.length));
      expect(ce.box(['Count', json]).evaluate().toString()).toBe(v.length);
    }
  );

  test('Sort: the value and the length', () => {
    expect(views(['Sort', MAP])).toEqual({
      printed: '[1]',
      count: 1,
      elements: ['1'],
      length: '1',
    });
    expect(views(['Sort', ['Reverse', MAP]]).length).toBe('1');
  });

  test.each([
    ['Reverse', ['Reverse', MAP], 3],
    ['Take', ['Take', MAP, 3], 3],
    ['Drop', ['Drop', MAP, 1], 2],
    ['Rest', ['Rest', MAP], 2],
    ['Most', ['Most', MAP], 2],
  ] as [string, MathJsonExpression, number][])(
    '%s is a view: it keeps Nothing in its position, and its count agrees',
    (_label, json, n) => {
      const v = views(json);
      expect(v.count).toBe(n);
      expect(v.elements.length).toBe(n);
      expect(v.length).toBe(String(n));
    }
  );

  test('parse route: Sort', () => {
    const engine = new ComputeEngine();
    engine.declare('g', 'function');
    engine.assign('g', engine.box(NOTHING_ABOVE_ONE));
    expect(
      engine
        .parse('\\mathrm{Length}(\\mathrm{Sort}(\\mathrm{Map}(g, [1, 2, 3])))')
        .evaluate()
        .toString()
    ).toBe('1');
  });

  test('Epsil route: Sort', () => {
    expect(runEpsil(`length(sort(${EPSIL_MAP}))`).value.toString()).toBe('1');
  });
});

describe('A CHAINED READ KEEPS THE DECLARED DOMAIN AT EVERY STEP', () => {
  // The marker of a read outside a declared list is that of the declared
  // element type at every index of a chained `At` (user decision
  // 2026-10-20): a gather followed by an index, and an absent intermediate
  // row, give the marker of the final declared domain.
  const ce = new ComputeEngine();
  ce.declare('E', 'list<integer>');
  ce.assign('E', ce.box(['List']));
  ce.declare('Mr', 'list<list<integer> | missing>');
  ce.assign('Mr', ce.box(['List', 'Missing']));

  test.each([
    ['a gather, then an index', ['At', 'E', ['List', 1], 1]],
    ['the same read in two steps', ['At', ['At', 'E', ['List', 1]], 1]],
    ['an absent intermediate row', ['At', 'Mr', 1, 1]],
    ['the same read with First', ['First', ['First', 'Mr']]],
  ] as [string, MathJsonExpression][])('%s is NaN', (_label, json) => {
    expect(markerOf(ce.box(json))).toBe('NaN');
  });

  test('parse route', () => {
    expect(markerOf(ce.parse('\\mathrm{At}(E, [1], 1)'))).toBe('NaN');
    expect(markerOf(ce.parse('\\mathrm{At}(\\mathrm{Mr}, 1, 1)'))).toBe('NaN');
  });
});
