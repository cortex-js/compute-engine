# Assumptions are facts, not type writes: `facts.type` merged at read time

Status: RULED 2026-08-30, implementation IN PROGRESS (phase 1 of three,
see §5). Revs 1–5 were dual-reviewed (25 + 24 + 23 + 25 + 30 findings,
all logged in `docs/scratch/ASSUMPTIONS_AS_FACTS_TYPE_SPEC_REVIEW.md`);
rev 6 folds in every rev-5 finding. The user chose phased implementation
with code review per phase over a sixth document round.

## 0. The principle

**An assumption is a FACT about the current scope's state. A declaration
is a CONTRACT. Facts never enter contracts.** (User, 2026-08-30: "an
assumption should be lighter weight than a declaration … the assumption
could be changed right after the definition of `f` and it would be
incorrect if locked down.") Everything below derives from it: a
definition's type, signature, and stored value are contracts and may be
built only from other contracts (declared types, stored values); a READ
in the current state may use the facts and heals when they change; a
WRITE never sees them.

- **Ruling A (RULED 2026-08-30 on the corrected premise) — an
  assumption-derived proof is never visible through an assigned
  function.** TODAY, `declare p real; assume(p > 3); f := x ↦ (p > 2)`
  stores `(x) -> true` and `f(0).type` is `true` (measured; the earlier
  revisions wrongly claimed `boolean`). Under the principle that is the
  bug: `f`'s signature is a contract, and the next statement can retract
  the fact it was built from. After: `f` stores `(x) -> boolean` and
  `f(0)` types `boolean` even while the assumption holds; the proof
  stays visible in every DIRECT read — `(p > 2).type` is `true`,
  `If(p > 2, a, b)` compiled inline drops the dead arm. The same
  principle settles the value channel (`assume(x = 5)` never installs
  `5` in `x`'s definition — the overlay) and the sign channel
  (`assume(q > 0); r := t ↦ √q` stores `-> number`).
- **Ruling B — the handler-side boundaries of the boolean-value-types
  round (`docs/plans/2026-08-29-boolean-value-types.md` §3.2) are
  RE-RULED for the assumption case:** a stored type is derived from the
  declaration channel only. Counter-example the 08-29 ruling missed:
  `assume(g > 2); f := x ↦ (g > 1)` stores `(x) -> true` and keeps it
  after `forget(g)` (measured). For a DECLARED range the handler-side
  survival stands.

Design for the ROADMAP item "Assumptions bake into stored types". Follows
`docs/plans/2026-08-28-open-bounds-in-ranged-types.md` §3.4 (the type is
"the single channel for symbol-self bounds"): this design keeps that
property for READS and removes it for WRITES. Every "measured" claim was
run on the tree on 2026-08-29 with a `tsx` probe.

## 1. The problem

```
ce.declare('p', 'real');
ce.assume(ce.parse('p > 3'));      // TODAY: writes p's type := real<3<..>
ce.assign('f', ce.parse('x \\mapsto p > 2'));
//   f's stored signature: (x) -> true   — a proof over the assumption
ce.forget('p');                    // rewinds p's type to `real` ...
f.type                             // ... but f is still (x) -> true  (measured)
compile(If(f(0), a, b))            // drops the `b` arm on a retracted proof
```

An assumption is ephemeral: `ce.context.assumptions` is a per-scope
`ExpressionMap<boolean>` (copied on scope push, `engine-scope.ts:56`;
discarded on pop; cleared by `forget()`). But `assume()` also WRITES the
symbol's type through four helpers in `assume.ts` (`refineSymbolType`
:1244, `refineTypeIfUnknown` :1480, `recordAssumedType` :57,
`recordDeclaredByAssumption` :90), and a type write is durable.
`rewindAssumedTypeWrites` (`engine-assumptions.ts:439`) undoes the write
on the assumed symbol itself, using a `previousType` kept in the
provenance journal for that one purpose. Nothing tracks the types
DERIVED from the write and stored in OTHER definitions.

What heals today and what does not:

- **`_anyVersion`-keyed memos heal.** `cachedValue` has five call sites:
  `BoxedFunction`'s `_structural`, `_sgn`, `_type`, `_eagerSource`
  (`boxed-function.ts:936, 1362, 2013, 3210`; `get type` at :1967 also
  has a CALLER-side fast path on `_typeGeneration`, :1968/:1980/:2030)
  and the module-level `BARE_MAPPING_ELEMENT_TYPE` memo
  (`library/collections.ts:1478`); `BoxedFunction` also keeps a
  hand-rolled lazy-value memo (:2215+, gated on `_lazyValueEpoch`) that
  caches EVALUATION results. `assume`, `forget` and a dirty scope pop
  bump the axis (`engine-configuration-lifecycle.ts:147–157`).
- **Unversioned memos do not.** `BoxedDictionary._type`
  (`boxed-dictionary.ts:69`): `assume(q > 3); ce.box({a: q}).type` is
  `record{a: real<3<..>}` and stays so after `forget(q)` (measured).
- **Writes do not.** There are FOUR write surfaces: (1) the value
  definition's type — `set type` (`boxed-expression/boxed-value-definition.ts:719`)
  and `_setElementRefinement` (:760); (2) the value definition's
  CONSTRUCTOR, which assigns `this._type` directly (:296, :312, :316,
  :363–368) — the `declare(name, { value })` route: `declare q real;
  assume q > 3; declare M {type: list, value: [q]}` keeps
  `list<real<3<..>>` after `forget(q)` (measured); (3) the operator
  definition's signature — the per-instance `signature` descriptor
  (`boxed-operator-definition.ts:541–551`), written by `_update`'s lambda
  derivation (:1265–1300) and by `BoxedFunction._infer`
  (`boxed-function.ts:593`); `f := x ↦ …` creates an OPERATOR
  definition, so the example above goes through this surface; (4)
  `Expression._infer` (`types-expression.ts:2093`; three implementations,
  47 internal call sites). There are also 166 direct `def.value.type`
  readers.
- **Not only the TYPE channel leaks.** A handler reading a symbol's SIGN
  (`operandSgn` → `BoxedSymbol.sgn` → `getSignFromAssumptions`) or
  membership bakes the assumption the same way: `declare q number;
  assume q > 0; r := t ↦ √q` stores `(unknown) -> real` and keeps it
  after `forget(q)` (measured). And a write is not only its final value:
  the assignment path READS the incumbent effective type and BRANCHES on
  it before writing (`engine-declarations.ts:2686–2718`, `:2748–2755`).

The fix is not more rewinding. **An assumption must never enter a type by
a write.** It is a fact the type READ merges in, and a type WRITE — value
and decision — is made with the facts hidden.

## 2. Design

### 2.1 The fact store

`ce.context.assumptions` stays the source of truth, per scope, copied on
push. Changes:

- **Fact records.** The map value changes from `boolean` to an IMMUTABLE
  `ReadonlyArray` of frozen ASSERTION records, one per `assume()` call
  that inserted the key:
  `{ id: number; truth: boolean; subjects: ReadonlyArray<{ def: BoxedValueDefinition; part: 'self' | 're' | 'im' | 'abs' | 'arg' }> }`.
  The key stays the normalized fact expression. A list, because one map
  can hold the same normalized fact asserted against two definitions of
  one name (the inner scope's map is a copy of the outer's and the inner
  scope may re-declare `x`). `subjects` holds EVERY symbol the fact
  mentions, resolved to its WHOLE-VALUE definition at insertion — for a
  part-subject fact (`Re(s) > 1`) that is `s`'s definition with
  `part: 're'`, so the whole-value tier the fact proves (§2.3) has a
  target; for `x > y` two subjects, contributing nothing to either type.
  `id` is the assertion occurrence, so every consumer selects whole
  assertions: `forget(x)` removes the records whose `subjects` include a
  binding of that name (and the key when its list empties); `ask`/
  `verify` and the chain builder take a record's `truth` as-is and
  skip records with a `disposed` subject; the index partitions the type
  contribution by subject definition. Every addition, removal
  or replacement builds a NEW array and calls `set`; nothing mutates a
  list in place, so `ExpressionMap`'s shallow copy on push
  (`expression-map.ts:9–16`) is safe: an inner-scope `set` on an inherited
  key installs a fresh array in the inner map and leaves the parent's
  untouched (pinned). Consumers that destructure the value as a boolean
  are converted: `forget` (`engine-assumptions.ts:518`), `sets.ts:1553`,
  `solve-domain.ts:1374`, the scope-dump printer (`engine-scope.ts:235`,
  renders `truth`, subject names, parts), and `checkpoint.ts`
  (`ContextAssumptions.entries` :107/:318; `restoreAssumptions` :334
  re-`set`s the records — subject references included, since the journal
  restores definition records in place; pinned).
- **Assumed values.** `assume(x = v)` no longer installs `v` on the
  definition and no longer marks the NAME in `assumptionBindings`. Each
  eval context gains `assumedValues: Map<BoxedValueDefinition, Expression>`,
  copied on push and dropped on pop exactly like the fact map, snapshotted
  and restored by `checkpoint.ts` in place of `ContextAssumptions.bindings`
  (:322–325, :338–345, which are deleted), and cleared by `forget()`. The
  definition's value read (§2.2) consults the overlay first. This gives
  scoped equality facts the lifecycle they lack today (a flag or value on
  a possibly-OUTER definition cannot be undone by a pop). The
  RECORDING-TIME VALUE SHIELD stays: `withValueBlindRecording`
  (`assume.ts:203–224`) hides the stored values of USER-assigned subjects
  while a predicate is recorded — without it `w := 5; assume(w > 0)`
  folds to `5 > 0` and returns `'tautology'` recording nothing (measured:
  `ok` with the fact recorded today; `assume(5 > 0)` is `tautology`) —
  and its "treat as assigned: checked, never retyped" signal
  (`assume.ts:1008`) is what keeps the user-valued consistency check of
  §2.2. Rev 5 wrongly retired it: the fact bracket of §2.4 hides the
  FACT store and the OVERLAY, never a stored user value. It is
  re-implemented without the two `_setSymbolValue` writes per subject:
  a depth-scoped set of shielded definitions consulted by
  `_effectiveValue()` (§2.2) during recording, so recording no longer
  moves `_anyVersion` twice per symbol and is re-entrant.
- **`ExpressionMap` gains two O(1) members** on the published
  `ExpressionMapInterface` (`types-kernel-evaluation.ts:38`; CHANGELOG):
  `size` (the emptiness test — allocation-free, replacing
  `hasAssumptions()`'s iterator, `boxed-expression/constraint-subject.ts:504`)
  and `version` (monotone, bumped by every `set`/`delete`/`clear` — the
  cache key). Different quantities: after `forget()` clears the map,
  `size` is 0 and `version` is not; a copy on push has the parent's
  `size` and its own `version` 0. `restoreAssumptions` refills every
  context's map in place and bumps each map's `version`. The `assumedValues` overlay carries the same two members (phase 1 shipped
  it as a plain `Map` — native `size`, no `version` — since nothing reads a
  version on it yet; it gains one when the effective-value read is memoized).
- **Every fact or overlay mutation bumps `_anyVersion`.** `assume` and
  `forget` emit `{kind:'assumption'}` (any/semantic/world), checkpoint
  restore emits `{kind:'config'}` (all axes); the transaction of §2.5
  emits the `assumption` event on EVERY outcome, including a rollback,
  so no `_anyVersion`-keyed memo computed against staged facts survives.
  `map.version` is still needed on top: an in-place refill within one
  generation (checkpoint restore, the undo log) is invisible to the axis
  but not to the map. An exit-criterion assertion checks that no path
  mutates a fact map or the overlay without a state event.
- **The index rides with the map.** `getFactIndex` caches its index in a
  `WeakMap` keyed by the map object, validated by `(map.version,
  _anyVersion)` — today's single per-engine slot keyed on identity
  (`constraint-subject.ts:465–491`) would rebuild on every scope push,
  since `pushEvalContext` and `inScope` install a fresh copy
  (`engine-scope.ts:56/176`), and the Tycho-181 shape pushes per read.
  `getFactIndex` CAPTURES the real map and its version before entering
  suppression and passes it to `buildFactIndex` explicitly (§2.3): a
  builder that read through the accessor would index the empty map.
  Under suppression `getFactIndex` never runs at all — the accessor's
  empty map short-circuits at `size === 0` — so no suppression bit is
  needed in its key.
- **One accessor for QUERY readers.** `contextAssumptions(ce)` returns
  the map — or an EMPTY map while facts are suppressed (§2.4) — and is
  the route for every consumer that ASKS the store: `getFactIndex` and
  the `size` gate (`constraint-subject.ts:464/504`, behind six call sites:
  `relational-operator.ts:104`, `complex.ts:45`, `sets.ts:1353/1538`,
  `assume.ts:1566`), `ask()`/`verify()` (`engine-assumptions.ts:104`),
  the compound-subject scan (`sets.ts:1553`), `filterRootsByAssumptions`
  (`solve-domain.ts:1374`), and `getSignFromAssumptionsLegacy`
  (`assume.ts:1642`, also gated on the index's `inequalitySubjects`).
  Sites that COPY or SNAPSHOT the store are exempt and read
  `ce.context.assumptions` by identity: `pushEvalContext`
  (`engine-scope.ts:56`), `inScope` (:176), `snapshotAssumptions`/
  `restoreAssumptions` (`checkpoint.ts:315–345`) — a scope pushed or a
  checkpoint taken inside a suppressed window must inherit and record
  the real facts. The same split applies to `assumedValues`.

### 2.2 Two channels on the definition, one effective read

- **`declaredType`** — today's getter MINUS the fact merge:
  `reviseInferred(_type) ?? overlayFreeValue?.type ?? unknown` — i.e. the
  `_reviseInferredType` revision (`boxed-value-definition.ts:708`) and the
  value fallback (:657) stay (they are reads, never writes), but neither
  sees a fact or an assumed value while facts are suppressed. Provenance
  kinds `declared`, `auto-declared`, `inferred`, `value-derived` as today;
  the `assumed` kind and `previousType` retire.
- **`type`** (effective) — `declaredType` intersected with the
  contributions of the facts whose subject IS this definition, unless the
  definition holds a STORED value (then its type is the value's type,
  as today):

  ```
  type = storedValue !== undefined || contributions.length === 0
    ? declaredType
    : reduceType(intersection(declaredType, ...contributions))
  ```

  The index still records contributions for a stored-value definition
  (the consistency checks read them); only the getter ignores them.

**Where the merge lives.** In ONE place: `BoxedValueDefinition.type`,
keyed on `this`. `BoxedSymbol.type` (`boxed-symbol.ts:825`) delegates to
it in its value-definition arm and returns its other two arms as they
are. The 166 direct `def.value.type` readers keep seeing what they see
today; `declaredType` is the opt-in un-merged read for the write path,
provenance and the Epsil hover.

**Values — two accessors, like the type channel.** `storedValue` is the
overlay-free read (the write path, provenance, `forget`, the
`declaredType` fallback, the `hasValue` gates such as `assumeEquality`'s
own branch at `assume.ts:466` and the assignment-path guards in
`engine-declarations.ts`); `value` is the effective read. All effective
reads — the public `value` getter, the `type` getter's fallback,
`_reviseInferredType`, the constructor's four `this._value` reads
(:304–316) — go through one private accessor `_effectiveValue()`: the
`assumedValues` overlay entry for this definition if present (and facts
are not suppressed), else the stored value unless the recording-time
shield (§2.1) hides it. A definition is USER-VALUED when `storedValue`
is defined (`assign()`, `declare(name, {value})`, a library constant); an
assumption-installed value lives only in the overlay. §5 audits every
value reader (`def.value.value`, `hasValue`, constant+value checks) as
stored or effective, in the same shape as the type-reader audit.

**The operator.** The intersection TYPE NODE reduced once by `reduceType`
(`common/type/reduce.ts`) — NOT the meet: `narrow('real', '!2')`
(`common/type/subtype.ts:2297`) answers `never`, while
`reduceType(real & !2)` keeps `real & !2` and `reduceType(real<0..> & !0)`
gives `real<0<..>` (measured). `isEmptyType` is applied to the REDUCED
node (on the unreduced node it answers `false` for three of the four
§2.5 shapes — measured).

**The identity rule.** A fact contributes to the definition recorded as
its `subject` and to no other; the fact index (`constraint-subject.ts:220`)
partitions its `type` contribution by definition (`typeFor(def)`), and a
record whose subject is `disposed` (a new flag set by
`BoxedValueDefinition.dispose()`, :772 — today nothing marks disposal;
`_deadScope` is debug-only) contributes nothing and is dropped by
`restoreAssumptions`. The record's reference is strong; it dies with its
map. The rule declines both scope directions — `declare x real; assume x
> 3; pushScope; declare x string; x.type` is `string` (a name-keyed merge
would answer `never`, measured) and a held outer `x` read inside is
`real<3<..>` — and it must SURVIVE today's answers for two definitions of
one name in one map: `declare x real; assume x > 3; pushScope; declare x
integer; assume x < 10` gives inner `x` `integer<..9>` and held outer `x`
`real<3<..>` today (each write landed on its own definition; measured);
a per-name field would break it. The rule governs `facts.type` ONLY: the
bounds, sign, membership and chain channels stay NAME-keyed in this
round, so `x.isPositive` on the shadowed `x: string` above stays `true`
(measured; the standing divergence documented at `boxed-symbol.ts:944–951`,
rewritten to say so; a `@fixme`-marked pin; §6 Q1, §7).

**User-valued definitions.** A definition holding a stored value keeps
today's VALUE-based consistency check on `assume` (`assign v 5; assume v
> 10` is `'contradiction'`; `assume v > 3` is `ok`; measured) and facts do
NOT merge into its type (`v.type` stays `integer`). An overlay value does
not block the merge (`assume z = 5` on an undeclared `z` answers
`integer` by merge, §2.5).

**Assignment under a fact — two phases.** `assign()` first VALIDATES the
proposed value with facts LIVE (the fact-level value check `assume()`
uses; a failure throws and leaves value and type unchanged), then
DERIVES and writes inside the bracket (§2.4). `BoxedSymbol.set value`
(`boxed-symbol.ts:720`) and `set type` (:846) have the same two-phase
shape with a first act of their own: today each begins with
`ce.forget(this._id)` — a type or value write RETRACTS the facts about
that symbol — and that stays (`assume(x > 3); x.type = 'real'; ask(x >
3)` finds nothing today and after); the `forget()` runs OUTSIDE the
bracket as a deliberate state mutation, then the derive-and-write phase
runs inside. `declare v real; assume v >
3; assign v 1` throws today (measured) and keeps throwing; `assign u 5;
assume u > 3; assign u 1` is silently `ok` today (measured) and throws
after — the one check this design makes STRICTER (§4).

**Cost.** One `reduceType` behind `size === 0`, over an index cached on
`(_anyVersion, map identity, map.version, suppression bit)`. The identity
test is a reference comparison; no scope walk. Budget and counters: §5.

### 2.3 What a fact contributes

Built by `buildFactIndex(map)` from the map `getFactIndex` captured
BEFORE suppression (§2.1), using the SAME producers `assume.ts` uses
today. **Index construction runs with facts suppressed** (§2.4): the
producers read operand types and values,
and after this design every `.type` read goes through the effective
type, which calls `getFactIndex` — a cycle that today cannot occur. A
producer derives its contribution from declarations and literals only;
pinned with `assume(x ∈ Range(a, b))` for declared `a`, `b`. Contributions
for one definition are the operands of one intersection node reduced
once; the outward-rounding demotion (open-bounds doc §3.4) is applied
per fact before the node is built, so the result is order-independent
(pinned in two orders).

| Fact (normalized)                              | Contribution                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `x > k`, `x ≥ k`, `x < k`, `x ≤ k`, `k` a number literal | `rangeTypeForComparison` (`assume.ts:602`): open marker when strict and machine-exact, outward rounding + demotion to closed otherwise (`assume(x > 1/3)` already gives `real<0.33333333333333326..>` today) |
| conjunction `a < x < b`                        | both ranges in the node                                             |
| `x ≠ k`, `k` a machine number                  | `!k` (new: today `NotEqual` writes no type; `assume(y ≠ 2)` leaves `y: real`, measured) |
| `x ≠ v`, `v` not a machine number              | none (fact only)                                                    |
| `x > y`, two symbols                           | none for either (the `geEdges` chain, unchanged)                    |
| `x ∈ S`, `S` a primitive number set            | `domainToType(S)` (`assume.ts:1126`)                                |
| `x ∈ PositiveIntegers` etc.                    | tier + bound range (`assume.ts:269–285`)                            |
| `x ∈ Range(lo, hi)` / `Interval(...)`          | `integer<lo..hi>` / `real<lo..hi>`, `Open` markers honored (`assume.ts:1146–1191`) |
| `x ∈ SetMinus(S, T)`                           | type of `S` and the `!k` exclusions                                 |
| `x ∈ S`, `S` a user-defined finite literal set | none in this round (§7)                                             |
| `x ∈ S`, `S` inert                             | none                                                                |
| `x = v`, single root                           | the promoted tier of `v` (`inferTypeFromValue`'s ladder: `integer` for `5`) — identical to what is written today; the value goes to the overlay |
| `Equal(e, 0)`, not a single-root equation in one symbol (`x^2 = 4`: `ok` today, no value, `x: real`) | none; no overlay value; subjects = the mentioned symbols |
| part-subject facts (`Re(s) > 1`, `Abs(z) < 2`) | to the WHOLE-VALUE subject: `number`, or `complex` when a finite `Abs` upper bound proves finiteness (`assume.ts:765–771`); part BOUNDS stay in the index |
| `NotElement`, boolean facts, `Or`/`Not`/…      | none                                                                |

### 2.4 `_withoutFacts`: facts hidden at the source, keyed into memos

`_withoutFacts(thunk)` increments `ce._factSuppressionDepth` (the shape
of `_ephemeralWriteDepth`, `engine-configuration-lifecycle.ts:184`),
restored in a `finally`; re-entrant; synchronous only (a promise-returning
thunk throws); `assume`/`forget` inside it throw.

- **Hidden at the source.** While the depth is non-zero,
  `contextAssumptions(ce)` returns an empty map and the `assumedValues`
  overlay reads as empty, so EVERY query reader (§2.1) and
  `_effectiveValue()` answer as if no assumption held. The `√q` example
  of §1 stores `-> number`.
- **Keyed into memos — the axis does NOT move.** Rev 4 proposed bumping
  `_anyVersion` on entry and exit. That is wrong (a bump inside a scope
  makes its pop permanently dirty — Tycho item 181, `engine-scope.ts:139–157`;
  `cachedValue` stamps before running, `cache.ts:165–172`; the
  `inference`/`scratch` zero masks; the test-time purity guard,
  `operand-descriptor.ts:352–382`). Instead the engine exposes ONE
  composite generation, `ce._cacheGeneration()` =
  `_anyVersion * 2 + (depth > 0 ? 1 : 0)`, and EVERY memo keys on it —
  mixed by the CALLER, not inside `cachedValue`, because the callers own
  fast paths that never reach the helper: `BoxedFunction.get type`
  compares `_typeGeneration` against a generation it computes itself
  (`boxed-function.ts:1968/:1980/:2030`) and would otherwise serve the
  live, fact-bearing type inside a window. Inventory (§5 step 3, an
  artifact): every memo whose computation can reach the fact store or
  the overlay — the five `cachedValue` sites, the `_typeGeneration` fast
  path, the lazy-value evaluate memo, `BoxedDictionary._type` (gains the
  composite key), `BoxedObject._type` (`boxed-object.ts:177`, `readonly`;
  classify with the reason it cannot hold a fact) — module-level and
  `WeakMap`-held memos included. Two rules make the composite sound:
  (1) a `CachedValue` entry carries TWO cells, live and suppressed, so a
  bracketed read never evicts the live value and the cost on an
  assumption-free engine is one extra derivation per write of nodes
  read on both sides, not a subtree re-derivation on every crossing —
  pinned by a `CE_CACHE_STATS` exit criterion on the `type` cache's
  hit ratio for a write-heavy assumption-free workload; (2) the
  in-flight re-entrancy terminator (`cache.ts:78–107`: a re-entrant read
  during computation is served the provisional value) compares only the
  `_anyVersion` half of the key while `inFlight > 0`, so a recursive
  signature derivation that crosses a window boundary is still served
  its provisional value and terminates as today — pinned by a named test
  with a self-recursive and a mutually recursive definition whose
  derivation crosses `_withoutFacts`.
- **Bracketing the whole write ROUTINE.** A write is its value AND the
  decisions that chose it: the bracket encloses the assignment's
  derive-and-write phase (after the live validation of §2.2; the
  incumbent reads and `isSubtype` branches at `engine-declarations.ts:2686–2718`
  and the `_setElementRefinement` decision at :2748–2755 included), the
  value-definition CONSTRUCTOR body, `_update`'s lambda derivation, each
  `_infer` implementation's whole body (incumbent read `boxed-symbol.ts:482`,
  `narrow`/`widen` :487–495, no-op comparison :504), and the Epsil static
  pre-pass as a whole (`ce._staticTypeCheckDepth` already brackets it;
  its five sinks — `_setElementRefinement` :426/:492, `_infer` :467/:494,
  the `evidence` writes :412/:468/:502 — are the reason). An incumbent
  read used to decide a write reads `declaredType`.
- **The write API.** Internal thunk-only entry points: `_setType(() =>
  …)`, `_setSignature(() => …)`, `_infer(() => …, mode)`; each runs its
  thunk and its own body inside the bracket. The PUBLIC accessors `type`
  and `signature` (`types-definitions.ts:1703`, `:2265`; `signature`'s
  setter is an untyped per-instance descriptor) keep their `Type`-valued
  shape and delegate inside the bracket, with a runtime guard that throws
  on a function value.
- **What this guarantees.** The value AND decision of every write in the
  inventory are fact-free. It is not machine-checkable: a thunk can return
  a `Type`-typed variable computed under facts before the bracket
  (`engine-declarations.ts:2718`'s `adopted`), and a routine outside the
  inventory can write through the public accessor. Enforcement is the
  API shape, the AUDIT ARTIFACT (every write routine and the variables
  its thunk closes over — `docs/plans/…-assumptions-audit.md`, an exit
  criterion), and the regression test of §5 (coverage for the routines it
  exercises, not a proof over unexecuted branches).
- **Dispatch reads are not writes — but suppression is dynamic.**
  `receiverType` (`engine-protocols.ts:3945`) and `solveArm`
  (`generic-instantiation.ts:127`) see assumptions when reached from a
  live read; reached from INSIDE a bracketed write (a generic signature
  derived in `_update`, the Epsil pre-pass) they inherit suppression, by
  design — their result feeds a stored type. Pinned: a generic signature
  derived under `assume(x > 3)` and after `forget`.
  `storedCellType`, `functionLiteralSignatureType`, `promotedValueType`,
  `inferTypeFromValue`/`widenAssignedType` are unchanged as functions and
  run inside the bracket at the write.

### 2.5 `assume()` stops writing types

The four write helpers retire. What remains:

- **The transaction**, per CONJUNCT, replacing `assumeConjunction`'s
  child-scope trial-and-replay (`assume.ts:309–337`, deleted). One
  transaction-local registry `name → definition` resolves each declared
  subject once and gives each undeclared name ONE provisional definition
  (type `unknown`, provenance `auto-declared`, not yet published). For
  each conjunct in order: (0) resolve its subjects through the registry,
  then decide `'not-a-predicate'`/`'tautology'` against the store AS IT
  STANDS (earlier conjuncts included; entailment is checked per subject
  definition, so an inner-scope `assume(x > 3)` against an inherited
  outer `x > 3` record is NOT a tautology — pinned); (1) derive the
  contributions; (2) `set` the fact records and stage the equality value
  in the overlay against an UNDO LOG with one entry kind per store —
  for a fact key its prior array (a `set` can replace), for an overlay
  definition its prior presence and value — and record which conjunct
  first introduced each provisional definition; (3) rebuild the index
  (suppressed, §2.3) and run
  EVERY consistency check: `isEmptyType` on the reduced effective type of
  each mentioned definition; the value check for user-valued
  definitions; value-vs-value among staged and active overlay values
  (`And(x = 1, x = 2)` is a contradiction; the comparison is `isEqual`);
  value-vs-fact for overlay values (`x = 1` with `x > 3`); the `geEdges`
  chain (`a > b` then `b > a`); equality-vs-declared-range (`declare w
  integer<0..3>; assume w = 5`). Per-conjunct results compose exactly as
  `assumeConjunctionInner` composes them today (`assume.ts:338–360`):
  `'contradiction'` and `'internal-error'` short-circuit; otherwise
  `'not-a-predicate'` if any conjunct was one, else `'ok'` if any
  conjunct was `ok`, else `'tautology'` (with `x > 3` in force,
  `assume(And(x > 1, x > 2))` is `tautology` today — measured); a
  tautological conjunct is skipped and stages nothing; the empty
  conjunction is `tautology`. `'contradiction'` restores BOTH logs (all
  conjuncts) and discards every provisional definition in a `finally`,
  bumps `version`, emits the `assumption` event, answers;
  `'internal-error'` (today a returned value on the conjunction path,
  `assume.ts:352`) restores the same way and is RETURNED as today, while
  an unexpected exception restores and RETHROWS (today logged and
  rethrown at `engine-assumptions.ts:421–424`); `'not-a-predicate'`
  COMMITS the conjuncts applied so far (today's behavior:
  `assume(And(x > 3, Foo(x)))` returns `'not-a-predicate'` with `x > 3`
  in force — measured) and publishes ONLY the provisional definitions
  first introduced by a committed conjunct, discarding those the
  rejected conjunct introduced (`And(x > 3, Foo(y))` publishes `x`, not
  `y`); success publishes them all. Every outcome ends with the
  `assumption` state event (§2.1). The new shapes are decided on the reduced
  node (`real<3..3> & !3`, `real<3<..<3>`, `real<3<..> & real<..3>`,
  `integer & real<0.2..0.8>` all empty — measured). Pre-existing gap,
  unchanged: `assume(s ≠ √2); assume(s = √2)` is `ok` (§7).
- **Auto-declaration** is the provisional definition. `assume(n ∈
  Integers)` gives `n.type` `integer` by merge and `unknown` after
  `forget(n)` — also today's measured answer; the change is the
  mechanism. The binding survives `forget()` and a later same-scope
  `declare` throws "already declared", as today; pinned.
- **Equalities** write no type and install no value on the definition;
  the value goes to the overlay (§2.1), `x.type` answers the promoted
  tier by merge while the fact holds and `unknown` after `forget`, as
  today. `declare(lhs, { value })` (`assume.ts:471/483/541/553`) is
  deleted.
- **Scopes.** Today `declare u real; pushScope; assume u > 3` creates a
  SHADOW binding of `u` (`refineSymbolType` shadows before writing). With
  no write there is no shadow: the outer definition is the record's
  subject and is read with the inner map's facts; the overlay gives an
  inner `assume(u = 5)` a value that vanishes on pop (today the pop
  rewind also clears it: `u.value` is `undefined` after — measured).
  `forget(name)` drops every overlay entry whose definition is a binding
  of that NAME reachable in the current context — matching what the fact
  loop removes (`engine-assumptions.ts:518`) — pinned for both the inner
  and a held outer read. The `forget()` reach comment (:497–500) is
  rewritten. Both nested
  orders are pinned (§4).
- **Checkpoint/rollback.** Nothing to journal on the type axis;
  `snapshotAssumptions`/`restoreAssumptions` carry the fact records and
  the overlay (replacing `bindings`), bump each map's `version`, and drop
  records whose subject is `disposed`. Pins: `checkpoint(); assume(x >
  3); restore()` leaves `x.type` unchanged; `checkpoint(); assume(x = 5);
  restore(); assign x 7; forget()` keeps the assigned value; `pushScope;
  assume(x > 3) on an inner x; checkpoint; popScope; restore` does not
  resurrect the fact against the disposed inner definition.
- Retired: `rewindAssumedTypeWrites`; `TypeProvenanceEntry.previousType`
  and the `'assumed'` kind (`types-definitions.ts:1492–1552`,
  `types-expression.ts:134`) and `InferenceWriteEvent.kind`'s `'assumed'`
  (`types-engine.ts:216–218`; sole emitter `assume.ts:72`) — removed
  outright, listed as breaking; `assumptionBindings` (replaced by the
  overlay; `_valueBlindNames` becomes the depth-scoped shield set of
  §2.1); the dead imports at `operand-descriptor.ts:24–25`.

### 2.6 What does not change

- The fact index and its query consumers (part-subject bounds,
  `compare.ts`, `ask()`, `relational-operator.ts`, `complex.ts`): unchanged
  for live reads; hidden under `_withoutFacts`.
- `receiverType`, `solveArm`, dispatch: see effective types as today.
- The kernel, the descriptor shape, the `provably*` tables.
- The version axes: none moves; the suppression bit rides in memo keys.
- The `sgn`/bounds/membership channels stay name-keyed (§6 Q1, §7).

## 3. Soundness argument (conditional)

Provided every write routine in the inventory runs inside `_withoutFacts`
and no thunk closes over a fact-derived variable computed outside it (the
audited class), a written type `T` is produced AND CHOSEN with the fact
store and the value overlay empty, so `T` is a function of declarations
and stored values only and holds whenever those hold. A declaration is
retracted by scope exit (which destroys every binding of the scope,
`T`'s included) or by a redeclaration — a NEW binding; a stored type that
mentioned the old one is not healed, exactly as today. An effective type
is a function of the fact store and the definition identity recorded
with each fact, recomputed on every mutation (`version`) and generation
(`_anyVersion`); a memo computed inside a window is keyed apart from the
live epoch. The two channels meet only in the intersection of a read.

The claim is bounded to the TYPE channel given the stored value: a VALUE
shaped by a fact BEFORE the write — `assume(x > 0); g := simplify(√(x²))`
stores `x` where a fact-free engine stores `|x|` — stays as it is, and
the type derived from it is a faithful, fact-free function of that
value. Recorded in §7.

Dependency stamps (§7) are rejected on cost: a stamp system needs a
dependency record on every stored type and a re-derivation on every
assumption change, and is only as complete as its record — it would not
remove the audit.

## 4. Behavior changes (every row measured on the current tree)

`ce.box(…)` rows are EXPRESSION reads (memo); `:=` rows are STORED
definitions. Symbols are declared `real` unless stated.

| Input                                                                 | Today                              | After                                    |
| --------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| `assume x > 4; x.type`                                                | `real<4<..>`                       | `real<4<..>`                             |
| `assume x > 4; forget x; x.type`                                      | `real`                             | `real`                                   |
| `assume x > 4; f := t ↦ (x > 2); f.type`                              | `(unknown) -> true`                | `(unknown) -> boolean` (Ruling A/B)      |
| … then `forget x; f.type`                                             | `(unknown) -> true` (STALE)        | `(unknown) -> boolean`                   |
| `declare p real<3<..>; g := t ↦ (p > 2); g.type`                      | `(unknown) -> true`                | `(unknown) -> true`                      |
| `assume x > 4; (x > 2).type`                                          | `true`                             | `true`                                   |
| `assume y ≠ 2; y.type`                                                | `real`                             | `real & !2`                              |
| `assume z = 5` (undeclared): `z.type` / after `forget`                | `integer` / `unknown`              | `integer` / `unknown`                    |
| `assign v 5; assume v > 10`                                           | `contradiction`                    | `contradiction`                          |
| `assign v 5; assume v > 3; v.type`                                    | `integer`                          | `integer`                                |
| `assign u 5; assume u > 3; assign u 1`                                | `ok` (unchecked)                   | throws                                   |
| `assume v > 3; assign v 1`                                            | throws                             | throws                                   |
| `assume q > 3; ce.box({a: q}).type` while / after `forget`            | `record{a: real<3<..>}` / same (STALE) | `record{a: real<3<..>}` / `record{a: real}` |
| `assume q > 3; d := {a: q}; d.type` while / after                     | `record{a: real<3<..>}` / same     | `record{a: real}` / `record{a: real}`    |
| `declare L list; assume r > 3; L := [r]; L.type` while / after        | `list<real<3<..>>` / same (STALE)  | `list<real>` / `list<real>`              |
| `assume q > 3; declare M {type: list, value: [q]}; forget q; M.type`  | `list<real<3<..>>` (STALE)         | `list<real>`                             |
| `assume q > 3; declare c {value: q, isConstant}; forget q; c.type`    | `real<3<..>` (STALE)               | `real`                                   |
| `declare q number; assume q > 0; r := t ↦ √q; forget q; r.type`       | `(unknown) -> real` (STALE)        | `(unknown) -> number`                    |
| `assume n ∈ Integers` (undeclared): `n.type` / after `forget`         | `integer` / `unknown`              | `integer` / `unknown`                    |
| `pushScope; assume u > 3` — inner `u.type`                            | `real<3<..>` (shadow binding)      | `real<3<..>` (no shadow)                 |
| … `w := t ↦ (u > 1)` inner; `w.type`; `popScope`                      | `-> true`; `w` gone                | `-> boolean`; `w` gone                   |
| `pushScope; assume u = 5; popScope; u.value`                          | `undefined`                        | `undefined` (overlay dropped)            |
| `pushScope; assume x > 4; OUTER h := t ↦ (x > 2); popScope; h.type`   | `(unknown) -> true` (STALE)        | `(unknown) -> boolean`                   |
| `assume x > 3; pushScope; declare x string; x.type`                   | `string`                           | `string`                                 |
| … same, `x.isPositive`                                                | `true`                             | `true` (`@fixme`; name-keyed; §7)        |
| `assume x > 3; pushScope; declare x integer; assume x < 10; x.type` / held outer | `integer<..9>` / `real<3<..>` | `integer<..9>` / `real<3<..>`      |
| … same, then `assume x > 3` in the inner scope                        | `tautology`                        | `ok` (different subject) — BREAKING, §5 step 7 |
| `assume(And(p > 0, p < -5))`                                          | `contradiction`, `p.type real`     | `contradiction`, `p.type real`           |
| `assume(And(x > 3, Foo(x)))`                                          | `not-a-predicate`, `x.type real<3<..>` | same (partial application kept)      |
| `assume(And(x = 1, x = 2))`                                           | `contradiction`                    | `contradiction`                          |
| `assume x = 1; assume x = 2`                                          | `contradiction`, `x.value` 1       | `contradiction`, overlay value 1 kept    |
| `assume(x^2 = 4)`                                                     | `ok`, no value, `x: real`          | same                                     |
| `w := 5; assume(w > 0)` / `w := -2; assume(w > 0)`                    | `ok` (fact recorded) / `contradiction` | same (recording shield kept)         |
| `assume x > 3; x.type = 'real'; ask(x > 3)`                           | nothing (write retracts)           | nothing                                  |
| `assume(And(x > 3, Foo(y)))` (y undeclared)                           | `not-a-predicate`; `y` declared?   | `not-a-predicate`; `x` published, `y` not |
| `assume x > 3; assume x > 1`                                          | `tautology`                        | `tautology`                              |
| `assume w > 3; declare w integer`                                     | throws "already declared"          | throws                                   |
| `assume s ≠ √2; assume s = √2`                                        | `ok` (gap)                         | `ok` (§7)                                |
| `lookupDefinition(x).value.type` after `assume x > 4`                 | `real<4<..>`                       | `real<4<..>` (`.declaredType`: `real`)   |

## 5. Implementation plan and exit criteria

1. `ExpressionMap`: `size`, `version`; immutable fact-record arrays;
   `assumedValues` overlay per context (push copy, pop drop, checkpoint
   snapshot/restore replacing `bindings`); `contextAssumptions(ce)` with
   the query/copy split of §2.1; `getFactIndex` keyed on `version` and
   the suppression bit; `disposed` flag in `dispose()`.
2. `constraint-subject.ts`: `typeFor(def)` from the moved producers under
   suppression; part-subject targets; identity rule. One pin per §2.3
   row, the two-order pin, the three identity pins.
3. `_factSuppressionDepth`; `ce._cacheGeneration()` composed by every
   memo CALLER (the five `cachedValue` sites, `_typeGeneration`, the
   lazy-value memo, `BoxedDictionary._type`); two-cell `CachedValue`;
   the in-flight half-key rule; source-level hiding; `_effectiveValue()`
   with `storedValue`/`value`; the recording-time shield re-implemented
   on the overlay path; the MEMO INVENTORY of §2.4 (every memo that can
   reach facts or the overlay, module-level and `WeakMap` included, with
   key and classification) as an artifact. `BoxedValueDefinition`:
   `declaredType` formula; `type` merges (single site, stored-value
   guard); `BoxedSymbol.type` delegates.
4. Write routines bracketed and converted to the internal thunk API:
   `_setType`/`_setSignature`/`_infer` (three implementations, 47 call
   sites), the constructor, `_setElementRefinement` (callers
   `engine-declarations.ts:2755`, `static-diagnostics.ts:426/492`), the
   assign derive-and-write phase (after the live validation),
   `BoxedSymbol.set value`/`set type` (forget outside, derive inside),
   `_update`, the Epsil pre-pass; public accessors delegate with the
   function guard.
   The AUDIT ARTIFACT (write routines × closed-over variables; start:
   `engine-declarations.ts:2718` `adopted`).
5. `assume.ts`: delete the four writers, the equality type writes,
   `declare(lhs, {value})`, the conjunction trial; re-implement the
   recording shield on the overlay path; the per-conjunct transaction. `engine-assumptions.ts`:
   delete `rewindAssumedTypeWrites`; rewrite the `forget()` comment.
   Delete `previousType`/`'assumed'` at the three sites; update readers
   `engine-declarations.ts:2686`, `boxed-expression/utils.ts:1252–1277`,
   `epsil/signature-notes.ts:192–218`; rewrite `boxed-symbol.ts:944–951`.
6. Reader audits: the 166 `def.value.type` / `lookupDefinition` type
   readers (write-path/provenance/hover → `declaredType`) and every value
   reader (`def.value.value`, `hasValue`, constant+value checks →
   `storedValue` or `value`).
7. Public surface: `api.md` regenerated; CHANGELOG breaking list:
   `ExpressionMapInterface.size/version`, fact record values, the two
   accessor guards, removal of `TypeProvenanceEntry.previousType` and the
   `'assumed'` kind (both copies) and of `InferenceWriteEvent.kind`'s
   `'assumed'`, removal of `assumptionBindings` and
   `ContextAssumptions.bindings`, and the `AssumeResult` change for an
   inner-scope re-assumption of an inherited fact (`tautology` → `ok`,
   §4).
8. Exit criteria: zero `'assumed'`, `previousType`,
   `rewindAssumedTypeWrites`, `assumptionBindings` in `src/`; typecheck
   clean; the audit artifact and the cached-field inventory complete; the
   regression test — for every write routine in the inventory, store
   once under `assume(p > 3)` and once under a bare `declare`, assert
   identical stored types, then a `forget` round-trip, repeated with a
   SIGN fact and an EQUALITY fact; the §4 table as pins (the `isPositive`
   row as a `@fixme` pin); the assumption suites — `assumptions`,
   `ranged-declaration-sign`, `open-bounds`, `comparison-assumptions-regressions`,
   `inverse-trig-domain-type`, `scope`, `inference-provenance`,
   `inference-rollback`, `checkpoint-differential` (check the reported
   suite count equals 9: a jest path matching no file is silently
   dropped) — green, with the pins that MUST change listed: the §4 rows
   and `inference-provenance.test.ts:99`; the full suite with the type-
   handler purity guard behavior unchanged; performance — (a)
   `benchmarks/overload-resolution.ts` and `benchmarks/numeric-evaluation.ts`
   within ±2% on assumption-free cases, (b) a scoped collection probe
   (a `Comprehension` count or lazy `Filter` emptiness walk over a list
   of symbols — the Tycho-181 shape) within ±2%, (c) counter criteria
   independent of wall-clock: the number of clean scope pops and of
   `_anyVersion` bumps for one representative canonical box unchanged
   (two new counters behind the existing `CE_CACHE_STATS` gate,
   `src/common/cache-stats.ts`, incremented in `discardEvalContext`'s
   clean branch and in the `any` advance), (d) an assumption-bearing
   canonicalization (`assume(x > 3)` in force) at most 1.5× its
   assumption-free twin, (e) the scoped collection probe of (b) WITH an
   assumption in force within 1.5× of the same probe after `forget`,
   (f) the `type` cache hit ratio on a write-heavy assumption-free
   workload not below baseline by more than 5 points; the invariant
   assertion of §2.1 (no fact/overlay mutation without a state event);
   full-suite blast radius measured.

## 6. Open questions for the author

- **Q1 — the name-keyed sign/bounds/membership channels.** The identity
  rule fixes the type channel; the others keep answering by name, so
  `x.type` and `x.isPositive` can disagree on a shadowed name (today's
  behavior, pinned `@fixme`). Fold them onto the definition now or next
  round? Recommendation: next.

## 7. Out of scope

- Part-subject BOUNDS migrating to a type (unchanged ruling); the
  whole-value tier they prove does move.
- Dependency stamps on stored types (§3).
- The name-keyed sign/bounds/membership channels (Q1).
- `assume(s ≠ √2); assume(s = √2)`; a value-union type for
  `x ∈ <finite literal set>`.
- Healing a stored type after a REDECLARATION of a symbol it mentioned.
- A stored VALUE shaped by a fact before the write (§3): only the type
  derived from it is fact-free.
- Any change to what a DECLARED range flows into at a write.
