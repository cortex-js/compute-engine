# Implementation Plan — Fungrim Phase 1: Corpus Loader (Value Tables + Real-Domain Identities)

**Scope:** docs/fungrim/FUNGRIM.md §5 Phase 1 — load the translated Fungrim corpus (`/Users/arno/dev/compute-engine/data/fungrim/`, 2,551 entries) into the Compute Engine as usable simplification rules and value tables, restricted to the slice `class ∈ {specific-value, identity}` × `guardLevel ∈ {none, real-simple}` (**707 entries**: 443 specific values + 260 real-simple identities + 4 unguarded identities), plus a small seeded solve-template set. Builds on the landed Track-2 mechanics (rule index in `src/compute-engine/boxed-expression/rule-index.ts`, the `operators` dispatch hint in `types-kernel-evaluation.ts`, `ce.solveRules`/`ce.harmonizationRules`) and the landed M3 purpose tags (`Rule.purpose?: 'simplify'|'transform'|'expand'`, `ce.rules(rules, {purpose})` default, `'expand'` skipped by `simplify()` but reachable via `replace()`).

**Completion gate per milestone:** `npm run typecheck` (zero new circular deps, no `any` in `types-*.ts`) + targeted jest suites via `npx jest --config ./config/jest.config.cjs --reporters default -- <path>`. No git commit steps in this plan.

---

## 1. Verified Current State

- **Corpus** (`data/fungrim/`): 2.8 MB pretty-printed across 57 topic files; the Phase-1 slice serializes to **~200 KB minified JSON** (measured: 707 entries, 201,211 bytes; expect ~30–45 KB gzipped). `data/fungrim/` is deliberately **not** in the npm package (`package.json` `files: ["/dist"]`; README.md defers runtime packaging to this phase).
- **Slice guard shapes** (measured over the 264 Phase-1 identities): `Element(v, Integers)` ×163, `Element(v, Interval(...))` ×63, `NonNegativeIntegers` ×59, `RealNumbers` ×44, `PositiveIntegers` ×38, `Range` ×11, `NotEqual` ×11, `SetMinus(S, Set(...))` ×10, `Primes` ×9, `Equal` ×8, `GreaterEqual/Greater/Less` ×9, `Divides` ×4, `NotElement` ×4, `Not` ×1. Interval bounds occasionally reference *other entry variables* (`Interval(Open(-y), Open(y))`). Everything except `Divides`/`NotElement`/`Not` (9 conjuncts total) compiles to existing tri-valued predicates (`isInteger`, `isReal`, `isGreater(other)`, `isEqual`, …) or to an evaluate-fallback.
- **Specific values:** 443 entries; LHS heads include 78 bare symbols (`GoldenRatio = …`, `CatalanConstant = …`), 9 `Set`, 8 `Apply` — **95 entries are not function-value rules** and need an exclusion/curation policy. The rest are `Head(literal args) = closed form` across ~30 heads (max per-head bucket ~30: CarlsonRJ 30, JacobiTheta 25, Digamma 23, …).
- **Head coverage:** the slice references 134 distinct heads, **81 of which are shells** from `declarations.json` (CarlsonR*, JacobiTheta, HurwitzZeta, DedekindEta, ModularJ, AGM, Hypergeometric2F1, …). ~105 entries touch the `COMPAT_OVERRIDES` heads (`scripts/fungrim/load.ts`: 2-arg LambertW/Digamma, complex Binomial/Fibonacci) whose *widened* signatures would destroy built-in evaluators if declared at runtime.
- **Engine surface:** `ce.rules()`, `ce.simplificationRules` push/replace with cache invalidation, `ce.solveRules`/`ce.harmonizationRules` (landed), `getRuleSet('standard-simplification')` boxes with `canonical: true`, 1.3× cost gate via `ce.costFunction`. `LibraryDefinition` carries **only** `SymbolDefinitions` — no rules hook.
- **Solve-shaped corpus content is thin in this slice:** the five `f(g(x)) = x` inverse compositions (Ln/Exp ×3, Tan/Arctan ×2) are all `complex-domain`; real-simple LambertW identities (`8654a3`: `W(x·eˣ) = x`, `30bd5b`: `W(x·ln x) = ln x`) exist. Solve content is genuinely Phase-2; Phase 1 ships the *mechanism* plus a hand-curated seed (§2.6).
- **Harness to promote:** `scripts/fungrim/load.ts` (corpus reading, `inferType`/`variableTypes`, shell declaration, COMPAT notes) and the Track-2 test assets (`rule-dispatch-regression.test.ts`, `rule-dispatch-corpus.ts`, `benchmarks/rule-dispatch.benchmark.test.ts`).

---

## 2. Design Decisions (the eight questions)

### 2.1 Packaging & API — subpath export + standalone loader function (recommended)

**Recommendation: a new subpath export `@cortex-js/compute-engine/fungrim`** (entry `src/fungrim.ts`, following the existing `./core`/`./compile` pattern in `package.json` `exports` and `scripts/build.sh`), exporting:

```ts
export function loadFungrim(ce: ComputeEngine, options?: FungrimLoadOptions): FungrimLoadReport;
export const FUNGRIM_CORE: FungrimRuleData;   // the compiled Phase-1 artifact (data module)
export type { FungrimLoadOptions, FungrimLoadReport, FungrimRuleData };
```

Rationale, weighed against the alternatives:

- **vs. a `fungrim` LibraryDefinition via the `libraries` constructor option:** `LibraryDefinition.definitions` only carries symbol definitions — rules have no hook, so a library alone cannot do the job without extending the library contract (an engine change with its own design debate). Worse, making `libraries: ['fungrim']` work *by string* requires registering the data in `STANDARD_LIBRARIES` inside the main bundle — putting ~200 KB into every browser bundle. Rejected for Phase 1; a thin `fungrimLibrary()` factory (declarations only) can be added later if the libraries contract gains an `onLoad` hook (open question Q6).
- **vs. fetched-at-runtime data:** forces async API, breaks offline/Node/SSR usage, adds a hosting dependency. Rejected.
- **vs. a separate npm package `@cortex-js/fungrim-data`:** cleanest size isolation, but adds a second publish pipeline, version-skew risk against pattern-canonicalization changes, and friction for the first release. **Deferred** — the subpath layout (loader code uses only the public `ComputeEngine`/`Expression` types, data is a self-contained JSON module) is structured so extraction to a separate package later is mechanical.

Bundle-size posture: subpath exports are separate esbuild bundles (`scripts/build.mjs`); users who never `import '@cortex-js/compute-engine/fungrim'` pay **zero bytes**. The fungrim bundle itself imports **types only** from the engine (the loader receives `ce` as an argument and uses the public API: `ce.declare`, `ce.box`, `ce.rules`, `ce.simplificationRules.push`, `ce.solveRules.push`), so importing both subpaths does not duplicate engine code. Phase 1 ships one artifact (`FUNGRIM_CORE`, the whole slice, ~30–45 KB gz); the artifact's per-rule `topics` field lets `loadFungrim(ce, { topics: ['gamma','log'] })` filter at load time without splitting files. A per-family data-module split (`fungrim-core` vs `fungrim-elliptic`, …) is a Phase-3 packaging refinement once complex-domain rules multiply the data 4×.

`loadFungrim` is synchronous, idempotent per engine (second call with overlapping selection skips already-loaded rule ids), and must be called before user symbol definitions that could shadow shell heads (documented; declarations go into the **current** scope).

### 2.2 Entry → Rule compilation

**Two-stage: an offline compiler (build script) produces a checked-in artifact of declarative rule records; the runtime loader turns guard specs into condition closures.** No closures are serialized; no corpus parsing happens at runtime.

**Offline (`scripts/fungrim/compile-rules.ts`, reusing `load.ts`'s `loadCorpus`/`inferType`):** for each slice entry `["Equal", lhs, rhs]`:

1. **Wildcardize:** rename each `variables[i]` symbol `z` → `_z` in both sides (pure tree rewrite; corpus variable names are plain identifiers, no collision with `_`-prefix space).
2. **Orient** per §2.3, producing `match`/`replace` (possibly swapped) + `purpose`.
3. **Compile assumptions** to a guard-spec list (flatten `And`):

```ts
type GuardSpec =
  | { k: 'type'; wc: string; t: 'integer'|'real'|'rational' }                  // Element(v, ZZ/RR/QQ)
  | { k: 'cmp'; wc: string; op: 'gt'|'ge'|'lt'|'le'; bound: MathJSON }         // interval/range bounds, Greater/Less…; bound may contain wildcards
  | { k: 'ne'; lhs: MathJSON; rhs: MathJSON }                                   // NotEqual, SetMinus exclusions
  | { k: 'eval'; pred: MathJSON };                                              // fallback: Equal(GCD(_n,_k),1), Element(v,Primes), Divides…
```

   Mapping table (the *whole* real-simple definition is covered):
   - `Element(v, Integers)` → `type integer`; `NonNegativeIntegers`/`PositiveIntegers`/`NegativeIntegers`/`NonPositiveIntegers` → `type integer` + `cmp` vs 0; `RealNumbers` → `type real`; `RationalNumbers` → `type rational`.
   - `Element(v, Interval(a,b))` (with `Open` markers) → `type real` + two `cmp` (skip infinite bounds); `Element(v, Range(a,b))` → `type integer` + `cmp`s. Bounds containing other entry variables are emitted wildcardized and substituted at match time.
   - `Element(v, SetMinus(S, Set(e₁…)))` → recurse on `S` + one `ne` per `eᵢ`.
   - `NotEqual(a,b)` → `ne`; `Greater/GreaterEqual/Less/LessEqual` over a bare variable → `cmp`; `Equal(...)`, `Element(v, Primes)`, `Divides(a,b)` → `eval` (pre-boxed predicate, substituted and evaluated at match time, fires only on literal `True`).
   - **Anything else** (`Not`, `NotElement`, `Or`-rooted conjuncts, quantifiers — ≤6 entries in the slice) → **entry not compiled**, ledger reason `guard-uncompilable`. This is the fail-closed compile-time policy.
4. **Self-test in a scratch engine** (stock CE + pruned shells, *no* COMPAT widening): box `{match, replace}` via `ce.rules(..., {canonical: true})` — reject on boxing error (`box-error`), wildcard loss under canonicalization (`wildcard-loss`, mirroring `applyRule`'s check), or use of a widened compat signature (`compat-signature` — e.g. 2-arg `Digamma`; statically detectable, ~tens of entries). Then instantiate `match` with seeded sample values satisfying the guards, run the boxed rule via `expr.replace(rule)`, and require it to fire and produce the instantiated `replace` (`no-fire` otherwise) — this catches canonicalization drift between pattern and expression forms, the loader's biggest structural risk.
5. **Emit** `CompiledFungrimRule` records into the artifact `src/compute-engine/fungrim/fungrim-core-data.json` (checked in; regeneration is `npx tsx scripts/fungrim/compile-rules.ts`, deterministic ordering so the git diff is the review artifact) plus a compile ledger `scripts/fungrim/rule-compile-report.json` (per-reason skip counts + ids):

```ts
type CompiledFungrimRule = {
  id: string;                       // 'fungrim:d4b0b6'
  match: MathJSON; replace: MathJSON;
  guards: GuardSpec[];
  purpose: 'simplify' | 'transform' | 'expand';
  target: 'simplify' | 'solve' | 'harmonization';
  class: 'specific-value' | 'identity';
  heads: string[]; topics: string[];
};
// artifact = { manifest: {snapshot pin, generator, counts}, declarations: <pruned 81-head table>, rules: CompiledFungrimRule[] }
```

**Runtime (`src/compute-engine/fungrim/loader.ts`):** per selected rule, build one condition closure over the substitution, using the same predicate machinery as `solve.ts`'s `filter`/closures and `rules.ts` `CONDITIONS` (whose `checkConditions` fires only on `!== true` — the precedent for fail-closed):

```ts
condition: (sub) =>
  guards.every((g) => {
    switch (g.k) {
      case 'type': return g.t === 'integer' ? sub[g.wc].isInteger === true
                  : g.t === 'real'    ? sub[g.wc].isReal === true
                  :                     sub[g.wc].isRational === true;
      case 'cmp':  return sub[g.wc].isGreater(boundExpr.subs(sub)) === true; // op-dispatched; tri-valued, undefined ⇒ false
      case 'ne':   return lhsExpr.subs(sub).isEqual(rhsExpr.subs(sub)) === false; // provable inequality only
      case 'eval': return predExpr.subs(sub).evaluate().symbol === 'True';
    }
  })
```

Guard sub-expressions (`bound`, `ne` operands, `eval` predicates) are boxed **once per rule at load time** (wildcards as symbols), `.subs()`-instantiated per match. The runtime fail-closed policy: every predicate must return a definitive positive; `undefined` (unknown) ⇒ condition false ⇒ rule silently doesn't fire — visibility for this is §2.8's job. Rules are registered via `ce.simplificationRules.push(...)` as object rules carrying `id` and `purpose`; the M2 rule index buckets them by canonical match head automatically; `operators` hints are unnecessary for pattern rules.

### 2.3 Rule direction & curation — offline, in the CE-side compiler (recommended)

**Where curation lives:** **offline, persisted in the compiled artifact** — but in the **TypeScript compile script**, *not* the Python translator. Weighing the two options:

- *Translator annotation pass (Python):* keeps everything in one pipeline, but the direction policy needs `ce.costFunction`, CE canonicalization, and CE pattern-matchability checks — none available in Python; reimplementing the cost model would drift. It also conflates the *translation* artifact (faithful, undirected, consumer-agnostic — the corpus README's contract) with *CE-specific consumption policy*.
- *Load-time computation (runtime):* costs ~700 × 2 boxings + cost evaluations on every `loadFungrim` call, and makes curation un-reviewable (no diff to eyeball, no place to hand-override).
- **Chosen: CE-side offline compiler.** The corpus stays undirected/pure; `compile-rules.ts` computes orientation with the real `costFunction` on the canonically-boxed variable-form sides; the checked-in artifact diff is the curation review surface; a small hand-maintained override file (`scripts/fungrim/curation-overrides.json`: `{ id: { direction?, purpose?, exclude?, note } }`) is merged last for human judgment calls.

**Direction policy:**

- **Specific values:** always *value-form → closed-form* (`Gamma(1/2) → √π`), i.e. corpus LHS→RHS, `purpose: 'simplify'`. The 95 symbol/`Set`/`Apply`-LHS entries are **excluded by default** (`lhs-not-value-form`); a curated handful may be loaded *reversed* as "recognition" rules (`(1+√5)/2 → GoldenRatio`) only via explicit overrides (open question Q3).
- **Identities:** let `c(side) = ce.costFunction(box(side))` on the variable-named (pre-wildcard) canonical forms:
  - `c(RHS) ≤ 0.9·c(LHS)` → orient LHS→RHS, `purpose: 'simplify'`.
  - `c(LHS) ≤ 0.9·c(RHS)` **and** `vars(LHS) ⊆ vars(RHS)` **and** RHS is pattern-viable (function expression, not a bare variable/literal) → orient RHS→LHS, `purpose: 'simplify'`.
  - Otherwise (tie band, or the cheap side is un-patternable like `z`): orient toward the side rooted in a named special-function head where possible and tag **`purpose: 'expand'`** — excluded from `simplify()` by the M3 semantics, fully usable via `expr.replace()`. The machine policy never emits `'transform'` (cost-gate-exempt is too dangerous to automate); `'transform'` is **override-only**, for hand-vetted growth-neutral canonicalizations.
  - The 10% margin means every machine-loaded `'simplify'` rule is *statically* expected to shrink, and the runtime 1.3× gate remains as the per-instance backstop — double protection, per docs/fungrim/FUNGRIM.md §6's curation mandate.
- **Dedup of undirected duplicates:** key each entry by the unordered pair of canonical side hashes; when two entries are the same equality (or exact inverses), load **one** oriented rule and ledger the other (`duplicate-undirected`), preventing A→B and B→A from ever coexisting in the simplify set.

### 2.4 Specific values: individual indexed rules (recommended)

**Recommendation: 443→~348 individual object pattern rules**, not a per-head lookup-table functional rule. Rationale: with the landed M2 index, per-head buckets are small (max ~30 for `CarlsonRJ`); a failed literal-pattern match dies on the first argument comparison, so the marginal cost over a `Map` lookup is negligible at this scale. Individual rules buy: uniform pipeline (same compile/validate/report path as identities), per-rule ids in `simplify()` steps' `because` (debuggability), per-topic filtering for free, and oracle/differential testing without special cases. The per-head functional-dispatcher alternative (`{ replace: fn, operators: ['Gamma'] }` over a `Map<canonicalKey, value>`) is the documented **fallback** if the M5 benchmark attributes measurable cost to value buckets — the artifact format already groups by head, so the switch is loader-internal and API-invisible.

### 2.5 Loop prevention

Layers, outermost first:

1. **One direction per undirected equality** in the artifact (compile-time dedup, §2.3) — inverse *pairs stored as two corpus entries* collapse to one rule.
2. **Strict-decrease orientation + tie exile to `'expand'`** — the simplify-active set is cost-monotone by construction (10% static margin), so ping-pong requires an instantiation that inverts the static cost ordering *and* survives the runtime 1.3× gate.
3. **M3 purpose semantics** — `'expand'` rules never enter `simplify()`'s scan, so the growth direction of any transformation pair is unreachable from `simplify()`.
4. **Engine backstops** — `replace()`'s step-history loop detection, `iterationLimit`, and `simplify()`'s fixed-point repeat check turn any residual cycle into termination-with-wasted-work, not a hang.

**Adversarial test plan** (M4, `test/compute-engine/fungrim-loops.test.ts`):
- *Compile-time:* feed the compiler a fixture corpus containing an equality and its swap; assert exactly one rule emitted + `duplicate-undirected` recorded. Assert no two artifact rules `r₁,r₂` satisfy `r₁.match ≍ r₂.replace ∧ r₁.replace ≍ r₂.match` (canonical-hash scan over the real artifact — a standing invariant test).
- *Runtime, deliberate sabotage:* manually push both orientations of a corpus identity (and of a synthetic double-angle pair), then `simplify()` seeds that match both; assert termination below `iterationLimit`, stable result, and bounded step count.
- *Whole-set soak:* load the full slice, run `simplify()` over the rule-dispatch corpus + instantiated LHS of every loaded identity; assert no expression exceeds an iteration budget and `simplify(simplify(x)) ≡ simplify(x)` (idempotence) on the sample set.

### 2.6 Solve templates in Phase 1

> **Phase 2 status (ACTIVATED).** The seed set below now ships in the artifact.
> A dedicated, idempotent post-step — `scripts/fungrim/apply-solve-templates.ts`
> — derives a root template from each seed's emitted inverse-composition
> simplify rule, end-to-end self-tests it (push to a scratch engine's
> `solveRules`, solve a concrete instance, check the validated root), and
> appends it to the artifact as a `target:'solve'` rule with id
> `fungrim:<id>:solve`. The loader attaches the no-capture filter and
> `useVariations` for `target:'solve'` rules; they load only under
> `loadIdentities(ce, { solve: true })`. **The step is decoupled from
> `compile-rules.ts`** (a surgical overlay on the existing simplify rules, not
> part of the slice recompile) and exposes a `--check` CI gate. The five
> emitted seeds are `8654a3` (LambertW), `296627`/`4c1e1e` (Exp/Ln),
> `1f026d`/`f516e3` (Tan/Arctan); `ed7dac` stays unavailable (its 2-arg
> LambertW simplify rule is compat-signature-gated). A mining audit over the
> artifact's identity rules confirms no other inverse-composition entry is a
> non-degenerate, non-redundant solve candidate.

Honest scoping from the data: the slice contains **almost no solve-shaped entries** (the five `f(g(x))=x` inverse compositions are complex-domain). Phase 1 therefore ships the **mechanism + a seed set**, leaving volume to Phase 2:

- **Mechanism:** `CompiledFungrimRule.target: 'solve' | 'harmonization'` routes rules to `ce.solveRules.push` / `ce.harmonizationRules.push`, behind `loadFungrim(ce, { solve: true })` (default **false** in Phase 1).
- **Compilation shape:** from an inverse-composition identity `f(g(x)) = x`, emit a root template in `UNIVARIATE_ROOTS` style: `{ match: ['Add', g('_x'), '__b'], replace: f(['Negate','__b']), useVariations: true, condition: sub => filter-style "no other wildcard captures _x" ∧ compiled guards, id: 'fungrim:<id>:solve' }`.
- **Seed set (hand-curated overrides, ~4–6 templates):** LambertW from `8654a3` (`_x·e^_x + __b = 0 → _x = W(−__b)`) and `ed7dac` (branch −1 — excluded if it trips the compat-signature rule; revisit), plus the Ln/Exp/Tan/Arctan compositions (`4c1e1e`, `296627`, `1f026d`, `f516e3`) **despite** their complex-domain guards — justified because `validateRoots` checks every candidate against the original equation, so an over-broad template degrades to a no-op, never a wrong answer (the property the landed `ce.solveRules` docs already promise). Each seed carries a `note` in the overrides file citing this.

### 2.7 Validation & acceptance (plan-level)

1. **Curated before/after suite** (`test/compute-engine/fungrim-loader.test.ts`): with the loader active — `Gamma(1/2) → √π`, `Gamma(3/2) → √π/2`, `Gamma(2) → 1`; `|Γ(iy)| → √(π/(y·sinh πy))` under `assume y real, y≠0` (entry `1976db`, exercises a real-simple guard + `ne`); `ζ(2) → π²/6`; arctan specific values; log/exp identities from `log.json`'s slice; `W(x·eˣ) → x` for positive real `x`; and **negative controls**: the same inputs *without* the required assumptions must NOT rewrite (fail-closed guard verification), and an integer-guarded rule must not fire on a symbolic non-integer.
2. **Dispatch-oracle invariance:** `rule-dispatch-regression.test.ts` snapshots stay **byte-identical** when fungrim is not loaded; plus a test that merely *importing* the fungrim module has no side effects on a fresh engine.
3. **Benchmark** (extend `benchmarks/rule-dispatch.benchmark.test.ts`): full Phase-1 slice loaded (~600+ rules), `simplify()` over the M0 corpus **≤ 1.5× the unloaded baseline**; index build amortization checked (first vs. second call).
4. **No regression:** full jest suite + `npm run typecheck` green.
5. **Self-test fidelity + no silent drops (added Phase 2):** the offline self-test satisfies a rule's guard condition by ASSUMING its guards on the seed symbols, but that activates the sign-gated `√` fold (`Sqrt(1/x) → 1/Sqrt(x)`), re-canonicalizing the instance away from the sign-unknown wildcard pattern so the isolated single-pass match fails — a false no-fire for rules that fire within the full rule set. `selfTest` phase 3d fixes it: on the no-fire path (guards already known satisfiable) it re-tests the rewrite on a SIGN-NEUTRAL instance with a condition-free rule (additive, deterministic, can't regress a passing rule). As a backstop, `scripts/fungrim/recompile-drift.ts` full-recompiles the slice and fails if any committed simplify rule would be dropped (or any new rule added) without an allowlist entry in `curation-overrides.json` `recompileDivergence` (currently empty — the artifact is fully reproducible).

### 2.8 Failure visibility (docs/fungrim/FUNGRIM.md §6)

Two layers, matching the two failure modes:

- **Load report (entries that never became rules):** `loadFungrim` returns

```ts
type FungrimLoadReport = {
  loaded: number;
  byTarget: Record<'simplify'|'solve'|'harmonization', number>;
  byPurpose: Record<'simplify'|'transform'|'expand', number>;
  declared: string[];                    // shell heads added to the scope
  skipped: { id: string; reason: string }[];  // runtime skips (boxing failure in user env, selection filter, already-loaded)
  compileLedger: Record<string, number>; // baked-in offline skip counts by reason (guard-uncompilable, compat-signature, wildcard-loss, no-fire, duplicate-undirected, lhs-not-value-form) — so the user sees what the *corpus* contains vs what this artifact can do
};
```

- **Silent guard failures (rule loaded but never fires):** per-rule ids surface in `simplify()` steps (`because: 'fungrim:xxxxxx'`), so *firing* is observable; for *non*-firing, add `loadFungrim(ce, { onGuardUndecided?: (ruleId, wc) => void })` — a debug hook invoked when a fungrim condition fails specifically because a predicate returned `undefined` (vs. definitively false). Cheap to implement inside the generated closure, zero cost when unset; converts docs/fungrim/FUNGRIM.md §6's "users see nothing happened" into an actionable trace.

---

## 3. Milestones (dependency order)

### M1 — Offline rule compiler + checked-in artifact
**Effort: 5–6 days** (the curation policy is the bulk).

Files:
- `scripts/fungrim/compile-rules.ts` (new) — slice selection, wildcardization, orientation/purpose (§2.3), guard compilation (§2.2), scratch-engine self-test, dedup, overrides merge, deterministic emit. Imports `loadCorpus`/`inferType` from `scripts/fungrim/load.ts` (read-only reuse; `load.ts` untouched).
- `scripts/fungrim/curation-overrides.json` (new) — initially: the solve seed set (§2.6), a small `'transform'` allowlist (likely empty at first), any exclusions found during triage.
- `src/compute-engine/fungrim/fungrim-core-data.json` (new, generated, checked in) — artifact per §2.2.
- `scripts/fungrim/rule-compile-report.json` (generated) — ledger.
- `test/compute-engine/fungrim-compile.test.ts` (new) — fixture-corpus unit tests: each guard-shape mapping, fail-closed exclusion, orientation cases (cheaper-RHS, cheaper-LHS-with-var-subset, tie→expand), dedup, wildcard-loss rejection, no-fire rejection.

Acceptance:
- Compiler runs clean over `data/fungrim`; artifact contains ≥ **550** rules (sanity floor: 707 − ~95 symbol-LHS − compat/guard skips), every skip ledgered with a reason; re-running produces a byte-identical artifact.
- Self-test pass: 100% of emitted rules fire on their seeded instantiation.
- `npm run typecheck` clean.

Risks: cost-function ties may cluster (many identities are near-symmetric) → large `'expand'` population; acceptable, but record the split in the ledger for the human review in Q4.

### M2 — Runtime loader
**Effort: 3–4 days.** Depends on M1 artifact; Track-2 M3 purpose tags have landed.

Files:
- `src/compute-engine/fungrim/loader.ts` (new) — `loadFungrim` per §2.1/2.2/2.8: prune+declare shells (only heads referenced by *selected* rules, current scope, skip already-defined names, **never** widen built-ins), compile guard specs → closures, register via `ce.simplificationRules.push` / `ce.solveRules.push` / `ce.harmonizationRules.push` with `purpose` and `id`, build report. Options: `{ topics?: string[]; classes?: ('specific-value'|'identity')[]; purposes?: RulePurpose[]; solve?: boolean; onGuardUndecided?: ... }`.
- `src/compute-engine/fungrim/types.ts` (new) — `FungrimLoadOptions`, `FungrimLoadReport`, `FungrimRuleData`, `GuardSpec`, `CompiledFungrimRule` (public-surface clean, no `any`).
- `src/fungrim.ts` (new) — subpath entry re-exporting loader + `FUNGRIM_CORE` (JSON import).
- `test/compute-engine/fungrim-loader.test.ts` (new) — load report shape, idempotence, topic/class filtering, shell declarations present after load, guard positive/negative controls, per-engine isolation, `solve: true` routes templates and `solve()` gains the LambertW equation.

Acceptance:
- Loader test green; `rule-dispatch-regression.test.ts` snapshot byte-identical (fungrim not loaded there); `simplify-rules.test.ts`, `solve-rules.test.ts`, `rules.test.ts` green.
- `npm run typecheck` clean (the fungrim modules import engine **types only**; verify no runtime import of `src/compute-engine/index.ts` from `src/compute-engine/fungrim/`).

### M3 — Build & packaging wiring
**Effort: 1–2 days.**

Files:
- `package.json` — `exports['./fungrim']` block (types/import/require/default, matching `./core`).
- `scripts/build.sh` — add `fungrim` to `TARGETS` + a `tsc --emitDeclarationOnly` stanza for `src/fungrim.ts`.
- `scripts/build.mjs` — add the fungrim entry to the esbuild entry list (JSON loader is esbuild-native).
- `test/public-ts-declarations/` — extend the declarations check to the new entry if the harness enumerates entries.

Acceptance:
- `npm run build` produces `dist/fungrim.*`; bundle size recorded (target: ≤ 300 KB raw / ≤ 50 KB gz for the data+loader bundle); main `compute-engine` bundle size **unchanged byte-for-byte** vs. pre-M3 build.
- A Node smoke script (test-only) imports `@cortex-js/compute-engine/fungrim` from `dist` and runs one gamma example.

### M4 — Loop-prevention & adversarial tests
**Effort: 2 days.**

Files:
- `test/compute-engine/fungrim-loops.test.ts` (new) — the full §2.5 plan: artifact inverse-pair invariant scan, sabotage tests, whole-set soak + idempotence.

Acceptance: all green with the full slice loaded; soak iteration budgets documented in-file.

### M5 — Acceptance suite & benchmark
**Effort: 2–3 days.**

Files:
- `test/compute-engine/fungrim-loader.test.ts` (extend) — the curated before/after examples (~25–40 cases across gamma/zeta/atan/log/factorials/lambertw) including negative controls.
- `test/compute-engine/benchmarks/rule-dispatch.benchmark.test.ts` (extend) — replace/augment the synthetic-1,500-rules scenario with the real loaded slice; assert `simplify()` over the M0 corpus ≤ **1.5×** unloaded baseline; report candidates-per-node stats if the index exposes counters.
- `CHANGELOG.md` — additive API entry (`loadFungrim`, `./fungrim` subpath).

Acceptance:
- Before/after suite green; benchmark within budget; **full** jest suite green; `npm run typecheck` clean; `rule-dispatch-regression` snapshot untouched.
- If the 1.5× budget fails and profiling blames value buckets → execute the §2.4 fallback (per-head functional dispatcher with `operators` hint) inside the loader; artifact unchanged.

### M6 (stretch, gated on a human call — Q7) — Solve seed activation
**Effort: 1–2 days.** Flip the curated solve templates from overrides into the default artifact, document `{ solve: true }`, add `solve()` examples (`x·eˣ = 3`, `ln f(x)` harmonization variant). Acceptance: `solve.test.ts` unchanged; new equations solvable; `validateRoots` filtering demonstrated with a deliberately over-broad template.

**Total: ~14–18 working days**, consistent with docs/fungrim/FUNGRIM.md §5's "Phase 1 ≈ 2–3 weeks (mostly curation + the dispatcher)" with the dispatcher already banked by Track 2.

---

## 4. Risks

1. **Canonicalization drift vs. checked-in artifact** (highest). The artifact stores raw MathJSON, boxed canonically at load — if CE's canonical forms change, patterns may silently stop matching. Mitigated by: M1's fire-on-instance self-test, re-runnable in CI as a cheap smoke (consider a tiny `fungrim-artifact-freshness.test.ts` that re-self-tests a random 25-rule sample per run); regeneration is one command with a reviewable diff.
2. **Curation quality.** A wrongly-oriented or wrongly-guarded rule produces wrong simplifications — worse than no rule. Mitigations: fail-closed guard compiler, 10% static margin + runtime cost gate, negative-control tests, the overrides file as the human escape hatch, and corpus provenance (Fungrim's own assumptions are the soundness contract; we only ever *narrow*).
3. **Purpose-tag semantics dependency.** If M3's final shape changes (e.g. option name), only `loader.ts` changes.
4. **Guard predicates returning `undefined` too often** (REVIEW A3 lineage) → rules legal-but-inert, the §6 "silent failure" experience. Mitigated by the `onGuardUndecided` hook, the negative/positive control tests pinning expected firing, and reporting `byPurpose`/`loaded` honestly.
5. **Shell declarations mutate the user's scope** — collisions with user symbols named e.g. `AGM`. Mitigated: skip-if-defined policy + `declared` list in the report + docs ("call `loadFungrim` first"). Never widening built-ins eliminates the harness's compat-evaluator loss at runtime.
6. **Bundle creep.** 200 KB raw JSON in an opt-in subpath is fine now; Phase 3 quadruples it — the per-family split decision (Q5) should be made before then; the artifact schema already carries `topics` to enable it.
7. **Benchmark flakiness in CI** — ratio-based budgets vs. in-process baseline (established Track-2 pattern), wide margins.

## 5. Open Questions (need a human decision)

1. **Q1 Packaging confirmation:** subpath `@cortex-js/compute-engine/fungrim` now, separate `@cortex-js/fungrim-data` later — confirm, since it adds a permanent public entry point.
2. **Q2 API name:** `loadFungrim(ce, opts)` (proposed) vs `loadFungrimRules`; and whether `FUNGRIM_CORE` should be a lazily-parsed string vs eager JSON module (eager proposed).
3. **Q3 Recognition rules:** include any reversed symbol-LHS specific values (`(1+√5)/2 → GoldenRatio`)? Default: exclude all 95; revisit with overrides.
4. **Q4 Tie-band policy review:** after M1, a human should skim the `'expand'`-classified identities (could be 30–50% of the identity slice) and promote any genuinely-canonicalizing ones to `'transform'` via overrides — needs a maintainer pass on the compile report.
5. **Q5 Artifact granularity:** single `fungrim-core-data.json` (proposed for Phase 1) vs per-family data modules now — affects nothing until Phase 3.
6. **Q6 Libraries-contract extension:** add an `onLoad`/`rules` hook to `LibraryDefinition` so `libraries: [fungrimLibrary()]` becomes possible? Recommend deferring until a second rules-bearing library exists.
7. **Q7 Solve seed default:** ship M6's curated complex-domain-guarded solve templates in Phase 1 (relying on `validateRoots` as the safety net) or hold all solve content for Phase 2? Recommendation: ship behind `{ solve: true }` (off by default), promote in Phase 2.

### Critical Files for Implementation
- `scripts/fungrim/compile-rules.ts` (new — offline compiler; reuses `scripts/fungrim/load.ts`)
- `src/compute-engine/fungrim/loader.ts` (new — runtime loader; data artifact `fungrim-core-data.json` beside it)
- `src/fungrim.ts` (new — subpath entry; wired via `package.json` + `scripts/build.sh`/`build.mjs`)
- `src/compute-engine/boxed-expression/rules.ts` (read-mostly — `CONDITIONS`, `boxRules`, `operators` hint semantics the loader targets)
- `test/compute-engine/fungrim-loader.test.ts` (new — acceptance/negative-control suite; plus `benchmarks/rule-dispatch.benchmark.test.ts` extension)
