# Design D — Generic contextual callback types

**Status: revision 4 (2026-08-10) — PHASES 0, 0b, 1, 2 AND 3 ALL
IMPLEMENTED. Rulings made: §6 single shared `T`, RE-RULED rev 4
(variadic `Map` clause is NOT stamped — R-D3/R-D6 retired); §4
contract; R-D2′ (both inline and named contribute result inference);
R-D4 (resolve-then-stamp); R-D5 (runtime display erases to the GROUND
form; documentation shows the contextual form). The
`callbackElementOf` metadata mechanism — its types, its definition
flag, its four wiring sites and its `box.ts` trigger — was DELETED
outright with its last consumer in phase 3. Only phase-4 scope
(comparator slots) remains open. §9b records the known limits;
§12 and §13 record how phases 2 and 3 were actually built.**

Successor to the `callbackElementOf` metadata mechanism of
`docs/plans/2026-08-08-lambda-param-element-inference.md` ("the plan
doc"). Builds on type-variables v1
(`docs/plans/2026-08-01-type-variables-design.md`, shipped 2026-08-04).

Revision 2 recasts the design from "ordinary generic arrow parameters"
to **generic contextual callback types**: revision 1 asked one generic
arrow to serve two different purposes — contextual typing of inline
literals AND callback admission — and the maintainer's review showed the
second purpose breaks ratified behavior (§2, findings F1/F4). The two
concerns are now separated in the type language (§4).

## 1. Motivation

The element-type inference track gave inline callback lambdas their
parameter types through two triggers: a signature-driven trigger and the
`callbackElementOf` metadata on 15 builtin collection operators. The
metadata's shape (`{1: 0}`, `'last'`, `'preceding'`, arrays, `null`)
was judged too convoluted (maintainer, 2026-08-10). The element-of link
belongs in the signature; this design moves it there without changing
any admission or evaluation behavior that is ratified today.

## 2. Evidence base (probed 2026-08-10; maintainer review probes marked ★)

- **The eager solver already instantiates from data operands.** A
  `forall T. (collection<T>, (T) -> boolean) -> list<T>` callee applied
  to a tuple list plus an UNANNOTATED inline lambda validates, with `T`
  correctly instantiated in the result type; only the stamp-back into
  the literal is missing.
- **★ The solver is deliberately IDLE for lazy operators.**
  `solveArm` (`generic-instantiation.ts` §4.5 carve-out) solves against
  NO actuals when `ctx.lazy` — building the actuals array would force
  `.type` on unbound operands. Probe: otherwise-identical eager and lazy
  generic operators produce `list<finite_integer>` vs `list<unknown>`.
  Map/Filter are lazy, so "run the existing instantiation" is NOT a
  description of the mechanism — §5 specifies the distinct contextual
  solve.
- **★ A plain generic arrow narrows admission for NAMED callbacks.**
  Probed: a shared-`T` zip over integer and string sources with a named
  callback typed `(integer, string) -> …` is REJECTED against the
  instantiated `(integer | string+) -> …`; a union-typed `Filter` source
  with a narrower named predicate fails at the call boundary where today
  it produces per-element dynamic behavior. `admissibleElementType` only
  gates STAMPING — it cannot gate arrow validation. This is the finding
  that forces the `callback<…>` separation (§4).
- **Contravariance works for instantiated slots** (`IsPrime`/`IsEven`
  pass a `(T) -> boolean` slot with `T` bound) — but per the previous
  finding, "works for some named callbacks" is not "preserves admission
  for all of them".
- **The naive variadic spelling declares but does not apply**
  (`collection<T>+` followed by a required parameter violates the
  required→optional→variadic consumption model).
- **★ `FlatMap` deliberately accepts scalar callback results** and
  retains them as singleton elements; a `(T) -> collection<U>` slot
  rejects that (probed). Result-side arrows can change contracts too —
  §7's inventory rules.

## 3. What transfers unchanged (ratified, trigger-independent)

1. **The admission gate gates the stamp under D too.**
   `admissibleElementType` applies to every contextual stamp exactly as
   it applies to the metadata trigger — the union-PERMANENT ruling, the
   `never`/abstract-supertype exclusions, all of it. Only the element-of
   *link* is replaced.
2. **Annotation-as-contract** (plan doc ruling 2), including the
   ratified retained-expression retraction semantics.
3. **Sharing**: symbol-valued callbacks are never rebuilt — and under
   this revision (§4), never *re-validated* against the contextual type
   either.
4. **Fusion / exact-tier / compile gates** key on the stamped annotation
   and are indifferent to the trigger.

## 4. The core construct: `callback<S>`

A new parameter-type constructor, spelled in signatures as
`callback<(T) -> boolean>` (exact surface spelling to be settled — §9
R-D5). Semantics:

- **Admission**: an operand at a `callback<S>` slot is admitted by
  TODAY'S broad function contract — the same admission the primitive
  `function` slot grants now (named functions of any compatible-or-
  unknown shape, bare-`function`-typed symbols, inline literals,
  operator names). `S` plays NO role in admission. This preserves,
  byte-for-byte, every pinned behavior in
  `collection-callback-signatures.test.ts` and the dynamic per-element
  semantics the union rulings protect: a narrower-than-`S` named
  predicate still enters and still errors (or not) per element at
  application time.
- **Contextual typing**: `S` is used ONLY to contextually type an
  INLINE `Function` literal at that slot — the stamp-back of §5,
  parameter-wise, gated by `admissibleElementType`.
- **Inference contribution**: the operand's ACTUAL type (a named
  callback's own signature, or the rebuilt literal's signature) may
  contribute constraints to result-side variables (`U` in
  `FlatMap`-like shapes) — flowing FROM the callback INTO the solve,
  never the reverse for admission.
**The precise contract** (ruled with the phase-0 ratification — these
five clauses are the constructor's definition, each independently
testable):

1. **Ordinary admission and subtyping see only `function`.** Every
   subtype query, `.matches`, and argument-validation decision treats
   `callback<S>` as the primitive `function`.
2. **Contextual solving traverses only `S`'s PARAMETER types** — the
   domain solve (§5 step 2) reads `T` occurrences in `S`'s parameters
   and nothing else.
3. **Result inference traverses only `S`'s RESULT type.** A named
   callback's own parameter types must NEVER constrain `T` — the flow
   from the operand into the solve is result-side only.
4. **Free-variable discovery and substitution retain variables inside
   `S`** — `callback<(T) -> U>` contributes `T` and `U` to the
   signature's `forall` accounting, and instantiation substitutes
   inside `S` normally.
5. **Internal type serialization preserves `callback<S>` for
   round-tripping** (typeToString/parse round-trips, dedup keys), even
   where user-facing display erases it (display is R-D5, now display
   ONLY).

Consequences: revision 1's R-D1 (bare-`function` provisional admission)
and most of R-D2 (unknown-result admission) dissolve — they were
exceptions needed only because admission was being read off the arrow.
What remains of R-D2 is the inference-contribution rule (clause 3's
flow, scoped by R-D2′).

## 5. The contextual solve (lazy operators included)

The §4.5 lazy carve-out stays authoritative for ordinary generic
validation. Contextual callback typing is a DISTINCT, narrower pass at
the same hook points the metadata trigger uses today
(`applyOperatorDefinition` strict + lazy branches, and the value-def
route):

1. **Canonicalize only the non-callback operands that contribute
   constraints** — the operands whose positions mention a variable that
   `S`'s parameters read (the lazy branch already does exactly this for
   the metadata trigger — explicit `.canonical` on the sibling, never
   forcing the callback, and never forcing an operand the solve does
   not need).
2. **Solve the callback-DOMAIN variables** (`T`) from those operands
   alone — a targeted solve that runs even for lazy operators, because
   step 1 supplied bound operands. This is new machinery (a restricted
   entry point beside `solveArm`, not a change to its lazy carve-out;
   the carve-out's rationale — never force unbound operands — is
   honored by construction).
3. **Contextually rebuild** each inline literal at a `callback<S>` slot
   with the instantiated parameter types, per-parameter, through the
   existing rebuild helper and the `admissibleElementType` gate.
4. **Solve result-side variables** (`U`) with the rebuilt callback's
   (or a named callback's) actual type contributing constraints.
5. **Validate** under the existing lazy/eager policy, unchanged —
   admission at `callback<S>` slots per §4.

Steps 2 and 4 are the genuinely new solver surface; the design does not
call this "the existing solver".

## 6. Variadic operators (RE-RULED 2026-08-10, revision 4: the variadic form is NOT stamped)

**Maintainer ruling (supersedes the rev-1 shared-`T` variadic stamping
and retires R-D3/R-D6 as previously drafted):** `Map` becomes TWO
clauses —

- **unary clause** — `forall T, U. (collection<T>, callback<(T) -> U>)
  -> list<U>`: the full generic contextual treatment, like every other
  converted operator;
- **variadic clause** — the multi-collection `Map(xs, ys, …, f)` form
  keeps a plain `function` slot with NO contextual stamp and today's
  dynamic behavior, validated exactly as today.

Consequences, all deliberate:

- **R-D6 dies outright** — it existed only to stamp the variadic arrow.
  The rev-3 partial-pairing questions (unary-over-two, ternary-over-two)
  become moot: the variadic clause never stamps anything, and today's
  evaluation and diagnostics ("expected 1, got 2"; residual unary
  functions) are preserved unchanged by construction.
- **R-D3 shrinks to nothing** — no consumption-model extension is
  needed; today's `Map` validation already works and the variadic
  clause keeps it verbatim.
- **No user breakage; broadcast untouched.** The cost — variadic
  callbacks lose contextual annotation (including the homogeneous-zip
  stamping the interim metadata `'preceding'` spelling provided) — is
  one the rulings had already accepted for every heterogeneous case,
  and the acceptance bar here was always EVALUATION AND DIAGNOSTIC
  parity, not annotation parity.
- Clause selection between the two arms is R-D4 resolve-then-stamp
  (RULED — §9), which the `Pipe` consumer (§11) needs anyway.

## 7. Signature inventory — with contract-preservation rules

Two standing rules govern every conversion (from the review's F4):

- **Result types stay with the `type:` handlers wherever the type
  language cannot express today's precise result.** `Filter`/
  `TakeWhile`/`DropWhile` preserve source collection kind and
  indexedness (not a flat `list<T>`); the signature's result may be
  widened or omitted in favor of the handler — converting a slot to
  `callback<…>` does NOT require converting the result.
- **The contextual `S` describes the STAMP, not the operator's full
  tolerance.** `FlatMap`'s callback may return a scalar (singleton
  lift, deliberate): its slot is simply `callback<(T) -> U>` — since
  `S` does not govern admission, a scalar result binds `U` to the
  scalar and a collection result binds `U` to that collection type, and
  the existing `type:` handler performs the singleton-versus-flattened
  element calculation (rev 3: the earlier
  `callback<(T) -> collection<U> | U>` spelling was dropped — it was
  unnecessary and risked ambiguous union inference). Seedless
  `Reduce`'s reducer may change type mid-fold today; `(T, T) -> T`
  would forbid that, so its contextual `S` stamps the ELEMENT parameter
  only (`(unknown, T) -> unknown` shape or equivalent), preserving
  current tolerance. Each conversion gets an individual
  before/after-contract audit in its phase.

Sketches (slots only; results per the rules above):

| Operator | Contextual slot (sketch) |
|---|---|
| `Filter` / `TakeWhile` / `DropWhile` | `callback<(T) -> boolean>` |
| `CountIf` / `Find` / `IndexWhere` / `Position` | `callback<(T) -> boolean>` |
| `Any` / `All` | optional `callback<(T) -> boolean>` |
| `FlatMap` | `callback<(T) -> U>` (handler computes singleton-vs-flatten) |
| `Partition` | predicate arm `callback<(T) -> boolean>`; SIZE arm unchanged |
| `Reduce` / `Scan` | seeded: `callback<(U, T) -> U>` with `U` from init; seedless: element-param-only stamp (see rule 2) |
| `Fold` | as seeded `Reduce`, callback first |
| `Map` | unary clause `forall T, U. (collection<T>, callback<(T) -> U>) -> list<U>`; variadic clause = plain `function`, unstamped (§6, re-ruled) |

Multi-clause definitions (`Reduce`, `Partition`, `Map`): the stamp runs
against the RESOLVED clause — resolve-then-stamp (§9 R-D4, RULED).

## 8. Migration plan

Per-operator, incremental:

1. **Phase 0 — `CountIf` (eager).** Lands: the `callback<S>` type
   constructor, the contextual solve for the STRICT path, the
   stamp-back, and deletion of `CountIf`'s metadata entry. Eager first
   so phase 0 exercises the mechanism without the lazy-solve machinery.
   All `collection-callback-signatures.test.ts` pins must pass
   UNCHANGED (that is the point of §4).
2. **Phase 0b — `Filter` (lazy).** Adds the lazy-branch contextual
   solve (§5 steps 1–2 on the lazy path). The plan doc's flagship pins
   (union example, sharing, vectorization default) re-verified.
3. **Phase 1** — the single-CLAUSE single-collection family (`Find`,
   `IndexWhere`, `Position`, `Any`, `All`, `TakeWhile`, `DropWhile`,
   `FlatMap` — the last exercising R-D2′ result inference), each with
   its contract audit (F4 rule), each deleting its metadata entry.
4. **Phase 2** — the R-D4 resolve-then-stamp machinery, then the
   multi-clause conversions: `Partition` (predicate arm vs SIZE arm),
   `Reduce` / `Scan` (seeded vs seedless clauses;
   element-param-only stamp for seedless), `Fold`.
5. **Phase 3** — `Map`'s two clauses (§6, re-ruled: unary generic +
   variadic plain-`function`). `callbackElementOf`, its types, and its
   wiring deleted outright.
6. **Phase 4** (optional second wave, NOT part of the current
   commit scope) — comparator slots (`Sort`, `ChunkBy`, …).

Each phase: route parity (Epsil / box / parse); fusion/exact-tier and
compile-gate suites green; the plan doc's negative pins untouched.
**Churn expectations, stated precisely:** zero churn in EXPRESSION
serialization (serializers drop `Typed` wrappers); operator-SIGNATURE
display (`signatureIn`-style output, docs) is expected to change where
conversions land and is reviewed per phase, not absorbed silently.

## 9. Open questions (rulings needed)

1. **R-D2′ — inference contribution. RULED 2026-08-10: BOTH inline and
   named callbacks contribute** result-side constraints (a rebuilt
   literal's result type, or a named callback's declared result type,
   flows into `U`). Strictly inference-only, never admission — a
   mismatched named callback still enters and behaves dynamically.
2. **R-D3 — RETIRED 2026-08-10** by the §6 re-ruling: the variadic
   clause keeps today's validation verbatim, so no consumption-model
   extension exists to rule on.
3. **R-D4 — RULED 2026-08-10: resolve-then-stamp.** Overload resolution
   runs first (library clauses are disjoint by arity/type); the stamp
   runs against the RESOLVED clause's `callback<S>`. User-defined
   overload sets keep the existing conservative skip. Also required by
   the `Pipe` consumer (§11) and `Map`'s two-clause shape (§6).
4. **R-D5 — user-facing DISPLAY of `callback<S>` only. RULED 2026-08-10:
   runtime display erases to the GROUND form; documentation shows the
   contextual form.** (Rev 3 had already resolved the former conflation —
   `.matches` behavior and internal serialization are fixed by §4's
   contract clauses 1 and 5; semantic erasure is clause 1.)

   A converted operator's signature, wherever it is PRINTED at runtime,
   reads exactly as it did before the conversion: every `callback<S>`
   erases to `function` (deeply), every quantified variable is
   instantiated to its ground skeleton (`any`, which `reduceType`
   normalizes back to the bare constructor) and the `forall` clause
   drops. `CountIf` displays as
   `(collection, predicate: function) -> integer`, `Filter` as
   `(collection, predicate: function) -> collection` — byte-identical to
   their pre-conversion strings. Neither half of the contextual spelling
   carries admission information, so printing it would claim a narrowing
   that did not happen.

   The projection is `groundedDisplayType` (`src/common/type/display.ts`),
   applied at the runtime display consumers: the `Signature` operator,
   the scope listing (`engine-scope.ts`),
   `BoxedOperatorDefinition.toJSON`, and a boxed symbol's `.type`. VALUE
   definitions are covered too (added in the adversarial-review round,
   2026-08-10): a function-typed VALUE declared with a `callback<S>`
   carries the constructor legitimately (clause 5), and both display
   surfaces that split on the definition kind — `BoxedSymbol.type` and
   `engine-scope.ts`'s `defToString` — used to show the raw
   `forall`/`callback<>` on the value branch and the ground form on the
   operator branch, for the SAME signature. The trigger is unchanged
   (presence of a `callback<S>`), so an ordinary value type is returned by
   reference. DISPLAY ONLY — the definition's own signature,
   `typeToString` and `typeToDedupKey` are untouched, so clause 5's
   round-tripping and de-duplication still see `forall`/`callback<>`.

   THE SEAM IS STRINGIFICATION (revised 2026-08-11, review round A). The
   projected AST is never boxed and never reaches a subtype query.
   `BoxedSymbol.type` returns the FAITHFUL type — the definition's own
   `Type` object — carrying the ground string as a print-time override
   (`BoxedType.withDisplayString`); every other consumer ends in
   `typeToDisplayString`. Applying the projection to the TYPE, as the
   getter first did, made a display ruling semantics-visible three ways:
   a callback-bearing INTERSECTION (a user overload set) reached
   `reduceType`, which collapses non-mutually-subtype arms to `nothing`,
   poisoning `.matches`; re-boxing the projected polytype re-ran
   declaration validation and could THROW `unsolvable-type-variable` out
   of the getter when the erasure left a variable occurring only
   result-side; and dropping the `forall` flipped `.isPolymorphic`, which
   makes `Ground <: Poly` unconditionally false. The projection itself is
   now intersection-aware (arms projected individually and the
   intersection REBUILT, never re-reduced — an overload set displays its
   arms) and total (a grounded form that would not validate falls back to
   the erased-but-`forall`-kept spelling).

   SCOPED TO A CONVERSION: the presence of a `callback<S>` is the whole
   trigger. A signature with no callback anywhere is returned by
   reference, `forall` included — a user's own generic function keeps its
   polytype display (`forall T. (x: T) -> T`), which is its declared
   contract rather than a conversion artifact (pinned in
   `generic-function-literals.test.ts` §5.1/R4). Grounding every polytype
   was tried and rejected for exactly that reason.
   This also means the §8 churn expectation "operator-SIGNATURE display
   is expected to change where conversions land" is now VOID for the
   runtime surfaces: they do not change at all.
5. **R-D6 — RETIRED 2026-08-10** by the §6 re-ruling: it existed only
   to stamp the variadic arrow, and the variadic clause never stamps.
5b. **Map spelling — RULED 2026-08-11: stays as staged for now** (the
   loose `(collection<T>, mapping: callback<(T) -> U>, collection*)`).
   Context, for future readers: the maintainer's review established that
   the PRE-conversion signature string `(collection+, mapping: function)`
   was correct documentation (callback last) that the type PARSER
   silently misrepresented — it bins required params and the variadic
   independently, discarding source order, without error. The staged
   spelling is parseable-and-stamps-correctly but misdocuments the zip
   form's callback-last order. Two honest alternatives were analyzed and
   DEFERRED, not rejected: R-D3-lite (suffix-params representation +
   both-ends `paramAt` matching — contained but requires auditing every
   positional parameter consumer) and flipping Map to callback-first
   `(function, collection+)` (representable today, but a breaking
   calling-convention change or canonical-churn via reorder, and a
   family-consistency break). Ruled NOW: the parser REJECTS
   variadic-followed-by-required spellings loudly (the silent reorder
   had exactly one user — Map — and now has none), so the
   misrepresentation class cannot recur silently.
6. **Phase-4 scope** — whether comparator slots convert at all. Still
   open; explicitly outside the current commit scope.

## 9b. Known limits (phases 0/0b, reviewed and accepted)

Behavior that is correct-but-partial today, recorded so a later phase
does not rediscover it as a bug:

- **A REFERENCE-hidden callback slot would admit but not stamp — currently
  unreachable.** The planning pass's `hasCallbackParam` is a shallow field
  scan: it does not resolve a type reference, so a slot written as a name
  standing for `callback<S>` would be admitted exactly right (the subtype
  layer unfolds the reference, and clause-1 erasure applies) yet decline
  the contextual stamp. Probed 2026-08-10, no such slot is constructible
  today: a generic ALIAS is expanded eagerly at build time, so
  `type MyPred<S> = callback<(S) -> boolean>` at
  `forall T. (collection<T>, MyPred<T>) -> integer` stamps identically to
  the written-out slot; and the NOMINAL spelling is rejected outright at
  declaration (`variance-violation`), a nominal type being opaque to the
  unfold admission would need. Recorded because the gap is real in the
  code even though nothing reaches it — resolving references in the
  planning fast path would put an unfold on every polytype application,
  so the shallow scan stays until a reachable case appears.
- ~~**`reduceType`'s union absorption of `callback<S> | function` is
  order-dependent** in WHICH spelling survives (the two are
  admission-identical by clause 1, so absorption itself is correct; only
  the retained node differs, and with it whether a slot spelled that way
  carries stamping metadata). No converted signature spells a slot as
  such a union.~~ FIXED 2026-08-09: `reduceUnionType` (`reduce.ts`) now
  applies a deterministic tie-break — between two mutually-subtype members
  the `callback<S>` one is retained — so `callback<S> | function` and
  `function | callback<S>` reduce identically (pinned in
  `test/common/types.test.ts`). Residual, unchanged: two DIFFERENT
  `callback<S>` members of one union are mutually admission-identical too,
  and there the first-seen one still wins.
- **"Legal as a signature PARAMETER" is a statement of INTENT, not an
  enforced rule** (recorded 2026-08-10, adversarial-review round). Nothing
  rejects a `callback<S>` written in a result type, a value's declared type
  or a collection's element type; adding enforcement is unruled and was
  deliberately NOT done. In any such position the constructor simply behaves
  as the primitive `function` (clause 1) and stamps nothing — `S` has no
  effect outside a parameter slot, contextual typing being its whole
  purpose. The `types.ts` doc comment now says exactly that, and the one
  place that read the kind structurally and got it wrong —
  `couldBeCallable` (`effects-of.ts`), which treated a `callback<S>` RESULT
  as non-callable and so skipped the latent-effect read — now treats it like
  a `signature`.
- **The contextual trigger runs on the UNBOXED operand route only.** Its gate in
  `applyOperatorDefinition` is `rawOps === undefined`, so an operator whose
  operands arrive already boxed — a binder's pre-phase — never reaches it, where
  the deleted `callbackElementOf` trigger ran on both routes. Deliberate: the
  pass's contract is that the callback literal canonicalizes ONCE, already
  annotated, which the pre-boxed route cannot offer. Currently unreachable — no
  converted operator declares binding sites. TRIPWIRE, recorded at the gate: a
  converted operator that also binds variables must re-visit it, or it silently
  stamps nothing.
- **The source-slot infer-write is `collection<unknown>`, not the bare
  `collection`** a pre-conversion ground signature wrote: an undeclared
  symbol passed at `collection<T>` is inferred at the instantiated
  parameter, and `T` falls to `unknown`. This matches every pre-existing
  polytype builtin and is the generic path's standing behavior, not a
  Design D delta. Reviewed and accepted.

## 10. Acceptance (phases 0/0b)

- `CountIf(xs, IsPrime)` (named, narrower-than-instantiated), `CountIf(xs, p)`
  with `p: function` (wildcard), `CountIf(xs, x |-> g(x))` with `g`
  undeclared — all valid, byte-identical admission to today (the §4
  contract; these exercise the CONVERTED signature, unlike rev 1's
  placement).
- `CountIf(points, pt |-> pt.1 == 0)`-style inline literal over
  `list<tuple<…>>`: stamped, evaluated, compiled with run() parity —
  identical to today's metadata-trigger result; `CountIf`'s metadata
  entry deleted.
- Phase 0b: `Filter(points, pt |-> pt == (0, 0))` identical to today;
  `Map([16, -4, "banana", 81], x |-> sqrt(x))` still `[4, 2i, NaN, 9]`,
  no diagnostics; a union-source `Filter` with a NARROWER named
  predicate keeps today's per-element dynamic behavior (the review's F1
  probe, pinned).
- Phase 3: every multi-collection `Map` form — homogeneous zip,
  heterogeneous zip, arity-mismatched callbacks — admitted, UNSTAMPED
  (the re-ruled §6 variadic clause), with EVALUATION AND DIAGNOSTIC
  parity against today (the "expected 1, got 2" error value; the
  residual unary functions; broadcast untouched). Annotation parity is
  explicitly NOT required: the interim metadata's homogeneous-zip
  stamping is deliberately given up. Unary `Map(xs, f)` gets the full
  stamped treatment, byte-identical to the metadata result.
- Full suite per phase: zero expression-serialization churn;
  signature-display deltas enumerated and reviewed.

## 11. Future consumer: `Pipe` (recorded 2026-08-10, maintainer intent)

The maintainer's target: `xs |> x |-> x^2` should mean
`Map(xs, x |-> x^2)` — the RHS lambda's parameter matched to `xs`'s
ELEMENT type. This is a designed consumer of the `callback<S>`
machinery, sequenced AFTER phase 3 (it lowers to `Map`, which must be
converted first). Recorded now so the phase work doesn't foreclose it.

**Signature.** `Pipe` becomes a multi-arm definition:

- scalar arm — plain application, today's behavior;
- collection arm —
  `forall T, U. (collection<T>, callback<(T) -> U>) -> list<U>`,
  canonicalizing to `Map(xs, f)`.

The element-type match IS the §5 contextual solve, verbatim: the solve
binds `T` from `xs`, stamps an inline literal's parameter with it
(gated by `admissibleElementType` as always), and `Map`'s machinery
(fusion, exact tier, compile) takes over after the rewrite.

**Dispatch table** (elementwise vs whole, decided from the RHS's ACTUAL
type — the clause-3 direction; `S` never constrains the operand):

| RHS at the pipe | Behavior |
|---|---|
| named fn whose param admits the whole collection (`Total`, `Reverse`) | apply WHOLE — `Total(xs)`, unchanged |
| named fn with scalar/element-typed param | `Map(xs, f)` |
| UNANNOTATED inline literal | stamped with `T` → elementwise by construction (the headline case) |
| literal hand-annotated as a whole-consumer (`(ys: list<number>) |-> …`) | hand annotations are never overwritten; dispatch sees a whole-admitting param → apply WHOLE (the escape hatch falls out of the existing no-overwrite guard) |
| bare-`function` symbol / unknown types | today's dynamic behavior, unchanged |

Broad admission (§4) is load-bearing here even more than for `Map`: a
plain generic arrow would reject or mangle every whole-collection
consumer piped today.

**Dependencies.** (1) R-D4 resolve-then-stamp — the stamp must run
against the RESOLVED arm; `Pipe` is a second, stronger motivation for
ruling it as recommended. (2) Phase 3 (`Map` converted). (3) Outside
Design D: the parse story — `|>` vs `|->` precedence must group
`xs |> x |-> x^2` as `Pipe(xs, Function(…))` — and reconciliation with
the existing `apply()`/`Pipe` applicability contract (plus the known
historical quirk that `|> Map(f)`-style spellings were inert in the
Cortex-era docs). Those get their own small design note when the work
starts.

## 12. Phase-2 addendum (implemented 2026-08-10): the four conversions as built

Phase 2 converted `Reduce`, `Scan`, `Fold` and `Partition` and deleted
their `callbackElementOf` entries; only `Map`'s remains, for phase 3.
Three decisions deviate from — or sharpen — the §7 sketches, each with
its evidence.

### 12.1 A fold NEVER stamps its accumulator — seeded or seedless

§7 rule 2 gave the seedless fold an element-param-only stamp
("preserving current tolerance") and the SEEDED one
`callback<(U, T) -> U>` with `U` solved from the initial value. The
seeded half does not survive contact: a fold's accumulator may change
type mid-fold in the seeded form exactly as in the seedless one, and the
narrow `U` an initial value solves to forbids it. Probed
(`1: finite_integer`):

```
Reduce([1,2,3], (a, x) |-> a / x, 1)                         → 1/6
Reduce([1,2,3], (a: finite_integer, x: integer) |-> a / x, 1)
  → Apply(…, Error(ErrorCode("incompatible-type", "finite_integer",
                             "finite_rational")), 3)
```

The second line is what a `U`-from-init stamp produces, so shipping it
would have turned a working program into an error value. The three folds
therefore spell their slot `callback<(unknown, T) -> unknown>`: `T`
stamps the element, and `unknown` is declined by the stamp gate
(`admissibleElementType`) so the accumulator stays bare. This is also
what keeps the ratified pins byte-identical — in particular the SEEDED
`Scan` pin (`lambda-param-element-inference.test.ts`, follow-up (4)),
whose accumulator a `U`-from-init spelling would have annotated.

The single-signature simplification the sketch's two seeded/seedless
CLAUSES were meant to deliver is kept: one signature per operator, no
overload set, and the seeded/seedless difference needs no clause at all
once the accumulator is out of the stamp.

Contract audit, per operator (§7's F4 rules): `Reduce`'s and `Scan`'s
results stay with their `type:` handlers (the reducer's own result; the
source's shape with that result as its elements); `Fold` keeps its
pre-conversion ground `value`; the stamp survives `Fold`'s rewrite into
`Reduce`, since it runs before the canonical handler on the raw literal
the handler then reuses.

### 12.2 R-D4 is implemented at TWO granularities

- **ARM** — `resolveContextualArm` (`overload.ts`): the single
  arity-viable arm of an overload set that declares a `callback<S>`.
  Ambiguity declines; a set no arm of which declares a slot — every
  user-defined overload set — resolves to nothing and keeps the ratified
  conservative skip. `annotateCallbacksFromSignature` calls it in place
  of the blanket overload-set skip. `Map`'s phase-3 shape falls out of
  the two filters with nothing added: at arity 2 only the unary clause
  declares a slot, and at arity ≥ 3 only the variadic clause survives the
  arity filter and it declares none — the §6 re-ruling ("the variadic
  form is NOT stamped") by construction.
- **SLOT** — `contextualSlotCallback` (`generic-instantiation.ts`): the
  callback arm of a UNION slot, when the resolution is FORCED (exactly
  one callback arm, and every other arm provably disjoint from
  `function`, hence unable to take the inline `Function` literal that is
  the only operand shape a stamp rewrites). An open sibling arm declines
  before `provablyDisjoint` is reached — the §4.2 ground invariant
  asserts on an open type.

`Partition` takes the SLOT form: its predicate and SIZE arms stay ONE
union (`integer | callback<(T) -> boolean>`; Rule U admits it, exactly
one arm being open). An intersection would have changed admission
diagnostics, result typing and the displayed signature, and R-D5's
projection does not reach inside one — for a two-arm shape whose arms
are already disjoint by a primitive, the union is the byte-identical
spelling and the intersection is not.

### 12.3 R-D5 grounds only the variables the erasure left VACUOUS

`Partition` was ALREADY a polytype before Design D touched it
(`forall T. (collection<T>, integer | function, integer?) ->
list<list<T>>`), so grounding every quantified variable would have
DELETED information a user relies on (`-> list<list>`) rather than
restoring a pre-conversion spelling. `groundedDisplayType` now grounds a
variable only when the callback erasure leaves it occurring at most once
— a variable in a single position relates nothing and says only what its
bound already says — and keeps the `forall` clause for the rest. That is
the same rationale as R-D5's existing scoping paragraph (a user's own
polytype is a declared contract, not a conversion artifact), applied one
level finer. Every phase-0/0b/1 operator has exactly one occurrence per
variable after erasure and grounds away completely, unchanged; `Sort`
and `ChunkBy` (no callback) are still returned by reference.

One consequence, recorded: `type-variables-collections.test.ts` reads
`Partition`'s DEFINITION signature (clause 5 keeps `callback<S>` there),
so that expectation was updated and paired with a new assertion that the
DISPLAYED signature is byte-identical to its pre-conversion string.

## 13. Phase-3 addendum (implemented 2026-08-10): `Map`, and the deletion

Phase 3 converted `Map` and deleted the `callbackElementOf` mechanism
outright. Two decisions need recording: how `Map`'s two clauses are
SPELLED, and the one deliberate annotation-parity break.

### 13.1 The two clauses are ONE loose signature, not an overload set

`Map`'s declared signature is now

```
forall T, U. (collection<T>, mapping: callback<(T) -> U>, collection*)
  -> indexed_collection
```

— the unary clause spelled positionally, with the variadic (zipWith)
clause as a trailing `collection*` that declares NO contextual slot.
The `type:` handler is UNCHANGED (§7 rule 1: it owns the source's
shape/indexedness and the callback's result element, neither of which
the type language expresses), and so is the declared result.

**Why not an intersection.** §12.2 pinned `resolveContextualArm` at ARM
granularity against a declared intersection, and the arm filters do
resolve `Map`'s shape for free. Three findings ruled it out anyway:

1. **Display collapses to `nothing`.** R-D5's projection ends in
   `reduceType`, and an intersection of two signatures that are not
   mutually subtypes reduces to the empty type — probed, and not
   specific to `Map`: `((integer) -> integer) & ((string) -> string)`
   reduces to `nothing` too. Making the projection intersection-aware
   is a few lines, but it only moves the problem: the display then
   PRINTS both arms, which is further from the pre-conversion string
   than the single loose signature is.
2. **Blast radius.** `Map` is `lazy` WITH a `canonical` handler, so
   `validateArguments` never runs on it and the signature's only
   behavioral consumer is the contextual stamp. An intersection would
   nonetheless have made every OTHER signature consumer
   (`effects-of`, result typing, the collection-kind gating,
   `broadcastableParamSlots`) resolve an overload set on the hottest
   collection operator in the library, for zero behavioral gain.
3. **The positional conflict is not expressible either way.** The type
   language consumes required→optional→variadic, so a callback-LAST
   variadic hoists: `(collection+, mapping: function)` PARSES to
   `args: [mapping], variadicArg: collection`, which is why §2 recorded
   the pre-conversion signature as "declares but does not apply". No
   spelling — intersection arm or not — can put the callback both last
   (for the zip form) and second (for the unary form).

**Why the variadic clause needs nothing added.** At two operands the
contextual slot IS the mapping. At three or more the slot still sits at
index 1, where a SOURCE now lives — and a source is never an inline
`Function` literal, which is the only operand shape a stamp rewrites.
So the pass declines before it canonicalizes anything, and the §6
re-ruling ("the variadic form is NOT stamped") holds by construction,
exactly as §12.2 predicted for the arm-granularity version.

**R-D5 delta, recorded rather than absorbed.** `Map` is the ONE
converted operator whose runtime display is not byte-identical:

```
before:  (mapping: function, collection+) -> indexed_collection
after:   (collection, mapping: function, collection*) -> indexed_collection
```

The "before" string is the parser's hoist described above — it names
operand 0 the mapping, which is not what `Map(xs, f)` passes there. The
"after" string names operand 0 the collection and keeps the
multi-collection form admitted, with `*` rather than `+` so the tail
does not make the two-operand form look invalid. Neither string claims a
narrowing: every slot reads `function`/`collection`, per R-D5. This is
the only signature-display churn of phases 0–3.

### 13.2 The flipped pins — the one deliberate annotation break

§6's cost, paid: the interim `{ last: 'preceding' }` metadata stamped
homogeneous and heterogeneous zips alike, and the variadic clause stamps
nothing. Every multi-collection `Map` case measured EVALUATES
identically — homogeneous zip (`[4,6]`), heterogeneous zip
(`[(1, "a"), …]`), three sources (`[9,12]`), the partially-provable zip,
the arity-mismatched callback (the `Too many arguments … expected 1, got
2` error VALUE, verbatim), the named/shared callback, the non-collection
source, and broadcast — with the callback parameters back in their
pre-inference BARE form. The only observable deltas are the annotation
and the `.type` it sharpened (`indexed_collection<finite_integer>` →
`indexed_collection<number>`, `tuple<integer, string>` →
`tuple<unknown, unknown>`), which is the pre-inference typing.

Pins flipped, each with a `§6 rev 4` citation in place:

- `lambda-param-element-inference.test.ts` — "the multi-collection
  `Map(xs, ys, f)` form annotates BOTH parameters" → "…is NOT
  annotated"; the whole `follow-up (5)` describe block ("each parameter
  takes its OWN source's element type", "each stamp is an INDEPENDENT
  contract") → "§6 rev 4: the multi-collection, callback-LAST form is
  NOT stamped", re-pinned bare-with-evaluation-parity and extended with
  an explicit diagnostic-parity case;
- `design-d-callback-contract.test.ts` — "the union flagship is
  unchanged: `Map` keeps its metadata this phase" loses its metadata
  assertion; "an UNCONVERTED operator is byte-identical to before" loses
  its `Map` line (`Add` and `Sort` still carry it); a new `phase 3`
  block pins both clauses, the display delta and the arity separation.

Unary `Map` is unaffected throughout: same stamp, same JSON, same
evaluation — and therefore the fusion / exact-tier gates, which key on
the stamped annotation via `annotationSatisfiedBySource`, are unchanged
(`map-fusion`, `map-exact-compile` green). A multi-source zip level
still declines to lower on both targets, as it always did.

### 13.3 The deletion sweep

`callbackElementOf` had zero consumers once `Map` converted, and it is
gone: `CallbackElementSources` and `CallbackElementLinks` and the
`OperatorDefinitionFlags` field (`types-definitions.ts`), the
`types-expression.ts` mirror, the `global-types.ts` re-exports, all four
wiring sites in `boxed-operator-definition.ts` (def-keys, class field,
`toJSON`, `update`), and the trigger in `box.ts`
(`annotateCallbacksFromElementType`, `callbackParamSources`, and both
the strict-path and lazy-branch call sites). Everything the CONTEXTUAL
path shares is kept verbatim: `admissibleElementType` (with its
permanent union ruling), `annotateFunctionLiteralParams`, and the solve
of §5. `grep -rn "callbackElementOf\|CallbackElementSources\|CallbackElementLinks" src/ test/`
returns no code hits; the remaining occurrences are this document, the
plan doc it supersedes, one historical note in each affected test file,
and the deletion PIN itself (`hasCallbackMetadata`, which asserts the
property is absent STRUCTURALLY — a `toBeUndefined()` assertion would
now pass vacuously).

`src/api.md` was regenerated (`npm run doc`) in the post-phase-3 fix
round: it now documents `CallbackType` and no longer mentions the
removed types. (An earlier draft of this paragraph deferred the
regeneration; the staged-review round corrected the record.)
