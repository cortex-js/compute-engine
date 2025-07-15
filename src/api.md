

## Compute Engine

<a id="angularunit" name="angularunit"></a>

<MemberCard>

### AngularUnit

```ts
type AngularUnit = "rad" | "deg" | "grad" | "turn";
```

When a unitless value is passed to or returned from a trigonometric function,
the angular unit of the value.

| Angular Unit | Description |
|:--------------|:-------------|
| `rad` | radians, 2π radians is a full circle |
| `deg` | degrees, 360 degrees is a full circle |
| `grad` | gradians, 400 gradians is a full circle |
| `turn` | turns, 1 turn is a full circle |

To change the angular unit used by the Compute Engine, use:

```js
ce.angularUnit = 'deg';
```

</MemberCard>

<a id="assignvalue" name="assignvalue"></a>

<MemberCard>

### AssignValue

```ts
type AssignValue = 
  | boolean
  | number
  | bigint
  | SemiBoxedExpression
  | (args, options) => BoxedExpression
  | undefined;
```

The argument of `ce.assign()` is a value that can be assigned to a variable.
It can be a primitive value, a boxed expression, or a function that
takes a list of arguments and returns a boxed expression.

</MemberCard>

<a id="evalcontext" name="evalcontext"></a>

<MemberCard>

### EvalContext

```ts
type EvalContext = {
  lexicalScope: Scope;
  assumptions: ExpressionMapInterface<boolean>;
  values: Record<string, BoxedExpression | undefined>;
  name: undefined | string;
};
```

An evaluation context is a set of bindings mapping symbols to their
values. It also includes a reference to the lexical scope of the
context, as well as a set of assumptions about the values of the
symbols.

Eval contexts are arranged in a stack structure. When a new context is
created, it is pushed on the top of the stack.

A new eval context is created when a function expression that needs to track
its own local variables and named arguments is evaluated. This kind of
function is a "scoped" function, meaning that it has its own local variables
and named arguments.

For example, the `Sum` function creates a new eval context to track the local
variable used as the index of the sum.

The eval context stack is used to resolve the value of symbols.

When a scoped recursive function is called, a new context is created for each
recursive call.

In contrast, the lexical scope is used to resolve the metadata about
symbols, such as their type, whether they are constant, etc... A new
scope is not created for recursive calls, since the metadata
does not change, only the values of the symbols change.

The name of the eval context is used to print a "stack trace" for
debugging.

</MemberCard>

## Boxed Expression

<a id="boxedexpression" name="boxedexpression"></a>

### BoxedExpression

:::info[THEORY OF OPERATIONS]

The `BoxedExpression` interface includes the methods and properties
applicable to all kinds of expression. For example it includes `expr.symbol`
which only applies to symbols or `expr.ops` which only applies to
function expressions.

When a property is not applicable to this `BoxedExpression` its value is
`null`. For example `expr.symbol` for a `BoxedNumber` is `null`.

This convention makes it convenient to manipulate expressions without
having to check what kind of instance they are before manipulating them.
:::

:::info[THEORY OF OPERATIONS]
A boxed expression can represent a canonical or a non-canonical
expression. A non-canonical expression is a "raw" form of the
expression. For example, the non-canonical representation of `\frac{10}{20}`
is `["Divide", 10, 20]`. The canonical representation of the same
expression is the boxed number `1/2`.

The canonical representation of symbols and function expressions are
bound to a definition. The definition contains metadata about the symbol
or function operator, such as its type, its signature, and other attributes.
The value of symbols are tracked in a separate table for each
evaluation context.

The binding only occurs when the expression is constructed, if it is created
as a canonical expression. If the expression is constructed as a
non-canonical expression, no binding is done.

<!--
Rules:
- nothing should cause the binding to occur outside of the constructor
- if an operation require a canonical expression (e.g. evaluate()),
 it should return undefined or throw an error if the expression is not
  canonical
-->

:::

:::info[THEORY OF OPERATIONS]
The **value** of an expression is a number, a string, a boolean or a tensor.

The value of number literals and strings are themselves.

A symbol can have a value associated with it, in which case the value
of the symbol is the value associated with it.

Some symbols (unknowns) are purely symbolic and have no value associated
with them.

Function expressions do not have a value associated with them.
For example, `["Add", 2, 3]` has no value associated with it, it is a
symbolic expression.

Some properties of a Boxed Expression are only applicable if the expression
has a value associated with it. For example, `expr.isNumber` is only
applicable if the value of the expression is a number, that is if the
expression is a number literal or a symbol with a numeric value.

The following properties are applicable to expressions with a value:
- `expr.isNumber`
:::

To create a boxed expression:

#### `ce.box()` and `ce.parse()`

Use `ce.box()` or `ce.parse()`.

Use `ce.parse()` to get a boxed expression from a LaTeX string.
Use `ce.box()` to get a boxed expression from a MathJSON expression.

By default, the result of these methods is a canonical expression. For
example, if it is a rational literal, it is reduced to its canonical form.
If it is a function expression:
   - the arguments are put in canonical form
   - the arguments of commutative functions are sorted
   - invisible operators are made explicit
   - a limited number of core simplifications are applied,
     for example rationals are reduced
   - sequences are flattened: `["Add", 1, ["Sequence", 2, 3]]` is
     transformed to `["Add", 1, 2, 3]`
   - associative functions are flattened: `["Add", 1, ["Add", 2, 3]]` is
     transformed to `["Add", 1, 2, 3]`
   - symbols are **not** replaced with their values (unless they have
      a `holdUntil` flag set to `never`).

#### `ce.function()`

This is a specialized version of `ce.box()` for creating a new function
expression.

The canonical handler of the operator is called.

#### Algebraic methods (`expr.add()`, `expr.mul()`, etc...)

The boxed expression have some algebraic methods, i.e. `add()`, `mul()`,
`div()`, `pow()`, etc. These methods are suitable for
internal calculations, although they may be used as part of the public
API as well.

   - a runtime error is thrown if the expression is not canonical
   - the arguments are not evaluated
   - the canonical handler (of the corresponding operation) is not called
   - some additional simplifications over canonicalization are applied.
     For example number literals are combined.
     However, the result is exact, and no approximation is made. Use `.N()`
     to get an approximate value.
     This is equivalent to calling `simplify()` on the expression (but
     without simplifying the arguments).
   - sequences were already flattened as part of the canonicalization process

For 'add()' and 'mul()', which take multiple arguments, separate functions
are provided that take an array of arguments. They are equivalent
to calling the boxed algebraic method, i.e. `ce.Zero.add(1, 2, 3)` and
`add(1, 2, 3)` are equivalent.

These methods are not equivalent to calling `expr.evaluate()` on the
expression: evaluate will replace symbols with their values, and
evaluate the expression.

For algebraic functions (`add()`, `mul()`, etc..), use the corresponding
canonicalization function, i.e. `canonicalAdd(a, b)` instead of
`ce.function('Add', [a, b])`.

Another option is to use the algebraic methods directly, i.e. `a.add(b)`
instead of `ce.function('Add', [a, b])`. However, the algebraic methods will
apply further simplifications which may or may not be desirable. For
example, number literals will be combined.

#### `ce._fn()`

This method is a low level method to create a new function expression which
is typically invoked in the canonical handler of an operator definition.

The arguments are not modified. The expression is not put in canonical
form. The canonical handler is *not* called.

A canonical flag can be set when calling this method, but it only
asserts that the function expression is canonical. The caller is responsible
for ensuring that is the case.

#### Canonical Handlers

Canonical handlers are responsible for:
   - validating the signature: this can involve checking the
     number of arguments. It is recommended to avoid checking the
     type of non-literal arguments, since the type of symbols or
     function expressions may change. Similarly, the canonicalization
     process should not rely on the value of or assumptions about non-literal
     arguments.
   - flattening sequences
   - flattening arguments if the function is associative
   - sort the arguments (if the function is commutative)
   - calling `ce._fn()` to create a new function expression

When the canonical handler is invoked, the arguments have been put in
canonical form unless the `lazy` flag is set to `true`.

Note that the result of a canonical handler should be a canonical expression,
but not all arguments need to be canonical. For example, the arguments of
`["Declare", "x", 2]` are not canonical, since `x` refers to the name
of the symbol, not its value.

#### Function Expression

<a id="boxedexpression_isfunctionexpression" name="boxedexpression_isfunctionexpression"></a>

<MemberCard>

##### BoxedExpression.isFunctionExpression

```ts
readonly isFunctionExpression: boolean;
```

Return `true` if this expression is a function expression.

If `true`, `expr.ops` is not `null`, and `expr.operator` is the name
of the function.

</MemberCard>

<a id="boxedexpression_operator" name="boxedexpression_operator"></a>

<MemberCard>

##### BoxedExpression.operator

```ts
readonly operator: string;
```

The name of the operator of the expression.

For example, the name of the operator of `["Add", 2, 3]` is `"Add"`.

A string literal has a `"String"` operator.

A symbol has a `"Symbol"` operator.

A number has a `"Number"`, `"Real"`, `"Rational"` or `"Integer"` operator; amongst some others.
Practically speaking, for fully canonical and valid expressions, all of these are likely to
collapse to `"Number"`.

</MemberCard>

<a id="boxedexpression_ops" name="boxedexpression_ops"></a>

<MemberCard>

##### BoxedExpression.ops

```ts
readonly ops: readonly BoxedExpression[];
```

The list of operands of the function.

If the expression is not a function, return `null`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_nops" name="boxedexpression_nops"></a>

<MemberCard>

##### BoxedExpression.nops

```ts
readonly nops: number;
```

If this expression is a function, the number of operands, otherwise 0.

Note that a function can have 0 operands, so to check if this expression
is a function, check if `this.ops !== null` instead.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_op1" name="boxedexpression_op1"></a>

<MemberCard>

##### BoxedExpression.op1

```ts
readonly op1: BoxedExpression;
```

First operand, i.e.`this.ops[0]`.

If there is no first operand, return the symbol `Nothing`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_op2" name="boxedexpression_op2"></a>

<MemberCard>

##### BoxedExpression.op2

```ts
readonly op2: BoxedExpression;
```

Second operand, i.e.`this.ops[1]`

If there is no second operand, return the symbol `Nothing`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_op3" name="boxedexpression_op3"></a>

<MemberCard>

##### BoxedExpression.op3

```ts
readonly op3: BoxedExpression;
```

Third operand, i.e. `this.ops[2]`

If there is no third operand, return the symbol `Nothing`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

#### Numeric Expression

<a id="boxedexpression_isnumberliteral" name="boxedexpression_isnumberliteral"></a>

<MemberCard>

##### BoxedExpression.isNumberLiteral

```ts
readonly isNumberLiteral: boolean;
```

Return `true` if this expression is a number literal, for example
`2`, `3.14`, `1/2`, `√2` etc.

When `true`, `expr.numericValue` is not `null`.

</MemberCard>

<a id="boxedexpression_numericvalue-1" name="boxedexpression_numericvalue-1"></a>

<MemberCard>

##### BoxedExpression.numericValue

```ts
readonly numericValue: number | NumericValue;
```

Return the value of this expression, if a number literal.

Note it is possible for `expr.numericValue` to be `null`, and for
`expr.isNotZero` to be true. For example, when a symbol has been
defined with an assumption.

Conversely, `expr.isNumber` may be true even if `expr.numericValue` is
`null`, for example the symbol `Pi` return `true` for `isNumber` but
`expr.numericValue` is `null` (it's a symbol, not a number literal).
Its value can be accessed with `expr.value`.

To check if an expression is a number literal, use `expr.isNumberLiteral`.
If `expr.isNumberLiteral` is `true`, `expr.numericValue` is not `null`.

</MemberCard>

<a id="boxedexpression_iseven" name="boxedexpression_iseven"></a>

<MemberCard>

##### BoxedExpression.isEven

```ts
readonly isEven: boolean;
```

If the value of this expression is not an **integer** return `undefined`.

</MemberCard>

<a id="boxedexpression_isodd" name="boxedexpression_isodd"></a>

<MemberCard>

##### BoxedExpression.isOdd

```ts
readonly isOdd: boolean;
```

If the value of this expression is not an **integer** return `undefined`.

</MemberCard>

<a id="boxedexpression_re-1" name="boxedexpression_re-1"></a>

<MemberCard>

##### BoxedExpression.re

```ts
readonly re: number;
```

Return the real part of the value of this expression, if a number.

Otherwise, return `NaN` (not a number).

</MemberCard>

<a id="boxedexpression_im-1" name="boxedexpression_im-1"></a>

<MemberCard>

##### BoxedExpression.im

```ts
readonly im: number;
```

If value of this expression is a number, return the imaginary part of the
value. If the value is a real number, the imaginary part is 0.

Otherwise, return `NaN` (not a number).

</MemberCard>

<a id="boxedexpression_bignumre-1" name="boxedexpression_bignumre-1"></a>

<MemberCard>

##### BoxedExpression.bignumRe

```ts
readonly bignumRe: Decimal;
```

If the value of this expression is a number, return the real part of the
value as a `BigNum`.

If the value is not available as a bignum return `undefined`. That is,
the value is not upconverted to a bignum.

To get the real value either as a bignum or a number, use
`expr.bignumRe ?? expr.re`.

When using this pattern, the value is returned as a bignum if available,
otherwise as a number or `NaN` if the value is not a number.

</MemberCard>

<a id="boxedexpression_bignumim-1" name="boxedexpression_bignumim-1"></a>

<MemberCard>

##### BoxedExpression.bignumIm

```ts
readonly bignumIm: Decimal;
```

If the value of this expression is a number, return the imaginary part as
a `BigNum`.

It may be 0 if the number is real.

If the value of the expression is not a number or the value is not
available as a bignum return `undefined`. That is, the value is not
upconverted to a bignum.

To get the imaginary value either as a bignum or a number, use
`expr.bignumIm ?? expr.im`.

When using this pattern, the value is returned as a bignum if available, otherwise as a number or `NaN` if the value is not a number.

</MemberCard>

<a id="boxedexpression_sgn-1" name="boxedexpression_sgn-1"></a>

<MemberCard>

##### BoxedExpression.sgn

```ts
readonly sgn: Sign;
```

Return the sign of the expression.

Note that complex numbers have no natural ordering, so if the value is an
imaginary number (a complex number with a non-zero imaginary part),
`this.sgn` will return `unsigned`.

If a symbol, this does take assumptions into account, that is `this.sgn`
will return `positive` if the symbol is assumed to be positive
using `ce.assume()`.

Non-canonical expressions return `undefined`.

</MemberCard>

<a id="boxedexpression_ispositive" name="boxedexpression_ispositive"></a>

<MemberCard>

##### BoxedExpression.isPositive

```ts
readonly isPositive: boolean;
```

The value of this expression is > 0, same as `isGreaterEqual(0)`

</MemberCard>

<a id="boxedexpression_isnonnegative" name="boxedexpression_isnonnegative"></a>

<MemberCard>

##### BoxedExpression.isNonNegative

```ts
readonly isNonNegative: boolean;
```

The value of this expression is >= 0, same as `isGreaterEqual(0)`

</MemberCard>

<a id="boxedexpression_isnegative" name="boxedexpression_isnegative"></a>

<MemberCard>

##### BoxedExpression.isNegative

```ts
readonly isNegative: boolean;
```

The value of this expression is &lt; 0, same as `isLess(0)`

</MemberCard>

<a id="boxedexpression_isnonpositive" name="boxedexpression_isnonpositive"></a>

<MemberCard>

##### BoxedExpression.isNonPositive

```ts
readonly isNonPositive: boolean;
```

The  value of this expression is &lt;= 0, same as `isLessEqual(0)`

</MemberCard>

<a id="boxedexpression_isnan-1" name="boxedexpression_isnan-1"></a>

<MemberCard>

##### BoxedExpression.isNaN

```ts
readonly isNaN: boolean;
```

If true, the value of this expression is "Not a Number".

A value representing undefined result of computations, such as `0/0`,
as per the floating point format standard IEEE-754.

Note that if `isNaN` is true, `isNumber` is also true (yes, `NaN` is a
number).

</MemberCard>

<a id="boxedexpression_isinfinity" name="boxedexpression_isinfinity"></a>

<MemberCard>

##### BoxedExpression.isInfinity

```ts
readonly isInfinity: boolean;
```

The numeric value of this expression is `±Infinity` or ComplexInfinity.

</MemberCard>

<a id="boxedexpression_isfinite" name="boxedexpression_isfinite"></a>

<MemberCard>

##### BoxedExpression.isFinite

```ts
readonly isFinite: boolean;
```

This expression is a number, but not `±Infinity`, `ComplexInfinity` or
 `NaN`

</MemberCard>

#### Other

<a id="boxedexpression_engine" name="boxedexpression_engine"></a>

<MemberCard>

##### BoxedExpression.engine

```ts
readonly engine: ComputeEngine;
```

The Compute Engine instance associated with this expression provides
a context in which to interpret it, such as definition of symbols
and functions.

</MemberCard>

<a id="boxedexpression_tolatex" name="boxedexpression_tolatex"></a>

<MemberCard>

##### BoxedExpression.toLatex()

```ts
toLatex(options?): string
```

Serialize to a LaTeX string.

Note that lazy collections are eagerly evaluated.

Will ignore any LaTeX metadata.

####### options?

`Partial`\<[`SerializeLatexOptions`](#serializelatexoptions)\>

</MemberCard>

<a id="boxedexpression_latex" name="boxedexpression_latex"></a>

<MemberCard>

##### BoxedExpression.latex

LaTeX representation of this expression.

If the expression was parsed from LaTeX, the LaTeX representation is
the same as the input LaTeX.

To customize the serialization, use `expr.toLatex()`.

Note that lazy collections are eagerly evaluated.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_tomathjson" name="boxedexpression_tomathjson"></a>

<MemberCard>

##### BoxedExpression.toMathJson()

```ts
toMathJson(options?): Expression
```

Serialize to a MathJSON expression with specified options

####### options?

`Readonly`\<`Partial`\<[`JsonSerializationOptions`](#jsonserializationoptions)\>\>

</MemberCard>

<a id="boxedexpression_json" name="boxedexpression_json"></a>

<MemberCard>

##### BoxedExpression.json

```ts
readonly json: Expression;
```

MathJSON representation of this expression.

This representation always use shorthands when possible. Metadata is not
included.

Numbers are converted to JavaScript numbers and may lose precision.

The expression is represented exactly and no sugaring is applied. For
example, `["Power", "x", 2]` is not represented as `["Square", "x"]`.

For more control over the serialization, use `expr.toMathJson()`.

Note that lazy collections are *not* eagerly evaluated.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_print-1" name="boxedexpression_print-1"></a>

<MemberCard>

##### BoxedExpression.print()

```ts
print(): void
```

Output to the console a string representation of the expression.

Note that lazy collections are eagerly evaluated when printed.

</MemberCard>

<a id="boxedexpression_verbatimlatex" name="boxedexpression_verbatimlatex"></a>

<MemberCard>

##### BoxedExpression.verbatimLatex?

```ts
optional verbatimLatex: string;
```

If the expression was constructed from a LaTeX string, the verbatim LaTeX
 string it was parsed from.

</MemberCard>

<a id="boxedexpression_iscanonical" name="boxedexpression_iscanonical"></a>

<MemberCard>

##### BoxedExpression.isCanonical

If `true`, this expression is in a canonical form.

</MemberCard>

<a id="boxedexpression_isstructural" name="boxedexpression_isstructural"></a>

<MemberCard>

##### BoxedExpression.isStructural

If `true`, this expression is in a structural form.

The structural form of an expression is used when applying rules to
an expression. For example, a rational number is represented as a
function expression instead of a `BoxedExpression` object.

</MemberCard>

<a id="boxedexpression_canonical" name="boxedexpression_canonical"></a>

<MemberCard>

##### BoxedExpression.canonical

Return the canonical form of this expression.

If a function expression or symbol, they are first bound with a definition
in the current scope.

When determining the canonical form the following operator definition
flags are applied:
- `associative`: \\( f(a, f(b), c) \longrightarrow f(a, b, c) \\)
- `idempotent`: \\( f(f(a)) \longrightarrow f(a) \\)
- `involution`: \\( f(f(a)) \longrightarrow a \\)
- `commutative`: sort the arguments.

If this expression is already canonical, the value of canonical is
`this`.

The arguments of a canonical function expression may not all be
canonical, for example in the `["Declare", "i", 2]` expression,
`i` is not canonical since it is used only as the name of a symbol, not
as a (potentially) existing symbol.

:::info[Note]
Partially canonical expressions, such as those produced through
`CanonicalForm`, also yield an expression which is marked as `canonical`.
This means that, likewise for partially canonical expressions, the
`canonical` property will return the self-same expression (and
'isCanonical' will also be true).
:::

</MemberCard>

<a id="boxedexpression_structural" name="boxedexpression_structural"></a>

<MemberCard>

##### BoxedExpression.structural

Return the structural form of this expression.

Some expressions, such as rational numbers, are represented with
a `BoxedExpression` object. In some cases, for example when doing a
structural comparison of two expressions, it is useful to have a
structural representation of the expression where the rational numbers
is represented by a function expression instead.

If there is a structural representation of the expression, return it,
otherwise return `this`.

</MemberCard>

<a id="boxedexpression_isvalid" name="boxedexpression_isvalid"></a>

<MemberCard>

##### BoxedExpression.isValid

```ts
readonly isValid: boolean;
```

`false` if this expression or any of its subexpressions is an `["Error"]`
expression.

:::info[Note]
Applicable to canonical and non-canonical expressions. For
non-canonical expression, this may indicate a syntax error while parsing
LaTeX. For canonical expression, this may indicate argument type
mismatch, or missing or unexpected arguments.
:::

</MemberCard>

<a id="boxedexpression_ispure" name="boxedexpression_ispure"></a>

<MemberCard>

##### BoxedExpression.isPure

```ts
readonly isPure: boolean;
```

If *true*, evaluating this expression has no side-effects (does not
change the state of the Compute Engine).

If *false*, evaluating this expression may change the state of the
Compute Engine or it may return a different value each time it is
evaluated, even if the state of the Compute Engine is the same.

As an example, the ["Add", 2, 3]` function expression is pure, but
the `["Random"]` function expression is not pure.

For a function expression to be pure, the function itself (its operator)
must be pure, and all of its arguments must be pure too.

A pure function expression may return a different value each time it is
evaluated if its arguments are not constant. For example, the
`["Add", "x", 1]` function expression is pure, but it is not
constant, because `x` is not constant.

:::info[Note]
Applicable to canonical expressions only
:::

</MemberCard>

<a id="boxedexpression_isconstant" name="boxedexpression_isconstant"></a>

<MemberCard>

##### BoxedExpression.isConstant

```ts
readonly isConstant: boolean;
```

`True` if evaluating this expression always returns the same value.

If *true* and a function expression, implies that it is *pure* and
that all of its arguments are constant.

Number literals, symbols with constant values, and pure numeric functions
with constant arguments are all *constant*, i.e.:
- `42` is constant
- `Pi` is constant
- `["Divide", "Pi", 2]` is constant
- `x` is not constant, unless declared with a constant flag.
- `["Add", "x", 2]` is either constant only if `x` is constant.

</MemberCard>

<a id="boxedexpression_errors" name="boxedexpression_errors"></a>

<MemberCard>

##### BoxedExpression.errors

```ts
readonly errors: readonly BoxedExpression[];
```

All the `["Error"]` subexpressions.

If an expression includes an error, the expression is also an error.
In that case, the `this.isValid` property is `false`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_getsubexpressions" name="boxedexpression_getsubexpressions"></a>

<MemberCard>

##### BoxedExpression.getSubexpressions()

```ts
getSubexpressions(operator): readonly BoxedExpression[]
```

All the subexpressions matching the named operator, recursively.

Example:

```js
const expr = ce.parse('a + b * c + d');
const subexpressions = expr.getSubexpressions('Add');
// -> `[['Add', 'a', 'b'], ['Add', 'c', 'd']]`
```

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### operator

`string`

</MemberCard>

<a id="boxedexpression_subexpressions" name="boxedexpression_subexpressions"></a>

<MemberCard>

##### BoxedExpression.subexpressions

```ts
readonly subexpressions: readonly BoxedExpression[];
```

All the subexpressions in this expression, recursively

Example:

```js
const expr = ce.parse('a + b * c + d');
const subexpressions = expr.subexpressions;
// -> `[['Add', 'a', 'b'], ['Add', 'c', 'd'], 'a', 'b', 'c', 'd']`
```

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_symbols" name="boxedexpression_symbols"></a>

<MemberCard>

##### BoxedExpression.symbols

```ts
readonly symbols: readonly string[];
```

All the symbols in the expression, recursively

```js
const expr = ce.parse('a + b * c + d');
const symbols = expr.symbols;
// -> ['a', 'b', 'c', 'd']
```

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_unknowns" name="boxedexpression_unknowns"></a>

<MemberCard>

##### BoxedExpression.unknowns

```ts
readonly unknowns: readonly string[];
```

All the symbols used in the expression that do not have a value
associated with them, i.e. they are declared but not defined.

</MemberCard>

<a id="boxedexpression_tonumericvalue" name="boxedexpression_tonumericvalue"></a>

<MemberCard>

##### BoxedExpression.toNumericValue()

```ts
toNumericValue(): [NumericValue, BoxedExpression]
```

Attempt to factor a numeric coefficient `c` and a `rest` out of a
canonical expression such that `rest.mul(c)` is equal to `this`.

Attempts to make `rest` a positive value (i.e. pulls out negative sign).

```json
['Multiply', 2, 'x', 3, 'a']
   -> [NumericValue(6), ['Multiply', 'x', 'a']]

['Divide', ['Multiply', 2, 'x'], ['Multiply', 3, 'y', 'a']]
   -> [NumericValue({rational: [2, 3]}), ['Divide', 'x', ['Multiply, 'y', 'a']]]
```

</MemberCard>

<a id="boxedexpression_neg-2" name="boxedexpression_neg-2"></a>

<MemberCard>

##### BoxedExpression.neg()

```ts
neg(): BoxedExpression
```

Negate (additive inverse)

</MemberCard>

<a id="boxedexpression_inv-1" name="boxedexpression_inv-1"></a>

<MemberCard>

##### BoxedExpression.inv()

```ts
inv(): BoxedExpression
```

Inverse (multiplicative inverse)

</MemberCard>

<a id="boxedexpression_abs-1" name="boxedexpression_abs-1"></a>

<MemberCard>

##### BoxedExpression.abs()

```ts
abs(): BoxedExpression
```

Absolute value

</MemberCard>

<a id="boxedexpression_add-3" name="boxedexpression_add-3"></a>

<MemberCard>

##### BoxedExpression.add()

```ts
add(rhs): BoxedExpression
```

Addition

####### rhs

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_sub-2" name="boxedexpression_sub-2"></a>

<MemberCard>

##### BoxedExpression.sub()

```ts
sub(rhs): BoxedExpression
```

Subtraction

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_mul-2" name="boxedexpression_mul-2"></a>

<MemberCard>

##### BoxedExpression.mul()

```ts
mul(rhs): BoxedExpression
```

Multiplication

####### rhs

`number` | [`NumericValue`](#numericvalue) | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_div-2" name="boxedexpression_div-2"></a>

<MemberCard>

##### BoxedExpression.div()

```ts
div(rhs): BoxedExpression
```

Division

####### rhs

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_pow-2" name="boxedexpression_pow-2"></a>

<MemberCard>

##### BoxedExpression.pow()

```ts
pow(exp): BoxedExpression
```

Power

####### exp

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_root-1" name="boxedexpression_root-1"></a>

<MemberCard>

##### BoxedExpression.root()

```ts
root(exp): BoxedExpression
```

Exponentiation

####### exp

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_sqrt-1" name="boxedexpression_sqrt-1"></a>

<MemberCard>

##### BoxedExpression.sqrt()

```ts
sqrt(): BoxedExpression
```

Square root

</MemberCard>

<a id="boxedexpression_ln-1" name="boxedexpression_ln-1"></a>

<MemberCard>

##### BoxedExpression.ln()

```ts
ln(base?): BoxedExpression
```

Logarithm (natural by default)

####### base?

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_numerator-1" name="boxedexpression_numerator-1"></a>

<MemberCard>

##### BoxedExpression.numerator

Return this expression expressed as a numerator.

</MemberCard>

<a id="boxedexpression_denominator-1" name="boxedexpression_denominator-1"></a>

<MemberCard>

##### BoxedExpression.denominator

Return this expression expressed as a denominator.

</MemberCard>

<a id="boxedexpression_numeratordenominator" name="boxedexpression_numeratordenominator"></a>

<MemberCard>

##### BoxedExpression.numeratorDenominator

Return this expression expressed as a numerator and denominator.

</MemberCard>

<a id="boxedexpression_isscoped" name="boxedexpression_isscoped"></a>

<MemberCard>

##### BoxedExpression.isScoped

```ts
readonly isScoped: boolean;
```

If true, the expression has its own local scope that can be used
for local variables and arguments. Only true if the expression is a
function expression.

</MemberCard>

<a id="boxedexpression_localscope" name="boxedexpression_localscope"></a>

<MemberCard>

##### BoxedExpression.localScope

If this expression has a local scope, return it.

</MemberCard>

<a id="boxedexpression_subs" name="boxedexpression_subs"></a>

<MemberCard>

##### BoxedExpression.subs()

```ts
subs(sub, options?): BoxedExpression
```

Replace all the symbols in the expression as indicated.

Note the same effect can be achieved with `this.replace()`, but
using `this.subs()` is more efficient and simpler, but limited
to replacing symbols.

The result is bound to the current scope, not to `this.scope`.

If `options.canonical` is not set, the result is canonical if `this`
is canonical.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### sub

[`Substitution`](#substitutiont)\<[`SemiBoxedExpression`](#semiboxedexpression)\>

####### options?

####### canonical

[`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="boxedexpression_map" name="boxedexpression_map"></a>

<MemberCard>

##### BoxedExpression.map()

```ts
map(fn, options?): BoxedExpression
```

Recursively replace all the subexpressions in the expression as indicated.

To remove a subexpression, return an empty `["Sequence"]` expression.

The `canonical` option is applied to each function subexpression after
the substitution is applied.

If no `options.canonical` is set, the result is canonical if `this`
is canonical.

**Default**: `{ canonical: this.isCanonical, recursive: true }`

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### fn

(`expr`) => [`BoxedExpression`](#boxedexpression)

####### options?

####### canonical

[`CanonicalOptions`](#canonicaloptions)

####### recursive

`boolean`

</MemberCard>

<a id="boxedexpression_replace" name="boxedexpression_replace"></a>

<MemberCard>

##### BoxedExpression.replace()

```ts
replace(rules, options?): BoxedExpression
```

Transform the expression by applying one or more replacement rules:

- If the expression matches the `match` pattern and the `condition`
 predicate is true, replace it with the `replace` pattern.

- If no rules apply, return `null`.

See also `expr.subs()` for a simple substitution of symbols.

If `options.canonical` is not set, the result is canonical if `this`
is canonical.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### rules

[`BoxedRuleSet`](#boxedruleset) | [`Rule`](#rule) | [`Rule`](#rule)[]

####### options?

`Partial`\<[`ReplaceOptions`](#replaceoptions)\>

</MemberCard>

<a id="boxedexpression_has" name="boxedexpression_has"></a>

<MemberCard>

##### BoxedExpression.has()

```ts
has(v): boolean
```

True if the expression includes a symbol `v` or a function operator `v`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### v

`string` | `string`[]

</MemberCard>

<a id="boxedexpression_match" name="boxedexpression_match"></a>

<MemberCard>

##### BoxedExpression.match()

```ts
match(pattern, options?): BoxedSubstitution
```

If this expression matches `pattern`, return a substitution that makes
`pattern` equal to `this`. Otherwise return `null`.

If `pattern` includes wildcards (symbols that start
with `_`), the substitution will include a prop for each matching named
wildcard.

If this expression matches `pattern` but there are no named wildcards,
return the empty substitution, `{}`.

Read more about [**patterns and rules**](/compute-engine/guides/patterns-and-rules/).

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### pattern

[`BoxedExpression`](#boxedexpression)

####### options?

[`PatternMatchOptions`](#patternmatchoptions)

</MemberCard>

<a id="boxedexpression_wikidata" name="boxedexpression_wikidata"></a>

<MemberCard>

##### BoxedExpression.wikidata

```ts
readonly wikidata: string;
```

Wikidata identifier.

If not a canonical expression, return `undefined`.

</MemberCard>

<a id="boxedexpression_description" name="boxedexpression_description"></a>

<MemberCard>

##### BoxedExpression.description

```ts
readonly description: string[];
```

An optional short description if a symbol or function expression.

May include markdown. Each string is a paragraph.

If not a canonical expression, return `undefined`.

</MemberCard>

<a id="boxedexpression_url" name="boxedexpression_url"></a>

<MemberCard>

##### BoxedExpression.url

```ts
readonly url: string;
```

An optional URL pointing to more information about the symbol or
 function operator.

If not a canonical expression, return `undefined`.

</MemberCard>

<a id="boxedexpression_complexity" name="boxedexpression_complexity"></a>

<MemberCard>

##### BoxedExpression.complexity

```ts
readonly complexity: number;
```

Expressions with a higher complexity score are sorted
first in commutative functions

If not a canonical expression, return `undefined`.

</MemberCard>

<a id="boxedexpression_basedefinition" name="boxedexpression_basedefinition"></a>

<MemberCard>

##### BoxedExpression.baseDefinition

```ts
readonly baseDefinition: BoxedBaseDefinition;
```

For symbols and functions, a definition associated with the
expression. `this.baseDefinition` is the base class of symbol and function
definition.

If not a canonical expression, return `undefined`.

</MemberCard>

<a id="boxedexpression_operatordefinition" name="boxedexpression_operatordefinition"></a>

<MemberCard>

##### BoxedExpression.operatorDefinition

```ts
readonly operatorDefinition: BoxedOperatorDefinition;
```

For function expressions, the definition of the operator associated with
the expression. For symbols, the definition of the symbol if it is an
operator, for example `"Sin"`.

If not a canonical expression or not a function expression,
its value is `undefined`.

</MemberCard>

<a id="boxedexpression_valuedefinition" name="boxedexpression_valuedefinition"></a>

<MemberCard>

##### BoxedExpression.valueDefinition

```ts
readonly valueDefinition: BoxedValueDefinition;
```

For symbols, a definition associated with the expression, if it is
not an operator.

If not a canonical expression, or not a value, its value is `undefined`.

</MemberCard>

<a id="boxedexpression_simplify" name="boxedexpression_simplify"></a>

<MemberCard>

##### BoxedExpression.simplify()

```ts
simplify(options?): BoxedExpression
```

Return a simpler form of this expression.

A series of rewriting rules are applied repeatedly, until no more rules
apply.

The values assigned to symbols and the assumptions about symbols may be
used, for example `expr.isInteger` or `expr.isPositive`.

No calculations involving decimal numbers (numbers that are not
integers) are performed but exact calculations may be performed,
for example:

$$ \sin(\frac{\pi}{4}) \longrightarrow \frac{\sqrt{2}}{2} $$.

The result is canonical.

To manipulate symbolically non-canonical expressions, use `expr.replace()`.

####### options?

`Partial`\<[`SimplifyOptions`](#simplifyoptions)\>

</MemberCard>

<a id="boxedexpression_expand" name="boxedexpression_expand"></a>

<MemberCard>

##### BoxedExpression.expand()

```ts
expand(): BoxedExpression
```

Expand the expression: distribute multiplications over additions,
and expand powers.

</MemberCard>

<a id="boxedexpression_evaluate" name="boxedexpression_evaluate"></a>

<MemberCard>

##### BoxedExpression.evaluate()

```ts
evaluate(options?): BoxedExpression
```

Return the value of the canonical form of this expression.

A pure expression always returns the same value (provided that it
remains constant / values of sub-expressions or symbols do not change),
and has no side effects.

Evaluating an impure expression may return a varying value, and may have
some side effects such as adjusting symbol assumptions.

To perform approximate calculations, use `expr.N()` instead,
or call with `options.numericApproximation` to `true`.

It is possible that the result of `expr.evaluate()` may be the same as
`expr.simplify()`.

The result is in canonical form.

####### options?

`Partial`\<[`EvaluateOptions`](#evaluateoptions)\>

</MemberCard>

<a id="boxedexpression_evaluateasync" name="boxedexpression_evaluateasync"></a>

<MemberCard>

##### BoxedExpression.evaluateAsync()

```ts
evaluateAsync(options?): Promise<BoxedExpression>
```

Asynchronous version of `evaluate()`.

The `options` argument can include a `signal` property, which is an
`AbortSignal` object. If the signal is aborted, a `CancellationError` is thrown.

####### options?

`Partial`\<[`EvaluateOptions`](#evaluateoptions)\>

</MemberCard>

<a id="boxedexpression_n-1" name="boxedexpression_n-1"></a>

<MemberCard>

##### BoxedExpression.N()

```ts
N(): BoxedExpression
```

Return a numeric approximation of the canonical form of this expression.

Any necessary calculations, including on decimal numbers (non-integers),
are performed.

The calculations are performed according to the
`precision` property of the `ComputeEngine`.

To only perform exact calculations, use `this.evaluate()` instead.

If the function is not numeric, the result of `this.N()` is the same as
`this.evaluate()`.

The result is in canonical form.

</MemberCard>

<a id="boxedexpression_compile" name="boxedexpression_compile"></a>

<MemberCard>

##### BoxedExpression.compile()

```ts
compile(options?): (...args) => any & {
  isCompiled: boolean;
}
```

Compile the expression to a JavaScript function.

The function takes an object as argument, with the keys being the
symbols in the expression, and returns the value of the expression.

```javascript
const expr = ce.parse("x^2 + y^2");
const f = expr.compile();
console.log(f({x: 2, y: 3}));
// -> 13
```

If the expression is a function literal, the function takes the
arguments of the function as arguments, and returns the value of the
expression.

```javascript
const expr = ce.parse("(x) \mapsto 2x");
const f = expr.compile();
console.log(f(42));
// -> 84
```

If the expression cannot be compiled, a JS function is returned that
falls back to the interpreting the expression, unless the
`options.fallback` is set to `false`. If it is set to `false`, the
function will throw an error if it cannot be compiled.

####### options?

####### to

`"javascript"`

####### functions

`Record`\<`string`, `string` \| (...`any`) => `any`\>

####### vars

`Record`\<`string`, [`CompiledType`](#compiledtype)\>

####### imports

(...`any`) => `any`[]

####### preamble

`string`

####### fallback

`boolean`

</MemberCard>

<a id="boxedexpression_solve" name="boxedexpression_solve"></a>

<MemberCard>

##### BoxedExpression.solve()

```ts
solve(vars?): readonly BoxedExpression[]
```

If this is an equation, solve the equation for the variables in vars.
Otherwise, solve the equation `this = 0` for the variables in vars.

```javascript
const expr = ce.parse("x^2 + 2*x + 1 = 0");
console.log(expr.solve("x"));
```

####### vars?

`string` | `Iterable`\<`string`\> | [`BoxedExpression`](#boxedexpression) | `Iterable`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="boxedexpression_value" name="boxedexpression_value"></a>

<MemberCard>

##### BoxedExpression.value

```ts
get value(): BoxedExpression
set value(value: 
  | string
  | number
  | boolean
  | number[]
  | Decimal
  | OnlyFirst<{
  re: number;
  im: number;
 }, {
  re: number;
  im: number;
 } & {
  num: number;
  denom: number;
 } & BoxedExpression>
  | OnlyFirst<{
  num: number;
  denom: number;
 }, {
  re: number;
  im: number;
 } & {
  num: number;
  denom: number;
 } & BoxedExpression>
  | OnlyFirst<BoxedExpression, {
  re: number;
  im: number;
 } & {
  num: number;
  denom: number;
 } & BoxedExpression>): void
```

If this expression is a number literal, a string literal or a function
 literal, return the expression.

If the expression is a symbol, return the value of the symbol.

Otherwise, the expression is a symbolic expression, including an unknown
symbol, i.e. a symbol with no value, return `undefined`.

If the expression is a symbol, set the value of the symbol.

Will throw a runtime error if either not a symbol, or a symbol with the
`constant` flag set to `true`.

Setting the value of a symbol results in the forgetting of all assumptions
about it in the current scope.

</MemberCard>

<a id="boxedexpression_iscollection" name="boxedexpression_iscollection"></a>

<MemberCard>

##### BoxedExpression.isCollection

```ts
isCollection: boolean;
```

Is `true` if the expression is a collection.

When `isCollection` is `true`, the expression:

- has an `each()` method that returns a generator over the elements
  of the collection.
- has a `size` property that returns the number of elements in the
  collection.
- has a `contains(other)` method that returns `true` if the `other`
  expression is in the collection.

</MemberCard>

<a id="boxedexpression_isindexedcollection" name="boxedexpression_isindexedcollection"></a>

<MemberCard>

##### BoxedExpression.isIndexedCollection

```ts
isIndexedCollection: boolean;
```

Is `true` if this is an indexed collection, such as a list, a vector,
a matrix, a tuple, etc...

The elements of an indexed collection can be accessed by a one-based
index.

When `isIndexedCollection` is `true`, the expression:
- has an `each()`, `size()` and `contains(rhs)` methods
   as for a collection.
- has an `at(index: number)` method that returns the element at the
   specified index.
- has an `indexWhere(predicate: (element: BoxedExpression) => boolean)`
   method that returns the index of the first element that matches the
   predicate.

</MemberCard>

<a id="boxedexpression_islazycollection" name="boxedexpression_islazycollection"></a>

<MemberCard>

##### BoxedExpression.isLazyCollection

```ts
isLazyCollection: boolean;
```

False if not a collection, or if the elements of the collection
are not computed lazily.

The elements of a lazy collection are computed on demand, when
iterating over the collection using `each()`.

Use `ListFrom` and related functions to create eager collections from
lazy collections.

</MemberCard>

<a id="boxedexpression_each" name="boxedexpression_each"></a>

<MemberCard>

##### BoxedExpression.each()

```ts
each(): Generator<BoxedExpression>
```

If this is a collection, return an iterator over the elements of the
collection.

```js
const expr = ce.parse('[1, 2, 3, 4]');
for (const e of expr.each()) {
 console.log(e);
}
```

</MemberCard>

<a id="boxedexpression_xcontains" name="boxedexpression_xcontains"></a>

<MemberCard>

##### BoxedExpression.xcontains()

```ts
xcontains(rhs): boolean
```

If this is a collection, return true if the `rhs` expression is in the
collection.

Return `undefined` if the membership cannot be determined without
iterating over the collection.

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_subsetof" name="boxedexpression_subsetof"></a>

<MemberCard>

##### BoxedExpression.subsetOf()

```ts
subsetOf(other, strict): boolean
```

Check if this collection is a subset of another collection.

####### other

[`BoxedExpression`](#boxedexpression)

The other collection to check against.

####### strict

`boolean`

If true, the subset relation is strict (i.e., proper subset).

</MemberCard>

<a id="boxedexpression_xsize" name="boxedexpression_xsize"></a>

<MemberCard>

##### BoxedExpression.xsize

If this is a collection, return the number of elements in the collection.

If the collection is infinite, return `Infinity`.

If the number of elements cannot be determined, return `undefined`, for
example, if the collection is lazy and not finite and the size cannot
be determined without iterating over the collection.

</MemberCard>

<a id="boxedexpression_isfinitecollection" name="boxedexpression_isfinitecollection"></a>

<MemberCard>

##### BoxedExpression.isFiniteCollection

```ts
isFiniteCollection: boolean;
```

If this is a finite collection, return true.

</MemberCard>

<a id="boxedexpression_isemptycollection" name="boxedexpression_isemptycollection"></a>

<MemberCard>

##### BoxedExpression.isEmptyCollection

```ts
isEmptyCollection: boolean;
```

If this is an empty collection, return true.

An empty collection has a size of 0.

</MemberCard>

<a id="boxedexpression_at-1" name="boxedexpression_at-1"></a>

<MemberCard>

##### BoxedExpression.at()

```ts
at(index): BoxedExpression
```

If this is an indexed collection, return the element at the specified
 index. The first element is at index 1.

If the index is negative, return the element at index `size() + index + 1`.

The last element is at index -1.

####### index

`number`

</MemberCard>

<a id="boxedexpression_get" name="boxedexpression_get"></a>

<MemberCard>

##### BoxedExpression.get()

```ts
get(key): BoxedExpression
```

If this is a keyed collection (map, record, tuple), return the value of
the corresponding key.

If `key` is a `BoxedExpression`, it should be a string.

####### key

`string` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_indexwhere" name="boxedexpression_indexwhere"></a>

<MemberCard>

##### BoxedExpression.indexWhere()

```ts
indexWhere(predicate): number
```

If this is an indexed collection, return the index of the first element
that matches the predicate.

####### predicate

(`element`) => `boolean`

</MemberCard>

#### Primitive Methods

<a id="boxedexpression_valueof-2" name="boxedexpression_valueof-2"></a>

<MemberCard>

##### BoxedExpression.valueOf()

```ts
valueOf(): string | number | boolean | number[] | number[][] | number[][][]
```

Return a JavaScript primitive value for the expression, based on
`Object.valueOf()`.

This method is intended to make it easier to work with JavaScript
primitives, for example when mixing JavaScript computations with
symbolic computations from the Compute Engine.

If the expression is a **machine number**, a **bignum**, or a **rational**
that can be converted to a machine number, return a JavaScript `number`.
This conversion may result in a loss of precision.

If the expression is the **symbol `"True"`** or the **symbol `"False"`**,
return `true` or `false`, respectively.

If the expression is a **symbol with a numeric value**, return the numeric
value of the symbol.

If the expression is a **string literal**, return the string value.

If the expression is a **tensor** (list of number or multidimensional
array or matrix), return an array of numbers, or an array of
arrays of numbers, or an array of arrays of arrays of numbers.

If the expression is a function expression return a string representation
of the expression.

</MemberCard>

<a id="boxedexpression_toprimitive-2" name="boxedexpression_toprimitive-2"></a>

<MemberCard>

##### BoxedExpression.\[toPrimitive\]()

```ts
toPrimitive: string | number
```

Similar to`expr.valueOf()` but includes a hint.

####### hint

`"string"` | `"number"` | `"default"`

</MemberCard>

<a id="boxedexpression_tostring-1" name="boxedexpression_tostring-1"></a>

<MemberCard>

##### BoxedExpression.toString()

```ts
toString(): string
```

Return an ASCIIMath representation of the expression. This string is
suitable to be output to the console for debugging, for example.

Based on `Object.toString()`.

To get a LaTeX representation of the expression, use `expr.latex`.

Note that lazy collections are eagerly evaluated.

Used when coercing a `BoxedExpression` to a `String`.

</MemberCard>

<a id="boxedexpression_tojson-2" name="boxedexpression_tojson-2"></a>

<MemberCard>

##### BoxedExpression.toJSON()

```ts
toJSON(): Expression
```

Used by `JSON.stringify()` to serialize this object to JSON.

Method version of `expr.json`.

Based on `Object.toJSON()`.

Note that lazy collections are *not* eagerly evaluated.

</MemberCard>

<a id="boxedexpression_is-1" name="boxedexpression_is-1"></a>

<MemberCard>

##### BoxedExpression.is()

```ts
is(other): boolean
```

Equivalent to `BoxedExpression.isSame()` but the argument can be
a JavaScript primitive. For example, `expr.is(2)` is equivalent to
`expr.isSame(ce.number(2))`.

####### other

`string` | `number` | `bigint` | `boolean` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

#### Relational Operator

<a id="boxedexpression_issame" name="boxedexpression_issame"></a>

<MemberCard>

##### BoxedExpression.isSame()

```ts
isSame(rhs): boolean
```

Structural/symbolic equality (weak equality).

`ce.parse('1+x', {canonical: false}).isSame(ce.parse('x+1', {canonical: false}))` is `false`.

See `expr.isEqual()` for mathematical equality.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_isless" name="boxedexpression_isless"></a>

<MemberCard>

##### BoxedExpression.isLess()

```ts
isLess(other): boolean
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_islessequal" name="boxedexpression_islessequal"></a>

<MemberCard>

##### BoxedExpression.isLessEqual()

```ts
isLessEqual(other): boolean
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_isgreater" name="boxedexpression_isgreater"></a>

<MemberCard>

##### BoxedExpression.isGreater()

```ts
isGreater(other): boolean
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_isgreaterequal" name="boxedexpression_isgreaterequal"></a>

<MemberCard>

##### BoxedExpression.isGreaterEqual()

```ts
isGreaterEqual(other): boolean
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_isequal" name="boxedexpression_isequal"></a>

<MemberCard>

##### BoxedExpression.isEqual()

```ts
isEqual(other): boolean
```

Mathematical equality (strong equality), that is the value
of this expression and the value of `other` are numerically equal.

Both expressions are evaluated and the result is compared numerically.

Numbers whose difference is less than `engine.tolerance` are
considered equal. This tolerance is set when the `engine.precision` is
changed to be such that the last two digits are ignored.

Evaluating the expressions may be expensive. Other options to consider
to compare two expressions include:
- `expr.isSame(other)` for a structural comparison which does not involve
  evaluating the expressions.
- `expr.is(other)` for a comparison of a number literal

**Examples**

```js
let expr = ce.parse('2 + 2');
console.log(expr.isEqual(4)); // true
console.log(expr.isSame(ce.parse(4))); // false
console.log(expr.is(4)); // false

expr = ce.parse('4');
console.log(expr.isEqual(4)); // true
console.log(expr.isSame(ce.parse(4))); // true
console.log(expr.is(4)); // true (fastest)

```

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

#### String Expression

<a id="boxedexpression_string-1" name="boxedexpression_string-1"></a>

<MemberCard>

##### BoxedExpression.string

```ts
readonly string: string;
```

If this expression is a string, return the value of the string.
Otherwise, return `null`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

#### Symbol Expression

<a id="boxedexpression_symbol" name="boxedexpression_symbol"></a>

<MemberCard>

##### BoxedExpression.symbol

```ts
readonly symbol: string;
```

If this expression is a symbol, return the name of the symbol as a string.
Otherwise, return `null`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

#### Tensor Expression

<a id="boxedexpression_tensor" name="boxedexpression_tensor"></a>

<MemberCard>

##### BoxedExpression.tensor

```ts
readonly tensor: Tensor<any>;
```

If this expression is a tensor, return the tensor data.
Otherwise, return `null`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_shape-2" name="boxedexpression_shape-2"></a>

<MemberCard>

##### BoxedExpression.shape

```ts
readonly shape: number[];
```

The **shape** describes the **axes** of the expression, where each axis
represent a way to index the elements of the expression.

When the expression is a scalar (number), the shape is `[]`.

When the expression is a vector of length `n`, the shape is `[n]`.

When the expression is a `n` by `m` matrix, the shape is `[n, m]`.

</MemberCard>

<a id="boxedexpression_rank-2" name="boxedexpression_rank-2"></a>

<MemberCard>

##### BoxedExpression.rank

```ts
readonly rank: number;
```

The **rank** refers to the number of dimensions (or axes) of the
expression.

Return 0 for a scalar, 1 for a vector, 2 for a matrix, > 2 for
a multidimensional matrix.

The rank is equivalent to the length of `expr.shape`

:::info[Note]
There are several definitions of rank in the literature.
For example, the row rank of a matrix is the number of linearly
independent rows. The rank can also refer to the number of non-zero
singular values of a matrix.
:::

</MemberCard>

#### Type Properties

<a id="boxedexpression_type-2" name="boxedexpression_type-2"></a>

<MemberCard>

##### BoxedExpression.type

```ts
get type(): BoxedType
set type(type: 
  | string
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | RecordType
  | DictionaryType
  | TupleType
  | SymbolType
  | ExpressionType
  | NumericType
  | FunctionSignature
  | ValueType
  | TypeReference
  | BoxedType): void
```

The type of the value of this expression.

If a symbol the type of the value of the symbol.

If a function expression, the type of the value of the function
(the result type).

If a symbol with a `"function"` type (a function literal), returns the
signature.

If not valid, return `"error"`.

If the type is not known, return `"unknown"`.

</MemberCard>

<a id="boxedexpression_isnumber" name="boxedexpression_isnumber"></a>

<MemberCard>

##### BoxedExpression.isNumber

```ts
readonly isNumber: boolean;
```

`true` if the value of this expression is a number.

Note that in a fateful twist of cosmic irony, `NaN` ("Not a Number")
**is** a number.

If `isNumber` is `true`, this indicates that evaluating the expression
will return a number.

This does not indicate that the expression is a number literal. To check
if the expression is a number literal, use `expr.isNumberLiteral`.

For example, the expression `["Add", 1, "x"]` is a number if "x" is a
number and `expr.isNumber` is `true`, but `isNumberLiteral` is `false`.

</MemberCard>

<a id="boxedexpression_isinteger" name="boxedexpression_isinteger"></a>

<MemberCard>

##### BoxedExpression.isInteger

```ts
readonly isInteger: boolean;
```

The value of this expression is an element of the set ℤ: ...,-2, -1, 0, 1, 2...

Note that ±∞ and NaN are not integers.

</MemberCard>

<a id="boxedexpression_isrational" name="boxedexpression_isrational"></a>

<MemberCard>

##### BoxedExpression.isRational

```ts
readonly isRational: boolean;
```

The value of this expression is an element of the set ℚ, p/q with p ∈ ℕ, q ∈ ℤ ⃰  q >= 1

Note that every integer is also a rational.

This is equivalent to `this.type === "rational" || this.type === "integer"`

Note that ±∞ and NaN are not rationals.

</MemberCard>

<a id="boxedexpression_isreal" name="boxedexpression_isreal"></a>

<MemberCard>

##### BoxedExpression.isReal

```ts
readonly isReal: boolean;
```

The value of this expression is a real number.

This is equivalent to `this.type === "rational" || this.type === "integer" || this.type === "real"`

Note that ±∞ and NaN are not real numbers.

</MemberCard>

<a id="semiboxedexpression" name="semiboxedexpression"></a>

<MemberCard>

### SemiBoxedExpression

```ts
type SemiBoxedExpression = 
  | number
  | bigint
  | string
  | BigNum
  | MathJsonNumberObject
  | MathJsonStringObject
  | MathJsonSymbolObject
  | MathJsonFunctionObject
  | MathJsonDictionaryObject
  | readonly [MathJsonSymbol, ...SemiBoxedExpression[]]
  | BoxedExpression;
```

A semi boxed expression is a MathJSON expression which can include some
boxed terms.

This is convenient when creating new expressions from portions
of an existing `BoxedExpression` while avoiding unboxing and reboxing.

</MemberCard>

<a id="replaceoptions" name="replaceoptions"></a>

<MemberCard>

### ReplaceOptions

```ts
type ReplaceOptions = {
  recursive: boolean;
  once: boolean;
  useVariations: boolean;
  iterationLimit: number;
  canonical: CanonicalOptions;
};
```

<a id="replaceoptions_recursive-1" name="replaceoptions_recursive-1"></a>

#### ReplaceOptions.recursive

```ts
recursive: boolean;
```

If `true`, apply replacement rules to all sub-expressions.

If `false`, only consider the top-level expression.

**Default**: `false`

<a id="replaceoptions_once" name="replaceoptions_once"></a>

#### ReplaceOptions.once

```ts
once: boolean;
```

If `true`, stop after the first rule that matches.

If `false`, apply all the remaining rules even after the first match.

**Default**: `false`

<a id="replaceoptions_usevariations-1" name="replaceoptions_usevariations-1"></a>

#### ReplaceOptions.useVariations

```ts
useVariations: boolean;
```

If `true` the rule will use some equivalent variations to match.

For example when `useVariations` is true:
- `x` matches `a + x` with a = 0
- `x` matches `ax` with a = 1
- etc...

Setting this to `true` can save time by condensing multiple rules
into one. This can be particularly useful when describing equations
solutions. However, it can lead to infinite recursion and should be
used with caution.

<a id="replaceoptions_iterationlimit" name="replaceoptions_iterationlimit"></a>

#### ReplaceOptions.iterationLimit

```ts
iterationLimit: number;
```

If `iterationLimit` > 1, the rules will be repeatedly applied
until no rules apply, up to `iterationLimit` times.

Note that if `once` is true, `iterationLimit` has no effect.

**Default**: `1`

<a id="replaceoptions_canonical-2" name="replaceoptions_canonical-2"></a>

#### ReplaceOptions.canonical

```ts
canonical: CanonicalOptions;
```

Indicate if the expression should be canonicalized after the replacement.
If not provided, the expression is canonicalized if the expression
that matched the pattern is canonical.

</MemberCard>

<a id="simplifyoptions" name="simplifyoptions"></a>

<MemberCard>

### SimplifyOptions

```ts
type SimplifyOptions = {
  rules:   | null
     | Rule
     | ReadonlyArray<BoxedRule | Rule>
     | BoxedRuleSet;
  costFunction: (expr) => number;
};
```

Options for `BoxedExpression.simplify()`

<a id="simplifyoptions_rules" name="simplifyoptions_rules"></a>

#### SimplifyOptions.rules?

```ts
optional rules: 
  | null
  | Rule
  | ReadonlyArray<BoxedRule | Rule>
  | BoxedRuleSet;
```

The set of rules to apply. If `null`, use no rules. If not provided,
use the default simplification rules.

<a id="simplifyoptions_costfunction" name="simplifyoptions_costfunction"></a>

#### SimplifyOptions.costFunction()?

```ts
optional costFunction: (expr) => number;
```

Use this cost function to determine if a simplification is worth it.

If not provided, `ce.costFunction`, the cost function of the engine is
used.

</MemberCard>

<a id="canonicalform" name="canonicalform"></a>

<MemberCard>

### CanonicalForm

```ts
type CanonicalForm = 
  | "InvisibleOperator"
  | "Number"
  | "Multiply"
  | "Add"
  | "Power"
  | "Divide"
  | "Flatten"
  | "Order";
```

When provided, canonical forms are used to put an expression in a
"standard" form.

Each canonical form applies some transformation to an expression. When
specified as an array, each transformation is done in the order in which
it was provided.

- `InvisibleOperator`: replace use of the `InvisibleOperator` with
   another operation, such as multiplication (i.e. `2x` or function
   application (`f(x)`). Also replaces ['InvisibleOperator', real, imaginary] instances with
   complex (imaginary) numbers.
- `Number`: replace all numeric values with their
   canonical representation, for example, reduce
   rationals and replace complex numbers with no imaginary part with a real number.
- `Multiply`: replace negation with multiplication by -1, remove 1 from multiplications, simplify signs (`-y \times -x` -> `x \times y`), complex numbers are promoted (['Multiply', 2, 'ImaginaryUnit'] -> `["Complex", 0, 2]`)
- `Add`: replace `Subtract` with `Add`, removes 0 in addition, promote complex numbers (["Add", "a", ["Complex", 0, "b"] -> `["Complex", "a", "b"]`)
- `Power`: simplify `Power` expression, for example, `x^{-1}` -> `\frac{1}{x}`, `x^0` -> `1`, `x^1` -> `x`, `1^x` -> `1`, `x^{\frac{1}{2}}` -> `\sqrt{x}`, `a^b^c` -> `a^{bc}`...
- `Divide`: replace with a `Rational` number if numerator and denominator are integers, simplify, e.g. `\frac{x}{1}` -> `x`...
- `Flatten`: remove any unnecessary `Delimiter` expression, and flatten any associative functions, for example `["Add", ["Add", "a", "b"], "c"]` -> `["Add", "a", "b", "c"]`
- `Order`: when applicable, sort the arguments in a specific order, for
   example for addition and multiplication.

</MemberCard>

<a id="canonicaloptions" name="canonicaloptions"></a>

<MemberCard>

### CanonicalOptions

```ts
type CanonicalOptions = 
  | boolean
  | CanonicalForm
  | CanonicalForm[];
```

</MemberCard>

<a id="evaluateoptions" name="evaluateoptions"></a>

<MemberCard>

### EvaluateOptions

```ts
type EvaluateOptions = {
  numericApproximation: boolean;
  materialization: boolean | number | [number, number];
  signal: AbortSignal;
  withArguments: Record<MathJsonSymbol, BoxedExpression>;
};
```

Options for `BoxedExpression.evaluate()`

<a id="evaluateoptions_numericapproximation" name="evaluateoptions_numericapproximation"></a>

#### EvaluateOptions.numericApproximation

```ts
numericApproximation: boolean;
```

If `true`, the evaluation will return a numeric approximation
of the expression, if possible.
If `false`, the evaluation will return an exact value, if possible.
Defaults to `false`.

<a id="evaluateoptions_materialization" name="evaluateoptions_materialization"></a>

#### EvaluateOptions.materialization

```ts
materialization: boolean | number | [number, number];
```

If `false`, and the result of the expression is a lazy collection,
the collection will not be evaluated and will remain lazy.

If `true` and the expression is a finite lazy collection,
the collection will be evaluated and returned as a non-lazy collection.

If an integer, the collection will be evaluated up to that many elements.

If a pair of integers `[n,m]`, and the collection is finite, the first `n`
elements will be evaluated, and the last `m` elements will be evaluated.

Defaults to `false`.

</MemberCard>

<a id="metadata-1" name="metadata-1"></a>

<MemberCard>

### Metadata

```ts
type Metadata = {
  latex: string;
  wikidata: string;
};
```

Metadata that can be associated with an MathJSON expression.

</MemberCard>

## Pattern Matching

<a id="patternmatchoptions" name="patternmatchoptions"></a>

<MemberCard>

### PatternMatchOptions

```ts
type PatternMatchOptions = {
  substitution: BoxedSubstitution;
  recursive: boolean;
  useVariations: boolean;
};
```

Control how a pattern is matched to an expression.

- `substitution`: if present, assumes these values for the named wildcards,
   and ensure that subsequent occurrence of the same wildcard have the same
   value.
- `recursive`: if true, match recursively, otherwise match only the top
   level.
- `useVariations`: if false, only match expressions that are structurally identical.
   If true, match expressions that are structurally identical or equivalent.

   For example, when true, `["Add", '_a', 2]` matches `2`, with a value of
   `_a` of `0`. If false, the expression does not match. **Default**: `false`

</MemberCard>

<a id="substitutiont" name="substitutiont"></a>

<MemberCard>

### Substitution\<T\>

```ts
type Substitution<T> = {};
```

A substitution describes the values of the wildcards in a pattern so that
the pattern is equal to a target expression.

A substitution can also be considered a more constrained version of a
rule whose `match` is always a symbol.

#### Type Parameters

• T = [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

<a id="boxedsubstitution" name="boxedsubstitution"></a>

<MemberCard>

### BoxedSubstitution

```ts
type BoxedSubstitution = Substitution<BoxedExpression>;
```

</MemberCard>

## Rules

<a id="rulereplacefunction" name="rulereplacefunction"></a>

<MemberCard>

### RuleReplaceFunction()

```ts
type RuleReplaceFunction = (expr, wildcards) => BoxedExpression | undefined;
```

Given an expression and set of wildcards, return a new expression.

For example:

```ts
{
   match: '_x',
   replace: (expr, {_x}) => { return ['Add', 1, _x] }
}
```

</MemberCard>

<a id="ruleconditionfunction" name="ruleconditionfunction"></a>

<MemberCard>

### RuleConditionFunction()

```ts
type RuleConditionFunction = (wildcards, ce) => boolean;
```

</MemberCard>

<a id="rulefunction" name="rulefunction"></a>

<MemberCard>

### RuleFunction()

```ts
type RuleFunction = (expr) => 
  | undefined
  | BoxedExpression
  | RuleStep;
```

</MemberCard>

<a id="rulestep" name="rulestep"></a>

<MemberCard>

### RuleStep

```ts
type RuleStep = {
  value: BoxedExpression;
  because: string;
};
```

</MemberCard>

<a id="rulesteps" name="rulesteps"></a>

<MemberCard>

### RuleSteps

```ts
type RuleSteps = RuleStep[];
```

</MemberCard>

<a id="rule" name="rule"></a>

<MemberCard>

### Rule

```ts
type Rule = 
  | string
  | RuleFunction
  | {
  match:   | LatexString
     | SemiBoxedExpression
     | BoxedExpression;
  replace:   | LatexString
     | SemiBoxedExpression
     | RuleReplaceFunction
     | RuleFunction;
  condition:   | LatexString
     | RuleConditionFunction;
  useVariations: boolean;
  id: string;
  onBeforeMatch: (rule, expr) => void;
  onMatch: (rule, expr, replace) => void;
};
```

A rule describes how to modify an expressions that matches a pattern `match`
into a new expression `replace`.

- `x-1` \( \to \) `1-x`
- `(x+1)(x-1)` \( \to \) `x^2-1

The patterns can be expressed as LaTeX strings or a MathJSON expressions.

As a shortcut, a rule can be defined as a LaTeX string: `x-1 -> 1-x`.
The expression to the left of `->` is the `match` and the expression to the
right is the `replace`. When using LaTeX strings, single character variables
are assumed to be wildcards.

When using MathJSON expressions, anonymous wildcards (`_`) will match any
expression. Named wildcards (`_x`, `_a`, etc...) will match any expression
and bind the expression to the wildcard name.

In addition the sequence wildcard (`__1`, `__a`, etc...) will match
a sequence of one or more expressions, and bind the sequence to the
wildcard name.

Sequence wildcards are useful when the number of elements in the sequence
is not known in advance. For example, in a sum, the number of terms is
not known in advance. ["Add", 0, `__a`] will match two or more terms and
the `__a` wildcard will be a sequence of the matchign terms.

If `exact` is false, the rule will match variants.

For example 'x' will match 'a + x', 'x' will match 'ax', etc...

For simplification rules, you generally want `exact` to be true, but
to solve equations, you want it to be false. Default to true.

When set to false, infinite recursion is possible.

</MemberCard>

<a id="boxedrule" name="boxedrule"></a>

<MemberCard>

### BoxedRule

```ts
type BoxedRule = {
  match: undefined | BoxedExpression;
  replace:   | BoxedExpression
     | RuleReplaceFunction
     | RuleFunction;
  condition: undefined | RuleConditionFunction;
  useVariations: boolean;
  id: string;
  onBeforeMatch: (rule, expr) => void;
  onMatch: (rule, expr, replace) => void;
};
```

If the `match` property is `undefined`, all expressions match this rule
and `condition` should also be `undefined`. The `replace` property should
be a `BoxedExpression` or a `RuleFunction`, and further filtering can be
done in the `replace` function.

</MemberCard>

<a id="boxedruleset" name="boxedruleset"></a>

<MemberCard>

### BoxedRuleSet

```ts
type BoxedRuleSet = {
  rules: ReadonlyArray<BoxedRule>;
};
```

To create a BoxedRuleSet use the `ce.rules()` method.

Do not create a `BoxedRuleSet` directly.

</MemberCard>

## Assumptions

<a id="assumption" name="assumption"></a>

### Assumption

<a id="assumption_ispositive-1" name="assumption_ispositive-1"></a>

<MemberCard>

##### Assumption.isPositive

```ts
isPositive: boolean;
```

</MemberCard>

<a id="assumption_isnonnegative-1" name="assumption_isnonnegative-1"></a>

<MemberCard>

##### Assumption.isNonNegative

```ts
isNonNegative: boolean;
```

</MemberCard>

<a id="assumption_isnegative-1" name="assumption_isnegative-1"></a>

<MemberCard>

##### Assumption.isNegative

```ts
isNegative: boolean;
```

</MemberCard>

<a id="assumption_isnonpositive-1" name="assumption_isnonpositive-1"></a>

<MemberCard>

##### Assumption.isNonPositive

```ts
isNonPositive: boolean;
```

</MemberCard>

<a id="assumption_isnumber-1" name="assumption_isnumber-1"></a>

<MemberCard>

##### Assumption.isNumber

```ts
isNumber: boolean;
```

</MemberCard>

<a id="assumption_isinteger-1" name="assumption_isinteger-1"></a>

<MemberCard>

##### Assumption.isInteger

```ts
isInteger: boolean;
```

</MemberCard>

<a id="assumption_isrational-1" name="assumption_isrational-1"></a>

<MemberCard>

##### Assumption.isRational

```ts
isRational: boolean;
```

</MemberCard>

<a id="assumption_isreal-1" name="assumption_isreal-1"></a>

<MemberCard>

##### Assumption.isReal

```ts
isReal: boolean;
```

</MemberCard>

<a id="assumption_iscomplex" name="assumption_iscomplex"></a>

<MemberCard>

##### Assumption.isComplex

```ts
isComplex: boolean;
```

</MemberCard>

<a id="assumption_isimaginary" name="assumption_isimaginary"></a>

<MemberCard>

##### Assumption.isImaginary

```ts
isImaginary: boolean;
```

</MemberCard>

<a id="assumption_isfinite-2" name="assumption_isfinite-2"></a>

<MemberCard>

##### Assumption.isFinite

```ts
isFinite: boolean;
```

</MemberCard>

<a id="assumption_isinfinite" name="assumption_isinfinite"></a>

<MemberCard>

##### Assumption.isInfinite

```ts
isInfinite: boolean;
```

</MemberCard>

<a id="assumption_isnan-2" name="assumption_isnan-2"></a>

<MemberCard>

##### Assumption.isNaN

```ts
isNaN: boolean;
```

</MemberCard>

<a id="assumption_iszero-3" name="assumption_iszero-3"></a>

<MemberCard>

##### Assumption.isZero

```ts
isZero: boolean;
```

</MemberCard>

<a id="assumption_matches-1" name="assumption_matches-1"></a>

<MemberCard>

##### Assumption.matches()

```ts
matches(t): boolean
```

####### t

[`BoxedType`](#boxedtype)

</MemberCard>

<a id="assumption_isgreater-1" name="assumption_isgreater-1"></a>

<MemberCard>

##### Assumption.isGreater()

```ts
isGreater(other): boolean
```

####### other

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="assumption_isgreaterequal-1" name="assumption_isgreaterequal-1"></a>

<MemberCard>

##### Assumption.isGreaterEqual()

```ts
isGreaterEqual(other): boolean
```

####### other

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="assumption_isless-1" name="assumption_isless-1"></a>

<MemberCard>

##### Assumption.isLess()

```ts
isLess(other): boolean
```

####### other

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="assumption_islessequal-1" name="assumption_islessequal-1"></a>

<MemberCard>

##### Assumption.isLessEqual()

```ts
isLessEqual(other): boolean
```

####### other

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="assumption_isequal-1" name="assumption_isequal-1"></a>

<MemberCard>

##### Assumption.isEqual()

```ts
isEqual(other): boolean
```

####### other

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="assumption_toexpression" name="assumption_toexpression"></a>

<MemberCard>

##### Assumption.toExpression()

```ts
toExpression(ce, x): BoxedExpression
```

####### ce

`ComputeEngine`

####### x

`string`

</MemberCard>

<a id="expressionmapinterfaceu" name="expressionmapinterfaceu"></a>

### ExpressionMapInterface\<U\>

<a id="expressionmapinterfaceu_has-2" name="expressionmapinterfaceu_has-2"></a>

<MemberCard>

##### ExpressionMapInterface.has()

```ts
has(expr): boolean
```

####### expr

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="expressionmapinterfaceu_get-2" name="expressionmapinterfaceu_get-2"></a>

<MemberCard>

##### ExpressionMapInterface.get()

```ts
get(expr): U
```

####### expr

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="expressionmapinterfaceu_set" name="expressionmapinterfaceu_set"></a>

<MemberCard>

##### ExpressionMapInterface.set()

```ts
set(expr, value): void
```

####### expr

[`BoxedExpression`](#boxedexpression)

####### value

`U`

</MemberCard>

<a id="expressionmapinterfaceu_delete" name="expressionmapinterfaceu_delete"></a>

<MemberCard>

##### ExpressionMapInterface.delete()

```ts
delete(expr): void
```

####### expr

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="expressionmapinterfaceu_clear" name="expressionmapinterfaceu_clear"></a>

<MemberCard>

##### ExpressionMapInterface.clear()

```ts
clear(): void
```

</MemberCard>

<a id="expressionmapinterfaceu_iterator-1" name="expressionmapinterfaceu_iterator-1"></a>

<MemberCard>

##### ExpressionMapInterface.\[iterator\]()

```ts
iterator: IterableIterator<[BoxedExpression, U]>
```

</MemberCard>

<a id="expressionmapinterfaceu_entries-1" name="expressionmapinterfaceu_entries-1"></a>

<MemberCard>

##### ExpressionMapInterface.entries()

```ts
entries(): IterableIterator<[BoxedExpression, U]>
```

</MemberCard>

<a id="assumeresult" name="assumeresult"></a>

<MemberCard>

### AssumeResult

```ts
type AssumeResult = 
  | "internal-error"
  | "not-a-predicate"
  | "contradiction"
  | "tautology"
  | "ok";
```

</MemberCard>

## Compiling

<a id="compiledtype" name="compiledtype"></a>

<MemberCard>

### CompiledType

```ts
type CompiledType = boolean | number | string | object;
```

</MemberCard>

<a id="jssource" name="jssource"></a>

<MemberCard>

### JSSource

```ts
type JSSource = string;
```

</MemberCard>

<a id="compiledexpression" name="compiledexpression"></a>

<MemberCard>

### CompiledExpression

```ts
type CompiledExpression = {
  evaluate: (scope) => number | BoxedExpression;
};
```

</MemberCard>

## Definitions

<a id="eqhandlers" name="eqhandlers"></a>

### EqHandlers

These handlers compare two expressions.

If only one of the handlers is provided, the other is derived from it.

Having both may be useful if comparing non-equality is faster than equality.

<a id="eqhandlers_eq-1" name="eqhandlers_eq-1"></a>

<MemberCard>

##### EqHandlers.eq()

```ts
eq: (a, b) => boolean;
```

</MemberCard>

<a id="eqhandlers_neq" name="eqhandlers_neq"></a>

<MemberCard>

##### EqHandlers.neq()

```ts
neq: (a, b) => boolean;
```

</MemberCard>

<a id="hold" name="hold"></a>

<MemberCard>

### Hold

```ts
type Hold = "none" | "all" | "first" | "rest" | "last" | "most";
```

</MemberCard>

<a id="valuedefinition-1" name="valuedefinition-1"></a>

<MemberCard>

### ValueDefinition

```ts
type ValueDefinition = BaseDefinition & {
  holdUntil: "never" | "evaluate" | "N";
  type:   | Type
     | TypeString
     | BoxedType;
  inferred: boolean;
  value:   | LatexString
     | SemiBoxedExpression
     | (ce) => BoxedExpression | null;
  eq: (a) => boolean | undefined;
  neq: (a) => boolean | undefined;
  cmp: (a) => "=" | ">" | "<" | undefined;
  collection: CollectionHandlers;
};
```

A bound symbol (i.e. one with an associated definition) has either a type
(e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... type = 'real').

#### ValueDefinition.inferred

```ts
inferred: boolean;
```

If true, the type is inferred, and could be adjusted later
as more information becomes available or if the symbol is explicitly
declared.

#### ValueDefinition.value

```ts
value: 
  | LatexString
  | SemiBoxedExpression
  | (ce) => BoxedExpression | null;
```

`value` can be a JS function since for some constants, such as
`Pi`, the actual value depends on the `precision` setting of the
`ComputeEngine` and possible other environment settings

</MemberCard>

<a id="operatordefinition-1" name="operatordefinition-1"></a>

<MemberCard>

### OperatorDefinition

```ts
type OperatorDefinition = Partial<BaseDefinition> & Partial<OperatorDefinitionFlags> & {
  signature:   | Type
     | TypeString
     | BoxedType;
  type: (ops, options) => 
     | Type
     | TypeString
     | BoxedType
     | undefined;
  sgn: (ops, options) => Sign | undefined;
  isPositive: boolean;
  isNonNegative: boolean;
  isNegative: boolean;
  isNonPositive: boolean;
  even: (ops, options) => boolean | undefined;
  complexity: number;
  canonical: (ops, options) => BoxedExpression | null;
  evaluate:   | (ops, options) => BoxedExpression | undefined
     | BoxedExpression;
  evaluateAsync: (ops, options) => Promise<BoxedExpression | undefined>;
  evalDimension: (args, options) => BoxedExpression;
  xcompile: (expr) => CompiledExpression;
  eq: (a, b) => boolean | undefined;
  neq: (a, b) => boolean | undefined;
  collection: CollectionHandlers;
};
```

Definition record for a function.

#### OperatorDefinition.signature?

```ts
optional signature: 
  | Type
  | TypeString
  | BoxedType;
```

The function signature, describing the type of the arguments and the
return type.

If a `type` handler is provided, the return type of the function should
be a subtype of the return type in the signature.

#### OperatorDefinition.type()?

```ts
optional type: (ops, options) => 
  | Type
  | TypeString
  | BoxedType
  | undefined;
```

The type of the result (return type) based on the type of
the arguments.

Should be a subtype of the type indicated by the signature.

For example, if the signature is `(number) -> real`, the type of the
result could be `real` or `integer`, but not `complex`.

:::info[Note]
Do not evaluate the arguments.

However, the type of the arguments can be used to determine the type of
the result.
:::

#### OperatorDefinition.sgn()?

```ts
optional sgn: (ops, options) => Sign | undefined;
```

Return the sign of the function expression.

If the sign cannot be determined, return `undefined`.

When determining the sign, only literal values and the values of
symbols, if they are literals, should be considered.

Do not evaluate the arguments.

However, the type and sign of the arguments can be used to determine the
sign.

#### OperatorDefinition.isPositive?

```ts
readonly optional isPositive: boolean;
```

The value of this expression is > 0, same as `isGreater(0)`

#### OperatorDefinition.isNonNegative?

```ts
readonly optional isNonNegative: boolean;
```

The value of this expression is >= 0, same as `isGreaterEqual(0)`

#### OperatorDefinition.isNegative?

```ts
readonly optional isNegative: boolean;
```

The value of this expression is &lt; 0, same as `isLess(0)`

#### OperatorDefinition.isNonPositive?

```ts
readonly optional isNonPositive: boolean;
```

The  value of this expression is &lt;= 0, same as `isLessEqual(0)`

#### OperatorDefinition.even()?

```ts
optional even: (ops, options) => boolean | undefined;
```

Return `true` if the function expression is even, `false` if it is odd
and `undefined` if it is neither (for example if it is not a number,
or if it is a complex number).

#### OperatorDefinition.complexity?

```ts
optional complexity: number;
```

A number used to order arguments.

Argument with higher complexity are placed after arguments with
lower complexity when ordered canonically in commutative functions.

- Additive functions: 1000-1999
- Multiplicative functions: 2000-2999
- Root and power functions: 3000-3999
- Log functions: 4000-4999
- Trigonometric functions: 5000-5999
- Hypertrigonometric functions: 6000-6999
- Special functions (factorial, Gamma, ...): 7000-7999
- Collections: 8000-8999
- Inert and styling:  9000-9999
- Logic: 10000-10999
- Relational: 11000-11999

**Default**: 100,000

#### OperatorDefinition.canonical()?

```ts
optional canonical: (ops, options) => BoxedExpression | null;
```

Return the canonical form of the expression with the arguments `args`.

The arguments (`args`) may not be in canonical form. If necessary, they
can be put in canonical form.

This handler should validate the type and number of the arguments
(arity).

If a required argument is missing, it should be indicated with a
`["Error", "'missing"]` expression. If more arguments than expected
are present, this should be indicated with an
`["Error", "'unexpected-argument'"]` error expression

If the type of an argument is not compatible, it should be indicated
with an `incompatible-type` error.

`["Sequence"]` expressions are not folded and need to be handled
 explicitly.

If the function is associative, idempotent or an involution,
this handler should account for it. Notably, if it is commutative, the
arguments should be sorted in canonical order.

Values of symbols should not be substituted, unless they have
a `holdUntil` attribute of `"never"`.

The handler should not consider the value or any assumptions about any
of the arguments that are symbols or functions (i.e. `arg.isZero`,
`arg.isInteger`, etc...) since those may change over time.

The result of the handler should be a canonical expression.

If the arguments do not match, they should be replaced with an
appropriate `["Error"]` expression. If the expression cannot be put in
canonical form, the handler should return `null`.

#### OperatorDefinition.evaluate?

```ts
optional evaluate: 
  | (ops, options) => BoxedExpression | undefined
  | BoxedExpression;
```

Evaluate a function expression.

When the handler is invoked, the arguments have been evaluated, except
if the `lazy` option is set to `true`.

It is not necessary to further simplify or evaluate the arguments.

If performing numerical calculations and `options.numericalApproximation`
is `false` return an exact numeric value, for example return a rational
number or a square root, rather than a floating point approximation.
Use `ce.number()` to create the numeric value.

If the expression cannot be evaluated, due to the values, types, or
assumptions about its arguments, return `undefined` or
an `["Error"]` expression.

#### OperatorDefinition.evaluateAsync()?

```ts
optional evaluateAsync: (ops, options) => Promise<BoxedExpression | undefined>;
```

An asynchronous version of `evaluate`.

#### OperatorDefinition.evalDimension()?

```ts
optional evalDimension: (args, options) => BoxedExpression;
```

**`Experimental`**

Dimensional analysis

#### OperatorDefinition.xcompile()?

```ts
optional xcompile: (expr) => CompiledExpression;
```

Return a compiled (optimized) expression.

</MemberCard>

<a id="basedefinition-1" name="basedefinition-1"></a>

### BaseDefinition

Metadata common to both symbols and functions.

<a id="basedefinition-1_description-1" name="basedefinition-1_description-1"></a>

<MemberCard>

##### BaseDefinition.description

```ts
description: string | string[];
```

If a string, a short description, about one line long.

Otherwise, a list of strings, each string a paragraph.

May contain Markdown.

</MemberCard>

<a id="basedefinition-1_examples" name="basedefinition-1_examples"></a>

<MemberCard>

##### BaseDefinition.examples

```ts
examples: string | string[];
```

A list of examples of how to use this symbol or operator.

Each example is a string, which can be a MathJSON expression or LaTeX, bracketed by `$` signs.
For example, `["Add", 1, 2]` or `$\\sin(\\pi/4)$`.

</MemberCard>

<a id="basedefinition-1_url-1" name="basedefinition-1_url-1"></a>

<MemberCard>

##### BaseDefinition.url

```ts
url: string;
```

A URL pointing to more information about this symbol or operator.

</MemberCard>

<a id="basedefinition-1_wikidata-1" name="basedefinition-1_wikidata-1"></a>

<MemberCard>

##### BaseDefinition.wikidata

```ts
wikidata: string;
```

A short string representing an entry in a wikibase.

For example `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
for the `Pi` constant.

</MemberCard>

<a id="basedefinition-1_isconstant-1" name="basedefinition-1_isconstant-1"></a>

<MemberCard>

##### BaseDefinition.isConstant?

```ts
readonly optional isConstant: boolean;
```

If true, the value or type of the definition cannot be changed

</MemberCard>

<a id="symboldefinition" name="symboldefinition"></a>

<MemberCard>

### SymbolDefinition

```ts
type SymbolDefinition = OneOf<[ValueDefinition, OperatorDefinition]>;
```

A table mapping symbols to their definition.

Symbols should be valid MathJSON symbols. In addition, the
following rules are recommended:

- Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
- The first character should be a letter: `/^[a-zA-Z]/`
- Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`

</MemberCard>

<a id="symboldefinitions" name="symboldefinitions"></a>

<MemberCard>

### SymbolDefinitions

```ts
type SymbolDefinitions = Readonly<{}>;
```

</MemberCard>

<a id="basecollectionhandlers" name="basecollectionhandlers"></a>

### BaseCollectionHandlers

These handlers are the primitive operations that can be performed on
all collections, indexed or not.

#### Definitions

<a id="basecollectionhandlers_iterator" name="basecollectionhandlers_iterator"></a>

<MemberCard>

##### BaseCollectionHandlers.iterator()

```ts
iterator: (collection) => Iterator<BoxedExpression, undefined>;
```

Return an iterator that iterates over the elements of the collection.

The order in which the elements are returned is not defined. Requesting
two iterators on the same collection may return the elements in a
different order.

</MemberCard>

#### Other

<a id="basecollectionhandlers_count" name="basecollectionhandlers_count"></a>

<MemberCard>

##### BaseCollectionHandlers.count()

```ts
count: (collection) => number;
```

Return the number of elements in the collection.

An empty collection has a count of 0.

</MemberCard>

<a id="basecollectionhandlers_isempty" name="basecollectionhandlers_isempty"></a>

<MemberCard>

##### BaseCollectionHandlers.isEmpty()?

```ts
optional isEmpty: (collection) => boolean;
```

Optional flag to quickly check if the collection is empty, without having to count exactly how may elements it has (useful for lazy evaluation).

</MemberCard>

<a id="basecollectionhandlers_isfinite-1" name="basecollectionhandlers_isfinite-1"></a>

<MemberCard>

##### BaseCollectionHandlers.isFinite()?

```ts
optional isFinite: (collection) => boolean;
```

Optional flag to quickly check if the collection is finite, without having to count exactly how many elements it has (useful for lazy evaluation).

</MemberCard>

<a id="basecollectionhandlers_islazy" name="basecollectionhandlers_islazy"></a>

<MemberCard>

##### BaseCollectionHandlers.isLazy()?

```ts
optional isLazy: (collection) => boolean;
```

Return `true` if the collection is lazy, `false` otherwise.
If the collection is lazy, it means that the elements are not
computed until they are needed, for example when iterating over the
collection.

Default: `true`

</MemberCard>

<a id="basecollectionhandlers_contains" name="basecollectionhandlers_contains"></a>

<MemberCard>

##### BaseCollectionHandlers.contains()?

```ts
optional contains: (collection, target) => boolean;
```

Return `true` if the target expression is in the collection,
`false` otherwise.

Return `undefined` if the membership cannot be determined.

</MemberCard>

<a id="basecollectionhandlers_subsetof-1" name="basecollectionhandlers_subsetof-1"></a>

<MemberCard>

##### BaseCollectionHandlers.subsetOf()?

```ts
optional subsetOf: (collection, other, strict) => boolean;
```

Return `true` if all the elements of `other` are in `collection`.
Both `collection` and `other` are collections.

If strict is `true`, the subset must be strict, that is, `collection` must
have more elements than `other`.

Return `undefined` if the subset relation cannot be determined.

</MemberCard>

<a id="basecollectionhandlers_eltsgn" name="basecollectionhandlers_eltsgn"></a>

<MemberCard>

##### BaseCollectionHandlers.eltsgn()?

```ts
optional eltsgn: (collection) => Sign;
```

Return the sign of all the elements of the collection.

</MemberCard>

<a id="basecollectionhandlers_elttype" name="basecollectionhandlers_elttype"></a>

<MemberCard>

##### BaseCollectionHandlers.elttype()?

```ts
optional elttype: (collection) => Type;
```

Return the widest type of all the elements in the collection

</MemberCard>

<a id="indexedcollectionhandlers" name="indexedcollectionhandlers"></a>

### IndexedCollectionHandlers

These additional collection handlers are applicable to indexed
collections only.

The elements of an indexed collection can be accessed by index, and
the order of the elements is defined.

<a id="indexedcollectionhandlers_at-2" name="indexedcollectionhandlers_at-2"></a>

<MemberCard>

##### IndexedCollectionHandlers.at()

```ts
at: (collection, index) => BoxedExpression;
```

Return the element at the specified index.

The first element is `at(1)`, the last element is `at(-1)`.

If the index is &lt;0, return the element at index `count() + index + 1`.

The index can also be a string for example for records. The set of valid
keys is returned by the `keys()` handler.

If the index is invalid, return `undefined`.

</MemberCard>

<a id="indexedcollectionhandlers_indexwhere-1" name="indexedcollectionhandlers_indexwhere-1"></a>

<MemberCard>

##### IndexedCollectionHandlers.indexWhere()

```ts
indexWhere: (collection, predicate) => number;
```

Return the index of the first element that matches the predicate.

If no element matches the predicate, return `undefined`.

</MemberCard>

<a id="collectionhandlers" name="collectionhandlers"></a>

<MemberCard>

### CollectionHandlers

```ts
type CollectionHandlers = BaseCollectionHandlers & Partial<IndexedCollectionHandlers>;
```

The collection handlers are the primitive operations that can be
performed on collections, such as lists, sets, tuples, etc...

</MemberCard>

<a id="taggedvaluedefinition" name="taggedvaluedefinition"></a>

<MemberCard>

### TaggedValueDefinition

```ts
type TaggedValueDefinition = {
  value: BoxedValueDefinition;
};
```

The definition for a value, represented as a tagged object literal.

</MemberCard>

<a id="taggedoperatordefinition" name="taggedoperatordefinition"></a>

<MemberCard>

### TaggedOperatorDefinition

```ts
type TaggedOperatorDefinition = {
  operator: BoxedOperatorDefinition;
};
```

The definition for an operator, represented as a tagged object literal.

</MemberCard>

<a id="boxeddefinition" name="boxeddefinition"></a>

<MemberCard>

### BoxedDefinition

```ts
type BoxedDefinition = 
  | TaggedValueDefinition
  | TaggedOperatorDefinition;
```

A definition can be either a value or an operator.

It is collected in a tagged object literal, instead of being a simple union
type, so that the type of the definition can be changed while keeping
references to the definition in bound expressions.

</MemberCard>

<a id="boxedbasedefinition" name="boxedbasedefinition"></a>

### BoxedBaseDefinition

#### Extends

- `Partial`\<[`BaseDefinition`](#basedefinition-1)\>

#### Extended by

- [`BoxedValueDefinition`](#boxedvaluedefinition)
- [`BoxedOperatorDefinition`](#boxedoperatordefinition)

<a id="boxedbasedefinition_collection" name="boxedbasedefinition_collection"></a>

<MemberCard>

##### BoxedBaseDefinition.collection?

```ts
optional collection: CollectionHandlers;
```

If this is the definition of a collection, the set of primitive operations
that can be performed on this collection (counting the number of elements,
enumerating it, etc...).

</MemberCard>

<a id="boxedvaluedefinition" name="boxedvaluedefinition"></a>

### BoxedValueDefinition

#### Extends

- [`BoxedBaseDefinition`](#boxedbasedefinition)

<a id="boxedvaluedefinition_holduntil" name="boxedvaluedefinition_holduntil"></a>

<MemberCard>

##### BoxedValueDefinition.holdUntil

```ts
holdUntil: "never" | "evaluate" | "N";
```

If the symbol has a value, it is held as indicated in the table below.
A green checkmark indicate that the symbol is substituted.

<div className="symbols-table">

| Operation     | `"never"` | `"evaluate"` | `"N"` |
| :---          | :-----:   | :----:      | :---:  |
| `canonical()` |    (X)    |              |       |
| `evaluate()`  |    (X)    |     (X)      |       |
| `"N()"`       |    (X)    |     (X)      |  (X)  |

</div>

Some examples:
- `ImaginaryUnit` has `holdUntil: 'never'`: it is substituted during canonicalization
- `x` has `holdUntil: 'evaluate'` (variables)
- `Pi` has `holdUntil: 'N'` (special numeric constant)

**Default:** `evaluate`

</MemberCard>

<a id="boxedvaluedefinition_value-1" name="boxedvaluedefinition_value-1"></a>

<MemberCard>

##### BoxedValueDefinition.value

```ts
readonly value: BoxedExpression;
```

This is either the initial value of the symbol (i.e. when a new
 evaluation context is created), or its constant value, if a constant.
 Otherwise, the current value is tracked in the evaluation context.

</MemberCard>

<a id="boxedvaluedefinition_eq-2" name="boxedvaluedefinition_eq-2"></a>

<MemberCard>

##### BoxedValueDefinition.eq()?

```ts
optional eq: (a) => boolean;
```

</MemberCard>

<a id="boxedvaluedefinition_neq-1" name="boxedvaluedefinition_neq-1"></a>

<MemberCard>

##### BoxedValueDefinition.neq()?

```ts
optional neq: (a) => boolean;
```

</MemberCard>

<a id="boxedvaluedefinition_cmp" name="boxedvaluedefinition_cmp"></a>

<MemberCard>

##### BoxedValueDefinition.cmp()?

```ts
optional cmp: (a) => ">" | "<" | "=";
```

</MemberCard>

<a id="boxedvaluedefinition_inferredtype" name="boxedvaluedefinition_inferredtype"></a>

<MemberCard>

##### BoxedValueDefinition.inferredType

```ts
inferredType: boolean;
```

True if the type has been inferred. An inferred type can be updated as
more information becomes available.

A type that is not inferred, but has been set explicitly, cannot be updated.

</MemberCard>

<a id="boxedvaluedefinition_type-3" name="boxedvaluedefinition_type-3"></a>

<MemberCard>

##### BoxedValueDefinition.type

```ts
type: BoxedType;
```

</MemberCard>

<a id="operatordefinitionflags" name="operatordefinitionflags"></a>

<MemberCard>

### OperatorDefinitionFlags

```ts
type OperatorDefinitionFlags = {
  lazy: boolean;
  scoped: boolean;
  broadcastable: boolean;
  associative: boolean;
  commutative: boolean;
  commutativeOrder: (a, b) => number | undefined;
  idempotent: boolean;
  involution: boolean;
  pure: boolean;
};
```

An operator definition can have some flags to indicate specific
properties of the operator.

<a id="operatordefinitionflags_lazy" name="operatordefinitionflags_lazy"></a>

#### OperatorDefinitionFlags.lazy

```ts
lazy: boolean;
```

If `true`, the arguments to this operator are not automatically
evaluated. The default is `false` (the arguments are evaluated).

This can be useful for example for operators that take symbolic
expressions as arguments, such as `Declare` or `Integrate`.

This is also useful for operators that take an argument that is
potentially an infinite collection.

It will be up to the `evaluate()` handler to evaluate the arguments as
needed. This is convenient to pass symbolic expressions as arguments
to operators without having to explicitly use a `Hold` expression.

This also applies to the `canonical()` handler.

<a id="operatordefinitionflags_scoped" name="operatordefinitionflags_scoped"></a>

#### OperatorDefinitionFlags.scoped

```ts
scoped: boolean;
```

If `true`, the operator requires a new lexical scope when canonicalized.
This will allow it to declare variables that are not visible outside
the function expression using the operator.

**Default**: `false`

<a id="operatordefinitionflags_broadcastable" name="operatordefinitionflags_broadcastable"></a>

#### OperatorDefinitionFlags.broadcastable

```ts
broadcastable: boolean;
```

If `true`, the operator is applied element by element to lists, matrices
(`["List"]` or `["Tuple"]` expressions) and equations (relational
operators).

**Default**: `false`

<a id="operatordefinitionflags_associative" name="operatordefinitionflags_associative"></a>

#### OperatorDefinitionFlags.associative

```ts
associative: boolean;
```

If `true`, `["f", ["f", a], b]` simplifies to `["f", a, b]`

**Default**: `false`

<a id="operatordefinitionflags_commutative" name="operatordefinitionflags_commutative"></a>

#### OperatorDefinitionFlags.commutative

```ts
commutative: boolean;
```

If `true`, `["f", a, b]` equals `["f", b, a]`. The canonical
version of the function will order the arguments.

**Default**: `false`

<a id="operatordefinitionflags_commutativeorder" name="operatordefinitionflags_commutativeorder"></a>

#### OperatorDefinitionFlags.commutativeOrder

```ts
commutativeOrder: (a, b) => number | undefined;
```

If `commutative` is `true`, the order of the arguments is determined by
this function.

If the function is not provided, the arguments are ordered by the
default order of the arguments.

<a id="operatordefinitionflags_idempotent" name="operatordefinitionflags_idempotent"></a>

#### OperatorDefinitionFlags.idempotent

```ts
idempotent: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `["f", x]`.

**Default**: `false`

<a id="operatordefinitionflags_involution" name="operatordefinitionflags_involution"></a>

#### OperatorDefinitionFlags.involution

```ts
involution: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `x`.

**Default**: `false`

<a id="operatordefinitionflags_pure" name="operatordefinitionflags_pure"></a>

#### OperatorDefinitionFlags.pure

```ts
pure: boolean;
```

If `true`, the value of this operator is always the same for a given
set of arguments and it has no side effects.

An expression using this operator is pure if the operator and all its
arguments are pure.

For example `Sin` is pure, `Random` isn't.

This information may be used to cache the value of expressions.

**Default:** `true`

</MemberCard>

<a id="boxedoperatordefinition" name="boxedoperatordefinition"></a>

### BoxedOperatorDefinition

The definition includes information specific about an operator, such as
handlers to canonicalize or evaluate a function expression with this
operator.

#### Extends

- [`BoxedBaseDefinition`](#boxedbasedefinition).[`OperatorDefinitionFlags`](#operatordefinitionflags)

<a id="boxedoperatordefinition_complexity-1" name="boxedoperatordefinition_complexity-1"></a>

<MemberCard>

##### BoxedOperatorDefinition.complexity

```ts
complexity: number;
```

</MemberCard>

<a id="boxedoperatordefinition_inferredsignature" name="boxedoperatordefinition_inferredsignature"></a>

<MemberCard>

##### BoxedOperatorDefinition.inferredSignature

```ts
inferredSignature: boolean;
```

If true, the signature was inferred from usage and may be modified
as more information becomes available.

</MemberCard>

<a id="boxedoperatordefinition_signature" name="boxedoperatordefinition_signature"></a>

<MemberCard>

##### BoxedOperatorDefinition.signature

```ts
signature: BoxedType;
```

The type of the arguments and return value of this function

</MemberCard>

<a id="boxedoperatordefinition_type-4" name="boxedoperatordefinition_type-4"></a>

<MemberCard>

##### BoxedOperatorDefinition.type()?

```ts
optional type: (ops, options) => 
  | string
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | RecordType
  | DictionaryType
  | TupleType
  | SymbolType
  | ExpressionType
  | NumericType
  | FunctionSignature
  | ValueType
  | TypeReference
  | BoxedType;
```

If present, this handler can be used to more precisely determine the
return type based on the type of the arguments. The arguments themselves
should *not* be evaluated, only their types should be used.

</MemberCard>

<a id="boxedoperatordefinition_sgn-2" name="boxedoperatordefinition_sgn-2"></a>

<MemberCard>

##### BoxedOperatorDefinition.sgn()?

```ts
optional sgn: (ops, options) => Sign;
```

If present, this handler can be used to determine the sign of the
 return value of the function, based on the sign and type of its
 arguments.

The arguments themselves should *not* be evaluated, only their types and
sign should be used.

This can be used in some case for example to determine when certain
simplifications are valid.

</MemberCard>

<a id="boxedoperatordefinition_eq-3" name="boxedoperatordefinition_eq-3"></a>

<MemberCard>

##### BoxedOperatorDefinition.eq()?

```ts
optional eq: (a, b) => boolean;
```

</MemberCard>

<a id="boxedoperatordefinition_neq-2" name="boxedoperatordefinition_neq-2"></a>

<MemberCard>

##### BoxedOperatorDefinition.neq()?

```ts
optional neq: (a, b) => boolean;
```

</MemberCard>

<a id="boxedoperatordefinition_canonical-1" name="boxedoperatordefinition_canonical-1"></a>

<MemberCard>

##### BoxedOperatorDefinition.canonical()?

```ts
optional canonical: (ops, options) => BoxedExpression;
```

</MemberCard>

<a id="boxedoperatordefinition_evaluate-1" name="boxedoperatordefinition_evaluate-1"></a>

<MemberCard>

##### BoxedOperatorDefinition.evaluate()?

```ts
optional evaluate: (ops, options) => BoxedExpression;
```

</MemberCard>

<a id="boxedoperatordefinition_evaluateasync-1" name="boxedoperatordefinition_evaluateasync-1"></a>

<MemberCard>

##### BoxedOperatorDefinition.evaluateAsync()?

```ts
optional evaluateAsync: (ops, options?) => Promise<BoxedExpression>;
```

</MemberCard>

<a id="boxedoperatordefinition_evaldimension" name="boxedoperatordefinition_evaldimension"></a>

<MemberCard>

##### BoxedOperatorDefinition.evalDimension()?

```ts
optional evalDimension: (ops, options) => BoxedExpression;
```

</MemberCard>

<a id="boxedoperatordefinition_compile-1" name="boxedoperatordefinition_compile-1"></a>

<MemberCard>

##### BoxedOperatorDefinition.compile()?

```ts
optional compile: (expr) => CompiledExpression;
```

</MemberCard>

<a id="scope" name="scope"></a>

<MemberCard>

### Scope

```ts
type Scope = {
  parent: Scope | null;
  bindings: Map<string, BoxedDefinition>;
  types: Record<string, TypeReference>;
};
```

A lexical scope is a table mapping symbols to their definitions. The
symbols are the names of the variables, unknowns and functions in the scope.

The lexical scope is used to resolve the metadata about symbols, such as
their type, whether they are constant, etc...

It does not resolve the values of the symbols, since those depend on the
evaluation context. For example, the local variables of a recursive function
will have the same lexical scope, but different values in each evaluation
context.

</MemberCard>

## Latex Parsing and Serialization

<a id="latextoken" name="latextoken"></a>

<MemberCard>

### LatexToken

```ts
type LatexToken = string | "<{>" | "<}>" | "<space>" | "<$>" | "<$$>";
```

A `LatexToken` is a token as returned by `Parser.peek`.

It can be one of the indicated tokens, or a string that starts with a
`` for LaTeX commands, or a LaTeX character which includes digits,
letters and punctuation.

</MemberCard>

<a id="latexstring" name="latexstring"></a>

<MemberCard>

### LatexString

```ts
type LatexString = string;
```

A LatexString is a regular string of LaTeX, for example:
`\frac{\pi}{2}`

</MemberCard>

<a id="delimiter" name="delimiter"></a>

<MemberCard>

### Delimiter

```ts
type Delimiter = 
  | "."
  | ")"
  | "("
  | "]"
  | "["
  | "{"
  | "}"
  | "<"
  | ">"
  | "|"
  | "||"
  | "\lceil"
  | "\rceil"
  | "\lfloor"
  | "\rfloor"
  | "\llbracket"
  | "\rrbracket";
```

Open and close delimiters that can be used with [`MatchfixEntry`](#matchfixentry)
record to define new LaTeX dictionary entries.

</MemberCard>

<a id="delimiterscale" name="delimiterscale"></a>

<MemberCard>

### DelimiterScale

```ts
type DelimiterScale = "normal" | "scaled" | "big" | "none";
```

</MemberCard>

<a id="librarycategory" name="librarycategory"></a>

<MemberCard>

### LibraryCategory

```ts
type LibraryCategory = 
  | "algebra"
  | "arithmetic"
  | "calculus"
  | "collections"
  | "control-structures"
  | "combinatorics"
  | "complex"
  | "core"
  | "data-structures"
  | "dimensions"
  | "domains"
  | "linear-algebra"
  | "logic"
  | "number-theory"
  | "numeric"
  | "other"
  | "physics"
  | "polynomials"
  | "relop"
  | "sets"
  | "statistics"
  | "styling"
  | "symbols"
  | "trigonometry"
  | "units";
```

</MemberCard>

<a id="precedence" name="precedence"></a>

<MemberCard>

### Precedence

```ts
type Precedence = number;
```

:::info[THEORY OF OPERATIONS]

The precedence of an operator is a number that indicates the order in which
operators are applied.

For example, in `1 + 2 * 3`, the `*` operator has a **higher** precedence
than the `+` operator, so it is applied first.

The precedence range from 0 to 1000. The larger the number, the higher the
precedence, the more "binding" the operator is.

Here are some rough ranges for the precedence:

- 800: prefix and postfix operators: `\lnot` etc...
   - `POSTFIX_PRECEDENCE` = 810: `!`, `'`
- 700: some arithmetic operators
   - `EXPONENTIATION_PRECEDENCE` = 700: `^`
- 600: some binary operators
   - `DIVISION_PRECEDENCE` = 600: `\div`
- 500: not used
- 400: not used
- 300: some logic and arithmetic operators:
       `\land`, `\lor`, `\times`, etc...
  - `MULTIPLICATION_PRECEDENCE` = 390: `\times`
- 200: arithmetic operators, inequalities:
  - `ADDITION_PRECEDENCE` = 275: `+` `-`
  - `ARROW_PRECEDENCE` = 270: `\to` `\rightarrow`
  - `ASSIGNMENT_PRECEDENCE` = 260: `:=`
  - `COMPARISON_PRECEDENCE` = 245: `\lt` `\gt`
  - 241: `\leq`
- 100: not used
- 0: `,`, `;`, etc...

Some constants are defined below for common precedence values.

**Note**: MathML defines
[some operator precedence](https://www.w3.org/TR/2009/WD-MathML3-20090924/appendixc.html),
but it has some issues and inconsistencies. However,
whenever possible we adopted the MathML precedence.

The JavaScript operator precedence is documented
[here](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence).

:::

</MemberCard>

<a id="terminator" name="terminator"></a>

<MemberCard>

### Terminator

```ts
type Terminator = {
  minPrec: Precedence;
  condition: (parser) => boolean;
};
```

This indicates a condition under which parsing should stop:
- an operator of a precedence higher than specified has been encountered
- the last token has been reached
- or if a condition is provided, the condition returns true

</MemberCard>

<a id="parsehandler" name="parsehandler"></a>

<MemberCard>

### ParseHandler

```ts
type ParseHandler = 
  | ExpressionParseHandler
  | SymbolParseHandler
  | FunctionParseHandler
  | EnvironmentParseHandler
  | PostfixParseHandler
  | InfixParseHandler
  | MatchfixParseHandler;
```

**Custom parsing handler.**

When this handler is invoked the parser points right after the LaTeX
fragment that triggered it.

Tokens can be consumed with `parser.nextToken()` and other parser methods
such as `parser.parseGroup()`, `parser.parseOptionalGroup()`, etc...

If it was in an infix or postfix context, `lhs` will represent the
left-hand side argument. In a prefix or matchfix context, `lhs` is `null`.

In a superfix (`^`) or subfix (`_`) context (that is if the first token of
the trigger is `^` or `_`), `lhs` is `["Superscript", lhs, rhs]`
and `["Subscript", lhs, rhs]`, respectively.

The handler should return `null` if the tokens could not be parsed
(didn't match the syntax that was expected), or the matching expression
otherwise.

If the tokens were parsed but should be ignored, the handler should
return `Nothing`.

</MemberCard>

<a id="expressionparsehandler" name="expressionparsehandler"></a>

<MemberCard>

### ExpressionParseHandler()

```ts
type ExpressionParseHandler = (parser, until?) => Expression | null;
```

</MemberCard>

<a id="prefixparsehandler" name="prefixparsehandler"></a>

<MemberCard>

### PrefixParseHandler()

```ts
type PrefixParseHandler = (parser, until?) => Expression | null;
```

</MemberCard>

<a id="symbolparsehandler" name="symbolparsehandler"></a>

<MemberCard>

### SymbolParseHandler()

```ts
type SymbolParseHandler = (parser, until?) => Expression | null;
```

</MemberCard>

<a id="functionparsehandler" name="functionparsehandler"></a>

<MemberCard>

### FunctionParseHandler()

```ts
type FunctionParseHandler = (parser, until?) => Expression | null;
```

</MemberCard>

<a id="environmentparsehandler" name="environmentparsehandler"></a>

<MemberCard>

### EnvironmentParseHandler()

```ts
type EnvironmentParseHandler = (parser, until?) => Expression | null;
```

</MemberCard>

<a id="postfixparsehandler" name="postfixparsehandler"></a>

<MemberCard>

### PostfixParseHandler()

```ts
type PostfixParseHandler = (parser, lhs, until?) => Expression | null;
```

</MemberCard>

<a id="infixparsehandler" name="infixparsehandler"></a>

<MemberCard>

### InfixParseHandler()

```ts
type InfixParseHandler = (parser, lhs, until) => Expression | null;
```

</MemberCard>

<a id="matchfixparsehandler" name="matchfixparsehandler"></a>

<MemberCard>

### MatchfixParseHandler()

```ts
type MatchfixParseHandler = (parser, body) => Expression | null;
```

</MemberCard>

<a id="latexargumenttype" name="latexargumenttype"></a>

<MemberCard>

### LatexArgumentType

```ts
type LatexArgumentType = 
  | "{expression}"
  | "[expression]"
  | "{text}"
  | "[text]"
  | "{unit}"
  | "[unit]"
  | "{glue}"
  | "[glue]"
  | "{string}"
  | "[string]"
  | "{color}"
  | "[color]";
```

</MemberCard>

<a id="trigger" name="trigger"></a>

<MemberCard>

### Trigger

```ts
type Trigger = {
  latexTrigger:   | LatexString
     | LatexToken[];
  symbolTrigger: MathJsonSymbol;
};
```

A trigger is the set of tokens that will make an entry in the
LaTeX dictionary eligible to parse the stream and generate an expression.
If the trigger matches, the `parse` handler is called, if available.

The trigger can be specified either as a LaTeX string (`latexTrigger`) or
as an symbol (`symbolTrigger`). A symbol match several
LaTeX expressions that are equivalent, for example `\operatorname{gcd}` or
 `\mathbin{gcd}`, match the `"gcd"` symbol

`matchfix` operators use `openTrigger` and `closeTrigger` instead.

</MemberCard>

<a id="baseentry" name="baseentry"></a>

<MemberCard>

### BaseEntry

```ts
type BaseEntry = {
  name: MathJsonSymbol;
  serialize:   | LatexString
     | SerializeHandler;
};
```

Maps a string of LaTeX tokens to a function or symbol and vice-versa.

<a id="baseentry_name-1" name="baseentry_name-1"></a>

#### BaseEntry.name?

```ts
optional name: MathJsonSymbol;
```

Map a MathJSON symbol to this entry.

Each entry should have at least a `name` or a `parse` handler.

An entry with no `name` cannot be serialized: the `name` is used to map
a MathJSON function or symbol name to the appropriate entry for
serializing.

However, an entry with no `name` can be used to define a synonym (for
example for the symbol `\varnothing` which is a synonym for `\emptyset`).

If no `parse` handler is provided, only the trigger is used to select this
entry. Otherwise, if the trigger of the entry matches the current
token, the `parse` handler is invoked.

<a id="baseentry_serialize-1" name="baseentry_serialize-1"></a>

#### BaseEntry.serialize?

```ts
optional serialize: 
  | LatexString
  | SerializeHandler;
```

Transform an expression into a LaTeX string.
If no `serialize` handler is provided, the trigger is used.

</MemberCard>

<a id="defaultentry" name="defaultentry"></a>

<MemberCard>

### DefaultEntry

```ts
type DefaultEntry = BaseEntry & Trigger & {
  parse:   | Expression
     | ExpressionParseHandler;
};
```

</MemberCard>

<a id="expressionentry" name="expressionentry"></a>

<MemberCard>

### ExpressionEntry

```ts
type ExpressionEntry = BaseEntry & Trigger & {
  kind: "expression";
  parse:   | Expression
     | ExpressionParseHandler;
  precedence: Precedence;
};
```

</MemberCard>

<a id="matchfixentry" name="matchfixentry"></a>

<MemberCard>

### MatchfixEntry

```ts
type MatchfixEntry = BaseEntry & {
  kind: "matchfix";
  openTrigger: Delimiter | LatexToken[];
  closeTrigger: Delimiter | LatexToken[];
  parse: MatchfixParseHandler;
};
```

#### MatchfixEntry.openTrigger

```ts
openTrigger: Delimiter | LatexToken[];
```

If `kind` is `'matchfix'`: the `openTrigger` and `closeTrigger`
properties are required.

#### MatchfixEntry.parse?

```ts
optional parse: MatchfixParseHandler;
```

When invoked, the parser is pointing after the close delimiter.
The argument of the handler is the body, i.e. the content between
the open delimiter and the close delimiter.

</MemberCard>

<a id="infixentry" name="infixentry"></a>

<MemberCard>

### InfixEntry

```ts
type InfixEntry = BaseEntry & Trigger & {
  kind: "infix";
  associativity: "right" | "left" | "none" | "any";
  precedence: Precedence;
  parse: string | InfixParseHandler;
};
```

#### InfixEntry.kind

```ts
kind: "infix";
```

Infix position, with an operand before and an operand after: `a ⊛ b`.

Example: `+`, `\times`.

#### InfixEntry.associativity?

```ts
optional associativity: "right" | "left" | "none" | "any";
```

- **`none`**: a ? b ? c -> syntax error
- **`any`**: a + b + c -> +(a, b, c)
- **`left`**: a / b / c -> /(/(a, b), c)
- **`right`**: a = b = c -> =(a, =(b, c))

- `any`-associative operators have an unlimited number of arguments
- `left`, `right` or `none` associative operators have two arguments

</MemberCard>

<a id="postfixentry" name="postfixentry"></a>

<MemberCard>

### PostfixEntry

```ts
type PostfixEntry = BaseEntry & Trigger & {
  kind: "postfix";
  precedence: Precedence;
  parse: string | PostfixParseHandler;
};
```

#### PostfixEntry.kind

```ts
kind: "postfix";
```

Postfix position, with an operand before: `a ⊛`

Example: `!`.

</MemberCard>

<a id="prefixentry" name="prefixentry"></a>

<MemberCard>

### PrefixEntry

```ts
type PrefixEntry = BaseEntry & Trigger & {
  kind: "prefix";
  precedence: Precedence;
  parse: string | PrefixParseHandler;
};
```

#### PrefixEntry.kind

```ts
kind: "prefix";
```

Prefix position, with an operand after: `⊛ a`

Example: `-`, `\not`.

</MemberCard>

<a id="environmententry" name="environmententry"></a>

<MemberCard>

### EnvironmentEntry

```ts
type EnvironmentEntry = BaseEntry & {
  kind: "environment";
  parse: EnvironmentParseHandler;
  symbolTrigger: MathJsonSymbol;
};
```

A LaTeX dictionary entry for an environment, that is a LaTeX
construct using `\begin{...}...\end{...}`.

</MemberCard>

<a id="symbolentry" name="symbolentry"></a>

<MemberCard>

### SymbolEntry

```ts
type SymbolEntry = BaseEntry & Trigger & {
  kind: "symbol";
  precedence: Precedence;
  parse:   | Expression
     | SymbolParseHandler;
};
```

#### SymbolEntry.precedence?

```ts
optional precedence: Precedence;
```

Used for appropriate wrapping (i.e. when to surround it with parens)

</MemberCard>

<a id="functionentry" name="functionentry"></a>

<MemberCard>

### FunctionEntry

```ts
type FunctionEntry = BaseEntry & Trigger & {
  kind: "function";
  parse:   | Expression
     | FunctionParseHandler;
};
```

A function is a symbol followed by:
- some postfix operators such as `\prime`
- an optional list of arguments in an enclosure (parentheses)

For more complex situations, for example implicit arguments or
inverse functions postfix (i.e. ^{-1}), use a custom parse handler with a
entry of kind `expression`.

</MemberCard>

<a id="latexdictionaryentry" name="latexdictionaryentry"></a>

<MemberCard>

### LatexDictionaryEntry

```ts
type LatexDictionaryEntry = OneOf<[
  | ExpressionEntry
  | MatchfixEntry
  | InfixEntry
  | PostfixEntry
  | PrefixEntry
  | SymbolEntry
  | FunctionEntry
  | EnvironmentEntry
| DefaultEntry]>;
```

A dictionary entry is a record that maps a LaTeX token or string of tokens
( a trigger) to a MathJSON expression or to a parsing handler.

Set the ComputeEngine.latexDictionary property to an array of
dictionary entries to define custom LaTeX parsing and serialization.

</MemberCard>

<a id="parselatexoptions" name="parselatexoptions"></a>

<MemberCard>

### ParseLatexOptions

```ts
type ParseLatexOptions = NumberFormat & {
  skipSpace: boolean;
  parseNumbers: "auto" | "rational" | "decimal" | "never";
  getSymbolType: (symbol) => BoxedType;
  parseUnexpectedToken: (lhs, parser) => Expression | null;
  preserveLatex: boolean;
};
```

The LaTeX parsing options can be used with the `ce.parse()` method.

#### ParseLatexOptions.skipSpace

```ts
skipSpace: boolean;
```

If true, ignore space characters in math mode.

**Default**: `true`

#### ParseLatexOptions.parseNumbers

```ts
parseNumbers: "auto" | "rational" | "decimal" | "never";
```

When parsing a decimal number, e.g. `3.1415`:

- `"auto"` or `"decimal"`: if a decimal number, parse it as an approximate
  decimal number with a whole part and a fractional part
- `"rational"`: if a decimal number, parse it as an exact rational number
  with a numerator  and a denominator. If not a decimal number, parse
  it as a regular number.
- `"never"`: do not parse numbers, instead return each token making up
 the number (minus sign, digits, decimal marker, etc...).

Note: if the number includes repeating digits (e.g. `1.33(333)`),
it will be parsed as a decimal number even if this setting is `"rational"`.

**Default**: `"auto"`

#### ParseLatexOptions.getSymbolType()

```ts
getSymbolType: (symbol) => BoxedType;
```

This handler is invoked when the parser encounters a
that has not yet been declared.

The `symbol` argument is a [valid symbol](#symbols).

#### ParseLatexOptions.parseUnexpectedToken()

```ts
parseUnexpectedToken: (lhs, parser) => Expression | null;
```

This handler is invoked when the parser encounters an unexpected token.

The `lhs` argument is the left-hand side of the token, if any.

The handler can access the unexpected token with `parser.peek`. If
it is a token that should be recognized, the handler can consume it
by calling `parser.nextToken()`.

The handler should return an expression or `null` if the token is not
recognized.

#### ParseLatexOptions.preserveLatex

```ts
preserveLatex: boolean;
```

If true, the expression will be decorated with the LaTeX
fragments corresponding to each elements of the expression.

The top-level expression, that is the one returned by `parse()`, will
include the verbatim LaTeX input that was parsed. The sub-expressions
may contain a slightly different LaTeX, for example with consecutive spaces
replaced by one, with comments removed and with some low-level LaTeX
commands replaced, for example `\egroup` and `\bgroup`.

**Default:** `false`

</MemberCard>

<a id="parser" name="parser"></a>

### Parser

An instance of `Parser` is provided to the `parse` handlers of custom
LaTeX dictionary entries.

<a id="parser_options" name="parser_options"></a>

<MemberCard>

##### Parser.options

```ts
readonly options: Required<ParseLatexOptions>;
```

</MemberCard>

<a id="parser_index" name="parser_index"></a>

<MemberCard>

##### Parser.index

```ts
index: number;
```

The index of the current token

</MemberCard>

<a id="parser_atend" name="parser_atend"></a>

<MemberCard>

##### Parser.atEnd

```ts
readonly atEnd: boolean;
```

True if the last token has been reached.
Consider also `atTerminator()`.

</MemberCard>

<a id="parser_peek" name="parser_peek"></a>

<MemberCard>

##### Parser.peek

```ts
readonly peek: string;
```

Return the next token, without advancing the index

</MemberCard>

<a id="parser_atboundary" name="parser_atboundary"></a>

<MemberCard>

##### Parser.atBoundary

</MemberCard>

<a id="parser_getsymboltype" name="parser_getsymboltype"></a>

<MemberCard>

##### Parser.getSymbolType()

```ts
getSymbolType(id): BoxedType
```

####### id

`string`

</MemberCard>

<a id="parser_pushsymboltable" name="parser_pushsymboltable"></a>

<MemberCard>

##### Parser.pushSymbolTable()

```ts
pushSymbolTable(): void
```

</MemberCard>

<a id="parser_popsymboltable" name="parser_popsymboltable"></a>

<MemberCard>

##### Parser.popSymbolTable()

```ts
popSymbolTable(): void
```

</MemberCard>

<a id="parser_addsymbol" name="parser_addsymbol"></a>

<MemberCard>

##### Parser.addSymbol()

```ts
addSymbol(id, type): void
```

####### id

`string`

####### type

`string` | [`BoxedType`](#boxedtype)

</MemberCard>

<a id="parser_atterminator" name="parser_atterminator"></a>

<MemberCard>

##### Parser.atTerminator()

```ts
atTerminator(t): boolean
```

Return true if the terminator condition is met or if the last token
has been reached.

####### t

[`Terminator`](#terminator)

</MemberCard>

<a id="parser_nexttoken" name="parser_nexttoken"></a>

<MemberCard>

##### Parser.nextToken()

```ts
nextToken(): string
```

Return the next token and advance the index

</MemberCard>

<a id="parser_latex-1" name="parser_latex-1"></a>

<MemberCard>

##### Parser.latex()

```ts
latex(start, end?): string
```

Return a string representation of the expression
between `start` and `end` (default: the whole expression)

####### start

`number`

####### end?

`number`

</MemberCard>

<a id="parser_error" name="parser_error"></a>

<MemberCard>

##### Parser.error()

```ts
error(code, fromToken): Expression
```

Return an error expression with the specified code and arguments

####### code

`string` | \[`string`, `...Expression[]`\]

####### fromToken

`number`

</MemberCard>

<a id="parser_skipspace" name="parser_skipspace"></a>

<MemberCard>

##### Parser.skipSpace()

```ts
skipSpace(): boolean
```

If there are any space, advance the index until a non-space is encountered

</MemberCard>

<a id="parser_skipvisualspace" name="parser_skipvisualspace"></a>

<MemberCard>

##### Parser.skipVisualSpace()

```ts
skipVisualSpace(): void
```

Skip over "visual space" which
includes space tokens, empty groups `{}`, and commands such as `\,` and `\!`

</MemberCard>

<a id="parser_match-1" name="parser_match-1"></a>

<MemberCard>

##### Parser.match()

```ts
match(token): boolean
```

If the next token matches the target advance and return true. Otherwise
return false

####### token

`string`

</MemberCard>

<a id="parser_matchall" name="parser_matchall"></a>

<MemberCard>

##### Parser.matchAll()

```ts
matchAll(tokens): boolean
```

Return true if the next tokens match the argument, an array of tokens, or null otherwise

####### tokens

`string`[]

</MemberCard>

<a id="parser_matchany" name="parser_matchany"></a>

<MemberCard>

##### Parser.matchAny()

```ts
matchAny(tokens): string
```

Return the next token if it matches any of the token in the argument or null otherwise

####### tokens

`string`[]

</MemberCard>

<a id="parser_parsechar" name="parser_parsechar"></a>

<MemberCard>

##### Parser.parseChar()

```ts
parseChar(): string
```

If the next token is a character, return it and advance the index
This includes plain characters (e.g. 'a', '+'...), characters
defined in hex (^^ and ^^^^), the `\char` and `\unicode` command.

</MemberCard>

<a id="parser_parsegroup" name="parser_parsegroup"></a>

<MemberCard>

##### Parser.parseGroup()

```ts
parseGroup(): Expression
```

Parse an expression in a LaTeX group enclosed in curly brackets `{}`.
These are often used as arguments to LaTeX commands, for example
`\frac{1}{2}`.

Return `null` if none was found
Return `Nothing` if an empty group `{}` was found

</MemberCard>

<a id="parser_parsetoken" name="parser_parsetoken"></a>

<MemberCard>

##### Parser.parseToken()

```ts
parseToken(): Expression
```

Some LaTeX commands (but not all) can accept arguments as single
tokens (i.e. without braces), for example `^2`, `\sqrt3` or `\frac12`

This argument will usually be a single token, but can be a sequence of
tokens (e.g. `\sqrt\frac12` or `\sqrt\operatorname{speed}`).

The following tokens are excluded from consideration in order to fail
early when encountering a likely syntax error, for example `x^(2)`
instead of `x^{2}`. With `(` in the list of excluded tokens, the
match will fail and the error can be recovered.

The excluded tokens include `!"#$%&(),/;:?@[]`|~", `\left`, `\bigl`, etc...

</MemberCard>

<a id="parser_parseoptionalgroup" name="parser_parseoptionalgroup"></a>

<MemberCard>

##### Parser.parseOptionalGroup()

```ts
parseOptionalGroup(): Expression
```

Parse an expression enclosed in a LaTeX optional group enclosed in square brackets `[]`.

Return `null` if none was found.

</MemberCard>

<a id="parser_parseenclosure" name="parser_parseenclosure"></a>

<MemberCard>

##### Parser.parseEnclosure()

```ts
parseEnclosure(): Expression
```

Parse an enclosure (open paren/close paren, etc..) and return the expression inside the enclosure

</MemberCard>

<a id="parser_parsestringgroup" name="parser_parsestringgroup"></a>

<MemberCard>

##### Parser.parseStringGroup()

```ts
parseStringGroup(optional?): string
```

Some LaTeX commands have arguments that are not interpreted as
expressions, but as strings. For example, `\begin{array}{ccc}` (both
`array` and `ccc` are strings), `\color{red}` or `\operatorname{lim sup}`.

If the next token is the start of a group (`{`), return the content
of the group as a string. This may include white space, and it may need
to be trimmed at the start and end of the string.

LaTeX commands are typically not allowed inside a string group (for example,
`\alpha` would result in an error), but we do not enforce this.

If `optional` is true, this should be an optional group in square brackets
otherwise it is a regular group in braces.

####### optional?

`boolean`

</MemberCard>

<a id="parser_parsesymbol" name="parser_parsesymbol"></a>

<MemberCard>

##### Parser.parseSymbol()

```ts
parseSymbol(until?): Expression
```

A symbol can be:
- a single-letter symbol: `x`
- a single LaTeX command: `\pi`
- a multi-letter symbol: `\operatorname{speed}`

####### until?

`Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<a id="parser_parsetabular" name="parser_parsetabular"></a>

<MemberCard>

##### Parser.parseTabular()

```ts
parseTabular(): Expression[][]
```

Parse an expression in a tabular format, where rows are separated by `\\`
and columns by `&`.

Return rows of sparse columns: empty rows are indicated with `Nothing`,
and empty cells are also indicated with `Nothing`.

</MemberCard>

<a id="parser_parsearguments" name="parser_parsearguments"></a>

<MemberCard>

##### Parser.parseArguments()

```ts
parseArguments(kind?, until?): readonly Expression[]
```

Parse an argument list, for example: `(12, x+1)` or `\left(x\right)`

- 'enclosure' : will look for arguments inside an enclosure
   (an open/close fence) (**default**)
- 'implicit': either an expression inside a pair of `()`, or just a primary
   (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)

Return an array of expressions, one for each argument, or `null` if no
argument was found.

####### kind?

`"implicit"` | `"enclosure"`

####### until?

[`Terminator`](#terminator)

</MemberCard>

<a id="parser_parsepostfixoperator" name="parser_parsepostfixoperator"></a>

<MemberCard>

##### Parser.parsePostfixOperator()

```ts
parsePostfixOperator(lhs, until?): Expression
```

Parse a postfix operator, such as `'` or `!`.

Prefix, infix and matchfix operators are handled by `parseExpression()`

####### lhs

[`Expression`](#expression)

####### until?

`Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<a id="parser_parseexpression" name="parser_parseexpression"></a>

<MemberCard>

##### Parser.parseExpression()

```ts
parseExpression(until?): Expression
```

Parse an expression:

```
<expression> ::=
 | <primary> ( <infix-op> <expression> )?
 | <prefix-op> <expression>

<primary> :=
  (<number> | <symbol> | <function-call> | <matchfix-expr>)
  (<subsup> | <postfix-operator>)*

<matchfix-expr> :=
  <matchfix-op-open> <expression> <matchfix-op-close>

<function-call> ::=
  | <function><matchfix-op-group-open><expression>[',' <expression>]<matchfix-op-group-close>
```

This is the top-level parsing entry point.

Stop when an operator of precedence less than `until.minPrec`
or the sequence of tokens `until.tokens` is encountered

`until` is `{ minPrec:0 }` by default.

####### until?

`Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<a id="parser_parsenumber" name="parser_parsenumber"></a>

<MemberCard>

##### Parser.parseNumber()

```ts
parseNumber(): Expression
```

Parse a number.

</MemberCard>

<a id="parser_addboundary" name="parser_addboundary"></a>

<MemberCard>

##### Parser.addBoundary()

```ts
addBoundary(boundary): void
```

Boundaries are used to detect the end of an expression.

They are used for unusual syntactic constructs, for example
`\int \sin x dx` where the `dx` is not an argument to the `\sin`
function, but a boundary of the integral.

They are also useful when handling syntax errors and recovery.

For example, `\begin{bmatrix} 1 & 2 { \end{bmatrix}` has an
extraneous `{`, but the parser will attempt to recover and continue
parsing when it encounters the `\end{bmatrix}` boundary.

####### boundary

`string`[]

</MemberCard>

<a id="parser_removeboundary" name="parser_removeboundary"></a>

<MemberCard>

##### Parser.removeBoundary()

```ts
removeBoundary(): void
```

</MemberCard>

<a id="parser_matchboundary" name="parser_matchboundary"></a>

<MemberCard>

##### Parser.matchBoundary()

```ts
matchBoundary(): boolean
```

</MemberCard>

<a id="parser_boundaryerror" name="parser_boundaryerror"></a>

<MemberCard>

##### Parser.boundaryError()

```ts
boundaryError(msg): Expression
```

####### msg

`string` | \[`string`, `...Expression[]`\]

</MemberCard>

<a id="serializelatexoptions" name="serializelatexoptions"></a>

<MemberCard>

### SerializeLatexOptions

```ts
type SerializeLatexOptions = NumberSerializationFormat & {
  prettify: boolean;
  materialization: boolean | number | [number, number];
  invisibleMultiply: LatexString;
  invisiblePlus: LatexString;
  multiply: LatexString;
  missingSymbol: LatexString;
  applyFunctionStyle: (expr, level) => DelimiterScale;
  groupStyle: (expr, level) => DelimiterScale;
  rootStyle: (expr, level) => "radical" | "quotient" | "solidus";
  fractionStyle: (expr, level) => 
     | "quotient"
     | "block-quotient"
     | "inline-quotient"
     | "inline-solidus"
     | "nice-solidus"
     | "reciprocal"
     | "factor";
  logicStyle: (expr, level) => "word" | "boolean" | "uppercase-word" | "punctuation";
  powerStyle: (expr, level) => "root" | "solidus" | "quotient";
  numericSetStyle: (expr, level) => "compact" | "regular" | "interval" | "set-builder";
};
```

The LaTeX serialization options can used with the `expr.toLatex()` method.

#### SerializeLatexOptions.prettify

```ts
prettify: boolean;
```

If true, prettify the LaTeX output.

For example, render `\frac{a}{b}\frac{c}{d}` as `\frac{ac}{bd}`

#### SerializeLatexOptions.materialization

```ts
materialization: boolean | number | [number, number];
```

Controls the materialization of the lazy collections.

- If `true`, lazy collections are materialized, i.e. it is rendered as a
  LaTeX expression with all its elements.
- If `false`, the expression is not materialized, i.e. it is
  rendered as a LaTeX command with its arguments.
- If a number is provided, it is the maximum number of elements
  that will be materialized.
- If a pair of numbers is provided, it is the number of elements
  of the head and the tail that will be materialized, respectively.

#### SerializeLatexOptions.invisibleMultiply

```ts
invisibleMultiply: LatexString;
```

LaTeX string used to render an invisible multiply, e.g. in '2x'.

If empty, both operands are concatenated, i.e. `2x`.

Use `\cdot` to insert a `\cdot` operator between them, i.e. `2 \cdot x`.

Empty by default.

#### SerializeLatexOptions.invisiblePlus

```ts
invisiblePlus: LatexString;
```

LaTeX string used to render [mixed numbers](https://en.wikipedia.org/wiki/Fraction#Mixed_numbers) e.g. '1 3/4'.

Leave it empty to join the main number and the fraction, i.e. render it
as `1\frac{3}{4}`.

Use `+` to insert an explicit `+` operator between them,
 i.e. `1+\frac{3}{4}`

Empty by default.

#### SerializeLatexOptions.multiply

```ts
multiply: LatexString;
```

LaTeX string used to render an explicit multiply operator.

For example, `\times`, `\cdot`, etc...

Default: `\times`

#### SerializeLatexOptions.missingSymbol

```ts
missingSymbol: LatexString;
```

Serialize the expression `["Error", "'missing'"]`,  with this LaTeX string

</MemberCard>

<a id="serializer" name="serializer"></a>

### Serializer

An instance of `Serializer` is provided to the `serialize` handlers of custom
LaTeX dictionary entries.

<a id="serializer_options-1" name="serializer_options-1"></a>

<MemberCard>

##### Serializer.options

```ts
readonly options: Required<SerializeLatexOptions>;
```

</MemberCard>

<a id="serializer_dictionary-1" name="serializer_dictionary-1"></a>

<MemberCard>

##### Serializer.dictionary

```ts
readonly dictionary: IndexedLatexDictionary;
```

</MemberCard>

<a id="serializer_level" name="serializer_level"></a>

<MemberCard>

##### Serializer.level

```ts
level: number;
```

"depth" of the expression:
- 0 for the root
- 1 for a subexpression of the root
- 2 for subexpressions of the subexpressions of the root
- etc...

This allows the serialized LaTeX to vary depending on the depth of the
expression.

For example use `\Bigl(` for the top level, and `\bigl(` or `(` for others.

</MemberCard>

<a id="serializer_serialize" name="serializer_serialize"></a>

<MemberCard>

##### Serializer.serialize()

```ts
serialize: (expr) => string;
```

Output a LaTeX string representing the expression

</MemberCard>

<a id="serializer_wrap" name="serializer_wrap"></a>

<MemberCard>

##### Serializer.wrap()

```ts
wrap: (expr, prec?) => string;
```

Add a group fence around the expression if it is
an operator of precedence less than or equal to `prec`.

</MemberCard>

<a id="serializer_applyfunctionstyle" name="serializer_applyfunctionstyle"></a>

<MemberCard>

##### Serializer.applyFunctionStyle()

```ts
applyFunctionStyle: (expr, level) => DelimiterScale;
```

Styles

</MemberCard>

<a id="serializer_groupstyle" name="serializer_groupstyle"></a>

<MemberCard>

##### Serializer.groupStyle()

```ts
groupStyle: (expr, level) => DelimiterScale;
```

</MemberCard>

<a id="serializer_rootstyle" name="serializer_rootstyle"></a>

<MemberCard>

##### Serializer.rootStyle()

```ts
rootStyle: (expr, level) => "radical" | "quotient" | "solidus";
```

</MemberCard>

<a id="serializer_fractionstyle" name="serializer_fractionstyle"></a>

<MemberCard>

##### Serializer.fractionStyle()

```ts
fractionStyle: (expr, level) => 
  | "quotient"
  | "block-quotient"
  | "inline-quotient"
  | "inline-solidus"
  | "nice-solidus"
  | "reciprocal"
  | "factor";
```

</MemberCard>

<a id="serializer_logicstyle" name="serializer_logicstyle"></a>

<MemberCard>

##### Serializer.logicStyle()

```ts
logicStyle: (expr, level) => "boolean" | "word" | "uppercase-word" | "punctuation";
```

</MemberCard>

<a id="serializer_powerstyle" name="serializer_powerstyle"></a>

<MemberCard>

##### Serializer.powerStyle()

```ts
powerStyle: (expr, level) => "quotient" | "solidus" | "root";
```

</MemberCard>

<a id="serializer_numericsetstyle" name="serializer_numericsetstyle"></a>

<MemberCard>

##### Serializer.numericSetStyle()

```ts
numericSetStyle: (expr, level) => "interval" | "compact" | "regular" | "set-builder";
```

</MemberCard>

<a id="serializer_serializefunction" name="serializer_serializefunction"></a>

<MemberCard>

##### Serializer.serializeFunction()

```ts
serializeFunction(expr, def?): string
```

####### expr

[`Expression`](#expression)

####### def?

`IndexedLatexDictionaryEntry`

</MemberCard>

<a id="serializer_serializesymbol" name="serializer_serializesymbol"></a>

<MemberCard>

##### Serializer.serializeSymbol()

```ts
serializeSymbol(expr): string
```

####### expr

[`Expression`](#expression)

</MemberCard>

<a id="serializer_wrapstring" name="serializer_wrapstring"></a>

<MemberCard>

##### Serializer.wrapString()

```ts
wrapString(s, style, delimiters?): string
```

Output `s` surrounded by delimiters.

If `delimiters` is not specified, use `()`

####### s

`string`

####### style

[`DelimiterScale`](#delimiterscale)

####### delimiters?

`string`

</MemberCard>

<a id="serializer_wraparguments" name="serializer_wraparguments"></a>

<MemberCard>

##### Serializer.wrapArguments()

```ts
wrapArguments(expr): string
```

A string with the arguments of expr fenced appropriately and separated by
commas.

####### expr

[`Expression`](#expression)

</MemberCard>

<a id="serializer_wrapshort" name="serializer_wrapshort"></a>

<MemberCard>

##### Serializer.wrapShort()

```ts
wrapShort(expr): string
```

Add a group fence around the expression if it is
short (not a function)

####### expr

[`Expression`](#expression)

</MemberCard>

<a id="serializehandler" name="serializehandler"></a>

<MemberCard>

### SerializeHandler()

```ts
type SerializeHandler = (serializer, expr) => string;
```

The `serialize` handler of a custom LaTeX dictionary entry can be
a function of this type.

</MemberCard>

## Numerics

<a id="sign" name="sign"></a>

<MemberCard>

### Sign

```ts
type Sign = 
  | "zero"
  | "positive"
  | "negative"
  | "non-negative"
  | "non-positive"
  | "not-zero"
  | "unsigned";
```

</MemberCard>

<a id="exactnumericvaluedata" name="exactnumericvaluedata"></a>

<MemberCard>

### ExactNumericValueData

```ts
type ExactNumericValueData = {
  rational: Rational;
  radical: number;
};
```

The value is equal to `(decimal * rational * sqrt(radical)) + im * i`

</MemberCard>

<a id="numericvaluedata" name="numericvaluedata"></a>

<MemberCard>

### NumericValueData

```ts
type NumericValueData = {
  re: Decimal | number;
  im: number;
};
```

</MemberCard>

<a id="numericvaluefactory" name="numericvaluefactory"></a>

<MemberCard>

### NumericValueFactory()

```ts
type NumericValueFactory = (data) => NumericValue;
```

</MemberCard>

<a id="numericvalue" name="numericvalue"></a>

### `abstract` NumericValue

<MemberCard>

##### new NumericValue()

```ts
new NumericValue(): NumericValue
```

</MemberCard>

<a id="numericvalue_im" name="numericvalue_im"></a>

<MemberCard>

##### NumericValue.im

```ts
im: number;
```

The imaginary part of this numeric value.

Can be negative, zero or positive.

</MemberCard>

<a id="numericvalue_type-1" name="numericvalue_type-1"></a>

<MemberCard>

##### NumericValue.type

</MemberCard>

<a id="numericvalue_isexact" name="numericvalue_isexact"></a>

<MemberCard>

##### NumericValue.isExact

True if numeric value is the product of a rational and the square root of an integer.

This includes: 3/4√5, -2, √2, etc...

But it doesn't include 0.5, 3.141592, etc...

</MemberCard>

<a id="numericvalue_asexact" name="numericvalue_asexact"></a>

<MemberCard>

##### NumericValue.asExact

If `isExact()`, returns an ExactNumericValue, otherwise returns undefined.

</MemberCard>

<a id="numericvalue_re" name="numericvalue_re"></a>

<MemberCard>

##### NumericValue.re

The real part of this numeric value.

Can be negative, 0 or positive.

</MemberCard>

<a id="numericvalue_bignumre" name="numericvalue_bignumre"></a>

<MemberCard>

##### NumericValue.bignumRe

bignum version of .re, if available

</MemberCard>

<a id="numericvalue_bignumim" name="numericvalue_bignumim"></a>

<MemberCard>

##### NumericValue.bignumIm

</MemberCard>

<a id="numericvalue_numerator" name="numericvalue_numerator"></a>

<MemberCard>

##### NumericValue.numerator

</MemberCard>

<a id="numericvalue_denominator" name="numericvalue_denominator"></a>

<MemberCard>

##### NumericValue.denominator

</MemberCard>

<a id="numericvalue_isnan" name="numericvalue_isnan"></a>

<MemberCard>

##### NumericValue.isNaN

</MemberCard>

<a id="numericvalue_ispositiveinfinity" name="numericvalue_ispositiveinfinity"></a>

<MemberCard>

##### NumericValue.isPositiveInfinity

</MemberCard>

<a id="numericvalue_isnegativeinfinity" name="numericvalue_isnegativeinfinity"></a>

<MemberCard>

##### NumericValue.isNegativeInfinity

</MemberCard>

<a id="numericvalue_iscomplexinfinity" name="numericvalue_iscomplexinfinity"></a>

<MemberCard>

##### NumericValue.isComplexInfinity

</MemberCard>

<a id="numericvalue_iszero" name="numericvalue_iszero"></a>

<MemberCard>

##### NumericValue.isZero

</MemberCard>

<a id="numericvalue_isone" name="numericvalue_isone"></a>

<MemberCard>

##### NumericValue.isOne

</MemberCard>

<a id="numericvalue_isnegativeone" name="numericvalue_isnegativeone"></a>

<MemberCard>

##### NumericValue.isNegativeOne

</MemberCard>

<a id="numericvalue_iszerowithtolerance" name="numericvalue_iszerowithtolerance"></a>

<MemberCard>

##### NumericValue.isZeroWithTolerance()

```ts
isZeroWithTolerance(_tolerance): boolean
```

####### \_tolerance

`number` | `Decimal`

</MemberCard>

<a id="numericvalue_sgn" name="numericvalue_sgn"></a>

<MemberCard>

##### NumericValue.sgn()

```ts
abstract sgn(): -1 | 0 | 1
```

The sign of complex numbers is undefined

</MemberCard>

<a id="numericvalue_n" name="numericvalue_n"></a>

<MemberCard>

##### NumericValue.N()

```ts
abstract N(): NumericValue
```

Return a non-exact representation of the numeric value

</MemberCard>

<a id="numericvalue_neg" name="numericvalue_neg"></a>

<MemberCard>

##### NumericValue.neg()

```ts
abstract neg(): NumericValue
```

</MemberCard>

<a id="numericvalue_inv" name="numericvalue_inv"></a>

<MemberCard>

##### NumericValue.inv()

```ts
abstract inv(): NumericValue
```

</MemberCard>

<a id="numericvalue_add" name="numericvalue_add"></a>

<MemberCard>

##### NumericValue.add()

```ts
abstract add(other): NumericValue
```

####### other

`number` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_sub" name="numericvalue_sub"></a>

<MemberCard>

##### NumericValue.sub()

```ts
abstract sub(other): NumericValue
```

####### other

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_mul" name="numericvalue_mul"></a>

<MemberCard>

##### NumericValue.mul()

```ts
abstract mul(other): NumericValue
```

####### other

`number` | `Decimal` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_div" name="numericvalue_div"></a>

<MemberCard>

##### NumericValue.div()

```ts
abstract div(other): NumericValue
```

####### other

`number` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_pow" name="numericvalue_pow"></a>

<MemberCard>

##### NumericValue.pow()

```ts
abstract pow(n): NumericValue
```

####### n

`number` | [`NumericValue`](#numericvalue) | \{
`re`: `number`;
`im`: `number`;
\}

</MemberCard>

<a id="numericvalue_root" name="numericvalue_root"></a>

<MemberCard>

##### NumericValue.root()

```ts
abstract root(n): NumericValue
```

####### n

`number`

</MemberCard>

<a id="numericvalue_sqrt" name="numericvalue_sqrt"></a>

<MemberCard>

##### NumericValue.sqrt()

```ts
abstract sqrt(): NumericValue
```

</MemberCard>

<a id="numericvalue_gcd" name="numericvalue_gcd"></a>

<MemberCard>

##### NumericValue.gcd()

```ts
abstract gcd(other): NumericValue
```

####### other

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_abs" name="numericvalue_abs"></a>

<MemberCard>

##### NumericValue.abs()

```ts
abstract abs(): NumericValue
```

</MemberCard>

<a id="numericvalue_ln" name="numericvalue_ln"></a>

<MemberCard>

##### NumericValue.ln()

```ts
abstract ln(base?): NumericValue
```

####### base?

`number`

</MemberCard>

<a id="numericvalue_exp" name="numericvalue_exp"></a>

<MemberCard>

##### NumericValue.exp()

```ts
abstract exp(): NumericValue
```

</MemberCard>

<a id="numericvalue_floor" name="numericvalue_floor"></a>

<MemberCard>

##### NumericValue.floor()

```ts
abstract floor(): NumericValue
```

</MemberCard>

<a id="numericvalue_ceil" name="numericvalue_ceil"></a>

<MemberCard>

##### NumericValue.ceil()

```ts
abstract ceil(): NumericValue
```

</MemberCard>

<a id="numericvalue_round" name="numericvalue_round"></a>

<MemberCard>

##### NumericValue.round()

```ts
abstract round(): NumericValue
```

</MemberCard>

<a id="numericvalue_eq" name="numericvalue_eq"></a>

<MemberCard>

##### NumericValue.eq()

```ts
abstract eq(other): boolean
```

####### other

`number` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_lt" name="numericvalue_lt"></a>

<MemberCard>

##### NumericValue.lt()

```ts
abstract lt(other): boolean
```

####### other

`number` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_lte" name="numericvalue_lte"></a>

<MemberCard>

##### NumericValue.lte()

```ts
abstract lte(other): boolean
```

####### other

`number` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_gt" name="numericvalue_gt"></a>

<MemberCard>

##### NumericValue.gt()

```ts
abstract gt(other): boolean
```

####### other

`number` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_gte" name="numericvalue_gte"></a>

<MemberCard>

##### NumericValue.gte()

```ts
abstract gte(other): boolean
```

####### other

`number` | [`NumericValue`](#numericvalue)

</MemberCard>

<a id="numericvalue_valueof-1" name="numericvalue_valueof-1"></a>

<MemberCard>

##### NumericValue.valueOf()

```ts
valueOf(): string | number
```

Object.valueOf(): returns a primitive value, preferably a JavaScript
 number over a string, even if at the expense of precision

</MemberCard>

<a id="numericvalue_toprimitive-1" name="numericvalue_toprimitive-1"></a>

<MemberCard>

##### NumericValue.\[toPrimitive\]()

```ts
toPrimitive: string | number
```

Object.toPrimitive()

####### hint

`"string"` | `"number"` | `"default"`

</MemberCard>

<a id="numericvalue_tojson-1" name="numericvalue_tojson-1"></a>

<MemberCard>

##### NumericValue.toJSON()

```ts
toJSON(): any
```

Object.toJSON

</MemberCard>

<a id="numericvalue_print" name="numericvalue_print"></a>

<MemberCard>

##### NumericValue.print()

```ts
print(): void
```

</MemberCard>

<a id="smallinteger" name="smallinteger"></a>

<MemberCard>

### SmallInteger

```ts
type SmallInteger = IsInteger<number>;
```

A `SmallInteger` is an integer < 1e6

</MemberCard>

<a id="rational-1" name="rational-1"></a>

<MemberCard>

### Rational

```ts
type Rational = 
  | [SmallInteger, SmallInteger]
  | [bigint, bigint];
```

A rational number is a number that can be expressed as the quotient or fraction p/q of two integers,
a numerator p and a non-zero denominator q.

A rational can either be represented as a pair of small integers or
a pair of big integers.

</MemberCard>

<a id="bignum-1" name="bignum-1"></a>

<MemberCard>

### BigNum

```ts
type BigNum = Decimal;
```

</MemberCard>

<a id="ibignum" name="ibignum"></a>

### IBigNum

<a id="ibignum__bignum_nan" name="ibignum__bignum_nan"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_NAN

```ts
readonly _BIGNUM_NAN: Decimal;
```

</MemberCard>

<a id="ibignum__bignum_zero" name="ibignum__bignum_zero"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_ZERO

```ts
readonly _BIGNUM_ZERO: Decimal;
```

</MemberCard>

<a id="ibignum__bignum_one" name="ibignum__bignum_one"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_ONE

```ts
readonly _BIGNUM_ONE: Decimal;
```

</MemberCard>

<a id="ibignum__bignum_two" name="ibignum__bignum_two"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_TWO

```ts
readonly _BIGNUM_TWO: Decimal;
```

</MemberCard>

<a id="ibignum__bignum_half" name="ibignum__bignum_half"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_HALF

```ts
readonly _BIGNUM_HALF: Decimal;
```

</MemberCard>

<a id="ibignum__bignum_pi" name="ibignum__bignum_pi"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_PI

```ts
readonly _BIGNUM_PI: Decimal;
```

</MemberCard>

<a id="ibignum__bignum_negative_one" name="ibignum__bignum_negative_one"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_NEGATIVE\_ONE

```ts
readonly _BIGNUM_NEGATIVE_ONE: Decimal;
```

</MemberCard>

<a id="ibignum_bignum" name="ibignum_bignum"></a>

<MemberCard>

##### IBigNum.bignum()

```ts
bignum(value): Decimal
```

####### value

`string` | `number` | `bigint` | `Decimal`

</MemberCard>

## Other

<a id="dictionaryinterface" name="dictionaryinterface"></a>

### DictionaryInterface

Interface for dictionary-like structures.
Use `isDictionary()` to check if an expression is a dictionary.

<a id="dictionaryinterface_keys" name="dictionaryinterface_keys"></a>

<MemberCard>

##### DictionaryInterface.keys

</MemberCard>

<a id="dictionaryinterface_entries" name="dictionaryinterface_entries"></a>

<MemberCard>

##### DictionaryInterface.entries

</MemberCard>

<a id="dictionaryinterface_values" name="dictionaryinterface_values"></a>

<MemberCard>

##### DictionaryInterface.values

</MemberCard>

<a id="dictionaryinterface_get-1" name="dictionaryinterface_get-1"></a>

<MemberCard>

##### DictionaryInterface.get()

```ts
get(key): BoxedExpression
```

####### key

`string`

</MemberCard>

<a id="dictionaryinterface_has-1" name="dictionaryinterface_has-1"></a>

<MemberCard>

##### DictionaryInterface.has()

```ts
has(key): boolean
```

####### key

`string`

</MemberCard>

<a id="symboltable" name="symboltable"></a>

<MemberCard>

### SymbolTable

```ts
type SymbolTable = {
  parent: SymbolTable | null;
  ids: {};
};
```

</MemberCard>

<a id="bignumfactory" name="bignumfactory"></a>

<MemberCard>

### BigNumFactory()

```ts
type BigNumFactory = (value) => Decimal;
```

</MemberCard>

## Serialization

<a id="jsonserializationoptions" name="jsonserializationoptions"></a>

<MemberCard>

### JsonSerializationOptions

```ts
type JsonSerializationOptions = {
  prettify: boolean;
  exclude: string[];
  shorthands: ("all" | "number" | "symbol" | "function" | "string")[];
  metadata: ("all" | "wikidata" | "latex")[];
  repeatingDecimal: boolean;
  fractionalDigits: "auto" | "max" | number;
};
```

Options to control the serialization to MathJSON when using `BoxedExpression.toMathJson()`.

<a id="jsonserializationoptions_prettify" name="jsonserializationoptions_prettify"></a>

#### JsonSerializationOptions.prettify

```ts
prettify: boolean;
```

If true, the serialization applies some transformations to make
the JSON more readable. For example, `["Power", "x", 2]` is serialized
as `["Square", "x"]`.

<a id="jsonserializationoptions_exclude" name="jsonserializationoptions_exclude"></a>

#### JsonSerializationOptions.exclude

```ts
exclude: string[];
```

A list of space separated function names that should be excluded from
the JSON output.

Those functions are replaced with an equivalent, for example, `Square` with
`Power`, etc...

Possible values include `Sqrt`, `Root`, `Square`, `Exp`, `Subtract`,
`Rational`, `Complex`

**Default**: `[]` (none)

<a id="jsonserializationoptions_shorthands" name="jsonserializationoptions_shorthands"></a>

#### JsonSerializationOptions.shorthands

```ts
shorthands: ("all" | "number" | "symbol" | "function" | "string")[];
```

A list of space separated keywords indicating which MathJSON expressions
can use a shorthand.

**Default**: `["all"]`

<a id="jsonserializationoptions_metadata" name="jsonserializationoptions_metadata"></a>

#### JsonSerializationOptions.metadata

```ts
metadata: ("all" | "wikidata" | "latex")[];
```

A list of space separated keywords indicating which metadata should be
included in the MathJSON. If metadata is included, shorthand notation
is not used.

**Default**: `[]`  (none)

<a id="jsonserializationoptions_repeatingdecimal" name="jsonserializationoptions_repeatingdecimal"></a>

#### JsonSerializationOptions.repeatingDecimal

```ts
repeatingDecimal: boolean;
```

If true, repeating decimals are detected and serialized accordingly
For example:
- `1.3333333333333333` \( \to \) `1.(3)`
- `0.142857142857142857142857142857142857142857142857142` \( \to \) `0.(1428571)`

**Default**: `true`

<a id="jsonserializationoptions_fractionaldigits" name="jsonserializationoptions_fractionaldigits"></a>

#### JsonSerializationOptions.fractionalDigits

```ts
fractionalDigits: "auto" | "max" | number;
```

The maximum number of significant digits in serialized numbers.
- `"max"`: all availabe digits are serialized.
- `"auto"`: use the same precision as the compute engine.

**Default**: `"auto"`

</MemberCard>

<a id="numberformat" name="numberformat"></a>

<MemberCard>

### NumberFormat

```ts
type NumberFormat = {
  positiveInfinity: LatexString;
  negativeInfinity: LatexString;
  notANumber: LatexString;
  imaginaryUnit: LatexString;
  decimalSeparator: LatexString;
  digitGroupSeparator:   | LatexString
     | [LatexString, LatexString];
  digitGroup: "lakh" | number | [number | "lakh", number];
  exponentProduct: LatexString;
  beginExponentMarker: LatexString;
  endExponentMarker: LatexString;
  truncationMarker: LatexString;
  repeatingDecimal: "auto" | "vinculum" | "dots" | "parentheses" | "arc" | "none";
};
```

These options control how numbers are parsed and serialized.

<a id="numberformat_decimalseparator" name="numberformat_decimalseparator"></a>

#### NumberFormat.decimalSeparator

```ts
decimalSeparator: LatexString;
```

A string representing the decimal separator, the string separating
the whole portion of a number from the fractional portion, i.e.
the "." in "3.1415".

Some countries use a comma rather than a dot. In this case it is
recommended to use `"{,}"` as the separator: the surrounding brackets
ensure there is no additional gap after the comma.

**Default**: `"."`

<a id="numberformat_digitgroupseparator" name="numberformat_digitgroupseparator"></a>

#### NumberFormat.digitGroupSeparator

```ts
digitGroupSeparator: 
  | LatexString
  | [LatexString, LatexString];
```

A string representing the separator between groups of digits,
to make numbers with many digits easier to read.

If a single string is provided, it is used to group digits in the
whole and the fractional part of the number. If two strings are provided,
the first is used for the whole part and the second for the fractional
part.

Caution: some values may lead to unexpected results.

For example, if the `digitGroupSeparator` is `,` (comma) the expression
`\operatorname{Hypot}(1,2)` will parse as `["Hypot", 1.2]` rather than
`["Hypot", 1, 2]`. You can however use `{,}` which will avoid this issue
and display with correct spacing.

**Default**: `"\\,"` (thin space, 3/18mu) (Resolution 7 of the 1948 CGPM)

<a id="numberformat_digitgroup" name="numberformat_digitgroup"></a>

#### NumberFormat.digitGroup

```ts
digitGroup: "lakh" | number | [number | "lakh", number];
```

Maximum length of digits between digit group separators.

If a single number is provided, it is used for the whole and the fractional
part of the number. If two numbers are provided, the first is used for the
whole part and the second for the fractional part.

If '`"lakh"`' is provided, the number is grouped in groups of 2 digits,
except for the last group which has 3 digits. For example: `1,00,00,000`.

**Default**: `3`

</MemberCard>

<a id="numberserializationformat" name="numberserializationformat"></a>

<MemberCard>

### NumberSerializationFormat

```ts
type NumberSerializationFormat = NumberFormat & {
  fractionalDigits: "auto" | "max" | number;
  notation: "auto" | "engineering" | "scientific";
  avoidExponentsInRange: undefined | null | [number, number];
};
```

#### NumberSerializationFormat.fractionalDigits

```ts
fractionalDigits: "auto" | "max" | number;
```

The maximum number of significant digits in serialized numbers.
- `"max"`: all availabe digits are serialized.
- `"auto"`: use the same precision as the compute engine.

Default: `"auto"`

</MemberCard>

## Tensors

<a id="datatypemap" name="datatypemap"></a>

<MemberCard>

### DataTypeMap

```ts
type DataTypeMap = {
  float64: number;
  float32: number;
  int32: number;
  uint8: number;
  complex128: Complex;
  complex64: Complex;
  bool: boolean;
  expression: BoxedExpression;
};
```

Map of `TensorDataType` to JavaScript type.

</MemberCard>

<a id="tensordatatype" name="tensordatatype"></a>

<MemberCard>

### TensorDataType

```ts
type TensorDataType = keyof DataTypeMap;
```

The type of the cells in a tensor.

</MemberCard>

<a id="tensordatadt" name="tensordatadt"></a>

### TensorData\<DT\>

A record representing the type, shape and data of a tensor.

#### Extended by

- [`Tensor`](#tensordt)

<a id="tensordatadt_dtype" name="tensordatadt_dtype"></a>

<MemberCard>

##### TensorData.dtype

```ts
dtype: DT;
```

</MemberCard>

<a id="tensordatadt_shape" name="tensordatadt_shape"></a>

<MemberCard>

##### TensorData.shape

```ts
shape: number[];
```

</MemberCard>

<a id="tensordatadt_rank" name="tensordatadt_rank"></a>

<MemberCard>

##### TensorData.rank?

```ts
optional rank: number;
```

</MemberCard>

<a id="tensordatadt_data" name="tensordatadt_data"></a>

<MemberCard>

##### TensorData.data

```ts
data: DataTypeMap[DT][];
```

</MemberCard>

<a id="tensorfieldt" name="tensorfieldt"></a>

### TensorField\<T\>

<a id="tensorfieldt_one" name="tensorfieldt_one"></a>

<MemberCard>

##### TensorField.one

```ts
readonly one: T;
```

</MemberCard>

<a id="tensorfieldt_zero" name="tensorfieldt_zero"></a>

<MemberCard>

##### TensorField.zero

```ts
readonly zero: T;
```

</MemberCard>

<a id="tensorfieldt_nan" name="tensorfieldt_nan"></a>

<MemberCard>

##### TensorField.nan

```ts
readonly nan: T;
```

</MemberCard>

<a id="tensorfieldt_cast" name="tensorfieldt_cast"></a>

<MemberCard>

##### TensorField.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`T`

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`T`

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`T`

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`T`

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`T`

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`T`

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

####### x

`T`

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

####### x

`T`

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`T`[]

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`T`[]

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`T`[]

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`T`[]

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`T`[]

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`T`[]

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

####### x

`T`[]

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

####### x

`T`[]

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`T` | `T`[]

####### dtype

keyof [`DataTypeMap`](#datatypemap)

</MemberCard>

<a id="tensorfieldt_expression" name="tensorfieldt_expression"></a>

<MemberCard>

##### TensorField.expression()

```ts
expression(x): BoxedExpression
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_iszero-1" name="tensorfieldt_iszero-1"></a>

<MemberCard>

##### TensorField.isZero()

```ts
isZero(x): boolean
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_isone-1" name="tensorfieldt_isone-1"></a>

<MemberCard>

##### TensorField.isOne()

```ts
isOne(x): boolean
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_equals" name="tensorfieldt_equals"></a>

<MemberCard>

##### TensorField.equals()

```ts
equals(lhs, rhs): boolean
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<a id="tensorfieldt_add-1" name="tensorfieldt_add-1"></a>

<MemberCard>

##### TensorField.add()

```ts
add(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<a id="tensorfieldt_addn" name="tensorfieldt_addn"></a>

<MemberCard>

##### TensorField.addn()

```ts
addn(...xs): T
```

####### xs

...`T`[]

</MemberCard>

<a id="tensorfieldt_neg-1" name="tensorfieldt_neg-1"></a>

<MemberCard>

##### TensorField.neg()

```ts
neg(x): T
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_sub-1" name="tensorfieldt_sub-1"></a>

<MemberCard>

##### TensorField.sub()

```ts
sub(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<a id="tensorfieldt_mul-1" name="tensorfieldt_mul-1"></a>

<MemberCard>

##### TensorField.mul()

```ts
mul(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<a id="tensorfieldt_muln" name="tensorfieldt_muln"></a>

<MemberCard>

##### TensorField.muln()

```ts
muln(...xs): T
```

####### xs

...`T`[]

</MemberCard>

<a id="tensorfieldt_div-1" name="tensorfieldt_div-1"></a>

<MemberCard>

##### TensorField.div()

```ts
div(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<a id="tensorfieldt_pow-1" name="tensorfieldt_pow-1"></a>

<MemberCard>

##### TensorField.pow()

```ts
pow(rhs, n): T
```

####### rhs

`T`

####### n

`number`

</MemberCard>

<a id="tensorfieldt_conjugate" name="tensorfieldt_conjugate"></a>

<MemberCard>

##### TensorField.conjugate()

```ts
conjugate(x): T
```

####### x

`T`

</MemberCard>

<a id="tensordt" name="tensordt"></a>

### Tensor\<DT\>

#### Extends

- [`TensorData`](#tensordatadt)\<`DT`\>

<a id="tensordt_dtype-1" name="tensordt_dtype-1"></a>

<MemberCard>

##### Tensor.dtype

```ts
dtype: DT;
```

</MemberCard>

<a id="tensordt_shape-1" name="tensordt_shape-1"></a>

<MemberCard>

##### Tensor.shape

```ts
shape: number[];
```

</MemberCard>

<a id="tensordt_rank-1" name="tensordt_rank-1"></a>

<MemberCard>

##### Tensor.rank

```ts
rank: number;
```

</MemberCard>

<a id="tensordt_data-1" name="tensordt_data-1"></a>

<MemberCard>

##### Tensor.data

```ts
data: DataTypeMap[DT][];
```

</MemberCard>

<a id="tensordt_field" name="tensordt_field"></a>

<MemberCard>

##### Tensor.field

```ts
readonly field: TensorField<DT>;
```

</MemberCard>

<a id="tensordt_expression-1" name="tensordt_expression-1"></a>

<MemberCard>

##### Tensor.expression

```ts
readonly expression: BoxedExpression;
```

</MemberCard>

<a id="tensordt_array" name="tensordt_array"></a>

<MemberCard>

##### Tensor.array

```ts
readonly array: NestedArray<DataTypeMap[DT]>;
```

</MemberCard>

<a id="tensordt_issquare" name="tensordt_issquare"></a>

<MemberCard>

##### Tensor.isSquare

```ts
readonly isSquare: boolean;
```

</MemberCard>

<a id="tensordt_issymmetric" name="tensordt_issymmetric"></a>

<MemberCard>

##### Tensor.isSymmetric

```ts
readonly isSymmetric: boolean;
```

</MemberCard>

<a id="tensordt_isskewsymmetric" name="tensordt_isskewsymmetric"></a>

<MemberCard>

##### Tensor.isSkewSymmetric

```ts
readonly isSkewSymmetric: boolean;
```

</MemberCard>

<a id="tensordt_isdiagonal" name="tensordt_isdiagonal"></a>

<MemberCard>

##### Tensor.isDiagonal

```ts
readonly isDiagonal: boolean;
```

</MemberCard>

<a id="tensordt_isuppertriangular" name="tensordt_isuppertriangular"></a>

<MemberCard>

##### Tensor.isUpperTriangular

```ts
readonly isUpperTriangular: boolean;
```

</MemberCard>

<a id="tensordt_islowertriangular" name="tensordt_islowertriangular"></a>

<MemberCard>

##### Tensor.isLowerTriangular

```ts
readonly isLowerTriangular: boolean;
```

</MemberCard>

<a id="tensordt_istriangular" name="tensordt_istriangular"></a>

<MemberCard>

##### Tensor.isTriangular

```ts
readonly isTriangular: boolean;
```

</MemberCard>

<a id="tensordt_isidentity" name="tensordt_isidentity"></a>

<MemberCard>

##### Tensor.isIdentity

```ts
readonly isIdentity: boolean;
```

</MemberCard>

<a id="tensordt_iszero-2" name="tensordt_iszero-2"></a>

<MemberCard>

##### Tensor.isZero

```ts
readonly isZero: boolean;
```

</MemberCard>

<a id="tensordt_at" name="tensordt_at"></a>

<MemberCard>

##### Tensor.at()

```ts
at(...indices): DataTypeMap[DT]
```

####### indices

...`number`[]

</MemberCard>

<a id="tensordt_diagonal" name="tensordt_diagonal"></a>

<MemberCard>

##### Tensor.diagonal()

```ts
diagonal(axis1?, axis2?): DataTypeMap[DT][]
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<a id="tensordt_trace" name="tensordt_trace"></a>

<MemberCard>

##### Tensor.trace()

```ts
trace(axis1?, axis2?): DataTypeMap[DT]
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<a id="tensordt_reshape" name="tensordt_reshape"></a>

<MemberCard>

##### Tensor.reshape()

```ts
reshape(...shape): Tensor<DT>
```

####### shape

...`number`[]

</MemberCard>

<a id="tensordt_slice" name="tensordt_slice"></a>

<MemberCard>

##### Tensor.slice()

```ts
slice(index): Tensor<DT>
```

####### index

`number`

</MemberCard>

<a id="tensordt_flatten" name="tensordt_flatten"></a>

<MemberCard>

##### Tensor.flatten()

```ts
flatten(): DataTypeMap[DT][]
```

</MemberCard>

<a id="tensordt_upcast" name="tensordt_upcast"></a>

<MemberCard>

##### Tensor.upcast()

```ts
upcast<DT>(dtype): Tensor<DT>
```

• DT extends keyof [`DataTypeMap`](#datatypemap)

####### dtype

`DT`

</MemberCard>

<a id="tensordt_transpose" name="tensordt_transpose"></a>

<MemberCard>

##### Tensor.transpose()

```ts
transpose(axis1?, axis2?): Tensor<DT>
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<a id="tensordt_conjugatetranspose" name="tensordt_conjugatetranspose"></a>

<MemberCard>

##### Tensor.conjugateTranspose()

```ts
conjugateTranspose(axis1?, axis2?): Tensor<DT>
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<a id="tensordt_determinant" name="tensordt_determinant"></a>

<MemberCard>

##### Tensor.determinant()

```ts
determinant(): DataTypeMap[DT]
```

</MemberCard>

<a id="tensordt_inverse" name="tensordt_inverse"></a>

<MemberCard>

##### Tensor.inverse()

```ts
inverse(): Tensor<DT>
```

</MemberCard>

<a id="tensordt_pseudoinverse" name="tensordt_pseudoinverse"></a>

<MemberCard>

##### Tensor.pseudoInverse()

```ts
pseudoInverse(): Tensor<DT>
```

</MemberCard>

<a id="tensordt_adjugatematrix" name="tensordt_adjugatematrix"></a>

<MemberCard>

##### Tensor.adjugateMatrix()

```ts
adjugateMatrix(): Tensor<DT>
```

</MemberCard>

<a id="tensordt_minor" name="tensordt_minor"></a>

<MemberCard>

##### Tensor.minor()

```ts
minor(axis1, axis2): DataTypeMap[DT]
```

####### axis1

`number`

####### axis2

`number`

</MemberCard>

<a id="tensordt_map1" name="tensordt_map1"></a>

<MemberCard>

##### Tensor.map1()

```ts
map1(fn, scalar): Tensor<DT>
```

####### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

####### scalar

[`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="tensordt_map2" name="tensordt_map2"></a>

<MemberCard>

##### Tensor.map2()

```ts
map2(fn, rhs): Tensor<DT>
```

####### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

####### rhs

[`Tensor`](#tensordt)\<`DT`\>

</MemberCard>

<a id="tensordt_add-2" name="tensordt_add-2"></a>

<MemberCard>

##### Tensor.add()

```ts
add(other): Tensor<DT>
```

####### other

[`Tensor`](#tensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="tensordt_subtract" name="tensordt_subtract"></a>

<MemberCard>

##### Tensor.subtract()

```ts
subtract(other): Tensor<DT>
```

####### other

[`Tensor`](#tensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="tensordt_multiply" name="tensordt_multiply"></a>

<MemberCard>

##### Tensor.multiply()

```ts
multiply(other): Tensor<DT>
```

####### other

[`Tensor`](#tensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="tensordt_divide" name="tensordt_divide"></a>

<MemberCard>

##### Tensor.divide()

```ts
divide(other): Tensor<DT>
```

####### other

[`Tensor`](#tensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="tensordt_power" name="tensordt_power"></a>

<MemberCard>

##### Tensor.power()

```ts
power(other): Tensor<DT>
```

####### other

[`Tensor`](#tensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="tensordt_equals-1" name="tensordt_equals-1"></a>

<MemberCard>

##### Tensor.equals()

```ts
equals(other): boolean
```

####### other

[`Tensor`](#tensordt)\<`DT`\>

</MemberCard>

## Type

<a id="boxedtype" name="boxedtype"></a>

### BoxedType

<MemberCard>

##### new BoxedType()

```ts
new BoxedType(type, typeResolver?): BoxedType
```

####### type

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`RecordType`](#recordtype) | [`DictionaryType`](#dictionarytype) | [`TupleType`](#tupletype) | [`SymbolType`](#symboltype) | [`ExpressionType`](#expressiontype) | [`NumericType`](#numerictype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference)

####### typeResolver?

[`TypeResolver`](#typeresolver)

</MemberCard>

<a id="boxedtype_unknown" name="boxedtype_unknown"></a>

<MemberCard>

##### BoxedType.unknown

```ts
static unknown: BoxedType;
```

</MemberCard>

<a id="boxedtype_number" name="boxedtype_number"></a>

<MemberCard>

##### BoxedType.number

```ts
static number: BoxedType;
```

</MemberCard>

<a id="boxedtype_non_finite_number" name="boxedtype_non_finite_number"></a>

<MemberCard>

##### BoxedType.non\_finite\_number

```ts
static non_finite_number: BoxedType;
```

</MemberCard>

<a id="boxedtype_finite_number" name="boxedtype_finite_number"></a>

<MemberCard>

##### BoxedType.finite\_number

```ts
static finite_number: BoxedType;
```

</MemberCard>

<a id="boxedtype_finite_integer" name="boxedtype_finite_integer"></a>

<MemberCard>

##### BoxedType.finite\_integer

```ts
static finite_integer: BoxedType;
```

</MemberCard>

<a id="boxedtype_finite_real" name="boxedtype_finite_real"></a>

<MemberCard>

##### BoxedType.finite\_real

```ts
static finite_real: BoxedType;
```

</MemberCard>

<a id="boxedtype_string" name="boxedtype_string"></a>

<MemberCard>

##### BoxedType.string

```ts
static string: BoxedType;
```

</MemberCard>

<a id="boxedtype_dictionary" name="boxedtype_dictionary"></a>

<MemberCard>

##### BoxedType.dictionary

```ts
static dictionary: BoxedType;
```

</MemberCard>

<a id="boxedtype_setnumber" name="boxedtype_setnumber"></a>

<MemberCard>

##### BoxedType.setNumber

```ts
static setNumber: BoxedType;
```

</MemberCard>

<a id="boxedtype_setcomplex" name="boxedtype_setcomplex"></a>

<MemberCard>

##### BoxedType.setComplex

```ts
static setComplex: BoxedType;
```

</MemberCard>

<a id="boxedtype_setimaginary" name="boxedtype_setimaginary"></a>

<MemberCard>

##### BoxedType.setImaginary

```ts
static setImaginary: BoxedType;
```

</MemberCard>

<a id="boxedtype_setreal" name="boxedtype_setreal"></a>

<MemberCard>

##### BoxedType.setReal

```ts
static setReal: BoxedType;
```

</MemberCard>

<a id="boxedtype_setrational" name="boxedtype_setrational"></a>

<MemberCard>

##### BoxedType.setRational

```ts
static setRational: BoxedType;
```

</MemberCard>

<a id="boxedtype_setfiniteinteger" name="boxedtype_setfiniteinteger"></a>

<MemberCard>

##### BoxedType.setFiniteInteger

```ts
static setFiniteInteger: BoxedType;
```

</MemberCard>

<a id="boxedtype_setinteger" name="boxedtype_setinteger"></a>

<MemberCard>

##### BoxedType.setInteger

```ts
static setInteger: BoxedType;
```

</MemberCard>

<a id="boxedtype_type" name="boxedtype_type"></a>

<MemberCard>

##### BoxedType.type

```ts
type: Type;
```

</MemberCard>

<a id="boxedtype_isunknown" name="boxedtype_isunknown"></a>

<MemberCard>

##### BoxedType.isUnknown

</MemberCard>

<a id="boxedtype_widen" name="boxedtype_widen"></a>

<MemberCard>

##### BoxedType.widen()

```ts
static widen(...types): BoxedType
```

####### types

...readonly (
  \| [`Type`](#type-3)
  \| [`BoxedType`](#boxedtype))[]

</MemberCard>

<a id="boxedtype_narrow" name="boxedtype_narrow"></a>

<MemberCard>

##### BoxedType.narrow()

```ts
static narrow(...types): BoxedType
```

####### types

...readonly (
  \| [`Type`](#type-3)
  \| [`BoxedType`](#boxedtype))[]

</MemberCard>

<a id="boxedtype_matches" name="boxedtype_matches"></a>

<MemberCard>

##### BoxedType.matches()

```ts
matches(other): boolean
```

####### other

[`Type`](#type-3) | [`BoxedType`](#boxedtype)

</MemberCard>

<a id="boxedtype_is" name="boxedtype_is"></a>

<MemberCard>

##### BoxedType.is()

```ts
is(other): boolean
```

####### other

[`Type`](#type-3)

</MemberCard>

<a id="boxedtype_tostring" name="boxedtype_tostring"></a>

<MemberCard>

##### BoxedType.toString()

```ts
toString(): string
```

</MemberCard>

<a id="boxedtype_tojson" name="boxedtype_tojson"></a>

<MemberCard>

##### BoxedType.toJSON()

```ts
toJSON(): string
```

</MemberCard>

<a id="boxedtype_toprimitive" name="boxedtype_toprimitive"></a>

<MemberCard>

##### BoxedType.\[toPrimitive\]()

```ts
toPrimitive: string
```

####### hint

`string`

</MemberCard>

<a id="boxedtype_valueof" name="boxedtype_valueof"></a>

<MemberCard>

##### BoxedType.valueOf()

```ts
valueOf(): string
```

</MemberCard>



## MathJSON

<a id="mathjsonattributes" name="mathjsonattributes"></a>

<MemberCard>

### MathJsonAttributes

```ts
type MathJsonAttributes = {
  comment: string;
  documentation: string;
  latex: string;
  wikidata: string;
  wikibase: string;
  openmathSymbol: string;
  openmathCd: string;
  sourceUrl: string;
  sourceContent: string;
  sourceOffsets: [number, number];
};
```

The following properties can be added to any MathJSON expression
to provide additional information about the expression.

<a id="mathjsonattributes_comment" name="mathjsonattributes_comment"></a>

#### MathJsonAttributes.comment?

```ts
optional comment: string;
```

A human readable string to annotate this expression, since JSON does not
allow comments in its encoding

<a id="mathjsonattributes_documentation" name="mathjsonattributes_documentation"></a>

#### MathJsonAttributes.documentation?

```ts
optional documentation: string;
```

A Markdown-encoded string providing documentation about this expression.

<a id="mathjsonattributes_latex" name="mathjsonattributes_latex"></a>

#### MathJsonAttributes.latex?

```ts
optional latex: string;
```

A visual representation of this expression as a LaTeX string.

This can be useful to preserve non-semantic details, for example
parentheses in an expression or styling attributes.

<a id="mathjsonattributes_wikidata" name="mathjsonattributes_wikidata"></a>

#### MathJsonAttributes.wikidata?

```ts
optional wikidata: string;
```

A short string referencing an entry in a wikibase.

For example:

`"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
 for the `Pi` constant.

<a id="mathjsonattributes_wikibase" name="mathjsonattributes_wikibase"></a>

#### MathJsonAttributes.wikibase?

```ts
optional wikibase: string;
```

A base URL for the `wikidata` key.

A full URL can be produced by concatenating this key with the `wikidata`
key. This key applies to this node and all its children.

The default value is "https://www.wikidata.org/wiki/"

<a id="mathjsonattributes_openmathsymbol" name="mathjsonattributes_openmathsymbol"></a>

#### MathJsonAttributes.openmathSymbol?

```ts
optional openmathSymbol: string;
```

A short string indicating an entry in an OpenMath Content Dictionary.

For example: `arith1/#abs`.

<a id="mathjsonattributes_openmathcd" name="mathjsonattributes_openmathcd"></a>

#### MathJsonAttributes.openmathCd?

```ts
optional openmathCd: string;
```

A base URL for an OpenMath content dictionary. This key applies to this
node and all its children.

The default value is "http://www.openmath.org/cd".

<a id="mathjsonattributes_sourceurl" name="mathjsonattributes_sourceurl"></a>

#### MathJsonAttributes.sourceUrl?

```ts
optional sourceUrl: string;
```

A URL to the source code from which this expression was generated.

<a id="mathjsonattributes_sourcecontent" name="mathjsonattributes_sourcecontent"></a>

#### MathJsonAttributes.sourceContent?

```ts
optional sourceContent: string;
```

The source code from which this expression was generated.

It could be a LaTeX expression, or some other source language.

<a id="mathjsonattributes_sourceoffsets" name="mathjsonattributes_sourceoffsets"></a>

#### MathJsonAttributes.sourceOffsets?

```ts
optional sourceOffsets: [number, number];
```

A character offset in `sourceContent` or `sourceUrl` from which this
expression was generated.

</MemberCard>

<a id="mathjsonsymbol" name="mathjsonsymbol"></a>

<MemberCard>

### MathJsonSymbol

```ts
type MathJsonSymbol = string;
```

</MemberCard>

<a id="mathjsonnumberobject" name="mathjsonnumberobject"></a>

<MemberCard>

### MathJsonNumberObject

```ts
type MathJsonNumberObject = {
  num: "NaN" | "-Infinity" | "+Infinity" | string;
 } & MathJsonAttributes;
```

A MathJSON numeric quantity.

The `num` string is made of:
- an optional `-` minus sign
- a string of decimal digits
- an optional fraction part (a `.` decimal marker followed by decimal digits)
- an optional repeating decimal pattern: a string of digits enclosed in
   parentheses
- an optional exponent part (a `e` or `E` exponent marker followed by an
  optional `-` minus sign, followed by a string of digits)

It can also consist of the string `NaN`, `-Infinity` or `+Infinity` to
represent these respective values.

A MathJSON number may contain more digits or an exponent with a greater
range than can be represented in an IEEE 64-bit floating-point.

For example:
- `-12.34`
- `0.234e-56`
- `1.(3)`
- `123456789123456789.123(4567)e999`

</MemberCard>

<a id="mathjsonsymbolobject" name="mathjsonsymbolobject"></a>

<MemberCard>

### MathJsonSymbolObject

```ts
type MathJsonSymbolObject = {
  sym: MathJsonSymbol;
 } & MathJsonAttributes;
```

</MemberCard>

<a id="mathjsonstringobject" name="mathjsonstringobject"></a>

<MemberCard>

### MathJsonStringObject

```ts
type MathJsonStringObject = {
  str: string;
 } & MathJsonAttributes;
```

</MemberCard>

<a id="mathjsonfunctionobject" name="mathjsonfunctionobject"></a>

<MemberCard>

### MathJsonFunctionObject

```ts
type MathJsonFunctionObject = {
  fn: [MathJsonSymbol, ...Expression[]];
 } & MathJsonAttributes;
```

</MemberCard>

<a id="mathjsondictionaryobject" name="mathjsondictionaryobject"></a>

<MemberCard>

### MathJsonDictionaryObject

```ts
type MathJsonDictionaryObject = {
  dict: Record<string, Expression>;
 } & MathJsonAttributes;
```

</MemberCard>

<a id="expressionobject" name="expressionobject"></a>

<MemberCard>

### ExpressionObject

```ts
type ExpressionObject = 
  | MathJsonNumberObject
  | MathJsonStringObject
  | MathJsonSymbolObject
  | MathJsonFunctionObject
  | MathJsonDictionaryObject;
```

</MemberCard>

<a id="expression" name="expression"></a>

<MemberCard>

### Expression

```ts
type Expression = 
  | ExpressionObject
  | number
  | MathJsonSymbol
  | string
  | readonly [MathJsonSymbol, ...Expression[]];
```

A MathJSON expression is a recursive data structure.

The leaf nodes of an expression are numbers, strings and symbols.
The dictionary and function nodes can contain expressions themselves.

</MemberCard>



## Type

<a id="primitivetype" name="primitivetype"></a>

<MemberCard>

### PrimitiveType

```ts
type PrimitiveType = 
  | NumericPrimitiveType
  | "collection"
  | "indexed_collection"
  | "list"
  | "set"
  | "dictionary"
  | "record"
  | "dictionary"
  | "tuple"
  | "value"
  | "scalar"
  | "function"
  | "symbol"
  | "boolean"
  | "string"
  | "expression"
  | "unknown"
  | "error"
  | "nothing"
  | "never"
  | "any";
```

A primitive type is a simple type that represents a concrete value.

- `any`: the top type
   - `expression`
   - `error`: an invalid value, such as `["Error", "missing"]`
   - `nothing`: the type of the `Nothing` symbol, the unit type
   - `never`: the bottom type
   - `unknown`: a value whose type is not known

- `expression`:
   - a symbolic expression, such as `["Add", "x", 1]`
   - `<value>`
   - `symbol`: a symbol, such as `x`.
   - `function`: a function literal
     such as `["Function", ["Add", "x", 1], "x"]`.

- `value`
   - `scalar`
     - `<number>`
     - `boolean`: a boolean value: `True` or `False`.
     - `string`: a string of characters.
   - `collection`
      - `set`: a collection of unique expressions, e.g. `set<string>`.
      - `record`: a collection of specific key-value pairs,
         e.g. `record<x: number, y: boolean>`.
      - `dictionary`: a collection of arbitrary key-value pairs
         e.g. `dictionary<string, number>`.
      - `indexed_collection`: collections whose elements can be accessed
            by a numeric index
         - `list`: a collection of expressions, possibly recursive,
             with optional dimensions, e.g. `[number]`, `[boolean^32]`,
             `[number^(2x3)]`. Used to represent a vector, a matrix or a
             tensor when the type of its elements is a number
          - `tuple`: a fixed-size collection of named or unnamed elements,
             e.g. `tuple<number, boolean>`, `tuple<x: number, y: boolean>`.

</MemberCard>

<a id="numericprimitivetype" name="numericprimitivetype"></a>

<MemberCard>

### NumericPrimitiveType

```ts
type NumericPrimitiveType = 
  | "number"
  | "finite_number"
  | "complex"
  | "finite_complex"
  | "imaginary"
  | "real"
  | "finite_real"
  | "rational"
  | "finite_rational"
  | "integer"
  | "finite_integer"
  | "non_finite_number";
```

- `number`: any numeric value = `complex` + `real` plus `NaN`
- `complex`: a number with non-zero real and imaginary parts = `finite_complex` plus `ComplexInfinity`
- `finite_complex`: a finite complex number = `imaginary` + `finite_real`
- `imaginary`: a complex number with a real part of 0 (pure imaginary)
- `finite_number`: a finite numeric value = `finite_complex`
- `finite_real`: a finite real number = `finite_rational` + `finite_integer`
- `finite_rational`: a pure rational number
- `finite_integer`: a whole number
- `real`: a complex number with an imaginary part of 0 = `finite_real` + `non_finite_number`
- `non_finite_number`: `PositiveInfinity`, `NegativeInfinity`
- `integer`: a whole number = `finite_integer` + `non_finite_number`
- `rational`: a pure rational number (not an integer) = `finite_rational` + `non_finite_number`

</MemberCard>

<a id="namedelement" name="namedelement"></a>

<MemberCard>

### NamedElement

```ts
type NamedElement = {
  name: string;
  type: Type;
};
```

</MemberCard>

<a id="functionsignature" name="functionsignature"></a>

<MemberCard>

### FunctionSignature

```ts
type FunctionSignature = {
  kind: "signature";
  args: NamedElement[];
  optArgs: NamedElement[];
  variadicArg: NamedElement;
  variadicMin: 0 | 1;
  result: Type;
};
```

</MemberCard>

<a id="algebraictype" name="algebraictype"></a>

<MemberCard>

### AlgebraicType

```ts
type AlgebraicType = {
  kind: "union" | "intersection";
  types: Type[];
};
```

</MemberCard>

<a id="negationtype" name="negationtype"></a>

<MemberCard>

### NegationType

```ts
type NegationType = {
  kind: "negation";
  type: Type;
};
```

</MemberCard>

<a id="valuetype" name="valuetype"></a>

<MemberCard>

### ValueType

```ts
type ValueType = {
  kind: "value";
  value: any;
};
```

</MemberCard>

<a id="recordtype" name="recordtype"></a>

<MemberCard>

### RecordType

```ts
type RecordType = {
  kind: "record";
  elements: Record<string, Type>;
};
```

A record is a collection of key-value pairs.

The keys are strings. The set of keys is fixed.

For a record type to be a subtype of another record type, it must have a
subset of the keys, and all their types must match (width subtyping).

</MemberCard>

<a id="dictionarytype" name="dictionarytype"></a>

<MemberCard>

### DictionaryType

```ts
type DictionaryType = {
  kind: "dictionary";
  values: Type;
};
```

A dictionary is a collection of key-value pairs.

The keys are strings. The set of keys is also not defined as part of the
type and can be modified at runtime.

A dictionary is suitable for use as cache or data storage.

</MemberCard>

<a id="collectiontype" name="collectiontype"></a>

<MemberCard>

### CollectionType

```ts
type CollectionType = {
  kind: "collection" | "indexed_collection";
  elements: Type;
};
```

`CollectionType` is a generic collection of elements of a certain type.

- Indexed collections: List, Tuple
- Non-indexed: Set, Record, Dictionary

</MemberCard>

<a id="listtype" name="listtype"></a>

<MemberCard>

### ListType

```ts
type ListType = {
  kind: "list";
  elements: Type;
  dimensions: number[];
};
```

The elements of a list can be accessed by their one-based index.

All elements of a list have the same type, but it can be a broad type,
up to `any`.

The same element can be present in the list more than once.

A list can be multi-dimensional. For example, a list of integers with
dimensions 2x3x4 is a 3D tensor with 2 layers, 3 rows and 4 columns.

</MemberCard>

<a id="symboltype" name="symboltype"></a>

<MemberCard>

### SymbolType

```ts
type SymbolType = {
  kind: "symbol";
  name: string;
};
```

</MemberCard>

<a id="expressiontype" name="expressiontype"></a>

<MemberCard>

### ExpressionType

```ts
type ExpressionType = {
  kind: "expression";
  operator: string;
};
```

</MemberCard>

<a id="numerictype" name="numerictype"></a>

<MemberCard>

### NumericType

```ts
type NumericType = {
  kind: "numeric";
  type: NumericPrimitiveType;
  lower: number;
  upper: number;
};
```

</MemberCard>

<a id="settype" name="settype"></a>

<MemberCard>

### SetType

```ts
type SetType = {
  kind: "set";
  elements: Type;
};
```

Each element of a set is unique (is not present in the set more than once).
The elements of a set are not indexed.

</MemberCard>

<a id="tupletype" name="tupletype"></a>

<MemberCard>

### TupleType

```ts
type TupleType = {
  kind: "tuple";
  elements: NamedElement[];
};
```

The elements of a tuple are indexed and may be named or unnamed.
If one element is named, all elements must be named.

</MemberCard>

<a id="typereference" name="typereference"></a>

<MemberCard>

### TypeReference

```ts
type TypeReference = {
  kind: "reference";
  name: string;
  alias: boolean;
  def: Type | undefined;
};
```

Nominal typing

</MemberCard>

<a id="type-3" name="type-3"></a>

<MemberCard>

### Type

```ts
type Type = 
  | PrimitiveType
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | RecordType
  | DictionaryType
  | TupleType
  | SymbolType
  | ExpressionType
  | NumericType
  | NumericPrimitiveType
  | FunctionSignature
  | ValueType
  | TypeReference;
```

</MemberCard>

<a id="typestring" name="typestring"></a>

<MemberCard>

### TypeString

```ts
type TypeString = string;
```

The type of a boxed expression indicates the kind of expression it is and
the value it represents.

The type is represented either by a primitive type (e.g. number, complex, collection, etc.), or a compound type (e.g. tuple, function signature, etc.).

Types are described using the following BNF grammar:

```bnf
<type> ::= <union_type> | "(" <type> ")"

<union_type> ::= <intersection_type> (" | " <intersection_type>)*

<intersection_type> ::= <primary_type> (" & " <primary_type>)*

<primary_type> ::=  <primitive>
               | <tuple_type>
               | <signature>
               | <list_type>

<primitive> ::= "any" | "unknown" | <value-type> | <symbolic-type> | <numeric-type>

<numeric-type> ::= "number" | "complex" | "imaginary" | "real" | "rational" | "integer"

<value-type> ::= "value" | <numeric-type> | "collection" | "boolean" | "string"

<symbolic-type> ::= "expression" | "function" | "symbol"

<tuple_type> ::= "tuple<" (<name> <type> "," <named_tuple_elements>*) ">"
           | "tuple<" (<type> "," <unnamed_tuple_elements>*) ">" |
           | "tuple<" <tuple_elements> ">"

<tuple_elements> ::= <unnamed_tuple_elements> | <named_tuple_elements>

<unnamed_tuple_elements> ::= <type> ("," <type>)*

<named_tuple_elements> ::= <name> <type> ("," <name> <type>)*

<signature> ::=  <arguments> " -> " <type>

<arguments> ::= "()"
           | <argument>
           | "(" <argument-list> ")"

<argument> ::= <type>
           | <name> <type>

<rest_argument> ::= "..." <type>
           | <name> "..." <type>

<optional_argument> ::= <argument> "?"

<optional_arguments> ::= <optional_argument> ("," <optional_argument>)*

<required_arguments> ::= <argument> ("," <argument>)*

<argument-list> ::= <required_arguments> ("," <rest_argument>)?
           | <required_arguments> <optional_arguments>?
           | <optional_arguments>?
           | <rest_argument>

<list_type> ::= "list<" <type> <dimensions>? ">"

<dimensions> ::= "^" <fixed_size>
           | "^(" <multi_dimensional_size> ")"

<fixed_size> ::= <positive-integer_literal>

<multi_dimensional_size> ::= <positive-integer_literal> "x" <positive-integer_literal> ("x" <positive-integer_literal>)*

<map> ::= "map" | "map<" <map_elements> ">"

<map_elements> ::= <name> <type> ("," <name> <type>)*

<set> ::= "set<" <type> ">"

<collection ::= "collection<" <type> ">"

<name> ::= <identifier> ":"

<identifier> ::= [a-zA-Z_][a-zA-Z0-9_]*

<positive-integer_literal> ::= [1-9][0-9]*
```

Examples of types strings:
- `"number"`    -- a simple type primitive
- `"(number, boolean)"` -- a tuple type
- `"(x: number, y:boolean)"` -- a named tuple/record type. Either all arguments are named, or none are
- `"collection<any>"` -- an arbitrary collection type, with no length or element type restrictions
- `"collection<integer>"` -- a collection type where all the elements are integers
- `"collection<(number, boolean)>"` -- a collection of tuples
- `"collection<(value:number, seen:boolean)>"` -- a collection of named tuples
- `"[boolean]^32"` -- a collection type with a fixed size of 32 elements
- `"[integer]^(2x3)"` -- an integer matrix of 2 columns and 3 rows
- `"[integer]^(2x3x4)"` -- a tensor of dimensions 2x3x4
- `"number -> number"` -- a signature with a single argument
- `"(x: number, number) -> number"` -- a signature with a named argument
- `"(number, y:number?) -> number"` -- a signature with an optional named argument (can have several optional arguments, at the end)
- `"(number, number+) -> number"` -- a signature with a rest argument (can have only one, and no optional arguments if there is a rest argument).
- `"() -> number"` -- a signature with an empty argument list
- `"number | boolean"` -- a union type
- `"(x: number) & (y: number)"` -- an intersection type
- `"number | ((x: number) & (y: number))"` -- a union type with an intersection type
- `"(number -> number) | number"` -- a union type with a signature and a primitive type

</MemberCard>

<a id="typecompatibility" name="typecompatibility"></a>

<MemberCard>

### TypeCompatibility

```ts
type TypeCompatibility = "covariant" | "contravariant" | "bivariant" | "invariant";
```

</MemberCard>

<a id="typeresolver" name="typeresolver"></a>

<MemberCard>

### TypeResolver

```ts
type TypeResolver = {
  get names: string[];
  forward: (name) => TypeReference | undefined;
  resolve: (name) => TypeReference | undefined;
};
```

A type resolver should return a definition for a given type name.

</MemberCard>
