# Mutable objects (Appendix B) — implementation plan

Plan for implementing `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B
("Mutable objects"), as revised and spec-reviewed 2026-08-13 (review
record: `docs/scratch/TYPE_SYSTEM_ROADMAP_SPEC_REVIEW.md`, all 16
findings applied). The appendix's prose is the normative spec; its
decision record (B1–B13) indexes status. This plan sequences the work,
names dependencies and acceptance criteria per phase, and records what
is explicitly out of scope.

**Gate: cleared.** The appendix was ratified as a whole 2026-08-13,
including B6 (bare `object` usable as "any object"; disjoint from
`record`, sitting beside it in the lattice). All phases may proceed
in order.

---

## Phase 0 — Standalone preludes (no object machinery)

Two pieces of the design stand alone and de-risk everything after
them. Both change behavior of *shipped* subsystems, so each lands with
its own tests and CHANGELOG entry.

### 0a. Derived dispatcher effects + opt-in ceilings

**Status: IMPLEMENTED 2026-08-14** (unstaged; three implementer work
packages + two relayed review fixes). As-built notes, where they refine
the sketch below: the union is a lazy per-definition deriver
(`_deriveEffects` on `_BoxedOperatorDefinition`, refreshed by the
`effects`/`pure`/`drawsRandom`/`signature` accessors and applied through
`_setEffects` so the arrow serializes the union), memoized on a new
engine `_conformanceVersion` counter PLUS the callable axis — the
"effects cache keyed by the conformance registry" bullet realized at the
definition layer, since registration already emits a `config` state
event that invalidates the expression-level memos. Transitive dependents
stay fresh via a `consultsRegistry` bit the inference walk propagates
(operator-definition callees only; the value-binding path is a recorded
residual, see ROADMAP "Protocols residue"). Derivers decline to stamp
their memos while an inference rollback frame is open (frame undo
restores raw slots without advancing counters). The declared-contracts
"registry" is an enumeration of live scope-chain bindings filtered on
`effectsDeclared` + a re-derivable body — equivalent for live bindings
and index-free. Acceptance suite:
`test/compute-engine/protocol-effects.test.ts` (13 tests, three routes)
plus the ceiling/widening pins in `protocols.test.ts` and
`test/epsil/protocols.test.ts`.

Spec: Appendix B, "Changing a field is an effect", the
requirements-derive bullet — but nothing in it mentions objects; it is
a protocols/effects feature.

- A protocol function requirement with a **bare** specifier imposes no
  effect bound; the dispatcher's effect set is the **union of the
  inferred effects of registered conforming implementations**.
- Cache the union on the effects cache, keyed by the **conformance
  registry** in addition to the existing callable axis (the effects
  cache re-key machinery is
  `docs/plans/2026-08-09-state-event-invalidation-axes.md`, step 3;
  conformance registration already emits a registry state event per
  Appendix A "Registry changes are state events").
- A requirement **with** a specifier is a ceiling: conformance
  checking rejects an implementation whose inferred effects exceed it
  (`protocol-signature-mismatch` names the exceeded label and points
  at the ceiling as a possible fix site).
- **Declared-contracts registry + widening guard:** index every
  definition carrying an explicit effect specifier (small by
  construction — bare-means-inferred is the default). After a
  conformance registers, re-derive each registered contract-holder's
  effect set (ordinary cached derivation; transitivity falls out of
  body walks); any contract now exceeded rejects the conformance
  statement with `conformance-widens-declared-contract`, naming every
  violated dependent and the exceeding labels.

Acceptance: route-parity tests (box/parse/function — lazy-operator
pitfall) for: bare requirement pure-while-conformers-pure; union
widens on first mutating/drawing conformance and dependent caches
recompute; ceiling rejects an exceeding conformance; widening guard
blocks with the right diagnostic and multiple dependents named;
serialized dispatcher signature snapshots the union as-of
serialization. Effort: M.

### 0b. `state` label plumbing (inert until Phase 1 emits it)

**Status: IMPLEMENTED 2026-08-14** (unstaged). The roster/serializer/
inference plumbing all derived from the closed enumeration
(`EffectLabel` union in `common/type/types.ts`, `EFFECT_LABELS` +
`IMPURITY_LABELS` in `common/type/effects.ts` — both parsers read the
list, so the specifier slot and Cortex definition forms picked the label
up with no parser edits). All three EFFECTS-MODEL.md amendments (items
6–8) landed, including the v6 `mutable`-note resolution paragraph and
the confinement-does-not-apply-to-`state` note. Acceptance:
`test/compute-engine/effects-state-label.test.ts` (round-trips,
ordinary-label inference/contracts, 0a ceiling participation) + the
roster pin in `test/common/type/effects.test.ts` updated (the
minor-version event, deliberate). `src/api.md` regeneration
(`npm run doc`) deferred — the tree carries concurrent unstaged tracks a
regeneration would sweep in.

Spec: Appendix B "Changes to shipped documents" items 6–8.

- `docs/EFFECTS-MODEL.md`: label table gains `state` (impure; action;
  no frame protocol; not handler-backed); the closed `<label>` grammar
  production gains `state` (minor-version event per that section's
  policy); the "Examined and deferred (v6)" `mutable` note gains the
  resolution paragraph (the B1 gate, per-object version counters, and
  B3 cache exclusion are the distinguishing consumers v6 found
  missing).
- Type-string parser/serializer round-trips `state` in the specifier
  slot; inference treats it as an ordinary label. No emitter exists
  yet — the label is inert.

Acceptance: type-string round-trip tests; a declared `state` ceiling
parses, serializes, and participates in ceiling checks (0a). Effort: S.

---

## Phase 1 — Object core (the value, the type, the store)

The center of gravity. Sub-steps in dependency order.

> **Step 1 DONE 2026-08-14** —
> `docs/plans/2026-08-14-object-representation-decision.md` (revision 2,
> dual-reviewed, 12 findings applied; the type-pinning fork user-ruled).
> Three of its findings CHANGE this phase's ordering, and supersede the
> sketch below where they differ:
>
> - **The dependency-recording channel (step 7) is a PREREQUISITE for
>   the property store (step 5), not a follow-up.** The `object-store`
>   event mask is `any`-only with the callable axis NOT selected (a
>   semantic/callable blanket per store would cold engine-wide memos in
>   exactly the store-heavy loops objects exist for), so per-object
>   version dependencies are the ONLY precise invalidation channel and
>   must exist before stores are exposed. A store-in-a-loop
>   microbenchmark is an acceptance criterion.
> - **`.json` ships the FULL B5 serializer form in Phase 1** — the
>   `["Object", <record>, "'TypeName'"]` wrapper over the shared
>   structural walk, with `CircularReference` depth+type markers. No
>   provisional shape ever ships. Phase 3 then adds only the serializer
>   OPTION and the `RecordFrom` operator arm over the same walk. The
>   walk keeps its OWN ancestor stack (the shared cycle guard is
>   flag-only and cannot produce the marker's depth).
> - **The nominal type is PINNED at construction** (never re-resolved
>   by name), which is what makes "layouts never migrate" true across a
>   `type` re-run. Within one program a re-declaration is now an error
>   anyway (the redefinition discipline, shipped 0.108.0), so the
>   mixed-generation surface exists only across notebook cells.
>
> **Work packages** (each independently verifiable):
> **1A** — the `BoxedObject` kind: class, add-a-kind checklist edits,
> identity equality (both `same()` and the early `eqImpl()` branch),
> pinned type, `.json` + structural walk + cycle guards, cross-engine
> ingress rejection, and an engine-internal factory so the kind is
> testable before a user-facing constructor exists.
> **1B** — `type P = object<…>` declaration (nominal, B13 invariant
> stored fields, `object-type-not-inline`) + the named-argument
> constructor (B7 every field required; first `state` emitter; never
> folded or served from caches).
> **1C** — the per-entry object-version dependency channel
> (stack-scoped collectors with hit-merging) + the cache exclusion
> inventory (B3), including the universal "no cache payload
> transitively contains an object" rule.
> **1D** — field read, property store, the `object-store` state event,
> and the B3 adversarial acceptance matrix; the Appendix A
> rebinding-sugar replacement (the phase's one breaking change —
> measure snapshot blast radius before landing).
> **1E** — evaluation-order audit (B8) and the appendix's own examples
> as verbatim tests.

1. **Representation decision (first design task, before code).** An
   object value = identity + mutable slot table + per-object version
   counter + nominal type. Constraints: never interned, never
   value-shared, excluded from literal caches; identity checks must
   not use `instanceof`/`constructor.name` (cross-bundle identity
   hazard — string/brand checks only, reproduce against `dist`).
   Lean: a new expression kind carrying a heap record
   `{ typeName, slots: Map<string, Expression>, version: number }`,
   with `isSame` = host reference identity on the heap record.
2. **Type declaration**: `type Person = object<…>` — nominal, rides
   the global type registry and (for `object<…, T>`) the
   parameterized-nominal machinery (§1 N1–N12) with B13's rule: a
   stored field is an invariant position (`inout` only) for the
   variance walker; inline `object<…>` in annotations rejected
   (`object-type-not-inline`).
3. **Constructor**: named-argument calls (Appendix C, shipped), every
   stored field required (B7), fresh identity per call, carries
   `state` (first emitter), never constant-folded or served from
   evaluation caches (B3).
4. **Field read**: pure load of the stored (already-evaluated) value;
   records a dependency on the object's version counter.
5. **Property store**: `p.age = v` and any object-valued target
   (`xs[i].name = v`). Evaluates the RHS (parity with `Assign` —
   "A store writes the evaluated value"), stores the value, bumps the
   version, emits the **object-store state event** (new event kind in
   the `noteStateEvent` union), carries `state`. This REPLACES
   Appendix A's rebinding sugar: the P2 `protocolPropertyAssignment`
   lowering in `library/core.ts` (`Assign` canonical) is superseded;
   `property-assignment-target-invalid` retires;
   `immutable-value-assignment` covers stores to records/immutables.
   **Breaking change** (Appendix B "Changes to shipped documents"
   item 5): shipped record-backed conformances to `readwrite`
   protocols become `protocol-requires-object`; migration is
   mechanical; measure snapshot blast radius before landing.
   Identity no-op guard: a store of the identical node skips the bump
   (same rule as the binding machinery's value-write guard).
6. **Equality tiers**: `isSame`/`isEqual`/`isIdenticallyEqual` answer
   reference identity for objects; `Same`/`Equal`/`IsSame` operators
   follow; comparisons with no object operand unchanged.
7. **Caching soundness (B3's mandatory matrix)**: the cache
   inventory (evaluation results, lazy-collection/element memos,
   effects and type caches, simplify/rule caches, serialization/
   display caches, compiled artifacts), the per-entry object-version
   dependency representation, and the acceptance matrix asserting:
   no cache serves a field-derived value without validating that
   object's version. Weak references where engine-global machinery
   would otherwise retain objects (B12).
8. **Cycles**: value-walk cycle guards extended to object graphs for
   printing and any recursive value traversal (the guards exist for
   definition walks; user data can now be cyclic).
9. **Evaluation order (B8)**: audit that operand evaluation order is
   left-to-right on the interpreted routes named by the ruling;
   compiled targets preserve or decline (checked in Phase 4).

Acceptance: the appendix's own examples as tests, verbatim (`Person`
birthday flow, `MutableData` aliasing, `Buddy` cycle, construction
inequality, const-binding-vs-contents); route parity throughout;
stale-cache adversarial tests (evaluate → store → re-evaluate) per
cache family in the inventory; blast-radius measurement for the
rebinding-sugar replacement. Effort: XL (the representation +
store + caching steps dominate).

## Phase 2 — Protocol integration

Spec: "Objects and protocols", "Which types can conform".

- Field-backed satisfaction: a stored field satisfies `readwrite`
  (exact type) / `readonly` (covariant) with no accessor written;
  accessor+field conflict is `object-property-conflict`; computed
  properties (`get`/`set` blocks) run per access, setter receives the
  evaluated value; Epsil parser work for accessor blocks in `is …
  { }` implementation blocks.
- The mutability gate (B1): `readwrite` property or *declared*
  `state` member ⇒ object-only conformance
  (`protocol-requires-object`); bare requirements never gate; records
  may conform purely to bare-function protocols.
- `readwrite` requirement implies `state` on its setter (no spelled
  label); implicit setters carry `state` by construction.
- Protocol replacement: layouts never migrate; replacement re-runs
  conformance against the fixed layout.
- Appendix A doc amendments land with this phase (items 1–5 of
  "Changes to shipped documents", including the "Properties"
  must-be-implemented sentence).

Acceptance: `Identifiable`/`Person` example end-to-end (parse and box
routes); `Badge` record rejection with the specified message; gate
matrix (readwrite / declared-state / bare / readonly-only ×
record / object); replacement re-validation. Effort: L.

## Phase 3 — Serialization

Spec: "Serialization" + "Cycles".

- `RecordFrom(object)` arm: widen the shipped signature
  (`collection | object`), dispatch the object branch ahead of the
  `isCollection` guard. Deep **structural** walk (never enumerative):
  stored fields only; lazy/non-finite collection values pass through
  as recipes with operands walked; back-edges become
  `["CircularReference", n, Type?]`; cross-edges duplicate;
  function-literal values with unverifiable captured environments
  decline with an error marker; no `state` label; version
  dependencies recorded per object read.
- The `Object` provenance head: `["Object", record, "'Person'"]` —
  static type is the record's, evaluation transparent, never a
  constructor (no silent reconstruction).
- `toMathJSON()` option (spelling to bikeshed at implementation:
  lean `objects: 'record' | 'reject'`), default `'record'`, wrapping
  each object position; byte-identical record to explicit
  `RecordFrom`; `'reject'` emits subexpression-local
  `object-serialization-unsupported`.
- Display serializers (`toString`, LaTeX, Epsil views) show contents
  with cycle guards; no option needed.

Acceptance: round-trip tests proving the one-way door (reload is a
record; object-only calls/stores rejected — the spec review's
required test); cycle snapshot fidelity (`Buddy` graph → markers with
depth+type); byte-identity between option output and explicit
`RecordFrom`; the O(1)/deep fast-path split by element type. Effort: L.

## Phase 4 — Compilation boundary

Spec: "The rest of the system", B9.

- JS/Python: object-typed parameters into compiled units; unit
  results decline; GPU declines entirely (fail-closed). Evaluation
  order preserved or decline (B8). Verify on `glsl`/`python` — the
  four statement-list lowering paths (see
  `compile-statement-lowering-paths` memory note).

Acceptance: per-target decline tests; JS param-in flow. Effort: M.

---

## Explicit non-goals (all recorded in the appendix)

- `array<T>` and everything under it (`isMutable` facet,
  effect-directed traversal, `ArrayFrom`) — designated follow-on,
  rides Phases 1–4.
- `Equatable` (B4 deferred; its `pure`-ceiling design is fixed but
  unbuilt) and any contents-equality operation.
- `ObjectFrom` reconstruction; object subscript accessors; derived
  shape from protocol; `Ref<T>` library convenience (one declaration
  once B13 lands — trivial, do opportunistically).
- Effect polymorphism; per-argument effect precision.

## Risks / hot spots

1. **Cache staleness** is the correctness risk of the whole feature —
   hence B3's inventory as acceptance criteria, not cleanup. The
   adversarial store-then-reevaluate tests are the spine of Phase 1.
2. **The rebinding-sugar replacement** is the one breaking change;
   blast radius must be measured (full suite, snapshot count) and
   surfaced before landing, per repo policy.
3. **Cross-bundle identity**: object kind checks must never use
   `instanceof`; reproduce plugin-boundary behavior against `dist`.
4. **Representation creep**: step 1.1 should produce a one-page
   decision note before code; a wrong slot/version representation is
   expensive to unwind after Phase 2–3 build on it.
5. **Concurrent WIP**: the state-event union and effects-cache keys
   are actively evolving (inference-tx track); coordinate the new
   axes with whatever has landed by start time.

## Open items

- Serializer option spelling (Phase 3 bikeshed — decide at
  implementation; lean `objects: 'record' | 'reject'`).
- Nothing else: ratification and B6 were resolved 2026-08-13 (see the
  gate note at the top).
