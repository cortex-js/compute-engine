# Lambda Capture Test Suite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write `test/compute-engine/lambda-capture.test.ts` to document the
current behavior of free-variable capture in lambda (`Function`) expressions,
with `// BUG:` annotations on cases that violate lexical scoping semantics.

**Architecture:** A single new test file with six `describe` blocks, each
wrapped in `beforeAll`/`afterAll` scope push/pop. All expressions whose
current result is uncertain use `toMatchInlineSnapshot()` so Jest fills them
in during the snapshot-capture step. After all tests are written we run
`npm run test snapshot` once to capture every current value, then manually
annotate bugs.

**Tech Stack:** Jest (via `npm run test compute-engine/lambda-capture`),
the shared `engine` instance from `test/utils.ts`, standard CE box/function
API.

---

## Background for Implementor

**The confirmed bug:** The CE's eval context stack is additive — when a
lambda is called, its scope is *pushed* onto the existing stack rather than
*replacing* it. Free variables not found in the lambda's own scope walk
the full stack, so they can see values from the *calling* scope instead of
the *defining* scope. This is dynamic scoping, not the lexical scoping the
CE claims.

**The unused fix placeholder:** `BoxedFunction._capturedContext`
(`boxed-function.ts:113`) carries a `// @todo: wrong` comment and is never
set. It was meant to capture the eval context at definition time.

**Related issue:** `SCOPE_POLLUTION.md` — free variables inside a BigOp
body (`Sum`, `Product`) get auto-declared in the BigOp's local scope rather
than the outer scope. Tests in section 4 probe this interaction.

**Key source files for reference (read-only):**
- `src/compute-engine/function-utils.ts` — `makeLambda()`, `canonicalFunctionLiteralArguments()`
- `src/compute-engine/boxed-expression/boxed-function.ts:1155–1185` — scope push/pop during evaluate
- `src/compute-engine/engine-scope.ts:44–71` — `pushEvalContext` (builds values from scope.bindings)
- `src/compute-engine/engine-expression-entrypoints.ts:103` — auto-declare in current scope
- `src/compute-engine/library/utils.ts:348–379` — `canonicalBigop` (scope pollution source)
- `test/compute-engine/scope.test.ts` — existing scope tests to not duplicate

**Variable naming convention:** Use the prefix `lc_` for all symbols
declared in these tests to avoid collisions with the shared engine's global
state across the test suite.

---

## Task 1: Create test file with sections 1–2

### Files
- Create: `test/compute-engine/lambda-capture.test.ts`

### Step 1: Write the file

```typescript
import { ComputeEngine } from '../../src/compute-engine';
import { engine } from '../utils';

const ce: ComputeEngine = engine;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — FREE VARIABLE CAPTURE
//
// The core question: when a Function expression references a free variable
// (one not in its parameter list), does it use the value from the scope
// where the Function was *defined* (lexical) or the scope where it is
// *called* (dynamic)?
//
// The CE currently implements dynamic scoping via an additive eval-context
// stack. Tests below document the actual current behaviour.
// ─────────────────────────────────────────────────────────────────────────────

describe('FREE VARIABLE CAPTURE', () => {
  beforeAll(() => {
    // Outer (defining) scope: lc_c = 5, lc_f0 = Function(lc_c)
    ce.pushScope();
    ce.declare('lc_c', { value: 5 });
    ce.declare('lc_f0', 'function');
    // Zero-param function whose body is just the free variable lc_c
    ce.assign('lc_f0', ce.box(['Function', ['Block', 'lc_c']]));
  });
  afterAll(() => ce.popScope());

  test('baseline: free var resolves from defining scope when called in same scope', () => {
    // No inner scope — lc_c is 5 in the current scope
    expect(ce.box(['lc_f0']).evaluate().valueOf()).toEqual(5);
  });

  test('free var when called from inner scope with re-declared variable', () => {
    // Inner scope declares its own lc_c = 10, shadowing the outer one.
    // With TRUE lexical scoping lc_f0() should still return 5 (defining scope).
    // BUG: currently returns 10 because the calling scope's eval context is
    //      still on the stack and is found before the defining scope's value.
    ce.pushScope();
    ce.declare('lc_c', { value: 10 });
    const result = ce.box(['lc_f0']).evaluate().valueOf();
    ce.popScope();
    expect(result).toMatchInlineSnapshot(); // BUG: should be 5, not 10
  });

  test('free var sees mutation in defining scope (by-reference capture)', () => {
    // Assigning to lc_c in the *same* scope mutates the definition object.
    // This is expected by-reference behaviour, not a bug.
    ce.assign('lc_c', 99);
    expect(ce.box(['lc_f0']).evaluate().valueOf()).toEqual(99);
    ce.assign('lc_c', 5); // restore for subsequent tests
  });

  test('free var when outer var is assigned (not re-declared) from inner scope', () => {
    // ce.assign from inner scope without a local declaration walks the scope
    // chain and mutates the outer definition's value. The function then sees
    // the mutated value — this is by-reference, not a scoping bug.
    ce.pushScope();
    ce.assign('lc_c', 10);
    const result = ce.box(['lc_f0']).evaluate().valueOf();
    ce.popScope();
    // Restore: the assign mutated the outer definition, so fix it
    ce.assign('lc_c', 5);
    expect(result).toMatchInlineSnapshot(); // expected: 10 (by-reference, not a bug)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PARAMETER SHADOWING
//
// When a parameter has the same name as an outer variable, the parameter
// should shadow it inside the function body.
// ─────────────────────────────────────────────────────────────────────────────

describe('PARAMETER SHADOWING', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_c2', { value: 5 });
    ce.declare('lc_x2', { value: 100 });
  });
  afterAll(() => ce.popScope());

  test('one param + one free var: param bound, free var from outer scope', () => {
    // Function(lc_x + lc_c2, lc_x): lc_x is the param, lc_c2 is free (= 5)
    // Apply to 3 → 3 + 5 = 8
    const f = ce.box(['Function', ['Add', 'lc_x2p', 'lc_c2'], 'lc_x2p']);
    expect(
      ce.function('Apply', [f, ce.number(3)]).evaluate().valueOf()
    ).toEqual(8);
  });

  test('param name matches outer variable — param shadows outer', () => {
    // Outer scope has lc_x2 = 100.
    // Function(lc_x2 * 2, lc_x2): lc_x2 is the param.
    // Apply to 7 → 7 * 2 = 14 (the outer lc_x2 = 100 must be shadowed).
    const f = ce.box(['Function', ['Multiply', 'lc_x2', 2], 'lc_x2']);
    expect(
      ce.function('Apply', [f, ce.number(7)]).evaluate().valueOf()
    ).toEqual(14);
  });

  test('two params, no free vars', () => {
    const f = ce.box(['Function', ['Add', 'lc_p', 'lc_q'], 'lc_p', 'lc_q']);
    expect(
      ce.function('Apply', [f, ce.number(3), ce.number(4)]).evaluate().valueOf()
    ).toEqual(7);
  });

  test('after calling a function, outer variable is unchanged', () => {
    // Calling a function that shadows lc_x2 must not affect the outer binding
    const f = ce.box(['Function', ['Multiply', 'lc_x2', 2], 'lc_x2']);
    ce.function('Apply', [f, ce.number(7)]).evaluate();
    expect(ce.box('lc_x2').evaluate().valueOf()).toEqual(100);
  });
});
```

### Step 2: Run the test to check for parse/runtime errors

```
npm run test compute-engine/lambda-capture
```

Expected: some tests pass, some may fail with `Missing snapshot` (that's OK for
`toMatchInlineSnapshot()` calls — Jest will complain about empty snapshots). Fix
any actual errors (wrong symbol names, syntax errors) before continuing.

### Step 3: Commit

```
git add test/compute-engine/lambda-capture.test.ts
git commit -m "test: add lambda-capture test file, sections 1-2 (free var + param shadowing)"
```

---

## Task 2: Add sections 3–4 (nested lambdas + BigOps)

### Files
- Modify: `test/compute-engine/lambda-capture.test.ts` (append)

### Step 1: Append sections 3–4 to the file

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — NESTED LAMBDAS
//
// When a Function expression is returned as the result of another Function,
// can the inner function correctly access variables bound by the outer one?
// ─────────────────────────────────────────────────────────────────────────────

describe('NESTED LAMBDAS', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_outer', 'function');
    ce.declare('lc_c3', { value: 10 });
  });
  afterAll(() => ce.popScope());

  test('inner lambda captures outer parameter', () => {
    // lc_outer(lc_y) = Function(lc_x + lc_y, lc_x)
    // Apply outer to 4 → get a function that adds 4 to its argument
    // Apply that to 3 → 3 + 4 = 7
    ce.assign(
      'lc_outer',
      ce.box(['Function', ['Function', ['Add', 'lc_x3', 'lc_y3'], 'lc_x3'], 'lc_y3'])
    );
    const inner = ce.function('Apply', [ce.box('lc_outer'), ce.number(4)]).evaluate();
    const result = ce.function('Apply', [inner, ce.number(3)]).evaluate().valueOf();
    // Whether this works depends on whether lc_y3 = 4 survives after the outer
    // function returns (its eval context is popped).
    expect(result).toMatchInlineSnapshot(); // ideally 7
  });

  test('inner lambda captures global free variable through nesting', () => {
    // lc_c3 = 10 (global in this describe's scope)
    // outer(lc_y) = Function(lc_x + lc_c3, lc_x)  — lc_c3 is free in inner
    // Apply outer to anything → inner that computes lc_x + 10
    // Apply inner to 3 → 13
    ce.assign(
      'lc_outer',
      ce.box(['Function', ['Function', ['Add', 'lc_x3', 'lc_c3'], 'lc_x3'], 'lc_y3'])
    );
    const inner = ce.function('Apply', [ce.box('lc_outer'), ce.number(99)]).evaluate();
    const result = ce.function('Apply', [inner, ce.number(3)]).evaluate().valueOf();
    expect(result).toMatchInlineSnapshot(); // ideally 13
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — LAMBDAS INSIDE BigOps
//
// Interaction between lambda capture and scope pollution (SCOPE_POLLUTION.md).
// When a Sum or Product is canonicalized, a local scope is pushed. Free
// variables in the body get auto-declared in that scope instead of the outer
// scope, which can break lambda capture.
// ─────────────────────────────────────────────────────────────────────────────

describe('LAMBDAS INSIDE BigOps', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_c4', { value: 10 });
  });
  afterAll(() => ce.popScope());

  test('Sum body with free var resolves to outer scope value', () => {
    // Sum(lc_k + lc_c4, Limits(lc_k, 1, 3))
    // = (1 + 10) + (2 + 10) + (3 + 10) = 11 + 12 + 13 = 36
    // The question is whether lc_c4 resolves to 10 or gets polluted into
    // Sum's scope with value 'unknown'.
    const result = ce.box(['Sum', ['Add', 'lc_k4', 'lc_c4'], ['Limits', 'lc_k4', 1, 3]])
      .evaluate()
      .valueOf();
    expect(result).toMatchInlineSnapshot(); // ideally 36
  });

  test('index variable does not leak into outer scope after Sum', () => {
    // After Sum(lc_k4^2, Limits(lc_k4, 1, 5)), lc_k4 should be an unknown
    // in the outer scope — not a variable with a stale value.
    // This documents the scope pollution described in SCOPE_POLLUTION.md.
    ce.box(['Sum', ['Power', 'lc_k4b', 2], ['Limits', 'lc_k4b', 1, 5]]).evaluate();
    // lc_k4b should still be an 'unknown' symbol (no assigned value) after Sum
    expect(ce.box('lc_k4b').value?.toString()).toMatchInlineSnapshot();
  });

  test('Sum with free var in calling scope (scope pollution interaction)', () => {
    // If lc_c4 gets auto-declared in Sum's scope with type 'unknown',
    // Sum might not see the outer lc_c4 = 10.
    // BUG candidate: the result may be wrong due to scope pollution.
    ce.pushScope();
    ce.declare('lc_c4', { value: 20 }); // shadow in calling scope
    const result = ce.box(['Sum', ['Add', 'lc_k4c', 'lc_c4'], ['Limits', 'lc_k4c', 1, 3]])
      .evaluate()
      .valueOf();
    ce.popScope();
    // With true lexical scoping: Sum was canonicalized in outer scope → c4 = 10 → 36
    // With dynamic scoping: Sum sees calling scope's c4 = 20 → (1+20)+(2+20)+(3+20) = 66
    // With scope pollution: c4 was auto-declared in Sum's scope → NaN or 'unknown'
    expect(result).toMatchInlineSnapshot(); // BUG candidate
  });
});
```

### Step 2: Run the test

```
npm run test compute-engine/lambda-capture
```

Expected: tests run without crash. Some `toMatchInlineSnapshot()` calls will
need the snapshot pass. Fix errors before continuing.

### Step 3: Commit

```
git add test/compute-engine/lambda-capture.test.ts
git commit -m "test: add lambda-capture sections 3-4 (nested lambdas + BigOps)"
```

---

## Task 3: Add sections 5–6 (mutable closure + currying)

### Files
- Modify: `test/compute-engine/lambda-capture.test.ts` (append)

### Step 1: Append sections 5–6

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — MUTABLE CLOSURE
//
// A function that mutates a free variable via Assign. Tests that mutations
// accumulate correctly and that mutations from one calling scope don't
// bleed through to another.
// ─────────────────────────────────────────────────────────────────────────────

describe('MUTABLE CLOSURE', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_counter', { type: 'integer', value: 0 });
    ce.declare('lc_increment', 'function');
    // lc_increment(): increments lc_counter by 1 and returns new value
    ce.assign(
      'lc_increment',
      ce.box([
        'Function',
        ['Block', ['Assign', 'lc_counter', ['Add', 'lc_counter', 1]], 'lc_counter'],
      ])
    );
  });
  afterAll(() => ce.popScope());

  test('counter increments on each call', () => {
    ce.assign('lc_counter', 0); // reset
    ce.box(['lc_increment']).evaluate();
    ce.box(['lc_increment']).evaluate();
    const result = ce.box(['lc_increment']).evaluate().valueOf();
    expect(result).toEqual(3);
    expect(ce.box('lc_counter').evaluate().valueOf()).toEqual(3);
  });

  test('same function called from two different calling scopes', () => {
    // Call lc_increment from two nested scopes that each re-declare lc_counter.
    // With lexical scoping the function should always mutate the outer lc_counter.
    // With dynamic scoping it mutates whichever lc_counter is on top of the stack.
    ce.assign('lc_counter', 0); // reset outer

    ce.pushScope();
    ce.declare('lc_counter', { type: 'integer', value: 100 });
    const fromInner = ce.box(['lc_increment']).evaluate().valueOf();
    ce.popScope();

    const outerAfter = ce.box('lc_counter').evaluate().valueOf();

    // BUG candidate: with lexical scoping outerAfter should be 1 and fromInner should be 1.
    // With dynamic scoping fromInner mutates the inner lc_counter → fromInner = 101,
    // outerAfter = 0.
    expect(fromInner).toMatchInlineSnapshot();   // BUG candidate: should be 1
    expect(outerAfter).toMatchInlineSnapshot();  // BUG candidate: should be 1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — CURRYING
//
// Partial application: applying a multi-param function to fewer args than
// expected returns a curried function for the remaining args.
// ─────────────────────────────────────────────────────────────────────────────

describe('CURRYING', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_c6', { value: 10 });
  });
  afterAll(() => ce.popScope());

  test('full application of two-param function', () => {
    const f = ce.box(['Function', ['Add', 'lc_p6', 'lc_q6'], 'lc_p6', 'lc_q6']);
    expect(
      ce.function('Apply', [f, ce.number(3), ce.number(4)]).evaluate().valueOf()
    ).toEqual(7);
  });

  test('partial application produces curried function', () => {
    const f = ce.box(['Function', ['Add', 'lc_p6', 'lc_q6'], 'lc_p6', 'lc_q6']);
    // Apply to one arg → curried function expecting one more arg
    const curried = ce.function('Apply', [f, ce.number(3)]).evaluate();
    // Apply curried to second arg → 3 + 4 = 7
    const result = ce.function('Apply', [curried, ce.number(4)]).evaluate().valueOf();
    expect(result).toMatchInlineSnapshot(); // ideally 7
  });

  test('free variable survives partial application', () => {
    // Function(lc_p6 + lc_q6 + lc_c6, lc_p6, lc_q6) — lc_c6 = 10 is free
    const f = ce.box([
      'Function',
      ['Add', 'lc_p6', 'lc_q6', 'lc_c6'],
      'lc_p6',
      'lc_q6',
    ]);
    // Partially apply to 3 → Function(3 + lc_q6 + lc_c6, lc_q6)
    const curried = ce.function('Apply', [f, ce.number(3)]).evaluate();
    // Apply to 4 → 3 + 4 + 10 = 17
    const result = ce.function('Apply', [curried, ce.number(4)]).evaluate().valueOf();
    // BUG candidate: if lc_c6 was auto-declared in the function's scope
    // instead of resolved from outer scope, this will not return 17.
    expect(result).toMatchInlineSnapshot(); // BUG candidate: should be 17
  });

  test('free variable in curried function is not affected by re-declaration in calling scope', () => {
    const f = ce.box([
      'Function',
      ['Add', 'lc_p6', 'lc_q6', 'lc_c6'],
      'lc_p6',
      'lc_q6',
    ]);
    ce.pushScope();
    ce.declare('lc_c6', { value: 99 });
    const curried = ce.function('Apply', [f, ce.number(3)]).evaluate();
    const result = ce.function('Apply', [curried, ce.number(4)]).evaluate().valueOf();
    ce.popScope();
    // With lexical scoping: lc_c6 should be 10 (defining scope) → 17
    // With dynamic scoping: lc_c6 = 99 → 106
    expect(result).toMatchInlineSnapshot(); // BUG candidate: should be 17
  });
});
```

### Step 2: Run the test

```
npm run test compute-engine/lambda-capture
```

Fix any errors before continuing.

### Step 3: Commit

```
git add test/compute-engine/lambda-capture.test.ts
git commit -m "test: add lambda-capture sections 5-6 (mutable closure + currying)"
```

---

## Task 4: Capture all snapshots

At this point the file has ~15 `toMatchInlineSnapshot()` calls with no
snapshot strings yet. Jest will error on them. This step fills them all in.

### Step 1: Run the snapshot update

```
npm run test snapshot
```

This updates ALL snapshots in the project. Verify that only
`lambda-capture.test.ts` was modified:

```
git diff --name-only
```

Expected: only `test/compute-engine/lambda-capture.test.ts` appears.

If other test files also changed, something else broke — investigate before
continuing.

### Step 2: Run the tests again to confirm they all pass

```
npm run test compute-engine/lambda-capture
```

Expected: all tests pass.

### Step 3: Commit the captured snapshots

```
git add test/compute-engine/lambda-capture.test.ts
git commit -m "test: capture current snapshots for lambda-capture test suite"
```

---

## Task 5: Annotate known bugs and verify

### Step 1: Open the test file and review the captured snapshot values

For each `// BUG candidate:` comment, check whether the captured value
matches the "ideally" or "should be" value noted in the comment.

**Known confirmed bugs (from research):**

| Test | Snapshot section | Expected (correct) | Bug if snapshot is |
|---|---|---|---|
| "free var when called from inner scope with re-declared variable" | sec 1 | `5` | `10` |
| "same function called from two different calling scopes" — `fromInner` | sec 5 | `1` | `101` |
| "same function called from two different calling scopes" — `outerAfter` | sec 5 | `1` | `0` |

**Likely bugs (based on analysis, verify against snapshot):**

| Test | Snapshot section | Expected (correct) | Likely snapshot |
|---|---|---|---|
| "free var in curried function not affected by re-declaration" | sec 6 | `17` | `106` |
| "free var survives partial application" | sec 6 | `17` | check |

### Step 2: For each confirmed bug, update the `// BUG` comment

Change the generic `// BUG candidate: should be X` comment to:

```typescript
// BUG: dynamic scoping — returns 10 instead of 5 (the defining scope's value).
// The eval-context stack is additive; the calling scope's frame is visible to
// the function body. Fix requires capturing the eval-context stack at
// Function definition time (see BoxedFunction._capturedContext todo).
```

Use a similar format for each bug — name the root cause and point to the
relevant source location.

### Step 3: For nested lambda and BigOps tests that pass correctly

If sections 3 and 4 show correct values (e.g., Sum correctly returns `36`),
change their comments from `// ideally X` to `// correct: X`.

If they show wrong values, add appropriate `// BUG:` comments.

### Step 4: Run tests one final time to confirm everything still passes

```
npm run test compute-engine/lambda-capture
```

All tests must pass (they assert current behavior, not correct behavior).

### Step 5: Also run typecheck to confirm no type errors

```
npm run typecheck
```

Expected: no new errors.

### Step 6: Commit the annotated file

```
git add test/compute-engine/lambda-capture.test.ts
git commit -m "test: annotate lambda-capture tests with BUG markers for dynamic-scoping violations"
```

---

## Summary

After this plan is complete you will have:

1. A passing test file `test/compute-engine/lambda-capture.test.ts` with 15+
   test cases across 6 describe blocks.
2. All cases asserting the CE's *current* behavior with `toMatchInlineSnapshot`.
3. Bug-annotated cases identifying where dynamic scoping diverges from the
   expected lexical semantics, with root-cause pointers to source locations.
4. A solid regression baseline: when the CE is later fixed to implement proper
   lexical capture, exactly these annotated cases will fail and need their
   snapshots updated.
