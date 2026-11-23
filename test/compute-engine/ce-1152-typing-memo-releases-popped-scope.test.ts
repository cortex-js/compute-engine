import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { ComputeEngine as ComputeEngineClass } from '../../src/compute-engine';

// CE-1152: the static typing view memoizes, for each evaluation-context
// stack, the call frame that the last scan found (`innermostFrame()`,
// `static-typing-view.ts`). The memo held the innermost context of that
// scan strongly, so after a call that read a type under a scope that the
// host then popped, the memo kept the call's context, and through its
// scope chain the popped scope and its definitions, until a later scan
// under another context. The memo is now keyed weakly by the innermost
// context.

// `--expose-gc` set at run time gives a real collector to a fresh context,
// so the test needs no flag on the command line.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** The engine, loaded with the factor memo turned off: that memo keeps the
 * expressions it factored, with their scopes, for its own reasons
 * (CE-1722), and would hide the retention under test. */
function loadEngine(): typeof ComputeEngineClass {
  const saved = process.env.CE_CACHE_OFF;
  let engine: typeof ComputeEngineClass | undefined;
  try {
    process.env.CE_CACHE_OFF = 'factor';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      engine = require('../../src/compute-engine').ComputeEngine;
    });
  } finally {
    if (saved === undefined) delete process.env.CE_CACHE_OFF;
    else process.env.CE_CACHE_OFF = saved;
  }
  return engine!;
}

/** Yield to the event loop and collect, until `ref` is cleared, at most 20
 * times. A `WeakRef` keeps its target alive until the end of the job that
 * made or dereferenced it, and one collection does not always free
 * everything when many test workers load the machine. */
async function collectUntilCleared(ref: WeakRef<object>): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
    if (ref.deref() === undefined) return true;
  }
  return false;
}

describe('CE-1152: the typing memo does not keep a popped scope', () => {
  test('a scope popped after a call that read a type is collected', async () => {
    const ComputeEngine = loadEngine();
    const ce = new ComputeEngine();
    ce.pushScope();
    const scope = new WeakRef(ce.context.lexicalScope);
    // `g` calls `f`, whose body applies the undeclared `h`: the evaluation
    // reads types inside the call frames of the two literals.
    ce.assign('f', ce.box(['Function', ['Add', ['h', 'x'], 1], 'x']));
    ce.assign('g', ce.box(['Function', ['Add', ['f', 'x'], 1], 'x']));
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('2 + h(2)');
    ce.popScope();
    // Nothing runs under another scope before the collection. Before the
    // fix, the scope stayed until a later call read a type.
    expect(await collectUntilCleared(scope)).toBe(true);
    // The engine is still in use.
    expect(ce.box(['Add', 1, 2]).evaluate().toString()).toBe('3');
  });
});
