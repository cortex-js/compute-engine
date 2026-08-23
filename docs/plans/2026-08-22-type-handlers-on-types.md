# Design: computing types without changing the engine's state — type handlers as functions of types

**Status:** sixth draft, 2026-08-22, rewritten for readability on the same
day. The measurements in §2 are done. Step 0 (§3) and the `Pipe`/`Dot`
fixes (§4.1) are landed. §6 lists the rulings the user made on 2026-08-22
(R1 to R8) and the one default this draft chose where a product decision
is implied (O8 — change it in place if you disagree). §4 and §5 are the
implementation plan, revised after three rounds of review
(`docs/plans/reviews/2026-08-22-type-handlers-on-types-review-draft{3,4,5}.md`).
Throughout, a *ruling* is the user's decision and is dated; a *proposal*
is marked as one.

## Glossary

A few engine terms this document leans on, defined once here.

- **Type handler.** Every operator definition may carry a `type` function.
  Given the operands of an application such as `Add(x, 2)`, it answers
  "what is the static type of this application?" (`finite_integer`,
  `list<number>`, …). The engine calls it when someone reads
  `expr.type`.
- **Canonicalize.** Turn a freshly parsed or constructed expression into
  its canonical form. This binds symbols to their definitions, may declare
  symbols it has not seen before, runs the operators' `canonical` handlers
  and validates arguments. It is a *write* to engine state.
- **Evaluate / inert.** Evaluating an expression computes its value. When
  an operator's evaluate handler cannot do anything useful it returns
  `undefined` and the expression stays as it was; we call that *inert*.
- **Lazy operator.** An operator marked `lazy: true` receives its operands
  *unevaluated* and decides for itself which ones to evaluate and when.
  `Add`, `Multiply`, `Map`, `Sum`, `Hold` and about 150 others are lazy.
- **Memo.** A cached result stored on an expression or a definition, for
  example the type of an expression (`_type`) or its sign (`_sgn`).
- **Cache axis, generation.** The engine keeps a few counters that
  advance when its state changes: `_anyVersion` (any change at all),
  `_semanticVersion`, `_worldVersion`, `_callableVersion`. A memo records
  the counter value it was computed under — its *generation* — and is
  discarded when the counter has moved. "Advancing the `any` axis"
  therefore means "throwing away every type and sign memo in the engine".
- **Drift.** How much `_anyVersion` moved across some operation. A type
  read with drift 0 changed nothing.
- **Gate.** The check at canonicalization that decides whether an
  argument is acceptable for a parameter. Today, for an operator with a
  declared signature, an argument whose static type is not a subtype of
  the parameter type is refused with an `incompatible-type` error; we call
  that the *strict gate*.
- **Pin.** A test that locks a specific behavior in place so a later
  change cannot silently move it.
- **Shim.** A temporary, not-for-landing code change used to measure
  something; here, a proxy that hides facts from type handlers to see
  which tests depend on them.
- **Item 219.** A performance bug (ROADMAP "Reading a nested lazy view's
  type was exponential in depth") that motivates this whole design; §1
  explains it.

## 1. The problem, and the goal

A type handler takes its operands as *expressions*:

```ts
type?: (ops: ReadonlyArray<Expression>, options: { engine; operandTypes? })
  => Type | TypeString | BoxedType | undefined;
```

Because it holds expressions, a handler can do anything an expression lets
it do — canonicalize an operand, declare a temporary symbol, evaluate a
sub-expression — and a few handlers do. The trouble is that **computing a
type while writing to engine state invalidates the very caches the
computation is filling.** That is what item 219 was. To find out what type
a mapped function's body *would* have, the `Map` type handler declared
stand-in symbols of the right types and boxed the body over them. Each
declaration advanced the `any` axis, which discarded every type and sign
memo computed so far — at every nesting level, on every read. Reading the
type of a five-deep nested view called the `Map` type handler 15,073
times.

The goal (the user's, 2026-08-22): **computing a type must not change the
engine's state.** The means (also the user's): make the type handler a
function of the operands' *types* rather than of the operands themselves.
Then the question "what type would this application have, given operands
of these types?" is answered by calling the handler with types — no
stand-in symbol, no declaration, no temporary scope.

Three decisions frame the scope:

- **Precision is secondary.** A handler that only sees types will
  sometimes produce a less precise type than one that could look at
  values. The user's working hypothesis is that this rarely if ever
  matters. The acceptable consequence is that an expression which is
  refused at boxing time today may instead be admitted and checked when
  it is evaluated — which is already how the arithmetic operators behave:
  `"abc" + 1` is refused at boxing because it is *provably* wrong, while
  `x + 1` is admitted and checked at evaluation.
- **Literal types are wanted for a few values only.** The user asked that
  the values `0` and `1` be given the types `0` and `1`, so a handler can
  tell from the type alone that a divisor is not zero or that an exponent
  is one. The measurement in §2.2 gave *every* literal a literal type;
  that was the experiment's device, not the scope.
- **The item-219 exemption is a guard, not the mechanism.** The fix for
  item 219 exempts declarations into a registered "scratch" scope from
  advancing the cache axis. That exemption stays, with its tests, but the
  design succeeds only when nothing needs it any more (§5.5).

What "must not change the engine's state" means precisely — this is the
invariant every measurement in §5.5 checks: across a `.type` read, none
of the four version counters advances; no definition's `_writeVersion`
advances; no scope is pushed, popped or declared into; no expression is
canonicalized or evaluated; no state event is emitted. Filling a memo
(`_type`, `_sgn`, a `cachedValue` slot) is not a state change in this
sense — memos are what the invariant protects.

Out of scope here: a broader "validation phase" that canonicalization
would call and internal constructions could skip (ROADMAP "A
pre-canonicalization validation phase"). The user raised it alongside
this design, and this design is one partial answer to it.

## 2. What was measured

Two different things were measured. They answer different questions and
must not be confused.

### 2.1 Side effects — item 219, measured before this document

The item-219 fix measured the cost of writing engine state during a type
computation directly. Reading the type of a nested `Map` view ten times
moved `_anyVersion` by 620 before the fix and by 0 after. A second (warm)
read took 838 µs before and 0.5 µs after. The number of `Map` type-handler
calls for a view nested 0, 1, 2, 3, 4 levels deep went from 913, 1857,
3745, 7521, 15073 to between 11 and 19. These are pinned in
`tycho-item-219-nested-map-view-type-cost.test.ts`: drift must be 0, each
extra nesting level may cost at most 1.5× the previous one, and the
scratch-scope registration must be empty after the read returns and after
it throws.

### 2.2 Value reads — the shim experiment

A separate experiment asked a narrower question. Of the type handlers in
`library/*.ts`, which ones read *facts about an operand's value* —
whether it is finite, its sign, whether it is an integer, the literal it
holds — rather than just its type, and what do those reads buy?

The method: at the one place the engine calls a type handler
(`boxed-function.ts`, `def.type(expr.ops, …)`), wrap every operand in a
proxy that hides value-derived facts on anything that is not a literal,
gives every literal a literal type, and widens the handler's result back
to ordinary types before it is stored. Then run the whole test suite and
count what breaks. The proxy is kept as `scratchpad/shim.patch` of the
Step-0 session (it applies to `boxed-function.ts` at commit d3faf62d) and
is to be checked in as a test harness under §5.5. **It measured value
reads only; it never measured side effects.**

The experiment was refined four times. Each row below corrected a mistake
in the previous model, and the mistakes are themselves findings:

| Model | Failing tests | What it showed |
| --- | --- | --- |
| Hide every `isX` getter and every value read, on every operand. | 345 | Too much was hidden. On a *symbol*, `isReal`, `isInteger` and `isFinite` answer from the symbol's declared type, not from any value. The same getter is a value read on a literal and a type read on a symbol, and hiding it wholesale also hid the type information. |
| Let type-derived answers through; give literals literal types. | 244 | Literal types *leak*. A handler result such as `tuple<1, 2>` or the overload set `((z: 0) -> 0) & …` gets stored as the expression's type — an over-specific contract nobody wrote. |
| Also widen every literal type in a handler result to its ordinary primitive, walking the whole type. | 423 | The naive walker rebuilt `reference`, `object` and `record` nodes, which destroyed their identity (protocol property lookups then failed) and recursed forever on a recursive record type. |
| Widen only through structural nodes (lists, tuples, unions, signatures), with a cycle guard. | 75 | The genuine residue before Step 0. |
| The same shim after Step 0 (§3). | **57** | The baseline, across 17 test suites. |

Those 57 failures, grouped by cause (counts from the run logs):

- **Sign facts from outside the type (about 14).** `x.isPositive` and
  `x.sgn` on a symbol come from the symbol's held value first and from
  `ce.assume(…)` second (`boxed-symbol.ts:949`); neither is the declared
  type. This covers inverse-trigonometric typing under an assumption,
  `Ln` of a provably positive real, `±∞` times a provably non-zero real,
  `π·i` (where `Multiply` needs `π ≠ 0` to say `imaginary`) and `e^i`
  (where `Power` needs `e > 0`). Ruling R3 keeps these facts available
  where they come from a literal, a held value or an assumption (§5.2).
- **Rational literal types do not exist (11).** `(1, 2)/3`, `(1..4)/2`,
  the real-or-complex decision for `(-2)^(p/q)`, and the literal tiers of
  `Abs`, `Mod` and `Pochhammer` all needed a literal type like `1/3`,
  which the type grammar cannot spell. Accepted as precision loss under
  R2 and the `0`/`1` scope.
- **Closedness (3).** `poleReciprocalType` (`library/type-handlers.ts:107`)
  types `Tan(r)` as `finite_real` for a symbol `r` but `Tan(π/2)` as
  `number`, because a *closed* constant expression can land exactly on a
  pole (its value is complex infinity) while a generic symbol almost
  surely does not. It tells the two apart with `x.isConstant`, which says
  whether the expression has free variables — a structural fact, not a
  value. Hiding it produced `finite_real` at the pole, which is wrong,
  not merely imprecise. Ruling R3 keeps it.
- **`unknown` operands made too precise (4 tests).** When an operand's
  type is `unknown`, the engine deliberately types the result cells as
  `number` (`Add(u, 1)` with `u: unknown` gives `number`, measured). The
  shim produced `finite_number` instead. Which step of the derivation
  performs that widening is not yet traced; that is task P1 (§4.6).
- **Refusals at the strict gate (the behavior failures).** With `10²¹`
  typed `finite_number` instead of `finite_integer`, `FactorInteger(3 +
  10²¹)` was refused, `Mod(2^(3^20), 100)` stayed inert, 25 Fungrim
  simplification rules failed to load, and `e^i` was refused by a
  `(complex)` parameter. Ruling R1 removes the strict gate (§4.4).
- **A symbol bound to a function value (2 tests, `derivatives`).** Task
  P2 (§4.6).
- **A shim artifact (1).** A union with two literal members was widened
  to two identical members without being re-reduced.

In one sentence: what the value reads mostly buy is *passage through the
strict gate* — refusals, not wrong answers.

### 2.3 Exact-string type assertions — resolved by Step 0

Before Step 0 the suite asserted types by exact string 1451 times
(`expect(String(t)).toBe('finite_integer')`) and by subtype 275 times
(`t.matches('integer')`). An exact string fails whenever the engine
produces a *more* precise type, so any sound improvement anywhere broke
dozens of tests that were guarding nothing in particular; and a bare
`.matches()` passes when the type is *too* precise, which is the unsound
direction. §3 records what was done; the rule for new assertions is in
`docs/COMMENTING-GUIDELINES.md` under "Type assertions in tests".

### 2.4 The argument gate, measured

The engine decides strictness in two different places:

| Operators | What admits an argument at canonicalization | Where a bad argument is rejected |
| --- | --- | --- |
| Arithmetic, through `checkNumericArgs` | The argument's type *could* be a number — `op.type.couldMatch('number')` (`validate.ts:459`). | At evaluation, by `nonNumericOperandError`. |
| Every operator with a declared signature | The argument's type *is* a subtype of the parameter — `op.type.matches(param)`; otherwise `incompatible-type` (`validate.ts:1598` for required parameters, `:1795` optional, `:1940` variadic; and `checkType`, `:681`). | At canonicalization. |

Two facts found while measuring, both of which shape §4.4:

- **`couldMatch` tests comparability, not overlap.** It answers true when
  one side is a subtype of the other (after distributing over unions and
  `broadcastable`). So `finite_number couldMatch complex` is *false*, even
  though `finite_complex` belongs to both; and `finite_real couldMatch
  finite_integer` is true. A genuine overlap test exists as `typesOverlap`
  (`common/type/reduce.ts:783`, built on type intersection). Separately,
  the signature path already admits collection-typed arguments by a
  deferred overlap test, `overlapsForDeferredValidation`
  (`common/type/utils.ts:921`, reached from `checkType` and from all three
  `validateArguments` gates). The "D6.1"/"D6.2" labels in that code refer
  to rounds of the broadcast-model work, not to sections of
  `docs/COLLECTIONS-MODEL.md`.
- **A crude relaxation measures the wrong thing.** Simply replacing
  `matches` with `couldMatch` at the three `validateArguments` gates
  caused 47 failures in 16 suites. Eighteen of them are in
  `filter-predicate-errors`, where a predicate declared `(integer) ->
  boolean` and applied to `1.5` must produce an `incompatible-type` error
  *value* at evaluation. The reason: the same `validateArguments` function
  is reused at evaluation time on the already-evaluated arguments of a
  lambda (`function-utils.ts`, `apply()`), so relaxing it relaxed the
  runtime check too. Those 18 are the *missing runtime half* of the
  design, not tests that wanted a refusal. The rest are tests that do pin
  a boxing-time refusal of a symbolic argument (`SLICE: a symbolic Range
  is a STATIC type error`, `VALUE MEMBERSHIP: g: (0) -> integer rejects
  g(1)`, "provable refutations still error", the evidence-guard
  diagnostics). With the shim layered on top of the relaxation, the
  residue did not move (57): `e^i` into `(complex)` was still refused,
  because of the comparability semantics above, while `FactorInteger(n)`
  with `n: number` was admitted. Logs: `gate-only.log`, `gate-shim.log`.

### 2.5 The side-effect audit (2026-08-22)

A call-graph audit followed every `type:` entry in `library/*.ts` through
the helpers it calls, up to eight calls deep, to find any path that
reaches a state-changing operation. There are **220 type handlers written
as functions** (the earlier regex count of 146 was an undercount) plus
about 65 written as a type string or a named function. **213 of the 220
reach only pure operations** — type-lattice arithmetic (`widen`,
`isSubtype`, `functionResult`, `collectionElementType`,
`broadcastResultType`) and reads of operand facts (`op.type`, `op.sgn`,
`op.isFinite`, `op.isConstant`). Reading `op.type` on a symbol does not
bind or declare anything (`BoxedSymbol._bind` is empty; the definition is
attached once, at construction).

The seven exceptions, with what happened to each afterwards:

| Handler | How it reaches a state change | What it does | Status |
| --- | --- | --- | --- |
| `Map` (`collections.ts:4050`) | `bareMappingElementType` → `probeBareMappingElementType` | Pushes a scope, declares one stand-in symbol per mapped parameter, boxes the body over them, reads the type, pops the scope. | Guarded since item 219: the scope is registered as scratch so its declarations do not advance the axis, and the result is memoized. Rewritten against the new primitive at §5.3 step 4. |
| `Pipe` (`core.ts:2893`) | `pipeImplicitMapType` → `canonicalWithFreshPlaceholders` (`function-utils.ts:1546`) | Canonicalizes the topic; declares each placeholder (`_`, `_1`, …) into a fresh scope; builds a `Map`. That scope was **not** registered as scratch, so every time the type was recomputed the `any` axis advanced. | **Fixed** for the placeholder declarations (R5, §4.1). One remaining advance per recomputation, accepted (R6). |
| `Dot` (`linear-algebra.ts:1108`) | `innerProductType` | Built and canonicalized one `Multiply` per component and one `Add` over them, on every type read. The audit also said an undeclared component could trigger type inference; **that did not reproduce** (20 shapes, drift 0, the component stays `unknown`). The real cost was allocation, about 44 µs per recomputation. | Pure rewrite **landed** (R7, §4.1). |
| `Set` (`collections.ts:2593`; also its `elttype`) | `parseSetComprehension` | Canonicalizes the domain and condition of a set comprehension; the `elttype` handler *evaluates* every element of the domain (`enumerateSetComprehension`). | Rewritten at §5.3 step 4, contract in §5.4. |
| `JacobianMatrix` (`calculus.ts:1430`) | inline, then `resolveToList` → `inlineLambdaApplications` | Canonicalizes its operand and rebuilds lambda applications. | Rewritten at §5.3 step 4, contract in §5.4. |
| `Sqrt` (`arithmetic.ts:2932`) | `closedRealSign` (`type-handlers.ts:474`) | Numerically evaluates a closed operand (`x.N()`) to learn its sign. Guarded: only for pure operands with no free variables. | Rewritten at §5.3 step 4. |
| `Function` (`core.ts:5150`) | inline | Allocates a non-canonical `Function` node. Allocation only. | The `Function` operator itself is short-circuited before this handler; nothing to do. |
| `Interval.elttype` (reached from `Map`) | `mappingSourceElementType`, dynamic dispatch | Numerically evaluates both endpoints (`numerics/interval.ts`). | Rewritten at §5.3 step 4, contract in §5.4. |

And one **property getter that writes on read.** Reading `op.type` on a
symbol whose recorded type was *inferred* runs `_reviseInferredType`
(`boxed-value-definition.ts:665-694`). If the symbol's stored value now
has a different type, the getter writes the new type into the definition,
records a journal entry, emits a `type-write` state event (which advances
the `any` axis, and the `callable` axis when a function signature is
involved) and bumps the definition's `_writeVersion`. Any of the 213 pure
handlers can reach this just by reading an operand's type. The mechanism
is also **not fully correct** (ROADMAP "`_reviseInferredType`'s
generation gate keys on `semantic`…"): it re-checks once per
`_semanticVersion`, but the value's type it compares against is cached
per `_anyVersion`, so a change that advances only the `any` axis (any
fresh `declare`) or no axis at all (an inference write) leaves the
recorded type stale. Reproduced; see §4.2.

What the audit did not cover: dynamic dispatch through `def.type` and
`elttype` beyond the two `elttype` handlers above; call chains deeper
than eight; and the `sgn` handlers, which a type handler would reach
through `op.sgn` on a function expression (§5.2 keeps the type path from
doing that).

### 2.6 What the engine does around the handler (2026-08-22)

To replace "call the handler with types" by something that actually
reproduces application typing, we mapped everything `boxed-function.ts`
does in `type(expr)` (lines 4608–5163) and in the memo around it
(`get type()`, lines 1796–1861). In order:

| # | Step | What it needs beyond the operand types | Computable from types alone? |
| --- | --- | --- | --- |
| 0 | The memo: `cachedValue` keyed on `_anyVersion`. Re-entrancy (a recursive definition reading its own type) is handled by the memo's in-flight window (`cache.ts:80-105`), which answers a re-entrant read with the previous value. | The generation; mutable-object dependencies. | Not applicable. |
| 1 | If the expression is invalid, the type is `error`. | One bit: "is any operand an error?" | Yes, given that bit. |
| 2 | A `Function` literal is typed by `functionLiteralSignatureType` (`effects-inference.ts:652`) from its body, parameters and effects. | The literal's body. | No — and it is not an application, so it stays a separate entry point. |
| 3 | Look up the operator's definition (`expr.operatorDefinition`, attached once at construction). | The scope. | It is an input to the primitive. |
| 4 | Normalize the signature (`parseType` with the engine's type resolver). | The resolver. | Yes, given the resolver. |
| 5 | Pick the overload arm (`resolvedArm`, using the *trial-less* `resolveOverload`). Its pre-filter reads `op.isValid`, `op.type`, whether the operand could be an unkeyed collection, `admissionOf(op, param)` — which for a literal reads its concrete value — and whether the operand is a repairable operator symbol. | Validity; collection-ness; a literal's value. | Mostly. |
| 6 | Take the arm's result type (`functionResult`). | — | Yes. |
| 7 | Compute which parameter positions broadcast (`broadcastableParamSlots`, memoized per signature). | — | Yes. |
| 8 | Instantiate generic type parameters (`instantiatedResultType`): reads `op.type`, `op.isValid`, whether the operand's type was inferred (`valueDefinition.inferredType`), and collection-ness. | Whether the type was inferred; collection-ness. | Nearly. |
| 9 | Decide whether absent operands (`missing`) are absorbed into the result (`resolvedMissingBehavior`, `typeContainsMissing`). | — | Yes. |
| 10 | Build the `operandTypes` override for stripped positions (`stripsMissingAt`, `stripMissingFromType`). This is the **existing seam** for handing a handler synthetic types. | — | Yes. |
| 11 | Call the handler: `def.type(expr.ops, { engine, operandTypes })`. | This is the question. | 213 of 220 handlers, yes. |
| 12 | Parse the handler's result (a `BoxedType` as is; a string through `parseType` with the resolver). | The resolver. | Yes. |
| 13 | Without a handler, narrow a numeric result: if every operand satisfies `isFinite === true` and every operand type is numeric, the result is the join of the operand types. | `isFinite` — a value fact on a literal, a type fact on a symbol. | Yes, given that fact. |
| 14 | Decide whether to apply the broadcast ("map over collections") logic: `def.broadcastable`, the slot plan, `candidateShape` (a chain of literal `List` nodes), `isCollection`, `isTuple`, `isTextAtom`, `type.matches('matrix')`. | Structure and collection-ness facts. | Only with those facts. |
| 15 | Broadcast arm 1 — an operand is a statically visible collection: build `list<E>` / `vector<n>` with `broadcastShapedResultType(types, broadcastElementType(sigResult))`. Whether an operand participates is decided by `isFiniteBroadcastParticipant` (reads the value), `isBroadcastCollectionType` and `isFixedShapeCollection` (read the type). | Participation facts. | The shaping yes; participation partly. |
| 16 | Broadcast arm 2 — an operand is *possibly* a collection: result `broadcastable<E>`. "Possibly" means the operand's type is a top type **and** the operand is an application (`isFunction(expr)`). | One bit: "is this operand an application?" | Yes, given that bit. |
| 17 | The same two arms for a lambda definition (`def._isLambda`, `paramsAreScalar`, `isNumericTuple`). | Structure. | Partly. |
| 18 | The route for a function literal assigned to a symbol: no handler, no missing absorption. | `valueDefinition.type` / `.value.type`. | Partly. |
| 19 | Fallbacks: the signature's result type, possibly with missing absorbed; else `unknown`. | — | Yes. |

The `elttype` protocol (26 handlers that answer "what is this
collection's element type?"): 19 are constants (`sets.ts`); the shared
base handler joins the element types (which a `list<T>` type already
records); `Join`/`Append` answer a structural "is it a dictionary?"
question; `Range` reads whether its bounds are integers (a fact); the
guarded view already derives from its value's type. Two need evaluation:
`Set` comprehension (enumerates the domain) and `Interval` (numerically
evaluates the endpoints). The type-level counterpart is
`collectionElementType` (`common/type/utils.ts:336`), which does more than
strip one `list<…>`: it peels one rank off a dimensioned list, maps
`range` to `integer`, `string` to `character`, a tuple to the join of its
slots, and `dictionary<V>` to `tuple<string, V>`.

Places that already compute a type for an application they do not have
in hand: `probeBareMappingElementType` (builds one; memo keyed on the
operator, the parameter positions and the element types — deliberately
*not* on the source expressions' identity); `pipeImplicitMapType`
(canonicalizes one; memo keyed on the stage, validated by `_anyVersion`);
`innerProductType` (built one, before §4.1); `parseSetComprehension` and
`JacobianMatrix` (canonicalize); `closedRealSign` (evaluates). There is
no other call to a definition's `type` handler anywhere in `src/`.

## 3. Step 0 — make type assertions say what they guard (EXECUTED 2026-08-22)

Without this step no later step can be measured: a change that makes 22
types more precise *and different* looks exactly like 22 regressions.

- **The idiom** (`test/utils.ts`): `expectTypeBetween(expr, { atMost,
  above? })`. The expression's type must be a subtype of `atMost` ("at
  least this precise"); it must *not* be a subtype of `above` (a claim
  that would be too precise to be true); and it must not contain `never`
  (the empty type is a subtype of everything, so a bare `.matches()`
  accepts a derivation that collapsed to nothing). Exact-string
  assertions remain only where the exact tier is the contract, and then
  the test says why.
- **What was done:** 23 assertions examined; 15 converted; 8 kept exact,
  each with its reason; the two signature assertions split (parameter
  list exact, result bracketed); the rule added to
  `docs/COMMENTING-GUIDELINES.md`; reviewed; committed as d3faf62d.
- **Three traps for the next conversion.** First, `number` *is* a subtype
  of `broadcastable<number>`, so a bare `.matches('broadcastable<…>')`
  accepts a result that wrongly collapsed to a scalar. Second, "more
  precise" is not "sound": when an operand's type is `unknown`, the
  engine deliberately types the result cells as plain `number`, and a
  `finite_number` there is an over-claim. Third, function parameters are
  contravariant, so `.matches()` on a whole signature cannot tell a
  refined parameter list from the unrefined placeholder `(unknown) -> …`.
- **Baseline:** 57 failing tests in 17 suites under the shim (§2.2).

## 4. Runtime changes that come before the signature change

Each of these lands on its own and is measured on its own by the §5.5
instrument.

### 4.1 `Pipe` and `Dot` (RULED 2026-08-22 — R5, R6, R7; LANDED)

**`Pipe`.** `canonicalWithFreshPlaceholders` now takes an option,
`scratchDeclarations`. When set, the fresh scope that receives the
placeholder declarations is registered as scratch for exactly the
duration of those declarations, and unregistered before canonicalization
begins. `pipeImplicitMapType` — the `Pipe` type handler's helper — sets
it; evaluation-time callers do not, and behave as before. Result:
recomputing a `Pipe` stage's type now advances the `any` axis once
instead of twice; repeated reads advance it not at all; the types of five
representative stages are unchanged.

Why the exemption is sound here, since the argument differs from the
`Map` probe's: the `Map` probe pops its scratch scope, so its bindings
die. The canonical `Pipe` stage *keeps* the placeholder scope — it
becomes the parent of the function literal's own scope. The argument
that does hold is that the scope is created inside this call and fully
populated before any name is ever resolved against it, so no cached
answer anywhere in the engine can have been computed against that scope
without those bindings.

The one advance that remains comes from declaring the function literal's
own parameter into its `block.localScope` (`canonicalFunctionLiteral`),
a scope the canonical literal keeps. Exempting that would change cache
invalidation for every lambda in the engine. **R6: accepted, one advance
per recomputation.** The "validation phase" idea in the ROADMAP is the
mechanism that could remove it. Pinned in `pipe-type-read-purity.test.ts`:
repeated reads drift 0; ten forced recomputations drift *exactly* 10 (a
smaller number would mean the exemption had become too broad);
registration empty after a return and after a throw; four derived types
exact.

**`Dot` (R7).** `innerProductType` now computes the inner-product type
without building any expression. `componentProductType` calls
**`Multiply`'s own type handler on a pair of operands that belong to no
expression**, and `innerProductSumType` joins the products with the
numeric part of `addType` (a single term is returned as is; one provably
infinite term among reals gives `non_finite_number`; a join of
`imaginary` terms gives `finite_complex`, because imaginary parts can
cancel to the real number 0). Recomputation cost went from 44 µs to
12 µs, and a type read makes zero `ce.function` calls where it made
three. Three rows of the type table changed, all as ruled: components
declared `real` or `integer` dotted with a literal vector now type
`finite_real` / `finite_integer` rather than `real` / `integer` (the old
answers came from canonicalization folding `Multiply(a, 1)` to `a`, so
the sum inherited the declared type verbatim), and a rational component
row widened from `finite_rational` to `finite_real`. Two further losses
of precision were found on review and **accepted under R7**: exact
cancellation (`Dot((z, z), (1, −1))` with `z: finite_complex` is
`finite_complex`, not the `finite_integer` that folding `z − z` to `0`
produced; detecting it would re-implement `Add`'s term combining inside
a type read), and a pin in `linear-algebra.test.ts` (item 158) that
asserted equality with the type of the written-out sum, which is the
very fold R7 retires. Pinned in `dot-type-read-purity.test.ts`: a 22-row
type table with a reason on each row; drift 0 on cold and warm reads; a
spy asserting no `ce.function` call.

**`Dot` is the deliberate exception to §5.1 and §4.5 — and their
prototype.** It calls `Multiply`'s raw handler instead of the full
primitive because `Multiply` has a single handler with no overloads, no
generics and no broadcast shaping, whose result already lies within its
signature; every step the primitive would add is a no-op for that
callee. When §5.1 exists, `componentProductType` becomes one line,
`context.derive('Multiply', …)`. Until then it is the measured, pinned
example of a type-level application.

`Set`, `JacobianMatrix`, `Set.elttype`, `Interval.elttype` and `Sqrt`'s
`closedRealSign` are rewritten under §5.3 step 4, with contracts in §5.4.

### 4.2 Reading `.type` becomes side-effect free (R4, RE-RATIFIED 2026-08-22)

R4 was first ruled as "move the revision to the place where the value is
written". Measured on 2026-08-22, that cannot be built and is not needed;
the user re-ratified R4 the same day in the form below.

**Why not a write site.** `_reviseInferredType` runs on *read* for a
reason: the event that makes a revision necessary is a write to a
*different* symbol — `y := x + 1` infers `y: number`; later `x` is
assigned a list; `y`'s recorded type is now wrong, but nothing wrote to
`y`. The engine keeps no map from `x` to the symbols whose inferred type
depends on it, in either direction (the nearest things are validators
that check a dependency list on read: `snapshotMemoDeps` /
`memoDepsStillValid` in `collection-element-memo.ts`, and the per-object
versions in `object-deps.ts`). Building such a map means an inverse
index that does not exist, a story for definitions that get swapped in
place, and propagation through chains (`a := b + 1; c := a + 1`). And
"recompute at the next write" fails the pinned scenario in
`inferred-type-revision.test.ts:48`: `C_0` is never written again and
must still read `vector<integer^2>`. Storing a deliberately wide type at
assignment would reverse the 2026-08-16 ruling that inference should be
"more likely, not broadest".

**What works: a live read with no write.** Keep the four existing guards
(the type was inferred; the symbol is not a constant; it is not
self-referential; its value is a function expression other than a
`Function` literal). Compute `live = value.type` — which is already a
memo keyed on `_anyVersion`. If `live` is unknown or still fits the
recorded type, return the recorded type; otherwise return `live`. Write
nothing: no `_type`, no `_writeVersion`, no journal entry, no
`type-write` event. Measured against every scenario that pins this
behavior: identical results; about 0.15 µs slower per read, and only for
symbols holding a function expression; drift on the first read after a
refuting write goes from 1 to 0; and the staleness defect of §2.5
disappears, because nothing is keyed on `_semanticVersion` any more.

**Why dropping the event is safe.** The fact that triggers a revision is
"the stored value's type changed". That type is itself a memo keyed on
`_anyVersion`, so whatever changed it already advanced the `any` axis (or
invalidated the memo's object dependencies). The `type-write` event the
getter used to emit was a second advance for a change the first one had
already covered — which is exactly the item-219 hazard.

**Prerequisites — acceptance criteria, not follow-ups:**

1. A pin that mutual recursion (`a := b + 1; b := a + 1`, both inferred)
   and an eight-deep chain over one base symbol still terminate and give
   today's answers *without* the once-per-generation gate. Termination
   now relies on the expression memo's in-flight window
   (`cache.ts:80-105`), which is keyed on expression identity across the
   two definitions; measured to work, but not pinned today.
2. A pin for the staleness case: `y := x + 1`; `x` is inferred to
   `vector<integer^2>` (an inference write, no axis advance); an
   unrelated `assign('z', 1)`; `y.type` answers `vector<integer^2>`. This
   fails today.
3. A check that the R-D5 display projection (`typeToDisplayString`,
   which keys on `BoxedType` identity — see `index.ts:509` and
   `boxed-symbol.ts:502`) does not rely on the identity of the *old*
   `def.value.type` object. Under the live read the returned object is
   `value.type`'s, which is stable within a generation.
4. `checkpoint-journal.test.ts`, "funnel 2 — the read-driven type
   revision", repurposed to assert that a `.type` read inside a checkpoint
   window writes *nothing* (`_writeVersion` unchanged, no journal entry).
   The `type-write` journal hook stays for the two explicit setters.

The `Function`-literal guard must survive: removing it once turned two
refusals in `protocol-type-redefinition.test.ts` into silent acceptances.

### 4.3 Literal types `0` and `1` on handler input, and widening results

`ce.type('0')` already exists and sits correctly in the type lattice
(`0` is a subtype of `finite_integer`). A boxed `0` does not carry it:
`ce.box(0).type` is `finite_integer`.

**Which operands get a literal type.** Exactly those for which
`isNumber(op) && op.isExact && op.im === 0 && (op.re === 0 || op.re ===
1)`. An exact zero has one representation, so `-0` is `0`. A float
`0.0` or `1.0` is not exact and is not eligible. A symbol whose value is
`0` or `1` is not eligible: its type is its declared or inferred type,
and its value is not a type fact.

**On the input side**, `operands[i].type` is `0` or `1` for those
operands, so a handler learns from the type what it learned from the
value before: a divisor is not zero, an exponent is `0` or `1`, the
`fib(0)` and `fib(1)` clauses apply, `At(xs, 1)` reads the first element.
Because every handler now sees these types, §5.3 step 3 audits each
handler for exact comparisons against an operand type
(`=== 'finite_integer'`, `.kind ===` on an operand type) and rewrites
them as subtype tests, so a literal `0` does not silently stop matching.

**On the output side** (a proposal from CE-POC, measured necessary in
§2.2), a handler's result is widened before it is stored, by a function
`widenLiteralResult(t, polarity)`. The widener is **exhaustive over the
19 `kind` discriminants of `common/type/types.ts`** (17 object
interfaces; `union` and `intersection` share `AlgebraicType`,
`collection` and `indexed_collection` share `CollectionType`) plus the
primitive type strings, with a compile-time `never` case and a test
fixture that fails when a kind is added. Its rules:

- *Rewritten* — only in a **covariant** position (see the polarity rule):
  a `value` node of kind `number` becomes `finite_integer` if the value
  is an integer and `finite_real` otherwise; a `value` node of kind
  `infinity` becomes `non_finite_number`; one of kind `nan` becomes
  `number`. A `value` node of kind `string` or `boolean` is a leaf.
- *Descended*: `list`, `set`, `collection`, `indexed_collection`,
  `tuple`, `union`, `intersection`, `dictionary`, `broadcastable`;
  `negation` (into the wrapped type, with polarity *flipped*); and
  `signature`, where the result and the `typeParams[].bound` are
  covariant while the parameters, the optional parameter and the
  variadic parameter are **contravariant**; effects and other adjuncts
  are carried through unchanged.
- *The polarity rule.* Widening a type is only safe ("the new type is a
  supertype of the old") in covariant positions. In a contravariant
  position — a function parameter — a literal is left **as is**: a
  handler result `(0) -> …` keeps its `0` parameter, because widening it
  to `finite_integer` would make the function type *narrower*. Every
  widened result is checked: `isSubtype(original, widened)`.
- *Leaves returned unchanged*: `numeric` (a range such as
  `integer<0..10>` is not a literal); `reference` (aliases, nominal
  types, generic constraints — these carry resolver state compared by
  identity; a reference's type arguments, if any, are descended
  covariantly and the node is rebuilt only if one of them changed);
  `object`; `record` (its field types are the author's declaration, not a
  handler result, and the experiment's rebuilt `record` nodes broke
  identity and recursed forever); `variable`; `symbol`; `expression`;
  every primitive string.
- *Cycles.* The widener never rebuilds through a cycle. Types are
  published as immutable values (`docs/TYPE-SYSTEM.md`), `reduceType` has
  no cycle guard, and a recursive type reaches its own body only through
  a `reference` node — a leaf above. So the walk is a tree walk over the
  structural spine, memoized from old node to new node so a shared
  sub-node is rewritten once. There is no "back-edge" case; the relevant
  test is that a recursive record or alias type comes back as the same
  object, with any literal inside its cycle untouched — a documented
  limit, since a literal inside a recursive alias body is not a shape a
  handler produces.
- A rebuilt `union` or `intersection` is re-reduced with `reduceType`,
  which is safe because the rebuilt node is acyclic by construction.

Order of operations: parse the handler's result (`parseType` with the
engine's resolver), widen it, check it against the ceiling (§4.5), and
only then apply broadcast shaping. Tests: nested
intersection/signature/alias; `(0) -> finite_integer` keeps its parameter
literal; `!0`; `NaN` and `±∞` value nodes, direct and nested; a recursive
alias returned by identity; `-0`; a declared `(0) -> 0` signature (§4.5);
the exhaustiveness fixture.

Default: always widen; no per-site opt-out (O1).

### 4.4 Declared signatures admit by overlap (RULED 2026-08-22, R1)

Operators with a declared signature adopt the arithmetic model: an
argument is refused at boxing only when it is *provably* incompatible;
otherwise it is admitted and checked when the operator is evaluated. The
two checks are distinguished by an explicit `mode` on the validation
entry points (`validateArguments`, `checkType`) — never by which caller
happens to call them. **The relaxation applies to every declared
signature at once (R8, 2026-08-22):** relaxing the gate only touches
expressions that are errors at boxing today, so the only question is
what those expressions become, and the audit at the end of this section
answers it.

**The validation pipeline stays; only the verdict changes.** Today's
`validateArguments` interleaves the accept/refuse decision with a number
of things that belong to a successful call: normalizing arity and the
non-strict fast path that pads missing arguments; handling `Spread`
(which makes the arity unknown, so the function declines —
`validate.ts:1154-1159`); stripping absent operands before validation;
narrowing a one-character string literal at a `character` parameter;
reconciling placeholder signatures (`admitsPlaceholderSignature`);
repairing a fresh matrix; devolving an operator symbol; handling
threadable positions; and, after admission, narrowing an inferred symbol
under the evidence guard. **All of these are kept, in their current
order.** The change replaces the one step that today reads "if
`!op.type.matches(param)` then `incompatible-type`" with the verdict
below, at the same point in the pipeline. Tests cover each retained
mechanism on a *successful* call, not only on refusals.

**Static admission** (`mode: 'static'`, at canonicalization). The verdict
for one argument against one parameter depends on the parameter's kind.
The kinds are disjoint, so there is no ordering between these rules:

- **A function-typed parameter**: the Design E compatibility admission
  (`arrowSlotAdmission`), unchanged.
- **A collection-typed parameter** (`list`, `collection`,
  `indexed_collection`, `set`, `dictionary`, or a union of these): the
  existing deferred-overlap admission (`overlapsForDeferredValidation`),
  unchanged — including for a concrete `List` or `Tuple` argument, whose
  element-by-element refutation stays that function's business. Its
  reading that "two collections with the same head but disjoint element
  types are admitted" is kept.
- **A parameter with a value component** (`0`, `integer<0..10>`, …):
  `admissionOf`, unchanged (`checkType` already calls it). A subtype
  match admits; a concrete value decides exactly through `accepts`; a
  symbolic argument is refused only when `provablyDisjoint` says so, and
  admitted otherwise.
- **Every other parameter** (ordinary numeric types, `string`,
  `boolean`, record and object types, `any`, `unknown`): if the argument
  has a concrete value (`concreteValueOf` is defined), that value decides
  exactly through `accepts` — `1.5` refutes `finite_integer`, and
  `FactorInteger("abc")` is still refused at boxing, independently of the
  `0`/`1` literal-type scope. Otherwise the argument is admitted if and
  only if its type overlaps the parameter type, `typesOverlap(opType,
  param)` (`reduce.ts:783`). `unknown` and `any` overlap everything.

Consequences: `finite_number` is admitted at a `(complex)` parameter
(they share `finite_complex`); `string` is still refused at `(integer)`;
`FactorInteger(n)` with `n: number` boxes.

**Runtime conformance** (`mode: 'runtime'`, on evaluated arguments), in
three steps:

1. *Arity first.* The same normalization the static mode performs —
   required, optional and variadic slots, excess arguments, zero
   arguments, `Spread` expanded now that the arguments are evaluated —
   producing `missing` and `unexpected-argument` error values exactly as
   today, so a fixed-arity handler never receives `undefined`.
2. *Choose the overload arm.* A signature with one arm is its own arm.
   For an overload set, test each evaluated argument against each arm's
   instantiated parameters with `accepts` / `MatchesType` membership,
   and take the first arm that every concrete argument satisfies; an
   argument that is still symbolic satisfies any arm. This uses **no
   rollback frame and no boxing-pass window** — the "trial" path of
   `resolveOverload` (`validate.ts:1238-1274`) is machinery for undoing
   inference during canonicalization and is not used here. If no arm
   accepts, the error is `incompatible-type` against the declared union.
   A multi-clause definition keeps its own dispatch and its
   `no-matching-clause` error (`multi-clause.ts`, D7); the generic check
   does not pre-empt it.
3. *Check each argument* against the chosen arm's parameter. A concrete
   value that does not conform produces the same `incompatible-type`
   error *value* the static gate would have produced. An argument that is
   still symbolic after evaluation is left alone — the application stays
   inert or the handler decides — exactly as arithmetic behaves today.

**Where the runtime check runs:**

- For a **non-lazy** built-in operator, synchronous or asynchronous:
  after the dispatcher has evaluated the arguments and before the handler
  runs — once per call, and once per cell on the broadcast route.
- For a **lazy** operator it cannot run there: the dispatcher hands the
  handler its *unevaluated* arguments and cannot see which ones the
  handler evaluates. A lazy handler that needs a check keeps its own,
  written as a call to one shared helper `conformsAtRuntime(values,
  signature)` that applies the verdict above (the nine existing
  arithmetic guards, `nonNumericOperandError`, become such calls), run
  before the handler performs any effect of its own. **Measured
  2026-08-22** (the audit below): of the 155 lazy definitions, the 19
  with a scalar numeric parameter were each given a string, a list and a
  boolean through an `any`-typed symbol. None threw. Every outcome was a
  clean error, an inert application, or a lenient convention
  (`Multiply(x)` is `x`; `Vector` wraps anything; `Denominator` of a
  non-rational is `1`). The evidence does not call for any new lazy
  guard; an inventory of the lazy operators (P4) is follow-up hygiene,
  not a gate on R1.
- For a **user-defined function applied to values** (`function-utils.ts`,
  `apply()`, the two `_validateArguments` sites): the runtime mode — but
  **only when `ce.strict` is true** (O8, the default this draft chose).
  The engine documents `strict` as an opt-out from argument checking as
  such (`index.ts:1220-1229`: "when strict mode is off, results may be
  incorrect … if the input is not valid"), and R1 does not change that
  contract: a non-strict engine already skips the static check through
  the padding fast path (`validate.ts:126`, `:285`, `:1162`), so under R1
  it admits at boxing and runs no runtime check — exactly the risk its
  contract states. The alternative — run the runtime check
  unconditionally, which would narrow what `strict: false` means — is
  recorded in O8 with the measurement it would need.
- Optional and variadic positions: the same verdict against the
  position's parameter.
- Handlers with effects: the check reads arguments that are already
  evaluated and evaluates nothing itself, so no argument is evaluated
  twice, and it runs before the handler — hence before any effect.

**The evaluate-handler audit (2026-08-22) — why the generic check is
required, and why it is enough.** Every operator with an `integer`,
`natural` or `real` parameter (95 definitions) was applied to `2.5`,
`1 + 2i`, `NaN` and `+∞`, passed through an `any`-typed symbol so that
today's gate admits them and the handlers actually run. Results: no
throws; 151 clean errors; 54 inert; **148 returned a value**. The value
rows are the integer-domain family **silently rounding**:
`FactorInteger(2.5)` gives `[(3, 1)]`, `NextPrime(2.5)` gives `5`,
`Divisors(2.5)` gives `[1, 3]`, `IsTriangular(2.5)` gives `True`,
`Fibonacci(1 + 2i)` gives `1`; likewise `PowerMod`, `JacobiSymbol`, the
`Is*` predicates and the Stirling, Catalan and Bernoulli families — about
45 operators. One helper explains all of them: `toBigint`
(`boxed-expression/numerics.ts`) rounds the real part of its argument to
the nearest integer and ignores the imaginary part, by documented
contract. These handlers were written trusting the strict gate never to
hand them a non-integer, and that trust is exactly what R1 removes. Every
one of them is **non-lazy**, so the generic runtime check at dispatch
covers the whole list without touching a single handler. The same rows
are a defect *today* through the `any` route (ROADMAP "Integer-domain
operators round a non-integer operand"), and the runtime check closes
that too.

The fuzz that found this is to be checked in as
`runtime-conformance-fuzz.test.ts`: for every definition with a declared
signature it applies each wrong-kind value and asserts that the outcome
is an error value or an inert application. Its initial expected-failure
list is the 148 rows; §4.4 is done when that list is empty. One further
hardening item, not required by the evidence (no throws across 114
operators × 4 values): the `try` around `def.evaluate` in
`boxed-function.ts` has a `finally` but no `catch`, so an exception
thrown inside a handler escapes `evaluate()`. Converting a throw that is
not a `CancellationError` into an error value on the expression is a
one-place change worth landing together with the runtime mode.

**Tests.** The 18 `filter-predicate-errors` rows and the
`Any`/`All`/`TakeWhile` error-value rows are the acceptance test for the
runtime mode (they go through `apply()`). Each test that today pins a
boxing-time refusal of a *symbolic* argument (`SLICE`, `VALUE MEMBERSHIP:
g(1)`, the evidence-guard diagnostics) is re-read under R1: it becomes a
runtime-error pin, or it stays a static pin with its reason written down
(a *provable* refutation stays static). Route parity across built-ins,
named and anonymous lambdas, the lazy operators that keep a guard,
overloads (including gaps between arities), generics, optional and
variadic parameters, `Spread`, broadcasting, sync and async, and `strict`
on and off.

What a user sees: `FactorInteger(n)` with `n: number` now boxes, works
when `n` is 12, and errors at evaluation when it is not; an Epsil
diagnostic for that call moves from box time to run time. Errors for
provably wrong literals are unchanged. On a non-strict engine, nothing
changes.

### 4.5 The signature ceiling

`types-definitions.ts` requires a handler's result to be a subtype of the
signature's declared result. This check is applied to the **per-element
result, before broadcast shaping** — steps 11 to 13 of §2.6 produce that
result, steps 14 to 17 lift it over collections. The test is
`isSubtype(widenedResult, widen(declaredResult))`; if it fails, the
instantiated signature result is used instead (and reported under the
§5.5 guard). The result and the ceiling are then lifted through the same
broadcast transform, so `list<number>` from `Sin` over a list is never
compared against the scalar `(number) -> number`. A *declared* literal
result such as `(0) -> 0` is the author's contract, not a handler result:
the ceiling compares against its widening, and the declared type is what
gets stored. Test: a multi-clause `fib` with a `(0) -> 0` clause.

### 4.6 Prerequisite tasks (work items, not decisions)

- **P1 — find the `unknown` widening.** Which step of §2.6 makes
  `Add(u, 1)` type `number` for `u: unknown`, and `Add(h(x), 1)` type
  `broadcastable<number>`, where the shim produced `finite_number`.
  Deliverable: the step number and a pin (`unknown-operand-cells.test.ts`)
  asserting the four rows from §2.2. Blocks §5.3 step 2.
- **P2 — the two `derivatives` failures.** Assigning `f := t ↦ (t, t²,
  t³)` already refines `f`'s signature to return a tuple; find out why the
  failing tests' "declared as function" setup does not see that.
  Deliverable: a fix, or the cause written down plus a pin. Must close
  before §5.3 step 4 touches `Derivative`.
- **P3 — the four §4.2 prerequisites.**
- **P4 — the lazy-operator inventory** — follow-up work, not a
  prerequisite (R8): classify each parameter position of each `lazy:
  true` definition as *checked by the handler*, *never evaluated*, or
  *needs `conformsAtRuntime`*, driven by what the fuzz harness finds
  rather than by reading all 155 up front. Blocks nothing.

## 5. The signature change

### 5.1 The primitive: `deriveApplicationType` (proposal)

Calling a handler with types reproduces none of the 19 steps in §2.6.
The primitive is the *whole* derivation, run over a *description* of each
operand instead of the operand itself:

```ts
type OperandDescriptor = {
  readonly type: Type;                 // 0/1 literal types visible; an absent
                                       // operand carries its missing-stripped type
  readonly facts: OperandFacts;        // normalized, never empty (below)
  readonly structureOf?: () => OperandStructure | undefined;  // on demand, pure
};

type Tri = boolean | undefined;        // true / false / not known
type OperandFacts = {
  readonly valid: boolean;             // false for an error operand
  readonly finite: Tri;                // from the type, or from a literal's value
  readonly sgn?: Sign;                 // pure sources only (§5.2)
  readonly closed: Tri;                // has no free variables (`isConstant`)
  readonly collection: Tri;            // definitely / possibly / definitely not
  readonly finiteCollection: Tri;      // meaningful when collection !== false
  readonly indexed: Tri;
  readonly shape?: readonly number[];  // a statically known fixed shape
  readonly application: Tri;           // step 16's "is this an application?"
  readonly inferred: Tri;              // valueDefinition.inferredType (step 8)
};
```

**How descriptors are built.** There are two constructors and no other
way to make one: `describe(op)` for a real operand and `describeType(t)`
for a synthetic one. Both start by deriving every fact the *type* proves
— `finite_integer` implies `finite: true` and `collection: false`; a
dimensioned `list` implies `collection: true` with its `shape`;
`broadcastable<E>` implies `collection: undefined`; `unknown`, `any` and
`value` imply `collection: undefined` and `application: undefined`.
`describe` then adds the facts that are safe to read from a real operand
(`isConstant`, the memoized collection facets, a literal's sign).
`describeType` leaves `undefined` only what the type cannot decide. A
descriptor with empty facts cannot exist.

**Admission data is private to the primitive.** Overload resolution and
static admission need a literal's full value (`concreteValueOf`,
`accepts`); a handler must not see it (R2). The primitive receives that
value through a separate internal `AdmissionData` array that `describe`
builds, never through the descriptor a handler receives.

**Structure is inert and built on demand.** `structureOf()` returns a
read-only tree that contains no expression:

```ts
type OperandStructure =
  | { kind: 'symbol'; name: string }
  | { kind: 'string'; text: string }
  | { kind: 'number'; literal?: 0 | 1 }
  | { kind: 'application'; head: string; children: ReadonlyArray<OperandDescriptor> }
  | { kind: 'function-literal';
      parameters: ReadonlyArray<{ name: string; annotated?: Type }>;
      body: OperandStructure }           // a parameter reference appears as
                                         // { kind: 'symbol', name } with the
                                         // parameter's name
  | { kind: 'tuple'; arity: number }
  | { kind: 'list-literal'; shape: readonly number[] };
```

This covers every handler in `library/*.ts` that reads structure today:
`Hold` (is the operand a symbol, a string, a number or an application?),
`ReleaseHold` (the type of a `Hold` operand's child — `children[0].type`),
`Typed` (a string's text or a symbol's name), `Subscript` (a string's
text, a ring-constant symbol's name, or an indexed form by type),
`Map`/`Zip`/`Pipe` (the parameters, with an *authored* annotation kept
distinct from a derived one, and the body), `Block` (its last child), and
`Tuple` (its arity — though `tupleTypeOf` reads only types, so `Tuple`
may need no structure at all; to be verified when it is flipped). A
handler that needs a structural fact this vocabulary lacks extends the
vocabulary; it does not get an expression.

**Raw, never bound.** `Hold`, `ReleaseHold`, `Typed` and `Subscript` are
lazy operators with no `canonical` handler, so when an expression comes
through `ce.box` or `ce.parse` their operands arrive *unbound* (a known
trap, recorded in CLAUDE.md). Their handlers read that raw form today —
`Typed` is lazy precisely "so the type operand stays raw" — and
`describe` / `structureOf()` read the same raw form. Building a
descriptor never binds or canonicalizes an operand: a raw symbol's name
and a raw application's head and children are read as written, and its
`type` is whatever the raw expression answers (`unknown` for an unbound
symbol) — which is what the handler sees today. That is why
`structureOf()` is side-effect free: it is a shallow read, memoized on
the descriptor.

```ts
function deriveApplicationType(
  engine: PureEngineView,
  def: BoxedOperatorDefinition | BoxedValueDefinition,
  operands: ReadonlyArray<OperandDescriptor>,
  admission: ReadonlyArray<AdmissionData | undefined>,
  options?: { resolvedOverload?: ResolvedArm }
): Type;
```

Steps 1 to 19 of §2.6 run over descriptors; the `Function`-literal route
(step 2) stays a separate entry point. **When a fact is unknown, each
step takes the conservative branch** — never a guess toward precision:

- Step 1: `valid: false` gives `error`.
- Step 5: missing `AdmissionData` means the operand neither admits nor
  refutes a value-component arm (`undecidable`, as for a symbol today).
- Step 8: `inferred: undefined` means "not inferable".
- Step 13: any operand with `finite` other than `true` means no
  narrowing.
- Step 14: `collection: undefined` means the operand is treated as
  *possibly* a collection (arm 2, `broadcastable<E>`); `collection:
  false` means scalar. `collection: true` joins arm 1 **only as an
  eligible indexed participant**: `indexed === true`, and either a
  `shape` is known, or `finiteCollection === true`, or the type is a
  dimensionless `list`, `indexed_collection` or `range` (as
  `isBroadcastCollectionType` decides) — and the position is threadable.
  A definite collection that is not indexed (a `set`, a `dictionary`, a
  record, a generic `collection`) is **not lifted**; the arms treat it as
  `boxed-function.ts` does today (no lift; the handler's own collection
  typing applies).
- Step 16: `application: undefined` counts as "possibly a collection"
  only when the type is a top type.
- Steps 11 and 12: run the handler in the new shape and parse its result;
  then widen (§4.3), apply the ceiling (§4.5), and shape for broadcast.

The result is what `BoxedFunction.type` stores today, under the same
`_anyVersion` memo: `BoxedFunction.type` becomes
`deriveApplicationType(view, def, ops.map(describe), ops.map(admissionOf),
…)`.

**A handler asking for an application's type** calls
`context.derive(operator, descriptors)` (§5.2) — the same primitive, with
`describeType` descriptors and no admission data. For `Map`: build one
descriptor per *operand of the body* (a parameter reference becomes
`describeType(elementTypeOf(source))`; a constant operand becomes
`describe(constant)`), then call `derive(body.head, …)`; a body that is
itself an application recurses through `structureOf`. The existing
`BARE_MAPPING_ELEMENT_TYPE` memo keeps its key (operator, parameter
positions, element types). For element types, the counterpart of
`elttype` is `collectionElementType(type)` (§2.6).

### 5.2 What a handler receives (R3)

```ts
type?: (
  operands: ReadonlyArray<OperandDescriptor>,
  context: {
    engine: PureEngineView;  // type(), parseType, the type resolver, lookupDefinition
                             // (returning a read-only definition view); no declare,
                             // assign, box, function, _fn, parse, evaluate
    derive: (operator: string, operands: ReadonlyArray<OperandDescriptor>) => Type;
  }
) => Type | TypeString | BoxedType | undefined;
```

- `facts.sgn` comes from **pure sources only**: the sign of a number
  literal; the sign of a symbol's held numeric value; the sign recorded
  by `ce.assume`. For a function expression it is `undefined` — the
  `sgn` handlers are not called from the type path until they have had
  the same audit as §2.5 (O7). The precision this costs is on compound
  operands only (`Multiply((2 + π), i)` types `finite_complex` rather than
  `imaginary`), accepted under R2; `π·i`, `e^i` and the assumption cases
  keep today's answers.
- `facts.closed` is `isConstant` (a structural fact, safe to read).
  `facts.finite` is `true` for a `finite_*` type or a finite literal,
  `false` for a `non_finite_number` type or a `±∞`/`NaN` literal, and
  `undefined` otherwise.
- For a collection-typed, absent or `unknown`-typed operand the scalar
  facts are `undefined`, and the collection facts are whatever the type
  proves (§5.1).
- There is no separate `literal` fact: the `0`/`1` value travels in the
  type.

### 5.3 Migration, in the order that keeps the suite green

1. **Land §4**, including P1 to P3.
2. **Add the new handler shape beside the old one**, selected by a
   definition flag (`typeHandlerKind: 'types'`) — never by counting a
   function's parameters. The call site builds descriptors once and
   dispatches to whichever shape the definition declares. **Release
   plan:** release N ships both shapes, with everything in `library/*.ts`
   on the new one by the end of step 3 and user-defined handlers
   (`ce.declare` with a `type` function) on the old one; release N+1
   warns once per old-shape user handler (with a `MIGRATIONS.md` entry
   and a diagnostic); release N+2 removes the old shape. During N and N+1
   an old-shape user handler runs outside the invariant: it is a trusted
   callback, and the §5.5 guard reports (in tests) or warns (in
   development) instead of throwing for it.
3. **Convert the 213 pure handlers** using the table below, after the
   exact-comparison audit of §4.3. A conversion is proven by the parity
   harness (§5.5).

   | What the handler reads today | What it reads instead | Meaning |
   | --- | --- | --- |
   | `ops[i].type.type`, `.type.matches(T)` | `operands[i].type`, `isSubtype(type, T)` | Unchanged. |
   | `isReal`, `isInteger`, `isRational` | `typeFact(type, 'real' / 'integer' / 'rational')` | One shared helper: `true` if `isSubtype(type, T)`; `false` if `provablyDisjoint(type, T)` (`subtype.ts:475`); otherwise `undefined`. All three states pinned. |
   | `isFinite`, `isNaN`, `isInfinity` | `facts.finite` | Three-valued (§5.2). |
   | `isSame(0)`, `isSame(1)`, `isZero`, `isOne` | `type === '0'`, `type === '1'` | Exact for `0` and `1`; any other literal answers `undefined` (precision loss, accepted). |
   | `isSame(k)`, `isLess(k)`, `isGreater(k)` for other `k` | `undefined`, or a `numeric` range type when the lattice carries one | Precision loss, accepted; each site records its expected new result. |
   | `isPositive`, `isNegative`, `isNonNegative`, `sgn` | `facts.sgn` | Pure sources only. |
   | `isConstant` | `facts.closed` | Unchanged. |
   | `isCollection`, `isFiniteCollection`, `isIndexedCollection` | `facts.collection`, `.finiteCollection`, `.indexed` | Three-valued. |
   | `isNumberLiteral`, `numericValue` | `type === '0' \|\| type === '1'` | Only `0` and `1` carry a value. |
   | `.string` on a string literal | `structureOf()?.kind === 'string'`, then `.text` | Safe; structural. |
   | `.ops`, `.op1`, `.nops`, `.operator` | `structureOf()` | Structural readers only (§5.1). |

4. **Rewrite the seven handlers** (and the two `elttype` handlers) to the
   contracts in §5.4.
5. **Retire the exemption's callers.** Once `Map` and `Pipe` are pure,
   nothing declares into a scratch scope during a type read; the `scratch`
   branch of `axisMaskOf` stays as a guard, with its tests.
6. **Remove the old shape** in release N+2, per step 2.

### 5.4 Contracts for the handlers that change behavior

| Handler | Descriptor fields it uses | How it derives the type | When it cannot decide | Does evaluation move? | Expected test changes |
| --- | --- | --- | --- | --- | --- |
| `Map` | The sources' types; the mapping literal's `structureOf()` (parameters and body). | One descriptor per operand of the body; `derive(body.head, …)`; the memo is unchanged. | Returns `undefined` (the handler's own existing answer) when a body operand is neither a parameter reference nor a closed constant. | No. | None — the item-219 pin is the measurement. |
| `Pipe` | The stage's `structureOf()` (a function literal with exactly one parameter, and that parameter's *authored* annotation); the topic's type and `facts.collection`. | Today's `pipeImplicitMap` (`core.ts:452-471`), restated on descriptors. The stage maps implicitly when all of these hold: it is a function literal with exactly one parameter (a bare function symbol, or a symbol holding a lambda, applies to the whole collection instead); the topic is not a string, by type or literal; the topic is collection-shaped (`facts.collection === true`, or its type matches `collection<any>`); and the raw stage's parameter does *not* carry an authored `Typed` annotation that the topic already satisfies (that annotation means "I consume the whole collection"). There is no "does the parameter accept the element type" test. The result is `Map`'s element derivation over the stage with the topic's element type. | Returns `undefined`, so the declared result stands. | No. The interim registration from §4.1 then has no caller. | None expected; the five pinned stage shapes are the check. |
| `Set` (its `type` handler) | `structureOf()` of both operands. | A comprehension is recognized purely structurally — two operands, the second an `Element` or `Condition` application, the shapes `parseSetComprehension` matches — without canonicalizing anything; a comprehension types as bare `set`, anything else as `set<join of operand types>`. | Bare `set`. | Not applicable. | None: the handler already answers bare `set` for a comprehension. |
| `Set.elttype` | The body's structure; the domain's type. | `derive` on the body with the bound variable described as `describeType(collectionElementType(domain))`, as `Map` does. | `unknown`. | Yes — `enumerateSetComprehension` is only called from `evaluate`. | To be measured; the comprehension-element pins are re-read. |
| `Interval.elttype` | The endpoints' `structureOf()` and types. | `finite_real` when both endpoints are number literals or have a `finite_*` type; otherwise `real`. | `real`. | Yes — `.N()` leaves the type path. | None expected. |
| `JacobianMatrix` | The operand's type and `structureOf()`. | A matrix when the operand is a list literal, a function literal whose body is a list literal, or has a `list` type or a signature returning a list; a vector when its type is a scalar number or a signature returning one. | `value`, the declared result, when neither can be decided. | Yes — `resolveToList` and beta-reduction leave the type path. | To be measured; `Determinant(JacobianMatrix(F(x, y, z)))` with `F` declared to return a list must still type-check (that case is why the handler canonicalized in the first place). |
| `Sqrt` | `facts.sgn`, `facts.finite`, the type. | `finite_real` when the operand is real and its sign is positive, zero or non-negative; `finite_complex` for a real operand of unknown sign; the existing branches otherwise. | Today's handler minus the `.N()` branch. | Yes — `closedRealSign` becomes evaluation-only. | Closed float expressions such as `√(1 − 0.2²)` type `finite_complex` instead of `finite_real` (accepted under R2); count them. |
| `Dot` | — | Already pure (§4.1). | — | — | — |

### 5.5 Enforcement and measurement

- **The purity guard** (always on in tests; in development under
  `CE_TYPE_PURITY_GUARD`). Around every handler call and every
  `deriveApplicationType` call, take a snapshot of the four version
  counters, the scope depth, the length of `_scratchDeclarationScopes`, a
  **definition-write counter incremented at every `_writeVersion += 1`**
  (so a write path that forgot to emit its state event still trips the
  guard — with a negative test proving a write-version-only change
  does), and a construction/evaluation counter incremented by `ce.box`,
  `ce.function`, `ce._fn` when it canonicalizes, `.canonical` on a
  non-canonical expression (an already-canonical one returns itself and
  does not count), `.evaluate`, `.N`, `ce.declare`, `_declareSymbolValue`,
  `pushScope`/`popScope`, and every `_noteStateEvent`. Filling a memo
  does not count. Any change: throw in tests; report in development; for
  an old-shape user handler in releases N and N+1, report only. The
  `PureEngineView` type removes the mutating methods at compile time as
  well.
- **Per-offender tests**, cold and warm, for each row of §5.4 and for the
  §4.2 getter: read `.type` on a fresh engine, then read it again after an
  unrelated declaration forces recomputation, and assert zero drift on
  every axis and a zero counter — the shape of `pipe-type-read-purity`
  and `dot-type-read-purity`.
- **The item-219 pin**, run against a tree where the `scratch` branch of
  `axisMaskOf` is a no-op, shows drift 0 (after step 5); after §4.2, with
  the getter's write path removed rather than masked.
- **The parity harness** (`type-handler-parity.test.ts`): the §2.2 shim's
  mechanism, checked in as a test utility. For a named operator it runs
  (a) the old handler shape on real operands against the new shape on
  `describe(op)` descriptors, over a corpus; and (b) the new shape on
  `describeType(op.type)` descriptors with each optional fact withheld in
  turn — the synthetic path. **How the corpus is collected:** under a
  `CE_TYPE_PARITY_CORPUS` flag, `ce.box` appends the stable MathJSON of
  every boxed application, plus the declarations in force (symbol, type,
  the held value's MathJSON), to a per-worker file; a generation step
  merges the per-worker files deterministically (sorted, deduplicated by
  MathJSON and declaration set) into `test/fixtures/type-parity-corpus.json`,
  which the parity test replays on a fresh engine per row. A Jest
  reporter cannot do this: it sees test results, not expressions, and
  the suite runs in six isolated workers. The corpus **must be non-empty**
  for a conversion to count. For (a): an empty diff when the handler's
  §5.3 row says "unchanged"; for a handler whose row accepts precision
  loss (a literal other than `0`/`1`, a compound sign, the `.N()` branch),
  every differing row must be wider-or-equal and listed against the
  expected loss. For (b): wider-or-equal, every row listed. Coverage:
  nested `derive`, `Map` body substitution, top types, finite scalars,
  value-component arms, definite and possible collections.
- **§4.4**: the 18 `filter-predicate-errors` rows pass with the runtime
  mode; every re-read static-refusal pin states its reason; the cost of
  the runtime check under `strict: true` is measured on the compile and
  plot benchmarks.
- **The §3 baseline** never grows; a row that leaves it is listed with its
  cause; any precision lost is a sound *wider* type, never a narrower one
  (the §3 brackets and the §4.5 ceiling are the guards).

## 6. Rulings (2026-08-22) and open items

Rulings made by the user to this session on 2026-08-22:

- **R1 — Admission.** Operators with a declared signature follow the
  arithmetic model: refuse at boxing only when the argument is provably
  wrong; otherwise admit and check at evaluation. (§4.4.)
- **R2 — Precision.** A less precise derived type is acceptable; the
  working hypothesis is that it rarely if ever matters. Literal types are
  wanted for `0` and `1` only. (§1, §4.3.)
- **R3 — Facts beside the type.** Closedness and the `0`/`1` literal value
  reach a handler with no loss of precision. Sign reaches it **only from
  pure sources** — a literal, a held value, an assumption; the sign of a
  compound expression is not computed, and the precision that costs is
  accepted under R2. (§5.2.)
- **R4 — Reading `.type` becomes side-effect free.** First ruled as "move
  the revision to the write site"; **re-ratified on 2026-08-22 as the
  live read without a write**, with the four prerequisites in §4.2 as
  acceptance criteria.
- **R5 — `Pipe` and `Dot` fixed now**, as standalone runtime changes
  (landed, §4.1).
- **R6 — The remaining `Pipe` advance** (declaring the literal's own
  parameter into its kept scope) is accepted: one advance per
  recomputation.
- **R7 — `Dot`**: accept the narrowing (`real` to `finite_real`, `integer`
  to `finite_integer`, for components declared as symbols), the widening
  of the cancellation and rational rows, and the retirement of the
  item-158 parity pin; land the pure rewrite (landed).
- **R8 — Relax the gate for every declared signature at once**, not
  operator by operator as runtime checks land. Relaxing only touches
  expressions that are errors at boxing today; the evaluate-handler audit
  (§4.4) shows what they become and that the generic runtime check at
  non-lazy dispatch is what is needed. The lazy-operator inventory (P4)
  is follow-up hygiene.

Earlier rulings this design rests on: the `scratch` exemption (approved
at the item-219 ruling, 2026-08-21); permissive boxing with an evaluation
guard for arithmetic (2026-08-19); "inference has to be more likely, not
broadest, and is subject to revision" (2026-08-16); a fully known value
decides admission exactly, in both directions (2026-08-12).

Open items — genuine decisions, each with a default:

- **O1 — Widening opt-out.** Default: handler results are always widened;
  no per-site opt-out until a consumer needs literal-domain overloads. A
  *declared* literal result is the author's and is kept (§4.5).
- **O4 — Rational literal types.** Not wanted under R2; the 11 residue
  rows are accepted precision loss, not a gap.
- **O7 — The `sgn` handlers.** Default: not called from the type path
  (§5.2). A later audit of that family, by the §2.5 method, may extend
  `facts.sgn` to function expressions.
- **O8 — Non-strict engines.** Default chosen by this draft (§4.4): the
  runtime check runs only when `ce.strict` is true, so `strict: false`
  keeps its documented meaning — an opt-out from argument checking, at the
  consumer's stated risk — and R1 changes nothing for a non-strict engine.
  The alternative, an unconditional runtime check, narrows what
  `strict: false` means and needs a migration note plus a benchmark on
  the plot and compile paths. This is a product decision.

## 7. Non-goals

- Changing `BoxedNumber.type` for consumers: a literal's public type stays
  `finite_integer`; the `0`/`1` literal types are visible to handlers
  only.
- Removing the `scratch` exemption: it stays as a guard.
- Converting the remaining ~1429 exact-string type assertions; the §3
  rule applies to new ones and to any that a later step makes fail.
- The pre-canonicalization validation phase (ROADMAP): this design removes
  its motivating instances, and the R6 residual is its next one; it is not
  a substitute for it.
- Calling the `sgn` handlers from the type path (O7) — deferred with its
  default stated, not dropped.

## 8. Provenance and attribution

- The problem statement; the goal (no state change during a type
  computation); the types-based signature as the means; the `0`/`1`
  literal scope; the precision framing; the arithmetic admission model;
  rulings R1 to R8 (R4 twice): the user, 2026-08-22, to this session. The
  `scratch` exemption approval and the validation-phase idea: the user to
  session CE-POC, 2026-08-21/22.
- Item 219 and its measurements; the shape of the `scratch` exemption
  (`engine-configuration-lifecycle.ts` `axisMaskOf`, both declare routes
  in `engine-declarations.ts`, commit b81ad914); the value-read experiment
  (§2.2, the shim, the widening walker, "call the handler with types" as
  the probe): session CE-POC, 2026-08-21/22. The "typed hole" primitive
  proposed there is superseded by §5.1.
- Step 0 and its review; the gate measurements (§2.4); the side-effect
  audit (§2.5); the derivation map (§2.6); the `_reviseInferredType`
  analysis and its staleness finding (§4.2); the `Pipe` and `Dot`
  measurements and fixes (§4.1); the evaluate-handler audit (§4.4, two
  fuzz passes, logs `fuzz-lazy.log` and `fuzz-tier.log` in the session's
  scratchpad pending check-in as `runtime-conformance-fuzz.test.ts`); and
  §4–§5 of this draft: session compute-engine-85, 2026-08-22, with its
  subagents. Run logs and the full audit and map tables are in that
  session's scratchpad and task outputs.
- Spec reviews, all by Claude and Codex on 2026-08-22, in
  `docs/plans/reviews/2026-08-22-type-handlers-on-types-review-draft{3,4,5}.md`
  (18 findings each). Fifth-draft findings and where they went: 1 → the
  §5.4 `Pipe` row (restated from `pipeImplicitMap`); 2, 3, 4, 5 → §4.3
  (19 discriminants, `NaN`/`±∞`, polarity, no cycle rebuild); 6, 7, 8 →
  §4.4 static admission (disjoint kinds, `admissionOf` kept, pipeline
  retained); 9, 10, 11 → §4.4 runtime mode (membership-based arm
  selection, R8, arity and `Spread`); 12 → §4.4 and O8; 13 → the §5.1
  participation rule; 14, 16, 18 → §5.5; 15 → §5.1 "raw, never bound";
  17 → the §5.3 `typeFact` row. Fourth-draft findings and where they
  went: 1 → §4.5; 2 → §4.3; 3 → §4.2 and R4; 4, 5, 6 → §5.1 descriptor
  construction, three-valued facts and admission data; 7 → §5.1
  structure; 8, 9, 10, 14 → §4.4; 11, 13 → §5.4; 12 → §5.1, §5.2 and
  §5.5; 15 → §4.1; 16 → §5.5; 17 → §5.3 step 2; 18 → R3.
- ROADMAP entries: "Reading a nested lazy view's type was exponential in
  depth"; "Type handlers as functions of TYPES, not expressions — measured
  2026-08-22"; "Type derivation reaches state mutation at 7 handlers, 2
  `elttype` handlers and 1 getter — AUDITED 2026-08-22";
  "`_reviseInferredType`'s generation gate keys on `semantic`…";
  "Integer-domain operators ROUND a non-integer operand…"; "A
  pre-canonicalization validation phase"; "permissive boxing + eval
  guard" (2026-08-19).
