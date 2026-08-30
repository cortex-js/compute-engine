# Memo inventory: which caches see the assumptions

Companion artifact to
[`2026-08-29-assumptions-as-facts-type.md`](./2026-08-29-assumptions-as-facts-type.md)
§2.4 and §5 step 3.

## Why this list exists

The engine can HIDE its assumptions from a computation. While
`ce._factSuppressionDepth` is above zero, the assumption store and the
assumed-value overlay read as empty, so a computation bracketed that way
derives its answer as if nothing were assumed. That is how a value on its way
into a stored type is kept free of a fact that the next statement can retract.

A cache turns that into a hazard. The same node has TWO answers — one with the
facts in force, one without — and a memo that cannot tell them apart will serve
one for the other. The window is short, but a single wrong hit installs a
fact-bearing type in a place that never heals.

The rule: **every memo whose computation can reach the fact store or the
assumed-value overlay keys on `ce._cacheGeneration()`**, which is
`_anyVersion * 2 + (_factsHidden() ? 1 : 0)` — the `any` invalidation axis in
the high bits, the suppression state in the low bit. The axis itself does not
move when the window opens or closes: a version bump inside a scope makes the
pop of that scope permanently dirty, so the state rides in the key instead.

**A window that hides NOTHING is not a second side.** `ce._factsHidden()` is
true only when the depth is above zero AND the current context actually holds
an assumption or an assumed value. With an empty store every reader answers the
same on both sides, so the window is observationally a no-op, and an engine
that never assumes anything never splits an entry. That is not only a saving.
Splitting an assumption-free entry leaves the LIVE cell of a node cold whenever
a write was the first thing to read it, and a cold cell has no previous value
for a self-referential derivation to bottom out on — measured as a stack
overflow in the compiler once every assignment opened a window. Every memo that
carries the state asks `_factsHidden()` rather than reading the depth, so they
all agree on when the two sides differ. A fact MUTATION is still refused on the
raw depth: `assume()` inside a bracket is a program error whether or not
anything is assumed yet.

A `CachedValue` entry (`boxed-expression/cache.ts`) carries one CELL per side,
selected by the parity of the key, so a read made inside a window does not
evict the live answer. The two cells meet only in the in-flight window, where
the keys are compared on their axis half alone so that a recursion which
crosses the boundary still terminates.

This document lists every memo in `src/` and says, for each, whether its
computation can reach a fact. It is the list to check when a new cache is
added.

## 1. Memos that observe the suppression state

These key on `ce._cacheGeneration()` (or, where the entry has no generation to
carry the bit in, on an explicit flag).

| Location | What it caches | Key before | Key after |
| --- | --- | --- | --- |
| `boxed-expression/cache.ts` — `cachedValue()` / `CachedValue<T>` | the shared memo helper itself | one cell, caller-supplied `generation` | two cells, selected by the parity of the caller-supplied composite generation; `generation: undefined` (a constant entry) always uses the live cell |
| `boxed-expression/boxed-function.ts` `_type` (`get type`) | the static type of a function expression | `ce._anyVersion` | `ce._cacheGeneration()` |
| `boxed-expression/boxed-function.ts` `_typeGeneration` (the caller-side fast path in `get type`) | "the `_type` cache was already consulted at this generation", so the key need not be recomputed | `ce._anyVersion` | `ce._cacheGeneration()`, and the cell it inspects is chosen with `cachedCell()`. One field for both cells: a read that alternates sides misses the fast path and goes to `cachedValue`, which serves the right cell |
| `boxed-expression/boxed-function.ts` `_sgn` (`get sgn`) | the sign of a function expression | `ce._anyVersion` | `ce._cacheGeneration()` |
| `boxed-expression/boxed-function.ts` `_eagerSource` (`_materializedAt`) | the evaluated form of an eager collection producer, so repeated `at()` calls do not re-evaluate | `ce._anyVersion` | `ce._cacheGeneration()` |
| `boxed-expression/boxed-function.ts` `_structural` (`_memoizedStructural`) | the structural rebuild of a node | `ce._anyVersion` | `ce._cacheGeneration()`. The rebuild is a flatten-and-order walk over the node's own tree and the operator definitions, so both cells will normally hold the same answer; the composite key costs at most one duplicate derivation and removes the need to argue the point on every future change to `_computeStructural` |
| `boxed-expression/boxed-function.ts` the lazy-collection evaluate memo (`_value`, `_lazyCollectionMemoHit`, `_storeLazyCollectionValue`) | the evaluated form of a memoizable lazy collection view | `_lazyValueEpoch === ce._worldVersion`, plus either no generation (an all-constant, pure node) or `ce._anyVersion` and the ambient scope identity | the same, plus a new `_lazyValueFactsHidden` flag checked on BOTH kinds of entry. Spelled as a flag rather than folded into the generation because the CONSTANT entry has no generation to carry it in, and that entry needs the guard as much as the other one. Refusing to hit or store inside a window was the alternative; it was rejected because it would cost the accumulator loop (`xs := Append(xs, v)`) its linear behavior once write brackets are common |
| `boxed-expression/boxed-dictionary.ts` `_type` | the synthesized `record{…}` / `dictionary<T>` type of a dictionary literal | **none — the field was written once and returned forever** | `ce._cacheGeneration()`, through `cachedValue`. This is the row that also fixes a stale answer with no window involved: `assume(q > 3); ce.box({a: q}).type` answered `record{a: real<3<..>}` and went on answering it after `forget(q)` |
| `library/collections.ts` `BARE_MAPPING_ELEMENT_TYPE` | the element type a bare mapping literal produces, derived by typing a probe application | `WeakMap` on the literal, plus engine identity, plus a probe string, plus `ce._anyVersion` inside `cachedValue` | the same with `ce._cacheGeneration()` |
| `library/core.ts` `PIPE_IMPLICIT_MAP_TYPE` | the type of a `Pipe` whose stage implicitly maps, derived by canonicalizing and typing the mapped form | `WeakMap` on the stage, plus topic identity, plus `ce._anyVersion` | the same with `ce._cacheGeneration()` |

## 2. Memos that cannot reach a fact

| Location | What it caches | Key | Why it cannot hold a fact |
| --- | --- | --- | --- |
| `boxed-expression/boxed-object.ts` `_type` | the nominal type of an object instance | `readonly`, assigned once in the constructor | The value comes from `makeObject()`, which resolves the type NAME in the type registry (`ce.type(typeName)`) and stores a detached copy, or builds a bare reference node when the name is unknown. The registry holds `type` declarations; no symbol's effective type, sign or value is read, so no assumption can reach it. Pinning it at construction is also deliberate for an unrelated reason (a redeclared layout must not migrate existing instances), so the field could not be re-derived on a generation change even if it wanted to |
| `boxed-expression/boxed-function.ts` `_hash`, `_isValid`, `_resolvedOverload` | the structural hash, the validity flag, the overload chosen at construction | unversioned | Structural, or a decision recorded at construction rather than a view that can be recomputed |
| `boxed-expression/boxed-function.ts` `_effects` / `_effectsScope` | the effect set of an application | `ce._callableVersion` plus scope identity | The projection walks structure and consults declarations and signatures. It evaluates nothing and reads no symbol value |
| `boxed-expression/boxed-number.ts`, `boxed-symbol.ts`, `boxed-string.ts` lazy fields (`_literalTypeMemo`, `_publicTypeMemo`, `_hash`, `_utf8Buffer`, `_graphemes`, …) | the literal type, hash and text projections of an immutable literal | unversioned | A literal's value never changes and its type is read off the value. A fact about a SYMBOL never reaches a literal |
| `boxed-expression/order.ts` `LEAF_COUNT`, `polynomial-degree.ts` `LEX_KEY` / `REVLEX_KEY` / `DegreeMemo` | ordering keys and node counts | `WeakMap`, unversioned (the degree memo is per call, deliberately) | Counting and ordering read the tree shape, not a type |
| `boxed-expression/rule-index.ts`, `match-dispatch.ts`, `binders.ts`, `rules.ts`, `validate.ts` memos | rule indexes, match plans, shadowed-name keys, conformance arms | `WeakMap` on a syntax object, unversioned | Syntax-only classification |
| `boxed-expression/function-literal.ts` `RESOLVED_TYPE_OPERANDS` | the resolved `Type` of a `Typed` annotation operand | `WeakMap`, unversioned, undone through the checkpoint journal | Type-registry resolution of a written annotation |
| `boxed-expression/effects-of.ts` `accessorEffectsMemo`, `engine-protocols.ts` `MUTABILITY_GATE_MEMO` / `groundedLiteralMemo` / `requirementTypeMemo`, `boxed-operator-definition.ts` effect derivers | protocol and effect derivations | `ce._conformanceVersion` and `ce._callableVersion`, or `WeakMap` on a declaration object | Registry and signature scans. Dispatch READS (`receiverType`, `solveArm`) do see effective types, but they hold no memo of their own — they inherit the state of whatever read reached them, which is the design's intent |
| `engine-declarations.ts` `operatorPoolCache` | the visible operator NAMES, for "did you mean" | `ce._anyVersion` | A list of names |
| `engine-cache.ts` `EngineCacheStore` (rule sets, constructible trig tables) | standard rule sets and value tables | name-keyed, invalidated explicitly on a rule-set or configuration change | Built from the standard library and from literals |
| `common/type/parse.ts` `TYPE_CACHE`, `common/type/subtype.ts` `MEET_CACHE` / `PRIMITIVE_SUPERTYPE_CACHE` | parsed type strings and primitive meets/joins | string-keyed, module-global | Closed operations over the type lattice, with no engine state involved |
| `latex-syntax/*` (`_tokenPrefixOffsets`, `_namedTriggers`, `STICKY_REGEX_CACHE`) | tokenizer and dictionary projections | unversioned | Text processing |
| `big-decimal/utils.ts` `_pow10Cache`, `numerics/special-functions.ts` `bernoulliCache` / `ZETA_BORWEIN_CACHE` | numeric constant tables | numeric key, or engine-keyed with a length test | Pure mathematics |
| `compilation/*` (`_foldValueMemo`, `_complexMemoStack`, `INTEGRATE_DEPTH`, `NODE_IDS`, `modeSupport`, …) | compile-time folds, node identity, target capabilities | rebuilt at every compilation boundary (`_compileDepth === 0`), or structural `WeakMap`s | The folding memos DO read symbol values, but they are dropped at every top-level compile, and no compilation is started from inside a fact-suppression window. The user-facing `compile()` is called by a host, never by a write routine; the one route a bracketed evaluation could take into the compiler is the `Map` auto-compile trigger, and that trigger declines while the assumptions are hidden (see §4) |
| `rubi/driver.ts` per-call memo and predicate caches | integration intermediate results | cleared at every top-level call | Already bounded to one call, with a comment saying the bound exists exactly so that an assumption change cannot be served a stale result |
| `boxed-expression/object-deps.ts` collectors, `cycle-guard.ts` depths, `broadcast-cell-widening.ts` depths | bookkeeping, not values | — | No cached answer |

## 3. Memos that reach the facts and are keyed on the fact state itself

| Location | What it caches | Key | Status |
| --- | --- | --- | --- |
| `boxed-expression/constraint-subject.ts` `factIndexCache` (`getFactIndex`) | the built index over the current context's assumptions | `WeakMap` on the assumptions map object, plus `ce._anyVersion`, plus the map's own `version` | Correct without a suppression bit, and it must not have one. The accessor hands back an EMPTY store while the facts are hidden, so `getFactIndex` returns the shared empty index before it reaches the cache at all. The index BUILD is what raises the depth, and it captures the real map before doing so |
| `boxed-expression/boxed-value-definition.ts` `_effectiveType` | the declared type intersected with what the facts prove about this definition | the `FactIndex` OBJECT identity, plus the definition's `_writeVersion` | Correct without a suppression bit for the same reason: `get type` returns the declared type before consulting the memo whenever the store reads empty, so no entry is ever read or written from inside a window. Keying on the index identity is what heals it on `assume`, `forget`, a scope change and a checkpoint restore alike |

## 4. Memos on the world and semantic axes

These cache results of an EVALUATION or of a type derivation, so their
computation can reach a fact. They are keyed on `ce._worldVersion` or
`ce._semanticVersion`, both of which an `assume()` or `forget()` advances — so
they heal correctly when the facts CHANGE. What they lacked was the suppression
state, and while the only routine that opened a window was the fact-index
build, that was survivable: the build derives type contributions from
declarations and literals, so reaching one of these memos from inside it took
an assumption whose own expression drives an evaluation
(`assume(x ∈ Range(1, Length(L)))` is the shape).

That argument no longer holds. Every write routine — an assignment's
derive-and-write phase, the value-definition constructor, a lambda's signature
derivation, each `_infer`, the Epsil static pre-pass — now opens a window, so
windows are ordinary rather than exotic. Each row below therefore carries the
suppression state, either as a `factsHidden` field on the entry or folded into
a string key. A boolean field rather than a bit in the version stamp, because
opening or closing a window moves no invalidation axis; a single field rather
than a second cell, because these entries are large and a bracketed write does
not repeatedly re-read the same collection.

| Location | What it caches | Disposition |
| --- | --- | --- |
| `boxed-expression/boxed-function.ts` `_facetMemo` | `count`, `isEmptyCollection`, `isFiniteCollection` | STAMPED. `factsHidden` on the slot, checked on the hit path and re-checked before a facet is added to an existing slot. A facet walks a collection and can read a symbol's assumed value or effective type on the way |
| `boxed-expression/collection-element-memo.ts` `elementMemoCaches` | materialized collection elements | STAMPED. `factsHidden` on the entry, checked in `validElementMemo` and set at both commit sites. An element is an evaluated expression and an assumed value reaches it directly |
| `library/collections.ts` `SLICE_BOUNDS_MEMO` | the resolved bounds of a `Slice` (it evaluates a span operand) | STAMPED. `factsHidden` alongside `worldVersion` |
| `index.ts` `_applicationMemo` (filled in `function-utils.ts`) | the result of applying a pure function literal | STAMPED. The suppression state is folded into the memo KEY (an `H` next to the `N`/`E` numeric-approximation flag), which is the cheapest place to put it: the key is a string built per application anyway |
| `library/map-lowering.ts` `spineMemo` | the structural lowering of a `Map` spine | STAMPED. `factsHidden` on the record. A level admitted on a parameter ANNOTATION reads the source's effective type, which an assumption can narrow |
| `library/map-exact-proof.ts` `exactProofMemo` | the exact-tier eligibility proof | STAMPED. `factsHidden` on the record. The proof reads source VALUES (its `dynamic` flag) and annotated source TYPES |
| `library/map-auto-compile.ts` `mapCompileCaches` | compiled element closures | REFUSED, not stamped. `mapAutoCompileRunner` returns `undefined` while the assumptions are hidden, so a bracketed drain stays on the interpreter and neither reads nor writes the cache. A compiled closure BAKES symbol values — an `assume(x = …)` value among them — and the cache holds one closure per instance, with no room for a second cell; declining is the fail-closed direction, and the cost is an interpreted drain inside a write bracket, which is not a bulk-collection path |
| `sequence.ts` per-sequence term memo | evaluated sequence terms | STAMPED. A `facts-hidden|` prefix on the index key, added only inside a window, so the keys a caller of `getSequenceCache` sees are unchanged. A recurrence body can mention a symbol whose assumed value is in force |
