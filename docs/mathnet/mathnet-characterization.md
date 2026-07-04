# ShadenA/MathNet — Characterization for Compute Engine Validation

**Sample**: 3,100 rows (31 pages × 100), evenly spaced offsets 0, 900, 1800, …,
27000 across the dataset's 27,817 total rows. All 31 API calls succeeded on
the first attempt (no retries needed). Raw sample: `mathnet-sample.jsonl`
(images stripped to a count field, `images_count`).

Context: Compute Engine (CE) parses LaTeX into MathJSON / BoxedExpression and
evaluates/simplifies — it does **not** solve word problems, prove theorems, or
run search/case-analysis. A dataset row is useful for CE validation only if it
reduces to: *parse a closed-form expression, evaluate or simplify it, compare
to a known value*. Everything else (proofs, strategies, multi-part answers,
geometric loci, existence claims) is out of scope no matter how "correct" the
row is.

---

## 1. Topic distribution

Top-level topic = first segment of each `topics_flat` string (e.g.
`"Number Theory > Divisibility / Factorization"` → `"Number Theory"`). All
3,100 rows had at least one topic. The only top-level labels observed:
**Algebra, Geometry, Discrete Mathematics, Number Theory, Statistics,
Precalculus, Calculus, Math Word Problems.**

**Any-topic** (row counted once per distinct top-level label it touches; rows
can have multiple):

| Topic | Rows | % of 3100 |
|---|---|---|
| Algebra | 1228 | 39.6% |
| Geometry | 1017 | 32.8% |
| Discrete Mathematics | 896 | 28.9% |
| Number Theory | 758 | 24.5% |
| Statistics | 34 | 1.1% |
| Precalculus | 17 | 0.5% |
| Calculus | 14 | 0.5% |
| Math Word Problems | 10 | 0.3% |

**Primary topic** (first entry in `topics_flat` only):

| Topic | Rows | % of 3100 |
|---|---|---|
| Geometry | 950 | 30.6% |
| Algebra | 863 | 27.8% |
| Discrete Mathematics | 670 | 21.6% |
| Number Theory | 553 | 17.8% |
| Statistics | 34 | 1.1% |
| Calculus | 14 | 0.5% |
| Precalculus | 10 | 0.3% |
| Math Word Problems | 6 | 0.2% |

Takeaway: this is an **olympiad** corpus, not a "compute an integral / simplify
this expression" corpus. Calculus/Precalculus/Statistics are a rounding error
(≈2.4% combined by primary topic); the bulk is Geometry, Algebra, Discrete
Math (mostly combinatorics), and Number Theory — domains dominated by proof
and construction, not closed-form evaluation.

## 2. Cross-tabulations

### Primary topic × problem_type

| Topic | MCQ | final answer only | proof and answer | proof only | Total |
|---|---|---|---|---|---|
| Geometry | 31 | 36 | 304 | 579 | 950 |
| Algebra | 42 | 71 | 509 | 241 | 863 |
| Discrete Mathematics | 13 | 39 | 445 | 173 | 670 |
| Number Theory | 13 | 25 | 321 | 194 | 553 |
| Statistics | 8 | 15 | 10 | 1 | 34 |
| Calculus | 0 | 1 | 7 | 6 | 14 |
| Precalculus | 2 | 3 | 5 | 0 | 10 |
| Math Word Problems | 4 | 1 | 1 | 0 | 6 |

Overall `problem_type` split (all 3100): proof and answer 1602 (51.7%), proof
only 1194 (38.5%), final answer only 191 (6.2%), MCQ 113 (3.6%). **"final
answer only" is a small slice of the dataset (6.2%)** — most problems are
proof-centric even when a final answer exists.

### Primary topic × has-final-answer

| Topic | has_answer | no_answer | Total | % with answer |
|---|---|---|---|---|
| Algebra | 620 | 243 | 863 | 71.8% |
| Discrete Mathematics | 493 | 177 | 670 | 73.6% |
| Number Theory | 359 | 194 | 553 | 64.9% |
| Geometry | 374 | 576 | 950 | 39.4% |
| Statistics | 32 | 2 | 34 | 94.1% |
| Calculus | 8 | 6 | 14 | 57.1% |
| Precalculus | 10 | 0 | 10 | 100% |
| Math Word Problems | 6 | 0 | 6 | 100% |

**Key quantity**: non-geometry total = 2150 rows; of these, **1528 (71.1%)
have a non-null `final_answer`**. Geometry, by contrast, only has an answer
39.4% of the time (mostly proof-only "show that..." problems). So the
answer-bearing pool is concentrated exactly where CE could plausibly help
(Algebra/Discrete/Number Theory), and geometry — where CE has no
symbolic-geometry engine — mostly lacks a checkable answer anyway.

## 3. `final_answer` format taxonomy

Classified via regex/heuristics over the 1902 rows (61.4% of 3100) with a
non-null, non-empty `final_answer`.

| Category | Count | % |
|---|---|---|
| pure_integer | 571 | 30.0% |
| plain_text_math_expression | 407 | 21.4% |
| set_tuple_list | 197 | 10.4% |
| prose_sentence | 178 | 9.4% |
| boolean_or_mcq | 167 | 8.8% |
| unicode_math_expression | 118 | 6.2% |
| simple_numeric (fraction/decimal) | 104 | 5.5% |
| other | 76 | 4.0% |
| condition_statement | 63 | 3.3% |
| interval | 15 | 0.8% |
| latex_expression | 6 | 0.3% |

Definitions and 3 examples each:

- **pure_integer** — bare integer. `[00xp] 8`, `[05rp] 24`, `[06au] 13`
- **plain_text_math_expression** — ASCII pseudo-math (sqrt/pi/floor/^, no
  LaTeX/unicode). `[03e9] n`, `[0710] 3*sqrt(3)/4`,
  `[0dnv] floor((2^{n+1} - 5)/3)`
- **set_tuple_list** — explicit finite set/tuple/enumeration.
  `[048d] n ∈ {3, 4, 5, 7, 8, 9, 10, 12, 15, 18, 24, 42}`,
  `[0dst] 5, 6, 7, 8, 9, 10, 11, 12`, `[03nf] (m+n choose m)`
- **prose_sentence** — natural-language sentence(s), often multi-part.
  `[051m] Yes; for example a hexagon with all interior angles equal and side
  lengths in order 1, 4, 5, 2, 3, 6 exists.`, `[0855] The locus is the circle
  Γ′ obtained by reflecting Γ across the line AB...`, `[021o] a) The
  top-right corner is 2; the remaining missing numbers are 1 and 3...`
- **boolean_or_mcq** — Yes/No/True/False or a bare MCQ letter, sometimes
  multi-part. `[01l1] Yes`, `[077h] Yes`, `[0g7r] a. No. b. Yes.`
- **unicode_math_expression** — uses ≡ ≤ ≥ √ π ° etc., no LaTeX.
  `[009s] n ≡ 1 (mod 3)`, `[065e] 30°`,
  `[056g] 270°, 135°, 67.5°, 33.75°, 33.75°`
- **simple_numeric** — fraction or decimal. `[08tg] 8/3`, `[0apd] 19/6`,
  `[0k6m] 1019/2019`
- **other** — didn't cleanly fit (frequently: minor regex misses like
  non-ASCII minus signs, or answers naming problem-specific relations).
  `[06op] A - B = m - ℓ + 1 = n - 1`, `[090z] n−3`, `[0dri] Yes; 27`
- **condition_statement** — describes a constraint on a variable, not a
  value. `[04aq] M divides N`, `[0fv5] n is divisible by 3`,
  `[03qq] All rectangles with positive integer side lengths such that
  either...`
- **interval** — an interval literal. `[0hv0] (0, 0)`, `[0kcg] (505, 1212)`,
  `[0g4b] (2, 2)`
- **latex_expression** — contains LaTeX commands / `$`.
  `[09et] \frac{1}{5}(...)^n - (...)^n)(...)`, `[08wq] (1+\sqrt{2})/2`,
  `[0l88] 0 < c < (\sqrt{5} - 1)/2`

Note: the `other` bucket is partly a classifier artifact — e.g. `n−3` uses a
Unicode minus sign (U+2212) rather than ASCII hyphen and a real ingestion
pipeline for CE would need to normalize such characters before LaTeX-izing the
string; this is a real (if minor) parsing hazard in the raw field, not just a
taxonomy gap.

## 4. Language (answer-bearing, non-geometry subset, n=1528)

The `language` field is unreliable/sparse: 66.9% of this subset have `language
== null`. Treating any value containing "English" as English:

| Language | Count | % |
|---|---|---|
| (null) | 1022 | 66.9% |
| English (incl. multi-lang tags) | 466 | 30.5% |
| Spanish / Español | 28 | 1.8% |
| Mongolian | 6 | 0.4% |
| German | 2 | 0.1% |
| Russian | 2 | 0.1% |
| Vietnamese | 1 | 0.1% |
| Chinese (Traditional) | 1 | 0.1% |

**English fraction (explicit tag only): 30.5%.** In practice most `null`-tagged
rows are still English text (spot-checks during example curation showed this;
the field appears to only be populated when a *non-English* variant or
bilingual pairing exists) — but this cannot be asserted from the field alone,
so a strict English filter throws away roughly two-thirds of the subset by
label even though the true English fraction is almost certainly much higher.
This is a data-quality gap: any CE validation pipeline should **not** trust
`language == null` to mean "unknown language" — it should re-derive language
from `problem_markdown` (e.g., an ASCII/script heuristic or langid) rather
than filtering on this field.

## 5. LaTeX density in problem statements

Fraction of `problem_markdown` containing at least one inline `$...$` math
fragment: **2907/3100 (93.8%)**. Distribution of fragment count per problem:

| Fragments | Rows | % |
|---|---|---|
| 0 | 193 | 6.2% |
| 1–5 | 1422 | 45.9% |
| 6–10 | 794 | 25.6% |
| 11–20 | 574 | 18.5% |
| 21+ | 117 | 3.8% |

Mean (over problems with ≥1 fragment): 7.5; median 6; max 58. Problem
statements are heavily LaTeX'd — good news for CE's LaTeX parser, since almost
every problem gives it real work to do (as opposed to plain-English word
problems with no formal notation at all).

Separately: **667/3100 rows (21.5%) reference at least one image**
(`images_count > 0`), concentrated in Geometry (grids, diagrams) and some
combinatorics (colorings). These are unusable for CE regardless of answer
format, since the problem statement itself is incomplete without the figure.

## 6. Competition spread (answer-bearing, non-geometry subset, n=1528)

**643 distinct competition values** in just this 1528-row subset — extreme
fragmentation. Top 20:

| Competition | Count | % |
|---|---|---|
| Harvard-MIT Mathematics Tournament | 64 | 4.2% |
| Brazilian Mathematical Olympiad | 36 | 2.4% |
| (null) | 31 | 2.0% |
| China Mathematical Competition | 16 | 1.0% |
| Mathematica competitions in Croatia | 16 | 1.0% |
| HMMT February | 15 | 1.0% |
| Harvard-MIT Math Tournament | 15 | 1.0% |
| SAUDI ARABIAN MATHEMATICAL COMPETITIONS | 14 | 0.9% |
| Berkeley Math Circle | 14 | 0.9% |
| HMMT November | 14 | 0.9% |
| Estonian Mathematical Olympiad | 13 | 0.9% |
| Team Selection Test | 12 | 0.8% |
| Estonian Math Competitions | 11 | 0.7% |
| Iranian Mathematical Olympiad | 10 | 0.7% |
| Japan Mathematical Olympiad | 10 | 0.7% |
| Canadian Mathematical Olympiad | 10 | 0.7% |
| Harvard-MIT November Tournament | 10 | 0.7% |
| Mongolian Mathematical Olympiad | 9 | 0.6% |
| Baltic Way | 9 | 0.6% |
| Philippine Mathematical Olympiad | 9 | 0.6% |
| ... (633 more, mostly 1-8 rows each) | | |

Note also the naming is inconsistent/unnormalized (HMMT appears under at
least 4 distinct strings: "Harvard-MIT Mathematics Tournament", "Harvard-MIT
Math Tournament", "HMMT February", "HMMT November", "Harvard-MIT November
Tournament"). Difficulty is olympiad-grade throughout (no easy/school-level
tier visible in this subset) — every one of these is a hard, multi-step
problem, which is itself a mismatch for a symbolic-evaluation smoke test: even
where the *final answer* is a clean integer, getting there from the *problem
statement* (which CE cannot do — it has no theorem-proving/search layer)
requires a human or an LLM to first produce the closed-form expression that CE
would then check.

## 7. Best-case examples for CE validation (15)

Selected: non-geometry, explicitly English-tagged or unambiguously English
text, `problem_type` in {"final answer only", "proof and answer"}, and
`final_answer` a single closed-form number/expression (not a function
specification, condition, or multi-part answer). These are the rows where a
harness could plausibly do: *(human/LLM extracts the target expression from
the final_answer field) → CE parses + evaluates/simplifies → compare to
`final_answer`* without CE ever touching the proof or the search.

1. **[0i59]** Calculus > Derivatives, *final answer only*, answer **`16`**
   > We are given the values of the differentiable real functions f, g, h, as
   > well as the derivatives of their pairwise products, at x=0: f(0)=1;
   > g(0)=2; h(0)=3; (gh)'(0)=4; (hf)'(0)=5; (fg)'(0)=6. Find the value of
   > (fgh)'(0).

2. **[0am1]** Precalculus > Trigonometric functions, *final answer only*,
   answer **`4`**
   > Find the exact value of √3/sin 20° − 1/cos 20°.

3. **[0apd]** Algebra > Simple Equations, *final answer only*, answer
   **`19/6`**
   > If wxy=10, wyz=5, wxz=45, xyz=12, what is w+y?

4. **[0j2y]** Algebra > Polynomials, *final answer only*, answer **`1`**
   > What is the remainder when (1+x)^2010 is divided by 1+x+x²?

5. **[0aps]** Number Theory > Divisibility, *final answer only*, answer
   **`100188`**
   > What is the least 6-digit natural number that is divisible by 198?

6. **[0jxv]** Number Theory > Pell's equations, *final answer only*, answer
   **`11621`**
   > Find the smallest possible value of x+y where x, y ≥ 1 and x, y are
   > integers satisfying x² − 29y² = 1.

7. **[0kw3]** Number Theory > Polynomials mod p, *final answer only*, answer
   **`1994`**
   > Let P = ∏_{i=0}^{2016} (i³ − i − 1)². The remainder when P is divided by
   > the prime 2017 is not zero. Compute this remainder.

8. **[03pb]** Number Theory (log/exponential), *final answer only*, answer
   **`93`**
   > Let a, b, c, d be positive integers with log_a b = 3/2, log_c d = 5/4. If
   > a − c = 9, then b − d = ______.

9. **[0hsn]** Number Theory > Polynomials mod p, *final answer only*, answer
   **`40`**
   > What is the smallest positive integer x for which x² + x + 41 is not
   > prime?

10. **[0inb]** Number Theory > Modular Inverses, *final answer only*, answer
    **`17`**
    > Let a and b be integer solutions to 17a + 6b = 13. What is the smallest
    > possible positive value for a − b?

11. **[0axu]** Number Theory > Fermat/Euler/Wilson, *final answer only*,
    answer **`14`**
    > For how many primes p < 50 is p⁴ + 5p³ + 4 divisible by 5?

12. **[0i6f]** Number Theory > Divisibility, *final answer only*, answer
    **`106`**
    > How many pairs of integers (a,b), with 1 ≤ a ≤ b ≤ 60, have the property
    > that b is divisible by a and b+1 is divisible by a+1?

13. **[0ase]** Number Theory > τ (divisor count), *final answer only*, answer
    **`1/4`**
    > What is the probability that a randomly chosen positive divisor of 2010
    > has two digits?

14. **[04sk]** Algebra (quadratic/inequalities), *proof and answer*, answer
    **`sqrt(3)`**
    > Real numbers x,y,z satisfy 1/x+1/y+1/z+x+y+z=0 and none of them lies in
    > (−1,1). Find the maximum value of x+y+z.

15. **[0l62]** Algebra > Logarithmic/Exponential functions, *proof and
    answer*, answer **`1/576`**
    > Given x,y,z positive reals with x^(log₂(yz)) = 2⁸·3⁴,
    > y^(log₂(zx)) = 2⁹·3⁶, z^(log₂(xy)) = 2⁵·3¹⁰, compute the smallest
    > possible value of xyz.

All 15 are clean "final numeric/closed-form value" targets; note even these
require a human (or an LLM pass) to actually *solve* the olympiad problem and
hand CE the resulting candidate expression — CE's own role is limited to
parsing that candidate and confirming it equals/simplifies-to the recorded
`final_answer`.

## 8. Worst-case blockers and machine-checkable-fraction estimate

Concrete blocker patterns observed in `final_answer`:

- **Conditions, not values** (`condition_statement`, 63 rows, 3.3%; plus a
  good chunk of `unicode_math_expression`'s 118 rows): `n ≡ 1 (mod 3)`,
  `M divides N`, `ℓ ≡ r ≡ 1 (mod 4) or ℓ ≡ r ≡ 3 (mod 4)`,
  `All primes congruent to 1 modulo 6`. These describe a constraint on the
  answer variable rather than a checkable value — there is nothing for CE to
  evaluate against; the "check" would require re-deriving the solution set,
  which is exactly the theorem-proving work CE doesn't do.
- **Prose sentences** (178 rows, 9.4%): `Inger has a winning strategy.`,
  `The locus is the circle Γ′ obtained by reflecting Γ across the line AB...`,
  full natural-language descriptions of geometric loci or game-theoretic
  strategies. Not parseable as math at all.
- **Multi-part answers** (scattered across several buckets, hard to size
  precisely — an eyeballed ~5-8% of the total): `a) 1/4, b) 1/4, c) 5/14, d)
  1/7`, `a. No. b. Yes.`, `a) No; b) Yes; c) Yes`. These require splitting
  into sub-answers first, several of which are themselves booleans/prose.
- **Function specifications rather than values** (a large fraction of
  `plain_text_math_expression`, seen heavily in Algebra "find all functions f"
  problems): `f(n) = n for all positive integers n`, `f(x) = x/2 - 3/2`. These
  are checkable in principle (verify the functional equation holds
  identically) but need a different verification strategy than
  "parse-and-compare a scalar" — closer to a functional-equation-satisfies
  check.
- **MCQ letters without the option text** (part of `boolean_or_mcq`, 167
  rows, 8.8%): answer `C` is meaningless without also having the original
  multiple-choice options, which are not modeled as a separate dataset field.
- **Non-ASCII/raw-text encoding hazards**: Unicode minus (`−`, U+2212) and
  other typographic characters appear in raw `final_answer` strings (`n−3`)
  and would break naive LaTeX-ification without a normalization pass.
- **Language noise**: as noted in §4, `language` is null 66.9% of the time
  in the answer-bearing non-geometry subset, so language can't be used as a
  reliable filter as-is.

### Fraction estimate

Starting from all 1902 answer-bearing rows (any topic):

- **Strict** ("parse both sides as a literal, compare numerically/exactly",
  no auxiliary logic): `pure_integer` (571) + `simple_numeric` (104) =
  **675/1902 ≈ 35.5%**.
- **Lenient** (also count closed-form symbolic expressions and simple
  single-variable formulas that a symbolic-equality check could handle,
  excluding function specifications, conditions, multi-part and prose
  answers): add `latex_expression` (6) and a manually-sampled ~64% of
  `plain_text_math_expression` (407 × 0.64 ≈ 260) → **≈941/1902 ≈ 49%**.
- Restricting to **non-geometry only** (the domain CE could conceivably
  help with) raises the answer-availability rate to 71.1% of rows but the
  *format* mix within that subset is similar to the overall mix, so the
  same ~35–49% checkable range applies to the ~1528 non-geometry
  answer-bearing rows, i.e. roughly **535–750 out of the full 3100-row
  sample (17–24%)** are both non-geometry and format-wise checkable by a
  naive "parse and compare."

Bottom line: even after restricting to non-geometry problems with a
`final_answer` at all (71.1% of non-geometry rows), **only about one-third to
one-half of those answers are a bare value or clean closed-form expression**
that a "parse both sides, compare" harness could use directly — the rest are
conditions, prose, multi-part, MCQ-letter, or function-specification answers
that need extra logic or are out of scope entirely. And in all cases, MathNet
supplies olympiad-hard *problems*; CE can only ever check a
*pre-computed candidate answer*, never derive one — so this dataset is usable
at best as a source of "does CE agree with a known closed-form value" spot
checks (a few hundred hand-curated rows), not as a bulk/automated regression
suite.
