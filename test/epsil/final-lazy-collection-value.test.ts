import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil';
import { setDebugStatementHook } from '../../src/common/debug-hook';

//
// The value of a program is a value. When the last statement gives a finite
// lazy collection (`map(…)`, `filter(…)`, `take(…)`, a comprehension),
// `executeEpsil()` lists it, so every form of the value (`json`, `latex`,
// `toString()`) shows the elements. A host that writes the LaTeX of the
// value of `map(u => u + 1, [5, 6])` must show `[6, 7]`, not the `Map`
// expression. The implementation is `listedFinalValue()`
// (`src/epsil/execute-epsil.ts`).
//

/** The forms of the value that a host reads, on the synchronous route, after
 * a check that the asynchronous route gives the same ones. */
async function forms(source: string, ce = new ComputeEngine()) {
  const read = (r: ReturnType<typeof executeEpsil>) => ({
    json: r.value.json,
    latex: r.value.latex,
    text: r.value.toString(),
    diagnostics: r.diagnostics.map((d) => d.message),
  });
  const sync = read(executeEpsil(ce, source));
  const async_ = read(await executeEpsilAsync(new ComputeEngine(), source));
  expect(async_).toEqual(sync);
  return sync;
}

/** An engine with the host function `tick(n)`, which returns `n`, and the
 * number of times that it ran. */
function counted() {
  const ce = new ComputeEngine();
  const count = { calls: 0 };
  ce.declare('tick', {
    signature: '(number) -> number',
    evaluate: (ops) => {
      count.calls++;
      return ops[0].evaluate();
    },
  });
  return { ce, count };
}

describe('the value of a program that ends with a lazy collection', () => {
  test('a `map` gives the list of its elements', async () => {
    expect(await forms('map(u => u + 1, [5, 6])')).toEqual({
      json: ['List', 6, 7],
      latex: '\\bigl\\lbrack6, 7\\bigr\\rbrack',
      text: '[6,7]',
      diagnostics: [],
    });
  });

  test('a `filter` gives the list of its elements', async () => {
    expect(await forms('filter([5, 6, 7], u => u > 5)')).toEqual({
      json: ['List', 6, 7],
      latex: '\\bigl\\lbrack6, 7\\bigr\\rbrack',
      text: '[6,7]',
      diagnostics: [],
    });
  });

  test.each<[string, string, unknown]>([
    ['a finite part of an infinite collection', 'take(map(u => u * 2, 1..oo), 3)', ['List', 2, 4, 6]],
    ['`reverse`', 'reverse([1, 2, 3])', ['List', 3, 2, 1]],
    ['`zip`', 'zip([1, 2], [3, 4])', ['List', ['Tuple', 1, 3], ['Tuple', 2, 4]]],
    ['`drop`', 'drop([1, 2, 3], 1)', ['List', 2, 3]],
    ['a `map` of a set is a set', 'map(u => u + 1, {1, 2, 3})', ['Set', 2, 3, 4]],
    [
      'a `filter` of a dictionary is a dictionary',
      'let d = {"a" -> 1, "b" -> 2, "c" -> 3}\nfilter(d, e => e[2] > 1)',
      { dict: { b: 2, c: 3 } },
    ],
    [
      'the elements that are lazy collections are listed too',
      'map(u => map(v => v + u, [1, 2]), [10, 20])',
      ['List', ['List', 11, 12], ['List', 21, 22]],
    ],
    ['a variable that holds a lazy collection', 'let ys = map(sin, 1..2)\nys', ['List', ['Sin', 1], ['Sin', 2]]],
    ['the value of a call', 'function f(n) { map(u => u + n, [5, 6]) }\nf(1)', ['List', 6, 7]],
    ['the value of an `if`', 'if true { map(u => u + 1, [5, 6]) } else { [1] }', ['List', 6, 7]],
    ['a comprehension', '[u + 1 for u in [5, 6]]', ['List', 6, 7]],
  ])('%s', async (_name, source, json) => {
    const r = await forms(source);
    expect(r.json).toEqual(json);
    expect(r.diagnostics).toEqual([]);
  });

  test('the variable of the program keeps its lazy collection', () => {
    // `map(sin, 1..2)` reads no variable, so the declaration stores the
    // view. Only the value of the program is listed.
    const ce = new ComputeEngine();
    const { value } = executeEpsil(ce, 'let ys = map(sin, 1..2)\nys');
    expect(value.operator).toBe('List');
    expect(ce.box('ys').value?.operator).toBe('Map');
  });
});

describe('a lazy collection that is not listed', () => {
  test('a range stays a range', async () => {
    const r = await forms('1..4');
    // `1..4` is the ascending range `Range(1, 4, 1)`. Its LaTeX writes the
    // second element: LaTeX `1..4` is `Range(1, 4)`, which counts toward its
    // end in either direction.
    expect(r.json).toEqual(['Range', 1, 4, 1]);
    expect(r.latex).toBe('1..2..4');
  });

  test('a list holds a range element as a range', async () => {
    // As a list literal does: `[1..2, 1..3]` is a list of two ranges.
    const r = await forms('map(u => 1..u, [2, 3])');
    expect(r.json).toEqual(['List', ['Range', 1, 2, 1], ['Range', 1, 3, 1]]);
  });

  test('a collection with no last element stays lazy', async () => {
    const r = await forms('map(u => u * 2, 1..oo)');
    expect(r.json).toEqual([
      'Map',
      ['Function', ['Block', ['Multiply', 2, 'u']], 'u'],
      ['Range', 1, 'PositiveInfinity', 1],
    ]);
    expect(r.text).toBe('[2,4,6,8,10,...]');
  });

  test('a collection with more elements than `maxCollectionSize` stays lazy, and no callback runs', () => {
    const { ce, count } = counted();
    ce.maxCollectionSize = 10;
    const kept = executeEpsil(ce, 'map(u => tick(u), 1..11)');
    expect(kept.value.operator).toBe('Map');
    expect(count.calls).toBe(0);
    const listed = executeEpsil(ce, 'map(u => tick(u), 1..10)');
    expect(listed.value.operator).toBe('List');
    expect(count.calls).toBe(10);
  });
});

describe('when the callback of the final collection runs', () => {
  test('once for each element, during the run', () => {
    const { ce, count } = counted();
    const { value } = executeEpsil(ce, 'map(u => tick(u) + 1, [5, 6])');
    expect(count.calls).toBe(2);
    // The value is a list: a read of it runs no callback.
    expect(value.toString()).toBe('[6,7]');
    expect(value.latex).toBe('\\bigl\\lbrack6, 7\\bigr\\rbrack');
    expect(value.json).toEqual(['List', 6, 7]);
    expect(count.calls).toBe(2);
  });

  test('not for a declaration: the program gives `Nothing`', async () => {
    for (const run of [executeEpsil, executeEpsilAsync]) {
      const { ce, count } = counted();
      const seen: string[] = [];
      const { value } = await run(ce, 'let ys = map(tick, [5, 6])', {
        onStatement: (s) => seen.push(s.value.operator),
      });
      expect(value.json).toBe('Nothing');
      expect(seen).toEqual(['Map']);
      expect(count.calls).toBe(0);
    }
  });

  test('not for a statement that is not the last one', async () => {
    for (const run of [executeEpsil, executeEpsilAsync]) {
      const { ce, count } = counted();
      const seen: string[] = [];
      const { value } = await run(ce, 'map(tick, [5, 6])\nmap(tick, [7])', {
        onStatement: (s) => seen.push(s.value.operator),
      });
      // `onStatement` receives the value of the program for the last
      // statement, and the lazy collection for the others.
      expect(seen).toEqual(['Map', 'List']);
      expect(value.json).toEqual(['List', 7]);
      expect(count.calls).toBe(1);
    }
  });

  test.each<[string, string, unknown, string, unknown]>([
    [
      'a callback that assigns a variable',
      'let n = 0\nmap(u => do { n = n + 1; u + n }, [5, 6])',
      ['List', 6, 8],
      'n',
      2,
    ],
    [
      'a callback that grows a list',
      'let acc = []\nmap(u => do { acc = [...acc, u]; length(acc) }, [5, 6])',
      ['List', 1, 2],
      'acc',
      ['List', 5, 6],
    ],
    [
      'the body of a comprehension that assigns a variable',
      'let n = 0\n[do { n = n + 1; u + n } for u in [5, 6]]',
      ['List', 6, 8],
      'n',
      2,
    ],
  ])('%s runs once for each element, on both routes', async (_name, source, json, name, after) => {
    for (const run of [executeEpsil, executeEpsilAsync]) {
      const ce = new ComputeEngine();
      const { value, diagnostics } = await run(ce, source);
      expect(value.json).toEqual(json);
      expect(diagnostics).toEqual([]);
      expect(ce.box(name).value?.json).toEqual(after);
    }
  });
});

describe('errors of the final collection', () => {
  test('a failed element is an error cell of the list, and the range of the value is the argument of the failed call', async () => {
    const source = 'function g(s: string) { length(s) }\nmap(u => g(u), ["ab", 3])';
    for (const run of [executeEpsil, executeEpsilAsync]) {
      const r = await run(new ComputeEngine(), source);
      expect(r.value.operator).toBe('List');
      expect(r.value.toString()).toBe(
        '[2,Error(ErrorCode("incompatible-type", "string", "3"), 3)]'
      );
      // The final statement's problem stays in the value.
      expect(r.diagnostics).toEqual([]);
      // The `u` of `g(u)`.
      expect(r.valueRange).toEqual([source.indexOf('g(u)') + 2, source.indexOf('g(u)') + 3]);
    }
  });

  test('a statement of the callback whose error is discarded is reported', async () => {
    const r = await forms(
      'function g(x) { 1/x }\nmap(u => do { let tmp = [g("a")]; u }, [1, 2])'
    );
    expect(r.json).toEqual(['List', 1, 2]);
    expect(r.diagnostics.map((m) => [m[0], m[3]])).toEqual([
      ['runtime-error', 'incompatible-type'],
    ]);
  });

  test('an error that the value holds is not reported a second time', async () => {
    const r = await forms(
      'function g(x) { 1/x }\nmap(u => do { let tmp = [g("a")]; tmp }, [1, 2])'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.text).toContain('Error(ErrorCode("incompatible-type"');
  });
});

describe('a canceled walk of the final collection gives an error value', () => {
  // A callback that never ends: the outcome is the timeout, whatever the
  // speed of the machine.
  const endless = 'do { let c = 0; while c >= 0 { c = c + 1 }; c }';
  const programs: [string, string][] = [
    ['a map', `map(u => ${endless}, [1, 2])`],
    ['a comprehension', `[${endless} for u in [1, 2]]`],
  ];

  // Every box operation checks the deadline, so the work that follows the
  // cancellation (the error value, the report of the statement) meets a
  // check of the spent budget if the frame is still on the engine.
  const checkOnEveryBox = (ce: ComputeEngine): void => {
    Object.defineProperty(ce._deadlineFrame!, 'tick', {
      get: () => 0x3ff,
      set: () => {},
      configurable: true,
    });
  };

  test.each(programs)('%s: the time limit of the span around a synchronous run', (_name, source) => {
    const ce = new ComputeEngine();
    const { value, diagnostics, valueRange } = ce.withTimeLimit(
      { ms: 50, label: 'test:final-collection-sync' },
      () => {
        checkOnEveryBox(ce);
        const frame = ce._deadlineFrame;
        const r = executeEpsil(ce, source);
        // The run puts the frame of the span back when it ends.
        expect(ce._deadlineFrame).toBe(frame);
        return r;
      }
    );
    expect(value.json).toEqual(['Error', expect.any(String), "'timeout'"]);
    expect(diagnostics).toEqual([]);
    expect(valueRange).toEqual([0, source.length]);
  }, 30_000);

  test.each(programs)('%s: the time limit of the span around an asynchronous run', async (_name, source) => {
    const ce = new ComputeEngine();
    let p: Promise<ReturnType<typeof executeEpsil>> | undefined;
    ce.withTimeLimit({ ms: 50, label: 'test:final-collection-async' }, () => {
      checkOnEveryBox(ce);
      p = executeEpsilAsync(ce, source);
      return 0;
    });
    const { value, diagnostics } = await p!;
    expect(value.json).toEqual(['Error', expect.any(String), "'timeout'"]);
    expect(diagnostics).toEqual([]);
    expect(ce._deadlineFrame).toBeUndefined();
  }, 30_000);

  test.each(programs)('%s: the time limit of a statement', async (_name, source) => {
    for (const run of [executeEpsil, executeEpsilAsync]) {
      const ce = new ComputeEngine();
      const { value, diagnostics } = await run(ce, source, {
        statementTimeLimitMs: 50,
      });
      expect(value.json).toEqual(['Error', expect.any(String), "'timeout'"]);
      expect(diagnostics).toEqual([]);
      expect(ce._deadlineFrame).toBeUndefined();
    }
  }, 30_000);

  test.each<[string, string]>([
    ['a map', 'function r(n) { r(n + 1) }\nmap(u => r(u), [1, 2])'],
    ['a comprehension', 'function r(n) { r(n + 1) }\n[r(u) for u in [1, 2]]'],
  ])('%s: the recursion limit', async (_name, source) => {
    for (const run of [executeEpsil, executeEpsilAsync]) {
      const r = await run(new ComputeEngine(), source);
      expect(r.value.json).toEqual([
        'Error',
        "'Recursion limit exceeded'",
        "'recursion-depth-exceeded'",
      ]);
      expect(r.diagnostics).toEqual([]);
    }
  });

  test('the time that a debugger keeps the last statement stopped does not count against the walk', async () => {
    // A debugger stops the program in its statement hook, which keeps the
    // thread, and the time limit of a statement starts after the hook. The
    // walk of the final value has a span of that limit of its own, so a
    // stop of 250 ms at the last statement, longer than the limit of
    // 200 ms, does not cancel a walk of two elements.
    let stops = 0;
    setDebugStatementHook((statement) => {
      if ((statement as { operator?: string }).operator !== 'Map') return;
      stops += 1;
      const end = Date.now() + 250;
      while (Date.now() < end);
    });
    try {
      for (const run of [executeEpsil, executeEpsilAsync]) {
        stops = 0;
        const { value } = await run(
          new ComputeEngine(),
          'map(u => u + 1, [5, 6])',
          { statementTimeLimitMs: 200 }
        );
        expect(stops).toBe(1);
        expect(value.json).toEqual(['List', 6, 7]);
      }
    } finally {
      setDebugStatementHook(undefined);
    }
  }, 30_000);

  test('the exception of a debugger hook in the callback is thrown to the host', async () => {
    // A debugger command can unwind the evaluation from its hook. The
    // statements of the callback run during the walk of the final value:
    // the exception must not be kept as a failed walk, which would end the
    // run with the lazy collection as its value.
    const stop = new Error('debugger: stop');
    const source = 'map(u => do { let t = u; t + 1 }, [5, 6])';
    setDebugStatementHook((statement) => {
      if ((statement as { operator?: string }).operator === 'Declare')
        throw stop;
    });
    try {
      const ce = new ComputeEngine();
      expect(() => executeEpsil(ce, source)).toThrow(stop);
      // The fields of the run are restored.
      expect(ce._epsilStatementResultHook).toBeUndefined();
      expect(ce._deadlineFrame).toBeUndefined();
      await expect(executeEpsilAsync(new ComputeEngine(), source)).rejects.toBe(
        stop
      );
    } finally {
      setDebugStatementHook(undefined);
    }
    // Without the hook, the same program gives the list.
    expect(executeEpsil(new ComputeEngine(), source).value.json).toEqual([
      'List',
      6,
      7,
    ]);
  });

  test('a later run on the same engine is not canceled', () => {
    const ce = new ComputeEngine();
    const first = executeEpsil(ce, programs[0][1], { statementTimeLimitMs: 50 });
    expect(first.value.operator).toBe('Error');
    expect(executeEpsil(ce, 'map(u => u + 1, [5, 6])').value.json).toEqual([
      'List',
      6,
      7,
    ]);
  }, 30_000);
});
