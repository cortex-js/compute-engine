## [Unreleased]

### Breaking Changes

- The methods for algebraic operations (`add`, `div`, `mul`, etc...) have been
  moved from the Compute Engine to the Boxed Expression class. Instead of
  calling `ce.add(a, b)`, call `a.add(b)`.

  Those methods also behave more consistently: they apply some additional
  simplication rules over canonicalization. For example, while
  `ce.parse('1 + 2')` return `["Add", 1, 2]`, `ce.box(1).add(2)` will return
  `3`.

### New Features and Improvements

- **Exact calculations**

  The Compute Engine attempts to perform exact calculations when possible.

  For example `1/2 + 1/3` is evaluated to `5/6` instead of `0.8(3)`.

  To get an approximate result, use the `N()` method, for example
  `ce.parse("\\frac12 + \\frac13").N()`.

  Previously the result of calculations was not always an exact number but
  returned a numerical approximation instead.

  This has now been improved by introducing internally a `NumericValue` type
  that encapsulates exact numbers and by doing all calculations in this type.
  Previously the calculations were handled manually in the various evaluation
  functions. This made the code complicated and error prone.

  Since the Compute Engine supports multiple numeric mode, including
  fixed-precision and arbitrary precision, the special cases that had to be
  handled could be quite complicated. By using the `NumericValue` type, the code
  is simpler and more robust.

  A `NumericValue` is made of:

  - an imaginary part, represented as a fixed-precision number
  - a real part, represented either as a fixed or arbitrary precision number or
    as the product of a rational number and the square root of an integer.

  For example:

  - 234.567
  - 1/2
  - 3√5
  - √7/3
  - 4-3i

  While this is a significant change internally, the API remains the same. The
  result of calculations should be more predictable and more accurate.

  In the future, the `numericValue` property may change to return a
  `NumericValue` object.

- Improved results for `Expand`. In some cases the expression was not fully
  expanded. For example, `4x(3x+2)-5(5x-4)` now returns `12x^2 - 17x + 20`.
  Previously it returned `4x(3x+2)+25x-20`.

- **AsciiMath serialization** The `expr.toString()` method now returns a
  serialization of the expression using the [AsciiMath](https://asciimath.org/)
  format.

  The serialization to AsciiMath can be customized using the `toAsciiMath()`
  method. For example:

  ```js
  console.log(ce.box(['Sigma', 2]).toAsciiMath({functions: {Sigma: 'sigma'}}));
  // -> sigma(2)
  ```

- Added LaTeX syntax to index collections. If `a` is a collection:

  - `a[i]` is parsed as `["At", "a", "i"]`.
  - `a[i,j]` is parsed as `["At", "a", "i", "j"]`.
  - `a_i` is parsed as `["At", "a", "i"]`.
  - `a_{i,j}` is parsed as `["At", "a", "i", "j"]`.

- Added support for Kronecker delta notation, i.e. `\delta_{ij}`, which is
  parsed as `["KroneckerDelta", "i", "j"]` and is equal to 1 if `i = j` and 0
  otherwise.

  When a single index is provided the value of the function is 1 if the index is
  0 and 0 otherwise

  When multiple index are provided, the value of the function is 1 if all the
  indexes are equal and 0 otherwise.

- Added support for Iverson Bracket notation, i.e. `[a = b]`, which is parsed as
  `["Boole", ["Equal", "a", "b"]]` and is equal to 1 if its argument is true and
  0 otherwise. The argument is expected to be a relational expression.

- Implemented `Unique` and `Tally` on collections. `Unique` returns a collection
  with only the unique elements of the input collection, and `Tally` returns a
  collection with the count of each unique element.

  ```js
  console.log(ce.box(['Unique', ['List', 1, 2, 3, 1, 2, 3, 4, 5]]).value);
  // -> [1, 2, 3, 4, 5]

  console.log(ce.box(['Tally', ['List', 1, 2, 3, 1, 2, 3, 4, 5]]).value);
  // -> [['List', 1, 2, 3, 4, 5], ['List', 2, 2, 2, 1, 1]]
  ```

- Implemented the `Map`, `Filter` and `Tabulate` functions. These functions can
  be used to transform collections, for example:

  ```js
  // Using LaTeX
  console.log(ce.parse('\\mathrm{Map}([3, 5, 7], x \\mapsto x^2)').toString());
  // -> [9, 25, 49]

  // Using boxed expressions
  console.log(
    ce.box(['Map', ['List', 3, 5, 7], ['Square', '_']]).value
  );
  // -> [9, 25, 49]

  console.log(ce.box(['Tabulate',['Square', '_'], 5]).value);
  // -> [1, 4, 9, 16, 25]
  ```

  `Tabulate` can be used with multiple indexes. For example, to generate a 4x4
  unit matrix:

  ```js
  console.log(ce.box(['Tabulate', ['If', ['Equal', '_1', '_2'], 1, 0]], 4, 4).value);
  // -> [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

  // Using the Kronecker delta notation:
  console.log(ce.parse('\\mathrm{Tabulate}(i, j \\mapsto \\delta_{ij}, 4, 4)').value);
  // -> [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]

  ```

- Added Choose function to compute binomial coefficients, i.e. `Choose(5, 2)` is
  equal to 10.

- The fallback for non-constructible complex values of trigonometric functions
  is now implemented via rules.

### Issues Resolved

- Some LaTeX renderer can't render `\/`, so use `/` instead.

- When definitions are added to the LaTeX dictionary, they now take precedence
  over the built-in definitions. This allows users to override the built-in
  definitions.

- Improved parsing of functions, including when a mixture of named and
  positional arguments are used.

- **#175** Matching some patterns when the target had not enough operands would
  result in a runtime error.

## 0.25.1 _2024-06-27_

### Issues Resolved

- **#174** Fixed some simplifications, such as `\frac{a^n}{a^m} = a^{n-m)`

### New Features

- Rules can be defined using a new shorthand syntax, where each rule is a string
  of LaTeX:

  ```js
  expr.simplify(["\\frac{x}{x} -> 1", "x + x -> 2x"]);
  ```

Single letter variables are assumed to be wildcards, so `x` is interpreted as
the wildcard `_x`.

Additionally, the expanded form can also include LaTeX strings. The previous
syntax using expressions can still be used, and the new and old syntax can be
mixed.

For example:

```js
expr.simplify([
  {
    match: "\\frac{x}{x}",
    replace: "1"
  },
  {
    match: ["Add", "x", "x"],
    replace: "2x"
  }
]);
```

The `condition` function can also be expressed as a LaTeX string.

```js
  expr.simplify([ { match: "\\frac{x}{x}", replace: 1, condition: "x != 0" }, ]);
```

The shorthand syntax can be used any where a ruleset is expected, including with
the `ce.rule()` function.

- A new `ce.getRuleSet()` method gives access to the built-in rules.
- **#171** The `Subtract` and `Divide` function can now accept an arbitrary
  number of arguments. For example, `["Subtract", 1, 2, 3]` is equivalent to
  `["Subtract", ["Subtract", 1, 2], 3]`.

## 0.25.0 _2024-06-25_

### Breaking Changes

- The canonical form of expressions has changed. It is now more consistent and
  simpler and should produce more predictable results.

  For example, previously `ce.parse("1-x^2")` would produce
  `["Subtract", 1, ["Square", "x"]]`.

  While this is a readable form, it introduces some complications when
  manipulating the expression: both the `Subtract` and `Square` functions have
  to be handled, in addition to `Add` and `Power`.

  The new canonical form of this expression is
  `["Add", 1, ["Negate", ["Power", "x", 2]]]`. It is a bit more verbose, but it
  is simpler to manipulate.

- The `ce.serialize()` method has been replaced with `expr.toLatex()` and
  `expr.toMathJson()`. The `ce.latexOptions` and `ce.jsonSerializationOptions`
  properties have been removed. Instead, pass the formating options directly to
  the `toLatex()` and `toMathJson()` methods. The `ce.parse()` method now takes
  an optional argument to specify the format of the input string.

- The default JSON serialization of an expression has changed.

  Previously, the default JSON serialization, accessed via the `.json` property,
  had some transformations applied to it (sugaring) to make the JSON more human
  readable.

  For example, `ce.parse("\frac12").json` would return the symbol `"Half"`
  instead of `["Divide", 1, 2]`.

  However, this could lead to some confusion when manipulating the JSON
  directly. Since the JSON is intended to be used by machine more than humans,
  these additional transformations have been removed.

  The `expr.json` property now returns the JSON representing the expression,
  without any transformations.

  To get a version of JSON with some transformations applied use the
  `ce.toMathJson()` function.

  ```js
  expr = ce.box(["Subtract", 1, ["Square", "x"]]);
  console.log(expr.json);
  // -> ["Add", 1, ["Negate", ["Power", "x", 2]]]
  expr.toMathJson()
  // -> ["Subtract", 1, ["Square", "x"]]
  expr.toMathJson({exclude: "Square"})
  // -> ["Subtract", 1, ["Power", "x", 2]]
  ```

  In practice, the impact of both of these changes should be minimal. If you
  were manipulating expressions using `BoxedExpression`, the new canonical form
  should make it easier to manipulate expressions. You can potentially simplify
  your code by removing special cases for functions such as `Square` and
  `Subtract`.

  If you were using the JSON serialization directly, you may also be able to
  simplify you code since the default output from `expr.json` is now more
  consistent and simpler.

- The name of some number formatting options has changed. The number formatting
  options are an optional argument of `ce.parse()` and `ce.toLatex()`. See the  
  `NumberFormat` and `NumberSerializationFormat` types.

- The values +infinity, -infinity and NaN are now represented preferably with
  the symbols `PositiveInfinity`, `NegativeInfinity` and `NaN` respectively.
  Previously they were represented with numeric values, i.e.
  `{num: "+Infinity"}`, `{num: "-Infinity"}` and `{num: "NaN"}`. The numeric
  values are still supported, but the symbols are preferred.

- The method `expr.isNothing` has been removed. Instead, use
  `expr.symbol === "Nothing"`.

### New Features

- When serializing to LaTeX, the output can be "prettified". This involves
  modifying the LaTeX output to make it more pleasant to read, for example:

  - `a+\\frac{-b}{c}` -> `a-\\frac{b}{c}`
  - `a\\times b^{-1}` -> `\\frac{a}{b}`
  - `\\frac{a}{b}\\frac{c}{d}` -> `\\frac{a\\cdot c}{b\\cdot d}`
  - `--2` -> `2`

  This is on by default and can be turned off by setting the `prettify` option
  to `false`. For example:

  ```js
  ce.parse("a+\\frac{-b}{c}").toLatex({prettify: true})
  // -> "a-\\frac{b}{c}"
  ce.parse("a+\\frac{-b}{c}").toLatex({prettify: false})
  // -> "a+\\frac{-b}{c}"
  ```

- Numbers can have a different digit group length for the whole and fractional
  part of a number. For example,
  `ce.toLatex(ce.parse("1234.5678"), {digitGroup: [3, 0]})` will return
  `1\,234.5678`.
- Numbers can now be formatted using South-East Asian Numbering System, i.e.
  lakh and crore. For example:

  ```js
  ce.toLatex(ce.parse("12345678"), {digitGroup: "lakh"})
  // -> "1,23,45,678"
  ```

- Expressions with Integrate functions can now be compiled to JavaScript. The
  compiled function can be used to evaluate the integral numerically. For
  example:

  ```js
  const f = ce.parse("\\int_0^1 x^2 dx");
  const compiled = f.compile();
  console.log(compiled()); // -> 0.33232945619482307
  ```

- **#82** Support for angular units. The default is radians, but degrees can be
  used by setting `ce.angularUnit = "deg"`. Other possible values are "grad" and
  "turn". This affects how unitless numbers with a trigonometric function are
  interpreted. For example, `sin(90)` will return 1 when `ce.angularUnit` is
  "deg", 0.8939966636005579 when `ce.angularUnit` is "grad" and 0 when
  `ce.angularUnit` is "turn".
- Added `expr.map(fn)` method to apply a function to each subexpression of an
  expression. This can be useful to apply custom canonical forms and compare two
  expressions.
- An optional canonical form can now be specified with the `ce.function()`.

### Issues Resolved

- **#173** Parsing `1++2` would result in an expression with a `PreIncrement`
  function. It is now correctly parsed as `["Add", 1, 2]`.
- **#161** Power expressions would not be processed when their argument was a
  Divide expression.
- **#165** More aggressive simplification of expressions with exponent greater
  than 3.
- **#169** Calculating a constant integral (and integral that did not depend on
  the variable) would result in a runtime error.
- **#164** Negative mixed fractions (e.g. `-1\frac23`) are now parsed correctly.
- **#162** Numeric evaluation of expressions with large exponents could result
  in machine precision numbers instead of bignum numbers.
- **#155** The expression
  `["Subtract", ["Multiply", 0.5, "x"], ["Divide", "x", 2]]` will now evaluate
  to `0`.
- **#154** In some cases, parsing implicit argument of trig function return more
  natural results, for example `\cos a \sin b` is now parsed as
  `(\cos a)(\sin b)` and not `\cos (a \sin b)`.
- **#147** The associativity of some operators, including `/` was not applied
  correctly, resulting in unexpected results. For example, `1/2/3` would be
  parsed as `["Divide", 1, ["Divide", 2, 3]]` instead of
  `["Divide", ["Divide", 1, 2], 3]`.
- **#146** When parsing an expression like `x(x+1)` where `x` is an undeclared
  symbol, do not infer that `x` is a function. Instead, infer that `x` is a
  variable and that the expression is a product.
- **#145** The expression `["Or", "False", "False"]`, that is when all the
  arguments are `False`, is now evaluates to `False`.
- Fixed canonical form of `e^x^2`, and more generally apply power rule in more
  cases.
- Added missing "Sech" and "Csch" functions.
- The digit grouping serializing would place the separator in the wrong place
  for some numbers.
- The `avoidExponentsInRange` formating option would not always avoid exponents
  in the specified range.

## 0.24.0 _2024-02-23_

### Issues Resolved

- Fix parsing of very deeply nested expressions.
- Correctly apply rules to deeply nested expressions.
- `expr.print()` now correctly prints the expression when using the minified
  version of the library.
- `expr.isEqual()` now correctly compares equalities and inequalities.
- `expr.match()` has been improved and works correctly in more cases. The
  signature of the `match` function has been changed so that the pattern is the
  first argument, i.e. instead of `pattern.match(expr)` use
  `expr.match(pattern)`.
- Fix `expr.print()` when using the minified version of the library.
- **#142** Accept complex expressions as the subcript of `\ln` and `\log` in
  LaTeX.
- **#139** Parse quantifiers `\forall` and `\exists` in LaTeX.

## 0.23.1 _2024-01-27_

### Issues Resolved

- Using a custom canonical order of `"Multiply"` would not distribute the
  `Negate` function.
- **#141** The canonical form `"Order"` was applied to non-commutative
  functions.

## 0.23.0 _2024-01-01_

### New Features

- Added `ExpandAll` function to expand an expression recursively.
- Added `Factor` function to factor an expression.
- Added `Together` function to combine rational expressions into a single
  fraction.

### Issues Resolved

- The expression `\frac5 7` is now parsed correctly as `\frac{5}{7}` instead of
  `\frac{5}{}7`.
- Do not sugar non-canonical expression. Previously,
  `ce.parse('\\frac{1}{2}', {canonical: false})` would return `Half` instead of
  `['Divide', '1', '2']`.
- **#132** Attempting to set a value to 0 with
  `ce.defineSymbol("count", {value: 0})` would fail: the symbol would be
  undefined.
- Correctly evaluate power expressions in some cases, for example
  `(\sqrt2 + \sqrt2)^2`.
- Comparison of expressions containing non-exact numbers could fail. For
  example: `2(13.1+3.1x)` and `26.2+6.2x` would not be considered equal.

### Improvements

- Significant improvements to symbolic computation. Now, boxing,
  canonicalization and evaluation are more consistent and produce more
  predictable results.
- Adedd the `\neg` command, synonym for `\lnot` -> `Not`.
- Relational expressions (inequalities, etc...) are now properly factored.
- Integers are now factored when simplifying, i.e. `2x = 4x` -> `x = 2x`.

## 0.22.0 _2023-11-13_

### Breaking Changes

- **Rule Syntax**

  The syntax to describe rules has changed. The syntax for a rule was previously
  a tuple `[lhs, rhs, {condition} ]`. The new syntax is an object with the
  properties `match`, `replace` and `condition`. For example:

  - previous syntax: `[["Add", "_x", "_x"], ["Multiply", 2, "_x"]]`
  - new syntax: `{match: ["Add", "_x", "_x"], replace: ["Multiply", 2, "_x"]}`

  The `condition` property is optional, and is either a boxed function or a
  JavaScript function. For example, to add a condition that cheks that `_x` is a
  number literal:

  ```js
  {
    match: ["Add", "_x", "_x"],
    replace: ["Multiply", 2, "_x"],
    condition: (_x) => _x.numericValue !== null
  }
  ```

- **`CanonicalForm`**

  The `CanonicalOrder` function has been replaced by the more flexible
  `CanonicalForm` function. The `CanonicalForm` function takes an expression and
  a list of transformations to apply. To apply the same transformations as
  `CanonicalOrder`, use:

  ```json
  ['CanonicalForm', expr, 'Order']
  ```

  These canonical forms can also be specified with `box()` and `parse()`
  options:

  ```js
  ce.box(expr, { canonical: "Order" });
  ce.parse("x^2 + 2x + 1", { canonical: "Order" });
  ```

### Work In Progress

- Linear algebra functions: `Rank`, `Shape`,`Reshape`, `Flatten`, `Determinant`,
  `Trace`, `Transpose`, `ConjugateTranspose`, `Inverse`. See the
  [Linear Algebra](/compute-engine/reference/linear-algebra/) reference guide.
  Some of these function may not yet return correct result in all cases.

### New Features

- Added a `expr.print()` method as a synonym for `console.log(expr.toString())`.
- Added an `exact` option (false by default) to the `expr.match()` pattern
  matching method. When `true` some additional patterns are automatically
  recognized, for example, `x` will match `["Multiply", '_a', 'x']` when `exact`
  is `false`, but not when `exact` is `true`.

### Improvements

- The equation solver used by `expr.solve()` has been improved and can now solve
  more equations.
- The pattern matching engine has been improved and can now match more
  expressions, including sequences for commutative functions.

## 0.21.0 _2023-11-02_

### New Features

- **#125** Parse and serialize environemnts, i.e.
  `\begin{matrix} 1 & 2 \\ 3 & 4 \end{matrix}` will be parsed as
  `["Matrix", ["List", ["List", 1, 2], ["List", 3, 4]]]`.

  A new section on
  [Linear Algebra](/compute-engine/reference/linear-algebra/#formatting) has
  some details on the supported formats.

  The linear algebra operations are limited at the moment, but will be expanded
  in the future.

- Added `IsSame` function, which is the function expression corresponding to
  `expr.isSame()`.
- <s>Added `CanonicalOrder` function, which sorts the arguments of commutative
  functions into canonical order. This is useful to compare two non-canonical
  expressions for equality.</s>

```js
ce.box(["CanonicalOrder", ["Add", 1, "x"]]).isSame(
  ce.box(["CanonicalOrder", ["Add", "x", 1]])
);
// -> true
```

### Issue Resolved

- When evaluating a sum (`\sum`) with a bound that is not a number, return the
  sum expression instead of an error.

## 0.20.2 _2023-10-31_

### Issues Resolved

- Fixed numerical evaluation of integrals and limits when parsed from LaTeX.

```js
console.info(ce.parse("\\lim_{x \\to 0} \\frac{\\sin(x)}{x}").value);
// -> 1

console.info(ce.parse("\\int_{0}^{2} x^2 dx").value);
// -> 2.6666666666666665
```

## 0.20.1 _2023-10-31_

### Issues Resolved

- Fixed evaluation of functions with multiple arguments
- Fixed compilation of some function assignments
- Improved serialization of function assignment

## 0.20.0 _2023-10-30_

### Breaking Changes

- **Architectural changes**: the invisible operator is used to represent the
  multiplication of two adjacent symbols, i.e. `2x`. It was previously handled
  during parsing, but it is now handled during canonicalization. This allows
  more complex syntactic structures to be handled correctly, for example
  `f(x) := 2x`: previously, the left-hand-side argument would have been parsed
  as a function application, while in this case it should be interpreted as a
  function definition.

  A new `InvisibleOperator` function has been added to support this.

  The `applyInvisibleOperator` parsing option has been removed. To support
  custom invisible operators, use the `InvisibleOperator` function.

### Issues Resolved

- **#25** Correctly parse chained relational operators, i.e. `a < b <= c`
- **#126** Logic operators only accepted up to two arguments.
- **#127** Correctly compile `Log` with bases other than 10.
- Correctly parse numbers with repeating patterns but no fractional digits, i.e.
  `0.(1234)`
- Correctly parse `|1+|a|+2|`

### New Features and Improvements

- Function assignment can now be done with this syntax: `f(x) := 2x+1`. This
  syntax is equivalent to `f := x -> 2x+1`.
- Implement the `Mod` and `Congruent` function.
- Correctly parse `11 \bmod 5` (`Mod`) and `26\equiv 11 \pmod5` (`Congruent`)
- Better handle empty argument lists, i.e. `f()`
- When a function is used before being declared, infer that the symbol is a
  function, e.g. `f(12)` will infer that `f` is a function (and not a variable
  `f` multiplied by 12)
- When a constant is followed by some parentheses, don't assume this is a
  function application, e.g. `\pi(3+n)` is now parsed as
  `["Multiply", "Pi", ["Add", 3, "n"]]` instead of `["Pi", ["Add", 3, "n"]]`
- Improved parsing of nested lists, sequences and sets.
- Improved error messages when syntax errors are encountered during LaTeX
  parsing.
- When parsing with the canonical option set to false, preserve more closely the
  original LaTeX syntax.
- When parsing text strings, convert some LaTeX commands to Unicode, including
  spacing commands. As a result, `ce.parse("\\text{dead\;beef}_{16}")` correctly
  gets evaluated to 3,735,928,559.

## 0.19.1 _2023-10-26_

### Issues Resolved

- Assigning a function to an indentifier works correctly now, i.e.

```js
ce.parse("\\operatorname{f} := x \\mapsto 2x").evaluate();
```

## 0.19.0 _2023-10-25_

### Breaking Changes

- The `domain` property of the function definition `signature` is deprecated and
  replaced with the `params`, `optParams`, `restParam` and `result` properties
  instead. The `domain` property is still supported for backward compatibility,
  but will be removed in a future version.

### Issues Resolved

- When invoking a declared function in a numeric operation, correctly infer the
  result type.

```json
["Assign", "f", ["Add", "_", 1]]
["Add", ["f", 1], 1]
// -> 3
```

Previously a domain error was returned, now `f` is inferred to have a numeric
return type.

- Fixed a runtime error when inverting a fraction, i.e. `\frac{3}{4}^{-1}`
- The tangent of π/2 now correctly returns `ComplexInfinity`.
- The exact values of some constructible trigonometric operations (e.g.
  `\tan 18\degree = \frac{\sqrt{25-10\sqrt5}}{5}`) returned incorrect results.
  The unit test case was incorrect and did not detect the problem. The unit test
  case has been fixed and the returned values are now correct.

### New Features

- Implemented `Union` and `Intersection` of collections, for example:

```json
["Intersection", ["List", 3, 5, 7], ["List", 2, 5, 9]]
// -> ["Set", 5]

["Union", ["List", 3, 5, 7], ["List", 2, 5, 9]]
// -> ["Set", 3, 5, 7, 2, 9]
```

- Parse ranges, for example `1..5` or `1, 3..10`. Ranges are collections and can
  be used anywhere collections can be used.

- The functions `Sum`, `Product`, `Min`, `Max`, and the statistics functions
  (`Mean`, `Median`, `Variance`, etc...) now handle collection arguments:
  collections:

  - `["Range"]`, `["Interval"]`, `["Linspace"]` expressions
  - `["List"]` or `["Set"]` expressions
  - `["Tuple"]`, `["Pair"]`, `["Pair"]`, `["Triple"]` expressions
  - `["Sequence"]` expressions

- Most mathematical functions are now threadable, that is their arguments can be
  collections, for example:

```json
["Sin", ["List", 0, 1, 5]]
// -> ["List", 0, 0.8414709848078965, -0.9589242746631385]

["Add", ["List", 1, 2], ["List", 3, 4]]
// -> ["List", 4, 6]
```

- Added `GCD` and `LCM` functions

```json
["GCD", 10, 5, 15]
// -> 5

["LCM", 10, 5, 15]
// -> 30
```

- Added `Numerator`, `Denominator`, `NumeratorDenominator` functions. These
  functions can be used on non-canonical expressions.

- Added `Head` and `Tail` functions which can be used on non-canonical
  expressions.

- Added `display-quotient` and `inline-quotient` style for formatting of
  division expressions in LaTeX.

### Improvements

- Improved parsing of `\degree` command

```js
ce.parse("30\\degree)
// -> ["Divide", "Pi", 6]
```

- Improved interoperability with JavaScript: `expr.value` will return a
  JavaScript primitive (`number`, `boolean`, `string`, etc...) when possible.
  This is a more succinct version of `expr.N().valueOf()`.

## 0.18.1 _2023-10-16_

### Issues Resolved

- Parsing of whole numbers while in `rational` mode would return incorrect
  results.
- The `ND` function to evaluate derivatives numerically now return correct
  values.

```js
ce.parse("\\mathrm{ND}(x \\mapsto 3x^2+5x+7, 2)").N();
// -> 17.000000000001
```

### Improvements

- Speed up `NIntegrate` by temporarily switching the numeric mode to `machine`
  while computing the Monte Carlo approximation.

## 0.18.0 _2023-10-16_

### New Features

- Expanded LaTeX dictionary with `\max`, `\min`, `\sup`, `\inf` and `\lim`
  functions
- Added `Supremum` and `Infimum` functions
- Compilation of `Block` expressions, local variables, return statements and
  conditionals `If`.
- Added numerical evaluation of limits with `Limit` functions and `NLimit`
  functions, using a Richardson Extrapolation.

```js
console.info(ce.parse("\\lim_{x\\to0} \\frac{\\sin x}{x}").N().json);
// -> 1

console.info(
  ce.box(["NLimit", ["Divide", ["Sin", "_"], "_"], 0]).evaluate().json
);
// -> 1

console.info(ce.parse("\\lim_{x\\to \\infty} \\cos \\frac{1}{x}").N().json);
// -> 1
```

- Added `Assign` and `Declare` functions to assign values to symbols and declare
  symbols with a domain.

- `Block` evaluations with local variables work now. For example:

```js
ce.box(["Block", ["Assign", "c", 5], ["Multiply", "c", 2]]).evaluate().json;
// -> 10
```

- When decimal numbers are parsed they are interpreted as inexact numbers by
  default, i.e. "1.2" -> `{num: "1.2"}`. To force the number to be interpreted
  as a rational number, set `ce.latexOptions.parseNumbers = "rational"`. In that
  case, "1.2" -> `["Rational", 12, 10]`, an exact number.

  While regular decimals are considered "inexact" numbers (i.e. they are assumed
  to be an approximation), rationals are assumed to be exact. In most cases, the
  safest thing to do is to consider decimal numbers as inexact to avoid
  introducing errors in calculations. If you know that the decimal numbers you
  parse are exact, you can use this option to consider them as exact numbers.

### Improvements

- LaTeX parser: empty superscripts are now ignored, e.g. `4^{}` is interpreted
  as `4`.

## 0.17.0 _2023-10-12_

### Breaking Changes

- The `Nothing` domain has been renamed to `NothingDomain`
- The `Functions`, `Maybe`, `Sequence`, `Dictionary`, `List` and `Tuple` domain
  constructors have been renamed to `FunctionOf`, `OptArg`, `VarArg`,
  `DictionaryOf`, `ListOf` and `TupleOf`, respectively.
- Domains no longer require a `["Domain"]` expression wrapper, so for example
  `ce.box("Pi").domain` returns `"TranscendentalNumbers"` instead of
  `["Domain", "TranscendentalNumbers"]`.
- The `VarArg` domain constructor now indicates the presence of 0 or more
  arguments, instead of 1 or more arguments.
- The `MaybeBooleans` domain has been dropped. Use
  `["Union", "Booleans", "NothingDomain"]` instead.
- The `ce.defaultDomain` has been dropped. The domain of a symbol is now
  determined by the context in which it is used, or by the `ce.assume()` method.
  In some circumstances, the domain of a symbol can be `undefined`.

### New Features

- Symbolic derivatives of expressions can be calculated using the `D` function.
  For example, `ce.box(["D", ce.parse("x^2 + 3x + 1"), "x"]).evaluate().latex`
  returns `"2x + 3"`.

### Improvements

- Some frequently used expressions are now available as predefined constants,
  for example `ce.Pi`, `ce.True` and `ce.Numbers`.
- Improved type checking and inference, especially for functions with
  complicated or non-numeric signatures.

### Bugs Fixed

- Invoking a function repeatedly would invoke the function in the original scope
  rather than using a new scope for each invocation.

## 0.16.0 _2023-09-29_

### Breaking Changes

- The methods `ce.let()` and `ce.set()` have been renamed to `ce.declare()` and
  `ce.assign()` respectively.
- The method `ce.assume()` requires a predicate.
- The signatures of `ce.assume()` and `ce.ask()` have been simplified.
- The signature of `ce.pushScope()` has been simplified.
- The `expr.freeVars` property has been renamed to `expr.unknowns`. It returns
  the identifiers used in the expression that do not have a value associated
  with them. The `expr.freeVariables` property now return the identifiers used
  in the expression that are defined outside of the local scope and are not
  arguments of the function, if a function.

### New Features

- **Domain Inference** when the domain of a symbol is not set explicitly (for
  example with `ce.declare()`), the domain is inferred from the value of the
  symbol or from the context of its usage.

- Added `Assume`, `Identity`, `Which`, `Parse`, `N`, `Evaluate`, `Simplify`,
  `Domain`.

- Assignments in LaTeX: `x \\coloneq 42` produce `["Assign", "x", 42]`

- Added `ErfInv` (inverse error function)

- Added `Factorial2` (double factorial)

#### Functions

- Functions can now be defined:

  - using `ce.assign()` or `ce.declare()`
  - evaluating LaTeX: `(x, y) \mapsto x^2 + y^2`
  - evaluating MathJSON:
    `["Function", ["Add", ["Power", "x", 2], ["Power", "y", 2]]], "x", "y"]`

- Function can be applied using `\operatorname{apply}` or the operators `\rhd`
  and `\lhd`:
  - `\operatorname{apply}(f, x)`
  - `f \rhd x`
  - `x \lhd f`

See
[Adding New Definitions](https://cortexjs.io/compute-engine/guides/augmenting/)
and [Functions](https://cortexjs.io/compute-engine/reference/functions/).

#### Control Structures

- Added `FixedPoint`, `Block`, `If`, `Loop`
- Added `Break`, `Continue` and `Return` statements

See
[Control Structures](https://cortexjs.io/compute-engine/reference/control-structures/)

#### Calculus

- Added numeric approximation of derivatives, using an 8-th order centered
  difference approximation, with the `ND` function.
- Added numeric approximation of integrals, using a Monte Carlo method with
  rebasing for improper integrals, with the `NIntegrate` function
- Added symbolic calculation of derivatives with the `D` function.

#### Collections

Added support for **collections** such as lists, tuples, ranges, etc...

See [Collections](https://cortexjs.io/compute-engine/reference/collections/)

Collections can be used to represent various data structures, such as lists,
vectors, matrixes and more.

They can be iterated, sliced, filtered, mapped, etc...

```json example
["Length", ["List", 19, 23, 5]]
// -> 3

["IsEmpty", ["Range", 1, 10]]
// -> "False"

["Take", ["Linspace", 0, 100, 50], 4]
// -> ["List", 0, 2, 4, 6]

["Map", ["List", 1, 2, 3], ["Function", "x", ["Power", "x", 2]]]
// -> ["List", 1, 4, 9]

["Exclude", ["List", 33, 45, 12, 89, 65], -2, 2]
// -> ["List", 33, 12, 65]


["First", ["List", 33, 45, 12, 89, 65]]
// -> 33
```

### Improvements

- The [documentation](https://cortexjs.io/compute-engine/) has been
  significantly rewritten with help from an AI-powered writing assistant.

### Issues Resolved

- The LaTeX string returned in `["Error"]` expression was incorrectly tagged as
  `Latex` instead of `LatexString`.

## 0.15.0 _2023-09-14_

### Improvements

- The `ce.serialize()` function now takes an optional `canonical` argument. Set
  it to `false` to prevent some transformations that are done to produce more
  readable LaTeX, but that may not match exactly the MathJSON. For example, by
  default `ce.serialize(["Power", "x", -1])` returns `\frac{1}{x}` while
  ce.serialize(["Power", "x", -1], {canonical: false}) returns`x^{-1}`.
- Improved parsing of delimiters, i.e. `\left(`, `\right]`, etc...
- Added complex functions `Real`, `Imaginary`, `Arg`, `Conjugate`, `AbsArg`. See
  [Complex](https://cortexjs.io/compute-engine/reference/complex/)
- Added parsing and evaluation of `\Re`, `\Im`, `\arg`, `^\star` (Conjugate).
- **#104** Added the `["ComplexRoots", x, n]` function which returns the nthroot
  of `x`.
- Added parsing and evaluation of statistics functions `Mean`, `Median`,
  `StandardDeviation`, `Variance`, `Skewness`, `Kurtosis`, `Quantile`,
  `Quartiles`, `InterquartileRange`, `Mode`, `Count`, `Erf`, `Erfc`. See
  [Statistics](https://cortexjs.io/compute-engine/reference/statistics/)

## 0.14.0 _2023-09-13_

### Breaking Changes

- The entries in the LaTeX syntax dictionary can now have LaTeX triggers
  (`latexTrigger`) or triggers based on identifiers (`identifierTrigger`). The
  former replaces the `trigger` property. The latter is new. An entry with a
  `triggerIdentifier` of `average` will match `\operatorname{average}`,
  `\mathrm{average}` and other variants.
- The `ce.latexOptions` and `ce.jsonSerializationOptions` properties are more
  robust. They can be modified directly or one of their properties can be
  modified.

### Improvements

- Added more functions and symbols supported by `expr.compile()`:

  - `Factorial` postfix operator `5!`
  - `Gamma` function `\Gamma(2)`
  - `LogGamma` function `\operatorname{LogGamma}(2)`
  - `Gcd` function `\operatorname{gcd}(20, 5)`
  - `Lcm` function `\operatorname{lcm}(20, 5)`
  - `Chop` function `\operatorname{chop}(0.00000000001)`
  - `Half` constant `\frac{1}{2}`
  - 'MachineEpsilon' constant
  - `GoldenRatio` constant
  - `CatalanConstant` constant
  - `EulerGamma` constant `\gamma`
  - `Max` function `\operatorname{max}(1, 2, 3)`
  - `Min` function `\operatorname{min}(13, 5, 7)`
  - Relational operators: `Less`, `Greater`, `LessEqual`, `GreaterEqual`,
    'Equal', 'NotEqual'
  - Some logical operators and constants: `And`, `Or`, `Not`, `True`, `False`

- More complex identifiers syntax are recognized, including `\mathbin{}`,
  `\mathord{}`, etc... `\operatorname{}` is the recommended syntax, though: it
  will display the identifier in upright font and with the propert spacing, and
  is properly enclosing. Some commands, such as `\mathrm{}` are not properly
  enclosing: two adjacent `\mathrm{}` command could be merged into one.

- Environments are now parsed and serialized correctly.

- When parsing LaTeX, function application is properly handled in more cases,
  including custom functions, e.g. `f(x)`

- When parsing LaTeX, multiple arguments are properly handled, e.g. `f(x, y)`

- Add LaTeX syntax for logical operators:

  - `And`: `\land`, `\operatorname{and}` (infix or function)
  - `Or`: `\lor`, `\operatorname{or}` (infix or function)
  - `Not`: `\lnot`, `\operatorname{not}` (prefix or function)
  - `Xor`: `\veebar` (infix)
  - `Nand`: `\barwedge` (infix)
  - `Nor`: `^^^^22BD` (infix)
  - `Implies`: `\implies` (infix)
  - `Equivalent`: `\iff` (infix)

- When a postfix operator is defined in the LaTeX syntax dictionary of the form
  `^` plus a single token, a definition with braces is added automatically so
  that both forms will be recognized.

- Extended the LaTeX dictionary with:

  - `floor`
  - `ceil`
  - `round`
  - `sgn`
  - `exp`
  - `abs`
  - `gcd`
  - `lcm`
  - `apply`

- Properly handle inverse and derivate notations, e.g. `\sin^{-1}(x)`,
  `\sin'(x)`, `\cos''(x)`, \cos^{(4)}(x)`or even`\sin^{-1}''(x)`

## 0.13.0 _2023-09-09_

### New Features

- **Compilation** Some expressions can be compiled to Javascript. This is useful
  to evaluate an expression many times, for example in a loop. The compiled
  expression is faster to evaluate than the original expression. To get the
  compiled expression, use `expr.compile()`. Read more at
  [Compiling](https://cortexjs.io/compute-engine/guides/compiling)

### Issues Resolved and Improvements

- Fixed parsing and serialization of extended LaTeX synonyms for `e` and `i`.
- Fixed serialization of `Half`.
- Fixed serialization of `Which`
- Improved serialization of `["Delimiter"]` expressions.

## 0.12.7 _2023-09-08_

### Improvements

- Made customization of the LaTeX dictionary simpler. The `ce.latexDictionary`
  property can be used to access and modify the dictionary. The
  [documentation](https://cortexjs.io/compute-engine/guides/latex-syntax/#customizing-the-latex-dictionary)
  has been updated.

## 0.12.6 _2023-09-08_

### Breaking Changes

- New API for the `Parser` class.

### Improvements and Bux Fixes

- The `ComputeEngine` now exports the `bignum()` and `complex()` methods that
  can be used to create bignum and complex numbers from strings or numbers. The
  methods `isBigNum()` and `isComplex()` have also been added to check if a
  value is a bignum (`Decimal`) or complex (`Complex`) number, for example as
  returned by `expr.numericValue`.
- **#69** `\leq` was incorrectly parsed as `Equals` instead of `LessEqual`
- **#94** The `\exp` command was not parsed correctly.
- Handle `PlusMinus` in infix and prefix position, i.e. `a\pm b` and `\pm a`.
- Improved parsing, serialization
- Improved simplification
- Improved evaluation of `Sum` and `Product`
- Support complex identifiers (i.e. non-latin scripts, emojis).
- Fixed serialization of mixed numbers.

## 0.12.1 _2022-12-01_

Work around unpckg.com issue with libraries using BigInt.

## 0.12.0 _2022-11-27_

### Breaking Changes

- The `expr.symbols` property return an array of `string`. Previously it
  returned an array of `BoxedExpression`.

### Improvements

- Rewrote the rational computation engine to use JavaScript `bigint` instead of
  `Decimal` instances. Performance improvements of up to 100x.
- `expr.freeVars` provides the free variables in an expression.
- Improved performance of prime factorization of big num by x100.
- Added `["RandomExpression"]`
- Improved accuracy of some operations, for example
  `expr.parse("1e999 + 1").simplify()`

### Issues Resolved

- When `ce.numericMode === "auto"`, square roots of negative numbers would
  return an expression instead of a complex number.
- The formatting of LaTeX numbers when using
  `ce.latexOptions.notation = "engineering"` or `"scientific"` was incorrect.
- The trig functions no longer "simplify" to the less simple exponential
  formulas.
- The canonical order of polynomials now orders non-lexicographic terms of
  degree 1 last, i.e. "ax^2+ bx+ c" instead of "x + ax^2 + bx".
- Fixed evaluation of inverse functions
- Fixed `expr.isLess`, `expr.isGreater`, `expr.isLessEqual`,
  `expr.isGreaterEqual` and `["Min"]`, `["Max"]`

## 0.11.0 _2022-11-18_

### Breaking Changes

- The signature of `ce.defineSymbol()`, `ce.defineFunction()` and
  `ce.pushScope()` have changed

### Improvements

- When a constant should be held or substituted with its value can now be more
  precisely controlled. The `hold` symbol attribute is now `holdUntil` and can
  specify at which stage the substitution should take place.

### Issues Resolved

- Some constants would return a value as bignum or complex even when the
  `numericMode` did not allow it.
- Changing the value or domain of a symbol is now correctly taken into account.
  Changes can be made with `ce.assume()`, `ce.set()` or `expr.value`.
- When a symbol does not have a value associated with it, assumptions about it
  (e.g. "x > 0") are now correctly tracked and reflected.

## 0.10.0 _2022-11-17_

### Breaking Changes

- `expr.isLiteral` has been removed. Use `expr.numericValue !== null` and
  `expr.string !== null` instead.

### Issues Resolved

- Calling `ce.forget()` would not affect expressions that previously referenced
  the symbol.

### Improvements

- More accurate calculations of some trig functions when using bignums.
- Improved performance when changing a value with `ce.set()`. Up to 10x faster
  when evaluating a simple polynomial in a loop.
- `ce.strict` can be set to `false` to bypass some domain and validity checks.

## 0.9.0 _2022-11-15_

### Breaking Changes

- The head of a number expression is always `Number`. Use `expr.domain` to be
  get more specific info about what kind of number this is.
- By default, `ce.box()` and `ce.parse()` return a canonical expression. A flag
  can be used if a non-canonical expression is desired.
- The API surface of `BoxedExpression` has been reduced. The properties
  `machineValue`, `bignumValue`, `asFloat`, `asSmallInteger`, `asRational`
  etc... have been replaced with a single `numericValue` property.
- `parseUnknownSymbol` is now `parseUnknownIdentifier`

### Improvements

- Support angles in degrees with `30\degree`, `30^\circ` and `\ang{30}`.
- More accurate error expressions, for example if there is a missing closing
  delimiter an `["Error", ["ErrorCode", "'expected-closing-delimiter'", "')'"]]`
  is produced.
- `["Expand"]` handles more cases
- The trig functions can now have a regular exponent, i.e.`\cos^2(x)` in
  addition to `-1` for inverse, and a combination of `\prime`, `\doubleprime`
  and `'` for derivatives.
- `ce.assume()` handle more expressions and can be used to define new symbols by
  domain or value.
- Better error message when parsing, e.g. `\sqrt(2)` (instead of `\sqrt{2}`)
- Better simplification for square root expressions:
  - `\sqrt{25x^2}` -> `5x`
- Improved evaluation of `["Power"]` expressions, including for negative
  arguments and non-integer exponents and complex arguments and exponents.
- Added `Arccot`, `Arcoth`, `Arcsch`, `Arcscc`, `Arsech` and `Arccsc`
- `expr.solve()` returns result for polynomials of order up to 2.
- The `pattern.match()` function now work correctly for commutative functions,
  i.e. `ce.pattern(['Add', '_a', 'x']).match(ce.parse('x+y')) -> {"_a": "y"}`
- Added `ce.let()` and `ce.set()` to declare and assign values to identifiers.
- Preserve exact calculations involving rationals or square root of rationals.
  - `\sqrt{\frac{49}{25}}` -> `\frac{7}{5}`
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

```json example
// Before
["Rational", { "num": "1234567890123456789"}, { "num": "2345678901234567889"}]

// Now
["Rational", "1234567890123456789", "2345678901234567889"]
```

- `\sum` is now correctly parsed and evaluated. This includes creating a local
  scope with the index and expression value of the sum.

### Bugs Fixed

- The parsing and evaluation of log functions could produce unexpected results
- The `\gamma` command now correctly maps to `["Gamma"]`
- Fixed numeric evaluation of the `["Gamma"]` function when using bignum
- **#57** Substituting `0` (i.e. with `expr.subs({})`) did not work.
- **#60** Correctly parse multi-char symbols with underscore, i.e.
  `\mathrm{V_a}`
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

## 0.8.0 _2022-10-02_

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

## 0.7.0 _2022-09-30_

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
[Arithmetic Reference] (https://cortexjs.io/compute-engine/reference/arithmetic/)

### Bugs Fixed

- **#43** If the input of `ce.parse()` is an empty string, return an empty
  string for `expr.latex` or `expr.json.latex`: that is, ensure verbatim LaTeX
  round-tripping
- Evaluating some functions, such as `\arccos` would result in a crash
- Correctly handle parsing of multi-token decimal markers, e.g. `{,}`

## 0.6.0 _2022-04-18_

### Improvements

- Parse more cases of tabular environments
- Handle simplify and evaluate of inert functions by default
- Avoid unnecessary wrapping of functions when serializing LaTeX
- Parse arguments of LaTeX commands (e.g. `\vec{}`)
- **#42** Export static `ComputeEngine.getLatexDictionary`
- Parse multi-character constants and variables, e.g. `\mathit{speed}` and
  `\mathrm{radius}`
- Parse/serialize some LaTeX styling commands: `\displaystyle`, `\tiny` and more

## 0.5.0 _2022-04-05_

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
console.log(ce.box(["Equal", expr, 2]).evaluate().symbol);
// -> "True"

console.log(expr.isEqual(ce.box(2)));
// -> true
```

### Before / After

| Before                                    | After                                    |
| :---------------------------------------- | :--------------------------------------- |
| `expr = ["Add", 1, 2]`                    | `expr = ce.box(["Add", 1, 2])`           |
| `expr = ce.evaluate(expr)`                | `expr = expr.evaluate()`                 |
| `console.log(expr)`                       | `console.log(expr.json)`                 |
| `expr = new LatexSyntax().parse("x^2+1")` | `expr = ce.parse("x^2+1")`               |
| `new LatexSyntax().serialize(expr)`       | `expr.latex`                             |
| `ce.simplify(expr)`                       | `expr.simplify()`                        |
| `await ce.evaluate(expr)`                 | `expr.evaluate()`                        |
| `ce.N(expr)`                              | `expr.N()`                               |
| `ce.domain(expr)`                         | `expr.domain`                            |
| `ce.format(expr...)`                      | `expr.canonical` <br/> `expr.simplify()` |

## 0.3.0

**Release Date**: 2021-06-18

### Improvements

- In LaTeX, parse `\operatorname{foo}` as the MathJSON symbol `"foo"`.
