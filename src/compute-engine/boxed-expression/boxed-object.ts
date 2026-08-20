import type { MathJsonExpression } from '../../math-json/types.js';

import type {
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  Expression,
  ExpressionInput,
  IComputeEngine as ComputeEngine,
  Metadata,
  ObjectInterface,
  PatternMatchOptions,
  SimplifyOptions,
  Substitution,
} from '../global-types.js';

import type { Type, TypeReference } from '../../common/type/types.js';

import { BoxedType } from '../../common/type/boxed-type.js';
import { isObjectType, objectLayoutOfType } from '../../common/type/subtype.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { noteObjectConstructed, recordObjectRead } from './object-deps.js';
import { objectJson } from './object-walk.js';
import {
  isExpression,
  isForeignEngineObject,
  isNumber,
  isObject,
  isString,
} from './type-guards.js';
import { hashCode } from './utils.js';
import { isWildcard, wildcardName } from './pattern-utils.js';
import { journalCheckpointMapEntry } from '../checkpoint-journal.js';

/**
 * The largest value a counter may reach before it stops being able to
 * advance. A `number` silently stops incrementing at
 * `Number.MAX_SAFE_INTEGER`, and a version counter that stops incrementing
 * stops invalidating — a cached field-derived value would be served stale
 * forever. Reaching the bound therefore FAILS LOUD rather than going quiet:
 * ~9×10¹⁵ stores on one object (or constructions in one engine) is
 * unreachable by orders of magnitude in any real session, so a program that
 * gets there has a runaway loop, not a workload.
 */
const COUNTER_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * The per-engine construction serial, from which identity hashes are drawn.
 *
 * Kept in a module-level `WeakMap` keyed on the engine rather than as a field
 * on the engine class: it is a detail of this one expression kind, and a
 * `WeakMap` entry adds nothing to the public engine surface (which would have
 * to be mirrored on `IComputeEngine` and on every structural engine mirror).
 * The entry holds a number, never an object, so it retains nothing.
 */
const _serialCounters = new WeakMap<object, number>();

function nextSerial(ce: ComputeEngine): number {
  const serial = _serialCounters.get(ce) ?? 0;
  if (serial >= COUNTER_LIMIT) {
    console.assert(false, 'Object serial counter exhausted');
    throw new Error(
      'Object serial counter exhausted: too many objects constructed in this engine'
    );
  }
  _serialCounters.set(ce, serial + 1);
  return serial;
}

/**
 * Set the engine's next construction serial. **Test-only**: the counter
 * overflow guard is otherwise unreachable (it takes ~9×10¹⁵ constructions),
 * and a guard no test can reach is a guard nobody knows works.
 * @internal
 */
export function _setNextObjectSerial(ce: ComputeEngine, serial: number): void {
  _serialCounters.set(ce, serial);
}

/**
 * BoxedObject — the engine's one **mutable** value kind.
 *
 * The class instance IS the heap record: it carries the slot table, the
 * version counter, the construction serial and the pinned nominal type, and
 * host reference identity of the instance IS object identity. There is no
 * wrapper/record split, so every equality, hash, cache-dependency and
 * weak-reference site can use `===` with no unwrap step.
 *
 * Two invariants shape every member below (the full list is in
 * `docs/TYPE-SYSTEM.md`, "Invariants"):
 *
 * 1. **One instance per object, forever.** No path may clone, rebuild or
 *    re-box one, so `canonical`, `structural`, `evaluate`, `N`, `simplify`,
 *    `subs`, `map` and `_unshared` all return `this`. An object is always
 *    canonical and always already evaluated.
 * 2. **Identity is never content.** `hash` derives from the construction
 *    serial, and the comparison tiers answer `a === b` (see `compare.ts`).
 *    The dictionary's content hash would be unsound here: the contents of a
 *    mutable value change under a hash table.
 *
 * Objects are constructed ONLY through `ce._object()` (below) until the
 * user-facing named-argument constructor lands: no literal cache, no parse
 * route and no `box()` path ever mints one, which is what keeps "a parsed
 * snapshot is a record, never an object" true by construction.
 */
/**
 * Does storing `next` over `current` change anything a reader could observe?
 *
 * Identity alone is too narrow to be useful. The elision was licensed by the
 * claim that equal small integers share one boxed node engine-wide, and that
 * holds for a host-built `ce.number(1)` — but NOT for a literal that came
 * through the parser, which carries its own source offsets and is a distinct
 * instance. So `p.n = 1` over a stored `1` bumped the version and invalidated
 * every cache entry that had read the field, once per iteration of any loop
 * that wrote an unchanged value back.
 *
 * Value equality is checked only for NUMBER and STRING operands, and only
 * alongside an identical TYPE. `isSame` is a value equivalence that spans
 * REPRESENTATIONS by design — the exact rational `1/2` and the float `0.5`
 * are `isSame`, as are the one-cluster string `"a"` and the character `'a'` —
 * so value equality alone would suppress a store that changes `isExact`, the
 * MathJSON, or the operand's type, all of which a reader can observe.
 * Requiring the types to agree as well rules those out: `finite_rational` is
 * not `finite_real`, and `string` is not `character`, while the case this
 * exists for (`1` over a stored `1`) agrees on both and still elides.
 *
 * Confined to these two kinds because their comparison never walks the
 * operand tree. `isSame` would be sound for any operand, but a structural
 * walk would be paid on every store including the ones that genuinely change
 * something, in exactly the store-heavy loops objects exist for. (The
 * comparison is not strictly constant-time — two bignums bottom out in
 * `Decimal.eq`, whose cost tracks the configured precision — but it is
 * fixed-cost in the size of the expression, which is what the loop concern is
 * about.)
 *
 * Anything else keeps the identity test, so this is strictly more elision
 * than before and never less.
 */
function isRedundantStore(
  current: Expression | undefined,
  next: Expression
): boolean {
  if (current === next) return true;
  if (current === undefined) return false;
  if (current.type.toString() !== next.type.toString()) return false;
  if (isNumber(current) && isNumber(next)) return current.isSame(next);
  if (isString(current) && isString(next)) return current.isSame(next);
  return false;
}

export class BoxedObject extends _BoxedExpression implements ObjectInterface {
  override readonly _kind = 'object';

  [Symbol.toStringTag]: string = '[BoxedObject]';

  /** The stored fields. Insertion order is the DECLARED field order, which is
   * therefore also the display and serialization order. `_store()` is the
   * sole writer. */
  readonly _slots: Map<string, Expression>;

  /** Per-object cache currency; see {@link _store}. */
  _version = 0;

  /** Per-engine construction serial; the sole input to {@link hash}. */
  readonly _serial: number;

  /** The nominal type, resolved ONCE at construction and never re-resolved by
   * name. Pinning is what makes "layouts never migrate" literally true: a
   * `type` statement re-run replaces the registry record IN PLACE, so neither
   * a by-name re-resolution NOR a stored pointer to that record would do —
   * both report the NEW layout for an instance whose slots hold the OLD one.
   * What is stored is therefore a detached COPY of the resolved reference
   * (`detachNominalType`, below), which no registry write can reach. Under
   * pinning the two populations are simply distinct nominal types that share a
   * name — objects constructed before the redeclaration keep their type,
   * layout and conformances. */
  private readonly _type: BoxedType;

  readonly typeName: string;

  /**
   * Not the construction path: use `ce._object()`, which resolves and pins
   * the type and assigns the serial.
   * @internal
   */
  constructor(
    ce: ComputeEngine,
    typeName: string,
    type: BoxedType,
    slots: Map<string, Expression>,
    metadata?: Metadata
  ) {
    super(ce, metadata);
    this.typeName = typeName;
    this._type = type;
    this._slots = slots;
    this._serial = nextSerial(ce);
    // Arms the cache rules' fast path: until one object exists, no cache
    // payload can contain one, and the containment walk they run at every
    // commit point short-circuits to a single boolean check
    // (`object-deps.ts`, `anyObjectExists`).
    noteObjectConstructed(ce);
  }

  /** The inert head-word, for display only: objects are values, not
   * applications, and nothing in the engine dispatches on it. (Same posture
   * as `BoxedString`/`BoxedDictionary`, whose `operator` is their kind-word.)
   */
  get operator(): string {
    return 'Object';
  }

  /**
   * The full B5 form, `["Object", <record>, "'TypeName'"]`, computed FRESH on
   * every access and never memoized — the value is mutable, so a frozen
   * serialization goes stale at the next store. See `object-walk.ts` for the
   * walk, its cycle markers and its two documented losses.
   */
  get json(): MathJsonExpression {
    return objectJson(this);
  }

  /**
   * Identity hash, from the construction serial: `isSame ⇒ same hash` then
   * holds trivially and — decisively — the hash cannot change under a store,
   * which a content hash would.
   */
  get hash(): number {
    return hashCode('Object' + this._serial);
  }

  get type(): BoxedType {
    return this._type;
  }

  /** The VALUE is inert: constructing an object and storing to one carry the
   * `state` label, but the constructed value fires nothing when evaluated —
   * exactly like every other already-evaluated value. */
  get isPure(): boolean {
    return true;
  }

  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(_val: boolean) {
    return;
  }

  /** `value` is the number-ish scalar view of an expression; an object has
   * none (dictionary precedent). Its fields are read with `_field()`. */
  get value(): Expression | undefined {
    return undefined;
  }

  get complexity(): number {
    return 1000;
  }

  /** Objects are deliberately NOT collections, at every question of the
   * protocol: field access is not element access, and a conversion that
   * admitted them by an `isCollection` test would walk them by accident. */
  get isCollection(): boolean {
    return false;
  }

  get isIndexedCollection(): boolean {
    return false;
  }

  get isLazyCollection(): boolean {
    return false;
  }

  //
  // Invariant 1 — one instance per object, forever.
  //

  override get canonical(): Expression {
    return this;
  }

  override get structural(): Expression {
    return this;
  }

  override evaluate(_options?: Partial<EvaluateOptions>): Expression {
    return this;
  }

  override N(): Expression {
    return this;
  }

  override simplify(_options?: Partial<SimplifyOptions>): Expression {
    return this;
  }

  override subs(
    _sub: Substitution,
    _options?: { canonical?: CanonicalOptions }
  ): Expression {
    return this;
  }

  /** Unlike other leaf kinds, an object does NOT hand itself to `fn`: a
   * mapping function is free to return a rebuilt node, and rebuilding an
   * object would mint a second instance of one object. Objects are opaque to
   * structural rewriting; enclosing structures still rebuild AROUND them. */
  override map(
    _fn: (x: Expression) => Expression,
    _options?: { canonical: CanonicalOptions; recursive?: boolean }
  ): Expression {
    return this;
  }

  override _unshared(): _BoxedExpression {
    return this;
  }

  //
  // The mutable core.
  //

  /**
   * Read a stored field: a pure load of an already-evaluated value. It runs no
   * user code and evaluates nothing, which is what makes the per-object
   * version counter a SUFFICIENT dependency for a cached result that read the
   * field.
   *
   * The read is REPORTED to every cache-dependency collector currently open
   * (`object-deps.ts`), so that whatever cache entry the surrounding
   * computation ends up in records `(this, this._version)` and stops being
   * served once a store bumps that counter. The version is sampled BEFORE the
   * load, which is the conservative order: a store cannot interleave here (the
   * load runs no code), and sampling first can only ever under-state the
   * version, which under-states validity rather than over-stating it.
   *
   * This is the engine's hottest object path. With no collector open — no
   * cache-backed computation running, by far the common case —
   * `recordObjectRead` costs one length check and allocates nothing.
   */
  _field(name: string): Expression | undefined {
    recordObjectRead(this, this._version);
    return this._slots.get(name);
  }

  /**
   * The DECLARED type of one stored field, or `undefined` for a name this
   * object's layout does not carry.
   *
   * Read off the type PINNED on this instance, never resolved from the type
   * registry by name — that is the whole point of pinning. An Epsil `type`
   * statement re-run replaces the registry record in place, so a by-name
   * lookup would answer with the NEW layout for an instance whose slots hold
   * the OLD one, and a store type-checked against it could write a value the
   * field cannot hold.
   *
   * This is not a field READ and deliberately does not report one to the
   * dependency collectors: it consults the layout, which is fixed at
   * construction, and never the slots, whose contents a store changes. A
   * cache entry that asked what type `age` is has not thereby become
   * sensitive to what `age` holds.
   */
  _fieldType(name: string): Type | undefined {
    return objectLayoutOfType(this._type.type)?.elements[name];
  }

  /**
   * An object expression denotes a **fixed reference**, and a reference never
   * changes — only the contents it points at do. `isConstant` is a question
   * about the VALUE, so the answer is `true`, and it stays true across every
   * store.
   *
   * Staleness therefore does not live here. It lives in expressions that READ
   * FIELDS, and those are covered by the per-object version dependency channel
   * (`object-deps.ts`): a cached result that read `p.age` records `(p,
   * version)` and is dropped by the next store to `p`. This is the same
   * composition rule the specification states for reference-valued fields — a
   * cached `p.friend` depends only on `p`'s counter, because the result is a
   * reference and it is still the right reference whatever the friend's own
   * fields do, while a cached `p.friend.name` depends on both counters.
   *
   * Constant-folding the CONSTRUCTION is a separate question and is separately
   * prevented: the constructor application carries the `state` effect label,
   * so it is impure and never folded (`type-constructors.ts`).
   *
   * `isConstant` DOES reach a cache key, and answering `true` here is safe for
   * a stated reason rather than by accident. One cache-key selection is left
   * that asks whether an expression's operands are all constant and, when they
   * are, chooses a key no engine generation can invalidate:
   * `BoxedFunction._lazyCollectionMemoKey` (`ops.every(x => x.isConstant)`).
   * Since an object answers `true`, a field-reading node such as
   * `Field(p, 'age')` is itself `isConstant` and takes the
   * generation-independent key. That is
   * correct, and answering `false` would not have made it safer: a field store
   * advances no engine invalidation axis at all — not `any`, not `semantic`,
   * not `world`, not `callable` — so a generation-keyed entry would be exactly
   * as blind to a store as a generation-independent one. What actually
   * invalidates these entries is the per-object version channel, which stamps
   * `(object, version)` pairs on each entry and re-validates them at every use
   * (`object-deps.ts`, whose cache inventory names these same slots).
   * Answering `false` here would instead wrongly claim that binding an object
   * to a name is a time-varying value.
   *
   * Spec: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Changing a field is an
   * effect" (per-object granularity) and "Every construction makes a new
   * object".
   */
  override get isConstant(): boolean {
    return true;
  }

  /**
   * The SOLE slot writer.
   *
   * A store a reader could not observe is suppressed TOTALLY: no version
   * bump, no state event. That covers the identical node — everything
   * storable is immutable except objects, which alias by design, so an
   * identical node cannot differ in contents — and, for NUMBER and STRING
   * operands of the same type, an equal value. See {@link isRedundantStore}
   * for why the type has to match and why the widening stops at those two
   * kinds. The binding machinery applies the narrower identity-only rule to
   * `Assign` (`boxed-value-definition.ts`'s value setter).
   *
   * Any other store writes the slot, increments `_version` — the per-object
   * cache currency that lets a cached field-derived result tell whether the
   * object it read has changed — and reports an `object-store` state event.
   * That event advances no invalidation axis by ruling (2026-08-15); it exists
   * so that the write has a single reported site alongside every other state
   * write in the engine, and so the field-store canary
   * (`CE_OBJECT_STORE_BUMPS_ANY`) has somewhere to hang. The invalidation
   * itself is the version bump on the line above, consumed through
   * `object-deps.ts`. See the `object-store` row of `axisMaskOf`
   * (`engine-configuration-lifecycle.ts`) for why the axes stay still.
   */
  _store(name: string, value: Expression): void {
    if (isForeignEngineObject(value, this.engine)) {
      throw new Error(
        `object-foreign-engine: cannot store an object that belongs to a different engine into "${this.typeName}.${name}"`
      );
    }
    if (isRedundantStore(this._slots.get(name), value)) return;
    if (this._version >= COUNTER_LIMIT) {
      console.assert(false, 'Object version counter exhausted');
      throw new Error(
        `Object version counter exhausted: too many stores to this "${this.typeName}" object`
      );
    }
    // Checkpoint journal (design §5.3): the ONLY writer of `_slots` in the
    // tree, so one hook covers every field store — including the compiled
    // tier, which cannot reach a slot at all (`Assign(Field(…))` fails to
    // compile). Placed after the identity no-op guard above, where the old
    // value is already in hand, and before the store.
    //
    // The entry records PRESENCE alongside the value: this method can create
    // a previously-absent slot, and `undefined` is ambiguous between "absent"
    // and "present but undefined", so the undo needs an explicit delete for
    // the absent case. `_version` is bumped on restore, never restored — the
    // same monotone-counter rule as everywhere else.
    //
    // The OBJECT is the recorded owner, not its slot map: after replaying the
    // slot undos a restore has to bump `_version` once per touched object, and
    // there is no way back from a bare `Map` to the object that owns it.
    journalCheckpointMapEntry(
      this.engine,
      this._slots,
      name,
      name,
      'object-store',
      this
    );
    this._slots.set(name, value);
    this._version += 1;
    this.engine._noteStateEvent({ kind: 'object-store' });
  }

  /**
   * An object pattern-matches nothing but itself (and an ordinary wildcard):
   * there is no destructuring in v1, and content matching would be as
   * time-varying as content equality. Both guards below are `_kind` checks,
   * never `instanceof`, so they survive the host/plugin bundle boundary —
   * which is why `isExpression` is taken from `type-guards.ts` and not from
   * `utils.ts`, whose same-named twin is an `instanceof _BoxedExpression` test
   * that a pre-boxed pattern from another bundle fails.
   */
  match(
    pattern: string | ExpressionInput,
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    const p = isExpression(pattern)
      ? pattern
      : this.engine.expr(pattern as ExpressionInput, { form: 'raw' });

    if (isWildcard(p)) return { [wildcardName(p)!]: this };
    if (!isObject(p)) return null;
    return (p as Expression) === (this as Expression) ? {} : null;
  }
}

/**
 * Construct an object of nominal type `typeName` with the given stored
 * fields — `ce._object()` is its engine-facing spelling, and the ONLY path
 * that mints an object (the minted constructor's evaluate handler calls it).
 *
 * The type is resolved ONCE here and pinned on the instance, as a DETACHED
 * SNAPSHOT (see {@link detachNominalType}). A name the type registry does not
 * know yet still yields an object, carrying an unresolved nominal reference to
 * that name: the kind must be constructible — and testable — with no
 * declaration in the registry at all.
 *
 * `pinnedType` overrides that resolution, and a caller that HAS the type must
 * pass it: a PARAMETERIZED object type resolves by name to the bare
 * declaration record (`Cell`), which carries no type arguments and therefore
 * matches no use of the type — `Cell<integer>`, the applied reference the
 * call site solved for, is what the value's type must be. The override is
 * used only when it names this same type, so a caller cannot accidentally
 * pin an unrelated type onto the instance.
 *
 * Whatever the route, the candidate must actually BE an object type. A stale
 * alias, or a non-object type that happens to share the name, would otherwise
 * be pinned verbatim and the instance would report its own type as not an
 * object (`isObjectType`) — so a candidate that fails the test is discarded
 * for the unresolved nominal reference, the same fail-closed answer an
 * unknown name gets.
 */
export function makeObject(
  ce: ComputeEngine,
  typeName: string,
  slots: Iterable<readonly [string, Expression]> | Record<string, Expression>,
  metadata?: Metadata,
  pinnedType?: BoxedType
): BoxedObject {
  let candidate: BoxedType | undefined = namesThisType(pinnedType, typeName)
    ? pinnedType
    : undefined;
  if (candidate === undefined) {
    try {
      candidate = ce.type(typeName);
    } catch {
      candidate = undefined;
    }
  }

  const type =
    candidate !== undefined && isObjectType(candidate.type)
      ? detachNominalType(candidate)
      : new BoxedType({
          kind: 'reference',
          name: typeName,
          alias: false,
          def: undefined,
        });

  const entries: Iterable<readonly [string, Expression]> =
    Symbol.iterator in slots
      ? (slots as Iterable<readonly [string, Expression]>)
      : Object.entries(slots as Record<string, Expression>);

  const map = new Map<string, Expression>();
  for (const [key, value] of entries) {
    if (isForeignEngineObject(value, ce)) {
      throw new Error(
        `object-foreign-engine: cannot construct "${typeName}" with a field value that belongs to a different engine`
      );
    }
    map.set(key, value);
  }

  return new BoxedObject(ce, typeName, type, map, metadata);
}

/**
 * A DETACHED copy of the nominal type `t`, safe to pin on an instance forever.
 *
 * Resolving a name is not enough to pin it. `ce.type('P')` hands back the type
 * registry's own record for `P`, and a re-declaration of `P` UPDATES THAT
 * RECORD IN PLACE (`engine-declarations.ts`, the `replacesInPlace` branch) —
 * so an instance holding the record would silently start reporting the NEW
 * layout while its slots still hold the old one, which is exactly the layout
 * migration invariant 7 forbids
 * (`docs/TYPE-SYSTEM.md`, "Type — pinned
 * at construction"). Copying the reference node and its definition body cuts
 * that edge: no later registry write can reach the copy.
 *
 * What is copied, and what is deliberately not:
 *
 * - The reference node's own properties, including the resolved `def` — the
 *   LAYOUT, the thing a re-declaration replaces. The `object{…}` body is
 *   copied one level (a fresh `elements` map) so that even an in-place edit of
 *   the layout cannot reach the pin.
 * - The printed NAME is unchanged, so `P` still prints and diagnoses as `P`;
 *   the two populations are distinct nominal types that share a name.
 * - Field types are NOT followed. A field declared `Inner` keeps pointing at
 *   `Inner`'s live record — that field holds an object VALUE, and that value
 *   carries its own pin.
 * - An APPLIED reference (`Cell<integer>`) keeps its non-enumerable `decl`
 *   back-pointer to the LIVE declaration record. That pointer is load-bearing
 *   for subtyping: `sameTypeApplication()` (`common/type/subtype.ts`) rejects
 *   two same-named applications whose `decl` records differ, so a copied
 *   record would make the pinned `Cell<integer>` match no other `Cell<integer>`
 *   at all — including in a session where nothing was ever re-declared. The
 *   copy still owns its `def`, so the LAYOUT is pinned either way; what the
 *   live pointer leaves reading through to the registry is the declared
 *   parameter list and the "is it an object type at all" answer.
 */
function detachNominalType(t: BoxedType): BoxedType {
  const ref = t.type;
  if (typeof ref !== 'object' || ref.kind !== 'reference') return t;

  const def = detachDefinitionBody(ref.def);

  if (ref.args === undefined)
    return new BoxedType({ ...ref, def } as TypeReference, t.typeResolver);

  // An applied reference carries `def` and `alias` as ACCESSORS delegating to
  // the declaration record, plus the non-enumerable `decl` back-pointer
  // (`common/type/reference.ts`). Copying DESCRIPTORS keeps `decl`, which a
  // spread would drop; `def` and `alias` are then overwritten with the values
  // read now, which is what severs the delegation.
  const descriptors = Object.getOwnPropertyDescriptors(ref);
  const own = (value: unknown): PropertyDescriptor => ({
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  descriptors.def = own(def);
  descriptors.alias = own(ref.alias);
  descriptors.args = own([...ref.args]);
  return new BoxedType(
    Object.create(Object.getPrototypeOf(ref), descriptors) as TypeReference,
    t.typeResolver
  );
}

/** The definition body of a pinned nominal reference, copied far enough that a
 * later edit of the registry's own body cannot reach it. Only an `object{…}`
 * layout needs the copy — it is the one body kind a re-declaration of an
 * object type installs — and one level is enough: the field TYPES are shared
 * on purpose (see {@link detachNominalType}). */
function detachDefinitionBody(def: Type | undefined): Type | undefined {
  if (typeof def === 'object' && def !== null && def.kind === 'object')
    return { kind: 'object', elements: { ...def.elements } };
  return def;
}

/** Is `t` a nominal reference to the type named `typeName`? The guard on the
 * `pinnedType` override in {@link makeObject}. */
function namesThisType(
  t: BoxedType | undefined,
  typeName: string
): t is BoxedType {
  if (t === undefined) return false;
  const type = t.type;
  return (
    typeof type === 'object' &&
    type.kind === 'reference' &&
    type.name === typeName
  );
}
