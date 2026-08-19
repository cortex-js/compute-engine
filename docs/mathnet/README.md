# MathNet × Compute Engine

Regression corpus and reproducibility tooling derived from a July 2026
assessment of the
[ShadenA/MathNet](https://huggingface.co/datasets/ShadenA/MathNet) olympiad
dataset (27,817 problems) for validating the Compute Engine.

The original sample measured 85% clean parsing over 2,295 real fragments and
found nine throwing cases. After the hardening campaign, an independent
800-row sample measured 97.4% clean parsing over 2,233 fragments with no throws
or hangs. MathNet is useful for parser and answer-normalization regression
testing, not as an end-to-end solver benchmark.

## Contents

| file | what |
|---|---|
| [mathnet-characterization.md](./mathnet-characterization.md) | Dataset statistics and acceptance-case provenance still referenced by active solver work |
| [parser-test-cases.json](./parser-test-cases.json) | **Curated regression corpus**: 345 originally failing LaTeX fragments + 83 follow-up fragments + 19 failing answer strings, categorized (captured on v0.67.0 plus follow-ups) |
| [math-genre-sweep.md](./math-genre-sweep.md) | **Genre-coverage sweep** (2026-07-09) over Hendrycks MATH (15,546 fragments, all 7 subjects incl. worked solutions): 95.27% clean, ranked new-notation gap list |
| [math-genre-failures.json](./math-genre-failures.json) | The 735 failing MATH fragments, tagged by motif (`latex`/`config`/`errCode`/`motifs`) |
| [roundtrip-exceptions.json](./roundtrip-exceptions.json) | **Versioned exception list** for the serialize→parse round-trip property (below), grouped into failure `classes` with a `reason` (`bug` / `documented-lossy`) |
| [scripts/](./scripts/) | Regeneration + progress-check scripts (below) |

The bulky intermediate data (row samples, full sweep results, ~9 MB of JSONL)
is deliberately **not** stored — it is recreated in a few minutes by the
scripts.

## Checking parser progress

```sh
npx tsx docs/mathnet/scripts/check-corpus.ts             # per-category fixed/total
npx tsx docs/mathnet/scripts/check-corpus.ts --failures  # list survivors
npx tsx docs/mathnet/scripts/check-corpus.ts --update    # record current outcomes
```

Every original corpus case failed when captured; the appended fresh-sample
follow-up cases record newly observed gaps from later validation. A case is
*fixed* when `ce.parse()` returns a valid expression with no `Error`
subexpression and no throw. Baseline at original capture: 3/345 fragments
pass, 9 throws. The expanded local corpus currently contains 428 fragments.
Each entry's `observed` field records the parser outcome as of `lastChecked`
and is an enforced contract: the checker lists improvements (recorded failing,
now clean), error-code changes, and **regressions** (recorded clean, now
failing) — regressions or any throw make it exit non-zero. Run `--update`
after reviewing the changes to refresh `observed` and `lastChecked`.
The checker parses each input in a **fresh engine**: a shared engine lets
free-symbol type inference from one fragment contaminate another's parse,
under-counting fixes.

State after the 2026-07-04 hardening (Tiers 1–4): **265/345**, throws 0.
Current local state after later follow-ups and the appended fresh-sample tails:
**350/428** fragments and **14/19** answer strings, throws 0.

**Independent validation:** a fresh 800-row sample (offsets disjoint from
the original) measured **97.4% clean** (2,175/2,233 fragments), 0 throws —
up from the 85.0% pre-hardening baseline. The small newly observed tail was
added to `parser-test-cases.json`.

**Expanded local corpus:** a later 1,600-row shifted sample
(`--pages 16 --offset-shift 869`) produced 4,201 unique fragments. The sweep
found 165 parse errors and 0 throws; 57 representative new failures were
appended to the local corpus. The raw sample and sweep outputs are not checked
in.

**2026-07-09 sample:** another 1,600-row disjoint sample
(`--pages 16 --offset-shift 2600`, 4,195 unique fragments) measured **97.64%
clean** (4,096/4,195), 0 throws, after the un-applied-operator devolution,
trailing-ellipsis recovery, and set label tolerance landed. 15 representative
new failures were appended (categories: `sequence-braces`,
`trailing-qualifier`, `trailing-label`, `set-relation-subscript`,
`greek-capital`, plus divisibility/arc variants).

## Serialize→parse round-trip property

```sh
npm run check:roundtrip                # pass/fail counts + failure classes
npm run check:roundtrip -- --failures  # list every failure with its class
npm run check:roundtrip -- --update    # regenerate roundtrip-exceptions.json
```

Stage 3 "corpus lane" of
[the parse/scope contract](../SCOPING-MODEL.md)
§ D (Tycho item 153). For every corpus input that parses cleanly, the checker
asserts

```ts
const t = ce.parse(input);        // CANONICAL
ce.parse(t.latex).isSame(t);      // STRUCTURAL tier (`Same`), deliberate
```

Engine discipline mirrors `check-corpus.ts`: **one fresh engine per corpus
row**, with both the parse and the reparse on that same engine — `isSame`
compares symbol binding definitions by identity, so a cross-engine comparison
is false for every symbol and the property would be vacuous. The consequence
is a real failure class (`inference-drift-canonical-order`): the first parse
leaves inferred types in the engine and those can change how the reparse
canonicalizes. Inputs that do not parse cleanly are skipped — this harness
measures the serializer; `check-corpus.ts` owns parser coverage.

Failures are reconciled against
[roundtrip-exceptions.json](./roundtrip-exceptions.json). **CI fails on a
failure that is not in the list, and on a listed failure whose defect has
drifted** (the reserialized LaTeX or the mismatch no longer matches the
recorded one) — a regression that turns a known failure into a different one
must not pass silently. Listed entries that now pass are reported without
failing, and `--update` refreshes drifted entries. `--update` rewrites the list
(new entries land as class `unclassified` / reason `bug` — triage them, and
add the class to the `classes` table with a minimal repro).

Not every listed class is a defect. A class carrying `reason:
"documented-lossy"` is a shape the serializer is **contractually allowed** to
lose at the structural tier: the rendering it picks is value-preserving
prettification, so the round-trip property holds up to value but not up to
structure, and `isSame` — a syntactic comparison — reports a mismatch by
design. Two classes are ruled that way (maintainer ruling, 2026-08-04): a
`Multiply` carrying a `Divide`/reciprocal factor is emitted as one fraction
over the whole product (`\frac{1}{2}\cdot\frac{1}{a+x}` → `\frac{1}{2(a+x)}`),
and the fallback used when a denominator itself contains a fraction, which
renders `(a)(b)^{-1}` and parses back as a `Multiply`. CI counts these separately
from `bug` entries and treats them as accepted contract, not as defects to
fix — reclassifying one back to `bug` is a deliberate ruling, not routine
triage.

State at introduction (2026-08-04, v0.100.3): 447 corpus inputs, 59 skipped,
**351/388 round-trip**, 37 exceptions in 15 classes, all currently classified
`bug`. Runtime ~11 s on an idle machine.

After the 2026-08-04/05 serializer fix rounds: **385/391 round-trip**, 6
exceptions in 2 classes, all `documented-lossy` (the two ruled classes
above) — **zero `bug` rows**. The last bug class
(`negate-vs-multiply-minus-one`) was closed by ruling on 2026-08-05:
`canonicalMultiply` re-extracts a fold-produced negative real coefficient
into the sign channel, so `Multiply(-1, …)` and `Negate(Multiply(…))` no
longer coexist as canonical spellings. The corpus grew by 3 checked inputs
along the way (rows that previously failed to parse cleanly now do).

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

For the cross-genre variant (Hendrycks MATH instead of MathNet), use
`fetch-math.py` + `extract-math-fragments.py` and see
[math-genre-sweep.md](./math-genre-sweep.md) — including the sweep-chunking
note (the fresh-engine-per-fragment pattern OOMs past ~4,900 engines in one
process).
