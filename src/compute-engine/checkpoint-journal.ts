/**
 * The copy-on-write **checkpoint journal** described by
 * `docs/CHECKPOINT-MODEL.md`.
 *
 * A notebook client takes a checkpoint at a cell boundary and later rewinds
 * the engine to it, so that "the user edited cell k" becomes *restore the
 * checkpoint taken before cell k, replay cells k…n*. Rewinding must rewrite
 * the EXISTING definition records in place and advance monotone counters —
 * never swap registry or definition objects — because live boxed expressions
 * capture record identity (`BoxedSymbol._def` is a readonly pointer;
 * `sameBindingDef` in `binders.ts` is object identity). Preserving identity is
 * also what makes restore-then-replay cheaper than a full re-run for the
 * consumer: their collection element memo validates dependencies by binding
 * identity, so a re-registration gesture would make every memo cold.
 *
 * State whose size is bounded at a cell boundary (the type and protocol
 * registries, assumptions, host configuration, sequence registries) is
 * snapshotted eagerly instead; this journal covers the unbounded, high-volume
 * families: definition-record fields, scope-map bindings, object slots, and
 * the two unstamped expression-keyed memos.
 *
 * ## Windows
 *
 * At most ONE window is ACTIVE at a time — `ce._checkpointWindow`, `undefined`
 * when no checkpoint is live. A window opens when a checkpoint is taken and
 * closes at the earlier of the next checkpoint or a restore/discard involving
 * its checkpoint; each closed window stays attached to its checkpoint. So the
 * write path records into exactly one window, at the cost of one map lookup
 * per write, and the FIRST write to each (owner, key) records the prior value
 * while later writes to the same key in the same window are free. That
 * first-write-wins rule is what makes every entry in a window carry the value
 * as of window OPEN, which in turn makes the entries within a window mutually
 * independent — replay order inside a window does not matter.
 *
 * ## Why this is not an `InferenceRollbackFrame`
 *
 * The effect derivers refuse to stamp their memos while a rollback frame is
 * open (`engine-protocols.ts`, `boxed-operator-definition.ts`), because an
 * inference frame's undo advances no counter, so a memo stamped inside the
 * frame would survive the undo stale. A checkpoint window is held open for a
 * whole cell, or many cells; under that rule it would disable memo stamping
 * engine-wide. The checkpoint journal is exempt because its restore DOES
 * advance the counters — every memo stamped during the window is invalidated
 * by the restore's bumps — so it has to be a separate mechanism with its own
 * lifetime.
 *
 * A LEAF module by design: it imports nothing (types included), so any layer
 * — `types-engine.ts`, `boxed-expression/*`, `engine-declarations.ts` — can
 * import it without creating a dependency cycle.
 */

/** What a restore has to release when it orphans a definition half: the
 * configuration-change subscription a constant's value definition takes out
 * when it is constructed. Only `_BoxedValueDefinition` has one. */
export type CheckpointDisposable = { dispose(): void };

/** The stand-in owner of a DELTA entry — see {@link CheckpointWindow.recordDelta}.
 * A module-private object, so no caller's record can collide with it. */
const DELTA_ENTRY: object = { delta: true };

/** One journaled mutation. `undo()` restores the state the mutation replaced,
 * writing raw slots directly — no setters, no state events, and no journaling
 * of its own, so a restore is never recorded as new window writes.
 *
 * `owner`/`key` identify what was written. They are the dedup key during the
 * window and again when one window is FOLDED into an older one. */
export type CheckpointUndoEntry = {
  readonly owner: object;
  readonly key: string;
  undo: (() => void) | undefined;
};

/** The event kinds the bypass canary reconciles against hooked keys. A window
 * that saw one of these state events but recorded no hook of the matching kind
 * is evidence of a write that bypassed the journal. */
export type CheckpointHookKind =
  | 'value-write'
  | 'type-write'
  | 'declare'
  | 'redefine'
  | 'object-store'
  | 'memo';

/**
 * `CE_CHECKPOINT_CANARY`: the journal bypass canary.
 *
 * With the variable set, each window additionally tallies, per hook kind, how
 * many times a hook was reached BEFORE first-write dedup, and how many state
 * events of each kind the engine reported while the window was open. The
 * differential harness compares the two as KEY SETS — an event kind with a
 * nonzero event count and a zero hook count is a bypass. Raw COUNTS are never
 * compared: repeated writes to one key emit many events and record one entry,
 * so equality of counts is false by construction.
 *
 * A diagnostic aid, not a semantic mode: unset — the default — every tally
 * site is a single branch on this module constant.
 */
export const CHECKPOINT_CANARY: boolean = (() => {
  if (typeof process === 'undefined') return false;
  const flag = process.env?.CE_CHECKPOINT_CANARY;
  return flag !== undefined && flag !== '0';
})();

/** A per-window tally of hook reaches and state events, by kind. Populated
 * only under {@link CHECKPOINT_CANARY}. */
export type CheckpointCanaryTally = {
  /** Hook reaches, counted BEFORE first-write dedup. */
  hooks: Map<CheckpointHookKind, number>;
  /** State events reported by the engine while this window was active. */
  events: Map<string, number>;
};

/** The state-event kinds that must be backed by a journaling hook, paired
 * with the hook kind that backs each. An event kind absent from this table —
 * `scope-pop`, `assumption`, `inference`, `config`, `binding-repair` — reports
 * a change the journal is not responsible for: those families are covered by
 * the eager snapshots and the restore's purges (§4a, §4c), not by a window
 * entry. */
const CANARY_EVENT_HOOKS: ReadonlyArray<[string, CheckpointHookKind]> = [
  ['value-write', 'value-write'],
  ['type-write', 'type-write'],
  ['declare', 'declare'],
  ['redefine', 'redefine'],
  ['object-store', 'object-store'],
];

/**
 * The state-event kinds a window saw with NO journaling hook of the matching
 * kind behind them — each one a write that bypassed the journal.
 *
 * KEY SETS, never counts: a window records one entry per (record, field) and
 * emits one event per write, so a symbol assigned three times in a cell shows
 * three events against one entry. Comparing the counts would report a bypass
 * on every correctly-journaled window. What cannot happen without a bypass is
 * an event kind arriving with the hook count for that kind still at zero.
 *
 * Answers an empty array when the tally is absent (the canary is off).
 */
export function checkpointCanaryBypasses(
  tally: CheckpointCanaryTally | undefined
): string[] {
  if (tally === undefined) return [];
  const bypasses: string[] = [];
  for (const [event, hook] of CANARY_EVENT_HOOKS) {
    if (
      (tally.events.get(event) ?? 0) > 0 &&
      (tally.hooks.get(hook) ?? 0) === 0
    )
      bypasses.push(event);
  }
  return bypasses;
}

/**
 * One copy-on-write journal window: the undo entries recorded since the
 * window opened, deduplicated so that only the FIRST write to each
 * (owner, key) is kept.
 */
export class CheckpointWindow {
  /** Entries in recording order. Allocated eagerly — a window that records
   * nothing is the exception here, unlike an inference rollback frame. */
  private readonly _entries: CheckpointUndoEntry[] = [];

  /** The (owner, key) pairs already recorded, as owner → set of keys. A
   * `Map` keyed on the record objects themselves: identity is exactly the
   * grain the journal restores at, and the window is short-lived enough that
   * holding the records strongly for its lifetime is intended — the restore
   * has to reach them. */
  private readonly _claimed = new Map<object, Set<string>>();

  /** The entry created by the last {@link claim} that answered `true` and is
   * still waiting for its {@link push}. At most one is outstanding: building
   * an undo payload reads fields and never writes, so no journaled write can
   * interleave between the two calls. */
  private _pending: CheckpointUndoEntry | undefined = undefined;

  /** Bypass-canary tallies; `undefined` unless {@link CHECKPOINT_CANARY}. */
  readonly canary: CheckpointCanaryTally | undefined = CHECKPOINT_CANARY
    ? { hooks: new Map(), events: new Map() }
    : undefined;

  /** VALUE-definition halves constructed while this window was open. Every one
   * of them is orphaned by a restore through this window — the window rewinds
   * to before it existed — so each must be `dispose()`d exactly once, or the
   * configuration-change listener a constant's definition subscribes on
   * construction leaks for the engine's lifetime.
   *
   * Operator halves are NOT listed, and not because they are missed:
   * `_BoxedOperatorDefinition` has no `dispose()` and holds no subscription
   * to release, so an orphaned one needs nothing but to become unreachable.
   * The one place it is held strongly after being orphaned is the
   * forward-reference registry (`provisional-application.ts`), and the
   * registration is undone by that registry's own journal entries rather
   * than by disposal.
   *
   * Deliberately NOT deduplicated by the (owner, key) rule: that rule keeps
   * the FIRST journaled write per record, while every half constructed after
   * the window opened is orphaned regardless of how many of them there were.
   * Only halves this engine constructed are listed — a caller-supplied,
   * already-boxed half may pre-exist the window and be shared. */
  private readonly _created: CheckpointDisposable[] = [];

  /** How many undo entries this window holds. The cost of a restore through
   * it, and of folding it into an older window, are both linear in this. */
  get size(): number {
    return this._entries.length;
  }

  /**
   * Claim (owner, key) for this window. Answers `true` when this is the FIRST
   * write to that pair since the window opened — the caller must then follow
   * with exactly one {@link push} carrying the undo for the state being
   * overwritten. Answers `false` when the pair is already journaled, in which
   * case the caller records nothing: the entry already in the window carries
   * the value as of window open, which is what a restore needs.
   *
   * Splitting the claim from the push is what keeps an expensive undo payload
   * — a full definition-record snapshot — off the repeat-write path: it is
   * built only after the claim answers `true`.
   */
  claim(owner: object, key: string, kind?: CheckpointHookKind): boolean {
    if (this.canary !== undefined && kind !== undefined)
      this.canary.hooks.set(kind, (this.canary.hooks.get(kind) ?? 0) + 1);

    let keys = this._claimed.get(owner);
    if (keys === undefined) {
      keys = new Set();
      this._claimed.set(owner, keys);
    } else if (keys.has(key)) return false;
    keys.add(key);

    console.assert(
      this._pending === undefined,
      'Checkpoint journal: a claim is still awaiting its push'
    );
    const entry: CheckpointUndoEntry = { owner, key, undo: undefined };
    this._entries.push(entry);
    this._pending = entry;
    return true;
  }

  /** Attach the undo for the claim that just answered `true`. */
  push(undo: () => void): void {
    const pending = this._pending;
    console.assert(
      pending !== undefined,
      'Checkpoint journal: push without a preceding successful claim'
    );
    if (pending === undefined) return;
    pending.undo = undo;
    this._pending = undefined;
  }

  /** The claim-and-push pair as one call, for undo payloads cheap enough to
   * build unconditionally (a single field's previous value). */
  record(
    owner: object,
    key: string,
    undo: () => void,
    kind?: CheckpointHookKind
  ): void {
    if (this.claim(owner, key, kind)) this.push(undo);
  }

  /** Record a value-definition half constructed while this window was open —
   * see {@link created}. */
  noteCreated(half: CheckpointDisposable): void {
    this._created.push(half);
  }

  /** The value-definition halves constructed while this window was open, in
   * construction order. The restore algorithm disposes each exactly once,
   * AFTER every half restore has run: a half orphaned by one journal entry
   * can be reinstated by an older entry in the same restore. */
  created(): ReadonlyArray<CheckpointDisposable> {
    return this._created;
  }

  /**
   * Record an undo that is a DELTA rather than a whole-state restore, exempt
   * from first-write-wins dedup.
   *
   * The forward-reference registry (`provisional-application.ts`) journals
   * this way: each of its mutators undoes exactly the membership IT added or
   * removed, so keeping only the first call's entry per window would leave
   * every later call's delta applied. Delta entries carry no (owner, key), so
   * they are never deduplicated, never dropped by a fold, and — because the
   * replay is strictly reverse-chronological — they unwind in LIFO order,
   * which is what a delta journal requires. Keyed entries in the same window
   * are order-independent, so the two kinds interleave safely.
   */
  recordDelta(undo: () => void): void {
    console.assert(
      this._pending === undefined,
      'Checkpoint journal: a claim is still awaiting its push'
    );
    this._entries.push({ owner: DELTA_ENTRY, key: '', undo });
  }

  /** Note a state event reported while this window was active. Canary only. */
  noteEvent(kind: string): void {
    if (this.canary === undefined) return;
    this.canary.events.set(kind, (this.canary.events.get(kind) ?? 0) + 1);
  }

  /**
   * Replay this window's entries, restoring every journaled (owner, key) to
   * the state it held when the window opened.
   *
   * Order is immaterial — first-write-wins makes each entry carry the
   * window-open value, and each (owner, key) appears once — so the reverse
   * traversal below is chosen only to match the strict-LIFO discipline the
   * inference rollback frame follows, and to put a folded window's younger
   * entries ahead of the older ones they were folded into.
   *
   * A throw from an undo entry is a broken-engine condition: undo writes raw
   * slots and runs no user code. The unwind continues best-effort past it and
   * the FIRST failure is returned, so the caller can poison the engine rather
   * than let a partially restored state pass for a restored one.
   */
  undo(): { error: unknown } | undefined {
    console.assert(
      this._pending === undefined,
      'Checkpoint journal: undoing a window with a claim still awaiting its push'
    );
    let firstFailure: { error: unknown } | undefined;
    for (let i = this._entries.length - 1; i >= 0; i--) {
      const entry = this._entries[i];
      if (entry.undo === undefined) continue;
      try {
        entry.undo();
      } catch (error) {
        firstFailure ??= { error };
        console.assert(
          false,
          'Checkpoint restore: an undo entry threw — engine state may be partially restored',
          error
        );
      }
    }
    return firstFailure;
  }

  /**
   * Fold this window into `older`, the window of the next-older live
   * checkpoint — what `discard()` does to an interior checkpoint, so that
   * restoring past the discarded one stays sound.
   *
   * An entry is dropped when `older` already holds its (owner, key): the
   * older window's prior value is earlier in time, and a restore to the older
   * checkpoint wants the earlier one. Cost is linear in this window's size.
   * This window is left empty and must not be used again.
   */
  foldInto(older: CheckpointWindow): void {
    console.assert(
      this._pending === undefined,
      'Checkpoint journal: folding a window with a claim still awaiting its push'
    );
    for (const entry of this._entries) {
      // Delta entries are carried unconditionally: they have no (owner, key)
      // to dedup on, and dropping one would leave its mutation applied.
      if (entry.owner === DELTA_ENTRY) older.recordDelta(entry.undo!);
      else if (older.claim(entry.owner, entry.key)) older.push(entry.undo!);
    }
    // Creations move wholesale: a restore through `older` now rewinds past
    // this window too, so everything constructed in it is orphaned as well.
    for (const half of this._created) older.noteCreated(half);
    if (this.canary !== undefined && older.canary !== undefined) {
      for (const [kind, n] of this.canary.hooks)
        older.canary.hooks.set(kind, (older.canary.hooks.get(kind) ?? 0) + n);
      for (const [kind, n] of this.canary.events)
        older.canary.events.set(kind, (older.canary.events.get(kind) ?? 0) + n);
    }
    this._entries.length = 0;
    this._claimed.clear();
    this._created.length = 0;
  }

  /** Every definition record, scope, object or memo map this window wrote to.
   * The restore algorithm walks it to bump per-record versions and to clear
   * the record-keyed side channels (clause provenance) that in-place restore
   * leaves stale. */
  owners(): IterableIterator<object> {
    return this._claimed.keys();
  }

  /** The keys this window journaled for `owner`, for tests and for the
   * restore algorithm's per-family passes. */
  keysFor(owner: object): ReadonlySet<string> | undefined {
    return this._claimed.get(owner);
  }
}

/** The engine surface the journaling hooks need. Structural rather than
 * `IComputeEngine` so that this module stays a leaf. */
export type CheckpointHost = {
  _checkpointWindow: CheckpointWindow | undefined;
};

/** The active window of `host`, or `undefined` when no checkpoint is live —
 * the one field read every journaling hook goes through. Hooks read the field
 * directly on the hot paths; this helper is for the sites that already carry
 * the engine as a wider interface. */
export function activeCheckpointWindow(
  host: CheckpointHost
): CheckpointWindow | undefined {
  return host._checkpointWindow;
}

/** Journal a single field write whose undo is cheap to build: the previous
 * value is already in hand and the undo is one assignment. Does nothing when
 * no checkpoint window is open. */
export function journalCheckpointField<
  O extends object,
  K extends keyof O & string,
>(
  host: CheckpointHost,
  owner: O,
  key: K,
  previous: O[K],
  kind?: CheckpointHookKind
): void {
  const w = host._checkpointWindow;
  if (w === undefined) return;
  w.record(
    owner,
    key,
    () => {
      owner[key] = previous;
    },
    kind
  );
}

/** Journal a `Map` entry write — the shape the scope-binding maps and the
 * object slot map share. The undo reinstates the PREVIOUS entry by identity,
 * or deletes the key when there was none: a name-only delete cannot reinstate
 * a binding that the write merely overwrote, and for an object slot
 * `undefined` is ambiguous between "absent" and "present but undefined". */
export function journalCheckpointMapEntry<K, V>(
  host: CheckpointHost,
  map: Map<K, V>,
  key: K,
  keyLabel: string,
  kind?: CheckpointHookKind,
  /** What the restore algorithm has to reach to finish the job for this
   * entry — the `BoxedObject` whose `_version` needs its post-undo bump, the
   * `Scope` whose map this is. Defaults to the map itself, which is the right
   * dedup grain but tells a later pass nothing about what OWNS it: from a
   * bare `Map` there is no way back to the object. */
  owner: object = map
): void {
  const w = host._checkpointWindow;
  if (w === undefined) return;
  if (!w.claim(owner, keyLabel, kind)) return;
  const had = map.has(key);
  const previous = map.get(key);
  w.push(() => {
    if (had) map.set(key, previous!);
    else map.delete(key);
  });
}

/**
 * Journal a write to an expression-keyed memo that carries no version stamp
 * of its own — `RESOLVED_TYPE_OPERANDS` (`function-literal.ts`) and
 * `probeCache` (`symbolic/limit.ts`). No engine counter reaches those entries,
 * so a node that PREDATES the checkpoint but was first resolved during the
 * window would otherwise keep the window's answer across a restore.
 *
 * Dedup runs on the (memo KEY, memo name) pair rather than on the map: a
 * `WeakMap` has no iteration, so one entry per map would collapse every key
 * into one journal entry. `memoLabel` distinguishes two memos that happen to
 * be keyed on the same node.
 */
export function journalCheckpointMemoEntry<K extends object, V>(
  host: CheckpointHost,
  memo: WeakMap<K, V>,
  key: K,
  memoLabel: string
): void {
  const w = host._checkpointWindow;
  if (w === undefined) return;
  if (!w.claim(key, memoLabel, 'memo')) return;
  const had = memo.has(key);
  const previous = memo.get(key);
  w.push(() => {
    if (had) memo.set(key, previous!);
    else memo.delete(key);
  });
}
