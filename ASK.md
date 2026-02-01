# `ask()` / `verify()` plan

## Background

Today, `ce.ask(pattern)` is _not_ “ask if this is true”. It is an **assumptions
DB query**:

- It boxes `pattern` (non-canonical) and structurally matches it against entries
  in `ce.context.assumptions`.
- It returns `BoxedSubstitution[]` (pattern match bindings), not a truth value.

That makes issue #225 unsurprising: declarations (symbol types/values) and many
derived facts are not stored in `context.assumptions`, and inequality
assumptions are stored in normalized forms that won’t match “user-shaped”
patterns.

SymPy’s `ask()` is closer to “can I prove/disprove this predicate?” and returns
**`True/False/None`** (unknown). We can offer the same UX by making
`ce.verify()` the SymPy-like API, while keeping `ce.ask()` as an explicit
assumptions query tool.

## Goals

- Implement `ce.verify(query): boolean | undefined`
  - Returns `true` if the predicate is provably true with current knowledge.
  - Returns `false` if it is provably false with current knowledge.
  - Returns `undefined` if it cannot be proven either way.
- Expand the set of predicates that can be proven/disproven using:
  - explicit assumptions (`ce.assume(...)`),
  - symbol declarations/definitions (`ce.declare(...)`, inferred types, assigned
    values),
  - existing predicate evaluation rules (e.g. inequality evaluation already uses
    assumptions).
- Keep `ce.ask(pattern)` as an “assumptions DB matcher”.

## Non-goals (for now)

- Returning witnesses/substitutions/bounds from `verify()` (SymPy `ask()`
  doesn’t do this).
- Full SAT-style cross-predicate inference like SymPy’s known-facts system.
- Proving general quantified statements over infinite domains (only
  finite-domain evaluation when available).

## Proposed public semantics

### `verify()`

Signature:

- `verify(query: BoxedExpression): boolean | undefined`
  - (Optional follow-up) accept a LaTeX string like `assume()` does.

Behavior:

1. Box/parse the input similarly to `assume()` (i.e., accept `LatexString` too,
   if we add it).
2. Try to evaluate `query` to a boolean:
   - If it evaluates to `True` → `true`
   - If it evaluates to `False` → `false`
   - Otherwise → `undefined`
3. Support boolean connectives (`Not`, `And`, `Or`) by evaluating operands
   recursively when needed.

Examples:

- `ce.verify(['Greater', 'x', 0])` after `ce.assume(['Greater', 'x', 4])` →
  `true`
- `ce.verify(['Less', 'x', 0])` after `ce.assume(['Greater', 'x', 4])` → `false`
- `ce.verify(['Greater', 'x', 0])` with no facts about `x` → `undefined`

### `ask()`

Keep behavior: `ask(pattern)` returns a list of structural matches against
`context.assumptions`.

Documentation update:

- Encourage “truth queries” to use `verify()`.
- Encourage “show me matching stored assumptions” to use `ask()`.

## Predicate support roadmap

This is ordered by “high value, low complexity” first.

### Phase 1: Make `verify()` useful immediately

1. Implement `verify()` in `src/compute-engine/index.ts` using evaluation:
   - Evaluate `query` (with a “predicate evaluation” helper).
   - Map `True`/`False` to `boolean`, else `undefined`.
2. Add tests (new file `test/compute-engine/verify.test.ts` or extend
   `test/compute-engine/assumptions.test.ts`):
   - inequality truthiness via assumptions (already covered by evaluate() tests,
     but add explicit `verify()` coverage)
   - equality truthiness via assumed equalities
   - boolean connectives over known/unknown components (e.g.
     `And(True, unknown)` → `undefined`)

### Phase 2: Type/domain predicates (`Element`, `NotElement`)

Problem: `Element(value, collection)` currently only works when `collection` is
a _collection/set_ with a `contains()` implementation. It does **not** work for
type-like RHS such as `'finite_real'` or `'any'`.

Plan:

- Extend `Element.evaluate` / `NotElement.evaluate` (in
  `src/compute-engine/library/sets.ts`) to recognize a “type RHS”:
  - If `collection.contains(value)` is `undefined` and `collection` looks like a
    type token, interpret it as a `BoxedType`.
  - Proposed rule: if `collection.symbol` corresponds to a known type name (e.g.
    `any`, `number`, `real`, `finite_real`, …), then:
    - `Element(value, collectionType)` is `true` when
      `value.type.matches(collectionType)` is `true`
    - `false` when it is definitively incompatible
    - `undefined` otherwise
- Add tests:
  - `ce.declare('x', 'finite_real')` then
    `ce.verify(['Element', 'x', 'finite_real'])` → `true`
  - `ce.declare('x', 'real')` then `ce.verify(['Element', 'x', 'finite_real'])`
    → `undefined` (can’t prove “finite”)
  - `ce.declare('x', 'integer')` then `ce.verify(['Element', 'x', 'real'])` →
    `true`

Notes:

- Also consider aligning domains with existing set symbols (`RealNumbers`,
  `Integers`, etc.) and treating them as the preferred spelling in docs, while
  still supporting type spellings for ergonomics.

### Phase 3: More “SymPy-style” predicate surface area

SymPy exposes a large predicate set via `Q.<predicate>` (see
`sympy/assumptions/ask.py` around `AssumptionKeys`).

We don’t need the same surface API (`Q.*`) to get comparable utility; we need
comparable _facts_.

Suggested mapping to existing Compute Engine capabilities:

- Set/type predicates:
  - `real`, `complex`, `imaginary`, `rational`, `integer`, `finite`, `infinite`
  - Implement via `Element(expr, <TypeOrSet>)` or via `expr.type.matches(...)` /
    `expr.isFinite`.
- Order/sign predicates:
  - `positive`, `negative`, `zero`, `nonzero`, `nonpositive`, `nonnegative`
  - Implement via `expr.isPositive/isNegative/isNonNegative/isNonPositive`, or
    by rewriting to comparisons to `0`.
- Parity predicates:
  - `even`, `odd` (already present as `expr.isEven`/`expr.isOdd` for many
    expression kinds).

Concrete work items:

- Ensure evaluation for basic comparisons (`Equal`, `NotEqual`, `Less`,
  `LessEqual`, `Greater`, `GreaterEqual`) continues to consult:
  - symbol values (from equality assumptions / declarations),
  - inequality assumptions (already in place),
  - simplification rules.
- Consider adding lightweight predicate operators (optional):
  - e.g. `Positive(x)` as sugar for `Greater(x, 0)` (only if it improves
    readability and doesn’t bloat the library surface).

### Phase 4: Quantifiers (finite domains only)

Compute Engine already supports finite-domain evaluation patterns for
quantifiers in some contexts.

Plan:

- Ensure `verify(ForAll(...))` and `verify(Exists(...))` return
  `true/false/undefined`:
  - `true/false` only when the quantifier can be evaluated over a finite domain
    (e.g., `Element(x, Set(...))`).
  - `undefined` otherwise (avoid pretending to prove over infinite domains).

## Documentation updates

- Update the API docs for `ask()` to clearly state it queries
  `context.assumptions` and returns substitutions.
- Document `verify()` as the truth-query API with `boolean | undefined`.
- Add a short migration note:
  - “If you were using `ask()` to check truthiness, use `verify()` instead.”
