# Cortex `match` — structural pattern matching (design)

**Status:** draft 2026-07-12, revised same day (pin patterns promoted to v1,
`MatchCase` naming, binding-free or-alternatives promoted to v1); not yet
implemented. **Scope:** (1) surface grammar and
lowering for a `match` expression in Cortex (the reserved word held since
v0), (2) a new engine head `Match` with structural, total, first-match
semantics, (3) a **classification ladder** so trivial matches (constant
dispatch, fixed-shape destructuring) cost O(1)–O(cases) instead of invoking
the generic pattern matcher, both in interpreted evaluation and in
`compile()` output.

Prior art consulted: Haskell `case`, Rust `match`, TC39 pattern-matching
proposal (2024 draft), Elixir pin operator, Mathematica `Switch`/`Replace`.
Engine machinery reused: the wildcard matcher (`boxed-expression/match.ts`,
`pattern-utils.ts`), the rule system, `Function` closure canonicalization,
and the `Which` compile path (`compilation/base-compiler.ts`).

Terminology: a `pattern => body` entry is a **case** (`MatchCase`), per the
Haskell/Scala/Java tradition; Rust and C# say "arm", TC39 says "clause" —
"case" is the most broadly understood.

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
and always selects a case. `match x { 0 => a, _ => b }` with `x` an unbound
symbol selects the `_` case — `x` is structurally not `0`, even though it
*could* be zero semantically. This is deliberate and is how the rule system
already behaves; users who want semantic case-splitting use `if`/`Which`.
Making `match` semantics-aware (inert when an earlier case "might" match)
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
  1 | 2 | == Pi => "small, or pi"
  == Infinity => "unbounded"
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
- **Cases** are `pattern [if guard] => body`, separated like block
  statements (newline or `;`). `body` is an expression; multi-statement
  bodies use `do { … }`, consistent with lambda bodies.
- **Arrow token `=>`.** Verified free: not in the operator table
  (`operators.ts`); `characters.ts` maps U+21D0 to the digraph but nothing
  parses it. `->` is unavailable (KeyValuePair + return-type annotation),
  and reusing it would collide with dictionary *patterns* inside pattern
  position. `=>` matches Rust/TC39/C# convention.
- **Guards** use the existing `if` keyword in the case head. Unambiguous:
  a case-leading `if` never starts a pattern (patterns are expressions and
  `if` is a keyword-led form, excluded from pattern position).
- **Or-alternatives** `p₁ | p₂ | …` — v1 supports the *restricted* form:
  `|` at the **top level of a case pattern only**, and every alternative
  must be **binding-free** (literals, pins, `_`-free of named bindings —
  binding-free shapes like `[0, _] | [_, 0]` are fine). The case matches if
  any alternative matches; a guard applies after whichever alternative
  matched. A named binding inside an alternative is a diagnostic
  ("or-pattern alternatives cannot bind names"). This covers the common
  case (a set of constants — C `switch` fallthrough, Rust `1 | 2 | 3`)
  while excluding everything that makes general or-patterns hard: binding
  reconciliation across alternatives, matcher backtracking, and
  cross-product expansion of nested alternatives. The restriction is a
  forward-compatible ratchet — nested and binding alternatives can be
  added later without breaking v1 programs. Token: bare `|` is unclaimed
  (only `|->`, `|>`, `||` use the character) and is consumed by the *case
  parser*, not the expression grammar, so it exists only in pattern
  position. Lexer note: keep maximal munch from forming a bogus `|-` token
  in `1 |-2 => …` (the formatter always spaces `|`, but the lexer must
  still get it right).

### Pattern grammar — "parse an expression, then patternize"

A pattern is parsed by the ordinary expression grammar, then transformed by
a `patternize` pass. This keeps the parser small and makes *algebraic*
patterns come for free. Patternize rules, applied top-down:

1. **`_`** → anonymous wildcard (engine `_`).
2. **Bare identifier `n`** → binding, lowered to the engine wildcard `_n`.
   Haskell rule: *in pattern position, every plain identifier binds* —
   including ones that shadow constants (`e`, `i`, `Pi`). Bind-vs-pin is
   decided by syntax alone, never by scope lookup: auto-pinning identifiers
   that name constants (the Rust/Scala model) is rejected because Cortex
   capitalization is a convention with no enforced semantics, and because
   the engine's constant namespace grows with each release — an identifier
   that binds today must not silently become an equality test when a future
   CE version declares a constant of the same name. Consistent with
   parameter lists, which already shadow constants
   (shadowed-parameter-stack).
3. **Pin pattern `== expr`** → match against the *value* of `expr`
   (Elixir's `^`, spelled with the existing equality token; a leading `==`
   is unambiguous in pattern position). `expr` is **not** patternized — it
   is an ordinary expression, evaluated at match time in the enclosing
   lexical scope, and compared to the subject with `isSame`. This is the
   idiomatic way to match symbolic constants (`== Pi`, `== Infinity`) and
   runtime values (`== limit`); it is in v1 precisely because matching on
   constants is a core CAS use case and the guard workaround
   (`x if x == Pi`) is noisy and defeats constant dispatch (§4).
4. **Literals** (numbers, strings, booleans) → themselves (match
   structurally).
5. **`...name` / `...`** inside a list/tuple pattern → engine `___name` /
   `___` (optional-sequence wildcard). At most one per list pattern in v1
   (keeps tier-2 compilation linear; the generic matcher supports more, but
   multiple rests fall to tier 3). No token conflict: Cortex has no `...`
   operator today (`.` is reserved as composition; the LaTeX parser's
   ellipsis work does not apply to Cortex).
6. **List/tuple patterns** `[p₁, …]`, `(p₁, …)` → `List`/`Tuple` with
   patternized elements.
7. **Dictionary patterns** `{k -> p, …}` → keys are *literal* (not
   patternized); values are patternized. Matches if the subject dictionary
   has (at least) those keys with matching values — open by default, like
   TC39 object patterns.
8. **Type-annotated binding** `n: integer` → typed wildcard; lowered to
   `_n` plus an implicit conjoined guard on the type (or the matcher's
   native typed-wildcard support where available). Reuses the annotation
   syntax already parsed on function parameters.
9. **Any other function/operator expression** `f(p…)`, `a + b` → operator
   kept verbatim, operands patternized. The engine matcher handles
   commutativity/associativity for `Add`/`Multiply` patterns.

**Irrefutable-case diagnostic.** A bare-identifier (or `_`) pattern matches
anything, so a non-final irrefutable case makes every later case dead. This
is a static parse/canonicalization diagnostic, and it is the safety net for
the bind-vs-pin rule: a user writing `Pi => …` expecting to match π gets
"pattern `Pi` binds a new variable and matches anything; write `== Pi` to
match the constant π" instead of silently dead cases.

Consequences worth documenting for users: `match p { (x, y) => … }` binds
`x`,`y` positionally; a name repeated in one pattern (`(x, x)`) means the
engine's non-linear-pattern behavior (both occurrences must capture the same
value) — the matcher already enforces this for rules, keep it.

## 3. Lowering and the `Match` head

```json
["Match", subject,
  ["MatchCase", pattern, body],
  ["MatchCase", pattern, guard, body]]
```

Pin patterns lower without a dedicated head where the pinned expression is
a plain symbol or literal (the engine matcher already treats non-wildcard
subexpressions verbatim: `Pi` in a pattern only matches `Pi`). A pinned
*computed* expression lowers to `["Pin", expr]` inside the pattern; the
evaluate handler resolves all `Pin` nodes (evaluate in lexical scope, embed
the value) once per match evaluation, before case selection.

Or-alternatives lower to an `["Alternatives", p₁, p₂, …]` head as the
case's pattern — kept in the MathJSON (rather than desugared into duplicate
cases) so Cortex round-trips `1 | 2 | == Pi` faithfully. The evaluate and
classification layers expand it: a case with N alternatives behaves exactly
like N consecutive cases sharing one body closure (binding-free, so the
same closure serves all alternatives). The generic matcher needs no
`Alternatives` support — the tier-3 reference implementation performs the
same expansion into consecutive rules.

- **Why not `Rule`?** A case *is* morally a rule (pattern, optional
  condition, body), but reusing the `Rule` head would drag in the rule
  system's boxing pitfalls (clean-scope boxing, LaTeX-string coercion — see
  `rules-pitfalls`). A dedicated 2-or-3-operand `MatchCase` head keeps the
  cases inert data with `holdAll`, canonicalized only enough to patternize.
  (Naming: "case" over Rust's "arm" — see Terminology above.) Internally
  the evaluate handler converts cases to the same `BoxedRule`-shaped
  structure `replace()` consumes.
- **Why not desugar to `Which`?** `Which` takes boolean conditions and
  cannot express bindings; also `Which` stays inert on undecidable
  conditions, which is exactly the semantics `match` must *not* have.
- **Definition** lives in `library/control-structures.ts` next to
  `If`/`Which`/`When`: `holdAll` on cases, `holdFirst` semantics for the
  subject are **not** used — the subject is evaluated once, then matched
  canonically (matching happens on the canonical/evaluated subject; that is
  what makes constant dispatch well-defined).
- **Scoping & laziness.** Each case body must not evaluate until selected,
  and captures need real lexical binding (someone will bind `e` or `i`).
  Lower each case body through the existing `Function` closure machinery:
  `MatchCase(pat, body)` canonicalizes its body as
  `Function(body, …captureNames)`, reusing the shadowed-parameter-stack
  work from function-literal canonicalization (constant-named parameters).
  Selection then applies the closure to the captured values. This buys
  correct shadowing, correct late binding, and hold-until-selected in one
  move; direct wildcard substitution into an unscoped body is rejected
  (substitution ignores shadowing and re-canonicalizes in the wrong scope).
- **No-match** → an error value (`["Error", "'match-no-case'", subject]`),
  consistent with "errors are ordinary values". Not `Nothing` (silently
  swallowing a non-exhaustive match hides bugs), not a throw. Static
  exhaustiveness checking is a later nicety, not v1 (the irrefutable-case
  diagnostic in §2 *is* v1).
- **Serialization.** Cortex round-trips to the surface syntax
  (`serialize-cortex.ts` gets a `Match` case). LaTeX serialization uses the
  generic function form `\operatorname{Match}(…)`; the `cases` environment
  stays reserved for `Which` (semantic piecewise) — patterns with bindings
  have no honest `cases` rendering.

## 4. Optimization: the classification ladder

The point of this section: **a `match` whose cases are trivial must never
pay for the generic matcher**, per-evaluation or in compiled code.
Classification happens **once, at canonicalization** of the `Match`
expression — cases are static syntax, so the tier is a property of the
canonical form. Cache the classification (and any dispatch table) on the
canonical boxed expression via a module-level `WeakMap` keyed on the `Match`
instance; boxed expressions are immutable, so no invalidation is needed.

Tiers are per-*expression*, decided by the weakest case… almost: classify
**per-case**, then emit a *prefix* of fast cases with a fallback into the
general path for the tail. A single `a + b` case at the end must not degrade
the ten constant cases before it.

### Tier 0 — constant dispatch

**Condition:** case pattern is (a) a literal from the *dispatch-safe* set —
machine/big **integer**, **string**, or **boolean** — or (b) a **pin of a
plain constant symbol** (`== Pi`, `== Infinity`) or of a dispatch-safe
literal, resolvable at canonicalization (the pinned expression is a symbol
declared `isConstant`, or a literal). No guard, no bindings. Pins of
runtime variables are tier 1 (their value is unknown until match time).
An or-alternative case qualifies when *every* alternative individually
qualifies: `1 | 2 | == Pi` adds three Map keys, all pointing at the same
case index. Mixed alternatives (`0 | 0.5`) classify the whole case at the
weakest alternative's tier — no per-alternative splitting in v1 (simple,
and the fallback is still correct).

**Interpreted:** build a `Map<string, caseIndex>` once at canonicalization
(key = canonical literal key: integers via exact decimal string — bigint and
machine 1 both key as `"1"` — strings and symbol names tagged to avoid
cross-kind collisions, e.g. `n:…`/`s:…`/`sym:…` prefixes; symbols key by
name, which is exactly their `isSame` class). Evaluation: one key
computation on the evaluated subject + one Map hit. First-match-wins is
preserved by set-if-absent when building (duplicate constants keep the
earlier case).

**Why the key set is restricted:** the key function must reproduce the
matcher's equivalence classes exactly. Integers and symbols are safe (all
representations of 5 are `isSame`; symbols compare by name). Floats,
rationals, and radicals are *not* keyed in v1 — `0.5` (inexact) vs `1/2`
(exact) are distinct structurally per the exactness contract, and encoding
those classes in a string key is easy to get subtly wrong. Non-integer
numeric literals fall to tier 1, which uses `isSame` directly and is
therefore correct by construction. If profiling ever shows a real workload
matching on many float constants, revisit with an `expr`-hash-based key —
not before.

### Tier 1 — literal chain

**Condition:** pattern is any literal constant (incl. floats/rationals), a
pin of any expression (computed pins evaluate once per match, then compare),
or a binding-free pattern, optionally with a guard.

**Interpreted:** chained `subject.isSame(value)` (+ guard evaluation) —
no matcher invocation, no substitution allocation. This is essentially what
`Which` does, minus inertness.

### Tier 2 — fixed-shape destructuring

**Condition:** list/tuple/dictionary patterns whose elements are bindings,
`_`, literals, pins, or (recursively) fixed shapes; at most one `...rest`;
guards allowed. No operator patterns, no non-linear repeated names, no
sequence wildcards other than the single rest.

**Interpreted:** compile the pattern once (at canonicalization) into a flat
extraction plan: arity check (`nops === k`, or `nops >= k` with a rest),
indexed operand reads, literal/pin `isSame` checks at fixed positions, then
one closure application with the extracted operands. No backtracking, no
generic matcher.

### Tier 3 — general

Everything else — operator/algebraic patterns (`a + b`), commutative
matching, multiple or inner sequence wildcards, non-linear patterns — goes
through `expr.match()` per case, exactly `replace(rules, {once: true})`
semantics. This is the semantic reference implementation; tiers 0–2 are
required to be observationally identical to it (property test: random
subjects × case sets, assert tier-N result === tier-3 result).

## 5. Impact on `compile()`

Ground truth today: `If`/`Which`/`When` compile to chained ternaries in
`base-compiler.ts`; targets are expression-oriented; the established policy
is **fail-closed** (better to refuse than emit wrong code).

- **Tier 0/1, JS target:** for small N, the same chained-ternary emission as
  `Which` with `===` comparisons (in compiled code the subject is already a
  JS number — float equality is the compiled meaning of `==` everywhere
  else, so this is consistent, if approximate vs. interpreted exactness;
  same seam `Which` already has; a pinned `== Pi` compiles to comparison
  against the folded float constant). For larger N over integer/string
  constants, emit an arrow-IIFE `switch`:
  `((s) => { switch (s) { case 1: return …; default: return … } })(subj)`
  — JS engines jump-table dense integer switches; we get the dispatch for
  free rather than re-deriving it. Or-alternatives are literal `switch`
  fallthrough (`case 1: case 2: return …`), or a disjunction in ternary
  form (`(s === 1 || s === 2) ? … : …`) below the switch threshold and on
  GPU targets. Threshold (~8 cases) is an
  implementation detail; below it, ternaries are simpler and
  JIT-equivalent.
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
  run in compiled code. The error message should name the offending case
  ("pattern `a + b` is not compilable; rewrite with destructuring or
  guards") so users on the Tycho compile path can act on it.
- **Interval targets:** tier 0/1 conditions on an interval subject have the
  same discontinuity hazard as compiled `Which` (an interval spanning two
  cases' constants). Follow the existing interval-`Which` treatment
  (per-branch evaluation/`singular` behavior); no new machinery, but add
  interval tests. If interval-`Which` support turns out to be absent,
  interval targets fail closed on `Match` in v1 rather than inventing the
  treatment here.
- **`canEvaluate`/compile-probe:** `Match` must report compilability
  consistently with the above so the fail-closed probe (Tycho post-0.73.0
  work) classifies it correctly before codegen.

Note the ordering consequence: mixed-tier case lists compile as a fast
prefix + fail-closed only if a *reachable* tail case is tier 3. A tier-3
case that is provably shadowed (earlier `_` case) is dead and ignorable.

## 6. Implementation plan

1. **Engine head** (`library/control-structures.ts` + a new
   `boxed-expression/match-dispatch.ts` for patternize/classify/plans):
   `Match`/`MatchCase` definitions, `Pin` resolution, `Alternatives`
   expansion, tier-3 reference semantics via the existing matcher,
   closure-based case bodies, no-match error value. Tests: semantics,
   shadowing (`e`/`i` bindings), pins of constants and runtime values,
   or-alternatives (shared body, guard-after-alternative, first-match
   across duplicate keys), non-linear patterns, symbolic subjects
   (structural totality), first-match order.
2. **Classification ladder** in the same module: patternize→tier per case,
   WeakMap-cached dispatch plans, property test tiers ≡ tier 3.
3. **Cortex grammar** (`parser.ts`, `operators.ts` untouched;
   `serialize-cortex.ts`, `formatter.ts`): `match` keyword form, case
   parsing incl. `== expr` pins and top-level `|` alternatives (with the
   binding-free diagnostic and the `|-` lexer-munch guard), patternize
   integration, the irrefutable-case diagnostic, round-trip tests in
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

- **General or-patterns**: v1 ships the restricted form (§2 — top-level,
  binding-free). Deferred: *nested* alternatives (`(0 | 1, x)` —
  cross-product expansion or real matcher support) and *binding*
  alternatives (`[x, 0] | [0, x]` — OCaml-style same-names-same-types
  reconciliation). Both are compatible extensions of the v1 form.
- **Closed dictionary patterns** (exact-keys match): open by default per
  TC39; a closed form (`{k -> v,}`? explicit `...` absence?) is deferred.
- **Exhaustiveness/redundancy diagnostics** beyond the v1
  irrefutable-non-final-case check: static totality over enum-like domains,
  general dead-case warnings. Nice lint-tier work once the type system
  tightens.
- **Semantic match mode**: an opt-in variant that consults assumptions
  (`match` staying inert like `Which`) is rejected for the core construct;
  if demand appears, it should be a different spelling, not a mode flag.
