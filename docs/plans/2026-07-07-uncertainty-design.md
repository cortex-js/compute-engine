# Uncertainty / Measurement Type — Design

**Status:** design agreed 2026-07-07 (ROADMAP item 5). MVP scope; upgrade path
documented. Not yet implemented.

## Goal

A measurement type `5.1 ± 0.2 cm` — a value carrying a 1σ absolute error that
**propagates through arithmetic** — for lab-course and experimental-science
use. This is the value-carrying counterpart of the display-only significant-
figures control (ROADMAP item 7, landed); item 7's rounding primitive supplies
this feature's *display* half nearly for free.

## Decisions (2026-07-07)

1. **`\pm` is redefined to mean a measurement.** `a \pm b` → `Measurement(a, b)`
   (was `PlusMinus`, which evaluated to the branch tuple `(a−b, a+b)`). The
   branch/solution use of `\pm` migrates to an explicit form. Rationale: the
   dominant real-world meaning of `5.1 ± 0.2` is a measurement, not "the two
   values 4.9 and 5.3".
2. **Independent linear (quadrature) propagation for the MVP** — not dual-number
   correlation tracking. Rationale below (§"Why independent is enough").

## Representation

Mirror the **Quantity** precedent (`['Quantity', magnitude, unit]` + library-
level dispatch), **not** a new `NumericValue` subclass (every existing subclass's
`add`/`mul` coerces operands through `.re`/`.im` and would silently drop the
error bar).

- Head: `['Measurement', value, error]`.
- `value` — the nominal (any real scalar: integer, rational, radical, float).
- `error` — the 1σ absolute uncertainty; canonicalized to `Abs(error)` and,
  when known, a non-negative real.
- Canonical form canonicalizes both operands (mirroring `Quantity`'s
  `canonical`); a `Measurement` with a **zero (or absent) error canonicalizes
  back to the bare `value`** (decided 2026-07-07 — zero error is an exact
  value).
- Units: `5.1 ± 0.2 cm` nests as `Quantity(Measurement(5.1, 0.2), cm)` — the
  error shares the unit; measurement-arithmetic composes *under* quantity-
  arithmetic (a `Quantity` whose magnitude is a `Measurement`).

## Propagation (independent, first-order)

A new `src/compute-engine/library/measurement-arithmetic.ts` (mirroring
`quantity-arithmetic.ts`) with `measurementAdd`/`measurementMultiply`/
`measurementDivide`/`measurementPower`/`measurementNegate` and an elementary-
function helper. Dispatched from the same `arithmetic.ts` handler sites Quantity
uses (`evaluated.some(x => x.operator === 'Measurement')`): Add ~266, Divide
~428, Multiply ~1356, Negate ~1392, Power ~1541, Root ~1667, Sqrt ~1825 — plus
the elementary-function handlers (Ln, Exp, Sin, Cos, Tan, …).

Closed-form per-op partials (no calculus-engine dependency — see §Layering).
For independent 1σ errors `σ`:

| op | nominal | error σ_f |
| :-- | :-- | :-- |
| `a ± b` (Add/Sub) | a+b | √(σ_a² + σ_b²) |
| `a·b` (Multiply) | ab | √(b²σ_a² + a²σ_b²) |
| `a/b` (Divide) | a/b | √(σ_a²/b² + a²σ_b²/b⁴) |
| `k·a` (scalar k) | ka | \|k\|·σ_a |
| `aⁿ` (const n) | aⁿ | \|n·a^{n−1}\|·σ_a |
| `a^b` (both uncertain) | a^b | √((b·a^{b−1})²σ_a² + (a^b·ln a)²σ_b²) |
| `√a` | √a | σ_a / (2√a) |
| `ln a` | ln a | σ_a / \|a\| |
| `eᵃ` | eᵃ | eᵃ·σ_a |
| `sin a` | sin a | \|cos a\|·σ_a |
| `cos a` | cos a | \|sin a\|·σ_a |
| `tan a` | tan a | sec²a·σ_a |

General unary rule: `σ_f = |f'(a)|·σ_a`. The propagated error is generally
inexact (quadrature introduces `√`); that is acceptable — errors are
approximate by nature. Nominals keep their own exactness.

### Why independent is enough (the symbolic-canonicalization insight)

Naive independent propagation is famously wrong on correlated reuse of one
source (`x − x` → `√2·σ` instead of 0). **CE avoids this for free** because
same-variable reuse is resolved by *symbolic canonicalization before any numeric
propagation*:

- `x − x` folds to `0` (generic-symbol fold) → error 0. ✓
- `x + x` → `2x` → one scalar·measurement op → fully correlated `2a ± 2σ`. ✓
- `x · x` → `x²` → one `pow` op → correct. ✓

The **only** residual wrong class is *nonlinear multi-occurrence of one source
that does not collapse* — `x/(x+1)`, `sin(x)+x`. Real, but uncommon in the
target audience, and exactly what the dual-number upgrade (below) fixes. So the
MVP is genuinely correct for (a) combining distinct measurements and (b) any
reuse that canonicalizes — not a compromise.

## Layering — no calculus dependency

Calculus sits *above* arithmetic (calculus → symbolic/derivative → boxed-
expression/arithmetic → numeric-value); importing `differentiate` from the
arithmetic layer would be a cycle. The MVP avoids it entirely: all built-in-op
partials are hardcoded closed forms in `measurement-arithmetic.ts` (exactly how
`interval/arithmetic.ts` hardcodes each op's bound formula). A *general*
`D`-based fallback for arbitrary user-defined functions is a later add via the
same runtime-injection pattern `explain('D')` uses (`_setExplainDDriver`).

## `\pm` redefinition + `PlusMinus` migration

`\pm` served two roles; the split:

- **Measurement (input):** `a \pm b` and prefix `\pm b` → `Measurement(a, b)` /
  `Measurement(0, b)`. Parse/serialize in
  `latex-syntax/dictionary/definitions-arithmetic.ts` (~1935–1978, currently
  emits `PlusMinus`). Serialize `Measurement(v, e)` → `v \pm e`.
- **Solution branches (engine output):** migrate to an explicit **`List`** of
  the branches (decided 2026-07-07) — solution sets render explicitly rather
  than with `\pm`. Sites:
  - `calculus.ts:377,402` — quadratic-formula ± output.
  - `solve.ts:2524` — the arcsin special-value rule pattern
    (`['PlusMinus', ['Sin', _a], …]`) rewritten to the explicit branch form.
  - `arithmetic.ts:1410–1418` — the `PlusMinus` opdef is replaced by the
    `Measurement` opdef (error-propagating), not branch-tuple semantics.
  - `ascii-math.ts:324`, `latex-syntax/serializer.ts:207` — serialization
    special-casing repointed to `Measurement`.
  - `calculus.test.ts` — the one test file referencing `PlusMinus`; update its
    expected quadratic-output snapshots to the explicit branch form.

Blast radius is small (one test file references `PlusMinus`). Snapshot churn is
expected in calculus/solve output where `\pm` branch form was emitted — measure
it before landing and surface it (per the snapshot policy).

## Display (near-free, reuses item 7)

Serialize `Measurement(v, e)` by the physics convention: round `e` to 1–2
significant figures, then round `v` to the error's least-significant decimal
place, using item 7's `roundToDecimalPlace` primitive
(`numerics/strings.ts`). `Measurement(5.134, 0.021)` → `5.13 \pm 0.02`. This is
the deferred half of item 7 finally cashing in.

## Type handler / non-finite

`Measurement(value, error) : value`'s scalar type (typically `real`). Add a
type handler (`library/type-handlers.ts`) and, if a measurement can carry
non-finite components, an entry in `non-finite-typing.test.ts`. Edge cases:
`error` non-finite or negative (canonicalize to `Abs`), `value` non-finite.

## Phased implementation plan

1. **Head + arithmetic core.** `Measurement` opdef in `arithmetic.ts`;
   `measurement-arithmetic.ts` with Add/Sub/Multiply/Divide/Negate/Power +
   scalar·measurement; dispatch at the Quantity sites. Tests: propagation
   formulas vs hand-computed values, exact/`.N()` split.
2. **Elementary functions.** sqrt/ln/exp/trig partials. Tests.
3. **`\pm` parse/serialize + PlusMinus migration.** Repoint parsing; migrate
   branch producers to explicit form; update serializers; fix `calculus.test.ts`;
   measure snapshot churn.
4. **Display.** Error-aware rounding via the item-7 primitive; LaTeX + AsciiMath
   + MathJSON round-trip tests.
5. **Units interaction.** `Quantity(Measurement(...), unit)` nesting;
   measurement-under-quantity arithmetic; unit-carrying error tests.

## Non-goals (later, demand-gated "L")

- **Dual-number correlation tracking** (forward-AD over named independent
  sources) — fixes nonlinear multi-occurrence (`x/(x+1)`). Each value carries a
  `{source → ∂/∂source}` map; `σ = √(Σ (∂/∂sourceᵢ)²·σᵢ²)`. Heavier
  representation; the `uncertainties`-package model.
- **Relative-error notation** (`±5%`) and mixed absolute/relative input.
- **Distribution links** — `RandomVariate`, sampling, correlation matrices,
  reusing the statistics track's RNG/seed policy.
- **General `D`-based propagation** for arbitrary user functions via runtime
  injection.

## Resolved decisions (2026-07-07)

- **`Measurement(v, 0)` canonicalizes to bare `v`** — zero error is an exact
  value. (A `Measurement` reaching the value only when the error is nonzero
  keeps `.N()` and downstream arithmetic clean.)
- **Comparison/ordering compares nominals.** `<`/`>`/`=` on measurements use the
  `value` component (error bars do not participate). Simple and predictable;
  error-bar-overlap equality is explicitly not modeled.
- **Solution branches use `List`.** `solve`/`calculus` emit an explicit
  `List` of the branch values (not `Or`, not a set) — one consistent
  representation.
