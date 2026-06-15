# Compute Engine — Roadmap

**Last updated:** 2026-06-14. Items 2 (interruptible evaluation), 4
(Tier-2 numeric kernels), 9 (₂F₁ analytic continuation), 10 (x/√(x²)
soundness), 11 (deadline checks in simplify), 12 (antiderivative
correctness), 13 (small engine follow-ups), 14 (incomplete elliptic
integrals), 15 (fractional-power principal-branch soundness), and 16
(factor()↔mul canonicalization loop + `x^(-1/2)` unification)
completed — prerequisites for the Rubi integration (`docs/rubi/RUBI.md`).

**Rubi status (the consumer driving items 2/4/10/15):** R1 cleared
(section 1.1.1 ~98%) and **R2 gate cleared** — the authoritative full-Chapter-1
exhaustive run measured 90.0% (the committed `Numer/Denom` + upstream-1.1.3.6
fixes lift 1.1.3 from 85.7% to 92.5%, ≈91.3% overall). Since then: native
symbolic-integration coverage (exact partial fractions incl. repeated factors,
radical / √-of-linear integration) and a 1.3.1 rational native-fallback in the
driver. **The Rubi rule driver is now packaged as an opt-in entry point** —
`@cortex-js/compute-engine/integration-rules` exposing `loadIntegrationRules(ce)`,
which the `Integrate` evaluator consults before the built-in antiderivative
(shipped in four phases: engine hook + module move, bundle compaction,
build/exports, CI freshness gate). Remaining coverage gaps and packaging
follow-ups (consumer guide, larger bundle compaction, corpus beyond Chapter 1)
are tracked in `docs/rubi/RUBI.md` §5. Engine-side, the next genuinely new
capability remains item 7 (analytic-property metadata store); items 1/5 are
the near-term Fungrim/dispatch follow-ons.

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

**Scope note — this item is the ENGINE evaluation loops only.** The Rubi
integration driver had its own unbounded paths this item does not cover; both
are now resolved (2026-06-13):
- The matcher (`scripts/rubi/match.ts`) is deadline-threaded (strided
  `checkDeadline` in `m()`; defensive — rarely blows up in practice).
- The minutes-long hangs (1.1.2.2#425 ran 422 s) were NOT a deadline gap but
  an **engine canonicalization infinite loop**: `factor()` → `mul(common,
  add(...))` → canonical `mul` re-distributes `common` → `toNumericValue` →
  `factor()` → … forever, on sums with irrational terms. `factor`
  (un-distribute) and canonical `mul` (distribute) are inverse operations
  with no fixed point on those forms. **Fixed** in `factor.ts`: build the
  factored product with a non-distributing `ce.function('Multiply', …)`
  instead of the expanding `mul()`. General engine fix (#425 422 s → 51 ms;
  full 1.1.2.2 section 1018/1071, slowest 9.5 s). Consequence: `factor()`
  now keeps radical content factored (`√3(√2x+x)` → `√3·x·(1+√2)`); affected
  simplify tests updated. Details in `docs/rubi/RUBI.md` §5.
- Related engine canonicalization fix the same day: `Power(u,-1/2)` now
  canonicalizes to `Divide(1, Sqrt(u))` (was a Power node, not unifying with
  `1/√u`), plus the `antiderivative()` recognizer matches the current
  `Divide(1,Sqrt(q))` form — recovers ∫1/√(1-x²)→arcsin and family.

### 3. ~~CI for the corpus pipeline~~ — ✅ done (2026-06-12)

**Outcome:** `corpus-pipeline` job in `.github/workflows/test.yml` with two
steps: (a) the Stage-1 box-check (`scripts/fungrim/validate.ts`, ~2 s, exit
gates on ≥99%); (b) `scripts/fungrim/artifact-freshness.ts` — recompiles a
deterministic 25-rule stride sample of the checked-in artifact through the
full compiler pipeline (guards, orientation, scratch-engine self-test) and
fails on any skip or field drift.

**Found on first wide run (150-sample):** `fungrim:7ea1ad`
(CarlsonRC(−1,1) specific value) failed self-test — the rule fired but
`isEqual` declared two *equal* complex constants unequal. Root cause:
`NumericValue.isZeroWithTolerance` hard-rejected any nonzero imaginary
part (`im !== 0 → false`), so a 1-ulp imaginary residue in the difference
made `eq()` return a definitive (unsound) `false`. Fixed in both
machine/big numeric values (tolerance now applies to the imaginary part
too); the 150-sample freshness run is clean.

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

### 10. ~~Unsound `x/√(x²) → 1` simplify rewrite~~ — ✅ done (2026-06-12)

**Outcome:** the culprit was `Product.mul()`
(`boxed-expression/arithmetic-mul-div.ts`): it folded
`(base^r)^e → base^(r·e)` unconditionally, so `x · (x²)^{−1/2}` collapsed
to `x⁰ = 1`. The fold is now gated by the same soundness conditions
`canonicalPower()`/`pow()` already used: outer exponent an integer, inner
exponent an odd integer (sign-preserving), or base known non-negative.

- Repro now stays sign-correct: `x/√(x²)` no longer simplifies to `1`
  (and still folds to `1` for a symbol assumed positive);
  `D(√(x²)).evaluate()` → `x/√(x²)` (= sign(x)).
- **Blast radius: zero** — the full suite shows no snapshot churn from
  this change (regression tests in `simplify.test.ts`, "SIGN-PRESERVING
  POWER FOLDING").
- Note: `√(x²) → |x|` still only fires at top level (simplify
  deliberately does not recurse into Divide/Multiply operands), so the
  repro keeps the `√(x²)` form rather than rewriting to `x/|x|`.

### 9. ~~₂F₁ analytic continuation for z ≥ 1~~ — ✅ done (2026-06-12)

**Outcome:** `hypergeometric2F1Complex` (`numerics/numeric-complex.ts`)
now covers (almost) the whole plane: it picks among the six Kummer maps
(direct, Pfaff z/(z−1), and the Γ-connection formulas in 1−z, 1/z,
1/(1−z), 1−1/z — A&S 15.3.4–15.3.9) the one with the smallest |w|,
accepting |w| ≤ 0.99 with a scaled term budget. Degenerate parameter
differences (a−b ∈ ℤ, c−a−b ∈ ℤ) route to a non-degenerate map when one
converges, else are handled by symmetric ±1e−6 parameter perturbation
(~1e−9 accuracy). On the cut z ∈ (1, ∞) the principal branch is the limit
from below (z − i0, matching mpmath/Mathematica) — implemented by forcing
`im = −0` so `atan2` lands on the right side. Real z > 1 reaches the
complex kernel through the existing applyN NaN-cascade; this also rescued
the old z ∈ (0.95, 1) degenerate-gap NaN. Machine precision against
mpmath on generic/degenerate/near-degenerate/cut/far-cut points
(`special-functions.test.ts`, "ANALYTIC CONTINUATION z ≥ 1").

**Residual:** a thin sliver around z = e^{±iπ/3} (all six maps have
|w| ≈ 1) stays NaN; doubly-degenerate near-singular points (e.g.
₂F₁(½,2;3/2;1.0001)) get ~1e−8 via the perturbation path; bignum kernel
remains real-axis z < 1 only.

**Benchmark note:** the 35 "not-evaluable" problems in the 1.1.1 sample
turned out to be mostly mistranslated inverse-hyperbolic names
(`Arcsinh`/`Artanh`… vs the engine's `Arsinh`/`Artanh` — fixed in
`scripts/rubi/wl-parser.ts`, corpus regenerated) plus incomplete elliptic
integrals, not ₂F₁; after the fixes the sample stands at **146 correct /
16 not-evaluable / 25 unsolved** (was 128/35/24). The remaining 16 are
EllipticF/EllipticPi (no kernels — future work) and 2 AppellF1 (item 13).

### 11. ~~Deadline checks in `simplify()`~~ — ✅ done (2026-06-12)

**Outcome:** `BoxedFunction.simplify()` now arms the engine deadline (same
`withDeadline` wrapper as `evaluate()`); `simplifyExpression()` (the
per-node choke point) and `polynomialDivide()` (the actual hot loop —
the cancel-common-factors rule's Euclidean `polynomialGCD` on
radical-coefficient polynomials ran minutes per call) check it. The rule
engine's catch-all handlers in `rules.ts` rethrow `CancellationError`
instead of swallowing timeouts as "rule failed". A previously-minutes-long
`Divide` of two expanded `(√2·x+√c)ⁿ` polynomials now throws
`CancellationError` at `ce.timeLimit` (coverage in `timeout.test.ts`,
"Simplify"). Rubi-side: `SIMPLIFY_LEAF_CAP` raised 120 → 500 and
`safeSimplify` catches the cancellation (fail-closed, unsimplified), so
predicates no longer trade correctness for time.

### 12. ~~`antiderivative.ts` correctness fixes~~ — ✅ done (2026-06-12)

**Outcome (regression tests in `calculus.test.ts`, "INTEGRATION
REGRESSIONS"):**

- **a-term drop:** root cause was an *engine* bug, not just integration:
  `polynomialGCD` treated a null coefficient extraction (Euclid remainders
  with parameter-divided coefficients like `(a/b)x²`) as "zero polynomial",
  returning a non-divisor as the GCD (gcd(a+bx⁴, x⁶) → `x⁴ + a/b`);
  `cancelCommonFactors` then cancelled with it, silently dropping terms.
  Fixed both (null → gcd 1; cancel now verifies zero remainders), and
  added a last-resort term-wise numerator split in the `Divide` branch
  (only accepted when every sub-integral resolves). `∫(a+b·x⁴)/x⁶` →
  `−a/(5x⁵) − b/x`.
- **Incomplete partial fractions:** the simple-poles branch applied the
  cover-up formula even when the real roots didn't account for the full
  denominator degree (1−x⁶: dropped both irreducible quadratics) and
  ignored the leading coefficient (∫1/(2x²−2) was ×2 off). Now gated on
  full degree and uses residues Aᵢ = 1/Q′(rᵢ). A new
  `numericPartialFractions` fallback (Durand–Kerner roots over
  numeric-coefficient denominators; conjugate pairs → log + arctan; the
  decomposition is verified a-posteriori at off-root test points)
  completes `∫x⁶/(1−x⁶)`, `∫1/(x⁴+1)`, and expanded repeated-root
  denominators like `1/(x²−2x+1)`.
- **Stack overflows:** two runaway recursions fixed — Case A
  "divide first" looped when the denominator was x-free (quotient
  re-canonicalizes to the same `Divide(P, c)` shape), and when symbolic
  cancellation left the remainder's degree structurally unreduced
  (coefficients algebraically zero but not structurally). All six
  `RangeError` problems from the ch1-500 baseline now terminate (inert).
- **156 s problem:** gone — re-run of the seed-42 ch1-500 baseline:
  max problem time 156 s → 3.6 s, errors 6 → 4 (1 RangeError remains on a
  *symbolic-exponent* integrand `x^m(a+bx^(2+2m))²` — different bug class;
  3 are `CancellationError` timeouts, i.e. bounded by design), correct
  13 → 18, wrong 3 → 2 (both residual "wrong" are verification artifacts:
  `1/x¹⁰⁰` central-difference overflow near 0, and one correct-but-
  unverifiable form).
- **Symbolic-exponent RangeError (residual, fixed 2026-06-12):** the
  by-parts depth cap was defeated because `antiderivativeWithByParts`
  falls back into the full `antiderivative()`, re-entering by-parts with
  a fresh depth of 0 — and symbolic exponents provide no shrinking
  measure along that cycle. Three fixes: a module-level cap on TOTAL
  by-parts stack frames; folding products of index powers with symbolic
  exponents (`x^m·x^(2m+2) → x^(3m+2)` — canonicalization only folds
  numeric ones); and an expand-and-integrate fallback tried AFTER
  by-parts (so existing antiderivative forms are unchanged).
  `∫x^m(a+bx^(2+2m))² dx` now solves and D-verifies. ch1-500 re-run:
  correct 13 → 37, wrong → 1, errors → 3 (all `CancellationError`
  timeouts — zero RangeErrors).

### 13. ~~Small engine follow-ups (batch)~~ — ✅ done (2026-06-12)

- **`ce.number()` malformed input** — ✅: a malformed *array* argument
  (anything but a 2-element number/bigint pair, e.g. the MathJSON
  expression `['Rational', 1, 2]`) now throws with a pointer to
  `ce.box()`. Non-array objects (`{re, im}`, `{rational}` shapes) still
  fall through to `_numericValue` as before. Tests in
  `expression-api.test.ts`.
- **`AppellF1` numeric kernel** — ✅: machine + complex double-Pochhammer
  series (`appellF1` in `numerics/special-functions.ts`,
  `appellF1Complex` in `numerics/numeric-complex.ts`), |x|,|y| < 1 plus
  terminating-index extensions; declared in `library/special-functions.ts`
  with the applyN cascade; mpmath-validated tests in
  `special-functions.test.ts`.
- **Polynomial helpers / parameter-divided coefficients** — deferred
  (optional, snapshot-review risk). The dangerous interaction — Euclid
  remainders with such coefficients corrupting `polynomialGCD` — is fixed
  by the item-12 null-guard; migrating the Rubi layer's x-aware versions
  into `polynomials.ts` remains available if a consumer needs the
  tolerance.

**Discovered along the way (Rubi scripts layer):** the WL translator
mapped the inverse hyperbolic heads to nonexistent engine symbols
(`ArcSinh → Arcsinh` instead of `Arsinh`, etc.), which silently never
evaluated — this, not ₂F₁, was most of the 1.1.1 "not-evaluable" bucket.
Fixed in `scripts/rubi/wl-parser.ts`; chapter-1 corpus regenerated
(name-only diff). Remaining not-evaluable results are incomplete elliptic
integrals (`EllipticF`/`EllipticPi` kernels — candidate next item).

### 14. ~~Incomplete elliptic integrals via Carlson symmetric forms~~ — ✅ done (2026-06-12)

**Outcome:** machine-real + complex Carlson kernels
`carlsonRF/RC/RD/RJ` (`numerics/special-functions.ts`,
`numerics/numeric-complex.ts`) — duplication-theorem algorithms with
mpmath's series tails; RC gets a small-|y−x| series fast path (the
acos/acosh forms lose half the digits near degeneracy, which capped R_J
at ~4e-11; now ~1e-15); real R_J/R_C return Cauchy principal values for
negative `p`/`y` (DLMF 19.20.14 / 19.2.20); complex R_J only evaluates
the configurations where duplication is valid (mpmath's criterion), NaN
otherwise. On top of these: `EllipticF(φ,m)` (new head),
`EllipticE(φ,m)` (second optional argument on the existing head),
`EllipticPi(n,m)` / `EllipticPi(n,φ,m)` (new head) — Mathematica
argument conventions, parameter m = k², quasi-periodic extension beyond
|Re φ| > π/2, applyN machine→complex cascade. Validated against mpmath
1.4 (worst rel. err. ~1e-15 machine, ~7e-16 complex, including the Rubi
corpus shapes: m > 1, m < 0, complex amplitudes from ArcSin(s>1));
mpmath-derived tests in `special-functions.test.ts`. The Fungrim
artifact was regenerated (EllipticPi shell pruned now that it is a
built-in; rule set byte-identical otherwise).

**Measured effect (Rubi 1.1.1 seed-42 200-sample, with the scripts-layer
`posAux` Divide fix in the same session):** solved-correct 146 → 161
(73% → 80.5%), not-evaluable 16 → 4 (remaining: one AppellF1 outside the
|y| < 1 kernel domain, two integrands with an empty real domain that the
sampling verifier cannot evaluate anywhere, one ArcTanh real-domain
gap), solved-wrong 4 → 1 (the survivor is the `1/x¹⁰⁰` central-difference
verification artifact — the antiderivative is correct).

**Known gap (pre-existing, separate):** CE's `Arcsin(x).N()` returns NaN
for real |x| > 1 instead of continuing to the complex value, so
`EllipticF(ArcSin(1.2), m)` only evaluates where the amplitude is real.
The kernels themselves handle complex amplitudes (validated directly).

### 15. ~~Fractional-power principal-branch soundness in `Product`~~ — ✅ done (2026-06-12)

**What:** the Rubi 1.1.1 benchmark (quartic-root elliptic chains,
`∫1/(√(a+bx)·(c+dx)^(3/4))`) exposed a family of unsound rewrites in
`Product` (`boxed-expression/arithmetic-mul-div.ts`) that silently move
negative signs and factors across fractional powers — each one a complex
phase error (`(−u)^(1/4) ≠ −u^(1/4)`; the −1 is `e^{iπ/4}`):

- **`Product.mul` Negate branch** extracted `−1` from `(−u)^exp`
  regardless of `exp` (also wrong for even integer exponents). Now: odd
  integer → sign flip, even integer → no flip, fractional → the `Negate`
  term is tallied opaquely.
- **Coefficient extraction** (`toNumericValue` + `coef.pow(exp)`)
  applied NumericValue's real-root convention to negative coefficients
  under even fractional powers. Now gated (`evenRootOfNegative`).
- **`toNumericValue` Root branch** (`boxed-function.ts`): same
  real-root-convention extraction for even roots of negative
  coefficients — now returns the expression unsplit. (`Sqrt` is exempt:
  `NumericValue.sqrt` returns the principal imaginary value.)
- **`Product.mul` Divide branch** split `(u/v)^r → u^r·v^(−r)` for
  fractional `r` with unknown-sign `v` (phase conjugation when `v < 0`).
  Now split only for integer `r` or known non-negative `v`.
- **`groupedByDegrees`** merged same-exponent terms `u^r·v^r → (uv)^r`
  for fractional `r` regardless of signs. Now merged only for integer
  exponents or known non-negative terms (groups created by an
  unmergeable term are sealed).

**Blast radius: zero** — full suite green, no snapshot churn, numeric
checks like `(−16)^(1/4)·81^(1/4)` now return the principal complex
value consistently.

**Found via** per-problem rule-chain triage (`scripts/rubi/triage.ts`,
new) of the 1.1.1 sample's solved-wrong bucket. The remaining Rubi-side
elliptic phase mismatches (3 problems/200) are a Rubi-layer follow-on
(`docs/rubi/RUBI.md`), not an engine soundness issue.

### 16. ~~`factor()`↔`mul` canonicalization loop + `x^(-1/2)` unification~~ — ✅ done (2026-06-13)

**What:** the Rubi exhaustive-run blockers (1.1.2/1.1.3 problems hanging
2–12 min, worst 736 s) and the broken ∫1/√(1-x²)→arcsin family turned out to
be two general engine canonicalization bugs:

- **Infinite loop between `factor()` and canonical `mul`.** `Product.mul` →
  `toNumericValue()` on an `Add` → `factor()` (to pull out common factors) →
  `factor` returned `mul(common, add(newTerms))`, but canonical `mul`
  **re-distributed** `common` back over the sum, reproducing the original
  `Add` → `toNumericValue` → `factor` → … forever, on sums with irrational
  terms (e.g. `½·x·√(a+bx²) + a·artanh(…)/(2√b)`). `factor` (un-distribute)
  and `mul` (distribute) are inverses with no fixed point. **Fix:** `factor()`
  builds the factored product with a non-distributing
  `ce.function('Multiply', …)` instead of the expanding `mul()`. Found via
  engine-primitive probing + a deep-recursion stack dump (the "current op"
  flipped between `canonicalMultiply`/`canonicalAdd` every run — the tell of
  mutual recursion). **Effect: 1.1.2.2#425 422 s → 51 ms; full 1.1.2.2
  section 1018/1071, 0 errors, slowest 9.5 s.** Consequence: `factor()` now
  also keeps radical content factored (`√3(√2x+x)` → `√3·x·(1+√2)`, not
  `(√3+√6)x`) — a deliberate direction change (aligns with the `factor()`
  test.todo); affected simplify snapshots/assertions updated.
- **`x^(-1/2)` did not unify with `1/√x`.** `Power(u,-1/2)` stayed a Power
  node while `1/√u`, `√u^(-1)`, `1/u^(1/2)` all canonicalized to
  `Divide(1, Sqrt(u))`, so `D(arcsin x) = (1-x²)^(-1/2)` did not match the
  integrand `1/√(1-x²)`, and `antiderivative()` returned it unevaluated.
  **Fix:** `arithmetic-power.ts` canonicalizes negative unit-fraction
  exponents `a^(-1/n) → 1/Root(a, n)` (branch-safe on the principal branch),
  and `antiderivative.ts`'s ∫1/√(quadratic) recognizer now matches the
  current `Divide(1, Sqrt(q))` form (it only knew the old `Sqrt(1/q)` form
  the `1/√u → √(1/u)` fold used to produce before that fold was gated for
  soundness — item 15 family). Recovers arcsin/arsinh/arcosh.

**Blast radius:** small — full suite green apart from the deliberately-updated
radical-simplify snapshots/assertions and one unrelated OEIS network test.
Both bugs were general (any consumer constructing such expressions hit them),
surfaced by Rubi. Details in `docs/rubi/RUBI.md` §5.

### 17. `big-decimal` performance & completeness (mpmath-inspired)

**What:** a backlog of improvements to the arbitrary-precision decimal core
(`src/big-decimal/`), drawn from a study of [mpmath](https://github.com/mpmath/mpmath)
(the arbitrary-precision library SymPy uses). mpmath is base-2 throughout and
gets most of its breadth by composing a hypergeometric engine + gamma; CE's
`big-decimal` is base-10 (a deliberate decimal.js-replacement choice) and the
special-function breadth correctly lives one layer up in
`numerics/special-functions.ts`. The lessons split cleanly into kernel-level
performance and elementary-completeness items. Standing list of next steps
(ranked by ROI), extending the README's "Potential Future Improvements"
(`src/big-decimal/README.md`):

All seven items below landed 2026-06-13 (full big-decimal suite 736 tests +
9017 engine tests green; typecheck clean). Details after the list.

1. **Base-2 internal transcendental kernel** — ✅ *done* — promoted to `src/`
   (see 17.1). 2–4× faster transcendentals at identical accuracy.
2. **AGM-based `ln`** at high precision — ✅ *done* (17.2). Sasaki–Kanada AGM,
   precision-gated above ≈1250 digits; ~2.3× faster ln at 4000 digits.
3. **Binary splitting** for constants — ✅ *done* (17.3). Binary-split `ln 2`
   (lifts the AGM precision cap). **Finding:** binary splitting does **not**
   apply to `exp`/trig of *irrational* arguments (the BS products blow up to
   `N·bits` bits); that needs *rectangular splitting* (Smith's method),
   deferred as a separate larger item.
4. **`giant_steps` precision-doubling** — ✅ *done* (17.4) for the `fpln` Newton
   (1.4–3.9× faster ln). **Findings (benchmarked):** the division-free
   reciprocal is **not** worth it — V8's Burnikel-Ziegler `bigint` division is
   already the fastest primitive (1–53µs vs sqrt's 1.5–548µs); and `fpsqrt` is
   already fast and well-seeded, so `giant_steps` there gives diminishing
   returns — left as-is.
5. **On-demand π via Chudnovsky** + downshift cache — ✅ *done* (17.5). Removes
   the ~2350-digit π ceiling (binary-splitting Chudnovsky beyond the table),
   for both `fppi` (trig kernel) and `BigDecimal.PI`. Cached `e`/`ln2` as public
   constants deferred (no consumer + load-order hazard; `ln 2` exists internally
   via table + binary splitting).
6. **Elementary completeness gaps** — ✅ *done* (17.6): `expm1`, `log1p`, `log2`,
   `asinh`, `acosh` (stable near 1 via `2·asinh(√((x−1)/2))`), `atanh`,
   `nthRoot`. Small-argument accuracy handled by precision compensation.
7. **Directed rounding modes** — ✅ *done* (17.7): `divToward`/`sqrtToward`
   (`'floor'`/`'ceiling'`), rigorous outward-rounded bounds. The enabling
   primitive for a future interval-arithmetic mode (`+`/`−`/`×` are exact in
   BigDecimal, so only div/sqrt need directed variants). The `iv` layer itself
   remains deferred until a consumer needs it.

**17.x outcomes (2026-06-13).**

**17.2 AGM ln** — `fplnAGM` (`utils.ts`) uses ln(s) = π/(2·AGM(1, 4/s)) with
`s = value·2^m` large. Critical fix: compute `AGM(1, L)` with `L = s/4` *large*
(via homogeneity `AGM(1,4/s) = AGM(1,L)/L`) — the naïve tiny `4/s` argument
carries only ~bits/2 significant bits at the fixed-point scale and halved the
accuracy. Gated at `LN_AGM_MIN_BITS = 4200` (measured crossover ≈1250 digits;
below it the giant_steps Newton wins).

**17.3 binary-split ln 2** — `ln2ChudnovskyBits` sums `2·atanh(1/3) =
(2/3)·Σ (1/9)^k/(2k+1)` by binary splitting (rational terms). Makes ln 2 cheap
at any precision, so the AGM has no upper precision bound (one-shot high-precision
ln no longer regresses bootstrapping ln 2).

**17.4 giant_steps `fpln`** — the Newton ramp runs each step at scale `2^wp`
with `wp` doubling from the seed accuracy toward `bits`, so the dominant `fpexp`
is cheap early and full only at the end (~2 full `fpexp` instead of ~6).

**17.6 `acosh` near 1** — uses `acosh(x) = 2·asinh(√((x−1)/2))` to avoid the
catastrophic cancellation of the naïve `ln(x+√(x²−1))` near `x = 1`.

**17.1 Base-2 kernel — experiment result (2026-06-13).** The base-10
fixed-point kernel scales by `10^p`, so every Taylor term and every squaring
does a full-width `bigint` *division* by `scale`. Porting the grid to base-2
(`scale = 2^bits`) turns each into a bit-**shift** (`>> bits`) plus, for series
terms, a small-divisor division by the term index. A/B benchmark
(`benchmarks/big-decimal/kernel-base2-experiment.ts`, faithful base-2 ports of
`fpexp`/`fpsincos` vs the live base-10 kernels, verified bit-identical to a
high-precision `BigDecimal` reference — **0 ULP difference at every precision**):

| precision | exp kernel | exp end-to-end | sin kernel | sin end-to-end |
|---|---|---|---|---|
| 25  | ~2.3× | ~2.3× | ~2.7× | ~2.8× |
| 100 | ~2.3× | ~2.6× | ~2.4× | ~2.8× |
| 500 | ~2.6× | ~2.1× | ~2.7× | ~3.5× |
| 2000 | ~4.1× | ~3.5× | ~2.9× | ~2.7× |

(speedup = base-10 time / base-2 time; >1 means base-2 is faster). The win
**includes** decimal↔binary conversion at the API boundary and holds even at
p=25 — refuting the worry that conversion overhead would cancel it at low
precision — and **grows with precision** (~4× at p=2000). "end-to-end" times
the full `decimal → binary → kernel → decimal` round-trip.

**Promotion (landed 2026-06-13).** All kernels in `utils.ts`
(`fpmul`/`fpdiv`/`fpsqrt`/`fpexp`/`fpln`/`fpsincos`/`fpatan` + `fppi`, plus a
new `bitLength` and bit-based `estimateLnSeed`/`bigSqrtSeed`/`cbrtSeed`) now
take `bits` and operate on the binary grid `scale = 1n << bits`; the
`transcendentals.ts` bridge (`toFixedPoint`/`fromFixedPoint`) converts
decimal↔binary once at the boundary, and every caller (sqrt/cbrt/exp/ln/
sin/cos/tan/atan/asin + `ln10Fixed`) threads `bits`. The user-facing
`significand · 10^exponent` representation is unchanged — base-2 is internal to
the kernel. Validation: the full big-decimal suite (667 tests, incl. decimal.js
cross-validation and 100-digit precision-comparison) and the engine numeric
suites (arithmetic/trig/numeric-mode/special-functions, ~2119 tests) pass with
**no snapshot churn**; typecheck clean, no new circular deps. The A/B harness
(`benchmarks/big-decimal/kernel-base2-experiment.ts`) is now self-contained
(carries its own base-10 + base-2 copies) so it stays runnable as a record.

**Remaining items #2–#7 effort:** each ~0.5–2 days.
**Dependencies:** none. **References:** `src/big-decimal/README.md`
(§ Algorithms, § Potential Future Improvements); `src/big-decimal/utils.ts`
header; experiment at `benchmarks/big-decimal/kernel-base2-experiment.ts`.

**17.8 SymPy / mpmath comparison (2026-06-13)** — full report at
`benchmarks/big-decimal/BIGNUM-COMPARISON.md` (CE current vs 0.59.0 vs SymPy
`.evalf` vs raw mpmath, high-precision transcendentals). Headline: CE **leads**
SymPy broadly at ≤100 digits and leads/ties raw mpmath on `sin`/`cos`/`tan`/`atan`
at all precisions; it **trails** on three fronts, which become the prioritized
follow-ups (the "still open" work):

**17.9 `exp` root-cause (2026-06-13) — rectangular splitting was the WRONG
hypothesis.** Investigating the `exp` gap disproved it: the `fpexp` kernel is
~0.65ms at 1000 digits (≈ mpmath 0.44ms), so the kernel is not the bottleneck —
the cost was in higher layers. Two causes found:

- **`ln10` cache thrash — ✅ FIXED.** `ln()` and `exp()` reduce at slightly
  different working precisions; `ln10Fixed` keyed its cache by *exact* bits, so
  the two evicted each other and recomputed `ln(10)` (a full Newton) every call
  — ~6ms of waste inside `pow`. `ln10Fixed` now uses compute-high/downshift-low
  caching (like `fppi`/`ln2`): `BigDecimal.pow(base, non-int)` 9.6 → **4.1ms**,
  `Exp(rational).N()` 6.95 → **~3.4–4.3ms**. (`transcendentals.ts`.)
- **`Exp(x)` → `Power(E, x)` → `exp(x·ln(E))` recomputed `ln(e)≈1` — ✅ FIXED.**
  The numeric `Power(E, x)` path (`boxed-expression/arithmetic-power.ts`) now
  calls `exp(x)` directly for real exponents (complex unchanged). With the
  `ln10` fix, `Exp(rational).N()` 6.95 → **2.74ms** at 1000 digits; `exp(1)`
  reproduces `e` exactly. The residual ~2.7ms is generic CE `Power`/`.N()`
  dispatch overhead, not the bignum kernel (`fpexp` ≈ 0.65ms).

Remaining items:
- **17.13 Trim CE `Power`/`.N()` dispatch overhead** — after the two fixes,
  `Exp(x).N()` is ~2.7ms at 1000 digits vs the bare kernel's ~0.65ms; the gap is
  generic boxed-evaluation machinery (`Power` runs its full special-case
  cascade, plus argument boxing), shared by all operators — **not** the bignum
  core. This is the largest remaining `exp`-vs-mpmath gap and is a CE-evaluation
  optimization (e.g. a fast numeric pre-dispatch), not a big-decimal one.
- **17.10 Tune the AGM `ln` threshold / faster AGM** — `ln` trails mpmath ~0.6×
  at 500–1000 digits because CE's AGM only engages above ~1250 digits
  (`LN_AGM_MIN_BITS`) while mpmath is on AGM earlier.
- **17.11 Division-free `isqrt_fast` for `sqrt`** — revisits 17.4's "leave
  `fpsqrt` as-is": mpmath's reciprocal-sqrt Newton is ~2× faster; lifts `asin`.
- **17.12 r-step / rectangular splitting in `fpexp`** — real but small kernel
  win (~3×); the kernel is <10% of `exp(.N())` time, so low user-facing impact.
  Lowest priority.

**Next up (priority order for the bignum/numeric track):**
1. **17.13** — trim `Power`/`.N()` dispatch (biggest remaining `exp` win, ~2ms;
   CE-eval layer). 2. **17.10** — AGM `ln` threshold (closes the `ln` gap).
3. **17.11** — `isqrt_fast` (`sqrt`/`asin`). 4. **17.12** — `fpexp` r-step
   (kernel polish, lowest impact). Each is independent; none blocks the others.

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

---

## Benchmark findings (June 2026)

Surfaced by the cross-library benchmark in [`benchmarks/`](./benchmarks/)
(CE vs SymPy / math.js / NumPy — see `benchmarks/REPORT.md`). Each is reproduced
against the current build and verified numerically with `mpmath`. None are
regressions vs `0.59.0`; they are pre-existing gaps the suite made visible.

### B1. ~~Special-function `N()` does not honor requested precision~~ — ✅ done (2026-06-13)

`Zeta`/`Gamma` already routed `N()` through bignum kernels (item 4), but the
kernels themselves were buggy and effectively capped near double precision:

- **`Zeta` — the worst case.** `ζ(3)` at `ce.precision = 40` was correct to only
  ~16 digits then diverged. **Root cause:** the Dirichlet-eta acceleration used
  binomial partial-sum coefficients (`d[k] = ΣC(n,i)`, `d[n] = 2ⁿ`) — a *rate-2*
  Euler transform with error `~2⁻ⁿ` — but the term budget `n = 1.3·p` was sized
  for the much faster `(3+√8)⁻ⁿ` Cohen–Villegas–Zagier rate. So `n = 52` at
  p = 40 gave only `2⁻⁵² ≈ 10⁻¹⁶` accuracy.
- **`Gamma` — milder.** `Γ(1/3)` lost its last ~2 digits to rounding accumulated
  across the Stirling series (computed at exactly `p`, no working-precision
  guard).

**Resolved** (`numerics/special-functions.ts`):
- Replaced the eta sum with the **genuine Cohen–Villegas–Zagier Algorithm 1**
  (`(3+√8)⁻ⁿ` convergence, `~0.77` digits/term, numerically stable), so `~1.3·p`
  terms now actually deliver `p` digits.
- Added a `withGuardDigits` wrapper that raises the global `BigDecimal.precision`
  by `SPECIAL_FN_GUARD = 24` digits for the duration of the kernel and rounds
  the (correct) result back to the requested precision. Applied to `bigGamma`,
  `bigGammaln`, `bigZeta`, `bigBeta`, and — opportunistically, same root cause —
  `bigDigamma`/`bigTrigamma`/`bigPolygamma`. Each public kernel is now a guarded
  wrapper over an unguarded `…Core` so internal cross-calls don't compound the
  guard.

Now `ζ(3)`, `ζ(5)`, `ζ(½)`, `Γ(1/3)`, `Γ(1/7)`, `ψ(1)=−γ`, `ψ₂(1)=−2ζ(3)` are
all correct to the full requested precision (verified to 100 digits and via
exact identities — reflection, `ζ(2)=π²/6`, `ζ(−1)=−1/12`). Blast radius: 2
precision-comparison snapshots (Gamma now hits full precision; both updated).
Tests: `special-functions.test.ts` "B1: special functions honor requested
precision".

**`Γ` speed (the B1 residual) — ✅ fixed (2026-06-14), ~11–12× at p=300.**
Profiling showed the gap was **kernel-bound**, not dispatch overhead (unlike
`exp`/item 17.13): `bigGamma` at p=300 was ~1.9 s. Two root causes in the
Stirling-with-shift `gammalnCore` (and the shared `digamma`/`trigamma`/
`polygamma` kernels):
- **Shift undershoot.** The asymptotic Stirling series' smallest term (≈e^{−2πw}
  near k≈πw) sat *right at* the target tolerance when shifting only to
  `w ≈ 0.37·p`, so the series never converged early and ran its full ≈π·w terms,
  each an expensive division by a large Bernoulli rational. Shifting to `w ≈ p`
  drops the floor far below tolerance → the tol break fires after ≈0.4·p terms (a
  measured 3–5× fewer), and `maxTerms` (the Bernoulli table size) was decoupled
  from `π·w` down to ≈0.6·p (≈8× fewer Bernoulli numbers computed).
- **Redundant logarithms.** The shift loop summed `m ≈ 0.37·p` separate `ln(z+i)`
  calls; replaced by one `ln(∏(z+i))` (m cheap mults + 1 log).

- **Unbounded significand growth (the real high-precision killer) — fixed
  2026-06-14.** `BigDecimal.mul` returns the *full* product (it does **not**
  round to the working precision — only `div` does). So every accumulating
  multiply — the shift product `∏(z+i)` and the series' running power `w^{2k}` —
  grew its significand by ~p digits each step, making each successive multiply
  more expensive and the whole kernel ~O(p³). Rounding each running
  product/power back to p digits (`.toPrecision(p)`) keeps all operands at p
  digits. Measured in isolation: the p≈1000 Stirling series dropped from ~6.3 s
  to **33 ms** (≈190×). Applied to all four kernels.

Combined result: `Γ(1/3)` warm at **p=300 ≈ 5 ms** (was ~1.9 s — ~340×) and
**p=1000 ≈ 66 ms** (was ~8.5 s — ~130×); scaling is now ~O(p²·³) (p=2000 ≈
0.32 s). `ψ`, `ψ₁`, `ψ₂` track the same. Full precision preserved — verified to
1000 digits via the reflection formula, `ψ(1/3)−ψ(2/3)=π/tan(π/3)` (a γ-free
digamma identity), and `ζ(2)=π²/6`; zero snapshot movement.

**Two follow-ups surfaced here, tracked separately:** the `EulerGamma` constant
caps at ~858 digits (**B12**), and the unrounded-`mul` significand growth that
caused this is a latent footgun elsewhere in the numeric kernels (**B13**).

### B2. Symbolic (indefinite) integration coverage gaps — ✅ resolved (2026-06-13)

- **Fractional-power / radical integrands return unevaluated** — `∫1/√x`, `∫√x`,
  `∫x²/√(1−x²)`, `∫x/√(1−x²)`: the power rule isn't applied to fractional
  exponents and radical substitutions are missing.
  - ✅ **Done:** `∫√x` → `⅔x^(3/2)` and `∫1/√x` → `2√x`. Root cause: `√x` and
    `x^(−1/2)` canonicalize to `Sqrt(x)` / `Divide(1, Sqrt(x))` (not `Power`
    nodes), so the power rule never matched them; `antiderivative()` now handles
    those two bare-index forms via the power rule with exponent ±½.
  - ✅ **Done:** `∫x/√(1−x²)` → `−√(1−x²)` and `∫x²/√(1−x²)` →
    `½(arcsin x − x√(1−x²))`. A new radical handler in `antiderivative()` (Divide
    branch) covers `∫N(x)/√Q(x)` for `Q` of degree ≤ 2: (a) when the numerator
    is a constant multiple of `Q′`, `∫ c·Q′/√Q = 2c√Q`; (b) for a monomial `xᵐ`
    over `√(c+dx²)`, a reduction `Iₘ = xᵐ⁻¹√Q/(md) − ((m−1)c/(md))·Iₘ₋₂` down to
    the `arcsin`/`arsinh`/`arcosh` base case. So `∫(2x+1)/√(x²+x+1) → 2√(x²+x+1)`
    and the whole `∫xⁿ/√(c+dx²)` family now evaluate.
- ✅ **Non-elementary results now produced.**
  - `∫e^(−x²)` → `(√π/2)·Erf(x)`, and the general Gaussian
    `∫e^(ax²+bx+c)` via completing the square → `Erf` (a < 0) or `Erfi` (a > 0).
    `Erfi` was promoted from a derivative-table-only name to a full operator
    (machine + bignum kernels in `special-functions.ts`, registered in
    `statistics.ts`).
  - `∫cos(ax²)` → `√(π/2a)·FresnelC(√(2a/π)·x)` and `∫sin(ax²)` → Fresnel S
    (reusing the existing `FresnelS`/`FresnelC`).
  - `∫sin(kx)/x` → `Si(kx)` and `∫cos(kx)/x` → `Ci(kx)`. New `SinIntegral` /
    `CosIntegral` operators (machine-precision numeric kernel via the Numerical
    Recipes `cisi` continued fraction, derivatives `sin x/x` / `cos x/x`).
    Bignum precision for Si/Ci is not yet wired (shares the B1 limitation).
  - `∫secⁿx` / `∫cscⁿx` for integer n ≥ 2 via the reduction formulas, e.g.
    `∫sec³x → ½(sec x·tan x + ln|sec x + tan x|)`.
- ✅ **Machine floats leak into otherwise-correct symbolic results — done.**
  `∫1/(x³+1)` now returns exact `⅓·ln|x+1| − ⅙·ln(x²−x+1) + (√3/3)·arctan(…)`.
  Root cause: the irreducible quadratic `x²−x+1` represents its `−x` term as
  `Negate(x)`, which the local `getQuadraticCoefficients`/`getLinearCoefficients`
  extractors rejected (they only handled `Multiply(-1, x)`) — so the symbolic
  partial-fraction path bailed to the numeric Durand–Kerner fallback, which
  emits float residues. Both extractors now unwrap a leading `Negate` into a
  −1 sign. This also fixed the whole class (`∫1/(x²−x+1)`, `∫1/(2−x)`, …).
- ✅ **Nested radicals now denested** — `√(3+2√2) → 1+√2`, `√(7+4√3) → 2+√3`,
  `√(5+2√6) → √2+√3` (`sqrtdenest`). A `denestSqrt` step in `simplifyPower`
  rewrites `√(a+b√c) → √x + sign(b)·√y` (with `x,y = (a±√(a²−b²c))/2`) when
  `a²−b²c` is a perfect square; a pure-float safety check guards the branch.
  Radicands that do not denest over the rationals stay as-is.

**Audit follow-ups (2026-06-13).** A focused CE-vs-SymPy integration probe
(20 cases, CE graded by differentiate-back) after the B2 fixes — CE 14/20 vs
SymPy 20/20 — surfaced the next gaps, in priority order:

- ✅ **Correctness bug: `∫sin²x` was wrong — fixed.** Returned `x/2 + sin(2x)/4`
  (the `cos²` antiderivative). Root cause: the `∫sin²(ax+b)` rule in
  `INTEGRATION_RULES` used `Add` instead of `Subtract` (so it was identical to
  the `cos²` rule); *both* rules additionally dropped the `1/a` factor and the
  phase `b`. Corrected to `∫sin²(ax+b) = x/2 − sin(2(ax+b))/(4a)` and
  `∫cos²(ax+b) = x/2 + sin(2(ax+b))/(4a)`, so the whole family is now exact
  (`∫sin²(2x) → x/2 − sin(4x)/8`, `∫sin²(x+1) → x/2 − sin(2x+2)/4`). Regression
  tests in `calculus.test.ts`.
- ✅ **Float leakage in `∫1/(x⁴+1)` and `∫x·arctan(x)` — fixed 2026-06-13.** Both
  were value-correct (differentiate-back passed) but emitted float coefficients;
  the two causes were independent, and both turned out to be more general than
  the original scoping guessed.

  **(1) `∫1/(x⁴+1)` — symbolic biquadratic partial fractions.** A new
  `tryBiquadraticPartialFractions` (`antiderivative.ts`) handles a biquadratic
  denominator `A·x⁴ + B·x² + C` with no real roots (`q = C/A > 0`) by factoring
  it into two real irreducible quadratics (substitute `z = x²`, discriminant
  `Δ = p²−4q`, `p = B/A`): `Δ < 0` → conjugate quadratics
  `(x²+s·x+t)(x²−s·x+t)` with `t = √q`, `s = √(2t−p)` (e.g. `x⁴+1 →
  (x²+√2x+1)(x²−√2x+1)`); `Δ ≥ 0, p>0` → `(x²+f₁)(x²+f₂)` with
  `f₁,₂ = (p±√Δ)/2` (e.g. `x⁴+5x²+4 → (x²+1)(x²+4)`). The exact partial-fraction
  numerators are solved in closed form (no float-introducing numeric solve) and
  each `(βx+γ)/(x²+bx+c)` piece is integrated by a shared
  `integrateLinearOverIrreducibleQuadratic` helper. A `hasInexactNumber` guard
  defers to `numericPartialFractions` if any radical combination folds to a
  float (CE's `.add`/`.sub` fold irrational number-literal results), so messy
  biquadratics fail safe. Result: `∫1/(x⁴+1)`, `∫1/(x⁴+4)`, `∫x²/(x⁴+1)` (was
  inert), and `∫1/(x⁴+5x²+4)` (was float + numeric noise) are all exact.
  Verified by differentiate-back; `numericPartialFractions` stays the final
  fallback (e.g. `x⁴−1`, real roots + one quadratic, is a separate path).

  **(2) `∫x·arctan(x)` — constant factor in a Multiply denominator.** The leak
  was *not* in the by-parts assembly (the original guess); the by-parts inner
  integral is `∫x²/(2(1+x²))`, whose denominator canonicalizes to
  `Multiply(2, Add(x², 1))` — a `Multiply`, not an `Add`, so
  `getQuadraticCoefficients` (which looks for a bare `x²` factor) missed it and
  it fell to the numeric fallback. The Divide branch now pulls a constant
  (index-free) factor out of a `Multiply` denominator first
  (`∫ N/(c·D) = (1/c)·∫ N/D`), fixing the whole class (`∫1/(2(1+x²)) →
  ½arctan x`, `∫x·arctan x → ½x²arctan x − ½x + ½arctan x`).

  Regression tests for both (with float-free assertions) in `calculus.test.ts`.
- ✅ **Exact partial fractions for any ℚ-factorable denominator — done
  (follow-up).** Extending the biquadratic fix, `trySymbolicPartialFractions`
  handles a denominator that `Factor` splits over ℚ into *distinct* linear and
  irreducible-quadratic factors (a squarefree rational denominator), which the
  earlier symbolic paths missed (all-real-roots cover-up; one linear × one
  quadratic in Case F) — so `∫1/(x⁴−1)`, `∫1/(x⁶−1)`, `∫x/(x⁴−1)` (was
  unevaluated), `∫1/((x−1)(x−2)(x²+1))` all leaked floats via the numeric
  fallback. Now exact: linear factors contribute residues `A·ln|x−r|`
  (A = P(r)/[Q/(x−r)]ᵣ); each irreducible quadratic gets its numerator from
  `P·(Q/F)⁻¹` reduced in the field ℚ[x]/(F) (conjugate-based inverse, all
  rational), integrated by the shared `integrateLinearOverIrreducibleQuadratic`.
  A genuinely ℚ-irreducible quartic (`x⁴+x+1`, whose real factorization needs
  casus-irreducibilis radicals — `Factor` leaves it whole) stays on the numeric
  fallback, value-correct. Tests in `calculus.test.ts`.
- ✅ **`∫ln(x)/x → ½ln²x` and `∫tanⁿx`/`∫cotⁿx` — done.** Added a
  reverse-power-chain recognizer (`∫c·u′·uⁿ = c·uⁿ⁺¹/(n+1)`, tried late so it
  only catches otherwise-unevaluated integrands — e.g. `∫ln(x)/x → ½ln²x`,
  `∫ln²(x)/x → ⅓ln³x`) and `tanⁿ`/`cotⁿ` reduction formulas alongside the
  `secⁿ`/`cscⁿ` ones (`∫tan²x → tan x − x`, `∫tan³x → ½tan²x − ln|sec x|`).
- ✅ **Radical family with a linear term — done.** The radical handler now
  completes the square for a linear/constant numerator over a degree-2
  radicand: `∫(px+q)/√(Ax²+Bx+C) = (p/A)√Q + (q − pB/(2A))·∫1/√Q`, with the
  `∫1/√Q` term from the shifted no-linear-term form. So
  `∫1/√(x²+x+1) → arsinh((2x+1)/√3)`, `∫x/√(x²+x+1) → √(x²+x+1) −
  ½·arsinh((2x+1)/√3)`, `∫1/√(2−x²) → arcsin(x/√2)`. (`∫xᵐ/√(c+dx²)` with no
  linear term, m ≥ 2, still uses the earlier reduction.)
- ✅ **Non-elementary `∫eˣ/x` → Ei, `∫1/ln x` → li — done.** Added the
  `ExpIntegralEi` (Ei) and `LogIntegral` (li) operators, parallel to `Si`/`Ci`:
  machine-precision kernels in `numerics/special-functions.ts` (Ei via the
  Numerical Recipes §6.3 power/asymptotic series, extended to x < 0 through
  Ei(−x) = −E₁(x); li(x) = Ei(ln x)), registered in
  `library/special-functions.ts` with special values (Ei(0)=−∞, Ei(±∞)=±∞/0,
  li(0)=0, li(1)=−∞), derivatives (Ei′=eˣ/x, li′=1/ln x) in the derivative
  table, and antiderivative wiring: `∫e^(k·x)/x → Ei(k·x)`,
  `∫1/ln(k·x) → (1/k)·li(k·x)`. Exact arguments stay symbolic under `evaluate()`
  (only `.N()` numericizes), per the exactness contract. Bignum precision shares
  the B1 limitation (machine-only, like Si/Ci). Tests in
  `special-functions.test.ts` (numeric values verified against references and
  the Ramanujan–Soldner constant li(μ)=0) and `calculus.test.ts`.
- ✅ **`∫x·eˣ·sin x` (poly × eˣ × trig) — done.** A new
  `tryPolyExpTrigIntegral` handles `∫ P(x)·eˣ·{sin,cos}(b·x) dx` for any
  polynomial P and constant frequency b. Rather than recurse by-parts into the
  cyclic solver (which has no shrinking measure and would not terminate), it
  uses the closed form `eˣ·(A(x)·sin(b·x) + B(x)·cos(b·x))` and solves for the
  polynomials A, B degree-by-degree from the top (each step a 2×2 system with
  determinant 1 + b²), keeping every coefficient exact — no complex arithmetic,
  no float leakage. The pure cyclic solver is the P = constant instance.
  `∫x·eˣ·sin x → (eˣ/2)(x sin x − x cos x + cos x)`, and `x²·eˣ·sin x`,
  `x·eˣ·sin 2x`, etc. all evaluate exactly (verified by differentiate-back).
  Tests in `calculus.test.ts`.

### B3. Definite / improper integrals are numerical-only — ✅ resolved (2026-06-13)

- ✅ **Finite-bound elementary definite integrals are exact.** The symbolic
  definite path (antiderivative + bound substitution) already landed (item 12);
  `∫₀¹ x² dx → 1/3`. The remaining gap was that a transcendental closed form
  collapsed to a float — `∫₁² (1/x) dx → 0.693…` not `ln 2`. **Root cause was
  engine-wide, not in the integrator:** `evaluate()` numericized `ln(2)`,
  `arctan(1)`, etc. (unlike `√2`, which stays symbolic). Fixed by keeping
  transcendental functions of *exact* arguments symbolic under `evaluate()`
  (numericizing only under `.N()` and for *inexact* float arguments); see the
  CHANGELOG. This also wired up the inverse-trig `constructibleValues` dispatch
  (previously unreachable dead code), so `arctan 1 → π/4`, `arcsin ½ → π/6`.
  Result: `∫₁² (1/x) dx → ln(2)`, `∫₀¹ 1/(x²+1) dx → π/4`,
  `∫₀¹ sin x dx → 1 − cos(1)`, `∫₁² ln x dx → 2ln(2) − 1`.
- ✅ **Many improper integrals now exact — for free, via bound substitution.**
  No separate limit machinery was needed: `EvaluateAt` substitutes the bound
  into the antiderivative, so once the antiderivative head reduces at `±∞`, the
  improper integral is exact. The B2 antiderivatives plus the relevant special
  values deliver:
  - `Erf(∞) = 1` (already defined) → `∫₀^∞ e^(−x²) = √π/2`,
    `∫_{−∞}^∞ e^(−x²) = √π`.
  - **New: `arctan(±∞) = ±π/2`** (added to the `Arctan` evaluate handler) →
    `∫₀^∞ 1/(1+x²) = π/2`, `∫_{−∞}^∞ 1/(1+x²) = π`, `∫₀^∞ 1/(x²+4) = π/4`.
  - Elementary monotone cases keep working: `∫₀^∞ e^(−x) = 1`, `∫₁^∞ 1/x² = 1`.
- ✅ **Fresnel-family improper integrals — fixed (arithmetic bug, not the
  integrator).** `∫₀^∞ cos(x²)` should be `√(π/8)` via `FresnelC(∞) = ½`, but the
  bound substitution collapsed to **NaN**. Root cause was an asymmetry in the
  **divide** path (not multiply: `∞ × √π → +∞` already worked). The FresnelC
  argument is `Divide(√2·∞, √π)`, and `Product.asNumeratorDenominator()` bailed
  to `[NaN, NaN]` whenever the coefficient is `±∞` and any symbolic term remains
  — so `∞/√π`, `∞/π` → NaN (while `∞/2 → +∞`). `Sqrt(Pi)`, `Pi^(−1)`, `1/√π` all
  report `isFinite: undefined` (finiteness is *not* propagated through
  `Sqrt`/`Power`/`Divide`), so they were treated as not-known-finite. Fix: added
  an `∞ / (finite, definitely-nonzero) → ±∞` rule (guarded on a definite sign, so
  could-be-zero constants like `sin π` are left alone; the sign of the infinity
  is carried) to **both** division entry points — the `div` helper and
  `canonicalDivide` (`boxed-expression/arithmetic-mul-div.ts`). `∞/∞` (NaN) and
  `∞/0` (`~∞`) are unchanged. Blast radius zero (full snapshot suite unmoved).
  Now `∫₀^∞ cos(x²) = ∫₀^∞ sin(x²) = √2/4·√π = √(π/8)` exactly. See CHANGELOG.
  - ✅ **Latent finiteness gap — closed (2026-06-13).** `isFinite` is now
    propagated structurally through `Sqrt`/`Root`/`Power`/`Divide` of finite
    operands in `BoxedFunction.isFinite` (`boxed-expression/boxed-function.ts`),
    so finite symbolic constants report `isFinite === true` *before* numeric
    evaluation: `√π`, `1/π`, `π^(1/3)`, `π²`, `π^π`, `2^1000`. Guards keep it
    conservative — `Divide`/`Root` require a denominator/index with a **definite
    sign** (BoxedExpression has no `isZero` getter; a known sign entails
    nonzero), `Power` requires a definitely-nonzero base *or* a definitely-
    positive exponent (so `0^0`/`0^−n` aren't claimed finite), and any operand
    with unknown finiteness leaves the verdict `undefined`. Non-finite operands
    stay correct (`√∞`, `∞/π` → not finite). The ∞/finite-nonzero divide rule is
    retained (it produces the right `∞/√π → +∞` value directly). **Blast radius
    zero** (full suite: 10074 tests pass, 3704 snapshots unmoved). Regression:
    `calculus.test.ts` "isFinite propagation (B3 latent finiteness gap)".
- ✅ **Oscillatory improper integrals — done (2026-06-13).** The numeric
  definite path used Monte-Carlo importance sampling, which has unbounded
  variance on a conditionally-convergent oscillatory integrand and returned
  garbage: `∫₀^∞ sin(x²) → −0.36 ± 0.53`, `∫₀^∞ cos(x²) → 1.8 ± 1.2`,
  `∫₀^∞ sin x/x → 1.595 ± 0.03`. A dedicated **`integrateSemiInfiniteOscillatory`**
  (`numerics/oscillatory-quadrature.ts`) integrates `f` over each lobe (the
  interval between consecutive sign changes, found by scan + bisection) with
  adaptive Simpson, then accelerates the resulting alternating partial sums with
  **Wynn's ε-algorithm** (Longman's method). Wired ahead of Monte Carlo in the
  `Integrate`/`NIntegrate` numeric paths for a single ±∞ bound; it returns
  `null` (→ Monte Carlo) for non-oscillatory integrands and rejects divergent
  ones (a `∑ lobes` that doesn't shrink — `∫₀^∞ sin x` → `null`, not the Abel
  sum). Now: `∫₀^∞ sin x/x → π/2`, `∫₀^∞ sin(x²) = ∫₀^∞ cos(x²) → √(π/8)`,
  `∫₀^∞ sin(2x)/x → π/2`, `∫₀^∞ e^{−x}sin x → ½`, `∫₀^∞ cos x/(1+x²) → π/(2e)`,
  all to ~1e-8 (and deterministic — no Monte-Carlo flake). It's purely additive:
  non-oscillatory and finite-interval integrals keep the Monte-Carlo path
  unchanged. Tests: `calculus.test.ts` "oscillatory improper integrals".
- ✅ **Fresnel via the *antiderivative* path — now exact.** With the divide-path
  fix above, the symbolic route also delivers the exact closed form:
  `∫₀^∞ cos(x²) → √2/4·√π` under `evaluate()` (was `FresnelC(NaN)`), independent
  of the numeric oscillatory quadrature. So Fresnel improper integrals are exact
  symbolically *and* numerically.

### B4. ~~`Factor` emits non-polynomial radical/abs forms for `xⁿ − 1`~~ — ✅ done (2026-06-13)

`Factor` applies a difference-of-even-powers trick that injects `√x`/`|x|` for
odd exponents, producing factorizations that are value-equal on `x > 0` but are
**not polynomial** and are branch-dependent:

| input | CE | correct (SymPy) |
|---|---|---|
| `x³ − 1` | `(x·√x − 1)(x·√x + 1)` | `(x − 1)(x² + x + 1)` |
| `x⁶ − 1` | `(\|x\|³ − 1)(\|x\|³ + 1)` | `(x − 1)(x + 1)(x² − x + 1)(x² + x + 1)` |
| `x⁷ − 1` | `(√x·\|x\|³ − 1)(√x·\|x\|³ + 1)` | `(x − 1)(x⁶ + x⁵ + … + 1)` |

`x² − 1`, `x⁴ − 1` and perfect squares are fine. `Factor` of a polynomial should
return polynomial factors (cyclotomic for `xⁿ − 1`); the even-power heuristic
must be gated to actual perfect-power exponents and not introduce `Sqrt`/`Abs`.

**Resolved:** the square-root extraction in `factor.ts` (`extractSquareRoot`,
used by the difference-of-squares and perfect-square strategies) is now gated to
genuine polynomial perfect squares — it strips `Abs` (so `√(x⁶) = |x|³` → `x³`)
and rejects any root containing `Sqrt`/`Abs`/`Root` or a fractional power (so
odd powers like `√(x³) = x·√x` no longer factor by this trick). In addition, the
difference-of-squares result is recursively factored, yielding the full
factorization: `x³−1 → (x−1)(x²+x+1)`, `x⁶−1 → (x−1)(x+1)(x²+x+1)(x²−x+1)`,
`x⁴−1 → (x−1)(x+1)(x²+1)`, `x⁸−1 → (x−1)(x+1)(x²+1)(x⁴+1)`. No `Sqrt`/`Abs`
appears in any factor; all results are value-equal to the input for every `x`.

### B5. ~~No public polynomial GCD~~ — ✅ done (2026-06-13)

`["GCD", p, q]` on polynomials returns **unevaluated** (`gcd(x²+3x+2, x²+4x+3)`;
the answer is `x + 1`). The engine has an internal `polynomialGCD` (used by
cancellation) but nothing surfaces it as an operator — so polynomial GCD, and
benchmarks that rely on it (e.g. the Fateman GCD benchmark), can't run on CE.
Expose `GCD`/`PolynomialGCD` over polynomials.

**Resolved:** `PolynomialGCD(p, q, x)` was already exposed; the variadic `GCD`
operator now also computes a univariate polynomial GCD when the operands share
a non-trivial common factor (variable inferred), e.g. `GCD(x²+3x+2, x²+4x+3)`
→ `x+1`. A trivial (constant) GCD is deferred to preserve the integer-GCD
reading of a bare symbol — `GCD(x, 6)` stays unevaluated; use `PolynomialGCD`
for the coprime → 1 answer. Bivariate GCD now works too (B11 Stage A); general
multivariate GCD remains future work (see B11).

### B6. ~~Multi-operation audit vs SymPy~~ — ✅ built (2026-06-13)

A CE-vs-SymPy issue-finder lives in `benchmarks/audit/`, graded by operation
invariant (no reference answers needed):
- `audit.ts` — hand-authored cases across factor / GCD / expand / simplify /
  integrate / limit → `REPORT-audit.md`.
- `wester.ts` — ingests **Michael Wester's CAS-review suite** (the Mathematica
  form in `benchmarks/wester/`, parsed by `scripts/rubi/wl-parser.ts`),
  auto-categorizes by head, and runs **base CE / CE+Rubi+Fungrim / SymPy** →
  `REPORT-wester.md`. Heads covered: factor, expand, simplify, derivative,
  limit, indefinite & definite integration.

It confirmed B4/B5 fixed (factor & GCD now at parity with SymPy) and surfaced
B7/B8 below. **Next:** add `Solve`, `PolynomialGCD`, `Resultant` heads and the
Bondarenko integration set; translate more Rubi rule sections (the audit's
`CE+R/F` column recovers only algebraic integrals today — 1 of 8 hard Wester
indefinite integrals).

### B7. ~~`Limit` returns a wrong value on some forms~~ — ✅ done (2026-06-13)

CE's `Limit` is evaluated numerically (`.N()`); on certain Wester limits it
returned **`0` instead of the true value** — a silent wrong answer, worse than
failing. Examples (point `x → ∞`):

| limit | CE (before) | correct (SymPy) |
|---|---|---|
| `(−eˣ + e^{x·e^{−x}/…}) / x` | `0` | `−e²` |
| `x·ln(x)·ln(x·eˣ−x²)² / ln(ln(x²+2·e^{e^{…}}))` | `0` | `1/e` |

**Root cause:** these are Gruntz-class limits that overflow the floating-point
range. In the first, two `eˣ` terms cancel to *exactly* `0` around x ≈ 40 (the
true difference is below the ulp of `eˣ`) and overflow to `NaN` past x ≈ 710; in
the second, a triple exponential overflows for any x ≳ 2, so every point on
Richardson's geometric sample ladder (x = 1, 8, 64 …) reads `0` while the true
value lives near x ≈ 1.5. The collapse to a run of identical `0`s made
`extrapolate()` report `err = 0` ("perfect convergence"), which sailed through
the confidence guard.

**Resolved** in `numerics/numeric.ts` (`reliableLimitSamples`, called by
`limit()`): before trusting `extrapolate`, probe the same sample ladder for a
floating-point "trust horizon" — a non-finite sample (overflow), or a magnitude
that grows to an interior peak and then collapses to ~0 (catastrophic
cancellation). When a run of identical samples *looks* converged, corroborate it
with denser intermediate probes so a narrow skipped window (the triple-exp case)
is caught. Past the horizon, `extrapolate`'s `maxeval` is capped to the clean
prefix (or the limit is declared not-evaluable), so the machinery reports `NaN`
instead of a spurious value. Genuine limits — including fp-fragile ones like
`(1+1/x)^x → e`, `√(x²+x)−x → ½`, `(cos x)^{1/x²} → e^{−½}` — are unaffected.
Regression: `calculus.test.ts` "ROADMAP B7"; the Wester limit disagreements
(`≠`) section is now empty (both cases report `∅` not a wrong value).

### B8. ~~`Limit` is numerical-only with low coverage~~ — ✅ done (2026-06-13)

Like definite integrals (B3), CE evaluated limits **only numerically**
(`Limit[…].N()`), never to a symbolic closed form, and gave up (`∅`) on many —
e.g. `lim_{x→∞} (3ˣ+5ˣ)^{1/x} = 5` and `lim_{x→∞} ln x/(sin x + ln x) = 1`, both
of which SymPy solves. On the Wester limit sample CE returned a value for 2/6 vs
SymPy's 4/6.

**Resolved** with a symbolic limit engine (`symbolic/limit.ts`, `symbolicLimit`)
wired into `Limit.evaluate` **ahead of** the numeric path — it produces exact
closed forms (`evaluate()` now returns `1`, `π/2`, `5`, `e`, … instead of an
unevaluated `Limit`), and returns `undefined` (deferring to the numeric path)
whenever it can't decide, so it never regresses coverage. Strategies:
- **finite point** — direct substitution, then L'Hôpital for 0/0 and ∞/∞
  (reusing `differentiate`), iterated (`(1−cos x)/x² → ½`);
- **at infinity** — a "leading-order" (Gruntz-lite) rewrite that drops
  asymptotically-negligible sum terms, a coarse **growth-order** classifier
  (bounded < log < poly < exp < iterated-exp) that settles cross-class
  comparisons numeric probing gets wrong (`eˣ` overtakes `x¹⁰⁰` only near
  x≈700), dominant-term extraction (`3ˣ+5ˣ → 5ˣ`), bounded-function handling
  (`sin`/`cos`/`arctan` negligible vs an unbounded term), `f^g` via
  `exp(g·ln f)` (`(1+a/x)^x → e^a`), and rational-at-∞ by leading coefficients.

A **cancellation/overflow guard** makes the symbolic pass defer (rather than
return a confident wrong value) when probes hit catastrophic cancellation or the
fp horizon — so the two hard Gruntz cases that motivated B7 still resolve to
not-evaluable, never a spurious value. Wester limit coverage **2/6 → 4/6** (the
two B8 cases above now solved; the remaining two are the B7 cancellation limits,
correctly `∅`). Tests: `calculus.test.ts` "ROADMAP B8".

### B9. `Solve` coverage gaps (~~higher-degree polynomials~~ ✅, ~~Abs~~ ✅, transcendental)

(Correction: an earlier draft reported "0/21 — non-functional"; that was a
benchmark bug — it called the `Solve` *operator*, which doesn't auto-evaluate,
instead of the `.solve()` *method*.) With `expr.solve('x')`, base CE now solves
**9/21** of the Wester equations (SymPy 16/21; was 5/21 before the Abs and
higher-degree-polynomial fixes below). Completeness is judged over **real**
roots, so e.g. `x⁷ − 1` (CE returns `[1]`) counts as solved. The gaps:

- ~~**General multi-term cubics/quartics with no rational root**~~ ✅ **Fixed
  (2026-06-13).** `3x³ − 18x² + 33x − 19 → []` before; now returns its three
  real roots. The degree-≥3 fallback (`solve.ts`) tried only the rational-root
  theorem; it now also runs a **numeric Durand–Kerner** real-root finder
  (`numerics/polynomial-roots.ts`, `realPolynomialRoots`, shared with the
  antiderivative partial-fraction path) when the coefficients are numeric.
  Returns approximate real roots (`validateRoots` checks the residual); the
  exact paths are untouched and take precedence, so pure powers
  (`x³−2 → ∛2`), rational-root polynomials (`x³−6x²+11x−6 → [1,2,3]`) and
  rational biquadratics (`x⁴−5x²+4 → ±1, ±2`) still return **exact** roots —
  the numeric fallback only fills in the genuinely-irrational cases. Tests:
  `solve.test.ts` "SOLVING CUBIC AND QUARTIC EQUATIONS".
  - *Not covered:* a chosen design — closed-form Cardano/Ferrari (exact nested
    radicals / casus-irreducibilis trig form). The numeric fallback was
    preferred (reuses existing code, matches `.solve()`'s existing mixed
    exact/float behavior, far smaller surface). Revisit if exact radical output
    is needed.
- **Transcendental / substitution equations — partially done (2026-06-14).**
  Of the 7 Wester trails, **4 now solve** (`solve.ts`):
  - ✅ `e^{2−x²} = e^{−x} → −1, 2` — **same-base power equality**: `cᵃ = cᵇ ⟺
    a = b` when `x ↦ cˣ` is injective (positive constant base ≠ 1). `eˣ` is
    `Power(ExponentialE, ·)`, so this also covers `2ˣ = 2³ → 3`. Handled in both
    the `Equal` form (injective-peeling step) and the subtracted `f = 0` form
    `cᵃ − cᵇ` (`reduceSameBasePower`), the latter being what the `Solve` operator
    / audit path passes.
  - ✅ `sin x = cos x → π/4` — new `a·sin x + b·cos x = 0 → arctan(−b/a)` rule
    in `UNIVARIATE_ROOTS`.
  - ✅ `2√x + 3·⁴√x = 2 → 1/16` — **homogenization** heuristic
    (`solveByRationalPowerSubstitution`): an equation that is a polynomial in
    `x^{1/d}` is solved via `u = x^{1/d}`, then `x = uᵈ`, with extraneous roots
    dropped by validation. Generalizes to any sum of rational powers
    (`x²ᐟ³ + x¹ᐟ³ − 2`, `x − 5√x + 6`, …).
  - ✅ `x = 1/√(x²+1) → √((√5−1)/2)` (exact) — **single-sqrt elimination**
    (`solveSingleSqrtEquation`): an equation with one x-dependent square root and
    a non-constant coefficient, `A(x)·√R(x) + B(x) = 0`, is isolated and squared
    to `A²R − B² = 0` (generalizing `transformSqrtLinearEquation`, which only
    handles a bare `√f = g`). The negative root is dropped by validation.
  - ✅ **Exact biquadratic / sparse-power reduction** (2026-06-14,
    `solveByPowerGcdSubstitution`): a polynomial whose x-exponents share a common
    factor `g > 1` is reduced via `u = xᵍ`, solved exactly, and the real g-th
    roots taken — so `x⁴+x²−1 → ±√((√5−1)/2)` (and case 6 above) return exact
    radicals instead of the numeric Durand–Kerner fallback. Generalizes beyond
    biquadratics (`x⁶+x³−1` via `u=x³`). Gated to reduced degree ≥ 2 (so it never
    recurses on a pure power `xᵍ−c`, already handled by the `a·xⁿ+b` rule) and to
    real roots (matching the engine's real-only convention for ≥3-degree
    polynomials; rational-root biquadratics like `x⁴−5x²+4` are unaffected).
  - **Still open (3):** `xˣ = x` (factors as `ln x·(x−1) = 0` after a log
    transform, but needs general transcendental factoring CE lacks — no `factor`
    for `x·ln x − ln x`), `sin x = tan x` (factor `sin x·(1 − sec x)`),
    `√(ln x) = ln√x` (two related generators `√(ln x)` and `ln x` — needs
    `unrad`-style multi-generator substitution). Tests: `solve.test.ts`
    "TRANSCENDENTAL AND SUBSTITUTION EQUATIONS (B9)".
- ~~**Absolute-value equations**~~ ✅ **Fixed (2026-06-13).** Root cause was two
  buggy direct `|ax+b|+c` root rules in `UNIVARIATE_ROOTS` (`solve.ts`): the
  first branch had the subtraction reversed (`(b−c)/a` instead of `(c−b)/a`) and
  the second was structurally malformed (`Divide(Negate(Add(b,c), a))` — the
  `/--4`-style garbage), so they returned a wrong or partial root that the
  validator then dropped. Fixes: corrected both branches; generalized the
  single-`Abs` harmonization from `|ax+b|` to a uniform `|f(x)|+c` case-split
  (now handles bare `|x| = 2`, unit coefficients, and **non-linear** inner forms
  like `|x²−3| = 1 → ±2, ±√2`); and added a `|f| = |g|` squaring rule
  (`|2x+5| = |x−2| → −7, −1`). Covered by `test/compute-engine/solve.test.ts`
  ("SOLVING ABSOLUTE VALUE EQUATIONS"). (The Wester `equations` file has no
  `Abs` cases, so this fix is verified by unit tests rather than the Wester
  score.)
  (See the consolidated transcendental bullet above for the per-case status.)

Enabling the solve templates (`{solve: true}`, item 1) targets the remaining
LambertW / Ln-Exp inverse forms (`xˣ = x` etc.); the baseline gaps above are
complementary. **Secondary:** the `Solve[…]` *operator*
form (e.g. from parsed Mathematica/LaTeX) returns unevaluated and lets its
`Equal` arg collapse to `False` — it should dispatch to the same machinery as
`.solve()`. Surfaced by `benchmarks/audit/wester.ts` (the `Solve` rows).

### B10. ~~No `Resultant` operator~~ — ✅ done (2026-06-13)

`Resultant[p, q, x]` returned unevaluated (CE had no implementation); SymPy
computes it. The resultant is the Sylvester-matrix determinant, zero iff the
polynomials share a common factor.

**Resolved:** added `Resultant(a, b, variable)` (`library/polynomials.ts` →
`polynomialResultant` in `boxed-expression/polynomials.ts`). Rather than build
an explicit Sylvester determinant, it uses the Euclidean recursion over the
coefficient field — `Res(a,b) = (−1)^(m·n)·lc(b)^(m−r)·Res(b, a mod b)`, with
base cases `Res(a, c)=c^deg(a)` and `Res(const,const)=1` — reusing the existing
exact `polynomialDivide` (rationals/radicals, no floating point). Verified
against an independent Sylvester-determinant computation, plus multiplicativity
(`Res(A·B,C)=Res(A,C)·Res(B,C)`) and the `(−1)^(m·n)` argument-swap symmetry.
Examples: `Res(x²−1, x−1) → 0`, `Res(x²+1, x²−1) → 4`, `Res(x²+a, x+b) → a+b²`,
and the Wester case `Res(3x⁴+3x³+x²−x−2, x³−3x²+x+5) → 0` (shared `x+1`).
Non-polynomial arguments stay unevaluated. The `benchmarks/audit/wester.ts`
`Resultant` rows now dispatch to it. Blast radius zero. Tests:
`latex-syntax/polynomials.test.ts` "RESULTANT".

### B11. Multivariate polynomial GCD — Stage B (Brown) done (2026-06-13)

The variadic `GCD` operator now computes a **multivariate** polynomial GCD for
any number of variables (it was univariate-only — carrying other variables as
symbolic coefficients, which deferred for ≥3 variables and silently bailed to
`1` on harder bivariate inputs). The 7-variable **Fateman GCD benchmark**
([gist](https://gist.github.com/benruijl/3c53b1b0aea88b978ae609e73693fdbc);
Symbolica 4 s / Mathematica 89 s / SymPy 61 min) remains out of reach — it
exceeds the dense algorithm's complexity cap and defers — but textbook
multivariate GCDs (2–4+ variables, moderate degree) now work.

**Done — the kernel + Brown's dense modular GCD.** Two new files:
- `boxed-expression/multivariate-poly.ts` — `MPoly`, a sparse distributed
  polynomial over ℤ (`bigint` exponent-vector → coefficient map): ring ops,
  content/primitive part, exact division, evaluation, per-variable coefficient
  views, modular reduction, and robust boxed↔MPoly conversion (clears rational
  coefficients; unit-tested in `multivariate-gcd.test.ts`).
- `boxed-expression/multivariate-gcd.ts` — `multivariateGCD`, Brown's recursive
  evaluation/interpolation over ℤ_p (univariate Euclid at the base, Newton
  interpolation to climb back up, leading-coefficient scaling Γ — including the
  **integer content of the leading coefficient**, which the field-monic gcd
  drops, so `gcd((2x+3y)(x+y),(2x+3y)(x−y)) = 2x+3y`). Single large prime with
  retry-on-verification-failure instead of CRT; an internal op-budget bounds
  the work. Every result is **verified by exact division** before return, so a
  hard input only ever defers — never a wrong answer.

`polynomialGCDMulti` (`polynomials.ts`) dispatches ≥2-variable operands here
(behind a cheap term-count cap so Fateman-scale inputs defer instantly). Wired
through the public `GCD` operator; tests in `arithmetic.test.ts` (ROADMAP B11
block) and `multivariate-gcd.test.ts`.

A throwaway **verified-GCDHEU** prototype (the same `MPoly` + symmetric ξ-adic
reconstruction) cracked Fateman power 2 in ~7 s and seeded the kernel, but naïve
GCDHEU is fragile (spurious integer factors at the evaluation point corrupt
reconstruction); Brown's content/Γ handling is the robust replacement.

**Next (Stage C — Fateman-scale).** Brown is dense and single-prime; the gaps to
close for Fateman-power-7-scale: **Zippel** sparse interpolation (the dense
interpolation is the bottleneck at 7 variables), **multi-prime CRT + rational
reconstruction** (single large prime caps the coefficient size), and faster
`MPoly` arithmetic (the `Map`-keyed leading-term scan is O(terms) per call).
The kernel is **shared infrastructure** — multivariate factorization,
`Cancel`/`Together`, partial fractions, and `Resultant` (B10) all want the same
representation. Tracked against the `benchmarks/audit/` Fateman footnote.

### B12. `EulerGamma` constant caps out at ~858 digits

Surfaced while validating the B1 Gamma-speed work (2026-06-14): at
`ce.precision = 1000`, evaluating `\gamma` (`EulerGamma`) twice and comparing the
two results diverges after ~858 digits — i.e. the constant is only computed to
~858 correct digits regardless of the requested precision. This makes
γ-dependent checks misleadingly fail (`Digamma(1) = −γ` looks wrong to ~858
digits even though `Digamma` itself is exact to the full precision — verified via
the γ-free identity `ψ(1/3) − ψ(2/3) = π/tan(π/3)`).

**Fix direction:** route the high-precision `EulerGamma` constant through a
convergent algorithm that honors `ce.precision` — the Brent–McMillan AGM method
(`γ = A(n)/B(n) − ln n` with Bessel-function series, doubling `n` with the
working precision) is the standard choice; mpmath uses it. The current
machine-precision constant (or whatever the bignum path uses) should fall back
to it above ~50 digits. Cheap to verify (the γ-vs-γ self-compare above is the
regression test).

### B13. ~~Latent: `BigDecimal.mul` does not round to working precision~~ — ✅ audited / closed (2026-06-14)

Also surfaced by B1: `BigDecimal.mul` returns the **full** product (its
significand is the sum of the operands' significand lengths) while `div` rounds
to `BigDecimal.precision`. Any *accumulating* product therefore grows its
significand ~p digits per step, turning an O(n) loop into O(n²) (this was the
dominant high-precision cost in the Gamma/polygamma kernels until each running
product was explicitly `.toPrecision(p)`-rounded — see B1).

**Audit result — no remaining sites.** Swept every `BigDecimal`/`BigNum`
arithmetic path in the numeric kernels (the only files that touch it are
`numerics/special-functions.ts`, `numeric-bignum.ts`, `bernoulli.ts`,
`statistics.ts`; the quadrature loops — `monte-carlo`, `oscillatory-quadrature`,
`richardson`, `numeric` — are machine-precision `number`/`Complex` and cannot
blow up). Every accumulating `BigDecimal.mul` is in one of three safe buckets:
(a) the Gamma/ψ/ψ₁/ψ₂ running products & powers, already rounded each step via
`.toPrecision(p)` (the B1 fix); (b) series whose term recurrence ends in
`.div()`/`.sqrt()`/`.pow()`, which round for free (Erf/Erfi, Fresnel, Si/Ci,
the Zeta CVZ recurrence); (c) intentional **exact** integer/rational products
where the full width *is* the answer (`factorial2`, the `factVal` in the ζ(2k)
closed form, the AGM `pow2 ×= 2` which grows ~log₁₀2 digits over ~log₂p steps).

**Design question resolved — `mul` stays exact (default unchanged).** Its
exactness is a relied-upon contract: the exact integer/rational/polynomial
paths (`factorial2`, the `MPoly` resultant/GCD work — B10/B11) would break if
the default rounded. The right pattern is the inline `.mul(...).toPrecision(p)`
convention the B1 kernels already use (~15 sites); no `mulRounded` helper was
added (the inline form reads fine and is established). The convention is now
documented as a footgun note on `BigDecimal.mul` (`src/big-decimal/big-decimal.ts`).
