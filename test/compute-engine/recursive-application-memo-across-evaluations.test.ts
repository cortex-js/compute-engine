import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Tycho ledger item filed 2026-09-05 as "254" (the number collides with the
 * `interval-js` Sqrt-domain item of 2026-09-04; the D-264 point chain).
 *
 * A comprehension over a SELF-RECURSIVE user function hands out its elements
 * lazily, and each pulled element is its own top-level evaluation. The
 * pure-application memo used to be emptied when a top-level evaluation
 * began, so `[P(i) for i in 0..n]` with `P(i) = s(P(i-1))` re-ran the
 * recursion from the bottom at every element: n(n+1)/2 calls of the step
 * function where n suffice. The memo now lives for the engine's lifetime
 * under its version stamps (`IComputeEngine._applicationMemo`), and a
 * numerically requested application also stores its exact result — the
 * entry the recursive body, which applies itself exactly, looks up.
 *
 * The step `s` is a handler-backed function so every call is COUNTED; the
 * count is the evidence, not the wall clock.
 */

function setup(): { ce: ComputeEngine; calls: () => number; reset: () => void } {
  let stepCalls = 0;
  const ce = new ComputeEngine();
  // s(Q) = Q + (cos Q.x, sin Q.y)
  ce.declare('s', {
    signature: '(tuple<number, number>) -> tuple<number, number>',
    evaluate: (ops) => {
      stepCalls += 1;
      const q = ops[0].evaluate();
      const x = Number(q.ops?.[0]?.re ?? NaN);
      const y = Number(q.ops?.[1]?.re ?? NaN);
      return ce.function('Tuple', [
        ce.number(x + Math.cos(x)),
        ce.number(y + Math.sin(y)),
      ]);
    },
  });
  ce.declare('P', 'function');
  ce.assign(
    'P',
    ce.box([
      'Function',
      [
        'Which',
        ['Equal', 'i', 0],
        ['Tuple', 0, 0],
        'True',
        ['s', ['P', ['Subtract', 'i', 1]]],
      ],
      'i',
    ])
  );
  return {
    ce,
    calls: () => stepCalls,
    reset: () => {
      stepCalls = 0;
    },
  };
}

const COMPREHENSION = (n: number) =>
  `\\left[P\\left(i\\right)\\operatorname{for}i=\\left[0...${n}\\right]\\right]`;

describe('pure-application memo across top-level evaluations', () => {
  test('a single recursive application costs one step call per level', () => {
    const { ce, calls } = setup();
    const v = ce.parse('P\\left(10\\right)').N();
    expect(v.operator).toBe('Tuple');
    expect(calls()).toBe(10);
  });

  test('a comprehension pulled element by element costs one step call per element, not n(n+1)/2', () => {
    const { ce, calls, reset } = setup();
    const list = ce.parse(COMPREHENSION(10)).N();
    let elements = 0;
    let last: string | undefined;
    for (const el of list.each()) {
      elements += 1;
      last = el.N().toString();
    }
    expect(elements).toBe(11);
    // 55 before the memo outlived the evaluation.
    expect(calls()).toBe(10);
    // The pull evaluated each element EXACTLY (the lazy list's numeric wrapper
    // numericizes the exact value), so the memo holds exact entries. A
    // numeric request of the same application misses its own key and runs
    // the body once more, where the exact chain below it is answered from
    // the memo: one step call, not ten. The exact result of a memoized
    // application cannot be numericized outside its call frame
    // (`evaluateInOwnBindings` resolves free symbols through the chain in
    // force), which is why the numeric key is not answered from the exact
    // entry.
    reset();
    expect(last).toBe(ce.parse('P\\left(10\\right)').N().toString());
    expect(calls()).toBeLessThanOrEqual(1);
  });

  test('a later top-level evaluation is answered from the memo, on both routes', () => {
    const { ce, calls, reset } = setup();
    ce.parse('P\\left(10\\right)').N();
    expect(calls()).toBe(10);
    reset();
    ce.parse('P\\left(10\\right)').N();
    expect(calls()).toBe(0);
    // The numeric request stored its exact result too.
    ce.parse('P\\left(10\\right)').evaluate();
    expect(calls()).toBe(0);
    // A deeper application reuses the memoized levels below it.
    ce.parse('P\\left(12\\right)').N();
    expect(calls()).toBe(2);
  });

  test('an assignment between two evaluations still invalidates the memo', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'real');
    ce.assign('c', 1);
    ce.parse(String.raw`Q(k) := \{ k = 0: c, k > 0: Q(k-1) + c \}`).evaluate();
    expect(ce.parse('Q(4)').N().re).toBe(5);
    ce.assign('c', 10);
    expect(ce.parse('Q(4)').N().re).toBe(50);
    expect(ce.parse('Q(4)').evaluate().re).toBe(50);
  });

  test('a redefinition of the recursive function between two evaluations is honored', () => {
    const { ce } = setup();
    expect(ce.parse('P\\left(3\\right)').N().toString()).toBe(
      ce.box(['s', ['s', ['s', ['Tuple', 0, 0]]]]).N().toString()
    );
    ce.assign(
      'P',
      ce.box([
        'Function',
        ['Which', ['Equal', 'i', 0], ['Tuple', 1, 1], 'True', ['s', ['P', ['Subtract', 'i', 1]]]],
        'i',
      ])
    );
    expect(ce.parse('P\\left(3\\right)').N().toString()).toBe(
      ce.box(['s', ['s', ['s', ['Tuple', 1, 1]]]]).N().toString()
    );
  });

  test('an unrelated assignment between two element pulls keeps the memo warm', () => {
    const { ce, calls, reset } = setup();
    ce.parse('P\\left(5\\right)').N();
    expect(calls()).toBe(5);
    reset();
    // A value write advances the `semantic` axis but not the `world` one, and
    // `P`'s body does not read this symbol, so its dependency snapshot is
    // unmoved. The memo must survive: a `semantic` stamp emptied it for every
    // assignment made anywhere in the engine, so an assignment between two
    // element pulls of a lazy collection restarted the recursion.
    ce.declare('unrelated', 'real');
    ce.assign('unrelated', 1);
    ce.parse('P\\left(6\\right)').N();
    expect(calls()).toBe(1);
  });

  test('a field store is seen through a cached node that applies an object-reading function', () => {
    // The nested hit → store → re-hit shape of the object dependency channel
    // (`boxed-expression/object-deps.ts`), composed with the application
    // memo. `f(1)` reads `p.age`, and the `Append` node below caches its
    // evaluated value with `f(1)` inside it. A field store advances no
    // engine-wide axis, so only the object dependency channel can make the
    // second read of the same node answer 11.
    //
    // What keeps this correct: the application memo stores NOTHING for a
    // literal that can reach an object (`snapshotMemoDeps` refuses it), so
    // `f(1)` really reads the field inside the `Append` evaluation and the
    // node's cache entry records the dependency itself. The memo takes no
    // part in the object dependency channel; relaxing that refusal requires
    // wiring it in first (`IComputeEngine._applicationMemo`), and this test
    // is what fails otherwise.
    const ce = new ComputeEngine();
    const run = (source: string): string => {
      const { value, diagnostics } = executeEpsil(ce, source);
      expect(diagnostics).toEqual([]);
      return String(value);
    };
    expect(
      run(`type Person = object{name: string, age: integer}
let p = Person(name: "Alan", age: 42)
f(t) = t + p.age
f(1)`)
    ).toBe('43');

    const e = ce.box(['Append', ['Range', 1, 3], ['f', 1]]);
    expect([...e.evaluate().each()].map((x) => x.toString())).toEqual([
      '1',
      '2',
      '3',
      '43',
    ]);

    expect(run('p.age = 10')).toBe('10');

    // The SAME node, so its own cached value is what answers unless the
    // store invalidated it.
    expect([...e.evaluate().each()].map((x) => x.toString())).toEqual([
      '1',
      '2',
      '3',
      '11',
    ]);
  });

  test('an application that returns an object is never memoized', () => {
    // A memoized object would be handed to both callers, so the store below
    // would show in the other result; the entry would also keep the object
    // alive for as long as the function literal lives (ruling B12). What
    // keeps this correct: constructing an object is a `state` effect, so the
    // body is impure and never memoized at all. The memo has no refusal of
    // its own for a value that holds an object; making construction pure
    // requires adding one first, and this test is what fails otherwise.
    const ce = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(
      ce,
      `type Person = object{name: string, age: integer}
g(n) = Person(name: "x", age: n)
let a = g(1)
let b = g(1)
a.age = 99
b.age`
    );
    expect(diagnostics).toEqual([]);
    expect(String(value)).toBe('1');
  });
});
