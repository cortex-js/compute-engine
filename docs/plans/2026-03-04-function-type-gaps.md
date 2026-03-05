# Function Type Gaps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three gaps in how function return types interact with the invisible operator, ensuring expressions like `2f'(x)` and `2g(x,y)` produce `Multiply` instead of `Tuple`.

**Architecture:** The invisible operator (`canonicalInvisibleOperator`) decides whether juxtaposed expressions should be multiplied, applied as functions, or grouped as tuples. It checks each operand's `.type` against numeric-compatible types. Three gaps exist: (1) the `expression` return type used by `D`, `Subs`, etc. doesn't match `number`, (2) multi-arg undeclared functions aren't auto-declared in the multi-operand path, and (3) the `type` handler for `D` and similar operators could return a more specific type.

**Tech Stack:** TypeScript, Jest (via `npm run test`)

---

## Background

### The type hierarchy (relevant subset)

```
any
├── expression
│   ├── value
│   │   ├── scalar (number, boolean, string)
│   │   └── collection (list, set, tuple, ...)
│   ├── function
│   └── symbol
├── unknown
└── nothing / never / error
```

Key fact: `expression` is a **supertype** of `number`. So `isSubtype('expression', 'number')` is **false**. This means `BoxedType.matches('number')` returns false for expressions of type `expression`.

### Operators returning `-> expression`

| Operator | File | Signature |
|----------|------|-----------|
| `D` | `library/calculus.ts:145` | `(expression, variable:symbol, variables:symbol+) -> expression` |
| `Annotated` | `library/core.ts:355` | `(expression, dictionary) -> expression` |
| `Text` | `library/core.ts:375` | `(any*) -> expression` |
| `Replace` | `library/core.ts:794` | `(match: expression, replace: expression, predicate: function?) -> expression` |
| `Simplify` | `library/core.ts:803` | `(any) -> expression` |
| `RandomExpression` | `library/core.ts:1457` | `() -> expression` |

Of these, `D` is the only one commonly used in mathematical expressions where multiplication is expected (e.g., `2f'(x)` → `2·D(f(x),x)`).

### The invisible operator multiplication check

In `invisible-operator.ts:187-202`, the multi-operand path checks:
```typescript
ops.every(x =>
  x.isValid &&
  (x.type.isUnknown ||
   x.type.type === 'any' ||
   x.type.matches('number') ||
   (x.isIndexedCollection && !isString(x)))
)
```

An expression of type `expression` fails all four checks:
- `isUnknown` → false (`expression` ≠ `unknown`)
- `type === 'any'` → false (`expression` ≠ `any`)
- `matches('number')` → false (`expression` is supertype of `number`, not subtype)
- `isIndexedCollection` → false

### The `D` operator's `type` handler

`D` has no `type` handler function in its definition (calculus.ts). So `BoxedFunction.type()` falls through to `functionResult(sig)` which extracts the return type from the signature string: `expression`. It could instead return a more specific type based on the argument.

---

## Gap 1: `expression` type in invisible operator multiplication check

**Problem:** Any operator returning `expression` type (D, Annotated, Simplify, etc.) produces `Tuple` instead of `Multiply` when juxtaposed with other expressions.

**Example:** `["Multiply", 2, ["D", ["f", "x"], "x"]]` — if you construct this, the type of `D(f(x),x)` is `expression`, which doesn't pass the multiplication check.

### Task 1: Add test for expression-typed operands in multiplication

**Files:**
- Test: `test/compute-engine/smoke.test.ts`

**Step 1: Write the failing test**

Add to the `CANONICALIZATION invisible operators` describe block (around line 444):

```typescript
test(`2f'(x) // invisible multiply with derivative`, () => {
  // D returns type 'expression', which should still allow multiplication
  engine.assign('f', engine.expr(['Function', ['Multiply', 'x', 2], 'x']));
  const result = canonicalToJson("2f'(x)");
  expect(result).toMatchObject(['Multiply', 2, ['D', ['f', 'x'], 'x']]);
});
```

Note: this test relies on the parser producing `D(f(x), x)` for `f'(x)`. Verify the parse output first and adjust if needed.

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/smoke`
Expected: FAIL — produces `Tuple` instead of `Multiply`

**Step 3: Add `expression` type to the multiplication check**

In `src/compute-engine/boxed-expression/invisible-operator.ts`, modify the multi-operand multiplication check (around line 187):

```typescript
if (
  ops.every(
    (x) =>
      x.isValid &&
      (x.type.isUnknown ||
        x.type.type === 'any' ||
        x.type.type === 'expression' ||
        x.type.matches('number') ||
        (x.isIndexedCollection && !isString(x)))
  )
) {
  return ce._fn('Multiply', ops);
}
```

The rationale: `expression` is a supertype that includes `number`. In a juxtaposition context (no explicit operator), treating `expression`-typed results as numeric is the safer default — the user can always use explicit `Tuple` notation if they want a tuple.

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/smoke`
Expected: PASS

**Step 5: Run full affected test suites**

Run: `npm run test compute-engine/calculus` and `npm run test compute-engine/latex-syntax/operators`
Expected: PASS (may need snapshot updates if calculus tests improve)

---

## Gap 2: Add `type` handler to `D` operator

**Problem:** `D(f(x), x)` returns type `expression` even when `f(x)` is known to be numeric. A smarter `type` handler can return a more specific type.

**Example:** If `f` has signature `(number) -> number`, then `D(f(x), x)` should also be `number`.

### Task 2: Add test for D operator return type

**Files:**
- Test: `test/compute-engine/calculus.test.ts`

**Step 1: Write the failing test**

Add a new describe block or add to an existing one:

```typescript
test('D(f(x), x) type is number when f returns number', () => {
  engine.assign('f', engine.expr(['Function', ['Multiply', 'x', 2], 'x']));
  const expr = engine.parse("f'(x)");
  // The derivative of a numeric function should be numeric
  expect(expr.type.matches('number')).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/calculus`
Expected: FAIL — `expr.type` is `expression`, `.matches('number')` is false

**Step 3: Add `type` handler to D operator**

In `src/compute-engine/library/calculus.ts`, add a `type` property to the `D` definition (after line 145):

```typescript
D: {
  description: 'Symbolic partial derivative with respect to one or more variables.',
  broadcastable: false,
  scoped: true,
  lazy: true,
  signature:
    '(expression, variable:symbol, variables:symbol+) -> expression',
  type: ([body]) => {
    // The derivative of a numeric expression is numeric
    if (body && body.type.matches('number')) return body.type;
    return undefined; // fall back to signature
  },
  canonical: (ops, { engine: ce, scope }) => {
    // ... existing code unchanged ...
```

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/calculus`
Expected: PASS

**Step 5: Run smoke tests**

Run: `npm run test compute-engine/smoke`
Expected: PASS — the `2f'(x)` test from Task 1 should also benefit from this

---

## Gap 3: Multi-arg undeclared function in multi-operand invisible operator

**Problem:** In the 2-operand path (line 62-130), when an undeclared symbol is followed by a `Delimiter` with multiple comma-separated args, the symbol is auto-declared as a function (line 107). But in the 3+ operand path (after line 148), `combineFunctionApplications` only combines symbol+Delimiter when the symbol is **already** declared as a function (line 247-249). Undeclared symbols are not auto-declared.

**Example:** `2g(x,y)` produces `["InvisibleOperator", 2, "g", ["Delimiter", ...]]` → the 3-operand path runs → `combineFunctionApplications` checks `g`'s definition → `g` is undeclared → no combination → `g` stays a plain symbol → ends up as `Tuple` (because `g` is `unknown`, Delimiter is not numeric).

### Task 3: Add test for multi-arg undeclared function in 3+ operand invisible operator

**Files:**
- Test: `test/compute-engine/latex-syntax/operators.test.ts`

**Step 1: Write the failing test**

Add to the `OPERATOR invisible` describe block (around line 160):

```typescript
test('2g(x,y) // Undeclared function with multiple args in invisible operator', () =>
  expect(check('2g(x,y)')).toMatchInlineSnapshot(`
    box       = ["InvisibleOperator", 2, "g", ["Delimiter", ["Sequence", "x", "y"], "'(,)'"]]
    canonical = ["Multiply", 2, ["g", "x", "y"]]
  `));
```

Note: the exact box form and canonical output may need adjustment after running. The point is that `g(x,y)` should be recognized as a function call (auto-declaring `g`) and multiplied by 2.

**Step 2: Run test to verify it fails**

Run: `npm run test compute-engine/latex-syntax/operators`
Expected: FAIL — produces `Tuple` instead of `Multiply`

**Step 3: Extend `combineFunctionApplications` to auto-declare undeclared symbols**

In `src/compute-engine/boxed-expression/invisible-operator.ts`, modify `combineFunctionApplications` (around line 246):

```typescript
function combineFunctionApplications(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression[] {
  const result: Expression[] = [];
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (
      i < ops.length - 1 &&
      isSymbol(op) &&
      isFunction(ops[i + 1], 'Delimiter')
    ) {
      const symName = op.symbol;
      const def = ce.lookupDefinition(symName);

      // Already declared as function/operator → function call
      if (
        def &&
        (isOperatorDef(def) || def.value?.type?.matches('function'))
      ) {
        const delim = ops[i + 1] as Expression & { op1: Expression; ops: ReadonlyArray<Expression> };
        let args: ReadonlyArray<Expression> = delim.op1
          ? isFunction(delim.op1, 'Sequence')
            ? delim.op1.ops
            : [delim.op1]
          : [];
        args = flatten(args);
        result.push(ce.function(symName, args));
        i += 2;
        continue;
      }

      // Undeclared symbol with multiple comma-separated args → auto-declare
      // as function (mirrors the 2-operand path behavior at line 106-111)
      const delim = ops[i + 1] as Expression & { op1: Expression; ops: ReadonlyArray<Expression> };
      if (delim.op1 && isFunction(delim.op1, 'Sequence')) {
        let args: ReadonlyArray<Expression> = delim.op1.ops;
        args = flatten(args);
        if (args.length > 1) {
          if (!def) ce.declare(symName, 'function');
          else if (!isOperatorDef(def) && def.value?.type?.isUnknown)
            op.canonical.infer('function');
          result.push(ce.function(symName, args));
          i += 2;
          continue;
        }
      }
    }
    result.push(ops[i]);
    i++;
  }
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test compute-engine/latex-syntax/operators`
Expected: PASS

**Step 5: Run broader test suites for regressions**

Run: `npm run test compute-engine/smoke` and `npm run test compute-engine/calculus`
Expected: PASS

---

## Gap 4 (Optional): Add `type` handlers to other `-> expression` operators

**Problem:** `Annotated`, `Simplify`, `Replace`, and `Subs` all return `expression` but could return more specific types.

This is lower priority since these operators are rarely used in juxtaposition contexts. The `expression` type fix in Task 1 already handles the invisible operator case.

### Task 4: Add type handler to Annotated

**Files:**
- Modify: `src/compute-engine/library/core.ts:355-356`

`Annotated` already has `type: ([x]) => x.type` (line 356), so it's already handled. No change needed.

### Task 5: Add type handler to Simplify

**Files:**
- Modify: `src/compute-engine/library/core.ts:800-808`

**Step 1: Add type handler**

```typescript
Simplify: {
  description: 'Simplify an expression.',
  lazy: true,
  signature: '(any) -> expression',
  type: ([x]) => x?.type ?? undefined,
  canonical: (ops, { engine: ce }) =>
    ce._fn('Simplify', checkArity(ce, ops, 1)),
  evaluate: ([x]) => x.simplify() ?? undefined,
},
```

This is very low-risk — it just says "Simplify returns the same type as its argument."

**Step 2: Run tests**

Run: `npm run test compute-engine/smoke`
Expected: PASS

---

## Summary of changes

| Task | File | Change | Risk |
|------|------|--------|------|
| 1 | `invisible-operator.ts:~188` | Add `x.type.type === 'expression'` to multiplication check | Low — broadens what counts as multiplicable |
| 2 | `calculus.ts:~146` | Add `type` handler to `D` operator | Low — only narrows return type |
| 3 | `invisible-operator.ts:combineFunctionApplications` | Auto-declare undeclared symbols with multi-arg delimiters | Medium — mirrors existing 2-operand behavior |
| 4 | `core.ts` (Annotated) | Already handled | None |
| 5 | `core.ts` (Simplify) | Add `type` handler | Low |

## Test commands

```bash
# Individual suites
npm run test compute-engine/smoke
npm run test compute-engine/calculus
npm run test compute-engine/latex-syntax/operators

# Full regression
npm run test compute-engine/canonical-form
npm run test compute-engine/functions
npm run test compute-engine/scope
```
