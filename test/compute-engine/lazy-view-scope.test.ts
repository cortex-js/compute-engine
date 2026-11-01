// A lazy callback view calls its callback in the context where the view was
// created (ROADMAP CE-728, option (a)).
//
// With `f := (x, k = d) => x * k` and `g := (d, xs) => Map(f, xs)`, the
// interpreter's `g(10, [1, 2])` is the lazy view `Map(f, [1, 2])`. Its
// elements are computed when the view is read, after `g` has returned. The
// call `f(x)` that the view makes is filled with the default `d`, and `d` is
// read where the call takes place. Before, that was the context of the
// reader, where `d` has no value, and the elements were `d` and `2d`. Now the
// evaluation that creates the view inside `g` records the context of the
// call of `g`, and each read of the view runs in it: the elements are
// `[10, 20]`, as in the compiled function and as when the view is read
// inside `g` (`ListFrom(Map(f, xs))`).
//
// A view created outside every function call records nothing and is read in
// the context of its reader, as before.
//
// Mechanism: `src/compute-engine/boxed-expression/lazy-view-context.ts`.
// Spec: docs/plans/2026-10-31-parameter-default-values.md, §11 item 6.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

type Json = any;

/** `(x, k = d) => x * k`. */
const F: Json = ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 'd']];

function engine(definitions: [string, Json][]): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, value] of definitions) ce.assign(name, ce.box(value));
  return ce;
}

/** The elements of the evaluated `expr`, materialized after the evaluation
 * has returned. */
function listed(ce: ComputeEngine, expr: Json): Json {
  const value = ce.box(expr).evaluate();
  return ce.function('ListFrom', [value]).evaluate().json;
}

describe('LAZY VIEW CREATION CONTEXT', () => {
  test('the ROADMAP case: a view returned by a call reads its symbol default there', () => {
    const g: Json = ['Function', ['Map', 'f', 'xs'], 'd', 'xs'];
    const ce = engine([
      ['f', F],
      ['g', g],
    ]);
    const view = ce.box(['g', 10, ['List', 1, 2]]).evaluate();
    expect(view.operator).toBe('Map');
    expect(ce.function('ListFrom', [view]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    // The same value as a read inside `g`.
    ce.assign(
      'gIn',
      ce.box(['Function', ['ListFrom', ['Map', 'f', 'xs']], 'd', 'xs'])
    );
    expect(ce.box(['gIn', 10, ['List', 1, 2]]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    // The same value as the compiled function.
    const compiled: any = compile(
      ce.box([
        'Function',
        ['ListFrom', ['Map', 'f', 'xs']],
        'd',
        ['Typed', 'xs', "'list<real>'"],
      ]) as any,
      { to: 'javascript', fallback: false } as any
    );
    expect(compiled.success).toBe(true);
    expect(Array.from(compiled.run(10, [1, 2]))).toEqual([10, 20]);
  });

  test('the ROADMAP case in Epsil', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'let f = (x, k = d) => x * k; let g = (d, xs) => map(f, xs); g(10, [1, 2])'
    );
    expect(r.diagnostics).toEqual([]);
    expect(ce.function('ListFrom', [r.value!]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
  });

  test('a read by index and a read by iteration', () => {
    const ce = engine([
      ['f', F],
      ['g', ['Function', ['Map', 'f', 'xs'], 'd', 'xs']],
    ]);
    const view = ce.box(['g', 10, ['List', 1, 2, 3]]).evaluate();
    expect(view.at(1)?.json).toBe(10);
    expect(view.at(3)?.json).toBe(30);
    expect(view.at(-1)?.json).toBe(30);
    expect([...view.each()].map((x) => x.json)).toEqual([10, 20, 30]);
    expect(view.count).toBe(3);
  });

  test('two views made by two calls with different values live at once', () => {
    const ce = engine([
      ['f', F],
      ['g', ['Function', ['Map', 'f', 'xs'], 'd', 'xs']],
    ]);
    const a = ce.box(['g', 10, ['List', 1, 2]]).evaluate();
    const b = ce.box(['g', 20, ['List', 1, 2]]).evaluate();
    const read = (v: any) => ce.function('ListFrom', [v]).evaluate().json;
    expect(read(a)).toEqual(['List', 10, 20]);
    expect(read(b)).toEqual(['List', 20, 40]);
    expect(read(a)).toEqual(['List', 10, 20]);
  });

  test('a view whose source is a literal list in the body', () => {
    // The canonical `Map(f, [1, 2])` of the body is shared by all the calls;
    // each call records its own view.
    const ce = engine([
      ['f', F],
      ['g', ['Function', ['Map', 'f', ['List', 1, 2]], 'd']],
    ]);
    const a = ce.box(['g', 3]).evaluate();
    const b = ce.box(['g', 4]).evaluate();
    const read = (v: any) => ce.function('ListFrom', [v]).evaluate().json;
    expect(read(a)).toEqual(['List', 3, 6]);
    expect(read(b)).toEqual(['List', 4, 8]);
  });

  test('a view made by a nested call and returned through an outer call', () => {
    const ce = engine([
      ['f', F],
      ['g', ['Function', ['Map', 'f', 'xs'], 'd', 'xs']],
      ['h', ['Function', ['g', ['Add', 'd', 1], 'xs'], 'd', 'xs']],
    ]);
    // The view reads the `d` of `g`, which `h` called with `d + 1`.
    expect(listed(ce, ['h', 10, ['List', 1, 2]])).toEqual(['List', 11, 22]);
  });

  test('a view made in a closure that a call returns', () => {
    const ce = engine([
      ['f', F],
      ['outer', ['Function', ['Function', ['Map', 'f', 'xs'], 'xs'], 'd']],
    ]);
    expect(listed(ce, [['outer', 7], ['List', 1, 2]])).toEqual([
      'List',
      7,
      14,
    ]);
  });

  test('a view made in a block of the body reads the block local', () => {
    const block = (inner: Json): Json => [
      'Function',
      ['Block', ['Declare', 'd', "'number'"], ['Assign', 'd', 'd0'], inner],
      'd0',
      'xs',
    ];
    const ce = engine([
      ['f', F],
      ['gIn', block(['ListFrom', ['Map', 'f', 'xs']])],
      ['gOut', block(['Map', 'f', 'xs'])],
    ]);
    expect(ce.box(['gIn', 10, ['List', 1, 2]]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    expect(listed(ce, ['gOut', 10, ['List', 1, 2]])).toEqual(['List', 10, 20]);
  });

  test('a view nested in a view made with a literal callback', () => {
    // The end of the call rebuilds the result to re-root the closure; the
    // rebuilt views keep their record.
    const ce = engine([
      ['f', F],
      [
        'g',
        [
          'Function',
          ['Map', 'f', ['Map', ['Function', ['Add', 'y', 'd'], 'y'], 'xs']],
          'd',
          'xs',
        ],
      ],
    ]);
    expect(listed(ce, ['g', 10, ['List', 1, 2]])).toEqual(['List', 110, 120]);
  });

  test('a view made at the top level reads the context of its reader, as before', () => {
    const ce = engine([
      ['f', F],
      ['readIn', ['Function', ['ListFrom', 'v'], 'd', 'v']],
      ['pass', ['Function', 'v', 'd', 'v']],
    ]);
    const top = ['Map', 'f', ['List', 1, 2]];
    expect(listed(ce, top)).toEqual([
      'List',
      'd',
      ['Multiply', 2, 'd'],
    ]);
    // Read inside a call, the view reads the `d` of that call.
    expect(ce.box(['readIn', 10, top]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    // Passed through a call and read outside it, the view reads `d` at the
    // top level.
    expect(listed(ce, ['pass', 10, top])).toEqual([
      'List',
      'd',
      ['Multiply', 2, 'd'],
    ]);
  });

  test('the ROADMAP case with the debug check of dead bindings', () => {
    // The frame of `g` stays alive while the view holds it: its pop does
    // not dispose or tombstone its definitions, so a read after the call
    // does not throw when the debug check is on.
    const ce = engine([
      ['f', F],
      ['g', ['Function', ['Map', 'f', 'xs'], 'd', 'xs']],
      ['h', ['Function', ['g', ['Add', 'd', 1], 'xs'], 'd', 'xs']],
    ]);
    ce._debugBindings = true;
    expect(listed(ce, ['g', 10, ['List', 1, 2]])).toEqual(['List', 10, 20]);
    // Returned through an outer call: the frame of `h` stays alive too.
    expect(listed(ce, ['h', 10, ['List', 1, 2]])).toEqual(['List', 11, 22]);
  });

  test('a view made in a nested block of an If branch', () => {
    // The parent links of the branch and block scopes reach the frame only
    // while the call runs, and the pop of the block disposes `d`: a read
    // after the call uses copies of these scopes made from the bindings and
    // values recorded when the view was made.
    const body = (inner: Json): Json => [
      'Function',
      [
        'If',
        ['Greater', 'n', 0],
        [
          'Block',
          [
            'Block',
            ['Declare', 'd', "'number'"],
            ['Assign', 'd', ['Multiply', 'd0', 2]],
            inner,
          ],
        ],
        0,
      ],
      'd0',
      'n',
    ];
    const ce = engine([
      ['f', F],
      ['gIn', body(['ListFrom', ['Map', 'f', ['List', 1, 2]]])],
      ['gOut', body(['Map', 'f', ['List', 1, 2]])],
    ]);
    ce._debugBindings = true;
    expect(ce.box(['gIn', 10, 1]).evaluate().json).toEqual(['List', 20, 40]);
    expect(listed(ce, ['gOut', 10, 1])).toEqual(['List', 20, 40]);
  });

  test('a view rebuilt by the substitution of the parameter values', () => {
    // The `If` is held, and still reads `n` when the body ends: the end of
    // the call substitutes the value of `n` into it, which rebuilds the
    // view. The rebuilt view keeps the record.
    const body: Json = [
      'Map',
      'f',
      ['List', 1, ['If', ['Greater', 'u', 0], 'n', 'n']],
    ];
    const ce = engine([
      ['f', F],
      ['gIn', ['Function', ['ListFrom', body], 'd', 'n']],
      ['gOut', ['Function', body, 'd', 'n']],
    ]);
    const inside = ce.box(['gIn', 10, 2]).evaluate().json;
    expect(inside[1]).toBe(10);
    expect(listed(ce, ['gOut', 10, 2])).toEqual(inside);
  });

  test('a view in a dictionary value', () => {
    const ce = engine([
      ['f', F],
      [
        'g',
        [
          'Function',
          [
            'Dictionary',
            [
              'KeyValuePair',
              "'v'",
              ['Map', 'f', ['Map', ['Function', ['Add', 'y', 'd'], 'y'], 'xs']],
            ],
          ],
          'd',
          'xs',
        ],
      ],
    ]);
    const dict: any = ce.box(['g', 10, ['List', 1, 2]]).evaluate();
    expect(
      ce.function('ListFrom', [dict.get('v')]).evaluate().json
    ).toEqual(['List', 110, 120]);
  });

  test('a view held by another lazy operator', () => {
    // The `Map` is never evaluated: `Dedup`, `Take` and `Zip` hold it. The
    // end of the call gives it a record on a new node, since the held node
    // is shared by every call of the function.
    const ce = engine([['f', F]]);
    ce._debugBindings = true;
    const xs: Json = ['List', 5, 15, 20];
    const cases: [string, Json, Json, Json][] = [
      [
        'Dedup',
        ['Dedup', ['Map', 'f', 'xs']],
        ['List', 50, 150, 200],
        ['List', 100, 300, 400],
      ],
      [
        'Take',
        ['Take', ['Map', 'f', 'xs'], 2],
        ['List', 50, 150],
        ['List', 100, 300],
      ],
      [
        'Zip',
        ['Zip', ['Map', 'f', 'xs'], 'xs'],
        [
          'List',
          ['Tuple', 50, 5],
          ['Tuple', 150, 15],
          ['Tuple', 200, 20],
        ],
        [
          'List',
          ['Tuple', 100, 5],
          ['Tuple', 300, 15],
          ['Tuple', 400, 20],
        ],
      ],
    ];
    for (const [name, body, at10, at20] of cases) {
      ce.assign(`out${name}`, ce.box(['Function', body, 'd', 'xs']));
      ce.assign(`in${name}`, ce.box(['Function', ['ListFrom', body], 'd', 'xs']));
      expect(ce.box([`in${name}`, 10, xs]).evaluate().json).toEqual(at10);
      const a = ce.box([`out${name}`, 10, xs]).evaluate();
      const b = ce.box([`out${name}`, 20, xs]).evaluate();
      const read = (v: any) => ce.function('ListFrom', [v]).evaluate().json;
      expect(read(a)).toEqual(at10);
      expect(read(b)).toEqual(at20);
    }
  });

  test('a view in a binding that a returned closure reads', () => {
    // The record of the view is made while `cl` runs, and the closure reads
    // `v` after `cl` has returned.
    const ce = engine([
      ['f', F],
      [
        'cl',
        [
          'Function',
          [
            'Block',
            ['Assign', 'v', ['Map', 'f', ['List', 1, 2]]],
            ['Function', ['ListFrom', 'v'], 'y'],
          ],
          'd',
        ],
      ],
    ]);
    ce._debugBindings = true;
    expect(ce.box([['cl', 10], 0]).evaluate().json).toEqual(['List', 10, 20]);
  });

  test('views made in the iterations of a loop', () => {
    const loop = (body: Json, result: Json): Json => [
      'Function',
      [
        'Block',
        ['Declare', 'acc', "'number'"],
        ['Assign', 'acc', 0],
        ['Declare', 'v', "'any'"],
        ['Loop', body, ['Element', 'd', ['Range', 1, 3]]],
        result,
      ],
      'd0',
    ];
    const ce = engine([
      ['f', F],
      // Each iteration reads its view at once: `d` is the loop index.
      [
        'inLoop',
        loop(
          [
            'Assign',
            'acc',
            ['Add', 'acc', ['At', ['ListFrom', ['Map', 'f', ['List', 'd0']]], 1]],
          ],
          'acc'
        ),
      ],
      // The value of the second iteration leaves the call. `Assign` stores
      // the elements of a lazy view, not the view, so this reads the index
      // of that iteration when the view is read by the assignment.
      [
        'outLoop',
        loop(
          [
            'If',
            ['Equal', 'd', 2],
            ['Assign', 'v', ['Map', 'f', ['List', 'd0']]],
            'Nothing',
          ],
          'v'
        ),
      ],
    ]);
    ce._debugBindings = true;
    expect(ce.box(['inLoop', 10]).evaluate().json).toBe(60);
    expect(listed(ce, ['outLoop', 10])).toEqual(['List', 20]);
  });

  test('evaluateAsync() records the context too', async () => {
    const ce = engine([
      ['f', F],
      ['g', ['Function', ['Map', 'f', 'xs'], 'd', 'xs']],
    ]);
    const view = await ce.box(['g', 10, ['List', 1, 2]]).evaluateAsync();
    expect(ce.function('ListFrom', [view]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
  });
});

describe('LAZY VIEW CREATION CONTEXT: EACH LAZY CALLBACK OPERATOR', () => {
  // Each body makes a view with a named callback whose last parameter has
  // the symbol default `d`. The view is read after the call has returned,
  // and must agree with the same view read inside the call.
  const ce = engine([
    ['f', F],
    ['p', ['Function', ['Greater', 'x', 'k'], 'x', ['Optional', 'k', 'd']]],
    ['q', ['Function', ['Less', 'x', 'k'], 'x', ['Optional', 'k', 'd']]],
    [
      'r',
      [
        'Function',
        ['Add', 'a', ['Multiply', 'x', 'k']],
        'a',
        'x',
        ['Optional', 'k', 'd'],
      ],
    ],
    // `Fill` calls its callback with the indexes of the element.
    [
      'f2',
      [
        'Function',
        ['Multiply', 'i', 'j', 'k'],
        'i',
        'j',
        ['Optional', 'k', 'd'],
      ],
    ],
  ]);
  const xs = ['List', 5, 15];
  const cases: [string, Json, Json][] = [
    ['Map', ['Map', 'f', 'xs'], ['List', 50, 150]],
    ['Filter', ['Filter', 'xs', 'p'], ['List', 15]],
    ['Scan', ['Scan', 'xs', 'r'], ['List', 5, 155]],
    ['TakeWhile', ['TakeWhile', 'xs', 'q'], ['List', 5]],
    ['DropWhile', ['DropWhile', 'xs', 'q'], ['List', 15]],
    ['FlatMap', ['FlatMap', 'xs', 'f'], ['List', 50, 150]],
    // The bodies below do not read `xs`, so the functions take `d` only: a
    // list argument at a parameter that the body does not type would be
    // broadcast over.
    ['Tabulate', ['Tabulate', 'f', 2], ['List', 10, 20]],
    ['Table', ['Table', 'f', 2], ['List', 10, 20]],
    ['Iterate', ['Take', ['Iterate', 'f', 1], 3], ['List', 10, 100, 1000]],
    ['Take of Map', ['Take', ['Map', 'f', 'xs'], 2], ['List', 50, 150]],
    [
      'Fill',
      ['Fill', 'f2', ['Tuple', 1, 2]],
      ['List', ['List', 10, 20]],
    ],
  ];
  for (const [name, body, expected] of cases) {
    test(name, () => {
      const outName = `out${name.replace(/\W/g, '')}`;
      const inName = `in${name.replace(/\W/g, '')}`;
      const readsXs = JSON.stringify(body).includes('"xs"');
      const params = readsXs ? ['d', 'xs'] : ['d'];
      const args = readsXs ? [10, xs] : [10];
      ce.assign(outName, ce.box(['Function', body, ...params]));
      ce.assign(inName, ce.box(['Function', ['ListFrom', body], ...params]));
      expect(ce.box([inName, ...args]).evaluate().json).toEqual(expected);
      expect(listed(ce, [outName, ...args])).toEqual(expected);
    });
  }
});

describe('LAZY VIEW CREATION CONTEXT: FRAMES, NESTED SCOPES AND HELD VIEWS', () => {
  test('a held view made at the top level is not adopted by a call that returns it', () => {
    // `ys` holds a `Map` that was never evaluated, made outside every call.
    // A call that returns `ys` did not write that `Map`: the view keeps
    // reading `d` in the context of its reader.
    const ce = engine([['f', F]]);
    ce.assign('d', ce.number(5));
    ce.assign('ys', ce.box(['Dedup', ['Map', 'f', ['List', 1, 2]]]));
    ce.assign('g', ce.box(['Function', 'ys', 'd']));
    const read = (v: any) => ce.function('ListFrom', [v]).evaluate().json;
    expect(read(ce.box('ys').evaluate())).toEqual(['List', 5, 10]);
    expect(read(ce.box(['g', 10]).evaluate())).toEqual(['List', 5, 10]);
  });

  test('a view made by a call nested in a call reads both frames after both have returned', () => {
    // The frame of `h` has the frame of `g` in its scope chain. Both frames
    // stay alive while the view holds them, with the debug check of dead
    // bindings on.
    const ce = engine([['f', F]]);
    ce._debugBindings = true;
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Block',
          ['Assign', 'h', ['Function', ['Map', 'f', 'ys'], 'ys']],
          ['h', ['List', 1, 2]],
        ],
        'd',
      ])
    );
    expect(listed(ce, ['g', 10])).toEqual(['List', 10, 20]);
  });

  test('a held view in a returned comprehension keeps the scope of the comprehension', () => {
    const body: Json = [
      'Comprehension',
      ['At', ['Dedup', ['Map', 'f', 'xs']], 'i'],
      ['Element', 'i', ['Range', 1, 2]],
    ];
    const ce = engine([
      ['f', F],
      ['gIn', ['Function', ['ListFrom', body], 'd', 'xs']],
      ['gOut', ['Function', body, 'd', 'xs']],
    ]);
    ce._debugBindings = true;
    const inside = ce.box(['gIn', 10, ['List', 1, 2]]).evaluate().json;
    expect(inside).toEqual(['List', 10, 20]);
    expect(listed(ce, ['gOut', 10, ['List', 1, 2]])).toEqual(inside);
  });

  test('a lazy operator of the host that sets callsCallbackOnRead', () => {
    const ce = engine([['f', F]]);
    // `HostMap(fn, xs)` applies the function named `fn` to each element of
    // `xs` when it is read.
    const apply = (expr: any, x: any) =>
      ce.function(expr.op1.symbol, [x]).evaluate();
    ce.declare('HostMap', {
      signature: '(function, list) -> list',
      collection: {
        isLazy: () => true,
        callsCallbackOnRead: true,
        isFinite: () => true,
        count: (expr: any) => expr.op2.count,
        at: (expr: any, i: any) => {
          const x = expr.op2.at(i);
          return x === undefined ? undefined : apply(expr, x);
        },
        iterator: (expr: any) => {
          const items = [...expr.op2.each()];
          let i = 0;
          return {
            next: () =>
              i < items.length
                ? { value: apply(expr, items[i++]), done: false }
                : { value: undefined, done: true },
          } as Iterator<any>;
        },
      },
    });
    const def: any = ce.lookupDefinition('HostMap');
    expect(def.operator.collection.callsCallbackOnRead).toBe(true);
    ce.assign('g', ce.box(['Function', ['HostMap', 'f', 'xs'], 'd', 'xs']));
    expect(listed(ce, ['g', 10, ['List', 1, 2]])).toEqual(['List', 10, 20]);
  });

  test('a view made in a block and read by a recursive call of the same function', () => {
    // The view is made in a block of the body of `r` in the call with
    // `d = 10`, and read in the call with `d = 11`. While that call runs,
    // the body scope of `r` has the frame of that call as its parent: the
    // read must not use that live chain, which reads `d = 11`.
    const recurse = (step: Json): Json => [
      'Function',
      ['If', ['Equal', 'n', 0], ['ListFrom', 'v'], step],
      'd',
      'n',
      'v',
    ];
    const call: Json = [
      'r',
      ['Add', 'd', 1],
      ['Subtract', 'n', 1],
      ['Map', 'f', ['List', 1, 2]],
    ];
    const inBlock = engine([
      ['f', F],
      ['r', recurse(['Block', call])],
    ]);
    expect(inBlock.box(['r', 10, 1, ['List']]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    const inLoop = engine([
      ['f', F],
      [
        'r',
        recurse([
          'Block',
          ['Declare', 'w', "'any'"],
          ['Loop', ['Assign', 'w', call], ['Element', 'i', ['Range', 1, 1]]],
          'w',
        ]),
      ],
    ]);
    expect(inLoop.box(['r', 10, 1, ['List']]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
  });

  test('a held view canonicalized during the call is adopted', () => {
    // `ReleaseHold` canonicalizes the held `Dedup(Map(f, xs))` during the
    // call, with the value of `xs`: its `Map` is a new node, not a node of
    // the body, and is never evaluated. (The type of `xs` is declared: the
    // body does not show that `xs` is a list.)
    const ce = engine([
      ['f', F],
      [
        'g',
        [
          'Function',
          ['ReleaseHold', ['Hold', ['Dedup', ['Map', 'f', 'xs']]]],
          'd',
          ['Typed', 'xs', "'list<number>'"],
        ],
      ],
    ]);
    ce._debugBindings = true;
    expect(listed(ce, ['g', 10, ['List', 1, 2]])).toEqual(['List', 10, 20]);
  });

  test('a call that reads its view at once does not retain its frame', () => {
    // `Spy(x)` returns `x` and keeps the definition of `d` that the call
    // reads. The frame of a call that returns its view is retained: its
    // definitions are not disposed. The frame of a call that reads the view
    // at once is disposed at its pop, as any frame.
    const ce = engine([['f', F]]);
    ce._debugBindings = true;
    let spied: any = undefined;
    ce.declare('Spy', {
      signature: '(any) -> any',
      evaluate: (ops: any, { engine }: any) => {
        spied = engine.lookupDefinition('d');
        return ops[0];
      },
    });
    ce.assign(
      'gIn',
      ce.box(['Function', ['Spy', ['ListFrom', ['Map', 'f', 'xs']]], 'd', 'xs'])
    );
    ce.assign('gOut', ce.box(['Function', ['Spy', ['Map', 'f', 'xs']], 'd', 'xs']));
    expect(ce.box(['gIn', 10, ['List', 1, 2]]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    expect(spied?.value?.disposed).toBe(true);
    expect(listed(ce, ['gOut', 10, ['List', 1, 2]])).toEqual(['List', 10, 20]);
    expect(spied?.value?.disposed).toBe(false);
  });
});

describe('LAZY VIEW CREATION CONTEXT: ENUMERATIONS, CLOSURES AND THE NUMERIC PASS', () => {
  test('an enumeration started in the call and resumed after it has returned', () => {
    // `StartIter(v)` takes the first element of `v` inside the call of `g`
    // and returns `v`. The next element is taken after `g` has returned: it
    // is computed in the context of the call too.
    const ce = engine([['f', F]]);
    let iterator: Iterator<any> | undefined = undefined;
    const firsts: Json[] = [];
    ce.declare('StartIter', {
      signature: '(list) -> any',
      evaluate: (ops: any) => {
        iterator = ops[0].each();
        firsts.push(iterator!.next().value.json);
        return ops[0];
      },
    });
    ce.assign('g', ce.box(['Function', ['StartIter', ['Map', 'f', 'xs']], 'd', 'xs']));
    expect(ce.box(['g', 10, ['List', 1, 2]]).evaluate().operator).toBe('Map');
    expect(firsts).toEqual([10]);
    expect(iterator!.next().value.json).toBe(20);
  });

  test('a view in the body of a function literal that host code builds and the call returns', () => {
    // `Wrap(v)` returns the literal `(y) => ListFrom(v)`. The frame of `g`
    // is retained (the walk goes into the body of the literal), and the
    // re-rooting of the literal keeps the record of its view.
    const ce = engine([['f', F]]);
    ce._debugBindings = true;
    let spied: any = undefined;
    ce.declare('Spy', {
      signature: '(any) -> any',
      evaluate: (ops: any, { engine }: any) => {
        spied = engine.lookupDefinition('d');
        return ops[0];
      },
    });
    ce.declare('Wrap', {
      signature: '(list) -> any',
      evaluate: (ops: any, { engine }: any) =>
        engine.box(['Function', ['ListFrom', ops[0]], 'y']),
    });
    ce.assign('g', ce.box(['Function', ['Spy', ['Wrap', ['Map', 'f', 'xs']]], 'd', 'xs']));
    const closure = ce.box(['g', 10, ['List', 1, 2]]).evaluate();
    expect(spied?.value?.disposed).toBe(false);
    expect(ce.function('Apply', [closure, ce.number(0)]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
  });

  test('a view passed to an inner call that returns a closure over it', () => {
    // `h2(Map(f, xs))` returns `() => ListFrom(v)` with `v` the view made in
    // the call of `gA` or `gC`. The rewrite of the argument for the call of
    // `h2` keeps the record of the view.
    const h2: Json = ['Function', ['Function', ['ListFrom', 'v']], 'v'];
    const ce = engine([
      ['f', F],
      ['h2', h2],
      ['gA', ['Function', ['h2', ['Map', 'f', 'xs']], 'd', 'xs']],
      ['gC', ['Function', ['Apply', ['h2', ['Map', 'f', 'xs']]], 'd', 'xs']],
    ]);
    ce._debugBindings = true;
    const closure = ce.box(['gA', 10, ['List', 1, 2]]).evaluate();
    expect(ce.function('Apply', [closure]).evaluate().json).toEqual(['List', 10, 20]);
    expect(ce.box(['gC', 10, ['List', 1, 2]]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
  });

  test('the numeric pass of an outer call evaluates a returned view in its own context', () => {
    // `g(5, xs)` returns a view made with `d = 5`. The numeric pass of `H`,
    // where `d = 10`, evaluates the view again and fills the default of
    // `f` in the context of the call of `g`.
    const ce = engine([
      ['f', F],
      ['g', ['Function', ['Map', 'f', 'xs'], 'd', 'xs']],
      ['H', ['Function', ['Block', ['Assign', 'v', ['g', 5, 'xs']], 'v'], 'd', 'xs']],
    ]);
    ce._debugBindings = true;
    for (const numericApproximation of [false, true]) {
      const view = ce.box(['H', 10, ['List', 1, 2]]).evaluate({ numericApproximation });
      expect(ce.function('ListFrom', [view]).evaluate().json).toEqual([
        'List',
        5,
        10,
      ]);
    }
  });
});
