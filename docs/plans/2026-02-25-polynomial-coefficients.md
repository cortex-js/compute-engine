# `polynomialCoefficients()` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `polynomialCoefficients(variable?)` method to `BoxedExpression` that returns descending-order coefficients (or `undefined` if not a polynomial), and update the CAS `CoefficientList` to match.

**Architecture:** Add the method signature to the `Expression` interface in `types-expression.ts`, provide a default `undefined` return in `abstract-boxed-expression.ts`, and implement in `boxed-function.ts` by delegating to the existing internal `getPolynomialCoefficients()` + reversing. Update `CoefficientList` in `library/polynomials.ts` to reverse its output. Update existing snapshot tests.

**Tech Stack:** TypeScript, Jest (snapshot tests)

---

### Task 1: Write Tests for `polynomialCoefficients`

**Files:**
- Create: `test/compute-engine/polynomial-coefficients.test.ts`

**Step 1: Write tests**

```typescript
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('polynomialCoefficients', () => {
  // Basic polynomials — descending order
  test('constant', () => {
    const coeffs = ce.parse('5').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([5]);
  });

  test('linear', () => {
    const coeffs = ce.parse('3x + 1').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([3, 1]);
  });

  test('quadratic', () => {
    const coeffs = ce.parse('x^2 + 2x + 1').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([1, 2, 1]);
  });

  test('cubic with missing term', () => {
    const coeffs = ce.parse('x^3 + 2x + 1').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([1, 0, 2, 1]);
  });

  test('symbolic coefficients', () => {
    const coeffs = ce.parse('ax^2 + bx + c').polynomialCoefficients('x');
    expect(coeffs).not.toBeUndefined();
    expect(coeffs?.length).toBe(3);
    // Highest degree first: a, b, c
    expect(coeffs?.[0].json).toEqual('a');
    expect(coeffs?.[1].json).toEqual('b');
    expect(coeffs?.[2].json).toEqual('c');
  });

  // Not a polynomial
  test('sin(x) returns undefined', () => {
    expect(ce.parse('\\sin(x)').polynomialCoefficients('x')).toBeUndefined();
  });

  test('1/x returns undefined', () => {
    expect(ce.parse('\\frac{1}{x}').polynomialCoefficients('x')).toBeUndefined();
  });

  // Variable auto-detection
  test('auto-detects single unknown', () => {
    const coeffs = ce.parse('x^2 + 5').polynomialCoefficients();
    expect(coeffs?.map((c) => c.json)).toEqual([1, 0, 5]);
  });

  test('auto-detect: ambiguous (two unknowns) returns undefined', () => {
    expect(ce.parse('x*y + 1').polynomialCoefficients()).toBeUndefined();
  });

  test('auto-detect: no unknowns returns undefined', () => {
    expect(ce.parse('42').polynomialCoefficients()).toBeUndefined();
  });

  // Degree derivation
  test('degree is length - 1', () => {
    const coeffs = ce.parse('x^3 + 2x + 1').polynomialCoefficients('x');
    expect(coeffs!.length - 1).toBe(3);
  });

  // Non-function expressions
  test('plain symbol', () => {
    const coeffs = ce.parse('x').polynomialCoefficients('x');
    expect(coeffs?.map((c) => c.json)).toEqual([1, 0]);
  });

  test('number returns undefined without variable', () => {
    expect(ce.parse('5').polynomialCoefficients()).toBeUndefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test compute-engine/polynomial-coefficients`
Expected: FAIL — `polynomialCoefficients is not a function`

---

### Task 2: Add Type Signature

**Files:**
- Modify: `src/compute-engine/types-expression.ts:1082` (after `factors()`)

**Step 1: Add method to Expression interface**

After the `factors()` declaration (line 1082), add:

```typescript
  /**
   * Return the coefficients of this expression as a polynomial in `variable`,
   * in descending order of degree. Returns `undefined` if the expression is
   * not a polynomial in the given variable.
   *
   * If `variable` is omitted, auto-detects when the expression has exactly
   * one unknown. Returns `undefined` if there are zero or multiple unknowns.
   *
   * ```typescript
   * ce.parse('x^2 + 2x + 1').polynomialCoefficients('x')  // [1, 2, 1]
   * ce.parse('x^3 + 2x + 1').polynomialCoefficients('x')  // [1, 0, 2, 1]
   * ce.parse('sin(x)').polynomialCoefficients('x')          // undefined
   * ce.parse('x^2 + 5').polynomialCoefficients()            // [1, 0, 5]
   * ```
   *
   * Subsumes `isPolynomial`:
   * ```typescript
   * const isPolynomial = expr.polynomialCoefficients('x') !== undefined;
   * ```
   *
   * Subsumes `polynomialDegree`:
   * ```typescript
   * const degree = expr.polynomialCoefficients('x')?.length - 1;
   * ```
   */
  polynomialCoefficients(
    variable?: string
  ): ReadonlyArray<Expression> | undefined;
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Errors in `abstract-boxed-expression.ts` (missing implementation)

---

### Task 3: Implement on BoxedExpression

**Files:**
- Modify: `src/compute-engine/boxed-expression/abstract-boxed-expression.ts:504` (after `factors()`)
- Modify: `src/compute-engine/boxed-expression/boxed-function.ts:640` (after `factors()`)

**Step 1: Add default in abstract base class**

In `abstract-boxed-expression.ts`, after the `factors()` method (line 504), add:

```typescript
  polynomialCoefficients(
    variable?: string
  ): ReadonlyArray<Expression> | undefined {
    return undefined;
  }
```

**Step 2: Add override in boxed-function.ts**

In `boxed-function.ts`, after the `factors()` method (line 640), add:

```typescript
  polynomialCoefficients(
    variable?: string
  ): ReadonlyArray<Expression> | undefined {
    // Auto-detect variable if not provided
    if (variable === undefined) {
      const unknowns = this.unknowns;
      if (unknowns.length !== 1) return undefined;
      variable = unknowns[0];
    }

    const coeffs = getPolynomialCoefficients(this, variable);
    if (coeffs === null) return undefined;

    // Internal returns ascending (index=power), we want descending
    return coeffs.reverse();
  }
```

Add import at top of `boxed-function.ts`:

```typescript
import { getPolynomialCoefficients } from './polynomials';
```

**Step 3: Run tests**

Run: `npm run test compute-engine/polynomial-coefficients`
Expected: All PASS

**Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No new errors

---

### Task 4: Handle Non-Function Expressions

The base class returns `undefined` for `BoxedNumber` and `BoxedSymbol`, but
a plain symbol like `x` is a valid polynomial of degree 1, and a constant
with a specified variable is degree 0. Override in `abstract-boxed-expression.ts`
with logic that handles these:

**Files:**
- Modify: `src/compute-engine/boxed-expression/abstract-boxed-expression.ts`

**Step 1: Update the default implementation**

Replace the default `polynomialCoefficients` in `abstract-boxed-expression.ts`:

```typescript
  polynomialCoefficients(
    variable?: string
  ): ReadonlyArray<Expression> | undefined {
    // For symbols and numbers, delegate to getPolynomialCoefficients
    // which handles them correctly
    if (variable === undefined) {
      const unknowns = this.unknowns;
      if (unknowns.length !== 1) return undefined;
      variable = unknowns[0];
    }

    const coeffs = getPolynomialCoefficients(this, variable);
    if (coeffs === null) return undefined;
    return coeffs.reverse();
  }
```

Add import at top of `abstract-boxed-expression.ts`:

```typescript
import { getPolynomialCoefficients } from './polynomials';
```

Then `boxed-function.ts` no longer needs its own override — the base class
handles everything. Remove the override from `boxed-function.ts` if the base
handles all cases correctly.

**Step 2: Run tests**

Run: `npm run test compute-engine/polynomial-coefficients`
Expected: All PASS (including `plain symbol` and `number` tests)

---

### Task 5: Update CoefficientList to Descending Order

**Files:**
- Modify: `src/compute-engine/library/polynomials.ts:82-96`
- Modify: `test/compute-engine/latex-syntax/polynomials.test.ts:41-56`

**Step 1: Reverse the CoefficientList output**

In `src/compute-engine/library/polynomials.ts`, update the `CoefficientList` evaluate function:

```typescript
    CoefficientList: {
      description:
        'Return the list of coefficients of a polynomial, from highest to lowest degree. ' +
        'Example: CoefficientList(x³ + 2x + 1, x) → [1, 0, 2, 1]',
      lazy: true,
      signature: '(value, symbol) -> list<value>',
      evaluate: ([poly, varExpr]) => {
        if (!poly || !varExpr) return undefined;
        const variable = sym(varExpr.canonical);
        if (!variable) return undefined;
        const coeffs = getPolynomialCoefficients(poly.canonical, variable);
        if (!coeffs) return undefined;
        return poly.engine.box(['List', ...coeffs.reverse()]);
      },
    },
```

**Step 2: Update snapshot tests**

In `test/compute-engine/latex-syntax/polynomials.test.ts`, update the COEFFICIENT LIST snapshots:

- `[1,3]` → `[3,1]` (linear: `3x + 1`)
- `[1,2,1]` → `[1,2,1]` (quadratic: `x^2 + 2x + 1` — same palindrome!)
- `[1,2,0,1]` → `[1,0,2,1]` (cubic: `x^3 + 2x + 1`)

**Step 3: Run the polynomial tests**

Run: `npm run test compute-engine/latex-syntax/polynomials`
Expected: All PASS with updated snapshots

---

### Task 6: Final Verification

**Step 1: Run full test suite**

Run: `npm run test compute-engine/polynomial-coefficients && npm run test compute-engine/latex-syntax/polynomials && npm run test compute-engine/factor`
Expected: All PASS

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors
