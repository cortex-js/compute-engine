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
  // A list with no value: a walk of `Join([x], v)` misses its elements.
  ce.declare('v', 'list<integer>');
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
        [
          'Map',
          ['Function', ['Trace', 'k', { str: 'element' }], 'k'],
          ['Range', 1, 3],
        ],
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

// The eager collection operators that apply a callback (a reducer, a
// predicate, a key function) await each application under `evaluateAsync()`,
// so that an operator in the callback that has only an `evaluateAsync`
// handler is evaluated. For a callback with no such operator, the value is
// the value that `evaluate()` gives. The elements of a lazy source are still
// computed synchronously when they are read (ROADMAP CE-111.4).

/** The value of `json` under `evaluate()` and under `evaluateAsync()`. */
async function bothValues(json: unknown): Promise<[string, string]> {
  const ce = engine();
  const expr = ce.box(json as never);
  const sync = expr.evaluate().toString();
  const awaited = (await expr.evaluateAsync()).toString();
  return [sync, awaited];
}

const ADD_ASYNC = ['Function', ['Add', 'a', ['AsyncOnly', 'b']], 'a', 'b'];
const ADD = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

describe('REDUCE AND FOLD AWAIT THEIR REDUCER', () => {
  test('a seedless reduce', async () => {
    // 1 + AsyncOnly(2) = 1 + 7
    expect(await asyncValue(['Reduce', ['List', 1, 2], ADD_ASYNC])).toBe('8');
  });

  test('a seeded reduce', async () => {
    expect(await asyncValue(['Reduce', ['List', 1, 2], ADD_ASYNC, 100])).toBe(
      '113'
    );
  });

  test('a fold', async () => {
    // 0 + AsyncOnly(1) + AsyncOnly(2) = 6 + 7
    expect(await asyncValue(['Fold', ADD_ASYNC, 0, ['List', 1, 2]])).toBe('13');
  });

  test('a seed with an asynchronous operator is awaited', async () => {
    // The seed `AsyncOnly(1)` is 6, and the fold over an empty list is
    // the seed.
    expect(await asyncValue(['Fold', ADD, ['AsyncOnly', 1], ['List']])).toBe(
      '6'
    );
  });

  test('a fold under a numeric approximation', async () => {
    expect(await asyncValue(['Reduce', ['List', 1, 2], ADD_ASYNC], true)).toBe(
      '8'
    );
  });

  test('a reducer with no asynchronous operator agrees with evaluate', async () => {
    for (const json of [
      ['Fold', ADD, 0, ['List', 1, 2, 'Nothing']],
      ['Fold', 'Add', 0, ['List', 1, 2]],
      ['Reduce', ['List'], ADD],
      ['Reduce', ['List'], ADD, 7],
    ]) {
      const [sync, awaited] = await bothValues(json);
      expect(awaited).toBe(sync);
    }
  });
});

describe('ANY AND ALL AWAIT THEIR PREDICATE', () => {
  const OVER_SEVEN = ['Function', ['Greater', ['AsyncOnly', 'y'], 7], 'y'];

  test('any', async () => {
    // AsyncOnly(3) = 8 > 7
    expect(await asyncValue(['Any', ['List', 1, 2, 3], OVER_SEVEN])).toBe(
      '"True"'
    );
  });

  test('all', async () => {
    // AsyncOnly(1) = 6 is not > 7
    expect(await asyncValue(['All', ['List', 1, 2, 3], OVER_SEVEN])).toBe(
      '"False"'
    );
  });

  test('without a predicate, the elements are awaited', async () => {
    expect(
      await asyncValue(['Any', ['List', ['Greater', ['AsyncOnly', 1], 5]]])
    ).toBe('"True"');
  });

  test('a predicate with no asynchronous operator agrees with evaluate', async () => {
    const positive = ['Function', ['Greater', 'y', 0], 'y'];
    for (const json of [
      ['Any', ['List'], positive],
      ['All', ['List', 1, 'Nothing', 3], positive],
      ['All', ['List', 1, 'Missing', 3], positive],
    ]) {
      const [sync, awaited] = await bothValues(json);
      expect(awaited).toBe(sync);
    }
  });
});

describe('MAXBY, MINBY, ARGMAX AND ARGMIN AWAIT THEIR KEY', () => {
  const NEGATED = ['Function', ['Negate', ['AsyncOnly', 'y']], 'y'];

  test('a key function with an asynchronous operator', async () => {
    const xs = ['List', 1, 2, 3];
    expect(await asyncValue(['MaxBy', xs, NEGATED])).toBe('1');
    expect(await asyncValue(['MinBy', xs, NEGATED])).toBe('3');
    expect(await asyncValue(['ArgMax', xs, NEGATED])).toBe('1');
    expect(await asyncValue(['ArgMin', xs, NEGATED])).toBe('3');
  });

  test('a bare-symbol key', async () => {
    expect(await asyncValue(['MaxBy', ['List', 1, 3, 2], 'AsyncOnly'])).toBe(
      '3'
    );
  });

  test('a key with no asynchronous operator agrees with evaluate', async () => {
    for (const json of [
      ['MaxBy', ['List'], 'Negate'],
      ['MaxBy', ['List', 3, 1, 2], 'Negate'],
      ['ArgMin', ['List', 3, 1, 2], ['Function', ['Square', 'y'], 'y']],
    ]) {
      const [sync, awaited] = await bothValues(json);
      expect(awaited).toBe(sync);
    }
  });
});

describe('COUNTIF, FIND AND POSITION AWAIT THEIR PREDICATE', () => {
  // AsyncOnly(y) > 6 holds for y = 2 and y = 3.
  const OVER_SIX = ['Function', ['Greater', ['AsyncOnly', 'y'], 6], 'y'];
  const xs = ['List', 1, 2, 3];

  test('a predicate with an asynchronous operator', async () => {
    expect(await asyncValue(['CountIf', xs, OVER_SIX])).toBe('2');
    expect(await asyncValue(['Find', xs, OVER_SIX])).toBe('2');
    expect(await asyncValue(['Position', xs, OVER_SIX])).toBe('[2,3]');
  });

  test('a predicate with no asynchronous operator agrees with evaluate', async () => {
    const overOne = ['Function', ['Greater', 'y', 1], 'y'];
    for (const json of [
      ['CountIf', ['List', 1, 'Nothing', 3], overOne],
      ['Find', ['List', 1], overOne],
      ['Position', ['List'], overOne],
      // A predicate that does not answer a boolean is an error value.
      ['Find', ['List', 1, 2], ['Function', ['Add', 'y', 1], 'y']],
    ]) {
      const [sync, awaited] = await bothValues(json);
      expect(awaited).toBe(sync);
    }
  });
});

describe('GROUPBY, PARTITION AND CHUNKBY AWAIT THEIR CALLBACK', () => {
  const OVER_SIX = ['Function', ['Greater', ['AsyncOnly', 'y'], 6], 'y'];

  test('a callback with an asynchronous operator', async () => {
    expect(await asyncValue(['GroupBy', ['List', 1, 2, 3], OVER_SIX])).toBe(
      '{"False" -> [1], "True" -> [2,3]}'
    );
    expect(await asyncValue(['Partition', ['List', 1, 2, 3], OVER_SIX])).toBe(
      '[[2,3],[1]]'
    );
    expect(await asyncValue(['ChunkBy', ['List', 1, 2, 3, 1], OVER_SIX])).toBe(
      '[[1],[2,3],[1]]'
    );
  });

  test('a callback with no asynchronous operator agrees with evaluate', async () => {
    const parity = ['Function', ['Mod', 'y', 2], 'y'];
    for (const json of [
      ['GroupBy', ['List', 1, 2, 3, 4], parity],
      ['GroupBy', ['List'], parity],
      [
        'Partition',
        ['List', 1, 2, 3, 4],
        ['Function', ['Greater', 'y', 2], 'y'],
      ],
      ['ChunkBy', ['List', 1, 1, 2, 3, 3], parity],
    ]) {
      const [sync, awaited] = await bothValues(json);
      expect(awaited).toBe(sync);
    }
  });
});

describe('THE AWAITED WALKS HONOR THE ABORT SIGNAL', () => {
  test('an aborted signal cancels the walk', async () => {
    const ce = engine();
    const controller = new AbortController();
    controller.abort();
    await expect(
      ce
        .box(['Fold', ADD_ASYNC, 0, ['List', 1, 2, 3]] as never)
        .evaluateAsync({ signal: controller.signal })
    ).rejects.toThrow('Operation canceled');
  });
});

const FLAT_MAP = [
  'FlatMap',
  ['List', 1, 2],
  ['Function', ['Join', ['List', 'x'], 'v'], 'x'],
];

describe('INDEXWHERE AWAITS ITS PREDICATE', () => {
  test('a predicate with an asynchronous operator', async () => {
    // AsyncOnly(2) = 7 > 6
    expect(
      await asyncValue([
        'IndexWhere',
        ['List', 1, 2, 3],
        ['Function', ['Greater', ['AsyncOnly', 'y'], 6], 'y'],
      ])
    ).toBe('2');
  });

  test('a predicate with no asynchronous operator agrees with evaluate', async () => {
    const overOne = ['Function', ['Greater', 'y', 1], 'y'];
    for (const json of [
      ['IndexWhere', ['List', 1, 2, 3], overOne],
      // Not found in a finite source: 0
      ['IndexWhere', ['List', 0, 1], overOne],
      ['IndexWhere', ['List'], overOne],
      ['IndexWhere', ['List', 1, 'Nothing', 3], overOne],
      // A source that is not known to be finite and has no match: no answer
      ['IndexWhere', ['Repeat', 1], overOne],
      [
        'IndexWhere',
        ['Range', 1, 5000],
        ['Function', ['Equal', 'y', 4000], 'y'],
      ],
      // A predicate that does not answer a boolean is an error value.
      ['IndexWhere', ['List', 1, 2], ['Function', ['Add', 'y', 1], 'y']],
      // A source, or a predicate, that walks a `FlatMap` whose callback
      // returns `Join([x], v)` for a valueless `v`: the walk misses elements.
      ['IndexWhere', FLAT_MAP, ['Function', ['Equal', 'y', 1], 'y']],
      [
        'IndexWhere',
        ['List', 1, 2],
        [
          'Function',
          ['And', ['Greater', 'y', 0], ['Greater', ['Count', FLAT_MAP], 0]],
          'y',
        ],
      ],
      // The iterator of the `Filter` stops at the iteration limit before it
      // gives an element: no answer.
      [
        'IndexWhere',
        [
          'Filter',
          ['Range', 1, 'PositiveInfinity'],
          ['Function', ['Less', 'x', 0], 'x'],
        ],
        overOne,
      ],
    ]) {
      const [sync, awaited] = await bothValues(json);
      expect(awaited).toBe(sync);
    }
  });
});

describe('INDEXWHERE OVER A FINITE SOURCE KEEPS THE ITERATION LIMIT', () => {
  test('a predicate that exceeds the iteration limit throws on both routes', async () => {
    // A `Loop` body past `ce.iterationLimit` cancels the evaluation. Over a
    // finite source the search does not turn that cancellation into "no
    // answer", on either route.
    const json = [
      'IndexWhere',
      ['List', 1, 2],
      [
        'Function',
        [
          'Greater',
          ['Loop', ['Add', 'k', 1], ['Element', 'k', ['Range', 1, 100000]]],
          0,
        ],
        'y',
      ],
    ];
    const ce = engine();
    expect(() => ce.box(json as never).evaluate()).toThrow(
      'Operation canceled'
    );
    await expect(ce.box(json as never).evaluateAsync()).rejects.toThrow(
      'Operation canceled'
    );
  });
});

describe('SORT AND ORDERING AWAIT THEIR KEY OR COMPARATOR', () => {
  const NEGATED_KEY = ['Function', ['Negate', ['AsyncOnly', 'y']], 'y'];
  // `AsyncOnly(a) < b + 5` is `a < b`: an ascending comparator.
  const ASCENDING = [
    'Function',
    ['Less', ['AsyncOnly', 'a'], ['Add', 'b', 5]],
    'a',
    'b',
  ];
  const xs = ['List', 1, 3, 2];

  test('a key function with an asynchronous operator', async () => {
    expect(await asyncValue(['Sort', xs, NEGATED_KEY])).toBe('[3,2,1]');
    expect(await asyncValue(['Ordering', xs, NEGATED_KEY])).toBe('[2,3,1]');
  });

  test('a bare-symbol key', async () => {
    expect(await asyncValue(['Sort', ['List', 3, 1, 2], 'AsyncOnly'])).toBe(
      '[1,2,3]'
    );
  });

  test('a comparator with an asynchronous operator', async () => {
    expect(await asyncValue(['Sort', ['List', 4, 1, 3, 1, 2], ASCENDING])).toBe(
      '[1,1,2,3,4]'
    );
    expect(await asyncValue(['Ordering', xs, ASCENDING])).toBe('[1,3,2]');
  });

  test('a key or a consistent comparator with no asynchronous operator agrees with evaluate', async () => {
    const list = ['List', 3, 1, 2, 3, 1, 5, 4, 2, 2, 9, 0, 7];
    for (const json of [
      ['Sort', list, ['Function', ['Mod', 'y', 3], 'y']],
      ['Ordering', list, ['Function', ['Subtract', 'a', 'b'], 'a', 'b']],
      ['Sort', list, ['Function', ['Subtract', 'b', 'a'], 'a', 'b']],
      ['Sort', ['List', 1, 'NaN', 3, 'Missing', 2], 'Negate'],
      ['Sort', ['List'], ['Function', ['Subtract', 'a', 'b'], 'a', 'b']],
      // A strict boolean comparator answers `False` for both orders of two
      // equal elements: the equal elements keep their order on both routes.
      ['Ordering', ['List', 1, 1], ['Function', ['Less', 'a', 'b'], 'a', 'b']],
      ['Ordering', list, ['Function', ['Less', 'a', 'b'], 'a', 'b']],
      ['Ordering', list, ['Function', ['Greater', 'a', 'b'], 'a', 'b']],
      [
        'Sort',
        ['List', 2, 2, 2, 1, 1],
        ['Function', ['Greater', 'a', 'b'], 'a', 'b'],
      ],
    ]) {
      const [sync, awaited] = await bothValues(json);
      expect(awaited).toBe(sync);
    }
  });
});

describe('THE AWAITED WALKS CHECK THE ABORT SIGNAL BETWEEN TWO STEPS', () => {
  // `AbortOnSecond` has only an `evaluateAsync` handler and aborts the
  // evaluation on its second call. The source is the lazy view
  // `Map(CountRead, [1, 2, 3])`: `CountRead` has a synchronous handler that
  // counts its calls, so the count is the number of source elements that
  // the walk has read. The walk reads an element before it applies the
  // callback to it. So the count shows which check stops the walk:
  //  - when the walk itself checks the signal after the awaited second
  //    step, it does not read the third element, and the count is 2;
  //  - when only the evaluation of the next application checks the signal,
  //    the walk reads the third element first, and the count is 3.
  // With no abort, the walk reads the three elements (the last test).
  function abortingEngine(abort = true): {
    ce: ComputeEngine;
    signal: AbortSignal;
    calls: () => number;
    reads: () => number;
  } {
    const ce = new ComputeEngine();
    const controller = new AbortController();
    let calls = 0;
    let reads = 0;
    ce.declare('AbortOnSecond', {
      signature: '(number) -> number',
      evaluateAsync: async ([x]) => {
        calls += 1;
        if (abort && calls === 2) controller.abort();
        return ce.number(x.re);
      },
    } as never);
    ce.declare('CountRead', {
      signature: '(number) -> number',
      evaluate: ([x]) => {
        reads += 1;
        return x;
      },
    } as never);
    return {
      ce,
      signal: controller.signal,
      calls: () => calls,
      reads: () => reads,
    };
  }

  const source = ['Map', 'CountRead', ['List', 1, 2, 3]];
  const reducer = ['Function', ['Add', 'a', ['AbortOnSecond', 'b']], 'a', 'b'];

  test('a fold', async () => {
    const { ce, signal, calls, reads } = abortingEngine();
    await expect(
      ce.box(['Fold', reducer, 0, source] as never).evaluateAsync({ signal })
    ).rejects.toThrow('Operation canceled');
    expect(calls()).toBe(2);
    expect(reads()).toBe(2);
  });

  test('a count', async () => {
    const { ce, signal, calls, reads } = abortingEngine();
    const predicate = ['Function', ['Greater', ['AbortOnSecond', 'y'], 0], 'y'];
    await expect(
      ce.box(['CountIf', source, predicate] as never).evaluateAsync({ signal })
    ).rejects.toThrow('Operation canceled');
    expect(calls()).toBe(2);
    expect(reads()).toBe(2);
  });

  test('with no abort, the walk reads every element', async () => {
    const { ce, signal, calls, reads } = abortingEngine(false);
    const result = await ce
      .box(['Fold', reducer, 0, source] as never)
      .evaluateAsync({ signal });
    expect(result.toString()).toBe('6');
    expect(calls()).toBe(3);
    expect(reads()).toBe(3);
  });
});
