# Scoping: `simplify()` reach, `Together` reduction, and the evaluate/simplify split

**Date:** 2026-07-23 (updated 2026-07-24)
**Status:** living record. Items 1–3 and follow-ups §A/§B/§E landed 2026-07-23.
§C and §D remain open. Two 2026-07-24 rulings, both decided and not yet
implemented: the end of Item 1 rejects option 4 for the `.simplify()` method,
adopts it for the `Simplify` operator, and retires the option-2 whitelist; §F
ratifies the bound-variable binding convention (recorded normatively in
`ARCHITECTURE.md`), the symbolic-result rule for binders, `SymbolicBlock`, and
a binder audit that subsumes §C.

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

### Resolved (was "Related, still open: transformers and value-bound symbols")

This section predated the "Outcome — transformers and value-bound symbols"
above and was left in by mistake. Both of its claims were re-probed 2026-07-24
and are resolved: `Simplify(v)` with `v := (x²-1)/(x-1)` returns `x + 1`, and
the `"yw"` string-serialization defect no longer reproduces (the probe
serializes cleanly as `4y² + 12y + 8`).

### Ruling 2026-07-24 — option 4 rejected for the method, adopted for the operator; option 2 retired

**Status: decided, not yet implemented.**

The question option 4 left open ("should `simplify()` evaluate first?") is
settled by splitting it per surface — the same line the landed transformer
outcome already drew:

- **The `.simplify()` method keeps its contract unchanged**: value-blind,
  rule-driven rewriting, never substitutes an assigned value, never runs an
  `evaluate` handler. Option 4 at the method level is **rejected** — it is now
  architecturally incompatible with the value-blindness contract ratified and
  test-pinned across the fold fix (`e8848081`), Item E (`915c1a33`), and the
  §B shield. The recipe for "compute, then simplify" remains
  `expr.evaluate().simplify()` (documented in `docs/SIMPLIFY.md`).
- **The `Simplify` operator becomes evaluate-then-simplify**: its handler
  calls `.evaluate()` on the (reduced) operand, then `.simplify()`. This is
  option 4 scoped to the operator boundary, and is the consistent endpoint of
  the landed ruling that "an operator normally evaluates its arguments" — the
  operator already resolves value-bound symbols. It closes the residual
  producer-head inertness (probed 2026-07-24: `Simplify(Max(3,5))`,
  `Simplify(D(x²+ax, x))`, and `Simplify(Integrate(x², x))` are all no-ops on
  both routes today; the whitelist only ever covered structural heads).
- **The option-2 whitelist is retired as subsumed.** `SIMPLIFY_EVALUABLE_HEADS`
  and `evaluateStructuralHead` (self-contained in
  `boxed-expression/simplify.ts`, one call site) are deleted, along with the
  Item-E corollary machinery that rode on them. The whitelist was compensation
  for the operator gap; with the operator evaluating, its only residual
  coverage was the bare method on a structural head, where the answer is the
  same recipe we give for `Max` and `D`. It is unreleased (landed after the
  0.93.0 commit), so retirement has zero consumer exposure — still worth a
  CHANGELOG line under `## [Unreleased]`.

Consequences accepted with the ruling:

1. `Determinant(...).simplify()` (the method) returns to being a no-op — the
   contract working as documented.
2. The whitelist's value-blind structural evaluation migrates to normal
   evaluation at the operator: with `a := 5`, `Simplify(Det([[a,b],[c,d]]))`
   gives `5d − bc`, not the symbolic `ad − bc` the method briefly produced.
   Consistent with operators evaluating their arguments.
3. `Simplify` inherits evaluation cost (an expensive `Sum`/`Integrate` operand
   now computes). Same cost profile as `Evaluate`.
4. The other transformers (`Expand`/`Factor`/`Together`/`Distribute`) are
   **unchanged** — they keep reduce-not-evaluate, since acting on an
   unevaluated structure is often the point there.

The resulting two-line contract: **method — rules only, value-blind; operator —
evaluate, then rules.**

Before landing: measure snapshot blast radius (expected ~zero — the whitelist
landed with zero churn), and check whether `reduceTransformerOperand` becomes
partially redundant inside `Simplify`'s handler once evaluation runs first.

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

Original order (Items 2 → 1 → 3) completed 2026-07-23. Remaining, as of
2026-07-24:

1. **Implement the Item-1 ruling**: `Simplify` operator
   evaluates-then-simplifies; delete the option-2 whitelist; update tests,
   `docs/SIMPLIFY.md`, and CHANGELOG; measure snapshot blast radius.
2. **§F binder audit** (subsumes §C): extract the shared `withValueShield`
   helper; fix `Integrate`/`Limit` transformer reduction (build a real `Limit`
   repro first), `Minimize`, and `D`'s result under the symbolic-result
   ruling; migrate `JacobianMatrix`'s rename; sweep the full binder list.
3. **§F `SymbolicBlock`**: lazy binder operator, sugar over the shadow-scope
   shield; box/parse-route tests per the lazy-operator trap; document in
   `docs/SIMPLIFY.md` alongside the `Block(Declare(…), …)` compositional form.
4. **§D** — construct the canonical bundled-solve repro; fix (lift specs before
   shielding) only if it reproduces, else record and close.

---

## Open follow-ups (tracked 2026-07-23, from the dual-reviewer pass)

Two issues surfaced by the staged-review of the lazy-operand fixes were left
unfixed on purpose. Both are confirmed with repros below.

### A. `.simplify()` (the method) corrupts a lambda/binder body — PRE-EXISTING — **LANDED 2026-07-23**

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

**Outcome (landed).** Two distinct loci, both located by bisection rather than
guessed:

1. `boxed-expression/simplify.ts` — `evaluateNumericSubexpressions` folded a
   subexpression whose only reason for having no `unknowns` was a value-bound
   variable (the `Function` body `Add(x,1)` with a global `x := 5`).
2. `symbolic/simplify-sum.ts` — the `simplifySum` rule classified the body `x`
   as index-INDEPENDENT because a value-bound `x` drops out of `.unknowns`,
   producing `3·x`. Its index-dependence tests now use the value-blind
   `.symbols` (syntactic occurrence), so a bound index always counts. Behavior
   is unchanged for an unbound index (the normal case).

The first locus turned out to be one face of a **broader value-blindness leak**
(see below) and is fixed by the same predicate.

#### Broader fix: `simplify()`'s numeric folds are now fully value-blind

The binder corruption was a special case of a general leak: every numeric-fold
gate used `unknowns.length === 0` as a proxy for "genuinely constant", but
`.unknowns` silently drops symbols that carry an assigned value — so
`(9 - w²).simplify()` with `w := 5` folded to `-72`, and `|w|` folded to `5`.
`.simplify()` must never substitute an assigned value (that is `.evaluate()`'s
job).

A single predicate, `hasAssignedVariable(expr)` (`boxed-expression/utils.ts`),
now gates each fold: it is true when a free symbol carries a USER value —
excluding built-in constants via `def.value.isConstant`, so `ln(e) -> 1`,
`√(1+2) -> √3`, and `|3+4i| -> 5` still reduce. It subsumes the binder case (a
corrupting bound variable is exactly one with a global value), so no separate
binder-tracking is needed. Applied at all five fold sites:

- `simplify.ts` — `evaluateNumericSubexpressions` (Add/Multiply/… and Ln/Log)
  and the default-branch numeric fold;
- `symbolic/simplify-rules.ts` — the `Add` and `Multiply` operand folds;
- `symbolic/simplify-abs.ts` — the `|z|`-modulus fold.

Ordered last (after the cheap `unknowns`/operator checks), so it runs only on
fold candidates — no hot-path cost.

Regression tests in `test/compute-engine/simplify.test.ts` (both binder repros,
a compound lambda body, `Sum x²`, the plain value-blindness pins, the broader
`9 - w²`/`|w|`/quotient cases, and the constant-still-folds pins). Full suite
green (18432 passed), **zero snapshot churn**.

Not addressed (separate, deeper): sign-based rewrites still read a value's SIGN
(`|w|` with `w := 5` simplifies to `w`, using `w ≥ 0` inferred from the value) —
that is not a numeric fold and would need value-blind sign inference. Scoped as
item **E** below.

### B. Solve unknown-shielding: doubly-contradictory edge case — **LANDED 2026-07-23**

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

**Outcome (landed).** The `EvaluateOptions`-threading route was explored and
**rejected as incomplete**: threading a protected set into the transformer's
`resolveBoundSymbols` keeps the unknown symbolic *there*, but the transformer's
own `.simplify()` then re-folds it via the `Add`/`Multiply` simplification
**rules** (`simplify-rules.ts` evaluates a no-`unknowns` compound operand), and
those pure rule functions have no options channel — reaching them would mean
re-plumbing the whole rule system.

Instead, `evaluateSolve` (`solve-domain.ts`) now protects each value-bound
unknown at the **source**: `reduceWithUnknownsShielded` shadow-declares it
VALUELESS (with its current type) in a temporary scope for the duration of the
transformer reduction. With no value in scope the unknown reduces as a genuine
unknown — `Simplify`/`Expand`/… resolve the *other* bound symbols and leave it
symbolic — and because the shield is on the binding rather than the name, it
covers the doubly-contradictory case (`s := (9-w²)/4` reintroduces `w`, still
valueless). The rename shield and its `KNOWN EDGE` note are removed.

Regression tests in `test/compute-engine/solve.test.ts` (the §B repro plus a
value-restored-after-solve pin, and the three protected verification cases).
Full suite green, zero snapshot churn.

### C. `Integrate`/`Limit` transformer reduction substitutes a value-bound bound variable — OPEN, subsumed by the §F binder audit

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
- **Proper fix (revised 2026-07-24):** the originally suggested route — thread
  the bound variable into `resolveBoundSymbols`'s protected set — is the one
  §B's outcome explored and **rejected** (the simplify rules re-fold the symbol
  and have no options channel). Use the seam that worked in §B and Item E
  instead: shadow-declare the integration/limit variable **valueless** (keeping
  its type) for the duration of the transformer-head reduction, ideally by
  extracting `reduceWithUnknownsShielded` (`solve-domain.ts`) into a shared
  helper rather than writing a third copy.
- **Severity:** low — silent wrong answer, only on contradictory input.
- **Re-confirmed 2026-07-24:** the `Integrate` repro above still returns `25x`.
  The `Limit` gap is asserted by analogy only — build a correct repro first
  (a naive probe form evaluates the operand before `Limit` sees it, proving
  nothing).

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
- **Probe note 2026-07-24:** a bundled-form probe
  (`Solve([equation, Element(w, Integers)])`) came back inert, but the surface
  form used may itself have been wrong — read `solve-domain.ts`'s spec-lifting
  to construct the canonical bundled form before treating this as reproduced.

### E. `simplify()` reads a value's SIGN — value-blind sign inference — **LANDED 2026-07-23**

The numeric-fold fix (§A "Broader fix") made `simplify()` value-blind for
**folds** — it no longer substitutes an assigned value to reduce a
subexpression to a number. But a second class of rewrite remains: ones that read
a symbol's **sign/parity** rather than its magnitude. With `w := 5`:

```js
ce.assign('w', 5);
ce.parse('|w|').simplify();        // → w        (uses w ≥ 0 from the value)
ce.parse('\\sqrt{w^2}').simplify(); // → w        (same)
```

This is the same value-blindness violation as `9 - w²` → `-72`, and it is a
genuine **silent-wrong-answer trap**, not just an inconsistency:

```js
ce.assign('w', 5);
const e = ce.parse('|w|').simplify();  // → w
ce.assign('w', -3);
e.evaluate();                          // → -3   (WRONG: |−3| = 3)
ce.parse('|w|').evaluate();            // →  3   (a fresh |w| is correct)
```

The simplified form silently baked in the sign that held at simplify time.

**The crux — do NOT just stop doing sign rewrites.** The *same* rewrite is
correct and intended when the sign comes from an **assumption**:

```js
ce.assume(ce.parse('w > 0'));
ce.parse('|w|').simplify();  // → w   ✓ correct — assumptions are how you give
                             //          simplify() facts
```

So the invariant is precise:

> `simplify()` may use sign/parity derived from a symbol's **declared type** and
> **in-scope assumptions**, but NOT from its **assigned value**. An assigned
> value must be treated as if the symbol were merely *declared* with that
> value's type — an `integer` is not provably non-negative, so `|w|` stays
> symbolic.

**Why this is harder than the fold fix.** The fold fix keyed off a single cheap
predicate (`hasAssignedVariable`) at a handful of gates. Sign is driven by the
`isNonNegative` / `isPositive` / `isNonPositive` / parity properties, which
(a) are consulted by a *family* of rewrites, not one site, and (b) legitimately
read the assigned value elsewhere (`.evaluate()`, type inference) — so they
cannot be changed globally. The value-blindness belongs to `simplify()`'s *view*
of the symbol, not to the sign property itself.

**Scope — it is a family, audit first.** Confirmed so far: `Abs`
(`symbolic/simplify-abs.ts`) and even-root `√(w²)`. Likely also: `Sign`,
sign-dependent power branches (`(x²)^(1/2)`, odd/even exponent rules), piecewise
guards, and any `isEligibleRealRewrite`-style gate that reads a sign. Enumerate
every sign/parity-driven rewrite before designing the fix.

**Two implementation seams to weigh:**

1. **A value-blind sign query** threaded through the sign-based rewrites: sign
   from type + assumptions, ignoring an assigned value. Most surgical, but needs
   the query built and every site converted.
2. **Run the sign-based rewrites under a value-stripped view** — reuse the §B
   shadow-scope trick: shadow-declare assigned non-constants valueless for the
   duration, so `isNonNegative` naturally falls back to type + assumptions.
   Cheaper to wire, but must not strip *constants* and must keep assumption
   lookups intact; watch the per-simplify cost.

**Risk:** higher than the fold fix — sign rewrites are load-bearing in many
snapshots (the fold fix hit zero churn partly by luck). Measure the blast radius
before committing to a direction.

**Severity:** medium — a silent value-blindness violation that can bake a wrong
sign into a saved expression. Narrow trigger (assign a value, then `simplify()`
— not `evaluate()` — an expression whose rewrite depends on that value's sign).

**Recommendation:** worth doing for the same reason the fold case was, but as a
deliberate pass with the audit up front, not a reflexive patch.

**Outcome (landed).** Committed `915c1a33` (8 files). Seam **2** (the
value-stripped view) was chosen: `simplifyValueBlind` in `simplify.ts`
shadow-declares each assigned non-constant free symbol **valueless, keeping its
declared type**, for the duration of the run. It is wired at the public
`.simplify()` **method** (`boxed-function.ts`, `boxed-symbol.ts`), not the
recursive internal `simplify()` function — one shadow scope per call, not per
recursion. The make-or-break was empirically confirmed: assumptions survive the
shadow scope (`assume(w > 0)` + `w := 5` still gives `|w| → w`), constants keep
their values, and re-entrancy is naturally safe (a shadowed symbol no longer
reads as assigned, so nested simplifies don't re-shadow). Zero snapshot churn
(4172/4172). One corollary: structural heads evaluated **value-blindly** under
the method (`Determinant` with `a := 5` → symbolic `ad − bc`) — superseded by
the 2026-07-24 ruling at the end of Item 1, which retires that whitelist
entirely.

### F. The binding convention, `SymbolicBlock`, and the binder audit — RATIFIED 2026-07-24, not yet implemented

The §B/§E shadow-scope shield generalized into a single user-facing mental
model, ratified by the repo owner and recorded normatively in
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) ("Bound variables, free symbols,
and assigned values"):

> A bound variable is a pure symbol: its declared type and in-scope
> assumptions apply, its assigned value never does. A free symbol's value
> always applies under evaluation — in every operator uniformly.

There is no operator taxonomy ("symbolic" vs "value-considering") — what
varies is whether an operator **binds** a variable. Three consequences were
ratified together:

1. **Symbolic-result ruling for binders.** The bound variable stays symbolic
   *in the result*: with `x := 5`, `D(x², x)` → `2x` (today: `10` — the
   handler differentiates correctly but the result is then evaluated at the
   global value) and `Integrate(x², x)` → `x³/3` (today: `25x`, wrong under
   any semantics). A user who wants the value evaluates the result again or
   substitutes explicitly.
2. **`SymbolicBlock` operator** (name TBD-ok): a lazy binder that binds the
   assigned free symbols of its body — all of them, or a listed subset —
   analogous to Mathematica's `Block[{x}, …]`. It is the per-call opt-out
   that lets `Together`/`Expand`/`Factor` keep their landed resolve-values
   default: `SymbolicBlock(Together(1/x + a/x²))` → `(x + a)/x²`. Probe
   2026-07-24 confirmed the compositional form already works —
   `Block(Declare(w, 'real'), Simplify(|w|))` with `w := 5` → `|w|` — so the
   operator is thin sugar over an existing mechanism. Implementation notes:
   shadow-declare valueless keeping declared type; assumptions survive
   (§E-confirmed); constants exempt; it is `lazy`, so per the lazy-operator
   trap it needs a `canonical` handler and box/parse-route tests.
3. **Binder audit with a shared helper.** Extract
   `reduceWithUnknownsShielded` (`solve-domain.ts`) into a shared
   `withValueShield(ce, names, fn)` and apply it at every binder head — no
   more per-operator renames (`JacobianMatrix`'s `__jac_` rename migrates).
   Probe findings 2026-07-24: `Solve` ✓, `Sum`/`Product`/`Limit` (parse
   route) ✓; **`Minimize` is broken** (`Minimize(x², x)` with `x := 5`
   canonicalizes to inert `Minimize(25, 5)` — value substitutes into body
   AND variable spec); `D` needs the symbolic-result fix; `Integrate`/`Limit`
   transformer reduction is §C. Audit the full binder list
   (`collectBinderNames`) including quantifiers and comprehension indices.

This section subsumes §C (its fix becomes one site of the audit).
