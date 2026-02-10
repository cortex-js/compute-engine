Let's introduce the concept of "strict mode" for LaTeX parsing.

The default would be `strict = true` and correspond to the current behavior.

When `strict = false`, we would accept a broader syntax, similar to ASCIIMath or
Typst.

Specifically:

(In the expression below `#` is one or more digits)

- `(...)/(...)` -> `\frac{...}{...}`, so `(x+1)/(2)` -> `\frac{x}{2}`
  - Also `#/(...)` and `(...)/#`
  - Also `?/?` where `?` are a digit or an alphanumeric character
- `x^(...)` -> `x^{...}`
  - Also `x^#` so `x^123` -> `x^{123}`
  - Also `x^-#` so `x^-1+2` -> `x^{-1}+2`
- `*` -> `\times`
- `oo` -> `\infty`

- The following sequence of characters would be intepreted as indicated:
  - `sqrt(...)` -> `\sqrt{...}`
  - `cbrt(...)` -> `\sqrt[3]{...}`
  - `sqrt#` -> `\sqrt{#}`, so `2+sqrt34-1` -> `2+\sqrt{34}-1`
  - `cbrt#` -> `\sqrt[3]{...}`
  - `cos`, `sin`, `tan`, `ln`, `log` -> `\cos`, `\sin`, `\tan`, `\ln`, `\log`
    - similarly for inverse and hyperbolic trig functions
  - `log#(...)` -> `log_{#}(...)`
  - `lim_...` -> `\lim_{...}`
  - `int_...^...` -> `\int_...^...`
  - `>=`, `<=`, `!=`, `≠` -> `\ge`, `\le`, `\neq`
  - `->` -> `\to`
  - `=>` -> `\implies`
  - `<=>` -> `\equivalent`
  - `sum_...^...(...)` -> `\sum_..^... ...`
  - `prod_...^...(...)` -> `\prod..^... ...`
  - `vec(a, b, c)` -> `\begin{pmatrix}a\\b\\c\end{pmatrix}`
  - `mat(a, b, c; d, e, f)` -> `\begin{pmatrix}a& b&c\\d&e&f\end{pmatrix}`

Other examples:

- `sqrt sqrt cbrt x` -> `\sqrt{\sqrt{\sqrt[3]{x}}}`
- `lim_(x->oo) 1/x+1` -> `\lim_{x\to\infty) \frac{1}{x}+1`
- `lim_(x->-oo) 1/(x+1)` -> `\lim_{x\to-\infty) \frac{1}{x+1}`
