# Fresh-sample MathNet parser sweep — post-hardening validation

**Purpose:** measure the TRUE clean-parse rate of the CE LaTeX parser on MathNet
rows the frozen regression corpus (`docs/mathnet/parser-test-cases.json`,
345 fragments) has never seen, after today's hardening pass
(`docs/mathnet/parser-hardening-plan.md`, Tiers 1–4, corpus 3/345 → 265/345,
throws 9 → 0).

## Tree state

- Sweep run once, start to finish, at commit `748d6870` (no commits landed
  during the run).
- Working tree was dirty throughout with an **unrelated, concurrent** in-progress
  change (a SetMinus type-inference fix by another agent):
  `docs/plans/2026-07-04-series-design.md`,
  `src/compute-engine/boxed-expression/validate.ts`,
  `src/compute-engine/latex-syntax/dictionary/definitions-algebra.ts`,
  `src/compute-engine/latex-syntax/dictionary/definitions-logic.ts`,
  `test/compute-engine/latex-syntax/logic.test.ts`, plus an untracked `.scratch/`.
  The sweep was executed in one uninterrupted pass (no bisection needed —
  see Throws below), so this doesn't create an internal inconsistency, but the
  numbers below reflect whatever state those 4 files were in during the single
  run, not a clean `748d6870`.
- No repo files were modified by this task. Two scratch-only false starts are
  noted under Methodology below; neither touched the repo.

## Sample

- Source script: a scratchpad copy of `docs/mathnet/scripts/fetch-sample.py`
  (`fetch-sample-fresh.py`) with a fixed `+1700` offset shift, so offsets are
  `1700, 5177, 8654, 12131, 15608, 19085, 22562, 26039` — disjoint from the
  original sample's `0, 3477, 6954, …` (27817 // 8 = 3477 spacing).
- 800 rows fetched → `fresh-sample.jsonl`.
- `extract-fragments.py` → **2,233 unique fragments** (`fresh-fragments.json`),
  vs. 2,295 in the original sweep — comparable sample size.
- `parse-sweep.ts` run once over the full range (0–2233) under `timeout 600`;
  finished well inside the budget. **No hang.**

## Overall result

| result | count | share |
|---|---:|---:|
| **clean** (valid, no Error node) | 2,175 | **97.4%** |
| error (Error subexpression) | 58 | 2.6% |
| throw | 0 | 0% |
| hang | 0 | 0% |

**97.4% clean vs. the 85.0% original baseline** (2,295 fragments, same
extraction methodology) — a +12.4-point improvement, ahead of the hardening
plan's own ~93–95% target. The frozen corpus's 265/345 "fixed" number measures
progress on a fixed set of *known-bad* inputs; this fresh sweep confirms the
improvement generalizes to unseen data, and at a rate the plan didn't
anticipate (likely because two of the largest original buckets — geometry
148/148 and much of ellipsis/trailing-punctuation — are proportionally even
more dominant in a random sample than in the curated corpus, so fixing them
moves the *overall* rate more than the corpus's raw fixed-count suggests).

## Throws

**Zero throws.** Tier 1's `ContinuationPlaceholder` fix holds on fresh data —
no crash was observed anywhere in the 2,233-fragment sweep.

## Category breakdown vs. the pre-hardening baseline

The frozen corpus's `categoryCounts` (`parser-test-cases.json`) is the
categorization of the **345** fragments that failed in the *original*
2,295-fragment sweep (pre-hardening) — i.e. this is the "original sweep's
category counts" to compare against. Below, both sides are expressed as a
share of their *own* total fragment count (2,295 pre-hardening vs. 2,233
fresh) so the columns are comparable despite the different sample sizes.
The fresh column uses the regex-heuristic categorizer specified for this task
(checked in priority order: geometry → sets/congruence → ellipsis →
environment → set-minus → logic-misc → trailing-punct → divisibility-bar →
else other); it approximates, not reproduces, the corpus's own classifier.

| category | pre-hardening (345/2295) | pre-hardening share | fresh (58/2233) | fresh share | trend |
|---|---:|---:|---:|---:|---|
| geometry-notation | 148 | 6.4% | 5 | 0.22% | fixed almost entirely |
| ellipsis | 51 | 2.2% | 6 | 0.27% | mostly fixed, thin residual |
| trailing-punctuation | 47 | 2.0% | 2 | 0.09% | mostly fixed |
| sets-and-congruence | 36 | 1.6% | 5 | 0.22% | improved, residual persists |
| other | 32 | 1.4% | 35 | 1.57% | **now the dominant bucket** |
| divisibility-bar | 12 | 0.5% | 2 | 0.09% | mostly fixed |
| crash | 9 | 0.4% | 0 | 0% | fully fixed (Tier 1) |
| environment | 6 | 0.3% | 3 | 0.13% | partially fixed |
| set-minus | 2 | 0.1% | 0 | 0% | not observed fresh |
| logic-misc | 2 | 0.1% | 0 | 0% | not observed fresh |
| **total failing** | **345** | **15.03%** | **58** | **2.60%** | |

Headline: every large pre-hardening bucket shrank sharply in absolute and
proportional terms. What's left is a long tail of small, previously-invisible
notation gaps — the "other" bucket, at 35/58 (60%) of remaining errors, is now
where essentially all of the interesting new information is.

## NEW gap types (not in the known-residual list)

Known residuals excluded per the task brief (not re-reported):
`\text{...}` mid-expression, bare `N`/`D` binding to builtins, set arithmetic
`2\mathbb{Z}+1`, ASCII-pipe divisibility, algebraic-structure tuples
`(A,+,\cdot)`, stray `€`/`?` tokens, `\underbrace` edge forms, prose-heavy rows.

### 1. Polynomial-ring notation `\mathbb{Z}[x]`, `\mathbb{R}[X,Y]` — 5 fragments
Examples: `\mathbb{R}[X, Y]` · `\mathbb{Z}[x]` ·
`\theta : \mathbb{Z}[x] \to \mathbb{Z}`.
**Diagnosis:** `[...]` immediately after a blackboard-bold set head is read as
an index/subscript rather than the standard abstract-algebra "polynomial ring
over" notation, producing `incompatible-type`. Distinct from the known
`2\mathbb{Z}+1` set-arithmetic residual (that's a set ± scalar; this is a
bracketed variable list denoting a ring). Sizeable (5/58 = 8.6% of all
remaining errors) and a well-defined, common idiom — good hardening-plan
candidate.

### 2. Time-of-day notation with `{:}` — 4 fragments
Examples: `7{:}00` · `8{:}30` · `9{:}00PM` (source: "starts between
$8{:}30$AM and $9{:}30$AM").
**Diagnosis:** `{:}` (braced colon, a common LaTeX spacing idiom to avoid
`:` being read as a ratio/definition operator) yields
`expected-closing-delimiter`. All 4 instances came from a single row about
scheduling — a recognizable, recurring pattern in "at what time" problems.

### 3. Informal `\cap` between geometric objects (point-of-intersection idiom) — 4 fragments
Examples: `A_1 = AO \cap SBC` · `B_1 = BO \cap SAC` · `\{F\} = DI \cap AM`.
**Diagnosis:** implicit-multiplication segment labels (`AO` → `A·O`) default
to numeric type; `\cap`/`Intersection` requires `set`, so olympiad geometry's
informal use of ∩ for "the intersection point of lines AO and SBC" fails
type-checking (`incompatible-type 'set' 'finite_number'`). Different from the
known bare-`N`/`D` residual — this is a type mismatch on ordinary two-letter
labels, triggered specifically by `\cap`.

### 4. Trailing `?` (rhetorical/MCQ question mark) — 3 fragments
Examples: `\cos^2 x + 2\sin^2 x = 1?` · `\sum_{n=1}^{100} a_n^2?` ·
`a^3+b^3+c^3+5a^2+5b^2+5c^2?`.
**Diagnosis:** `unexpected-token '?'`. This is the exact same shape as the
already-shipped trailing-`.`/`;`/`,` tolerance (Tier 2, item #2 in the
hardening plan) but that fix's punctuation set didn't include `?`. Cheapest
possible follow-up — literally extend the existing character set. (Note:
stray bare `?` as a *token* is a listed known residual; this is specifically
the trailing-punctuation-after-a-complete-expression case, i.e. the Tier-2
mechanism, not the same thing.)

### 5. Square-bracket function-application/image notation `f[S]` — 2 fragments
Examples: `f[S]` · `f[\operatorname{divs}(m)]=\operatorname{divs}(n)`.
**Diagnosis:** parses as `At` (indexing into a dictionary/indexed collection)
rather than function application; `f` is a plain symbol (number type) so
indexing fails with `incompatible-type`. Common in set-mapping / number-theory
contexts (image of a set under a function).

### 6. Brace `\{ \}` as a third level of nested grouping (not set-builder) — 1 fragment
Example: `2-2\{2-2[2-2(4-2)]\}` (source: Brazilian MCQ, "é igual a:").
**Diagnosis:** CE only accepts `\{ \}` as set-builder delimiters, never as
plain nested parentheses, so the common regional textbook convention
`( ) → [ ] → { }` for nesting depth fails with `unexpected-operator`. Only one
instance here but a recognizable, likely-recurring convention worth a note
even at n=1.

### Lower-value / methodology notes (reported for completeness, not proposed as parser fixes)

- **Extraction-regex artifact, not a CE bug — escaped currency `\$` breaks
  `$...$` fragment pairing (4 fragments: bare `B)` `C)` `D)` `E)`).** Source
  row: `"...no bolso. Logo, tenho dinheiro para uma corrida de até:\nA)
  $2,5~\mathrm{km}$\nB) $5,0~\mathrm{km}$..."` — the literal `R\$ 10,00`
  earlier in the same row contains an escaped `\$` that the fragment
  extractor's naive `$...$` regex doesn't skip, shifting the delimiter
  pairing so the MCQ option letters get extracted as their own bogus
  fragments instead of the dollar amounts. This inflates the "other" bucket
  by ~7% of remaining errors but is a sampling-harness limitation, not
  something to fix in `ce.parse`.
- **Dangling relational/equals operator at a fragment boundary — 3
  fragments:** `< 1` · `< \pi /4` · `\frac{3\times2016+13\times2016}{1008} =`.
  All three are genuine source text (not extraction bugs) — MCQ stems that
  end in a bare `=` before the answer choices, or property descriptions like
  "has length $< 1$" where the subject is implied by surrounding prose. Same
  family as the shipped trailing-punctuation fix, generalized to a trailing/
  leading bare operator, but arguably not independently actionable since the
  input is fundamentally elliptical without its prose context.
- **Bare leading superscript with no base token — 3 fragments:**
  `^{\circ} \mathrm{C}` (a "°C" unit-only table header) and `^{c_{1}}`,
  `^{c_{2}}` (an apparent OCR/transcription artifact in the source dataset —
  "say $c_1$" rendered with a stray leading `^`). Mixed bag; the `°C`
  case is a legitimate standalone-unit idiom, the `c_1`/`c_2` cases look like
  upstream dataset noise rather than a parser gap.

## Full error list

See `errors.json` (58 records, full `latex`/`errCode`/`json` per fragment) and
`categorized.json` (heuristic bucket → fragment indices) in this scratchpad
directory. Raw per-fragment results: `fresh-results.jsonl` (2,233 records).

## Methodology note (false starts, scratch-only, no repo impact)

The task's literal `parse-sweep.ts <fragments> 0 999999 <out>` invocation
overrides the script's own `end = inputs.length` default, so it iterated past
the 2,233-element array and recorded ~997,766 spurious `throw` records for
`undefined` inputs. Caught immediately (the printed summary was obviously
wrong), discarded, and re-run with the correct `0 2233` bounds — the numbers
in this report are from that corrected, single, complete run. A second
mis-invocation (using positions 2/3 for input/out) also failed cleanly before
writing anything to the repo; confirmed via `git status` that no
`parse-results.jsonl` was left behind.
