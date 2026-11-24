// `applyEpsilAsync()`: the application of a function value that an earlier
// run of Epsil defined, with the debug hooks and the signal of
// `executeEpsilAsync()` (CE-1647).

import { ComputeEngine } from '../../src/compute-engine';
import {
  applyEpsilAsync,
  executeEpsil,
  type ExecuteEpsilResult,
} from '../../src/epsil/execute-epsil';
import type { EpsilDebugStatement } from '../../src/compute-engine/types-debug';

const CELL = `let a = 0
let cb = t => do {
  a = a + t
  a
}`;

/** An engine on which the cell `CELL` ran, and the value of `cb`. */
function cell(source = CELL) {
  const ce = new ComputeEngine();
  executeEpsil(ce, source, { url: 'cell' });
  return { ce, callback: ce.box('cb').evaluate() };
}

/** A line for each statement that calls `beforeStatement`. */
function line(at: EpsilDebugStatement): string {
  const text = (at.sourceContent ?? '').slice(at.range[0], at.range[1]);
  return `${at.sourceUrl}@${at.callDepth}:${text}`;
}

describe('applyEpsilAsync', () => {
  test('applies the callback and calls the hooks for its statements only', async () => {
    const { ce, callback } = cell();
    const before: string[] = [];
    const after: string[] = [];
    const result = await applyEpsilAsync(ce, callback, [ce.number(5)], {
      debug: {
        beforeStatement: (at) => void before.push(line(at)),
        afterStatement: (at, value) =>
          void after.push(`${line(at)} = ${value}`),
      },
    });
    expect(result.value.json).toBe(5);
    expect(result.diagnostics).toEqual([]);
    expect(before).toEqual(['cell@1:a = a + t', 'cell@1:a']);
    expect(after).toEqual(['cell@1:a = a + t = 5', 'cell@1:a = 5']);
    // The assignment changed the variable of the cell: a later cell reads it.
    expect(executeEpsil(ce, 'a').value.json).toBe(5);
    // The hooks are removed when the application ends.
    expect(ce._epsilDebugHooks).toBeUndefined();
    expect(ce._epsilDebugRun).toBeUndefined();
  });

  test('calls the hooks for the statements of a callback with no parameters', async () => {
    const { ce, callback } = cell(
      'let a = 0\nlet cb = () => do {\n  a = a + 1\n  a\n}'
    );
    const before: string[] = [];
    const result = await applyEpsilAsync(ce, callback, [], {
      debug: { beforeStatement: (at) => void before.push(line(at)) },
    });
    expect(result.value.json).toBe(1);
    expect(before).toEqual(['cell@1:a = a + 1', 'cell@1:a']);
  });

  test('applies a function by its name, with no hooks', async () => {
    const { ce } = cell('function f(x, y) {\n  x * y\n}');
    const result = await applyEpsilAsync(ce, ce.symbol('f'), [
      ce.number(6),
      ce.number(7),
    ]);
    expect(result.value.json).toBe(42);
  });

  test('a definition of the name `Apply` does not replace the application', async () => {
    const { ce, callback } = cell();
    ce.declare('Apply', {
      signature: '(any, any) -> integer',
      evaluate: () => ce.number(-1),
    });
    const result = await applyEpsilAsync(ce, callback, [ce.number(4)]);
    expect(result.value.json).toBe(4);
    expect(ce.box('a').evaluate().json).toBe(4);
  });

  test('a pending hook pauses the application', async () => {
    const { ce, callback } = cell();
    let resume!: () => void;
    let paused = false;
    const running = applyEpsilAsync(ce, callback, [ce.number(2)], {
      debug: {
        beforeStatement: (at) => {
          if (paused) return;
          paused = true;
          // The paused statement reads the scope of the call.
          expect(at.inScope(() => ce.box('t').evaluate().json)).toBe(2);
          return new Promise<void>((r) => (resume = r));
        },
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(paused).toBe(true);
    expect(ce.box('a').evaluate().json).toBe(0);
    resume();
    expect((await running).value.json).toBe(2);
  });

  test('a runtime problem is a value', async () => {
    const { ce } = cell('let g = s => do {\n  let n: integer = 1\n  n + s\n}');
    const result = await applyEpsilAsync(ce, ce.box('g').evaluate(), [
      ce.string('x'),
    ]);
    expect(result.value.operator).toBe('Error');
    expect(result.diagnostics).toEqual([]);
  });

  test('a hook that throws ends the application', async () => {
    const { ce, callback } = cell();
    const stop = new Error('stop');
    await expect(
      applyEpsilAsync(ce, callback, [ce.number(1)], {
        debug: {
          beforeStatement: () => {
            throw stop;
          },
        },
      })
    ).rejects.toBe(stop);
    expect(ce._epsilDebugHooks).toBeUndefined();
    expect(ce.box('a').evaluate().json).toBe(0);
  });

  test('an aborted signal rejects with a CancellationError', async () => {
    const { ce, callback } = cell();
    const controller = new AbortController();
    controller.abort('host');
    await expect(
      applyEpsilAsync(ce, callback, [ce.number(1)], {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'CancellationError', cause: 'host' });

    // An abort during a pause takes effect when the pause ends.
    const later = new AbortController();
    const running = applyEpsilAsync(ce, callback, [ce.number(1)], {
      signal: later.signal,
      debug: {
        beforeStatement: () => {
          later.abort('stopped');
          return new Promise<void>((r) => setTimeout(r, 5));
        },
      },
    });
    await expect(running).rejects.toMatchObject({
      name: 'CancellationError',
    });
    expect(ce._epsilDebugHooks).toBeUndefined();
  });

  test('a timeout is an error value with its cause, and a pause does not count', async () => {
    const { ce } = cell(
      'let spin = n => do {\n  while true {\n    n += 1\n  }\n}'
    );
    const spin = ce.box('spin').evaluate();
    let pending!: Promise<ExecuteEpsilResult>;
    ce.withTimeLimit({ ms: 50 }, () => {
      pending = applyEpsilAsync(ce, spin, [ce.number(0)]);
    });
    const result = await pending;
    expect(result.value.operator).toBe('Error');
    expect(result.value.json).toContain("'timeout'");

    // A pause of 600 ms at the first statement does not count against a
    // limit of 300 ms: the body that follows returns.
    const { ce: ce2, callback } = cell();
    let first = true;
    let pausedRun!: Promise<ExecuteEpsilResult>;
    ce2.withTimeLimit({ ms: 300 }, () => {
      pausedRun = applyEpsilAsync(ce2, callback, [ce2.number(3)], {
        debug: {
          beforeStatement: () => {
            if (!first) return;
            first = false;
            return new Promise<void>((r) => setTimeout(r, 600));
          },
        },
      });
    });
    expect((await pausedRun).value.json).toBe(3);
  });

  test('a lazy collection is listed', async () => {
    const { ce } = cell('let m = n => map(u => u + n, [1, 2])');
    const result = await applyEpsilAsync(ce, ce.box('m').evaluate(), [
      ce.number(10),
    ]);
    expect(result.value.json).toEqual(['List', 11, 12]);
  });
});
