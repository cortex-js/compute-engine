# Ellipsis Interpretation — `Interpret` design

**Date:** 2026-07-09 · **Status:** v1 in implementation

## Problem

The ellipsis fold barrier (CHANGELOG 2026-07-09) made `Add`/`Multiply`
expressions containing a `ContinuationPlaceholder` honest notational objects:
`1 + 2 + \dots + n` parses to `["Add", 1, 2, "ContinuationPlaceholder", "n"]`
with source order and nested anchors preserved, and is inert under
`evaluate()`/`N()`/`simplify()`. This document is the path from *notation* to
*meaning*: `Sum(k, (k, 1, n))`.

## Decision: an explicit operator head (Option A)

`["Interpret", expr]` — evaluating it runs the inference and returns
the interpreted expression, or the argument unchanged when nothing passes the
gate. Interpretation is a guess the caller opts into:

- explicit, serializable, reachable from MathJSON (a UI can wrap-and-evaluate);
- avoids the simplify cost function (a `Sum` scores as *more* complex than the
  inert `Add`, so a simplify rule would be cost-rejected) and the rule-system
  machinery (the inference is an algorithm — anti-unification — not a
  declarative pattern);
- leaves the default-on question open: once usage shows the gate is
  trustworthy, bare `evaluate()` can call the same internal function — a
  one-line promotion, no API break.

Rejected alternatives: default-on in `evaluate()` (a wrong guess becomes a
correctness bug; no usage data yet), an opt-in simplify rule set (fights the
cost function, clunkier for consumers), parse-time interpretation (the
`[1,2,\ldots,10]` → `Range` precedent is lossless for a list literal;
`Add`-interpretation is irreversible and destroys the display form).

## Architecture

- **Core recognizer** (the shared asset): `inferContinuationPattern(expr)` in
  `symbolic/` — given sample terms and an optional anchor, infer a general
  term and bounds. The head is a thin wrapper; future heads (e.g. a
  `RecognizeSequence(list)` over plain sample lists) reuse the same core.
- **Head declaration** in the library: `lazy`, signature `(any) -> any`-class
  (implementer picks the honest typing), no LaTeX dictionary entry needed
  (functional-form serialization is fine for an API-level head).

## v1 gate (strict by design — inert beats wrong)

Handles a canonical `Add` or `Multiply` of the shape
`[s₁, …, sₘ, ContinuationPlaceholder, A]` (source order, per the fold
barrier):

- **m ≥ 2 numeric sample terms** forming an arithmetic progression with
  difference `d ≠ 0` (exact integers/rationals only in v1).
- **Exactly one anchor `A`** after the placeholder. The general term is
  `t(k) = s₁ + (k−1)·d`; the upper bound is `U = (A − s₁)/d + 1`, computed
  symbolically. Accept only when `U` is a positive integer literal `≥ m+1`,
  or a symbolic expression that is affine in a single free symbol with
  **integer** coefficients (this rejects `1 + 3 + \dots + 2n`, where the
  even anchor does not belong to the odd progression: `U = n + 1/2`).
- Result: `Sum(t(k), (k, 1, U))` / `Product(t(k), (k, 1, U))` with a fresh
  index symbol not free in the expression.
- Everything else stays inert: no anchor (`1+2+\dots`), geometric patterns,
  alternating signs, symbolic samples, multiple placeholders. Recursion: the
  head descends into subexpressions, interpreting each continuation-bearing
  `Add`/`Multiply` independently.

## The generalization ladder (v2+)

- **v2 — richer local recognition** (spec below): finite differences →
  polynomial general terms (squares, cubes, triangular numbers); constant
  ratio → geometric products/sums.

### v2 gate (agreed 2026-07-09)

Recognizers are tried in order: arithmetic progression (v1, unchanged shapes)
→ polynomial via finite differences → geometric. Same operand handling as v1
(contiguous exact-numeric sample run before the placeholder, single anchor
after it, leading terms re-attached, fresh index).

- **Polynomial (degree g ≥ 2):** successive finite differences of the
  samples until a constant row; general term via Newton's forward-difference
  formula `t(k) = Σⱼ Δʲs₁·C(k−1, j)`, built with canonical operations and
  simplified. **Evidence discipline** (3 samples fit *any* quadratic — the
  anchor must carry the missing evidence): accept when `m ≥ g + 2` (the
  constant difference row is witnessed at least twice), OR `m = g + 1` AND
  the anchor *structurally confirms* the term (below). Degree-1 stays the
  v1 path byte-for-byte.
- **Geometric:** constant exact ratio `r` (`r ≠ 0, |r| ≠ 1`) between
  consecutive samples; `t(k) = s₁·r^(k−1)`. Evidence: `m ≥ 3` (ratio
  witnessed twice) OR `m = 2` with structural anchor confirmation.
- **Anchor validation** (replaces v1's affine-U rule for these families):
  - *numeric anchor* `A`: find integer `U ≥ m+1` with `t(U) = A` — integer
    root of `t(U) − A` for polynomials (via the univariate solver or bounded
    integer search), exact repeated division by `r` for geometric; reject
    otherwise.
  - *symbolic anchor* `A` (exactly one free symbol `s`): candidate `U`
    from substituting `k → s` (and, if that fails, matching `A` against
    `t` with the index as wildcard); accept iff `t(U)` is canonically
    identical to `A` and `U` passes the v1 shape gate (symbol, or affine
    with integer coefficients). So `1+4+9+16+\dots+n²` → `Sum(k², (k,1,n))`
    and `1+2+4+\dots+2^n` → `Sum(2^(k−1), (k,1,n+1))`, while
    `1+2+4+\dots+n²` stays inert (anchor fits neither family's term).
- Alternating signs (`r < 0` covers sign-alternating geometric; other
  alternating patterns), mixed families, and anything unproven: inert.
- **v3 — recurrences via `RSolve`** (spec below): Berlekamp–Massey over the
  samples → a linear constant-coefficient recurrence → closed form via the
  existing `RSolve` (landed 0.71.0), no lookup tables.

### v3 gate (agreed 2026-07-09)

Tried after AP → polynomial → geometric all decline. Same operand handling.

- **Berlekamp–Massey** over the exact-rational samples finds the minimal
  linear constant-coefficient recurrence of order `L ≥ 2` (L = 1 is the
  geometric family; constant is excluded). **Evidence:** a length-L
  recurrence is determined by `2L` samples, so require `m ≥ 2L + 1` (one
  surplus witness), or `m = 2L` with anchor confirmation.
- **Closed form:** construct and evaluate an `RSolve` expression *through
  the engine* (`ce.box(['RSolve', …]).evaluate()`, NOT a static import —
  the solver must not be imported into `symbolic/`) with the recurrence and
  the first `L` samples as initial conditions. **Trust but verify:** the
  returned closed form must reproduce ALL samples (exact where possible,
  else within tolerance at high precision); on mismatch or an inert
  `RSolve`, decline.
- **Anchor validation:** numeric anchor — iterate the *recurrence itself*
  in exact rational arithmetic to find `U ≥ m+1` with `a(U) = A` (bounded;
  do NOT search on the closed form — Binet-style radicals make exact
  comparison fragile). Symbolic anchors: decline in v3 (a Fibonacci anchor
  is typically a fused subscript symbol like `F_n`, which cannot be
  validated against a closed form — future work alongside the famous-
  sequence table).
- **Result:** `Sum(t(k), (k, 1, U))` / `Product(…)` with `t` the verified
  closed form. If a hand-curated famous-sequence head matches the
  recurrence + initial conditions exactly (e.g. `Fibonacci`, if the head
  exists), prefer it as the body for display.
- Alternating-sign sequences are in scope for the recognizer (negative
  coefficients/samples are natural to Berlekamp–Massey); the *parser
  spelling* `1 - 2 + 4 - \dots` additionally requires the subtraction-
  ellipsis fold-barrier extension (a `Negate`-wrapped
  `ContinuationPlaceholder` must trigger the barrier like a bare one).
- **v4 — OEIS-backed proposals, via the EXISTING async API.** The engine
  already ships `ce.lookupOEIS(terms)` (async, `OEISSequenceInfo[]` with
  `formula`/`terms`/`url`) and `checkSequence`, alongside the
  `declareSequence` recurrence subsystem (`engine-sequences.ts`, `oeis.ts`).
  The boundary is therefore **sync-evaluate vs. async-API**, not
  engine-vs-app: `Interpret` (sync `evaluate()`) stays offline and
  deterministic and never performs a lookup; an OEIS-backed proposal flow is
  a future *async* convenience composing existing pieces — samples →
  `lookupOEIS` → parse the free-text `formula` field into a candidate
  expression (needs mapping heuristics; OEIS formulas are prose-ish) →
  **verify** the candidate against the samples with the recognizer core →
  return attributed candidates (`OEISSequenceInfo.url`). Bundling OEIS
  *data* into the library remains out (CC BY-NC); live lookup with
  attribution is fine and already shipped.

  **Landed 2026-07-10** as `ce.interpret(expr, options?)` (async), returning
  `{ expression, candidates }` — `expression` is exactly what the sync
  `Interpret` head produces (offline recognizer, byte-for-byte unchanged), and
  `candidates: OEISCandidate[]` are OEIS-attributed closed forms
  (`{ expression, id, name, url, formula }`). Implementation in
  `src/compute-engine/interpret-oeis.ts` composes the sync recognizer,
  `extractContinuationSamples` (a minimal export from `symbolic/interpret.ts`),
  and the existing `lookupOEISByTerms`. Formula parsing: scan `a(n) = <rhs>`
  lines (all lines, via a new `OEISSequenceInfo.formulas` field), split
  equality chains, strip attribution/qualifiers, map a small set of ASCII
  function spellings (`binomial`/`C`/`sqrt`/`floor`/`ceiling`) to LaTeX, drop
  self-referential and multi-variable lines. Every candidate is verified to
  reproduce ALL samples exactly (index offset found by a small search window —
  OEIS `offset` is not carried through `OEISSequenceInfo`); unverifiable
  candidates are dropped. Lookup failures / offline / too-few-samples resolve
  gracefully with the sync result and an empty candidate list — never a
  rejection.
- **Promotion decision** (deferred until real product usage): whether bare
  `evaluate()`/`simplify()` should invoke the recognizer by default.
