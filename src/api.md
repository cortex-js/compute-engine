

## Compute Engine

<a id="scope-2" name="scope-2"></a>

<MemberCard>

### Scope

```ts
type Scope = Record<string, any>;
```

A scope is a set of names in a dictionary that are bound (defined) in
a MathJSON expression.

Scopes are arranged in a stack structure. When an expression that defined
a new scope is evaluated, the new scope is added to the scope stack.
Outside of the expression, the scope is removed from the scope stack.

The scope stack is used to resolve symbols, and it is possible for
a scope to 'mask' definitions from previous scopes.

Scopes are lexical (also called a static scope): they are defined based on
where they are in an expression, they are not determined at runtime.

</MemberCard>

<a id="angularunit" name="angularunit"></a>

<MemberCard>

### AngularUnit

```ts
type AngularUnit = "rad" | "deg" | "grad" | "turn";
```

When a unitless value is passed to or returned from a trigonometric function,
the angular unit of the value.

- `rad`: radians, 2π radians is a full circle
- `deg`: degrees, 360 degrees is a full circle
- `grad`: gradians, 400 gradians is a full circle
- `turn`: turns, 1 turn is a full circle

</MemberCard>

<a id="runtimescope" name="runtimescope"></a>

<MemberCard>

### RuntimeScope

```ts
type RuntimeScope = Scope & {
  parentScope: RuntimeScope;
  ids: RuntimeIdentifierDefinitions;
  assumptions:   | undefined
     | ExpressionMapInterface<boolean>;
};
```

</MemberCard>

<a id="assignvalue" name="assignvalue"></a>

<MemberCard>

### AssignValue

```ts
type AssignValue = 
  | boolean
  | number
  | SemiBoxedExpression
  | (args, options) => BoxedExpression
  | undefined;
```

</MemberCard>

## Boxed Expression

<a id="boxedexpression" name="boxedexpression"></a>

### BoxedExpression

:::info[THEORY OF OPERATIONS]

The `BoxedExpression` interface includes the methods and properties
applicable to any kind of expression, for example `expr.symbol` or
`expr.ops`.

When a member function is not applicable to this `BoxedExpression`,
for example `get symbol()` on a `BoxedNumber`, it returns `null`.

This convention makes it convenient to manipulate expressions without
having to check what kind of instance they are before manipulating them.
:::

To get a boxed expression from a LaTeX string use `ce.parse()`, and to
get a boxed expression from a MathJSON expression use `ce.box()`.

To create a boxed expression:

#### `ce.box()` and `ce.parse()`

Use `ce.box()` or `ce.parse()` to get a canonical expression.
   - the arguments are put in canonical form
   - invisible operators are made explicit
   - a limited number of core simplifications are applied,
     for example 0 is removed from additions
   - sequences are flattened: `["Add", 1, ["Sequence", 2, 3]]` is
     transformed to `["Add", 1, 2, 3]`
   - associative functions are flattened: `["Add", 1, ["Add", 2, 3]]` is
     transformed to `["Add", 1, 2, 3]`
   - the arguments of commutative functions are sorted
   - identifiers are **not** replaced with their values

#### Algebraic methods (expr.add(), expr.mul(), etc...)

The boxed expression have some algebraic methods,
i.e. `add`, `mul`, `div`, `pow`, etc. These methods are suitable for
internal calculations, although they may be used as part of the public
API as well.

   - the operation is performed on the canonical version of the expression

   - the arguments are not evaluated

   - the canonical handler (of the corresponding operation) is not called

   - some additional simplifications over canonicalization are applied.
     For example number literals are combined.
     However, the result is exact, and no approximation is made. Use `.N()`
     to get an approximate value.
     This is equivalent to calling `simplify()` on the expression (but
     without simplifying the arguments).

   - sequences were already flattened as part of the canonicalization process

  For 'add' and 'mul', which take multiple arguments, separate functions
  are provided that take an array of arguments. They are equivalent
  to calling the boxed algebraic method, i.e. `ce.Zero.add(1, 2, 3)` and
  `add(1, 2, 3)` are equivalent.

These methods are not equivalent to calling `expr.evaluate()` on the
expression: evaluate will replace identifiers with their values, and
evaluate the expression

#### `ce._fn()`

Use `ce._fn()` to create a new function expression.

This is a low level method which is typically invoked in the canonical
handler of a function definition.

The arguments are not modified. The expression is not put in canonical
form. The canonical handler is *not* called.

A canonical flag can be set when calling the function, but it only
asserts that the function and its arguments are canonical. The caller
is responsible for ensuring that is the case.

#### `ce.function()`

This is a specialized version of `ce.box()`. It is used to create a new
function expression.

The arguments are put in canonical form and the canonical handler is called.

For algebraic functions (add, mul, etc..), use the corresponding
canonicalization function, i.e. `canonicalAdd(a, b)` instead of
`ce.function('Add', a, b)`.

Another option is to use the algebraic methods directly, i.e. `a.add(b)`
instead of `ce.function('Add', a, b)`. However, the algebraic methods will
apply further simplifications which may or may not be desirable. For
example, number literals will be combined.

#### Canonical Handlers

Canonical handlers are responsible for:
   - validating the signature (type and number of arguments)
   - flattening sequences
   - flattening associative functions
   - sort the arguments (if the function is commutative)
   - calling `ce._fn()` to create a new function expression
   - if the function definition has a hold, they should also put
     their arguments in canonical form, if appropriate

When the canonical handler is invoked, the arguments have been put in
canonical form according to the `hold` flag.

Some canonical handlers are available as separate functions and can be
used directly, for example `canonicalAdd(a, b)` instead of
`ce.function('Add', [a, b])`.

#### Function Expression

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

<a id="boxedexpression_isnan-1" name="boxedexpression_isnan-1"></a>

<MemberCard>

##### BoxedExpression.isNaN

```ts
readonly isNaN: boolean;
```

"Not a Number".

A value representing undefined result of computations, such as `0/0`,
as per the floating point format standard IEEE-754.

Note that if `isNaN` is true, `isNumber` is also true (yes, `NaN` is a
number).

If this expression is a symbol, this lookup also causes binding to a definition.

</MemberCard>

<a id="boxedexpression_isinfinity" name="boxedexpression_isinfinity"></a>

<MemberCard>

##### BoxedExpression.isInfinity

```ts
readonly isInfinity: boolean;
```

The numeric value of this expression is `±Infinity` or ComplexInfinity.

If this is a symbol, causes it to be bound to a definition.

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

<a id="boxedexpression_iseven" name="boxedexpression_iseven"></a>

<MemberCard>

##### BoxedExpression.isEven

```ts
readonly isEven: boolean;
```

</MemberCard>

<a id="boxedexpression_isodd" name="boxedexpression_isodd"></a>

<MemberCard>

##### BoxedExpression.isOdd

```ts
readonly isOdd: boolean;
```

</MemberCard>

<a id="boxedexpression_numericvalue-1" name="boxedexpression_numericvalue-1"></a>

<MemberCard>

##### BoxedExpression.numericValue

```ts
readonly numericValue: number | NumericValue;
```

Return the value of this expression, if a number literal.

Note it is possible for `this.numericValue` to be `null`, and for
`this.isNotZero` to be true. For example, when a symbol has been
defined with an assumption.

Conversely, `this.isNumber` may be true even if `numericValue` is `null`,
example the symbol `Pi` return `true` for `isNumber` but `numericValue` is
`null`. Its value can be accessed with `.N().numericValue`.

To check if an expression is a number literal, use `this.isNumberLiteral`.
If `this.isNumberLiteral` is `true`, `this.numericValue` is not `null`

</MemberCard>

<a id="boxedexpression_isnumberliteral" name="boxedexpression_isnumberliteral"></a>

<MemberCard>

##### BoxedExpression.isNumberLiteral

```ts
readonly isNumberLiteral: boolean;
```

Return `true` if this expression is a number literal, for example
`2`, `3.14`, `1/2`, `√2` etc.

This is equivalent to checking if `this.numericValue` is not `null`.

</MemberCard>

<a id="boxedexpression_re-1" name="boxedexpression_re-1"></a>

<MemberCard>

##### BoxedExpression.re

```ts
readonly re: number;
```

If this expression is a number literal or a symbol with a value that
is a number literal, return the real part of the value.

If the expression is not a number literal, or a symbol with a value
that is a number literal, return `NaN` (not a number).

</MemberCard>

<a id="boxedexpression_im-1" name="boxedexpression_im-1"></a>

<MemberCard>

##### BoxedExpression.im

```ts
readonly im: number;
```

If this expression is a number literal or a symbol with a value that
is a number literal, return the imaginary part of the value. If the value
is a real number, the imaginary part is 0.

If the expression is not a number literal, or a symbol with a value
that is a number literal, return `NaN` (not a number).

</MemberCard>

<a id="boxedexpression_bignumre-1" name="boxedexpression_bignumre-1"></a>

<MemberCard>

##### BoxedExpression.bignumRe

```ts
readonly bignumRe: Decimal;
```

If this expression is a number literal or a symbol with a value that
is a number literal, return the real part of the value as a `BigNum`.

If the value is not available as a bignum return `undefined`. That is,
the value is not upconverted to a bignum.

To get the real value either as a bignum or a number, use
`this.bignumRe ?? this.re`. When using this pattern, the value is
returned as a bignum if available, otherwise as a number or NaN if
the value is not a number literal or a symbol with a value that is a
number literal.

</MemberCard>

<a id="boxedexpression_bignumim-1" name="boxedexpression_bignumim-1"></a>

<MemberCard>

##### BoxedExpression.bignumIm

```ts
readonly bignumIm: Decimal;
```

If this expression is a number literal, return the imaginary part as a
`BigNum`.

It may be 0 if the number is real.

If the expression is not a number literal or the value is not available
as a bignum return `undefined`. That is, the value is not upconverted
to a bignum.

To get the imaginary value either as a bignum or a number, use
`this.bignumIm ?? this.im`. When using this pattern, the value is
returned as a bignum if available, otherwise as a number or NaN if
the value is not a number literal or a symbol with a value that is a
number literal.

</MemberCard>

<a id="boxedexpression_sgn-1" name="boxedexpression_sgn-1"></a>

<MemberCard>

##### BoxedExpression.sgn

```ts
readonly sgn: Sign;
```

Return the sign of the expression.

Note that complex numbers have no natural ordering,
so if the value is an imaginary number (a complex number with a non-zero
imaginary part), `this.sgn` will return `unsigned`.

If a symbol, this does take assumptions into account, that is `this.sgn`
will return `positive` if the symbol is assumed to be positive
(using `ce.assume()`).

For a symbol also, requires that the symbol be bound with its definition (i.e. canonical);
otherwise, will return `undefined`.

</MemberCard>

<a id="boxedexpression_ispositive" name="boxedexpression_ispositive"></a>

<MemberCard>

##### BoxedExpression.isPositive

```ts
readonly isPositive: boolean;
```

The numeric value of this expression is > 0, same as `isGreater(0)`

</MemberCard>

<a id="boxedexpression_isnonnegative" name="boxedexpression_isnonnegative"></a>

<MemberCard>

##### BoxedExpression.isNonNegative

```ts
readonly isNonNegative: boolean;
```

The numeric value of this expression is >= 0, same as `isGreaterEqual(0)`

</MemberCard>

<a id="boxedexpression_isnegative" name="boxedexpression_isnegative"></a>

<MemberCard>

##### BoxedExpression.isNegative

```ts
readonly isNegative: boolean;
```

The numeric value of this expression is < 0, same as `isLess(0)`

</MemberCard>

<a id="boxedexpression_isnonpositive" name="boxedexpression_isnonpositive"></a>

<MemberCard>

##### BoxedExpression.isNonPositive

```ts
readonly isNonPositive: boolean;
```

The numeric value of this expression is &lt;= 0, same as `isLessEqual(0)`

</MemberCard>

#### Other

<a id="boxedexpression_engine" name="boxedexpression_engine"></a>

<MemberCard>

##### BoxedExpression.engine

```ts
readonly engine: ComputeEngine;
```

The Compute Engine associated with this expression provides
a context in which to interpret it, such as definition of symbols
and functions.

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

<a id="boxedexpression_tolatex" name="boxedexpression_tolatex"></a>

<MemberCard>

##### BoxedExpression.toLatex()

```ts
toLatex(options?): string
```

Serialize to a LaTeX string.

Will ignore any LaTeX metadata.

####### options?

`Partial`\<[`SerializeLatexOptions`](#serializelatexoptions)\>

</MemberCard>

<a id="boxedexpression_verbatimlatex" name="boxedexpression_verbatimlatex"></a>

<MemberCard>

##### BoxedExpression.verbatimLatex?

```ts
optional verbatimLatex: string;
```

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

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_scope" name="boxedexpression_scope"></a>

<MemberCard>

##### BoxedExpression.scope

```ts
readonly scope: RuntimeScope;
```

The scope in which this expression has been defined.

Is `null` when the expression is not canonical.

</MemberCard>

<a id="boxedexpression_latex" name="boxedexpression_latex"></a>

<MemberCard>

##### BoxedExpression.latex

LaTeX representation of this expression.

If the expression was parsed from LaTeX, the LaTeX representation is
the same as the input LaTeX.

To customize the serialization, use `expr.toLatex()`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_tensor" name="boxedexpression_tensor"></a>

<MemberCard>

##### BoxedExpression.tensor

```ts
readonly tensor: TensorData<"expression">;
```

</MemberCard>

<a id="boxedexpression_getsubexpressions" name="boxedexpression_getsubexpressions"></a>

<MemberCard>

##### BoxedExpression.getSubexpressions()

```ts
getSubexpressions(name): readonly BoxedExpression[]
```

All the subexpressions matching the named operator, recursively.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### name

`string`

</MemberCard>

<a id="boxedexpression_subexpressions" name="boxedexpression_subexpressions"></a>

<MemberCard>

##### BoxedExpression.subexpressions

```ts
readonly subexpressions: readonly BoxedExpression[];
```

All the subexpressions in this expression, recursively

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

All the identifiers used in the expression that do not have a value
associated with them, i.e. they are declared but not defined.

</MemberCard>

<a id="boxedexpression_freevariables" name="boxedexpression_freevariables"></a>

<MemberCard>

##### BoxedExpression.freeVariables

```ts
readonly freeVariables: readonly string[];
```

All the identifiers (symbols and functions) in the expression that are
not a local variable or a parameter of that function.

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

A number has a `"Number"`, `"Real"`, `"Rational"` or `"Integer"` operator.

</MemberCard>

<a id="boxedexpression_ispure" name="boxedexpression_ispure"></a>

<MemberCard>

##### BoxedExpression.isPure

```ts
readonly isPure: boolean;
```

If true, the value of the expression never changes and evaluating it has
no side-effects.

If false, the value of the expression may change, if the
value of other expression changes or for other reasons.

If `this.isPure` is `false`, `this.value` is undefined. Call
`this.evaluate()` (or '*this.N()*') to determine the value of the expression instead.

As an example, the `Random` function is not pure.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="boxedexpression_isconstant" name="boxedexpression_isconstant"></a>

<MemberCard>

##### BoxedExpression.isConstant

```ts
readonly isConstant: boolean;
```

`True` if this expression's value remains constant.

If *true* and a function, implies that it is *pure*, and also that all of its arguments are
constant.

Number literals, symbols with constant values, and numeric functions with constant
subexpressions may all be considered *constant*, i.e.:
- `2` is constant
- `Pi` is constant
- `["Add", "Pi", 2]` is constant
- `x` is inconstant: unless declared with a constant value.
- `["Add", "x", 2]` is either constant or inconstant, depending on whether `x` is constant.

</MemberCard>

<a id="boxedexpression_canonical" name="boxedexpression_canonical"></a>

<MemberCard>

##### BoxedExpression.canonical

Return the canonical form of this expression.

If this is a function expression, a definition is associated with the
canonical expression.

When determining the canonical form the following function definition
flags are applied:
- `associative`: \\( f(a, f(b), c) \longrightarrow f(a, b, c) \\)
- `idempotent`: \\( f(f(a)) \longrightarrow f(a) \\)
- `involution`: \\( f(f(a)) \longrightarrow a \\)
- `commutative`: sort the arguments.

If this expression is already canonical, the value of canonical is
`this`.

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

<a id="boxedexpression_subs" name="boxedexpression_subs"></a>

<MemberCard>

##### BoxedExpression.subs()

```ts
subs(sub, options?): BoxedExpression
```

Replace all the symbols in the expression as indicated.

Note the same effect can be achieved with `this.replace()`, but
using `this.subs()` is more efficient, and simpler, but limited
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

The canonical option is applied to each function subexpression after
the substitution is applied.

If no `options.canonical` is set, the result is canonical if `this`
is canonical.

**Default**: `{ canonical: this.isCanonical, recursive: true }`

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

<a id="boxedexpression_numerator-1" name="boxedexpression_numerator-1"></a>

<MemberCard>

##### BoxedExpression.numerator

Return this expression expressed as a numerator and denominator.

</MemberCard>

<a id="boxedexpression_denominator-1" name="boxedexpression_denominator-1"></a>

<MemberCard>

##### BoxedExpression.denominator

</MemberCard>

<a id="boxedexpression_numeratordenominator" name="boxedexpression_numeratordenominator"></a>

<MemberCard>

##### BoxedExpression.numeratorDenominator

</MemberCard>

<a id="boxedexpression_match" name="boxedexpression_match"></a>

<MemberCard>

##### BoxedExpression.match()

```ts
match(pattern, options?): BoxedSubstitution
```

If this expression matches `pattern`, return a substitution that makes
`pattern` equal to `this`. Otherwise return `null`.

If `pattern` includes wildcards (identifiers that start
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

<a id="boxedexpression_isfunctionexpression" name="boxedexpression_isfunctionexpression"></a>

<MemberCard>

##### BoxedExpression.isFunctionExpression

```ts
readonly isFunctionExpression: boolean;
```

Return `true` if this expression is a function expression.

If `true`, `this.ops` is not `null`, and `this.operator` is the name
of the function.

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

<a id="boxedexpression_neg-4" name="boxedexpression_neg-4"></a>

<MemberCard>

##### BoxedExpression.neg()

```ts
neg(): BoxedExpression
```

</MemberCard>

<a id="boxedexpression_inv-1" name="boxedexpression_inv-1"></a>

<MemberCard>

##### BoxedExpression.inv()

```ts
inv(): BoxedExpression
```

</MemberCard>

<a id="boxedexpression_abs-1" name="boxedexpression_abs-1"></a>

<MemberCard>

##### BoxedExpression.abs()

```ts
abs(): BoxedExpression
```

</MemberCard>

<a id="boxedexpression_add-5" name="boxedexpression_add-5"></a>

<MemberCard>

##### BoxedExpression.add()

```ts
add(rhs): BoxedExpression
```

####### rhs

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_sub-4" name="boxedexpression_sub-4"></a>

<MemberCard>

##### BoxedExpression.sub()

```ts
sub(rhs): BoxedExpression
```

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_mul-4" name="boxedexpression_mul-4"></a>

<MemberCard>

##### BoxedExpression.mul()

```ts
mul(rhs): BoxedExpression
```

####### rhs

`number` | [`NumericValue`](#numericvalue) | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_div-4" name="boxedexpression_div-4"></a>

<MemberCard>

##### BoxedExpression.div()

```ts
div(rhs): BoxedExpression
```

####### rhs

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_pow-4" name="boxedexpression_pow-4"></a>

<MemberCard>

##### BoxedExpression.pow()

```ts
pow(exp): BoxedExpression
```

####### exp

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_root-1" name="boxedexpression_root-1"></a>

<MemberCard>

##### BoxedExpression.root()

```ts
root(exp): BoxedExpression
```

####### exp

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_sqrt-1" name="boxedexpression_sqrt-1"></a>

<MemberCard>

##### BoxedExpression.sqrt()

```ts
sqrt(): BoxedExpression
```

</MemberCard>

<a id="boxedexpression_ln-1" name="boxedexpression_ln-1"></a>

<MemberCard>

##### BoxedExpression.ln()

```ts
ln(base?): BoxedExpression
```

####### base?

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_shape-2" name="boxedexpression_shape-2"></a>

<MemberCard>

##### BoxedExpression.shape

```ts
readonly shape: number[];
```

The shape describes the axis of the expression.

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

Return 0 for a scalar, 1 for a vector, 2 for a matrix, > 2 for
a multidimensional matrix.

The rank is equivalent to the length of `expr.shape`

</MemberCard>

<a id="boxedexpression_wikidata" name="boxedexpression_wikidata"></a>

<MemberCard>

##### BoxedExpression.wikidata

```ts
readonly wikidata: string;
```

Wikidata identifier.

:::info[Note]
`undefined` if not a canonical expression.
:::

</MemberCard>

<a id="boxedexpression_description" name="boxedexpression_description"></a>

<MemberCard>

##### BoxedExpression.description

```ts
readonly description: string[];
```

An optional short description if a symbol or function expression.

May include markdown. Each string is a paragraph.

:::info[Note]
`undefined` if not a canonical expression.
:::

</MemberCard>

<a id="boxedexpression_url" name="boxedexpression_url"></a>

<MemberCard>

##### BoxedExpression.url

```ts
readonly url: string;
```

An optional URL pointing to more information about the symbol or
 function operator.

:::info[Note]
`undefined` if not a canonical expression.
:::

</MemberCard>

<a id="boxedexpression_complexity" name="boxedexpression_complexity"></a>

<MemberCard>

##### BoxedExpression.complexity

```ts
readonly complexity: number;
```

Expressions with a higher complexity score are sorted
first in commutative functions

:::info[Note]
`undefined` if not a canonical expression.
:::

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

:::info[Note]
For a symbol, always binds - potentially creating - a definition. For `BoxedFunctions`, will
return `undefined` if not canonical.
:::

</MemberCard>

<a id="boxedexpression_functiondefinition" name="boxedexpression_functiondefinition"></a>

<MemberCard>

##### BoxedExpression.functionDefinition

```ts
readonly functionDefinition: BoxedFunctionDefinition;
```

For functions, a definition associated with the expression.

:::info[Note]
`undefined` if not a canonical expression or not a function.
:::

</MemberCard>

<a id="boxedexpression_symboldefinition" name="boxedexpression_symboldefinition"></a>

<MemberCard>

##### BoxedExpression.symbolDefinition

```ts
readonly symbolDefinition: BoxedSymbolDefinition;
```

For symbols, a definition associated with the expression.

Bind the expression to a definition, if not already bound.

Return `undefined` if not a symbol

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

A pure expression always return the same value and has no side effects.
If `expr.isPure` is `true`, `expr.value` and `expr.evaluate()` are
synonyms.

For an impure expression, `expr.value` is undefined.

Evaluating an impure expression may have some side effects, for
example modifying the `ComputeEngine` environment, such as its set of
assumptions.

The result may be a rational number or the product of a rational number
and the square root of an integer.

To perform approximate calculations, use `expr.N()` instead,
or set `options.numericApproximation` to `true`.

The result of `expr.evaluate()` may be the same as `expr.simplify()`.

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
compile(options?): (args?) => CompiledType
```

Compile the expression to a JavaScript function.

The function takes an object as argument, with the keys being the
symbols in the expression, and returns the value of the expression.

```javascript
const expr = ce.parse('x^2 + y^2');
const f = expr.compile();
console.log(f({x: 2, y: 3}));
```

####### options?

####### to

`"javascript"`

####### optimize

(`"evaluate"` \| `"simplify"`)[]

####### functions

`Record`\<`string`, `string` \| (...`any`) => `any`\>

####### vars

`Record`\<`string`, [`CompiledType`](#compiledtype)\>

####### imports

`unknown`[]

####### preamble

`string`

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
const expr = ce.parse('x^2 + 2*x + 1 = 0');
console.log(expr.solve('x'));
```

####### vars?

`string` | `Iterable`\<`string`\> | [`BoxedExpression`](#boxedexpression) | `Iterable`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="boxedexpression_value" name="boxedexpression_value"></a>

<MemberCard>

##### BoxedExpression.value

```ts
get value(): string | number | boolean | object
set value(value: 
  | string
  | number
  | boolean
  | number[]
  | Decimal
  | BoxedExpression
  | {
  re: number;
  im: number;
 }
  | {
  num: number;
  denom: number;
 }): void
```

Return a JavaScript primitive representing the value of this expression.

Equivalent to `expr.N().valueOf()`.

For functions, will only return non-undefined (i.e., compute the value) if the function is pure.

For symbols, the current behaviour also considers *non-constant* values, including those weakly
assigned via symbol assumptions.

**note**: this property is not guaranteed to remain constant, potentially differing across
subsequent calls if a symbol (non-constant), or an *inconstant* pure function.

Set the value of this expression (applicable only to `BoxedSymbol`).

Will throw a runtime error if either not a BoxedSymbol, or if a symbol expression which is
non-variable/constant.

Setting the value of a symbol results in the forgetting of all assumptions about it in the
current scope.

</MemberCard>

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
  | MapType
  | TupleType
  | FunctionSignature
  | ValueType
  | TypeReference
  | BoxedType): void
```

The type of the value of this expression.

If a function expression, the type of the value of the function
(the result type).

If a symbol the type of the value of the symbol.

:::info[Note]
If not valid, return `"error"`.
If non-canonical, return `undefined`.
If the type is not known, return `"unknown"`.
If a symbol with a 'function' definition, returns the 'signature' type.
:::

</MemberCard>

<a id="boxedexpression_iscollection" name="boxedexpression_iscollection"></a>

<MemberCard>

##### BoxedExpression.isCollection

```ts
isCollection: boolean;
```

Return true if the expression is a collection: a list, a vector, a matrix, a map, a tuple,
etc...

For symbols, this check involves binding to a definition, if not already canonical.

</MemberCard>

<a id="boxedexpression_contains" name="boxedexpression_contains"></a>

<MemberCard>

##### BoxedExpression.contains()

```ts
contains(rhs): boolean
```

If this is a collection, return true if the `rhs` expression is in the
collection.

Return `undefined` if the membership cannot be determined.

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_size" name="boxedexpression_size"></a>

<MemberCard>

##### BoxedExpression.size

If this is a collection, return the number of elements in the collection.

If the collection is infinite, return `Infinity`.

</MemberCard>

<a id="boxedexpression_each" name="boxedexpression_each"></a>

<MemberCard>

##### BoxedExpression.each()

```ts
each: (start?, count?) => Iterator<BoxedExpression, undefined>;
```

If this is a collection, return an iterator over the elements of the collection.

If `start` is not specified, start from the first element.

If `count` is not specified or negative, return all the elements from `start` to the end.

```js
const expr = ce.parse('[1, 2, 3, 4]');
for (const e of expr.each()) {
 console.log(e);
}
```

</MemberCard>

<a id="boxedexpression_at-1" name="boxedexpression_at-1"></a>

<MemberCard>

##### BoxedExpression.at()

```ts
at(index): BoxedExpression
```

If this is an indexable collection, return the element at the specified
 index.

If the index is negative, return the element at index `size() + index + 1`.

####### index

`number`

</MemberCard>

<a id="boxedexpression_get" name="boxedexpression_get"></a>

<MemberCard>

##### BoxedExpression.get()

```ts
get(key): BoxedExpression
```

If this is a map or a tuple, return the value of the corresponding key.

If `key` is a `BoxedExpression`, it should be a string.

####### key

`string` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_indexof" name="boxedexpression_indexof"></a>

<MemberCard>

##### BoxedExpression.indexOf()

```ts
indexOf(expr): number
```

If this is an indexable collection, return the index of the first element
that matches the target expression.

####### expr

[`BoxedExpression`](#boxedexpression)

</MemberCard>

#### Primitive Methods

<a id="boxedexpression_valueof-2" name="boxedexpression_valueof-2"></a>

<MemberCard>

##### BoxedExpression.valueOf()

```ts
valueOf(): any
```

From `Object.valueOf()`, return a primitive value for the expression.

If the expression is a machine number, or bignum or rational that can be
converted to a machine number, return a JavaScript `number`.

If the expression is a symbol, return the name of the symbol as a `string`.

Otherwise return a JavaScript primitive representation of the expression.

</MemberCard>

<a id="boxedexpression_tostring-1" name="boxedexpression_tostring-1"></a>

<MemberCard>

##### BoxedExpression.toString()

```ts
toString(): string
```

From `Object.toString()`, return a string representation of the
 expression. This string is suitable to be output to the console
for debugging, for example. It is formatted as a ASCIIMath expression.

To get a LaTeX representation of the expression, use `expr.latex`.

Used when coercing a `BoxedExpression` to a `String`.

</MemberCard>

<a id="boxedexpression_print-1" name="boxedexpression_print-1"></a>

<MemberCard>

##### BoxedExpression.print()

```ts
print(): void
```

Output to the console a string representation of the expression.

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

<a id="boxedexpression_tojson-2" name="boxedexpression_tojson-2"></a>

<MemberCard>

##### BoxedExpression.toJSON()

```ts
toJSON(): Expression
```

Used by `JSON.stringify()` to serialize this object to JSON.

Method version of `expr.json`.

</MemberCard>

<a id="boxedexpression_is-1" name="boxedexpression_is-1"></a>

<MemberCard>

##### BoxedExpression.is()

```ts
is(rhs): boolean
```

Equivalent to `BoxedExpression.isSame()` but the argument can be
a JavaScript primitive. For example, `expr.is(2)` is equivalent to
`expr.isSame(ce.number(2))`.

####### rhs

`any`

</MemberCard>

#### Relational Operator

<a id="boxedexpression_issame" name="boxedexpression_issame"></a>

<MemberCard>

##### BoxedExpression.isSame()

```ts
isSame(rhs): boolean
```

Structural/symbolic equality (weak equality).

`ce.parse('1+x').isSame(ce.parse('x+1'))` is `false`.

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

If the expressions cannot be compared, return `undefined`

The numeric value of both expressions are compared.

The expressions are evaluated before being compared, which may be
expensive.

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_islessequal" name="boxedexpression_islessequal"></a>

<MemberCard>

##### BoxedExpression.isLessEqual()

```ts
isLessEqual(other): boolean
```

The numeric value of both expressions are compared.

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_isgreater" name="boxedexpression_isgreater"></a>

<MemberCard>

##### BoxedExpression.isGreater()

```ts
isGreater(other): boolean
```

The numeric value of both expressions are compared.

####### other

`number` | [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedexpression_isgreaterequal" name="boxedexpression_isgreaterequal"></a>

<MemberCard>

##### BoxedExpression.isGreaterEqual()

```ts
isGreaterEqual(other): boolean
```

The numeric value of both expressions are compared.

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

The evaluations may be expensive operations. Other options to consider
to compare two expressions include:
- `expr.isSame(other)` for a structural comparison
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

<a id="boxedexpression_string" name="boxedexpression_string"></a>

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

<a id="boxedexpression_isvalid" name="boxedexpression_isvalid"></a>

<MemberCard>

##### BoxedExpression.isValid

```ts
readonly isValid: boolean;
```

`true` if this expression or any of its subexpressions is an `["Error"]`
expression.

:::info[Note]
Applicable to canonical and non-canonical expressions. For
non-canonical expression, this may indicate a syntax error while parsing
LaTeX. For canonical expression, this may indicate argument type
mismatch, or missing or unexpected arguments.
:::

</MemberCard>

#### Type Properties

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
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  | MathJsonFunction
  | readonly [MathJsonIdentifier, ...SemiBoxedExpression[]]
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
until no rules apply, up to `maxIterations` times.

Note that if `once` is true, `iterationLimit` has no effect.

**Default**: `1`

<a id="replaceoptions_canonical-1" name="replaceoptions_canonical-1"></a>

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

<a id="evaluateoptions" name="evaluateoptions"></a>

<MemberCard>

### EvaluateOptions

```ts
type EvaluateOptions = {
  numericApproximation: boolean;
  signal: AbortSignal;
};
```

Options for `BoxedExpression.evaluate()`

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

<a id="metadata-1" name="metadata-1"></a>

<MemberCard>

### Metadata

```ts
type Metadata = {
  latex: string;
  wikidata: string;
};
```

Metadata that can be associated with a `BoxedExpression`

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

<a id="expressionmapinterfaceu" name="expressionmapinterfaceu"></a>

### ExpressionMapInterface\<U\>

<a id="expressionmapinterfaceu_has-1" name="expressionmapinterfaceu_has-1"></a>

<MemberCard>

##### ExpressionMapInterface.has()

```ts
has(expr): boolean
```

####### expr

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="expressionmapinterfaceu_get-1" name="expressionmapinterfaceu_get-1"></a>

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

<a id="expressionmapinterfaceu_iterator" name="expressionmapinterfaceu_iterator"></a>

<MemberCard>

##### ExpressionMapInterface.\[iterator\]()

```ts
iterator: IterableIterator<[BoxedExpression, U]>
```

</MemberCard>

<a id="expressionmapinterfaceu_entries" name="expressionmapinterfaceu_entries"></a>

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

<a id="symboldefinition-1" name="symboldefinition-1"></a>

<MemberCard>

### SymbolDefinition

```ts
type SymbolDefinition = BaseDefinition & Partial<SymbolAttributes> & {
  type:   | Type
     | TypeString;
  inferred: boolean;
  value:   | LatexString
     | SemiBoxedExpression
     | (ce) => BoxedExpression | null;
  flags: Partial<NumericFlags>;
  eq: (a) => boolean | undefined;
  neq: (a) => boolean | undefined;
  cmp: (a) => "=" | ">" | "<" | undefined;
  collection: Partial<CollectionHandlers>;
};
```

A bound symbol (i.e. one with an associated definition) has either a type
(e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... type = 'real')

#### SymbolDefinition.inferred?

```ts
optional inferred: boolean;
```

If true, the type is inferred, and could be adjusted later
as more information becomes available or if the symbol is explicitly
declared.

#### SymbolDefinition.value?

```ts
optional value: 
  | LatexString
  | SemiBoxedExpression
  | (ce) => BoxedExpression | null;
```

`value` can be a JS function since for some constants, such as
`Pi`, the actual value depends on the `precision` setting of the
`ComputeEngine` and possible other environment settings

</MemberCard>

<a id="functiondefinition-1" name="functiondefinition-1"></a>

<MemberCard>

### FunctionDefinition

```ts
type FunctionDefinition = BaseDefinition & Partial<FunctionDefinitionFlags> & {
  signature:   | Type
     | TypeString
     | BoxedType;
  type: (ops, options) => 
     | Type
     | TypeString
     | BoxedType
     | undefined;
  sgn: (ops, options) => Sign | undefined;
  even: (ops, options) => boolean | undefined;
  complexity: number;
  canonical: (ops, options) => BoxedExpression | null;
  evaluate:   | (ops, options) => BoxedExpression | undefined
     | BoxedExpression;
  evaluateAsync: (ops, options) => Promise<BoxedExpression | undefined>;
  evalDimension: (args, options) => BoxedExpression;
  compile: (expr) => CompiledExpression;
  eq: (a, b) => boolean | undefined;
  neq: (a, b) => boolean | undefined;
  collection: Partial<CollectionHandlers>;
};
```

Definition record for a function.

#### FunctionDefinition.signature?

```ts
optional signature: 
  | Type
  | TypeString
  | BoxedType;
```

The function signature.

If a `type` handler is provided, the return type of the function should
be a subtype of the return type in the signature.

#### FunctionDefinition.type()?

```ts
optional type: (ops, options) => 
  | Type
  | TypeString
  | BoxedType
  | undefined;
```

The actual type of the result based on the arguments.

Should be a subtype of the type indicated in the signature.

Do not evaluate the arguments.

The type of the arguments can be used to determine the type of the
result.

#### FunctionDefinition.sgn()?

```ts
optional sgn: (ops, options) => Sign | undefined;
```

Return the sign of the function expression.

If the sign cannot be determined, return `undefined`.

When determining the sign, only literal values and the values of
symbols, if they are literals, should be considered.

Do not evaluate the arguments.

The type and sign of the arguments can be used to determine the sign.

#### FunctionDefinition.even()?

```ts
optional even: (ops, options) => boolean | undefined;
```

Return true of the function expression is even, false if it is odd and
undefined if it is neither.

#### FunctionDefinition.complexity?

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

#### FunctionDefinition.canonical()?

```ts
optional canonical: (ops, options) => BoxedExpression | null;
```

Return the canonical form of the expression with the arguments `args`.

The arguments (`args`) may not be in canonical form. If necessary, they
can be put in canonical form.

This handler should validate the type and number of the arguments.

If a required argument is missing, it should be indicated with a
`["Error", "'missing"]` expression. If more arguments than expected
are present, this should be indicated with an
["Error", "'unexpected-argument'"]` error expression

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

If the arguments do not match, they should be replaced with an appropriate
`["Error"]` expression. If the expression cannot be put in canonical form,
the handler should return `null`.

#### FunctionDefinition.evaluate?

```ts
optional evaluate: 
  | (ops, options) => BoxedExpression | undefined
  | BoxedExpression;
```

Evaluate a function expression.

The arguments have been evaluated, except the arguments to which a
`hold` applied.

It is not necessary to further simplify or evaluate the arguments.

If performing numerical calculations and `options.numericalApproximation`
is `false` return an exact numeric value, for example return a rational
number or a square root, rather than a floating point approximation.
Use `ce.number()` to create the numeric value.

When `numericalApproximation` is `false`, return a floating point number:
- do not reduce rational numbers to decimal (floating point approximation)
- do not reduce square roots of rational numbers

If the expression cannot be evaluated, due to the values, types, or
assumptions about its arguments, for example, return `undefined` or
an `["Error"]` expression.

#### FunctionDefinition.evaluateAsync()?

```ts
optional evaluateAsync: (ops, options) => Promise<BoxedExpression | undefined>;
```

An option asynchronous version of `evaluate`.

#### FunctionDefinition.evalDimension()?

```ts
optional evalDimension: (args, options) => BoxedExpression;
```

**`Experimental`**

Dimensional analysis

#### FunctionDefinition.compile()?

```ts
optional compile: (expr) => CompiledExpression;
```

Return a compiled (optimized) expression.

</MemberCard>

<a id="basedefinition-1" name="basedefinition-1"></a>

<MemberCard>

### BaseDefinition

```ts
type BaseDefinition = {
  description: string | string[];
  url: string;
  wikidata: string;
};
```

<a id="basedefinition-1_description-2" name="basedefinition-1_description-2"></a>

#### BaseDefinition.description?

```ts
optional description: string | string[];
```

A short (about 1 line) description. May contain Markdown.

<a id="basedefinition-1_url-2" name="basedefinition-1_url-2"></a>

#### BaseDefinition.url?

```ts
optional url: string;
```

A URL pointing to more information about this symbol or operator.

<a id="basedefinition-1_wikidata-2" name="basedefinition-1_wikidata-2"></a>

#### BaseDefinition.wikidata?

```ts
optional wikidata: string;
```

A short string representing an entry in a wikibase.

For example `Q167` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
for the `Pi` constant.

</MemberCard>

<a id="identifierdefinition" name="identifierdefinition"></a>

<MemberCard>

### IdentifierDefinition

```ts
type IdentifierDefinition = OneOf<[SymbolDefinition, FunctionDefinition, SemiBoxedExpression]>;
```

A table mapping identifiers to their definition.

Identifiers should be valid MathJSON identifiers. In addition, the
following rules are recommended:

- Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
- The first character should be a letter: `/^[a-zA-Z]/`
- Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`

</MemberCard>

<a id="identifierdefinitions" name="identifierdefinitions"></a>

<MemberCard>

### IdentifierDefinitions

```ts
type IdentifierDefinitions = Readonly<{}>;
```

</MemberCard>

<a id="numericflags" name="numericflags"></a>

<MemberCard>

### NumericFlags

```ts
type NumericFlags = {
  sgn: Sign | undefined;
  even: boolean | undefined;
  odd: boolean | undefined;
};
```

When used in a `SymbolDefinition` or `Functiondefinition` these flags
provide additional information about the value of the symbol or function.

If provided, they will override the value derived from
the symbol's value.

</MemberCard>

<a id="collectionhandlers" name="collectionhandlers"></a>

<MemberCard>

### CollectionHandlers

```ts
type CollectionHandlers = {
  size: (collection) => number;
  contains: (collection, target) => boolean;
  iterator: (collection, start?, count?) => Iterator<BoxedExpression, undefined>;
  at: (collection, index) => undefined | BoxedExpression;
  keys: (collection) => undefined | Iterable<string>;
  indexOf: (collection, target, from?) => number | undefined;
  subsetOf: (collection, target, strict) => boolean;
  eltsgn: (collection) => Sign | undefined;
  elttype: (collection) => Type | undefined;
};
```

These handlers are the primitive operations that can be performed on
collections.

There are two types of collections:

- finite collections, such as lists, tuples, sets, matrices, etc...
 The `size()` handler of finite collections returns the number of elements

- infinite collections, such as sequences, ranges, etc...
 The `size()` handler of infinite collections returns `Infinity`
 Infinite collections are not indexable: they have no `at()` handler.

#### Definitions

<a id="collectionhandlers_iterator-1" name="collectionhandlers_iterator-1"></a>

##### CollectionHandlers.iterator()

```ts
iterator: (collection, start?, count?) => Iterator<BoxedExpression, undefined>;
```

Return an iterator
- start is optional and is a 1-based index.
- if start is not specified, start from index 1
- count is optional and is the number of elements to return
- if count is not specified or negative, return all the elements from
  start to the end

If there is a `keys()` handler, there is no `iterator()` handler.

#### Other

<a id="collectionhandlers_size-1" name="collectionhandlers_size-1"></a>

##### CollectionHandlers.size()

```ts
size: (collection) => number;
```

Return the number of elements in the collection.

An empty collection has a size of 0.

<a id="collectionhandlers_contains-1" name="collectionhandlers_contains-1"></a>

##### CollectionHandlers.contains()

```ts
contains: (collection, target) => boolean;
```

Return `true` if the target
expression is in the collection, `false` otherwise.

<a id="collectionhandlers_at-2" name="collectionhandlers_at-2"></a>

##### CollectionHandlers.at()

```ts
at: (collection, index) => undefined | BoxedExpression;
```

Return the element at the specified index.

The first element is `at(1)`, the last element is `at(-1)`.

If the index is &lt;0, return the element at index `size() + index + 1`.

The index can also be a string for example for maps. The set of valid keys
is returned by the `keys()` handler.

If the index is invalid, return `undefined`.

<a id="collectionhandlers_keys" name="collectionhandlers_keys"></a>

##### CollectionHandlers.keys()

```ts
keys: (collection) => undefined | Iterable<string>;
```

If the collection can be indexed by strings, return the valid values
for the index.

<a id="collectionhandlers_indexof-1" name="collectionhandlers_indexof-1"></a>

##### CollectionHandlers.indexOf()

```ts
indexOf: (collection, target, from?) => number | undefined;
```

Return the index of the first element that matches the target expression.

The comparison is done using the `target.isEqual()` method.

If the expression is not found, return `undefined`.

If the expression is found, return the index, 1-based.

Return the index of the first match.

`from` is the starting index for the search. If negative, start from
the end  and search backwards.

<a id="collectionhandlers_subsetof" name="collectionhandlers_subsetof"></a>

##### CollectionHandlers.subsetOf()

```ts
subsetOf: (collection, target, strict) => boolean;
```

Return `true` if all the elements of `target` are in `expr`.
Both `expr` and `target` are collections.
If strict is `true`, the subset must be strict, that is, `expr` must
have more elements than `target`.

<a id="collectionhandlers_eltsgn" name="collectionhandlers_eltsgn"></a>

##### CollectionHandlers.eltsgn()

```ts
eltsgn: (collection) => Sign | undefined;
```

Return the sign of all the elements of the collection.

<a id="collectionhandlers_elttype" name="collectionhandlers_elttype"></a>

##### CollectionHandlers.elttype()

```ts
elttype: (collection) => Type | undefined;
```

Return the widest type of all the elements in the collection

</MemberCard>

<a id="boxedbasedefinition" name="boxedbasedefinition"></a>

### BoxedBaseDefinition

#### Extended by

- [`BoxedSymbolDefinition`](#boxedsymboldefinition)

<a id="boxedbasedefinition_name" name="boxedbasedefinition_name"></a>

<MemberCard>

##### BoxedBaseDefinition.name

```ts
name: string;
```

</MemberCard>

<a id="boxedbasedefinition_wikidata-1" name="boxedbasedefinition_wikidata-1"></a>

<MemberCard>

##### BoxedBaseDefinition.wikidata?

```ts
optional wikidata: string;
```

</MemberCard>

<a id="boxedbasedefinition_description-1" name="boxedbasedefinition_description-1"></a>

<MemberCard>

##### BoxedBaseDefinition.description?

```ts
optional description: string | string[];
```

</MemberCard>

<a id="boxedbasedefinition_url-1" name="boxedbasedefinition_url-1"></a>

<MemberCard>

##### BoxedBaseDefinition.url?

```ts
optional url: string;
```

</MemberCard>

<a id="boxedbasedefinition_scope-1" name="boxedbasedefinition_scope-1"></a>

<MemberCard>

##### BoxedBaseDefinition.scope

```ts
scope: RuntimeScope;
```

The scope this definition belongs to.

This field is usually undefined, but its value is set by `getDefinition()`

</MemberCard>

<a id="boxedbasedefinition_collection" name="boxedbasedefinition_collection"></a>

<MemberCard>

##### BoxedBaseDefinition.collection?

```ts
optional collection: Partial<CollectionHandlers>;
```

If this is the definition of a collection, the set of primitive operations
that can be performed on this collection (counting the number of elements,
enumerating it, etc...).

</MemberCard>

<a id="boxedbasedefinition_reset" name="boxedbasedefinition_reset"></a>

<MemberCard>

##### BoxedBaseDefinition.reset()

```ts
reset(): void
```

When the environment changes, for example the numerical precision,
call `reset()` so that any cached values can be recalculated.

</MemberCard>

<a id="symbolattributes" name="symbolattributes"></a>

<MemberCard>

### SymbolAttributes

```ts
type SymbolAttributes = {
  constant: boolean;
  holdUntil: "never" | "evaluate" | "N";
};
```

<a id="symbolattributes_constant" name="symbolattributes_constant"></a>

#### SymbolAttributes.constant

```ts
constant: boolean;
```

If `true` the value of the symbol is constant. The value or type of
symbols with this attribute set to `true` cannot be changed.

If `false`, the symbol is a variable.

**Default**: `false`

<a id="symbolattributes_holduntil" name="symbolattributes_holduntil"></a>

#### SymbolAttributes.holdUntil

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

<a id="boxedsymboldefinition" name="boxedsymboldefinition"></a>

### BoxedSymbolDefinition

#### Extends

- [`BoxedBaseDefinition`](#boxedbasedefinition).[`SymbolAttributes`](#symbolattributes).`Partial`\<[`NumericFlags`](#numericflags)\>

<a id="boxedsymboldefinition_isfunction" name="boxedsymboldefinition_isfunction"></a>

<MemberCard>

##### BoxedSymbolDefinition.isFunction

```ts
readonly isFunction: boolean;
```

</MemberCard>

<a id="boxedsymboldefinition_isconstant-1" name="boxedsymboldefinition_isconstant-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.isConstant

```ts
readonly isConstant: boolean;
```

</MemberCard>

<a id="boxedsymboldefinition_eq-2" name="boxedsymboldefinition_eq-2"></a>

<MemberCard>

##### BoxedSymbolDefinition.eq()?

```ts
optional eq: (a) => boolean;
```

</MemberCard>

<a id="boxedsymboldefinition_neq-1" name="boxedsymboldefinition_neq-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.neq()?

```ts
optional neq: (a) => boolean;
```

</MemberCard>

<a id="boxedsymboldefinition_cmp" name="boxedsymboldefinition_cmp"></a>

<MemberCard>

##### BoxedSymbolDefinition.cmp()?

```ts
optional cmp: (a) => ">" | "<" | "=";
```

</MemberCard>

<a id="boxedsymboldefinition_inferredtype" name="boxedsymboldefinition_inferredtype"></a>

<MemberCard>

##### BoxedSymbolDefinition.inferredType

```ts
inferredType: boolean;
```

</MemberCard>

<a id="boxedsymboldefinition_type-3" name="boxedsymboldefinition_type-3"></a>

<MemberCard>

##### BoxedSymbolDefinition.type

```ts
type: BoxedType;
```

</MemberCard>

<a id="boxedsymboldefinition_value-1" name="boxedsymboldefinition_value-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.value

```ts
get value(): BoxedExpression
set value(val: number | BoxedExpression): void
```

</MemberCard>

<a id="functiondefinitionflags" name="functiondefinitionflags"></a>

<MemberCard>

### FunctionDefinitionFlags

```ts
type FunctionDefinitionFlags = {
  lazy: boolean;
  threadable: boolean;
  associative: boolean;
  commutative: boolean;
  commutativeOrder: (a, b) => number | undefined;
  idempotent: boolean;
  involution: boolean;
  pure: boolean;
};
```

A function definition can have some flags to indicate specific
properties of the function.

<a id="functiondefinitionflags_lazy" name="functiondefinitionflags_lazy"></a>

#### FunctionDefinitionFlags.lazy

```ts
lazy: boolean;
```

If `true`, the arguments to this function are not automatically
evaluated. The default is `false` (the arguments are evaluated).

This can be useful for example for functions that take symbolic
expressions as arguments, such as `D` or `Integrate`.

This is also useful for functions that take an argument that is
potentially an infinite collection.

It will be up to the `evaluate()` handler to evaluate the arguments as
needed. This is conveninent to pass symbolic expressions as arguments
to functions without having to explicitly use a `Hold` expression.

This also applies to the `canonical()` handler.

<a id="functiondefinitionflags_threadable" name="functiondefinitionflags_threadable"></a>

#### FunctionDefinitionFlags.threadable

```ts
threadable: boolean;
```

If `true`, the function is applied element by element to lists, matrices
(`["List"]` or `["Tuple"]` expressions) and equations (relational
operators).

**Default**: `false`

<a id="functiondefinitionflags_associative" name="functiondefinitionflags_associative"></a>

#### FunctionDefinitionFlags.associative

```ts
associative: boolean;
```

If `true`, `["f", ["f", a], b]` simplifies to `["f", a, b]`

**Default**: `false`

<a id="functiondefinitionflags_commutative" name="functiondefinitionflags_commutative"></a>

#### FunctionDefinitionFlags.commutative

```ts
commutative: boolean;
```

If `true`, `["f", a, b]` equals `["f", b, a]`. The canonical
version of the function will order the arguments.

**Default**: `false`

<a id="functiondefinitionflags_commutativeorder" name="functiondefinitionflags_commutativeorder"></a>

#### FunctionDefinitionFlags.commutativeOrder

```ts
commutativeOrder: (a, b) => number | undefined;
```

If `commutative` is `true`, the order of the arguments is determined by
this function.

If the function is not provided, the arguments are ordered by the
default order of the arguments.

<a id="functiondefinitionflags_idempotent" name="functiondefinitionflags_idempotent"></a>

#### FunctionDefinitionFlags.idempotent

```ts
idempotent: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `["f", x]`.

**Default**: `false`

<a id="functiondefinitionflags_involution" name="functiondefinitionflags_involution"></a>

#### FunctionDefinitionFlags.involution

```ts
involution: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `x`.

**Default**: `false`

<a id="functiondefinitionflags_pure" name="functiondefinitionflags_pure"></a>

#### FunctionDefinitionFlags.pure

```ts
pure: boolean;
```

If `true`, the value of this function is always the same for a given
set of arguments and it has no side effects.

An expression using this function is pure if the function and all its
arguments are pure.

For example `Sin` is pure, `Random` isn't.

This information may be used to cache the value of expressions.

**Default:** `true`

</MemberCard>

<a id="boxedfunctiondefinition" name="boxedfunctiondefinition"></a>

<MemberCard>

### BoxedFunctionDefinition

```ts
type BoxedFunctionDefinition = BoxedBaseDefinition & FunctionDefinitionFlags & {
  complexity: number;
  inferredSignature: boolean;
  signature: BoxedType;
  type: (ops, options) => 
     | Type
     | TypeString
     | BoxedType
     | undefined;
  sgn: (ops, options) => Sign | undefined;
  eq: (a, b) => boolean | undefined;
  neq: (a, b) => boolean | undefined;
  canonical: (ops, options) => BoxedExpression | null;
  evaluate: (ops, options) => BoxedExpression | undefined;
  evaluateAsync: (ops, options?) => Promise<BoxedExpression | undefined>;
  evalDimension: (ops, options) => BoxedExpression;
  compile: (expr) => CompiledExpression;
};
```

#### BoxedFunctionDefinition.inferredSignature

```ts
inferredSignature: boolean;
```

If true, the signature was inferred from usage and may be modified
as more information becomes available.

#### BoxedFunctionDefinition.signature

```ts
signature: BoxedType;
```

The type of the arguments and return value of this function

#### BoxedFunctionDefinition.type()?

```ts
optional type: (ops, options) => 
  | Type
  | TypeString
  | BoxedType
  | undefined;
```

If present, this handler can be used to more precisely determine the
return type based on the type of the arguments. The arguments themselves
should *not* be evaluated, only their types should be used.

#### BoxedFunctionDefinition.sgn()?

```ts
optional sgn: (ops, options) => Sign | undefined;
```

If present, this handler can be used to determine the sign of the
 return value of the function, based on the sign and type of its
 arguments.

The arguments themselves should *not* be evaluated, only their types and
sign should be used.

This can be used in some case for example to determine when certain
simplifications are valid.

</MemberCard>

<a id="runtimeidentifierdefinitions" name="runtimeidentifierdefinitions"></a>

<MemberCard>

### RuntimeIdentifierDefinitions

```ts
type RuntimeIdentifierDefinitions = Map<string, OneOf<[BoxedSymbolDefinition, BoxedFunctionDefinition]>>;
```

The entries have been validated and optimized for faster evaluation.

When a new scope is created with `pushScope()` or when creating a new
engine instance, new instances of this type are created as needed.

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
  identifierTrigger: MathJsonIdentifier;
};
```

A trigger is the set of tokens that will make an entry in the
LaTeX dictionary eligible to parse the stream and generate an expression.
If the trigger matches, the `parse` handler is called, if available.

The trigger can be specified either as a LaTeX string (`latexTrigger`) or
as an identifier (`identifierTrigger`). An identifier match several
LaTeEx expressions that are equivalent, for example `\operatorname{gcd}` or
 `\mathbin{gcd}`, match the `"gcd"` identifier

`matchfix` operators use `openTrigger` and `closeTrigger` instead.

</MemberCard>

<a id="baseentry" name="baseentry"></a>

<MemberCard>

### BaseEntry

```ts
type BaseEntry = {
  name: MathJsonIdentifier;
  serialize:   | LatexString
     | SerializeHandler;
};
```

Maps a string of LaTeX tokens to a function or symbol and vice-versa.

<a id="baseentry_name-2" name="baseentry_name-2"></a>

#### BaseEntry.name?

```ts
optional name: MathJsonIdentifier;
```

Map a MathJSON identifier to this entry.

Each entry should have at least a `name` or a `parse` handler.

An entry with no `name` cannot be serialized: the `name` is used to map
a MathJSON function or symbol name to the appropriate entry for
serializing.

However, an entry with no `name` can be used to define a synonym (for
example for the symbol `\varnothing` which is a synonym for `\emptyset`).

If no `parse` handler is provided, only the trigger is used to select this
entry. Otherwise, if the trigger of the entry matches the current
token, the `parse` handler is invoked.

<a id="baseentry_serialize-2" name="baseentry_serialize-2"></a>

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
  identifierTrigger: MathJsonIdentifier;
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

A function is an identifier followed by:
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
  getIdentifierType: (identifier) => SymbolType;
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

#### ParseLatexOptions.getIdentifierType()

```ts
getIdentifierType: (identifier) => SymbolType;
```

This handler is invoked when the parser encounters an identifier
that has not yet been declared.

The `identifier` argument is a [valid identifier](#identifiers).

The handler can return:

- `"variable"`: the identifier is a variable
- `"function"`: the identifier is a function name. If an apply
function operator (typically, parentheses) follow, they will be parsed
as arguments to the function.

- `"unknown"`: the identifier is not recognized.

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

<a id="parser_getidentifiertype" name="parser_getidentifiertype"></a>

<MemberCard>

##### Parser.getIdentifierType()

```ts
getIdentifierType(id): SymbolType
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

[`SymbolType`](#symboltype)

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

<a id="parser_matchchar" name="parser_matchchar"></a>

<MemberCard>

##### Parser.matchChar()

```ts
matchChar(): string
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
- a single-letter identifier: `x`
- a single LaTeX command: `\pi`
- a multi-letter identifier: `\operatorname{speed}`

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

<a id="serializer_dictionary" name="serializer_dictionary"></a>

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

[`IndexedLatexDictionaryEntry`](#indexedlatexdictionaryentry)

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
  | "real-not-zero"
  | "real"
  | "nan"
  | "positive-infinity"
  | "negative-infinity"
  | "complex-infinity"
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
readonly im: number;
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

Object.valueOf(): returns a primitive value

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

<a id="commonentry" name="commonentry"></a>

<MemberCard>

### CommonEntry

```ts
type CommonEntry = {
  name: string;
  serialize: SerializeHandler;
  latexTrigger: LatexString;
  identifierTrigger: string;
};
```

<a id="commonentry_name-1" name="commonentry_name-1"></a>

#### CommonEntry.name?

```ts
optional name: string;
```

Note: a name is required if a serialize handler is provided

<a id="commonentry_latextrigger" name="commonentry_latextrigger"></a>

#### CommonEntry.latexTrigger?

```ts
optional latexTrigger: LatexString;
```

Note: not all kinds have a `latexTrigger` or `identifierTrigger`.
For example, matchfix operators use `openTrigger`/`closeTrigger`

</MemberCard>

<a id="indexedsymbolentry" name="indexedsymbolentry"></a>

<MemberCard>

### IndexedSymbolEntry

```ts
type IndexedSymbolEntry = CommonEntry & {
  kind: "symbol";
  precedence: Precedence;
  parse: ExpressionParseHandler;
};
```

</MemberCard>

<a id="indexedexpressionentry" name="indexedexpressionentry"></a>

<MemberCard>

### IndexedExpressionEntry

```ts
type IndexedExpressionEntry = CommonEntry & {
  kind: "expression";
  precedence: Precedence;
  parse: ExpressionParseHandler;
};
```

</MemberCard>

<a id="indexedfunctionentry" name="indexedfunctionentry"></a>

<MemberCard>

### IndexedFunctionEntry

```ts
type IndexedFunctionEntry = CommonEntry & {
  kind: "function";
  parse: ExpressionParseHandler;
};
```

A function has the following form:
- a prefix such as `\mathrm` or `\operatorname`
- a trigger string, such as `gcd`
- some postfix operators such as `\prime`
- an optional list of arguments in an enclosure (parentheses)

Functions of this type are indexed in the dictionary by their trigger string.

</MemberCard>

<a id="indexedmatchfixentry" name="indexedmatchfixentry"></a>

<MemberCard>

### IndexedMatchfixEntry

```ts
type IndexedMatchfixEntry = CommonEntry & {
  kind: "matchfix";
  openTrigger: Delimiter | LatexToken[];
  closeTrigger: Delimiter | LatexToken[];
  parse: MatchfixParseHandler;
};
```

</MemberCard>

<a id="indexedinfixentry" name="indexedinfixentry"></a>

<MemberCard>

### IndexedInfixEntry

```ts
type IndexedInfixEntry = CommonEntry & {
  kind: "infix";
  associativity: "right" | "left" | "none" | "any";
  precedence: Precedence;
  parse: InfixParseHandler;
};
```

</MemberCard>

<a id="indexedprefixentry" name="indexedprefixentry"></a>

<MemberCard>

### IndexedPrefixEntry

```ts
type IndexedPrefixEntry = CommonEntry & {
  kind: "prefix";
  precedence: Precedence;
  parse: ExpressionParseHandler;
};
```

</MemberCard>

<a id="indexedpostfixentry" name="indexedpostfixentry"></a>

<MemberCard>

### IndexedPostfixEntry

```ts
type IndexedPostfixEntry = CommonEntry & {
  kind: "postfix";
  precedence: Precedence;
  parse: PostfixParseHandler;
};
```

</MemberCard>

<a id="indexedenvironmententry" name="indexedenvironmententry"></a>

<MemberCard>

### IndexedEnvironmentEntry

```ts
type IndexedEnvironmentEntry = CommonEntry & {
  kind: "environment";
  parse: EnvironmentParseHandler;
};
```

</MemberCard>

<a id="indexedlatexdictionaryentry" name="indexedlatexdictionaryentry"></a>

<MemberCard>

### IndexedLatexDictionaryEntry

```ts
type IndexedLatexDictionaryEntry = 
  | IndexedExpressionEntry
  | IndexedFunctionEntry
  | IndexedSymbolEntry
  | IndexedMatchfixEntry
  | IndexedInfixEntry
  | IndexedPrefixEntry
  | IndexedPostfixEntry
  | IndexedEnvironmentEntry;
```

</MemberCard>

<a id="indexedlatexdictionary" name="indexedlatexdictionary"></a>

<MemberCard>

### IndexedLatexDictionary

```ts
type IndexedLatexDictionary = {
  ids: Map<string, IndexedLatexDictionaryEntry>;
  lookahead: number;
  defs: IndexedLatexDictionaryEntry[];
};
```

</MemberCard>

<a id="indexlatexdictionary" name="indexlatexdictionary"></a>

<MemberCard>

### indexLatexDictionary()

```ts
function indexLatexDictionary(dic, onError): IndexedLatexDictionary
```

##### dic

readonly `Partial`\<`OnlyFirst`\<
  \| [`ExpressionEntry`](#expressionentry)
  \| [`MatchfixEntry`](#matchfixentry)
  \| [`InfixEntry`](#infixentry)
  \| [`PostfixEntry`](#postfixentry)
  \| [`PrefixEntry`](#prefixentry)
  \| [`SymbolEntry`](#symbolentry)
  \| [`FunctionEntry`](#functionentry)
  \| [`EnvironmentEntry`](#environmententry)
  \| [`DefaultEntry`](#defaultentry), \{\} & 
  \| [`ExpressionEntry`](#expressionentry)
  \| [`MatchfixEntry`](#matchfixentry)
  \| [`InfixEntry`](#infixentry)
  \| [`PostfixEntry`](#postfixentry)
  \| [`PrefixEntry`](#prefixentry)
  \| [`SymbolEntry`](#symbolentry)
  \| [`FunctionEntry`](#functionentry)
  \| [`EnvironmentEntry`](#environmententry)
  \| [`DefaultEntry`](#defaultentry)\>\>[]

##### onError

(`sig`) => `void`

</MemberCard>

<a id="default_latex_dictionary" name="default_latex_dictionary"></a>

<MemberCard>

### DEFAULT\_LATEX\_DICTIONARY

```ts
const DEFAULT_LATEX_DICTIONARY: { [category in LibraryCategory]?: LatexDictionary };
```

</MemberCard>

<a id="getlatexdictionary" name="getlatexdictionary"></a>

<MemberCard>

### getLatexDictionary()

```ts
function getLatexDictionary(category): readonly Readonly<LatexDictionaryEntry>[]
```

##### category

`"all"` | [`LibraryCategory`](#librarycategory)

</MemberCard>

<a id="symboltype" name="symboltype"></a>

<MemberCard>

### SymbolType

```ts
type SymbolType = "symbol" | "function" | "unknown";
```

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
  string: string;
  expression: BoxedExpression;
};
```

</MemberCard>

<a id="tensordatatype" name="tensordatatype"></a>

<MemberCard>

### TensorDataType

```ts
type TensorDataType = keyof DataTypeMap;
```

</MemberCard>

<a id="tensordatadt" name="tensordatadt"></a>

### TensorData\<DT\>

<a id="tensordatadt_dtype-1" name="tensordatadt_dtype-1"></a>

<MemberCard>

##### TensorData.dtype

```ts
dtype: DT;
```

</MemberCard>

<a id="tensordatadt_shape-1" name="tensordatadt_shape-1"></a>

<MemberCard>

##### TensorData.shape

```ts
shape: number[];
```

</MemberCard>

<a id="tensordatadt_rank-1" name="tensordatadt_rank-1"></a>

<MemberCard>

##### TensorData.rank

```ts
rank: number;
```

</MemberCard>

<a id="tensordatadt_data-1" name="tensordatadt_data-1"></a>

<MemberCard>

##### TensorData.data

```ts
data: DataTypeMap[DT][];
```

</MemberCard>

<a id="maketensorfield" name="maketensorfield"></a>

<MemberCard>

### makeTensorField()

```ts
function makeTensorField<DT>(ce, dtype): TensorField<DataTypeMap[DT]>
```

• DT extends keyof [`DataTypeMap`](#datatypemap)

##### ce

`ComputeEngine`

##### dtype

`DT`

</MemberCard>

<a id="tensorfieldt" name="tensorfieldt"></a>

### TensorField\<T\>

<a id="tensorfieldt_one-3" name="tensorfieldt_one-3"></a>

<MemberCard>

##### TensorField.one

```ts
readonly one: T;
```

</MemberCard>

<a id="tensorfieldt_zero-3" name="tensorfieldt_zero-3"></a>

<MemberCard>

##### TensorField.zero

```ts
readonly zero: T;
```

</MemberCard>

<a id="tensorfieldt_nan-3" name="tensorfieldt_nan-3"></a>

<MemberCard>

##### TensorField.nan

```ts
readonly nan: T;
```

</MemberCard>

<a id="tensorfieldt_cast-3" name="tensorfieldt_cast-3"></a>

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
cast(x, dtype): string
```

####### x

`T`

####### dtype

`"string"`

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
cast(x, dtype): string[]
```

####### x

`T`[]

####### dtype

`"string"`

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

<a id="tensorfieldt_expression-4" name="tensorfieldt_expression-4"></a>

<MemberCard>

##### TensorField.expression()

```ts
expression(x): BoxedExpression
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_iszero-5" name="tensorfieldt_iszero-5"></a>

<MemberCard>

##### TensorField.isZero()

```ts
isZero(x): boolean
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_isone-4" name="tensorfieldt_isone-4"></a>

<MemberCard>

##### TensorField.isOne()

```ts
isOne(x): boolean
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_equals-4" name="tensorfieldt_equals-4"></a>

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

<a id="tensorfieldt_add-6" name="tensorfieldt_add-6"></a>

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

<a id="tensorfieldt_addn-3" name="tensorfieldt_addn-3"></a>

<MemberCard>

##### TensorField.addn()

```ts
addn(...xs): T
```

####### xs

...`T`[]

</MemberCard>

<a id="tensorfieldt_neg-5" name="tensorfieldt_neg-5"></a>

<MemberCard>

##### TensorField.neg()

```ts
neg(x): T
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_sub-5" name="tensorfieldt_sub-5"></a>

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

<a id="tensorfieldt_mul-5" name="tensorfieldt_mul-5"></a>

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

<a id="tensorfieldt_muln-3" name="tensorfieldt_muln-3"></a>

<MemberCard>

##### TensorField.muln()

```ts
muln(...xs): T
```

####### xs

...`T`[]

</MemberCard>

<a id="tensorfieldt_div-5" name="tensorfieldt_div-5"></a>

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

<a id="tensorfieldt_pow-5" name="tensorfieldt_pow-5"></a>

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

<a id="tensorfieldt_conjugate-3" name="tensorfieldt_conjugate-3"></a>

<MemberCard>

##### TensorField.conjugate()

```ts
conjugate(x): T
```

####### x

`T`

</MemberCard>

<a id="tensorfieldnumber" name="tensorfieldnumber"></a>

### TensorFieldNumber

<MemberCard>

##### new TensorFieldNumber()

```ts
new TensorFieldNumber(ce): TensorFieldNumber
```

####### ce

`ComputeEngine`

</MemberCard>

<a id="tensorfieldnumber_one" name="tensorfieldnumber_one"></a>

<MemberCard>

##### TensorFieldNumber.one

```ts
one: number = 1;
```

</MemberCard>

<a id="tensorfieldnumber_zero" name="tensorfieldnumber_zero"></a>

<MemberCard>

##### TensorFieldNumber.zero

```ts
zero: number = 0;
```

</MemberCard>

<a id="tensorfieldnumber_nan" name="tensorfieldnumber_nan"></a>

<MemberCard>

##### TensorFieldNumber.nan

```ts
nan: number = NaN;
```

</MemberCard>

<a id="tensorfieldnumber_cast" name="tensorfieldnumber_cast"></a>

<MemberCard>

##### TensorFieldNumber.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`number`

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`number`

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`number`

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`number`

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`number`

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`number`

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

####### x

`number`

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

####### x

`number`

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

####### x

`number`

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`number`[]

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`number`[]

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`number`[]

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`number`[]

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`number`[]

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`number`[]

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

####### x

`number`[]

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

####### x

`number`[]

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

####### x

`number`[]

####### dtype

`"expression"`

</MemberCard>

<a id="tensorfieldnumber_expression" name="tensorfieldnumber_expression"></a>

<MemberCard>

##### TensorFieldNumber.expression()

```ts
expression(x): BoxedExpression
```

####### x

`number`

</MemberCard>

<a id="tensorfieldnumber_iszero-1" name="tensorfieldnumber_iszero-1"></a>

<MemberCard>

##### TensorFieldNumber.isZero()

```ts
isZero(x): boolean
```

####### x

`number`

</MemberCard>

<a id="tensorfieldnumber_isone-1" name="tensorfieldnumber_isone-1"></a>

<MemberCard>

##### TensorFieldNumber.isOne()

```ts
isOne(x): boolean
```

####### x

`number`

</MemberCard>

<a id="tensorfieldnumber_equals" name="tensorfieldnumber_equals"></a>

<MemberCard>

##### TensorFieldNumber.equals()

```ts
equals(lhs, rhs): boolean
```

####### lhs

`number`

####### rhs

`number`

</MemberCard>

<a id="tensorfieldnumber_add-1" name="tensorfieldnumber_add-1"></a>

<MemberCard>

##### TensorFieldNumber.add()

```ts
add(lhs, rhs): number
```

####### lhs

`number`

####### rhs

`number`

</MemberCard>

<a id="tensorfieldnumber_addn" name="tensorfieldnumber_addn"></a>

<MemberCard>

##### TensorFieldNumber.addn()

```ts
addn(...xs): number
```

####### xs

...`number`[]

</MemberCard>

<a id="tensorfieldnumber_neg-1" name="tensorfieldnumber_neg-1"></a>

<MemberCard>

##### TensorFieldNumber.neg()

```ts
neg(x): number
```

####### x

`number`

</MemberCard>

<a id="tensorfieldnumber_sub-1" name="tensorfieldnumber_sub-1"></a>

<MemberCard>

##### TensorFieldNumber.sub()

```ts
sub(lhs, rhs): number
```

####### lhs

`number`

####### rhs

`number`

</MemberCard>

<a id="tensorfieldnumber_mul-1" name="tensorfieldnumber_mul-1"></a>

<MemberCard>

##### TensorFieldNumber.mul()

```ts
mul(lhs, rhs): number
```

####### lhs

`number`

####### rhs

`number`

</MemberCard>

<a id="tensorfieldnumber_muln" name="tensorfieldnumber_muln"></a>

<MemberCard>

##### TensorFieldNumber.muln()

```ts
muln(...xs): number
```

####### xs

...`number`[]

</MemberCard>

<a id="tensorfieldnumber_div-1" name="tensorfieldnumber_div-1"></a>

<MemberCard>

##### TensorFieldNumber.div()

```ts
div(lhs, rhs): number
```

####### lhs

`number`

####### rhs

`number`

</MemberCard>

<a id="tensorfieldnumber_pow-1" name="tensorfieldnumber_pow-1"></a>

<MemberCard>

##### TensorFieldNumber.pow()

```ts
pow(lhs, rhs): number
```

####### lhs

`number`

####### rhs

`number`

</MemberCard>

<a id="tensorfieldnumber_conjugate" name="tensorfieldnumber_conjugate"></a>

<MemberCard>

##### TensorFieldNumber.conjugate()

```ts
conjugate(x): number
```

####### x

`number`

</MemberCard>

<a id="tensorfieldexpression" name="tensorfieldexpression"></a>

### TensorFieldExpression

<MemberCard>

##### new TensorFieldExpression()

```ts
new TensorFieldExpression(ce): TensorFieldExpression
```

####### ce

`ComputeEngine`

</MemberCard>

<a id="tensorfieldexpression_one-1" name="tensorfieldexpression_one-1"></a>

<MemberCard>

##### TensorFieldExpression.one

```ts
one: BoxedExpression;
```

</MemberCard>

<a id="tensorfieldexpression_zero-1" name="tensorfieldexpression_zero-1"></a>

<MemberCard>

##### TensorFieldExpression.zero

```ts
zero: BoxedExpression;
```

</MemberCard>

<a id="tensorfieldexpression_nan-1" name="tensorfieldexpression_nan-1"></a>

<MemberCard>

##### TensorFieldExpression.nan

```ts
nan: BoxedExpression;
```

</MemberCard>

<a id="tensorfieldexpression_cast-1" name="tensorfieldexpression_cast-1"></a>

<MemberCard>

##### TensorFieldExpression.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

####### x

[`BoxedExpression`](#boxedexpression)

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

####### x

[`BoxedExpression`](#boxedexpression)[]

####### dtype

`"expression"`

</MemberCard>

<a id="tensorfieldexpression_expression-1" name="tensorfieldexpression_expression-1"></a>

<MemberCard>

##### TensorFieldExpression.expression()

```ts
expression(x): BoxedExpression
```

####### x

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_iszero-2" name="tensorfieldexpression_iszero-2"></a>

<MemberCard>

##### TensorFieldExpression.isZero()

```ts
isZero(x): boolean
```

####### x

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_isone-2" name="tensorfieldexpression_isone-2"></a>

<MemberCard>

##### TensorFieldExpression.isOne()

```ts
isOne(x): boolean
```

####### x

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_equals-1" name="tensorfieldexpression_equals-1"></a>

<MemberCard>

##### TensorFieldExpression.equals()

```ts
equals(lhs, rhs): boolean
```

####### lhs

[`BoxedExpression`](#boxedexpression)

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_add-2" name="tensorfieldexpression_add-2"></a>

<MemberCard>

##### TensorFieldExpression.add()

```ts
add(lhs, rhs): BoxedExpression
```

####### lhs

[`BoxedExpression`](#boxedexpression)

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_addn-1" name="tensorfieldexpression_addn-1"></a>

<MemberCard>

##### TensorFieldExpression.addn()

```ts
addn(...xs): BoxedExpression
```

####### xs

...[`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="tensorfieldexpression_neg-2" name="tensorfieldexpression_neg-2"></a>

<MemberCard>

##### TensorFieldExpression.neg()

```ts
neg(x): BoxedExpression
```

####### x

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_sub-2" name="tensorfieldexpression_sub-2"></a>

<MemberCard>

##### TensorFieldExpression.sub()

```ts
sub(lhs, rhs): BoxedExpression
```

####### lhs

[`BoxedExpression`](#boxedexpression)

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_mul-2" name="tensorfieldexpression_mul-2"></a>

<MemberCard>

##### TensorFieldExpression.mul()

```ts
mul(lhs, rhs): BoxedExpression
```

####### lhs

[`BoxedExpression`](#boxedexpression)

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_muln-1" name="tensorfieldexpression_muln-1"></a>

<MemberCard>

##### TensorFieldExpression.muln()

```ts
muln(...xs): BoxedExpression
```

####### xs

...[`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="tensorfieldexpression_div-2" name="tensorfieldexpression_div-2"></a>

<MemberCard>

##### TensorFieldExpression.div()

```ts
div(lhs, rhs): BoxedExpression
```

####### lhs

[`BoxedExpression`](#boxedexpression)

####### rhs

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldexpression_pow-2" name="tensorfieldexpression_pow-2"></a>

<MemberCard>

##### TensorFieldExpression.pow()

```ts
pow(lhs, rhs): BoxedExpression
```

####### lhs

[`BoxedExpression`](#boxedexpression)

####### rhs

`number`

</MemberCard>

<a id="tensorfieldexpression_conjugate-1" name="tensorfieldexpression_conjugate-1"></a>

<MemberCard>

##### TensorFieldExpression.conjugate()

```ts
conjugate(x): BoxedExpression
```

####### x

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldcomplex" name="tensorfieldcomplex"></a>

### TensorFieldComplex

<MemberCard>

##### new TensorFieldComplex()

```ts
new TensorFieldComplex(ce): TensorFieldComplex
```

####### ce

`ComputeEngine`

</MemberCard>

<a id="tensorfieldcomplex_one-2" name="tensorfieldcomplex_one-2"></a>

<MemberCard>

##### TensorFieldComplex.one

```ts
one: Complex;
```

</MemberCard>

<a id="tensorfieldcomplex_zero-2" name="tensorfieldcomplex_zero-2"></a>

<MemberCard>

##### TensorFieldComplex.zero

```ts
zero: Complex;
```

</MemberCard>

<a id="tensorfieldcomplex_nan-2" name="tensorfieldcomplex_nan-2"></a>

<MemberCard>

##### TensorFieldComplex.nan

```ts
nan: Complex;
```

</MemberCard>

<a id="tensorfieldcomplex_cast-2" name="tensorfieldcomplex_cast-2"></a>

<MemberCard>

##### TensorFieldComplex.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`Complex`

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`Complex`

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`Complex`

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`Complex`

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`Complex`

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`Complex`

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

####### x

`Complex`

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

####### x

`Complex`

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

####### x

`Complex`

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`Complex`[]

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`Complex`[]

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`Complex`[]

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`Complex`[]

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`Complex`[]

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`Complex`[]

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

####### x

`Complex`[]

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

####### x

`Complex`[]

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

####### x

`Complex`[]

####### dtype

`"expression"`

</MemberCard>

<a id="tensorfieldcomplex_expression-2" name="tensorfieldcomplex_expression-2"></a>

<MemberCard>

##### TensorFieldComplex.expression()

```ts
expression(z): BoxedExpression
```

####### z

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_iszero-3" name="tensorfieldcomplex_iszero-3"></a>

<MemberCard>

##### TensorFieldComplex.isZero()

```ts
isZero(z): boolean
```

####### z

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_isone-3" name="tensorfieldcomplex_isone-3"></a>

<MemberCard>

##### TensorFieldComplex.isOne()

```ts
isOne(z): boolean
```

####### z

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_equals-2" name="tensorfieldcomplex_equals-2"></a>

<MemberCard>

##### TensorFieldComplex.equals()

```ts
equals(lhs, rhs): boolean
```

####### lhs

`Complex`

####### rhs

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_add-3" name="tensorfieldcomplex_add-3"></a>

<MemberCard>

##### TensorFieldComplex.add()

```ts
add(lhs, rhs): Complex
```

####### lhs

`Complex`

####### rhs

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_addn-2" name="tensorfieldcomplex_addn-2"></a>

<MemberCard>

##### TensorFieldComplex.addn()

```ts
addn(...xs): Complex
```

####### xs

...`Complex`[]

</MemberCard>

<a id="tensorfieldcomplex_neg-3" name="tensorfieldcomplex_neg-3"></a>

<MemberCard>

##### TensorFieldComplex.neg()

```ts
neg(z): Complex
```

####### z

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_sub-3" name="tensorfieldcomplex_sub-3"></a>

<MemberCard>

##### TensorFieldComplex.sub()

```ts
sub(lhs, rhs): Complex
```

####### lhs

`Complex`

####### rhs

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_mul-3" name="tensorfieldcomplex_mul-3"></a>

<MemberCard>

##### TensorFieldComplex.mul()

```ts
mul(lhs, rhs): Complex
```

####### lhs

`Complex`

####### rhs

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_muln-2" name="tensorfieldcomplex_muln-2"></a>

<MemberCard>

##### TensorFieldComplex.muln()

```ts
muln(...xs): Complex
```

####### xs

...`Complex`[]

</MemberCard>

<a id="tensorfieldcomplex_div-3" name="tensorfieldcomplex_div-3"></a>

<MemberCard>

##### TensorFieldComplex.div()

```ts
div(lhs, rhs): Complex
```

####### lhs

`Complex`

####### rhs

`Complex`

</MemberCard>

<a id="tensorfieldcomplex_pow-3" name="tensorfieldcomplex_pow-3"></a>

<MemberCard>

##### TensorFieldComplex.pow()

```ts
pow(lhs, rhs): Complex
```

####### lhs

`Complex`

####### rhs

`number`

</MemberCard>

<a id="tensorfieldcomplex_conjugate-2" name="tensorfieldcomplex_conjugate-2"></a>

<MemberCard>

##### TensorFieldComplex.conjugate()

```ts
conjugate(z): Complex
```

####### z

`Complex`

</MemberCard>

<a id="abstracttensordt" name="abstracttensordt"></a>

### `abstract` AbstractTensor\<DT\>

<MemberCard>

##### new AbstractTensor()

```ts
new AbstractTensor<DT>(ce, tensorData): AbstractTensor<DT>
```

####### ce

`ComputeEngine`

####### tensorData

[`TensorData`](#tensordatadt)\<`DT`\>

</MemberCard>

<a id="abstracttensordt_field" name="abstracttensordt_field"></a>

<MemberCard>

##### AbstractTensor.field

```ts
readonly field: TensorField<DataTypeMap[DT]>;
```

</MemberCard>

<a id="abstracttensordt_shape" name="abstracttensordt_shape"></a>

<MemberCard>

##### AbstractTensor.shape

```ts
readonly shape: number[];
```

</MemberCard>

<a id="abstracttensordt_rank" name="abstracttensordt_rank"></a>

<MemberCard>

##### AbstractTensor.rank

```ts
readonly rank: number;
```

</MemberCard>

<a id="abstracttensordt_dtype" name="abstracttensordt_dtype"></a>

<MemberCard>

##### AbstractTensor.dtype

</MemberCard>

<a id="abstracttensordt_data" name="abstracttensordt_data"></a>

<MemberCard>

##### AbstractTensor.data

</MemberCard>

<a id="abstracttensordt_expression-3" name="abstracttensordt_expression-3"></a>

<MemberCard>

##### AbstractTensor.expression

</MemberCard>

<a id="abstracttensordt_array" name="abstracttensordt_array"></a>

<MemberCard>

##### AbstractTensor.array

Like expression(), but return a nested JS array instead
of a BoxedExpression

</MemberCard>

<a id="abstracttensordt_issquare" name="abstracttensordt_issquare"></a>

<MemberCard>

##### AbstractTensor.isSquare

</MemberCard>

<a id="abstracttensordt_issymmetric" name="abstracttensordt_issymmetric"></a>

<MemberCard>

##### AbstractTensor.isSymmetric

</MemberCard>

<a id="abstracttensordt_isskewsymmetric" name="abstracttensordt_isskewsymmetric"></a>

<MemberCard>

##### AbstractTensor.isSkewSymmetric

</MemberCard>

<a id="abstracttensordt_isuppertriangular" name="abstracttensordt_isuppertriangular"></a>

<MemberCard>

##### AbstractTensor.isUpperTriangular

</MemberCard>

<a id="abstracttensordt_islowertriangular" name="abstracttensordt_islowertriangular"></a>

<MemberCard>

##### AbstractTensor.isLowerTriangular

</MemberCard>

<a id="abstracttensordt_istriangular" name="abstracttensordt_istriangular"></a>

<MemberCard>

##### AbstractTensor.isTriangular

</MemberCard>

<a id="abstracttensordt_isdiagonal" name="abstracttensordt_isdiagonal"></a>

<MemberCard>

##### AbstractTensor.isDiagonal

</MemberCard>

<a id="abstracttensordt_isidentity" name="abstracttensordt_isidentity"></a>

<MemberCard>

##### AbstractTensor.isIdentity

</MemberCard>

<a id="abstracttensordt_iszero-4" name="abstracttensordt_iszero-4"></a>

<MemberCard>

##### AbstractTensor.isZero

</MemberCard>

<a id="abstracttensordt_align" name="abstracttensordt_align"></a>

<MemberCard>

##### AbstractTensor.align()

###### align(lhs, rhs)

```ts
static align<T1, T2>(lhs, rhs): [AbstractTensor<T1>, AbstractTensor<T1>]
```

Return a tuple of tensors that have the same dtype.
If necessary, one of the two input tensors is upcast.

The shape of the tensors is reshaped to a compatible
shape. If the shape is not compatible, `undefined` is returned.

• T1 extends keyof [`DataTypeMap`](#datatypemap)

• T2 extends keyof [`DataTypeMap`](#datatypemap)

####### lhs

[`AbstractTensor`](#abstracttensordt)\<`T1`\>

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`T2`\>

###### align(lhs, rhs)

```ts
static align<T1, T2>(lhs, rhs): [AbstractTensor<T2>, AbstractTensor<T2>]
```

Return a tuple of tensors that have the same dtype.
If necessary, one of the two input tensors is upcast.

The shape of the tensors is reshaped to a compatible
shape. If the shape is not compatible, `undefined` is returned.

• T1 extends keyof [`DataTypeMap`](#datatypemap)

• T2 extends keyof [`DataTypeMap`](#datatypemap)

####### lhs

[`AbstractTensor`](#abstracttensordt)\<`T1`\>

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`T2`\>

</MemberCard>

<a id="abstracttensordt_broadcast" name="abstracttensordt_broadcast"></a>

<MemberCard>

##### AbstractTensor.broadcast()

```ts
static broadcast<T>(fn, lhs, rhs): AbstractTensor<T>
```

Apply a function to the elements of two tensors, or to a tensor
and a scalar.

The tensors are aligned and broadcasted if necessary.

• T extends keyof [`DataTypeMap`](#datatypemap)

####### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`T`\]

####### lhs

[`AbstractTensor`](#abstracttensordt)\<`T`\>

####### rhs

[`DataTypeMap`](#datatypemap)\[`T`\] | [`AbstractTensor`](#abstracttensordt)\<`T`\>

</MemberCard>

<a id="abstracttensordt_at" name="abstracttensordt_at"></a>

<MemberCard>

##### AbstractTensor.at()

```ts
at(...indices): DataTypeMap[DT]
```

The number of indices should match the rank of the tensor.

Note: the indices are 1-based
Note: the data is broadcast (wraps around) if the indices are out of bounds

LaTeX notation `A\lbracki, j\rbrack` or `A_{i, j}`

####### indices

...`number`[]

</MemberCard>

<a id="abstracttensordt_diagonal" name="abstracttensordt_diagonal"></a>

<MemberCard>

##### AbstractTensor.diagonal()

```ts
diagonal(axis1?, axis2?): DataTypeMap[DT][]
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<a id="abstracttensordt_trace" name="abstracttensordt_trace"></a>

<MemberCard>

##### AbstractTensor.trace()

```ts
trace(axis1?, axis2?): DataTypeMap[DT]
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<a id="abstracttensordt_reshape" name="abstracttensordt_reshape"></a>

<MemberCard>

##### AbstractTensor.reshape()

```ts
reshape(...shape): AbstractTensor<DT>
```

Change the shape of the tensor

The data is reused (and shared) between the two tensors.

####### shape

...`number`[]

</MemberCard>

<a id="abstracttensordt_flatten" name="abstracttensordt_flatten"></a>

<MemberCard>

##### AbstractTensor.flatten()

```ts
flatten(): DataTypeMap[DT][]
```

</MemberCard>

<a id="abstracttensordt_upcast" name="abstracttensordt_upcast"></a>

<MemberCard>

##### AbstractTensor.upcast()

```ts
upcast<DT>(dtype): AbstractTensor<DT>
```

• DT extends keyof [`DataTypeMap`](#datatypemap)

####### dtype

`DT`

</MemberCard>

<a id="abstracttensordt_transpose" name="abstracttensordt_transpose"></a>

<MemberCard>

##### AbstractTensor.transpose()

###### transpose()

```ts
transpose(): AbstractTensor<DT>
```

Transpose the first and second axis

###### transpose(axis1, axis2, fn)

```ts
transpose(axis1, axis2, fn?): AbstractTensor<DT>
```

Transpose two axes.

####### axis1

`number`

####### axis2

`number`

####### fn?

(`v`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="abstracttensordt_conjugatetranspose" name="abstracttensordt_conjugatetranspose"></a>

<MemberCard>

##### AbstractTensor.conjugateTranspose()

```ts
conjugateTranspose(axis1, axis2): AbstractTensor<DT>
```

####### axis1

`number`

####### axis2

`number`

</MemberCard>

<a id="abstracttensordt_determinant" name="abstracttensordt_determinant"></a>

<MemberCard>

##### AbstractTensor.determinant()

```ts
determinant(): DataTypeMap[DT]
```

</MemberCard>

<a id="abstracttensordt_inverse" name="abstracttensordt_inverse"></a>

<MemberCard>

##### AbstractTensor.inverse()

```ts
inverse(): AbstractTensor<DT>
```

</MemberCard>

<a id="abstracttensordt_pseudoinverse" name="abstracttensordt_pseudoinverse"></a>

<MemberCard>

##### AbstractTensor.pseudoInverse()

```ts
pseudoInverse(): AbstractTensor<DT>
```

</MemberCard>

<a id="abstracttensordt_adjugatematrix" name="abstracttensordt_adjugatematrix"></a>

<MemberCard>

##### AbstractTensor.adjugateMatrix()

```ts
adjugateMatrix(): AbstractTensor<DT>
```

</MemberCard>

<a id="abstracttensordt_minor" name="abstracttensordt_minor"></a>

<MemberCard>

##### AbstractTensor.minor()

```ts
minor(i, j): DataTypeMap[DT]
```

####### i

`number`

####### j

`number`

</MemberCard>

<a id="abstracttensordt_map1" name="abstracttensordt_map1"></a>

<MemberCard>

##### AbstractTensor.map1()

```ts
map1(fn, scalar): AbstractTensor<DT>
```

####### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

####### scalar

[`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="abstracttensordt_map2" name="abstracttensordt_map2"></a>

<MemberCard>

##### AbstractTensor.map2()

```ts
map2(fn, rhs): AbstractTensor<DT>
```

####### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="abstracttensordt_add-4" name="abstracttensordt_add-4"></a>

<MemberCard>

##### AbstractTensor.add()

```ts
add(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="abstracttensordt_subtract" name="abstracttensordt_subtract"></a>

<MemberCard>

##### AbstractTensor.subtract()

```ts
subtract(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="abstracttensordt_multiply" name="abstracttensordt_multiply"></a>

<MemberCard>

##### AbstractTensor.multiply()

```ts
multiply(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="abstracttensordt_divide" name="abstracttensordt_divide"></a>

<MemberCard>

##### AbstractTensor.divide()

```ts
divide(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="abstracttensordt_power" name="abstracttensordt_power"></a>

<MemberCard>

##### AbstractTensor.power()

```ts
power(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="abstracttensordt_equals-3" name="abstracttensordt_equals-3"></a>

<MemberCard>

##### AbstractTensor.equals()

```ts
equals(rhs): boolean
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="maketensor" name="maketensor"></a>

<MemberCard>

### makeTensor()

```ts
function makeTensor<T>(ce, data): AbstractTensor<T>
```

• T extends keyof [`DataTypeMap`](#datatypemap)

##### ce

`ComputeEngine`

##### data

[`TensorData`](#tensordatadt)\<`T`\> | \{
`operator`: `string`;
`ops`: [`BoxedExpression`](#boxedexpression)[];
`dtype`: `T`;
`shape`: `number`[];
\}

</MemberCard>

## Type

<a id="boxedtype" name="boxedtype"></a>

### BoxedType

<MemberCard>

##### new BoxedType()

```ts
new BoxedType(type): BoxedType
```

####### type

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`MapType`](#maptype) | [`TupleType`](#tupletype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference)

</MemberCard>

<a id="boxedtype_unknown" name="boxedtype_unknown"></a>

<MemberCard>

##### BoxedType.unknown

```ts
static unknown: BoxedType;
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

<a id="boxedtype_matches" name="boxedtype_matches"></a>

<MemberCard>

##### BoxedType.matches()

```ts
matches(other): boolean
```

####### other

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`MapType`](#maptype) | [`TupleType`](#tupletype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference) | [`BoxedType`](#boxedtype)

</MemberCard>

<a id="boxedtype_is" name="boxedtype_is"></a>

<MemberCard>

##### BoxedType.is()

```ts
is(other): boolean
```

####### other

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`MapType`](#maptype) | [`TupleType`](#tupletype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference)

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

<a id="mathjsonidentifier" name="mathjsonidentifier"></a>

<MemberCard>

### MathJsonIdentifier

```ts
type MathJsonIdentifier = string;
```

</MemberCard>

<a id="mathjsonnumber" name="mathjsonnumber"></a>

<MemberCard>

### MathJsonNumber

```ts
type MathJsonNumber = {
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

It can also consist of the value `NaN`, `-Infinity` and `+Infinity` to
represent these respective values.

A MathJSON number may contain more digits or an exponent with a greater
range than can be represented in an IEEE 64-bit floating-point.

For example:
- `-12.34`
- `0.234e-56`
- `1.(3)`
- `123456789123456789.123(4567)e999`

</MemberCard>

<a id="mathjsonsymbol" name="mathjsonsymbol"></a>

<MemberCard>

### MathJsonSymbol

```ts
type MathJsonSymbol = {
  sym: MathJsonIdentifier;
 } & MathJsonAttributes;
```

</MemberCard>

<a id="mathjsonstring" name="mathjsonstring"></a>

<MemberCard>

### MathJsonString

```ts
type MathJsonString = {
  str: string;
 } & MathJsonAttributes;
```

</MemberCard>

<a id="mathjsonfunction" name="mathjsonfunction"></a>

<MemberCard>

### MathJsonFunction

```ts
type MathJsonFunction = {
  fn: [MathJsonIdentifier, ...Expression[]];
 } & MathJsonAttributes;
```

</MemberCard>

<a id="expressionobject" name="expressionobject"></a>

<MemberCard>

### ExpressionObject

```ts
type ExpressionObject = 
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  | MathJsonFunction;
```

</MemberCard>

<a id="expression" name="expression"></a>

<MemberCard>

### Expression

```ts
type Expression = 
  | ExpressionObject
  | number
  | MathJsonIdentifier
  | string
  | readonly [MathJsonIdentifier, ...Expression[]];
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
  | NumericType
  | "collection"
  | "list"
  | "set"
  | "map"
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
   - `function`: a function expression
     such as `["Function", ["Add", "x", 1], "x"]`.

- `value`
   - `scalar`
     - `<number>`
     - `boolean`: a boolean value: `True` or `False`.
     - `string`: a string of characters.
   - `collection`
      - `list`: a collection of expressions, possibly recursive,
         with optional dimensions, e.g. `[number]`, `[boolean^32]`,
         `[number^(2x3)]`. Used to represent a vector, a matrix or a
         tensor when the type of its elements is a number
      - `set`: a collection of unique expressions, e.g. `set<string>`.
      - `tuple`: a fixed-size collection of named or unnamed elements, e.g.
         `tuple<number, boolean>`, `tuple<x: number, y: boolean>`.
      - `map`: a set key-value pairs, e.g. `map<x: number, y: boolean>`.

</MemberCard>

<a id="numerictype" name="numerictype"></a>

<MemberCard>

### NumericType

```ts
type NumericType = 
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
  restArg: NamedElement;
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

<a id="maptype" name="maptype"></a>

<MemberCard>

### MapType

```ts
type MapType = {
  kind: "map";
  elements: Record<string, Type>;
};
```

Map is a non-indexable collection of key/value pairs.
An element of a map whose type is a subtype of `nothing` is optional.
For example, in `{x: number, y: boolean | nothing}` the element `y` is optional.

</MemberCard>

<a id="collectiontype" name="collectiontype"></a>

<MemberCard>

### CollectionType

```ts
type CollectionType = {
  kind: "collection";
  elements: Type;
};
```

Collection, List, Set, Tuple and Map are collections.

`CollectionType` is a generic collection of elements of a certain type.

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

The elements of a list are ordered.

All elements of a list have the same type, but it can be a broad type,
up to `any`.

The same element can be present in the list more than once.

A list can be multi-dimensional. For example, a list of integers with
dimensions 2x3x4 is a 3D tensor with 2 layers, 3 rows and 4 columns.

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
The elements of a set are not ordered.

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

</MemberCard>

<a id="typereference" name="typereference"></a>

<MemberCard>

### TypeReference

```ts
type TypeReference = {
  kind: "reference";
  ref: string;
};
```

Nominal typing

</MemberCard>

<a id="type-2" name="type-2"></a>

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
  | MapType
  | TupleType
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
- `"(number, ...number) -> number"` -- a signature with a rest argument (can have only one, and no optional arguments if there is a rest argument).
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

### TypeResolver()

```ts
type TypeResolver = (name) => Type | undefined;
```

</MemberCard>
