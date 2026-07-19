# Expected-Type Inference Context

**Status:** CLOSED — not planned (re-assessed and closed 2026-07-18, round
3; see end of §0). Two dual-reviewer rounds
(round 1: `docs/scratch/2026-07-18-expected-type-inference-context_SPEC_REVIEW.md`;
round 2 findings summarized in §0) plus a doctrine discussion led to a
**user-ratified disposition (2026-07-18)**: the performance defect is fixed
by the *surgical* forward-log change described in §0 instead; this document
is the design record and the starting point if a revival trigger (below)
ever fires.
**Date:** 2026-07-18

## 0. Disposition (read this first)

**What shipped instead — the forward-log fix.** The inference transaction's
only real defect was *how* it computes provenance: an eager snapshot of all
inferred symbols via a full scope-chain walk on every top-level box (the
~1.4× engine-wide drift; `π.N()@200d` 21× slower). The question it answers —
"which symbols were first inferred during this top-level box?" — is computed
*forward* instead: `BoxedSymbol.infer()` is the single choke point for
fresh inference, so the transaction now holds a lazily-allocated set of
value-definitions that `infer()` appends to on an unknown→concrete type
transition. `repairFreshMatrixInference`'s eligibility becomes "the resolved
definition is in this box's log — or is still unknown-typed" (exactly
today's snapshot-difference predicate, minus a name-vs-definition-identity
imprecision across popped scopes, where the log is *more* correct). Repair
timing, plan, verify, rollback: all unchanged. Behavior-identical on every
probe row P1–P11 below, on `Sequence`/`Nothing` flattening, unions, supplied
optionals, and exceptions — because the repair remains post-hoc and
alignment-agnostic.

**Why not this structural design (yet).** Round 2 falsified v2's masking
doctrine on four fronts (numeric operators bypass the central site via
`makeNumericFunction` and work by *ambient inheritance*; `Subtract` is a
custom canonical handler that must not be masked; `matrix|vector` *does*
`match('matrix')` and `LinearSolve` promotes through it today;
`CharacteristicPolynomial(A+B, x)` promotes through a supplied optional).
The corrected doctrine that survives all findings:

- **Ambient propagation, no masking.** Over-deferral is *self-healing*:
  the failure-triggered resolution (default-to-`number` first → conservative
  plan → verify-and-fallback) reduces any stray deferral to today's
  behavior. Masking defends against a hazard the algorithm already absorbs.
- **Defer only the bottom-up numeric guess** (`checkNumericArgs`'s fresh-
  symbol inference). Signature-driven inference keeps firing — a declared
  parameter is evidence of the same standing as the matrix parameter.
- **Per-operand context from the signature at the general path's operand
  map** (which feeds custom-handler and default branches alike), gated by
  `matches('matrix')` — which means "*this parameter can accept a matrix*",
  unions included.

Even so corrected, the residual risk/benefit lost to the surgical fix: the
design still keeps the plan, verify, fallback, and generation-bump
machinery; and two edges remain genuinely unsolved inside the paradigm —
the `Sequence`-fed matrix parameter (context is assigned before flattening,
so the operand that lands in the matrix position was canonicalized without
it, and no provenance exists to resolve) and exception-path semantics
(a throw mid-canonicalization strands deferred symbols as `unknown`).
Both are non-issues for the post-hoc repair. If this design is revived,
those two edges plus P1–P11 and the round-1/round-2 findings are the
acceptance suite.

**Round 3 — re-assessment and closure (2026-07-18, later the same day).**
The roadmap item tracking this design was revisited and **closed**:

- *Performance:* extinguished. The forward-log fix measures exactly at the
  no-op-stub ceiling (`π.N()@200d` 0.120 µs; benchmark median 1.09× faster
  than 0.73.0). The structural design can recover nothing further.
- *Architecture:* doesn't stand alone. What v3 deletes (failure-path
  re-boxing, transaction counters, rollback bookkeeping — ~100 pinned lines
  whose expensive part runs only on the near-never matrix-mismatch path) is
  roughly matched by what it adds (context slot, deferral set, operand-map
  eligibility gate, `checkNumericArgs` strict-path changes, a resolution
  pass that still needs promote-verify-fallback). Zero behavior change by
  contract; risk concentrated in the hottest construction path.
- *Generalization:* no consumer. Signature-driven inference already covers
  declared parameters of every type; the only gap a context fills is the
  fresh-symbol bottom-up guess under a non-`number` expected type, and
  matrices are the only algebra where that guess has ever been wrong.
- *The two "unsolved edges" are resolved on the record* (don't re-derive):
  the Sequence-fed matrix parameter was never actually unsolved — probed:
  `Det(Sequence(A+B))` is valid today with `A`,`B` → matrix, because the
  repair sits **post-flattening in `validateArguments`**; a v3 that keeps
  resolution at that same site inherits the solution for free (the v2
  per-raw-operand siting *created* the problem — and re-siting there makes
  v3 converge structurally toward what the repair already is, shrinking the
  payoff further). Exception-path stranding: a finally-default at the
  context boundary (unresolved deferrals default to `number` on exit) —
  the self-healing doctrine made mechanical.
- *User rulings (2026-07-18):* the 16 pins in
  `matrix-operator-typing.test.ts` are non-negotiable; documented drift on
  the unpinned edge paths is acceptable if this is ever built.

**Revival trigger:** a concrete non-matrix expected-type consumer (a
parameter type whose fresh-symbol guess must differ from `number` and is
not covered by signature inference or the repair pattern), or a profile
showing the transaction counters matter (unmeasurable today).

Everything below is the v2 draft, kept as the design record. §3.1–§3.2's
masking discipline is **superseded** by the corrected doctrine above.

---

**Replaces (if ever implemented):** the inference-transaction +
`repairFreshMatrixInference` mechanism introduced in `78e0a3e4`
(2026-07-11), as amended by the forward-log fix of 2026-07-18.

## 1. Motivation

Two problems, one mechanism:

1. **Performance.** Every top-level `ce.box()` / `ce.parse()` currently opens
   an "inference transaction" whose depth-0 setup eagerly snapshots the set of
   inferred symbols by walking **every binding in every scope of the lexical
   chain, including the whole global library** (`beginInferenceTransaction` →
   `inferredSymbolNames`, both in `box.ts`), plus WeakMap get/set/delete and a
   closure allocation on every box call, nested included. Measured cost
   (2026-07-18, A/B with the transaction stubbed): `π.N()` at 200 digits
   2.52 µs → 0.12 µs (~95 % of the call); `∫ 1/(x³+1)` 5.7 ms → 1.55 ms.
   Across the benchmark suite this is a ~1.4× median drift vs 0.73.0. The
   snapshot's **only consumer** is `repairFreshMatrixInference`
   (`validate.ts`), which runs only when an argument fails to match a
   matrix-expected parameter — almost never.

2. **Architecture.** The repair is infer-wrong-then-fix-up: bottom-up numeric
   inference commits fresh symbols to `number` while canonicalizing the
   argument (`Add(A, B)` → `A, B : number`), then a matrix-consuming
   operator's validation detects the mismatch, retypes the symbols, and
   **re-boxes the whole argument** under the corrected types, with a rollback
   path. Pushing the *expected* type down before inference runs (checking
   mode of bidirectional typing) defers the guess instead of committing it,
   and deletes the snapshot, the transaction, and the argument re-boxing.

## 2. Current behavior to preserve

All rows verified by probe on a strict engine (`Determinant : (matrix) ->
number`). **Coverage note:** `matrix-operator-typing.test.ts` currently pins
approximations of P1–P3 only (its P2 uses `Determinant(A)`); P4–P9 have no
suite coverage today and become new pins (§7).

| # | Input (fresh engine) | Today | Must remain |
|---|---|---|---|
| P1 | `Determinant(A + B)`, `A`,`B` fresh | valid; `A`,`B` inferred `matrix` | ✓ |
| P2 | `A + 1` evaluated first, then `Determinant(A + B)` | `incompatible-type` error; `A` stays `number` | ✓ (prior inference always wins) |
| P3 | `Determinant(a · A)`, both fresh | `incompatible-type` error (ambiguous product — never guessed) | ✓ |
| P4 | `Determinant(2 · A)` | valid; `A` inferred `matrix` (literal scalar is unambiguous) | ✓ |
| P5 | `Determinant(-A)`, `Determinant(A²)` (integer power), `Determinant(A - B)` | valid; planned symbols inferred `matrix` | ✓ |
| P6 | Non-strict engine (`ce.strict = false`) | no validation, no repair; fresh symbols infer `number` as usual | ✓ |
| P7 | Sub-operators with their own signatures inside the argument (e.g. a `Dot(u, v)` term) | inner operator's own parameter typing governs its operands | ✓ |
| P8 | `Determinant(A · M)` with **declared** `M: matrix`, `A` fresh | valid; the product already types `matrix`, the repair never runs, `A` stays `number` (scalar·matrix) | ✓ (no unnecessary promotion) |
| P9 | `Determinant(A · v)` with **declared** `v: vector`, `A` fresh | `incompatible-type` error; on the failed repair attempt `A` is rolled back to `number` | ✓ (failed resolution leaves `A: number`) |
| P10 | `Determinant(A / A)`, `A` fresh | argument folds to `1` during canonicalization; `incompatible-type` error (`matrix` vs `finite_integer`); `A` ends up inferred `number` | ✓ |
| P11 | `Determinant(f(A))`, `f` and `A` fresh | `A` never enters numeric inference; its type stays as today (not force-inferred `number` by the new mechanism) | ✓ |

### Cache-invalidation reality (corrected from v1)

`BoxedSymbol.infer()` bumps `_mutationGeneration` **only in its
operator-definition branch**. The value-definition branch — the path every
auto-declared symbol (`A`, `B`) takes — assigns `def.value.type` through the
type setter, which bumps only the per-definition `_writeVersion`, **neither
`_generation` nor `_mutationGeneration`**. Compound-expression `.type`
caches are keyed on `_generation`. This is precisely why the old repair
bumps both counters by hand around its retyping — and the new resolution
pass must do the same (§3.4 step R4). Getting this wrong reproduces the
stale-type bug silently; it is pinned in §7.

## 3. Design

### 3.1 The context object

A private, dynamically-scoped slot on the engine:

```ts
// In types-engine.ts (IComputeEngine — box.ts/validate.ts type their
// engine parameter as the interface, not the concrete class):
/** @internal Expected-type context for the operand currently being
 * canonicalized, pushed down from the enclosing operator's declared
 * parameter. `undefined` = no context (default behavior). */
_expectedTypeContext:
  | { expected: Type; deferred: Set<string> }
  | undefined;
```

- `expected` is a `Type` (not an enum) so the mechanism generalizes later;
  **v1 consumers act only when `expected` `matches('matrix')`** — the same
  gate the repair uses today.
- `deferred` is the **operand-local deferral set**: the exact names whose
  numeric inference was skipped under this context (§3.3). It is the
  provenance record — replacing both the global snapshot *and* the v1 idea
  of testing for `unknown`-typed symbols, which has false positives
  (`Determinant(f(A))`: `A` is unknown but was never deferred — P11) and
  false negatives (`A/A → 1` folds the deferred symbol out of the operand —
  P10).
- Initialized to `undefined` on the concrete `ComputeEngine`; never exposed
  publicly.

**Masking discipline (mandatory):** the slot is only ever accessed through
one helper:

```ts
function withExpectedType<T>(
  ce: IComputeEngine,
  ctx: { expected: Type; deferred: Set<string> } | undefined,
  fn: () => T
): T {
  const prev = ce._expectedTypeContext;
  ce._expectedTypeContext = ctx;      // undefined MASKS an outer context
  try { return fn(); } finally { ce._expectedTypeContext = prev; }
}
```

Every operand position wrapped by §3.2 passes either a fresh context object
or `undefined` — **`undefined` is an explicit mask, not "leave as-is"** — so
an active outer matrix context can never leak into a position that has no
expected type of its own (review finding 4). Because §3.2 wraps *every*
operand of *every* non-lazy operator, nested operators inside a matrix
operand automatically mask (or replace) the outer context for their own
operands, which yields P7.

### 3.2 Where the context is set (one central site)

In the default canonicalization path of `boxFunction`, at the single site
where raw operands are canonicalized (`const xs = ops.map((x) =>
ce.expr(x))` — this `xs` feeds **both** the custom-canonical-handler branch
and the default validate path, so the wrap must live here and nowhere else):

```ts
const contextEligible =
  ce.strict &&
  !opDef.inferredSignature &&
  !opDef.canonical &&                      // custom handlers: no context in v1
  signatureIsSimplePositional(opDef) &&    // see below
  !ops.some(isSequenceShaped);             // see below

const params = opDef.signature.type.args;  // required positional params

const xs = ops.map((x, i) => {
  const expected =
    contextEligible && i < (params?.length ?? 0)
      ? params[i].type
      : undefined;
  const ctx =
    expected !== undefined && ce.type(expected).matches('matrix')
      ? { expected, deferred: new Set<string>() }
      : undefined;                          // explicit mask
  const operand = withExpectedType(ce, ctx, () => ce.expr(x));
  if (ctx) resolveDeferred(ce, operand, ctx);   // §3.4
  return operand;
});
```

Definitions:

- `signatureIsSimplePositional(opDef)`: the signature has at least one
  required positional parameter, and the **raw operand count equals the
  required-parameter count** (no optional argument supplied, no variadic
  tail in play). Signatures with optional parameters are eligible **only
  when the optionals are not supplied**; when they are, skip context for the
  whole call (v1 simplicity — the library's matrix signatures are
  `(matrix)`, `(matrix, matrix|vector)`, `(matrix, integer)`, all covered).
- `isSequenceShaped(x)`: the raw operand is a `Sequence` expression (raw
  MathJSON `["Sequence", …]` or an already-boxed expression whose operator
  is `Sequence`), **regardless of element count** — flattening changes
  positional alignment in ways a count check cannot detect (review
  finding 7), so any Sequence operand disables context for the whole call.
- Union parameters (`matrix|vector`) do not satisfy `matches('matrix')` and
  therefore get an explicit `undefined` mask — same non-behavior as today's
  repair gate (pinned: `LinearSolve`).
- The **lazy-operator branch** does not canonicalize its operands, so no
  deferral can occur there; for belt-and-braces it wraps its raw-boxing in
  `withExpectedType(ce, undefined, …)` so a lazy operator nested inside a
  matrix operand cannot observe the outer context.

### 3.3 What the context changes: deferral instead of eager inference

The sole consumer is the fresh-symbol inference inside `checkNumericArgs`
(`validate.ts` — the `x.infer(inferredType)` sites in its strict path; the
non-strict fast path is untouched, preserving P6):

> When `ce._expectedTypeContext` is set and its `expected`
> `matches('matrix')`: instead of inferring a fresh (undeclared/uninferred)
> symbol to `number`, **record the symbol's name in the context's `deferred`
> set and leave its type `unknown`**. Everything else about numeric
> canonicalization is unchanged. Symbols that already have a declared or
> inferred type are handled exactly as today (prior inference wins — P2).

The deferral set gives exact provenance with no snapshot: a name is in
`deferred` *iff* this operand's canonicalization skipped its numeric
inference — including symbols that canonicalization subsequently folds away
(P10) and excluding fresh symbols that never entered numeric inference
(P11).

### 3.4 Resolution pass (failure-triggered, verify-and-fallback)

`resolveDeferred(ce, operand, ctx)` runs once per context-carrying operand,
immediately after its canonicalization. It replaces
`repairFreshMatrixInference` and preserves its only-on-failure and rollback
semantics (review finding 2):

- **R1 — nothing deferred:** if `ctx.deferred` is empty, return.
- **R2 — numeric default first (the counterfactual):** infer every name in
  `ctx.deferred` to `number` (value-def route), then bump `ce._generation`
  and `ce._mutationGeneration` and re-read `operand.type`. If it
  `matches(ctx.expected)` → **done**: this is exactly what would have
  happened with no context, so no promotion is warranted. (P8: `A·M` with
  declared `M: matrix` — `number·matrix` already types `matrix`; `A` stays
  `number`.)
- **R3 — plan:** otherwise compute
  `plan = matrixInferencePlan(operand, ctx.deferred)` — the function
  **moves verbatim from `validate.ts` into `box.ts`**, colocated with
  `resolveDeferred` (no new module; `box.ts` already imports its
  dependencies, keeping `check:deps` clean). Eligibility input is the
  deferral set, not a type test. If the plan declines (ambiguous product
  `a·A` — P3; a term containing only prior-inferred symbols — P2) → done:
  the symbols keep the `number` default from R2 and `validateArguments`
  raises today's `incompatible-type` error.
- **R4 — promote and verify:** set each planned name's type to `matrix`
  (value-def route, `inferredType` stays true), bump `ce._generation` and
  `ce._mutationGeneration`, and re-read `operand.type`:
  - matches `ctx.expected` → **keep** (P1, P4, P5). No re-boxing: the
    operand's structure was built while the symbols were `unknown`, so no
    scalar-only canonicalization was committed (§3.5).
  - does not match → **fallback:** restore every planned name to `number`,
    bump both counters again, and let `validateArguments` produce the type
    error (P9: `A·v` with declared `v: vector` — promotion to `matrix`
    doesn't make `Determinant` of a vector valid; `A` ends `number`).

The explicit generation bumps in R2/R4 are load-bearing (§2
"Cache-invalidation reality"): the value-def type setter does not bump the
engine counters, and compound `.type` caches are `_generation`-keyed. The
old repair bumps the same two counters at the same transitions; R2 adds one
bump pair the repair didn't need because the repair's `number` state was
established during canonicalization rather than after it.

`validateArguments` then runs unchanged **minus** its `inferredBefore`
parameter and the `repairFreshMatrixInference` call.

### 3.5 Soundness note (why deferral is safe where eager matrix inference is not)

The plan never promotes two factors of one product, so no `Multiply` ever
becomes matrix·matrix by promotion; and during canonicalization the deferred
symbols are `unknown`, not `number`, so no scalar-specific canonical
transform (commutative sorting is safe for `Add`, which is commutative for
matrices; `Multiply` with an `unknown` operand takes no tensor-specific
path) is invalidated by a later promotion. R2's failure-free exit (P8)
additionally guarantees promotion never happens when the numeric default
already satisfies the parameter — the case v1's unconditional resolution
would have gotten wrong.

## 4. Deletions and interface changes

| Item | Location |
|---|---|
| DELETE `beginInferenceTransaction`, `inferenceTransactions` WeakMap, `inferredSymbolNames` | `box.ts` |
| DELETE the `box()` transaction wrapper (fold `boxInternal` back into `box`) | `box.ts` |
| DELETE the transaction open in `parse()` | `index.ts` (`parse`, before `syntax.parse`) |
| DELETE `repairFreshMatrixInference` | `validate.ts` |
| DELETE the `inferredBefore` parameter threading | `validate.ts` (`validateArguments`), `box.ts` (call site), `function-utils.ts` |
| DELETE the `beginInferenceTransaction` export | `index.ts` imports |
| MOVE `matrixInferencePlan` (verbatim) | `validate.ts` → `box.ts` |
| ADD `_expectedTypeContext` slot | `types-engine.ts` (`IComputeEngine`) + initialization in the concrete `ComputeEngine` |
| ADD `withExpectedType`, `resolveDeferred`, eligibility predicates | `box.ts` |
| MODIFY `checkNumericArgs` strict-path inference sites | `validate.ts` |

Line-number citations are deliberately avoided (they drift); all sites are
named by function.

## 5. Behavior when no context applies

Custom-canonical-handler operators, lazy operators, inferred signatures,
optional/variadic positions, union (`matrix|vector`) parameters, calls with
a `Sequence`-shaped operand, and non-strict engines get an **explicit
`undefined` context (mask)**: fresh symbols infer `number` exactly as
before `78e0a3e4`, and a matrix mismatch is a plain `incompatible-type`
error with no repair. This is a deliberate regression only for shapes the
current repair could reach that v1's context cannot; per §3.2 the shipped
library has none (the linear-algebra library's 2 custom canonical handlers
take no strictly-matrix parameter). If review or implementation finds one,
it becomes a v1 requirement, not a follow-up.

## 6. Risks

- **Dynamic state on a re-entrant engine.** Mitigated structurally: a single
  set-site (§3.2), a single helper with `finally` restore, `undefined` as an
  explicit mask, and a single consumer (`checkNumericArgs` strict path).
- **Stray deferrals.** A side-expression boxed by a canonical handler
  mid-flight *cannot* observe the context in v1 (custom handlers and lazy
  branches mask), and any deferral recorded under a context is resolved by
  that context's own `resolveDeferred` (the set travels with the context
  object, not with the operand's free variables) — including symbols folded
  out of the operand (P10). Pinned: `Determinant(A + Cos(t)·B)` must leave
  `t` numeric, not `unknown`.
- **Trial inference visibility.** R2 tentatively infers `number` before
  possibly promoting in R4. Between R2 and R4 no user code runs (it is a
  straight-line pass), so the intermediate state is unobservable; both
  transitions bump the generation counters, so no cache can capture the
  intermediate state either.
- **Already-canonical operands.** `ce.expr(x)` on an already-canonical
  operand returns it as-is; its symbols were inferred under earlier context,
  the deferral set stays empty, R1 exits. Outcome identical to today's
  repair-decline for previously-inferred symbols. Pinned.

## 7. Acceptance criteria

1. `matrix-operator-typing.test.ts` green **unchanged** (pins P1–P3
   approximations).
2. **New pins covering every row of §2:** P4, P5 (all three forms), P6
   (non-strict parity), P7 (nested `Dot(u,v)` under `Determinant`), P8
   (`A·M`, declared matrix — no promotion), P9 (`A·v`, declared vector —
   failed resolution leaves `A: number`), P10 (`A/A` fold — `A` ends
   `number`), P11 (`f(A)` — `A` not force-inferred), the
   already-canonical-operand case, `LinearSolve(M, v)` (union parameter:
   masked, unchanged), and the stray-deferral pin
   (`Determinant(A + Cos(t)·B)` → `t` numeric).
3. **Invalidation pins:** immediately after boxing `Determinant(A+B)`,
   (a) `.type` of the *argument* re-read through the parent is `matrix` and
   the parent's type is `number` (no stale `unknown` from a pre-resolution
   cache), and (b) a comprehension-memo–style `_mutationGeneration` consumer
   observes the resolution's bumps (both the R2 and R4 transitions).
4. Full suite green; **zero snapshot churn** (measure blast radius before
   any `-u`, per policy).
5. Perf recovery, order-controlled A/B against the packed 0.73.0:
   `π.N()@200d` ≤ 0.6 µs (vs 2.5 µs today); `∫ 1/(x³+1)` ≤ 1.8 ms (vs
   5.7 ms); benchmark suite median ratio vs 0.73.0 ≥ 0.95×.
6. `npm run check:deps` clean and the engine constructs
   (`npx tsx -e "…new ComputeEngine()"`) after the module moves.
7. Whole-`src/` typecheck clean (native `tsc -p tsconfig.json --noEmit`) —
   the `IComputeEngine` interface change touches files outside the entry
   points.
8. CHANGELOG entry: performance fix + explicit note that matrix inference
   behavior (P1–P11) is unchanged.

## 8. Out of scope (recorded so they aren't re-derived)

- Generalizing consumers beyond `matches('matrix')` (vector/set contexts) —
  the `Type`-shaped `expected` field is already future-proof.
- Custom canonical handlers opting into context-setting (they mask in v1).
- Optional-parameter calls with optionals supplied (context skipped in v1;
  no shipped matrix signature needs it).
- The alternative "surgical" fix (incremental inferred-symbol set with O(1)
  snapshot) — superseded by this design; if this spec is rejected, that
  remains the fallback.
