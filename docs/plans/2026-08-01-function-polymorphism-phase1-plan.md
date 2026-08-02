# Function polymorphism — Phase 1 implementation plan

Status: draft plan (2026-08-01). Spec authority:
`docs/plans/2026-08-01-function-polymorphism-design.md` (v2, D1–D8 all
ruled). Phase 0 (value membership + lattice fix) landed in `60eb9ff0`.

## Scope

Engine-side multi-clause functions, **box/programmatic routes only**:
`DefineFunction` head (D6), clause storage on the operator definition
(§4.2), accumulation with parameter-domain identity and the effect-row
state machine (§4.3, D5), and the tri-state runtime selector with the
backstop assert (§4.4, D7, D8).

**Not in Phase 1** (per spec §7): Cortex surface (literal parameters,
statement lowering to `DefineFunction`, `About` clause listing — Phase 2);
compile (Phase 3); generic clauses (gated on the type-variables phases, D4
— a polytype clause is rejected with that spec's D7 diagnostic).

## Step 0 — Precondition gate

The minted-constructor work (nominal §4.5b, other session) must be
**committed** before starting: both modify the `assignFn` /
definition-replacement seams, and `DefineFunction` must reuse its guards.
Verify at kickoff: `type-constructors.ts` committed;
`nominal-assign.test.ts` + `constructor-functions.test.ts` green at HEAD.

## Step 1 — `DefineFunction` operator (D6)

`["DefineFunction", name(symbol), functionLiteral]` in `library/core.ts`,
modeled on `Assign`'s definition (adjacent code, ~`core.ts:1339`):

- `lazy: true` **with a canonical handler** — a lazy operator with no
  canonical handler is inert on the box route (established trap); the
  canonical handler canonicalizes the literal operand (value-safe
  `.canonical`), holds the name symbol raw, and performs the knot-tying
  pre-declaration `Assign`'s canonicalization does (self-recursive bodies).
- Signature `(symbol, function) scope -> nothing`; evaluates to `Nothing`.
- Evaluate delegates to a new `defineFunctionClause()` (step 3).
- Registration/accumulation happens at **evaluate**, not canonicalization
  (unlike `DeclareType`: later *statements* seeing the definition is a
  Phase 2 concern; the box route evaluates eagerly anyway). Revisit in
  Phase 2 if Cortex static diagnostics need canonical-time registration.
- Follow the `add-operator` skill checklist (definition, type handler,
  tests; no LaTeX entries — MathJSON/box surface only in Phase 1).

`Assign` is untouched: it keeps full-replace semantics everywhere,
including `f := (x) -> x*2` onto a multi-clause `f` (spec §4.3; test).

## Step 2 — Clause storage (§4.2)

Home: the **operator-definition slot** — confirmed correct by recon: an
assigned function literal already becomes an operator def whose
`evaluate` IS the literal (`assignValueAsOperatorDef`,
`engine-declarations.ts:1132`, stored as `_lambdaLiteral` on
`_BoxedOperatorDefinition`).

- `_BoxedOperatorDefinition` gains
  `clauses?: { signature: FunctionSignature; literal: Expression }[]`
  (undefined = single-clause = today's representation, zero behavior
  change until a second clause arrives).
- On the second clause: convert the existing def — from the operator route
  (literal in `_lambdaLiteral`) or from the value-slot route (a literal
  held as a VALUE under a declared signature, the §6.3 reconciliation
  path) — into a 2-clause list. Preserve per clause: the derived
  signature (via the same annotated/untyped split
  `assignValueAsOperatorDef` performs), the literal with its captured
  scope, and description/metadata from the first definition.
- The def's stored `signature` becomes the **intersection of clause
  signatures**, built **structurally** (Type construction, never
  string-template reparse — the resolver-blind lesson), with the
  symbol-level effect row stamped on every arm (D5). This is a new
  signature-rebuild site: it must preserve the effects adjunct now and the
  `typeParams` adjunct when generics land (spec D4.3).
- Static machinery then works unchanged: `validateArguments` and result
  typing already consume intersection signatures via `overloadArms` /
  `resolveOverload` (`validate.ts:591`, `boxed-function.ts:3178`).

## Step 3 — Accumulation (`defineFunctionClause`, §4.3)

New function in `engine-declarations.ts`, sharing `assignFn`'s guards:

1. **Constructor guards first**: extract `assignFn`'s D13
   recognition/minted-constructor logic into a helper both routes call.
   `DefineFunction` on a minted-constructor name or a same-scope
   nominal-typed name = deterministic collision error (spec §4.7) — it
   never accumulates onto a minted operator, and (v1) never installs a
   second constructor clause.
2. **Builtin shadowing**: a `DefineFunction` whose target resolves to a
   system-scope builtin shadows it in the current scope (same rule as the
   bare-assign-clobbers-builtin fix — scope-identity check, all routes).
3. **Clause identity** (replace vs append): parameter domain only —
   arity structure (required/optional/variadic shape) + parameter types
   compared by mutual subtyping. **Excludes result type and effect row**
   (a body edit changing the inferred result must still replace).
   Replacement preserves list position.
4. **Effect-row state machine** (D5): symbol-level state
   `unestablished | established(row)`.
   - Explicit specifier: establishes (re-stamping all clause signatures
     and the intersection), or must equal the established row →
     `incompatible-clause-effects` error otherwise.
   - No specifier: adopts the symbol's row (asserts nothing).
   - Unestablished: row = join of body-inferred effects (upper bound).
   - Inferred effects exceeding an established row → same error.
   - Replacing/removing the establishing clause does not un-establish.
5. Rebuild the intersection signature + refresh the definition version
   (`updateDef` semantics) so cached types/bindings re-derive.

Error surface: host route throws (a typed error, matching the
`TypeCompatibilityError` channel-split convention); the operator route
surfaces an `Error` **value** (`invalid-clause-definition` /
`incompatible-clause-effects` codes) — mirror the existing
declared-type-rejection split in `core.ts`'s Assign handlers.

## Step 4 — Tri-state admission (§4.4, shared)

Extend `value-membership.ts` (or a sibling `admission.ts`) with
`admissionOf(op, param): 'admit' | 'refute' | 'undecidable'`:

- **admit** — concrete value passing `typeAcceptsValue`, or static type a
  subtype of a non-value-component parameter (the existing gates).
- **refute** — concrete value failing membership on a value-component
  parameter, or static type provably disjoint. TRAP (pinned memory): use
  the **disjointness** predicate for refutation — `couldMatch` answers
  "could be" and `!isDisjointFrom` is NOT the same thing; only provable
  disjointness refutes.
- **undecidable** — everything else (symbolic operand vs value param,
  partial shape).

One implementation, both consumers (the parallel-route lesson from the
07-25 round: shared code, not a hand-mirrored copy):

- **Static**: `resolveOverload` keeps most-specific-wins over statically
  *admitted* arms, but result typing changes for value-arm sets — when no
  unique winner is statically admitted, the call's result type is the
  **JOIN of all non-refuted arms** (spec §4.4). Wire at
  `boxed-function.ts:3178`'s consumer. Inference keeps the ratified
  per-position JOIN over non-refuted arms. All write-free.
- **Runtime**: step 5.

## Step 5 — Runtime selector

Seam: `_BoxedOperatorDefinition.evaluate` (~`:834`), where a
single-clause def applies `_lambdaLiteral` today. For a clause-list def:

1. Operands arrive **already evaluated once** by the normal eager
   evaluation (the def is not lazy) — this satisfies the evaluate-once
   obligation; assert it with an effectful-argument test, not by re-
   evaluating.
2. Arity filter (refute), per D8: **no partial application** for
   multi-clause — an unsaturated call is a no-match, never a curry.
   Single-clause defs keep today's `makeLambda` currying.
3. Compute `admissionOf` per clause/position; clause admission =
   all-admit / any-refute / else undecidable.
4. **Blocking rule**: if any undecidable clause is more specific than or
   incomparable with the best admitted clause → return `undefined`
   (inert, stays symbolic). Reuse (export) the specificity comparator
   from `overload.ts` — do not duplicate the ordering.
5. Otherwise apply the most specific admitted clause (declaration order
   breaks ties) via its cached `makeLambda`.
6. All clauses refuted with fully-concrete operands →
   `["Error", "'no-matching-clause'", <application>]` (D7 — error value,
   never a throw, mirroring `match-no-case`).
7. **Backstop assert** (spec §4.4): a call that passed static validation
   must have ≥1 non-refuted clause at runtime — `console.assert` +
   regression test.

Recursion: no special handling — each recursive application re-enters the
selector (and the Match closure-staleness fix already guarantees fresh
frames; its test class applies here too).

## Tests — `test/compute-engine/define-function.test.ts`

The §9 obligations minus Phase-2/3 rows; every behavior probed via BOTH
`ce.box(['DefineFunction', …])` raw MathJSON and pre-boxed
`ce.function(…)` (route parity; parse route deferred to Phase 2 with a
note):

- The §1 fib: `f(0)=1; f(1)=1; f(n: integer)=f(n-1)+f(n-2)`; `f(10)` =
  55 (value-arm dispatch + recursion), repeated calls with different
  arguments on one engine (the Match-bug test class).
- Idempotence: re-running an identical clause replaces in place (position
  preserved — tie-break order stable); an edited body whose *inferred
  result type changes* still replaces, not appends.
- Replace-vs-accumulate: `Assign` after `DefineFunction` discards the
  clause list; `DefineFunction` accumulates.
- Symbolic: `f(n)` stays inert while the value clause is undecidable —
  including the blocking case (general clause admitted, literal clause
  undecidable → NOT dispatched); assigning `n` later dispatches
  correctly.
- Static/runtime coherence: differing per-arm result types → JOIN when
  undecidable, exact arm type at a literal call site; backstop assert.
- No-match: direct literal miss, miss revealed only after evaluation,
  unsaturated arity (D8) — all `no-matching-clause` error values.
- Effects (D5): conflict rejection, omission-adopts-row in both
  declaration orders, inferred-effect overflow, row survival across
  replacement; evaluate-once with an effectful argument (exactly one
  side effect per call).
- Guards: `DefineFunction` on a minted constructor name errors; on a
  builtin name shadows in-scope.
- Test hygiene: UPPERCASE symbols for boolean contexts; save/restore
  `BigDecimal.precision` if any test changes precision.

## Verification battery

`npm run typecheck` + native `tsc -p tsconfig.json --noEmit`;
`npx madge --circular --extensions ts src/compute-engine` (new import
edges: core.ts → engine-declarations helper, operator-definition →
admission — watch for cycles; break with the established patterns);
targeted suites (define-function, overload-resolution, value-membership,
nominal-assign, constructor-functions, typed-function-literals,
cortex/declare-type); full suite for snapshot blast radius (expected:
zero — Phase 1 adds a new head and changes behavior only for defs with
≥2 clauses, which cannot exist in the current corpus).

## Risks / open coordination

- **`assignFn` is still moving** (constructor session). The
  guard-extraction in step 3.1 must happen against its final committed
  shape — do not start step 3 before step 0's gate passes.
- Result-typing JOIN (step 4) touches `boxed-function.ts` result
  inference for existing single-definition overload sets **only when arms
  contain value components** — gate the new path on `hasValueComponent`
  so declared overload sets like `Random`'s are byte-identical.
- The selector adds per-call admission cost for multi-clause defs only;
  single-clause defs keep the exact current path (no regression risk on
  the hot path — assert with the box-microloop canary if in doubt).

## Suggested execution order

Steps 1–2 (operator + storage; independent of the moving seam) → step 0
gate → step 3 (accumulation, sharing the committed ctor guards) → step 4
(admission) → step 5 (selector) → tests throughout, battery at close.
Steps 1+2 and 4 are parallelizable (different files) if dispatched to
subagents; 3 and 5 are sequential after them.
