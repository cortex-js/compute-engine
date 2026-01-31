# Playground Test Results

This document summarizes the status of various test snippets from
`test/playground.ts`.

## Summary

| Category          | Fixed | Issues Remaining |
| ----------------- | ----- | ---------------- |
| Parsing           | 14    | 6                |
| Simplification    | 18    | 0                |
| Evaluation        | 17    | 1                |
| Solve             | 4     | 1                |
| Matrix Operations | 6     | 0                |
| Pattern Matching  | 0     | 2                |
| Formatting        | 3     | 0                |
| Other             | 4     | 1                |

---

## Parsing

### Working Correctly

| Test                                            | Line    | Result                                           |
| ----------------------------------------------- | ------- | ------------------------------------------------ |
| `\textcolor{red}{y + 1}` in expression          | 6       | Parses with `Annotated` wrapper                  |
| Sum with multiple bounds `\sum_{n=0,m=4}^{4,8}` | 8       | Correctly parses as multiple `Limits`            |
| `f()` and `f(x)` parsing                        | 99-103  | All variants parse correctly                     |
| Plus/minus `21\pm1`                             | 79-80   | Parses as `PlusMinus`, evaluates to `Tuple`      |
| Non-canonical parsing `12+(-2)`                 | 196-197 | Correctly preserves structure                    |
| `x_\text{a}` subscript                          | 226     | Parses as `"x_a"`                                |
| `f'` derivative notation                        | 613     | Parses as `["Derivative","f"]`                   |
| `x_{1,2}` subscript with comma                  | 615-616 | Parses as `Subscript(x, 1 2)`                    |
| Sum with subscript `\sum_{n,m} k_{n,m}`         | 455     | Correctly uses `Subscript`, not `At`             |
| Integral LaTeX output                           | 618-619 | Correct LaTeX: `\int_{0}^{1}\!x^2\, \mathrm{d}x` |
| `\sin(-23\pi/12)`                               | 499     | Parses and evaluates correctly                   |
| Error handling for `(`, `(3+x`, `)`             | 668-674 | Correct error messages                           |
| `\operatorname{HorizontalScaling}(3)`           | 628-629 | Parses as `["HorizontalScaling", 3]`             |
| Knuth's interval `(a..b)`                       | 731     | Parses as `["Range", "a", "b"]`                  |

### Issues Remaining

| Test                                  | Line    | Expected               | Actual                                | Notes                               |
| ------------------------------------- | ------- | ---------------------- | ------------------------------------- | ----------------------------------- |
| `\textcolor{red}{=}`                  | 11-12   | Styled equals          | `Error('expected-closing-delimiter')` | Cannot style delimiters             |
| Double integral parsing               | 27-31   | Nested integrals       | Complex nested structure              | Parses but N() times out            |
| `\mathrm{x+\alpha}`                   | 188     | Symbol with operators  | `"xplusalpha"` (loses plus)           | Characters merged                   |
| `\mathrm{\oplus}`                     | 189     | Valid symbol           | Error: invalid-first-char             | Cannot use operators in mathrm      |
| `\gamma(2, 1)`                        | 430     | `Gamma(2, 1)` function | `"EulerGamma" * (2, 1)`               | Should be incomplete gamma          |
| `\sin\left(x\right.`                  | 645     | Graceful handling      | Multiple errors                       | Missing matchfix handling           |

---

## Simplification

### Working Correctly

| Test                         | Line    | Input                  | Result         |
| ---------------------------- | ------- | ---------------------- | -------------- |
| Arithmetic                   | 277     | `-1234 - 5678`         | `-6912`        |
| Sqrt addition                | 278     | `2\sqrt{3}+\sqrt{1+2}` | `3sqrt(3)`     |
| cos(30°)                     | 281     | `\cos(30\degree)`      | `sqrt(3)/2`    |
| Abs of pi                    | 295-298 | `\|-\pi\|`             | `pi`           |
| Nested abs                   | 269     | `\|\|a\| + 3\|`        | `\|a\| + 3`    |
| Multiply simplify            | 517     | `2\times3xxx`          | `6x^3`         |
| Trig identity                | 529     | `1+4\sin(\pi/10)`      | `sqrt(5)`      |
| Sqrt division                | 650-658 | `\sqrt{15}/\sqrt{3}`   | `sqrt(5)`      |
| `x+x`                        | 244     | `x+x`                  | `2x`           |
| `e^x e^{-x}`                 | 301-304 | `e^x e^{-x}`           | `1`            |
| `\log_4(x^2)`                | 307-310 | `\log_4(x^2)`          | `2 log_4(x)`   |
| `\log_4(x^{7/4})`            | 319-322 | `\log_4(x^{7/4})`      | `7/4 log_4(x)` |
| `\sin(\infty)`               | 313-316 | `\sin(\infty)`         | `NaN`          |
| `\tanh(\infty)`              | 402-404 | `\tanh(\infty)`        | `1`            |
| `\sqrt{x^2}` with `x > 0`    | 257-259 | `x`                    | `x`            |
| `\sqrt[4]{x^4}` with `x > 0` | 257-259 | `x`                    | `x`            |
| `\cos(5\pi+k)`               | 588-590 | `-cos(k)`              | `-cos(k)`      |
| `a \times (c+d)` expand      | 561-565 | `ac + ad`              | `ac + ad`      |

### Notes

- **Distribution/Expansion**: `simplify()` does NOT automatically distribute. Use
  `.expand()` to distribute: `a*(c+d)` → `ac + ad`. This is by design.
- **Assumptions**: Simplifications that depend on assumptions (like `x > 0`) now
  work correctly. Use `ce.assume()` before simplifying.

---

## Evaluation

### Working Correctly

| Test                | Line    | Input                        | Result                            |
| ------------------- | ------- | ---------------------------- | --------------------------------- |
| Precision 30 digits | 69-73   | `\pi.N()`                    | `3.14159265358979323846264338328` |
| Type of fraction    | 75      | `3/4` type                   | `finite_rational`                 |
| Replace             | 58-66   | Note: use `.subs()` instead  | Returns `3` (by design)           |
| `\sin(\pi^2)`       | 181     | Evaluate                     | `-0.430301217...`                 |
| Solve `x^2-1=0`     | 201-206 | Solutions                    | `['1', '-1']`                     |
| Variance functions  | 208-210 | Statistics                   | Correct values                    |
| Cube root `-1`      | 228     | `(-1)^{1/3}`                 | `-1`                              |
| Polynomial expand   | 431-434 | `(2x^2+3x+1)(2x+1)`          | `4x^3 + 8x^2 + 5x + 1`            |
| Floating point      | 437-438 | `(0+1.1-1.1)(0+1/4-1/4)`     | `0`                               |
| Definite integral   | 513     | `\int_0^1 x^2 dx`            | `1/3`                             |
| Bigint sqrt         | 505-507 | Large number                 | `3513640562152.025...`            |
| Numerical integral  | 44      | `\int_0^1 \sin(x) dx` `.N()` | `0.4598 ± 0.0001`                 |
| Subscript fn call   | 222-223 | `f_\text{a}(5)` with assign  | `6` (evaluates correctly)         |
| Symbolic factorial  | 342     | `(n-1)!`                     | `(n - 1)!` (stays symbolic)       |

### Issues Remaining

| Test                 | Line    | Expected        | Actual | Notes                             |
| -------------------- | ------- | --------------- | ------ | --------------------------------- |
| `.replace()` bug     | 61-72   | `2*x + b`       | `2`    | Single-char symbols auto-wildcard |

**Note:** `.replace({match: 'a', replace: 2})` on `a*x + b` returns `2` instead of `2*x + b`.
The bug is in `parseRulePart` (rules.ts:350) which auto-converts all single-character symbols
to wildcards. So `'a'` becomes `'_a'`, matching ANY expression rather than the literal symbol `a`.
See TODO.md #23.

### Expected Behavior (Not Bugs)

| Test                            | Line    | Behavior                    | Workaround                       |
| ------------------------------- | ------- | --------------------------- | -------------------------------- |
| `D(\sin(x), x)` via LaTeX       | 52-56   | Parses `D` as user symbol   | Use `ce.box(['D', ...])` instead |
| Power `.value`                  | 229-230 | `undefined` before evaluate | Use `.evaluate().value` instead  |

**Notes:**
- In LaTeX, `D` is parsed as a predicate/symbol. For derivatives, use `ce.box(['D', expr, var])`
  or LaTeX notation like `\frac{d}{dx}`.
- `.value` returns the numeric value only for already-evaluated expressions. For symbolic
  expressions like `Power(2, 3)`, call `.evaluate()` first.
- For simple variable substitution, use `.subs()` not `.replace()`. The `.replace()` method
  is for pattern-based rule replacement.

---

## Solve

### Working Correctly

| Test           | Line    | Equation  | Solutions |
| -------------- | ------- | --------- | --------- |
| `2x=\sqrt{5x}` | 156-158 | Quadratic | `5/4, 0`  |
| `x^2-1=0`      | 201-206 | Quadratic | `1, -1`   |
| `5x=0`         | 497-500 | Linear    | `0`       |
| `x=\sqrt{5}`   | 502-504 | Identity  | `sqrt(5)` |

### Issues Remaining

| Test                      | Line | Expected | Actual  | Notes                                    |
| ------------------------- | ---- | -------- | ------- | ---------------------------------------- |
| `2x+1=0` isEqual `x=-1/2` | —    | `true`   | `false` | `isEqual` should recognize equivalent equations |

**Note:** `isEqual` is for mathematical equality (vs `isSame` for structural equality).
For equations, `isEqual` should check if `(LHS1-RHS1)/(LHS2-RHS2)` simplifies to a
non-zero constant, indicating the same solution set. See TODO.md #22.

---

## Matrix Operations

### Working Correctly

| Test                    | Line    | Input                              | Result              |
| ----------------------- | ------- | ---------------------------------- | ------------------- |
| `Shape(A)`              | 532-534 | 2x2 numeric matrix                 | `(2, 2)`            |
| `Rank(A)`               | 532-534 | 2x2 numeric matrix                 | `2`                 |
| `Flatten(A)`            | 532-534 | `[[1,2],[3,4]]`                    | `[1,2,3,4]`         |
| `Transpose(A)`          | 532-534 | `[[1,2],[3,4]]`                    | `[[1,3],[2,4]]`     |
| `Determinant(A)`        | 532-534 | Numeric matrix                     | `-2`                |
| `Determinant(X)` symbolic | 536-549 | `[[a,b],[c,d]]`                  | `-b*c + a*d`        |

### Notes

All matrix operations now work correctly, including symbolic matrices assigned via `ce.assign()`.

---

## Pattern Matching

### Issues Remaining

| Test                  | Line    | Expected           | Actual | Notes                       |
| --------------------- | ------- | ------------------ | ------ | --------------------------- |
| Match with variation  | 135-148 | Substitution found | `null` | Match `0` against `_a*x` with `a=0` variation |
| Complex pattern match | 153-165 | Substitution       | `null` | Match `2x-√5√x` against complex Add pattern |

**Note:** Pattern matching with `useVariations: true` has known limitations. The system
doesn't fully handle all algebraic variations (like matching `0` as `0*x`).

---

## Formatting / Serialization

### Working Correctly

| Test                      | Line    | Input                            | Result                         |
| ------------------------- | ------- | -------------------------------- | ------------------------------ |
| Scientific notation       | 40-44   | `1000`                           | `1\cdot10^{3}`                 |
| Fraction canonical        | 298     | `\frac{2}{-3222233}+\frac{1}{3}` | Uses `Rational` not `Subtract` |
| `1/(2\sqrt{3})` canonical | 617     | Rationalized                     | `\frac{\sqrt{3}}{6}`           |

### Expected Behavior

| Test                 | Line | Behavior        | Notes                                   |
| -------------------- | ---- | --------------- | --------------------------------------- |
| `3\times3` canonical | 59   | Returns `3 * 3` | `.simplify()` returns `9`. Converting to `3^2` would be a separate optimization. |

---

## Other Features

### Working Correctly

| Test          | Line    | Feature                      | Result                            |
| ------------- | ------- | ---------------------------- | --------------------------------- |
| Filter        | 573-577 | `Filter([1,2,3,4,5], IsOdd)` | `[1,3,5]`                         |
| Expand        | 467-475 | `4x(3x+2)-5(5x-4)`           | `12x^2 - 17x + 20`                |
| Negate i      | 405-406 | `-i`                         | `-i`                              |
| Hold          | 232-234 | `Add(1, Hold(2))`            | `1 + Hold(2)`                     |

### Issues Remaining

| Test                      | Line    | Expected         | Actual                            | Notes                         |
| ------------------------- | ------- | ---------------- | --------------------------------- | ----------------------------- |
| `List(Filter).evaluate()` | 581-583 | Evaluated filter | Filter not evaluated inside List  | Nested evaluation issue       |

### Expected Behavior

| Test              | Line    | Behavior           | Notes                                              |
| ----------------- | ------- | ------------------ | -------------------------------------------------- |
| Sum with data     | 175-186 | `[50, 130]`        | Element-wise multiplication is correct; use explicit indexing for dot product |
| `Floor(Cos(n))`   | 271-273 | `floor(cos(n))`    | `n` is unknown, so expression stays symbolic       |

---

## Parsing Edge Cases (Error Handling)

These tests verify error handling for malformed input:

| Input                     | Line | Status                               |
| ------------------------- | ---- | ------------------------------------ |
| `x__+1`                   | 510  | Returns string `"x__"` + 1 (not At)  |
| `\operatorname{a?#_!}`    | 160  | Error: invalid-symbol                |
| `(a, b; c, d, ;; n ,, m)` | 677  | Parses as nested Tuples with Nothing |
| `\operatorname{$invalid}` | 680  | Error for invalid identifier         |

---

## Notes

1. **Double/complex integrals**: The playground includes double integrals and
   complex integration tests that timeout during numerical evaluation.

2. **Assumptions**: Simplifications that depend on assumptions (like `x > 0`)
   now work correctly. Use `ce.assume(ce.parse('x > 0'))` before simplifying.

3. **Matrix operations**: Matrix-related functions (Shape, Rank, Flatten,
   Transpose, Determinant, Inverse, Trace) now work correctly for both numeric
   and symbolic matrices.

4. **Pattern matching**: The pattern matching system has issues with variations
   and complex patterns.

5. **D operator syntax**: The `D` operator must be used via `ce.box(['D', ...])`,
   not LaTeX parsing. In LaTeX, `D` is parsed as a user symbol.

6. **Trig periodicity**: Trigonometric functions now reduce arguments by their
   period (e.g., `cos(5π + k)` simplifies to `-cos(k)`).
