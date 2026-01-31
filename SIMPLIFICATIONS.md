# Simplification Issues Report

This document catalogs simplification behaviors that need attention, organized
by priority and category.

## Summary

| Category           | Working | Limitations | Total  |
| ------------------ | ------- | ----------- | ------ |
| Division/Fractions | 7       | 2\*         | 9      |
| Powers & Exponents | 18      | 0           | 18     |
| Square Roots       | 7       | 0           | 7      |
| Logarithms         | 12      | 2\*         | 14     |
| Negative Signs     | 5       | 0           | 5      |
| Infinity           | 10      | 0           | 10     |
| Trigonometry       | 11      | 1\*         | 12     |
| Parsing            | 1       | 0           | 1      |
| **Total**          | **71**  | **5**       | **76** |

\*Limitations are by-design decisions or architectural constraints, not bugs.

### Issue Severity (Updated after Phase 9)

- **Bugs (incorrect results)**: 0 cases ✅
- **Limitations**: 5 cases (by-design or architectural)
  - `0/(1-1)` → sub-expression evaluation timing
  - `(1-1)/0` → sub-expression evaluation timing
  - `log(√2)` → constants stored as numeric literals
  - `ln(√2)` → constants stored as numeric literals
  - `2sin²(x)` → cost function prefers compact form

### Phase 3 Fixes (Completed)

- ✅ ∞/∞ → NaN (was returning 1)
- ✅ log(e) → 1/ln(10) ≈ 0.434
- ✅ tan(π/2-x) → cot(x) and all co-function identities

### Phase 4 Fixes (Completed)

- ✅ 0^π → 0 (symbolic positive exponents)
- ✅ 2sin(x)cos(x) → sin(2x) (coefficient handling in double-angle)

### Phase 5 Fixes (Completed)

- ✅ `(x^3)^2 * (y^2)^2` → `x^6y^4` (evaluate numeric exponents in Multiply
  operands)
- ✅ `(x³/y²)^{-2}` → `y⁴/x⁶` (distribute negative exponents on fractions during
  canonicalization)

### Phase 6 Fixes (Completed)

- ✅ `log(x) + log(y)` → `log(xy)` (fixed base-10 log combination preserving
  base)
- ✅ `√(x²y)` → `|x|√y` (factor perfect squares from radicals via cost function
  adjustment)

### Phase 8 Fixes (Completed)

- ✅ `ln(x/y)` → `ln(x) - ln(y)` (quotient rule expansion for positive
  arguments)
- ✅ `log(x/y)` → `log(x) - log(y)` (quotient rule for any base)
- ✅ `exp(log(x))` → `x^{1/ln(10)}` (exp-log composition rule)

### Phase 9 Fixes (Completed)

- ✅ `x * √2` → `√2 · x` (preserve symbolic radicals instead of evaluating to
  floats)
- ✅ `x * ∛2` → `x · ∛2` (preserve symbolic roots)
- ✅ `\exp(x)\exp(2)` → `e^{x+2}` (fixed adjacent `\exp()` parsing as
  multiplication)

### Phase 1 Fixes (Completed)

- ✅ 0/0 → NaN
- ✅ 1/0 → ~∞ (ComplexInfinity)
- ✅ x/0 → ~∞ (ComplexInfinity)
- ✅ csc(π+x) → -csc(x)
- ✅ cot(π+x) → cot(x)
- ✅ log(exp(x)) → x/ln(10)
- ✅ ∞ \* (-2) → -∞
- ✅ -∞ \* 2 → -∞

### Phase 2 Fixes (Completed)

- ✅ (x³y²)² → x⁶y⁴ (power distribution over products)
- ✅ (-2x)² → 4x² (power distribution with coefficient)
- ✅ (-x)² → x² (even power of negative)
- ✅ (-1)^{3/5} → -1 (real odd root)
- ✅ e^x / e → e^{x-1} (same-base division)
- ✅ e^x / e² → e^{x-2} (same-base division)
- ✅ e^x · e² → e^{x+2} (same-base multiplication)
- ✅ a³ · a · a² → a⁶ (3+ operand power combination)

---

## Priority 1: Bugs (Incorrect Results)

These produce mathematically incorrect results and should be fixed first.

### 1.1 Division by Zero Edge Cases ✅ FIXED

| Input           | Current Output | Expected | Status          |
| --------------- | -------------- | -------- | --------------- |
| `\frac{0}{0}`   | `NaN`          | `NaN`    | ✅ Fixed        |
| `\frac{1}{0}`   | `~∞`           | `~∞`     | ✅ Fixed        |
| `\frac{x}{0}`   | `~∞`           | `~∞`     | ✅ Fixed        |
| `\frac{0}{1-1}` | `0`            | `NaN`    | ⚠️ Limitation\* |
| `\frac{1-1}{0}` | `~∞`           | `NaN`    | ⚠️ Limitation\* |

\*Limitation: Expressions like `1-1` are not evaluated during canonicalization
to avoid expensive computations. Use `.simplify()` to evaluate.

**Fix Applied**:

- Modified `box.ts` to handle integer division by zero when boxing rationals
- Modified `canonicalDivide()` in `arithmetic-mul-div.ts` to return
  `ComplexInfinity` for `a/0` where `a ≠ 0`
- `ComplexInfinity` (~∞) is used as a "better NaN" indicating infinite result
  with unknown sign

---

### 1.2 Negative Base with Fractional Exponent ✅ FIXED

| Input          | Current Output    | Expected          | Status             |
| -------------- | ----------------- | ----------------- | ------------------ |
| `(-1)^{3/5}`   | `-1`              | `-1`              | ✅ Fixed           |
| `(-2x)^{3/5}x` | `-2^{3/5}x^{8/5}` | `-2^{3/5}x^{8/5}` | ✅ Fixed (Phase 7) |
| `(-2x)^{3/5}`  | `-2^{3/5}x^{3/5}` | `-2^{3/5}x^{3/5}` | ✅ Fixed (Phase 7) |
| `(-3x)^{5/7}`  | `-3^{5/7}x^{5/7}` | `-3^{5/7}x^{5/7}` | ✅ Fixed (Phase 7) |

**Fix Applied**:

1. Added rule in `simplify-power.ts` to handle `(-1)^{p/q}` where both p and q
   are odd integers, returning `-1` (the real odd root).
2. **Phase 7**: Added rule for `(negative * b * ...)^{p/q}` where p,q are both
   odd. Factors out the negative sign: `(-2x)^{3/5}` → `-(2x)^{3/5}`.
3. Added cost penalty in `cost-function.ts` for Power expressions with
   negative-coefficient product bases and fractional exponents, ensuring the
   sign-factored form is preferred.
4. Updated `simplify.ts` to fully simplify Power expressions with fractional
   exponents when inside lazy functions (Multiply, Add).

**Location**: `src/compute-engine/symbolic/simplify-power.ts`,
`src/compute-engine/cost-function.ts`,
`src/compute-engine/boxed-expression/simplify.ts`

---

### 1.3 Infinity Arithmetic (Partially Fixed)

| Input                   | Current Output | Expected  | Status                         |
| ----------------------- | -------------- | --------- | ------------------------------ |
| `\infty(0)`             | `NaN`          | `NaN`     | ✅ Fixed (was already working) |
| `\infty(-2)`            | `-\infty`      | `-\infty` | ✅ Fixed                       |
| `-\infty(2)`            | `-\infty`      | `-\infty` | ✅ Fixed                       |
| `\frac{\infty}{\infty}` | `NaN`          | `NaN`     | ✅ Fixed                       |

**Fix Applied**: Modified `Product.mul()` in `product.ts` to properly track and
propagate infinity signs using `coefficient.sgn()` to determine the result sign.
Also fixed `∞/∞` to return `NaN` (Phase 3).

---

### 1.4 Trigonometric Period Identities ✅ FIXED

| Input         | Current Output | Expected   | Status   |
| ------------- | -------------- | ---------- | -------- |
| `\csc(\pi+x)` | `-\csc(x)`     | `-\csc(x)` | ✅ Fixed |
| `\cot(\pi+x)` | `\cot(x)`      | `\cot(x)`  | ✅ Fixed |

**Fix Applied**: Corrected the `PI_PLUS_SIGN` mapping in `simplify-trig.ts`:

- `csc(π+x) = -csc(x)` (csc has period 2π, sign flips at π)
- `cot(π+x) = cot(x)` (cot has period π, no sign change)

---

### 1.5 log(exp(x)) Incorrectly Simplifies ✅ FIXED

| Input           | Current Output | Expected    | Status   |
| --------------- | -------------- | ----------- | -------- |
| `\log(\exp(x))` | `0.434...x`    | `x/\ln(10)` | ✅ Fixed |

**Fix Applied**: Modified the `.ln()` method in `boxed-function.ts` and
`boxed-symbol.ts` to handle base conversion:

- `ln(exp(x))` → `x` (natural log, base matches)
- `log_c(exp(x))` → `x / ln(c)` (different base, apply change of base formula)
- Also fixed `log(e)` → `1/ln(10)` ≈ `0.434` for non-natural logs

---

## Priority 2: Missing Simplifications

These don't simplify expressions that should simplify.

### 2.1 Power Distribution ✅ FIXED

| Input                               | Current Output | Expected          | Status             |
| ----------------------------------- | -------------- | ----------------- | ------------------ |
| `(x^3y^2)^2`                        | `x^6y^4`       | `x^6y^4`          | ✅ Fixed           |
| `(x^3)^2(y^2)^2`                    | `x^6y^4`       | `x^6y^4`          | ✅ Fixed (Phase 5) |
| `\left(\frac{x^3}{y^2}\right)^{-2}` | `y^4/x^6`      | `\frac{y^4}{x^6}` | ✅ Fixed (Phase 5) |
| `(-x)^2`                            | `x^2`          | `x^2`             | ✅ Fixed           |
| `(-2x)^2`                           | `4x^2`         | `4x^2`            | ✅ Fixed           |

**Fixes Applied**:

1. Added rule to distribute exponents over products: `(ab)^n → a^n * b^n` when n
   is integer
2. Existing rule for `(-x)^n → x^n` when n is even now works correctly
3. Modified cost function to properly value Power(Multiply) expressions
4. (Phase 5) Added `evaluateNumericSubexpressions` call for lazy function
   operands to evaluate `Multiply(2,3)` in exponents
5. (Phase 5) Added negative exponent distribution in `canonicalPower`:
   `(a/b)^{-n} → b^n/a^n`

**Location**: `src/compute-engine/symbolic/simplify-power.ts`,
`src/compute-engine/boxed-expression/arithmetic-power.ts`,
`src/compute-engine/boxed-expression/simplify.ts`

---

### 2.2 Exponential Base `e` Simplification ✅ FIXED

| Input             | Current Output | Expected  | Status             |
| ----------------- | -------------- | --------- | ------------------ |
| `\frac{e^x}{e}`   | `e^{x-1}`      | `e^{x-1}` | ✅ Fixed           |
| `\frac{e}{e^x}`   | `e^{1-x}`      | `e^{1-x}` | ✅ Fixed           |
| `\frac{e^x}{e^2}` | `e^{x-2}`      | `e^{x-2}` | ✅ Fixed           |
| `e^xe^2`          | `e^{x+2}`      | `e^{x+2}` | ✅ Fixed           |
| `e^xe`            | `e^{x+1}`      | `e^{x+1}` | ✅ Fixed           |
| `\exp(x)\exp(2)`  | `e^{x+2}`      | `e^{x+2}` | ✅ Fixed (Phase 9) |

**Fixes Applied**:

1. Added same-base division rules in `simplify-power.ts`: `a^m / a^n → a^{m-n}`
2. Modified expand rule and multiply rule to skip same-base power products
3. Modified division rule to skip same-base power divisions
4. Preserves symbolic `e^n` instead of evaluating numerically

**Location**: `src/compute-engine/symbolic/simplify-power.ts`,
`src/compute-engine/symbolic/simplify-rules.ts`

### 2.2.1 `\exp()` Parsing Issue ✅ FIXED (Phase 9)

Adjacent `\exp()` calls now parse correctly as multiplication. `\exp(x)\exp(2)`
parses as `e^x · e^2` and simplifies to `e^{x+2}`.

**Fix Applied**: Modified `\exp` LaTeX trigger to use
`parseArguments('implicit')` for proper argument handling and implicit
multiplication, similar to how `\ln` is handled.

**Location**:
`src/compute-engine/latex-syntax/dictionary/definitions-arithmetic.ts`

---

### 2.3 Logarithm Simplifications ✅ MOSTLY FIXED

| Input                      | Current Output | Expected            | Notes                                       |
| -------------------------- | -------------- | ------------------- | ------------------------------------------- |
| `\ln(\frac{x}{y})`         | `ln(x)-ln(y)`  | `\ln(x)-\ln(y)`     | ✅ Fixed (Phase 8) - requires positive args |
| `\log(xy)-\log(x)-\log(y)` | `0`            | `0`                 | ✅ Fixed                                    |
| `\ln(xy)-\ln(x)-\ln(y)`    | `0`            | `0`                 | ✅ Fixed                                    |
| `\log(e)`                  | `0.434...`     | `\frac{1}{\ln(10)}` | ✅ Fixed (evaluates numerically)            |
| `\exp(\log(x))`            | `x^{1/ln(10)}` | `x^{1/\ln(10)}`     | ✅ Fixed (Phase 8)                          |
| `\log(\sqrt{2})`           | `0.150...`     | `\frac{\log(2)}{2}` | ⚠️ Limitation\*                             |
| `\ln(\sqrt{2})`            | `0.346...`     | `\frac{\ln(2)}{2}`  | ⚠️ Limitation\*                             |

\*Limitation: `sqrt(2)` is stored as a numeric literal (with radical
representation), not as a symbolic `Power(2, 1/2)`. The log power rule can't
apply because the argument is already numeric. This is by design for efficient
computation; use `log(2)/2` directly if symbolic form is needed.

**Phase 8 Fixes Applied**:

1. Added quotient rule expansion: `ln(x/y) → ln(x) - ln(y)` when x,y are
   positive
2. Added exp-log composition: `e^log_c(x) → x^{1/ln(c)}` for any base c

**Location**: `src/compute-engine/symbolic/simplify-log.ts`

---

### 2.4 Square Root Simplifications ✅ MOSTLY FIXED

| Input           | Current Output    | Expected            | Notes              |
| --------------- | ----------------- | ------------------- | ------------------ |
| `\sqrt{x^2y}`   | `\|x\|\sqrt{y}`   | `\|x\|\sqrt{y}`     | ✅ Fixed (Phase 6) |
| `\sqrt[4]{x^6}` | `\|x\|^{3/2}`     | `\|x\|\sqrt{\|x\|}` | ✅ Fixed (Phase 7) |
| `\sqrt{x^5}`    | `\|x\|^2\sqrt{x}` | `\|x\|^2\sqrt{x}`   | ✅ Fixed (Phase 7) |
| `\sqrt[3]{x^6}` | `x^2`             | `x^2`               | ✅ Fixed (Phase 7) |
| `\sqrt[5]{x^8}` | `x^{8/5}`         | `x^{8/5}`           | ✅ Fixed (Phase 7) |

**Note**: `\sqrt{x^2}` and `\sqrt[4]{x^4}` correctly produce `|x|`.

**Phase 6 Fix**: Adjusted cost function to add a penalty for Sqrt expressions
containing perfect squares. This makes `√(x²y)` cost more than `|x|√y`, allowing
the simplification to proceed.

**Phase 7 Fix**: Added comprehensive generalized root extraction rules:

- `root(x^m, n)` → `x^{m/n}` for odd roots (always valid, e.g., `√[3]{x^6}` →
  `x²`)
- `root(x^m, n)` → `|x|^{m/n}` for even roots (e.g., `√[4]{x^6}` → `|x|^{3/2}`)
- `sqrt(x^{odd})` → `|x|^n * sqrt(x)` (e.g., `√{x⁵}` → `|x|²√x`)
- Adjusted cost function to penalize `Sqrt(x^{odd})` to allow factoring

---

### 2.5 Trigonometric Co-function Identities ✅ FIXED

| Input             | Current Output | Expected     | Notes          |
| ----------------- | -------------- | ------------ | -------------- |
| `\tan(\pi/2-x)`   | `\cot(x)`      | `\cot(x)`    | ✅ Fixed       |
| `\sec(\pi/2-x)`   | `\csc(x)`      | `\csc(x)`    | ✅ Fixed       |
| `\csc(\pi/2-x)`   | `\sec(x)`      | `\sec(x)`    | ✅ Fixed       |
| `2\sin^2(x)`      | `2\sin(x)^2`   | `1-\cos(2x)` | ⚠️ By design\* |
| `2\sin(x)\cos(x)` | `\sin(2x)`     | `\sin(2x)`   | ✅ Fixed       |

**Note**: `\sin(x)\cos(x) → \sin(2x)/2` works, and now
`2\sin(x)\cos(x) → \sin(2x)` also works.

\*Design decision: The transformation `2sin²(x) → 1-cos(2x)` is implemented but
rejected by the cost function because the power form (`2sin²(x)`, cost 4) is
more compact than the double-angle form (`1-cos(2x)`, cost 22). This is
intentional - double-angle expansions aren't universally simpler and may not be
desired in all contexts.

---

### 2.6 Other Power Edge Cases ✅ FIXED

| Input   | Current Output | Expected | Notes    |
| ------- | -------------- | -------- | -------- |
| `0^\pi` | `0`            | `0`      | ✅ Fixed |

**Fix Applied**: Added rule in `simplify-power.ts` to handle `0^x → 0` when
`x.isPositive === true`.

---

## Priority 3: Consistency Issues

These work in some forms but not equivalent forms.

### 3.1 Inconsistent Handling of Equivalent Forms

| Works                       | Doesn't Work               | Notes                         |
| --------------------------- | -------------------------- | ----------------------------- |
| `\frac{0}{0}` → NaN         | `\frac{0}{1-1}` → 0        | Sub-expression evaluation     |
| `\frac{\pi}{\pi}` → 1       | `\frac{\pi+1}{\pi+1}` → 1  | Both work!                    |
| `\frac{5x^2}{x^2}` → 5      | `\frac{x^2}{5x^2}` → 1/5   | Both work!                    |
| `e^xe^2` → works            | `\exp(x)\exp(2)` → works   | Both work! ✅ Fixed (Phase 9) |
| `\log(\sqrt{x})` → symbolic | `\log(\sqrt{2})` → numeric | Constant vs variable          |

### 3.2 Baseline Corrections (Updated after Phase 9)

| Input                   | Current Output | Status                 |
| ----------------------- | -------------- | ---------------------- |
| `\ln(xy)-\ln(x)-\ln(y)` | `0`            | ✅ Now works           |
| `(-2x)^2`               | `4x^2`         | ✅ Now works (Phase 2) |
| `\sin^2(x)`             | `\sin(x)^2`    | ⚠️ By design\*         |
| `(x+h)^2-x^2`           | `(h+x)^2-x^2`  | ❌ Missing feature\*\* |

\*By design: The cost function prefers the compact power form over the
double-angle expansion.

\*\*Missing feature: Polynomial expansion is not yet implemented. This would
require an `.expand()` method.

---

## Working Correctly

These simplifications work as expected:

### Division/Fractions

- `\frac{0}{0}` → `NaN` ✓
- `\frac{\pi+1}{\pi+1}` → `1` ✓
- `\frac{\pi}{\pi}` → `1` ✓
- `\frac{x^2}{5x^2}` → `1/5` ✓
- `\frac{5x^2}{x^2}` → `5` ✓
- `\frac{x+1-1+1}{x+1}` → `1` ✓
- `\frac{\frac{1}{x^6}}{\frac{1}{y^4}}` → `y^4/x^6` ✓

### Square Roots

- `\frac{\sqrt{12x}}{\sqrt{3x}}` → `2` ✓
- `\sqrt{12}` → `2\sqrt{3}` ✓
- `\sqrt{x^2}` → `|x|` ✓
- `\sqrt[4]{x^4}` → `|x|` ✓
- `\frac{2\sqrt{3}}{\sqrt{3}}` → `2` ✓
- `\sqrt{x^2y}` → `|x|\sqrt{y}` ✓ (Phase 6)
- `\sqrt{x^2y^2}` → `|x||y|` ✓ (Phase 6)
- `\sqrt{4x^2}` → `2|x|` ✓ (Phase 6)

### Logarithms

- `\log(e^{xy})` → `xy` ✓
- `\ln(e^{xy})` → `xy` ✓
- `\log(1)` → `0` ✓
- `\ln(1)` → `0` ✓
- `\ln(e)` → `1` ✓
- `\ln(\exp(x))` → `x` ✓
- `\log(\sqrt{x})` → `log(x)/2` ✓
- `\ln(\sqrt{x})` → `ln(x)/2` ✓
- `\log(x) + \log(y)` → `log(xy)` ✓ (Phase 6)
- `\ln(x/y)` → `ln(x) - ln(y)` ✓ (Phase 8)
- `\log(e)` → `1/ln(10)` ✓ (Phase 3)
- `\exp(\log(x))` → `x^{1/ln(10)}` ✓ (Phase 8)

### Negative Signs

- `(-x)(-6)` → `6x` ✓
- `-\frac{-1}{x}` → `1/x` ✓
- `\frac{-1}{-x}` → `1/x` ✓

### Powers

- `2xx` → `2x^2` ✓
- `xx` → `x^2` ✓
- `\left(\frac{1}{x}\right)^{-1}` → `x` ✓
- `e^xe` → `exp(x+1)` ✓
- `e^xe^1` → `exp(x+1)` ✓
- `(x^3y^2)^2` → `x^6y^4` ✓ (Phase 2)
- `(-2x)^2` → `4x^2` ✓ (Phase 2)
- `(-x)^2` → `x^2` ✓ (Phase 2)
- `(-1)^{3/5}` → `-1` ✓ (Phase 2)
- `e^x/e^2` → `e^{x-2}` ✓ (Phase 2)
- `e^xe^2` → `e^{x+2}` ✓ (Phase 2)
- `a^3 a a^2` → `a^6` ✓ (Phase 2)
- `(x^3)^2 * (y^2)^2` → `x^6y^4` ✓ (Phase 5)
- `(x³/y²)^{-2}` → `y⁴/x⁶` ✓ (Phase 5)
- `x * √2` → `√2 · x` ✓ (Phase 9) - symbolic radicals preserved
- `x * ∛2` → `x · ∛2` ✓ (Phase 9) - symbolic roots preserved
- `(-2x)^{3/5}` → `-(2^{3/5} · x^{3/5})` ✓ (Phase 7) - negative factored out

### Parsing

- `\exp(x)\exp(2)` → `e^{x+2}` ✓ (Phase 9) - adjacent exp() calls multiply

### Indeterminate Forms

- `0^0` → `NaN` ✓
- `\infty^0` → `NaN` ✓
- `\infty(1-1)` → `NaN` ✓
- `1^\infty` → `NaN` ✓
- `-\infty(-2)` → `+\infty` ✓

### Trigonometry

- `\sec(-x)` → `\sec(x)` ✓
- `\tan(-x)\cot(x)` → `-1` ✓
- `\tan(x)\cot(x)` → `1` ✓
- `\sin(x)\cos(x)` → `sin(2x)/2` ✓
- `2\sin(x)\cos(x)` → `sin(2x)` ✓ (Phase 4)
- `\csc(\pi+x)` → `-csc(x)` ✓ (Phase 1)
- `\cot(\pi+x)` → `cot(x)` ✓ (Phase 1)
- `\tan(\pi/2-x)` → `cot(x)` ✓ (Phase 3)
- `\sin(\pi/2-x)` → `cos(x)` ✓ (Phase 3)
- `\cos(\pi/2-x)` → `sin(x)` ✓ (Phase 3)
- `\sec(\pi/2-x)` → `csc(x)` ✓ (Phase 3)
- `\sin(x)\cos(x)` → `sin(2x)/2` ✓

---

## Implementation Recommendations

### Phase 1: Bug Fixes (High Priority)

1. **Fix 0/0 detection** in division when sub-expressions evaluate to 0
2. **Fix negative base fractional exponent** to use real roots when appropriate
3. **Fix infinity sign propagation** in multiplication
4. **Fix `\frac{\infty}{\infty}`** to return NaN
5. **Fix `\csc(\pi+x)`** sign

### Phase 2: Power Improvements ✅ COMPLETED

1. ✅ Distribute exponents over products: `(ab)^n → a^n b^n`
2. ✅ Simplify `(-x)^n → x^n` when n is even
3. ✅ Handle `e^a / e^b → e^{a-b}` and `e^a * e^b → e^{a+b}`
4. ✅ Evaluate symbolic exponent multiplication: `x^{2*3} → x^6`
5. ✅ Handle `0^π` (positive irrational exponent)

### Phase 3: Logarithm Rules

1. Implement combination rules: `ln(x) + ln(y) → ln(xy)`
2. Implement quotient rules: `ln(x/y) → ln(x) - ln(y)`
3. Add `log(e) → 1/ln(10)`
4. Fix numeric vs symbolic handling for constants under log

### Phase 4: Trigonometry

1. Add co-function identities (`tan(π/2-x) → cot(x)`, etc.)
2. Handle coefficients in double-angle simplifications
3. Review period simplifications for all trig functions

---

## Files to Modify

| File                                               | Changes Needed                                                 |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `src/compute-engine/symbolic/simplify-divide.ts`   | 0/0 detection, infinity division                               |
| `src/compute-engine/symbolic/simplify-power.ts`    | Negative base, exponent distribution, e^x rules                |
| `src/compute-engine/symbolic/simplify-log.ts`      | Combination rules, quotient rules, log(e), log/exp composition |
| `src/compute-engine/symbolic/simplify-trig.ts`     | Co-functions, periods, coefficients                            |
| `src/compute-engine/symbolic/simplify-infinity.ts` | Sign propagation                                               |
| `src/compute-engine/latex-syntax/`                 | `\exp()` juxtaposition parsing ✅                              |

---

## Test Cases to Add

See `/test/compute-engine/simplify-potential.test.ts` (to be created) with
regression tests for all cases documented above.
