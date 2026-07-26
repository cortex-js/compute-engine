# Symbol Identity: Name vs Binder

**Status**: ARCHITECTURE NOTE — 2026-07-24, updated 2026-07-25 with the
implementation record. Supersedes the "defining-scope dereference" design that
previously occupied this file (kept in §Appendix A); that framing treated a
symptom.

> **RESUMING? START HERE — §Handoff (2026-07-26) at the end of this file.**

**Phase 1 (equality + escape leaks): IMPLEMENTED, reviewed, committed** — see
§Implementation record.

**Phase 2 (the compensation layer): DONE.** The item 26 heuristic is deleted and
replaced by a binding-keyed substitution; every capture symptom below is fixed,
INCLUDING `g(x) = a + x` → `x + 6`, which no name-keyed variant could reach. Five
wrong-scope binding defects were found and fixed along the way (§The recurring
defect).

**Phase 2 step 3 (dereference): IMPLEMENTED 2026-07-26, staged.** A symbol's
stored value is evaluated in the environment its own free symbols denote
(`evaluateInOwnBindings`, `binders.ts`), which closes the staleness half AND
Channel C. All eight `@fixme`s are flipped and the executable spec is green;
full suite green with **4179/4179 snapshots unchanged**.

Still open, and deliberately: §Sequencing steps 4 (named-parameter rebind) and
5 (a sanctioned binder mechanism). Step 3 did not need them, but it did confirm
why they exist — see §The dereference rule.

**Equality is now strict (option B).** `sameBinding` requires both sides to
agree on being bound and on the binding; template-vs-subject comparison is the
explicit `sameSyntactic` entry point. This replaced an earlier resolution
(option A: narrow the documented contract) that was **twice** justified by the
loophole being unreachable, and twice falsified — most recently by a reviewer
showing a canonical expression can CONTAIN raw operands. Re-routing the matcher
took two call sites and fixed 11 tests + 7 snapshots; the remaining
template-comparison and driver sites were routed in review round 2 (§Handoff).

**Executable spec**: `test/compute-engine/symbol-value-scoping.test.ts`
(characterization tests). Its four capture `@fixme`s now FAIL, because they
assert the buggy values and the bugs are fixed; flipping them is deliberately
deferred until dereference lands, so the flip records a stable value rather
than a half-state.

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

Written in the present tense of the diagnosis. All of them are now fixed —
staleness and Channels B and C by §The dereference rule, Channel A by the
binding-keyed substitution — and each is pinned by
`test/compute-engine/symbol-value-scoping.test.ts`.

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

1. **Symbol identity = name AND binder — up to alpha-equivalence.** Raw
   binder-identity is too strong: it breaks re-boxing. A **bound** occurrence
   (bound by a binder ENCLOSING the comparison) compares **by name**; only a
   **free** occurrence asks which binding it means. `hash` needs **no** change
   — it stays name-keyed, since tightening equality only removes equalities
   and hash collisions remain legal.

   Two refinements that only measurement produced:

   - **An occurrence with no definition, of a name the enclosing binder owns,
     denotes that binder.** It carries no binding, so there is nothing else it
     could mean. Needed because the PARSER leaves a binding-site symbol raw —
     the `k` in `\sum_{k=1}^n` has no definition — while `ce.box(json)` binds
     it, so a strict definition match made the two routes disagree about the
     same expression.
   - **Binder tracking is per-side.** `a` and `b` mint their own definitions
     for the same bound variable (re-boxing does exactly that), so one shared
     set is asymmetric and `same(a,b)` can differ from `same(b,a)`.

2. **Patterns are syntax.** The matcher compares *templates* to *subjects*;
   `match.ts:158` and `match-dispatch.ts:476` already compare literal pattern
   symbols by name and needed no change. What DID need stating is the
   equality contract (below): a raw operand compares syntactically.

3. **Assumptions attach to BINDINGS, and are inherited down the scope chain.**
   Both, no conflict. A shadowing binding is a different variable and starts
   unconstrained. *Ruled 2026-07-25 after measuring: the engine already does
   this for lambda binders — with `assume(x>0)`, top-level `|x|` simplifies to
   `x` but `(x) ↦ |x|` does not, and `simplify` demonstrably descends into
   lambda bodies. Name-matching would have contradicted shipped behavior. The
   leak was the reverse case: an inner `declare('x')` — a brand-new variable —
   inherited the outer constraint.* The `HoldValues` shield keeps its
   assumptions not by name-matching but because its result is re-bound on the
   way out (§Escaping results).

### The equality contract

`isSame` is an equivalence relation over **canonical** expressions — the
domain of every structure that uses it as a dedup or matching key
(`Terms.find`'s like-term collection, the assumptions `ExpressionMap`).

A **raw** operand is deliberately outside it. Having no bindings, it can only
compare syntactically, so it matches a same-named canonical symbol whatever
that symbol is bound to. That is what lets a rule pattern — raw by necessity,
since canonicalizing would collapse its structure and mangle its wildcards —
match a canonical subject: the literal `\pi` of `\pi + a -> 2a` must match a
canonical `π`.

The price is that a raw operand is a transitivity bridge, so **a raw
expression must not be used as a dedup key**. Requiring both sides unbound
instead was measured at 23 tests and 14 snapshots across `DSolve`, `rules`,
`series` and `explain`. Pinned by four tests in `equal.test.ts`, including the
non-transitivity itself, so the boundary stays deliberate.

### Escaping results

A result that leaves a scope being discarded must be re-bound to the enclosing
scope, or it references a dead binding. Latent before — name equality hid it —
and now visible. `rebindEscaping` (`utils.ts`) does this; only occurrences
bound BY that scope are touched, so a stored value's free symbols are never
captured, and occurrences bound by a binder INSIDE the expression are skipped
so a returned closure is not corrupted.

Three sites found, all by following test failures rather than by audit:

| site | what escapes |
|:--|:--|
| `withValueShield` (`utils.ts`) | the shield's shadow bindings |
| `simplifyValueBlind` (`simplify.ts`) | same pattern, independent implementation — reached by the PUBLIC `.simplify()` |
| `lambdaFromLiteral` (`calculus.ts`) | a lambda body lifted out of its `Block`, carrying the parameter bindings |

The rebuild must carry the node's **own** `localScope`: `ce.function()` mints a
fresh empty one for a scoped operator, which would leave untouched operands
bound to the old scope — a `Sum` whose body no longer resolves its index.

Assume the inventory is **incomplete**: three sites were found reactively, and
the obvious untouched candidate is `makeLambda`'s call frame.

### The dereference rule (phase 2 step 3, 2026-07-26)

A free symbol inside a stored value is **not a name to be looked up again**. It
already carries the binding it was canonicalized against, and that binding is
the environment the value must be evaluated in. `evaluateInOwnBindings`
(`binders.ts`) binds each such occurrence to ITS OWN definition for the duration
of the evaluation, then evaluates. Called from two places:
`BoxedSymbol.evaluate()` (both the constant and non-constant branches — Channels
B and the staleness half) and `makeLambda`'s in-frame `numericApproximation` pass
(Channel C).

Two restrictions confine it, each one measured rather than reasoned:

1. **The occurrence's definition must be reachable** in the current scope chain.
   A call frame parks a parameter's value in a *fresh* definition and hides the
   body's own (`hideBodyScopeParams`), so a body occurrence's definition is
   unreachable BY DESIGN and the name lookup is the only thing that can answer.
2. **The shadowing binding must hold a VALUE.** A valueless shadow cannot
   capture anything, and shadowing a name valueless is how every shield in the
   engine works — `Solve` blinds its unknown at the source, `withValueShield`
   and `simplifyValueBlind` do it for `simplify`. Honoring the occurrence's own
   binding there resolves precisely what the shield exists to hide, and
   `solve.test.ts`'s "the unknown both has a value and is reintroduced by
   another binding" catches it immediately.

**The falsified alternative, recorded so it is not retried.** The obvious move is
to make resolution binding-aware *generally* — have `BoxedSymbol.evaluate()`
prefer the occurrence's own definition over an inner same-named binding
(reachable-but-shadowed ⇒ the occurrence wins). Measured: **100+ failures**,
including beta-reduction itself (`[[Function, x+1, x], 5]`), the `D`/`Integrate`/
`Limit` binder value-shields, and CONTRACT 4 in `pipeline-contracts.test.ts`
(`describe` at line ~515; NOT `scope.test.ts`, an error this doc used to
propagate) — a written
guarantee that a cached parent-scope expression DOES see a nested-scope shadow.

The reason is instructive and is the case for §Sequencing steps 4–5: a `Function`
literal's body frequently carries the OUTER definition for the literal's own
parameter, so "the occurrence's own binding" is not yet trustworthy for
parameters. That is the same wrong-scope class as §The recurring defect. Until a
binder owns its variables, dereference must stay confined to values it *knows*
came out of a definition — which is exactly what the two restrictions above
express.

Cost: the numeric fast path (a number literal — loop counters, numeric
arguments, `x = 2`) measures 0.0007 ms/iter, and the walk is not measurably more
expensive than the `evaluate()` it wraps. The added cost of the repair is the
evaluation the staleness fix now genuinely performs.

**The fast path must not be `value.symbols.length === 0`.** That is the obvious
cheap gate and it is unsound: `symbols` descends through function nodes only, so
a stored DICTIONARY reports no symbols while its values are full of them. It sent
`a = {k: x + 1}` down the fast path, and evaluating it inside a frame whose
parameter is also `x` produced `{k: 6}` — the very capture this helper exists to
prevent, reintroduced by its own optimization. `rewriteWithBinders` does descend
into dictionary values, so gating only on a number literal is both sound and
enough.

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

## Implementation record (phase 1 — landed 2026-07-25)

`binders.ts` (new leaf module, breaking the `compare → utils →
abstract-boxed-expression → compare` cycle), `compare.ts`, `boxed-symbol.ts`,
`utils.ts`, `simplify.ts`, `calculus.ts`, `rubi/match.ts`, plus four contract
tests in `equal.test.ts`. Full suite green, **4176 snapshots unchanged
throughout**.

The failure count as each piece landed — every number a full-suite run:

| step | failures |
|:--|--:|
| raw def-identity, `BoxedSymbol.isSame` only | 9 *(half the surface: nested symbols go through `same()`, not the method)* |
| raw def-identity, both sites | 34 |
| + alpha-equivalence | 22 — the whole re-boxing/serialization class gone |
| + Rubi integration-variable fix | 16 |
| + `rebindEscaping` at the shield | 5 |
| + `rebindEscaping` at `lambdaFromLiteral` | 1 |
| + constants compare by name | **0** |

**Only one of the four classes was a carve-out; three were real defects that
identity exposed.**

- **Rubi (6)** — `RubiDriver.int` takes the integration variable as a
  *string* and re-boxes it, while parsing `\int … dx` mints its own binding
  for `x`. `case 'var'` was comparing a BOUND variable against a name the
  driver never had a binding for. Instrumenting `sameBinding` found it in one
  run: 366 misses, all on `x`, all from `match.ts:115`. Pre-existing; name
  equality was masking it.
- **`HoldValues` (11) and `JacobianMatrix` (4)** — escaping results (above).
  In both, the engine's *answer* was already right; only the binding was dead.
- **Cortex (1)** — comparing `π/2` across two engine instances.
  `match-dispatch.ts:687` already documented that constants key by name; the
  first cut broke that invariant.

### The recurring defect: a binder's variable bound in the wrong scope

Four independent sites bound a binder's own variable somewhere other than the
binder. Each was invisible while symbols compared by name, and each surfaced
the moment equality started asking *which* binding:

| site | the bound variable | where it was actually bound |
|:--|:--|:--|
| `rubi/match.ts` `case 'var'` | the integration variable | the driver re-boxes it from a **string**, so: the global scope — while parsing `\int … dx` mints its own |
| `makeLambda` | a call parameter | **two** live bindings at once — the canonical body's (hidden) and the frame's in `freshScope` |
| pipe desugaring | the topic `_1` | the **defining** scope: `Pipe` is lazy, so `evaluate` canonicalizes `Map(_1, …)` in the caller's scope before wrapping it in `(_1) ↦ …`, and re-canonicalizing an already-canonical body is a no-op |
| `NDSolveFunction` | the ODE's independent variable | its `Limits` operand's binder, so an applied `ndsf(t)` keeps `x` and compiles to a function of the wrong argument |
| `Series` (found in review round 2) | the expansion variable | wherever the CALLER had it bound — the canonical handler passed `ops[1]` through untouched, so the parse route (raw) and the function route (caller's scope) disagreed and `Series(f, x)` failed to round-trip |

Five is no longer a coincidence. Every one of them is an operator that owns a
bound variable and communicates it *ad hoc* — by name, by string, by position
in a `Limits` operand, or by relying on canonicalization order. There is no
sanctioned way for an operator to say **"this operand is my bound variable,
bind it in my scope"**, so each site improvises and each improvisation binds
somewhere slightly different.

**Phase 3 candidate**: give binders one declared mechanism for their bound
variables, and make the binding site the single place that decides the scope.
That is a larger change than anything here, but until it exists this class of
defect will keep being found one test failure at a time — which is exactly how
all four of these were found.

A narrower symptom of the same gap, worth recording: **canonicalizing an
already-canonical body is a no-op**, so a body bound before its binder existed
keeps the earlier bindings. `rebindParameters` (`function-utils.ts`) repairs
this — **for ALL parameters since step 4 landed (2026-07-26)**. The historical
"8 measured dependents" that gated the widening proved stale on re-measurement
(7 failures, 3 classes, no curried-literal regression, and the Rubi failure
was arithmetic inside the driver — `Product.mul` declining to fold `x·x`
across two bindings — not `case 'var'`): `Integrate` handed its provider and
`antiderivative()` a body still bound to the literal's Block while both mint
caller-scope occurrences (fixed by `liftIntegrand`, `library/calculus.ts`,
using the `lambdaFromLiteral` convention), and a BINDING SITE held raw by a
lazy operator (`Declare`'s first operand) must not be canonicalized by the
rebind walk (fixed by skipping occurrences that carry no binding — the
equality contract's raw-operand rule applied to the rewrite). Three pins in
`symbol-value-scoping.test.ts` §SPEC: named-parameter rebind.

Two traps recorded from that work: `rebindEscaping` applied to a Block whose
own scope is the argument is a **no-op** (the root's bound names go straight
into `shadowed`) — lift the body out first, as `liftIntegrand` and
`lambdaFromLiteral` both do; and `Declare`'s `sym(ops[0].evaluate())` read
(`library/core.ts:1414`) silently no-ops if anything ever canonicalizes its
held first operand.

### Lesson for phase 2

Nine review fixes applied as one batch regressed the suite to 27 failures;
landed one at a time, eight were clean and the ninth turned out to be a
documentation defect rather than a code one. **Land and measure individually** —
the interactions are not predictable by inspection.

## Sequencing

1. ~~Equality + escape leaks~~ — **done**, reviewed (dual-reviewer round, nine
   findings, all resolved).
2. **Delete the compensation layer** — item 26's heuristic keyed on binding
   instead of name (spike-verified: all four `collections` tests and the
   held-conditional test pass with the entire held-conditional / shadowing /
   argument-ambiguity heuristic DELETED), then Channel C
   (`function-utils.ts:1180`), then the frame-death passes
   (`captureClosures`, `resolveEscapingLambda`, `hideBodyScopeParams`, the
   body-scope re-parenting), which lose their reason to exist.
3. **Dereference** for the staleness half.
4. ~~**Named-parameter rebind**~~ — **done 2026-07-26**: the `/^_\d*$/` gate
   is gone; the dependents were re-measured (3 classes, not the historical 8)
   and migrated first, one at a time. See the updated §The recurring defect
   closing paragraphs for what they actually were and the two traps recorded.
   Full suite exit 0, snapshots unchanged (4182 baseline — the count moved
   from 4179 via intervening commits, ReleaseHold pins among them, not with
   this change).
5. **A sanctioned binder mechanism** (see §The recurring defect) — the
   structural fix for the class that produced four separate repairs here.
   Antecedent worth copying (2026-07-25 review round): Lean's locally-nameless
   discipline — the binder constructor is the single authority for its
   variable, and a debug-mode invariant at `popScope` ("no live result
   references a binding of the dying scope") turns the next missing
   `rebindEscaping` site into an assertion with a stack instead of a mystery
   test failure. SymPy's `canonical_variables`/`dummy_eq` is the cheap route
   if rename-invariant comparison is ever wanted — and requires making
   `BoxedFunction.hash` alpha-invariant in the same change (warning now in
   place at the hash getter).

Only step 2 flips the `@fixme` assertions. Until then the symptoms are exactly
as recorded in §The consequences.

Do NOT reopen the shared-canon-scope model (the failed 2026-07-07 redesign;
`docs/plans/2026-07-07-block-scope-capture-investigation.md`). This repair
leaves the parenting model untouched — "canon scope IS the runtime frame"
stays true.

## Open questions

Answered by the phase-1 implementation:

- ~~**`Sum`/`Comprehension` index binders**~~ — answered, and they were the
  ones that bit. Alpha-equivalence covers the re-boxing case; the parser's
  raw binding-site symbol needed the no-definition rule (§The repair). Both
  are now pinned by `serialization.test.ts`'s G7 block.
- ~~**Serialization stays name-only**~~ — confirmed and now a stated contract
  (§The equality contract). A round-trip loses identity and reboxing rebinds
  to the current scope; that is the intended semantics and should reach the
  user docs.

Still open:

- **Recursion**: whether one binder with several simultaneous activations
  needs distinguishing. A spike hit a stack overflow, but the trace showed a
  *single* activation on the stack — the hook sat in `_value`, which type
  inference also consults. Unresolved, and not evidence either way. Phase 2
  touches the call frame, so this gets settled there.
- **`rebindEscaping`'s inventory is incomplete** — three sites found
  reactively, none by audit. `makeLambda`'s call frame is the obvious
  untouched candidate, and phase 2 goes there anyway.
- **NDSolveFunction ×2 and the cortex `Map(_1, k↦k²)` doc block** failed under
  *every* item-26 variant except the body-source gate. They remain the
  cheapest available oracle for the compensation layer; understand them
  before step 2.
- **The `same()` hot path** costs ~1.8 µs on a binder-free expression, down
  from 2.9 µs once `boundVariableNames` stopped allocating per node. Worth
  re-measuring after phase 2, since the binder maps are allocated more often
  once frames are involved.

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

## Handoff (2026-07-26)

### State of the tree

Phase 1 and the phase-2 compensation layer were **committed** (they are in
`HEAD`'s history; the round-2 handoff below described them while still staged).

**Dereference (phase 2 step 3) is COMMITTED** (`070fb966`). Full suite **exit 0**:
19,205 passed, 0 failed, snapshots **4179/4179 unchanged**. All eight `@fixme`s
in the executable spec are flipped, plus two regression pins added from the
review round, so the file is now a spec rather than a characterization suite.

The eager-capture semantics — including the `q + 6` cycle residual — were
ratified by the user on 2026-07-26 after a probe session, and are now
user-documented in `doc/06-guide-augmenting.md` ("When Is the Value Captured?")
with a cross-reference from the `Assign` entry in `doc/85-reference-core.md`.
A side-find from that session is fixed and committed separately (`2d0dabe6`):
`ReleaseHold` applied to a symbol whose VALUE is a held expression was a no-op;
it now releases one `Hold` layer, matching Mathematica.

The review round (dual-reviewer, 5 findings, all fixed) is folded into the
sections above: §The cycle guard is the subtle part (the throw became a flag, and
the abort got narrowed to the re-entered definition), §Borrowed definitions must
be handed back before the scope pops, and the fast-path note in §The dereference
rule.

Staged for this step:

| file | what |
|:--|:--|
| `boxed-expression/binders.ts` | `evaluateInOwnBindings` — the dereference itself (see §The dereference rule) |
| `boxed-expression/boxed-symbol.ts` | `evaluate()` routes both branches through `_dereference`, which owns the cycle guard |
| `boxed-expression/cycle-guard.ts` | one new query kind, `Dereference` |
| `function-utils.ts` | Channel C: the in-frame `numericApproximation` pass |
| `test/compute-engine/symbol-value-scoping.test.ts` | the eight flips + a rewritten header |

`binders.ts` rather than `utils.ts` is deliberate: `function-utils.ts` cannot
import `utils.ts` (that is the cycle its inlined `isValueDef` check exists for),
and `utils.ts` imports `binders.ts`, so the value-definition checks are inlined
there for the same reason.

### The cycle guard is the subtle part

`s = s + 1; s` must stay `s + 1` and `a = b + 1; b = a + 1; a` must stay `b + 1`,
while a cycle further away must not cost an innocent symbol its dereference.
Five reactions, all measured, all now pinned:

| on re-entry | `s = s+1; s` | `a = b+1; b = a+1; a` | `a = p+5; p = q+1; q = p+1; a` |
|:--|:--|:--|:--|
| resolve one more level | `s + 2` | `b + 5` | — |
| return the bare symbol | `s + 1` | `a + 2` | — |
| abort the whole chain | `s + 1` | `b + 1` | `p + 5` — loses a's dereference |
| abandon the re-entered def, always returning its value | `s + 1` | `b + 3` | `q + 8` |
| **…returning its value only at the top of the chain** | `s + 1` | `b + 1` | `q + 6` |

The last row is implemented: the re-entry point records WHICH definition is
cyclic, that definition's own frame abandons its dereference, and the stored
value escapes only when that frame is also the top of the chain.

Two traps live in the gap between rows 3–5, and both cost a debugging round:

- **Row 3 is over-broad.** `a` is not cyclic; aborting its dereference because
  something two hops down is reinstates exactly the staleness this repair
  removes. A depth counter alone cannot tell "I am the top of the chain" from "I
  am the cycle", so it needs both pieces of state.
- **Assignment is EAGER, so the cycle is already baked into the stored value.**
  With `a = b + 1` then `b = a + 1`, `b`'s stored value is `b + 2`, not `a + 1` —
  the dereference resolved `a` while evaluating the right-hand side. Row 3 was
  masking that; once a cyclic definition's value can escape to an enclosing
  expression (row 4), the extra level shows up as `b + 3`. Hence "only at the top
  of the chain".

**Not a throw.** A thrown sentinel is absorbed by the rule engine's blanket
`catch` handlers — `rules.ts` re-throws only `CancellationError` and otherwise
treats an exception as "this rule failed" — so a cyclic definition dereferenced
during `simplify()` would silently truncate the pass, or log a raw
`Symbol(dereference-cycle)`. It would also make `Dereference` the one
cycle-guard kind that throws, against the invariant at the top of
`cycle-guard.ts`. Failing closed keeps both properties, and costs nothing: the
guard already bounds the recursion.

### Borrowed definitions must be handed back before the scope pops

`evaluateInOwnBindings` installs the occurrences' OWN definitions in a temporary
scope, and popping a scope **disposes every value definition among its bindings**
(`discardEvalContext`, `engine-scope.ts`). Those definitions belong to the
caller's scopes, and disposing one bumps its write version and permanently
unsubscribes it from configuration changes — leaving a dynamic constant stale
after a precision change. The borrowed entries are therefore withdrawn from the
scope before the pop, and only those still identical to what was injected, so a
definition genuinely created inside the scope is still disposed normally.

(At the first checkpoint this read "RED: 19 failed / 18,824 passed, 7
snapshots failed". Review round 2 — 2026-07-25, dual-reviewer, 17 findings —
resolved the other 15; the rows below are kept for the record.) What the
round changed, beyond routing (each landed and measured individually):

- `sameSyntactic` routed at: the DSolve template comparisons
  (`replaceDependentCall`, Clairaut/Bernoulli helpers,
  `cancelHomogeneousRatio`), the matcher's wildcard-consistency check
  (`captureWildcard`), and ALL of the rules/simplify drivers' progress, cycle
  and change checks (`stepOf`, `hasSeen`, the fixpoint loop, `isCheaper`,
  operand-changed) — a syntax-rewriting loop must not use binding-aware
  equality as its progress test, or a re-boxed spelled-identical result
  defeats the cycle guards.
- `sameBinding` gained a ROOT-scope (standard library) carve-out: `Nothing`,
  `Sin`, `List`, … compare by name across engines (the root scope IS the
  library; user globals land in a child scope, so a shadowing user symbol
  stays distinct). Valueless user constants no longer merge. The
  `ad === bd` identity check is hoisted above the constant value comparison.
- The item-26 ambiguity guard is back in minimal, binding-aware form: when
  the ARGUMENT mentions the parameter name, only the FRESHSCOPE entry of the
  binding-keyed substitution is suppressed — canonical-body references (the
  hidden bodyScope binding) and raw held-body references stay substitutable,
  which is what keeps `Apply(w ↦ If(c, w, 0), w+1)` = `If(c, w+1, 0)`
  (pinned, `functions.test.ts`). KNOWN LIMITATION: an argument built from a
  PRE-BOXED RAW symbol (`ce.function('Apply', [f, Hold(raw x)])` — no box or
  parse route produces this) still double-applies
  (`Hold(x)` → `Hold(Hold(x))`): its occurrence acquires a frame-side binding
  indistinguishable at this layer from a held-body reference. Unpinned;
  owned by phase 2's makeLambda-frame work (dereference), which replaces this
  substitution with binding-aware resolution.
- The three rewrite walks (`rebindEscaping`, `rebindParameters`,
  `bindingKeyedSubs`) now share one traversal, `rewriteWithBinders`
  (`binders.ts`), which shadows via `boundVariableNames` — scoped operators
  count, not just `Function` parameter lists — and descends into dictionary
  values (previously skipped by every walk). `captureAvoidingSubs` and the
  held-conditional helpers are DELETED (were unreachable).
- `Series`' canonical handler now keeps its expansion variable RAW (the 5th
  sighting of §The recurring defect): the parse route left it raw while the
  function route kept the caller's canonical symbol, so `Series(f, x)` did
  not round-trip through LaTeX. Same convention as `nDSolveFunction`'s
  parameter — the binding belongs to the binder.
- Equality docs tightened: the relation is named BINDING-IDENTITY equality
  (not "alpha-equivalence" — renaming a bound variable still changes the
  answer, matching SymPy/`SameQ`), the equivalence-relation contract is
  scoped "modulo value-following" (with the `x:=1`/`y:=1` counterexample),
  and `BoxedFunction.hash` carries a warning that rename-invariant equality
  would require alpha-invariant hashing in the same change.

### The 19, and what each needed

| count | failure | what it needed |
|--:|:--|:--|
| 11 | ~~`DSolve › …` (differential-equations)~~ | RESOLVED — comparison sites routed through `sameSyntactic` (see UPDATE) |
| 1 | ~~`explain: golden solve explanations › \|x-1\|=2`~~ | RESOLVED — same round (the rules/simplify progress checks) |
| 2 | ~~`equal.test.ts › isSame: the canonical/raw boundary`~~ | RESOLVED — rewritten to the option-B guarantee, incl. the lazy-operator (`Hold` over a pre-boxed raw symbol) transitivity case and cross-engine library-symbol coverage |
| 4 | ~~`symbol-value-scoping › @fixme …`~~ | RESOLVED 2026-07-26 — dereference landed, and all EIGHT `@fixme`s flipped (the four staleness/Channel-B ones had been passing against the buggy values) |
| 1 | ~~(varies)~~ | identified in round 2: `series.test.ts › unevaluated Series round-trips` — NOT a flake, a deterministic 5th sighting of §The recurring defect (see below). RESOLVED |

### The tracing recipe (found every binding site so far, one run each)

Temporarily instrument `sameBinding` in `compare.ts` to record a stack the
first time it returns `false` for a given symbol name, run ONE failing case
through `npx tsx`, and read the stack. It pinpointed the Rubi integration
variable (366 misses, all `x`, one call site), the pipe topic, and the
`matchPermutation` anchor comparison — each in a single run. Remove the
instrumentation afterwards; it has been added and removed several times.

### Known flakes — always re-run isolated before treating as a regression

`compile-performance`, `functions.test.ts` (ASYNC LANE), `bug-fixes`
(playground parse timing), `assumptions` (SIGN PATH), `deadline-regressions`,
`latex-syntax/arithmetic` (EL-4), Gamma bignum. All ten "failures" of this
kind in one run passed in isolation. Tell: the test name says *hangs*,
*terminates*, *stays fast*, or *polynomial time*.

**NOT a flake, and a lesson in attribution (2026-07-26).**
`integration-rules › … (1.1.3, R28a) › …(#544)` failed as
`F.has('Integrate')` → `true` (the integral stayed inert) in two full runs of
this session, passed in two others, and passed isolated. Every symptom said
"load-sensitive Rubi time limit", and that was recorded here as a new flake
entry. It was wrong.

The cause was **concurrent unstaged work in the same tree**: gating `zeroQ`'s
`.N()` through the `.unknowns` funnel made a *symbolic* zero test return `false`,
costing R28a its closed form (`rubi-utils.ts` now carries a "must stay UNGATED"
comment saying so). The pass/fail pattern tracked exactly when that change was
present, reverted, re-applied and fixed — not load. The isolated run that
"proved" it was a flake happened to run while the change was reverted.

Two lessons, both cheap to apply next time:

- **Isolated-passes is not sufficient evidence of a flake** when another agent or
  the user is editing the tree. Check `git status` and file mtimes against the
  run's start time before concluding anything, and re-run the suite at a known
  tree state.
- **A wrong flake entry is worse than no entry**, because the next session will
  dismiss a real regression signal. If attribution is uncertain, record the
  uncertainty and the evidence, not a verdict.

### Then, in order

1. ~~Finish DSolve + explain~~ — done (review round 2).
2. ~~Rewrite the two `equal.test.ts` boundary tests for option B~~ — done.
3. ~~**Dereference** (phase 2 step 3)~~ — done 2026-07-26; see §The dereference
   rule for the mechanism, the two restrictions, and the 100+-failure
   general-resolution variant that must not be retried.
4. ~~Flip the `@fixme`s~~ — done; all eight.
5. `/review-staged` on the dereference diff. Round 2 (2026-07-25) covered the
   mid-phase checkpoint — dual-reviewer plus an antecedents-research leg, 17
   findings, all addressed — but step 3 is new surface.

### What phase 3 should take from step 3

Dereference had to be *confined* (§The dereference rule) purely because a
`Function` literal's body can carry the outer definition for the literal's own
parameter. Fix that — §Sequencing steps 4 and 5 — and the confinement's second
restriction becomes unnecessary, because "the occurrence's own binding" would
then be trustworthy everywhere. The `Solve`/`simplify` shields would still need
the valueless-shadow carve-out, or an explicit value-blind evaluation mode, which
is what they arguably wanted in the first place.

### Process lessons worth not relearning

- **Land and measure one change at a time.** Nine review fixes as one batch →
  27 failures; individually, eight were clean and the ninth was a
  documentation defect. Two semantic tighteners applied together were
  mutually un-attributable.
- **Don't claim a loophole is unreachable.** Option A was chosen twice on that
  argument and falsified both times — the second time by a reviewer in one
  round. If a relation is supposed to be an equivalence relation, make it one.
- **`prettier --write` on a file that was not prettier-clean** produces ~100
  lines of unrelated churn (`typed-function-literals.test.ts`). Format only
  the hunks you touched.
