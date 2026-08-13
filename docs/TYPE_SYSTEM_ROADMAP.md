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
7. Mutable objects (Appendix B): rulings B1–B13 — proposal under review;
   nothing ratified. B10 amends item 6(b) above and
   `docs/EFFECTS-MODEL.md` (the `state` label).
8. Named arguments (Appendix C): rulings C1–C6 — proposal under review,
   sequenced before Appendix B (whose constructors require it).


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

Appendix B proposes superseding this sugar with true mutable objects:
assignment would then modify the object in place, be legal only on
object-backed types, and be rejected on records. Until that proposal is
ratified, the sugar above is the shipped behavior.

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

## Appendix B: Mutable objects

> Status: **proposal**, 2026-08-12 — nothing below is implemented. The
> decisions it needs are collected as rulings B1–B13 at the end. It
> depends on Appendix C (named arguments), which is proposed to land
> first. Landing it
> supersedes two shipped decisions of Appendix A; the exact amendments are
> listed under "Changes to Appendix A".

### The idea

Every value in the engine today is immutable. A record, once built, never
changes; "changing a field" really means building a new record that
differs in one field. This appendix adds exactly one mutable thing to the
language: the **object**. An object is a reference to a record whose
fields can be changed in place. Two names can refer to the same object,
and a change made through one is visible through the other. Everything
else — numbers, strings, lists, tuples, records, nominal values — stays
immutable.

The motivation comes from protocols. A protocol can declare a settable
property (`readwrite age: integer`), but with only immutable values there
is nothing a setter can genuinely set:

```epsil
const p: Person = getUser()
p.age = p.age + 1
```

Appendix A makes property assignment work through rebinding sugar — the
setter returns an updated copy and the variable `p` is rebound to it.
That reading has hard limits: it fails on this very example (`p` is
`const`, and rebinding a `const` variable is an error); it cannot work at
all when the value lives inside a list or another structure (there is no
variable to rebind); and a "change" made this way is invisible to anyone
else still holding the old value. With objects, the statement does what
it looks like it does: `p` keeps naming the same object, and that
object's `age` field changes. `const` protects the *binding* — which
object `p` names — not the object's contents; the same rule as
JavaScript's `const`.

### Declaring an object type

An object type is declared like other nominal types, with `object<…>`
listing its stored fields:

```epsil
type Person = object<
  firstName: string,
  lastName: string,
  age: integer,
  role: string
>
```

The constructor takes one value per stored field, passed by name:

```epsil
const p = Person(firstName: "Alan", lastName: "Turing",
                 age: 42, role: "scientist")
```

Constructor arguments are named, never positional: `Person` has two
adjacent `string` fields, and a positional call that swapped them would
be accepted silently. Because the arguments are named, their order does
not matter. Named-argument calls are their own language feature —
Appendix C, proposed to be ratified and implemented before this
appendix — and object constructors are simply the first place where
names are *required* (ruling B11).

The constructor requires every field, so an object never exists in a
half-initialized state, and no rule is needed for "reading a field that
was never set". (A create-empty-then-fill-in style would need one;
ruling B7 defers it.)

In v1, `object<…>` may appear only as the definition of a named type,
as above — inline in an annotation it is rejected with
`object-type-not-inline` (`let x: object<id: string>`). Objects are
nominal.

### Objects and protocols

With objects, a protocol with settable properties can finally mean what
it says:

```epsil
protocol Identifiable {
  readwrite firstName: string
  readwrite lastName: string
  readonly fullName: string
  readwrite age: integer
  readwrite role: string
  function birthday(self: Self) state -> Self
}
```

Note the `state` effect label on `birthday`: the requirement itself must
declare that `birthday` touches mutable object state — see "Changing a
field is an effect" below, where the label is introduced.

A conforming object type:

```epsil
type Person = object<
  firstName: string,
  lastName: string,
  age: integer,
  role: string
> is Identifiable {
  // fullName is not a stored field: it is computed on demand.
  get fullName(self: Person) -> string {
    "\(self.firstName\) \(self.lastName\)"
  }
  function birthday(self: Person) -> Person {
    self.age = self.age + 1
    self   // the protocol promises that birthday returns Self
  }
}
```

Three rules make this work:

- A `readwrite` property requirement is satisfied automatically by a
  stored field with the same name and **the same type** — no `get`/`set`
  needs to be written. `firstName`, `lastName`, `age`, and `role` are
  covered this way. Exact type match is not an oversight: the getter
  direction would allow a narrower field, the setter direction a wider
  one, and the only type satisfying both is the property's own.
- A `readonly` property requirement is satisfied by a stored field whose
  type is the property's type **or a subtype** — only the getter
  direction exists, so the ordinary covariant rule of Appendix A's
  "Signature matching" applies.
- A property implemented with an explicit `get` (plus `set`, for a
  `readwrite` property) is **computed**: it has no stored field, and its
  accessors run on each access. `fullName` is computed here. This is how
  a type can present a different surface than what it stores. Declaring
  both a stored field and an accessor for the same property name is an
  error (`object-property-conflict`) — a name is field-backed or
  computed, never both.

When a protocol is *replaced* (statement re-run, Appendix A "Scope and
lifecycle"), an object type's layout does not change: the stored fields
are fixed at declaration. The replacement re-runs conformance checking
against that fixed layout — a property whose name, type, or mutability
no longer matches a field or accessor leaves the conformance incomplete
(`protocol-implementation-missing`, as for any other replacement), and
objects constructed earlier keep their fields. Layouts never migrate.

Using it:

```epsil
const p = Person(firstName: "Alan", lastName: "Turing",
                 age: 42, role: "scientist")
"Happy birthday, \(birthday(p).fullName\)! You are \(p.age\)."
// ➔ Happy birthday, Alan Turing! You are 43.
```

Note that `p.age` reads 43: `birthday(p)` changed the object, and the
pieces of the string evaluate left to right. Mutation makes evaluation
order observable — left-to-right stops being an implementation detail
and becomes part of the language's meaning (ruling B8 pins it).

### Which types can conform (the mutability gate)

A protocol that can *modify* object state — because it has at least one
`readwrite` property, or a function member whose declared effects
include the `state` label — can only be conformed to by object types. A
protocol with only `readonly` properties and `state`-free functions can
be conformed to by any type, exactly as today. (Keying on the label is
deliberately conservative: a member could carry `state` because it
mutates some *other* object rather than its `Self`; v1 accepts that
imprecision, and per-argument effect precision is a future refinement.)

```epsil
type Badge = record<id: string> is Identifiable
// -> protocol-requires-object: the `Identifiable` protocol has settable
//    properties. `Badge` is a record, and records are immutable; declare
//    `Badge` as an object type to conform.
```

### Assigning to a property

Property assignment is a real modification, and it is only legal on
objects. On a record — or any other immutable value — it is an error
that names the two ways out:

```epsil
type Data = record<id: string, value: string>
let d = Data(id: "1234", value: "foo")
d.id = "456"
// -> immutable-value-assignment: `d` is a record, and records cannot be
//    modified. Build an updated copy, or declare `Data` as an object
//    type.
```

```epsil
type MutableData = object<id: string, value: string>
let d = MutableData(id: "1234", value: "foo")
d.id = "456"   // ok — the object now has id "456"
```

The assignment target no longer needs to be a variable: any expression
that evaluates to an object can be stored into (`xs[i].name = v` works
when the list holds objects). This replaces Appendix A's rebinding sugar
and its `property-assignment-target-invalid` restriction — see "Changes
to Appendix A".

### References, not copies

Binding an object to another name does not copy it; both names refer to
the same object:

```epsil
const d = MutableData(id: "1234", value: "foo")
const e = d
d.id = "0000"
e.id
// ➔ "0000" — d and e are the same object
```

The same holds for function arguments: the function receives the object
itself, not a copy, and can modify it:

```epsil
function rename(x: MutableData) {
  x.id = "XXXX"
}
rename(d)
d.id
// ➔ "XXXX"
```

### Every construction makes a new object

Two constructor calls make two different objects, even with identical
arguments:

```epsil
MutableData(id: "1", value: "x") == MutableData(id: "1", value: "x")
// ➔ False — two distinct objects whose contents happen to be equal
```

This is a real departure. Everywhere else in the engine, evaluating the
same expression twice produces interchangeable results — `3 + 4` is `7`
both times, and the engine freely reuses cached results because nothing
can tell the difference. With objects, something *can* tell the
difference (the two results answer `==` differently), so construction
is treated the way drawing a random number already is: **constructing
an object carries the `state` effect label** (introduced under
"Changing a field is an effect"), and the rest follows from the effects
system's standard contract — effect-labeled expressions are not served
from evaluation caches and are not folded as constants. On the
observation-vs-action axis, construction is an *action* (re-running it
is observable), like a draw and unlike a clock read. The engine's habit
of sharing one boxed value for equal literals never applies to objects.

Ruling B3 records the residue: an audit of which existing caches assume
value semantics and must consult the label (or the per-object version,
below) once objects exist.

### Equality

`==` on two objects is true exactly when they are the same object.
Contents play no part:

```epsil
let a = MutableData(id: "1", value: "x")
let b = MutableData(id: "1", value: "x")
let c = a
a == b   // ➔ False — different objects
a == c   // ➔ True  — same object
```

Why not compare contents? Because contents change. Two objects that are
equal by contents now can differ a moment later; "are these the same
object" is the only question whose answer stays true. Comparing contents
is a legitimate but *different* question. If it turns out to be wanted,
it should be an explicit opt-in — a protocol a type conforms to,
consulted by a dedicated operation — and never the meaning of `==`
itself (ruling B4, deferred).

Engine note: all of the engine's comparison tiers (`isSame`, `isEqual`,
`isIdenticallyEqual`) answer with reference identity for objects. In
particular `isSame` — the strict, cheap check used internally as a
deduplication key — must never run user code, so no protocol can be
involved at that tier; and `isIdenticallyEqual`'s sampling-and-proof
machinery has nothing to prove about a reference.

### Cycles

Because objects are references, they can end up referring to each other
in a loop:

```epsil
type Buddy = object<name: string, friend: type Buddy | missing>
let alice = Buddy(name: "Alice", friend: Missing)
let bob = Buddy(name: "Bob", friend: alice)
alice.friend = bob
// alice's friend is bob, and bob's friend is alice — a cycle
```

Every part of the engine that walks a value recursively — printing,
serializing, comparing contents, inspecting types — must now be prepared
to meet a value it has already visited, or it will loop forever. The
engine has an established pattern for this (cycle guards on
definition-following walks); what is new is that ordinary user *data*
can be cyclic, so the guards must extend to value walks.

### Lifetime

Objects need no new memory management. The engine runs on a JavaScript
host, and an object is an ordinary heap value there: it lives exactly
as long as something still refers to it — a variable in scope, a field
of another live object, a closure that captured it — and is reclaimed
by the host's garbage collector when nothing does. Cycles are not a
problem either: a tracing garbage collector (unlike reference counting)
reclaims two objects that only refer to each other.

Three consequences are worth pinning (ruling B12):

- **The engine must not secretly keep objects alive.** Engine-global
  machinery that remembers values — evaluation caches, dispatch caches,
  interned literals — must either exclude objects (B3 already excludes
  them from caching for correctness reasons) or hold them weakly.
  Otherwise an object constructed once in a notebook session would live
  until the engine is discarded, even after nothing in the program
  refers to it. A binding in the global scope does keep its object
  alive, of course — that is released by rebinding or forgetting the
  symbol.
- **An object belongs to one engine instance.** It cannot be
  serialized out (see "Serialization") and cannot be handed to a
  different engine; its identity is meaningful only within the engine
  that constructed it.
- **No destructors.** Nothing runs when an object is reclaimed, and v1
  offers no way to ask for that. If a future object ever holds an
  external resource (a file handle, a network connection), that is the
  effects/capability tier's problem (`docs/EFFECTS-MODEL.md`), not the
  object system's: reclaiming memory and releasing resources are
  different problems, and tying resource release to garbage collection
  is a classic mistake this proposal declines to make.

### Serialization

MathJSON has no way to express "these two places refer to the same
object", and no way at all to express a cycle. Two candidate postures
(ruling B5):

- **Refuse** (recommended for v1): serializing an expression that
  contains an object emits `object-serialization-unsupported`. Nothing
  is silently lost.
- **Snapshot**: serialize a copy of the object's current contents.
  Sharing is silently lost — two references to one object come back as
  two unrelated records — and cycles still need an answer.

Refusal is **subexpression-local**, following the engine's
errors-as-values convention: inside a larger, otherwise-serializable
structure, the object's position serializes as an error expression
(`object-serialization-unsupported`) and the rest serializes normally —
the whole call does not throw.

The recommended pairing: refuse implicitly, and provide an explicit
operation (`Snapshot(p)`, name open) that returns an immutable record
copying the object's current contents. Whether a snapshot is shallow or
deep, and what a deep snapshot does on a cycle, is part of B5.

### Changing a field is an effect

A function that changes a field of one of its arguments does something
its caller can observe beyond the returned value. This proposal
introduces a dedicated effect label for it: **`state`** — the
expression creates or mutates object state. Reusing the existing
`scope` label was considered and rejected: `docs/EFFECTS-MODEL.md`
defines `scope` as mutation of a *binding* on the ambient scope chain
(`Assign`, `Declare`), and its confinement and dominance analysis is
written entirely in those terms — a heap store through a reference is a
different class of write, and stretching the definition would silently
invalidate that analysis. (The name is the one bikeshed left in B2;
`mutate` is the alternative.) Three consequences:

- The implicit setter behind every `readwrite` property carries
  `state`, so property stores are never invisible to the effects
  system. Object *construction* carries it too (previous section).
- A protocol function whose implementations modify `Self` must declare
  `state` in the requirement — as `birthday` does above. Appendix A's
  signature-matching rule says an implementation may be *purer* than
  its requirement but never more effectful, so a `state`-free
  `birthday` requirement would reject every implementation that
  actually mutates. (Implementations themselves may leave the specifier
  bare — the shipped inferred-effects model infers their labels from
  the body.)
- Landing the label amends `docs/EFFECTS-MODEL.md` (see "Changes to
  shipped documents"): the label table gains `state`, and the
  confinement analysis gains a note that it does not apply to `state`
  in v1 — no escape analysis for objects; every store and construction
  emits.

Writes are only half the caching story; **reads** need their own
answer, and labels are the wrong tool for them — the effects model
deliberately treats reads of non-local state as label-free, relying on
precise invalidation channels instead. This proposal follows that
precedent: every object carries a **version counter**, bumped on each
field store, and reading a field records a dependency on that counter
the same way reading a global binding records a generation dependency
today. A cached result that read `p.age` is invalidated by the next
store to `p` — not by stores to unrelated objects. Each store also
registers a state event through the engine's event machinery (Appendix
A, "Registry changes are state events"); since every store goes through
one operation, both the version bump and the event have a single
emission point.

### No subtyping between object types

Object types are unrelated to each other, even when their shapes look
compatible. To see why the flexibility records enjoy would be unsound
here, suppose it were allowed:

```epsil
type Counter = object<count: integer>
type Gauge   = object<count: number>

let c: Counter = Counter(count: 1)
let g: Gauge = c        // suppose this were allowed…
g.count = 1.5           // …then this is fine for a Gauge…
c.count                 // …and the Counter now holds 1.5 — its type lied
```

With immutable records the first step would be harmless, because nobody
can write `1.5` into anything — which is precisely why records get to
have subtyping and objects do not. Code that should work across several
object types says so with a protocol, which is also the only
relationship this appendix needs.

### Generic object types

Parameterized object declarations are supported, riding the shipped
parameterized-nominal machinery (§1, N1–N12), with one new rule for the
variance walker: **a stored field is an invariant position**. A type
variable that occurs in a stored field verifies only as `inout`;
declaring it `out` or `in` is rejected. The unsoundness this blocks is
the parameterized twin of the Counter/Gauge example:

```epsil
type Cell<inout T> = object<value: T>

// If `out T` were accepted, Cell<integer> <: Cell<number> would hold:
let a: Cell<integer> = Cell(value: 1)
let b: Cell<number> = a      // …this upcast would then be allowed…
b.value = 1.5                // …and the Cell<integer> now holds 1.5
```

A variable that occurs only in *computed* property signatures is not a
stored field and keeps the ordinary variance rules. (Ruling B13.)

### The rest of the system

- **Broadcast**: an object is a single value; it is never iterated into
  or broadcast over (the same atomicity ruling as sum values).
- **Compilation**: JavaScript and Python have native reference
  semantics, so objects compile naturally there. The GPU target has no
  references and declines, fail-closed like its other capability gates.
  At the engine⇄compiled boundary, the tagged-sum rule of §3 is
  mirrored: object-typed *parameters* into a compiled unit are
  supported; object-typed unit *results* decline in v1 (ruling B9).
- **Where `object` sits in the type lattice** — is bare `object` a
  usable type meaning "any object"? are objects disjoint from `record`?
  — is ruling B6. Lean: yes and yes. A bare-`object` supertype does not
  contradict "No subtyping between object types": it relates every
  object type to one common bound, never to a sibling — the same shape
  as `collection` membership, and like it a deliberate carve-out from
  nominal opacity, not a general rule change.
- **Trust model**: objects raise the stakes of the open host-trust
  ruling (§7 item 6(g)) — a protocol property getter can now *mutate*
  any reachable object as a side effect of an ordinary-looking field
  read, where today it can only compute a value. The 6(g) decision
  should be made with objects in mind.
- **Property-name resolution**: stored fields and protocol properties
  share one namespace via the satisfied-by-a-field rule above, and the
  qualified form `p.(Protocol.name)` remains available for conflicts
  between protocols. The dictionary-key precedence rule (P46) is not
  implicated: objects are not dictionaries.

### Deferred: deriving the shape from the protocol

It is tempting to skip the field list and let the protocol supply it:

```epsil
type Person = object is Identifiable   // shape derived from the protocol?
```

Deferred, because two problems need solving first:

1. **Protocol replacement.** Re-running a `protocol` statement replaces
   the protocol (Appendix A, "Scope and lifecycle"). If the protocol
   defines the storage shape, replacing it changes the layout of every
   derived conformer — and objects constructed before the replacement
   still have the old shape.
2. **Multiple protocols.** Implementation blocks are per-protocol and
   may arrive in later statements or later notebook cells, so a shape
   derived from "all properties not covered by an accessor" is not known
   until every block has been seen — but the constructor may be called
   in between.
(A third problem a positional constructor would have had — parameter
order coming from protocol member order, so that reordering the
protocol's members silently breaks every construction call — does not
arise: constructor arguments are named and order-free; see Appendix C.)

Neither problem is fatal (freeze the shape at declaration time), but
each needs its own ruling, and an explicit field list has neither
problem — so v1 requires the explicit list.

The explicit list has a real cost, recorded here as the standing
motivation to revisit: the author must **replicate, name for name and
type for type, the property list the protocol already declares** —
`Person` restates four of `Identifiable`'s five properties as fields.
Replication drift is at least caught loudly rather than silently (a
missing or mistyped field leaves the conformance incomplete, via
`protocol-implementation-missing` / `protocol-signature-mismatch`), so
the duplication is checked — but the ergonomics cost is real, and it is
why the derived-shape idea stays on the table rather than being
rejected: once the two blockers above get their rulings, synthesis (or
a lighter sugar over it) should be re-examined.

One thing this proposal deliberately does **not** change: bare
`type Person is Identifiable` (without `= object`) keeps its shipped
meaning — a conformance declaration for an *existing* type, with
`protocol-target-unknown` when no such type exists. If that spelling
could also declare a new type, a typo in a type name would silently mint
a fresh object type instead of being caught.

### Rulings needed

- **B1 — the mutability gate.** A protocol that can modify `Self`
  (a `readwrite` property, or a function member with a declared
  Self-modifying effect) is conformable only by object types;
  `protocol-requires-object` otherwise.
- **B2 — the `state` effect (settled in this revision, pending
  ratification).** A new label: field stores and object construction
  carry it, implicit property setters carry it, and requirements for
  mutating functions must declare it; reads are tracked by per-object
  version counters, not labels. Reusing `scope` is rejected — it is
  defined as binding mutation and its confinement analysis does not
  transfer. Remaining bikeshed: the name (`state` vs `mutate`).
- **B3 — construction is observable.** Fresh identity per construction,
  carried by the `state` label (an *action* on the
  observation-vs-action axis); exclusion from literal interning; plus
  an audit of which existing caches assume value semantics and must
  consult the label or the per-object version.
- **B4 — contents equality (deferred).** `==` stays reference identity;
  an opt-in contents-comparison protocol, if ever, is a separate
  operation.
- **B5 — serialization.** Refuse + explicit `Snapshot` (recommended) vs
  silent snapshot; snapshot depth; behavior on cycles.
- **B6 — lattice placement.** Bare `object` as "any object";
  disjointness from `record`.
- **B7 — initialization.** v1: constructors take every stored field; a
  create-empty-then-fill style would need a missing-field story first.
- **B8 — evaluation order.** Left-to-right evaluation becomes
  observable wherever operands evaluate — arguments, interpolation
  segments, block statements, collection callbacks; pin it, including
  for short-circuit forms and lazy materialization, and require
  compiled targets to preserve the order or decline.
- **B9 — compile boundary.** Mirror the §3 sum rule: parameters in,
  results decline, GPU declines entirely.
- **B10 — the Appendix A amendments** below.
- **B11 — named constructors.** Object constructors require named
  arguments. Depends on Appendix C (named-argument calls), which is its
  own proposal, sequenced before this one.
- **B12 — lifetime.** Objects are reclaimed by the host's garbage
  collector; engine-held caches must not keep objects alive; an object
  never outlives or crosses its engine; no destructors in v1 (see
  "Lifetime").
- **B13 — generic object types.** Supported via the
  parameterized-nominal machinery; a stored field is an invariant
  position (`inout` only) for the variance walker; computed-property
  signatures keep ordinary variance (see "Generic object types").

### Changes to shipped documents when this lands

To Appendix A:

1. **"Properties"** — the property-assignment paragraph (rebinding
   sugar, `property-assignment-target-invalid`) is replaced: assignment
   is a store, legal only on objects; on records and other immutable
   values it emits `immutable-value-assignment`; non-variable targets
   become legal when they evaluate to objects. The `Person`/`Nameable`
   example becomes an object-backed example.
2. **"Property implementations" and the completeness check** are
   amended for field-backed satisfaction: a stored field of the right
   name and type satisfies a property requirement with no accessor
   written (rules under "Objects and protocols"); an accessor alongside
   a same-named field is `object-property-conflict`; the completeness
   diagnostics account for both.
3. **§7 item 6(b)** (property assignment as rebinding sugar) is
   superseded by B10.
4. **"Signature matching"** is unchanged as a rule, but gains the
   consequence spelled out under "Changing a field is an effect":
   requirements for mutating functions must declare the `state` effect,
   or no mutating implementation can satisfy them.
5. **The mutability gate is a breaking change**: a shipped record-backed
   conformance to a protocol with `readwrite` properties (Appendix A's
   original `Person`/`Nameable` example was one) becomes illegal —
   revalidation emits `protocol-requires-object`. Migration is
   mechanical: redeclare the type as `object<…>` with the same fields.
   Deliberate, not collateral: the rebinding lowering those
   conformances relied on only ever worked for variable-rooted access.

To `docs/EFFECTS-MODEL.md`:

6. The label table gains **`state`** (creates or mutates object state;
   impure; an *action* on the observation-vs-action axis; no frame
   protocol; not handler-backed), and the confinement analysis gains a
   note that it does not apply to `state` in v1 — no escape analysis
   for objects; every store and construction emits.

## Appendix C: Named arguments

> Status: **proposal**, 2026-08-12 — nothing below is implemented. This
> appendix stands on its own and is proposed to be ratified and
> implemented **before** Appendix B: object constructors require named
> arguments, but nothing here depends on objects. Rulings C1–C6 at the
> end.

### The idea

A call may pass an argument by the name of the parameter it is for:

```epsil
function interest(principal: number, rate: number, years: integer)
    -> number {
  principal * (1 + rate) ^ years
}

interest(principal: 1000, rate: 0.05, years: 10)
```

Today `f(name: value)` is a parse error (probed 2026-08-12), so the
syntax is free to claim: no existing program changes meaning.

What it buys:

- **Error-proofing.** `Person(firstName: "Alan", lastName: "Turing")`
  cannot silently swap the two strings; `Person("Alan", "Turing")` can.
  This is the constructor case that motivated the feature (Appendix B).
- **Readable call sites.** `interest(1000, 0.05, 10)` makes the reader
  guess which number is which; the named call does not.
- **Order independence.** Named arguments may be given in any order,
  which matters most for functions with several rarely-used options.

### Rules

A named argument must use a parameter name the function declares.
Signatures already carry parameter names (`(predicate: function,
initial: any?) -> …`), so there is something to match against. An
unknown name is an error that lists the real ones:

```epsil
interest(1000, rte: 0.05, years: 10)
// -> argument-name-unknown: `interest` has no parameter named `rte`.
//    Its parameters are `principal`, `rate`, and `years`.
```

Positional and named arguments can mix: positional arguments come
first and fill parameters left to right, then named arguments fill the
rest. Once one argument is named, the remaining arguments must be named
too, and no parameter may be given twice:

```epsil
interest(1000, rate: 0.05, years: 10)  // ok: 1000 fills `principal`
interest(rate: 0.05, 1000, years: 10)  // error: positional after named
interest(1000, principal: 2000)        // error: `principal` given twice
```

A named call needs a callee whose declaration the engine can see, and
**the declaration the call resolves through supplies the names**: for
`let g: (a: number) -> number = f`, the call `g(a: 1)` checks against
`g`'s annotation, whatever `f`'s own declaration said. Parameter names
never participate in type compatibility itself — Appendix A's
"parameter names are not significant" rule for signature matching is
unchanged; names matter only at a call site that uses them. It follows
that naming an argument of a callee with no visible declaration — an
unresolved forward reference, or a bare value only known to be of type
`function` — is an error, `argument-names-unavailable`: there is
nothing to check the names against.

### What the names are, and what they are not

Parameter names become part of a function's public interface: once
callers can write `rate: 0.05`, renaming the parameter breaks them.
(The library's parameter names — `predicate:`, `key:`, `mapping:`,
`reducer:` and friends — were made uniform in 2026-08; this feature is
what turns that grooming into API surface.)

The names are surface syntax, not data: at canonicalization a named
call is matched against the signature and normalized to positional
order, and everything downstream — evaluation, compilation, MathJSON —
sees an ordinary positional call. A round trip through MathJSON
therefore comes back positional; whether the Epsil serializer should
re-derive names from the signature for readability is part of C4.

### Rulings needed

- **C1 — grammar.** `name: value` in call-argument position, as
  sketched above.
- **C2 — mixing.** Positional first, then named; nothing positional
  after a named argument; no parameter twice; every required parameter
  filled.
- **C3 — overload resolution.** The shipped resolution machinery
  (per-position join over intersection arms) is positional, and two
  arms may map the same names to *different* positions. Proposed: each
  candidate arm carries its own name-to-position permutation through
  applicability checking, generic solving, and ranking; the call is
  normalized to positional only after one arm wins; several surviving
  name-compatible arms are ambiguous (existing overload-ambiguity
  behavior). This is the meatiest sub-question and likely needs its own
  design doc when this appendix moves to implementation.
- **C4 — serialization.** Names erase at canonicalization (proposed
  above); should the Epsil serializer re-derive them for readability,
  and if so, when?
- **C5 — variadic and optional parameters.** How names interact with
  `?`-optional parameters (a natural fit: name exactly the options you
  pass) and with variadic tails (no per-argument name exists —
  presumably positional only). Must also reconcile C2's "every required
  parameter filled" with the engine's partial-application behavior —
  does an under-filled named call error, or curry? The library leans
  heavily on optional and variadic signatures, so C is not
  implementable ahead of this ruling.
- **C6 — protocol dispatch.** A named call to a protocol function
  dispatches on the argument bound to the *declared first parameter*
  (`self`), wherever the caller wrote it: written position never
  changes dispatch. (Appendix A's "Dispatching" keys on the first
  argument; with names in play, "first" means the declaration's first.)

## Appendix D: Diagnostics

Codes from Appendix A are shipped. Codes marked † are proposed by
Appendix B or Appendix C and are not implemented.

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
| `property-assignment-target-invalid` | property assignment whose LHS root is not an assignable binding (retired by Appendix B when it lands) |
| `protocol-requires-object` † | a protocol with settable properties (or Self-modifying members) conformed to by a non-object type |
| `immutable-value-assignment` † | property assignment on a record or other immutable value |
| `object-serialization-unsupported` † | serializing an expression that contains an object (if B5 rules "refuse") |
| `argument-name-unknown` † | a named argument names a parameter the function does not declare (Appendix C) |
| `argument-order-invalid` † | a positional argument follows a named argument (Appendix C) |
| `argument-name-duplicate` † | the same parameter supplied more than once (Appendix C) |
| `argument-names-unavailable` † | a named argument used with a callee that has no visible declaration — unresolved forward reference, bare `function`-typed value (Appendix C) |
| `object-property-conflict` † | both a stored field and an explicit accessor declared for the same property name (Appendix B) |
| `object-type-not-inline` † | `object<…>` used inline in an annotation rather than as the definition of a named type (Appendix B) |
