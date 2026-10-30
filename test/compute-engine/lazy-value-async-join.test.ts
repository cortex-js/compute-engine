import { ComputeEngine } from '../../src/compute-engine';

// Concurrent `evaluateAsync()` calls of one lazy collection node share one
// walk (`_memoizedLazyCollectionValueAsync`, `boxed-function.ts`).

/** A pure host operator `p` with an asynchronous handler, which counts its
 * calls. */
function engineWithAsyncP(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('p', {
    signature: '() -> integer',
    pure: true,
    evaluateAsync: async (_ops, { engine }) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return engine.number(7);
    },
  });
  return { ce, calls: () => calls };
}

describe('A JOINED ASYNCHRONOUS WALK', () => {
  test('a rejected walk does not reject the callers that joined it', async () => {
    // The first call of `p` rejects, the later ones give 7. Two independent
    // evaluations give one rejection and one value; so do two joined ones.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('p', {
      signature: '() -> integer',
      pure: true,
      evaluateAsync: async (_ops, { engine }) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (calls === 1) throw new Error('first call fails');
        return engine.number(7);
      },
    });
    const node = ce.box(['Reverse', ['List', 1, ['p']]]);
    const results = await Promise.allSettled([
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(
      (
        results[1] as PromiseFulfilledResult<{ toString(): string }>
      ).value.toString()
    ).toBe('[7,1]');
    expect(calls).toBe(2);
  });

  test('callers that joined a walk share its value', async () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('p', {
      signature: '() -> integer',
      pure: true,
      evaluate: (_ops, { engine }) => {
        calls += 1;
        return engine.number(7);
      },
    });
    const node = ce.box(['Reverse', ['List', 1, ['p']]]);
    const results = await Promise.all([
      node.evaluateAsync(),
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    expect(results.map((r) => r.toString())).toEqual([
      '[7,1]',
      '[7,1]',
      '[7,1]',
    ]);
    expect(calls).toBe(1);
  });

  test('two top-level reads of a view over an asynchronous operator share one walk', async () => {
    const { ce, calls } = engineWithAsyncP();
    const list = ce.box(['Reverse', ['List', 2, ['p']]]);
    const results = await Promise.all([
      list.evaluateAsync(),
      list.evaluateAsync(),
    ]);
    expect(results.map((r) => r.toString())).toEqual(['[7,2]', '[7,2]']);
    expect(calls()).toBe(1);
  });
});

// A walk whose value is not kept in the memo can still give its value to the
// callers that joined it. The rule (`LazyWalkOutcome`, `boxed-function.ts`):
// the walk passed its store guard and read no field of a mutable object.
describe('A JOINED WALK WHOSE VALUE IS NOT KEPT IN THE MEMO', () => {
  /** An engine with a host operator `p` (asynchronous, counted) and a
   * mutable object `o`. `pure` is the purity that `p` states, if any. */
  function setup(pure: boolean | undefined) {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('p', {
      signature: '() -> integer',
      ...(pure === undefined ? {} : { pure }),
      evaluateAsync: async (_ops, { engine }) => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return engine.number(7);
      },
    });
    const o = ce._object('T', { a: ce.number(1) });
    return { ce, o, calls: () => calls };
  }

  test('a value that holds a mutable object is shared when the source is pure', async () => {
    const { ce, o, calls } = setup(true);
    // The value holds `o`, so the memo does not keep it.
    const node = ce.function('Reverse', [
      ce.function('List', [o, ce.box(['p'])]),
    ]);
    const results = await Promise.all([
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    expect(results.map((r) => r.toString())).toEqual([
      '[7,T(a: 1)]',
      '[7,T(a: 1)]',
    ]);
    expect(calls()).toBe(1);
  });

  test('a value that holds a mutable object is not shared when the source does not state its purity', async () => {
    const { ce, o, calls } = setup(undefined);
    const node = ce.function('Reverse', [
      ce.function('List', [o, ce.box(['p'])]),
    ]);
    await Promise.all([node.evaluateAsync(), node.evaluateAsync()]);
    expect(calls()).toBe(2);
  });

  test('a value derived from an object field is not shared', async () => {
    // The asynchronous walk cannot record which objects its value depends
    // on, and an object can change before the joined caller resumes.
    const { ce, o, calls } = setup(true);
    ce.declare('o', { value: o } as any);
    const node = ce.box(['Reverse', ['List', ['Field', 'o', "'a'"], ['p']]]);
    const results = await Promise.all([
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    expect(results.map((r) => r.toString())).toEqual(['[7,1]', '[7,1]']);
    expect(calls()).toBe(2);
  });
});

// Two evaluations of a node that is not pure give two values, on the
// asynchronous route as on the synchronous route: such a node does not use
// the in-flight slot of the memo.
describe('CONCURRENT EVALUATIONS OF A NODE THAT IS NOT PURE', () => {
  test('an operator declared impure is called by each caller', async () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('p', {
      signature: '() -> integer',
      pure: false,
      evaluate: (_ops, { engine }) => engine.number(++calls),
    });
    const node = ce.box(['Reverse', ['List', 1, ['p']]]);
    expect(node.evaluate().toString()).toBe('[1,1]');
    expect(node.evaluate().toString()).toBe('[2,1]');
    const results = await Promise.all([
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    expect(results.map((r) => r.toString()).sort()).toEqual(['[3,1]', '[4,1]']);
    expect(calls).toBe(4);
  });

  test('`Random()` is drawn by each caller', async () => {
    const ce = new ComputeEngine();
    const node = ce.box(['Reverse', ['List', 1, ['Random']]]);
    const [a, b] = await Promise.all([
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    // Two draws of `Random()` are equal with probability about 2^-52.
    expect(a.toString()).not.toBe(b.toString());
  });
});

// The memo keeps the value of a view whose operands are all constant with no
// generation, so that no assignment makes it out of date. A call of a user
// function is not constant in that sense, although its `isConstant` is true:
// its value changes when a free symbol of the body, or the function, is
// assigned (`BoxedFunction._hasConstantValue()`).
describe('A VIEW OVER A CALL OF A USER FUNCTION', () => {
  const fn = (ce: ComputeEngine, body: unknown, ...params: string[]) =>
    ce.box(['Function', body, ...params] as any);

  test('follows an assignment of a free symbol of the body', async () => {
    const ce = new ComputeEngine();
    ce.declare('x', { value: 1 } as any);
    ce.declare('f', 'function');
    ce.assign('f', fn(ce, ['Add', 'u', 'x'], 'u'));
    const node = ce.box(['Reverse', ['List', 1, ['f', 1]]]);
    expect(node.evaluate().toString()).toBe('[2,1]');
    ce.assign('x', 5);
    expect(node.evaluate().toString()).toBe('[6,1]');
    ce.assign('x', 7);
    expect((await node.evaluateAsync()).toString()).toBe('[8,1]');
  });

  test('follows an assignment of the function', async () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', fn(ce, ['Add', 'x', 1], 'x'));
    const node = ce.box(['Reverse', ['List', 1, ['h', 2]]]);
    expect(node.evaluate().toString()).toBe('[3,1]');
    ce.assign('h', fn(ce, ['Add', 'x', 10], 'x'));
    expect(node.evaluate().toString()).toBe('[12,1]');
    ce.assign('h', fn(ce, ['Add', 'x', 20], 'x'));
    expect((await node.evaluateAsync()).toString()).toBe('[22,1]');
  });

  test('follows an assignment of a function that calls an impure operator', async () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('q', {
      signature: '() -> integer',
      pure: false,
      evaluate: (_ops, { engine }) => engine.number(++calls),
    });
    ce.declare('h', 'function');
    ce.assign('h', fn(ce, ['Add', 'x', 1], 'x'));
    const node = ce.box(['Reverse', ['List', 1, ['h', 2]]]);
    expect(node.evaluate().toString()).toBe('[3,1]');
    ce.assign('h', fn(ce, ['Add', 'x', ['q']], 'x'));
    expect(node.isPure).toBe(false);
    expect(node.evaluate().toString()).toBe('[3,1]');
    expect(node.evaluate().toString()).toBe('[4,1]');
    const results = await Promise.all([
      node.evaluateAsync(),
      node.evaluateAsync(),
    ]);
    expect(results.map((r) => r.toString()).sort()).toEqual(['[5,1]', '[6,1]']);
  });

  test('a view over library calls of constants still keeps its value with no generation', () => {
    const ce = new ComputeEngine();
    // An assignment moves the generation; the entry of the view is still
    // served, so it was stored with no generation.
    const node = ce.box(['Reverse', ['List', 1, ['Sqrt', 2]]]);
    node.evaluate();
    ce.assign('y', 1);
    ce._cacheStats.reset();
    ce._cacheStats.enabled = true;
    try {
      node.evaluate();
    } finally {
      ce._cacheStats.enabled = false;
    }
    expect(ce._cacheStats.snapshot().caches.lazyValue.hitConstant).toBe(1);
  });
});

describe('AN ASSIGNMENT WHILE A JOINED WALK WAITS', () => {
  test('the caller that joined reads the new value', async () => {
    // A starts the walk of `Reverse(List(y, p()))` and reads `y = 1`; B
    // joins it. `y := 5` while `p` waits. The generation moved, so B does
    // not use the value of A and runs its own walk, which reads `y = 5`.
    const ce = new ComputeEngine();
    let calls = 0;
    const waiters: (() => void)[] = [];
    let open = false;
    ce.declare('p', {
      signature: '() -> integer',
      pure: true,
      evaluateAsync: async (_ops, { engine }) => {
        calls += 1;
        if (!open) await new Promise<void>((resolve) => waiters.push(resolve));
        return engine.number(7);
      },
    });
    ce.declare('y', { value: 1 } as any);
    const node = ce.box(['Reverse', ['List', 'y', ['p']]]);
    const a = node.evaluateAsync();
    const b = node.evaluateAsync();
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    ce.assign('y', 5);
    open = true;
    waiters.splice(0).forEach((resolve) => resolve());
    expect((await a).toString()).toBe('[7,1]');
    expect((await b).toString()).toBe('[7,5]');
    expect(calls).toBe(2);
  });
});

// More cases of `_hasConstantValue()`: the constant key is for a view whose
// calls are all made with definitions of the standard library.
describe('A VIEW THAT READS A DEFINITION OF THE HOST OR A DICTIONARY', () => {
  function rootScope(ce: ComputeEngine) {
    let scope = ce.context.lexicalScope;
    while (scope.parent) scope = scope.parent;
    return scope;
  }

  test('an operator that the host declares in the system scope', () => {
    // The definition is bound in the outermost scope, as a definition of
    // the standard library is, but the host made it.
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.declare(
      'Foo',
      {
        signature: '(integer) -> integer',
        evaluate: ce.box(['Function', ['Add', 'u', 'x'], 'u']),
      } as any,
      { scope: rootScope(ce) } as any
    );
    const node = ce.box(['Reverse', ['List', 1, ['Foo', 1]]]);
    expect(node.evaluate().toString()).toBe('[2,1]');
    ce.assign('x', 5);
    expect(node.evaluate().toString()).toBe('[6,1]');
  });

  test('an extension of a library operator in the system scope', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.declare(
      'Abs',
      { evaluate: ce.box(['Function', ['Add', 'u', 'x'], 'u']) } as any,
      { scope: rootScope(ce), extend: true } as any
    );
    const node = ce.box(['Reverse', ['List', 1, ['Abs', 1]]]);
    expect(node.evaluate().toString()).toBe('[2,1]');
    ce.assign('x', 5);
    expect(node.evaluate().toString()).toBe('[6,1]');
  });

  test('a dictionary that holds the same dictionary under two keys is tested once per node', () => {
    // 30 levels of `{p: d, q: d}` have 2^30 paths and 31 distinct
    // dictionaries: the test of the memo key visits each node once.
    const ce = new ComputeEngine();
    let d = ce.box(['Add', 1, 2]);
    for (let i = 0; i < 30; i++)
      d = ce.function('Dictionary', [
        ce.function('KeyValuePair', [ce.string('p'), d]),
        ce.function('KeyValuePair', [ce.string('q'), d]),
      ]);
    const node = ce.function('Reverse', [
      ce.function('List', [ce.number(1), d]),
    ]);
    const start = Date.now();
    node.evaluate();
    node.evaluate();
    expect(Date.now() - start).toBeLessThan(5000);
  });

  test('a dictionary whose value calls a user function', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.declare('f', 'function');
    ce.assign('f', ce.box(['Function', ['Add', 'u', 'x'], 'u']));
    const node = ce.box([
      'Reverse',
      ['List', 1, ['Dictionary', ['KeyValuePair', "'a'", ['f', 1]]]],
    ]);
    expect(node.evaluate().toString()).toBe('[{"a" -> 2},1]');
    ce.assign('x', 5);
    expect(node.evaluate().toString()).toBe('[{"a" -> 6},1]');
  });
});
