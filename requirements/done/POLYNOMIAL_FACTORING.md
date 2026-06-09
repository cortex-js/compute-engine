# Polynomial Factoring Implementation (#33)

This document summarizes the polynomial factoring implementation for issue #33 and issue #180.

## Overview

Implemented polynomial factoring algorithms to enable simplification of expressions like `sqrt(x²+2x+1)` → `|x+1|`.

## Features Implemented

### 1. Perfect Square Trinomial Factoring

Detects and factors patterns like:
- `a² + 2ab + b²` → `(a+b)²`
- `a² - 2ab + b²` → `(a-b)²`

Examples:
```typescript
sqrt(x² + 2x + 1)    → |x+1|
sqrt(x² - 2x + 1)    → |x-1|
sqrt(4x² + 12x + 9)  → |2x+3|
sqrt(a² + 2ab + b²)  → |a+b|
```

### 2. Difference of Squares Factoring

Detects and factors patterns like:
- `a² - b²` → `(a-b)(a+b)`

Examples:
```typescript
x² - 4               → (x-2)(x+2)
4x² - 9              → (2x-3)(2x+3)
```

### 3. Quadratic Factoring with Rational Roots

Factors quadratics using the quadratic formula when roots are rational:
- `ax² + bx + c` → `a(x - r₁)(x - r₂)`

Examples:
```typescript
x² + 5x + 6          → (x+2)(x+3)
x² - 5x + 6          → (x-2)(x-3)
```

Note: Quadratics with irrational roots (like `x² + 2x - 1`) are not factored.

## Integration with sqrt Simplification

The factoring is automatically applied when simplifying square root expressions. Before applying the `sqrt(x²) → |x|` rule, the system now tries to factor the argument:

```typescript
// Before factoring implementation:
sqrt(x² + 2x + 1)    → sqrt(x² + 2x + 1)  // No simplification

// After factoring implementation:
sqrt(x² + 2x + 1)    → |x+1|              // Factors to (x+1)², then applies sqrt rule
```

This fixes issue #180.

## API

### Exported Functions

```typescript
import {
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
} from '@cortex-js/compute-engine';

// Factor perfect square trinomials
factorPerfectSquare(expr: BoxedExpression): BoxedExpression | null

// Factor difference of squares
factorDifferenceOfSquares(expr: BoxedExpression): BoxedExpression | null

// Factor quadratics with rational roots
factorQuadratic(expr: BoxedExpression, variable: string): BoxedExpression | null

// General polynomial factoring (tries all strategies)
factorPolynomial(expr: BoxedExpression, variable?: string): BoxedExpression
```

### Usage Examples

```typescript
const ce = new ComputeEngine();

// Automatic factoring in sqrt simplification
const expr1 = ce.parse('\\sqrt{x^2 + 2x + 1}').simplify();
console.log(expr1.latex);  // \vert x+1\vert

// Manual factoring
import { factorPerfectSquare } from '@cortex-js/compute-engine';

const expr2 = ce.parse('x^2 + 2x + 1');
const factored = factorPerfectSquare(expr2);
console.log(factored?.latex);  // (x+1)^2
```

## Implementation Details

### Files Modified

1. **src/compute-engine/boxed-expression/factor.ts**
   - Added `factorPerfectSquare()` - detects perfect square trinomials
   - Added `factorDifferenceOfSquares()` - detects difference of squares
   - Added `factorQuadratic()` - factors using quadratic formula for rational roots
   - Added `factorPolynomial()` - general factoring dispatcher
   - Added `extractSquareRoot()` - helper to extract square roots safely

2. **src/compute-engine/symbolic/simplify-power.ts**
   - Integrated factoring into sqrt simplification
   - Added perfect square and difference of squares checks before applying sqrt rules

3. **src/compute-engine/index.ts**
   - Exported new factoring functions for public API

### Key Implementation Considerations

1. **No .simplify() calls in factoring functions**
   - To avoid infinite recursion, factoring functions don't call `.simplify()` on their results
   - However, `.simplify()` is called on individual square roots during extraction, which is safe
   - See CLAUDE.md section "Simplification and Recursion Prevention" for details

2. **Handling different representations**
   - `4x²` is represented as `Multiply(4, Power(x, 2))`, not `Power(2x, 2)`
   - The implementation uses `.sqrt().simplify()` to extract square roots properly
   - Handles both symbolic (√x²) and numeric (√4) perfect squares

3. **Irrational root filtering**
   - Quadratic factoring checks for radical components in discriminant and roots
   - Uses `numericValue.radical` property to detect irrational square roots
   - Only factors when roots are provably rational

## Tests

Comprehensive test suite in `test/compute-engine/factor.test.ts`:
- Perfect square trinomial tests (6 tests)
- Difference of squares tests (6 tests)
- Quadratic factoring tests (8 tests)
- General polynomial factoring tests (4 tests)
- Integration with sqrt simplification (8 tests)
- Issue #180 regression tests (3 tests)

All tests passing ✓

## Performance

The factoring algorithms are O(1) for checking patterns:
- Perfect square: O(1) - checks 3 terms
- Difference of squares: O(1) - checks 2 terms
- Quadratic factoring: O(1) - quadratic formula

The algorithms are called during simplification only when needed (sqrt of Add expressions).

## Future Enhancements

Potential improvements not yet implemented:
1. Higher-degree polynomial factoring (cubic, quartic)
2. Factoring over different domains (complex numbers, modular arithmetic)
3. Multivariate polynomial factoring
4. Kronecker's method for general factorization

## Related Issues

- Issue #180: "Factoring before trying to simplify" ✓ Fixed
- Issue #33: "Polynomial Factoring" ✓ Implemented
