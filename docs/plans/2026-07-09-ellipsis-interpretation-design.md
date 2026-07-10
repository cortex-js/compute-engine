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

- **v2 — richer local recognition:** finite differences → polynomial general
  terms (squares, cubes, triangular numbers); constant ratio → geometric
  products/sums.
- **v3 — recurrences via `RSolve`:** Berlekamp–Massey over the samples → a
  linear constant-coefficient recurrence → feed the existing `RSolve`
  (landed 0.71.0) for the closed form (Fibonacci → Binet, no lookup tables).
  Optionally a small hand-curated famous-sequence table (factorial, Catalan;
  primes stay inert).
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
- **Promotion decision** (deferred until real product usage): whether bare
  `evaluate()`/`simplify()` should invoke the recognizer by default.
