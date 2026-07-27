# Step 5 — A Sanctioned Binder Mechanism

**Status**: DESIGN — 2026-07-26, not yet implemented, not yet ratified.
Produced by an Opus design agent against clean tree `0da66698`; step 4
(widening `rebindParameters` to named parameters) is assumed DONE. This is
phase 3 of the symbol-identity repair; the problem inventory and all
prior-phase record live in
`docs/plans/2026-07-24-defining-scope-dereference-design.md` (§The recurring
defect, §Sequencing step 5).

## Rulings record (2026-07-26, user)

1. **`_isShield` narrowing (stage 14): APPROVED** (see §4; R2 process applies
   — pin first).
2. **Eval-context push cost: APPROVED with amendment** — be ready to address
   a measured perf impact, and before reaching for `binderScopeOnly`, try a
   **finer-grain invalidation heuristic on pop**: a pop of a scope whose
   bindings were never written (no assign, no assumption — a pristine binder
   frame) should not bump the global generation. That mitigation also pays
   down the cost `Sum`/`Product`/`Block` already carry today. Precedent: the
   two-axis generations of the element-memo work (Tycho item 38).
3. **Activations are indistinguishable (`_activationOf`): APPROVED.**
4. **Shape A: leaning approved, AMENDED** — do not add a second field; since
   `bindingSites` implies a scope, **unify it into `scoped`**:
   `scoped?: boolean | BindingSiteSelector`. `scoped: true` remains for
   declaration-scopes with no syntactic bound variables (`Block`, and
   `HoldValues` whose bound set is dynamic — the Shape-B helper residue);
   `scoped: <selector>` declares a binder. Absent/false = no scope. This
   makes the inconsistent state (sites without a scope) unrepresentable,
   keeps `grep 'scoped:'` a complete scope inventory, is backward-compatible
   for existing definitions, and turns the `scoped: true` residue list into
   the audit of scope-only operators. Consequence: the quantifiers — today
   `scoped: true` with an empty scope — must move to a selector as part of
   their stage, which the unified type makes visible.

## Implementation record — stages 0–4 (2026-07-26, staged)

All five stages landed and measured individually: baseline 19,270 passed /
4182 snapshots → final **19,278 passed (+8 new pins) / 4182/4182 unchanged**,
typecheck + madge clean. New modules: `binding-sites.ts` (selectors + path
helpers), `binding-tombstone.ts` (Tier-1 debug invariant); the hook =
`canonicalizeBinder`/`bindBindingSites` in `box.ts`, wrapping the extracted
`applyOperatorDefinition`. Adopters: Series (`operandSites(1)`),
NDSolveFunction (`limitsIndexSites(2)`), Sum/Product
(`indexingSetSites(1,'integer')`), Loop/Comprehension — the two hand-rolled
prologues in `canonicalBigop`/`canonicalLoopLike` are deleted.

What implementation added to the design, all load-bearing:

- **Two hook amendments**: the post-phase DECLARES a site name absent from the
  scope (reshaping handlers and default variables — `Series(f)` — reveal
  sites only in 'post'), and it REBUILDS whenever `result.localScope !==
  scope`, not only when an operand moved (a handler using bare `ce._fn` never
  attaches the scope, and `boundVariableNames` reads `localScope.bindings`).
- **Open-expression binders escape their own frame.** `Series`' expansion is
  OPEN in the bound variable, so the result left the node's new scope
  referencing a dying binding (12 failures). Fixed with
  `rebindEscapingCurrentScope` (`utils.ts`) in the evaluate handler. **Budget
  the same repair for `Integrate` (stage 5) and `Limit` (stage 7)**;
  Sum/Product/Loop are closed over their index and immune. §Escaping results'
  "inventory is incomplete" confirmed again.
- **The redeclare signature** (memorize for stages 5–14): a second
  `ce.declare` of a pre-declared index THROWS, `box.ts` swallows it into
  `console.error` + a NON-canonical expression, and the operator silently
  stops evaluating — polluting unrelated suites via shared engines. Stage 3
  hit this via `canonicalIndexingSet`'s `Element` branch (the one
  index-declaring branch without a `bindings.has()` guard; now guarded).
- **Spread-overrides carry the selector**: `{...def.operator, evaluate}` must
  survive `update()` — `'bindingSites'` is in `OPERATOR_DEF_KEYS` and
  `setScoped` honors a spread-carried selector.
- **Tombstone revive-on-push is required** (debug-gated, in
  `pushEvalContext`): a big-op scope is popped after canonicalization and
  re-pushed on every evaluation; without revive the flag fires on every
  `Sum`. `inScope`'s no-dispose asymmetry untouched.
- **Series micro-timing**: steady-state delta < 0.5% (≈0.255 ms/iter both
  ways) — the §1.5 push-cost risk did NOT materialize for Series;
  `binderScopeOnly` unused so far.
- **Deviation from §1.6 naming**: no `isScoped` alias — the boxed definition
  keeps `scoped: boolean` (public API) and exposes the selector as
  `bindingSites`.
- **Latent, found not fixed**: a bare `Loop(body)` (no iterator clauses) now
  canonicalizes its body inside a pushed-then-discarded binder scope; a
  `Declare` in such a body lands in the discarded scope. Fix (skip the
  pre-phase push when 'pre' yields no sites) interacts with `Series(f)`'s
  default-variable path — needs its own stage if pursued.

### Review round (2026-07-26, dual-reviewer, 5 findings, all fixed)

- **Clause visibility** (HIGH, verified by probe): the hook's up-front
  declaration broke "later clauses see earlier bindings" for
  `Comprehension`/`Loop`/big-ops. Fix: `BindingSite.clauseLocal` (stamped by
  `indexingSetSites`/`limitsIndexSites`) — pre-phase declares only the FIRST
  clause's index (the handlers' own ordered walks declare the rest), and
  post-phase step 6 rewrites operand *m* only with names visible from ≤ *m*
  (the body, before the first clause, sees all). Selector signatures
  unchanged; one additive optional field.
- **Bare `Loop` transient scope** (HIGH, was the "latent" note above): no
  'pre' sites ⇒ no scope push. `Series(f)`'s post-only default variable still
  works (pinned).
- **Selectors now re-exported from the public entry** (`src/compute-engine.ts`)
  and the CHANGELOG shows the real import path.
- **Tombstone**: the `canonicalizeBinder` pop is "dormant" (not tombstoned) —
  it is never terminal; the assert message also no longer blames
  `rebindEscaping` unconditionally. The post-EVALUATION pop still tombstones,
  so a between-frames window remains; message covers it.
- **`shield`** documented as reserved for stage 14.

7 new pins; final 19,285 passed / snapshots 4182/4182 / typecheck + madge
clean. Two pre-existing issues flagged, NOT fixed: the flat form
`ce.box(['Sum', body, 'n', 1, 'M'])` declares the symbolic BOUND `M` as an
index (predates this work, `canonicalIndexingSet` declares any bare-symbol
operand); and the `ce.function` route for `Comprehension` does not materialize
at canonicalization while `ce.box` does (route asymmetry, `isSame`/`evaluate`
agree).

### Stages 5–8 round (2026-07-26, staged: 5 and 8; blocked: 6; falsified: 7)

- **Stage 5 (Integrate) LANDED — defect row VALIDATED**: the route-agreement
  pin failed on the unmodified tree exactly as predicted (`ce.function` route
  carried the caller's binding; parse/box routes raw). `scoped:
  indexingSetSites(1)` + the open-expression escape repair
  (`rebindEscapingCurrentScope`), which was REQUIRED (7 failures without it —
  the same two suites as step 4's D1 class). Zero snapshot movement, as
  declared beforehand.
- **Stage 8 (quantifiers) LANDED — shadowing defect CONFIRMED then fixed**:
  before migration, with `x := 5`, `\forall x, x > 4` evaluated to `True`
  (the bound occurrence resolved the global's value); round-trip and route
  agreement already passed (both raw). Now `scoped: limitsIndexSites(0)` on
  all five; `ForAll(x, x > 4)` stays symbolic; `evaluateExists` unchanged.
  Results are closed booleans — no escape repair needed.
- **Stage 6 (D) BLOCKED on a design call, reverted intact.** The defect is
  real and the migration works (value shield fine, NO double-shielding), but
  post-phase step 6 rebinds a PRE-BOXED receiver's body (`ce.box(['D',
  ce.parse('x^2'), 'x'])`), so `explain('D').initial.op1` stops being
  `isSame` a free-standing `ce.parse('x^2')` — 3 `explain.test.ts` failures,
  one a stored snapshot. This is the mechanism working as specified (the
  landed `Sum` behaves identically), so the options are: accept + update the
  expectations/snapshot, add a per-operator step-6 opt-out, or defer D behind
  stage 10. Analysis recorded in `binder-mechanism.test.ts`.
- **Stage 7 (Limit) — defect row FALSIFIED, nothing landed.** All three
  handler paths already produce the identical
  `Limit(Function(Block(body), x), point[, dir])` shape and all four routes
  `isSame`. A `lambdaParamSites(0)` attempt bound the variable a SECOND time
  (the node's scope on top of the literal's) — the two-live-bindings state
  the mechanism exists to eliminate. Limit's variable is a `Function` literal
  parameter: **stage 10's territory**. Three uniformity pins added.
- **Re-ordering consequence: stage 10 now gates stages 6 and 7.** Stage 9
  (Solve)'s risk profile updated: closed results ⇒ escape repair likely
  irrelevant; the body-identity/explain class (stage 6's blocker) is its real
  hazard.
- Found, not fixed: `Limit(Function(1/(x-a), x), a, 1)` evaluates to
  `1/(a-a)` and the literal's Block scope contains BOTH `a` and `x`
  (pre-existing capture of the limit point; `calculus.ts:1717`); `\nexists`
  does not parse (`NotExists` unreachable from LaTeX).

### Stages 6+10 round (2026-07-26, staged)

- **Stage 6 (D) LANDED — and the granted explain-snapshot authorization went
  UNUSED.** The 3 `explain.test.ts` deltas were not "accepted behavior" after
  all: `explain('D')` lifts the differentiand out of the node and builds
  around it in the ambient scope — the SEVENTH escaping-lift sighting, at a
  site not in the inventory. One `rebindEscaping(f, canonical.localScope)` in
  `symbolic/explain-derivative.ts` (the same repair as `liftIntegrand` and the
  Jacobian lift) and the explain suite passes byte-identical. The underlying
  semantic (a pre-boxed `D` receiver's body `x` is the binder's variable, not
  `isSame` a free-standing parse) still stands and is now pinned for BOTH
  `Sum` and `D` by `valueDefinition` identity. `operandsFrom(first, type?)`
  variadic selector added and re-exported. Escape repair on the evaluate
  result required, as predicted. No double-shielding.
- **Stage 10 (Function parameters) LANDED.** `rebindParameters` and the hook's
  step 6 are ONE shared walk, `rebindToBindings` (`binders.ts`), and
  `bindParameterOperands` gives literals the step-5 discipline: the parameter
  OPERAND and the body occurrences now share one definition (pinned by
  identity across all three routes and through `Typed`). The two-bindings pin
  did NOT hold before: the operand was raw on parse/box and CALLER-bound on
  `ce.function`.
- **Trap found by the convergence: `ce.symbol(name)` inside a scope does not
  always return that scope's binding** — for a name owned by a library
  constant (`Function(Pi+1, Pi)`) it returns the CONSTANT, so a naive
  "compare against the replacement's definition" rewrites correct body
  occurrences into the constant. The shared walk takes the SCOPE as the
  authority. `box.ts`'s step-5 loop has the same latent hazard
  (`sym.valueDefinition === binding.valueDefinition`) — unexercised (no
  migrated binder has a constant-named variable), unpinned, left.
- **Stage 7 FINAL: `Limit` migrates NEVER.** Measured post-stage-10: four
  routes `isSame`, no node scope, the literal's Block is the sole binder and
  its parameter operand is identical to the Block's binding; shadowing
  correct. `lambdaParamSites(0)` would still create the second binding.
- **For stage 11**: the parameter operand is now a SECOND live reference to
  the static binding (`hideBodyScopeParams` deletes that binding during a
  call; nothing reads the operand's definition during application today, so
  inert) — `_activationOf` must account for it. `bindingKeyedSubs`' three-way
  search remains the thing to collapse.
- Persisting, untouched: `Limit(Function(1/(x-a),x), a, 1)` → `1/(a-a)`
  (calculus.ts:1717).
- **Review round on this stage (dual-reviewer, 2 findings, both fixed): the
  constant-hazard deferral is RETIRED.** Confirmed repro: `Function(π+1, Pi)`
  on the `ce.function` route applied to 10 gave `1 + π` (parse route: 11).
  Root cause at three sites (`rebindParameters`' map, `bindParameterOperands`'
  decline, box.ts step 5): `ce.symbol(name)` short-circuits to the interned
  constant before consulting the scope chain. Fix: `ce._bindingSymbol(name,
  scope)` (engine-expression-entrypoints.ts; the engine route adds zero
  module edges — `binders.ts` cannot construct a `BoxedSymbol`). NOTE:
  `rebindEscaping` deliberately still uses `ce.symbol` — an ESCAPING
  occurrence re-points at the enclosing binding, and for `Pi` the constant IS
  the enclosing binding (that is why `D(Pi², Pi)` evaluates with real π).
  Constant-named parameters now bind like any other, pinned by identity on
  all three routes for both `Function` and `D`.

### Stage 11 round (2026-07-26, staged: A and B and C-half; falsified: the
`hideBodyScopeParams` narrowing)

Baseline measured fresh at `e5efead5`: 19,312 passed / **4182/4182**
snapshots / exit 0. Final: **19,317 passed (+5 pins) / 4182/4182 / exit 0**,
typecheck + whole-src tsc + madge clean.

- **Milestone A (`_activationOf` + the `sameBinding` hop) — the zero-diff claim
  HELD**, measured not assumed: full suite byte-identical to baseline.
  `sameBindingDef` (`binders.ts`) is the one hop, used by `sameBinding`,
  `bindingKeyedSubs` and `evaluateInOwnBindings`.
- **The static binding must be read from the PARAMETER OPERAND, not from
  `bodyScope.bindings`** — the §Stages 6+10 warning, and it bites immediately:
  an enclosing activation of the same literal has already hidden the body's
  binding (`hideBodyScopeParams`), so from the second frame of a RECURSIVE call
  the scope no longer answers and every frame came back unlinked. The operand
  reference (stage 10) is what makes recursion work here at all.
- **Milestone B (collapse `bindingKeyedSubs`' three-candidate search) — zero
  diff.** The ambiguity guard survives, and is now the ONLY thing the two sides
  of an activation are distinguished for: `!ambiguous || def === binding`.
  Note the guard cannot be expressed without that distinction, so activations
  are indistinguishable to EQUALITY, not to this one consumer.
  Control experiment: with `markActivation` neutralized, the two new structural
  pins fail while `functions`/`collections`/`scope`/`lambda-capture` still
  pass — the collapse is behavior-preserving *because of* the link, but the
  corpus does not independently exercise the freshScope-side candidate.
- **KNOWN LIMITATION (the pre-boxed-raw `Apply` double-apply): NOT resolved,
  and structurally out of reach of this stage.** Recorded in the 2026-07-24 doc
  as "owned by phase 2's makeLambda-frame work" — measured here: the doubling
  comes from the RAW-NAME fallback, and a raw symbol carries NO binding, so no
  amount of binding identity separates "raw `w` from the held BODY" (must
  substitute — the held-conditional pin) from "raw `w` from the ARGUMENT" (must
  not). It needs provenance, not identity. Now PINNED as characterization in
  `functions.test.ts`, together with the two canonical routes that are correct.
- **Milestone C, half landed.** The `evaluateInOwnBindings` reachability check
  is now identity-or-activation-of and restriction 1 is left doing only its own
  job (refusing definitions from already-popped scopes); zero diff, as §4
  predicted.
  **The `hideBodyScopeParams` narrowing is FALSIFIED — reverted, and §2.1's
  claim that it "loses its first reason to exist" is wrong.** The two reasons
  are not the same kind of thing: the parameter clause is consumed by NAME
  LOOKUP (a nested `Block`/`Sum` inside the body resolves up through
  `bodyScope` before reaching `freshScope`), and activation records say nothing
  about name lookup. Dropping it leaves an ANNOTATED parameter — declared
  `inferred: false`, so not covered by the second clause — valueless-but-visible
  in `bodyScope`. One failure, unambiguous and attributed by reverting alone:
  `test/cortex/execute.test.ts › recursion with a typed param still works`
  (`f(n: integer) = if n <= 1 { 1 } else { n * f(n-1) }` → `NaN`). The reasoning
  is now recorded at the function.
- **Stage 12's question, measured while in the file: the pipe topic `_1` needs
  nothing.** On both the `ce.box` and `ce.function` routes the wrapped literal's
  parameter operand, its `Block` binding and the body occurrence are ONE
  definition — stage 10's widening of `rebindParameters`/`bindParameterOperands`
  to named parameters already covers the placeholder, so `Pipe` needs no
  `bindingSites` selector for identity. (Route `isSame` still disagrees for
  `Pipe`, but for the ordinary lazy-operator reason — held operands are raw on
  `ce.box` and canonical on `ce.function` — not for a binding reason.)
- Found, not fixed: with a global `_1` declared *with a value*,
  `[1,2,3] |> Map(_1, k ↦ k²)` returns an unevaluated `Map` instead of
  `[1,4,9]`; the literal's binding is still correct, so this is a resolution
  question, not a binding one. Pathological input, unpinned.

### Stage-11 review round (2026-07-26, dual-reviewer; 1 refuted, 1 fixed, 1 @fixme)

- **REFUTED with instrumentation**: "activations can link to the wrong static
  binding via hand-built `Function` nodes". The Integrate-built literal's
  parameter operand is RAW (`canonicalLimits` passes the index through
  uncanonicalized), so `staticParameterBinding`'s operand branch never fires
  there; a full-suite instrumented run found **0** cases where operand and
  body-scope definitions both exist and disagree. Preference order is
  unobservable today; guarded by a forward-invariant pin
  (`binder-mechanism.test.ts` › hand-built literal activates its own Block
  binding) instead of a no-op patch.
- **FIXED**: a valued global `_1` derailed `x |> Map(_1, …)` — `Map`'s
  `checkCollectionOperand` rejected the bound value and the canonical handler
  returned null. Fix: `canonicalWithFreshPlaceholders` (`function-utils.ts`)
  — Pipe canonicalizes its held RHS with mentioned placeholders pre-declared
  as fresh valueless locals in a throwaway `noAutoDeclare` scope.
  `_pushShadowedParameters` could NOT express this: its untyped branch
  deliberately REUSES an existing non-constant binding (the valued global is
  exactly that), and its typed branch auto-declares into the very scope the
  global lives in. Side effect: the no-global path no longer leaks an
  auto-declared `_1` into the caller's scope (zero churn).
- **@fixme**: the pre-boxed raw double-apply characterization now carries the
  repo's known-wrong marker + the correct output (`['Hold','w']`); needs
  argument provenance (raw-name-fallback work), not identity.
- Adjacent, recorded not fixed: `bindingKeyedSubs`' second
  `staticParameterBinding` call (`function-utils.ts:1371`) runs AFTER
  `hideBodyScopeParams`; for a hand-built literal both candidates are then
  `undefined` and the substitution entry keys on `undefined`. Surfaced in no
  test; worth a look when the raw-name fallback is next opened.

**One correction up front, because two documents propagated it**: CONTRACT 4
does *not* live in `test/compute-engine/scope.test.ts`. It is
`test/compute-engine/pipeline-contracts.test.ts:513–612`,
`describe('CONTRACT 4: re-binding of a cached boxed expression')`; the
guarantee this design must not break is the case at line 548, `'cached boxed
(in parent scope) sees a nested-scope shadow of k'`. (The 2026-07-24 doc has
been corrected.)

---

## 0. What the mechanism has to be, stated from the evidence

Reading the five defect sites plus the systematic inventory, every binder in
the engine answers three questions, and today each site answers them
separately and inconsistently:

1. **Which operand is my bound variable?** — answered by name (`rubi`), by
   string (`RubiDriver.int`), by position in a `Limits` operand
   (`nDSolveFunction`), by a fixed operand index (`Series`), or by
   canonicalization order (pipe).
2. **In which scope does it get its binding?** — answered by
   `ce.declare(…, bigOpScope)` (`canonicalBigop`), by "leave it RAW and let
   nobody bind it" (`Series`, `nDSolveFunction`), by "whatever the caller
   had" (`Integrate`'s `Limits` index), or by two bindings at once
   (`makeLambda`).
3. **How do the equality walk and the rewrite walks learn about it?** — only
   through `boundVariableNames` (`src/compute-engine/boxed-expression/binders.ts:30`),
   which knows exactly two things: a node's `localScope.bindings`, and a
   `Function` literal's parameter list.

Question 3 is the load-bearing one and is what selects the design. `Series`,
`NDSolveFunction` and `Integrate`'s `Limits` index are **not** `scoped: true`,
carry no `localScope`, and are not `Function` literals — so
`boundVariableNames` returns `NO_BINDERS` for them. Concretely today:

- `rewriteWithBinders`'s `shadowed` set never contains `Series`' expansion
  variable, so `bindingKeyedSubs`' raw-name fallback (`function-utils.ts:789`)
  will happily substitute into it: an occurrence with
  `def === undefined && sym.symbol === name && !shadowed.has(name)` is
  rewritten. `Series`' `x` is raw *by deliberate convention* and therefore
  matches all three conditions.
- The same raw operand is, by the equality contract, a transitivity bridge.
  The 2026-07-24 doc's §The equality contract says in as many words: *"a raw
  expression must not be used as a dedup key."* The current binder convention
  ("keep the variable RAW / mint the binding in its own scope",
  `calculus.ts:1816-1822`, `differential-equation-utils.ts:503-509`)
  deliberately puts raw operands inside canonical expressions. It fixed the
  round-trip; it did not make the variable *bound*.

So the mechanism must produce, for every binder, a **real binding in a real
scope attached to the node**, because that is the only channel
`boundVariableNames` — and therefore `same()`, `rebindEscaping`,
`rebindParameters`, `bindingKeyedSubs`, and `evaluateInOwnBindings` — can
read. "Keep it raw" is a workaround to be retired, not a convention to be
generalized.

---

## 1. The mechanism

### 1.1 Two API shapes, evaluated

**Shape A — a declaration in the operator definition.** A new optional field
alongside `scoped`, naming *which operands are binding sites*:

```ts
// types-definitions.ts, in OperatorDefinitionFlags (next to `lazy` / `scoped`)
bindingSites?: BindingSiteSelector;
```

**Shape B — an imperative helper the canonical handler calls.** E.g.
`bindBoundVariable(ce, scope, rawSymbol)` returning the bound symbol, invoked
by each handler where it currently improvises.

| | Shape A (declaration) | Shape B (helper) |
|:--|:--|:--|
| single authority | yes — the definition record is the authority; the handler cannot forget without the declaration disagreeing | no — a handler that forgets to call it is exactly today's failure mode, one test failure at a time |
| auditability | `grep 'bindingSites:' src/compute-engine/library/` enumerates every binder; a startup assertion can require it for `scoped: true` ops | none; the inventory stays tribal knowledge |
| visible to the walkers | yes, and *for free*: the declaration is consumed at canonicalization and **materialized as a `localScope`**, which `boundVariableNames` already reads | only if the helper also mints a scope — i.e. Shape B is Shape A minus the audit |
| handles reshaping handlers (`Limit`'s `To`-form, `D`'s `{x,n}`, `Solve`'s spec splat) | needs a two-phase application (§1.3) | trivially — the handler knows the final shape |
| hot-path cost | zero (see §1.4/§1.6) | zero |

**Recommendation: Shape A, with the selector expressed as a function returning
*paths* (data), and a small library of prebuilt selectors.** Shape B survives
as an escape hatch for the one binder whose sites are not syntactic
(`HoldValues`, which binds "the assigned free symbols of its body" — a set
computed at evaluate time).

The reason to prefer A is not aesthetics. It is that the declaration, unlike a
helper call, can be consulted by the *framework* to do the rewriting
generically — which is the entire content of "the binding site is the single
place that decides the scope". If the handler does the rewriting, five
handlers will keep doing it five ways.

### 1.2 Concrete shape

New leaf module `src/compute-engine/boxed-expression/binding-sites.ts`:

```ts
/** A located binding site: the path (operand-index chain) from the operator
 *  node to the symbol that is this operator's bound variable, and the type to
 *  declare it with. */
export type BindingSite = {
  path: readonly number[];      // e.g. [1] for Series, [2, 0] for NDSolveFunction's Limits index
  type?: TypeString;            // 'integer' for a big-op index, undefined ⇒ 'unknown'
  shield?: boolean;             // declare valueless even if the enclosing scope has a value (see §4)
};

/** Locate this operator's binding sites in `ops`.
 *  `phase: 'pre'` runs on the RAW operands before the canonical handler; it
 *  may return fewer sites than 'post' (return nothing rather than guess).
 *  `phase: 'post'` runs on the handler's RESULT operands and is authoritative. */
export type BindingSiteSelector = (
  ops: ReadonlyArray<Expression>,
  phase: 'pre' | 'post'
) => readonly BindingSite[];
```

with prebuilt selectors exported from the same module, so definition records
stay declarative-looking:

```ts
export function operandSites(...indices: number[]): BindingSiteSelector;
/** The first element of each `Limits|Element|Tuple|Triple|Pair|Single|Set|Hold`
 *  operand from `first` onward — the shape `canonicalIndexingSet` /
 *  `canonicalLimits` already recognize. */
export function indexingSetSites(first: number, type?: TypeString): BindingSiteSelector;
/** The parameter list of a `Function` literal operand (unwrapping `Typed`). */
export function lambdaParamSites(op: number): BindingSiteSelector;
/** Bare-symbol or `Element(sym, …)` specs from `first` onward (Solve). */
export function specSites(first: number): BindingSiteSelector;
```

Library definitions then read:

```ts
Series:           { lazy: true, bindingSites: operandSites(1), … }
NDSolveFunction:  { lazy: true, bindingSites: (ops, p) => limitsIndexAt(ops, 2), … }
Sum / Product:    { lazy: true, scoped: true, bindingSites: indexingSetSites(1, 'integer'), … }
Integrate:        { lazy: true, bindingSites: indexingSetSites(1), … }
D:                { lazy: true, scoped: true, bindingSites: operandsFrom(1), … }
Limit:            { lazy: true, bindingSites: lambdaParamSites(0), … }
Function literal: (not a definition-driven path — see §2 stage 10)
```

### 1.3 The framework hook: where it runs

One place, `makeCanonicalFunction` in
`src/compute-engine/boxed-expression/box.ts` (the
`scope ??= opDef.scoped ? {…} : undefined` block at line ~774 is the natural
anchor — every route funnels through it). Two phases, because a canonical
handler both *needs* the variable declared before it canonicalizes the body
and *may reshape* the operands:

**Pre-phase** (before `opDef.canonical(xs, { engine, scope })`):

1. If `opDef.bindingSites` is present and `scope` is undefined, mint one
   (`{ parent: ce.context.lexicalScope, bindings: new Map() }`) — a
   declaration implies a scope; `scoped: true` becomes redundant for declared
   binders but is kept for `Block`, whose scope holds *declarations*, not
   bound variables.
2. `scope.noAutoDeclare = true`, `ce.pushScope(scope)`.
3. For each site returned by `bindingSites(xs, 'pre')`: read the symbol name;
   `ce.declare(name, type ?? 'unknown', scope)` if not already present.
4. Call the handler; `finally` pop and clear `noAutoDeclare`.

Steps 1–4 are verbatim what `canonicalBigop` (`library/utils.ts:1518-1575`)
and `canonicalLoopLike` (`library/control-structures.ts:783-830`) each
hand-roll today. Sharing them is the first, entirely mechanical, win.

**Post-phase** (on the handler's result, or on the default `BoxedFunction`
when there is no handler):

5. For each site returned by `bindingSites(result.ops, 'post')`: replace the
   symbol at `path` with `ce._inScope(scope, () => ce.symbol(name))` — a
   symbol bound to *this node's* binding — unless it already is that binding.
6. Rebind occurrences of those names inside the node's *other* operands to
   the same binding, using `rewriteWithBinders(…, skipRootBinds = true)`
   scoped to the declared names. This is `rebindParameters`
   (`function-utils.ts:385`) generalized from `Function` parameters to
   arbitrary binders; step 4 is the proof that the walk is safe for named
   variables.
7. Rebuild with `{ form: 'canonical', scope }` if anything changed.

Step 5 is what makes the three routes agree, and step 6 is what closes
"canonicalizing an already-canonical body is a no-op" for operator binders —
the narrower symptom recorded at the end of §The recurring defect.

### 1.4 Migration story: the three routes

All three go through `makeCanonicalFunction`; what differs is what the
binding-site operand looks like on arrival.

| route | what arrives at the binding site | after the mechanism |
|:--|:--|:--|
| **parse** → MathJSON → `ce.box(json)` | for a lazy operator, `ce.expr(x, {form:'raw'})` (`box.ts:781`) ⇒ a symbol with **no definition** | rebound to the node's own binding by post-step 5 |
| **`ce.function('Series', [f, ce.symbol('x')])`** | `box.ts:486` returns an already-boxed expression through `canonicalForm` unchanged ⇒ the symbol carries the **caller's** binding | same — the caller's binding is discarded at the binding site (and *only* at the binding site) |
| **`ce.box(['Sum', …])`** for a non-lazy scoped op | operands canonicalized inside the pushed scope ⇒ already correct | idempotent no-op |

The consequence worth stating loudly: **the no-definition rule in
`sameBinding` (`compare.ts` `isBoundHere`, `if (def === undefined) return
true;`) exists precisely because these routes disagreed.** After migration it
is no longer needed *for migrated binders*. It is still needed for rule
patterns and for `Hold` over a pre-boxed raw symbol (pinned in
`equal.test.ts`), so it must **not** be deleted — but its comment should stop
citing `\sum_{k=1}^n` as the motivating case, because that case will no longer
produce a raw binding-site symbol. Deleting it is a separate, later, measured
question.

### 1.5 The cost question, and the one real risk

Attaching a `localScope` to `Series`/`Integrate`/`NDSolveFunction` is not
free: `BoxedFunction._computeValue` treats `this._localScope !== undefined` as
"scoped" and does `engine._pushEvalContext(this._localScope!)` per evaluate
(`boxed-function.ts:1771-1774`, and `:2058-2108` for the async path). Each
matching pop runs `discardEvalContext`, which does `ce._generation += 1` —
invalidating every generation-keyed cache (`BoxedFunction.sgn`/`.type`).
Making three more operators push a frame per evaluation is a **measurable
behavior and performance change**, and it is the single largest risk in this
design.

Size unknown — measure, don't guess. Two mitigations, in order:

- **Preferred**: accept the push. It is semantically *more* correct — the
  bound variable should be in scope during evaluation — and it is the
  prerequisite for retiring the ad-hoc shields (§4). Measure per operator,
  per stage.
- **Fallback if a stage regresses**: add a separate field `_binderScope` on
  `BoxedFunction`, read by `boundVariableNames` and `localScope`'s *equality*
  consumers but **not** by `_computeValue`. This gets the identity fix with
  zero evaluation change, at the cost of keeping that operator's shield ad
  hoc. Name it explicitly in the definition (`binderScopeOnly: true`) so the
  opt-out is visible rather than emergent.

### 1.6 Circular-dependency budget

`binding-sites.ts` is a **leaf**, same tier as `binders.ts`. It may import:
`./type-guards.js`, `./function-literal.js`, `./binders.js`, and type-only
from `../global-types.js` / `../../common/type/types.js`. It may **not**
import `./utils.ts` (which imports `binders.ts`), `./box.ts`, or anything in
`library/`.

Imported by: `box.ts` (the hook), `boxed-operator-definition.ts` (add
`'bindingSites'` to `OPERATOR_DEF_KEYS` and a field, mirroring `scoped`), and
the library modules. **Not** imported by `binders.ts` or `compare.ts` — and it
does not need to be, because the declaration is consumed at canonicalization
and materialized as a `localScope`. That is the load-bearing property for the
hot path: `same()`'s `boundVariableBindings` keeps reading
`expr.localScope?.bindings` and never evaluates a selector. `npm run
check:deps` (madge) must stay clean, type-only included.

---

## 2. Migration plan

Ordered so each stage lands alone, runs the full suite, and shows **4179/4179
snapshots unchanged** before the next begins. Risk classes: **R0** refactor
with no intended behavior change; **R1** intended behavior change with an
existing pin; **R2** intended behavior change with no pin (write the pin
first); **R3** known-hostile (a prior measurement says it breaks).

| # | binder | current ad-hoc channel | risk | what pins it |
|--:|:--|:--|:--|:--|
| 0 | *(mechanism only, no adopters)* | — | R0 | full suite byte-identical |
| 0.5 | popScope debug invariant (§3) | — | R0 | debug-only; suite unchanged with flag off |
| 1 | **`Series`** | canonical handler forces `ce.symbol(x.symbol, {canonical:false})` — RAW (`calculus.ts:1816-1822`) | R1 | `series.test.ts › unevaluated Series round-trips` |
| 2 | **`NDSolveFunction`** | `nDSolveFunction` builds the parameter raw (`differential-equation-utils.ts:503-511`); the variable is read out of a `Limits` operand by position | R1 | the two `NDSolveFunction` tests that failed under *every* item-26 variant |
| 3 | **`Sum` / `Product`** | `canonicalBigop` + `canonicalIndexingSet` declare the index into `bigOpScope` by hand, with `noAutoDeclare` (`library/utils.ts:1400-1575`) | R0 | `serialization.test.ts` G7 block; big-op suite |
| 4 | **`Loop` / `Comprehension`** | `canonicalLoopLike` — an independent copy of the same prologue (`control-structures.ts:783-830`) | R0 | comprehension/loop suites |
| 5 | **`Integrate`** | the integrand's variable is owned by the `Function` literal, but the **`Limits` operand's index is not bound at all**: `canonicalLimits` (`library/utils.ts:1322+`) puts `ops[0]` into `ce._fn('Limits', …)` untouched, so it is raw on the parse route and caller-bound on the `ce.function` route — the `Series` defect, unfixed and unpinned | **R2** | *write first*: a test that `ce.function('Integrate', [f, ce.function('Limits',[ce.symbol('x'),0,1])])` `isSame` the parsed `\int_0^1 f\,dx` |
| 6 | **`D`** | `scoped: true` with a scope that is minted and then never populated; the variables are ops 1..n, bound wherever the caller had them; shielded at evaluate by `withValueShield` (`calculus.ts:800-806`) | R1 | `D` value-shield tests; ARCHITECTURE.md §Bound variables examples |
| 7 | **`Limit`** | the variable ends up inside the `Function` literal via `canonicalFunctionLiteralArguments`, but only on one of three code paths through the handler (`calculus.ts:1618-1678`) | R1 | `limit` suite; the `Limit(Function(1/(x-a),x), a, 1)` disambiguation |
| 8 | **quantifiers** (`ForAll`, `Exists`, `NotExists`, `ExistsUnique`, `NotForAll`) | `scoped: true`, `lazy: true`, **no canonical handler at all** (`logic.ts:159-205`) — the `localScope` is created and stays empty forever, and `evaluateExists` recovers the variable by `sym(condition) ?? sym(condition.op1)` (`logic.ts:393-394`). A sixth sighting of §The recurring defect, latent | **R2** | *write first*: quantifier round-trip + a shadowing test |
| 9 | **`Solve` unknowns** | `canonicalSolve` (`solve-domain.ts:137-222`) passes specs through; shielded at evaluate by `withValueShield` (`solve-domain.ts:618`) | **R3-ish** | `solve.test.ts › the unknown both has a value and is reintroduced by another binding`; interacts with `defaultUnknown` and `.unknowns` |
| 10 | **`Function` parameters** | `canonicalFunctionLiteralArguments` + `rebindParameters` (`function-utils.ts:253-436`); after step 4 the `/^_\d*$/` gate is gone | R1 | typed-literals suite; `functions.test.ts`; beta-reduction |
| 11 | **`makeLambda` call frames** (§2.1) | two live bindings at once: the body scope's (hidden by `hideBodyScopeParams`, `function-utils.ts:641`) and `freshScope`'s | **R3** | `bindingKeyedSubs`' three-way search (`function-utils.ts:1235-1250`), `Apply(w ↦ If(c,w,0), w+1)`, closure/counter-factory tests |
| 12 | **pipe desugaring `_1`** | `Pipe` is lazy and takes `.canonical` of its right operand before the literal exists (`core.ts:983-1000`); repaired by `rebindParameters`' anonymous-placeholder branch | R1 (after 10) | cortex `Map(_1, k↦k²)` doc block |
| 13 | **`rubi/match.ts` `case 'var'`** | `RubiDriver.int` takes the integration variable as a **string** and re-boxes it; `sameBoundName` (`rubi/match.ts:106-112`) compares by name as a carve-out | **R3** | `integration-rules` (6 failures historically, 366 `sameBinding` misses). Only attempt after #5 and #10; the win is that `int` can take the bound symbol and `sameBoundName` can revert to `sameBinding` |
| 14 | shield marker + dereference restriction 2 (§4) | `withValueShield` / `simplifyValueBlind` valueless shadows | **R2** | `solve.test.ts`, `hold-values`, `symbol-value-scoping.test.ts` |
| — | **`HoldValues`** | binds the assigned free symbols of its body, computed dynamically | — | **stays on Shape B** (the helper). Its sites are not syntactic; declare that explicitly rather than inventing a dynamic selector |
| — | `Minimize`/`Maximize` | listed as binders in ARCHITECTURE.md; **no definition exists in `src/compute-engine/library/`** | — | nothing to migrate; fix the doc |

Stages 1–8 are independent of one another; 9–13 are ordered. Stage 0.5
deliberately lands early because it makes every later stage cheaper to debug.

### 2.1 `makeLambda`, and a position on recursion

The open question (2026-07-24 doc §Open questions, "Recursion") is *whether
one binder with several simultaneous activations needs distinguishing*.

**Position: NO. Activations must be indistinguishable, and the current design
already assumes it without saying so.**

The argument is not aesthetic. `sameBinding` compares a **bound** occurrence
by NAME (`compare.ts`: *"Both bound, names already equal: each denotes its own
side's binder"*). Any occurrence enclosed by the binder is therefore already
activation-blind. Distinguishing activations would only change the answer for
occurrences that have *escaped* the frame — and an escaped occurrence must be
re-bound (`rebindEscaping`), not distinguished. Distinguishing them would also
be the first construct in the engine whose identity is dynamic rather than
lexical, which the "canon scope IS the runtime frame" model does not have a
place for.

The concrete proposal, and how it discharges the `makeLambda` row of §The
recurring defect:

- `_BoxedValueDefinition` gains one internal field,
  `_activationOf?: BoxedValueDefinition` — the *static* binding this per-call
  definition is an activation of.
- `makeLambda`'s `ce.declare(paramNames[i], { value, … }, freshScope)`
  (`function-utils.ts:1118-1139`, and the currying path at `:1019-1038`)
  routes through a shared helper that sets `_activationOf` to the body
  scope's binding for that parameter.
- `sameBinding` gains one hop: two definitions are the same binding if
  `ad === bd` **or** they resolve to the same static binding through
  `_activationOf` (one level, non-recursive). This does **not** make equality
  rename-invariant — the names must still match, `isBoundHere` is unchanged,
  and `BoxedFunction.hash` stays name-keyed and correct.
- Newly-equal pairs are exactly: (static parameter binding, its activation)
  and (activation, activation of the same binder). A stored value's free `x`
  (a global definition) and a frame's `x` remain unequal — the capture this
  whole repair exists to prevent is untouched.
- Payoff: `bindingKeyedSubs`' three-candidate search (hidden binding / live
  body binding / freshScope binding, `function-utils.ts:1235-1250`) collapses
  to one question; the "two live bindings at once" row of §The recurring
  defect stops being true; and `hideBodyScopeParams` loses its *first* reason
  to exist (it keeps its second — hiding inferred valueless bookkeeping
  bindings — so it does not disappear, it narrows).
- Recursion falls out: N nested activations are N definitions all pointing at
  one static binding, all mutually equal, each restored on unwind. Nothing to
  distinguish.

This is R3 and lands last among the `Function` work. If it regresses, stages
1–10 stand without it.

---

## 3. The `popScope` debug invariant

The Lean antecedent is "the binder constructor is the single authority for its
variable"; the operational half is *"no live result references a binding of
the dying scope"*, turning the next missing `rebindEscaping` site into an
assertion with a stack.

**The honest problem first**: `popScope` cannot see "live results". The engine
holds no registry of boxed expressions, and building one (a `WeakRef` set of
every construction) is unaffordable and would also flag genuinely-dead
intermediates. Worse, the invariant is not literally true: an escaping
**closure** legitimately references the frame's bindings — `captureClosures`
(`function-utils.ts:705`) re-parents rather than rebinds, and the scope object
survives the pop through the closure. So the invariant to implement is:

> No expression *returned from* a frame references a binding of that frame,
> except through a `Function` literal whose scope chain reaches the frame.

Two tiers, both gated on one flag.

**Gating.** A module-level `ce._debugBindings` boolean, defaulted from
`process.env.CE_DEBUG_BINDINGS` and settable programmatically. Not
`ce.strict` (that is a user-facing semantic mode). Not test-only-by-file,
because the point is that a *product* debugging session can turn it on. Tests
opt in via a dedicated CI lane, not via the default jest setup.

### Tier 1 — dispose tombstone + use-site assertion (cheap)

`discardEvalContext` (`engine-scope.ts:75-104`) already walks exactly the
right set (the value defs it disposes). In debug mode, stamp before
disposing: `binding.value._deadStack = new Error().stack;
binding.value._deadScope = context.name`. The **check** goes at *resolution*
sites, not at the `valueDefinition` getter (hot path — must stay a plain
field read):

- `BoxedSymbol.evaluate()` / `_dereference`,
- `BoxedSymbol._N`,
- the visitor in `evaluateInOwnBindings` (`binders.ts`, where
  `sym.valueDefinition` is already read).

Throwing an `Error` whose message carries *both* stacks (the pop, and the
use) is the "assertion with a stack" the 2026-07-24 doc asks for.

**Cost when off**: one boolean test per scope pop, zero on the hot path
(assign the fields as `undefined` in the constructor for V8 shape stability).

**Interaction with `discardEvalContext`** — three points, all load-bearing:

1. The tombstone rides the *existing* dispose loop, so it inherits exactly
   the right set for free. No second traversal.
2. It **pins the `evaluateInOwnBindings` withdrawal invariant.** That
   function borrows the caller's definitions into a temporary scope and
   withdraws them before the pop precisely because `discardEvalContext`
   would otherwise dispose them. If a future edit breaks the withdrawal, the
   borrowed definition gets tombstoned and the caller's *next* use of that
   symbol throws with both stacks — instead of the current failure mode, a
   dynamic constant silently going stale after a precision change.
3. `inScope` (`engine-scope.ts:106-128`) pops **without**
   `discardEvalContext` — deliberately, it is a temporary context switch, not
   a scope lifetime. It must not tombstone. This asymmetry already exists and
   the debug code must respect it, not "fix" it.

### Tier 2 — result scan at the frame boundary (the literal invariant)

Define "live result" operationally as **the value the frame returns**, and
introduce one wrapper:

```ts
// engine-scope.ts
export function withFrame<T>(ce, scope: Scope, name: string, fn: () => T): T;
```

which pushes, runs, pops, and — in debug mode only — walks the returned value
if it is an `Expression`, throwing on any symbol whose `valueDefinition` is a
binding of `scope`, skipping (a) names shadowed by a binder inside the result
and (b) `Function` literal subtrees whose `localScope` chain reaches `scope`.

Call sites to convert (this doubles as the audit of `rebindEscaping`'s
admittedly-incomplete inventory): `makeLambda` ×3 (`function-utils.ts:885`,
`:1053`, `:1154`) · `withValueShield` (`utils.ts:1003`) · `simplifyValueBlind`
(`simplify.ts:215`) · `evaluateInOwnBindings` (`binders.ts:273`) ·
`canonicalBigop` (`library/utils.ts:1546`) · `canonicalLoopLike`
(`control-structures.ts:806`) · `BoxedFunction._computeValue`/
`_computeValueAsync` (`boxed-function.ts:1774`, `:2077`) · `solve.ts` ×3
(`:1729`, `:2183`, `:2517`) · `rules.ts` · `constraint-subject.ts` ·
`base-compiler.ts`.

Implement the walk **once**, as
`escapedBindings(expr, scope): readonly string[]` in `binders.ts`, and
refactor `rebindEscaping` (`utils.ts:1050`) to use it — `rebindEscaping` *is*
this walk with a rewrite where the assertion has a throw. One definition of
"escaping", two consumers. The assertion is placed *after* the rebind at the
three known sites, so they stay green and only new sites fire.

**Expected cost**: O(result size) per frame, debug-only; on a lambda-heavy
suite plausibly 2–5× wall-clock (unmeasured — do not budget on the guess).
Recommendation: Tier 1 in the default debug flag; Tier 2 behind a second
level (`CE_DEBUG_BINDINGS=2`) run in a nightly lane, not on every PR.

---

## 4. Dereference un-confinement

The two restrictions in the 2026-07-24 doc's §The dereference rule,
implemented at `binders.ts:243-262`.

### Restriction 1 (the occurrence's definition must be reachable) — **keep it, but delete its exception**

Its stated reason is `hideBodyScopeParams`: a call frame parks the parameter's
value in a *fresh* definition and hides the body's own, so a body occurrence's
definition is unreachable **by design**. With §2.1's activation records that
reason dissolves — the frame's definition is an activation of the body's
binding, so the reachability walk's identity check becomes
`sameBindingDef(found.value, own)` (identity **or** activation-of) and finds
it.

But restriction 1 is doing a *second*, unrelated job: it refuses to re-point a
free symbol at a definition that is not in the current chain **at all** — i.e.
a definition from an already-popped scope. That job is still needed and is
the reason the whole thing does not resurrect dead bindings. So restriction 1
stays; what goes away is the `hideBodyScopeParams` carve-out that made it look
conditional. **Measurable change: none intended.** Land as R0 with the
activation work.

### Restriction 2 (the shadowing binding must hold a VALUE) — **replace the blanket rule with a targeted one**

The restriction as written is a **blanket** rule — *any* valueless shadow
beats the occurrence's own binding. What becomes unnecessary is the blanket;
what remains necessary is the shield.

Proposal:

- `_BoxedValueDefinition` gains `_isShield?: true`, set by `withValueShield`
  (`utils.ts:1007-1016`) and `simplifyValueBlind` (`simplify.ts:219-228`) on
  each shadow they declare. Those two cover **every** shield in the engine:
  `D`, `Integrate`, `Limit`, `JacobianMatrix` and `Solve` all route through
  `withValueShield` (`solve-domain.ts:618`), and `.simplify()` routes through
  `simplifyValueBlind`. The bare `ce.declare(uName, 'real')` calls inside
  `solve.ts` are *substitution* variables (`u`, `_x`), not shields of a
  valued symbol, and must **not** get the marker.
- `binders.ts` changes from *"if the shadow has no value, defer to the
  ambient lookup"* to *"if the shadow is a shield, defer to the ambient
  lookup"*.

**Measurable behavior change**: a stored value's free symbol now resolves its
own binding *through* a valueless non-shield shadow. Observable exactly when
an outer binding has a value **and** an inner valueless shadow of the same
name exists and is not a shield — e.g. an inner `Declare(x, 'real')` in a
`Block`, or a valueless `Function` parameter binding.

*(Ordering matters — probed 2026-07-26: `a` must be assigned while `x` is
still valueless, or eager capture bakes the number in and there is no free
symbol left to intercept. The example as originally drafted here had
`x := 100` first and was inert.)*

```
a := x + 1;   // x valueless: a stores x+1, bound to the GLOBAL x
x := 100;
a + 5                                       // → 106
Block(Declare(x, 'real'), a + 5)            // today → x + 6; after → 106
```

Today the block's valueless `x` intercepts and the answer stays symbolic in
`x`; after the change the stored value resolves its own `x` and gets `106`.
That is the correct reading of the ratified eager-capture semantics
(`doc/06-guide-augmenting.md`, "When Is the Value Captured?"): `a` captured
the *binding*, the inner `Declare` created a *different variable*, and the
different variable has no business intercepting.

The asymmetry that clinches it (probed 2026-07-26): give the block's shadow a
VALUE — `Block(Declare(x,'real'), Assign(x,7), a+5)` — and it does **not**
intercept: the result is `106` today, not `13`. So the current rule cannot be
read as "inner declarations capture"; a valued inner `x` already doesn't. The
valueless case behaves differently ONLY because valueless-shadowing is the
shield idiom, and dereference cannot currently tell a shield from an ordinary
declaration. `_isShield` makes that distinction explicit instead of inferred.

**RULING 2026-07-26: approved by the user.** Stage 14's semantic change (the
`_isShield` narrowing, `Block(Declare(x,'real'), a+5)` → `106`) is ratified;
the R2 process still applies — write the pin first.

**R2 — write the pin first**, as a new case in
`test/compute-engine/symbol-value-scoping.test.ts`, before touching
`binders.ts`.

### Which shields still need the carve-out vs. an explicit value-blind mode

- **Now (stage 14)**: the `_isShield` marker *is* the carve-out, made
  explicit instead of inferred from "has no value". Minimal, one field, no
  new evaluation mode.
- **Later (out of scope, recorded)**: once §1's mechanism binds
  `D`/`Integrate`/`Limit`/`Solve`'s variables in their **own** scope, the
  shield becomes structural — the bound variable is a *different variable*
  from the global, so there is nothing to shield. `withValueShield` would
  then be needed only for `HoldValues` (which shields symbols it does not
  bind syntactically) and for `.simplify()`'s documented wholesale
  value-blindness. That is the "explicit value-blind evaluation mode"
  (`EvaluateOptions.valueBlind` consumed by `BoxedSymbol.evaluate()`) — do
  **not** attempt it in step 5; it changes the evaluation contract of every
  operator and cannot be measured one binder at a time.

---

## 5. Risks and measurement plan

### Per-stage signature

Every stage: land one change, run the full suite, expect **exit 0, ~19,205
passed, 0 failed, snapshots 4179/4179 unchanged**. Stages 5, 8 and 14 change
*results*, so they may legitimately move snapshots — each must state the
expected count **before** the run.

| stage | expected signature |
|:--|:--|
| 0, 0.5, 3, 4 | zero diff — pure refactor. Any failure is a mechanism bug, not a binder bug |
| 1, 2 | zero diff; the raw-symbol convention is replaced by a real binding that must compare equal at every site the raw one did. If `series.test.ts` round-trip breaks, the post-phase rebind is wrong |
| 5, 8 | new pins pass; watch `integration-rules` and the quantifier suites for *newly*-distinguished symbols |
| 6, 7, 9 | the `withValueShield` sites now shield a variable already bound elsewhere — watch for double-shielding making a result *more* symbolic than before |
| 10, 11 | the whole `functions`/`collections`/typed-literals surface. Expect to bisect |
| 13 | binary: `integration-rules` is either green or 6 red |
| 14 | `solve.test.ts` and `hold-values` are the oracles |

**Isolated-passes is not evidence of a flake while another agent is editing
the tree.** Check `git status` and file mtimes against the run's start time
before recording any flake. Known flakes to re-run isolated:
`compile-performance`, `functions.test.ts` (async lane), `bug-fixes`,
`assumptions`, `deadline-regressions`, `latex-syntax/arithmetic` (EL-4),
Gamma bignum. Tell: the test name says *hangs*, *terminates*, *stays fast*,
or *polynomial time*.

### Contracts that could break, and how each fails

| contract | where | how this design could break it | guard |
|:--|:--|:--|:--|
| **CONTRACT 4** — a cached parent-scope expression DOES see a nested-scope shadow | `pipeline-contracts.test.ts:548` | it survives today because `BoxedSymbol.evaluate()`'s non-constant branch resolves by **name** (`engine._getSymbolValue(this._id)`), not through `def.value`. Nothing in this design touches that lookup — and nothing in this design may. The activation hop (§2.1) is in `sameBinding`, not in resolution | if a stage ever proposes changing `_getSymbolValue` to prefer `this._def`, that is the 100+-failure variant. Stop |
| **beta-reduction** `[[Function, x+1, x], 5]` | `functions.test.ts` | stage 10/11 — if the parameter's frame binding stops being reachable by name, or if `_activationOf` makes the argument's `x` compare equal to the parameter's | pin before stage 11; it is the canonical 100+-failure tripwire |
| **"patterns are syntax"** (Rubi) | `match.ts:158`, `match-dispatch.ts:476`, `integration-rules` | stage 13 by construction; also stage 5, which changes what the integration variable's binding *is* | do 5 and 10 first; use the `sameBinding` tracing recipe rather than bisecting |
| **`Hold`-over-raw-symbol transitivity** | `equal.test.ts › isSame: the canonical/raw boundary` | if §1.4's "no-definition rule no longer needed" is acted on prematurely. It is still needed | do not delete `isBoundHere`'s `def === undefined ⇒ bound` branch in step 5. Only update its comment |
| **root-scope / cross-engine constants** | `sameBinding`'s library carve-out (`compare.ts:99-105`) | a binding-site symbol sharing a name with a library constant (`Sum` over index `e` or `i`) now gets a real non-root binding | already handled by `_pushShadowedParameters` for lambda params; verify the same for operator binders in stage 3 |
| **`.json` round-trip / re-boxing** | `serialization.test.ts` G7 | serialization is name-only and re-boxing mints fresh bindings; bound occurrences compare by name, so this is safe *provided* the post-phase always produces a binding rather than sometimes leaving a raw symbol | any half-migrated site shows here first |

### DO-NOT-RETRY (restated so this design cannot be read as reopening them)

1. **The general occurrence-wins resolution rule** (`BoxedSymbol.evaluate()`
   preferring the occurrence's own definition over an inner same-named
   binding) — measured at **100+ failures**. Nothing in §4 does this:
   restriction 1 is kept, and §4 only changes *which shadows* may intercept a
   **stored value's** free symbols.
2. **The shared-canon-scope redesign of 2026-07-07**
   (`docs/plans/2026-07-07-block-scope-capture-investigation.md`). "Canon
   scope IS the runtime frame" stays true throughout, including §2.1.
3. **Rename-invariant / alpha-invariant comparison.** `sameBinding` still
   requires name equality everywhere; `BoxedFunction.hash` stays name-keyed.
   If a future stage wants SymPy's `dummy_eq`, it must make `hash`
   alpha-invariant in the same commit.
4. **Landing more than one change at a time.** Sixteen stages, sixteen
   full-suite runs.

### Open uncertainties (explicit)

- **The eval-context push cost of §1.5** — unmeasured; the `binderScopeOnly`
  fallback exists because at least one operator is expected to need it.
- **Whether `Solve` (stage 9) is migratable at all** — `defaultUnknown`,
  `.unknowns`, domain specs and the shield interact in untraced ways. Stage 9
  is exploratory; "Solve keeps its ad-hoc channel, documented as such" is an
  acceptable outcome.
- **Tier-2 debug cost** — order-of-magnitude guess only.
- **Selector as function vs. a path DSL** — function recommended because
  `Limit`, `D` and `Solve` all reshape their operands; a reviewer who finds a
  clean DSL should prefer it.
- **Whether the `Integrate` `Limits`-index defect (stage 5) is observable
  today** — the code path has the exact shape of the `Series` defect, but no
  failing case was constructed. Write the pin first; if it passes unchanged,
  something else is binding that symbol and the row is wrong.

### Critical files

`boxed-expression/binders.ts` · `boxed-expression/box.ts` ·
`function-utils.ts` · `engine-scope.ts` · `library/utils.ts`
