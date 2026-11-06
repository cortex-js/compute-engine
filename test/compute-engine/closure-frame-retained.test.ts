/**
 * A closure that a call returns keeps the definitions of the frame of that
 * call alive.
 *
 * At the end of a call, `captureClosures` (`function-utils.ts`) rebuilds each
 * closure of the result on the frame of the call, and the closure reads the
 * definitions of the frame after the call has returned. The pop of the frame
 * disposed these definitions, and with `ce._debugBindings` it also marked
 * them as dead. The end of the call substitutes the value of a parameter
 * into the body of a closure (`bindingKeyedSubs`), but a closure can hold a
 * nested function literal that reads a name of the frame:
 * `o1 := d => (xs => ListFrom(Map(x => x * d, xs)))`. With the debug flag, a
 * read of a disposed definition of the frame threw 'The binding of "d"
 * belongs to the discarded scope "call"'. Without the flag the value was
 * correct, because a disposed definition keeps its value.
 *
 * Before 2026-11-02, most cases read `d` through the symbol default of a
 * function `f := (x, k = d) => x * k` applied in the closure, which was read
 * where the call was made. A default is now a constant, so the cases read
 * `d` in a nested function literal of the closure.
 *
 * Now the frame is marked as retained when the call makes a closure whose
 * chain reaches the frame (`rerootOnCreatingFrame`, `function-utils.ts`),
 * which also covers a closure that leaves the call by an assignment to an
 * outer variable, and when the capture at the end of the call met a node of
 * the result whose chain reads the frame (`nodesReadingLeftCall`). Both call
 * `retainScope` (`boxed-expression/lazy-view-context.ts`), and
 * the pop of a retained frame does not dispose its definitions
 * (`discardEvalContext`, `engine-scope.ts`).
 *
 * Each case runs with the debug flag on and off, and must give the same
 * value.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';

type Json = any;

/** `x => x * d`: a function literal whose body reads `d`, the name of a
 * parameter or a local of the scope where the closure that holds it is
 * made. */
const MUL_D: Json = ['Function', ['Multiply', 'x', 'd'], 'x'];

function engine(debug: boolean, definitions: [string, Json][]): ComputeEngine {
  const ce = new ComputeEngine();
  ce._debugBindings = debug;
  for (const [name, value] of definitions) ce.assign(name, ce.box(value));
  return ce;
}

function evaluated(debug: boolean, definitions: [string, Json][], expr: Json) {
  return engine(debug, definitions).box(expr).evaluate().json;
}

function epsil(debug: boolean, source: string): Json {
  const ce = new ComputeEngine();
  ce._debugBindings = debug;
  const r = executeEpsil(ce, source);
  expect(r.diagnostics).toEqual([]);
  return r.value?.json;
}

describe.each([true, false])('CLOSURE RETURNED BY A CALL, debug %s', (debug) => {
  test('a closure reads a name of the frame in a nested function literal', () => {
    const defs: [string, Json][] = [
      ['o1', ['Function', ['Function', ['ListFrom', ['Map', MUL_D, 'xs']], 'xs'], 'd']],
    ];
    expect(evaluated(debug, defs, [['o1', 7], ['List', 1, 2]])).toEqual([
      'List',
      7,
      14,
    ]);
  });

  test('the same closure, applied asynchronously', async () => {
    const ce = engine(debug, [
      ['o1', ['Function', ['Function', ['ListFrom', ['Map', MUL_D, 'xs']], 'xs'], 'd']],
    ]);
    const value = await ce.box([['o1', 7], ['List', 1, 2]]).evaluateAsync();
    expect(value.json).toEqual(['List', 7, 14]);
  });

  test('a closure that returns a lazy view', () => {
    const ce = engine(debug, [
      ['o1', ['Function', ['Function', ['Map', MUL_D, 'xs'], 'xs'], 'd']],
    ]);
    const view = ce.box([['o1', 7], ['List', 1, 2]]).evaluate();
    expect(ce.function('ListFrom', [view]).evaluate().json).toEqual([
      'List',
      7,
      14,
    ]);
  });

  test('a closure that reads the frame through a symbol of its body', () => {
    const defs: [string, Json][] = [
      ['o2', ['Function', ['Function', ['Add', 'x', 'd'], 'x'], 'd']],
    ];
    expect(evaluated(debug, defs, [['o2', 7], 1])).toBe(8);
  });

  test('nested closures', () => {
    const defs: [string, Json][] = [
      [
        'g',
        [
          'Function',
          ['Function', ['Function', ['ListFrom', ['Map', MUL_D, 'xs']], 'xs'], 'e'],
          'd',
        ],
      ],
    ];
    expect(evaluated(debug, defs, [[['g', 4], 0], ['List', 1, 2]])).toEqual([
      'List',
      4,
      8,
    ]);
  });

  test('a closure returned through a second call', () => {
    expect(
      epsil(
        debug,
        `let mk = (d) => (xs => ListFrom(Map(x => x * d, xs)))
let wrap = (m) => mk(m + 1)
wrap(4)([1, 2])`
      )
    ).toEqual(['List', 5, 10]);
  });

  test('a closure that writes a parameter of the frame', () => {
    expect(
      epsil(
        debug,
        `function mk(n) { () => do { n = n + 1; n } }
let c = mk(5)
c()
let c2 = mk(10)
c2()
c()`
      )
    ).toBe(7);
  });

  test('a closure that reads a local of the body in a nested function literal', () => {
    expect(
      epsil(
        debug,
        `let b = (d0) => do { let d = 2 * d0; (xs => ListFrom(Map(x => x * d, xs))) }
b(3)([1, 2])`
      )
    ).toEqual(['List', 6, 12]);
  });

  test('a closure that reads a loop index in a nested function literal', () => {
    expect(
      epsil(
        debug,
        `let b = (n) => do { let h = (xs) => xs; for d in [n, 2 * n] { h = (xs => ListFrom(Map(x => x * d, xs))) }; h }
b(3)([1, 2])`
      )
    ).toEqual(['List', 6, 12]);
  });

  test('a closure that leaves the call by an assignment to an outer variable', () => {
    expect(
      epsil(
        debug,
        `let g = (xs => xs)
let o: (number) scope -> number = (d) => do { g = (xs => ListFrom(Map(x => x * d, xs))); 0 }
o(7)
g([1, 2])`
      )
    ).toEqual(['List', 7, 14]);
  });

  test('the closure of the last of two calls that assign it', () => {
    expect(
      epsil(
        debug,
        `let g = (xs => xs)
let o: (number) scope -> number = (d) => do { g = (xs => ListFrom(Map(x => x * d, xs))); 0 }
o(7)
o(9)
g([1, 2])`
      )
    ).toEqual(['List', 9, 18]);
  });

  test('a closure stored in a list in an outer variable', () => {
    expect(
      epsil(
        debug,
        `let g = [(xs => xs)]
let o: (number) scope -> number = (d) => do { g = [(xs => ListFrom(Map(x => x * d, xs)))]; 0 }
o(7)
g[1]([1, 2])`
      )
    ).toEqual(['List', 7, 14]);
  });

  test('an assigned closure that reads the frame through a symbol of its body', () => {
    expect(
      epsil(
        debug,
        `let g = (x => x)
let o: (number) scope -> number = (d) => do { g = (x => x + d); 0 }
o(7)
g(1)`
      )
    ).toBe(8);
  });
});

/**
 * A closure made in a loop or in a nested block keeps the definitions of
 * that scope alive.
 *
 * A symbol of the body of the closure keeps the binding that it got at
 * canonicalization: for a loop index, the definition in the scope of the
 * loop. A `let` local of a block is shared with the copy of the block that
 * the closure captures (`captureNestedLocals`, `function-utils.ts`), and a
 * nested function literal of the closure reads it.
 * The pop of the loop or of the block disposed these definitions, and with
 * `ce._debugBindings` it also marked them as dead, so a call of the closure
 * after the pop threw 'The binding of "d" belongs to the discarded scope'.
 * Without the flag the value was correct, because a disposed definition
 * keeps its value.
 *
 * Now the creation of the closure marks each local scope of an expression
 * node (a block, a loop, a comprehension, a big operator) that its chain
 * reaches (`retainScopesReachedByLiteral`,
 * `function-utils.ts`), and the pop of a marked scope does not tombstone its
 * definitions (`discardEvalContext`, `engine-scope.ts`).
 *
 * Each case runs with the debug flag on and off, and must give the same
 * value.
 */
describe.each([true, false])('CLOSURE MADE IN A LOOP OR A BLOCK, debug %s', (debug) => {
  test('a closure reads the loop index through a symbol of its body', () => {
    expect(
      epsil(
        debug,
        `let b = (n) => do { let h = (x) => x; for d in [n, 2 * n] { if d == n { h = (x => x + d) } }; h }
b(3)(1)`
      )
    ).toBe(4);
  });

  test('a closure made at the top level in a loop', () => {
    expect(
      epsil(
        debug,
        `let h = (x) => x
for d in [3, 6] { if d == 3 { h = (x => x + d) } }
h(1)`
      )
    ).toBe(4);
  });

  test('a closure made in the last iteration of a loop at the top level', () => {
    expect(
      epsil(
        debug,
        `let h = (x) => x
for d in [3, 6] { h = (x => x + d) }
h(1)`
      )
    ).toBe(7);
  });

  test('a later run of the loop that makes no closure', () => {
    expect(
      epsil(
        debug,
        `let b = (n, m) => do { let h = (x) => x; for d in [n] { if m { h = (x => x + d) } }; h }
let g = b(3, true)
b(4, false)
g(1)`
      )
    ).toBe(4);
  });

  test('an earlier run of the loop that makes no closure', () => {
    expect(
      epsil(
        debug,
        `let b = (n, m) => do { let h = (x) => x; for d in [n] { if m { h = (x => x + d) } }; h }
b(4, false)
let g = b(3, true)
g(1)`
      )
    ).toBe(4);
  });

  test('a recursive call runs the same loop while the loop of the caller runs', () => {
    // The pop of the loop scope by the inner call does not tombstone the
    // index that the loop of the outer call reads next.
    expect(
      epsil(
        debug,
        `let f = (n) => do { let out = []; for c in [10 * n, 10 * n + 1] { out = Append(out, c); if n < 2 { out = Join(out, f(n + 1)) } }; out }
f(1)`
      )
    ).toEqual(['List', 10, 20, 21, 11, 20, 21]);
  });

  test('a closure made in a host scope does not keep its definitions', () => {
    // Only the local scopes of expression nodes are marked.
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    ce.pushScope();
    ce.declare('a', 'real');
    const def = ce.lookupDefinition('a') as { value?: { disposed: boolean } };
    ce.box(['Function', ['Add', 'x', 'a'], 'x']).evaluate();
    ce.popScope();
    expect(def.value?.disposed).toBe(true);
  });

  test('a closure assigned in a big operator reads its index', () => {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', 'x', 'x']));
    const sum = ce.box([
      'Sum',
      ['Block', ['Assign', 'g', ['Function', ['Add', 'x', 'i'], 'x']], 'i'],
      ['Limits', 'i', 1, 3],
    ]);
    expect(sum.evaluate().json).toBe(6);
    expect(ce.box(['g', 1]).evaluate().json).toBe(4);
  });

  test('a closure assigned in a comprehension element gives the same value with the flag on and off', () => {
    const src = `let h = (x) => x
let b: (number) scope -> number = (n) => do { let c = [do { h = (x => x + d); 0 } for d in [3 * n]]; ListFrom(c); 0 }
b(1)
h(1)`;
    expect(epsil(debug, src)).toEqual(epsil(!debug, src));
  });

  // The comprehension marks its index scope as in use for each element, as a
  // loop does, so a closure made in the element captures the index with the
  // value of the element and the frame of the call (`captureNestedLocals`).
  // Before, `h(1)` gave `d + 1`.
  test('a closure assigned in a comprehension element reads the index of its element', () => {
    expect(
      epsil(
        debug,
        `let h = (x) => x
let b: (number) scope -> number = (n) => do { let c = [do { h = (x => x + d); 0 } for d in [3 * n]]; ListFrom(c); 0 }
b(1)
h(1)`
      )
    ).toBe(4);
  });

  test('a closure assigned in a comprehension element at the top level reads the index', () => {
    expect(
      epsil(
        debug,
        `let h = (x) => x
ListFrom([do { h = (x => x + d); 0 } for d in [3]])
h(1)`
      )
    ).toBe(4);
  });

  test('a closure assigned in a comprehension element reads a parameter of the call', () => {
    expect(
      epsil(
        debug,
        `let h = (x) => x
let b: (number) scope -> number = (n) => do { let c = [do { h = (x => x + d * n); 0 } for d in [3]]; ListFrom(c); 0 }
b(2)
h(1)`
      )
    ).toBe(7);
  });

  test('each element of a comprehension gives its closure its own index', () => {
    expect(
      epsil(
        debug,
        `let hs = []
let b: (number) scope -> number = (n) => do { let c = [do { hs = [...hs, (x => x + d)]; 0 } for d in [n, 2 * n]]; ListFrom(c); 0 }
b(1)
ListFrom(Map((g) => g(100), hs))`
      )
    ).toEqual(['List', 101, 102]);
  });

  test('an element that is a function literal shows the value of its index', () => {
    // The capture of the element (the index scope is in use) must not hide
    // the index behind a captured scope: the substitution of the index
    // values still replaces `i`.
    const shape = (k: number) => ['Function', ['Block', ['Add', 'x', k]], 'x'];
    const top = new ComputeEngine();
    top._debugBindings = debug;
    const r = executeEpsil(top, `ListFrom([x => x + i for i in 1..3])`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.json).toEqual(['List', shape(1), shape(2), shape(3)]);
    expect(String(r.value)).toBe('[(x) => x + 1,(x) => x + 2,(x) => x + 3]');

    expect(
      epsil(debug, `let f = (n) => ListFrom([x => x + i * n for i in 1..3])\nf(2)`)
    ).toEqual(['List', shape(2), shape(4), shape(6)]);

    const ce = engine(debug, []);
    const comprehension = (body: Json) => [
      'ListFrom',
      ['Comprehension', ['Function', body, 'x'], ['Element', 'i', ['Range', 1, 3]]],
    ];
    const v = ce.box(comprehension(['Add', 'x', 'i'])).evaluate();
    expect(v.json).toEqual(['List', shape(1), shape(2), shape(3)]);
    expect(String(v)).toBe('[(x) => x + 1,(x) => x + 2,(x) => x + 3]');
    expect(
      ce
        .box([['Function', comprehension(['Add', 'x', ['Multiply', 'i', 'n']]), 'n'], 2])
        .evaluate().json
    ).toEqual(['List', shape(2), shape(4), shape(6)]);
  });

  test('a closure assigned in a nested comprehension reads both indices', () => {
    expect(
      epsil(
        debug,
        `let h = (x) => x
let b: (number) scope -> number = (n) => do { let c = [[do { h = (x => x + d + e); 0 } for e in [10 * n]] for d in [3 * n]]; ListFrom(c); 0 }
b(1)
h(1)`
      )
    ).toBe(14);
  });

  test('a closure assigned in a comprehension with a filter reads the index', () => {
    expect(
      epsil(
        debug,
        `let h = (x) => x
let b: (number) scope -> number = (n) => do { let c = [do { h = (x => x + d); 0 } for d in [1, 2, 3 * n] if d > 2]; ListFrom(c); 0 }
b(1)
h(1)`
      )
    ).toBe(4);
  });

  test('a closure assigned in a lazy comprehension reads the index when the element is read', () => {
    // The comprehension is returned by the call and walked after it.
    expect(
      epsil(
        debug,
        `let h = (x) => x
let b: (number) scope -> list = (n) => [do { h = (x => x + d * n); 0 } for d in [3, 4, 5]]
let c = b(2)
First(c)
h(1)`
      )
    ).toBe(11);
  });

  test('a closure assigned in a comprehension element reads the index under evaluateAsync()', async () => {
    const ce = new ComputeEngine();
    ce._debugBindings = debug;
    const r = await executeEpsilAsync(
      ce,
      `let h = (x) => x
let b: (number) scope -> number = (n) => do { let c = [do { h = (x => x + d * n); 0 } for d in [3]]; ListFrom(c); 0 }
b(2)
h(1)`
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.json).toBe(7);
  });

  test('a recursive call from a comprehension element keeps the index of the caller', () => {
    expect(
      epsil(
        debug,
        `let r = (n) => if n == 0 { [] } else { ListFrom([do { let t = r(n - 1); [d, t] } for d in [n, 10 * n]]) }
r(2)`
      )
    ).toEqual([
      'List',
      ['List', 2, ['List', ['List', 1, ['List']], ['List', 10, ['List']]]],
      ['List', 20, ['List', ['List', 1, ['List']], ['List', 10, ['List']]]],
    ]);
  });

  test('a nested function literal reads a local of the block of the closure', () => {
    expect(
      epsil(
        debug,
        `let b = (n) => if n > 0 { let d = 3 * n; (xs => ListFrom(Map(x => x * d, xs))) } else { (xs => xs) }
b(2)([1, 2])`
      )
    ).toEqual(['List', 6, 12]);
  });

  test('a closure made at the top level in a block reads a local of the block', () => {
    expect(
      epsil(
        debug,
        `let g = (x) => x
if true { let d = 5; g = (xs => ListFrom(Map(x => x * d, xs))) }
g([1, 2])`
      )
    ).toEqual(['List', 5, 10]);
  });
});
