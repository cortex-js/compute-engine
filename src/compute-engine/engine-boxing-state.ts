import { UnitEnvironment } from './binding-unit.js';

/**
 * Per-engine state of the boxing of expressions.
 *
 * A root construction makes nested `ce.expr()` calls one construction
 * (`withRootRepair()`).
 */
export class EngineBoxingState<Scope extends object> {
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
   * The environment of the binding unit of the root construction in
   * progress (`binding-unit.ts`). Made at the first request, and cleared
   * when the root construction ends. A construction that continues the unit
   * of an operand sets it instead (`setUnitEnvironment()`).
   */
  private _unitEnvironment: UnitEnvironment | null = null;

  /**
   * Every environment that the root construction in progress wrote in, with
   * a journal open on it (`noteUnitWrite()`): the environment of the unit,
   * the environment of a boxed operand from another unit, and the private
   * environment of a symbol made outside a boxing. When the root
   * construction throws, all its writes are undone. The journals are closed
   * when the root construction ends.
   */
  private _journaled: UnitEnvironment[] = [];

  /**
   * The value definitions that the root construction in progress made (a
   * parameter of a function literal, the index of a `Sum`, a local of a
   * block). A use of
   * such a definition narrows it when the definition is in a scope that the
   * construction created; when it is in a scope that existed before the
   * construction, the use writes its requirement in the environment of the
   * unit, as a use of any other definition with no explicit type does
   * (`BoxedSymbol._unitWriteScope()`). Made at the first record, and
   * cleared when the root construction ends.
   */
  private _madeDefinitions: Set<object> | null = null;

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
   * that an exception that ends the root construction removes the writes
   * (`withRootRepair()`). */
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
      const result = build();
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
      this._unitEnvironment = null;
      this._madeDefinitions = null;
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

  /** Undo all the writes of the root construction in each journaled
   * environment, and close the journals. The undo sends no engine-wide
   * event: it moves the counter of the environment
   * (`UnitEnvironment.undoJournal()`), and a type cached from an entry of
   * the environment keeps that counter (rule 9 of
   * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). */
  private _discardUnitWrites(): void {
    if (this._journaled.length === 0) return;
    for (const env of this._journaled) env.undoJournal(0);
    for (const env of this._journaled) env.endJournal();
    this._journaled = [];
  }
}
