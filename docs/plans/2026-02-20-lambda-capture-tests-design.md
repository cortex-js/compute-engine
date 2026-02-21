# Design: Lambda Capture Test Suite

**Date:** 2026-02-20
**File to create:** `test/compute-engine/lambda-capture.test.ts`

---

## Background

The CE uses lexical scoping conceptually, but the eval context stack is
additive: when a function is called, its scope is pushed onto the existing
stack rather than replacing it. Free variables that are not found in the
function's own scope's values are resolved by walking down the eval context
stack, which means they can resolve to the *calling* scope's values instead of
the *defining* scope's values. This is de-facto dynamic scoping.

Evidence: `scope.test.ts` — the "DYNAMIC SCOPING / Lexical scoping" test
currently asserts `10` (with a comment `// 5`), i.e. the function sees the
calling scope's value, not the defining scope's value.

The `_capturedContext` field on `BoxedFunction` (boxed-function.ts:113) carries
a `// @todo: wrong` comment and is never populated. It was clearly intended to
capture the eval context stack at definition time to give true lexical
semantics, but was never implemented.

Related: `SCOPE_POLLUTION.md` — free variables in BigOp bodies get
auto-declared in the BigOp's local scope instead of the outer scope, which
interacts with the lambda capture problem.

---

## Goal

Write `test/compute-engine/lambda-capture.test.ts` that documents the **current
actual behavior** of lambda capture. Cases where the current behavior is
incorrect (violates lexical scoping) are marked with a `// BUG:` comment
explaining the correct expected value.

Tests must **pass today** (they assert current behavior, not correct behavior).
They serve as a behavioral record and regression baseline. A follow-up task
will fix the bugs; at that point the `// BUG:` cases will be updated.

---

## Test File Structure

Single file `test/compute-engine/lambda-capture.test.ts` with six describe
blocks.

---

### 1. FREE VARIABLE CAPTURE — core capture semantics

**Setup:** outer scope declares `c = 5`, assigns `f = Function(c)` (no
params, body is just `c`).

| Scenario | Call site | Current result | Correct result | Bug? |
|---|---|---|---|---|
| `c` re-declared in calling scope | inner scope: `declare c = 10`, call `f()` | `10` | `5` | YES — dynamic lookup |
| `c` assigned (not re-declared) in calling scope | inner scope: `assign c = 10`, call `f()` | `10` | `10` | No — mutation of shared definition is expected |
| `c` reassigned in *defining* scope after `f` is created | outer: `assign c = 99`, call `f()` | `99` | `99` | No — by-reference capture |

**Key insight:** Re-declaration creates a new binding in the inner scope. With
true lexical scoping `f` should see the outer binding. With dynamic scoping
`f` sees the inner binding because the inner scope's eval context is on the
stack.

---

### 2. PARAMETER SHADOWING

**Setup:** outer scope has `c = 5`.

| Scenario | Expression | Expected |
|---|---|---|
| One param, one free var | `Function(x + c, x)` applied to `3` | `8` |
| Param name matches outer variable | `Function(x * 2, x)` where outer has `x = 100`, applied to `7` | `14` (param shadows outer) |
| Two params, no free vars | `Function(x + y, x, y)` applied to `3, 4` | `7` |

---

### 3. NESTED LAMBDAS

| Scenario | Expression | Expected |
|---|---|---|
| Inner captures outer param | `Function(Function(x + y, x), y)` — outer applied to `4`, inner applied to `3` | `7` |
| Inner captures outer param (reversed) | Same outer/inner but applied in reverse order | `7` |
| Doubly nested free variable from global | `c = 10`; `Function(Function(x + c, x), y)` | inner applied to `3` gives `13` |

---

### 4. LAMBDAS INSIDE BigOps

| Scenario | Expression | Notes |
|---|---|---|
| Free var in Sum body | `c = 10`, `Sum(k + c, Limits(k, 1, 3))` | Expects `36` — does `c` resolve to outer scope? |
| Index variable cleanup | After `Sum(k^2, Limits(k, 1, 5))`, does `k` remain an unknown in outer scope? | Documents index leak (see SCOPE_POLLUTION.md) |
| Lambda as Sum body | `c = 10`, `Sum(Function(k + c, k), Limits(k, 1, 3))` | Combination of Function + BigOp |

---

### 5. MUTABLE CLOSURE

| Scenario | Expression | Expected |
|---|---|---|
| Simple counter via `Assign` | `counter = 0`; `f = Function(Block(Assign(counter, counter+1), counter))`; call `f()` three times | counter = 3 after three calls |
| Same function-value, two calling scopes | Define `f` in outer scope capturing `c = 5`; call from scope A (re-declares `c = 10`) and scope B (re-declares `c = 20`) | Documents whether calling scope bleeds through |

---

### 6. CURRYING

| Scenario | Expression | Expected |
|---|---|---|
| Full application | `Function(x + y, x, y)` applied to `3, 4` | `7` |
| Partial application | Same applied to `3` only → apply result to `4` | `7` |
| Free var survives currying | `c = 10`; `Function(x + y + c, x, y)` applied to `3` → apply result to `4` | `17` |

---

## Bug Summary

The following behaviors are currently incorrect (dynamic scoping observed
where lexical scoping is expected). They are marked `// BUG:` in the test
file.

1. **Re-declared free variable in calling scope** (section 1): `f` sees the
   calling scope's `c`, not the defining scope's `c`.
2. **Nested lambda inner captures outer param** (section 3): needs
   verification — if the inner function's free variable (outer's param)
   resolves through the eval context stack, it may work coincidentally.
3. **Lambda as Sum body with free var** (section 4): the free var may be
   auto-declared in Sum's scope (scope pollution) rather than resolved from
   outer scope.

---

## Files Involved

- **New:** `test/compute-engine/lambda-capture.test.ts`
- **Reference:** `src/compute-engine/function-utils.ts` — `makeLambda()`,
  `canonicalFunctionLiteralArguments()`
- **Reference:** `src/compute-engine/boxed-expression/boxed-function.ts:1157–1184`
  — scope push/pop during evaluation
- **Reference:** `src/compute-engine/engine-scope.ts:44–71` —
  `pushEvalContext()` (builds values from scope.bindings)
- **Reference:** `src/compute-engine/engine-expression-entrypoints.ts:103` —
  auto-declaration in current scope
- **Reference:** `src/compute-engine/library/utils.ts:348–379` —
  `canonicalBigop()` (scope pollution source)
- **Existing:** `test/compute-engine/scope.test.ts` — contains the "DYNAMIC
  SCOPING" describe block which already documents related behavior
