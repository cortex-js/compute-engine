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

## 4. Protocols and conformance (long term)

See also: Appendix A below.

Two distinct gaps stand between today and a user-facing `mappable`:

- **Constraint**: "a type that supports map" as a bound. Bounds today are
  ground types only (§5 lifts the ground restriction; the protocol-as-bound
  role is a further step).
- **Dispatch**: parametricity means a single generic `map<F, T, U>` body
  cannot iterate an arbitrary opaque container; per-type implementations
  plus selection machinery (conformance declarations, dictionary-passing
  or vtables) *are* the protocol feature — the signature is its shadow.

`collection` is the prototype: already a protocol in disguise (membership
= conformance-by-handlers), just closed to user types. Under a protocol
regime it becomes **both** roles, per the Swift precedent (`Collection`
protocol + `any Collection` existential): the lattice type keeps its
existential meaning and subtyping (nothing breaks), and gains the bound
role. The imperative per-call `type:` handler on `Map` (~50 lines of shape
propagation in `library/collections.ts`) is exactly the computation a
bound + HKT signature `<F: collection, T, U>(F<T>, (T) -> U) -> F<U>`
would express declaratively — the compiler written because the type
language couldn't say it. First deliverable on this track: user
conformance (a nominal type declaring itself a collection and supplying
handlers from Epsil).

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


## Appendix A: Protocol Syntax


A protocol is a set of functions and properties that a type must implement in order to be said to **conform** to the protocol. 

```epsil
protocol Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">"
}
```

Multiple protocols can include functions with the same name, and same or different signatures:

```epsil
protocol Comparable {
  function compare(self: Self, other: Self) -> "<" | "=" | ">"
}
protocol Comparator {
  function compare(self: Self, other: Self) -> -1 | 0 | +1
  // ok: the `compare` function does not conflict with the one from `Comparable`
}
```

The type `Self` used in the protocol function signatures refer to the type for which the specific implementation of the protocol is defined. The first argument of the functions of a protocol must be of type Self. If the type is omitted, Self is inferred.


```epsil
protocol Comparable {
  function compare(self, other: Self) -> "<" | "=" | ">"
  // Same as `function compare(self: Self, other: Self) -> "<" | "=" | ">"`
}

protocol Comparable {
  function compare(self: list, other: Self) -> "<" | "=" | ">"
  // If the type of the first argument is not Self, a diagnostic is emitted
}
```


A protocol can also define readwrite or readonly properties.  The property names are prefixed with `readonly` or `readwrite` accordingly.

The properties are mapped to getter and setter functions, which must be implemented by the conforming type. An appropriate mangling scheme is used, for example `__get__hash` for the `hash` property getter, but is an implementation detail and not part of the public surface (see `hash` above)

```epsil
protocol Hashable {
  readonly hash: string
  // Equivalent to:
  // function __get__hash(self: Hashable): string
}

protocol Nameable {
  readwrite name: string
}

protocol Computeable {
    value: string;
// -> the readonly or readwrite keywords are missing, emit a diagnostic. "Did you mean `readonly value` or `readwrite value`?""
}

```

Note that a property can have a `function` type, but there are important differences between a `function` member and a property member with a `function` type: a function member participates in dispatch, in the unqualified global name, and in `Protocol.name` qualification; a function-typed property is just a getter that returns a function value — `x.compare` evaluates to a function which you then call yourself, the returned function receives no implicit `Self`, and different instances of the same type may return different functions (which is precisely the legitimate use case: per-instance behavior, e.g. a sort order carried by a collection instance).



Note: the members of a protocol start with one of three keywords: `function`, `readonly` or `readwrite`.



A protocol cannot define static functions, constructors or properties.

### Semantic Protocols

A protocol declaration doesn't have to include any requirements. You can use a protocol to describe semantic requirements — that is, requirements about how values of those types behave and about operations that they support.

```
protocol Copyable {}
```

### Scope

Protocols are not scoped, they are global for the Compute Engine instance. When reading an Epsil file, the protocol declarations can be hoisted (or processed in a first pass). Protocols declared inside a local scope trigger a diagnostic.

### Conformance

The `is` keyword is used to forward declare the conformance of a type.

For example, to declare conformance of a built-in type (`string`):

```epsil
type string is Hashable
```

Conformance can be added, but never removed (monotonicity).

Conformance to multiple protocols can be declared using the `&` keyword (conjunction):

```epsil
type string is Hashable & Comparable
```

Note: when multiple protocols are declared, an implementation cannot be provided:

```
type string is Hashable & Comparable {
  // -> error diagnostic: Provide separate implementation for each protocol
  function hash(...) ...
}

```

Note this is equivalent to:

```epsil
type string is Hashable
type string is Comparable
```

Re-declaring conformance is legal and a no-op, although we can emit a warning diagnostic when encountered.

The conforming type must be a primitive type or a nominal type. Compound types (unions, etc...) are not valid. 

```epsil
type list<integer> is Comparable;
// -> ok: `list<integer>` is a primitive type, 

type (integer | string) is Comparable;
// -> diagnostic error
```

For types in the type lartice, like `number`, if a type is protocol-conforming its subtypes are as well: in this case `integer` is `Comparable` as well. Because the lattice is not a chain, a new conformance that overlaps an existing conforming type without being comparable to it is an error.


Conformance can be also be declared for user-defined **nominal** types at the same time as the definition of the type.

```epsil
type Point: tuple<number, number> is Comparable;

// or:

type Point: tuple<number, number>;
type Point is Comparable;
```

Structural types cannot conform to protocols:

```
type alias Pt: tuple<number, number> is Comparable;
// -> diagnostic error: Use a nominal type (`type Pt`) to conform to protocol `Comparable`. Structural types (`type alias`) cannot conform to protocols.
```

To declare a conformance, the type has to be known:

```epsil
type FooBar is Comparable;
// -> diagnostic error: the type `FooBar` is unknown
```


By the end of the compilation unit, ( `ce.parse()` batch), all the declared conforming types must also have a corresponding protocol implementation, otherwise a diagnostic error is emitted.



### Protocol Implementation

A protocol implementation defines the implementation of the functions and properties of a protocol for a given type. 

A protocol implementation statement is also a declaration.

For example, the following declares that the primitive type `string` conforms to the `Comparable` protocol, and provide an implementation:

```epsil
type string is Comparable {
  // Provide an implementation of the `compare` function for `string`
  // The name of the function and the first argument must match the protocol declaration and are used to dispatch the call to the correct implementation. The implementations are provided in a braced block after the conformance declaration. If a type conforms to multiple protocols, it will have multiple implementation blocks
  function compare(self: string, other: string): "<" | "=" | ">" {
    if (self < other) return "<";
    if (self > other) return ">";
    return "=";
  }
}
```

If at the end of a protocol implementation block the protocol is only partially implemented, or include functions that are not part of the protocol, a diagnostic error is emitted:

```
type boolean is Comparable {
  cmpare(self, other: Self) -> "<" | "=" | ">" {
    ...
  }
  // -> `cmpare` is not a function of the `Comparable` protocol. Did you mean `compare`?
  // -> The `Comparable` protocol expected a definition of `compare`
```

Multiple conformance implementations can be provided for a given type:

```
type string is Hashable {
    // Note that in the implementation, the type of the argument can either be Self or the actual type (`string`) in this case: in this context they are synonyms
    hash(self: Self) -> string {
        ...
    }
}
```

If a conformance implementation is provided more than once on the same type, a diagnostic error is emitted:

```
type boolean is Comparable {
  function compare(self: Self, other: Self): "<" | "=" | ">" { ... }
}

type boolean is Comparable;
// -> ok, no-op re-declaration

type boolean is Comparable {
  // -> diagnostic error: the type `boolean` already has an implementation of the `Comparable` protocol.
  function compare(self: Self, other: Self): "<" | "=" | ">" { ... }
}

```

If the signature of a protocol function implementation does not match the signature of the protocol definition, a diagnostic error is emitted.

```
type string is Comparable {
  function compare(self: string, other: number): "<" | "=" | ">" {
    // Flag protocol functions defined on a type that do not match the expected signature (the second argument is `number` here instead of string).
    // -> Diagnostic: The signature of the compare function does not match the expected signature for the protocol `Comparable`.
    if (self.length < other) return "<";
    if (self.length > other) return ">";
    return "=";
  }
}
```

Protocol properties are defined by functions prefixed with the `get` and `set` keywords:

```
type string is Hashable {
  get hash(self: Self) { ... }
}

protocol Nameable {
  name: string
}

type Person is Nameable {
  get name(self: Self) -> string {...}
  set name(self: Self, value: string) -> string { ...}
}
```

The signature of the `get` handler of a property has a single argument, of type `Self` and a result type that matches the type of the property.

The signature of the `set` handler of a property has two arguments, the first of type `Self` and the second of a type that matches the type of the property. The result of the `set` handler is conventionally the type of the property, and the return value is the value the property was set to (which may be different that the input value, but which should be identical to invoking the `get` handler).

If the signatures of the `get` or `set` handlers are invalid, a diagnostic error is emitted. If a `set` handler is provided for a `readonly` property, a diagnostic error is emitted. If a `get` handler is missing for a property, a diagnostic error is emitted.


To provide an implementation of a semantic protocol, use the following syntax:

```
type MyType is Copyable
// The conformance **declaration** is sufficient

// Alternate syntax
type MyType is Copyable {}
// You can provide an empty declaration as well
```


### Conditional Conformance

A protocol can use type parameters and type constraints on those parameters:

```
protocol list<T, U> is Mapeable where T is Hashable {
  function map(a: Self, b: (T) -> U) : list<U>
}
```


### Protocol Constraints

A function signature may declare that some of its argument must conform to some protocols using a `where` clause:

```
function bar<T>(x: T) -> boolean where T: collection { ...}

function baz<T>(x: T) -> boolean where T: collection is Hashable { ...}

// Also acceptable
function baz<T>(x: T) -> boolean where T: collection, T is Hashable { ...}
```

A type may be required to conform to multiple protocols (not an *OR*, an *AND*).

The `where` clause can also be used to define type constraints using ":". The `is` operator is used to specify protocol conformance

If a type parameter is constrained by several protocols, the list of protocols is separated by a `&` character

```
function sort<T>(xs: list<T>): list<T> where T is Comparable & Hashable {
    // A protocol function can be called directly. The appropriate implementation is dispatched based on the type of the arguments.
    if (compare(x, y) === "=") {
        //....
    } 

    // If necessary, to disambiguate (for example if there is a local identifier shadowing the protocol function or if two protocols define a protocol function with the same), the protocol name can be used as a prefix, 
    if (Comparable.compare(x, y) === "=") {
    }

}
```

A protocol cannot be used where a type would be used:

```
function sort(xs: list<Comparable>) -> list<Comparable> {
}
// -> emit a diagnostic error
```

### Dispatching

To identify the implementation that a protocol function call matches, the combination of the function name and the type of its first argument is used to dispatch to the appropriate implementation.

The dispatch is **dynamic** and determined at runtime. The implementation chosen is always the most specific one for the runtime type of the first argument. The engine may apply **static resolution** as an optimization when it can prove the answer is identical — essentially only when the static type is exact and no more-specific conformance could apply. This can be useful when compiling as well.

When dispatching, the most specific implementation wins: if there is both a Comparable implementation for `number` and `integer`, and `compare()` is called on an `integer`, the `integer` implementation is dispatched.

```
type number is Comparable {
  function compare(self: number, other: number): "<" | "=" | ">" {
    if (self < other) return "<";
    if (self > other) return ">";
    return "=";
  }
}
```

A protocol function is recognized as a global unqualified identifier if it is unique (if the name is not used by two different protocols). The user can define a function with the same name, in which case the user's function matches the bare function name.

A protocol function can be disambiguated by qualifying it:

```
type string is Comparable;
type string is Comparator;
let c = compare("foo", "bar")
// -> diagnostic error: `compare` is defined for the `Comparable` and `Comparator` protocols. Use a qualified name to narrow the one you meant.
// Note: if there is no ambiguity (the name + first argument type is unique), the call does not need to be qualified

let c = Comparable.compare("foo", "bar")
```

The qualified call can alway be used, even where there is no ambiguity.

A direct call type-checks by treating `Self` as an implicit type variable that both arguments unify to a single conforming type (broadest of the type). In this case, `value` (the common ancestor of `string` and `integer`, and if the resulting type does not have a protocol implementation a diagnostic error is emitted (if it can be detected statically), or an error value at runtime

```
compare("a", 3)
// -> diagnostic error: no implementation of `compare` for `string` and `number`: the common type `value` is not conforming to the `Comparable` protocol.
```


Protocol properties are accessed using the standard field syntax (`["Field"...]`):

```
let person: Person = getUser();
const name = person.name
// -> invokes the `get name(person)`handler
person.name = "Steve"
// -> invoke the `set name(person, "Steve")` handler
```

If there are conflicting properties from protocols with overlapping property names, the property name can be prefixed with the protocol name to disambiguate, enclosed in parentheses

```
person.(Nameable.name)
```

A diagnostic error is issued if the property name cannot be resolved unambiguously.


### Host API

The CE host API can also be used to declare protocols:
```
ce.declareProtocol(protocolName: string, fields: Record<string, string>);
```

for example:

```js
ce.declareProtocol("Comparable", {
  compare: '(Self, other: Self) -> "<" | "=" | ">"',
});
```

And to provide protocol implementations:
```js
ce.declareProtocolImplementation(type, protocol, {...});
```

For example:
```js
ce.declareProtocolImplementation("string", "Comparable", {
  compare: (self, other) => /* ... */,
});
```

