# Design: type derivation without side effects — type handlers as functions of types

**Status:** fourth draft, 2026-08-22. §2 is measured. §3 (Step 0) is
executed; §4.1's `Pipe` half is landed (staged) and its `Dot` half is in
flight. §6 records the rulings made on 2026-08-22, one of which (R4) is
refined here by measurement and needs re-confirmation. §4 and §5 are the
implementation draft; §5.1 specifies the primitive the third draft only
named. Attribution is kept strict: a ruling is the user's and is dated; a
proposal is marked as one.

## 1. The problem, and the goal

An operator definition's `type` handler decides the static type of an
application. It takes the operands as *expressions*:

```ts
type?: (ops: ReadonlyArray<Expression>, options: { engine; operandTypes? })
  => Type | TypeString | BoxedType | undefined;
```

Because it holds expressions, a handler can do anything an expression lets
it do — canonicalize a held operand, declare a stand-in symbol into a scope,
evaluate a component — and some do. **A type derivation that writes engine
state invalidates the caches the derivation is itself filling.** That is
what made reading a nested lazy view's type exponential in depth (ROADMAP
"Reading a nested lazy view's type was exponential in depth", item 219): the
`Map` type handler declared stand-ins to learn what type the body *would*
have, each declaration advanced the engine's `any` cache axis, and every
`_type`/`_sgn` memo filled so far was retired — per level, per read.

The goal (the user's, 2026-08-22): **type derivation must not modify engine
state.** The means (also the user's, raised 2026-08-22): make the handler a
function of the operands' *types* rather than the operands themselves, so
that the question "what type would this application have, given operands of
these types" is answered by calling the handler with types — no stand-in,
no declaration, no scope. Three framing decisions set the scope:

- **Precision is secondary.** A types-based handler will sometimes derive a
  less precise type than today's value-reading one. The user's hypothesis
  is that this rarely if ever matters, and the acceptable outcome is that a
  use which errors at boxing time today instead boxes and is checked at
  evaluation — the admission model arithmetic operators already follow
  (`"abc" + 1` is refused at boxing because it is *provably* invalid; `x +
  1` is admitted and checked at runtime).
- **Literal types are wanted for a few values only** — the user named `0`
  and `1` ("so the value `0` and `1` could be given the type `0` and `1`").
  Generalizing to every literal was the measurement's shim (§2.2), not the
  scope.
- **The item-219 exemption is a guard, not the mechanism.** The `scratch`
  exemption from cache invalidation stays, tested, and the design's success
  criterion is that nothing needs it (§5.5).

What "does not modify engine state" means, precisely (the invariant every
measurement in §5.5 checks): across a `.type` read, none of
`_anyVersion`, `_semanticVersion`, `_worldVersion`, `_callableVersion`
advances; no definition's `_writeVersion` advances; no scope is pushed,
popped or declared into; no expression is canonicalized or evaluated; no
state event is emitted. Memo *fills* (`_type`, `_sgn`, `cachedValue` slots)
are not state in this sense — they are what the invariant protects.

What this document is not about: a broader pre-canonicalization validation
phase (ROADMAP "A pre-canonicalization validation phase"), which the user
raised alongside this and which this design is one answer to.

## 2. What was measured

Two different things were measured, and they must not be conflated.

### 2.1 Side effects (item 219, measured before this document)

The 219 fix measured the cost of state writes during type derivation
directly: `_anyVersion` drift across 10 `.type` reads of a nested `Map`
view went from 620 to 0; a warm read from 838 µs to 0.5 µs; `Map`
type-handler invocations at view depth 0–4 from 913 / 1857 / 3745 / 7521 /
15073 to 11–19. Pinned structurally in
`tycho-item-219-nested-map-view-type-cost.test.ts` (drift must be 0; the
per-level ratio must stay under 1.5; the scratch registration must be empty
after return and after a throw).

### 2.2 Value reads (the shim experiment)

A separate experiment asked a narrower question: of the handler bodies in
`library/*.ts`, which read *value* facts from their operands (`isFinite`,
sign, integrality, literal content) rather than the type alone, and what do
those reads buy? Method: proxy the operands at the one call site
(`BoxedFunction` type derivation, `boxed-function.ts`, `def.type(expr.ops,
…)`), withhold value-backed getters on non-literals, give literals a literal
type, widen handler results; full suite with `--ci`. The shim is preserved
as `scratchpad/shim.patch` of the Step-0 session (applies to
`boxed-function.ts` at d3faf62d) and is to be checked in as a harness under
§5.5. **It measured value reads only; it never measured side effects.**

| model | failures | what it showed |
| --- | --- | --- |
| every `isX` getter and value read withheld | 345 | over-blinded: `isReal`/`isInteger`/`isFinite` on a symbol answer from its declared type; the getters are one spelling over two channels |
| type-backed predicates pass through; literal types on handler input | 244 | literal types leak: handler results carrying `tuple<1, 2>` or `((z: 0) -> 0) & …` get stored as contracts |
| + every `{kind:'value'}` in a result widened to its primitive | 423 | the naive walker rebuilt `reference`/`object`/`record` nodes (identity lost) and recursed a recursive record type |
| + widening through structural nodes only, cycle-guarded | 75 | the residue before Step 0 |
| same shim after Step 0 (§3) | **57** | the baseline; 17 suites |

Of the 57 (by cause — counts from the run logs):

- **Sign facts read from a non-type channel** (~14): `x.isPositive` /
  `x.sgn` on a symbol answer from the held value first and
  `getSignFromAssumptions` second (`boxed-symbol.ts:949`). Inverse-trig
  domain typing under `assume()`, `Ln` of a provably-positive real,
  `±∞ · provably non-zero real`, `π·i` (`Multiply` cannot prove `π ≠ 0`),
  `e^i` (`Power` cannot see `e > 0`). Resolved by R3 (§6) as far as the
  pure leaves reach (§5.2).
- **Rational literal types do not exist** (11): `(1,2)/3`, `(1..4)/2`,
  `(-2)^(p/q)` provenance, `Abs`/`Mod`/`Pochhammer` literal tiers. Out of
  scope under R2 and the `0`/`1` literal scope — accepted precision loss.
- **Closedness** (3): `poleReciprocalType` (`library/type-handlers.ts:107`)
  tells a closed constant (`Tan(π/2)`, may sit on a pole → `number`) from a
  generic symbol (`Tan(r)` → `finite_real`) by `x.isConstant`, a structural
  fact; withholding it gave the *unsound* `finite_real` at the pole.
  Resolved by R3.
- **`unknown` operands narrowed** (4 tests): cells that come from an
  `unknown`-returning function are `number` by the engine's contract
  (`Add(u, 1)` with `u: unknown` → `number`; measured); the shim typed them
  `finite_number`. Prerequisite task P1 (§4.6).
- **Refusals at the strict gate** (the behavior rows): `FactorInteger(3 +
  10²¹)` refused as `finite_number`, `Mod(2^(3^20), 100)` inert, 25 Fungrim
  simplify rules failing to load, `e^i` refused by a `(complex)` parameter.
  Resolved by R1 once §4.4 lands.
- A symbol bound to a function value (2, `derivatives`): prerequisite
  task P2 (§4.6).
- A shim artifact (1): a union widened without `reduceType`.

### 2.3 Exact-string type assertions (resolved by Step 0)

Before Step 0 the suite pinned types by exact string 1451 times against 275
`.matches()`; a sound refinement anywhere failed dozens of tests guarding
nothing in particular, and an over-narrow type passed `.matches()`. §3
records what was done; the rule for new assertions is in
`docs/COMMENTING-GUIDELINES.md` ("Type assertions in tests").

### 2.4 The argument gate, measured

The engine draws the strict/lenient line in two places:

| operators | admission at canonicalization | a bad operand is rejected at |
| --- | --- | --- |
| arithmetic, via `checkNumericArgs` | `op.type.couldMatch('number')` (`validate.ts:459`) | evaluation (`nonNumericOperandError`) |
| every declared signature | `!op.type.matches(param)` → `incompatible-type` (`validate.ts:1598` required, `:1795` optional, `:1940` variadic; and `checkType`, `:681`) | canonicalization |

Two facts established while measuring, both load-bearing for §4.4:

- **`couldMatch` is comparability, not overlap.** It answers true when
  either side is a subtype of the other (after distributing over unions and
  `broadcastable`), so `finite_number couldMatch complex` is **false**
  although `finite_complex` inhabits both; `finite_real couldMatch
  finite_integer` is true. True overlap exists as `typesOverlap`
  (`common/type/reduce.ts:783`, built on the intersection reduction), and
  the signature path already has an *overlap-deferred* admission for
  collection-kind parameters (`overlapsForDeferredValidation`,
  `common/type/utils.ts:921`, reached from `checkType` and all three
  `validateArguments` gates; the "D6.1/D6.2" labels in the code refer to
  the broadcast-model rounds, not to a section of `docs/COLLECTIONS-MODEL.md`).
- **A crude relaxation measures the wrong thing.** Swapping `matches` for
  `couldMatch` at the three `validateArguments` sites: alone, 47 failures
  in 16 suites — 18 of them `filter-predicate-errors`, where a predicate
  `(integer) -> boolean` applied to `1.5` must still produce an
  `incompatible-type` error *value* at evaluation: the same
  `validateArguments` is reused at runtime on evaluated lambda arguments
  (`function-utils.ts` `apply()`), so relaxing it globally relaxes the
  runtime check too. Those are the **missing runtime half**, not pinned
  refusals. The pinned static refusals are the rest (`SLICE: a symbolic
  Range is a STATIC type error`, `VALUE MEMBERSHIP: g: (0) -> integer
  rejects g(1)`, the "provable refutations still error" pin, the
  evidence-guard diagnostics). With the shim on top, the residue was
  unchanged (57): `e^i` into `(complex)` is still refused because of the
  comparability semantics, and `FactorInteger(n)` with `n: number` was
  admitted. Logs: `gate-only.log`, `gate-shim.log`.

### 2.5 The side-effect audit (2026-08-22)

A transitive call-graph audit (depth ≤ 8, comments stripped, import-resolved)
of every `type:` entry in `library/*.ts`: **220 arrow-form handlers** (the
regex survey's "146" undercounted) plus ~65 string/named entries. **213
reach only pure leaves** — type-lattice algebra (`widen`, `isSubtype`,
`functionResult`, `collectionElementType`, `broadcastResultType`) and
predicate reads (`op.type`, `op.sgn`, `op.isFinite`, `op.isConstant`).
Reading `op.type` on a symbol performs no lazy binding and no
auto-declaration (`BoxedSymbol._bind` is empty; `_def` is assigned once).
The exceptions, with the outcome of the measurement that followed:

| handler | path | mutating operation | state changed | status |
| --- | --- | --- | --- | --- |
| `Map` (`collections.ts:4050`) | `bareMappingElementType` → `probeBareMappingElementType` | `pushScope`, `declare` stand-ins, `ce.function(body.operator, args)`, `popScope` | scope, declarations, a canonicalized probe | guarded (registered scratch scope, `cachedValue` memo — the 219 fix); rewritten at §5.3 step 4 |
| `Pipe` (`core.ts:2893`) | `pipeImplicitMapType` → `canonicalWithFreshPlaceholders` (`function-utils.ts:1546`) | `topic.canonical`; `_declareSymbolValue` of each placeholder into a fresh scope; `ce._fn('Map', …)` | declarations into a scope that was **not** registered as scratch → `_anyVersion` advanced on every re-derivation | **fixed** for the placeholder declarations (R5, §4.1); one residual advance accepted (R6) |
| `Dot` (`linear-algebra.ts:1108`) | `innerProductType` | `ce.function('Multiply', [x, bᵢ])` per component, `ce.function('Add', terms).type` | n+1 canonicalizations per read. The audit's "`_infer` reachable for an undeclared component" did **not reproduce** (20 shapes, drift 0, an undeclared component stays `unknown`); the cost is ≈44 µs of allocation per re-derivation | pure rewrite **ruled** (R7, §4.1), in flight |
| `Set` (`collections.ts:2593`; also `Set.elttype`) | `parseSetComprehension` | `x.canonical` of domain/condition; `ce._fn('And', …)`; `Set.elttype` **evaluates** each domain element (`enumerateSetComprehension`) | auto-declare, `_infer`, evaluation | §5.3 step 4 |
| `JacobianMatrix` (`calculus.ts:1430`) | inline + `resolveToList` → `inlineLambdaApplications` | `fs.canonical`; `engine.function(expr.operator, inlined)` | auto-declare, `_infer`, rebuilt applications | §5.3 step 4 |
| `Sqrt` (`arithmetic.ts:2932`) | `closedRealSign` (`type-handlers.ts:474`) | `x.N()` | numeric evaluation during a type query | `isPure` and no-unknowns guards; §5.3 step 4 |
| `Function` (`core.ts:5150`) | inline | `ce._fn('Function', ops, { canonical: false })` | allocation only | short-circuited before the handler for the `Function` operator itself |
| `Interval.elttype` (reachable from `Map`) | `mappingSourceElementType` dynamic dispatch | `op1.N()`, `op2.N()` (`numerics/interval.ts`) | evaluation | §5.3 step 4 |

And one **getter that writes on read**: `op.type` on a symbol whose recorded
type is *inferred* and refutable runs `_reviseInferredType`
(`boxed-value-definition.ts:665-694`), which journals a `type-write`,
emits the `type-write` state event (`any` axis, and `callable` when a
signature arm is on either side), writes `_type` and advances the
definition's `_writeVersion`. Reachable from any of the 213 pure handlers.
The mechanism is also **incompletely revising** (ROADMAP
"`_reviseInferredType`'s generation gate keys on `semantic`…"): its
once-per-generation gate keys on `_semanticVersion` while the live type it
compares against is an `_anyVersion` memo, so a refuting change that
advances only `any` (a fresh `declare`) or nothing (an `inference{valueType}`
write) leaves the recorded type stale — reproduced. §4.2.

The audit did not trace: dynamic `def.type`/`elttype` dispatch edges beyond
the two `elttype` handlers above; call depth > 8; and the `sgn` handler
family, which `argFacts` would reach through `op.sgn` on a function
expression (§5.2 restricts the channel so it does not).

### 2.6 What the derivation does around the handler (2026-08-22)

A map of `boxed-function.ts`'s `type(expr)` (`:4608-5163`) and its memo
(`get type()`, `:1796-1861`), needed to specify §5.1. In order:

| # | step | inputs beyond the operand types | derivable from types alone? |
| --- | --- | --- | --- |
| 0 | memo: `cachedValue` keyed on `_anyVersion`; cycle guard is the in-flight window (`cache.ts:80-105`) | generation, object deps | n/a |
| 1 | `!expr.isValid` → `error` | an "any operand is an error" bit | no (a flag) |
| 2 | `Function`-operator short-circuit → `functionLiteralSignatureType` (`effects-inference.ts:652`): body, parameters, effects walk | the literal's body | no — not an application |
| 3 | definition lookup (`expr.operatorDefinition`, bound once) | scope | input to the primitive |
| 4 | signature normalization via `parseType(sig, engine._typeResolver)` | the resolver | yes, given resolver |
| 5 | overload arm resolution, `resolvedArm` → trial-less `resolveOverload`: `prefilterAdmits` reads `op.isValid`, `op.type`, `couldBeUnkeyedCollectionOperand(op)`, `admissionOf(op, param)` (value membership reads `concreteValueOf`), `isRepairableOperatorSymbol` | validity, collection-ness, a literal's value | mostly |
| 6 | `functionResult(resolved)` | — | yes |
| 7 | `broadcastableParamSlots(def)` (memoized per signature) | — | yes |
| 8 | generic instantiation `instantiatedResultType`: `op.type`, `op.isValid`, `valueDefinition.inferredType`, `couldBeUnkeyedCollectionOperand` | inferred-ness, collection-ness | near-yes |
| 9 | missing absorption decision (`resolvedMissingBehavior`, `typeContainsMissing`) | — | yes |
| 10 | `operandTypes` override (`stripsMissingAt`, `stripMissingFromType`) — **the existing synthetic-type seam** | — | yes |
| 11 | the handler call `def.type(expr.ops, { engine, operandTypes })` | the open question | 213/220 pure |
| 12 | result parsing (`BoxedType` as-is; strings via `parseType` with the resolver) | the resolver | yes |
| 13 | no-handler numeric narrowing: `ops.every(op => op.isFinite === true)` and all arg types numeric → `widen(...)` | `isFinite` (a value fact on literals, a type fact on symbols) | with a fact |
| 14 | broadcast gate: `def.broadcastable`/slots, `candidateShape` (literal `List` chain), `isCollection`, `isTuple`, `isTextAtom`, `type.matches('matrix')` | structural + collection-ness | no — facts |
| 15 | arm 1: statically-visible collection → `broadcastShapedResultType(types, broadcastElementType(sigResult))` — builds `list<E>`/`vector<n>`; participation via `isFiniteBroadcastParticipant` (value-level), `isBroadcastCollectionType`, `isFixedShapeCollection` (type-level) | participation facts | shaping yes; participation partly |
| 16 | arm 2: possibly-collection → `broadcastable<E>`; `isPossiblyCollectionTyped` = top type **and `isFunction(expr)`** | "is an application" bit | with a fact |
| 17 | lambda-definition arm (`def._isLambda`, `paramsAreScalar`, `isNumericTuple`) | structural | partly |
| 18 | value-definition route (a function literal assigned to a symbol): no handler, no absorption | `valueDefinition.type`/`.value.type` | partly |
| 19 | fallbacks: `maybeAbsorb(sigResult)`, `unknown` | — | yes |

The `elttype` protocol (26 handlers): 19 are constants (`sets.ts`); the
shared base handler widens the operand types (which a `list<T>` type
already records); `Join`/`Append` answer a structural dictionary-ness
question; `Range` reads `isInteger` of its bounds (a fact); the guarded
view already derives from its value's type. The two that need evaluation
are `Set` comprehension (enumerates) and `Interval` (`.N()` of endpoints).
`collectionElementType` (`common/type/utils.ts:336`) is the type-level
counterpart, and it is more than `list<T> → T` (peels one rank off a
dimensioned list, `range → integer`, `string → character`, `tuple →
widen(slots)`, `dictionary<V> → tuple<string, V>`).

Existing synthetic-operand derivations: `probeBareMappingElementType`
(constructs; memo keyed on operator + parameter positions + element-type
keys, *not* source identity, through `cachedValue`); `pipeImplicitMapType`
(canonicalizes; memo keyed on the stage, validated by `_anyVersion`);
`innerProductType` (constructs); `parseSetComprehension` (canonicalizes);
`JacobianMatrix` (canonicalizes); `closedRealSign` (`.N()`). There is no
other `def.type(…)` call in `src/`.

## 3. Step 0 — make type assertions say what they guard (EXECUTED 2026-08-22)

Without it no later step is measurable: a change that makes 22 types
sounder-and-different read as 22 failures, indistinguishable from 22
regressions.

- **Idiom** (`test/utils.ts`): `expectTypeBetween(expr, { atMost, above? })`
  — the type must match `atMost` ("at least this precise"), must not match
  `above` (a claim that would be over-narrow), and must not contain `never`
  (`never <: T` for every `T`, so a bare `.matches()` accepts a derivation
  that collapsed). Exact strings stay only where the exact tier is the
  contract, with the reason stated.
- **Done:** 23 pins examined, 15 converted, 8 kept exact with reasons, the
  two signature pins hybridized (parameter list exact, result bracketed);
  rule added to `docs/COMMENTING-GUIDELINES.md`; dual-reviewed; committed
  as d3faf62d.
- **Three traps, recorded for the next conversion:** `number <:
  broadcastable<number>` (a bare `.matches()` admits a scalar fold);
  "strictly more refined" is not "sound" (cells from an `unknown`-returning
  operand are `number` by contract); function parameters are contravariant
  (`.matches()` on a signature cannot see an unrefined parameter list).
- **Baseline:** 57 failures / 17 suites under the shim (§2.2).

## 4. Runtime steps that precede the signature change

Each is independently landable and independently measurable by the
§5.5 instrument.

### 4.1 `Pipe` and `Dot` (RULED 2026-08-22: fix now, standalone — R5, R6, R7)

- **`Pipe` — landed (staged 2026-08-22).** `canonicalWithFreshPlaceholders`
  gained an opt-in `scratchDeclarations` option that registers the fresh
  placeholder scope in `_scratchDeclarationScopes` only while pre-declaring
  into it, unwound in a `finally` *before* canonicalization;
  `pipeImplicitMapType` passes it; evaluate-time callers are unchanged.
  Drift per re-derivation 2 → 1; repeated reads 0; the derived types of
  five stage shapes unchanged. The soundness argument is not the `Map`
  probe's (a popped scope): the canonical stage *keeps* the placeholder
  scope as the parent of the literal's `block.localScope`. The argument
  that holds is that the scope is created in that call and fully populated
  before any name resolves against it, so no cached answer anywhere was
  computed against it without those bindings. **The residual advance** is
  the literal's own parameter declared into `block.localScope`
  (`canonicalFunctionLiteral`), a scope the canonical literal keeps;
  exempting it would change invalidation for every lambda canonicalization
  engine-wide. **R6: accepted as one advance per re-derivation**; the
  pre-canonicalization validation phase (ROADMAP) is the mechanism that
  would remove it. Pins: `pipe-type-read-purity.test.ts` (repeated-read
  drift 0; re-derivation drift *exactly* 10 over 10 forced re-derivations
  — a 0 would mean an over-broad exemption; registration empty after
  return and after a throw; four derived types exact).
- **`Dot` — R7: accept the narrowing, land the pure rewrite** (in flight).
  The audit's `_infer` claim did not reproduce (§2.5). A derivation from
  the component *types* — the numeric ladder the `Multiply`/`Add` handlers
  use, with no expression constructed — was measured against today's
  answers on 20 shapes: one row widens (`finite_rational` →
  `finite_real`), two narrow (components declared `real`/`integer` × a
  literal vector: `real` → `finite_real`, `integer` → `finite_integer`),
  because canonicalization *folds* `Multiply(a, 1)` to `a` and the sum
  inherited the declared type, while the ladder applies the
  generic-finite-point convention the rest of the engine uses
  (`Multiply(a, b)` already types `finite_real`). The user ruled the
  folding artifact is not the contract. Pins: `dot-type-read-purity.test.ts`
  (today's 20-row table as exact pins with per-row reasons, the two ruled
  rows updated with the mechanism stated; drift 0 cold and warm; a spy
  asserting `ce.function` is not called during a `Dot` type read).

`Set`, `JacobianMatrix`, `Set.elttype`, `Interval.elttype` and `Sqrt`'s
`closedRealSign` wait for §5.3 step 4, where the primitive gives them a
pure way to ask their question.

### 4.2 `.type` becomes a pure read (R4, mechanism refined — needs re-confirmation)

R4 as ruled: "the revision moves to a write site; `.type` becomes a pure
read." Measured on 2026-08-22, the first half cannot be implemented as
stated and the second half does not need it:

- **Why not a write site.** `_reviseInferredType` revises on read because
  the refuting event is a write to a *different* definition — the
  dependency — and the engine keeps no dependency graph, forward or inverse
  (the nearest things are pull-based validators: `snapshotMemoDeps` /
  `memoDepsStillValid` in `collection-element-memo.ts`, and the per-object
  channel in `object-deps.ts`). A write-site scheme needs an inverse index
  `B → {dependents}` that does not exist, a lifetime story across
  `updateDef` swaps, and a transitive cascade (`a := b + 1; c := a + 1`); and
  "recompute at the next write" does not preserve the pinned scenario
  (`inferred-type-revision.test.ts:48`: `C_0` is never written again and
  must still read `vector<integer^2>`). A conservative type at assignment
  reverses the 2026-08-16 ruling ("inference has to be more likely, not
  broadest") and collides with the use-narrowing evidence guard.
- **What works: a pure live read.** Keep the four guards (inferred, not
  constant, not self-referential, value is a non-`Function` function
  expression); compute `live = value.type` (already an `_anyVersion` memo
  — the read-side write bought nothing for the computation itself); return
  `recorded` if `live.isUnknown || live.matches(recorded)`, else `live`. No
  `_type` write, no `_writeVersion` advance, no journal entry, no
  `type-write` event. A/B'd identical on every pinning scenario
  (`inferred-type-revision` ×5, `use-narrowing-evidence-guard` ×3,
  `placeholder-signature-refinement` ×2, `assign-recursion`, item 219,
  mutual recursion `a := b+1; b := a+1`, a depth-8 chain); ~+0.15 µs per
  read only for symbols holding a function expression; drift on the first
  read after a refuting write 1 → 0; and it **fixes** the staleness defect
  (§2.5) because it no longer keys on `_semanticVersion`.
- **Why the missing event is sound.** The refuting fact is "the stored
  value's type changed", and that type is itself an `_anyVersion` memo, so
  the event that made the revision due already advanced `any` (or
  invalidated that memo's object deps) — the read-side `type-write` was a
  second bump for a change the first bump covered, which is the item-219
  hazard itself. The doc comment's contrary argument is explicitly
  hypothetical ("for some future axis table").
- **What changes.** `checkpoint-journal.test.ts` "funnel 2 — the
  read-driven type revision" loses its subject: repurpose it to assert the
  *absence* of a write across a `.type` read inside a window. Add two pins:
  mutual/self recursion stays terminating without the accidental cycle
  breaker (`cachedValue`'s in-flight stamping covers it; not pinned today),
  and the §2.5 zero-mask staleness case answers the live type. The
  `Function`-literal guard is load-bearing (two joint-cause refusals in
  `protocol-type-redefinition.test.ts` became silent acceptances without it)
  and survives. Not traced: whether the R-D5 display projection keys on the
  `BoxedType` identity of `def.value.type` — verify before landing.

### 4.3 Literal types `0` and `1` on handler input (user's scope)

`ce.type('0')` exists and sits in the lattice (`0 <: finite_integer`); a
boxed `0` does not carry it (`ce.box(0).type` is `finite_integer`).

- **Eligibility.** An operand is given the literal type `0` or `1` on
  handler input iff `isNumber(op) && op.isExact && op.im === 0 && (op.re ===
  0 || op.re === 1)`. `-0` is `0` (exact zero has one representation in the
  numeric value). A float `0.0`/`1.0` is not exact and is not eligible. A
  symbol bound to `0` or `1` is not eligible — its type is its declared or
  inferred type; its value is not a type fact.
- **Input side.** `argTypes[i]` is `0` or `1` for eligible operands, so the
  facts handlers read today from the literal's *value* (a nonzero divisor;
  an exponent `0`/`1`; the `fib(0)`/`fib(1)` arms; `At(xs, 1)`) come from
  the type. A handler that compares `argTypes[i] === 'finite_integer'` by
  string would stop matching; §5.3 step 3 audits for that.
- **Output side (proposal, CE-POC; measured necessary in §2.2).** A handler
  result is widened before storage by a total transformer over the `Type`
  AST: a numeric `{kind:'value'}` node becomes `finite_integer`; the
  structural kinds `list`, `set`, `collection`, `indexed_collection`,
  `tuple`, `union`, `intersection`, `signature` (parameters, result,
  optional/variadic, effects adjuncts carried through), `map`,
  `dictionary`, `broadcastable`, `record` fields *by value* (a record's
  field types are structural; the node is rebuilt only if a field
  changed), numeric ranges (`integer<0..1>` is not a value node and is
  untouched) are descended; `reference` (aliases, nominal types, generic
  constraints), `object`, `variable` and `value` nodes of non-numeric kind
  are returned by identity (resolver state compared by `===`); a
  `WeakSet` cycle guard returns an already-visited node by identity; a
  rebuilt `union` is re-reduced (`reduceType`). Ordering: the handler's
  string result is parsed, widened, then checked against the signature
  ceiling (§4.5). Tests: nested intersection/signature/alias, a recursive
  record type, `-0`.
- Default: always widen, no opt-out (O1).

### 4.4 Declared signatures admit by overlap (RULED 2026-08-22, R1)

The declared-signature path adopts the arithmetic model — reject at boxing
only when the operand is *provably* incompatible; admit otherwise and check
at evaluation. Two modes, separated:

**Static admission (at canonicalization).** For each parameter kind:
- classic and value-component parameters: admit iff the operand's type
  *overlaps* the parameter type — `typesOverlap` (`reduce.ts:783`), not
  `couldMatch` (comparability); the existing collection-kind deferral
  (`overlapsForDeferredValidation`) is one case of this;
- a literal operand is refuted by its *value* through `admissionOf`'s
  concrete-value branch (`value-membership.ts:71-100`), which already
  decides `1.5` against `finite_integer` for any literal — independent of
  the `0`/`1` literal-type scope;
- arrow-typed parameters keep the Design E compatibility admission
  (`arrowSlotAdmission`) unchanged;
- `unknown`/`any` operands are admitted (they overlap everything).
So `finite_number` is admitted at `(complex)` (they share `finite_complex`),
`string` is still refused at `(integer)`, and `FactorInteger("abc")` and
`f(1.5)` for `f: (integer) -> …` still refuse at boxing.

**Runtime conformance (at evaluation).** A single check, in the evaluate
dispatch, on the *evaluated* operands against the *selected* arm's
instantiated parameter types (overloads and generics resolved by then):
- an operand that evaluated to a concrete value that does not conform
  yields the `incompatible-type` error *value* the gate would have minted
  (the 08-19 arithmetic round's `nonNumericOperandError` is the per-handler
  form; this is the generic one, and the nine hand-written guards become
  redundant);
- an operand that is still symbolic after evaluation is **left alone** (the
  application stays inert or the handler decides), mirroring the arithmetic
  precedent;
- insertion points, each with a route-parity test: the sync and async
  evaluate dispatch of a built-in; value-definition function application
  (`function-utils.ts` `apply()` — which today reuses `validateArguments`
  and must call the *runtime* mode, not the static one); lazy operators
  (held operands are not evaluated by the check — a lazy handler's own
  operand handling runs first, and the check applies to what the handler
  evaluates); optional and variadic positions; the per-cell broadcast route
  (checked per cell, once); effectful handlers (the check reads the
  already-evaluated operands and evaluates nothing itself, so no operand is
  evaluated twice).

**Pins.** The 18 `filter-predicate-errors` rows and the `Any`/`All`/
`TakeWhile` error-value rows are the acceptance test for the runtime mode;
the pinned static refusals for *symbolic* operands (`SLICE`, `VALUE
MEMBERSHIP: g(1)`, the evidence-guard diagnostics, "provable refutations
still error") are re-read under R1 — each becomes a runtime error pin or
stays static with its reason (a provable refutation stays static).

What a user sees: `FactorInteger(n)` with `n: number` boxes and works when
`n` is 12, and errors at evaluation when it is not; an Epsil diagnostic for
that call moves from box time to run time. Errors for provably-wrong
literals are unchanged.

### 4.5 The signature ceiling

`types-definitions.ts` requires a handler result to be a subtype of the
signature's result. Every derived type — handler result, widened result,
the sound-wider fallbacks of §5.3 — is checked: `derivedResult <:
instantiatedSignatureResult`, else the instantiated signature result is
used (and, under the §5.5 guard, reported). This is the ceiling on
"wider is acceptable".

### 4.6 Prerequisite tasks (not open items)

- **P1 — trace the `unknown`-cell widening.** Which step of §2.6 makes
  `Add(u, 1)` type `number` for `u: unknown` (and
  `Add(h(x), 1)` → `broadcastable<number>`) while the shim derived
  `finite_number`. Artifact: the step number and a pin
  (`unknown-operand-cells.test.ts`) asserting the four §2.2 rows. Blocks
  §5.3 step 2.
- **P2 — the two `derivatives` rows.** `f := t ↦ (t, t², t³)` already
  refines the signature to `-> tuple<…>`; trace why the tests' "declared as
  function" setup does not see it. Artifact: either a fix or a stated
  cause and a pin. Blocks nothing; closes before §5.3 step 4 touches
  `Derivative`.

## 5. The signature change

### 5.1 The primitive: `deriveApplicationType` (proposal)

The third draft named `def.type(argTypes, …)` as the type-level
application; §2.6 shows a bare handler call reproduces none of steps 1–19.
The primitive is the whole derivation with the expression replaced by a
description of it:

```ts
type OperandDescriptor = {
  type: Type;                         // literal 0/1 visible (§4.3); absent-operand
                                      // positions carry the missing-stripped type
  facts: OperandFacts;                // pure, computed once (§5.2)
  structure?: OperandStructure;       // present only for the structural readers
};
type OperandFacts = {
  isValid: boolean;
  sgn?: Sign;                         // pure leaves only (§5.2)
  closed?: boolean;                   // no free variables (`isConstant`)
  finite?: boolean;                   // isFinite as a tri-state, from the type or a literal
  collection?: { finite: boolean; indexed: boolean; shape?: readonly number[] };
                                      // the participation facts of steps 14–15
  inferred?: boolean;                 // valueDefinition.inferredType (step 8)
  isApplication?: boolean;            // step 16's `isFunction(expr)`
  concrete?: unknown;                 // a literal's value for value-component arms (step 5)
};
type OperandStructure =               // read-only views; constructing through them is not possible
  | { kind: 'function-literal'; parameters: readonly string[]; body: Expression }
  | { kind: 'tuple'; arity: number }
  | { kind: 'list-literal'; shape: readonly number[] }
  | { kind: 'text' };

function deriveApplicationType(
  ce: ComputeEngine,                  // read-only use: resolver, definitions; enforced (§5.5)
  def: BoxedOperatorDefinition | BoxedValueDefinition,
  operands: ReadonlyArray<OperandDescriptor>,
  options?: { resolvedOverload?: … }  // a construction-site resolution, if any
): Type;
```

Steps 1–19 run on descriptors: validity from `facts.isValid`; the `Function`
literal route stays a separate entry point (it types a *literal*, not an
application); overload resolution and generic instantiation read
`facts.concrete`, `facts.inferred`, `facts.collection`; the broadcast arms
read `facts.collection`, `facts.isApplication` and `structure`; the
handler is called as `def.type(operands, { engine })` under the new shape
(§5.3 step 2). Where a step needs a fact that is absent (`undefined`), it
takes the conservative branch: no narrowing, the wider arm, `unknown`
participation treated as "possibly a collection" — never a guess toward
precision. The result passes §4.3's widener and §4.5's ceiling.

`BoxedFunction.type` becomes `deriveApplicationType(ce, def,
ops.map(describe), …)` under the existing `_anyVersion` memo — the
descriptor is built once per derivation from the pure reads §2.5 and §2.6
identified. A type-level application *by a handler* is the same call with
descriptors it assembles from types: `{ type, facts: {} }` per operand
(every fact absent → conservative branches), plus `structure` only when it
holds a real sub-expression (a mapping body). `Map`'s element derivation
becomes: one descriptor per *body operand* (a parameter reference maps to
its source's element type; a constant operand to its own type with its own
facts), then `deriveApplicationType(ce, bodyDef, descriptors)`; the
`BARE_MAPPING_ELEMENT_TYPE` memo keeps its key (operator + parameter
positions + element-type keys). `elttype` gets the counterpart
`collectionElementType(type)` (§2.6) with the two evaluating handlers
returning the sound wider type (`Set` comprehension: the domain's element
type widened; `Interval`: `real`).

### 5.2 The handler's context: pure facts (R3)

```ts
type?: (
  operands: ReadonlyArray<OperandDescriptor>,
  context: {
    engine: PureEngineView;          // `type()`, `parseType`, `_typeResolver`, definition lookup;
                                     // no declare/assign/box/function/parse/evaluate
    derive: (operator: string, operands: ReadonlyArray<OperandDescriptor>) => Type;
  }
) => Type | TypeString | BoxedType | undefined;
```

- `operands[i].type` is the old `ops[i].type.type` with `0`/`1` literal
  types visible and the `operandTypes` override folded in; there is no
  separate `literal` fact (the type carries it).
- `facts.sgn` comes from **pure leaves only**: a number literal's sign; a
  symbol's held numeric value; `getSignFromAssumptions`. It is `undefined`
  for a function expression — the `sgn` handler family is *not* dispatched
  from the type path until it has had the §2.5 audit (O7). The precision
  lost is `Multiply((2+π), i)` typing `finite_complex` rather than
  `imaginary` — accepted under R2; `π·i`, `e^i` and the assumption cases
  keep their answers.
- `facts.closed` is `isConstant` (pure, structural). `facts.finite` is
  `true` for a `finite_*` type or a finite literal, `false` for a
  `non_finite_number` type or `±∞`/`NaN` literal, else `undefined`.
- For a collection-shaped, absent (`missing`-stripped) or `unknown`-typed
  operand every scalar fact is `undefined`; `facts.collection` is set from
  the type (`isFixedShapeCollection`, `isBroadcastCollectionType`) and,
  when the operand is a real expression, from the pure collection-ness
  reads (`isFiniteCollection`, `isIndexedCollection` — memoized facets).
- `context.derive` is `deriveApplicationType` with the engine view bound —
  what the seven handlers use instead of constructing.

### 5.3 Migration, in the order that keeps the suite green

1. **Land §4.** Nothing about handlers changes.
2. **Add the new shape beside the old one**, selected by a definition flag
   (`typeHandlerKind: 'types'`), never by arity sniffing; the call site
   builds the descriptors once and dispatches. User definitions declared
   through `ce.declare` keep the old shape until step 6.
3. **Flip the 213 pure handlers** by the conversion table below. A flip is
   proven by the parity harness (§5.5): for the handler's operator, over
   the suite's corpus, the old-shape call on real operands and the
   new-shape call on descriptors built from the same operands give the same
   type string. Before flipping, grep each handler for exact-string and
   structural comparisons against an operand type (`=== 'finite_integer'`,
   `.type.type === …`, `kind ===` on an operand type) and rewrite them as
   `isSubtype`/`matches` so a literal `0`/`1` does not stop matching.

   | old read | new read | semantics |
   | --- | --- | --- |
   | `ops[i].type.type` / `.type.matches(T)` | `operands[i].type` / `isSubtype(type, T)` | same |
   | `isReal`/`isInteger`/`isRational` on a symbol | `isSubtype(type, 'real' / 'integer' / 'rational') ? true : undefined` | same as today's type channel; `false` only when the type is disjoint |
   | `isFinite` / `isNaN` / `isInfinity` | `facts.finite` | tri-state (§5.2) |
   | `isSame(0)` / `isSame(1)` / `isZero` / `isOne` | `type === '0'` / `type === '1'` | exact; any other literal → `undefined` (precision loss, accepted) |
   | `isSame(k)`, `isLess(k)`, `isGreater(k)` for other `k` | `undefined`, or a numeric-range type when the lattice carries one | precision loss, accepted; each site lists its expected new result |
   | `isPositive`/`isNegative`/`isNonNegative`/`sgn` | `facts.sgn` | pure leaves only |
   | `isConstant` | `facts.closed` | same |
   | `isNumberLiteral` / `numericValue` | `type === '0' \|\| type === '1'` / `facts.concrete` | only `0`/`1` carry a value; other literal reads are precision loss |
   | `.string` on a string literal | `structure.kind === 'text'` + `facts.concrete` | a string literal's content is a pure read; kept as a fact |
   | `.ops`/`.op1`/`.nops`/`.operator` | `structure` | structural readers only (§5.4) |

4. **Rewrite the seven** (and the two `elttype` handlers) against
   `context.derive` and `collectionElementType`, per §5.1: `Map`; `Pipe`
   (implicit mapping decided from the stage's signature type and the
   topic's type — no canonicalization; the §4.1 interim registration then
   has no caller); `Set`/`Set.elttype`/`Interval.elttype`/`JacobianMatrix`
   (sound wider types where evaluation was needed; the evaluation moves to
   `evaluate`); `Sqrt` (`closedRealSign`'s `.N()` → `facts.sgn` where
   known, the wider type otherwise). `Dot` is already pure after §4.1.
5. **Retire the exemption's live callers.** With `Map` and `Pipe` pure, the
   `scratch` branch of `axisMaskOf` has no caller; it stays as a guard,
   tested.
6. **Remove the old shape** once no `library/*.ts` handler uses it; user
   definitions get one release of both shapes and a `MIGRATIONS.md` note.

### 5.4 Handlers that keep a structural view

The structural readers — `Map`/`Zip` element derivation (a mapping
literal's parameters and body), `Block`'s last statement, `Tuple` (arity
only — it reads no operand beyond its type, and may not need `structure`
at all; verify at flip time), the string-literal readers — receive
`structure`, a read-only view with no construction, canonicalization or
evaluation reachable through it. Each says in a comment which structural
fact it reads and why the type does not carry it.

### 5.5 Enforcement and measurement

- **The purity guard (test and dev builds).** Around every handler call and
  every `deriveApplicationType` call: snapshot the four version axes and a
  construction/evaluation counter (incremented by `ce.box`, `ce.function`,
  `ce._fn` with canonicalization, `.canonical` on a non-canonical
  expression, `.evaluate`, `.N`, `ce.declare`, `pushScope`/`popScope`);
  after the call, any change throws in tests (and is reported under a
  `CE_TYPE_PURITY_GUARD` flag in dev). This is what turns "a handler must
  say why" into an enforced invariant; the `PureEngineView` removes the
  mutating methods from the type in addition.
- **Per-offender tests**, cold and warm: for each row of §2.5 and for the
  getter of §4.2, a test that reads `.type` on a fresh engine (cold) and
  again after an unrelated declaration (forced re-derivation) and asserts
  zero drift on every axis and zero construction/evaluation — the
  `pipe-type-read-purity` / `dot-type-read-purity` shape, generalized.
- **The item-219 pin** run against a tree where `axisMaskOf`'s `scratch`
  branch is a no-op shows drift 0 (after step 5); after §4.2 with the
  getter's write path removed rather than masked.
- **The parity harness** (`type-handler-parity.test.ts`): checks in the
  §2.2 shim's mechanism as a test utility; for a named handler, runs the
  old and new shapes over a corpus (the suite's own boxed expressions for
  that operator, collected by a reporter) and diffs the type strings. Step
  3's acceptance is an empty diff per handler; any intended precision loss
  is listed in the diff description with its cause group.
- **§4.4**: the 18 `filter-predicate-errors` rows pass with the runtime
  mode in place; every re-read static-refusal pin states its reason.
- **§3 baseline**: does not grow at any step; a row that leaves it is
  listed with its cause group; any precision lost is a sound *wider* type,
  never a narrower one (the §3 brackets and the §4.5 ceiling are the
  guards).

## 6. Rulings (2026-08-22) and open items

Rulings made by the user to this session on 2026-08-22:

- **R1 — Admission model.** Declared signatures follow the arithmetic
  model: reject at boxing only when provably invalid, admit otherwise,
  check at evaluation. (§4.4.)
- **R2 — Precision.** A less precise derived type is acceptable; the
  hypothesis is that it rarely if ever matters. Literal types are wanted
  for `0` and `1` only. (§1, §4.3.)
- **R3 — Pure facts channel.** Sign, closedness and the `0`/`1` literal
  value reach a handler beside the types; the precision they carry is kept
  because it costs nothing toward the no-side-effects goal. (§5.2 — the
  literal value travels in the type; sign is restricted to pure leaves.)
- **R4 — `.type` becomes a pure read.** Ruled as "the revision moves to a
  write site". **Refined by measurement (§4.2): the pure live read, with
  no write site, is the implementable form — needs re-confirmation.**
- **R5 — `Pipe` and `Dot` fixed now**, as standalone runtime changes.
  (§4.1.)
- **R6 — The residual `Pipe` advance** (the literal's parameter into its
  own `block.localScope`) is accepted as one advance per re-derivation.
- **R7 — `Dot`**: accept the narrowing (`real` → `finite_real`, `integer` →
  `finite_integer` for declared-symbol components); land the pure rewrite.

Earlier rulings this design rests on: the `scratch` exemption (approved at
the item-219 ruling, 2026-08-21); permissive boxing + evaluation guard for
arithmetic (2026-08-19); "inference has to be more likely, not broadest,
and is subject to revision" (2026-08-16).

Open items — genuine decisions, each with a default:

- **O1 — Widening opt-out.** Default: always widen handler results to the
  classic primitive; no per-site opt-out until a consumer needs
  literal-domain overloads (`fib`'s `(z: 0) -> 0` arm).
- **O4 — Rational literal types.** Not wanted under R2; recorded so the 11
  residue rows are understood as accepted precision loss, not a gap.
- **O7 — The `sgn` handler family.** Default: not dispatched from the type
  path (§5.2); a later audit of the family, by the §2.5 method, may widen
  `facts.sgn` to function expressions.

(O2 and O3 of the third draft are prerequisite tasks P1 and P2, §4.6; O5
and O6 were ruled, R6 and R7.)

## 7. Non-goals

- Changing `BoxedNumber.type` for consumers: a literal's public type stays
  `finite_integer`; `0`/`1` literal types are a handler-input convenience.
- Removing the `scratch` exemption: it stays as a guard.
- Converting the remaining ~1429 exact-string type pins; §3's rule applies
  to new ones and to any a later step makes fail.
- The pre-canonicalization validation phase (ROADMAP): this design removes
  its motivating instances and R6's residual is its next one; it is not a
  substitute for it.

## 8. Provenance and attribution

- The problem statement, the goal (no state mutation during type
  derivation), the types-based signature as the means, the `0`/`1` literal
  scope, the precision framing, the arithmetic admission model, and rulings
  R1–R7: the user, 2026-08-22 (to this session; the `scratch` exemption
  approval and the validation-phase idea to session CE-POC, 2026-08-21/22).
- Item 219 and its measurements, the `scratch` exemption's shape
  (`engine-configuration-lifecycle.ts` `axisMaskOf`, both declare routes in
  `engine-declarations.ts`, commit b81ad914), and the value-read experiment
  (§2.2, the shim, the widening walker, `def.type(types)` as the probe):
  session CE-POC, 2026-08-21/22. The typed-hole primitive proposed there is
  superseded by §5.1.
- Step 0 and its dual review, the gate measurements (§2.4), the
  side-effect audit (§2.5), the derivation map (§2.6), the
  `_reviseInferredType` analysis and its staleness finding (§4.2), the
  `Pipe`/`Dot` measurements and fixes (§4.1), and §4–§5 of this draft:
  session compute-engine-85, 2026-08-22, with its subagents. Run logs and
  the full audit/map tables are in that session's scratchpad and task
  outputs.
- The spec review of the third draft (Claude + Codex, 18 findings) is
  `scratchpad/2026-08-22-type-handlers-on-types_SPEC_REVIEW.md` of the same
  session; every finding is addressed in this draft (1 → §5.1; 2 → §4.4;
  3 → §4.2; 4, 5, 7 → §5.5; 6 → §5.2/O7; 8, 9 → §5.3; 10 → §4.6; 11 → §4.1;
  12 → §4.3; 13 → §4.5; 14 → §5.2; 15 → §4.4; 16 → §5.2; 17 → §4.4; 18 →
  the guideline cross-reference).
- ROADMAP entries: "Reading a nested lazy view's type was exponential in
  depth"; "Type handlers as functions of TYPES, not expressions — measured
  2026-08-22"; "Type derivation reaches state mutation at 7 handlers, 2
  `elttype` handlers and 1 getter — AUDITED 2026-08-22";
  "`_reviseInferredType`'s generation gate keys on `semantic`…"; "A
  pre-canonicalization validation phase"; "permissive boxing + eval guard"
  (2026-08-19).
