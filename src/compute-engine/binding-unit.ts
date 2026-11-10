import type { BoxedType } from '../common/type/boxed-type.js';

/**
 * The environment of a binding unit.
 *
 * A binding unit is one outermost boxing: a `ce.parse()`, `ce.box()`,
 * `ce.expr()` or `ce.function()` call that no other boxing encloses. Each
 * symbol that the boxing makes keeps a reference to the environment of its
 * unit (`BoxedSymbol._env`).
 *
 * The environment holds the types that the uses in the unit require of the
 * names that have no explicit type: a name with no definition (a free name),
 * a name whose definition has an inferred type, and a name whose definition
 * has the type `unknown`. A use of such a name writes its requirement here,
 * not on a definition. So the boxing of one expression does not change the
 * type that another expression reads.
 *
 * An entry is keyed on a pair (key, name). For a free name, the key is its
 * home scope: the scope that a declaration of the name would go in. For a
 * name with a value definition, the key is that definition. So every
 * occurrence of a name in a unit reads one entry, from any context.
 *
 * The counter moves at each write that changes an entry. A cache that depends
 * on the entries of an environment keeps the counter that it read, and
 * computes its value again when the counter moved.
 *
 * This mechanism is active only when the engine flag `_bindingUnits` is true.
 * The plan is `docs/plans/2026-11-09-binding-units-slice-1-spec.md`.
 */
export class UnitEnvironment {
  private _types: Map<object, Map<string, BoxedType>> | undefined = undefined;

  /** For an entry whose type is a scalar numeric type: true when every use
   * that required a number was an operand of an operator that maps over a
   * collection. The same record as `SCALAR_USES_MAP` (`boxed-symbol.ts`) for
   * a definition, kept here for the entries of the unit. */
  private _scalarUsesMap: Map<object, Map<string, boolean>> | undefined =
    undefined;

  /** For each scope, the names of library operators that the unit reads as
   * variables (`readsAsVariable()`). */
  private _variableReadings: Map<object, Set<string>> | undefined = undefined;

  /** The number of writes that changed an entry. */
  private _counter = 0;

  /** While a journal is open: for each write, a function that puts back the
   * entry or the record of the uses as it was before that write, and true
   * when the write was on a type entry (not on the record of the uses). */
  private _journal: { undo: () => void; type: boolean }[] | undefined =
    undefined;

  get counter(): number {
    return this._counter;
  }

  /** The type that the unit requires of `name` in the scope `scope`, or
   * `undefined` when no use wrote a requirement. */
  get(scope: object, name: string): BoxedType | undefined {
    return this._types?.get(scope)?.get(name);
  }

  set(scope: object, name: string, type: BoxedType): void {
    this._types ??= new Map();
    let entries = this._types.get(scope);
    if (entries === undefined) this._types.set(scope, (entries = new Map()));
    this._journalWrite(entries, name, true);
    entries.set(name, type);
    this._counter += 1;
  }

  /**
   * Start to record the writes in this environment, so that
   * `undoJournal()` can remove them. A root construction opens a journal on
   * each environment at its first write in it
   * (`EngineBoxingState.noteUnitWrite()`): the environment of its own unit,
   * the environment of a boxed operand from another unit
   * (`ce.function()` with boxed operands), and the private environment of a
   * symbol made outside a boxing. When the construction is built again, the
   * requirements of the discarded pass are removed before the next pass
   * writes its own, and an exception removes all of them
   * (`EngineBoxingState.withRootRepair()`). A scoped repair frame keeps the
   * length of each journal when it starts (`journalLength()`), and removes
   * only the writes after it.
   */
  beginJournal(): void {
    this._journal = [];
  }

  /** Stop the record of the writes, and keep them. */
  endJournal(): void {
    this._journal = undefined;
  }

  /** The number of writes in the open journal: 0 when no journal is open. */
  journalLength(): number {
    return this._journal?.length ?? 0;
  }

  /** Put back the entries and the records of the uses as they were when the
   * open journal had `mark` writes (0: when it was opened). The journal
   * stays open. The counter moves when a write is removed.
   *
   * The result is true when a type entry was removed or changed: a type
   * cached from the entries can then be too narrow, and the caller sends a
   * widening inference event. */
  undoJournal(mark = 0): boolean {
    const journal = this._journal;
    if (journal === undefined || journal.length <= mark) return false;
    let typeChanged = false;
    for (let i = journal.length - 1; i >= mark; i--) {
      journal[i].undo();
      if (journal[i].type) typeChanged = true;
    }
    journal.length = mark;
    this._counter += 1;
    return typeChanged;
  }

  /** While a journal is open, record the value of `name` in `entries` before
   * a write. `type` is true for a write on a type entry. */
  private _journalWrite<T>(
    entries: Map<string, T>,
    name: string,
    type: boolean
  ): void {
    if (this._journal === undefined) return;
    const had = entries.has(name);
    const previous = entries.get(name);
    this._journal.push({
      undo: () => {
        if (had) entries.set(name, previous as T);
        else entries.delete(name);
      },
      type,
    });
  }

  /**
   * True when the unit reads `name`, a name of a library operator, as a
   * variable in the scope `scope` (`N` in `N + 1`). The resolution of a free
   * name of this unit then skips the library operator
   * (`freeNameBindingInContext()`). Without the engine flag `_bindingUnits`,
   * the boxing declares a variable that shadows the library operator
   * instead (`devolveUnappliedOperator()`, `validate.ts`).
   */
  readsAsVariable(scope: object, name: string): boolean {
    return this._variableReadings?.get(scope)?.has(name) === true;
  }

  /** Record that the unit reads `name` as a variable in the scope `scope`
   * (`readsAsVariable()`). */
  setReadsAsVariable(scope: object, name: string): void {
    this._variableReadings ??= new Map();
    let names = this._variableReadings.get(scope);
    if (names === undefined)
      this._variableReadings.set(scope, (names = new Set()));
    if (names.has(name)) return;
    names.add(name);
    this._counter += 1;
    if (this._journal !== undefined) {
      const added = names;
      this._journal.push({ undo: () => added.delete(name), type: true });
    }
  }

  scalarUsesMap(scope: object, name: string): boolean | undefined {
    return this._scalarUsesMap?.get(scope)?.get(name);
  }

  /** Remove the record of the uses of `name` in the scope `scope`, or set
   * it to `value`. */
  setScalarUsesMap(
    scope: object,
    name: string,
    value: boolean | undefined
  ): void {
    if (value === undefined) {
      const current = this._scalarUsesMap?.get(scope);
      if (current === undefined) return;
      this._journalWrite(current, name, false);
      current.delete(name);
      return;
    }
    this._scalarUsesMap ??= new Map();
    let entries = this._scalarUsesMap.get(scope);
    if (entries === undefined)
      this._scalarUsesMap.set(scope, (entries = new Map()));
    this._journalWrite(entries, name, false);
    entries.set(name, value);
  }
}

/**
 * The environment of the first boxed operand of `ops` that has one: the
 * environment of the first symbol occurrence, in the order of the operands
 * and depth first, that has an environment. `undefined` when no operand is a
 * boxed expression with such an occurrence.
 *
 * A `ce.function()` call with a boxed operand is not a new unit: the symbols
 * that it makes take the environment of its first boxed operand. A raw
 * operand (MathJSON) has no `_kind` and is skipped.
 *
 * The walk descends through the operands of a function expression and the
 * values of a dictionary. Each node is visited once: an expression can share
 * a subexpression in several places (`Max(e, e)`), and a walk with no record
 * of the visited nodes takes a time exponential in the depth of such an
 * expression.
 */
export function unitEnvironmentOfOperands(
  ops: readonly unknown[]
): UnitEnvironment | undefined {
  type Node = {
    _kind?: string;
    _env?: UnitEnvironment;
    ops?: readonly unknown[];
    values?: readonly unknown[];
  };
  const stack: unknown[] = [...ops].reverse();
  const visited = new Set<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (visited.has(node)) continue;
    visited.add(node);
    const n = node as Node;
    if (n._kind === undefined) continue;
    if (n._kind === 'symbol') {
      if (n._env !== undefined) return n._env;
      continue;
    }
    const children = n._kind === 'dictionary' ? n.values : n.ops;
    if (children !== undefined)
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return undefined;
}

/**
 * The sum of the counters (`UnitEnvironment.counter`) of the distinct unit
 * environments of the symbols in `ops`, at any depth. The walk is the walk of
 * `unitEnvironmentOfOperands()`, but it does not stop at the first
 * environment. A counter never decreases, so the sum changes when, and only
 * when, a write changes an entry of one of these environments. A cache that
 * depends on the types that the units of the operands require keeps this sum
 * and computes its value again when the sum moved.
 */
export function unitCounterOfOperands(ops: readonly unknown[]): number {
  type Node = {
    _kind?: string;
    _env?: UnitEnvironment;
    ops?: readonly unknown[];
    values?: readonly unknown[];
  };
  const stack: unknown[] = [...ops];
  const visited = new Set<object>();
  const envs = new Set<UnitEnvironment>();
  let sum = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (visited.has(node)) continue;
    visited.add(node);
    const n = node as Node;
    if (n._kind === undefined) continue;
    if (n._kind === 'symbol') {
      if (n._env !== undefined && !envs.has(n._env)) {
        envs.add(n._env);
        sum += n._env.counter;
      }
      continue;
    }
    const children = n._kind === 'dictionary' ? n.values : n.ops;
    if (children !== undefined) for (const child of children) stack.push(child);
  }
  return sum;
}
