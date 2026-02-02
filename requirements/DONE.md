# DONE - Completed Compute Engine Improvements

## High Priority (Completed)

### 1. Add Type Signatures for Special Functions ✅

**IMPLEMENTED:** Added type signatures for all special functions to
`src/compute-engine/library/arithmetic.ts`:

- `Zeta` - Riemann zeta function ζ(s)
- `Beta` - Euler beta function B(a,b)
- `LambertW` - Lambert W function (product logarithm)
- `BesselJ`, `BesselY`, `BesselI`, `BesselK` - Bessel functions with order
  parameter
- `AiryAi`, `AiryBi` - Airy functions

**Also added:**

- LaTeX parsing support (`\zeta`, `\Beta`, `\operatorname{W}`, etc.)
- Enabled `LambertW` derivative: d/dx W(x) = W(x)/(x·(1+W(x)))

**Files modified:**

- `src/compute-engine/library/arithmetic.ts` - Function definitions
- `src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts` - LaTeX
  parsing
- `src/compute-engine/symbolic/derivative.ts` - LambertW derivative
- `test/compute-engine/arithmetic.test.ts` - Type signature tests
- `test/compute-engine/derivatives.test.ts` - LambertW derivative test

**Note:** Digamma, Trigamma, and PolyGamma were already implemented (marked
completed in item #12).

---

### 2. Integration Pattern for `1/(x·ln(x))` ✅

**IMPLEMENTED:** Added special case handling for integrals of the form
`∫ 1/(g(x)·h(x)) dx` where `g(x) = d/dx(h(x))`, recognizing it as
`∫ h'(x)/h(x) dx = ln|h(x)|`.

**Examples that now work:**

```typescript
ce.parse('\\int \\frac{1}{x\\ln x} dx').evaluate()  // → ln(|ln(x)|)
ce.parse('\\int \\frac{3}{x\\ln x} dx').evaluate()  // → 3·ln(|ln(x)|)
```

**Technical details:**

- The pattern `1/(x·ln(x))` is recognized as `(1/x) / ln(x)` where
  `1/x = d/dx(ln(x))`
- This is the u-substitution form: let `u = ln(x)`, then `du = (1/x) dx`
- General form: `∫ 1/(f·g) dx = ln|g|` when `f = d/dx(g)`

**Files modified:**

- `src/compute-engine/symbolic/antiderivative.ts` - Added Case D2 for product
  denominator patterns
- `test/compute-engine/calculus.test.ts` - Added 2 new test cases

---

### 3. Bessel Function Derivatives ✅

**IMPLEMENTED:** Added derivative support for all four Bessel function types:

- `d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2` - Bessel function of the first
  kind
- `d/dx Y_n(x) = (Y_{n-1}(x) - Y_{n+1}(x))/2` - Bessel function of the second
  kind
- `d/dx I_n(x) = (I_{n-1}(x) + I_{n+1}(x))/2` - Modified Bessel function of the
  first kind
- `d/dx K_n(x) = -(K_{n-1}(x) + K_{n+1}(x))/2` - Modified Bessel function of the
  second kind

**Examples:**

```typescript
ce.box(['D', ['BesselJ', 'n', 'x'], 'x']).evaluate()
// → 1/2 * BesselJ(n-1, x) - 1/2 * BesselJ(n+1, x)

ce.box(['D', ['BesselJ', 2, ['Square', 'x']], 'x']).evaluate()
// → x * BesselJ(1, x²) - x * BesselJ(3, x²)  (chain rule applied)

ce.box(['D', ['BesselK', 'n', 'x'], 'x']).evaluate()
// → -1/2 * BesselK(n-1, x) - 1/2 * BesselK(n+1, x)
```

**Files modified:**

- `src/compute-engine/symbolic/derivative.ts` - Added special case handling for
  Bessel functions
- `test/compute-engine/derivatives.test.ts` - Added 8 new tests

---

### 4. Root Operator Integration and Simplification ✅

**Status:** All Root operations verified working. Added nested root
simplification.

**Verified working (no changes needed):**

1. **Integration of Root expressions:**

   ```typescript
   ce.parse('\\int \\sqrt[3]{x} dx').evaluate()  // → 3/4 * x^(4/3) ✓
   ce.parse('\\int x \\sqrt[3]{x} dx').evaluate()  // → 3/7 * x^(7/3) ✓
   ce.parse('\\int \\frac{1}{\\sqrt[3]{x}} dx').evaluate()  // → 3/2 * x^(2/3) ✓
   ```

2. **Higher-order derivatives:**

   ```typescript
   ce.box(['D', ['D', ['Root', 'x', 3], 'x'], 'x']).evaluate()  // → -2/(9x^(5/3)) ✓
   ce.box(['D', ['D', ['D', ['Root', 'x', 3], 'x'], 'x'], 'x']).evaluate()  // → 10/(27x^(8/3)) ✓
   ```

3. **Basic simplifications:**

   ```typescript
   ce.box(['Root', ['Power', 'x', 6], 3]).simplify()  // → x^2 ✓
   ce.box(['Root', 8, 3]).evaluate()  // → 2 ✓
   ```

4. **Equation solving:**

   ```typescript
   ce.parse('\\sqrt[3]{x} = 8').solve('x')  // → [512] ✓
   ```

5. **Pattern matching:**
   ```typescript
   ce.box(['Root', 'x', 3]).match(['Power', '_base', '_exp'])  // → {_base: x, _exp: 1/3} ✓
   ```

**Enhancement added:**

- **Nested root simplification:** Previously `sqrt(sqrt(x))` stayed as
  `sqrt(sqrt(x))`, now simplifies to `x^{1/4}`:
  ```typescript
  ce.box(['Sqrt', ['Sqrt', 'x']]).simplify()  // → root(4)(x) ✓
  ce.box(['Root', ['Root', 'x', 3], 2]).simplify()  // → root(6)(x) ✓
  ce.box(['Sqrt', ['Root', 'x', 3]]).simplify()  // → root(6)(x) ✓
  ce.box(['Root', ['Sqrt', 'x'], 3]).simplify()  // → root(6)(x) ✓
  ```

**Files modified:**

- `src/compute-engine/symbolic/simplify-power.ts` - Added nested root
  simplification rules
- `test/compute-engine/simplify.test.ts` - Added 5 nested root test cases

---

### 5. Multi-Argument Function Derivatives ✅

**IMPLEMENTED:** Added derivative support for multi-argument functions:

1. **Log(x, base)** - Logarithm with custom base
   - `d/dx log_b(x) = 1/(x·ln(b))` when only x depends on the variable
   - Handles cases where base depends on the variable via quotient rule on
     ln(x)/ln(base)
   - Chain rule works correctly: `d/dx log_2(x²) = 2/(x·ln(2))`

2. **Mod, GCD, LCM** - Discrete/step functions
   - Returns 0 (derivative is 0 almost everywhere)
   - These functions have discontinuities where the derivative is undefined, but
     returning 0 is the most useful approximation

**Examples that now work:**

```typescript
ce.box(['D', ['Log', 'x', 2], 'x']).evaluate()  // → 1/(x·ln(2))
ce.box(['D', ['Log', 'x', 'a'], 'x']).evaluate() // → 1/(x·ln(a))
ce.box(['D', ['Log', ['Square', 'x'], 2], 'x']).evaluate() // → 2/(x·ln(2))
ce.box(['D', ['Log', 'a', 'x'], 'x']).evaluate() // → -ln(a)/(x·ln(x)²)
ce.box(['D', ['Mod', 'x', 5], 'x']).evaluate()   // → 0
ce.box(['D', ['GCD', 'x', 6], 'x']).evaluate()   // → 0
ce.box(['D', ['LCM', 'x', 'y'], 'x']).evaluate() // → 0
```

**Files modified:**

- `src/compute-engine/symbolic/derivative.ts` - Added special cases for Log and
  discrete functions
- `test/compute-engine/derivatives.test.ts` - Added 11 new tests

---

### 6. Matrix Operations ✅

**IMPLEMENTED:** Fixed all basic matrix operations in linear algebra library:

- `Shape`, `Rank`, `Flatten`, `Transpose`, `ConjugateTranspose` now work
  correctly
- `Determinant`, `Trace`, `Inverse` implemented with proper scalar handling
- `Diagonal` implemented bidirectionally (vector → diagonal matrix, matrix →
  extract diagonal)
- `Reshape` implemented with APL-style cycling
- Added proper error handling with `'expected-square-matrix'` errors

**Files modified:**

- `src/compute-engine/library/linear-algebra.ts`
- `test/compute-engine/linear-algebra.test.ts` (73 tests passing)
- `doc/17-guide-linear-algebra.md` (new guide)
- `doc/88-reference-linear-algebra.md` (updated reference)

---

### 7. Numerical Integration ✅

**Status:** Verified as working correctly. Numerical integration via `.N()` now
returns accurate Monte Carlo estimates with error bounds.

**Test results:**

```typescript
ce.parse('\\int_0^1 x dx').N()        // → 0.4998 ± 0.0001 (expected: 0.5)
ce.parse('\\int_0^1 x^2 dx').N()      // → 0.3333 ± 0.0001 (expected: 1/3)
ce.parse('\\int_0^\\pi \\sin(x) dx').N() // → 1.9997 ± 0.0003 (expected: 2)
ce.parse('\\int_1^2 1/x dx').N()      // → 0.6932 ± 0.00004 (expected: ln(2))
ce.parse('\\int_0^1 e^x dx').N()      // → 1.7182 ± 0.0002 (expected: e-1)
ce.parse('\\int_0^1 e^{-x^2} dx').N() // → 0.7467 ± 0.00006 (no closed form)
```

The implementation uses Monte Carlo estimation with configurable sample sizes
(1e7 for compiled functions, 1e4 for interpreted).

---

### 8. Assumptions Applied During Simplification ✅

**IMPLEMENTED:** Simplifications now correctly use assumptions about symbol
signs.

**Examples that now work:**

```typescript
ce.assume(ce.parse('x > 0'));
ce.parse('\\sqrt{x^2}').simplify().latex  // → "x"
ce.parse('|x|').simplify().latex          // → "x"
ce.parse('\\sqrt[4]{x^4}').simplify().latex // → "x"

ce.assume(ce.parse('x < 0'));
ce.parse('\\sqrt{x^2}').simplify().latex  // → "-x"
ce.parse('|x|').simplify().latex          // → "-x"
```

**Implementation details:**

- Added `getSignFromAssumptions()` helper in `assume.ts` that queries the
  assumption database for inequality assumptions involving a symbol
- Updated `BoxedSymbol.sgn` to use the helper when no value is assigned
- The existing simplification rules already checked `isNonNegative`,
  `isNegative`, etc., so they now automatically work with assumptions
- Enhanced `|x|` simplification to handle `isNonPositive` (x ≤ 0) case

**Files modified:**

- `src/compute-engine/assume.ts` - Added `getSignFromAssumptions()`
- `src/compute-engine/boxed-expression/boxed-symbol.ts` - Updated `sgn` getter
- `src/compute-engine/symbolic/simplify-abs.ts` - Enhanced for non-positive case
- `test/compute-engine/assumptions.test.ts` - Added 15 new tests

---

## Linear Algebra Enhancements (Completed)

### LA-1. Matrix Multiplication ✅

**IMPLEMENTED:** Added `MatrixMultiply` function to the linear algebra library:

- **Matrix × Matrix**: `A (m×n) × B (n×p) → result (m×p)`
- **Matrix × Vector**: `A (m×n) × v (n) → result (m)`
- **Vector × Matrix**: `v (m) × B (m×n) → result (n)`
- **Vector × Vector** (dot product): `v1 (n) · v2 (n) → scalar`
- Proper dimension validation with `incompatible-dimensions` errors
- Works with both numeric and symbolic tensors
- LaTeX serialization using `\cdot` notation

**Files modified:**

- `src/compute-engine/library/linear-algebra.ts`
- `src/compute-engine/latex-syntax/dictionary/definitions-linear-algebra.ts`
- `test/compute-engine/linear-algebra.test.ts` (18 new tests)
- `test/compute-engine/latex-syntax/linear-algebra.test.ts` (2 new tests)

---

### LA-2. Matrix Addition and Scalar Broadcasting ✅

**IMPLEMENTED:** Element-wise matrix addition and scalar broadcasting.

**Operations added:**

1. **Matrix + Matrix (element-wise):**

   ```typescript
   ce.box(['Add',
     ['List', ['List', 1, 2], ['List', 3, 4]],
     ['List', ['List', 5, 6], ['List', 7, 8]]
   ]).evaluate();
   // → [[6, 8], [10, 12]]
   ```

2. **Scalar + Matrix (broadcast):**

   ```typescript
   ce.box(['Add', 10, ['List', ['List', 1, 2], ['List', 3, 4]]]).evaluate();
   // → [[11, 12], [13, 14]]
   ```

3. **Matrix - Matrix:**
   ```typescript
   ce.box(['Subtract',
     ['List', ['List', 5, 6], ['List', 7, 8]],
     ['List', ['List', 1, 2], ['List', 3, 4]]
   ]).evaluate();
   // → [[4, 4], [4, 4]]
   ```

---

### LA-3. Identity Matrix Function ✅

**IMPLEMENTED:** Added dedicated `IdentityMatrix(n)` function:

```typescript
ce.box(['IdentityMatrix', 3]).evaluate();
// → [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

ce.box(['IdentityMatrix', 4]).evaluate();
// → [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
```

---

### LA-4. Tensor Operations for Rank > 2 ✅

**Implemented:**

- Extended `Transpose` to work with rank > 2 tensors
  - Default: swaps last two axes (batch transpose)
  - Optional axis parameters: `['Transpose', T, axis1, axis2]`
  - For rank 1 (vectors): returns the vector unchanged (identity)
- Extended `ConjugateTranspose` to work with rank > 2 tensors
  - Same axis behavior as Transpose, plus element-wise conjugation
  - For rank 1: returns element-wise conjugated vector
- Extended `Trace` to work with rank > 2 tensors (batch trace)
  - Returns tensor of traces over last two axes
  - Optional axis parameters: `['Trace', T, axis1, axis2]`
  - For [2,2,2] tensor: returns [trace of T[0], trace of T[1]]

**Example usage:**

```typescript
// 2×2×2 tensor
const T = ['List',
  ['List', ['List', 1, 2], ['List', 3, 4]],
  ['List', ['List', 5, 6], ['List', 7, 8]]
];

ce.box(['Transpose', T]).evaluate();
// → [[[1,3],[2,4]],[[5,7],[6,8]]] (each 2×2 matrix transposed)

ce.box(['Trace', T]).evaluate();
// → [5, 13] (trace of each 2×2 matrix: 1+4=5, 5+8=13)

ce.box(['Transpose', T, 1, 2]).evaluate();
// Swaps axes 1 and 2 (different from default which swaps last two)
```

**Files modified:**

- `src/compute-engine/library/linear-algebra.ts` - function definitions
- `src/compute-engine/tensor/tensors.ts` - low-level tensor operations
- `src/compute-engine/global-types.ts` - updated Tensor interface

---

### LA-5. Eigenvalues and Eigenvectors ✅

**Implemented:** Added functions to compute eigenvalues and eigenvectors:

1. **`Eigenvalues`** - Compute eigenvalues of a square matrix
   - 1×1 matrices: returns the single element
   - Diagonal/triangular matrices: returns diagonal elements (optimized)
   - 2×2 matrices: uses characteristic polynomial (symbolic support)
   - 3×3 matrices: uses Cardano's formula for cubic
   - Larger matrices: uses QR algorithm (numeric)

2. **`Eigenvectors`** - Compute eigenvectors corresponding to eigenvalues
   - Uses null space computation via Gaussian elimination
   - 2×2 matrices have symbolic support

3. **`Eigen`** - Combined function returning both as a tuple
   - Returns `['Tuple', eigenvalues, eigenvectors]`

**Example usage:**

```typescript
ce.box(['Eigenvalues', ['List', ['List', 4, 2], ['List', 1, 3]]]).evaluate();
// → [5, 2]

ce.box(['Eigenvectors', ['List', ['List', 4, 2], ['List', 1, 3]]]).evaluate();
// → [[2, 1], [1, -1]] (normalized eigenvectors)

ce.box(['Eigen', ['List', ['List', 4, 2], ['List', 1, 3]]]).evaluate();
// → Tuple([5, 2], [[2, 1], [1, -1]])
```

**Implementation details:**

- QR decomposition using Gram-Schmidt orthogonalization
- Null space computation for eigenvectors
- Handles repeated eigenvalues
- Cardano's formula with trigonometric method for 3×3

**Files modified:**

- `src/compute-engine/library/linear-algebra.ts`

---

### LA-6. Matrix Norms ✅

**IMPLEMENTED:** Added `Norm` function to the linear algebra library:

- **Vector L2 norm (Euclidean, default)**: √(Σ|xi|²)
- **Vector L1 norm**: Σ|xi|
- **Vector L∞ norm**: max(|xi|)
- **Vector Lp norm (general)**: (Σ|xi|^p)^(1/p)
- **Matrix Frobenius norm (default)**: √(ΣΣ|aij|²)
- **Matrix L1 norm**: Maximum column sum of absolute values
- **Matrix L∞ norm**: Maximum row sum of absolute values
- Scalar norms return absolute value

**Files modified:**

- `src/compute-engine/library/linear-algebra.ts`
- `test/compute-engine/linear-algebra.test.ts` (23 new tests)
- `doc/88-reference-linear-algebra.md`

---

### LA-7. Matrix Decompositions (LU, QR, SVD) ✅

**IMPLEMENTED:** Added four matrix decomposition functions:

1. **LU Decomposition:** `A = PA·LU` (with partial pivoting)

   ```typescript
   ce.box(['LUDecomposition', A]).evaluate();
   // → [P, L, U] - Tuple with permutation matrix, lower and upper triangular
   ```

2. **QR Decomposition:** `A = QR` (using Householder reflections)

   ```typescript
   ce.box(['QRDecomposition', A]).evaluate();
   // → [Q, R] - Q orthogonal, R upper triangular
   // Works with rectangular matrices (m×n)
   ```

3. **Singular Value Decomposition (SVD):** `A = UΣV^T`

   ```typescript
   ce.box(['SVD', A]).evaluate();
   // → [U, Σ, V] - U, V orthogonal, Σ diagonal with singular values
   // Works with rectangular matrices
   ```

4. **Cholesky Decomposition:** `A = LL^T` (for positive definite matrices)
   ```typescript
   ce.box(['CholeskyDecomposition', A]).evaluate();
   // → L (lower triangular)
   // Returns error for non-positive-definite matrices
   ```

**Files modified:**

- `src/compute-engine/library/linear-algebra.ts` - Added 4 decomposition
  functions
- `test/compute-engine/linear-algebra.test.ts` - Added 17 new tests

---

## Logic Enhancements (Completed)

### L-1. Logic Simplification Rules ✅

**IMPLEMENTED:** Added comprehensive boolean simplification rules:

1. **Absorption** (NEW):
   - `A ∧ (A ∨ B) → A`
   - `A ∨ (A ∧ B) → A`

2. **Idempotence** (already implemented):
   - `A ∧ A → A`
   - `A ∨ A → A`

3. **Complementation** (already implemented):
   - `A ∧ ¬A → False`
   - `A ∨ ¬A → True`

4. **Identity** (already implemented):
   - `A ∧ True → A`
   - `A ∨ False → A`

5. **Domination** (already implemented):
   - `A ∧ False → False`
   - `A ∨ True → True`

6. **Double negation** (already implemented via involution):
   - `¬¬A → A`

**Examples:**

```typescript
ce.box(['And', 'A', ['Or', 'A', 'B']]).simplify();  // → A
ce.box(['Or', 'A', ['And', 'A', 'B']]).simplify();  // → A
ce.box(['And', 'A', 'A']).simplify();              // → A
ce.box(['And', 'A', ['Not', 'A']]).simplify();     // → False
ce.box(['Or', 'A', ['Not', 'A']]).simplify();      // → True
ce.box(['Not', ['Not', 'A']]).simplify();          // → A
```

**Files modified:**

- `src/compute-engine/library/logic-utils.ts` - Added `applyAbsorptionAnd` and
  `applyAbsorptionOr` functions
- `test/compute-engine/logic.test.ts` - Added "Logic Simplification Rules"
  describe block with 18 new tests

---

### L-2. Prime Implicants/Implicates (Quine-McCluskey) ✅

**IMPLEMENTED:** Added functions for finding prime implicants/implicates and
computing minimal normal forms using the Quine-McCluskey algorithm:

1. **`PrimeImplicants(expr)`** - Find all prime implicants (minimal product
   terms):

   ```typescript
   ce.box(['PrimeImplicants', ['Or', ['And', 'A', 'B'], ['And', 'A', ['Not', 'B']]]]).evaluate();
   // → [A] (AB and A¬B combine to just A)

   ce.box(['PrimeImplicants', ['Or', 'A', 'B']]).evaluate();
   // → [A, B] (two prime implicants)
   ```

2. **`PrimeImplicates(expr)`** - Find all prime implicates (minimal sum
   clauses):

   ```typescript
   ce.box(['PrimeImplicates', ['And', 'A', 'B']]).evaluate();
   // → [A, B] (the expression implies both A and B)

   ce.box(['PrimeImplicates', ['Or', 'A', 'B']]).evaluate();
   // → [A ∨ B] (single prime implicate)
   ```

3. **`MinimalDNF(expr)`** - Convert to minimal Disjunctive Normal Form:

   ```typescript
   ce.box(['MinimalDNF', ['Or',
     ['And', 'A', 'B'],
     ['And', 'A', ['Not', 'B']],
     ['And', ['Not', 'A'], 'B']
   ]]).evaluate();
   // → A ∨ B (simplified from 3 terms to 2 prime implicants)
   ```

4. **`MinimalCNF(expr)`** - Convert to minimal Conjunctive Normal Form:
   ```typescript
   ce.box(['MinimalCNF', ['And', ['Or', 'A', 'B'], ['Or', 'A', ['Not', 'B']]]]).evaluate();
   // → A (simplified to single literal)
   ```

**Algorithm:** Quine-McCluskey with greedy covering:

1. Generate minterms (for DNF) or maxterms (for CNF) from truth table
2. Iteratively combine terms differing in exactly one variable
3. Identify essential prime implicants
4. Use greedy algorithm to find minimal cover

**Performance:**

- O(3^n) worst case complexity
- Limited to 12 variables to prevent exponential blowup
- Expressions with more variables return unevaluated

**Files modified:**

- `src/compute-engine/library/logic-analysis.ts` - Implemented Quine-McCluskey
  algorithm
- `src/compute-engine/library/logic.ts` - Added 4 new function definitions
- `test/compute-engine/logic.test.ts` - Added 17 new tests in "Prime Implicants
  and Minimal Forms" describe block

---

## Medium Priority (Completed)

### 9. Implicit Multiplication Between `\exp` Function Calls ✅

**Status:** This issue has been fixed. The LaTeX parser now correctly recognizes
implicit multiplication between consecutive `\exp` function calls.

**Current behavior (working correctly):**

```typescript
ce.parse('\\exp(x)\\exp(2)').json
// → ["Multiply", ["Power", "ExponentialE", "x"], ["Power", "ExponentialE", 2]]

ce.parse('\\exp(x)\\exp(2)').simplify().latex
// → "\\exp(x+2)"
```

All variations work correctly:

- `\exp(x)\exp(2)` - No space between calls
- `\exp(x) \exp(2)` - Space between calls
- `\exp(x) \cdot \exp(2)` - Explicit multiplication
- `e^x e^2` - Power notation

---

### 10. Trigonometric Periodicity Reduction ✅

**Status:** Implemented in `simplify-rules.ts` with the `reduceTrigPeriodicity`
function.

**What was implemented:**

- Detects integer multiples of π in trig function arguments
- Reduces sin/cos/sec/csc by period 2π (e.g., `sin(5π + k)` → `-sin(k)`)
- Reduces tan/cot by period π (e.g., `tan(3π + k)` → `tan(k)`)
- Handles both positive and negative multiples of π
- Sign changes applied correctly for half-period offsets

**Also fixed:** Disabled the unconditional tan/cot/sec/csc → sin/cos conversion
rules that were causing cost-based simplification to reject beneficial
transformations.

**Tests:** `test/compute-engine/simplify.test.ts` - TRIGONOMETRIC PERIODICITY
REDUCTION describe block (12 tests)

---

### 9b. Pythagorean Trigonometric Identities ✅

**Status:** Implemented in `simplify-rules.ts`.

**What was implemented:**

- Basic identity: `sin²(x) + cos²(x)` → `1`
- Subtraction forms: `1 - sin²(x)` → `cos²(x)`, `sin²(x) - 1` → `-cos²(x)`, etc.
- Negated form: `-sin²(x) - cos²(x)` → `-1`
- Tan/Sec variants: `tan²(x) + 1` → `sec²(x)`, `sec²(x) - 1` → `tan²(x)`
- Cot/Csc variants: `1 + cot²(x)` → `csc²(x)`, `csc²(x) - 1` → `cot²(x)`
- With coefficient: `a·sin²(x) + a·cos²(x)` → `a`

**Tests:** `test/compute-engine/simplify.test.ts` - PYTHAGOREAN IDENTITIES
describe block (13 tests)

---

### 11. Add Tests for Symbolic Derivatives ✅

**IMPLEMENTED:** Added comprehensive tests for symbolic derivatives in
`test/compute-engine/derivatives.test.ts`:

- Tests for special function derivatives (Gamma, Digamma, Trigamma, Erf, Erfc,
  LogGamma, FresnelS, FresnelC)
- Tests for unknown function derivatives (f(x) returns symbolic
  `Apply(Derivative(f, 1), x)`)
- Documented current limitation: chain rule with unknown functions returns 0 (a
  potential future improvement)

---

### 12. Add Trigamma Function ✅

**IMPLEMENTED:** Added Trigamma and related functions to the library:

- `Digamma` - Psi function ψ(x), the logarithmic derivative of the gamma
  function
- `Trigamma` - ψ₁(x), the derivative of the digamma function
- `PolyGamma` - ψₙ(x), the nth derivative of the digamma function

Added derivative rule: `Digamma: ['Trigamma', '_']`

**Files modified:**

- `src/compute-engine/library/arithmetic.ts`
- `src/compute-engine/symbolic/derivative.ts`

---

### 13. Support Additional Derivative Notations ✅

**IMPLEMENTED** (see
[#163](https://github.com/cortex-js/compute-engine/issues/163)):

1. **Newton's dot notation (time derivatives):**
   - `\dot{x}` → `["D", "x", "t"]`
   - `\ddot{x}` → `["D", ["D", "x", "t"], "t"]`
   - `\dddot{x}`, `\ddddot{x}` also supported
   - Time variable configurable via `timeDerivativeVariable` parser option
     (default: `"t"`)

2. **Lagrange prime notation with arguments:**
   - `f'(x)` → `["D", ["f", "x"], "x"]` (infers variable from argument)
   - `f''(x)` → nested D for second derivative
   - Works for known function symbols

3. **Euler's subscript notation:**
   - `D_x f` → `["D", "f", "x"]`
   - `D^2_x f` or `D_x^2 f` → second derivative

**Not implemented:**

- `f_x` subscript notation for partial derivatives (conflicts with indexing)
- Plain `Df` without subscript (ambiguous)

---

## Equation Solving Enhancements (Completed)

### 26. Trigonometric Equation Solving ✅

**Status:** Implemented in `src/compute-engine/boxed-expression/solve.ts`.

**What was implemented:**

- `a·sin(x) + b = 0` → returns both `arcsin(-b/a)` and `π - arcsin(-b/a)`
- `a·cos(x) + b = 0` → returns both `arccos(-b/a)` and `-arccos(-b/a)`
- `a·tan(x) + b = 0` → returns `arctan(-b/a)` (one solution per period)
- `a·cot(x) + b = 0` → returns `arccot(-b/a)`
- Domain validation: returns no solutions when |-b/a| > 1 for sin/cos
- Automatic deduplication of equivalent solutions

**Tests added:** `test/compute-engine/solve.test.ts` - SOLVING TRIGONOMETRIC
EQUATIONS describe block (11 tests)

---

## Element-based Indexing Set Enhancements (Completed)

### EL-1. Support Range Notation in LaTeX Parsing ✅

**IMPLEMENTED:** Two-element integer Lists in bracket notation `[a,b]` are now
treated as Range(a, b) when used in Element context for Sum/Product evaluation.

- `\sum_{n \in [1,5]} n` now evaluates to `15` (1+2+3+4+5) instead of `6`
- Parsing is unchanged (still parses as `["List", 1, 5]`)
- The interpretation as Range happens in `extractFiniteDomain()` during
  evaluation
- Only applies to 2-element Lists with integer values

**Files modified:**

- `src/compute-engine/library/logic-analysis.ts` - `extractFiniteDomain`
- `test/compute-engine/latex-syntax/arithmetic.test.ts` - Updated and added
  tests

---

### EL-2. Multiple Element Indexing Sets with Comma Separator ✅

**IMPLEMENTED:** Multiple comma-separated Element expressions now parse and
evaluate correctly in Sum/Product subscripts.

**Examples:**

```typescript
ce.parse('\\sum_{n \\in S, m \\in T} (n+m)')
// → ["Sum", ["Add", "n", "m"], ["Element", "n", "S"], ["Element", "m", "T"]]

// Nested sums work correctly
ce.assign('A', ce.box(['Set', 1, 2]));
ce.assign('B', ce.box(['Set', 3, 4]));
ce.parse('\\sum_{i \\in A}\\sum_{j \\in B} i \\cdot j').evaluate()
// → 21 (= 1*3 + 1*4 + 2*3 + 2*4)
```

**Implementation details:**

- The `getIndexes` function already handled Element expressions correctly
- Multiple Element expressions are parsed as separate indexing sets
- Mixed indexing sets (Element + Limits) work together

**Files modified:**

- `test/compute-engine/latex-syntax/arithmetic.test.ts` - Added EL-2 tests

---

### EL-3. Condition/Filter Support in Element Expressions ✅

**IMPLEMENTED:** Conditions can now be attached to Element expressions to filter
values from the set during Sum/Product evaluation.

**Supported syntax:**

```latex
\sum_{n \in S, n > 0} f(n)
```

Parses to:

```json
["Sum", ["f", "n"], ["Element", "n", "S", ["Greater", "n", 0]]]
```

**Examples:**

```typescript
ce.assign('S', ce.box(['Set', 1, 2, 3, -1, -2]));

ce.parse('\\sum_{n \\in S, n > 0} n').evaluate()
// → 6 (only 1+2+3, excluding -1, -2)

ce.parse('\\sum_{n \\in S, n \\ge 2} n').evaluate()
// → 5 (only 2+3)

ce.parse('\\sum_{n \\in S, n < 0} n').evaluate()
// → -3 (only -1-2)

ce.parse('\\prod_{k \\in S, k > 0} k').evaluate()
// → 6 (only 1*2*3)
```

**Supported condition operators:**

- `>` (Greater)
- `>=` / `\ge` (GreaterEqual)
- `<` (Less)
- `<=` / `\le` (LessEqual)
- `!=` / `\ne` (NotEqual)

**Implementation details:**

- Conditions are attached as the 4th operand of Element expressions
- The `getIndexes` function detects condition expressions following Element
- The `extractFiniteDomainWithReason` function filters values using the
  condition
- Symbol values (assigned Sets) are properly dereferenced during evaluation

**Files modified:**

- `src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts` -
  Condition parsing
- `src/compute-engine/library/utils.ts` - Condition preservation in
  canonicalization
- `src/compute-engine/library/logic-analysis.ts` - Condition filtering
- `src/compute-engine/library/sets.ts` - Extended Element signature
- `test/compute-engine/latex-syntax/arithmetic.test.ts` - Added EL-3 tests

---

### EL-4. Infinite Series with Element Notation ✅

**IMPLEMENTED:** `NonNegativeIntegers` and `PositiveIntegers` are now converted
to their equivalent Limits form and iterated (capped at MAX_ITERATION =
1,000,000).

**Behavior:**

```typescript
// NonNegativeIntegers (ℕ₀) → iterates from 0 to MAX_ITERATION
ce.box(['Sum', 'n', ['Element', 'n', 'NonNegativeIntegers']]).evaluate()
// → evaluates to partial sum (numeric result)

// PositiveIntegers (ℤ⁺) → iterates from 1 to MAX_ITERATION
ce.box(['Sum', ['Power', 'n', -2], ['Element', 'n', 'PositiveIntegers']]).evaluate()
// → evaluates to ≈1.6449 (close to π²/6)

// Integers, Reals, etc. → cannot be converted, stays symbolic
ce.box(['Sum', 'n', ['Element', 'n', 'Integers']]).evaluate()
// → ['Sum', 'n', ['Element', 'n', 'Integers']] (stays symbolic)
```

**Mappings implemented:**

- `NonNegativeIntegers` (ℕ₀) → `["Limits", n, 0, ∞]`
- `PositiveIntegers` (ℤ⁺) → `["Limits", n, 1, ∞]`
- `NegativeIntegers` (ℤ⁻) → stays symbolic (can't forward iterate)
- `Integers` (ℤ) → stays symbolic (bidirectional)
- `Reals`, `Complexes`, etc. → stays symbolic (non-countable)

**Implementation:**

- Added `convertInfiniteSetToLimits()` function that maps known infinite integer
  sets to their equivalent Limits bounds
- Modified `reduceElementIndexingSets()` to check for convertible infinite
  domains before returning `non-enumerable` status
- When conversion is possible, the Element indexing set is treated as a Limits
  set and processed with the existing iteration machinery

**Files modified:**

- `src/compute-engine/library/utils.ts` - Added conversion function and updated
  reduction
- `test/compute-engine/latex-syntax/arithmetic.test.ts` - Added EL-4 tests

---

### EL-5. Improve Error Messages for Non-Finite Domains ✅

**IMPLEMENTED:** When the domain cannot be enumerated (unknown symbol, infinite
set, or non-integer bounds), the expression now stays symbolic instead of
returning NaN.

**Previous behavior:**

```typescript
ce.parse('\\sum_{n \\in S} n').evaluate()
// Returned: NaN (unhelpful - no indication of why it failed)
```

**New behavior:**

```typescript
ce.box(['Sum', 'n', ['Element', 'n', 'S']]).evaluate()
// Returns: ['Sum', 'n', ['Element', 'n', 'S']] (unknown symbol stays symbolic)

ce.box(['Sum', 'n', ['Element', 'n', 'Integers']]).evaluate()
// Returns: ['Sum', 'n', ['Element', 'n', 'Integers']] (bidirectional set stays symbolic)

ce.box(['Sum', 'n', ['Element', 'n', ['Range', 1, 'a']]]]).evaluate()
// Returns: ['Sum', 'n', ['Element', 'n', ['Range', 1, 'a']]] (symbolic bounds stay symbolic)
```

**Note:** With EL-4, `NonNegativeIntegers` and `PositiveIntegers` now evaluate
(by converting to Limits form). Other infinite sets like `Integers`, `Reals`,
`NegativeIntegers` still stay symbolic.

**Implementation details:**

- Added `extractFiniteDomainWithReason()` function that returns detailed status:
  - `status: 'success'` - Domain was successfully extracted
  - `status: 'non-enumerable'` - Domain exists but cannot be enumerated
    (infinite set, unknown symbol)
  - `status: 'error'` - Invalid Element expression (missing variable, malformed
    domain)
- Added `NON_ENUMERABLE_DOMAIN` symbol to signal non-enumerable domains to
  Sum/Product
- Updated `reduceBigOp()` and `reduceElementIndexingSets()` to properly iterate
  generator and capture return values
- Sum/Product evaluate handlers now return `undefined` (keep symbolic) when
  domain is non-enumerable, instead of returning NaN
- Recognizes known infinite sets: `Integers`, `NonNegativeIntegers`,
  `PositiveIntegers`, `Reals`, `Complexes`, `Rationals`, etc.

**Files modified:**

- `src/compute-engine/library/logic-analysis.ts` - Added
  `extractFiniteDomainWithReason`
- `src/compute-engine/library/utils.ts` - Updated `reduceBigOp`,
  `reduceElementIndexingSets`
- `src/compute-engine/library/arithmetic.ts` - Updated Sum/Product handlers
- `test/compute-engine/latex-syntax/arithmetic.test.ts` - Added 8 tests

---

### EL-6. Support Interval with Element for Integer Domains ✅

**IMPLEMENTED:** `Interval` expressions now work with Element-based indexing for
Sum/Product, including support for `Open` and `Closed` boundary markers.

**Examples:**

```typescript
ce.box(['Sum', 'n', ['Element', 'n', ['Interval', 1, 5]]]).evaluate()
// → 15 (iterates 1, 2, 3, 4, 5)

ce.box(['Sum', 'n', ['Element', 'n', ['Interval', ['Open', 0], 5]]]).evaluate()
// → 15 (open start excludes 0, iterates 1, 2, 3, 4, 5)

ce.box(['Sum', 'n', ['Element', 'n', ['Interval', 1, ['Open', 6]]]]).evaluate()
// → 15 (open end excludes 6, iterates 1, 2, 3, 4, 5)
```

**Implementation details:**

- Enhanced `extractFiniteDomain()` to unwrap `Open`/`Closed` boundary markers
- Adjusts integer bounds accordingly (open start → +1, open end → -1)
- Size limit of 1000 elements prevents very large intervals

**Files modified:**

- `src/compute-engine/library/logic-analysis.ts` - `extractFiniteDomain`
- `test/compute-engine/latex-syntax/arithmetic.test.ts` - Added tests

---

## Equation Solving Enhancements (Completed)

### 14. Extraneous Root Filtering for Sqrt Equations ✅

**IMPLEMENTED:** Fixed extraneous root filtering for square root equations that
use quadratic substitution (u = √x → au² + bu + c = 0 → x = u²).

**Problem:** The sqrt equation solver uses quadratic substitution, which can
produce extraneous roots that satisfy the transformed equation but not the
original. The `validateRoots()` function was being called with the modified
expression (after clearing denominators and harmonization) instead of the
original expression.

**Solution:** Save the original expression before any algebraic transformations
(clearing denominators, harmonization) and use that for validating candidate
solutions. The `validateRoots()` function substitutes each root back into the
expression and verifies it evaluates to 0.

**Examples that now correctly filter extraneous roots:**

```typescript
// √x = x - 2 has candidate solutions x=1 and x=4, but x=1 is extraneous
// x=1: √1 = 1, 1-2 = -1, 1 ≠ -1 ❌
// x=4: √4 = 2, 4-2 = 2 ✓
ce.parse('\\sqrt{x} = x - 2').solve('x')  // → [4]

// √x + x - 2 = 0: x=4 is extraneous
ce.parse('\\sqrt{x} + x - 2 = 0').solve('x')  // → [1]

// √x - x + 2 = 0: x=1 is extraneous (from u=-1)
ce.parse('\\sqrt{x} - x + 2 = 0').solve('x')  // → [4]

// x - 4√x + 3 = 0: both roots are valid (no extraneous)
ce.parse('x - 4\\sqrt{x} + 3 = 0').solve('x')  // → [1, 9]

// x - 2√x - 3 = 0: x=1 is extraneous (from u=-1)
ce.parse('x - 2\\sqrt{x} - 3 = 0').solve('x')  // → [9]

// 2x + 3√x - 2 = 0: x=4 is extraneous (from u=-2)
ce.parse('2x + 3\\sqrt{x} - 2 = 0').solve('x')  // → [1/4]
```

**Implementation details:**

- Added `originalExpr` variable to save the expression before
  `clearDenominators()` and other transformations
- Modified `validateRoots()` call to use `originalExpr` instead of the
  transformed `expr`
- The existing validation logic (substitute root, check if result equals 0) now
  correctly filters extraneous roots

**Files modified:**

- `src/compute-engine/boxed-expression/solve.ts` - Save original expression and
  validate against it
- `test/compute-engine/solve.test.ts` - Added 6 new tests in "EXTRANEOUS ROOT
  FILTERING FOR SQRT EQUATIONS" describe block

---

### 3. Pattern Matching with Repeated Wildcards ✅

**Status:** Verified working correctly. The pattern matching system properly
handles wildcards that appear multiple times in a pattern.

**Investigated behavior:**

The `captureWildcard()` function in `match.ts` (lines 37-58) correctly handles
repeated wildcards:

1. When a named wildcard (like `_x`) is first encountered, it's captured in the
   substitution dictionary
2. When the same wildcard is encountered again, it checks if the new expression
   is the same as the previously captured one using `isSame()`
3. If they match, the substitution is preserved; if not, the match fails

**Examples that work correctly:**

```typescript
// Pattern with repeated wildcard
pattern = ['Divide', 1, ['Multiply', '_x', ['Ln', '_x']]]
expr = ['Divide', 1, ['Multiply', 'x', ['Ln', 'x']]]
// Result: { _x: x } ✓

// Pattern with 3 levels of nesting
pattern = ['Add', '_x', ['Multiply', '_x', ['Power', '_x', 2]]]
expr = ['Add', 'x', ['Multiply', 'x', ['Power', 'x', 2]]]
// Result: { _x: x } ✓

// Repeated wildcard with commutative operators
pattern = ['Add', '_x', ['Ln', '_x']]
expr = ['Add', ['Ln', 'x'], 'x']  // order swapped
// Result: { _x: x } ✓ (handles commutative reordering)

// Mismatch correctly detected
pattern = ['Multiply', '_x', ['Ln', '_x']]
expr = ['Multiply', 'x', ['Ln', 'y']]  // different variables
// Result: null ✓ (correctly rejects)

// Complex expression matching
pattern = ['Add', '_x', ['Power', '_x', 2]]
expr = ['Add', ['Add', 'a', 1], ['Power', ['Add', 'a', 1], 2]]
// Result: { _x: ['Add', 'a', 1] } ✓ (matches complex sub-expression)
```

**Integration with antiderivative.ts:**

The specific integral `∫ 1/(x·ln(x)) dx = ln|ln(x)|` is handled procedurally in
`antiderivative.ts` (lines 1772-1800) using Case D2, which:

1. Recognizes patterns like `1/(g(x)·h(x))` where `g(x) = d/dx(h(x))`
2. For `1/(x·ln(x))`, identifies that `1/x = d/dx(ln(x))`
3. Returns `ln|h(x)|` = `ln|ln(x)|`

This procedural approach is appropriate because it requires computing
derivatives dynamically, which cannot be expressed as a static pattern matching
rule.

**Files verified:**

- `src/compute-engine/boxed-expression/match.ts` - Pattern matching logic
- `src/compute-engine/symbolic/antiderivative.ts` - Integration patterns

**Tests added:**

- `test/compute-engine/patterns.test.ts` - Added 15 new tests in "Repeated
  Wildcards in Nested Contexts" describe block covering:
  - Simple repeated wildcards in flat structures
  - Repeated wildcards in nested function arguments
  - Repeated wildcards with Divide patterns
  - Complex expression matching
  - Commutative reordering with repeated wildcards
  - Canonical expression matching

---

### 18. Value Resolution from Equality Assumptions ✅

**IMPLEMENTED:** When an equality assumption is made via
`ce.assume(['Equal', symbol, value])`, the symbol now correctly evaluates to the
assumed value.

**Problem:** When `ce.assume(['Equal', 'one', 1])` was called, subsequent uses
of `one` would not evaluate to `1` - the symbol remained unevaluated.
Additionally, `['Equal', 'one', 1]` would not evaluate to `True`.

**Solution:** Fixed two issues:

1. **Value assignment in `assumeEquality`:** When a symbol already has a
   definition (which happens automatically when accessed via `.unknowns`), the
   code was not setting its value. Added `ce._setSymbolValue(lhs, val)` to store
   the value in the evaluation context.

2. **Numeric evaluation for comparisons:** The `N()` method in `BoxedSymbol` was
   only checking the definition's value, not the evaluation context value.
   Updated to check `_getSymbolValue()` first for non-constant symbols.

**Examples that now work:**

```typescript
ce.assume(ce.box(['Equal', 'one', 1]));
ce.box('one').evaluate().json           // → 1 (was: "one")
ce.box('one').N().json                  // → 1 (was: "one")
ce.box(['Equal', 'one', 1]).evaluate()  // → True (was: ['Equal', 'one', 1])
ce.box(['Equal', 'one', 0]).evaluate()  // → False
ce.box(['NotEqual', 'one', 1]).evaluate() // → False
ce.box(['NotEqual', 'one', 0]).evaluate() // → True
ce.box('one').type.matches('integer')   // → true
```

**Files modified:**

- `src/compute-engine/assume.ts` - Added value assignment when symbol has
  existing definition
- `src/compute-engine/boxed-expression/boxed-symbol.ts` - Fixed `N()` to check
  context value

**Tests enabled:**

- `test/compute-engine/assumptions.test.ts` - Enabled "VALUE RESOLUTION FROM
  EQUALITY ASSUMPTIONS" describe block (6 tests)

---

### 19. Inequality Evaluation Using Assumptions ✅

**IMPLEMENTED:** When inequality assumptions are made via
`ce.assume(['Greater', symbol, value])`, comparisons can now use transitive
reasoning to determine results.

**Problem:** When `x > 4` was assumed, evaluating `['Greater', 'x', 0]` would
return the expression unchanged instead of `True` (since x > 4 implies x > 0).

**Solution:** Added a new function `getInequalityBoundsFromAssumptions` that
extracts lower/upper bounds for a symbol from inequality assumptions. The bounds
are then used in the `cmp` function to determine comparison results.

**Key insight:** Assumptions are normalized to forms like
`Less(Add(Negate(x), k), 0)` (meaning `k - x < 0`, i.e., `x > k`). The
implementation parses these normalized forms to extract bounds.

**Examples that now work:**

```typescript
ce.assume(ce.box(['Greater', 'x', 4]));
ce.box(['Greater', 'x', 0]).evaluate();  // → True (x > 4 > 0)
ce.box(['Less', 'x', 0]).evaluate();     // → False
ce.box('x').isGreater(0);                // → true
ce.box('x').isGreater(4);                // → true (strict inequality)
ce.box('x').isGreater(5);                // → undefined (can't determine)
ce.box('x').isPositive;                  // → true

ce.assume(ce.box(['Greater', 't', 0]));
ce.box(['Greater', 't', 0]).evaluate();  // → True
ce.box('t').isGreater(-1);               // → true
```

**Files modified:**

- `src/compute-engine/assume.ts` - Added `getInequalityBoundsFromAssumptions()`
  function
- `src/compute-engine/boxed-expression/compare.ts` - Modified `cmp()` to use
  bounds from assumptions

**Tests enabled:**

- `test/compute-engine/assumptions.test.ts` - Enabled "INEQUALITY EVALUATION
  USING ASSUMPTIONS" describe block (6 tests)

---

### 24. BUG FIX: forget() Now Clears Assumed Values ✅

**FIXED:** The `forget()` function now properly clears values from the
evaluation context when a symbol is forgotten.

**Problem:** When `ce.assume(['Equal', 'x', 5])` was called followed by
`ce.forget('x')`, the value `5` would persist in the evaluation context, causing
`ce.box('x').evaluate()` to still return `5` instead of the symbol `'x'`.

**Root cause:** When task #18 was implemented, values were stored in the
evaluation context via `ce._setSymbolValue()`. However, `forget()` only removed
assumptions from `ce.context.assumptions` - it didn't clear the value from the
evaluation context.

**Solution:** Added code to `forget()` to iterate through all evaluation context
frames and delete the symbol's value:

```typescript
// In forget() function, after removing assumptions:
for (const ctx of this._evalContextStack) {
  if (symbol in ctx.values) {
    delete ctx.values[symbol];
  }
}
```

**Examples that now work:**

```typescript
const ce = new ComputeEngine();
ce.assume(ce.box(['Equal', 'x', 5]));
ce.box('x').evaluate().json;  // → 5

ce.forget('x');
ce.box('x').evaluate().json;  // → 'x' (was: 5)
```

**Files modified:**

- `src/compute-engine/index.ts` - Added value cleanup in `forget()` function

**Tests added:**

- `test/compute-engine/bug-fixes.test.ts` - Test for forget() value clearing

---

### 25. BUG FIX: Scoped Assumptions Now Clean Up on popScope() ✅

**FIXED:** Assumptions made inside a scope via `pushScope()`/`popScope()` now
properly clean up when the scope is exited.

**Problem:** When assumptions were made inside a nested scope, the values set
via `ce._setSymbolValue()` would persist after `popScope()` was called, breaking
scope isolation.

**Root cause:** The `_setSymbolValue()` function stores values in the context
where the symbol was declared (which might be a parent scope), not necessarily
the current scope. When `popScope()` was called, only the current scope's
context was removed, but the value remained in the parent context.

**Solution:** Created a new internal method `_setCurrentContextValue()` that
stores values directly in the current context's values map. Modified
`assumeEquality()` to use this method instead of `_setSymbolValue()`, ensuring
that assumption values are scoped to where the assumption was made.

```typescript
// New method in ComputeEngine:
_setCurrentContextValue(id, value): void {
  this._evalContextStack[this._evalContextStack.length - 1].values[id] = value;
}

// In assumeEquality(), changed from:
ce._setSymbolValue(lhs, val);
// to:
ce._setCurrentContextValue(lhs, val);
```

**Examples that now work:**

```typescript
const ce = new ComputeEngine();
ce.pushScope();
ce.assume(ce.box(['Equal', 'y', 10]));
ce.box('y').evaluate().json;  // → 10

ce.popScope();
ce.box('y').evaluate().json;  // → 'y' (was: 10)
```

**Files modified:**

- `src/compute-engine/index.ts` - Added `_setCurrentContextValue()` method
- `src/compute-engine/global-types.ts` - Added method signature
- `src/compute-engine/assume.ts` - Changed to use `_setCurrentContextValue()`

**Tests added:**

- `test/compute-engine/bug-fixes.test.ts` - Test for scoped assumption cleanup

---

### 21. Type Inference from Assumptions ✅

**IMPLEMENTED:** When assumptions are made, symbol types are now correctly
inferred based on the assumption.

**Problem:** When `ce.assume(['Greater', 'x', 4])` was called, the symbol's type
remained 'unknown'. Similarly, when `ce.assume(['Equal', 'one', 1])` was called,
the symbol's type was 'finite_integer' instead of 'integer'.

**Solution:** Modified the assumption processing to update symbol types:

1. **For equality assumptions**: Added `inferTypeFromValue()` function that
   promotes specific types to more general ones (e.g., `finite_integer` →
   `integer`, `finite_real_number` → `real`). This is used when updating the
   type of a symbol with an inferred type.

2. **For inequality assumptions**: Updated `assumeInequality()` to set the
   symbol's type to 'real' even when the symbol was already auto-declared with
   an inferred type.

**Type promotion rules:**

- `finite_integer`, `integer` → `integer`
- `rational` → `real`
- `finite_real_number`, `real` → `real`
- `complex`, `imaginary` → `number`

**Examples that now work:**

```typescript
ce.assume(ce.box(['Greater', 'x', 4]));
ce.box('x').type.toString();  // → 'real' (was: 'unknown')

ce.assume(ce.box(['Equal', 'one', 1]));
ce.box('one').type.toString();  // → 'integer' (was: 'finite_integer' or 'unknown')

ce.assume(ce.box(['Greater', 't', 0]));
ce.box('t').type.toString();  // → 'real'

ce.assume(ce.box(['Equal', 'p', 11]));
ce.box('p').type.toString();  // → 'integer'
```

**Files modified:**

- `src/compute-engine/assume.ts` - Added `inferTypeFromValue()`, updated type
  inference

**Tests enabled:**

- `test/compute-engine/assumptions.test.ts` - Enabled "TYPE INFERENCE FROM
  ASSUMPTIONS" describe block (6 tests)

---

### 20. Tautology and Contradiction Detection ✅

**IMPLEMENTED:** `ce.assume()` now returns `'tautology'` for redundant
assumptions that are already implied by existing assumptions, and
`'contradiction'` for assumptions that conflict with existing ones.

**Problem:** When a user made an assumption like `x > 0` after already assuming
`x > 4`, the function would return `'ok'` even though the new assumption was
redundant (implied by the existing one). Similarly, assuming `x < 0` when
`x > 4` exists would silently accept a contradictory assumption.

**Solution:** Added bounds checking logic in `assumeInequality()` that:

1. Extracts the symbol from the inequality being assumed
2. Retrieves existing bounds for that symbol from current assumptions
3. Compares the new inequality against existing bounds to detect:
   - **Tautologies**: When the new inequality is implied by existing bounds
   - **Contradictions**: When the new inequality conflicts with existing bounds

The implementation correctly handles all combinations:

- `Greater`/`GreaterEqual` vs existing lower bounds → tautology detection
- `Greater`/`GreaterEqual` vs existing upper bounds → contradiction detection
- `Less`/`LessEqual` vs existing upper bounds → tautology detection
- `Less`/`LessEqual` vs existing lower bounds → contradiction detection

It also handles canonical form normalization - the compute engine canonicalizes
`Greater(x, k)` to `Less(k, x)`, so the code determines the "effective"
relationship based on both the operator and which operand contains the symbol.

**Examples that now work:**

```typescript
ce.assume(ce.box(['Equal', 'one', 1]));
ce.assume(ce.box(['Equal', 'one', 1]));   // → 'tautology' (same assumption repeated)
ce.assume(ce.box(['Less', 'one', 0]));    // → 'contradiction' (one=1 is not < 0)
ce.assume(ce.box(['Greater', 'one', 0])); // → 'tautology' (one=1 > 0)

ce.assume(ce.box(['Greater', 'x', 4]));
ce.assume(ce.box(['Greater', 'x', 0]));   // → 'tautology' (x > 4 implies x > 0)
ce.assume(ce.box(['Less', 'x', 0]));      // → 'contradiction' (x > 4 contradicts x < 0)
```

**Files modified:**

- `src/compute-engine/assume.ts` - Added bounds checking logic in
  `assumeInequality()`

**Tests enabled:**

- `test/compute-engine/assumptions.test.ts` - Enabled "TAUTOLOGY AND
  CONTRADICTION DETECTION" describe block (4 tests)

---

### 23. Replace Method Auto-Wildcards Fix ✅

**FIXED:** The `.replace()` method no longer auto-converts single-character
symbols to wildcards when using object rules. This fixes issue #23.

**Problem:** When using `.replace({match: 'a', replace: 2})`, the symbol `'a'`
was being auto-converted to wildcard `'_a'`, causing it to match ANY expression
instead of just the literal symbol `a`.

**Solution:** Added `autoWildcard` parameter to `parseRulePart()`. Auto-wildcarding
is now only enabled when parsing string rules (like `"a*x -> 2*x"`), not when
parsing object rules.

**Examples that now work correctly:**

```typescript
const expr = ce.box(['Add', ['Multiply', 'a', 'x'], 'b']);

// Object rules: literal matching
expr.replace({match: 'a', replace: 2}, {recursive: true});
// → 2x + b (was: 2 - incorrectly matched entire expression)

// String rules: still auto-wildcard
expr.replace('a*x -> 5*x', {recursive: true});
// → 5x + b (works as before)

// Explicit wildcards in object rules still work
expr.replace({match: ['Multiply', '_a', 'x'], replace: 10}, {recursive: true});
// → 10 + b
```

**Files modified:**

- `src/compute-engine/boxed-expression/rules.ts` - Added `autoWildcard` parameter
  to `parseRulePart()`, defaults to `false` for object rules
- `test/compute-engine/rules.test.ts` - Added 5 new tests in "OBJECT RULES
  LITERAL MATCHING" describe block

---

### 15. Extended Sqrt Pattern 4: Nested Sqrt Equations ✅

**IMPLEMENTED:** The solver now handles nested sqrt equations of the form
`√(x + √x) = a` and similar patterns where √x appears inside the argument of an
outer sqrt.

**Problem:** Equations like `√(x + 2√x) = 3` or `√(x - √x) = 1` were not being
solved because they require a substitution approach.

**Solution:** Added `solveNestedSqrtEquation()` function that:

1. Detects patterns where √x appears inside the argument of an outer √
2. Uses substitution u = √x, so x = u²
3. Transforms the equation: `√(u² + ku) = a` → `u² + ku = a²`
4. Solves the resulting quadratic for u
5. Filters out negative u values (since u = √x ≥ 0)
6. Returns x = u² for valid u values

**Key implementation details:**

- Uses a unique internal symbol `__internalU` to avoid wildcard interpretation
- Must replace √x with u BEFORE replacing x with u², otherwise √x becomes √(u²)
- Uses `isNegative` property on the evaluated u value for filtering
- Integrates with `validateRoots()` for additional extraneous root filtering

**Examples that now work:**

```typescript
ce.parse("\sqrt{x + 2\sqrt{x}} = 3").solve("x")  // → [11 - 2√10] ≈ 4.675
// u² + 2u - 9 = 0 → u = -1 ± √10
// u = -1 + √10 ≈ 2.16 (valid), u = -1 - √10 ≈ -4.16 (filtered)
// x = (−1 + √10)² = 11 - 2√10

ce.parse("\sqrt{x + \sqrt{x}} = 2").solve("x")   // → [9/2 - √17/2] ≈ 2.438
// u² + u - 4 = 0 → u = (-1 ± √17)/2
// Only u = (-1 + √17)/2 ≈ 1.56 is valid

ce.parse("\sqrt{x - \sqrt{x}} = 1").solve("x")   // → [φ²] ≈ 2.618
// u² - u - 1 = 0 → u = (1 ± √5)/2
// Only u = φ (golden ratio) ≈ 1.618 is valid
```

**Files modified:**

- `src/compute-engine/boxed-expression/solve.ts` - Added `solveNestedSqrtEquation()`
  function and integration in `findUnivariateRoots()`
- `test/compute-engine/solve.test.ts` - Added 3 new tests in "NESTED SQRT
  EQUATIONS (Pattern 4)" describe block
- `requirements/TODO.md` - Updated Pattern 4 as implemented

---

### 15. Extended Sqrt Pattern 3: Two Sqrt Terms ✅

**IMPLEMENTED:** The solver now handles equations with two sqrt terms of the
form `√(f(x)) + √(g(x)) = e` using double squaring.

**Problem:** Equations like `√(x+1) + √(x+4) = 3` or `√(x+5) - √(x-3) = 2` were
not being solved because they require squaring twice to eliminate both sqrts.

**Solution:** Added `solveTwoSqrtEquation()` function that:

1. Detects equations with exactly two sqrt terms and a constant
2. Isolates one sqrt: `√(f(x)) = e - √(g(x))`
3. Squares both sides: `f(x) = e² - 2e√(g(x)) + g(x)`
4. Isolates remaining sqrt: `f(x) - e² - g(x) = -2e√(g(x))`
5. Squares again: `(f(x) - e² - g(x))² = 4e²·g(x)`
6. Solves the resulting polynomial equation
7. Validates each solution by checking:
   - `f(x) ≥ 0` and `g(x) ≥ 0` (for real sqrts)
   - The original equation holds numerically

**Key implementation details:**

- Handles both addition (`√f + √g = e`) and subtraction (`√f - √g = e`)
- Handles negated sqrt terms (`-√f + √g = e`)
- Validates solutions numerically with tolerance of 1e-9
- Filters out extraneous roots introduced by squaring

**Examples that now work:**

```typescript
ce.parse("\sqrt{x+1} + \sqrt{x+4} = 3").solve("x")  // → [0]
// Verify: √1 + √4 = 1 + 2 = 3 ✓

ce.parse("\sqrt{x} + \sqrt{x+7} = 7").solve("x")    // → [9]
// Verify: √9 + √16 = 3 + 4 = 7 ✓

ce.parse("\sqrt{x+5} - \sqrt{x-3} = 2").solve("x")  // → [4]
// Verify: √9 - √1 = 3 - 1 = 2 ✓

ce.parse("\sqrt{2x+1} + \sqrt{x-1} = 4").solve("x") // → [46 - 8√29] ≈ 2.919
```

**Files modified:**

- `src/compute-engine/boxed-expression/solve.ts` - Added `solveTwoSqrtEquation()`
  and `solveTwoSqrtEquationCore()` functions, integrated into `findUnivariateRoots()`
- `test/compute-engine/solve.test.ts` - Added 5 new tests in "TWO SQRT EQUATIONS
  (Pattern 3)" describe block
- `requirements/TODO.md` - Updated Pattern 3 as implemented


---

### 31. Exact Rational Arithmetic in Linear Systems ✅

**IMPLEMENTED:** The linear system solver now uses exact rational arithmetic
throughout the Gaussian elimination process. Systems with fractional
coefficients produce exact fractional results rather than floating-point
approximations.

**Problem:** The solver used floating-point comparison (`Math.abs(val) >
Math.abs(maxVal)`) for pivot selection, which could introduce numerical errors
for exact symbolic computation.

**Solution:** Added two new helper functions:

1. `compareAbsoluteValues(a, b)` - Compares absolute values symbolically:
   - Uses `.abs()` to get absolute values
   - Compares exact numeric values when both expressions are numeric
   - Falls back to numeric comparison only when necessary
   - Returns `1`, `0`, `-1`, or `undefined`

2. `isEffectivelyZero(expr)` - Checks for zero symbolically:
   - First tries `.is(0)` for exact symbolic check
   - Then tries `.simplify().is(0)`
   - Falls back to numeric check with small tolerance only if needed

**Examples that now work:**

```typescript
const e = ce.parse('\\begin{cases}x+y=1\\\\x-y=1/2\\end{cases}');
const result = e.solve(['x', 'y']);
console.log(result.x.json);  // ["Rational", 3, 4]  (exact 3/4)
console.log(result.y.json);  // ["Rational", 1, 4]  (exact 1/4)

// Fractional coefficients
const e2 = ce.parse('\\begin{cases}x/3+y/2=1\\\\x/4+y/5=1\\end{cases}');
const result2 = e2.solve(['x', 'y']);
// → { x: 36/7, y: -10/7 }  (exact rationals)
```

**Files modified:**

- `src/compute-engine/boxed-expression/solve-linear-system.ts` - Added
  `compareAbsoluteValues()` and `isEffectivelyZero()` functions, updated
  `gaussianElimination()` to use them
- `test/compute-engine/solve.test.ts` - Added 4 new tests for exact rational
  arithmetic
- `CHANGELOG.md` and `doc/changelog.md` - Documented the feature
- `doc/17-guide-linear-algebra.md` - Added "Exact Rational Arithmetic" section

---

### 28. Non-linear Polynomial Systems ✅

**IMPLEMENTED:** The `solve()` method now handles certain non-linear polynomial
systems with 2 equations and 2 variables.

**Supported patterns:**

1. **Product + sum:** `xy = p, x + y = s` → x and y are roots of `t² - st + p = 0`
2. **Substitution method:** When one equation is linear in one variable, solve
   for it and substitute into the other equation.

**Examples that now work:**

```typescript
// Product + sum pattern
const e = ce.parse('\\begin{cases}xy=6\\\\x+y=5\\end{cases}');
e.solve(['x', 'y']);
// → [{ x: 2, y: 3 }, { x: 3, y: 2 }]

// Substitution method
const e2 = ce.parse('\\begin{cases}x+y=5\\\\x^2+y=7\\end{cases}');
e2.solve(['x', 'y']);
// → [{ x: 2, y: 3 }, { x: -1, y: 6 }]

// No real solutions → returns null
const e3 = ce.parse('\\begin{cases}xy=10\\\\x+y=1\\end{cases}');
e3.solve(['x', 'y']);  // → null (discriminant < 0)
```

**Key implementation details:**

- `solvePolynomialSystem()` dispatches to pattern-specific solvers
- `tryProductSumPattern()` extracts product and sum values, constructs and
  solves the characteristic quadratic
- `trySubstitutionMethod()` solves one equation for a variable, substitutes,
  solves the univariate result
- `filterRealRoots()` and `isRealValue()` filter out complex solutions
- Returns array of solution objects (multiple solutions) unlike linear systems
  which return a single object

**Files modified:**

- `src/compute-engine/boxed-expression/solve-linear-system.ts` - Added
  `solvePolynomialSystem()`, `tryProductSumPattern()`, `trySubstitutionMethod()`,
  and helper functions
- `src/compute-engine/boxed-expression/boxed-function.ts` - Updated `solve()` to
  call polynomial solver after linear solver fails
- `src/compute-engine/global-types.ts` - Updated return type to include
  `Array<Record<string, BoxedExpression>>`
- `src/compute-engine/boxed-expression/abstract-boxed-expression.ts` - Updated
  return type
- `src/compute-engine/boxed-expression/boxed-tensor.ts` - Updated return type
- `test/compute-engine/solve.test.ts` - Added 8 new tests for non-linear systems
- Updated documentation in CHANGELOG.md, doc/changelog.md, and
  doc/17-guide-linear-algebra.md

---

### 30. Linear Inequality Systems ✅

**IMPLEMENTED:** The `solve()` method now handles systems of linear inequalities
in 2 variables, returning the vertices of the feasible region (convex polygon).

**Supported inequality operators:**

- `<` (Less), `<=` (LessEqual), `>` (Greater), `>=` (GreaterEqual)

**Examples that now work:**

```typescript
// Triangle: x >= 0, y >= 0, x + y <= 10
const e = ce.parse('\\begin{cases}x\\geq 0\\\\y\\geq 0\\\\x+y\\leq 10\\end{cases}');
e.solve(['x', 'y']);
// → [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]

// Square: 0 <= x <= 5, 0 <= y <= 5
const square = ce.parse('\\begin{cases}x\\geq 0\\\\x\\leq 5\\\\y\\geq 0\\\\y\\leq 5\\end{cases}');
square.solve(['x', 'y']);
// → [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }]

// Pentagon with multiple constraints
const pentagon = ce.parse('\\begin{cases}x\\geq 0\\\\y\\geq 0\\\\x\\leq 4\\\\y\\leq 4\\\\x+y\\leq 6\\end{cases}');
pentagon.solve(['x', 'y']);
// → 5 vertices in counterclockwise order
```

**Algorithm:**

1. Extract linear constraints from each inequality (normalize to `ax + by + c <= 0`)
2. Find all pairwise intersections of constraint boundary lines
3. Filter to vertices that satisfy all original constraints
4. Order vertices in counterclockwise convex hull order
5. Return as array of coordinate objects

**Limitations:**

- Only supports 2-variable systems
- Returns `null` for infeasible regions (no valid vertices)
- Returns `null` for non-linear constraints

**Files modified:**

- `src/compute-engine/boxed-expression/solve-linear-system.ts` - Added
  `solveLinearInequalitySystem()` and supporting functions (`extractLinearConstraint()`,
  `findLineIntersection()`, `satisfiesConstraint()`, `orderConvexHull()`)
- `src/compute-engine/boxed-expression/boxed-function.ts` - Updated `solve()` to
  detect and dispatch to inequality solver
- `test/compute-engine/solve.test.ts` - Added 8 new tests for inequality systems
- `doc/17-guide-linear-algebra.md` - Added documentation for linear inequality systems

---

### 27. Under-determined Systems (Parametric Solutions) ✅

**IMPLEMENTED:** The `solve()` method now returns parametric solutions for
under-determined linear systems (fewer equations than variables) instead of
returning `null`.

**Examples that now work:**

```typescript
// Single equation with two variables
const e = ce.parse('\\begin{cases}x+y=5\\end{cases}');
e.solve(['x', 'y']);
// → { x: -y + 5, y: y }  (y is a free variable)

// Two equations with three variables
const e2 = ce.parse('\\begin{cases}x+y+z=6\\\\x-y=2\\end{cases}');
e2.solve(['x', 'y', 'z']);
// → { x: -z/2 + 4, y: -z/2 + 2, z: z }  (z is a free variable)

// Three equations with four variables (one free variable)
const e3 = ce.parse('\\begin{cases}a+b+c+d=10\\\\a-b=2\\\\c+d=4\\end{cases}');
e3.solve(['a', 'b', 'c', 'd']);
// → { a: 4, b: 2, c: -d + 4, d: d }  (d is a free variable)
```

**Algorithm:**

1. Build augmented matrix [A|b] from the linear equations
2. Apply Gaussian elimination with partial pivoting
3. Identify pivot columns (bound variables) and free columns (free variables)
4. For each free variable, set its solution to itself (as a symbol)
5. Back-substitute to express pivot variables in terms of free variables
6. Return a dictionary mapping each variable to its (possibly parametric) solution

**Key implementation details:**

- Uses `solveParametric()` function when `m < n` (fewer equations than variables)
- Free variables appear as themselves in the solution (e.g., `z` maps to symbol `z`)
- Pivot variables are expressed as linear combinations of free variables
- Returns `null` for inconsistent systems (no solution)
- Properly handles symbolic coefficients in back-substitution

**Files modified:**

- `src/compute-engine/boxed-expression/solve-linear-system.ts` - Added
  `solveParametric()` function with Gaussian elimination and back-substitution
  for under-determined systems
- `test/compute-engine/solve.test.ts` - Added 5 new tests for parametric solutions
  and updated existing test to expect parametric result

---

### 33. Polynomial Factoring ✅

**IMPLEMENTED:** Polynomial factoring capability for perfect square trinomials,
difference of squares, and quadratic factoring. Enables simplification of
expressions like `√(x²+2x+1)` → `|x+1|`. Fixes issue #180.

**Factoring functions implemented:**

- `factorPerfectSquare()` - Detects a² ± 2ab + b² → (a±b)²
- `factorDifferenceOfSquares()` - Detects a² - b² → (a-b)(a+b)
- `factorQuadratic()` - Factors ax² + bx + c when roots are rational
- `factorPolynomial()` - Combined entry point that tries all strategies

**Examples that now work:**

```typescript
// Perfect square trinomials in sqrt
ce.parse('\\sqrt{x^2+2x+1}').simplify().latex;      // → "|x+1|"
ce.parse('\\sqrt{a^2+2ab+b^2}').simplify().latex;   // → "|a+b|"
ce.parse('\\sqrt{a^2-2ab+b^2}').simplify().latex;   // → "|a-b|"
ce.parse('\\sqrt{4x^2-12x+9}').simplify().latex;    // → "|2x-3|"

// Direct factoring
factorPolynomial(ce.parse('x^2+5x+6'), 'x').latex;  // → "(x+2)(x+3)"
factorPolynomial(ce.parse('x^2-4'), 'x').latex;     // → "(x-2)(x+2)"
factorPolynomial(ce.parse('2x^2-8'), 'x').latex;    // → "2(x-2)(x+2)"

// Rational expression simplification
ce.parse('\\frac{x^2-1}{x-1}').simplify().latex;    // → "x+1"
```

**Integration with sqrt simplification:**

The `simplify-power.ts` file calls `factorPerfectSquare()` when simplifying
`Sqrt` of `Add` expressions, enabling automatic simplification of perfect
square trinomials inside square roots.

**Files modified:**

- `src/compute-engine/boxed-expression/factor.ts` - Added `factorPerfectSquare()`,
  `factorDifferenceOfSquares()`, `factorQuadratic()`, `factorPolynomial()`, and
  helper `extractSquareRoot()`
- `src/compute-engine/symbolic/simplify-power.ts` - Integrated perfect square
  and difference of squares detection in Sqrt simplification
- `test/compute-engine/factor.test.ts` - Comprehensive test suite with 30+ tests
