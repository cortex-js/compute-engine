# Parameterized nominal types — `type tree<T> = tuple<value: T, children: list<tree<T>>>`

Status: DRAFT v1, 2026-08-06. Nothing implemented. Decisions **N1–N9** need
rulings before phasing. Fills the `type-variables-unsupported` slot reserved by
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
match t { tree(v, cs) => v }                              // binds v: T, cs: list<tree<T>>
type tree<out T> = …                                      // declared variance (N2)
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
overlapping unless disjointness is proven from the instantiated body.

**`instantiate.ts` needs more than substitution.** An applied reference can
carry type variables, so free-variable detection, declaration validation,
ground-skeleton construction and the solver's pattern walk must all traverse
`args` — the latter respecting the referenced parameter's variance. Without
that, `forall T. (tree<T>) -> T` reads as ground, and a constructor whose only
constraint on `T` arrives through another nominal application leaves `T`
unsolved. So §5's "no new solver work" is too strong: the rank-1 solver needs
an applied-reference unification rule, even though the *inference algorithm*
is unchanged. Phase 1 owns this, with a test whose sole constraint on a
variable sits inside a nominal reference argument.

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

### 4.4 Decisions

- **N1 — is variance in v1 at all?** Alternative: ship invariant-only, add
  variance later (compatibly — invariance is the most restrictive rule, so
  widening it later cannot break a program). Cheaper, but `tree<integer>` not
  being a `tree<number>` will be the first thing every user hits.
  *Recommendation: variance in v1.* The position analysis is ~80 lines and the
  subtype rule is ~15; deferring it mostly defers the complaint.

- **N2 — declared, inferred, or both?**
  - *Declared* (`type tree<out T>`, Kotlin/C#/Scala): explicit, stable across
    body edits, good diagnostics, one new keyword-ish token in the clause
    grammar. Default when unannotated: **invariant**.
  - *Inferred* from the body: zero syntax, always maximally permissive, but a
    body edit silently changes the type's subtyping contract — an API
    hazard, and a confusing one because nothing at the declaration site
    mentions variance.
  - *Both*: infer when unannotated, verify when annotated.
  *Recommendation: declared, with the position analysis used to **verify** the
  annotation (a `variance-violation` diagnostic naming the offending
  occurrence). Unannotated = invariant.* Same shape as Kotlin, and the
  verification code is the same analysis inference would need, so `both` stays
  available later.

- **N3 — spelling.** `type tree<out T>` (Kotlin/C#) vs `type tree<+T>`
  (Scala/OCaml) vs `type tree<covariant T>`. *Recommendation: `out`/`in`* —
  Cortex already uses word-like type syntax, and `+T` collides visually with
  the type-level `|`/`&` operators. Neither `out` nor `in` becomes a reserved
  word: they are claimed only inside a type-parameter clause, exactly as
  `alias` is claimed only in statement position.

- **N4 — does variance interact with bounds?** A bounded covariant parameter
  (`type tree<out T: number>`) is sound (the bound constrains, the variance
  relates). *Recommendation: allow, no interaction.*

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

- **N5 — unsolvable `T`.** `tree(1, [])` solves `T = integer` from the first
  argument. But a body where `T` appears only in a position no argument
  constrains (or a nullary constructor) leaves `T` unsolved.
  *Recommendation: `unsolvable-type-variable`, the existing signature-rule
  diagnostic class,* rather than defaulting to `unknown` — a silently
  `tree<unknown>` value would fail confusingly at its first use.

- **N6 — explicit instantiation.** Allow `tree<number>(1, [])` to pin `T` when
  inference would pick something narrower? *Recommendation: defer.* An
  annotation (`let t: tree<number> = tree(1, [])`) already covers it provided
  the solver propagates the expected type inward; if it does not, this becomes
  a v1 obligation rather than new syntax.

A `record` body still mints nothing (D4b, unchanged) — a constructor function
supplies it, and it may be generic by the same rule.

## 6. Field access and `match`

Both read the body **instantiated at the reference's arguments**:

```cortex
let t: tree<integer> = tree(1, [])
t.value                        // instantiate tuple<value: T, …>[T := integer] → integer
match t { tree(v, cs) => … }   // v: integer, cs: list<tree<integer>>
```

This is one substitution against a finite body, using the existing
`substituteTypeVariables`. Recursion is not a problem: the substitution is
one level deep, and the nested `tree<integer>` stays an unexpanded reference.

- **N7 — reading a field of an uninstantiated `tree`.** Legal today (`tree`
  bare is a type). Under parameterization, is bare `tree` an arity error
  (as it is for generic aliases), or does it mean `tree<unknown>`?
  *Recommendation: arity error, matching the alias rule* — one rule for both
  forms is easier to teach than two.

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
| annotation violates the position analysis | `variance-violation` (new) |
| parameter never used in the body | `generic-alias-unused-parameter` (existing — rename or share, N8) |
| applied with wrong arity, or bare | `generic-alias-arity` generalized, or a nominal twin |
| argument fails a parameter bound | `generic-alias-bound` generalized |
| `T` unsolvable at a construction site | `unsolvable-type-variable` (existing) |

- **N8 — share the alias diagnostics or mint nominal twins?**
  *Recommendation: generalize the messages and share the codes* — the user-facing
  condition is identical and the code names are already generic-ish.

## 9. Phasing

0. **Representation** — `args` on `TypeReference`, `variance` on `TypeParam`;
   parse and serialize `tree<integer>`; arity and bound checks at application.
   No subtyping change yet (invariant by name+args). Round-trip tests.
1. **Variance** — position analysis, the `out`/`in` clause syntax, the
   `variance-violation` check, the §4.3 subtype rule. Fixed-point handling for
   the recursive occurrence.
2. **Constructor** — quantified signature from `deriveConstructorSignature`,
   call-site solving, `unsolvable-type-variable`.
3. **Elimination** — `.field` and `match` at the instantiated body.
4. **Compile + docs** — substitution in `resolveTypeForCompilation`;
   `doc/08-guide-types.md`, `src/cortex/docs/types.md`, CHANGELOG.

Phases 0–1 are independently landable and already make annotations useful;
2–3 are what make the type *inhabitable* from a program, so they should ship in
one release train (the same rule Phase 0–2 of the nominal work followed:
"decline is never a released state").

- **N9 — does the recursive-alias non-goal stay closed?** This design routes
  around it. If recursive generic aliases are ever wanted, they still need
  applied-reference nodes plus coinductive expansion at every consumer.
  *Recommendation: keep closed, and record that a recursive parametric type is
  spelled nominally.*

## 10. Test obligations

- Variance: `tree<integer> <: tree<number>` under `out`, the reverse under
  `in`, neither under default; `variance-violation` on `type h<out T> =
  tuple<run: (T) -> nothing>`; the recursive fixed point accepts `out T`.
- Recursion: a 3-deep tree constructs, `.value` and `match` read at each level,
  a `map` over it (the §1 motivating program) evaluates.
- Route parity: host `ce.declareType` and the Cortex statement agree; box and
  parse routes both register.
- Serialization: `tree<integer>` round-trips through `Type()` and the
  `DeclareType` encoding.
- Regression: the existing recursive **non**-generic tree keeps working, and
  generic aliases still expand eagerly with no `args` node reaching any
  consumer.
