# Value kinds, phase 1: work plan and handoff

Session `compute-engine-df`, 2026-10-26. Plan:
`docs/plans/2026-10-26-value-kinds.md` (revision 7). Review record:
`docs/scratch/2026-10-26-value-kinds_SPEC_REVIEW.md` (the checklist of
settled details). ROADMAP CE-507.

Worktree: `/Users/arno/dev/wt-compute-engine-df` (detached at `7972b850c`,
`node_modules` linked). All edits and test runs happen there. Deliverable: a
diff applied onto the main tree as uncommitted changes, dual-reviewed, then
staged through the staging queue. Sessions never commit.

## Steps (each gated by `npm run typecheck` and the targeted tests)

1. **Foundation.** The field and its types (`arithmetic` on
   `OperatorDefinition`, plan 4.3 and 4.8), the kind registry
   (`boxed-expression/value-kinds.ts`: type part, dispatch part keyed by the
   bound definition, generation counter, the three per-engine gates), the
   declaration checks (4.1.2), the public `mint: false` and the subtype and
   disjointness rules for a nominal type defined as `value` (4.1.1), the
   type-funnel refusal for a registered kind type, checkpoint coverage
   (4.6). Tests: `test/compute-engine/value-kinds.test.ts`, section 1.
2. **Recognition.** The four residue predicates generalized to the kind set;
   the sites that read the `residue` primitive by name (4.6, the list);
   `CLASS_FACTS`/`CLASS_SYMBOLS` stamped with the generation; the three
   engine gates per kind type; the `simplify()` barrier scope (4.6); the
   canonical fold guards.
3. **Admission.** Group 1 by registry read (the generalized
   `admitsResidueClassOperand()`), group 3 with the carrier substitution,
   the type-only route (`derive-application-type.ts`), overload preference,
   lazy operators, functions with a body (4.2).
4. **Dispatch and typing.** `Add`/`Multiply` (4.4 steps 1–5), the binary
   operators, the comparisons (operators, methods, `.is()`, `Max`/`Min`,
   `Sort`, `Clamp`), apply sites (threadable and collection-parameter), the
   public methods through `residueArithmetic()`, result typing (4.5),
   `ResidueClass` onto the field, the nine signatures without `residue`.
5. **Compile.** The generalized decline; the contract wiring (4.8).
6. **Test kinds and acceptance.** `GF8`, `UserMeasurement`, the `MyMod`
   rows, every section-7 phase-1 test; the residue test files green.
7. **Documentation.** `doc/06-guide-augmenting.md` (gitignored `doc/`),
   `doc/08-guide-types.md`, `docs/TYPE-SYSTEM.md`, `CHANGELOG.md`,
   `ROADMAP.md` (CE-507 phase 1 done, CE-508 unchanged).

## Phase 2 (started 2026-10-26 after the phase-1 commit `0be912cef`)

The user decided to continue to phase 2 and to update #477 when all phases
are delivered. Order: (1) the inventory of plan section 8 (a probe script
`scripts/probe-value-kinds-inventory.ts` and
`docs/scratch/2026-10-26-value-kinds-phase2-inventory.md`); (2) a dual spec
review of the inventory as the phase-2 acceptance table; (3) the
implementation in a new worktree: the kind primitives `measurement` and
`quantity`, `Measurement` (`admittedAs: 'number'`, `compare` by nominal,
`apply` from the measurement helpers), `Quantity` (`'none'`, `compare`
after conversion, `resultType`, the `quantity` parameters), the removal of
the name-based branches, CE-508.1–.4 and .6 fixed, the snapshot blast
radius measured and reported.

Phase-2 state (2026-10-26): the inventory is written
(`scripts/probe-value-kinds-inventory.ts`, 1551 lines; the document, 1713
lines) and dual-reviewed (24 findings, `…phase2-inventory_SPEC_REVIEW.md`);
the user took the 16 recommendations ("All recommended"); the review's
amendments are plan section 13.1 (A1–A16). The six wrong values found are
CE-508.7–.9 and .11–.15 (CE-508.10 was withdrawn: the finer-unit tolerance
is a documented policy). No host type named `measurement` or `quantity`
exists in Tycho or the Epsil sources (grepped 2026-10-26). Worktree:
`/Users/arno/dev/wt-compute-engine-df2` at `140ad66f5`. Steps: P1a
(`Measurement` on the field: the primitive, the hooks, `compare` with
`'unordered'`, `eq`, `isExact`, the removal of the name-based arithmetic and
comparison branches, the admission gaps, the blast-radius measurement) →
P1b (the `apply` propagation rules of decisions 1–7 and A2–A5, A8, A11,
A13; the statistics sites; the step functions) → P2 (`Quantity`: the
primitive, `'none'`, the offset-temperature `add`, `compare` with the
finer-unit policy, `resultType`, the 24 trig heads and `Abs` naming
`quantity`, quantity collections, the refusals) → P3 (docs, CHANGELOG,
ROADMAP, the full suite, the dual review, staging).

LANDING NOTE for phase 2: `ROADMAP.md` is merged by hand (the worktree's
CE-507/CE-508 text from P3b, PLUS the main tree's CE-507.7, CE-507.8 and the
`mint: false` note added 2026-10-26 from the PR #482 review by session
compute-engine-0f; they are not in the worktree). `CHANGELOG.md`: take the
worktree's blocks only (prettier rewraps the whole file). `doc/` guides:
copy from the worktree. The plan file: the worktree copy is the main copy
plus P3b's section-6 edits; take the worktree's.

## Status

- Step 1: DONE in the worktree (11 files + `value-kinds.ts` + the test
  file; 38 suites green; madge clean). Registry API in `value-kinds.ts`.
  Left for later steps: the gate events on symbol declare/assign,
  `undeclare()` of a kind head (step 2), static pre-pass rollback of a
  registration (not reachable today: Epsil cannot declare hooks).
- Step 2: DONE (33 suites green, no snapshot change, madge clean).
  Recognition API: `holdsKindValue`, `holdsKindValueForCertain`,
  `isKindOperand`, `typeIsKindForCertain(t, engine)`,
  `signatureReturnsKind`, `kindTypesHeldBy`; `hasKindArm`/`withoutKindArms`
  in `common/type/utils.ts`; `RESIDUE_CLASS_ARITHMETIC` registered on
  `ResidueClass` (hooks not yet called). Group-1 admission at the arithmetic
  operators came with it (the `validate.ts` predicates). Known gaps for
  step 4: `residueResultType` still types `x + GF8(1)` as `residue`;
  `.is()` and `exactOperands()` still name `ResidueClass`; the simplify
  barrier at apply sites is a `TODO(step 4)`; the missing-operand memo in
  `boxed-operator-definition.ts` is keyed by the signature only.
- Step 3: DONE (148 suite runs green). New `kind-admission.ts` (groups 1
  and 3, carrier, overload preference, `isApplySite`, callback widening) and
  `apply-site.ts` (`applySiteOperands(expr)`, `isApplySiteCall(expr)`, memo
  by call keyed by generation and operand types). The eight signatures lost
  `residue` (also `src/math-json/OPERATORS.json`). `residueResultType` now
  answers the kind types of the operands (default of 4.5 only; the
  `resultType` hook is not read yet). Notes: group 1 is selected by the
  operator NAME (a user operator named `Add` in a local scope would get it);
  an engine built without `ResidueClass` no longer admits `residue` at
  `Add`; `nonNumericOperandError` exempts every kind type without the hook
  condition (boxing refuses first).
- Step 4a: DONE (142 suites green). New `kind-dispatch.ts`:
  `kindSumOrProduct()`, `kindOperation('negate'|'divide'|'power')`,
  `kindArithmetic()` for the methods; `residueResultType()` reads
  `resultType` (may return a type string); `Sum`/`Product`/`Reduce` typed
  through it. Choices: `.neg()` does not run the `negate` hook
  (canonicalization uses it; `Negate(c).evaluate()` does); the sub-sum drops
  an exact 0/1; a fold naming no operand throws; `Sum(K)` for
  `K: list<residue>` is `integer | residue` (an empty list sums to 0).
  Prettier reports three spots from steps 1–3 (fix before the review).
- Step 4b: DONE (257 suites green). New `kind-compare.ts` (`kindCompare`,
  `kindEqual`, `kindIs`; separate module to avoid a cycle through
  `compare.ts`); `kindApply()` in `kind-dispatch.ts`;
  `applySiteResultType()`/`namedKindResultType()` in `apply-site.ts`;
  `kindExtremumType()` for `Max`/`Min`/`Clamp`; test helpers
  `test/compute-engine/value-kinds-helpers.ts` (`declareGF8`,
  `declareMyMod`, `declareUserMeasurement`, `APPLY_CALLS`). Choices: `re`/`im`
  of a kind value stay `NaN` (typed `number`); the relational operators do
  not pass `written` to `compare`; after an enumeration the handler sees a
  `List` of the elements; `Max(U, 3)` is `integer<3..3> | umeasurement`.
  Prettier: 11 changed files still unformatted (run before the review).
- Step 5: DONE (364 suites green). New `compilation/kind-lowering.ts`;
  the decline and dispatch in `base-compiler.ts`; entry plans and raw result
  in `javascript-target.ts`/`javascript-runtime.ts`;
  `CompilationResult.valueKinds` and `StoredEntryPlan.kinds`. Choices: no
  `store()` exists, so `load()` refuses kind-compiled code; shippable only
  when every contract says `shippable: true`, lists no `hostNames`, and no
  input is a kind value (a non-empty `hostNames` makes the result not
  shippable: the pool cannot carry helpers — DESIGN DECISION owed); the
  representation check reads the `lowered()` name; `interval-js` declines a
  kind lowering (no kind entry check in its runner).
- Step 6: DONE (`value-kinds-acceptance.test.ts`; the audit table is in the
  agent report). Found four defects; all fixed in step 6b: `Ln`/`Log`
  refused a `'number'` kind; `Sum(k/k, k ∈ [c1, c2])` in a fresh engine
  folded the body before the gate opened (`bindIndexAuthoritatively()` now
  opens the declaration gate); evaluation rebound a kind value to the head
  of the current scope (`withCallableBinding()` at the fallback rebuild);
  a signature did not type a `Function` body (`kindTypedFunctionLiteral()`);
  plus `Exp(U)` admitted and CE-507.2 (group 1 keyed by the DEFINITION:
  `isLibraryKindOperator()`). Open items filed as CE-507.3 to CE-507.6.
- Step 7: DONE (guides, TYPE-SYSTEM, COMPILATION-MODEL, CHECKPOINT-MODEL,
  CHANGELOG, ROADMAP CE-507 with CE-507.1 decision).
- LANDED on the main tree 2026-10-26: the patch (53 files, `ROADMAP.md` and
  `CHANGELOG.md` merged by hand because of later edits there; prettier had
  rewrapped the whole worktree `CHANGELOG.md` and `OPERATORS.json`, both
  restored to HEAD plus the intended edits), 13 new files, the two `doc/`
  guides. Main: `npm run typecheck` green; 18 targeted suites green.
  Full suite in the worktree: 1577 passed, 1 failed (two Epsil doc examples
  pinned `complex | infinity | residue`; fixed in main, suite green), 4281
  snapshots, none changed.
- DUAL REVIEW of the 49 source files (Claude 9 findings, Codex 5; merged
  13: 3 high, 5 medium, 3 low, 2 nit; none needed a decision). All applied
  in six batches plus two follow-ups: exact operands preserved through the
  comparison dispatch under `.N()` (`kindPairOptions()`,
  `relational-operator.ts`; the near-tie exact rule for kind values in
  `kind-compare.ts`); kind registration journaled on the inference rollback
  frame in `declareSymbolOperator()`; a free symbol typed `k1 | k2` declines
  compilation (`multiKindSymbols()`); `broadcast`/`broadcastAsync` of a
  kind result throw, `willUsePool` false, the stored-code batch loader
  refuses kind code; the type-only route types carrier kinds at
  `Ln`/`Log`/`Exp` and shares the apply-site result typing
  (`kindApplySiteResultType()` in `derive-application-type.ts`); a bare
  operator name as a `Map` callback is widened by the carrier
  (`carrierCallbackType()`); per-engine gates `someKindAdmittedByCarrier()`
  and `someKindHasResultType()` in front of the apply-site checks and the
  value gate in front of the comparison paths; `Exp` admits a carrier kind
  only with a `power` hook; the written literal copy is built lazily;
  `removeBinding` copies the registry only for a kind head. Visible change
  from the review: the `incompatible-type` message of a callback over kind
  elements shows the widened type (`(complex | umeasurement) -> number`).

- Phase 2, step P3b (documentation): DONE in the worktree
  `/Users/arno/dev/wt-compute-engine-df2`: `CHANGELOG.md` (Behavior Changes,
  Features, Resolved Issues), `doc/06-guide-augmenting.md` ("Measurements and
  Quantities", `'unordered'`, `isExact`, `numericValue`, `tolerance`),
  `doc/08-guide-types.md`, `docs/TYPE-SYSTEM.md`, `docs/COMPILATION-MODEL.md`,
  ROADMAP (CE-507 phase 2 done, CE-507.9 to CE-507.11 filed, CE-508 removed),
  plan section 6, and the generated Epsil docs.

- Phase 2, full-suite fixes (coordinator, 2026-10-26): the first full run
  in the worktree had 15 failures in 7 suites, two causes, both fixed.
  (1) A parameter that names a kind type beside its numbers
  (`complex | quantity`, the 24 trigonometric heads and `Abs`) was no longer
  a numeric slot for the collection check: `Sin(list<string>)` boxed as
  valid. `validateThreadableOperand()` (`validate.ts`) and
  `signatureRefusesOperandType()` (`derive-application-type.ts`) now read
  the parameter without its kind arms (`withoutKindArms`) and admit the
  kinds it names as cells (`kindArmNames`). (2) `list-shape-typing.test.ts`
  expected the physics constants typed `value`; they are `quantity`
  (`[SpeedOfLight, PlanckConstant]` is `list<quantity^2>`, not a `vector`).
  A third defect found by the probe: the `resultType` answer of a
  parameter-named kind dropped the collection shape (`Sin(list<quantity>)`
  was typed `number`, `Abs(matrix<quantity^(2x2)>)` `quantity`).
  `namedKindResultTypeOverTypes()` now puts the answer in the cells of the
  operand's shape (`mapCells`), with the declared result beside it for a
  cell that may hold a value with no kind. Tests: `quantity-kind.test.ts`
  ("THE OPERATORS THAT NAME `quantity`", two new tests).

- Phase 2, dual code review on the main tree (2026-10-26, Claude Opus +
  Codex gpt-6.1-sol, 8 findings, 1 refuted). Applied: `Sin` of a quantity
  whose magnitude is a measurement keeps the uncertainty
  (`angularQuantityToRadians()` scales the measurement, `trigonometry.ts`);
  an explicit tolerance of `.is()` on a measurement is authoritative
  (`compareMeasurements()`); `Divide`/`Power` with a kind scalar and a list
  are typed `list<… ^2>`, not a nested list (`residueShapedResultType()`
  reads a numeric operand from its type alone); the descriptor route admits
  `Conjugate` (`'carrier'`) and `Exp2` (`'carrier-power'`) and types `Exp`,
  `Exp2`, `Lb`, `Lg`, `Log2`, `Log10` through their canonical head
  (`CANONICAL_HEAD_OF_KIND_CARRIER_CALL`, `derive-application-type.ts`); the
  kind rules of that route no longer wait for `someKindAdmittedByCarrier`
  (measured 7 µs per derivation in an engine with no kind value); a
  quantity `compare` answers `'unordered'` for a non-real magnitude and
  `quantityEq()` decides `Equal((1+i) m, 1 m)` (`hasLogarithmicUnit()` is
  now exported from `quantity-compare.ts`); the unreachable
  `kindValueIsNaN` check of `scalarExtremum()` is removed. Found and fixed on
  the way: `Lb`/`Lg`/`Log2`/`Log10` now run `Log`'s operand check (a residue
  class, a quantity, a string are refused at boxing). Refuted: an exact
  nominal through `Negate` under `Ceil(...).N()` (the probe gives `0`).
  Recorded in ROADMAP CE-507: the kind gates open after `.N()` of an
  integral, measured as no significant cost.

- Phase 2 COMMITTED by the user 2026-10-26 (`f29912a45`). Phase 3 decided
  2026-10-26 (plan 4.9.1, all recommendations; the design is 4.9.2:
  `Enclosure(lo, hi)`, kind primitive `enclosure`, `admittedAs: 'real'`, the
  hull across a pole, `NaN` for an empty image, exact endpoints under
  `evaluate()`, `interval-js` through a `native` compile field).

- CE-507.8 (decoded-payload cache) DONE in the worktree
  `/Users/arno/dev/wt-compute-engine-df4` (moved onto 0.170.0, `c60d9c80d`, after the release) (base `f29912a45`):
  `boxed-expression/decoded-payload.ts` (`decodedPayload(expr, decode)`,
  exported from the package entry `src/compute-engine.ts`), `units.ts`
  (`boxedToUnitExpression` cached at its top level; `decodedUnit(boxedUnit)`
  gives `{ unit, key, dimension, dimensionKey, scale }`), used by the quantity
  compare/add/divide hooks; `test/compute-engine/decoded-payload.test.ts`.
  Benchmark: no measurable change for quantities (a unit decode is 0.15 µs
  against 20–75 µs per evaluation); the cache is for costly payloads (PR
  #482's permutations, the enclosure endpoints). Phase 3 is built in the same
  worktree on top of it: one dual review, one staging. LANDING NOTE: add to
  `doc/06-guide-augmenting.md` (gitignored, main tree only) in the value-kinds
  section: "The hooks of a kind receive the kind value as a call of its head,
  so a hook that reads a costly payload reads it again at each operation.
  `decodedPayload(expr, decode)` runs `decode` once for each boxed expression
  and returns the stored result after that; boxed expressions are immutable,
  so the result never needs to be refreshed. Define `decode` once (at the top
  level of a module), not as a closure in the call:
  `const { lo, hi } = decodedPayload(x, decodeEnclosure)`."

## Rules for every agent

- NEVER run `git stash`, `git checkout`, `git restore`, `git reset`, or any
  git command that modifies the tree or index; never `git add` in the
  worktree. If the tree looks wrong, stop and report.
- Jest: `npx jest --config ./config/jest.config.cjs -w 2 -- <one file>` or
  `-w 4 -- <several files>`, run with `cwd` the worktree; never the full
  suite (it needs the box lock, which the coordinator takes).
- Typecheck: `npm run typecheck` in the worktree.
