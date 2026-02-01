# Stack Overflow Fix and Follow-up Improvements

This document summarizes the fixes and improvements made to address the stack
overflow bug and related issues discovered on 2026-02-01.

## Original Problem

Running `npm t` produced errors:

1. **Stack Overflow**: `RangeError: Maximum call stack size exceeded` when
   testing equality expressions like `x=1`
2. **Incorrect `isEqual()` behavior**: `x.isEqual(0)` returned `false` instead
   of `undefined`
3. **Missing Element validation**: Invalid `Element` expressions weren't
   generating error messages
4. **Type checking issues**: Element was treating invalid type names like
   "Booleans" as valid

## Root Cause Analysis

### The Recursion Loop

The stack overflow was caused by an infinite recursion cycle:

```
eq(x, 0) → ask(['NotEqual', x, 0]) → verify(['NotEqual', x, 0]) →
NotEqual.evaluate() → eq(x, 0) → ask(['NotEqual', x, 0]) → ...
```

This cycle was introduced in commit `c66fb5b8` which added `verify()`
functionality to `ask()` as a fallback for closed predicates.

### The Logic Error

`Equal` and `NotEqual` operators were treating "can't prove" as a definitive
answer:

- `Equal(x, 1).evaluate()` should return `False` when x is unknown (can't prove
  it's true)
- But in verification mode, it should return `undefined` to preserve 3-valued
  logic
- The operators weren't distinguishing between these two contexts

## Solutions Implemented

### 1. Recursion Prevention

**Files Modified:**

- `src/compute-engine/index.ts`
- `src/compute-engine/library/relational-operator.ts`
- `src/compute-engine/global-types.ts`

**Implementation:**

- Added `_isVerifying` flag to `ComputeEngine` to track when we're inside a
  `verify()` call
- `verify()` sets this flag to `true` on entry, `false` on exit (with
  try/finally)
- `ask()` checks this flag and skips the `verify()` fallback when `true`
- Equal/NotEqual evaluate handlers check this flag to return appropriate values

**Key Code:**

```typescript
// In index.ts
private _isVerifying: boolean = false;

verify(query: BoxedExpression): boolean | undefined {
  if (this._isVerifying) return undefined;
  this._isVerifying = true;
  try {
    // ... verification logic ...
  } finally {
    this._isVerifying = false;
  }
}

// In ask()
if (result.length === 0 && !patternHasWildcards(pat) && !this._isVerifying) {
  const verified = this.verify(this.box(pattern, { canonical: true }));
  if (verified === true) pushResult({});
}

// In Equal.evaluate()
if (test === undefined && ce.isVerifying) return undefined;
if (test === undefined) return ce.False;
```

### 2. Element Validation

**File Modified:**

- `src/compute-engine/library/sets.ts`

**Implementation:**

- Added explicit validation in the `Element` canonical handler
- Missing required arguments now generate `ce.error('missing')` expressions
- Invalid collection types generate `ce.error(['incompatible-type', ...])`
  expressions
- Optional third argument (condition) is validated as boolean type

**Example:**

```typescript
if (args.length === 0) {
  return ce._fn('Element', [ce.error('missing'), ce.error('missing')]);
}
if (args.length === 1) {
  return ce._fn('Element', [args[0].canonical, ce.error('missing')]);
}
```

### 3. Type-Safe Element Checking

**File Modified:**

- `src/compute-engine/library/sets.ts`

**Implementation:**

- Wrapped type parsing in try-catch to handle invalid type names gracefully
- Invalid type names (like "Booleans") now remain unevaluated instead of
  throwing errors
- Valid mathematical types and type names are properly checked

## Follow-up Improvements

### 1. Regression Tests Added

**File:** `test/compute-engine/verify.test.ts`

Added tests for:

- Stack overflow prevention for Equal/NotEqual
- 3-valued logic in verification mode vs. direct evaluation
- Less/Greater/LessEqual/GreaterEqual stack overflow prevention
- Symbolic equality behavior (x vs y, x vs x)

### 2. Documentation Added

**Files Created/Modified:**

- `FUNCTION-VALIDATION.md` - Guidelines for implementing proper validation in
  custom canonical handlers
- `RECURSION-FIX-SUMMARY.md` - This document

**Comments Added:**

- Comprehensive documentation in `index.ts` explaining the `_isVerifying` flag
  and recursion prevention
- Comments in `ask()` explaining why the flag check is necessary
- Comments in Equal/NotEqual explaining the dual-mode behavior
- Enhanced Element function description explaining type-style membership

### 3. Relational Operators Review

**Findings:**

- Less/Greater/LessEqual/GreaterEqual do NOT have the same recursion issue
- They use `cmp()` which doesn't call `ask()` or `verify()`
- They correctly return `undefined` for unknown comparisons
- Unlike Equal/NotEqual, they maintain consistent behavior in both modes

**Tests Added:**

- Verified no stack overflow for inequality operators
- Documented that they use different comparison logic than Equal/NotEqual

### 4. Type System Consistency

**File:** `test/compute-engine/set.test.ts`

Added comprehensive tests for:

- Element with mathematical sets (Integers, RealNumbers, etc.)
- Element with type names (integer, real, finite_real, etc.)
- Element with invalid type names (Booleans, IntegerZ, etc.)
- Element with symbolic values (checking declared types)
- Distinction between sets and primitive types

### 5. Validation Pattern Documentation

**File:** `FUNCTION-VALIDATION.md`

Documents:

- When and how to validate arguments in custom canonical handlers
- Patterns for required vs. optional arguments
- Type validation best practices
- Helper functions available (checkType, checkTypes, ce.error)
- Examples from Element and Rational functions
- Common pitfalls to avoid

## Testing

All tests pass:

- `npm run test compute-engine/verify` ✓
- `npm run test compute-engine/set` ✓
- `npm run test compute-engine/expression-properties` ✓
- `npm run test compute-engine/latex-syntax/operators` ✓
- `npm t` (full suite) ✓

## Behavioral Changes

### Before

1. `Equal(x, 1).evaluate()` → unevaluated `["Equal", "x", 1]`
2. `verify(Equal(x, 0))` → stack overflow
3. `x.isEqual(0)` → `false` (incorrect)
4. `Element()` → `["Element"]` (no validation errors)
5. `Element(2, 'Booleans')` → type parsing error

### After

1. `Equal(x, 1).evaluate()` → `False` (can't prove it's true)
2. `verify(Equal(x, 0))` → `undefined` (no recursion)
3. `x.isEqual(0)` → `undefined` (correct)
4. `Element()` → `["Element", ["Error", "'missing'"], ["Error", "'missing'"]]`
5. `Element(2, 'Booleans')` → `["Element", 2, "Booleans"]` (unevaluated, no
   error)

## Performance Impact

The recursion prevention adds minimal overhead:

- One boolean flag check in `ask()` before calling `verify()`
- One boolean flag check in Equal/NotEqual evaluate handlers
- Try/finally block in `verify()` (negligible cost)

No performance degradation expected in normal operation.

## Future Considerations

1. **Consider extending validation to other functions** - Many functions with
   custom canonical handlers could benefit from explicit validation
2. **Monitor for similar recursion patterns** - The eq() → ask() → verify()
   pattern might exist elsewhere
3. **Document the verification vs. evaluation distinction** - This dual-mode
   behavior might be confusing and deserves clear documentation
4. **Type system improvements** - Consider making more refined types available
   (e.g., positive_integer, nonnegative_integer)

## Related Files

### Core Fix

- `src/compute-engine/index.ts` (verify, ask, \_isVerifying flag)
- `src/compute-engine/library/relational-operator.ts` (Equal, NotEqual)
- `src/compute-engine/boxed-expression/compare.ts` (eq function)
- `src/compute-engine/library/sets.ts` (Element validation and type checking)
- `src/compute-engine/global-types.ts` (isVerifying interface addition)

### Tests

- `test/compute-engine/verify.test.ts` (regression tests)
- `test/compute-engine/set.test.ts` (Element type checking tests)
- `test/compute-engine/expression-properties.test.ts` (isEqual tests)
- `test/compute-engine/latex-syntax/operators.test.ts` (operator evaluation
  tests)

### Documentation

- `FUNCTION-VALIDATION.md` (validation guidelines)
- `RECURSION-FIX-SUMMARY.md` (this document)

## Credits

Issue discovered and fixed: 2026-02-01 Commits: 18ad2d5d, f1aa9940, 6ba3bcae,
c66fb5b8 (original verify implementation)
