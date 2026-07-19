# Compute Engine — Roadmap

**Last updated:** 2026-07-18.

This document tracks **remaining** work; an item leaves this file once it lands.
Detail on completed work lives in git history, `CHANGELOG.md`, the linked source
files, and `docs/rubi/RUBI.md` / `docs/fungrim/`.

## Current state

The 2026-06 release shipped:

- the Fungrim-derived identities library
  (`@cortex-js/compute-engine/identities`, 1,450 rules incl. 10 solve
  templates), the
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

**MathNet parser hardening (2026-07-04):** all four tiers of
`docs/mathnet/parser-hardening-plan.md` landed and are test-locked
(`ContinuationPlaceholder` crash, ellipsis/trailing-punctuation recovery,
Unicode relation tokens, congruence/divisibility, geometry heads; corpus
clean-parse 3/345 → 278/345, throws 9 → 0). Fresh unseen-sample validation
measured 97.4% clean parse with 0 throws/0 hangs; the remaining MathNet work
is a small notation tail tracked below.

**0.84.2 released 2026-07-18** (latest). The 0.74–0.84 line carried the
Tycho-compatibility rounds, the collection-operator-gaps + laziness waves,
the `broadcastable<T>` typing lift, conditional values (`When`/`Which`),
typed function literals, Mathematica-style surface forms, `NDSolve` adaptive
stepping + `NDSolveFunction`, and the disposition of the 2026-07
correctness/symbolic/performance reviews — see `CHANGELOG.md`. Earlier
milestones: **0.73.0** (2026-07-09; solving parity 38/40 with
SymPy/Mathematica, Rubi R13–R16, `Interpret`, number theory) and the 0.7x
`Measurement` MVP / control-flow-scoping / Desmos-lists releases.
Neyret-corpus parse coverage 92.9%; the remaining Desmos gaps are
importer-side (tracked in tycho's `COMPUTE_ENGINE.md`), not engine items.

**Cortex language shipped (2026-07-09):** the revived Cortex language
(parser, serializer, `executeCortex` interpreter — phases 0–5 of the revival)
is published as an **experimental** entry point
`@cortex-js/compute-engine/cortex`, joined to the code-splitting ESM build so
`executeCortex(ce, …)` shares engine-class identity with a host-created
engine. Residual ship items (docs sync to cortexjs.io, highlight-mode
validation) are release-protocol steps tracked in
`roadmap/cortex/STATUS_REPORT.md`, not here.

The June 2026 codebase review (REVIEW.md) is fully dispositioned. **Rubi
status:** R1–R30 + R8 landed — chapters 1/2/3/5/6/7, 4.1/4.3/4.5, §8.8 Polylogarithm,
6,574 rules bundled; see the **Coverage tracks → Rubi** section below for
current scores and next rungs (per-rung history in `docs/rubi/RUBI.md` §5).

**Related documents:** `docs/fungrim/FUNGRIM.md` (feasibility + feature map),
`docs/fungrim/FUNGRIM-PLAN-1…5` (executed architecture plans), `data/fungrim/`
(translated corpus + manifest), `scripts/fungrim/` (translator tooling),
`docs/rubi/RUBI.md` (Rubi integration), `benchmarks/` (cross-library harness +
`REPORT.md`, `BIGNUM-COMPARISON.md`).

---

## Remaining work

### Broadcast typing residue (`broadcastable<T>` lift landed 2026-07-17)

The lift itself shipped (record in `CHANGELOG.md` and
`docs/plans/2026-07-11-broadcast-typing-lift-design.md`). Genuinely
remaining, as separate demand-gated items:

- **Phase-2 declared-type reconciliation** for symbolic-length ranges (see
  the design doc). Two broadcast-lift Phase-2 test pins currently assert the
  declared type + Map form pending this item.
- **Param-type-driven lambda-body typing:** lambda BODIES over untyped
  params still type scalar — only applications are lifted; revisit only
  with a param-type-driven design.
- **Python broadcast compilation:** the Python target lowers arithmetic to
  infix and has no generic `_ce_bcastf` helper, so possibly-collection
  operands fail closed (interpreter fallback is sound). Build the helper
  only if a compiled-NumPy binding path is ever needed.
- **Matrix rank preservation in `broadcastResultType`:** matrix
  intermediates flatten to `list<number>` (rank lost) — pre-existing
  convention, someday-fix.

Interactions to respect: non-finite typing convention, `infer(unknown)`
destructiveness, scalar-requiring contexts (exponents, comparisons, plot
coordinates).

### Product feature track (agreed 2026-07-04)

CE is the foundation for Tycho / Graph Paper: an app helping scientists,
students and educators collaborate and communicate about scientific topics.
The 2026-07-04 capability survey against that goal found the engine strong on
plotting/compile targets, units & quantities, logic/sets, linear algebra,
equation systems, and number formatting — and thin in the areas below. The
agreed items (`Series`, trig rewrites, statistics Phases 1–2, the explain
API, significant-figures display, the `Measurement` MVP) have all landed —
the record lives in `CHANGELOG.md` and the design docs under `docs/plans/`.
What remains (effort S/M/L):

**Statistics residue (demand-gated Phase 3, design doc §10):** inverse
regularized incomplete gamma/beta kernels and the distributions that need
them (Student-t, χ², F, Geometric…), `RandomVariate` sampling (reuse the
`Sample` RNG/seed policy), and fit diagnostics (R²). Also: the Python
execution-parity suite for the new scipy mappings is guarded/skipped until
scipy is installed in `./venv`.

**Series residue:** bare `O(…)` parsing remains deferred (design doc §8 Q3);
revisit for lenient mode once the parser work settles. From the Puiseux/log
round (landed 2026-07-12), deliberate defers that could be revisited on
demand: log-carrying expansions at ±∞ (`1/ln x`, `ln(ln x)`, `sin(ln x)`,
`e^{1/x}` defer — correct-over-wrong), exact terminating expansions still
emit a conservative `BigO` (`assembleLaurent` has no exactness notion),
combined distinct radicals grow `lcm(d)` uncapped inside add/mul (bounded by
the deadline → clean defer), and `diffLaurent` asserts `d === 1` (polygamma
ladder only).

**Typed function literals residue (demand-gated, design doc
`docs/plans/2026-07-12-typed-function-literals-design.md` §10):** the typed
`Function`/`Typed` core landed 2026-07-12 (652a20fc). Deferred until a
consumer asks: **(S/M)** optional/variadic parameter annotations
(`["Typed", "xs", "'number+'"]` — the encoding already admits it; needs
`makeLambda` arity handling), **(S)** a strict-mode runtime check of the
result against the declared return type (returns are pure ascriptions today),
**(S)** LaTeX typed-parameter notation behind a serialization style flag
(annotations currently drop in LaTeX), and **(S)** signature-string sugar
(`["Function", body, "'(x: integer) -> real'"]` canonicalizing into the
structural form).

**MathNet parser tail (S/M; corpus at 371/428 CI-gated after the
2026-07-09 rounds):**

*Next up (agreed 2026-07-09):*

- **MATH genre-gap tail (S/M):** the Hendrycks MATH genre sweep (report:
  `docs/mathnet/math-genre-sweep.md`, tagged failures:
  `math-genre-failures.json`) stands at **97.66%** clean (371 of 735
  failures fixed) after the 2026-07-09 rounds. Remaining ranked tail:
  (1) styling remnants (11, mostly array-env/prose — low value);
  (2) units residue: `yd`/`qt`/`pt` and currency (`USD`, `cents`, `euro`)
  have no `unit-data.ts` symbols (adding them is a units-subsystem call,
  not parser work); spaced `\text{miles per hour}` (interior spaces are
  stripped before resolution); Quantity arithmetic does not cancel
  compound units (`18 in / (12 in/ft)` → `1.5 in/in/ft`, not `1.5 ft` —
  a Quantity-simplification item);
  (3) small leftovers: `\cancel` inside `array`-env `@{}`/`\cline`
  layouts, set-congruence `\{0,1\}+\{1,4\}\equiv…` (set arithmetic, out
  of scope), and possible future upgrades to `IndexedSequence`
  (lazy-collection semantics, the parenthesized `(a_n)_{n\in\mathbb{N}}`
  form).
  Ascii-pipe divisibility evidence doubled (36 more hits, tracked below).
  Skip: `array`-env long-division layouts, `\nabla` puzzle ops, repeating
  decimals `0.abab\overline{ab}`.
*Rest of the tail:*

- **Polynomial-ring notation (M):** parse blackboard-bold rings followed by a
  bracketed variable list, e.g. `\mathbb{Z}[x]`, `\mathbb{R}[X,Y]`, as an
  inert/structural algebraic object instead of treating `[...]` as indexing.
- **Set-image bracket notation audit (S/M):** `f[S]` is parser-clean today as
  `At(f, S)`; decide whether set contexts need a distinct structural
  function-image head for expressions such as
  `f[\operatorname{divs}(m)] = \operatorname{divs}(n)`.
**`Interpret` — generalization ladder (design:
`docs/plans/2026-07-09-ellipsis-interpretation-design.md`):** v1 landed
2026-07-09 — the explicit `Interpret(expr)` head turns continuation-bearing
sums/products into formal `Sum`/`Product` under a strict arithmetic-
progression gate (`1+2+\dots+n` → `Sum(k,(k,1,n))`; parity mismatches and
anything unproven stay inert); v2–v4 (polynomial/geometric recognition,
Berlekamp–Massey → `RSolve`, async OEIS-backed `ce.interpret`) followed.
Remaining, demand-paced:

- **Known edge:** `simplify()` on `-(2·4·\dots·2n)` distributes the outer
  sign into the product and folds (pre-existing).
- **Promotion decision** (after product usage): whether bare
  `evaluate()`/`simplify()` should invoke the recognizer by default.

Still deferred: ASCII-pipe divisibility (`p|a+1`) because it conflicts with
absolute-value syntax (though the parenthesized form `(a+f(b)) | (a^2+bf(a))`
is unambiguous and could be revisited); set arithmetic such as
`2\mathbb{Z}+1`; richer `array`/`cases` environment variants; prose-heavy or
fragment-boundary inputs that need surrounding natural-language context.

**Uncertainty/Measurement residue** (MVP landed 2026-07-07; design + phased
record:
[`docs/plans/2026-07-07-uncertainty-design.md`](./docs/plans/2026-07-07-uncertainty-design.md)).
Deferred:

- **Dual-number correlation tracking** (correct-by-default) — the documented
  upgrade past independent propagation, which over/under-estimates when one
  measured variable is reused across operands (`x·x`, `x/(x+1)`). A
  `BoxedMeasurement` carrier with per-source identity; the hard part is
  source-id stability across re-boxing (design doc "Non-goals").
- **Relative-error notation** (`±5%`) and **distribution/`RandomVariate`
  links** (reuse the statistics RNG/seed policy).

**Mathematica surface forms — deferred tail (need user steer before
attempting; landed record in the 2026-07-14 commits):** Tier 3 heads
(`NSolve` — cheap as Solve+N —, `FindRoot` with `{x, x0}`, `Reduce`); the
`{i, n}` 2-element iterator shorthand and bare-count `Table(expr, n)`
(rejected as malformed for cross-operator consistency — adopt everywhere at
once if ever); symbolic directional limits (`lim_{x→a⁺}` at a symbolic
point stays inert — representation correct, evaluation gap). Related open
parse question (not filed): number-juxtaposed bracket lists (`2[1,2,3]`)
don't parse; `2\cdot[1,2,3]` does.

**Not yet agreed (proposed 2026-07-04, awaiting a call):**

6. **MathML output + speakable text (M).** Communication and accessibility:
   MathML serialization for export/interchange (web, Word, EPUB) and a
   speakable-text serializer for screen readers. AsciiMath output already
   exists; MathML and speech are absent. Accessibility matters for the
   education audience.
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

- **defint error bar 1.6× optimistic on endpoint-singular integrands** —
  large (tanh-sinh quadrature).
- **Perf tail.** The 2026-07-01 performance review (P0–P3,
  `PERFORMANCE_FINDINGS.md`) fully closed 2026-07-18 — its status table
  records what shipped and, importantly, what was **measured unprofitable
  and must not be re-attempted without a new profile** (P2-2 `isSubtype`
  memo, P2-4 simplify-history scan, the `bignumRe` memo, P3-1 `.json`
  cache). Still open, measurement-gated: cold-start bundle size, and the
  post-drift-fix residual tail — 6 benchmark cases still < 0.95× vs 0.73.0,
  worst CE4 erf-integral 0.62× (case-specific integrate/simplify machinery
  growth, not box tax) — a candidate future perf item.
- **Loose-parsing low items:** infix calculator notation `5 nPr 2` is
  unsupported (a new-notation design item, not a map gap); explicit `_a`
  wildcards in arrow-string rules are a silent no-op (redundant there —
  auto-wildcarding covers it). `sqrt2x` → `√(2x)` is a deliberate policy
  (consistent with the bare-function convention `cos 2x` → `Cos(2x)`), not
  a bug.
- **Doc/cosmetic tail:** locale separators.
- ODE P2s — folded into the DSolve/NDSolve track below (**B12**).

### Symbolic capability gaps

#### B9. `Solve` — beyond the Wester ceiling

The Wester `Solve` score is saturated at our principled ceiling (14/21; the
last two gaps — `xˣ = x`, `sin x = tan x` — are harness artifacts: the
harness grades SymPy's arbitrary finite root-slices, not a CE capability
gap). The section is kept for that harness-artifact explanation, which the
Fungrim track cross-references. Genuinely open Solve items:

- **Diophantine deferrals** (Phase 3 shipped linear n-variable + Pell +
  Pythagorean triples; design record in
  `docs/plans/2026-07-04-solve-domain-design.md` Phase 3): sum-of-squares
  tier (fits a representation function better than Solve), general binary
  quadratics via `transformation_to_DN`, half-bounded-Range instantiation
  (currently inert by design), `factor_list`-style auto-factoring. Ternary
  quadratics deliberately skipped (low value); weighted-coefficient /
  ≥4-square parametrizations deliberately refused (textbook families are
  provably incomplete — the contract emits only complete families).
- **Inequality and system solving via `Solve`** remain partial (see
  `test/compute-engine/solve.test.ts` commented `@todo` cases); linear
  inequality systems are handled, general ones are not.
- The solve rule set is acknowledged incomplete (`solve.ts` "MOAR RULES",
  plus two deferred side-condition checks noted in-file).

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
`Solve`/`Resultant`/`GCD` heads (and, since 2026-07-10, `DSolve` — see B12)
through the real opt-in loaders. **Next:** add the Bondarenko integration
set. (Rubi chapter translation — the lever for the indefinite-∫ gap, with
Rubi now recovering 6 of the 8 hard Wester integrals — is its own track: see
**Coverage tracks → Rubi**.)

#### B12. ODE solving — `DSolve`/`NDSolve` beyond the first slice

`DSolve` now covers first-order linear (integrating factor),
constant-coefficient homogeneous up to order _n_ (numeric characteristic roots
with clustering), nonhomogeneous constant-coefficient with polynomial, sine,
and exponential forcing via undetermined coefficients — including resonance
(forcing `sin(ωx)` when `±iω` is a characteristic root) and orders ≥ 3 —
second-order Cauchy–Euler (homogeneous and, since 2026-07-18, nonhomogeneous
via an x-power indicial ansatz with a variation-of-parameters fallback), the
Airy family `y″ = (px+q)y` (`AiryAi`/`AiryBi`, with new `AiryAiPrime`/
`AiryBiPrime` operators and full derivative closure), the first-order
nonlinear classes (separable with _implicit_ `F(y) = G(x) + C` solutions,
Bernoulli `v = y^{1−n}`, first-order homogeneous `y′ = F(y/x)`, exact
`M dx + N dy = 0`, and Riccati — constant-particular, plus the
`y = −u′/(q₂u)` Airy linearization for `y′ = q₀(x) + q₂y²` with linear `q₀`),
first-order linear systems (distinct eigenvalues, diagonal with repeats, and
defective 2×2 via a generalized eigenvector, gated on an exact `(A−λI)² = 0`
check so near-repeated numeric eigenvalues stay inert), and initial/boundary
conditions (solving the linear system for the integration constants).
`NDSolve` integrates adaptively (Dormand–Prince 5(4) with dense output;
scalar, higher-order reduction, and first-order-system forms). Unsupported
forms stay **inert rather than wrong** — preserve that contract as coverage
grows. (The constant-coefficient Abel rung — dead code shadowed by the
separable rung — was removed 2026-07-18.)

The CE-vs-SymPy audit harness (`benchmarks/audit/dsolve.ts` +
`gen_dsolve.py`, substitute-back residual oracle, 51-case corpus seeded from
SymPy's `test_ode.py`; landed 2026-07-10) grades **CE 50/51 correct, 0
wrong — at parity with SymPy (50/51)** after the 2026-07-18 frontier round
(BY1 Riccati→Airy — which SymPy errors on —, BY3 nonhomogeneous
Cauchy–Euler, BY4 Airy, BY5 repeated-eigenvalue system). The one remaining
`unsupported` row is **variable-coefficient second order**
(`sin(x)y″ + y′ = cos x`), where SymPy's "solution" is nested unevaluated
integrals — a `p = y′` reduction-of-order rung would need to emit
inert-integral-carrying results to match, a contract question before it is a
coding task. Ranked next steps (good contributor territory):

- **`NDSolveFunction` system form:** `NDSolve` is adaptive (Dormand–Prince
  5(4) with dense output, landed 2026-07-18) and `NDSolveFunction` returns a
  callable `Function(InterpolatingFunction(data, x), x)` — but **scalar
  forms only**; the multi-dependent system form stays inert. A
  vector-valued interpolating result needs a shape decision — demand-paced.
  Known engine-level quirk (pre-existing, pinned in tests): applying a
  MathJSON-**re-boxed** literal resolves the interpolation one `evaluate()`
  late (`N()` is immediate).
- **Tolerance hardening** in the numeric characteristic-root clustering, so
  near-degenerate roots are grouped reliably as coverage of higher-order
  nonhomogeneous problems grows.
- **Adjacent, reusing the same kernel:** a
  `LaplaceTransform`/`InverseLaplaceTransform` pair (currently inert) — a
  capability on its own and a second, independent route to constant-coefficient
  IVPs that cross-checks the initial-conditions work. (`RSolve` already reuses
  the characteristic-polynomial / root-multiplicity machinery for linear
  constant-coefficient recurrences, with an `rⁿ·n^k` basis instead of
  `e^{rx}·x^k`.)
- A proper `DiracDelta` (for derivatives of step functions, currently 0
  a.e.) remains a possible future refinement.

#### B13. Wester capability gaps — the skip ledger in `wester.test.ts`

`test/compute-engine/wester.test.ts` is the CI correctness suite transcribed
from Wester's CAS review (the categories the `benchmarks/audit/wester.ts`
harness cannot ingest). The convention: a gap exists there as a `test.skip`
asserting the **correct** answer — unskipping is the acceptance test. The
2026-07 campaign worked the ledger from 18 skips down to **one**:

- **Wester 9 — recursive denesting** (the Putnam radical
  `√(14+3√(3+2√(5−12√(3−2√2)))) → 3+√2`): only single-level
  `√(a+b√c)` denesting is implemented; the multi-level/recursive case is a
  deliberate algorithmic project (Landau/Blömer-style).
- **Linear algebra residue** (not skip-representable, tracked here):
  matrix square root beyond exact 2×2 (n×n wants eigendecomposition or
  Denman–Beavers); exact singular values beyond a 2×2 Gram matrix. Two
  wester tests are active-but-weakened rather than skipped (stale "skipped"
  comments in-file): fused-form `row-vector · (a·M1 + M2)` asserts the
  current `MatrixMultiply` type rejection, and the symbolic Vandermonde
  determinant is spot-checked numerically because `Factor`/`simplify`
  leave it unfactored (a `/(−w+x)` division artifact).
- Missing heads noted in comments: `MatrixExp` (`Exp` of a matrix
  broadcasts elementwise — it is *not* the matrix exponential), matrix
  functions generally (sine of a matrix), Jordan / Smith normal forms
  (→ B14).
- Closed-form table growth for infinite sums/products (beyond the
  `namedSeriesClosedForm` table landed 2026-07-18 — e.g. `β(4)`,
  Hurwitz-shifted bases `(k+m)^{−s}`, higher moments `Σk²rᵏ`) remains
  demand-paced.

Untranscribed corpus categories (future tranches): systems of equations /
congruence solving, special functions, transforms, ODEs/PDEs (→ B12),
vector/tensor analysis, numerical analysis.

#### B14. Wester representation gaps — problems the suite cannot state

Distinct from B13: these Wester problems have **no CE API to express them**,
so they cannot exist as `test.skip`s — each needs a naming/design decision
first, then its acceptance test goes into `wester.test.ts`. Mathematica
spellings are deliberately NOT aliased (decision 2026-07-05); the
Mathematica→CE correspondence table lives in
[`docs/MATHEMATICA-NAMES.md`](./docs/MATHEMATICA-NAMES.md) — **probe CE's
own names before adding an entry here** (many presumed-missing heads exist
under CE names: `NthPrime`, `NPartition`, `PowerMod`, `ModularInverse`,
`StirlingS1`, `Rationalize`, `PrimitiveRoot`, `ContinuedFraction`,
matrix ∞-`Norm`, `BaseForm`, finite-domain `ForAll`/`Exists`).

- **Repeating-decimal representation — producer direction:** an equivalent
  of `ToPeriodicForm`, rendering an exact rational as its periodic-decimal
  object (the LaTeX serializer's `repeatingDecimal` option covers only
  float display; the consumer direction — repeating-decimal literals boxing
  as exact rationals — is done).
- **Quantifier elimination over ℝ:** `ForAll`/`Exists` evaluate only over
  finite domains; the Wester/Liska–Steinberg stability problems need QE over
  real closed fields (CAD or virtual substitution) — a major subsystem,
  catalogued here for completeness, not planned.
- **Matrix decompositions & functions:** `MatrixExp` / general matrix
  functions (`Exp` of a matrix **broadcasts elementwise** — the footgun is
  documented, but an actual matrix exponential remains future work);
  symbolic singular values (`SVD` is float-only); Jordan / Smith normal
  forms; symbolic Frobenius norm (`Norm(M, 'Frobenius')` for symbolic
  entries).
- **Hypothesis testing:** `MeanTest` etc. — undeclared; only worth pursuing
  if the statistics track (GP items) calls for it.

#### B15. Parameter-conditional results — the last `Which` producer

The conditional-values design
([`docs/plans/2026-07-12-conditional-values-design.md`](./docs/plans/2026-07-12-conditional-values-design.md))
is ratified and its Phases 1–3b landed: `When` threading algebra, the Solve
adopter (trig/hyperbolic validity + radical extraneous-root guards), and the
convergence-conditions adopter (improper-integral endpoint guards, geometric
series `1/(1−x) {|x|<1}`). Remaining:

- **Definite-integration region splitting (`Which`) — the only open
  producer.** Motivating case:
  `∫_{−π}^{π} (1 − x·cos t)/(x² − 2x·cos t + 1) dt` = `2π` for `|x| < 1`,
  `0` for `|x| > 1` — CE correctly stays inert today; locating where poles
  cross the contour is the hardest part and stays with this adopter.
- **Cosmetic residual:** an unsatisfiable conjoined guard (`∫₀^∞xᵖdx`)
  displays rather than collapsing — needs contradiction detection in
  assumptions; not worth it standalone.
- **Known Phase-1 limitation** (accepted, revisit on evidence): a
  conditional nested under a lazy operand (`5 − When(x,c)`) lifts fully
  only on a second `evaluate()`; the guard is never dropped.

### Collections — laziness & fusion backlog

The 2026-07 laziness audits (rounds 1–2 + review rounds, all landed by
2026-07-17) left a ranked backlog:

- **Finiteness guards / lazy delegation (T1/T2):**
  `DictionaryFrom`/`RecordFrom`/`Position`/`CountIf` full-walk with no
  `isFiniteCollection` guard (hang on infinite input); `Find` hangs on
  infinite-no-match; `Insert`/`DeleteAt`/`ReplaceAt` are lazy-feasible via
  index-arithmetic delegation (Append/Rest recipe); `Partition` size-n/step
  forms, `SlidingWindow`, `ChunkBy` are streaming-feasible. Lower priority
  (T3): `Keys`/`Values` (dicts are small), `Chunk` (needs count only).
- **Fusion/rewrite layer — open design decision (user has not ruled).** No
  structural rewrite layer exists; lazy facet delegation gives O(1)
  `Count`/`At` through lazy chains, and canonical peeks now cover
  `Length`/`Count`/`IsEmpty`/`Contains` over `Sort`/`Shuffle`/`Reverse`/
  `Unique` — but any broader `Count(f(x))`-through-eager-op cheapness needs
  canonical-level rewrites, a churn-heavy direction to decide deliberately.
- **Latent issues flagged, not fixed:** `Apply(inline-lambda,
  unknown-collection)` maps over a dangling scoped param (pre-existing
  `applyFunctionLiteral` capture); `.N()`-inertness of a *user-written*
  `Map(...).N()` body (the broadcast-built arm was fixed); the validate.ts
  `isFiniteIndexedCollection` inference loop eagerly counts
  `Filter(Range(1e5))` and can throw iteration-limit before the lazy guard
  (pre-existing); `Sort`/`Shuffle` `type:` handler is slightly loose for a
  List result (harmless, untested).
- `At`'s evaluate handler carries an in-file `@todo` — "implementation does
  not match the description" (`library/collections.ts` ~2507) — needs a
  think-through pass.

### Coverage tracks

Two opt-in libraries extend coverage **without touching the core engine**:
**Rubi** (integration rules, `loadIntegrationRules(ce)`) and **Fungrim**
(identities, `loadIdentities(ce, { solve: true })`). The remaining Wester gap to
SymPy is concentrated and maps cleanly onto these, so each is a self-contained
track measured by **its own suite** — the 48-case Wester harness is a
spot-check, not the scoreboard. The two tracks are independent and should not
gate each other.

#### R. Rubi — integration coverage by chapter

**State (2026-07-12, R1–R30 + R8 landed):** the shipped bundle
(`src/compute-engine/rubi/rubi-rules-data.json`, via
`@cortex-js/compute-engine/integration-rules`) contains **Chapters 1
(Algebraic), 2 (Exponentials), 3 (Logarithms), 5 (Inverse trig), 6 (Hyperbolics),
7 (Inverse hyperbolic), 4.1 Sine, 4.3 Tangent, 4.5 Secant, and §8.8 Polylogarithm**
— 6,574 rules, 6.98 MB (CI has a bundle-freshness gate). Scores (seed 5): **4.1
Sine 107/120 and 331/400 (4.1.11 file 93/113, post-R18)**, **4.3 Tangent 72/120**,
**4.5 Secant 69/120**, **ch3 Logarithms 70/120 (post-R25 re-baseline)**,
**Chapter 5 Inverse trig: 5.1 sine 65/120, 5.2 cosine 76–78 (verify-deadline
flutter band), 5.3 tangent 64 (post-R28), 5.4 cotangent 62, 5.5 secant 56,
5.6 cosecant 52 (≥375/720 ≈ 52%; R27 +19 on 5.1/5.2 via the
poly×trig-product reduction closing the reciprocal-arcsin/arccos family;
earlier: R24 +15 via the complex-argument Erf/Erfi kernel, R23 +5 via the
InvTrig^n multiple-angle → CosIntegral reduction; 5.5/5.6 scores predate
R25–R28 re-runs)**, **Chapter 7
Inverse hyperbolic (R22): 7.1 sine 79/120, 7.2 cosine 51,
7.3 tangent 85, 7.4 cotangent 95, 7.5 secant 44, 7.6 cosecant 54 (408/720 =
56.7%, R22 +2 — ch7's hyperbolic sub-integrals were already covered by the
ungated `containsHyperbolic` fallback)**, **ch1 1.1 Binomial products 112/120
(post-R28)**, **1.1.3 General 185/200 s200 (post-R28: unsolved 6 → 1; the
survivor #259 is an integer-power rational)**, ch1 exhaustive ≈90–91%,
ch2 ≈72% effective (seed 42), **ch6 Hyperbolics 73/120 (s120 seed 5,
post-R30-reorder 2026-07-11; 0 wrongs)**,
Wester indefinite-∫ 6/8. Per-rung history (R1–R30, each rung's mechanism,
score deltas and dead ends) lives in `docs/rubi/RUBI.md` §5 and git history
— it is deliberately not repeated here.
**Genuine wrongs are 0 across all suites** — every flagged "wrong" is a documented
**verification false-wrong** (numeric ₂F₁/AppellF1
mis-grading at non-integer symbolic-exponent substitution; `√(sin²)=|sin|`;
cube-root/fractional-power branch at negative x): before believing a wrong
flag, differentiate the
antiderivative back and compare at integer substitutions. The trig routing
lives in the runtime layer (`rubi-utils.ts`/`driver.ts`): argument-aware
`deactivateTrig` (only x-free/linear/bare-monomial args inert — composite
quadratic/√-inner args stay ACTIVE for the substitution rules),
`cofunctionShift` (`sec → csc[θ+π/2]` and, since R12, `cot → −tan[θ+π/2]`,
both default-ON; the mixed-cross-pair decline gate keeps `(g·cot)^p(a+b·sin)^m`
on `unifyInertTrig`'s matched-±π/2 clauses),
`unifyInertTrig` + its cofunction product clauses, `standaloneCosineShift`,
`reciprocalToPower` (frozen under fractional powers — branch safety; since
R13 it also keeps REFLECTION-produced `csc[·+π/2]` heads raw — the +π/2
shift signature — so pure-sec binomials `(a+b·sec)^n` reach the 4.5.1
csc-binomial rules, with a `(a+b·sec²)^p`-Power exception routing 4.5.7 to
the sin/cos rules), and
five driver fallbacks (trig→exp with a numeric-evaluability self-check;
R15's rational×sin/cos(linear) → Si/Ci partial-fraction split with a
central-difference D-self-check (R18 extends it to irreducible-quadratic
denominators via `expandRationalOverComplexLinears`, splitting over
complex-conjugate linear roots → complex Si/Ci that recombine real, behind
`RUBI_NO_SICI_COMPLEX`); R16's poly×csc²/sec²(linear) by-parts;
R17's `singleAngleTrigExpFallback` — `∫P(x)·R(trig(w))` with `w` linear and an
additive `(a+b·trig)` denominator, rewritten via `y=E^{iw}` +
partial-fractions and routed through the §2.2→Ch3→§8.8 PolyLog telescope,
fail-closed D-check; native-rational). A/B env switches:
`RUBI_NO_FOUNDATION`, `RUBI_NO_RECIP`, `RUBI_NO_COFN`, `RUBI_NO_COFN_COT`,
`RUBI_NO_SKELETON`, `RUBI_NO_SICI`, `RUBI_NO_SICI_COMPLEX`, `RUBI_NO_SECBIN`,
`RUBI_NO_TRIGSQ`, `RUBI_NO_TRIGEXP`, `RUBI_NO_TRIGSUB` (R22 subproblem
trig-bridge), `RUBI_NO_R25` (R25 quartic-denominator ExpandIntegrand guard),
`RUBI_NO_R26` (R26B rational-normal-form retry in the exp-substitution
fallback), `RUBI_NO_R27` (poly×trig-product reduction fallback),
`RUBI_NO_R28` (R28a mixed-parity Laurent-numerator × binomial-radical
linearity split), `RUBI_NO_R29` (R29 algebraic-in-hyperbolic
`u = Sinh/Cosh/Tanh[v]` substitution fallback), `RUBI_NO_R30` (R30
rational-in-hyperbolic cyclotomic-factored `t = e^v` substitution fallback),
`RUBI_NO_R8` (R8 poly×single-angle-hyperbolic → single-exponential `y = e^w`
PolyLog fallback).

**Driver-determinism residual (2026-07-18):** route selection still has
wall-clock-sensitive seams (budget-relative simplify slices
`min(remaining, 5000)`, `ce._timeRemaining` guards) — under extreme
synthetic load heavy families can still flake between solved and inert. The
principled follow-up is O(nodes) pre-filters / absolute caps on speculative
sub-routes, replacing budget-relative slicing. (Two independent budgets
trap: `loadIntegrationRules(ce, { timeLimitMs })` (default 10 s) is
independent of `ce.timeLimit` — heavy tests must raise both.)

**Benchmark protocol.** `npx tsx scripts/rubi/benchmark.ts --rubi
"data/rubi/corpus/4 Trig functions" --chapter "4 Trig functions/4.1 Sine"
--sample 120 --seed 5 --report /tmp/x.json`. Always pass `--report` (the
default path clobbers the committed baseline); `--rubi` mode preloads the
ch1/2/3/**4.1/4.3/4.5**/5/6/7/§8.8 foundation (matching the shipped bundle so it
measures the integrator as it ships — `RUBI_NO_FOUNDATION` to disable;
**pre-2026-07-04 4.1 baselines are not comparable**); run suites
**sequentially** — concurrent benchmark runs contaminate each other's
driver/verifier timing. NB: a `--rubi` target that is a Chapter-4 SUBSECTION
(e.g. `.../4 Trig functions/4.1 Sine`) resolves `corpusRoot` to the ch4 dir,
so no foundation loads and the driver-only score (58) understates the shipped
§4.1 Sine (107, `loadIntegrationRules`) — measure ch4 sections via the shipped
bundle, not `--rubi` on the subsection.

**Kernel status.** The complex-argument `ExpIntegralEi`/`SinIntegral`/
`CosIntegral`, negative-order incomplete Γ, and hyperbolic `Shi`/`Chi`
kernels are all in (mpmath-validated; see `docs/rubi/RUBI.md` §5 R18/R21 for
the branch subtleties). Remaining: hard cubic-and-higher x-denominator
Si/Ci shapes still decline cleanly (unsolved, not wrong).

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

**Next rungs (priority order).** Each is a self-contained work item: do the
change, then verify with the benchmark command above (watch `solved-correct`
climb while genuine `wrong`/`not-evaluable` stay 0 — but see the R2 note on
hypergeometric verification false-wrongs). Diagnose any stall per the Method
note — trace the residual integrand, don't trust the predicate census.

- **Ch3 unsolved tail** (43/120 at s120 seed5, post-R20; was 45 post-R19).
  **R19 censused all 46** and found one bounded fix: `FunctionOfLog` (→ #261).
  The residual splits into **15 expected-`Unintegrable`** (Rubi itself returns
  unevaluated — CE's inert `Integrate` is the correct match, not a defect) and
  **~30 genuinely deep**. Next-rung shopping list from the census (see
  `docs/rubi/RUBI.md` §5 R19/R20 for the full family table):
  - **Biggest family: poly×log by-parts residuals** bottoming in
    `∫artanh(√)/x`, symbolic-order-`k` `PolyLog` recurrences, or
    `ArcSinh·Log` (3.1.4/3.1.5) — shapes the bundled ch5/ch7 base cases
    don't reach. A symbolic-order `PolyLog` recurrence remains the lever.
  - **6: `∫Log[Sin/Tan/Csc²]`** (3.5) — a two-part gap: an inert-trig `D`
    reduction (CE's `D` knows `Tan`, not the inert `tan` head the driver
    carries) PLUS a Chapter-4 trig-integration foundation for the by-parts
    sub-integral (only 4.1/4.3/4.5 bundled).
  - **4 (D): `∫Log[·]/rational`→`PolyLog[2]`**; **3 (E): `(a+b·Log[c(d+ex)ⁿ])^p
    × rational` half-integer residuals**; **4 (F): fractional/negative power in
    the log arg → `Gamma`/`Ei`/`LogIntegral`** with `x^(2/3)`/`e/√x`
    substitution. All need new production/kernels, not bundling.
- **R3′ — residual half-integer/elliptic chains.** #604/#609/#1395 were closed
  by R9's cosine shift, #294 by R17's exp-route telescope; what remains is the
  genuinely deep tail: #53 (23-step half-integer Fresnel chain), #248 (48
  steps), plus the composite `cot^m/(a+b·sin)^n` / `(a+b·sin²)^(p/2)`
  tan/cot-power recursions (4.1.1.3 / 4.1.7), which may fold into R5.
- **R5 — `TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions). _Low value /
  optional:_ the predicate census over-weights it (it's a late catch-all, not a
  blocker). Only pursue if R14/R3′ leave a concrete residual class that needs
  it — one confirmed member so far: #93 (`csc^(−1/2)·sin` cancellation). A
  related deferred item from R9: a proper circular `TrigReduce`
  (multiple-angle elementary form) for `sin^n` products — the exp-form
  reduction works but verifies past the harness budget and preempts trig-form
  rules chapter-wide, so it was deliberately gated off.
- **Ch5 residual — ₚFq only.** The rung ladder closed the chapter's
  structural gaps in sequence: R22's bridge (`RUBI_NO_TRIGSUB`) closed the
  `∫f(x)·Cot[x]`-bottoming family (294 → 331), R23's `circularTrigReduce`
  closed the `∫x^m·ArcSin^n/√(1−c²x²)` (n<0) family (331 → 336), and
  **R27's `polyTrigProductReduce` closed the mixed `∫θⁿ·Sinᵐ·Cosᵏ` inner
  integrals of the reciprocal-arcsin/arccos class** (5.1 57→65, 5.2 67→78 —
  the former residual (a)). What remains: only the ₃F₂/`HypergeometricPFQ`
  terminal forms, which need a generalized ₚFq head CE lacks (out of scope).
  _(The formerly-listed "complex-Erfi evaluator" residual is stale —
  verified 2026-07-10 post-R27: the fractional-`n` family's complex-`Erfi`
  results numericize via the R24 kernel, and the sole remaining
  `not-evaluable` row in each of 5.1/5.2 (s120 seed5) is a ₚFq terminal.)_
  Ch7's analog is smaller and already covered (arsinh → hyperbolic
  fallback).

**Exponential** (Ch 2, 125 rules) and **hyperbolic** (Ch 6, 390 rules) are
bundled; the former R6/R7/R8 items all landed as rungs R25/R26/R29/R30 (see
`docs/rubi/RUBI.md` §5). The remaining Chapter-6 residual is mostly shared
capability rather than Ch6-specific:

- **R6′ tail:** the residual-degree-≥4 function-of-exp rows
  (`Sinh⁶/(a+b·Cosh²)`, `Csch⁴/(I+Sinh)²`, `Sinh⁴/(a+b·Sech²)²`,
  `Coth⁵/(a+b·Coth)`) whose symbolic quartic-or-higher residual needs a
  genuine root-finder — out of a contained rung's reach — plus 7
  expected-`Unintegrable` (Rubi itself returns unevaluated there; CE's
  inert `Integrate` is the correct match).
- **R8 follow-ups:** (1) extend the shared linear-factor partial fraction
  (`expandRationalOverLinears`) to REPEATED (`Csch²`/`Coth²` →
  `(y−1)²(y+1)²`) and COMPLEX (`Tanh` → `y²+1`) denominator roots —
  #243/#408/#455 decline structurally today, and the extension also reaches
  the analogous R17 trig rows; (2) the by-parts-only tail (rows whose
  numerator hyperbolic is itself a POWER in the additive denominator, e.g.
  `a+b·Sinh⁴`) still wants genuine by-parts machinery.
- **R29 residual:** the bare `(a+b·Sinh²)^(3/2)` even-parity shape
  (genuinely EllipticE/F), the ₚFq row #518, and the
  `√(Sinh·Tanh)`/`√(Cosh·Coth)` quarter-power oddballs (6.7.1 #560/#563).

#### F. Fungrim — solving coverage

**Decoupled from Wester.** The two remaining Wester `Solve` gaps are harness
artifacts (B9), so additional Fungrim solve rules will **not** move that number
— the Wester `Solve` rows are saturated at our principled ceiling (14/21). On
the track's own benchmark (`benchmarks/audit/solve.ts` / `REPORT-solve.md`,
40 SymPy-derived univariate cases) **CE+Fungrim is at parity — 38/40 = SymPy
= Mathematica (base CE 33) — and this track is done as a coverage effort.**
Residual, none benchmark-reachable:

- **FR1/FR3** (Dottie-style transcendental fixed points): unsolved by SymPy
  and Mathematica too — outside the closed-form ceiling, not a gap to chase.

(Fungrim's _simplify_-side work is separate again — see Strategic item 7,
Fungrim Phase 4.)

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
  Complex-domain Fungrim rules already carry their own loader guards. (The
  generic-real simplification policy for even/odd/irrational exponents is
  settled and documented in
  [`docs/SIMPLIFY.md`](./docs/SIMPLIFY.md#generic-real-simplification-policy).)

- **(c) Exact asymptotics at special-function poles — one rung remains**
  (the kernel, residue-at-∞, signed pole limits, and `Beta` pole data all
  landed; design + record in
  [`docs/plans/2026-07-10-pole-asymptotics-design.md`](./docs/plans/2026-07-10-pole-asymptotics-design.md);
  `GammaLn` is a genuine non-goal — logarithmic branch point, not
  meromorphic). Demand-paced:
  - **Sum-of-residues-in-a-region helper** — needs a pole-enumeration API
    over the analytic-property store.

**Effort:** (a) residual and the (c) rung are each small-to-medium,
self-contained items.

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

#### 10. TypeScript 7 — retire the TS 6 compat alias

**Landed (2026-07-08):** the CLI compiler is TS 7 (native), installed
side-by-side per Microsoft's recommendation: `@typescript/native`
(npm:typescript@7) drives the `.d.ts` build (`build.sh`, ~31s → ~5s),
`typecheck.sh`, and the declaration-type test (reworked off the removed
`--baseUrl`); the module name `typescript` is aliased to the TS 6 API
(`@typescript/typescript6`) because **TS 7.0 ships no programmatic API**, and
ts-jest, typedoc, typescript-eslint, and madge all require one. TS7-vs-TS6
declaration output verified type-identical (cosmetic emission diffs only).
Note: both packages ship a `tsc` bin, so scripts reference the native binary
by explicit path — bare `npx tsc` is ambiguous (it currently resolves to TS
6.0.3 via the compat package's internal `@typescript/old` dependency).
The nodenext source-import codemod (former item (b)) landed the same day
(`cced4d27`): all relative imports in `src/` carry explicit `.js`/`/index.js`
specifiers, jest strips them via `moduleNameMapper`, ESLint resolves them via
`eslint-import-resolver-typescript` (required for `import/no-cycle` to keep
following edges), and the `fix-dts-extensions.mjs` post-processor is retired —
declarations are nodenext-correct natively, gated by the consumer smoke test.
**New-file convention: relative imports in `src/` use `.js` specifiers.**

**Remaining:** drop the TS 6 compat alias once TS 7.1 ships its (new,
different) programmatic API **and** ts-jest/typedoc/typescript-eslint/madge
support it. Until then the side-by-side install is the intended end state,
not a hack.

**Effort:** small once the ecosystem is ready.

### Correctness & symbolic findings (2026-07) — residue

The July 2026 correctness and symbolic reviews are fully dispositioned: every
verified P0 and P1 landed across the Wave 1–4 commits, and the **P2/P3 sweep
itself completed in the tail-phase rounds 8–10** (`72f3a353`, `f5e0e339`,
`a2b78928`, plus the P2-1 dispatch index `8667a0aa` and the benchmark
capstone `c20a4b2e`) and the follow-on round (`e65eee11` complex-type
inference, `99fa7276` D12-A exact Gaussians + parser perf, `c4def410`
non-finite typing convention). The findings docs are kept for the record —
[`CORRECTNESS_FINDINGS.md`](./CORRECTNESS_FINDINGS.md),
[`SYMBOLIC_FINDINGS.md`](./SYMBOLIC_FINDINGS.md), with the full
implementation log, the closed-as-measured-no-wins list (do not re-attempt
without new evidence), and the residual inventory in
[`docs/reviews/2026-07-findings-tracker.md`](./docs/reviews/2026-07-findings-tracker.md)
(see its "RESUME HERE" section). What remains from the reviews is that
residual tail: the item-4 filed residuals (Artanh/Arcoth-class literal
poles, `∞+i` numeric-value finiteness, the `~oo` lattice question, the
`Multiply(x, +∞)` fold positivity review), the non-blocking tracked
residuals (fu `sin⁴−cos⁴`, defint error-bar/tanh-sinh, machine `gamma()`
mid-range digits, …), and the item-5 perf levers — of which only bundle
cold-start survives: the cache-shaped levers were closed measured-unprofitable
by the 2026-07-18 P2/P3 tail (see `PERFORMANCE_FINDINGS.md`; do not
re-attempt without a new profile).

**Stage-2 corpus audit findings (2026-07-10)** — the per-topic numeric sweep
(all 57 topics; the two upstream formula bugs it caught — a172c7, b16177 —
are fixed in the fork and PR'd) surfaced three engine/tooling items; **all
three are fixed** and the full-corpus Stage-2 run now grades **0 False**
(True 1589, seed 42, 142 s, no kill guard):

- the P1 deadline escape in the numeric limit prober (probe-path
  `iterationBudget` on compiled `Sum`/`Product` loops, ladder deadline
  checks, `extrapolate` default `power` corrected 2 → 1 — `const_gamma/4644c0`
  and `pi/dea83d` now converge to γ/π in milliseconds);
- the `Count(Range(1, n))` collapse, including the iteration channel
  (symbolic-bound `Range`/`Linspace` stay inert through `count`/`at`/`eq`/
  `subsetOf`/`eltsgn`, `iterator`, materialization, and every fold seam);
- the set-builder mistranslation (fork `4b88330`: comprehensions emit
  `Map(Filter(S, Function(P, x)), Function(f, x))` instead of a literal
  `Set`; +9 recovered simplify rules incl.
  `Count(Filter(Primes, p ≤ x)) → PrimePi(x)`, artifact 1450). The
  follow-on optimum image sets (`Min/Max/Supremum/Infimum` over a
  comprehension, the last carrier of the literal-`Set` fiction) are
  re-encoded too (fork `a832b59`), after CE's extrema learned to keep
  unenumerable collection operands symbolic instead of grinding an
  `Interval`'s dyadic sampler to the deadline or silently dropping a
  declined operand.

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

### Test-suite ledger — skips and `@fixme` markers (sweep 2026-07-18)

Deferred capability recorded directly in the test suite (beyond the Wester
ledger, B13). Each entry's acceptance test already exists:

- **Simplification gaps** — 13 `test.skip` in `simplify.test.ts`, with
  rationale mirrored as `test.todo` in `simplify-noskip.test.ts`: common
  denominator for rational expressions (`1/(x+1) − 1/x → −1/(x²+x)`);
  ln→inverse-hyperbolic recognition (six identities, e.g.
  `ln(x+√(x²+1)) → arsinh x`); inverse-trig conversion
  (`arctan(x/√(1−x²)) → arcsin x`); `factor()` extracting common factors
  from `Add` (`2π+2πe < 4π → 1+e < 2`); `(−x)^{3/4}`;
  `ln((x+1)/e^{2x})` (canonicalization expands before log rules fire); the
  Fu-paper Phase-14 multi-step trig identity.
- **Parser `@fixme` clusters** (latex-syntax tests): pre-sub/superscripts
  (`_p^qx`, `\vec{AB}` over multi-letter args — `supsub.test.ts`); chained
  `\over` mis-association (`errors.test.ts`); postfix `\degree` precedence
  (`trigonometry.test.ts`); range endpoints leaking outside `Range`
  (`n+1..n+10` — `collections.test.ts`); partial-derivative fraction forms
  `\frac{\partial^2}{\partial_{x,y}} f(x,y)` (2 skips,
  `operators.test.ts`); Set round-trip failure (serializer emits
  `\lbrace`, parser expects `\{` — `arithmetic.test.ts`); malformed
  integrand `\int\frac{3x}{5dx}` not rejected (`calculus.test.ts`);
  lowercase-arrow `Implies`/`Equivalent` expectations outdated by the
  issue-#156 `\rightarrow`→`To` change (`logic.test.ts`).
- **Numeric known-wrongs** (nightly + unit markers): bignum `Arccos` near 1
  loses ~8 digits (endpoint cancellation; per-case skip in
  `mpmath-kernels.test.ts`); `ζ(−0.5)` ~4 ulp (tolerance-relaxed); bignum
  `Complex` components truncated at canonicalization regardless of
  precision (`canonical-form.test.ts` `@fixme`); one `Multiply` inexact
  case where the big-precision path is worse than machine evaluate
  (`arithmetic.test.ts` `@fixme`).
- **Misc:** dictionary error validation (invalid/empty/extra tuple keys
  don't throw — 3 `@fixme` skips in `dictionary.test.ts`); SymPy-interop
  literal parses `0`/`0e0` (`test/math-json/sympy.test.ts`, see the interop
  stubs below); range/interval membership assumptions not wired
  (`assumptions.test.ts` `@fixme` setup lines); malformed
  positional-parameter name `_1_0` in a `Function` snapshot
  (`functions.test.ts`); the `grudnitski.test.ts` equivalence benchmark
  keeps 9 `describe.skip` groups (equation-scaling / identity-based
  `isEquivalent` capabilities).

`test/playground.ts` remains the tracker for its own residue (notation
decisions, Iverson/Boole and inequality→`Range` wishlist, matcher
internals).

### Source-marker backlog (`src/` sweep 2026-07-18)

Significant in-code `@todo`/`@fixme` not already covered by a section above:

- **SymPy interop is stubbed:** `math-json/serialize-sympy.ts` (special
  values/heads, lambdas, strings unhandled) and `math-json/parse-sympy.ts`
  (atom/attributeref/subscription/slicing/call grammar not covered). Decide
  whether this surface is worth finishing or should be retired.
- **Operator-signature type arguments:** the result-type/`at`-handler
  consistency warning in `boxed-operator-definition.ts` is disabled — needs
  generic type arguments in signatures (`Map`/`Filter` return an indexed
  collection iff the input is indexed).
- **Declared-symbol validation** deferred at `latex-syntax/parse.ts` ~2459
  (declared symbols not checked against existing symbol/function/inferred
  uses; likely belongs in canonicalization).
- **Issue #189** simplification case referenced in `simplify-rules.ts`.
- **Compile targets:** GLSL `TODO(E3-GLSL)` (needs loop unrolling or
  fixed-size arrays, `base-compiler.ts`); the public per-operator `compile`
  handler has no preamble/helper-injection hook, so GLSL/WGSL custom loops
  aren't ergonomic — extend `OperatorCompileContext` if a real need
  appears.
- **Risch algorithm** noted as the principled endpoint for
  `symbolic/antiderivative.ts` (the Rubi track is the practical lever; kept
  as a marker, not planned).
- **Fractional calculus** (`library/calculus.ts` `@todo`: Liouville–Riemann
  derivative) — unplanned, catalogued.

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
- **validate.ts round (2026-07-18), flagged not fixed:** the
  optional/variadic parameter loops lack the devolve fallback and
  `inferredSignature` acceptance the required-param loop has (probably
  intentional; no observed hits); `arithmetic-power.ts` ~:345 carries an
  order-dependent `matches('complex')` with its own `fix?` comment
  (narrowing to literals).

**Lessons worth keeping in mind** (the durable ones are in CLAUDE.md): the
`undefined → false` collapse in three-valued predicates was the single most
recurring bug class (A3, G3, the sets/Union/Range contains family, NaN
comparisons); validation-by-corpus (the Fungrim harness) found 15 engine bugs
that targeted review missed — keep running it.
