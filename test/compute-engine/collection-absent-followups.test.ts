import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isSymbol } from '../../src/compute-engine/boxed-expression/type-guards';

//
// Collection results that can hold an absent element. The static type of
// an expression must hold its value: `value.type.matches(expr.type)`. The
// bare `unknown` and the bare collection types admit values only, and `any`
// admits the absence markers (`docs/ERROR-MODEL.md`, and "Bare collection
// types are values-only synonyms" in `CLAUDE.md`). Each block below was a
// case where the type did not hold the value, or where two views of one
// value did not agree:
//
// - `Iterate` was typed `list` (`list<unknown>`) when the initial value or
//   the function can be absent.
// - An element access of an empty list literal (`First([])`) was typed
//   `unknown`, while the value is `Missing`.
// - `Map` with a broadcastable operator (`Sqrt`) over a source whose
//   elements may be collections was typed a list of numbers, while the
//   operator maps over each inner list.
// - `Map` with a user function that has no declared result was typed with
//   the element type of the source (`character`), while the function
//   returns strings.
// - The element of `Zip` made of absent cells only was `Missing` when
//   printed, but `(Missing, Missing)` through `.at()` and `.each()`.
//
// A lazy value (`Take` of an `Iterate`, a `Map`, a `Zip`) is typed from the
// same derivation as the static type, so it is first listed into a `List`
// literal, which is typed from its elements.
//

const ce = new ComputeEngine();

/** The value as a literal collection, typed from its elements. */
function listed(v: Expression): Expression {
  if (!v.isCollection || v.isFiniteCollection !== true) return v;
  if (['List', 'Set', 'Tuple', 'Dictionary'].includes(v.operator)) return v;
  return ce.function(v.type.matches('set<any>') ? 'Set' : 'List', [
    ...v.each(),
  ]);
}

function expectTypeHoldsValue(expr: Expression, type: string): Expression {
  expect(expr.type.toString()).toBe(type);
  const value = listed(expr.evaluate());
  expect(value.type.matches(expr.type)).toBe(true);
  return value;
}

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

const IDENTITY: MathJsonExpression = ['Function', 'x', 'x'];
const ABSENT_ABOVE_TWO: MathJsonExpression = [
  'Function',
  ['If', ['Greater', 'x', 2], 'Missing', ['Add', 'x', 1]],
  'x',
];

describe('ITERATE WITH AN ABSENT INITIAL VALUE OR RESULT', () => {
  test('an absent initial value: the elements are absent', () => {
    expect(ce.box(['Iterate', IDENTITY, 'Missing']).type.toString()).toBe(
      'list<any>'
    );
    const value = expectTypeHoldsValue(
      ce.box(['Take', ['Iterate', IDENTITY, 'Missing'], 3]),
      'list<any>'
    );
    expect(value.toString()).toBe('["Missing","Missing","Missing"]');
  });

  test('a function that can answer `Missing`', () => {
    expect(ce.box(['Iterate', ABSENT_ABOVE_TWO, 1]).type.toString()).toBe(
      'list<any>'
    );
    const value = expectTypeHoldsValue(
      ce.box(['Take', ['Iterate', ABSENT_ABOVE_TWO, 1], 3]),
      'list<any>'
    );
    expect(value.toString()).toBe('[2,3,"Missing"]');
  });

  // A function whose inferred result is `unknown` says nothing about
  // absence (`missing ⊔ unknown` is `unknown`).
  test.each([
    [
      'a branch that answers `Missing`, another the parameter',
      [
        'Iterate',
        ['Function', ['If', ['Greater', 'x', 0], 'Missing', 'x'], 'x'],
        1,
      ],
      3,
    ],
    [
      'a two-parameter function',
      [
        'Iterate',
        ['Function', ['If', ['Greater', 'n', 1], 'Missing', 'a'], 'n', 'a'],
        1,
      ],
      3,
    ],
    [
      'an element access of the accumulator',
      ['Iterate', ['Function', ['First', 'x'], 'x'], ['List']],
      2,
    ],
  ])('%s', (_name, json, n) => {
    expectTypeHoldsValue(ce.box(['Take', json, n] as any), 'list<any>');
  });

  test('a user function that can answer `Missing`', () => {
    const engine = new ComputeEngine();
    engine.declare('u', 'function');
    engine.assign(
      'u',
      engine.box([
        'Function',
        ['If', ['Greater', 'x', 1], 'Missing', ['Add', 'x', 1]],
        'x',
      ])
    );
    expect(engine.box(['Iterate', 'u', 1]).type.toString()).toBe('list<any>');
  });

  test('no absent value: the type is unchanged', () => {
    expect(
      ce
        .box(['Iterate', ['Function', ['Multiply', 2, 'x'], 'x'], 1])
        .type.toString()
    ).toBe('list');
  });

  test('parse route', () => {
    const value = expectTypeHoldsValue(
      ce.parse(
        '\\mathrm{Take}(\\mathrm{Iterate}(x \\mapsto x, \\mathrm{Missing}), 3)'
      ),
      'list<any>'
    );
    expect(value.toString()).toBe('["Missing","Missing","Missing"]');
  });

  test('Epsil route', () => {
    const { engine, value } = runEpsil('take(iterate(x => x, Missing), 3)');
    expect(value.toString()).toBe('["Missing","Missing","Missing"]');
    expect(engine.box(['Iterate', IDENTITY, 'Missing']).type.toString()).toBe(
      'list<any>'
    );
  });
});

describe('AN ELEMENT ACCESS THAT FINDS NOTHING', () => {
  const engine = new ComputeEngine();
  engine.declare('Xs', 'list<integer>');

  test.each([
    ['First', ['First', ['List']]],
    ['Second', ['Second', ['List']]],
    ['Third', ['Third', ['List']]],
    ['Last', ['Last', ['List']]],
    ['At', ['At', ['List'], 2]],
    ['At from the end', ['At', ['List'], -1]],
  ])('%s of an empty list literal is typed `missing`', (_name, json) => {
    const value = expectTypeHoldsValue(engine.box(json as any), 'missing');
    expect(symbolOf(value)).toBe('Missing');
  });

  test('a gather from an empty list literal', () => {
    const value = expectTypeHoldsValue(
      engine.box(['At', ['List'], ['List', 1, 2]]),
      'list<missing>'
    );
    expect(value.toString()).toBe('["Missing","Missing"]');
  });

  test.each([
    ['\\mathrm{First}([])'],
    ['\\mathrm{Last}([])'],
    ['[][1]'],
    ['\\mathrm{At}([], 2)'],
  ])('parse route: %s', (latex) => {
    const value = expectTypeHoldsValue(engine.parse(latex), 'missing');
    expect(symbolOf(value)).toBe('Missing');
  });

  test('a numeric list of unknown length keeps `T | nan`', () => {
    expect(engine.box(['First', 'Xs']).type.toString()).toBe('integer | nan');
    expect(engine.box(['At', 'Xs', 4]).type.toString()).toBe('integer | nan');
  });

  test('Epsil route', () => {
    const { engine: e, value } = runEpsil('first([])');
    expect(symbolOf(value)).toBe('Missing');
    expect(e.box(['First', ['List']]).type.toString()).toBe('missing');
  });
});

describe('MAP OF A BROADCASTABLE OPERATOR OVER ELEMENTS THAT MAY BE LISTS', () => {
  const engine = new ComputeEngine();
  const NESTED: MathJsonExpression = ['List', ['List', 1, 2], ['List', 3]];
  engine.declare('U', 'any');
  engine.assign('U', engine.box(NESTED));
  engine.declare('La', 'list<any>');
  engine.assign('La', engine.box(NESTED));
  engine.declare('Lu', 'list<integer | list<integer>>');
  engine.assign('Lu', engine.box(['List', ['List', 1, 2], 3]));

  function check(expr: Expression, type: string): void {
    const v = expectTypeHoldsValue(expr, type);
    expect(v.toString()).toBe(
      JSON.stringify(expr.json).includes('"Lu"')
        ? '[[1,sqrt(2)],sqrt(3)]'
        : '[[1,sqrt(2)],[sqrt(3)]]'
    );
  }

  test('a source typed `any`', () =>
    check(
      engine.box(['Map', 'Sqrt', 'U']),
      'list<complex | indexed_collection<any> | infinity | nan | nothing>'
    ));

  test('a source typed `list<any>`', () =>
    check(
      engine.box(['Map', 'Sqrt', 'La']),
      'list<complex | indexed_collection<any> | infinity | nan | nothing>'
    ));

  test('a source whose element type has a list arm', () =>
    check(engine.box(['Map', 'Sqrt', 'Lu']), 'list<complex | list<complex>>'));

  test('another broadcastable operator', () => {
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'Negate', 'U']),
      'list<indexed_collection<any> | nothing | number>'
    );
    expect(v.toString()).toBe('[[-1,-2],[-3]]');
  });

  test('a source of scalars keeps the declared result', () => {
    expect(engine.box(['Map', 'Sqrt', ['List', 1, 4]]).type.toString()).toBe(
      'list<complex | infinity^2>'
    );
  });

  test('parse route', () => {
    check(
      engine.parse('\\mathrm{Map}(\\mathrm{Sqrt}, U)'),
      'list<complex | indexed_collection<any> | infinity | nan | nothing>'
    );
    check(
      engine.parse('\\mathrm{Map}(\\mathrm{Sqrt}, \\mathrm{La})'),
      'list<complex | indexed_collection<any> | infinity | nan | nothing>'
    );
  });
});

describe('MAP: NESTED ELEMENTS, SEVERAL SOURCES, ABSENT CELLS', () => {
  const engine = new ComputeEngine();
  engine.declare('Ld', 'list<any>');
  engine.assign('Ld', engine.box(['List', 4, ['List', ['List', 9]]]));
  engine.declare('Nn', 'list<any>');
  engine.assign('Nn', engine.box(['List', ['List', 1, 2], 3]));
  engine.declare('Lbs', 'list<any>');
  engine.assign('Lbs', engine.box(['List', 'True', 'Missing']));
  engine.declare('Lim', 'list<integer | missing>');
  engine.assign('Lim', engine.box(['List', 4, 'Missing']));

  test('an element nested two levels deep', () => {
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'Sqrt', 'Ld']),
      'list<complex | indexed_collection<any> | infinity | nan | nothing>'
    );
    expect(v.toString()).toBe('[2,[[3]]]');
  });

  test('several sources whose elements may be lists', () => {
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'Power', 'Nn', 'Nn']),
      'list<indexed_collection<any> | nothing | number>'
    );
    expect(v.toString()).toBe('[[1,4],27]');
  });

  test('a boolean result over an absent cell of a `list<any>`', () => {
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'Not', 'Lbs']),
      'list<boolean | indexed_collection<any> | missing | nothing>'
    );
    expect(v.toString()).toBe('["False","Missing"]');
  });

  test('a boolean result over an absent cell of a declared list', () => {
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'IsPrime', 'Lim']),
      'list<boolean | missing>'
    );
    expect(v.toString()).toBe('["False","Missing"]');
  });

  test('a numeric result over an absent cell has no `missing` arm', () => {
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'Sqrt', 'Lim']),
      'list<complex | infinity | nan>'
    );
    expect(v.toString()).toBe('[2,NaN]');
  });

  // A library operator keeps its declared result (or, when that says
  // nothing, the type of the source): its type handler reads the structure
  // of its operand, which a call on a typed element does not have.
  test('Hold keeps the type of the source', () => {
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'Hold', ['List', 1, 2]]),
      'vector<integer^2>'
    );
    expect(v.toString()).toBe('[Hold(1),Hold(2)]');
  });

  // `PointX("")` is `Missing`, so a cell is a character or `Missing`. A list
  // literal whose cells are a union that is not a number type states no
  // length (`[Missing, "b"]` is typed `list<character | missing>`), so the
  // type of the `Map` states none either, and holds both values.
  test('PointX over strings is not typed as lists of numbers', () => {
    for (const strings of [
      ["'a'", "'b'"],
      ["''", "'b'"],
    ]) {
      const e = engine.box(['Map', 'PointX', ['List', ...strings]]);
      expect(e.type.toString()).toBe('list<character | missing>');
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
  });
});

describe('MAP OF A USER FUNCTION WITH NO DECLARED RESULT', () => {
  test('a function value whose body can answer its parameter', () => {
    const engine = new ComputeEngine();
    engine.declare('g', 'function');
    engine.assign(
      'g',
      engine.box(['Function', ['If', ['Equal', 'c', "'a'"], "'zz'", 'c'], 'c'])
    );
    const v = expectTypeHoldsValue(
      engine.box(['Map', 'g', ['Characters', "'abc'"]]),
      'list<character | string>'
    );
    expect(v.toString()).toBe('["zz","b","c"]');
  });

  // `test/epsil/corpus/exercism/atbash-cipher.epsil`.
  const ATBASH = [
    'atbashChar(c) = do {',
    '  let code = unicodeScalars(String(c))[1]',
    '  stringFrom([219 - code]) if 97 <= code <= 122 else c',
    '}',
  ].join('\n');

  test('Epsil route: the atbash program', () => {
    const { engine, value } = runEpsil(
      `${ATBASH}\nmap(atbashChar, characters("abc"))`
    );
    expect(value.toString()).toBe('["z","y","x"]');
    const expr = engine.box(['Map', 'atbashChar', ['Characters', "'abc'"]]);
    expect(expr.type.toString()).toBe('list<character | string>');
    expect(listed(expr.evaluate()).type.matches(expr.type)).toBe(true);
  });

  test('Epsil route: a function that answers its parameter keeps the element type', () => {
    const { engine } = runEpsil('f(c) = c\n0');
    expect(
      engine.box(['Map', 'f', ['Characters', "'abc'"]]).type.toString()
    ).toBe('list<character>');
  });
});

describe('ZIP OF ABSENT CELLS', () => {
  // Each row is a present tuple, including a row of missing coordinates.
  const engine = new ComputeEngine();
  engine.declare('L', 'list<integer | missing>');
  engine.assign('L', engine.box(['List', 1, 'Missing', 3]));

  function checkViews(zip: Expression): void {
    expect(zip.type.toString()).toBe(
      'list<tuple<integer | missing, integer | missing>>'
    );
    const value = zip.evaluate();
    expect(value.toString()).toBe('[(1, 1),("Missing", "Missing"),(3, 3)]');
    expect(value.at(2)?.json).toEqual(['Tuple', 'Missing', 'Missing']);
    expect([...value.each()].map((x) => x.toString())).toEqual([
      '(1, 1)',
      '("Missing", "Missing")',
      '(3, 3)',
    ]);
    expect(listed(value).type.matches(zip.type)).toBe(true);
  }

  test('box route', () => checkViews(engine.box(['Zip', 'L', 'L'])));

  test('parse route', () => checkViews(engine.parse('\\mathrm{Zip}(L, L)')));

  test('an element access', () => {
    expect(engine.box(['At', ['Zip', 'L', 'L'], 2]).evaluate().json).toEqual([
      'Tuple',
      'Missing',
      'Missing',
    ]);
  });

  test('a pair with one present cell stays a tuple', () => {
    const value = engine
      .box(['Zip', ['List', 1, 'Missing'], ['List', 3, 4]])
      .evaluate();
    expect(value.at(2)?.toString()).toBe('("Missing", 4)');
    expect(value.toString()).toBe('[(1, 3),("Missing", 4)]');
  });

  test('Epsil route', () => {
    const { value } = runEpsil('let xs = [1, Missing, 3]\nzip(xs, xs)[2]');
    expect(value.json).toEqual(['Tuple', 'Missing', 'Missing']);
    const { value: destructured } = runEpsil(
      'let xs = [1, Missing, 3]\nmap(((a, b)) => b ?? 0, zip(xs, xs))'
    );
    expect(destructured.toString()).toBe('[1,0,3]');
  });
});

describe('ZIP OF ABSENT CELLS, COMPILED AND WITH AN ERASED ITEM', () => {
  const engine = new ComputeEngine();
  engine.declare('L', 'list<integer | missing>');
  engine.declare('I', 'list<integer>');

  test('JavaScript: a row of absent cells remains a row', () => {
    const r = compile(engine.box(['Zip', 'L', 'L']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ L: [1, undefined, 3] } as never)).toEqual([
      [1, 1],
      [undefined, undefined],
      [3, 3],
    ]);
  });

  test('JavaScript: a row with a present cell is a row', () => {
    const r = compile(engine.box(['Zip', 'L', 'I']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ L: [1, undefined], I: [4, 5] } as never)).toEqual([
      [1, 4],
      [undefined, 5],
    ]);
  });

  test('JavaScript: a source with no absent cell keeps the plain row', () => {
    const r = compile(engine.box(['Zip', 'I', 'I']), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_x === undefined');
  });

  test('Python: all-missing rows need no collapse test', () => {
    const r = compile(engine.box(['Zip', 'L', 'L']), { to: 'python' });
    expect(r.success).toBe(true);
    expect(
      compile(engine.box(['Zip', 'L', 'I']), { to: 'python' }).success
    ).toBe(true);
  });

  test('an omitted item keeps its row coordinate', () => {
    // A raw Nothing result keeps the first coordinate of the second row.
    const zip = engine
      .box([
        'Zip',
        [
          'Map',
          ['Function', ['If', ['Greater', 'x', 1], 'Nothing', 'x'], 'x'],
          ['List', 1, 2],
        ],
        ['List', 3, 'Missing'],
      ])
      .evaluate();
    expect(zip.at(2)?.json).toEqual(['Tuple', 'Nothing', 'Missing']);
    expect([...zip.each()].map((x) => x.toString())).toEqual([
      '(1, 3)',
      '("Nothing", "Missing")',
    ]);
  });
});

describe('Absent whole collections and absent number cells (CE-44, CE-20)', () => {
  test('a comparison of a list that may be absent is a list or Missing', () => {
    const c = new ComputeEngine();
    c.declare('L', 'list<integer> | missing');
    expect(c.box(['Less', 'L', 3]).type.toString()).toBe(
      'list<boolean> | missing'
    );
    expect(c.box(['Equal', 'L', 3]).type.toString()).toBe(
      'list<boolean> | missing'
    );
    // An absent scalar gives an absent cell, not an absent list.
    c.declare('n', 'integer | missing');
    expect(c.box(['Less', 'n', ['List', 1, 2]]).type.toString()).toBe(
      'list<boolean | missing^2>'
    );
    // The value is Missing for the whole list when L is absent.
    expect(c.box(['Less', 'Missing', 3]).evaluate().json).toBe('Missing');
  });

  test('an operand typed unknown (Undefined) keeps the absent cells', () => {
    const c = new ComputeEngine();
    c.declare('L', 'list<integer> | missing');
    const e = c.box(['Less', 'L', 'Undefined']);
    expect(e.type.toString()).toBe('list<boolean | missing> | missing');
    c.assign('L', c.box(['List', 1, 2]));
    const v = e.evaluate();
    expect(v.toString()).toBe('["Missing","Missing"]');
    expect(v.type.matches(e.type)).toBe(true);
  });

  test('a custom handle operator keeps the absent arm of its cells', () => {
    const c = new ComputeEngine();
    c.declare('Pick', {
      signature: '(integer, integer) -> integer | missing',
      broadcastable: true,
      missingBehavior: 'handle',
      evaluate: () => c.Missing,
    } as never);
    c.declare('L', 'list<integer> | missing');
    // The cells keep their absent arm: not `list<integer> | missing`.
    expect(c.box(['Pick', 'L', 3]).type.toString()).toBe(
      'list<integer | missing> | missing'
    );
  });

  test('a list literal keeps its dimensions for number cells that may be absent', () => {
    const c = new ComputeEngine();
    expect(c.box(['List', 1, 'Missing']).type.toString()).toBe(
      'list<integer | missing^2>'
    );
    expect(
      c
        .box(['List', ['List', 'Missing', -2], ['List', -3, 'Missing']])
        .type.toString()
    ).toBe('matrix<integer | missing^(2x2)>');
  });
});
