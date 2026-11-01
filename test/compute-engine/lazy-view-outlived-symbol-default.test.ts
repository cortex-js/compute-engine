// A lazy callback view that an assignment stores out of a loop iteration or
// a block of the top level reads, in the call of its callback, the names
// that the call reads by their binding in the context with their values at
// the assignment.
//
// With `f = (x, k = d) => x * k`, the view `Map(f, R)` names no `d`: the
// call `f(x)` fills the default `k` with the `d` of the context where the
// call takes place. A view made in a function call reads it in the context
// of that call (`lazy-view-context.ts`). A view made at the top level had no
// record of its context and was read in the context of its reader: with
// `for d in [3, 6] { if d == 3 { h = Map(f, R) } }`, the elements of `h`
// read after the loop were `d` and `2d`. Now the assignment gives the view a
// record of the scopes that the variable outlives, with their values at the
// assignment (`recordOutlivedLazyViewContexts`, called by
// `bindOutlivedLocalsOfLazyValue` in `function-utils.ts`), and the elements
// are `3` and `6`.

import { ComputeEngine } from '../../src/compute-engine';
import {
  executeEpsil,
  executeEpsilAsync,
} from '../../src/epsil/execute-epsil';

type Json = any;

const F = 'let f = (x, k = d) => x * k; ';

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

describe('A SYMBOL DEFAULT READ BY A VIEW ASSIGNED OUT OF A TOP-LEVEL LOOP', () => {
  const cases: [string, string, Json][] = [
    [
      'a variable outside the loop',
      `${F}let h = []; for d in [3, 6] { if d == 3 { h = Map(f, Range(1, Infinity)) } }; ListFrom(Take(h, 2))`,
      ['List', 3, 6],
    ],
    [
      'a view inside another lazy collection',
      `${F}let h = []; for d in [3, 6] { if d == 3 { h = Take(Map(f, Range(1, Infinity)), 2) } }; ListFrom(h)`,
      ['List', 3, 6],
    ],
    [
      'a view per iteration in a list',
      `${F}let hs = []; for d in [3, 6] { hs = [...hs, Map(f, Range(1, Infinity))] }; [ListFrom(Take(hs[1], 2)), ListFrom(Take(hs[2], 2))]`,
      ['List', ['List', 3, 6], ['List', 6, 12]],
    ],
    [
      'a field of an object of an outer variable',
      `${F}type Box = object{v: any}; let o = Box(v: []); for d in [3, 6] { if d == 3 { o.v = Map(f, Range(1, Infinity)) } }; ListFrom(Take(o.v, 2))`,
      ['List', 3, 6],
    ],
    [
      'a destructuring assignment',
      `${F}let a = []; let z = 1; for d in [3, 6] { if d == 3 { (a, z) := (Map(f, Range(1, Infinity)), 0) } }; ListFrom(Take(a, 2))`,
      ['List', 3, 6],
    ],
    [
      'a let local of a block',
      `${F}let h = []; if true { let d = 4; h = Map(f, Range(1, Infinity)); d = 5 }; ListFrom(Take(h, 2))`,
      ['List', 4, 8],
    ],
    // The first assignment stores the view in `u`, a variable of the loop
    // body, and the second one stores it further out: the record of the
    // view is extended to the scope of `h`, and keeps `d = 3`.
    [
      'a view stored out of a nested loop, then out of the outer loop',
      `${F}let h = []; for d in [3, 6] { let u = []; for j in [1] { if d == 3 { u = Map(f, Range(1, Infinity)) } }; if d == 3 { h = u } }; ListFrom(Take(h, 2))`,
      ['List', 3, 6],
    ],
    [
      'a view stored out of a block, then out of the outer block',
      `${F}let h = []; if true { let d = 3; let v = []; if true { v = Map(f, Range(1, Infinity)) }; h = v; d = 6 }; ListFrom(Take(h, 2))`,
      ['List', 3, 6],
    ],
    // The block that made the view has no local, and it has ended when the
    // view is stored in `h`.
    [
      'a view stored outward after the block that made it has ended',
      `${F}let h = []; for d in [3, 6] { let u = []; if d == 3 { u = Map(f, Range(1, Infinity)) }; if d == 3 { h = u } }; ListFrom(Take(h, 2))`,
      ['List', 3, 6],
    ],
    // A limit: a view that leaves its block as the value of the block has
    // lost the context of its creation when it is stored, gets no record,
    // and is read in the context of its reader, where `d` has no value. The
    // elements stay symbolic: they are not those of another iteration.
    [
      'a view that is the value of a block is read in the context of its reader',
      `${F}let h = []; for d in [3, 6] { if d == 3 { h = do { let z = 0; Map(f, Range(1, Infinity)) } } }; ListFrom(Take(h, 2))`,
      ['List', 'd', ['Multiply', 2, 'd']],
    ],
    // The record of the store in `v` has the outer block as its frame. That
    // block has ended when the view is stored in `w`: the view is stored
    // with no record, and does not read the `d` of the last iteration.
    [
      'a view whose earlier record has ended is read in the context of its reader',
      `${F}let h = []; for d in [3, 6] { let w = []; w = do { let v = []; do { v = Map(f, Range(1, Infinity)) }; v }; if d == 3 { h = w } }; ListFrom(Take(h, 2))`,
      ['List', 'd', ['Multiply', 2, 'd']],
    ],
    // A view made in the global scope gets no record when a block stores
    // it: it reads `d = 3`, the value at the read.
    [
      'a view of the global scope stored in a block reads the current value',
      'let d = 2; let f = (x, k = d) => x * k; let v = Map(f, Range(1, Infinity)); if true { let h = []; h = v; d = 3; ListFrom(Take(h, 2)) }',
      ['List', 3, 6],
    ],
    // A view made in a block that ended before the loop, and stored in the
    // loop: it has the record of its first store, with `d = 3`.
    [
      'a view made in a block that ended before the loop',
      `${F}let v = []; if true { let d = 3; v = Map(f, Range(1, Infinity)) }; let h = []; for d in [5] { h = v; h = ListFrom(Take(h, 2)) }; h`,
      ['List', 3, 6],
    ],
    [
      'a view made in an earlier iteration and stored in a later one',
      `${F}let v = []; let h = []; for d in [3, 6] { if d == 3 { v = Map(f, Range(1, Infinity)) } else { h = v } }; ListFrom(Take(h, 2))`,
      ['List', 3, 6],
    ],
    [
      'a view in a dictionary under a lazy collection',
      `${F}let h = []; for d in [3, 6] { if d == 3 { h = Cycle([{"a" -> Map(f, Range(1, Infinity))}]) } }; ListFrom(Take(First(h)["a"], 2))`,
      ['List', 3, 6],
    ],
    // `v` is read in its own scope after `d` has changed, and reads `d = 5`;
    // `h` reads the `d = 1` of its assignment.
    [
      'the view of a local keeps reading the current values',
      `${F}let h = []; if true { let d = 1; let v = Map(f, Range(1, Infinity)); h = v; d = 5; h = [ListFrom(Take(v, 2)), h] }; [h[1], ListFrom(Take(h[2], 2))]`,
      ['List', ['List', 5, 10], ['List', 1, 2]],
    ],
  ];

  for (const debug of [false, true])
    for (const [name, source, expected] of cases)
      test(`${name}${debug ? ', with the debug check' : ''}`, () => {
        expect(run(source, debug)).toEqual(expected);
      });

  for (const debug of [false, true])
    test(`the asynchronous route${debug ? ', with the debug check' : ''}`, async () => {
      for (const [, source, expected] of cases)
        expect(await runAsync(source, debug)).toEqual(expected);
    });

  test('a view read in its own iteration reads the index of the iteration', () => {
    for (const debug of [false, true])
      expect(
        run(
          `${F}let s = []; for d in [3, 6] { let v = Map(f, Range(1, Infinity)); s = [...s, ListFrom(Take(v, 2))] }; s`,
          debug
        )
      ).toEqual(['List', ['List', 3, 6], ['List', 6, 12]]);
  });

  test('a view made outside the loop is read in the context of its reader', () => {
    // `v` is made where `d` has no value, and `h = v` in the loop does not
    // change where its callback is called: the elements read the free `d`,
    // as a read of `v` itself does.
    for (const debug of [false, true])
      expect(
        run(
          `${F}let v = Map(f, Range(1, Infinity)); let h = []; for d in [3, 6] { h = v }; [ListFrom(Take(h, 2)), ListFrom(Take(v, 2))]`,
          debug
        )
      ).toEqual([
        'List',
        ['List', 'd', ['Multiply', 2, 'd']],
        ['List', 'd', ['Multiply', 2, 'd']],
      ]);
  });

  test('a view that writes a local of the loop gets a record', () => {
    // The inner view writes `d`, so the assignment keeps its symbols: no
    // capture of the scope backs the write. The outer view still gets a
    // record, and the call `f(x)` that it makes fills `k` with `d = 3`.
    // The kept symbol `d` of the inner view reads a discarded scope, which
    // the debug check of dead bindings reports: this case is run without it.
    expect(
      run(
        `${F}let h = []; for d in [3, 6] { if d == 3 { h = Map(f, Map(x => do { d = d; x }, Range(1, Infinity))) } }; ListFrom(Take(h, 2))`,
        false
      )
    ).toEqual(['List', 3, 6]);
  });

  test('the MathJSON form', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 'd']])
    );
    const program: Json = [
      'Block',
      ['Declare', 'h', 'any'],
      [
        'Loop',
        [
          'Block',
          [
            'If',
            ['Equal', 'd', 3],
            [
              'Block',
              ['Assign', 'h', ['Map', 'f', ['Range', 1, 'PositiveInfinity']]],
            ],
          ],
        ],
        ['Element', 'd', ['List', 3, 6]],
      ],
      ['ListFrom', ['Take', 'h', 2]],
    ];
    expect(ce.box(program).evaluate().json).toEqual(['List', 3, 6]);
  });
});
