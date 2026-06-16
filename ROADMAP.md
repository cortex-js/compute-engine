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

**State:** **Chapter 1 (Algebraic functions)** is translated and bundled (67
rule-docs → ~2.6k rules in `src/compute-engine/rubi/rubi-rules-data.json`,
exposed via `@cortex-js/compute-engine/integration-rules`), **plus the Chapter-4
trig `(a+b cos+c sin)` Weierstrass family** (`4.1.6`, 57 rules) from the trig
pilot. The pilot closed the **three `1/(3cos x + 4sin x + k)` Wester integrals**
(∅→✅ under `CE+R/F`) via a minimal active↔inert trig head-swap bridge — Wester
indefinite-∫ is now `CE+R/F` 6/8 (overall 32/48). The **2 remaining Wester
indefinite gaps** are **exponential** (`2^x/√(4^x+1)`, `u = 2^x → arcsinh`) and
**hyperbolic** (`sinh⁴x/cosh²x`), both in untranslated chapters.

**In progress — full Chapter 4 (trig).** The whole cost is the **inert-trig
utility layer** (77% of the chapter's 2,117 rules match inert `cos`/`sin`;
extraction + compilation are free — `docs/rubi/RUBI.md` §1/§5). The ch4 corpus
is translated; the runtime utility port is incremental, validated per-section
against the **Rubi test suite** (the real metric). Landed: `ExpandTrig` + the
predicates `InertTrigFreeQ`/`FalseQ`/`InverseFunctionFreeQ`. The verified
solve-rate climbs in steps — each utility unlocks the next; the current 4.1 Sine
bottleneck chain is the ordered next-rung list:

1. **`match.ts` AC-split enumeration** for `u_*y_^m_.` shapes — the reverse-
   chain-rule (`Int[u·y^m]`) rules can't reach the `u=cos, y=sin` split today,
   which blocks `DerivativeDivides`.
2. **`DerivativeDivides`** — _perf-careful_ (the naive port stalls: it runs
   `D`+`simplify` on every wrong AC-binding; gate hard, skip `simplify` unless
   it can help) — and **`FunctionOfTrig`/`SubstFor`** (the tan / tan-half
   substitution engine).
3. **`TrigSimplify`/`TrigSimplifyQ`** (Pythagorean reductions).
4. The **136 `FixInertTrigFunction`/`UnifyInertTrigFunction`** argument-
   unification clauses.
5. Bundle the full chapter + validate against the ~22k-problem trig suite;
   re-run Wester as a spot-check.

Then **exponential** (Ch 2, 125 rules) and **hyperbolic** (Ch 6, 390 rules):
both use ACTIVE heads in their LHS (no inert layer) → ≈ Chapter-1 difficulty,
cheaper than the rest of Chapter 4. Per-chapter coverage + packaging tracked in
`docs/rubi/RUBI.md` §5.

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
