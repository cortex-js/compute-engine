# Object value representation — decision note

**Date**: 2026-08-14 · **Revision 2** (dual spec review 2026-08-14 —
11 findings, all applied; record:
`docs/scratch/2026-08-14-object-representation-decision_SPEC_REVIEW.md`;
the type-pinning fork was user-ruled option (a) same day) · **Status**:
DECISION — Phase 1 step 1 of
`docs/plans/2026-08-13-mutable-objects-implementation-plan.md` (the
plan's risk list mandates this note before code). Normative spec:
`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B. Codebase facts below were
surveyed 2026-08-14 against the shipped kind/dispatch surfaces.

## The decision, in one paragraph

An object is a **new expression kind**: `class BoxedObject extends
_BoxedExpression`, `_kind: 'object'`, and **the class instance itself is
the heap record** — it carries the mutable slot table
(`_slots: Map<string, Expression>`), the per-object version counter
(`_version: number`), a construction-time serial (`_serial: number`,
per-engine monotone), and the **pinned nominal type** — the resolved
`BoxedType` captured at construction, never re-resolved by name
(user-ruled 2026-08-14, see "Type"). There is no separate
wrapper/record split:
reference identity of the instance IS object identity, every code path
returns `this` (objects are always canonical, always evaluated), and
nothing may ever clone, rebuild, or intern one. `isSame` = `a === b`,
unconditionally, at every tier.

## Why the instance is the record (and the rejected alternatives)

- **Rejected: a tagged `BoxedFunction` application** (how nominal values
  are represented today, `type-constructors.ts` `isNominalTaggedValue`).
  Function expressions are immutable trees that the whole engine feels
  free to share structurally, dedup by `isSame`, rebuild in canonical
  passes, and admit to caches by default. An object must be none of
  those things; representing it as the kind with the *most* sharing
  machinery would turn every exclusion into a fight against defaults.
  A fresh kind inverts that: everything kind-dispatched ignores it until
  explicitly taught, which is the fail-closed direction.
- **Rejected: a separate heap record inside a re-boxable wrapper**
  (the implementation plan's original lean). Two-level identity means
  every equality, hash, cache-dependency, and weak-reference site must
  remember to reach through the wrapper; a single level makes host
  reference equality the truth everywhere with no unwrap step. The
  wrapper split earns its cost only if wrappers can legitimately
  multiply — and no shipped path requires that: leaf kinds return
  `this` from `canonical`/`structural`/`subs`/`map` walks, `evaluate`
  on an object returns `this` (it is a value), and `_unshared()`
  returns `this` for non-interned kinds. The single-instance invariant
  is stated below and cheap to keep.

## The class contract

- **Base**: `_BoxedExpression` (`abstract-boxed-expression.ts`).
  Required abstract members and their answers:
  - `operator`: `'Object'`? No — objects are not applications; follow
    `BoxedString`/`BoxedDictionary`, whose `operator` returns their
    kind-word. Use `'Object'` as the inert head-word for display
    only; nothing dispatches on it.
  - `json`: the B5 serializer default, IN FULL, from Phase 1 —
    `["Object", <record>, "'TypeName'"]` with the record produced by
    the shared structural walk (stored fields only, lazy recipes
    pass through, `CircularReference` depth+type markers on
    back-edges). **The record is emitted as the `Dictionary` operator
    form** (`["Dictionary", ["KeyValuePair", …], …]`), amended
    2026-08-14: `Record` has no operator definition anywhere in the
    engine, so a `["Record", …]` payload is an inert application whose
    type is `unknown` — which would make the `Object` head's
    "types as its record operand" contract vacuous. `Dictionary` is a
    real operator whose boxed value derives a `record<…>` type from
    its identifier keys, so the wrapper's contract becomes meaningful
    and the reloaded snapshot is a genuine record-typed value. See the
    `RecordFrom` entry in `ROADMAP.md` for the shipped defect this
    uncovered and its consequences for Appendix B Phase 3. No provisional shape ever ships (review finding:
    `.json` is public behavior on a mutable, possibly cyclic value —
    an unspecified interim form would leak). Consequence for
    sequencing: the structural walk is a Phase 1 deliverable (steps
    4/8 territory); Phase 3 adds only the serializer OPTION
    (`objects:`) and the `DictionaryFrom` object arm on top of the same
    walk. The result is **computed fresh on every access and never
    memoized** — the value is mutable — and the one-way re-boxing
    guarantee (parses back as a record under the provenance head,
    never an object) is pinned from Phase 1.
  - `hash`: **identity-based, from `_serial`** (e.g.
    `hashCode('Object' + serial)`). The `isSame ⇒ same hash` contract
    holds trivially. The dictionary's content-hash pattern
    (`hashCode('Dictionary' + JSON.stringify(entries))`,
    `boxed-dictionary.ts:178`) is UNSOUND here — a mutable value's
    content hash changes under it — and must not be copied.
  - `isCanonical`: `true`, setter no-op (dictionary pattern).
  - `match`: identity only — an object pattern-matches nothing but
    itself (and ordinary wildcards); no destructuring in v1. Use a
    `_kind` check, not `instanceof` (`BoxedDictionary.match`'s
    `instanceof` is a recorded cross-bundle wart; do not copy it).
- **Equality**: TWO arms, not one (the review's `eqImpl` finding). In
  `compare.ts same()`, after the `a === b` fast path: if either side
  is an object, return `a === b` (i.e. `false` at that point) — two
  content-equal objects must never fall through to structural
  comparison. And in `eqImpl()` — which reaches `same()` only AFTER
  operator `eq` handlers, numeric-difference paths, and assumption
  lookup (`ce.ask`), any of which could decide first — an explicit
  object branch placed after operand evaluation and BEFORE those
  paths: when either evaluated operand is an object, return `a === b`.
  Without it, Appendix B's "object comparisons always decide by
  reference identity" does not actually hold (an `assume(a == b)` or
  an operator handler could answer). Pinned by tests including a
  contradictory assumption and constructor-call operands. B4's
  `Equatable` (deferred) would later carve into exactly this branch,
  nowhere else. `cmp()` keeps returning `undefined` (objects are
  unordered).
- **Type — pinned at construction** (user-ruled 2026-08-14, resolving
  the review's redeclaration finding): the constructor resolves the
  nominal reference ONCE, at construction time, and stores the
  resulting `BoxedType` on the instance (`_type: BoxedType`); the
  `type` getter returns it verbatim, with no name re-resolution and no
  version stamp, ever. This is what makes "layouts never migrate"
  literally true through a `type` statement re-run: Epsil type
  redeclaration replaces the registry record in place
  (`docs/plans/2026-08-10-global-type-registry.md`), so a by-name
  re-resolution would silently report the NEW layout for an instance
  whose slots hold the OLD one. Under pinning, redeclaring
  `type Person = object<…>` means: the re-run mints a new type record
  and a new constructor; objects constructed AFTERWARD carry the new
  pinned type and layout; objects constructed BEFORE keep their old
  pinned type, old layout, and old conformances — the two populations
  are distinct nominal types that happen to share a name, exactly the
  protocol-replacement posture of Appendix B ("objects constructed
  earlier keep their fields"). No instance census, no rejection, no
  drift. This is the first kind whose class-level `type` getter
  answers a nominal reference — today only operator-definition `type`
  handlers do (`type-constructors.ts`) — and that is fine: the getter
  is the natural surface, and objects never take the
  tagged-application route.
- **Effects/purity**: the VALUE is inert — `isPure: true`,
  `effects: undefined` — exactly like every other already-evaluated
  value. The `state` label lives on the CONSTRUCTOR application and on
  stores, not on the constructed value (Appendix B: "RHS effects fire
  once, at the store").
- **Collection protocol**: `isCollection: false` throughout — objects
  are deliberately not collections (Appendix B plumbing note under
  "Serialization": `DictionaryFrom`'s `isCollection` guard must not admit
  them by accident; P46 dictionary-key precedence is likewise not
  implicated).
- **Value plumbing**: `value` getter returns `undefined` (dictionary
  precedent — `value` is the number-ish scalar view); `evaluate`,
  `N`, `simplify`, `canonical`, `structural` all return `this`.

## The mutable core

- `_slots: Map<string, Expression>`, insertion order = the declared
  field order (display order). Slot values are already-evaluated
  immutable values or object references — never unevaluated
  expressions (the "store writes the evaluated value" rule is what
  makes reads pure loads and the version counter a sufficient cache
  dependency).
- **One store choke point**: an internal `_store(field, value)` method
  is the ONLY writer. It applies the identity no-op guard first
  (`value === current ⇒ return`, suppression total — no bump, no
  event; object identity only, mirroring
  `boxed-value-definition.ts:305`), else writes the slot, increments
  `_version`, and emits the **`object-store` state event** (next
  section). Field READS go through `_field(name)` and are pure loads;
  the property-access operators (Phase 1 steps 4–5) consume these two
  methods and add nothing beside them.
  - **The guard's reach is narrower than Appendix B assumes**
    (measured 2026-08-15, pinned in `object-store.test.ts`). The
    appendix licenses the elision by observing that "the evaluated
    result can be an interned node (equal small-integer literals share
    one boxed value engine-wide)". That holds for host-built literals —
    `ce.number(1) === ce.number(1)` — but NOT for a literal that came
    through the parser, which carries its own source offsets and is a
    distinct instance. So `p.n = 1` over a stored `1` bumps the version
    and invalidates every entry that read the field, although no reader
    can observe a difference; in practice only `p.n = p.n` is elided.
    The guard is sound either way (it is an optimization, never a
    semantic requirement); widening it to `isSame` would close the gap
    and is also sound, but it contradicts the identity-only rule above
    and costs a structural walk per store, so it is an open product
    question rather than a silent change. Recorded in `ROADMAP.md`.
- `_version` starts at 0 and only increments. It is PER-OBJECT cache
  currency, not an engine axis: cached results that read fields record
  `(object, versionAtRead)` dependencies per entry (below). Overflow
  policy (review finding — a `number` stops advancing at
  `Number.MAX_SAFE_INTEGER`, at which point a store would stop
  invalidating): `number` stays the representation (a `bigint` would
  tax every validation compare for a bound of ~9×10¹⁵ stores per
  object, unreachable by orders of magnitude in any real session), and
  `_store` fails LOUD, not stale — a `console.assert` plus a thrown
  error when `_version === Number.MAX_SAFE_INTEGER`. The per-engine
  `_serial` gets the same guard at construction. Pinned by a test
  using a test-only starting value.

## The `object-store` state event

`StateEvent` (engine-configuration-lifecycle.ts) gains
`{ kind: 'object-store' }`, and its mask is **zero on every axis** —
`any: false, semantic: false, world: false`, callable not selected
(USER-RULED 2026-08-15; the fork this settles is recorded below). The
event exists so that a field write is reported at the same choke point
as every other state write in the engine, and so the field-store canary
has somewhere to hang; the invalidation it carries is the per-object
version bump, not an axis.

The rationale is the measured-waste discipline of the state-event
design. Appendix B's forcing function for objects is store-heavy loops
(sorts, sieves, shuffles, the `MutList` idiom), and a per-store bump of
ANY engine axis would cold engine-wide memos on every iteration — the
exact incident class the invalidation-axes work and the item-181 fix
exist to prevent. The PRECISE channel for field-derived staleness is
the per-object version dependency (next section), and it is therefore a
**prerequisite**: property stores do not ship before the dependency
channel does (Phase 1 orders step 7's recording machinery with step 5,
not after it). A store-in-a-loop test (N stores; assert the engine axes
do not move) is an acceptance criterion and is pinned in
`test/compute-engine/object-store.test.ts`.

### The mask fork, and how it was settled (2026-08-15)

Recorded because the reasoning is not recoverable from the outcome.
Revision 1 of this note specified `any: true` while the shipped 1C
inventory reasoned from the opposite premise — `object-deps.ts` stated
that "a field store advances no engine axis" — and both read true only
because no event existed yet. The alternatives were:

- **`any: true`**, fail-safe: a cache family not yet wired to the
  per-object channel would still invalidate. Cost: every store colds
  all generation-keyed caches.
- **Zero-mask**, precise and cheap, but every cache family must be
  *proven* wired or excluded, because anything missed goes stale
  silently.

Two facts found while implementing 1D decided it, and both cut against
the fail-safe reading:

1. **`any: true` is not actually a safety net for the caches in
   question.** An object answers `isConstant` true, so a field-reading
   node such as `Field(p, 'age')` takes a
   *generation-independent* cache key (`_lazyCollectionMemoKey`,
   `_type`, `_eagerSource` in `boxed-function.ts` all select on
   `ops.every(x => x.isConstant)`). An `any` bump does not reach those
   entries at all. The per-object channel is load-bearing under either
   mask; the coarse bump would only have covered families that are not
   the ones at risk.
2. **`any: true` would make the B3 acceptance matrix vacuous.** With
   every store colding all generation-keyed caches, the
   evaluate → store → re-evaluate tests pass whether or not the
   per-object channel works, so the one empirical proof that the
   inventory is complete would stop proving anything.

The residual risk — a missed cache family going stale silently — is
answered by a diagnostic instead of by mask width:
**`CE_OBJECT_STORE_BUMPS_ANY`** makes every store advance `any`
(env-gated, the `CE_EFFECTS_PARANOID`/`CE_CACHE_STATS` posture). A
staleness bug that disappears under the flag is a missing cache family,
and the flag names the file to read.

`object-deps.ts`'s inventory comment was rewritten in the same change,
since it is the file a future reader consults first.

## Per-entry object-version dependencies (shape only; step 7 builds it)

A cache entry that read object fields records
`objectDeps: Array<[WeakRef<BoxedObject>, number]>` — the object read
and its version at read time. Collection is via a **stack-scoped
collector protocol**, not a single ambient slot (the review's
nested-cache finding — the composition rule is what makes B3's matrix
satisfiable):

- Every cache-backed computation that can read fields pushes a
  collector for its dynamic extent; `_field()` reads report to EVERY
  collector on the stack, not just the innermost — an outer entry's
  dependencies must include what its callees read.
- A cache **hit** performs no reads, so the hit path MERGES the hit
  entry's own validated `objectDeps` into every enclosing collector.
  Without this, an outer computation that hits an inner entry commits
  dependency-free and serves stale data after a store — the exact
  failure the B3 matrix must include as a nested hit/store/re-hit test
  per cache family.
- A provisional or failed computation (cycle-guard fail-closed,
  rollback-frame abort, thrown evaluation) commits neither value nor
  dependencies — the same refusal the lazy-collection memo already
  applies to cycle-tainted results.
- Duplicate reads of one object coalesce to the LOWEST version seen
  (equivalently: first read wins; any later bump already invalidates).

Validation on entry use: every ref must still deref AND match its
stamped version; a dead `WeakRef` invalidates conservatively. `WeakRef`
is load-bearing for B12 (a dependency edge must not keep an object
alive) and is a NEW dependency for the codebase — the repo currently
uses only `WeakMap`/`WeakSet`; the supported runtimes (package.json
`engines: node >= 21.7.3`, modern browsers) all ship `WeakRef`, so no
capability check is needed.

## Exclusion list (never interned, never cached, never retained)

Grounded in the surveyed surfaces; each is an explicit edit, all
fail-closed if missed EXCEPT the last two (which is why the B3 matrix
tests them adversarially):

1. **No literal-cache route can mint one**: objects are constructed
   ONLY by the minted constructor's evaluate handler; `box()`/`parse()`
   never produce a `BoxedObject` (a parsed snapshot is a record under
   the `Object` provenance head — one-way door). Nothing to edit;
   pinned by test.
2. **Element memo**: the eligibility walk
   (`collection-element-memo.ts:~291`) gains `isObject ⇒ ineligible`,
   the exact `isDictionary` precedent beside it.
3. **Evaluate memos and every other value-retaining cache** — ONE
   universal commit-time rule (the review's payload-retention finding:
   weak dependency EDGES do nothing about a cached VALUE that itself
   contains an object reference — a memoized element, a simplified
   result, a compiled closure would strongly retain the object,
   violating B12 and staling under B3). The v1 policy, applied at
   EVERY freeze point, not just the lazy-collection memo: **a cache
   payload that transitively contains an object is not memoized.** The
   containment scan is a structural walk (cheap: object references
   only occur where a value was built from one, and the walk
   short-circuits on kinds that cannot contain expressions); the
   refusal mechanism is the cycle-guard provisional-refusal pattern
   already at `boxed-function.ts:~1905`. A constructor APPLICATION
   needs no scan — it is `state`-labeled, hence impure, hence refused
   by the purity gate before any freeze. Weak-payload representations
   (caching the entry with the value held via `WeakRef`) are a
   possible later refinement, deliberately NOT v1: they add a
   collected-payload recompute path to every reader for a benefit no
   measured workload yet demands. B12 acceptance includes GC tests
   with objects nested in containers and captured in closures.
4. **`EngineCacheStore`** (`engine-cache.ts`): the one engine-global
   value retainer; the same rule — no store entry may hold an object
   strongly. Nothing today stores evaluation values there
   (rules/tables only); pinned by an assertion in the B12 test, not by
   machinery.
5. **Serialization/display**: `.json`/`toString`/LaTeX never memoized
   for objects (fresh walk each call, cycle-guarded).

## Cycle guards

The value-walk guard (`boxed-expression/cycle-guard.ts`) exists for
binding-following walks and its header records the premise "a function
expression is a finite tree and cannot refer back to itself" — objects
break that premise for VALUE walks. Two mechanisms, split by what the
walk needs (the review caught that the shared guard alone cannot serve
serialization):

- **Detection-only walks** (printing/AsciiMath, `has`, any traversal
  that just needs to terminate): Phase 1 step 8 extends the shared
  guard's query set to object-slot traversal, keyed on the
  `BoxedObject` instance — a boolean "already in progress" answer is
  all these need.
- **The serialization walk** (`.json` and, in Phase 3, `DictionaryFrom`)
  needs MORE than detection: Appendix B's `["CircularReference", n,
  Type?]` marker carries the ancestor DEPTH `n`, and the shared guard
  is a flag-only bitmask with no path tracking. The walk therefore
  keeps its **own explicit ancestor stack** (the objects on the
  current path, in order); a back-edge's depth and type read directly
  off it. This is walk-local state, not a guard extension — recorded
  here so Phase 1 step 8 and Phase 3 do not each discover the gap.

`same()` stays unguarded by design (identity comparison never
traverses slots).

## Cross-engine ingress (B12's one-engine rule, enforced)

Appendix B rules that an object belongs to the engine that constructed
it, and the representation depends on it (type pinning, state events,
and dependency recording all speak to `this.engine`). The rule gets an
enforcement point, not just prose (review finding — boxed-expression
APIs freely accept pre-boxed values): every ingress where a
foreign-engine expression is adopted checks
`isObject(x) && x.engine !== receivingEngine` — host reference identity
on the engine object, cross-bundle-safe — and rejects with
`object-foreign-engine` (an error value on expression routes, a throw
on host APIs, matching each route's existing convention). Ingress
points to cover, walking the adoption surfaces: `ce.box`/`ce.expr`
adoption of pre-boxed input, `ce.function` operands, constructor
arguments, `_store` values, substitution values (`subs`), assignment
(`ce.assign`/`Assign`), and compiled-unit parameters (Phase 4). The
check runs only on the object kind's path — zero cost elsewhere —
and is pinned by a two-engine test.

## Invariants (the representation's contract, pinned by tests)

1. One `BoxedObject` instance per object, forever: no code path may
   clone, rebuild, or re-box one; `canonical`, `structural`,
   `evaluate`, `N`, `simplify`, `subs`, `map`, `_unshared` all return
   `this` (or rebuild AROUND `this` for enclosing structures).
2. `isSame`/`isEqual`/`isIdenticallyEqual` answer reference identity;
   `isSame` runs no user code, protocol or no protocol.
3. `_store` is the sole slot writer; every store bumps `_version` and
   emits `object-store` unless the identical-node guard fires; both
   suppressions are total.
4. Slot values are evaluated values; a slot never holds an unevaluated
   expression.
5. `hash` and identity never depend on contents.
6. An object never enters an intern table, an element memo, or an
   engine-global strong store; no cache payload transitively contains
   one; caches that read its fields depend on `(instance, version)`
   pairs held weakly.
7. The nominal type is PINNED at construction (`_type` captured once,
   never re-resolved by name); layouts never migrate — a type
   redeclaration affects only objects constructed after it.
8. An object is adopted only by the engine that constructed it; every
   foreign-engine ingress rejects with `object-foreign-engine`.

## Add-a-kind checklist (mechanical; from the 2026-08-14 survey)

`type-guards.ts` gains `isObject` (a `_kind === 'object'` check);
public re-export lists (`compute-engine.ts` ×3, `core.ts`);
`ObjectInterface` narrowing interface in `types-expression.ts`
(`_kind` stays a plain `string` — there is no discriminated union to
extend; narrowing is via the new guard, as for every other kind);
`serialize.ts serializeJsonExpression` arm (before the `.json`
fallback, for option handling in Phase 3); `compare.ts` — the `same()`
arm AND the early `eqImpl()` object branch (see "Equality"); `order.ts`
classifier arm (rank beside dictionary); `ascii-math.ts toAsciiMath`
arm; `match-dispatch.ts` literal handling; element-memo eligibility;
the cross-engine ingress checks (see that section);
`library/collections.ts` — `DictionaryFrom`'s signature widened to
`collection | object` with the object branch dispatched ahead of its
`isCollection` guard (Appendix B names this edit; the operator arm
itself is Phase 3, listed here so the checklist is the one complete
inventory). Epsil display rides `.json` (no separate edit). LaTeX rides
`toMathJson()` (no separate edit).
