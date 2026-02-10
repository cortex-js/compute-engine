# FIXME Tracking Document

This document tracks known issues, bugs, and technical debt in the Compute
Engine codebase, organized by impact level.

---

## Priority 1: Correctness Issues (May Produce Wrong Results)

## Priority 2: Missing Functionality

## Priority 3: Code Quality & Maintainability

### 1. Compilation Fallback Doesn't Handle Multiple Arguments

**File**: `src/compute-engine/compilation/compile-expression.ts:64` **Issue**:
Fallback compilation path incomplete for multi-argument functions

```typescript
} catch (e) {
  // @fixme: the fallback needs to handle multiple arguments
  if (options?.fallback ?? true) {
    console.warn(`Compilation fallback for "${expr.operator}": ${(e as Error).message}`);
    return {
      // ... fallback implementation
```

**Analysis**:

- When compilation fails, system falls back to JavaScript evaluation
- Fallback currently only handles single-argument case properly
- Multi-argument functions may fail or produce incorrect compiled code
- Affects performance for functions that fail to compile natively

**Example Issue**:

```javascript
// Function with 3 arguments fails to compile to GLSL/JavaScript
// Fallback should properly map all 3 arguments, currently may not
```

**Recommended Action**:

1. Implement proper argument mapping in fallback code generator
2. Add tests for compilation fallback with 0, 1, 2, 3+ arguments
3. Consider warning user when fallback is used (performance impact)
4. Document which operations can't be compiled natively

**Impact**: LOW - Only affects compilation fallback path

---

### 2. Collection Type Validation Warning Disabled

**File**: `src/compute-engine/boxed-expression/boxed-operator-definition.ts:300`
**Issue**: Useful validation check commented out due to type system limitations

```typescript
// @fixme: this warning cannot reliably be checked, because some functions
// (Map, Filter) return an indexed collection if the input is indexed.
// Would need support for type arguments in signatures.
// if (!isSubtype(resultType, 'indexed_collection') && this.collection.at) {
//   throw new Error(
//     `Operator Definition "${this.name}" returns a non-indexed collection,
//      but the 'at' handler is defined`
//   );
```

**Analysis**:

- Validation would catch mismatched collection handlers (e.g., `at` handler on
  non-indexed collection)
- Can't be enabled because type system doesn't support generic type parameters
- Functions like `Map` and `Filter` preserve collection type structure from
  input
- Need dependent typing: `Map(f, list<T>)` → `list<U>` vs. `Map(f, indexed<T>)`
  → `indexed<U>`

**Current Limitation**:

```typescript
// Can't express: "if input is indexed_collection, output is indexed_collection"
// Signature: (any, collection<T>) -> collection<U>
// Need: (any, indexed<T>) -> indexed<U> OR (any, list<T>) -> list<U>
```

**Recommended Action**:

1. Add generic type parameters to function signatures
2. Implement dependent typing or conditional types
3. Re-enable validation once type system supports it
4. Document this limitation in type system docs

**Impact**: LOW - Validation gap but no runtime issues

---

## Priority 4: Optimization & Future Enhancements

### 3. Missing Step Range Syntax in Summations

**File**:
`src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts:1480`
**Issue**: Step ranges like `i=1..3..10` (start..step..end) not supported

```typescript
// @todo: we currently do not support step range, i.e. `i=1..3..10`.
// The step is the third argument of Range. We should extend the indexing
// set to include step-range and collections, i.e. i={1,2,3,4}
```

**Analysis**:

- Summation and product indexing limited to unit step: `∑_{i=1}^{10}`
- Can't express: `∑_{i=1,3,5,7,9}` or `∑_{i=1..2..10}` (step by 2)
- Collection-based indexing also missing: `∑_{i ∈ {1,2,5,7}}`
- Common mathematical notation that users expect

**Use Cases**:

- Sum odd numbers: `∑_{i=1..2..99}`
- Sum over specific set: `∑_{i ∈ {2,3,5,7,11}}`
- Product of every 3rd term: `∏_{i=0..3..30}`

**Recommended Action**:

1. Extend Range syntax to accept step parameter
2. Support collection-based indexing sets
3. Update parser to handle `..` and collection syntax
4. Add tests for various step and collection combinations

**Impact**: LOW - Enhancement request, workarounds exist

---

### 4. \max/\min with subscripts — Expressions like \max\_{x \in S} f(x) are common

- \max/\min with subscripts — Expressions like \max\_{x \in S} f(x) are common
  in math but involve subscript handling that's a separate parsing concern.
