import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// An assignment to a name that has no binding in the scope chain makes an
// implicit local of the block. The local keeps its value from one run of the
// block to the next inside one evaluation and one function call, and starts
// with no value in a new evaluation and in a new call
// (`sweepCanonicalizationBindings`,
// `src/compute-engine/library/control-structures.ts`).
//
// On the asynchronous route each run of a block runs in a copy of the block
// scope (an activation). Before, the local that a run made stayed in the copy,
// so the next run started with no value for it, and `evaluateAsync()` and
// `evaluate()` gave different values (`beginAsyncRun`, `endAsyncRun`).
//

function box(ce: ComputeEngine, json: unknown): Expression {
  return ce.box(json as Parameters<ComputeEngine['box']>[0]);
}

/**
 * An engine with `Tick`, an operator that has only an `evaluateAsync`
 * handler. A block that holds it runs on the asynchronous route, in an
 * activation of the block scope.
 */
function engineWithTick(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('Tick', {
    signature: '() -> number',
    pure: true,
    evaluateAsync: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return ce.Zero;
    },
  } as never);
  return ce;
}

/** `Σ_{k=1}^{3} (t ≔ t + 1; Tick(); t)`: the terms are `t + 1`, `t + 2`, `t + 3`. */
const SUM_OF_INCREMENTS: unknown = [
  'Sum',
  ['Block', ['Assign', 't', ['Add', 't', 1]], ['Tick'], 't'],
  ['Limits', 'k', 1, 3],
];

/**
 * Define `g(m, r) = Σ_{k=1}^{m} (t ≔ (k = 1 ? (r ? t : 0) : t) + 1; Tick(); t)`.
 * The terms are `1`, `2`, …, so `g(2, False)` is `3`. With `r` true, the
 * first term reads the local `t` before the call assigns it.
 */
function defineCounter(ce: ComputeEngine): void {
  box(ce, [
    'DefineFunction',
    'g',
    [
      'Function',
      [
        'Typed',
        [
          'Block',
          [
            'Sum',
            [
              'Block',
              [
                'Assign',
                't',
                ['Add', ['If', ['Equal', 'k', 1], ['If', 'r', 't', 0], 't'], 1],
              ],
              ['Tick'],
              't',
            ],
            ['Limits', 'k', 1, 'm'],
          ],
        ],
        "'(m: unknown, r: unknown) scope -> unknown'",
      ],
      'm',
      'r',
    ],
  ]).evaluate();
}

describe('an implicit local made in an asynchronous run', () => {
  test('keeps its value for the next run in the same evaluation', async () => {
    const ce = engineWithTick();
    const sum = box(ce, SUM_OF_INCREMENTS);
    expect((await sum.evaluateAsync()).toString()).toBe('3t + 6');
    // A new evaluation starts again with no value for `t`.
    expect((await sum.evaluateAsync()).toString()).toBe('3t + 6');
  });

  test('the same value as the synchronous route, in either order', async () => {
    const ce = engineWithTick();
    const sum = box(ce, SUM_OF_INCREMENTS);
    expect(sum.evaluate().toString()).toBe('3t + 6');
    expect((await sum.evaluateAsync()).toString()).toBe('3t + 6');
    expect(sum.evaluate().toString()).toBe('3t + 6');
  });

  test('a value assigned in one run is read by a later run', async () => {
    // `q` is assigned in the first term only. The second term reads it.
    const ce = engineWithTick();
    const sum = box(ce, [
      'Sum',
      [
        'Block',
        ['If', ['Equal', 'k', 1], ['Assign', 'q', 10], 'Nothing'],
        ['Tick'],
        'q',
      ],
      ['Limits', 'k', 1, 2],
    ]);
    expect((await sum.evaluateAsync()).toString()).toBe('20');
    expect((await sum.evaluateAsync()).toString()).toBe('20');
    expect(sum.evaluate().toString()).toBe('20');
  });

  test('each function call starts with no value for the local', async () => {
    const ce = engineWithTick();
    defineCounter(ce);
    // With `r` true, the first term reads `t` before the call assigns it:
    // the error of a read before assignment in a function body. The call
    // does not read the `t` that the previous call left.
    const calls = box(ce, [
      'Tuple',
      ['g', 2, 'False'],
      ['g', 2, 'True'],
      ['g', 2, 'False'],
    ]);
    const expected =
      '(3, Error(ErrorCode("read-before-declaration", "t", "assignment")), 3)';
    expect((await calls.evaluateAsync()).toString()).toBe(expected);
    expect(calls.evaluate().toString()).toBe(expected);
  });

  test('the local does not leak to the enclosing scope', async () => {
    const ce = engineWithTick();
    const sum = box(ce, SUM_OF_INCREMENTS);
    await sum.evaluateAsync();
    await sum.evaluateAsync();
    expect(box(ce, 't').evaluate().toString()).toBe('t');
  });
});

//
// Asynchronous evaluations of one expression that run at the same time share
// one evaluation number. Each one must read only the locals of its own runs
// (`callActivationKey`, `beginAsyncRun`). Before, a later evaluation read the
// locals that an earlier one had made: `3t + 6`, `3t + 15`, `3t + 24`.
//

describe('asynchronous evaluations that run at the same time', () => {
  test('two evaluations', async () => {
    const ce = engineWithTick();
    const sum = box(ce, SUM_OF_INCREMENTS);
    const values = await Promise.all([
      sum.evaluateAsync(),
      sum.evaluateAsync(),
    ]);
    expect(values.map((v) => v.toString())).toEqual(['3t + 6', '3t + 6']);
  });

  test('three evaluations', async () => {
    const ce = engineWithTick();
    const sum = box(ce, SUM_OF_INCREMENTS);
    const values = await Promise.all([
      sum.evaluateAsync(),
      sum.evaluateAsync(),
      sum.evaluateAsync(),
    ]);
    expect(values.map((v) => v.toString())).toEqual([
      '3t + 6',
      '3t + 6',
      '3t + 6',
    ]);
    expect(sum.evaluate().toString()).toBe('3t + 6');
  });

  test('three evaluations of a block with no asynchronous-only operator', async () => {
    const ce = new ComputeEngine();
    const sum = box(ce, [
      'Sum',
      ['Block', ['Assign', 't', ['Add', 't', 1]], 't'],
      ['Limits', 'k', 1, 3],
    ]);
    const values = await Promise.all([
      sum.evaluateAsync(),
      sum.evaluateAsync(),
      sum.evaluateAsync(),
    ]);
    expect(values.map((v) => v.toString())).toEqual([
      '3t + 6',
      '3t + 6',
      '3t + 6',
    ]);
  });

  test('an evaluation that starts while a run of another one waits', async () => {
    // Each `Wait()` waits until the test releases it. The second evaluation
    // starts while the first one waits in its second run of the block, and
    // the third one while the second one waits in its first run.
    const ce = new ComputeEngine();
    const waiting: Array<() => void> = [];
    let notify: () => void = () => {};
    ce.declare('Wait', {
      signature: '() -> number',
      pure: true,
      evaluateAsync: async () => {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          notify();
        });
        return ce.Zero;
      },
    } as never);
    const sum = box(ce, [
      'Sum',
      ['Block', ['Assign', 't', ['Add', 't', 1]], ['Wait'], 't'],
      ['Limits', 'k', 1, 3],
    ]);
    // Wait until `count` runs wait, then release the first one that waits.
    const waitFor = async (count: number): Promise<void> => {
      while (waiting.length < count)
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
    };
    const release = () => waiting.shift()!();

    const a = sum.evaluateAsync();
    await waitFor(1);
    release(); // a: run 1 ends
    await waitFor(1); // a waits in run 2
    const b = sum.evaluateAsync();
    await waitFor(2); // b waits in run 1
    const c = sum.evaluateAsync();
    await waitFor(3); // c waits in run 1
    // Release the runs in the order they wait, until all are done.
    let done = false;
    const all = Promise.all([a, b, c]).then((values) => {
      done = true;
      return values;
    });
    while (!done) {
      if (waiting.length > 0) release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const values = await all;
    expect(values.map((v) => v.toString())).toEqual([
      '3t + 6',
      '3t + 6',
      '3t + 6',
    ]);
  });

  test('two calls of a function', async () => {
    const ce = engineWithTick();
    defineCounter(ce);
    // Each call has its own `t`. With one `t` for the two calls, the second
    // call would add 1 to the `t` of the first one, and give `4`.
    const call = box(ce, ['g', 2, 'False']);
    const values = await Promise.all([
      call.evaluateAsync(),
      call.evaluateAsync(),
    ]);
    expect(values.map((v) => v.toString())).toEqual(['3', '3']);
  });
});

//
// A recursive call that runs the same nested block: the enclosing run reads
// its own locals after the call. The application of a function literal that
// starts while another application of it runs saves the bindings of the
// nested scopes of its body and puts them back when it ends
// (`enterNestedBodyScopes`, `src/compute-engine/function-utils.ts`).
//

/** `f(n) = if n ≥ 0 then { <inner> } else 0`, declared with the `scope`
 * effect, so that an implicit local in its body is allowed. */
function defineRecursive(ce: ComputeEngine, inner: unknown): void {
  box(ce, [
    'DefineFunction',
    'f',
    [
      'Function',
      [
        'Typed',
        ['Block', ['If', ['GreaterEqual', 'n', 0], inner, ['Block', 0]]],
        "'(n: unknown) scope -> unknown'",
      ],
      'n',
    ],
  ]).evaluate();
}

const RECURSE: unknown = [
  'If',
  ['Greater', 'n', 0],
  ['Block', ['f', ['Subtract', 'n', 1]]],
  0,
];

describe('a recursive call that runs the same nested block', () => {
  test('an implicit local assigned before the call, read after it', async () => {
    const ce = engineWithTick();
    defineRecursive(ce, ['Block', ['Assign', 't', 'n'], RECURSE, 't']);
    expect(box(ce, ['f', 3]).evaluate().toString()).toBe('3');
    expect((await box(ce, ['f', 3]).evaluateAsync()).toString()).toBe('3');
  });

  test('an implicit local, with an asynchronous-only operator in the block', async () => {
    const ce = engineWithTick();
    defineRecursive(ce, [
      'Block',
      ['Assign', 't', 'n'],
      ['Tick'],
      RECURSE,
      't',
    ]);
    expect((await box(ce, ['f', 3]).evaluateAsync()).toString()).toBe('3');
  });

  test('the value of the call and the local of the enclosing run', async () => {
    // f(3) = 3 + f(2) = 3 + 2 + f(1) = … = 6
    const ce = engineWithTick();
    defineRecursive(ce, [
      'Block',
      ['Assign', 't', 'n'],
      ['Assign', 's', RECURSE],
      ['Add', 't', 's'],
    ]);
    expect(box(ce, ['f', 3]).evaluate().toString()).toBe('6');
    expect((await box(ce, ['f', 3]).evaluateAsync()).toString()).toBe('6');
  });

  test('a `let` local', async () => {
    const ce = engineWithTick();
    defineRecursive(ce, [
      'Block',
      ['Declare', 't'],
      ['Assign', 't', 'n'],
      RECURSE,
      't',
    ]);
    expect(box(ce, ['f', 3]).evaluate().toString()).toBe('3');
    expect((await box(ce, ['f', 3]).evaluateAsync()).toString()).toBe('3');
  });

  test('Epsil', () => {
    expect(
      executeEpsil(
        new ComputeEngine(),
        'function f(n) scope { if n >= 0 { t = n\n if n > 0 { f(n - 1) }\n t } else { 0 } }\nf(3)'
      ).value?.toString()
    ).toBe('3');
    expect(
      executeEpsil(
        new ComputeEngine(),
        'function f(n) { if n >= 0 { let t = n\n let s = if n > 0 { f(n - 1) } else { 0 }\n t + s } else { 0 } }\nf(3)'
      ).value?.toString()
    ).toBe('6');
  });
});
