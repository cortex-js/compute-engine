# Inference Roadmap — Collection Elements and Placeholder Refinement

_Drafted 2026-08-18, immediately after the bare-type synonym ruling shipped
(bare `list` ≡ `list<unknown>`; `any` strictly above `unknown` — see the
"Bare collection constructors: RULED AND IMPLEMENTED 2026-08-17" entry in
`ROADMAP.md` and `doc/08-guide-types.md` §"`unknown` vs `any`, and What a
Bare Type Means"). Status: **design roadmap — nothing below is implemented.**_

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

Probed 2026-08-18 on the post-synonym-ruling tree. Element types flow **out**
of collections (synthesis and extraction) but never **in** (inference):

| # | Program | Today | Under this roadmap |
|---|---|---|---|
| 1 | `f: (list<number>) -> number`; `f([a, b])` with undeclared `a`, `b` | `a`, `b` stay `unknown` — the constraint dies at the literal's boundary | `a`, `b` infer `number` (Phase 2) |
| 2 | `xs` undeclared; `xs[1] + 1` | `xs` narrows to `dictionary<any> \| indexed_collection<any>` — element slot stays `any`, the numeric evidence is computed and discarded | element refines: `… \| indexed_collection<number>`-shaped (Phase 3) |
| 3 | `(v) => v[1] + 1` | `(v: dictionary<any> \| indexed_collection<any>) -> broadcastable<number>` — the result type PROVES the engine derived the numeric flow, and never wrote it back | element-typed param (falls out of Phase 3) |
| 4 | `ys` undeclared; `Sum(ys)` | `ys` stays `unknown` (union parameter ⇒ no inference write at all) | at least `collection<any> \| number` whole-type evidence (Phase 2 decision) |
| 5 | `a: list` (declared); `a = [1, 2, 3]` | `a`'s type stays `list` — the whole declared type is frozen, element slot included | element slot refines from the value (Phase 1) |

What already works and must not regress:

- **Synthesis**: a literal's type is computed from its elements
  (`[1,2,3]` → `vector<finite_integer^3>`); assignment to an undeclared
  symbol copies it, and re-assignment re-infers freely.
- **Extraction (forward)**: generic signatures bind `T` from the operand —
  `xs: list<integer>` makes `xs[1]` an `integer`.
- **Whole-type argument narrowing**: an `unknown`-typed symbol at a typed
  parameter narrows to the parameter type, including through user-function
  forwarding (`narrowArgsFromInferredSignature`, `boxed-expression/box.ts`).

## 3. Phase 1 — assignment-driven placeholder refinement of constructor arguments

**Feature:** a declared type whose constructor argument is the placeholder
(`unknown`, including the bare synonyms `list`/`set`/`dictionary`/
`collection`/`indexed_collection`) refines that argument per-position from an
assigned value's type. The constructor itself stays a contract: `a: list`
still refuses `a = 42`.

**Mechanism** (all pieces have signature-slot precedents):

1. A structural sibling of `refineDeclaredPlaceholders` that walks
   constructor arguments instead of signature slots: declared
   `list<unknown>` + value `vector<finite_integer^3>` ⇒ adopt the element
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

**Confinement rule (hard):** only placeholder spellings participate.
`list<integer>` must NOT refine to `list<finite_integer>` — a stated element
type is a contract, and eroding it is the failure mode this design must
prove it avoids. Likewise `list<any>` never refines: `any` is the contract
spelling by definition.

### Open rulings Phase 1 needs (with recommendations)

- **R1 — Does refinement re-revise?** After `a: list` and `a = [1,2,3]`
  (element refined to `finite_integer`), does `a = ["x"]` fail
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
  `list<finite_integer>` (element only, rank and length stay open) or the
  value's full `vector<finite_integer^3>`? _Recommendation: element only._
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

## 4. Phase 2 — downward distribution into literals

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

## 5. Phase 3 — use-driven reverse propagation (the hard one)

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

**Why Phase 3 is worth its risk:** the payoff concentrates in three places —
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

1. **Phase 1** after R1–R3 are ruled — self-contained, completes the
   placeholder-ruling symmetry, immediately makes `let a: list` behave per
   the stated intent.
2. **Phase 2** next — small, makes `f([a,b])` behave like `f(a)` already
   does; settle the union-parameter question in the same change.
3. **Phase 3** as its own design round with a written plan
   (`docs/plans/…`), the participation list, the guess-semantics ruling,
   and route-parity tests — the binder-mechanism treatment.
