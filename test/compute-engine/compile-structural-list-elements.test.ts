import { ComputeEngine, compile } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

/**
 * Element comparison over a collection whose elements are lists
 * (`Contains`, `Unique`, `Element` and the sequence-search family). Lists
 * compile to JS arrays, so a bare `includes`/`Set` would compare them by
 * reference; the JavaScript target lowers them through `_SYS.eqs` /
 * `_SYS.uniqs` instead, and the result must agree with `evaluate()`.
 */
const js = (e: unknown, ce: ComputeEngine) =>
  compile(ce.box(e as never), { to: 'javascript', fallback: false });

const lit = (v: unknown): unknown =>
  Array.isArray(v) ? ['List', ...v.map(lit)] : v;

function setup() {
  const ce = new ComputeEngine();
  ce.declare('xss', 'list<list<integer>>');
  ce.declare('ys', 'list<integer>');
  ce.declare('zss', 'list<list<integer>>');
  return ce;
}

const XSS = [[1, 2], [3], [1, 2], []];

describe('Contains / Element over lists of lists', () => {
  const ce = setup();
  const cases: [string, number[]][] = [
    ['found', [1, 2]],
    ['found singleton', [3]],
    ['found empty', []],
    ['not found', [2, 1]],
    ['not found, prefix', [1]],
  ];
  test.each(cases)('%s', (_n, ys) => {
    const expected = ce
      .box(['Contains', lit(XSS), lit(ys)] as never)
      .evaluate().json;
    const r = js(['Contains', 'xss', 'ys'], ce);
    expect(r.success).toBe(true);
    expect(r.run!({ xss: XSS, ys } as never)).toBe(expected === 'True');
    const e = js(['Element', 'ys', 'xss'], ce);
    expect(e.success).toBe(true);
    expect(e.run!({ xss: XSS, ys } as never)).toBe(expected === 'True');
  });

  test('empty collection of lists', () => {
    const r = js(['Contains', 'xss', 'ys'], ce);
    expect(r.run!({ xss: [], ys: [] } as never)).toBe(false);
    expect(
      ce.box(['Contains', ['List'], ['List']] as never).evaluate().json
    ).toBe('False');
  });

  test('a row supplied as a typed array compares by value', () => {
    // The input check refuses a typed array for a top-level list input, but
    // not for a row inside a list, so the element test must accept one.
    const r = js(['Contains', 'xss', 'ys'], ce);
    const rows = [new Float64Array([1, 2]), new Float64Array([3])];
    expect(r.run!({ xss: rows, ys: [1, 2] } as never)).toBe(true);
    expect(r.run!({ xss: rows, ys: [2, 1] } as never)).toBe(false);
    const u = js(['Unique', 'xss'], ce);
    const out = u.run!({ xss: [...rows, [1, 2]] } as never) as unknown[];
    expect(out.map((x) => Array.from(x as number[]))).toEqual([[1, 2], [3]]);
  });

  test('deeper nesting and string leaves', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'list<list<list<string>>>');
    ce2.declare('b', 'list<list<string>>');
    const r = js(['Contains', 'a', 'b'], ce2);
    expect(r.success).toBe(true);
    // Decomposed "e" + U+0301 finds the precomposed "é", as in the interpreter.
    expect(r.run!({ a: [[['é']]], b: [['é']] } as never)).toBe(true);
    expect(r.run!({ a: [[['é']]], b: [['x']] } as never)).toBe(false);
    expect(
      ce2.box(['Contains', lit([[['é']]]), lit([['é']])] as never).evaluate()
        .json
    ).toBe('True');
  });
});

describe('Unique over lists of lists', () => {
  const ce = setup();
  test.each([
    ['duplicates', [[1, 2], [3], [1, 2], [3], []]],
    ['all distinct', [[1], [2], [1, 2], [2, 1]]],
    ['empty inner lists', [[], [], [0]]],
    ['empty collection', []],
  ])('%s', (_n, xss) => {
    const r = js(['Unique', 'xss'], ce);
    expect(r.success).toBe(true);
    const expected = ce
      .box(['Unique', lit(xss)] as never)
      .evaluate()
      .toString();
    const out = r.run!({ xss } as never) as unknown[];
    expect(
      ce
        .box(lit(out) as never)
        .evaluate()
        .toString()
    ).toBe(expected);
  });
});

describe('sequence search over lists of lists', () => {
  const ce = setup();
  const subject = [[1], [2, 3], [4], [2, 3]];
  const needle = [[2, 3], [4]];
  const ev = (op: string, s: unknown, n: unknown) =>
    ce.box([op, lit(s), lit(n)] as never).evaluate();

  test.each(['ContainsSequence', 'StartsWith', 'EndsWith'])('%s', (op) => {
    const r = js([op, 'xss', 'zss'], ce);
    expect(r.success).toBe(true);
    for (const [s, n] of [
      [subject, needle],
      [subject, [[1], [2, 3]]],
      [subject, [[2, 3], [4], [2, 3]]],
      [subject, [[9]]],
      [subject, []],
      [[], [[1]]],
    ]) {
      expect(r.run!({ xss: s, zss: n } as never)).toBe(
        ev(op, s, n).json === 'True'
      );
    }
  });

  test('RangeOf', () => {
    const r = js(['RangeOf', 'xss', 'zss'], ce);
    expect(r.success).toBe(true);
    const got = r.run!({ xss: subject, zss: needle } as never);
    expect(got).toEqual([2, 3]);
    expect(ev('RangeOf', subject, needle).toString()).toBe('[2,3]');
    expect(r.run!({ xss: subject, zss: [[9]] } as never)).toBeUndefined();
    expect(ev('RangeOf', subject, [[9]]).json).toBe('Nothing');
  });
});

describe('element types that still fail closed', () => {
  test.each([
    ['list<tuple<integer, integer>>', 'Contains'],
    ['list<list<complex>>', 'Unique'],
    ['list<list<integer | missing>>', 'Unique'],
    ['list<list<any>>', 'Unique'],
  ])('%s under %s', (type, op) => {
    const ce = new ComputeEngine();
    ce.declare('xss', type);
    ce.declare('y', 'any');
    const e = op === 'Unique' ? ['Unique', 'xss'] : [op, 'xss', 'y'];
    expect(() => js(e, ce)).toThrow(/Could not compile/);
  });
});

describe('a searched value that may be a tuple fails closed', () => {
  // A tuple also lowers to a JS array, but the interpreter keeps
  // `Tuple(1, 2)` apart from `List(1, 2)`.
  test('the interpreter keeps a tuple apart from a list', () => {
    expect(
      setup()
        .box(['Contains', lit([[1, 2]]), ['Tuple', 1, 2]] as never)
        .evaluate().json
    ).toBe('False');
  });

  test.each([
    ['Contains, tuple symbol', ['Contains', 'xss', 't']],
    ['Contains, tuple literal', ['Contains', 'xss', ['Tuple', 1, 2]]],
    ['Element, tuple symbol', ['Element', 't', 'xss']],
    ['Contains, any', ['Contains', 'xss', 'a']],
  ])('%s', (_n, expr) => {
    const ce = setup();
    ce.declare('t', 'tuple<integer, integer>');
    ce.declare('a', 'any');
    expect(() => js(expr, ce)).toThrow(/Could not compile/);
  });

  test('a written Missing searched value compiles and is never found', () => {
    const ce = setup();
    for (const expr of [
      ['Contains', 'xss', 'Missing'],
      ['Element', 'Missing', 'xss'],
    ]) {
      const r = js(expr, ce);
      expect(r.run!({ xss: [[1], []] } as never)).toBe(false);
    }
    expect(
      ce.box(['Contains', lit([[1], []]), 'Missing'] as never).evaluate().json
    ).toBe('False');
  });

  test('a primitive searched value compiles and is never found', () => {
    const ce = setup();
    ce.declare('n', 'integer');
    const r = js(['Contains', 'xss', 'n'], ce);
    expect(r.run!({ xss: [[1], [2]], n: 1 } as never)).toBe(false);
  });
});

test('a function parameter named _v is not captured', () => {
  const ce = setup();
  const f = js(
    [
      'Function',
      ['Contains', '_v', 'w'],
      ['Typed', '_v', 'list<list<integer>>'],
      ['Typed', 'w', 'list<integer>'],
    ],
    ce
  );
  expect(f.success).toBe(true);
  const run = f.run as unknown as (a: unknown, b: unknown) => boolean;
  expect(run([[1, 2]], [1, 2])).toBe(true);
  expect(run([[1, 2]], [2, 1])).toBe(false);
});

test('a function parameter named _v is not captured by the text search', () => {
  const ce = setup();
  for (const [expr, args, expected] of [
    [['Contains', '_v', 'w'], [['a', 'b'], 'b'], true],
    [['IndexOf', '_v', 'w'], [['a', 'b'], 'b'], 2],
  ] as const) {
    const f = js(
      [
        'Function',
        expr,
        ['Typed', '_v', 'list<string>'],
        ['Typed', 'w', 'string'],
      ],
      ce
    );
    expect(f.success).toBe(true);
    const run = f.run as unknown as (a: unknown, b: unknown) => unknown;
    expect(run(...(args as unknown as [unknown, unknown]))).toBe(expected);
  }
});

test('the Python target still refuses list-of-lists elements', () => {
  const ce = setup();
  for (const expr of [
    ['Contains', 'xss', 'ys'],
    ['Unique', 'xss'],
  ])
    expect(() =>
      compile(ce.box(expr as never), { to: 'python', fallback: false })
    ).toThrow(/Could not compile/);
});

describe('a Range that the interpreter keeps apart from a list fails closed', () => {
  // The compiled code lowers every `Range` to an array, but the interpreter
  // makes a `Range` element the same as a list only when it is a finite range
  // of integers with literal bounds.
  test('the interpreter keeps Range(0.5, 1.5) apart from [0.5, 1.5]', () => {
    const ce = setup();
    expect(
      ce
        .box([
          'Contains',
          ['List', ['Range', 0.5, 1.5]],
          lit([0.5, 1.5]),
        ] as never)
        .evaluate().json
    ).toBe('False');
  });

  test('a Range literal in the expression', () => {
    const ce = setup();
    ce.declare('rs', 'list<real>');
    expect(() =>
      js(['Contains', ['List', ['Range', 0.5, 1.5]], 'rs'], ce)
    ).toThrow(/Range/);
    expect(() =>
      js(['Unique', ['List', ['Range', 0.5, 1.5], 'rs']], ce)
    ).toThrow(/Range/);
  });

  test('a Range in the value of a symbol', () => {
    const ce = setup();
    ce.declare('rs', 'list<real>');
    ce.declare('w', 'list<list<real>>');
    ce.assign('w', ce.box(['List', ['Range', 0.5, 1.5]]));
    expect(() => js(['Contains', 'w', 'rs'], ce)).toThrow(/Range/);
  });

  test('a Range in the body of a called function', () => {
    const ce = setup();
    ce.declare('rs', 'list<real>');
    ce.assign(
      'g',
      ce.box(['Function', ['List', ['Range', 'k', ['Add', 'k', 1]]], 'k'])
    );
    expect(() => js(['Contains', ['g', 0.5], 'rs'], ce)).toThrow(/Range/);
  });

  test('an integer Range with literal bounds elsewhere still compiles', () => {
    const ce = setup();
    const r = js(
      ['And', ['Contains', 'xss', 'ys'], ['Contains', ['Range', 1, 3], 2]],
      ce
    );
    expect(r.run!({ xss: [[1, 2]], ys: [1, 2] } as never)).toBe(true);
  });
});

describe('a lazy collection anywhere in the program fails closed', () => {
  // The interpreter does not list the lazy result of a callback: each
  // element of the outer `Map` below stays a `Map`, which `.isSame()` keeps
  // apart from a list of the same values.
  const inner = ['Map', ['Function', ['Add', 'j', 'k'], 'j'], 'ys'];
  const outer = ['Map', ['Function', inner, 'k'], 'ys'];

  test('the interpreter keeps the inner Map apart from a list', () => {
    const ce = setup();
    ce.assign('ys', ce.box(['List', 1, 2]));
    expect(
      ce.box(['Contains', outer, ['List', 2, 3]] as never).evaluate().json
    ).toBe('False');
  });

  test.each([
    ['Contains', ['Contains', outer, 'zs']],
    ['Unique', ['Unique', outer]],
    ['ContainsSequence', ['ContainsSequence', outer, 'xss']],
    [
      'Filter',
      [
        'Contains',
        [
          'Map',
          [
            'Function',
            ['Filter', 'ys', ['Function', ['Greater', 'j', 'k'], 'j']],
            'k',
          ],
          'ys',
        ],
        'zs',
      ],
    ],
  ])('%s', (_n, expr) => {
    const ce = setup();
    ce.declare('zs', 'list<integer>');
    expect(() => js(expr, ce)).toThrow(/lazy collection/);
  });

  test('a lazy element that a callback passes on unchanged', () => {
    // `Map(e ↦ e, L)` hands each element of the literal `L` to the callback
    // as it is, so the inner `Map` is never listed.
    const ce = setup();
    const lazy = ['Map', ['Function', ['Add', 'j', 1], 'j'], 'ys'];
    const passed = ['Map', ['Function', 'e', 'e'], ['List', lazy, ['List', 9]]];
    ce.assign('ys', ce.box(['List', 1, 2]));
    expect(
      ce.box(['Contains', passed, ['List', 2, 3]] as never).evaluate().json
    ).toBe('False');
    const ce2 = setup();
    expect(() => js(['Contains', passed, ['List', 2, 3]], ce2)).toThrow(
      /lazy collection/
    );
    expect(() =>
      js(
        [
          'Contains',
          ['Filter', ['List', lazy, ['List', 9]], ['Function', 'True', 'e']],
          ['List', 2, 3],
        ],
        ce2
      )
    ).toThrow(/lazy collection/);
  });

  test('any Map in the program fails closed (user decision 2026-10-30)', () => {
    // Even where the elements are list literals and the answer would agree.
    const ce = setup();
    expect(() =>
      js(
        [
          'Contains',
          ['Map', ['Function', ['List', 'k', ['Add', 'k', 1]], 'k'], 'ys'],
          ['List', 2, 3],
        ],
        ce
      )
    ).toThrow(/lazy collection/);
    expect(() =>
      js(['Map', ['Function', ['Contains', 'xss', 'k'], 'k'], 'xss'], ce)
    ).toThrow(/lazy collection/);
  });
});

test('a symbol that holds a large list does not stop the scan', () => {
  const ce = setup();
  ce.declare('big', 'list<integer>');
  ce.assign(
    'big',
    ce.box(['List', ...Array.from({ length: 250_000 }, (_, i) => i)])
  );
  const r = js(
    ['And', ['Contains', 'xss', 'ys'], ['Greater', ['At', 'big', 1], -1]],
    ce
  );
  expect(r.run!({ xss: [[1]], ys: [1] } as never)).toBe(true);
});

test('a lambda parameter is not read as the global of the same name', () => {
  const ce = setup();
  ce.declare('k', 'list<list<real>>');
  ce.assign('k', ce.box(['List', ['Range', 0.5, 1.5]]));
  const r = js(
    [
      'Function',
      ['Contains', 'xss', 'k'],
      ['Typed', 'k', 'list<integer>'],
      ['Typed', 'xss', 'list<list<integer>>'],
    ],
    ce
  );
  expect(r.success).toBe(true);
  const run = r.run as unknown as (k: unknown, xss: unknown) => boolean;
  expect(run([2], [[1], [2]])).toBe(true);
});

describe('review of f2c053f1e', () => {
  test('a Range in a dictionary value fails closed', () => {
    const ce = setup();
    ce.declare('rs', 'list<real>');
    const dict = [
      'Dictionary',
      ['Tuple', { str: 'a' }, ['Range', 0.5, 1.5]],
      ['Tuple', { str: 'b' }, ['List', 2, 3]],
    ];
    const expr = ['Contains', ['List', ['At', dict, { str: 'a' }]], 'rs'];
    expect(
      ce
        .box([
          'Contains',
          ['List', ['At', dict, { str: 'a' }]],
          ['List', 0.5, 1.5],
        ] as never)
        .evaluate().json
    ).toBe('False');
    expect(() => js(expr, ce)).toThrow(/Range/);
    ce.assign('d', ce.box(dict as never));
    expect(() =>
      js(['Contains', ['List', ['At', 'd', { str: 'a' }]], 'rs'], ce)
    ).toThrow(/Range/);
  });

  test('a recursive list alias fails closed instead of overflowing', () => {
    const ce = new ComputeEngine();
    ce.declareType('R', 'list<R>', { alias: true });
    ce.declare('rr', 'list<R>');
    // A stack overflow would be a `RangeError`, which this message excludes.
    expect(() => js(['Unique', 'rr'], ce)).toThrow(
      /only real\/boolean\/string elements, and lists of them/
    );
  });

  test('a reused target sees a later assignment', () => {
    const ce = setup();
    ce.declare('rs', 'list<real>');
    ce.declare('w', 'list<list<real>>');
    ce.assign('w', ce.box(['List', ['List', 0.5, 1.5]]));
    const expr = ce.box(['Contains', 'w', 'rs']);
    const target = new JavaScriptTarget().createTarget({
      var: (id) => `_.${id}`,
      rootExpression: expr,
    });
    BaseCompiler.compileRoot(expr, target);
    ce.assign('w', ce.box(['List', ['Range', 0.5, 1.5]]));
    expect(() => BaseCompiler.compileRoot(expr, target)).toThrow(/Range/);
  });

  test('a scope push or pop is seen by the next compilation', () => {
    const R = ['List', ['Range', 0.5, 1.5]];
    const S = ['List', ['List', 0.5, 1.5]];
    const type = 'list<list<real>>';
    // A value declared in a pushed scope, then the scope popped.
    {
      const ce = setup();
      ce.declare('rs', 'list<real>');
      ce.declare('w', type);
      ce.assign('w', ce.box(R as never));
      ce.pushScope();
      ce.declare('w', { type, value: ce.box(S as never) });
      const expr = ce.box(['Contains', 'w', 'rs']);
      expect(compile(expr, { to: 'javascript', fallback: false }).success).toBe(
        true
      );
      ce.popScope();
      expect(() =>
        compile(expr, { to: 'javascript', fallback: false })
      ).toThrow(/Range/);
    }
    // A Range declared in a pushed scope.
    {
      const ce = setup();
      ce.declare('rs', 'list<real>');
      ce.declare('w', type);
      ce.assign('w', ce.box(S as never));
      const expr = ce.box(['Contains', 'w', 'rs']);
      expect(compile(expr, { to: 'javascript', fallback: false }).success).toBe(
        true
      );
      ce.pushScope();
      ce.declare('w', { type, value: ce.box(R as never) });
      expect(() =>
        compile(expr, { to: 'javascript', fallback: false })
      ).toThrow(/Range/);
      ce.popScope();
    }
  });

  test('a target without the root expression says so', () => {
    const ce = setup();
    const target = new JavaScriptTarget().createTarget({
      var: (id) => `_.${id}`,
    });
    expect(() =>
      BaseCompiler.compileRoot(ce.box(['Unique', 'xss']), target)
    ).toThrow(/does not give the whole compiled expression/);
  });
});

test('list Equal still compiles through _SYS.eq', () => {
  const ce = setup();
  expect(js(['Equal', 'ys', ['List', 1, 2]], ce).code).toContain('_SYS.eq(');
});
