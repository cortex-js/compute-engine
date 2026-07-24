# Missing-Value Typing — Missing-ability as an Implicit Signature Lift

**Date**: 2026-07-24 (revision 6 — applies resolutions R1–R7 from the round-4
dual review, `docs/scratch/2026-07-22-missing-value-typing-design_SPEC_REVIEW_r4.md`.
The keystone change is **R1, domain normalization at value construction**
(§2-I6), which absorbs absence into `NaN` on every numeric result path and
collapses the propagate-side type machinery of revision 5. Finding→section
maps in §10. Revision 5 regrounded to a **from-scratch build** after the
initial implementation was reverted to the clean baseline `f50e1619`; the
round-2/round-3 review files were lost in an untracked-file sweep during the
revert — their findings live in §10's maps.)
**Status**: **IMPLEMENTED (2026-07-24)** — P0–P3 landed in one round (four
sequential phases, each suite-green), plus the same-day §10 amendment
(comparisons: IEEE over `NaN`, Kleene over `Missing`). The prior organic
implementation (commits `67569c26` "Introduce Missing" and `1e59ac3c` "Missing
propagation + Nothing erasure", both reverted) is what this design
**replaced**, cleanly.
**Roadmap**: extends the `Nothing`/`Missing` marker split (Tycho item 81).
**Related**:
- `docs/plans/2026-07-20-tensor-unification-design.md` — the type-directed
  marker choice (§3.C) reuses its cells/axes; the implicit-lift framing (§3.0)
  is modeled on its `broadcastable<T>` mechanism; §3.E's kernel demotion cites
  its §D2.3.
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
lift with numeric absorption** (§3.0), makes behavior an explicit three-state
declaration (§3.A) and partial results honestly typed (§3.C), unifies absence
as a **domain-normalized** value discharged by `Coalesce`/`IsMissing` (§3.D),
and gives compilation a target-supplied absence capability (§3.F).

---

## 2. Invariants

- **I1 — numeric absence is `NaN`.** A float target cannot carry a symbol.
  Numeric absence is `NaN` (type `number`); non-numeric absence is `Missing`.
- **I2 — `Nothing` erases, `Missing` preserves position.** Both symbol-driven.
  The normative erasure table is §3.G.
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
- **I6 — absence is domain-normalized at value construction.** "Absent" has one
  *meaning* and two *representations*, and the representation is chosen **the
  moment a result value is constructed**, as a function of the result
  position's domain: absence in a **numeric-domain** cell (type `<: number`) is
  `NaN`; absence in an **object-domain** (non-numeric) cell is `Missing`
  (interpreter) / the target null literal (compiled). Consequences:
  - The `Missing` symbol never inhabits a numeric-domain *result* cell; `NaN`
    never denotes absence in an object-domain cell.
  - **Literal containers are not results** — `List(1, Missing, 3)` keeps
    `Missing` as data (I3's motivation); normalization applies when a value
    flows *through an operator* into a typed result cell.
  - Because the interpreter normalizes at construction, nothing ever crosses
    the compile boundary as `Missing` in a numeric position — **the compiled
    ABI for a numeric-domain parameter's absent value is `NaN`**, with no
    conversion needed at the call site.
  - `IsMissing`/`Coalesce` test *absence* in whichever representation applies
    (R's `is.na`, `TRUE` for both `NA` and `NaN`); **provenance of a `NaN` is
    irrelevant**. They behave identically across interpreter and every target.

---

## 3. Design

### 3.0 Missing-ability as an implicit signature lift

`broadcastable` is a definition flag that *implicitly lifts* a signature: `Sin :
(number) -> number` with `broadcastable` applies as `(broadcastable<number>) ->
broadcastable<number>`, realized in `BoxedFunction.type()` by computing a
concrete result when the shape is statically visible (`Sin(list<number>) :
list<number>`) and leaving it implicit otherwise (`broadcastable<number>`).

Missing-ability is the same transform with one structural twist. Keyed on
`missingBehavior` (§3.A), a `propagate` operator's `(A) -> B` is implicitly
lifted to **`(A | missing) -> B`** — the result is `B`, not `B | missing`.
Every `propagate` result cell is numeric-domain (I1), and the numeric domain
contains its own absent element (`NaN ∈ number`), so the missing arm is
**absorbed** at the result rather than re-attached (I6). Where broadcast is a
true wrapper-preserving lift (`list` in → `list` out), missing-ability on the
propagate path is an absorption into a pointed domain; a genuine `| missing`
re-attachment occurs only in object-domain results, which are the province of
`handle` operators (§3.C).

The two lifts compose because both live in the same application-typing
pipeline and missing-lift is applied **per broadcast cell, recursively to the
innermost cell** (§3.B). No new type kind is needed — a `missing` arm on
*data* is a plain union member; there is deliberately no `missingable<T>` type
(one alternative is finitely expressible as a union; unknown broadcast shape
is not, which is why `broadcastable<T>` exists as a type and missing-ability
does not).

**The parallel with `broadcastable`, and where it stops.** Both features
exist for the same root reason: a semantic opt-in must be a definition flag,
never a widened parameter type, because a parameter type is also an inference
source (I4; the item-67 lesson). Both are functor lifts in spirit — broadcast
over the container functor, missing-ability over the option functor — and
they compose per cell because functors compose (`list ∘ maybe`), which is why
§3.B is one pipeline rather than two interacting features. Both share the
strip/peel-validate-rebuild shape (broadcast peels shape before checking the
cell against the parameter; missing strips the arm before `Tᵢ° <: Pᵢ`), and
both are resolved at definition-binding time and recomputed on
`infer()`/`update()` — two instances of I5's "one declaration, all consumers
agree."

The analogy stops in three places, and each stop is load-bearing:

1. **Lift vs absorption.** Broadcast is wrapper-preserving (`list` in →
   `list` out), so its structure must survive into the result type — hence
   `broadcastable<T>` exists *as a type*. Missing-ability preserves the
   wrapper only on the object-domain path; on the numeric path the option
   wrapper is *absorbed* into a domain that already contains its own absent
   element (`NaN ∈ number`) — a fold into a pointed domain, not a `map`. Do
   not "restore symmetry" with a `missingable<T>` type kind; the asymmetry is
   the design.
2. **The map/fold boundary.** The operators declared `handle` (`Max`, `Mean`,
   the statistics) are reducers — the same class that cannot be
   `broadcastable`, because a fold consumes the container rather than mapping
   over it. Broadcast needs no policy taxonomy since mapping is the only
   behavior a shape lift can have; absence needs `reject | propagate | handle
   | pass-through` because at a fold boundary absence has *semantics* (skip,
   propagate, Kleene) that no generic rule can choose.
3. **Runtime cost inversion.** Broadcast's runtime is a loop the engine must
   supply on every target; numeric absence propagation is free — IEEE
   hardware *is* the gate (`NaN + 1 = NaN`), which is why §3.F compiles
   guard-free and why I1 chose `NaN`. The flip side: broadcast degrades
   gracefully everywhere, while absence *discharge* requires the target to
   observe the absent element (`isnan` surviving fast-math) — hence the GPU
   story "propagation free, discharge fails closed" (§3.F).

Per operand cell of a `propagate` application:

| operand cell type | validated as | result cell | runtime |
|---|---|---|---|
| exactly `missing` | `never` (strips; `never <:` anything) | base cell (numeric) | `NaN` |
| `A \| missing` | `A` (strips) | base cell | `NaN` where absent |
| `A` (no arm) | `A` | base cell | ordinary |
| indeterminate (`unknown`/unresolved) | as-is (conservative) | base cell | value-directed (§3.C) |

### 3.A `missingBehavior` and the resolved behavior

The declarable field is `reject | propagate | handle`. The *resolved* behavior
adds **`pass-through`**, the undeclared-non-numeric default, not declarable —
this keeps a Missing-free program behaving as baseline.

| resolved | reached by | strips? | scalar `Missing` operand | result |
|---|---|---|---|---|
| **`propagate`** | declared, or undeclared numeric default | yes | ⇒ `NaN` (gate; I6 absorption) | base type, no arm (§3.B) |
| **`handle`** | declared only | yes (per `missingStrip`) | operator's handler | operator's computed handler (§3.C) |
| **`reject`** | declared only | no | error (gate, **both** strict modes, §3.E) | — |
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
`Pᵢ` (I4). `pass-through` and `reject` do not strip.

**Per-parameter strip is a declared field**, consumed identically by
validation, typing, and runtime (I5): `missingStrip: 'all' | number[]`
(0-based parameter positions). Default `'all'` for `propagate` and `handle`.
`At` declares `'all'` — base **and** index positions strip, so `At(xs,
Missing)` validates; an absent index is *absorbing* at runtime (§3.C). An
operator that accepts absence in some positions only declares the stripped
subset.

**Default resolution.**

```
undeclared ∧ ¬inferredSignature ∧ allParamsNumeric(sig)  → propagate
undeclared ∧ otherwise                                   → pass-through
declared                                                 → as declared
```

The `¬inferredSignature` guard is retained. `allParamsNumeric` survives only as
the default. Recomputed on `infer()`/`update()`, never cached across a signature
mutation.

### 3.B Application typing — strip, validate, absorb

Let `f` resolve to `propagate`, declared `(P₁,…,Pₙ) -> R`. A **cell** is a
scalar leaf of the broadcast structure (recursing through every `list<…>` /
`broadcastable<…>` layer). `missingness(T)` ∈ {`none`, `possible`, `definite`}:
`definite` if a whole scalar operand is exactly `missing`; `possible` if any
cell carries `| missing`, is a *nested* exactly-`missing` cell, or is
indeterminate; else `none`. (The propagate path does not branch on this
taxonomy — it exists for `handle` handlers, §3.C/§3.D, which distinguish a
definitely-absent result from a possibly-absent one.)

1. **Strip (recursive).** Replace each cell `C = C° [| missing]` with `C°`; a
   bare-`missing` cell → `never` (`never <:` anything, so validation passes
   and the absence signal is carried by the runtime, not the type).
2. **Validate & infer** on the stripped types `Tᵢ°`. Unconstrained symbols unify
   against `Pᵢ`, never `Pᵢ | missing` (I4).
3. **Compute the base result** `R°` by running the operator's *existing* result
   typing — the broadcast lift and any per-operator `type` handler, unchanged.
   The stripped types are conveyed via an **`operandTypes` override on the
   type-handler context**: the handler-invocation shim consults
   `ctx.operandTypes[i]` before `ops[i].type`. No proxy expressions, no
   interaction with the generation-tracked `_type` cache; value-level
   inspection inside handlers is unaffected.
4. **The result type is `R°`** — absorption (I6). Every propagate result cell
   is numeric, so no `| missing` arm is re-attached; runtime absence there is
   `NaN ∈ number`, and the type is I5-sound by construction. For `handle`, the
   operator's computed handler places any arm (§3.C).

`reject`: no strip; the gate errors (§3.E). `pass-through`: no strip; steps 2–3.

Worked: `Sin(Missing) : number = NaN`. `Sin(x : number | missing) : number`.
`Sin(list<number | missing>) : list<number>`. `Sin(list<missing>) :
list<number> = [NaN, …]`. `Add(Missing, [[1,2],[3,4]]) : matrix — every cell
NaN` (scalar absence broadcast into numeric cells, exactly as native float
`NaN + x` behaves).

### 3.C Type-directed partial results (computed `handle` handlers)

Partial collection operations are `handle` operators with a **computed
result-type handler**. The result carries the type-level marker (a visible
`| missing` arm for non-numeric, an absorbed `number` for numeric — I1/I6):

```
marker(T) = number            if T <: number               (absence value NaN)
          = missing           if T is a settled non-numeric type
                              (including T = missing itself, empty joins, never)
          = number | missing  if T is indeterminate (unknown / any / unresolved)
marker(A | B) = marker(A) ⊔ marker(B)                      (arm-split — total over unions)
```

**Indeterminate normalization.** `T | marker(T)` with `T` indeterminate is
`unknown | number | missing`, which the algebra normalizes (top-type subsumption
/ `widen()`) to **`unknown`** — I5-sound (`unknown` does not claim non-missing;
`.matches('number')` is `false`) and discharge-able at runtime. Vectors use the
normalized form. **Runtime for an indeterminate element type is
value-directed**: inspect the actual collection's elements — if every element
is numeric-domain the hole is `NaN`, else `Missing` (this is the reverted
implementation's `absenceMarker()` behavior, now normative). An
indeterminate-typed position never reaches compilation (no concrete type), so
no compile rule is needed.

**Access-mode matrix** (`⊔S` = widened tuple slots):

```
At(list<T>, integer)                 -> T | marker(T)
At(list<T>, list<integer>)           -> list<T | marker(T)>            (gather — length-preserving, below)
At(list<T>, list<boolean>)           -> list<T>                        (mask filters; length must match, below)
At(tuple<A,…>, k::in-range literal)  -> the k-th slot                  (k ∈ 1..n, or negative |k|≤n → (n+1+k)-th)
At(tuple<A,…>, k::out-of-range lit)  -> marker(⊔S)                     (NOT bare `missing`)
At(tuple<A,…>, integer)              -> ⊔S | marker(⊔S)
At(tuple<A,…>, list<integer>)        -> list<⊔S | marker(⊔S)>
At(tuple<A,…>, list<boolean>)        -> list<⊔S>
At(dictionary<T>, string)            -> T | marker(T)
At(record{k:V,…}, k::present lit)    -> V
At(record{…}, k::absent lit)         -> marker(⊔ field types)
At(record{…}, string)               -> (⊔V) | marker(⊔V)
At(x, i::union)                      -> ⊔ over each admissible mode
At(Missing, i) / At(xs, Missing)     -> absorbing (below)
First/Second/Third/Last(collection<T>) -> T | marker(T)                (empty → hole)
PointX/PointY/PointZ                 -> operand-sensitive (below)
```

- **`Missing` base or index — absorbing, value-level.** `At` strips all
  parameters (§3.A), so both positions validate; at runtime an absent base or
  index absorbs: the result is absence in the *result position's* domain. A
  `Missing` base has an indeterminate element domain — static type `unknown`,
  runtime `Missing`. An absent index into `list<T>` yields `marker(T)`'s
  absence value (`NaN` for numeric `T`, `Missing` otherwise).
- **Chained `At(x, i₁, i₂, …)` — value-level absorption.** Type each step
  independently over the current union (the marker is *recomputed from that
  step's element domain* — nothing needs to be "carried"). At runtime, any
  absent intermediate — `Missing` **or** `NaN`, provenance-irrelevant (I6) —
  short-circuits the remaining steps; the final result is absence in the
  *final* position's domain. Example: `At(m, 9, 0)` with `m :
  list<list<number>>` — step 1 misses (`Missing`; the element domain is a
  list, non-numeric), which absorbs through step 2 into the numeric final
  domain: static type `number`, runtime `NaN`.
- **Gather is length-preserving** (the runtime half of reversing "gather stays
  narrow", §4). `At(xs, [i₁, …, iₖ])` has length `k`; each out-of-range or
  absent index contributes a hole in the element domain (`NaN`/`Missing`).
  `At([a,b], [1,9,2]) = [a, hole, b]`. An empty index list yields the empty
  list. **BREAKING** — the baseline drops out-of-range entries (§5).
- **Mask length must equal collection length**; a mismatch is an error
  (replaces the baseline's silent prefix application — §5). A scalar-boolean
  index and a mixed/non-integer index collection remain inert (unchanged from
  baseline), stated here for completeness.
- **Aggregates (all 15, both call shapes).** Every aggregate's base type is
  numeric, so the result type is the **base with no arm** (I6 absorption):

  | operators | base |
  |---|---|
  | `Mean` `Variance` `PopulationVariance` `StandardDeviation` `PopulationStandardDeviation` `Kurtosis` `Skewness` `Median` `InterquartileRange` | `number` (never `finite_real`) |
  | `Quartiles` | `tuple<number,number,number>` |
  | `Max` `Min` `Supremum` `Infimum` `Mode` | `⊔` of the numeric operand/element types (today `number`) — order/selection keeps the numeric result, no `T`-polymorphism |

  **Runtime:** any absent datum (a scalar operand or a flattened collection
  element — `Missing` or `NaN`) **or an empty input** ⇒ `NaN` (`Quartiles` ⇒
  `(NaN, NaN, NaN)`; `Mode([])` ⇒ `NaN`). `Max(1, Missing, 3) : number = NaN`.
- **`PointX/Y/Z`** keep `pointComponentAt()`'s operand-sensitive typing: a point
  access is `slotType | marker(slotType)`; the non-point-collection fallback
  follows the `First`/… row. No unconditional `number`.

### 3.D Absence discharge — `Coalesce`, `IsMissing` (domain-normalized)

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
    **All-absent:** if every operand is absent, return the **final operand's
    value verbatim** (still absent): `Coalesce(Missing, Missing) = Missing`,
    `Coalesce(NaN, Missing) = Missing`, `Coalesce(NaN, NaN) = NaN`. An operand
    whose absence cannot be decided (symbolic) leaves the expression
    partially unevaluated from that operand on.
  - **Result type.** With `Tᵢ°` the stripped arm: `T₁° | … | Tₙ₋₁° | Tₙ` — every
    operand but the last contributes its stripped type; the last its full type.
    An arm-free final operand guarantees an **arm-free result type** — not a
    present value: `NaN ∈ number` (I6), so `number` never promises presence.
  - **Domain.** Numeric operand absence = `NaN`, object = `Missing`/null;
    `IsMissing` handles both, so `Coalesce` is uniform across domains — no
    `FillNaN` variant needed.
- **Relational family — IEEE over `NaN`, Kleene over `Missing`** (`Equal`,
  `NotEqual`, `Less`, `LessEqual`, `Greater`, `GreaterEqual`; the Julia model,
  **amended 2026-07-24** — supersedes the earlier "Kleene over all absence").
  `Greater`/`GreaterEqual` canonicalize to `Less`/`LessEqual`, so the rule is
  implemented in the four canonical-target handlers (`Equal`, `NotEqual`,
  `Less`, `LessEqual`).
  - **Scalar truth table:** a `Missing` operand (the symbol) makes the result
    `Missing` (Kleene); it wins over `NaN`. Otherwise a `NaN` operand (or an
    operand that numerically evaluates to `NaN`) follows IEEE: `Equal` →
    `False`, `NotEqual` → `True`, every ordering → `False` (unordered). In
    particular **`Equal(NaN, NaN) = False`** and **`NaN < 1 = False`** — the
    orderings previously stayed symbolic, so that is a behavior change worth a
    CHANGELOG callout (§5). Only a literal `NaN` (or an already-evaluated
    operand value that is `NaN`) triggers the IEEE rule; a symbolic operand
    (`x < 1`) stays symbolic. Exact operands are not numericized just to probe
    for `NaN` (exactness contract).
  - **Numeric-domain slots read as `NaN` (GPU cleanup, 2026-07-24).** A
    `Missing` *value* read through an operand whose static type carries a
    **numeric-domain** `missing` arm (`number | missing`) is the I6 off-contract
    occupant of a slot whose honest absence value is `NaN` — comparisons read
    it as `NaN` and follow IEEE (`x : number | missing := Missing` ⇒
    `x == 1` is `False`, not Kleene). Only an **object-domain** arm
    (`string | missing`), a definite `missing` operand, or a literal `Missing`
    keeps the Kleene result reachable. This keeps all three surfaces agreeing:
    the static type (below), the interpreter, and compiled code (where the
    slot's absent value already IS `NaN` at the ABI).
  - **Result type:** `missing` when some operand is definitely absent
    (`missing`); `boolean | missing` when an operand cell carries an
    **object-domain** `missing` arm; `boolean` otherwise — a **numeric-domain**
    arm does not widen (its absence is `NaN`, and IEEE yields a plain boolean),
    which is what lets a comparison over `number | missing` operands compile
    guard-free on float-only targets (GPU). A `NaN` operand is likewise
    invisible at the type level (its static type is `number`) — the IEEE
    `False`/`True` is a runtime-only outcome.
  - **Broadcast:** per-cell, shapes per tensor-design §D6; the element type
    follows the same rule per cell.
  - **Lowering:** numeric-domain operands need **no guard** — a raw `==`/
    tolerant compare IS the IEEE semantics (`NaN == NaN` → `false`), so
    interpreter and compiled agree by construction. An operand that can hold an
    **object-domain** hole (e.g. `string | missing`) still emits the guarded
    form `absence.object.isAbsent(a) || … ? objectNull : a === b`; a target
    without the object axis (GPU) fails closed there. §3.F.

**Flow-narrowing for `IsMissing` is OUT OF SCOPE** — needs occurrence typing a
separate design owns; `IsMissing` ships as a plain boolean, `Coalesce` is the
primary discharge.

| application | result |
|---|---|
| `IsMissing(Missing)` / `IsMissing(NaN)` / `IsMissing(3)` | `True` / `True` / `False` |
| `Coalesce(Missing, 3)` / `Coalesce(NaN, 3)` / `Coalesce(2, 3)` | `3` / `3` / `2` |
| `Coalesce(Missing, Missing)` | `Missing` (all-absent → last verbatim) |
| `Equal(x, Missing)`, `Equal(Missing, Missing)` | `Missing` (Kleene) |
| `Less(Missing, 1)`, `NotEqual(Missing, x)` | `Missing` (Kleene, family-wide) |
| `Equal(NaN, NaN)` | `False` (IEEE; matches float `==`) |
| `NaN < 1`, `Greater(NaN, 1)` | `False` (IEEE unordered; BREAKING — was symbolic) |
| `List(1, Missing, 3)` | `[1, Missing, 3]` (length 3) |
| `Max(1, Missing, 3)` | `NaN` (numeric absorption, I6) |

### 3.E Runtime propagation, element level, short path

```
propagate → any absent operand cell (Missing or NaN) ⇒ NaN in the
            corresponding numeric result cell (I6); under broadcast the gate
            re-enters per element:
            Sin([1, Missing, 3]) → [Sin(1), NaN, Sin(3)]
handle    → defer to the operator's canonical/evaluate handler
            (aggregates: missingDatum() covers scalar operands AND flattened
             collection elements; empty input ⇒ NaN)
reject    → Missing operand ⇒ error — enforced by the behavior gate itself,
            in BOTH strict and non-strict modes
pass-through → no gate; ordinary validation; operand to the handler
```

**`reject` is a behavior gate, not validation.** Non-strict mode skips
*validation*, but the resolved-behavior gate still fires: a `Missing` operand
to a `reject` operator yields `["Error", …]` at the operand in both modes.
(The strict/non-strict split affects only what *other* validation runs, never
whether `reject` rejects — otherwise `reject` would silently degrade to
`pass-through` in non-strict mode.)

**Binary/collection operands and kernel packing.** A `missing`-carrying cell
type (or an actual `Missing` element) demotes packed numeric kernels to the
generic elementwise broadcast path (tensor design §D2.3 — a cell non-numeric
by type kind falls back to generic elementwise); the per-cell gate then
applies: `Add([1, Missing], [10, 20]) = [11, NaN] : list<number>`.

**Numeric short path.** `makeNumericFunction()` applies only when the operator
resolves to the built-in `propagate` definition (all 11 shortcut operators do),
so its hardcoded propagation equals the resolved behavior. A redeclaration with a
different `missingBehavior` replaces the definition and takes the definition
route, so an override wins.

### 3.F Compile — target-supplied absence capability

Compile-time absence is the type's `marker(T)` lowered to the target, chosen per
subexpression by its domain (I6). Because the interpreter normalizes at
construction, **numeric absence at the compile boundary already is `NaN`** — a
compiled function never receives `Missing` in a numeric-domain parameter, and
no conversion shim is needed.

**Guard-free is a property of the result cell's domain, not of the operator.**
A `propagate` application compiles guard-free **iff every result cell is
numeric-domain** — true for float, tensor, and color cells (their components
are numeric). `NaN` propagates natively through float arithmetic
(`Sin(NaN)=NaN`, `x + 1` with `x=NaN` is `NaN`, a mapped `Math.sin` preserves
`NaN` per element), so no guard is emitted. `Add`/`Negate` are declared over
`value`, but every cell they actually compute on is numeric, so the compiled
story is unchanged; a genuinely object-domain cell in a `propagate`
application is handled by the interpreter gate and **fails closed under
compilation** (compile error, not silent misbehavior).

**Target capability — operations, not a tag** (replaces revision 5's
`numericAbsence: 'nan'` constant):

```
absence: {
  numeric: { make(): code, isAbsent(x): code, coalesce(x, d): code },
  object?: { nullLiteral: code, isAbsent(x): code, coalesce(x, d): code },
}
```

- **JS**: `NaN` / `Number.isNaN(x)` / `(Number.isNaN(x) ? d : x)`; object axis
  `undefined` / `x === undefined` / `x ?? d`. **Python**: `math.nan` /
  `math.isnan(x)` / conditional; object axis `None`.
- **Interval target**: `make` = the existing whole-interval NaN object
  (`{lo: NaN, hi: NaN}`), `isAbsent` = `isnan(x.lo)` — reuses machinery
  already in `interval-javascript-target.ts`. No object axis.
- **GPU targets (GLSL/WGSL)**: `make` = the existing `gpuNaN()`/`gpuNaNFor()`
  helpers (neither language has a `NaN` literal). `isAbsent` is declared
  **only if** the target can guarantee `isnan` survives fast-math
  optimization; if undeclared, `IsMissing`/`Coalesce` on that target are a
  **compile error** (fail closed — propagation still works natively, discharge
  doesn't). No object axis: GPU targets compile booleans, but *absent*
  booleans (Kleene results over the `Missing` symbol) do not lower — a
  comparison over an **object-domain** possibly-absent operand is a compile
  error there (§3.D, amended 2026-07-24). A **numeric** comparison is IEEE and
  needs no guard, so it compiles natively.
- A target lacking the `object` axis rejects (compile error) any
  `missing`-typed object-domain position.

**Discharge lowers through the capability** (so interpreter/compiled agree):
`IsMissing` → `absence.numeric.isAbsent` for a numeric-domain position,
`absence.object.isAbsent` for object; `Coalesce` correspondingly.
`Coalesce(At(list<number>,i), 0)` = `0` on both (numeric hole = `NaN` =
absent); `Coalesce(At(list<string>,i), "d")` = `"d"` on both.

### 3.G `Nothing` erasure (normative)

Erasure applies equally to a **literal** `Nothing` and to an operand that
**evaluates to** `Nothing` (route-parity tested).

| site | behavior |
|---|---|
| `List` / `Set` / `Sequence` splicing | element erased (`[1, Nothing, 3]` → `[1, 3]`) |
| `Tuple` literal | element erased (a constructor call, not a fixed-arity type ascription) |
| lazy yields (a `Map` body, generators) | erased from the stream |
| dictionary/record **value** | the whole entry is erased |
| dictionary/record **key** | error |
| the key–value pair tuple itself | **non-erasing position** (erasing would corrupt pair arity — the reverted implementation's carve-out, now normative) |

An all-`Nothing` or emptied collection is the empty collection of the same
kind; erasure composes with nesting (each level erases its own elements only —
a nested list that erases to `[]` is kept as `[]`, not erased from its
parent).

### 4. Interactions with prior ratified decisions

- **Reverses "gather stays narrow" — both halves.** Type: `At(p, I)` reports
  `list<T | marker(T)>`. Runtime: gather is **length-preserving** with holes
  (§3.C) — the baseline dropped out-of-range entries. Honest, discharge-able;
  the visible arm is confined to non-numeric/indeterminate `T`.
- **Re-engages item-67 `matches()` — honestly.** `.matches('number')` on
  `At(list<string>, i)` is `false`; numeric `At` stays `number`, unaffected.
- **Comparisons are IEEE over `NaN`, Kleene over `Missing`** (§3.D, amended
  2026-07-24). `Equal(NaN, NaN) = False` and orderings with `NaN` are `False`
  (matching native float semantics; compiled/interpreted agree with no guard on
  numeric operands), while the `Missing` symbol stays Kleene family-wide
  (`Less(Missing, 1) = Missing`). Object-domain `Missing` comparisons emit the
  guarded form or fail closed.
- **Kernel packing:** a `missing`-carrying cell demotes packed numeric kernels
  to generic elementwise broadcast (tensor design §D2.3) before the per-cell
  gate runs (§3.E).
- **Compile:** numeric holes are `NaN` everywhere; object holes are the
  target's null literal; interpreter/compiled agree (I6).

### 5. Build from baseline (no migration)

There is **nothing to migrate** — the prior `missingPropagates`/gate
implementation was reverted (§1), so this design is implemented **fresh** on
current `main`. Consequences for the plan:

- **Parity baseline = the HEAD at implementation start** (the tip of `main`
  when the implementation branch is cut), *not* the historical `f50e1619` —
  that commit is only the reference point the reverted feature work returned
  to, and `main` has since accumulated unrelated work. The P0 acceptance test
  compares against the implementation-start HEAD.
- **The subtype union-self-membership fix** (`nothing`/`missing`/`unknown <:
  A|B`, auto-memory `subtype-union-self-membership-bug`) is a **prerequisite**,
  folded into P0. (Landed on `main` 2026-07-22 — verify present at branch
  time.)
- **Behavior-preservation applies only to Missing/Nothing-free programs.** An
  expression that mentions neither marker must evaluate byte-for-byte as the
  parity baseline (the P0 acceptance test). This is what `pass-through`
  guarantees.
- **The markers are intended BREAKING changes** — they are *not* "preserved."
  CHANGELOG'd (the reverted commits' CHANGELOG entries are the reference
  copy), with measured snapshot churn, not absorbed silently:
  - `Nothing`-erasure per the §3.G table (`[1, Nothing, 3]` → length 2).
  - The `Missing` marker, `missing` type, and type-directed out-of-band access.
  - **Gather becomes length-preserving** and a mask-length mismatch becomes an
    error (§3.C) — baseline dropped/prefixed silently.
  - **Comparisons are IEEE over `NaN`, Kleene over `Missing`** (amended
    2026-07-24): `Equal(NaN, NaN) = False` matches native `==`, but the
    orderings with `NaN` (`NaN < 1 = False`) previously stayed symbolic, and the
    `Missing` symbol is now Kleene across the whole family
    (`Less(Missing, 1) = Missing`).
- **Initial declarations:** the 15 aggregates declare `missingBehavior:
  'handle'`; `Add`/`Negate` declare `'propagate'` (their `value`-typed
  signatures would otherwise default to `pass-through`); numeric operators
  default to `propagate`; everything else defaults to `pass-through`.
  `missingStrip` defaults to `'all'` everywhere it applies.

### 6. Phasing (greenfield — every landed phase is I5-sound)

- **P0 — primitives & lattice (value-behavior-neutral).** The `missing` type in
  the lattice (I3: disjoint unit, `widen()`-survival, honest predicates), the
  `Missing` symbol, and the subtype union-self-membership fix. Type-system only;
  a Missing-free program is unchanged. **Acceptance:** full suite green with zero
  churn vs the implementation-start HEAD (nothing yet *uses* the type).
- **P1 — markers, erasure, AND the access-operator types (BREAKING).**
  `Nothing`-erasure (§3.G), the type-directed absence marker, out-of-band
  access (`At`/`First`/component/point accessors) yielding the
  domain-normalized marker — **together with the §3.C result-type rows for
  exactly these operators** (`marker(T)`, the access-mode matrix, chained
  absorption, gather/mask rules). Types travel with the runtime change, so P1
  lands I5-sound on its own. CHANGELOG + measured snapshot churn.
- **P2 — behavior & lift.** `missingBehavior` tri-state + resolution +
  `missingStrip` gating (§3.A), the strip/validate/absorb pipeline incl. the
  `operandTypes` context override (§3.B), the runtime gate + element-level
  re-entry + packing demotion (§3.E), and the compile capability object
  (§3.F). Propagate results absorb (no new arms), so P2 introduces no
  type/runtime disagreement.
- **P3 — remaining computed handlers & discharge.** The aggregate table (§3.C),
  `Coalesce` + `IsMissing`, `Equal` (§3.D).
- **Flow-narrowing for `IsMissing` is OUT OF SCOPE** (a separate occurrence-typing
  design); nothing here depends on it.

Each phase is independently landable — and, with the access types moved into
P1, independently *releasable*: no landed state violates I5.

### 7. Open questions

- **Q2** — `At(list<integer>, dynamicIndex) : number` widens integer→number
  (honest: the hole is `NaN`). **Current decision: accept.** A distinct `nan`
  type (result `integer | nan`) is a possible future refinement, out of scope;
  §3.C does not depend on it.
- **Q-E1** — a redeclared shortcut operator resolving back to `propagate`: keep
  the short path, or always the definition route? §3.E currently routes
  redeclarations off the short path (safe); affects only a micro-optimization.

(Decided: **Q3 → §2-I6 domain normalization at value construction** (revision
6, R1) — a `Missing` reaching a numeric slot becomes `NaN` at result
construction; Q-C1 → §3.C indeterminate normalizes to `unknown`; Q-F1 → §3.F
object null literal is the target's declared `absence.object.nullLiteral`
(`undefined` for JS); Q-F2 → no guard for numeric-domain result cells (NaN
native); Q4 → §3.E; D-Q1 → §3.D unified absence, no separate `FillNaN`.)

### 8. Test obligations

- **P0 parity:** a Missing/Nothing-free program evaluates identically to the
  implementation-start HEAD (zero churn); `ce.type('missing')` parses;
  `Missing.isInteger === false`; `[1, Missing, 3] : list<integer | missing>`
  (arm survives `widen`).
- **Inference (I4):** unconstrained symbol infers the bare param; pin
  `\max(x,2x-1)` → `x:value`, `2x:Multiply`, with `Max` as `handle`.
- **Strip (§3.A):** `Max(Missing, 1) : number = NaN`; a `reject` op errors in
  BOTH strict modes; `At(Missing, i)` / `At(xs, Missing)` absorbing
  (`missingStrip: 'all'`); `Characters(Missing)` errors (`pass-through`, no
  strip).
- **Absorption (§3.B):** `Sin(Missing) : number = NaN`;
  `Sin(x:number|missing) : number`; `Sin(list<number|missing>) : list<number>`;
  `Sin(list<missing>) : list<number> = [NaN,…]`; `Add(Missing, matrix)` → all
  cells `NaN`; `operandTypes` override reaches a per-operator `type` handler.
- **Markers (§3.C):** `At(list<number>,i) : number`; `At(list<string>,i) :
  string|missing`; `At(list,i)` elt `unknown` : `unknown`, runtime
  value-directed (all-numeric list → `NaN`, mixed → `Missing`); mask :
  `list<T>` with length-mismatch error; in-range literal tuple index (incl.
  negative): exact slot; out-of-range tuple: `marker(⊔S)`; chained
  `At(m, 9, 0)` into `list<list<number>>` : `number = NaN` (absorbed);
  gather `At([a,b],[1,9,2]) = [a, hole, b]` (length 3); empty index list →
  `[]`; `Mean(list<number>) : number`; `Max(1,Missing,3) : number = NaN`;
  `Max([]) = NaN`; `Quartiles([]) = (NaN,NaN,NaN)`.
- **Discharge (§3.D):** `Coalesce(x:T|missing, d:T) : T`; variadic result;
  short-circuit; all-absent `Coalesce(Missing, Missing) = Missing`; box/parse
  route probes; `IsMissing(NaN) = True`, `Coalesce(NaN, 3) = 3` — same
  interpreter and compiled; `Equal(NaN, NaN) = False` (IEEE) and
  `Less(Missing, 1) = Missing` (Kleene) across the relational family; `Equal`
  broadcast over `list<number|missing>` (Missing cell → `Missing`, NaN cell →
  `False`).
- **Runtime element level (§3.E):** `Sin([1,Missing,3]) → [Sin(1), NaN,
  Sin(3)]`; `Add([1,Missing],[10,20]) = [11, NaN]` (packing demotion).
- **Short-path parity (§3.E):** box/parse/`ce.function`/`ce._fn` agree; a
  `handle`/`reject` redeclaration takes effect.
- **Compile (§3.F):** `Sin(list<number|missing>)` maps natively (no guard);
  `Add(x:number|missing, 1)` → native `x+1`; `Coalesce`/`IsMissing` lower via
  the capability ops, agreeing with the interpreter; object (JS) →
  `Coalesce(At(list<string>,i), "d") = "d"`; `Equal` lowers guarded on JS;
  `IsMissing` on a GPU target without `isAbsent` is a compile error; an
  object-domain `missing` position on a target without the `object` axis is a
  compile error; interval target `isAbsent` = `isnan(x.lo)` parity.
- **Erasure (§3.G):** each table row, literal AND evaluated-to-`Nothing`
  (route parity); dictionary entry erased on `Nothing` value; pair carve-out.

### 9. Test-vector appendix (normative)

```
Sin(Missing)                        : number                = NaN
Sin(x : number | missing)          : number                              (absorption, I6)
Sin(list<number | missing>)        : list<number>
Sin(list<missing>)                 : list<number>          = [NaN, …]
Sin([1, Missing, 3])               = [Sin(1), NaN, Sin(3)]                (runtime)
Add(Missing, 1)                    : number                = NaN
Add(Missing, [[1,2],[3,4]])        = [[NaN,NaN],[NaN,NaN]]                (broadcast into numeric cells)
Add([1, Missing], [10, 20])        = [11, NaN]                            (packing demotion, §3.E)
Max(1, Missing, 3)                 : number                = NaN
Max(list<number>)                  : number                               (NaN datum → NaN)
Max([])                            : number                = NaN
Quartiles([])                      = (NaN, NaN, NaN)
List(1, Missing, 3)                : list<integer | missing>  = [1, Missing, 3]   (data, not a result — I6)
List(1, Nothing, 3)                = [1, 3]                               (erasure §3.G, BREAKING)
Characters(Missing)                : ERROR  (pass-through, no strip)
At(list<number>, 9)                : number                = NaN
At(list<string>, 9)                : string | missing      = Missing
At(list, 9) [elt unknown]          : unknown               = value-directed (all-numeric → NaN, else Missing)
At(tuple<A,B>, 5)                  : marker(A ⊔ B)          (NOT bare missing)
At(tuple<A,B>, -1)                 : B                      (negative in-range literal)
At(m, 9, 0) [m:list<list<number>>] : number                = NaN          (chained absorption into final numeric domain)
At(Missing, 1)                     : unknown               = Missing      (absent base; indeterminate element domain)
At([a,b], [1,9,2])                 : list<T | marker(T)>   = [a, hole, b] (gather length-preserving, BREAKING)
At([a,b,c], [true,false])          : ERROR                                (mask length mismatch, BREAKING)
IsMissing(NaN) / IsMissing(Missing): True / True
Coalesce(NaN, 3) / Coalesce(Missing, 3) : 3 / 3
Coalesce(Missing, Missing)         = Missing               (all-absent → last operand verbatim)
Coalesce(At(list<number>, 9), 0)   = 0    (interpreter AND compiled)
Coalesce(At(list<string>, 9), "d") = "d"  (interpreter AND compiled)
Equal(x, Missing)                  : Missing               (Kleene)
Equal(NaN, NaN)                    = False                 (IEEE; matches float ==)
NotEqual(NaN, x)                   = True                  (IEEE)
Less(NaN, 1) / Greater(NaN, 1)     = False                 (IEEE unordered; was symbolic)
Less(Missing, 1)                   = Missing               (Kleene, family-wide)
NotEqual(Missing, x)               = Missing               (Kleene, family-wide)
compile_js( Add(x:number|missing,1) )         : ok — native x+1 (NaN), NO guard
compile_js( Equal(a,b) [a,b:number|missing] ) : ok — plain a==b, NO guard (IEEE; NaN==NaN → false)
compile_js( Equal(s,t) [s,t:string|missing] ) : ok — guarded: isAbsent(s)||isAbsent(t) ? undefined : s===t
compile_js( Coalesce(At(list<string>,i),"d") ): ok — _at(...) ?? "d"
compile_js( Max([]) ) / compile_js( Min([]) ) : ok — NaN (interpreter parity)
compile_glsl( IsMissing(x) )                  : COMPILE ERROR unless target declares absence.numeric.isAbsent
```

### 10. Review-finding resolutions

**Amendment (2026-07-24 user ruling).** Comparisons follow **IEEE 754 for
`NaN`** and **Kleene for the `Missing` symbol** only (the Julia model), across
the whole relational family (`Equal`/`NotEqual`/`Less`/`LessEqual`/`Greater`/
`GreaterEqual`). `Equal(NaN, NaN) = False`, `NotEqual(NaN, x) = True`, and
orderings with a `NaN` operand are `False` (unordered); the `Missing` symbol
stays `Missing` (`Equal(x, Missing)`, `Less(Missing, 1)`, `NotEqual(Missing, x)`
are all `Missing`). This supersedes the revision-6 "Kleene over all absence"
(finding 20 below, and its `Equal(NaN, NaN) = Missing` vector). Absence for
**discharge** (`IsMissing`/`Coalesce`) and **aggregates** (`Max`/`Mean`/…) is
**unchanged** — `NaN` remains absent there (`IsMissing(NaN) = True`,
`Coalesce(NaN, d) = d`, `Max(1, NaN, 3) = NaN`). Compiled consequence: numeric
comparisons need no guard (plain `==` is IEEE), so compiled/interpreted agree by
construction; only an object-domain (`string | missing`) comparison keeps the
guarded lowering; compiled `Max([])`/`Min([])` now return `NaN`.

**Round 4 → revision 6** (review:
`docs/scratch/2026-07-22-missing-value-typing-design_SPEC_REVIEW_r4.md`;
resolutions R1–R7 therein)

| # | finding | resolution |
|---|---|---|
| 1 | I6 contradicted its own vectors (`Max(1,Missing,3) = Missing` in a numeric position) | **R1** §2-I6 domain normalization at value construction; §3.0/§3.B absorption; §9 vectors updated (`= NaN`) |
| 2 | `marker(T)` not total; compiled ABI unstated | §3.C arm-split `marker`; §3.F ABI (numeric absence IS `NaN` at the boundary) |
| 3 | "every propagate op is numeric" false for `Add`/`Negate` | **R2** §3.F guard-free is per result-cell domain; object cells fail closed |
| 4 | `numericAbsence:'nan'` unimplementable on interval/GPU | **R3** §3.F capability object with per-target ops; GPU discharge fail-closed |
| 5 | P1 I5-unsound yet "independently landable" | **R6** §6 access-operator types moved into P1; every phase releasable |
| 6 | gather/mask runtime undecided | §3.C length-preserving gather, mask-length error; §4/§5 BREAKING entries |
| 7 | `Coalesce` all-absent undefined; totality overclaim | §3.D all-absent rule; totality reworded (arm-free type, not presence) |
| 8 | `At` strip contradiction §3.A vs §3.C | §3.A `missingStrip: 'all' | number[]` declared field; `At` = `'all'` |
| 9 | indeterminate-element runtime value unstated | §3.C value-directed runtime marker; §9 vector gains its `=` value |
| 10 | no empty-input rule for order-selection aggregates | §3.C: all 15 → `NaN` on empty (`Quartiles` → `(NaN,NaN,NaN)`) |
| 11 | binary-collection cell propagation not tied to packing | §3.E §D2.3 demotion rule + `Add([1,Missing],[10,20])` example |
| 12 | proxy operands unimplementable | §3.B `operandTypes` type-handler-context override |
| 13 | nested exactly-`missing` cells unclassified | §3.0/§3.B: strip → `never`, classified `possible`; `Sin(list<missing>)` vector |
| 14 | `Equal` cell-aware typing asserted not specified | §3.D truth table + type rule + broadcast + lowering |
| 15 | `reject` degrades in non-strict mode | §3.E `reject` is a behavior gate, fires in both modes |
| 16 | `Nothing`-erasure boundaries unenumerated | **§3.G** normative erasure table (incl. dictionary-pair carve-out) |
| 17 | stale `f50e1619` parity baseline | §5/§8 parity vs implementation-start HEAD; `f50e1619` demoted to history |
| 18 | Q3 silently dropped | §7 "Decided: Q3 → I6" |
| 19 | chained-marker carry not representable | §3.C value-level absorption; marker recomputed per step |
| 20 | Kleene `Equal` vs NaN / native `==` divergence | §3.D truth table (`Equal(NaN,NaN)=Missing`), guarded JS lowering, GPU fail-closed; §4/§5 BREAKING |

**Round 3 → revision 4** (carried into revision 5 unchanged; item 3's
definite/possible **result** machinery and item 5's marker-carry were
subsequently superseded by revision 6's R1/R4 — absorption and value-level
absorption)

| # | finding | resolution |
|---|---|---|
| 1 | NaN-as-absence vs interpreter discharge | §3.D/§3.F domain-directed absence — superseded by rev-6 I6 (normalization at construction) |
| 2 | value domain per-subexpression, `Add` guard | §3.F: numeric → `NaN` native, guard removed — sharpened by rev-6 R2 (per-cell rule) |
| 3 | cell formalism nested under-approx / exact | §3.B recursive strip; definite/possible taxonomy (now used by `handle` only) |
| 4 | literal tuple/record miss wrong marker | §3.C `marker(⊔S)`/`marker(⊔V)`, not bare `missing` |
| 5 | chained marker recomputed | superseded by rev-6 R4: value-level absorption, marker recomputed per step |
| 6 | `Equal` no result-type rule | §3.D — completed in rev-6 (truth table, broadcast, lowering) |
| 7 | `unknown\|number\|missing` not normal form | §3.C normalizes to `unknown` (I5-sound) |
| 8 | strip admits `At(Missing,1)` | §3.A `missingStrip`; §3.C `Missing` base/index absorbing |
| 9 | aggregate rule incomplete | §3.C 15-operator table; both call shapes; rev-6 adds empty-input rule |
| 10 | open questions gate normative rules | §7 trimmed with decisions stated |
| 11 | P2/P3 I5-sound interim gap | superseded by rev-6 R6: access types in P1, every phase sound |
| 12 | negative literal tuple index | §3.C negative in-range literal → `(n+1+k)`-th slot |

**Rounds 1–2** — see the round-1 review file; all resolved and superseded where a
later round refined them (R2#2 compile boundary → R3#1/#2 → rev-6 I6; R2#1
indeterminate → R3#7 normalized). The round-2/round-3 review files were lost in the
revert's untracked-file sweep; their findings live in these maps.
