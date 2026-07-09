# MathNet × Compute Engine

Feasibility assessment (2026-07-04) of the
[ShadenA/MathNet](https://huggingface.co/datasets/ShadenA/MathNet) olympiad
dataset (27,817 problems) for validating the Compute Engine.

**Verdict:** excellent *parser-hardening* corpus (85% clean parse on 2,295
real fragments; failures cluster into a short ranked gap list, plus one
genuine crash); usable for *answer normalization* with a prose filter; **not**
an end-to-end solver benchmark (CE verifies expressions, it does not solve
word problems — 0/10 spot-checked problems were machine-usable without human
modeling).

## Contents

| file | what |
|---|---|
| [mathnet-characterization.md](./mathnet-characterization.md) | Dataset statistics (3,100-row sample): topics, answer formats, best/worst-case examples |
| [ce-mathnet-experiment.md](./ce-mathnet-experiment.md) | The three CE experiments: fragment parse sweep, `final_answer` sweep, 10 end-to-end case studies |
| [parser-hardening-plan.md](./parser-hardening-plan.md) | Ranked work plan derived from the findings |
| [parser-test-cases.json](./parser-test-cases.json) | **Curated regression corpus**: 345 originally failing LaTeX fragments + 68 follow-up fragments + 19 failing answer strings, categorized (captured on v0.67.0 plus follow-ups) |
| [scripts/](./scripts/) | Regeneration + progress-check scripts (below) |

The bulky intermediate data (row samples, full sweep results, ~9 MB of JSONL)
is deliberately **not** stored — it is recreated in a few minutes by the
scripts.

## Checking parser progress

```sh
npx tsx docs/mathnet/scripts/check-corpus.ts             # per-category fixed/total
npx tsx docs/mathnet/scripts/check-corpus.ts --failures  # list survivors
```

Every original corpus case failed when captured; the appended fresh-sample
follow-up cases record newly observed gaps from later validation. A case is
*fixed* when `ce.parse()` returns a valid expression with no `Error`
subexpression and no throw. Baseline at original capture: 3/345 fragments
pass, 9 throws. The expanded local corpus currently contains 413 fragments.
`throws` must reach and stay 0. The checker parses each input in a **fresh
engine**: a shared engine lets free-symbol type inference from one fragment
contaminate another's parse, under-counting fixes.

State after the 2026-07-04 hardening (Tiers 1–4): **265/345**, throws 0.
Current local state after later follow-ups and the appended fresh-sample tail:
**298/413** fragments and **12/19** answer strings, throws 0. See the Status note in
[parser-hardening-plan.md](./parser-hardening-plan.md) for the original pass.

**Independent validation:** a fresh 800-row sample (offsets disjoint from
the original) measured **97.4% clean** (2,175/2,233 fragments), 0 throws —
up from the 85.0% pre-hardening baseline. Details and the small list of
newly-observed gap types:
[fresh-sweep-report.md](./fresh-sweep-report.md).

**Expanded local corpus:** a later 1,600-row shifted sample
(`--pages 16 --offset-shift 869`) produced 4,201 unique fragments. The sweep
found 165 parse errors and 0 throws; 57 representative new failures were
appended to the local corpus. The raw sample and sweep outputs are not checked
in.

## Regenerating from scratch

```sh
cd docs/mathnet/scripts
python3 fetch-sample.py --pages 8 --out sample.jsonl   # ~800 rows via HF API
python3 fetch-sample.py --pages 16 --offset-shift 869 --out shifted.jsonl
python3 extract-fragments.py sample.jsonl --out fragments.json
npx tsx parse-sweep.ts fragments.json                  # -> parse-results.jsonl
```

Run the sweep on a *fresh* sample occasionally: the frozen corpus can only
measure the gaps known at capture time.
