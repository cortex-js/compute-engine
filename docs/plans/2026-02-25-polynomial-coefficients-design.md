# Design: `polynomialCoefficients()` on BoxedExpression

## Goal

Surface the internal polynomial coefficient extraction as a public method on
`BoxedExpression`. This single method subsumes `isPolynomial` (check
`!== undefined`) and `polynomialDegree` (result length - 1).

## Method Signature

```typescript
polynomialCoefficients(variable?: string): ReadonlyArray<BoxedExpression> | undefined
```

## Behavior

Returns coefficients in **descending** order (highest degree first). Returns
`undefined` if the expression is not a polynomial in the given variable.

```typescript
ce.parse('x^2 + 5').polynomialCoefficients('x')       // [1, 0, 5]
ce.parse('3x^3 - x + 7').polynomialCoefficients('x')  // [3, 0, -1, 7]
ce.parse('sin(x)').polynomialCoefficients('x')         // undefined
ce.parse('ax^2 + bx + c').polynomialCoefficients('x')  // [a, b, c]
```

## Variable Auto-Detection

When `variable` is omitted: if the expression has exactly one unknown, use it.
Otherwise return `undefined`.

```typescript
ce.parse('x^2 + 5').polynomialCoefficients()   // [1, 0, 5] — auto-detects x
ce.parse('x*y + 1').polynomialCoefficients()    // undefined — ambiguous
ce.parse('42').polynomialCoefficients()          // undefined — no unknowns
```

## Derived Checks

```typescript
// isPolynomial
const isPolynomial = expr.polynomialCoefficients('x') !== undefined;

// degree
const coeffs = expr.polynomialCoefficients('x');
const degree = coeffs ? coeffs.length - 1 : undefined;
```

## CAS Side: Update CoefficientList

Update the existing `CoefficientList` CAS function to use descending order for
consistency with the JS API. This is a breaking change but aligns conventions.

## Implementation Notes

- Reuse internal `getPolynomialCoefficients()` and reverse the result
- Add default implementation in `abstract-boxed-expression.ts` (returns
  `undefined`)
- Override in `boxed-function.ts` with actual logic
- Auto-detection uses the existing `.unknowns` property
- Return type is `ReadonlyArray<BoxedExpression>` (coefficients can be symbolic)
