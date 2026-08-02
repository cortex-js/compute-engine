# Multi-clause function definitions (function polymorphism)

Status: **draft v2 — all decision points D1–D8 ruled 2026-08-01; ready for
implementation** (revised 2026-08-01 after dual spec review — findings and
sources in `docs/scratch/2026-08-01-function-polymorphism-design_SPEC_REVIEW.md`;
v1 2026-08-01)
Date: 2026-08-01
Related: `docs/plans/2026-07-25-overload-resolution-design.md` (static overload
sets — the foundation this rides on),
`docs/plans/2026-08-01-type-variables-design.md` (per-arm quantified clauses),
`docs/plans/2026-08-01-nominal-types-design.md` (§4.5 constructor functions),
`docs/plans/2026-07-12-cortex-match-design.md` (the rejected desugar target).

## 1. Problem

Users should be able to define a function by cases, dispatching on argument
values and types:

```
function f(0) = 1
function f(1) = 1
function f(n: integer) = f(n - 1) + f(n - 2)
```

Today (probed 2026-08-01):

- `function f(0)` is a **parse error** — `parseParameterList`
  (`src/cortex/parser.ts:2004`) accepts only symbols, optionally annotated
  `name: type`.
- A second `function f(…)` **silently overwrites** the first: the statement
  lowers to `["Assign", "f", ["Function", …]]` and Assign is last-wins.
  Verified: `f(n: integer) = n + 1; f(n: integer) = n * 2; f(5)` → `10`, no
  diagnostic.

## 2. Approach

Clauses accumulate on the function's definition, each carrying its
**signature**; dispatch is **type-based selection** using most-specific-wins,
extended with value (literal) types so that `f(0)` is a clause whose
parameter type is the value type `0`. A single **tri-state admission model**
(§4.4) is defined once and consumed by BOTH static resolution/typing and the
runtime selector, so the two can never disagree.

### Rejected alternative: desugar to `match`

Merging clauses into one body with a `Match` was considered and rejected on
semantics: `match` is by ruling **structural and total** — it always picks an
arm, even for a symbolic subject — so symbolic `f(n)` would commit to the
recursive arm and diverge symbolically. Correct CAS behavior is to stay
inert until the argument is known, which is what a semantic selector gives us
(and what `Which`/`When` and the `if`-based idiom already do). A `Which`
desugar has the right semantics but no type story; it survives as the
**compile** strategy (§8), not the definition model.

(Separately, the Match dispatch-plan closure-staleness bug found 2026-08-01 —
first-call frame baked into cached `bodyClosure`, silent stale results on
every later call — must be fixed regardless, but it is independent of this
design.)

## 3. Current state of the pieces (probed 2026-08-01)

Already in place:

- **Value types exist in the type grammar**: `ce.type('0')`,
  `ce.type('"foo"')`, `ce.type('true')` parse to `{kind: 'value', value: …}`
  (`common/type/types.ts:175`); numeric range refinements `integer<0..10>`
  also exist. Subtyping is real: `0 <: integer`, `0 <: integer<0..10>`.
- **Overload-set signatures round-trip**: `((0) -> integer) &
  ((integer) -> integer)` parses and serializes (serializer precedence fixed
  2026-07-25).
- **Static overload machinery** (2026-07-25, `boxed-expression/overload.ts`):
  most-specific-wins with declaration-order tie-break, per-arm blame
  diagnostics, per-position JOIN inference. The declared type of a
  multi-clause symbol is the intersection of its clause signatures, so this
  machinery carries over — **amended by §4.4**: arms whose parameters
  contain value types require the tri-state admission model; the v1 resolver
  alone is NOT sufficient (its boolean filter mis-handles value arms — see
  §4.4 static consumption).
- **Joins absorb value types**: `widen(0, integer) = integer`,
  `widen(0, 1) = integer` — the ratified per-position-JOIN inference rule
  survives literal arms without union explosion.

Gaps:

- **Value types are uninhabitable.** Nothing checks a *value* against a
  value type; only synthesized types are compared, and `ce.box(0).type` is
  `finite_integer`, which is not `<: 0`. Verified: with
  `g: (0) -> integer`, the call `g(0)` errors
  `incompatible-type "0" vs "finite_integer"` — the type rejects its own
  witness. Same for `z: 0; z := 0`.
- **Lattice defect**: `0 <: finite_integer` is `false` (0 is plainly
  finite). Fix alongside.
- **Function-literal assignment storage is route-dependent** (relevant to
  §4.2): `assignFn` (`engine-declarations.ts:704`) stores an assigned
  function literal as an **inferred operator definition** on some routes,
  and reconciles against a declared value-definition signature on others.

## 4. Design

### 4.1 Value membership (type layer)

New predicate `typeAcceptsValue(expr, type)`: when a concrete value is at
hand and the target type contains value-kind (or numeric-range) components,
test the value itself instead of its synthesized type.

**Membership rules (recursive, per `Type.kind`):**

- `value`: the expression is a literal (or a symbol whose *value* is a
  literal — see the extraction boundary below) and compares equal to the
  type's value under the D1 exactness rule (isSame — see §5 D1).
- numeric range (`integer<lo..hi>` etc.): a number literal of the base kind
  with `lo ≤ v ≤ hi`; endpoints are **inclusive**; endpoint comparison uses
  the same D1 exactness rule.
- `union`: member of any branch. `intersection`: member of every branch.
  `negation`: not a member of the negated type.
- type **references/aliases**: unfold, then recurse (respecting the nominal
  opacity rules of the nominal-types design — a nominal reference does NOT
  unfold).
- constructor types (`list<…>`, `tuple<…>`, …) containing value-type
  components: recurse element-wise only when the value's shape is fully
  known; otherwise the answer is *undecidable* (§4.4).
- every other kind: fall back to the ordinary `isSubtype` check on the
  synthesized type.

**Value-extraction boundary (side-effect-free):** membership never evaluates
and never triggers effects. The "concrete value" consulted is: a number,
string, or boolean literal; or a symbol whose definition holds a literal
value. Anything else — an unevaluated application, a symbol without a value,
an error value — is *not* a concrete value; membership is then decided
statically (refuted if the static type is disjoint, otherwise undecidable).
Error values are never members of any value type.

**Lexical forms pinned:** integer, decimal, and exact-rational literals,
string literals, `True`/`False`. `NaN` is a member of no value type — an
explicit rule (empirically, the engine's `isSame(NaN, NaN)` is `true`, so
this does NOT follow from isSame and must be guarded). Zeros
(*amended at Phase 0 implementation, 2026-08-01*): the engine normalizes
`0.0` and `-0.0` to the exact integer `0` **at boxing** — it has no distinct
float zero — so both ARE members of the value type `0` under the D1 isSame
rule. (The v1 draft listed `-0.0 ∉ 0` as a test case; that assumed a
representation the engine does not have. D1's "floats do not inhabit
integer value types" bites only for values that stay non-integer after
boxing, e.g. `0.5 ∉ 0`.) Infinities may appear in value types and match
only themselves.

**Do not** change literal type synthesis (`ce.box(0).type` stays
`finite_integer`) — synthesizing value types would churn every `.type`
comparison and snapshot in the suite for no dispatch benefit.

Also fix `0 <: finite_integer` (and audit value-kind subtyping against the
other refined numeric primitives) — a standalone defect fix with value even
if the rest of this design never ships.

### 4.2 Clause storage

A multi-clause function is stored as **one definition record** for the
symbol holding an ordered clause list: `[(signature, function-literal)]`,
with the symbol's declared type the **intersection of the clause
signatures** (an overload set), so static validation, result typing, per-arm
diagnostics, and inference ride the existing machinery (as amended by §4.4).

**Canonical home (implementation decision, Phase 1):** today an assigned
function literal lands in an *inferred operator definition* on some routes
(`assignFn`, `engine-declarations.ts:704`) and reconciles against a
*value definition* on others. The clause list must have exactly ONE
canonical home; **recommendation: the operator-definition slot** (dispatch
is an operator concern, and the applicable/evaluate path already routes
through it). Phase 1 must:

- define the conversion from *each* existing route's representation when
  the second clause arrives (single clause keeps today's representation —
  no behavior change until a second clause exists);
- preserve across conversion: signature provenance (declared vs inferred),
  the defining lexical scope of each clause body, the symbol's effect row
  (§4.3), and each clause's lambda/closure.

### 4.3 Defining and accumulating clauses

**Lowering discriminator (D6, ruled 2026-08-01).** The
two Cortex definition-statement forms (`function f(…) …` and math-style
`f(…) = …`) lower to a dedicated head:

```
["DefineFunction", "f", ["Function", body, …params]]
```

`DefineFunction` **accumulates** (rules below). `Assign` keeps today's
last-wins **full-replace** semantics unchanged in ALL cases — including
`f := (x) -> x * 2` onto a multi-clause `f`, which discards the entire
clause list. This makes the accumulate-vs-replace distinction survive
lowering, serialization, and the box route (raw MathJSON can spell either
head), and requires no fragile "is this literal clause-eligible?" heuristic.
Programmatic access: `ce.assign()` replaces; boxing a `DefineFunction`
accumulates.

**Clause identity (replacement key).** A clause's identity is its
**parameter domain**: arity structure (required/optional/variadic shape)
plus the normalized parameter types, compared by mutual subtyping — and,
once generic clauses exist, the binder up to alpha-equivalence (§5 D4.4).
Identity **excludes the result type and the effect row**: a body edit that
changes the inferred result or effects must still *replace* its clause, not
append beside it. Replacement **preserves the clause's position** in the
list, so declaration-order tie-breaking is stable across notebook re-runs.

Accumulation rules for an incoming `DefineFunction` clause:

- same parameter domain as an existing clause ⇒ **replace in place**;
- otherwise ⇒ **append** (declaration order is the dispatch tie-break
  order);
- effect-row conflicts are rejected per the state machine below.

**Effect-row state machine (D5 refined).** The effect row is a property of
the **symbol**, not of clauses. Its state is either *unestablished* or
*established(row)*:

- A clause with an **explicit** specifier: if unestablished, establishes
  that row (and re-stamps all existing clauses to it); if established,
  the specifier must equal the established row, else the definition is
  rejected with `incompatible-clause-effects`.
- A clause with **no** specifier adopts the symbol's row (current or
  later-established) — it asserts nothing.
- While unestablished, the symbol's row is the **join of the clauses'
  body-inferred effects** (an upper bound — sound).
- A body whose *inferred* effects exceed the established row is rejected at
  definition time (same diagnostic).
- Replacing or removing the establishing clause does not un-establish the
  row (rows only widen from inference or get pinned by explicit
  specifiers; re-running the scope resets everything — see lifetime below).

**Clause-list lifetime and staleness (ruled 2026-08-01).** The clause list
lives on the definition in its **defining scope**; a re-executed scope is a
fresh scope object with fresh definitions, which is the mechanism that
clears edit staleness. Concretely:

1. The notebook host defines scopes and **re-executes the whole scope on
   edit**. This is an *external product commitment* (the host's contract,
   not verifiable in this repo) — recorded here so the dependency is
   traceable. Under it, cross-edit staleness does not arise in the primary
   workflow, and the engine does **not** grow reset-on-new-run heuristics.
2. Consumers outside that workflow (direct Cortex against a persistent
   engine, programmatic `DefineFunction`) get Julia-style semantics: editing
   a clause's *parameter domain* leaves the old clause registered, by
   design. `About(f)` (§4.6) is the introspection surface for this state.

### 4.4 Admission and selection (tri-state)

**One model, two consumers.** Per clause and per argument position, an
*admission* value is computed:

- **admit** — the argument certainly satisfies the parameter type: a
  concrete value passing `typeAcceptsValue`, or an operand whose static
  type is a subtype of a non-value parameter type.
- **refute** — certainly not: a concrete value failing membership, or a
  static type disjoint from the parameter type.
- **undecidable** — neither: e.g. a symbolic operand against a value-type
  parameter, or partial shape knowledge in §4.1's constructor case.

A clause is *admitted* if every position admits, *refuted* if any position
refutes, else *undecidable*.

**Runtime selection** (at the `apply`/`makeLambda` seam), as a branch — not
a sequence:

1. Evaluate the operands **exactly once**; all admission tests and the
   eventual application consume these same evaluated values (an effectful
   argument must produce its side effect exactly once per call).
2. Compute each clause's admission (arity mismatch ⇒ refuted; see
   saturation below).
3. If any **undecidable** clause could outrank *or tie* the best admitted
   clause under most-specific-wins — in particular any undecidable clause
   that is more specific than, or incomparable with, the best admitted
   clause — the application stays **inert** (return undefined; the
   expression remains symbolic). An undecidable clause that is strictly
   *less* specific than an admitted clause does not block it.
4. Otherwise, if at least one clause is admitted: apply the most specific
   admitted clause; declaration order breaks ties.
5. Otherwise — every clause refuted with fully-known arguments — the
   function is not defined at this point: return the error **value**
   `["Error", "'no-matching-clause'", <the application>]` (D7, ruled
   2026-08-01 — mirrors `match`'s `match-no-case` precedent and the
   error-propagation design's value-not-throw rung).

**Static consumption of the same model.** Static validation/result-typing
runs the identical computation using static types only (no values ⇒ value
arms are refuted only on disjointness, admitted only when the static type
is a subtype — e.g. a literal call site — and undecidable otherwise):

- A call is **invalid** only if every clause is statically refuted.
- The **result type is the JOIN of the result types of all clauses not
  statically refuted.** (With `f(0) -> string` & `f(n: integer) ->
  integer`, a call on an operand typed `integer` has result
  `string | integer`; a literal call site `f(0)` statically admits and
  selects the literal arm ⇒ `string`.) When exactly one clause survives,
  its result type is used directly. Inference into operands keeps the
  ratified per-position JOIN over non-refuted clauses.

**Backstop invariant (required, with assert + test):** a call admitted by
static validation must never have **zero** non-refuted clauses at runtime.
The 07-25 overload round documented (its §10) that a hand-mirrored parallel
route drifted four times in review; its fix included exactly this kind of
backstop. The runtime selector must carry an assertion of this invariant,
not just a prose promise to mirror validation.

**Arity and saturation (D8, ruled 2026-08-01 — reject-over-surprise).**
Arity filtering precedes admission: a clause whose required/optional/
variadic shape cannot accept the argument count is refuted. **Partial
application is not supported for multi-clause functions in v1**: a call
that saturates no clause is a `no-matching-clause` error even if some
clause could partially apply (the existing `makeLambda` seam has
partial-application behavior — see the arity-reconciliation guards in
`engine-declarations.ts` — and extending it across a clause set would
require defining the residual's clause set, signature, and effect row;
rejected for v1 per the reject-over-surprise principle). Single-clause
functions keep today's behavior unchanged.

**Selection constraints carried over from the overload round (do not
relax):** selection is **write-free** — no in-loop `op.infer(…)`; admission
uses membership/`matches` only, and validation runs once on the winner. The
admission computation is shared code with static validation (one
implementation, two callers), not a mirror.

Recursion needs no special handling: each recursive application re-enters
the selector with the new arguments.

### 4.5 Cortex surface

Extend the parameter grammar (both definition-statement forms) to accept
**literal** parameters: numbers, strings, booleans — exactly the values
that have value types (§4.1's pinned lexical forms). No destructuring/shape
patterns in parameter position — that remains `match`'s job inside a body.

*(Ruled 2026-08-02: the v1 literal-parameter grammar is exactly numbers,
strings, and booleans — `Infinity` is NOT a literal parameter. `f(Infinity)`
keeps the ordinary symbol-parameter reading (a parameter *named* `Infinity`,
the general constant-shadowing pattern). Supporting infinity clauses first
requires the type grammar to accept infinity value-type spellings, which it
currently rejects; queued for a future type-grammar round.)*

**Lowering (encoding pinned):** a literal parameter lowers to an anonymous
typed parameter `["Typed", <fresh>, {str: "<value-type>"}]` where `<fresh>`
is a **generated binding symbol** with a reserved, non-colliding prefix,
unreferencable from user code (the body cannot name it). `_` is NOT used —
it collides with the wildcard conventions and repeated literal parameters
(`f(0, 0)`) would collide. Clause serialization renders the literal
spelling back (`f(0)`), so generated names never surface; generated names
are excluded from clause identity (§4.3) — identity uses the parameter
*types*, not the parameter names.

### 4.6 `About` as the diagnostic surface (ruled 2026-08-01)

`About` (`library/core.ts:1063`) is under-utilized today (description /
wikidata dump). For a multi-clause function, `About(f)` lists the clause
set: one line per clause — signature, in declaration order (= tie-break
order) — plus overlap annotations.

**Reachability/overlap predicate (v1, defined):** under most-specific-wins,
an earlier more-specific clause cannot shadow a broader one, so v1 reports
exactly two situations:

- **tie overlap** — two clauses of equal specificity (incomparable
  parameter domains) whose domains overlap: annotate the later one
  "overlaps clause N; declaration order decides in the overlap";
- **finite coverage** — a clause whose domain is entirely covered by more
  specific clauses over a finite/enumerable domain (e.g. `f(true)`,
  `f(false)`, `f(b: boolean)`): annotate "unreachable (covered)". Detected
  only for boolean and explicitly enumerable value-type domains; no general
  set-containment analysis in v1.

Equal domains cannot appear (replacement removes them, §4.3). This is the
`methods(f)` equivalent and the primary answer to "what does `f` currently
dispatch to?".

### 4.7 Composition with same-name constructor functions

The nominal-types design (**§4.5, a v2 feature of that spec** — not D4b,
which rules that record bodies auto-mint *no* constructor) gives
`function point(…)` after `type point = …` in the same scope a special
meaning (smart constructor). Sequencing: until nominal-types v2 ships, a
same-name `function` after a `type` in the same scope remains that spec's
same-scope collision error — §4.7's precedence rule activates only with
nominal v2 (noted in §7 Phasing).

**Minted constructors (nominal phase 0, in flight 2026-08-01):** a type
declaration already mints a same-name value-level constructor operator
(`type-constructors.ts`, `_mintedTypeConstructor` marker; `assignFn` gains a
guard so a plain assignment cannot silently replace it and desynchronize
the two namespaces the declaration claims). `DefineFunction` must apply the
**same guard**: a definition statement targeting a name whose binding is a
minted constructor is the deterministic collision error — it never
accumulates a clause onto the minted operator. Sequencing note: Phase 1
should land *after* the minted-constructor work (both modify the
`assignFn`/definition-replacement seams); Phase 0 is independent of it.

When both features are live: **the constructor interpretation wins** when
the same-scope preceding `type` exists; clause accumulation applies
otherwise. Reconciliation obligation (tracked, not resolved here): the
nominal spec defines the constructor as an overload set of the user's
arm(s) **plus an automatic raw-injection arm** — when constructor clauses
eventually accumulate, they must compose with that synthetic arm
(replacement, effect uniformity, specificity, and `About` visibility of
the synthetic arm all need rules). In v1 of *this* spec, a **second**
same-name constructor definition is a deterministic error, and the nominal
spec's "arm(s)" plural is deferred to that reconciliation.

*(Amended at Phase 2, 2026-08-02: the shipped nominal-v2 implementation
gives a re-definition of a constructor function **replacement** semantics —
the notebook re-run behavior its own test suite pins
(`constructor-functions.test.ts`, "re-running the function statement
replaces the constructor") — and `DefineFunction`'s delegation preserves
that. The "deterministic error" sentence above described the pre-nominal-v2
interim and is superseded; erroring here would also break every
canonical+evaluate dual-install, which re-runs the same recognition
idempotently. Also clarified: the §4.7 precedence — and this delegation —
applies to **nominal** types only; an alias's same-name function is an
ordinary function (nominal spec §4.5) and its definition statements
accumulate clauses like any other function, with the alias's minted
identity constructor replaced by the first definition. Known limitation:
because that replacement installs clause 1's CONCRETE signature at
canonical time — load-bearing for the alias "arities honest" behavior its
test pins — a call in the SAME program admitted only by a later clause
(`type alias flag = boolean; flag(true)=1; flag(false)=0; flag(false)`)
evaluates correctly but draws a spurious `static-type-error` diagnostic
from the pre-pass; across cells the accumulated signature is visible and
no diagnostic fires. This is the §4.4 deviation-2 boundary, not a
dispatch defect.)*

## 5. Open decision points

**Guiding principle (ruled 2026-08-01): reject rather than surprise.** Where
any behavior we could pick for an interaction would be arbitrary or violate a
user's reasonable mental model, prefer rejecting the configuration with a
clear diagnostic over silently picking one. Applied in D5 (uniform effects)
and D8 (no partial application), and offered as the alternative in D4.1
(ambiguous dispatch).

- **D1 — membership exactness.** Does `0.0` inhabit the value type `0`?
  Recommendation: **isSame-based exact membership** (floats do not inhabit
  integer value types), aligning with the exactness contract and the match
  tier-0 keying rationale ("float keying can't safely reproduce isSame
  classes"). Note the tension with the matcher's isEqual-tolerance leaf
  semantics — this ruling should pick one and document the difference.

[*] Agreed.

  *Divergence documented (per this ruling):* value-type dispatch is
  **exact** — `f(0) = …` admits only a value isSame to `0`; `match`
  patterns keep their **tolerance-based** number-leaf comparison (per the
  cortex-match design), so `match x { 0 => … }` may select on a
  near-zero float that clause dispatch would send to the general clause.
  The two constructs answer different questions (semantic dispatch vs
  structural matching); the difference is user-visible and is pinned by a
  side-by-side test (§9).

- **D2 — clause arity mixing.** `f(0) = …` then `f(x, y) = …`: allowed
  (arity is just part of the signature; the resolver already scores arity
  mismatch) or diagnosed? Recommendation: allowed.

[*] Allowed.

  *(Saturation/partial-application interaction ruled separately — D8.)*

- **D3 — shadowed-clause diagnostic.** Static warning at definition time
  when a new clause is unreachable (every admitting argument tuple is
  claimed by a more specific earlier clause)? Recommendation: v1 surfaces it
  only in `About`; a definition-time diagnostic is a later polish.

[*] Agreed, and a reminder that the order of definitions matters: the more specific clause must come first to avoid shadowing.

  *Clarified 2026-08-01 (ruled):* dispatch is **most-specific-wins**
  regardless of declaration order (`f(n: integer)` before `f(0)` still
  sends `f(0)` to the literal clause); declaration order decides only
  between clauses of **equal specificity** (incomparable overlaps) — the
  same rule as the static resolver. First-match semantics considered and
  rejected. Order-sensitivity is therefore confined to tied clauses, which
  is also the only shadowing case `About` needs to call out (predicate
  defined in §4.6).

- **D4 — type-variables interplay.** The generics spec models overload sets
  with per-arm `forall` clauses. Five concrete interplay hazards (gate the
  combination behind the generics phases; in polymorphism v1, a polytype
  clause is rejected with the generics spec's D7 diagnostic):
  1. *Ground-vs-generic ties*: `len(s: string)` + `len<T:
     indexed_collection>(xs: T)` — `Ground <: Poly` is false (generics D3),
     so specificity can't order the arms; the selector must apply the
     generics D11 rule (ground wins), identically to static resolution, or
     dispatch and validation disagree.
  2. *Specificity needs instantiation*: ordering `f(0)` against
     `f<T: number>(x: T)` requires instantiate-and-check (generics D12 /
     phase-2 solver), not the plain `isSubtype` walk — the hard dependency.
  3. *Adjunct preservation*: the clause-list → intersection rebuild is a new
     signature-rebuild site and must carry BOTH adjuncts (effects +
     typeParams): `(forall T. (list<T>) random -> T) & ((list<integer>,
     integer) -> list<integer>)` must not lose `random` or the binder (the
     effects round's dropped-field bug class).
  4. *Replacement keying is alpha-equivalence*: re-running `id<T>(x: T)`
     edited to `id<U>(x: U)` must REPLACE, not append — `forall T. (T) -> T`
     ≡ `forall U. (U) -> U`; naive structural equality reintroduces
     staleness.
  5. *Inference JOIN*: with a generic arm surviving, per-position JOIN must
     use the solver's `joinBounds`, never raw `widen` (`widen(unknown, X) =
     X` absorbs — pinned generics trap); `joinParamAt` cannot be reused
     unchanged.

  Per the reject-over-surprise principle, hazard 1 has a rejection
  alternative: diagnose an *ambiguous call* (no unique winner after the
  ground-wins rule) instead of falling to declaration order — weighed
  against consistency with the generics D11 static ruling; to be decided
  when the combination unlocks. Hazard 3 shrinks under D5: with a uniform
  effect row per symbol, only `typeParams` remains a per-arm adjunct.

- **D5 — clause effect uniformity (user-proposed 2026-08-01, adopted;
  reject-over-surprise).** All clauses of a multi-clause function share ONE
  effect row — the effect is a property of the *symbol*, not the clause.
  Rationale: with per-clause effects (`f(0) = 1` pure, `f(n) random = …`),
  the effect of a call would depend on dispatch, which is undecidable for
  symbolic arguments — so purity of `f(n)` would be undecidable, every
  consumer (CSE, hoisting, memoization) would have to assume worst-case
  anyway, and the displayed type would carry per-arm effect variance.
  Enforcement at accumulation: a clause whose stated effect row conflicts
  with the symbol's established row is an **error**
  (`incompatible-clause-effects` diagnostic).

  Sub-rule for omitted specifiers (**ruled 2026-08-01, adopted**): explicit
  rows must all agree and establish the symbol's row; a clause with *no*
  specifier adopts the symbol's row rather than asserting the default — so
  `f(0) = 1; f(n) random = …` is accepted with `f` random overall (sound:
  effect rows are upper bounds, over-approximating a pure body is safe).
  The stricter alternative — omission asserts the default row, forcing
  `f(0) random = 1` — was considered and rejected (punishes the common
  unannotated base case). Full state machine (establishment, re-stamping,
  inferred-effect overflow, replacement of the establishing clause): §4.3.

- **D6 — `DefineFunction` lowering head (ruled 2026-08-01, adopted).**
  The definition-statement forms lower to a
  dedicated `DefineFunction` head that accumulates; `Assign` always
  full-replaces (today's semantics untouched, including
  `f := (x) -> x * 2` discarding the clause list). Rationale: the
  accumulate-vs-replace distinction must survive lowering and
  serialization; any value-shape heuristic ("has a derivable signature",
  "every param annotated") either silently accumulates ordinary
  reassignments or excludes the natural untyped clause
  (`function f(n) = n * f(n - 1)`). Details: §4.3.

- **D7 — no-match behavior (ruled 2026-08-01, adopted).**
  Fully-known arguments refuting every clause produce the
  error **value** `["Error", "'no-matching-clause'", <application>]` —
  mirroring `match`'s `match-no-case` and the error-propagation design;
  never a throw, never silent inertness. Details: §4.4 step 5.

- **D8 — no partial application for multi-clause functions (ruled
  2026-08-01, adopted; reject-over-surprise).** A call saturating no
  clause is
  `no-matching-clause`, even where a clause could curry. Extending the
  `makeLambda` partial-application behavior across a clause set would
  require defining the residual's clause set, signature, and effect row —
  deferred until demanded. Single-clause functions unchanged. Details:
  §4.4.

## 6. What this is not

- Not runtime pattern matching on structure — shapes, destructuring, guards
  stay in `match`.
- Not method tables on types (no dispatch on receiver hierarchy beyond the
  type lattice).
- Not a change to canonicalization: dispatch happens at evaluation; a
  symbolic `f(n)` canonicalizes exactly as today.

## 7. Phasing

- **Phase 0 — value membership** (standalone defect fix): predicate + wiring
  into validation/assign + `0 <: finite_integer` fix + tests
  (`z: 0; z := 0` works; `g: (0) -> integer; g(0)` valid, `g(1)` invalid;
  plus string- and boolean-value-type membership probes, range-endpoint
  inclusivity, and the §4.1 non-member cases: NaN, error values,
  symbol-with-value extraction — and the §4.1 zero-normalization members:
  `0.0`/`-0.0` ∈ `0`, per the amended lexical-forms ruling).
- **Phase 1 — engine clauses**: `DefineFunction` head, canonical clause
  storage + per-route conversion (§4.2), accumulation + identity +
  effect-row state machine (§4.3), tri-state selector with backstop assert
  (§4.4). Box-route and `ce.function` tests, including recursion (`fib` per
  §1) and route parity (box + parse — the lazy-operator test-gap class).
- **Phase 2 — Cortex surface**: literal parameters in both definition forms,
  lowering (§4.5), `About` clause listing (§4.6), docs
  (`doc/06-guide-augmenting.md`, reference entries).
  **IMPLEMENTED 2026-08-02.** Notes: (1) generated literal-parameter names
  use the reserved prefix `literalParam_<position>`
  (`src/math-json/symbols.ts`, shared by parser, serializer and `About`);
  (2) the §4.2 "single clause keeps today's representation" rule is
  enforced in `defineFunctionClause` by delegating a 1-clause install to
  `ce.assign` — required once ALL Cortex definitions lowered through
  `DefineFunction` (differentiation and closure-capture consumers read the
  single-function representation); (3) §4.7's constructor precedence is
  ACTIVE (nominal-types v2 constructor functions shipped): `DefineFunction`
  onto a same-scope type name delegates to the assignment route's
  constructor recognition — at CANONICAL time too, mirroring `Assign`'s
  D13 pre-pass block — replacing Phase 1's interim collision error;
  (4) clause ACCUMULATION itself stays evaluate-time — the canonical-time
  knot-tying (loose `'function'` pre-declaration) is enough for later
  statements in one program to validate, so the plan's "canonical-time
  registration" revisit was not needed; (5) host-thrown effect-contract /
  type-compatibility errors from the delegated assign convert to error
  VALUES in `DefineFunction`'s evaluate, same as the `Assign` operator.
- **Phase 3 — compile**: guard-chain emission (§8) + parity tests.
  **IMPLEMENTED 2026-08-02** (JavaScript target). Notes: (1) emission lives
  in `base-compiler.ts` (`tryEmitMultiClauseFunction`, reached from
  `ensureUserFunctionEmitted` when the definition has no single literal):
  one preamble helper per clause (`_fn_f$c1`, … — `$` cannot occur in a
  MathJSON symbol, so helper names cannot collide with other emitted user
  functions) plus a variadic dispatcher `_fn_f = (..._$a) => …` testing
  arity + per-parameter guards in the stable-insertion linearization;
  recursion works through the dispatcher via the existing
  `registry.compiling` mechanism. (2) Guard kinds: value types → `===`
  (NaN-valued type → constant `false`, infinities → `=== Infinity`);
  numeric ranges → base guard + inclusive bounds; `integer`/`real`/
  `finite_*`/`number`/`string`/`boolean` → `typeof`/`Number.isInteger`
  guards; `unknown`/`any` → no guard; unions of the above; anything else
  (e.g. `rational`, collections) declines the WHOLE function — which
  surfaces as the standard fail-closed diagnostic and interpreted
  fallback. (3) Non-JS targets decline: the interval target shares the
  generic emission path but its values are intervals (a `===` guard is
  meaningless), shader targets have no variadic dispatch, Python has no
  user-function registry — see the ROADMAP compile-coverage ledger.
  (4) Call-site machinery degrades safely: `userFunctionParamType`
  returns `undefined` on the intersection signature, so complex coercion
  and the broadcast wrapper simply don't engage; the higher-order
  value-position path (`Map(list, f)`) references the shared dispatcher.

Sequencing: after the Cortex `type` statement (shipped, unstaged);
independent of the generics phases (but see D4). §4.7's constructor
precedence rule activates only when nominal-types v2 (constructor
functions) lands — until then same-name-after-`type` stays that spec's
collision error. The Match closure-staleness fix is independent and should
land first regardless.

## 8. Compile

A multi-clause function compiles to a guard chain over the clauses in a
**deterministic linearization**: topologically by specificity (more
specific first), ties broken by declaration order — the same total order
the runtime selector induces, so compiled and interpreted dispatch agree by
construction.

Guard kinds per clause: value-type params → equality tests with D1
semantics (exact; `===` on the compiled representation where that is
faithful, else the target's isSame-equivalent); range params → bound
checks; primitive type params → the target's type guards where they exist.
A clause with any guard the target cannot express causes the **whole
function** to decline compilation (return undefined, never throw —
established policy), falling back to interpreted dispatch; no partial
compilation of a clause subset (it would silently change tie behavior).
Compiled no-match mirrors interpreted no-match (D7) where the target can
represent it; GPU/interval targets follow the interval-`Which` treatment or
fail closed.

## 9. Test obligations

- Route parity: every dispatch behavior probed via `ce.function`, `ce.box`
  raw MathJSON (both `DefineFunction` and `Assign` heads), and Cortex
  source.
- Repeated calls with different arguments on the same engine (the exact gap
  that hid the Match staleness bug).
- Notebook idempotence: re-running an identical clause set leaves dispatch
  unchanged; re-running an edited body — including one whose *inferred
  result type or effects changed* — replaces the clause in place (position
  preserved).
- Replace-vs-accumulate: `f(0)=1; f(n: integer)=…; f := (x) -> x*2` fully
  replaces (Assign); the same sequence via `DefineFunction` accumulates.
- Symbolic arguments stay inert — including the blocking case: an admitted
  general clause must NOT be selected while a more-specific value clause is
  undecidable; assigning the symbol a value later dispatches correctly.
- Static/runtime coherence: a broadly-typed operand that evaluates to the
  literal case and to the fallback case (result typed as the JOIN); the
  backstop assert (statically admitted ⇒ ≥1 non-refuted clause at runtime).
- No-match (*amended at Phase 1 implementation; ratified by user
  2026-08-02*): a DIRECT literal miss —
  and an unsaturated-arity call with concrete arguments (D8) — is
  statically refuted everywhere and errors at validation (per-arm blame,
  §4.4 static consumption), like any other operator; the runtime
  `no-matching-clause` error value (D7) fires for misses that were
  statically undecidable and are revealed only at evaluation. Note the
  boxing seam: re-boxing a call after the symbol gains a value refutes
  STATICALLY (the membership predicate follows the symbol hop) — the
  runtime path is exercised by evaluating a call boxed before the value
  was known.
- Effects: exactly-once argument evaluation with an effectful argument;
  D5 conflict rejection, omission-adopts-row acceptance (both declaration
  orders), inferred-effect overflow rejection, row survival across clause
  replacement.
- `About(f)`: clause listing order, tie-overlap annotation, finite-coverage
  unreachable annotation (`f(true)`, `f(false)`, `f(b: boolean)`).
- D1 divergence: side-by-side test of `match x { 0 => … }` (tolerant) vs
  clause `f(0)` (exact) on the same near-zero float.
- Compile parity (Phase 3): JS + GPU/interval — literals, ranges, ties,
  mixed arity, decline on unsupported guards; compiled vs interpreted
  agreement on every §9 dispatch case.
- Snapshot blast radius measured before landing (standing policy).
