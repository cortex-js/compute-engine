# Honest Result Typing for List-Broadcast Numeric Operators

**Status: PLANNED — not started**

## Motivation

A broadcastable numeric operator applied to a List operand produces a **List
value** but reports a **scalar type**. The value/type contract is violated:
downstream code that trusts the declared type (argument validation, canonical
guards, `At` index checking) misfires on expressions that are actually lists.

Verified on main today (2026-07-07, `npx tsx` probes from repo root):

| Expression | value (`.evaluate()`) | value type | **declared type** (`.type`) |
|---|---|---|---|
| `[1,2]\cdot 2` (parsed, canonical) | `[2,4]` | `vector<2>` | **`finite_number`** |
| `Multiply(List(0,0,1,1), x)` | `[0,0,x,x]` | `vector<4>` | **`finite_number`** |
| `Multiply(2, List(1,2))` | `[2,4]` | `vector<2>` | **`finite_number`** |
| `Sin(List(t,1))` | `[sin(t),sin(1)]` | `list<finite_number>` | **`finite_number`** |
| `Add(List(1,2), x)` | `[x+1,x+2]` | `vector<2>` | `number \| vector<2>` |
| `Negate(List(a,b))` | `[-a,-b]` | `list<real>` | `vector<2>` |

The type is computed by the operator's `type` handler (called with the raw
operands) in `boxed-function.ts` `type()`
(`src/compute-engine/boxed-expression/boxed-function.ts:1762`, handler dispatch
at `:1797-1805`). **Nothing in that path is broadcast-aware** — the handler
returns the *scalar* result type and no wrapper turns it into `list<…>` even
though the value path (steps 2 / 4b) will zip the operands into a List. Two
handlers accidentally leak the list type: `Negate` returns `x.type` verbatim
(`arithmetic.ts:1430`, clean `vector<2>`), and `Add`'s `addType`
(`arithmetic-add.ts:191-224`) ends in `widen(...)` and reports a *union*
`number | vector<2>` (also wrong — the result is always the list). Everything
else — `Multiply`, all of trigonometry, special functions — reports a pure
scalar.

### Downstream consequences (evidence)

Because a list-broadcast result claims a scalar `number`/`boolean` type,
type-trusting code cannot distinguish it from a genuine scalar:

- **The tuple-point canonical guard** (`arithmetic-add.ts:50-54`, landing
  today) rejects `scalar + tuple`. It cannot use the honest test
  `isSubtype(op.type, 'number')` for "is this a scalar", because a mislabeled
  list operand also matches `number`. It was therefore narrowed to
  `isDeclaredScalarNumber` (`collection-utils.ts:52-59`), which additionally
  requires the number-type to be a *literal or explicit declaration* (not
  inferred). That `inferredType`/`inferredSignature` exclusion is the **stopgap**
  this plan removes the need for.
- **`At` index validation** (Doc 2, `2026-07-07-desmos-list-filtering.md`)
  rejects `L[L>0]` because the relational broadcast `L>0` reports scalar
  `boolean` instead of `list<boolean>`, so it fails the `indexed_collection`
  index signature. Honest typing here is a **prerequisite** for that plan's
  symbolic case.

The corpus evidence for both symptoms lives in the 2026-07-07 Desmos corpus
replay (session scratchpad `ce-coverage/` reports and tycho's `desmos-corpus`).

## Design

When a `broadcastable` operator has at least one **finite indexed collection**
operand and the broadcast is not skipped (`skipBroadcastForVectorOps` is false —
i.e. it is a genuine List broadcast, not a tensor or numeric-tuple vector-op),
the declared result type must be the broadcast type:

- `list<R>` where `R` is the scalar per-element result type the handler already
  computes, and
- with **length propagation** when statically known: if some collection operand
  has a fixed-length type (`vector<n>`, `list<T, n>`, or a literal `List` with
  `n` operands), the result is `vector<n>` / `list<R, n>`; otherwise `list<R>`.

This matches what the **value** path already produces (`vector<2>`,
`vector<4>`, `list<finite_number>` in the table above).

**Centralize, don't scatter.** Rather than edit ~92 individual type handlers,
wrap the result once in `boxed-function.ts` `type()`: after `sigResult` is
computed from the handler (`:1797-1837`), if the operator is broadcastable with
a collection operand (same predicate the value path uses), map the *element*
result type `R = sigResult` to the broadcast type. The handler keeps computing
the scalar per-element type; the wrapper lifts it. This keeps the exactness /
non-finite conventions each handler already encodes and applies uniformly to
trig, special functions, `Multiply`, etc.

Design principles to respect:

- **Exactness contract** is unaffected — this is a *type-surface* change, not an
  evaluate change; no `.simplify()`, no value recomputation in the type path.
- **`.isSame` for internal comparisons** where any literal checks are added.
- **Zero-circular-deps**: the wrapper lives in `boxed-function.ts` (already
  imports the type utilities and `isFiniteIndexedCollection`); length/element
  helpers go in `common/type/utils.ts` or `collection-utils.ts` (type-only, no
  boxed-arithmetic import). Re-run `npx madge --circular --extensions ts
  src/compute-engine` after wiring.

### Interaction with adjacent subsystems (verified)

- **Numeric tuples / points** (`2026-07-07-tuple-point-semantics.md`, landing
  today) are handled *separately and earlier* and must stay that way:
  `skipBroadcastForVectorOps` (`boxed-function.ts:1569-1586`) excludes
  `Add`/`Multiply`/`Negate`/`Subtract`/`Divide` when an operand
  `isNumericTuple`, and the tuple type handlers (`addType:200-201`,
  `Multiply.type:1292-1293`, `Negate` `x.type`) already return the tuple type.
  The broadcast wrapper must use the **same skip predicate** so it never turns a
  point into `list<…>`.
- **Tensors** are likewise excluded from the List broadcast for `Add`/`Multiply`
  (`skipBroadcastForVectorOps:1574-1575`) and have their own `addTensors`/
  `mulTensors` typing. The wrapper's guard (broadcast-would-fire) inherits this
  exclusion, so a matrix `Add`/`Multiply` result type is untouched. Non-Add/
  Multiply broadcastable ops over a tensor (`Sin(matrix)`) currently broadcast
  into a List at step 4b, so their honest type is `list<…>` too — verify against
  `linear-algebra.test.ts`.
- **`Add`/`Multiply`'s existing partial leakage** (`number | vector<2>`,
  `vector<2>`) is *superseded* by the wrapper. Once centralized, `addType`'s
  final `widen` and `Multiply`'s finiteness branches should compute only the
  **element** type; the wrapper adds the list-ness. This removes the current
  union artifact.

## Shared helper (prerequisite)

`broadcastResultType(elementType: Type, ops): Type` — given the scalar
per-element result and the operands, produce `list<elementType>` or
`vector<n>` / `list<elementType, n>` when a collection operand pins the length.
Reuse the existing length/element extraction (`collectionElementType`,
`type/utils.ts`; the `vector<n>` machinery already used by `a3-lists`).

- Location: `src/common/type/utils.ts` (type-only, imported broadly, no cycle
  risk). ~25 lines + unit test.

## Tasks (each independently landable)

### T1 — Centralized broadcast type wrapper (core)

Goal: every broadcastable numeric operator over a List reports `list<R>` /
`vector<n>`, matching its value.

1. Add `broadcastResultType` to `common/type/utils.ts` (helper above).
2. In `boxed-function.ts` `type()` (`:1786-1838`), after `sigResult` is finalized
   from the handler, compute `willBroadcast = def.broadcastable &&
   ops.some(isFiniteIndexedCollection) && !skipBroadcastForVectorOps(operator,
   hasTensors, ops)`; if `willBroadcast`, return
   `broadcastResultType(sigResult, ops)`. ~20 lines.
3. Confirm the predicate matches the **value** path exactly (steps 2 `:1286-1290`
   and 4b `:1354-1359`) so type and value never disagree, including the step-4b
   Add/Multiply exclusion for operands that *become* collections after
   evaluation (`Sqrt(A·B)` → matrix). Symbolic operands that only become lists
   at evaluate (a declared-`list` symbol) type honestly here because their
   *declared* type already `isFiniteIndexedCollection`-matches.

Tests: new `test/compute-engine/list-broadcast-typing.test.ts` — for each of
`[1,2]*2`, `2*[1,2]`, `Sin([0,1])`, `[1,2]+x`, `Multiply(List,x)`: assert
`.type` is `vector<n>`/`list<…>` **and** equals `.evaluate().type`. Exactness
counterpart: assert the type is stable under `.N()` and that the value path is
unchanged.

### T2 — De-duplicate the leaked list-ness in `Add`/`Multiply`

Goal: with T1's wrapper in place, `addType` and `Multiply.type` compute only the
**element** (scalar) type; the wrapper adds list-ness. Removes the
`number | vector<2>` union artifact.

- `addType` (`arithmetic-add.ts:191-224`): the final `widen(...)` should widen
  the *element* types of collection operands, not the collection types
  themselves, when the wrapper will lift the result. Keep the numeric-tuple
  branch (`:200-201`) untouched (tuples are skip-listed, not wrapped).
- `Multiply.type` (`arithmetic.ts:1286-1320`): same — keep the tuple branch
  (`:1292-1293`); let the wrapper handle the List case.
- ~20 lines. Guard against regressing the non-finite conventions the branches
  encode (they compute per-element finiteness correctly for scalar operands).

Tests: `Add(List,x)` → `vector<2>` (not `number | vector<2>`); `Multiply(List,x)`
→ `vector<4>`; scalar `Add`/`Multiply` unchanged.

### T3 — Sweep the shared generic handlers

Goal: verify the centralized wrapper covers every broadcastable operator with no
per-handler edits, and catalogue the ~92 broadcastable operators
(`grep -rc 'broadcastable: true' src/compute-engine/library` — arithmetic 51,
trig 11, logic 8, special-functions 7, complex 6, colors 5, core 4).

- Shared handlers `numericTypeHandler` (`type-handlers.ts:35-39`),
  `elementaryFunctionType` (`:179`), `logType`, `roundingFunctionType`, and the
  trig `type: () => 'finite_real'` handlers all compute a scalar per-element
  type — correct as **element** types under the wrapper. No edits expected;
  add assertions per family instead.
- **Logic operators** (`And`/`Or`/`Not`/comparison, if broadcastable) produce
  `list<boolean>`. This is the type Doc 2 (`desmos-list-filtering`) depends on —
  add an explicit `list<boolean>` assertion to hand off.

Tests: one representative per family (`Cos([0,1])`, `Ln([1,2])`,
`Round([1.2,2.7])`, `Erf([0,1])`, `Re([1+i,2])`, a broadcast comparison) →
`list<…>` element type correct.

### T4 — Revert the stopgap scalar-narrowing (last)

Goal: with list-broadcast results honestly typed, a scalar-typed operand is
genuinely scalar, so the tuple guard no longer needs the inferred-type
exclusion.

- Re-evaluate `isDeclaredScalarNumber` (`collection-utils.ts:52-59`): once
  `Multiply(List,x)` etc. report `list<number>` rather than `number`, the
  `inferredType`/`inferredSignature` exclusion is no longer load-bearing for
  *distinguishing lists from scalars*. **Caution**: it may still be wanted for
  the *retractable-inference* reason stated in its doc comment (a forward
  reference later resolving to a tuple). Decide explicitly: either (a) keep it
  for inference-retractability only, with an updated comment removing the
  "mislabeled list" rationale, or (b) broaden the tuple guard back to
  `isSubtype(op.type,'number') && !isNumericTuple` and delete the helper. Land
  this **after** T1-T3 are green and the corpus is re-checked.
- Update `At` index handling in Doc 2 to rely on the honest `list<boolean>`
  type (cross-reference).

Tests: the tuple-point suite (`points-arithmetic.test.ts`) stays green under the
chosen option; `1+(2,3)` still errors; a mislabeled-list case that previously
needed the narrowing (`Multiply(List,x) + (1,2)`) behaves correctly.

## Test plan & landing policy

- Per-task unit tests as above, plus a new
  `test/compute-engine/list-broadcast-typing.test.ts` asserting
  `expr.type === expr.evaluate().type` across the operator families.
- **Non-interference suite (must stay green unchanged)**:
  `a3-lists.test.ts:160-206, 284-347` (list element-type + function-application
  broadcast), `linear-algebra.test.ts` (tensor Add/Multiply typing),
  `points-arithmetic.test.ts` / tuple-point suite (skip-listed vector ops),
  `colors.test.ts`, `non-finite-typing.test.ts` (per-element finiteness
  conventions must survive the element/wrapper split),
  `correctness-p2-roundtrips.test.ts`.
- Exactness contract: type-only change; add `.N()` type-stability assertions;
  **no `.simplify()`** anywhere in the type path.
- **Snapshot blast-radius measurement REQUIRED before landing (repo policy).**
  This is **engine-wide type-surface churn**: the reported type of *every*
  broadcastable operator over a list changes from scalar to `list<…>`. Run the
  full suite, count changed snapshots, and enumerate them. Expect churn wherever
  a snapshot prints the `.type` of a list-arithmetic or list-trig expression
  (`a3-lists`, `parser-desmos-composition`, `parser-for-comprehension`,
  `application-validation-regressions`, `wester`, plus any error-message
  snapshot that embedded the old scalar type). Hand-verify each flip is a
  correct scalar→list upgrade, not a regression. **Never `-u` an `@fixme`
  snapshot.** If the count is large or any flip is debatable, surface it for
  review before landing rather than absorbing silently.
- Circular-deps budget: re-run `npx madge --circular --extensions ts
  src/compute-engine` after adding the helper and wiring `type()`.
- Acceptance: replay the 2026-07-07 Desmos corpus coverage harness (session
  scratchpad `ce-coverage/`) and confirm no new failures; confirm Doc 2's
  `L[L>0]` symbolic case is unblocked by the honest `list<boolean>` type.

## Risks / unknowns

- **Broad snapshot churn** is the dominant risk — this touches the declared type
  of many common expressions. Mitigate by staging: land T1 (wrapper) alone,
  measure, then T2/T3. A large or surprising diff is a reason to pause and
  review, per repo policy.
- **Element vs collection type in shared handlers**: some handlers inspect
  operand *finiteness* (`x.isFinite`, `numericTypeHandler:36`). For a **List**
  operand, `isFinite` is `undefined`/`false` (a collection is not a finite
  number), which currently pushes handlers toward `number`. Under the wrapper we
  want the handler to reason about the **element** type, not the collection.
  Options: (a) have the wrapper compute `R` from the *element* types (pass
  `collectionElementType(op.type)` into a re-invocation of the handler), or
  (b) accept that `R` may widen to `number` for such handlers and only fix the
  list-ness. Prefer (a) for `Add`/`Multiply` where the value is precise; verify
  against the non-finite convention tests. Decide during T1.
- **Step-4b post-evaluation broadcast** (`:1354-1359`, `Sqrt(A·B)`→matrix): the
  *declared* type cannot see that a scalar-typed sub-expression will become a
  collection at evaluate, so its declared type stays scalar while the value is a
  list. This is a pre-existing limitation (the operand isn't a collection until
  evaluated); document it as out of scope — honest typing is achievable only
  when a collection operand is statically visible.
- **Union-typed operands** (`number | vector<2>` from today's `Add`): after T2
  these disappear, but guard against a handler receiving such a union during the
  transition.
- **`isFiniteIndexedCollection` cost** in the type path: `type()` is hot. The
  predicate is already computed in the value path; ensure the type-path call is
  cheap (it inspects `isFiniteCollection`/`isIndexedCollection`, no evaluation).

## Context

- Corpus evidence: 2026-07-07 Desmos corpus review (coverage reports in session
  scratchpad `ce-coverage/`; source corpus in tycho's `desmos-corpus`).
- Sibling plans: `docs/plans/2026-07-07-tuple-point-semantics.md` (numeric
  tuples, the skip-listed vector-op path and the `isDeclaredScalarNumber`
  stopgap this plan retires) and `docs/plans/2026-07-07-desmos-list-filtering.md`
  (consumes the honest `list<boolean>` relational-broadcast type).
