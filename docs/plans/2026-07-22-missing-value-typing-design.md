# Missing-Value Typing — Missing-ability as an Implicit Signature Lift

**Date**: 2026-07-22 (revision 5 — regrounded to a **from-scratch build** after
the initial implementation was reverted to the clean baseline `f50e1619`.
Resolves the round-3 dual review in
`docs/scratch/2026-07-22-missing-value-typing-design_SPEC_REVIEW_r3.md` (round-1
review at `…_SPEC_REVIEW.md`; the round-2/round-3 review files were lost in an
untracked-file sweep during the revert — recreate from history if needed).
Finding→section maps in §10.)
**Status**: **DRAFT (design)** — not implemented. The tree is at baseline
`f50e1619`; the prior organic implementation (commits `67569c26` "Introduce
Missing" and `1e59ac3c` "Missing propagation + Nothing erasure", both reverted)
is what this design **replaces**, cleanly.
**Roadmap**: extends the `Nothing`/`Missing` marker split (Tycho item 81).
**Related**:
- `docs/plans/2026-07-20-tensor-unification-design.md` — the type-directed
  marker choice (§3.C) reuses its cells/axes; the implicit-lift framing (§3.0)
  is modeled on its `broadcastable<T>` mechanism.
- `docs/plans/2026-07-07-honest-list-broadcast-typing.md` — the broadcast lift
  §3.0/§3.B composes with.
- Auto-memory `nothing-vs-missing-markers` — the ratified runtime semantics this
  design lifts into the type system; §3.C reverses its "gather stays narrow".
- Auto-memory `project_tycho_item67_add_collection_type_union` — the
  `matches()`-over-union hazard §4 re-engages, honestly.
- Auto-memory `subtype-union-self-membership-bug` — the `A <: A|B` lattice fix,
  a prerequisite folded into P0.

---

## 1. Motivation

`Missing` is a position-preserving absent value (Julia `missing`, R `NA`): a
collection may hold one (`[1, Missing, 3]` has length 3), and it propagates
through numeric operations. Its complement is `Nothing`, the erasure marker. The
numeric-context marker is `NaN` (a `number`, so it compiles on float targets);
`Missing` is the non-numeric marker (a distinct `missing` unit type).

An initial implementation (commits `67569c26` + `1e59ac3c`, **now reverted**)
propagated `Missing` **entirely at runtime**, via a gate keyed on
`missingPropagates flag ∨ (¬inferredSignature ∧ allParamsNumeric(sig))`. It
worked but surfaced three defects that this from-scratch design fixes:

1. **The type system was silent about `Missing`.** Propagation was runtime-only
   because admitting `missing` to a signature poisons inference (`\max(x,2x-1)` →
   `Tuple`), so the gate was a workaround.
2. **`allParamsNumeric` conflates "numeric" with "propagates."** A numeric
   *predicate* (`IsPositive(number) -> boolean`) that wants a custom policy can't
   express it.
3. **`| missing` types were contagious but inert** — nothing propagated the arm
   into a result type, and nothing discharged it.

This design lifts propagation into the type system as an **implicit signature
lift** (§3.0), makes behavior an explicit three-state declaration (§3.A) and
partial results honestly typed (§3.C), unifies absence as a **domain-directed**
value discharged by `Coalesce`/`IsMissing` (§3.D), and gives compilation a
target-directed absence representation (§3.F).

---

## 2. Invariants

- **I1 — numeric absence is `NaN`.** A float target cannot carry a symbol.
  Numeric absence is `NaN` (type `number`); non-numeric absence is `Missing`.
- **I2 — `Nothing` erases, `Missing` preserves position.** Both symbol-driven.
- **I3 — `missing` is a disjoint unit type.** Among the unit types it survives
  `widen()` (so `[1, Missing, 3] : list<integer | missing>` keeps the hole
  visible), keeps predicates honest (`Missing.isInteger === false`), and stays
  distinct from erasure (`nothing`).
- **I4 — inference must not widen unconstrained symbols with `missing`.**
- **I5 — one declaration, all consumers agree.** The resolved behavior drives the
  static type, the runtime value, the short path, and the compiler; they must not
  disagree on whether a position can be absent. **I5-sound:** a static type must
  not claim a position is non-missing when the runtime can produce absence there;
  over-approximation is permitted, under-approximation is not.
- **I6 — absence is domain-directed.** "Absent" has one *meaning* and two
  *representations*: `NaN` in the numeric value domain, `Missing` (interpreter) /
  the target null literal (compiled object domain) elsewhere. The value domain of
  a position is a function of its type — a `number`-typed (or `number | missing`)
  cell is numeric (absence = `NaN`); a non-numeric cell is object (absence =
  `Missing`/null). `IsMissing`/`Coalesce` test *absence* in whichever
  representation applies (R's `is.na`, `TRUE` for both `NA` and `NaN`), so they
  behave identically across interpreter and every target.

---

## 3. Design

### 3.0 Missing-ability as an implicit signature lift

`broadcastable` is a definition flag that *implicitly lifts* a signature: `Sin :
(number) -> number` with `broadcastable` applies as `(broadcastable<number>) ->
broadcastable<number>`, realized in `BoxedFunction.type()` by computing a
concrete result when the shape is statically visible (`Sin(list<number>) :
list<number>`) and leaving it implicit otherwise (`broadcastable<number>`).

Missing-ability is the same transform, keyed on `missingBehavior` (§3.A): a
`propagate` operator's `(A) -> B` is implicitly lifted to `(A | missing) -> B |
missing`. It composes with broadcast because both live in the same pipeline and
missing-lift is applied **per broadcast cell, recursively to the innermost cell**
(§3.B). It needs no new type kind — the missing arm is a plain union member. The
"compute when you can, implicit otherwise" split, on each cell:

| cell type | result cell |
|---|---|
| exactly `missing` (definite) | the whole result is `missing` (definite) |
| `A \| missing` (possible) | `A`'s result cell gains `\| missing` |
| `A` (no arm) | no arm |
| indeterminate (`unknown`/unresolved) | conservative — treated as possible (§3.C) |

The definite/possible distinction is load-bearing: `Sin(Missing)` is exactly
`missing`, while `Sin(x : number | missing)` is `number | missing`.
Indeterminate is conservative (possible) — under-approximation would violate
I5-sound, and because the arm sits on a result type it does not widen an
unconstrained symbol's inferred type (I4).

### 3.A `missingBehavior` and the resolved behavior

The declarable field is `reject | propagate | handle`. The *resolved* behavior
adds **`pass-through`**, the undeclared-non-numeric default, not declarable —
this keeps a Missing-free program behaving as baseline.

| resolved | reached by | strips? | scalar `Missing` operand | result lift |
|---|---|---|---|---|
| **`propagate`** | declared, or undeclared numeric default | yes | ⇒ `Missing` (gate) | `\| missing` (§3.B) |
| **`handle`** | declared only | yes | operator's handler | operator's computed handler (§3.C) |
| **`reject`** | declared only | no | type violation | — |
| **`pass-through`** | undeclared non-numeric default | **no** | ordinary validation | none |

- **`propagate`** — the §3.0 lift. Arithmetic, transcendentals, `Power`/`Root`.
- **`handle`** — the operator owns its `Missing` result and runtime; declared for
  operators that *mean* to accept `Missing` into a parameter its declared type
  would reject: `At`, `Coalesce`, `IsMissing`, `Equal`, the reducers (`Max`,
  `Mean`, statistics).
- **`reject`** — invalid; opt-in only, no current occupant.
- **`pass-through`** — the undeclared non-numeric default: no strip, ordinary
  validation, operand flows to the handler. `List(1, Missing, 3)` works (`(any*)`;
  `missing <: any`); `Characters(Missing)` errors (`(string)`; no strip).

**Strip-before-validate — only `propagate` and (declared) `handle`.** Removes a
`missing` arm from an argument's cell type before `Tᵢ° <: Pᵢ`, so a scalar
`Missing` is admissible without widening the parameter (lets `Max : (value*)`
accept `Max(Missing, 1)`), while an unconstrained symbol still infers the bare
`Pᵢ` (I4). `pass-through` and `reject` do not strip. Strip is **parameter-specific**
for a `handle` operator that accepts absence in some positions only — `At` strips
its *value* parameter, not the *index* (§3.C).

**Default resolution.**

```
undeclared ∧ ¬inferredSignature ∧ allParamsNumeric(sig)  → propagate
undeclared ∧ otherwise                                   → pass-through
declared                                                 → as declared
```

The `¬inferredSignature` guard is retained. `allParamsNumeric` survives only as
the default. Recomputed on `infer()`/`update()`, never cached across a signature
mutation.

### 3.B Application typing — the recursive cell-level lift

Let `f` resolve to `propagate`, declared `(P₁,…,Pₙ) -> R`. The lift is a
transform over the *cell structure* of each argument type. A **cell** is a scalar
leaf of the broadcast structure (recursing through every `list<…>` /
`broadcastable<…>` layer); `missingness(T)` ∈ {`none`, `possible`, `definite`}:
`definite` if a whole scalar operand is exactly `missing`; `possible` if any cell
is `A | missing` or indeterminate; else `none`.

1. **Strip (recursive).** Replace each cell `C = C° [| missing]` with `C°`; a
   bare-`missing` cell → `never`. Record `missingness(Tᵢ)`.
2. **Validate & infer** on the stripped types `Tᵢ°`. Unconstrained symbols unify
   against `Pᵢ`, never `Pᵢ | missing` (I4).
3. **Compute the base result** `R°` by running the operator's *existing* result
   typing on a type-view whose operand types are `Tᵢ°` — the broadcast lift and
   any per-operator `type` handler, unchanged. (Handlers receive proxy operands
   carrying `Tᵢ°`; value-level inspection is unaffected — stripping only touches
   the static type.)
4. **Re-attach (recursive, innermost cell).** If `missingness = definite` for any
   argument, the whole result is `missing`. Else if `possible` for any, add
   `| missing` at **every innermost scalar cell** of `R°`, descending through all
   `list`/`broadcastable` layers: `E → E | missing`, `list<E> → list<E |
   missing>`, `list<list<E>> → list<list<E | missing>>`. Else `R°`. For `handle`,
   step 4 is skipped (the handler placed the arm).

`reject`: no strip; any arm fails step 2. `pass-through`: no strip; steps 2–3.

Worked: `Sin(Missing)` — `definite` → `missing`. `Sin(x:number|missing)` —
`possible` → `number | missing`. `Sin(list<number|missing>)` → base `list<number>`,
innermost reattach → `list<number | missing>`. `Sin(list<list<number|missing>>)`
→ `list<list<number | missing>>`. `Add(Missing, matrix)` — `definite` → `missing`.

### 3.C Type-directed partial results (computed `handle` handlers)

Partial collection operations are `handle` operators with a **computed
result-type handler**. The result carries the type-level marker (a visible
`| missing` arm for non-numeric, an absorbed `number` for numeric — I1):

```
marker(T) = number           if T <: number                (value NaN ∈ number)
          = missing           if T is a settled non-numeric type
          = number | missing  if T is indeterminate (unknown / any / unresolved)
```

**Indeterminate normalization.** `T | marker(T)` with `T` indeterminate is
`unknown | number | missing`, which the algebra normalizes (top-type subsumption
/ `widen()`) to **`unknown`** — I5-sound (`unknown` does not claim non-missing;
`.matches('number')` is `false`) and discharge-able at runtime. Vectors use the
normalized form.

**Access-mode matrix** (`⊔S` = widened tuple slots):

```
At(list<T>, integer)                 -> T | marker(T)
At(list<T>, list<integer>)           -> list<T | marker(T)>
At(list<T>, list<boolean>)           -> list<T>                     (mask filters)
At(tuple<A,…>, k::in-range literal)  -> the k-th slot                (k ∈ 1..n, or negative |k|≤n → (n+1+k)-th)
At(tuple<A,…>, k::out-of-range lit)  -> marker(⊔S)                   (NOT bare `missing`)
At(tuple<A,…>, integer)              -> ⊔S | marker(⊔S)
At(tuple<A,…>, list<integer>)        -> list<⊔S | marker(⊔S)>
At(tuple<A,…>, list<boolean>)        -> list<⊔S>
At(dictionary<T>, string)            -> T | marker(T)
At(record{k:V,…}, k::present lit)    -> V
At(record{…}, k::absent lit)         -> marker(⊔ field types)
At(record{…}, string)               -> (⊔V) | marker(⊔V)
At(x, i::union)                      -> ⊔ over each admissible mode
At(Missing, i) / At(xs, Missing)     -> absorbing → marker(elt(xs))
First/Second/Third/Last(collection<T>) -> T | marker(T)              (empty → hole)
PointX/PointY/PointZ                 -> operand-sensitive (below)
```

- **`Missing` base or index.** A `handle` `At` strips both parameters, so both
  validate; both are **absorbing** — the result is the marker for the accessed
  element type.
- **Chained `At(x, i₁, i₂, …)` — carry the marker verbatim.** Type the chain
  branch-wise over the current union: index the collection arms one step, and
  **preserve any already-present marker arm unchanged** (do not recompute from
  later element types). An out-of-range step-1 into `list<list<number>>` produces
  `Missing` (element type is a list, non-numeric); that survives the remaining
  steps. At runtime an absorbed marker short-circuits.
- **Aggregates (all 15, both call shapes).** A computed handler; `base(op)`:

  | operators | base | notes |
  |---|---|---|
  | `Mean` `Variance` `PopulationVariance` `StandardDeviation` `PopulationStandardDeviation` `Kurtosis` `Skewness` `Median` `InterquartileRange` | `number` | `number` (never `finite_real`) — a `NaN` datum or empty input is `NaN` |
  | `Quartiles` | `tuple<number,number,number>` | same condition |
  | `Max` `Min` `Supremum` `Infimum` `Mode` | `⊔` of the numeric operand/element types (today `number`) | order/selection — keep the numeric result, no `T`-polymorphism |

  ```
  Aggregate(args) : base | missing   iff  any scalar operand is `missing`-typed
                                      OR  a collection operand's element type carries `missing`
                  : base             otherwise
  ```
- **`PointX/Y/Z`** keep `pointComponentAt()`'s operand-sensitive typing: a point
  access is `slotType | marker(slotType)`; the non-point-collection fallback
  follows the `First`/… row. No unconditional `number`.

### 3.D Absence discharge — `Coalesce`, `IsMissing` (domain-directed)

Under I6 absence is one concept with two representations, so the discharge
primitives are *absence* tests, not `Missing`-symbol tests:

- **`IsMissing(x) -> boolean`** — `true` iff `x` is absent: the `Missing` symbol,
  OR a `NaN` in a numeric position (interpreter and compiled agree). R's `is.na`
  (`TRUE` for `NA` and `NaN`). Provenance of a NaN is irrelevant. `IsNaN` remains
  for a NaN-specific test (R's `is.nan`).
- **`Coalesce`** — ad-hoc, lazy, returns the first non-absent operand:
  - **Arity** ≥ 1; zero is an error; `Coalesce(x)` is `x`.
  - **Lazy + canonical obligation.** `lazy: true`; per the documented trap
    (CLAUDE.md; item-77) a lazy operator with no `canonical` handler is inert on
    box/parse routes — the handler MUST `.canonical` each held operand before
    testing it. (Route-parity tested.)
  - **Semantics.** Left-to-right, short-circuit; skip an operand that `IsMissing`.
  - **Result type.** With `Tᵢ°` the stripped arm: `T₁° | … | Tₙ₋₁° | Tₙ` — every
    operand but the last contributes its stripped type; the last its full type.
    Totality (`… -> T`) requires an arm-free final operand.
  - **Domain.** Numeric operand absence = `NaN`, object = `Missing`/null;
    `IsMissing` handles both, so `Coalesce` is uniform across domains — no
    `FillNaN` variant needed.

`Equal` result type: `missing` when a definitely-absent operand makes the result
definitely absent, `boolean | missing` when only possible, `boolean` otherwise —
including list-broadcast modes; value-level `Equal(x, Missing)` is Kleene
`Missing`.

**Flow-narrowing for `IsMissing` is OUT OF SCOPE** — needs occurrence typing a
separate design owns; `IsMissing` ships as a plain boolean, `Coalesce` is the
primary discharge.

| application | result |
|---|---|
| `IsMissing(Missing)` / `IsMissing(NaN)` / `IsMissing(3)` | `True` / `True` / `False` |
| `Coalesce(Missing, 3)` / `Coalesce(NaN, 3)` / `Coalesce(2, 3)` | `3` / `3` / `2` |
| `Equal(x, Missing)`, `Equal(Missing, Missing)` | `Missing` (Kleene) |
| `List(1, Missing, 3)` | `[1, Missing, 3]` (length 3) |
| `Max(1, Missing, 3)` | `Missing` |

### 3.E Runtime propagation, element level, short path

```
propagate → any Missing/NaN operand ⇒ absence;  AND under broadcast the scalar
            gate re-enters per element:
            Sin([1, Missing, 3]) → [Sin(1), Missing, Sin(3)]
handle    → defer to the operator's canonical/evaluate handler
            (aggregates: missingDatum() covers scalar operands AND flattened
             collection elements)
reject    → Missing operand ⇒ type violation, strict/non-strict
pass-through → no gate; ordinary validation; operand to the handler
```

**`reject`** follows the existing strict/non-strict split: strict → `["Error",
…]` at the operand; non-strict → validation skipped.

**Numeric short path.** `makeNumericFunction()` applies only when the operator
resolves to the built-in `propagate` definition (all 11 shortcut operators do),
so its hardcoded propagation equals the resolved behavior. A redeclaration with a
different `missingBehavior` replaces the definition and takes the definition
route, so an override wins.

### 3.F Compile — target-directed absence, no propagation guard

Compile-time absence is the type's `marker(T)` lowered to the target, chosen per
subexpression by its domain (I6):

- **Numeric-domain position** (type `number` / `number | missing`) → `NaN` on
  every target. `NaN` propagates natively through float arithmetic, so a
  `propagate` operator needs **NO guard**: `Sin(NaN)=NaN`, `x + 1` with `x=NaN`
  is `NaN`, and under broadcast a mapped `Math.sin` preserves `NaN` per element.
  Every `propagate` operator is numeric (params `<: number`), so **the guard
  machinery of earlier revisions is removed**. Matches the existing target
  (`_SYS.at` projects out-of-band to `NaN`).
- **Object-domain position** (a non-numeric type) → the target's null literal
  (`undefined` on JS, `None` on Python). Native out-of-bounds already yields it.
  No arithmetic occurs here, so no guard.
- **Discharge lowers domain-directed** (so interpreter/compiled agree):
  `IsMissing` → `Number.isNaN(x)` for numeric `x`, `x === undefined` for object;
  `Coalesce` correspondingly. `Coalesce(At(list<number>,i),0)` = `0` on both
  (numeric hole = `NaN` = absent); `Coalesce(At(list<string>,i),"d")` = `"d"` on
  both.

**Target capability**, two independent axes:

```
numericAbsence: 'nan'                         // always
objectAbsence?: { nullLiteral, isMissing(x), coalesce(x, d) }   // iff the target
                                              // compiles non-numeric values
```

A pure-float target (GLSL/WGSL/interval) omits `objectAbsence` — it never
compiles a non-numeric value, so it never sees a `missing`-typed position; nothing
to reject. JS/Python provide both.

### 4. Interactions with prior ratified decisions

- **Reverses "gather stays narrow."** `At(p, I)` reports `list<T | marker(T)>`;
  honest, discharge-able, confined to non-numeric/indeterminate `T`.
- **Re-engages item-67 `matches()` — honestly.** `.matches('number')` on
  `At(list<string>, i)` is `false`; numeric `At` stays `number`, unaffected.
- **Compile:** numeric holes are `NaN` everywhere; object holes are the null
  literal; interpreter/compiled agree (I6).

### 5. Build from baseline (no migration)

There is **nothing to migrate** — the prior `missingPropagates`/gate
implementation was reverted (§1), so this design is implemented **fresh on
`f50e1619`**. Consequences for the plan:

- **The subtype union-self-membership fix** (`nothing`/`missing`/`unknown <:
  A|B`, auto-memory `subtype-union-self-membership-bug`) is a **prerequisite**,
  folded into P0 rather than applied after the fact.
- **Behavior-preservation applies only to Missing/Nothing-free programs.** An
  expression that mentions neither marker must evaluate byte-for-byte as baseline
  (the P0 acceptance test). This is what `pass-through` guarantees.
- **The markers are intended BREAKING changes vs baseline** — they are *not*
  "preserved." `Nothing`-erasure in collections (`[1,Nothing,3]` → length 2), the
  `Missing` marker and `missing` type, and type-directed out-of-band access all
  change observable behavior from `f50e1619` and must be CHANGELOG'd (the reverted
  commits' CHANGELOG entries are the reference for that copy). There **will** be
  snapshot churn in the affected suites; that churn is the feature, measured and
  reviewed, not absorbed silently.
- **Initial declarations:** the 15 aggregates declare `missingBehavior: 'handle'`;
  `Add`/`Negate` declare `'propagate'` (their `value`-typed signatures would
  otherwise default to `pass-through`); numeric operators default to `propagate`;
  everything else defaults to `pass-through`.

### 6. Phasing (greenfield)

- **P0 — primitives & lattice (value-behavior-neutral).** The `missing` type in
  the lattice (I3: disjoint unit, `widen()`-survival, honest predicates), the
  `Missing` symbol, and the subtype union-self-membership fix. Type-system only;
  a Missing-free program is unchanged. **Acceptance:** full suite green with zero
  churn (nothing yet *uses* the type).
- **P1 — markers & erasure (BREAKING vs baseline).** `Nothing`-erasure in
  collection literals + lazy iteration, the type-directed `absenceMarker`, and
  out-of-band access (`At`/`First`/component/point accessors) yielding the
  domain-directed marker (§3.C values). CHANGELOG + measured snapshot churn.
- **P2 — behavior & lift.** `missingBehavior` tri-state + resolution + strip
  gating (§3.A), the cell-level lift (§3.B), the runtime gate + element-level
  re-entry (§3.E), and the compile representation (§3.F, numeric NaN native — no
  guard). First result-type changes.
- **P3 — computed `handle` handlers & discharge.** §3.C partial-result typing +
  the aggregate table, `Coalesce` + `IsMissing`, `Equal`. The gather-narrow
  reversal (§4). I5-sound for collection-access operators is reached here.
- **Flow-narrowing for `IsMissing` is OUT OF SCOPE** (a separate occurrence-typing
  design); nothing here depends on it.

Each phase is independently landable; P0 is the load-bearing foundation.

### 7. Open questions

- **Q2** — `At(list<integer>, dynamicIndex) : number` widens integer→number
  (honest: the hole is `NaN`). **Current decision: accept.** A distinct `nan`
  type (result `integer | nan`) is a possible future refinement, out of scope;
  §3.C does not depend on it.
- **Q-E1** — a redeclared shortcut operator resolving back to `propagate`: keep
  the short path, or always the definition route? §3.E currently routes
  redeclarations off the short path (safe); affects only a micro-optimization.

(Decided: Q-C1 → §3.C indeterminate normalizes to `unknown`; Q-F1 → §3.F object
null literal is the target's declared `objectAbsence.nullLiteral` (`undefined`
for JS); Q-F2 → no guard (numeric NaN native); Q4 → §3.E; D-Q1 → §3.D unified
absence, no separate `FillNaN`.)

### 8. Test obligations

- **P0 parity:** a Missing/Nothing-free program evaluates identically to
  `f50e1619` (zero churn); `ce.type('missing')` parses; `Missing.isInteger ===
  false`; `[1, Missing, 3] : list<integer | missing>` (arm survives `widen`).
- **Inference (I4):** unconstrained symbol infers the bare param; pin
  `\max(x,2x-1)` → `x:value`, `2x:Multiply`, with `Max` as `handle`.
- **Strip (§3.A):** `Max(Missing,1)` → `Missing`; a `reject` op errors;
  `At(Missing,i)`/`At(xs,Missing)` absorbing (parameter-specific strip);
  `Characters(Missing)` errors (`pass-through`, no strip).
- **Cell lift (§3.B):** `Sin(Missing):missing`; `Sin(x:number|missing):number|missing`;
  `Sin(list<number|missing>):list<number|missing>`; nested
  `Sin(list<list<number|missing>>):list<list<number|missing>>`;
  `Add(Missing,matrix):missing`.
- **Markers (§3.C):** `At(list<number>,i):number`; `At(list<string>,i):string|missing`;
  `At(list,i)` elt `unknown` : `unknown`; mask:`list<T>`; in-range literal tuple
  index (incl. negative): exact slot; out-of-range tuple:`marker(⊔S)`; chained
  early-out-of-range into `list<list<number>>`: `Missing` verbatim;
  `Mean(list<number>):number`; `Max(1,Missing,3):number|missing`.
- **Discharge (§3.D):** `Coalesce(x:T|missing,d:T):T`; variadic result; short-
  circuit; box/parse route probes; `IsMissing(NaN)=True`, `Coalesce(NaN,3)=3` —
  same interpreter and compiled.
- **Runtime element level (§3.E):** `Sin([1,Missing,3])→[Sin(1),Missing,Sin(3)]`.
- **Short-path parity (§3.E):** box/parse/`ce.function`/`ce._fn` agree; a
  `handle`/`reject` redeclaration takes effect.
- **Compile (§3.F):** `Sin(list<number|missing>)` maps natively (no guard);
  `Add(x:number|missing,1)` → native `x+1`; `Coalesce`/`IsMissing` lower to
  `Number.isNaN`, agreeing with the interpreter; object (JS) →
  `Coalesce(At(list<string>,i),"d")`=`"d"`; a non-numeric position on a
  `numericAbsence`-only target is a compile error.

### 9. Test-vector appendix (normative)

```
Sin(Missing)                        : missing                = Missing
Sin(x : number | missing)          : number | missing
Sin(list<number | missing>)        : list<number | missing>
Sin(list<list<number|missing>>)    : list<list<number | missing>>
Sin([1, Missing, 3])               = [Sin(1), Missing, Sin(3)]            (runtime)
Add(Missing, 1)                    : missing                = Missing
Add(Missing, matrix)               : missing
Max(1, Missing, 3)                 : number | missing       = Missing
Max(list<number>)                  : number                                (NaN datum → NaN)
List(1, Missing, 3)                : list<integer | missing>  = [1, Missing, 3]
List(1, Nothing, 3)                = [1, 3]                                 (erasure, BREAKING vs baseline)
Characters(Missing)                : ERROR  (pass-through, no strip)
At(list<number>, 9)                : number                 = NaN
At(list<string>, 9)                : string | missing       = Missing
At(list, 9) [elt unknown]          : unknown                (normalized, I5-sound)
At(tuple<A,B>, 5)                  : marker(A ⊔ B)          (NOT bare missing)
At(tuple<A,B>, -1)                 : B                      (negative in-range literal)
At(m, 9, 0) [row 9 out of range]   : Missing carried verbatim (chained absorbing)
IsMissing(NaN) / IsMissing(Missing): True / True
Coalesce(NaN, 3) / Coalesce(Missing, 3) : 3 / 3
Coalesce(At(list<number>, 9), 0)   = 0    (interpreter AND compiled)
Coalesce(At(list<string>, 9), "d") = "d"  (interpreter AND compiled)
Equal(x, Missing)                  : Missing
compile_js( Add(x:number|missing,1) ) : ok — native x+1 (NaN), NO guard
compile_js( Coalesce(At(list<string>,i),"d") ) : ok — _at(...) ?? "d"
```

### 10. Review-finding resolutions

**Round 3 → revision 4** (carried into revision 5 unchanged)

| # | finding | resolution |
|---|---|---|
| 1 | NaN-as-absence vs interpreter discharge | §3.D/§3.F **domain-directed absence**: `Coalesce`/`IsMissing` test absence (NaN numerically, `Missing`/null in object domain) in BOTH interpreter and compiled; R `is.na`; no separate `FillNaN` |
| 2 | value domain per-subexpression, `Add` guard | §3.F: domain is a per-cell function of the type; numeric → `NaN` native, **guard removed**; `Add` compiles to native `x+1` |
| 3 | cell formalism nested under-approx / exact | §3.B recursive innermost-cell strip+reattach; definite/possible `missingness`; exact `Sin(Missing):missing`; handler proxy-operand contract |
| 4 | literal tuple/record miss wrong marker | §3.C `marker(⊔S)`/`marker(⊔V)`, not bare `missing` |
| 5 | chained marker recomputed | §3.C carry the absorbed marker verbatim |
| 6 | `Equal` no result-type rule | §3.D cell-aware `Equal` type |
| 7 | `unknown|number|missing` not normal form | §3.C normalizes to `unknown` (I5-sound) |
| 8 | strip admits `At(Missing,1)` | §3.A parameter-specific strip; §3.C `Missing` base/index absorbing |
| 9 | aggregate rule incomplete | §3.C 15-operator table; both call shapes; `Mode`/`Supremum`/`Infimum` classified |
| 10 | open questions gate normative rules | §7 trimmed to Q2/Q-E1 with decisions stated |
| 11 | P2/P3 I5-sound interim gap | §6: I5-sound for access operators at P3 |
| 12 | negative literal tuple index | §3.C negative in-range literal → `(n+1+k)`-th slot |

**Rounds 1–2** — see the round-1 review file; all resolved and superseded where a
later round refined them (R2#2 compile boundary → R3#1/#2 domain-directed; R2#1
indeterminate → R3#7 normalized). The round-2/round-3 review files were lost in the
revert's untracked-file sweep; their findings live in these maps.

**Revision 5** — no new findings; regrounded from *refactor an existing feature*
to *from-scratch build on `f50e1619`* (new §1 framing, §5, §6 P0, §8 P0 parity).
The technical design (§§2–4, 7, 9) is unchanged from revision 4.
