// In a debug run of `executeEpsilAsync()` (`ExecuteEpsilAsyncOptions.debug`),
// a time limit counts running time only: the time while a promise that a
// debug hook returned is pending does not count (`EpsilDebugHooks` in
// `src/compute-engine/types-debug.ts`, `PauseClock` in
// `src/common/interruptible.ts`).
//
// The deadline clock is `Date.now()`, which these tests control: `now`
// moves only when a test advances it, or by `step` ms at each read, so that
// an endless loop reaches its limit after a fixed number of reads. A hook
// that pauses advances `now` after an `await`: the synchronous part of a
// hook is running time.

import { ComputeEngine } from '../../src/compute-engine';
import {
  executeEpsil,
  executeEpsilAsync,
  type ExecuteEpsilResult,
} from '../../src/epsil/execute-epsil';
import type {
  EpsilDebugHooks,
  EpsilDebugStatement,
} from '../../src/compute-engine/types-debug';
import { invokeDebugHookAsync } from '../../src/common/debug-hook';
import {
  beginPause,
  frameNow,
  frameOnClock,
  frameWallDeadline,
  makePauseClock,
  pausedTime,
} from '../../src/common/interruptible';
import { mergeDeadlineFrames } from '../../src/compute-engine/boxed-expression/evaluation-epoch';

let now = 0;
let step = 0;

beforeEach(() => {
  now = 1_000_000;
  step = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => (now += step));
});

afterEach(() => jest.restoreAllMocks());

/** A program that runs until a time limit stops it. */
const ENDLESS = 'let x = 0\nwhile true {\n  x += 1\n}\nx';

const SIMPLE = 'let a = 1\na + 41';

const CALL = 'function f(n) {\n  let a = n * 2\n  a + 1\n}\nf(20)';

/** Hooks that pause at each statement whose text is `text`, at most `times`
 * times; a pause advances the clock by `ms` and then settles. */
function pauseAt(
  source: string,
  text: string,
  ms: number,
  times = Infinity
): EpsilDebugHooks {
  let left = times;
  return {
    beforeStatement: (at) => {
      if (source.slice(...at.range) !== text || left-- <= 0) return;
      return (async () => {
        await null;
        now += ms;
      })();
    },
  };
}

/** Hooks that pause once at the statement `text` until the test calls
 * `resume()`; `reached` resolves with the statement when the pause begins. */
function gateAt(source: string, text: string) {
  let resume!: () => void;
  const gate = new Promise<void>((r) => (resume = r));
  let reach!: (at: EpsilDebugStatement) => void;
  const reached = new Promise<EpsilDebugStatement>((r) => (reach = r));
  let done = false;
  const hooks: EpsilDebugHooks = {
    beforeStatement: (at) => {
      if (done || source.slice(...at.range) !== text) return;
      done = true;
      reach(at);
      return gate;
    },
  };
  return { hooks, reached, resume };
}

/** Start `source` in a `withTimeLimit` span of `ms`, as a host does. */
function runWithin(
  ce: ComputeEngine,
  ms: number,
  source: string,
  debug?: EpsilDebugHooks
): Promise<ExecuteEpsilResult> {
  let pending!: Promise<ExecuteEpsilResult>;
  ce.withTimeLimit(ms, () => {
    pending = executeEpsilAsync(ce, source, debug ? { debug } : undefined);
  });
  return pending;
}

function isTimeout(result: ExecuteEpsilResult): boolean {
  return (
    result.value.operator === 'Error' &&
    String(result.value).includes('timeout')
  );
}

describe('A pause does not count against a time limit', () => {
  test('a withTimeLimit span', async () => {
    const ce = new ComputeEngine();
    const result = await runWithin(
      ce,
      300,
      SIMPLE,
      pauseAt(SIMPLE, 'a + 41', 600)
    );
    expect(String(result.value)).toBe('42');
  });

  test('statementTimeLimitMs, with a pause inside the statement', async () => {
    const ce = new ComputeEngine();
    const result = await executeEpsilAsync(ce, CALL, {
      statementTimeLimitMs: 200,
      debug: pauseAt(CALL, 'a + 1', 400),
    });
    expect(String(result.value)).toBe('41');
  });

  test('nested spans', async () => {
    const ce = new ComputeEngine();
    let pending!: Promise<ExecuteEpsilResult>;
    ce.withTimeLimit(300, () =>
      ce.withTimeLimit({ ms: 250, label: 'inner' }, () => {
        pending = executeEpsilAsync(ce, CALL, {
          statementTimeLimitMs: 200,
          debug: pauseAt(CALL, 'a + 1', 400),
        });
      })
    );
    expect(String((await pending).value)).toBe('41');
  });

  test('a loop body driven by runAsync', async () => {
    const ce = new ComputeEngine();
    const source = 'let s = 0\nfor i in 1..3 {\n  s += i\n}\ns';
    // Three pauses of 200 ms: twice the limit in all.
    const result = await runWithin(
      ce,
      300,
      source,
      pauseAt(source, 's += i', 200)
    );
    expect(String(result.value)).toBe('6');
  });

  const FOR = 'let s = 0\nfor i in 1..3 {\n  s += i\n}\ns';
  const WHILE = 'let i = 0\nwhile i < 3 {\n  i += 1\n}\ni';

  test.each([
    [FOR, 's += i', '6'],
    [WHILE, 'i += 1', '3'],
  ])(
    'statementTimeLimitMs at a later statement, with pauses in a loop body (%#)',
    async (source, text, value) => {
      const ce = new ComputeEngine();
      // Three pauses of 150 ms, more than the 200 ms limit in all.
      const result = await executeEpsilAsync(ce, source, {
        statementTimeLimitMs: 200,
        debug: pauseAt(source, text, 150),
      });
      expect(String(result.value)).toBe(value);
    }
  );

  test.each([
    [FOR, 's += i', '6'],
    [WHILE, 'i += 1', '3'],
  ])(
    'the span around the run, at a later statement with pauses in a loop body (%#)',
    async (source, text, value) => {
      const ce = new ComputeEngine();
      const result = await runWithin(
        ce,
        200,
        source,
        pauseAt(source, text, 150)
      );
      expect(String(result.value)).toBe(value);
    }
  );

  test('a hook promise that rejects: its time is credited', async () => {
    const ce = new ComputeEngine();
    let clock: typeof ce._epsilDebugRun;
    const stop = new Error('stop');
    const run = runWithin(ce, 300, SIMPLE, {
      beforeStatement: (at) => {
        clock ??= ce._epsilDebugRun;
        if (SIMPLE.slice(...at.range) !== 'a + 41') return;
        return (async () => {
          await null;
          now += 600;
          throw stop;
        })();
      },
    });
    await expect(run).rejects.toBe(stop);
    expect(clock!.clock.totalMs).toBe(600);
    expect(clock!.clock.active).toBe(0);
  });

  test('overlapping pauses count once', async () => {
    const clock = makePauseClock();
    let resume!: () => void;
    const gate = new Promise<void>((r) => (resume = r));
    const first = invokeDebugHookAsync(() => gate, clock);
    now += 100;
    const second = invokeDebugHookAsync(() => gate, clock);
    now += 500;
    expect(pausedTime(clock)).toBe(600);
    resume();
    await Promise.all([first, second]);
    expect(clock.totalMs).toBe(600);
    expect(clock.active).toBe(0);
  });

  test('the synchronous part of a hook is running time', async () => {
    const clock = makePauseClock();
    await invokeDebugHookAsync(() => {
      // A watch that the hook evaluates before it returns its promise.
      now += 500;
      return (async () => {
        await null;
        now += 100;
      })();
    }, clock);
    expect(clock.totalMs).toBe(100);
  });

  test('a frame on a pause clock merged with a wall frame is not extended by a later pause', () => {
    const clock = makePauseClock();
    const onClock = frameOnClock({ at: now + 300, spans: [] }, clock);
    const wall = { at: now + 200, spans: [] };
    const merged = mergeDeadlineFrames(wall, onClock)!;
    expect(merged.paused).toBeUndefined();
    beginPause(clock, now);
    now += 1000;
    expect(frameWallDeadline(merged)).toBe(1_000_200);
    expect(frameNow(merged)).toBe(now);
  });

  test('a hook that returns no promise is running time', async () => {
    const clock = makePauseClock();
    await invokeDebugHookAsync(() => {
      now += 50;
    }, clock);
    expect(clock.totalMs).toBe(0);
  });
});

describe('A watch during a pause', () => {
  test('sees the remaining time of the run unchanged', async () => {
    const ce = new ComputeEngine();
    const { hooks, reached, resume } = gateAt(SIMPLE, 'a + 41');
    const run = runWithin(ce, 300, SIMPLE, hooks);
    const at = await reached;
    now += 600;
    expect(at.inScope(() => ce.timeRemaining)).toBe(300);
    expect(at.inScope(() => String(ce.box(['Add', 'a', 1]).evaluate()))).toBe(
      '2'
    );
    resume();
    expect(String((await run).value)).toBe('42');
  });

  test('with an endless loop in its own withTimeLimit, times out', async () => {
    const ce = new ComputeEngine();
    const { hooks, reached, resume } = gateAt(SIMPLE, 'a + 41');
    const run = runWithin(ce, 300, SIMPLE, hooks);
    const at = await reached;
    now += 600;
    step = 1;
    const watch = at.inScope(() =>
      ce.withTimeLimit(100, () =>
        executeEpsil(ce, 'let y = 0\nwhile true {\n  y += 1\n}\ny')
      )
    );
    expect(isTimeout(watch)).toBe(true);
    step = 0;
    resume();
    expect(String((await run).value)).toBe('42');
  });
});

describe('A watch keeps the time limit around inScope()', () => {
  test('a run with no time limit, a watch in a withTimeLimit span', async () => {
    const ce = new ComputeEngine();
    const { hooks, reached, resume } = gateAt(SIMPLE, 'a + 41');
    const run = executeEpsilAsync(ce, SIMPLE, { debug: hooks });
    const at = await reached;
    step = 1;
    const watch = ce.withTimeLimit(100, () =>
      at.inScope(() =>
        executeEpsil(ce, 'let y = 0\nwhile true {\n  y += 1\n}\ny')
      )
    );
    step = 0;
    expect(isTimeout(watch)).toBe(true);
    resume();
    expect(String((await run).value)).toBe('42');
  });
});

describe('A time limit still bounds running time', () => {
  test('a pause of another evaluation does not stop the clock of the run', async () => {
    const ce = new ComputeEngine();
    const other = 'let b = 1\nb + 1';
    let resumeRun!: () => void;
    const gate = new Promise<void>((r) => (resumeRun = r));
    let reachRun!: () => void;
    const runReached = new Promise<void>((r) => (reachRun = r));
    let reachOther!: () => void;
    const otherReached = new Promise<void>((r) => (reachOther = r));
    let first = true;
    const run = runWithin(ce, 300, ENDLESS, {
      beforeStatement: (at) => {
        if (first) {
          first = false;
          reachRun();
          return gate;
        }
        // The hooks are on the engine: a statement of the other evaluation
        // calls them too, and stays paused.
        if (String(at.statement) === 'b + 1') {
          reachOther();
          return new Promise<void>(() => {});
        }
      },
    });
    await runReached;
    void executeEpsilAsync(ce, other);
    await otherReached;
    step = 1;
    resumeRun();
    expect(isTimeout(await run)).toBe(true);
  });

  test('with no pause', async () => {
    const ce = new ComputeEngine();
    step = 1;
    const result = await runWithin(ce, 300, ENDLESS, {
      beforeStatement: () => {},
    });
    expect(isTimeout(result)).toBe(true);
  });

  test('with a pause', async () => {
    const ce = new ComputeEngine();
    step = 1;
    let passes = 0;
    const result = await runWithin(ce, 300, ENDLESS, {
      beforeStatement: (at) => {
        const text = ENDLESS.slice(...at.range);
        if (text === 'x += 1') passes += 1;
        if (text !== 'let x = 0') return;
        return (async () => {
          await null;
          now += 10_000;
        })();
      },
    });
    expect(isTimeout(result)).toBe(true);
    // The pause did not use up the limit: the loop ran.
    expect(passes).toBeGreaterThan(1);
  });

  test('statementTimeLimitMs, with a pause', async () => {
    const ce = new ComputeEngine();
    step = 1;
    const result = await executeEpsilAsync(ce, ENDLESS, {
      statementTimeLimitMs: 200,
      debug: pauseAt(ENDLESS, 'x += 1', 300, 1),
    });
    expect(isTimeout(result)).toBe(true);
  });

  test('a run that starts during a pause keeps its own limit', async () => {
    const ce = new ComputeEngine();
    const { hooks, reached, resume } = gateAt(SIMPLE, 'a + 41');
    const run = runWithin(ce, 300, SIMPLE, hooks);
    await reached;
    now += 900;
    // A run with no hooks of its own, on the same engine.
    step = 1;
    const start = now;
    const other = await runWithin(ce, 300, ENDLESS);
    const elapsed = now - start;
    step = 0;
    expect(isTimeout(other)).toBe(true);
    // Credited with none of the 900 ms of the pause before it started.
    expect(elapsed).toBeLessThan(900);
    resume();
    expect(String((await run).value)).toBe('42');
  });

  test('a pause does not extend the limit of another engine', async () => {
    const ce = new ComputeEngine();
    const other = new ComputeEngine();
    const { hooks, reached, resume } = gateAt(SIMPLE, 'a + 41');
    const run = runWithin(ce, 300, SIMPLE, hooks);
    await reached;
    now += 900;
    step = 1;
    const start = now;
    const otherResult = await runWithin(other, 200, ENDLESS);
    const elapsed = now - start;
    step = 0;
    expect(isTimeout(otherResult)).toBe(true);
    expect(elapsed).toBeLessThan(900);
    resume();
    expect(String((await run).value)).toBe('42');
  });
});
