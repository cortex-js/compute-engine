# Remaining Skipped Simplification Tests

There are **19 skipped tests** remaining in `test/compute-engine/simplify.test.ts`
(down from 93 originally). This document lists only the items that still need
resolution.

---

## 1. Logarithm Rules (3 tests)

### 1a. ~~Power rule for general log bases~~ DONE

`log_c(x^n) → n*log_c(x)` — already works for irrational and non-integer
rational exponents. Even exponents now correctly produce `log_c(|x|)`.

### 1b. ~~Ln cancellation~~ MOSTLY DONE

`ln(sqrt(x))-ln(x)/2 = 0` and `ln(3)+ln(1/3) = 0` now pass.
`ln(p/q) → ln(p) - ln(q)` rule added for positive rationals.

### 1c. Log of quotient involving e

| Line | Test                     | Expected          |
| ---- | ------------------------ | ----------------- |
| 498  | `ln((x+1)/e^{2x})`     | `ln(x+1) - 2x`   |

Operand simplification expands the fraction before the log quotient rule fires.
Deep ordering issue.

### 1d. Mixed log product identity

| Line | Test                 | Expected            |
| ---- | -------------------- | ------------------- |
| 548  | `log_c(a) * ln(a)`  | `ln(c)`             |

**NOTE**: This test is mathematically wrong. `log_c(a)*ln(a) = ln(a)²/ln(c)`,
not `ln(c)`. Likely intended: `log_a(c)*ln(a) = ln(c)`.

### 1e. ~~Change of base / ratio~~ DONE

### 1f. ~~Reciprocal base~~ DONE

### 1g. ~~Mixed log identities~~ DONE (except product)

---

## 2. Absolute Value (0 remaining)

All abs tests now pass:
- `|x|^{4/3} = x^{4/3}` — fixed by handling Rational exponents in
  `simplifyAbsPower`
- `|xy| = |x||y|` — multiplicative identity added
- `|x/y| = |x|/|y|` — quotient identity added

---

## 3. Powers and Roots (3 tests)

| Line | Test           | Expected       | Notes                               |
| ---- | -------------- | -------------- | ----------------------------------- |
| 404  | `(-x)^{3/4}`  | `x^{3/4}`     | **Wrong test** — complex for x > 0  |
| 441  | `x^{sqrt(2)}/x^3` | `x^{sqrt(2)-3}` | sqrt(2).sub(3) evaluates to float |
| 447  | `root4(16b^4)` | `2\|b\|`     | Factor numeric coefficients from roots |

---

## 4. Common Denominator (2 tests)

| Line | Test              | Expected         |
| ---- | ----------------- | ---------------- |
| 458  | `1/(x+1) - 1/x`  | `-1/(x^2+x)`   |
| 460  | `1/x - 1/(x+1)`  | `1/(x^2+x)`    |

Requires finding a common denominator for fractions with polynomial
denominators — a significant new capability.

---

## 5. Multi-Variable Expansion (1 test)

| Line | Test                    | Expected         |
| ---- | ----------------------- | ---------------- |
| 466  | `2*(x+h)^2 - 2*x^2`   | `4xh + 2h^2`   |

Single-variable `(x+1)^2 - x^2 = 2x+1` works. Multi-variable expansion
(`(x+h)^2`) does not expand.

---

## 6. Float / Mixed Arithmetic (2 tests)

| Line | Test             | Expected                           |
| ---- | ---------------- | ---------------------------------- |
| 43   | `sqrt(3.1)`      | `1.76068168616590091458` (decimal) |
| 58   | `sqrt(3) + 0.3`  | `2.0320508075688772` (decimal)     |

`simplify()` should trigger numeric evaluation when floats are present.

---

## 7. Inequality Simplification (1 test)

| Line | Test                       | Expected      |
| ---- | -------------------------- | ------------- |
| 113  | `(2*pi + 2*pi*e) < 4*pi`  | `1 + e < 2`  |

Extend inequality GCD-factor-out to handle sums with common factors.

---

## 8. Inverse Hyperbolic ↔ Logarithm Rewrites (6 tests)

| Line | Test                           | Expected      |
| ---- | ------------------------------ | ------------- |
| 822  | `1/2*ln((x+1)/(x-1))`        | `arccoth(x)` |
| 827  | `ln(x + sqrt(x^2+1))`        | `arsinh(x)`  |
| 829  | `ln(x + sqrt(x^2-1))`        | `arcosh(x)`  |
| 831  | `1/2*ln((1+x)/(1-x))`        | `artanh(x)`  |
| 833  | `ln((1+sqrt(1-x^2))/x)`      | `arsech(x)`  |
| 835  | `ln(1/x + sqrt(1/x^2+1))`    | `arcsch(x)`  |

Complex structural pattern-matching. Low priority / niche.

---

## 9. Inverse Trig Rewrite (1 test)

| Line | Test                          | Expected      |
| ---- | ----------------------------- | ------------- |
| 843  | `arctan(x/sqrt(1-x^2))`     | `arcsin(x)`  |

Structural pattern-matching rewrite.

---

## 10. Fu Trig Simplification — Phase 14 (1 test)

| Line | Test                                            | Expected               |
| ---- | ----------------------------------------------- | ---------------------- |
| 1279 | `1 - (1/4)*sin^2(2x) - sin^2(y) - cos^4(x)`  | `sin(x+y)*sin(x-y)`  |

Requires extending the Fu algorithm implementation.

---

## Priority Order

### Medium effort, moderate value

1. **Root factoring** (3) — `root4(16b^4) = 2|b|`
2. **Multi-variable expansion** (5) — `2*(x+h)^2 - 2*x^2`
3. **Log of quotient** (1c) — `ln((x+1)/e^{2x})`

### High effort / niche

4. **Float arithmetic** (6) — N() integration in simplify
5. **Common denominator** (4) — partial fraction / rational expression
6. **Symbolic exponent** (3) — `x^{sqrt(2)}/x^3` (float loss)
7. **Inequality GCD** (7) — extend to sums
8. **Inverse hyp ↔ log rewrites** (8) — complex pattern matching
9. **Inverse trig rewrite** (9) — structural pattern matching
10. **Fu Phase 14** (10) — advanced trig

### Bug / Questionable

- `(-x)^{3/4} = x^{3/4}` — complex for real x > 0, test likely wrong
- `log_c(a)*ln(a) = ln(c)` — mathematically incorrect expected value
