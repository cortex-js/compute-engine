# Cortex Agent Eval — 2026-07-24

Empirical evaluation of how well a fresh-context LLM agent can write Cortex
using only the agent language card (`src/cortex/docs/for-agents.md`) and the
CLI (`cortex` run / `check --json` / `doc`). This measures the two artifacts
shipped earlier in the LLM-friendliness initiative and produces the
prioritized backlog for the next steps (card v2, idiom diagnostics).

## Methodology

- **6 Claude Sonnet subagents**, fresh context, 5 tasks each (30 tasks
  total, spanning arithmetic, collections, strings, dictionaries, control
  flow, recursion/closures, `match`, and symbolic computation).
- Only permitted resources: the language card and the CLI. Reading any other
  repo file and web search were forbidden.
- **Phase A**: write all 5 programs from the card alone, before any CLI run
  (measures the card). **Phase B**: run and repair, ≤ 3 evaluation runs per
  task; `check`/`doc` calls free (measures the feedback loop).
- **Grading was independent**: every final program (and divergent attempt-1
  program) was re-executed by the evaluator and compared against expected
  values that had been verified before the agents launched. Agent-reported
  engine behaviors were re-verified with direct probes before being recorded
  here as findings.

## Results

| Metric | Score |
|:--|:--|
| Final correctness (≤3 runs) | **30/30** |
| First-attempt correctness (card only, no tooling) | **29/30** |
| Tasks needing >1 run | 2 (C1: display confusion, 3 runs; C3: wrong function name, 2 runs) |
| `doc` lookups that unblocked a task | 1 (`doc split` → `StringSplit`, solving the only real miss) |

The single first-attempt failure: guessing `Split` for string splitting
(inert unknown call, **no did-you-mean fired**); recovered via `cortex doc`.
The C1 (FizzBuzz) attempt-1 program was value-correct but the agent spent 2
extra runs and self-graded "uncertain" because of list-display elision (see
finding 1).

Caveat: several tasks closely mirrored the card's worked examples (F1,
Euclid's gcd, is *verbatim* the card's loop example — pure transcription).
First-attempt scores are partly a measure of example coverage, which is
itself the lesson: **agents transcribe worked examples near-perfectly and
guess library names by convention when examples run out.**

## Verified findings, ranked

1. **Derived collections elide their text display; literals don't.**
   `Range(1,15)`, `Map(...)` results, and loop-built `Join` lists print as
   `[1,2,3,4,5,...,11,12,13,14,15]` above 10 elements (first 5 + last 5); a
   30-element *literal* prints in full. The elided form cost an agent 2 runs
   and a wrongly-hedged self-grade — it reads as "still lazy/unevaluated,"
   and there is no CLI flag to expand it (`--json` does show everything, but
   nothing says so). Note the `Join`-built list is fully materialized — the
   preview cap applies to it anyway.
2. **Did-you-mean coverage gaps.** `Split` → no suggestion (expected
   `StringSplit`); `Head` → none (expected `First`); `print` → none (a
   targeted "there is no print; the program's value is its last statement"
   hint would convert this instantly). Working today: `len`→`Length`,
   `range`→`Range`, `Reversed`→`Reverse`, `Quartile`→`Quartiles`.
   `doc` keyword gaps from failed queries: `words`, `materialize`.
3. **The card under-documents library names.** Every agent had to guess at
   least one operator name by capitalization convention: `Reverse`,
   `Values`, `Max`, `Mean` (prose-only in the card), `StandardDeviation`,
   `Range(a, b, step)`, `StringSplit`, tuple indexing, nested-matrix
   indexing (`m[2][1]` guessed; `m[2,1]` also works but wasn't risked).
   Two agents hand-rolled trial-division primality because the card never
   mentions `IsPrime`. All guesses happened to succeed — but the agents
   correctly identified them as gambles.
4. **Output rendering is undocumented and misleads.** The CLI prints the
   engine `toString()` form: strings and booleans appear quoted (`"True"`),
   which caused a genuine "did I compute a string instead of a boolean?"
   scare and probe runs.
5. **Semantics agents got right but could not have predicted.**
   - `let x = 2` then `D(x^3 + x, x)`: the differentiation variable stays
     symbolic even though `x` is bound, and the result then evaluates at
     `x = 2` (correct, surprising, undocumented).
   - Related warts found while preparing the eval: `let g = Derivative(f)`
     then `g(2)` fails (`incompatible-type`) although `Derivative(f)(2)`
     works inline; and `let d = D(x^3+x, x); x = 2` — bare `d` does **not**
     substitute (`3x^2 + 1`) but `N(d)` does (`13`): an evaluate/N asymmetry
     on stored symbolic values worth an engine triage.
   - `Max([...])` works, but its signature reads `(value*) -> number` —
     nothing documents that a single collection argument is accepted.
   - `Sort` has a comparator parameter but no documented descending idiom
     (agent used `Reverse(Sort(...))`).

## Recommended actions

**Card v2 (cheap, do first):**
- Add a compact "library quick roster" of verified names: `Reverse`,
  `Sort` (+ comparator), `Max`/`Min`, `Values`/`Keys`, `IsPrime`,
  `StringSplit` (default = whitespace), `Range(a, b, step)`, `Mean`/
  `StandardDeviation` (sample convention), `First`/`Last`/`Take`/`Drop`,
  `Abs`/`Floor`/`Round`. Mention tuple indexing `p[1]` and both matrix
  forms `m[2,1]` / `m[2][1]`.
- Document output rendering: values print in engine form (strings/booleans
  quoted); derived collections preview-elide with `...` above 10 elements —
  use `--json` for the full value.
- One line on `D`/`Integrate` binder semantics: the bound variable is
  always treated symbolically, even if it has a value in scope.

**Idiom diagnostics (item 4 backlog, priority order):**
- Curated suggestions: `Split`→`StringSplit`, `Head`→`First`,
  `Tail`→`Rest`; targeted hint for `print`.
- `keywords` additions so `doc` finds: `words`/`split` → `StringSplit`
  (`split` already works; `words` doesn't).

**CLI/engine triage (needs an owner decision):**
- List-display elision: document it, and consider expanding finite
  materialized collections in CLI output (the current cap treats a
  materialized `Join` result like a lazy stream).
- Evaluate/N asymmetry on stored symbolic values (`d` vs `N(d)` above).
- Stored `Derivative(f)` not callable.
- Signature display convention for variadic operators that also accept a
  collection (`Max`, `Min`, `Sum`, …).

## Validation round (same day, after card v2 + diagnostics landed)

A second eval with a **different model family** (Kimi, via the local
`kimi -p` CLI; fresh context, same card + CLI protocol) on 6 tasks aimed at
this round's fixes: word counting, ceiling, descending sort, integer
quotient, first/last as a pair, and a task deliberately phrased with the
word "Print".

**Result: 6/6 correct on first attempts, zero diagnostics needed.** The
fixes did their job upstream: the agent used `StringSplit` directly from the
new roster (the exact gap behind the first round's only failure), `Ceil`
because the roster says "not `Ceiling`", the descending-comparator `Sort`
from the new example, `Floor(17 / 5)` from the reflex table, and produced
the list as the program's value for the "Print" task, citing the card's
no-print explanation. The new lints and hints were never exercised — the
card prevented the mistakes they exist to catch, which is the intended
layering (docs prevent, diagnostics rescue).

Residual friction it reported: no integer-quotient or word-count operator
(composition required — arguably fine), and per-function output formatting
(exact `3` vs `3.0`) not predictable in advance.

**Next eval round (when card v2 lands):**
- Drop tasks that mirror card examples verbatim (F1).
- Add harder compositional tasks (string building, nested data reshaping,
  dictionary-heavy programs, units) — this round hit a ceiling that says
  the tasks were too close to the card's competence envelope, not that
  Cortex is done.
- Optionally allow `doc` during phase A as a separately-scored mode, since
  doc-first is the natural agent workflow.
