# Remaining Skipped Simplification Tests

There are **42 skipped tests** remaining in `test/compute-engine/simplify.test.ts`
(down from 93 originally). This document lists only the items that still need
resolution.

---

## 1. Logarithm Rules (14 tests)

### 1a. Power rule for general log bases

| Line | Test                  | Expected             |
| ---- | --------------------- | -------------------- |
| 578  | `log_3(x^sqrt(2))`   | `sqrt(2)*log_3(x)`  |
| 587  | `log_4(x^{7/4})`     | `7/4*log_4(x)`      |

The `ln(x^n) → n*ln(x)` rule works but the analogous `log_c(x^n) → n*log_c(x)`
does not fire for arbitrary base `c`.

### 1b. Power rule with even exponent (absolute value needed)

| Line | Test              | Expected             |
| ---- | ----------------- | -------------------- |
| 583  | `log_4(x^2)`     | `2*log_4(\|x\|)`   |
| 585  | `log_4(x^{2/3})` | `2/3*log_4(\|x\|)` |

When the exponent makes `x^n ≥ 0`, the result should use `|x|`.

### 1c. Change of base / ratio

| Line | Test            | Expected |
| ---- | --------------- | -------- |
| 283  | `ln(9)/ln(3)`   | `2`      |

Needs: `ln(a)/ln(b) → log_b(a)`, then evaluate when both are known constants.

### 1d. Ln cancellation / collection

| Line | Test                            | Expected         |
| ---- | ------------------------------- | ---------------- |
| 531  | `ln(x^{2/3}) - 4/3*ln(x)`     | `-2/3*ln(x)`    |
| 536  | `ln(pi^{2/3}) - 1/3*ln(pi)`   | `1/3*ln(pi)`    |
| 541  | `ln(sqrt(x)) - ln(x)/2`       | `0`              |
| 543  | `ln(3) + ln(1/3)`             | `0`              |

Lines 531/541 may have wrong expected values — verify LaTeX parsing.
Line 543 may involve floating-point error (`ln(1/3)` is not exact `-ln(3)`).

### 1e. Exponential of log difference

| Line | Test                | Expected         |
| ---- | ------------------- | ---------------- |
| 553  | `e^{ln(x) - y^2}`  | `x / e^{y^2}`   |

The existing `e^{ln(x) + f}` rule doesn't handle arbitrary non-ln addends.

### 1f. Log of quotient involving e

| Line | Test                     | Expected          |
| ---- | ------------------------ | ----------------- |
| 564  | `ln((x+1)/e^{2x})`     | `ln(x+1) - 2x`   |

The `ln(a/b)` rule exists but may not fire in this context.

### 1g. Reciprocal base

| Line | Test            | Expected       |
| ---- | --------------- | -------------- |
| 574  | `log_{1/2}(x)` | `-log_2(x)`   |

New rule: `log_{1/b}(x) = -log_b(x)`.

### 1h. Mixed log identities with arbitrary base

| Line | Test                 | Expected            |
| ---- | -------------------- | ------------------- |
| 611  | `log_c(c^x * y)`    | `x + log_c(y)`     |
| 613  | `log_c(c^x / y)`    | `x - log_c(y)`     |
| 615  | `log_c(y / c^x)`    | `log_c(y) - x`     |
| 629  | `log_c(a) * ln(a)`  | `ln(c)`             |

Generalize the `ln(e^x * y)` family to `log_c(c^x * y)`.

---

## 2. Absolute Value Identities (5 tests)

| Line | Test                       | Expected      |
| ---- | -------------------------- | ------------- |
| 647  | `\|x\|^{4/3}`            | `x^{4/3}`    |
| 649  | `\|xy\| - \|x\|*\|y\|`  | `0`           |
| 654  | `\|2/x\| - 1/\|x\|`     | `1/\|x\|`   |
| 656  | `\|1/x\| - 1/\|x\|`     | `0`           |
| 658  | `\|x\|\|y\| - \|xy\|`   | `0`           |

Missing rules:
- `|a*b| → |a|*|b|` (multiplicative identity)
- `|a/b| → |a|/|b|`
- `|x|^{p/q} → x^{p/q}` when the result is always non-negative (needs care
  with branch conventions)

---

## 3. Powers with Negative Bases / Odd Roots (2 tests)

| Line | Test           | Expected       | Notes                               |
| ---- | -------------- | -------------- | ----------------------------------- |
| 452  | `(-x)^{3/4}`  | `x^{3/4}`     | **Questionable** — complex for x>0  |
| 454  | `cbrt(-2)`     | `-cbrt(2)`    | Sign extraction for odd roots       |

For `cbrt(-a) = -cbrt(a)`: add rule `Root(n, -a) → -Root(n, a)` when `n` is
odd and `a ≥ 0`.

For `(-x)^{3/4}`: review domain — this is complex for positive `x`. May be a
test bug.

---

## 4. Double Powers (1 test)

| Line | Test            | Expected |
| ---- | --------------- | -------- |
| 146  | `(x^3)^{1/3}`  | `x`      |

`(x^n)^{1/n} → x` when `n` is odd. The existing rule requires `baseNonNeg ||
innerIsOddInteger`, but the combination `3 * 1/3 = 1` may not simplify to
`x^1 → x`. Needs debugging.

---

## 5. Power of Quotient (1 test)

| Line | Test              | Expected          |
| ---- | ----------------- | ----------------- |
| 485  | `x/(pi/y)^3`     | `x*y^3/pi^3`    |

`(a/b)^n → a^n/b^n` may not fire when the powered quotient is in a denominator.

---

## 6. Power Combination with Symbolic Exponents (1 test)

| Line | Test                  | Expected               |
| ---- | --------------------- | ---------------------- |
| 492  | `x^{sqrt(2)} / x^3`  | `x^{sqrt(2) - 3}`    |

The `x^a * x^b → x^{a+b}` rule works for numeric exponents but not symbolic.

---

## 7. Root Simplification (2 tests)

| Line | Test            | Expected       |
| ---- | --------------- | -------------- |
| 499  | `root4(16*b^4)` | `2\|b\|`     |
| 503  | `root4(x^6)`    | `sqrt(x^3)`   |

Factor numeric coefficients out of roots and reduce `root(n, x^m) → x^{m/n}`
to simplest radical form.

---

## 8. Common Denominator (2 tests)

| Line | Test              | Expected         |
| ---- | ----------------- | ---------------- |
| 513  | `1/(x+1) - 1/x`  | `-1/(x^2+x)`   |
| 515  | `1/x - 1/(x+1)`  | `1/(x^2+x)`    |

Requires finding a common denominator for fractions with polynomial
denominators — a significant new capability.

---

## 9. Multi-Variable Expansion (1 test)

| Line | Test                    | Expected         |
| ---- | ----------------------- | ---------------- |
| 522  | `2*(x+h)^2 - 2*x^2`   | `4xh + 2h^2`   |

Single-variable `(x+1)^2 - x^2 = 2x+1` works. Debug why two variables fail.

---

## 10. Inverse Hyperbolic ↔ Logarithm Rewrites (6 tests)

| Line | Test                           | Expected      |
| ---- | ------------------------------ | ------------- |
| 968  | `1/2*ln((x+1)/(x-1))`        | `arccoth(x)` |
| 973  | `ln(x + sqrt(x^2+1))`        | `arsinh(x)`  |
| 978  | `ln(x + sqrt(x^2-1))`        | `arcosh(x)`  |
| 983  | `1/2*ln((1+x)/(1-x))`        | `artanh(x)`  |
| 988  | `ln((1+sqrt(1-x^2))/x)`      | `arsech(x)`  |
| 993  | `ln(1/x + sqrt(1/x^2+1))`    | `arcsch(x)`  |

Complex structural pattern-matching. Low priority / niche.

---

## 11. Inverse Trig Rewrite (1 test)

| Line | Test                          | Expected      |
| ---- | ----------------------------- | ------------- |
| 1001 | `arctan(x/sqrt(1-x^2))`     | `arcsin(x)`  |

Structural pattern-matching rewrite.

---

## 12. Float / Mixed Arithmetic (2 tests)

| Line | Test             | Expected                           |
| ---- | ---------------- | ---------------------------------- |
| 43   | `sqrt(3.1)`      | `1.76068168616590091458` (decimal) |
| 58   | `sqrt(3) + 0.3`  | `2.0320508075688772` (decimal)     |

`simplify()` should trigger numeric evaluation when floats are present.

---

## 13. Inequality Simplification (1 test)

| Line | Test                       | Expected      |
| ---- | -------------------------- | ------------- |
| 125  | `(2*pi + 2*pi*e) < 4*pi`  | `1 + e < 2`  |

Extend inequality GCD-factor-out to handle sums with common factors.

---

## 14. Fu Trig Simplification — Phase 14 (1 test)

| Line | Test                                            | Expected               |
| ---- | ----------------------------------------------- | ---------------------- |
| 1446 | `1 - (1/4)*sin^2(2x) - sin^2(y) - cos^4(x)`  | `sin(x+y)*sin(x-y)`  |

Requires extending the Fu algorithm implementation.

---

## Priority Order

### Medium effort, broadly useful

1. **Log power rule for arbitrary base** (1a) — generalize existing ln rule
2. **Reciprocal log base** (1g) — new rule `log_{1/b}(x) = -log_b(x)`
3. **Abs multiplicative identity** (2) — `|ab| = |a||b|`
4. **cbrt(-a) = -cbrt(a)** (3) — sign extraction for odd roots
5. **Ln cancellation** (1d) — verify parsing, extend collection
6. **Mixed log identities** (1h) — generalize ln(e^x*y) to log_c(c^x*y)

### Medium effort, moderate value

7. **Double powers** (4) — debug (x^3)^{1/3} = x
8. **Power of quotient** (5) — (a/b)^n in denominator
9. **Symbolic exponent combination** (6) — x^a / x^b with symbolic a, b
10. **Root simplification** (7) — factor coefficients out of radicals
11. **Exp of log difference** (1e) — e^{ln(x) - f}
12. **Log of quotient** (1f) — ln((x+1)/e^{2x})
13. **Change of base ratio** (1c) — ln(a)/ln(b)

### High effort / niche

14. **Common denominator** (8) — partial fraction / rational expression
15. **Multi-variable expansion** (9) — debug two-variable case
16. **Float arithmetic** (12) — N() integration in simplify
17. **Inverse hyp ↔ log rewrites** (10) — complex pattern matching
18. **Inverse trig rewrite** (11) — structural pattern matching
19. **Inequality GCD** (13) — extend to sums
20. **Fu Phase 14** (14) — advanced trig
