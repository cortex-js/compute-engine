# Rubi → Compute Engine: Feasibility Analysis

**Date:** 2026-06-10 (feasibility); last status update 2026-07-10.
**Status:** shipped bundle = **Chapters 1, 2, 3, 5, 6, 7 + 4.1 Sine + 4.3 Tangent +
4.5 Secant + §8.8 Polylogarithm** (6,574 rules, 6.98 MB). Chapter-1 exhaustive
≈90–91%; ch2 ≈72% / ch6 ≈45% effective; **4.1 Sine 107/120 and 331/400 (seed 5;
4.1.11 file 93/113, post-R18); 4.3 Tangent 72/120; 4.5 Secant 69/120; ch3 Logarithms
71/120 (R20, +2 from ch5 family-C producers); Chapter 5 Inverse trig (R24, s120 seed5):
5.1 sine 57/120, 5.2 cosine 67, 5.3 tangent 59 (R24 +15 vs R23's 55/55/58 — a
complex-argument Erfi kernel flips fractional-`n` Erfi antiderivatives
not-evaluable→correct), 5.4 cotangent 60, 5.5 secant 56, 5.6 cosecant 52 (R23,
not re-run at R24) (≥351/720 = ≥48.8%); Chapter 7 Inverse hyperbolic (R22, s120 seed5):
7.1 sine 79/120, 7.2 cosine 51, 7.3 tangent 85, 7.4 cotangent 95, 7.5 secant 44,
7.6 cosecant 54 (408/720 = 56.7%, R22 +2 — ch7's arsinh sub-integrals already
routed via the ungated hyperbolic fallback; unchanged at R23, which touches only the
circular ExpandTrigReduce branch); genuine wrongs 0 across ALL suites incl. ch3/ch5/ch7** (all flagged
"wrongs" are documented verification false-wrong classes — see the
ROADMAP §R state note). The nested `Log[c·(b·x^n)^p]` power-in-log family
(§3.1.5 / §3.3) that R17 first shipped with ~3 genuine wrongs was **fixed**
in the R17 back-substitution follow-up (Rubi general `Subst[u,expr,repl]`;
see the R17 entry).
The 2026-07-04 rung series (R1/R2/R4, R10, R11, R9, R14 — §5 below) added the
cofunction product clauses, the ch1-foundation benchmark fix,
`reciprocalToPower`, the `cofunctionShift` and `standaloneCosineShift` runtime
routing, the trig→exp fallback, and argument-aware `deactivateTrig`; the
2026-07-09 rungs added R15 (rational×sin(linear) → Si/Ci partial-fraction
fallback), R12 (4.3 Tangent bundled, cot→tan shift default-ON behind
`RUBI_NO_COFN_COT`), R13 (sec-binomial routing: reflected `csc[·+π/2]`
kept raw through `reciprocalToPower`, behind `RUBI_NO_SECBIN`), and R16
(poly×csc²/sec² by-parts fallback behind `RUBI_NO_TRIGSQ`; its triage mapped
the PolyLog-bundling residual → R17). The 2026-07-10 rung added R17 (Ch3
Logarithms + §8.8 Polylogarithm bundled — the PolyLog telescope — plus a
single-angle trig→exp partial-fraction fallback behind `RUBI_NO_TRIGEXP`), then
R18 (complex special-function closures on the 2026-07-09 kernels: irreducible-
quadratic denominators split over complex-conjugate linear roots in the Si/Ci
fallback behind `RUBI_NO_SICI_COMPLEX`, and the reciprocal-argument
`∫xᵐ·sin(a+b/x)` exp route un-gated), then R19 (the `FunctionOfLog` recognizer
implemented, closing the 3.5 `∫F(Log[a·xⁿ])/x` family; ch3 census established
that the rest of the tail is bundling-inert — full-corpus closes nothing new).
R25 (2026-07-10) closed the symbolic-coefficient quartic-denominator rational
family — `∫(d+e·x²)/(a+b·x⁴)` and everything reducing to it — by failing the
ExpandIntegrand distribution on the `(d+e·x^(n/2))/(a+b·x^n)` ping-pong shape so
the driver reaches the 1.2.2.3 trinomial terminal rules (behind `RUBI_NO_R25`):
1.1.3 General **173→180/200**, ch1 1.1 **109/5w→111/4w** (fixes one genuine
wrong), 5.3 tangent **60→61**, 5.4 cotangent **60→62** (the R20-noted
arctan/arccot(a·x²) chains), genuine wrongs still 0.
**Next rungs live in ROADMAP §R** (R3′ deep chains, R5; then the Ch6 tail
R6–R8). The §1–§4 analysis below is
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
    "Cotangent to tangent" product clauses. *(→ Superseded by Phase R12,
    2026-07-09: default-ON, toggle now `RUBI_NO_COFN_COT`.)*
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
    awaits a sec-specific (not global) fix. *(→ Landed as Phase R13,
    2026-07-09.)* `cot` wins appear only in `--rubi`
    corpus runs with `RUBI_COFN_COT` once 4.3 Tangent is bundled. *(→ Both
    landed in Phase R12.)*
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
- **Phase R12 — 4.3 Tangent bundled + cot→tan default-ON LANDED
  (2026-07-09).** The rung the R11 landing scoped out: (a) `4.3 Tangent`
  walked whole in `bundle-corpus.ts` (13 files, 0 skips — matching the
  4.1/4.5 precedent): bundle **4,531 → 4,831 rules, 4.94 → 5.29 MB**, compile
  ~967 ms. (b) The R11 `cot → −tan[θ+π/2]` leaf reflection flipped to
  **default-ON**; the A/B toggle is now `RUBI_NO_COFN_COT` (disables only the
  cot half; `RUBI_NO_COFN` still disables the whole shift), mirroring the
  `RUBI_NO_*` convention.
  - **(c) resolved as a decline-gate, NO new product clauses.** The predicted
    mixed-pair regression did not require `unifyInertTrigFunction`-style
    matched-±π/2 clauses: R11's firing-scope guard is auto-derived from
    `COFUNCTION_SHIFT`, so adding `cot` recomputes `MIXED_TRIG_HEADS` to
    `{sin, cos}` and `cofunctionShift` **declines** any integrand with a
    co-present sin/cos — the 4.1.1.3 `(g·cot)^p(a+b·sin)^m` families fall
    through to `unifyInertTrig`'s existing matched-±π/2 `(g cot)^p (a+b cos)^m`
    clause, unshifted. Within-pair `csc·cot`/`cot·tan` desyncs are caught by
    the existing ≥2-distinct-args revert. Measured: 4.1 Sine does not regress
    with cot ON, so matched-shift clauses would have been dead complexity.
  - **Numbers (seed 5, `--rubi`).** 4.3 Tangent 120: **65 → 70 correct (+5)**,
    2 wrong both **pre-existing false-wrongs** (`4.3.0 #14` `1/(b·tan)^(3/2)`,
    `4.3.2.1 #346` `(a+a·tan)²/√(d·tan)` — the half-integer `√tan` /
    `(−b²)^(1/4)` branch class, pure-tan, present at the cot-off baseline;
    both D-verify: `F(x₂)−F(x₁)` matches quadrature to 6 digits). A/B
    `RUBI_NO_COFN_COT=1` reproduces the 65-correct baseline exactly. No
    regressions: 4.1 Sine 120 = 106, 400 = **321** (+1)/3 documented
    false-wrongs; 4.5 Secant = 56; ch1 200 = 183, ch2 60 = 33, ch6 60 = 19
    (strict no-ops).
  - **Tests.** +6 D-verified tangent loader tests in
    `integration-rules.test.ts` against the real shipped bundle — including
    `∫(2+3·cot x)²`, which is inert under `RUBI_NO_COFN_COT` and closes only
    via the cot→tan routing onto the 4.3 binomial rules (a genuine
    shipped-path regression test; bare `∫cot²`/`∫cot³` solve regardless and
    don't discriminate).
  - **Residual (untriaged 4.3 tail, 46 unsolved at 120):** includes the
    half-integer `√(cot)` family, which goes inert→"wrong" (same branch-cut
    false-wrong class) rather than correct when shifted — excluded from the
    loader tests deliberately. Triage before picking a 4.3-tail rung.
- **Phase R13 — sec-specific binomial routing LANDED (2026-07-09).** The
  carve-out the R11 landing scoped out: integer-power symbolic sec binomials
  (`∫1/(a+b·sec)`, `∫(a+b·sec)^n`, `∫sec^k/(a+a·sec)`, …) were inert because
  `reciprocalToPower` rewrote the reflected `csc[θ+π/2]` inside the Add
  summand to `1/sin` before the 4.5.1 csc-binomial rules could match.
  - **Mechanism: shift-signature detection** (`rubi-utils.ts` only, no driver
    change; `RUBI_NO_SECBIN` A/B). A `csc` produced by the R11 reflection
    carries a literal `+π/2` term in its argument — a structural provenance
    signature natural csc never has (`isReflectedReciprocal`). Reflected csc
    is kept RAW across the whole integrand (reduction-chain subproblems with
    bare `csc^k` factors need raw too), while natural csc/sec still convert —
    which is what avoids R11's measured −20 global-exemption regression on the
    4.1 Sine csc-binomial families. Inherently sec-specific: cot→tan reflects
    to `tan`, not a reciprocal head, so it never reaches this code.
  - **The exception that took iteration:** the 4.5.7 `(a+b·sec²)^p` family
    ROUTES THROUGH the sin/cos-power rules via `sec²→cos⁻²`, so raw-keeping
    switches OFF when the integrand carries a **Power whose base is a pure
    `a+b·sec²` binomial** (reflected csc at power ≥2 with no power-1 term:
    `hasReflectedNonLinearBinomial`). Keying on the Power-base — not any
    quadratic Add — is what separates `(a+b·sec²)³` (#206, wants conversion)
    from `A+C·sec²` factors at power 1 and `A+B·sec+C·sec²` trinomials
    (want raw). Measured dead ends: Add-only raw-keeping broke `(2+3·sec)²`'s
    reduction chain; keep-all-raw regressed #206; any-quadratic-Add gating
    dropped 4.5 to 60 via #675-class misfires.
  - **Numbers (seed 5, `--rubi`).** 4.5 Secant 120: **56 → 69 correct (+13)**
    (+1 formal), genuine wrongs 0 — the 3 flags are the unchanged documented
    R11 false-wrongs (`4.5.1.2 #333` re-verified: differentiates back exactly
    at integer exponents; `4.5.3.1 #27/#30` symbolic-exponent/cube-root
    class). Flipped: 4.5.0 #50; 4.5.1.2 #44/#46 (+#156 formal); 4.5.2.3
    #48/#55; 4.5.4.1 #2/#56; 4.5.4.2 #84/#675/#701/#768/#803/#888. ZERO
    movement on 4.1 Sine (106/120, 321/400), 4.3 Tangent (70), ch1 (183),
    ch2 (33), ch6 (19); `RUBI_NO_SECBIN=1` reproduces the 56-correct baseline
    exactly.
  - **Tests.** Unit tests on `reciprocalToPower` (reflected kept raw, natural
    converts, `(a+b·sec²)^p` still converts) + 8 shipped-path D-verified
    secant-binomial integrals across the two test files; 8 of them fail under
    `RUBI_NO_SECBIN=1` (meaningfulness check).
  - **Residual 4.5 tail (45 unsolved at 120):** `(d·tan)^n(a+b·sec)^m` mixed
    cross-pair families (4.5.1.4), half-integer/elliptic `√(a+b·sec)` chains,
    `(g·sec)^p` triple products — different mechanisms, outside R13's scope.
- **Phase R16 — poly×csc²/sec² by-parts + the PolyLog-residual map LANDED
  (2026-07-09).** Target was the 4.1.10 `(c+d·x)^m·trig/(a+b·sin)` four
  (#30/#112/#197/#294). Outcome: **#30 closed** (the only elementary member);
  #112/#197/#294 triaged to a precisely-mapped bundling dependency (→ R17).
  - **#30 triage finding.** The 2-step chain `∫(c+dx)·csc²` was blocked by ONE
    missing capability: CE's by-parts reduction exists for positive sin/cos
    powers but not reciprocal-square trig (`∫xᵐ·csc²`, `∫xᵐ·cot`, `∫xᵐ·csc`
    all failed while `∫xᵐ·sin` worked), even though the base cases `∫csc²`
    and `∫cot` close.
  - **Mechanism.** `polyTrigSquaredByParts` driver fallback (before the R15
    Si/Ci fallback; `RUBI_NO_TRIGSQ` A/B): for exactly one csc²/sin⁻²/sec²/
    cos⁻² factor of a LINEAR argument times a trig-free polynomial,
    `∫P·csc² = −P·cot/f + (1/f)·∫P′·cot`, recursing through `intRec`; linear P
    bottoms out in the bundled `∫cot`→`ln(sin)`; higher-degree P (residual
    `∫xᵏ·cot` → dilog) returns null → cleanly unsolved. Guarded by a cheap
    O(nodes) syntactic pre-filter (`hasReciprocalSquareTrigCandidate`) and the
    R15 central-difference D-self-check.
  - **PERF DEAD END (the lesson of the rung):** the first version without the
    pre-filter regressed 3 non-target slow-verifiers (#1395/#706/#1466)
    correct→inconclusive — the per-subproblem `deactivateTrig`+`toTimesPower`
    overhead tipped them past their verify deadline. Cheap syntactic
    pre-filters are MANDATORY for per-intRec fallback gates.
  - **Numbers (seed 5, `--rubi`).** 4.1 Sine 400: **321 → 322** (+1 = #30, the
    SOLE outcome diff across every suite; A/B byte-identical elsewhere); s120,
    4.3 (70), 4.5 (69), ch1/ch2/ch6 all unchanged; 3 documented s400
    false-wrongs unchanged; genuine wrongs 0. Win boundary (probed):
    linear-poly×csc²/sin⁻² closes; `(c+dx)²·csc²`/`x²·sec²` correctly decline.
  - **The residual map (corrects the R16-planning premise).** #112/#197/#294
    results carry `Log[complex]`+`PolyLog[2..4]` — and the rules that PRODUCE
    PolyLog are NOT in the bundle (the planning note "the Ch2 PolyLog rules
    are bundled" was wrong: PolyLog production lives in the unbundled Ch3
    Logarithm sections; confirmed `∫x³·Eˣ/(a+b·Eˣ)` does not close). The
    numeric PolyLog kernel (landed separately the same day) makes these forms
    VERIFIABLE — what's missing is symbolic production. Shopping list → R17:
    Ch2 2.2 `∫x^m·F^{gx}/(a+b·F^{gx})^p` reductions (rule 5030 is the 4.1.10
    entry point) + Ch3 sections 3.1.5 / 3.2.3 / 3.3 / 3.4 / 3.5 (the
    `∫x^k·Log[a+b·F^{gx}]` → PolyLog telescope), then a trig→exp
    single-exponential normalization fallback.
  - **Tests.** +11 in `rubi-utils.test.ts` (8 structural-gate unit + 3
    end-to-end D-verified); the two csc² close tests fail under
    `RUBI_NO_TRIGSQ=1`.
- **Phase R17 — Ch3 Logarithms + §8.8 Polylogarithm bundled (the PolyLog
  telescope) + single-angle trig→exp fallback LANDED (2026-07-10).** Closes the
  R16 residual #112/#197/#294 (the `(c+d·x)^m·trig/(a+b·sin)` chains whose
  results carry `Log[complex]` + `PolyLog[2..4]`).
  - **Mechanism (a): bundling.** `3 Logarithms` walked whole (334 rules, 0
    skips) + the single-file `8.8 Polylogarithm function` (26 rules) added to
    `bundle-corpus.ts`; the rest of Ch8 is translated to corpus but
    deliberately NOT bundled. This terminates the PolyLog telescope: Ch2 §2.2
    (`∫x^m·F^{gx}/(a+b·F^{gx})^p`) → Ch3 (`∫x^k·Log[a+b·F^{gx}]`) → §8.8
    (`∫x^k·PolyLog[n,·]` → `PolyLog[n+1]`). Bundle **4,831 → 5,191 rules
    (+360), 5.29 → 5.64 MB**, compile ~640 ms. Nine new utilities in
    `rubi-utils.ts`: `IntHide` (by-parts driver-recursion binding, fails
    closed on non-closing sub-integrals), `MemberQ`, `ProductQ`,
    `IntegralFreeQ`, `Cancel`/`FullSimplify` (bounded `safeSimplify`), `Part`,
    `RationalFunctionExponents`, plus fail-closed stubs `FunctionOfLog`,
    `SubstForFractionalPowerOfLinear`. `∫x³·eˣ/(a+b·eˣ)` and `∫x·log(1+eˣ)`
    now close and D-verify. The benchmark foundation preload now mirrors the
    ship: ch1, ch2, **ch3**, ch6, **§8.8 file** (single-file foundation
    entries supported).
  - **Mechanism (b): `singleAngleTrigExpFallback`** (driver.ts, after R15's
    `rationalTrigSiCiFallback`; env toggle **`RUBI_NO_TRIGEXP`**). For
    `∫P(x)·R(trig(w))` with `w` linear and an additive `(a+b·trig)`
    denominator: rewrites via `y=E^{iw}`, partial-fractions in `y` over linear
    factors, routes the pieces through the §2.2→Ch3→§8.8 telescope, with a
    fail-closed central-difference D-check. Helpers in `rubi-utils.ts`
    (`hasSingleAngleTrigRationalCandidate` O(nodes) pre-filter,
    `singleAngleTrigRationalQ`, `singleAngleExponentialPieces`).
  - **Outcome flips.** 4.1.10 **#112** closes from bundling alone; **#197** and
    **#294** close via the new fallback (both D-verified, symbolic params). #30
    (R16) unchanged.
  - **Numbers (seed 5, `--rubi`; foundation = ch1/2/3/6/§8.8).** 4.1 Sine 400:
    **322 → 326 (+4)**; s120 106 (unchanged; sample holds no target — A/B
    `RUBI_NO_TRIGEXP=1` byte-identical, 0 outcome diffs / 112 keys). 4.3
    Tangent 120: **70 → 72 (+2)**, 2 wrong = the documented #14/#346 √tan
    half-integer false-wrongs (unchanged). 4.5 Secant 120: **69** (unchanged),
    3 documented R11 false-wrongs (#333/#27/#30). ch2 60: **33 → 36 (+3)** from
    §8.8 (matches the s120 77→82 seed-5 measurement earlier this session); 1
    false-wrong (#394 `∫E^(e(c+dx)³)` → `Gamma[1/3,·]` cube-root-of-negative
    branch). **Genuine wrongs remain 0 on every pre-existing suite.**
  - **s400 new false-wrong (#150, 4.1.12).** `∫Sin[a+b·x^n]/x^(2n+1)` newly
    CLOSES via the exp-route telescope; the verifier flags it only at NEGATIVE
    x (x=−0.23/−0.41) where `x^n` with fractional n≈0.674 is on a branch cut —
    at POSITIVE x, D(F) matches the integrand to ~9 digits (probed). A new
    member of the documented fractional-power-of-negative-x false-wrong class,
    so s400 wrongs = 3 documented (#690/#205/#116) + #150; genuine wrongs 0.
  - **Off-target timing dips (both zero genuine wrongs).** ch1 200:
    **183 → 180 (−3)**, all into `unsolved`; the R17 fallback is provably inert
    here — `RUBI_NO_TRIGEXP=1` is byte-identical (180/6/12). All 6 wrongs are
    the documented ₂F₁/AppellF1-symbolic-exponent + fractional-power/cube-root
    branch false-wrongs (signature-verified). The −3 is a correct↔unsolved
    boundary shift at the 15 s solve/verify deadline (one hard timeout #371, a
    6-step quartic `∫(7+5x²)⁵/(4+3x²+x⁴)^(3/2)` that does NOT close even at 60 s
    in either the lean ch1-only or the full rule set — so it was almost
    certainly unsolved at the 183 baseline too, on the smaller {2,6}
    foundation). ch6 60: **19 → 18 (−1)**, one problem correct→inconclusive
    (#158 `∫√Coth[a+b·Log[c·x^n]]/x`, passes=3/fails=1, worst 7.13e-3 — a
    √Coth branch numeric-tolerance boundary, not a wrong answer).
  - **ch3 Logarithms — NEW suite classification (s120 seed5), AFTER the
    back-substitution fix below: 67 correct / 4 wrong / 47 unsolved /
    1 not-evaluable / 1 inconclusive** (was 65/6 at first bundling). All 4
    remaining wrongs are verification FALSE-wrongs (probed by D-check at
    positive x + `F_CE − F_Rubi` structural compare):
    - #394/#442 (3.1.4 `(f x)^m(d+e x^r)^q(a+b Log[c x^n])`, fractional
      `x^r`/`(f x)^m` sampled at negative x) and #44 (3.2.2
      `Log[e(a+b x)/(c+d x)]` Möbius-log at negative x): D-verify to rel ~1e-10
      at positive x on the principal branch.
    - #538 (3.3 `∫(i+j x)²·Log[c(d(e+f x)^p)^q]³/(g+h x)`): after the fix,
      `F_CE − F_Rubi` is a **constant** (≈123.7) at complex points off the
      PolyLog branch cut and `d(F_CE)=f` there to ~1e-9 — a correct
      antiderivative. It flags only because the real-axis D-check samples land
      on the PolyLog[3]/PolyLog[4] branch cut (arg `z>1`), where CE's
      `Log[A/B]→Log A−Log B` split distributes the branch differently than
      Rubi's compact `Log[ratio]` form (a core-Ln quirk, not a Rubi bug).
  - **Fixed: the nested power-in-log genuine-wrong family (R17 follow-up,
    2026-07-10).** #236 (3.1.5 `∫Log[c(b x^n)^p]²/x⁴`) and #449/#538 (3.3
    `Log[c(d(e+f x)^p)^q]`) were malformed because rule **3.3 #60** (and the 5
    other compound-`Subst` rules — 1.1.3.1 #44/#45, 1.1.3.2 #103/#104, 3.2.2
    #15) use Rubi's *general* form `Subst[u, expr, repl] := u /. expr -> repl`
    — a subexpression replacement of the expanded log argument
    `c·dⁿ·(e+f x)^{mn}` — but `build()`'s `Subst` handler ignored its middle
    argument and substituted the integration variable `x`. That rewrote `x`
    itself (e.g. `1/x³ → (b x^n)^{-3p}/c³`, log arg gaining spurious powers).
    Fix: dispatch on the middle argument — substitute `x` only when it *is* the
    variable, else structurally replace `expr → repl` (`replaceSubexpr` in
    `rubi-utils.ts`). #236/#449 now D-verify clean; #538 is a correct
    antiderivative (see above). Regression test in `integration-rules.test.ts`.
  - **Tests.** loader/utility tests in `rubi-utils.test.ts` and
    `integration-rules.test.ts`.
- **Phase R18 — complex special-function closures on the 2026-07-09 kernels
  LANDED (2026-07-10).** The complex-argument `ExpIntegralEi`/`SinIntegral`/
  `CosIntegral` (commit 2980a5a8, Γ(0,z)-based, mpmath ~1e-15 all quadrants) and
  the (already-evaluable) negative-order incomplete Γ turned two families that
  R15/R9 had fail-closed on numeric-evaluability into closed, D-verified results.
  - **Mechanism (a): complex-linear extension of the Si/Ci fallback**
    (`expandRationalOverComplexLinears` in `rubi-utils.ts`, wired into
    `rationalTrigSiCiFallback`; env toggle **`RUBI_NO_SICI_COMPLEX`**). When the
    plain all-linear expansion (R15) declines because an x-dependent denominator
    factor is an irreducible/reducible QUADRATIC, factor it over its
    complex-conjugate linear roots `(x−r)(x−r̄)` (quadratic formula via
    `factorLinearsY`), then run the SAME ExpandIntegrand partial-fraction
    machinery. Each piece `c·(x−rₖ)^{−j}·sin` closes to a COMPLEX
    SinIntegral/CosIntegral; the conjugate pair recombines to a real
    antiderivative, so the existing central-difference D-check on the real axis
    accepts it. Gates preserved from R15 (exactly one power-1 linear-arg sin/cos,
    ≥2-piece re-entry guard, every piece closes, whole-body try/catch→null);
    cubic-and-higher x-denominators and repeated quadratic roots decline. A
    one-line guard fix in `expandPartialFractions` (an x-FREE `const^{−k}` — the
    `b^{−1}` leading-coefficient reciprocal the split emits — is a coefficient,
    not a denominator factor; route it to polyParts, mirroring
    `expandPolyOverLinear`) was required for the split to reach the machinery.
  - **Mechanism (b): un-gate the reciprocal-argument exp route.**
    `sinCosArgNonlinearExpandableQ` (the R9 `expandTrigToExp` gate) previously
    fail-closed-declined a concrete NEGATIVE monomial exponent (`sin(a+b/x)`,
    k<0) because the resulting complex `ExpIntegralEi` didn't evaluate. Removed
    that decline: k<0 is now admitted, rewrites to a complex-Ei form the kernels
    evaluate, and the driver's own `numericallyEvaluable` self-check (which now
    passes) is the safety net. No new toggle (a pure fail-closed-safe relaxation
    of an existing gate; the R9 route runs BEFORE R15/R16/R17 and returns null
    when its result is not evaluable, so it can never strand a later fallback).
  - **Outcome flips.** 4.1.11 **#61/#71/#72** (`∫sin/(a+bx²)`,
    `∫sin/(x²(a+bx²)²)`, `∫x³sin/(a+bx²)³`) close and D-verify via (a) — Rubi's
    own antiderivatives carry `√(−a)` complex Si/Ci, so ours legitimately do too.
    4.1.12 **#103–#110** (`∫xᵐ·sin(a+b/x)`, `∫sin(a+b/x)/xᵏ`) close via (b), all
    D=5/5 on the real axis; the broader `(a+b·Sin[c+d/x])` numerator family
    (#288–#291, #294–#296) also newly closes, all D-verified. R15's real-Si
    targets (#18/#23/#89) and R17's #112/#197/#294 unchanged; genuine wrongs 0.
  - **Numbers (seed 5, `--rubi`; foundation = ch1/2/3/6/§8.8).** 4.1.11 file
    all-113: **71 → 93 (+22)** (A/B `RUBI_NO_SICI_COMPLEX=1` byte-reproduces
    **71**, the pre-rung baseline — 4.1.11 has no reciprocal-arg (b) targets).
    4.1 Sine s120: **106 → 107 (+1)** entirely from (b) (main == `RUBI_NO_SICI_
    COMPLEX=1`, 0 outcome diffs — the s120 sample holds no complex-quadratic (a)
    target). 4.1 Sine s400: **326 → 331 (+5)** correct (60 unsolved, 4
    solved-formal, 1 inconclusive); the 4 solved-wrong are the IDENTICAL
    documented false-wrong set (#690 4.1.1.2, #205 4.1.1.3, #116 4.1.2.1, #150
    4.1.12) — all pre-existing, in files this rung does not touch (#150 is
    `Sin[a+b·x^n]/x^(2n+1)`, a POSITIVE-exponent x^n arg whose route the k<0
    relaxation does not change), so **zero new wrongs**. 4.1.11 file and s120
    carry zero solved-wrong.
  - **Dead ends / scope.** (a) only splits degree-≤2 x-denominators (cubic+ needs
    Cardano/general roots — declined). The `numericallyEvaluable` acceptance in
    (b) is a finiteness check, NOT a D-check; correctness there rests on the
    exact sin→exp rewrite plus sound sub-integration (validated by the end-to-end
    D-verified tests). No corpus/bundle changes — pure driver+util rung.
  - **Tests.** `expandRationalOverComplexLinears` unit tests (accepts
    irreducible quadratic, conjugate-root reconstruction, declines cubic/no-
    quadratic) + R18 end-to-end closures in `rubi-utils.test.ts`; complex-Si and
    reciprocal-arg end-to-end D-verified cases in `integration-rules.test.ts`;
    the R9-gate unit test flipped to assert `sin(a+b/x)` is now admitted.
- **Phase R19 — Chapter-3 (Logarithms) unsolved-tail census + `FunctionOfLog`
  LANDED (2026-07-10).** Triaged all 46 ch3 unsolved (s120 seed 5); implemented
  the one bounded lever the census revealed. ch3 s120 seed 5:
  **68 → 69 correct / 45 unsolved** (was 46), **4 wrong unchanged** (the same
  R17-documented verification false-wrongs #394/#442/#44/#538 — probed clean at
  positive x), 1 not-evaluable, 1 inconclusive. Regression guards clean: ch2
  s120 **82 correct / 2 wrong** (=baseline), 4.1 Sine s120 **107 / 0** (=baseline).
  - **Census method + headline finding.** Every unsolved re-run through BOTH the
    ship/benchmark foundation (ch1/2/3/6/§8.8) AND the FULL corpus (every
    chapter). **The full corpus closes NOTHING the foundation doesn't** — so
    there is NO single-file bundling lever in this tail (unlike R16→R17 §8.8).
    The residuals bottom out in sub-integrals that don't close even with all
    5,921 rules loaded: they need capability CE lacks in ship config, not more
    bundled rules.
  - **The lever: `FunctionOfLog[u,x]`** (`rubi-utils.ts`, faithful port of
    `IntegrationUtilityFunctions.m`; was a fail-closed stub). Detects
    `u = F(Log[a·xⁿ])` and returns the substitution triple `{F(x), a·xⁿ, n}`;
    every `Log` leaf must share the same argument (purely structural — no
    `Log[x²]=2Log[x]`), a bare integration variable or any calculus head fails
    closed. Drives the 3.5 catch-all `∫F(Log[a·xⁿ])/x → 1/n·Subst[∫F dx, x,
    Log[a·xⁿ]]`. **Bug found in verification:** the rule feeds
    `FunctionOfLog[Cancel[x·u], x]`, but CE's `Cancel`/`simplify` cannot cancel a
    common `x` monomial (`x/(x+x·Log²) ↛ 1/(1+Log²)`), so the recognizer saw a
    bare `x` and declined. Fix: `cancelCommonXPower` inside `functionOfLog`
    divides each additive numerator/denominator term by the common `x^k`
    (scoped to this entry point — no change to the general `Cancel`). Closes
    3.5 #261 (`∫(Log[3x]²−1)/(x(1+Log[3x]+Log[3x]²)) → arctan/log of Log[3x]`),
    D-verified. `SubstForFractionalPowerOfLinear` stays a fail-closed stub (its
    single 3.5 rule is a disproportionate port; census showed its candidate
    problems bottom out elsewhere anyway).
  - **Census table — all 46 classified (family / count / where the chain dies /
    verdict).** `C*`/`D`/`E`/`F`/`G` are all genuinely deep (bundling-inert):
    | Family | n | Chain dies at | Verdict |
    |---|---|---|---|
    | A — expected-`Unintegrable`/`CannotIntegrate` | 15 | Rubi itself returns unevaluated (or partial with embedded `Unintegrable`) | **CE's inert `Integrate` is the CORRECT match** — not a defect (#127/#249/#444/#144/#155/#216/#544/#145/#152/#583/#287 full; #13/#35/#121/#203 partial) |
    | B — `FunctionOfLog` `F(Log[a·xⁿ])/x` | 1 | recognizer was fail-closed stub | **FIXED this rung** (#261) |
    | C — poly×log by-parts → non-elementary sub-integral | 13 | residual `∫arctan(kx)/x`, `∫artanh(√)/x`, symbolic-order-`k` `PolyLog` recurrence, `ArcSinh·Log` (#150/#439/#226/#382/#10/#31/#43/#48/#111/#207/#209/#219/#190) | deep — needs Log/PolyLog production from inverse-trig/hyperbolic-log chapters (ch4/ch5, NOT bundled) or symbolic-`k` `PolyLog` |
    | D — `∫Log[·]/rational` → `PolyLog[2]` | 4 | direct Log/(cubic-or-Möbius) rule not firing → generic by-parts leaves a non-closing log/rational residual (#257/#85/#224/#292) | deep — missing `PolyLog[2]` production |
    | E — `(a+b·Log[c(d+ex)ⁿ])^p × rational` half-integer | 3 | reduction residual `∫(a+b·Log)^{p-1}/(f+gx)^k` doesn't close (#324/#457/#491) | deep |
    | F — fractional/negative power in the log argument | 4 | expected carries `Gamma[1+p,·]`/`ExpIntegralEi`/`LogIntegral` with fractional `x^(2/3)`/`e/√x` (#123/#476/#555/#586) | deep — kernel + fractional-power substitution |
    | G — `∫Log[Sin/Tan/Csc²]`, `Log[quadratic-surd]` | 6 | by-parts leaves `D[inert-trig]` unreduced (CE's `D` knows `Tan`, not the inert `tan` head) AND the sub-integral needs ch4 trig integration (only 4.1/4.3/4.5 bundled) (#167/#177/#190/#191/#305/#101) | deep — two-part gap (inert-trig `D` + ch4 dependency) |

    Bundling-inert total (C+D+E+F+G) = 30; expected-Unintegrable (A) = 15;
    fixed (B) = 1. **Residual after R19 = 45 unsolved: 15 correct-by-design +
    30 genuinely-deep.** Next-rung shopping list: the biggest single family is
    **C** (13) — a Log/PolyLog producer for `∫arctan(kx)/x` and `∫artanh(kx)/x`
    (the inverse-trig/hyperbolic-log Chapter-5 base cases) would unlock the
    by-parts tails — **R20 UPDATE: ch5 now bundled, and family-C members #31 and
    #226 flipped to solved (ch3 s120 seed5 69 → 71); the `∫arctan(kx)/x` residual
    closes to `PolyLog[2,±i·x]`. The rest of C still bottoms out in shapes ch5's
    bundled base cases don't reach** (`∫artanh(√)/x`, symbolic-order-`k` `PolyLog`
    recurrence, `ArcSinh·Log`); **G** (6) needs an inert-trig `D` reduction plus a Chapter-4
    trig-integration foundation.
  - **Tests.** `FunctionOfLog` unit test (triple extraction incl. the
    `cancelCommonXPower` path + three fail-closed cases) in `rubi-utils.test.ts`;
    #261 end-to-end D-verified in `integration-rules.test.ts`.
- **Phase R20 — Chapter 5 (Inverse trig functions) bundled LANDED (2026-07-10).**
  The arcsin/arctan/arcsec families (5.1/5.3/5.5), which author the
  ArcCos/ArcCot/ArcCsc cofunction variants INLINE (all active native CE heads —
  no cofunction-shift machinery, unlike ch4). Bundle: **5,191 → 5,858 rules**
  (+667, all 15 files compile 0 skips), **5.64 → 6.28 MB**; compile time
  ~0.5–0.8s (well under the 1.5s budget). D-coverage probe: CE's `D` handles all
  six inverse-trig heads incl. **Arcsec/Arccsc/Arccot** (`arcsec → 1/(|x|√(x²−1))`
  etc.) — no derivative-table gap.
  - **First-ever ch5 baselines (s120 seed5, foundation ch1/2/3/6/§8.8 + ch5):**
    5.1 sine **38/120**, 5.2 cosine **40**, 5.3 tangent **53**, 5.4 cotangent
    **60**, 5.5 secant **54**, 5.6 cosecant **49** (294/720 = 40.8%). The
    5.2/5.4/5.6 co-suites exercise the ArcCos/ArcCot/ArcCsc variants living in the
    5.1/5.3/5.5 files. **Genuine wrongs 0**; the 6 residual wrong flags (5.4 ×4:
    #50/#8/#9/#10, 5.5 #41, 5.6 #39) are all documented false-wrongs — negative-x
    branch cuts of complex-log / fractional-power (`E^{n·ArcCot}/(c+a²c·x²)^{k/3}`
    with `((a−I/x)/(a+I/x))^{fractional}`; `x^{n−1}·ArcSec(a+b·xⁿ)` with
    non-integer `n`), each verified clean at positive x by finite-difference D.
  - **Utility gap.** Census MISSING (word-boundary): HalfIntegerQ(8),
    Discriminant(6), HypergeometricPFQ(2), SubstForInverseFunction(2),
    InverseFunctionOfLinear(2), Head(2), PowerVariableExpn(2), FunctionOfLinear(2).
    `ExpandExpression`/`InverseFunctionOfLinear` also appeared but ONLY in the
    stripped `source` text (not the parsed rule) → moot. Implemented in
    `rubi-utils.ts`:
    - **`HalfIntegerQ`** (pred) — every arg a Rational with denominator 2. Gates
      the 5.1.3/5.1.4 `(d+e·x²)^p` half-integer arcsin reductions.
    - **`Discriminant`** (b²−4ac of a quadratic) — feeds `NegQ[Discriminant[v,x]]`
      in 5.3.7 #27/#28 (always behind a `QuadraticQ[v,x]` gate).
    - **`Head`** — CE operator name as a symbol (only 5.3.7 #27/#28, which decline
      earlier; see below).
    - **`FunctionOfLinear` / `PowerVariableExpn`** → **return `False`
      (fail-OPEN guards).** Both appear ONLY as `FalseQ[…]` guards on the 5.3.7
      #71–#74 by-parts rules (`(c+d·x)^m·ArcTan[u]` and general `v·ArcTan[u]` via
      `IntHide`); **no bundled rule consumes a non-False result** (Rubi's
      linear/power-variable substitution rules live in ch9, out of scope). So
      returning False lets the exact, D-verified by-parts rules fire, where a
      faithful non-False detection would only STRAND those integrands. A faithful
      `FunctionOfLinear` is also unbounded here (needs `CommonFactors` /
      `MonomialFactor` / `LeadFactor`). **This is a reasoned deviation from
      "port faithfully"** — the guard polarity makes fail-OPEN the safe,
      coverage-optimal choice (by-parts is a universal antiderivative identity).
    - **`InverseFunctionOfLinear` / `SubstForInverseFunction`** → return `False`
      (fail-CLOSED). Only the 5.3.7 #27/#28 `∫r·f^ArcTan(a+b·x)/quadratic` rules
      bind them; that substitution machinery is a disproportionate port and the
      "exponential of inverse tangent" integrands are largely covered by the
      dedicated 5.3.6 rules (higher priority). `Not[FalseQ[tmp]]` → False → the
      rules decline cleanly (short-circuiting before `Head`/`SubstFor…`).
    - **`HypergeometricPFQ`** — left INERT: CE has `Hypergeometric2F1`/`1F1` but
      no generalized ₚFq head, and its 2 uses (5.1.4 #41/#42) are the
      `Not[IntegerQ[m]]` symbolic-`m` branch whose ₃F₂ result would not numericize
      anyway.
  - **Genuine-wrong found + fixed: `SplitProduct` (a Chapter-1 foundation bug
    exposed by ch5).** The ch5 by-parts of `∫arctan/arccot(a·x²)` produces the
    residual `∫x²/(1+a²·x⁴)` with a SYMBOLIC coefficient. The correct ch1 rule
    1.1.3.2 #36 (POSITIVE-ratio, √2 four-term form) is gated on
    `GtQ[a/b,0] || PosQ[a/b] && AtomQ[SplitProduct[SumBaseQ,a]] &&
    AtomQ[SplitProduct[SumBaseQ,b]]`; `GtQ` can't prove `1/a² > 0` symbolically, so
    it needs the `AtomQ[SplitProduct[…]]` fallback — but `SplitProduct` was
    unimplemented (inert head → `AtomQ` always false), so the WRONG NEGATIVE-ratio
    rule #37 (`1/(r±s·x²)` split of `a−b·x⁴`) fired instead, mis-integrating the
    family (initially 3 ch5 wrongs: 5.3.2 #71, 5.4.1 #82/#83, all failing at
    POSITIVE x). Fix: implement `SplitProduct[func,u]` (returns `{v,u/v}` or the
    atom `False`; only ever used inside `AtomQ[…]` with `SumBaseQ`, 4 occurrences
    across ch1 1.1.3.1/1.1.3.2 — tiny blast radius). #36 now correctly fires; its
    deeper symbolic-coefficient sub-integrals `∫(r±s·x²)/(a+b·x⁴)` don't further
    close in CE, so the family is now **unsolved (inert), not wrong** — the
    fail-closed outcome. Post-fix: 5.3 tangent **1→0 wrong**, 5.4 cotangent
    **6→4 wrong** (the 3 biquadratic wrongs → unsolved). Numeric biquadratics
    (`GtQ` decides) are unaffected; no ch1 regression (ch1 1.1 s120 seed5: 109
    correct, 5 wrong — all pre-existing false-wrong classes, none biquadratic).
    The full symbolic-coefficient quartic closure is a deeper ch1 lever, deferred.
  - **ch3 family-C knock-on (R19 census re-probe).** R19 flagged 13 ch3-unsolved
    (family C) bottoming out in `∫arctan(kx)/x`-type residuals "needing ch5
    producers". With ch5 in the foundation, ch3 s120 seed5 climbs **69 → 71
    correct** (4 wrong unchanged = the R19 false-wrongs #394/#442/#44/#538); the
    two flips are family-C members **#31 and #226** (their `∫arctan/x` residual now
    closes to the `PolyLog[2,±i·x]` inverse-tangent-integral form). The rest of
    family C (#10/#43/#48/#111/#150/#190/#207/#209/#219/#382/#439) still bottoms
    out in shapes ch5's bundled base cases don't reach.
  - **Regression guards (all clean).** ch2 s120 seed5 **82 correct / 2 wrong**
    (=baseline), 4.1 Sine s120 seed5 **107 / 0** (=baseline) — ch5 in the
    foundation does NOT shadow them (ch5 rules only match inverse-trig heads).
  - **Residual / next-rung shopping list** (dominant unsolved family per suite):
    5.1 sine — `(f·x)^m·(d+e·x²)^p·(a+b·arcsin)^n` (50, the m·p·n triple-power,
    needs the `(d+e·x²)^p` half-integer machinery + the ₃F₂ `HypergeometricPFQ`
    kernel); 5.2 cosine — `(d·x)^m·(a+b·arccos)^n` (59); 5.3 tangent — `u·(a+b·
    arctan(c·x))^p` (51, the 161-rule misc-`u` family); 5.4 cotangent — 5.4.1
    misc (51); 5.5 secant / 5.6 cosecant — `u·(a+b·arcsec/arccsc)^n` (51/54). The
    common thread is the high-power `(a+b·InvTrig)^n` reduction recursions whose
    sub-integrals CE doesn't close, plus the symbolic-quartic and ₃F₂ kernels.
  - **Tests.** ch5 utility unit tests (HalfIntegerQ, Discriminant, Head, the four
    False-sentinel stubs) in `rubi-utils.test.ts`; D-verified loader cases
    (∫arcsin, ∫arctan, ∫arcsec, ∫x·arctan, ∫arcsin(2x)², and the ch3-connection
    ∫arctan(x)/x → PolyLog) in `integration-rules.test.ts`.
- **Phase R21 — Chapter 7 (Inverse hyperbolic functions) bundled LANDED (2026-07-10).**
  The structural mirror of R20: the arsinh/arcosh/artanh/arsech families
  (7.1/7.2/7.3/7.5), which author the Arcosh/Arcoth/Arcsch co-variants INLINE
  (all active native CE heads — no cofunction machinery, unlike ch4). Bundle:
  **5,858 → 6,574 rules** (+716, all 21 files compile 0 skips; 157 → 178 docs),
  **6.28 → 6.98 MB**; compile time ~0.6–0.7s (well under the 1.5s budget).
  - **Engine-side kernel (the one new engine piece): Shi/Chi.** The result heads
    `SinhIntegral`/`CoshIntegral` existed as inert generic heads (did not
    numericize). Added machine + complex numeric kernels: real
    `sinhIntegral`/`coshIntegral` in `numerics/special-functions.ts` built on Ei
    (Shi(x) = (Ei(x)−Ei(−x))/2; Chi(|x|) = (Ei(|x|)+Ei(−|x|))/2, real part for
    x<0 matching CosIntegral); complex `sinhIntegralComplex`/`coshIntegralComplex`
    in `numerics/numeric-complex.ts` reusing the validated Si/Ci kernels
    (Shi(z) = −i·Si(iz); Chi(z) = Ci(iz) − iπ/2, reflected into the left
    half-plane via Chi(z) = Chi(−z) + iπ·sign(Im z)). The **naïve Ei-composition
    fails off-axis** (mpmath's complex `ei` uses an inconsistent branch — real
    parts agree but the iπ terms don't cancel); the Si/Ci route is exact.
    **Signed-zero trap:** on the positive imaginary axis iz = −b lands on the
    negative real axis, where `cosIntegralComplex` returns the real-part
    convention Ci(b) (signOf(0)=0 drops the branch iπ); the kernel restores the
    +iπ upper-branch there. mpmath-validated (dps=25) at 8+ points incl.
    negative reals, all four quadrants, both imaginary half-axes, and large |z|
    — relative error ≲1e-13 (better than Si/Ci; it is just a rotation of them).
    Exactness contract honored (exact args stay symbolic under evaluate,
    numericize under N()/inexact — modeled on SinIntegral). Derivative-table
    entries (d/dx Shi = sinh/x, d/dx Chi = cosh/x) added in
    `symbolic/derivative.ts`. Unit tests in `special-functions.test.ts` (real,
    all quadrants, imaginary-axis branch, large |z|, exactness).
  - **First-ever ch7 baselines (s120 seed5, foundation ch1/2/3/5/6/§8.8 + ch7):**
    7.1 sine **79/120**, 7.2 cosine **49**, 7.3 tangent **85**, 7.4 cotangent
    **95**, 7.5 secant **44**, 7.6 cosecant **54** (406/720 = 56.4% — well above
    ch5's 40.8%). The 7.4/7.6 co-suites exercise the Arcoth/Arcsch variants
    living in the 7.3/7.5 files. **Genuine wrongs 0**; the 11 residual wrong
    flags are all documented false-wrongs, each verified clean by the real-part
    D-check at domain-valid positive x:
    - **symbolic-exponent grading (5):** 7.1 #130/#96, 7.2 #386/#396, 7.3 #246 —
      `(a+b·Ar{sinh,cosh,tanh}[…])^n` / `x^n` with symbolic `n`, closing to
      `Gamma[1+n,·]` / `Hypergeometric2F1`; verified by substituting a concrete
      integer `n` (D-ok 4/4).
    - **complex-log branch (4):** 7.4 #66/#71/#112/#279 — `ArcCoth[c+d·x]`
      antiderivatives carrying `Log[2/(1+c+d·x)]` + PolyLog whose imaginary part
      picks a `ln(−|·|) = ln|·|+iπ` / `PolyLog(2,>1)` branch; the **real part
      of D(F) matches the integrand exactly** (#66/#71/#279 D-ok 4/4 at
      arccoth-arg>1; #112 is symbolic-param, reproduces Rubi's own
      ArcCoth²·Log+PolyLog form, same class).
    - **fractional-power / domain branch (2):** 7.5 #20/#21 — `x^m·ArcSech[√x]`
      with `√(−1+1/√x)·√(1+1/√x)` factors (arcsech domain (0,1]); D-ok 4/4 on
      that interval.
  - **No foundation bug found** (unlike R20's SplitProduct): ch7's reduction
    chains bottom out in the same ch1 algebraic base cases R20 already exercised;
    the inline Arcoth/Arcsch co-variants reuse the ch5-proven cofunction-free
    authoring, so nothing new was exposed.
  - **ch3 family-C knock-on (R19/R20 re-probe).** R19 listed `ArcSinh·Log`
    shapes among the remaining family-C members "needing ch7 producers". With ch7
    in the foundation, ch3 s120 seed5 is **unchanged at 71/4w** — **no additional
    family-C member flips** (the R20 flips #31/#226 hold; the `ArcSinh·Log/x` and
    symbolic-order-`PolyLog` residuals still bottom out in shapes ch7's bundled
    inverse-hyperbolic base cases don't reach, or fall outside this sample).
  - **Regression guards (all clean, ch7 in foundation).** 5.1 sine **38/0**, 5.3
    tangent **53/0**, ch6 s60 **18/0**, ch3 **71/4**, 4.1 Sine s120 **107/0** —
    all = baseline; ch2 s120 **83/2** (**+1** vs baseline 82 — a positive
    knock-on, wrongs unchanged). ch7 in the foundation shadows nothing (its rules
    only match inverse-hyperbolic heads).
  - **Residual / next-rung shopping list** (dominant unsolved family per suite,
    mirroring ch5): 7.1 sine — `(f·x)^m·(d+e·x²)^p·(a+b·arsinh)^n` triple-power
    (23); 7.2 cosine — `(f·x)^m·(d−c²d·x²)^p·(a+b·arcosh)^n` (30); 7.3 tangent —
    7.3.7 misc + `u·(a+b·artanh(c·x))^p` (13/12); 7.4 cotangent — 7.4.1 misc (13);
    7.5 secant — `u·(a+b·arsech(c·x))^n` (58); 7.6 cosecant —
    `u·(a+b·arcsch(c·x))^n` (54). Same thread as ch5: the high-power
    `(a+b·InvHyp)^n` reduction recursions whose sub-integrals CE doesn't close,
    plus the `(d±e·x²)^p` half-integer machinery and the ₃F₂ kernel. `Erfi(7)`
    numericizes already; `HypergeometricPFQ(3)`/`Hypergeometric2F1(3)` stay inert
    (no generalized ₚFq head — ch5 precedent).
  - **Tests.** D-verified loader cases (∫arcsinh, ∫arctanh, ∫arccosh, ∫x·arctanh,
    ∫arcsinh(2x)² by-parts/IntHide, and ∫1/arccosh(1+2x²) → CoshIntegral/
    SinhIntegral exercising the new kernel end-to-end) in
    `integration-rules.test.ts` (30s timeLimit for the Chi/Shi-carrying case);
    Shi/Chi kernel unit tests in `special-functions.test.ts`.
- **Phase R22 — the trig-subproblem bridge (ch5 inverse-trig lever) LANDED
  (2026-07-10).** The R20/R21 residual censuses named the
  `(f·x)^m·(d+e·x²)^p·(a+b·InvFn(c·x))^n` family (half-integer `p`) as the biggest
  cross-chapter unsolved cluster. **Root cause (one driver bug, not bundling):**
  the 5.1.2/5.1.3/5.1.4 arcsin reductions close via
  `Subst[∫(a+b·x)^n·Cot[x] dx, x, ArcSin[c·x]]` (and the `(d+e·x²)^p` analogs) —
  they hand a poly/rational·`Cot[x]` sub-integral to the Chapter-4 §4.3 Tangent
  rules, which reduce `∫(a+b·x)^n·Cot[x]` to Log/PolyLog[n+1]. But `driver.int`
  computes `trigActive = hasActiveTrig(integrand)` **once** at the top-level
  call, and an arcsin/arctan integrand carries **no active trig** → `trigActive`
  is false → the inert-trig bridge (deactivate → match ch4 → re-activate) is
  gated OFF for the entire call → the `Cot` sub-integral never reaches the ch4
  rules and strands as an inert `Integrate`. **Fix (driver.ts `intRec`, ~15
  lines behind `RUBI_NO_TRIGSUB`):** when a subproblem introduces active trig
  into a non-trig context (`!this.trigActive && hasActiveTrig(integrand)`),
  engage the bridge for that subtree — flip `trigActive`, integrate, then
  re-activate the (possibly trig-carrying) result, since the top-level `int()`
  activation is gated on the top-level flag and would skip it. The re-entry sees
  `trigActive` true and falls through (no recursion; the guard is now false).
  Benchmark alignment: `scripts/rubi/benchmark.ts` foundation now also loads
  §4.1 Sine / §4.3 Tangent / §4.5 Secant (the shipped bundle has them since
  R4/R10/R12) — without §4.3 Tangent in the rule set the bridge engages but finds
  no rule to close the `Cot` sub-integral. **Attribution (5.1 sine, s120 seed5,
  ch4 foundation present): fix OFF 38 → fix ON 54** — the entire +16 is the
  driver fix; the ch4 foundation alone (fix off) changes nothing, confirming the
  bridge is the lever.
  - **Per-suite before→after (s120 seed5, genuine wrongs 0 throughout).** Ch5:
    5.1 sine **38 → 54** (+16), 5.2 cosine **40 → 52** (+12), 5.3 tangent
    **53 → 57** (+4), 5.4 cotangent **60 → 60**, 5.5 secant **54 → 56** (+2),
    5.6 cosecant **49 → 52** (+3) — **294 → 331 (+37, 40.8% → 46.0%)**. Ch7:
    7.1 sinh **79 → 79**, 7.2 cosh **49 → 51** (+2), 7.3 tanh **85**, 7.4 coth
    **95**, 7.5 sech **44**, 7.6 csch **54** — **406 → 408 (+2)**. The ch5/ch7
    asymmetry is structural: arcsin/arctan reductions bottom out in **trig**
    (`Cot`/`Tan`) sub-integrals that the `trigActive` snapshot gated off (fixed
    here), whereas arsinh/arcosh reductions bottom out in **hyperbolic**
    (`Coth`/`Tanh`) sub-integrals routed by the driver's `containsHyperbolic`
    fallback, which is UNGATED — so ch7 was already covered at R21 (7.2's +2 is
    the handful of arccosh cases whose `√(1−c²x²)` factor yields a trig, not
    hyperbolic, sub-integral).
  - **Census — what stays unsolved (5.1 after, 65 unsolved).** (A) **22 =
    `Unintegrable`** — Rubi itself returns non-elementary; CE's inert `Integrate`
    is the CORRECT match, not a gap. (B) **`x^m·ArcSin^n` with `n` negative /
    fractional-half / symbolic** → CosIntegral/SinIntegral (n<0, e.g.
    `∫x/(√(1−c²x²)·ArcSin)` = the `Cos[k·ArcSin]` expansion), `Gamma[1+n,·]`
    (symbolic n), or `Hypergeometric2F1`/₃F₂ (fractional) — a SEPARATE
    "`InvTrig^n` reduction" machinery (`Cos[k·θ]`-expansion + a generalized
    ₚFq head CE lacks), the next rung. (C) **high-power `(d+e·x²)^p/x^k` with
    n≥2** whose `∫(a+b·x)^n·Cot` residual needs PolyLog[3+] — mostly closes now
    (`∫x²·cot`, `∫x³·cot` verified) but a few deep ones remain. (D)
    **₃F₂/HypergeometricPFQ terminal forms** (5.1.4 #41/#42 symbolic-m) —
    out of scope, no pFq head (R20 precedent). Ch5 wrong flags unchanged from R20
    (5.4 ×4, 5.5 ×1, 5.6 ×1 — all documented negative-x branch false-wrongs);
    ch7 wrong flags unchanged from R21 (7.1 #130/#96, 7.2 #386/#396 symbolic-
    exponent grading; 7.3 ×1; 7.4 ×4; 7.5 ×2 — all documented false-wrongs).
  - **Regression guards (all = baseline or better, genuine wrongs 0).** 5.3
    tangent **53 → 57** (+4, arctan benefits from the same bridge), 5.4/7.3/7.4/
    7.5/7.6 unchanged, ch3 **71/4w**, ch2 **83/2w**, ch1 1.1 **109/5w** — all
    = baseline. The `--rubi ".../4.1 Sine"` (ch4 SUBSECTION) benchmark still
    reports its pre-existing driver-only 58 (that invocation's `corpusRoot` is
    the `4 Trig functions` dir, so NO foundation loads — a long-standing
    benchmark quirk, unaffected by this rung); the SHIPPED §4.1 Sine is 107
    (`loadIntegrationRules` closed-rate, unchanged — the driver fix is a strict
    no-op for a trig top-level integrand, and this rung touches neither the
    bundle nor the built-in antiderivative).
  - **Tests.** `integration-rules.test.ts`: an R22 describe block, D-verified via
    finite-differenced `F.N()` — `∫x·arcsin/(1−x²)` (integer p, → PolyLog),
    `∫arcsin²·√(1−x²)/x²` (p=1/2, n=2), `∫x²·arcsin²/(1−x²)^(5/2)` (p=−5/2, n=2),
    `∫x·arccos/(1−x²)` (arccos co-variant), and `∫arcsinh/x` (the hyperbolic-
    fallback control that already passed). Four of the five FAIL under
    `RUBI_NO_TRIGSUB=1`. `rubi-utils.test.ts`: a `HalfIntegerQ` grading test
    (p = ±1/2, ±3/2, −5/2 → true; integers/denom≠2 → false; multi-arg all-true).
- **Phase R23 — the InvTrig^n multiple-angle → CosIntegral reduction LANDED
  (2026-07-10).** R22's census named subfamily (B) — `x^m·(a+b·ArcSin(c·x))^n`
  with `n` negative / fractional-half — as the dominant remaining
  non-`Unintegrable` cluster, closing to **CosIntegral/SinIntegral** via a
  `Cos[k·θ]`-expansion CE lacked. **Root cause (one utility gap, no bundling):**
  the arcsin substitution rules (5.1.4#45, and the 5.1.2#7/#8 and 4.1.10#17/#18
  sine rules they reach) hand `∫θⁿ·Sin[u]^m·Cos[u]^k dθ` to `ExpandTrigReduce`,
  whose CIRCULAR branch left `Sin/Cos` **unchanged** — only Sinh/Cosh routed
  through the exponential expander (`hyperbolicToExp`). So rule 4.1.10#17 fired,
  called `ExpandTrigReduce[x⁻¹, Sin[x]², x]`, got the integrand back unchanged,
  and failed "no progress"; the `∫Sin[x]²/θ` inner integral stranded. **Fix
  (`rubi-utils.ts` `circularTrigReduce`, ~110 lines, no toggle):** extend the
  circular branch to a REAL product-to-sum — pairwise `Cos·Cos = ½Cos[a−w]+½Cos[a+w]`,
  `Sin·Sin`, `Sin·Cos`, `Cos·Sin` identities (numerically verified), reducing
  `Sin[u]^m·Cos[u]^k` to a linear combination of single-angle `Cos[j·u]`/`Sin[j·u]`.
  Kept in TRIG (not exp) form deliberately — the downstream `θⁿ·Cos[j·u]` rules
  and the R15 `∫Cos[j·u]/θ → CosIntegral` fallback match `Cos`/`Sin` heads, and
  a chapter-wide exp reduction preempts the trig rules (the R9 lesson). SCOPED to
  the `ExpandTrigReduce` call sites (rule RHSs) — never a global driver fallback,
  so no toggle is warranted. The reduction is an **exact identity**
  (`reduce(u) ≡ u`), unit-verified. Once the circular branch reduces, the whole
  chain (5.1.4#45 → 4.1.10#17 → R15 Si/Ci) already existed: `∫x²/(√(1−x²)·arcsin)`
  now closes to `−½Ci(2·arcsin)+½Log(arcsin)`.
  - **Per-suite before→after (s120 seed5, genuine wrongs 0 throughout).** 5.1
    sine **54 → 55** (+1: #348 `x²/(√·arcsin)` → CosIntegral), 5.2 cosine
    **52 → 55** (+3: #55/#56/#69 `xᵐ/arccos^k` → CosIntegral), 5.3 tangent
    **57 → 58** (+1, arctan reaches the same reduction), 5.4/5.5/5.6 unchanged —
    **331 → 336 (+5, 46.0% → 46.7%)**. Chapter 7 unchanged (the fix touches only
    the circular branch; hyperbolic routes through `hyperbolicToExp`).
  - **Census — what the +5 leaves.** The **mixed** `∫θⁿ·Sin[u]^m·Cos[u]^k` inner
    integral of rule 5.1.2#11 (needed by #408/#410/#336, the `(a+b·ArcSin)⁻²`
    cases) has NO closing CE rule — Rubi's `FunctionOfTrigOfLinearQ`-gated rule is
    unimplemented, so it never reaches an `ExpandTrigReduce` call. The reduction
    ALSO unlocks the fractional-`n` (`Sqrt[arcsin]`, `^(3/2)`, `^(5/2)`) families:
    these produce a **correct** complex-`Erfi`/Fresnel antiderivative CE cannot
    `.N()` (complex-argument Erfi), so the harness grades them `not-evaluable` /
    `inconclusive` rather than solved (5.2 gains +7 such; symbolic-`D` verification
    at rel-err ~1e-16 confirms they are correct, not wrong — same faithful-Rubi
    `not-evaluable` class as the 9 baseline ch5.2 cases). The mixed-product path
    and a native complex-Erfi kernel are the next rung.
  - **Regression guards (all = baseline, genuine wrongs 0).** 4.1 Sine
    **107/120** (0w — the chapter most exercised by the circular ExpandTrigReduce
    change, unchanged), ch2 **83/2w**, ch3 **71/4w**, ch6 s60 **18/0w**, 7.1
    **79/2w**, 7.2 **51** (byte-identical results; one case flaked to
    `inconclusive` on a `verification budget exceeded` under concurrent CPU load —
    not a regression), 5.3 **58** (the +1 above). All wrongs are the documented
    false-wrong classes.
  - **Tests.** `integration-rules.test.ts`: an R23 describe block, D-verified via
    finite-differenced `F.N()` — `∫x²/(√(1−x²)·arcsin)` and the `arccos`
    co-variant, both asserting a `CosIntegral` form (each is inert without the
    reduction). `rubi-utils.test.ts`: a `circularTrigReduce` block — the
    `reduce(u) ≡ u` identity over pure powers, mixed products, a scalar-Add shape,
    and a symbolic linear argument, plus a single-angle-only output assertion and
    the load-bearing `Sin²→½−½cos(2x)` step.
- **Phase R24 — complex-argument Erf/Erfi kernel LANDED; the
  `FunctionOfTrigOfLinearQ` mixed-product lever mapped and DEFERRED
  (2026-07-10).** R23's census named two paired follow-ups. **Part B shipped;
  Part A was implemented, measured net-zero, and backed out** (a bounded port
  with a good map beats a forced no-op).
  - **Part B — complex Erf/Erfi kernel (`numerics/numeric-complex.ts`
    `erfComplex`/`erfiComplex`, ~40 lines; wired in `library/statistics.ts`).**
    R23 left ~7–15 ch5.2 fractional-`n` problems `not-evaluable`/`inconclusive`:
    their CORRECT (Rubi-optimal) antiderivatives carry `Erfi`/`Erf` of a COMPLEX
    argument the harness could not `.N()`, so `F`'s finite-difference verification
    stranded. **Kernel:** `erf(z) = 1 − Γ(1/2, z²)/√π` on the existing complex
    incomplete-Γ kernel (`incompleteGammaUpperComplex`), reflected into the right
    half-plane (`erf` odd, entire), with `erfi(z) = −i·erf(i·z)` — the R21
    rotate-a-validated-kernel precedent. Signed-zero trap handled: on the
    imaginary axis `z²` lands on the Γ(1/2,·) negative-real branch cut with a
    spurious `−0` imaginary part; forcing `Im(z²) = +0` selects the correct
    (odd-function) branch. mpmath-validated (all quadrants + both axes + large
    |z|) to ≲1e-12 small/moderate, ~1e-7 in the large-|z| asymptotic band.
    Exactness contract honoured — a Gaussian-integer arg stays symbolic under
    `evaluate()`, numericizes under `.N()`.
    - **Per-suite before→after (s120 seed5, clean back-to-back A/B toggling only
      the kernel; genuine wrongs 0).** 5.1 sine **55 → 57** (+2, not-eval 3→1),
      5.2 cosine **55 → 67** (+12, not-eval 15→4, inconc 1→0), 5.3 tangent
      **58 → 59** (+1, not-eval 2→0) — **+15 correct across the three, ALL from
      not-evaluable/inconclusive → correct** (the Part-B signature). `unsolved`
      unchanged (the kernel does not change whether `F` contains `Integrate`; it
      unblocks both the grading oracle AND the driver's internal
      `antiderivativeVerifies`). Each before-run reproduces the R23 baseline
      exactly (55/55/58).
    - **Guards.** 4.1 Sine (chapter-dir, s120 seed5) **108/0w** (pure trig, no
      Erfi → Part-B-inert). ch2 exponentials s120 seed5 **83/2w → 82/3w**: the
      +1 flag is a **documented-class false-wrong**, `2.3#191`
      `∫f^(a+b·xⁿ)·x^(n/2−1)` = `f^a·√π·Erfi[√b·x^(n/2)·√Log f]/(√b·n·√Log f)`
      (Rubi's OPTIMAL answer, `D(F) ≡ integrand` exactly — verified symbolically
      and numerically at real args). It was accidentally graded correct BEFORE
      only because `Erfi` stayed symbolic so the harness saw real-arg points
      alone; with the kernel it finite-differences `F` at a `f<1` / non-integer-`n`
      / `x<0` point (arg complex) and the central difference crosses the
      `x^(n/2)`/`√Log f` branch cut (`dF=0.397` vs `f=0.398−0.004i`, ~1% — a phase
      artifact, not a magnitude error). **Genuine wrongs remain 0** — same
      non-integer-`n` complex-log/fractional-power class as the R20 false-wrongs.
    - **Tests.** `special-functions.test.ts` — a `COMPLEX-ARGUMENT Erf, Erfi`
      block (four quadrants, both imaginary half-axes, large-|z|, the exactness
      contract, real-path regression), mirroring the Ei/Si/Ci and Shi/Chi blocks;
      `special-functions-bignum.test.ts` B23 updated (Erf(1+i) now numericizes;
      Sinc/FresnelS still symbolic). FresnelS/FresnelC complex support was NOT
      needed (the affected antiderivatives carry Erfi, not Fresnel) — out of scope.
  - **Part A — `FunctionOfTrigOfLinearQ` (implemented, measured, backed out).**
    Ported faithfully (`AlgebraicTrigFunctionQ` ∧ non-Null/False `FunctionOfTrig`,
    on the activated form) and **fail-CLOSED** (over-firing probe: `∫x⁴` 49 ms,
    `∫x²eˣ`, a rational — 0 touches of the gated rule; before the port an
    unimplemented predicate head already `throw`s in `evalCondition`, so the rule
    declined). **But it is net-zero and was removed.** Its SOLE bundled consumer is
    the universal rule `4.1.0.1#1` `Int[u_] → Int[DeactivateTrig[u,x], x]`. In Rubi
    this deactivates ACTIVE trig so the inert-form rules can match; in CE the driver
    **already pre-deactivates** trig up front (`driver.ts`), so `DeactivateTrig[u] ≈ u`
    and the rule is a memo/cycle-guard-neutralised no-op. Measured: 5.1 s120 seed5
    is **57 with the predicate ON and 57 with it OFF** (identical), at ~3% extra
    wall-clock (the rule is retried on every trig integrand). Trace confirms the
    rule now fires on `∫θⁿ·sin^m·cos^k` yet the inner STILL returns `null`. **The
    real blocker is downstream:** after deactivation CE lacks the poly×trig
    reduction (an `ExpandTrigReduce` over a polynomial coefficient / the specific
    `4.1.0.x` `(c+d·x)^m·trig^n` expansion rules) that closes `5.1.2#408/#410/#336`.
    That capability — NOT the predicate — is the next rung, and it is a
    disproportionate port for R24, so Part A is deferred with this map.
- **Phase R25 — symbolic-coefficient quartic-denominator closer LANDED
  (2026-07-10).** The `∫(d+e·x²)/(a+b·x⁴)` family (and everything that reduces to
  it — `∫x^m/(a+b·x⁴)`, `∫Pq/(a+b·x⁴)`, `∫(a+b·x⁴)^p/(c+d·x⁴)^q`, products of
  quartics) failed to close for BOTH symbolic and numeric `a,b`, fail-closed to an
  inert `Integrate`. **Root cause — an ExpandIntegrand ⇄ binomial-split
  ping-pong, not a predicate or `Rt` fault.** Rubi's `1/(a+b·x⁴)` (1.1.3.1) and
  `x²/(a+b·x⁴)` (1.1.3.2) split rules DELIBERATELY emit a quadratic-numerator
  `(r±s·x²)/(a+b·x⁴)` sub-integral, relying on the 1.2.2.3 trinomial
  `(d+e·x²)/(a+c·x⁴)` TERMINAL rules (treating `a+b·x⁴` as the degenerate
  `a+0·x²+b·x⁴`) to break out to `∫1/(quadratic)` → ArcTan/Log. But CE's
  `ExpandIntegrand` (rule 1.1.3.7 `Int[Pq/(a+b·x^n)] := Int[ExpandIntegrand[…]]`,
  higher file-order priority) just *distributed* the sum-numerator over the
  shared denominator — `(√a+√b·x²)/(a+b·x⁴) → √a/(a+b·x⁴) + √b·x²/(a+b·x⁴)` — and
  those monomial pieces route straight back into the 1.1.3.1/1.1.3.2 splits,
  which re-emit `(r±s·x²)/(a+b·x⁴)`: an infinite cycle that the driver's dedup/
  depth guards cap into an inert residual. (The `Rt`/`PosQ` machinery was fine —
  `Rt[a/b,2]` correctly yields `r=√a, s=√b` for symbolic operands.)
  - **Fix (surgical, branch-safe; `rubi-utils.ts` `ExpandIntegrand`).** Fail the
    distribution — so the driver falls through to the 1.2.2.3 terminal rules —
    for exactly the ping-pong shape: a proper rational `Pq/(a+b·x^n)` whose
    denominator is a pure even binomial (n ≥ 4) AND whose numerator is a
    polynomial in `x^(n/2)` (only the constant and `x^(n/2)` coefficients
    non-zero), i.e. `(d+e·x^(n/2))/(a+b·x^n)` (`isProperRationalOverEvenBinomial`).
    The `x^(n/2)`-only restriction is load-bearing: an odd/other-degree numerator
    (e.g. the linear `a+b·x` residual of a `P(x)/(a+b·x⁴)` reduction) MUST still
    distribute — `∫x/(a+b·x⁴)` closes directly (arctan of x²) with no cycle, and
    blocking its split would strand the `P(x)` family. Branch-safe: the fix
    imposes NO factorization; the downstream binomial/trinomial rules keep their
    own `PosQ`/`NegQ`/`GtQ` sign guards, so both `a/b>0` and `a/b<0` route
    correctly (R10 lesson). Non-rational integrands are untouched (`polyDegreeX`
    of a Sin/Exp numerator is < 0, so the guard never fires). Gated by
    `RUBI_NO_R25` for A/B.
  - **Before→after (s200 seed5, 1.1.3 General; clean A/B toggling only the
    guard; genuine wrongs 0).** solved-correct **173 → 180** (+7), unsolved
    **12 → 6** (−6) — the quartic-RATIONAL unsolved subfamily (`∫x⁶/(a+c·x⁴)³`,
    `∫x⁶/(2+3·x⁴)`, `∫(a+b·x⁴)²/(c+d·x⁴)³`, `∫(c+d·x⁴)⁴/(a+b·x⁴)`,
    `∫1/((a+b·x⁴)(c+d·x⁴))`, `∫(a+b·x+d·x³)/(2+3·x⁴)`) went **6 → 0**; the 6
    remaining unsolved are all elliptic/cubic (EllipticF/E, `(a+b·x³)^(3/2)`,
    `Sqrt[a+b·x⁴]` in the numerator, `(a+b·x⁴)^(3/2)`) — genuinely out of scope.
    The 8 `solved-wrong` are byte-identical before/after (the pre-existing
    symbolic-exponent / two-binomial cluster).
  - **Guards (s120 seed5, clean A/B; NEW wrongs from R25 = 0 everywhere).**
    ch1 1.1 **109/5w → 111/4w** (+2 correct AND R25 *fixes* one pre-existing
    genuine wrong, `∫x⁸/(a−b·x⁴)^(1/4)` wrong→correct); ch2 **82/3w** identical;
    ch3 **70/4w** identical (net-zero — no quartic sub-integrals in the sample;
    the ROADMAP "71" was pre-existing baseline drift, not R25); 4.1 Sine
    (chapter-dir) **108/0w** identical. **Chapter 5 (the R20-noted dependency):**
    the arctan/arccot(a·x²) by-parts chains bottom out in `∫x²/(1+c²·x⁴)`, so
    5.3 Inverse tangent **60 → 61** (+1, `∫(a+b·ArcTan[c·x²])/x²`) and 5.4 Inverse
    cotangent **60 → 62** (+2, `∫ArcCot[a·x²]`, `∫ArcCot[a·x²]/x²`), 5.4 wrongs
    **4 → 4** identical (pre-existing).
  - **Tests.** `integration-rules.test.ts` — a `symbolic quartic-denominator
    rationals (R25)` block D-verifying six representatives at fixed parameter
    values; `rubi-utils.test.ts` — an `ExpandIntegrand binomial-denominator guard
    (R25)` block asserting the guard fails on `(√a+√b·x²)/(a+b·x⁴)` and pure
    `x²/(a+b·x⁴)` yet still distributes the linear `(a+b·x)/(2+3·x⁴)` and leaves
    quadratic-denominator shapes alone. Both blocks fail under `RUBI_NO_R25=1`.
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
