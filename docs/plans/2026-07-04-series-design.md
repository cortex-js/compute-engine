# `Series` — symbolic Taylor/Laurent expansion (design proposal)

**Status:** draft for review · **Date:** 2026-07-04 · **Roadmap:** Proposed
product features item 1 (agreed 2026-07-04).

## 1. Goals and consumers

- **Tycho / Graph Paper action pill** (`tycho/roadmap/CE_AUTO_SUGGEST.md` §11):
  `["Series", e, x, x0, n]` on a notebook cell, displaying the expansion.
- **Education:** approximation, error terms, "why does sin x ≈ x" — the result
  must read like a textbook expansion, including an explicit remainder term.
- **Engine consumer (Strategic 7c):** the limit engine's pole-soundness guard
  (`symbolic/limit.ts`) defers on gamma/zeta-family poles because it lacks
  exact Laurent asymptotics (`lim_{x→−1}(x+1)ψ(x)`, `Γ` at poles). The Laurent
  kernel built here is the missing piece; `Residue` (`symbolic/residue.ts`)
  becomes a thin wrapper over "coefficient of (x−x0)⁻¹".
- **Plotting:** a truncated polynomial is compilable and plottable next to the
  original function — a natural Graph Paper visualization.

Non-goals (v1): multivariate series, Puiseux/fractional exponents, essential
singularities (`e^{1/x}` at 0 stays unevaluated), series-as-first-class-value
arithmetic (see §6 Phase 3).

## 2. API surface

```
["Series", f, x]              // x0 = 0, n = 5 (default order)
["Series", f, x, x0]          // n = 5
["Series", f, x, x0, n]       // explicit order (n = highest power kept)
```

- `x0` may be any exact expression, including `±∞` (asymptotic expansion via
  the substitution `t = 1/x`, returned in powers of `1/x`).
- `n` is the highest retained power of `(x − x0)`. Cap at an engine limit
  (reuse `iterationLimit`-style guard) and honor `checkDeadline`.
- **Result shape:** a plain expression — the truncated sum plus an explicit
  remainder head:

  ```
  Series(Sin(x), x, 0, 5)
    → x − x³/6 + x⁵/120 + BigO(x⁷)        // next *nonzero* order
  ```

  A new inert operator **`BigO`** (serialized `O(…)`, see §5) carries the
  remainder. It is inert under `evaluate`/`simplify`; `.N()` of an expression
  containing `BigO` returns `NaN` (documented), and `compile()` rejects it.
- **`Normal(expr)`** (Mathematica-compatible name) strips `BigO` terms,
  yielding the compilable/plottable polynomial. One-line operator; the pill UI
  can offer "Taylor polynomial" via `["Normal", ["Series", …]]`.

Rationale for a plain expression rather than a `SeriesData`-style boxed value:
it works today with display, `isSame`, the pill guard, LaTeX round-trip, and
`subs`, with no new boxed class. The cost — series arithmetic re-derives
rather than composes — is deferred to Phase 3 and only matters for engine-
internal perf, not the product surface.

## 3. Algorithm

**Phase 1 — Taylor at a regular point (the bulk of the value).**
Iterated symbolic differentiation via `symbolic/derivative.ts`, caching each
derivative to compute the next (n derivatives, not n² work), evaluating at
`x0` under the exactness contract:

- Exact input → exact rational/radical coefficients (`sin` at `π/6` gives
  `1/2`, `√3/2`, …).
- A derivative value with no closed form stays symbolic: for an undeclared
  `f`, `Series(f(x), x, 0, 2)` → `f(0) + f′(0)·x + ½f″(0)·x² + O(x³)` — this
  is itself the textbook statement and has educational value.
- If a derivative fails to evaluate *at all* (operator with no derivative
  rule), return the `Series` expression unevaluated — never a partial/wrong
  expansion.

Cost note: repeated `differentiate()` + evaluate-at-point is the P1-deferred
differentiation hot path (ROADMAP "Symbolic-evaluation performance"). For the
default n = 5 this is fine; known-series seeding (below) keeps the common
cases cheap regardless.

**Seeding (optimization + robustness):** a small table of primitive series
(`exp`, `sin/cos/tan`, `sinh/cosh/tanh`, `ln(1+u)`, `(1+u)^a`, `arctan`,
`arcsin`, `erf`) keyed by operator, combined by polynomial substitution when
the argument is itself a series with zero constant term. This is the standard
CAS approach; the derivative fallback covers everything else. The table can
start tiny — the fallback is always correct.

**Phase 2 — Laurent at poles and expansion at infinity.**
- Pole-order detection: for `f = g/h` with `h(x0) = 0`, expand `h` (Phase 1)
  to find its valuation `m`, then series-divide: `g·(leading⁻¹)·geometric`
  inversion of the unit part. This covers `1/sin x`, `cot x`, rational
  functions at poles — the textbook Laurent cases.
- At `±∞`: substitute `t = 1/x`, expand at `t = 0⁺`, map back.
- Special-function poles (`Γ`, `ψ`, `ζ` at their poles): store the leading
  Laurent data (pole order, residue, next coefficient) in the existing
  analytic-property store (`ce.functionProperties`) — the same store the
  pole-aware `N()` and `onBranchCut` already use. `Γ` at `−n` needs only
  `(−1)ⁿ/n! · 1/(x+n) + ψ(n+1)(−1)ⁿ/n! + O(x+n)` for the 7c limits.

**Phase 3 — consumers and perf (design-gated, separate work).**
- Wire the limit engine's pole-deferral slot (`symbolic/limit.ts`) to request
  a 2-term Laurent expansion instead of deferring — closes Strategic 7(c).
- Reimplement `Residue` on the Laurent kernel.
- If series manipulation becomes hot (nested `Series` calls, high n), introduce
  an internal dense-coefficient representation (plain array, not boxed) for
  compose/multiply/divide — an implementation detail behind the same API.

## 4. Exactness and numerics

- `evaluate()` returns exact coefficients or stays symbolic — never floats
  for exact input (mirror `Sqrt`/`Power` handler discipline).
- Float input (`Series(sin(1.2·x), …)`) produces float coefficients; fine.
- `N()` numericizes coefficients but keeps the polynomial structure; the
  `BigO` term makes the whole `.N()` `NaN`, so `.N()` is only useful after
  `Normal` — documented.

## 5. Notation

- **Serialize:** `BigO(u)` → `O\left(u\right)`; `Series(...)` unevaluated →
  default `\operatorname{Series}(…)` (round-trips like `TrigExpand`).
- **Parse:** `\mathcal{O}(…)` and `O(…)` → `BigO`. The bare-`O` capture is a
  behavior change (`O(x)` today is an unknown-function application) — gate it
  the way other single-letter function captures are gated, and only when
  followed by a delimited argument. **Flag for review:** if this feels risky,
  parse only `\mathcal{O}`/`\operatorname{O}` in strict mode and bare `O(` in
  lenient mode only.

## 6. Testing

- Battery vs known expansions (exact coefficient match): `sin`, `cos`, `exp`,
  `ln(1+x)`, `(1+x)^{1/2}`, `tan`, `arctan`, `1/(1−x)`, composites
  (`e^{sin x}`, `ln(cos x)`), non-zero `x0` (`sin` at `π/6`), symbolic-`f`
  form.
- Numeric equivalence: `Normal(Series(f,…))` vs `f` at sample points inside
  the radius, error `≤ |x−x0|^{n+1}·C`.
- Laurent (Phase 2): `1/sin x`, `cot x`, `1/(x²(1−x))`, `Γ(x)` at 0 and −1;
  `Series(e^{1/x}, x, 0, n)` stays unevaluated.
- Round-trip, idempotence-of-`Normal`, deadline/`n`-cap guards, pill guard
  (`isSame` false vs input when expansion applies).

## 7. Phasing and effort

| Phase | Content | Effort |
| --- | --- | --- |
| 1 | Taylor at regular points + `BigO` + `Normal` + seeds + LaTeX | M (one focused session) |
| 2 | Laurent at poles, ∞, special-function pole data | M |
| 3 | Limit-engine 7c wiring, `Residue` rebase, internal perf rep | design-gated follow-up |

Phase 1 alone delivers the Tycho pill and the educational value; 2 and 3 are
independent follow-ups.

## 8. Open questions (for review)

1. **Default order** — proposal: n = 5 (Mathematica-ish; big enough to be
   interesting, small enough to be fast). OK?
2. **`Normal` naming** — Mathematica-compatible but opaque to students.
   Alternative: `TruncateSeries`, or make the pill call
   `["Normal", …]` internally and never expose the name. Preference?
3. **Bare `O(` parsing** (§5) — strict-mode capture yes/no?
4. **`BigO`-poisons-`N()`** (§4) — alternative is `N()` silently dropping the
   O-term, which misrepresents the math. Keep `NaN`?
5. Include expansion at `±∞` in Phase 1 (it's cheap via `t = 1/x`) or hold to
   Phase 2 with the rest of the singular cases?
