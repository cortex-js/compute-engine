# Simplification Status Report

This document tracks the current status of simplification in the Compute Engine, including working features, known limitations, and remaining tasks.

**Checked**: 2026-02-10
**Compute Engine version**: 0.35.6

---

## 1. Summary of Progress

| Category           | Working | Limitations | Total  |
| ------------------ | ------- | ----------- | ------ |
| Division/Fractions | 7       | 2*          | 9      |
| Powers & Exponents | 18      | 0           | 18     |
| Square Roots       | 7       | 0           | 7      |
| Logarithms         | 12      | 2*          | 14     |
| Negative Signs     | 5       | 0           | 5      |
| Infinity           | 10      | 0           | 10     |
| Trigonometry       | 11      | 1*          | 12     |
| Parsing            | 1       | 0           | 1      |
| **Total**          | **71**  | **5**       | **76** |

\*Limitations are by-design decisions or architectural constraints, not bugs.

### Exact Numeric Folding (Canonicalization)

Canonicalization now folds exact numeric operands in `Add` and `Multiply` expressions. This happens automatically when expressions are boxed or parsed (before any `.simplify()` call).

**Folding rules applied:**
- `Add(2, x, 5)` → `Add(x, 7)`
- `Add(1/3, x, 2/3)` → `Add(x, 1)`
- `Add(√2, x, √2)` → `Add(x, 2√2)`
- `Multiply(2, x, 5)` → `Multiply(10, x)`
- `Multiply(1/2, x, 2)` → `x`

---

## 2. Remaining Tasks (Skipped Tests)

There are **19 skipped tests** remaining in `test/compute-engine/simplify.test.ts`. This list identifies items still requiring resolution.

### 2.1 Logarithm Rules
- **Log of quotient involving e** (Line 498): `ln((x+1)/e^{2x})` → `ln(x+1) - 2x`. Operand simplification expands the fraction before the log quotient rule fires. Deep ordering issue.
- **Mixed log product identity** (Line 548): `log_c(a) * ln(a)` → `ln(c)`. **Note**: This test is mathematically wrong. `log_c(a)*ln(a) = ln(a)²/ln(c)`, not `ln(c)`. Likely intended: `log_a(c)*ln(a) = ln(c)`.

### 2.2 Powers and Roots
- **Negative base** (Line 404): `(-x)^{3/4}` → `x^{3/4}`. **Wrong test** — complex for x > 0.
- **Symbolic exponent** (Line 441): `x^{sqrt(2)}/x^3` → `x^{sqrt(2)-3}`. `sqrt(2).sub(3)` evaluates to float.
- **Root factoring** (Line 447): `root4(16b^4)` → `2|b|`. Factor numeric coefficients from roots.

### 2.3 Common Denominator (Lines 458, 460)
- `1/(x+1) - 1/x` → `-1/(x^2+x)`
- `1/x - 1/(x+1)` → `1/(x^2+x)`
Requires finding a common denominator for fractions with polynomial denominators — a significant new capability.

### 2.4 Multi-Variable Expansion (Line 466)
- `2*(x+h)^2 - 2*x^2` → `4xh + 2h^2`. Single-variable `(x+1)^2 - x^2 = 2x+1` works. Multi-variable expansion (`(x+h)^2`) does not expand.

### 2.5 Float / Mixed Arithmetic (Lines 43, 58)
- `sqrt(3.1)` → `1.76068168616590091458` (decimal)
- `sqrt(3) + 0.3` → `2.0320508075688772` (decimal)
`simplify()` should trigger numeric evaluation when floats are present.

### 2.6 Inequality Simplification (Line 113)
- `(2*pi + 2*pi*e) < 4*pi` → `1 + e < 2`. Extend inequality GCD-factor-out to handle sums with common factors.

### 2.7 Inverse Hyperbolic ↔ Logarithm Rewrites (Lines 822-835)
- `1/2*ln((x+1)/(x-1))` → `arccoth(x)`
- `ln(x + sqrt(x^2+1))` → `arsinh(x)`
- `ln(x + sqrt(x^2-1))` → `arcosh(x)`
- `1/2*ln((1+x)/(1-x))` → `artanh(x)`
- `ln((1+sqrt(1-x^2))/x)` → `arsech(x)`
- `ln(1/x + sqrt(1/x^2+1))` → `arcsch(x)`

### 2.8 Inverse Trig / Other (Lines 843, 1279)
- `arctan(x/sqrt(1-x^2))` → `arcsin(x)`
- `1 - (1/4)*sin^2(2x) - sin^2(y) - cos^4(x)` → `sin(x+y)*sin(x-y)` (Fu Trig Simplification — Phase 14)

---

## 3. Current Behavior Snapshot (Issue #178)

Checked using `ce.parse(<latex>, { canonical: false }).simplify()`.

| Section   | Issue text                            | Simplified (LaTeX)                                         | Notes                                                                                                        |
| --------- | ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Base      | `x+x`                                 | `2x`                                                       |                                                                                                              |
| Hard      | `\frac{0}{1-1}`                       | `\frac{0}{1-1}`                                            | No longer incorrectly simplifies to 0.                                                                       |
| Hard      | `\frac{1-1}{0}`                       | `\tilde\infty`                                             | Requires explicit evaluation of (1-1) to reach 0/0.                                                          |
| Hard      | `\frac{0}{0}`                         | `\operatorname{NaN}`                                       |                                                                                                              |
| Hard      | `2(x+h)^2-2x^2`                       | `2(h+x)^2-2x^2`                                            | Default simplify does not expand powers.                                                                     |
| Hard      | `\frac{\pi+1}{\pi+1}`                 | `1`                                                        |                                                                                                              |
| Hard      | `\frac{x^2}{5x^2}`                    | `\frac{1}{5}`                                              |                                                                                                              |
| Hard      | `(-1)^{3/5}`                          | `-1`                                                       |                                                                                                              |
| Hard      | `\exp(x)\exp(2)`                      | `\exp(x+2)`                                                | Adjacent `\exp()` calls parse correctly as multiplication.                                                   |
| Hard      | `\frac{x+1-1+1}{x}`                   | `\frac{1}{x}+1`                                            |                                                                                                              |
| Hard      | `\sqrt{12}`                           | `2\sqrt{3}`                                                |                                                                                                              |
| Hard      | `\sqrt{x^2}`                          | `\vert x\vert`                                             |                                                                                                              |
| Logs      | `\ln(\frac{x}{y})`                    | `\ln(\frac{x}{y})`                                         | Quotient expansion is domain-sensitive.                                                                      |
| Logs      | `log(xy)-log(x)-log(y)`               | `0`                                                        |                                                                                                              |
| Exponents | `xx`                                  | `x^2`                                                      | Now simplifies to x^2.                                                                                       |
| Trig      | `2\sin(x)\cos(x)`                     | `\sin(2x)`                                                 |                                                                                                              |

---

## 4. Completed Fixes & Phases

### Phase 9
- ✅ `x * √2` → `√2 · x` (preserve symbolic radicals instead of evaluating to floats)
- ✅ `x * ∛2` → `x · ∛2` (preserve symbolic roots)
- ✅ `\exp(x)\exp(2)` → `e^{x+2}` (fixed adjacent `\exp()` parsing as multiplication)

### Phase 8
- ✅ `ln(x/y)` → `ln(x) - ln(y)` (quotient rule expansion for positive arguments)
- ✅ `log(x/y)` → `log(x) - log(y)` (quotient rule for any base)
- ✅ `exp(log(x))` → `x^{1/ln(10)}` (exp-log composition rule)

### Phase 6
- ✅ `log(x) + log(y)` → `log(xy)` (fixed base-10 log combination preserving base)
- ✅ `√(x²y)` → `|x|√y` (factor perfect squares from radicals via cost function adjustment)

### Phase 5
- ✅ `(x^3)^2 * (y^2)^2` → `x^6y^4` (evaluate numeric exponents in Multiply operands)
- ✅ `(x³/y²)^{-2}` → `y⁴/x⁶` (distribute negative exponents on fractions)

### Phases 1-4
- ✅ 0/0 → NaN, 1/0 → ~∞ (ComplexInfinity)
- ✅ csc(π+x) → -csc(x), cot(π+x) → cot(x)
- ✅ log(exp(x)) → x/ln(10), log(e) → 1/ln(10)
- ✅ (x³y²)² → x⁶y⁴, (-2x)² → 4x², (-x)² → x²
- ✅ e^x / e → e^{x-1}, e^x · e² → e^{x+2}
- ✅ tan(π/2-x) → cot(x), 2sin(x)cos(x) → sin(2x)
- ✅ 0^π → 0 (symbolic positive exponents)