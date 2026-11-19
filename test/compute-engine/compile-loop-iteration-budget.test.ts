/**
 * The compile option `iterationBudget` limits the passes of a compiled `Loop`
 * in one call of the compiled code. Over the limit, the code throws a
 * `CancellationError` with the cause `iteration-limit-exceeded`. Without the
 * option, the emitted code has no check.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { createIntervalRuntime } from '../../src/compute-engine/compilation/interval-runtime';
import { createJavaScriptRuntime } from '../../src/runtime';

const ce = new ComputeEngine();
ce.declare('m', 'integer');

const inc = ['Assign', 's', ['Add', 's', 1]];

/** `let s = 0; Loop(<loop>); s`: a local that counts the passes of the body. */
const counting = (...loop: unknown[]) =>
  ce.box([
    'Block',
    ['Declare', 's', "'unknown'", 0],
    ['Loop', ...loop],
    's',
  ] as any);

const hugeRange = () => counting(inc, ['Element', 'i', ['Range', 1, 1e12]]);
/** Three passes in each of the three loop shapes. */
const counted = () => counting(inc, ['Element', 'i', ['Range', 1, 3]]);
const forEach = () => counting(inc, ['Element', 'i', ['List', 5, 6, 7]]);

const js = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { to: 'javascript', fallback: false, ...options } as any);
const interval = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { to: 'interval-js', fallback: false, ...options } as any);

/** The error that `f` throws. */
function thrownBy(f: () => unknown): any {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error('It did not throw');
}

function expectLimit(f: () => unknown): void {
  const e = thrownBy(f);
  expect(e.name).toBe('CancellationError');
  expect(e.cause).toBe('iteration-limit-exceeded');
  expect(e.message).toContain('iterationBudget');
}

/** The result as stored data: every field but the `run` closure and the
 * batch functions. */
const stored = (result: any) =>
  JSON.parse(
    JSON.stringify(result, (_, v) => (typeof v === 'function' ? undefined : v))
  );

/** A user function whose body counts `n` passes. */
ce.assign(
  'countTo',
  ce.box([
    'Function',
    [
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Loop', inc, ['Element', 'i', ['Range', 1, 'n']]],
      's',
    ],
    'n',
  ] as any)
);
const lambda = () =>
  ce.box([
    'Function',
    [
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Loop', inc, ['Element', 'i', ['Range', 1, 'n']]],
      's',
    ],
    'n',
  ] as any);

describe('COMPILE Loop - iterationBudget on the JavaScript target', () => {
  // A budget below 2^32 stops a counted loop of more than 2^32 passes with
  // its cancellation, as any loop past the budget (CE-1525).
  test('a range of 1..1e12 stops', () => {
    const { run } = js(hugeRange(), { iterationBudget: 1000 });
    expect(() => run!({})).toThrow(
      expect.objectContaining({
        name: 'CancellationError',
        cause: 'iteration-limit-exceeded',
      })
    );
  });

  test.each([
    ['a counted range', counted, 3],
    ['a list', forEach, 3],
  ])(
    'a loop over %s: below and at the budget it gives the value with no budget',
    (_, expr, passes) => {
      const free = js(expr()).run!({});
      expect(free).toBe(passes);
      expect(js(expr(), { iterationBudget: passes + 1 }).run!({})).toBe(free);
      expect(js(expr(), { iterationBudget: passes }).run!({})).toBe(free);
      expectLimit(() => js(expr(), { iterationBudget: passes - 1 }).run!({}));
    }
  );

  test('a range with a bound read at run time counts each pass', () => {
    const run = js(counting(inc, ['Element', 'i', ['Range', 1, 'm']]), {
      iterationBudget: 5,
    }).run!;
    expect(run({ m: 5 })).toBe(5);
    expectLimit(() => run({ m: 6 }));
  });

  test('a fractional budget is floored', () => {
    expect(js(counted(), { iterationBudget: 3.5 }).run!({})).toBe(3);
    expectLimit(() => js(counted(), { iterationBudget: 2.5 }).run!({}));
  });

  test('two nested loops count together', () => {
    const nested = () =>
      counting(
        ['Loop', inc, ['Element', 'j', ['Range', 1, 3]]],
        ['Element', 'i', ['Range', 1, 3]]
      );
    // Three passes of the outer body, nine of the inner.
    expect(js(nested(), { iterationBudget: 12 }).run!({})).toBe(9);
    expectLimit(() => js(nested(), { iterationBudget: 11 }).run!({}));
  });

  test('two clauses count as two nested loops', () => {
    const clauses = () =>
      counting(
        inc,
        ['Element', 'i', ['Range', 1, 3]],
        ['Element', 'j', ['Range', 1, 3]]
      );
    expect(js(clauses(), { iterationBudget: 12 }).run!({})).toBe(9);
    expectLimit(() => js(clauses(), { iterationBudget: 11 }).run!({}));
  });

  test('an inner source that is empty does not hide the outer loop', () => {
    const empty = counting(
      inc,
      ['Element', 'i', ['Range', 1, 4e9]],
      ['Element', 'j', ['Range', 1, 'm']]
    );
    expectLimit(() => js(empty, { iterationBudget: 100 }).run!({ m: 0 }));
  });

  test('a second run starts its count at 0', () => {
    const { run } = js(counted(), { iterationBudget: 5 });
    expect(run!({})).toBe(3);
    expect(run!({})).toBe(3);
    const stop = js(counting(inc, ['Element', 'i', ['Range', 1, 'm']]), {
      iterationBudget: 5,
    }).run!;
    expectLimit(() => stop({ m: 6 }));
    expect(stop({ m: 5 })).toBe(5);
  });

  test('a function literal counts one total for each call', () => {
    const { run, code } = js(lambda(), { iterationBudget: 3 });
    const call = run as unknown as (n: number) => number;
    expect(code).toContain('resetLoopPasses');
    expect(call(3)).toBe(3);
    expect(call(3)).toBe(3);
    expectLimit(() => call(4));
  });

  test.each([
    ['a symbol', () => ce.symbol('countTo')],
    [
      'a `Block`',
      () =>
        ce.box([
          'Block',
          [
            'Declare',
            'f',
            "'unknown'",
            ['Function', ['Block', ['Declare', 's', "'unknown'", 0], ['Loop', inc], 's'], 'n'],
          ],
          'f',
        ] as any),
    ],
  ])('%s whose value is a function declines', (_, expr) => {
    expect(() => js(expr(), { iterationBudget: 5 })).toThrow(/Could not compile/);
  });

  test('a function literal whose body gives a function declines', () => {
    const curried = ce.box([
      'Function',
      ['Function', ['Block', ['Declare', 's', "'unknown'", 0], ['Loop', inc], 's'], 'y'],
      'x',
    ] as any);
    expect(() => js(curried, { iterationBudget: 5 })).toThrow(/Could not compile/);
  });

});

describe('COMPILE Loop - iterationBudget and the ladder of `Limit`', () => {
  const zetaThree = () =>
    ce.box([
      'Limit',
      [
        'Function',
        [
          'Block',
          ['Declare', 's', "'unknown'", 0],
          [
            'Loop',
            ['Assign', 's', ['Add', 's', ['Power', 'k', -3]]],
            ['Element', 'k', ['Range', 1, 'n']],
          ],
          's',
        ],
        'n',
      ],
      'PositiveInfinity',
    ] as any);

  test('a sample over the budget of the ladder reads as `NaN`', () => {
    expect(zetaThree().N().re).toBeCloseTo(1.2020569, 5);
  });

  test('the symbolic route does not throw either', () => {
    expect(() => zetaThree().evaluate()).not.toThrow();
  });

  test('a host that sets the option itself gets the throw', () => {
    const { run } = js(lambda(), { iterationBudget: 1000 });
    const call = run as unknown as (n: number) => number;
    expect(call(1000)).toBe(1000);
    expectLimit(() => call(1001));
  });
});

describe('COMPILE Loop - with no iterationBudget', () => {

  test.each([
    ['a counted range', counted],
    ['a list', forEach],
    ['a function literal', lambda],
  ])('%s: no field of the result names the count', (_, expr) => {
    for (const compiled of [js])
      expect(JSON.stringify(stored(compiled(expr())))).not.toContain('LoopPass');
  });

  test('a budget with no `Loop` adds no count to the code', () => {
    const sum = () => ce.box(['Sum', 'i', ['Limits', 'i', 1, 'm']] as any);
    const limited = stored(js(sum(), { iterationBudget: 10 }));
    expect(JSON.stringify(limited)).not.toContain('LoopPass');
    expect(
      JSON.stringify(stored(interval(sum(), { iterationBudget: 10 })))
    ).not.toContain('LoopPass');
  });

  test('a `Sum` over the budget keeps its value of NaN', () => {
    const sum = ce.box(['Sum', 'i', ['Limits', 'i', 1, 'm']] as any);
    const { run } = js(sum, { iterationBudget: 10 });
    expect(run!({ m: 4 })).toBe(10);
    expect(run!({ m: 1000 })).toBeNaN();
  });

  // Tycho row 509: the interval loop of a `Sum` or a `Product` had no check,
  // so `Sum(i, Limits(i, 1, 1e12))` compiled with the option ran every pass
  // on the interval lane of a plot row and froze the page. Over the budget the
  // loop now answers `entire`, the interval that says "unknown", before its
  // first pass, as the JavaScript loop answers `NaN`.
  test.each([
    ['Sum', 10, 500500],
    ['Product', 24, Infinity],
  ])(
    'an interval `%s` over the budget gives `entire` before its first pass',
    (head, four, thousand) => {
      const symbolic = ce.box([head, 'i', ['Limits', 'i', 1, 'm']] as any);
      const { run } = interval(symbolic, { iterationBudget: 10 });
      expect(run!({ m: 4 })).toEqual({
        kind: 'interval',
        value: { lo: four, hi: four },
      });
      expect(run!({ m: 10 }).kind).toBe('interval');
      expect(run!({ m: 11 })).toEqual({ kind: 'entire' });
      // Without the option, the loop runs every pass.
      expect(interval(symbolic).run!({ m: 1000 }).value.hi).toBe(thousand);
      // A literal range past the unroll limit is a loop too, with constant
      // bounds in its code.
      const literal = ce.box([head, 'i', ['Limits', 'i', 1, 1e12]] as any);
      const { run: runLiteral } = interval(literal, {
        iterationBudget: 1e6,
      });
      expect(runLiteral!({})).toEqual({ kind: 'entire' });
    }
  );

  test('an interval `Sum` with a fractional budget floors it', () => {
    const sum = ce.box(['Sum', 'i', ['Limits', 'i', 1, 'm']] as any);
    const { run } = interval(sum, { iterationBudget: 4.5 });
    expect(run!({ m: 4 }).kind).toBe('interval');
    expect(run!({ m: 5 })).toEqual({ kind: 'entire' });
  });
});

describe('COMPILE Loop - iterationBudget in stored code', () => {
  test('createJavaScriptRuntime() keeps the limit, and a call starts at 0', () => {
    const load = createJavaScriptRuntime().load(
      stored(js(counting(inc, ['Element', 'i', ['Range', 1, 'm']]), {
        iterationBudget: 5,
      }))
    );
    expect(load({ m: 5 })).toBe(5);
    expect(load({ m: 5 })).toBe(5);
    expectLimit(() => load({ m: 6 }));
    expect(load({ m: 5 })).toBe(5);
  });

  test('a function literal', () => {
    const load = createJavaScriptRuntime().load(
      stored(js(lambda(), { iterationBudget: 3 }))
    );
    expect(load(3)).toBe(3);
    expect(load(3)).toBe(3);
    expectLimit(() => load(4));
  });

  test('a count spent by one loaded code does not reach another', () => {
    const runtime = createJavaScriptRuntime();
    const a = runtime.load(stored(js(counted(), { iterationBudget: 3 })));
    const b = runtime.load(stored(js(forEach(), { iterationBudget: 3 })));
    expect(a({})).toBe(3);
    expect(b({})).toBe(3);
  });
});

describe('COMPILE Loop - iterationBudget in a batch', () => {
  // A batch does not throw: a cell that throws gives `NaN` and counts as a
  // failure, as for any other error of a cell. So the cell over the limit is
  // `NaN`, and the next cell starts its count at 0.
  const expr = () => counting(inc, ['Element', 'i', ['Range', 1, 'm']]);
  const cells = { m: new Float64Array([1, 2, 3, 4, 2]) };

  test('broadcast() gives NaN for the cell over the limit', () => {
    const out = js(expr(), { iterationBudget: 3 }).broadcast!(cells as any);
    expect([...(out as Float64Array)]).toEqual([1, 2, 3, NaN, 2]);
  });

  test('the batch loader of stored code', () => {
    const load = createJavaScriptRuntime().loadBroadcast(
      stored(js(expr(), { iterationBudget: 3 }))
    );
    expect([...load(cells as any)]).toEqual([1, 2, 3, NaN, 2]);
  });

});

describe('COMPILE Loop - iterationBudget on interval-js', () => {
  test('a range of 1..1e12 is entire', () => {
    // A loop of 2^32 passes or more gives `entire` before its first pass,
    // before the budget counts a pass (`ir/README.md`, "Loops and the
    // runtime").
    const { run, success } = interval(hugeRange(), { iterationBudget: 1000 });
    expect(success).toBe(true);
    expect(run!({})).toEqual({ kind: 'entire' });
  });

  test('below and at the budget it gives the value with no budget', () => {
    const free = interval(counted()).run!({});
    expect(free).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
    expect(interval(counted(), { iterationBudget: 4 }).run!({})).toEqual(free);
    expect(interval(counted(), { iterationBudget: 3 }).run!({})).toEqual(free);
    expectLimit(() => interval(counted(), { iterationBudget: 2 }).run!({}));
  });

  test('a batch answers with an error cell for the cell over the limit', () => {
    const expr = counting(inc, ['Element', 'i', ['Range', 1, 'm']]);
    const out = interval(expr, { iterationBudget: 3 }).broadcast!({
      m: new Float64Array([2, 2, 4, 4, 3, 3]),
    } as any) as Float64Array;
    // Each cell has three values: `lo`, `hi` and the kind of the result.
    expect(out[0]).toBe(2);
    expect(out[3]).toBeNaN();
    expect(out[6]).toBe(3);
  });

  test('createIntervalRuntime() keeps the limit', () => {
    const expr = counting(inc, ['Element', 'i', ['Range', 1, 'm']]);
    const load = createIntervalRuntime().load(
      stored(interval(expr, { iterationBudget: 5 }))
    );
    const five = { kind: 'interval', value: { lo: 5, hi: 5 } };
    expect(load({ m: 5 })).toEqual(five);
    expectLimit(() => load({ m: 6 }));
    expect(load({ m: 5 })).toEqual(five);
  });
});

describe('COMPILE Loop - iterationBudget on the other targets', () => {

  test('the `bigint` mode declines a `Loop`, so no throw can become `NaN`', () => {
    const loop = ce.box(['Loop', ['Add', 'm', 1]] as any);
    for (const options of [{}, { iterationBudget: 2 }])
      expect(() =>
        compile(loop, {
          fallback: false,
          mode: 'bigint',
          ...options,
        } as any)
      ).toThrow(/the value of a Loop/);
  });
});

describe('COMPILE Loop - a counted loop of 2^32 passes or more (CE-1525)', () => {
  // A budget below 2^32 throws its cancellation before the 2^32nd pass, so
  // the loop has no test of its length; a budget of 2^32 or more keeps it.
  const passes = (n: number, budget: number) => {
    const { run } = js(counting(inc, ['Element', 'i', ['Range', 1, n]]), {
      iterationBudget: budget,
    });
    try {
      return run!({});
    } catch (e: any) {
      return e.name === 'CancellationError' ? e.cause : e.message;
    }
  };

  test.each([1e7, 1e12, 2 ** 53])(
    'a loop of %d passes stops on a budget of 1e6',
    (n) => {
      expect(passes(n, 1e6)).toBe('iteration-limit-exceeded');
    }
  );

  test('a loop within the budget runs', () => {
    expect(passes(1000, 1e6)).toBe(1000);
  });

  test('a budget of 2^32 or more keeps the guard of the length', () => {
    expect(passes(1e12, 2 ** 33)).toMatch(/a loop of more than 2\^32/);
  });
});
