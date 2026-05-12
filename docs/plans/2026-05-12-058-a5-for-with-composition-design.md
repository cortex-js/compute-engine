# CE 0.58.0 — A5 `where`+`for` Composition Design

**Status:** Design (pending implementation plan)
**Bucket:** A5 (CE-P8) — the final 0.58.0 bucket
**Predecessors:** A1, A2, A3, A4, A6, C1 all shipped internally

## Goal

Confirm — and if necessary, fix — that the composition of CE's built-in
`\operatorname{where}` (let-binding, shipped in A4) and `\operatorname{for}`
(comprehension, shipped in CE-P0b) parsers produces a canonical AST in which
the let-bindings scope over **both** the body and the for-iterator's range
expression, regardless of surface order.

Closes A5 from CE 0.58.0. After A5 lands, the 0.58.0 bundle ships.

## Background

The original A5 ("for-comprehension filter clauses") was based on a misreading
of the Desmos corpus: GP assumed `\operatorname{with} cond` was a Haskell-style
guard. Corpus audit disproved that:

- `\operatorname{where}` appears zero times in the corpus.
- `\operatorname{with}` appears 50+ times and is uniformly a let-binding —
  never used with a condition.
- The corpus contains for-comprehensions composed with `with` let-bindings in
  **both surface orders**.

GP's revised A5 ask reduces to a composition verification: GP's
custom-dictionary `\operatorname{with}` entry (lowering to
`Block(Declare, Assign, …, body)` — same shape as CE's built-in `where`)
needs to compose correctly with `\operatorname{for}` such that bindings
scope over the iterator range, not just the body.

Because `with` (per A4) is not a CE built-in — consumers register it via
custom LaTeX dictionary — and because `with` and `where` lower to
structurally identical Block shapes, this design uses `where` as the proxy:
fix or verify the composition for `where`+`for` and the same behavior
applies to any custom `with` registration.

## Target canonical shape

For both surface orders, the parser should produce:

```
[Block,
  [Declare, "name"], [Assign, "name", <value>], ...,
  [Loop, <body>, [Element, "i", <range>]]]
```

`Block` is outermost; bindings reach the iterator range via the normal scope
chain.

### Two surface orders

**Order 1** — bindings before iter:

```latex
body \operatorname{where} a \coloneq v_1, b \coloneq v_2 \operatorname{for} i = R
```

**Order 2** — bindings after iter:

```latex
body \operatorname{for} i = R \operatorname{with} a \coloneq v_1
```

(GP's corpus uses `with` here; the structural test uses `where` as the
proxy.) Order 2 is the harder case: it requires the iterator range `R` —
parsed before `with` is seen — to retrieve `a` from a scope that didn't
exist at parse time. This works at evaluate time via the scope chain
provided that the resulting AST is `Block(Declare(a), Assign(a, v_1),
Loop(body, Element(i, R)))`.

## Empirical findings (verified 2026-05-12)

The verification phase ran the planned tests against the current parser and
revealed that **both surface orders fail**, for different parser-side reasons.
Order 2 was predicted to work; it doesn't. The asymmetric fix the original
design proposed is therefore replaced with a symmetric two-edit fix, both
local to `definitions-core.ts`:

1. **Order 1 fix (as designed)**: lookahead in `parseWhereExpression` to
   consume a trailing `\operatorname{for}` clause and emit the
   Block-outermost shape directly.
2. **Order 2 fix (new)**: extend `parseForComprehension`'s
   `bindingTerminator.condition` to stop at `\operatorname{where}` /
   `\operatorname{with}` so those keywords aren't pulled into the binding
   RHS. (The terminator's `minPrec: 21` allows precedence-21 operators
   through, and `where` is at exactly 21.)

Both fixes are <10 lines. The conceptual design — "produce
`Block(Declare, Assign, …, Loop(body, Element))` in both surface orders" —
is unchanged.

## Predicted current behavior (original, kept for context)

Precedences: `where` = 21, `for` = 19. Higher precedence binds tighter.

- **Order 1**: `where` binds tighter → runs first on body → produces
  `Block(Declare, Assign, …, body)`. Then `for` wraps the Block →
  `Loop(Block(decls, body), Element(i, R))`. Block is **inside** Loop's body.
  If `R` references `a`, the iter range cannot reach it.
- **Order 2**: `for` runs first on body → produces `Loop(body, Element(i, R))`.
  Then `where`/`with` runs on the Loop → `Block(Declare, Assign, …,
  Loop(body, Element(i, R)))`. Block is outermost. ✓ Bindings reach `R`
  via scope chain.

If this prediction holds, **only Order 1 needs a fix**. The empirical phase
must confirm this before code changes proceed.

## Components

### 1. Empirical verification (always runs)

New file: `test/compute-engine/a5-where-for-composition.test.ts`

Test set:

- **Order 1 parse shape** — snapshot the AST for
  `body \operatorname{where} bindings \operatorname{for} iter`.
- **Order 2 parse shape** — snapshot the AST for
  `body \operatorname{for} iter \operatorname{with} bindings` (substituting
  `where` for `with` since `with` is not a CE built-in).
- **Order 1 evaluation** — `i \operatorname{where} n \coloneq 3
  \operatorname{for} i = \operatorname{Range}(n)`. Expected `[1, 2, 3]` if
  composition is correct; failure surfaces the scope-reach gap concretely.
- **Order 2 evaluation** — analogous: body inside the Block, range
  referencing the binding.
- **Scope-leak regression** — outer-scope symbols with the same name as
  bindings are unchanged after a composed expression evaluates.

### 2. Conditional fix in `parseWhereExpression`

Location: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`
(near line 2741).

Logic (only added if Order 1 fails empirical verification):

1. Parse the comma-separated bindings as today (no change).
2. After the last binding, peek the next token.
3. If it is `\operatorname{for}` (or `\text{for}`): consume the for-clause
   using the existing `parseForComprehension` logic — shared helper
   preferred over inlined duplication — and emit
   `[Block, Declare, Assign, …, [Loop, lhs, Element(…)]]`.
4. If not: return the current `[Block, Declare, Assign, …, lhs]` shape
   unchanged. Existing `where`-only tests are unaffected.

No precedence changes. No changes to the for-parser or `Loop` /
`Block` evaluators. The fix is local to the where-parser.

### 3. Documentation

Add §5 to `docs/architecture/actions-and-randomness.md`:

- The canonical Block-outermost shape both surface orders produce.
- Worked example for each order, with a trace showing scope reach.
- Note that GP's custom-dictionary `\operatorname{with}` inherits this
  behavior automatically — its lowering produces the same Block shape, so
  the composition rule applies.
- Cross-reference to A4's `where` clause documentation in §4 of the same
  page.

### 4. Roadmap update

Add `## CE Response: A5 shipped (CE 0.58.0)` to
`/Users/arno/dev/tycho/COMPUTE_ENGINE_ROADMAP.md`. Content depends on what
the empirical phase reveals:

- **Both orders already work** → "Verified, zero source changes" + a tests
  + docs delta. Likely outcome for Order 2.
- **Order 1 needs the lookahead fix** → "Verified Order 2; targeted parser
  fix for Order 1; both orders now produce the same canonical shape."
  Likely outcome.
- **Deeper scope-chain bug surfaces** → escalate scope, flag for the GP
  team, do not ship A5 in this iteration without alignment.

The roadmap section answers GP's two clarifying questions (precedence
interaction; backward-scoping `with`) empirically and notes the items
14–18 importer-integration list now extends with the composition rule.

## Data flow

Parser layer only. Existing `Loop` and `Block` evaluators already implement
the required scope chain — verification step 3 confirms this is sufficient
at evaluate time. If verification reveals a scope-chain bug rather than a
parser-shape asymmetry, the plan widens to include an evaluator fix and
the GP team is consulted before proceeding; project memory indicates
BigOp/Loop scoping already does the right thing for the Block-outermost
case, so this widening is unlikely.

## Error handling

No new error paths. Existing diagnostics apply: missing `=` in binding,
missing iteration list, etc. One edge case to test: malformed
`where … for` lacking an iter clause should fall back to the no-for path
and return the regular `Block(…, body)` shape.

## Testing

- **Parse-shape** tests for both orders against the canonical Block-outermost
  AST.
- **Evaluation** tests with the iter range referencing a binding — this is
  the test that fails today (if the prediction holds) and passes after the
  fix.
- **Scope-leak** regression: bindings do not leak to outer scope.
- **Single-clause regression**: existing `parse-where.test.ts` and the
  for-comprehension test suite continue to pass unchanged.
- **Edge case**: malformed `where … for` without iter falls back to plain
  Block.

## Out of scope

- No `Filter` head; no filter-clause parsing; no condition-checking. The
  original A5 framing was based on a corpus misreading and is withdrawn.
- No new `\operatorname{with}` built-in dictionary entry — that decision
  stands from A4.
- No custom-dictionary `with` example in the test suite — `where` is the
  structural proxy and the COMPUTE_ENGINE.md worked example covers
  documentation.
- No precedence changes to `where` or `for`.

## Risks and open questions

- **Empirical phase might surface a deeper bug.** If `Loop` evaluation
  doesn't reach into the enclosing `Block` for the iter range at evaluate
  time (even with the Block-outermost AST), the plan widens to include an
  evaluator fix. Mitigation: run the empirical phase end-to-end before
  committing to the parser fix.
- **Shared helper extraction.** The lookahead path in `parseWhereExpression`
  needs the same binding-parsing logic as `parseForComprehension`. Either
  factor out a shared helper (cleaner; touches both parsers) or duplicate
  the small loop (~10 lines; surgical). Decision deferred to plan-writing
  after seeing how much overlap there is in practice.
