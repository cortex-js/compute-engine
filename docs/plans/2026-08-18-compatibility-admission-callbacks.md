# Design E — Compatibility admission for callback slots; retiring `callback<S>`

**Status: DRAFT rev 2 (2026-08-18) — the §9 questions are RULED (maintainer,
same day; answers folded in below), the §2 probes corrected to `Map`'s
callback-first calling convention, and R-E2 recast around the already-shipped
static `callback-arity` check. Awaiting spec review. Successor to Design D
(`docs/plans/2026-08-09-design-d-generic-callback-signatures.md`), whose
`callback<S>` constructor this design deletes. Rulings made in the
2026-08-18 conversation:**

- **R-E1 — Admission policy superseded.** The broad-admission contract for
  callback slots (Design D §4 clause 1, and the union-PERMANENT ruling *as it
  applies to callback admission*) is replaced by **compatibility admission**:
  a callback operand is admitted unless it is *provably unusable* (§3). The
  runtime per-element semantics for admitted calls is unchanged.
- **R-E2 — Arity mismatch is rejected at canonicalization.** For the library
  collection operators this is ALREADY SHIPPED: `callbackArityError`
  (`src/compute-engine/library/callback-arity.ts`) statically rejects a
  callback whose parameter count cannot accept what the operator supplies,
  with the `callback-arity` error code and per-operator prose (probed
  2026-08-18: `Map(f, xs, ys)` with unary `f`, `Filter`/`CountIf` with a
  binary predicate — all `isValid === false` at canonicalization). The
  ruling CONFIRMS that behavior and EXTENDS it, under Q1's uniformity, to
  arrow-typed slots that lack it today — user-declared operators foremost
  (probed: a user-declared `((number) -> number) -> number` operator admits
  a binary lambda today and fails only at application). The dynamic
  application error (`Too many arguments …`,
  `src/compute-engine/function-utils.ts:2523`) remains the fallback where
  arity cannot be read statically (bare-`function` symbols).
- **R-E3 — Callback-to-data inference is DEFERRED.** Type variables are solved
  from data operands only, exactly as today. A callback's parameter types
  never constrain `T` — neither for admission (compatibility makes that
  unnecessary) nor for inference writes. Revisitable later without
  re-touching admission.
- **R-E4 — `callback<S>` is retired**, not re-housed (the parameter-facet
  alternative considered in the same conversation is rejected along with the
  status quo): converted slots become ordinary arrow types, and the entire
  erasure apparatus is deleted (§7).

## 1. Why revisit (the motivation is the complexity, not a bug)

Design D solved a real collision: an honest arrow at a callback slot is
checked contravariantly, which statically rejects three operand classes the
engine deliberately supports (named callbacks narrower than the instantiated
slot, wildcard `function`-typed symbols, mixed-element sources). Its fix —
`callback<S>`, a type constructor that *is* `function` for every admission
decision while carrying `S` for contextual typing only — preserved every
pinned behavior byte-for-byte. That was the acceptance bar, and it was met.

The cost has since become visible (maintainer, 2026-08-18):

- **The constructor is hard to explain.** "A type that is a different type
  for subtyping purposes" needs five contract clauses to state.
- **It leaks to external consumers.** Internal serialization deliberately
  preserves `callback<S>` (Design D clause 5; `src/common/type/serialize.ts:261`),
  so Tycho's round-trip serializer sees it and hand-rolls its own erasure;
  their type handling got more complicated because of a constructor that
  carries no information they can use.
- **The erasure discipline is default-unsafe.** Because the advisory data
  lives *inside* the type, every whole-type consumer must actively erase it.
  The helpers are called from ten files
  (`src/common/type/callback.ts` grep, 2026-08-18: `subtype.ts`, `reduce.ts`,
  `display.ts`, `validate.ts`, `overload.ts`, `generic-instantiation.ts`,
  `effects-inference.ts`, `boxed-symbol.ts`, `library/core.ts`), `reduceType`
  needed a union tie-break rule for it, and the R-D5 display projection went
  through three revisions of real bugs (`nothing`-collapse of intersections,
  a thrown `unsolvable-type-variable`, a flipped `.isPolymorphic`) — all
  taxes on hiding the constructor.

The re-derivation: Design D preserved the broad-admission ruling *literally*.
This design preserves its *intent* — heterogeneous data works, wildcard
callbacks work, mismatches surface per element — under a rule that ordinary
arrow types can express, so the special constructor becomes unnecessary.

## 2. The intent being preserved, stated as behavior

Probes (2026-08-18, current main):

```
Map(x |-> sqrt(x), [16, -4, "banana", 81])   → [4, 2i, NaN, 9]    (KEEP)
CountIf(zs, IsPrime)          zs undeclared  → valid; zs: collection<unknown>  (KEEP)
CountIf(xs, p)                p: function    → valid               (KEEP)
CountIf([2,3,"a",4], IsPrime)               → Error(incompatible-type, "number", "string")
                                              … at EVALUATION      (KEEP admission;
                                              the per-element behavior is unchanged)
Map(f, xs, ys)             f a unary lambda → Error(callback-arity, …), isValid
                                              false at CANONICALIZATION — already
                                              shipped                (KEEP; R-E2 confirms)
Filter(names, IsPrime)     names: list<string> → valid today; the predicate can
                                              never succeed on any element
                                              (BECOMES a canonicalization error)
MyOp((a, b) |-> a + b)     user-declared MyOp:
                           ((number) -> number) -> number → valid today, fails
                                              only at application
                                              (BECOMES a canonicalization
                                              error — R-E2 under Q1 uniformity)
```

(`Map` takes its callback FIRST — `Map(f, sources…)` — per the settled
calling-convention flip; the signature at §5 reflects it.)

The first five lines are the product intent: spreadsheet-like tolerance of
messy data, gradual typing of unknowns, per-element resolution at runtime —
plus the static arity net the collection operators already have. The last
two lines are programs that cannot do anything but fail; moving their
failure to declaration time with a precise message is the win that pays for
the migration.

## 3. The core change: the compatibility relation

Argument validation currently admits an operand at a callback slot by erasing
the slot to the primitive `function` (`groundParam`,
`src/compute-engine/boxed-expression/validate.ts` — the erasure comment block
documents Design D clause 1). Under this design the slot keeps its
instantiated arrow type, and the admission question changes from

> is the operand's type a **subtype** of the slot's arrow? (contravariant —
> rejects working programs)

to

> is the operand **provably unusable** at this slot? (reject only certain
> nonsense; admit everything else and let the runtime stay the honest party)

**Definition.** Let `P = (p₁ … pₙ) e -> r` be the slot's arrow after
instantiation (variables solved from data operands per R-E3; an unsolved
variable instantiates to `unknown` for this check). Let `F` be the operand's
type. The operand is **admitted** unless one of the following holds:

1. **Not callable.** `F` is provably not a function value (e.g. a `string`
   literal at a predicate slot). Unchanged from today — the `function`
   primitive gate already rejects these.
2. **Arity mismatch (R-E2).** `F` is an arrow whose required/optional/
   variadic structure cannot accept `n` arguments. Rejected at
   canonicalization. NOT new machinery: the shipped `callbackArityError`
   module (`src/compute-engine/library/callback-arity.ts`) is the
   implementation — it already reads an operand's arity range from function
   literals and declared signatures, deliberately DECLINES when arity cannot
   be read statically (bare `function`, unknown-typed symbols — those stay
   admitted), and phrases the diagnostic per operator. The design's delta is
   wiring it into the uniform relation so user-declared arrow slots get it
   too.
3. **Provably disjoint parameter.** For some position `i`, `F`'s parameter
   type `fᵢ` and the slot's `pᵢ` are provably disjoint —
   `provablyDisjoint(pᵢ, fᵢ)` (`src/common/type/subtype.ts:454`). `unknown`,
   `any`, and bare `function` overlap everything, so wildcard operands and
   unsolved slots always pass. Partial overlap (`number` vs
   `integer|string`) passes — that is the messy-data idiom.
4. **Provably disjoint result.** `F`'s declared result and `r` are provably
   disjoint (same predicate, same `unknown`-tolerance). `FlatMap`'s
   scalar-result tolerance and the folds' `unknown` accumulator survive
   because their slot spellings put `unknown`/variables in those positions
   (§5).

Notes on the predicate:

- `provablyDisjoint` **asserts on open (variable-bearing) types**, so the
  check runs strictly on the instantiated projection. A slot that is still
  open after the solve admits everything at that position — this is the
  existing `paramStillOpen → 'any'` path in `groundParam`, kept verbatim.
- This is an **argument-validation relation, not a lattice change**.
  `isSubtype`, `.matches`, `reduceType` and the type algebra are untouched;
  arrows keep their sound contravariant subtyping everywhere types are
  *compared*. Only the question validation asks about a function-valued
  *operand* changes. (This is what makes the design explainable in one
  sentence: "callback slots are checked for compatibility, not subtyping,
  because collections are heterogeneous and application is per-element.")
- **Uniformity question — needs a ruling before implementation** (§9 Q1):
  does compatibility admission apply to *every* arrow-typed parameter slot
  (library and user-declared alike), or only to the converted library
  operators? Recommended: **uniform**. One rule, no second-class arrows, and
  it is the same permissive-declaration bias the engine already has. The
  cost: a user-declared operator with an arrow-typed parameter today gets
  strict contravariant checking, which uniform compatibility loosens (a
  narrower-than-slot callback would newly be admitted and resolve per
  element). The alternative — compatibility only at designated slots —
  reintroduces exactly the two-kinds-of-arrows problem this design exists to
  delete.

## 4. The effects interaction (discovered 2026-08-18 — do not skip)

In this type system **a bare arrow demands a PURE callback**
(`doc/08-guide-types.md` §"a written signature constrains callbacks"):
`(T) -> boolean` requires purity; the effect-top spelling `(T) any -> boolean`
accepts both pure and effectful callbacks. Today the effects call-boundary
machinery never fires for library collection operators, because **no library
operator declares a signature-typed callback slot** — that enumeration is
pinned EMPTY in `test/compute-engine/effects-call-boundary.test.ts`
(`callback<S>` erases to `function` before the effects gate reads it, per
the `effects-inference.ts` erasure call site).

Converting slots to honest arrows activates that machinery for the first
time. Therefore:

- **Every converted slot is spelled with the effect-top form**:
  `predicate: (T) any -> boolean`, `mapping: (T) any -> U`, etc. An
  effectful callback (`Filter(xs, x |-> (Print(x); x > 1))`) must remain
  admitted — a pure-demanding spelling would be a silent semantic change
  smuggled in by the migration.
- The migration's acceptance suite includes an **effectful-callback probe
  through every converted operator**, and the pinned-empty enumeration in
  `effects-call-boundary.test.ts` flips to pin the full converted inventory
  with its `any` effect slots.
- Whether any operator should *ever* demand purity of its callback (e.g. a
  future parallel evaluator) is out of scope; the migration is
  effect-neutral by construction.

## 5. Signature respellings (inventory, from `src/compute-engine/library/collections.ts` at 2026-08-18)

Mechanical rule: `callback<S>` → `S` with the effect slot set to `any`;
everything else in the signature (names, optionality, `where` clause,
result) unchanged. Current line numbers for the sweep:

| Operator (line) | After |
|---|---|
| `Any` / `All` (3471, 3500) | `(collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T` |
| `Map` (3550) | `(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U` |
| `Filter` (3883) | `(collection<T>, predicate: (T) any -> boolean) -> collection where T` |
| `Reduce` (4183) | `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T` |
| `Fold` (4378) | `(reducer: (unknown, T) any -> unknown, initial: value, collection<T>) -> value where T` |
| `Scan` (4407) | `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T` |
| `TakeWhile` (4593) / `DropWhile` (4737) | `(collection<T>, predicate: (T) any -> boolean) -> collection where T` |
| `FlatMap` (4834) | `(collection<T>, mapping: (T) any -> U) -> list where T, U` |
| `CountIf` (7585) / `Find` (7625) / `IndexWhere` (7668) / `Position` (7707) | predicate slot `(T) any -> boolean`, results unchanged |
| `Partition` (8436) | `(collection<T>, integer \| ((T) any -> boolean), integer?) -> list<list<T>> where T` |

Contract notes carried over from Design D, still true under E:

- **Results stay with the `type:` handlers** (Design D §7 rule 1) — the type
  language still cannot express "same collection kind and indexedness as the
  source"; nothing here changes that.
- **The folds' accumulator stays `unknown`** (Design D §12.1): an
  accumulator may change type mid-fold, `unknown` is compatible with
  everything (§3 rule 3), and the stamp gate (`admissibleElementType`)
  declines `unknown`, so the accumulator parameter of an inline reducer
  stays bare. The probe that ratified this
  (`Reduce([1,2,3], (a,x) |-> a/x, 1) → 1/6`) must stay green.
- **`Map`'s variadic (zip) form**: the slot arrow is unary `(T) any -> U`,
  and multi-source zips pass callbacks of matching arity. The arity gate
  for the zip form already works this way today: `callbackArityError`
  checks the callback against the **number of sources actually supplied**
  (its `CallbackSupply` carries the count and the per-operator phrasing),
  not the declared unary arrow — kept verbatim. The heterogeneous zip stays
  admitted (its per-parameter overlap is checked against the respective
  source's element type where solvable, else `unknown`); Design D §6's
  "the variadic form is not stamped" stays true (stamping is unchanged by
  this design).

`Sort` / `ChunkBy` / other comparator-slot operators (Design D phase 4,
never done): now trivial — spell the comparator `(T, T) any -> number` in
the same sweep, or leave bare `function` and convert later; recommended in
the sweep, since under E a conversion is a one-line respelling with no new
machinery.

## 6. Where the checks run (route parity)

The compatibility and arity gates run **at canonicalization**, at the same
hook points the contextual stamp uses today (`applyOperatorDefinition`,
strict AND lazy branches, plus the value-def route) — NOT only in
`validateArguments`:

- `Map` is `lazy` **with** a `canonical` handler, so `validateArguments`
  never runs on it (Design D §13.1); a gate living only there would silently
  skip the hottest operator.
- The lazy-route contract holds: the gate reads the callback operand's
  TYPE (a named symbol's declared type, an inline literal's annotated
  signature) and the instantiated slot; it never forces evaluation of a held
  operand. Sibling data operands needed for instantiation are canonicalized
  exactly as the existing contextual solve already does (Design D §5 step 1).
- Rejection produces an error expression (`isValid === false`) in the
  operand position, following the existing validation-error conventions:
  `incompatible-type` with the instantiated slot arrow and the operand's
  arrow as the expected/actual pair for §3 rules 3–4; the shipped
  `callback-arity` diagnostic for rule 2 (§9 Q2, RULED: no new code).
- Per the lazy-operator testing trap (CLAUDE.md "Common API Traps"), every
  converted operator's acceptance tests probe all three routes: Epsil,
  `ce.box` (raw MathJSON), and `ce.parse`.

**Contextual stamping is unchanged in mechanism.** The §5 solve, the
stamp-back into inline literals, `admissibleElementType`, the no-overwrite
guard for hand annotations, and R-D4 arm resolution all survive verbatim;
only the *trigger* changes from "slot has `kind: 'callback'`"
(`hasCallbackParam`, `isCallbackType`) to "slot is an arrow type". This also
closes Design D §9b's reference-hidden-slot gap for free: an alias that
expands to an arrow is an arrow.

## 7. Deletion inventory

Everything below exists only to hide `callback<S>` and goes away:

- `src/common/type/callback.ts` — the module (`isCallbackType`,
  `eraseCallbackType`, `deepEraseCallbackTypes`) and all call sites
  (§1's ten-file list).
- The `CallbackType` kind: `types.ts`, `parser.ts` (grammar rule
  `<callback_type>`, the identifier hijack and its diagnostic),
  `serialize.ts` case, `instantiate.ts`, `reduce.ts` — including the
  union tie-break ("between two mutually-subtype members the `callback<S>`
  one is retained") and its pin in `test/common/types.test.ts`.
- The R-D5 display apparatus: `groundedDisplayType` (`display.ts`),
  `BoxedType.withDisplayString` (if nothing else uses it), the display-side
  erasure calls in `boxed-symbol.ts`, `engine-scope.ts`'s `defToString`
  callback branch, `library/core.ts`'s grounded-signature comments.
- Design D's planning-pass scan (`hasCallbackParam`) — replaced by the
  arrow-slot trigger, which reuses the same walk.
- Tycho's hand-rolled erasure (their repo; coordinate, do not do it for
  them — §8).

`callback<…>` disappears from the type grammar. A user signature that spells
it becomes a parse error with a migration hint ("write the arrow directly;
admission of callbacks is by compatibility"). Grep gate for the sweep:
`grep -rn "callback<\|CallbackType\|isCallbackType\|EraseCallback" src/ test/`
ends with hits only in historical plan docs.

## 8. Displayed signatures and consumer coordination (deliberate churn)

R-D5's premise — "printing the arrow would claim a narrowing that did not
happen" — is void under E: the arrow now states the real (compatibility)
contract. Signatures therefore display as honest polytypes:

```
before:  CountIf: (collection, predicate: function) -> integer
after:   CountIf: (collection<T>, predicate: (T) any -> boolean) -> integer where T
```

This churns every runtime display surface R-D5 protected (`Signature`
operator, scope listing, `BoxedOperatorDefinition.toJSON`, `.type`,
documentation). It is the point of the design — declarations get simpler and
truer — but it is **visible to Tycho** (hover, docs, their serializer's
golden files). Coordination protocol:

1. Enumerate the full before/after display table in the implementation PR
   (mechanically: print every library definition's signature on both sides).
2. Notify Tycho with that table BEFORE landing; their erasure deletion and
   golden-file updates ride the same coordinated window.
3. Type-string round-tripping: strings Tycho may have persisted containing
   `callback<…>` will no longer parse. If their corpus contains any
   (they should grep), provide a one-shot migration note — the rewrite is
   the §5 mechanical rule. (Engine-side, nothing persists type strings.)

## 9. The open questions — ALL RULED (maintainer, 2026-08-18)

The four questions were put with the first draft and ruled the same day.
Each entry keeps the question for context; the ruling is authoritative.

1. **Uniformity of compatibility admission — RULED: UNIFORM.** Every
   arrow-typed parameter slot gets the §3 relation, user-declared operators
   included; there is no designated-slot mechanism (which would have been a
   smaller `callback<>` by another name). Two consequences, both accepted:
   a user-declared arrow slot LOSES strict contravariant admission (a
   narrower-than-slot callback is newly admitted and resolves per element
   at application), and it GAINS the static arity and disjointness checks
   it lacks today (§2's `MyOp` probe: a binary lambda at a unary slot is
   currently admitted and fails only at application — under E it rejects at
   canonicalization).
2. **Arity diagnostic — RULED: REUSE, no new error code.** The shipped
   `callback-arity` code and its `callbackArityError` machinery
   (`src/compute-engine/library/callback-arity.ts`) are the implementation;
   extending them to user-declared slots keeps the established wording
   ("`<op>` calls its callback with N arguments (…)") and the
   tuple-destructuring hint. The dynamic `Too many arguments` error from
   direct application is untouched as the fallback.
3. **Disjoint result — RULED: REJECT**, symmetric with the disjoint-
   parameter rule (§3 rule 4 stands as specified). No warning tier; a
   predicate returning a provably-non-boolean is an error at
   canonicalization.
4. **`Partition`'s union slot — RULED: KEEP the union spelling**
   (`integer | ((T) any -> boolean)`), with compatibility applying to the
   arrow arm. Rule U already admits the union, and the SLOT-form R-D4
   resolution machinery it uses survives for user overload sets.

## 10. What this deliberately does NOT change

- Runtime per-element semantics for admitted calls — error values, `NaN`s,
  singleton lifts, all unchanged. The union-PERMANENT ruling's *runtime*
  half stands; only its admission half is superseded (R-E1).
- The contextual stamp and its gates (§6). Fusion / exact-tier / compile
  gates key on the stamped annotation and are indifferent to the trigger
  (Design D §3.4) — `map-fusion` / `map-exact-compile` stay green.
- The type lattice: subtyping, `.matches`, `reduceType` (minus the dead
  tie-break). `Ground <: Poly` behavior, polytype display for USER generics
  (`generic-function-literals.test.ts` §5.1/R4) — untouched.
- Inference direction (R-E3): data-first solving; the `collection<unknown>`
  infer-write for undeclared sources stays as is.
- The future `Pipe` design (Design D §11): its whole-vs-elementwise dispatch
  happens BEFORE lowering to `Map`, so whole-collection consumers (`Total`)
  are never checked against the element arrow. One delta to record there:
  the dispatch table's "bare-`function` symbol → dynamic" row is unchanged,
  and its "named fn with scalar param" row now gets the compatibility gate
  after lowering, which can only reject provably-disjoint pipes — desirable.

## 11. Pin migration inventory

| File | Fate |
|---|---|
| `test/compute-engine/collection-callback-signatures.test.ts` | Rewritten around R-E1: the operator-table pins keep every admitted case (named narrower-than-slot, wildcard, inline with undeclared fn); the doc-comment rationale ("why the rest stay on the primitive") is replaced by the compatibility rationale; NEW pins for the disjointness rejections and the user-declared-slot cases (the library operators' `callback-arity` pins already exist and stay). |
| `test/compute-engine/design-d-callback-contract.test.ts` | Clause pins retired with the constructor; the behavioral pins (admission cases, stamp cases) migrate into the file above or the operator suites. Keep a deletion pin asserting `callback<` no longer parses. |
| `test/compute-engine/lambda-param-element-inference.test.ts` | Stamp behavior unchanged — survives as is, minus any assertion reading a definition's `callback<S>` signature string. |
| `test/compute-engine/effects-call-boundary.test.ts` | The pinned-EMPTY enumeration flips to pin the full converted inventory with `any` effect slots (§4); add the effectful-callback probes. |
| `test/compute-engine/type-variables-collections.test.ts` | `Partition` definition-signature expectation updated to the arrow spelling; the byte-identical-display companion assertion is retired (display now intentionally differs — §8). |
| `test/common/types.test.ts` | `reduceType` tie-break pin deleted with the tie-break. |
| `test/compute-engine/generic-function-literals.test.ts` | Untouched (user-polytype display never depended on callbacks). |

Snapshot blast radius: expression serialization is expected at ZERO churn
(same argument as Design D §8 — serializers drop `Typed` wrappers, and the
stamp is unchanged); signature-display churn is total across converted
operators and is enumerated for review per §8, never absorbed silently.
Measure both with a full-suite run before staging.

## 12. Migration plan

1. **Phase E0 — the relation.** Implement the disjointness half of the
   compatibility check (§3 rules 1, 3, 4) as a pure function in
   `src/common/type/` beside `provablyDisjoint` (it needs nothing from the
   engine), with direct unit tests: overlap admits, disjoint rejects,
   `unknown`/bare-`function` exempt, open-slot exempt. The arity half
   (rule 2) is NOT reimplemented — the shipped `callbackArityError` module
   stays where it is; E1/E3 wire the two halves together at the §6 hook
   points.
2. **Phase E1 — one eager operator (`CountIf`)**, wired at the §6 hook
   points: respell the signature, keep the stamp, add the rejection pins,
   three-route probes, effectful-callback probe. This phase proves the
   effects interaction (§4) before it multiplies.
3. **Phase E2 — one lazy operator (`Filter`)**, proving the lazy-route gate
   and the `Map`-style no-`validateArguments` path (via `Filter` first;
   `Map` itself lands here too, with the zip arity rule of §5).
4. **Phase E3 — the sweep**: remaining §5 respellings (including the
   comparator slots if Q-ruled in), the deletion inventory (§7), the pin
   migration (§11), the display-table enumeration, Tycho notification (§8).
5. Each phase: `npm run typecheck`, targeted suites, madge after the
   `callback.ts` deletion (breaking an import can create a new cycle), and
   the staging-status protocol.

## 13. Acceptance criteria

- The §2 KEEP table byte-identical (evaluation, `.isValid`, inferred types)
  — including the already-shipped `callback-arity` rejections, whose
  messages must not churn.
- `Filter(names, IsPrime)` with `names: list<string>` → invalid at
  canonicalization, `incompatible-type` naming both arrows.
- The user-declared cases (Q1 uniformity): a binary lambda at a
  user-declared `((number) -> number) -> number` slot → invalid at
  canonicalization with the `callback-arity` diagnostic; a
  narrower-than-slot named callback at the same slot → newly ADMITTED,
  resolving per element at application.
- `Filter(xs, x |-> (Print(x); x > 1))` admitted and evaluating (§4).
- Stamping unchanged: `CountIf(points, pt |-> pt.1 == 0)` over
  `list<tuple<…>>` stamps/evaluates/compiles identically to today;
  `map-fusion` and `map-exact-compile` green.
- `grep` gate of §7 clean; `npm run check:deps` clean; zero
  expression-serialization snapshot churn; the signature-display delta
  enumerated in the PR.
