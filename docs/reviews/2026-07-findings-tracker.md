# Findings Implementation Tracker

Working plan for implementing [`SYMBOLIC_FINDINGS.md`](./SYMBOLIC_FINDINGS.md) (SYM-*) and
[`CORRECTNESS_FINDINGS.md`](./CORRECTNESS_FINDINGS.md) (P0-*/…), scoped to **P0s first**
(P1+ queued in Waves 4–5, re-prioritized after P0s land). Full per-finding detail lives in
the findings docs; per-area deep detail in the review scratchpads referenced at the bottom
of each findings doc.

**Model tiers.** `S` = Sonnet 5 (single-file, precisely specified, acceptance test given).
`O` = Opus (judgment within one subsystem). `F` = Fable (policy decisions, algorithmic
logic, review gates, debugging escalations).

**Status legend.** ☐ todo · ▶ in progress · ✔ fixed (targeted tests pass) ·
✅ verified (review gate passed) · ⏸ deferred · ⛔ blocked.

## Protocol (applies to every work package)

- **No commits, no staging** — changes stay in the working tree; the user decides commit points.
- **WIP exclusion zone** (user's unstaged performance fixes — do not touch, do not include in
  reported diffs): `src/big-decimal/**`, `src/compute-engine/boxed-expression/solve.ts`,
  `benchmarks/**`, `test/big-decimal/**`.
- **Test-locked findings**: fix code + wrong test in the same change.
- **Snapshot discipline**: measure blast radius before updating snapshots; if changes extend
  beyond the targeted area, stop and report; never update an @fixme snapshot.
- Every package runs its targeted suite(s) + `npm run typecheck` and reports honestly.
- Escalation rule: ambiguous spec or unexpected test failures → stop, report to orchestrator
  (Fable); don't improvise.

## Wave 0 — Policy decisions (F) — DECIDED 2026-07-01

- **D1 (Mod/Remainder).** `Mod` = **floored** (sign follows divisor) everywhere: fix the bignum
  lane to match the machine lane; every compile target emits a floored-mod helper (not bare
  `%`/`np.remainder`-mismatches). `Remainder` keeps current interpreter (truncated/IEEE-style)
  semantics; targets emit matching code (Python: not `np.remainder`). Document both.
- **D2 (float args under evaluate()).** Uphold the CLAUDE.md contract: **inexact args
  numericize under `evaluate()`** for all numeric operators (trig already complies; the
  ~30 special functions holding `Gamma(5.1)` symbolic are the deviation — REVIEW.md B23
  is overruled). Implementation is Wave 4 (P1 scope); decision recorded now.
- **D3 (three-valued helpers).** Domain-question helpers return `boolean | undefined`; call
  sites compare `=== true`/`=== false` and never negate. `onBranchCut` becomes three-valued;
  `isInteger`/`isRational` mirror the repaired `isReal`; wildcard conditions use semantic
  three-valued checks. Rewrites fire only on provable.
- **D4 (generic-real convention).** Keep the documented convention for *unconstrained*
  symbols, but every real-only rewrite must bail when `isReal === false` **or** the declared
  type is explicitly non-real. Document the convention once (ARCHITECTURE.md + SIMPLIFY.md).
  Canonical generic-point folds (`x/0`, `0/x`, `x/∞`) get documented; the `0·x` vs `2·0·x`
  alignment is **measure-blast-radius-then-ask** (debatable direction).
- **D5 (complex/NaN comparisons).** Mathematical comparisons (`lt/lte/gt/gte`, `cmp`
  fallbacks) return `undefined` when either side is not provably real. The *structural* total
  order (`order()`) gets an explicit deterministic NaN rank (after all numbers) and loses the
  `af - bf` subtraction comparators. `Max`/`Min` stay symbolic on non-real operands.
- **D7 (parenthesized relations are atoms).** An explicitly parenthesized relational
  operand (`(a < b) <= c`) is an *atomic boolean term* in the surrounding chain — chains
  never reach through explicit delimiters. The old ascii-math snapshots encoded the
  P0-38 fabrication bug (`(a<b) <= (c>d)` "expected" a fabricated `b<=d`); updated to the
  new principled outputs.
- **D6 (compile fail-closed).** Anything a target cannot express with interpreter-matching
  semantics **fails at compile time** with the offending head — never literal-NaN folds,
  dangling variables, invalid syntax, or wrong-convention operators. Constant folding goes
  through the interpreter's exact path.

## Wave 1 — Verified one-liners (S, parallel, disjoint files)

| WP | Findings | Fix | Files | Model | Status |
|---|---|---|---|---|---|
| 1.1 | P0-8 | `'ArcTan2'` → `'Arctan2'` + test (+ opportunistic: forward `numericApproximation` in Argument/AbsArg) | library/complex.ts:100 | S | ✅ 8/8 new + 14 suites green |
| 1.2 | P0-14 | drop spurious Negate in arcoth derivative; fix locked test | symbolic/derivative.ts:119, derivatives.test.ts:240 | S | ✅ 109/109 |
| 1.3 | SYM P0-1, P0-15 | remove Sin/Tan/Cot/Csc/**Arccot** from ODD_TRIG; fix 2 locked tests | symbolic/simplify-abs.ts:17-26, simplify.test.ts:602, simplify-noskip.test.ts:688 | S | ✅ suites green · cot³x snapshot corrected by F (calculus.test.ts:830, test passes) |
| 1.4 | P0-5 | `im===1` needs `re===0` conjunct; fix @fixme snapshot | boxed-expression/arithmetic-mul-div.ts:1064 | S | ✅ 365/365, 2 snapshots (both repro cases) |
| 1.5 | SYM P0-3 | `.add()` → `ce.function('Add',…)` in simplify power-combining (5 sites) | symbolic/simplify-power.ts:835/849/862, symbolic/simplify-rules.ts:969/995 | S | ✅ 8/8 new + suites green |

## Wave 2 — Clustered P0 implementation (O unless noted)

| WP | Findings | Package | Key files | Model | Status |
|---|---|---|---|---|---|
| 2.1 | P0-1 | Defint: stop wrapping inert Integrate in EvaluateAt (guard on `has('Integrate')`, not operator; + EvaluateAt defense-in-depth) | library/calculus.ts, library/core.ts | O | ✅ 7 new tests + controls exact |
| 2.2 | P0-2, P0-4, P0-16i | `Sqrt(y).N()` roots symbolic part; `asBigint`/`toBigint` exact extraction (+ narrow Mod fast path); `sumAccumulate` exact Sum | library/arithmetic.ts, boxed-expression/numerics.ts, canonical-form.test.ts | O | ✅ all suites green · caveat → WP-2.16 |
| 2.16 | P0-4 residual, P0-11, EX-07a, EX-15 | **Exact integer powers**: `Power(2,127).evaluate()` must stay exact bigint (unblocks IsPrime via Power); `Power(2,−2) → 1/4` exact; `(1+i)² → 2i` via exact Gaussian powering (not exp/ln); magnitude guard for huge exponents (`Power(2,1e15)` json throws) | boxed-expression/arithmetic-power.ts | O | ✅ 23 regressions + IsPrime(2^127−1) end-to-end · Wallis snapshot 5/8 (correct) |
| 2.3 | P0-6, P0-13, P0-27 | Complex-blindness sweep per D5: lt/gt/cmp im-checks, complex log_b ÷ln(b), Max/Min symbolic on non-real | numeric-value/*.ts (lt/lte/gt/gte), compare.ts cmp fallbacks (+5th site found), arithmetic.ts Min/Max, arithmetic.test.ts snapshots | O | ✅ 131/131 matrix + suites · `Log(-1.0,2).N()` sub-case reassigned → 2.13 |
| 2.4 | P0-28, P0-29, P0-30, P0-31, SYM P0-8 | Comparison/assumptions plumbing: NaN order rank per D5; assume(x=y) type-setter wipe; eq() DB-before-heuristics; .is() binding symmetry | order.ts (nan rank + compareFloat), assume.ts (type-before-value), compare.ts (DB-before-name-heuristic), abstract-boxed-expression.ts (.is both-side binding) | O | ✅ property tests 0 violations · 1 NaN snapshot + 2 verify.test assertions corrected |
| 2.5 | P0-7 | Mod/Remainder unification per D1 — **interp lanes only** (bignum floored fix, Remainder lane audit, exact-rational Mod if easy); target-side emission moved to WP-2.8 (same emitter files) | library/arithmetic.ts Mod/Remainder region (evaluate + sgn lanes, exact-rational floored mod, Remainder tie-break unified) | S | ✅ 26/26 sign grid ×2 precisions · gate note: reconcile 2.16 json test with 2.6 (2^127 exactly float-representable) |
| 2.6 | P0-32…37 | Serialization cluster: bigint→float check, 17-digit heuristic, complex re-box, `0.(3)` string, repetend×6, Leibniz order-2 parse | numerics/expression.ts:52, numerics/numeric-bignum.ts:34-52, box.ts:276-288, serialize.ts, serialize-number.ts, definitions-arithmetic.ts (Leibniz d^n) | O | ✅ 83/83 battery, zero own-fix snapshot deltas across 34 suites · note: agent staged its 9 files (protocol slip, harmless) |
| 2.7 | P0-38, P0-39, P0-40 | Parse cluster: mixed-direction chains → pairwise And; `--` serializer parens + Decrement guard; parseLog sup handling | relational-operator.ts (core relationals now `lazy` + `flattenComparisonChain`), definitions-other.ts (C-ops removed from LaTeX), definitions-arithmetic.ts (Subtract parens, log/exp sup) | O | ✅ 675/675 truth table, 35 latex suites + typecheck green |
| 2.8 | P0-41…46 | Compile fail-closed per D6: Round/Arccot/odd-root helpers, refuse NaN folds, multi-index Sum, run() scope leak, assoc parens, Python `(-2)**x` | compilation/* (javascript-target.ts, base-compiler.ts:64/165/1125, compile-expression.ts:146-156) **+ absorbed: target-side Mod/Remainder per D1 (incl. compile-wgsl.test.ts:36-39)** | O | ✅ 768 compile tests + 89 parity · Root(−8,3)→−2 (deviation, correct) · 3 wrong-locked tests rewritten |
| 2.17 | P0-7/41/42 residual | **Interval-JS runtime alignment**: `_IA` Arccot (atan(1/x) branch), Round (half convention), Mod (sign) in `src/compute-engine/interval.ts` still diverge from interpreter — was outside 2.8's allowed scope; also runtime rational `Power(x, p/q)` of negative base → NaN vs real convention | src/compute-engine/interval/{trigonometric,elementary,index}.ts, compilation/interval-javascript-target.ts | O | ✅ 220/220 point + 100/100 enclosure + 269 suite tests · round() pre-landed fix verified |
| 2.19 | 2.17 residual | **Interval-GLSL preamble** still emits old Arccot/odd-Root/Mod forms (gpu-target.ts shader preamble; parity suite lacks negative/odd cases — add them) — mirror the 2.17 runtime fixes | compilation/interval-glsl-target.ts (actual file) | S | ✅ committed `f9d953ed` — agent stalled 2× (watchdog), F completed: powrat+round from agent diff (verified), + F found & fixed a THIRD bug (mod point-divisor used abs → wrong sign for negative divisors), JS-port mirrored; Arccot absent from preamble (fallback). Residual: a few more explicit parity cases would be nice (semantics verified 3 ways) |
| 2.18 | P0-19 residual + new finding | **`DigitSum(2^{10^6})` still hangs** (guard belongs in library/number-theory.ts — out of 2.11's scope; same digit-estimate pattern). **New finding: serializing a BigDecimal with a ~65M-digit exponent takes ~9s in `.toString()`/`.json`** (printing path, computation is fast; EX-15's sibling) | library/number-theory.ts (O(digits) digits via native toString + 1M-digit guard, ×3 operators), src/big-decimal/big-decimal.ts (toFixed no pow10 round-trip, 20k-fuzz-verified) | S | ✅ DigitSum 20s→30ms (=1351546), serialization 9s→23ms, 647 tests green |
| 2.9 | SYM P0-9…P0-16 | Type-system sequence (strict order): reduceType kinds → negation-subtype meet → refineSymbolType meet → closure-handler sweep → three-valued isInteger/isRational per D3 | common/type/{reduce,subtype}.ts, assume.ts:804, library/{arithmetic,type-handlers}.ts, boxed-symbol.ts:658 | O | ✅ grid 76→0 in-scope violations, 24/24 regressions, suites green · residuals noted: boxed-function generic fallback (deferred by design), Factorial/Round/Gamma out-of-scope grid rows (P1-14 class), Tan/Sec pole typing (documented) · Totient signature relaxed by F (+ integrality guard) to restore 4 Fungrim rules |
| 2.10 | SYM P0-2, SYM P0-4 | onBranchCut three-valued per D3; even-power ln routing → n·ln\|x\|; realness gates per D4 | function-properties/index.ts (3-valued onBranchCut + `isEligibleRealRewrite`), boxed-function.ts ln region, simplify-{log,power,abs}.ts | O | ✅ 26 new tests, 3 bug-locking tests corrected, convention tests intact · **Option A confirmed by F** (even→n·ln\|x\|, odd/irrational keep D4 convention) |
| 2.11 | P0-19 | Deadline sweep: checkDeadline in combinatorics loops + bignum gamma/zeta kernels; magnitude pre-checks | library/combinatorics.ts, numerics/special-functions.ts (+ bonus Multinomial) | S | ✅ 9/9 hangs fixed (4ms–2s), controls intact, 743+434 tests · DigitSum residual → 2.18 |
| 2.12 | P0-25, P0-26, SYM P0-7 | Canonicalization pair: rationals overflow → BigInt promotion; matrix-typed operands order-preserving; popScope generation bump (+ cache-hit measurement) | numerics/rationals.ts (mul+add overflow→BigInt), arithmetic-mul-div.ts, engine-scope.ts (popEvalContext bump, <2% cost measured), **+ F completion: shared `sortProductOperands` in order.ts + negate.ts rewired (agent-escalated, verified necessary+sufficient)** | O | ✅ 275/275 incl. commutator + json order, 190 LA snapshots unchanged |
| 2.13 | P0-12, P0-16(b–h,j,k), P0-17, P0-18 | Exactness sweep: trig-pole N() checks; remaining float-from-exact sites; Haversine/Hypot N(); negative-log policy (one lane). **Incl. `Log(-1.0,2).N()→NaN`: root cause is the `Log` handler `apply2` lanes (arithmetic.ts:909-925 area), NOT numeric-value.ln — corrected attribution from WP-2.3** | boxed-number.ts, boxed-function.ts:1712 (2.9 residual), library/{arithmetic,trigonometry,statistics,complex}.ts, numeric-value ln | O | ▶ · exactness grid gate |
| 2.14 | P0-9, SYM P0-6 | Arctan2 package: evaluate-handler NaN guards + simplify-rule sign guards (both faces) | library/trigonometry.ts:194-198, symbolic/simplify-rules.ts:693-715 | O | ✅ quadrant table 9/9 ×3 paths, 1618 trig tests |
| 2.15 | P0-10 | Choose/Binomial: k>n → 0, no crash on non-integers, negative-n extension, align siblings | library/combinatorics.ts:15-21/64-77 | S | ✅ value table 7/7 vs sympy · + latent fix: Binomial signature made symbolic-args-safe |

## Wave 3 — Numeric kernels (O implements, **F reviews the math**; mpmath harness ≤2 ulp gate)

| WP | Findings | Package | Model | Status |
|---|---|---|---|---|
| 3.1 | P0-20 | polygamma Bernoulli tail factor + negative-x sign bonus fix | O | ✅ ≤1.79 ulp machine, ≤0.19 bignum (was 1.5e14) |
| 3.2 | P0-21 (+CO-P1-5) | machine zeta: Borwein Prop.1 dₖ; compiled target shares kernel; + Zeta(1e9) crash guard bonus | O | ✅ ≤1.29 ulp (was 1.1e9) |
| 3.3 | P0-22, P0-23 | besselK Steed CF2 + DLMF 10.40.2; besselI alternating signs | O | ✅ ≤4.00 ulp (K2(20) was factor-21 wrong) |
| 3.4 | P0-24 | Airy DLMF 9.7 P/Q pairs, double-double phase/Maclaurin | O | ✅ ≤2.55 ulp grid −30..100 |
| 3.5 | NU-P1-1 | applyN: machine-lane results boxed as MachineNumericValue (float contagion, honest digits) | O | ✅ |
| — | — | tolerances tightened to 1e-12 + masked cases added (250 tests, was 220) | (in 3.x) | ✅ |

## Fable-owned

| WP | Findings | Task | Status |
|---|---|---|---|
| F.1 | SYM P0-5 | match.ts sequence-wildcard `ops` corruption → full snapshot/restore around each retry; **+ second bug fixed: `captureWildcard(…) ?? savedSubstitution` swallowed repeated-wildcard conflicts (fail-open)** | ✅ 7/7 gate (repros + conflict cases + 80-case property fuzz), 18 matcher/rules/packs suites green, typecheck clean · 1 stale ODD_TRIG snapshot from round 1 corrected (rule-dispatch-regression.snap) |
| F.2 | P0-3 | limit engine: cancelling ln/√ differences combined before ranking (`combineCancellingPairs` in limitDispatch: ln u−ln v → ln(u/v), √u−√v → conjugate quotient, guarded on eventual positivity) | ✅ 4/4 wrong cases now exact (1, 2, +∞, 0) + bonus exact 1/2 & ln 2 + nested e^{…} case · 11/11 suite incl. 6 new regressions + calculus corpus green · typecheck clean |
| F.3 | — | per-cluster review gates (/code-review) before anything is handed to the user for staging | ongoing |

## Wave 4 — P1s (queued; re-prioritize after P0s)

Highlights, by cluster (full lists in the findings docs): SYM fail-open rule-condition
cluster (P1-1/7/8/10, one PR) · D2 implementation (~30 operators) · lenient-parser cluster
(PA-P1-4/5 need an F decision on the `x2→x²` rule) · comparison P1s (CM-P1-1…5) ·
numerics precision P1s (NU-P1-2…11) · compile P1 clusters (Python target, GPU emitters) ·
assume/verify P1s (SYM P1-2…6) · corpora P1s (CR-P1-1…4).

## Wave 5 — Harness adoption + docs (S)

Port to opt-in/nightly jest suites: exactness grid (~2,000 cells) · type-soundness grid
(~1,600 checks) · mpmath kernel harness (~1,000 cases) · JS/Python parity fuzz (2,446 pts)
· round-trip battery (~140) · comparison symmetry/totality matrices · assume→verify identity
matrix. Then: NUMERIC-SERIALIZATION.md truth-up, MIGRATION_GUIDE stale limitations,
LENIENT_PARSER contradictions, FINDINGS docs cross-link from ROADMAP.

## Log

- 2026-07-01: Tracker created. Wave 0 decisions D1–D6 recorded. Wave 1 (5 × S) and
  WP-2.1/2.2 (2 × O) dispatched.
- 2026-07-01 (later): Round 1 complete — WP-1.1…1.5, 2.1, 2.2 all ✔ (details in table).
  cot³x snapshot corrected by orchestrator. New WP-2.16 filed (exact integer powers,
  discovered as WP-2.2 caveat). Combined verification gate + review pending before staging.
- 2026-07-01 (round 2): Gate 26/26 green; F review of all round-1 diffs passed (asBigint
  bignum-integer coverage verified empirically). 21 round-1 files staged (user WIP + docs
  untouched). Dispatched round 2: WP-2.3 (O), 2.7 (O), 2.14 (O), 2.15 (S), 2.16 (O) — chosen
  for file-disjointness; WP-2.4 deferred to round 3 (shares compare.ts with 2.3); WP-2.5
  deferred (shares arithmetic.ts with 2.3).
- 2026-07-01: **Round 1 committed by user as `0d944994`** (incl. CHANGELOG.md entries).
  WP-1.1…1.5, 2.1, 2.2 → ✅ verified & landed. Round 2 (2.3/2.7/2.14/2.15/2.16) in flight —
  note: their diffs now sit on top of the commit; stage-when-done protocol resumes (nothing
  staged). Reminder for 2.16 landing: remove the `2^{127}` caveat from the CHANGELOG entry.
- 2026-07-01 (round-2 gate): PASSED — 17 combined suites green (incl. the two
  cross-agent interactions flagged mid-flight: Greater block = 2.7 mid-edit transient;
  Wallis 5/8 = 2.16's correct exactness improvement, snapshot owned & updated by 2.16),
  fresh-process gate 50/50 (round2-gate.ts, incl. Equal-chain direction probes and
  round-1 non-regression), typecheck clean, F diff review of relational `lazy` redesign
  and arithmetic-power complete. CHANGELOG updated (2^127 caveat removed, 8 round-2
  entries added). 22 files staged by explicit path; awaiting user commit.
- 2026-07-01 (round 3): Round 2 committed by user as `aea7045d` → rows promoted ✅.
  Dispatched round 3: WP-2.4 (O), 2.5-interp (S — target side moved into 2.8 to avoid
  emitter-file collision), 2.6 (O, blast-radius-gated), 2.8 (O, absorbs D1 target side).
  F.1 (matcher ops corruption) started by F in-session.
- 2026-07-01 (F.1): matcher fix done by F in match.ts (snapshot/restore + conflict
  fail-closed). Acceptance 7/7 incl. new repeated-sequence-wildcard conflict cases;
  patterns/rules/simplify/solve/fungrim/rubi suites green. Found+fixed one stale
  round-1 snapshot (rule-dispatch-regression: |sin x| now correctly stays Abs(Sin x)).
- 2026-07-01 (round-3 gate, part 1): All four agents ✔. Fresh-process gate 29/30 + 1
  harness artifact (\operatorname{arccot} parses as Multiply — noted, out of scope) =
  30/30 effective. Three flagged failures triaged: smoke N(¾+1e199) + exactness Power(2,127)
  .json = lossless-contract reconciliations (tests updated to assert value, not form);
  ascii-math PRECEDENCE ×4 = D7 decision, snapshots updated. **EL-4 Sum(1/n²,n∈Z⁺).N()→NaN
  bisected via patch -R: fails at pristine aea7045d AND at pre-initiative 9b818ec8 —
  PRE-EXISTING, not ours; filed as new finding below.** Full-suite sweep running.
- **NEW FINDING (pre-existing @ 9b818ec8): `Sum(1/n², n ∈ Z⁺).N()` → NaN / unevaluated**
  (latex-syntax/arithmetic EL-4). Infinite-sum numeric path broken before this initiative;
  candidate for Wave-4 triage (possibly related to the EvaluateAt/derivative commits
  9b818ec8..c98d21a0). Repro: `ce.parse('\\sum_{n \\in \\Z^+} 1/n^2').N().re` → NaN in 12 ms.
- 2026-07-01 (round-3 gate, part 2): Full 140-file suite sweep — SINGLE failure = EL-4
  (proven pre-existing, filed above). User committed WP-2.6 + CHANGELOG as `6ff6e666`
  (and their perf work as `857a0bb5`). Remaining 28 round-3 files (2.4, 2.5, 2.8, F.1,
  F.2, reconciliations) staged by explicit path — awaiting follow-up commit. Rounds
  promoted to ✅ on commit. **P0 waves status: Wave 1 ✅, Wave 2 all 16 packages ✔/✅
  (2.17 interval-runtime follow-up open), F.1/F.2 ✔. Remaining P0 work: WP-2.9
  (type-system sequence), WP-2.10 (onBranchCut/ln), WP-2.11 (deadline sweep), WP-2.12
  (canonicalization pair), WP-2.13 (exactness sweep), WP-2.17.**
- 2026-07-01 (round 4): Round 3 committed by user as `e8a9dd2f` → rows promoted ✅.
  Dispatched round 4: WP-2.9 (O, type-system sequence, grid-gated, boxed-function.ts
  excluded to avoid 2.10 collision), WP-2.10 (O, onBranchCut/ln + realness per D3/D4),
  WP-2.11 (S, deadline sweep incl. original Gamma(1e300) hang), WP-2.12 (O,
  rationals overflow + matrix ordering + popScope generation bump w/ benchmark).
  WP-2.13 + 2.17 held for round 5 (file collisions with 2.9/2.8 areas).
- 2026-07-01 (round 4, in progress): WP-2.12 ✔ — agent fixed rationals overflow,
  matrix-typed operand ordering (canonical+evaluate paths), popScope generation bump
  (benchmarked <2%, Option A); escalated the order.ts/negate.ts completion per protocol;
  F applied it (shared `sortProductOperands`/`isTensorProductOperand` moved into order.ts
  to respect the import direction, both consumers rewired, locals removed). Commutator
  M·P−P·M now symbolic end-to-end. 2.9/2.10/2.11 still in flight.
- 2026-07-01 (round 4): WP-2.10 ✔ — Option A (D4-consistent) confirmed; ln(x²)→2ln(|x|),
  declared-complex symbols excluded from real-only rewrites via shared helper. WP-2.11 ✔
  (see above). Gate watch-list for 2.9 landing: Totient incompatible-type boxing errors +
  Pi.isReal failure observed mid-flight by 2.10 — must be resolved in 2.9's final state.
- 2026-07-01 (round-4 gate): PASSED — fresh-process gate 30/30 (after F's Totient
  integrality guard: `toBigint` coerces, so the loosened signature needed a runtime
  `isInteger === true` gate; caught by the gate's own Totient(1/2) check). Final
  140-file sweep: single failure = pre-existing EL-4. Typecheck clean. CHANGELOG:
  6 round-4 entries. 30 files staged; awaiting commit.
  **P0 PHASE COMPLETE except: WP-2.13 (exactness sweep), WP-2.17 (interval runtime),
  WP-2.18 (DigitSum + huge-exponent serialization) → round 5.**
- 2026-07-01 (round 5): Round 4 committed by user as `1aee83ad`; rows promoted. **User
  granted standing autonomous operation: F gates, stages, AND COMMITS at the end of each
  stage, then continues.** Dispatched round 5 (final P0 packages): WP-2.13 (O, exactness
  sweep + 2.9's boxed-function fallback residual), WP-2.17 (O, interval runtime — pads
  untouchable, enclosure-soundness first), WP-2.18 (S, DigitSum guard + huge-exponent
  serialization). After round 5: Wave-4 P1 re-triage.
- 2026-07-02 (round 5 committed): `8f066479` — WP-2.13/2.17/2.18 landed (6 rows
  promoted ✅). Gate: 19/19 fresh-process, 2.13's full sweep on the complete tree =
  single pre-existing EL-4, typecheck clean. CHANGELOG: 5 entries. **Dispatching Wave 3
  (numeric kernels, one O agent — shared file) + WP-2.19 (S, GLSL preamble).** After
  Wave 3: Wave-4 P1 re-triage (incl. EL-4 itself).
- 2026-07-02: WP-2.19 committed `f9d953ed` (F-completed after 2× watchdog stalls; incl.
  a third preamble bug F found during review: signed point-modulus). Wave-3 kernel agent
  stalled 2× before making src edits (mpmath harness survives in scratchpad/wave3/) —
  re-dispatching FRESH (not resumed).
- 2026-07-02: **Wave 3 committed `e8b2b2b0` — THE P0 PHASE IS COMPLETE.** All 62+ verified
  P0s from both reviews fixed across 8 commits. Agent needed 3 dispatches (2 watchdog
  stalls, session flakiness — harness itself verified fast by F). F review: diff hygiene
  clean, DLMF citations present, deadline guards intact, fresh-process spot checks vs
  mpmath all pass, sweep = single pre-existing EL-4, typecheck clean.
  **Wave 4 (P1) begins: batch 1 = EL-4 (the last red test!), SYM fail-open rule-condition
  cluster (P1-1/7/8/10), corpora P1 cluster (CR-P1-1..4).**
- 2026-07-02 (Wave 4 batch 1): CR-P1-1..4 ✔ (S) — D(Mod(u,c))→u′ a.e.; Quartiles unified
  Moore–McCabe across numeric/bigdecimal/exact paths (IQR tests updated); KroneckerDelta
  unary was copy-pasted Boole logic → three-valued δ_{n,0}; binomial-Sum bounds fail-closed
  (fire under scoped assume). Residual for docs pass: generated OPERATORS.json stale
  Quartiles example (npm run doc). EL-4 (O) and rules cluster (O) still in flight.
- 2026-07-02 (Wave 4 batch 1, cont.): SYM P1-1/7/8/10 ✔ (O) — conditionHolds() routes
  rule conditions through isVerifying; NotEqual gains sound bounds-distinctness entailment
  (verifying-mode only); :notzero/:notone/:notreal/composite/irrational fail-closed;
  replace-fn throws log-and-skip; \in\Z-family shortcuts fixed (incl. intger typo,
  nonzero→notzero). **F ruling: single-bad-rule skip-and-warn (was throw) approved** —
  consistent with the multi-rule contract. Zero simplify-suite churn. New pre-existing
  limitation filed: :composite/:prime decide only on literals (not value-bound symbols).
  EL-4 agent still in flight.
- 2026-07-02 (Wave 4 batch 1 committed `b5a0bb37`): EL-4 fixed (Element-branch never
  yielded → deadline bypass + exact accumulation blowup; infinite domains now numeric,
  symbolic bodies symbolic) — **FULL SUITE GREEN: 10348/0**. New finding filed: unbraced
  `\Z^+` → PseudoInverse(Integers) misparse.
- **D8 (lenient digit-suffix + set superscripts).** Lenient `x2` → subscript `x_2` per
  LENIENT_PARSER.md's own recommendation (fixes index-destroying `x1→x`); lenient bare
  `sin x` applies the function; superscript +/−/* on set symbols (Z/R/N/Q/C) = signed-set
  modifiers — PseudoInverse only for matrix-typed bases.
- Dispatching batch 2: parser cluster (O: PA-P1-2/3/4/5/6 + \Z^+ per D8), comparison
  cluster (O: CM-P1-1..5), D2 float-args-numericize sweep (S: ~30 operators per D2).
- 2026-07-02 (batch 2, cont.): parser cluster ✔ (O) — D8 subscripts (x2→x_2, doc synced),
  bare `sin x`, `[1,...,10]`→Range, chained ≠ pairwise via chain machinery, `\Z^+`→
  PositiveIntegers (PseudoInverse only for non-set bases), invisible-operator 2-line fix
  kills silent Tuple for function/matrix-typed operands (auto-declaration convention
  out-scoped as debatable churn — correctly). Gate watch: `\tan(90−ε)°` + 11 arithmetic
  exact/inexact deltas must be owned by D2's report. Comparison + D2 agents in flight.
- 2026-07-02 (batch 2, cont.): comparison cluster ✔ (O) — CM-P1-1..4 fixed (isSame now an
  equivalence relation: 0 violations on the property matrix; eq() canonicalizes noncanon;
  cmp() tolerance unified; ExactNumericValue.eq at working precision with zero matcher
  fallout). CM-P1-5 escalated as contract fork → **F ruling D9: keep the P0-30
  truth-under-constraints contract; stochastic disagreement degrades to undefined (only
  refutes identity), stochastic agreement stays pragmatic true.** F implemented D9 in
  compare.ts (3 lines + rationale). D9 verification + stochastic-equal test updates
  deferred to the batch gate — the D2 agent's live mid-edit (isExactForPow ReferenceError
  in arithmetic.ts) currently breaks all eq()-dependent suites.
- 2026-07-02 (batch 2 committed `3991940c`): D2 sweep ✔ (S — ~36 operators via shared
  `shouldNumericize`; Gaussian-integer isExactNumber predicate caught 2 own regressions;
  ⚠ agent self-reported one `git stash`+`pop`, no loss, surfaced to user), parser cluster ✔,
  comparison cluster ✔ + D9 implemented by F. Gate: 3 contract-consequence test updates
  (x²vs x³ → undefined per D9; (x+3).isEqual(0) ×2 → undefined per D9; @fixme tan-degrees
  snapshot eval==N per D2, value unchanged & hand-verified). Full sweep green, typecheck clean.
- 2026-07-02 (round 6 dispatch): Batches 3+4+5 dispatched in PARALLEL (file-disjoint):
  batch 3 (O, SYM P1-2..6 assume/verify — assume.ts/engine-assumptions.ts), batch 4
  (O, CO-P1-1..4 compile — compilation/**, engine-compilation-targets.ts), batch 5
  (O, NU-P1-2..10 numerics — numerics/**, big-decimal/**, arithmetic-power.ts; priority
  order 7/8→10→5→6→4→9→3→2, NU-P1-2 descope-to-honest allowed). Note: `src/big-decimal/**`
  WIP exclusion is MOOT — user's perf work landed (857a0bb5), tree clean at dispatch.
- 2026-07-02 (round 6, cont.): batch 4 ✔ (O) — CO-P1-1 Python target all made-to-work
  (Py conditional exprs + float('nan'), and/or/not keywords via WORD_KEYWORD_OPERATORS
  exclusion in base-compiler, chainOp per target, vars/folding aligned to JS, `python`
  name registered); CO-P1-2 GPU (loop-form Sum as sub-expression now FAILS CLOSED per D6
  via `bareStatementBlocks` guard; Loop counter float(i)/f32(i); WGSL Argument→select;
  variadic Min/Max→nested); CO-P1-3 complex-into-real-helpers fail-closed
  (COMPLEX_TRANSPARENT_HEADS allowlist) + JSDoc note; CO-P1-4 Equal/NotEqual tolerance
  baked at compile time on JS+Python (GPU stays exact `==` — bounded decision, interval
  targets untouched). New compile-python-parity.test.ts runs emitted code through venv
  python3 (22/22). 842 compile tests green, typecheck clean, 2 intended Loop snapshots.
  Batches 3 (assume/verify) and 5 (numerics) still in flight.
- 2026-07-02 (round 6, cont.): batch 3 ✔ (O) — P1-2 n-ary Less decompose-and-recurse in
  assumeInequality (same-op chains stay n-ary post-flattenComparisonChain — mixed chains
  became And); P1-3 root-type check fixed (per-root vs def type, explicit-declared only)
  + multi-root value assignment REPLACED (equation stored as DB fact, x stays symbolic —
  measured ZERO blast radius, no test relied on the List value; flag for user awareness);
  P1-4 verify() direct DB lookup via ask under _isVerifying + ask diff built with .sub()
  to mirror storage; P1-5 B2b flipped-form lower-bound queries + index.ts docstring now
  actually works; P1-6 case-3 + refineTypeIfUnknown shadow into current scope. 11-case
  assume⇒verify identity battery. 7 suites 836 pass; full suite green at agent's own
  final state; typecheck + whole-src tsc clean. GATE WATCH: 3-4 late failures observed
  by batch 3 in numerics-owned files (numbers RT-P0-3 complex 40-digit truncation,
  rule-dispatch √997 exactness snapshot, type-soundness binary arith, latex infinite
  series) = batch-5 mid-edit WIP — must be owned/resolved by batch 5's final report.
- 2026-07-02 (round 6 committed `0c77c670`): batches 3+4+5 landed. Batch 5 ✔ (O) —
  all 9 NU-P1s (nthRoot kernels w/ integer snap, Root(-4,4) symbolic, LambertW round,
  acos half-angle, adaptive cos/tan guards, pow ladder guards, erfInv-on-erfc, 2F1
  term-count bound, complex honesty attempt). **F GATE CAUGHT 3 BATCH-5 REGRESSIONS**
  (batch 3's watch-list flags were real, not transients — batch 5 never ran those
  suites): (1) `Root(x, non-integer)`→NaN (nthRoot lanes fed float degrees;
  BigDecimal.nthRoot rejects non-integer BEFORE its zero check → even Root(0,0.5)
  NaN'd; fixed w/ integer guards + pow fallback in both lanes); (2) NU-P1-3
  constructor-level 17-digit rounding BROKE lossless complex .json (RT-P0-3, a P0
  contract) AND destroyed 33 genuinely-correct digits of Sqrt(2+3i) — REVERTED, then
  F found the REAL NU-P1-3 root cause: machine-double contamination in complex bignum
  ops (`b*b` double-squared in ln/exp/sqrt/abs/pow/root moduli; machine cos in
  negative-base-power phase; exact 2P-digit muls never rounded) — fixed at the 7
  computation sites; Ln(1.1+1.1i)@21 + Sqrt(2+3i)@50 now match mpmath to ALL digits
  (better than the agent's honest-but-short display fix); (3) √997 snapshot = genuine
  improvement (2e-98→exact 0), updated. F also tightened batch 3's P1-3 contradiction
  check (every→some: one compatible root suffices — x:natural + x²=4 is satisfiable).
  Gate: fresh-process 34/34 (round6-gate.ts, all three batches + F fixes), full sweep
  exit 0, typecheck clean, madge clean, no console.log leftovers. CHANGELOG: 8 entries.
  LESSON for future rounds: an agent's "all touched suites green" ≠ regression-free —
  the gate MUST run the suites the agent did NOT touch (type-soundness, numbers,
  rule-dispatch caught all three).
- 2026-07-02 (round 7 dispatch): FOUR parallel agents (file-disjoint) on the leftover
  P1s: (1) small-clusters trio (O: SYM P1-13 Pythagorean n-ary pairwise scan in
  simplify-trig; SYM P1-21 Fungrim complex-guard accepts real-typed symbols,
  LOADER-side only; PA-P1-1 remainder \ln²x family sup parsing); (2) validation
  cluster (O: SYM P1-14/15/19/20 — strict-mode validateArguments after canonical
  handlers, user-signature enforcement, function-literal result-type honesty +
  Sum/Map operand checks; blast-radius-gated per finding; P1-19 folded here to avoid
  Sum-file collision with types agent); (3) type lattice (O: SYM P1-16/17/18 —
  covering unions, expression<Op> symbol gate, bounded-numeric values/meets;
  common/type/** only); (4) round-trip trio (O: RT-P1-1 √3/2 json round-trip by
  smaller-blast-radius mechanism, RT-P1-2 dict isSame, RT-P1-3 doc/comment truth-up).
  Deferred to Wave 5 (docs): SYM P1-11/12 (convention documentation). Already done
  earlier: PA-P1-2/3/4/5 (batch 2 + D8). Every agent instructed to run the
  round-6-lesson neighbor suites (type-soundness, numbers, rule-dispatch,
  latex-syntax/arithmetic).
- 2026-07-02 (round 7, cont.): type-lattice agent ✔ (O) — P1-16 covering unions
  (COVERING_UNION_MAP + reduceUnionType collapse finite_X|non_finite_number→X, whole
  numeric tower, meet(real,complex) locked test preserved); P1-17 symbol⊂expression<Op>
  gated to Op===Symbol; P1-18 value-in-range subtype + bounded-numeric meet =
  range intersection (incl. range∩bare-primitive; disjoint→nothing now CORRECT).
  889 type tests green; neighbor deltas all attributed to concurrent WIP by
  restore-HEAD bisection; madge clean. GATE WATCH: (1) box.ts:705 `result.ops!`
  typecheck error = validation agent mid-edit — must be resolved in its final state;
  (2) fungrim-loader 9 failures seen flaky/state-dependent in isolation — re-check
  after small-clusters agent lands; (3) noted lattice inconsistency residual:
  real⊄complex vs covering identity (relates to P1-21) — candidate future decision.
- 2026-07-02 (round 7, cont.): small-clusters agent ✔ (O) — P1-13 Pythagorean pairwise
  scan keyed on trig arg, all 4 sibling identities generalized (sin²+cos²→1 incl.
  shared-coefficient a·sin²+a·cos²→a, tan²+1→sec², cot²+1→csc²; sin²x+cos²x+y→1+y,
  two-pair sums→2); P1-21 Fungrim complex guard accepts real-typed finite symbols
  (loader.ts:157-166, `isFinite !== false && type.matches('real')`) — measured
  43→171 firing on the 171-rule clean slice (704/1383 rules carry complex guards),
  HH-guard (Im τ>0) correctly still blocks plain reals, ∞ literals stay undecided;
  PA-P1-1 remainder = ALREADY DONE in a prior round (parseFunctionSup family,
  verified all 5 forms + latex 35 suites/1132 green). Neighbor failures all proven
  concurrent-WIP by revert-to-HEAD (same box.ts mid-edit as types agent flagged).
  Validation + round-trip agents still in flight.
- 2026-07-02 (round 7, cont.): round-trip agent ✔ (O) — RT-P1-1 via option (a):
  unit-numerator Divide/Negate serialization special-cases removed so (±1/d)√r uses
  the general Multiply(Rational,Sqrt) form that re-folds (BOTH toJSON + serialize
  paths kept consistent); round-trip identity ce.expr(x.json).isSame(x) verified on
  8-case battery; blast radius exactly 6 snapshots + 1 assertion, each inspected,
  values unchanged (incl. benign 1-ULP N-mach shift via utils re-box). RT-P1-2 dict
  structural same() (order-insensitive, recursive; isEqual transitively fixed; 9
  tests). RT-P1-3 boxed-number json comment rewritten to the now-true lossless
  contract; docs/NUMERIC-SERIALIZATION.md already accurate. Neighbor suites green
  (1367 tests). GATE: all remaining tree noise (40 fails in parallel run incl.
  function-literal/lambda/type-checking/fungrim-count clusters + box.ts typecheck
  ×5) attributed to the STILL-RUNNING validation agent — final gate blocks on it.
- 2026-07-02 (round 7 committed `be3311db`): all four clusters landed. Validation ✔
  (O, P1-14/15/19/20 — post-canonical checkNumericArgs re-validation gated on
  allParamsNumeric; user-signature enforcement for closed operands w/
  signatureHasComplexParam skip; big-op bound checks; function-literal type honesty;
  P1-19c Derivative typing residual documented in calculus.ts; blast radius: full
  suite 10927/1, zero snapshot deltas). **F GATE CAUGHT 1 CROSS-AGENT REGRESSION**:
  the RT agent's Multiply-form serialization broke matcher semantics (a literal's
  structural view IS its .json → Divide-form patterns everywhere stopped matching
  radical literals; fungrim 3c1021 was the canary — every agent proved only its OWN
  innocence, "pre-existing" claims all meant "not mine"; F bisected via patch -R:
  green at HEAD → regression). F implemented RT-P1-1 option (b) instead:
  canonicalDivide folds exact÷exact to the exact literal (incl. rationals; floats
  excluded), round-trip identity holds, Divide-form json + matcher + display all
  preserved; serialization hunks fully reverted (exact-numeric-value.ts +
  serialize.ts back to HEAD). Net snapshot delta vs HEAD: one 1-ULP N-mach shift
  (√(5/7) → rationalized literal √35/7, mpmath-verified). Gate: 29/29 fresh-process
  (round7-gate.ts, archived), full sweep exit 0, fungrim 107/107, typecheck+madge
  clean. CHANGELOG: 7 entries.
- 2026-07-02 (Wave 5 dispatch): TWO parallel agents. (1) Nightly harness adoption (O):
  test/compute-engine/nightly/ gated on CE_NIGHTLY=1 (describeNightly pattern, no
  jest-config change) + package.json test:nightly script — exactness grid, full
  type-soundness grid, mpmath kernels (static pinned refs, no runtime python),
  round-trip battery, comparison matrices, assume⇒verify matrix, JS parity fuzz;
  known-residual cells get named test.skip entries, new failures reported not fixed.
  Sources: reviews-archive/ + the surviving fcb60263 scratchpad (copies into repo).
  (2) Docs truth-up (O): P1-11 generic-value canonicalization (ARCHITECTURE.md +
  SIMPLIFY.md per D4), P1-12 generic-real policy centralized in SIMPLIFY.md,
  MIGRATION_GUIDE_0.60.0 stale limitations, LENIENT_PARSER sweep, ROADMAP
  forward-looking update, npm run doc regen (stale Quartiles), CHANGELOG structure
  hygiene. All doc claims probe-verified; doc/ (gitignored) and cortexjs.io untouched.
- 2026-07-02 (Wave 5, cont.): docs agent ✔ (O) — P1-11 generic-symbol-canonicalization
  section (ARCHITECTURE.md, probe-verified incl. the CORRECTED constant-protection
  behavior: 0/(1-1)→NaN not 0); P1-12 generic-real policy centralized in SIMPLIFY.md
  (three-case probes: unconstrained/complex-declared/assumed-positive; mechanism =
  isEligibleRealRewrite type check); MIGRATION_GUIDE §7 compile limitations rewritten
  (Loop + defint now compile — probe-verified); LENIENT_PARSER: 4 stale [Review]
  claims corrected (multi-digit/neg exponents, **, oo, cbrt); ROADMAP forward-looking
  update (+D10 and P1-19c carried; fixed stale ln(x²) claim); npm run doc regen —
  NOTE: OPERATORS.json is NOT regenerated by npm run doc (standalone generator
  src/math-json/scripts/generate_OPERATORS.ts); Quartiles example fixed but the file
  was long-stale → ~1381-line legit regen (+CATEGORIES.json +110) — F decision:
  commit generated regen SEPARATELY from docs truth-up; CHANGELOG examined, no change
  needed (1 partial overlap flagged for release-notes time). SIMPLIFY.md legacy
  header left (scope). Nightly-harness agent still in flight.
- 2026-07-02 (Wave 5 committed `ee65fcae` + `732cf2f7` + `569a8d0f`): docs truth-up
  (P1-11/12 documented per D4, migration-guide compile limitations rewritten,
  LENIENT_PARSER 4 stale claims, ROADMAP forward-looking + D10/P1-19c carried),
  generated OPERATORS/CATEGORIES regen (separate commit — long-stale, Quartiles
  fixed), nightly harnesses adopted (7 suites, CE_NIGHTLY=1 / npm run test:nightly,
  566 pass ~2s, default sweep skips in <1s; known residuals as named skips).
- 2026-07-02 (EX-15 fixed, committed `7032acfb`): the nightly grid's first catch —
  toBigint machine lanes threw BigInt(Infinity) RangeError out of evaluate() for the
  12-function integer-domain family; now returns null per contract (stays symbolic).
  Nightly allowlist removed (no-throw asserted directly); always-on regressions in
  number-theory.test.ts. Full sweep + nightly + typecheck green.
  **THE FINDINGS-IMPLEMENTATION INITIATIVE IS COMPLETE: all P0s, all P1s, harness
  adoption, docs. 17 commits total. Remaining (optional): P2/P3 sweep; open
  decisions: D10 real⊂complex (retires 2 shims), P1-19c Derivative typing, bignum
  Arccos endpoint cancellation (nightly skip), CHANGELOG release-notes overlap.**
- 2026-07-02 (round 8 dispatch — TAIL PHASE round 1): FIVE parallel agents (file-disjoint):
  (1) assumptions cluster (O: perf P2-3 FactIndex sign convergence = SYM P2-7, SYM P2-8
  bounds→eq/verify incl. CORRECTNESS P2-14, P2-9 atomic assumeConjunction, P2-10 forget()
  value defs, P2-11 domainToType coverage, P2-12 ExpressionMap.delete — assume.ts,
  engine-assumptions.ts, compare.ts, expression-map.ts, utils.ts); (2) type lattice
  (O: **D10 real⊂complex** + retire 2 shims [fungrim-loader real-guard, box.ts
  signatureHasComplexParam] + SYM P2-20 union flatten/order, P2-21 negation nothing/never,
  P2-22 isPrimitiveSubtype agreement, P3-5 doc comments — common/type/**); (3) Rubi/packs
  (O: SYM P2-26 driver re-entry snapshot/restore, P2-27 ln(e) Divide fold, P2-28
  separation regression test, P3-9 loader report, P3-11 memo policy — rubi/**,
  simplify-log); (4) perf P2-5 remainder (S: Bernoulli slice-to-minTerms; bignumRe memo
  + apply cascade verify-only); (5) library small bugs (S: Intersection wrong EmptySet,
  Reverse crash, Ln(-0.5) probe, non-strict missing-arg print — sets.ts, collections.ts,
  validate.ts). SYM P2-25 (Digamma cost-gate) deferred to round 9 — fungrim/loader.ts
  collision with D10 agent. Held for later rounds: P2-2 re-scope (after D10 settles),
  P2-1/P2-4 (riskiest, attempt last or drop), D11 (box.ts collision with D10 agent),
  correctness P2 clusters (parse/serialize, canonicalization, numerics, compilation).
- 2026-07-02 (round 8 gate): ALL FIVE agents ✔. Highlights: (1) assumptions — FactIndex
  sign path ~5.6× + strictly sharper (Range(1,10)⇒positive), bounds→eq/cmp/verify,
  atomic conjunction via trial-scope, forget() provenance, signed-set decomposition,
  30 new tests; (2) **D10 LANDED**: real⊂complex via PRIMITIVE_SUBTYPES (tower =
  integer⊂rational⊂real⊂complex⊂number, closure-derived tables coherent), shim 1
  (fungrim real-guard) RETIRED (107/107, count 1383 restored), **shim 2
  (signatureHasComplexParam) NOT retired** — blocker: Multiply widens √2·i to
  finite_number⊄complex; `finite_number⊂complex` tried and reverted (breaks compiler
  real/complex gate, 12 parity failures — SYM P2-23 tension confirmed); shim rewritten
  to D10-correct predicate; **follow-up filed: sharpen Multiply inference so
  real×imaginary → imaginary** (then retire shim 2); + P2-20 union flatten/lex-order,
  P2-21 !any→never/!never→any (!nothing stays irreducible — documented), P2-22
  agreement test over full primitive grid, P3-5 doc comments; (3) Rubi — re-entrant
  int() inherits deadline + snapshot/restore, ln(e) Divide fold root cause =
  evaluateNumericSubexpressions BASIC_ARITHMETIC gate (narrow Ln/Log fold added;
  broader fold rejected for blast radius), separation pinned by test, loader report
  honest, memo cleared per top-level call; (4) P2-5 UPGRADED TO CORRECTNESS BUG:
  ce._cache never rebuilt Bernoulli table after first build → precision escalation
  gave wrong digits from ~170/300 (Γ probe); engine-scoped WeakMap rebuilt inline,
  capped absolute bonus (flat ×1.5 rejected: superlinear build cost blew 2s deadline
  @ precision 1000), slice-to-minTerms honored; bignumRe memo verdict: immutable in
  practice but convention-only → documented, not memoized; (5) library — Intersection
  root cause isFiniteIndexedCollection false for Set → contains(); SymmetricDifference
  had NO evaluate handler (added); Reverse sentinel never-true (fixed); non-strict
  missing-arg CRASH class (Negate()/Sqrt()/Power(2) threw; 3 fastpaths now pad
  error('missing'), byte-identical to strict); Ln(-0.5)/Ln(0) probes = already fixed
  (WP-2.13), shadowed simplify-log dead branch aligned.
  GATE: fresh-process 32/32 (round8-gate.ts), nightly 566/566 (+1 known skip),
  typecheck + madge clean, strays cleaned (.orig/.rej incl. verified subtype.ts .rej
  was a redundant re-apply, live file intact). ONE unclaimed failure bisected by F:
  operators.test.ts Divide(2,3,4)→\frac{1}{6} fails at pristine HEAD (all round-8 src
  reverted) = round-7 canonicalDivide exact-fold consequence that escaped the round-7
  sweep; inline snapshot updated with citation (value 1/6 correct). limit/timeout NaN
  interaction + fungrim count deltas + simplify log-rule failures all confirmed
  mid-edit transients — green on settled tree.
- 2026-07-02 (round 8 committed `72f3a353`): 33 files. Sweep re-run clean (first run's
  special-functions timeout = self-inflicted contention: F ran number-theory/nightly
  concurrently with the background sweep; also first sweep's exit code captured tail's,
  not jest's — fixed the capture pattern). round8-gate.ts archived.
- 2026-07-02 (round 9 dispatch): FIVE parallel agents (file-disjoint) on correctness P2
  clusters + held-back items: (1) round-trips/parse-serialize RT P2-1..5 + PS P2-6..10
  (O — latex-syntax/**, serialize.ts; probe-first, matcher-lesson briefed); (2)
  canonicalization/comparison C P2-11..13 + CM P2-14..16 (O — arithmetic-add/mul-div/
  power, boxed-number, compare; #12 float-fold policy blast-radius-gated; #13 Root
  reciprocal form, serialize.ts escalate-only); (3) numerics P2-17..22 (O — log guard
  digits, ζ trivial zeros, gammaln/Fresnel machine kernels, ExactNumericValue.root,
  exact-mul tail rounding, warm-process precision leak probe); (4) compilation
  P2-23..26 per D6 (O — --3/reserved words/chained-relation double-eval, divergence
  alignment, Monte-Carlo doc + realOnly booleans, negative parity corpus points); (5)
  fungrim P2-25 'transform' tag + de-vacuous test + sibling audit, AND **D11
  implementation** (inferred/widenable juxtaposition auto-declaration, locked repro:
  post-gcd(12,8) assign('d',5) recovers) (O). Remaining for round 10: corpora P2-27..30,
  SYM simplification P2 #1-6, perf P2-2 re-scope (D10 settled), P2-1/P2-4 last-or-drop,
  then LAST the benchmark baseline regen capstone.
- 2026-07-02 (round 9 gate): ALL FIVE agents ✔ (numerics agent needed one resume after
  an API connection drop — no work lost, drop was during probe phase). Highlights:
  (1) parse/serialize — \binom added, ==/!= evaluate (factorial adjacency guard),
  x^2^3 → error (was silent List broadcast), Sequence digit-fusing fixed, set-builder
  Colon nesting fixed, toMathJson exclude for literals; 1e300/−0 documented as
  limitations; (2) canon/compare — #12 float-divide exact-minting gated (zero blast),
  #13 negative-index Root → 1/Root at 4 chokepoints (+ pre-existing 8^(−1/3) crash
  fixed), #15 primitive/boxed isSame parity, #16 tensor isEqual tolerance + NaN docs;
  **#11 Gaussian-exactness ESCALATED — filed as open decision (D12 candidate):
  exact Gaussian integers need ExactNumericValue im support or isExact⟹asExact
  relaxation (~57 consumers)**; (3) numerics — log guard digits, ζ(−2k) exact 0,
  gammaln Lanczos-log ~15.7 digits, Fresnel cutoff 36974→6e15 w/ exact Dekker phase
  (old bignum test had LOCKED the bug — rewritten), ExactNumericValue.root 3 defects
  (incl. bonus radical-drop: (8√3)^(1/3)→2), bignumRe tails rounded (machine lane
  now correctly-rounded double), #22 warm-leak CURED by round-8 Bernoulli fix
  (locked); (4) compile per D6 — −−3 fix (un-flagged a KNOWN_COMPILE_BUG case), GPU
  reserved words fail-closed, chained-relation single-eval via bindExpr hook, JS
  dynamic 0^0 NaN + Which/When throw (Python/GPU = documented divergences,
  proportionality), realOnly booleans→NaN, +14 negative parity corpus points; (5)
  fungrim 8 Digamma specific values 'transform'-tagged (Zeta/AGM correctly left),
  test de-vacuoused; D11 via inferred declare at invisible-operator.ts ×4 sites +
  assignFn union-adopt fix. F GATE: 4 canonical-form inline snapshots fell through
  the attribution gap (all = numerics' correctly-rounded machine doubles, verified
  vs fresh node computation, updated); RT P2-5 (2^100 exact) verified cured + F
  locked regression test; @fixme Multiply-One-inexact snapshot delta inspected =
  single non-fixme N-mach line, justified; fresh-process 30/30 (round9-gate.ts),
  typecheck + madge clean. Residuals filed: machine gamma() mid-range ~12 digits
  (separate snapshot-heavy decision), complex Log im machine-double representation,
  Python dynamic 0^0 divergence (documented).
- 2026-07-02 (round 9 committed `f5e0e339`): 48 files, sweep 0 failures (honest exit
  capture), nightly 573, round9-gate.ts archived. Dispatching round 10 (final code
  round): (A) corpora P2-27..30 (O — wester grading, Gruntz limit deadline,
  CancellationError at public boundary, subs into lazy collections, Power(0,0)
  consistency); (B) simplify P2 #1-6 scoped (O — because-label→purpose-tag mechanism
  swap, rules:null honored, recursion-doctrine documentation + cheap perf sites,
  ln-ratio bigint, sin/cos addition rule blast-gated, fu=report-only; + P3-12 stale
  test cleanup); (C) perf P2-2 isSubtype memoization re-scoped post-D10 (O —
  reference-type exclusion, benchmark evidence; + P3-4 [type]^(dims) parse, P3-6
  named-tuple erasure); (D) assumptions/fungrim P3 batch (S/O — P3-1 verify strings,
  P3-2 verifyInner dead recursion, P3-3 contract docs, P3-7 uniform finiteness
  convention [F DECISION: `isFinite !== false` required on ALL type guards —
  fail-closed only at actual ∞ instances], P3-8 shell re-declaration on reload,
  P3-10 member-guard Union mangling). After round 10: P2-1/P2-4 attempt-or-drop
  decision, then the benchmark regen capstone.
- 2026-07-02 (round 10 gate): ALL FOUR agents ✔. (A) corpora — wester grading honest
  (6 defint flips unsolved→correct-vs-reference, 0 regressions; report NOT regenerated),
  Gruntz limits 18min→4ms (deadline sweep in limit.ts + machine-float growth probes),
  CancellationError caught ONLY at the outermost arming frame (withDeadline onTimeout
  → inert form; internal unwind preserved), defint error-bar documented-not-fixed
  (needs tanh-sinh), subs gap = BoxedTensor inherited no-op base (delegates to
  structural form now; integral bounds already worked), 0^0 N-path NaN guard;
  (B) simplify scoped — #1 mechanism swap w/ exemption-set identity (zero deltas),
  #2 rules:null honored, #3 inventory: 1 removal + sanctioned-exception header block,
  #4 bigint (ln(2^60+1)/ln2 counterexample locked), #6 sin-addition ON DEFAULT PATH
  (tight ±1 gating, zero churn), #5 fu report-only, P3-12 4 unskips + wrong log_c
  test deleted; (C) **P2-2 CLOSED — HONEST REVERT**: built, measured (6 distinct
  cacheable pairs ever; cache slower than the checks), reverted per charter; .def
  mutation post-construction confirmed (string-key collision real); P3-4 docs
  truthed (no bracket production exists), P3-6 named-tuple erasure; (D) P3 batch —
  verify/assume strings (public sigs widened), verifyInner live recursion (2 new
  decided cells, 0 regressed), ARCHITECTURE.md assumptions section, P3-7 uniform
  `isFinite !== false` guard gate (proved real fail-open: Im(e^{ik}) fired at
  k=+∞ → NaN), P3-8 shell reload, P3-10 Union root cause = evaluate handler
  wrapping inert set-valued ops as singletons. F GATE: fresh-process 20/20
  (round10-gate.ts, 1 probe bug fixed — zz parses as z·z), typecheck+madge clean,
  boxed-tensor mid-flight typecheck errors resolved in final state.
  **F GATE CAUGHT + FIXED A CONTRACT COLLISION (F's own charter error): the #29
  charter told the agent "evaluate() must not throw on timeout" — but the ENTRENCHED
  contract (timeout.test.ts + WP-2.11's own committed guards) is that evaluate()
  THROWS CancellationError on timeout/recursion-limit. The onTimeout catch broke 10
  locked assertions AND the doubly-infinite-sum control flow (relies on internal
  CancellationError propagation). F reverted the withDeadline onTimeout hunk (only),
  kept all other corpora fixes, rewrote the agent's no-throw test to assert
  bounded+well-typed (inert or CancellationError, <10s), and resolved #29 as
  DOCUMENTATION: the throw contract is now in the evaluate() JSDoc
  (types-expression.ts). LESSON: verify a claimed 'public contract' against the
  test suite BEFORE writing it into a charter.** KNOWN FLAKE
  filed: calculus Σ2^n NaN under parallel jest scheduling only (BigDecimal.precision
  process-global cross-file interplay; passes runInBand + isolation — pre-existing).
- 2026-07-02 (round 10 committed `a2b78928`): 30 files. **P2-4 DROPPED (F ruling):**
  touches the load-bearing simplify recursion guards for a diffuse 10-20% on a
  GC-dominated profile; round 10 already churned simplify.ts; bad risk/reward this
  late. **P2-1 ATTEMPTED (final code work):** one O agent — Rubi integrand-skeleton
  second-level dispatch index + Fungrim solve-template feature gate; no rule-order
  change within candidate buckets; verification = rule-dispatch benchmark thresholds
  + wester coverage non-regression + full rubi/fungrim suites. After P2-1: the
  benchmark regen capstone (LAST).
- 2026-07-03 (P2-1 gate): agent ✔. **Fix 1 SHIPPED**: integrand-skeleton index =
  per-root-operator candidate buckets × required-heads screen (`requiredHeads`
  computed per rule at compile time; conservatism proof: Rubi matcher does no
  cross-head synthetic rebuilds — only node-collapse (surviving operand's heads
  kept) and AC reorder (same op); `const` heads deliberately NOT required —
  .isSame() follows value bindings, fail-open). Evidence: **4,965-integral A/B
  byte-identical** (Ch1 2970/30, Ch2 786/179, Ch6 633/367), miss-path 5.36×→2.23×
  (from-source basis; console.assert ≈2× inflation — dist basis ≈ the finding's
  1.2× target), candidate scans 2841→234-590, per-integral up to 8.9×.
  `RUBI_NO_SKELETON` env escape hatch retained. **Fix 2 (Fungrim solve gate)
  MEASURED, NOT SHIPPED**: the +67-250% finding predated round-6 P1-2 (polynomial
  coefficient fast path) — CS1/CS2-class now +0% (never reach templates);
  templates' own cost on non-polynomials = +4.4%; a gate needs reimplementing
  applyRule's pattern path (solve channel {_x} substitution + useVariations can't
  ride functional rules) — high risk for ~4%, dropped per don't-ship-complexity.
  Residual noted: Multiply-bucket family (only {Multiply} required) can't be
  head-screened; finer Power-base classification judged too risky. F gate:
  typecheck+madge clean, fresh-process integrals correct, full sweep pending →
  commit, then THE CAPSTONE (benchmark baseline regen).
- 2026-07-03 (P2-1 committed `8667a0aa`; **CAPSTONE committed `c20a4b2e`**): benchmark
  baseline regenerated end-to-end (build production → gen_cases.py → report.mjs →
  report_changelog.mjs, exit 0). REPORT.md: 7 improvements / 0 regressions vs 0.59.0
  (ζ(3) 40-digit exact where 0.59.0 had 8 wrong digits; √(3+2√2) denests; 4
  antiderivatives fully evaluate), CE 36/39 → 39/39 with packs, median 1.9× faster
  than Mathematica on mutually-solved cases. CHANGELOG-TABLES.md written (gitignored,
  for release notes). api.md regen picked up verify/assume string signatures.
  **INITIATIVE FULLY COMPLETE — see RESUME HERE for the open-items handoff.**
- 2026-07-03 (comparator switch + initiative perf audit): published column re-baselined
  0.59.0 → **0.66.0** (published 2026-06-29, 2 days pre-initiative — the delta isolates
  the initiative's 22 commits). Provisioned .competitors/ce-0.66.0, defaults flipped in
  report.mjs/report_changelog.mjs/README, reports regenerated. RESULT: 0 correctness
  regressions; correctness wins are off-corpus (nightly grids). PERF: median 0.91× —
  5 faster (solve CS2 4.57×/CS1 1.55×, limits CE2 1.57×, D07 1.57×), 24 slower
  (micro symbolic ops 0.6-0.8×; cos(1).N() 0.55×; A06 4.2→6.8ms biggest absolute).
  A/B CPU-profile attribution (cur-vs-pub unminified, d/dx x⁵ loop): tax = TWO clusters
  — (1) validation/type-checking (isSubtype 2×, matches +85%, lookup/peek up; round-7
  P1-14/15 post-canonical re-validation + D10 lattice), (2) ExactNumericValue churn
  (constructions 2×, NEW fromString/fromNumber on hot path, normalize 2×). cos(1) =
  entirely fpsincos 2.3× (batch-5 adaptive cos guard runs unconditionally). Structural
  (BOTH builds, pre-initiative): definition lookup+peekDefinitions ≈ 12µs/iter = the
  largest non-console cost — biggest available ceiling. RANKED FOLLOW-UPS filed: (1)
  re-validation dirty-flag, (2) ENV interning/churn audit, (3) conditional cos/tan
  guard escalation, (4) A06 targeted profile (Ln-fold pass / sin-addition scan
  suspects), (5) definition-lookup cache. Benchmark files left UNSTAGED (user has
  own staged WIP: free-functions.ts + workflow-entrypoints.test.ts).
- 2026-07-03 (perf give-back batch 1 dispatched, user-approved): FOUR parallel perf-only
  agents (zero-behavior gates, honest-revert clauses): (1) re-validation dirty-flag
  (validate.ts/box.ts — skip post-canonical re-validation when canonicalization didn't
  change operands; local not global memo); (2) ExactNumericValue churn (numeric-value/**
  — attribute the new hot-path fromString/fromNumber constructions, eliminate; interning
  only if provably safe); (3) conditional cos/tan guard escalation (big-decimal fpsincos
  — pay guard digits only near cancellation; adversarial mpmath battery is the gate);
  (4) A06 ∫1/(x³+1) profile (simplify — attribute the +2.6ms; suspects: round-8 Ln-fold
  scan, round-10 sin-addition scan; cheap gated fixes only).
  **BATCH 2 QUEUED (user request, after batch 1): arbitrary-precision analysis round —
  (a) P1-1 no-show: BigDecimal bookkeeping fix (857a0bb5, post-0.66.0) shows ~no gain
  on ζ(3)/Γ(1/3)@40d benchmark rows (490→490µs, 322→312µs) — determine whether the fix
  doesn't engage on these paths or initiative overhead offset it; (b) CE-vs-CE+R/F
  numeric-column artifact: CE+R/F consistently 1.5-2× FASTER than CE·cur on pure
  numerics (π² 19 vs 10µs, e 0.92 vs 0.42, ζ(3) 490 vs 407) — packs can't speed up
  ζ(3); run_ce.mjs vs run_ce_rubi.mjs warm-process asymmetry (P0-1/P0-2 residual);
  harness fix so all three CE columns share measurement conditions.**
  NOTE: user has own staged WIP (free-functions.ts, workflow-entrypoints.test.ts) —
  F commits batch 1 by explicit path only, never touching the user's index entries.
- 2026-07-03 (perf batch 1 gate): 2 fixes + 2 decisive attributions. (1) cos/tan guard:
  round-6 adaptive guard had a FENCEPOST — cancellationLoss returns 1 for ANY |result|<1
  (= every cos value), accept test demanded 0 → every non-trivial cos/tan ran fpsincos
  TWICE; fix = TRIG_GUARD_SLACK=5 with soundness proof (≥10 retained guard digits;
  loss≥6 escalation byte-identical); cos(1) 6.66→4.05µs (pub 3.83), 24-case mpmath
  near-cancellation battery pinned. (2) ENV churn: 100% attributed to ONE chain —
  canonicalPower's b.isSame(0.5) probe × (batch-2 eq bignum branch + round-9 #15
  isSame fallback) = 7 BigDecimal-from-string round-trips per d/dx x⁵; fix = gate the
  allocating fallback to non-integer exact values (the only case it can change the
  answer); bignumRe 7→0/iter, d/dx −15.6%, ∫x² −13.6% isolated. (3) A06 = ~83%
  COLD-START (V8 compiling +123KB bundle growth + GC), warm steady-state only +4%;
  Ln-fold + sin-addition suspects CLEARED with evidence; no fix possible ≥5% — closed
  into the broad clusters. Bundle size now a tracked lever. (4) re-validation
  hypothesis REFUTED: post-canonical re-validation never fires on the gate loops
  (makeNumericFunction short path); isSubtype growth = call VOLUME from numeric
  predicates on ENV operands (= the churn fix's path); its own primitive-fast-path
  attempt measured 13-15% WORSE → reverted; residual idea filed: cache
  allParamsNumeric/signatureHasComplexParam per opDef (helps Sin/Gamma-class canonical
  handlers, not these loops). F FINAL A/B (fresh production build, both fixes):
  d/dx x⁵ −22%→−8% vs published; cos(1).N() −44%→−5%. Targeted suites + nightly 573
  green, typecheck+madge clean, sweep running.
- 2026-07-03 (batch 1 committed: `3002360b` comparator switch + `1e50aaf8` perf fixes;
  user's own WIP committed by user as `856e38f1` mid-session, index conflict resolved).
  Sweep 0 failures. **Batch 2 dispatched (arb-precision round):** (1) harness
  normalization (O — benchmarks/** only: diagnose run_ce.mjs vs run_ce_rubi.mjs
  process/warmup asymmetry, align all three CE columns to warm-median in-process per
  the README methodology, regen reports; acceptance = CE-vs-CE+R/F numeric ratio
  collapses to ≈1.0×); (2) P1-1 analysis (O — why 857a0bb5's BigDecimal bookkeeping
  win doesn't show on ζ(3)/Γ(1/3)@40d: hypotheses = wrong lane (fixed-point kernels
  bypass patched methods) / offset by initiative overhead / precision-dependent /
  harness noise; controlled A/B loops at 21-500 digits + profile diff + direct
  engagement instrumentation; cheap fixes only; deliverable = ranked remaining
  arb-precision levers).
- 2026-07-03 (batch 2 gate): BOTH agents ✔. (1) HARNESS: artifact = process warmth —
  ce-current/ce-pub ran cold-per-case (V8 never tiers to TurboFan in ~50 iters) vs
  CE+R/F warm-in-one-process; fix = run_ce_rubi.mjs generalized to 3 in-process engines
  (CE_PUBLISHED_BUNDLE) + 2-pass whole-suite warmup, report.mjs sources all CE columns
  from the warm batch; CE-vs-CE+R/F numeric ratio 1.6-1.9× → **median 1.000×**; honest
  warm numbers show current FASTER than published on every arb-precision row (1.03-1.33×)
  — **P1-1 was real; cold measurement was hiding/inverting it**. Residual documented:
  math.js still cold-per-process (V8, may read slightly high). (2) P1-1 ANALYSIS:
  verdicts — digit-count cache barely engages (11-18% hit, ephemeral series terms);
  the REAL P1-1 lever was the normalize fast-exit (−17% normalize @ζ200); win grows
  with precision (benchmark's 40-50d rows under-sample); old benchmark rows were
  noise (Γ(⅓)@40 "slower" contradicted by controlled −11.6%). **NEW FIX (byte-identical
  proof): div skips normalizing the pre-rounding quotient (always rounded anyway) —
  ζ(3) −34%@200d/−52%@500d vs current, −41%/−56% vs published; normalize 52%→23% of
  ζ(3)@200 self-time.** + digitCount micro-cleanup (pre-seeded frozen constants).
  RANKED REMAINING LEVERS (measured): (1) toPrecision recomputes bigintDigits on the
  unnormalized quotient — derivable from div's known digit counts, ~10-15% more on
  div-heavy kernels (needs byte-identity harness); (2) normalize residual is inherent
  (%10n has no cheaper test) — lever = call it less (audit add/sub/mul for the same
  double-normalize pattern); (3) Γ(⅓)@500 ~23% slower than published — gammaln
  exp+Bernoulli path, suspects: per-call slice(0,minTerms) + raised term budget
  (verify accuracy-required before trimming); (4) bigintDigits bit-length allocs;
  (5) ζ(3) CVZ operand inflation (algorithmic, deep); (6) trivial-kernel rows (√2)
  are boxing-bound not kernel-bound → symbolic/boxing track (+123KB bundle).
  Full sweep + rebuild + final regen chained; **committed `636cc002` (div fix) +
  `8427ef92` (harness normalization + final REPORT). PERF FOLLOW-UP ROUNDS COMPLETE.**
  Final honest state vs published 0.66.0: arb-precision faster everywhere (ζ(3)@40d
  413 vs 471µs, Γ(⅓) 249 vs 290, @high precision up to −56%), micro symbolic ops
  within ~8%, cos(1) within ~5%; CE columns mutually comparable (median ratio 1.000×).
- 2026-07-03 (arithmetic-ops round, ALL THREE agents ✔ — user framing: optimize
  OPERATIONS, kernels are consumers): (1) OPS BENCHMARK (durable progress record,
  benchmarks/big-decimal/): new ops-bench.mjs/py + run-ops.mjs driver + ops-results.json
  sidecar; primitive rows add/sub/mul/div/sqrt/round/normalize-via-ctor/cmp @
  21/50/100/200/500d, columns CE-HEAD/CE-0.66.0/mpmath, consumer rows ln/exp/cos/ζ(3);
  BIGNUM-COMPARISON.md rewritten (rebaselined 0.59.0→0.66.0); findings: div 1.6-2.3×
  vs published (beats raw mpmath at every precision), cmp 3.5-5.5×, add/sub/mul/round
  1.7-3.3×; transcendental KERNELS unchanged since 0.66.0 — the whole release delta
  lives in the primitive layer, exactly the user's thesis. (2) CORE OPS: **lever 1
  SHIPPED** — div derives quotient digitCount (dividendDigits+totalScale−divisorDigits
  ±1, one cached-pow10 compare) via new shared roundToPrecKnownDigits; **div −40..−56%
  further** (0.96→0.42µs @21d), ζ(3) another −21..−36%; 720k-op byte-identity fuzz
  0 mismatches. **Lever 3 SHIPPED** — bigintDigits hex-length seed + ≤2-step settle;
  1,012,004-comparison fuzz 0 mismatches. **Lever 2 NONE-FOUND** (single terminal
  normalize per op; div was the only construct→normalize→round). (3) GAMMALN AUDIT:
  suspects REFUTED — term budget byte-identical to 0.66.0, ZERO extra terms summed
  (196 @500d both), build cost one-time-amortized; the "23% slower" was a stale-dist
  measurement; current is ~24% FASTER @500d; slice removal shipped (hygiene, ~0%,
  caller-clamp invariant verified & documented); Γ cost = ~75% BigDecimal kernels
  (toPrecision 27% pre-lever-1, fpexp 16%, normalize 10%).
  **NEW FOLLOW-UPS FILED:** (F1) pre-existing CORRECTNESS bug: bigintDigits <2^53
  fast path returns 16 for 999999999999999n (15 nines; Math.log10 lands on 15.0) —
  feeds rounding decisions, needs its own mpmath-verified blast-radius pass (both old
  and new code share it; agents correctly preserved byte-identity); (F2) mulToPrecision
  combined API for the cross-call mul().toPrecision() pattern in pow ladder +
  gamma/digamma kernels; (F3) divToward/sqrtToward could use the derived-digit trick
  (colder, interval primitives); (F4) fpexp is the next-biggest kernel consumer (16%
  of Γ) — tracked by the new ops benchmark.
- 2026-07-03 (arithmetic-ops round committed): `60a6837e` (div derived digit count +
  bigintDigits hex seed + Bernoulli slice removal) + `33873c11` (ops benchmark harness
  + rewritten BIGNUM-COMPARISON.md, tables refreshed on the FINAL build, prose trued).
  Final cumulative vs published 0.66.0: div 1.9-4.0×, cmp 3.4-6.4×, add/sub/mul/round
  1.3-3.3×, ζ(3) consumer 2.1× @100-500d with zero kernel changes; div/mul/sqrt now
  beat raw mpmath. Durable record: BIGNUM-COMPARISON.md + ops-results.json sidecar,
  reproduce = `node benchmarks/big-decimal/run-ops.mjs`.
- 2026-07-03 (Mathematica@100d reference committed `d9bacd8a`): ops-bench.wls +
  BIGNUM-COMPARISON.md section. CE wins field arithmetic outright (add/sub 13-15×,
  mul 4.9×, div 2.7×, cmp 36× — WM has a ~1µs kernel-dispatch floor CE doesn't pay);
  WM's GMP/MPFR kernels lead transcendentals (exp 4.3×, cos 2.9×, **ln 22× — the
  active target**); ζ(3) within 1.7× of the native kernel. **Lever round 2 dispatched
  (3 agents):** (A) bigintDigits <2^53 fast-path CORRECTNESS fix (enumerate wrong
  inputs, blast radius incl. cmp early-out, mpmath-verified); (B) normalize ctor-path
  regression root-cause + parity target, mulToPrecision fused API (+ adoption list
  for special-functions as follow-up), divToward/sqrtToward opportunistic; (C)
  fpexp/ln kernel analysis-first (fencepost/double-work pattern hunt; ln small-
  precision gap structural-vs-mechanical verdict — machine-double Newton seed idea).
- 2026-07-03 (lever round 2 committed `86919cf9` + `06ae4343`): (A) bigintDigits
  <2^53 fast path — CORRECTNESS: exactly 2 wrong inputs (999999999999998/9 → 16 not
  15; Math.log10 lands on 15.0); blast radius was REAL: cmp ORDER INVERSION
  (999999999999999 < …999.1 compared greater) + toPrecision(15) corrupting the exact
  value to 10^15; fix = exact comparison ladder vs 1e0..1e15 (correct by construction,
  17-34% FASTER); 11.1M fuzz clean; CHANGELOG Resolved Issue. (B) mulToPrecision
  fused API (pow ladder −12..−16%; special-functions adoption list filed: lines
  451-894 sf.ts + big-numeric-value 431/479/532/659 + arithmetic-power 699 +
  transcendentals 843/846), divToward derived digits (−7..−13%), normalize ctor
  HONEST-UNCHANGED — the "regression" was benchmark-artifact trailing-zero operands
  (39,900 real significands: ZERO enter the strip loop; realistic row: HEAD
  1.6-4.5× FASTER); (C) exp √-depth argument reduction wrapping fpexp (O(√bits)
  terms): exp 1.33×@21d→2.57×@500d isolated, 1.5-3.1× cumulative vs 0.66.0, now
  leads mpmath everywhere, WM@100d exp gap halved 4.3×→2.7×; Γ inherits 1.2-1.3×;
  **ln verdict: STRUCTURAL (Newton-on-exp ≈3 fpexp calls vs mpmath direct log) —
  FOLLOW-UP FILED: fold √-reduction INTO fpexp (utils.ts) so fpln inherits ~1.5-2.5×
  free; deeper prize = direct-log fpln.** Bench hardening: interleaved cell order
  (machine hit load-51 saturation mid-regen — mediaanalysisd/Spotlight/user esbuild —
  old column-outer order let drift inflate one column 4×), normalize row split
  typical/adversarial-tz (tz row awaits first quiet run), tables refreshed with
  provenance-noted clean cells. CHANGELOG: consolidated arb-precision perf entry +
  cmp-inversion Resolved Issue.
- 2026-07-03 (lever round 3 dispatched, user-approved): (A) **ln campaign** (O —
  utils.ts + transcendentals.ts): phase 1 fold √-reduction INTO fpexp (all callers
  incl. fpln's Newton inherit; retire fpexpReduced wrapper; expected ln ~1.5-2.5×
  free), phase 2 direct-log fpln evaluation (atanh+sqrt-shrink vs machine-seed
  correction vs improved-Newton; measurement decides; 1000d/AGM regime must not
  regress); (B) **mulToPrecision adoption sweep** (O — special-functions.ts ×11
  sites, big-numeric-value.ts ×4, arithmetic-power.ts ×1; strict only-use-is-
  toPrecision-same-prec pattern rule; value-identity spot scripts per file;
  transcendentals 843/846 left to agent A). Both load-aware (uptime check before
  timing; interleaved A/B legs). After gate: quiet-machine ops regen incl. first
  normalize_tz measurement.
- 2026-07-03 (user follow-up, F-implemented): multi-line-aware re-grep found the
  wrapped chains the original sweep's single-line grep missed. Complete outstanding
  set: exact-numeric-value.ts:268 (bignumRe — **FUSED by F**: mulToPrecision single-
  round replaces the mul@guard+toPrecision double-round; NOT byte-identical in
  principle [different target vs ambient precision] but 500-case battery byte-
  identical in practice [+10 guard digits make the tie window unreachable]; suites +
  nightly + typecheck green); big-decimal.ts:588 = mulToPrecision's own fallback
  (not a candidate). **QUEUED FOR THE ln-AGENT GATE (transcendentals.ts locked):**
  :814 acos fusion (two.mul(asin)→mulToPrecision, guard-precision class) + the
  ÷2→×HALF sites (:918 sinh, :1187 arctanh — 0.5 is EXACT in decimal, so ×HALF is
  value-identical to ÷2 and turns division machinery into a trivial ×5n; HALF
  constant already exists, pre-seeded). Note :816's product feeds .sub — not a
  candidate; :544 divides by ln(b) — general divisor, not applicable.
- 2026-07-03 (lever round 3 gate, in progress): ln campaign ✔ (O) — **phase 1:
  √-reduction folded INTO fpexp** (3 call sites enumerated, internal guard =
  targetHalvings+8, reduction from actual arg magnitude; fpexpReduced wrapper
  retired); free-ln win 1.4-2.8× (21-500d); **phase 2: fplnDirect ships (candidate
  b, machine-seed log1p series, one √-reduced fpexp + ~bits/96 atanh terms)** —
  candidates raced: (b) beats phase-1 Newton 1.67-3.84×; (a) atanh+sqrt-shrink
  REJECTED (slower than Newton everywhere + 8-18 low bits); Newton removed; AGM
  ≥2300 bits untouched (crossover re-tune = deferred follow-up). Delivered ln
  1.9×(21d)→10×(500d) vs old. **Opportunistic pre-existing accuracy fix**: near-1
  cancellation guard (ln(1−1e−29)@60 was ~57 correct digits IN 0.66.0 TOO — now
  exact). 170-case mpmath ln battery added. mulToPrecision sweep ✔ (O) — 16 sites,
  128-output byte-diff empty, perf A/B honestly declined (load 25-48, negative
  control ±67%; harness parked in scratchpad). F: bignumRe fusion (500-case battery
  identical) + transcendentals queued sites done post-release (:831 acos fusion +
  ÷2→×HALF inside t too, :938 sinh, :1210 arctanh — 72-row battery byte-identical).
  typecheck+madge+targeted+nightly green; full sweep running. REMAINING AT GATE:
  quiet-machine perf verification (sweep-agent harness) + ops regen (normalize_tz
  first row, NEW ln/exp rows — ln vs mpmath and the WM 22× gap need recalc:
  ln@100d ~7.4µs now) + BIGNUM-COMPARISON prose rewrite (ln no longer structural
  laggard) + commit.
- 2026-07-03 (lever round 3 CLOSED: `cd705055` code + `ccfa67b4` doc refresh):
  quiet-machine regen (Monitor-gated, load 4; first regen caught a STALE DIST —
  ln row flat until rebuild). FINAL DURABLE STATE vs published 0.66.0: ln 3.2-8×
  (beats mpmath ≥100d: 500d 47 vs 100µs; WM gap 22×→4.2× @100d), exp 1.5-2.6×
  (leads mpmath everywhere), div 1.9-4.2×, cmp 3.5-6.8×, add/sub/mul/round
  1.3-3.3×, normalize typical 1.3-4.5× (tz adversarial row first-measured: ~20%
  worst-case, as designed), ζ(3) consumer 1.9-2.3×, sqrt leads ≥200d. Parked
  consumer A/B harness superseded by the ops-benchmark consumer rows (harness had
  a node/.ts import issue; not worth fixing). Remaining deferred (low priority):
  AGM crossover re-tune for the faster direct-ln (≥1000d regime), direct-log for
  the <2300-bit… done; nothing blocking. **Arb-precision campaign COMPLETE.**
- 2026-07-03 (AGM re-tune + CHANGELOG tables committed `069dfbd3` + `56b3599f`):
  crossover measured direct-vs-AGM 500→20,000 digits: old 2,300-bit threshold was
  17× too low; pure-speed crossover ≈43,000 bits; **new LN_AGM_MIN_BITS = 40,000
  (~12,040 digits, margin toward AGM)**; accuracy does NOT bound it (direct
  correctly rounded to 14,000d incl. near-1; marginally MORE accurate than AGM at
  the boundary); **ln@1000d 866→155µs (5.6×)**; boundary locked by mpmath-pinned
  flip tests; AGM-window tests moved to 12,100d so they exercise real AGM.
  CHANGELOG gains two release tables (arb-precision @100d and symbolic ops:
  CE-cur/0.66/math.js/NumPy/Mathematica; math.js BigNumber measured fresh @100d —
  40-240× behind CE on mul/div/transcendentals; NumPy n/a float64-only) sourced
  from quiet-machine measurements + REPORT.md regen on the final build.
  **Arb-precision campaign fully closed — no deferred items remain.**
- 2026-07-03 (NEXT-UP round dispatched + decisions): Item 1 (Multiply real×imaginary
  inference + retire signatureHasComplexParam) dispatched to an O agent — in flight,
  zero snapshot deltas reported so far, full-sweep gate pending. **USER DECISIONS
  RECORDED:** (2) definition-lookup = APPROVED, design = measure-first attribution
  (bind()-time `lookup` at boxed-function.ts:218 vs parser-side `peekDefinitions`),
  then pinned core-operator resolution with a SHADOW SENTINEL (frozen boot-time
  name→def table; any bindings.set of a core name outside root scope — or root
  re-declaration — evicts that name to the normal walk; overridability preserved,
  hardcode speed in the common case). **D12 = OPTION A** (exact Gaussian support IN
  ExactNumericValue, not a subclass): each component re/im = rational×√radical;
  closure = Gaussian rationals fully + single-radical pure-real/pure-imaginary forms
  (√2·i); leave-the-set → symbolic fallback, as real radicals today. Perf design
  rules (agreed with user): cached machine `im` DATA field (read path unchanged),
  first-line im-is-zero exits in every op, singleton frozen zero im-component,
  hidden-class monomorphism (all fields initialized, same order). GATE: ops
  benchmark real-only rows within noise + byte-identity fuzz + honest-revert clause;
  rationale vs C: C = whitelist exactness (second-class lane, re-creates the CORR
  #11 leak at every unaudited boundary) + megamorphic IC risk at shared NumericValue
  dispatch sites; A keeps the single exactness funnel and isExact⟹asExact intact.
  ~57-consumer audit transfers to C almost entirely if A gets perf-reverted.
  **SYM P2-23 = OPTION B** (convention, not lattice): handlers claim
  `non_finite_number` only when non-finiteness is PROVABLE; standardize on `number`
  when ~oo/NaN is merely possible; document; lattice refinement deferred until a
  concrete consumer justifies it. SEQUENCING: item-1 agent holds library/arithmetic.ts
  + box.ts → D12-A (numeric-value/** + consumers) and (2) (box.ts/scope machinery)
  dispatch after its gate, in parallel (file-disjoint from each other); P2-23-b
  sequenced after D12-A (both touch library type/evaluate handlers).
- **ARCHIVE:** irreplaceable scratchpad artifacts live in
  [`2026-07-archive/`](./2026-07-archive/) (moved 2026-07-03 from the untracked
  repo-root `reviews-archive/`, now tracked): 8 per-area deep-findings .md (the
  analysis behind decisions D1–D12 and the P2/P3 triage), archival copies of the
  three top-level findings docs, both P0 verification reports, round gate scripts,
  F.1 matcher gate, wave3 mpmath harness + before/after tables. The /private/tmp
  scratchpads do not survive a reboot; this folder does.

## ═══ RESUME HERE (fresh session entry point) ═══
**NEXT-UP ROUND COMPLETE (2026-07-03, later session): items 1–4 all landed** —
`e65eee11` (Multiply/Divide/Power/Ln complex type inference, last D10 shim
retired), `99fa7276` (D12-A exact Gaussian ExactNumericValue + parser
peekDefinitions perf −24–28% + F's assert-gating fix), `c4def410` (SYM P2-23-b
non-finite typing convention + CHANGELOG entries for the round). Details in the
NEXT-UP list above; new residuals filed in item 4's row (Multiply-fold
positivity observation, Artanh-class literal poles, Beta Γ-poles, ~oo-value
lattice question, ∞+i numeric-value getters). NEW closed no-wins: engine-side
lookup pinning (2.3–2.7% ceiling, shadow-sentinel design + write-site
enumeration preserved in item-2 row); measurement lesson: a from-source perf
A/B can be dominated by NEW unconditional console.asserts on hot paths (live
under tsx/jest, stripped in dist) — gate hot-path asserts behind the branch
they protect, and confirm regressions on the production dist before chasing.
**REMAINING (from the original list):** item 5 smaller levers (per-opDef
allParamsNumeric/signatureHasComplexParam-successor cache ~8% residual
symbolic gap; bundle +123KB cold-start; first-visit parseSymbol getSymbolType
share of remaining peek cost) · item 6 release actions (curate gitignored
benchmarks/CHANGELOG-TABLES.md, consolidate the flagged CHANGELOG overlap
pair, version bump/publish).

**THE PRIOR CAMPAIGN RECORD FOLLOWS:**
**INITIATIVE + PERF CAMPAIGN COMPLETE (2026-07-03).** After the tail phase, a
perf follow-up campaign landed ~12 more commits ending `af4ab500`: micro-op
give-backs, benchmark harness normalization (all CE columns warm; interleaved
cells; load-gate before timing), the BigDecimal primitive-op work (div 1.9-4.2×,
ln 3.2-8× via fplnDirect + AGM crossover 2300→40000 bits, exp √-reduction
in-kernel, mulToPrecision + 16-site adoption), two correctness finds (cmp
ordering inversion from a digit-count fencepost; pre-existing ln near-1 digit
loss), the durable ops benchmark (benchmarks/big-decimal/run-ops.mjs +
BIGNUM-COMPARISON.md + ops-bench.wls for Mathematica), and two release perf
tables in CHANGELOG.md. Full suite + nightly green. **Closed as measured
no-wins — do NOT re-attempt without new evidence: P2-2 isSubtype memo, Fungrim
solve-template gate, P2-4 simplify churn, normalize-ctor "regression"
(benchmark artifact), atanh+sqrt-shrink ln.**

**NEXT-UP LIST (agreed with user 2026-07-03, in recommended order):**
1. ✅ COMMITTED by user as `e65eee11` (verified: exactly the 5 gated files).
   Multiply real×imaginary → `imaginary` type inference — SHIM RETIRED. Agent
   delivered + F gate passed 2026-07-03: Multiply parity split (even→finite_real,
   odd→imaginary w/ sgn non-zero proof, else finite_complex; 0∉imaginary confirmed
   in lattice), justified scope extension to Divide/Power/logType (shim removal
   would otherwise newly reject f(i/2)/f(e^i)/f(ln −1) — F reviewed: all claims
   follow the file's existing generic-point convention), signatureHasComplexParam
   deleted. Sweep 13451/0, zero snapshot deltas, 9/9 fresh-process probes.
   STAGED (5 files, explicit path; gated diff archived in session scratchpad as
   item1-multiply-imaginary-gated.diff). Awaiting user commit. Residual filed:
   ln(i)/arcsin(2)-class closed complex constants still type `number`-ish
   (sound, imprecise); Multiply's dead `every isRational` after `every isReal`.
2. ✔/▶ Definition-lookup: **engine-side CLOSED as measured no-win (do NOT
   re-attempt)** — phase-0 attribution (2026-07-03): `lookup()` is only 2.3–2.7%
   of the symbolic micro-op iteration (avg chain depth ~2, ~22ns/call; pin-table
   ceiling <3%, under the 5% gate). The "≈12µs lookup+peekDefinitions" bucket was
   ~85% parser-side `peekDefinitions` (36–40% of parse time, ~600ns × 27
   calls/parse; residual costs = per-call result-array alloc, universal-defs push
   loop, per-token lookahead regexes — parse.ts:718–828 already trigger-indexed).
   Zero source change (instrumentation removed, tree byte-identical). Durable
   groundwork recorded in the agent report: complete Scope.bindings write-site
   enumeration (declare chokepoints engine-declarations.ts:47/71; function-utils
   358/398 closure/param scopes; library.ts boot population; updateDef mutates
   in place — pin-by-reference viable if ever revisited; _reset() keeps root
   scope identity). **Parser-side follow-up (peekDefinitions) dispatched** —
   justified by the data; candidates: cross-parse [def,n] assembly cache keyed
   (token,kind), tokenize-time classification precompute, universal-defs hoist.
   **Parser follow-up ✅ COMMITTED in `99fa7276` + F-review PASSED (2026-07-03):**
   in-place re-profile
   corrected the phase-0 sub-hypotheses (universal-defs loop = 0 pushes, alloc
   ~90ns — both non-costs; real costs = speculative parseSymbol 46% + unbounded
   lookahead 21% + string building 17%). Two fixes: (a) `triggerStartMax`
   lookahead bounding (first-token → max trigger length at index time; `<$>`/
   `<$$>` alias double-registered; owned by IndexedLatexDictionary, dies with
   it); (b) single-slot (index, symbolTableGen) cache for the speculative
   parseSymbol (gen bumped by all 3 symbolTable mutators; engine scope stable
   during parse — audited). F verified: lookAhead() has exactly ONE consumer
   (peekDefinitions trigger loop), invalidation complete. Parse time −24–28%
   (deriv/poly/pmatrix), −15% defint; peek share 36%→~12%; projected ≈−8% on
   parse+evaluate. 36 latex suites ×2 + parse-heavy + neighbors green, 0
   snapshot deltas, typecheck+madge clean. Residual filed: remaining peek cost
   dominated by first-visit parseSymbol getSymbolType callback (engine-side) +
   90ns result alloc (API-contract risk, skipped). Files: latex-syntax/parse.ts,
   dictionary/{definitions,indexed-types}.ts.
3. ✅ COMMITTED by user as `99fa7276` (with the item-2 parser work + F's assert
   fix; tree clean after). **D12-A LANDED (F gate passed 2026-07-03)**: exact
   Gaussian support inside
   ExactNumericValue (imRational/imRadical + cached machine im; frozen zero-im
   singleton; representable set = real any-radical / Gaussian rational /
   pure-imaginary radical; out-of-set → float lane or symbolic, like real
   radicals). 65 isExact + 14 asExact + 12 instanceof sites audited;
   gaussianIntegerPow deleted (ONE implementation in ENV.pow); exact Gaussian
   sqrt (√(3+4i)=2+i, √(−4)=2i exact); CORR #11 FIXED (Add(2,3i,x) keeps exact
   Gaussian); json lossless via ['Complex',re,im] exact components. Agent gates:
   sweep clean, 31 acceptance + 882-check real-only byte-identity battery,
   nightly grids green, whole-src tsc + madge clean; 14 test-file deltas each
   justified (incl. operators 1-(2i+1) → −2i exact fold, owned). F gate: 10/10
   fresh-process probes (round-trip identity ✓, CORR #11 ✓, out-of-set symbolic
   ✓); interleaved A/B vs e65eee11 (parser changes held constant in both legs):
   PRODUCTION DIST deriv +1.7%, exact-radical synthetic chain +2–4%, cos(1).N()
   / ζ(3)@100d noise-to-faster. From-source was +12% on the chain → file-level
   bisection: ENV class itself (fold gates ~2%); root cause = new UNCONDITIONAL
   console.assert in normalize (live from-source, stripped in dist) → F gated
   it behind im!==0 (vacuous when real): from-source now ~+5%. ACCEPTED:
   residual ≈1µs on an 18µs pure-exact synthetic loop, zero on kernels.
   Residual levers if ever needed: constructor im-branch stores, fold-gate
   check ordering. Known residuals: ce.I stays machine complex (lift recovers
   exactness on contact with exact operands); bignum-lane im is machine
   precision (pre-existing NumericValueData.im limitation); tensor complex
   dtype unchanged.
4. ✔ **SYM P2-23-b LANDED (F gate passed 2026-07-03)**: provable-only
   `non_finite_number` convention. 20 sites inventoried: 9 conforming kept,
   2 speculative demotions (Multiply x·∞ w/o non-zero proof, Round non-real),
   10 unsound finite/complex claims fixed (Tan/Sec/Csc/Cot pole family via
   poleReciprocalType — closes the WP-2.9 Tan(π/2) residual; Gamma-family
   poles via gammaPoleType; Zeta(1); Factorial(−n); Sqrt(−∞); rounding ops via
   shared roundingFunctionType), 4 sharpenings (Ln(0)/Log(0,b)→non_finite_number,
   EllipticK(1), addType one-∞ branch, rounding of provable real ±∞).
   Convention documented ONCE in ARCHITECTURE.md; 15-test always-on pinning
   suite (non-finite-typing.test.ts). Sweep 13497/0, ZERO snapshot deltas,
   typecheck+madge clean. F gate: 11/11 fresh-process probes. NOTE: agent
   corrected the charter premise against the real lattice — ±∞ IS ⊂ complex
   under D10; only ~oo/NaN are outside. NEW RESIDUALS FILED: (a) ~oo VALUE
   types as `complex` (deferred lattice question, pinned test); (b) ∞+i →
   finite_complex in machine/big numeric-value type getters (im≠0 branch skips
   finiteness of re; edge-reachable by direct construction only); (c)
   Artanh/Arcoth(±1), Arsech/Arcsch(0) literal poles claim finite_real AND
   evaluate lacks their ±∞ special values (Tan-class, needs boundary handlers);
   (d) Beta unguarded at Γ-pole args; (e) evaluate-level observation:
   Multiply(x,+∞).evaluate() folds to +∞ for generic real x — asserts
   positivity, not just non-zero-ness (typing now sound regardless; the FOLD
   deserves its own review).
5. Smaller filed levers: allParamsNumeric/signatureHasComplexParam per-opDef
   cache (~8% residual symbolic micro-op gap); bundle +123KB cold-start.
6. Release time: curate benchmarks/CHANGELOG-TABLES.md (gitignored), consolidate
   the flagged CHANGELOG overlap pair, bump/publish.

**THE ORIGINAL COMPLETION RECORD (tail phase) FOLLOWS:**
Core (P0s, P1s, harnesses, docs): 17 commits through 7032acfb. Tail phase (perf
P2s, correctness P2/P3 sweep, D10/D11, benchmark capstone): 5 more commits —
72f3a353 (round 8: D10 + assumptions + Bernoulli + library), f5e0e339 (round 9:
parse/serialize + numerics kernels + canonical roots + compile + D11), a2b78928
(round 10: Gruntz deadlines + verify strings + simplify contracts + corpora),
8667a0aa (P2-1 Rubi dispatch index), c20a4b2e (benchmark baseline capstone).
Full suite green (0 failures), nightly 573, fresh baseline REPORT.md: 7
improvements / 0 regressions vs 0.59.0, 39/39 with packs, median 1.9× vs
Mathematica. P2-2 and Fungrim-solve-gate closed as measured no-wins (honest
reverts); P2-4 dropped (load-bearing guards, diffuse payoff).

**Open items for the user (nothing in-flight):**
- Release-notes time: paste/curate benchmarks/CHANGELOG-TABLES.md (gitignored);
  consolidate the flagged CHANGELOG overlap pair ("Equality and isSame are
  coherent" / "assume(a=b)").
- Decision candidates: **D12** — exact Gaussian integers (round-9 #11 escalation:
  ExactNumericValue has no im part; isExact⟹asExact invariant, ~57 consumers);
  Multiply-inference sharpening (real×imaginary → imaginary) to retire the last
  D10 shim (signatureHasComplexParam, box.ts); SYM P2-23 finite_number/~oo/NaN
  lattice representation.
- Tracked residuals (non-blocking, all documented in code or nightly skips):
  P1-19c Derivative typing · bignum Arccos ±1 endpoint · machine gamma() mid-range
  ~12 digits (gammaln fixed; direct product form unchanged — snapshot-heavy) ·
  Python dynamic 0^0 + Python/GPU Which/When divergences (documented per D6
  proportionality) · defint error-bar optimism (needs tanh-sinh) · Rubi
  Multiply-bucket screen limit · fu sin⁴−cos⁴ gap · :composite/:prime
  literal-only · Sum(["a","b"])→NaN · Hold structural eq · ζ(−0.5) 4.11 ulp ·
  (1/d)√r 1-ULP machine shift · EX-07d/e exactness.

### TAIL PHASE — user-approved 2026-07-02, ORDERING AGREED: all code work first,
### benchmark baseline regen LAST (capstone measurement, one regen only).

1. **Perf P2s** (driver doc: PERFORMANCE_FINDINGS.md at repo root — gitignored, do
   not lose; P0+P1 tier landed in 857a0bb5):
   - P2-3 getSignFromAssumptions → FactIndex (BEST-BOUNDED start: batch 3 rebuilt the
     assumptions DB paths; preserve three-valued fail-closed semantics; ~10× on sign
     queries under assumptions).
   - P2-5 remainder (Bernoulli slice-to-minTerms; bignumRe memo remains UNSAFE —
     ExactNumericValue mutates post-construction — re-verify before attempting).
   - P2-2 isSubtype memoization — RE-SCOPE FIRST: round 7 changed subtype semantics
     (covering unions, bounded ranges) and the old design had resolver cache
     collisions for reference types.
   - P2-1 rule-pack miss gating / P2-4 simplify-loop churn — riskiest (pack
     internals; load-bearing simplify recursion guards); attempt last or drop.
2. **Correctness P2/P3 sweep** (condensed lists at the bottom of CORRECTNESS_ and
   SYMBOLIC_FINDINGS.md; both gitignored): SYM #20-28 (union flattening/ordering,
   reduceNegationType nothing/never, Digamma(1/2) cost-gated rule, Rubi driver
   deadline re-entry snapshot/restore, ln(e) Divide-context fold, isPrimitiveSubtype
   vs isSubtype unknown disagreement, …). File-disjoint from perf items except
   common/type/reduce.ts (SYM #20/21 vs P2-2) — sequence those two.
3. **Decisions — MADE BY USER 2026-07-02, implement (analysis→gate as usual):**
   - **D10 = YES: make real⊂complex in the type lattice.** Implementation retires
     TWO shims once green: the fungrim-loader real-guard acceptance (loader.ts
     ~:157-166) and box.ts `signatureHasComplexParam`. Blast-radius work is part of
     implementation, not a re-ask: subtype/meet tables (mind round-7 covering
     unions + the meet(real,complex) locked test — it currently expects
     `finite_real | non_finite_number`, which under D10 must become… re-derive),
     isReal semantics unchanged (real still admits ±∞ — D10 is about the LATTICE
     relation, complex must admit non-finite too or the covering identity gives
     real⊂complex naturally — check both directions), Fungrim finite-domain
     convention unaffected (guards check isFinite separately). Type-lattice nightly
     grid + property battery are the gate.
   - **D11 = strict-mode juxtaposition-application auto-declaration is INFERRED,
     widenable** (user chose over parse-local / status-quo): `gcd(12,8)` misparse
     may still auto-declare `d :: function`, but marked inferred so later scalar
     use / `assign('d', 5)` overrides instead of erroring forever. Repro locked:
     after `parse('gcd(12,8)')`, `d+1` must be recoverable post-assign. Site:
     wherever invisible-operator/application declares the symbol (batch-2 area,
     invisible-operator.ts / box path). Lenient `gcd(12,8)`→Gcd is already correct.
   - CHANGELOG release-notes overlap consolidation (editorial; flagged pair at
     ~"Equality and isSame are coherent" / "assume(a=b)") — just do it at
     release-notes time or fold into the tail.
4. **LAST — benchmark baseline regen** (after ALL code work): rebuild + regenerate
   per benchmarks/README.md: `npm run build production &&
   ./venv/bin/python3 benchmarks/gen_cases.py && node benchmarks/report.mjs &&
   node benchmarks/report_changelog.mjs`. Captures Wave-3 kernel rewrites, round-6
   numerics, and the perf P2s in ONE pass; refresh REPORT.md + the two CHANGELOG
   release tables; sanity-check vs the stale ζ(3)/Γ(⅓) numbers in
   PERFORMANCE_FINDINGS.md (those predate the Wave-3 kernel rewrite).

Known open residuals (tracked, non-blocking — do not drop): P1-19c Derivative result
typing (documented in calculus.ts; blocked on evaluate-recursion + underscore-lambda
serialization); bignum Arccos near ±1 endpoint cancellation (~8 digits, nightly
test.skip); Sum(["a","b"])→NaN (element-type gating); :composite/:prime literal-only;
Hold structural eq (documented); ζ(−0.5) 4.11 ulp (nightly 6-ulp entry); complex im
machine-precision by representation (deliberate non-goal); GPU compiled Equal exact
`==` (bounded decision); (1/d)√r 1-ULP machine numericization; EX-07d Mod/Remainder
radical exactness; EX-07e Factorial half-integer exactness.

GATE DISCIPLINE (hard-won, rounds 6-7): always run suites the agents did NOT run; an
agent's "pre-existing failure" claim means "not MINE" — only a patch -R bisection
against the last commit proves pre-existing; serialization is load-bearing for
matching (BoxedNumber.structural = ce.expr(this.json)).
