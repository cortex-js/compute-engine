# Compute Engine — Roadmap

**Last updated:** 2026-07-18.

(2026-07-17: the `At` default-serialization decision closed — bracket
notation `a[1]` is the default and round-trips; the lossy subscript form is
opt-in via `indexStyle: 'subscript'`. The pipeline-contract suite and
consumer contract were updated; the item left this file.)

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

**0.73.0 released 2026-07-09** (solving parity 38/40 with SymPy/Mathematica,
Rubi R13–R16, `Interpret`, number theory; earlier 0.7x releases carried the
`Measurement`/uncertainty MVP, the control-flow/scoping overhaul, `digits`
display control, numeric tuples as points/vectors, and the
Desmos-compatibility lists wave). Neyret-corpus parse coverage 78.6% → 92.9%;
the remaining Desmos gaps are importer-side (tracked in tycho's
`COMPUTE_ENGINE.md`), not engine items.

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

The lift itself shipped: the `broadcastable<T>` type constructor and
subsumption, the library-wide broadcast-typing arm, compile-target routing
(JS `_SYS.bcast`; GPU/interval targets keep scalar-slot compilation), the
application-site typing for scalar-param lambdas, and the point-patch
disposition (`restsOnUnknown`/`AT_NARROWING_OPERATORS` retired; the other
patches kept deliberately — see the design doc). Record in `CHANGELOG.md`
and `docs/plans/2026-07-11-broadcast-typing-lift-design.md`. Genuinely
remaining, as separate demand-gated items:

- **Phase-2 declared-type reconciliation** for symbolic-length ranges (see
  the design doc).
- **Param-type-driven lambda-body typing:** lambda BODIES over untyped
  params still type scalar — only applications are lifted; revisit only
  with a param-type-driven design.

Interactions to respect: non-finite typing convention, `infer(unknown)`
destructiveness, scalar-requiring contexts (exponents, comparisons, plot
coordinates).

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

**Statistics residue (demand-gated Phase 3, design doc §10):** inverse
regularized incomplete gamma/beta kernels and the distributions that need
them (Student-t, χ², F, Geometric…), `RandomVariate` sampling (reuse the
`Sample` RNG/seed policy), and fit diagnostics (R²). Also: the Python
execution-parity suite for the new scipy mappings is guarded/skipped until
scipy is installed in `./venv`.

**Series residue:** bare `O(…)` parsing remains deferred (design doc §8 Q3);
revisit for lenient mode once the parser work settles.

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

**MathNet parser tail (S/M; corpus at 371/428 after the 2026-07-09 rounds —
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
  `IndexedSequence`, 3/3). The prime/pmod/empty-subscript round then
  closed prime-after-arg 13/13 (`Prime` now mirrors its base's type),
  symbolic-modulus congruences + `N`/`D` devolution in `validateArguments`,
  congruence chains (→ conjunction) and leading-`\equiv` recovery, and
  `\alpha_{}` — genre corpus at **97.63%** (365 of 735 fixed). Units-in-text
  then landed (English word→canonical-symbol aliases at the parse boundary
  in `definitions-units.ts`, compound leaves normalized, outside-exponent
  folded into the trailing factor; `ton(s)` deliberately NOT aliased —
  short ton ≠ tonne; of the 46 tagged rows only 13 were unit-bearing, 6
  fully fixed + 1 partial) — genre corpus at **97.66%** (371 of 735).
  Remaining ranked tail:
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
anything unproven stay inert). Remaining rungs, demand-paced:

  (v2 — finite differences → polynomial terms + constant-ratio geometric —
  and v3 — exact-rational Berlekamp–Massey → recurrence → verified
  `RSolve` closed form, `Fibonacci`-head display mapping, numeric anchors
  by exact recurrence iteration — both landed 2026-07-09, along with the
  subtraction-ellipsis fold-barrier extension, `isContinuationOperand`.
  v4 — the async `ce.interpret(expr)`: same offline recognizer plus OEIS-
  attributed, sample-verified closed-form candidates — landed 2026-07-10.)

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
- **Perf tail** (measurement-gated): per-opDef `allParamsNumeric` cache,
  cold-start bundle size, serialization cache / sort-comparator allocs.
- **Loose-parsing low items:** `sqrt2x` → `√(2x)` divergence from AsciiMath
  convention (left as-is 2026-07-18: implicit arguments are the documented
  bare-function convention — `cos 2x` → `Cos(2x)` — so following AsciiMath
  here would be internally inconsistent; a deliberate-policy note, not a
  bug); explicit `_a` wildcards in arrow-string rules are a silent no-op
  (redundant there — auto-wildcarding covers it). *(Closed 2026-07-18:
  `min x`/`acot`/`asec`/`acsc`/`alpha2` had been fixed by intervening work;
  `nPr(n, k)` now parses as the permutation count C(n,k)·k!, joining `nCr`.
  Infix calculator notation `5 nPr 2` remains unsupported — a new-notation
  design item, not a map gap.)*
- **Doc/cosmetic tail:** locale separators. *(`0.999\ldots` fixed
  2026-07-18: a truncation marker after decimal digits ending in an evident
  repetend — ≥3 reps for single digits, ≥2 for longer blocks — now parses
  as the exact repeating decimal (`0.999\ldots` → 1, `0.1212\ldots` →
  4/33); non-repeating tails (`3.1415\ldots`) keep the old
  drop-the-marker behavior.)*
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
its `Equal` collapse to `False` (both landed). The LambertW / Ln-Exp inverse
forms landed too (solve templates + the native W₋₁ branch — see the Fungrim
coverage track, at 38/40 parity with SymPy/Mathematica on its own benchmark),
so **no open items remain here**; the section is kept for the
harness-artifact explanation the Fungrim track cross-references.

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
second-order Cauchy–Euler homogeneous, the first-order nonlinear classes
(separable with _implicit_ `F(y) = G(x) + C` solutions, Bernoulli `v = y^{1−n}`,
first-order homogeneous `y′ = F(y/x)`, and exact `M dx + N dy = 0`), and
initial/boundary conditions (solving the linear system for the integration
constants). `NDSolve` provides fixed-step RK4 (scalar + higher-order reduction
to systems). Unsupported forms stay **inert rather than wrong** — preserve that
contract as coverage grows.

The CE-vs-SymPy audit harness (`benchmarks/audit/dsolve.ts` +
`gen_dsolve.py`, substitute-back residual oracle, 51-case corpus seeded from
SymPy's `test_ode.py`; landed 2026-07-10) grades **CE 46/51 correct, 0
wrong** vs SymPy 50/51 — CE solves every case in its claimed classes. The
five `unsupported` rows are the coverage frontier (SymPy solves four):
**Riccati, Airy `y″ = x·y` (special-function solutions), variable-coefficient
second order, nonhomogeneous Cauchy–Euler, repeated-eigenvalue linear
systems.** Ranked next steps (good contributor territory):

- **`NDSolve` numerics — adaptive stepping LANDED 2026-07-18.** `NDSolve`
  now integrates with adaptive Dormand–Prince 5(4) (embedded error control,
  rtol 1e-11 / atol 1e-13 defaults, RMS norm; `rk45System` in
  `numerics/differential-equations.ts`) and emits its unchanged uniform
  `steps + 1` output grid from the quartic dense-output interpolant, so
  `steps` is now purely sampling resolution and accuracy is
  tolerance-controlled (rapid-transient case `y' = −50(y − cos x)`: grid
  error 4e-5 → 2e-12). Failure modes (blow-up, step underflow, step cap)
  stay inert. First-order vector IVPs were already exposed (the
  `List`-of-equations form). **The public interpolating-function surface
  LANDED 2026-07-18** (user-ratified opaque-head design): `NDSolveFunction`
  (same arguments as `NDSolve`, no sample count) returns
  `Function(InterpolatingFunction(data, x), x)` — applicable at any point
  of the integration interval (clamping outside it), symbolic-argument
  inert, LaTeX display eliding the dense table to the covered interval,
  and lowering to plain JS via the per-operator `compile` handler
  (`compile(g(t))` ≈ 0.9 µs/eval). Scalar forms only; the multi-dependent
  system form stays inert (a vector-valued interpolating result needs a
  shape decision — demand-paced). Known engine-level quirk (pre-existing,
  pinned in tests): applying a MathJSON-**re-boxed** literal resolves the
  interpolation one `evaluate()` late (`N()` is immediate).
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
- *(The former "small artifact" — `Derivative(Sign, 1)` left unevaluated →
  `NaN` in numeric residual checks — was fixed 2026-07-18: `Sign` joined the
  step-function group in the derivative table (0 a.e., like `Floor`/`Ceil`/
  `Round`). A proper `DiracDelta` remains a possible future refinement.)*

#### B13. Wester capability gaps — the skip ledger in `wester.test.ts`

`test/compute-engine/wester.test.ts` is the CI correctness suite transcribed
from Wester's CAS review (the categories the `benchmarks/audit/wester.ts`
harness cannot ingest). Every gap below exists there as a `test.skip`
asserting the **correct** answer — unskipping is the acceptance test, so no
separate tracking is needed. Grouped by theme:

- **Radical arithmetic & denesting** (the largest cluster; rational-radicand
  extraction `(1029/1000)^{1/3} → 7·3^{1/3}/10`, the Wester-28 float-leak
  fix, rationalizing denominators (`(√3+√2)/(√3−√2) → 5+2√6`, in the
  simplify subsystem next to `denestSqrt`), three-surd denesting
  (`√(10+2√6+2√10+2√15) → √2+√3+√5`), and same-base `Root`/`Power`
  combination (`2^{1/3}·2^{2/3} → 2`, `2^{1/3}·4^{1/3} → 2`, positive
  rational bases) all landed 2026-07-09; cube-root denesting
  (`(90+34√7)^{1/3} → 3+√7`) landed 2026-07-11). Denesting still open beyond
  those cases: recursive Wester 9 (the Putnam radical). Exact
  zero-recognition over `ℚ(2^{1/3})` (Wester 28) now lands end-to-end:
  perfect-power bases normalize (`4^{2/3} → 2·2^{1/3}`), compatible cube-root
  powers combine exactly, the existing cost-gated expansion pass exposes the
  trinomial cube, and both `simplify()` and `.N()` return exact/finite results.
- **Sum/Product closed forms (telescoping sums/products, `Π k → n!`,
  p-series `→ ζ(s)`, Wallis `→ 2/π`, and Richardson tail acceleration for
  `.N()` of infinite sums/products ALL LANDED by 2026-07-11; closed-form
  table growth LANDED 2026-07-18).** The table now also covers, all
  numerically verified (`test/compute-engine/infinite-series.test.ts`,
  recognizers in `library/utils.ts` `namedSeriesClosedForm`): alternating
  p-series `±η(s)` (`Σ(−1)^{k+1}/k → ln 2`, `η(2) → π²/12`), odd p-series
  `λ(s)` (`Σ1/(2k−1)² → π²/8`), Dirichlet `β(1,2,3,5)` (Leibniz `π/4`,
  Catalan, `π³/32`, `5π⁵/1536`), exponential `Σrᵏ/k! → eʳ` (partial-term
  adjustment for shifted starts; symbolic ratio allowed), first-moment
  geometric `Σk·rᵏ → r/(1−r)²` and logarithmic `Σrᵏ/k → −ln(1−r)` (both
  `When`-guarded on `|r| < 1` for symbolic ratios), and products
  `Π_{k≥a}(1−1/k²) → (a−1)/a`, `Π(1−1/(2k+1)²) → π/4`,
  `Π(1+1/k²) → sinh(π)/π`. Further growth (e.g. `β(4)`, Hurwitz-shifted
  bases `(k+m)^{−s}`, higher moments `Σk²rᵏ`) remains demand-paced.
- **Trigonometric simplification (Pythagorean factoring LANDED 2026-07-09;
  trig-matrix rank-1 detection LANDED 2026-07-10** via the symbolic
  determinant rank path with a `TrigReduce` fallback — see the
  linear-algebra bullet**).**
- **Complex/abs simplification (LANDED 2026-07-10).** Kahan's
  `|3−√7+i·√(6√7−15)| → 1` exactly, via the exact `√(a²+b²)` split with a
  numeric cross-check rejecting invalid real/imaginary decompositions.
- **Assumptions (LANDED 2026-07-10).** Transitive ≥-chain closure with
  antisymmetry (Wester 21) and even-power monotonicity on ordered positives
  (Wester 22), scoped narrowly so solve()'s conservative root filtering is
  unchanged.
- **Linear algebra (2026-07-10 round ALL LANDED: exact rational elimination
  extended to `Kernel`/`MatrixRank`/eigenvectors, joining `RowReduce`;
  `M·M⁻¹ → I` via same-denominator fraction combining + `simplify()`
  recursing into `List` elements; symbolic small-matrix rank from the
  simplified determinant; Vandermonde determinants return the difference
  product; QR eigensolver rebuilt as Hessenberg + Francis double-shift with
  deflation — the 8×8 Rosser matrix converges; `MatrixPower(M, 1/2)`
  principal square root for exact 2×2; new `SingularValues` head, exact for
  ≤2×2 Gram matrices; elementwise `D` over `List` literals — the
  rotation-matrix second derivative; the matrix-valued-`Add`-into-
  `MatrixMultiply` type rejection turned out already fixed by the
  matrix-typing work).** Remaining: matrix square root beyond exact
  2×2 (n×n wants eigendecomposition or Denman–Beavers); exact singular
  values beyond a 2×2 Gram matrix. Missing heads noted in comments:
  `MatrixExp` (`Exp` of a matrix broadcasts elementwise — it is *not* the
  matrix exponential), matrix functions generally (sine of a matrix),
  Jordan / Smith normal forms.

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

- **Repeating-decimal representation (consumer side DONE 2026-07-09):**
  repeating-decimal literals now box as exact rationals
  (`0.(142857)`/`0.\overline{142857}` → `1/7`), so arithmetic on such forms
  is exact. The residual is the *producer* direction: an equivalent of
  `ToPeriodicForm` — an operator that renders an exact rational as its
  periodic-decimal object (the LaTeX serializer's `repeatingDecimal` option
  covers only float display).
- **Quantifier elimination over ℝ:** `ForAll`/`Exists` evaluate only over
  finite domains; the Wester/Liska–Steinberg stability problems need QE over
  real closed fields (CAD or virtual substitution) — a major subsystem,
  catalogued here for completeness, not planned.
- **Matrix decompositions & functions:** `MatrixExp` / general matrix
  functions (note: `Exp` of a matrix currently **broadcasts elementwise** —
  the footgun is now documented: warning admonition in the linear-algebra
  guide + reference-table note + operator description, 2026-07-18; an
  actual matrix exponential remains future work); symbolic singular values (`SVD` is
  float-only); Jordan / Smith normal forms; symbolic Frobenius norm
  (`Norm(M, 'Frobenius')` for symbolic entries).
- **Hypothesis testing:** `MeanTest` etc. — undeclared; only worth pursuing
  if the statistics track (GP items) calls for it.

#### B15. Parameter-conditional results — producers never emit `Which`

The **representation** side is done: `Which` stays inert while its conditions
are undecidable, resolves once `ce.assume()` decides one (assuming `a > 2`
collapses `Which(|a| < 1, 2π, |a| > 1, 0)` to `0`), and serializes to a LaTeX
`cases` environment. The gap is the **producer** side — no operation ever
*returns* a parameter-conditioned result; each either picks the generic
branch, silently drops the validity condition, or stays inert:

- **Definite integration:** results that are genuinely piecewise in a free
  parameter stay inert. Motivating case (2026-07-10):
  `∫_{−π}^{π} (1 − x·cos t)/(x² − 2x·cos t + 1) dt` = `2π` for `|x| < 1`,
  `0` for `|x| > 1` — CE returns the unevaluated integral (correctly, since
  emitting either branch would be wrong; `.N()` at concrete `x` is right).
- **Solve:** the trig rules admit symbolic ratios unconditionally —
  `a·sin(x) + b = 0 → arcsin(−b/a)` is emitted without recording the
  `|b/a| ≤ 1` validity condition the rule's own guard checks for numeric
  ratios. Same for the extraneous-root conditions on radical equations.
- **Sum/Limit:** convergence conditions are dropped or block evaluation —
  `Σ xⁿ = 1/(1−x)` holds only for `|x| < 1`; a conditional result would
  let the closed form be returned with its region attached.

**Design ratified 2026-07-12**
([`docs/plans/2026-07-12-conditional-values-design.md`](./docs/plans/2026-07-12-conditional-values-design.md)):
no new head — `When` is the guarded value (= `ConditionalExpression`;
Solve/Sum) and `Which` the case split (= `Piecewise`; integration), split by
"what is the answer where the condition is false?" (a genuine other value →
`Which`; no value → `When`). Threading rules T1–T7 (conjunction-of-guards
vs. cross-product-of-regions), a single `conditionalValue` emission helper
consulting the assumption store, guards exempt from generic folds
(fat-complement argument), conservative predicate threading, and a
solution-set pruning contract.

**Phases 1–2 landed 2026-07-12** (zero snapshot churn; solve benchmark held
at 38/40): the threading algebra (step-4c pre-pass in `boxed-function.ts`,
which also fixed the pre-existing `When − When → 0` guard-dropping fold) and
the Solve adopter (14 trig/hyperbolic validity rules emit `When`-guarded
roots — `Solve(sin x = a, x)` → `When(arcsin a, |a| ≤ 1)` — with pruning in
root assembly and the audit oracle grading guarded roots). Remaining:

- **Convergence-conditions adopter landed 2026-07-12 (Phase 3a):** improper
  integrals emit endpoint convergence guards (`∫₀^∞e^(−ax)dx → 1/a {0<a}`),
  fixing the pre-existing `0^(n+1)`/`∞^(1−s)` FTC endpoint leaks
  (fail-closed outside the `x^p`/`e^{px}` table), and the geometric series
  gets its closed form (`Σ(1/2)ⁿ → 2` exact; symbolic ratio →
  `1/(1−x) {|x|<1}`). Policy ratified: measure-zero exceptional parameter
  points (`∫xⁿ`'s `n=−1`) stay generic (Rubi-consistent); only fat
  convergence regions guard.
- **Phase 3b landed 2026-07-12:** radical extraneous-root guards
  (`Solve(√(x+3) = a) → a²−3 {0 ≤ a}`, was `[]`; the guard is exact
  per-root for an x-free RHS) and the `e^{−a·x}` antiderivative gap fixed
  at the source (`∫e^{−ax}dx → −e^{−ax}/a`, was inert; any linear exponent
  integrates; the Phase-3a improper-path fallback retired).
- **Remaining (the only open producer):** definite-integration region
  splitting (`Which` — locating where poles cross the contour is the
  hardest part and stays with that adopter). Cosmetic residual: an
  unsatisfiable conjoined guard (`∫₀^∞xᵖdx`) displays rather than
  collapsing — needs contradiction detection in assumptions; not worth it
  standalone.
- **Known Phase-1 limitation** (accepted, revisit on evidence): a
  conditional nested under a lazy operand (`5 − When(x,c)`) lifts fully
  only on a second `evaluate()`; the guard is never dropped.

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
ch2 ≈72% effective (seed 42), **ch6 Hyperbolics 71/120 (s120 seed 5,
post-R30: 62 → 71, +9 rational-in-hyperbolic cyclotomic-factored flips over the
post-R29 baseline; 0 wrongs — see R30/R29)**,
Wester indefinite-∫ 6/8.
**R28 (2026-07-11)** — two composable parts; the "elliptic route" premise
dissolved under diagnosis (atomic elliptic terminals already close and
numericize; new elliptic kernels would buy ~0 rows in 1.1.3, ~2 in ch6).
**R28a (`RUBI_NO_R28`):** mixed-parity linearity split — Rubi rule 2424
(bundled 1.1.3.7 #37 / 1.1.3.8 #17) never fires because its
`Sum`/`Coeff`/`Expon` regroup-RHS is non-functional in `build()`, so
`(c·x²+d·x+e)/√(a+b·x⁴)`-class integrands matched no rule at all; a late
fail-closed driver fallback splits a ≥2-monomial Laurent numerator over a
single binomial-radical factor, integrates the monomial pieces, and
D-verifies the sum. 1.1.3 **180 → 185** (flips #213/#468/#471/#502/#544),
ch1 1.1 **111 → 112**, 5.3 **61 → 64**, zero new genuine wrongs.
**R28b (core engine, no toggle):** inverse trig/hyperbolic functions now
numericize to their **complex principal values** off the real domain and
for complex arguments (`apply()` cascades a real-kernel NaN to the complex
kernel, mirroring `applyN`; `Artanh(2).N()`, `Arcsin(2).N()` work; exact
arguments still stay symbolic under `evaluate()`). Fixed two pre-existing
complex-kernel bugs en route (`Arcoth` wrong cut side on (−1,0); `Arsech`
formula dropped a sqrt — wrong even in-domain), and hardened the solve()
trig/hyperbolic rule guards that had silently relied on non-numericizable
roots (`ExactNumericValue` bindings bypassed the `typeof === 'number'`
domain check; cosh/tanh rules had no domain guards at all). CHANGELOG-worthy
at release (user-facing capability + two wrong-value fixes). Side effect:
ch6 6.4.2 #158 (`∫√(Coth[a+b·Log[c·xⁿ]])/x`, pre-R28 `inconclusive`) is now
honestly graded a **genuine wrong** — the exp-substitution route's
`arcosh(−u)`-form antiderivative fails the real-axis D-check now that it
evaluates; Rubi's reference form is `[artanh(√coth) − arctan(√coth)]/(b·n)`
(fixed by R29 below).
**R29 (2026-07-11, `RUBI_NO_R29`)** — algebraic-in-hyperbolic substitution
plumbing (the former "R7"). A ch6 integrand algebraic in one hyperbolic family
with a common linear argument `v` (`(a+b·Sinh²)^(p/2)`, `√(a+b·Tanh²)`,
half-integer hyperbolic powers) is not a rational function of `e^v`, so the
exp-substitution fallback strands it as inert. A LAST-resort driver fallback
substitutes `u = Sinh/Cosh/Tanh[v]`, routes the resulting `∫R(u,√(a+b·u²)) du`
algebraic subproblem through the bundled 1.1.2 quadratic-radical rules
(elementary artanh form), and back-substitutes; fail-closed with a branch-safe
mixed-sign D-check (rejecting the `u=Cosh` sign ambiguity and elliptic
double-radicals). ch6 **46 → 62/120** (+16, A/B byte-identical under
`RUBI_NO_R29=1`), and it resolved the R28-named genuine wrong **6.4.2 #158**
(→ branch-artifact solved-formal; its Log-sub sub-integral `∫√(Coth w) dw`
now hits R29) — ch6 genuine wrongs **1 → 0**. #463/#500 (thought elliptic)
also flipped correct. Guards byte-identical (R29 is inert off ch6).
**R26 (2026-07-10)** — two parts. **R26A (P0 correctness, no toggle):** the
driver returned wrong answers for ANY integration variable not literally
named `x` (`∫t² dt → x³/3`; `∫t·cos t dt` mixed-corrupted) — rule-RHS `"x"`
tokens fell through to the literal symbol because the match env never bound
the variable pattern; fixed by binding `env['x']` to the actual variable at
dispatch. Invisible to every suite (the whole corpus integrates wrt `x`);
CHANGELOG-worthy at release. **R26B (`RUBI_NO_R26`):** symbolic-coefficient
reciprocal hyperbolics (`∫1/(a+b·sinh x)`, cosh/tanh/coth/sech/csch
variants) close via a rational-normal-form retry (`rationalNormalFormX`) in
the exp-substitution fallback — ch6 35→46/120, +11 flips, wrongs 0, ch2
proven no-op by per-problem A/B.
**R25 (2026-07-10)** closed the symbolic-coefficient quartic-denominator rational
family `∫(d+e·x²)/(a+b·x⁴)` and its reductions (`∫x^m/(a+b·x⁴)`, `∫Pq/(a+b·x⁴)`,
quartic products) — an ExpandIntegrand ⇄ binomial-split ping-pong, fixed by
failing the distribution on the `(d+e·x^(n/2))/(a+b·x^n)` shape so the driver
reaches the 1.2.2.3 trinomial terminal rules (behind `RUBI_NO_R25`; A/B: 1.1.3
General 173→180/200, ch1 1.1 109/5w→111/4w fixing one genuine wrong, and the
R20-noted arctan/arccot(a·x²) chains 5.3 60→61 / 5.4 60→62); genuine wrongs 0.
**Genuine wrongs are 0 across all suites** (incl. ch3 after the R17
back-substitution fix, and ch7's 11 flags — all symbolic-exponent /
complex-log-branch / fractional-power false-wrongs) — every flagged "wrong" is a documented
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
**Fixed (R17 follow-up, 2026-07-10):** the nested `Log[c·(b·x^n)^p]`
power-in-log family (ch3 §3.1.5 / §3.3, e.g. `∫Log[c(b x^n)^p]²/x⁴`) that first
shipped malformed. Root cause: rule 3.3 #60 (and the 5 other compound-`Subst`
rules) use Rubi's general `Subst[u, expr, repl] := u /. expr -> repl`, but the
`build()` `Subst` handler substituted the integration variable instead of the
`expr` subexpression. Fixed by dispatching on the middle argument
(`replaceSubexpr` in `rubi-utils.ts`). ch3 s120 seed5: 65→67 correct, genuine
wrongs 0. See `docs/rubi/RUBI.md` §5 R17.
Per-rung blow-by-blow
(R1–R18, incl. the cofunction-audit table and each rung's dead ends):
`docs/rubi/RUBI.md` §5; the rest is git history.

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
`CosIntegral` and negative-order incomplete Γ kernels landed 2026-07-09 (commit
2980a5a8, mpmath-validated ~1e-15 all quadrants), and **R18 consumed them**: the
`∫xᵐ·sin(a+b/x)` reciprocal-argument class (4.1.12) now closes via the R9 exp
route, and the complex-Si family R15 declined (4.1.11 #61/#71/#72 —
irreducible-quadratic denominators) closes via the R18 complex-linear split.
Both are D-verified on the real axis (the complex Ei/Si and conjugate-pair terms
recombine to a real antiderivative). Remaining hard cubic-and-higher x-denominator
Si/Ci shapes still decline cleanly (unsolved, not wrong). **R21 added the
hyperbolic sine/cosine integral kernels Shi/Chi** (`SinhIntegral`/`CoshIntegral`,
previously inert generic heads): real via Ei, complex via Shi(z)=−i·Si(iz) /
Chi(z)=Ci(iz)−iπ/2 reflected into the left half-plane, mpmath-validated ≲1e-13
(a naïve Ei-composition fails off-axis — mpmath's complex `ei` branch; and the
positive-imaginary-axis case needs a signed-zero +iπ branch restoration). They
close the ch7 §7.2.6 reciprocal-arccosh family end-to-end.

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
  - **Biggest family (was 13): poly×log by-parts residuals** bottoming in
    `∫arctan(kx)/x`, `∫artanh(√)/x`, symbolic-order-`k` `PolyLog` recurrences,
    or `ArcSinh·Log` (3.1.4/3.1.5). **R20 bundled ch5, which supplied the
    `∫arctan(kx)/x → PolyLog[2,±i·x]` producer: family-C members #31 and #226
    flipped to solved (ch3 69 → 71).** **R21 bundled ch7 (inverse hyperbolic),
    but ch3 s120 seed5 is unchanged at 71/4w — no additional family-C member
    flips** (the `ArcSinh·Log/x` and symbolic-order `PolyLog` residuals still
    bottom out in shapes ch7's bundled base cases don't reach, or fall outside
    this sample). A symbolic-order `PolyLog` recurrence remains the lever.
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
DONE and bundled (2026-06; both use ACTIVE heads → ≈ Chapter-1 difficulty).
The former R6 item (symbolic-coefficient rational integration) landed as R25
(quartic denominators) + R26 (integration-variable soundness + the
rational-normal-form retry that closes the parametric reciprocal families
`∫1/(a+b·Sinh x)` etc.); what survives of it is folded into the residual
below. The Chapter-6 residual (69 unsolved at s120 seed 5, post-R26; census
2026-07-10 by expected-antiderivative content: 21 algebraic-in-hyperbolic,
29 rational-in-hyperbolic, 9 polylog, 4 CoshIntegral/Erfi nonlinear-arg,
**7 expected-`Unintegrable`** — Rubi itself returns unevaluated there, so
CE's inert `Integrate` is the correct match — 1 ₚFq, 4 Weierstrass-form
`∞`-collapse pathology) is mostly shared capability rather than
Ch6-specific:

- **R6′ — rational-in-hyperbolic cyclotomic-factored substitution — LANDED as
  R30 (2026-07-11, behind `RUBI_NO_R30`).** Premise correction: the blocker was
  NOT "genuine polynomial factoring over free parameters." A rational
  (integer-power) hyperbolic of a common linear argument substitutes (`t = e^v`)
  to a rational function of `t` whose denominator ALWAYS factors as
  `x^m·(x²+1)^p·(x²−1)^q·S(x)` — cyclotomic factors NUMERIC (from `sinh/cosh =
  (t∓1/t)/2`), `S` the low-degree `(a+b·hyp)` residual. The bundled 1.2.x
  partial-fraction rules already close symbolic biquadratic denominators AND the
  FACTORED integrand, but the R26B `rationalNormalFormX` retry EXPANDS the
  denominator into one high-degree polynomial no rule factors, stranding the row.
  A LAST-resort driver fallback keeps the cyclotomic factors factored (peeling
  them by exact coefficient-array division after a new `clearNegatives`
  normal-form pass), routes the factored rational through the driver, and
  back-substitutes; fail-closed with a branch-safe (mixed-sign x, three
  parameter seeds) D-check. ch6 **62 → 71/120** (+9, s120 seed5, clean
  per-problem A/B via `RUBI_NO_R30=1`: 9 flips, 0 regressions, 0 wrongs).
  **Residual
  (still unsolved):** the residual-degree-≥4 fn-of-exp rows (`Sinh⁶/(a+b·Cosh²)`,
  `Csch⁴/(I+Sinh)²`, `Sinh⁴/(a+b·Sech²)²`, `Coth⁵/(a+b·Coth)`) whose symbolic
  quartic-or-higher residual needs a genuine root-finder — the true R6′ tail, out
  of a contained rung's reach — plus 7 expected-`Unintegrable`. See
  docs/rubi/RUBI.md §5 R30.
- **R8 — poly×hyperbolic single-exponential PolyLog fallback — LANDED
  (2026-07-11, behind `RUBI_NO_R8`).** The former "11 poly×hyperbolic
  `(e+f·x)^m·hyp^n/(a+b·hyp)` by-parts" residual, closed NOT by by-parts but by
  the real-exponential (`y = e^w`) analog of R17's trig telescope: rewrite the
  same-angle hyperbolics via `y = e^w`, linear-factor partial fraction, and route
  each `∫P(x)·e^{k·w}/(a+b·e^w)^s` piece through the §2.2 → Ch3 → §8.8 PolyLog
  telescope the bundle already closes (→ `Log + PolyLog[2]/PolyLog[3]`). Placed
  last among the hyperbolic fallbacks, fail-closed with a branch-safe 3-seed
  D-check, disjoint from R30 via a nontrivial-polynomial gate. ch6 **+3**
  (#230/#233/#47, clean per-problem A/B, 0 wrongs/0 regressions). See
  docs/rubi/RUBI.md §5 R8. **Residual:** (1) the heavier same-family rows
  (#243/#408/#455) decline structurally — their y-rational has REPEATED
  (`Csch²`/`Coth²` → `(y−1)²(y+1)²`) or COMPLEX (`Tanh` → `y²+1`) denominator
  roots that the shared linear-factor partial fraction (`expandRationalOverLinears`)
  does not split; extending it to repeated/complex roots (also reaching the
  analogous R17 trig rows) is the natural R8 follow-up; (2) the by-parts-only
  tail (rows whose numerator hyperbolic is itself a POWER in the additive
  denominator, e.g. `a+b·Sinh⁴`) still wants genuine by-parts machinery.
- **R7 — algebraic-in-hyperbolic substitution plumbing — LANDED as R29
  (2026-07-11, behind `RUBI_NO_R29`).** The 21-row algebraic-in-hyperbolic
  class (`(a+b·Sinh²)^(p/2)`, `√(a+b·Tanh²)`, half-integer hyperbolic powers)
  closed via a driver fallback that substitutes `u = Sinh/Cosh/Tanh[v]`
  (common linear arg `v`), routes the resulting `∫R(u,√(a+b·u²)) du` algebraic
  subproblem through the bundled 1.1.2 quadratic-radical rules, and
  back-substitutes; fail-closed with a branch-safe mixed-sign D-check. ch6
  **46 → 62/120** (+16, s120 seed5, A/B byte-identical under `RUBI_NO_R29=1`),
  and it **fixed the R28-named genuine wrong 6.4.2 #158** (solved-wrong →
  branch-artifact solved-formal: its Log-substitution sub-integral `∫√(Coth w)
  dw` now hits R29). Surprise: **#463/#500** — flagged "genuinely elliptic" —
  flipped to correct too (a substitution found an elementary D-verifying form;
  Rubi's EllipticE/F reference was non-optimal). **Residual (still unsolved):**
  the bare `(a+b·Sinh²)^(3/2)` even-parity shape (genuinely EllipticE/F), the
  pFq #518, and the `√(Sinh·Tanh)`/`√(Cosh·Coth)` quarter-power oddballs
  (6.7.1 #560/#563). See docs/rubi/RUBI.md §5 R29.
- **Engine-side fix LANDED (found by R29): `ComputeEngine._numericValue` no
  longer throws on exact-radical `.N()` results.** `_numericValue`
  (`src/compute-engine/index.ts`) used to throw "Unexpected value for radical
  part" when a numeric evaluation landed on an exact radical whose radicand was
  non-integer, or an integer at/above `SMALL_INTEGER` (1_000_000) — e.g. a
  random parameter substitution hits `a+b = 2` and the antiderivative's value
  contains `√2`. Every call site in the Rubi driver caught it (throw →
  decline), so it never produced a wrong answer, but it made D-verified
  closures **seed-fragile**: 6.4.7 #36 closed under the benchmark seed yet went
  inert under `evaluate()`'s fixed seed. Fixed by extracting any perfect-square
  factor (`√(k²·r) = k·√r`) and either staying exact (square-free part below
  `SMALL_INTEGER`) or falling back to the float lane, instead of throwing.
  Regression tests in `test/compute-engine/radical-arithmetic.test.ts`.

#### F. Fungrim — solving coverage

**Decoupled from Wester.** The two remaining Wester `Solve` gaps are harness
artifacts (B9), so additional Fungrim solve rules will **not** move that number
— the Wester `Solve` rows are saturated at our principled ceiling (14/21). On
the track's own benchmark (`benchmarks/audit/solve.ts` / `REPORT-solve.md`,
40 SymPy-derived univariate cases) **CE+Fungrim is at parity — 38/40 = SymPy
= Mathematica (base CE 33) — and this track is done as a coverage effort**
(shipping in the next release: native inverse-trig/hyperbolic/two-`Abs`
solving, LambertW W₋₁ 2-arg branch, Lambert solve templates on both real
branches). Residual, none benchmark-reachable:

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
  Complex-domain Fungrim rules already carry their own loader guards.
  _(Landed since: even powers now use the always-sound `ln(x²) → 2ln|x|` and
  `√(x²) → |x|`; odd and irrational exponents keep the optimistic generic-real
  convention (`ln(x³) → 3ln(x)`) for unconstrained symbols, and symbols declared
  `complex` are excluded from these rewrites entirely — see
  [`docs/SIMPLIFY.md`](./docs/SIMPLIFY.md#generic-real-simplification-policy).)_

- **(c) Exact asymptotics at special-function poles — LANDED 2026-07-10**
  (the limit guard and `Residue` are wired to the exact Laurent kernel;
  design + record in
  [`docs/plans/2026-07-10-pole-asymptotics-design.md`](./docs/plans/2026-07-10-pole-asymptotics-design.md)).
  The follow-up rungs landed the same day: **residue at infinity**
  (`Res_∞ f = −Res_{s=0} f(1/s)/s²`, any infinite point naming the
  Riemann-sphere point), **signed pole limits** (convention decision:
  directional limits at poles resolve to `±∞`, two-sided only on even
  valuation — `lim 1/x²` at 0 is `+∞`, `lim 1/x` at 0 stays inert; no
  `ComplexInfinity` limits; `ln`/`log` divergence rides the argument's
  expansion), and **`Beta` pole data** via the `Γ`-quotient rewrite in the
  kernel (`GammaLn` remains a genuine non-goal: logarithmic branch point,
  not meromorphic). One rung remains, demand-paced:
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
mid-range digits, …), and the item-5 perf levers (per-opDef signature
caches, bundle cold-start).

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

### Cortex examples sweep 2 (2026-07-11) — engine residuals

The second Cortex examples sweep (units, calculus, linear algebra,
dictionaries/sets, closures, strings) surfaced and same-day **fixed**: plain
string escape double-processing (Cortex), `N()` not numericizing through
user-function application (threaded inside the closure's scope frame —
re-evaluating outside it breaks lexical scoping), exact `Inverse` +
matrix-typed results + new `LinearSolve`, 3-arg `Limit(expr, var, point)`,
`Quantity` string units, dictionary `Keys`/`Values`, and `Intersection` on
lists; a follow-up round fixed the `Intersection(Filter, Filter)` stack
overflow (`Filter.contains` recursed into itself) and representation-sensitive
collection equality (computed/lazy/symbol-valued collections now compare equal
to literals with the same elements, and collection-vs-collection `Equal` no
longer broadcasts), and landed multi-variable `Solve([eq1, eq2], [x, y])`
(ratified shape: a `List` of `Tuple`s in variable-list order, matching the
multi-domain enumeration contract), and moved the interval reading of
ambiguous bracket pairs to the LaTeX boundary (`x \in [1, 5]` unchanged;
MathJSON/Cortex 2-element `List`s in set operations are now collections, so
`Intersection([1,2], [2,3])` → `Set(2)`).

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
  intervening work; pinned 2026-07-18 by the regression suite in
  `serialization.test.ts` ("Bound-variable identity across re-boxing").

**Lessons worth keeping in mind** (the durable ones are in CLAUDE.md): the
`undefined → false` collapse in three-valued predicates was the single most
recurring bug class (A3, G3, the sets/Union/Range contains family, NaN
comparisons); validation-by-corpus (the Fungrim harness) found 15 engine bugs
that targeted review missed — keep running it.
