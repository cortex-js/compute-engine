# Parser Hardening Plan — MathNet findings

**Date:** 2026-07-04 · **Baseline:** 85.0% clean parse (1,950/2,295 fragments),
9 throws, 0 hangs (see [ce-mathnet-experiment.md](./ce-mathnet-experiment.md)).
**Progress metric:** `npx tsx docs/mathnet/scripts/check-corpus.ts` against
[parser-test-cases.json](./parser-test-cases.json) (345 failing fragments +
19 failing answer strings, categorized).

Ranked by fragments recovered per unit of effort. Corpus category counts are
from the corpus's heuristic classifier and differ slightly from the experiment
report's hand counts; the corpus checker is the source of truth for progress.

> **Status 2026-07-04: Tiers 1–3 executed.** Corpus 3/345 → **245/345**
> (baseline 85.0% → ~95.6% clean on the original sweep), throws 9 → **0**.
> Category state: crash 9/9 · geometry 148/148 · ellipsis 41/51 ·
> trailing-punct 37/47 · sets-congruence 5/36 · divisibility 4/12 ·
> unicode answers 8/19. Remaining failures are Tier 4 material (environments,
> `\mathbb{Z}` arithmetic, `\mathbb{R}_{>0}`, ASCII-pipe divisibility),
> `\text{...}` prose fragments, or intentionally-malformed input.
> Notable: `\parallel` was remapped from logical `Or` to geometric
> `Parallel` (breaking for anyone relying on `\parallel`-as-Or; `\lor`/`\vee`
> unchanged) — flag in the CHANGELOG.

## Tier 1 — bug fix (unconditional)

### 1. `ContinuationPlaceholder` crash — 9 fragments, effort S

Ellipsis in a numeric context (`(1!)^2 + (2!)^2 + \dots + (2018!)^2`) throws
`The type of the constant "ContinuationPlaceholder" cannot be changed` from
`boxed-value-definition.ts:224`, reached via `checkNumericArgs` →
`BoxedSymbol.infer`. Root cause: `infer()` attempts to narrow the type of a
built-in **constant**; inference should be a no-op (return `false`) on any
symbol whose definition is a constant. Fix regardless of the rest of this
plan — a parser input must never throw. Acceptance: `check-corpus.ts` reports
`throws: 0`.

## Tier 2 — packaging tolerance (error recovery)

These fire **only when the parse would otherwise produce an Error node**, so
they are safe in strict mode too: no currently-valid input changes meaning.
(The `strict` flag gates validation depth, not tolerance of clearly-broken
input; recovery that rescues an otherwise-Error parse belongs in both modes.)

### 2. Trailing sentence punctuation — 47 fragments, effort S–M

`(x^2-1)^2 (y^2-1)^2 + 16x^2 y^2 = z^2.` — a full equation ending in `.` (or
`;`, `,`) yields `Sequence` + `unexpected-operator`. Recovery: if the parse
fails and the input ends with terminal punctuation, drop it and re-parse
(or equivalently, treat a trailing punctuation token at top level as
end-of-input). **Trap:** `5.` is a valid decimal literal — only strip when the
parse *with* the punctuation produces an Error.

### 3. Ellipsis tolerance in lists/sums — 51 fragments, effort M

`\cdots`/`\ldots`/`\dots` already parse to `ContinuationPlaceholder` but then
error as an operand of `Add`/`Multiply`/`Tuple`. Tier-2 goal is *tolerance
only*: accept the placeholder as an inert operand (after the Tier-1 fix stops
the type-inference crash), round-trip it to `\cdots` on serialization, and
leave the expression unevaluatable-but-valid.

*Deferred tier:* semantic recognition (`1 + 2 + \cdots + n` → `Sum(k, k=1..n)`,
`(a_1, \ldots, a_n)` → indexed sequence) is effort L and belongs behind a
separate decision — it changes meaning, so if pursued it is non-strict-mode
territory.

**Tier 1+2 target: ~89% clean, 0 throws.**

## Tier 3 — vocabulary (dictionary additions, mode-independent)

### 4. Unicode tokens — 19 answer cases + fragments, effort S

Add to the tokenizer/dictionary: `≡` (congruence), `∈` (`Element`), `∪` `∩`
(`Union`/`Intersection`), `…` (Unicode ellipsis → same handling as `\ldots`),
`∠` (with #6), `≈` (approx-equality head). CE already accepts
`− ≤ ≥ ≠ √ π ∞ ⌊⌋ × · ° ℤ {…}` — this is the short missing tail, and it is
what blocks `final_answer` normalization (`n ≡ 1 (mod 3)`, `n ∈ {3,4,5,…}`).

### 5. Congruence and divisibility — ~48 fragments, effort M

`a \equiv b \pmod{n}`, `\bmod`, and `a \mid b` / `p \nmid ab` idioms. Parse to
evaluable heads: `Congruent(a, b, n)` reducing via `Mod`, and a
`Divides`-style relation. This is the one vocabulary item with real
number-theory value beyond parse coverage (it also unlocks answer-equivalence
checks on congruence-shaped answers). Check what already exists (`Mod` does;
a congruence relation head may not) before adding.

### 6. Geometry notation as inert heads — 148 fragments, effort S–M

`\angle`, `\varangle`, `\triangle`, `\widehat`, `\overparen`, `\perp`,
`\parallel`, `\square`. Largest single bucket. Treatment: inert shell heads
(the Fungrim shell-head pattern) — parse and serialize faithfully, no
evaluation semantics, no commitment to modeling geometry.
**Decision (2026-07-04): approved.** Consumers (e.g. Tycho) can use the
faithful structural parse for graphical representations; CE stays
semantics-free on geometry.

**Tier 1+2+3 target: ~93–95% clean (with #6), ~89–91% (without).**

## Tier 4 — structural tail (effort M–L each, low counts)

- `\begin{aligned}`/`align`/`cases` environments → systems of equations
  (6 fragments; real value later for multi-equation `Solve`).
- Subscript-qualified sets `\mathbb{R}_{>0}`, `\mathbb{N}_{>1}`
  (`expected-closing-delimiter` today).
- `\backslash` as set-minus; `\forall`, `\exists`, `\langle…\rangle`.
- Stray-token tolerance (`€`, `?`) — probably *should* stay errors.

## Validation loop

1. After each tier: `npx tsx docs/mathnet/scripts/check-corpus.ts`
   (add `--failures` to list survivors). Throws must stay 0 from Tier 1 on.
2. Promote each fixed category into permanent jest tests under
   `test/compute-engine/latex-syntax/` (a handful of representative cases per
   category, not the whole corpus).
3. Occasionally re-run the full pipeline on a *fresh* sample
   (`scripts/fetch-sample.py` → `extract-fragments.py` → `parse-sweep.ts`)
   to catch categories the frozen corpus can't see.

## Related follow-ups (out of scope here)

- **`Solve` domain extension** (agreed direction: extend `Solve`, not a new
  `SolveWhen` head): `Solve(eq, n ∈ 1..1000)` — symbolic solve first, then
  filter to domain; enumeration fallback via `compile()` + `checkDeadline`
  when the domain is finite and small. Multi-variable = bounded cartesian
  product.
- **Diophantine solving** (linear, Pell, sum-of-squares): assess SymPy's
  BSD-licensed `diophantine` module as a porting corpus (not covered by the
  2026-06-10 dataset-candidates research).
