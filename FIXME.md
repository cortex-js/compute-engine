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

---

## Priority 5: Test Debt & Identified Gaps (Inventory from `todo` comments)

### 1. Simplification & Arithmetic Rules
- **Rational Expressions**: Implement common denominator rules for additions like `1/(x+1) - 1/x = -1/(x^2+x)` (`simplify-noskip.test.ts`).
- **Logarithmic Rules**: Correct canonicalization order to allow log rules to fire before expansion (e.g., `ln((x+1)/e^{2x})`) (`simplify-noskip.test.ts`).
- **Inverse Hyperbolic/Trigonometric**: Add rules for converting logarithms to inverse hyperbolic functions and inverse trig conversions (e.g., `arctan(x/sqrt(1-x^2)) = arcsin(x)`).
- **Factor Extraction**: Improve `factor()` to extract common factors from `Add` expressions like `(2pi + 2pi*e)`.

### 2. Equation Solving
- **Systems of Equations**: Enable solving systems with symbolic coefficients (e.g., `ax + by = c`).
- **Inequalities**: Fully implement and test solving for linear inequalities (e.g., `2x + 1 < 5`).
- **Sqrt Patterns**: Complete edge cases for Sqrt-linear, Two-sqrt terms, and Nested sqrt patterns referenced in `solve.test.ts` and `TODO #15`.

### 3. Latex Syntax & Set Notation
- **Infinite Sets**: Support parsing and serializing set notation with ellipses (e.g., `\{1, 2, 3...\}`, `\{...-2, -1, 0\}`).
- **Serialization**: Address remaining edge cases in LaTeX serialization noted in `serialize.test.ts`.

### 4. Cortex Language Features
- **Indexed Access & Sets**: Implement support for indexed access (e.g., `a[i]`) and set membership validation in Cortex tests.

### 5. Pattern Matching
- **Wildcards**: Extend support for repeated wildcards in deeply nested contexts (TODO #3) and repeated-match cases.
- **Auto-wildcarding**: Verify if `.replace()` still incorrectly auto-wildcards single-char symbols (Regression check for TODO #23).

### 6. Performance & Benchmarking
- **Precision**: Extend Wester benchmarks to support precision 50.
- **Notation**: Verify consistency for scientific vs. engineering notation in `toLatex()`.

### 7. Unicode & Normalization
- **Normalization**: Add tests for non-NFC normalized Unicode characters (e.g., `café` vs. `café`) to `dictionary.test.ts`.

### 8. Calculus & Special Functions
- **Integration**: Implement additional integration patterns identified in `calculus.test.ts`.
- **Signatures**: Add tests for special functions type signatures (Issue #1).

### 9. Ambiguous / Unclear
- **Empty TODOs**: `patterns.test.ts:625` contains an empty `//@todo`.
- **General Revisit**: `cortex-parse.test.ts:234` and `playground.ts:66` require general logic reviews.

