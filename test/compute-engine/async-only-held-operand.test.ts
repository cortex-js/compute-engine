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
    expect(
      (await ce.box(['Less', 15, ['AsyncOnly', 2]]).evaluateAsync()).symbol
    ).toBe('False');
    expect(
      (await ce.box(['Less', 3, ['AsyncOnly', 2]]).evaluateAsync()).symbol
    ).toBe('True');
    expect(
      (await ce.box(['Equal', ['AsyncOnly', 2], 7]).evaluateAsync()).symbol
    ).toBe('True');
  });

  test('nested inside an operand', async () => {
    const ce = withAsyncOnly();
    expect(
      (await ce.box(['Less', ['Add', 1, ['AsyncOnly', 2]], 10]).evaluateAsync())
        .symbol
    ).toBe('True');
  });

  test('a conditional and a logic connective', async () => {
    const ce = withAsyncOnly();
    expect(
      (
        await ce
          .box([
            'If',
            ['Less', ['AsyncOnly', 2], 10],
            { str: 'yes' },
            { str: 'no' },
          ])
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
      (
        await ce
          .box(['And', 'True', ['Greater', ['AsyncOnly', 2], 3]])
          .evaluateAsync()
      ).symbol
    ).toBe('True');
  });

  test('an asynchronous-only ARM of If and Which is awaited too', async () => {
    const ce = withAsyncOnly();
    expect(
      (await ce.box(['If', 'True', ['AsyncOnly', 1], 0]).evaluateAsync()).re
    ).toBe(6);
    expect(
      (
        await ce
          .box(['Which', 'False', 0, 'True', ['AsyncOnly', 2]])
          .evaluateAsync()
      ).re
    ).toBe(7);
  });

  test('an unreachable arm is not run', async () => {
    // The pre-pass is for operators that demand every held operand; a
    // selecting operator keeps its own order, so the untaken arm's
    // asynchronous application never runs.
    const ce = withAsyncOnly();
    expect(
      (await ce.box(['If', 'False', ['AsyncOnly', 1], 0]).evaluateAsync()).re
    ).toBe(0);
    expect(ce.calls).toBe(0);
    expect(
      (
        await ce
          .box(['Which', 'True', 0, 'True', ['AsyncOnly', 1]])
          .evaluateAsync()
      ).re
    ).toBe(0);
    expect(ce.calls).toBe(0);
    expect(
      (
        await ce
          .box(['And', 'False', ['Greater', ['AsyncOnly', 1], 3]])
          .evaluateAsync()
      ).symbol
    ).toBe('False');
    expect(ce.calls).toBe(0);
  });

  test('a selecting operator NESTED in a held operand keeps its unreached arm', async () => {
    // The walk stops at `If`/`Which` at any depth: the untaken arm's
    // application neither runs nor lets a fault of its own escape.
    const ce = withAsyncOnly();
    expect(
      (
        await ce
          .box(['Less', 1, ['If', 'False', ['AsyncOnly', 999], 3]])
          .evaluateAsync()
      ).symbol
    ).toBe('True');
    expect(ce.calls).toBe(0);
    ce.declare('AsyncFail', {
      signature: '(number) -> number',
      evaluateAsync: async () => {
        throw new Error('must not run');
      },
    } as never);
    expect(
      (
        await ce
          .box(['Less', 1, ['If', 'False', ['AsyncFail', 1], 3]])
          .evaluateAsync()
      ).symbol
    ).toBe('True');
    // The taken arm is still awaited through `If`'s own asynchronous twin.
    expect(
      (
        await ce
          .box(['Less', 1, ['If', 'True', ['AsyncOnly', 1], 3]])
          .evaluateAsync()
      ).symbol
    ).toBe('True');
    expect(ce.calls).toBe(1);
  });

  test('an engine with no asynchronous-only operator skips the walk', async () => {
    const plain = new ComputeEngine();
    expect(plain._hasAsyncOnlyOperator).toBe(false);
    expect((await plain.box(['Less', 1, 2]).evaluateAsync()).symbol).toBe(
      'True'
    );
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
    expect(ce.box(['Less', 15, ['AsyncOnly', 2]]).evaluate().operator).toBe(
      'Less'
    );
  });

  test('a block awaits an asynchronous-only statement', async () => {
    // The pre-pass does not enter a scoped operator; the block's own
    // asynchronous handler evaluates its statements in order and awaits.
    const ce = withAsyncOnly();
    const block = await ce
      .box([
        'Block',
        ['Declare', 'x', "'unknown'", 1],
        ['AsyncOnly', 'x'],
      ] as never)
      .evaluateAsync();
    expect(block.json).toBe(6);
    expect(ce.calls).toBe(1);
  });

  test('a big operator awaits an asynchronous-only application in its body', async () => {
    // Per-term: the enumeration substitutes the index, then each term is
    // awaited, on the `Element`, `Limits` and collection forms alike.
    const ce = withAsyncOnly();
    const element = await ce
      .box([
        'Sum',
        ['AsyncOnly', 'i'],
        ['Element', 'i', ['Range', 1, 3]],
      ] as never)
      .evaluateAsync();
    expect(element.json).toBe(21);
    expect(ce.calls).toBe(3);
    const limits = await ce
      .box([
        'Sum',
        ['Multiply', 2, ['AsyncOnly', 'k']],
        ['Limits', 'k', 1, 4],
      ] as never)
      .evaluateAsync();
    expect(limits.json).toBe(60);
    const product = await ce
      .box(['Product', ['AsyncOnly', 'i'], ['Limits', 'i', 1, 2]] as never)
      .evaluateAsync();
    expect(product.json).toBe(42);
    const collection = await ce
      .box(['Sum', ['List', ['AsyncOnly', 1], 2]] as never)
      .evaluateAsync();
    expect(collection.json).toBe(8);
    const nested = await ce
      .box([
        'Sum',
        ['Block', ['AsyncOnly', 'i']],
        ['Limits', 'i', 1, 2],
      ] as never)
      .evaluateAsync();
    expect(nested.json).toBe(13);
  });

  test('each term is awaited while its index assignment is in force', async () => {
    // A body that ASSIGNS the index reads the loop's binding for its
    // iteration, then its own write: `k = 1` → `AsyncOnly(2)`, `k = 2` →
    // `AsyncOnly(3)`. Substituting the index into the body up front would
    // have rewritten the assignment target instead.
    const ce = withAsyncOnly();
    const sum = await ce
      .box([
        'Sum',
        ['Block', ['Assign', 'k', ['Add', 'k', 1]], ['AsyncOnly', 'k']],
        ['Limits', 'k', 1, 2],
      ] as never)
      .evaluateAsync();
    expect(sum.json).toBe(15);
  });

  test('an abort during the asynchronous terms cancels the fold', async () => {
    const ce = withAsyncOnly();
    const controller = new AbortController();
    setTimeout(() => controller.abort('stop'), 2);
    const sum = ce.box([
      'Sum',
      ['AsyncOnly', 'i'],
      ['Limits', 'i', 1, 100000],
    ] as never);
    await expect(
      sum.evaluateAsync({ signal: controller.signal } as never)
    ).rejects.toThrow();
    expect(ce.calls).toBeLessThan(100000);
  });

  test('a big operator without such an application keeps the synchronous fold', async () => {
    const ce = withAsyncOnly();
    const sum = ce.box([
      'Sum',
      ['Power', 'i', 2],
      ['Limits', 'i', 1, 3],
    ] as never);
    expect((await sum.evaluateAsync()).json).toBe(14);
    expect(sum.evaluate().json).toBe(14);
    // The synchronous route cannot run the handler: inert, by design.
    const inert = ce.box([
      'Sum',
      ['AsyncOnly', 'i'],
      ['Limits', 'i', 1, 3],
    ] as never);
    expect(inert.evaluate().has('AsyncOnly')).toBe(true);
    expect(ce.calls).toBe(0);
  });
});

// `NextCount()` gives 1, 2, 3, … at its successive runs, so a value shows
// which run produced it. `Mark()` is a host function with a synchronous
// handler. `order` records the runs of both.
function withCounter(): ComputeEngine & { order: string[] } {
  const ce = new ComputeEngine() as ComputeEngine & { order: string[] };
  ce.order = [];
  let count = 0;
  ce.declare('NextCount', {
    signature: '() -> integer',
    pure: false,
    evaluateAsync: async () => {
      ce.order.push('NextCount');
      count += 1;
      return ce.number(count);
    },
  } as never);
  ce.declare('Mark', {
    signature: '() -> integer',
    pure: false,
    evaluate: () => {
      ce.order.push('Mark');
      return ce.number(100);
    },
  } as never);
  return ce;
}

describe('an asynchronous-only application under a list operand runs once', () => {
  test('an entry of a nested list', async () => {
    const ce = withCounter();
    const nested = await ce
      .box(['List', ['List', ['NextCount'], 2], ['List', 3, 4]])
      .evaluateAsync();
    expect(nested.json).toEqual(['List', ['List', 1, 2], ['List', 3, 4]]);
    expect(ce.order).toEqual(['NextCount']);
  });

  test('the entries of a nested list run in the order of the entries', async () => {
    const ce = withCounter();
    const nested = await ce
      .box([
        'List',
        ['List', ['Mark'], ['NextCount']],
        ['List', ['List', ['NextCount']], ['Mark']],
      ])
      .evaluateAsync();
    expect(nested.json).toEqual([
      'List',
      ['List', 100, 1],
      ['List', ['List', 2], 100],
    ]);
    expect(ce.order).toEqual(['Mark', 'NextCount', 'NextCount', 'Mark']);
  });

  test('a list entry of a tuple', async () => {
    const ce = withCounter();
    const tuple = await ce
      .box(['Tuple', ['List', ['NextCount'], 2], ['NextCount']])
      .evaluateAsync();
    expect(tuple.json).toEqual(['Tuple', ['List', 1, 2], 2]);
    expect(ce.order).toEqual(['NextCount', 'NextCount']);
  });

  test('a list operand of an operator that maps over its cells', async () => {
    // `Add` can lift a conditional operand, so the applications under its
    // list operand are awaited before the lift is tried. No operand is
    // conditional here: the asynchronous handler of `Add` gets the awaited
    // values.
    const ce = withCounter();
    const sum = await ce
      .box(['Add', ['List', ['NextCount'], 2], 1])
      .evaluateAsync();
    expect(sum.json).toEqual(['List', 2, 3]);
    expect(ce.order).toEqual(['NextCount']);
  });

  test('a list operand of a comparison', async () => {
    const ce = withCounter();
    const equal = await ce
      .box(['Equal', ['List', ['NextCount'], 2], ['List', 1, 2]])
      .evaluateAsync();
    expect(equal.symbol).toBe('True');
    expect(ce.order).toEqual(['NextCount']);
  });

  test('a list operand beside a conditional operand that is lifted', async () => {
    const ce = withCounter();
    ce.declare('c', 'real');
    const sum = await ce
      .box([
        'Add',
        ['List', ['NextCount'], 2],
        ['If', ['Greater', 'c', 0], 3],
      ])
      .evaluateAsync();
    expect(sum.json).toEqual([
      'List',
      ['If', ['Less', 0, 'c'], 4],
      ['If', ['Less', 0, 'c'], 5],
    ]);
    expect(ce.order).toEqual(['NextCount']);
  });

  test('a matrix operand', async () => {
    const ce = withCounter();
    const product = await ce
      .box([
        'MatrixMultiply',
        ['List', ['List', ['NextCount'], 0], ['List', 0, 1]],
        ['List', ['List', 1, 0], ['List', 0, 1]],
      ])
      .evaluateAsync();
    expect(product.json).toEqual(['List', ['List', 1, 0], ['List', 0, 1]]);
    expect(ce.order).toEqual(['NextCount']);
  });

  test('under a numeric approximation', async () => {
    const ce = withCounter();
    const nested = await ce
      .box(['List', ['List', ['Divide', ['NextCount'], 4], 2]])
      .evaluateAsync({ numericApproximation: true });
    expect(nested.json).toEqual(['List', ['List', 0.25, 2]]);
    const sum = await ce
      .box(['Add', ['List', ['Divide', ['NextCount'], 4], 2], 1])
      .evaluateAsync({ numericApproximation: true });
    expect(sum.json).toEqual(['List', 1.5, 3]);
    expect(ce.order).toEqual(['NextCount', 'NextCount']);
  });
});
