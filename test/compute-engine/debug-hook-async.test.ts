// The debug hooks of `executeEpsilAsync()` (`ExecuteEpsilAsyncOptions.debug`,
// `EpsilDebugHooks` in `src/compute-engine/types-debug.ts`): which
// statements call them, pausing on a pending promise, reading the paused
// scope, the depth, and ending a run from a hook.

import { ComputeEngine } from '../../src/compute-engine';
import {
  executeEpsil,
  executeEpsilAsync,
} from '../../src/epsil/execute-epsil';
import type {
  EpsilDebugHooks,
  EpsilDebugStatement,
} from '../../src/compute-engine/types-debug';

/** Run `source` and return the text of each statement that called
 * `beforeStatement`, in order, with the value of the run. */
async function statementsOf(
  source: string
): Promise<{ texts: string[]; value: string }> {
  const ce = new ComputeEngine();
  const texts: string[] = [];
  const result = await executeEpsilAsync(ce, source, {
    debug: {
      beforeStatement: (at) =>
        void texts.push(source.slice(at.range[0], at.range[1])),
    },
  });
  return { texts, value: String(result.value) };
}

describe('Statements that call the hooks', () => {
  test('top-level statements and function bodies', async () => {
    const { texts, value } = await statementsOf(
      'function f(n) {\n  let a = n * 2\n  a + 1\n}\nf(3)'
    );
    expect(value).toBe('7');
    expect(texts).toContain('f(3)');
    expect(texts).toContain('let a = n * 2');
    expect(texts).toContain('a + 1');
    // The body runs after the call that applies it.
    expect(texts.indexOf('f(3)')).toBeLessThan(texts.indexOf('a + 1'));
  });

  test('each pass of a `for` body', async () => {
    const { texts, value } = await statementsOf(
      'let s = 0\nfor i in 1..3 {\n  s += i\n}\ns'
    );
    expect(value).toBe('6');
    expect(texts.filter((t) => t === 's += i')).toHaveLength(3);
  });

  test('each pass of a `while` body', async () => {
    const { texts, value } = await statementsOf(
      'let i = 0\nwhile i < 4 {\n  i += 1\n}\ni'
    );
    expect(value).toBe('4');
    expect(texts.filter((t) => t === 'i += 1')).toHaveLength(4);
  });

  test('the branch of an `if` that runs', async () => {
    const { texts } = await statementsOf(
      'function g(x) {\n  if x > 0 {\n    let y = 1\n    y\n  } else {\n    let z = 2\n    z\n  }\n}\ng(5)'
    );
    expect(texts).toContain('let y = 1');
    expect(texts).not.toContain('let z = 2');
  });

  test('a function that a lazy collection applies calls no hook', async () => {
    // A documented limitation: `map` applies `sq` on the synchronous route.
    const { texts, value } = await statementsOf(
      'function sq(k) {\n  let t = k * k\n  t\n}\nsum(map(sq, 1..3))'
    );
    expect(value).toBe('14');
    expect(texts).not.toContain('let t = k * k');
  });

  test('a `while` with an undecided condition ends with an error, as without hooks', async () => {
    // The body runs on the asynchronous route during a debugged run, and the
    // guard of the `while` must still refuse the undecided `i <= n`.
    const source = 'let i = 1\nwhile i <= n {\n  i = i + 1\n}\ni';
    const ce = new ComputeEngine();
    const r = await executeEpsilAsync(ce, source, {
      debug: { beforeStatement: () => {} },
    });
    expect(String(r.value)).toBe('1');
    expect(r.diagnostics.map((d) => String(d.message))).toEqual([
      expect.stringContaining('incompatible-type'),
    ]);
  });

  test('each pass of a `parallel for` body, in order, with the same value', async () => {
    const source =
      'let s = 0\nparallel for k in 1..4 {\n  let t = k * k\n  s += t\n}\ns';
    const ce = new ComputeEngine();
    const passes: string[] = [];
    const r = await executeEpsilAsync(ce, source, {
      debug: {
        beforeStatement: (at) => {
          if (source.slice(at.range[0], at.range[1]) === 's += t')
            passes.push(at.inScope(() => String(ce.box('t').evaluate())));
        },
      },
    });
    expect(String(r.value)).toBe('30');
    // The interpreter runs the passes in order, debugger or not.
    expect(passes).toEqual(['1', '4', '9', '16']);
  });

  test('a `parallel for` pauses, and the run goes on after the pause', async () => {
    const source =
      'let s = 0\nparallel for k in 1..3 {\n  s += k\n}\ns';
    let paused = 0;
    const r = await executeEpsilAsync(new ComputeEngine(), source, {
      debug: {
        beforeStatement: (at) => {
          if (source.slice(at.range[0], at.range[1]) !== 's += k') return;
          paused += 1;
          return new Promise<void>((resume) => setTimeout(resume, 1));
        },
      },
    });
    expect(paused).toBe(3);
    expect(String(r.value)).toBe('6');
  });

  test('a seeded `parallel for` gives the same draws on every route', async () => {
    // A pass frame exists only inside `withRandomSeed`, which evaluates its
    // body synchronously: the body calls no hook there.
    const source =
      'withRandomSeed(7, do {\n  let s = 0\n  parallel for k in 1..5 {\n    s += random(1..100) * k\n  }\n  s\n})';
    const sync = String(executeEpsil(new ComputeEngine(), source).value);
    const plain = String(
      (await executeEpsilAsync(new ComputeEngine(), source)).value
    );
    const { texts, value } = await statementsOf(source);
    expect(plain).toBe(sync);
    expect(value).toBe(sync);
    expect(texts.some((t) => t.startsWith('s += random'))).toBe(false);
  });

  test('a hook that throws in a pass of a `parallel for` leaves the engine usable', async () => {
    const ce = new ComputeEngine();
    const stop = new Error('debugger: terminate');
    const source = 'let s = 0\nparallel for k in 1..4 {\n  s += k\n}\ns';
    let passes = 0;
    await expect(
      executeEpsilAsync(ce, source, {
        debug: {
          beforeStatement: (at) => {
            if (source.slice(at.range[0], at.range[1]) !== 's += k') return;
            passes += 1;
            if (passes === 2) throw stop;
          },
        },
      })
    ).rejects.toBe(stop);
    expect(ce._epsilDebugHooks).toBeUndefined();
    expect(String((await executeEpsilAsync(ce, '1 + 2')).value)).toBe('3');
  });

  test('a debugged run gives the same value as a run without hooks', async () => {
    const source =
      'let s = 0\nfor i in 1..5 {\n  for j in 1..i {\n    if (i + j) % 2 == 0 { s += j }\n  }\n}\ns';
    const plain = await executeEpsilAsync(new ComputeEngine(), source);
    const { value } = await statementsOf(source);
    expect(value).toBe(String(plain.value));
  });

  test('the last statement of a function with a return type or an effect', async () => {
    // The return type and the effects wrap the last statement (CE-1625).
    for (const [definition, body] of [
      ['function f(t) -> number { let k = t; k + 1 }', ['let k = t', 'k + 1']],
      ['function f(t) scope { a = a + t; b = b + 1 }', ['a = a + t', 'b = b + 1']],
      ['function f(t) scope { a = a + t }', ['a = a + t']],
    ] as const) {
      const { texts } = await statementsOf(
        `let a = 0\nlet b = 0\n${definition}\nf(1000)`
      );
      for (const statement of body) expect(texts).toContain(statement);
    }
  });

  test('a function returned by a call, that uses a parameter of the call', async () => {
    // The value of `k` is put in the returned function when the call ends
    // (CE-1626).
    const { texts, value } = await statementsOf(
      'function mk(k) { t => do { let z = t + k; let w = z * k; w + k } }\nlet h = mk(2)\nh(5)'
    );
    expect(value).toBe('16');
    expect(texts).toContain('let z = t + k');
    expect(texts).toContain('let w = z * k');
    expect(texts).toContain('w + k');
  });
});

describe('The source of a statement', () => {
  /** Run `cells` in order on one engine, the last one with the hooks, and
   * return, for each statement that called `beforeStatement`, its text in
   * its source and the index of that source in `cells`. */
  async function sourcesOf(
    cells: string[],
    withUrl = false
  ): Promise<Array<[text: string, cell: number]>> {
    const ce = new ComputeEngine();
    const url = (i: number) => (withUrl ? `cell-${i}` : undefined);
    for (let i = 0; i < cells.length - 1; i++)
      expect(executeEpsil(ce, cells[i], { url: url(i) }).diagnostics).toEqual(
        []
      );
    const seen: Array<[string, number]> = [];
    const last = cells.length - 1;
    await executeEpsilAsync(ce, cells[last], {
      url: url(last),
      debug: {
        beforeStatement: (at) => {
          const cell = withUrl
            ? cells.findIndex((_, i) => url(i) === at.sourceUrl)
            : cells.indexOf(at.sourceContent!);
          expect(at.sourceContent).toBe(cells[cell]);
          seen.push([at.sourceContent!.slice(at.range[0], at.range[1]), cell]);
        },
      },
    });
    return seen;
  }

  test('a function of an earlier run has the source of that run', async () => {
    const seen = await sourcesOf([
      'let a = 0\nfunction f(t) scope {\n  a = a + t\n  a = a + 1\n}',
      'f(1000)',
    ]);
    expect(seen).toEqual([
      ['f(1000)', 1],
      ['a = a + t', 0],
      ['a = a + 1', 0],
    ]);
  });

  test('a function value that a later run applies', async () => {
    const seen = await sourcesOf([
      'let a = 0\nlet b = 0\nlet cb = t => do { a = a + t; b = b + 1 }',
      'cb(1)',
    ]);
    expect(seen).toEqual([
      ['cb(1)', 1],
      ['a = a + t', 0],
      ['b = b + 1', 0],
    ]);
  });

  test('a function literal of the run passed to a function of an earlier run', async () => {
    const seen = await sourcesOf([
      'function apply2(g: (number) -> number, x) { let y = g(x); y + 1 }',
      'apply2(t => do { let z = t; z * 2 }, 3)',
    ]);
    expect(seen).toContainEqual(['let y = g(x)', 0]);
    expect(seen).toContainEqual(['y + 1', 0]);
    expect(seen).toContainEqual(['let z = t', 1]);
    expect(seen).toContainEqual(['z * 2', 1]);
  });

  test('a function returned by a call of an earlier run, that uses a parameter of the call', async () => {
    // The value of `k` is put in the statements of the returned function:
    // they keep the source of the run that wrote them.
    const seen = await sourcesOf([
      'function mk(k) { t => do { let z = t + k; z * k } }\nlet h = mk(2)',
      'h(5)',
    ]);
    expect(seen).toContainEqual(['let z = t + k', 0]);
    expect(seen).toContainEqual(['z * k', 0]);
  });

  test('a chain of calls through three runs', async () => {
    const seen = await sourcesOf([
      'function p(t) { let k = t; k + 1 }',
      'function q(t) { let j = p(t); j * 2 }',
      'q(4)',
    ]);
    expect(seen).toEqual([
      ['q(4)', 2],
      ['let j = p(t)', 1],
      ['let k = t', 0],
      ['k + 1', 0],
      ['j * 2', 1],
    ]);
  });

  test('the url of the run tells apart two sources with the same text', async () => {
    const seen = await sourcesOf(
      [
        'function p(t) { let k = t; k + 1 }',
        'function p(t) { let k = t; k + 1 }',
        'p(1)',
      ],
      true
    );
    // The second definition replaces the first.
    expect(seen).toContainEqual(['let k = t', 1]);
    expect(seen).not.toContainEqual(['let k = t', 0]);
  });

  test('a statement of the run has the source of the run and its url', async () => {
    const ce = new ComputeEngine();
    const at: EpsilDebugStatement[] = [];
    await executeEpsilAsync(ce, 'let x = 1\nx + 1', {
      url: 'cell-7',
      debug: { beforeStatement: (s) => void at.push(s) },
    });
    expect(at.map((s) => [s.sourceContent, s.sourceUrl])).toEqual([
      ['let x = 1\nx + 1', 'cell-7'],
      ['let x = 1\nx + 1', 'cell-7'],
    ]);
  });
});

describe('Pausing', () => {
  test('the run waits while the promise of a hook is pending', async () => {
    const ce = new ComputeEngine();
    const source = 'let a = 1\nlet b = a + 1\nb * 10';
    let resume!: () => void;
    let paused: EpsilDebugStatement | undefined;
    let run!: Promise<{ value: unknown }>;
    const pausedOnce = new Promise<void>((resolveStop) => {
      const hooks: EpsilDebugHooks = {
        beforeStatement: (at) => {
          if (source.slice(at.range[0], at.range[1]) !== 'let b = a + 1')
            return;
          paused = at;
          resolveStop();
          return new Promise<void>((r) => (resume = r));
        },
      };
      run = executeEpsilAsync(ce, source, { debug: hooks });
    });
    let finished = false;
    void run.then(() => (finished = true));
    await pausedOnce;
    // Several turns of the event loop: the run stays paused.
    for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
    expect(finished).toBe(false);
    // The paused scope: `a` has its value, `b` has none yet.
    expect(paused!.inScope(() => String(ce.box('a').evaluate()))).toBe('1');
    resume();
    expect(String((await run).value)).toBe('20');
  });

  test('`inScope` reads the locals of a paused function body', async () => {
    const ce = new ComputeEngine();
    const source = 'function f(n) {\n  let a = n * 2\n  a + 1\n}\nf(21)';
    const seen: string[] = [];
    await executeEpsilAsync(ce, source, {
      debug: {
        beforeStatement: async (at) => {
          if (source.slice(at.range[0], at.range[1]) !== 'a + 1') return;
          // Let other work run first, so that the engine's own context is
          // not the paused one when `inScope` is called.
          await new Promise((r) => setTimeout(r, 0));
          seen.push(
            at.inScope(() => String(ce.box(['Add', 'a', 'n']).evaluate()))
          );
          seen.push(
            at.inScope(() =>
              String(ce.context.lexicalScope.bindings.has('a'))
            )
          );
        },
      },
    });
    expect(seen).toEqual(['63', 'true']);
  });

  test('the depth of a function body is larger than that of its call', async () => {
    const ce = new ComputeEngine();
    const source = 'function f(n) {\n  let a = n\n  a\n}\nf(1)';
    const depths: Record<string, number> = {};
    await executeEpsilAsync(ce, source, {
      debug: {
        beforeStatement: (at) => {
          depths[source.slice(at.range[0], at.range[1])] = at.depth;
        },
      },
    });
    expect(depths['let a = n']).toBeGreaterThan(depths['f(1)']);
    expect(depths['a']).toBe(depths['let a = n']);
  });

  test('the call depth counts calls, not blocks or loop bodies', async () => {
    const ce = new ComputeEngine();
    const source =
      'function f(n) {\n  n + 1\n}\nlet a = 1\nif a > 0 {\n  a = 2\n}\nfor i in 1..2 {\n  a += f(i)\n}\na';
    const seen: Array<[string, number, number]> = [];
    await executeEpsilAsync(ce, source, {
      debug: {
        beforeStatement: (at) => {
          seen.push([
            source.slice(at.range[0], at.range[1]).split('\n')[0],
            at.depth,
            at.callDepth,
          ]);
        },
      },
    });
    const callDepth = (text: string) =>
      seen.find(([t]) => t === text)?.[2];
    const depth = (text: string) => seen.find(([t]) => t === text)?.[1];
    // A branch and a loop body are deeper contexts, but not calls
    expect(depth('a = 2')).toBeGreaterThan(depth('if a > 0 {')!);
    expect(callDepth('if a > 0 {')).toBe(0);
    expect(callDepth('a = 2')).toBe(0);
    expect(callDepth('a += f(i)')).toBe(0);
    // A statement of the body of `f` is one call deep
    expect(callDepth('n + 1')).toBe(1);
    expect(callDepth('a')).toBe(0);
  });
});

describe('`afterStatement`', () => {
  test('receives the value of each statement', async () => {
    const ce = new ComputeEngine();
    const source = 'function h(x) {\n  let e = x * 3\n  e + 1\n}\nh(2)';
    const values: Record<string, string> = {};
    await executeEpsilAsync(ce, source, {
      debug: {
        afterStatement: (at, value) => {
          values[source.slice(at.range[0], at.range[1])] = String(value);
        },
      },
    });
    expect(values['e + 1']).toBe('7');
    expect(values['h(2)']).toBe('7');
  });
});

describe('Ending a run from a hook', () => {
  test('a rejected hook promise rejects the run with that error', async () => {
    const ce = new ComputeEngine();
    const stop = new Error('debugger: terminate');
    const source = 'function f(n) {\n  let a = n\n  a\n}\nf(1)\n42';
    await expect(
      executeEpsilAsync(ce, source, {
        debug: {
          beforeStatement: (at) =>
            source.slice(at.range[0], at.range[1]) === 'a'
              ? Promise.reject(stop)
              : undefined,
        },
      })
    ).rejects.toBe(stop);
    // The hooks are removed from the engine when the run ends.
    expect(ce._epsilDebugHooks).toBeUndefined();
  });

  test('a hook that throws in a loop body ends the run', async () => {
    const ce = new ComputeEngine();
    const stop = new Error('debugger: terminate');
    const source = 'let s = 0\nfor i in 1..10 {\n  s += i\n}\ns';
    let passes = 0;
    await expect(
      executeEpsilAsync(ce, source, {
        debug: {
          beforeStatement: (at) => {
            if (source.slice(at.range[0], at.range[1]) !== 's += i') return;
            passes += 1;
            if (passes === 3) throw stop;
          },
        },
      })
    ).rejects.toBe(stop);
    expect(passes).toBe(3);
  });
});
