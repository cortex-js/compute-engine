# Rubi → Compute Engine: Feasibility Analysis

**Date:** 2026-06-10 (feasibility); last status update 2026-07-09.
**Status:** shipped bundle = **Chapters 1, 2, 6 + 4.1 Sine + 4.5 Secant**
(4,531 rules). Chapter-1 exhaustive ≈90–91%; ch2 ≈72% / ch6 ≈45% effective;
**4.1 Sine 106/120 and 320/400 (seed 5; 4.1.11 file 71/113); 4.5 Secant
56/120; genuine wrongs 0 across all suites** (all flagged "wrongs" are
documented verification false-wrong classes — see the ROADMAP §R state note).
The 2026-07-04 rung series (R1/R2/R4, R10, R11, R9, R14 — §5 below) added the
cofunction product clauses, the ch1-foundation benchmark fix,
`reciprocalToPower`, the `cofunctionShift` and `standaloneCosineShift` runtime
routing, the trig→exp fallback, and argument-aware `deactivateTrig`; R15
(2026-07-09) added the rational×sin(linear) → Si/Ci partial-fraction fallback.
**Next rungs live in ROADMAP §R** (R12 bundle 4.3 Tangent, R13 sec binomials,
R16 the 4.1.10 `(a+b·sin)`-denominator Si/Ci chains, R3′ deep chains, R5;
then the Ch6 tail R6–R8). The §1–§4 analysis below is
the original feasibility study (still accurate); §5 carries the current
phasing status, and the project memory (`project_rubi.md`) has the
session-by-session log.

Rubi (Rule-Based Integration, [rulebasedintegration.org](https://rulebasedintegration.org/))
is Albert Rich's corpus of **7,439 symbolic integration rules** organized as a
specificity-ordered rewrite system, plus a **72,678-problem test suite**. Both
are MIT-licensed. Rubi is frozen at release 4.17.3.0 (Dec 2023, posthumous —
Albert Rich died Aug 2023; the Rubi 5 decision-tree restructuring was
abandoned in 2021). Like the Fungrim snapshot, this makes it a one-time corpus
import with no upstream-sync burden.

This project follows the Fungrim playbook (`docs/fungrim/FUNGRIM.md`):
translate a third-party corpus to MathJSON offline, compile to a checked-in
artifact, load through a dedicated opt-in entry point. The critical difference:
**Fungrim is a corpus of facts; Rubi is a corpus that encodes an algorithm.**
Rule ordering, recursion into `Int`/`Subst`, and a utility-function layer
defining "simpler" are load-bearing. Porting rules without the dispatch
discipline produces a slow, wrong integrator (that is what happened to SymPy's
port, removed in 2022); porting them with it works (Symja; the 2025 Julia
SymbolicIntegration.jl GSoC port, ~3,400 rules — our closest playbook).

## Verdict

Feasible, in phases, with Chapter 1 (algebraic integrands) as the target of
the first real milestone. The numbers below say Chapter 1 is much more
self-contained than Rubi's reputation suggests: 2,648 rules (36% of the
corpus) needing only 71 of Rubi's 328 utility functions, most of which are
trivial predicates that map directly onto CE's assumptions/type machinery.
The current CE integrator solves a meaningful fraction of easy Chapter-1
problems already (see baseline below); Rubi Chapter 1 alone would put CE's
algebraic integration at near-CAS-grade coverage (25,876 test problems).

## 1. What Rubi Contains

Snapshot at `~/dev/rubi/Rubi-4.17.3.0/` (from the 4.17.3.0 release tarball)
and `~/dev/rubi/MathematicaSyntaxTestSuite-master/`.

**Rules** (`Rubi/IntegrationRules/`, 200 `.m` files, auto-generated from the
source notebooks; superseded rules are kept as comments and must be skipped —
`grep '^Int\['` counts only live rules):

| Chapter | Rules | Test problems |
| --- | ---: | ---: |
| 1 Algebraic functions | 2,648 | 25,876 |
| 2 Exponentials | 125 | 965 |
| 3 Logarithms | 337 | 3,088 |
| 4 Trig functions | 2,126 | 22,634 |
| 5 Inverse trig functions | 669 | 4,630 |
| 6 Hyperbolic functions | 390 | 5,079 |
| 7 Inverse hyperbolic functions | 718 | 6,581 |
| 8 Special functions | 310 | 1,949 |
| 9 Miscellaneous | 116 | — |
| 0 Independent suites (tests only) | — | 1,876 |
| **Total** | **7,439** | **72,678** |

**Rule anatomy** — a Wolfram-Language rewrite rule with a side condition:

```mathematica
Int[(a_. + b_.*x_)^m_, x_Symbol] :=
  (a + b*x)^(m + 1)/(b*(m + 1)) /;
FreeQ[{a, b, m}, x] && NeQ[m, -1]

Int[(a_. + b_.*u_)^m_, x_Symbol] :=
  1/Coefficient[u, x, 1]*Subst[Int[(a + b*x)^m, x], x, u] /;
FreeQ[{a, b, m}, x] && LinearQ[u, x] && NeQ[u, x]
```

Three structural features matter:

1. **Optional-default patterns**: `a_. + b_.*x_` must also match bare `x`
   (with `a → 0, b → 1`), `b*x` (with `a → 0`), `a + x` (with `b → 1`).
   Combined with orderless `Plus`/`Times` matching, this is the main
   pattern-semantics gap vs. CE's matcher.
2. **Side conditions** built from predicates: `FreeQ`, `EqQ`/`NeQ`,
   `IntegerQ`/`IGtQ`/`ILtQ`, `GtQ`/`LtQ`/`GeQ`/`LeQ` (numeric-symbolic
   comparison), `PolyQ`/`LinearQ`/`BinomialQ` (structure tests), plus
   "judgment" predicates (`SimplerQ`, `SumSimplerQ`) encoding the
   termination order.
3. **Recursive RHSs**: rules rewrite `Int` to expressions containing `Int`
   (reduction formulas) and use `Subst` (change of variable, with
   back-substitution). Termination relies on rule ordering + the judgment
   predicates — there is no global termination proof.

**The utility layer** (`IntegrationUtilityFunctions.m`): 759 definitions over
328 distinct names. Only **127 names are referenced by rules at all**; the
rest are internal helpers. Per-chapter cut (from the Phase-0 survey):

- **Chapter 1 needs 71 utility names.** By call count, the top of the list is
  dominated by trivial predicates: `FreeQ` (2,633 call sites), `EqQ` (1,607),
  `NeQ` (1,240), `IntegerQ` (1,170), `GtQ`/`LtQ`/`IGtQ`/`ILtQ` (~2,460
  combined) — all directly expressible over CE types/assumptions/`isSame`.
- The genuinely algorithmic utilities needed by Chapter 1 are a short list:
  `Rt`/`RtAux` (n-th root normal form, ~1.8K chars of WL), `Simp`/
  `FixSimplify`/`SimpFixFactor` (Rubi's local simplifier, ~6.5K),
  `ExpandIntegrand` (partial fractions + expansion, ~9.5K — the single
  hairiest), `ExpandToSum`, `Subst` (with `Defer`-like substitution
  semantics), `Coeff`/`Expon` (polynomial accessors), `FracPart`/`IntPart`,
  `PosQ`/`NegQ` (sign heuristics), `PolyQ`/`LinearQ`/`BinomialQ`,
  `SimplerQ`/`SumSimplerQ` (the termination order). Realistic estimate:
  ~2–3K lines of carefully tested TypeScript.
- 56 utility names are needed only by later chapters (mostly the inert-trig
  machinery: `UnifyInertTrigFunction`, `FixInertTrigFunction`,
  `TrigSimplifyAux` — irrelevant until Chapter 4).

**Special-function heads emitted by Chapter-1 RHSs** (call sites, not rules):
`Hypergeometric2F1` (17), `AppellF1` (8), `EllipticE` (30), `EllipticF` (33),
`EllipticPi` (9) — i.e. ~100 of 2,648 rules produce non-elementary results.
All five heads already exist in CE as Fungrim shell declarations; they need
numeric kernels (ROADMAP item 4) only for *numeric verification* of those
rules, not for the port itself.

**Test suite**: one-line WL lists `{integrand, variable, step-count,
optimal-antiderivative}`, 99.15% parseable with the small InputForm parser in
`scripts/rubi/wl-parser.ts` (the 617 rejects are version-conditional answers
like `If[$VersionNumber<9, …]` and annotated entries in the independent
suites). Verification is self-checking: differentiate the candidate and
compare numerically with the integrand — no need to match Rubi's preferred
antiderivative form.

## 2. Lessons from prior ports (design constraints)

- **SymPy (failed, removed 2022)**: auto-translated all rules into a flat
  general-purpose matcher; hour-long module loads, timeouts, wrong results;
  the utility layer was never faithfully reproduced. *Constraint: do not load
  Rubi rules into `simplify()`'s rule list; do not ship without indexed
  dispatch.*
- **Symja (succeeded)**: dumped `DownValues` from Mathematica in FullForm to
  sidestep parsing ambiguity, generated Java rule classes, priority = rule
  order. Enabler: a WL-compatible pattern matcher. *Takeaway: rule order is
  the priority; preserve it exactly. Symja's pre-extracted
  `RubiRules4.16.0_FullLHS.m` exists if our own `.m` parsing proves
  ambiguous.*
- **Julia SymbolicIntegration.jl (succeeded, 2025)**: semi-automated pattern
  translation + *hand-written* utility layer + chapter-by-chapter,
  validated per-chapter against the test suite. ~3,400 rules in one focused
  summer. *This is the playbook.*

## 3. What CE Already Has Going For It

- **The Fungrim pipeline as architecture**: offline translator → corpus with
  MANIFEST provenance (`data/rubi/`) → compile-time rule artifact with
  fire-self-tests → opt-in loader entry point (à la
  `@cortex-js/compute-engine/identities`, e.g.
  `@cortex-js/compute-engine/integration`, `loadIntegrationRules(ce)`),
  keeping the main bundle untouched.
- **Operator-indexed rule dispatch + pre-screen machinery** (Track 2): the
  required-feature-set pre-screening in `src/compute-engine/fungrim/loader.ts`
  carries over. Note all Rubi rules share one head, so the *existing* head
  index discriminates nothing — Rubi needs its own second-level index (see
  §4B).
- **The assumptions system** (Track 3): `IntegerQ`, `GtQ`, `NeQ` etc. over
  symbolic parameters are exactly guard-discharge queries; the three-valued
  fail-closed discharge semantics is the right behavior for side conditions.
- **A working baseline integrator** (`symbolic/antiderivative.ts`: LIATE
  by-parts, u-substitution, linear substitution, a hand-rolled rule table) —
  useful as the fallback when Rubi rules don't fire, and as the baseline the
  benchmark measures against.
- **Existing heads** for every special function Chapter 1 emits (Fungrim
  shells).

## 4. New CE Features Required

### A. Pattern-matcher extensions — **required, the first technical risk**

1. **Optional-default operands**: support `a_. + b_.*x_`-style patterns.
   Options: (i) extend the matcher with default-value wildcards
   (MathJSON rules already have `_a` wildcards; needs a "match-absent →
   default" variant); (ii) **compile-time expansion** of each Rubi pattern
   into its 2^k explicit variants (absent/present per optional), preserving
   relative order. Option (ii) needs zero matcher changes and is the planned
   starting point; measure the blow-up (k ≤ 3 for most rules) before
   considering (i).
2. **Head-typed wildcards** (`x_Symbol`): the integration variable slot —
   trivial, the driver always knows the variable.
3. **AC matching discipline**: Rubi patterns lean on orderless `Plus`/`Times`
   with sequence defaults (`u_.*(v_+w_)^p_.`). CE's matcher does commutative
   matching; the spike (Phase R1) must establish whether its backtracking
   handles Rubi's pattern shapes at acceptable cost.

### B. A dedicated `Int` driver — **required**

A fixed-point rewriter, **completely separate from `simplify()`** (CLAUDE.md
recursion constraints apply: Rubi rules recurse by construction):

- **Second-level dispatch index** keyed on integrand skeleton (operator
  multiset / leading structure: `Power(linear, _)`, `Multiply(Power(linear),
  Power(linear))`, …), built at artifact-compile time. Within a bucket,
  strict rule-order priority (= Rubi's specificity order).
- **Recursion budget + memoization**: depth cap, an `Int`-subproblem cache,
  and a step counter analogous to `simplify.ts`'s guards. Subproblems that
  fail fall back to `antiderivative.ts`, then to inert `Integrate`.
- **Deadline checks**: every driver iteration checks `ce._timeRemaining` —
  which is ROADMAP item 2 territory; see §6.

### C. The utility layer — **required, hand-written**

`src/compute-engine/rubi/utils.ts` (or similar): the Chapter-1 cut of ~71
names. Trivial predicates map to existing CE machinery; the ~15 algorithmic
ones (§1) are hand-ported with unit tests derived from their WL definitions.
Every port (Symja, Julia) reports this as the real cost center — budget
accordingly and port *lazily*: only what the currently-ported chapter
references.

### D. Numeric kernels for emitted heads — **deferred to verification time**

`Hypergeometric2F1`, `EllipticE/F/Pi`, `AppellF1` (ROADMAP item 4 covers the
first four). Without them, the ~100 affected Chapter-1 rules can still be
*ported* (results stay symbolic) but their test problems report
`not-evaluable` instead of `solved-correct`.

## 5. Proposed Phasing

- **Phase 0 (done, 2026-06-10)**: corpus snapshot at `~/dev/rubi/`;
  survey (the numbers in §1); test-suite parser + loader + baseline
  benchmark harness (`scripts/rubi/`). **Baseline** (seeded 500-problem
  random sample over Chapter 1, `scripts/rubi/baseline-ch1-500.json`):
  the current integrator scores **13 solved-correct (2.6%)**, 478 unsolved,
  **3 solved-wrong**, 6 stack-overflow errors, and one problem ran 156 s
  uninterruptibly (ROADMAP item 2 in action). The solved-wrong cases are
  pre-existing `antiderivative.ts` bugs surfaced by the suite — e.g.
  `∫(a + b·x⁴)/x⁶ dx` returns `−b/x`, silently dropping the `a/x⁶` term,
  and `∫x⁶/(1−x⁶) dx` returns an incomplete partial-fraction result —
  worth fixing independently of the port (validation-by-corpus strikes
  again).
- **Phase R1 — feasibility spike (~1–2 weeks)**: translator skeleton
  (`.m` → WL AST → MathJSON rule corpus with provenance manifest, optional-
  pattern expansion); port section 1.1.1 *end to end* (linear binomials,
  ~250 rules, the simplest utility cut) with a minimal driver; validate
  against the 5,501 section-1.1.1 test problems. **Exit criterion:** ≥95%
  solved-correct on 1.1.1 with acceptable performance, or a written
  diagnosis of why the matcher/driver approach can't get there.
  - *Translator: DONE (2026-06-10).* `scripts/rubi/translate.ts` +
    `extract-rules.ts` + the extended `wl-parser.ts` extract **100% of the
    corpus** (7,413/7,413 rules; count verified file-by-file against
    comment-stripped sources; `$LoadShowSteps` display variants dropped in
    favor of the plain definitions). Checked-in corpus at `data/rubi/`
    (Chapter 1 scope, 2,647 rules, 3.7 MB). Regression tests:
    `test/compute-engine/rubi-translator.test.ts`.
  - *Driver pipeline: WORKING END-TO-END (2026-06-11, first iteration).*
    `compile.ts` (skeleton-boxing → matcher IR; optionals NOT expanded —
    handled natively by the matcher), `match.ts` (backtracking AC matcher
    with optslot defaults, node collapse, final-slot rest-absorption),
    `normal-form.ts` (Times/Power normal form bridging CE's canonical
    Divide/Negate/Sqrt/Root vocabulary to Rubi's — applied to both
    patterns and integrands; `recanonicalize` scrubs synthetic nodes out
    of bindings), `rubi-utils.ts` (~30 predicates with Rubi semantics,
    fail-closed; value utilities incl. an ExpandIntegrand that expands
    P(x)·Lⁿ by repeated polynomial division for any literal exponent),
    `driver.ts` (priority dispatch, linearity prelude, memo/cycle guard,
    depth cap, wall-clock deadline — the engine deadline only arms inside
    evaluate()). All 235 section-1.1.1 rules compile, zero skips.
    **Standing on the seeded 200-problem 1.1.1 sample: ~23% solved-correct,
    ~48% unsolved, ~24% not-evaluable** (run
    `scripts/rubi/benchmark.ts --rubi <section-corpus-dir>`).
  - *Iteration 2 (2026-06-12): 64% solved-correct (128/200; 24 unsolved,
    35 not-evaluable, 4 wrong, 9 inconclusive).* What moved the needle:
    (a) **condition-driven backtracking** (`matchAll`): Mathematica retries
    alternative AC assignments when a condition rejects — (a+bx)^m/(c+dx)^n
    factor roles are interchangeable and conditions often hold for one
    orientation only; (b) **multi-factor partial fractions** in
    ExpandIntegrand (Heaviside derivative formula over distinct linear
    factors); (c) an **x-aware polynomial toolkit** (degree/monomials/long
    division treating x-free subtrees as coefficients — CE's polynomial
    fns reject `d²/b·x²`-style coefficients that reduction RHSs produce);
    (d) **loading all of chapter 1.1** (1,322 rules, 0 compile skips):
    1.1.1 chains legitimately route through 1.1.2 (e.g.
    (1−x)(1+x) → 1−x²); (e) **verification switched to numeric central
    difference** — symbolic D was poisoned by an engine unsoundness (below).
    Perf: zeroQ/simplify caches per int() call + root-operator dispatch
    pre-screen; 200 problems ≈ 7 min wall.
  - **ENGINE BUG (to fix separately, snapshot-gated):** `simplify()`
    rewrites `x/√(x²) → 1`, losing `sign(x)` (sound only for x>0), and the
    `D` evaluate handler simplifies its output, so
    `D(√(x²)).evaluate() → 1` and `D(1/√(c·x²)).evaluate() → −1/(x²√c)`
    (sign-wrong for x<0). Surfaced as a false "solved-wrong" cluster:
    driver results matching Rubi's expected antiderivatives exactly were
    flagged because the *checker's* derivative was unsound. `simplify()`
    of `√(x²)` alone is sound (`|x|`), so the bug is in a quotient/product
    power-combination rule. Repro:
    `ce.expr(['Divide','x',['Sqrt',['Power','x',2]]]).simplify()` → `1`.
    Known buckets (trace census via `RubiDriver({trace:true})` +
    `findFailingConjunct`):
    (a) unsolved concentrates in 1.1.1.3/.4/.6/.7 (3–4-linear products,
    P(x) forms) — conditions reject; needs per-problem comparison against
    Rubi's expected rule chain (likely Simp/SimplerQ fidelity + more
    ExpandIntegrand modes);
    (b) not-evaluable = verification can't find 3 evaluable sample points
    (₂F₁ args outside |z|<1 kernel domain, radicals at negative x) — an
    fp-verification problem, not necessarily wrong results;
    (c) 7 solved-wrong cluster on `(c·x²)^(3/2)` shapes (FracPart rules) —
    one representative re-verified correct after the binding-
    recanonicalization fix, needs re-measurement;
    (d) 1 error: NaN→BigInt in Rt on `(1−x)^(1/3)/(1+x)`.
    Debugging lessons hard-won: never `evaluate()` the integrand (expands
    products, destroys rule structure); `ce.number()` does not accept
    MathJSON arrays (spins — use `ce.expr`); collapse matching requires ≥1
    defaulted optional or `Int[-Fx_]` matches everything.
  - **R1 EXIT — CLEARED (2026-06-12).** After iteration 2, sessions b–f
    pushed the full 5,509-problem section-1.1.1 run to **96.30%** at the
    exit gate, then **97.93%** after the predicate batch + collection +
    PolyQ fix, and item-4 (the elliptic branch-phase cluster) brought
    1.1.1 to **98.28%** once RtAux principal-branch rendering + the
    `√(k·u), k<0` branch-soundness fix landed. Net levers across R1:
    ~25 transcribed predicates (BinomialParts/IntBinomialQ families etc.),
    eager polynomial-factor collection in the driver, `PolyQ[u, x^k]`
    semantics, `RtAux` root distribution, the region-phase `solved-formal`
    verification acceptance, and a batch of engine branch-soundness fixes
    (ROADMAP items 10/15). Full blow-by-blow in the project memory
    (`project_rubi.md`).
- **Phase R2 — Chapter 1: GATE CLEARED (2026-06-13).** Seeded stratified
  sample of **1,935 problems across all of Chapter 1 = 94.0% solved-correct**
  (≥90% target met). By section: 1.1.1 = 98.5%, 1.1.2 = 95.7%,
  **1.1.3 = 84.9% (the weak spot — 41 unsolved, symbolic-exponent
  `(a+b·xⁿ)^p` chains)**, 1.1.4 = 94.4%, 1.2.1 = 95.8%. Only 0.8% wrong and
  0 errors — the residue is now *unsolved*-dominated (coverage gaps), not
  *wrong*-dominated (correctness). Report: `/tmp/rubi-ch1-sample-final.json`.
  - **Driver hangs RESOLVED (2026-06-13) — root cause was an engine
    canonicalization infinite loop, now fixed.** The exhaustive run had been
    blocked by a handful of 1.1.2/1.1.3 problems hanging 2–12 min (worst
    736 s). Root cause (found via engine-primitive probing + a deep-recursion
    stack dump): a non-terminating cycle between `factor()` and canonical
    `mul`. `Product.mul` → `term.toNumericValue()` on an `Add` →
    `toNumericValue` (boxed-function.ts) calls `factor()` → `factor`
    (factor.ts) extracts the rational/radical GCD `common` and returned
    `mul(common, add(newTerms))`, but canonical `mul` **re-distributed**
    `common` back into the sum, reproducing the original `Add` → … forever,
    for sums with irrational terms (the antiderivative
    `½·x·√(a+bx²) + a·artanh(…)/(2√b)`). `factor` (un-distribute) and
    canonical `mul` (distribute) are inverse operations that never reach a
    fixed point on these forms. **Fix (committed): `factor()` now builds the
    factored product with a non-distributing `ce.function('Multiply', …)`
    instead of the expanding `mul()`, so the GCD stays factored and the cycle
    terminates.** General engine fix (any consumer constructing such a sum
    was affected). **Effect: 1.1.2.2#425 422 s → 51 ms; the full 1.1.2.2
    section (1071 problems) now 1018 solved / 0 errors / slowest 9.5 s.**
    A consequence of dropping the radical guard: `factor()` now also pulls
    radical content out of sums (`√3(√2x+x)` simplifies to `√3·x·(1+√2)`,
    not `(√3+√6)x`) — a deliberate direction change; affected simplify
    snapshots/assertions were updated.
  - **`matchAll` deadline — DONE (2026-06-13), kept as defensive insurance.**
    The matcher threads the driver deadline (`match.ts`, strided
    `checkDeadline` in `m()`; regression test `rubi-match.test.ts`). It was
    NOT the actual overrun source (the matcher's deterministic-first ordering
    rarely blows up) but bounds any pathological match.
  - **Engine canonicalization fix — `x^(-1/2)` vs `1/√x` (2026-06-13).**
    Separate bug surfaced while reviewing the suite: `Power(u,-1/2)` stayed a
    Power node while `1/√u`, `√u^(-1)`, `1/u^(1/2)` all canonicalized to
    `Divide(1, Sqrt(u))`, so `D(arcsin x) = (1-x²)^(-1/2)` did not unify with
    the integrand `1/√(1-x²)` → ∫1/√(1-x²) returned unevaluated. Fixed in
    `arithmetic-power.ts` (negative unit-fraction exponents → `1/Root(u,n)`,
    branch-safe) + the `antiderivative()` recognizer now also matches the
    current `Divide(1,Sqrt(q))` form (it only knew the old `Sqrt(1/q)` form
    the `1/√u→√(1/u)` fold used to produce). Recovers the
    arcsin/arsinh/arcosh integral family; full suite green (one unrelated
    OEIS network test aside).
  - **Latest measurement (post-fix):** full 1.1.2.2 = **1018/1071 (95.0%),
    0 errors, no hangs**; Ch.1-wide 400-sample (seed 7) = **354/400 (88.5%),
    0 errors, slowest 52 s (1 straggler)**. The seed-42 stratified
    1,935-sample is **94.0%**; cross-seed variance is largely **verification
    flakiness** on fractional-power/₂F₁ antiderivatives (the benchmark uses
    central-difference D-check with random real parameters, which lands on
    different radical branches → false-wrongs — NOT a quality drop; not Monte
    Carlo).
  - **Exhaustive run — DONE (2026-06-13), the authoritative R2 number.** All
    **25,854 Chapter-1 problems ran end-to-end in ~1 h, 0 hangs, 0 skips**
    (first time feasible — the `factor()`/`mul` fix removed the multi-minute
    stalls). **Result: 90.0% solved** (correct + region-phase formal):
    23,230 correct + 35 formal / 263 wrong (1.0%) / 1,617 unsolved (6.3%) /
    514 inconclusive / 168 not-evaluable / 27 error. **R2 gate (≥90%) cleared
    on the full run** (the 94% seeded sample was optimistic — the full run
    carries the complete weight of the weak 1.1.3 and 1.3 tails). By section:
    1.1.1 97.9%, 1.1.2 94.3%, **1.1.3 85.7%**, 1.1.4 96.3%, 1.2.1 92.6%,
    1.2.2 85.9%, 1.2.3 80.3%, 1.2.4 78.6%, 1.3.1 72.3%, **1.3.2 56.3%**
    (worst rate). Report `/tmp/rubi-ch1-exhaustive.json`.
  - **Error cluster — FIXED (committed `6ceb8990`).** All 27 errors were one
    bug: the corpus uses Rubi's unary predicate forms `EqQ[u]`/`NeQ[u]`
    (compare to 0), which our `PRED_FNS` only handled binary, so
    `build(args[1])` hit `undefined` (`json is not iterable`). Fixed with an
    `eqDelta` helper; the 27 → 24 correct / 2 unsolved / 1 wrong, 0 regressions.
    Added a `benchmark --keys <file>` option for targeted cluster re-validation.
  - **1.1.3 coverage — `Numer`/`Denom` fix (committed `6ceb8990`): +138
    solved-correct.** The cube/sixth-root elliptic rules (e.g. 1.1.3.1#14
    `∫1/√(a+b·x³)`) bind `r=Numer[Rt[b/a,3]]` using Rubi's own
    radical-splitting abbreviations `Numer`/`Denom`; `rubi-utils` only had
    `Numerator`/`Denominator`, so those bindings stayed inert `Numer(…)` heads
    that blocked closure. Aliased `Numer`→`.numerator`, `Denom`→`.denominator`
    (CE already splits radicals the same way). Re-run of the 429 1.1.3 unsolved:
    **138 → solved-correct, 30 → wrong, 18 inconclusive, 243 still unsolved.**
  - **1.1.3.4 two-binomial wrongs — FIXED: an UPSTREAM RUBI BUG.** The 30
    `∫x^m·(c+d·x³)^(k/2)/(8c−d·x³)` wrongs traced to **Rubi 4.17.3.0 rule
    1.1.3.6 #19/#20**: splitting `(e+f·xⁿ)` out of `(g·x)^m` gives
    `f·xⁿ·(g·x)^m = (f/gⁿ)·(g·x)^(m+n)`, so the second term's coefficient is
    `f/gⁿ` — but the Rubi source writes `f/eⁿ` (`e` = the constant of the third
    binomial, not the coefficient `g` of `(g·x)^m`). With the common default
    `g=1` it should be just `f`; `f/eⁿ` instead divides by `eⁿ` (= the spurious
    `(16c²)³` factor seen as `29.5cd → 59cd/8192c⁶`). Every other rule in the
    chain (#28/#38/#43/#48) is provably correct in isolation; a *linearity*
    test (`driver.int(∫(k0·x+k1·x⁴)/…)` ≠ `k0·∫x/… + k1·∫x⁴/…`) isolated the
    mis-routing to the 3-binomial rule #19. **It is genuinely upstream** (raw
    vendored source confirmed); it survives in Rubi because that rule rarely
    fires under Mathematica's dispatch. **Fix:** `f/eⁿ → f/gⁿ` in the corpus
    (rules #19/#20) + a durable `applyUpstreamCorrections()` patch in
    `extract-rules.ts` (so regeneration preserves it). All 30 → solved-correct,
    0 regressions.
  - **1.3.1 Rational functions — native-integrator fallback (kept).** When the
    Rubi rule chain does not close a *numeric* rational integrand, the driver
    now falls back to CE's native `antiderivative()` (bounded by the driver
    deadline; gated by `RUBI_NO_NATIVE_RATIONAL`). This recovered +12 of the
    117 1.3.1 unsolved with no wrongs/regressions. It is the rules+native
    coexistence `loadIntegrationRules` ships with. Symbolic-coefficient and
    high-degree numeric rationals still need polynomial factoring (a shared
    capability gap); 1.3.2 is ~92% algebraic (Euler-substitution), out of this
    fallback's scope. Separately, the native partial-fraction path it relies on
    was made sound and exact (repeated-factor `0`-bug fixed, monomial-content
    factoring, exact bigint solve) so repeated-factor rationals now integrate.
  - **Packaging — DONE (2026-06-14): opt-in `loadIntegrationRules`.** Shipped
    the `@cortex-js/compute-engine/integration-rules` sub-path in four phases:
    (1) engine `_integrationProvider` hook on `Integrate.evaluate` + moved the
    runtime driver into `src/compute-engine/rubi/` + loader (`9c7e593e`);
    (2) bundle compaction 3.73 → 2.92 MB (strip runtime-dead `source`);
    (3) build/exports wiring + clean `.d.ts` (`2e4870fb`); (4) CI
    bundle-freshness gate in `corpus-pipeline` (`06ce9f75`).
    `loadIntegrationRules(ce)` compiles the bundled Chapter-1 corpus (2647
    rules) and registers the rule driver, which the `Integrate` evaluator
    consults before the built-in antiderivative (which still covers
    Gaussian/Fresnel/etc.). Loader test: 8 cases, D-verified.
  - **Still open for R2 completion:** (1) remaining 1.1.3 coverage —
    quartic-denominator `∫(c+d·x²)/(a+b·x⁴)` closing (cluster 2, ~203 unsolved)
    + 1.1.3.8 two-binomial tails; (2) 1.3.2 (56% — worst section) and 1.3.1;
    (3) item-4 branch-phase residue (quad-√ elliptic — the bulk of the 263
    wrongs are root-of-unity phase, the *expected* Rubi forms also fail
    principal-branch verification → consider a global-unimodular-phase
    verification acceptance, debatable).
  - **Packaging follow-ups (post-R2, optional):** (a) a consumer how-to /
    integration guide for `loadIntegrationRules` (mirror the importer-guide
    pattern); (b) larger bundle compaction — the 2.92 MB is mostly rule
    patterns, so tokenizing repeated MathJSON heads (`Power`, `Multiply`,
    `Blank`, …) would shrink it materially; (c) extend the bundled corpus
    beyond Chapter 1 (couples to Phase R3+).
- **Phase R3 — Chapter-4 trig PILOT (DONE, 2026-06-15): de-risk + Wester
  spot-check.** Goal was to calibrate the real per-chapter cost before
  committing to the multi-chapter port, using the three Wester cases
  `∫1/(3cos x+4sin x+k) dx` (k=3,4,5) as the target.
  - **Extraction/compilation are free.** `translate.ts` (extended to accept
    repeated `--section`) extracts all of Chapter 4 at **2,117/2,117 rules, 0
    skipped**, and the corpus **compiles 0-skip** — CE boxes inert `cos[x]` as
    a distinct `"cos"` head, so Rubi's inert/active split survives intact. The
    whole difficulty is at RUNTIME.
  - **The inert-trig layer is the gate.** 77% of ch4 rules (1,631/2,117) match
    *inert* lowercase trig heads; real integrands carry *active* `Sin`/`Cos`,
    so nothing fires until the integrand is "deactivated" on driver entry.
    `ActivateTrig` (inert→active) is a 1-line head-swap; `DeactivateTrig`
    (active→inert) is, in full, `UnifyInertTrigFunction`[75 clauses] ∘
    `FixInertTrigFunction`[61] ∘ `DeactivateTrigAux`.
  - **Minimal bridge shipped.** `rubi-utils.ts` gained `activateTrig` /
    `deactivateTrig` (pure head-swap, NO argument-unification) + the
    rule-invoked `ActivateTrig`/`DeactivateTrig` VALUE_FNs, plus
    `FreeFactors`/`NonfreeFactors` (needed by the Weierstrass tan(x/2)
    substitution). `driver.ts` deactivates per-`intRec` gated by a
    `hasActiveTrig` flag set once in `int()` — a strict no-op for trig-free
    integrands (zero algebraic regression, verified). **~140 lines, ZERO new
    predicates: the entire ch1 utility layer (Simp/Subst/Rt/ExpandToSum/…) is
    reused as-is.**
  - **Result: all 3 Wester cases flip ∅→✅** (D-verified; the degenerate
    `a²=b²+c²` k=5 case via the closed-form rule, k=3,4 via the general
    tan(x/2) Weierstrass rule into a ch1 quadratic/linear sub-integral).
    `REPORT-wester.md`: **CE+R/F 27→32/48, indefinite ∫ →6/8**, every other
    column unchanged. Bundled `4.1.6 (a+b cos+c sin)^n` (57 rules) into the
    shipped artifact (2,647→2,704 rules, 2.92→3.00 MB); loader + 3 new
    regression tests green.
  - **Calibration (the ROI deliverable).** The minimal bridge is **sound** —
    across 240 sampled trig problems it produced **0 wrong / 0 error**; it just
    fails-closed on what it can't yet do. Reach with head-swap alone: the bare
    `(a+b cos+c sin)^n` family solves; broad **4.1 Sine 26/120 (~22%)**,
    `(a trig+b trig)^n` **13/120 (~11%)**. The unsolved ~78% is blocked on
    `ExpandTrig`(33×)/`ExpandTrigReduce`(14×)/`KnownSineIntegrandQ`(22×) +
    the `FixInertTrigFunction`/`UnifyInertTrigFunction` argument-unification
    layer (products/powers/shifted args). That layer is the bulk of the
    full-Chapter-4 cost and remains "its own project."
  - **Go/no-go.** GO on the cheap chapters first: **Ch2 (exp, 125 rules) and
    Ch6 (hyperbolic, 390 rules) use ACTIVE heads in their LHS — zero inert
    layer — so they are ≈ Chapter-1 difficulty** and should precede the full
    ch4 inert-unification effort.
- **Phase R3+ — Chapter 2 (Exponentials) PORTED (2026-06-15).** Full 965-problem
  run: **604 solved / 965 (62.6%; 561 correct + 43 region-phase formal), 0
  errors, 26 wrong (2.7%)**. Effective coverage **≈72.4%** once the 95
  `Unintegrable`-expected problems (where "unsolved" *is* the correct answer)
  and the ~36 correct-but-unverifiable special-function results (₂F₁ outside
  |z|<1, incomplete-Γ at extreme points) are credited. From a ~34% pre-port
  baseline. The 26 wrong are all the incomplete-Γ/`Erfi` **branch-phase
  artifact class** (the driver forms match Rubi's own expected antiderivatives;
  they fail principal-branch numeric verification, not correctness) — not logic
  bugs. Levers, in order of impact:
  1. **2-argument incomplete gamma `Γ(s,z)`** (engine, committed `3c53de54`) —
     the upper incomplete gamma is the closed form for `∫xᵐ·Fᵃ⁺ᵇˣⁿ`; CE only had
     the 1-arg `Γ`. Added real + complex kernels (lower Tricomi series /
     Legendre continued fraction / E₁-seeded recurrence for non-positive-integer
     `s`, plus a large-|z| asymptotic series to kill catastrophic cancellation
     when `Re(z)<0`). mpmath-validated to ~1e-10 except a narrow band
     (`Re(z)<0`, `|z|≈15–25`, negative non-integer `s`) that bottoms out at
     ~2e-3 — a double-precision floor needing Temme's uniform asymptotics,
     deferred. Flipped ~20% of Ch2 from `not-evaluable` (`Gamma(k, Error)`) to
     correct. CHANGELOG + `doc/91` committed `2750ba17`.
  2. **`TrueQ` + `$UseGamma`** (rubi-utils, committed `80be960f`) — the whole
     `Px·Fᵛ` polynomial×exponential family died on the unimplemented `TrueQ`
     predicate; `$UseGamma` is unset (→ `False`), so the `Not[TrueQ[$UseGamma]]`
     `ExpandIntegrand` branch now fires.
  3. **3-arg `ExpandIntegrand[u,v,x]`** = `DistributeOverTerms` (expand `v`,
     multiply each term by `u`) — mirrors the existing 3-arg `ExpandTrig`.
  4. **`FunctionOfExponential` family** (`…Q`/`…`/`…Function`) — the master
     substitution rule 2.3#97 for rational/√ in `Eˣ`. Stateful port
     (`FoeState{base,expon,flag}`) with **hyperbolic-head support** (`Sinh[w] ≡
     (Eʷ−E⁻ʷ)/2`), so it also serves Chapter 6. Added `HyperbolicQ` +
     `SimplifyIntegrand`.
  5. **Same-exponent fusion** in the Rubi normal form (`normal-form.ts`,
     staged): `aˣ·bˣ → (a·b)ˣ`, `aˣ/bˣ → (a/b)ˣ`, so a product of distinct-base
     exponentials presents a single base to `FunctionOfExponential`. Restricted
     to symbolic exponents (`x²·y²` untouched). +9 correct, 0 new wrong.
  - **Residual tail (diminishing returns):** PolyLog/dilog (~51, really
    Chapter-3 territory), exp-of-quadratic/cubic (~35, Erf/exponent-factoring),
    `2.1/2.2` niche sub-shapes.
  - **BUNDLED (2026-06-16).** `data/rubi` re-translated to ch1+ch2+ch4, and
    `bundle-corpus.ts` now walks the whole Chapter-2 directory (`ch2Dir`);
    `loadIntegrationRules` ships the 125 Chapter-2 rules (bundle 2704→2829
    rules). Loader regression tests added (`∫x²/E^(4x)`, `∫eˣ(1+eˣ)³`,
    `∫1/(1+eˣ)`, all D-verified). Shipping Chapter 2 means consumers also get
    its ~2.7% branch-phase wrongs (the incomplete-Γ/Erfi class — Rubi-parity
    forms that fail principal-branch numeric verification, not logic bugs),
    consistent with Chapter 1's ~1% residue.
- **Phase R3+ — Chapter 6 (Hyperbolics) PORTED + BUNDLED (2026-06-16).** Sample
  of 100 problems (`--seed 42`): **37 solved-correct (≈45% EFFECTIVE** crediting
  the 7 `Unintegrable`-expected problems + 1 unverifiable CoshIntegral as
  correctly-handled**), 2 wrong, 0 errors, ≈55 s, no timeouts.** Up from an ≈8%
  baseline (4.6×). The 2 wrong are the same symbolic-exponent incomplete-Γ /
  special-function **branch-phase artifact class** as Chapter 2 (driver forms
  match Rubi's expected antiderivatives; they fail principal-branch numeric
  verification). The levers (all reusing the already-bundled Chapter-2
  exponential machinery — Rubi puts the *bare* hyperbolic-power reductions in
  shared, non-standalone machinery, so the port substitutes equivalent
  exponential routes):
  1. **`ExpandTrigReduce` / `ExpandTrigToExp`** (rubi-utils) — the rule-invoked
     product/power reduction. Implemented as `Expand[TrigToExp[u]]`: rewrite
     Sinh/Cosh → exponential form (`hyperbolicToExp`, ½-distributed so the power
     base stays a pure Add) and multiply out (`deepExpand` + `foldEPowers`,
     which fuses `E^p·E^q` so the expansion stays compact). Each term is then
     `poly·E^(k·arg)`, closed by the Chapter-2 rules (incl. the incomplete-Γ /
     Erf kernels). Solves the nonlinear-argument families (`Sinh[a+b·xⁿ]ⁿ`,
     `Sinh[quadratic]ⁿ`).
  2. **Hyperbolic→exponential driver fallback** (driver.ts) — when no rule
     closes a Sinh/Cosh integrand (gated to polynomial arguments), expand to
     exponential form and re-integrate. Covers the bare/linear `(c+d·x)^m·Sinhⁿ`
     / `(a+b·Sinh)ⁿ` families whose recurrences are not standalone corpus rules.
  3. **`FunctionOfExponential` substitution fallback** (driver.ts) — a pure
     hyperbolic of a LINEAR argument (incl. the reciprocals Tanh/Coth/Sech/Csch)
     is rational in `e^(linear)`; mirror rule 2.3#97's `t = e^v` substitution
     (ungated by `$exponFlag$`, which Rubi requires) → a rational integral the
     bundled rational rules close → undo. This unlocked the whole reciprocal
     chunk (chapters 6.3–6.6) **fast** (the brute exponential expansion grinds on
     reciprocal quotients; the substitution does not). Gated on Rubi's
     `FunctionOfExponentialTest` actually passing (rejects bare-x factors like
     `Tanh/x²` and non-linear arguments) + a try/catch (complex-coefficient
     rational sub-integrands can crash the native integrator).
  - **Output cleanup:** the fallback antiderivatives are exponential-form, not
    Rubi's hyperbolic form (numerically identical, D-verified); a bounded
    `simplify` + `Ln(E)→1` / `E^(0·…)→1` fold (`foldLnExponentialE`) collects
    like terms and tidies them.
  - **Bundling:** `data/rubi` re-translated to ch1+ch2+ch4+ch6; `bundle-corpus`
    walks `ch6Dir` (390 rules, 0 skips; bundle 2829→3219 rules, 3.44 MB).
    Loader tests added (`∫cosh⁴`, `∫sinh³cosh`, `∫tanh²`, `∫csch⁴`). The driver
    fallbacks ship with the runtime regardless; the corpus rules add the
    rule-driven `ExpandTrigReduce` cases.
  - **Remaining tail (no single lever; ≈55 unsolved):** algebraic-in-hyperbolic
    `(a+b·Sinh²)^(p/2)` → elliptic; PARAMETRIC rational denominators
    `1/(a+b·Sinh)` → symbolic-coefficient rational integration (a shared
    capability gap); high-degree rationals (`1/(1−Sinh⁸)`); poly×reciprocal →
    by-parts; CoshIntegral/SinhIntegral for nonlinear-argument reciprocals.
    Each is a distinct, deeper effort — below the ≈72% Chapter-2 target.
- **Phase R1/R2/R4 (4.1-Sine rungs) — cofunction product clauses + binomial
  chains + §4.1 Sine BUNDLED (2026-07-04).** Three rungs landed the same day
  (full prose in the ROADMAP history at `9c39a6f7^…fbda0900`; summary here):
  **R1** ported the `UnifyInertTrigFunction` cofunction *product* clauses into
  `unifyInertTrig` (cos·csc, cos·sec, and sin/csc/cot/tan × `(a+b cos)`
  binomials, from `IntegrationUtilityFunctions.m` §1.0/1.1.2/1.1.3; the sine
  corpus is sin-binomial, so these pay off on recursive subproblems and the
  cos-heavy chapters). **R4** bundled all 21 files of 4.1 Sine (bundle
  3,219 → 4,080 rules) and removed the driver's bare-trig-power fallback
  (bundled sine rules cover it, verified on/off identical); same day, the
  cross-bundle class-identity bug was fixed (ESM code splitting in
  `scripts/build.mjs` — one `BigDecimal` realm — plus duck-typing in
  `numerics/bigint.ts` and `e.name`-based `CancellationError` checks).
  **R2** closed the `(a+b sin)^m(c+d sin)^n` binomial-product chains — the
  blocker was NOT a ch4 utility: (a) the benchmark loaded ch4 *without* the
  ch1 algebraic foundation the shipped loader bundles (base case
  `∫1/(a+2bx+ax²)` from the tangent-half-angle rule had no rule) — the
  harness now preloads ch1/2/6 in `--rubi` mode (`RUBI_NO_FOUNDATION`;
  pre-2026-07-04 4.1 baselines not comparable); (b) inert `csc`/`sec` blocked
  the power rules → `reciprocalToPower` (`csc→sin⁻¹`/`sec→cos⁻¹`, frozen
  under fractional powers for branch safety; `RUBI_NO_RECIP`). Also: the
  `containsError` no-progress guard. Trajectory: 4.1 Sine 46 → 47 (R1) →
  96/120 (R2), sample 400 → 288; the pre-existing wrong `4.1.2.2 #1395` went
  wrong → unsolved (genuine wrongs 0), and the 3 sample-400 flags were
  identified as the **hypergeometric verification-false-wrong class**
  (numeric ₂F₁/AppellF1 mis-grading at non-integer symbolic-exponent
  substitution) that every later rung re-confirms.
- **Phase R10 — cofunction-generation audit + §4.5 Secant BUNDLED
  (2026-07-04).** _The cofunction mechanism, audited and empirically confirmed
  under `wolframscript`:_ Rubi has **no Cosine, Cotangent, or Cosecant chapter**
  and does **no load-time rule generation**. The reciprocal-trig chapter files
  are authored in ONE function of each cofunction pair — the "4.5 Secant"
  chapter is written almost entirely in inert `csc` (e.g. `4.5.1.1 (a+b sec)^n.m`
  is 21 `csc` rules, 0 `sec`), the "4.3 Tangent" chapter in `tan`. At
  **integration** time `DeactivateTrig` maps the active head to the AUTHORED
  inert cofunction via a π/2 reflection — verified:
  `DeactivateTrig[Sqrt[b*Sec[x]],x] → Sqrt[b*csc[π/2+x]]`,
  `DeactivateTrig[(b*Sec[x])^n,x] → (b*csc[π/2+x])^n` — so the csc rules cover
  sec with no separate sec rule. Live `DownValues[Int]` are correspondingly
  asymmetric at the inert level (inert `csc` 427 vs `sec` 163; `tan` 371 vs
  `cot` 97), NOT a generated mirror; the symmetric _active_-head counts
  (`Sec`=`Csc`=45, `Tan`=`Cot`=60) are the small normalization/misc layer, not
  the reduction rules. `FixIntRules[]` (the only load-time rule rewrite) merely
  distributes coefficients over sums — it does not touch heads.
  - **Why CE needs the rules the source omits:** CE's runtime deactivates active
    `Sec` to inert **`sec`** (not `csc[π/2+·]`); its `unifyInertTrig` shifts only
    `cos→sin[π/2+·]` (+ the cos·cofunction two-factor clauses), NOT standalone
    `sec→csc`. So CE's `.m`→corpus translation faithfully inherited the source's
    csc-only authoring and had **no `sec` reduction rules** for the
    `(a+b·sec)^n` power family. Audit (LHS inert-head census, `.m` = CE corpus,
    they match — translation preserves heads):

    | 4.5 Secant section | authored (csc) | native sec | missing sec cofn |
    |---|---|---|---|
    | 4.5.1.1 (a+b sec)^n | 20 | 0→**3** (R10) | 17 |
    | 4.5.1.2 (d sec)^n (a+b sec)^m | 84 | 1 | ~83 |
    | 4.5.2.1 (a+b sec)^m (c+d sec)^n | 45 | 2 | ~43 |
    | 4.5.2.2 (g sec)^p (a+b sec)^m (c+d sec)^n | 45 | 1 | ~44 |
    | 4.5.3.1 (a+b sec)^m (d sec)^n (A+B sec) | 45 | 0 | 45 |
    | 4.5.4.1 (a+b sec)^m (A+B sec+C sec^2) | 27 | 4 | ~23 |
    | 4.5.4.2 …(A+B sec+C sec^2) | 44 | 4 | ~40 |
    | 4.5.10 (c+d x)^m (a+b sec)^n | 14 | 0 | 14 |
    | 4.5.7 / 4.5.9 (a+b (c sec)^n)^p | 15 (csc) | 48 (sec-authored) | — |

    (4.3 Tangent has the mirror gap: `tan`-authored, `cot` cofunction absent —
    e.g. 4.3.2.1 = 56 `tan`, 2 `cot`; 4.3.9 = 21/20. Not yet ported/bundled.)
  - **Approach chosen — PER-SECTION, not a translator transform.** The reflection
    is **messy/rule-specific**, not a clean head-swap: to turn a csc rule into a
    sec rule you reflect the argument (`c+d·x → π/2−(c+d·x)`) AND flip signs via
    the derivative factor (d/dx `Csc` = −`Csc·Cot` vs d/dx `Sec` = +`Sec·Tan`) —
    "NOT a blind head swap." R3 instead used the cleaner branch-safe product
    form `∫(b·sec)^n = (b·Sec)^n·Cos^n·∫1/Cos^n` (and the sign-flipped
    reduction recurrences), each **verified vs `wolframscript`**. Generalizing
    that programmatically across all ~17 families is a larger, higher-risk job
    than the shipping win warrants; teaching CE's runtime to deactivate
    `Sec→csc[π/2+·]` (the faithful mirror of Rubi) would close the whole class
    but is a broad rubi-utils change deferred to a future rung. For now the
    per-section `sec` cofunctions live in the corpus (`4.5.1.1`, ids #500/#501/
    #502).
  - **Ship result.** `4.5 Secant` added to `bundle-corpus.ts` (whole dir, 13
    files, 0 compile skips); `rubi-rules-data.json` **4,080 → 4,531 rules
    (+451), 4.41 → 4.94 MB, one-time compile 378 → 414 ms (~+10%)**. Benchmark
    (`--rubi`, seed 5, sample 120): **4.5 Secant 20 → 31 correct, 0 genuine
    wrong** (the +11 are all `(b·sec)^(half-integer)` power families the sec
    rules close; 1 inconclusive `1/(a·sec³)^(5/2)`, not a wrong; 0 regressions).
    4.1 Sine 98/120 and ch1 180/200 unchanged; rubi unit suites +
    `integration-rules` green. Shipped-path probe (`loadIntegrationRules`, the
    real bundle) closes `√(sec x)`, `√(3 sec x)`, `sec^(5/2)`, `1/sec^(3/2)`,
    `sec³`.
  - **Future chapter ports (the debt this audit surfaces):** every
    reciprocal/cofunction chapter carries the same load-time gap. Before
    bundling **4.3 Tangent** supply `cot` cofunctions (or route `cot→tan`);
    **4.6 Cosecant / 4.2 Cosine / 4.4 Cotangent are not even translated** (Rubi
    has no such source dirs — they are the auto-deactivated cofunctions). The
    durable fix is the runtime `Sec→csc[π/2+·]` / `Cot→tan[π/2+·]` deactivation
    shift in `rubi-utils.ts`, mirroring Rubi's `DeactivateTrig`.
- **Phase R11 — runtime cofunction deactivation shift LANDED (2026-07-04).**
  The durable fix R10 deferred: `cofunctionShift` in `rubi-utils.ts` now mirrors
  Rubi's `DeactivateTrig` (`ReduceInertTrig` ∘ `UnifyInertTrigFunction`'s
  "Cosecant to secant" / "Cotangent to tangent" sections, read from
  `IntegrationUtilityFunctions.m`). It runs in `intRec` right after
  `deactivateTrig`, before `reciprocalToPower`, and reflects the UNAUTHORED head
  of each reciprocal-trig pair onto the AUTHORED one via a quarter-period shift:
  - `sec[e+f·x] → csc[e+π/2+f·x]` (no sign; `sec θ = csc(θ+π/2)`)
  - `cot[e+f·x] → −tan[e+π/2+f·x]` (sign flip; `cot θ = −tan(θ+π/2)`)

  Both are pure functional identities (value-exact for EVERY power, no branch
  hazard), so a bare node-level LEAF rewrite composes through Add/Multiply/Power:
  `(a+b·sec)^m (c+d·sec)^n → (a+b·csc[+π/2])^m (c+d·csc[+π/2])^n` at a COMMON
  shifted argument, matching the 4.5 csc rule family. Results read back cleanly —
  `simplifyTrig`'s `PI_HALF_PLUS` already folds `Csc(θ+π/2)→Sec(θ)` /
  `Tan(θ+π/2)→−Cot(θ)` via the driver's `cleanTrig` (verified: shipped answers
  show `sec(x)`, not `csc(x+π/2)`).
  - **Firing scope (the subtlety — NOT a blind global head swap).** The uniform
    +π/2 leaf reflection is only valid where it doesn't DESYNCHRONIZE arguments,
    so `cofunctionShift` fires only when the integrand is *pure-source*:
    (1) it declines when a CROSS-pair head (`sin`/`cos`/`tan`/`cot`) is co-present
    — the 4.1 `(d·sin)^n (a+b·sec)^m` and 4.5.1.4 `(d·tan)^n (a+b·sec)^m` mixes,
    left to `unifyInertTrig`'s matched-±π/2 clauses; and (2) it reflects, then
    REVERTS if the result carries the target head at ≥2 distinct arguments — the
    WITHIN-pair `csc·sec` desync (`Csc^2·(b·Sec)^(5/2)` → `csc[θ]·csc[θ+π/2]`),
    which would otherwise turn a solvable 4.1.0 integrand unsolvable. This
    precise guard is what keeps 4.1 Sine at **zero** regression while admitting
    the pure-sec reflections (including in recursive subproblems, where most of
    the win lives).
  - **`Cot→tan` is implemented but DEFAULT-OFF** (`RUBI_COFN_COT` toggle). It is
    correct but PREMATURE: 4.3 Tangent is not bundled, and it regresses the
    bundled 4.1 `(g·cot)^p (a+b·sin)^m` families (mixed cross-pair). Enabling it
    is part of the 4.3-Tangent bundling rung, together with the mixed-argument
    "Cotangent to tangent" product clauses.
  - **Numbers (seed 5, `--rubi`).** 4.5 Secant 120: **31 → 56** correct (+25),
    **0 genuine wrong** — the 3 flagged wrong (`4.5.3.1` #27/#30, `4.5.1.2` #333)
    are verification-false-wrongs of the symbolic-exponent Hypergeometric2F1 /
    AppellF1 + `√(Sin²)=|Sin|` class (idx #27 differentiates back EXACTLY at
    integer m, rel ~1e-11; the harness mis-grades at its random non-integer m
    where `(b·Sec)^(4/3)`/`√(Sin²)` flip branch — same class as the documented
    4.1 #690/#205/#116). No regressions: 4.1 Sine 120 = 98, 400 = 293/3/0; ch1
    200 = 180/6; ch2/ch6 (sample 60) unchanged (the shift is a strict no-op for
    non-active-trig integrands, `RUBI_NO_COFN`-confirmed). The 3 hand-added
    `sec` stopgap rules (4.5.1.1 #500/#501/#502) are now shadowed for pure-sec
    inputs (removing them leaves 4.5 at 56) but KEPT as a fallback for the
    reverted within-pair `sec` cases; no bundle change (the shift is runtime
    code, `rubi-rules-data.json` stays fresh).
  - **What ships vs awaits 4.3.** Shipped-bundle probe (`loadIntegrationRules`)
    closes `√(sec x)`, `√(3 sec x)`, `sec^(5/2)`, `1/sec^(3/2)`, `sec³`, and the
    new `sec²·(a+b·sec)`. Integer-power SYMBOLIC binomials (`1/(a+b·sec)`,
    `(a+b·sec)^2`) still stay inert in the shipped bundle: `reciprocalToPower`
    rewrites the reflected `csc` inside a summand to `1/sin` before a csc
    binomial rule can match, and the Add-summand exemption that would fix it
    regresses 4.1 Sine (−20, csc-binomial sine families) — so binomial routing
    awaits a sec-specific (not global) fix. `cot` wins appear only in `--rubi`
    corpus runs with `RUBI_COFN_COT` once 4.3 Tangent is bundled.
- **Phase R9 — poly×trig + nonlinear-argument families LANDED (2026-07-04).**
  Two self-contained driver capabilities closed the bulk of the 4.1.10 / 4.1.11
  / 4.1.12 residual (`src/compute-engine/rubi/{rubi-utils,driver}.ts` only; no
  corpus/bundle change). **Numbers (seed 5, `--rubi`).** 4.1 Sine 120:
  **98 → 106** correct (+8), **0 genuine wrong / 0 not-evaluable / 0
  inconclusive**; 400: **293 → 314** (+21), 3 wrong (the documented
  Hypergeometric2F1/AppellF1/`√(Sin²)=|Sin|` verification-false-wrongs
  #690/#205/#116 — unchanged), 0 not-evaluable, 0 inconclusive. No regressions:
  4.5 Secant 120 = 56, ch1 200 = 180/6, ch2 60 = 33/1/3, ch6 60 = 17/0/1 (both
  new levers are strict no-ops off their trig shape). Rubi unit suites green
  (+13 focused tests in `rubi-utils.test.ts`).
  - **Gap 1 — poly×cos stranded (the big win).** The sine-chapter by-parts
    reduction `∫(c+d·x)^m·sin → −(c+d·x)^m·cos/f + (d·m/f)∫(c+d·x)^(m-1)·cos`
    (4.1.10 #1) bottoms out in a `poly·cos` sub-integral whose closing rule
    lives in the UNBUNDLED Cosine chapter. `cosBaseToSin`/`unifyInertTrig` only
    reflected the base of a `(a+b·cos)^n` power (x-free coefficient), so
    `∫(c+d·x)^m·cos`, `∫cos/(c+d·x)^k` were never reflected and stranded — hence
    `∫x·cos(a+b·x)` returned null while `∫x·sin` reduced then stalled. New
    `standaloneCosineShift` (rubi-utils) is Rubi's `DeactivateTrig` standalone-
    cosine identity `cos[e+f·x] → sin[e+π/2+f·x]` as a full-tree LEAF rewrite,
    gated to fire only when cosine is the SOLE trig head (any partner sin/tan/
    cot/sec/csc ⇒ mixed cross-pair, left to the two-factor clauses). Runs in
    `intRec` after `unifyInertTrig`. Closes the whole poly×cos class incl. the
    `∫cos/(c+d·x)^k` Si/Ci case (#156), and — bonus — three R3′ `(e·cos)^(7/2)/
    (a+b·sin)ⁿ` / `√(g·cos)·sin³/(a+b·sin)` cases (#604/#609/#1395) that route
    cos→sin. 4.1.10 (120) 1→3 correct, 4.1.11 0→1.
  - **Gap 2 — nonlinear-argument sin/cos.** `∫xᵐ·sin(a+b·xⁿ)` (4.1.11/4.1.12):
    Rubi routes via TrigToExp (4.1.12 #5/#15/#29) to `∫xᵐ·E^(k·xⁿ)`, closed by
    the Chapter-2 incomplete-Γ kernel — exactly like ch6's `Sinh[a+b·xⁿ]`. CE's
    structural matcher does not bind those Subst / `(e+f·x)ⁿ`-linear-inner /
    `Simplify[(m+1)/n]` rules, so a driver fallback (`expandTrigToExp` +
    `sinCosArgNonlinearExpandableQ`) mirrors the existing hyperbolic→exp
    fallback: rewrite inert sin/cos → E^(±i·w), expand, re-integrate. Gated to a
    nonlinear MONOMIAL argument (`c+d·xᵏ`, k≠1). Closes the `x^m·(c·sin³)^(1/3)`
    cube-root form (#328/#329) and the `xᵐ·(a+b·sin(c+d·xⁿ))ᵖ` family. 4.1.12
    (120) 1→3 correct.
  - **not-evaluable held at 0 by a fallback self-check.** The exp route also
    produces a symbolically-correct antiderivative for `∫x·sin(a+b/x)` (complex-
    argument `ExpIntegralEi`) and `∫sin(a+b·xⁿ)/x^(2n+1)` (negative-order
    incomplete Γ) that CE **cannot evaluate numerically** → the verifier grades
    it not-evaluable. Rather than gate structurally (the discriminator is not
    structural — `(a+b·sin(x³))²/x⁵` #76 has a negative x-power yet verifies,
    `x⁴·cos·sin²` #32 has a concrete positive exponent yet does not), the
    fallback runs `numericallyEvaluable(F, x)` (one random sample) and DECLINES
    the result if it is not finite — leaving the problem cleanly unsolved. This
    recovered 5 verifiable concrete/negative-power cases (#54/#62/#70/#76/#99 at
    400) while keeping #32/#104/#150 out of not-evaluable.
  - **Unintegrable census (correctly inert, not gaps).** 120: 4.1.10 #167/#290,
    4.1.12 #285/#307 (Rubi returns `Unintegrable`). 400: 4.1.10 = 3, 4.1.12 = 4
    Rubi-Unintegrable of the section unsolved.
  - **What remains (maps to existing / new rungs).** 4.1.11 residual (all 6
    genuine gaps: `∫sin(c+d·x)/(a+b·xⁿ)` rational-denominator × sin) and much of
    4.1.10 (#30/#112/#197/#248/#294, `(c+d·x)^m·mixed-trig/(a+b·sin)` Si/Ci
    chains, up to 48 Rubi steps) need SinIntegral/CosIntegral ROUTING (the Si/Ci
    KERNELS work — #156 verified — but the `∫sin/(a+b·x)` rules #23/#25–28 use
    Subst the matcher declines): a new **Si/Ci-routing** rung. 4.1.12 #156/#172/
    #187 need the `(e+f·x)ⁿ`/`√(c+d·x)` linear-inner Fresnel routing. #53 (23
    steps, deep half-integer Fresnel) / #248 / #294 are R3′-class. #93 is a
    csc^(−1/2)=sin^(1/2) cancellation (R5/`TrigSimplify`). **Kernel gaps found
    (reported, NOT hacked): complex-argument `ExpIntegralEi` and negative-order
    incomplete Γ do not evaluate numerically** — the blocker for the exp-route
    #104/#150 (and why they stay unsolved not not-evaluable). **Not pursued
    (broad blast radius, gated OFF):** teaching the shared `ExpandTrigReduce`
    helper to reduce circular `Sin^n` (not just hyperbolic) closes `∫(c+d·x)^m·
    sin^n` #17/#53/#87 but in a heavy exp/Erf form that verifies past the 8 s
    budget (inconclusive, not correct) and preempts trig-form rules chapter-
    wide — deferred to a proper trig `TrigReduce` (multiple-angle, elementary
    form) or a larger verification budget.
- **Phase R14 — nonlinear-composite argument routing (Fresnel / Si-Ci) LANDED
  (2026-07-04).** The diagnosed "the matcher declines the `Subst` forms" gap
  turned out to be a **deactivation-timing** bug, not a matcher bug:
  `deactivateTrig` inerted the WHOLE integrand's trig up-front, but a set of
  4.1.11/4.1.12/4.1.13 rules are authored on the **active** `Sin`/`Cos` head —
  Mathematica leaves trig un-inerted until its argument is LINEAR, and Rubi's
  `DeactivateTrigAux` reflects that (`LinearQ[u[[1]],x]` guard). So the
  substitution rules (4.1.12 #11-14/#81-86: `Subst` a linear inner
  `(e+f·x)ⁿ`; #29-40: the bare-monomial exp rewrite) and the completing-the-
  square rules (4.1.13, quadratic `Sin[a+b·x+c·x²]`) never saw an integrand
  whose composite-argument trig CE had already flattened to inert `sin`. Fix
  (`rubi-utils.ts` `deactivateTrig` + one driver call site, `driver.ts`), no
  corpus/bundle change:
  - **`deactivateTrig(ce, e, x)` is now argument-aware** — it deactivates a trig
    head only when its argument is x-free, LINEAR, or a **bare monomial**
    `c+d·xᵏ` (incl. the reciprocal `a+b/x`, k<0), and leaves a **composite**
    argument ACTIVE: a deg-2 quadratic (`b·(c+d·x)²` → 4.1.13 → real
    FresnelS/FresnelC) or a positive-fractional power of a linear inner
    (`√(c+d·x)` → elementary sin/cos·poly). deg-≥3 integer composites
    (`(c+d·x)³`) are DEACTIVATED on purpose (see below). Passing no `x` keeps the
    legacy full deactivation, which the trig→exp fallback uses to normalize a
    still-active residual before rewriting.
  - **Why the monomial/deg-≥3 carve-out (soundness).** Left fully to the
    active-Sin rules, the bare-monomial `∫(e·x)ᵐ·sin(c+d·xⁿ)` fires Rubi's raw
    exp-rewrite (#37-40), which emits an `(±i·d·xⁿ)^((m+1)/n)` incomplete-Γ form
    whose fractional-power branch reads WRONG at negative x (float coefficients
    too) — it regressed #62 (correct→wrong) and pushed #172/#150 unsolved→wrong.
    The driver's own R9 trig→exp fallback (`expandTrigToExp` + a cleanup
    `simplify`) produces the SAME antiderivative in a **branch-consistent** form
    that verifies, so bare monomials are routed there (deactivated → rules
    decline → fallback), and the deg-≥3 integer composite — whose substitution
    reduces to the same fragile complex Γ (#172) — is left cleanly **unsolved**
    ("unsolved beats a branch-fragile wrong"). The fallback's inert-`sin` gate
    is fed a full deactivation of the (now possibly still-active) integrand.
  - **Numbers (seed 5, `--rubi`).** 4.1 Sine 120: **106 → 107** correct (+1), 0
    genuine wrong / 0 not-evaluable; 400: **314 → 317** correct (+3), **3 wrong
    (the documented #690/#205/#116 false-wrongs — unchanged), 0 new wrongs**, 0
    not-evaluable. No regressions: 4.5 Secant 120 = 56 (3 documented R11
    false-wrongs), ch1 200 = 180/6, ch2 60 = 33/1/3, ch6 60 = 17/0/1 — the shift
    is a strict no-op off its nonlinear-composite-trig shape (algebraic/hyperbolic
    integrands never enter, and linear/monomial-arg trig deactivates exactly as
    before). Rubi unit suites green (+9 focused tests in `rubi-utils.test.ts`:
    the linear-only deactivation predicate + two end-to-end Si/Ci integrals).
  - **Closed:** 4.1.12 **#156** (`∫sin(b·(c+d·x)²)` → FresnelS) and **#187**
    (`∫(e+f·x)²·sin(a+b·√(c+d·x))` → elementary); the 4.1.13 quadratic-argument
    completing-the-square family becomes reachable; #328/#329 stay correct
    (R9-fallback form). **Gated to unsolved:** #172 (`(c+d·x)³` cubic composite →
    branch-fragile complex Γ; correct at positive x, mis-verifies at negative x —
    a verification-false-wrong of the documented cube-root class, held out of the
    wrong column).
  - **NOT addressed — the linear-arg-Sin × rational family (R15 candidate).** The
    "6 genuine 4.1.11 gaps" (`∫sin(c+d·x)/(a+b·xⁿ)`, e.g. #23/#18/#89 with real
    Si/Ci, #61/#71/#72 with complex Si/Ci) and the 4.1.10 Si/Ci chains
    (#30/#112/#197/#294, `(c+d·x)ᵐ·trig/(a+b·sin)`) turned out to be a DIFFERENT
    mechanism: those rules (4.1.11 #5/#11-22 `ExpandIntegrand`; 4.1.10 #25-28
    E^(i·x) rewrite) are authored on active `Sin` of a **LINEAR** argument
    multiplied by a rational — but CE MUST inert linear-arg sin (the working
    inert 4.1.10 #4 `sin/(c+d·x)`→Si rule and the bulk of chapter 4 depend on
    it), so keeping them active would regress. Closing them needs a scoped,
    R9-style `rational(x)·sin[linear]` → partial-fraction → Si/Ci driver fallback
    (with a numeric self-check to decline the complex-Si cases as R9 does for
    complex-Ei) — deferred to keep R14's zero-regression / zero-new-wrong
    guarantee. Deactivation-timing (active vs inert Sin) is the through-line for
    both R14 and this residual. *(→ Closed by Phase R15 below.)*
- **Phase R15 — rational×sin/cos(linear) → Si/Ci partial-fraction fallback
  LANDED (2026-07-09, runtime only, bundle untouched).** Exactly the scoped
  driver fallback the R14 diagnosis called for. Premise verified first: the
  driver ALREADY closes the single-piece forms (`∫sin(c+d·x)/(a+b·x)` → shifted
  `SinIntegral`/`CosIntegral` via the inert Si/Ci rules; `∫xᵏ·sin(c+d·x)` via
  by-parts) — only COMPOSITE rationals returned null. So the fallback splits
  and recurses rather than emitting Si/Ci itself.
  - **Mechanism.** `rationalTrigSiCiFallback` (driver.ts; placed after the
    trig→exp fallback — which gates on NONLINEAR args, so no overlap — and
    before the function-of-exponential fallback; `RUBI_NO_SICI` A/B switch;
    whole body try/catch → null) + `expandRationalOverLinears` /
    `allXDenominatorsLinearQ` (rubi-utils.ts, reusing the `ExpandIntegrand`
    poly-over-linear / partial-fraction machinery). Each expanded
    `piece·sin` is routed back through `intRec`.
  - **Double gate, fail-closed.** (1) *Structural*: exactly one inert
    `sin`/`cos` factor at power 1 of a LINEAR argument; every other factor
    trig-free and rational in x; every x-dependent denominator factor LINEAR
    (declines irreducible quadratics — the complex-Si family); the expansion
    must actually SPLIT (≥2 pieces — every emitted piece is single-piece by
    construction, so the fallback cannot re-enter); every piece must close.
    (2) *Numeric*: `antiderivativeVerifies` central-difference D-check of the
    ACTIVATED antiderivative against the integrand at 5 sample points with
    deterministic parameter substitution — "unsolved beats a branch-fragile
    wrong".
  - **Numbers (seed 5, `--rubi`).** 4.1.11 file (all 113 problems): **46 → 71
    correct (+25)**, 0 new wrong, 0 not-evaluable. 4.1 Sine 400: **317 → 320**
    (the 3 wrongs are the documented #690/#205/#116 false-wrongs, unchanged);
    120: 106 both ways (the sample contains no target problem; the R14-era
    "107" predates commit `d6305386` — pre-existing drift, not an R15 shift).
    Strict no-op off-family (A/B via `RUBI_NO_SICI` byte-identical): 4.5
    Secant 120 = 56, ch1 200 = 183, ch2 60 = 33 (the R14 notes' "33/1/3" had
    already drifted to 33/3/6 before R15), ch6 60 = 19.
  - **Targets.** 4.1.11 #18 (`x⁴·sin/(a+b·x)`), #23 (`sin/(x(a+b·x))`), #89
    (`(a+b·x³)²·sin/x`) all solve in the corpus-matching shifted Si/Ci forms.
    #61/#71/#72 (irreducible-quadratic denominators → complex Si/Ci) are
    declined by the linear-only gate in ~50 ms — cleanly unsolved, not wrong,
    not not-evaluable. The 4.1.10 four (#30/#112/#197/#294) are unchanged and
    are confirmed to be a genuinely DIFFERENT mechanism — `(a+b·sin)`
    **denominators**, not rational-in-x, so the trig-free-rational gate
    declines them; they need their own rung.
  - **Tests.** +10 in `rubi-utils.test.ts`: 7 expansion-gate unit tests and 3
    end-to-end through the shipped `loadIntegrationRules` path (D-checked with
    concrete integer parameters, plus a #61-shape decline test). The two close
    tests fail under `RUBI_NO_SICI=1` — they exercise the rung, not a rule.
- **Phase R3+ — chapters by value**: 2 (exponentials, 125 rules — small) and
  3 (logarithms, 337) first; 5/6/7 (inverse trig/hyperbolic) next; Chapter 4
  (trig, 2,126 rules + the inert-trig utility machinery) — the
  argument-unification layer above is its own project, the head-swap bridge
  already landed; Chapter 8 last (needs many special-function heads/kernels).

## 6. Roadmap Coupling (what to prioritize and why)

> Status (2026-06-13): items 2, 4, 10, 14, 15, and 16 are all **done** (see
> ROADMAP.md). The prioritization rationale below is kept as the original
> planning context.

- **ROADMAP item 2 (interruptible evaluation) — do before R2 mass
  validation.** The driver itself gets deadline checks from day one, but the
  *harness* runs 25K problems against an engine whose evaluation is otherwise
  non-interruptible; without item 2 the benchmark needs the Fungrim-era
  watchdog hacks (the baseline harness already ships a `RUBI_SKIP` denylist
  and incremental `.partial` reports for exactly this reason).
- **ROADMAP item 4 (₂F₁ + elliptic kernels) — do during/alongside R2.**
  Converts the ~100 special-head Chapter-1 rules from `not-evaluable` to
  verifiable, and is independently valuable (567 Fungrim entries wait on the
  same kernels).
- **ROADMAP item 5 (per-head aggregated dispatch) — not blocking.** Rubi
  lives in its own driver with its own index; item 5 remains a
  simplify()-side concern.

## 7. Risks & Open Questions

1. **Matcher fit (highest risk, addressed first in R1)**: if CE's AC matching
   + expanded optional-variants can't express/perform Rubi's pattern shapes,
   the fallback is compiling patterns into discrimination code (the Rubi-5
   idea, but generated mechanically per-bucket) rather than data patterns.
   The abandoned Rubi-5 repo (MIT) has manually-compiled if-then-else
   fragments usable as a cross-check.
2. **Termination**: `SimplerQ`-family predicates encode Rubi's well-founded
   order; subtle porting bugs → rewrite loops. Mitigations: depth/step caps
   in the driver (never trust the order), per-rule fire-self-tests in the
   artifact compiler (the Fungrim pattern), differential testing against the
   test suite per section.
3. **`Simp`/`ExpandIntegrand` fidelity**: rules assume Rubi's normal forms;
   CE's canonicalization differs (e.g. `Power(x, 1/3)` → `Root`). The
   structural-mode boxing (`{ structural: true }`) and the Fungrim
   compile-to-canonical-form lesson (store patterns in CE-canonical form)
   both apply.
4. **Performance**: 2,648 rules even bucketed may make `Int` slow per call.
   Budget: artifact-compile-time bucketing + lazy loading per chapter;
   acceptance benchmarks in the harness from R1 on.
5. **Translation source**: parse our own `.m` files (current plan, parser
   exists) vs. consume Symja's FullForm dump (less ambiguity, but a
   second-hand artifact pinned to 4.16.0). Decide in R1 when the first
   pattern-precedence ambiguity shows up — or doesn't.
6. **Where results live**: `Integrate`'s `evaluate` should consult the Rubi
   driver when loaded (a registration hook, like `solveRules`), falling back
   to `antiderivative.ts`. The exact hook shape is an R1 deliverable.

## 8. Bottom Line

Chapter 1 is a self-contained, MIT-licensed, frozen corpus of 2,648 rules
with a 71-function utility cut, a 25,876-problem self-checking test suite,
and two successful prior ports to crib from. It is the single highest-value
capability jump available to CE after Fungrim — and unlike Fungrim it
directly upgrades a user-facing verb (`Integrate`). The phased plan keeps an
abort option after the R1 spike at ~2 weeks of sunk cost.
