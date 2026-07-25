# Symbol Identity: Name vs Binder

**Status**: ARCHITECTURE NOTE — 2026-07-24. Supersedes the "defining-scope
dereference" design that previously occupied this file (kept in §Appendix A);
that framing treated a symptom. All numbers below are measured, from
experiments applied and then reverted in one session.
**Executable spec**: `test/compute-engine/symbol-value-scoping.test.ts`
(characterization tests; the `@fixme` assertions flip when this lands).

## The stale invariant

`BoxedSymbol._def` dates to the **2022-03-16** baseline. `lexicalScope` first
appears **2025-07-15**. In the three years between, the engine had a single
global namespace, where

> a symbol's **name** determines its **binding**

was simply true — so keying the expression algebra on names was correct, not
sloppy. Scopes were woven in around `_def` without revisiting that premise.
Today a name no longer determines a binding, but the algebra still behaves as
if it does:

- `BoxedSymbol.isSame` (`boxed-symbol.ts:211`) is `this.symbol === other.symbol`;
- `Terms.find` (`arithmetic-add.ts`) collects like terms with `term.isSame(…)`;
- `hash` is `hashCode(this._id)` — name only.

So two same-named symbols bound to *different* definitions are, to the
algebra, one symbol. **`_def` is advisory; the name is load-bearing.** Every
defect below is a consequence.

## The consequences

### Staleness ("one-evaluate-late")

```
let d = 3x^2 + 1      // x free at this point
let x = 2
d                     // → 3x^2 + 1   (stale)
N(d)                  // → 13
```

`BoxedSymbol.evaluate()`'s non-constant path returns the stored value
verbatim. The constant path one branch up already re-evaluates
(`def.value?.evaluate(options)`), and so does the compiled path —
`compile(ce.box('d'))?.code` is `(3 * (2 * 2) + 1)` via
`BaseCompiler.tryFoldKnownSymbol`. Among interpret / `N` / compile, plain
`evaluate()` is the outlier.

### Name capture through call frames

```
let a = x + 1
g(x) = a
g(5)                  // → 6, and → 6 even with a global `let x = 100`
```

Two independent channels, both name-keyed:

- **Channel A** — the Tycho item 26 post-evaluation substitution
  (`function-utils.ts:1158`) rewrites any parameter *name* still present in
  the result. It fires even where no dereference occurred:
  `let a = x+1; g(z) = a; h(x) = g(1); h(5)` → `6`, captured by `h`'s frame
  on a value `g` had already returned cleanly.
- **Channel B** — the constant branch re-evaluates its stored value in the
  *current* context, so a frame binding intercepts at the dereference itself
  (verified with Channel A disabled).
- **Channel C** — the in-frame `numericApproximation` re-evaluation
  (`function-utils.ts:1180`) does the same thing on the `N` route.

Underneath all three: the frame's `x` and the stored value's `x` are the same
symbol as far as the engine can tell.

### Identity erasure by the algebra

The sharpest demonstration. With substitution made identity-aware but the
algebra left alone, `g(x) = a + x; g(5)` returns **`2x + 1`**: canonical `Add`
merged the parameter's `x` and the stored value's `x` into a single `2x` term
by name, destroying the distinction *before* any substitution could act on it.

## Measurements

Four experiments, each applied to a clean tree and reverted.

| experiment | full-suite result |
|:--|:--|
| **Delete** the item 26 substitution | 3 intended flips + **8 genuine regressions** (`collections` Map/Tabulate/Apply, `functions` held-conditional, NDSolveFunction ×2, cortex docs); 0 snapshot churn |
| **Body-source gate** (name-keyed: substitute only params occurring in the body source) | 4 intended flips + 2 timing flakes (`fungrim-loops`, `bug-fixes` — both pass isolated); 0 snapshot churn. Residual gap: `g(x) = a + x` → `11` |
| **Held-position gate** | too tight — 3 regressions (`Map(_1, k↦k²)` degrades, NDSolveFunction ×2) |
| **Identity-keyed `isSame`** (name **and** binder) | **9 failed / 19,662; 4,176 snapshots green** |

The last row is the headline. Three lines in one method, and:

| failures | cause | verdict |
|:--|:--|:--|
| 6 — `integration-rules` (Rubi) | `F.has('Integrate')` true: rules stopped matching. Rule patterns are boxed in a clean scope, so their symbols carry different defs | **carve-out**: patterns are syntax |
| 2 — `hold-values` | `r.isSame(ce.symbol('w'))` across the shield's shadow scope | **ruling needed** on assumption scoping |
| 1 — `jacobian-matrix` | `det.isSame(-2)` after `simplify()` | downstream of the rule path |

**Not one failure is the arithmetic algebra.** `Add`/`Multiply` folding,
ordering, canonicalization and 4,176 snapshots are indifferent to the change.

Scope of the surface, counted: of 138 name comparisons in
`src/compute-engine`, **67** check against a *literal* name (`x.symbol ===
'Pi'` — legitimately name-based, untouched) and only **12** compare two
symbols to each other. The algebra funnels through one of the 12.

## The repair

1. **Symbol identity = name AND binder.** Tighten `isSame`
   (`boxed-symbol.ts:211`): equal iff same name and same `_def`, falling back
   to name-only when either side is unbound/non-canonical (preserves
   non-canonical comparisons and post-serialization reboxing). `hash` needs
   **no** change — it stays name-keyed, since tightening equality only removes
   equalities and hash collisions remain legal.

2. **Patterns are syntax — carve them out explicitly.** The matcher compares
   *templates* to *subjects*; a rule's `x` is a syntactic placeholder, not a
   binding. `match-dispatch.ts:476` and `compare.ts:90` stay name-based. This
   boundary exists implicitly today; the repair makes it stated.

3. **Rule the assumptions question.** Should `assume(x > 0)` in one scope
   apply to a same-named `x` in another? Today yes, by accident of name
   keying. Identity says no. The `HoldValues` shield needs whichever answer
   is chosen to be explicit rather than emergent.

### What this retires

- the item 26 heuristic — spike-verified: keyed on binder identity, all four
  `collections` tests and the held-conditional test pass with the entire
  held-conditional / shadowing / argument-ambiguity heuristic **deleted**;
- the body-source gate (a name-keyed approximation of the same question);
- α-renaming (only ever a way to smuggle identity into the channel the
  algebra respected — unnecessary once the algebra respects identity);
- the def→scope back-reference and `_inScope`-at-dereference of the
  superseded design;
- environment-carrying expressions — the heavier alternative, which has the
  same erasure problem unless symbol equality accounts for the environment.

## Sequencing

1. **Carve-outs first, on today's equality.** Make pattern matching and
   assumption lookup explicitly name-based where they are already implicitly
   so. Zero behavior change; reviewable in isolation.
2. **Flip `isSame`.** Expected residue after step 1: the 2 `hold-values`
   tests plus whatever the assumptions ruling decides.
3. **Delete the compensation layer** — item 26's heuristic, then re-examine
   Channel C (`function-utils.ts:1180`) and the frame-death passes
   (`captureClosures`, `resolveEscapingLambda`, `hideBodyScopeParams`, the
   body-scope re-parenting), which lose their reason to exist.

Do NOT reopen the shared-canon-scope model (the failed 2026-07-07 redesign;
`docs/plans/2026-07-07-block-scope-capture-investigation.md`). This repair
leaves the parenting model untouched — "canon scope IS the runtime frame"
stays true.

## Open questions

- **`Sum`/`Comprehension` index binders and re-entered canon scopes**, where
  one binder is reused across iterations. Green under the measurement, but
  green under a change this deep deserves a targeted probe, not trust.
- **Recursion**: whether one binder with several simultaneous activations
  needs distinguishing. A spike hit a stack overflow here, but the trace
  showed a *single* activation on the stack — the hook sat in `_value`, which
  type inference also consults. Unresolved, and not evidence either way.
- **NDSolveFunction ×2 and the cortex `Map(_1, k↦k²)` doc block** failed under
  *every* variant except the body-source gate. They are the cheapest available
  oracle for this area; understand them before step 2.
- **Serialization** deliberately stays name-only, so a MathJSON round-trip
  loses identity and reboxing rebinds to the current scope. That is the
  intended semantics — worth stating in user docs.

## Appendix A: the superseded framing

This file previously proposed giving each *definition* a back-reference to its
scope and re-evaluating stored values there (`_inScope`), plus a "provenance"
mechanism for the item 26 substitution. It was wrong in a specific, instructive
way: it attached the environment to the **definition**, but the thing that
travels is the **value** — so the environment was lost the moment the value was
extracted, and step 3 existed only to reconstruct information the architecture
had discarded. A fix whose hard part is recovering discarded information is a
mitigation by construction. The three capture rows of its outcome table also
required two unrelated mechanisms to combine, which is what a missing
abstraction looks like.

## Appendix B: the naive prototype (measured, then reverted)

The current-context variant. NOT proposed — it evaluates in the caller's
context, which is what makes block-locals capture, and is what the constant
path does today (Channel B):

```diff
--- a/src/compute-engine/boxed-expression/boxed-symbol.ts
+++ b/src/compute-engine/boxed-expression/boxed-symbol.ts
@@ -829,6 +829,14 @@ export class BoxedSymbol extends _BoxedExpression
         let expr = this.engine._getSymbolValue(this._id) ?? this;
         if (expr.operator === 'Unevaluated')
           expr = expr.evaluate(options) ?? this;
+        else if (!isNumber(expr) && !expr.symbols.includes(this._id))
+          expr = expr.evaluate(options);
         return expr;
       }
     }
```

Full suite green with it applied (zero churn), which is how we learned that
nothing in the corpus depends on staleness — and nothing covered the capture
bug either, a gap the executable spec now closes.
