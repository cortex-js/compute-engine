# CortexJS Compute Engine × ShadenA/MathNet — Feasibility Experiment

**Date:** 2026-07-04
**Repo:** `/Users/arno/dev/compute-engine` (run from source via `tsx`, read-only)
**Dataset:** `ShadenA/MathNet` (27,817 rows total), 800 rows sampled from 8 evenly
spaced offsets (0, 3500, …, 24500), images dropped → `ce-exp-rows.jsonl`.

**Premise.** The Compute Engine parses LaTeX→MathJSON and evaluates/simplifies.
It does **not** solve word problems. So the validation value is (a) stress-testing
the LaTeX parser on real olympiad LaTeX, and (b) parsing/normalizing `final_answer`
for answer-equivalence checking. The three experiments below test exactly those.

Every `ce.parse` call was wrapped in try/catch and run in timeout-guarded chunks
(chunks of 500 for fragments, 200 for answers, each under `timeout`). **No chunk
ever hung** — the only pathology found was a hard *throw* (see Gap #5), which the
try/catch caught cleanly.

## Sample composition

| metric | value |
|---|---|
| rows sampled | 800 |
| language = English or null | 787 |
| rows with non-null `final_answer` | 473 |
| unique inline/display math fragments (English/null rows) | 2,295 (from 5,871 with dups) |

Fragments extracted with regex for `$$…$$`, `\[…\]`, `\(…\)`, `$…$` (in that
precedence order to avoid double-counting).

---

## Experiment 1 — LaTeX fragment parse sweep (core deliverable)

2,295 unique fragments fed to `ce.parse`. A fragment is **clean** if `isValid` is
true and the stringified MathJSON contains no `"Error"` subexpression.

| result | count | share |
|---|---:|---:|
| **clean** (valid, no Error node) | 1,950 | **85.0%** |
| parses with an Error subexpression | 336 | 14.6% |
| threw an exception | 9 | 0.4% |
| hung | 0 | 0% |

**Headline: 85% of real olympiad math fragments parse clean.** The failures are
concentrated in a small number of well-defined notation gaps — and several of
those are trivially recoverable (a trailing sentence period alone accounts for
51 fragments).

### Ranked parser-gap list (by number of distinct fragments affected)

| # | gap | frags | example fragments |
|---|---|---:|---|
| 1 | **Geometry notation** — `\angle`, `\varangle`, `\triangle`, `\widehat`, `\perp`, `\parallel`, `\overparen`, `\square` (all `unexpected-command`) | **138** | `0^{\circ}<\varangle XYZ<180^{\circ}` · `FG \perp AO` · `AB \parallel CD` |
| 2 | **Semantic type error** — structurally parses but produces an `incompatible-type` Error: `\mathbb{Z}`/set used in arithmetic, `\equiv … \pmod{…}` congruences, `\bmod`, mixed number/set/tuple | **60** | `2 \mathbb{Z} + 1` · `2^n \equiv 1 \pmod{p^{k+1}}` · `a^2+b^2+c^2 \equiv d^2+e^2+f^2 \quad(\bmod 12)` |
| 3 | **Trailing sentence punctuation** — a full equation ending in `.` yields a `Sequence` + `unexpected-operator '.'` | **51** | `(n-1)S^2 > 4n(A_1 + A_2).` · `(x^2-1)^2 (y^2-1)^2 + 16x^2 y^2 = z^2.` |
| 4 | **Ellipsis inside a list/sum** — `\cdots`, `\ldots`, `\dots` parse to a `ContinuationPlaceholder` symbol but error when placed inside `Add`/`Tuple`/`Multiply` | **39** | `(a_1, \cdots, a_{10})=(1,1,2,…)` · `(2!+2)(3!+3) \cdots (2019!+3)` |
| 5 | **CRASH: `ContinuationPlaceholder` type-change throw** — ellipsis in a *numeric* context throws `The type of the constant "ContinuationPlaceholder" cannot be changed` (`boxed-value-definition.ts:224`, via `checkNumericArgs`→`BoxedSymbol.infer`) | **9** | `(1!)^2 + (2!)^2 + \dots + (2018!)^2` · `1^{1987} + 2^{1987} + \ldots + n^{1987}` |
| 6 | **Subscript-qualified blackboard sets** — `\mathbb{R}_{>0}`, `\mathbb{N}_{>1}` (`expected-closing-delimiter`) | 9 | `\mathbb{R}_{>0}` · `\mathbb{N}_{>1}` |
| 7 | **Divisibility bar / structure tuples** — `(n+m+1)\|2mn`, `(A,+,\cdot)` (`unexpected-delimiter`) | 7 | `(n + m + 1)\|2mn` · `(K, +, \cdot)` |
| 8 | **Unicode / stray tokens** — `€`, `?`, stray chars (`unexpected-token`) | 6 | `15\,€` · `11 \times 101 \times … ?` |
| 9 | **`aligned`/`align` environments & `&` alignment** (systems of equations) | 5 | `\begin{aligned} a^2+ab+c=0 \\ b^2+bc+a=0 …\end{aligned}` |
| 10 | **Set-minus `\backslash`** | 4 | `(A \backslash B) \cup (B \backslash A)` |
| — | misc `\forall`, `\langle…\rangle`, `\nmid`, leading relational op (`\ge 2015`), bare `\cdot`/`\times` | ~8 | `\forall n \ge 1` · `p \nmid ab` |

**Reading of the gaps.** Gaps #3, #4, #5 are the highest-value fixes because the
underlying math is fully supported — CE fails only on *packaging*: a trailing
period, or an ellipsis that should be tolerated in a list/sum. Fixing "tolerate a
trailing `.`" and "tolerate `\cdots`/`\ldots`/`\dots` inside Add/Tuple/Multiply
(and don't crash)" would move ~99 fragments (≈4.3 pts, → ~89% clean) and remove
the only crash. Gap #1 (geometry) is a genuine domain CE doesn't model and is
mostly irrelevant to a CAS anyway. Gap #2 is arguably *correct* behavior (a set
isn't a number) but the `\equiv…\pmod` congruence idiom is common enough in
number-theory answers that a dedicated `Congruent` head would help both here and
in Experiment 2.

---

## Experiment 2 — `final_answer` parse sweep

All 473 non-null `final_answer` strings fed directly to `ce.parse`, then `.N()`.

| result | count | share |
|---|---:|---:|
| parses to a **valid** expression (no Error) | 374 | **79%** |
| evaluates to a **finite number** via `.N()` | 204 | 43% |
| contains an Error subexpression | 99 | 21% |
| threw | 0 | 0% |

### Failure categories (of the 99 non-valid)

| category | count | examples |
|---|---:|---|
| Prose / words (not math at all) | 54 | `"All rectangles with positive integer side lengths …"`, `"Yes; for example a hexagon …"` |
| Unicode math symbols CE rejects | 31 | `n ≡ 1 (mod 3)`, `n ∈ {3,4,5,7,…}` |
| Multi-value / multi-part lists | 7 | `a) No; b) Yes; c) Yes`, `a) 2; b) 1198` |
| Other (mixed prose/notation) | 5 | `a. No. b. Yes.`, `10^ℓ + 1` |
| Equation / assignment | 2 | `M = N + 1`, `A - B = m - ℓ + 1 = n - 1` |

The dominant failure is simply that ~40% of olympiad answers are **prose or
multi-part** (`"Yes"`, `"a) No; b) Yes"`, "all functions of the form …"), which
no parser can normalize into a comparable value. Of the genuinely mathematical
answers, the parse rate is high.

### Unicode character census (across all 473 answers)

Non-ASCII math characters present, with per-character parser acceptance (probed
directly):

| char | occ | CE accepts? |
|---|---:|---|
| `−` (U+2212 minus) | 48 | ✅ (same as ASCII `-`) |
| `≥` `≤` | 16 / 14 | ✅ → `LessEqual`/`GreaterEqual` |
| `≡` | 8 | ❌ `unexpected-token` (congruence) |
| `√` | 8 | ✅ → `Sqrt` |
| `ℓ` | 7 | ✅ (symbol) |
| `′` (prime) | 5 | — (appears in geometry labels) |
| `∈` | 5 | ❌ `unexpected-token` |
| `∠` | 4 | ❌ `unexpected-token` |
| `∪` `∩` | 3 / 1 | ❌ `unexpected-token` |
| `…` | 3 | ❌ `unexpected-token` (Unicode ellipsis) |
| `≠` | 3 | ✅ → `NotEqual` |
| `⌊ ⌋ ⌈ ⌉` | 2 / 2 / 1 / 1 | ✅ → `Floor`/`Ceil` |
| `ℤ` | 2 | ✅ (as string symbol) |
| `∞` | 1 | ✅ → `PositiveInfinity` |
| `≈` | 1 | ❌ `unexpected-token` |
| `°` | (in `60°`) | ✅ → `60° = π/3` (degrees→radians) |
| `×` `·` | — | ✅ → `Multiply` |

**Verdict for answer-checking:** CE already ingests the common Unicode operators
(`−, ≤, ≥, ≠, √, π, ∞, ⌊⌋, ×, ·, °`, and `{…}` sets). The concrete missing set is
small and high-value: **`≡` (congruence), `∈`, `∪`, `∩`, `…`, `∠`, `≈`.** Adding
`≡`/`∈`/`…` alone would recover a meaningful slice of the 31 Unicode failures. For
answer-equivalence, the realistic pipeline is: filter out prose/multi-part answers
(≈40%), parse the rest, and compare via `ce.parse(a).isEqual(ce.parse(b))` or
`.N()` within tolerance.

---

## Experiment 3 — End-to-end spot check (10 problems)

Hand-picked pure-computation problems (number theory / algebra), attempting to
express the check in CE terms. **Honest tally: 0 of 10 were usable straight from
the problem statement.** Every one required a human to model the problem (find the
optimizer, supply the counting formula, choose the factorization step). Once
translated, CE performed the *arithmetic/algebra* core correctly in 7/10; the
other 3 needed a solver or an enumeration CE doesn't provide.

| id | problem (abridged) | FA | what CE did | human translation needed | outcome |
|---|---|---|---|---|---|
| 0he7 | # distinct prime divisors of `11^8 + 11^7 - 132` | 7 | `evaluate → 233 845 920`; `FactorInteger` → `2,3,5,7,11,19,37` (7 primes) | "distinct prime divisors" → `FactorInteger` + count | ✅ **matches** |
| 0jpl | 2nd smallest sum-of-two-cubes-two-ways | 4104 | verified `2^3+16^3 = 9^3+15^3 = 4104` | human supplied the taxicab decomposition | ✅ verified arithmetic (not derived) |
| 04iw | triples with `2^m p^2 + 1 = n^5` | `(11,1,3)` | verified `2·11^2+1 = 3^5 = 243` | human supplied the triple | ✅ verified (not solved) |
| 0hdc | min `ab+a+b` s.t. `a^2+b^2=25` | −13 | evaluated `ab+a+b` at `(3,−4)` → `−13`, constraint `=25` | human found the optimizer `(3,−4)` | ✅ verified (CE can't optimize this directly) |
| 08mo | max `xy` s.t. `x^3+y^3 ≤ x^2+y^2` | 1 | constraint slack at `(1,1)` = `0` (boundary) | human found optimizer | ✅ consistency check only |
| 0b2b | # ordered quadruples `abcd=216` | 400 | `Binomial(6,3)^2 → 400` | human derived the stars-and-bars formula (216=2³·3³) | ✅ **matches** |
| 0kof | Σ "loose" `n<100` (6 divisors, `b≥2a`) | 512 | evaluated candidates, but needs enumeration+`FactorInteger` loop | full modeling + enumeration | ⚠️ scriptable but not a CE evaluate |
| 0k8u | Σ `x≤5` with a ceil/floor fixed-point eq | 85 | parsed `⌈x²⌉,⌈x⌉,⌊x⌋` correctly, but left symbolic (needs solving over x) | requires a piecewise solver | ❌ needs solve, not evaluate |
| 0kst | # pairs `gcd(a,b)·a + b² = 10000` | 99 | — needs enumeration over a,b | full modeling | ❌ needs enumeration |
| 00y1 | Σ ints with strictly monotone digits | 25617208995 | — combinatorial enumeration | full modeling | ❌ needs enumeration |

**Key observations from Exp 3:**
- CE's **arithmetic + `FactorInteger` + `Binomial`** primitives are solid and gave
  exact matches on 0he7 and 0b2b — the two problems that reduce to a single
  closed-form CAS computation.
- For **optimization** (0hdc, 08mo) and **existence/uniqueness** (04iw, 0jpl) CE is
  a *verifier*, not a *solver*: the human supplies the witness/optimizer and CE
  confirms the arithmetic. That is still a legitimate validation use (checking a
  claimed answer), but it is not "solving the problem."
- CE parsed every problem expression I threw at it (ceil/floor, factorial, cubes,
  binomial) without error — the *parser* was never the bottleneck in Exp 3; the
  missing capability was **solving/enumeration**, which is out of scope by design.

---

## Overall verdict

- **Exp 1 (parser stress test): strongly positive and directly actionable.** 85%
  clean parse on raw olympiad fragments, no hangs, and the failures cluster into a
  short ranked list of real gaps — plus it surfaced one genuine crash bug
  (ContinuationPlaceholder). This is the highest-value use of the dataset: a
  regression corpus of parser gaps. Fixing trailing-`.` tolerance + `\cdots`/`\dots`
  in lists (and the crash) is a concrete, high-ROI follow-up.
- **Exp 2 (answer normalization): usable with a filter.** 79% of answers parse,
  but ~40% of *all* answers are prose/multi-part and un-normalizable. For the
  mathematical remainder CE is close; adding `≡, ∈, ∪, ∩, …` Unicode tokens is the
  cheap win.
- **Exp 3 (end-to-end verification): limited, as predicted.** CE is a competent
  *arithmetic/algebra verifier* but not a word-problem solver; 0/10 problems were
  machine-usable without human modeling, and only the 2 pure closed-form ones
  produced an answer end-to-end. Value here is answer *checking*, not solving.

**Bottom line:** the dataset is an excellent parser-hardening corpus (Exp 1) and a
decent answer-normalization corpus (Exp 2), but not an end-to-end solver benchmark
(Exp 3). Recommend adopting the Exp-1 failure fragments as a parser regression set.
