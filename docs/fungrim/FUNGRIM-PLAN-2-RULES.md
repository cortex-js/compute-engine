# Implementation Plan — Fungrim Track 2: CE Rule Mechanics (Feature A: Operator-Indexed Rule Dispatch + Cost Policy; Feature D: Public Solve-Rules API)

**Scope:** Implements docs/fungrim/FUNGRIM.md §4 Feature A (operator-indexed rule dispatch + cost policy / purpose tags) and Feature D (`ce.solveRules` extension API) in `/Users/arno/dev/compute-engine`. Goal: the engine can host ~1,500 externally-loaded Fungrim rules without `simplify()`/`replace()` becoming unusable, and `solve()` can absorb new equation templates without source edits.

**Completion gate for every milestone:** `npm run typecheck` (this also enforces a zero circular-dependency budget via madge and bans explicit `any` in `types-*.ts` / `global-types.ts` — both constrain the design below) plus the targeted jest suites listed per milestone, run as:

```
npx jest --config ./config/jest.config.cjs --reporters default -- <test-path>
```

**No git commit/push steps are part of this plan.**

---

## 1. Current-State Findings (verified, with file:line)

### Rule storage and dispatch
- `BoxedRuleSet` is `{ rules: ReadonlyArray<BoxedRule> }` (`src/compute-engine/types-kernel-evaluation.ts:187-189`). `BoxedRule` (`:167-184`) has `match: undefined | Expr` (undefined ⇒ functional rule), `replace`, `condition`, `useVariations`, `id`.
- `replace()` (`src/compute-engine/boxed-expression/rules.ts:929-980`) is a fixed-point loop: per iteration it linearly scans **every** rule in declaration order via `applyRule`; when a rule fires, `expr` is updated **mid-scan** and remaining rules are tried against the *new* expression. Loop detection via `steps.some(x => x.value.isSame(result.value))`; `once` and `iterationLimit` options.
- `matchAnyRules()` (`rules.ts:987-1003`) linearly scans all rules collecting every distinct result — used by `solve` (`solve.ts:1208,1231,1246,1379`) and `antiderivative.ts:2433`.
- `applyRule` (`rules.ts:785-919`): per-call recomputes `match.canonical` for a wildcard-loss check (`:800-807`); handles `options.recursive` by self-recursing into operands (`:811-836`); effective `useVariations = rule.useVariations ?? options?.useVariations ?? false` (`:838`).

### Cross-head matching (critical for index correctness)
`match.ts` can match a pattern whose head differs from the expression's operator:
- **Always active** (independent of `useVariations`), in `matchOnce` (`match.ts:142-236`):
  - pattern head `Divide` matches rational **number** literals and `Multiply(Rational(1,n), …)` expressions;
  - pattern head `Power` matches `Divide(1, x)` and `Root(x, n)` expressions;
  - pattern head starting with `_` (wildcard operator) matches any function (`:238-244`).
- **Only with `useVariations`** (`matchVariations`, `match.ts:330-437`): pattern heads `Negate`, `Add`, `Subtract`, `Multiply`, `Divide`, `Square`, `Exp`, `Power` can match expressions of *other* heads (e.g. `x` matches pattern `Add(0, x)`); all other pattern heads return `null` — i.e. **non-arithmetic heads are safely indexable even under variations**.
- Symbol/number/string patterns and functional rules have no head at all.

### simplify() pipeline
- `simplify()` (`simplify.ts:81-185`) fetches `ce.getRuleSet('standard-simplification')` (cached boxing of `ce.simplificationRules`) and iterates `simplifyExpression` to a fixed point.
- The **1.3× cost gate** is `isCheaper()` (`simplify.ts:187-209`, threshold at `:206`). `simplifyNonCommutativeFunction` (`:389-476`) discards a rule result unless cheaper **or** its `because` string matches a hard-coded whitelist (`:415-461`: power-combination ids, `ln(`/`log_` prefixes, `root(-` prefix, `|` prefix, one exact divide id, `factor common factorial`, conditional `expand`). This whitelist is the thing the purpose-tag design replaces/augments.
- The standard rule set (`symbolic/simplify-rules.ts`, `SIMPLIFY_RULES` at `:121`, ~900 lines) is **dominated by functional rules** with `if (x.operator !== 'X') return undefined` bailouts (~19+ top-level closures delegating to `simplifyTrig`, `simplifyPower`, etc.), only 4 object `match:` rules, plus LaTeX string rules. Consequence: most built-in rules will land in the index's "always-try" bucket unless given a dispatch hint (see §2.1.4).

### Engine plumbing
- `ce.simplificationRules` getter/setter (`index.ts:1022-1030`) backed by `SimplificationRuleStore` (`engine-simplification-rules.ts` — a generic `Rule[]` holder with length-based mutation detection), instance at `index.ts:291`.
- `ce.getRuleSet()` (`index.ts:1630-1657`): `'standard-simplification'` has mutation-detection + cache invalidation; `'solve-univariate'` and `'harmonization'` box the module constants `UNIVARIATE_ROOTS` (`solve.ts:59`) / `HARMONIZATION_RULES` (`solve.ts:1282`) **once, permanently cached**, no extension API.
- `findUnivariateRoots` (`solve.ts:1149-1278`) and `harmonize` (`solve.ts:1376-1380`) already route through `ce.getRuleSet(...)` — Feature D needs **no changes in solve.ts**. Solve rules use the `_x` unknown convention and are validated post-hoc by `validateRoots` (`solve.ts:1382-1410`), which conveniently filters bad user-supplied templates.
- Cache store: `EngineCacheStore` (`engine-cache.ts`), invalidation by name; `ce._cache` at `index.ts:1385`.
- Public type surface: `IComputeEngine.simplificationRules` at `types-engine.ts:181`; `getRuleSet` ids at `:322-324`. Public tests for the existing API pattern: `test/compute-engine/simplify-rules.test.ts` (the model for solveRules tests).

### REVIEW.md parallel work (overlap constraints)
Parallel fixes target: `compare.ts` (A1, A9, A16), `abstract-boxed-expression.ts` (A3), `simplify-rules.ts` + `simplify-sum/product.ts` (E7, perf-cache items), `simplify.ts:410` (A15), `relational-operator.ts` (B13). This plan therefore:
- **Never edits** `compare.ts`, `abstract-boxed-expression.ts`, or `simplify-rules.ts` (the built-in whitelist→purpose-tag migration that *would* touch `simplify-rules.ts` is explicitly deferred to a final optional milestone, sequenced after E7 lands).
- Touches `simplify.ts` only in M3 (gate region `:415-471`), adjacent to but disjoint from the A15 fix at `:410`; M3 is sequenced last among code milestones and should rebase trivially.
- Notes a behavioral dependency: REVIEW **A3** (`isLess`/`isGreater` returning `undefined` instead of definitive `false`) feeds the rule-condition predicates in `rules.ts` `CONDITIONS` (`:163-231`) and user condition functions. `checkConditions` requires `!== true` so *firing* decisions mostly survive, but regression baselines captured in M0 must be **re-captured if A3 lands mid-track** (or the corpus restricted to assumption-free expressions, see M0).

---

## 2. Design

### 2.1 Feature A — Operator-indexed rule dispatch

**Decision: keep `BoxedRuleSet` public type unchanged; build the index as an internal side table** (a `WeakMap` keyed on the `rules` array identity, in a new internal module). Rationale:
- `BoxedRuleSet` object literals are constructed directly by users (`{ rules: [...] }` is the documented shape) and returned by cached `getRuleSet()`; an optional internal field would leak into the public `.d.ts` surface and complicate the no-`any` typecheck gate.
- The expensive, repeated consumers (`simplify()`, `solve()`) always go through the **engine-cached** boxed sets, so a `WeakMap` keyed on the stable `rules` array gives one index build per cache generation. Ad-hoc `expr.replace(rules)` calls rebuild per call — acceptable (O(n) build), and skipped entirely below a size threshold.
- Engine cache invalidation (`_cacheStore.invalidate`) produces a *fresh array* from `boxRules`, so the `WeakMap` entry naturally falls away — no new invalidation plumbing.

#### 2.1.1 New module `src/compute-engine/boxed-expression/rule-index.ts` (internal)

```ts
import type { BoxedRule, Expression } from '../global-types';

/** A rule paired with its position in the original rule array. */
type OrdinalRule = { rule: BoxedRule; ordinal: number };

interface RuleIndex {
  /** Rules whose match pattern has a literal, head-faithful operator. */
  byHead: ReadonlyMap<string, ReadonlyArray<OrdinalRule>>;
  /** Functional rules, non-function patterns, wildcard-headed patterns,
   *  and (in the variations index) variant-capable arithmetic heads. */
  alwaysTry: ReadonlyArray<OrdinalRule>;
  count: number; // rules.length at build time, staleness guard
}

/** Pattern heads that matchVariations() can match across heads (match.ts:330-437). */
const VARIANT_CAPABLE: ReadonlySet<string>; // Negate, Add, Subtract, Multiply, Divide, Square, Exp, Power

/** Cross-head special cases in matchOnce() that are ALWAYS active (match.ts:142-236):
 *  expression operator -> additional pattern-head buckets that must be consulted. */
const HEAD_COMPAT: Readonly<Record<string, ReadonlyArray<string>>> = {
  Multiply: ['Divide'],   // Multiply(1/n, x) matches Divide patterns
  Divide:   ['Power'],    // Divide(1, x) matches Power patterns
  Root:     ['Power'],    // Root(x, n) matches Power patterns
};
// Plus: number literals (rationals) must consult the 'Divide' bucket.

/** Get (build + memoize) the index for a boxed rule array.
 *  `variations` selects the classification used when the *call-level*
 *  options.useVariations is true (rule-level useVariations is folded in
 *  at build time for both). Below `minSize` (default 8) returns undefined
 *  and callers fall back to the linear scan. */
export function getRuleIndex(
  rules: ReadonlyArray<BoxedRule>,
  variations: boolean
): RuleIndex | undefined;

/** Candidate rules for `expr`, in original declaration order, with
 *  ordinal > `fromOrdinal`. Implemented as an ordinal-merge of
 *  byHead[expr.operator] ∪ HEAD_COMPAT buckets ∪ alwaysTry. */
export function candidateRules(
  index: RuleIndex,
  expr: Expression,
  fromOrdinal: number
): Iterable<OrdinalRule>;
```

**Classification rules** (at index build, per rule):
- `rule.match === undefined` (functional rule) → `alwaysTry`, **unless** the rule carries the new `operators` dispatch hint (§2.1.4), in which case it is added to each hinted head bucket.
- `match` is not a function expression (symbol/number literal pattern) → `alwaysTry` (rare; symbol patterns also reach `matchVariations` at `match.ts:121-128`).
- `match.operator` starts with `_` (wildcard head) → `alwaysTry`.
- Effective-variations rule (`rule.useVariations === true`, or building the `variations: true` index and `rule.useVariations !== false`) **and** `match.operator ∈ VARIANT_CAPABLE` → `alwaysTry`. Heads outside `VARIANT_CAPABLE` are indexable even under variations (verified: `matchVariations` returns `null` for them).
- Otherwise → `byHead[match.operator]`.

**Two indexes per rule array** (plain / variations) are built lazily and memoized together: `WeakMap<ReadonlyArray<BoxedRule>, { plain?: RuleIndex; variations?: RuleIndex }>`. The `count` field guards against in-place mutation of the array (rebuild if `rules.length !== count`).

#### 2.1.2 Integration in `rules.ts`

`replace()` (`rules.ts:929-980`) — preserve semantics *exactly*:
- If `options.recursive` is true → **bypass the index** (unchanged linear scan). Rationale: with `recursive`, `applyRule` must visit operands of any head, so top-level head dispatch is unsound. `simplify()` calls with `recursive: false`; `expr.replace()` default is non-recursive — the hot paths keep the index.
- Otherwise, per fixed-point pass: iterate `candidateRules(index, expr, lastOrdinal)`. The ordinal-merge reproduces declaration order. **When a rule fires and `expr`'s operator changes mid-pass** (the original loop keeps scanning the remaining rules against the new expression), re-seed: continue with `candidateRules(index, newExpr, currentOrdinal)` so exactly the rules a linear scan would still have visited — those with ordinal greater than the firing rule's — are considered, now filtered against the new head. This is the one subtle piece; it gets dedicated unit tests (M2).
- `once`, `iterationLimit`, loop detection, error swallowing (`:973-974`): untouched — only the rule-enumeration source changes.

`matchAnyRules()` (`rules.ts:987-1003`): `expr` never changes during the scan, so a single `candidateRules(index, expr, -1)` pass suffices; result order (and thus dedup behavior) is preserved by ordinal-merge. The `variations` index is selected when `options?.useVariations` is true (solve passes `useVariations: true`).

Optional micro-fix folded in (cheap, index-adjacent): hoist the per-call `match.canonical` wildcard-loss check (`applyRule:800-807`) into `boxRule` as a precomputed `canonicalMatchLosesWildcards` flag on the boxed rule (internal field, not in the public type — or recomputed per index build). This is one of REVIEW's "rule-scan performance items"; keep it as a separate commit-sized step inside M2 so it can be dropped if the parallel track claims it.

#### 2.1.3 Expected behavior, quantified
- **Standard set (~60 entries today, mostly functional with operator bailouts):** nearly all rules classify as `alwaysTry` until hinted (§2.1.4), so candidates/node ≈ today's rule count. Requirement is *transparency*: identical results, ≤ a few % overhead from index build (one-time per engine) and merge iteration. With `operators` hints later applied to built-ins (deferred milestone M6), expect a 10–30% `simplify()` win since pattern/string rules and hinted functional rules skip non-matching heads.
- **+1,500 corpus rules across ~150 heads (Fungrim Phase 1):** corpus rules are object pattern rules with literal heads → `byHead` buckets average ~10 rules. Candidates/node ≈ |alwaysTry| (~35–60 built-ins) + ~10–20 (head + compat buckets), versus ~1,560 today → **~25–40× fewer `applyRule` calls per node per pass**. Acceptance target (M4 benchmark): `simplify()` median time with +1,500 inert indexed rules ≤ 1.5× the standard-set-only time; without the index the same benchmark is expected to blow past 10× (recorded in M0 as the motivating baseline).

#### 2.1.4 `operators` dispatch hint (small Rule-type addition)
To let functional rules (and the Fungrim functional-dispatcher shim) participate in indexing, add to the **object** rule form in `types-kernel-evaluation.ts` (`Rule`, `:145-164`) and `BoxedRule` (`:167-184`):

```ts
/** Dispatch hint: this rule can only ever apply to expressions whose
 *  operator is one of these. Used to index the rule; semantics are
 *  unchanged (the rule is simply never tried on other operators). */
operators?: ReadonlyArray<string>;
```

A bare-function rule cannot carry the hint; the object form `{ replace: fn, operators: ['Sin','Cos'] }` (match omitted) can — `boxRule` (`rules.ts:594-743`) already supports `match === undefined` with a `replace` function. This is also exactly the hook docs/fungrim/FUNGRIM.md's "single functional dispatcher rule" shim needs (one object rule per corpus, hinted with the corpus's head list, doing its own Map lookup) — making the shim and the first-class index converge.

### 2.2 Feature A (part 2) — Cost policy / purpose tags

**Decision: per-rule `purpose` tag with a per-ruleset default at boxing time; the simplify() gate exempts `'transform'`-tagged steps; `'expand'`-tagged rules are excluded from simplify()'s scan but fully usable via `expr.replace()`. Default behavior for existing users is bit-for-bit unchanged** (untagged rules behave exactly as today; the hard-coded `because`-string whitelist in `simplify.ts:415-461` is *kept* during this track and only migrated in the deferred M6).

Type changes (`types-kernel-evaluation.ts`):

```ts
/** @category Rules */
export type RulePurpose = 'simplify' | 'transform' | 'expand';
// 'simplify':  result must pass the cost gate (default; today's behavior)
// 'transform': mathematically-preferred rewrite; exempt from the cost gate
// 'expand':    growth-by-design (series, argument expansion); skipped by
//              simplify(), reachable via expr.replace() / future expand APIs

// Rule (object form) and BoxedRule both gain:
purpose?: RulePurpose;

// RuleStep gains (additive, backward compatible):
purpose?: RulePurpose;   // stamped by applyRule from the firing rule
```

Plumbing:
- `boxRules(ce, rs, options)` and `ce.rules(rules, options)` (`index.ts:1615-1625`, `types-engine.ts:312-320`) accept `options.purpose?: RulePurpose` as the **default** applied to any rule in the set that doesn't carry its own tag — this is the "per-ruleset policy" from docs/fungrim/FUNGRIM.md §4.A, so a corpus loader can tag a whole file in one call.
- `applyRule` stamps `purpose` onto the returned `RuleStep`; `replace()` propagates it (it already returns the steps untouched).
- `simplify.ts`:
  - In `simplify()` where the rule set is resolved (`:163-165`), filter `purpose === 'expand'` rules out of the working set (cheap: do it once when boxing/caching, i.e. in `getRuleSet('standard-simplification')`'s build closure plus on the per-call `options.rules` path).
  - In `simplifyNonCommutativeFunction` (`:462-472`), add `|| result.at(-1)!.purpose === 'transform'` to the acceptance disjunction. The existing `because`-string whitelist stays.

Fungrim usage: curated "simplifying direction" identities load untagged (cost-gated, safe); argument-transformation identities load with `purpose: 'transform'`; series/representation entries load with `purpose: 'expand'` and are reachable only by explicit `replace()` (and the future Phase-4 representations API).

### 2.3 Feature D — `ce.solveRules` / `ce.harmonizationRules`

**Decision: two engine properties mirroring `ce.simplificationRules` exactly**, both backed by the existing `SimplificationRuleStore` class (it is already rule-agnostic: `Rule[]` + length-based staleness marker):

```ts
// types-engine.ts (IComputeEngine), next to simplificationRules (:181)

/** The rules used by `solve()` to find roots of univariate expressions.
 *  Each rule matches a normalized equation `f(_x) = 0` — the unknown is
 *  the wildcard `_x` — and `replace` produces a root expression.
 *  Conditions should reject matches where other wildcards capture `_x`.
 *  Candidate roots are validated against the original equation, so an
 *  over-eager template degrades to a no-op rather than a wrong answer.
 *  Initialized to the built-in root-finding rules; `push()` to extend,
 *  assign to replace. */
solveRules: Rule[];

/** The rules used by `solve()` to transform an equation into equivalent,
 *  easier-to-solve forms before root-finding (e.g. `ln f(x) → f(x) - 1`).
 *  Same conventions and extension pattern as `solveRules`. */
harmonizationRules: Rule[];
```

Engine implementation (`index.ts`):

```ts
/** @internal Backing state for solveRules */
private _solveRules = new SimplificationRuleStore([...UNIVARIATE_ROOTS]);
/** @internal Backing state for harmonizationRules */
private _harmonizationRules = new SimplificationRuleStore([...HARMONIZATION_RULES]);

get solveRules(): Rule[] { return this._solveRules.rules; }
set solveRules(rules: Rule[]) {
  this._solveRules.rules = rules;
  this._cacheStore.invalidate('univariate-roots-rules');
}
// harmonizationRules: identical, invalidating 'harmonization-rules'
```

`getRuleSet()` (`index.ts:1646-1654`) changes from boxing the module constants to boxing the stores, with the same push-mutation detection already used by the simplification branch (`:1633-1644`):

```ts
if (id === 'solve-univariate') {
  if (this._solveRules.hasMutatedSinceLastCache())
    this._cacheStore.invalidate('univariate-roots-rules');
  const result = this._cache('univariate-roots-rules', () =>
    boxRules(this, this._solveRules.rules));   // NOTE: no canonical:true — preserve current boxing
  this._solveRules.markCached();
  return result;
}
// 'harmonization': same shape
```

Key properties of this design:
- **Zero changes to `solve.ts`** — `findUnivariateRoots` (`solve.ts:1193`) and `harmonize` (`:1378`) already consume `ce.getRuleSet(...)`. `UNIVARIATE_ROOTS`/`HARMONIZATION_RULES` remain exported as the initial values. (Avoids both churn and a new import cycle; the `index.ts → solve.ts` import already exists at `index.ts:83-84`.)
- **Interleaving:** built-ins first, user `push()`ed rules after. For `solveRules` order is largely immaterial — `matchAnyRules` collects *all* matches and `validateRoots` filters/dedups — so "append" is sufficient; `unshift()`/full-replacement cover priority needs. For `harmonizationRules`, all matching transforms are collected too. Document this; no priority field needed (recorded as an open question).
- **Known limitation inherited from `simplificationRules`:** the store's mutation detection is length-based (`engine-simplification-rules.ts:25-27`), so same-length in-place element replacement isn't detected. Same caveat, same docs note.
- Rename of `SimplificationRuleStore` → `RuleStore` (file `engine-rule-store.ts`) is *optional polish*; if done, keep it inside M1 (only `index.ts` + the one file are touched). Default: don't rename, just reuse.

---

## 3. Milestones (dependency order)

### M0 — Baseline capture & safety net (no `src/` changes)
**Purpose:** regression-proof Feature A; quantify the problem the index solves.

Files (new, test-only):
- `test/compute-engine/rule-dispatch-regression.test.ts` — a corpus of ~150 expressions (drawn from `simplify.test.ts` inputs, Wester problems, trig/log/abs/power families, assumption-free to stay independent of REVIEW A3) run through `.simplify()` and `.solve()`, snapshotted (`toMatchSnapshot()`). This snapshot is the pre/post-index equivalence oracle.
- `test/compute-engine/benchmarks/rule-dispatch.benchmark.test.ts` (scaffold) — following `performance.test.ts`'s machine-independent pattern (measure against an in-process CE baseline, assert ratios not absolute ms): (a) time `simplify()` over the corpus with the standard set; (b) time it again after `ce.simplificationRules.push(...1500 synthetic inert pattern rules)` (heads `F0…F149` declared via `ce.declare`, patterns like `['F<k>', '_a', <literal>]`). Record both ratios with generous initial budgets (this milestone documents the *problem*: expect ~10×+ degradation pre-index).

Acceptance: snapshots committed-ready; benchmark runs and prints baseline numbers; `npm run typecheck` clean (trivially).
Note: if REVIEW A3/A1 land while this track is in flight, re-record the M0 snapshot once and note it; the corpus's assumption-free design minimizes drift.

### M1 — Feature D: `ce.solveRules` / `ce.harmonizationRules`
*(Sequenced first among src milestones: smallest, fully independent of the index, zero overlap with REVIEW files, immediately unblocks Fungrim Phase 2.)*

Files:
- `src/compute-engine/index.ts` — two store instances (near `:291`), two getter/setter pairs (near `:1022`), `getRuleSet` branches reworked (`:1646-1654`) per §2.3.
- `src/compute-engine/types-engine.ts` — `solveRules` / `harmonizationRules` on `IComputeEngine` (near `:181`); no change to `getRuleSet` id union.
- `src/compute-engine/engine-simplification-rules.ts` — doc-comment only (class now backs three stores), or optional rename (see §2.3).
- `test/compute-engine/solve-rules.test.ts` (new) — mirrors `simplify-rules.test.ts` structure: built-ins present by default; default `solve()` unaffected; `push()` of a new root template (e.g. `tan(x) + b = 0 → x = arctan(−b)`: `{ match: ['Add', ['Tan','_x'], '__b'], replace: ['Arctan', ['Negate','__b']], condition: sub => !sub.__b.has('_x') }`) makes a previously-unsolvable equation solvable; full replacement via setter; cache invalidation on push *after* a prior `solve()` (exercises `hasMutatedSinceLastCache`); harmonization push (e.g. `ln(f(x))` variant) feeding into root finding; per-engine isolation (two `ComputeEngine` instances don't share pushed rules); a deliberately wrong template whose extraneous roots are filtered by `validateRoots`.

Acceptance:
- All of `solve.test.ts` passes unchanged; new `solve-rules.test.ts` passes.
- `npm run typecheck` clean (watch the no-new-cycles budget: no new imports into `solve.ts`, none needed).

### M2 — Feature A core: `rule-index.ts` + indexed `replace()` / `matchAnyRules()`
Files:
- `src/compute-engine/boxed-expression/rule-index.ts` (new) — per §2.1.1. Imports only `global-types` + `type-guards` (no cycle risk).
- `src/compute-engine/boxed-expression/rules.ts` — `replace()` and `matchAnyRules()` consume the index per §2.1.2 (recursive bypass, size threshold, mid-pass re-seed); optional hoist of the wildcard-loss precheck.
- `src/compute-engine/types-kernel-evaluation.ts` — add `operators?: ReadonlyArray<string>` to the `Rule` object form and `BoxedRule` (§2.1.4); `boxRule` in `rules.ts` carries it through.
- `test/compute-engine/rule-index.test.ts` (new) — unit tests:
  - classification: functional → alwaysTry; hinted functional → buckets; wildcard-head → alwaysTry; `useVariations` × `VARIANT_CAPABLE` head → alwaysTry in variations index but bucketed in plain; `Ln`-headed rule with `useVariations` stays bucketed.
  - **cross-head compat:** a `['Divide','_a','_b']` pattern rule fires on a rational literal and on `Multiply(1/2, x)`; a `Power` pattern fires on `Root` and `Divide(1,x)` expressions — through the indexed path.
  - **ordering semantics:** rule sets where declaration order determines the result (two rules matching the same head; a generic rule between two bucketed ones); **mid-pass operator change** (rule k rewrites `Sin`→`Cos`; a `Cos` rule with ordinal > k must fire in the same pass, one with ordinal < k must not until the next pass) — assert step-for-step (`because` sequence) equality with a hand-computed linear-scan trace.
  - `once`, `iterationLimit`, loop-detection parity; `recursive: true` bypass still applies rules to subexpressions.
  - **differential invariant test:** for the standard simplification set and the synthetic 1,500-rule set, over the M0 corpus: every rule *excluded* by `candidateRules` returns `null` from `applyRule` (the index never skips a rule that would have fired).

Acceptance:
- M0 regression snapshot **byte-identical** (no `--ci` snapshot updates needed).
- Full targeted suites green: `rules.test.ts`, `simplify.test.ts`, `simplify-noskip.test.ts`, `simplify-rules.test.ts`, `solve.test.ts`, `patterns.test.ts`/match suites, `benchmarks/wester.benchmark.test.ts`.
- Standard-set `simplify()` timing within ±5% of M0 baseline (no regression from index overhead).
- `npm run typecheck` clean (no new cycles, no `any` in the types file).

### M3 — Purpose tags / cost policy
Files:
- `src/compute-engine/types-kernel-evaluation.ts` — `RulePurpose`, `Rule.purpose`, `BoxedRule.purpose`, `RuleStep.purpose` (§2.2).
- `src/compute-engine/boxed-expression/rules.ts` — `boxRule`/`boxRules` accept and default `purpose`; `applyRule` stamps `purpose` on emitted steps.
- `src/compute-engine/index.ts` — `ce.rules()` signature gains `purpose` in options; `getRuleSet('standard-simplification')` build closure filters `purpose === 'expand'`.
- `src/compute-engine/types-engine.ts` — `rules()` option type updated.
- `src/compute-engine/boxed-expression/simplify.ts` — **only** the two §2.2 edits: filter `'expand'` on the per-call `options.rules` path (`:163-165`), and `|| purpose === 'transform'` in the acceptance condition (`:462-472`). Hard-coded whitelist untouched. ⚠ Coordinate with REVIEW A15 (`simplify.ts:410`): land whichever is ready first; the hunks don't overlap but are near — rebase, don't merge blindly.
- `test/compute-engine/rule-purpose.test.ts` (new):
  - untagged rule that grows the expression > 1.3× is still discarded (today's behavior);
  - same rule tagged `'transform'` is accepted by `simplify()`;
  - `'expand'` rule pushed to `ce.simplificationRules` is ignored by `simplify()` but fires via `expr.replace()`;
  - per-ruleset default: `ce.rules(ruleArray, { purpose: 'transform' })` tags untagged members; per-rule tag overrides set default;
  - all existing whitelist behaviors (`combined powers`, `ln(`-prefix, etc.) unchanged.

Acceptance: M0 snapshot still byte-identical; `simplify*` suites green; `npm run typecheck` clean.

### M4 — Scale benchmark & corpus-readiness validation
Files (test-only):
- Finish `test/compute-engine/benchmarks/rule-dispatch.benchmark.test.ts`: with the index in place, assert (a) standard-set simplify within 1.1× of M0 standard baseline; (b) **+1,500 synthetic indexed rules ≤ 1.5× standard baseline** (the headline Feature-A acceptance criterion); (c) `solve()` of a representative equation set with +200 synthetic solve templates pushed to `ce.solveRules` ≤ 2× baseline; (d) index build cost amortized (first vs. second `simplify()` call delta). Mark with generous budgets + `console.info` of measured ratios, following the tolerance style of `performance.test.ts` (CI variance).
- Extend the differential invariant test to the synthetic corpus + variations option matrix.

Acceptance: budgets met locally; numbers recorded in the test output; `npm run typecheck` clean. Caveat to note in the test header: REVIEW E7 (`.simplify()` inside rules) currently dominates some rule costs; absolute wins grow once E7 lands, ratios chosen to be robust either way.

### M5 — Documentation & public-surface polish
Files:
- Doc comments finalized on all new public surface (`solveRules`, `harmonizationRules`, `RulePurpose`, `operators` hint) — these flow into the generated `.d.ts` checked by `test/public-ts-declarations/main.ts`.
- `CHANGELOG.md` entries (additive API: `ce.solveRules`, `ce.harmonizationRules`, `Rule.purpose`, `Rule.operators`).
- docs/fungrim/FUNGRIM.md §4 A/D status notes can be updated by the parent effort (not this plan's file).

Acceptance: `npm run typecheck`; public-declarations test green; full test suite pass.

### M6 (deferred, explicitly sequenced after REVIEW E7 lands) — whitelist→tag migration & built-in hints
- Migrate the `because`-string whitelist (`simplify.ts:415-461`) to `purpose: 'transform'` tags on the corresponding built-in rules in `symbolic/simplify-rules.ts`, `simplify-log.ts`, etc., then delete the string checks (except the conditional-`expand` heuristic at `:435-461`, which is result-dependent and stays code).
- Add `operators` hints to built-in functional rules (convert bare functions to `{ replace, operators }` objects) for the 10–30% standard-set win.
- **Not part of this track's completion**; listed so the sequencing constraint (`simplify-rules.ts` is REVIEW-owned right now) is explicit.

---

## 4. Risks

1. **Index unsoundness via cross-head matching** (highest risk). The `HEAD_COMPAT` map and `VARIANT_CAPABLE` set must exactly mirror `match.ts` special cases (`:142-236`, `:330-437`). Mitigations: the differential invariant test (M2/M4) over large corpora; a comment block in `rule-index.ts` listing each special case with its `match.ts` line; conservative defaults (anything unclassifiable → `alwaysTry`).
2. **Mid-pass ordering divergence.** The re-seed-on-operator-change merge is the only behaviorally delicate code; covered by dedicated trace-equality tests. Fallback if a divergence is found late: restart the pass from ordinal 0 on operator change (still correct w.r.t. fixed point, slightly different step traces — would require snapshot re-record, so only as escape hatch).
3. **Parallel REVIEW edits.** `simplify.ts` (A15) and future `simplify-rules.ts` (E7) collisions — mitigated by milestone sequencing (M3 last among src-touching, M6 deferred), small disjoint hunks, and not touching `compare.ts`/`abstract-boxed-expression.ts` at all. A3 landing mid-track can shift rule-condition outcomes → M0 corpus is assumption-free; re-record snapshot if needed.
4. **WeakMap staleness on in-place mutation** of a boxed `rules` array (user-constructed `BoxedRuleSet`). Mitigated by the `count` guard + documented `ReadonlyArray` contract; engine-owned sets are rebuilt on invalidation.
5. **Typecheck gates:** zero-new-circular-deps (keep `rule-index.ts` leaf-like; Feature D adds no new imports to `solve.ts`) and no-`any`-in-types (all new public types fully typed).
6. **Benchmark flakiness in CI** — ratio-based budgets against in-process baselines (existing `performance.test.ts` pattern), wide margins, informational logging.
7. **`'expand'` filtering surprise**: a user who tags a rule `'expand'` and expects `simplify()` to use it. Mitigated by docs (the tag's contract *is* "not for simplify") and by untagged-default behavior being unchanged.

## 5. Open Questions

1. **API naming/shape for Feature D:** two flat properties (`ce.solveRules`, `ce.harmonizationRules`, proposed — symmetric with `simplificationRules`) vs. a single `ce.solveRules` namespace `{ roots: Rule[]; harmonization: Rule[] }`. docs/fungrim/FUNGRIM.md says "`ce.solveRules` (same push/replace pattern)"; the flat pair keeps the established pattern and trivial cache wiring. Needs a maintainer call before M1.
2. **Priority control for user solve/simplify rules:** is append + `unshift()` + full-replacement enough, or is a numeric `priority` field on `Rule` warranted? (Current evidence: `matchAnyRules` collects all matches, so ordering is rarely semantic for solve; recommend deferring.)
3. **Purpose taxonomy completeness:** is a fourth value (e.g. `'canonicalize'`/`'harmonize'`) needed for Fungrim Phase 4 representation lookup, or do `'expand'`+`replace()` cover it? Affects only the string-union, additive later.
4. **Index threshold and tuning:** default min-size 8 before indexing kicks in — validate with M4 measurements; expose nothing publicly for now?
5. **`RuleStep.purpose` public vs. internal:** stamping on the public `RuleStep` is the simple route (additive field); if the surface is unwanted, an internal `WeakMap<RuleStep, RulePurpose>` side channel works at the cost of ugliness. Plan assumes public-additive.
6. **General solution families** (`x = arctan(c) + πn`) from FUNGRIM Feature D's "optional follow-on" (`solve.ts` returns principal solutions only): out of scope here; confirm it stays out of Track 2.

### Critical Files for Implementation
- `src/compute-engine/boxed-expression/rules.ts`
- `src/compute-engine/index.ts`
- `src/compute-engine/types-kernel-evaluation.ts`
- `src/compute-engine/boxed-expression/simplify.ts`
- `src/compute-engine/boxed-expression/match.ts` (read-only reference for HEAD_COMPAT/VARIANT_CAPABLE fidelity; plus `src/compute-engine/types-engine.ts` for the public surface)
