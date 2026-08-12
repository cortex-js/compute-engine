# Type variables (parametric polymorphism) in the type system

> **Surface syntax superseded (2026-08-11).** The prefix quantifier
> `forall T: bound. (T) -> T` described throughout this document was replaced
> by a trailing `where` clause — `(T) -> T where T: bound` — by
> `docs/plans/2026-08-11-where-clause-type-constraints.md`. The **semantics
> are unchanged**: read every `forall T: bound. <sig>` below as
> `<sig> where T: bound`. Consult the where-clause design for the current
> grammar, clause placement, reserved words, and serialization rules.

Status: **draft v4 — D1–D12 RULED (2026-08-01, approved as
recommended); v2 milestone (generic literals + `function f<T>(…)`
sugar) IMPLEMENTED 2026-08-04, see §9.1; open: D13's encoding half
(joint with the effects Stage-3 marker case)**
Date: 2026-08-01 (v2 addressed the 27-finding dual review in
`docs/scratch/2026-08-01-type-variables-design_SPEC_REVIEW.md`; v3
integrated inline review R1–R11 and the Option-C syntax ruling; v4 folds
in the second inline pass R12–R17 — comments are folded into the text
and removed. The D4 candidate list is backed by the full library audit
in `docs/scratch/2026-08-01-type-handler-audit.md`.)
Related: `docs/plans/2026-07-25-overload-resolution-design.md`,
`docs/plans/2026-07-12-typed-function-literals-design.md`,
`doc/08-guide-types.md`, `src/common/type/types.ts` (the "Future
considerations" note at the end of the file is the seed of this spec).

## 1. Problem

The type language has no way to say "the result type *is* the operand's
element type". Every polymorphic operator today either:

1. Declares a weak signature (`-> unknown`, `-> any`) and recovers precision
   with an imperative `type:` handler on the operator definition
   (`collections.ts` alone has ~15 of them), or
2. Gives up precision entirely.

Concrete costs:

- **The library can't state its own contracts.** `forall T. (list<T>) -> T`
  is inexpressible, so the signature string and the `type:` handler encode
  the same fact twice in two languages, with no consistency check. (`At` is
  the extreme case — its `-> unknown` signature is only *partially* aided
  by this design: the value-dependent part of its result typing, a literal
  index into a heterogeneous tuple, stays in its handler; see §6.)
- **Users can't declare generic functions.** `ce.declare('swap',
  'forall T, U. (tuple<T, U>) -> tuple<U, T>')` has no spelling; the
  workaround is `any` everywhere, which defeats argument checking and
  result typing.
- **Fixed callback bounds are unsatisfiable — instantiated bounds are the
  fix.** The 2026-08-01 callback-narrowing survey established that every
  FIXED parameter type for a predicate slot dies on contravariance: no
  single ground type admits both a named library predicate
  (`CountIf(xs, IsPrime)` with `IsPrime: (number) -> boolean`) and an
  unannotated lambda. An *instantiated* bound does: at
  `xs: list<integer>` the expected arrow becomes
  `(integer) any -> boolean`, and `integer <: number` admits `IsPrime`
  while the lambda is checked at `integer`. This is the strongest concrete
  motivation for call-site instantiation. (The `function`-typed-symbol
  operand class still fails even under instantiated bounds — see §7.4.)
- **Callback contracts are unstated.** `Map`'s relation between its
  collection's element type and its callback's parameter type lives only in
  imperative code. Variables give it a declarative spelling — though the
  *migration* of `Map`/`Filter` themselves is explicitly deferred (§7.4).

## 2. Proposal at a glance

Add **rank-1 (prenex) parametric polymorphism with ground upper bounds**: a
signature may be prefixed by an explicit quantifier clause declaring its
type variables (optionally bounded), solved per call site by local type
inference (an order-independent two-phase bounds solver, §4.3), with the
result type obtained by substitution.

```ts
ce.declare('first',   'forall T. (indexed_collection<T>) -> T');
ce.declare('swap',    'forall T, U. (tuple<T, U>) -> tuple<U, T>');
ce.declare('compose', 'forall T, U, V. ((U) -> V, (T) -> U) -> (T) -> V');
ce.declare('rotate',  'forall T: indexed_collection. (T) -> T');
ce.declare('apply',   'forall T, U. ((T) any -> U, T) -> U');
```

The primary v1 deliverable is **user-declared generic functions** plus an
audited set of library-handler conversions — a full audit of all 281
library `type:` sites (2026-08-01,
`docs/scratch/2026-08-01-type-handler-audit.md`) found **26 verified
candidates**: 18 plain-generic (`Identity`, `Sort`, `Take`-class,
`Single`-class, …) and 8 bounded identity-echoes (`Reverse`, `Conjugate`,
`Inverse`, `Chop`, `Negate`, …) where `forall T: <bound>. (T) -> T`
preserves the operand's concrete kind *and* dimensions with no dimension
variables. See §7.3.

What this is **not** (see §9 Non-goals): no variable-referencing or
F-bounded bounds, no generic *function literals* (only opaque
declarations), no type packs, no higher-rank or higher-kinded types, no
dimension variables, no effect variables.

## 3. Surface syntax — RULED: Option C, explicit `forall` clause

(Author direction 2026-08-01; supersedes the earlier Option A/B pair,
recorded at the end of this section.)

A polytype is written as a **prefix, dot-terminated quantifier clause**
followed by a function signature:

```
forall T. (T, T) -> T
forall T: indexed_collection. (T) -> T
forall T: number, U. (list<T>, (T) any -> U) -> list<U>
forall Elem. (list<Elem>) -> Elem        // any identifier — no naming convention
```

### Grammar

```
<type>          ::= <forall_type> | <union_type> | <function_signature>
<forall_type>   ::= "forall" <var_decl> ( "," <var_decl> )* "." <function_signature>
<var_decl>      ::= <identifier> ( ":" <type> )?      (* bound must be GROUND — validated at boxing *)
```

- **Variables are declared, not inferred from a naming convention.** Any
  identifier can be a variable; within its arm a quantified name
  **shadows** a nominal type of the same name. An identifier that is
  neither quantified nor a known nominal type remains what it is today: an
  unresolved-reference error. No `[A-Z][0-9]*` rule, no positional
  disambiguation apparatus, no `declareType('T')` ban.
- **The dot is load-bearing.** A bound is a type, and types have unbounded
  right edges (`forall T: (real) -> real (g: T) -> boolean` is unparseable
  without a terminator). The dot self-terminates the clause, reads as the
  prenex quantifier §2 invokes, and avoids the visual collision of
  `<T: number>` with type *application* (`list<T>`).
- **Prefix, not postfix, on standing precedent**: the effects-model syntax
  round rejected the postfix-trailer shape for reasons that transfer
  verbatim — decisively nesting: a clause on a *callback parameter* inside
  another signature is ambiguous without mandatory inner parens, exactly at
  the dominant use site.
- **`forall` becomes a reserved word in type strings.** `declareType`
  rejects it (`reserved-type-name`, §7.2). Technically breaking for a
  nominal type named `forall` — accepted (far less likely than the old
  Option A's single-letter ban).
- **Intersections (overload sets): per-arm clauses, parenthesized.**
  `(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)` — each
  clause scopes over its own arm (matching §4.1's per-arm quantification;
  the two `T`s are unrelated). A bare `forall` clause over an intersection
  is a **parse error in v1**; distribution can be admitted later without
  breaking anything.
- **The clause is top-level (or arm-level) only — nested `forall` is
  rejected.** The grammar as written puts `<forall_type>` in `<type>`, so
  rank-2 spellings (`forall T. ((forall U. (U) -> U)) -> T`, a `forall`
  result, or a `forall` bound) are *syntactically* admitted; declaration
  boxing rejects a clause in any nested position — parameter, result,
  element, or bound — with `unsupported-variable-position` (§7.2, §11
  pin). The value-level case is distinct and stays fine: a generic
  *function* passed as a callback actual is the §4.3 polytype-actual
  rule, which needs no type-level nesting.
- **Bounds** (`T: <ground-type>`) declare an upper bound on the variable;
  semantics in §4.3. v1 restrictions: the bound must be **ground** — no
  variables in bounds (no `T: list<U>` cross-references, no F-bounded
  `T: comparable<T>`); violations are declaration-time errors (§7.2). An
  unbounded variable's implicit bound is `any`.
- **Effects compose unchanged.** The effects specifier slot is positionally
  isolated between the argument list and the arrow, so it composes with
  the clause: `forall T. (T) random -> T`, `forall T. (T) pure -> T`.
  Round-trip rows (including stated-`pure` on a polytype arrow surviving
  serialize → parse → declare with its contract intact) are pinned in §11.
- **Serialization** emits the clause back with the author's variable names
  (round-trips by construction; see the α-blindness note in §5).

### Version skew (probed 2026-08-01)

`ce.type('forall T. (T) -> T')`, `ce.type('(T) -> T')`, `ce.type('T')`,
and `ce.type('list<T>')` all **throw** today ("Failed to parse type").
Option C claims dead syntax: an older engine receiving a newer engine's
generic type string **fails closed** — the same skew posture as the
effects model's unknown-label rule (unknown syntax = hard error; adding it
is a visible minor-version event).

### Superseded options (recorded)

- *Option A — naming convention* (`[A-Z][0-9]*` identifiers in type
  position are variables): terse, but requires a reserved-name convention,
  a `declareType('T')` breaking change, positional-disambiguation rules,
  and a *second* future syntax for bounds. Superseded.
- *Option B — TypeScript-style `<T, U>` prefix*: unambiguous but visually
  collides with type application (`list<T>`), and `<T: number>` reads as
  both application and bound. Superseded. A leading `<` in a type string
  remains a parse error (unclaimed).

### Where a variable may appear (v1 fragment)

Within its arm, a quantified variable may appear in (error
`unsupported-variable-position` otherwise, at declaration boxing):

- a bare argument/result position (`forall T. (T, T) -> T`);
- a covariant element position of a supported constructor: `list<…>`,
  `vector`/`matrix`/`tensor` element, `tuple<…>` elements, `set<…>`,
  `collection<…>`/`indexed_collection<…>`, `broadcastable<…>`,
  `dictionary<…>` values, record field types;
- inside a function-typed parameter or the result (nested arrows are
  allowed; they share the arm's variables — see §4.1).

**Not** in v1: a variable under a union arm (`T | string`), inside an
intersection (`T & number`), under negation (`!T`), inside a **bound**
(§3 above), or as the base of a numeric range (structurally impossible —
`NumericType`'s base is a closed primitive enum). These each need bespoke
inference rules and are rejected at declaration time rather than left
undefined. Lifting the restriction is future work.

## 4. Semantics

### 4.1 Quantification and scope

- A `forall` clause quantifies **one signature arm** (rank-1). Within the
  arm, all occurrences of a quantified name — including inside nested
  function-typed parameters — are the same variable: in
  `forall T, U. (collection<T>, (T) any -> U) -> collection<U>` the
  callback's `T` is the collection's `T`.
- **Overload sets quantify per arm** (§3): each parenthesized arm carries
  its own clause; same-named variables in different arms are unrelated.
  α-equivalence (§5.3) and every per-declaration check below run per arm.
- A type containing free variables is a **polytype**. Polytypes are legal
  **only as function signatures** (the grammar enforces this: a `forall`
  clause prefixes a signature). Internally-constructed open non-signature
  types are implementation details, never declarable (`ce.declare('x',
  <open list type>)` → `unresolved-type-variable`).
- **Result-reachability check:** every variable must appear in at least one
  argument position of its arm; a variable that occurs only in the result
  (`forall T. () -> list<T>`) is a declaration-time error
  `unsolvable-type-variable`. The honest basis differs by bound-ness, and
  both halves reject: an **unbounded** result-only variable is
  *always unsolvable*; a **bounded** one (`forall T: number. () ->
  list<T>`) is not unsolvable — S3 would solve it to its bound at every
  call — but is *redundant with its bound*: the author should write
  `list<number>` directly, and admitting the spelling would add a second
  way to write a ground type for no benefit. (Recorded so a future reader
  does not "fix" the check to admit the bounded case as harmless.) The
  check does **not** guarantee a bound at every call — an optional or
  variadic position can be empty at runtime — which is why the solver has
  an explicit zero-bound fallback (§4.3 step S3).
- **Unused quantified variables** (declared in the clause, absent from the
  arm) are a declaration-time error (`unsolvable-type-variable`) — with an
  explicit clause this is always an authoring mistake.
- **Generic function literals are out of scope in v1.** A `forall` clause
  is not accepted on function-literal type annotations; a literal cannot
  introduce type variables. Reason: the typed-literal pipeline installs
  parameter types *before* body canonicalization, so an open `T` would
  flow into `Add` and the algebra helpers while typing the body —
  violating the ground-type invariant below. v1 generics are for
  **opaque** implementations (JS `evaluate` handlers, built-in operators).
  Per-call body instantiation for literals is the **v2 milestone**
  (§9.1, ruled 2026-08-01) — in v1 the rejection stands, and the D7
  diagnostic may mention the planned v2 form.
- **The assignment boundary (declare-then-assign) — D7.** `Ground <: Poly`
  being false (§5 rule 2) means a function-literal body can never satisfy
  a generic declaration: the literal's inferred type is ground. Since
  declare-then-assign is the documented, load-bearing idiom (mandatory for
  recursion), this consequence is surfaced explicitly, not left to a
  generic mismatch:
  - Assigning a function-literal body to a symbol declared at a polytype
    produces a **dedicated diagnostic** ("a generic declaration cannot
    take a function-literal body in v1; supply an `evaluate` handler") —
    not a bare `incompatible-type` comparing a polytype against
    `(unknown) -> …`.
  - The check runs identically on **both routes**: the declaration
    compatibility check in `engine-declarations.ts` *and* the
    value-definition compatibility check (`boxed-value-definition.ts`,
    per-axis via `matchesDeclaredTypeAxes` since the 08-01 effects round).
    Both meet polytypes and must agree; §11 pins the rejection message on
    the `ce.assign` and `Assign`-operator routes.
  - `effectsDeclared` derives from `signatureEffects(type) !== undefined`,
    which reads polytype arrows fine — pinned: a generic declaration with
    a specifier (`forall T, U. (T, U) random -> U` — note `U` must occur in
    an argument position per the result-reachability rule above; the earlier
    draft's `(T) random -> U` spelling is rejected by this spec's own check)
    still records the effects
    contract.

### 4.2 The ground-type invariant — and its enforcement

**Invariant:** `expr.type` of an application result or operand is always
ground (no free variables). The only expressions whose `.type` is a
polytype are function values/symbols declared at a generic signature.

This is what keeps the change bounded — everything downstream of an
application (broadcasting, numeric evaluation, assumptions) continues to
see ground types. But the invariant must be **enforced, not assumed**; the
v2 review found two concrete leak paths, closed as follows:

1. **Symbol narrowing in `validate.ts`.** The in-loop narrowing
   (`op.infer(param, 'narrow')`, ~682–690 and the variadic twin ~868–876)
   assigns the parameter type verbatim to an already-inferred symbol.
   **Rule: every `validate.ts` site that consumes a parameter type
   (`matches`, `isSubtype`, `infer`) operates on the *instantiated* ground
   parameter** — the solver runs over the operand list first (§4.3), each
   position's pattern is substituted with the solution, and narrowing (and
   any other write) uses only that ground projection. If a parameter is
   still open at such a site (partial solution during the walk), the site
   **skips** rather than writes. Regression test pinned in §11.
2. **Typed function-literal bodies** — closed by the §4.1 rule (no
   `forall` on literal annotations in v1).

Additionally, `narrow`/`widen`/`meet` and the other algebra helpers
assert/decline on `kind: 'variable'` inputs so any future leak is loud, not
silent. (Per CLAUDE.md, `console.assert` is stripped in production builds —
the enforcement above is the *skip/ground-projection rules*, which run in
production; the asserts are a dev-time tripwire only.)

### 4.3 Call-site instantiation (local type inference)

The solver is **embedded in the existing `validateArguments` per-operand
walk** — it is not a separate pre-pass and it does not bypass any admission
gate (§4.5). It is read-only (write-free): its output is a binding map; the
only writes remain the existing post-admission narrowing, now fed ground
instantiated parameters (§4.2).

Given one signature arm with variables V (each with declared bound `Bᵥ`,
implicitly `any` when unbounded) and the admitted actual operand types
A₁…Aₙ:

**Pass 1 — non-function parameters (covariant).** For each parameter whose
pattern is not function-typed, walk pattern vs. actual structurally:

- Pattern is a bare variable `T` → record the actual type as a **lower
  bound** on `T`.
- Pattern is a supported constructor (§3 fragment) → require the actual to
  match the constructor (existing subtype machinery on the ground
  skeleton), then recurse into the corresponding element types. A union
  **actual** distributes: every arm of the actual must match the pattern,
  each contributing bounds. For `broadcastable<T>` patterns the
  decomposition is two-shape (§4.4). For a **dimensioned** actual
  (`matrix<integer^(2x3)>` against `indexed_collection<T>` or `list<T>`),
  the element extraction must be pinned to match `collectionElementType`'s
  existing behavior — an implementation-blocking sub-rule for the
  `Take`-class conversions (audit note, §7.3), to be fixed with a
  measured probe before phase 3.
- Pattern is ground → ordinary `isSubtype` check, as today.
- A **variadic** parameter pattern containing a variable collects one bound
  per matching actual (all folded into the same variable's bound set). An
  **omitted optional** or an **empty variadic** contributes no bounds. An
  operand consumed via **`Spread`** contributes no bounds (its effective
  arity/type is a runtime matter; validation already defers it).

**Pass 2 — function-typed parameters.** Processed in two order-independent
sweeps (never per-parameter with an early fallback — accept/reject must not
depend on which callback is walked first):

- **Pass 2a (covariant sweep):** for *every* function-typed parameter
  pattern `(P₁…Pₖ) -> R` with actual callback type `(A₁…Aₖ) -> Rₐ`, walk
  the **result** `R` vs `Rₐ` covariantly, collecting lower bounds exactly
  as in pass 1.
- **Solve (S1–S3):**
  - **S1.** For each variable with lower bounds, `T := joinBounds(lowers)`
    (bound-join table below — *not* raw `widen`).
  - **S2.** A variable with no lower bounds but with upper bounds (from
    pass 2b and/or its declared bound) solves to `meetBounds(uppers)`.
  - **S3 (zero-bound fallback).** A variable with **no call-site bounds at
    all** after both passes — possible via omitted optionals, empty
    variadics, or `Spread` — solves to its **declared bound** if it has
    one, else **`unknown`**. Explicitly *not* via literal `widen()` of an
    empty set, which returns `never` (the correct element type for an
    empty list, and precisely the wrong answer here: an omitted optional
    must not type the result "impossible").
- **Pass 2b (contravariant sweep + satisfiability):** for every
  function-typed parameter, walk each **parameter** position `Pᵢ` vs `Aᵢ`:
  the constraint is `Pᵢ[σ] <: Aᵢ`. A bare variable in `Pᵢ` yields an
  **upper bound** `Aᵢ`. The **declared bound `Bᵥ` joins the upper-bound
  set** of its variable. After the sweep, check satisfiability: for every
  variable, `solution <: meetBounds(uppers)`; multiple upper bounds
  combine by meet. Disjoint upper bounds (empty meet) → failure. A
  violated *declared* bound reports with the §8 supplementary line naming
  the bound. Effects and arity of the callback are checked by the
  **existing** signature-subtype relation on the instantiated expected
  arrow — inference contributes types only (§4.6).
  - **Absorbed-`unknown` × upper bounds — D8 (ruling recommended: (a)).**
    When a variable's solution is the absorbed `unknown` (a non-inferable
    unknown operand, table below), the satisfiability check treats every
    upper bound as **provisionally satisfied** — matching the engine's
    admission optimism (deferred/overlap-provisional admission, §4.5);
    the runtime stays the honest party. The alternative — rejecting, and
    carving the shape out of the §4.5 parity requirement — would make a
    generic signature *statically stricter* than its ground counterpart
    on unknown operands. Worked-example row in §4.7.
- A **polytype actual** (passing generic `first` where a function is
  expected) is admitted via the `Poly <: Ground` rule of §5 against the
  instantiated expected arrow. If the expected side is still open *and* the
  actual is a polytype, v1 declines (no higher-order unification).

**Failure and result.** Any constraint failure takes the same error path as
today's signature mismatch (`incompatible-type` via `validateArguments`,
format in §8). On success, the result type is the solution substituted into
the arm's result.

**Bound-join table** (`joinBounds` — how special *lower* bounds combine;
this is where the solver deliberately differs from raw `widen`):

| Bound encountered | Effect on `T` | Rationale |
| --- | --- | --- |
| ordinary ground type | joins via `widen` | the normal case |
| `never` (e.g. from `list<never>`, the empty list) | neutral (identity) | `Concat([], [1]) → T = integer` |
| `any` | `T = any` (absorbing) | actual could be anything |
| `unknown`, from a **non-inferable** operand | `T = unknown` (absorbing) | raw `widen(unknown, X) = X` would *discard* the unknown and overstate the result — unsound (`(T,T)->T` at `(unknown, integer)` must not claim `integer`); upper bounds then check provisionally (D8) |
| `unknown`/`any`, from an **inferable symbol** (`valueDefinition.inferredType`) | contributes **no bound**; symbol is eligible for post-solve narrowing to the position's instantiated ground type | mirrors today's inferred-symbol admission + narrowing |

### 4.4 Broadcastable patterns and lifted operands

`broadcastable<T>` is the one constructor with two admission shapes
(`T <: broadcastable<T>` and any indexed collection of `T` `<:
broadcastable<T>`), so its decomposition is explicit:

- scalar actual `S` → lower bound `T ≥ S`;
- indexed-collection actual with element type `S` → lower bound `T ≥ S`;
- actual `broadcastable<S>` → lower bound `T ≥ S`.

**Lifted operands at a bare-variable pattern — D10 (RE-RULED 2026-08-04;
supersedes the original ruling (a)).** The scalar-base decomposition
above applies to `broadcastable<T>`-**constructor** patterns only. A
**bare variable** (the identity-echo shape, `forall T: number. (T) -> T`
on a `broadcastable: true` operator) interacts with the broadcast-lift
admission gate differently — and a naive reading of the two rules would
contradict: `Negate([1, 2, 3])` is lift-admitted via the scalar base
(`integer <: number`), but the elementwise *result* is a `list<integer>`.

The rule: **for a lift-admitted operand at a bare-variable pattern, the
bound/admission check uses the scalar base (existing lift semantics,
unchanged), and the variable binds the operand's ELEMENT type.** The
call site's ordinary broadcast wrap then re-adds the operand's rank, so
the echo still ends up `list<integer>` end to end. The solver has the
lift information locally: it is embedded in `validateArguments`, where
the lift gate fires (§4.3/§4.5).

*What the peel is.* Only the kinds a broadcast actually MAPS are peeled —
`list`, `indexed_collection`, `broadcastable`. The lift ADMISSION gate is
deliberately looser (it admits any could-be-collection operand at a
threadable position), and the two must not be conflated: a `set` is
admitted but never mapped (`Conjugate(Set(1, 2))` stays inert and stays
`set<…>`), a `tuple` is atomic under broadcast (`Negate((1, 2))` is a
tuple), and a plain scalar actual — `broadcastable` means
scalar-OR-collection — contributes itself. Where it does apply the peel
goes to the scalar LEAF, not one level: the runtime maps all the way down
(`x ↦ (x, x)` over a 2×2 matrix evaluates to a 2×2 of pairs of scalars),
which is exactly the rank `broadcastShapedResultType` re-adds. This also
means the declared-bound waiver below stays load-bearing: it covers the
admitted-but-never-mapped kinds, whose whole-actual bound would otherwise
be blamed against the scalar declared bound.

*Why it was re-ruled.* The original ruling had the variable bind the FULL
actual, with a `liftedEchoPositions` short-circuit un-wrapping the result
at bare-variable echoes. Measured (2026-08-04, five shapes): the runtime
maps at every lift-admitted position, so a result that merely MENTIONS
the variable — which the short-circuit could not recognize — typed one
rank too high. `forall T. (T) -> tuple<T, T>` over `[1, 2]` typed
`list<tuple<vector<…^2>, vector<…^2>>>` against the value `[(1,1), (2,2)]`
(`list<tuple<integer, integer>^2>`). Element-binding makes one rule cover
every result shape and retires the short-circuit: for the bare echo the
final type is unchanged by equivalence (unwrap ∘ whole-bind ≡ wrap ∘
element-bind). Two consequences beyond the fix, both *toward* §4.5
parity: a mixed-rank or union-typed operand now gets the wrapper's
(coarser) shape answer, the same one its ground counterpart gets; and
`Remainder(M, 7)`-shaped calls no longer widen to a union at all.

Alternatives considered (unchanged, and still declined): (b) spelling
every echo as a scalar-arm/collection-arm overload pair — explicit but
doubles each declaration and cannot cover nested broadcast depth without
further arms; (c) dropping the four broadcastable echoes
(`Conjugate`/`Chop`/`Negate`, and future ones) from D4 — forfeits
audited conversions. Worked-example row in §4.7; §11 pin.

### 4.5 Interaction with existing admission gates

The solver runs inside `validateArguments` and **each existing admission
gate keeps its current behavior**; the table states what each contributes
to inference:

| Existing gate | Solver behavior |
| --- | --- |
| operand already invalid | no bound; existing error path unchanged |
| inferable unknown/`any` symbol | no bound; post-solve narrowing to the instantiated ground param (§4.2 rule 1) |
| non-inferable `unknown`/`any` operand | bound per the §4.3 table (absorbing; uppers provisional per D8) |
| broadcastable lift / threadable call | `broadcastable<T>`-constructor patterns: bounds from the scalar base (§4.4); a lift-admitted operand at a **bare-variable** pattern binds its ELEMENT type (mapped kinds only), admission still checked at the base (§4.4, D10) |
| deferred (overlap-provisional) collection admission (`deferredIdx`) | **no bound** — the position is provisionally admitted exactly as today; its runtime re-validation is unchanged; variables relying only on it fall to S3 |
| missing-value stripping | stripped before inference; contributes nothing |
| `Spread` operand | no bound (§4.3 pass 1) |
| non-strict mode | admission unchanged; bounds recorded only from positions that pass the gate |
| `lazy: true` operator | the whole mechanism is **idle** — lazy operators' operands are not validated, so no inference runs; lazy higher-order operators keep their imperative handlers in v1 (§7.4) |

The lazy-idle row is a **landmine ledger**, pinned as such (the 08-01
measurement found `Iterate`'s and `Product`'s bounds inert for exactly this
reason): if the lazy carve-out ever closes, every generic signature
meanwhile declared on a lazy operator becomes live at once, on the
highest-traffic operators. §11 pins a named test that a lazy operator with
a generic signature stays idle — so closing the carve-out later fails that
test and forces the interaction to be reconsidered deliberately, instead of
silently activating dormant bounds.

**Parity requirement (§11):** for every gate, a generic signature and its
ground instantiation must accept/reject identical call sets. (D8's
provisional reading is what keeps the non-inferable-unknown row inside
this requirement rather than carved out of it.)

### 4.6 Effects

Variables range over **types only**; substitution never touches the effects
slot of any arrow, and inference contributes no effect constraints —
callback effect compatibility is checked by the existing effects subtyping
rules (`docs/EFFECTS-MODEL.md`) on the instantiated expected arrow.

One consequence for signature *authors*: a bare arrow `(T) -> U` is a
pure-callback bound. An operator that accepts arbitrary (effectful)
callbacks — as `Map` does today via the `function` primitive — must write
the effect-top form **`(T) any -> U`**.

Any future migration of a callback-taking operator must acceptance-test
the **three operand classes that killed the 08-01 narrowing survey**
(pinned in `collection-callback-signatures.test.ts`): a named library
predicate, a `function`-typed symbol, and an unknown-result lambda.
Instantiated bounds admit the first and third (§1); the
**`function`-typed-symbol class still fails** even here — the `function`
primitive is not a subtype of any concrete signature — so predicate-class
migration stays gated on a ruling for that class (a `function`-actual
admission carve-out at instantiated bounds, or accepted regression);
recorded in §7.4.

### 4.7 Worked examples

| Signature | Actuals | Solution | Result |
| --- | --- | --- | --- |
| `forall T. (T, T) -> T` | `integer`, `real` | `T = real` (join) | `real` |
| `forall T. (T, T) -> T` | `unknown` (non-inferable), `integer` | `T = unknown` | `unknown` |
| `forall T. (list<T>) -> T` | `list<integer \| string>` | `T = integer \| string` | `integer \| string` |
| `forall T. (T?) -> list<T>` | *(none)* | `T = unknown` (S3) | `list<unknown>` |
| `forall T: number. (T?) -> list<T>` | *(none)* | `T = number` (S3 → declared bound) | `list<number>` |
| `forall T. (T+) -> list<T>` | `integer`, `real`, `rational` | `T = real` (fold join) | `list<real>` |
| `forall T, U. (tuple<T, U>) -> tuple<U, T>` | `tuple<integer, string>` | `T = integer`, `U = string` | `tuple<string, integer>` |
| `forall T: indexed_collection. (T) -> T` | `matrix<integer^(2x3)>` | `T = matrix<integer^(2x3)>` (verbatim; bound ✓) | `matrix<integer^(2x3)>` — kind + dimensions preserved |
| `forall T: indexed_collection. (T) -> T` | `set<real>` | — | bound violated: `set<real>` is not an `indexed_collection` (§8 names the declared bound) |
| `forall T: number. (T) -> T` on a `broadcastable: true` operator | `list<integer>` (lift-admitted) | admission at the scalar base (`integer <: number` ✓); `T = integer` (ELEMENT, D10) | `list<integer>` — the call site's broadcast wrap re-adds the rank |
| `forall T. (T) -> tuple<T, T>` on a `broadcastable: true` operator | `list<integer>` (lift-admitted) | `T = integer` (ELEMENT, D10) | `list<tuple<integer, integer>>` — one rank, matching the value `[(1,1), (2,2)]` |
| `forall T, U, V. ((U) -> V, (T) -> U) -> (T) -> V` | `(real) -> string`, `(integer) -> real` | 2a: `V ≥ string`, `U ≥ real` → `U = real`, `V = string`; 2b: `U <: real` ✓, `T <: integer` → `T = integer` | `(integer) -> string` |
| `forall T. ((T) -> boolean, (T) -> boolean) -> T` | `(integer) -> boolean`, `(real) -> boolean` | 2b uppers: `T <: integer`, `T <: real` → `T = integer` (meet) | `integer` |
| `forall T. ((T) -> boolean, T) -> T` | `(integer) -> boolean`, `unknown` (non-inferable) | `T = unknown` (absorbed); upper `T <: integer` **provisionally satisfied** (D8) | `unknown` |
| `forall T. (list<T>) -> T` | `set<real>` | — | mismatch: not a `list` (unchanged path) |

The `compose` row is the order-independence witness: `U` occurs
contravariantly in argument 1 and covariantly in argument 2; the 2a/2b
split makes the outcome identical regardless of operand order (test pinned
in §11 with the operand order reversed). The `matrix` row is the
identity-contract witness: a bounded bare variable solves to the operand
type *verbatim*, which is what makes the `Reverse`-class migratable
(§7.3).

## 5. Polytypes and the subtype relation

`isSubtype` gains three rules; everything else is untouched:

1. **`Poly <: Ground`** — true iff *some instantiation* is a subtype.
   Implementation: collect bindings by matching the ground signature's
   parameter types against the polytype's parameters **contravariantly**
   (a ground param `Gᵢ` flowing into a bare poly-param variable yields a
   lower bound) and the results covariantly, solve as in §4.3 (declared
   bounds join the upper-bound sets) — and then **run the complete
   existing signature-subtype check on the substituted arm vs. the ground
   signature**: result covariance, effects, arity shape
   (required/optional/variadic, `variadicMin`), named slots.
   Instantiation alone is *not* acceptance.
2. **`Ground <: Poly`** — **false**. A polytype promises every
   instantiation; no single ground signature delivers that. (User-visible
   consequence at the assignment boundary: §4.1, D7.)
3. **`Poly <: Poly`** — **α-equivalence only** in v1 (same shape up to
   consistent renaming, computed per arm; **declared bounds compare
   structurally**), plus reflexivity.

### 5.1 Free variables in the query APIs (D6)

Under Option C, the public string API can only construct polytypes as
`forall`-prefixed signatures; open *non-signature* types are
internal-only values (never declarable, §4.1). The v1 query-API
semantics, as RULED (D6 + the D12 amendment): **pattern-side
`BoxedType.matches` is a consistent existential instantiate-and-check**
(solve the pattern's variables against the subject via the §4.3 solver;
match iff a consistent instantiation exists — see the D12 block below),
while **`couldMatch` — and the subject-less `at`-handler check — treat
each free variable occurrence as its declared bound** (`any` when
unbounded), a wildcard *without* cross-occurrence consistency. The
bullets below analyze the bound-reading; post-D12 they apply to
**`couldMatch` only**:

- **The reading is positional, not one coherent quantifier.** A
  variable-bearing pattern could ask "is the subject *some*
  instantiation?" (existential) or "is it a subtype of the polytype
  itself?" (universal — rule 2, false for any ground subject). The
  wildcard reading gives neither uniformly; ordinary variance decides
  per occurrence. **Covariant occurrences behave existentially**:
  `matches('forall T. () -> list<T>')` reads as `() -> list<any>`, so
  `() -> list<integer>` matches. **Contravariant occurrences behave
  universally**: `ce.type('(number) -> number').matches('forall T. (T)
  -> T')` reads the pattern as `(any) -> any` and is **false** (the
  subject's parameter would need to be a supertype of `any`). The
  contravariant answer happens to agree with rule 2, but by variance,
  not by design — users probing "does this look like an identity
  function?" get `false` for every concrete function, the most likely
  user surprise of this ruling.
- **No cross-occurrence consistency ⇒ a bounded false-positive class.**
  `matches('forall T. () -> tuple<T, T>')` reads as
  `() -> tuple<any, any>` and accepts `() -> tuple<integer, string>` —
  no single `T` exists. In v1 this class is confined to covariant
  positions *inside signatures*: Option C makes bare open patterns
  (`tuple<T, T>`) unwritable from strings, which is most of the
  containment.
- **One internal consumer is load-bearing: the arm-aware `at`-handler
  check** (§6). It runs at definition registration with no operands and
  no solver; for the migrated identity-echoes (result type = bare `T`),
  only the bound-reading makes the result count as possibly-indexed
  (`forall T: indexed_collection. (T) -> T` → `couldMatch
  indexed_collection` → true). This is also the concrete sense in which
  D9 upgrades D6: unbounded variables make the check vacuously pass;
  bounds make it discriminating.
- **Subject-side occurrences.** A generic function symbol's `.type` is a
  polytype and flows through admission probes as the *subject*. For
  `matches`/`isSubtype`, the subject-side story is rule 1
  (`Poly <: Ground`, instantiate-and-check). For **`couldMatch` with a
  polytype subject**, the same bound-reading applies to the subject's
  variables: a generic function counts as "could be a `function`" (and
  a bounded one as "could be" its bound's shape). Without this sentence
  the case is an implementer inference; with it, both sides of both
  predicates are pinned.
- **Upgrading later is a behavior change, not an addition.** The future
  binding-extraction API (`matches(…) → {T: integer}` with
  cross-occurrence consistency, §9) flips today's false positives
  (`tuple<integer, string>` above goes from `true` to `false`). The
  "documented stopgap" label is therefore the migration story itself:
  consumers are told not to rely on inconsistent-occurrence matches, and
  the tightening ships as a visible, versioned semantic change.
- **The open fork (D6):** loose-wildcard-documented (above) vs.
  **rejecting repeated-variable patterns** in `matches`/`couldMatch`
  (error rather than a loose answer), which eliminates the
  false-positive class at the cost of refusing some harmless queries.
  Single-occurrence patterns behave identically under both.

**D12 — pattern-side `matches` goes existential (RULED adopt,
2026-08-01).** D6 was ruled as the loose wildcard above; the v4
review proposed a third reading for pattern-side `matches` specifically:
**consistent existential instantiate-and-check**, reusing the phase-2
solver (stateless, write-free, exists regardless) — solve the pattern's
variables against the subject; match iff a consistent instantiation
exists. Under it, `matches('forall T. (T) -> T')` answers **true** for
`(number) -> number` (the probe users actually mean), and the future
binding-extraction API becomes a pure *addition* (return the bindings)
rather than a semantic flip — the semantics is final from day one. One
claim from the review corrected for the record: existential matching
does **not** fail `() -> tuple<integer, string>` against
`'forall T. () -> tuple<T, T>'` — under the ruled D2 join semantics
`T = integer | string` is a genuine solution, so the answer stays
`true`; what changes is its *status* (a coherent existential answer,
not a documented false positive that later tightening would flip).
Costs: `matches` on variable-bearing patterns becomes solver-powered
(dispatch gated on the same O(1) `isPolymorphic` flag, so ground
patterns cost nothing). `couldMatch` and the subject-less `at`-handler
check keep the bound-reading either way — the two predicates are pinned
separately regardless. If adopted, the bullets above describing the
contravariant surprise and the upgrade-as-breaking-change apply only to
`couldMatch`, and D6's "documented stopgap" burden disappears for
`matches`.

Because the standing overlap pin distinguishes `couldMatch` ("could be")
from `!isDisjointFrom`, §11 pins the two wildcard readings
**separately** — pattern-side and subject-side — so they cannot diverge
if implemented independently.

**Caching and identity.** The relevant live cache is `parseType`'s
string-keyed `TYPE_CACHE` (`common/type/parse.ts`, gated on resolver
absence). Variables are resolver-independent, so variable-containing type
strings remain cacheable there. (There is **no** subtype-pair memo in
`subtype.ts` — one was prototyped and rejected as a measured regression;
see the "NOT memoized" note there. Nothing in this design reintroduces
one.) Two recorded hazards:

- **No-mutation invariant on substitution.** Polytypes are *shared*
  objects — interned via `TYPE_CACHE` and stored on definitions.
  `substituteTypeVariables` must **rebuild every node on the substitution
  path and never write in place** (the effects work hit exactly this
  hazard class; see `_setEffects`'s rebuild rule). §11 pins it: parse the
  same generic string twice, instantiate one at a call site, assert the
  cached polytype and the definition's stored signature are structurally
  unchanged.
- **α-blindness of string-keyed identity.** `typeToString` (and the
  effects round's `typeToDedupKey`) key structural dedup in `reduce.ts`;
  α-equivalent polytypes with different letters (`forall T. (T) -> T` vs
  `forall U. (U) -> U`) produce different strings, so every string-keyed
  identity site is α-blind. Harmless in v1 (variables cannot appear under
  unions, §3). Recorded so nobody later "fixes" a non-merging pair by
  canonicalizing variable names **in the serializer** without ruling on
  round-trip fidelity — the author's letters round-trip by construction,
  which §3/§7.1 rely on.

## 6. Where it hooks in

| Site | Change |
| --- | --- |
| `common/type/` (new `instantiate.ts`) | `freeTypeVariables(t)`, `substituteTypeVariables(t, bindings)` (pure rebuild — §5 no-mutation pin), `inferTypeArguments(arm, actuals) → bindings \| null` (the §4.3 solver, bounds included) |
| `boxed-expression/validate.ts` | solver embedded in the per-operand walk (§4.3/§4.5); **all param-consuming sites — including the in-loop narrow at ~682–690 and ~868–876 — operate on instantiated ground params, and skip writes while a param is open** (§4.2 rule 1) |
| `boxed-expression/boxed-function.ts` (result typing) | polytype signature → result = substituted result type |
| `boxed-expression/overload.ts` | each arm instantiated **independently** (per-arm clauses, §4.1); admissibility and specificity computed on the *instantiated* arms; resolution returns **each viable arm's ground instantiation + bindings** so the existing viable-arm parameter join (`joinParamAt`) consumes only ground types; the selected arm's instantiation feeds result typing; everything stays write-free. **Generic-vs-ground tie (D11, RULED ground-wins): a ground arm beats an instantiated-generic arm when the two are identical after instantiation** (`(forall T. (T) -> T) & ((integer) -> integer)` at `integer`) — "most specific declaration wins" is why an author writes the specialized arm at all (distinct handler or effects); without the rule, resolution falls through to declaration order and order-independence breaks silently. §11 pins the tie with the arms in both declaration orders. |
| `engine-declarations.ts` + `boxed-value-definition.ts` | the D7 assignment-boundary diagnostic (§4.1), identical on both routes (`matchesDeclaredTypeAxes` meets polytypes) |
| `boxed-operator-definition.ts` | the disabled result-type/`at`-handler check is replaced by an **arm-aware rule**: error only when an `at` handler is present and *no* arm's result type `couldMatch` `indexed_collection` (a bounded variable reads as its bound here, per §5 — `forall T: indexed_collection. (T) -> T` counts as possibly-indexed). Operators with one conditional `at` handler over mixed indexed/non-indexed arms are legal and produce no warning. |
| `compilation/` | calls *to* generic operators need no change (ground results, §4.2). Compiling a generic **user function itself** — where `base-compiler.ts` reads declared *parameter* types for coercion/broadcast — **declines** in v1 (returns undefined per the decline convention, never throws). Threading instantiated signatures into compilation is future work. |

**Precedence:** an explicit `type:` handler continues to override the
signature-derived result type. Handlers remain necessary where the result
depends on *values* (`At` with a literal index, `Tuple`'s variadic
per-element type) or on structure the v1 fragment can't express (§7.4).

**Symbol-type inference:** an argument at a bare-`T` parameter exerts no
narrowing pressure of its own; post-solve narrowing (per §4.2 rule 1) may
narrow an inferable symbol to the position's *instantiated* type.
Propagating a partial solution as the expected type of a later
unknown-typed argument is a possible v2 refinement, noted, not planned.

## 7. Representation and implementation plan

### 7.1 Type layer

```ts
/** A universally quantified type variable (rank-1). Only legal inside a
 * function signature; declared and scoped by its arm's `forall` clause. */
export type TypeVariable = { kind: 'variable'; name: string };
```

Added to the `Type` union in `types.ts`. The **clause itself** lives on the
signature: `FunctionSignature` gains an optional
`typeParams?: { name: string; bound?: Type }[]` (order-preserving; bounds
ground by §7.2). Touch points, all mechanical: `ast-nodes.ts` (nodes +
visitor), `lexer.ts`/`parser.ts` (`forall` keyword, clause, dot; variable
scope tracked during the arm's parse so a quantified name parses as
`kind: 'variable'` and shadows nominal lookups), `serialize.ts` (emit the
clause with the author's names — round-trips by construction),
`reduce.ts` (variables are atomic and opaque, like `broadcastable`: never
collapsed, never distributed), `primitive.ts` guards, `type-builder.ts`,
`boxed-type.ts`.

`isPolymorphic` is computed **once at construction** and stored as a flag
on `BoxedType` (and on the boxed signature in the operator definition) —
the per-call dispatch check in `validateArguments`/result-typing is an O(1)
boolean, never a tree walk (perf criterion in §7.3).

`narrow`/`widen`/`meet` and other algebra helpers never see open types:
the solver joins only ground bounds via `joinBounds` (§4.3), and the
helpers decline loudly on `kind: 'variable'` inputs (§4.2).
`substituteTypeVariables` is a pure rebuild (§5 no-mutation pin).

**Rebuild invariant: every signature rebuild preserves both adjunct
fields (`effects` AND `typeParams`).** `FunctionSignature` now carries
two optional adjuncts, and the codebase has several
rebuild-a-signature sites that reconstruct field-by-field rather than
spreading (`_setEffects`'s rebuild, `stripArrowEffects`,
`BoxedFunction.infer()`'s two rebuild branches) — the effects round
already fixed exactly this dropped-field bug class for `effects` once.
A `{...t}` spread carries `typeParams` for free; a field-by-field
reconstruction silently drops it. §11 pins it (infer/narrow a
generic-adjacent signature; assert the clause survives).

### 7.2 Declaration-time validation

Boxing a declared type validates polytypes per arm. Violation ↔ error-code
mapping (pinned so tests don't have to guess):

| Violation | Error code |
| --- | --- |
| free variable outside a function signature (internal open types reaching a declaration) | `unresolved-type-variable` |
| variable reachable only from the result of its arm; or quantified but unused | `unsolvable-type-variable` |
| variable in an unsupported position (union arm, intersection member, negation, inside a bound) | `unsupported-variable-position` |
| `forall` clause on a non-signature, on a bare intersection, on a function-literal annotation, or **nested inside another signature** (rank-2 spelling: in a parameter, result, element, or bound position — §3) | `unsupported-variable-position` |
| non-ground bound in a clause (`forall T: list<U>. …`, F-bounded) | `unsupported-variable-position` |
| `declareType('forall', …)` | `reserved-type-name` |

### 7.3 Phases

1. **Core type layer** — clause parsing (keyword, bounds, dot,
   per-arm scoping/shadowing), node, parse/serialize round-trip,
   substitution, free-variable computation, the §7.2 validations, per-arm
   α-equivalence (bounds structural), `isPolymorphic` flag. No behavior
   change for any existing type string (probed: all claimed syntax is dead
   today, §3).
2. **Call-site inference** — `instantiate.ts` solver (2a/2b sweeps,
   bound-join table, declared-bound uppers, D8 provisional rule, S3
   fallback-to-bound); embedding in `validateArguments` including the
   §4.5 gate table and the §4.2 narrowing rule; result typing;
   `Poly <: Ground`; the D7 assignment-boundary diagnostic. User-declared
   generic functions (bounded and unbounded) work end to end.
3. **Overloads + audited library migration** — arm-wise instantiation in
   `overload.ts` (with viable-arm ground join); the arm-aware `at`-handler
   check; then the handler conversions. The **full library audit ran
   2026-08-01** (all 281 `type:` sites in `src/compute-engine/library/`,
   four independent reviewers, every candidate verdict re-verified
   against source): `docs/scratch/2026-08-01-type-handler-audit.md` is
   the authoritative table. Result — **26 candidates** out of 281 (~98
   constants need no generics; ~157 blocked: value/pole/domain reasoning
   ~70, `lazy: true` ~40, type-packs/positional/dimension ~20,
   structural-kind dispatch ~15):
   - **18 plain-generic**: `Identity`, `Prime` (core);
     `KeyValuePair`/`Single`/`Pair`/`Triple`;
     `Take`/`Drop`/`Slice`/`DeleteAt` (all `-> list<T>`);
     `Insert`/`ReplaceAt` (**repeated-variable form**
     `(indexed_collection<T>, integer, T) -> list<T>` — the solver's
     repeated-variable join is `widen`, exactly what the handlers
     compute; `list<T|U>` would NOT be equivalent);
     `Sort`/`Unique`/`RandomShuffle` (**plain, not identity** — verified:
     results always rebuild as `List`, discarding source kind; the v2
     draft's identity claim for these was wrong); `Tally` (string-branch
     caveat), `Partition`, `ChunkBy`.
   - **8 bounded identity-echoes**: `Reverse`
     (`forall T: indexed_collection. (T) -> T` — the only
     identity-preserving collections handler), `Conjugate`, `Chop`,
     `Negate` (all broadcastable — check bound × broadcast-lift
     interplay), `Inverse` (`T: matrix`), `PlusMinus`
     (`(T, U) -> tuple<T, U>`), `Remainder` (`(T, T) -> T`; accepted
     tightening on the non-inferable-`unknown` edge per the §4.3
     bound-join ruling), `BaseForm` (blocked on fixing its pre-existing
     declared-result contradiction first — see audit).
   **Explicitly not migrated** (handlers stay): `First`/`Last`/`Second`/
   `Third` (tuple positional types via `componentResultType`, absence
   markers), `At` (value-dependent), `Map`/`Filter` and the rest of the
   lazy class (§7.4) — of which `Dedup` and `Comprehension` are the
   recorded would-be-clean cases blocked *solely* by laziness (landmine
   ledger, §4.5). Two defects surfaced by the audit are tracked
   independently of generics: `Find`'s handler types the whole
   collection while `evaluate` returns an element (needs an imperative
   fix; correct typing is union-position, out of the v1 fragment), and
   `BaseForm`'s declared result contradicts its handler. Each conversion
   is its own reviewable diff with a snapshot-blast-radius measurement
   (standing policy).
   **Perf acceptance criterion:** A/B benchmark before/after phases 2 and
   3; the median ratio must be within run-to-run variance — the closed
   2026-07-18 design documents how an always-on per-call mechanism
   silently cost ~1.4×; the O(1) `isPolymorphic` flag is the designed
   defense and the measurement verifies it. Measurement discipline per the
   standing traps: run the box-microloop **canary first** (≈0.02 ms/iter
   baseline), never size a perf number from `tsx` when the gate runs
   under jest (secondary V8 realm, `Math.imul` ~100×), and use the
   `benchmarks/` harness per its README rather than ad-hoc loops.
4. **Docs + Cortex surface** — new § in `doc/08-guide-types.md` (after
   "Function Signature"), CHANGELOG entry, update the "Future
   considerations" note in `types.ts`. **Cortex (D13):** Cortex type
   annotations delegate to the shared type DSL (`parseTypePrefix`), so
   full-type-literal positions inherit `forall` for free; the sugared
   definition form has no clause slot (its signature is *assembled* from
   scattered syntax by `specifierSignature()`), and giving it one is
   deferred to a joint ruling with the open effects-Stage-3
   anonymous-literal marker case. Serialization rule: polytype
   declarations never decompose into the sugared form — full-literal
   spelling, or a diagnosed error; never a stripped clause. Details and
   the capture hazard in D13 (§10).

Bounds are **designed here, sequenced freely**: the solver cost is
near-zero in this design (the classically expensive half — typing an open
generic *body* against its bounds — is already out of scope, §4.1; the
call-site half is one more upper bound folded into machinery pass 2b
already builds), so phase 2 ships them; only the `Reverse`-class
migrations depend on them landing.

### 7.4 Deferred: `Map`-class (lazy, variadic, higher-order) operators

Migrating `Map`/`Filter` in v1 is infeasible on three independent grounds
(established by the v2 review), so they are **explicitly out of v1 scope**
and their handlers stay:

1. **Type packs.** `Map`'s real contract is
   `(collection+, mapping: function) -> indexed_collection` —
   `Map(xs, ys, f)` correlates *n* independently-typed collections with an
   *n*-ary callback. Rank-1 variables cannot express a variable-length
   correlated sequence of element types.
2. **Laziness.** `Map` is `lazy: true`: `validateArguments` never walks its
   operands, so the §4.3 solver has no execution site there (§4.5
   lazy-idle pin). A post-canonical callback-inference seam for lazy
   higher-order operators is a separate design.
3. **Effects + operand classes.** Its `function`-primitive parameter
   admits effectful callbacks and `function`-typed symbols; a generic
   arrow must be spelled `(T) any -> U`, and the `function`-typed-symbol
   operand class fails against *any* concrete arrow (§4.6) — predicate/
   callback-class migration is gated on a ruling for that class
   (admission carve-out vs. accepted regression), bundled into the same
   future design.

The declarative indexed-iff-indexed overload pair
(`(forall T, U. (indexed_collection<T>, (T) any -> U) ->
indexed_collection<U>) & (forall T, U. (collection<T>, (T) any -> U) ->
collection<U>)`) remains the *target shape* for that future design;
nothing in v1 blocks it, and the arm-aware `at`-handler rule (§6) is
written to accommodate it.

## 8. Error reporting

Bound failures reuse `incompatible-type`. Two rules:

- **Displayed expected types are always ground** — the instantiated
  parameter, never variable syntax. Variable provenance goes in a
  supplementary line.
- **Deterministic blame:** the reported operand is the one whose
  constraint failed — for an upper-bound failure, the callback (or
  contravariant position) whose bound the solved value violates; for a
  violated *declared* bound, the operand that pinned the solution. The
  supplementary line names the variable, the solved value, the positions
  that pinned it, and (when applicable) the declared bound.

Example — a lower-vs-upper conflict:

```
Signature: forall T. (list<T>, (T) -> boolean) -> list<T>
Call:      keep([1, 2, 3], (s: string) ↦ …)

Expected argument 2 of type `(integer) -> boolean`; got `(string) -> boolean`.
  T was solved to `integer` (from the elements of argument 1); the callback
  requires `T <: string`, which `integer` does not satisfy.
```

Example — a violated declared bound:

```
Signature: forall T: indexed_collection. (T) -> T
Call:      shuffle({1, 2, 3})

Expected argument 1 of type `indexed_collection`; got `set<integer>`.
  T is declared with bound `indexed_collection`; a set is not indexed.
```

## 9. The v2 milestone, non-goals (v1), and future work

### 9.1 v2 milestone (RULED 2026-08-01): generic function literals + sugared definition syntax

**Status: IMPLEMENTED 2026-08-04** —
[`2026-08-04-generic-function-literals-design.md`](./2026-08-04-generic-function-literals-design.md)
is the milestone's own (ratified) spec and the record of what shipped. Read it
before this section: M1 was ruled to be **erased-body canonicalization**, none
of the three candidate approaches sketched below.

Promoted from future work by author direction. v2 delivers **generic
user functions with inline bodies**, in both spellings:

```
// full-literal annotation (works at parse in v1, rejected at D7):
const f: forall T. (x: T) scope -> T = { x + n }

// sugared definition form (new syntax, v2):
function f<T>(x: T) scope -> T { x + n }
function g<T: number, U>(x: T, k: (T) any -> U) -> list<U> { … }
```

**M1 — per-call body instantiation** (lifts the §4.1/D7 rejection).
The v1 blocker is that the typed-literal pipeline installs parameter
types *before* body canonicalization, so an open `T` would reach `Add`
and the algebra helpers. Candidate approaches, to be resolved in a
dedicated design doc (recorded here so the trade-space isn't
re-derived):

1. **Rigid-variable canonicalization** — canonicalize the body ONCE
   with `T` as a *rigid* (opaque, skolem-like) variable. Requires the
   algebra helpers to handle rigid variables soundly instead of
   declining; relaxes the §4.2 tripwire to "no *solver* variables leak;
   rigid variables are legal inside generic bodies only." The likely
   winner, but it touches the helpers' decline contract.
2. **Per-call re-canonicalization** — keep the body raw; canonicalize
   at the instantiated ground types per call, memoized per
   instantiation. No helper changes, but pays canonicalization per
   distinct instantiation, and body-canonicalization order is
   load-bearing (see the function-literal canonicalization notes) —
   the memo key must be the full instantiation.
3. **Canonicalize at the bound** — canonicalize once treating `T` as
   its bound. Recorded to be *rejected*: canonical folds are
   type-sensitive (the generic-symbol fold conventions — `x/x → 1`
   class), so a body canonicalized at `number` can differ from the
   same body at the instantiated type; unsound.

Acceptance: the D7 diagnostic is *replaced by working declarations* on
all three routes (`ce.assign`, `Assign`, Cortex annotated `const`);
`identity`/`swap` end-to-end; a **generic recursive** function
(declare-then-assign is the mandatory recursion idiom — v2 makes
generic recursion possible for the first time); the §4.2 ground
invariant holds at every application of a generic literal.

**M2 — the sugared definition form.** The clause slot is **angle
brackets after the function name**: `function f<T>(…)`, bounds
`function f<T: number, U>(…)`; effects slot and arrow unchanged.

- The earlier Option-B rejection does **not** transfer: `<T: number>`
  was rejected as a *type-string* spelling for colliding visually with
  type application (`list<T>`); in the definition head the `<` follows
  the function *name* in definition position — the TS/Rust/C++
  convention — where no type-application reading exists. Two surface
  spellings, one polytype: the type-string form stays `forall`, and
  both produce the same `typeParams` clause.
- `specifierSignature()`'s assembly gains the type-param list; with a
  clause slot, serializing a generic definition into the sugared form
  becomes **lossless**, superseding D13's v1 never-decompose rule for
  v2 (v1 keeps it — v1 serializers emit the full-literal spelling).
- The marker-encoding details are still settled jointly with the open
  effects-Stage-3 anonymous-literal case (D13) — that corner is
  encoding, not syntax, and is unchanged by this milestone.
- Grammar sketch (Cortex):
  `"function" <name> ("<" <var_decl> ("," <var_decl>)* ">")? "(" <params> ")" <effects>? ("->" <type>)? <body>`
  with `<var_decl>` as in §3 (ground bounds).

M1 is the hard half and gates M2 (sugared syntax for a body that can't
be typed is a trap); one design doc should cover both plus the §6
compile-decline lift if cheap.

### 9.2 Non-goals (v1) and other future work

- **Variable-referencing and F-bounded bounds** (`forall T: list<U>`,
  `forall T: comparable<T>`) — bounds are ground in v1 (§3).
- **Type packs / variadic correlation**, the **lazy higher-order seam**,
  and the **`function`-typed-symbol admission ruling** — the blockers for
  `Map`-class and predicate-class migration (§7.4); one future design
  covers them.
- **Dimension variables** — `forall T, M, N, P. (matrix<T^(MxN)>,
  matrix<T^(NxP)>) -> matrix<T^(MxP)>`-style. Still future work (the
  bounded identity contract covers whole-operand preservation, §4.7, but
  not dimension *arithmetic*); dimensions are integers, not types — a
  separate variable kind with its own solver.
- **Pattern matching with binding extraction** —
  `expr.type.matches(…) → {T: integer}`, with cross-occurrence consistency
  (v1's wildcard reading has none — §5, D6). Needs an API ruling on the
  binding-result shape.
- **Compilation of generic user functions** — v1 declines (§6); the
  lift (thread the call-site instantiated signature into
  `base-compiler.ts`) rides with the v2 milestone's design doc if cheap
  (§9.1), else stays future work.
- **Variables in unions/intersections/negations** — lifted only with
  defined inference rules per form (§3).
- **`forall` distribution over a bare intersection** — parse error in v1
  (§3); can be admitted later compatibly.
- **A Cortex `type` statement + generic type aliases** (scoped
  2026-08-01). User type definitions are currently unimplemented at
  BOTH layers: Cortex has no `type` statement head (`type` is not even
  a reserved word — probed: `type point = …` errors
  `unexpected-symbol`), and there is no `DeclareType` MathJSON operator
  (only the host-side `ce.declareType()`), so no *program* can
  introduce a nominal type. The statement needs both halves — a
  `DeclareType` operator (box/parse-route parity) and a
  contextual-keyword statement head (dispatch on `type <identifier> =`;
  `type` stays a legal identifier elsewhere) — plus serializer support.
  **Sequencing (recommended): the base statement lands BEFORE the
  type-variable phases.** It is independent of this spec (plain
  nominals/aliases exist engine-side today), it exercises the
  Cortex↔engine declaration boundary against the simpler pre-generics
  type layer, and it makes the §3 shadowing rule testable in pure
  Cortex programs (declare nominal `point`, shadow with
  `forall point.`). Obligation: reserve the `<…>` argument-list slot in
  the statement grammar (parse-and-reject, "requires type variables"
  diagnostic) so aliases arrive additively.
  **Generic aliases** (`type list_of<T> = list<T>`) then ride on
  phase 1: a transparent alias is a type-level function whose
  application expands **eagerly** via `substituteTypeVariables` — the
  phase-1 machinery, nothing new in the solver or subtype relation.
  The alias body is a type-level lambda body, never any expression's
  type, so §4.1's polytype-only-as-signature rule is untouched. Ground
  bounds check with one `isSubtype` at application; unapplied use
  (`list_of` bare) is an arity error. The v1 line for the statement:
  transparent generic aliases IN once phase 1 lands; **recursive**
  generic aliases OUT (need applied-reference nodes compared by
  name+args plus lazy coinductive expansion in the subtype walk) and
  **nominal** parameterized types OUT (need variance rules, explicitly
  out of scope here).
- **Higher-rank / higher-kinded types, existentials, variance
  annotations, conditional types, effect variables** — out of scope.

## 10. Decisions

**D1–D9 are RULED** (author, 2026-08-01 — "approved as recommended"):
D2 join-not-unify, D3 `Ground <: Poly` false, D4 the audited
26-candidate list, D5 lazy deferral, D6 loose wildcard (see D12 for the
proposed pattern-side amendment), D7 dedicated assignment diagnostic,
D8 provisional satisfaction; D1 (Option C) and D9 (bounds) were ruled
earlier the same day. Recorded below for the rationale; **open items
are D10–D13**.

### Settled

1. **D1 — surface syntax: RULED Option C** (author direction 2026-08-01):
   prefix dot-terminated `forall` clause, any-identifier variables,
   per-arm parenthesized clauses on overload sets, `forall` reserved in
   type strings. Spec is written Option-C-first; §3 records the
   superseded options.
2. **D2 — join semantics for repeated variables: RULED join**:
   `forall T. (T, T) -> T` at `integer, real` solves `T = real` via join
   (follows existing result-typing behavior); strict unification declined. (Deliberate exception: a non-inferable `unknown` lower bound
   absorbs — §4.3 table.)
3. **D3 — `Ground <: Poly` is false: RULED** (§5): a symbol declared at
   `(number) -> number` cannot be assigned where `forall T. (T) -> T` is
   expected. (The reverse — using a generic where a concrete is
   expected — is the common case and is supported.)
4. **D4 — phase-3 migration scope: AUDITED + CONFIRMED** (2026-08-01,
   full 281-site sweep, `docs/scratch/2026-08-01-type-handler-audit.md`):
   the verified 26-candidate list (§7.3) — 18 plain + 8 bounded in;
   `First`/`Last`-class, `At`, `Map`/`Filter` and all lazy operators
   out. Note the audit *corrected* the v2 draft: `Sort`/`Unique` are
   plain (always rebuild as `List`), not identity; `Reverse` is the only
   collections identity-echo.
5. **D5 — lazy higher-order deferral: CONFIRMED** (§7.4): `Map`-class
   operators stay on imperative handlers until the type-pack + lazy-seam
   design lands (with the §4.5 lazy-idle pin as the tripwire).
6. **D6 — v1 `matches`/`couldMatch` wildcard reading: RULED
   loose-wildcard** (§5.1): each occurrence — pattern-side *and*
   subject-side — reads as its declared bound (`any` when unbounded), no
   cross-occurrence consistency, documented as a stopgap; the two
   predicates pinned separately; the reject-repeated-variables
   alternative was declined. See **D12** for the subsequently proposed
   pattern-side amendment.
7. **D7 — assignment boundary: RULED** (§4.1): a generic declaration rejects a
   function-literal body in v1 with a dedicated diagnostic, identical on
   both declaration routes; `effectsDeclared` still recorded from a
   polytype arrow. The rejection is v1-scoped: lifting it IS the v2
   milestone (§9.1), and the diagnostic may point at the planned
   `function f<T>(…)` form.
8. **D8 — absorbed-`unknown` × upper bounds: RULED (a)** (§4.3) —
   provisional satisfaction, preserving §4.5 parity; alternative (b)
   rejection-with-parity-carve-out was declined.
9. **D9 — bounds in scope: AGREED** (author, 2026-08-01): ground upper
   bounds designed in this spec (§3/§4.3), shipped with phase 2;
   rationale — near-zero solver cost (open bodies already out of scope),
   unlocks the identity-echo class (`Reverse`, `Conjugate`, `Inverse`,
   `Chop`, `Negate`, `PlusMinus`, `Remainder`, `BaseForm` — 8 of the 26
   audited candidates), upgrades D6, and syntax is the least reversible
   piece so it is settled once, with Option C.

### Ruled in v4 (2026-08-01, approved as recommended)

10. **D10 — broadcast lift × bounded echo: RULED (a), RE-RULED
    2026-08-04** (§4.4): a lift-admitted operand at a *bare-variable*
    pattern binds its **ELEMENT** type (mapped kinds only — not `set`,
    not `tuple`, not a scalar), while admission stays checked at the
    scalar base; the call site's ordinary broadcast wrap re-adds the
    rank. The original ruling bound the FULL actual and needed a
    `liftedEchoPositions` short-circuit to un-wrap bare-variable
    results; measured evidence (five shapes, 2026-08-04) showed the
    runtime maps at every lift-admitted position, so variable-MENTIONING
    results — which the short-circuit could not recognize — typed one
    rank too high (`forall T. (T) -> tuple<T, T>` over `[1, 2]`). The
    echo machinery is retired; the bare echo is unchanged by
    equivalence. Declined then and still: (b) scalar/collection
    overload-pair spelling (doubles every echo; can't cover nested
    broadcast depth), (c) dropping the four broadcastable echoes from
    D4.
11. **D11 — generic-vs-ground arm tie: RULED ground-wins** (§6): when a
    ground arm and an instantiated-generic arm are identical after
    instantiation, the ground arm wins ("most specific declaration") —
    declaration-order fall-through declined (order-independence would
    break silently). §11 pins both declaration orders.
12. **D12 — pattern-side `matches` goes existential: RULED adopt**
    (§5.1, amends D6): consistent instantiate-and-check via the phase-2
    solver; identity-probe answers true; binding extraction becomes a
    pure future addition (semantics final from day one). Corrected
    claim on record: under D2's join, repeated-variable covariant
    patterns still answer true (`T = integer | string` is a genuine
    solution) — coherently, not as a documented false positive.
    `couldMatch` and the `at`-handler check keep the D6 bound-reading.

### Open
13. **D13 — Cortex surface** (§7.3 phase 4), revised after verifying the
    Cortex parser (2026-08-01): Cortex type annotations delegate to the
    shared DSL (`parseTypePrefix`, `cortex/parser.ts:1911/1973`), so the
    surface splits three ways rather than excluding generics wholesale:
    - **Full-type-literal annotation positions: IN the v1 surface, free.**
      They inherit `forall` from phase 1 automatically; excluding them
      would *cost* an active carve-out. Only genuine work: probe tests
      that the clause's dot terminates cleanly under `parseTypePrefix`'s
      tolerant prefix mode at annotation boundaries.
    - **The sugared definition form has no clause slot in v1.**
      `function f(x: number) scope -> number` *assembles* its signature
      from scattered syntax (`specifierSignature()`: params from the
      list, effects from the specifier slot, return after the arrow) —
      there is no position for `forall`. The slot's spelling is now
      **ruled for v2**: angle brackets after the function name,
      `function f<T: number>(…)` (§9.1 M2). What remains joint with the
      open effects-Stage-3 anonymous-literal marker case is the
      **encoding** (how the assembled signature carries its adjuncts),
      not the syntax.
    - **Serialization: a polytype declaration never decomposes into the
      sugared form.** The serializer emits the full-type-literal
      spelling; for any declaration shape with no full-literal spelling,
      a diagnosed error naming the symbol — never a stripped clause.
      (Stripping is not merely lossy: with any-identifier variables,
      `forall point. (point) -> point` minus its clause silently
      re-resolves `point` against a nominal type of that name — a
      capture, not an error.)

## 11. Test plan

- **Type layer** (`test/compute-engine/type-variables.test.ts`):
  parse/serialize round-trip for every §4.7 signature (clause, bounds, and
  author's variable names preserved; effects specifiers composed with the
  clause, including stated-`pure` on a polytype arrow surviving
  serialize → parse → declare with its contract intact); per-arm
  α-equivalence (same letter across arms unrelated; bounds compared
  structurally); every §7.2 rejection with its exact error code
  (including non-ground bounds, bare-intersection `forall`, **nested
  `forall`** in parameter/result/element/bound position, unused
  quantified variable, `declareType('forall')`); a `forall` clause on a
  function-literal annotation rejected; leading `<` still a parse error.
- **Solver**: each §4.7 row, including the S3 fallbacks (`unknown` when
  unbounded, the declared bound when bounded — never `never`), the
  variadic fold, the non-inferable-unknown absorption, the `never`-bound
  neutrality (`Concat([], [1])`-shape), the D8 provisional row, the
  bounded-identity verbatim row (kind + dimensions preserved), the
  **lifted-echo row** (D10 as re-ruled 2026-08-04: broadcastable echo at
  `list<integer>` — admission at the base, `T` bound to the ELEMENT, the
  wrap restoring the collection type; plus the never-peeled kinds and a
  MENTION result at rank 2), and the
  violated-declared-bound failure with its §8 message; `compose` with
  operand order reversed (order-independence witness); multi-callback meet
  of upper bounds and the disjoint-uppers failure; `broadcastable<T>`
  three-shape binding (§4.4); polytype-actual subsumption plus the §5
  negative cases (result-, effects-, and arity-shape violations after
  successful argument instantiation); the open-expected × polytype-actual
  decline.
- **Ground-invariant regression (critical):** a previously-inferred symbol
  narrowed against a generic parameter must end with a ground type and no
  throw (§4.2 rule 1), probed on both the in-loop and variadic narrow
  paths.
- **No-mutation (interning) pin (§5):** parse the same generic string
  twice, instantiate one at a call site, assert the cached polytype and
  the definition's stored signature are structurally unchanged.
- **Rebuild-invariant pin (§7.1):** run a generic-adjacent signature
  through the field-rebuild sites (`infer`/narrow, effects strip/stamp)
  and assert the `forall` clause (`typeParams`) AND the effects adjunct
  both survive every rebuild.
- **Cortex (D13):** a `forall` literal in a full-type-annotation position
  parses via the shared DSL and round-trips through the Cortex
  serializer; prefix-mode probes that the clause's dot terminates
  cleanly at annotation boundaries (including a bound with a signature
  type: `forall T: (real) -> real. …`); a polytype declaration is never
  serialized into the sugared definition form (full-literal spelling or
  a diagnosed error — assert no clause-stripped output exists on any
  path).
- **Assignment boundary (D7):** the dedicated rejection message on all
  THREE routes — `ce.assign`, the `Assign` operator, and the Cortex
  annotated-declaration route
  (`const f: forall T. (x: T) scope -> T = { x + n }` — the annotation
  parses via the shared DSL, then the literal body is rejected with the
  same D7 diagnostic, not a parse error); `effectsDeclared` recorded
  from `forall T, U. (T, U) random -> U` (the reachable spelling — a
  result-only `U` is rejected by §4.1's own reachability check).
- **Admission-gate parity (§4.5):** for each gate (deferred-overlap,
  broadcastable, missing-stripped, Spread, non-strict, inferable-unknown,
  non-inferable-unknown under D8), a generic signature and its ground
  instantiation accept/reject identical call sets.
- **Lazy-idle pin (§4.5):** a `lazy: true` operator declared with a
  generic signature performs no inference and no operand rejection —
  named test; closing the lazy carve-out must fail it deliberately.
- **Effects (§4.6):** an operator declared with `(T) any -> U` accepts
  pure, `random`, and `scope`-effect callbacks; declared with `(T) -> U`
  rejects effectful ones. Any migrated callback-taking operator probes
  the three operand classes (named library predicate, `function`-typed
  symbol, unknown-result lambda) in
  `collection-callback-signatures.test.ts`.
- **Direct idiom probes (suite-green is not sufficient):** every phase-3
  conversion adds direct probes alongside the corpus audit — named
  library operators as operands, parameter-annotated callbacks,
  `function`-typed symbols, constructor-supplied custom libraries.
- **Route parity**: every operator-level test probes `ce.function(…)`,
  raw-MathJSON `ce.box(…)`, *and* `ce.parse(…)` (standing pin: the
  box/parse-route failure class).
- **Overloads**: per-arm instantiation with the same letter in two arms;
  viable-arm ground join feeding `joinParamAt` (unknown operand,
  different bindings per arm); write-free check (definitions unchanged
  after resolution); the arm-aware `at`-handler rule (mixed
  indexed/non-indexed arms registers cleanly; `at` with no
  possibly-indexed arm errors; a bounded variable reads as its bound in
  that check); the **D11 generic-vs-ground tie** with the arms declared
  in both orders (same winner both ways).
- **Query APIs (D6 + D12 ruled, §5.1)**: pattern-side pins — the
  covariant row (`() -> list<integer>` matches
  `'forall T. () -> list<T>'` — same answer on both predicates), the
  identity-probe row (`(number) -> number` vs `'forall T. (T) -> T'`:
  **`true` for `matches`** (D12 existential) and **`false` for
  `couldMatch`** (D6 bound-reading, contravariant `any`) — the row that
  proves the two predicates diverge by design), and the
  repeated-variable row (`() -> tuple<integer, string>` vs
  `'forall T. () -> tuple<T, T>'`: `true` on both — for `matches` via
  the genuine join solution `T = integer | string`, for `couldMatch` via
  the wildcard); subject-side pins — a generic function symbol's
  polytype `couldMatch` `'function'` (and its bound's shape when
  bounded); `matches` and `couldMatch` pinned separately on every row.
- **Compile**: a call to a generic operator compiles (ground result); a
  generic user function itself declines cleanly.
- **Perf**: the §7.3 A/B criterion (canary first; benchmark-suite median
  within variance; `isPolymorphic` verified O(1) at dispatch; no `tsx`
  sizing for jest-gated numbers).
- **Blast radius**: full-suite snapshot count before/after each phase-3
  conversion, surfaced for review (standing policy; no `-u` on `@fixme`).
