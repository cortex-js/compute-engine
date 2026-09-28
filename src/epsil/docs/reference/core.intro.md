The **core** library holds the operations that every program uses: the
markers for absent values, declarations and assignments, the inspection and
control of evaluation, comparison, errors, types as values, strings, and the
conversion to and from LaTeX. This introduction gives the concepts you need
before you read the entries.

## Syntax and library names

Many core definitions are the engine form of an Epsil construct. You write
the construct, and the engine receives the definition. The entries list these
definitions under their MathJSON name.

| Epsil syntax                          | Definition           |
| :------------------------------------ | :------------------- |
| `let x = 3`, `const c = 1`            | `Declare`            |
| `x = x + 1`                           | `Assign`             |
| `f(x) = x^2`, `function f(x) { … }`   | `DefineFunction`     |
| `x => x^2`                            | `Function`           |
| `xs \|> sort`                         | `Pipe`               |
| `f(...t)`                             | `Spread`             |
| `f(rate: 0.05)`                       | `NamedArgument`      |
| `x is integer`                        | `MatchesType`        |
| `type point = tuple<x: number, y: number>` | `DeclareType`   |
| `type shape = circle(r: number) \| square(s: number)` | `DeclareSumType` |
| `protocol Area { … }`                 | `DeclareProtocol`    |
| `type string is Copyable`             | `DeclareConformance` |

A library name with a lowercase Epsil spelling (`head` for `Head`,
`simplify` for `Simplify`, `missing` for `Missing`) is shown with that
spelling. A name without one (`Hold`, `HoldValues`, `Subtype`, `Latex`, `N`)
keeps its MathJSON spelling.

## Absent values

Four values mark that a value is absent. They do not behave the same way.

| Value       | Meaning                                                                   |
| :---------- | :------------------------------------------------------------------------ |
| `nothing`   | No value at all. It is removed from argument lists and collection literals. |
| `missing`   | A position exists, but its value is absent (R `NA`, Julia `missing`).      |
| `Undefined` | The result is not defined.                                                 |
| `NaN`       | A number that is not defined (Not a Number).                              |

`nothing` disappears where it is written. `missing` keeps its position, and an
arithmetic operation on it gives `NaN`:

```epsil
[12, nothing, 34]
// ➔ [12, 34]
```

```epsil
[nothing + 1, missing + 1]
// ➔ [1, NaN]
```

`isMissing` is true for `missing`, `Undefined` and `NaN`. `Coalesce` returns
the first operand that is not absent:

```epsil
Coalesce(missing, NaN, 3, 4)
// ➔ 3
```

## Declaring, assigning and assuming

`let` declares a name whose value can change, and `const` declares a name
whose value cannot change. The `=` operator gives a new value to a name that
`let` declared. The value is evaluated when the assignment is evaluated.

```epsil
const c = 299792458
let t = 2
t = t + 1
c * t
// ➔ 899377374
```

Once a name has a type, a new value must be compatible with that type. A
name that has no value is a free symbol: it stays symbolic in expressions.

`assume` records a fact about a symbol, for example that it is positive. It
does not declare the symbol. It evaluates to a string that reports the
outcome: `"ok"` when the fact was recorded, `"tautology"` when the known
facts already imply it, `"contradiction"` when it conflicts with them, and
`"not-a-predicate"` when the argument is not a condition.

```epsil
[assume(x > 0), assume(x > -1), assume(x < 0), assume(42)]
// ➔ ["ok", "tautology", "contradiction", "not-a-predicate"]
```

`HoldValues` evaluates an expression as if some names had no value. The
declared type and the assumptions of each name still apply. With one
argument, every name that has a value is held. With a list as the second
argument, only the names in the list are held:

```epsil
let x = 5
let y = 2
(x + y, HoldValues(x + y), HoldValues(x + y, [y]))
// ➔ (7, x + y, y + 5)
```

## The structure of an expression

An expression has a **head**, the name of its operator, and a **tail**, its
operands. `head` and `tail` read the expression as it is written, before
the operands are evaluated:

```epsil
head(x^2)
// ➔ "Power"
```

```epsil
[tail(1 + x)]
// ➔ [1, x]
```

`Hold` keeps an expression in its written form: the expression is not
evaluated until `ReleaseHold` removes the `Hold`.

```epsil
Hold(1 + 2)
// ➔ Hold(1 + 2)
```

```epsil
ReleaseHold(Hold(1 + 2))
// ➔ 3
```

A function declared with `hold` receives each argument as it is written, not
its value. Its body can then inspect the expression:

```epsil
let a = 3
hold f(e) = head(e)
f(a + 1)
// ➔ "Add"
```

## Comparing expressions

The `==` operator compares **values**. It can use a tolerance, and it
approximates an exact value when that is necessary. The `===` operator
compares the expressions as they are **written** (after canonicalization).
It never uses a tolerance and never reads the value of a name.

```epsil
(sqrt(2) == 1.4142135623730951, sqrt(2) === 1.4142135623730951)
// ➔ (True, False)
```

```epsil
let x = 5
(x == 5, x === 5)
// ➔ (True, False)
```

`===` always gives `True` or `False`. `==` can stay unevaluated when the
answer is not known, for example `x == y` with two free symbols. `NaN` is not
equal to itself with `==`, but it is the same as itself with `===`:

```epsil
(NaN == NaN, NaN === NaN)
// ➔ (False, True)
```

## Exact evaluation and approximation

Evaluation is **exact**. A result that has no exact decimal form stays
symbolic:

```epsil
ln(2)
// ➔ ln(2)
```

`N` gives a numeric approximation. A second argument sets the number of
significant digits:

```epsil
N(ln(2))
// ➔ 0.693147180559945309417
```

```epsil
N(pi, 20)
// ➔ 3.1415926535897932385
```

`simplify` changes an expression to a simpler form, and `solve` finds the
values of an unknown that make an equation true:

```epsil
simplify(sin(x)^2 + cos(x)^2)
// ➔ 1
```

```epsil
solve(x^2 - 5x + 6 == 0, x)
// ➔ [3, 2]
```

## Errors are values

A problem at run time, such as an argument of the wrong type, does not stop
the program. It gives an `Error` value. The error goes up through the
expressions that contain it, and becomes their value. `isError` tests for an
error value:

```epsil
isError(ln("a"))
// ➔ True
```

To make an error value of your own, use `RuntimeError`. Its argument is a
code string, or an `ErrorCode("code", details…)` expression when the error
carries data. Do not write `Error(…)` for this: a written `Error` marks the
program itself as wrong.

```epsil
function reciprocal(x) {
  if x == 0 { RuntimeError("zero-has-no-reciprocal") } else { 1 / x }
}
[reciprocal(4), reciprocal(0)]
// ➔ [1/4, Error("zero-has-no-reciprocal")]
```

`NaN` is not an error. It is a number.

## Types as values

`type` gives the static type of an expression as a **type value**. The type
is as precise as the engine can make it: the type of `3` is the literal type
`3`, a subtype of `integer`.

```epsil
type(3)
// ➔ TypeFrom("3")
```

`typeFrom` makes a type value from its text, and `stringFrom` gives the text
of a type value. The `is` operator tests whether a value has a type, and
`Subtype` tests whether one type is a subtype of another:

```epsil
(3 is integer, 3 is string)
// ➔ (True, False)
```

```epsil
Subtype("integer", "real")
// ➔ True
```

## Strings

A string is a sequence of **characters**. A character is what a reader sees
as one character (a grapheme cluster), even when Unicode encodes it with
several code points. `length`, `characters` and the other string operations
count characters. `unicodeScalars`, `utf8` and `utf16` give the encoded
integers.

```epsil
characters("naïve")
// ➔ ["n", "a", "ï", "v", "e"]
```

A string literal can include the value of an expression with `\(…)`:

```epsil
let n = 7
"n = \(n)"
// ➔ "n = 7"
```

## LaTeX

`Latex` converts an expression to a LaTeX string, and `parse` converts a
LaTeX string to an expression. In an extended string literal (`#"…"#`), a
backslash is an ordinary character, so LaTeX commands need no escapes:

```epsil
Latex(x^2 / 2)
// ➔ "\frac{x^2}{2}"
```

```epsil
parse(#"\frac{x}{2}"#)
// ➔ 1/2 * x
```
