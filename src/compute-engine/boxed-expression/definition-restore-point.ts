import type {
  BoxedDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
} from '../types-definitions.js';
import type { Scope as KernelScope } from '../types-kernel-evaluation.js';

// No import of `types-engine.ts` or `global-types.ts`, also not of a type:
// `types-engine.ts` imports `binding-unit.ts`, which imports this module.
type Scope = KernelScope<BoxedDefinition>;

type Half = BoxedValueDefinition | BoxedOperatorDefinition;

/** The innermost open restore point of each engine
 * (`DefinitionRestorePoint.open()`), the number of open points, and whether
 * a restore is running (its writes are not recorded). */
const ACTIVE = new WeakMap<object, DefinitionRestorePoint>();
let OPEN = 0;
let RESTORING = false;

/** The holder counting of `engine-scope.ts`, which sets it
 * (`setHolderCounting()`): a static import would close a cycle. */
type HolderCount<E> = (ce: E, scope: Scope, def: BoxedValueDefinition) => void;
let HOLDERS:
  { count: HolderCount<never>; uncount: HolderCount<never> } | undefined;
export function setHolderCounting<E extends object>(
  count: HolderCount<E>,
  uncount: HolderCount<E>
) {
  HOLDERS = { count, uncount };
}

/** The side tables keyed on a definition whose entry is put back with the
 * definition (`registerDefinitionSideTable()`). */
const SIDE_TABLES: (WeakMap<object, unknown> | WeakSet<object>)[] = [];

/**
 * The state of definitions that a computation writes in place, kept so that
 * the computation can put it back when it ends. The Epsil static check boxes
 * a program whose statements can redefine or narrow a definition that
 * outlives it (`function h(0) { 100 }` adds a clause to an `h` that the host
 * defined, `f = x => x + 1` replaces the halves of the binding of `f`), and
 * it must leave the engine as it found it (`epsil/static-diagnostics.ts`).
 *
 * While the point is open, each writer of a definition calls
 * `beforeDefinitionWrite()` (a binding record or a half) or
 * `beforeScopeWrite()` (an entry of a scope) before its first write. The
 * point records the definition then: a binding record with its two halves
 * by identity, a half with its own snapshot (`_typeSlotSnapshot()` for a
 * value, `_rederivationSnapshot()` for an operator), its provenance history
 * and its entries in the side tables. A definition made while the point is
 * open, and an entry of a scope made inside the point's scope, are not
 * recorded: they do not outlive the computation.
 */
export class DefinitionRestorePoint {
  private readonly _restores = new Map<object, () => void>();
  private readonly _created = new WeakSet<object>();
  /** For each recorded scope entry, the value halves that the computation
   * made and installed there. */
  private readonly _scopes = new Map<Scope, Map<string, Set<Half>>>();
  private readonly _scopeRestores: (() => void)[] = [];
  private _enclosing: DefinitionRestorePoint | undefined;
  private _open = false;

  constructor(
    private readonly _engine: object,
    private readonly _scope?: Scope
  ) {}

  /** Record the writes on the definitions of the engine from now on, until
   * `close()`. */
  open(): void {
    this._enclosing = ACTIVE.get(this._engine);
    ACTIVE.set(this._engine, this);
    this._open = true;
    OPEN += 1;
  }

  /** Stop recording. */
  close(): void {
    if (!this._open) return;
    this._open = false;
    OPEN -= 1;
    if (ACTIVE.get(this._engine) !== this) return;
    if (this._enclosing === undefined) ACTIVE.delete(this._engine);
    else ACTIVE.set(this._engine, this._enclosing);
  }

  /** True when a definition or a scope entry was recorded. */
  get recorded(): boolean {
    return this._restores.size > 0 || this._scopeRestores.length > 0;
  }

  /** Put back every binding and half recorded, then every scope entry, each
   * newest first: a scope entry reads the restored binding records. Each
   * entry is put back even when an earlier one throws; the first error is
   * thrown after. */
  restore(): void {
    this.close();
    const restores = [...this._restores.values()];
    restores.unshift(...this._scopeRestores);
    this._restores.clear();
    this._scopeRestores.length = 0;
    let failure: { error: unknown } | undefined;
    const restoring = RESTORING;
    RESTORING = true;
    for (let i = restores.length - 1; i >= 0; i--) {
      try {
        restores[i]();
      } catch (error) {
        failure ??= { error };
      }
    }
    RESTORING = restoring;
    if (failure !== undefined) throw failure.error;
  }

  /** Record `binding`, a binding record, and its halves. */
  _addBinding(binding: BoxedDefinition): void {
    if (this._restores.has(binding)) return;
    const record = binding as { value?: Half; operator?: Half };
    const value = record.value;
    const operator = record.operator;
    if (value !== undefined) this._addHalf(value);
    if (operator !== undefined) this._addHalf(operator);
    const restoreTables = sideTablesRestore(binding);
    this._restores.set(binding, () => {
      restoreTables();
      const current = record.value as BoxedValueDefinition | undefined;
      if (value !== undefined) record.value = value;
      else delete record.value;
      if (operator !== undefined) record.operator = operator;
      else delete record.operator;
      // The half that the computation installed is dropped, and the half it
      // replaced listens to configuration changes again
      // (`_releaseConfigurationChange()`, `updateDef`).
      if (current === value) return;
      (
        value as { _resubscribeConfigurationChange?: () => void } | undefined
      )?._resubscribeConfigurationChange?.();
      if (current !== undefined && this._created.has(current))
        current.dispose();
    });
  }

  /** Record the state of `half`, a definition object. */
  _addHalf(half: Half): void {
    if (!this._restores.has(half)) this._restores.set(half, halfRestore(half));
  }

  _isOutside(def: object): boolean {
    return !this._created.has(def);
  }

  get enclosing(): DefinitionRestorePoint | undefined {
    return this._enclosing;
  }

  _hasScope(scope: Scope): boolean {
    for (let s: Scope | null | undefined = scope; s; s = s.parent)
      if (s === this._scope) return true;
    return false;
  }

  /** Record the entry `name` of `scope`, and the binding it holds. The
   * restore puts the entry back after the binding, moves the count of the
   * live frames that hold the scope (`countDeclaredHolder`,
   * `engine-scope.ts`), and disposes the value half that the computation
   * declared there. */
  _addScopeEntry(scope: Scope, name: string): void {
    let saved = this._scopes.get(scope);
    if (saved === undefined) this._scopes.set(scope, (saved = new Map()));
    const valueOf = (b: unknown) => (b as { value?: Half } | undefined)?.value;
    const made = saved.get(name);
    if (made !== undefined) {
      const half = valueOf(scope.bindings.get(name));
      if (half !== undefined && this._created.has(half)) made.add(half);
      return;
    }
    const halves = new Set<Half>();
    saved.set(name, halves);
    const binding = scope.bindings.get(name);
    // The engine that `setHolderCounting()` was given functions for.
    const ce = this._engine as never;
    this._scopeRestores.push(() => {
      const current = valueOf(scope.bindings.get(name));
      if (binding === undefined) scope.bindings.delete(name);
      else scope.bindings.set(name, binding);
      const value = valueOf(binding);
      if (current !== value && current !== undefined && 'value' in current)
        HOLDERS?.uncount(ce, scope, current as BoxedValueDefinition);
      if (current !== value && value !== undefined && 'value' in value)
        HOLDERS?.count(ce, scope, value as BoxedValueDefinition);
      if (current !== undefined) halves.add(current);
      for (const half of halves)
        if (half !== value && this._created.has(half))
          (half as { dispose?: () => void }).dispose?.();
    });
    if (binding !== undefined) this._addBinding(binding);
  }

  _noteCreated(def: object): void {
    this._created.add(def);
  }
}

/** Note that `def`, a definition object of `ce`, was made now: an open
 * restore point does not record it. Called by the constructors of the
 * definitions. */
export function noteDefinitionCreated(ce: object, def: object): void {
  if (OPEN === 0) return;
  for (let point = ACTIVE.get(ce); point !== undefined; point = point.enclosing)
    point._noteCreated(def);
}

/** Record `def` (a binding record or one of its halves) in the open restore
 * point of its engine before a write on it, when it outlives the point. */
export function beforeDefinitionWrite(def: object): void {
  if (OPEN === 0 || RESTORING) return;
  // A half has a name; a binding record has none.
  if (!('name' in def)) {
    const record = def as { value?: object; operator?: object };
    for (
      let point = ACTIVE.get(engineOf(record.value ?? record.operator ?? {}));
      point !== undefined;
      point = point.enclosing
    ) {
      if (
        (record.value !== undefined && point._isOutside(record.value)) ||
        (record.operator !== undefined && point._isOutside(record.operator))
      )
        point._addBinding(def as BoxedDefinition);
    }
  } else {
    for (
      let point = ACTIVE.get(engineOf(def));
      point !== undefined;
      point = point.enclosing
    ) {
      if (point._isOutside(def)) point._addHalf(def as unknown as Half);
    }
  }
}

/** Record the entry `name` of `scope`, a scope of `ce`, in the open
 * restore point of `ce` before a declaration or a removal there, when the
 * scope outlives the point. */
export function beforeScopeWrite(ce: object, scope: Scope, name: string): void {
  if (OPEN === 0 || RESTORING) return;
  for (
    let point = ACTIVE.get(ce);
    point !== undefined;
    point = point.enclosing
  ) {
    if (!point._hasScope(scope)) point._addScopeEntry(scope, name);
  }
}

/** Put back the entry of a definition in `table` with the definition. A
 * writer of the table calls `beforeDefinitionWrite()` first. */
export function registerDefinitionSideTable(
  table: WeakMap<object, unknown> | WeakSet<object>
): void {
  SIDE_TABLES.push(table);
}

function sideTablesRestore(key: object): () => void {
  const saved = SIDE_TABLES.map((t) => [
    t.has(key),
    t instanceof WeakMap ? t.get(key) : undefined,
  ]);
  return () =>
    SIDE_TABLES.forEach((t, i) => {
      if (!saved[i][0]) t.delete(key);
      else if (t instanceof WeakMap) t.set(key, saved[i][1]);
      else t.add(key);
    });
}

function engineOf(def: object): object {
  const d = def as { engine?: object; _engine?: object };
  return d.engine ?? d._engine ?? def;
}

function halfRestore(half: Half): () => void {
  const history = half._typeProvenance?.slice();
  const restoreTables = sideTablesRestore(half);
  if ('signature' in half) {
    const snapshot = half._rederivationSnapshot();
    return () => {
      half._restoreRederivationSnapshot(snapshot);
      half._typeProvenance = history;
      restoreTables();
    };
  }
  const snapshot = half._typeSlotSnapshot();
  return () => {
    half._restoreTypeSlots(snapshot);
    half._typeProvenance = history;
    restoreTables();
  };
}
