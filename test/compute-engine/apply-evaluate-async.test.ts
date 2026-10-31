import { ComputeEngine } from '../../src/compute-engine';

// `evaluateAsync()` of an anonymous application (`Apply`) and of a pipe
// (`Pipe`) awaits the application, so that an operator in the body that has
// only an `evaluateAsync` handler is evaluated, as on the named route
// (`g(1)` for `g := y ↦ …`). For a body with no such operator, the value is
// the value that `evaluate()` gives.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  // An operator that has only an `evaluateAsync` handler: `evaluate()`
  // leaves `AsyncOnly(x)` unevaluated, `evaluateAsync()` gives `x + 5`.
  ce.declare('AsyncOnly', {
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => ce.number(x.re + 5),
  } as never);
  // An operator that has only an `evaluateAsync` handler and returns the
  // function `x ↦ x + 1`. Its result type is unknown.
  ce.declare('AsyncFactory', {
    signature: '() -> unknown',
    evaluateAsync: async () => ce.box(['Function', ['Add', 'x', 1], 'x']),
  } as never);
  return ce;
}

async function asyncValue(json: unknown, numeric = false): Promise<string> {
  const ce = engine();
  const result = await ce
    .box(json as never)
    .evaluateAsync(numeric ? { numericApproximation: true } : undefined);
  return result.toString();
}

describe('APPLY AWAITS ITS APPLICATION', () => {
  test('a function literal whose body has an asynchronous operator', async () => {
    expect(
      await asyncValue([
        'Apply',
        ['Function', ['Negate', ['AsyncOnly', 'y']], 'y'],
        1,
      ])
    ).toBe('-6');
  });

  test('a composition with an asynchronous step', async () => {
    expect(
      await asyncValue(['Apply', ['Composition', 'Negate', 'AsyncOnly'], 1])
    ).toBe('-6');
  });

  test('a function literal whose body is a block', async () => {
    expect(
      await asyncValue([
        'Apply',
        ['Function', ['Block', ['AsyncOnly', 'y']], 'y'],
        1,
      ])
    ).toBe('6');
  });

  test('a map over a list argument awaits each cell', async () => {
    expect(
      await asyncValue([
        'Apply',
        ['Function', ['AsyncOnly', 'y'], 'y'],
        ['List', 1, 2],
      ])
    ).toBe('[6,7]');
  });

  test('a map over a tuple argument at a scalar parameter awaits each cell', async () => {
    expect(
      await asyncValue([
        'Apply',
        ['Function', ['AsyncOnly', 'u'], ['Typed', 'u', 'real']],
        ['Tuple', 1, 2],
      ])
    ).toBe('(6, 7)');
  });

  test('a cell that the literal refuses is an error in its cell', async () => {
    const ce = engine();
    const expr = ce.box([
      'Apply',
      ['Function', ['AsyncOnly', 'u'], ['Typed', 'u', 'real']],
      ['List', 1, { str: 'a' }],
    ]);
    const result = await expr.evaluateAsync();
    expect(result.operator).toBe('List');
    expect(result.ops![0].toString()).toBe('6');
    // The error in the second cell is the one that `evaluate()` gives.
    expect(result.ops![1].json).toEqual(expr.evaluate().ops![1].json);
    expect(result.ops![1].operator).toBe('Error');
  });
});

describe('APPLY: THE CELLS OF A MAP ARE EVALUATED ROW BY ROW', () => {
  // The elements of a lazy argument (`Map(k ↦ …, Range(1, 3))`) are
  // computed as they are read. Each row is read, and its cell evaluated,
  // before the next row is read, on both routes.
  for (const route of ['evaluate', 'evaluateAsync'] as const)
    test(route, async () => {
      const ce = engine();
      const log: string[] = [];
      ce.declare('Trace', {
        signature: '(number, string) -> number',
        evaluate: ([x, tag]) => {
          log.push(`${tag.string}${x.re}`);
          return x;
        },
      } as never);
      const expr = ce.box([
        'Apply',
        ['Function', ['Trace', 'y', { str: 'cell' }], 'y'],
        ['Map', ['Function', ['Trace', 'k', { str: 'element' }], 'k'], ['Range', 1, 3]],
      ]);
      const result =
        route === 'evaluate' ? expr.evaluate() : await expr.evaluateAsync();
      expect(result.toString()).toBe('[1,2,3]');
      expect(log).toEqual([
        'element1',
        'cell1',
        'element2',
        'cell2',
        'element3',
        'cell3',
      ]);
    });
});

describe('APPLY: EVALUATEASYNC AGREES WITH EVALUATE', () => {
  // A function literal with a jump (`Floor`) in its body, applied to an
  // exact argument whose float is the integer 25: under `.N()` the jump reads
  // the exact argument, so `Floor` gives 24 on both routes.
  const literal = ['Function', ['Add', ['Floor', 'x'], ['Sqrt', 'x']], 'x'];
  const argument = [
    'Divide',
    ['Subtract', ['Factorial', 25], 1],
    ['Factorial', 24],
  ];

  test('a numeric approximation', async () => {
    const ce = engine();
    const expr = ce.box(['Apply', literal, argument]);
    const sync = expr.evaluate({ numericApproximation: true });
    const awaited = await expr.evaluateAsync({ numericApproximation: true });
    expect(awaited.json).toEqual(sync.json);
    expect(awaited.re).toBeCloseTo(29, 10);
  });

  test('a numeric approximation of a map over a list', async () => {
    const ce = engine();
    const expr = ce.box([
      'Apply',
      ['Function', ['Sqrt', 'x'], 'x'],
      ['List', 2, 3],
    ]);
    const sync = expr.evaluate({ numericApproximation: true });
    const awaited = await expr.evaluateAsync({ numericApproximation: true });
    expect(awaited.json).toEqual(sync.json);
  });

  test('an error argument', async () => {
    const ce = engine();
    const expr = ce.box([
      'Apply',
      ['Function', ['Sqrt', 'y'], ['Typed', 'y', 'real']],
      { str: 'abc' },
    ]);
    const sync = expr.evaluate();
    const awaited = await expr.evaluateAsync();
    expect(sync.operator).toBe('Error');
    expect(awaited.json).toEqual(sync.json);
  });

  test('an argument that evaluates to an error', async () => {
    const ce = engine();
    const expr = ce.box([
      'Apply',
      ['Function', ['Sqrt', 'y'], 'y'],
      ['Sqrt', ['Error', { str: 'boom' }]],
    ]);
    const sync = expr.evaluate();
    const awaited = await expr.evaluateAsync();
    expect(sync.operator).toBe('Error');
    expect(awaited.json).toEqual(sync.json);
  });
});

describe('PIPE AWAITS ITS APPLICATION', () => {
  // `x |> f` is `f(x)`, under `evaluateAsync()` too.
  test('a function literal stage', async () => {
    expect(
      await asyncValue([
        'Pipe',
        1,
        ['Function', ['Negate', ['AsyncOnly', 'y']], 'y'],
      ])
    ).toBe('-6');
  });

  test('a stage that is the name of an asynchronous operator', async () => {
    expect(await asyncValue(['Pipe', 1, 'AsyncOnly'])).toBe('6');
  });

  test('a stage whose value is a function returned by an asynchronous operator', async () => {
    // The stage `AsyncFactory()` has an unknown type, so its value is the
    // function to apply: it is awaited first.
    expect(await asyncValue(['Pipe', 1, ['AsyncFactory']])).toBe('2');
  });

  test('a composition stage', async () => {
    expect(
      await asyncValue(['Pipe', 1, ['Composition', 'Negate', 'AsyncOnly']])
    ).toBe('-6');
  });

  test('a chained pipe', async () => {
    expect(
      await asyncValue(['Pipe', ['Pipe', 1, 'AsyncOnly'], 'AsyncOnly'])
    ).toBe('11');
  });

  test('a stage that is a call with an implicit topic', async () => {
    // `xs |> Take(n)` is `Take(xs, n)`, and `AsyncOnly(-3)` is 2.
    expect(
      await asyncValue([
        'Pipe',
        ['List', 1, 2, 3, 4],
        ['Take', ['AsyncOnly', -3]],
      ])
    ).toBe('[1,2]');
  });

  test('a numeric approximation agrees with evaluate', async () => {
    const ce = engine();
    const expr = ce.box([
      'Pipe',
      ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]],
      ['Function', ['Add', ['Floor', 'x'], ['Sqrt', 'x']], 'x'],
    ]);
    const sync = expr.evaluate({ numericApproximation: true });
    const awaited = await expr.evaluateAsync({ numericApproximation: true });
    expect(awaited.json).toEqual(sync.json);
  });
});
