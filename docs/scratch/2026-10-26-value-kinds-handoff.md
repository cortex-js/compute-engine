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

## Rules for every agent

- NEVER run `git stash`, `git checkout`, `git restore`, `git reset`, or any
  git command that modifies the tree or index; never `git add` in the
  worktree. If the tree looks wrong, stop and report.
- Jest: `npx jest --config ./config/jest.config.cjs -w 2 -- <one file>` or
  `-w 4 -- <several files>`, run with `cwd` the worktree; never the full
  suite (it needs the box lock, which the coordinator takes).
- Typecheck: `npm run typecheck` in the worktree.
