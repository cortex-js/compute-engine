# Compute Engine — Roadmap

**Last updated:** 2026-06-10, following the identities/assumptions release.

Context: the 2026-06 release shipped the Fungrim-derived identities library
(`@cortex-js/compute-engine/identities`, 1,350 rules), the complex-domain
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

### 2. Interruptible evaluation

**What:** make long-running evaluation loops respect the engine deadline
(`ce._timeRemaining`) — specifically collection enumeration, numeric `Limit`
extraction, numeric quadrature (`Integrate`), infinite-`Sum` numeric
summation, and the number-theory divisor loops.

**Why:** this is the single biggest *robustness* gap left. During corpus
validation we hit it repeatedly: entry `4099d2` (a `Limit` over a cartesian
power of `Range`) ran 11+ CPU-minutes uninterruptibly; the Stage-2 numeric
harness had to grow an external stall watchdog, a hang denylist
(`FUNGRIM_SKIP_IDS`), and structural skips for 202 representation-class +
33 Derivative-containing entries. Any user can trigger the same hangs with
ordinary-looking input.

**How:** thread deadline checks into the iteration hot loops (the engine
already has the `_timeRemaining` machinery — e.g. `Factorial` wraps `run()`;
the gap is that collection iterators, `limit()`, quadrature, and
`Totient`/`Sigma*`-style `for (1n..k)` loops never check it). Acceptance: the
Stage-2 harness runs the representation/derivative slices without the
watchdog; `scripts/fungrim/validate.ts --numeric` completes with the
structural skips removed.

**Effort:** ~1–2 weeks (the checks are simple; finding all the loops and
testing timeout behavior is the work). **Unlocks:** item 5's validation reach,
plus retiring `/tmp`-watchdog patterns everywhere.

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

### 4. Tier-2 numeric kernels for special functions

**What:** numeric `evaluate`/`N()` implementations for the highest-value shell
heads: Gauss hypergeometric ₂F₁ (and ₁F₁), elliptic integrals K/E via the
AGM (the AGM gives both nearly free), and `JacobiTheta` (q-series converge
extremely fast; theta gives Dedekind eta and the modular functions almost
free).

**Why:** 567 corpus entries are skipped in numeric validation because their
heads have no kernel ("not-evaluable"); each kernel converts a family of
shells into computable functions *and* turns a swath of shipped identities
into verifiable, numerically-usable knowledge. Fungrim's own corpus documents
the implementations (series and AGM representations are entries in
`data/fungrim/corpus/`).

**Effort:** ~1 week per family, independent of each other. Follow the
established bignum-kernel pattern from the B23 work
(`numerics/special-functions.ts`: machine + bignum kernels, guard digits,
`numericApproximation` gating).

### 5. Per-head aggregated rule dispatch

**What:** close the loaded-simplify benchmark gap: with the 1,350-rule
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

### 6. Corpus refresh from live fungrim.org + upstream contributions

**What:** the corpus source (the published fork
[`arnog/fungrim`](https://github.com/arnog/fungrim), pinned by commit in
`data/fungrim/MANIFEST.json`; its `master` tracks upstream) mirrors an
upstream state from ~2019–2021. The live fungrim.org has more entries and —
important for shell quality — more `SymbolDefinition` domain tables (only 48
of 228 in the pinned tree have them; signature inference covers the rest).
Refresh = `git pull upstream master` in the fork, rebase `grim2mathjson`,
re-run the translator (seconds, deterministic), review the corpus diff,
re-validate.

**Status:** the two malformed upstream entries (`6c2b31`/`e54e61`
Equal-times-expression; plus the `Element(w, tau)` ×24 typo in
jacobi_theta.py) have been reported upstream. Offering the `grim2mathjson`
translator as an upstream PR remains open — goodwill, and a sync path for
future refreshes.

**Effort:** ~2–3 days for the refresh + re-validation cycle.

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
