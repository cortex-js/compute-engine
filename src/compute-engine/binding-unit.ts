import { BoxedType } from '../common/type/boxed-type.js';
import { narrow } from '../common/type/utils.js';
import {
  countObjectRead,
  noObjectDepsCollector,
  recordObjectRead,
} from './boxed-expression/object-deps.js';
import type { Scope } from './types-kernel-evaluation.js';

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
 * The counter moves at each write that changes an entry. A cache shared
 * between expressions keeps the counters (`unitEnvironmentStamp()`). A cache
 * of one expression keeps, for each read, the entry that the read found
 * (`readUnitEntry()`), and computes its value again when the same read finds
 * another entry.
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
   * entry or the record of the uses as it was before that write, true when
   * the write was on a type entry (not on the record of the uses), and the
   * map and the name that it wrote (`journaledEntry()`). */
  private _journal:
    | {
        undo: () => void;
        type: boolean;
        entries?: Map<string, unknown>;
        name?: string;
      }[]
    | undefined = undefined;

  /**
   * For the environment of an operation (rule 8 of
   * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`): the expression
   * that the operation runs on, until its parents are computed. The parents
   * are the environments of the symbol occurrences of this expression, and
   * they are computed at the first read (`parents()`): most operations read
   * no type of a free name, and the walk of a large input costs time.
   */
  private _input: unknown = undefined;

  /** The environments that a read continues in when this environment has
   * no entry for a name (`lookup()`), or `undefined` when they are not
   * computed yet. Empty for the environment of a unit. */
  private _parents: UnitEnvironment[] | undefined = undefined;

  /** For an operation: for each name of a free name of the input, the home
   * scopes of its occurrences. A free name that the operation makes takes
   * one of them as its home scope (`homeScopeOf()`). */
  private _homes: Map<string, Set<object>> | undefined = undefined;

  /**
   * The environment of an operation, or of an Epsil program (`input`
   * undefined). The parents of the environment of an operation are the
   * environments of the occurrences of `input`, which can be several units.
   */
  static forOperation(input: unknown, startScope?: object): UnitEnvironment {
    const env = new UnitEnvironment();
    env._startScope = startScope;
    if (input === undefined) {
      env._parents = [];
      env._program = true;
    } else env._input = input;
    return env;
  }

  /** The environment of a trial nested in the trial whose environment is
   * `enclosing` (`EngineBoxingState.withTrial()`): its only parent is
   * `enclosing`. */
  static forNested(enclosing: UnitEnvironment): UnitEnvironment {
    const env = new UnitEnvironment();
    env._parents = [enclosing];
    env._startScope = enclosing._startScope;
    return env;
  }

  private _program = false;

  /** True for the environment of an Epsil program (rule 10): an operation
   * that starts in it opens an environment of its own, except the
   * evaluation of a statement by the run driver. */
  get isProgram(): boolean {
    return this._program;
  }

  get counter(): number {
    return this._counter;
  }

  /** The type that the unit requires of `name` in the scope `scope`, or
   * `undefined` when no use wrote a requirement. Only the entries of this
   * environment: see `lookup()` for a read that continues in the parents. */
  get(scope: object, name: string): BoxedType | undefined {
    return this._types?.get(scope)?.get(name);
  }

  /** The parents of this environment (see `_parents`), computed at the
   * first call for an operation. */
  parents(): readonly UnitEnvironment[] {
    if (this._parents === undefined) this._computeParents();
    return this._parents!;
  }

  /**
   * The type that a read of `name` under the key `key` finds (rule 8):
   * - the entry of this environment, when there is one;
   * - otherwise, from each parent, the entry for `name` under `key`, or,
   *   when `key` is a scope, under the nearest ancestor of `key` that the
   *   parent holds an entry for. These entries are met. When the meet is
   *   `never`, the result is `unknown`: the units of the input disagree.
   *
   * `undefined` when no environment of the chain has an entry. The same
   * entries give the same result object (`meetEntries()`). The read is not
   * recorded for the caches: see `readUnitEntry()`.
   */
  lookup(key: object, name: string): BoxedType | undefined {
    const own = this.get(key, name);
    if (own !== undefined) return own;
    return this._lookupInParents(key, name);
  }

  /** The meet of the entries that the parents give for `name` under `key`
   * or its nearest ancestor (`_lookupNearest()`), as `lookup()` states. */
  private _lookupInParents(key: object, name: string): BoxedType | undefined {
    const parents = this.parents();
    if (parents.length === 0) return undefined;
    let result: BoxedType | undefined = undefined;
    for (const parent of parents) {
      const entry = parent._lookupNearest(key, name);
      if (entry === undefined) continue;
      if (result === undefined) result = entry;
      else if (result !== entry) {
        result = meetEntries(result, entry);
        if (result === BoxedType.unknown) return result;
      }
    }
    return result;
  }

  /** The entry of this environment for `name` under `key`, or, when `key`
   * is a scope (it has a `parent`), under its nearest ancestor that has an
   * entry; when this environment has none, the entries of its parents, the
   * same way (`_lookupInParents()`). So an entry of an environment is read
   * before the entries of its parents, also at a farther ancestor. */
  private _lookupNearest(key: object, name: string): BoxedType | undefined {
    for (
      let k: object | null | undefined = key;
      k;
      k = (k as { parent?: object | null }).parent
    ) {
      const entry = this.get(k, name);
      if (entry !== undefined) return entry;
    }
    return this._lookupInParents(key, name);
  }

  /**
   * The home scope of a free name `name` that this operation makes in the
   * scope `scope` (rule 8):
   * - the first scope from `scope` up the chain that is the home scope of a
   *   free name `name` of the input of the operation, or of the input of a
   *   parent operation;
   * - else, the first scope from `scope` up the chain that existed when the
   *   operation started (`_startScope` and its ancestors): a scope that the
   *   operation pushed (the scope of the variable of a nested `D`) is made
   *   again by each operation, as a scope that a boxing makes is, and is
   *   not a home scope;
   * - else `scope`.
   *
   * So the `x` that the evaluation of `D(D(f(x, y), x), y)` makes inside the
   * scope of the outer `D` has the same home scope as the `x` that
   * `D(D(f(x, y), y), x)` makes, and the two results are the same
   * (`sameBinding()`, `compare.ts`).
   */
  homeScopeOf<S extends object>(name: string, scope: S): S {
    let existing: object | undefined = undefined;
    for (
      let s: object | null | undefined = scope;
      s;
      s = (s as { parent?: object | null }).parent
    ) {
      if (this._holdsHome(name, s)) return s as S;
      if (existing === undefined && this._existedAtStart(s)) existing = s;
    }
    return (existing ?? scope) as S;
  }

  /** The lexical scope when the operation started, or `undefined` (an
   * environment that is not that of an operation). */
  private _startScope: object | undefined = undefined;

  /** True when `scope` is the scope where the operation started, or one of
   * its ancestors. */
  private _existedAtStart(scope: object): boolean {
    for (
      let s: object | null | undefined = this._startScope;
      s;
      s = (s as { parent?: object | null }).parent
    )
      if (s === scope) return true;
    return false;
  }

  private _holdsHome(name: string, scope: object): boolean {
    const parents = this.parents();
    if (this._homes?.get(name)?.has(scope) === true) return true;
    return parents.some((parent) => parent._holdsHome(name, scope));
  }

  /** Walk the input (`_input`) once: its distinct environments are the
   * parents, and the home scopes of its free names are kept in `_homes`. */
  private _computeParents(): void {
    const parents: UnitEnvironment[] = [];
    const input = this._input;
    this._input = undefined;
    this._parents = parents;
    if (input === undefined) return;
    type Node = {
      _kind?: string;
      _env?: UnitEnvironment;
      _homeScope?: object;
      _def?: unknown;
      _id?: string;
      ops?: readonly unknown[];
      values?: readonly unknown[];
    };
    // `isEqual()` gives its two operands as an array.
    const stack: unknown[] = Array.isArray(input) ? [...input] : [input];
    const visited = new Set<object>();
    while (stack.length > 0) {
      const node = stack.pop();
      if (typeof node !== 'object' || node === null) continue;
      if (visited.has(node)) continue;
      visited.add(node);
      const n = node as Node;
      if (n._kind === undefined) continue;
      if (n._kind === 'symbol') {
        const env = n._env;
        if (env !== undefined && env !== this && !parents.includes(env))
          parents.push(env);
        if (
          n._homeScope !== undefined &&
          n._def === undefined &&
          n._id !== undefined
        ) {
          this._homes ??= new Map();
          let homes = this._homes.get(n._id);
          if (homes === undefined) this._homes.set(n._id, (homes = new Set()));
          homes.add(n._homeScope);
        }
        continue;
      }
      const children = n._kind === 'dictionary' ? n.values : n.ops;
      if (children !== undefined) for (const child of children) stack.push(child);
    }
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
      entries,
      name,
    });
  }

  /** True when the open journal holds a write on the type entry for `name`
   * under `key`: the root construction in progress wrote that entry
   * (`EngineBoxingState.noteUnitWrite()`). The fresh-matrix repair
   * (`validate.ts`) retypes only such an entry. */
  journaledEntry(key: object, name: string): boolean {
    const entries = this._types?.get(key);
    if (this._journal === undefined || entries === undefined) return false;
    return this._journal.some(
      (w) => w.type && w.entries === entries && w.name === name
    );
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
    if (!variableReadingNames.has(name)) return false;
    if (this._variableReadings?.get(scope)?.has(name) === true) return true;
    return this.parents().some((parent) => parent.readsAsVariable(scope, name));
  }

  /** Each type entry of this environment, as (key, name, type): the key is
   * a home scope or a value definition (see the class comment). Only the
   * entries of this environment, not those of its parents. */
  *entries(): IterableIterator<[object, string, BoxedType]> {
    if (this._types === undefined) return;
    for (const [key, names] of this._types)
      for (const [name, type] of names) yield [key, name, type];
  }

  /** Each (scope, name) that this environment reads as a variable
   * (`readsAsVariable()`). Only the records of this environment, not those
   * of its parents. */
  *variableReadings(): IterableIterator<[object, string]> {
    if (this._variableReadings === undefined) return;
    for (const [scope, names] of this._variableReadings)
      for (const name of names) yield [scope, name];
  }

  /** The end of a trial (`EngineBoxingState.withTrial()`): the environment
   * is thrown away. When a write was made in it, the counter moves, so a
   * cache keyed on the counters (`unitEnvironmentStamp()`) is computed
   * again. */
  discard(): void {
    if (this._counter !== 0) this._counter += 1;
  }

  /** Record that the unit reads `name` as a variable in the scope `scope`
   * (`readsAsVariable()`). */
  setReadsAsVariable(scope: object, name: string): void {
    variableReadingNames.add(name);
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

  /** The record of the uses of `name` in the scope `scope` (see
   * `_scalarUsesMap`): the record of this environment, or else the records
   * of the parents that have one, combined: false when one of them is
   * false. */
  scalarUsesMap(scope: object, name: string): boolean | undefined {
    const own = this._scalarUsesMap?.get(scope)?.get(name);
    if (own !== undefined) return own;
    let result: boolean | undefined = undefined;
    for (const parent of this.parents()) {
      const value = parent.scalarUsesMap(scope, name);
      if (value === false) return false;
      if (value === true) result = true;
    }
    return result;
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

/** Each name that an environment reads as a variable, or did
 * (`UnitEnvironment.setReadsAsVariable()`): the names of library operators
 * used as values, a small set. A read of another name is answered without
 * a walk of the parents (`UnitEnvironment.readsAsVariable()`). */
const variableReadingNames = new Set<string>();

/** For each entry and each entry it was met with
 * (`UnitEnvironment._lookupInParents()`), the result of the meet. */
const meets = new WeakMap<BoxedType, WeakMap<BoxedType, BoxedType>>();

/** The meet of the entries `a` and `b`, or `BoxedType.unknown` when it is
 * `never`. The same two entries give the same object, so the version of a
 * read that finds it (`readUnitEntry()`) does not move. */
function meetEntries(a: BoxedType, b: BoxedType): BoxedType {
  let byB = meets.get(a);
  if (byB === undefined) meets.set(a, (byB = new WeakMap()));
  let result = byB.get(b);
  if (result === undefined) {
    const meet = narrow(a.type, b.type);
    result =
      meet === 'never'
        ? BoxedType.unknown
        : new BoxedType(meet, a.typeResolver);
    byB.set(b, result);
  }
  return result;
}

/** What a read of an entry needs of the engine: the environments of the
 * trial and of the operation in progress (`EngineBoxingState`). */
export type UnitReadContext = {
  trialEnvironment(): UnitEnvironment | undefined;
  currentOperation(): UnitEnvironment | undefined;
};

/** The entry that an occurrence whose environment is `env` reads for `name`
 * under `key`: the entry of the trial in progress, else of the operation in
 * progress, else of `env`, each through its parents (rules 8 and 13 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). */
function unitEntryOf(
  context: UnitReadContext,
  env: UnitEnvironment | undefined,
  key: object,
  name: string
): BoxedType | undefined {
  return (
    context.trialEnvironment()?.lookup(key, name) ??
    context.currentOperation()?.lookup(key, name) ??
    env?.lookup(key, name)
  );
}

/** True when the operation in progress, or `env`, reads `name` as a
 * variable in the scope `scope` (`UnitEnvironment.readsAsVariable()`). */
function readsAsVariableIn(
  context: UnitReadContext,
  env: UnitEnvironment | undefined,
  scope: object,
  name: string
): boolean {
  if (!variableReadingNames.has(name)) return false;
  return (
    context.currentOperation()?.readsAsVariable(scope, name) === true ||
    env?.readsAsVariable(scope, name) === true
  );
}

/**
 * A read of the environments by an occurrence: of the entry for a name
 * under a key (`readUnitEntry()`), or of the record that the name is read
 * as a variable (`readsUnitVariable()`). Its version (`_version`) is what
 * the read finds now, read again in the current context: the number of
 * the entry found (`definitionId()`), 0 for none; for the record, 1 or 0.
 *
 * A cache entry that keeps this version (`recordObjectRead()`) is valid
 * exactly when the same read finds the same entry now (`objectDepsValid()`,
 * `object-deps.ts`): a type computed outside an operation is read again in
 * an operation that has no entry for the name, and computed again in one
 * that has; a type computed in an operation is read again in the next
 * operation when that one finds the same entries.
 */
class UnitReadToken {
  constructor(
    private readonly _context: UnitReadContext,
    private readonly _env: UnitEnvironment | undefined,
    private readonly _key: object,
    private readonly _name: string,
    private readonly _variable: boolean
  ) {}

  /** The version is what the read finds now, not a counter: a record whose
   * dependencies are read after its computation reads it again then
   * (`stampObjectDepsAtEnd()`, `object-deps.ts`). */
  readonly _readAgainAtEnd = true;

  /** See `VersionedObject._ref` (`object-deps.ts`). */
  readonly _ref = new WeakRef(this);

  get _version(): number {
    if (this._variable)
      return readsAsVariableIn(this._context, this._env, this._key, this._name)
        ? 1
        : 0;
    return definitionId(
      unitEntryOf(this._context, this._env, this._key, this._name)
    );
  }
}

/** For each occurrence environment (or, for an occurrence with none, the
 * read context), each key and each name, its two tokens: the read of the
 * entry and the read of the variable record. */
const unitReadTokens = new WeakMap<
  object,
  WeakMap<object, Map<string, [UnitReadToken?, UnitReadToken?]>>
>();

/** The token of a read (see `UnitReadToken`), made at the first read. */
function unitReadToken(
  context: UnitReadContext,
  env: UnitEnvironment | undefined,
  key: object,
  name: string,
  variable: boolean
): UnitReadToken {
  const owner: object = env ?? context;
  let byKey = unitReadTokens.get(owner);
  if (byKey === undefined) unitReadTokens.set(owner, (byKey = new WeakMap()));
  let byName = byKey.get(key);
  if (byName === undefined) byKey.set(key, (byName = new Map()));
  let pair = byName.get(name);
  if (pair === undefined) byName.set(name, (pair = [undefined, undefined]));
  const index = variable ? 1 : 0;
  return (pair[index] ??= new UnitReadToken(context, env, key, name, variable));
}

/**
 * The entry that an occurrence whose environment is `env` reads for `name`
 * under `key` (a home scope or a value definition), see `unitEntryOf()`.
 * The read is recorded for the caches that are being computed, with the
 * entry found as its version (`UnitReadToken`).
 */
export function readUnitEntry(
  context: UnitReadContext,
  env: UnitEnvironment | undefined,
  key: object,
  name: string
): BoxedType | undefined {
  const entry = unitEntryOf(context, env, key, name);
  if (noObjectDepsCollector()) {
    countObjectRead();
    return entry;
  }
  recordObjectRead(
    unitReadToken(context, env, key, name, false),
    definitionId(entry)
  );
  return entry;
}

/** True when the operation in progress, or `env`, reads `name` as a
 * variable in the scope `scope` (`N` in `N + 1`). The read is recorded for
 * the caches, as `readUnitEntry()` records a read. */
export function readsUnitVariable(
  context: UnitReadContext,
  env: UnitEnvironment | undefined,
  scope: object,
  name: string
): boolean {
  const result = readsAsVariableIn(context, env, scope, name);
  if (noObjectDepsCollector()) {
    countObjectRead();
    return result;
  }
  recordObjectRead(
    unitReadToken(context, env, scope, name, true),
    result ? 1 : 0
  );
  return result;
}

/** True when `obj` is the token of a read by an occurrence
 * (`readUnitEntry()`, `readsUnitVariable()`). */
export function isUnitReadToken(obj: unknown): boolean {
  return obj instanceof UnitReadToken;
}

/**
 * The input of an operation on `receiver` whose argument `argument` can
 * hold boxed expressions (`subs()`, `replace()`, `match()`, rule 8 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`): `receiver`, and
 * the boxed expressions of `argument`. These are found in its arrays and
 * its plain objects (a substitution, a rule, a rule set), to a depth of
 * three: the boxed `match` of a rule of a rule set is at that depth.
 */
export function operationInput(receiver: object, argument: unknown): unknown[] {
  const input: unknown[] = [receiver];
  const visit = (value: unknown, depth: number): void => {
    if (typeof value !== 'object' || value === null) return;
    if ((value as { _kind?: string })._kind !== undefined) {
      input.push(value);
      return;
    }
    if (depth === 0) return;
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) visit(child, depth - 1);
  };
  visit(argument, 3);
  return input;
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
  // The walk keeps the path from the operand to the current node: each
  // compound node on it, with the number of symbols seen when it was entered
  // (`seen`), and the index of its next child.
  type Frame = {
    node: object;
    children: readonly unknown[];
    next: number;
    seen: number;
  };
  const path: Frame[] = [];
  const visited = new Set<object>();
  let symbolsSeen = 0;
  // Give `env` as the first environment of each node of the path in which no
  // symbol came before the one that has `env` (`firstEnvironments`).
  const found = (env: UnitEnvironment): UnitEnvironment => {
    for (const frame of path)
      if (frame.seen === symbolsSeen) firstEnvironments.set(frame.node, env);
    return env;
  };
  for (const op of ops) {
    let node: unknown = op;
    for (;;) {
      if (
        typeof node === 'object' &&
        node !== null &&
        (node as Node)._kind !== undefined
      ) {
        if (symbolFreeNodes.has(node)) {
          // Nothing to count.
        } else if (visited.has(node)) {
          // A node shared with a part already walked holds a symbol with no
          // environment (it would have ended the walk otherwise).
          symbolsSeen += 1;
        } else {
          visited.add(node);
          const n = node as Node;
          const first = firstEnvironments.get(node);
          if (first !== undefined) return found(first);
          if (n._kind === 'symbol') {
            if (n._env !== undefined) return found(n._env);
            symbolsSeen += 1;
          } else {
            const children = n._kind === 'dictionary' ? n.values : n.ops;
            if (children !== undefined && children.length > 0)
              path.push({ node, children, next: 0, seen: symbolsSeen });
            else symbolFreeNodes.add(node);
          }
        }
      }
      // The next child of the innermost node of the path that has one; a
      // node whose children are all walked leaves the path.
      let frame = path[path.length - 1];
      while (frame !== undefined && frame.next >= frame.children.length) {
        // No symbol in any node under it: a later walk skips it. A tower of
        // shared dictionaries with no symbol was walked to its bottom at
        // each `ce.function()` that built a level of it.
        if (frame.seen === symbolsSeen) symbolFreeNodes.add(frame.node);
        path.pop();
        frame = path[path.length - 1];
      }
      if (frame === undefined) break;
      node = frame.children[frame.next++];
    }
  }
  return undefined;
}

/** The boxed expressions that hold no symbol, at any depth, found by a walk
 * of `unitEnvironmentOfOperands()`. The operands of a boxed expression do
 * not change, so the record stays true. */
const symbolFreeNodes = new WeakSet<object>();

/**
 * For a boxed expression whose first symbol occurrence, in the order of
 * `unitEnvironmentOfOperands()`, has an environment: that environment. The
 * record stays true: the operands of a boxed expression do not change, so
 * the first symbol occurrence stays the same, and the environment of a
 * symbol, once set, does not change (`BoxedSymbol._env` is set at
 * construction or by `??=`). An expression whose first symbol has no
 * environment is not recorded: that symbol can gain one later. A tower
 * `Sin(Sin(…(x)))` built one level at a time was walked to `x` at each
 * level.
 */
const firstEnvironments = new WeakMap<object, UnitEnvironment>();

/** For a value definition that is the key of an entry of a unit
 * environment: the scope that held it when the first entry was written
 * (`BoxedSymbol._unitWriteScope()`). */
const definitionHomes = new WeakMap<object, object>();

/** Record that `scope` holds the value definition `def`, the key of an entry
 * of a unit environment. */
export function noteDefinitionHome(def: object, scope: object): void {
  definitionHomes.set(def, scope);
}

/** The scope recorded for the value definition `def` by
 * `noteDefinitionHome()`, or `undefined`. */
export function definitionHome<S extends object = object>(
  def: object
): S | undefined {
  return definitionHomes.get(def) as S | undefined;
}

/**
 * The environments that the occurrences of `exprs` read, with their parents
 * at any depth (rule 11 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`): the environment
 * of each symbol occurrence, and the environment of each call whose head is
 * a free name (`BoxedFunction._freeHeadEnv`), which holds the `function`
 * reading of the head. The walk is that of `unitEnvironmentOfOperands()`.
 */
export function unitEnvironmentsOf(
  exprs: readonly unknown[]
): UnitEnvironment[] {
  type Node = {
    _kind?: string;
    _env?: UnitEnvironment;
    _freeHeadEnv?: UnitEnvironment;
    ops?: readonly unknown[];
    values?: readonly unknown[];
  };
  const found: UnitEnvironment[] = [];
  const stack: unknown[] = [...exprs];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (visited.has(node)) continue;
    visited.add(node);
    const n = node as Node;
    if (n._kind === undefined) continue;
    if (n._kind === 'symbol') {
      if (n._env !== undefined) found.push(n._env);
      continue;
    }
    if (n._freeHeadEnv !== undefined) found.push(n._freeHeadEnv);
    const children = n._kind === 'dictionary' ? n.values : n.ops;
    if (children !== undefined) for (const child of children) stack.push(child);
  }
  const result: UnitEnvironment[] = [];
  const seen = new Set<UnitEnvironment>();
  while (found.length > 0) {
    const env = found.pop()!;
    if (seen.has(env)) continue;
    seen.add(env);
    result.push(env);
    found.push(...env.parents());
  }
  return result;
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

/** A number for each definition that a free name resolves to, given at
 * its first read (`noteResolutionRead()`), and for each entry that a read
 * of an environment found (`readUnitEntry()`). */
const definitionIds = new WeakMap<object, number>();
let lastDefinitionId = 0;

/**
 * For one engine and one free name: an object whose version (`_version`) is
 * the number of the definition that the name resolves to now, or 0 when it
 * resolves to none. A cache entry that keeps this version
 * (`recordObjectRead()`) is computed again when the name resolves to
 * another definition (`objectDepsValid()`, `object-deps.ts`): after a
 * declaration of the name in a pushed scope, and after the pop of that
 * scope.
 */
class ResolutionToken {
  constructor(private readonly _resolve: () => object | undefined) {}

  /** See `VersionedObject._ref` (`object-deps.ts`). */
  readonly _ref = new WeakRef(this);

  get _version(): number {
    return definitionId(this._resolve());
  }
}

/** The number of the definition or the entry `def` (`definitionIds`), or 0
 * for none. */
function definitionId(def: object | undefined): number {
  if (def === undefined) return 0;
  let id = definitionIds.get(def);
  if (id === undefined) {
    lastDefinitionId += 1;
    id = lastDefinitionId;
    definitionIds.set(def, id);
  }
  return id;
}

/** For each engine, then each key and each name, its token. */
const resolutionTokens = new WeakMap<
  object,
  Map<string, Map<string, ResolutionToken>>
>();

/**
 * Record, for the caches that are being computed, that a read depends on the
 * definition that the free name `name` resolves to in the current context
 * (rules 3 and 4 of `docs/plans/2026-11-09-binding-units-slice-1-spec.md`):
 * a type cached on a compound expression is computed again when that
 * definition is another one. `resolve` gives that definition; it is kept
 * for the engine, the name and `key` (which tells apart the readings of a
 * name, `N` as a variable or as the library operator), so it must depend on
 * nothing else. The result is the definition that `resolve` gives now.
 *
 * The dependency is on the resolved definition, not on the current lexical
 * scope: a call of a function literal pushes a scope at each call, and a
 * type that depends on the scope would be computed again in each call.
 */
export function noteResolutionRead<D extends object>(
  engine: object,
  name: string,
  key: string,
  resolve: () => D | undefined
): D | undefined {
  if (noObjectDepsCollector()) {
    countObjectRead();
    return resolve();
  }
  let byKey = resolutionTokens.get(engine);
  if (byKey === undefined) resolutionTokens.set(engine, (byKey = new Map()));
  let tokens = byKey.get(key);
  if (tokens === undefined) byKey.set(key, (tokens = new Map()));
  let token = tokens.get(name);
  if (token === undefined)
    tokens.set(name, (token = new ResolutionToken(resolve)));
  const def = resolve();
  recordObjectRead(token, definitionId(def));
  return def;
}

/**
 * The environments that the type of a free name of `exprs` can read, each
 * with its counter: a key for a cache shared between expressions whose
 * value depends on such a type (rule 9 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`). They are the
 * environments of the symbol occurrences of `exprs` and the environment of
 * the operation in progress (`current`), with their parents at any depth.
 * The environment of an operation that has no entry of its own is left out,
 * and only its parents are kept: two operations on one input then give the
 * same key. `undefined` when there is no environment.
 */
export function unitEnvironmentStamp(
  current: UnitEnvironment | undefined,
  exprs: readonly unknown[]
): Map<UnitEnvironment, number> | undefined {
  const envs: UnitEnvironment[] = [];
  if (current !== undefined) envs.push(current);
  type Node = {
    _kind?: string;
    _env?: UnitEnvironment;
    ops?: readonly unknown[];
    values?: readonly unknown[];
  };
  const stack: unknown[] = [...exprs];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (visited.has(node)) continue;
    visited.add(node);
    const n = node as Node;
    if (n._kind === undefined) continue;
    if (n._kind === 'symbol') {
      if (n._env !== undefined) envs.push(n._env);
      continue;
    }
    const children = n._kind === 'dictionary' ? n.values : n.ops;
    if (children !== undefined) for (const child of children) stack.push(child);
  }
  if (envs.length === 0) return undefined;
  const stamp = new Map<UnitEnvironment, number>();
  const seen = new Set<UnitEnvironment>();
  while (envs.length > 0) {
    const env = envs.pop()!;
    if (seen.has(env)) continue;
    seen.add(env);
    const parents = env.parents();
    if (env.counter !== 0 || parents.length === 0)
      stamp.set(env, env.counter);
    envs.push(...parents);
  }
  return stamp;
}

/** True when the two stamps of `unitEnvironmentStamp()` name the same
 * environments, each with the same counter. */
export function sameUnitEnvironmentStamp(
  a: ReadonlyMap<UnitEnvironment, number> | undefined,
  b: ReadonlyMap<UnitEnvironment, number> | undefined
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.size !== b.size) return false;
  for (const [env, counter] of a) if (b.get(env) !== counter) return false;
  return true;
}

/**
 * The home scope of a free name (rule 1 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`) that is boxed while
 * `autoScope` is the scope that a declaration of the name would go in. It
 * is `autoScope`, or, when that is the scope of a binder (a scope with
 * `binderNames`: `Sum`, `Product`, a loop), the first scope above it that
 * is neither a binder's scope nor marked `noAutoDeclare`. A binder marks its
 * scope `noAutoDeclare` only while it is canonicalized, so a name boxed
 * later in that scope (the body of a `Sum` shifted by `subs()` when it is
 * evaluated) would otherwise get the binder's scope as its home scope, and
 * would not be the same binding as the occurrence of the same name in the
 * body (`sameBinding()`, `compare.ts`).
 */
export function freeNameHomeScope<S extends Scope>(autoScope: S): S {
  let scope = autoScope;
  while (
    (scope.binderNames !== undefined || scope.noAutoDeclare === true) &&
    scope.parent
  )
    scope = scope.parent as S;
  return scope;
}

/**
 * The names that an engine made a free name or a free call head for
 * (`noteFreeNameMade()`).
 */
const FREE_NAMES_MADE = new WeakMap<object, Set<string>>();

/**
 * Record that `engine` made a free name, or a call with a free head, of the
 * name `name`.
 */
export function noteFreeNameMade(engine: object, name: string): void {
  let names = FREE_NAMES_MADE.get(engine);
  if (names === undefined) FREE_NAMES_MADE.set(engine, (names = new Set()));
  names.add(name);
}

/**
 * True when `engine` made a free name, or a call with a free head, of the
 * name `name`. A declaration that gives such a name a value changes what an
 * expression boxed before it evaluates to, as a value write does
 * (`installsValue`, `engine-configuration-lifecycle.ts`).
 */
export function freeNameWasMade(engine: object, name: string): boolean {
  return FREE_NAMES_MADE.get(engine)?.has(name) === true;
}
