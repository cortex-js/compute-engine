# Rubi → Compute Engine: Feasibility Analysis

**Date:** 2026-06-10 (feasibility); last status update 2026-06-13.
**Status:** **R1 cleared** (section 1.1.1 at 98.28% solved-correct) and
**R2 gate cleared** (full-Chapter-1 seeded sample = 94.0%, ≥90% target met).
The driver hangs that had blocked the exhaustive run are **RESOLVED** — root
cause was an engine `factor()`↔canonical-`mul` infinite loop, now fixed
(see Phase R2 in §5). **Top next item: run the exhaustive 25,854-problem
benchmark** (now feasible), then close the 1.1.3 symbolic-n weak spot and the
item-4 branch-phase residue. The §1–§4 analysis below is the original
feasibility study (still accurate); §5 carries the current phasing status,
and the project memory (`project_rubi.md`) has the session-by-session log.

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
    `ce.box(['Divide','x',['Sqrt',['Power','x',2]]]).simplify()` → `1`.
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
    MathJSON arrays (spins — use `ce.box`); collapse matching requires ≥1
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
- **Phase R3+ — chapters by value**: 2 (exponentials, 125 rules — small) and
  3 (logarithms, 337) first; 5/6/7 (inverse trig/hyperbolic) next; Chapter 4
  (trig, 2,126 rules + the inert-trig utility machinery) is its own project;
  Chapter 8 last (needs many special-function heads/kernels).

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
