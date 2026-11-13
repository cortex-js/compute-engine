/**
 * The compile option `iterationBudget` limits the passes of a compiled `Loop`
 * in one call of the compiled code. Over the limit, the code throws a
 * `CancellationError` with the cause `iteration-limit-exceeded`. Without the
 * option, the emitted code has no check.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { createIntervalRuntime } from '../../src/compute-engine/compilation/interval-runtime';
import { IntervalArithmetic } from '../../src/compute-engine/interval';
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

const bareLoop = () => counting(inc);
/** The break test never succeeds: `s` only grows. */
const neverBreaks = () =>
  counting(['Block', inc, ['If', ['Less', 's', 0], ['Break']]]);
const hugeRange = () => counting(inc, ['Element', 'i', ['Range', 1, 1e12]]);
/** Three passes in each of the three loop shapes. */
const counted = () => counting(inc, ['Element', 'i', ['Range', 1, 3]]);
const forEach = () => counting(inc, ['Element', 'i', ['List', 5, 6, 7]]);
const breaksAtThree = () =>
  counting(['Block', inc, ['If', ['Equal', 's', 3], ['Break']]]);

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
const twoCalls = () =>
  ce.box(['Add', ['countTo', 'm'], ['countTo', ['Add', 'm', 1]]] as any);
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
  test.each([
    ['a loop with no indexing set', bareLoop],
    ['a break test that never succeeds', neverBreaks],
    ['a range of 1..1e12', hugeRange],
  ])('%s stops', (_, expr) => {
    const { run } = js(expr(), { iterationBudget: 1000 });
    expectLimit(() => run!({}));
  });

  test.each([
    ['no indexing set', breaksAtThree, 3],
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

  test('a guard that keeps no element does not hide the loop', () => {
    const guarded = counting(inc, [
      'Element',
      'i',
      ['Range', 1, 4e9],
      ['Less', 'i', 'm'],
    ]);
    expectLimit(() => js(guarded, { iterationBudget: 100 }).run!({ m: 0 }));
  });

  test('an inner source that is empty does not hide the outer loop', () => {
    const empty = counting(
      inc,
      ['Element', 'i', ['Range', 1, 4e9]],
      ['Element', 'j', ['Range', 1, 'm']]
    );
    expectLimit(() => js(empty, { iterationBudget: 100 }).run!({ m: 0 }));
  });

  test('a loop in a user function counts in the same total', () => {
    const { run, preamble } = js(twoCalls(), { iterationBudget: 7 });
    expect(preamble).toContain('_fn_countTo');
    // 3 + 4 passes in two calls of the function.
    expect(run!({ m: 3 })).toBe(7);
    expectLimit(() => run!({ m: 4 }));
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

  test('a function literal that calls a user function', () => {
    const literal = ce.box([
      'Function',
      ['Add', ['countTo', 't'], ['countTo', 't']],
      't',
    ] as any);
    const result = js(literal, { iterationBudget: 6 });
    const call = result.run as unknown as (t: number) => number;
    expect(call(3)).toBe(6);
    expect(call(3)).toBe(6);
    expectLimit(() => call(4));
  });

  test('the throw does not start the interpreter fallback', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(bareLoop(), { iterationBudget: 5 } as any);
      expect(result.success).toBe(true);
      expectLimit(() => result.run!({}));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('a direct target resets the count in the code', () => {
    const target = ce
      ._getCompilationTarget('javascript')!
      .createTarget({ iterationBudget: 5 });
    const { code } = compile(counted(), { target } as any);
    expect(code).toContain('_SYS.countLoopPass(5)');
    expect(code!.startsWith('(_SYS.resetLoopPasses(), ')).toBe(true);
  });

  test('a `Function` literal at the root of a direct target resets in each call', () => {
    const target = ce
      ._getCompilationTarget('javascript')!
      .createTarget({ iterationBudget: 3 });
    const { code } = compile(lambda(), { target } as any);
    const call = new Function('_SYS', `return ${code};`)(
      createJavaScriptRuntime()
    ) as (n: number) => number;
    expect(call(3)).toBe(3);
    expect(call(3)).toBe(3);
    expectLimit(() => call(4));
    expect(call(3)).toBe(3);
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
    expect(() => js(expr(), { iterationBudget: 5 })).toThrow(/iterationBudget/);
    // With no budget, the code has no count, so nothing changes.
    expect(js(expr()).success).toBe(true);
  });

  test('a direct target declines a `Block` whose value is a function', () => {
    const target = ce
      ._getCompilationTarget('javascript')!
      .createTarget({ iterationBudget: 5 });
    const block = ce.box([
      'Block',
      [
        'Declare',
        'f',
        "'unknown'",
        ['Function', ['Block', ['Declare', 's', "'unknown'", 0], ['Loop', inc], 's'], 'n'],
      ],
      'f',
    ] as any);
    const r = () => compile(block, { target, fallback: false } as any);
    expect(r).toThrow(/iterationBudget/);
  });

  test('a function literal whose body gives a function declines', () => {
    const curried = ce.box([
      'Function',
      ['Function', ['Block', ['Declare', 's', "'unknown'", 0], ['Loop', inc], 's'], 'y'],
      'x',
    ] as any);
    expect(() => js(curried, { iterationBudget: 5 })).toThrow(/iterationBudget/);
  });

  test('a function value with no `Loop` does not decline', () => {
    ce.assign('double', ce.box(['Function', ['Multiply', 2, 'x'], 'x'] as any));
    const result = js(ce.symbol('double'), { iterationBudget: 5 });
    expect(result.success).toBe(true);
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
  test('the emitted text holds no check', () => {
    const result = js(bareLoop());
    expect(result.code).toBe(
      '(() => {\nlet s = 0;\n{\nwhile (true) {\ns = s + 1\n}\n};\nreturn s\n})()'
    );
    expect(result.preamble).toBeUndefined();
  });

  test.each([
    ['no indexing set', bareLoop],
    ['a counted range', counted],
    ['a list', forEach],
    ['a user function', twoCalls],
    ['a function literal', lambda],
  ])('%s: no field of the result names the count', (_, expr) => {
    for (const compiled of [js, interval])
      expect(JSON.stringify(stored(compiled(expr())))).not.toContain('LoopPass');
  });

  test.each([
    ['no indexing set', bareLoop],
    ['a counted range', counted],
    ['a list', forEach],
    ['a user function', twoCalls],
  ])(
    '%s: the code with the budget is the code without, plus the count',
    (_, expr) => {
      const clean = (s: string | undefined) =>
        (s ?? '')
          .replace(/_SYS\.countLoopPass\(10\); /g, '')
          .replace(/_SYS\.resetLoopPasses\(\); /g, '')
          .trim();
      const plain = js(expr());
      const limited = js(expr(), { iterationBudget: 10 });
      expect(`${limited.code} ${limited.preamble}`).toContain(
        'countLoopPass(10)'
      );
      expect(clean(limited.code)).toBe(plain.code);
      expect(clean(limited.preamble)).toBe((plain.preamble ?? '').trim());
    }
  );

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
      const { run, code } = interval(symbolic, { iterationBudget: 10 });
      expect(code).toContain("< 10)) return { kind: 'entire' }");
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
      const { run: runLiteral, code: literalCode } = interval(literal, {
        iterationBudget: 1e6,
      });
      expect(literalCode).toContain('for (let i = 1;');
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

  test('a user function counts in the total of the call', () => {
    const load = createJavaScriptRuntime().load(
      stored(js(twoCalls(), { iterationBudget: 7 }))
    );
    expect(load({ m: 3 })).toBe(7);
    expectLimit(() => load({ m: 4 }));
    expect(load({ m: 3 })).toBe(7);
  });

  test('a function literal', () => {
    const load = createJavaScriptRuntime().load(
      stored(js(lambda(), { iterationBudget: 3 }))
    );
    expect(load(3)).toBe(3);
    expect(load(3)).toBe(3);
    expectLimit(() => load(4));
  });

  test('a value that holds a loop, read twice', () => {
    ce.assign(
      'held',
      ce.box([
        'Block',
        ['Declare', 's', "'unknown'", 0],
        ['Loop', inc, ['Element', 'i', ['Range', 1, 3]]],
        's',
      ] as any)
    );
    const r = js(ce.box(['Add', 'held', ['Multiply', 'held', 'm']] as any), {
      iterationBudget: 6,
    });
    // The code reads the value at each use, so each read runs its 3 passes.
    expect(r.run!({ m: 2 })).toBe(9);
    expectLimit(() =>
      js(ce.box(['Add', 'held', ['Multiply', 'held', 'm']] as any), {
        iterationBudget: 5,
      }).run!({ m: 2 })
    );
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

  test('the batch body starts each cell at 0', () => {
    const local = new ComputeEngine();
    local.declare('m', 'integer');
    local.declare('L', 'list<real>');
    const body = local.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', ['At', 'L', 'i']]],
        ['Element', 'i', ['Range', 1, 'm']],
      ],
      's',
    ] as any);
    const result = js(body, { iterationBudget: 3, broadcast: true });
    expect(JSON.stringify(stored(result.batch ?? {}))).toContain(
      'resetLoopPasses'
    );
    const out = result.broadcast!({
      m: new Float64Array([1, 2, 3, 4, 2]),
      L: [10, 20, 30, 40],
    } as any);
    expect([...(out as Float64Array)]).toEqual([10, 30, 60, NaN, 30]);
  });
});

describe('COMPILE Loop - iterationBudget on interval-js', () => {
  test.each([
    ['a loop with no indexing set', bareLoop],
    ['a break test that never succeeds', neverBreaks],
    ['a range of 1..1e12', hugeRange],
  ])('%s throws', (_, expr) => {
    const { run, success } = interval(expr(), { iterationBudget: 1000 });
    expect(success).toBe(true);
    expectLimit(() => run!({}));
  });

  test('below and at the budget it gives the value with no budget', () => {
    const free = interval(counted()).run!({});
    expect(free).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
    expect(interval(counted(), { iterationBudget: 4 }).run!({})).toEqual(free);
    expect(interval(counted(), { iterationBudget: 3 }).run!({})).toEqual(free);
    expectLimit(() => interval(counted(), { iterationBudget: 2 }).run!({}));
  });

  test('a loop in a user function counts in the same total', () => {
    const { run } = interval(twoCalls(), { iterationBudget: 7 });
    expect(run!({ m: 3 })).toEqual({ kind: 'interval', value: { lo: 7, hi: 7 } });
    expectLimit(() => run!({ m: 4 }));
    expect(run!({ m: 3 })).toEqual({ kind: 'interval', value: { lo: 7, hi: 7 } });
  });

  test('a function-valued root counts one total for each call', () => {
    const { run } = interval(lambda(), { iterationBudget: 3 });
    const call = run as unknown as (n: number) => unknown;
    const three = { kind: 'interval', value: { lo: 3, hi: 3 } };
    expect(call(3)).toEqual(three);
    expect(call(3)).toEqual(three);
    expectLimit(() => call(4));
  });

  test('a symbol root has its own total in each call', () => {
    const { run } = interval(ce.symbol('countTo'), { iterationBudget: 3 });
    const call = run as unknown as (n: number) => unknown;
    const three = { kind: 'interval', value: { lo: 3, hi: 3 } };
    expect(call(3)).toEqual(three);
    expect(call(3)).toEqual(three);
    expectLimit(() => call(4));
  });

  test('a host that puts `preamble` and `code` together resets in each call', () => {
    const { code, preamble } = interval(lambda(), { iterationBudget: 3 });
    const fn = new Function('_IA', `${preamble}\nreturn ${code};`)(
      IntervalArithmetic
    ) as (n: unknown) => unknown;
    const n3 = { lo: 3, hi: 3 };
    fn(n3);
    fn(n3);
    expectLimit(() => fn({ lo: 4, hi: 4 }));
    fn(n3);
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

  test('createIntervalRuntime() keeps the limit of a function-valued root', () => {
    const load = createIntervalRuntime().load(
      stored(interval(lambda(), { iterationBudget: 3 }))
    );
    expect(load(3)).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
    expectLimit(() => load(4));
  });
});

describe('COMPILE Loop - iterationBudget on the other targets', () => {
  test('python declines a program with a `Loop`', () => {
    expect(() =>
      compile(counted(), {
        to: 'python',
        fallback: false,
        iterationBudget: 5,
      } as any)
    ).toThrow(/iterationBudget/);
  });

  test('python with a fallback runs in the interpreter', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = compile(counted(), {
        to: 'python',
        iterationBudget: 5,
      } as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('iterationBudget');
    } finally {
      warn.mockRestore();
    }
  });

  test('python compiles a `Loop` with no budget, and a `Sum` with one', () => {
    const plain = compile(counted(), { to: 'python', fallback: false } as any);
    expect(plain.success).toBe(true);
    const sum = ce.box(['Sum', 'i', ['Limits', 'i', 1, 'm']] as any);
    expect(
      compile(sum, { to: 'python', fallback: false, iterationBudget: 5 } as any)
        .code
    ).toBe(compile(sum, { to: 'python', fallback: false } as any).code);
  });

  // On GLSL the budget is the pass cap of the evaluation (default 10,000):
  // only the cap in the counted code changes.
  test.each(['glsl'])('%s: only the pass cap changes', (to) => {
    const options = { to, fallback: false } as any;
    expect(
      compile(counted(), { ...options, iterationBudget: 2 }).code
    ).toBe(compile(counted(), options).code.replaceAll('> 10000', '> 2'));
    expect(() =>
      compile(bareLoop(), { ...options, iterationBudget: 2 })
    ).toThrow(/Loop/);
  });

  test('the `bigint` mode declines a `Loop`, so no throw can become `NaN`', () => {
    const loop = ce.box(['Loop', ['Add', 'm', 1]] as any);
    for (const options of [{}, { iterationBudget: 2 }])
      expect(() =>
        compile(loop, {
          fallback: false,
          mode: 'bigint',
          ...options,
        } as any)
      ).toThrow(/bigint/);
  });
});
