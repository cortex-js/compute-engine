# Scoping: `simplify()` reach, `Together` reduction, and the evaluate/simplify split

**Date:** 2026-07-23
**Status:** scoping only — no behavior change proposed here has been implemented.

Context: this came out of working a Jacobian-conjecture counterexample end to
end through the public LaTeX surface (`parse → D → Determinant → Solve →
ReplaceAll → Simplify`). That exercise turned up five defects, three of which
are fixed and covered by tests; the remaining three items below are design
questions or bounded projects that need a decision before implementation.

Fixed in the same pass (listed for context, not open):

| Defect | Fix |
| --- | --- |
| `numeratorDenominator` returned `[x^-2, 1]` for a bare negative power | `boxed-function.ts` — literal negative exponent moves to the denominator |
| `Together` folded negative-power denominators into the numerator | `factor.ts` — split via `numeratorDenominator` |
| Transformers (`Expand`/`Factor`/`Together`/`Distribute`/`Simplify`) ignored a producer head in their held operand | `utils.ts` `reduceTransformerOperand`, applied recursively |
| `Distribute` recombined branches with `Multiply` instead of `Add` — value-destroying on every input | `symbolic/distribute.ts` |
| `toString()` dropped parentheses around a product-of-sums denominator | `ascii-math.ts` `isParenthesizedGroup` |
| Lazy operators could not see into a user-function call or a value-bound symbol — `Solve` answered `[]` | `utils.ts` `inlineLambdaApplications` / `resolveBoundSymbols`; recursive `reduceTransformerHeads` |

---

## Item 1 — `simplify()` does not run operator `evaluate` handlers — **LANDED 2026-07-23 (option 2)**

### Observed

`.simplify()` is rule-driven. It applies the simplification rule set and folds
purely numeric subexpressions (`evaluateNumericSubexpressions` in
`boxed-expression/simplify.ts`), but never invokes an operator's `evaluate`
handler. This is uniform, not a `Determinant` quirk:

| Expression | `.simplify()` | `.evaluate()` |
| --- | --- | --- |
| `Determinant([[a,b],[c,d]])` | unchanged | `a·d − b·c` |
| `Transpose([[a,b],[c,d]])` | unchanged | `[[a,c],[b,d]]` |
| `Trace([[a,b],[c,d]])` | unchanged | `a + d` |
| `Length([a,b,c])` | unchanged | `3` |
| `Max(3,5)` | unchanged | `5` |
| `D(x²+ax, x)` | unchanged | `a + 2x` |
| `Integrate(x², x)` | unchanged | `x³/3` |

`N()` *does* run handlers, so `det.N()` expands — but yields the float form.

### Why it is probably intentional

- `evaluateNumericSubexpressions` is a deliberately *restricted* numeric folder.
  It would be redundant if `simplify()` evaluated generally.
- The documented lifecycle separates the stages: evaluate (3) computes,
  simplify (4) rewrites.
- `CLAUDE.md` warns at length that calling `.simplify()` from code reachable by
  simplification rules causes unbounded recursion. Running arbitrary `evaluate`
  handlers inside `simplify()` re-opens that hazard from the other direction.

### The user-visible cost

`expr.simplify()` is the natural first thing to reach for, and it silently
returns the input for a large family of heads. The ordering rule
(`evaluate()` then `simplify()`; `simplify()` alone is not a superset) is now
documented in `docs/SIMPLIFY.md`, but discoverability is still poor.

### Options

1. **Keep as-is, document only.** Done. Zero risk. Surprise remains.
2. **Evaluate a whitelist of pure structural heads** inside `simplify()`
   (`Determinant`, `Transpose`, `Trace`, `Length`, …) — heads with no
   value-substitution and no re-entry into simplification. Bounded, but the
   whitelist needs a principled membership rule or it becomes a grab-bag.
3. **Evaluate any head whose handler is declared side-effect-free and
   non-recursive**, via a new operator-definition flag. Principled, but adds a
   flag to every definition and the recursion analysis is not local.
4. **Make `simplify()` call `evaluate()` first.** Matches user expectation and
   Mathematica, but is the widest change: it would substitute assigned symbol
   values inside `simplify()`, changing the meaning of `Simplify(expr)` for any
   expression containing an assigned symbol.

**Recommendation:** option 2, gated on agreeing a membership rule. Option 4 is
the one to explicitly rule in or out first, since it subsumes the others.

**Decision needed from:** repo owner. Blast radius of 2 is small; of 4, large.

### Outcome (landed — option 2)

Option 2, with the membership rule the scoping asked for: *the handler reduces
its operands to a closed form determined by their **structure** — a matrix to a
scalar, a collection to a measure — rather than rewriting the expression, and
the head carries no simplification rule of its own.* Members:
`Determinant`, `Trace`, `Transpose`, `Length` (`SIMPLIFY_EVALUABLE_HEADS`).

The rule earned its keep immediately. `Max`/`Min` were in the first draft and
produced the only blast radius in the suite (8 snapshots, 2 failures) — all
label-only churn, identical values. They also **fail the rule**: they reduce
their operands' *values*, not their structure. Dropping them was principled,
not churn-avoidance, and took the diff to zero snapshot changes.

One invariant discovered while implementing and now pinned by tests:
**`simplify()` is value-blind** — with `a := 5`, `(a + 2).simplify()` is
`a + 2`, not `7`. Evaluating a structural head whose operands mention a bound
symbol would substitute it, so the evaluation declines in that case.

Option 4 was not taken and remains available.

### Outcome — transformers and value-bound symbols (landed)

`reduceTransformerOperand` now resolves symbols bound to a value, so
`Simplify(v)` with `v := (x²-1)/(x-1)` gives `x + 1`. Rationale: an operator
normally evaluates its arguments, and these transformers are `lazy` only to
protect the operand's *structure*.

This is the **operator**, not the method — `ce.symbol('v').simplify()` is still
`v`. The two are deliberately different, and both are pinned by tests.

Behavior flip worth noting: `Expand((b+1)^2)` with `b := 5` now returns `36`
rather than `b^2 + 2b + 1`. A test added earlier in the same session pinned the
old behavior; it was updated, and that pin was the *only* thing in the suite
that changed.

### Related, still open: transformers and value-bound symbols

The lazy-operand fix (2026-07-23) resolves value-bound symbols for **`Solve`**,
where the unknowns give a precise set to protect from substitution. The
transformers have no such anchor, so `Simplify(v)` with `v := (x²-1)/(x-1)`
is still a no-op — and `Simplify` of an expression containing a bound symbol
serializes the unresolved symbol oddly (`2w^2 + "yw"^2 + 3w * "yw"`, a
string, which is a separate display defect worth a look).

Whether a transformer should resolve bound symbols is the *same question* as
this item: it is value substitution, and option 4 above would settle both. Do
not fix it in isolation.

The practical consequence today: in Cortex, nothing that is not written inline
can be simplified, because every route (`Simplify(v)`, `Simplify(Evaluate(v))`)
goes through a lazy operand.

---

## Item 2 — `Together` does not reduce to lowest terms — **LANDED 2026-07-23**

### Observed

After the negative-power fix, `Together` produces a correct but unreduced
single fraction:

| Input | Current | Expected |
| --- | --- | --- |
| `1/x + 1/x²` | `(x² + x)/(x·x²)` | `(x + 1)/x²` |
| `−3y/x + 2/x²` | `(−3y·x² + 2x)/(x·x²)` | `(2 − 3xy)/x²` |
| `1/(x+1) + 1/(x+1)²` | `((x+1)² + x + 1)/((x+1)·(x+1)²)` | `(x + 2)/(x+1)²` |

Three distinct gaps:

- **G1 — denominator is the product, not the LCD.** `together()`'s `Add` branch
  combines with `den = Multiply(den, td)`. For `1/x + 1/x²` that is `x·x²`
  rather than `x²`.
- **G2 — `Multiply` folds like bases at *evaluate*, not canonicalization.**
  `ce.function('Multiply', [x, x²])` stays `x * x²`; only `.evaluate()` (or
  `.mul()`) gives `x³`. So even the product denominator is left unnormalized.
- **G3 — no final reduction.** Nothing divides numerator and denominator by
  their GCD.

### Key finding: the machinery already exists

This was initially mis-scoped as "needs multivariate polynomial GCD — a project".
It does not. `boxed-expression/multivariate-gcd.ts` (Brown's dense modular
algorithm) shipped already, and it handles the hard case directly:

```
multivariateGCD(ce, −3y·x² + 2x, x³, ['x','y'])  →  x
  (−3y·x² + 2x) / x  →  −3xy + 2
  x³ / x              →  x²
                      ⇒  (2 − 3xy)/x²          ← the wanted closed form
```

The blocker is only *wiring*: `cancelCommonFactors(expr, variable)` in
`polynomials.ts` takes a **single** variable and routes to the univariate
`polynomialGCD`, which returns `1` for that same input because it treats the
`y`-bearing coefficients as opaque. `polynomialGCD` already has a multivariate
branch (`vars.length >= 2` → `multivariateGCD`); `cancelCommonFactors` never
reaches it.

### Proposed shape

1. Give `cancelCommonFactors` a multivariate path: accept `string[]`, and when
   more than one unknown is present use `multivariateGCD` before falling back
   to the univariate GCD. (`multivariateGCD` is already budget-bounded and
   returns `null` on hard input, so the fallback is clean.)
2. Call the reduction at the end of `together()`'s `Add` branch. This subsumes
   G1: `product / gcd` **is** the LCD, so no separate LCD pass is needed.
3. Leave G2 alone. Moving like-base folding into canonicalization is a much
   wider change (it would alter the canonical form of every `Multiply`) and is
   unnecessary once the result is reduced.

**Estimated size:** small — two functions, no new algorithms.
**Risk:** low, but `together()` output appears in `Factor`/`PartialFraction`
paths; measure snapshot blast radius before landing.
**Watch:** `CLAUDE.md` forbids calling `.simplify()` from anything reachable by
simplification rules. The reduction must use `polynomialDivide` directly, never
`.simplify()`.

### Outcome (landed)

Implemented as scoped, with one refinement found during implementation: the
reduction lives in a new `togetherReduced()` used by the **`Together`
operator**, not inside the shared `together()` helper. `together()` is called
directly by the same-denominator simplify rule (`simplify-rules.ts`), which
runs inside the fixpoint; leaving it unreduced keeps that rule's output stable
and its cost unchanged.

The multivariate fallback in `cancelCommonFactors` is ordered univariate-first,
so the cheap path is unaffected. It is also unreachable from the simplify hot
loop: that rule is gated to `unknowns.length === 1` and so never enters the
multivariate branch. Confirmed by an isolated benchmark (standard rule set
23.3 / 32.6 ms/run, against a 45.7 ms full-suite baseline — the apparent
regression in a loaded run was concurrency noise).

Full suite green, 4168/4168 snapshots unchanged, 8 regression tests added
including a numeric oracle and a pin on the bare `together()` helper.

---

## Item 3 — `simplify()` cannot distribute, even when the result is cheaper — **LANDED 2026-07-23**

### Observed

Substituting a sum-of-fractions for `z` leaves `simplify()` stuck, while the
equal-valued single-fraction form closes:

```
f₁.subs({z: (2−3xy)/x²}).simplify()        →  y² + 3y/x + 2/x²      cost 70 → 27
f₁.subs({z: −3y/x + 2/x²}).simplify()      →  unchanged             cost 76 → 76
```

Both substitutions are the same value (their difference simplifies to `0`).

### Root cause — and it is *not* the cost function

The closed form costs **27**; the stuck form costs **76**. Simplify is not
cost-rejecting the better result — it never generates the candidate. From
`simplify.ts`:

> Rules tagged `purpose: 'expand'` grow expressions by design: they are
> excluded from simplify()'s scan […] but remain reachable via `expr.replace()`.

The capability is present and reachable — `Expand(expr).simplify()` produces
`y² + 3y/x + 2/x²` immediately. `simplify()` simply cannot get there, because
distributing a sum over a product is an expand-purpose rewrite.

The `Divide` form closes because `a/b · c → (a·c)/b` is not an expand rule, and
it feeds the existing polynomial-cancellation path.

### The tension

The exclusion is correct in general: expansion usually grows an expression, and
letting expand rules into simplify's fixpoint loop risks blow-up and cycling.
But it makes `simplify()` incomplete in a way that is invisible to callers —
a strictly cheaper form exists and is not found.

### Proposed shape

A **cost-guarded trial expansion**: at the end of the simplify loop, if no rule
fired, try `expand()` once on the result, simplify that, and keep it only if
its cost is strictly lower. Properties:

- Cannot cycle: it runs once, at fixpoint, and only accepts a strict decrease.
- Cannot blow up: the cost function is the acceptance gate.
- Zero effect on expressions that are already minimal (the trial is discarded).

Open questions: whether one trial is enough or it needs to iterate; whether the
trial should be opt-in via `SimplifyOptions` for a release before becoming the
default; and the cost of the extra `expand()` on every non-trivial `simplify()`
call (needs a benchmark on the standard corpus).

**Estimated size:** medium.
**Risk:** medium-high snapshot churn — this changes `simplify()` output for a
whole class of expressions. Measure before committing to a direction.

### Outcome (landed)

Implemented as proposed: one trial at the fixpoint, accepted only on a strict
cost decrease, with the inner call flagged so the trial cannot nest. A
structural pre-check (`mightExpand`) keeps it off expressions with no product
or power for expansion to act on.

Both risks the scoping flagged came in **below** estimate, measured rather than
assumed:

- **Snapshot churn: zero.** 4168/4168 unchanged. The predicted "medium-high"
  churn did not materialise, because the cost gate rejects the expansion of
  every already-minimal factored form (`(x+1)^5`, `(a+b)(c+d)`, `x(y+z)` all
  survive).
- **Performance: no regression.** Isolated rule-dispatch benchmark 19.5 / 19.9
  / 31.0 ms/run against a 23.3 / 32.6 ms pre-change baseline — inside noise.
  The pre-check is what keeps it off the hot path.

The two open questions in the proposal resolved as: one trial is enough (no
iteration needed for the motivating case), and no opt-in flag was necessary
given zero churn.

---

## Suggested order

1. **Item 2** — clearest win, existing machinery, small diff.
2. **Item 1** — needs a decision, not effort; option 4 should be ruled in/out first.
3. **Item 3** — most valuable but widest blast radius; do it last and behind an
   option flag initially.

---

## Open follow-ups (tracked 2026-07-23, from the dual-reviewer pass)

Two issues surfaced by the staged-review of the lazy-operand fixes were left
unfixed on purpose. Both are confirmed with repros below.

### A. `.simplify()` (the method) corrupts a lambda/binder body — PRE-EXISTING

`.simplify()` on an expression that *binds* a variable resolves that bound
variable to a same-named GLOBAL value, violating the value-blindness invariant
across the binder:

```js
const ce = new ComputeEngine();
ce.assign('x', 5);
ce.box(['Function', ['Add', 'x', 1], 'x']).simplify();   // → (x) |-> 6   (want (x) |-> x + 1)
ce.parse('\\sum_{x=1}^{3} x').simplify();                 // → 3x          (want 6, or symbolic)
```

Contrast: `.evaluate()` on the same lambda is fine (`(x) |-> x + 1`), and
`(x + 1).simplify()` with `x := 5` is correctly value-blind (`x + 1`). Only the
*binder* case corrupts.

- **Pre-existing**, not introduced by this session: it reproduces via the bare
  `.simplify()` method, and the pre-session `Simplify` operator called
  `.simplify()` too. The session's `resolveBoundSymbols` fix made *that*
  function binder-aware, but the corruption also lives in the `.simplify()`
  method's own operand descent (likely `evaluateNumericSubexpressions` or the
  scoped-Block simplification treating the bound var as having a value).
- **Fix locus:** `boxed-expression/simplify.ts` — the operand/Block descent
  needs the same binder-awareness `resolveBoundSymbols` now has (extend the
  protected set when entering a `Function`/`Block`/`Sum`/… body).
- **Severity:** medium — a value-blindness violation that silently changes a
  function literal. Narrow trigger (a bound var shadowing a global assignment).

### B. Solve unknown-shielding: doubly-contradictory edge case

`Solve` shields a value-bound unknown by renaming it to a fresh symbol across
transformer reduction (finding #2 fix, `solve-domain.ts`). That rename breaks
when the unknown BOTH carries a value AND is reintroduced by another bound
symbol's value:

```js
const ce = new ComputeEngine();
ce.assign('w', 9);                             // unknown w has a value …
ce.assign('s', ce.parse('\\frac{9-w^2}{4}'));  // … and appears inside s
ce.box(['Solve', ['Equal', ['Simplify', 's'], 2], 'w']).evaluate();
// → []   (want [1, -1])
```

The nested `Simplify(s)` resolves `s → (9 - w²)/4` with the ORIGINAL `w`, but
the unknown was renamed to `__solve_w`, so the equation's `w` and the unknown
no longer match. The non-edge case (`w` unbound) works.

- **Trigger is doubly-contradictory:** `w` is simultaneously the solve target,
  a symbol with a concrete value, and a variable inside another definition.
  Vanishingly rare in practice.
- **Proper fix:** thread `Solve`'s protected-unknown set into the nested
  transformer's `resolveBoundSymbols` call (so it protects the unknowns instead
  of renaming). That needs the protected set to reach the transformer handler —
  the `EvaluateOptions` plumbing this session deliberately avoided. Do it if the
  transformer-resolution architecture is reworked (see Item 1 option 4).
- **Severity:** low — silent wrong answer, but only on contradictory input.

### C. Integrate/Limit of a nested transformer substitutes a valued bound variable

Same protected-set gap as §B, on the differentiation/integration side. `Integrate`
reduces a nested transformer head in its integrand via `reduceTransformerHead`
(`antiderivative.ts`, the `∫ Simplify(f) dx` path), which calls
`resolveBoundSymbols(…, EMPTY_NAME_SET)`. The integration variable is bound by the
`Integrate` ABOVE the integrand, not by a binder inside it, so it is not protected
and a global value substitutes:

```js
const ce = new ComputeEngine();
ce.assign('x', 5);
ce.box(['Integrate', ['Simplify', ['Power', 'x', 2]], 'x']).evaluate();
// → 25x   (want x³/3)
```

`Limit` has the analogous gap. Note `JacobianMatrix` already guards this exact
situation by renaming a value-bound differentiation variable to a fresh symbol
(`calculus.ts`, the `__jac_<name>` rename) — `Integrate`/`Limit` do not.

- **Trigger is doubly-contradictory:** integrating/limiting w.r.t. a variable that
  carries a concrete value. Vanishingly rare.
- **Proper fix:** same as §B — thread the bound variable into the nested
  transformer's `resolveBoundSymbols` protected set (or mirror `JacobianMatrix`'s
  fresh-symbol rename in the `Integrate`/`Limit` transformer-head reduction).
- **Severity:** low — silent wrong answer, only on contradictory input.

### D. Solve shielding is computed before bundled specs are lifted

The value-bound-unknown shielding map in `evaluateSolve` (`solve-domain.ts`) is
built only from the positional argument specs, BEFORE `Element`-constraint specs
bundled inside a collection-shaped first argument are lifted into `specs`. For an
arity-one bundled solve, a value-bound unknown that is only discovered during that
later lifting therefore stays unprotected while nested transformers reduce, so its
global value can substitute before the code learns it is the solve target.

- **Trigger:** a bundled/collection first-argument solve whose unknown both carries
  a value and is introduced via a bundled `Element` spec. Same §B family.
- **Proper fix:** lift the bundled specs (and resolve deferred unknown inference)
  BEFORE transformer reduction, so the full protected-unknown set is known when
  shielding is computed — subsumed by the §B protected-set rework.
- **Severity:** low — silent wrong/inert answer, only on contradictory input.
  (Surfaced by Codex; not independently reproduced — confirm with a repro before
  fixing.)
