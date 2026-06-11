# Compute Engine — Roadmap

**Last updated:** 2026-06-10. Items 2 (interruptible evaluation) and 4
(Tier-2 numeric kernels) completed — both prerequisites for the Rubi
integration (`docs/rubi/RUBI.md`).

Context: the 2026-06 release shipped the Fungrim-derived identities library
(`@cortex-js/compute-engine/identities`, 1,376 rules), the complex-domain
assumptions extension (constraint subjects over `Re/Im/Abs/Arg`, set-membership
facts, fail-closed guard discharge), the operator-indexed rule dispatcher with
purpose tags, `ce.solveRules`/`ce.harmonizationRules`, exact `Zeta` evaluation,
and the full correctness/performance sweep from the June codebase review
(~120 findings + 15 follow-on discoveries, all dispositioned). This document
captures what comes next, in priority order, with enough context to start each
item cold.

Related documents: `docs/fungrim/FUNGRIM.md` (feasibility analysis and feature map A–E),
`docs/fungrim/FUNGRIM-PLAN-1…5` (executed plans for the translator, rule mechanics,
assumptions, and loader — useful as architecture references), `data/fungrim/`
(the translated corpus + manifest), `scripts/fungrim/` (translator-side tooling:
rule compiler, validation harness, guard census).

---

## Near-term

### 1. Fungrim Phase 2 — activate solve templates

**What:** promote the curated solve-template seeds (currently staged in
`scripts/fungrim/curation-overrides.json` behind `loadIdentities(ce, {solve:
true})`, off by default) into a supported capability, and mine the corpus's
inverse-composition entries (`f(g(x)) = x`) for more templates.

**Why now:** the G2 harmonization fix changed the economics. Before it, solve's
harmonization pass was provably inert (the `_x` binding mismatch); now
harmonization rules chain (depth 4), injective wrappers peel off `Equal`, and
`validateRoots` checks every candidate against the original equation — so an
over-eager template degrades to a no-op, never a wrong answer. Solve templates
compose with all of that.

**How:** flip the seed set (LambertW `8654a3`, Ln/Exp `4c1e1e`/`296627`,
Tan/Arctan `1f026d`/`f516e3`) into the default artifact via the overrides
`inject`/`target: 'solve'` path (the mechanism already exists in
`compile-rules.ts`); add corpus mining for `class: identity` entries of the
inverse-composition shape; acceptance via `solve-rules.test.ts` extensions
(e.g. `x·eˣ = 3 → W(3)`). Consider the "general solution families" follow-on
(`x = arctan(c) + πn`) separately — it needs a representation decision
(solution sets vs principal values) that was deliberately deferred in Track 2.

**Effort:** ~1 week. **Dependencies:** none — everything is landed.

### 2. ~~Interruptible evaluation~~ — ✅ done (2026-06-10)

**Outcome:** long-running evaluation loops now respect the engine deadline
(throwing `CancellationError`, same contract as `Factorial`/`Sum`):

- **Shared helper:** `checkDeadline(deadline)` in `src/common/interruptible.ts`
  (takes the absolute `ce._deadline`; strided in tight loops to amortize
  `Date.now()`).
- **Collection enumeration:** `BoxedFunction.each()` and `BoxedSymbol.each()`
  check every 256 items — one choke point covers Filter/Select/CountIf/
  Position/GroupBy, the set iterators, and cartesian-power enumeration
  (the `4099d2` hang class).
- **Number theory:** `Totient`, `Sigma0/1/−1`, `IsPerfect`, `IsAbundant`
  divisor loops, plus the `Eulerian`/`Stirling`/`NPartition` recursions.
- **Numeric `Limit`:** `extrapolate()` (Richardson) takes a `deadline`
  option, checked between function evaluations; `limit()` threads it;
  `Limit`/`NLimit` pass `engine._deadline`.
- **Quadrature:** `monteCarloEstimate()` checks every 1024 samples and
  *degrades gracefully* — it returns the estimate from the samples taken
  so far (with its larger error) rather than throwing, unless no samples
  were taken at all.

Coverage in `test/compute-engine/timeout.test.ts` (hang regression tests for
each family). **Residual:** the Stage-2 harness watchdog/denylist
(`FUNGRIM_SKIP_IDS`) can now be retired — re-run
`scripts/fungrim/validate.ts --numeric` with the structural skips removed to
confirm reach (harness-side change, not engine-side).

### 3. CI for the corpus pipeline

**What:** two cheap CI jobs: (a) Stage-1 box-check of the full corpus
(`npx tsx scripts/fungrim/validate.ts --corpus data/fungrim`, ~7 s, exit code
already gates on ≥99%); (b) an artifact-freshness smoke test — re-run the
rule compiler's self-test on a deterministic ~25-rule sample and assert they
still fire (catches engine canonicalization drift against the checked-in
artifact, the highest-rated risk in the loader design).

**Effort:** ~1 day. **Why:** the artifact stores canonical-form patterns;
canonicalization changes elsewhere in the engine can silently break matching.
This happened once already during development (raw-form patterns no-fired
~123 entries) — the self-test caught it then; CI makes that protection
continuous.

---

## Medium-term

### 4. ~~Tier-2 numeric kernels for special functions~~ — ✅ done (2026-06-10)

**Outcome:** seven shell heads are now engine built-ins with numeric kernels,
in a new `special-functions` library (`library/special-functions.ts`),
following the B23 kernel pattern and the Fungrim conventions:

- **`EllipticK(m)` / `EllipticE(m)`** (parameter m = k², Fungrim
  `e8ae42`/`723fd0`): machine + bignum via the AGM (E via the cₙ-sum,
  A&S 17.6.4), complex kernels via the optimal-branch complex AGM (so
  K(m>1) returns the correct complex value). K(1) = +∞, E(1) = 1 exact.
- **`AGM(a, b)`** (and the 1-arg Fungrim shorthand `AGM(z)` = AGM(1, z)):
  machine + bignum + complex.
- **`Hypergeometric2F1(a,b,c,z)`**: terminating/polynomial cases, direct
  series, Pfaff z→z/(z−1), 1−z connection formula (generic case), Gauss
  summation at z = 1; machine + bignum (50-digit verified) + complex
  (|z| ≤ 0.8 ∪ Pfaff region).
- **`Hypergeometric1F1(a,b,z)`**: entire series + Kummer transformation
  for z < 0; machine + bignum + complex.
- **`JacobiTheta(j, z, τ)`** (Fungrim `f96eac`: q = e^{iπτ}, period 1 in z)
  and **`DedekindEta(τ)`** (`1dc520`): machine-complex q-series/products
  (envelope-based truncation; derivative order r > 0 stays symbolic).

Supporting work: `applyN()` dispatcher in `boxed-expression/apply.ts` with a
bignum → machine → complex NaN-cascade (a kernel returning NaN means
"outside my implemented domain", and the expression stays symbolic if all
kernels pass). Bignum series loops are deadline-checked (item 2). The
artifact loader skips its shells for these heads ("never widen"); the
declarations table re-prunes at the next artifact regen. ~60 reference-value
tests in `special-functions.test.ts`; Stage-1 corpus validation unchanged at
99.80%, all 1,376 rules load.

**Residual:** bignum kernels are real-argument only (complex falls back to
machine precision); ₂F₁ outside |z|<1 ∪ Pfaff region for complex z, the
degenerate integer-(c−a−b) connection case at z > 0.95, and theta
derivatives (r ≥ 1) stay symbolic. The 567 "not-evaluable" Stage-2 skips
should now be re-measured (harness side).

### 5. Per-head aggregated rule dispatch

**What:** close the loaded-simplify benchmark gap: with the 1,376-rule
artifact, `simplify()` over the reference corpus runs at ~1.58× the unloaded
baseline (target ≤1.5×; Phase 1's 558 rules ran at 1.16×). The residual cost
is per-rule `applyRule`/`candidateRules` scaffolding for the ~60 wrapper
consultations per arithmetic node.

**How:** aggregate hot-head rules into one dispatcher per head. This was
deliberately not done in the loader because it conflicts with the pinned
contract that `ce.simplificationRules.length` reflects per-rule registration
and each rule's `fungrim:` id surfaces in simplify steps — so it needs a small
design first (e.g. dispatcher-level step attribution, or relaxing the count
contract). The loader's pre-screen machinery (rarity-ranked required-feature
sets, WeakMap-memoized per-expression feature sets in
`src/compute-engine/fungrim/loader.ts`) carries over unchanged.

**Effort:** ~3–5 days once the observability design is settled.

### 6. ~~Corpus refresh from live fungrim.org + upstream contributions~~ — ✅ done / moot (2026-06-10)

**Outcome:** the premise was refuted — upstream `fredrik-johansson/fungrim`
has not moved since the original snapshot (verified by recursive diff during
fork setup), so there is nothing newer to refresh from. What was done instead:

- Translator published in the fork [`arnog/fungrim`](https://github.com/arnog/fungrim)
  (default branch `grim2mathjson`; `master` tracks upstream).
- The two upstream bug families reported as issues **and** fixed via PRs
  (Equal-paren in `6c2b31`/`e54e61` — duplicating the author's own forgotten
  2022 PR #29 — and `Element(w, tau)` ×24 in `jacobi_theta.py`), each fix
  numerically verified at 30 digits.
- Fix commits merged into the fork's `grim2mathjson` branch; corpus
  regenerated (26 entries improved, Stage-1 99.80%, artifact 1,350 → 1,376
  rules); `MANIFEST.json` records the patched-fork provenance.

**Residual (maintenance, not roadmap):** if upstream ever merges the PRs or
revives, rebase the fork and regenerate — the workflow is documented in
`data/fungrim/README.md`.

---

## Strategic

### 7. Fungrim Phase 4 — the analytic-property metadata store

**What:** `data/fungrim/properties.json` ships 131 extracted records — poles,
zeros, branch points, branch cuts, residues, holomorphic domains, keyed by
operator — that nothing consumes yet. Build the per-operator metadata store
sketched in `docs/fungrim/FUNGRIM.md` §4 Feature E: `ce.functionProperties('Gamma').poles →
ℤ≤0`-style queries feeding (a) branch-cut-safe simplification guards, (b)
pole-aware `N()` (return `ComplexInfinity` at poles instead of garbage), and
(c) the foundation for symbolic limits and residues — the next genuinely new
capability class for the engine.

**Effort:** the store + (b) is ~1 week; (a) and (c) are open-ended design
work. Start by defining the query API and wiring `Gamma`/`Zeta` poles into
`N()`.

### 8. Disjunctive guards (`Or`) in the assumptions system

**What:** 87 complex-domain corpus entries remain undischargeable because
their guards are `Or`-rooted (the assumptions design deliberately scoped
disjunction out — see `docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md` §7 non-goals). The
remaining ~43 failures are symbolic bounds (`|z| < φ−1`), which the
assume-side decomposition deliberately drops.

**Why "strategic":** disjunctive facts are a real design extension (case
splitting or watched-disjunct propagation), not an incremental patch. The
guard census (`scripts/fungrim/guard-census.json`, currently 89.6%
complex-domain dischargeable) quantifies exactly what it would buy. Let
demand justify it.

---

## Documentation

- **`doc/14-guide-assumptions.md`** predates the Track-3 extension — document
  part-predicates (`assume(Re(s) > 1)`, `Im(τ) > 0`, `|q| < 1`),
  `NotEqual`/`SetMinus` domains, `And` conjunctions, the `'not-a-predicate'`
  result, and the three-valued discharge semantics.
- **`doc/15-guide-patterns-and-rules.md`** — document the new `Rule.purpose`
  tags (`simplify`/`transform`/`expand`), the `operators` dispatch hint, and
  `ce.solveRules`/`ce.harmonizationRules`.
- **`doc/15b-guide-extended-rules.md`** (new this release) — revisit the
  performance numbers if dispatch work (item 5) lands.
- If Tycho/GP consumes this release: add a `loadIdentities` section to the
  importer guide in the Tycho repo (consumer-facing docs live with the
  consumer).

---

## Review residue (carried from REVIEW.md, June 2026)

The June 2026 codebase review (REVIEW.md) is fully dispositioned; its full
text is preserved in git history. The only items deliberately left open:

- **A14 (LOW, deferred)** — `boxed-expression/order.ts` tie-breaks: operator
  and string branches sort descending while the symbol branch and doc comment
  say ascending. Deferred because forcing ascending changes established
  canonical orderings in a debatably *worse* direction (e.g. `-(sech x ·
  tanh x)` instead of the textbook `-(tanh x · sech x)`) and churns
  calculus/derivatives snapshots. The right resolution — which branch to align,
  or whether to encode the textbook ordering explicitly — is a deliberate
  canonical-form design choice, not a bug fix.
- **G5 (LOW, deferred)** — `["Subscript", "a", "k"]` canonicalizes to the
  fused symbol `a_k`, severing the binding when `k` is a binder-bound index.
  A correct fix needs binder-aware canonicalization (the canonicalizer has no
  enclosing-binder scope at fusion time) — too broad for a LOW finding. The
  documented workaround is the call form `["a_", "k"]` (which the Fungrim
  corpus uses).
- **collections.test.ts** — 3 `@fixme`-annotated Take/Drop/Slice matrix
  snapshots, known failing.
- **G7 / A15** — resolved by intervening work; G7 (bound-variable identity
  stability across re-boxing) is a regression-coverage candidate: it now
  passes but has no dedicated test pinning it.

Lessons from the review worth keeping in mind (the durable ones are in
CLAUDE.md): the `undefined → false` collapse in three-valued predicates was
the single most recurring bug class (A3, G3, the sets/Union/Range contains
family, NaN comparisons); validation-by-corpus (the Fungrim harness) found
15 engine bugs that targeted review missed — keep running it.
