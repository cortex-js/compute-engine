import { ComputeEngine } from '../../src/compute-engine';

// An operator declared with only an `evaluateAsync` handler inside the HELD
// operand of a lazy operator: the asynchronous route awaits it before the
// lazy operator's synchronous handler runs, so the handler sees its value.

function withAsyncOnly(): ComputeEngine & { calls: number } {
  const ce = new ComputeEngine() as ComputeEngine & { calls: number };
  ce.calls = 0;
  ce.declare('AsyncOnly', {
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => {
      ce.calls += 1;
      return ce.number((x.re ?? 0) + 5);
    },
  } as never);
  return ce;
}

describe('an asynchronous-only operator inside a held operand', () => {
  test('a comparison', async () => {
    const ce = withAsyncOnly();
    expect((await ce.box(['Less', 15, ['AsyncOnly', 2]]).evaluateAsync()).symbol).toBe('False');
    expect((await ce.box(['Less', 3, ['AsyncOnly', 2]]).evaluateAsync()).symbol).toBe('True');
    expect((await ce.box(['Equal', ['AsyncOnly', 2], 7]).evaluateAsync()).symbol).toBe('True');
  });

  test('nested inside an operand', async () => {
    const ce = withAsyncOnly();
    expect(
      (await ce.box(['Less', ['Add', 1, ['AsyncOnly', 2]], 10]).evaluateAsync()).symbol
    ).toBe('True');
  });

  test('a conditional and a logic connective', async () => {
    const ce = withAsyncOnly();
    expect(
      (
        await ce
          .box(['If', ['Less', ['AsyncOnly', 2], 10], { str: 'yes' }, { str: 'no' }])
          .evaluateAsync()
      ).string
    ).toBe('yes');
    expect(
      (
        await ce
          .box(['Which', ['Greater', ['AsyncOnly', 2], 100], 1, 'True', 0])
          .evaluateAsync()
      ).re
    ).toBe(0);
    expect(
      (await ce.box(['And', 'True', ['Greater', ['AsyncOnly', 2], 3]]).evaluateAsync()).symbol
    ).toBe('True');
  });

  test('an asynchronous-only ARM of If and Which is awaited too', async () => {
    const ce = withAsyncOnly();
    expect((await ce.box(['If', 'True', ['AsyncOnly', 1], 0]).evaluateAsync()).re).toBe(6);
    expect(
      (await ce.box(['Which', 'False', 0, 'True', ['AsyncOnly', 2]]).evaluateAsync()).re
    ).toBe(7);
  });

  test('an unreachable arm is not run', async () => {
    // The pre-pass is for operators that demand every held operand; a
    // selecting operator keeps its own order, so the untaken arm's
    // asynchronous application never runs.
    const ce = withAsyncOnly();
    expect((await ce.box(['If', 'False', ['AsyncOnly', 1], 0]).evaluateAsync()).re).toBe(0);
    expect(ce.calls).toBe(0);
    expect((await ce.box(['Which', 'True', 0, 'True', ['AsyncOnly', 1]]).evaluateAsync()).re).toBe(0);
    expect(ce.calls).toBe(0);
    expect((await ce.box(['And', 'False', ['Greater', ['AsyncOnly', 1], 3]]).evaluateAsync()).symbol).toBe('False');
    expect(ce.calls).toBe(0);
  });

  test('a selecting operator NESTED in a held operand keeps its unreached arm', async () => {
    // The walk stops at `If`/`Which` at any depth: the untaken arm's
    // application neither runs nor lets a fault of its own escape.
    const ce = withAsyncOnly();
    expect(
      (await ce.box(['Less', 1, ['If', 'False', ['AsyncOnly', 999], 3]]).evaluateAsync()).symbol
    ).toBe('True');
    expect(ce.calls).toBe(0);
    ce.declare('AsyncFail', {
      signature: '(number) -> number',
      evaluateAsync: async () => {
        throw new Error('must not run');
      },
    } as never);
    expect(
      (await ce.box(['Less', 1, ['If', 'False', ['AsyncFail', 1], 3]]).evaluateAsync()).symbol
    ).toBe('True');
    // The taken arm is still awaited through `If`'s own asynchronous twin.
    expect(
      (await ce.box(['Less', 1, ['If', 'True', ['AsyncOnly', 1], 3]]).evaluateAsync()).symbol
    ).toBe('True');
    expect(ce.calls).toBe(1);
  });

  test('an engine with no asynchronous-only operator skips the walk', async () => {
    const plain = new ComputeEngine();
    expect(plain._hasAsyncOnlyOperator).toBe(false);
    expect((await plain.box(['Less', 1, 2]).evaluateAsync()).symbol).toBe('True');
    const ce = withAsyncOnly();
    expect(ce._hasAsyncOnlyOperator).toBe(true);
  });

  test('a quoted operand is held as data', async () => {
    const ce = withAsyncOnly();
    const held = await ce.box(['Hold', ['AsyncOnly', 1]]).evaluateAsync();
    expect(held.has('AsyncOnly')).toBe(true);
    expect(ce.calls).toBe(0);
  });

  test('the synchronous route stays inert, by design', () => {
    // `evaluate()` cannot run an asynchronous handler; the comparison keeps
    // the application as it is.
    const ce = withAsyncOnly();
    expect(ce.box(['Less', 15, ['AsyncOnly', 2]]).evaluate().operator).toBe('Less');
  });

  test('a scoped operator is not entered', async () => {
    // The body of a big operator, or the statements of a block, are
    // evaluated by that operator in its own order and scope; an
    // asynchronous-only application there is its own handler's business,
    // and stays until it has one.
    const ce = withAsyncOnly();
    const block = await ce
      .box(['Block', ['Assign', 'x', 1], ['AsyncOnly', 'x']] as never)
      .evaluateAsync();
    expect(block.has('AsyncOnly')).toBe(true);
    const sum = await ce
      .box(['Sum', ['AsyncOnly', 'i'], ['Element', 'i', ['Range', 1, 3]]] as never)
      .evaluateAsync();
    expect(sum.has('AsyncOnly')).toBe(true);
  });
});
