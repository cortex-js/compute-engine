/**
 * A lazy collection operator over a source that is not a collection value
 * yet.
 *
 * A lazy operator (`Map`, `Filter`, `Dedup`, `Scan`, `ArgMax`, `Reduce`, ...)
 * holds its operands. A source that is an eager operator (an element read
 * `At(t, 1)`, a `Sort`, a call of a user function) has no collection handlers
 * before it is evaluated, so the view could not walk it and stayed
 * unevaluated, and `Numerator(At(t, 1))` read the list as one number. The
 * rule: when the lazy node is evaluated, such a source is evaluated ONCE, and
 * the operator is applied to the value. An error value is the value of the
 * node. A value that cannot be a collection is an `incompatible-type` error.
 *
 * The display preview (`toString()`, `toLatex()`) does not evaluate the
 * source of a view: an unevaluated view prints as written.
 *
 * The rule is `heldEagerSources()` and `materializesAfterOperands()` in
 * `src/compute-engine/boxed-expression/boxed-function.ts`, stated in
 * `docs/COLLECTIONS-MODEL.md` § "Lazy collections".
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const SRC = ['At', 't', 1];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'tuple<list<integer>, list<integer>>');
  ce.assign('t', ce.box(['Tuple', ['List', 3, 1, 2], ['List', 4]]));
  return ce;
}

const json = (x: Expression) => JSON.stringify(x.json);

// Each case: the operator applied to the source, and the value of the same
// operator over the literal list `[3, 1, 2]`, fully materialized.
const CASES: [string, unknown, unknown][] = [
  ['ArgMax', ['ArgMax', SRC], 1],
  ['ArgMin', ['ArgMin', SRC], 2],
  ['Dedup', ['Dedup', SRC], ['List', 3, 1, 2]],
  ['Differences', ['Differences', SRC], ['List', -2, 1]],
  [
    'FlatMap',
    ['FlatMap', SRC, ['Function', ['List', 'x', 'x'], 'x']],
    ['List', 3, 3, 1, 1, 2, 2],
  ],
  ['Scan', ['Scan', SRC, 'Add'], ['List', 3, 4, 6]],
  [
    'TakeWhile',
    ['TakeWhile', SRC, ['Function', ['Greater', 'x', 2], 'x']],
    ['List', 3],
  ],
  [
    'DropWhile',
    ['DropWhile', SRC, ['Function', ['Greater', 'x', 2], 'x']],
    ['List', 1, 2],
  ],
  ['Numerator', ['Numerator', SRC], ['List', 3, 1, 2]],
  ['Denominator', ['Denominator', SRC], ['List', 1, 1, 1]],
  ['Reduce', ['Reduce', SRC, 'Add', 0], 6],
  [
    'Count of Filter',
    ['Count', ['Filter', SRC, ['Function', ['Greater', 'x', 1], 'x']]],
    2,
  ],
  ['Map', ['Map', ['Function', ['Add', 'x', 1], 'x'], SRC], ['List', 4, 2, 3]],
  ['MaxBy', ['MaxBy', SRC, ['Function', ['Negate', 'x'], 'x']], 1],
  [
    'Comprehension',
    ['Comprehension', ['Multiply', 2, 'x'], ['Element', 'x', SRC]],
    ['List', 6, 2, 4],
  ],
  ['Reverse', ['Reverse', SRC], ['List', 2, 1, 3]],
  ['Join', ['Join', SRC, ['List', 9]], ['List', 3, 1, 2, 9]],
  ['Take', ['Take', SRC, 2], ['List', 3, 1]],
];

describe('A LAZY OPERATOR EVALUATES AN EAGER SOURCE ONCE', () => {
  test.each(CASES)('%s, sync', (_name, input, expected) => {
    const ce = engine();
    const e = ce.box(input as never);
    expect(json(e.evaluate({ materialization: true }))).toBe(
      json(ce.box(expected as never))
    );
  });

  test.each(CASES)('%s, async', async (_name, input, expected) => {
    const ce = engine();
    const e = ce.box(input as never);
    expect(json(await e.evaluateAsync({ materialization: true }))).toBe(
      json(ce.box(expected as never))
    );
  });

  // Under a plain `evaluate()`, a view stays a view, but over the VALUE of
  // the source, as a view over a literal list does.
  test.each([
    ['Dedup', ['Dedup', SRC]],
    ['Differences', ['Differences', SRC]],
    ['Scan', ['Scan', SRC, 'Add']],
    ['TakeWhile', ['TakeWhile', SRC, ['Function', ['Greater', 'x', 2], 'x']]],
    ['FlatMap', ['FlatMap', SRC, ['Function', ['List', 'x', 'x'], 'x']]],
  ])('a plain evaluate() of %s gives the view over the list', (name, input) => {
    const ce = engine();
    const value = ce.box(input as never).evaluate();
    expect(value.operator).toBe(name);
    expect(json(value.op1)).toBe('["List",3,1,2]');
  });

  test('the handlers of ArgMax, ArgMin and Numerator answer a plain evaluate()', () => {
    const ce = engine();
    expect(json(ce.box(['ArgMax', SRC] as never).evaluate())).toBe('1');
    expect(json(ce.box(['ArgMin', SRC] as never).evaluate())).toBe('2');
    expect(json(ce.box(['Numerator', SRC] as never).evaluate())).toBe(
      '["List",3,1,2]'
    );
    expect(json(ce.box(['Denominator', SRC] as never).evaluate())).toBe(
      '["List",1,1,1]'
    );
  });

  test.each([
    ['\\mathrm{Dedup}(t[1])', '["List",3,1,2]'],
    ['\\operatorname{ArgMax}(t[1])', '1'],
    ['\\mathrm{Scan}(t[1], \\mathrm{Add})', '["List",3,4,6]'],
    ['\\mathrm{Differences}(t[1])', '["List",-2,1]'],
    ['\\mathrm{TakeWhile}(t[1], x \\mapsto x > 2)', '["List",3]'],
    ['\\mathrm{Numerator}(t[1])', '["List",3,1,2]'],
    ['\\mathrm{Reverse}(t[1])', '["List",2,1,3]'],
  ])('parse route: %s', async (latex, expected) => {
    const ce = engine();
    const e = ce.parse(latex);
    expect(json(e.evaluate({ materialization: true }))).toBe(expected);
    expect(json(await e.evaluateAsync({ materialization: true }))).toBe(
      expected
    );
  });

  test('a symbol whose value is a call is evaluated as the call', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'integer');
    ce.assign('L', ce.box(['List', 3, 1, 2]));
    ce.assign('m', ce.box(['Function', ['Add', 'P', 'T'], 'P']));
    // `q` holds the call `m(L)`, which is not a collection value.
    ce.assign('q', ce.box(['m', 'L']));
    const e = ce.box(['Dedup', 'q']);
    expect(e.latex).toBe('\\mathrm{Dedup}(q)');
    ce.assign('T', 1);
    expect(json(e.evaluate({ materialization: true }))).toBe('["List",4,2,3]');
  });

  test('the source is evaluated once', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        calls += 1;
        return ce.box(['List', 3, 1, 2]);
      },
    });
    const e = ce.box(['Scan', ['src', 1], 'Add']);
    expect(json(e.evaluate({ materialization: true }))).toBe('["List",3,4,6]');
    expect(calls).toBe(1);
    expect(json(ce.box(['ArgMax', ['src', 1]]).evaluate())).toBe('1');
    expect(calls).toBe(2);
  });
});

describe('AN ERROR VALUE OF THE SOURCE IS THE VALUE OF THE NODE', () => {
  function errorEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    // Both functions return a string, which their declared result refuses:
    // a call evaluates to an `incompatible-type` error.
    ce.declare('f', '(integer) -> integer');
    ce.assign('f', ce.box(['Function', "'hello'", 'x']));
    ce.declare('h', '(integer) -> list<integer>');
    ce.assign('h', ce.box(['Function', "'hello'", 'x']));
    return ce;
  }

  const ERROR = `["ErrorCode","'incompatible-type'","'list<integer>'","'string'"],"'hello'"`;

  test.each([
    [
      ['Map', ['Function', 'x', 'x'], ['h', 1]],
      `["Error",${ERROR},["ErrorTrace",["ErrorFrame","'Map'",2]]]`,
    ],
    [
      ['Dedup', ['h', 1]],
      `["Error",${ERROR},["ErrorTrace",["ErrorFrame","'Dedup'",1]]]`,
    ],
    [
      ['Reduce', ['h', 1], 'Add', 0],
      `["Error",${ERROR},["ErrorTrace",["ErrorFrame","'Reduce'",1]]]`,
    ],
    [
      ['Comprehension', 'x', ['Element', 'x', ['h', 1]]],
      `["Error",${ERROR},["ErrorTrace",["ErrorFrame","'Comprehension'",2]]]`,
    ],
    [
      ['Comprehension', 'x', ['Element', 'x', ['f', 1]]],
      `["Error",["ErrorCode","'incompatible-type'","'integer'","'string'"],"'hello'",["ErrorTrace",["ErrorFrame","'Comprehension'",2]]]`,
    ],
  ])('%j', async (input, expected) => {
    const ce = errorEngine();
    const e = ce.box(input as never);
    expect(json(e.evaluate())).toBe(expected);
    expect(json(await e.evaluateAsync())).toBe(expected);
  });
});

describe('A SOURCE WHOSE VALUE IS NOT A COLLECTION IS AN ERROR', () => {
  function scalarEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('u', 'tuple<any, any>');
    ce.assign('u', ce.box(['Tuple', 5, 6]));
    return ce;
  }

  test.each([
    [
      ['Map', ['Function', 'x', 'x'], ['At', 'u', 1]],
      `["Error",["ErrorCode","'incompatible-type'","'collection'","'5'"],5,["ErrorTrace",["ErrorFrame","'Map'",2]]]`,
    ],
    [
      ['ArgMax', ['At', 'u', 1]],
      `["Error",["ErrorCode","'incompatible-type'","'indexed_collection'","'5'"],5,["ErrorTrace",["ErrorFrame","'ArgMax'",1]]]`,
    ],
    [
      ['Comprehension', 'x', ['Element', 'x', ['At', 'u', 1]]],
      `["Error",["ErrorCode","'incompatible-type'","'collection'","'5'"],5,["ErrorTrace",["ErrorFrame","'Comprehension'",2]]]`,
    ],
  ])('%j', async (input, expected) => {
    const ce = scalarEngine();
    const e = ce.box(input as never);
    expect(json(e.evaluate())).toBe(expected);
    expect(json(await e.evaluateAsync())).toBe(expected);
  });

  test('a source that stays symbolic keeps the node symbolic', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer>');
    const e = ce.box(['Dedup', ['Sort', 'xs']]);
    expect(json(e.evaluate())).toBe('["Dedup",["Sort","xs"]]');
    expect(json(e.evaluate({ materialization: true }))).toBe(
      '["Dedup",["Sort","xs"]]'
    );
  });
});

describe('THE DISPLAY PREVIEW DOES NOT EVALUATE THE SOURCE OF A VIEW', () => {
  test.each([
    [['Reverse', SRC], '\\mathrm{Reverse}(t[1])'],
    [['Dedup', SRC], '\\mathrm{Dedup}(t[1])'],
    [['Scan', SRC, 'Add'], '\\mathrm{Scan}(t[1], \\mathrm{Add})'],
  ])('%j', (input, latex) => {
    const ce = engine();
    const e = ce.box(input as never);
    expect(e.toLatex()).toBe(latex);
    expect(e.latex).toBe(latex);
  });

  test('a view over a counted source prints with no evaluation', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        calls += 1;
        return ce.box(['List', 3, 1, 2]);
      },
    });
    const views = [
      ce.box(['Dedup', ['src', 1]]),
      ce.box(['Reverse', ['src', 1]]),
      // The facets of `Join` and its walk each evaluated an eager operand:
      // its preview called `src` three times.
      ce.box(['Join', ['src', 1], ['List', 4]]),
    ];
    for (const view of views) {
      view.toLatex();
      void view.latex;
      view.toString();
    }
    expect(calls).toBe(0);
    expect(views[2].toLatex()).toBe(
      '\\mathrm{Join}(\\mathrm{src}(1), \\bigl\\lbrack4\\bigr\\rbrack)'
    );
    // An explicit materialization evaluates the source, once per view.
    expect(json(views[1].evaluate({ materialization: true }))).toBe(
      '["List",2,1,3]'
    );
    expect(calls).toBe(1);
    expect(json(views[2].evaluate({ materialization: true }))).toBe(
      '["List",3,1,2,4]'
    );
    expect(calls).toBe(2);
    // The value of the view prints with no further evaluation.
    const value = views[2].evaluate();
    const afterEvaluate = calls;
    expect(value.toLatex()).toBe('\\bigl\\lbrack3, 1, 2, 4\\bigr\\rbrack');
    expect(calls).toBe(afterEvaluate);
  });
});

describe('A SOURCE REFUSED AT BOXING IS AN ERROR OPERAND', () => {
  // The canonical handler of a lazy collection operator refuses a source that
  // is provably not a collection. The call is then the operator over the
  // error, as `Sort(5)` is: invalid and typed `error`.
  function refusalEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> integer');
    ce.declare('p', '(integer) -> unknown');
    ce.assign('p', ce.box(['Function', 5, 'x']));
    ce.declare('n', 'integer');
    return ce;
  }

  const notCollection = (expected: string, actual: string, where: unknown) =>
    `["Error",["ErrorCode","'incompatible-type'","'${expected}'","'${actual}'"],${JSON.stringify(where)}]`;

  test.each([
    [
      ['Map', ['Function', 'x', 'x'], 5],
      `["Map",["Function",["Block","x"],"x"],${notCollection('collection', '5', 5)}]`,
    ],
    [['Dedup', 5], `["Dedup",${notCollection('collection', '5', 5)}]`],
    [
      ['ArgMax', 5],
      `["ArgMax",${notCollection('indexed_collection', '5', 5)}]`,
    ],
    [
      ['Filter', 5, ['Function', ['Greater', 'x', 0], 'x']],
      `["Filter",${notCollection('collection', '5', 5)},["Function",["Block",["Less",0,"x"]],"x"]]`,
    ],
    [
      ['Map', ['Function', 'x', 'x'], ['f', 1]],
      `["Map",["Function",["Block","x"],"x"],${notCollection('collection', 'integer', ['f', 1])}]`,
    ],
    [
      ['Map', ['Function', 'x', 'x'], ['p', 'n']],
      `["Map",["Function",["Block","x"],"x"],${notCollection('collection', 'integer', ['p', 'n'])}]`,
    ],
  ])('box route: %j', (input, expected) => {
    const ce = refusalEngine();
    const e = ce.box(input as never);
    expect(json(e)).toBe(expected);
    expect(e.isValid).toBe(false);
    expect(e.isCanonical).toBe(true);
    expect(e.type.toString()).toBe('error');
  });

  test.each([
    [
      '\\operatorname{Dedup}(5)',
      `["Dedup",${notCollection('collection', '5', 5)}]`,
    ],
    [
      '\\mathrm{Map}(x \\mapsto x, 5)',
      `["Map",["Function",["Block","x"],"x"],${notCollection('collection', '5', 5)}]`,
    ],
  ])('parse route: %s', (latex, expected) => {
    const e = refusalEngine().parse(latex);
    expect(json(e)).toBe(expected);
    expect(e.isValid).toBe(false);
  });

  test('an operator with a handler evaluates to the error', () => {
    const ce = refusalEngine();
    expect(json(ce.box(['ArgMax', 5]).evaluate())).toBe(
      `["Error",["ErrorCode","'incompatible-type'","'indexed_collection'","'5'"],5,["ErrorTrace",["ErrorFrame","'ArgMax'",1]]]`
    );
    expect(json(ce.box(['Reduce', 5, 'Add', 0]).evaluate())).toBe(
      `["Error",["ErrorCode","'incompatible-type'","'collection'","'5'"],5,["ErrorTrace",["ErrorFrame","'Reduce'",1]]]`
    );
  });

  test('a source that may be a collection is not refused', () => {
    const ce = refusalEngine();
    ce.declare('xs', 'list<integer>');
    for (const input of [
      ['Map', ['Function', 'x', 'x'], 'xs'],
      ['Map', ['Function', 'x', 'x'], 'Missing'],
      ['Dedup', ['List', 1, 2]],
    ])
      expect(ce.box(input as never).isValid).toBe(true);
  });
});

describe('A REFUSAL AT BOXING DOES NOT READ THE VALUE OF A SYMBOL', () => {
  // A canonical form must not depend on the value assigned to a symbol. The
  // type of a symbol declared `unknown` or `any` and assigned `5` is `integer`
  // (inferred from the value) or `any`. The call over the symbol is not
  // refused at boxing, so it reads the value that the symbol has when it is
  // evaluated.
  test.each([
    [
      'unknown',
      ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], 'n'],
      '["List",2,4,4]',
    ],
    ['unknown', ['Dedup', 'n'], '["List",1,2]'],
    [
      'any',
      ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], 'n'],
      '["List",2,4,4]',
    ],
    ['any', ['Dedup', 'n'], '["List",1,2]'],
  ])('n: %s, %j', async (type, input, expected) => {
    const ce = new ComputeEngine();
    ce.declare('n', type);
    ce.assign('n', 5);
    const e = ce.box(input as never);
    expect(e.isValid).toBe(true);
    ce.assign('n', ce.box(['List', 1, 2, 2]));
    expect(json(e.evaluate({ materialization: true }))).toBe(expected);
    expect(json(await e.evaluateAsync({ materialization: true }))).toBe(
      expected
    );
  });
});

describe('A REFUSAL AT BOXING DOES NOT READ AN INFERRED TYPE', () => {
  // One engine for both uses: `Apply(Add(_, 1), 2)` infers the type `number`
  // for the wildcard `_`. The later `Filter(_, IsEven)` is not refused for
  // that type: `_` is substituted by the list when `Apply` is evaluated.
  test('a wildcard source after a numeric use of the wildcard', () => {
    const ce = new ComputeEngine();
    expect(json(ce.box(['Apply', ['Add', '_', 1], 2]).evaluate())).toBe('3');
    const e = ce.box([
      'ListFrom',
      ['Apply', ['Filter', '_', 'IsEven'], ['List', 1, 2, 3, 4]],
    ]);
    expect(e.isValid).toBe(true);
    expect(json(e.evaluate())).toBe('["List",2,4]');
  });
});

describe('AN ELEMENT READ OF AN UNDECLARED LIST OF LISTS', () => {
  // With no declaration, the type of `At(t, 1)` is
  // `missing | vector<integer^1> | vector<integer^3>`: the read can be out of
  // range. Every present value of that type is a collection, so the read is a
  // source of the lazy operator.
  function undeclaredEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('t', ce.box(['List', ['List', 3, 1, 2], ['List', 4]]));
    return ce;
  }

  test.each([
    [['Numerator', SRC], '["List",3,1,2]'],
    [['Map', ['Function', ['Multiply', 2, 'x'], 'x'], SRC], '["List",6,2,4]'],
    [['Reverse', SRC], '["List",2,1,3]'],
    [['Join', SRC, ['List', 4]], '["List",3,1,2,4]'],
    [['Scan', SRC, 'Add'], '["List",3,4,6]'],
  ])('evaluate: %j', async (input, expected) => {
    const ce = undeclaredEngine();
    const e = ce.box(input as never);
    expect(json(e.evaluate({ materialization: true }))).toBe(expected);
    expect(json(await e.evaluateAsync({ materialization: true }))).toBe(
      expected
    );
  });

  test.each([
    [
      ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], SRC],
      'Map((x) => 2x, At(t, 1))',
    ],
    [['Reverse', SRC], 'Reverse(At(t, 1))'],
    [['Join', SRC, ['List', 4]], 'Join(At(t, 1), [4])'],
    [['Dedup', SRC], 'Dedup(At(t, 1))'],
  ])(
    'the display preview prints the view as written: %j',
    (input, expected) => {
      const e = undeclaredEngine().box(input as never);
      expect(e.toString()).toBe(expected);
    }
  );
});

describe('THE ASYNCHRONOUS ROUTE INSIDE A SUM', () => {
  // The source reads the index of the enclosing `Sum`. On the asynchronous
  // route, the work after an `await` runs in the context of the evaluation,
  // so it gives the same value as the synchronous route.
  test.each([
    [['ArgMax', ['At', 't', 'k']], '3'],
    [['Length', ['Dedup', ['At', 't', 'k']]], '6'],
    [['Reduce', ['At', 't', 'k'], 'Add', 'k'], '23'],
  ])('%j', async (body, expected) => {
    const ce = new ComputeEngine();
    ce.assign('t', ce.box(['List', ['List', 3, 1, 2], ['List', 4, 9, 1]]));
    const e = ce.box(['Sum', body, ['Element', 'k', ['Range', 1, 2]]] as never);
    expect(json(e.evaluate())).toBe(expected);
    expect(json(await e.evaluateAsync())).toBe(expected);
  });
});

describe('A SLICE IN A FUNCTION BODY READS THE CURRENT ARGUMENT', () => {
  // The bounds of a `Slice` are memoized on the node. The node in the body of
  // a function is the same node for every call, so the memo must be
  // invalidated when a parameter takes a new value.
  test('Characters of a Slice over the parameter, mapped', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Map',
      [
        'Function',
        ['Characters', ['Slice', "'49142'", 'i', ['Add', 'i', 2]]],
        'i',
      ],
      ['Range', 1, 3],
    ]);
    expect(e.evaluate({ materialization: true }).toString()).toBe(
      '[["4","9","1"],["9","1","4"],["1","4","2"]]'
    );
  });
});
