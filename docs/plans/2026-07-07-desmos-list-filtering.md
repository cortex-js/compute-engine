# Desmos List Filtering — `L[condition]`

**Status: LANDED (2026-07-08) — T1–T3 complete (Design A).**

What shipped:

- **T1 — relational broadcast.** `broadcastable: true` added to `Greater`,
  `Less`, `GreaterEqual`, `LessEqual`, `Equal`, `NotEqual`
  (`library/relational-operator.ts`). A list operand now zips into a
  `list<boolean>` via the generic broadcast + the honest-typing wrapper
  (sibling plan, landed same day). Scalar (`1>2`) and symbolic (`x>0`)
  comparisons are unchanged — only a *finite indexed collection* operand
  triggers the zip.
  - **Equal/NotEqual decision (highest-risk item): restricted to list-vs-scalar.**
    `skipBroadcastForVectorOps` (`boxed-function.ts`) skips broadcasting for
    `Equal`/`NotEqual` when **two or more** operands are collections, so
    whole-list equality `Equal(L, M)` stays a **scalar boolean** (structural /
    mathematical list comparison, used elsewhere) while Desmos `L[d=4]`
    (list-vs-scalar) broadcasts to a mask. Point/tuple equality is likewise
    preserved (two-collection case). `Greater`/`Less`/`GreaterEqual`/`LessEqual`
    have no whole-list overload and broadcast in every collection case.
  - **Lazy-operator post-eval broadcast.** `Less`/`LessEqual` are `lazy`, so the
    generic broadcast (`boxed-function` steps 2/4b) misses an operand that only
    *becomes* a collection at evaluate (e.g. `|[1...5]-2|`, whose operand
    `Abs(Range−2)` is not a materialized collection pre-eval). A
    `broadcastComparison` helper in the `Less`/`LessEqual` handlers rebuilds the
    comparison from the already-evaluated operands so the generic broadcast then
    zips it — no double evaluation on the scalar path.
- **T2 — `L[condition]` end-to-end.** `L[L>0]`, `L[d=4]` (d a list), and the
  positional Range mask `L[|[1...length(L)]-i|>0]` (concrete length) validate
  and evaluate via `At`'s existing boolean-mask branch (Case B). `At`'s index
  signature was **widened to accept `boolean`** so a broadcast-expression
  condition that only types `list<boolean>` at evaluate (its operand isn't a
  materialized collection at canonicalization) still passes the index check; it
  broadcasts to the list at evaluate and the mask fires. The **At-canonical
  broadcast stopgap** (the `value.type.matches('number')` value-operand
  relaxation) is now dead under honest typing and was **removed**; the handler
  is a plain validate-and-box passthrough. `isDeclaredScalarNumber` import
  dropped from `collections.ts`.
- **T3 — LaTeX round-trip.** `L[L>0]`, `L[d=4]` (`=` stays `Equal`, not
  `Assign`), and literal-list filters round-trip through the `At` subscript
  serializer (`L_{0\lt L}`, `L_{d=4}`). Integer indices unchanged.

New test: `test/compute-engine/list-filtering.test.ts` (23 tests, T1–T3 +
corpus rows + exactness).

Verification: `npm run typecheck` + `npx tsc -p tsconfig.json --noEmit` clean;
madge 0 cycles; targeted suites (list-filtering, list-broadcast-typing,
a3-lists, collections, logic, points-arithmetic, parser-desmos-composition) all
green; **full suite 3987 snapshots passed, 0 changed** (relational broadcast
changes list *values*, but no snapshot had locked a `list <relop> scalar` as
symbolic).

Known limitations / deviations (see the implementation report):

- **Bare declared list symbol** (`ce.declare('L','list<number>')` with no value)
  is not a collection (`isCollection` false), so `L>0` does not broadcast for a
  value-less symbol. This is a pre-existing broadcast limitation (`2L`, `sin(L)`
  don't broadcast for such symbols either), not introduced here. Filtering works
  once `L` has a value — the realistic Desmos case.
- **Abstract `remove(L,i)`** (fully symbolic `Length(L)`): `Range(1, Length(L))`
  is not a finite collection until `Length` resolves, and `Add`/`Multiply` are
  excluded from the post-eval broadcast (step 4b), so the mask does not
  materialize with a symbolic length. With a **concrete** length (the mask
  mechanism this plan delivers) it works: `[10,20,30][|[1...3]-2|>0]` → `[10,30]`.
- **Mask alignment: CE truncates** to the shorter of list/mask (mask entries
  past the source end contribute nothing; an uncovered tail is dropped). Verify
  vs Desmos length-mismatch behavior at the importer boundary.
- **List `.N()` does not numericize elements** (uniform CE behavior): a filtered
  list keeps exact rationals under both `evaluate` and `.N()`; individual
  elements numericize when taken singly. Exactness is preserved under evaluate.
- **`At` mask-mode result type is the element type, not `list<…>`** (pre-existing
  `At.type` handler behavior), so chaining `At` over a filtered list can misfire
  at the type check. Out of scope; noted for a follow-on.

---

_Original plan follows._

**Status: PLANNED — not started**

## Motivation

Desmos supports **filtering a list by a boolean condition in index position**:

- `L[L>0]` — the elements of `L` that are greater than 0.
- `L[d=4]` — elements where a condition holds (`=` is equality here, not
  assignment).
- `r_{emove}(L,i)=L[|[1...\operatorname{length}(L)]-i|>0]` — a positional mask
  computed from a Range, aligned with `L` by position (removes the `i`-th
  element).
- Combinations of a condition with an integer index / range.

The 2026-07-07 Desmos corpora contain **13+ rows** of this shape. They all fail
today with `incompatible-type` — CE parses the notation to `At(L, <condition>)`,
but `At` rejects a boolean-typed index. (Corpus evidence: 2026-07-07 session
scratchpad `ce-coverage/` reports and tycho's `desmos-corpus`.)

## Current behavior (verified on main, 2026-07-07)

`npx tsx` probes from repo root, with `ce.declare('L','list<number>')`:

| Input | Result |
|---|---|
| `L[L>0]` | `At(L, Error['incompatible-type' 'indexed_collection \| number \| string' ← 'boolean'])`, `isValid: false` |
| `L[d=4]` | same error (the `d=4` index is `Equal(d,4)`, typed `boolean`) |
| `L[|[1...length(L)]-i|>0]` | same error |
| `L[1]` | `At(L, 1)`, type `number`, valid ✓ (integer index works) |

So the **parse shape is already correct** — the LaTeX postfix bracket produces
`At(collection, indexExpr)`. The failure is purely at **argument type
validation**: `At`'s signature index parameter is
`number | string | indexed_collection` (`collections.ts:1196-1197`), and a
condition like `L>0` is typed scalar `boolean`, which matches none of them.

### Surprising finding — the mask machinery is already half-built

`At` **already implements boolean-mask filtering** in its evaluate handler
(`collections.ts:1233-1264`, "Case B: finite collection index — boolean mask or
integer list"), and its `description` (`:1192-1193`) documents it. Verified
working when the index is a **literal boolean list**:

```
At(List(10,20,30), List(True,False,True))  →  [10,30]          (evtype list<finite_integer>)
At(Range(10,50,10), List(False,True,True,True,True))  →  [20,30,40,50]
```

`Filter` also already exists (`collections.ts:907-923`), a predicate-over-element
operation: `Filter([-1,2,-3,4], _ ↦ _>0)` → `[2,4]`.

So the primitive that Desmos filtering needs — **positional boolean masking** —
is present and functional. What is missing is getting a boolean **list** (not a
scalar boolean) into the index position, both at type-check time and at value
time.

### The real blocker — relational operators don't broadcast

The condition `L>0` never becomes a boolean list. Verified:

- `Greater` is **not broadcastable** (`ce.box(['Greater',1,2]).operatorDefinition
  .broadcastable === false`).
- `L>0` (literal `Greater(List(-1,2,-3),0)`) evaluates to `0 < [-1,2,-3]` and
  stays symbolic, type `boolean` — **no broadcast**.
- Contrast the arithmetic in the mask: `|[1...5]-2|` broadcasts fine (Subtract
  and Abs are broadcastable) → `[1,0,1,2,3]`, `list<finite_integer>`. Only the
  final `>0` fails to broadcast, so `|[1...5]-2|>0` → `0 < |-2 + Range(1,5)|`,
  scalar `boolean`.

Thus even a *literal*-list filter fails at the type check:
`At(List(10,20), Greater(List(-1,2),0))` → the same `incompatible-type` error,
because `Greater(List,…)` is typed scalar `boolean`.

## Design

Two independent gaps must close; the recommended design closes both by reusing
existing machinery rather than adding a new operator.

### Recommended: make relational operators broadcast (Design A)

1. **Broadcast relational operators over lists.** Add `broadcastable: true` to
   `Greater`, `Less`, `GreaterEqual`, `LessEqual`, `Equal`, `NotEqual` (and any
   siblings) so `L>0`, `|[1...5]-2|>0`, `d=4`-over-a-list, etc. zip into a
   boolean **list** `[True,False,…]` via the generic broadcast (steps 2 / 4b in
   `boxed-function.ts:1286-1304, 1354-1360`).
2. **Honest `list<boolean>` result type** for the broadcast — supplied by the
   sibling plan `docs/plans/2026-07-07-honest-list-broadcast-typing.md` (T3
   explicitly hands off `list<boolean>` for relational ops). This makes
   `L>0` type `list<boolean>` (an `indexed_collection`) so it **satisfies `At`'s
   index signature** — no signature change needed.
3. **`At` mask mode already does the rest** (`collections.ts:1233-1264`): a
   finite boolean-collection index masks the source positionally.

Once broadcasting produces a boolean list with an `indexed_collection` type,
`L[L>0]` type-checks and evaluates using code that already exists. This handles
**all** corpus shapes uniformly, including the positional Range mask
`L[|[1...length(L)]-i|>0]` (which is *not* expressible as `Filter` — see below).

**Dependency**: the symbolic case (`L` a declared `list<number>` symbol) needs
the honest `list<boolean>` type from the sibling plan, because `At` validates
its index argument against declared types at canonicalization. Land the sibling
plan's T1/T3 first, or land them together. The literal-list case additionally
requires step (1) (broadcast) — without it the value stays scalar even at
evaluate.

### Alternative: canonicalize `At(L, condition) → Filter` (Design B)

Detect a boolean-typed index in `At` canonicalization and rewrite to
`Filter(L, elt ↦ condition[L := elt])`. Rejected as the *primary* mechanism:

- **Semantically narrower.** It only works when the condition references the
  filtered list `L` element-wise. The corpus row
  `L[|[1...length(L)]-i|>0]` computes the mask from a **Range**, not from `L`;
  there is no element variable to bind — it is a positional mask. `Filter`
  cannot express it; `At` mask mode can. Design A subsumes this case; Design B
  does not.
- **Fragile substitution.** Rewriting `L` → bound element inside an arbitrary
  condition (and disambiguating which free symbol is "the element") is
  error-prone, especially with mixed conditions (`L[d=4]` references `d`, not
  `L`).

Design B could be a *later* ergonomic addition for the pure `L[L>0]` case (it
avoids materializing a full boolean list), but the general, corpus-complete
solution is Design A.

### Alternative: loosen `At`'s index signature to accept scalar `boolean`
(Design C)

Insufficient on its own: without broadcasting (Design A step 1), `L>0` stays a
scalar `Less` expression at evaluate too, so `At` mask mode (which requires
`opAtIndex.isCollection && isFiniteCollection`, `collections.ts:1234`) never
fires. Loosening the signature without broadcasting just defers the failure from
validation to a silent no-op. Not recommended.

### LaTeX parse / serialize considerations

- **Parse shape already works**: `L[cond]` → `At(L, cond)` (verified). No parser
  change needed for the bracket itself.
- **`=` in index position parses as `Equal`** (verified: `d=4` → `Equal(d,4)`),
  which is the Desmos meaning. Confirm `At`'s bracket parsing does not special-
  case `=` as an assignment or a `Rule`.
- **Round-trip / serialize**: an `At(L, Greater(L,0))` should serialize back to a
  bracket form `L[L>0]` (or an explicit `\operatorname{At}` form). Verify the
  existing `At` serializer (`indexStyle` bracket/subscript, CHANGELOG 0.58.0
  entries at `CHANGELOG.md:1385-1399`) handles a **collection** index, not just
  an integer, and that the boolean-list index round-trips.
- **Desmos-vs-CE mismatch**: Desmos `L[L>0]` re-interprets the inner `L`
  element-wise; CE (Design A) instead evaluates `L>0` as a genuine broadcast
  producing a same-length boolean list, then masks. The results coincide for
  element-wise conditions. Note the semantic difference in docs: CE requires the
  mask list length to align with `L` positionally (mask entries past the end
  contribute nothing — `collections.ts:1243-1249`).

## Precedent (already in the engine)

- **`When` masking** (`control-structures.ts`, `2026-05-22-058-a2-restrictions.md`
  Task A2.4): `When(e, cond)` returns `Undefined` when `cond` is `False` — a
  *scalar* restriction mask for plot domains. Related concept (mask by boolean),
  different surface (single value, not list filtering).
- **`At` boolean-mask + integer-list index** (`collections.ts:1233-1264`): the
  A3 list work added mask/index-list modes to `At`. The evaluate handler is done;
  only the *type gate* on the index blocks the Desmos condition surface.
- **`Filter`** (`collections.ts:907-923`): predicate-over-element filtering,
  fully working.

The A3 mask machinery being present but unreachable (blocked by the index type)
is the key surprise — this plan is mostly "unblock the input to code that
already works" rather than new filtering logic.

## Tasks (each independently landable)

### T1 — Broadcast relational operators (depends on honest-typing plan)

- Add `broadcastable: true` to `Greater`, `Less`, `GreaterEqual`, `LessEqual`,
  `Equal`, `NotEqual` (locate in `library/relational-operators.ts` /
  `library/core.ts` — grep the definitions). ~6 lines.
- Ensure the honest `list<boolean>` result type lands (sibling plan T3). If
  landing before the sibling plan, add a local type handler returning
  `list<boolean>` for the list-operand case as a bridge.
- Guard: relational broadcast must not disturb scalar comparisons
  (`1 > 2` → `False`) or symbolic ones (`x > 0` stays symbolic). Only a
  *finite indexed collection* operand triggers the zip.

Tests: `[-1,2,-3] > 0` → `[False,True,False]`, type `list<boolean>`;
`|[1...5]-2| > 0` → `[True,False,True,True,True]`; scalar/symbolic comparisons
unchanged.

### T2 — `L[condition]` end-to-end filtering

Goal: `L[L>0]`, `L[d=4]`, `L[|[1...length(L)]-i|>0]` validate and evaluate.

- With T1 + honest typing, the condition is `list<boolean>` and satisfies `At`'s
  index signature (`collections.ts:1196-1197`) with **no signature change**.
  Confirm; only widen the signature if a residual scalar-boolean path remains.
- Verify `At` mask mode (`:1233-1264`) fires for the broadcast boolean list.
- Add `r_{emove}` and the corpus rows as regression tests.

Tests: `L[L>0]` with `L=[-1,2,-3,4]` → `[2,4]`; `remove([10,20,30],2)` →
`[10,30]`; a condition+integer combination; assert `isValid` and correct value.

### T3 — LaTeX round-trip

- Parse: confirm `L[cond]`, `L[d=4]` (Equal), and nested-bracket conditions
  parse to `At(L, cond)` (mostly verified; add tests).
- Serialize: `At(L, <boolean-list-condition>)` round-trips to a bracket form.
  Extend/verify the `At` serializer for collection indices.

Tests: parse/serialize round-trip for `L[L>0]`, `L[|[1...5]-2|>0]`; assert
`parse(serialize(x)).isSame(x)` (or canonical equality) for the filter shapes.

## Test plan & landing policy

- New `test/compute-engine/list-filtering.test.ts` covering T1-T3, plus the
  corpus rows.
- Exactness contract: filtering preserves element exactness — assert `L[L>0]`
  over exact rationals stays exact under `evaluate` and numericizes under `.N()`.
  Use `.isSame` for internal element comparisons; **no `.simplify()`** in `At`
  canonical/evaluate paths.
- **Non-interference (must stay green)**: `a3-lists.test.ts` (At mask/index
  modes, function-application broadcast), `collections.test.ts` (Filter, At
  dictionary/integer access), `parser-component-access.test.ts` (`.x` / `[i]`
  access), `logic.test.ts` (scalar relational operators),
  `parser-desmos-composition.test.ts`.
- **Snapshot blast-radius measurement REQUIRED before landing (repo policy).**
  Making relational operators broadcastable changes the type/value of every
  `list <relop> scalar` expression (previously symbolic scalar `boolean`, now a
  broadcast `list<boolean>`). Run the full suite, count changed snapshots,
  enumerate them, and hand-verify each is a correct scalar→list upgrade. Watch
  `logic.test.ts` and any snapshot asserting `list > scalar` stayed symbolic.
  **Never `-u` an `@fixme` snapshot.** Surface a large/debatable diff for review.
- Circular-deps budget: adding `broadcastable` flags touches only library data,
  but re-run `npx madge --circular --extensions ts src/compute-engine` if any
  helper import is added.
- Acceptance: replay the 2026-07-07 Desmos corpus coverage harness (session
  scratchpad `ce-coverage/`) — the 13+ list-filtering rows should clear.

## Risks / unknowns

- **Making `Equal` broadcastable is delicate.** `Equal` over two lists could be
  read as "are these lists equal?" (scalar) vs "elementwise equality"
  (`list<boolean>`). Desmos `d=4` in index position wants elementwise. Verify
  this does not break structural list equality used elsewhere (`Equal(L, M)` for
  whole-list comparison). May need to restrict elementwise `Equal` broadcast to
  the *list-vs-scalar* case, or route filter-context `=` differently. Resolve
  before enabling `Equal` broadcast globally — this is the highest-risk item.
- **Dependency ordering**: the symbolic `L>0` (declared list symbol) needs the
  honest-typing plan; the literal case needs the broadcast. Land the honest-
  typing plan's relational-typing piece first, or co-land, to avoid a window
  where `At`'s validation still sees scalar `boolean`.
- **Mask alignment semantics**: CE masks positionally; a mask shorter/longer than
  `L` silently truncates (`collections.ts:1243-1249`). Confirm this matches
  Desmos (which errors on length mismatch?) and document any divergence.
- **`=` parsing in bracket context**: ensure `L[d=4]` keeps `=` as `Equal`, not
  `Assign`/`Rule`, in every bracket-parse path.
- **Performance**: broadcasting a comparison over a large list materializes a
  full boolean list before masking. Acceptable for corpus sizes; note as a
  future optimization (Design B fusion) if it matters.

## Context

- Corpus evidence: 2026-07-07 Desmos corpus review (13+ list-filtering rows;
  coverage reports in session scratchpad `ce-coverage/`, source corpus in
  tycho's `desmos-corpus`).
- Sibling plan (hard dependency): `docs/plans/2026-07-07-honest-list-broadcast-
  typing.md` — supplies the `list<boolean>` relational-broadcast type that lets
  `At` accept the condition.
- Precedent docs: `docs/plans/2026-05-22-058-a2-restrictions.md` (`When`
  masking), CHANGELOG 0.58.0 (`At` dictionary access, `indexStyle` serialize,
  A3 collection indexing at `CHANGELOG.md:1329-1399`).
