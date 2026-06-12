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
each family). **Residual — ✅ done (2026-06-12):** the Stage-2 watchdog,
`FUNGRIM_SKIP_IDS` denylist, and the structural representation/derivative
skips are retired; the harness runs the full {none, real-simple} slice
unattended (1,227 entries, 129 s, `ce.timeLimit = 1000` per evaluation).
Doing so exposed and fixed two more unbounded paths: nested numeric
integration through compiled code (`5b31ee`, ∫∫-Catalan — fixed by ambient
deadline inheritance in `interruptible.ts`) and symbolic differentiation
width blow-up (`8e8a59`, r-th derivative of LambertW, REVIEW.md G8 — fixed
by a strided deadline check in `differentiate()`). Entries with instances
380 → 622; True instances 1,089 → 1,363.

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
derivatives (r ≥ 1) stay symbolic. The z ≥ 1 part of this residual
is now a concrete blocker — see item 9.

**Payoff measured (2026-06-12):** of the 130 kernel-head entries in the
Stage-2 {none, real-simple} slice (all previously shell-head-skipped,
not-evaluable by construction), 117 now run and 115 instances verify True,
0 False (49 instances remain not-evaluable: other shell heads inside,
∫/lim representations beyond quadrature reach, theta derivative orders).
Measuring this also surfaced two real engine bugs, both fixed: `2^i`
canonicalized to `1` (exact-power fold ignored the imaginary part) and
`BoxedSymbol.N()` inverted `holdUntil: 'never'` (i/e/∞ never resolved
under `N()`).

### 10. Unsound `x/√(x²) → 1` simplify rewrite — SOUNDNESS

**What:** `simplify()` rewrites `x/√(x²)` to `1`, silently dropping
`sign(x)` (sound only for x > 0). Repro:
`ce.box(['Divide', 'x', ['Sqrt', ['Power', 'x', 2]]]).simplify()` → `1`
(same for `['Multiply', 'x', ['Power', ['Power','x',2], ['Rational',-1,2]]]`).
Note `√(x²)` *alone* simplifies soundly to `|x|`, so the culprit is a
quotient/product power-combination rule, not the radical rule. The `D`
evaluate handler simplifies its output, so the unsoundness propagates:
`D(√(x²)).evaluate()` → `1` and `D(1/√(c·x²)).evaluate()` → `−1/(x²√c)`
(sign-wrong for x < 0).

**Why:** found by the Rubi harness as a cluster of *false* "solved-wrong"
verdicts — driver antiderivatives identical to Rubi's reference answers
failed verification because the checker's symbolic derivative was wrong on
x < 0. The harness now uses numeric central differences as a workaround
(`scripts/rubi/benchmark.ts`); any other derivative-dependent code path is
still exposed. **Snapshot-gated:** measure blast radius before landing
(established canonical outputs may rely on the unsound form).

**Acceptance:** repro returns `sign(x)`-correct form (e.g. `x/|x|` or
`sign(x)`); `D(√(x²))` evaluates to a sign-correct derivative; snapshot
churn reviewed; the Rubi benchmark can optionally re-enable symbolic-D
verification as a cross-check.

### 9. ₂F₁ analytic continuation for z ≥ 1 — follow-on to item 4

**What:** extend `hypergeometric2F1` (`numerics/special-functions.ts`,
~line 2120) past the z = 1 branch point: the real-axis cut z > 1 (where
₂F₁ is complex-valued; principal branch = limit from below, the standard
z − i0 convention) and the complex region outside |z| ≤ 0.8 ∪ Pfaff. The
standard ladder slots into the existing transformation chain: the 1/z and
1/(1−z) Γ-connection formulas (A&S 15.3.7/15.3.8, with the same
degenerate-integer-parameter caveat the 1−z branch already documents),
composed with the Pfaff/Euler maps already implemented.

**Why now:** this is the single biggest verification blocker for the Rubi
integration (docs/rubi/RUBI.md): Rubi rule RHSs emit
`Hypergeometric2F1(…, 1 + d·x/c)` — argument > 1 for positive x and
parameters — so the antiderivative-vs-integrand check has no evaluable
sample points. **35 of 200 problems (17.5%) in the section-1.1.1 benchmark
are "not-evaluable" for exactly this reason**, and the share grows in later
chapters. It also closes part of the 567 Fungrim Stage-2 "not-evaluable"
entries (item 4 residual).

**Acceptance:** (a) reference values against mpmath/Mathematica for
z ∈ {1.5, 3, −2+4i, 10} on generic and near-degenerate parameters, added
to `special-functions.test.ts`; (b) re-run
`npx tsx scripts/rubi/benchmark.ts --rubi "data/rubi/corpus/1 Algebraic functions/1.1 Binomial products" --chapter "1 Algebraic functions/1.1 Binomial products/1.1.1 Linear" --sample 200`
and confirm the `not-evaluable` bucket drops substantially (current
standing in `scripts/rubi/rubi-111-s200.json`: 128 correct / 35
not-evaluable / 24 unsolved).

**Effort:** ~2–4 days (the formulas are standard; the work is branch
conventions and the degenerate-parameter cases).

### 11. Deadline checks in `simplify()` — follow-on to item 2

**What:** item 2 made *evaluation* loops deadline-aware; `simplify()` never
checks `ce._deadline`, and single calls on radical-tower expressions (~100
leaves) were observed running for minutes during Rubi rule-condition
evaluation. The Rubi layer works around it with a leaf-count cap
(`SIMPLIFY_LEAF_CAP = 120` in `scripts/rubi/rubi-utils.ts`), which trades
correctness (predicates go fail-closed on big expressions).

**How:** arm/check the deadline in the simplify main loop
(`boxed-expression/simplify.ts` already counts steps — add a strided
`checkDeadline`), mirroring the item-2 pattern. Acceptance: a
`timeout.test.ts` case for simplify; remove or raise the Rubi-side cap.

### 12. `antiderivative.ts` correctness fixes (Rubi Phase-0 findings)

**What:** the built-in integrator — still the user-facing `Integrate` path
and the Rubi driver's fallback — has reproducible bugs surfaced by the Rubi
test-suite baseline (`scripts/rubi/baseline-ch1-500.json`, seed 42):

- `∫(a + b·x⁴)/x⁶ dx` returns `−b/x`, silently **dropping the a-term**
  (same family: `/x⁷`). Term-splitting bug.
- `∫x⁶/(1−x⁶) dx` returns an incomplete partial-fraction result (missing
  arctan/log terms).
- 6 stack overflows (`RangeError`) on quadratic/quartic trinomial products
  — runaway recursion between integration heuristics.
- one problem ran 156 s uninterruptibly (pre-item-2 measurement; re-check).

**Why:** silent wrong answers from a shipping code path outrank missing
features. The 72k-problem Rubi suite + `scripts/rubi/benchmark.ts` (without
`--rubi`) is now a ready-made regression harness for any fix.

### 13. Small engine follow-ups (batch)

- **`ce.number()` hangs on malformed input:** passing a MathJSON array
  (e.g. `['Rational', 1, 2]`) makes it spin forever — cost a long debugging
  hunt in the Rubi driver. Guard the argument type and throw. (~1 h)
- **`AppellF1` numeric kernel:** Rubi Chapter-1 RHSs emit it (4/200 sample
  problems not-evaluable solely for this); two-variable hypergeometric,
  simple double-series for |x|,|y| < 1 would cover verification sampling.
  Natural companion to item 9, lower priority. (~1–2 days)
- **Polynomial helpers reject parameter-divided coefficients:**
  `polynomialDegree`/`getPolynomialCoefficients` return −1/null for
  `d²/b·x²`-style coefficients. The Rubi layer has its own x-aware versions
  (`polyDegreeX` etc. in `scripts/rubi/rubi-utils.ts`) that could migrate
  into `boxed-expression/polynomials.ts` if engine consumers
  (`antiderivative.ts` partial fractions, item 12) want the tolerance.
  Optional. (~1 day + snapshot review)

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
