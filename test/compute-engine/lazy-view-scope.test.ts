// A lazy callback view calls its callback in the context where the view was
// created (ROADMAP CE-728, option (a)).
//
// With `g := (d, xs) => Map(x => x * d, xs)`, the interpreter's
// `g(10, [1, 2])` is a lazy view. Its elements are computed when the view is
// read, after `g` has returned, and must be `[10, 20]`, as in the compiled
// function and as when the view is read inside `g` (`ListFrom(Map(…))`).
// The evaluation that creates the view inside `g` records the context of
// the call of `g`, and each read of the view runs in it.
//
// Before 2026-11-02, the callback was a named function `f := (x, k = d) =>
// x * k`, whose symbol default `d` was read where the call of `f` took
// place. A default is now a constant, so each case writes the callback as a
// function literal in the scope that binds `d`.
//
// A view created outside every function call records nothing and is read in
// the context of its reader.
//
// Mechanism: `src/compute-engine/boxed-expression/lazy-view-context.ts`.
// Spec: docs/plans/2026-10-31-parameter-default-values.md, §11 item 6.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  executeEpsil,
  executeEpsilAsync,
} from '../../src/epsil/execute-epsil';

type Json = any;

/** `x => x * d`: a callback whose body reads `d`, a parameter or a local of
 * the scope where the view is made. Each callback is written in that scope,
 * so `d` is bound there. */
const F: Json = ['Function', ['Multiply', 'x', 'd'], 'x'];
/** `x => x > d`, `x => x < d`, `(a, x) => a + x d`, `(i, j) => i j d`. */
const P: Json = ['Function', ['Greater', 'x', 'd'], 'x'];
const Q: Json = ['Function', ['Less', 'x', 'd'], 'x'];
const R: Json = ['Function', ['Add', 'a', ['Multiply', 'x', 'd']], 'a', 'x'];
const F2: Json = ['Function', ['Multiply', 'i', 'j', 'd'], 'i', 'j'];

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
  test('the ROADMAP case: a view returned by a call reads the `d` of the call', () => {
    const g: Json = ['Function', ['Map', F, 'xs'], 'd', 'xs'];
    const ce = engine([
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
      ce.box(['Function', ['ListFrom', ['Map', F, 'xs']], 'd', 'xs'])
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
        ['ListFrom', ['Map', F, 'xs']],
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
      'let g = (d, xs) => map(x => x * d, xs); g(10, [1, 2])'
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
      ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
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
      ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
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
      ['g', ['Function', ['Map', F, ['List', 1, 2]], 'd']],
    ]);
    const a = ce.box(['g', 3]).evaluate();
    const b = ce.box(['g', 4]).evaluate();
    const read = (v: any) => ce.function('ListFrom', [v]).evaluate().json;
    expect(read(a)).toEqual(['List', 3, 6]);
    expect(read(b)).toEqual(['List', 4, 8]);
  });

  test('a view made by a nested call and returned through an outer call', () => {
    const ce = engine([
      ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
      ['h', ['Function', ['g', ['Add', 'd', 1], 'xs'], 'd', 'xs']],
    ]);
    // The view reads the `d` of `g`, which `h` called with `d + 1`.
    expect(listed(ce, ['h', 10, ['List', 1, 2]])).toEqual(['List', 11, 22]);
  });

  test('a view made in a closure that a call returns', () => {
    const ce = engine([
      ['outer', ['Function', ['Function', ['Map', F, 'xs'], 'xs'], 'd']],
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
      ['Block', ['Declare', 'd', "'number'", 'd0'], inner],
      'd0',
      'xs',
    ];
    const ce = engine([
      ['gIn', block(['ListFrom', ['Map', F, 'xs']])],
      ['gOut', block(['Map', F, 'xs'])],
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
      [
        'g',
        [
          'Function',
          ['Map', F, ['Map', ['Function', ['Add', 'y', 'd'], 'y'], 'xs']],
          'd',
          'xs',
        ],
      ],
    ]);
    expect(listed(ce, ['g', 10, ['List', 1, 2]])).toEqual(['List', 110, 120]);
  });

  test('a view made at the top level reads the top-level `d`, wherever it is read', () => {
    // The callback is written at the top level, so its `d` is the top-level
    // symbol, also when the view is read inside a call that has a parameter
    // `d`.
    const ce = engine([
      ['readIn', ['Function', ['ListFrom', 'v'], 'd', 'v']],
      ['pass', ['Function', 'v', 'd', 'v']],
    ]);
    const top = ['Map', F, ['List', 1, 2]];
    expect(listed(ce, top)).toEqual([
      'List',
      'd',
      ['Multiply', 2, 'd'],
    ]);
    expect(ce.box(['readIn', 10, top]).evaluate().json).toEqual([
      'List',
      'd',
      ['Multiply', 2, 'd'],
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
      ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
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
            ['Declare', 'd', "'number'", ['Multiply', 'd0', 2]],
            inner,
          ],
        ],
        0,
      ],
      'd0',
      'n',
    ];
    const ce = engine([
      ['gIn', body(['ListFrom', ['Map', F, ['List', 1, 2]]])],
      ['gOut', body(['Map', F, ['List', 1, 2]])],
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
      F,
      ['List', 1, ['If', ['Greater', 'u', 0], 'n', 'n']],
    ];
    const ce = engine([
      ['gIn', ['Function', ['ListFrom', body], 'd', 'n']],
      ['gOut', ['Function', body, 'd', 'n']],
    ]);
    const inside = ce.box(['gIn', 10, 2]).evaluate().json;
    expect(inside[1]).toBe(10);
    expect(listed(ce, ['gOut', 10, 2])).toEqual(inside);
  });

  test('a view in a dictionary value', () => {
    const ce = engine([
      [
        'g',
        [
          'Function',
          [
            'Dictionary',
            [
              'KeyValuePair',
              "'v'",
              ['Map', F, ['Map', ['Function', ['Add', 'y', 'd'], 'y'], 'xs']],
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
    const ce = engine([]);
    ce._debugBindings = true;
    const xs: Json = ['List', 5, 15, 20];
    const cases: [string, Json, Json, Json][] = [
      [
        'Dedup',
        ['Dedup', ['Map', F, 'xs']],
        ['List', 50, 150, 200],
        ['List', 100, 300, 400],
      ],
      [
        'Take',
        ['Take', ['Map', F, 'xs'], 2],
        ['List', 50, 150],
        ['List', 100, 300],
      ],
      [
        'Zip',
        ['Zip', ['Map', F, 'xs'], 'xs'],
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
      [
        'cl',
        [
          'Function',
          [
            'Block',
            ['Assign', 'v', ['Map', F, ['List', 1, 2]]],
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
        ['Declare', 'acc', "'number'", 0],
        ['Declare', 'v', "'any'", 'Nothing'],
        ['Loop', body, ['Element', 'd', ['Range', 1, 3]]],
        result,
      ],
      'd0',
    ];
    const ce = engine([
      // Each iteration reads its view at once: `d` is the loop index.
      [
        'inLoop',
        loop(
          [
            'Assign',
            'acc',
            ['Add', 'acc', ['At', ['ListFrom', ['Map', F, ['List', 'd0']]], 1]],
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
            ['Assign', 'v', ['Map', F, ['List', 'd0']]],
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
      ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
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
  // Each body makes a view with a callback literal that reads the parameter
  // `d` of the call. The view is read after the call has returned,
  // and must agree with the same view read inside the call.
  const ce = engine([]);
  const xs = ['List', 5, 15];
  const cases: [string, Json, Json][] = [
    ['Map', ['Map', F, 'xs'], ['List', 50, 150]],
    ['Filter', ['Filter', 'xs', P], ['List', 15]],
    ['Scan', ['Scan', 'xs', R], ['List', 5, 155]],
    ['TakeWhile', ['TakeWhile', 'xs', Q], ['List', 5]],
    ['DropWhile', ['DropWhile', 'xs', Q], ['List', 15]],
    ['FlatMap', ['FlatMap', 'xs', F], ['List', 50, 150]],
    // The bodies below do not read `xs`, so the functions take `d` only: a
    // list argument at a parameter that the body does not type would be
    // broadcast over.
    ['Tabulate', ['Tabulate', F, 2], ['List', 10, 20]],
    ['Table', ['Table', F, 2], ['List', 10, 20]],
    ['Iterate', ['Take', ['Iterate', F, 1], 3], ['List', 10, 100, 1000]],
    ['Take of Map', ['Take', ['Map', F, 'xs'], 2], ['List', 50, 150]],
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

  test('Tabulate 2-D, with a callback of two arguments', () => {
    // The rows of a 2-D `Tabulate` are lazy views too, so `ListFrom` lists
    // the outer level only: each row is listed after the call has returned.
    ce.assign('outTab2', ce.box(['Function', ['Tabulate', F2, 1, 2], 'd']));
    ce.assign(
      'inTab2',
      ce.box(['Function', ['ListFrom', ['At', ['Tabulate', F2, 1, 2], 1]], 'd'])
    );
    expect(ce.box(['inTab2', 10]).evaluate().json).toEqual(['List', 10, 20]);
    const view = ce.box(['outTab2', 10]).evaluate();
    expect(view.operator).toBe('Tabulate');
    const rows = [...view.each()].map(
      (row) => ce.function('ListFrom', [row]).evaluate().json
    );
    expect(rows).toEqual([['List', 10, 20]]);
  });
});

describe('LAZY VIEW CREATION CONTEXT: FRAMES, NESTED SCOPES AND HELD VIEWS', () => {
  test('a held view made at the top level is not adopted by a call that returns it', () => {
    // `ys` holds a `Map` that was never evaluated, made outside every call.
    // A call that returns `ys` did not write that `Map`: the view keeps
    // reading `d` in the context of its reader.
    const ce = engine([]);
    ce.assign('d', ce.number(5));
    ce.assign('ys', ce.box(['Dedup', ['Map', F, ['List', 1, 2]]]));
    ce.assign('g', ce.box(['Function', 'ys', 'd']));
    const read = (v: any) => ce.function('ListFrom', [v]).evaluate().json;
    expect(read(ce.box('ys').evaluate())).toEqual(['List', 5, 10]);
    expect(read(ce.box(['g', 10]).evaluate())).toEqual(['List', 5, 10]);
  });

  test('a view made by a call nested in a call reads both frames after both have returned', () => {
    // The frame of `h` has the frame of `g` in its scope chain. Both frames
    // stay alive while the view holds them, with the debug check of dead
    // bindings on.
    const ce = engine([]);
    ce._debugBindings = true;
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Block',
          ['Assign', 'h', ['Function', ['Map', F, 'ys'], 'ys']],
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
      ['At', ['Dedup', ['Map', F, 'xs']], 'i'],
      ['Element', 'i', ['Range', 1, 2]],
    ];
    const ce = engine([
      ['gIn', ['Function', ['ListFrom', body], 'd', 'xs']],
      ['gOut', ['Function', body, 'd', 'xs']],
    ]);
    ce._debugBindings = true;
    const inside = ce.box(['gIn', 10, ['List', 1, 2]]).evaluate().json;
    expect(inside).toEqual(['List', 10, 20]);
    expect(listed(ce, ['gOut', 10, ['List', 1, 2]])).toEqual(inside);
  });

  test('a lazy operator of the host that sets callsCallbackOnRead', () => {
    const ce = engine([]);
    // `HostMap(fn, xs)` applies the function `fn` to each element of
    // `xs` when it is read.
    const apply = (expr: any, x: any) =>
      ce.function('Apply', [expr.op1, x]).evaluate();
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
    ce.assign('g', ce.box(['Function', ['HostMap', F, 'xs'], 'd', 'xs']));
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
      ['Map', F, ['List', 1, 2]],
    ];
    const inBlock = engine([
      ['r', recurse(['Block', call])],
    ]);
    expect(inBlock.box(['r', 10, 1, ['List']]).evaluate().json).toEqual([
      'List',
      10,
      20,
    ]);
    const inLoop = engine([
      [
        'r',
        recurse([
          'Block',
          ['Declare', 'w', "'any'", 'Nothing'],
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
      [
        'g',
        [
          'Function',
          ['ReleaseHold', ['Hold', ['Dedup', ['Map', F, 'xs']]]],
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
    const ce = engine([]);
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
      ce.box(['Function', ['Spy', ['ListFrom', ['Map', F, 'xs']]], 'd', 'xs'])
    );
    ce.assign('gOut', ce.box(['Function', ['Spy', ['Map', F, 'xs']], 'd', 'xs']));
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
  test('a view in the body of a function literal that host code builds and the call returns', () => {
    // `Wrap(v)` returns the literal `(y) => ListFrom(v)`. The frame of `g`
    // is retained (the walk goes into the body of the literal), and the
    // re-rooting of the literal keeps the record of its view.
    const ce = engine([]);
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
    ce.assign('g', ce.box(['Function', ['Spy', ['Wrap', ['Map', F, 'xs']]], 'd', 'xs']));
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
      ['h2', h2],
      ['gA', ['Function', ['h2', ['Map', F, 'xs']], 'd', 'xs']],
      ['gC', ['Function', ['Apply', ['h2', ['Map', F, 'xs']]], 'd', 'xs']],
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
    // where `d = 10`, evaluates the view again and reads `d` in the context
    // of the call of `g`.
    const ce = engine([
      ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
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

// The asynchronous route keeps the context stack of an evaluation on its own
// array, not on the engine's array. The numeric rewrite of the callback of a
// lazy `Map` reads `d` in the frame of the call, so it must run on that
// array: it ran on the engine's array, which does not hold the frame of the
// call, and `evaluateAsync({ numericApproximation: true })` of
// `g(10, [1, 2])` gave `[d, 2d]` (when the callback filled a symbol default
// `d`, before 2026-11-02).
describe('LAZY VIEW CREATION CONTEXT: THE ASYNCHRONOUS NUMERIC PASS', () => {
  const bodies: [string, Json, Json][] = [
    ['Map(f, xs)', ['Map', F, 'xs'], ['List', 10, 20]],
    [
      'Map(x => f(x), xs)',
      ['Map', ['Function', [F, 'x'], 'x'], 'xs'],
      ['List', 10, 20],
    ],
    [
      'Filter(xs, x => f(x) > 15)',
      ['Filter', 'xs', ['Function', ['Greater', [F, 'x'], 15], 'x']],
      ['List', 2],
    ],
    [
      'Scan(xs, (a, b) => a + f(b))',
      ['Scan', 'xs', ['Function', ['Add', 'a', [F, 'b']], 'a', 'b']],
      ['List', 1, 21],
    ],
    ['ListFrom(Map(f, xs))', ['ListFrom', ['Map', F, 'xs']], ['List', 10, 20]],
  ];
  for (const [name, body, expected] of bodies) {
    test(`a call that returns ${name}`, async () => {
      // A new engine for each evaluation: an evaluation keeps results (the
      // numeric callback of a `Map`, the elements of a view) that a later
      // evaluation on the same engine reads.
      const call: Json = ['g', 10, ['List', 1, 2]];
      const elements = async (
        evaluate: (ce: ComputeEngine) => any
      ): Promise<Json> => {
        const ce = engine([
              ['g', ['Function', body, 'd', 'xs']],
        ]);
        const value = await evaluate(ce);
        return ce.function('ListFrom', [value]).evaluate().json;
      };
      expect(await elements((ce) => ce.box(call).evaluate())).toEqual(expected);
      expect(await elements((ce) => ce.box(call).N())).toEqual(expected);
      expect(await elements((ce) => ce.box(call).evaluateAsync())).toEqual(
        expected
      );
      expect(
        await elements((ce) =>
          ce.box(call).evaluateAsync({ numericApproximation: true })
        )
      ).toEqual(expected);
      // A view read by `ListFrom` inside the asynchronous evaluation.
      expect(
        await elements((ce) =>
          ce
            .function('ListFrom', [ce.box(call)])
            .evaluateAsync({ numericApproximation: true })
        )
      ).toEqual(expected);
    });
  }

  test('the asynchronous numeric evaluation of a returned view reads the context of the call', async () => {
    // As `evaluate({ numericApproximation: true })` of the view: the view
    // that `g` returned is evaluated in the context of the call of `g`, also
    // when the evaluation is asynchronous.
    for (const route of ['evaluate', 'evaluateAsync'] as const) {
      const ce = engine([
          ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
      ]);
      const view = await ce.box(['g', 10, ['List', 1, 2]]).evaluateAsync();
      const value =
        route === 'evaluate'
          ? view.evaluate({ numericApproximation: true })
          : await view.evaluateAsync({ numericApproximation: true });
      expect(ce.function('ListFrom', [value]).evaluate().json).toEqual([
        'List',
        10,
        20,
      ]);
    }
  });

  test('the asynchronous numeric pass of an outer call evaluates a returned view in its own context', async () => {
    // The asynchronous form of the test of the synchronous numeric pass
    // above: `H` has `d = 10`, the view was made by `g` with `d = 5`.
    const ce = engine([
      ['g', ['Function', ['Map', F, 'xs'], 'd', 'xs']],
      ['H', ['Function', ['Block', ['Assign', 'v', ['g', 5, 'xs']], 'v'], 'd', 'xs']],
    ]);
    for (const numericApproximation of [false, true]) {
      const view = await ce
        .box(['H', 10, ['List', 1, 2]])
        .evaluateAsync({ numericApproximation });
      expect(ce.function('ListFrom', [view]).evaluate().json).toEqual([
        'List',
        5,
        10,
      ]);
    }
  });
});

// A lazy view holds its operands unevaluated, also its callback literal, and
// a symbol of these operands keeps the binding of its canonicalization. A
// view that a loop iteration assigns to a variable of an enclosing scope is
// read after the loop has written another value in its index, or after the
// call that ran the loop has returned. Before, the view read the index at the
// read: `[7, 8]` at the top level (with the debug flag, a read of a discarded
// scope), and `[d + 1, d + 2]` in a function. Now the `Assign` replaces, in
// the stored view, the locals of the loops and blocks that the variable
// outlives with their values (`bindOutlivedLocalsOfLazyValue`,
// `function-utils.ts`).
describe('A LAZY VIEW ASSIGNED OUT OF A LOOP ITERATION', () => {
  /** The value of the Epsil program `source`, with and without the debug
   * check of dead bindings. */
  function run(source: string, debug: boolean): Json {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    const r = executeEpsil(ce, source);
    expect(r.diagnostics).toEqual([]);
    return r.value!.json;
  }

  async function runAsync(source: string, debug: boolean): Promise<Json> {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    const r = await executeEpsilAsync(ce, source);
    expect(r.diagnostics).toEqual([]);
    return r.value!.json;
  }

  const cases: [string, string, Json][] = [
    [
      'a loop index at the top level',
      'let h = []; for d in [3, 6] { if d == 3 { h = Map(x => x + d, Range(1, Infinity)) } }; ListFrom(Take(h, 2))',
      ['List', 4, 5],
    ],
    [
      'a loop index in a function',
      'let b = (n) => do { let h = []; for d in [n, 2 * n] { if d == n { h = Map(x => x + d, Range(1, Infinity)) } }; h }; ListFrom(Take(b(3), 2))',
      ['List', 4, 5],
    ],
    [
      'a let local of an if block in a function',
      'let b = (n) => do { let h = []; for d in [n, 2 * n] { if d == n { let k = d; h = Map(x => x + k, Range(1, Infinity)) } }; h }; ListFrom(Take(b(3), 2))',
      ['List', 4, 5],
    ],
    [
      'a let local in a source operand',
      'let h = []; for d in [3, 6] { if d == 3 { let k = d; h = Map(x => x, Range(k, Infinity)) } }; ListFrom(Take(h, 2))',
      ['List', 3, 4],
    ],
    [
      'Filter',
      'let h = []; for d in [3, 6] { if d == 3 { h = Filter(Range(1, Infinity), x => x > d) } }; ListFrom(Take(h, 2))',
      ['List', 4, 5],
    ],
    [
      'Scan',
      'let h = []; for d in [3, 6] { if d == 3 { h = Scan(Range(1, Infinity), (a, x) => a + x + d) } }; ListFrom(Take(h, 3))',
      ['List', 1, 6, 12],
    ],
    [
      'TakeWhile',
      'let h = []; for d in [3, 6] { if d == 3 { h = Take(TakeWhile(Range(1, Infinity), x => x < d), 5) } }; ListFrom(h)',
      ['List', 1, 2],
    ],
    [
      'a finite source, which the assignment lists',
      'let h = []; for d in [3, 6] { if d == 3 { h = Map(x => x + d, [1, 2]) } }; h',
      ['List', 4, 5],
    ],
    [
      'a nested loop',
      'let h = []; for c in [1, 2] { for d in [10 * c, 20 * c] { if d == 20 { h = Map(x => x + d + c, Range(1, Infinity)) } } }; ListFrom(Take(h, 2))',
      ['List', 23, 24],
    ],
    [
      'a view per iteration in a list',
      'let hs = []; for d in [3, 6] { hs = [...hs, Map(x => x + d, Range(1, Infinity))] }; [ListFrom(Take(hs[1], 2)), ListFrom(Take(hs[2], 2))]',
      ['List', ['List', 4, 5], ['List', 7, 8]],
    ],
    [
      'a comprehension index',
      'let h = []; let r = [do { if i == 2 { h = Map(x => x + i, Range(1, Infinity)) }; i } for i in 1..3]; ListFrom(Take(h, 2))',
      ['List', 3, 4],
    ],
    // The assignment also replaces a variable of the scope of the stored
    // variable with its value (`bindReadVariablesOfLazyCollection`), so the
    // later `m = 50` does not change `h`.
    [
      'a variable of the scope of the stored variable is read at the assignment',
      'let h = []; let m = 1; for d in [3] { h = Map(x => x + m, Range(1, Infinity)) }; m = 50; ListFrom(Take(h, 2))',
      ['List', 2, 3],
    ],
  ];

  for (const debug of [false, true])
    for (const [name, source, expected] of cases)
      test(`${name}${debug ? ', with the debug check' : ''}`, () => {
        expect(run(source, debug)).toEqual(expected);
      });

  for (const debug of [false, true])
    test(`the asynchronous route${debug ? ', with the debug check' : ''}`, async () => {
      for (const [, source, expected] of cases.slice(0, 4))
        expect(await runAsync(source, debug)).toEqual(expected);
    });

  test('a view read in its own iteration reads the index of the iteration', () => {
    for (const debug of [false, true])
      expect(
        run(
          'let s = []; for d in [3, 6] { let v = Map(x => x + d, Range(1, Infinity)); s = [...s, ListFrom(Take(v, 2))] }; s',
          debug
        )
      ).toEqual(['List', ['List', 4, 5], ['List', 7, 8]]);
  });
});

// The review cases of the assignment rule above
// (`bindOutlivedLocalsOfLazyValue`, `function-utils.ts`).
describe('A LAZY VIEW ASSIGNED OUT OF A LOOP ITERATION: MORE SHAPES', () => {
  function run(source: string, debug: boolean): Json {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    const r = executeEpsil(ce, source);
    expect(r.diagnostics).toEqual([]);
    return r.value!.json;
  }

  const cases: [string, string, Json][] = [
    [
      'a view over a local that holds a view of the iteration',
      'let h = []; for d in [3, 6] { if d == 3 { let v = Map(x => x + d, Range(1, Infinity)); h = Map(y => y, v) } }; ListFrom(Take(h, 2))',
      ['List', 4, 5],
    ],
    // The `let v` stores the view with the value `3` of `d`, so `Take(v, 3)`
    // reads no variable, and the assignment keeps it lazy: the elements are
    // read with `ListFrom`.
    [
      'a Take of a local that holds a view of the iteration',
      'let h = []; for d in [3, 6] { if d == 3 { let v = Map(x => x + d, Range(1, Infinity)); h = Take(v, 3) } }; ListFrom(h)',
      ['List', 4, 5, 6],
    ],
    [
      'an inner let local that shadows an outer one',
      'let h = []; for d in [3, 6] { let k = 100; if d > 0 { let k = d; h = Map(x => x + k, Range(1, Infinity)) } }; ListFrom(Take(h, 2))',
      ['List', 7, 8],
    ],
    [
      'a constant of the library under a local of the same name',
      'let h = []; let v = Map(x => x + Pi, Range(1, Infinity)); if true { let Pi = 3; h = v }; ListFrom(Take(h, 1))',
      ['List', ['Add', 1, 'Pi']],
    ],
    [
      'a destructuring assignment',
      'let a = []; let z = 1; for d in [3, 6] { if d == 3 { (a, z) := (Map(x => x + d, Range(1, Infinity)), 0) } }; ListFrom(Take(a, 2))',
      ['List', 4, 5],
    ],
    [
      'a view in a dictionary',
      'let r = 0; for d in [3, 6] { if d == 3 { r = {"a" -> Map(x => x + d, Range(1, Infinity))} } }; ListFrom(Take(r["a"], 2))',
      ['List', 4, 5],
    ],
    [
      'a destructuring assignment is simultaneous',
      'let h = []; for i in [1] { let d = 1; (d, h) := (2, Map(x => x + d, Range(1, Infinity))) }; ListFrom(Take(h, 2))',
      ['List', 2, 3],
    ],
    [
      'a call of the innermost of two locals that hold a function',
      'let h = []; for i in [1] { let f = (x) => x + 100; if true { let f = (x) => x + 10; h = Map(x => f(x), Range(1, Infinity)) } }; ListFrom(Take(h, 2))',
      ['List', 11, 12],
    ],
    [
      'a held view is not a value and keeps its symbols',
      'let h = []; for d in [3, 6] { if d == 3 { h = Hold(Map(x => x + d, Range(1, Infinity))) } }; h',
      [
        'Hold',
        [
          'Map',
          ['Function', ['Add', 'x', 'd'], 'x'],
          ['Range', 1, 'PositiveInfinity'],
        ],
      ],
    ],
    [
      'a field of an object of an outer variable',
      'type Box = object{v: any}; let o = Box(v: []); for d in [3, 6] { if d == 3 { o.v = Map(x => x + d, Range(1, Infinity)) } }; ListFrom(Take(o.v, 2))',
      ['List', 4, 5],
    ],
    // A view stored in a field reads the locals of every loop and block of
    // the chain with their values at the store, also a local of the scope
    // of its object: the name of the receiver does not tell how long the
    // object lives. The last store reads `total = 10`.
    [
      'a field reads a local of the scope of its object at the store',
      'type Box = object{v: any}; let r = 0; if true { let total = 0; let o = Box(v: []); for i in [1, 2] { o.v = Map(x => x + total, Range(1, Infinity)); total = total + 10 }; r = ListFrom(Take(o.v, 2)) }; r',
      ['List', 11, 12],
    ],
    // An alias in an inner scope names the object of `o`: the view reads
    // the `i` of the last iteration, not a discarded one.
    [
      'a field stored through an alias in the loop',
      'type Box = object{v: any}; let o = Box(v: []); for i in [1, 2] { let p = o; p.v = Map(x => x + i, Range(1, Infinity)) }; ListFrom(Take(o.v, 2))',
      ['List', 3, 4],
    ],
    [
      'a field stored through a parameter of a function of the loop',
      'type Box = object{v: any}; let o = Box(v: []); for i in [1, 2] { function g(p: Box) { p.v = Map(x => x + i, Range(1, Infinity)) }; g(o) }; ListFrom(Take(o.v, 2))',
      ['List', 3, 4],
    ],
    // The branches of an `If` are values: the `If` stays unevaluated while
    // `c` is free, and its view is read when `c` gets a value.
    [
      'a view in a branch of an If with a free condition',
      'let h = []; for i in [1, 2] { h = If(c, Map(x => x + i, Range(1, Infinity)), Range(1, Infinity)) }; c = True; ListFrom(Take(h, 2))',
      ['List', 3, 4],
    ],
    [
      'a view under a node that stays unevaluated',
      'let r = 0; for d in [3, 6] { if d == 3 { r = ListFrom(TakeWhile(Range(1, Infinity), x => x < d)) } }; r',
      [
        'ListFrom',
        [
          'TakeWhile',
          ['Range', 1, 'PositiveInfinity'],
          ['Function', ['Block', ['Less', 'x', 3]], 'x'],
        ],
      ],
    ],
  ];

  for (const debug of [false, true])
    for (const [name, source, expected] of cases)
      test(`${name}${debug ? ', with the debug check' : ''}`, () => {
        expect(run(source, debug)).toEqual(expected);
      });

  test('a call of a local that a local of an inner block shadows with a number', () => {
    // The inner `f` holds `5`, not a function. The view read after the
    // blocks gives the same elements as the view read in the inner block.
    const blocks = (read: string) =>
      `let h = []; let r = 0; if true { let f = x => x + 1; if true { let f = 5; h = Map(x => f(x), Range(1, Infinity))${read} } }`;
    for (const debug of [false, true])
      expect(
        run(`${blocks('')}; ListFrom(Take(h, 2))`, debug)
      ).toEqual(run(`${blocks('; r = ListFrom(Take(h, 2))')}; r`, debug));
  });

  test('a value that nests tuples of a view', () => {
    // `a1 = (a0, a0)`, ..., `a8 = (a7, a7)`. The depth is small: the
    // evaluation of `(a0, a0)` makes a new view for each occurrence, so the
    // value holds 2^8 views, and each one is rewritten.
    const DEPTH = 8;
    const lets = [
      'let a0 = Map(x => x + d, Range(1, Infinity))',
      ...Array.from(
        { length: DEPTH },
        (_, i) => `let a${i + 1} = (a${i}, a${i})`
      ),
    ];
    const path = '[2]'.repeat(DEPTH);
    for (const debug of [false, true])
      expect(
        run(
          `let h = 0; for d in [3, 6] { if d == 3 { ${lets.join('; ')}; h = a${DEPTH} } }; ListFrom(Take(h${path}, 2))`,
          debug
        )
      ).toEqual(['List', 4, 5]);
  });

  test('a view assigned from a block in a Sum, synchronous and asynchronous', async () => {
    // The body of the `Sum` is a block whose local `m` holds the index. The
    // asynchronous route runs the block in an activation of its scope. Each
    // route has its own engine: with the debug check, `evaluateAsync()` of
    // a `Sum` with a block body after its `evaluate()` reports a read of
    // the discarded index `k`, also when the block assigns no view.
    for (const [debug, routes] of [
      [false, ['evaluate', 'evaluateAsync']],
      [false, ['evaluateAsync']],
      [true, ['evaluate']],
      [true, ['evaluateAsync']],
    ] as const) {
      const ce = new ComputeEngine();
      ce._debugBindings = debug;
      ce.assign('h', ce.box(['List']));
      const sum = ce.box([
        'Sum',
        [
          'Block',
          ['Declare', 'm', 'integer', 'k'],
          [
            'If',
            ['Equal', 'k', 2],
            [
              'Assign',
              'h',
              [
                'Map',
                ['Function', ['Add', 'x', 'm'], 'x'],
                ['Range', 1, 'PositiveInfinity'],
              ],
            ],
            'Nothing',
          ],
          0,
        ],
        ['Limits', 'k', 1, 3],
      ]);
      const read = () =>
        ce.box(['ListFrom', ['Take', 'h', 2]]).evaluate().json;
      for (const route of routes) {
        ce.assign('h', ce.box(['List']));
        if (route === 'evaluate') sum.evaluate();
        else await sum.evaluateAsync();
        expect(read()).toEqual(['List', 3, 4]);
      }
    }
  });
});
