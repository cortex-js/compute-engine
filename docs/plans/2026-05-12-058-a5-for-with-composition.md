# CE 0.58.0 — A5 `where`+`for` Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `\operatorname{where}`+`\operatorname{for}` (and by inheritance, custom-dictionary `\operatorname{with}`+`\operatorname{for}`) compose so that let-bindings scope over both the body and the iterator range, regardless of surface order. Closes A5 from CE 0.58.0.

**Architecture:** Verification-first. Write failing tests against the target canonical AST shape `Block(Declare, Assign, …, Loop(body, Element))` for both surface orders. If Order 2 already works (predicted) and Order 1 doesn't (predicted), apply a localized lookahead fix to `parseWhereExpression` so a trailing `\operatorname{for}` clause is consumed and merged into the Block-outermost shape. Then document and update the roadmap.

**Tech Stack:** TypeScript, Jest, MathJSON.

**Policy:** Per the user's CLAUDE.md, this plan omits `git commit` and `git push` steps. The user commits separately once the work is verified.

**Design doc:** `docs/plans/2026-05-12-058-a5-for-with-composition-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `test/compute-engine/a5-where-for-composition.test.ts` | New file. All composition tests (parse shape both orders, evaluation both orders, scope-leak regression, malformed-clause edge case). |
| `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` | Modify `parseWhereExpression` (~line 2741) to optionally consume a trailing `\operatorname{for}` clause and emit `Block(…, Loop(…))`. Only edited if Task 2 confirms Order 1 produces the wrong shape. |
| `docs/architecture/actions-and-randomness.md` | Add §5 covering `where`+`for` composition: both surface orders, canonical shape, traces, note for custom `with` consumers. |
| `/Users/arno/dev/tycho/COMPUTE_ENGINE_ROADMAP.md` | Add `## CE Response: A5 shipped (CE 0.58.0)` section answering GP's two clarifying questions empirically. |

---

## Baseline check before starting

- [ ] **Step 1: Confirm CE compiles and the existing test suite is green**

Run:
```bash
npm run typecheck
npm run test compute-engine/parse-where
```
Expected: 0 typecheck errors. All `parse-where` tests pass. This is the baseline; the new work must not regress it.

- [ ] **Step 2: Note the test count baseline**

Run:
```bash
npm run test compute-engine/parse-where 2>&1 | tail -5
```
Record the number of passing tests. The same suite must still pass at the end.

---

## Task 1: Empirical verification — write the composition tests

The first task is purely diagnostic. Write tests that assert the **target** behavior (canonical Block-outermost shape, working evaluation with iter range referencing a binding). Run them. Capture which ones fail. The failures define what Task 2 has to fix.

**Files:**
- Create: `test/compute-engine/a5-where-for-composition.test.ts`

- [ ] **Step 1: Write the parse-shape test for Order 1 (`where` before `for`)**

Create `test/compute-engine/a5-where-for-composition.test.ts` with this content:

```typescript
import { engine as ce } from '../utils';

describe('A5 — where+for composition (Order 1: where before for)', () => {
  test('Parse: bindings before iter produces Block-outermost shape', () => {
    // Surface: `i \operatorname{where} n \coloneq 3 \operatorname{for} i = \operatorname{Range}(n)`
    // Target canonical shape (Block outermost, Loop inside):
    //   [Block, [Declare, n], [Assign, n, 3],
    //           [Loop, i, [Element, i, [Range, n]]]]
    expect(
      ce.parse(
        'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
      )
    ).toMatchInlineSnapshot();
  });
});
```

Note: `toMatchInlineSnapshot()` with no argument captures the **actual** AST on first run. This is intentional — we want to see what the parser currently produces before predicting the fix.

- [ ] **Step 2: Run the test and capture the snapshot**

Run:
```bash
npm run test compute-engine/a5-where-for-composition
```
Expected: the test passes after Jest writes the captured snapshot inline. Inspect the snapshot — does it match the target `[Block, [Declare, n], [Assign, n, 3], [Loop, i, [Element, i, [Range, n]]]]`?

- If yes: Order 1 already works; mark this in your notes and continue.
- If no (predicted): the captured snapshot likely shows `[Loop, [Block, [Declare, n], [Assign, n, 3], i], [Element, i, [Range, n]]]` (Block inside Loop body). This is the bug Task 2 will fix.

- [ ] **Step 3: Convert the snapshot to an explicit assertion**

Replace `toMatchInlineSnapshot()` with the **target** shape so the test fails until the fix is in:

```typescript
  test('Parse: bindings before iter produces Block-outermost shape', () => {
    expect(
      ce.parse(
        'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
      )
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "n"],
        ["Assign", "n", 3],
        ["Loop", "i", ["Element", "i", ["Range", "n"]]]
      ]
    `);
  });
```

- [ ] **Step 4: Run and confirm the test now fails with a diff**

Run:
```bash
npm run test compute-engine/a5-where-for-composition
```
Expected: FAIL with a diff between the actual `Loop(Block(…), …)` shape and the target `Block(…, Loop(…))` shape. This failure is what Task 2 will fix.

If the test PASSES instead (meaning the parser already produces the Block-outermost shape), the Order 1 prediction was wrong. In that case: skip Task 2's fix, but still complete Tasks 3 (other tests), 4 (docs), and 5 (roadmap).

- [ ] **Step 5: Write the parse-shape test for Order 2 (`for` before `where`)**

Add to the same test file:

```typescript
describe('A5 — where+for composition (Order 2: for before where)', () => {
  test('Parse: iter before bindings produces Block-outermost shape', () => {
    // Surface: `i \operatorname{for} i = \operatorname{Range}(n) \operatorname{where} n \coloneq 3`
    // Same target canonical shape as Order 1.
    expect(
      ce.parse(
        'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
      )
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "n"],
        ["Assign", "n", 3],
        ["Loop", "i", ["Element", "i", ["Range", "n"]]]
      ]
    `);
  });
});
```

- [ ] **Step 6: Run and inspect**

Run:
```bash
npm run test compute-engine/a5-where-for-composition
```
Expected (per prediction): Order 2 PASSES (Block is naturally outermost because `where` runs after `for`).

If Order 2 also fails, the design's risk section was triggered — pause and check whether the actual AST shape is functionally equivalent (e.g., `Loop` wrapped inside a different Block-like construct that still gives correct scope) before assuming a deeper fix is needed.

- [ ] **Step 7: Write the Order 1 evaluation test**

Add to the test file:

```typescript
describe('A5 — where+for composition (evaluation)', () => {
  test('Order 1: where before for — iter range can reference binding', () => {
    // n is bound to 3; for-iter ranges over Range(n) = [1,2,3]
    // body is i; result is the list [1, 2, 3]
    const result = ce
      .parse(
        'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
      )
      .evaluate();
    expect(result.json).toEqual(['List', 1, 2, 3]);
  });
});
```

- [ ] **Step 8: Run and inspect**

Run:
```bash
npm run test compute-engine/a5-where-for-composition
```
Expected: this test FAILS if Order 1's AST shape is wrong (Range cannot resolve `n` because `n` lives inside the Loop body's Block, not in an outer scope reachable by the Element's range).

If it actually PASSES, that means CE's scope chain somehow already does the right thing despite the asymmetric AST — useful information. Note it; the fix may then be docs-only.

- [ ] **Step 9: Write the Order 2 evaluation test**

Add to the test file:

```typescript
  test('Order 2: for before where — iter range can reference binding', () => {
    const result = ce
      .parse(
        'i \\operatorname{for} i = \\operatorname{Range}(n) \\operatorname{where} n \\coloneq 3'
      )
      .evaluate();
    expect(result.json).toEqual(['List', 1, 2, 3]);
  });
```

- [ ] **Step 10: Run and inspect**

Run:
```bash
npm run test compute-engine/a5-where-for-composition
```
Expected (per prediction): Order 2 evaluation PASSES because Block is outermost and `Range(n)` resolves via the scope chain.

- [ ] **Step 11: Write the scope-leak regression test**

Add to the test file:

```typescript
describe('A5 — where+for composition (scope hygiene)', () => {
  test('Bindings do not leak to outer scope after composed expression', () => {
    ce.pushScope();
    try {
      ce.assign('n', 100);
      // Inside the where-clause, n is shadowed to 3.
      const result = ce
        .parse(
          'i \\operatorname{where} n \\coloneq 3 \\operatorname{for} i = \\operatorname{Range}(n)'
        )
        .evaluate();
      expect(result.json).toEqual(['List', 1, 2, 3]);
      // After the clause, outer n is unchanged.
      expect(ce.box('n').evaluate().re).toEqual(100);
    } finally {
      ce.popScope();
    }
  });
});
```

- [ ] **Step 12: Write the malformed-clause edge case test**

Add to the test file:

```typescript
describe('A5 — where+for composition (edge cases)', () => {
  test('where without trailing for falls back to plain Block', () => {
    // Regression: plain `where` (no for clause) must still produce
    // the original Block(Declare, Assign, body) shape from A4.
    expect(
      ce.parse('x^2 \\operatorname{where} x \\coloneq 5')
    ).toMatchInlineSnapshot(
      `["Block", ["Declare", "x"], ["Assign", "x", 5], ["Square", "x"]]`
    );
  });
});
```

This is a duplicate of an existing test in `parse-where.test.ts` but kept here as a local regression guard for the Task 2 lookahead — if the lookahead accidentally consumes too much, this test catches it.

- [ ] **Step 13: Run the full test file and record results**

Run:
```bash
npm run test compute-engine/a5-where-for-composition
```

Record the outcome of every test. The decision tree for Task 2 is:

| Result | Action |
| --- | --- |
| All tests PASS | Skip Task 2 (no fix needed). Jump to Task 3. |
| Order 1 parse + Order 1 eval FAIL; Order 2 + others PASS | **Predicted case.** Execute Task 2 in full. |
| Order 2 evaluation FAILS | Risk-section scope-chain bug. Stop and reassess; do not proceed with the parser fix in isolation. |

---

## Task 2: Parser fixes — both surface orders

**Scope widened after empirical phase.** The original plan predicted only Order 1 would need a fix. Verification revealed Order 2 also fails, for a different but equally localized reason. Both fixes are in the same file.

**Order 1 bug:** `parseWhereExpression` returns `Block(Declare, Assign, …, body)`. When `for` follows, the outer parser wraps the Block: `Loop(Block(…), Element)`. Iterator range can't reach the bindings.

**Order 2 bug:** `parseForComprehension`'s `bindingTerminator` has `minPrec: 21`, but `\operatorname{where}` is at precedence 21. The terminator condition only stops at commas, so `where` gets parsed into the binding RHS. The result is `Block(…, Equal(y, range))`, which `parseForComprehension` rejects (operator is `Block`, not `Equal`/`Assign`), returning `null`. The outer parser then sees `\operatorname{for}` unconsumed and emits an `unexpected-operator` error.

**Files:**
- Modify: `src/compute-engine/latex-syntax/dictionary/definitions-core.ts`
  - Function `parseWhereExpression` near line 2741 (Order 1 fix)
  - Function `parseForComprehension` near line 2695 (Order 2 fix)

- [ ] **Step 1: Re-read `parseWhereExpression` and `parseForComprehension`**

Open `src/compute-engine/latex-syntax/dictionary/definitions-core.ts` and read both functions in full:
- `parseWhereExpression` — near line 2741
- `parseForComprehension` — near line 2695
- `buildBlockFromSequence` — near line 2791 (what `where` calls to produce its output Block)

Note how both functions handle the comma-separated binding loop. The `for` parser builds `Element(name, list)` entries; the `where` parser builds an `Assign` list that `buildBlockFromSequence` converts to `Declare+Assign` pairs.

- [ ] **Step 2: Identify the splice point**

In `parseWhereExpression`, find the `return buildBlockFromSequence([...bindings, lhs])` (or equivalent) at the end of the function. The lookahead must run **after** the binding loop completes but **before** the Block is built — so the body composed into the Block can be the entire `Loop(lhs, Element, …)` rather than just `lhs`.

- [ ] **Step 3: Add the lookahead branch**

The file already exposes a `matchKeyword(parser, keyword)` helper at
`definitions-core.ts:2559` that consumes `\text{keyword}` /
`\operatorname{keyword}` / `\mathrm{keyword}` on success and rewinds on
failure. Use it directly.

Modify `parseWhereExpression` to insert the lookahead between the
binding loop and the final Block construction:

```typescript
function parseWhereExpression(
  parser: Parser,
  lhs: MathJsonExpression,
  until?: Readonly<Terminator>
): MathJsonExpression | null {
  // ... existing binding loop unchanged ...
  const bindings: MathJsonExpression[] = [];
  do {
    parser.skipVisualSpace();
    const binding = parser.parseExpression(bindingTerminator);
    if (!binding) break;
    bindings.push(binding);
    parser.skipVisualSpace();
  } while (parser.match(','));

  // NEW: lookahead for trailing \operatorname{for}.
  // matchKeyword consumes on success and rewinds on failure.
  const forStart = parser.index;
  if (matchKeyword(parser, 'for')) {
    // 'for' keyword consumed. parseForComprehension takes the body
    // (lhs) and emits ['Loop', body, Element(...), ...]. We then wrap
    // it in the Block carrying the where-clause bindings, so the Loop
    // body and the iterator ranges both see the bindings via scope.
    const loop = parseForComprehension(parser, lhs, until);
    if (loop) {
      return buildBlockFromSequence([...bindings, loop]);
    }
    // parseForComprehension failed mid-stream. Restore index and
    // fall through to the plain Block path.
    parser.index = forStart;
  }

  return buildBlockFromSequence([...bindings, lhs]);
}
```

`matchKeyword` and `parseForComprehension` are both defined in the same
file — no new imports needed.

- [ ] **Step 3b: Add the Order 2 fix in `parseForComprehension`**

In `parseForComprehension` (near line 2695), the `bindingTerminator.condition`
currently stops only at the outer terminator or a comma. Extend it to also
stop at `\operatorname{where}` or `\operatorname{with}` so those keywords
don't get pulled into the binding RHS.

`peekKeyword(parser, keyword)` already exists in this file (near line 2583)
and matches `\text{keyword}` / `\operatorname{keyword}` non-consumingly.

Modify the `bindingTerminator` to:

```typescript
const bindingTerminator: Terminator = {
  minPrec: 21, // Above comma (20) and ; (19), so `x = L_1` is captured whole
  condition: (p) => {
    if (until?.condition?.(p)) return true;
    const saved = p.index;
    p.skipVisualSpace();
    const isComma = p.peek === ',';
    p.index = saved;
    if (isComma) return true;
    // Stop at trailing where/with so they're processed by the outer
    // parser rather than swallowed into the binding RHS.
    if (peekKeyword(p, 'where')) return true;
    if (peekKeyword(p, 'with')) return true;
    return false;
  },
};
```

This lets Order 2 (`body \operatorname{for} iter \operatorname{where} bindings`)
parse correctly: the for-parser stops at `where`, returns `Loop(body, Element)`,
and the outer parser then engages `where` on the Loop. The result is
`Block(Declare, Assign, …, Loop(body, Element))` — the canonical
Block-outermost shape, matching what Order 1 produces after Step 3.

Note: `peekKeyword` includes `with` here even though `\operatorname{with}` is
not a CE built-in. The custom-dictionary `with` registrations GP installs
inherit the same composition behavior automatically because the for-parser
won't swallow them either.

- [ ] **Step 4: Run the Order 1 parse-shape test**

Run:
```bash
npm run test compute-engine/a5-where-for-composition -- -t "Order 1: where before for"
```
Expected: the parse-shape test now PASSES. If it doesn't, inspect the new actual shape and adjust the lookahead.

- [ ] **Step 5: Run the Order 1 evaluation test**

Run:
```bash
npm run test compute-engine/a5-where-for-composition -- -t "Order 1: where before for — iter range can reference binding"
```
Expected: PASS — `Range(n)` now resolves because `n` is in the outer Block scope reachable from the Element's range expression.

- [ ] **Step 6: Run the full A5 test file**

Run:
```bash
npm run test compute-engine/a5-where-for-composition
```
Expected: all tests PASS — parse shape, evaluation, scope-leak, malformed fallback.

- [ ] **Step 7: Run the existing where-parser tests to verify no regression**

Run:
```bash
npm run test compute-engine/latex-syntax/parse-where
```
Expected: every test from before still PASSES. The lookahead must not affect the plain-`where` path.

- [ ] **Step 8: Run the full latex-syntax suite**

Run:
```bash
npm run test latex-syntax
```
Expected: no regressions anywhere. If anything fails, inspect — the lookahead may be over-consuming tokens.

- [ ] **Step 9: Run typecheck**

Run:
```bash
npm run typecheck
```
Expected: 0 errors.

---

## Task 3: Documentation — `actions-and-randomness.md` §5

**Files:**
- Modify: `docs/architecture/actions-and-randomness.md`

- [ ] **Step 1: Read the existing file to confirm structure**

Open `docs/architecture/actions-and-randomness.md`. Confirm it has §1 through §4 (Block sequential, snapshot-then-commit, Random determinism, `where` clause) ending around line 127.

- [ ] **Step 2: Append §5 after §4**

Add this section after §4's "Implementation note":

```markdown
## 5. `where`+`for` composition

The `\operatorname{where}` clause composes with `\operatorname{for}`
comprehensions in both surface orders. Both produce the same canonical
Block-outermost AST shape, so let-bindings scope over **both the body
and the iterator range expressions**.

### Order 1: bindings before iter

```latex
i \operatorname{where} n \coloneq 3 \operatorname{for} i = \operatorname{Range}(n)
```

Parses to:

```mathjson
["Block",
 ["Declare", "n"], ["Assign", "n", 3],
 ["Loop", "i", ["Element", "i", ["Range", "n"]]]]
```

The `\operatorname{Range}(n)` reference resolves to `3` via the outer
`Block` scope, and the comprehension evaluates to `[1, 2, 3]`.

### Order 2: iter before bindings

```latex
i \operatorname{for} i = \operatorname{Range}(n) \operatorname{where} n \coloneq 3
```

Parses to the same canonical shape and evaluates to the same `[1, 2, 3]`.

### Why both orders work

The `where` parser, after consuming its bindings, looks ahead for a
trailing `\operatorname{for}` clause. If present, it consumes the for-
clause and emits the Block-outermost shape directly. If absent, it falls
back to the plain `Block(Declare, Assign, …, body)` form documented in §4.

In Order 2, `where` runs naturally after `for` (precedence 21 > 19) on
the already-formed `Loop` expression, and the resulting Block is
trivially outermost.

### Custom `\operatorname{with}` consumers

Consumers that register `\operatorname{with}` via custom LaTeX dictionary
(per `COMPUTE_ENGINE.md`'s "Desmos-Specific Syntax" section) inherit the
same composition behavior automatically — provided the custom parser
lowers to the same `Block(Declare, Assign, …, body)` shape as `where`.
Both surface orders compose correctly with `for` without further work.
```

- [ ] **Step 3: Verify the file still renders cleanly**

Open the file in an editor or run a markdown linter if available. Look for: unbalanced fences, broken anchor links, inconsistent indentation in the code blocks. The §5 content uses MathJSON-style arrays in fenced blocks tagged `mathjson` — consistent with the rest of the file.

---

## Task 4: Roadmap update

**Files:**
- Modify: `/Users/arno/dev/tycho/COMPUTE_ENGINE_ROADMAP.md`

- [ ] **Step 1: Locate the insertion point**

The new CE Response section goes **after** the A4 section and **before** `## Current Graph Paper Dependency on CE`. Search for `## CE Response: A4 shipped (CE 0.58.0)` and find the end of that section (where the "Remaining 0.58.0 work" paragraph mentions A5 as the last bucket).

- [ ] **Step 2: Replace the "Remaining 0.58.0 work" paragraph in the A4 section**

Currently it says "A5 (CE-P8 filter clauses — translation-aware) is the last bucket." Update that paragraph in the A4 section to reference A5's re-scoped framing (now a composition verification, not a filter ship). Concretely, replace:

```
### Remaining 0.58.0 work

A5 (CE-P8 filter clauses — translation-aware) is the last bucket.
0.58.0 ships as a single bundle once A5 lands. After release, per
the GP single-release commitment, the standing roadmap closes
pending audit re-runs.
```

with:

```
### Remaining 0.58.0 work

A5 (CE-P8 `where`+`for` composition — re-scoped per the
2026-05-22 corpus audit) is the last bucket. 0.58.0 ships as a
single bundle once A5 lands. After release, per the GP single-
release commitment, the standing roadmap closes pending audit re-runs.
```

- [ ] **Step 3: Add the new CE Response section before "## Current Graph Paper Dependency on CE"**

Insert this section verbatim. **Note:** the "verified" vs "verified + fix" language depends on Task 1's outcome — pick the variant matching what actually happened:

**Variant A (no fix was needed — Order 1 already worked):**

```markdown
## CE Response: A5 shipped (CE 0.58.0)

A5 (re-scoped to `where`+`for` composition verification) is complete.
0.58.0 is feature-complete; ship and audit re-runs are next.

### What A5 actually shipped

Per GP's re-scope, A5 reduced to verifying that `\operatorname{where}`
(and by inheritance, custom-dictionary `\operatorname{with}`) composes
with the built-in `\operatorname{for}` parser such that let-bindings
scope over both the body and the iterator range, in both surface orders.

**Empirical result:** both surface orders already produce the canonical
`Block(Declare, Assign, …, Loop(body, Element(i, range)))` shape with no
source-side changes required. The precedence layout (`where` = 21,
`for` = 19) cooperates with `Block`'s scope semantics to give the
correct behavior end-to-end.

### Answers to GP's two clarifying questions

1. **Precedence interaction.** Yes — `Block(…, Loop(…))` nesting holds
   in both surface orders. Verified by the new
   `test/compute-engine/a5-where-for-composition.test.ts` suite.
2. **Backward-scoping `with`.** Yes — when the surface order is
   `body \operatorname{for} i = range(p) \operatorname{with} p \coloneq …`,
   `p` resolves correctly inside `range(p)` because the resulting AST
   has the `Block` outermost. Same applies to the symmetric Order 1.

### Notes for GP's importer integration

Adding to the list:

19. **`where`+`for` composes naturally in both surface orders.**
    Custom-dictionary `\operatorname{with}` registrations that lower
    to the same `Block(Declare, Assign, …, body)` shape inherit this
    behavior. No translation-time rewriting is required to handle the
    `with`-before-`for` vs `with`-after-`for` corpus rows differently;
    both lower to the same canonical AST.
```

**Variant B (lookahead fix was needed — predicted case):**

```markdown
## CE Response: A5 shipped (CE 0.58.0)

A5 (re-scoped to `where`+`for` composition verification) is complete.
0.58.0 is feature-complete; ship and audit re-runs are next.

### What A5 actually shipped

Per GP's re-scope, A5 reduced to verifying that `\operatorname{where}`
(and by inheritance, custom-dictionary `\operatorname{with}`) composes
with the built-in `\operatorname{for}` parser such that let-bindings
scope over both the body and the iterator range, in both surface orders.

**Empirical result:** Order 2 (`for` before `where`) worked out of the
box because the higher-precedence `where` (21) runs naturally after the
lower-precedence `for` (19), wrapping the Loop in a Block. Order 1
(`where` before `for`) produced an asymmetric `Loop(Block(decls, body),
Element)` shape where the iterator range could not reach the let-binding.

A localized lookahead was added to `parseWhereExpression`: after parsing
its bindings, it now peeks for a trailing `\operatorname{for}` clause
and, if present, consumes the for-clause and emits the canonical
`Block(Declare, Assign, …, Loop(body, Element))` shape directly. The
no-`for` path is unchanged so existing `where`-only behavior is
preserved.

### Answers to GP's two clarifying questions

1. **Precedence interaction.** Yes (after the lookahead fix) — both
   surface orders produce identical `Block(…, Loop(…))` ASTs. Verified
   by the new `test/compute-engine/a5-where-for-composition.test.ts`
   suite.
2. **Backward-scoping `with`.** Yes — when the surface order is
   `body \operatorname{for} i = range(p) \operatorname{with} p \coloneq …`,
   `p` resolves correctly inside `range(p)` because the resulting AST
   has the `Block` outermost. The symmetric Order 1 now also produces
   the Block-outermost shape after the parser fix.

### Notes for GP's importer integration

Adding to the list:

19. **`where`+`for` composes in both surface orders.**
    Custom-dictionary `\operatorname{with}` registrations that lower
    to the same `Block(Declare, Assign, …, body)` shape as `where`
    inherit the composition behavior automatically. No
    translation-time rewriting is required to handle the
    `with`-before-`for` vs `with`-after-`for` corpus rows differently;
    both surface orders lower to the same canonical AST.
```

Pick the variant matching Task 1's outcome and delete the other before saving.

- [ ] **Step 4: Update the closing remarks**

After the new A5 section, the `## Current Graph Paper Dependency on CE` section follows. No edits needed there.

- [ ] **Step 5: Verify the section table-of-contents at the top of the document**

Search for "Returning CE reader?" at the top of the document. The pointer to "Status Summary: Complete Remaining Work (2026-05-19)" is still accurate — that section is the canonical TOC and doesn't need updating per-bucket. No change required unless the pointer is broken.

---

## Task 5: Verification

- [ ] **Step 1: Run the full test suite**

Run:
```bash
npm test
```
Expected: 0 failures. Note the new A5 test count is added to the baseline.

- [ ] **Step 2: Run typecheck**

Run:
```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Run the cycle check**

Run:
```bash
npx madge --circular --extensions ts src/compute-engine
```
Expected: same cycle count as before this work (target: 8 type-only cycles per project memory). The plan only touches one source file (`definitions-core.ts`) which already imports its dependencies, so no new cycles should appear.

- [ ] **Step 4: Update project memory**

Update `/Users/arno/.claude/projects/-Users-arno-dev-compute-engine/memory/project_058_plan.md` with a "Status update" entry:
- A5 (`where`+`for` composition) shipped internally
- One- or two-sentence summary of what landed (no fix vs. lookahead fix in `parseWhereExpression`)
- The 0.58.0 bundle is now feature-complete; ship is next

- [ ] **Step 5: Final review**

Open `/Users/arno/dev/tycho/COMPUTE_ENGINE_ROADMAP.md` and re-read the A5 section. Confirm:
- The variant (A or B) matches what actually shipped.
- Item #19 in the importer integration list is appended (not replacing an earlier item).
- The "Remaining 0.58.0 work" paragraph in the prior (A4) section was updated.

---

## What's NOT in this plan

- **No commit/push steps.** Per user policy.
- **No custom-dictionary `with` registration in the test suite.** Decided in design: `where` is the structural proxy.
- **No precedence changes.** Decided in design: the lookahead is the minimal fix.
- **No `Filter` head, no condition-checking.** The original A5 framing was withdrawn.
- **No evaluator changes.** Existing `Block` and `Loop` evaluators already implement the scope chain correctly; the design's risk section covers the unlikely case where they don't, in which case the plan widens and the work pauses for GP alignment.
