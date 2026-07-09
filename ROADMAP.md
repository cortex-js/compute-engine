# Compute Engine — Roadmap

**Last updated:** 2026-07-08.

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

**MathNet parser hardening (2026-07-04):** all four tiers of
`docs/mathnet/parser-hardening-plan.md` landed and are test-locked
(`ContinuationPlaceholder` crash, ellipsis/trailing-punctuation recovery,
Unicode relation tokens, congruence/divisibility, geometry heads; corpus
clean-parse 3/345 → 278/345, throws 9 → 0). Fresh unseen-sample validation
measured 97.4% clean parse with 0 throws/0 hangs; the remaining MathNet work
is a small notation tail tracked below.

**Pending 0.69.0 (feature-complete on `main`, 2026-07-08):** the
`Measurement`/uncertainty MVP (`\pm`), the control-flow/scoping overhaul
(`Loop`/`Comprehension` split, `Block` lexical-scope fixes, `Declare`
attributes), `digits` display control, numeric tuples as points/vectors, and
the Desmos-compatibility lists wave (relational broadcast + honest
`list<…>` typing, `L[condition]` filtering, `When` over list conditions,
parsing batch). Neyret-corpus parse coverage 78.6% → 92.9%; the remaining
Desmos gaps are importer-side (tracked in tycho's `COMPUTE_ENGINE.md`), not
engine items.

**Cortex language shipped (2026-07-09):** the revived Cortex language
(parser, serializer, `executeCortex` interpreter — phases 0–5 of the revival)
is published as an **experimental** entry point
`@cortex-js/compute-engine/cortex`, joined to the code-splitting ESM build so
`executeCortex(ce, …)` shares engine-class identity with a host-created
engine. Residual ship items (docs sync to cortexjs.io, highlight-mode
validation) are release-protocol steps tracked in
`roadmap/cortex/STATUS_REPORT.md`, not here.

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
equation systems, and number formatting — and thin in the areas below. Of the
items agreed 2026-07-04, `Series` (Phases 1–2), the trig rewrites
(`TrigExpand`/`TrigToExp`/`TrigReduce`), **statistics** Phases 1–2, the
**explain API** (all three phases: simplify + solve + D),
**significant-figures display** (the `digits` serializer option, former item
7), and the **`Measurement` MVP** (item 5) have all landed and left this
list — the record lives in `CHANGELOG.md` and the design docs under
`docs/plans/` (`2026-07-04-statistics-design.md`,
`2026-07-04-explain-design.md`, `2026-07-07-uncertainty-design.md`). What
remains (effort S/M/L):

1. **Explain API — residue (M/L).** Semantic step coalescing for simplify
   (merging operand-descent chains — design doc §4 flags it as a quality
   follow-up once real traces are visible in the product); `Integrate`
   traces via Rubi's rule chain (its own design, per the doc's non-goals);
   tracing systems of *inequalities* and mixed equality/inequality systems
   (`explain('solve')` throws a precise error for them today).

**Statistics residue (demand-gated Phase 3, design doc §10):** inverse
regularized incomplete gamma/beta kernels and the distributions that need
them (Student-t, χ², F, Geometric…), `RandomVariate` sampling (reuse the
`Sample` RNG/seed policy), and fit diagnostics (R²). Also: the Python
execution-parity suite for the new scipy mappings is guarded/skipped until
scipy is installed in `./venv`.

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

**MathNet parser tail (S/M; corpus at 369/428 after the 2026-07-09 rounds —
trailing-`?`/`\ldots` recovery, Unicode `±`/`∓`/`ℓ`, un-applied-operator
devolution (`N`, `D`), `\measuredangle`/`\Varangle`, decorated operators
(`\oplus` → `CirclePlus`, …), structure tuples `(A,+,\cdot)`, geometry
`\cap` label tolerance, trailing equation labels (`\quad (2)`,
`\textcircled{1}`), trailing qualifier clauses (`\text{for } n \ge 2` →
`ForAll`, incl. infix `for all` and the English enumeration `, \text{and}`),
subscripted-relation sets (`\mathbb{N}_{\geqslant 0}`), and the `\Pi` glyph
(`CapitalPi`) all landed):**

*Next up (agreed 2026-07-09):*

- **MATH genre-gap fixes (S/M; top tier + cheap recoveries EXECUTED
  2026-07-09):** the genre-coverage sweep ran over Hendrycks MATH (15,546
  fragments incl. worked solutions across all 7 subjects; report:
  `docs/mathnet/math-genre-sweep.md`, tagged failures:
  `math-genre-failures.json`): 95.27% clean, 0 throws — the MathNet clean
  rate generalizes. The top five gaps landed same day (`\frac`/`\binom`
  mixed-brace bug, styling commands, `\|` norm, infix `\choose`, bare
  `\pmod` + `\equiv…\implies` chain → 97.09%), followed by the cheap
  recoveries (ordinal `13^{\text{th}}`, empty scripts `^{}`/`_{}`, `{,}`
  thousands separator with the `decimalSeparator: '{,}'` precedence guard,
  `\cancel`/`\cancelto`, `\not`-prefixed relations, `Factorial2` symbolic
  signature, standalone-`\pmod` operand order — see CHANGELOG), taking the
  corpus to **97.38%** (327 of 735 failures fixed). Base-subscript numerals
  then landed too (`10111_2` → the numeric `BaseForm(value, base)` head,
  12 of 16 tagged fixed; the rest are symbolic-base `161_b`, inert by
  design), as did sequence braces (`\{a_n\}_{n=1}^{\infty}` → inert
  `IndexedSequence`, 3/3). Remaining ranked tail:
  (1) units-in-text arithmetic
  `(18 \text{ inches})/(12 \text{ inches/foot})` (42, overlaps the units
  subsystem); (2) prime-after-arg `\sin a'` (13); (3) residual pmod chains
  (9) + styling remnants (11); (4) small leftovers: empty scripts on
  multi-letter symbol bases (`\alpha_{}`, needs the `_` parselet in
  `definitions-core.ts` to drop empty braced subscripts at the source),
  `\cancel` inside `array`-env `@{}`/`\cline` layouts, and possible future
  upgrades to `IndexedSequence` (lazy-collection semantics, the
  parenthesized `(a_n)_{n\in\mathbb{N}}` form).
  Ascii-pipe divisibility evidence doubled (36 more hits, tracked below).
  Skip: `array`-env long-division layouts, `\nabla` puzzle ops, repeating
  decimals `0.abab\overline{ab}`.
- **Constant-definition listener disposal (S/M, residual of the engine
  memory fix):** the 2026-07-09 fix for synchronous-burst engine retention
  (see CHANGELOG) holds configuration-change listeners strongly, so a
  `constant` definition declared in a scope that is later popped now stays
  reachable for the engine's lifetime (variables/operators don't subscribe;
  system constants live engine-long anyway). Proper fix: call the
  `unsubscribe` closure returned by `listen()` (currently discarded at
  `boxed-value-definition.ts:181`) when a definition/scope is disposed —
  needs a disposal hook, hence design-gated.

*Rest of the tail:*

- **Polynomial-ring notation (M):** parse blackboard-bold rings followed by a
  bracketed variable list, e.g. `\mathbb{Z}[x]`, `\mathbb{R}[X,Y]`, as an
  inert/structural algebraic object instead of treating `[...]` as indexing.
- **Set-image bracket notation audit (S/M):** `f[S]` is parser-clean today as
  `At(f, S)`; decide whether set contexts need a distinct structural
  function-image head for expressions such as
  `f[\operatorname{divs}(m)] = \operatorname{divs}(n)`.
- **Matrix-operator typing (M):** `\det(A+2B)` — `Add` infers its symbols
  `real` before `Det` sees them; inference-ordering problem. Note this is a
  general class (any matrix/collection-expecting function whose arguments
  contain sibling arithmetic), so it warrants its own design pass, not a
  spot fix.

**Ellipsis-expression interpretation (M, design-gated — proposed
2026-07-09):** give `ContinuationPlaceholder` expressions a path to formal
meaning, e.g. `1 + 2 + \dots + n` → `Sum(k, (k, 1, n))` (and
`Product` for `\cdot`/`\times` chains). The prerequisite **fold barrier
landed 2026-07-09**: an `Add`/`Multiply` with a `ContinuationPlaceholder`
operand no longer folds literals across the continuation and is inert under
`evaluate`/`N`/`simplify`, with source operand order and nested anchors
(`2n`) preserved — so the sample terms and anchor are intact for inference.
What remains:

- **Pattern inference → `Sum`/`Prod` (M):** anti-unify the sample terms and
  the anchor to a general term, mirroring the existing
  `tryInferRangeFromElements` precedent (`[1, 2, \ldots, 10]` → `Range`).
  NOT canonicalization (interpretation is a guess and canonical transforms
  are irreversible) and not a default simplify rule at first — start as an
  explicit, strictly gated reduction (unambiguous consecutive/arithmetic
  patterns only; anything else stays inert) and decide after real usage
  whether `evaluate` or `simplify` should pick it up by default.

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

- **Machine gamma accuracy at z ≳ 80** (~13 digits by z≈140; full precision
  to z≈46) — snapshot-heavy, needs a careful lane fix.
- **defint error bar 1.6× optimistic on endpoint-singular integrands** —
  large (tanh-sinh quadrature).
- **Perf tail** (measurement-gated): per-opDef `allParamsNumeric` cache,
  cold-start bundle size, serialization cache / sort-comparator allocs.
- **Loose-parsing low items:** `sqrt2x` → `√(2x)` divergence from AsciiMath
  convention; `min x` → `Min(x)`; explicit `_a` wildcards in arrow-string
  rules are a silent no-op (redundant there — auto-wildcarding covers it).
- **Doc/cosmetic tail:** `0.999\ldots` drops the ellipsis; locale separators.
- ODE P2s — folded into the DSolve/NDSolve track below (**B12**).

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

#### B12. ODE solving — `DSolve`/`NDSolve` beyond the first slice

The initial slice landed via contributed PRs #315/#317: first-order linear
(integrating factor), constant-coefficient homogeneous up to order _n_
(numeric characteristic roots with clustering), second-order nonhomogeneous
with polynomial forcing, second-order Cauchy–Euler homogeneous, and fixed-step
RK4 (scalar + higher-order reduction to systems). Unsupported forms stay
**inert rather than wrong** — preserve that contract as coverage grows.
Ranked next steps (good contributor territory):

- **ODE P2 residue** (from the 2026-07-04 review; all currently inert, no
  wrong answers): sin/exp forcing via undetermined coefficients including
  resonance (forcing `sin(ωx)` when `±iω` is a characteristic root),
  nonhomogeneous support at order ≥ 3, and tolerance hardening in the numeric
  root clustering.
- **Initial/boundary conditions.** Accept
  `DSolve([eq, y(0)=1, y'(0)=0], y, x)` and solve the resulting linear system
  for the integration constants. Mostly reuses existing machinery
  (substitute, differentiate, solve); makes `DSolve` the symbolic counterpart
  of the `NDSolve` IVP.
- **Verification oracle + graded corpus.** Grade every solver path by
  substituting the solution back into the equation and checking the residual
  vanishes (symbolically or numerically) — the ODE analog of the
  root-substitution oracle in `benchmarks/audit/solve.ts`. Add a CE-vs-SymPy
  `dsolve` harness under `benchmarks/audit/` (update its README index),
  seeded from SymPy's `test_ode.py` (BSD) or the Kamke collection.
- **First-order nonlinear classes.** Separable `y′ = f(x)·g(y)` first (the
  largest missing textbook class; requires deciding whether `DSolve` may
  return _implicit_ solutions `F(y) = G(x) + C`), then the cheap reductions
  to existing solvers: Bernoulli (`v = y^{1−n}` → linear), first-order
  homogeneous (`y′ = F(y/x)`, `v = y/x` → separable), and exact
  `M dx + N dy = 0` with the two classic integrating-factor tests.
- **`NDSolve` numerics.** Adaptive stepping (RK45 / Dormand–Prince) with an
  error tolerance — fixed-step RK4 silently loses accuracy near rapid
  transients; expose first-order vector IVPs in the API (`rk4System` already
  exists internally); dense-output/interpolating result usable at arbitrary
  `x` instead of a raw sample `List` (composes with `compile()`).
- **Adjacent, reusing the same kernel:** `RSolve` for linear
  constant-coefficient recurrences — same characteristic-polynomial /
  root-multiplicity machinery with an `rⁿ·n^k` basis instead of
  `e^{rx}·x^k`; and a `LaplaceTransform`/`InverseLaplaceTransform` pair,
  which is a capability on its own and a second, independent route to
  constant-coefficient IVPs (cross-checks the initial-conditions work).

#### B13. Wester capability gaps — the skip ledger in `wester.test.ts`

`test/compute-engine/wester.test.ts` is the CI correctness suite transcribed
from Wester's CAS review (the categories the `benchmarks/audit/wester.ts`
harness cannot ingest). Every gap below exists there as a `test.skip`
asserting the **correct** answer — unskipping is the acceptance test, so no
separate tracking is needed. Grouped by theme:

- **Radical arithmetic & denesting** (the largest cluster). Denesting beyond
  the single-level `√(a+b√c)` case: multi-term (`√(10+2√6+2√10+2√15) →
  √2+√3+√5`), recursive (Wester 9, the Putnam radical), and cube-root
  (`(90+34√7)^{1/3} → 3+√7`). Rationalizing denominators
  (`(√3+√2)/(√3−√2) → 5+2√6`). Extracting perfect-power factors from a
  **rational** radicand (`(1029/1000)^{1/3} → 7·3^{1/3}/10`; the
  integer-radicand case `root6(997³) → √997` is done). Exact arithmetic over
  `ℚ(2^{1/3})` (Wester 28, which also leaks a float residue out of
  `evaluate()`).
- **Symbolic combinatorics.** Expansion of `Binomial(n, k)` and
  `Pochhammer(a, k)` for small integer `k` (→ polynomial / product forms).
- **Sum/Product closed forms.** Telescoping detection for sums
  (`Σ g(k+1)−g(k) → g(n+1)−g(0)`) and products (`Π (1+1/k) → n`); symbolic
  products (`Π k → n!`); closed forms for classic infinite series and
  products (`Σ 1/k²+1/k³ → π²/6+ζ(3)`, Wallis `→ 2/π`). Under the revised
  EL-4 contract exact `evaluate()` stays symbolic on infinite domains and
  `.N()` owns the numeric path — but `.N()` is a plain 10⁴-term truncation
  (off by ~1e-4 for `Σ 1/k²`) and wants tail acceleration
  (Richardson/Euler–Maclaurin) or a wider cap.
- **Trigonometric simplification.** `cos³x + cos x·sin²x − cos x → 0` (factor
  out `cos x`, then Pythagorean identity). The same missing rewrite blocks the
  rank-1 detection of the trig matrix in the linear-algebra group.
- **Complex/abs simplification.** Kahan's `|3−√7+i·√(6√7−15)| → 1` exactly
  (the modulus-squared is rational after expansion).
- **Assumptions.** Transitivity closure over a cycle of `≥` (Wester 21:
  `x≥y, y≥z, z≥x ⊢ x=z`) and monotonicity of `x²` on ordered positive reals
  (Wester 22: `x>y>0 ⊢ 2x²>2y²`).
- **Rational-function cancellation in `simplify()`.** Policy decided
  (2026-07-05): common-factor cancellation belongs in `simplify()`, not
  `evaluate()`. Remaining work: `simplify()` does not yet cancel Wester 14,
  `(x²−4)/(x²+4x+4) → (x−2)/(x+2)`.
- **Linear algebra.** Exact rational RREF (`RowReduce` currently leaves float
  artifacts like `2.999…` on an integer matrix); `M·M⁻¹` not simplifying its
  diagonal to `1` for a symbolic 2×2; elementwise `D` over matrix literals
  (the rotation-matrix second derivative currently yields a scalar `Add`);
  a matrix-valued `Add` fed unevaluated into `MatrixMultiply` is
  type-rejected (union-type inference gap); `Factor`/`simplify` do not reach
  inside a symbolic `Determinant` (the Vandermonde difference-product);
  `MatrixPower(M, 1/2)` (principal square root) rejects rational exponents;
  no exact/symbolic singular values (`SVD` is float-only, no
  `SingularValues` head); the numeric QR eigensolver fails to converge on
  the 8×8 Rosser matrix (wants Wilkinson shifts + deflation). Missing heads
  noted in comments: `MatrixExp` (`Exp` of a matrix broadcasts elementwise —
  it is *not* the matrix exponential), matrix functions generally (sine of a
  matrix), Jordan / Smith normal forms.

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
under CE names: `NthPrime`, `NPartition`, `PowerMod`, `PrimitiveRoot`,
`ContinuedFraction`, matrix ∞-`Norm`, `BaseForm`, finite-domain
`ForAll`/`Exists`).

- **Number theory / combinatorics operators:** Stirling numbers of the
  **first** kind (`StirlingS1(5, 2) → −50`; the second kind exists as
  `Stirling`); `ModularInverse` (head is undeclared; `PowerMod(a, -1, m)`
  already covers the semantics — either implement it as an alias or drop
  the name).
- **Tolerance-controlled rational approximation:**
  `Rationalize(√3., 1/500) → 26/15`. Single-argument `Rational` already
  rationalizes (at full working precision: `√3 → 50843527/29354524`) — the
  gap is only the tolerance parameter selecting the shortest fraction
  within a bound (a continued-fraction convergent cut).
- **Repeating-decimal representation:** an equivalent of `ToPeriodicForm`
  (exact `1/7 → 0.(142857)` and arithmetic on such forms). MathJSON already
  has repeating-decimal *syntax* in `num` strings — the gap is an operator
  that produces/consumes it.
- **Congruence solving:** no input form for `Solve[9x ≡ 15 (mod 21)]` — the
  diophantine solver landed (2026-07-04) but a modulus-constrained equation
  cannot be stated. Design question: a `Modulus` option, a `Mod`-equation
  pattern, or `ℤ/nℤ` domains.
- **Quantifier elimination over ℝ:** `ForAll`/`Exists` evaluate only over
  finite domains; the Wester/Liska–Steinberg stability problems need QE over
  real closed fields (CAD or virtual substitution) — a major subsystem,
  catalogued here for completeness, not planned.
- **Matrix decompositions & functions:** `MatrixExp` / general matrix
  functions (note: `Exp` of a matrix currently **broadcasts elementwise** —
  arguably a footgun worth an error or a doc warning even before the real
  matrix exponential exists); symbolic singular values (`SVD` is
  float-only); Jordan / Smith normal forms; symbolic Frobenius norm
  (`Norm(M, 'Frobenius')` for symbolic entries).
- **Hypothesis testing:** `MeanTest` etc. — undeclared; only worth pursuing
  if the statistics track (GP items) calls for it.

### Coverage tracks

Two opt-in libraries extend coverage **without touching the core engine**:
**Rubi** (integration rules, `loadIntegrationRules(ce)`) and **Fungrim**
(identities, `loadIdentities(ce, { solve: true })`). The remaining Wester gap to
SymPy is concentrated and maps cleanly onto these, so each is a self-contained
track measured by **its own suite** — the 48-case Wester harness is a
spot-check, not the scoreboard. The two tracks are independent and should not
gate each other.

#### R. Rubi — integration coverage by chapter

**State (2026-07-09, R1–R15 landed):** the shipped bundle
(`src/compute-engine/rubi/rubi-rules-data.json`, via
`@cortex-js/compute-engine/integration-rules`) contains **Chapters 1
(Algebraic), 2 (Exponentials), 6 (Hyperbolics), 4.1 Sine, and 4.5 Secant** —
4,531 rules, 4.94 MB (CI has a bundle-freshness gate). Scores (seed 5):
**4.1 Sine 106/120 and 320/400 (4.1.11 file 71/113)**, **4.5 Secant 56/120**,
ch1 exhaustive ≈90–91%, ch2 ≈72% / ch6 ≈45% effective (seed 42), Wester
indefinite-∫ 6/8.
**Genuine wrongs are 0 across all suites** — every flagged "wrong" is a
documented **verification false-wrong** (numeric ₂F₁/AppellF1 mis-grading at
non-integer symbolic-exponent substitution; `√(sin²)=|sin|`; cube-root branch
at negative x): before believing a wrong flag, differentiate the
antiderivative back and compare at integer substitutions. The trig routing
lives in the runtime layer (`rubi-utils.ts`/`driver.ts`): argument-aware
`deactivateTrig` (only x-free/linear/bare-monomial args inert — composite
quadratic/√-inner args stay ACTIVE for the substitution rules),
`cofunctionShift` (`sec → csc[θ+π/2]`; the `cot → −tan[θ+π/2]` variant is
implemented but default-OFF behind `RUBI_COFN_COT` pending R12),
`unifyInertTrig` + its cofunction product clauses, `standaloneCosineShift`,
`reciprocalToPower` (frozen under fractional powers — branch safety), and
three driver fallbacks (trig→exp with a numeric-evaluability self-check;
R15's rational×sin/cos(linear) → Si/Ci partial-fraction split with a
central-difference D-self-check; native-rational). A/B env switches:
`RUBI_NO_FOUNDATION`, `RUBI_NO_RECIP`, `RUBI_NO_COFN`, `RUBI_COFN_COT`,
`RUBI_NO_SKELETON`, `RUBI_NO_SICI`. Per-rung blow-by-blow
(R1–R15, incl. the cofunction-audit table and each rung's dead ends):
`docs/rubi/RUBI.md` §5; the rest is git history.

**Benchmark protocol.** `npx tsx scripts/rubi/benchmark.ts --rubi
"data/rubi/corpus/4 Trig functions" --chapter "4 Trig functions/4.1 Sine"
--sample 120 --seed 5 --report /tmp/x.json`. Always pass `--report` (the
default path clobbers the committed baseline); `--rubi` mode preloads the
ch1/2/6 foundation (so it measures the integrator as it ships —
`RUBI_NO_FOUNDATION` to disable; **pre-2026-07-04 4.1 baselines are not
comparable**); run suites **sequentially** — concurrent benchmark runs
contaminate each other's driver/verifier timing.

**Known kernel gaps** (block specific classes; the fallbacks decline them
cleanly, so they surface as unsolved, not wrong): complex-argument
`ExpIntegralEi` and negative-order incomplete Γ don't evaluate numerically —
needed by the `∫x·sin(a+b/x)` exp-route class and the complex-Si family R15
declines (4.1.11 #61/#71/#72 — irreducible-quadratic denominators).

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
- **R16 — the 4.1.10 `(c+d·x)^m·trig/(a+b·sin)` Si/Ci chains**
  (#30/#112/#197/#294). Confirmed by R15 to be a genuinely different
  mechanism from the rational-in-x family R15 closed: the denominator is
  `(a+b·sin(e+f·x))`, not a rational in x, so R15's trig-free-rational gate
  declines them (correctly — cleanly unsolved). Rubi routes them through
  `ExpandIntegrand`/`E^(i·x)` rewrites on active linear-arg Sin, up to 48-step
  chains; needs its own scoped routing.
- **R3′ — residual half-integer/elliptic chains.** #604/#609/#1395 were closed
  by R9's cosine shift; what remains is the genuinely deep tail: #53 (23-step
  half-integer Fresnel chain), #248 (48 steps), #294, plus the composite
  `cot^m/(a+b·sin)^n` / `(a+b·sin²)^(p/2)` tan/cot-power recursions (4.1.1.3 /
  4.1.7), which may fold into R5.
- **R5 — `TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions). _Low value /
  optional:_ the predicate census over-weights it (it's a late catch-all, not a
  blocker). Only pursue if R14/R3′ leave a concrete residual class that needs
  it — one confirmed member so far: #93 (`csc^(−1/2)·sin` cancellation). A
  related deferred item from R9: a proper circular `TrigReduce`
  (multiple-angle elementary form) for `sin^n` products — the exp-form
  reduction works but verifies past the harness budget and preempts trig-form
  rules chapter-wide, so it was deliberately gated off.

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
