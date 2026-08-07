# Type System Roadmap

Status: living document. Started 2026-08-06 from a design conversation on
sum types, monads/functors, and protocols; the empirical probes cited were
run that day against the parameterized-nominal-types working tree.

Design docs for the shipped and in-flight tiers (each §1 item points to
its own):

- `docs/plans/2026-08-01-nominal-types-design.md` — nominal types,
  constructors, D1–D11 (D11 = compile erasure, amended by §3 below)
- `docs/plans/2026-08-06-parameterized-nominal-types-design.md` —
  parameterized nominals, variance, N1–N10 ruling record (owns the §2.2
  ruling below)
- `docs/plans/2026-08-04-generic-type-aliases-design.md` — A1–A8
- `docs/plans/2026-08-01-type-variables-design.md` — forall/generics v1
- `docs/plans/2026-08-04-generic-function-literals-design.md` — G1–G11,
  `function f<T>()` and generic literals
- `docs/plans/2026-08-01-function-polymorphism-design.md` and
  `docs/plans/2026-07-25-overload-resolution-design.md` — multi-clause
  functions, intersection arms, per-position join
- `docs/EFFECTS-MODEL.md` — effect labels on function types
- `docs/plans/2026-08-03-cortex-language-extensions-review.md` —
  language-level backlog (sum sugar would slot there)
- `src/epsil/docs/types.md` — Epsil-surface reference for the `type` /
  `type alias` statements

### In flight as of 2026-08-06

Parameterized nominal types: all five phases implemented in the working
tree, **uncommitted**. Known residuals that this roadmap builds on:
`couldMatch` reports different-argument applications as could-not-match
(conservative); variable-carrying union bodies are unwritable for
parameterized nominals (`unsupported-variable-position` — the restriction
behind the §2.2 ruling); wrong-arity result type in a constructor-function
literal gets a misleading E1-sugar diagnostic; re-declaring a type throws
on the host API but replaces via Epsil statement. The Epsil-surface doc
(`src/epsil/docs/types.md`) still says constructing/reading parameterized
nominal values is unsupported — stale once the working tree lands; update
it with the same commit.

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
- **Type variables v1**: prenex (`forall T. …` / `function f<T>(…)`),
  rank-1, kind-`*` only, ground bounds only — no F-bounded, no variable
  bounds (type-variables design; generic-function-literals design, G1–G11,
  for the literal and `function f<T>()` surface).
- **Function polymorphism**: multi-clause definitions, intersection-typed
  overload sets, per-position-join overload resolution
  (function-polymorphism and overload-resolution designs).
- **Effects on function types**: effect labels are part of the signature
  and participate in subtyping (`docs/EFFECTS-MODEL.md`).
- **Parameterized nominal types** (`type tree<out T> = …`): opaque
  applications, recursive bodies, declaration-site variance (`in`/`out`/
  `inout`; unannotated = out-verified), forward references via the inline
  `type name<T>` marker with defer-and-fulfil SCC verification
  (parameterized-nominal-types design, N1–N10; N10 = ruling C; in flight,
  see above).
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

## 2. Sum types (near term)

### 2.1 Semantics by detection — largely done

A union of nominal types **is** a tagged sum: disjoint variants (nominal
opacity), per-variant constructors, `match` discrimination, no nesting
collapse. No dedicated syntax is required for the semantics — this is the
OCaml-polymorphic-variant / TS-discriminated-union "detected shape" model.
Probed working end to end (2026-08-06), including the recursive generic
case with the sum's own name at recursive positions:

```epsil
type leaf = nothing
type node<T> = tuple<value: T, children: list<type tree<T>>>   // fwd ref, defers
type alias tree<T> = leaf | node<T>                            // fulfilment: OK
```

Mutual recursion (JSON's `jarr`/`jobj`) likewise works via `type` markers,
order-independent. The forward-ref machinery covers both the ordering and
the naming problem — no inlined-union repetition is needed.

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

### 2.2 OPEN RULING — the forward-ref-to-alias loophole (load-bearing)

Three spellings of the same effective type diverge (probed 2026-08-06):
direct inlining of a variable-carrying union in a parameterized nominal
body is rejected (`unsupported-variable-position`, §5 syntactic validator);
fulfilling a forward ref with a *nominal* union body is rejected the same
way; fulfilling with the generic *alias* passes. Coherent mechanically (§5
restricts directly declared bodies; fulfilment runs the §4.2 variance
walker, which handles unions; deferred occurrences are recorded, not
judged) — but it makes the alias-fulfilment route a loophole through §5,
and that route is now **the only spelling of recursive generic sums**.
Ruling needed:

- (a) **Bless and pin**: arguably principled — the alias keeps the union
  out of any variance-verified body and the nominal members stay opaque.
  If blessed, add a test pinning the route so a future §5 tightening
  cannot silently break recursive sums.
- (b) **Close**: recursive generic sums become unwritable until sugar
  exists (non-generic sums unaffected — no type variables, §5 not in play).

### 2.3 Exhaustiveness checking

Per-scrutinee exhaustiveness over a detected sum is sound and closed: the
union lists its members. Fires at canonicalization when the scrutinee's
static type is known; degrades to the existing runtime no-match error
value otherwise (consistent with there being no separate static pass).
For untagged unions, arms dispatch on runtime type tests and exhaustiveness
becomes type-coverage reasoning — feasible, heavier machinery, lower
priority.

### 2.4 Sum-declaration sugar (mid term, modest priority)

`type json = jnull | jbool(boolean) | … | jarr(list<json>)` desugaring to
the N variant declarations + 1 alias. With detection + forward refs
covering expressiveness (conditional on ruling 2.2 (a)), sugar buys:
one statement instead of N+1; a variant set closed *by declaration*; the
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

Two distinct gaps stand between today and a user-facing `mappable`:

- **Constraint**: "a type that supports map" as a bound. Bounds today are
  ground types only.
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

## 5. Higher-kinded types and rank-2 (long term, gated)

For genuine Functor/Monad abstraction, in dependency order:

1. **Higher-kinded type parameters** — `F` ranging over type constructors
   (`forall F, A, B. (F<A>, (A) -> B) -> F<B>`). Explicitly out of scope
   in the parameterized-nominal design; all current quantifiers are
   kind-`*`. Without HKT, protocols still deliver conformance and
   existentials, but `Map`-like signatures stay constructor-erased
   (`-> indexed_collection`) — HKT and protocols pay off together.
2. **Rank-2 quantification**, if protocols become first-class
   dictionaries: a `mappable` witness is `record<map: forall A, B. …>`
   and any function taking one is rank-2. (Rank = where `forall` nests
   left of arrows = who instantiates; orthogonal to kind. Also enables
   scope-enforcement types à la `runST`/`withFile`, where the nested
   quantifier makes resource escape a type error.) Inference: rank-2 is
   barely decidable, rank-3+ undecidable — annotation-required in
   practice, which fits Epsil's explicit-annotation posture.

Neither is committed. The trigger would be demand for user-defined
container/functor abstractions that the blessed-concrete-monads posture
(§1) cannot absorb.

## 6. Open rulings and questions

1. **§2.2**: bless-and-pin or close the forward-ref-to-alias route for
   recursive generic sums. Load-bearing; decide before documenting sums.
2. Sum sugar (§2.4): adopt a desugaring form? Variants scoped to the sum?
3. `match` over untagged unions (§2.3): type-test patterns +
   type-coverage exhaustiveness — wanted?
4. D11 amendment (§3): land with (or before) constructing/reading values
   of parameterized nominal types in compiled code.
5. JSON-null vs absence (§2.1): recommend the `jnull`-tagged hybrid in
   docs/examples, or accept the conflation?
