# `explain` — step-by-step explanations (design proposal)

**Status:** approved 2026-07-04 (§8 answers inline); **Phase 1 implemented
2026-07-04** (simplify explanations + labeling layer + `UNIVARIATE_ROOTS` ids
+ `matchAnyRulesWithSteps`; one deviation: the labels module lives at
`boxed-expression/explain-labels.ts`, not `symbolic/` — the architecture
layering rule forbids `boxed-expression/` importing from `symbolic/`; label
coverage measured at 100% over the simplify corpus, vs. the ≥90% target);
**Phase 2 (solve) implemented 2026-07-04** (optional `trace` accumulator
threaded through `findUnivariateRoots` and its strategy helpers — pure
observation, provisional sub-traces for strategies that can fail so only the
winning strategy's steps join the narrative; equation-valued steps; branch =
one list-valued step as specced; systems/Or throw "not supported yet") ·
**Date:** 2026-07-04 ·
**Roadmap:** Product feature track item (agreed 2026-07-04): surface the
internal `RuleSteps` trace publicly; coverage simplify → solve → D;
human-readable step labeling.

## 1. Goals and consumers

- **Tycho / Graph Paper:** an educator/student clicks "explain" on a
  simplification, an equation solution, or a derivative and sees the textbook
  chain: *expression → step (with a reason) → … → result*. No competing JS
  engine has this (mathsteps is abandoned and covers a fraction of it); it is
  the flagship educational differentiator of the track.
- **Debugging (secondary, free):** the same surface answers "why did simplify
  do that?" for engine developers and rule authors — today that requires
  editing engine internals.
- **Consumers get structure, not prose:** each step carries the expression
  state, a stable machine id, and a default English description. Rendering,
  styling, and localization belong to the app; the engine guarantees the ids
  are stable so a consumer can key translations and custom copy off them.

Non-goals (v1): natural-language proof generation, explaining *why a rule is
true* (vs. which rule applied), tracing numeric evaluation/`N()`,
reconstructing canonicalization (see §4), interactive/step-at-a-time control,
`Integrate` traces (Rubi's rule chain is a natural future fit, but the
opt-in-package boundary makes it its own design).

## 2. What exists today (survey summary)

- `RuleStep = { value, because, purpose? }` / `RuleSteps` are **already in the
  public type surface** (`types-kernel-evaluation.ts:124`, re-exported through
  `types.ts`); no method returns them.
- **simplify** threads a complete `RuleSteps` chain end-to-end internally
  (`boxed-expression/simplify.ts`, seeded `{value, because:'initial'}`), then
  the public `simplify()` discards everything but `.at(-1)?.value`
  (`boxed-function.ts:1099` and siblings). Exposing it is cheap.
- **`because` is a debug string, not a label.** ~340 literals in three styles —
  arrow notation (`'(a*b)^n -> a^n * b^n'`), slugs (`'abs-negate'`), prose
  (`'partial fraction decomposition'`) — plus opaque `fungrim:<hash>` ids from
  the identities loader (rules have no description field; the Fungrim artifact
  descriptions attach to declarations, not rules).
- **solve has no trace and actively loses one:** `matchAnyRules`
  (`rules.ts:1434`) keeps only `r.value`, discarding the `because` the rules
  already produce; the algorithmic phases of `findUnivariateRoots`
  (apply-f⁻¹-to-both-sides, clear denominators, square radicals, polynomial
  formulas, harmonize, substitution, zero-product, validate-roots) are code
  branches, not rules, so they need hand-authored step labels. Most
  `UNIVARIATE_ROOTS` templates have no `id` at all.
- **D** (`symbolic/derivative.ts`) is a hard-coded recursive switch with
  clearly delineated branches (sum/product/quotient/power/chain rules) and no
  trace shape.
- **Granularity hazards:** the simplify driver injects bookkeeping steps
  (`'initial'`, `'simplified operands'`); cost-gate-rejected rewrites are
  (correctly) absent; cycle guards drop steps; and **canonicalization is
  invisible** — `x - 1` is `Add(x, -1)` before the first step is recorded.
- `ce.trace` is an unrelated eval-context call-stack getter — the name is
  taken.

## 3. API surface

One new method on `BoxedExpression` (mirrors how `simplify`/`solve` are
surfaced), returning a structured, JSON-able explanation:

```ts
expr.explain(operation?: 'simplify' | 'solve' | 'D', options?): Explanation

type Explanation = {
  operation: 'simplify' | 'solve' | 'D';
  initial: BoxedExpression;        // canonical form of the receiver = step 0
  result: BoxedExpression;         // same value the plain method returns
  steps: ExplainStep[];
};

type ExplainStep = {
  value: BoxedExpression;   // expression (or equation, for solve) after the step
  id: string;               // stable machine id, e.g. 'power-of-product',
                            //   'solve.apply-inverse', 'derivative.product-rule',
                            //   'fungrim:0010f3'
  description: string;      // default English, e.g. 'Apply (ab)ⁿ = aⁿbⁿ'
  purpose?: RulePurpose;    // existing cost-gate tag, passed through
};
```

- **`operation` defaults to `'simplify'`.** `'solve'` takes the unknown via
  `options.variable` (same inference rules as `solve()`); `'D'` takes
  `options.variable` (required).
- **`initial` vs the receiver:** `initial` is not an input — it is the
  *canonical form* of the expression `explain()` was called on, echoed back
  as the chain's step 0. It differs from the receiver exactly when
  boxing/canonicalization already rewrote it (`x - 1` → `Add(x, -1)`, §4);
  the steps chain from `initial`, and including it makes the `Explanation`
  self-contained for serialization and display (start → steps → result
  without a reference back to the receiver).
- **Contract with the plain methods:** `explain('simplify').result` is
  `isSame`-equal to `simplify()`; `explain('solve').result` to the solution
  set `solve()` returns; `explain('D')` to the derivative. The explain path
  runs the same engine code — it must never compute a *different* answer.
- `Explanation` and `ExplainStep` serialize naturally: `value` via `.json` /
  `.latex`, the rest are plain strings. No new boxed class.
- The existing `RuleStep`/`RuleSteps` types stay as the internal/rule-author
  surface (rule `id` still lands in steps); `ExplainStep` is the curated
  public layer on top.
- **Method, not option:** a `simplify({steps: true})` flag would change the
  return type on a flag — rejected. `explain()` leaves the hot paths
  untouched (zero cost when not called).

## 4. Step curation

The raw trace is a debug artifact; the public steps are curated:

- **Filter bookkeeping:** drop `'initial'` (it becomes `input`),
  `'simplified operands'` and other driver-internal markers; drop steps whose
  `value` `isSame` the previous step (defensive).
- **Verbosity:** `options.verbosity: 'default' | 'all'` — `'all'` returns the
  raw uncurated chain (rule authors, debugging); `'default'` applies the
  filters. No attempt at semantic coalescing in v1 (merging operand-descent
  chains into one step is a quality follow-up once real traces are visible in
  the product).
- **Canonicalization is documented as out of frame:** `input` is the
  *canonical* form and steps start there. Reconstructing boxing-time rewrites
  (`Subtract`→`Add`, ordering, numeric folding) as steps would require
  instrumenting the canonicalizer — deliberately out of scope; revisit only if
  educator feedback demands it (§8 Q4).

### Labeling layer

A new module `symbolic/explain-labels.ts`:

```ts
registerStepLabels({ 'power-of-product': 'Apply (ab)ⁿ = aⁿ·bⁿ', … })
labelFor(because: string): { id: string; description: string }
```

- **Seeded curation, graceful fallback.** Seed the registry with the ~60–80
  most-fired rule ids (measure by running the simplify/solve test corpora with
  a counting hook — the `onMatch` seam already exists). Unregistered ids fall
  back to a prettifier: arrow-style `because` strings are already readable
  (`'a^m / a^n -> a^{m-n}'` → description as-is), slugs get de-hyphenated,
  `fungrim:*` ids get `'Apply identity fungrim:<id>'` until the artifact
  grows per-rule descriptions (follow-up in the Fungrim pipeline, not v1).
- **Stability rule:** once shipped, an id in the registry is frozen (renames
  keep an alias). The `id` is the localization key for consumers; the
  engine ships English only.
- Rule authors get documentation (patterns-and-rules guide) that `id` is now
  user-facing when the rule fires under `explain`.

## 5. Coverage phases

**Phase 1 — simplify (M).** Plumb the existing trace out: an internal
`simplifyWithSteps` entry the public `simplify()` and `explain('simplify')`
share (the trace array already exists; `simplify()` keeps discarding it).
Curation + labeling layer + serialization + docs. Also fix the two label-loss
points that cost nothing: give the sparse `UNIVARIATE_ROOTS` templates ids,
and make `matchAnyRules` return steps to callers that want them (behind a new
signature or sibling function — no behavior change for existing callers).

**Phase 2 — solve (M/L).** Instrument `findUnivariateRoots` with hand-authored
phase steps (`solve.apply-inverse`, `solve.clear-denominators`,
`solve.square-both-sides`, `solve.factor-zero-product`,
`solve.substitute` (with the substitution shown), `solve.quadratic-formula`,
`solve.validate-roots` (with rejected candidates listed), …). Step values are
**equations** — each step's `value` is the transformed equation (or the root
set at the end), so the student reads `2x+1=5` → `2x=4` → `x=2`. Threading: a
`steps?` accumulator parameter through the solve internals, mirroring
simplify's pattern; rule-template matches contribute their (newly-added) ids.
Multi-root branches (zero-product, ±√) fork the narrative — v1 represents a
branch as one step whose value is the set/list of sub-equations, not a step
tree (§8 Q5).

**Phase 3 — D (M, independent of Phase 2).** Instrument the
`differentiate()` switch: each branch emits its textbook step
(`derivative.sum-rule`, `derivative.product-rule`, `derivative.chain-rule`,
`derivative.power-rule`, table lookups as `derivative.known-derivative`).
Because differentiation is recursive, steps are emitted in traversal order
with the *whole-expression* state after each sub-derivative resolves — the
standard textbook presentation. The P1-deferred differentiation perf work
(ROADMAP) is untouched: instrumentation is behind `explain` only.

Phases 2 and 3 are independent; either can land second.

## 6. Exactness / behavior invariants

- `explain` never changes results: it reuses the same code paths with an
  accumulator; all curation is post-processing on a copy.
- Zero overhead when unused: no step allocation on the plain
  `simplify()`/`solve()`/`D` paths beyond what exists today (simplify already
  builds its array; solve/D accumulators are `undefined` unless explaining).
- Deadline/step-cap guards behave identically; if a cap truncates, the
  explanation carries the steps up to truncation (and the result still
  matches the plain call).

## 7. Testing

- **Contract battery:** for a corpus of expressions (reuse simplify/solve/
  derivatives test inputs), `explain(op).result` matches the plain method,
  every consecutive step pair differs (`!isSame`), and each step `value` is
  mathematically equal to its predecessor where the operation preserves
  equality (simplify: `isEqual` spot-checks; solve: roots of step k+1 ⊇ roots
  retained at k, validated at the end; D: no invariant — states are partial).
- **Label coverage:** running the corpus, ≥ 90% of fired steps in
  `'default'` verbosity resolve to a registered description (not the
  fallback); the counting harness that measures this is kept as an opt-in
  test so label debt is visible.
- **Curation:** no `'initial'`/bookkeeping ids in `'default'` output;
  `'all'` returns a superset.
- **Golden explanations:** ~10 hand-checked textbook cases snapshot-tested
  end-to-end (e.g. `(x²-1)/(x-1)` simplify; `2x+1=5`, `x²=4`, `√(x+1)=x-1`
  (extraneous-root rejection shown) solve; product+chain-rule derivative).
- **Serialization:** `Explanation` → JSON → stable; LaTeX of each step value
  round-trips.

## 8. Open questions (for review)

1. **API shape** — single `expr.explain(operation?, options?)` method as
   specced. The alternative is per-operation methods
   (`simplifySteps()`/`solveSteps()`/`dSteps()`). Single method OK?

[*] Approved.

2. **Naming** — `explain` (the roadmap's word; `ce.trace` is taken by the
   call-stack getter, `steps` is generic). Confirm `explain`?

[*] Confirmed.

3. **Labeling scope for v1** — seed ~60–80 curated English descriptions,
   prettifier fallback for the rest, ids frozen once shipped, localization is
   the consumer's (keyed on `id`). OK, or should the engine carry a full
   label set for every rule before shipping (materially more work, mostly
   long-tail rules)?

[*]  OK

4. **Canonicalization out of frame** — steps start at the canonical form and
   the doc says so plainly. Accept for v1? (Reconstructing `x-1 → Add(x,-1)`
   style rewrites as steps means instrumenting boxing — a separate, large
   design.)

[*] Accepted.

5. **Solve branching** — v1 renders a branch (zero-product, ±√) as a single
   step whose value lists the sub-equations, rather than a tree of parallel
   step chains. Accept for v1, with a step-tree as the possible v2 if the
   product wants tabbed/parallel display?

[*] Accepted.

6. **Phase order after Phase 1** — solve (roadmap order, flagship educator
   value, M/L) or D (cheaper, very teachable, M) first?

[*] Accepted.

_(Recorded as: the recommendation stands — roadmap order, solve = Phase 2,
D = Phase 3, as in the §9 table.)_

## 9. Phasing and effort

| Phase | Content | Effort |
| --- | --- | --- |
| 1 | Expose simplify trace + curation + labeling layer + `UNIVARIATE_ROOTS` ids + step-keeping `matchAnyRules` + docs | M |
| 2 | Solve instrumentation (equation-state steps, phase labels, branch handling) | M/L |
| 3 | D instrumentation (branch labels, traversal-order states) | M |

Phase 1 alone is shippable and immediately useful (simplify explanations +
the debugging surface); 2 and 3 build on its labeling/curation layer.
