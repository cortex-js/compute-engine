# Scope Pollution in Scoped Functions (Sum, Product, etc.)

## Summary

During canonicalization of scoped functions like `Sum` and `Product`, the local
scope's `bindings` map gets polluted with symbols that are not actually bound by
the scoping construct. Free variables like upper bounds and body variables end up
declared in the Sum's scope instead of the global scope.

This is currently **cosmetic** — `getUnknowns` works correctly by extracting
bound variables structurally (from `Limits`/`Element`/`Assign`/`Declare`
patterns) rather than relying on `localScope.bindings`. However, the pollution
is confusing for debugging and represents incorrect scoping semantics.

## The Problem

```ts
const expr = ce.parse('\\sum_{k=0}^{M} k \\cdot x');
[...expr.localScope.bindings.keys()]
// Actual:   ['k', 'M', 'x']
// Expected: ['k']
```

Only `k` (the index variable) should be in the Sum's scope. `M` (the symbolic
upper bound) and `x` (a free variable in the body) are polluting it.

## Root Cause

### Auto-Declaration Mechanism

When a symbol is first encountered during canonicalization, `createSymbolExpression`
(`engine-expression-entrypoints.ts:71-116`) checks if it has an existing definition:

```
createSymbolExpression(engine, ..., 'x')
  → engine.lookupDefinition('x')     // walks scope chain
  → not found in any scope
  → engine._declareSymbolValue('x', { type: 'unknown', inferred: true })
      → defaults to ce.context.lexicalScope  (the CURRENT innermost scope)
      → scope.bindings.set('x', ...)
```

### How It Triggers in BigOps

In `canonicalBigop` (`library/utils.ts:349-380`):

```ts
ce.pushScope(scope);           // (1) Push the Sum's scope
try {
  indexes = indexingSets.map(  // (2) Canonicalize bounds — declares k,
    canonicalIndexingSet       //     but also auto-declares M in Sum scope
  );
  body = body?.canonical;      // (3) Canonicalize body — auto-declares x
} finally {                    //     in Sum scope
  ce.popScope();
}
```

At step (1), the current scope is the Sum's scope. At steps (2) and (3), any
symbol not found in the scope chain gets auto-declared in the Sum's scope via
`_declareSymbolValue`, which defaults to `ce.context.lexicalScope`.

## Why the "Obvious" Fix Doesn't Work

The natural fix is to auto-declare unknown symbols in the **global scope**
instead of the current scope:

```ts
// In createSymbolExpression, line 103:
let globalScope = engine.context.lexicalScope;
while (globalScope.parent?.parent) globalScope = globalScope.parent;
def = engine._declareSymbolValue(name, { type: 'unknown', inferred: true }, globalScope);
```

This was attempted and **causes 14 test failures** in Sum/Product simplification.

### The Circular Dependency

Two mechanisms are coupled through `scope.bindings`:

1. **Auto-declaration** writes symbols into `scope.bindings` during
   canonicalization.

2. **Value isolation during evaluation** reads `scope.bindings` to build the
   eval context's `values` map. When `reduceBigOp` iterates `k=0,1,...,n` via
   `ce.assign('k', value)`, the assignment is routed to whichever eval context
   frame has `k` in its `values` map.

The coupling:

```
pushEvalContext(scope)                     // engine-scope.ts:44-71
  → builds values = {} from scope.bindings
  → for (const [id, def] of scope.bindings.entries())
  →   if (isValueDef(def) && !def.value.isConstant) values[id] = def.value.value;

setSymbolValue(ce, 'k', 5)                // engine-declarations.ts:109-140
  → walks eval context stack from top to bottom
  → finds first frame where 'k' in values
  → sets value there
```

Before the fix:
- Sum's scope has `{k, x, b}` in bindings
- Sum's eval context has `{k: undefined, x: undefined, b: undefined}` in values
- `ce.assign('k', 5)` → finds `k` in Sum's eval context → writes there
- After popScope, the value is contained

After the fix:
- Sum's scope has only `{k}` in bindings
- But `k` was ALSO auto-declared in the global scope (from a prior test
  expression that used `k`)
- Global eval context has `{k: undefined}` in values
- Sum's eval context has `{k: undefined}` in values
- `ce.assign('k', 5)` → finds `k` in Sum's eval context (top of stack) → OK

This part actually works. The real failure mode is more subtle:

When an **evaluate** test runs `Sum(Binomial(5, k), Limits(k, 0, 5)).evaluate()`
before a **simplify** test, the evaluation assigns `k=0,1,...,5`. The last value
(`k=5`) persists on the **definition object** itself (via `BoxedValueDefinition`),
not just in the eval context values map. When the definition lives in the global
scope (after the fix), this stale value affects subsequent simplification of
expressions that reference `k`.

Before the fix, the stale value was on a definition in a Sum-local scope, which
is inaccessible to later expressions. The pollution was actually **protecting**
against value leakage by keeping symbols in isolated scopes.

## Potential Fix Approaches

### Approach A: Save/Restore in `reduceBigOp`

Have `reduceBigOp` save and restore the index variable's value around the
iteration loop, rather than relying on scope isolation:

```ts
// In reduceBigOp, before iteration:
const savedValue = ce._getSymbolValue(indexName);
try {
  for (const element of cartesianArray) {
    ce.assign(indexName, element);
    result = fn(result, body);
  }
} finally {
  // Restore previous value (or clear it)
  ce._setSymbolValue(indexName, savedValue);
}
```

**Pros:** Minimal change, directly addresses value leakage.
**Cons:** Still leaves the scope polluted; only fixes the symptom.

### Approach B: Use `setCurrentContextValue` Instead of `ce.assign`

`reduceBigOp` currently uses `ce.assign('k', value)` which walks the full scope
chain. Instead, it could use `setCurrentContextValue` which writes only to the
current (topmost) eval context frame:

```ts
// Instead of:  ce.assign(x.index!, element[i])
// Use:         ce.setCurrentContextValue(x.index!, element[i])
```

**Pros:** Values never escape the current eval context.
**Cons:** May not work if the body's symbols resolve through definitions that
expect the value on the definition object rather than the eval context.

### Approach C: Separate Scope Bindings from Eval Context Values

Decouple the two uses of `scope.bindings`:

1. A `declarations` set that tracks which symbols were **explicitly declared**
   in the scope (via `ce.declare`)
2. A `references` set that tracks all symbols **referenced** during
   canonicalization (the current auto-declaration behavior)

Only `declarations` would be used to build the eval context's `values` map.

```ts
type Scope<Binding = unknown> = {
  parent: Scope<Binding> | null;
  bindings: Map<string, Binding>;       // explicit declarations only
  autoDeclarations?: Set<string>;       // auto-declared symbols (for debugging)
};
```

**Pros:** Clean separation of concerns; fixes both pollution and value leakage.
**Cons:** Larger refactor; need to audit all code that reads `scope.bindings`.

### Approach D: Auto-Declare in Global + Fix Value Leakage

Combine the global-scope auto-declaration fix with Approach A or B to prevent
value leakage:

1. Auto-declare unknown symbols in the global scope (the reverted fix)
2. Fix `reduceBigOp` to not leak values (Approach A or B)

**Pros:** Correct scoping semantics + correct value isolation.
**Cons:** Two changes needed; both touching core infrastructure.

## Recommendation

**Approach D** (global auto-declaration + save/restore in `reduceBigOp`) is the
cleanest path. It addresses both the symptom (value leakage) and the root cause
(incorrect auto-declaration scope). Approach A alone would be a reasonable
incremental step.

## Current Workaround

`getUnknowns` extracts bound variables **structurally** from `Limits`, `Element`,
`Assign`, and `Declare` expressions in the scoped function's operands, rather
than using `localScope.bindings`. This makes `unknowns` and `freeVariables`
correct despite the pollution.

## Files Involved

- `src/compute-engine/engine-expression-entrypoints.ts` — `createSymbolExpression` (auto-declaration, line 103)
- `src/compute-engine/engine-declarations.ts` — `declareSymbolValue` (writes to scope.bindings, line 47), `setSymbolValue` (walks eval context stack, line 122)
- `src/compute-engine/engine-scope.ts` — `pushEvalContext` (builds values from scope.bindings, line 60)
- `src/compute-engine/library/utils.ts` — `canonicalBigop` (pushes scope, line 358), `reduceBigOp` (assigns index variable, line 488)
- `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` — `getUnknowns` (structural extraction workaround, line 855)
