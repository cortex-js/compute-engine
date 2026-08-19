/**
 * Stage C2 of the checkpoint work — the `checkpoint()` / `restore()` /
 * `discard()` API (`src/compute-engine/checkpoint.ts`): the quiescence
 * precondition, the typed error contract, and the ordered two-phase restore
 * ("API" and "Quiescence" in `docs/CHECKPOINT-MODEL.md`).
 *
 * The oracle throughout is the correctness specification itself: a restore followed
 * by replay must be observationally indistinguishable from a FRESH engine
 * running the corresponding linear program. Where a test can afford it, it
 * builds that fresh engine and compares against it rather than against a
 * hand-written expectation — a hand-written one only says what the author
 * believed, and the whole point of the design is agreement with a rebuild.
 *
 * The exhaustive differential harness over randomized cell sequences is C3;
 * this file is the lifecycle and failure matrix that C2 owes.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  CheckpointError,
  type CheckpointErrorCode,
} from '../../src/compute-engine/checkpoint';

/** Run `cells` on a fresh engine — the fresh-engine oracle the correctness
 * specification is stated against. */
function oracle(cells: string[]): ComputeEngine {
  const ce = new ComputeEngine();
  for (const c of cells) executeEpsil(ce, c);
  return ce;
}

function value(ce: ComputeEngine, name: string): string {
  return ce.symbol(name).evaluate().toString();
}

/** The error code a checkpoint call refuses with, or `'NO THROW'`. */
function refusalCode(fn: () => void): CheckpointErrorCode | string {
  try {
    fn();
    return 'NO THROW';
  } catch (e) {
    if (e instanceof CheckpointError) return e.code;
    throw e;
  }
}

describe('restore-then-replay agrees with a fresh engine', () => {
  test('an edited cell replays to the same state as a rebuild', () => {
    const prefix = ['a = 3', 'f(x) = x + 1'];
    const ce = oracle(prefix);
    const cp = ce.checkpoint();

    // The cells the user is about to edit away.
    executeEpsil(ce, 'a = 99');
    executeEpsil(ce, 'f(x) = "hello"');
    executeEpsil(ce, 'b = 7');

    ce.restore(cp);
    executeEpsil(ce, 'a = 42');

    const fresh = oracle([...prefix, 'a = 42']);
    expect(value(ce, 'a')).toBe(value(fresh, 'a'));
    expect(ce.box(['f', 2]).evaluate().toString()).toBe(
      fresh.box(['f', 2]).evaluate().toString()
    );
    expect(ce.box(['f', 2]).type.toString()).toBe(
      fresh.box(['f', 2]).type.toString()
    );
    // A name introduced only by the discarded suffix is gone, exactly as it
    // never existed in the rebuild.
    expect(ce.lookupDefinition('b')).toBeUndefined();
    expect(fresh.lookupDefinition('b')).toBeUndefined();
  });

  test('a checkpoint is restorable more than once', () => {
    const ce = oracle(['a = 1']);
    const cp = ce.checkpoint();

    for (const v of ['2', '3', '4']) {
      executeEpsil(ce, `a = ${v}`);
      expect(value(ce, 'a')).toBe(v);
      ce.restore(cp);
      expect(value(ce, 'a')).toBe('1');
      expect(cp.live).toBe(true);
    }
  });

  test('a checkpoint on a FRESH engine is legal — the cp[0] case', () => {
    // Clients take this as cp[0] so an edit of the FIRST cell gets
    // checkpoint-tier treatment too.
    const ce = new ComputeEngine();
    const cp0 = ce.checkpoint();
    executeEpsil(ce, 'first = 1');
    expect(ce.lookupDefinition('first')).toBeDefined();

    ce.restore(cp0);
    expect(ce.lookupDefinition('first')).toBeUndefined();
  });
});

describe('identity is preserved across a restore', () => {
  test('the record and its half are the same objects afterwards', () => {
    // The consumer's element memo validates dependencies by binding identity,
    // so a restore that swapped records would make every downstream memo cold
    // — which is what would make restore-then-replay no cheaper than a full
    // re-run.
    const ce = oracle(['a = 3']);
    const record = ce.lookupDefinition('a')!;
    const half = (record as { value: unknown }).value;

    const cp = ce.checkpoint();
    executeEpsil(ce, 'a = 99');
    ce.restore(cp);

    expect(ce.lookupDefinition('a')).toBe(record);
    expect((ce.lookupDefinition('a') as { value: unknown }).value).toBe(half);
  });

  test('an expression built BEFORE the checkpoint stays valid', () => {
    const ce = oracle(['g(x) = x + 1']);
    const node = ce.box(['g', 2]);
    expect(node.evaluate().toString()).toBe('3');

    const cp = ce.checkpoint();
    executeEpsil(ce, 'g(x) = x * 100');
    expect(node.evaluate().toString()).toBe('200');

    ce.restore(cp);
    expect(node.evaluate().toString()).toBe('3');
    expect(node.type.toString()).toBe(ce.box(['g', 2]).type.toString());
  });
});

describe('the checkpoint stack', () => {
  test('restoring an interior checkpoint kills the ones above it', () => {
    const ce = oracle(['a = 1']);
    const cp1 = ce.checkpoint();
    executeEpsil(ce, 'a = 2');
    const cp2 = ce.checkpoint();
    executeEpsil(ce, 'a = 3');
    const cp3 = ce.checkpoint();
    executeEpsil(ce, 'a = 4');

    ce.restore(cp2);
    expect(value(ce, 'a')).toBe('2');
    expect(cp1.live).toBe(true);
    expect(cp2.live).toBe(true);
    expect(cp3.live).toBe(false);
  });

  test('history re-extends after a restore', () => {
    const ce = oracle(['a = 1']);
    const cp1 = ce.checkpoint();
    executeEpsil(ce, 'a = 2');
    ce.restore(cp1);

    executeEpsil(ce, 'a = 20');
    const cp2 = ce.checkpoint();
    executeEpsil(ce, 'a = 30');
    ce.restore(cp2);
    expect(value(ce, 'a')).toBe('20');
    ce.restore(cp1);
    expect(value(ce, 'a')).toBe('1');
  });
});

describe('discard', () => {
  test('an INTERIOR discard folds its window, so a restore past it is exact', () => {
    // The fold is what keeps "restore past a discarded interior checkpoint"
    // sound: cp2's writes have to survive somewhere, or restoring to cp1
    // would leave them applied.
    const ce = oracle(['a = 1']);
    const cp1 = ce.checkpoint();
    executeEpsil(ce, 'a = 2');
    const cp2 = ce.checkpoint();
    executeEpsil(ce, 'a = 3');

    ce.discard(cp2);
    expect(cp2.live).toBe(false);

    ce.restore(cp1);
    expect(value(ce, 'a')).toBe('1');
  });

  test('discarding the OLDEST frees its window; younger ones still work', () => {
    const ce = oracle(['a = 1']);
    const cp1 = ce.checkpoint();
    executeEpsil(ce, 'a = 2');
    const cp2 = ce.checkpoint();
    executeEpsil(ce, 'a = 3');

    ce.discard(cp1);
    ce.restore(cp2);
    // cp1's state is deliberately unreachable now — that is what discarding
    // the base means — but cp2 restores exactly.
    expect(value(ce, 'a')).toBe('2');
  });

  test('discarding the TOP leaves the next-older checkpoint restorable', () => {
    const ce = oracle(['a = 1']);
    const cp1 = ce.checkpoint();
    executeEpsil(ce, 'a = 2');
    const cp2 = ce.checkpoint();
    executeEpsil(ce, 'a = 3');

    ce.discard(cp2);
    executeEpsil(ce, 'a = 4');
    ce.restore(cp1);
    // Both the writes before the discard and the ones after it are undone:
    // the fold poured cp2's window into cp1's, and later writes continued
    // into it.
    expect(value(ce, 'a')).toBe('1');
  });
});

describe('the error contract', () => {
  test('a discarded checkpoint is dead to restore and to discard', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.discard(cp);

    expect(refusalCode(() => ce.restore(cp))).toBe('checkpoint-dead');
    expect(refusalCode(() => ce.discard(cp))).toBe('checkpoint-dead');
  });

  test('a checkpoint restored PAST is dead', () => {
    const ce = new ComputeEngine();
    const base = ce.checkpoint();
    executeEpsil(ce, 'a = 1');
    const above = ce.checkpoint();
    ce.restore(base);

    expect(above.live).toBe(false);
    expect(refusalCode(() => ce.restore(above))).toBe('checkpoint-dead');
  });

  test("another engine's checkpoint is refused", () => {
    const ce = new ComputeEngine();
    const other = new ComputeEngine();
    const foreign = other.checkpoint();

    expect(refusalCode(() => ce.restore(foreign))).toBe(
      'checkpoint-foreign-engine'
    );
    expect(refusalCode(() => ce.discard(foreign))).toBe(
      'checkpoint-foreign-engine'
    );
  });

  test('a refusal is a NO-OP: the stack and the engine are untouched', () => {
    const ce = oracle(['a = 1']);
    const cp = ce.checkpoint();
    executeEpsil(ce, 'a = 2');

    const other = new ComputeEngine();
    expect(refusalCode(() => ce.restore(other.checkpoint()))).toBe(
      'checkpoint-foreign-engine'
    );

    // Nothing was rewound, and the real checkpoint still works.
    expect(value(ce, 'a')).toBe('2');
    ce.restore(cp);
    expect(value(ce, 'a')).toBe('1');
  });

  test('a checkpoint taken inside a pushed scope is legal, and dies with it', () => {
    // The session-base restriction was v1; checkpoints are now legal at any
    // quiescent depth, and a checkpoint standing on a popped frame is
    // retired by the pop (the full in-scope contract is pinned in
    // checkpoint-in-scope.test.ts).
    const ce = new ComputeEngine();
    ce.pushScope(undefined, 'host-cell');
    let inner: ReturnType<ComputeEngine['checkpoint']>;
    try {
      inner = ce.checkpoint();
      expect(inner.live).toBe(true);
    } finally {
      ce.popScope();
    }
    expect(inner.live).toBe(false);
    expect(ce.checkpoint().live).toBe(true);
  });

  test('a checkpoint taken from INSIDE an evaluation is refused', () => {
    const ce = new ComputeEngine();
    let observed: string | undefined;
    ce.declare('probeCheckpoint', {
      signature: '() -> integer',
      evaluate: () => {
        observed = refusalCode(() => ce.checkpoint()) as string;
        return ce.number(1);
      },
    });
    ce.box(['probeCheckpoint']).evaluate();
    expect(observed).toBe('checkpoint-not-quiescent');
  });

  test('restore() and discard() refuse mid-evaluation too', () => {
    // The error contract says `checkpoint-not-quiescent` is thrown by ALL THREE
    // operations; testing only `checkpoint()` leaves the other two branches
    // unexercised.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'a = 1');
    const cp = ce.checkpoint();
    const observed: string[] = [];
    ce.declare('probeRestore', {
      signature: '() -> integer',
      evaluate: () => {
        observed.push(refusalCode(() => ce.restore(cp)) as string);
        observed.push(refusalCode(() => ce.discard(cp)) as string);
        return ce.number(1);
      },
    });
    ce.box(['probeRestore']).evaluate();
    expect(observed).toEqual([
      'checkpoint-not-quiescent',
      'checkpoint-not-quiescent',
    ]);
    // And the refusals were no-ops: the checkpoint is still usable.
    expect(cp.live).toBe(true);
    ce.restore(cp);
    expect(value(ce, 'a')).toBe('1');
  });

  test('a SUSPENDED async evaluation blocks a checkpoint', async () => {
    // The case stack depth cannot see: an `evaluateAsync` parked at an
    // `await` has handed control back to the host while still holding its
    // context.
    const ce = new ComputeEngine();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    ce.declare('slowAsync', {
      signature: '() -> integer',
      evaluate: () => ce.number(1),
      evaluateAsync: async () => {
        await gate;
        return ce.number(1);
      },
    });

    const pending = ce.box(['slowAsync']).evaluateAsync();
    // The evaluation is suspended right now, and the host has control back.
    expect(refusalCode(() => ce.checkpoint())).toBe('checkpoint-not-quiescent');

    release();
    await pending;
    // Once it settles, the engine is quiescent again.
    expect(ce.checkpoint().live).toBe(true);
  });
});

describe('restore failure and poisoning', () => {
  test('a forced phase-2 throw poisons the engine detectably', () => {
    // Restore-failure injection: the mutation phase is built out
    // of plain assignments and map surgery so it has no expected throw path —
    // which is exactly why it needs a forced one to be tested at all.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'a = 1');
    const cp = ce.checkpoint();
    executeEpsil(ce, 'a = 2');

    // Make one of the mutation phase's steps throw. The registry rollback
    // thunk runs after the journal undo and before the snapshot restores.
    const snapshot = (cp as unknown as { snapshot: { typeRegistry: () => void } })
      .snapshot;
    const realThunk = snapshot.typeRegistry;
    snapshot.typeRegistry = () => {
      throw new Error('injected mutation-phase failure');
    };

    expect(refusalCode(() => ce.restore(cp))).toBe('checkpoint-restore-failed');
    snapshot.typeRegistry = realThunk;

    // Poisoned: every later checkpoint call refuses with the same code, which
    // is the client's signal to rebuild the engine rather than trust it.
    expect(refusalCode(() => ce.checkpoint())).toBe('checkpoint-restore-failed');
    expect(refusalCode(() => ce.restore(cp))).toBe('checkpoint-restore-failed');
    expect(refusalCode(() => ce.discard(cp))).toBe('checkpoint-restore-failed');
  });

  test('a poisoned engine stops journaling into an orphaned window', () => {
    // Once poisoned, no checkpoint call can ever consume a window again, so
    // leaving one attached would grow it for the life of the engine and pin
    // every prior field value its undo closures captured.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'a = 1');
    const cp = ce.checkpoint();
    const snapshot = (cp as unknown as { snapshot: { typeRegistry: () => void } })
      .snapshot;
    snapshot.typeRegistry = () => {
      throw new Error('injected mutation-phase failure');
    };
    refusalCode(() => ce.restore(cp));

    expect(
      (ce as unknown as { _checkpointWindow: unknown })._checkpointWindow
    ).toBeUndefined();
    // And the engine still evaluates — poisoned means "outside the checkpoint
    // contract", not "broken".
    executeEpsil(ce, 'a = 5');
    expect(value(ce, 'a')).toBe('5');
  });
});

describe('the bounded state families', () => {
  test('numeric configuration is restored, precision before tolerance', () => {
    // Setting precision RESETS tolerance, so an unordered restore would
    // silently install the precision-derived default instead of the
    // checkpoint's tolerance.
    const ce = new ComputeEngine();
    const precision = ce.precision;
    const tolerance = ce.tolerance;
    const cp = ce.checkpoint();

    ce.precision = 100;
    ce.tolerance = 1e-3;
    ce.restore(cp);

    expect(ce.precision).toBe(precision);
    expect(ce.tolerance).toBe(tolerance);
  });

  test('assumptions made after the checkpoint are forgotten', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();

    // `verify` is the assumption channel's own observable: without the
    // assumption in force the engine cannot decide the predicate.
    expect(ce.verify(ce.parse('x > 0'))).not.toBe(true);
    ce.assume(ce.parse('x > 0'));
    expect(ce.verify(ce.parse('x > 0'))).toBe(true);

    ce.restore(cp);
    expect(ce.verify(ce.parse('x > 0'))).toBe(
      new ComputeEngine().verify(ce.parse('x > 0'))
    );
    expect(ce.verify(ce.parse('x > 0'))).not.toBe(true);
  });

  test('a type declared after the checkpoint is gone', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    executeEpsil(ce, 'type Temp = integer');
    expect(ce.type('Temp').toString()).toBe('Temp');

    ce.restore(cp);
    // The registry rollback removed the name, so resolving it now fails the
    // same way it does on an engine that never saw the declaration.
    const fresh = new ComputeEngine();
    const resolve = (engine: ComputeEngine): string => {
      try {
        return engine.type('Temp').toString();
      } catch (e) {
        return `error: ${(e as Error).message.slice(0, 24)}`;
      }
    };
    expect(resolve(ce)).toBe(resolve(fresh));
  });
});

describe('the sequence registries', () => {
  test('a sequence declared after the checkpoint is gone', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.declareSequence('S', { variable: 'n', base: { 0: 1 }, recurrence: 'S_{n-1} + 2' });
    expect(ce.isSequence('S')).toBe(true);

    ce.restore(cp);
    expect(ce.isSequence('S')).toBe(false);
  });

  test('a memoized term computed after the checkpoint does not survive', () => {
    // The memo map is created by `createSequenceHandler` and CLOSED OVER by
    // the handler; the metadata merely holds the same reference. Replacing
    // `meta.memo` with a fresh map on restore leaves the handler reading the
    // old one — and every registry probe reports the FRESH map, so a
    // size-based assertion here is satisfied by exactly the broken restore
    // it exists to catch (mutation-tested during C3). The recurrence
    // therefore references a symbol reassigned inside the window: a
    // window-era memo entry then DIFFERS from recomputation, and the value
    // assertion below fails unless the handler's own map was cleared.
    const ce = new ComputeEngine();
    // A SINGLE-LETTER dependency: the recurrence is parsed as LaTeX, where a
    // two-letter name is implicit multiplication of two unknowns.
    executeEpsil(ce, 'y = 2');
    ce.declareSequence('T', {
      variable: 'n',
      base: { 0: 1 },
      recurrence: 'T_{n-1} + y',
    });
    expect(ce.parse('T_{4}').evaluate().re).toBe(9);

    const cp = ce.checkpoint();
    executeEpsil(ce, 'y = 1000');
    // Populate the memo inside the window, with the window-only zm.
    expect(ce.parse('T_{8}').evaluate().re).toBe(9 + 4 * 1000);
    expect(ce.getSequenceCache('T')?.size ?? 0).toBeGreaterThan(0);

    ce.restore(cp);
    // The registry-side map is empty — necessary but NOT sufficient…
    expect(ce.getSequenceCache('T')?.size ?? 0).toBe(0);
    // …and the recomputed terms use the restored y = 2, which only holds if
    // the handler's captured map was cleared rather than swapped away.
    expect(ce.parse('T_{8}').evaluate().re).toBe(17);
  });
});

describe('object slots and the journal families end to end', () => {
  test('a field store after the checkpoint is rewound, and the object is bumped', () => {
    const ce = new ComputeEngine();
    ce.declareType('Person', 'object{name: string, age: integer}');
    const p = ce._object('Person', {
      name: ce.string('Alan'),
      age: ce.number(42),
    }) as { _field(n: string): unknown; _version: number };

    const cp = ce.checkpoint();
    const versionAtCheckpoint = p._version;
    p._field; // no-op read, keeps the shape honest
    (p as unknown as { _store(n: string, v: unknown): void })._store(
      'age',
      ce.number(99)
    );

    ce.restore(cp);
    expect(String(p._field('age'))).toBe('42');
    // Bumped, never rewound: a version counter that went backwards could
    // resurrect a cache entry derived from the value just undone.
    expect(p._version).toBeGreaterThan(versionAtCheckpoint);
  });
});
