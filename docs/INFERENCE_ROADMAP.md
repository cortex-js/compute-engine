# Inference Roadmap — Collection Elements and Placeholder Refinement

_Drafted 2026-08-18, immediately after the bare-type synonym ruling shipped
(bare `list` ≡ `list<unknown>`; `any` strictly above `unknown` — see the
"Bare collection constructors: RULED AND IMPLEMENTED 2026-08-17" entry in
`ROADMAP.md` and `doc/08-guide-types.md` §"`unknown` vs `any`, and What a
Bare Type Means"). Status, updated 2026-09-05: **the Phase 0 guard, Phase 1
and Phase 2 are SHIPPED (2026-08-18). The row 4 question (union parameters)
is CLOSED with no change needed (§4). Phase 3 (use-driven element
inference) is IMPLEMENTED (2026-09-05, §5). Only the full Phase 0 bounds
remain OPEN, and they stay deferred (§8.2).**_

## 1. The design intent this roadmap serves

**`unknown` means "not known yet — refine it when evidence arrives."** It is a
placeholder, not a contract. **`any` means the opposite:** a deliberate,
maximally-wide contract (it additionally admits the absence markers
`nothing`/`missing`), and a contract never moves.

That pair is already ruled and implemented at two granularities
(2026-08-15 placeholder ruling; `ROADMAP.md`, placeholder-signature entry):

| Granularity | Placeholder behavior today | Mechanism |
|---|---|---|
| Whole symbol | `x: unknown` narrows from use, exactly like an undeclared symbol | the movability gate `inferredType \|\| type.isUnknown` (`assignValue` in `engine-declarations.ts`, mirrored wherever "can a use move this type?" is asked) |
| Signature slot | `f: (unknown) -> unknown` has each slot refined per-position by the assigned definition, and the refined signature is persisted | `refineDeclaredPlaceholders` (`boxed-expression/effects-inference.ts`), run at the three install routes and in `matchesDeclaredTypeAxes` |
| **Constructor argument** | **`list<unknown>` (= bare `list`) — the element slot NEVER refines** | none — this roadmap |

The missing third row is a granularity gap, not a semantic disagreement: the
user-stated intent (2026-08-18) is that `let a: list` means "definitely a
list — that part is the contract — elements to be determined."

The symmetry worth preserving, because it makes the whole system teachable:

- `(any) -> any` is the function **contract**; `(unknown) -> unknown` is the
  refinable **placeholder**.
- `list<any>` is the collection **contract** (absence-admitting, never
  moves); bare `list` (= `list<unknown>`) is the refinable **placeholder**.

Same pair, same semantics, one level down.

## 2. Current behavior — the measured gap matrix

Probed 2026-08-18 on the post-synonym-ruling tree; re-probed 2026-09-05
(the "Today" column). When the roadmap was drafted, element types flowed
**out** of collections (synthesis and extraction) but never **in**
(inference). Rows 1 and 5 now flow in; rows 2 and 3 still do not.

| # | Program | 2026-08-18 | Today (2026-09-05) | Status |
|---|---|---|---|---|
| 1 | `f: (list<number>) -> number`; `f([a, b])` with undeclared `a`, `b` | `a`, `b` stay `unknown` — the constraint dies at the literal's boundary | `a`, `b` infer `number` | SHIPPED (Phase 2) |
| 2 | `xs` undeclared; `xs[1] + 1` | `xs` narrows to `dictionary<any> \| indexed_collection<any>` — element slot stays `any`, the numeric evidence is computed and discarded | `xs: indexed_collection<number>`, and `xs[1]` then types `number` | IMPLEMENTED (Phase 3, 2026-09-05) |
| 3 | `(v) => v[1] + 1` | `(v: dictionary<any> \| indexed_collection<any>) -> broadcastable<number>` — the result type PROVES the engine derived the numeric flow, and never wrote it back | `(v: indexed_collection<number>) -> broadcastable<number>` | IMPLEMENTED (Phase 3, 2026-09-05) |
| 4 | `ys` undeclared; `Mean(ys)` (the draft used `Sum(ys)`; see §4 for why that example was wrong) | reported as "`ys` stays `unknown` — union parameter ⇒ no inference write at all" | `Mean(ys)` writes `collection<any> \| distribution \| number` onto `ys`; `Sum(ys)` stays `unknown` because the summand parameter of `Sum` is `any`, not a union | CLOSED 2026-09-05, no change needed (§4) |
| 5 | `a: list` (declared); `a = [1, 2, 3]` | `a`'s type stays `list` — the whole declared type is frozen, element slot included | `a` reports `list<integer>`; a later `a = ["x"]` re-refines to `list<string>` | SHIPPED (Phase 1) |

What already works and must not regress:

- **Synthesis**: a literal's type is computed from its elements
  (`[1,2,3]` → `vector<integer^3>`); assignment to an undeclared
  symbol copies it, and re-assignment re-infers freely.
- **Extraction (forward)**: generic signatures bind `T` from the operand —
  `xs: list<integer>` makes `xs[1]` an `integer`.
- **Whole-type argument narrowing**: an `unknown`-typed symbol at a typed
  parameter narrows to the parameter type, including through user-function
  forwarding (`narrowArgsFromInferredSignature`, `boxed-expression/box.ts`).

## 2b. Phase 0 — evidence/requirement bounds for symbol inference

_Added 2026-08-18, from the observation that this program reports its
conflict only at evaluation:_

```
let x
let f: () -> integer
let g: () -> number
let k: (integer) -> integer
x = f()      // x infers integer
x = g()      // x re-infers number
k(x)         // no static error; incompatible-type surfaces at EVALUATION —
             // and the call NARROWS x back to integer, contradicting the
             // number-typed value it holds
```

**Current model:** a symbol's inferred type is ONE mutable cell
(`def.value.type` + the `inferredType` flag), mutated by two verbs —
assignment replaces/widens, argument positions narrow (`checkType`'s
"narrowing is sound" branch in `boxed-expression/validate.ts`). Evidence
(what assignments prove the symbol HOLDS) and requirements (what uses need
it to FIT) share the cell, so a use can rewrite assignment history: above,
`k(x)` treats its requirement as evidence, passes statically, and leaves the
stored type (`integer`) contradicting the held value (`number`). The model
is also order-dependent — swap `x = g()` and `k(x)` and the stored type
differs.

**Why it is this way:** the CAS persona. For a pure mathematical unknown
(never assigned), use-narrowing is CORRECT — `k(n)` *declares* `n: integer`;
that is the documented behavior (`doc/08-guide-types.md` §Type Inference)
and must be preserved. The model is only unsound for the program-variable
persona, where assignment evidence exists. One cell serves both; the seam is
programs like the one above.

**The fix shape — track the two directions separately:**

- Two slots on the value definition: a **value bound** (lower — set by
  assignment, REPLACED on re-assignment: mutable variables are
  last-write-wins) and a **use bound** (upper — the MEET of argument-position
  requirements; today's narrow-writes become this).
- The invariant `valueBound <: useBound` is checked whenever either slot
  moves. In the example, `x = g()` sets lower `number`; `k(x)` proposes
  upper `integer`; the check fails AT THE CALL, statically, and the
  diagnostic can name both sides ("x was assigned a `number` (from `g()`);
  `k` requires `integer`") instead of whichever mutation survived.
- **Epoch semantics:** re-assignment resets the use bound with the value
  bound. Otherwise `x = f(); k(x); x = g()` — fine at run time, `k` already
  ran — would be rejected by a stale upper. Bounds are per assignment-epoch,
  which is the flow-sensitivity a statement-sequence language actually has.
- **Reporting:** an unassigned symbol reports its use bound (preserving CAS
  behavior byte-for-byte — uses narrow what `typeof` shows); an assigned one
  reports its value bound. The two personas fall out of which bound has
  content; no mode flag.
- **Reuse:** the join/meet/absorption machinery already exists in the
  type-variable solver (S1/S2, `common/type/instantiate.ts`) — this phase
  applies it to symbols; `widen`/`narrow`, the rollback journal, state
  events, provenance flags and speculative-parse confinement all carry over
  (confinement must cover BOTH slots). Genuinely new: the second slot, the
  two-site check, epoch reset on re-assignment, and the two-bound
  diagnostic.
- **Side benefit:** within an epoch, bounds accumulate commutatively, so
  symbol inference becomes order-independent — worth having even apart from
  the error-catching.

Phase 0 is listed before the element phases because Phase 3's use-driven
element writes are ALSO requirements — they want a use-bound slot to land
in; building them on the single-cell model would deepen the conflation this
phase removes.

**VERDICT (2026-08-18, after an honest cost/benefit pass): right direction,
deferred — a targeted guard captures most of the value now.** The narrow
branch in `validate.ts` checks `inferredType` but never whether the symbol
currently HOLDS a value; adding an evidence-beats-requirement guard ("do
not use-narrow a symbol with assignment evidence") makes the motivating
example fail AT CANONICALIZATION with the standard diagnostic and removes
the corrupted-stored-type aftermath, while leaving the CAS persona
(valueless symbols narrow from use) untouched — the guard keys on held
value, not history. What full bounds add beyond the guard — two-sided
diagnostics, within-epoch order-independence, the Phase 3 landing slot — is
real but modest, while the costs are concentrated: the persona fork becomes
USER-VISIBLE semantics (the same `k(x)` is a declaration or a check
depending on invisible prior state, and notebook out-of-order re-runs make
epoch boundaries observable — a deliberate violation of the
"states differing only by history must not behave differently" principle),
and the second slot threads through rollback, state events, notebook
re-run, and speculative confinement, each with an incident history. In an
interpreted, eagerly-evaluated language the static/runtime gap is one
statement wide, discounting the headline benefit. **Plan of record — GUARD RULED GO AND SHIPPED 2026-08-18, INCLUDING
the whole-program static half:** in the narrow branch of
`validateArguments` (`boxed-expression/validate.ts`), a use of an ASSIGNED
symbol now checks instead of narrowing — and the evidence checked is the
**held value's own type**, not the symbol's stored type, because
assignment WIDENING (a `Complex(1,-1)` value stores the symbol as
`number`) can make the stored type fail a parameter the actual evidence
satisfies. Three outcomes: a valueless symbol narrows exactly as before
(the CAS reading); an assigned symbol whose held value fits the parameter
is admitted, and the post-validation pass may then SHARPEN the widened
stored type toward the parameter (licensed: admission guaranteed the held
value satisfies it); one whose held value does not fit gets the ordinary
`incompatible-type` error at canonicalization.

The catch a whole-file run exposed (2026-08-18, same day): inference state
is created by EXECUTION, so the Epsil static pre-pass — which runs before
anything evaluates — saw `k(x)` against an `x` that had never learned
`number`, and the error only surfaced mid-run at the offending statement.
Fixed by teaching the pass STATIC TYPE EFFECTS
(`applyAssignmentTypeEffect`, `epsil/static-diagnostics.ts`):

- `let f: () -> integer` installs a pass-scoped CONTRACT declaration
  (`Declare` installs at evaluate time, which the pass never runs, and
  `registerPinnedSignature` covers only names-carrying signatures);
- a top-level `x = g()` writes `x : number` through the journaled `_infer`
  channel with the new `replace` mode (assignment is last-write-wins — a
  join-of-assignments model would wrongly reject the reversed program) and
  records the RAW right-hand-side type as assignment evidence
  (`ce._staticAssignmentEvidence`), which the validation guard reads where
  a held value would otherwise be;
- the free-variable "provisional type" un-rejection in `box.ts`'s
  symbol-head validation treats evidence-carrying symbols as definite, so
  the pass's rejection survives to become a `static-type-error`.

Two lazy-operator traps hit on the way: `Assign`/`Declare` hold their
operands UNBOUND (the right-hand side types `unknown` until `.canonical`
binds it), and the effect must be top-level-only (statements nested in
control flow contribute nothing — conservative without flow analysis).
The motivating program now reports `static-type-error: expected
`integer`, got `number` at `x`` BEFORE anything runs; the reversed
program, the widened-`Complex` program, and valueless CAS programs stay
clean. All personas and the one-shot matrix pinned in
`test/compute-engine/use-narrowing-evidence-guard.test.ts`. Full Phase 0
bounds remain DEFERRED — contingent on Phase 3 being scheduled or field
evidence demanding the two-sided diagnostics/order-independence, with the
notebook-epoch UX ruled on concrete re-run scenarios before building.

## 3. Phase 1 — assignment-driven placeholder refinement of constructor arguments — **SHIPPED 2026-08-18** (with Phase 2)

Implemented as ruled (re-refine; element-only; `typeof` shows it):
`_placeholderSkeleton` on the value definition keeps the declared bare
constructor as the CONTRACT (assignment compatibility judges against it —
`assertAssignableValueDef`), while the reported type carries the element
refinement (`refineConstructorPlaceholder`,
`boxed-expression/boxed-value-definition.ts`), recomputed by every
assignment on the assign route, the declare-with-value route, and the Epsil
static pre-pass (pass-declared skeletons only — outer definitions are never
mutated outside the journaled channel). Phase 2 shipped alongside:
`distributeLiteralElementInference` (`boxed-expression/validate.ts`) writes
a collection parameter's element type onto the symbol elements of a
genuinely admitted List literal (`f([a, b])` at `(list<number>) -> …`
infers both); tuple-slot distribution exists but fires only on genuine
admission — a tuple of unknowns is only provisionally re-admitted by the
free-variable un-rejection, and inference from an unproven admission is
deliberately withheld. Pins:
`test/compute-engine/placeholder-element-refinement.test.ts`.

### Original Phase 1 design (for reference)

**Feature:** a declared type whose constructor argument is the placeholder
(`unknown`, including the bare synonyms `list`/`set`/`dictionary`/
`collection`/`indexed_collection`) refines that argument per-position from an
assigned value's type. The constructor itself stays a contract: `a: list`
still refuses `a = 42`.

**Mechanism** (all pieces have signature-slot precedents):

1. A structural sibling of `refineDeclaredPlaceholders` that walks
   constructor arguments instead of signature slots: declared
   `list<unknown>` + value `vector<integer^3>` ⇒ adopt the element
   type into the declared spelling. Runs where the signature version runs:
   the three install routes in `engine-declarations.ts` (value-def assign,
   operator-def assign, declare-with-value) and `matchesDeclaredTypeAxes`.
2. Extend the movability gate from whole-type `type.isUnknown` to "has a
   refinable placeholder slot" (a `hasPlaceholderSlots(t)` walk). Every
   extension site must inherit the **speculative-parse confinement** the
   whole-type gate received on 2026-08-15 (`speculative-parse.test.ts`):
   without it, `ce.parse(latex, {speculative: true})` would persist element
   refinements — the exact leak class fixed there.
3. Nothing new in representation or rollback: refinements land through the
   existing `_infer`/type-setter path with its rollback journal and state
   events.

**Confinement rule (hard):** only placeholder spellings participate. A
declared `list<real>` assigned `[1,2,3]` must NOT refine to
`list<integer>` — a stated element type is a contract, and eroding it is
the failure mode this design must prove it avoids. Likewise `list<any>` never refines: `any` is the contract
spelling by definition.

### Open rulings Phase 1 needs — ALL RULED 2026-08-18, as recommended (re-refine; element-only; typeof shows the refinement)

- **R1 — Does refinement re-revise?** After `a: list` and `a = [1,2,3]`
  (element refined to `integer`), does `a = ["x"]` fail
  (refinement hardened into contract) or re-refine (placeholder stays a
  placeholder)? _Recommendation: re-refine._ The contract the user wrote is
  list-ness, nothing more; hardening would make the annotated symbol
  stricter than the unannotated one, which is the anti-pattern the 08-15
  ruling exists to prevent ("a placeholder declaration was strictly more
  restrictive than no declaration"). Note this deliberately DIVERGES from
  the signature precedent, where the refined signature persists and governs
  — divergence justified because a function's refined signature is
  re-derived on every body re-assignment anyway, which is the same
  observable behavior as re-refinement.
- **R2 — Element only, or dimensions too?** `a: list` + `[1,2,3]`:
  `list<integer>` (element only, rank and length stay open) or the
  value's full `vector<integer^3>`? _Recommendation: element only._
  The user wrote `list`; rank-openness is part of what the bare spelling
  says, and per-assignment length pinning would make `a = [1,2]` a spurious
  contract question under R1-hardening readings.
- **R3 — What does `typeof` report?** Refinement makes the declared
  symbol's static type visibly move, reversing the documented
  "annotating loosely gives a wider static type than not annotating"
  behavior (`doc/08-guide-types.md`, "Declared vs Inferred" — that section
  must be updated in the same change). _Recommendation: show the
  refinement._ That is the point of the feature; the doc section's framing
  shifts from "contract vs evidence" to "the contract is the constructor,
  the placeholder refines."

**Size feel:** comparable to the 08-15 signature-refinement round — one
session with a plan doc, route-parity tests (box, parse, Epsil `let`), and
pins for R1/R2/R3 as ruled.

## 4. Phase 2 — downward distribution into literals — **SHIPPED 2026-08-18**; row 4 **CLOSED 2026-09-05**

The literal distribution shipped with Phase 1 (see §3,
`distributeLiteralElementInference`). The union-parameter question (row 4)
is closed below. The original design follows.

### Row 4 — union parameters: CLOSED 2026-09-05, no change needed

The row as drafted mis-diagnosed its own example. Two facts, measured on
the 2026-09-05 tree (`npx tsx` probes against `src/compute-engine`):

- **A union-typed parameter already writes the union onto an undeclared
  symbol operand, as whole-type evidence.** With
  `g: (collection<any> | number) -> number`, the call `g(zs)` leaves
  `zs: collection<any> | number`; `Mean(ms)` leaves
  `ms: collection<any> | distribution | number`. This is exactly the option
  the draft recommended ("write the union — it is what the parameter
  states"), and it is the live behavior. The write takes the ordinary
  path: `inferenceTypeAt` in `boxed-expression/validate.ts` hands the
  parameter (for an overload set, the join over the viable arms) to
  `BoxedSymbol._infer`, which narrows the symbol's `unknown` to the union.
  There is no union-specific decline anywhere on that path. Whether the
  2026-08-18 probe ran against a tree that behaved differently was not
  re-established; what is established is that the union is not the cause
  today.
- **`Sum(ys)` stays `unknown` because the summand parameter of `Sum` is
  `any`.** Its signature is `(any, tuple*) -> number` (unchanged since
  before the draft): the summand may be an arbitrary body expression when
  an indexing set follows, so the slot cannot name a collection. Narrowing
  `unknown` by `any` yields `unknown`, and `_inferWithoutFacts`
  (`boxed-expression/boxed-symbol.ts`) deliberately skips a write of
  `unknown` — such a write would reset a held value through the type
  setter. This is correct: `any` is the contract spelling and carries no
  evidence (§1).

**Decision:** nothing to build. The mechanism the draft asked for exists;
the example moves from `Sum` to `Mean`. Making `Sum(ys)` (no indexing set)
infer `collection<any> | number` would need the `Sum` canonical handler to
write collection evidence when the summand is a bare symbol with no
indexing set. That is a `Sum`-specific rule, not an inference-model one,
and it is not scheduled.

**Observed limit, recorded as intended behavior, not as a defect:** a
union written as evidence is not narrowed further by a later threadable
use. After `g(zs)`, the expression `zs + 1` leaves `zs` at
`collection<any> | number`: `Add` is threadable, and the threadable
exclusion (`couldBeUnkeyedCollectionOperand`, same file) declines to write
`number` onto an operand that could still be a collection, because that
write would decide the broadcast question by inference. The same holds for
`ws[1]` after `h(ws)` with `h: (list<number> | number) -> number`: `ws`
stays `list<number> | number`. Sharpening a union from a later use is the
Phase 3 shape (use-driven reverse propagation) and belongs to that round.

### Original Phase 2 design (for reference)

**Feature:** when argument validation's final inference pass
(`validateArguments`, `boxed-expression/validate.ts` — the `_infer(t)` loops
after the valid path) hands a collection-typed parameter to a **List/Tuple
literal** operand, distribute the element type onto the literal's *symbol*
elements: `f: (list<number>) -> number`, `f([a, b])` ⇒ `a._infer('number')`,
`b._infer('number')` (row 1 of the matrix).

- Small and self-contained: one new branch in the required-param inference
  loop plus its optional/variadic mirrors, honoring the existing exclusions
  (`lazy`, `deferredIdx`, threadable/`couldBeUnkeyedCollectionOperand`).
- The literal's own type is re-derived from its elements, so the collection
  type sharpens automatically once the elements do.
- Decide row 4 here too: union parameters currently make NO inference write
  (deliberately — the join would over-commit). Options: keep declining, or
  write the union itself as whole-type evidence (`Sum(ys)` ⇒
  `ys: collection<any> | number`). _Recommendation: write the union —
  it is exactly what the parameter states, and the whole-type write is the
  established, revisable kind._

## 5. Phase 3 — use-driven element inference — **IMPLEMENTED 2026-09-05**

**What shipped (rulings R1 option A, R2 the scalar rule, R3 deferred — all
as recommended).** A requirement on the element an accessor returns is a
requirement on the elements of the collection it reads. The mechanism is
one optional handler on an operator definition, `inferOperandTypes(ops,
requirement)` (contract on `OperatorDefinition`, `types-definitions.ts`),
and one branch in `BoxedFunction._infer` (`boxed-expression/boxed-function.ts`):
when a requirement (`narrow` mode) reaches an application whose operator
has the handler, the handler answers the type each operand must have, and
each answer is written onto the operand through its own `_infer`. A symbol
takes the write when its type is inferred or unknown, never when declared
(so a declared `list<any>` and the bare placeholder `list` stay put —
R3); a nested application forwards to its own handler, so `m[1][2] + 1`
reaches `m`. Handlers: `At` (`indexed_collection<r>` under a numeric index or a
gather/mask, `dictionary<r>` under a string key, the two-arm union when the
index kind is open; declined for a multi-index access, a ring-constant
base, and a collection-typed requirement under an index of open kind), and
`First`/`Second`/`Third`/`Last` (`indexed_collection<r>`). The dual review
of the delivery (Claude + Codex) added the gather and string-key arm rules,
a record-arm read in the `At` type handler's union branch, and a
fall-through to inferred-signature narrowing when no operand takes a
write. The `At` type handler now reads the element
type out of a two-arm union base, so the refined element is what later
canonicalizations see (`xs[1]^2` types `number`). Rollback, hidden
assumptions, resolve-only regions, speculative-parse confinement and the
assignment-evidence guard are inherited from the symbol write. Pins:
`test/compute-engine/use-driven-element-inference.test.ts`.

**Facts measured during the design round (2026-09-05).** The scalar reading
a bare symbol gets from `x + 1` is `number` on today's tree (the guide's
older `real` is out of date), so the element write is `number` too. An
inferred lambda signature is not enforced at application, so a matrix-row
program `(m) => m[1] + 1` applied to a matrix still evaluates. Both compile
targets already compiled `xs[1] + 1` over an untyped collection before this
phase, and a `broadcastable<real>` element type makes the `interval-js`
target decline, which is why option B (write what the broadcast proves) was
rejected. The three payoffs named in the August draft below had all been
realized by other means or did not apply; what this phase delivers is
precise static types (`typeof`, lambda arrows, the Epsil hover and `epsil
check` report).

**Two defects found and fixed on the way.** The numeric short path
(`checkNumericArgs`, `boxed-expression/validate.ts`) admitted any
`T | missing` operand without checking the carrier, so `q + 1` with
`q: boolean | missing` was valid while `Sin(q)` was an error, and a boolean
element read then used numerically wrote `never` onto its collection. The
carrier is now validated behind the absence arm on the short path too. (A
general refusal to record `never` on a symbol was tried and withdrawn: a
serialization pin deliberately records `never` for a corpus row that reads
`f` both as a number and as a function, and locks that in.)

**One residual, RULED AND FIXED the same day.** The compiler trusts a
static element type, declared or inferred: a compiled lambda with parameter
`v: indexed_collection<number>` fed a matrix emitted scalar `+` over a row
and returned a concatenated string, while the interpreter returns the row
plus one. Before this phase the inferred parameter type was
`indexed_collection<any>` and the compiled lambda broadcast; a DECLARED
`(v: indexed_collection<number>)` already produced the string. Ruled
(option 1 of three): the JavaScript target's scalar element read now checks
the run-time value when the static element type is numeric and the base
reads a value from outside the kernel (a free symbol or a parameter), and
throws a clear error naming the static type and the remedy
(`_SYS.atNumeric`, `compilation/javascript-target.ts`; the check dispatches on the run-time index shape, so a gather is checked element by element). A closed base
(a literal, a constant-folded collection) and a tuple base (positional
slots; the destructuring lowering reads a tuple-valued call through `At` on
a compiler temporary) are not checked. The top-level
`xs[1] + 1` over an inferred `xs`, which broadcast by accident of
type-computation order, now fails loudly too when handed a matrix.

### Original Phase 3 design (for reference)

**Feature:** rows 2–3. When an application *result* is narrowed —
`BoxedFunction._infer(t)` (`boxed-function.ts`) already fires when `xs[1]`
is consumed numerically — and the head's signature is generic
(`(indexed_collection<T>, …) -> T`), solve the **inverse** instantiation
(`T` from the constraint `result <: t`) and write the reconstructed operand
type (`indexed_collection<T>`, unioned with the dictionary arm where `At` is
the head) back onto the operand symbol through the ordinary `_infer` path.

Building blocks and gaps:

- The solver already collects **upper** bounds
  (`walkPattern(…, 'upper', …)`, `common/type/instantiate.ts`) — the inverse
  direction is half-built. The new wiring is in `BoxedFunction._infer`,
  which today narrows only an unknown *head's* inferred result signature,
  never operand types.
- **Participation list, not a blanket rule:** extraction-shaped operators
  only (`At`, `First`/`Second`/`Third`/`Last`, `Take`/`Drop` family,
  `Map`'s callback argument). Every operator on the list needs a generic
  arm the inverse can run against — `At`'s two ground `AT_SIGNATURE`
  spellings end in `-> unknown` and would need a generic arm or a bespoke
  hook.
- **Guess semantics need their own ruling:** `xs[1] + 1` proves ONE element
  is numeric, not all of them; heterogeneous lists are legal. Options range
  from committing the element type (revisable, like every inference) to a
  partial spelling. The boolean-retype trap is the failure shape to design
  against: `And(xs[1], …)` must not poison `xs` for later numeric use.
- Row 3 (lambda parameter element types) then costs nothing:
  `inferredCollectionParameterType` (`effects-inference.ts`) reads the
  binding symbol's type after body canonicalization and picks up whatever
  Phase 3 wrote.

**Design round opened 2026-09-05:** the mechanism was measured and the plan
written in a plan document (removed with the landing, as `docs/plans/README.md`
requires; its record is this section), which also re-assessed the payoff
below: two of the three places named here have
since been served by other means (the `<any>` union already excludes every
scalar, so broadcast decisions are already right; both compile targets
already compile `xs[1] + 1` over an untyped collection), and the third
(Tycho's classification) needs a tuple element type that no arithmetic use
produces. What remains is precise static types. The plan asks for a go/no-go
and three rulings (guess semantics, boolean uses, declared placeholders).

**Why Phase 3 was expected to be worth its risk (as drafted 2026-08-18):** the payoff concentrates in three places —
broadcast decisions (`paramsAreScalar` reads the lambda's param slots), the
compile fail-closed gates (D6: numeric indexing over a declared-but-unassigned
collection currently cannot compile for lack of element evidence), and
consumer classification (Tycho reported 2026-08-17 that
`couldBeType(x, "collection<number>")` on an unrefined `indexed_collection`
symbol defeats their numeric-collection evidence check —
`classification-collection-evidence.ts:785` in their tree; element inference
is the real fix, the `couldMatch` overlap repair of the same date was the
palliative).

## 6. Cross-cutting risks (apply to every phase)

- **Every inference write is dispatch-visible.** `matches()` doubles as the
  canonicalization dispatch predicate; the 2026-08-15 lattice-flip incident
  (an element access typed `unknown` "matched" `matrix`, so `P[1]^2`
  canonicalized as `MatrixPower`) is the scale of failure to expect from
  writing sharper types earlier. Guards: positive evidence only, inferred
  (never declared-contract) targets only, every write revisable.
- **Speculative-parse confinement** at every new movability site (see
  Phase 1, item 2).
- **Post-synonym spelling care:** reverse writes must not spell values-only
  element types over evidence that admits absence — an element that can be
  `Missing` (regex match results) must keep its absence arm, or the
  bare-name gates (values-only since 2026-08-17) misroute it.
- **Contract erosion** is the red line throughout: only `unknown`-slot
  spellings refine, ever.

## 7. Suggested order

0. **The Phase 0 GUARD** (evidence-beats-requirement) — **SHIPPED
   2026-08-18.** Full Phase 0 bounds remain deferred — contingent on
   Phase 3 being scheduled or on field demand, with the notebook-epoch UX
   ruled first.
1. **Phase 1** — **SHIPPED 2026-08-18** with R1–R3 ruled as recommended
   (§3).
2. **Phase 2** — **SHIPPED 2026-08-18** with Phase 1. The union-parameter
   question (row 4) was **CLOSED 2026-09-05** with no change needed (§4).
3. **Phase 3** — **IMPLEMENTED 2026-09-05** after a same-day design round
   (§5); the plan document is removed with the landing, as
   `docs/plans/README.md` requires. As drafted: as its own design round with a written plan
   (`docs/plans/…`), the participation list, the guess-semantics ruling,
   and route-parity tests — the binder-mechanism treatment.

## 8. What is left, in plain language (2026-09-05)

One item is open, and deferred. Everything else in this document is shipped
or closed.

### 8.1 Phase 3 — use-driven element inference — IMPLEMENTED 2026-09-05

`xs[1] + 1` now writes `indexed_collection<number>` onto an undeclared
`xs` (§5). The design round and the implementation happened the same day,
under the rulings recorded in §5. One residual went to `ROADMAP.md`: the
compile-route divergence for a collection-typed lambda parameter fed a
nested list.

### 8.2 The full Phase 0 bounds — what "bounds" means

Today a symbol's inferred type is ONE mutable cell. Two different kinds of
information write into it:

- **Evidence**, from assignments: what the symbol is known to HOLD. With
  `g: () -> number`, the statement `x = g()` proves that `x` holds a
  `number`.
- **Requirements**, from uses: what a call NEEDS the symbol to fit. With
  `k: (integer) -> integer`, the call `k(x)` requires `x` to be an
  `integer`.

Because both write the same cell, a use could rewrite assignment history.
In the program of §2b, `x = g()` stored `number`, then `k(x)` narrowed the
cell back to `integer`. The stored type then contradicted the held value,
and the error appeared only at evaluation.

The "bounds" design keeps the two directions in separate slots:

- a **value bound** (the lower bound), set by an assignment and replaced by
  each re-assignment;
- a **use bound** (the upper bound), the meet of every requirement from an
  argument position.

The invariant is: the value bound must be a subtype of the use bound. It is
checked whenever either slot moves, so the conflict above is caught at the
call, statically, and the diagnostic can name both sides: "x was assigned a
`number` (from `g()`); `k` requires `integer`". A re-assignment resets the
use bound, so `x = f(); k(x); x = g()` stays legal. A symbol that was never
assigned reports its use bound, which preserves the CAS behavior where
`k(n)` declares `n` to be an integer. An assigned symbol reports its value
bound.

**Why it was deferred.** A cheaper guard captured most of the value and
shipped on 2026-08-18 (§2b): a use of an ASSIGNED symbol now checks the
held value's type instead of narrowing the cell, and the Epsil static pass
reports the conflict before anything runs. What the full design adds beyond
that guard is modest: two-sided error messages, order-independence of
inference within one assignment epoch, and a proper landing slot for
Phase 3 writes (which are requirements too). The costs are concentrated:
the second slot must thread through rollback, state events, notebook
re-run, and speculative-parse confinement, and the two personas become
user-visible semantics, where the same call `k(x)` is a declaration or a
check depending on prior state. It stays deferred unless Phase 3 is built
and needs the slot, or field reports ask for the two-sided diagnostics.
