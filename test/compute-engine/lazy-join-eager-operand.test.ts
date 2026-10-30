import { ComputeEngine } from '../../src/compute-engine';
import {
  evaluateEagerSource,
  keptEagerSourceValue,
} from '../../src/compute-engine/boxed-expression/eager-source-values';
import {
  beginObjectDeps,
  endObjectDeps,
} from '../../src/compute-engine/boxed-expression/object-deps';

// A lazy collection view (`Join`, `Append`, `Reverse`, `Drop`, `Filter`, …)
// whose source is an EAGER collection operator (`Sort`, `Unique`, …) must
// report its finiteness. An eager operator has no collection handlers until it
// is evaluated, so its `isFiniteCollection` is `undefined`; a view that read
// that facet directly was not known to be finite, and `Sum`, which does not
// walk a collection of unknown finiteness, stayed unevaluated:
// `Sum(Join([3], Sort([2, 1])))` stayed symbolic while `Sum(Sort([2, 1]))`
// was 3. The views now read their source through `mapSource`
// (`library/collections.ts`), which evaluates an eager source.

const ce = new ComputeEngine();

const S = ['Sort', ['List', 2, 1]];

describe('a lazy view over an eager collection operator', () => {
  test.each([
    [['Sum', ['Join', ['List', 3], S]], 6],
    [['Sum', ['Join', ['List', 3], ['List', 2, 1]]], 6],
    [['Sum', S], 3],
    [['Length', ['Join', ['List', 3], S]], 3],
    [['Sum', ['Join', S, ['List', 3]]], 6],
    [['Sum', ['Append', S, 3]], 6],
    [['Sum', ['Join', ['List', 3], ['Unique', ['List', 2, 1, 2]]]], 6],
    [['Product', ['Join', ['List', 3], S]], 6],
    [['Sum', ['Reverse', S]], 3],
    [['Sum', ['Drop', S, 1]], 2],
    [['Sum', ['Rest', S]], 2],
    [['Sum', ['Most', S]], 1],
    [['Sum', ['Filter', S, ['Function', ['Greater', 'x', 0], 'x']]], 3],
  ] as [any, number][])('box route: %j', (json, expected) => {
    expect(ce.box(json).evaluate().json).toEqual(expected);
  });

  test('function route, pre-boxed operands', () => {
    const expr = ce.function('Sum', [
      ce.function('Join', [ce.box(['List', 3]), ce.box(S as any)]),
    ]);
    expect(expr.evaluate().json).toEqual(6);
  });

  test('parse route', () => {
    const expr = ce.parse(
      '\\sum \\operatorname{Join}([3], \\operatorname{Sort}([2,1]))'
    );
    expect(expr.json).toEqual(['Sum', ['Join', ['List', 3], S]]);
    expect(expr.evaluate().json).toEqual(6);
  });

  test('a view over an eager operator whose source is valueless stays symbolic', () => {
    const local = new ComputeEngine();
    local.declare('xs', 'list<integer>');
    const expr = local.box(['Sum', ['Join', ['List', 3], ['Sort', 'xs']]]);
    expect(expr.evaluate().json).toEqual([
      'Sum',
      ['Join', ['List', 3], ['Sort', 'xs']],
    ]);
  });

  // A plain `evaluate()` of a view with an element memo reads the finiteness
  // of the view first, and that read evaluates an eager operand. The operand
  // step of the same evaluation uses that value: the operand is evaluated
  // once.
  test('a plain evaluate() evaluates an eager operand once', () => {
    const local = new ComputeEngine();
    let calls = 0;
    local.declare('src', {
      signature: '(integer) -> list<integer>',
      // A pure source: a host operator is cached only when it states it.
      pure: true,
      evaluate: () => {
        calls += 1;
        return local.box(['List', 3, 1, 2]);
      },
    });
    for (const [input, expected] of [
      [['Join', ['src', 1], ['List', 4]], '[3,1,2,4]'],
      [['Append', ['src', 1], 4], '[3,1,2,4]'],
    ] as [any, string][]) {
      calls = 0;
      expect(local.box(input).evaluate().toString()).toBe(expected);
      expect(calls).toBe(1);
    }
  });

  // `evaluateAsync()` reads the finiteness of the view in the same way. The
  // read is synchronous, and the values that it computes are given to the
  // operand step of the same asynchronous evaluation, which then does not
  // evaluate the operand again.
  test.each([
    [['Join', ['src', 1], ['List', 4]], '[3,1,2,4]'],
    [['Join', ['List', 4], ['src', 1]], '[4,3,1,2]'],
    [['Append', ['src', 1], 4], '[3,1,2,4]'],
    [
      ['ChunkBy', ['src', 1], ['Function', ['Mod', 'x', 2], 'x']],
      '[[3,1],[2]]',
    ],
    [['Filter', ['src', 1], ['Function', ['Greater', 'x', 1], 'x']], '[3,2]'],
    [['Map', ['Function', ['Add', 'x', 1], 'x'], ['src', 1]], '[4,2,3]'],
    [['Scan', ['src', 1], 'Add'], '[3,4,6]'],
    [['TakeWhile', ['src', 1], ['Function', ['Greater', 'x', 2], 'x']], '[3]'],
    [
      ['DropWhile', ['src', 1], ['Function', ['Greater', 'x', 2], 'x']],
      '[1,2]',
    ],
    [
      ['FlatMap', ['src', 1], ['Function', ['List', 'x', 'x'], 'x']],
      '[3,3,1,1,2,2]',
    ],
  ] as [any, string][])(
    'an evaluateAsync() evaluates an eager operand once: %j',
    async (input, expected) => {
      const local = new ComputeEngine();
      let calls = 0;
      local.declare('src', {
        signature: '(integer) -> list<integer>',
        // A pure source: a host operator is cached only when it states it.
        pure: true,
        evaluate: () => {
          calls += 1;
          return local.box(['List', 3, 1, 2]);
        },
      });
      expect((await local.box(input).evaluateAsync()).toString()).toBe(
        expected
      );
      expect(calls).toBe(1);
    }
  );

  // The finiteness read evaluates the operand synchronously, and `evaluate()`
  // cannot run an operator that has only an `evaluateAsync` handler. The
  // value of the read is then the unevaluated call, and the asynchronous
  // operand step must not use it: it evaluates the operand itself.
  test('an evaluateAsync() evaluates an asynchronous-only operand in its operand step', async () => {
    const local = new ComputeEngine();
    let calls = 0;
    local.declare('asrc', {
      signature: '(integer) -> list<integer>',
      evaluateAsync: async () => {
        calls += 1;
        return local.box(['List', 7, 8]);
      },
    });
    for (const input of [
      ['Join', ['asrc', 1], ['List', 4]],
      ['Append', ['asrc', 1], 4],
    ]) {
      calls = 0;
      expect((await local.box(input).evaluateAsync()).toString()).toBe(
        '[7,8,4]'
      );
      expect(calls).toBe(1);
    }
  });

  // An asynchronous evaluation that ends early, because the finiteness read
  // throws or because an operand evaluated before the eager one cancels it,
  // leaves no value behind. A later synchronous evaluation of the same view
  // evaluates the operand again and gets its current value. A `.N()` does
  // not read the finiteness, so it would otherwise use a value that an
  // earlier evaluation left.
  test('an evaluateAsync() that throws in the finiteness read leaves no value behind', async () => {
    const local = new ComputeEngine();
    let calls = 0;
    let value = 1;
    let throwNext = true;
    local.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        calls += 1;
        return local.box(['List', value]);
      },
    });
    local.declare('boom', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        if (throwNext) {
          throwNext = false;
          throw new Error('boom');
        }
        return local.box(['List', 9]);
      },
    });
    const view = local.box(['Join', ['src', 1], ['boom', 1]]);
    // The read runs before the first `await` of `evaluateAsync()`: the
    // asynchronous wrapper turns an error that the call throws into a
    // rejection.
    await expect((async () => view.evaluateAsync())()).rejects.toThrow('boom');
    expect(calls).toBe(1);
    value = 2;
    expect(view.N().toString()).toBe('[2,9]');
    expect(calls).toBe(2);
  });

  test('a cancelled evaluateAsync() leaves no value behind', async () => {
    const local = new ComputeEngine();
    let calls = 0;
    let value = 1;
    const controller = new AbortController();
    local.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        calls += 1;
        return local.box(['List', value]);
      },
    });
    local.declare('stop', {
      signature: '(integer) -> list<integer>',
      evaluateAsync: async () => {
        controller.abort();
        throw new DOMException('stopped', 'AbortError');
      },
    });
    const view = local.box(['Join', ['stop', 1], ['src', 1]]);
    await expect(
      view.evaluateAsync({ signal: controller.signal })
    ).rejects.toThrow('stopped');
    expect(calls).toBe(1);
    value = 2;
    expect(view.N().toString()).toBe('Join(stop(1), [2])');
    expect(calls).toBe(2);
  });

  // Two cases where the value of an eager source is needed by an evaluation
  // that is not the operand step of the view. `Sum` reads that the `Join` is
  // finite and then iterates it, without evaluating the `Join`. In
  // `Join(Sort(src(1)), [4])`, the read evaluates `src(1)` to know that
  // `Sort(src(1))` is finite, and the operand step evaluates `Sort(src(1))`.
  // The value of the pure source is kept for the evaluation in progress, so
  // `src` is called once on both routes.
  describe('a pure eager source read by a finiteness read is evaluated once', () => {
    const cases: [any, string][] = [
      [['Sum', ['Join', ['src', 1], ['List', 4]]], '10'],
      [['Product', ['Join', ['src', 1], ['List', 4]]], '24'],
      [['Join', ['Sort', ['src', 1]], ['List', 4]], '[1,2,3,4]'],
      [['Sum', ['Join', ['Sort', ['src', 1]], ['List', 4]]], '10'],
    ];
    const engineWithCounter = () => {
      const local = new ComputeEngine();
      const counter = { calls: 0 };
      local.declare('src', {
        signature: '(integer) -> list<integer>',
        // A pure source: a host operator is cached only when it states it.
        pure: true,
        evaluate: () => {
          counter.calls += 1;
          return local.box(['List', 3, 1, 2]);
        },
      });
      return { local, counter };
    };
    test.each(cases)('evaluate(): %j', (input, expected) => {
      const { local, counter } = engineWithCounter();
      expect(local.box(input).evaluate().toString()).toBe(expected);
      expect(counter.calls).toBe(1);
    });
    test.each(cases)('evaluateAsync(): %j', async (input, expected) => {
      const { local, counter } = engineWithCounter();
      expect((await local.box(input).evaluateAsync()).toString()).toBe(
        expected
      );
      expect(counter.calls).toBe(1);
    });

    // The index of a `Sum` is a value write: a value kept for one index is
    // not used for the next one.
    test('a value kept for one index of a Sum is not used for the next one', async () => {
      const local = new ComputeEngine();
      let calls = 0;
      local.declare('src', {
        signature: '(integer) -> list<integer>',
        // A pure source: a host operator is cached only when it states it.
        pure: true,
        evaluate: ([n]) => {
          calls += 1;
          return local.box(['List', ...Array(n.re).fill(n.re)]);
        },
      });
      // Σ_{k=1}^{3} (k·k + 4) = 1 + 4 + 9 + 12 = 26
      for (const view of [
        ['Join', ['src', 'k'], ['List', 4]],
        ['Join', ['Sort', ['src', 'k']], ['List', 4]],
      ]) {
        const input = ['Sum', ['Sum', view], ['Limits', 'k', 1, 3]];
        calls = 0;
        expect(local.box(input).evaluate().toString()).toBe('26');
        expect(calls).toBe(3);
        calls = 0;
        expect((await local.box(input).evaluateAsync()).toString()).toBe('26');
        expect(calls).toBe(3);
      }
    });

    // The kept values are discarded when the engine has no evaluation in
    // progress any more. A later evaluation of the same source expression
    // (here shared by two expressions) evaluates it again and gets its
    // current value.
    test('a kept value is discarded when the evaluation ends', async () => {
      const local = new ComputeEngine();
      let calls = 0;
      let value = 1;
      local.declare('src', {
        signature: '(integer) -> list<integer>',
        // A pure source: a host operator is cached only when it states it.
        pure: true,
        evaluate: () => {
          calls += 1;
          return local.box(['List', value]);
        },
      });
      const source = local.box(['src', 1]);
      const sum = () =>
        local.function('Sum', [
          local.function('Join', [source, local.box(['List', 4])]),
        ]);
      expect(sum().evaluate().toString()).toBe('5');
      value = 2;
      expect(sum().evaluate().toString()).toBe('6');
      value = 3;
      expect((await sum().evaluateAsync()).toString()).toBe('7');
      value = 4;
      expect((await sum().evaluateAsync()).toString()).toBe('8');
      expect(calls).toBe(4);
    });

    // A store to the field of an object changes neither version of the
    // engine, only `ce._objectStoreEpoch`, and a `Field` read is pure. A
    // value computed from a field is not used after a store to a field.
    // `Sum` reads that the `Map` is finite, and that read evaluates and
    // keeps `o.xs - 1` (`mapSource()` in `library/collections.ts`).
    const F = ['Field', 'o', { str: 'xs' }];
    const SUM_OF_FIELD = [
      'Sum',
      ['Map', ['Function', ['Add', 'x', 1], 'x'], ['Subtract', F, 1]],
    ];
    const engineWithObject = () => {
      const local = new ComputeEngine();
      local.declareType('B', 'object{xs: list<integer>}');
      local.declare('o', {
        type: 'B',
        value: local._object('B', { xs: local.box(['List', 1, 2, 3]) }),
      } as any);
      return local;
    };

    test('a value computed from a field is not used after a store to the field in a loop', () => {
      const local = engineWithObject();
      const seen: string[] = [];
      let iterations = 0;
      local.declare('record', {
        signature: '(any) -> nothing',
        evaluate: ([x]) => {
          seen.push(x.toString());
          return local.Nothing;
        },
      });
      local.declare('done', {
        signature: '() -> boolean',
        pure: false,
        evaluate: () => ((iterations += 1) >= 2 ? local.True : local.False),
      } as any);
      // A loop with no index writes no value: the two iterations evaluate
      // the same nodes with the same versions of the engine.
      local
        .box([
          'Loop',
          [
            'Block',
            ['record', SUM_OF_FIELD],
            ['record', ['Join', F, ['List', 4]]],
            ['Assign', F, ['List', 7, 8]],
            ['If', ['done'], ['Break'], 'Nothing'],
          ],
        ] as any)
        .evaluate();
      // Σ (x − 1 + 1) over [1, 2, 3] is 6, over [7, 8] it is 15.
      expect(seen).toEqual(['6', '[1,2,3,4]', '15', '[7,8,4]']);
    });

    test('a value computed from a field is not used after a store while an evaluateAsync() is in progress', async () => {
      const local = engineWithObject();
      let resume: () => void = () => {};
      const gate = new Promise<void>((resolve) => (resume = resolve));
      local.declare('slow', {
        signature: '() -> integer',
        evaluateAsync: async () => {
          await gate;
          return local.number(1);
        },
      });
      // The kept values are discarded only when the engine has no
      // evaluation in progress, and this one is in progress until `resume()`.
      const pending = local.box(['slow']).evaluateAsync();
      const sum = local.box(SUM_OF_FIELD as any);
      expect(sum.evaluate().toString()).toBe('6');
      local.box(['Assign', F, ['List', 7, 8]] as any).evaluate();
      expect(sum.evaluate().toString()).toBe('15');
      resume();
      expect((await pending).toString()).toBe('1');
    });

    // A use of a kept value reads no field. The field reads of the
    // evaluation that computed the value are reported to the computations
    // that collect object dependencies, so that a cache of an enclosing
    // computation is not used after a store to the field.
    test('a use of a kept value reports the field reads that computed it', () => {
      const local = engineWithObject();
      const source = local.box(['Subtract', F, 1] as any);
      let deps: unknown = 'not run';
      local.declare('probe', {
        signature: '() -> integer',
        evaluate: () => {
          evaluateEagerSource(source);
          beginObjectDeps();
          let value: unknown;
          try {
            value = keptEagerSourceValue(source)?.toString();
          } finally {
            deps = endObjectDeps();
          }
          expect(value).toBe('[0,1,2]');
          return local.number(0);
        },
      });
      local.box(['probe']).evaluate();
      expect(deps).toBeDefined();
      expect(deps).not.toBe('not run');
    });

    // A source that is kept again is the newest value of the store, and the
    // values of one engine are not discarded by the values of another one.
    test('a source kept again is not the first value discarded, and each engine has its own values', () => {
      const local = new ComputeEngine();
      const other = new ComputeEngine();
      const sorted = (engine: ComputeEngine, k: number) =>
        engine.box(['Sort', ['List', k, 0]]);
      const first = sorted(local, 1);
      const otherSource = sorted(other, 1);
      const results: (string | undefined)[] = [];
      other.declare('fill', {
        signature: '() -> integer',
        evaluate: () => {
          // Fill the store of `other` while `local` keeps its values.
          for (let k = 2; k < 200; k += 1)
            evaluateEagerSource(sorted(other, k));
          return other.number(0);
        },
      });
      local.declare('probe', {
        signature: '() -> integer',
        evaluate: () => {
          evaluateEagerSource(first);
          // The store holds 64 values: it is full after this loop.
          for (let k = 2; k <= 64; k += 1)
            evaluateEagerSource(sorted(local, k));
          // `first` is the oldest value: keep it again, then keep one more.
          evaluateEagerSource(first);
          evaluateEagerSource(sorted(local, 65));
          other.box(['fill']).evaluate();
          results.push(keptEagerSourceValue(first)?.toString());
          return local.number(0);
        },
      });
      local.box(['probe']).evaluate();
      expect(results).toEqual(['[0,1]']);
      expect(keptEagerSourceValue(otherSource)).toBeUndefined();
    });
  });

  // An absent operand makes the whole `Join` absent (user decision
  // 2026-09-26): unchanged by the finiteness fix.
  test('Join(Missing, [3]) stays absent', () => {
    const result = ce.box(['Join', 'Missing', ['List', 3]]).evaluate();
    expect(result.symbol).toBe('Missing');
  });

  // A finiteness query is a metadata read and must not evaluate an expensive
  // eager source: `Unique(Range(1, 100000))` tallies every element against
  // the distinct ones seen so far, and evaluating it to learn that `Reverse`
  // of it is finite took 46 seconds. An eager library operator over finite
  // collection operands is finite by construction, so the answer is derived
  // from the operands without the evaluation.
  test('the finiteness of a view over an expensive eager source is derived without evaluating it', () => {
    const start = Date.now();
    const view = ce.box(['Reverse', ['Unique', ['Range', 1, 100000]]]);
    expect(view.isFiniteCollection).toBe(true);
    // The time depends on the load of the machine, so the limit is asserted
    // only in a `CE_PERF=1` run. The finiteness check above does not depend on
    // time.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });

  // The guards of `eagerViewSource` (a pure library operator whose operands
  // are not unevaluated applications) keep a recursive list builder from
  // re-evaluating the rest of its recursion at every facet read. With
  // `F(n) = Join([n], Sort(F(n + 1)))` the `Sort` source holds the
  // unevaluated call `F(n + 1)`, so no facet read evaluates it; the builder
  // is evaluated once, top down, and answers in linear time.
  test('a recursive builder whose tail is under an eager operator evaluates once per level', () => {
    const engine = new ComputeEngine();
    engine.declare('F', '(number) -> list<number>');
    engine.assign(
      'F',
      engine.box([
        'Function',
        [
          'Which',
          ['Equal', 'n', 12],
          ['List', 'n'],
          'True',
          ['Join', ['List', 'n'], ['Sort', ['F', ['Add', 'n', 1]]]],
        ],
        'n',
      ])
    );
    const start = Date.now();
    const result = engine.box(['F', 0]).evaluate();
    expect(Array.from(result.each(), (x) => x.re)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // The time depends on the load of the machine, so the limit is asserted
    // only in a `CE_PERF=1` run. The element values above do not depend on
    // time.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });
});
