/**
 * Stage C1 of the checkpoint work — the copy-on-write journal
 * (`src/compute-engine/checkpoint-journal.ts`), its window lifecycle, and the
 * definition-record and object-slot hook set described under "State coverage"
 * in `docs/CHECKPOINT-MODEL.md`.
 *
 * C1 ships the MECHANISM, not the `checkpoint()`/`restore()`/`discard()` API
 * — that is C2 — so these tests drive the window directly: install one on the
 * engine, run a cell's worth of writes, replay the window, and check that the
 * state is the state the window opened on. That is exactly what C2's restore
 * step 2 will do, minus the registry snapshots, the purges and the version
 * bumps that surround it.
 *
 * Two things every family test checks, because they are what the whole design
 * rests on:
 *
 * - the value is back, and
 * - the RECORD is the same object it was. A restore that swapped records
 *   would leave every live boxed expression answering from the old one, and
 *   the consumer's element memo validates dependencies by binding identity.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression, ObjectInterface } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { _provisionalDependentCount } from '../../src/compute-engine/boxed-expression/provisional-application';
import {
  CheckpointWindow,
  checkpointCanaryBypasses,
  journalCheckpointMemoEntry,
} from '../../src/compute-engine/checkpoint-journal';

/** Open a window, run `body`, then replay the window — the C1 stand-in for
 * "checkpoint, run a cell, restore". Returns the window so a test can assert
 * on what it recorded. */
function inWindow(ce: ComputeEngine, body: () => void): CheckpointWindow {
  const w = new CheckpointWindow();
  ce._checkpointWindow = w;
  try {
    body();
  } finally {
    // Cleared BEFORE the replay: an undo writes raw slots, so it would record
    // nothing anyway, but leaving the window installed while unwinding it is
    // the kind of thing that becomes true only by accident.
    ce._checkpointWindow = undefined;
  }
  return w;
}

function restore(ce: ComputeEngine, w: CheckpointWindow): void {
  const failure = w.undo();
  expect(failure).toBeUndefined();
}

describe('window mechanics', () => {
  test('first-write dedup keeps the value as of window open', () => {
    const w = new CheckpointWindow();
    const record = { field: 'original' };

    for (const v of ['first', 'second', 'third']) {
      const previous = record.field;
      w.record(record, 'field', () => {
        record.field = previous;
      });
      record.field = v;
    }

    expect(record.field).toBe('third');
    // Three writes, ONE entry — and that entry carries the window-open value.
    expect(w.size).toBe(1);
    w.undo();
    expect(record.field).toBe('original');
  });

  test('claim answers true once per (owner, key) and true again for a new key', () => {
    const w = new CheckpointWindow();
    const a = {};
    const b = {};

    expect(w.claim(a, 'x')).toBe(true);
    w.push(() => {});
    expect(w.claim(a, 'x')).toBe(false);
    expect(w.claim(a, 'y')).toBe(true);
    w.push(() => {});
    expect(w.claim(b, 'x')).toBe(true);
    w.push(() => {});
    expect(w.size).toBe(3);
  });

  test('folding an interior window keeps the OLDER prior value', () => {
    // The `discard()` shape: cp2's window folds into cp1's, and a later
    // restore to cp1 must land on the state cp1 saw — not on cp2's.
    const record = { field: 'at-cp1' };
    const older = new CheckpointWindow();
    older.record(record, 'field', () => {
      record.field = 'at-cp1';
    });
    record.field = 'at-cp2';

    const younger = new CheckpointWindow();
    younger.record(record, 'field', () => {
      record.field = 'at-cp2';
    });
    record.field = 'now';

    younger.foldInto(older);
    expect(older.size).toBe(1);
    expect(younger.size).toBe(0);

    older.undo();
    expect(record.field).toBe('at-cp1');
  });

  test('folding carries entries the older window does not hold', () => {
    const a = { field: 'a0' };
    const b = { field: 'b0' };
    const older = new CheckpointWindow();
    older.record(a, 'field', () => {
      a.field = 'a0';
    });
    a.field = 'a1';

    const younger = new CheckpointWindow();
    younger.record(b, 'field', () => {
      b.field = 'b0';
    });
    b.field = 'b1';

    younger.foldInto(older);
    expect(older.size).toBe(2);
    older.undo();
    expect(a.field).toBe('a0');
    expect(b.field).toBe('b0');
  });

  test('a throwing undo entry is reported, and the rest still run', () => {
    const w = new CheckpointWindow();
    const record = { field: 'original' };
    w.record({}, 'boom', () => {
      throw new Error('undo failed');
    });
    w.record(record, 'field', () => {
      record.field = 'original';
    });
    record.field = 'changed';

    // `console.assert` fires on the failure; silence it for this one case.
    const spy = jest.spyOn(console, 'assert').mockImplementation(() => {});
    const failure = w.undo();
    spy.mockRestore();

    expect(failure).toBeDefined();
    // Best-effort: the surviving entries ran anyway, so the caller can report
    // a partial restore rather than silently leaving half the state behind.
    expect(record.field).toBe('original');
  });

  test('creations are listed unconditionally and travel with a fold', () => {
    const w = new CheckpointWindow();
    const one = {};
    const two = {};
    w.noteCreated(one);
    w.noteCreated(two);
    expect(w.created()).toEqual([one, two]);

    const older = new CheckpointWindow();
    w.foldInto(older);
    expect(older.created()).toEqual([one, two]);
    expect(w.created()).toEqual([]);
  });
});

describe('funnel 1 — value writes', () => {
  test('a reassignment is rewound, on the same record', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'a = 3');
    const def = ce.lookupDefinition('a')!;
    expect('value' in def).toBe(true);
    const half = (def as { value: unknown }).value;

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'a = 99');
    });
    expect(ce.symbol('a').evaluate().toString()).toBe('99');

    restore(ce, w);
    expect(ce.symbol('a').evaluate().toString()).toBe('3');
    expect(ce.lookupDefinition('a')).toBe(def);
    expect((ce.lookupDefinition('a') as { value: unknown }).value).toBe(half);
  });

  test('several writes to one symbol rewind to the value at window open', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'a = 3');

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'a = 10');
      executeEpsil(ce, 'a = 20');
      executeEpsil(ce, 'a = 30');
    });
    expect(ce.symbol('a').evaluate().toString()).toBe('30');

    restore(ce, w);
    expect(ce.symbol('a').evaluate().toString()).toBe('3');
  });
});

describe('funnel 2 — type writes', () => {
  test('an explicit retype is rewound', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'integer');
    const def = ce.lookupDefinition('t')!;

    const w = inWindow(ce, () => {
      (def as { value: { type: unknown } }).value.type = ce.type('string');
    });
    expect((def as { value: { type: { toString(): string } } }).value.type.toString()).toBe('string');

    restore(ce, w);
    expect((def as { value: { type: { toString(): string } } }).value.type.toString()).toBe('integer');
  });

  test('a retype to `unknown` — which also wipes the value — is rewound whole', () => {
    // The `value-def-unknown-type-clears-value` trap: the type setter is a
    // hidden VALUE writer and reports no `value-write` event, which is why the
    // hook records the coupled tuple rather than `_type` alone.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'u = 7');
    const def = ce.lookupDefinition('u') as { value: { type: any; value: any } };

    const w = inWindow(ce, () => {
      def.value.type = ce.type('unknown');
    });
    expect(def.value.value).toBeUndefined();

    restore(ce, w);
    expect(def.value.value?.toString()).toBe('7');
  });
});

describe('funnel 2 — the read-driven type revision', () => {
  test('a `.type` read inside a checkpoint window writes NOTHING (R4)', () => {
    // Since R4 (`docs/plans/2026-08-22-type-handlers-on-types.md` §4.2,
    // re-ratified 2026-08-22) `_reviseInferredType` is a LIVE READ: it
    // answers with the value's current type but writes no `_type`, bumps no
    // `_writeVersion`, and journals nothing — so there is nothing for a
    // restore to rewind, and the post-restore answer tracks the restored
    // dependency by itself. The `type-write` journal hook stays for the two
    // explicit setters (`set type`, `_setElementRefinement`).
    const ce = new ComputeEngine();
    executeEpsil(ce, 'base = 1');
    executeEpsil(ce, 'derived = base + 1');
    const half = (ce.lookupDefinition('derived') as { value: any }).value;
    const typeBefore = half.type.toString();

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'base = 1.5');
      const writesBefore = half._writeVersion;
      // The read answers the LIVE type…
      half.type;
      // …and writes nothing on the record.
      expect(half._writeVersion).toBe(writesBefore);
    });

    restore(ce, w);
    expect(half.type.toString()).toBe(typeBefore);
  });
});

describe('funnel 4 — declarations and scope bindings', () => {
  test('a name declared inside the window is gone after the rewind', () => {
    const ce = new ComputeEngine();

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'fresh = 42');
    });
    expect(ce.lookupDefinition('fresh')).toBeDefined();

    restore(ce, w);
    expect(ce.lookupDefinition('fresh')).toBeUndefined();
  });

  test('a declaration that OVERWROTE a binding reinstates it by identity', () => {
    // A name-only delete cannot express this: the previous binding object has
    // to come back, because live boxed expressions hold it.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'g(x) = x + 1');
    const before = ce.lookupDefinition('g')!;

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'g(x) = x * 100');
    });
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('200');

    restore(ce, w);
    expect(ce.lookupDefinition('g')).toBe(before);
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('3');
  });

  test('the placeholder half a declaration constructs is listed for disposal', () => {
    const ce = new ComputeEngine();
    const w = inWindow(ce, () => {
      executeEpsil(ce, 'brandNew = 1');
    });
    // Disposal contract: every half created in the window is orphaned by the restore
    // and has to be disposed, or a constant's configuration-change listener
    // leaks for the engine's lifetime.
    expect(w.created().length).toBeGreaterThan(0);
  });
});

describe('funnel 5 — bare-field writes', () => {
  test('`constant` frozen inside the window does not survive the rewind', () => {
    // `_isConstant` is written through a cast, with no setter to hook: a
    // restore that missed it would leave the binding permanently frozen.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let k = 1');
    const def = ce.lookupDefinition('k') as { value: { isConstant: boolean } };
    expect(def.value.isConstant).toBe(false);

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'let k = 5 { constant: True }');
    });

    restore(ce, w);
    expect(def.value.isConstant).toBe(false);
    // And the binding is writable again, which is the observable half.
    expect(() => executeEpsil(ce, 'k = 2')).not.toThrow();
  });
});

describe('funnel 6 — operator-definition updates', () => {
  test('an in-place `_update` is rewound on the same operator record', () => {
    const ce = new ComputeEngine();
    ce.declare('opx', {
      signature: '(integer) -> integer',
      evaluate: (ops) => ops[0].add(1),
    });
    const def = ce.lookupDefinition('opx') as { operator: any };
    const half = def.operator;
    expect(def.operator.signature.toString()).toBe('(integer) -> integer');

    const w = inWindow(ce, () => {
      def.operator._update({
        signature: '(integer) -> string',
        evaluate: () => ce.string('hi'),
      });
    });
    expect(def.operator.signature.toString()).toBe('(integer) -> string');

    restore(ce, w);
    expect(def.operator).toBe(half);
    expect(def.operator.signature.toString()).toBe('(integer) -> integer');
    expect(ce.box(['opx', 2]).evaluate().toString()).toBe('3');
  });
});

describe('object slot writes', () => {
  test('a field store on an object that predates the window is rewound', () => {
    const ce = new ComputeEngine();
    ce.declareType('Person', 'object{name: string, age: integer}');
    const p = ce._object('Person', {
      name: ce.string('Alan'),
      age: ce.number(42),
    }) as Expression & ObjectInterface;
    const versionBefore = p._version;

    const w = inWindow(ce, () => {
      p._store('age', ce.number(99));
    });
    expect(p._field('age')?.toString()).toBe('99');

    restore(ce, w);
    expect(p._field('age')?.toString()).toBe('42');
    // `_version` is bumped by the store and NOT rewound: monotone counters
    // only advance. C2's restore bumps it once more, after the slot undos.
    expect(p._version).toBeGreaterThan(versionBefore);
  });

  test('the OBJECT is the recorded owner, not its slot map', () => {
    // The restore bumps `_version` once per touched object after its slot undos.
    // With the slot `Map` as owner there is no way back to the object, so the
    // restore could not find what to bump.
    const ce = new ComputeEngine();
    ce.declareType('Owner', 'object{a: integer}');
    const o = ce._object('Owner', { a: ce.number(1) }) as Expression &
      ObjectInterface;

    const w = inWindow(ce, () => {
      o._store('a', ce.number(2));
    });
    expect([...w.owners()]).toContain(o);
  });

  test('a slot CREATED in the window is deleted, not left holding undefined', () => {
    // `_store` can create a previously-absent slot, and `undefined` is
    // ambiguous between "absent" and "present but undefined" — which is why
    // the entry records presence alongside the value.
    const ce = new ComputeEngine();
    ce.declareType('Bag', 'object{a: integer}');
    const bag = ce._object('Bag', { a: ce.number(1) }) as Expression &
      ObjectInterface;

    const w = inWindow(ce, () => {
      bag._store('b', ce.number(2));
    });
    expect(bag._slots.has('b')).toBe(true);

    restore(ce, w);
    expect(bag._slots.has('b')).toBe(false);
  });
});

describe('funnel 3 — binding-half swaps', () => {
  test('a value half replaced by an operator half is swapped back by identity', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'h = 5');
    const record = ce.lookupDefinition('h')! as {
      value?: unknown;
      operator?: unknown;
    };
    const valueHalf = record.value;
    expect(valueHalf).toBeDefined();

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'h = x => x + 1');
    });
    expect('operator' in record).toBe(true);
    expect(ce.box(['h', 2]).evaluate().toString()).toBe('3');

    restore(ce, w);
    // The RECORD is the same object and its value half is the SAME object:
    // `sameBindingDef` is object identity, so anything less than this leaves
    // live expressions answering from a half nothing points at any more.
    expect(ce.lookupDefinition('h')).toBe(record);
    expect(record.value).toBe(valueHalf);
    expect(ce.symbol('h').evaluate().toString()).toBe('5');
  });

  test('every listed creation is disposable', () => {
    // Only VALUE halves are listed: `_BoxedOperatorDefinition` has no
    // `dispose()` and holds no subscription to release, so an orphaned one
    // needs nothing but to become unreachable. A list containing one would be
    // a contract a restore cannot honor.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'h2 = 5');

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'h2 = x => x + 1');
      executeEpsil(ce, 'h3 = 7');
    });
    expect(w.created().length).toBeGreaterThan(0);
    for (const half of w.created())
      expect(typeof half.dispose).toBe('function');
  });

  test('the forward-reference registry is rewound by DELTA entries', () => {
    // The registry holds STRONG references to definition halves and journals
    // deltas, not whole state: each undo removes exactly what its own call
    // added. A restore that rewound the half swap but not these would leave
    // the reinstated half unregistered and the orphan still registered.
    const ce = new ComputeEngine();
    // `q` is applied before it is callable, so each literal registers a
    // provisional dependent waiting on the name.
    executeEpsil(ce, 'r(x) = q(x)');
    const before = _provisionalDependentCount(ce, 'q');
    expect(before).toBeGreaterThan(0);

    const w = inWindow(ce, () => {
      executeEpsil(ce, 'r2(x) = q(x)');
      executeEpsil(ce, 'r3(x) = q(x)');
    });
    expect(_provisionalDependentCount(ce, 'q')).toBeGreaterThan(before);

    restore(ce, w);
    // Every delta unwound — not just the first, which is what first-write-wins
    // dedup would have kept.
    expect(_provisionalDependentCount(ce, 'q')).toBe(before);
  });
});

describe('funnel 7 — unstamped expression-keyed memos', () => {
  test('a limit probe compiled inside the window is journaled', () => {
    // `probeCache` (`symbolic/limit.ts`) is a module-level `WeakMap` with no
    // version stamp: no engine counter reaches its entries, so an entry
    // created during the window would otherwise serve a probe compiled
    // against definitions the restore has since rewound.
    const ce = new ComputeEngine();
    const limit = ce.parse('\\lim_{x \\to \\infty} \\frac{x^2+1}{e^x}');

    const w = inWindow(ce, () => {
      expect(limit.evaluate().toString()).toBe('0');
    });

    let journaled = false;
    for (const owner of w.owners())
      if (w.keysFor(owner)?.has('limit-probe')) journaled = true;
    expect(journaled).toBe(true);
  });

  test('a memo entry created in the window is DELETED, not reset', () => {
    // The `WeakMap` shape both funnel-7 memos share, driven directly: an
    // entry that did not exist at window open has to go away, and one that
    // did has to come back with its original value.
    const ce = new ComputeEngine();
    const memo = new WeakMap<object, string>();
    const preexisting = {};
    const fresh = {};
    memo.set(preexisting, 'at-window-open');

    const w = inWindow(ce, () => {
      journalCheckpointMemoEntry(ce, memo, preexisting, 'probe');
      memo.set(preexisting, 'during-window');
      journalCheckpointMemoEntry(ce, memo, fresh, 'probe');
      memo.set(fresh, 'during-window');
    });

    restore(ce, w);
    expect(memo.get(preexisting)).toBe('at-window-open');
    expect(memo.has(fresh)).toBe(false);
  });
});

describe('the bypass canary', () => {
  test('an event kind with no hook of that kind is reported', () => {
    const bypasses = checkpointCanaryBypasses({
      hooks: new Map([['declare', 2]]),
      events: new Map([
        ['declare', 5],
        ['value-write', 3],
      ]),
    });
    expect(bypasses).toEqual(['value-write']);
  });

  test('counts are NOT compared — many events against one entry is normal', () => {
    // First-write dedup makes counts incomparable by design: three writes to
    // one symbol emit three events and record one entry.
    expect(
      checkpointCanaryBypasses({
        hooks: new Map([['value-write', 1]]),
        events: new Map([['value-write', 99]]),
      })
    ).toEqual([]);
  });

  test('event kinds the journal is not responsible for are not bypasses', () => {
    // `config`, `assumption`, `inference`, `scope-pop` and `binding-repair`
    // report families covered by the eager snapshots and the restore's purges,
    // not by a window entry.
    expect(
      checkpointCanaryBypasses({
        hooks: new Map(),
        events: new Map([
          ['config', 4],
          ['assumption', 1],
          ['inference', 7],
          ['scope-pop', 2],
          ['binding-repair', 3],
        ]),
      })
    ).toEqual([]);
  });
});

describe('snapshot completeness — the drift guard', () => {
  // The design makes the snapshot tuples part of the deliverable: "adding a
  // mutable field to either class requires extending its snapshot type and a
  // test". This IS that test. It fails when a field is added to a definition
  // class without being captured — the failure names the field, so the fix is
  // to add it to the snapshot or to the exclusion list below with a reason.

  /** Not captured, each for a reason stated on `_checkpointSnapshot`. */
  const VALUE_DEF_EXCLUSIONS = new Set([
    'name', // identity
    '_engine', // identity
    '_writeVersion', // monotone counter: BUMPED by a restore, never restored
    '_unsubscribeFromConfigurationChange', // live handle owned by dispose()
    // A memo of the effective type, not state: it is keyed on the fact index
    // it was computed from and on `_writeVersion`, so a restore that moves
    // either one retires it, and a stale entry can never be served.
    '_effectiveType',
  ]);

  const OPERATOR_DEF_EXCLUSIONS = new Set([
    'name', // identity
    'engine', // identity
    'signature', // the accessor; `_signature` is captured instead
  ]);

  test('every mutable field of a value definition is in its snapshot', () => {
    const ce = new ComputeEngine();
    ce.assign('drift', ce.number(1));
    const def = ce.lookupDefinition('drift') as { value: any };
    const captured = new Set(Object.keys(def.value._checkpointSnapshot() as object));
    const missing = Object.getOwnPropertyNames(def.value).filter(
      (f) => !captured.has(f) && !VALUE_DEF_EXCLUSIONS.has(f)
    );
    expect(missing).toEqual([]);
  });

  test('every mutable field of an operator definition is in its snapshot', () => {
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('Add') as { operator: any };
    const captured = new Set(
      Object.keys(def.operator._checkpointSnapshot() as object)
    );
    const missing = Object.getOwnPropertyNames(def.operator).filter(
      (f) => !captured.has(f) && !OPERATOR_DEF_EXCLUSIONS.has(f)
    );
    expect(missing).toEqual([]);
  });

  test('a value-definition snapshot round-trips every field it captures', () => {
    const ce = new ComputeEngine();
    ce.assign('rt', ce.number(1));
    const half = (ce.lookupDefinition('rt') as { value: any }).value;
    const before = half._checkpointSnapshot() as Record<string, unknown>;

    // Move a representative field on each axis the tuple covers.
    half.holdUntil = 'never';
    half.inferredType = !half.inferredType;
    half._isConstant = true;

    half._restoreCheckpointSnapshot(before);
    const after = half._checkpointSnapshot() as Record<string, unknown>;
    for (const key of Object.keys(before))
      expect([key, after[key]]).toEqual([key, before[key]]);
  });
});
