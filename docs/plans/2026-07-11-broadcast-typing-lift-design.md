# Broadcast Typing Lift — a central rule for `collection<T>` where scalar `T` is expected

**Status: PROPOSED (design note, 2026-07-11). No code in this change.**

## Executive summary

Elementwise broadcasting over collections is implemented in the **value** path
(evaluate) and in the **honest-typing** wrapper, but *argument validation* still
decides case-by-case whether a collection operand is admissible where a scalar
is expected — and the decision depends on both the **operator** (fastpath
`checkNumericArgs` vs. general `validateArguments`) and the **collection
representation** (materialized finite list vs. symbolic-length lazy `Range`).
The result is an `Error` node planted at canonicalization for shapes the
evaluator would happily broadcast — and an `Error` node is unrecoverable: no
amount of evaluate-side broadcasting fixes a tree that is already invalid
(Tycho's 687-state census, ≥17 rows / 13 documents).

This note recommends adopting a **single broadcast-lift typing rule**: in
designated *scalar* signature positions, an operand whose type is
`collection<T>` (or could be one at runtime) is admissible wherever scalar `T`
is admissible, and the operator's declared result type is lifted to
`collection<R>`. This replaces the per-op, per-representation patchwork with one
predicate shared by validation, typing, and the value path. The change is
**mostly a validation-acceptance fix plus one opt-out list** — the value path
and the honest-typing wrapper already exist and already agree; validation is the
straggler.

Recommended phasing lands the low-risk, high-value piece first (teach the
general validator the same collection-acceptance the numeric fastpath already
has), measures snapshot blast radius, then settles the *boundary* question of
whether the lift should reach non-numeric scalar coercions (`Boole` of a
boolean list) at all — where the default answer is **no**, because boolean lists
already have a sanctioned consumer (mask-`At`).

---

## 1. Current state — where and why validation rejects collection operands

### 1.1 The primary defect and its representation dependence (probed 2026-07-11)

`npx tsx` from repo root, engine with `N := 3` (working tree, which already
contains other agents' landed broadcast-fold fixes — §1.4):

```
Mod(Range(0,3N),N):                    // \operatorname{mod}([0...3N],N)
  parse=["Mod",["Error",["ErrorCode","'incompatible-type'","'number'","'indexed_collection<integer>'"]],"N"]
  type=error  valid=false

Mod(L,2) eager:                        // \operatorname{mod}([0,1,2,3,4],2)
  parse=["Mod",["List",0,1,2,3,4],2]   type=list<number>  valid=true
  evaluate=["List",0,1,0,1,0]          type=list<finite_integer>

Mod(Range(0,9),N) literal-bound:       // \operatorname{mod}([0...9],N)
  parse=["Mod",["Range",0,9],"N"]      type=list<number>  valid=true
```

The primary defect: **the eager list and the literal-bound `Range` broadcast,
but the symbolic-length lazy `Range(0,3N)` plants an `Error` node at
canonicalization** — "expected `number`, got `indexed_collection<integer>`".
This is the Tycho census family: ≥17 rows / 13 documents fail with "expected
`number`, got `indexed_collection<number>`" during parse/type validation
(`kfmt6lkiwt/1` = `Mod([0…kN],N)/N`, `vnrv5hil6q/43`, `2iywqrrvuz/1`, …),
**before** evaluate runs. An `Error` in the tree is unrecoverable: the evaluator
returns the expression unchanged when `!isValid` (`boxed-function.ts:1294`), so
evaluate-side broadcasting can never repair it.

A note on `Boole(Equal(d,m))`: this **is** rejected today (`Equal(d,m)` correctly
broadcasts to `list<boolean>`, and `Boole`'s scalar `(boolean) -> integer`
signature then rejects the list), but it is **not** presented here as a clean
defect — boolean lists have a sanctioned consumer (mask-`At`, §1.3), and whether
a boolean→number coercion like `Boole` should broadcast at all is a design
boundary, deferred to §2.5 / Phase 3.

### 1.2 Why eager passes where lazy fails — the exact mechanism

`Mod` is not a fastpath operator (only `Add`/`Multiply`/`Negate`/`Square`/
`Sqrt`/`Exp`/`Ln`/`Log`/`Power`/`Root`/`Divide` are — `box.ts:940-963`
`makeNumericFunction`). It therefore canonicalizes through the general path,
which calls `validateArguments(ce, args, sig, lazy, opDef.broadcastable, …)`
(`box.ts:870-877`). Note the fifth argument: **`broadcastable` is passed as the
`threadable` flag**, so `Mod` *is* treated as threadable in the validator.

`validateArguments` admits a threadable operand only through this predicate
(`validate.ts:490-496`, repeated for optional/variadic params):

```ts
if (threadable &&
    (isFiniteIndexedCollection(op) || typeCouldBeCollection(op.type.type)))
  { result.push(op); continue; }
```

Now the two representations diverge:

| Operand                | `isFiniteIndexedCollection` | `type.type`                       | `typeCouldBeCollection` | admitted? |
| ---------------------- | --------------------------- | --------------------------------- | ----------------------- | --------- |
| `[0,1,2,3,4]` (List)   | **true** (materialized)     | `list<number>` (kind `list`)      | true                    | ✅ yes    |
| `Range(0,9)` (literal) | **true** (`isFinite` known) | `indexed_collection<integer>`     | (n/a — first test true) | ✅ yes    |
| `Range(0,3N)` (`3N` symbolic) | **false** (`isFiniteCollection === undefined`) | `indexed_collection<integer>` (kind `indexed_collection`) | **false** | ❌ error |

The failure is `typeCouldBeCollection` (`validate.ts:22-38`). Its **string**
branch recognizes `'collection'`/`'indexed_collection'`/`'list'`/`'set'`/
`'tuple'`, but its **object** branch only accepts `kind === 'list' | 'set' |
'tuple'` — it omits `kind === 'collection'` and `kind === 'indexed_collection'`.
A *parametrized* collection type such as `indexed_collection<integer>` is an
object with `kind: 'indexed_collection'`, so it is rejected. Probed directly:

```
Range(0,3N) type: indexed_collection<integer>
  type.type kind: "indexed_collection"
  isFiniteCollection: undefined      // → isFiniteIndexedCollection = false
Range(0,9)  type: indexed_collection<integer>   isFiniteCollection: true
```

The **fastpath** `checkNumericArgs` does *not* have this gap: it carries a
dedicated branch (`validate.ts:287-296`) that admits exactly the symbolic-length
numeric range —

```ts
} else if (op.isIndexedCollection && op.isFiniteCollection === undefined &&
           op.type.matches(parseType('indexed_collection<number>'))) {
  xs.push(op);   // accept for broadcasting on the strength of the element type
}
```

That branch is why `Range(0,3N)+1` (Add, fastpath) is valid while
`Mod(Range(0,3N),N)` (validateArguments) errors. Probed:

```
Range(0,3N)+1 (Add fastpath):  ["Add",["Range",0,["Multiply",3,"N"]],1]
                               type=finite_integer | indexed_collection<integer>  valid=true
Mod(Range(0,3N),N):            type=error  valid=false
```

**So the asymmetry is not fundamental — it is a missing case in one of two
parallel validators.** The fastpath learned to accept symbolic-length numeric
collections; the general validator did not.

### 1.3 Boolean lists already have a sanctioned consumer — mask-`At`

Not every operator that *could* accept a collection where a scalar is named
should lift — some already consume the collection **as a collection**. The
clearest case is `At` with a boolean-mask index, documented in
`doc/82-reference-collections.md` (~line 819): `At(xs, mask:
indexed_collection<boolean>)` filters `xs`, keeping element `i` where `mask[i]`
is `True`. Relational operators broadcasting **in index position** is the
documented Desmos-style idiom (`L[L>0]`,
`docs/plans/2026-07-07-desmos-list-filtering.md`). Verified on the working tree:

```
At([10,20,30,40],[True,False,True,False]):  ["List",10,30]        (list<finite_integer>)
d[d=m]  (d=[1,2,3], m=2):                    ["List",2]
L[L>0]  (L=[1,2,3]):                         ["List",1,2,3]
```

`At` therefore has a signature position typed `indexed_collection<boolean>` (and
`indexed_collection<integer>` for index-list gather) — a **collection-aware**
parameter. The lift rule must **not** apply here: a boolean list is `At`'s
intended input, not a scalar broadcast to be threaded. This is the model for the
opt-out in §2.2 — collection-aware signatures are structurally excluded because
the lift fires only against a *scalar* parameter position. It is also why `Boole`
is a boundary question rather than a defect (§2.5): the ecosystem already routes
boolean lists to a consumer (`At`), so `Boole`-over-a-boolean-list is not the
only, or even the idiomatic, way to use one.

### 1.4 How the working broadcasts are built (so the lift can agree with them)

Three broadcast sites already exist and share **one** predicate,
`isFiniteIndexedCollection`, gated by `skipBroadcastForVectorOps`:

- **Value, pre-eval** (`boxed-function.ts:1315-1333`, step 2): if
  `def.broadcastable` and some raw operand `isFiniteIndexedCollection` and not
  skipped, `zip` the operands and map the operator, returning a `List`.
- **Value, post-eval** (`:1383-1403`, step 4b): the same, over the *evaluated*
  `tail`, for operands that only *became* collections at evaluate
  (`Sqrt(A·B)` → matrix). `Add`/`Multiply` are excluded from *this* site (they
  own `addTensors`/`mulTensors`), but the working tree now contains landed fixes
  from other agents that give `Add` **and** `Multiply` a matching post-eval fold
  over non-tensor finite collections, via a `broadcastOverIndexedCollections`
  helper (`collection-utils.ts`) wired into `add`/`addN`/`mul`/`mulN`. This is
  the state the typing rule must agree with — see §1.4b and §2.4.
- **Type** (`:1706-1725`, the honest-typing wrapper from
  `2026-07-07-honest-list-broadcast-typing.md`): if the operator *will*
  broadcast (same predicate), lift the handler's scalar element type `R` to
  `broadcastResultType(R)` = `list<R>` (`common/type/utils.ts:100`).

`skipBroadcastForVectorOps` (`boxed-function.ts:1598-1627`) is the **opt-out**:
it suppresses broadcast for `Add`/`Multiply` with tensors, for numeric-tuple
(point/vector) operands of `Add`/`Multiply`/`Negate`/`Subtract`/`Divide`, and
for `Equal`/`NotEqual` when ≥2 operands are collections (whole-list equality).

The crucial observation: **the value/type broadcast predicate
(`isFiniteIndexedCollection`) is *stricter* than the validation-acceptance
predicate.** Validation accepts symbolic-length numeric ranges (via the fastpath
branch) that the value path then *cannot* broadcast until they materialize. That
is intentional and sound — the operand becomes a finite collection at evaluate
(`Range(0,3N)` with `N := 3` → `Range(0,9)`), and step-2/step-4b broadcast fires
then. The lift rule must preserve this two-tier arrangement: **validation admits
on the strength of the *element type*; the value/type broadcast fires only once
the collection is materialized.**

### 1.4b Landed evaluate-side folds the typing rule must match (working tree)

The working tree already folds the nested-broadcast and range×tuple shapes that
Tycho Open Request 3(a)/(b) reported. Probed:

```
L^2-2:      eval=["List",-1,2,7]                       eval-type=list<finite_integer>   parse-type=finite_integer | list<finite_number>
R^2-2:      eval=["List",2,-1,-2,-1,2]                 eval-type=list<finite_integer>   parse-type=finite_integer | list<number>
1-L:        eval=["List",0,-1,-2]                      eval-type=list<finite_integer>   parse-type=finite_integer | list<number>
R*(2,3):    eval=["List",[Tuple -4 -6],[Tuple -2 -3],[Tuple 0 0],[Tuple 2 3],[Tuple 4 6]]   (range × direction tuple → list of points)
L*(2,3):    eval=["List",[Tuple 2 3],[Tuple 4 6],[Tuple 6 9]]
```

The **values** are now correct (via `broadcastOverIndexedCollections` in
`add`/`addN`/`mul`/`mulN`). But note the **declared type is still a union**
`finite_integer | list<…>` — the value path and the type path disagree by one
artifact. That residue is the tell that a *value-only* fold landed without the
matching typing rule (§2.4). It is exactly the kind of tree that a
type-trusting validation gate or downstream consumer can still reject even
though the evaluator handles it — the reason the lift must be a **typing** rule,
not merely an evaluate fix.

---

## 2. The proposed lift rule

### 2.1 Statement

> In a signature position declared as a **scalar** type `T` (a non-collection
> type — `number`, `boolean`, `integer`, `real`, …), an operand whose type is
> `collection<T'>` with `T' <: T` (or *could be* such a collection at runtime)
> is admissible, provided the operator **opts into the lift**. When any operand
> is so lifted, the operator's declared result type becomes `collection<R>`,
> where `R` is the scalar result the handler computes for the element types.

This is exactly the acceptance `checkNumericArgs` already grants numeric
fastpath ops, generalized to (a) the `validateArguments` path and (b) an
explicit opt-in for non-numeric scalar ops.

### 2.2 Where it lives

**Acceptance** belongs in `validate.ts`, not scattered across handlers:

1. **Fix `typeCouldBeCollection` (and `typeCouldBeNumericCollection`) to
   recognize the parametrized object kinds** `collection` / `indexed_collection`.
   This is a two-line fix and, on its own, closes the `Mod(Range(0,3N),N)`
   family (every threadable operator through `validateArguments`). It is the
   single highest-leverage change in this note.

2. **Add the symbolic-length numeric-range branch to `validateArguments`** (the
   analogue of `checkNumericArgs:287-296`), so the two validators admit the same
   operands. With fix (1) this is largely subsumed, but keeping the explicit
   `indexed_collection<number>`-with-indeterminate-size branch documents intent
   and guards the non-numeric variants.

**Opt-in / opt-out policy** — which operators lift:

- **Numeric scalar signatures lift by default.** Any operator already carrying
  `broadcastable: true` continues to lift (`Mod`, trig, `Sin`, arithmetic, …).
  Fixing (1)/(2) makes their `validateArguments` acceptance match their existing
  value/type broadcast.
- **Collection-aware operators never lift.** `Length`, `At` (including its
  documented boolean-mask and integer-list index positions, §1.3), `Map`,
  `Reduce`, `Filter`, `Sum`, `Product`, `First`, `Take`, statistics reducers,
  set operations — these *consume* a collection as a collection; their
  signatures already name `collection`/`indexed_collection` parameters, so the
  lift predicate (which fires only against a **scalar** parameter position) does
  not apply to them. No opt-out flag is needed; the rule is structurally inert
  for them. `At([…], mask)` filtering a boolean list is the canonical example of
  a signature that must be left alone.
- **Boolean→number coercions are a boundary, default no** (§2.5). `Boole` and
  similar scalar coercions off a non-numeric domain are *not* enrolled by
  default: boolean lists already have a sanctioned consumer (mask-`At`), so
  broadcasting `Boole` is a convenience with an existing idiomatic alternative
  (`\sum Boole` over a mask, or `At`-filter then `Length`). Decide explicitly in
  Phase 3 rather than flag it reflexively.
- **Control / scope operators never lift.** `If`, `Which`, `When`, `Block`,
  `Assign`, `Declare`, quantifiers — a collection-valued *condition* is a
  separate semantic question (Tycho Open Request 4), deliberately **out of scope
  here**. See §5.

### 2.3 Result-type computation and kind preservation

The declared result type is `broadcastResultType(R)` = **`list<R>`**, an
**unbounded, length-agnostic** `list`. This matches what the value path
materializes: step 2 / step 4b build a plain `List`, whose own type handler is
unbounded `list<…>` (it drops fixed length). Do **not** try to preserve
`indexed_collection` vs `list` kind or propagate length in the declared type:

- `Range` lifts to `list<R>`, **not** back to a lazy `indexed_collection`. The
  value path already produces an eager `List` from the zip, so `list<R>` is the
  honest upper bound. Probed: `Mod([0...9],N)` (literal Range) types
  `list<number>` and evaluates to a `List` — the wrapper and value agree.
- A fixed `vector<n>` result is reachable only for **tensor** `Add`/`Multiply`,
  which are skip-listed from the wrapper and typed by their own handlers
  (`2026-07-07-honest-list-broadcast-typing.md` T2). The lift does not touch
  them.

`broadcastResultType` and `collectionElementType` (`common/type/utils.ts`)
already exist and are exactly the primitives needed; the wrapper unwraps a
leaked collection element type before lifting so lists don't nest.

### 2.4 Agreement with the value path — the cautionary example

**The typing rule must never claim a broadcast the value path won't deliver, and
vice-versa.** The working tree contains a fresh illustration of the failure mode
when the two drift apart. The just-landed `broadcastOverIndexedCollections` folds
(`add`/`addN`/`mul`/`mulN`) now make `R^2-2` = `Add(-2, List(4,1,0,1,4))` fold to
`List(2,-1,-2,-1,2)` and `R·(2,3)` fold to a list of tuples — the values are
correct. **But the declared types are still unions** (`finite_integer |
list<number>` for `R^2-2`; §1.4b). The type path and value path *disagree by one
artifact*: `Add`'s `addType` computes a scalar element type, and the honest-typing
wrapper's `Add` case does not fire for the post-eval fold (the raw operand wasn't
a collection at type-computation time, so the pre-eval predicate is false). A
downstream consumer or validation gate that trusts the declared type can still
misfire on a tree the evaluator handles.

**Lesson for this design:** implement acceptance, value, and typing as **one
predicate applied at three sites**, and pin `expr.type ⊇ expr.evaluate().type`
in tests for every lifted family, so a value-only or type-only change cannot ship
a disagreement. The `Add`/`Multiply` post-eval union above should be folded into
the lift's typing story (widen to `list<R>` when the fold fires), not left as a
union.

### 2.5 Boundary — does the lift cross the number/boolean divide?

CE deliberately does **not** treat `boolean` as a number. That is why arithmetic
over a boolean list, and coercions like `Boole` (`boolean → integer`), sit on a
design boundary rather than in the obvious core of the lift:

- **Default answer: the lift does not enroll boolean→number coercions.** Boolean
  lists have a first-class consumer — mask-`At` (§1.3) — so the idiomatic way to
  turn `d = m` over a list into a count is `Length(d[d=m])` or a masked sum, not
  `Boole` broadcasting. Leaving `Boole` scalar keeps the number/boolean divide
  crisp and avoids implying that boolean lists are "just" numeric vectors.
- **What would tip it the other way:** if a corpus census shows `Boole(list)` (or
  `\sum Boole(cond)` where `cond` broadcasts to a list) is a common, awkward-to-
  rewrite shape, enroll `Boole` specifically by adding `broadcastable: true` — its
  evaluate handler already returns a scalar per element, so the generic step-2
  broadcast + honest-typing wrapper produce `list<integer>` with no handler
  change. This is a **one-operator opt-in**, not a general "lift over booleans"
  policy. Resolve in Phase 3 from evidence, not reflexively.

---

## 3. Multi-collection operands

Verified current behavior (working tree):

| Expression                | Result                                            |
| ------------------------- | ------------------------------------------------- |
| `[1,2,3] + [10,20,30]`    | parse `vector<3>` → evaluate `[11,22,33]` ✅ **zip** |
| `[1,2,3] + [10,20]`       | parse `vector<2> \| vector<3>`, valid → evaluate `Error 'incompatible-dimensions' '2 vs 3'` |
| `1 + [1,2,3] + [10,20,30]`| evaluate `[12,23,34]` ✅ (scalar broadcast + zip) |

So CE already does **positional zip** for equal-length collections (via the
tensor `Add` path), and **fails length mismatch** with an
`incompatible-dimensions` error at evaluate. Scalar + collection + collection
combines a scalar broadcast with the zip. The lift rule inherits this: it only
governs *acceptance* and *result-kind* (`collection<R>`); the arity/zip and
length-mismatch semantics are the value path's and are already defined.

Design decisions to record:

- **Zip is the multi-collection contract.** Two collections of equal length
  combine positionally; document `list ⊗ list` as a zip, not a Cartesian
  product. (The `X·(2,3)` "range × tuple" transpose in Tycho Open Request 3(a)
  is a *tuple* interaction, governed by numeric-tuple/point semantics
  `2026-07-07-tuple-point-semantics.md`, **not** by this lift — a tuple is a
  point, skip-listed from broadcast. Out of scope; cross-referenced.)
- **Length mismatch stays an evaluate-time error**, not a validation error —
  the declared types (`vector<2>`, `vector<3>` or `list<…>`) don't carry a
  provable length in the general case, so the check must happen where the
  collections are materialized. The lift must not upgrade a length mismatch to a
  canonicalization `Error` (that would regress the current graceful evaluate
  error).
- **Result type for a zip** is `list<widen(R_i)>` — the element type is the
  widened scalar result across the participating collections' element types.

---

## 4. Blast radius

### 4.1 Tests asserting `incompatible-type` with collection types

23 test files reference `incompatible-type`. The collection-typed ones I sampled
(`collections.test.ts`, `linear-algebra.test.ts`) are the **reverse direction** —
*expected collection, got scalar* (`"'collection'","'number'"`,
`"'indexed_collection'","'finite_number'"`, `Determinant` of a `vector<7>` where
a `matrix` is required). The lift governs the **opposite** direction (collection
where scalar expected), so these assertions are **not** at risk.

A targeted grep for the *at-risk* direction — an assertion locking in
"expected scalar, **got** `list<…>`/`vector<…>`/`indexed_collection<…>`" as an
error — returned **zero** matches in `test/`. So no existing test pins the very
errors this rule removes. This is a favorable finding: the lift converts
error-nodes to valid broadcasts without contradicting a committed error
expectation.

### 4.2 Value/type snapshot churn (the real risk)

The dominant blast radius is the same class as the two sibling plans: making more
expressions **valid** and **`list<…>`-typed** changes any snapshot that printed
the old `Error` node or the old scalar/union type. Candidates: `collections`,
`parser-desmos-composition`, `parser-list-range` (already modified in the working
tree), `parser-for-comprehension`, `arithmetic`, and any error-message snapshot
embedding "expected number, got …". The honest-typing and list-filtering plans
both reported **0 changed snapshots** for their type-surface changes (snapshots
are value/serialization-oriented), but the *acceptance* change here newly
produces evaluated `List` values where an `Error` stood — those **can** flip
snapshots. **A full-suite snapshot count is mandatory before landing** (repo
policy); enumerate and hand-verify each flip is an error→broadcast upgrade, never
`-u` an `@fixme`.

### 4.3 Interaction with the non-finite typing convention

`ARCHITECTURE.md` "Non-finite typing convention" governs the **element/scalar**
result `R` a handler claims (`non_finite_number` only when provably ±∞, else
`number`, etc.). The lift is orthogonal: it wraps whatever scalar `R` the handler
computed into `list<R>`. It must therefore lift the **element** type the handler
already produced (as the honest-typing wrapper does via `collectionElementType`),
never re-derive finiteness. Guard: `non-finite-typing.test.ts` must stay green —
a handler that returns `number` for a possibly-`~oo` element must yield
`list<number>`, not `list<real>`, under the lift.

### 4.4 Non-strict parse recovery

In non-strict mode `validateArguments`/`checkNumericArgs` already short-circuit
(the `!ce.strict` fastpaths, `validate.ts:100,205,435`) and infer types loosely.
The lift's acceptance change is in the **strict** branch; confirm non-strict
recovery is unchanged (Tycho parses `{ strict: false }`, so the census rows also
exercise the non-strict path — verify both).

---

## 5. Alternatives considered

1. **Per-op signature widening / per-op `broadcastable` flags (status quo,
   extended).** Add `broadcastable` to each straggler (`Boole`, …) and widen
   signatures to `number | list` case by case. Rejected as the *primary*
   mechanism: it is whack-a-mole (the `Mod` failure is not a missing flag —
   `Mod` *is* broadcastable; it is a missing *validator* case), it leaves the
   two-validator inconsistency (`checkNumericArgs` vs `validateArguments`)
   intact, and every new scalar operator re-introduces the gap. The lift keeps
   the per-op `broadcastable` flag as the **opt-in switch** but centralizes the
   *acceptance and result-typing* logic.

2. **Evaluate-only broadcasting, validation left strict.** Fix only the value
   path. Rejected: it cannot recover Tycho's census rows. The failures are
   `Error` nodes produced at **canonicalization**, *before* evaluate runs; an
   invalid tree never reaches the evaluator (`_computeValue` returns `this` when
   `!this.isValid`, `boxed-function.ts:1294`). The in-flight `R^2-2` fold is
   exactly this shape and shows the trap: it fixes the value but leaves the type
   a union, and had the operand been rejected at validation it would not have
   helped at all.

3. **Require consumers to `Map` explicitly.** The ratified answer for
   *control-flow* collection conditions (`Which` over a boolean list — Tycho
   Open Request 4, and the `with`/`Ans` custom-dictionary philosophy: surface
   semantics that lower to primitives live at the consumer boundary). Rejected
   **for arithmetic**: `2R+1` over a range, `Mod([0…kN],N)`, `Boole(d=m)` are
   **standard mathematical notation**, not control flow. Elementwise arithmetic
   over a vector/list is a core CAS expectation (NumPy, MATLAB, Desmos, SymPy all
   broadcast it); pushing it to the consumer means every consumer re-implements
   fan-out and CE's own `evaluate` (which already broadcasts) disagrees with its
   own validator. The `Which`/control-flow case is genuinely different: a
   collection-valued *condition* has no single obvious semantics (mask? any?
   all?), so keeping it explicit is defensible; broadcasting a scalar arithmetic
   op over a collection has exactly one meaning.

---

## 6. Recommendation and phasing

**Adopt the central lift rule, implemented as one predicate at three sites
(accept / value / type), staged so the highest-value, lowest-risk piece lands
and is measured first.**

### Phase 1 — Close the validator gap (numeric ops through `validateArguments`)

- Fix `typeCouldBeCollection` and `typeCouldBeNumericCollection` (`validate.ts`)
  to recognize `kind === 'collection'` and `kind === 'indexed_collection'` in
  the object branch. Add the symbolic-length `indexed_collection<number>` branch
  to `validateArguments` mirroring `checkNumericArgs:287-296`.
- **Test:** `Mod(Range(0,3N),N)`, `Mod([0…kN],N)/N` (census `kfmt6lkiwt`),
  and a spread of other `validateArguments`-path broadcastable ops over a
  symbolic-length range validate and evaluate to `list<…>`. Assert
  `expr.type ⊇ expr.evaluate().type`. Confirm the eager forms are unchanged.
- **Measure snapshot blast radius on the full suite; enumerate flips.** This is
  the acceptance change that turns `Error` nodes into values, so it is the most
  likely to move snapshots.
- Verify `npm run typecheck`, `npx tsc -p tsconfig.json --noEmit`,
  `npx madge --circular` clean (no new imports expected — edits are within
  `validate.ts`).

### Phase 2 — Reconcile the value/type disagreement for the landed post-eval folds

- The `broadcastOverIndexedCollections` folds for `Add`/`Multiply` already fold
  the *values* (`R^2-2`, `R·(2,3)`), but leave the declared type a union
  (`finite_integer | list<…>`, §1.4b/§2.4). Fold that into the typing story so
  `R^2-2` types `list<R>`. Either extend the honest-typing wrapper to the
  `Add`/`Multiply` post-eval case or have `addType`/`Multiply.type` widen to the
  broadcast type when a finite-collection operand is present.
- **Test:** `R^2-2`, `1-L`, `L^2-2`, `R·(2,3)` type `list<…>` (no union); pin
  `expr.type ⊇ expr.evaluate().type`.

### Phase 3 — Settle the boolean-coercion boundary (evidence-gated)

- **Default: do nothing** — leave `Boole` scalar; boolean lists route through
  mask-`At` (§1.3, §2.5). Document the idiom (`Length(d[d=m])`, masked sum) for
  consumers.
- **Only if a census shows `Boole(list)` is a frequent, awkward shape:** enroll
  `Boole` specifically with `broadcastable: true` (one-operator opt-in; no
  handler change — generic broadcast + wrapper give `list<integer>`).
- **Test (whichever way it goes):** if left scalar, assert `Boole([…])` stays an
  explanatory error and `Length(d[d=m])` is the working path; if enrolled,
  `Boole(d=m)` → `[0,1,0]` typed `list<integer>` and `Boole(True)` unchanged.
  Either way confirm `Which`/`If` (control) still reject or stay inert on a
  collection condition — the boundary with Tycho Open Request 4.

### Cross-cutting test strategy

- New `test/compute-engine/broadcast-lift.test.ts`: per family (arithmetic-via-
  `validateArguments` like `Mod`/`Gcd`/`Remainder`, a trig op over a symbolic
  range), assert (a) validity, (b) `list<…>` declared type, (c)
  `expr.type ⊇ expr.evaluate().type`, (d) the value matches an explicit
  element-wise `Map`, (e) exactness stable under `.N()`.
- **Non-interference (must stay green):** `collections`, `list-filtering`
  (mask-`At` must be untouched), `list-broadcast-typing`, `a3-lists`,
  `points-arithmetic` (tuple skip-list), `linear-algebra` (tensor typing),
  `non-finite-typing`, `logic`.
- **Snapshot policy:** measure and enumerate before landing each phase; never
  `-u` an `@fixme`; surface a large/debatable diff for review rather than
  absorbing it.
- **Acceptance (Tycho):** the census rows `kfmt6lkiwt/1` (`Mod([0…kN],N)/N`),
  `vnrv5hil6q/43`, and the broader arithmetic-over-symbolic-range family
  validate and evaluate through `each()`. Explicitly **out of scope** (separate
  tracks): the `X·tuple` range×point shape (tuple-point semantics — already
  folded in the working tree), the collection-valued `Which` (control-flow,
  Open Request 4), and the `Boole`-over-boolean-list boundary (§2.5, use
  mask-`At`).

---

## Appendix — probe transcript (verbatim, working tree 2026-07-11)

```
# Mechanism
Range(0,3N) type: indexed_collection<integer>   kind="indexed_collection"  isFiniteCollection: undefined
Range(0,9)  type: indexed_collection<integer>   isFiniteCollection: true
Mod broadcastable: true  threadable: undefined  lazy: false     (broadcastable is passed AS threadable to validateArguments)

# PRIMARY DEFECT: symbolic-length range rejected by validateArguments
Mod(Range(0,9),N) literal-bound:   ["Mod",["Range",0,9],"N"]                         type=list<number>  valid=true
Mod(Range(0,3N),N) symbolic-bound: ["Mod",["Error",...'number'...'indexed_collection<integer>'...],"N"]  type=error  valid=false
kfmt: mod([0...kN],N)/N:           ["Divide",["Mod",["Error",...],"N"],"N"]           type=error  valid=false
Range(0,3N)+1 (Add fastpath):      ["Add",["Range",0,["Multiply",3,"N"]],1]           type=finite_integer | indexed_collection<integer>  valid=true   (fastpath accepts — the asymmetry)

# Boolean lists HAVE a sanctioned consumer (mask-At) — not a defect
Equal(d,m):                        evaluate=["List","False","True","False"]  type=list<boolean>
At([10,20,30,40],[T,F,T,F]):       evaluate=["List",10,30]        type=list<finite_integer>
d[d=m]:                            evaluate=["List",2]
L[L>0]:                            evaluate=["List",1,2,3]
Boole(Equal(d,m)):                 ["Boole",["Error",...'boolean'...'list<boolean>'...]]  valid=false   (boundary, §2.5 — use mask-At)

# Landed evaluate-side folds the typing rule must match (value folds; type still a union)
L^2-2:                 evaluate ["List",-1,2,7]                     eval-type list<finite_integer>   parse-type finite_integer | list<finite_number>
R^2-2:                 evaluate ["List",2,-1,-2,-1,2]              eval-type list<finite_integer>   parse-type finite_integer | list<number>
1-L:                   evaluate ["List",0,-1,-2]                    eval-type list<finite_integer>   parse-type finite_integer | list<number>
R*(2,3):               evaluate list of Tuples [-4,-6],[-2,-3],[0,0],[2,3],[4,6]   eval-type list<tuple<finite_integer, finite_integer>>
L*(2,3):               evaluate list of Tuples [2,3],[4,6],[6,9]

# Multi-collection
[1,2,3]+[10,20,30]:    parse type=vector<3>  → evaluate ["List",11,22,33]
[1,2,3]+[10,20]:       parse type=vector<2> | vector<3>, valid → evaluate ["Error","'incompatible-dimensions'","'2 vs 3'"]
1+[1,2,3]+[10,20,30]:  evaluate ["List",12,23,34]
```

## References

- Tycho `docs/COMPUTE_ENGINE.md`, Open Request 3 (broadcasting) and Open
  Request 4 (collection-valued conditions), the 687-state census table.
- `docs/plans/2026-07-07-honest-list-broadcast-typing.md` — the typing wrapper
  and `broadcastResultType`/`collectionElementType` this rule reuses.
- `docs/plans/2026-07-07-desmos-list-filtering.md` — relational broadcast
  (`list<boolean>`), the `Equal`/`NotEqual` two-collection skip-list.
- `doc/82-reference-collections.md` (~line 819) — the documented `At(xs, mask:
  indexed_collection<boolean>)` boolean-mask index and integer-list gather: the
  sanctioned consumer of boolean/index lists that must **not** lift.
- `docs/plans/2026-07-07-tuple-point-semantics.md` — numeric tuples/points
  (the `X·tuple` transpose in Open Request 3(a) belongs here, not to the lift).
- `src/compute-engine/boxed-expression/validate.ts` —
  `typeCouldBeCollection`/`typeCouldBeNumericCollection`, `validateArguments`,
  `checkNumericArgs`.
- `src/compute-engine/boxed-expression/boxed-function.ts` — broadcast steps 2 /
  2b / 4b, `skipBroadcastForVectorOps`, the honest-typing wrapper.
- `src/compute-engine/boxed-expression/arithmetic-add.ts` (working tree) —
  `broadcastOverIndexedCollections` post-eval `Add` fold (the §2.4 example).
- `ARCHITECTURE.md` — "Non-finite typing convention for type handlers".
