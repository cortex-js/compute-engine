import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/types';

// A type computation that runs during a call of a function literal reads the
// static view of the bindings (`static-typing-view.ts`): a parameter of the
// call has no value there. A type handler can still evaluate a node: the
// type of a call `self(self, Take(f, n))` reads whether the `Take` is finite,
// and the `isFinite` handler of `Take` evaluates the count `n`. The
// evaluation caches that key on the frame or on the lexical scope of the call
// (the memo of shared nodes, `shared-evaluation-memo.ts`, the lazy value memo
// of `BoxedFunction`, and the kept values of eager sources,
// `eager-source-values.ts`) must not keep a value computed there: the
// evaluation of the call that follows has the same key. The tests below cover
// the first two caches.
//
// Reported as https://github.com/cortex-js/compute-engine/issues/507
// (a regression in 0.176.0).

/** A function literal that counts the elements of `f` by dropping the last
 * one until none is left. `len` is the head that gives the length. */
function counter(len: (x: unknown) => unknown): unknown {
  return [
    'Function',
    [
      'If',
      ['Equal', len('f'), 0],
      0,
      ['Add', 1, ['self', 'self', ['Take', 'f', ['Subtract', len('f'), 1]]]],
    ],
    'self',
    'f',
  ];
}

function call(fn: unknown, n: number): unknown {
  return [fn, fn, ['List', ...Array.from({ length: n }, (_, i) => i + 7)]];
}

function count(ce: ComputeEngine, fn: unknown, n: number): unknown {
  return ce.box(call(fn, n) as any).evaluate().json;
}

async function countAsync(
  ce: ComputeEngine,
  fn: unknown,
  n: number
): Promise<unknown> {
  return (await ce.box(call(fn, n) as any).evaluateAsync()).json;
}

/** The functions of the two cases: `Len` gives a number, or the symbolic
 * `Box(n)` that `Unbox` reads back. `Box(n)` stays symbolic, so the lazy
 * value memo keeps the result of `Len(f)` (it keeps a symbolic result, not a
 * number). */
function numberCase(ce: ComputeEngine): unknown {
  declareLen(ce, '(any) -> integer', (n) => ce.number(n));
  return counter((x) => ['Len', x]);
}

function symbolicCase(ce: ComputeEngine): unknown {
  ce.declare('Box', {
    signature: '(integer) -> any',
    pure: true,
    evaluate: () => undefined,
  });
  ce.declare('Unbox', {
    signature: '(any) -> integer',
    pure: true,
    evaluate: ([x]) => (x.operator === 'Box' ? x.op1 : undefined),
  });
  declareLen(ce, '(any) -> any', (n) => ce.function('Box', [ce.number(n)]));
  return counter((x) => ['Unbox', ['Len', x]]);
}

/** A host `Len` that, like the `Length` of Wolfram, gives 0 for a symbol
 * with no value. `wrap` turns the length into the result. */
function declareLen(
  ce: ComputeEngine,
  signature: string,
  wrap: (n: number) => Expression
): void {
  ce.declare('Len', {
    signature,
    pure: true,
    evaluate: ([x]) =>
      x.isCollection && x.count !== undefined
        ? wrap(x.count)
        : x.symbol !== undefined && !x.isCollection
          ? wrap(0)
          : undefined,
  });
}

describe('evaluation memos inside a type computation of a call', () => {
  test('a number computed with an unbound parameter is not served to the call (memo of shared nodes)', () => {
    const ce = new ComputeEngine();
    const fn = numberCase(ce);
    expect([1, 2, 3, 4, 5].map((n) => count(ce, fn, n))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  test('a symbolic value computed with an unbound parameter is not served to the call (lazy value memo)', () => {
    const ce = new ComputeEngine();
    const fn = symbolicCase(ce);
    expect([1, 2, 3, 4, 5].map((n) => count(ce, fn, n))).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  test('the same two cases with evaluateAsync()', async () => {
    for (const make of [numberCase, symbolicCase]) {
      const ce = new ComputeEngine();
      const fn = make(ce);
      const counts: unknown[] = [];
      for (const n of [1, 2, 3, 4, 5]) counts.push(await countAsync(ce, fn, n));
      expect(counts).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
