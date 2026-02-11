Let's introduce the concept of "strict mode" for LaTeX parsing.

The default would be `strict = true` and correspond to the current behavior.

When `strict = false`, we would accept a broader syntax, similar to ASCIIMath or
Typst.

> [Review] Note: `strict` already exists on `ParseLatexOptions` in
> `latex-syntax/types.ts` and is wired up in `parse.ts`. When `strict = false`,
> the parser already handles bare function names (`sin(x)`, `sqrt(x)`, etc. --
> 29 functions via `BARE_FUNCTION_MAP`) and parenthesized superscripts/subscripts
> (`x^(n+1)`, `a_(k+m)`). So the infrastructure is in place; what follows is
> the list of *additional* features to implement.

Specifically:

(In the expression below `#` is one or more digits)

- `(...)/(...)` -> `\frac{...}{...}`, so `(x+1)/(2)` -> `\frac{x+1}{2}`
  - Also `#/(...)` and `(...)/#`
  - Also `?/?` where `?` are a digit or an alphanumeric character
  > [Review] The first example has a typo: `\frac{x}{2}` should be
  > `\frac{x+1}{2}`.
  >
  > Ambiguity to resolve: what does `a+b/c+d` mean? Two reasonable readings:
  > (1) `a + \frac{b}{c} + d` (only immediately adjacent tokens), or
  > (2) treat `/` like a low-precedence operator and require parens for grouping.
  > I'd recommend (1): `/` between bare tokens binds tightly to the single
  > token/digit-run on each side. Parenthesized groups extend it:
  > `(a+b)/(c+d)`. This matches what ASCIIMath does.
  >
  > Also consider: what about `2/3/4`? Left-associative would give
  > `\frac{\frac{2}{3}}{4}`. Should probably be an error or require parens.
- `x^(...)` -> `x^{...}`
  - Also `x^#` so `x^123` -> `x^{123}`
  - Also `x^-#` so `x^-1+2` -> `x^{-1}+2`
  > [Review] `x^(...)` and `x_(...)` are already implemented in `parse.ts`
  > (lines ~1685 and ~1704). The `x^#` (multi-digit) and `x^-#` (negative
  > exponent) rules are new and would need implementation.
  >
  > Consider adding the same rules for subscripts: `x_#` -> `x_{#}` (e.g.,
  > `a_12` -> `a_{12}`). Users are likely to want both.
- `*` -> `\times`
  > [Review] Should `**` map to `\cdot` or to exponentiation (`^`)? Many
  > programming languages use `**` for power. Worth deciding. I'd suggest:
  > - `*` -> `\times` (multiplication)
  > - `**` -> `^` (exponentiation, Python-style)
- `oo` -> `\infty`
  > [Review] Potential conflict: `oo` is two letters, which in strict LaTeX
  > parsing would be the product `o \cdot o`. This is fine as long as we only
  > apply this rule in non-strict mode. But consider: what about `foo`? The
  > parser needs to ensure `oo` is only matched as a standalone token, not
  > as a substring of an identifier. The bare function parser already does
  > word-boundary detection, so this should use the same mechanism.

- The following sequence of characters would be interpreted as indicated:
  - `sqrt(...)` -> `\sqrt{...}`
  - `cbrt(...)` -> `\sqrt[3]{...}`
  - `sqrt#` -> `\sqrt{#}`, so `2+sqrt34-1` -> `2+\sqrt{34}-1`
  - `cbrt#` -> `\sqrt[3]{...}`
  > [Review] `sqrt(...)` is already implemented via `BARE_FUNCTION_MAP`.
  > `cbrt` is not in the map yet -- needs to be added with special handling
  > for the optional `[3]` argument.
  >
  > The `sqrt#` (no parens, just digits) rule is tricky: how far does the
  > digit run extend? `sqrt34` -> `\sqrt{34}` is clear, but what about
  > `sqrt3x`? Is that `\sqrt{3}x` or `\sqrt{3x}`? I'd say digits-only:
  > consume consecutive digits after `sqrt`/`cbrt`, stop at first non-digit.
  > This matches the `#` notation in the spec.
  - `cos`, `sin`, `tan`, `ln`, `log` -> `\cos`, `\sin`, `\tan`, `\ln`, `\log`
    - similarly for inverse and hyperbolic trig functions
  > [Review] Already implemented. `BARE_FUNCTION_MAP` in `parse.ts` covers:
  > `sin`, `cos`, `tan`, `sec`, `csc`, `cot`, `sinh`, `cosh`, `tanh`,
  > `arcsin`/`asin`, `arccos`/`acos`, `arctan`/`atan`, `ln`, `log`, `exp`,
  > `lg`, `lb`, `abs`, `floor`, `ceil`, `round`, `gcd`, `lcm`, `det`.
  - `log#(...)` -> `log_{#}(...)`
  > [Review] Useful for `log2(x)`, `log10(x)`. The tricky part: is `log2`
  > a log-base-2, or the identifier "log2"? In non-strict mode, treating
  > digit-suffixed `log` as a base seems reasonable. But `loge` should NOT
  > be interpreted as `log_e` -- only digit suffixes.
  - `lim_...` -> `\lim_{...}`
  - `int_...^...` -> `\int_...^...`
  - `>=`, `<=`, `!=`, `≠` -> `\ge`, `\le`, `\neq`
  > [Review] Also add: `==` -> `=` (many users type double-equals for
  > equality from programming habit).
  - `->` -> `\to`
  - `=>` -> `\implies`
  - `<=>` -> `\equivalent`
  > [Review] The standard LaTeX command is `\iff`, not `\equivalent`.
  > Check what the compute-engine dictionary uses. If it recognizes
  > `\iff`, use that. If it has `\Leftrightarrow`, that works too.
  - `sum_...^...(...)` -> `\sum_..^... ...`
  - `prod_...^...(...)` -> `\prod..^... ...`
  - `vec(a, b, c)` -> `\begin{pmatrix}a\\b\\c\end{pmatrix}`
  - `mat(a, b, c; d, e, f)` -> `\begin{pmatrix}a& b&c\\d&e&f\end{pmatrix}`
  > [Review] Should `vec` produce a column vector (pmatrix) or a decorated
  > symbol (`\vec{a}`)? Both are common. Suggestion: `vec(a,b,c)` with
  > multiple args -> column vector (pmatrix), but `vec(a)` with single arg
  > -> `\vec{a}` (arrow notation). This covers both use cases.

## Additional rules to consider

> [Review] The following are shortcuts that users commonly need but are not
> covered above. They follow the same "ASCII-friendly math input" philosophy.

### Absolute value and floor/ceiling
- `|x|` -> `\left|x\right|` (absolute value) -- may already work, but
  verify it handles `|x+1|` correctly in non-strict mode
- `||x||` -> `\left\|x\right\|` (norm)
- `floor(x)` -> `\lfloor x \rfloor` (already in BARE_FUNCTION_MAP)
- `ceil(x)` -> `\lceil x \rceil` (already in BARE_FUNCTION_MAP)

### Set notation
- `{1, 2, 3}` -> `\lbrace 1, 2, 3 \rbrace` (set literal)
- `in` -> `\in`
- `notin` or `!in` -> `\notin`
- `union` -> `\cup`
- `inter` or `intersect` -> `\cap`
- `subset` -> `\subset`
- `subseteq` -> `\subseteq`
- `emptyset` -> `\emptyset`

### Greek letters
- `alpha`, `beta`, `gamma`, `delta`, `epsilon`, `theta`, `lambda`, `mu`,
  `sigma`, `tau`, `phi`, `psi`, `omega`, `pi` -> corresponding `\alpha`,
  `\beta`, etc.
- This is one of the most-requested ASCII math features. Users should not
  have to type `\pi` when `pi` would do.
- Uppercase variants: `Gamma`, `Delta`, `Theta`, `Lambda`, `Sigma`, `Phi`,
  `Psi`, `Omega`, `Pi` -> `\Gamma`, `\Delta`, etc.
- Must be careful with word boundaries: `epsilon` should match but `depsilon`
  should not. The existing bare-function tokenizer handles this already.

### Common constants and symbols
- `pi` -> `\pi`
- `ee` or `euler` -> `e` (Euler's number) -- or leave `e` as-is since
  the engine already treats it as Euler's number
- `ii` -> `\imaginaryI` or `i` (imaginary unit)
- `deg` -> `\degree` (e.g., `90deg` -> `90\degree`)
- `+-` or `+/-` -> `\pm`
- `-+` -> `\mp`
- `...` -> `\ldots`

### Subscript shorthand for common indexed variables
- `x1`, `x2`, ... `x9` -> `x_1`, `x_2`, ... `x_9` (single-letter variable
  followed by single digit)
- This is extremely common in user input. `x1 + x2` is much more natural
  than `x_1 + x_2`.
- Only applies to single-letter + single-digit to avoid ambiguity (e.g.,
  `x12` would still need `x_{12}` or `x_(12)`).

### Factorial and combinatorics
- `n!` -> already works (postfix `!`)
- `nCr(n, k)` or `C(n,k)` or `binom(n,k)` -> `\binom{n}{k}`
- `nPr(n, k)` or `P(n,k)` -> permutation notation

### Calculus shortcuts
- `d/dx` or `d/dx(...)` -> `\frac{d}{dx}(...)` (derivative notation)
- `dd/dxdx` or `d2/dx2` -> second derivative
- `partial` -> `\partial`

### Misc operators
- `&&` or `and` -> `\land`
- `||` or `or` -> `\lor` (but be careful: `||` conflicts with norm notation)
- `not` or `!` (prefix) -> `\lnot`
- `~=` or `~~` -> `\approx`
- `prop` or `~` -> `\propto` (careful with `~` overloading)
- `>>` -> `\gg`
- `<<` -> `\ll`

## Other examples:

- `sqrt sqrt cbrt x` -> `\sqrt{\sqrt{\sqrt[3]{x}}}`
- `lim_(x->oo) 1/x+1` -> `\lim_{x\to\infty} \frac{1}{x}+1`
- `lim_(x->-oo) 1/(x+1)` -> `\lim_{x\to-\infty} \frac{1}{x+1}`
> [Review] The original examples had mismatched delimiters: `)` instead of
> `}` in the LaTeX output. Fixed above.
>
> More examples to consider:
> - `2pi*r` -> `2\pi \cdot r`
> - `x^2 + 3x + 2 = 0` -> works as-is (already valid LaTeX)
> - `sin(x)^2 + cos(x)^2 = 1` -> `\sin(x)^2 + \cos(x)^2 = 1`
> - `sum_(n=1)^oo 1/n^2 = pi^2/6` -> `\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}`
> - `f(x) = x^2 + 2x + 1` -> works mostly as-is
> - `x in {1, 2, 3}` -> `x \in \lbrace 1, 2, 3 \rbrace`
> - `alpha + beta*x1` -> `\alpha + \beta \cdot x_1`

## Implementation priority

> [Review] Suggested implementation order based on user impact and complexity:
>
> **Phase 1 -- Quick wins (low complexity, high impact):**
> 1. `*` / `**` operators
> 2. Comparison operators (`>=`, `<=`, `!=`, `==`)
> 3. Arrow operators (`->`, `=>`, `<=>`)
> 4. `oo` -> `\infty`
> 5. `cbrt(...)` bare function
>
> **Phase 2 -- High value (medium complexity):**
> 6. Inline `/` division (the `(a)/(b)` patterns)
> 7. Multi-digit exponents/subscripts (`x^123`, `x_12`)
> 8. Negative exponents (`x^-1`)
> 9. Greek letters as bare words (`pi`, `alpha`, `theta`, ...)
> 10. `log#(...)` base syntax
>
> **Phase 3 -- Advanced (higher complexity):**
> 11. `sqrt#` / `cbrt#` (digits-only argument without parens)
> 12. Set notation keywords (`in`, `union`, `subset`, ...)
> 13. Single-letter + single-digit subscript shorthand (`x1` -> `x_1`)
> 14. `vec(...)` / `mat(...)` notation
> 15. Calculus shortcuts (`d/dx`, `partial`)
> 16. `binom(n,k)` / `nCr` combinatorics
