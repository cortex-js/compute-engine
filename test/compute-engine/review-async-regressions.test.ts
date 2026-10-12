import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';

const slowSum = [
  'Sum',
  ['Divide', 1, ['Power', 'k', 2]],
  ['Limits', 'k', 1, 400000],
];

function asyncOnly(ce: ComputeEngine) {
  ce.declare('AsyncOnly', {
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => ce.number(x.re + 5),
  } as never);
}

function valueFunction(ce: ComputeEngine, body: any, parameter = 'k') {
  ce.declare('v', 'function');
  ce.assign('v', ce.box(['Function', body, parameter]));
}

async function aborts(expr: ReturnType<ComputeEngine['box']>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await expect(
      expr.evaluateAsync({ signal: controller.signal })
    ).rejects.toMatchObject({ name: 'CancellationError' });
  } finally {
    clearTimeout(timer);
  }
}

describe('asynchronous evaluation regression cases', () => {
  test('two activations of one Sum have private index bindings', async () => {
    const ce = new ComputeEngine();
    ce._debugBindings = true;
    ce.assign('k', 99);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    ce.declare('Gate', {
      signature: '() -> number',
      pure: false,
      evaluateAsync: async () => {
        if (++calls === 1) {
          entered();
          await gate;
        }
        return ce.Zero;
      },
    } as never);
    ce.declare('PickSecond', {
      signature: '(number, number) -> number',
      pure: false,
      evaluate: ([_a, b]) => b,
    });
    const expr = ce.box([
      'Sum',
      ['PickSecond', ['Gate'], 'k'],
      ['Limits', 'k', 1, 3],
    ]);
    const depth = ce.contextStack.length;
    const first = expr.evaluateAsync();
    await started;
    try {
      expect((await expr.evaluateAsync()).toString()).toBe('6');
    } finally {
      release();
    }
    expect((await first).toString()).toBe('6');
    expect(ce.symbol('k').evaluate().re).toBe(99);
    expect(ce.contextStack.length).toBe(depth);
    expect((await expr.evaluateAsync()).toString()).toBe('6');
  });

  test('synchronous nested Blocks read asynchronous Sum and Loop activations', async () => {
    const ce = new ComputeEngine();
    const lines: string[] = [];
    ce.effects = {
      console: {
        log: (line) => {
          lines.push(line);
        },
        readLine: () => undefined,
      },
    };
    const expr = ce.box([
      'Block',
      ['Sum', ['Block', ['Print', 'k'], 'k'], ['Limits', 'k', 1, 3]],
      [
        'Loop',
        ['Block', ['Print', { str: 'loop' }, 'j']],
        ['Element', 'j', ['Range', 1, 2]],
      ],
    ]);
    await expr.evaluateAsync();
    expect(lines).toEqual(['1', '2', '3', 'loop 1', 'loop 2']);
    lines.length = 0;
    expr.evaluate();
    expect(lines).toEqual(['1', '2', '3', 'loop 1', 'loop 2']);
  });

  test('ordinary Block locals escape in lazy collections after async evaluation', async () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 1;
    const expr = ce.box([
      'Block',
      ['Assign', 'xs', ['Range', 1, 3]],
      ['Map', ['Function', ['Add', 'x', 1], 'x'], 'xs'],
    ]);
    const sync = expr.evaluate();
    const async = await expr.evaluateAsync();
    expect(sync.isLazyCollection).toBe(true);
    expect(async.isLazyCollection).toBe(true);
    expect(Array.from(sync.each(), (x) => x.re)).toEqual([2, 3, 4]);
    expect(Array.from(async.each(), (x) => x.re)).toEqual([2, 3, 4]);
  });

  test('a value-backed function awaits each list and tuple cell', async () => {
    const ce = new ComputeEngine();
    asyncOnly(ce);
    valueFunction(ce, ['AsyncOnly', 'k']);
    expect((await ce.box(['v', 2]).evaluateAsync()).toString()).toBe('7');
    expect(
      (await ce.box(['v', ['List', 1, 2]]).evaluateAsync()).toString()
    ).toBe('[6,7]');
    ce.declare('t', '(real) -> number');
    ce.assign(
      't',
      ce.box(['Function', ['AsyncOnly', 'x'], ['Typed', 'x', 'real']])
    );
    expect(
      (await ce.box(['t', ['Tuple', 1, 2]]).evaluateAsync()).toString()
    ).toBe('(6, 7)');
  });

  test('ApplyWhole binds caller locals inside lazy collection arguments', async () => {
    const ce = new ComputeEngine();
    ce.assign('n', 1);
    const fn = ce.box([
      'Function',
      ['Block', ['Declare', 'n', 'real', 99], ['Sum', 'xs']],
      'xs',
    ]);
    // Box before entering the caller's scope: the collection's free n has
    // an outer binding, but must read the caller's ordinary shadow at call.
    const source = ce.box([
      'Comprehension',
      'n',
      ['Element', 'j', ['Range', 1, 2]],
    ]);
    ce.pushScope();
    ce.declare('n', { value: 7 });
    try {
      const expr = ce.function('ApplyWhole', [fn, source]);
      expect(source.isLazyCollection).toBe(true);
      expect(expr.evaluate().toString()).toBe('14');
      expect((await expr.evaluateAsync()).toString()).toBe('14');
      expect(
        (await expr.evaluateAsync({ numericApproximation: true })).toString()
      ).toBe('14');
    } finally {
      ce.popScope();
    }
  });

  test('declared broadcast retains whole lazy arguments and caller bindings', async () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 1;
    ce.assign('n', 1);
    ce.declare('total', '(broadcastable<list<number>>) -> number');
    ce.assign(
      'total',
      ce.box([
        'Function',
        ['Block', ['Declare', 'n', 'real', 99], ['Sum', 'xs']],
        'xs',
      ])
    );
    const source = ce.box([
      'Comprehension',
      'n',
      ['Element', 'j', ['Range', 1, 2]],
    ]);
    ce.pushScope();
    ce.declare('n', { value: 7 });
    try {
      const expr = ce.function('total', [ce.function('List', [source])]);
      const sync = Array.from(expr.evaluate().each(), (x) => x.re);
      const async = Array.from(
        (await expr.evaluateAsync()).each(),
        (x) => x.re
      );
      expect(sync).toEqual([14]);
      expect(async).toEqual(sync);
    } finally {
      ce.popScope();
    }
  });

  test.each([false, true])(
    'ApplyWhole retains list-recursion results, numeric %s',
    async (numericApproximation) => {
      const ce = new ComputeEngine();
      ce.recursionLimit = 4;
      ce.iterationLimit = 101;
      ce.declare('F', '(number) -> list<number>');
      ce.assign(
        'F',
        ce.box([
          'Function',
          [
            'Which',
            ['Equal', 'n', 20],
            ['List', 'n'],
            'True',
            ['Join', ['List', 'n'], ['F', ['Add', 'n', 1]]],
          ],
          'n',
        ])
      );
      const expr = ce.function('ApplyWhole', [ce.symbol('F').value!, ce.Zero]);
      const sync = Array.from(
        expr.evaluate({ numericApproximation }).each(),
        (x) => x.re
      );
      const async = Array.from(
        (await expr.evaluateAsync({ numericApproximation })).each(),
        (x) => x.re
      );
      expect(sync).toEqual(Array.from({ length: 21 }, (_, i) => i));
      expect(async).toEqual(sync);
    }
  );

  test('a value-backed function broadcast honours cancellation', async () => {
    const ce = new ComputeEngine();
    valueFunction(ce, slowSum);
    await aborts(ce.box(['v', ['List', 1]]));
    expect((await ce.box(['v', ['List']]).evaluateAsync()).isValid).toBe(true);
  });

  test('Sum and Product await asynchronous-only calls in helper bodies', async () => {
    const ce = new ComputeEngine();
    asyncOnly(ce);
    ce.assign('f', ce.box(['Function', ['AsyncOnly', 'k'], 'k']));
    expect((await ce.box(['f', 2]).evaluateAsync()).toString()).toBe('7');
    expect(
      (
        await ce.box(['Sum', ['f', 'k'], ['Limits', 'k', 1, 3]]).evaluateAsync()
      ).toString()
    ).toBe('21');
    expect(
      (
        await ce
          .box(['Product', ['f', 'k'], ['Limits', 'k', 1, 3]])
          .evaluateAsync()
      ).toString()
    ).toBe('336');
  });

  test('adaptive numeric goals re-evaluate pure async applications at each precision', async () => {
    const ce = new ComputeEngine();
    const seen: number[] = [];
    ce.declare('AsyncPi', {
      signature: '() -> number',
      evaluateAsync: async (_ops, options) => {
        seen.push(options.engine.precision);
        return ce.symbol('Pi').N();
      },
    } as never);
    const goal = ['List', 30, 'PositiveInfinity'];
    expect(
      (await ce.box(['N', ['AsyncPi'], goal]).evaluateAsync()).toString()
    ).toBe(ce.box(['N', 'Pi', goal]).evaluate().toString());
    expect(new Set(seen).size).toBeGreaterThan(1);
    expect(ce.precision).toBe(21);
  });

  test.each([
    { request: 10 },
    { request: 30 },
    { request: ['List', 30, 'PositiveInfinity'] },
  ])('N preserves effect order for request $request', async ({ request }) => {
    const ce = new ComputeEngine();
    let counter = 0;
    ce.declare('Tick', {
      signature: '() -> number',
      pure: false,
      evaluate: () => ce.number(++counter),
    });
    ce.declare('AsyncRead', {
      signature: '() -> number',
      pure: false,
      evaluateAsync: async () => ce.number(counter),
    } as never);
    expect(
      (
        await ce
          .box(['N', ['List', ['Tick'], ['AsyncRead']], request])
          .evaluateAsync()
      ).toString()
    ).toBe('[1,1]');
    expect(counter).toBe(1);
  });

  test('expression-valued symbols await their values and preserve free bindings', async () => {
    const ce = new ComputeEngine();
    asyncOnly(ce);
    ce.assign('x', 10);
    ce.declare('s', { value: ce.box(['Add', 'x', ['AsyncOnly', 2]]) });
    ce.pushScope();
    ce.declare('x', { value: 99 });
    try {
      expect((await ce.symbol('s').evaluateAsync()).toString()).toBe('17');
      expect((await ce.box(['N', 's', 30]).evaluateAsync()).toString()).toBe(
        '17'
      );
    } finally {
      ce.popScope();
    }
  });

  test('N keeps the numeric hold semantics of a symbol', async () => {
    const ce = new ComputeEngine();
    ce.declare('held', { value: 3, holdUntil: 'simplify' });
    expect((await ce.symbol('held').evaluateAsync()).toString()).toBe(
      ce.symbol('held').evaluate().toString()
    );
    expect((await ce.box(['N', 'held', 30]).evaluateAsync()).toString()).toBe(
      ce.box(['N', 'held', 30]).evaluate().toString()
    );
  });

  test('a stored Sum yields and honours cancellation', async () => {
    const ce = new ComputeEngine();
    ce.declare('s', { value: ce.box(slowSum, { form: 'raw' }) });
    await aborts(ce.box(['N', 's', 30]));
    expect(ce.precision).toBe(21);
  });

  test('symbol cycles have the synchronous residual and unrelated reads still work', async () => {
    const ce = new ComputeEngine();
    ce.declare('a', { value: ce.box(['Add', 'b', 1], { form: 'raw' }) });
    ce.declare('b', { value: ce.box(['Add', 'a', 1], { form: 'raw' }) });
    expect((await ce.symbol('a').evaluateAsync()).toString()).toBe(
      ce.symbol('a').evaluate().toString()
    );
    asyncOnly(ce);
    ce.declare('s', { value: ce.box(['AsyncOnly', 2], { form: 'raw' }) });
    expect((await ce.symbol('s').evaluateAsync()).toString()).toBe('7');
  });

  test("pending lazy walks use each caller's cancellation signal", async () => {
    const ce = new ComputeEngine();
    ce.declare('CheckSignal', {
      signature: '() -> number',
      evaluateAsync: async (_ops, options) => {
        if (options.signal?.aborted)
          throw new CancellationError({ cause: options.signal.reason });
        return ce.number(42);
      },
    } as never);
    const expr = ce.box(['Append', ['Range', 1, 2], ['CheckSignal']]);
    const cancelled = new AbortController();
    cancelled.abort();
    const healthy = new AbortController();
    const results = await Promise.allSettled([
      expr.evaluateAsync({ signal: cancelled.signal }),
      expr.evaluateAsync({ signal: healthy.signal }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'fulfilled',
    ]);
    expect(
      (await expr.evaluateAsync({ signal: healthy.signal })).toString()
    ).toBe('[1,2,42]');
  });

  test('default concurrent lazy calls still share a walk', async () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Append', ['Range', 1, 2], 3]);
    const [a, b] = await Promise.all([
      expr.evaluateAsync(),
      expr.evaluateAsync(),
    ]);
    expect(a).toBe(b);
  });

  test('custom-handler operand options capture the enclosing precision window', async () => {
    const ce = new ComputeEngine();
    ce.declare('Id', {
      signature: '(number) -> number',
      evaluateAsync: async ([x], options) =>
        x.evaluateAsync({
          numericApproximation: options.numericApproximation,
          signal: options.signal,
        }),
    } as never);
    expect(
      (await ce.box(['N', ['Id', 'Pi'], 40]).evaluateAsync()).toString()
    ).toBe(ce.box(['N', 'Pi', 40]).evaluate().toString());
  });

  test('float Factorial converts its result inside the requested precision window', async () => {
    const ce = new ComputeEngine({ precision: 15 });
    const expr = ce.box(['N', ['Factorial', { num: '300.0' }], 40]);
    expect((await expr.evaluateAsync()).toString()).toBe(
      expr.evaluate().toString()
    );
    expect((await expr.evaluateAsync()).isFinite).toBe(true);
    expect(ce.precision).toBe(15);
  });

  test.each(['PositiveInfinity', 'NegativeInfinity'])(
    'compensated Sum retains %s',
    async (tail) => {
      const ce = new ComputeEngine();
      const values = [{ num: '1.0' }, { num: '1.0e100' }, tail];
      const sum = ce.box(['Sum', ['List', ...values]]);
      const expected = ce
        .box(['Add', ...values])
        .N()
        .toString();
      expect(sum.N().toString()).toBe(expected);
      expect(
        (await sum.evaluateAsync({ numericApproximation: true })).toString()
      ).toBe(expected);
      expect(
        ce.box(['Sum', ['List', { num: '1.0' }, { num: '1.0e100' }, 5]]).N()
          .isFinite
      ).toBe(true);
    }
  );
});
