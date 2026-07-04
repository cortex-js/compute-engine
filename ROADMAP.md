# Compute Engine — Roadmap

**Last updated:** 2026-07-04.

This document tracks **remaining** work; an item leaves this file once it lands.
Detail on completed work lives in git history, `CHANGELOG.md`, the linked source
files, and `docs/rubi/RUBI.md` / `docs/fungrim/`.

## Current state

The 2026-06 release shipped:

- the Fungrim-derived identities library
  (`@cortex-js/compute-engine/identities`, 1,385 rules incl. 5 solve seeds), the
  complex-domain assumptions extension, the operator-indexed rule dispatcher
  with purpose tags, `ce.solveRules`/`ce.harmonizationRules`, and exact `Zeta`;
- the Rubi rule driver as an opt-in entry point
  (`@cortex-js/compute-engine/integration-rules`, `loadIntegrationRules(ce)`),
  consulted by `Integrate` before the built-in antiderivative;
- a large symbolic-capability expansion — symbolic/improper integration,
  symbolic limits, expanded `Solve`, polynomial `Factor`/`GCD`/`Resultant`,
  multivariate GCD (Brown) — surfaced by the cross-library benchmark (items
  B1–B13);
- a substantial bignum/numeric performance pass (item 17): base-2 internal
  kernels, AGM `ln`, faster `sqrt`/`Gamma`, on-demand π and γ.

The June 2026 codebase review (REVIEW.md) is fully dispositioned. **Rubi
status:** R1 and R2 gates cleared (full-Chapter-1 exhaustive run ≈90%, ≈91.3%
with the committed `Numer/Denom` + upstream-1.1.3.6 fixes). Remaining Rubi
coverage gaps and packaging follow-ups are tracked in `docs/rubi/RUBI.md` §5,
not here.

**Related documents:** `docs/fungrim/FUNGRIM.md` (feasibility + feature map),
`docs/fungrim/FUNGRIM-PLAN-1…5` (executed architecture plans), `data/fungrim/`
(translated corpus + manifest), `scripts/fungrim/` (translator tooling),
`docs/rubi/RUBI.md` (Rubi integration), `benchmarks/` (cross-library harness +
`REPORT.md`, `BIGNUM-COMPARISON.md`).

---

## Remaining work

### Product feature track (agreed 2026-07-04)

CE is the foundation for Tycho / Graph Paper: an app helping scientists,
students and educators collaborate and communicate about scientific topics.
The 2026-07-04 capability survey against that goal found the engine strong on
plotting/compile targets, units & quantities, logic/sets, linear algebra,
equation systems, and number formatting — and thin in the areas below.
Items 1–4 were agreed and prioritized 2026-07-04; `Series` (Phases 1–2) and
`TrigExpand`/`TrigToExp`/`TrigReduce` have landed and left this list. What
remains (effort S/M/L):

1. **Statistics for real data work (M) — next up.** The library stops at descriptive
   stats (`Mean`…`Histogram`). Missing for a science app: probability
   distributions (Normal/Binomial/Poisson PDF/CDF/quantile),
   correlation/covariance, and least-squares fitting
   (`LinearRegression`/`PolynomialFit`). Highest-value analytical gap for
   scientists and stats students.
2. **Step-by-step "explain" API (L).** The rule engine already threads a
   `RuleSteps` trace (`{value, because, purpose}` per step) through
   simplify/rules internals, but it is not surfaced publicly and `solve` has
   no trace at all. An educator-facing differentiator no competing JS engine
   has. Design item: public API shape, coverage (simplify → solve → D), and
   human-readable step labeling.

**Series residue (small follow-ups from the landed feature):**

- Phase 3 (design-gated): wire the limit engine's pole-deferral slot
  (`symbolic/limit.ts`) to the Laurent kernel — closes Strategic 7(c) — and
  rebase `Residue` on it.
- AsciiMath `toString()` still prints series in canonical (descending) order;
  the LaTeX serializer has the textbook ascending/BigO-last rule
  (`definitions-arithmetic.ts`), AsciiMath would need a parallel sort in
  `ascii-math.ts`.
- Bare `O(…)` parsing deferred (design doc §8 Q3); revisit for lenient mode
  once the parser work settles.

**Not yet agreed (proposed 2026-07-04, awaiting a call):**

5. **Uncertainty type — value ± error propagation (M/L).** A measurement type
   (`5.1 ± 0.2 cm`) propagating through arithmetic, layered on the existing
   units/quantity arithmetic. Core lab-course and experimental-science need;
   the interval engine covers enclosure but not statistical error bars.
   Design item: linear (partial-derivative) vs interval propagation.
6. **MathML output + speakable text (M).** Communication and accessibility:
   MathML serialization for export/interchange (web, Word, EPUB) and a
   speakable-text serializer for screen readers. AsciiMath output already
   exists; MathML and speech are absent. Accessibility matters for the
   education audience.
7. **Significant-figures display control (S).** Scientific/engineering
   notation and locale separators exist; an explicit sig-fig count (and
   sig-fig-aware rounding on display) does not. Small, pairs with item 5.
8. **Chemistry notation — mhchem `\ce{}` (M).** Chemical formulas, isotopes,
   reaction arrows. Only if chemistry is in scope for Graph Paper — decide
   before investing; `mol` exists solely as a unit dimension today.

### Review findings (2026-07-04) — residue

The 2026-07-04 review's P0/P1 fixes all landed (DSolve repeated-root and
Error-node bugs, the ODE P1 tail incl. the parsed-LaTeX path, the
loose-parsing cluster with the `strict` escape hatch, and the top P2/P3
items: Beta poles, `x·∞`, inverse-hyperbolic poles, the rules.ts edge bugs).
Full record: [`docs/reviews/2026-07-04-review.md`](./docs/reviews/2026-07-04-review.md).
Still open from its ranked list:

- **Machine gamma accuracy at z ≳ 80** (~13 digits by z≈140; full precision
  to z≈46) — snapshot-heavy, needs a careful lane fix.
- **defint error bar 1.6× optimistic on endpoint-singular integrands** —
  large (tanh-sinh quadrature).
- **Perf tail** (measurement-gated): per-opDef `allParamsNumeric` cache,
  cold-start bundle size, serialization cache / sort-comparator allocs.
- **Loose-parsing low items:** `sqrt2x` → `√(2x)` divergence from AsciiMath
  convention; `min x` → `Min(x)`; explicit `_a` wildcards in arrow-string
  rules are a silent no-op (redundant there — auto-wildcarding covers it).
- **Doc/cosmetic tail:** `5.` invalid while `.5` parses; `0.999\ldots` drops
  the ellipsis; locale separators.
- ODE P2s (all correctly inert, no wrong answers): sin/exp forcing via
  undetermined coefficients, order ≥ 3 nonhomogeneous, tolerance hardening.

### Symbolic capability gaps

#### B9. `Solve` — beyond the Wester ceiling

Base CE solves 14/21 of the Wester equations (substitution and zero-product
factoring already landed). The last two Wester gaps (`xˣ = x`, `sin x = tan x`)
are harness artifacts — the harness grades SymPy's arbitrary finite root-slices,
not a CE capability gap — so the Wester `Solve` score is saturated at our
principled ceiling. CE now _exceeds_ SymPy on the two inverse-trig equations
SymPy errors on — `arcsin x = arctan x → {0}` and
`arccos x = arctan x → √((√5−1)/2)` (solved by applying `tan` to both sides) —
and the `Solve(eq, x)` operator now dispatches to `.solve()` instead of letting
its `Equal` collapse to `False` (both landed). What remains, on its own merits
rather than by Wester:

- **LambertW / Ln-Exp inverse forms** via the solve templates
  (`loadIdentities(ce, { solve: true })`) — see the Fungrim coverage track.

#### B11. Multivariate polynomial GCD — Stage C (Fateman-scale)

The variadic `GCD` handles textbook multivariate cases (Brown's dense modular
GCD in `multivariate-gcd.ts` — the baseline Zippel extends), but the 7-variable
**Fateman GCD benchmark** (Symbolica 4 s / Mathematica 89 s / SymPy 61 min)
exceeds the dense algorithm's complexity cap and defers. To reach Fateman scale:
**Zippel** sparse interpolation (dense interpolation is the bottleneck at 7
variables), **multi-prime CRT + rational reconstruction** (a single large prime
caps coefficient size), and faster `MPoly` arithmetic (the `Map`-keyed
leading-term scan is O(terms) per call). The kernel
(`boxed-expression/multivariate-poly.ts` + `multivariate-gcd.ts`) is shared
infrastructure — multivariate factorization, `Cancel`/`Together`, partial
fractions, and `Resultant` all want the same representation. Tracked against the
`benchmarks/audit/` Fateman footnote.

#### B6. Audit-harness expansion

The CE-vs-SymPy audit (`benchmarks/audit/`) already grades the
`Solve`/`Resultant`/`GCD` heads through the real opt-in loaders. **Next:** add
the Bondarenko integration set. (Rubi chapter translation — the lever for the
indefinite-∫ gap, where Rubi recovers only 1 of 8 hard Wester integrals today —
is its own track: see **Coverage tracks → Rubi**.)

### Coverage tracks

Two opt-in libraries extend coverage **without touching the core engine**:
**Rubi** (integration rules, `loadIntegrationRules(ce)`) and **Fungrim**
(identities, `loadIdentities(ce, { solve: true })`). The remaining Wester gap to
SymPy is concentrated and maps cleanly onto these, so each is a self-contained
track measured by **its own suite** — the 48-case Wester harness is a
spot-check, not the scoreboard. The two tracks are independent and should not
gate each other.

#### R. Rubi — integration coverage by chapter

**State:** **Chapters 1 (Algebraic), 2 (Exponentials), and 6 (Hyperbolics)** are
translated and bundled, **plus all of Chapter-4 §4.1 Sine** (104 rule-docs →
~4.1k rules in `src/compute-engine/rubi/rubi-rules-data.json`, exposed via
`@cortex-js/compute-engine/integration-rules`).
The trig pilot closed the **three `1/(3cos x + 4sin x + k)` Wester integrals**
(∅→✅ under `CE+R/F`) via a minimal active↔inert trig head-swap bridge — Wester
indefinite-∫ is now `CE+R/F` 6/8 (overall 32/48 per the committed report; a
fresh source run measures 34/48 from unrelated CE drift). Chapter 2 ≈72% effective,
Chapter 6 ≈45% effective (sample, seed 42) — both reuse the Chapter-2
exponential machinery (incl. the incomplete-Γ kernel); the Ch6 reciprocal/
algebraic tail (below) is the residual. Per-chapter blow-by-blow in
`docs/rubi/RUBI.md` §5.

**In progress — full Chapter 4 (trig).** The whole cost is the **inert-trig
utility layer** (77% of the chapter's 2,117 rules match inert `cos`/`sin`;
extraction + compilation are free — `docs/rubi/RUBI.md` §1/§5). The ch4 corpus
is translated; the runtime utility port is incremental, validated per-section
against the **Rubi test suite** (the real metric):
`scripts/rubi/benchmark.ts --rubi "data/rubi/corpus/4 Trig functions" --chapter
"4 Trig functions/4.1 Sine" --sample 120 --seed 5 --report /tmp/x.json` (always
pass `--report`; the default clobbers the committed baseline).

**Landed (2026-06-15).** `ExpandTrig` + the predicates
`InertTrigFreeQ`/`FalseQ`/`InverseFunctionFreeQ`; the reverse-chain rule
(`DerivativeDivides` + `EasyDQ`, perf-gated); `FunctionOfTrig`; the pure
substitution engine (`FunctionOfQ` + `SubstFor`/`SubstForTrig` for
sin/cos/tan/cot); a **recursive native-rational fallback** in the driver (closes
the *algebraic* sub-integrals the trig reductions emit — e.g. `∫cos·g(sin)` →
`∫g(t)`); and the **`UnifyInertTrigFunction` cofunction shift**
(`cos[θ] → sin[θ+π/2]`), which is how Rubi routes cosine to the sine rules — it
has **no Cosine chapter** (confirmed by tracing Rubi under `wolframscript`).
CE's `simplify` gained the matching `sin(θ+π/2) → cos(θ)` identity so results
read cleanly. **4.1 Sine: 26 → 46/120 (seed 5)** from the head-swap pilot.

**Landed (2026-07-04) — R1 + R4.** The **cofunction product clauses** in
`unifyInertTrig` (cos·csc, cos·sec, and sin/csc/cot/tan × `(a+b cos)` binomial
products, ported from `IntegrationUtilityFunctions.m` §1.0/1.1.2/1.1.3); the
sine corpus is written with *sin* binomials, so these mostly pay off on
recursive subproblems and the cos-heavy chapters (4.3 Tangent / 4.5 Secant).
And the **ship step**: all 21 files of 4.1 Sine bundled (918 rules; bundle
3,219 → 4,080, +~15% one-time rule-compile cost), the driver's self-contained
bare-trig-power fallback removed (the bundled sine rules cover it — verified
on/off identical), ch1/ch2/ch6 and Wester unchanged. Also landed: the
**cross-bundle class-identity fix** — the ESM builds of `compute-engine` +
`integration-rules` now share chunks (`splitting: true` in `scripts/build.mjs`,
one `BigDecimal` realm; was the cause of two Wester integrals failing in dist
only), plus defensive duck-typing in `numerics/bigint.ts` and `e.name`-based
`CancellationError` checks in the driver. **Benchmark truth: 4.1 Sine is
47/120 (seed 5), 1 wrong / 0 not-evaluable** — the wrong is the *pre-existing*
`4.1.2.2 #1395` (a 3-factor sin-binomial integrand; the earlier "0 wrong"
claim was a mismeasure — the clean tree was already 46/1/0). Sample 400:
140/1/0.

**Landed (2026-07-04) — R2.** The binomial-product chains close. The blocker
was **not** a missing Chapter-4 utility: (a) the benchmark's `--rubi` mode
loaded Chapter 4 *without* the Chapter-1 algebraic foundation the shipped
loader bundles, stranding every reduction's base case (the tangent-half-angle
substitution in `4.1.1.1#27` emits `∫1/(a+2bx+ax²)dx`, a Ch1 rule) — the
harness now preloads ch1/2/6 in `--rubi` mode so it measures the integrator
as it ships (`RUBI_NO_FOUNDATION` to disable; **pre-2026-07-04 4.1 baselines
are not comparable**); (b) inert `csc`/`sec` heads blocked the power rules —
new `reciprocalToPower` normalization in `rubi-utils.ts` (`csc→sin⁻¹`,
`sec→cos⁻¹`, branch-guarded: frozen under fractional powers where
`√(b·sec) ≠ √(b/cos)` off the principal branch), applied in the driver after
`deactivateTrig` (`RUBI_NO_RECIP` to A/B). Also: a `containsError` guard
rejects rule results carrying `Error` nodes as no-progress. **4.1 Sine:
47 → 96/120 (seed 5), 0 genuine wrong / 0 not-evaluable** (#1395 wrong →
unsolved); sample 400: 140 → 288, where the 3 remaining "wrongs" are
**verification false-wrongs** — symbolically correct hypergeometric
antiderivatives (verified: derivative ratio 1.0 at every sample point) that
the harness's numeric 2F1/AppellF1 evaluation mis-grades when substituting
*non-integer* values for symbolic exponents. Expect the harness to keep
flagging that class on future 4.1 rungs. Ch1 regression: 180/200 (+1), same
6 pre-existing wrongs. The core integer-power `(a+b sin)^m(c+d sin)^n` class
is closed (4.1.2.1: 12→2 unsolved; 4.1.2.2: 17→1).

**Method note (hard-won).** The "unimplemented-predicate" trace census is
*misleading* for picking levers: the late catch-all rules
(`FunctionOfTrigOfLinearQ`, `TrigSimplifyQ`) are checked on nearly every unsolved
problem and dominate the tally without being the blocker. Diagnose instead by
tallying the *actual* rule-fail/inner-condition reasons and tracing the residual
integrand; and use **`wolframscript`** to see Rubi's real chain (load Rubi, then
trace recursive `Int` calls, or probe `DeactivateTrig` directly):

```mathematica
Get["~/dev/rubi/Rubi-4.17.3.0/Rubi/Rubi.m"];
Trace[Rubi`Int[Cos[x]^4, x], HoldPattern[Rubi`Int[_, _]]]
Rubi`Private`DeactivateTrig[Cos[x]^4, x]   (* -> sin[Pi/2 + x]^4 *)
```

**Landed (2026-07-04) — R3 base cofunction gap + R10 audit & ship.** The
`√(b·sec)` half-integer family closed, and the mechanism is now understood
correctly (the R10 audit corrected R3's first reading): **Rubi has no
sec/cot/csc-of-cosecant chapters and no load-time rule generation** — its
reciprocal-trig chapters are authored in ONE cofunction (`4.5 Secant` in inert
`csc`, `4.3 Tangent` in `tan`), and `DeactivateTrig` maps the *other* head to
the authored one at **integration time** via a π/2 reflection
(`Sec[x] → csc[π/2+x]`, confirmed under `wolframscript`). CE's runtime
deactivates `Sec→` inert `sec` instead, so the sec side had no reduction rules.
Fix shipped: three branch-safe `sec` rules
(`∫(b·sec)^n = (b·Sec)^n·Cos^n·∫1/Cos^n` form, wolframscript term-checked) in
`4.5.1.1`, and **all of 4.5 Secant bundled** (13 files, 0 skips; bundle
4,080 → 4,531 rules, 4.41 → 4.94 MB, rule-compile +~10%). Validation: 4.5
Secant 20 → 31/120 (seed 5), 4.1 Sine 98/120 and ch1 180/200 unchanged,
genuine wrongs 0 everywhere, shipped-path probe closes `√(sec x)` &co. via the
real bundle. Audit table (per-section missing-cofunction counts for 4.5/4.3)
is in `docs/rubi/RUBI.md` §5 Phase R10. 4.1 Sine benchmark: 96 → 98/120,
288 → 293/400 (seed 5); the 3 sample-400 flags remain the documented
hypergeometric false-wrongs.

**Landed (2026-07-04) — R11, runtime cofunction shift.** `cofunctionShift` in
`rubi-utils.ts` (driver: after `deactivateTrig`, before `reciprocalToPower`)
now mirrors Rubi's `DeactivateTrig` routing: `sec[e+f·x] → csc[e+π/2+f·x]`
(no sign; `cot → −tan[θ+π/2]` implemented but default-OFF pending R12). NOT a
blind swap — it fires only for pure-source forms: declines when a cross-pair
head is co-present (that's `unifyInertTrig`'s job) and reverts if the result
carries the target head at ≥2 distinct arguments (the within-pair `csc·sec`
desync, which breaks in recursion). **4.5 Secant: 31 → 56/120 (seed 5), 0
genuine wrong** (3 flags = the same verification-false-wrong class, incl. a
`√(sin²)=|sin|` branch present in Rubi's own reference); 4.1 Sine (98/120,
293/400), ch1, ch2/ch6 all byte-identical; strict no-op for non-trig
integrands (`RUBI_NO_COFN` A/B). The three stopgap sec rules are shadowed for
pure-sec inputs but kept as fallback for reverted within-pair cases. Shifted
results read back cleanly (`simplifyTrig` folds `csc(θ+π/2)→sec θ`). Bundle
untouched (runtime-only change).

**Next rungs (priority order).** Each is a self-contained work item: do the
change, then verify with the benchmark command above (watch `solved-correct`
climb while genuine `wrong`/`not-evaluable` stay 0 — but see the R2 note on
hypergeometric verification false-wrongs). Diagnose any stall per the Method
note — trace the residual integrand, don't trust the predicate census.

- **R12 — bundle 4.3 Tangent.** Three parts, per the R11 landing (RUBI.md §5
  Phase R11): (a) add the 4.3 corpus to the bundler allowlist; (b) turn on the
  `cot → −tan[θ+π/2]` leaf shift (implemented in R11 but default-OFF behind
  `RUBI_COFN_COT` — correct but premature while 4.3 is unbundled, and it
  regresses 4.1's mixed `(g·cot)^p(a+b·sin)^m` families); (c) supply the
  mixed-argument "cot→tan" `unifyInertTrigFunction`-style matched-±π/2
  product clauses — the uniform leaf reflection desyncs mixed `sin·cot`
  products, so (b) alone is not enough. Validate 4.3 + 4.1 with the
  genuine-wrong gate at 0.
- **R13 — sec-specific binomial routing.** Integer-power symbolic binomials
  (`1/(a+b·sec)`, `(a+b·sec)²`) still stay inert in the shipped bundle: after
  the R11 reflection, `reciprocalToPower` rewrites the reflected `csc` inside
  a summand to `1/sin` before a csc *binomial* rule can match. The naive fix
  (exempt Add-summands from `reciprocalToPower`) regresses 4.1 Sine by −20
  (the csc-binomial sine families rely on that rewrite), so this needs a
  sec-aware carve-out rather than a global ordering change.
- **R3′ — residual half-integer/elliptic chains.** What remains of R3 after the
  base gap: `(e·cos)^(7/2)/(a+b·sin)^n` and `√(g·cos)·sin³/(a+b·sin)`
  (#604/#609/#1395) need the `Rt[-a²+b²]` symbolic-radical `ArcTan`/`ArcTanh`
  chains (15–18 Rubi steps — genuinely deep); plus the composite
  `cot^m/(a+b·sin)^n` / `(a+b·sin²)^(p/2)` tan/cot-power recursions (4.1.1.3 /
  4.1.7), which may fold into R5.
- **R9 — polynomial×trig & nonlinear arguments** (4.1.10 / 4.1.11 / 4.1.12):
  `(c+d·x)^m·(a+b·sin)^n`, `sin(a+b/x)`, `sin(a+b·xⁿ)^(1/3)` — the largest
  residual block (~76 of the 100 unsolved at sample 400); several members are
  genuinely `Unintegrable` and correctly stay inert, so grade against Rubi's
  own test-suite expectations.
- **R5 — `TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions). _Low value /
  optional:_ the predicate census over-weights it (it's a late catch-all, not a
  blocker). Only pursue if R3′/R9 leave a concrete residual class that needs it.

**Exponential** (Ch 2, 125 rules) and **hyperbolic** (Ch 6, 390 rules) are
DONE and bundled (2026-06; both use ACTIVE heads → ≈ Chapter-1 difficulty). The
Chapter-6 residual (no single lever; ≈55 of 100 in the sample) is the next Rubi
coverage work, and most of it is shared capability rather than Ch6-specific:

- **R6 — symbolic-coefficient rational integration.** Parametric reciprocal
  denominators (`∫1/(a+b·Sinh x)`, etc.) substitute to a rational in `eˣ` with
  free parameters, which the native rational fallback declines (it requires
  numeric coefficients). This is the shared 1.3.2 gap too — symbolic polynomial
  factoring/partial-fractions. Highest-value Ch6 lever.
- **R7 — algebraic-in-hyperbolic → elliptic** (`(a+b·Sinh²)^(p/2)`,
  `√(a+b·Tanh)`): needs the elliptic-integral route (the kernels exist).
- **R8 — poly×reciprocal by-parts / CoshIntegral·SinhIntegral heads** for the
  nonlinear-argument reciprocal families.

#### F. Fungrim — solving coverage

**Decoupled from Wester.** The two remaining Wester `Solve` gaps are harness
artifacts (B9), so additional Fungrim solve rules will **not** move that number
— the Wester `Solve` rows are saturated at our principled ceiling (14/21). This
track is worth pursuing on its own merits — LambertW / Ln–Exp inverse forms
beyond the current 5 solve seeds, via `loadIdentities(ce, { solve: true })` —
but it needs **its own solving benchmark** distinct from Wester: pick or build
one before investing, so progress is measurable. (Fungrim's _simplify_-side work
is separate again — see Strategic item 7, Fungrim Phase 4.)

### Bignum / numeric track

The item-17 / B-series performance pass is largely complete (`ln`, `exp`, `kˣ`,
`sqrt`, `Γ` at 1000 digits now beat or match mpmath). Two deferred items remain:

- **17.12 — r-step / rectangular splitting in `fpexp`.** A real but small kernel
  win (~3×); the kernel is <10% of `exp(.N())` time, so the user-facing impact
  is low. Lowest priority.
- **17.15 — base-2 special-function kernels (`gammaln` et al.).** The deeper
  half of the `Γ`-vs-mpmath gap (still ~5–7× at 200 digits after 17.14). The
  _elementary_ kernels run on a base-2 fixed-point grid where "round to p bits"
  is a free bit-shift; the _special_ functions (`gammalnCore` + Bernoulli
  Stirling machinery, `digamma`/`trigamma`/`polygamma`, `zeta`, `beta`) still
  run at the base-10 `BigDecimal` level and pay the rounding tax. Porting is a
  substantial undertaking (argument-shift product, Bernoulli-rational series,
  reflection formula, `exp`/`ln` glue all move onto `bits`-scaled `bigint`s).
  Expected to close most of the gap; the residual ~2× is V8 `BigInt` vs GMP, not
  closable without a different bigint backend (e.g. WASM GMP). Lower priority:
  the special functions are already 130–170× faster than 0.59.0 and competitive
  for typical use — a "catch mpmath" item, not a correctness/capability gap.

### Symbolic-evaluation performance

#### P1. Differentiation performance (~1.8–3× available) — DEFERRED

**Status (2026-06-16): deferred.** Verified, scoped, and a direction chosen, but
not worth the churn right now. Picked up below for whoever resumes it.

The cross-library benchmark (`benchmarks/REPORT.md`) puts CE's differentiation
**~38× slower than Wolfram** (median 0.17 ms vs 0.0044 ms), and the gap **widens
with expression size** (`d/dx sin x` ~6×, `d/dx x²·sin x` ~80×, `d/dx √(1−x²)`
~114×); Wolfram's `D` is essentially flat (~4 µs regardless of structure).
(`simplifyDerivative` is already a no-op, so simplification is _not_ the cost.)

**Profiled 2026-06-16 (verified — `.perf-explore/profile-diff*.mjs`).** The
original hypothesis (the cost is per-node canonicalization, and deferring it
"closes most of the gap") is **only partly right**. Decomposing the per-call path
(`ce.box(['D', …]).evaluate()`, warm; D09 √(1−x²) ≈ 0.35 ms) gives three cost
centers:

- **final `f.evaluate()` ≈ 60% — the largest, and largely redundant.** The
  canonical derivative already equals the evaluated form for **8 of 9** benchmark
  cases (only D09 changes, trivially: `-(x·1/√(1−x²))` → `-x/√(1−x²)`). Skipping
  it is the single biggest lever.
- **per-node canonicalization ≈ 20%** — real (it _is_ ~70–100% of
  `differentiate()`'s own time), but a minority of the call. This is the helper
  tax: `symbolic/derivative.ts` builds every node through `.mul()/.add()/.div()/
  .pow()/.neg()`, each of which reorders/flattens/folds.
- **recursion + node allocation/binding + box ≈ 20%** — fixed `BoxedExpression`
  overhead deferral can't touch.

**Measured ceilings** (true structural-diff spike, end-to-end, output checked):

- Defer canonicalization, **keep** the final evaluate (output byte-identical to
  today, all 9 cases): **~1.8× median** (1.0–3.3×). Much of what per-node canon
  saved is paid back by the one mandatory top-level canonical pass.
- Additionally **drop** the redundant final evaluate (return `f.canonical`):
  **~5× median** (2.7–9.5×); output identical for 7/9, two differ only in
  factoring (`(ln x+1)·xˣ` vs `xˣ+ln(x)·xˣ`).

**Conclusion: this is a ~2–3× win, not Wolfram parity.** Even the most aggressive
variant leaves CE ~8–20× slower than Wolfram — the residual is intrinsic to the
boxed/bound representation (one canonical pass + node allocation/binding) and is
not closable by deferral. Wolfram's flat profile is lightweight term-rewriting,
not a canonicalization strategy CE can adopt without changing its representation.

**Two levers, with the drop-evaluate one prototyped and measured:**

- **Drop the redundant final `f.evaluate()`** (`library/calculus.ts` ~213, return
  the canonical derivative) — the bigger win (~2–3.5×), but **it changes what `D`
  returns** (canonical form, not fully-evaluated), so it is a semantic change, not
  a pure optimization. Prototyped 2026-06-16; full `derivatives`+`calculus` suites
  give a **12-snapshot blast radius**: _2 regressions_ — `ln(e)` no longer folds
  to 1 (`d/dx eˣ → ln(e)·eˣ`, `d/dx log_e x → 1/(x·ln(e))`); these are
  special-value folds `canonical` doesn't do and would need a source-level
  `ln(e)→1` fix in the Power/Log rules. _2 improvements_ — the unknown-function
  chain rule stops collapsing to a wrong `0` (`d/dx f(x²) → 2x·f′(x²)`). _8
  cosmetic_ — factored/reordered but mathematically identical (Bessel ×7,
  LambertW ×1). Notably the fraction-combining cases (`2(x+1)/(x²+2x)`) still pass,
  so `evaluate`'s genuine work is narrower than feared — mostly `ln(e)`-style
  special values. **Risk:** other untested derivatives may carry unfolded special
  values; needs a full-suite run before adopting.

- **Defer per-node canonicalization** (build the tree **structurally** in
  `differentiate()` — `{ form: 'structural' }` — and canonicalize **once** at the
  outermost call, keeping the final evaluate). **Chosen direction when resumed:**
  output stays byte-identical (all snapshots pass), ~1.3–1.8× win, at the cost of
  a careful rewrite of every rule path in `derivative.ts`. The spike confirmed the
  `.mul()`-distributes-over-sums hazard (`k·(a+b)→ka+kb`) is real — it produced
  factored result shapes — so the value returned must be the final canonical form,
  not a raw structural tree. `differentiate()` recurses, so defer through the
  recursion and canonicalize only at the top. (Could be combined with the
  drop-evaluate lever later for the ~5× ceiling, in a separate reviewed step.)

Scratch profiling/spike scripts: `.perf-explore/profile-diff*.mjs` (untracked).

### Strategic

#### 7. Fungrim Phase 4 — branch-cut-safe simplify & exact pole asymptotics

The analytic-property store (`ce.functionProperties`, pole-aware `N()`), the
`Residue` operator, and the `onBranchCut` guard are in place. Two consumers of
the store are only partially built:

- **(a) Branch-cut-safe simplification — largely complete.** The logarithm
  family is guarded: `ln(a) + ln(b) → ln(ab)` (`simplify-log.ts`) and the
  `.ln()` expansions `ln(bⁿ) → n·ln(b)` / `ln(a/b)` / `ln(root)`
  (`boxed-function.ts`) consult `onBranchCut` and stay symbolic when an operand
  is provably on the negative-real cut. Power/root _products_ (`√a·√b → √(ab)`,
  `(ab)^p`) were already safe — gated on `isNonNegative` in
  `arithmetic-mul-div.ts` (see also the `foldIsSound` `(base^r)^e → base^(r·e)`
  gate). What's left is **not** store- driven: a guarded `arctan(x) + arctan(y)`
  addition would be a _new capability_ (CE doesn't combine inverse-trig today),
  and its validity region (`xy < 1`) is an arithmetic condition, not an
  `onBranchCut` cut-membership test — so the store doesn't serve it.
  Complex-domain Fungrim rules already carry their own loader guards.
  _(Landed since: even powers now use the always-sound `ln(x²) → 2ln|x|` and
  `√(x²) → |x|`; odd and irrational exponents keep the optimistic generic-real
  convention (`ln(x³) → 3ln(x)`) for unconstrained symbols, and symbols declared
  `complex` are excluded from these rewrites entirely — see
  [`docs/SIMPLIFY.md`](./docs/SIMPLIFY.md#generic-real-simplification-policy).)_

- **(c) Exact asymptotics at special-function poles.** `Residue` and the limit
  engine currently _defer_ when a gamma/zeta-family function sits at a pole (the
  limit-side deferral is the pole soundness guard in `symbolic/limit.ts`, where
  the exact asymptotic would slot in): `lim_{x→-1}(x+1)·Digamma(x)` stays
  unevaluated instead of computing `-1`, and a residue whose cofactor is itself
  an unreduced special function (`Gamma·Zeta` at
  1. is not handled. Both need real Laurent-series asymptotics for these
     functions — a leading-term rewrite is unsound
     (`lim_{x→0} Gamma(x) − 1/x = −γ`, not 0). Smaller adjacent gaps: residue at
     infinity, and a "sum of residues in a region" helper.

**Effort:** open-ended; each is a design item in its own right.

#### 8. Disjunctive guards (`Or`) in the assumptions system

**What:** 87 complex-domain corpus entries remain undischargeable because their
guards are `Or`-rooted (the assumptions design deliberately scoped disjunction
out — `docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md` §7 non-goals). The remaining
~43 failures are symbolic bounds (`|z| < φ−1`), which the assume-side
decomposition deliberately drops.

**Why "strategic":** disjunctive facts are a real design extension (case
splitting or watched-disjunct propagation), not an incremental patch. The guard
census (`scripts/fungrim/guard-census.json`, currently 89.6% complex-domain
dischargeable) quantifies exactly what it would buy. Let demand justify it.

#### 9. Matrix/tensor value representation — unify `List` vs `BoxedTensor`

**What:** tensor values exist in two forms — a `BoxedTensor` instance (the
canonical `box`/`function` path) and a plain `List` `BoxedFunction` (broadcast /
map results, `ce._fn('List', …)`). `isTensor` recognizes only the former, so a
tensor-shaped plain list bypasses the tensor-arithmetic paths
(`addTensors`/`mulTensors`, `MatrixMultiply`, `MatrixPower`). Visible residue:
`Sqrt(M) − Sqrt(M)` (both operands broadcast-produced) stays symbolic instead of
collapsing element-wise to `[[0,0]]`.

**Status:** the *exactness* half of this cluster shipped — exact rational/radical
tensor entries no longer floatify (`getExpressionDatatype` uses the `expression`
dtype). The *detection* half is **deferred**: three normalization attempts
(promote broadcast results to `BoxedTensor`; an `operator === 'List'` gate in
`add`/`mul`; a dtype-aware "smart" promoter) each regressed on precision,
performance, or correctness.

**Why "strategic":** at the default precision a machine float and a
high-precision bignum are both `BigNumericValue` / `isExact === false`, so the
tensor dtype can't be chosen cheaply, and any per-broadcast normalization is hot
enough to blow simplify/calculus deadlines. A real fix is a representation rework
(normalize at construction, or make tensor detection/access work on plain
`List`s without per-call re-boxing), not a patch — let demand justify it. The
common cases are already covered by the landed per-site fixes (Negate over
evaluated tensors, `MatrixPower` negative branch, matrix juxtaposition). Detailed
findings — the three failed approaches and why — are in
`docs/plans/2026-06-28-tensor-value-representation-design.md`.

### Correctness & symbolic findings (2026-07) — residue

The July 2026 correctness and symbolic reviews are fully dispositioned: every
verified P0 and P1 from both reviews landed across the Wave 1–4 commits. The
findings docs are kept for the record — [`CORRECTNESS_FINDINGS.md`](./CORRECTNESS_FINDINGS.md),
[`SYMBOLIC_FINDINGS.md`](./SYMBOLIC_FINDINGS.md), with the per-wave
implementation log (decisions D1–D9, gate protocol, per-package status) in
[`docs/reviews/2026-07-findings-tracker.md`](./docs/reviews/2026-07-findings-tracker.md).
The condensed P2/P3 lists at the
bottom of each findings doc are the remaining low-priority sweep. The
opt-in/nightly harnesses that pin these fixes (exactness grid, type-soundness
grid, mpmath kernel harness, JS/Python parity fuzz, round-trip battery) are being
adopted from the archived sources in `docs/reviews/2026-07-archive/`.

Two design-level residues are deliberately carried forward:

- **D10 — `real ⊄ complex` in the type lattice.** `real` admits ±∞, so it is not
  a subtype of `complex`; the Fungrim loader carries a real-symbol guard shim and
  `box.ts` carries a `signatureHasComplexParam` skip to work around it. A lattice
  decision that made the finite reals a subtype of `complex` would retire both
  shims, but it interacts with the covering-union identities — a type-system
  design choice, not a bug fix. Left for demand to justify.
- **P1-19c — `Derivative(Sin).evaluate()` result typing.** The result type of an
  evaluated derivative of a known function is not yet tightened (documented in
  `library/calculus.ts`); it is blocked on evaluate-recursion and
  underscore-lambda LaTeX serialization, so it waits on those.

### Review residue (open low-priority items)

The June 2026 codebase review (REVIEW.md) is fully dispositioned; its full text
is in git history. The only items deliberately left open:

- **A14 (LOW)** — `boxed-expression/order.ts` tie-breaks: operator and string
  branches sort descending while the symbol branch and doc comment say
  ascending. Deferred because forcing ascending changes established canonical
  orderings in a debatably _worse_ direction (e.g. `-(sech x · tanh x)` instead
  of the textbook `-(tanh x · sech x)`) and churns calculus snapshots. Resolving
  it is a canonical-form design choice, not a bug fix.
- **G5 (LOW)** — `["Subscript", "a", "k"]` canonicalizes to the fused symbol
  `a_k`, severing the binding when `k` is a binder-bound index. A correct fix
  needs binder-aware canonicalization (the canonicalizer has no enclosing-binder
  scope at fusion time) — too broad for a LOW finding. Workaround: the call form
  `["a_", "k"]` (which the Fungrim corpus uses).
- **G7** (bound-variable identity stability across re-boxing) — resolved by
  intervening work; now passes but has no dedicated regression test pinning it.

**Lessons worth keeping in mind** (the durable ones are in CLAUDE.md): the
`undefined → false` collapse in three-valued predicates was the single most
recurring bug class (A3, G3, the sets/Union/Range contains family, NaN
comparisons); validation-by-corpus (the Fungrim harness) found 15 engine bugs
that targeted review missed — keep running it.
