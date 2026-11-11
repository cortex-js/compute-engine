import { UnitEnvironment } from './binding-unit.js';

type DevolveRepairFrame<Scope extends object> = {
  scope: Scope | undefined;
  repairRequested: boolean;
  rebuilding: boolean;
};

/**
 * Rebuilds allowed after the initial pass. Every rebuild sees all the shadows
 * created so far, so one is normally enough: a second is already anomalous,
 * and only a construction whose SHAPE changes as bindings appear could need
 * more. A small bound keeps a scope-lifecycle defect from looping forever.
 */
const MAX_REPAIR_REBUILDS = 3;

/**
 * Per-engine coordination for the un-applied-operator repair performed while
 * boxing expressions.
 *
 * A root frame makes nested `ce.expr()` calls one construction. Scoped frames
 * form local restart boundaries: when validation creates a shadow in a scoped
 * operator, that operator is rebuilt against the same scope, so operands boxed
 * before the declaration see the new binding too.
 */
export class EngineBoxingState<Scope extends object> {
  private _frames: DevolveRepairFrame<Scope>[] = [];
  private _rootActive = false;

  /**
   * The operations in progress, innermost last (rule 8 of
   * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). The bottom can
   * be the environment of an Epsil program (rule 10). A symbol made while an
   * operation is in progress belongs to the innermost one, a boxing that
   * starts then joins it, and a requirement is written in it.
   *
   * An operation nested in an operation that is not a program pushes no
   * entry: it reads and writes in the environment of the operation that
   * encloses it (`ce._opensOperation()`), so the requirements that it
   * writes are kept for the rest of the enclosing operation, and the
   * symbols of its result read them.
   *
   * Each entry holds:
   * - `env`: the environment of the operation;
   * - `programStatement`: see `inProgramStatement`.
   */
  private _operations: {
    env: UnitEnvironment;
    programStatement: boolean;
  }[] = [];

  /**
   * The environments of the trials in progress, innermost last (rule 13 of
   * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). A trial is a
   * computation whose writes are not
   * kept: the admission of an arm of an overloaded operator
   * (`validate.ts`). Every requirement written during a trial goes in its
   * environment, and a read takes the entry of that environment first. The
   * environment is thrown away when the trial ends. The environment of a
   * nested trial has the environment of the enclosing trial as its only
   * parent.
   *
   * A trial is not an operation: a symbol made during a trial belongs to
   * the unit or the operation in progress, as outside the trial.
   */
  private _trials: UnitEnvironment[] = [];

  /** The environment of the innermost trial in progress, or `undefined`. */
  trialEnvironment(): UnitEnvironment | undefined {
    const trials = this._trials;
    return trials.length === 0 ? undefined : trials[trials.length - 1];
  }

  /** Run `fn`, a trial (see `_trials`), in an environment of its own, which
   * is thrown away at the end, also on a throw. */
  withTrial<T>(fn: () => T): T {
    const enclosing = this.trialEnvironment();
    const env =
      enclosing === undefined
        ? new UnitEnvironment()
        : UnitEnvironment.forNested(enclosing);
    this._trials.push(env);
    try {
      return fn();
    } finally {
      const popped = this._trials.pop();
      console.assert(popped === env, 'Unbalanced trial environment');
      env.discard();
    }
  }

  /** The environment of the operation in progress, or `undefined`: the
   * environment that a read starts in, and that a write goes in. */
  currentOperation(): UnitEnvironment | undefined {
    const ops = this._operations;
    return ops.length === 0 ? undefined : ops[ops.length - 1].env;
  }

  /** Run `fn` with `env` as the environment of the operation in progress,
   * and put back the previous one at the end, also on a throw. */
  withOperation<T>(env: UnitEnvironment, fn: () => T): T {
    this._operations.push({ env, programStatement: false });
    try {
      return fn();
    } finally {
      this._operations.pop();
    }
  }

  /**
   * True while the run driver of an Epsil program evaluates a statement
   * (`asProgramStatement()`) in the operation in progress. That evaluation,
   * and the evaluations nested in it, are not operations of their own: they
   * write in the environment of the program (rule 10). The other operations
   * that the evaluation starts (`simplify()`, `compile()`, …) are
   * operations (rule 8). The flag is kept on the entry of the operation, so
   * an operation or a program that starts inside such an evaluation starts
   * with the flag off.
   */
  get inProgramStatement(): boolean {
    const ops = this._operations;
    return ops.length !== 0 && ops[ops.length - 1].programStatement;
  }

  /** Run `fn`, the evaluation of a statement of an Epsil program by its run
   * driver (see `inProgramStatement`). With no operation in progress,
   * `fn()`. */
  asProgramStatement<T>(fn: () => T): T {
    const ops = this._operations;
    if (ops.length === 0) return fn();
    const top = ops[ops.length - 1];
    const enclosing = top.programStatement;
    top.programStatement = true;
    try {
      return fn();
    } finally {
      top.programStatement = enclosing;
    }
  }

  /**
   * Classifier for the active root construction: `true` for a scope that
   * PRE-EXISTS the construction (it will outlive it), `false` for a scope the
   * construction itself created (a binder's body scope, which is recreated
   * fresh by every boxing of the same input). Captured by `withRootRepair`;
   * `null` while no root construction is active or none was supplied.
   */
  private _isPersistentScope: ((scope: Scope) => boolean) | null = null;

  /**
   * Names the current build pass auto-declared into a construction-created
   * scope. Cleared at the start of every build pass (a rebuild re-resolves
   * every occurrence, so records from the abandoned pass no longer describe
   * anything). Lazily allocated: `null` until the first record.
   */
  private _transientAutoDeclares: Set<string> | null = null;

  /**
   * The environment of the binding unit of the root construction in
   * progress (`binding-unit.ts`). Made at the first request. It is cleared at
   * the
   * start of each build pass of the root, because a rebuild boxes every
   * occurrence again. A construction that continues the unit of an operand
   * sets it instead (`setUnitEnvironment()`).
   */
  private _unitEnvironment: UnitEnvironment | null = null;

  /**
   * Every environment that the root construction in progress wrote in, with
   * a journal open on it (`noteUnitWrite()`): the environment of the unit,
   * the environment of a boxed operand from another unit, and the private
   * environment of a symbol made outside a boxing. At the start of a rebuild
   * of a repair frame, the writes made in each of them since that frame
   * started are undone: for the root frame, all the writes of the discarded
   * pass. When the root construction throws, all its writes are undone. The
   * journals are closed when the root construction ends.
   */
  private _journaled: UnitEnvironment[] = [];

  /**
   * The value definitions that the root construction in progress made (a
   * parameter of a function literal, the index of a `Sum`, a local of a
   * block, the declaration of a free name of the body of a function literal
   * in an outer scope). A use of
   * such a definition narrows it when the definition is in a scope that the
   * construction created; when it is in a scope that existed before the
   * construction, the use writes its requirement in the environment of the
   * unit, as a use of any other definition with no explicit type does
   * (`BoxedSymbol._unitWriteScope()`). Made at the first record, and
   * cleared when the root construction ends.
   */
  private _madeDefinitions: Set<object> | null = null;

  /**
   * The free names of the active root construction that are the outer
   * binding of a free symbol of a binder body, with their home scope
   * (`noteOuterFreeName()`). Kept across the build passes of the root, and
   * cleared when the root construction ends.
   */
  private _outerFreeNames: Map<string, Scope> | null = null;

  /**
   * For the active root construction:
   * the names whose use in a binder body wrote a requirement on the free
   * name of a persistent scope, with that scope (`noteOuterFreeName()`),
   * and the free names that the construction made in a persistent scope
   * (`noteRootFreeName()`). A name in both is in `_outerFreeNames`.
   */
  private _outerRequirements: Map<string, Scope> | null = null;
  private _freeNamesMade: Set<string> | null = null;

  /**
   * For the active root construction: the scope of a persistent lexical
   * chain (see `_isPersistentScope`) whose bindings hold `def` under `name`,
   * or `undefined`. Captured by `withRootRepair`; `null` while no root
   * construction is active or none was supplied.
   */
  private _persistentScopeOf:
    ((name: string, def: object) => Scope | undefined) | null = null;

  /** Record that the root construction in progress made the value
   * definition `def`. Does nothing when no root construction is active. */
  noteDefinitionMade(def: object): void {
    if (this._rootActive) (this._madeDefinitions ??= new Set()).add(def);
  }

  /** True when the root construction in progress made the value definition
   * `def` (`noteDefinitionMade()`). */
  isDefinitionMade(def: object): boolean {
    return this._madeDefinitions?.has(def) === true;
  }

  /** The environment of the root construction in progress. Outside a root
   * construction, the environment of the operation in progress, or
   * `undefined`. A root construction that starts inside an operation joins
   * the environment of the operation and does not start a unit (rule 8). */
  unitEnvironment(): UnitEnvironment | undefined {
    if (!this._rootActive) return this.currentOperation();
    if (this._unitEnvironment === null) {
      const operation = this.currentOperation();
      this._unitEnvironment = operation ?? new UnitEnvironment();
    }
    return this._unitEnvironment;
  }

  /** Make `env` the environment of the root construction in progress: a
   * `ce.function()` call with a boxed operand is not a new unit, and the
   * symbols that it makes take the environment of that operand. Does nothing
   * when no root construction is active, and inside an operation, whose
   * environment receives the writes (rule 8). The writes of the
   * construction in `env` are recorded as in every other environment
   * (`noteUnitWrite()`). */
  setUnitEnvironment(env: UnitEnvironment): void {
    if (!this._rootActive || this.currentOperation() !== undefined) return;
    this._unitEnvironment = env;
  }

  /** Called before a write in the environment `env`. While a root
   * construction is active, open a journal on `env` at its first write, so
   * that a rebuild of a repair frame removes the writes made since the frame
   * started (`_withRepairFrame()`), and an exception that ends the root
   * construction removes all of them (`withRootRepair()`). */
  noteUnitWrite(env: UnitEnvironment): void {
    if (!this._rootActive || this._journaled.includes(env)) return;
    env.beginJournal();
    this._journaled.push(env);
  }

  /** For the active root construction: the persistent scope that holds the
   * definition `def` of `name`, or `undefined` when `def` is in no scope of
   * a lexical chain that existed when the construction began (or no root
   * construction is active). */
  persistentScopeOf(name: string, def: object): Scope | undefined {
    if (!this._rootActive) return undefined;
    return this._persistentScopeOf?.(name, def);
  }

  withRootRepair<T>(
    build: () => T,
    isPersistentScope?: (scope: Scope) => boolean,
    persistentScopeOf?: (name: string, def: object) => Scope | undefined
  ): T {
    if (this._rootActive) return build();

    this._rootActive = true;
    this._isPersistentScope = isPersistentScope ?? null;
    this._persistentScopeOf = persistentScopeOf ?? null;
    let completed = false;
    try {
      const result = this._withRepairFrame(undefined, () => {
        this._transientAutoDeclares = null;
        // A rebuild: remove the requirements that the discarded pass wrote.
        this._discardUnitWrites();
        this._unitEnvironment = null;
        return build();
      });
      completed = true;
      return result;
    } finally {
      // An exception: the writes of the failed pass are not kept.
      if (!completed) this._discardUnitWrites();
      for (const env of this._journaled) env.endJournal();
      this._journaled = [];
      this._rootActive = false;
      this._isPersistentScope = null;
      this._persistentScopeOf = null;
      this._transientAutoDeclares = null;
      this._unitEnvironment = null;
      this._madeDefinitions = null;
      this._outerFreeNames = null;
      this._outerRequirements = null;
      this._freeNamesMade = null;
    }
  }

  /**
   * True while a root construction is running. Nested `box()`/`boxFunction()`
   * calls join that construction (`withRootRepair` returns `build()` directly
   * and ignores its classifier argument), so entry-point setup — building the
   * persistence classifier — can be skipped for them.
   */
  get isRootActive(): boolean {
    return this._rootActive;
  }

  withScopedRepair<T>(scope: Scope, build: () => T): T {
    // `_inScope()` is also used during evaluation. Rebuilding an evaluation
    // would repeat user-visible effects, so scoped repair frames exist only
    // while a root boxing construction is active.
    if (!this._rootActive) return build();
    return this._withRepairFrame(scope, build);
  }

  /**
   * True while a frame is re-running its `build` after a shadow was created.
   *
   * Boxing consults it to rebind the operands that were ALREADY boxed when
   * the shadow appeared: those carry the stale operator binding, and a
   * canonical expression passes through boxing unchanged, so the rebuild
   * alone does not reach them. Only the rebuild pays for that lookup — a
   * normal boxing pass never asks.
   */
  get isRebuilding(): boolean {
    return this._frames.some((frame) => frame.rebuilding);
  }

  /**
   * Whether `scope` outlives the active root construction, per the classifier
   * captured when the construction began. `undefined` when no root
   * construction is active (or no classifier was supplied) — callers must
   * treat that as "don't know" and record nothing.
   */
  isPersistentScope(scope: Scope): boolean | undefined {
    if (!this._rootActive || !this._isPersistentScope) return undefined;
    return this._isPersistentScope(scope);
  }

  /**
   * Record that the running construction auto-declared `name` into a scope it
   * itself created — a binder body's free symbol. If the same construction
   * later declares the same name into a persistent scope (see
   * `noteDeclarationIn`), the two occurrences denote different bindings, and
   * only the persistent one survives to the next boxing of the same input:
   * the first-ever boxing of that shape would compare `isSame` false against
   * every later one. Recording the name here is what lets `noteDeclarationIn`
   * detect the conflict.
   * (First-boxing binding divergence, Tycho item 178(a)+(c) —
   * `docs/SCOPING-MODEL.md`.)
   */
  noteTransientAutoDeclare(name: string): void {
    if (!this._rootActive || !this._isPersistentScope) return;
    (this._transientAutoDeclares ??= new Set()).add(name);
  }

  /**
   * A declaration of `name` just landed in `scope`. If the running root
   * construction had earlier auto-declared the same name into a scope of its
   * own making, and `scope` is persistent, the construction's output binds the
   * two occurrences differently — while every LATER boxing of the same input
   * will find the persistent binding first and resolve both occurrences to it.
   * Request a rebuild of the whole construction: the rebuild starts from the
   * state every later boxing starts from, so its output is the stable one. The
   * rebuild converges in one pass — the persistent binding now exists before
   * any occurrence is processed, so no transient auto-declare of `name`
   * recurs.
   */
  noteDeclarationIn(scope: Scope, name: string): void {
    if (!this._rootActive) return;
    if (!this._transientAutoDeclares?.has(name)) return;
    if (this._isPersistentScope?.(scope) !== true) return;

    const root = this._frames.find((frame) => frame.scope === undefined);
    if (root) root.repairRequested = true;
  }

  /**
   * The use of a free symbol of a
   * binder body, which the running construction auto-declared into a scope
   * of its own making, wrote its requirement on the free name `name` of the
   * persistent scope `home`, in place of an outer declaration that
   * `noteDeclarationIn()` sees.
   *
   * When the construction also made a free name `name` outside the body
   * (`noteRootFreeName()`: the point `a` of
   * `Limit(Function(Block(1/(x - a)), x), a)`), the construction is rebuilt
   * as it is for that declaration, and in the rebuild each occurrence of
   * `name` under `home` is that free name (`outerFreeNameHome()`), so the
   * occurrences of the body and those outside it are the same binding
   * (rule 7 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). A
   * name that occurs only in the body keeps the definition of the body's
   * scope, whose type the check of a captured symbol reads.
   */
  noteOuterFreeName(home: Scope, name: string): void {
    if (!this._rootActive) return;
    if (!this._transientAutoDeclares?.has(name)) return;
    if (this._isPersistentScope?.(home) !== true) return;
    if (this._outerRequirements?.has(name) !== true)
      (this._outerRequirements ??= new Map()).set(name, home);
    this._mergeOuterFreeName(name);
  }

  /** The active root construction
   * made the free name `name` in a persistent scope (see
   * `noteOuterFreeName()`). */
  noteRootFreeName(name: string): void {
    if (!this._rootActive) return;
    if (this._freeNamesMade?.has(name) === true) return;
    (this._freeNamesMade ??= new Set()).add(name);
    this._mergeOuterFreeName(name);
  }

  /** Record `name` in `_outerFreeNames` and ask for a rebuild of the root
   * construction, when the name is used in a binder body and is a free
   * name outside it. */
  private _mergeOuterFreeName(name: string): void {
    if (this._outerFreeNames?.has(name) === true) return;
    const home = this._outerRequirements?.get(name);
    if (home === undefined || this._freeNamesMade?.has(name) !== true) return;
    (this._outerFreeNames ??= new Map()).set(name, home);
    const root = this._frames.find((frame) => frame.scope === undefined);
    if (root) root.repairRequested = true;
  }

  /** The home scope recorded by `noteOuterFreeName()` for `name` in the
   * active root construction, or `undefined`. */
  outerFreeNameHome(name: string): Scope | undefined {
    return this._outerFreeNames?.get(name);
  }

  /** Number of repair frames currently on the stack. Recorded by an
   * inference rollback frame at open (`inference-rollback.ts`), so its
   * close-time scan (`hasRepairRequestedAtOrAbove`) covers exactly the
   * repair frames pushed during the rollback frame's lifetime. */
  frameDepth(): number {
    return this._frames.length;
  }

  /** True when a still-live repair frame at index `depth` or above has a
   * pending rebuild request. A request consumed by its own rebuild loop
   * before the caller asks does not count — only one still pending, which
   * would rebuild against state the closing rollback frame has already
   * restored. */
  hasRepairRequestedAtOrAbove(depth: number): boolean {
    for (let i = depth; i < this._frames.length; i++)
      if (this._frames[i].repairRequested) return true;
    return false;
  }

  /** Request a rebuild at the nearest frame that owns `scope`. */
  noteDevolvedShadow(scope: Scope): void {
    for (let i = this._frames.length - 1; i >= 0; i--) {
      const frame = this._frames[i];
      if (frame.scope === scope) {
        frame.repairRequested = true;
        return;
      }
    }

    // An unscoped construction is the fallback owner. This is normally the
    // root frame; scanning from the outside keeps the whole expression as the
    // restart boundary instead of rebuilding only the operand that noticed the
    // stale binding.
    const root = this._frames.find((frame) => frame.scope === undefined);
    // No frame at all: the shadow was invented outside any boxing
    // construction, so nothing will redo the occurrences that were bound
    // before it existed. That is a construction path bypassing
    // `box()`/`ce.function()`, not a user error — flag it in development, the
    // same way the frame-balance invariant below is flagged.
    console.assert(
      root !== undefined,
      'Devolved shadow created outside a boxing construction: the stale bindings will not be repaired'
    );
    if (root) root.repairRequested = true;
  }

  /** Undo the writes of each journaled environment after the mark that
   * `marks` gives for it (0 when it has none: its journal was opened after
   * the marks were taken). The undo sends no engine-wide event: it moves
   * the counter of the environment (`UnitEnvironment.undoJournal()`), and a
   * type cached from an entry of the environment keeps that counter (rule 9
   * of `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). */
  private _undoUnitWrites(
    marks: ReadonlyMap<UnitEnvironment, number> | undefined
  ): void {
    for (const env of this._journaled) env.undoJournal(marks?.get(env) ?? 0);
  }

  /** Undo all the writes of the current build pass of the root, and close
   * the journals. */
  private _discardUnitWrites(): void {
    if (this._journaled.length === 0) return;
    this._undoUnitWrites(undefined);
    for (const env of this._journaled) env.endJournal();
    this._journaled = [];
  }

  private _withRepairFrame<T>(scope: Scope | undefined, build: () => T): T {
    const frame: DevolveRepairFrame<Scope> = {
      scope,
      repairRequested: false,
      rebuilding: false,
    };
    // A scoped frame: the length of the journal of each journaled
    // environment when the frame starts. A rebuild of the frame removes only
    // the writes made after these marks. In an environment whose journal was
    // opened later, in the frame, the rebuild removes all the writes.
    const marks =
      scope === undefined || this._journaled.length === 0
        ? undefined
        : new Map(this._journaled.map((env) => [env, env.journalLength()]));
    this._frames.push(frame);
    try {
      let result = build();
      let rebuilds = 0;
      while (frame.repairRequested) {
        // A retry against the same scope must see the shadows created by the
        // previous passes. If it keeps creating new ones, the construction is
        // not stable and looping forever would conceal a scope-lifecycle
        // defect.
        if (rebuilds >= MAX_REPAIR_REBUILDS) {
          const message = `Devolved-shadow repair did not stabilize after ${MAX_REPAIR_REBUILDS} rebuilds`;
          console.assert(false, message);
          // `console.*` is stripped from production builds, so the assert
          // alone would let an expression in which one name denotes two
          // things ship silently. Throwing is the only signal available here:
          // this class is engine-agnostic — it cannot build an `Error`
          // expression — and the result it returns must stay a valid boxing
          // anyway. The condition is an engine defect, not bad input, so a
          // thrown `Error` (as `boxFunction` already does for a malformed
          // operator name) is the least surprising failure.
          throw new Error(message);
        }
        frame.repairRequested = false;
        frame.rebuilding = true;
        rebuilds += 1;
        // The root frame undoes the writes of its discarded pass in its own
        // `build` (`withRootRepair()`).
        if (scope !== undefined) this._undoUnitWrites(marks);
        try {
          result = build();
        } finally {
          frame.rebuilding = false;
        }
      }
      return result;
    } finally {
      const popped = this._frames.pop();
      console.assert(popped === frame, 'Unbalanced boxing repair frame');
    }
  }
}
