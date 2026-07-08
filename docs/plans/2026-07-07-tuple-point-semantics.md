# Vector-Space Semantics for Numeric Tuples (Points)

**Status: PLANNED — not started**

## Motivation

The 2026-07-07 Desmos corpus review found that the single largest cluster of
genuine parse/canonicalization failures (~30 of 78 rows) is point/tuple
arithmetic: `t^2\cdot(z_0.x, z_0.y)`, `point − list offsets`,
`\operatorname{vector}(…)`, and color functions over lists all die with
`incompatible-type`. Probing current main also exposed outright bugs in the
existing (accidental, literal-only) tuple broadcasting.

## Approved design (decided 2026-07-07)

Numeric tuples — `Tuple`/`Pair`/`Triple` whose elements are all
number-typed, i.e. type `tuple<number,…>` — are **points/vectors in ℝⁿ**,
semantically distinct from Lists:

1. `tuple ± tuple` (equal length) → Tuple, component-wise. Unequal lengths →
   error.
2. `scalar · tuple`, `tuple / scalar`, `−tuple` → Tuple.
3. `scalar + tuple` → **Error** (`incompatible-type`), NOT broadcast. This is
   a deliberate behavior change (today it broadcasts to a List). Desmos also
   rejects point+number.
4. `tuple · tuple` → error (no implicit dot product).
5. Results **stay Tuple** — never degrade to List — and type handlers report
   tuple types (fixing the current type-says-`number`/value-is-List
   unsoundness).
6. Works **symbolically**: a symbol declared `tuple<number, number>`
   participates (`z + (1,2)` stays a valid symbolic `Add` typed
   `tuple<number,number>`).
7. Member access `.x`/`.y`/`.z` works on tuple-typed expressions and symbols.
8. **Lists keep their existing broadcast semantics unchanged**
   (`2\cdot[1,2] → [2,4]`, `1+[2,3] → [3,4]`).

## Verified bugs on main (2026-07-07)

- `(1,2)-(3,4)` → `[1 + [-3,-4], 2 + [-3,-4]]` — wrong answer (should be
  `(-2,-2)`).
- `(1,2)+(3,4)` → List `[4,6]` while the declared type is
  `tuple<number,number>` (value/type mismatch; result also loses point-ness).
- `1+(2,3)` → `[3,4]` (accepted; becomes an error under the new design).
- `z+(1,2)` with `z: tuple<number,number>` → `incompatible-type` (broadcast
  is literal-only).
- `z.x` → `incompatible-type 'collection' ← tuple<number,number>`.

## How tuples flow through the engine today (verified file:line)

**Broadcast fires at evaluation, not canonicalization.**

- `tuple<number,…>` is a subtype of `indexed_collection`
  (`src/common/type/subtype.ts:676-679`), so a **literal** Tuple's
  `isIndexedCollection` is true (`boxed-function.ts:1167-1180`, via the
  `collection.at` handler from `basicIndexedCollectionHandlers()`,
  `collections.ts:254-259`) and `isFiniteIndexedCollection`
  (`collection-utils.ts:16-17`) is true.
- The generic broadcast in `boxed-function.ts` `_computeValue` step 2
  (`:1284-1302`), step 4b (`:1352-1371`), and the async twins
  (`:1432-1456`, `:1498-1520`) fire for any `broadcastable` operator with a
  finite indexed collection operand. Add/Multiply/Negate/Subtract/Divide are
  all `broadcastable: true` (`arithmetic.ts:256, 1281, 1428, 1983, 375`).
  The `skipBroadcastForTensors` guard excludes tensors but not tuples — so
  tuples get zipped into a **List**.
- The subtraction garbage: `Subtract` canonicalizes to `Add(a, Negate(b))`
  (`arithmetic.ts:1987-1993`); `negate()` (`negate.ts:62`) leaves
  `Negate((3,4))` symbolic (it only distributes over
  number/Add/Multiply/Divide). At evaluate, `Add((1,2), Negate((3,4)))` zips
  the tuple while treating `Negate((3,4))` as an opaque scalar; each
  component's `Add(k, Negate((3,4)))` then triggers its own nested broadcast.
- Type handlers are mostly right already (`addType`,
  `arithmetic-add.ts:174-199`, widens to the tuple type) — the **value** side
  is what's wrong.
- Symbolic/typed tuples fail earlier, in validation: `checkNumericArgs`
  (`validate.ts:118-249`) — `typeCouldBeNumericCollection` (`validate.ts:45-58`)
  covers only list/set/collection, and a bare symbol has no collection
  handlers, so a tuple-typed symbol falls through to `typeError('number', …)`.
- Member access: `z.x` parses to `['First', z]`
  (`definitions-core.ts:37-53, 65-117`); `First.evaluate`
  (`collections.ts:1374-1387`) errors when `!xs.isCollection`; for a symbol,
  `isCollection` (`boxed-symbol.ts:817-822`) requires collection handlers,
  which a type-only declaration never gets
  (`boxed-value-definition.ts:162-164`).

**Non-interference (confirmed safe):**

- `Sum`/`Product` are `lazy: true, broadcastable: false`
  (`arithmetic.ts:2560, 2487`); their `tuple<integer,…>` bounds go through
  `canonicalBigop`, never through Add/Multiply operands. Integral limits
  (`Triple`) likewise lazy. Locked by `arithmetic.test.ts:1567`.
- `Distance` (`arithmetic.ts:2444-2479`) builds scalar `Subtract(aᵢ,bᵢ)` from
  components, never `tuple−tuple`. Locked by
  `exactness-regressions.test.ts:487`.
- List broadcast untouched; locked by `a3-lists.test.ts:320-347`.

## Shared helper (prerequisite for T1–T3)

`isNumericTuple(expr): boolean` — **type-based** (covers literals AND typed
symbols): `expr.type.type` has `kind === 'tuple'` and every element type
`isSubtype(elt, 'number')`. Companions: `numericTupleArity(expr)` (element
count when statically known) and `hasAccessibleComponents(expr)` (literal
Tuple whose `.at(i)` returns real operands — decides "compute component-wise
now" vs "stay symbolic").

- Location: `src/compute-engine/collection-utils.ts` (low-level, imported
  broadly, no cycle risk — madge confirmed clean for `arithmetic-add.ts`).
  Keep it type-only; do not import boxed-arithmetic there.
- Size: ~25 lines + unit test.

## Tasks (each independently landable)

### T1 — Correctness fixes + Tuple-preserving literal arithmetic

Goal: `(1,2)±(3,4)`, `−(3,4)`, `2\cdot(1,2)`, `(1,2)/2` evaluate to
**Tuples**, component-wise; equal length enforced.

1. **Gate the broadcast**: generalize `skipBroadcastForTensors`
   (`boxed-function.ts:1281-1283, 1429-1431`) to
   `skipBroadcastForVectorOps = (hasTensors || ops.some(isNumericTuple)) &&
   operator ∈ {Add, Multiply, Negate, Subtract, Divide}`. Apply at all four
   broadcast sites (`:1284`, `:1352-1356` — extend step 4b's
   `Add`/`Multiply`-only exclusion list to Negate/Divide/Subtract when a
   numeric tuple is present — `:1432`, `:1498-1502`). ~15 lines.
2. **Component-wise addition** (`arithmetic-add.ts`): in `add()`/`addN()`,
   before `Terms`, `if (xs.some(isNumericTuple)) return addTuples(…)`.
   `addTuples`: all-literal equal-arity → `ce.tuple(...componentSums)` with
   each component summed through scalar `add` (preserves exactness);
   unequal arity → `ce.error('incompatible-type')`; scalar present →
   defensive error (T2 makes it canonical-time); symbolic tuple operand →
   return symbolic `Add` unchanged. ~40 lines.
3. **Component-wise negation** (`negate.ts:8-20, 29-63`): in `negate()` and
   `canonicalNegate()`, `if (isNumericTuple(expr) &&
   hasAccessibleComponents(expr)) return ce.tuple(...ops.map(op =>
   op.neg()))`. Makes `Negate((3,4))` → `Tuple(-3,-4)` at canonicalization,
   so the Subtract lowering feeds `addTuples` two real Tuples — fixing
   `(1,2)-(3,4)` structurally. Symbolic `Negate(z)` stays symbolic. ~10 lines.
4. **Scalar·tuple / tuple÷scalar** (`arithmetic-mul-div.ts:1310-1341, 650`):
   in `mul()`/`mulN()`, `mulTuples`: exactly one tuple + scalars → scale each
   component; ≥2 tuples → error; symbolic tuple → symbolic Multiply. Divide:
   `tuple/scalar` → scale by reciprocal; `scalar/tuple`, `tuple/tuple` →
   error (hardened in T2). ~45 lines.

Tests: new `test/compute-engine/points-arithmetic.test.ts` —
`(1,2)+(3,4)→(4,6)`, `(1,2)-(3,4)→(-2,-2)`, `-(3,4)→(-3,-4)`,
`2(1,2)→(2,4)`, `(1,2)/2→(1/2,1)`, `(1,2)+(1,2,3)→Error`; **assert result
operator is `Tuple`** and type is `tuple<…>` in every case. Exactness:
`(1,2)/3` stays exact rationals under `evaluate`, numericizes under `.N()`.

### T2 — Reject `scalar + tuple` and `tuple · tuple` at canonicalization

Goal: `1+(2,3)`, `(1,2)\cdot(3,4)`, `1/(2,3)` → `Error('incompatible-type')`.
Deliberate behavior change.

- Enforce in `canonicalAdd` (`arithmetic-add.ts:32`), `canonicalMultiply`
  (`arithmetic-mul-div.ts:1009`), `canonicalDivide` (`:650`).
- **Guard must be provable, not speculative**: error only when one operand is
  provably scalar (`isSubtype(op.type, 'number')`, not a tuple) AND another is
  provably a numeric tuple. Unknown/`any`-typed symbols → stay symbolic (lets
  inference resolve later; preserves T3's `z + (1,2)` path).
- Result is `isValid === false`, so `evaluate` short-circuits
  (`boxed-function.ts:1261`) — no second guard needed at the broadcast sites.
- ~25 lines across three handlers.

Tests: `1+(2,3)`, `(2,3)+1`, `(1,2)*(3,4)`, `1/(2,3)`, `(1,2)/(3,4)` →
`operator === 'Error'`, code `incompatible-type`.

### T3 — Symbolic / typed-tuple support (validation, type handlers)

Goal: `z: tuple<number,number>` participates; `t^2\cdot(z.x, z.y)`
canonicalizes valid.

1. `typeCouldBeNumericTuple(type)` in `validate.ts`, admitted in
   `checkNumericArgs` alongside `typeCouldBeNumericCollection`
   (`:186-190`) — pass-through branch (like tensors), do NOT widen-infer
   elements to `real`. ~15 lines.
2. The strict re-validation gate (`box.ts:790-804`) calls the same
   `checkNumericArgs`, so it inherits the fix — add a regression test that
   `z+(1,2)` stays `isValid` through it.
3. `validateArguments` threadable path (`validate.ts:391-397, 451-458,
   505-511`) already admits tuples via `typeCouldBeCollection` (`:32`) —
   confirm, no change expected.
4. **Type handlers**: `addType` (`arithmetic-add.ts:174`) — hoist an
   all-tuple branch to the top returning component-wise-widened `tuple<…>`;
   the NaN/finite early-returns (`:177-192`) call `x.isNaN`/`x.isFinite`
   which are `undefined` for tuples — verify they don't collapse to
   `number` first. `Multiply` type (`arithmetic.ts:1285`) — explicit
   scalar·tuple branch returning the tuple type. `Negate` type (`:1430`)
   already returns `x.type` — add a test.

Tests: `z+(1,2)` → valid symbolic `Add`, type `tuple<number,number>`;
`2\cdot z` → tuple type; `t^2\cdot(z.x,z.y)` canonical `isValid`.

### T4 — Member access on tuple-typed expressions

Goal: `z.x`/`z.y`/`z.z` work for `z: tuple<…>` without breaking
`First(1)→Error`.

- **4a. Relax the collection gate in `First`/`Second`/`Third`/`Last`**
  (`collections.ts:1374-1424`): if `xs.type.matches('indexed_collection')`
  (true for `tuple<…>`) — literal with accessible element → return it;
  otherwise return `undefined` (stay symbolic), not an error. Error only when
  provably NOT an indexed collection (preserves
  `parser-component-access.test.ts:113-117`). ~20 lines.
- **4b. Element type**: in the `type` handlers (`collections.ts:1377, 1392,
  1407`), when `collection.elttype` is absent (symbolic operand), derive the
  component type from `xs.type` tuple elements (fallback
  `collectionElementType`, `type/utils.ts:40-68`) so `First(z)` types as
  `number` — needed by T3. ~15 lines.
- **Deferred**: attaching type-derived collection handlers to tuple-typed
  value definitions (`boxed-value-definition.ts:162-164`) would make
  `isCollection`/`at` uniform for typed symbols, but ripples into every
  tuple-typed symbol's collection facet. Revisit only if symbolic
  `.each()`/`At(z,1)` ergonomics are needed later.

Tests: `z.x`/`z.y` → symbolic `First(z)`/`Second(z)`, type `number`, valid;
`(10,20).x → 10`; `1.x → Error` (regression); `(z.x, z.y)` builds
`tuple<number,number>`.

### T5 — Color constructors broadcastable (independent quick win)

- Add `broadcastable: true` to `Rgb`, `Hsv`, `Hsl`, `Oklab`, `Oklch`
  (`colors.ts:626-652`). Pure constructors; broadcast zips the List arg →
  `List(Hsv(0,1,0), Hsv(0,1,1))`. List arg, not tuple — T1/T2 don't
  interfere. ~5 lines.

Tests: `hsv(0,1,[0,1])` → List of two Hsv; `rgb([0,1],0,0)` broadcasts;
scalar call unchanged; check `colors.test.ts` for snapshots asserting the old
error.

## Test plan & landing policy

- Per-task unit tests as above; point arithmetic in
  `test/compute-engine/points-arithmetic.test.ts`.
- **Non-interference suite (must stay green unchanged)**:
  `arithmetic.test.ts:1567` (Sum tuple bounds),
  `exactness-regressions.test.ts:487` (Distance),
  `a3-lists.test.ts:320-347` (list broadcast),
  `a6-polish.test.ts:293-316` (tuple-as-function-arg parsing),
  `linear-algebra.test.ts` (tensor Add/Multiply),
  `subscript-evaluate.test.ts`, `collections.test.ts`,
  `parser-component-access.test.ts`.
- Exactness contract: every `evaluate` assertion gets an `.N()` counterpart;
  `.isSame` for internal comparisons; no `.simplify()` in canonical handlers.
- **Snapshot blast-radius measurement REQUIRED before landing** (repo
  policy): full suite, count changed snapshots. Expected churn concentrates
  in snapshots asserting `(a,b)+(c,d)→List`, `scalar+tuple→list` (now Error),
  color-broadcast error strings, tuple-typed `First` result types. Enumerate
  and hand-verify each flip.
- Circular-deps budget: helper lives in `collection-utils.ts`; re-run
  `npx madge --circular --extensions ts src/compute-engine` after wiring it
  into `negate.ts`/`arithmetic-mul-div.ts`/`validate.ts`.
- Acceptance: replay the Desmos corpus coverage harness (session scratchpad
  `ce-coverage/`) — the point-arithmetic cluster (~30 rows) should clear.

## Risks / unknowns

- **`negate()` is shared machinery** (called from `inv()`, product negation,
  Subtract). Gate strictly on `isNumericTuple && hasAccessibleComponents` so
  only literal numeric tuples distribute. Verify `-(matrix)` still routes
  through the tensor path (`isNumericTuple` is false for tensors — they type
  as `matrix`/`list`, not `tuple`).
- **`addType` early returns** may collapse to `number` on
  `undefined` NaN/finite checks before a tuple branch — hoist the tuple
  branch to the top (T3.4).
- **Broadcast step 4b** (`boxed-function.ts:1352`) only excludes
  Add/Multiply today; a tuple produced by a sub-expression
  (`-(f())` where `f()→(3,4)`) could still be hijacked — extend the
  exclusion list and test that case.
- **Unequal arity with static types** (`z+(1,2,3)`, `z: tuple<number,number>`):
  T2's guard won't fire (both tuples); errors at evaluate via `addTuples`.
  Open question: error at canonical when both arities are statically known?
  Currently deferred to evaluate.
- `tuple <: indexed_collection` is load-bearing for literal tuple
  iteration/compilation (a1-c1 compile parity, Distance, ascii-math
  `((1,2),(3,4))` snapshot) — but nothing depends on tuple **arithmetic**
  producing a List, so removing the broadcast carve-out is safe. The single
  semantic reversal is `scalar+tuple` (T2), which is intentional.

## Context

- Corpus evidence: 2026-07-07 Desmos corpus review (fresh coverage reports in
  session scratchpad `ce-coverage/`); ~30 of 78 genuine corpus failures are
  this cluster, plus ~5 more from T5.
- Desmos semantics reference: Desmos rejects point+number, rejects
  point·point, supports point±point / scalar·point / point÷scalar.
