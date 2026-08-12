# Type System Roadmap

Status: living document. Started 2026-08-06 from a design conversation on
sum types, monads/functors, and protocols; the empirical probes cited were
run that day against the parameterized-nominal-types working tree.
Updated 2026-08-08 after reviewing the system against Hindley–Milner and
assessing the cost of F-bounded bounds (§5) and constrained HKT (§6);
the `Map`-precision probes cited in §6 were run that day.
Updated 2026-08-11: the forward-ref-to-alias ruling (former §2.2) is
**closed** — Rule U (defined in §2.1) admits a type variable under a union
arm, so the three spellings it was about no longer diverge. Section 2
renumbered accordingly; re-probed that day.

Design docs for the shipped and in-flight tiers (each §1 item points to
its own):

- `docs/plans/2026-08-01-nominal-types-design.md` — nominal types,
  constructors, D1–D11 (D11 = compile erasure, amended by §3 below)
- `docs/plans/2026-08-06-parameterized-nominal-types-design.md` —
  parameterized nominals, variance, N1–N12 ruling record (N11 = Rule U,
  variables under a union arm)
- `docs/plans/2026-08-04-generic-type-aliases-design.md` — A1–A8
- `docs/plans/2026-08-01-type-variables-design.md` — type variables /
  generics v1 (surface syntax superseded by the `where`-clause design below)
- `docs/plans/2026-08-11-where-clause-type-constraints.md` — the trailing
  `where` clause that replaced the prefix `forall` quantifier
- `docs/plans/2026-08-04-generic-function-literals-design.md` — G1–G11,
  `function f<T>()` and generic literals
- `docs/plans/2026-08-01-function-polymorphism-design.md` and
  `docs/plans/2026-07-25-overload-resolution-design.md` — multi-clause
  functions, intersection arms, per-position join
- `docs/EFFECTS-MODEL.md` — effect labels on function types
- `docs/plans/2026-08-03-cortex-language-extensions-review.md` —
  language-level backlog (sum sugar would slot there)
- `src/epsil/docs/types.md` — Epsil-surface reference for the `type` /
  `type alias` statements, plus user-facing background on how the type
  system works (lattice, local generics, evidence-based inference)

### Known residuals — parameterized nominal types

All five phases landed (2026-08-06), Rule U (§2.1) included. Residuals this
roadmap builds on, still current as of 2026-08-11: `couldMatch` reports
different-argument applications as could-not-match (`bag<integer>` vs
`bag<string>` — conservative); a wrong-arity result type in a
constructor-function literal gets a misleading E1-sugar diagnostic;
re-declaring a type throws on the host API but replaces via Epsil
statement.

## 1. Where the type system is today

- **Structural type language**: unions, intersections, negations, tuples
  (named and positional), records, dictionaries, collections, function
  signatures with effect labels, numeric subtypes. Subtyping is lattice-based;
  `collection`/`indexed_collection` membership is conformance-by-handlers
  (engine-internal, closed to user types).
- **Nominal types** (`type point = …`) with minted constructors, opacity,
  `.` field access, `match` constructor patterns, smart-constructor
  functions (nominal-types design, D1–D10).
- **Generic type aliases** (`type alias Pair<T> = tuple<T, T>`): eager,
  transparent expansion; ground bounds; no self-reference (by eager-expansion
  necessity); no constructor (generic-type-aliases design, A1–A8).
- **Type variables v1**: rank-1 (quantifiers top-level only, never nested
  left of an arrow), spelled as a trailing `where` clause
  (`(T) -> T where T`) or as `function f<T>(…)`; kind-`*` only, ground
  bounds only — no F-bounded, no variable bounds (type-variables design;
  where-clause design; generic-function-literals design, G1–G11, for the
  literal and `function f<T>()` surface).
- **Function polymorphism**: multi-clause definitions, intersection-typed
  overload sets, per-position-join overload resolution
  (function-polymorphism and overload-resolution designs).
- **Effects on function types**: effect labels are part of the signature
  and participate in subtyping (`docs/EFFECTS-MODEL.md`).
- **Parameterized nominal types** (`type tree<out T> = …`): opaque
  applications, recursive bodies, declaration-site variance (`in`/`out`/
  `inout`; unannotated = out-verified), forward references via the inline
  `type name<T>` marker with defer-and-fulfil SCC verification, and a type
  variable under a single union arm (Rule U, §2.1)
  (parameterized-nominal-types design, N1–N12; N10 = ruling C; residuals
  above).
- **Compilation is type erasure** (D11, nominal-types design §4.6):
  nominal tags are static information, discharged before codegen;
  `meters(x)` compiles to `x`.

Positioning: deliberately at the "Elm/Go-generics" tier — parametric
polymorphism plus blessed concrete monad-shaped features (collections with
`Map`/`Filter`/`FlatMap`, absence via `Missing`/`NaN`/`Coalesce`, errors as
propagating values, effects via the effect system) rather than user-facing
monad/functor abstraction. The built-in propagation semantics removes most
everyday motivation for the abstraction tier; the roadmap below keeps the
door open without committing to it.

Relatedly, the system is deliberately **not Hindley–Milner**: the base
relation is a subtype lattice (join/meet), not type equality under
unification; generics are explicitly quantified and solved locally at each
call site by a bound-collection/join fold (D2: `(T, T) -> T where T` at
`(integer, real)` solves `T = real` where HM would fail to unify); and
inference of unannotated symbols is evidence-based and *revisable* (narrow
from argument use, widen from value assignment, non-monotone override per
D11, forward-ref re-derivation) rather than a once-and-final principal
type. Principal types and whole-program inference are traded away for
subtyping, unions, refinements, overloads, and open-world incremental
sessions — the right trade for a CAS. User-facing background lives in
`src/epsil/docs/types.md` ("How the type system works").

## 2. Sum types (near term)

A **sum type** expresses a choice: a value is exactly one of several
**variants**, each optionally carrying a payload. It is the choice half of
algebraic data types — the other half, the product, is the tuple/record
already in §1 — and is also called a **tagged union**, the tag being what
keeps two variants apart even when their payloads have the same shape.

The natural spelling is the sugar **proposed** in §2.3. It does not parse
today:

```epsil
type TrafficLight = red | green | yellow      // §2.3 sugar — not yet
```

Today each variant is its own nominal declaration and the union is named
with `type alias`. That union of nominal types already *is* a tagged sum
(§2.1) — this whole program runs as written:

```epsil
type red = nothing
type green = nothing
type yellow = nothing
type alias TrafficLight = red | green | yellow

function canGo(t: TrafficLight) -> boolean {
  match t {
    green() => true
    _       => false
  }
}

[canGo(green()), canGo(red())]
// ➔ [True, False]
```

`nothing` is the unit type, so a variant declared with it carries no
payload and its constructor is nullary. What distinguishes the three is
their nominal identity, not their contents — which is exactly what a tag
is.

Sums earn their keep on recursive data; an AST is the standard example.
Variants are read back with `match`, which selects on the variant and binds
its payload in one step:

```epsil
type node =                                   // §2.3 sugar — not yet
    lit(num: number)
  | plus(op1: node, op2: node)
  | times(op1: node, op2: node)

function ev(n: node) -> number {
  match n {
    lit(v)      => v
    plus(a, b)  => ev(a) + ev(b)
    times(a, b) => ev(a) * ev(b)
  }
}

ev(plus(lit(5), times(lit(2), lit(5))))
// ➔ 15
```

The variants are named `plus`/`times` rather than `Add`/`Multiply` on
purpose: a variant declared today is a free-floating global name, and
those two are builtin operators. `type Add = tuple<op1: node, op2: node>`
is accepted, but `Add(1, 2)` then still evaluates the builtin to `3` — the
constructor is silently unreachable. Scoping variants to their sum is one
of the things §2.3 buys.

Desugared, that AST is what runs today. A recursive variant names the sum
in its own payload through the forward-reference marker, since the sum
cannot be declared before the variants it lists:

```epsil
type lit = tuple<num: number>
type plus = tuple<op1: type expr, op2: type expr>   // fwd ref to the sum
type times = tuple<op1: type expr, op2: type expr>
type alias expr = lit | plus | times

function ev(n: expr) -> number { … }                // exactly as above
ev(plus(lit(5), times(lit(2), lit(5))))
// ➔ 15
```

Recursion here only works as of 2026-08-11: the declarations were accepted
and the first nested construction failed, because the alias reference
captured inside a variant's payload was never unfolded by the subtype
check. Fixed in `subtype.ts` and `reference.ts`, and pinned by
`test/compute-engine/sum-types.test.ts` — which is what a future resolver
or canonicalization change will trip over first.


When compiling to Javascript, sum types need to be represented by an object 
literal that includes a `_tag` property, unless the compiler can prove that 
the tags are not necessary, for example if the variants are non-overlapping 
JS types, i.e. `type T = integer | boolean | string | some(boolean)`.

### 2.1 Semantics by detection — largely done

A union of nominal types **is** a tagged sum: disjoint variants (nominal
opacity), per-variant constructors, `match` discrimination, no nesting
collapse. No dedicated syntax is required for the semantics — this is the
OCaml-polymorphic-variant / TS-discriminated-union "detected shape" model.
Working end to end, including the recursive generic case with the sum's own
name at recursive positions — construction, field access and `match`
(declared 2026-08-06, actually usable 2026-08-11, see below):

```epsil
type leaf = nothing
type node<T> = tuple<value: T, children: list<type tree<T>>>   // fwd ref, defers
type alias tree<T> = leaf | node<T>                            // fulfilment: OK
```

Mutual recursion (JSON's `jarr`/`jobj`) likewise works via `type` markers,
order-independent. The forward-ref machinery covers both the ordering and
the naming problem — no inlined-union repetition is needed.

**Rule U** — the rule that makes a union of variants declarable in the
first place. Ruled 2026-08-06 as N11 of the parameterized-nominal-types
design (which owns the full statement and its rationale); the sum track
depends on it, so the operative content:

- A type variable may stand **under a union arm**, in any rank-1 polytype.
  `type opt<T> = T | missing` is the flagship — before the rule it was
  undeclarable, rejected with `unsupported-variable-position`.
- **At most one arm may mention variables.** `type both<T, U> = T | U` is
  rejected: nothing at a call site says which arm a value took, so neither
  variable could be solved.
- At a call, an actual accepted by a **ground** arm binds the variables to
  `never` — the bottom of the family (`opt(Missing)` types `opt<never>`);
  otherwise the single open arm solves and refutes as usual
  (`opt(3)` types `opt<finite_integer>`). Contravariant union positions
  contribute no bound in v1.
- A variable in an **intersection** or a **negation** is still rejected;
  the intersection message steers to the replacement spelling, a bound
  (`where T: number`).

Consequence for sums: all three spellings of a recursive generic sum are
now **declarable** — the union inlined directly in a parameterized nominal
body; a forward reference fulfilled by a nominal; and one fulfilled by a
generic alias, as above. They do **not** mean the same thing, and only the
last is a sum (re-probed 2026-08-11): `type alias tree<T> = leaf | node<T>`
is transparent, so `node<integer> <: tree<integer>` and
`leaf <: tree<integer>` both hold, while `type tree<T> = leaf | node<T>`
declares a *new opaque nominal* whose definition happens to be a union —
neither member is a member of it. The former §2.2 ruling read the three as
interchangeable, which they never were; the distinction is pinned by
`test/compute-engine/sum-types.test.ts`.

**Sums did not actually run until 2026-08-11.** Everything above declared,
and every use of a sum through a named alias failed — found while
re-probing this section, fixed the same day. Three defects had to line up,
all in the unfolding of a structural alias standing on the RIGHT of a
subtype check:

- `isSubtype` short-circuited to `sameTypeApplication` whenever BOTH sides
  were references, so a reference lhs never reached the rhs unfold at all:
  `lit <: solo` was false while `solo <: lit` was true, for
  `type alias solo = lit`. Now the name check is asked first and the unfold
  runs when it fails.
- `applyTypeReference` **snapshotted** the `alias` flag while delegating
  `def` to the declaration record. A forward reference is created by use,
  when the record is still the nominal-by-default placeholder, so an
  application captured inside a variant's payload kept `alias: false` after
  a `type alias` fulfilled it — and an unfold gated on that flag never
  fired. `alias` now delegates, like `def` and for the same reason.
- The unfold compared against the alias's OPEN body without substituting
  the application's arguments, so `node<integer> <: tree<integer>` asked
  `node<integer> <: leaf | node<T>` and failed on the variable.

The guard on that unfold is keyed on the **pair** (record + lhs identity),
not the record: an equirecursive alias reaches itself through a
constructor, so `list<list<number>> <: json` must unfold `json` once per
level, each time against a smaller lhs. A record-keyed guard cuts that off
and reports a non-subtype — it broke every recursive-JSON test when tried.

Two adjacent defects fell out of the same root and were fixed with it. A
**payload-free variant** had no callable constructor: `type leaf = nothing`
minted `(nothing) -> leaf`, and `nothing`'s sole inhabitant elides as an
operand, so `leaf()` was a missing argument and `leaf(Nothing)` collapsed
to the same call — it is nullary now, like an empty tuple body. And **Rule
U's ground-arm binding did not fire through an alias**: the rule lives in
the solver's union case, which a parameter still spelled as a
forward-reference alias never reached, so `plus(lit(5), lit(2))` solved to
`plus<unknown>` (rejected by an `expr<number>` parameter) instead of
`plus<never>`. The solver's pattern walk now unfolds a structural alias,
sharing one instantiating-unfold helper with `subtype.ts` so the two cannot
drift.

**Untagged unions** are the right choice when variants are pairwise
runtime-disjoint (the payload is its own tag). The fully untagged,
self-recursive, transparent JSON alias works today, with structural
membership (`list<list<number>> <: json`), the self-forward-ref staying
equirecursive/lazy:

```epsil
type alias json = missing | boolean | number | string
                | list<type json> | dictionary<type json>
```

Tags are a **per-variant** decision, earned when: variants overlap under
instantiation (`result<T, T>`); self-overlap under nesting
(`maybe<maybe<T>>`); constructor-based `match` and cheap exhaustiveness are
wanted; evolution safety (an added structurally-overlapping variant merges
silently instead of erroring); or a variant collides with ambient
semantics — notably `missing` as JSON null rides the absence machinery
(`IsMissing`, `Coalesce`, `Missing + 1 → NaN`) and loses "present null" vs
"absent key"; tagging exactly that variant (`type jnull = nothing`) fixes it.

### 2.2 Exhaustiveness checking

Per-scrutinee exhaustiveness over a detected sum is sound and closed: the
union lists its members. Fires at canonicalization when the scrutinee's
static type is known; degrades to the existing runtime no-match error
value otherwise (consistent with there being no separate static pass).
For untagged unions, arms dispatch on runtime type tests and exhaustiveness
becomes type-coverage reasoning — feasible, heavier machinery, lower
priority.

### 2.3 Sum-declaration sugar (mid term, modest priority)

`type json = jnull | jbool(boolean) | … | jarr(list<json>)` desugaring to
the N variant declarations + 1 alias. With detection + forward refs
already covering expressiveness, sugar buys: one statement instead of N+1;
a variant set closed *by declaration*; the
sum's name usable in variant payloads without `type` markers; variants
scoped to the sum instead of N free-floating global names (builtin-name
collision hazard); one-edit variant addition. Cosmetic-adjacent —
motivated by multi-variant recursive sums, not by `maybe`.

## 3. Compiling sums: amend D11 (blocks on sum adoption)

**Status: IMPLEMENTED** for sugar-declared sums (§2.3) on the **JavaScript**
target — `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` Part B,
`test/compute-engine/sum-compile.test.ts`. The reframing below is the shipped
rule. Fail-closed scope, all deliberate in v1: hand-assembled unions of
nominals (no sum identity to key a policy on) keep erased constructors and a
`match` that fails closed; the Python / GPU / interval targets decline both
constructor patterns and tagged emissions; and a compiled unit whose *result*
type is a tagged sum declines rather than leak `{_tag}` objects across the
engine⇄compiled boundary (sum-typed *parameters* are supported — an in-unit
recursive `ev(n: node)` needs them).

D11's erasure argument is a **product-type** argument: the tag decides
nothing at runtime once the checker discharges opacity. **For sums the tag
is runtime data** — `match` branches on it. When sums are adopted:

- Reify tags in compiled code (`{tag, payload}` / `['some', x]`); lower
  `match` to a switch on the tag.
- Keep erasure as an *optimization* where variants are runtime-disjoint
  anyway (dispatch on `typeof`); niche optimizations later, if ever.
- Interpreter and serialization need nothing — boxed values already carry
  their type and round-trip; compilation is the only tier where the tag
  currently dies.

Suggested reframing: **"the tag is erased iff it is statically
discharged"** — one criterion covering products (erase) and sums (reify).

Protocol dispatch is this criterion's second consumer (Appendix A,
"Dispatching"): a dynamically dispatched protocol call needs the receiver's
tag at runtime exactly as `match` needs a sum's; a statically resolved call
discharges it and erases.

## 4. Protocols and conformance

**Status: SHIPPED 2026-08-12** (all five phases — declarations,
conformance, implementations, dispatch, `is`-slot constraints, properties,
conditional conformance). Surface spec = Appendix A below; implementation
architecture and ruling record (P1–P46) =
`docs/plans/2026-08-12-protocols-design.md`. The `Iterable`/`Indexable`
bridge below is the remaining unshipped piece of this section (needs its
own requirement-table design doc, §7 item 6(h)).

Two distinct gaps stand between today and a user-facing `mappable`:

- **Constraint**: "a type that supports map" as a bound. Bounds today are
  ground types only (§5 lifts the ground restriction; the protocol-as-bound
  role is a further step).
- **Dispatch**: parametricity means a single generic `map<F, T, U>` body
  cannot iterate an arbitrary opaque container; per-type implementations
  plus selection machinery (conformance declarations, dictionary-passing
  or vtables) *are* the protocol feature — the signature is its shadow.

`collection` is the prototype: already a protocol in disguise (membership
= conformance-by-handlers), just closed to user types. **Ruled 2026-08-12:
`collection` stays purely a type.** An earlier draft followed the Swift
precedent (`Collection` protocol + `any Collection` existential) and made
the one name serve both roles; that dual role is withdrawn — the "protocol
cannot be used where a type would be used" rule (Appendix A) now holds
without exception. Instead, the protocol role goes to **two
engine-declared protocols** mirroring the two internal handler tiers:

- **`Iterable`** — the `collection` tier (iteration, size);
- **`Indexable`** — the `indexed_collection` tier (positional access).

The bridge runs in both directions. Downward, the built-in lattice types
conform out of the box: the engine declares `collection is Iterable` and
`indexed_collection is Iterable & Indexable`, implemented internally by
the existing handler tables, so every collection value dispatches
`Iterable` members. Upward, conformance **grants lattice membership** — a
nominal type conforming to `Iterable` becomes a member of the `collection`
existential, and one conforming to `Iterable & Indexable` a member of
`indexed_collection` — which is how `Map`, `Filter`, etc. come to accept
user types. The imperative per-call `type:` handler on `Map` (~50 lines of
shape propagation in `library/collections.ts`) is exactly the computation
a bound + HKT signature `<F: collection, T, U>(F<T>, (T) -> U) -> F<U>`
would express declaratively — the compiler written because the type
language couldn't say it. First deliverable on this track: user
conformance (a nominal type conforming to `Iterable` and supplying its
implementations from Epsil).

## 5. F-bounded and variable-referencing bounds (mid term, unblocked)

Assessed 2026-08-08: `where T: comparable<T>` and cross-variable bounds
(`where T: list<U>`) fit the current machinery as an **incremental
extension** — no new theory. The reason is the solver's shape: bounds do
not participate in the sweeps of `solveTypeArguments`; they enter only at
the end (joined into the upper set, and as the S3 default). Since S1–S3
solve **all** variables before any satisfiability check runs, a non-ground
bound can be checked by substituting the complete binding map into it and
then running the ordinary ground subtype check — the ground-type firewall
(`assertGroundInputs`) is preserved because substitution happens before
the lattice is consulted. Work list:

- Lift the gate in `validateDeclaredType` that rejects variable-referencing
  bounds.
- Add the substitute-into-bound step in the satisfiability phase
  (`uppersOf`).
- S3: an unconstrained variable can no longer default to its bound (not
  ground) — default to `unknown`, or extend the result-reachability
  validation to require such variables be solvable from arguments.
- Teach the `Poly <: Poly` α-equivalence comparison to compare bounds up
  to renaming.

**No syntax decision is outstanding.** The `where`-clause design settled
clause ordering with the *seed all names, then parse all bounds* rule, so a
bound may reference a variable declared later in the same clause —
`(T) -> U where T: list<U>, U` is well-formed as written. Lifting the
`validateDeclaredType` gate is the whole surface change.

Recursion in the bound (`comparable<T>` where the solution itself involves
`comparable`) is already covered by nominal opacity plus the
`beginUnfold`/`endUnfold` cycle guards. Trigger: comparator-style
signatures (`Sort` with a custom comparator) or the §4 protocols track
needing a self-referential bound.

## 6. Higher-kinded types and rank-2 (long term, gated)

For genuine Functor/Monad abstraction, in dependency order:

1. **Higher-kinded type parameters** — `F` ranging over type constructors
   (`(F<A>, (A) -> B) -> F<B> where F, A, B`). Explicitly out of scope
   in the parameterized-nominal design; all current quantifiers are
   kind-`*`. Without HKT, protocols still deliver conformance and
   existentials, but `Map`-like signatures stay constructor-erased
   (`-> indexed_collection`) — HKT and protocols pay off together.
2. **Rank-2 quantification**, if protocols become first-class
   dictionaries: a `mappable` witness is
   `record<map: ((A) -> B where A, B), …>` and any function taking one is
   rank-2. (Rank = how deeply a quantifier nests left of arrows = who
   instantiates; orthogonal to kind. Also enables
   scope-enforcement types à la `runST`/`withFile`, where the nested
   quantifier makes resource escape a type error.) Inference: rank-2 is
   barely decidable, rank-3+ undecidable — annotation-required in
   practice, which fits Epsil's explicit-annotation posture.

**Syntax ruling reserved for rank-2** (where-clause design, W1): a `where`
clause in any **nested** position must be **parenthesized** —
`record<map: ((A) -> B where A, B), other: number>`. Unparenthesized, the
clause's `,` separator collides with the record field separator
(`other: number` is simultaneously a well-formed `<var_decl>` and a
well-formed field), so unparenthesized nested `where` is a **syntax error**,
never a silent reinterpretation. Same failure mode and same resolution as the
`&`-precedence rule for overload arms: mandatory parens, loud failure. (The
prefix `forall A, B.` self-delimited via its `.`; trailing `where` does not.)
Nested quantification is rejected outright today, so this is reserved, not
implemented.

**General** HKT breaks four load-bearing assumptions at once (assessed
2026-08-08): no AST node for "variable applied to arguments" and no
uniform head+args decomposition (built-in collections are distinct AST
kinds — `list` with dimensions, named-or-positional `tuple`,
`broadcastable`); matching a pattern `F<A>` against `list<integer>` is
higher-order unification, which `instantiate.ts` §4.3 explicitly declines;
constructors do not live in the subtype lattice, so the S1–S3 join/meet
fold cannot solve a constructor variable; and the variance of an unknown
constructor is unknowable, requiring variance-kinded quantification. That
is a re-architecture of `types.ts`/`instantiate.ts`/`subtype.ts`/
`variance.ts`, not an extension.

### 6.1 Constrained HKT — collections only (assessed 2026-08-08)

The cost-benefit flips if `F` is restricted to a **closed universe of
collection constructors**. Two findings sharpen the actual gap first:

- Kind-preservation with an *unchanged* element is already expressible
  today: `(T) -> T where T: indexed_collection` covers the
  `Sort`/`Reverse`/`Filter`/`Take` family with no new machinery.
- Builtins already deliver the precision imperatively, per-head fallback
  included — probed 2026-08-08: `Map` over a list types `vector<3>`
  (constructor *and* dimensions preserved), over a set `set<number>`, over
  a range `indexed_collection<number>` (correct: the image of a range is
  not a range).

So the gap is precisely **same container, different element, for
user-declared functions** — the `Map`-shaped signature family, today
constructor-erased to `-> indexed_collection`.

Under the collections-only restriction each §6 blocker shrinks: the closed
head set needs only a decompose/reapply pair (`collection-utils.ts` is
most of the decompose half); matching `F<A>` stays first-order (pure
decomposition, no type-level lambdas); if every constructor in the
universe is element-covariant the kind implies out-variance (no
`variance.ts` surface); and solving is rigid — all occurrences of `F`
must agree on the same head, a syntactic check beside S1–S3, not a new
join theory (do **not** define head-joins via
`list <: indexed_collection <: collection` — joining heads erases the
preservation promise that is the point).

**Cheaper shape than constructor variables**: two built-in type operators
on kind-`*` variables — `elem<T>` and `rebind<T, B>`:

```
Map: (T, (elem<T>) -> B) -> rebind<T, B> where T: collection, B
```

No kind system, no change to what a type variable is, and the same
solve-then-reduce fit as §5: S1–S3 complete first, then `elem`/`rebind`
reduce on ground bindings before the lattice is consulted. (Rust
GATs-lite / C++ allocator-rebind precedent.)

**Landmine (either shape)**: the closed universe is not uniform.
`rebind<range, string>` is meaningless; dimensioned lists should keep
dimensions under `Map` but not under a user `Filter`; dictionaries raise
"what is the element". Scala 2.8's `CanBuildFrom` is the cautionary tale —
the same per-head problem solved with implicit resolution became the
language's most notorious complexity sink (redesigned away in 2.13). The
builtin type handlers already encode the right per-head answers, so the
spec work is transcribing them into a per-head rebind table with a defined
fallback — real spec surface, and where this "small" feature would grow.

Scoping option: make `elem`/`rebind` usable in declarations only at
first — ships the `Map`-signature win while deferring type operators in
user-facing type syntax.

Neither general HKT nor rank-2 is committed. The trigger would be demand
for user-defined container/functor abstractions that the
blessed-concrete-monads posture (§1) cannot absorb — concretely, Epsil
users declaring their own collection-generic functions once the §4
conformance track lands. When it fires, §6.1 is the likely first step,
with three rulings needed in order (see §7).

## 7. Open rulings and questions

1. Sum sugar (§2.3): adopt a desugaring form? Variants scoped to the sum?
2. `match` over untagged unions (§2.2): type-test patterns +
   type-coverage exhaustiveness — wanted?
3. D11 amendment (§3): land with (or before) constructing/reading values
   of parameterized nominal types in compiled code.
4. JSON-null vs absence (§2.1): recommend the `jnull`-tagged hybrid in
   docs/examples, or accept the conflation?
5. Constrained HKT (§6.1), when the trigger fires — three rulings in
   order: (a) `elem`/`rebind` operators vs constructor variables (lean
   rebind — the smaller theory); (b) the per-head rebind/fallback table,
   seeded from what the builtin type handlers already do; (c) whether the
   operators are user-visible type syntax or declarations-only at first.
6. Protocol rulings introduced by the 2026-08-12 revision of Appendix A —
   **ratified 2026-08-12 and shipped the same day** (record: P1–P46 in
   `docs/plans/2026-08-12-protocols-design.md`); only (h) remains open:
   (a) dispatch on the first `Self` argument, with `Self` bound
   statically from that argument (the join-across-arguments rule is
   withdrawn); (b) property assignment as rebinding sugar, non-variable
   LHS rejected in v1; (c) pending-conformance lifecycle — end-of-batch
   warning, not error; (d) overlap predicate = inhabited meet, with
   incomparable overlap rejected; (e) statement-replace on Epsil re-run
   vs host-API throw for protocol/implementation re-declaration; (f)
   amending nominal-types D16 to admit `person.(Protocol.name)`; (g)
   whether engine-global conformance needs a host-side trust control
   (registry freeze / built-in-target authorization); (h) the built-in
   `Iterable`/`Indexable` protocols (§4, ruled 2026-08-12: `collection`
   stays a pure type, no dual-role names) — confirm the two-protocol
   split and names, and the membership-granting conformance rule,
   when the requirement tables get their design doc.


## Appendix A: Protocol Syntax

> Revised 2026-08-12 after a dual-reviewer spec review. Decisions the
> revision introduces are marked **(ruling)** where they appear and are
> collected in §7 item 6 for ratification; everything else is the original
> intent, tightened.

A protocol is a set of functions and properties that a type must implement
in order to be said to **conform** to the protocol.

```epsil
protocol Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">"
}
```

### Grammar

```
protocol_decl    ::= "protocol" IDENT "{" protocol_member* "}"
protocol_member  ::= "function" IDENT "(" param_list ")" "->" type
                   | ("readonly" | "readwrite") IDENT ":" type

conformance_decl ::= "type" conf_target "is" protocol_names where_clause?
                     impl_block?                       // the clause BINDS the
                                                       // head's variables
conf_target      ::= <named ground type>               // see “Conformance targets”
                   | IDENT "<" IDENT ("," IDENT)* ">"  // conditional head, see
                                                       // “Conditional Conformance”
                                                       // (a bound belongs in the
                                                       // clause, never the head)
protocol_names   ::= IDENT ("&" IDENT)*                // protocol NAMES — not a
                                                       // type intersection

impl_block       ::= "{" impl_member* "}"
impl_member      ::= "function" IDENT "(" param_list ")" ("->" type)? block
                   | ("get" | "set") IDENT "(" param_list ")" ("->" type)? block

combined_decl    ::= "type" IDENT "=" type "is" protocol_names impl_block?
```

- Implementation members always carry the `function` (or `get`/`set`)
  keyword.
- The members of a protocol start with one of three keywords: `function`,
  `readonly`, or `readwrite`. A bare `value: string` member emits
  `protocol-member-keyword-missing` ("Did you mean `readonly value` or
  `readwrite value`?").
- Protocol members declare signatures only — no bodies.

Multiple protocols can include functions with the same name, with the same
or different signatures:

```epsil
protocol Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">"
}
protocol Comparator {
  function compare(self: Self, other: Self) -> -1 | 0 | 1
  // ok: does not conflict with Comparable's compare — see “Dispatching”
}
```

### `Self`

The type `Self` used in protocol member signatures refers to the type for
which the specific implementation of the protocol is defined. The first
argument of every protocol function must be of type `Self`; if its type is
omitted, `Self` is inferred. A first argument explicitly typed as anything
other than `Self` emits `protocol-self-required`:

```epsil
protocol Comparable {
  function compare(self, other: Self) -> "<" | "=" | ">"
  // Same as `function compare(self: Self, other: Self) -> "<" | "=" | ">"`
}

protocol Comparable {
  function compare(self: list, other: Self) -> "<" | "=" | ">"
  // -> protocol-self-required: the first argument of a protocol function
  //    must be of type Self
}
```

### Properties

A protocol can also define readwrite or readonly properties, prefixed with
`readwrite` or `readonly` accordingly.

Properties are mapped to getter and setter functions, which must be
implemented by the conforming type. An appropriate mangling scheme is used —
for example `__get__hash` for the `hash` property getter — but it is an
implementation detail, not part of the public surface:

```epsil
protocol Hashable {
  readonly hash: string
  // Conceptually the getter requirement:
  // function __get__hash(self: Self) -> string
}

protocol Nameable {
  readwrite name: string
}

protocol Computeable {
  value: string
  // -> protocol-member-keyword-missing: "Did you mean `readonly value` or
  //    `readwrite value`?"
}
```

Note that a property can have a `function` type, but there are important
differences between a `function` member and a property member with a
`function` type: a function member participates in dispatch, in the
unqualified global name, and in `Protocol.name` qualification; a
function-typed property is just a getter that returns a function value —
`x.compare` evaluates to a function which you then call yourself, the
returned function receives no implicit `Self`, and different instances of
the same type may return different functions (which is precisely the
legitimate use case: per-instance behavior, e.g. a sort order carried by a
collection instance).

A protocol cannot define static functions, constructors or static
properties.

### Semantic Protocols / Markers

A protocol declaration doesn't have to include any requirements. You can
use a protocol to describe semantic requirements — that is, requirements
about how values of those types behave and about operations that they
support:

```epsil
protocol Copyable {}
```

A semantic protocol's conformance is complete at declaration — the
implementation-completeness check below does not apply to it.

### Scope and lifecycle

Protocols are not scoped: they are global for the Compute Engine instance,
like types (global-type-registry design). When reading an Epsil file, the
protocol declarations can be hoisted (or processed in a first pass).
Protocols declared inside a local scope emit `protocol-scope-invalid`.

**Statement re-run replaces (ruling).** Re-executing a `protocol`
declaration or an implementation block via an Epsil statement replaces the
previous one, matching the convention for `type` statements (nominal-types
D5/D13: notebook hosts re-execute whole scopes). Replacing a protocol whose
requirement set changed revalidates every registered implementation of it;
implementations left incomplete emit `protocol-implementation-missing`. On
the host API, re-declaration throws — the same host/Epsil asymmetry already
recorded for types under "Known residuals".

**Registry changes are state events (ruling).** Declaring or replacing a
protocol, conformance, or implementation registers a state event on the
engine's invalidation machinery, so cached static-dispatch resolutions (see
"Dispatching") are invalidated rather than left stale.

### Conformance

The `is` keyword is used to declare the conformance of a type, optionally
forward — ahead of its implementation. For example, for a built-in type:

```epsil
type string is Hashable
```

Conformance can be added, but never removed (monotonicity). Statement
re-run *replacement* of an implementation is allowed; *removal* is not.

Conformance to multiple protocols can be declared using `&` — a list of
protocol names, an *AND*. (This `&` joins protocol names; it is not the
type-intersection operator — protocol names are not types.)

```epsil
type string is Hashable & Comparable
```

Note this is equivalent to:

```epsil
type string is Hashable
type string is Comparable
```

When multiple protocols are declared at once, an implementation block
cannot be attached — provide a separate implementation per protocol:

```epsil
type string is Hashable & Comparable {
  // -> protocol-implementation-split: provide a separate implementation
  //    block for each protocol
  function hash(...) ...
}
```

Re-declaring a conformance is legal and a no-op, although a warning
diagnostic may be emitted when encountered.

#### Conformance targets

The conforming type must be **named and ground** — one of (ruling,
replacing the undefined term "primitive type" of the earlier draft):

- a built-in type name, or a ground application of one: `string`, `number`,
  `list<integer>`, `dictionary<string>`;
- a nominal type, or a ground application of a parameterized nominal:
  `Point`, `tree<integer>`.

Rejected, with `protocol-conformance-target-invalid`:

- unions, intersections, negations:
  `type (integer | string) is Comparable`;
- anonymous structural types (tuple or record literals, function
  signatures) — declare a nominal wrapper instead;
- a bare type variable (`type T is Comparable`) — except as the head
  pattern of a conditional conformance (below);
- `type alias` names — aliases are structural and transparent. The
  diagnostic steers: "Use a nominal type (`type Pt`) to conform to protocol
  `Comparable`. Structural types (`type alias`) cannot conform to
  protocols."

To declare a conformance, the type has to be known:

```epsil
type FooBar is Comparable
// -> protocol-target-unknown: the type `FooBar` is unknown
```

Conformance can also be declared for a user-defined **nominal** type at the
same time as the definition of the type:

```epsil
type Point = tuple<number, number> is Comparable

// or:

type Point = tuple<number, number>
type Point is Comparable
```

#### Lattice inheritance and overlap

For types in the type lattice, like `number`, if a type is
protocol-conforming its subtypes are as well: `integer` is `Comparable`
too, witnessed by the `number` implementation. An inherited implementation
satisfies the completeness requirement — a subtype needs no implementation
of its own.

A subtype may nevertheless declare its own, **more specific**
implementation (see the `number`/`integer` example under "Dispatching") —
that is not a duplicate, because the two targets are comparable (one is a
subtype of the other).

**Overlap rule (ruling).** Two conformance targets *overlap* when their
meet in the lattice is not `never`. Because the lattice is not a chain, a
new conformance whose target overlaps an existing conforming type for the
same protocol *without being comparable to it* (neither is a subtype of the
other) emits `protocol-conformance-overlap` — dispatch for values in the
intersection would be ambiguous. Bounded refinements are the realistic
case:

```epsil
type integer<1..10> is Comparable { ... }
type integer<5..20> is Comparable { ... }
// -> protocol-conformance-overlap: `integer<5..20>` overlaps
//    `integer<1..10>` (meet `integer<5..10>`) and neither contains the
//    other. Conform the common supertype (`integer`) or disjoint
//    refinements instead.
```

(Implementation note: the predicate is the lattice meet — not `couldMatch`,
which "Known residuals" records as conservative on different-argument
applications.)

#### Completeness — pending conformance

A forward-declared conformance without an implementation is **pending**.
Pending state persists across `ce.parse()` batches, so the notebook pattern
— declare in one cell, implement in the next — works (ruling; the earlier
draft made this an end-of-batch hard error, which would have broken the
incremental-session posture of §1):

- at the end of each `ce.parse()` batch, each still-pending conformance
  emits a `protocol-implementation-pending` **warning**;
- dispatching a protocol member through a pending conformance produces the
  ordinary runtime error value (`protocol-implementation-missing`);
- a later batch may fulfil the pending conformance with an implementation
  block, clearing the warning.

### Protocol Implementation

A protocol implementation defines the implementation of the functions and
properties of a protocol for a given type. A protocol implementation
statement is also a conformance declaration.

The name of a function and its first argument are used to dispatch a call
to the correct implementation (see "Dispatching"). Implementations are
provided in a braced block after the conformance declaration; if a type
conforms to multiple protocols, it has multiple implementation blocks:

```epsil
type string is Comparable {
  // Provide an implementation of the `compare` function for `string`
  function compare(self: string, other: string) -> "<" | "=" | ">" {
    if (self < other) { "<" }
    else if (self > other) { ">" }
    else { "=" }
  }
}
```

In an implementation, the type of an argument can be written either as
`Self` or as the conforming type's own name (`string` here): in this
context they are synonyms.

If at the end of a protocol implementation block the protocol is only
partially implemented, or the block includes members that are not part of
the protocol, diagnostics are emitted:

```epsil
type boolean is Comparable {
  function cmpare(self, other: Self) -> "<" | "=" | ">" { ... }
  // -> protocol-member-unknown: `cmpare` is not a member of the
  //    `Comparable` protocol. Did you mean `compare`?
  // -> protocol-implementation-missing: the `Comparable` protocol expects
  //    a definition of `compare`
}
```

If a conformance implementation is provided more than once **within one
compilation unit** (a single `.epsil` file / one `ce.parse()` batch), the
second is a diagnostic error. Across batches — the notebook pattern of
re-executing a cell — the re-run **replaces** (see "Scope and lifecycle").
The two cases are distinguished by the batch: same batch = duplicate,
later batch = re-run.

```epsil
type boolean is Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">" { ... }
}

type boolean is Comparable
// -> ok, no-op re-declaration

type boolean is Comparable {
  // -> protocol-implementation-duplicate: the type `boolean` already has
  //    an implementation of the `Comparable` protocol in this batch.
  //    (In a LATER batch this same statement replaces instead —
  //    validation first: an invalid block leaves the previous valid
  //    implementation intact. The HOST route always throws on duplicates.)
  function compare(self: Self, other: Self) -> "<" | "=" | ">" { ... }
}
```

#### Signature matching (ruling)

An implementation member satisfies a protocol requirement when, after
substituting the conforming type for `Self`, its signature is a **subtype**
of the requirement's: parameter types may widen (contravariant), the result
type may narrow (covariant), and the effect must be equal or purer —
effect labels are part of every signature and participate in subtyping
(`docs/EFFECTS-MODEL.md`). Parameter names are not significant, except that
the first parameter is the dispatch position.

v1 restrictions: same arity (no optional or variadic parameters in protocol
members), no generic protocol members, and exactly one implementation
function per requirement (no overload arms). A mismatch emits
`protocol-signature-mismatch`:

```epsil
type string is Comparable {
  function compare(self: string, other: number) -> "<" | "=" | ">" {
    // -> protocol-signature-mismatch: the signature of `compare` does not
    //    match `Comparable.compare` at `Self = string` (argument 2 is
    //    `number`; expected `string` or a supertype)
    if (self.length < other) { "<" }
    else if (self.length > other) { ">" }
    else { "=" }
  }
}
```

#### Property implementations

Protocol properties are implemented by functions prefixed with the `get`
and `set` keywords:

```epsil
type string is Hashable {
  get hash(self: Self) -> string { ... }
}

protocol Nameable {
  readwrite name: string
}

type Person is Nameable {
  get name(self: Self) -> string { ... }
  set name(self: Self, value: string) -> string { ... }
}
```

The signature of the `get` handler of a property has a single argument, of
type `Self`, and a result type that matches the type of the property.

The signature of the `set` handler of a property has two arguments, the
first of type `Self` and the second of a type that matches the type of the
property. The result of the `set` handler is conventionally the type of the
property, and the return value is the value the property was set to (which
may be different than the input value, but which should be identical to
invoking the `get` handler).

If the signatures of the `get` or `set` handlers are invalid,
`protocol-signature-mismatch` is emitted. If a `set` handler is provided
for a `readonly` property, `protocol-property-readonly-set` is emitted. If
a `get` handler is missing for a property,
`protocol-implementation-missing` is emitted.

To provide an implementation of a semantic protocol, the conformance
declaration is sufficient; an empty block is also accepted:

```epsil
type MyType is Copyable
type MyType is Copyable {}   // equivalent
```

### Conditional Conformance

A parameterized type may conform only when its type arguments satisfy
constraints. The head names the target's variables; the trailing `where`
clause **binds** them — the same single-binding-site rule as function
declarations (see "Protocol Constraints") — and the constraint may be
elided for an unconstrained variable (`where T`):

```epsil
type list<T> is Comparable where T is Comparable {
  // Lexicographic comparison — defined only when the elements compare
  function compare(self: list<T>, other: list<T>) -> "<" | "=" | ">" { ... }
}
```

Rules (rulings):

- The conformance applies to exactly those instantiations whose arguments
  satisfy the constraints; other instantiations do not conform.
- At most **one** conditional conformance per (head, protocol) pair in v1,
  and a conditional conformance excludes an unconditional one on the same
  head for the same protocol (`protocol-conformance-overlap`) — no
  specialization or most-specific selection among conditional witnesses
  yet.
- Parameterized *protocols* (`protocol Mappable<...>`) are **not** in v1 —
  protocols that abstract over their element type belong to the §6 HKT
  track. (An earlier draft's example here implied them; withdrawn.)
- Every variable of the head must be bound by the clause, and every variable
  of the clause must occur in the head. A bound written **in the head**
  (`type list<T: number> is P`) is a parse error steering to the clause:
  the clause is the single binding site, so it is where a bound belongs.
- The clause's variables are in scope for the implementation block's member
  signatures, and `Self` is the head pattern — `function compare(self: Self,
  …)` and `function compare(self: list<T>, …)` are the same declaration.
  Requirement matching (`protocol-signature-mismatch`) is checked at the
  *widest* instantiation, i.e. with each variable read as its bound: a
  signature that holds there holds for every instantiation.

### Protocol Constraints

A function signature may declare that some of its arguments must conform to
protocols, using the `is` slot of the `where` clause
(`docs/plans/2026-08-11-where-clause-type-constraints.md` reserves the slot
and pins its parse):

```epsil
function bar(x: T) -> boolean where T: collection { ...}

function baz(x: T) -> boolean where T: collection is Hashable { ...}

// Also acceptable
function baz(x: T) -> boolean where T: collection, T is Hashable { ...}
```

Grammar and attachment:

- **No `<T>` binder together with a `where` clause.** The where-clause spec
  rules the two binder sites alternatives — one binding site per
  declaration — so `function bar<T>(x: T) -> boolean where T: collection`
  is rejected. (An earlier draft of this appendix wrote its examples that
  way; corrected.)
- `T: collection is Hashable` should be read as
  `T: collection, T is Hashable`: both the bound (`: collection`) and the
  conformance list (`is Hashable`) attach to the **variable** `T`, never to
  the bound type. The single-declaration spelling is canonical; the comma
  spelling normalizes to it on serialization (ruling).
- A type may be required to conform to multiple protocols (not an *OR*, an
  *AND*), separated by `&`: `where T is Comparable & Hashable`. After
  `is`, only protocol names may appear — this `&` is a protocol-list
  separator, not type intersection, so the existing
  no-variables-in-intersections rule is not implicated (ruling).
- Constraints are checked like §5 bounds (ruling): after S1–S3 have solved
  all variables, the solved binding is substituted and the conformance
  registry is consulted. An unsatisfied constraint emits
  `protocol-constraint-unsatisfied`, naming the protocol and the solved
  type. No *implementation* is chosen at solve time — calls in the body
  dispatch dynamically (see "Dispatching").

```epsil
function sort(xs: list<T>) -> list<T> where T is Comparable & Hashable {
  // A protocol function can be called directly. The implementation is
  // dispatched on the runtime type of its first argument:
  if (compare(x, y) == "=") {
    //....
  }

  // If necessary, to disambiguate (a local identifier shadowing the
  // protocol function, or two protocols defining the same name), the
  // protocol name can be used as a prefix:
  if (Comparable.compare(x, y) == "=") {
  }
}
```

A protocol cannot be used where a type would be used:

```epsil
function sort(xs: list<Comparable>) -> list<Comparable> { ... }
// -> protocol-in-type-position: `Comparable` is a protocol, not a type.
//    Use a constrained variable:
//    `function sort(xs: list<T>) -> list<T> where T is Comparable`
```

This rule is **unconditional** — there are no dual-role names. `collection` and `indexed_collection` remain types only;
the protocol role for that family belongs to the engine-declared
`Iterable` and `Indexable` protocols (§4, and the sketch below).

### Built-in protocols: `Iterable` and `Indexable` — §4 bridge (sketch)

§4's first deliverable — a nominal type declaring itself a collection and
supplying handlers from Epsil — lands on this appendix as two
**engine-declared** protocols mirroring the engine's internal collection
handler tiers (`collection` and `indexed_collection` themselves stay pure
types — see the no-dual-role ruling above):

- **`Iterable`** — the `collection` tier: iteration and size;
- **`Indexable`** — the `indexed_collection` tier: positional access.

```epsil
type Deck = tuple<cards: list<string>> is Iterable {
  function iterate(self) -> ... { ... }
  get count(self) -> integer { ... }
}
```

Two rulings make these protocols the bridge (§4 owns the full statement):

- **Built-ins conform out of the box.** The engine declares
  `collection is Iterable` and `indexed_collection is Iterable &
  Indexable`, implemented internally by the existing handler tables — so
  every collection value dispatches `Iterable`/`Indexable` members, and by
  lattice inheritance every subtype (`list<integer>`, `set<number>`, …)
  conforms too.
- **Conformance grants lattice membership** — the special power reserved
  to these two protocols, which ordinary protocol conformance does not
  have: a nominal conforming to `Iterable` becomes a member of the
  `collection` existential; conforming to `Iterable & Indexable`, of
  `indexed_collection`. (`Indexable` alone grants no membership —
  `indexed_collection <: collection` requires the iteration tier — though
  its members still dispatch.) This is how `Map`, `Filter`, etc. come to
  accept user types.

The exact requirement sets (iteration, count, positional access, element
typing, laziness) must be transcribed from the internal
`CollectionHandlers` contract into per-protocol requirement tables; that
transcription is real spec surface and needs its own design doc before
implementation. Element typing stays `unknown` in v1 — precise element
propagation is the §6.1 `elem`/`rebind` track.

### Dispatching

**Dispatch rule.** To identify the implementation that a protocol function
call matches, the combination of the function name and the type of its
first argument (the `Self` position) is used. The dispatch is **dynamic**
and determined at runtime: the implementation chosen is always the most
specific one for the runtime type of the first argument. If there is both a
`Comparable` implementation for `number` and for `integer`, and `compare()`
is called on an `integer`, the `integer` implementation is dispatched:

```epsil
type number is Comparable {
  function compare(self: number, other: number) -> "<" | "=" | ">" {
    if (self < other) { "<" }
    else if (self > other) { ">" }
    else { "=" }
  }
}
```

**Static checking (ruling).** At a call site, `Self` binds to the *static
type of the first argument*; every other `Self`-typed parameter is then
checked as an ordinary argument against that binding. There is no joining
of `Self` across arguments:

```epsil
compare("a", 3)
// Self binds to `string` (the type of the first argument)
// -> incompatible-type: argument 2 has type `integer`; expected `string`
//    (`Comparable.compare` at `Self = string`)
```

If the first argument's static type neither conforms nor has any conforming
subtype, the call is a static diagnostic
(`protocol-implementation-missing`); if conformance cannot be decided
statically (e.g. the static type is `value`, or a union only some arms of
which conform), the call is checked dynamically and produces the ordinary
runtime error value when no implementation applies.

**Name resolution.** A bare (unqualified) call resolves through this pipeline:

1. A lexically visible user definition of the name shadows all protocol
   members — the user's function matches the bare name.
2. Otherwise, if the name belongs to exactly one protocol, it resolves
   there.
3. Otherwise (the name is in several protocols), candidates are filtered by
   applicability to the first argument's static type: exactly one
   applicable candidate resolves; several emit `protocol-call-ambiguous`,
   suggesting qualification. (Ambiguity is per call site, not a blanket
   engine-wide name collision — declaring a colliding protocol does not
   retroactively break calls whose first argument only ever applies to
   one.)
4. A qualified call — `Comparable.compare(...)` — is always available,
   ambiguity or not.

```epsil
type string is Comparable
type string is Comparator
let c = compare("foo", "bar")
// -> protocol-call-ambiguous: `compare` is defined by the `Comparable`
//    and `Comparator` protocols, and both apply to `string`. Use a
//    qualified name to narrow the one you meant.

let c = Comparable.compare("foo", "bar")   // ok
```

**Static resolution and compiled code.** The engine may apply **static
resolution** as an optimization when it can prove the answer is identical —
essentially only when the static type is exact and no more-specific
conformance could apply. Two consequences (rulings):

- Because conformance is monotonically *added*, a cached static resolution
  can be invalidated by a later, more specific conformance. Registry
  changes are state events (see "Scope and lifecycle") precisely so those
  caches are invalidated rather than left stale.
- Compilation follows §3's criterion — *the tag is erased iff it is
  statically discharged*. A statically resolved protocol call compiles to a
  direct call, and the receiver's nominal tag may still erase (D11). A call
  that stays dynamic needs the receiver's runtime tag reified in compiled
  code; where the receiver is an erased nominal and the target cannot be
  proven, the compiler declines compilation of that expression (consistent
  with its other fail-closed capability gates, cf. §3) rather than guess.

  *Implemented 2026-08-12* (JS target; function dispatch, bare and
  qualified, plus property GET/SET) —
  `docs/plans/2026-08-12-protocol-compilation.md` records the two-tier
  decision procedure, the guard model, and the deliberate divergences (a
  compiled miss throws where the interpreter yields the error value).

**Effects (ruling).** A dynamically dispatched call site carries the
*requirement's* declared effect. Implementations may not be more effectful
than the requirement (see "Signature matching"), so the static effect is
sound for every possible target.

**Properties.** Protocol properties are accessed using the standard field
syntax:

```epsil
let person: Person = getUser()
const name = person.name
// -> invokes the `get name(person)` handler

person.name = "Steve"
// -> rebinding sugar (ruling): `person = «set name»(person, "Steve")`
```

Property assignment is **rebinding sugar** over the immutable value model
(nominal values are opaque, immutable tag+payload — nominal-types design
§4.2, and `Field`/`At` assignment is otherwise rejected for exactly this
reason): the `set` handler returns the updated value and the assignment
rebinds the left-hand variable to it. The left-hand side's root must
therefore be an assignable binding; a non-variable target
(`xs[i].name = v`) emits `property-assignment-target-invalid` in v1.

If there are conflicting properties from protocols with overlapping
property names, the property name can be prefixed with the protocol name to
disambiguate, enclosed in parentheses:

```epsil
person.(Nameable.name)
```

(This form requires amending the shipped field-access grammar —
nominal-types design D16 pins `.` + SYMBOL only — with a production for
parenthesized qualified field names; that amendment is part of this
feature.) If the property name cannot be resolved unambiguously,
`protocol-property-ambiguous` is emitted.

### Host API

The CE host API can also be used to declare protocols. The declaration
shape distinguishes the three member kinds — a flat
`Record<string, string>` cannot represent properties:

```ts
ce.declareProtocol(name: string, members: {
  functions?: Record<string, string>;   // name -> signature type string
  readonly?: Record<string, string>;    // name -> property type string
  readwrite?: Record<string, string>;
}): void;

ce.declareProtocolImplementation(
  type: string,                          // conformance target, e.g. "string"
  protocol: string,
  impl: {
    functions?: Record<string, (self, ...args) => unknown>;
    getters?: Record<string, (self) => unknown>;
    setters?: Record<string, (self, value) => unknown>;
  },
  options?: { where?: string }           // conditional-conformance constraints
): void;
```

For example:

```js
ce.declareProtocol('Comparable', {
  functions: { compare: '(self: Self, other: Self) -> "<" | "=" | ">"' },
});

ce.declareProtocolImplementation('string', 'Comparable', {
  functions: { compare: (self, other) => /* ... */ },
});
```

Host declarations validate eagerly and **throw** on error, including on
re-declaration (see "Scope and lifecycle"); the Epsil route emits
diagnostics and replaces on statement re-run. Route-parity tests must
exercise both routes (cf. the box/parse-route convention in `CLAUDE.md`).

### Trust model

Conformance is engine-global and monotonic: any Epsil input can attach
behavior to built-in types for the lifetime of the engine, a later
more-specific conformance intercepts existing dynamic call sites, and
property getters execute code on ordinary-looking field reads. A host
embedding untrusted Epsil should use a dedicated engine instance per trust
domain. Whether a host-side control is warranted (freezing the registry, or
restricting conformance on built-in types to host-authorized declarations)
is an open ruling — §7 item 6(g).

### Diagnostics

| Code | Emitted when |
|---|---|
| `protocol-member-keyword-missing` | protocol member lacks `function`/`readonly`/`readwrite` |
| `protocol-self-required` | first argument of a protocol function is not `Self` |
| `protocol-scope-invalid` | `protocol` declared in a local scope |
| `protocol-conformance-target-invalid` | target is a union/intersection/negation, anonymous structural type, bare variable, or alias |
| `protocol-target-unknown` | conformance names an unknown type |
| `protocol-conformance-overlap` | new target overlaps an existing one without comparability; or conditional + unconditional on one head |
| `protocol-implementation-split` | implementation block attached to a multi-protocol conformance |
| `protocol-implementation-pending` | (warning) conformance still unimplemented at end of a `ce.parse()` batch |
| `protocol-implementation-missing` | requirement unimplemented; or dispatch through a pending conformance (runtime) |
| `protocol-implementation-duplicate` | second implementation block for the same (type, protocol) pair |
| `protocol-member-unknown` | implementation defines a member not in the protocol |
| `protocol-signature-mismatch` | implementation signature not a subtype of the requirement |
| `protocol-property-readonly-set` | `set` handler provided for a `readonly` property |
| `protocol-constraint-unsatisfied` | solved type variable fails an `is` constraint |
| `protocol-in-type-position` | protocol name used where a type is expected |
| `protocol-call-ambiguous` | bare call resolves to several applicable protocols |
| `protocol-property-ambiguous` | property name resolves to several protocols |
| `property-assignment-target-invalid` | property assignment whose LHS root is not an assignable binding |
