# Genre-Coverage Sweep: Hendrycks MATH (2026-07-09)

> **Status (2026-07-09, same day):** the top five ranked opportunities below
> were implemented (`\frac`/`\binom` mixed-brace bug, styling commands, `\|`
> norm, infix `\choose`, bare `\pmod` + congruence-chain derail — see
> CHANGELOG "LaTeX Parsing"). Re-sweeping the 735 failing fragments: **282
> now parse clean**, taking the corpus from 95.27% to **97.09%**
> (15,093/15,546). Per-motif: frac-mixed-brace 31/31, norm 67/67, choose
> 48/49, styling 69/80, bare-pmod 38/46, pmod-chain 12/21, plus 15
> matrix-env and 14 "other" fixed incidentally. The remaining tail is
> tracked in ROADMAP "MATH genre-gap fixes".

One-off sweep answering the ROADMAP question: *does the ~97.5% clean-parse
rate measured on MathNet generalize beyond olympiad notation?* MathNet is
~2% calculus/analysis with no stats or units content, so the hardening could
in principle have overfit to olympiad idioms.

**Corpus:** [EleutherAI/hendrycks_math](https://huggingface.co/datasets/EleutherAI/hendrycks_math)
(the MATH dataset, Hendrycks et al. 2021, MIT). 2,100 rows sampled evenly
across all 7 subject configs (3 × 100-row pages per subject, train split),
taking **both `problem` and `solution` text** — solutions are LaTeX-dense
worked derivations, a genre MathNet does not have at all. `[asy]…[/asy]`
Asymptote blocks are stripped before fragment extraction (they contain
`$…$` label strings that are not document math), and escaped `\$` (currency,
ubiquitous in prealgebra) is not treated as a math delimiter.
Result: **15,546 unique fragments**.

**Headline: 95.27% clean (14,811/15,546), 0 throws, 0 hangs** (v0.71.0-dev,
2026-07-09 main). Excluding the 44 failing fragments that are extraction
noise (`(`, `(*)`, …), the genuine-failure rate is ~4.4%.

Per subject:

| subject | clean | rate |
|---|---|---|
| intermediate_algebra | 3,149/3,202 | 98.34% |
| algebra | 1,945/2,012 | 96.67% |
| precalculus | 2,853/2,970 | 96.06% |
| geometry | 2,515/2,622 | 95.92% |
| prealgebra | 1,024/1,096 | 93.43% |
| counting_and_probability | 1,255/1,364 | 92.01% |
| number_theory | 2,070/2,280 | 90.79% |

**Verdict: the clean rate generalizes.** Pure-algebra genres parse at
96–98%, i.e. at or near the MathNet level. The 2–7 point gap in the weaker
genres is not diffuse — it decomposes into a compact set of identifiable
notations (below), most of which MathNet simply never exercised.

## Failure inventory

735 failing fragments, tagged (overlapping motifs) in
[math-genre-failures.json](./math-genre-failures.json). Ranked by count,
with individually verified representative repros:

| # | motif | verified repro | note |
|---|---|---|---|
| 80 | `style-command` | `\textbf{Sizes}`, `\emph{very}`, `\bold{v}`, `\mbox{th}` | styling wrappers unknown; `\mathbf` already works |
| 67 | `norm-double-bar` | `\|\mathbf{a}\|` | `\|` unexpected-command; vector-norm staple of precalculus |
| 49 | `choose-infix` | `{4028 \choose 2014}` | TeX-primitive infix binomial; `\binom`/`\dbinom` already work |
| 46 | `units-in-text` | `(18 \text{ inches})/(12 \text{ inches/foot})` | prose-units arithmetic; overlaps CE's units work |
| 46 | `bare-pmod` | `1 \pmod 7`, `-811\pmod{24}` | `x \pmod n` **without** `\equiv`; parser demands the congruence form |
| 38 | `array-env` | `\begin{array}{c@{}c…}` + `\cline`, `\stackrel` | long-division / column-addition layouts; presentational, low value |
| 36 | `ascii-pipe-divides` | `3\|2k+1`, `10^{6}-1 \| 10^{6k}-1` | known backlog item (ascii-pipe divisibility) |
| 31 | `frac-mixed-brace` | `\frac1{-1}`, `\frac{900}7` | **BUG**: mixed braced/unbraced `\frac` args → `Error 'missing'`; `\frac12` and `\frac{1}{2}` both fine |
| 30 | `ellipsis` | `0.ababab\dots`, `\dots\implies 94` | new contexts beyond the landed trailing-ellipsis recovery |
| 21 | `pmod-chain` | `1+6n\equiv 4\pmod 7\implies n\equiv 4\pmod 7` | congruence followed by `\implies` derails the `\pmod` parse |
| 20 | `matrix-env` | `\renewcommand{\arraystretch}{1.5}`, `\|`-columns | residual matrix decorations; plain `pmatrix` works |
| 16 | `base-subscript-numeral` | `10111_2-x`, `161_{b}+134_{b}=315_{b}` | base-b positional numerals; number-theory genre staple |
| 15 | `prime-after-arg` | `2 \sin a = 2 \sin a'` | prime on a juxtaposed function argument |
| 13 | `ordinal-th` | `13^{\text{th}}`, `30^{\mbox{th}}` | ordinal superscripts → Power(13, string) type error |
| 10 | `empty-scripts` | `0^{}_{}` | empty `^{}`/`_{}` groups (MATH uses them as spacing hacks) |
| 10 | `cancel` | `\cancel{5}`, `\cancelto{2}{3}` | cancellation marks in worked arithmetic |
| 9 | `thousands-sep` | `18{,}360.` | `{,}` thousands separator |
| 9 | `nabla-custom-op` | `2 \nabla 5` | "define custom operation" puzzle problems; `\nabla` unknown |
| 7 | `double-factorial` | `(2n)!! = 2^n \cdot n!` | `Factorial2` signature demands `integer`; rejects symbolic `(2n)` |
| 6 | `stackrel-overset` | `\stackrel \frown {AB}` | arc notation via `\stackrel`; also `\stackrel{(3)}{=}` in derivations |
| 4 | `not-prefix` | `2019^8 \not\equiv -1 \pmod{17}` | `\not` combining prefix unsupported (only pre-composed `\ne` etc.) |
| 2 | `bracket-grouping` | `(x+\sqrt{2})[(x+\sqrt{2})^2+1]=0` | `[…]` as multiplication grouping parses as `At` indexing |
| 44 | `extraction-noise` | `(`, `(*)` | harness artifacts, not CE gaps |
| 176 | `other` | mixed | mostly compounds of the above + prose-in-math (`(9\text{ to }80)^2`), repeating decimals `0.abab\overline{ab}` |

Cross-check against MathNet's landed hardening: the recoveries that landed
for MathNet (trailing punctuation/ellipsis/labels, `\equiv…\pmod`
congruences, geometry heads, `aligned`/`cases` environments) all held up
here — plain `\begin{aligned}` blocks, `\angle`/`\triangle`, and
`a \equiv b \pmod n` parse fine. The failures above are *new* genre
notations, not regressions of old ones.

## Ranked opportunities

1. **`\frac` mixed-brace bug (31 + spillover into `other`)** — the only
   genuine *parser bug* found (`\frac1{-1}`, `\frac{900}7`). Everything else
   is missing vocabulary/notation. Small fix, real-world LaTeX (compact
   fractions are everywhere in human-written solutions).
2. **Styling no-ops (80)** — `\textbf`/`\textit`/`\emph`/`\mbox`/`\bold` as
   transparent (or `Annotated`) wrappers, matching existing `\mathbf`
   handling. Trivial, top count.
3. **`\|` norm delimiters (67)** — `\| x \|` → `Norm`. Precalculus staple.
4. **`{n \choose k}` (49)** — infix `\choose` → `Binomial` (same shape as
   the existing `\atop`-style handling if any, else a scanner special).
5. **Bare `\pmod` (46 + 21 chain)** — `x \pmod n` without `\equiv` →
   `Mod`-annotation / inert congruence tail; also stop the
   `\pmod n \implies` derail.
6. **ascii-pipe divisibility (36)** — already on the backlog; this doubles
   its evidence base.
7. **Base-subscript numerals (16)** — `10111_2`, `161_b` → a `BaseForm`-ish
   inert head or integer literal when the base is a literal. Needed for any
   number-theory content, not just MATH.
8. Small recoveries, cheap each: ordinal `^{\text{th}}` (13, devolve to the
   base number), empty scripts `^{}` (10, drop), `{,}` thousands separator
   (9), `\cancel`/`\cancelto` (10, unwrap to argument), `\not` prefix (4,
   compose negated relation), `Factorial2` symbolic signature (7).
9. **Not worth parsing:** `array`-env column-spec layouts (38, long-division
   diagrams — presentational), `\nabla` custom-op puzzles (9, problem-local
   definitions), repeating decimals with symbolic digits (`0.abab…`).

## Reproduction

```sh
cd docs/mathnet/scripts
python3 fetch-math.py                        # 2,100 rows -> math-sample.jsonl
python3 extract-math-fragments.py            # -> math-fragments.json
npx tsx parse-sweep.ts math-fragments.json   # sweep (see chunking note)
```

**Chunking note:** the original run of this sweep hit V8's 4 GB heap ceiling
at ~4,900 fragments: with a fresh engine per fragment, every engine built in
a synchronous loop stayed pinned (~430 KB each, 0 of 2,001 collected under
`FinalizationRegistry`, source and 0.71.0 dist alike). Root cause — a
standalone CE bug discovered by this sweep: constant definitions subscribed
to configuration changes via `new WeakRef(...)`, and the ECMAScript
kept-objects rule pins every `WeakRef` target until the job yields to the
event loop, so a synchronous burst of constructions retained them all.
Fixed 2026-07-09 (`src/common/configuration-change.ts` holds listeners
strongly; see CHANGELOG) — the sweep now runs in one process with a flat
heap. Against a pre-fix build (≤0.71.0), chunk the sweep to ≤2,500 fragments
per process (`parse-sweep.ts <file> <start> <end> <out>` appends when
`start > 0`).

Raw sample/sweep JSONL (~20 MB) is deliberately not checked in — only the
scripts, this report, and the tagged failure list
([math-genre-failures.json](./math-genre-failures.json), 735 entries with
`latex`/`config`/`errCode`/`motifs`).
