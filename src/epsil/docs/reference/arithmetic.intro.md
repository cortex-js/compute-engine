The **arithmetic** library holds the numeric operations: the arithmetic
operators, powers and roots, exponentials and logarithms, rounding, the
number-theory predicates, sums and products, the special functions (gamma,
zeta, Bessel, Airy), the parts of a complex number, and the numeric constants.
This introduction gives the concepts you need before you read the entries.

## Operators and precedence

Most arithmetic is written with operators. You write the operator, and the
engine receives the definition. The entries list these definitions under their
MathJSON name.

| Epsil syntax | Definition  | Meaning                                  |
| :----------- | :---------- | :--------------------------------------- |
| `a + b`      | `Add`       | Sum                                      |
| `a - b`      | `Subtract`  | Difference                               |
| `-a`         | `Negate`    | Additive inverse                         |
| `a * b`      | `Multiply`  | Product                                  |
| `a / b`      | `Divide`    | Quotient                                 |
| `a % b`      | `Mod`       | Remainder of the floored division        |
| `a ^ b`, `a ** b` | `Power` | Exponentiation                          |
| `n!`         | `Factorial` | Factorial                                |
| `√x`, `∛x`   | `Sqrt`, `Root` | Square root and cube root             |

From the loosest to the tightest, the arithmetic operators group in this
order: `+` and `-`, then `*`, `/` and `%`, then the prefix `-`, then `^`, then
the postfix `!`. The operators of one tier group from the left, except `^`,
which groups from the right. A prefix `-` binds looser than `^`, so `-3^2` is
`-(3^2)`.

```epsil
[2 + 3 * 4, (2 + 3) * 4, 7 / 2 * 2, 2^3^2, -3^2, 2 * 3!]
// ➔ [14, 20, 7, 512, -9, 12]
```

An infix operator must have a space on both sides or on neither side. The
[Operators](/epsil/operators/) page gives the full table and the whitespace
rule.

## Exact and numeric evaluation

The engine keeps a value **exact** when it can. A fraction stays a fraction, a
radical stays a radical, and a function of an exact argument with no closed
form stays symbolic. `N` gives the numeric value:

```epsil
[1/3 + 1/6, sqrt(8), ln(2), ln(8, 2)]
// ➔ [1/2, 2sqrt(2), ln(2), 3]
```

```epsil
[N(1/3), N(sqrt(8)), N(ln(2))]
// ➔ [0.333333333333333333333, 2.8284271247461900976, 0.693147180559945309417]
```

A number written with a decimal point or an exponent, such as `2.5` or
`1.5e3`, is a floating-point number. A function of a floating-point argument
gives a floating-point value:

```epsil
[ln(2), ln(2.5), sqrt(2), sqrt(2.5)]
// ➔ [ln(2), 0.916290731874155065184, sqrt(2), 1.581138830084189666]
```

`N` takes an optional number of significant digits:

```epsil
N(sqrt(2), 50)
// ➔ 1.4142135623730950488016887242096980785696718753769
```

Use `rational` to change a float to the nearest simple fraction:

```epsil
[rational(0.42), rational(1.25)]
// ➔ [21/50, 5/4]
```

## Kinds of numbers

The numeric types form a chain: every `integer` is a `rational`, every
`rational` is a `real`, and every `real` is a `complex`. `number` is the widest
numeric type. It holds the finite numbers, the infinities and `NaN`. Test the
type of a value with `is`:

```epsil
[5 is integer, 1/2 is integer, 1/3 is rational, sqrt(2) is rational, sqrt(2) is real]
// ➔ [True, False, True, False, True]
```

The types `integer`, `rational`, `real` and `complex` hold **finite** values
only. An infinity is a `number`, but it is not a `real`:

```epsil
[oo is real, oo is number]
// ➔ [False, True]
```

A complex number is written with the imaginary unit `i`. The square root of a
negative number is imaginary, and the real root of a negative number is real:

```epsil
[(1 + 2i) * (3 - i), sqrt(-4), root(-8, 3)]
// ➔ [(5 + 5i), 2i, -2]
```

`re`, `im`, `abs`, `arg` and `conjugate` give the parts of a complex number:

```epsil
[re(3 + 4i), im(3 + 4i), abs(3 + 4i), conjugate(3 + 4i)]
// ➔ [3, 4, 5, (3 - 4i)]
```

## The canonical form of sums and products

The engine puts every sum and product in a **canonical form** before it
evaluates it. This has visible effects:

- The exact numbers of a sum or product are combined: `x + 2 + 3` becomes
  `x + 5`.
- Equal terms are collected, and equal factors become a power.
- The operands are sorted in a fixed order, so `x + 1` and `1 + x` are the
  same expression.

```epsil
[x + 2 + 3 + x, 2 * x + 3 * x - x, x * x * 2 * y]
// ➔ [2x + 5, 4x, 2y * x^2]
```

A product of sums stays **factored**, and a power of a sum is not expanded.
Use `expand` to multiply them out:

```epsil
[(a + b) * (c + d), expand((a + b) * (c + d))]
// ➔ [(a + b) * (c + d), a * c + b * c + a * d + b * d]
```

```epsil
[(a + b)^2, expand((a + b)^2)]
// ➔ [(a + b)^2, a^2 + b^2 + 2a * b]
```

A sum still collects like terms, and to do this it opens a factored term:

```epsil
a + b + 2 * (a + b)
// ➔ 3a + 3b
```

When `x` has no value, `x / x` becomes `1` and `x - x` becomes `0`. The
first rule assumes that `x` is not zero.

```epsil
[x / x, x - x]
// ➔ [1, 0]
```

## Infinity and NaN

A result can leave the finite numbers in two ways, and the engine keeps them
apart.

- A **pole**, such as a nonzero number divided by zero, gives complex
  infinity (`complexInfinity`, displayed as `~oo`): an infinity with no
  direction. Arithmetic on a signed
  infinity (`oo`, `-oo`) gives a signed infinity.
- An **indeterminate form**, such as `0/0`, `oo - oo` or `oo * 0`, gives
  `Indeterminate`: an exact question with no value. With a float operand
  (`0.0/0.0`), and under `N`, it gives `NaN`.

```epsil
[1/0, 0/0, oo + 1, oo - oo, oo * 0, 1/oo]
// ➔ [~oo, Indeterminate, +oo, Indeterminate, Indeterminate, 0]
```

`NaN` propagates: a numeric function of `NaN` is `NaN`. This is true for
evaluation as well as for `N`.

```epsil
[NaN + 1, sqrt(NaN), NaN % 2]
// ➔ [NaN, NaN, NaN]
```

## Rounding and remainders

`floor` rounds down, `ceil` rounds up, `truncate` rounds toward zero, and
`round` rounds to the nearest integer, with a tie rounded away from zero (a
host can choose another rule with the engine setting `roundingTies`):

```epsil
[floor(-2.5), ceil(-2.5), truncate(-2.5), round(-2.5)]
// ➔ [-3, -2, -2, -3]
```

With a second argument, `floor`, `ceil`, `truncate` and `round` round to a
multiple of that step instead of an integer. `floor(x, step)` is the greatest
multiple of the step that is at most `x`, whatever the sign of the step, and
`round(x, step)` the nearest multiple. To round to `n` decimal places, the
step is `10^-n`:

```epsil
[floor(226, 10), ceil(226, 10), truncate(-226, 10), round(226, 10), round(3.14159, 1/100)]
// ➔ [220, 230, -220, 230, 157/50]
```

There are two remainders. `a % b` (`Mod`) takes the sign of the divisor `b`.
`remainder(a, b)` rounds the quotient to the nearest integer, so its result
can be negative when `b` is positive:

```epsil
[7 % 3, -7 % 3, 7 % -3, remainder(-7, 3)]
// ➔ [1, 2, -2, -1]
```

## Sums and products

`sum` and `product` have three forms.

With a collection, they add or multiply its elements. When some elements are
not numbers, the result is a sum or a product:

```epsil
[sum([5, 7, 11]), sum([5, 7, x, y]), product([5, 7, 11])]
// ➔ [23, x + y + 12, 385]
```

With a body and a bound `(k, lower, upper)`, they add or multiply the body
for each integer `k` from `lower` to `upper`:

```epsil
[sum(k + 1, (k, 1, 10)), product(k + 1, (k, 1, 10))]
// ➔ [65, 39916800]
```

With a body and an indexing set `k in S`, the index takes each value of the
set:

```epsil
sum(n^2, n in {1, 2, 3})
// ➔ 14
```

A sum over an infinite range has an exact value when it is a known convergent
series, such as a p-series, a geometric series or the exponential series.
Otherwise it stays symbolic, and `N` gives a numeric approximation.

```epsil
[sum(1/k^2, (k, 1, oo)), sum((1/2)^k, (k, 0, oo)), sum(x^k/k!, (k, 0, oo))]
// ➔ [1/6 * pi^2, 2, e^x]
```

A sum with a symbolic bound stays a sum when it is evaluated. `simplify`
replaces it by a closed form when it knows one:

```epsil
simplify(sum(k^2, (k, 1, n)))
// ➔ 1/6 * (2n^3 + 3n^2 + n)
```

## Constants

| Epsil          | Value                | Meaning                                         |
| :------------- | :------------------- | :---------------------------------------------- |
| `e`            | 2.718281828…         | Euler's number, the base of the natural logarithm |
| `i`            | `sqrt(-1)`           | The imaginary unit                              |
| `oo`, `-oo`    |                      | Positive and negative infinity                  |
| `complexInfinity` |                   | Complex infinity, with no direction             |
| `NaN`          |                      | Not a number                                    |
| `goldenRatio`  | 1.618033988…         | `(1 + sqrt(5)) / 2`                             |
| `eulerGamma`   | 0.577215664…         | The Euler–Mascheroni constant                   |
| `catalanConstant` | 0.915965594…      | Catalan's constant                              |
| `machineEpsilon` | 2.220446049…e-16   | The distance from 1 to the next larger machine float |

A constant is exact. `N` gives its numeric value:

```epsil
[ln(e^3), N(goldenRatio)]
// ➔ [3, 1.6180339887498948482]
```

The constant `pi` and the trigonometric functions are in the
[Trigonometry](/epsil/reference/trigonometry/) library.
