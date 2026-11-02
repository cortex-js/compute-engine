import { ComputeEngine, compile } from '../../src/compute-engine';
import { createJavaScriptRuntime } from '../../src/runtime';
import type { StoredJavaScript } from '../../src/compute-engine/compilation/javascript-runtime';

/**
 * CE-715, step 4 of `docs/plans/2026-10-31-ce715-bigint-compile-mode.md`:
 * the boundary of `mode: 'bigint'` (§3.4, §3.5).
 *
 * - The wrapper of the compiled entry is in the emitted code: it converts a
 *   `number` integer input to a `bigint`, and it catches the
 *   `NonFiniteValue` of a pole and returns its `number`. So `run()` and the
 *   function that `createJavaScriptRuntime().load()` rebuilds from the
 *   stored code give the same values, with the entry checks on and off.
 * - The entry check refuses a `number` that is not a safe integer and a
 *   value that is neither a `number` nor a `bigint`, and converts the
 *   `number` cells of a `list<integer>` input.
 * - The batch routes (`broadcast()`, `broadcastAsync()`, and the stored
 *   loaders `loadBroadcast`, `loadBroadcastSlice`, `loadBroadcastAsync`)
 *   refuse the mode.
 */

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('m', 'integer');
ce.declare('L', 'list<integer>');

type Json = Parameters<typeof ce.box>[0];
type Vars = Record<string, unknown>;

const MESSAGE_OF_BATCH = /mode 'bigint' cannot be broadcast/;

function compiled(json: Json, entryChecks = true) {
  const r = compile(ce.box(json), {
    mode: 'bigint',
    fallback: false,
    entryChecks,
  });
  expect(r.success).toBe(true);
  expect(r.mode).toBe('bigint');
  return r;
}

/** The fields of a compilation result that a host stores, as plain data. */
function stored(r: ReturnType<typeof compiled>): StoredJavaScript {
  const {
    run: _run,
    broadcast: _b,
    broadcastAsync: _ba,
    willUsePool: _w,
    ...data
  } = r as unknown as Record<string, unknown>;
  return JSON.parse(JSON.stringify(data)) as StoredJavaScript;
}

/** The function that a runtime rebuilds from the stored result. */
function loaded(r: ReturnType<typeof compiled>) {
  return createJavaScriptRuntime().load(stored(r));
}

/** The values of `run()` and of the loaded code for `vars`, which must be
 * the same. Returns the value. */
function both(json: Json, vars: Vars, entryChecks = true): unknown {
  const r = compiled(json, entryChecks);
  const a = r.run!(vars as never);
  const b = loaded(r)(vars);
  expect(b).toEqual(a);
  expect(typeof b).toBe(typeof a);
  return a;
}

/** `run()` and the loaded code both throw an error of class `cls` whose
 * message matches `message`. */
function bothThrow(
  json: Json,
  vars: Vars,
  cls: new (...args: never[]) => Error,
  message?: RegExp,
  entryChecks = true
): void {
  const r = compiled(json, entryChecks);
  for (const fn of [() => r.run!(vars as never), () => loaded(r)(vars)]) {
    expect(fn).toThrow(cls);
    if (message !== undefined) expect(fn).toThrow(message);
  }
}

describe('the number results of §3.4', () => {
  it.each([
    ['n! at n = −1', ['Factorial', 'n'], { n: -1 }, Infinity],
    ['−|n!| at n = −1', ['Negate', ['Abs', ['Factorial', 'n']]], { n: -1 }, Infinity],
    ['n! > 5 at n = −1', ['Greater', ['Factorial', 'n'], 5], { n: -1 }, Infinity],
    ['0·n! at n = −1', ['Multiply', 0, ['Factorial', 'n']], { n: -1 }, Infinity],
    [
      'n! − m! at n = m = −1',
      ['Subtract', ['Factorial', 'n'], ['Factorial', 'm']],
      { n: -1, m: -1 },
      Infinity,
    ],
    [
      'Sum(k!, k = −1..n)',
      ['Sum', ['Factorial', 'k'], ['Limits', 'k', -1, 'n']],
      { n: 3 },
      Infinity,
    ],
    ['Mod(n, m) at m = 0', ['Mod', 'n', 'm'], { n: 5, m: 0 }, NaN],
    [
      'Map(Range(−1, n), k ↦ k!), the whole result',
      ['Map', ['Function', ['Factorial', 'k'], 'k'], ['Range', -1, 'n']],
      { n: 3 },
      Infinity,
    ],
  ] as const)('%s is a number', (_, json, vars, value) => {
    for (const checks of [true, false]) {
      const result = both(json as Json, vars, checks);
      expect(typeof result).toBe('number');
      expect(result).toBe(value);
    }
  });

  it('a finite result next to a pole equals evaluate(): If(n < 0, 0, n!) at n = −1', () => {
    const json: Json = ['If', ['Less', 'n', 0], 0, ['Factorial', 'n']];
    expect(both(json, { n: -1 })).toBe(0n);
    expect(
      ce
        .box(json)
        .subs({ n: ce.number(-1) })
        .evaluate()
        .is(0)
    ).toBe(true);
    expect(both(json, { n: 5 })).toBe(120n);
  });

  it('a boolean result stays a boolean', () => {
    expect(both(['Greater', ['Factorial', 'n'], 5], { n: 3 })).toBe(true);
  });

  it('an error that is not a pole is thrown again', () => {
    // `half` is declared `-> integer`: its body is a checked exact division,
    // which throws a `RangeError` when the quotient is not an integer.
    ce.declare('half', '(integer) -> integer');
    ce.box(['Assign', 'half', ['Function', ['Divide', 'x', 2], 'x']]).evaluate();
    bothThrow(['half', 'n'], { n: 3 }, RangeError);
    expect(both(['half', 'n'], { n: 4 })).toBe(2n);
  });
});

describe('the conversion of an integer input (§3.5)', () => {
  it.each([true, false])(
    'a safe-integer number is converted to a bigint (entry checks %s)',
    (checks) => {
      expect(both(['Add', 'n', 1], { n: 41 }, checks)).toBe(42n);
      expect(both(['Add', 'n', 1], { n: 41n }, checks)).toBe(42n);
      expect(
        both(['Multiply', 'n', 'n'], { n: Number.MAX_SAFE_INTEGER }, checks)
      ).toBe(BigInt(Number.MAX_SAFE_INTEGER) ** 2n);
    }
  );

  it('the entry check refuses a number that is not a safe integer', () => {
    bothThrow(['Add', 'n', 1], { n: 2 ** 60 }, TypeError, /"n".*mode 'bigint'/);
    bothThrow(['Add', 'n', 1], { n: 1.5 }, TypeError, /"n"/);
    bothThrow(['Add', 'n', 1], { n: NaN }, TypeError, /"n"/);
  });

  it('the entry check refuses a string, a boolean and no value', () => {
    bothThrow(['Add', 'n', 1], { n: '3' }, TypeError, /"n".*the string/);
    bothThrow(['Add', 'n', 1], { n: true }, TypeError, /"n"/);
    bothThrow(['Add', 'n', 1], {}, TypeError, /"n".*no value/);
  });

  it('with the entry checks off, a non-integer number fails in BigInt()', () => {
    bothThrow(['Add', 'n', 1], { n: 1.5 }, RangeError, undefined, false);
  });

  it('the stored entry plan records the integer input', () => {
    const r = compiled(['Add', 'n', 1]);
    expect(r.entryPlan?.bigints).toEqual(['n']);
    expect(r.entryPlan?.real).toEqual([]);
    expect(stored(r).mode).toBe('bigint');
  });
});

describe('a list<integer> input (§3.5)', () => {
  const json: Json = ['Add', ['At', 'L', 2], 'n'];

  it('the entry check converts its number cells', () => {
    expect(both(json, { L: [1, 2, 3], n: 1 })).toBe(3n);
    expect(both(json, { L: [1n, 2, 3n], n: 1n })).toBe(3n);
    const r = compiled(json);
    expect(r.entryPlan?.bigintLists).toEqual(['L']);
    expect(r.entryPlan?.lists).toEqual(['L']);
  });

  it('the array of the caller is not changed', () => {
    const L = [1, 2, 3];
    compiled(json).run!({ L, n: 1 } as never);
    expect(L).toEqual([1, 2, 3]);
  });

  it('the entry check refuses a cell that is not an integer', () => {
    bothThrow(json, { L: [1, 2.5], n: 1 }, TypeError, /"L".*element 2/);
    bothThrow(json, { L: [1, '2'], n: 1 }, TypeError, /"L".*element 2/);
    bothThrow(json, { L: [1, 2 ** 60], n: 1 }, TypeError, /"L"/);
  });

  it('with the entry checks off, the host gives bigint cells', () => {
    expect(both(json, { L: [1n, 2n, 3n], n: 1 }, false)).toBe(3n);
  });

  it('a list result is an array of bigint', () => {
    expect(
      both(['Map', ['Function', ['Multiply', 'k', 'n'], 'k'], 'L'], {
        L: [1, 2, 3],
        n: 2,
      })
    ).toEqual([2n, 4n, 6n]);
  });
});

describe('the Function literal at the root: the closure returned to the host', () => {
  const json: Json = ['Function', ['Factorial', 'k'], ['Typed', 'k', "'integer'"]];

  it('converts a number argument and catches a pole', () => {
    for (const checks of [true, false]) {
      const r = compiled(json, checks);
      const run = r.run as unknown as (k: unknown) => unknown;
      const load = loaded(r);
      for (const fn of [run, load]) {
        expect(fn(5)).toBe(120n);
        expect(fn(5n)).toBe(120n);
        expect(fn(-1)).toBe(Infinity);
        expect(fn(25)).toBe(15511210043330985984000000n);
      }
    }
  });

  it('the entry check refuses a string and an unsafe number', () => {
    const r = compiled(json);
    expect(r.entryPlan?.bigints).toEqual([0]);
    const run = r.run as unknown as (k: unknown) => unknown;
    const load = loaded(r);
    for (const fn of [run, load]) {
      expect(() => fn('5')).toThrow(/argument 1.*mode 'bigint'/);
      expect(() => fn(2 ** 60)).toThrow(TypeError);
    }
  });

  it('a list<integer> parameter has its cells converted', () => {
    const r = compiled([
      'Function',
      ['At', 'xs', 1],
      ['Typed', 'xs', "'list<integer>'"],
    ]);
    const run = r.run as unknown as (xs: unknown) => unknown;
    expect(run([7, 8])).toBe(7n);
    expect(loaded(r)([7, 8])).toBe(7n);
    expect(() => run([7.5])).toThrow(/argument 1.*element 1/);
  });

  it('the error of a nested list names the index path of the cell', () => {
    const r = compiled([
      'Function',
      ['Length', 'xs'],
      ['Typed', 'xs', "'list<list<integer>>'"],
    ]);
    const run = r.run as unknown as (xs: unknown) => unknown;
    for (const fn of [run, loaded(r)]) {
      expect(fn([[1], [2, 3]])).toBe(2n);
      expect(() => fn([[1n], [2, 2.5]])).toThrow(/element 2, 2 is/);
    }
  });

  it('an omitted integer parameter with a default value: run() and load() agree', () => {
    const r = compiled([
      'Function',
      ['Add', 'x', 'k'],
      ['Typed', 'x', "'integer'"],
      ['Optional', ['Typed', 'k', "'integer'"], 2],
    ]);
    expect(r.entryPlan?.bigintDefaults).toEqual([1]);
    const run = r.run as unknown as (...args: unknown[]) => unknown;
    const load = loaded(r);
    for (const fn of [run, load]) {
      expect(fn(3)).toBe(5n);
      expect(fn(3, 4)).toBe(7n);
      expect(fn(3n, 4n)).toBe(7n);
      // A default fills an absent argument as it fills an argument that the
      // call leaves out: an explicit `undefined` (`Missing`) and a `NaN`
      // take the default too (R6 of
      // `docs/plans/2026-11-01-absent-value-contract.md`).
      expect(fn(3, undefined)).toBe(5n);
      expect(fn(3, NaN)).toBe(5n);
      // A present argument that is not an integer is still checked.
      expect(() => fn(3, 4.5)).toThrow(/argument 2.*mode 'bigint'/);
    }
  });

  it('a parameter named BigInt does not shadow the conversion', () => {
    for (const checks of [true, false]) {
      const r = compiled(
        ['Function', ['Add', 'BigInt', 1], ['Typed', 'BigInt', "'integer'"]],
        checks
      );
      const run = r.run as unknown as (x: unknown) => unknown;
      for (const fn of [run, loaded(r)]) {
        expect(fn(2)).toBe(3n);
        expect(fn(2n)).toBe(3n);
      }
    }
  });
});

describe('the batch routes refuse the mode (§3.5)', () => {
  it('broadcast() and broadcastAsync()', async () => {
    const r = compiled(['Factorial', 'n']);
    expect(() => r.broadcast!({ n: new Float64Array([1, 2]) })).toThrow(
      MESSAGE_OF_BATCH
    );
    await expect(
      r.broadcastAsync!({ n: new Float64Array([1, 2]) })
    ).rejects.toThrow(MESSAGE_OF_BATCH);
    expect(r.willUsePool!({ n: new Float64Array([1, 2]) })).toBe(false);
  });

  it('the stored loaders, before any batch', () => {
    const data = stored(compiled(['Factorial', 'n']));
    const rt = createJavaScriptRuntime();
    expect(() => rt.loadBroadcast(data)).toThrow(MESSAGE_OF_BATCH);
    expect(() => rt.loadBroadcastSlice(data)).toThrow(MESSAGE_OF_BATCH);
    expect(() => rt.loadBroadcastAsync(data)).toThrow(MESSAGE_OF_BATCH);
  });

  it('a stored result of another mode is not refused', () => {
    const r = compile(ce.box(['Add', 'n', 1]), { mode: 'strict' });
    const data = stored(r as never);
    expect(data.mode).toBe('strict');
    const rt = createJavaScriptRuntime();
    expect(Array.from(rt.loadBroadcast(data)({ n: new Float64Array([1, 2]) }))).toEqual([2, 3]);
  });
});
