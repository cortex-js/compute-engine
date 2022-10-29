## [Unreleased]

### Breaking Changes

- The head of a number expression is always `Number`. Use `expr.domain` to be
  get more specific info about what kind of number this is.
- By default, `ce.box()` and `ce.parse()` return a canonical expression. A flag
  can be used if a non-canonical expression is desired.
- The API surface of `BoxedExpression` has been reduced. The properties
  `machineValue`, `bignumValue`, `asFloat`, `asSmallInteger`, `asRational`
  etc... have been replaced with a single `numericValue` property.

### Improvements

- Better simplification for square root expressions:
  - `\sqrt{25x^2}` -> `5x`
- Preserve exact calculations involving rationals or square root of rationals.
  - `\sqrt{\frac{49}{25}}` -> `\frac{7}{5}`
- Added `ce.let()` and `ce.set()` to declare and assign values to identifiers.
- Addition and multiplication provide more consistent results for `evaluate()`
  and `N()`. Evaluate returns an exact result when possible.

  - EXACT
    - 2 + 5 -> 7
    - 2 + 5/7 -> 19/7
    - 2 + √2 -> 2 + √2
    - 2 + √(5/7) -> 2 + √(5/7)
    - 5/7 + 9/11 -> 118/77
    - 5/7 + √2 -> 5/7 + √2
    - 10/14 + √(18/9) -> 5/7 + √2
    - √2 + √5 -> √2 + √5
    - √2 + √2 -> 2√2
    - sin(2) -> sin(2)
    - sin(π/3) -> √3/2
  - APPROXIMATE
    - 2 + 2.1 -> 4.1
    - 2 + √2.1 -> 3.44914
    - 5/7 + √2.1 -> 2.16342
    - sin(2) + √2.1 -> 2.35844

- More consistent behavior of the `auto` numeric mode: calculations are done
  with `bignum` and `complex` in most cases.
- `JsonSerializationOptions` has a new option to specify the numeric precision
  in the MathJSON serialization.
- Shorthand numbers can now be strings if they do not fit in a float-64:

```json
// Before
["Rational", { "num": "1234567890123456789"}, { "num": "2345678901234567889"}]

// Now
["Rational", "1234567890123456789", "2345678901234567889"]
```

- `\sum` is now correctly parsed and evaluated. This includes creating a local
  scope with the index and expression value of the sum.

### Bugs Fixed

- Parsing a number with repeating decimals and an exponent would drop the
  exponent.
- Correct calculation of complex square roots
  - `\sqrt{-49}` -> `7i`
- Calculations were not always performed as bignum in `"auto"` numeric mode if
  the precision was less than 15. Now, if the numeric mode is `"auto"`,
  calculations are done as bignum or complex numbers.
- If an identifier contained multiple strings of digits, it would not be
  rendered to LaTeX correctly, e.g. `V20_20`.
- Correctly return `isReal` for real numbers

## 0.8.0

**Release Date:** 2022-10-02

### Breaking Changes

- Corrected the implementation of `expr.toJSON()`, `expr.valueOf()` and added
  the esoteric `[Symbol.toPrimitive]()` method. These are used by JavaScript
  when interacting with other primitive types. A major change is that
  `expr.toJSON()` now returns an `Expression` as an object literal, and not a
  string serialization of the `Expression`.

- Changed from "decimal" to "bignum". "Decimal" is a confusing name, since it is
  used to represent both integers and floating point numbers. Its key
  characteristic is that it is an arbitrary precision number, aka "bignum". This
  affects `ce.numericMode` which now uses `bignum` instead of
  `decimal', `expr.decimalValue`->`expr.bignumValue`, `decimalValue()`-> `bignumValue()`

### Bugs Fixed

- Numerical evaluation of expressions containing complex numbers when in
  `decimal` or `auto` mode produced incorrect results. Example: `e^{i\\pi}`

## 0.7.0

**Release Date:** 2022-09-30

### Breaking Changes

- The `ce.latexOptions.preserveLatex` default value is now `false`
- The first argument of the `["Error"]` expression (default value) has been
  dropped. The first argument is now an error code, either as a string or an
  `["ErrorCode"]` expression.

### Features

- Much improved LaTeX parser, in particular when parsing invalid LaTeX. The
  parser now avoids throwing, but will return a partial expression with
  `["Error"]` subexpressions indicating where the problems were.
- Implemented new domain computation system (similar to type systems in
  programming languages)
- Added support for multiple signatures per function (ad-hoc polymorphism)
- Added `FixedPoint`, `Loop`, `Product`, `Sum`, `Break`, `Continue`, `Block`,
  `If`, `Let`, `Set`, `Function`, `Apply`, `Return`
- Added `Min`, `Max`, `Clamp`
- Parsing of `\sum`, `\prod`, `\int`.
- Added parsing of log functions, `\lb`, `\ln`, `\ln_{10}`, `\ln_2`, etc...
- Added
  `expr.`subexpressions`, `expr.getSubexpressions()`, `expr.errors`, `expr.symbols`, `expr.isValid`.
- Symbols can now be used to represent functions, i.e. `ce.box('Sin').domain`
  correctly returns `["Domain", "Function"]`.
- Correctly handle rational numbers with a numerator or denominator outside the
  range of a 64-bit float.
- Instead of a `Missing` symbol an `["Error", "'missing'"]` expression is used.
- Name binding is now done lazily
- Correctly handle MathJSON numbers with repeating decimals, e.g. `1.(3)`.
- Correctly evaluate inverse functions, e.g. `ce.parse('\\sin^{-1}(.5)).N()`
- Fixed some LaTeX serialization issues

Read more at
[Core Reference](https://cortexjs.io/compute-engine/reference/core/) and
[Arithmetic Reference]
(https://cortexjs.io/compute-engine/reference/arithmetic/)

### Bugs Fixed

- **#43** If the input of `ce.parse()` is an empty string, return an empty
  string for `expr.latex` or `expr.json.latex`: that is, ensure verbatim LaTeX
  round-tripping
- Evaluating some functions, such as `\arccos` would result in a crash
- Correctly handle parsing of multi-token decimal markers, e.g. `{,}`

## 0.6.0

**Release Date:** 2022-04-18

### Improvements

- Parse more cases of tabular environments
- Handle simplify and evaluate of inert functions by default
- Avoid unnecessary wrapping of functions when serializing LaTeX
- Parse arguments of LaTeX commands (e.g. `\vec{}`)
- **#42** Export static `ComputeEngine.getLatexDictionary`
- Parse multi-character constants and variables, e.g. `\mathit{speed}` and
  `\mathrm{radius}`
- Parse/serialize some LaTeX styling commands: `\displaystyle`, `\tiny` and more

## 0.5.0

**Release Date:** 2022-04-05

### Improvements

- Correctly parse tabular content (for example in
  `\begin{pmatrix}...\end{pmatrix}`
- Correctly parse LaTeX groups, i.e. `{...}`
- Ensure constructible trigonometric values are canonical
- Correct and simplify evaluation loop for `simplify()`, `evaluate()` and `N()`.
- **#41** Preserve the parsed LaTeX verbatim for top-level expressions
- **#40** Correctly calculate the synthetic LaTeX metadata for numbers
- Only require Node LTS (16.14.2)
- Improved documentation, including Dark Mode support

## 0.4.4

**Release Date**: 2022-03-27

### Improvements

- Added option to specify custom LaTeX dictionaries in `ComputeEngine`
  constructor
- `expr.valueOf` returns rational numbers as `[number, number]` when applicable
- The non-ESM builds (`compute-engine.min.js`) now targets vintage JavaScript
  for improved compatibility with outdated toolchains (e.g. Webpack 4) and
  environments. The ESM build (`compute-engine.min.esm.js`) targets evergreen
  JavaScript (currently ECMAScript 2020).

## 0.4.3

**Release Date**: 2022-03-21

### Transition Guide from 0.4.2

The API has changed substantially between 0.4.2 and 0.4.3, however adapting code
to the new API is very straightforward.

The two major changes are the introduction of the `BoxedExpression` class and
the removal of top level functions.

### Boxed Expression

The `BoxedExpression` class is a immutable box (wrapper) that encapsulates a
MathJSON `Expression`. It provides some member functions that can be used to
manipulate the expression, for example `expr.simplify()` or `expr.evaluate()`.

The boxed expresson itself is immutable. For example, calling `expr.simplify()`
will return a new, simplified, expression, without modifying `expr`.

To create a "boxed" expression from a "raw" MathJSON expression, use `ce.box()`.
To create a boxed expression from a LaTeX string, use `ce.parse()`.

To access the "raw" MathJSON expression, use the `expr.json` property. To
serialize the expression to LaTeX, use the `expr.latex` property.

The top level functions such as `parse()` and `evaluate()` are now member
functions of the `ComputeEngine` class or the `BoxedExpression` class.

There are additional member functions to examine the content of a boxed
expression. For example, `expr.symbol` will return `null` if the expression is
not a MathJSON symbol, otherwise it will return the name of the symbol as a
string. Similarly, `expr.ops` return the arguments (operands) of a function,
`expr.asFloat` return `null` if the expression does not have a numeric value
that can be represented by a float, a `number` otherwise, etc...

### Canonical Form

Use `expr.canonical` to obtain the canonical form of an expression rather than
the `ce.format()` method.

The canonical form is less aggressive in its attempt to simplify than what was
performed by `ce.format()`.

The canonical form still accounts for distributive and associative functions,
and will collapse some integer constants. However, in some cases it may be
necessary to invoke `expr.simplify()` in order to get the same results as
`ce.format(expr)`.

### Rational and Division

In addition to machine floating points, arbitrary precision numbers and complex
numbers, the Compute Engine now also recognize and process rational numbers.

This is mostly an implementation detail, although you may see
`["Rational", 3, 4]`, for example, in the value of a `expr.json` property.

If you do not want rational numbers represented in the value of the `.json`
property, you can exclude the `Rational` function from the serialization of JSON
(see below) in which case `Divide` will be used instead.

Note also that internally (as a result of boxing), `Divide` is represented as a
product of a power with a negative exponent. This makes some pattern detection
and simplifications easier. However, when the `.json` property is accessed,
product of powers with a negative exponents are converted to a `Divide`, unless
you have included `Divide` as an excluded function for serialization.

Similarly, `Subtract` is converted internally to `Add`, but may be serialized
unless excluded.

### Parsing and Serialization Customization

Rather than using a separate instance of the `LatexSyntax` class to customize
the parsing or serialization, use a `ComputeEngine` instance and its
`ce.parse()` method and the `expr.latex` property.

Custom dictionaries (to parse/serialize custom LaTeX syntax) can be passed as an
argument to the `ComputeEngine` constructor.

For more advanced customizations, use `ce.latexOptions = {...}`. For example, to
change the formatting options of numbers, how the invisible operator is
interpreted, how unknown commands and symbols are interpreted, etc...

Note that there are also now options available for the "serialization" to
MathJSON, i.e. when the `expr.json` property is used. It is possible to control
for example if metadata should be included, if shorthand forms are allowed, or
whether some functions should be avoided (`Divide`, `Sqrt`, `Subtract`, etc...).
These options can be set using `ce.jsonSerializationOptions = {...}`.

### Comparing Expressions

There are more options to compare two expressions.

Previously, `match()` could be used to check if one expression matched another
as a pattern.

If `match()` returned `null`, the first expression could not be matched to the
second. If it returned an object literal, the two expressions matched.

The top-level `match()` function is replaced by the `expr.match()` method.
However, there are two other options that may offer better results:

- `expr.isSame(otherExpr)` return true if `expr` and `otherExpr` are
  structurally identical. Structural identity is closely related to the concept
  of pattern matching, that is `["Add", 1, "x"]` and `["Add", "x", 1]` are not
  the same, since the order of the arguments is different. It is useful for
  example to compare some input to an answer that is expected to have a specific
  form.
- `expr.isEqual(otherExpr)` return true if `expr` and `otherExpr` are
  mathematically identical. For example `ce.parse("1+1").isEqual(ce.parse("2"))`
  will return true. This is useful if the specific structure of the expression
  is not important.

It is also possible to evaluate a boolean expression with a relational operator,
such as `Equal`:

```ts
console.log(ce.box(['Equal', expr, 2]).evaluate().symbol);
// -> "True"

console.log(expr.isEqual(ce.box(2)));
// -> true
```

### Before / After

| Before                                    | After                                   |
| :---------------------------------------- | :-------------------------------------- |
| `expr = ["Add", 1, 2]`                    | `expr = ce.box(["Add", 1, 2])`          |
| `expr = ce.evaluate(expr)`                | `expr = expr.evaluate()`                |
| `console.log(expr)`                       | `console.log(expr.json)`                |
| `expr = new LatexSyntax().parse("x^2+1")` | `expr = ce.parse("x^2+1")`              |
| `new LatexSyntax().serialize(expr)`       | `expr.latex`                            |
| `ce.simplify(expr)`                       | `expr.simplify()`                       |
| `await ce.evaluate(expr)`                 | `expr.evaluate()`                       |
| `ce.N(expr)`                              | `expr.N()`                              |
| `ce.domain(expr)`                         | `expr.domain`                           |
| `ce.format(expr...)`                      | `expr.canonical` <br> `expr.simplify()` |

## 0.3.0

**Release Date**: 2021-06-18

### Improvements

- In LaTeX, parse `\operatorname{foo}` as the MathJSON symbol `"foo"`.
