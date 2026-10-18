import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';
import { isStackOverflow } from '../../src/compute-engine/engine-runtime-state';

// A runaway user-function recursion must end with the engine's documented
// error, `CancellationError` with the cause `recursion-depth-exceeded`, also
// when the JavaScript stack is full before the depth reaches
// `recursionLimit`. Each level of `f(n) := n f(n-1)` uses about 4 KB of the
// JavaScript stack, so with the default limit (256) and the default stack of
// Node (about 1 MB) the stack overflowed at a depth of about 230, and the
// caller got a bare `RangeError: Maximum call stack size exceeded`.

/** The error that `fn` throws, or `undefined`. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

function expectRecursionError(e: unknown): void {
  expect(e).toBeInstanceOf(CancellationError);
  expect((e as CancellationError).cause).toBe('recursion-depth-exceeded');
  expect((e as Error).message).toBe('Recursion limit exceeded');
}

/** Run `fn` below `k` extra JavaScript frames, so that the point where the
 * stack is full moves through the frames of a level of the recursion. */
function belowFrames<T>(k: number, fn: () => T): T {
  return k <= 0 ? fn() : belowFrames(k - 1, fn);
}

/** A recursion with a base case, to check that the engine still works. */
function defineFactorial(ce: ComputeEngine): void {
  ce.declare('g', 'function');
  ce.parse(
    'g(n) := \\operatorname{If}(n \\le 1, 1, n\\cdot g(n-1))'
  ).evaluate();
}

describe('THE ENGINE STATE AFTER A RUNAWAY RECURSION', () => {
  // This test is the first of the file: it must run before the other tests
  // make the JavaScript engine optimize the code of the evaluation. When the
  // stack overflowed in that unoptimized code, the `finally` blocks of
  // several levels near the overflow could not run, and their evaluation
  // contexts stayed on the stack.
  test('the engine state is restored wherever the stack is full', () => {
    // The limit is so high that the stack is full before the depth reaches
    // it. The point where the stack is full moves by one small frame at each
    // run. After each run the evaluation-context stack has its initial
    // length and a recursion with a base case gives the correct value.
    const ce = new ComputeEngine();
    ce.recursionLimit = 1_000_000;
    ce.parse('f(n) := n f(n-1)').evaluate();
    defineFactorial(ce);
    const contexts = ce._evalContextStack.length;
    const results = new Set<string>();
    for (let k = 0; k < 60; k++) {
      const e = thrown(() => belowFrames(k, () => ce.box(['f', 2]).evaluate()));
      results.add(e instanceof CancellationError ? String(e.cause) : String(e));
      expect(ce._evalContextStack.length).toBe(contexts);
      expect(ce.box(['g', 5]).evaluate().toString()).toBe('120');
    }
    expect([...results]).toEqual(['recursion-depth-exceeded']);
  });
});

describe('A RUNAWAY RECURSION AT THE DEFAULT LIMIT', () => {
  test('the default limit is 256', () => {
    expect(new ComputeEngine().recursionLimit).toBe(256);
  });

  test('f(n) := n f(n-1), parse route', () => {
    const ce = new ComputeEngine();
    ce.parse('f(n) := n f(n-1)').evaluate();
    expectRecursionError(thrown(() => ce.parse('f(2)').evaluate()));
  });

  test('f(n) := n f(n-1), box route', () => {
    const ce = new ComputeEngine();
    ce.parse('f(n) := n f(n-1)').evaluate();
    expectRecursionError(thrown(() => ce.box(['f', 2]).evaluate()));
  });

  test('f(n) := n f(n-1), numeric approximation', () => {
    const ce = new ComputeEngine();
    ce.parse('f(n) := n f(n-1)').evaluate();
    expectRecursionError(thrown(() => ce.parse('f(2)').N()));
  });

  test('a body with a \\text{…} node: h(n) := \\text{T}(n ≤ 1, 1, n h(n-1))', () => {
    const ce = new ComputeEngine();
    ce.parse('h(n) := \\text{T}(n \\le 1, 1, n h(n-1))').evaluate();
    expectRecursionError(thrown(() => ce.box(['h', 2]).evaluate()));
  });

  test('mutual recursion through two user functions', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'function');
    ce.declare('q', 'function');
    ce.parse('p(n) := q(n)').evaluate();
    ce.parse('q(n) := n p(n-1)').evaluate();
    expectRecursionError(thrown(() => ce.box(['p', 2]).evaluate()));
  });

  test('a recursion through a non-lazy operator: s(n) := √(s(n-1))', () => {
    const ce = new ComputeEngine();
    ce.parse('s(n) := \\sqrt{s(n-1)}').evaluate();
    expectRecursionError(thrown(() => ce.box(['s', 2]).evaluate()));
  });

  test('a recursion with a base case still reaches a depth of 100', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'function');
    ce.parse('t(n) := \\operatorname{If}(n \\le 0, 0, 1 + t(n-1))').evaluate();
    expect(ce.box(['t', 100]).evaluate().toString()).toBe('100');
  });
});

describe('A STACK OVERFLOW IN A HANDLER CALLED FROM A USER FUNCTION', () => {
  // A lazy operator lets an exception of its handler through (a non-lazy
  // built-in handler turns a native fault into an `internal-error` value).
  function engine(throwIt: (n: number) => never): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('ThrowIt', {
      lazy: true,
      signature: '(any) -> any',
      evaluate: (ops) => throwIt(ops[0].re),
    });
    ce.declare('u', 'function');
    ce.parse('u(n) := 1 + \\operatorname{ThrowIt}(n)').evaluate();
    return ce;
  }

  test('a real stack overflow is the recursion error', () => {
    const deep = (n: number): never => deep(n + 1);
    const ce = engine(deep);
    expectRecursionError(thrown(() => ce.box(['u', 1]).evaluate()));
    defineFactorial(ce);
    expect(ce.box(['g', 5]).evaluate().toString()).toBe('120');
  });

  test('another RangeError is not converted', () => {
    const ce = engine(() => {
      throw new RangeError('Invalid array length');
    });
    const e = thrown(() => ce.box(['u', 1]).evaluate());
    expect(e).toBeInstanceOf(RangeError);
    expect((e as Error).message).toBe('Invalid array length');
  });
});

describe('isStackOverflow', () => {
  test('V8 and JavaScriptCore: a RangeError about the call stack', () => {
    expect(
      isStackOverflow(new RangeError('Maximum call stack size exceeded'))
    ).toBe(true);
    expect(
      isStackOverflow(new RangeError('Maximum call stack size exceeded.'))
    ).toBe(true);
  });

  test('SpiderMonkey: an InternalError "too much recursion"', () => {
    const e = new Error('too much recursion');
    e.name = 'InternalError';
    expect(isStackOverflow(e)).toBe(true);
  });

  test('other errors', () => {
    expect(isStackOverflow(new RangeError('Invalid array length'))).toBe(false);
    expect(isStackOverflow(new Error('Maximum call stack size exceeded'))).toBe(
      false
    );
    expect(isStackOverflow('Maximum call stack size exceeded')).toBe(false);
    expect(isStackOverflow(undefined)).toBe(false);
  });
});

describe('A RUNAWAY RECURSION ON THE ASYNCHRONOUS ROUTE', () => {
  // Each level of the recursion awaits its statements, so the counter of the
  // synchronous route was released before the next level started: the
  // recursion never ended, and the process ran out of memory. `Tick`, in the
  // argument of the recursive call, counts the levels and ends the test with
  // another error if the limit does not.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    let ticks = 0;
    ce.declare('Tick', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        ticks += 1;
        if (ticks > 1000) throw new Error('The recursion did not stop');
        return x;
      },
    });
    ce.declare('f', 'function');
    ce.parse('f(n) := n f(\\operatorname{Tick}(n)-1)').evaluate();
    return ce;
  }

  test('f(n) := n f(Tick(n)-1) with a limit of 20', async () => {
    const ce = engine();
    ce.recursionLimit = 20;
    const contexts = ce._evalContextStack.length;
    let error: unknown;
    try {
      await ce.box(['f', 2]).evaluateAsync();
    } catch (e) {
      error = e;
    }
    expectRecursionError(error);
    expect(ce._evalContextStack.length).toBe(contexts);
  });

  test('f(n) := n f(Tick(n)-1) at the default limit, parse route', async () => {
    const ce = engine();
    let error: unknown;
    try {
      await ce.parse('f(2)').evaluateAsync();
    } catch (e) {
      error = e;
    }
    expectRecursionError(error);
  });

  test('a recursion with a base case completes', async () => {
    const ce = new ComputeEngine();
    ce.recursionLimit = 20;
    defineFactorial(ce);
    expect((await ce.box(['g', 10]).evaluateAsync()).toString()).toBe(
      '3628800'
    );
  });
});
