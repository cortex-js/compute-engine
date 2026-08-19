import type { Type, TypeString } from '../common/type/types.js';
import { BoxedType } from '../common/type/boxed-type.js';

import type {
  BoxedDefinition,
  IComputeEngine,
  InspectableScope,
  Scope,
  ScopeDeclaration,
  ScopeNarrowing,
} from './global-types.js';

import { isOperatorDef, isValueDef } from './boxed-expression/utils.js';
import { activeRollbackFrame } from './inference-rollback.js';
import { journalCheckpointMapEntry } from './checkpoint-journal.js';

/**
 * Is `value` a `BoxedDefinition` (as opposed to a structural `Type` object)?
 *
 * A `Type` object is always tagged with a `kind` discriminant, and one of them
 * — `ValueType` (`{ kind: 'value', value: … }`) — carries a `value` key, so
 * `isValueDef` alone would misread it as a definition.
 */
function isBoxedDefinition(value: unknown): value is BoxedDefinition {
  if (typeof value !== 'object' || value === null) return false;
  if ('kind' in value) return false;
  return 'value' in value || 'operator' in value;
}

/** The type a definition carries: a value definition's type, an operator
 * definition's signature. Returned boxed, so `type.toString()` is the
 * canonical (fingerprintable) spelling and `.matches()` works directly. */
function definitionType(def: BoxedDefinition): BoxedType {
  if (isValueDef(def)) return def.value.type;
  if (isOperatorDef(def)) return def.operator.signature;
  return BoxedType.unknown;
}

/** Was this definition's type inferred from usage rather than stated? */
function definitionIsInferred(def: BoxedDefinition): boolean {
  if (isValueDef(def)) return def.value.inferredType === true;
  if (isOperatorDef(def)) return def.operator.inferredSignature === true;
  return false;
}

/**
 * A lexical scope the caller owns and can read back — see
 * `docs/SCOPING-MODEL.md` B2/B3.
 *
 * Structurally a `Scope` (`parent`/`bindings`), so it is accepted
 * anywhere a scope is; the read surface (`declarations`, `narrowings`) exists
 * because `bindings` holds internal definition records whose shape is not API.
 */
class _InspectableScope implements InspectableScope {
  readonly parent: Scope | null;
  readonly bindings: Map<string, BoxedDefinition>;

  /** Outer-definition narrowings observed by contained calls, keyed by name.
   * `from` is the type at the FIRST narrowing seen for that name, `to` the
   * type at the most recent one, so a name narrowed repeatedly across several
   * contained calls reports one net transition. */
  private _narrowings = new Map<string, ScopeNarrowing>();

  /** Names whose definition was RE-INSTALLED from another scope's harvest
   * (`createScope({name: def})`) rather than declared here. The scope holds
   * them, it does not own them, so `dispose()` leaves them alone.
   *
   * @internal
   */
  _borrowed: Set<string> | undefined;

  private _disposed = false;

  /** The engine this scope narrows against — consulted by
   * `_recordNarrowing` for the open rollback frame, so a rejected trial's
   * narrowing entry is retracted (journal family 8). */
  private _engine: IComputeEngine;

  constructor(ce: IComputeEngine, parent: Scope | null) {
    this._engine = ce;
    this.parent = parent;
    this.bindings = new Map();
  }

  declarations(): ReadonlyArray<ScopeDeclaration> {
    const names = [...this.bindings.keys()].sort();
    return Object.freeze(
      names.map((name) => {
        const def = this.bindings.get(name)!;
        return Object.freeze({
          name,
          type: definitionType(def),
          inferred: definitionIsInferred(def),
          def,
        });
      })
    );
  }

  narrowings(): ReadonlyArray<ScopeNarrowing> {
    const entries = [...this._narrowings.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    return Object.freeze(entries.map((x) => Object.freeze({ ...x })));
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // Only the scope's OWN definitions are released. An outer definition it
    // merely narrowed is not in `bindings` at all; a definition re-installed
    // from another scope's harvest IS, but belongs to whoever created it —
    // `createScope()` records those names in `_borrowed` and they are skipped
    // here. A name declared through the normal path (a `Type`/`TypeString`
    // initializer entry, or an auto-declare during a contained parse) is owned
    // and is disposed.
    for (const [name, def] of this.bindings)
      if (isValueDef(def) && !this._borrowed?.has(name)) def.value.dispose();
  }

  /**
   * Record a narrowing of `def` (an OUTER definition) observed while a
   * contained call ran against this scope.
   *
   * Only reached while this scope is the engine's active narrowing sink, so
   * the cost is confined to contained calls.
   *
   * @internal
   */
  _recordNarrowing(
    name: string,
    def: BoxedDefinition,
    from: BoxedType,
    to: BoxedType
  ): void {
    // A no-op "narrowing" (the definition already had this type) is not a
    // change the caller needs to see.
    if (from === to) return;
    if (from.toString() === to.toString()) return;

    // The definition must live in an ENCLOSING scope. Two exclusions:
    // - this scope's own bindings: containment worked, nothing to report;
    // - a scope created *below* this one during the call (a binder's local
    //   scope, e.g. a `Sum` index): not an outer symbol at all, and reporting
    //   it would make every big-op body look like an escape.
    if (this.bindings.get(name) === def) return;
    let outer: Scope | null = this.parent;
    let found = false;
    while (outer) {
      if (outer.bindings.get(name) === def) {
        found = true;
        break;
      }
      outer = outer.parent;
    }
    if (!found) return;

    const existing = this._narrowings.get(name);

    // Rollback journal (family 8): a narrowing recorded during a rollback
    // frame is retracted when the frame aborts — a rejected trial must not
    // leave `narrowings()` reporting a narrowing that never took effect. A
    // pre-frame entry is mutated in place (`existing.to`), so the undo
    // restores its previous `to` on the same object; a frame-created entry
    // is deleted.
    const frame = activeRollbackFrame(this._engine);
    if (frame !== undefined) {
      if (existing !== undefined) {
        const previousTo = existing.to;
        frame.record({
          undo: () => {
            existing.to = previousTo;
          },
        });
      } else {
        frame.record({
          undo: () => {
            this._narrowings.delete(name);
          },
        });
      }
    }

    if (existing) existing.to = to;
    else this._narrowings.set(name, { name, from, to, def });
  }
}

/**
 * Create a caller-owned lexical scope, pre-populated with `bindings`, for use
 * as the `scope` option of `ce.parse()` / `ce.expr()`.
 *
 * Known boundary: the engine's interned common symbols (`Pi`, `e`, `i`,
 * `True`, …) resolve before the lexical scope chain is consulted, so a
 * binding for one of those names is recorded in `declarations()` but does
 * NOT shadow the interned symbol during boxing — same as `ce.declare`.
 *
 * See `docs/SCOPING-MODEL.md` B2.
 */
export function createScope(
  ce: IComputeEngine,
  bindings?: Record<string, Type | TypeString | BoxedDefinition>,
  parent?: Scope
): InspectableScope {
  const scope = new _InspectableScope(ce, parent ?? ce.context.lexicalScope);

  for (const [name, value] of Object.entries(bindings ?? {})) {
    if (isBoxedDefinition(value)) {
      // A harvested definition is RE-INSTALLED, not re-declared: going through
      // `declareSymbolValue` would mint a fresh holder and break the binding
      // identity (and the `_writeVersion` continuity) that lets pass N+1,
      // seeded from pass N's harvest, keep write-version-keyed consumer caches
      // warm. Installing one definition in two live scopes makes it shared
      // mutable state — a narrowing through either scope is visible in both.
      // That aliasing is the intended semantics for sequential pass-seeding.
      //
      // Definitions are engine-bound, so a definition harvested from ANOTHER
      // engine is out of contract. It is not enforced (a boxed definition
      // exposes no public engine back-reference to check against).
      // Checkpoint journal (funnel 4): a host re-install is a binding write
      // like any other, and this one can target a scope that outlives the
      // window.
      journalCheckpointMapEntry(ce, scope.bindings, name, name, 'declare');
      scope.bindings.set(name, value);
      // Held, not owned: `dispose()` must not release a definition another
      // scope is still using.
      (scope._borrowed ??= new Set()).add(name);
    } else {
      // A type or type string goes through the normal declare path.
      ce.declare(name, value as Type | TypeString, scope);
    }
  }

  return scope;
}

/** Is `scope` a `createScope()` product (and so a narrowing sink)? */
function isInspectableScope(
  scope: Scope | undefined
): scope is _InspectableScope {
  return scope instanceof _InspectableScope;
}

/**
 * Run `f` with `scope` as the current lexical scope — so lookups walk
 * `scope → parents` and every auto-declare/inference lands rooted there — and,
 * when `scope` can be read back, with it collecting outer-definition
 * narrowings for the duration.
 *
 * `inScope` pops its temporary eval context WITHOUT the disposal loop (only
 * `popScope`/`removeEvalContext` route through `discardEvalContext`), so a
 * caller-owned scope's definitions are never auto-disposed: holding a
 * harvested definition after the call is supported.
 */
export function inHarvestScope<T>(
  ce: IComputeEngine,
  scope: Scope | undefined,
  f: () => T
): T {
  if (!isInspectableScope(scope)) return ce._inScope(scope, f);

  const previous = ce._narrowingSink;
  ce._narrowingSink = scope;
  try {
    return ce._inScope(scope, f);
  } finally {
    ce._narrowingSink = previous;
  }
}
