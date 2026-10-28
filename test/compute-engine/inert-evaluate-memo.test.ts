import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

// An already-evaluated INERT tree — a value that stayed symbolic — answers a
// second `evaluate()` at the same state without walking the tree again: the
// evaluate memo of a lazy collection view (`_memoizedLazyCollectionValue`,
// `boxed-expression/boxed-function.ts`) also serves an ordinary canonical
// function node on the synchronous route under the default options, and
// keeps a symbolic, non-collection result (`_isMemoizableInertEvaluation`).
// User ruling 2026-10-17 (Tycho ledger row 380): a user function applied to
// its own result, `f^k(P)`, whose body reads its argument four times, embedded
// the previous level's inert value four times and re-walked it on every read,
// so the cost grew fourfold per level (1.9 s at depth 7, out of heap at 8).

/** An operator that counts its calls and always declines, so a call to it
 * stays inert. */
function countingDecline(ce: ComputeEngine, name: string): { calls: number } {
  const counter = { calls: 0 };
  ce.declare(name, {
    signature: '(number) -> number',
    evaluate: () => {
      counter.calls += 1;
      return undefined;
    },
  });
  return counter;
}

describe('an inert result is not walked again at the same state', () => {
  test('a second evaluate() of an inert node runs no handler', () => {
    const ce = new ComputeEngine();
    const q = countingDecline(ce, 'q');
    ce.declare('x', 'real');
    const e = ce.box(['Add', ['q', 'x'], 1]);
    const r1 = e.evaluate();
    expect(r1.toString()).toBe('q(x) + 1');
    expect(q.calls).toBe(1);
    e.evaluate();
    expect(q.calls).toBe(1);
    // The result is a value. The `Add` around the inert `q(x)` is rebuilt
    // each time: `Add` is a lazy head (its canonical handler folds the
    // numbers), and the memo keeps the lazy-collection contract of not
    // serving a lazy head. The `q(x)` of the result is written as the `q(x)`
    // of `e`, so it received the memo entry of that node when `e` was
    // evaluated (`_primeUnchangedResult`), and it answers from it: `q` is not
    // called again (ROADMAP CE-603; it was called once more before).
    const r2 = r1.evaluate();
    expect(r2.isSame(r1)).toBe(true);
    expect(q.calls).toBe(1);
    r1.evaluate();
    expect(q.calls).toBe(1);
  });

  test('a value write makes the node evaluate again', () => {
    const ce = new ComputeEngine();
    const q = countingDecline(ce, 'q');
    ce.declare('x', 'real');
    const e = ce.box(['Add', ['q', 'x'], 1]);
    e.evaluate();
    ce.assign('x', 2);
    expect(e.evaluate().isSame(ce.box(['Add', ['q', 2], 1]))).toBe(true);
    expect(q.calls).toBe(2);
  });

  test('a numeric approximation is not served from the memo', () => {
    const ce = new ComputeEngine();
    const q = countingDecline(ce, 'q');
    ce.declare('x', 'real');
    const e = ce.box(['Add', ['q', 'x'], 1]);
    e.evaluate();
    e.N();
    e.N();
    expect(q.calls).toBe(3);
  });

  test('a call with constant operands follows a write to a free variable of the body', () => {
    // Constant operands do not make the evaluation constant: the body reads
    // `x`, and a value write advances the generation, not the world epoch.
    // A constant (generation-independent) entry answered `x + 1` after the
    // write.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('f', ce.box(['Function', ['Block', ['Add', 'u', 'x']], 'u']));
    const e = ce.box(['f', 1]);
    expect(e.evaluate().toString()).toBe('x + 1');
    ce.assign('x', 2);
    expect(e.evaluate().toString()).toBe('3');
  });

  test('a handler result is not primed as its own value', () => {
    // An evaluate handler returns its expression without evaluating it:
    // `f(1)` answers `g(1)`, and `g(1)` evaluates to `2`. Priming `g(1)`
    // with itself would freeze the unevaluated call.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('g', {
      signature: '(number) -> number',
      evaluate: () => {
        calls += 1;
        return ce.number(2);
      },
    });
    ce.declare('f', {
      signature: '(number) -> number',
      evaluate: () => ce.function('g', [ce.number(1)]),
    });
    const r = ce.box(['f', 1]).evaluate();
    expect(r.toString()).toBe('g(1)');
    expect(r.evaluate().toString()).toBe('2');
    expect(calls).toBe(1);
  });

  test('an operator with only an asynchronous handler stays inert under evaluate() and runs under evaluateAsync()', async () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('asrc', {
      signature: '(integer) -> integer',
      evaluateAsync: async () => {
        calls += 1;
        return ce.number(7);
      },
    });
    const e = ce.box(['asrc', 1]);
    expect(e.evaluate().toString()).toBe('asrc(1)');
    expect(calls).toBe(0);
    // The inert entry of the synchronous route is not served here.
    expect((await e.evaluateAsync()).toString()).toBe('7');
    expect(calls).toBe(1);
  });

  test('a redefinition of the head is seen by a call with constant operands', () => {
    const ce = new ComputeEngine();
    const q = countingDecline(ce, 'q');
    ce.assign(
      'g',
      ce.box(['Function', ['Block', ['Add', ['q', 'u'], 1]], 'u'])
    );
    const e = ce.box(['g', 2]);
    expect(e.evaluate().isSame(ce.box(['Add', ['q', 2], 1]))).toBe(true);
    expect(q.calls).toBe(1);
    ce.assign('g', ce.box(['Function', ['Block', ['Multiply', 3, 'u']], 'u']));
    expect(e.evaluate().toString()).toBe('6');
  });

  test('a transient configuration window neither reads nor writes the memo', () => {
    // `_withTransientAngularUnit` and `_withTransientPrecision` change what
    // a node evaluates to and advance no version the memo keys on, so the
    // memo is bypassed inside the window, as the other value memos do.
    const ce = new ComputeEngine();
    const engine = ce as unknown as {
      _withTransientAngularUnit<T>(unit: string, f: () => T): T;
    };
    const e = ce.box(['Sin', 30]);
    expect(e.evaluate().toString()).toBe('sin(30)');
    // The entry stored outside (radians) is not served inside the window.
    expect(
      engine._withTransientAngularUnit('deg', () => e.evaluate()).toString()
    ).toBe('1/2');
    // The value computed inside is not served after it.
    expect(e.evaluate().toString()).toBe('sin(30)');
    const f = ce.box(['Cos', 60]);
    expect(
      engine._withTransientAngularUnit('deg', () => f.evaluate()).toString()
    ).toBe('1/2');
    expect(f.evaluate().toString()).toBe('cos(60)');
    // The write direction, with a SYMBOLIC value inside the window (a number
    // is never stored, so the cases above do not test the store): in a
    // degree-mode engine `Sin(30)` stays `sin(30)` inside a radian window,
    // and must not be served outside, where it is `1/2`.
    const deg = new ComputeEngine();
    deg.angularUnit = 'deg';
    const degEngine = deg as unknown as {
      _withTransientAngularUnit<T>(unit: string, f: () => T): T;
    };
    const g = deg.box(['Sin', 30]);
    expect(
      degEngine._withTransientAngularUnit('rad', () => g.evaluate()).toString()
    ).toBe('sin(30)');
    expect(g.evaluate().toString()).toBe('1/2');
  });

  test('a change of the collection cap re-evaluates a call that declined under it', () => {
    // `StringMatchAll` declines above `maxCollectionSize` and answers the
    // symbolic call, which the memo keeps. The cap is configuration: a change
    // advances the configuration versions, so the call is evaluated again.
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 1;
    const e = ce.box(['StringMatchAll', "'aa'", ['RegExp', "'a'"]]);
    expect(e.evaluate().toString()).toBe('StringMatchAll("aa", RegExp("a"))');
    ce.maxCollectionSize = 10;
    const matches = e.evaluate();
    expect(matches.operator).toBe('List');
    expect((matches as unknown as { nops: number }).nops).toBe(2);
  });

  test('a user function applied to its own inert result walks each level once', () => {
    // The row-380 shape with a counting operator in the body: `f` reads `v`
    // four times, and `q(a)` in the body stays inert, so the result of each
    // level is an inert tree that holds the previous level's result. Without
    // the memo the calls to `q` grew fourfold per level.
    const ce = new ComputeEngine();
    const q = countingDecline(ce, 'q');
    ce.declare('a', 'real');
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'Block',
          [
            'PointList',
            [
              'Subtract',
              ['q', 'a'],
              ['Multiply', ['PointY', 'v'], ['PointX', 'v']],
            ],
            ['Add', ['PointX', 'v'], ['PointY', 'v']],
            ['q', 'a'],
          ],
        ],
        'v',
      ])
    );
    const counts: number[] = [];
    for (let depth = 1; depth <= 6; depth++) {
      let e: unknown = ['Tuple', 1, 2, 3];
      for (let k = 0; k < depth; k++) e = ['f', e];
      q.calls = 0;
      ce.box(e as never).evaluate();
      counts.push(q.calls);
    }
    // Each level evaluates its own reads and walks the previous levels'
    // trees once each: the calls grow by a bounded amount per level
    // (measured 2, 8, 16, 27, 41, 58). Without the memo they grew by a factor
    // close to two per level (2, 14, 31, 58, 100, 182).
    expect(counts[5]).toBeLessThan(80);
    expect(counts[5] / counts[4]).toBeLessThan(1.6);
  });
});

/** The number of distinct nodes of an expression that may share its
 * operands: each node is counted once however many paths reach it. */
function distinctNodes(e: Expression): number {
  const seen = new Set<Expression>();
  const walk = (x: Expression): void => {
    if (seen.has(x)) return;
    seen.add(x);
    if (isFunction(x)) for (const op of x.ops) walk(op);
  };
  walk(e);
  return seen.size;
}

/** Does the expression hold a node with this operator, at any depth? */
function holdsOperator(e: Expression, operator: string): boolean {
  if (!isFunction(e)) return false;
  if (e.operator === operator) return true;
  return e.ops.some((op) => holdsOperator(op, operator));
}

describe('the closure capture of a call result keeps its sharing', () => {
  // A call's result is walked by the closure capture (`captureClosures`,
  // `function-utils.ts`) so that a function literal inside it closes over the
  // call frame. The walk rebuilds every node above such a literal, and it
  // memoizes the rebuild of each node per frame so that a node the result
  // mentions twice is rebuilt once. The memo lost its entries as the
  // recursion unwound (the per-frame map read before the recursion was
  // replaced by a fresh one after it, found 2026-10-17 by the chain of
  // Tycho ledger row 380): a node reached through two mentions of a
  // parameter was rebuilt once per mention, and a chain `f^k(P)` whose
  // value holds a lazy `Map` (a function literal) doubled its distinct nodes
  // at every level although the inert memo above walked each level once:
  // 864, 954, 1236, 1938, 3515, 6875 at depths 1 to 6 of the Tycho
  // reproduction (101 points), and 54, 168, 483, 1229, 2870, 6334 for the
  // smaller chain of the second test below.
  const lazyPointList = (ce: ComputeEngine): Expression => {
    // `a` is a lazy `Map` over a `Range` whose length is not known, so it is
    // a function literal inside the value, and `s` is collection-typed
    // without a value, so `PointList` stays inert.
    ce.declare('N', 'real');
    ce.declare('a', { type: 'list<number>' });
    ce.assign(
      'a',
      ce.box([
        'Map',
        ['Function', ['Divide', ['Multiply', 5, 'i'], 'N'], 'i'],
        ['Range', 0, 'N'],
      ])
    );
    ce.declare('s', { type: 'list<number>' });
    return ce.box(['PointList', 's', 'a']).evaluate();
  };

  test('a node reached through two mentions of a parameter is rebuilt once', () => {
    const ce = new ComputeEngine();
    const head = lazyPointList(ce);
    ce.assign(
      'g',
      ce.box(['Function', ['Tuple', ['PointY', 'w'], ['PointY', 'w']], 'w'])
    );
    // The precondition of the test: the head holds a function literal, so
    // the capture rebuilds it (a head with none is returned as it is, and
    // the identity below would hold without the memo).
    expect(holdsOperator(head, 'Function')).toBe(true);
    const t = ce.box(['g', head]).evaluate();
    expect(t.operator).toBe('Tuple');
    if (!isFunction(t) || !isFunction(t.op1) || !isFunction(t.op2))
      throw new Error('expected a tuple of two accessor reads');
    expect(t.op1.op1.operator).toBe('PointList');
    expect(t.op1.op1).not.toBe(head);
    expect(t.op1.op1).toBe(t.op2.op1);
  });

  test('a user function applied to its own result that holds a function literal adds a bounded number of nodes per level', () => {
    const ce = new ComputeEngine();
    const head = lazyPointList(ce);
    ce.declare('b', 'real');
    // The row-380 body: `f` reads `v` four times.
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'PointList',
          [
            'Subtract',
            'a',
            [
              'Multiply',
              ['PointY', 'v'],
              [
                'Add',
                ['Multiply', 'b', ['PointX', 'v']],
                ['Multiply', ['Subtract', 1, 'b'], ['PointY', 'v']],
              ],
            ],
          ],
          [
            'Add',
            ['PointX', 'v'],
            ['Divide', ['Power', ['PointY', 'v'], 2], 100],
          ],
          'a',
        ],
        'v',
      ])
    );
    const nodes: number[] = [];
    let e: Expression = head;
    for (let depth = 1; depth <= 6; depth++) {
      e = ce.box(['f', e]).evaluate();
      expect(e.operator).toBe('PointList');
      nodes.push(distinctNodes(e));
    }
    // Measured 2026-10-17 on this chain at depths 1 to 6: 39, 60, 95, 144,
    // 207, 284 nodes once the capture memo keeps its entries and the
    // capture keeps a literal that the re-rooting would not change
    // (`rerootingIsNoop`), against 54, 168, 483, 1229, 2870, 6334 before (a
    // doubling per level, each mention of `v` its own copy). The previous
    // level is shared; the growth that remains (14 more nodes per level at
    // each level) is the inert evaluation memo retired by the `any` advance
    // of each call's parameter activation, so that each level walks the
    // previous level once and copies the nodes it rebuilds — see the
    // `ROADMAP.md` entry on the per-call advance.
    for (let k = 1; k < nodes.length; k++)
      expect(nodes[k] - nodes[k - 1]).toBeLessThan(40 + 20 * k);
    expect(nodes[5]).toBeLessThan(500);
  });
});
