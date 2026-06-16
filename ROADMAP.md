# Compute Engine — Roadmap

**Last updated:** 2026-06-15.

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
translated and bundled (84 rule-docs → ~3.2k rules in
`src/compute-engine/rubi/rubi-rules-data.json`, exposed via
`@cortex-js/compute-engine/integration-rules`), **plus the Chapter-4 trig
`(a+b cos+c sin)` Weierstrass family** (`4.1.6`, 57 rules) from the trig pilot.
The pilot closed the **three `1/(3cos x + 4sin x + k)` Wester integrals** (∅→✅
under `CE+R/F`) via a minimal active↔inert trig head-swap bridge — Wester
indefinite-∫ is now `CE+R/F` 6/8 (overall 32/48). Chapter 2 ≈72% effective,
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
read cleanly. **4.1 Sine is now 47/120 (seed 5), 0 wrong / 0 not-evaluable**, up
from the head-swap pilot's 26.

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

**Next rungs (priority order — start at R1).** Each is a self-contained work
item: do the change, then verify with the benchmark command above (watch
`solved-correct` climb while `wrong`/`not-evaluable` stay 0). Diagnose any stall
per the Method note — trace the residual integrand, don't trust the predicate
census.

- **R1 — remaining `UnifyInertTrigFunction` cofunction clauses.** Extend
  `unifyInertTrig` in `src/compute-engine/rubi/rubi-utils.ts` (the standalone
  `(a+b cos)^n` clause is the template) with the product siblings from
  `IntegrationUtilityFunctions.m` ~6551–6606: `(g sin)^p(a+b cos)^m`,
  `(a cos)^m(b csc)^n`, `(a cos)^m(b sec)^n`, `(g csc)^p(a+b cos)^m`, and the
  tangent/secant analogs further down. **Gotcha:** apply *after* `toTimesPower`
  (the `sin^0→1` fold), exactly like the standalone clause — otherwise a spurious
  `sin^0·cos^n` reads as a "mixed" product and the shift is skipped. Also feeds
  4.3 Tangent / 4.5 Secant. _Done when:_ mixed cos/cofunction products in 4.1
  Sine route to the sine rules and close.
- **R2 — `(a+b sin)^m (c+d sin)^n` binomial-product chains** (4.1.2 / 4.1.3 /
  4.1.4): the trig analog of Chapter 1's binomial products and the bulk of the
  ~73 remaining 4.1 Sine unsolved. The rules are already translated; they stall
  on a residual that doesn't close or a missing utility — trace the *residual
  integrand* of a few unsolved 4.1.2 cases to find which, then fill that gap.
- **R3 — `√(a+b sin)` half-integer powers** (4.1.7).
- **R4 — bundle + validate (the "ship it" step; can run independently of R1–R3).**
  Add the 4.1 sine families to the bundler allowlist
  (`scripts/rubi/bundle-corpus.ts`, currently ch1 + `4.1.6` only) and regenerate
  `src/compute-engine/rubi/rubi-rules-data.json` (CI has a bundle-freshness
  gate — commit the regenerated file). The driver's self-contained bare-trig-
  power fallback then becomes removable (it exists only because the bundle lacks
  the sine rules). Validate against the ~22k-problem trig suite and re-run
  `benchmarks/audit/wester.ts` (the three `1/(3cos+4sin+k)` cases must stay ✅).
- **R5 — `TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions). _Low value /
  optional:_ the predicate census over-weights it (it's a late catch-all, not a
  blocker). Only pursue if R1–R3 leave a concrete residual class that needs it.

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

#### P1. Differentiation — defer canonicalization to the end (exploration)

The cross-library benchmark (`benchmarks/REPORT.md`) puts CE's differentiation
**~30× slower than Wolfram** (median 0.15 ms vs 0.0044 ms) — and, unlike
simplification and integration where CE is ~2× _faster_, the gap **widens with
expression size**: `d/dx sin x` is ~12× off, `d/dx x²·sin x` (product rule)
~100×, `d/dx √(1−x²)` (chain rule) ~145×. Wolfram's `D` is essentially flat
(~4 µs regardless of structure); CE grows 43 → 1146 µs across those cases. The
differentiation _algorithm_ is a trivial syntactic recursion — the cost is
**per-node canonicalization**: `symbolic/derivative.ts` assembles every result
through the canonical arithmetic helpers (`.mul()`, `.add()`, `.div()`, `.pow()`,
`.neg()`), so each intermediate node is reordered, flattened and number-folded as
it is built, and a larger derivative tree pays that tax at every node.
(`simplifyDerivative` is already a no-op, so simplification is _not_ the cost.)

**Exploration:** build the derivative tree **structurally** (deferred /
non-canonical construction — `{ structural: true }` / raw `_fn`), then
canonicalize **once** at the outermost `differentiate()` call. Wolfram's flat
profile suggests the algorithm itself is near-free, so this could close most of
the gap.

**Measure / de-risk before committing:**

- Spike one rule path (e.g. product or chain rule) built structurally and
  re-measure, to confirm how much of the 30× is canonicalization vs. fixed
  `BoxedExpression`/GC overhead that deferral can't touch.
- Output must stay **identical** to today's canonical form — pin with the
  calculus snapshots. Note `.mul()` _distributes_ over sums (`k·(a+b)→ka+kb`)
  while a structural `Multiply` does not, so a naive swap can change result shape;
  build factored products deliberately and canonicalize at the top.
- `differentiate()` recurses — defer through the recursion and canonicalize only
  at the outermost level, not at each step.

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
  _(Deferred, churn: unconstrained `ln(x²)` stays the optimistic `2ln(x)` rather
  than the always-sound `2ln|x|`, matching `ln(x)+ln(y) → ln(xy)`.)_

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

### Documentation

- If Tycho/GP consumes this release: add a `loadIdentities` section to the
  importer guide in the Tycho repo (consumer-facing docs live with the
  consumer).

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
