import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import type {
  ConsoleHandler,
  Expression,
} from '../../src/compute-engine/global-types';

//
// The host capability registry — `ce.effects` and `ce.withEffects()`
// (`docs/EFFECTS-MODEL.md`, "Host capabilities", Stage 4 of the migration).
//
// `Print` and `Input` are the operators that use it, through the `console`
// handler. Every test here supplies its own handler: the DEFAULT `readLine`
// does a blocking read of standard input, which never returns in a jest
// worker (`print-input.test.ts` covers the default handlers, with that path
// disabled).
//

/** A `console` handler that records what is printed and answers `readLine`
 * with `answer`. */
function recorder(answer: string | null | undefined = undefined): {
  handler: ConsoleHandler;
  lines: string[];
  prompts: (string | undefined)[];
} {
  const lines: string[] = [];
  const prompts: (string | undefined)[] = [];
  return {
    lines,
    prompts,
    handler: {
      log: (line) => {
        lines.push(line);
      },
      readLine: (prompt) => {
        prompts.push(prompt);
        return answer;
      },
    },
  };
}

const isDenied = (expr: Expression): boolean =>
  JSON.stringify(expr.json) ===
  JSON.stringify(['Error', ['ErrorCode', "'capability-denied'", "'console'"]]);

describe('ce.effects', () => {
  test('a new engine has the default console handler, and the registry is frozen', () => {
    const ce = new ComputeEngine();
    expect(typeof ce.effects.console?.log).toBe('function');
    expect(typeof ce.effects.console?.readLine).toBe('function');
    expect(Object.isFrozen(ce.effects)).toBe(true);
  });

  test('an assigned handler receives the output of Print and answers Input', () => {
    const ce = new ComputeEngine();
    const { handler, lines, prompts } = recorder('Arno');
    ce.effects = { console: handler };

    const printed = ce.box(['Print', { str: 'x is' }, ['Add', 40, 2]]);
    expect(printed.evaluate().symbol).toBe('Nothing');
    expect(lines).toEqual(['x is 42']);

    expect(ce.box(['Input', { str: 'Who? ' }]).evaluate().string).toBe('Arno');
    expect(prompts).toEqual(['Who? ']);
  });

  test('readLine: null is end of input (Nothing), undefined is "no input here" (unevaluated)', () => {
    const ce = new ComputeEngine();
    ce.effects = { console: recorder(null).handler };
    expect(ce.box(['Input']).evaluate().symbol).toBe('Nothing');
    ce.effects = { console: recorder(undefined).handler };
    expect(ce.box(['Input']).evaluate().operator).toBe('Input');
  });

  test('an assignment is a complete description: an absent handler returns to its default', () => {
    const ce = new ComputeEngine();
    const initial = ce.effects.console;
    ce.effects = { console: recorder().handler };
    expect(ce.effects.console).not.toBe(initial);
    ce.effects = {};
    expect(ce.effects.console).toBe(initial);
  });

  test('registries are per engine', () => {
    const a = new ComputeEngine();
    const b = new ComputeEngine();
    const { handler, lines } = recorder();
    a.effects = { console: handler };
    expect(b.effects.console).not.toBe(handler);
    a.box(['Print', 1]).evaluate();
    expect(lines).toEqual(['1']);
  });

  test('an unknown capability name, or a handler without its methods, is rejected', () => {
    const ce = new ComputeEngine();
    expect(() => {
      ce.effects = { consle: null } as never;
    }).toThrow(/Unknown effect handler "consle"/);
    expect(() => {
      ce.effects = { console: { log: () => {} } } as never;
    }).toThrow(/`readLine`/);
    expect(() => ce.withEffects({ network: null } as never, () => 1)).toThrow(
      /Unknown effect handler "network"/
    );
    // A rejected `withEffects` leaves nothing installed.
    expect(typeof ce.effects.console?.log).toBe('function');
  });
});

describe('denial', () => {
  test('a null handler makes Print and Input evaluate to an error VALUE', () => {
    const ce = new ComputeEngine();
    ce.effects = { console: null };
    let print: Expression | undefined;
    let input: Expression | undefined;
    expect(() => {
      print = ce.box(['Print', { str: 'secret' }]).evaluate();
      input = ce.box(['Input']).evaluate();
    }).not.toThrow();
    expect(isDenied(print!)).toBe(true);
    expect(isDenied(input!)).toBe(true);
  });

  test('a denial overrides a present default, and ends with the withEffects call', () => {
    const ce = new ComputeEngine();
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const denied = ce.withEffects({ console: null }, () =>
        ce.box(['Print', 1]).evaluate()
      );
      expect(isDenied(denied)).toBe(true);
      expect(spy).not.toHaveBeenCalled();

      // Afterwards the default handler is back.
      expect(ce.box(['Print', 2]).evaluate().symbol).toBe('Nothing');
      expect(spy).toHaveBeenCalledWith('2');
    } finally {
      spy.mockRestore();
    }
  });

  test('a denial reaches a Print that is nested in a program', () => {
    const ce = new ComputeEngine();
    const result = ce.withEffects({ console: null }, () =>
      ce.box(['Block', ['Print', { str: 'a' }], 5]).evaluate()
    );
    // The denied statement is an error, and an error ends a block.
    expect(JSON.stringify(result.json)).toContain('capability-denied');
  });
});

describe('ce.withEffects', () => {
  test('returns the value of the callback and restores the registry', () => {
    const ce = new ComputeEngine();
    const before = ce.effects;
    const { handler, lines } = recorder();
    const value = ce.withEffects({ console: handler }, () => {
      expect(ce.effects.console).toBe(handler);
      ce.box(['Print', { str: 'inside' }]).evaluate();
      return 42;
    });
    expect(value).toBe(42);
    expect(lines).toEqual(['inside']);
    expect(ce.effects.console).toBe(before.console);
  });

  test('a callback whose returned object has a throwing `then` getter does not leave the override installed', () => {
    const ce = new ComputeEngine();
    const before = ce.effects.console;
    expect(() =>
      ce.withEffects({ console: null }, () => ({
        get then(): never {
          throw new Error('bad thenable');
        },
      }))
    ).toThrow('bad thenable');
    expect(ce.effects.console).toBe(before);
    // ...and a later assignment is not shadowed by a leftover override.
    ce.effects = { console: null };
    expect(ce.effects.console).toBeNull();
    ce.effects = {};
    expect(ce.effects.console).toBe(before);
  });

  test('restores the registry when the callback throws', () => {
    const ce = new ComputeEngine();
    const before = ce.effects.console;
    expect(() =>
      ce.withEffects({ console: null }, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(ce.effects.console).toBe(before);
  });

  test('calls nest: the inner call wins, and an `undefined` override keeps the outer handler', () => {
    const ce = new ComputeEngine();
    const outer = recorder();
    const inner = recorder();
    ce.withEffects({ console: outer.handler }, () => {
      ce.box(['Print', 1]).evaluate();
      ce.withEffects({ console: inner.handler }, () => {
        ce.box(['Print', 2]).evaluate();
      });
      ce.withEffects({ console: undefined }, () => {
        ce.box(['Print', 3]).evaluate();
      });
      ce.withEffects({}, () => {
        ce.box(['Print', 4]).evaluate();
      });
    });
    expect(outer.lines).toEqual(['1', '3', '4']);
    expect(inner.lines).toEqual(['2']);
  });

  test('an assignment made inside a call is kept when the call ends, and the override is not', () => {
    const ce = new ComputeEngine();
    const assigned = recorder();
    const overriding = recorder();
    ce.withEffects({ console: overriding.handler }, () => {
      ce.effects = { console: assigned.handler };
      // The override is still on top of the new assignment.
      expect(ce.effects.console).toBe(overriding.handler);
    });
    expect(ce.effects.console).toBe(assigned.handler);
  });

  test('a promise-returning callback: the registry is restored when the promise is fulfilled', async () => {
    const ce = new ComputeEngine();
    const before = ce.effects.console;
    const { handler, lines } = recorder();
    const pending = ce.withEffects({ console: handler }, async () => {
      await Promise.resolve();
      // Still installed after an `await` inside the callback.
      await ce.box(['Print', { str: 'late' }]).evaluateAsync();
      return 'done';
    });
    expect(ce.effects.console).toBe(handler);
    await expect(pending).resolves.toBe('done');
    expect(lines).toEqual(['late']);
    expect(ce.effects.console).toBe(before);
  });

  test('a promise-returning callback: the registry is restored when the promise is rejected', async () => {
    const ce = new ComputeEngine();
    const before = ce.effects.console;
    const pending = ce.withEffects({ console: null }, async () => {
      await Promise.resolve();
      throw new Error('rejected');
    });
    expect(ce.effects.console).toBeNull();
    await expect(pending).rejects.toThrow('rejected');
    expect(ce.effects.console).toBe(before);
  });

  test('two overlapping asynchronous calls that do not nest each remove only their own override', async () => {
    const ce = new ComputeEngine();
    const before = ce.effects.console;
    const a = recorder();
    const b = recorder();
    let endA!: () => void;
    let endB!: () => void;
    const pendingA = ce.withEffects(
      { console: a.handler },
      () => new Promise<void>((resolve) => (endA = resolve))
    );
    const pendingB = ce.withEffects(
      { console: b.handler },
      () => new Promise<void>((resolve) => (endB = resolve))
    );
    expect(ce.effects.console).toBe(b.handler);
    // The FIRST call ends first: the second one must stay installed...
    endA();
    await pendingA;
    expect(ce.effects.console).toBe(b.handler);
    // ...and when it ends, the first one must not come back.
    endB();
    await pendingB;
    expect(ce.effects.console).toBe(before);
  });
});

describe('an evaluation keeps the registry it started with', () => {
  /** Declare `Swap`, an operator whose handler assigns `ce.effects` while an
   * evaluation is running — something only host code can do. */
  function declareSwap(ce: ComputeEngine, next: ConsoleHandler): void {
    ce.declare('Swap', {
      signature: '() -> nothing',
      pure: false,
      evaluate: (_ops, { engine }) => {
        engine.effects = { console: next };
        return engine.Nothing;
      },
    } as never);
  }

  test('synchronous: an assignment during the evaluation does not reach its later operators', () => {
    const ce = new ComputeEngine();
    const first = recorder();
    const second = recorder();
    ce.effects = { console: first.handler };
    declareSwap(ce, second.handler);

    ce.box([
      'Block',
      ['Print', { str: 'before' }],
      ['Swap'],
      ['Print', { str: 'after' }],
    ]).evaluate();
    expect(first.lines).toEqual(['before', 'after']);
    expect(second.lines).toEqual([]);

    // The NEXT evaluation uses the assigned registry.
    ce.box(['Print', { str: 'next' }]).evaluate();
    expect(second.lines).toEqual(['next']);
  });

  test('synchronous: withEffects called by a handler applies to the evaluations it starts', () => {
    const ce = new ComputeEngine();
    const outer = recorder();
    const inner = recorder();
    ce.effects = { console: outer.handler };
    ce.declare('Quietly', {
      signature: '(any) -> any',
      lazy: true,
      pure: false,
      evaluate: ([body], { engine }) =>
        engine.withEffects({ console: inner.handler }, () => body.evaluate()),
    } as never);

    ce.box([
      'Block',
      ['Print', { str: 'a' }],
      ['Quietly', ['Print', { str: 'b' }]],
      ['Print', { str: 'c' }],
    ]).evaluate();
    expect(outer.lines).toEqual(['a', 'c']);
    expect(inner.lines).toEqual(['b']);
  });

  /** Declare `Pause`, an asynchronous-only operator that suspends the
   * evaluation until `release()` is called. `reached` settles when the
   * evaluation arrives at it. */
  function declarePause(ce: ComputeEngine): {
    release: () => void;
    reached: Promise<void>;
  } {
    let release!: () => void;
    let arrive!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (arrive = resolve));
    ce.declare('Pause', {
      signature: '() -> nothing',
      pure: false,
      evaluateAsync: async (_ops, { engine }) => {
        arrive();
        await gate;
        return engine.Nothing;
      },
    } as never);
    return { release, reached };
  }

  test('asynchronous: a suspended evaluation is not changed by a withEffects call made for another one', async () => {
    const ce = new ComputeEngine();
    const mine = recorder();
    const theirs = recorder();
    ce.effects = { console: mine.handler };
    const { release, reached } = declarePause(ce);
    ce.declare('Run', {
      signature: '(any) -> any',
      lazy: true,
      pure: false,
      evaluate: ([body]) => body.evaluate(),
    } as never);
    ce.declare('Busy', {
      signature: '() -> nothing',
      pure: false,
      evaluate: (_ops, { engine }) => {
        const end = Date.now() + 25;
        while (Date.now() < end);
        return engine.Nothing;
      },
    } as never);

    // Evaluation A starts first, prints, and is suspended at `Pause`.
    const a = ce
      .box([
        'Block',
        ['Print', { str: 'A1' }],
        ['Pause'],
        ['Print', { str: 'A2' }],
        // A lazy operator with only a SYNCHRONOUS handler: its operand is
        // evaluated by the synchronous `evaluate()`, inside the handler.
        ['Run', ['Print', { str: 'A3' }]],
        // A big operator: each term is evaluated by the synchronous
        // `evaluate()` from inside an asynchronous handler. `Busy` makes a
        // term longer than one time slice of the asynchronous driver, so the
        // handler is suspended between terms and the later ones run after it
        // resumes.
        ['Sum', ['Block', ['Busy'], ['Print', 'k'], 'k'], ['Tuple', 'k', 1, 3]],
        // A loop: the body is evaluated synchronously, step by step, by an
        // asynchronous handler that is suspended between time slices.
        [
          'Loop',
          ['Block', ['Busy'], ['Print', { str: 'loop' }, 'j']],
          ['Element', 'j', ['Range', 1, 2]],
        ],
        // Operators whose asynchronous handler builds new options for the
        // operands it awaits.
        ['If', 'True', ['Print', { str: 'if' }], 0],
        ['Which', 'True', ['Print', { str: 'which' }]],
        // Two elements: the first is evaluated before the handler's first
        // `await`, the second one after it.
        ['List', ['Print', { str: 'list1' }], ['Print', { str: 'list2' }]],
        ['Set', ['Print', { str: 'set1' }], ['Print', { str: 'set2' }]],
        // A function held by a VALUE definition: a lambda assigned inside
        // the block. Its application is synchronous and happens in the
        // synchronous start of the statement's `evaluateAsync()`, before the
        // driver reaches any operator handler. (A function assigned at the
        // top level becomes an operator definition and takes the handler
        // route instead.)
        [
          'Assign',
          'g',
          ['Function', ['Block', ['Print', { str: 'fn' }, 'x'], 'x'], 'x'],
        ],
        ['g', 9],
        // A condition that is a LIST: the asynchronous `If` and `Which`
        // handlers hand this case to their synchronous twins after they
        // awaited the condition.
        ['If', ['List', 'True', 'False'], ['Print', { str: 'if-list' }], 0],
        ['Which', ['List', 'True'], ['Print', { str: 'which-list' }]],
      ])
      .evaluateAsync();
    await reached;
    expect(mine.lines).toEqual(['A1']);

    // Evaluation B runs under `withEffects` while A is suspended, and its
    // override is still installed when A resumes.
    let endB!: () => void;
    let printedB!: () => void;
    const bPrinted = new Promise<void>((resolve) => (printedB = resolve));
    const b = ce.withEffects({ console: theirs.handler }, async () => {
      await ce.box(['Print', { str: 'B1' }]).evaluateAsync();
      printedB();
      await new Promise<void>((resolve) => (endB = resolve));
    });
    await bPrinted;
    expect(ce.effects.console).toBe(theirs.handler);

    release();
    await a;
    expect(mine.lines).toEqual([
      'A1',
      'A2',
      'A3',
      '1',
      '2',
      '3',
      'loop 1',
      'loop 2',
      'if',
      'which',
      'list1',
      'list2',
      'set1',
      'set2',
      'fn 9',
      'if-list',
      'which-list',
    ]);
    expect(theirs.lines).toEqual(['B1']);

    endB();
    await b;
    expect(ce.effects.console).toBe(mine.handler);
  });

  test('asynchronous: a denial made for one evaluation does not reach a suspended one', async () => {
    const ce = new ComputeEngine();
    const mine = recorder();
    ce.effects = { console: mine.handler };
    const { release, reached } = declarePause(ce);

    const a = ce
      .box(['Block', ['Pause'], ['Print', { str: 'allowed' }], 7])
      .evaluateAsync();
    await reached;

    const denied = await ce.withEffects({ console: null }, () =>
      ce.box(['Print', { str: 'refused' }]).evaluateAsync()
    );
    expect(isDenied(denied)).toBe(true);

    release();
    expect((await a).re).toBe(7);
    expect(mine.lines).toEqual(['allowed']);
  });
});

//
// The coupling rule (`docs/EFFECTS-MODEL.md`, "Host capabilities"): an operator
// may use a capability handler only if it declares the matching effect label.
// The rule is checked mechanically: every source file that reads a handler
// off a registry is listed here with the operators that do so, and each of
// those operators must carry the label.
//
describe('coupling rule audit', () => {
  const SRC = join(__dirname, '../../src/compute-engine');

  /** Every file that reads `effects.console` (or destructures `effects` and
   * reads `.console` from it), mapped to the operators whose handlers do it.
   * `effects-registry.ts` defines the default handler and is not a consumer.
   * A new entry here means a new operator reaches the console: check that its
   * signature declares `console`, then add it. */
  const CONSOLE_CONSUMERS: Record<string, string[]> = {
    'library/core.ts': ['Print', 'Input'],
  };

  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') ? [path] : [];
    });

  test('only the listed files read the console handler', () => {
    const readers = sourceFiles(SRC)
      .filter((path) =>
        /effects\s*\.\s*console\b/.test(readFileSync(path, 'utf8'))
      )
      .map((path) => relative(SRC, path))
      // Documentation comments in the type files mention the spelling.
      .filter((path) => !path.startsWith('types-'))
      .sort();
    expect(readers).toEqual(Object.keys(CONSOLE_CONSUMERS).sort());
  });

  test('every listed operator declares the `console` effect', () => {
    const ce = new ComputeEngine();
    for (const operator of Object.values(CONSOLE_CONSUMERS).flat())
      expect([operator, ce.box([operator]).effects]).toEqual([
        operator,
        expect.arrayContaining(['console']),
      ]);
  });

  test('no operator handler reaches the host console or standard input directly', () => {
    // Outside the default handler, library code must not name the host
    // surfaces the `console` capability stands for.
    const offenders = sourceFiles(join(SRC, 'library'))
      .filter((path) =>
        /getBuiltinModule|globalThis\.console|\.prompt\(/.test(
          readFileSync(path, 'utf8')
        )
      )
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });

  test('every nested evaluateAsync call that rebuilds its options passes the captured registry on', () => {
    // An asynchronous evaluation carries its registry in `options._effects`.
    // A handler that builds a NEW options object for a nested
    // `evaluateAsync()` call drops it unless it copies the field, and the
    // nested evaluation would then use whichever registry is installed at
    // that moment. Every such object literal must mention `_effects`.
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC)) {
      // Comment lines quote the call shape in prose; only code is audited.
      const text = readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join('\n');
      const call = /\.evaluateAsync\(\s*\{([^}]*)\}/g;
      for (let m = call.exec(text); m !== null; m = call.exec(text))
        if (!m[1].includes('_effects'))
          offenders.push(
            `${relative(SRC, path)}: evaluateAsync({${m[1].replace(/\s+/g, ' ')}})`
          );
    }
    expect(offenders).toEqual([]);
  });
});
