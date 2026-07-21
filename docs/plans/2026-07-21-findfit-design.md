# FindFit: General Nonlinear Least-Squares — Design

**Status: RATIFIED 2026-07-21** (§ 8 items 1–3 approved as recommended;
item 4 resolved: weights = future trailing argument, shape-deduction rejected).

Origin: Tycho item 77 (filed 2026-07-21, `tycho/docs/COMPUTE_ENGINE.md` § "Genuinely
open asks"). A feature ask, not a defect; explicitly no schedule. Full Tycho-side
requirements: their `requirements/todo/DESMOS_SIM_REGRESSION_SPEC.md` § 6 (T5-B).

## 1. Problem

Desmos's `~` operator is a least-squares solve: `lhs ~ rhs` fits every free
symbol so the two sides agree. Tycho's census (71 rows / 35 states,
hand-verified): 31 data regressions, 12 pointwise list fits, 28 scalar/vector
equation solves; free-parameter counts 1–4+, max 30.

CE's existing `LinearRegression`/`PolynomialFit` (`library/statistics.ts`) are
closed-form **linear** least squares. The corpus models are not linear in the
parameters (`a·e^{b·j} + c` is not log-linearizable), and the model families
are arbitrary compositions of exp/power/Gaussian/cosine/tanh/erf — so neither
a linear API nor a fixed-model-family API closes the gap. `NDSolve` is a
different problem class.

The four parts of the ask, in Tycho's priority order:

1. NLLS over an arbitrary expression (Levenberg–Marquardt or Gauss–Newton),
   returning fitted parameters **plus convergence diagnostics**.
   Non-convergence must be a reportable state, never a silent wrong answer.
2. Box constraints on parameters (13/71 corpus rows carry restriction-brace
   guards that are exactly parameter bounds).
3. A **system form**: several residual expressions sharing parameters, fitted
   jointly. Load-bearing: one corpus state fits 6 parameters across 9
   equations simultaneously; row-at-a-time gives a different, wrong answer.
4. Analytic Jacobians via `D`, computed internally.

NLLS subsumes root-finding as the zero-residual case, so one core also serves
the 28 equation-solve rows — and revives `FindRoot`, already on the deferred
Tier-3 list of the Mathematica surface-forms initiative (2026-07-14).

**Out of scope (stays Tycho-side, per their own filing):** the document-model
half — joint-fit group discovery over their dependency graph, re-solve
triggers, eval budgets, non-convergence UX, collaboration semantics. CE is the
numerical core only.

## 2. Architecture: one core, two surfaces

```
numerics/levenberg-marquardt.ts     pure-number LM core (no BoxedExpression)
library/statistics.ts               FindFit surface (next to LinearRegression)
library/… (same file as Solve def)  FindRoot surface
symbolic/derivative.ts              analytic Jacobian (existing)
ce.jit / compile                    fast residual+Jacobian eval (existing,
                                    NDSolve-RHS pattern; interpreted fallback)
```

The core solves: given `r: ℝᵖ → ℝᵐ` (stacked residual vector), `J: ℝᵖ → ℝᵐˣᵖ`,
starting point `θ₀`, bounds `[lo, hi]`, minimize `‖r(θ)‖²` subject to
`lo ≤ θ ≤ hi`. Both public operators lower to it:

- **`FindRoot`**: residuals = `lhsᵢ − rhsᵢ` of the equation list. m = number
  of equations.
- **`FindFit`**: residuals = `model(xᵢ; θ) − yᵢ`, one per data point
  (m = number of points). The joint/system form stacks the residuals of
  several models (§ 4).

## 3. Public API

### 3.1 `FindFit(data, model, params, vars)`

Mathematica argument order (`FindFit[data, expr, pars, vars]`) — consistent
with the house convention of adopting Mathematica surface forms (`Solve`,
`NDSolve`, `D`, `Limit`, iterator triples).

- **`data`**: a list of `(x…, y)` tuples (last element is the observed value,
  preceding elements bind to `vars` positionally), or a plain list of `y`
  values (then `x = 1, 2, …`, matching `LinearRegression`'s convention).
- **`model`**: an arbitrary expression in `vars` and the parameters.
- **`params`**: a list of parameter specs, each one of
  - a bare symbol `a` — start 1 (Mathematica default), unbounded;
  - `(a, a0)` — explicit start;
  - `(a, a0, lo, hi)` — start plus box constraint. `lo`/`hi` may be
    `-oo`/`+oo` for one-sided bounds.
  The 3-tuple form is deliberately **not** accepted (ambiguous between
  `(a, lo, hi)` and `(a, a0, lo)`).
- **`vars`**: independent-variable symbol or list of symbols.

### 3.2 `FindRoot(equations, params)`

`equations`: an equation, a residual expression (implicitly `= 0`), or a list
of either. `params`: same spec grammar as `FindFit`. This is the deferred
Tier-3 `FindRoot with {x, x0}` item, delivered via the same core.

### 3.3 Return value and diagnostics

Both operators return a **record** (`Dictionary`):

```
{
  parameters:   {a: 1.234, b: -0.56, …},   // dictionary symbol → float
  converged:    True | False,
  residualNorm: 0.00123,                    // ‖r(θ̂)‖₂ at the returned point
  iterations:   17,
}
```

Rationale (over the Mathematica rule-list `{a → 1.2, …}`):

- The requester's hard requirement is that non-convergence be first-class.
  A record carries `converged: False` **with** the best-so-far parameters and
  residual norm — the caller decides whether best-effort is usable. A bare
  rule list would force the silent-wrong-answer failure mode (Mathematica's
  behavior, called out in the filing as unacceptable).
- The primary consumer is programmatic (Tycho reads fields, then assigns
  document variables); substitution convenience is secondary. If a
  substitutable form is ever wanted, a rule-list accessor can be added as
  sugar later; the reverse migration (rule list → record) would be breaking.

Hard failures (malformed arguments, undifferentiable model, NaN at the
starting point) return an `Error` expression per house convention;
non-convergence within budget is NOT an error — it is `converged: False`.

### 3.4 Exactness contract

`FindFit`/`FindRoot` are inherently numeric, like `NDSolve`: `evaluate()`
computes floats. No symbolic residue is attempted; with non-numeric data or
unresolvable symbols in the model (beyond `vars` + `params`), the expression
stays inert (returns `undefined` from the handler).

## 4. The joint/system form

The census case: 9 rows (`R_r ~ …`, `G_r ~ …`, …) sharing 6 parameters. Two
sub-shapes and how each maps:

- **Joint equation solve** (no data): `FindRoot({eq₁, …, eq₉}, params)` —
  already covered by 3.2; residuals stack naturally.
- **Joint data fit** (several models, several datasets, shared params):
  `FindFit(data, models, params, vars)` where `models` is a list of k model
  expressions and `data` is a list of k datasets (element i pairs with model
  i). A single shared dataset may be passed for k models (broadcast).
  Residual vector = concatenation of all per-model, per-point residuals.

Tycho performs its own dependency-graph partitioning to discover which rows
form a group; CE only ever sees one already-assembled system per call.

## 5. Numerics

**Algorithm**: Levenberg–Marquardt on the normal equations,
`(JᵀJ + λ·diag(JᵀJ))·δ = −Jᵀr` (Marquardt scaling for parameter-scale
invariance), λ adapted by gain ratio (Nielsen's update). At p ≤ 30 the p×p
Cholesky solve is trivial; a tiny dense Cholesky (with diagonal-inflation
retry on indefiniteness) lives in the same numerics file.
`numerics/linear-algebra.ts` is effectively empty (only `determinant` is
live), so nothing there to reuse or conflict with.

**Jacobian**: analytic, via `differentiate()` — p symbolic derivatives of the
model, compiled once per call alongside the model itself through the jit path
(`NDSolve`'s RHS pattern: compile if possible, interpreted `evaluate` with
substitution as fallback). If any `∂model/∂θⱼ` fails to differentiate
symbolically, fall back to forward differences for that column only — do not
fail the whole call.

**Box constraints**: projected LM — clamp `θ + δ` to `[lo, hi]` each step;
convergence at an active bound is tested on the **projected** gradient, so a
minimizer pressed against a bound reports `converged: True`.

**Convergence / termination** (defaults, all overridable later if needed —
not exposed in v1):

- gradient: `‖∇‖∞ < 1e-8` (projected)
- step: `‖δ‖ < 1e-10·(‖θ‖ + 1e-10)`
- max iterations: 200
- **deadline**: check the ambient evaluation deadline between LM iterations
  (per the timeout-span model — budgets compose; a timeout surfaces as the
  standard cancellation, not as `converged: False`).

**Starting points**: defaults are the caller's responsibility to improve —
Tycho seeds Desmos-serialized fit results as starts when re-solving live. No
multi-start/global search in v1 (recorded as a possible v2 if corpus rows
demonstrate basin sensitivity).

**Determinism**: no randomness anywhere in v1 (no multi-start), so results
are deterministic — no seed parameter needed.

## 6. LaTeX

Parse/serialize entries in `definitions-statistics.ts`:
`\operatorname{FindFit}(…)`, `\operatorname{FindRoot}(…)` — function-style,
same treatment as `LinearRegression`. No special notation. (Desmos `~` stays a
Tycho importer lowering; CE does not parse `~` as a fit operator.)

## 7. Tests (`test/compute-engine/find-fit.test.ts`)

Per the working discipline, every reference value below gets verified
empirically (independent computation) before being encoded.

1. **Linear sanity**: `FindFit` on a line reproduces `LinearRegression`'s
   coefficients to tolerance.
2. **Corpus shapes** (from the filing, synthetic data with known ground
   truth): `a·e^{b·j}`; `a·e^{b·j} + c` (the non-linearizable one); `a·j^b`;
   a Gaussian; a cosine fit.
3. **Box constraints**: unconstrained minimizer outside the box →
   `converged: True` at the bound; interior box → same answer as
   unconstrained.
4. **Joint system**: two models sharing a parameter where independent fits
   provably differ from the joint fit; plus a scaled-down analogue of the
   6-params/9-equations family.
5. **FindRoot**: scalar root; 2×2 nonlinear system; equation-vs-residual
   spelling equivalence.
6. **Diagnostics**: a deliberately non-converging fit (max-iteration cap on
   a pathological model) returns `converged: False` with finite best-so-far
   values — not an error, not a hang.
7. **Inert/error cases**: symbolic data stays inert; malformed param spec
   (3-tuple) → error; NaN at start → error.
8. **Jacobian fallback**: a model containing a non-differentiable component
   still fits via the finite-difference column.
9. **Deadline**: a `withTimeLimit` clamp cancels a long fit with the
   standard cancellation (timeout-model contract).

Plus: LaTeX parse/serialize round-trip; `non-finite-typing.test.ts` is not
implicated (result record fields are finite floats or booleans).

## 8. Open questions (need ratification)

1. **Argument order** — recommended: Mathematica `(data, model, params, vars)`.
   Tycho's filing sketched `(model, params, data)`; they did not mark the
   order load-bearing, and house convention favors Mathematica compat.

[*] Approved.

2. **Return shape** — recommended: record (§ 3.3) over Mathematica rule list,
   for the diagnostics requirement. This is the main deliberate divergence
   from Mathematica; flag it in the reply so Tycho can veto.

[*] Approved

3. **Naming** — `FindFit`/`FindRoot` (Mathematica names) vs. something like
   `NonlinearFit`. Recommended: Mathematica names, matching the surface-forms
   initiative.

[*] Approved.

4. **Weights** — not in v1 (not in the census). The future API path is
   RESOLVED (2026-07-21) so v1 doesn't foreclose it: a **trailing optional
   `weights` argument** — `FindFit(data, model, params, vars, weights)`, a
   numeric list parallel to `data` (list-of-lists mirroring the joint form).
   Purely additive, matching the trailing-optional-arg house convention
   (`Sample`'s seed, `LinearRegression`'s trailing variable).

   Tuple-shape deduction (`(x…, y, w)` = arity |vars|+2) was considered and
   REJECTED. It is technically unambiguous — `vars` is explicit, so the
   expected data-tuple arity |vars|+1 is known and a +1 column is detectable —
   but an accidental extra column in the data would then silently become
   per-point weights, changing the fit with no diagnostic. That is the same
   silent-semantics-change class as the 3-tuple param spec (§ 3.1), rejected
   for the same reason: shape sniffing must never turn a data mistake into a
   different well-formed problem.


## 9. Non-goals (v1)

- Fixed model families / model selection (explicitly rejected by the filing).
- Global optimization, multi-start, stochastic methods.
- Nonlinear (non-box) constraints; general `FindMinimum`.
- Parameter uncertainty / covariance output (natural v2: `JᵀJ` inverse is a
  byproduct; wait for a consumer need).
- Any document-model integration (Tycho-side by their own scoping).
