# Cortex `match` — structural pattern matching (design)

**Status:** draft 2026-07-12; not yet implemented. **Scope:** (1) surface
grammar and lowering for a `match` expression in Cortex (the reserved word
held since v0), (2) a new engine head `Match` with structural, total,
first-match semantics, (3) a **classification ladder** so trivial matches
(constant dispatch, fixed-shape destructuring) cost O(1)–O(arms) instead of
invoking the generic pattern matcher, both in interpreted evaluation and in
`compile()` output.

Prior art consulted: Haskell `case`, Rust `match`, TC39 pattern-matching
proposal (2024 draft), Mathematica `Switch`/`Replace`. Engine machinery
reused: the wildcard matcher (`boxed-expression/match.ts`,
`pattern-utils.ts`), the rule system, `Function` closure canonicalization,
and the `Which` compile path (`compilation/base-compiler.ts`).

## 1. Positioning: the complement of `Which`

B15 (see `2026-07-12-conditional-values-design.md`) fixed the split between
the two *semantic* conditional heads. `match` completes the picture with a
*structural* one:

| Construct | Case split on… | When undecidable… | Binds names? |
|---|---|---|---|
| `if` / `Which` | boolean conditions (semantic) | stays inert/symbolic | no |
| `When` | one guard (semantic) | stays inert | no |
| `match` | expression **structure** | n/a — always decides | **yes** |

`match` is `isSame`-like: it inspects the canonical structure of the subject
and always selects an arm. `match x { 0 => a, _ => b }` with `x` an unbound
symbol selects the `_` arm — `x` is structurally not `0`, even though it
*could* be zero semantically. This is deliberate and is how the rule system
already behaves; users who want semantic case-splitting use `if`/`Which`.
Making `match` semantics-aware (inert when an earlier arm "might" match)
is explicitly rejected: it would make every match on a symbolic subject
inert and would duplicate `Which`.

The distinctive payoff vs. JS/Haskell: Cortex subjects are expression trees,
so `match` doubles as symbolic destructuring — dispatch on an operator,
extract coefficients (`a + b*i => …`). It is surface syntax for the rule
system, which Cortex programs currently cannot reach at all.

## 2. Surface grammar

```cortex
match subject {
  0 => "zero"
  n: integer if n > 0 => "positive integer"
  [first, ...rest] => first
  {x -> px, y -> py} => px + py
  a + b if a > 0 => a
  _ => "other"
}
```

- **Keyword-led block.** `match expr {` opens a statement-block-style `{ }`
  (keyword-led, so no collision with the set/dictionary collection grammar,
  same rule as `if`/`while`).
- **Arms** are `pattern [if guard] => body`, separated like block statements
  (newline or `;`). `body` is an expression; multi-statement bodies use
  `do { … }`, consistent with lambda bodies.
- **Arrow token `=>`.** Verified free: not in the operator table
  (`operators.ts`); `characters.ts` maps U+21D0 to the digraph but nothing
  parses it. `->` is unavailable (KeyValuePair + return-type annotation),
  and reusing it would collide with dictionary *patterns* inside pattern
  position. `=>` matches Rust/TC39/C# convention.
- **Guards** use the existing `if` keyword in the arm head. Unambiguous:
  an arm-leading `if` never starts a pattern (patterns are expressions and
  `if` is a keyword-led form, excluded from pattern position).

### Pattern grammar — "parse an expression, then patternize"

A pattern is parsed by the ordinary expression grammar, then transformed by
a `patternize` pass. This keeps the parser small and makes *algebraic*
patterns come for free. Patternize rules, applied top-down:

1. **`_`** → anonymous wildcard (engine `_`).
2. **Bare identifier `n`** → binding, lowered to the engine wildcard `_n`.
   Haskell rule: *in pattern position, every plain identifier binds* —
   including ones that shadow constants (`e`, `i`, `Pi`). There is no
   Elixir-style pin operator in v1; to match against a computed value or a
   constant, use a literal or a guard (`x if x == Pi => …`).
3. **Literals** (numbers, strings, booleans) → themselves (match structurally).
4. **`...name` / `...`** inside a list/tuple pattern → engine `___name` /
   `___` (optional-sequence wildcard). At most one per list pattern in v1
   (keeps tier-2 compilation linear; the generic matcher supports more, but
   multiple rests fall to tier 3). No token conflict: Cortex has no `...`
   operator today (`.` is reserved as composition; the LaTeX parser's
   ellipsis work does not apply to Cortex).
5. **List/tuple patterns** `[p₁, …]`, `(p₁, …)` → `List`/`Tuple` with
   patternized elements.
6. **Dictionary patterns** `{k -> p, …}` → keys are *literal* (not
   patternized); values are patternized. Matches if the subject dictionary
   has (at least) those keys with matching values — open by default, like
   TC39 object patterns.
7. **Type-annotated binding** `n: integer` → typed wildcard; lowered to
   `_n` plus an implicit conjoined guard on the type (or the matcher's
   native typed-wildcard support where available). Reuses the annotation
   syntax already parsed on function parameters.
8. **Any other function/operator expression** `f(p…)`, `a + b` → operator
   kept verbatim, operands patternized. The engine matcher handles
   commutativity/associativity for `Add`/`Multiply` patterns.

Consequences worth documenting for users: `match p { (x, y) => … }` binds
`x`,`y` positionally; a name repeated in one pattern (`(x, x)`) means the
engine's non-linear-pattern behavior (both occurrences must capture the same
value) — the matcher already enforces this for rules, keep it.

## 3. Lowering and the `Match` head

```json
["Match", subject,
  ["MatchArm", pattern, body],
  ["MatchArm", pattern, guard, body]]
```

- **Why not `Rule`?** An arm *is* morally a rule (pattern, optional
  condition, body), but reusing the `Rule` head would drag in the rule
  system's boxing pitfalls (clean-scope boxing, LaTeX-string coercion — see
  `rules-pitfalls`). A dedicated 2-or-3-operand `MatchArm` head keeps the
  arms inert data with `holdAll`, canonicalized only enough to patternize.
  Internally the evaluate handler converts arms to the same
  `BoxedRule`-shaped structure `replace()` consumes.
- **Why not desugar to `Which`?** `Which` takes boolean conditions and
  cannot express bindings; also `Which` stays inert on undecidable
  conditions, which is exactly the semantics `match` must *not* have.
- **Definition** lives in `library/control-structures.ts` next to
  `If`/`Which`/`When`: `holdAll` on arms, `holdFirst` semantics for the
  subject are **not** used — the subject is evaluated once, then matched
  canonically (matching happens on the canonical/evaluated subject; that is
  what makes constant dispatch well-defined).
- **Scoping & laziness.** Each arm body must not evaluate until selected,
  and captures need real lexical binding (someone will bind `e` or `i`).
  Lower each arm body through the existing `Function` closure machinery:
  `MatchArm(pat, body)` canonicalizes its body as
  `Function(body, …captureNames)`, reusing the shadowed-parameter-stack
  work from function-literal canonicalization (constant-named parameters).
  Selection then applies the closure to the captured values. This buys
  correct shadowing, correct late binding, and hold-until-selected in one
  move; direct wildcard substitution into an unscoped body is rejected
  (substitution ignores shadowing and re-canonicalizes in the wrong scope).
- **No-match** → an error value (`["Error", "'match-no-arm'", subject]`),
  consistent with "errors are ordinary values". Not `Nothing` (silently
  swallowing a non-exhaustive match hides bugs), not a throw. Static
  exhaustiveness checking is a later nicety, not v1.
- **Serialization.** Cortex round-trips to the surface syntax
  (`serialize-cortex.ts` gets a `Match` case). LaTeX serialization uses the
  generic function form `\operatorname{Match}(…)`; the `cases` environment
  stays reserved for `Which` (semantic piecewise) — patterns with bindings
  have no honest `cases` rendering.

## 4. Optimization: the classification ladder

The point of this section: **a `match` whose arms are trivial must never pay
for the generic matcher**, per-evaluation or in compiled code. Classification
happens **once, at canonicalization** of the `Match` expression — arms are
static syntax, so the tier is a property of the canonical form. Cache the
classification (and any dispatch table) on the canonical boxed expression
via a module-level `WeakMap` keyed on the `Match` instance; boxed
expressions are immutable, so no invalidation is needed.

Tiers are per-*expression*, decided by the weakest arm… almost: classify
**per-arm**, then emit a *prefix* of fast arms with a fallback into the
general path for the tail. A single `a + b` arm at the end must not degrade
the ten constant arms before it.

### Tier 0 — constant dispatch

**Condition:** arm pattern is a literal from the *dispatch-safe* set —
machine/big **integer**, **string**, **boolean**, or a **plain symbol used
as a constant is excluded** (a bare identifier is a binding, so symbols
never appear as constant patterns; only literals do). No guard, no bindings.

**Interpreted:** build a `Map<string, armIndex>` once at canonicalization
(key = canonical literal key: integers via exact decimal string — bigint and
machine 1 both key as `"1"` — strings tagged to avoid colliding with numeric
spellings, e.g. `s:…`/`n:…` prefixes). Evaluation: one key computation on
the evaluated subject + one Map hit. First-match-wins is preserved by
set-if-absent when building (duplicate constants keep the earlier arm).

**Why the key set is restricted:** the key function must reproduce the
matcher's equivalence classes exactly. Integers are safe (all
representations of 5 are `isSame`). Floats, rationals, and radicals are
*not* keyed in v1 — `0.5` (inexact) vs `1/2` (exact) are distinct
structurally per the exactness contract, and encoding those classes in a
string key is easy to get subtly wrong. Non-integer numeric literals fall
to tier 1, which uses `isSame` directly and is therefore correct by
construction. If profiling ever shows a real workload matching on many
float constants, revisit with an `expr`-hash-based key — not before.

### Tier 1 — literal chain

**Condition:** pattern is any literal constant (incl. floats/rationals) or
a binding-free pattern, optionally with a guard.

**Interpreted:** chained `subject.isSame(constant)` (+ guard evaluation) —
no matcher invocation, no substitution allocation. This is essentially what
`Which` does, minus inertness.

### Tier 2 — fixed-shape destructuring

**Condition:** list/tuple/dictionary patterns whose elements are bindings,
`_`, literals, or (recursively) fixed shapes; at most one `...rest`; guards
allowed. No operator patterns, no non-linear repeated names, no sequence
wildcards other than the single rest.

**Interpreted:** compile the pattern once (at canonicalization) into a flat
extraction plan: arity check (`nops === k`, or `nops >= k` with a rest),
indexed operand reads, literal `isSame` checks at fixed positions, then one
closure application with the extracted operands. No backtracking, no
generic matcher.

### Tier 3 — general

Everything else — operator/algebraic patterns (`a + b`), commutative
matching, multiple or inner sequence wildcards, non-linear patterns — goes
through `expr.match()` per arm, exactly `replace(rules, {once: true})`
semantics. This is the semantic reference implementation; tiers 0–2 are
required to be observationally identical to it (property test: random
subjects × arm sets, assert tier-N result === tier-3 result).

## 5. Impact on `compile()`

Ground truth today: `If`/`Which`/`When` compile to chained ternaries in
`base-compiler.ts`; targets are expression-oriented; the established policy
is **fail-closed** (better to refuse than emit wrong code).

- **Tier 0/1, JS target:** for small N, the same chained-ternary emission as
  `Which` with `===` comparisons (in compiled code the subject is already a
  JS number — float equality is the compiled meaning of `==` everywhere
  else, so this is consistent, if approximate vs. interpreted exactness;
  same seam `Which` already has). For larger N over integer/string
  constants, emit an arrow-IIFE `switch`:
  `((s) => { switch (s) { case 1: return …; default: return … } })(subj)`
  — JS engines jump-table dense integer switches; we get the dispatch for
  free rather than re-deriving it. Threshold (~8 arms) is an implementation
  detail; below it, ternaries are simpler and JIT-equivalent.
- **Tier 0/1, GPU targets (GLSL/WGSL):** chained ternaries via the existing
  `Which`-style emission, `==` on the subject compiled once into a local.
  GLSL ES 3.0 has `switch` on `int` but statement position is awkward in
  the expression-oriented emitter; ternary chains are branchless-friendly
  on GPU anyway. Strings: not compilable (no string type in targets) —
  fail closed.
- **Tier 2, JS target:** arrow-IIFE with destructuring — the natural
  emission is close to the surface semantics:
  `((xs) => xs.length === 2 ? ((a, b) => body)(xs[0], xs[1]) : next)(subj)`.
  Requires list-valued locals, which the JS target already has for
  `List`/indexing support (`At`/`Length` compile — Tycho round 2).
- **Tier 2, GPU targets:** fail closed in v1. (Fixed-arity tuple patterns
  over vec types could inline bindings by textual substitution later;
  demand-gated.)
- **Tier 3:** fail closed on **all** targets — the generic matcher cannot
  run in compiled code. The error message should name the offending arm
  ("pattern `a + b` is not compilable; rewrite with destructuring or
  guards") so users on the Tycho compile path can act on it.
- **Interval targets:** tier 0/1 conditions on an interval subject have the
  same discontinuity hazard as compiled `Which` (an interval spanning two
  arms' constants). Follow the existing interval-`Which` treatment
  (per-branch evaluation/`singular` behavior); no new machinery, but add
  interval tests. If interval-`Which` support turns out to be absent,
  interval targets fail closed on `Match` in v1 rather than inventing the
  treatment here.
- **`canEvaluate`/compile-probe:** `Match` must report compilability
  consistently with the above so the fail-closed probe (Tycho post-0.73.0
  work) classifies it correctly before codegen.

Note the ordering consequence: mixed-tier arm lists compile as a fast
prefix + fail-closed only if a *reachable* tail arm is tier 3. A tier-3 arm
that is provably shadowed (earlier `_` arm) is dead and ignorable.

## 6. Implementation plan

1. **Engine head** (`library/control-structures.ts` + a new
   `boxed-expression/match-dispatch.ts` for patternize/classify/plans):
   `Match`/`MatchArm` definitions, tier-3 reference semantics via the
   existing matcher, closure-based arm bodies, no-match error value.
   Tests: semantics, shadowing (`e`/`i` bindings), non-linear patterns,
   symbolic subjects (structural totality), first-match order.
2. **Classification ladder** in the same module: patternize→tier per arm,
   WeakMap-cached dispatch plans, property test tiers ≡ tier 3.
3. **Cortex grammar** (`parser.ts`, `operators.ts` untouched;
   `serialize-cortex.ts`, `formatter.ts`): `match` keyword form, arm
   parsing, patternize integration, round-trip tests in
   `test/cortex/`. Unreserve nothing — `match` is already reserved.
4. **Compile targets** (`base-compiler.ts` + per-target): tier 0/1
   ternary/switch emission, tier-2 JS IIFE, fail-closed elsewhere; tests
   alongside the existing compile suites.
5. **Docs**: `src/cortex/docs/control-flow.md` section + move `match` out
   of "Future Directions" in `cortex.md`.

Each phase lands independently; 1–2 are pure engine (usable from MathJSON
before the Cortex syntax exists), which also gives Tycho a `Match` head
early if wanted.

## 7. Open questions / v2 deferrals

- **Or-patterns** (`0 | 1 => …`): deferred; `|` is unclaimed in Cortex but
  the interaction with bindings (both alternatives must bind the same
  names) is real design work. Guards cover the v1 need.
- **Pin/interpolation patterns** (match against a runtime value): deferred;
  guards cover it (`x if x == limit`). Revisit only if guard noise shows up
  in real programs.
- **Closed dictionary patterns** (exact-keys match): open by default per
  TC39; a closed form (`{k -> v,}`? explicit `...` absence?) is deferred.
- **Exhaustiveness/redundancy diagnostics**: static check that a `_`-less
  match over an enum-like domain is total, and dead-arm warnings. Nice
  lint-tier work once the type system tightens.
- **Semantic match mode**: an opt-in variant that consults assumptions
  (`match` staying inert like `Which`) is rejected for the core construct;
  if demand appears, it should be a different spelling, not a mode flag.
