# Parameterized nominal types — `type tree<T> = tuple<value: T, children: list<tree<T>>>`

Status: **RULED v3 + IMPLEMENTED** (all 5 phases + N11/N12 follow-ups),
2026-08-06. N1–N12 are settled and
folded into the prose below; §11 keeps the record and the two rulings whose
stated premise did not survive verification. Every claim about the current
implementation was re-checked against the tree on 2026-08-06, after the
recursive-type and forward-reference work landed. Fills the
`type-variables-unsupported` slot reserved by
the base `type` statement (2026-08-01) and named as a non-goal by
[`2026-08-01-type-variables-design.md`](./2026-08-01-type-variables-design.md)
§9.2 ("**nominal** parameterized types OUT (need variance rules)") and
[`2026-08-04-generic-type-aliases-design.md`](./2026-08-04-generic-type-aliases-design.md)
§1. This doc supplies the variance rules that non-goal was waiting on.

## 1. Why this and not recursive generic aliases

A recursive parametric container — `Tree<T>`, `Json`-with-payload, a rose tree,
a zipper — is expressible in neither form today:

```cortex
type alias Tree<T> = tuple<T, list<Tree<T>>>
// generic-alias-self-reference: "a generic alias is expanded eagerly, so its
//   body has no definition to expand into yet"

type tree<T> = tuple<T, list<tree>>
// type-variables-unsupported
```

The two paths are **not** equally expensive, and the asymmetry is the whole
argument for doing the nominal one:

- A **generic alias is transparent**, so an applied reference must be
  *expanded* to be understood. Recursion makes eager expansion diverge, so
  supporting it means introducing an applied-reference node that survives into
  the `Type` representation and teaching every consumer to expand it lazily and
  coinductively. That directly gives up the property that made generic aliases
  cheap: *"No applied-reference node exists in the `Type` representation;
  nothing downstream (subtype, widen, compile, `Type` serialization) ever meets
  one — zero unfold-site changes"* (generic-alias design §1).

- A **nominal type is opaque**, so an applied reference is *never expanded* for
  subtyping. `tree<A> <: tree<B>` is decided by name plus an argument-wise
  comparison. Recursion is then free: the body is consulted only when
  constructing a value, reading a field, or matching — all finite, one-level
  operations. **Opacity is exactly what removes the hard part.**

The price is the one thing opacity cannot supply for free: a rule for relating
`tree<A>` and `tree<B>`. That is variance, and §4 is the bulk of this document.

Non-goal, unchanged: recursive generic **aliases**. If they are ever wanted,
this milestone does not bring them closer — it deliberately routes around them.

## 2. Scope

```cortex
type tree<T> = tuple<value: T, children: list<tree<T>>>   // declaration
let t = tree(1, [tree(2, [])])                            // T solved at the call
let u: tree<number> = t                                   // annotation
t.value                                                   // ➔ 1  : integer
match t { tree(v, cs) => v }                              // binds at the VALUE's own type
type tree<out T> = …                                      // explicit variance (redundant for tree; N2)
```

```js
ce.declareType('tree', 'tuple<value: T, children: list<tree<T>>>', {
  typeParams: [{ name: 'T', variance: 'out' }],
});
```

In scope: declaration with a type-parameter clause, ground bounds on
parameters (reusing the alias rule), recursion through the body, a generic
minted constructor, field access and `match` at an instantiated type,
subtyping with declared variance, serialization round-trip, compile erasure.

Out of scope: use-site variance (Java wildcards), higher-kinded parameters,
default type arguments, variance on generic *aliases* (transparent — variance
is a property of the expansion, not a declaration), F-bounded parameters
(`tree<T: comparable<T>>`, blocked on §9.2's variable-referencing bounds),
partial application.

## 3. Representation

`TypeReference` gains an optional argument list; the stored declaration record
gains parameter descriptors:

```ts
type TypeReference = {
  kind: 'reference';
  name: string;
  alias: boolean;
  def: Type | undefined;
  typeParams?: TypeParam[];      // on the DECLARATION record (exists today)
  args?: Type[];                 // NEW — on an APPLIED reference
};

type TypeParam = {
  name: string;
  bound?: Type;                  // ground, as today
  variance?: 'in' | 'out' | 'inout';   // default per N2
};
```

An applied nominal reference **keeps** its `args` — it is never expanded. This
is the one representation change, and it is confined to nominal references:
generic aliases keep expanding eagerly and never produce an `args`-bearing
node, so their zero-unfold-site property is preserved verbatim.

**Consumer survey** (verified 2026-08-06): 13 sites across 7 files match
`kind === 'reference'` — `subtype.ts`, `utils.ts`, `primitive.ts`,
`type-builder.ts`, `collections.ts`, `function-literal.ts`, `effects-of.ts`.
Most treat a nominal reference as opaque and need **no** change, because
opacity is already their answer. The ones that do:

| Site | Change |
|---|---|
| `subtype.ts` — nominal reference comparison | name equality → name + variance-aware argument comparison (§4.3) |
| `subtype.ts` — `provablyDisjoint` | **no change**: two applications stay conservatively overlapping (see below) |
| `parse.ts` / `type-builder.ts` | parse `tree<integer>`; arity + bound check at application |
| `serialize.ts` | print `tree<integer>`, not bare `tree` |
| `instantiate.ts` | **every** walker, not just substitution — see below |
| `engine-declarations.ts` | accept a clause on the bare form; mint a generic constructor (§5) |
| `type-constructors.ts` — D14a arm-overlap check | instantiate the quantified raw arm at a ground skeleton before `provablyDisjoint` (§5) |

The `type-constructors.ts` row is not among the 13 `kind === 'reference'`
sites — its exposure is through `provablyDisjoint`'s ground-inputs contract,
not a direct match on the node — which is exactly why it was missed on the
first survey.

`resolveTypeForCompilation` (compile erasure) needs no change: it already
unfolds a nominal reference to its definition, and the definition is now
instantiated first (§7).

**`provablyDisjoint` must NOT read disjointness off the arguments.** Invariance
says `tree<A>` and `tree<B>` do not *subtype* each other; it does not say their
inhabitants are disjoint, and `provablyDisjoint` feeds negation subtyping
(`A <: !B`), where over-claiming is unsound. A body can have common inhabitants
for disjoint arguments — one combining `list<T>` with a contravariant
`(T) -> nothing` field is inhabited by an empty list plus an `any` callback at
both instantiations. Two applications therefore stay conservatively
overlapping unless disjointness is proven from the instantiated body. §10 pins
this with the witness, so a later "optimization" cannot quietly reintroduce it.

**`instantiate.ts` needs more than substitution.** An applied reference can
carry type variables, so free-variable detection, declaration validation,
ground-skeleton construction and the solver's pattern walk must all traverse
`args` — the latter respecting the referenced parameter's variance. Without
that, `forall T. (tree<T>) -> T` reads as ground, and a constructor whose only
constraint on `T` arrives through another nominal application leaves `T`
unsolved. So §5's "no new solver work" is too strong: the rank-1 solver needs
an applied-reference unification rule, even though the *inference algorithm*
is unchanged.

**Phase 0 owns this, not Phase 1.** The walkers go wrong the moment `args` can
carry a variable — free-variable detection misreads `forall T. (tree<T>) -> T`
as ground whether or not subtyping has changed — so a Phase 0 that shipped
`args` alone would be internally inconsistent. The test whose sole constraint
on a variable sits inside a nominal reference argument belongs there too.

### 3.1 Surface and encoding of the clause

The variance marker is part of the type-parameter clause, so three surfaces
carry it and must agree:

| Surface | Spelling |
|---|---|
| Cortex statement | `type tree<out T> = …` |
| Host API | `typeParams: [{ name: 'T', variance: 'out' }]` |
| `Type()` / `DeclareType` MathJSON | the clause CONTENTS, bracket-free: `{"str": "out T"}` |

The MathJSON encoding is the **source clause text without the enclosing
`<`/`>`**, matching exactly how the existing `type alias Pair<T>` clause is
already carried (`typeParams -> "T, U: number"` — `parseTypeParameterClause`
takes the clause *contents*; the brackets are consumed by the surrounding
parser and are not part of the string). A marker is just more clause text, so
no new node shape is needed and the round-trip is textual.
`parseTypeParameterClause` is extended **once**, for both the alias and
nominal callers, to accept an optional leading `in`/`out`/`inout` keyword per
parameter. An applied reference serializes as `tree<integer>`; the marker
appears only at the declaration, never at an application.

Unannotated means `out` — treated as if declared, and verified (§4.4). All
three spellings are writable — `in`, `out`, `inout` — and a redundant `out` is
legal so a generated declaration need not special-case the default.

## 4. Variance

### 4.1 Why a default of invariance is wrong here

Variance is unsound in the presence of mutation — the Java array store problem.
**Cortex values are immutable**: there is no field assignment, and a
constructed value is rebuilt, never updated in place. So the classic reason to
default to invariance does not apply, and defaulting to it would make
`tree<integer>` unusable where `tree<number>` is expected — the single most
common thing a user will try.

But blanket covariance is *also* wrong, because a payload may contain a
function: for `type handler<T> = tuple<run: (T) -> nothing>`, a
`handler<number>` is safely usable as a `handler<integer>`, not the reverse.
So variance must be derived from **where the parameter occurs in the body**.

### 4.2 Position analysis

Assign each occurrence of a parameter a position, starting covariant (`+`) at
the root of the body, and compose on the way down:

| Body form | Position of the nested type |
|---|---|
| `tuple<…, x: S, …>`, `record<…, x: S, …>` | same as enclosing |
| `list<S>`, `set<S>`, `dictionary<S>`, `collection<S>` | same as enclosing |
| `(P₁, …, Pₙ) -> R` | `Pᵢ`: **flipped**; `R`: same |
| `S₁ \| S₂`, `S₁ & S₂` | same as enclosing |
| `!S` | **flipped** |
| `other<S>` (applied reference) | composed with `other`'s declared variance for that parameter |

Composition is the standard sign algebra, with invariance absorbing:

```
        │ out(+)  in(−)   inout(±)
────────┼──────────────────────────
same    │ out     in      inout
flipped │ in      out     inout
```

A parameter occurring in both a `+` and a `−` position is `inout` (invariant).
A parameter occurring in **no** position is rejected — the same
unused-parameter rule generic aliases already enforce, for the same reason
(under any variance, a phantom parameter makes `tree<integer>` and
`tree<string>` indistinguishable yet unequal).

Worked example, the tree:

```
type tree<T> = tuple<value: T, children: list<tree<T>>>
  value: T          → tuple(+) → T at +
  children          → tuple(+) → list(+) → tree<T> at +
                    → composed with tree's own variance for T … (recursive)
```

The recursive occurrence needs a fixed point: **assume** the declared (or
candidate) variance, check the body under that assumption, and accept if the
assumption survives. This is the standard coinductive variance check, and it
terminates because the assumption is fixed before descending. With `out T`
assumed, the recursive `tree<T>` at `+` composes `out ∘ out = out`, consistent.
So `type tree<out T>` is well-formed, and `tree<integer> <: tree<number>`.

**Mutual recursion and forward references.** The fixed point above assumes the
variance of the type being checked; a body that reaches *another* parameterized
nominal needs that one's variance too, and it may not exist yet — mutually
recursive declarations, or a body naming a forward reference (reachable since
forward-reference completion landed):

```cortex
type tree<T> = tuple<value: T, children: type forest<T>>   // forest: forward ref, created by use
type forest<T> = list<tree<T>>                             // fulfilment
```

(The `type` prefix is the existing forward-reference spelling inside a body —
it is what distinguishes "not declared yet, install a forward record" from a
plain unknown-type error.)

(There is no bodyless forward-*declaration* syntax: a forward reference is
created by an applied use of a not-yet-declared name. Today the machinery
records forward references as **bare** and rejects fulfilling one as generic
— "a forward reference … takes no type arguments". This design replaces that
restriction: an applied use records its argument count, and fulfilment
checks the declared arity against every recorded use — a mismatch is the §8
arity diagnostic.)

The rule (**ruled C**, 2026-08-06 — replacing an earlier draft that judged
the unfulfilled occurrence pessimistically at the declaration, which under
the default-`out` revision would have made unannotated mutual recursion
impossible to write):

- A reference whose declaration is **known** composes with its declared
  variance, per the §4.2 table.
- A reference to a **forward-declared, unfulfilled** name has no variance
  yet, so the declaration's verification **defers**: occurrences under it are
  recorded, not judged, and the declaration is accepted provisionally under
  its (default or written) variance. No early error — the `tree`/`forest`
  pair above is written unannotated, in either order.
- **In the window** between a provisional acceptance and fulfilment, any
  subtype judgment that would consult the not-yet-verified variance treats it
  as `inout`. An answer given under invariance stays sound under whatever
  variance fulfilment reveals, so nothing recorded in the window ever needs
  invalidating. (The window is also value-free: the constructor needs a value
  of the unfulfilled type, which cannot exist yet.)
- Composition through a reference that has a body but is **not yet
  verified** distinguishes two cases (refined during the post-review fix
  round): if the reference is merely *group-unverified* — its blockers all
  have bodies — it composes with its **declared** variance, which is exactly
  the coinductive group check (deferring here would deadlock mutual
  recursion); only a reference **transitively blocked on a def-less forward
  reference** makes the dependent defer too, preventing the laundering of an
  unverified variance through a wrapper type.
- **At fulfilment**, the strongly-connected group is verified together, each
  member under its own declared or default variance, and success unlocks the
  declared variance for subtyping. A fulfilment that makes a
  provisionally-accepted declaration unsound is a `variance-violation`
  attributed to the *original* declaration, with the §4.4 message shape and
  naming the fulfilment that triggered it. Declared variance is what makes
  the group check terminate: no member's variance is being solved, only
  verified. The failing *operation* is the **fulfilling declaration**: it
  throws and rolls back atomically, exactly as any failing declaration does,
  while the original stays provisional — the message is *attributed* to the
  original declaration, but the *rejected statement* is the fulfilment. (The
  alternative — fulfilment succeeds and the original is retroactively
  invalidated — has no rollback story and no precedent in the declaration
  machinery.)
- A **never-fulfilled** forward reference means the verification simply never
  completes — harmless, because the type is uninhabitable and unusable for
  the same reason; dangling declarations belong to the existing
  forward-reference machinery, not to variance.

**Inference would not help here.** Inferring variance needs the same
polarity information verifying does, so an inference-based checker faces the
identical deferral: it cannot compute `tree`'s variance until `forest` has a
body either (and for a mutual group it needs a least-fixed-point iteration
where verification needs a single pass). The only difference is at
fulfilment: inference would silently flip the type's contract where
verification errors loudly at a named declaration — the same N2 trade, one
step removed.

**Statement redeclaration (N12, ruled post-implementation).** A Cortex `type`
statement re-declaring a statement-declared name (the notebook re-run flow;
host `declareType` still throws, the engine-wide convention) is an
**in-place update of the existing record** — the same mechanism as forward
fulfilment — so every captured reference and every applied node's `decl`
back-pointer follows the new definition. The alternative (swapping the record
object) made `A <: B` depend on when each node was parsed and gave mutually
recursive sets a one-run notebook lag. Dependents FOLLOW (A8's snapshot
ruling covered eagerly-expanded generic aliases, which hold no pointer; it
does not extend to opaque references). The redeclaring statement is
re-verified against every dependent that mentions the record: a stale-arity
application is `generic-alias-arity`, a variance annotation made unsound is
`variance-violation` — both attributed to the dependent, naming the
redeclaration as trigger, and both fail the redeclaring statement with
snapshot-and-restore rollback (the prior definition, clause, variance state
and minted constructor all come back).

### 4.3 The subtype rule

```
tree<A₁…Aₙ> <: tree<B₁…Bₙ>
  iff for each i, according to the declared variance of parameter i:
        out    → Aᵢ <: Bᵢ
        in     → Bᵢ <: Aᵢ
        inout  → Aᵢ ≡ Bᵢ   (mutual subtyping)
```

Two different nominal names never relate, exactly as today. **No body is
consulted**, so recursion needs no guard at this site at all — the recursion
lives in the arguments, and those are finite.

Note this leaves the existing nominal rule intact as the zero-parameter case:
`tree <: tree` by name, which is what `subtype.ts` does today.

### 4.4 What is declared

**Variance ships in v1.** The alternative — invariant-only, widened later —
would be compatible (invariance is the most restrictive rule, so relaxing it
cannot break a program), but `tree<integer>` not being a `tree<number>` is the
first thing every user hits, so deferring it mostly defers the complaint. The
position analysis is ~80 lines and the subtype rule ~15.

**Variance is verified, never inferred — and rarely written.** Every
parameter has a declared variance: the marker the author wrote, or `out` when
none is spelled (below) — so a marker is needed only for the non-covariant
minority. The position analysis **verifies** that variance against the body;
it never *produces* one from the body. Inference would be zero syntax and
always maximally permissive, but a body edit would silently change the type's
subtyping contract with nothing at the declaration site mentioning variance —
an API hazard. Verification needs the same analysis inference would, so
adding inference later stays available. A violated annotation is a
`variance-violation` naming the offending occurrence.

The hazard, concretely:

```cortex
type events<T> = tuple<log: list<T>>
// T occurs only covariantly: events<integer> is usable as events<number>

// … a later, innocent-looking edit adds a subscription callback:
type events<T> = tuple<log: list<T>, notify: (T) -> nothing>
```

Under **inference**, the first form infers `out` and the edit silently
re-infers `inout` — the correct, maximally permissive answer both times. But
every caller that passed an `events<integer>` where an `events<number>` was
expected is now broken, the failures surface at the *use sites* (possibly in
downstream code the author never sees), and nothing at the declaration so
much as mentions variance. Under the **verified default**, the same edit
fails at the declaration itself: the implicit `out` no longer survives the
position analysis, and the `variance-violation` names `notify: (T) ->
nothing` as the offending occurrence. The author then makes the contract
change deliberately and visibly — annotate `inout` (or `in`, after splitting
the type) — instead of shipping it by accident.

**What the author sees.** The verifier has already computed every
occurrence's polarity, so the diagnostic is prescriptive, not just
accusatory. For the edited `events` above:

```
variance-violation: parameter `T` of `events` is covariant (`out` is the
default when no marker is written), but `notify: (T) -> nothing` uses `T`
in an input position. `T` appears in both output (`log`) and input
(`notify.(arg 1)`) positions, so it can only be invariant.
  • declare it `inout`:  type events<inout T> = …
    (an events<integer> is then no longer usable as an events<number>)
  • or keep events covariant by moving the input occurrence out of the
    body — split it off into a type of its own
```

(The occurrence is named by the composed path — `notify.(arg 1)`, per the
ruled path grammar — and the as-implemented remedy phrasing is shown; the
implementation and this example are aligned as of the post-review pass.)

Three parts, all computed rather than guessed:

- **Which variance was violated and where it came from** — the written
  marker, or the `out` default. An author who has never heard of variance
  learns that the default exists at the moment it first matters.
- **The offending occurrence(s), by path** (`notify`), not just the type
  expression they sit in. Path syntax: named fields and tuple elements by
  name, unnamed positions as `[0]`, signature parameters as `(arg 1)`,
  nested steps joined with `.`.
- **The remedy set — exactly the markers that would verify.** The analysis
  joins every occurrence's polarity; the join is the most permissive marker
  the body admits, and that is what the message suggests (here `inout`; for
  a body that had become pure-input under a mistaken `out`, it would be
  `in`). Markers outside the set are never offered — `in` is not suggested
  for `events`, because `log: list<T>` would fail it the same way. The
  structural alternative — restructure the body so the polarity the author
  wants is actually true — is listed last, since only the author knows
  whether the wider subtyping is worth the split.

**Unannotated means `out`, verified** (revised 2026-08-06, from
invariant-default). An unannotated parameter is *treated as declared* `out`
and run through the same verification pass as an explicit annotation; a body
with a contravariant occurrence fails with a `variance-violation` telling the
author to write `in` or `inout` explicitly. Rationale: §4.1's own argument —
in an immutable value language the common case is a payload container, and an
invariant default makes `tree<integer>` unusable where `tree<number>` is
expected, the first thing every user tries. This is not inference: absence of
a marker *declares* `out`, so the hazard that ruled out inference cannot occur
— a body edit that would change the subtyping contract surfaces as a loud
error at the declaration, never as a silent contract change. Only
non-covariant types pay an annotation, exactly where explicitness earns its
keep. An `inout` annotation verifies against **any** body — invariance
promises nothing, so it is always sound, just less permissive — which makes
it the universally available opt-out the diagnostics can always suggest.

**The spelling is `in` / `out` / `inout`** (Kotlin/C#), not `+T`/`-T`
(Scala/OCaml) — Cortex already uses word-like type syntax, and `+T` collides
visually with type-level `|`/`&`. Neither word becomes reserved: they are
claimed only inside a type-parameter clause, exactly as `alias` is claimed only
in statement position.

**Bounds and variance do not interact.** `type tree<out T: number>` is sound
and allowed — the bound constrains which arguments are admissible, the variance
relates two admissible ones.

## 5. The constructor

A `tuple` body mints an n-ary constructor today. The parameterized form mints a
**quantified** one:

```
type tree<out T> = tuple<value: T, children: list<tree<T>>>
  ⇒ tree : forall T. (T, list<tree<T>>) -> tree<T>
```

`deriveConstructorSignature` currently declines a parameterized body with an
explicit carve-out, because "the unmarked default builds an open signature and
`BoxedType`'s closedness throw aborts the whole declaration" (generic-alias
design §1). That is precisely the fix: emit a `forall`-quantified signature
instead of an open one. The rank-1 call-site solver that shipped with generic
function literals (2026-08-04) then instantiates `T` per construction — the
inference *algorithm* is unchanged, but it does need the applied-reference
unification rule and the `instantiate.ts` walker coverage from §3, without
which a `T` constrained only inside a nominal argument never gets solved.

**The quantified arm must be grounded before the D14a overlap check.** The
user-constructor-arm mechanism (D14a) detects overlap between the raw minted
arm and a user arm via `provablyDisjoint`, which requires **ground** inputs —
and that requirement is guarded only by a `console.assert`, stripped in the
production build, so a violation is silent wrongness, not a crash. Raw arms
were always ground until this design; a `forall`-quantified arm must
therefore be instantiated at a ground skeleton (the same ground-skeleton
construction §3 requires of `instantiate.ts`) before the disjointness call,
and the skeleton must never let disjointness be derived from the type
variable alone.

**An unsolvable `T` is a diagnostic, not a default.** `tree(1, [])` solves
`T = integer` from the first argument, but a body where `T` appears only in a
position no argument constrains — or a nullary constructor — leaves it unsolved.
That is `unsolvable-type-variable`, the existing signature-rule diagnostic
class. The trigger is **declaration-time**: the reachability check catches
result-only shapes, and a minted constructor derives its args from the body,
so a parameter unreachable from the args is caught even earlier as unused. A
**call-site** diagnostic was considered and **rejected on empirical
evidence** (2026-08-06, Phase 2): an empty-collection witness does not leave
`T` unsolved — `bag([])` solves `T = never`, the sound most-specific
instantiation (under `out` it is the bottom of the family, exactly like an
empty list literal) — and the only genuinely-unbound case is an operand of
type `unknown` (an unannotated lambda body constructing the nominal), where
erroring would reject every such lambda. Those propagate `unknown` honestly
(`tree<unknown>`), consistent with generic function application.

**Explicit instantiation (`tree<number>(1, [])`) is deferred — its original
justification did not survive verification, and the residue is ruled (c)
below.** The reasoning was that an annotation already covers the case
*provided the solver propagates the expected type inward*. Probed against the
generic machinery that shipped 2026-08-04, it does not:

```
idf(1)                  ->  finite_integer     // solved from arguments alone
let v: number = idf(1)  ->  finite_integer     // the annotation does not widen it
```

So `let t: tree<number> = tree(1, [])` constructs a `tree<finite_integer>` and
then needs `tree<finite_integer> <: tree<number>` — which holds **only because
`tree` is `out`** (the verified default, §4.4). For an explicitly `inout` (or
`in`) parameter the annotation cannot cover it, and there is no way to
construct a value at a wider argument type at all.

With `out` as the verified default this affects only types that opted out of
covariance, so the ruling (2026-08-06) is **(c)**: an explicitly invariant or
contravariant parameterized nominal is constructed at exactly its argument
type, and that limitation is documented. The options weighed, for the record:

- **(a) Propagate the expected type inward** at a construction site whose
  binding is annotated. Fixes the general case, touches the solver.
- **(b) Ship explicit instantiation** after all, reversing the deferral. Narrow
  and local, but new syntax.
- **(c) Accept the limitation** and document that an invariant parameterized
  nominal can only be constructed at exactly its argument type.

(a) remains the eventual fix — it is the behavior users expect from an
annotation, and it benefits every generic call, not just constructors — but
under the default-`out` revision it is a follow-up improvement, not a v1
gate. (b) also stays open.

A `record` body still mints nothing (D4b, unchanged) — a constructor function
supplies it, and it may be generic by the same rule. That composition needs
**no new binding contract**: the constructor function is an ordinary generic
function literal whose type-parameter clause is its own — its variable names
need not match the type's `typeParams` (they are alpha-irrelevant), the
type's clause is **not** in scope inside the function, and a function clause
carries no variance (variance is a property of the type declaration; a
function's parameters are solved per call, not related by subtyping). The
only contract runs through the function's **result type**, which must be an
application of the nominal (`tree<T>`, `tree<integer>`, …) checked by the
ordinary rules of this design — wrong arity there is the §8 arity
diagnostic, and the D14a overlap check applies per the grounding rule above.

**Union positions — Rule U (N11, ruled post-implementation).** The rank-1
restriction that rejected a type variable under a union arm was a v1 fence
("bespoke inference rules… future work"), not a soundness result, and it made
`type opt<T> = T | missing` — the optional payload, the most natural
parameterized body — undeclarable while `record` bodies and `mint: false`
declarations sailed through (only the *minted constructor signature* was ever
checked). It is lifted for all rank-1 polytypes: at most one union arm may
mention type variables (a `T | U` union is unsolvable by construction and
stays rejected); at a call, an actual accepted by a ground arm binds the
variables to `never` — the bottom of the family, matching `bag([]) → never` —
and otherwise the single open arm solves and refutes as usual. Contravariant
union positions contribute no bound in v1 (admission is re-gated against the
instantiated parameter after solving). Intersections stay rejected with a
message that steers to the replacement spelling, a bound (`forall T:
number.`); negations stay rejected.

One nuance, **reviewed and accepted as-is** (2026-08-06): the `T = never`
ground-arm binding is "the bottom of the family" only under `out`. Under an
`in` parameter, `X<never>` is the family's *top* — the constructed value is
sound (failures go toward rejection) but unusable at any other
instantiation. Contravariant parameterized unions are rare enough that this
stands; revisit on user demand rather than pre-emptively special-casing the
bind by declared variance.

## 6. Field access and `match`

Field access reads the body **instantiated at the reference's arguments**;
`match` binds each capture at the matched **value's own** type (usually
narrower — with `t` constructed at `finite_integer`, `v` binds `integer`-ish,
not the annotation's `number`; sound under `out`, and ruling (c) forces
exactness under `inout`). The doc examples reflect this:

```cortex
let t: tree<integer> = tree(1, [])
t.value                        // instantiate tuple<value: T, …>[T := integer] → integer
match t { tree(v, cs) => … }   // v, cs bind at the matched VALUE's own type
```

This is one substitution against a finite body, using the existing
`substituteTypeVariables`. Recursion is not a problem: the substitution is
one level deep, and the nested `tree<integer>` stays an unexpanded reference.

**A bare `tree` is an arity error**, not `tree<unknown>` — the same rule
generic aliases already apply. One rule for both forms is easier to teach than
two. (This does not disturb the zero-parameter case: a `type point = …` with no
clause is unaffected, and `point <: point` by name as today.)

## 7. Compilation

Nothing new. Phase 2 of the nominal-types work made compilation **erase** the
tag: a constructor application compiles where the equivalent plain value
compiles. `tree<integer>` erases to whatever `tuple<integer, list<…>>` compiles
to, and declines identically where that would. `resolveTypeForCompilation`
already unfolds nominal references; it gains a substitution step so the
unfolded body is instantiated at `args` first.

## 8. Diagnostics

| Condition | Code |
|---|---|
| clause on a bare `type`, this milestone absent | `type-variables-unsupported` (existing — retired by this work) |
| annotation violates the position analysis | `variance-violation` (new; message content specified in §4.4 — origin of the violated variance, occurrence by path, computed remedy set) |
| parameter never used in the body | `generic-alias-unused-parameter` (existing — rename or share, N8) |
| applied with wrong arity, or bare | `generic-alias-arity` generalized |
| argument fails a parameter bound | `generic-alias-bound` generalized |
| `T` unsolvable at a construction site | `unsolvable-type-variable` (existing) |

The alias codes are **shared, not twinned**: the user-facing condition is
identical and the names are already generic-ish, so the messages are
generalized to cover both forms rather than duplicated.

## 9. Phasing

0. **Representation** — `args` on `TypeReference`, `variance` on `TypeParam`;
   parse and serialize `tree<integer>` and the `<out T>` clause (§3.1); arity
   and bound checks at application; applied **forward references** record
   their argument count and fulfilment checks arity against every recorded
   use, replacing today's "a forward reference cannot be declared generic"
   restriction (§4.2); **the full `instantiate.ts` walker coverage from §3**
   — free-variable detection, declaration validation, ground-skeleton
   construction, and the solver's applied-reference unification rule. No
   subtyping change yet (invariant by name+args). Round-trip tests.
1. **Variance** — position analysis, the `out`/`in` clause syntax, the
   `variance-violation` check, the §4.3 subtype rule. Fixed-point handling for
   the recursive occurrence, and the §4.2 forward-reference rule (C): deferred
   declaration checks, `inout`-conservative window judgments, group
   verification at fulfilment.
2. **Constructor** — quantified signature from `deriveConstructorSignature`,
   call-site solving, `unsolvable-type-variable`, and the §5 ruling **(c)**:
   an explicitly `inout`/`in` parameterized nominal constructs only at exactly
   its argument type, documented. (a) inward propagation stays open as a
   follow-up.
3. **Elimination** — `.field` and `match` at the instantiated body.
4. **Compile + docs** — substitution in `resolveTypeForCompilation`;
   `doc/08-guide-types.md`, `src/cortex/docs/types.md`, CHANGELOG.

Phases 0–1 are independently landable and already make annotations useful;
2–3 are what make the type *inhabitable* from a program, so they should ship in
one release train (the same rule Phase 0–2 of the nominal work followed:
"decline is never a released state").

**The recursive-alias non-goal stays closed.** This design routes around it: a
recursive parametric type is spelled *nominally*. If recursive generic aliases
are ever wanted they still need applied-reference nodes plus coinductive
expansion at every consumer — none of which this milestone brings closer. Open
to revisiting on user feedback.

## 10. Test obligations

- Variance: `tree<integer> <: tree<number>` under `out` and under the
  unannotated default, the reverse under `in`, neither under explicit `inout`;
  `variance-violation` on `type h<out T> = tuple<run: (T) -> nothing>` **and**
  on the unannotated `type h<T> = tuple<run: (T) -> nothing>` (default-`out`
  verification fails; the message suggests `in`/`inout`); the recursive fixed
  point accepts `out T`.
- **Diagnostic content (§4.4):** the `variance-violation` on the unannotated
  `events` body names the occurrence by path (`notify`), states that the
  violated `out` came from the default, and suggests exactly `inout` — never
  `in`; a body whose occurrences are all input positions under a mistaken
  `out` suggests `in`.
- Recursion: a 3-deep tree constructs, `.value` and `match` read at each level,
  a `map` over it (the §1 motivating program) evaluates.
- Route parity: host `ce.declareType` and the Cortex statement agree; box and
  parse routes both register.
- Serialization: `tree<integer>` round-trips through `Type()` and the
  `DeclareType` encoding.
- Regression: the existing recursive **non**-generic tree keeps working, and
  generic aliases still expand eagerly with no `args` node reaching any
  consumer.
- **Disjointness (§3):** `provablyDisjoint` does NOT report two applications of
  the same nominal as disjoint, pinned with the witness — a body combining
  `list<T>` with a contravariant `(T) -> nothing` field, inhabited by an empty
  list plus an `any` callback at two disjoint arguments. Over-claiming here
  feeds negation subtyping and is unsound, so this test exists to stop a later
  "optimization" reintroducing it.
- **Forward references and mutual recursion (§4.2, ruling C):** the
  unannotated `tree`/`forest` pair is accepted without error in either order;
  in the window before fulfilment a subtype judgment consulting the
  unverified variance is answered as `inout` (`tree<integer> <: tree<number>`
  is NOT granted yet) and the same judgment succeeds after fulfilment; a
  fulfilment that makes a provisionally-accepted declaration unsound (fulfil
  `forest` with a contravariant body) produces a `variance-violation`
  attributed to the ORIGINAL declaration and naming the triggering
  fulfilment. A mutually recursive pair (`a<T>`/`b<T>`) is verified as a
  group at the last fulfilment.
- **Clause encoding (§3.1):** `type tree<out T> = …` round-trips through
  `Type()` and `DeclareType` with the marker intact and the clause carried
  **bracket-free** (`"out T"`, matching the alias format); an *applied*
  reference serializes without one; a redundant `out` is accepted and
  preserved.
- **Arm overlap under quantification (§5):** the D14a overlap check runs
  against the quantified raw arm of a parameterized record-bodied nominal
  without violating `provablyDisjoint`'s ground-inputs contract — the arm is
  instantiated at a ground skeleton first — and never derives disjointness
  from the type variable alone.
- **Record-body generic constructor (§5):** a user constructor function whose
  clause uses a *different* variable name than the type's `typeParams`
  constructs successfully (alpha-irrelevance), and one whose result type
  applies the nominal at the wrong arity gets the §8 arity diagnostic.
- **Construction at a widened type (§5):** `let t: tree<number> = tree(1, [])`
  under `out T` (and unannotated — the same thing), and the same under an
  explicit `inout` parameter — expected outcome per ruling (c): a type error,
  the documented limitation. This is the test that fails the original
  assumption, so it must exist before Phase 2 closes.

## 11. Ruling record (N1–N12)

Folded into the prose above; kept here so the alternatives that were weighed
are not lost.

| # | Question | Ruling |
|---|---|---|
| N1 | Variance in v1? | **Yes** — §4.4 |
| N2 | Declared, inferred, or both? | **Verified, never inferred — and rarely written**: unannotated = **`out`, verified** (revised v3 — a contravariant occurrence under the default is a loud `variance-violation`, so no silent-contract hazard; a marker is needed only for the non-covariant minority). Inference stays available later — §4.4 |
| N3 | Spelling | **`in` / `out` / `inout`**, contextual inside the clause only — §4.4 |
| N4 | Variance × bounds | **Allowed, no interaction** — §4.4 |
| N5 | Unsolvable `T` | **`unsolvable-type-variable`**, not a default — §5 |
| N6 | Explicit instantiation | **Deferred — premise falsified**, then resolved by the v3 default-`out` revision: ruling is **(c)** for explicit `inout`/`in` parameters; (a) open as follow-up — §5 |
| N7 | Bare `tree` | **Arity error**, matching the alias rule — §6 |
| N8 | Share alias diagnostics? | **Share and generalize** — §8 |
| N9 | Recursive aliases | **Stay closed**; nominal is the spelling — §9 |
| N10 | Forward-reference window semantics (post-v3) | **C** — declaration checks defer to fulfilment (group-verified); window subtype judgments treat unverified variance as `inout` (sound forever, nothing to invalidate); late failure attributed to the original declaration — §4.2 |
| N11 | Union positions (post-implementation, 2026-08-06) | **Lifted — Rule U**, for all rank-1 polytypes: at most one union arm may carry variables; an accepting ground arm binds `T = never` (the family's bottom); the open arm solves and refutes; no contravariant contribution in v1. Intersection stays rejected (message steers to bounds), negation stays rejected. The §4.2 table's union row is now reachable for declared bodies, and `type opt<T> = T \| missing` is the flagship |
| N12 | Statement redeclaration (post-implementation, 2026-08-06) | **In-place record update** for `fromStatement` replacement (host `declareType` still throws — the engine-wide convention). Nominal dependents FOLLOW the new definition (A8's snapshot ruling covered eagerly-expanded generic aliases only; plain-alias reference nodes follow too). Dependent re-verification runs on the introducing statement: stale arity → `generic-alias-arity`, variance unsoundness → `variance-violation`, both attributed to the dependent, naming the redeclaration as trigger, and both FAIL the redeclaring statement with full snapshot-and-restore rollback |

Two rulings changed shape under verification, both recorded above: **N6**'s
justification was falsified by probe, turning a deferral into a Phase 2
obligation; and the `instantiate.ts` walker coverage moved from Phase 1 to
**Phase 0**, since the walkers break as soon as `args` exists.

v3 revision (2026-08-06, spec review): **N2**'s default flipped from
invariant to **`out`, verified** — §4.1 had already argued the invariant
default was wrong, and §2's flagship example only worked under `out`. The
unannotated form goes through the same verification as an explicit `out`, so
a contravariant occurrence is a loud `variance-violation` rather than a
silent contract change. With the flip, the §5 obligation shrinks to
explicitly non-covariant parameters and is ruled **(c)** (documented
limitation; (a) inward propagation open as follow-up).
