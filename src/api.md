
<a name="readmemd"></a>

## Modules

- [common/type/types](#commontypetypesmd)
- ["compute-engine"](#compute-enginemd)
- ["math-json"](#math-jsonmd)

# Common

## Type


<a name="commontypetypesmd"></a>

<a id="primitivetype" name="primitivetype"></a>

#### PrimitiveType

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

<a id="numerictype" name="numerictype"></a>

#### NumericType

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

<a id="namedelement" name="namedelement"></a>

#### NamedElement

```ts
type NamedElement = object;
```

##### Type declaration

<a id="name"></a>

###### name?

<a id="name" name="name"></a>

<MemberCard>

###### NamedElement.name?

```ts
optional name: string;
```

</MemberCard>

<a id="type"></a>

###### type

<a id="type" name="type"></a>

<MemberCard>

###### NamedElement.type

```ts
type: Type;
```

</MemberCard>

<a id="functionsignature" name="functionsignature"></a>

#### FunctionSignature

```ts
type FunctionSignature = object;
```

##### Type declaration

<a id="kind"></a>

###### kind

<a id="kind" name="kind"></a>

<MemberCard>

###### FunctionSignature.kind

```ts
kind: "signature";
```

</MemberCard>

<a id="args"></a>

###### args?

<a id="args" name="args"></a>

<MemberCard>

###### FunctionSignature.args?

```ts
optional args: NamedElement[];
```

</MemberCard>

<a id="optargs"></a>

###### optArgs?

<a id="optargs" name="optargs"></a>

<MemberCard>

###### FunctionSignature.optArgs?

```ts
optional optArgs: NamedElement[];
```

</MemberCard>

<a id="restarg"></a>

###### restArg?

<a id="restarg" name="restarg"></a>

<MemberCard>

###### FunctionSignature.restArg?

```ts
optional restArg: NamedElement;
```

</MemberCard>

<a id="result"></a>

###### result

<a id="result" name="result"></a>

<MemberCard>

###### FunctionSignature.result

```ts
result: Type;
```

</MemberCard>

<a id="algebraictype" name="algebraictype"></a>

#### AlgebraicType

```ts
type AlgebraicType = object;
```

##### Type declaration

<a id="kind-1"></a>

###### kind

<a id="kind-1" name="kind-1"></a>

<MemberCard>

###### AlgebraicType.kind

```ts
kind: "union" | "intersection";
```

</MemberCard>

<a id="types"></a>

###### types

<a id="types" name="types"></a>

<MemberCard>

###### AlgebraicType.types

```ts
types: Type[];
```

</MemberCard>

<a id="negationtype" name="negationtype"></a>

#### NegationType

```ts
type NegationType = object;
```

##### Type declaration

<a id="kind-2"></a>

###### kind

<a id="kind-2" name="kind-2"></a>

<MemberCard>

###### NegationType.kind

```ts
kind: "negation";
```

</MemberCard>

<a id="type-1"></a>

###### type

<a id="type-1" name="type-1"></a>

<MemberCard>

###### NegationType.type

```ts
type: Type;
```

</MemberCard>

<a id="valuetype" name="valuetype"></a>

#### ValueType

```ts
type ValueType = object;
```

##### Type declaration

<a id="kind-3"></a>

###### kind

<a id="kind-3" name="kind-3"></a>

<MemberCard>

###### ValueType.kind

```ts
kind: "value";
```

</MemberCard>

<a id="value"></a>

###### value

<a id="value" name="value"></a>

<MemberCard>

###### ValueType.value

```ts
value: any;
```

</MemberCard>

<a id="maptype" name="maptype"></a>

#### MapType

```ts
type MapType = object;
```

Map is a non-indexable collection of key/value pairs.
An element of a map whose type is a subtype of `nothing` is optional.
For example, in `{x: number, y: boolean | nothing}` the element `y` is optional.

##### Type declaration

<a id="kind-4"></a>

###### kind

<a id="kind-4" name="kind-4"></a>

<MemberCard>

###### MapType.kind

```ts
kind: "map";
```

</MemberCard>

<a id="elements"></a>

###### elements

<a id="elements" name="elements"></a>

<MemberCard>

###### MapType.elements

```ts
elements: Record<string, Type>;
```

</MemberCard>

<a id="collectiontype" name="collectiontype"></a>

#### CollectionType

```ts
type CollectionType = object;
```

Collection, List, Set, Tuple and Map are collections.

`CollectionType` is a generic collection of elements of a certain type.

##### Type declaration

<a id="kind-5"></a>

###### kind

<a id="kind-5" name="kind-5"></a>

<MemberCard>

###### CollectionType.kind

```ts
kind: "collection";
```

</MemberCard>

<a id="elements-1"></a>

###### elements

<a id="elements-1" name="elements-1"></a>

<MemberCard>

###### CollectionType.elements

```ts
elements: Type;
```

</MemberCard>

<a id="listtype" name="listtype"></a>

#### ListType

```ts
type ListType = object;
```

The elements of a list are ordered.

All elements of a list have the same type, but it can be a broad type,
up to `any`.

The same element can be present in the list more than once.

A list can be multi-dimensional. For example, a list of integers with
dimensions 2x3x4 is a 3D tensor with 2 layers, 3 rows and 4 columns.

##### Type declaration

<a id="kind-6"></a>

###### kind

<a id="kind-6" name="kind-6"></a>

<MemberCard>

###### ListType.kind

```ts
kind: "list";
```

</MemberCard>

<a id="elements-2"></a>

###### elements

<a id="elements-2" name="elements-2"></a>

<MemberCard>

###### ListType.elements

```ts
elements: Type;
```

</MemberCard>

<a id="dimensions"></a>

###### dimensions?

<a id="dimensions" name="dimensions"></a>

<MemberCard>

###### ListType.dimensions?

```ts
optional dimensions: number[];
```

</MemberCard>

<a id="settype" name="settype"></a>

#### SetType

```ts
type SetType = object;
```

Each element of a set is unique (is not present in the set more than once).
The elements of a set are not ordered.

##### Type declaration

<a id="kind-7"></a>

###### kind

<a id="kind-7" name="kind-7"></a>

<MemberCard>

###### SetType.kind

```ts
kind: "set";
```

</MemberCard>

<a id="elements-3"></a>

###### elements

<a id="elements-3" name="elements-3"></a>

<MemberCard>

###### SetType.elements

```ts
elements: Type;
```

</MemberCard>

<a id="tupletype" name="tupletype"></a>

#### TupleType

```ts
type TupleType = object;
```

##### Type declaration

<a id="kind-8"></a>

###### kind

<a id="kind-8" name="kind-8"></a>

<MemberCard>

###### TupleType.kind

```ts
kind: "tuple";
```

</MemberCard>

<a id="elements-4"></a>

###### elements

<a id="elements-4" name="elements-4"></a>

<MemberCard>

###### TupleType.elements

```ts
elements: NamedElement[];
```

</MemberCard>

<a id="typereference" name="typereference"></a>

#### TypeReference

```ts
type TypeReference = object;
```

Nominal typing

##### Type declaration

<a id="kind-9"></a>

###### kind

<a id="kind-9" name="kind-9"></a>

<MemberCard>

###### TypeReference.kind

```ts
kind: "reference";
```

</MemberCard>

<a id="ref"></a>

###### ref

<a id="ref" name="ref"></a>

<MemberCard>

###### TypeReference.ref

```ts
ref: string;
```

</MemberCard>

<a id="type-2" name="type-2"></a>

#### Type

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

<a id="typestring" name="typestring"></a>

#### TypeString

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

<a id="typecompatibility" name="typecompatibility"></a>

#### TypeCompatibility

```ts
type TypeCompatibility = "covariant" | "contravariant" | "bivariant" | "invariant";
```

<a id="typeresolver" name="typeresolver"></a>

#### TypeResolver()

```ts
type TypeResolver = (name) => Type | undefined;
```

###### name

`string`

[`Type`](#type-2) \| `undefined`


<a name="compute-enginemd"></a>

The Compute Engine is a symbolic computation engine that can be used to
manipulate and evaluate mathematical expressions.

Use an instance of ComputeEngine to create boxed expressions
with ComputeEngine.parse and ComputeEngine.box.

Use a [`BoxedExpression`](#boxedexpression) object to manipulate and evaluate
mathematical expressions.

## Compute Engine

<a id="simplifyoptions" name="simplifyoptions"></a>

### SimplifyOptions

```ts
type SimplifyOptions = object;
```

Options for `BoxedExpression.simplify()`

#### Type declaration

<a id="rules"></a>

##### rules?

<a id="rules" name="rules"></a>

<MemberCard>

##### SimplifyOptions.rules?

```ts
optional rules: 
  | null
  | Rule
  | ReadonlyArray<
  | BoxedRule
  | Rule>
  | BoxedRuleSet;
```

The set of rules to apply. If `null`, use no rules. If not provided,
use the default simplification rules.

</MemberCard>

<a id="costfunction"></a>

##### costFunction()?

<a id="costfunction" name="costfunction"></a>

<MemberCard>

##### SimplifyOptions.costFunction()?

```ts
optional costFunction: (expr) => number;
```

Use this cost function to determine if a simplification is worth it.

If not provided, `ce.costFunction`, the cost function of the engine is
used.

###### expr

[`BoxedExpression`](#boxedexpression)

`number`

</MemberCard>

<a id="arrayvalue" name="arrayvalue"></a>

### ArrayValue

```ts
type ArrayValue = 
  | boolean
  | number
  | string
  | BigNum
  | BoxedExpression
  | undefined;
```

<a id="jsonserializationoptions" name="jsonserializationoptions"></a>

### JsonSerializationOptions

```ts
type JsonSerializationOptions = object;
```

Options to control the serialization to MathJSON when using `BoxedExpression.toMathJson()`.

#### Type declaration

<a id="prettify"></a>

##### prettify

<a id="prettify" name="prettify"></a>

<MemberCard>

##### JsonSerializationOptions.prettify

```ts
prettify: boolean;
```

If true, the serialization applies some transformations to make
the JSON more readable. For example, `["Power", "x", 2]` is serialized
as `["Square", "x"]`.

</MemberCard>

<a id="exclude"></a>

##### exclude

<a id="exclude" name="exclude"></a>

<MemberCard>

##### JsonSerializationOptions.exclude

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

</MemberCard>

<a id="shorthands"></a>

##### shorthands

<a id="shorthands" name="shorthands"></a>

<MemberCard>

##### JsonSerializationOptions.shorthands

```ts
shorthands: ("all" | "number" | "symbol" | "function" | "string")[];
```

A list of space separated keywords indicating which MathJSON expressions
can use a shorthand.

**Default**: `["all"]`

</MemberCard>

<a id="metadata"></a>

##### metadata

<a id="metadata" name="metadata"></a>

<MemberCard>

##### JsonSerializationOptions.metadata

```ts
metadata: ("all" | "wikidata" | "latex")[];
```

A list of space separated keywords indicating which metadata should be
included in the MathJSON. If metadata is included, shorthand notation
is not used.

**Default**: `[]`  (none)

</MemberCard>

<a id="repeatingdecimal"></a>

##### repeatingDecimal

<a id="repeatingdecimal" name="repeatingdecimal"></a>

<MemberCard>

##### JsonSerializationOptions.repeatingDecimal

```ts
repeatingDecimal: boolean;
```

If true, repeating decimals are detected and serialized accordingly
For example:
- `1.3333333333333333` \( \to \) `1.(3)`
- `0.142857142857142857142857142857142857142857142857142` \( \to \) `0.(1428571)`

**Default**: `true`

</MemberCard>

<a id="fractionaldigits"></a>

##### fractionalDigits

<a id="fractionaldigits" name="fractionaldigits"></a>

<MemberCard>

##### JsonSerializationOptions.fractionalDigits

```ts
fractionalDigits: "auto" | "max" | number;
```

The maximum number of significant digits in serialized numbers.
- `"max"`: all availabe digits are serialized.
- `"auto"`: use the same precision as the compute engine.

**Default**: `"auto"`

</MemberCard>

<a id="scope-3" name="scope-3"></a>

### Scope

```ts
type Scope = object;
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

<a id="angularunit" name="angularunit"></a>

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

<a id="runtimescope" name="runtimescope"></a>

### RuntimeScope

```ts
type RuntimeScope = Scope & object;
```

#### Type declaration

##### parentScope?

<MemberCard>

##### RuntimeScope.parentScope?

```ts
optional parentScope: RuntimeScope;
```

</MemberCard>

##### ids?

<MemberCard>

##### RuntimeScope.ids?

```ts
optional ids: RuntimeIdentifierDefinitions;
```

</MemberCard>

##### assumptions

<MemberCard>

##### RuntimeScope.assumptions

```ts
assumptions: 
  | undefined
| ExpressionMapInterface<boolean>;
```

</MemberCard>

<a id="assignvalue" name="assignvalue"></a>

### AssignValue

```ts
type AssignValue = 
  | boolean
  | number
  | SemiBoxedExpression
  | (args, options) => BoxedExpression
  | undefined;
```

## Boxed Expression

<a id="boxedexpression" name="boxedexpression"></a>

### BoxedExpression

:::info[THEORY OF OPERATIONS]

The `BoxedExpression` interface includes most of the member functions
applicable to any kind of expression, for example `get symbol()` or
`get ops()`.

When a member function is not applicable to this `BoxedExpression`,
for example `get symbol()` on a `BoxedNumber`, it returns `null`.

This convention makes it convenient to manipulate expressions without
having to check what kind of instance they are before manipulating them.
:::

To get a boxed expression from a LaTeX string use `ce.parse()`, or to
get a boxed expression from a MathJSON expression use `ce.box()`.

#### Function Expression

<a id="ops" name="ops"></a>

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

<a id="nops" name="nops"></a>

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

<a id="op1" name="op1"></a>

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

<a id="op2" name="op2"></a>

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

<a id="op3" name="op3"></a>

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

<a id="isnan-1" name="isnan-1"></a>

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

</MemberCard>

<a id="isinfinity" name="isinfinity"></a>

<MemberCard>

##### BoxedExpression.isInfinity

```ts
readonly isInfinity: boolean;
```

The numeric value of this expression is `±Infinity` or Complex Infinity

</MemberCard>

<a id="isfinite" name="isfinite"></a>

<MemberCard>

##### BoxedExpression.isFinite

```ts
readonly isFinite: boolean;
```

This expression is a number, but not `±Infinity`, 'ComplexInfinity` or
 `NaN`

</MemberCard>

<a id="iseven" name="iseven"></a>

<MemberCard>

##### BoxedExpression.isEven

```ts
readonly isEven: boolean;
```

</MemberCard>

<a id="isodd" name="isodd"></a>

<MemberCard>

##### BoxedExpression.isOdd

```ts
readonly isOdd: boolean;
```

</MemberCard>

<a id="numericvalue-1" name="numericvalue-1"></a>

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

<a id="isnumberliteral" name="isnumberliteral"></a>

<MemberCard>

##### BoxedExpression.isNumberLiteral

```ts
readonly isNumberLiteral: boolean;
```

Return `true` if this expression is a number literal, for example
`2`, `3.14`, `1/2`, `√2` etc.

This is equivalent to checking if `this.numericValue` is not `null`.

</MemberCard>

<a id="re-1" name="re-1"></a>

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

<a id="im-1" name="im-1"></a>

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

<a id="bignumre-1" name="bignumre-1"></a>

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

<a id="bignumim-1" name="bignumim-1"></a>

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

<a id="sgn-1" name="sgn-1"></a>

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

</MemberCard>

<a id="ispositive" name="ispositive"></a>

<MemberCard>

##### BoxedExpression.isPositive

```ts
readonly isPositive: boolean;
```

The numeric value of this expression is > 0, same as `isGreater(0)`

</MemberCard>

<a id="isnonnegative" name="isnonnegative"></a>

<MemberCard>

##### BoxedExpression.isNonNegative

```ts
readonly isNonNegative: boolean;
```

The numeric value of this expression is >= 0, same as `isGreaterEqual(0)`

</MemberCard>

<a id="isnegative" name="isnegative"></a>

<MemberCard>

##### BoxedExpression.isNegative

```ts
readonly isNegative: boolean;
```

The numeric value of this expression is < 0, same as `isLess(0)`

</MemberCard>

<a id="isnonpositive" name="isnonpositive"></a>

<MemberCard>

##### BoxedExpression.isNonPositive

```ts
readonly isNonPositive: boolean;
```

The numeric value of this expression is &lt;= 0, same as `isLessEqual(0)`

</MemberCard>

#### Other

<a id="engine" name="engine"></a>

<MemberCard>

##### BoxedExpression.engine

```ts
readonly engine: IComputeEngine;
```

The Compute Engine associated with this expression provides
a context in which to interpret it, such as definition of symbols
and functions.

</MemberCard>

<a id="tomathjson" name="tomathjson"></a>

<MemberCard>

##### BoxedExpression.toMathJson()

```ts
toMathJson(options?): Expression
```

Serialize to a MathJSON expression with specified options

###### options?

`Readonly`\<`Partial`\<[`JsonSerializationOptions`](#jsonserializationoptions)\>\>

[`Expression`](#expression)

</MemberCard>

<a id="tolatex" name="tolatex"></a>

<MemberCard>

##### BoxedExpression.toLatex()

```ts
toLatex(options?): string
```

Serialize to a LaTeX string.

Will ignore any LaTeX metadata.

###### options?

`Partial`\<[`SerializeLatexOptions`](#serializelatexoptions)\>

`string`

</MemberCard>

<a id="verbatimlatex" name="verbatimlatex"></a>

<MemberCard>

##### BoxedExpression.verbatimLatex?

```ts
optional verbatimLatex: string;
```

</MemberCard>

<a id="iscanonical" name="iscanonical"></a>

<MemberCard>

##### BoxedExpression.isCanonical

###### Get Signature

```ts
get isCanonical(): boolean
```

If `true`, this expression is in a canonical form.

`boolean`

</MemberCard>

<a id="isstructural" name="isstructural"></a>

<MemberCard>

##### BoxedExpression.isStructural

###### Get Signature

```ts
get isStructural(): boolean
```

If `true`, this expression is in a structural form.

`boolean`

</MemberCard>

<a id="json" name="json"></a>

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

<a id="scope" name="scope"></a>

<MemberCard>

##### BoxedExpression.scope

```ts
readonly scope: object;
```

The scope in which this expression has been defined.

Is `null` when the expression is not canonical.

<a id=""></a>

###### parentScope?

<MemberCard>

###### scope.parentScope?

```ts
optional parentScope: { parentScope?: ...; ids?: RuntimeIdentifierDefinitions; assumptions: ExpressionMapInterface<boolean>; };
```

</MemberCard>

<a id=""></a>

###### ids?

<MemberCard>

###### scope.ids?

```ts
optional ids: RuntimeIdentifierDefinitions;
```

</MemberCard>

<a id=""></a>

###### assumptions

<MemberCard>

###### scope.assumptions

```ts
assumptions: ExpressionMapInterface<boolean>;
```

</MemberCard>

</MemberCard>

<a id="latex" name="latex"></a>

<MemberCard>

##### BoxedExpression.latex

###### Get Signature

```ts
get latex(): string
```

LaTeX representation of this expression.

If the expression was parsed from LaTeX, the LaTeX representation is
the same as the input LaTeX.

To customize the serialization, use `expr.toLatex()`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

`string`

</MemberCard>

<a id="getsubexpressions" name="getsubexpressions"></a>

<MemberCard>

##### BoxedExpression.getSubexpressions()

```ts
getSubexpressions(name): readonly BoxedExpression[]
```

All the subexpressions matching the named operator, recursively.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

###### name

`string`

readonly [`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="subexpressions" name="subexpressions"></a>

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

<a id="symbols" name="symbols"></a>

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

<a id="unknowns" name="unknowns"></a>

<MemberCard>

##### BoxedExpression.unknowns

```ts
readonly unknowns: readonly string[];
```

All the identifiers used in the expression that do not have a value
associated with them, i.e. they are declared but not defined.

</MemberCard>

<a id="freevariables" name="freevariables"></a>

<MemberCard>

##### BoxedExpression.freeVariables

```ts
readonly freeVariables: readonly string[];
```

All the identifiers (symbols and functions) in the expression that are
not a local variable or a parameter of that function.

</MemberCard>

<a id="errors" name="errors"></a>

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

<a id="operator" name="operator"></a>

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

<a id="ispure" name="ispure"></a>

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
`this.evaluate()` to determine the value of the expression instead.

As an example, the `Random` function is not pure.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="isconstant" name="isconstant"></a>

<MemberCard>

##### BoxedExpression.isConstant

```ts
readonly isConstant: boolean;
```

True if the the value of the expression does not depend on the value of
any other expression.

For example, a number literal, a symbol with a constant value.
- `2` is constant
- `Pi` is constant
- `["Add", "Pi", 2]` is constant
- `x` is not constant
- `["Add", "x", 2]` is not constant

</MemberCard>

<a id="canonical" name="canonical"></a>

<MemberCard>

##### BoxedExpression.canonical

###### Get Signature

```ts
get canonical(): BoxedExpression
```

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

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="structural" name="structural"></a>

<MemberCard>

##### BoxedExpression.structural

###### Get Signature

```ts
get structural(): BoxedExpression
```

Return the structural form of this expression.

Some expressions, such as rational numbers, are represented with
a `BoxedExpression` object. In some cases, for example when doing a
structural comparison of two expressions, it is useful to have a
structural representation of the expression where the rational numbers
is represented by a function expression instead.

If there is a structural representation of the expression, return it,
otherwise return `this`.

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="subs" name="subs"></a>

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

###### sub

[`Substitution`](#substitutiont)

###### options?

###### canonical

[`CanonicalOptions`](#canonicaloptions)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="map" name="map"></a>

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

###### fn

(`expr`) => [`BoxedExpression`](#boxedexpression)

###### options?

###### canonical

[`CanonicalOptions`](#canonicaloptions)

###### recursive

`boolean`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="replace" name="replace"></a>

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

###### rules

[`Rule`](#rule) | [`BoxedRuleSet`](#boxedruleset) | [`Rule`](#rule)[]

###### options?

`Partial`\<[`ReplaceOptions`](#replaceoptions)\>

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="has" name="has"></a>

<MemberCard>

##### BoxedExpression.has()

```ts
has(v): boolean
```

True if the expression includes a symbol `v` or a function operator `v`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

###### v

`string` | `string`[]

`boolean`

</MemberCard>

<a id="numerator-1" name="numerator-1"></a>

<MemberCard>

##### BoxedExpression.numerator

###### Get Signature

```ts
get numerator(): BoxedExpression
```

Return this expression expressed as a numerator and denominator.

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="denominator-1" name="denominator-1"></a>

<MemberCard>

##### BoxedExpression.denominator

###### Get Signature

```ts
get denominator(): BoxedExpression
```

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="numeratordenominator" name="numeratordenominator"></a>

<MemberCard>

##### BoxedExpression.numeratorDenominator

###### Get Signature

```ts
get numeratorDenominator(): [BoxedExpression, BoxedExpression]
```

\[[`BoxedExpression`](#boxedexpression), [`BoxedExpression`](#boxedexpression)\]

</MemberCard>

<a id="match" name="match"></a>

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

###### pattern

[`BoxedExpression`](#boxedexpression)

###### options?

[`PatternMatchOptions`](#patternmatchoptions)

[`BoxedSubstitution`](#boxedsubstitution)

</MemberCard>

<a id="isfunctionexpression" name="isfunctionexpression"></a>

<MemberCard>

##### BoxedExpression.isFunctionExpression

```ts
readonly isFunctionExpression: boolean;
```

Return `true` if this expression is a function expression.

If `true`, `this.ops` is not `null`, and `this.operator` is the name
of the function.

</MemberCard>

<a id="tonumericvalue" name="tonumericvalue"></a>

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

\[[`NumericValue`](#numericvalue), [`BoxedExpression`](#boxedexpression)\]

</MemberCard>

<a id="neg-4" name="neg-4"></a>

<MemberCard>

##### BoxedExpression.neg()

```ts
neg(): BoxedExpression
```

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="inv-1" name="inv-1"></a>

<MemberCard>

##### BoxedExpression.inv()

```ts
inv(): BoxedExpression
```

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="abs-1" name="abs-1"></a>

<MemberCard>

##### BoxedExpression.abs()

```ts
abs(): BoxedExpression
```

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="add-5" name="add-5"></a>

<MemberCard>

##### BoxedExpression.add()

```ts
add(rhs): BoxedExpression
```

###### rhs

`number` | [`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="sub-4" name="sub-4"></a>

<MemberCard>

##### BoxedExpression.sub()

```ts
sub(rhs): BoxedExpression
```

###### rhs

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="mul-4" name="mul-4"></a>

<MemberCard>

##### BoxedExpression.mul()

```ts
mul(rhs): BoxedExpression
```

###### rhs

`number` | [`NumericValue`](#numericvalue) | [`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="div-4" name="div-4"></a>

<MemberCard>

##### BoxedExpression.div()

```ts
div(rhs): BoxedExpression
```

###### rhs

`number` | [`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="pow-4" name="pow-4"></a>

<MemberCard>

##### BoxedExpression.pow()

```ts
pow(exp): BoxedExpression
```

###### exp

`number` | [`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="root-1" name="root-1"></a>

<MemberCard>

##### BoxedExpression.root()

```ts
root(exp): BoxedExpression
```

###### exp

`number` | [`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="sqrt-1" name="sqrt-1"></a>

<MemberCard>

##### BoxedExpression.sqrt()

```ts
sqrt(): BoxedExpression
```

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="ln-1" name="ln-1"></a>

<MemberCard>

##### BoxedExpression.ln()

```ts
ln(base?): BoxedExpression
```

###### base?

`number` | [`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="shape-1" name="shape-1"></a>

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

<a id="rank-1" name="rank-1"></a>

<MemberCard>

##### BoxedExpression.rank

```ts
readonly rank: number;
```

Return 0 for a scalar, 1 for a vector, 2 for a matrix, > 2 for
a multidimensional matrix.

The rank is equivalent to the length of `expr.shape`

</MemberCard>

<a id="wikidata" name="wikidata"></a>

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

<a id="description" name="description"></a>

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

<a id="url" name="url"></a>

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

<a id="complexity" name="complexity"></a>

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

<a id="basedefinition" name="basedefinition"></a>

<MemberCard>

##### BoxedExpression.baseDefinition

```ts
readonly baseDefinition: BoxedBaseDefinition;
```

For symbols and functions, a definition associated with the
 expression. `this.baseDefinition` is the base class of symbol and function
 definition.

:::info[Note]
`undefined` if not a canonical expression.
:::

</MemberCard>

<a id="functiondefinition" name="functiondefinition"></a>

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

<a id="symboldefinition" name="symboldefinition"></a>

<MemberCard>

##### BoxedExpression.symbolDefinition

```ts
readonly symbolDefinition: BoxedSymbolDefinition;
```

For symbols, a definition associated with the expression.

Return `undefined` if not a symbol

</MemberCard>

<a id="simplify" name="simplify"></a>

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

###### options?

`Partial`\<[`SimplifyOptions`](#simplifyoptions)\>

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="expand" name="expand"></a>

<MemberCard>

##### BoxedExpression.expand()

```ts
expand(): BoxedExpression
```

Expand the expression: distribute multiplications over additions,
and expand powers.

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="evaluate" name="evaluate"></a>

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

###### options?

`Partial`\<[`EvaluateOptions`](#evaluateoptions)\>

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="evaluateasync" name="evaluateasync"></a>

<MemberCard>

##### BoxedExpression.evaluateAsync()

```ts
evaluateAsync(options?): Promise<BoxedExpression>
```

Asynchronous version of `evaluate()`.

The `options` argument can include a `signal` property, which is an
`AbortSignal` object. If the signal is aborted, a `CancellationError` is thrown.

###### options?

`Partial`\<[`EvaluateOptions`](#evaluateoptions)\>

`Promise`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="n-1" name="n-1"></a>

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

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="compile" name="compile"></a>

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

###### options?

###### to

`"javascript"`

###### optimize

(`"evaluate"` \| `"simplify"`)[]

###### functions

`Record`\<`string`, `string` \| (...`any`) => `any`\>

###### vars

`Record`\<`string`, [`CompiledType`](#compiledtype)\>

###### imports

`unknown`[]

###### preamble

`string`

`Function`

###### args?

`Record`\<`string`, [`CompiledType`](#compiledtype)\>

[`CompiledType`](#compiledtype)

</MemberCard>

<a id="solve" name="solve"></a>

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

###### vars?

`string` | `Iterable`\<`string`\> | [`BoxedExpression`](#boxedexpression) | `Iterable`\<[`BoxedExpression`](#boxedexpression)\>

readonly [`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="value" name="value"></a>

<MemberCard>

##### BoxedExpression.value

###### Get Signature

```ts
get value(): string | number | boolean | object
```

Return a JavaScript primitive representing the value of this expression.

Equivalent to `expr.N().valueOf()`.

`string` \| `number` \| `boolean` \| `object`

```ts
set value(value): void
```

Only the value of variables can be changed (symbols that are not
constants).

Throws a runtime error if a constant.

:::info[Note]
If non-canonical, does nothing
:::

###### Parameters

###### value

`string` | `number` | `boolean` | `number`[] | `Decimal` | [`BoxedExpression`](#boxedexpression) | \{
`re`: `number`;
`im`: `number`;
\} | \{
`num`: `number`;
`denom`: `number`;
\}

`void`

</MemberCard>

<a id="type-2" name="type-2"></a>

<MemberCard>

##### BoxedExpression.type

###### Get Signature

```ts
get type(): BoxedType
```

The type of the value of this expression.

If a function expression, the type of the value of the function
(the result type).

If a symbol the type of the value of the symbol.

:::info[Note]
If not valid, return `"error"`.
If non-canonical, return `undefined`.
If the type is not known, return `"unknown"`.
:::

[`BoxedType`](#boxedtype)

```ts
set type(type): void
```

###### Parameters

###### type

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`MapType`](#maptype) | [`TupleType`](#tupletype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference) | [`BoxedType`](#boxedtype)

`void`

</MemberCard>

<a id="iscollection" name="iscollection"></a>

<MemberCard>

##### BoxedExpression.isCollection

```ts
isCollection: boolean;
```

Return true if the expression is a collection: a list, a vector, a matrix, a map, a tuple, etc...

</MemberCard>

<a id="contains" name="contains"></a>

<MemberCard>

##### BoxedExpression.contains()

```ts
contains(rhs): boolean
```

If this is a collection, return true if the `rhs` expression is in the
collection.

Return `undefined` if the membership cannot be determined.

###### rhs

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="size" name="size"></a>

<MemberCard>

##### BoxedExpression.size

###### Get Signature

```ts
get size(): number
```

If this is a collection, return the number of elements in the collection.

If the collection is infinite, return `Infinity`.

`number`

</MemberCard>

<a id="each" name="each"></a>

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

###### start?

`number`

###### count?

`number`

`Iterator`\<[`BoxedExpression`](#boxedexpression), `undefined`\>

</MemberCard>

<a id="at-1" name="at-1"></a>

<MemberCard>

##### BoxedExpression.at()

```ts
at(index): BoxedExpression
```

If this is an indexable collection, return the element at the specified
 index.

If the index is negative, return the element at index `size() + index + 1`.

###### index

`number`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="get" name="get"></a>

<MemberCard>

##### BoxedExpression.get()

```ts
get(key): BoxedExpression
```

If this is a map or a tuple, return the value of the corresponding key.

If `key` is a `BoxedExpression`, it should be a string.

###### key

`string` | [`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="indexof" name="indexof"></a>

<MemberCard>

##### BoxedExpression.indexOf()

```ts
indexOf(expr): number
```

If this is an indexable collection, return the index of the first element
that matches the target expression.

###### expr

[`BoxedExpression`](#boxedexpression)

`number`

</MemberCard>

#### Primitive Methods

<a id="valueof-2" name="valueof-2"></a>

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

`any`

</MemberCard>

<a id="tostring-1" name="tostring-1"></a>

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

`string`

</MemberCard>

<a id="print-1" name="print-1"></a>

<MemberCard>

##### BoxedExpression.print()

```ts
print(): void
```

Output to the console a string representation of the expression.

`void`

</MemberCard>

<a id="toprimitive-2" name="toprimitive-2"></a>

<MemberCard>

##### BoxedExpression.\[toPrimitive\]()

```ts
toPrimitive: string | number
```

Similar to`expr.valueOf()` but includes a hint.

###### hint

`"string"` | `"number"` | `"default"`

`string` \| `number`

</MemberCard>

<a id="tojson-2" name="tojson-2"></a>

<MemberCard>

##### BoxedExpression.toJSON()

```ts
toJSON(): Expression
```

Used by `JSON.stringify()` to serialize this object to JSON.

Method version of `expr.json`.

[`Expression`](#expression)

</MemberCard>

<a id="is-1" name="is-1"></a>

<MemberCard>

##### BoxedExpression.is()

```ts
is(rhs): boolean
```

Equivalent to `BoxedExpression.isSame()` but the argument can be
a JavaScript primitive. For example, `expr.is(2)` is equivalent to
`expr.isSame(ce.number(2))`.

###### rhs

`any`

`boolean`

</MemberCard>

#### Relational Operator

<a id="issame" name="issame"></a>

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

###### rhs

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="isless" name="isless"></a>

<MemberCard>

##### BoxedExpression.isLess()

```ts
isLess(other): boolean
```

If the expressions cannot be compared, return `undefined`

The numeric value of both expressions are compared.

The expressions are evaluated before being compared, which may be
expensive.

###### other

`number` | [`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="islessequal" name="islessequal"></a>

<MemberCard>

##### BoxedExpression.isLessEqual()

```ts
isLessEqual(other): boolean
```

The numeric value of both expressions are compared.

###### other

`number` | [`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="isgreater" name="isgreater"></a>

<MemberCard>

##### BoxedExpression.isGreater()

```ts
isGreater(other): boolean
```

The numeric value of both expressions are compared.

###### other

`number` | [`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="isgreaterequal" name="isgreaterequal"></a>

<MemberCard>

##### BoxedExpression.isGreaterEqual()

```ts
isGreaterEqual(other): boolean
```

The numeric value of both expressions are compared.

###### other

`number` | [`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="isequal" name="isequal"></a>

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

###### other

`number` | [`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

#### String Expression

<a id="string" name="string"></a>

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

<a id="symbol" name="symbol"></a>

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

<a id="tensor" name="tensor"></a>

<MemberCard>

##### BoxedExpression.tensor

```ts
readonly tensor: AbstractTensor<"expression">;
```

</MemberCard>

<a id="isvalid" name="isvalid"></a>

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

<a id="isnumber" name="isnumber"></a>

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

<a id="isinteger" name="isinteger"></a>

<MemberCard>

##### BoxedExpression.isInteger

```ts
readonly isInteger: boolean;
```

The value of this expression is an element of the set ℤ: ...,-2, -1, 0, 1, 2...

Note that ±∞ and NaN are not integers.

</MemberCard>

<a id="isrational" name="isrational"></a>

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

<a id="isreal" name="isreal"></a>

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

<a id="replaceoptions" name="replaceoptions"></a>

### ReplaceOptions

```ts
type ReplaceOptions = object;
```

#### Type declaration

<a id="recursive-1"></a>

##### recursive

<a id="recursive-1" name="recursive-1"></a>

<MemberCard>

##### ReplaceOptions.recursive

```ts
recursive: boolean;
```

If `true`, apply replacement rules to all sub-expressions.

If `false`, only consider the top-level expression.

**Default**: `false`

</MemberCard>

<a id="once"></a>

##### once

<a id="once" name="once"></a>

<MemberCard>

##### ReplaceOptions.once

```ts
once: boolean;
```

If `true`, stop after the first rule that matches.

If `false`, apply all the remaining rules even after the first match.

**Default**: `false`

</MemberCard>

<a id="usevariations-1"></a>

##### useVariations

<a id="usevariations-1" name="usevariations-1"></a>

<MemberCard>

##### ReplaceOptions.useVariations

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

</MemberCard>

<a id="iterationlimit"></a>

##### iterationLimit

<a id="iterationlimit" name="iterationlimit"></a>

<MemberCard>

##### ReplaceOptions.iterationLimit

```ts
iterationLimit: number;
```

If `iterationLimit` > 1, the rules will be repeatedly applied
until no rules apply, up to `maxIterations` times.

Note that if `once` is true, `iterationLimit` has no effect.

**Default**: `1`

</MemberCard>

<a id="canonical-1"></a>

##### canonical

<a id="canonical-1" name="canonical-1"></a>

<MemberCard>

##### ReplaceOptions.canonical

```ts
canonical: CanonicalOptions;
```

Indicate if the expression should be canonicalized after the replacement.
If not provided, the expression is canonicalized if the expression
that matched the pattern is canonical.

</MemberCard>

<a id="rational-1" name="rational-1"></a>

### Rational

```ts
type Rational = 
  | [SmallInteger, SmallInteger]
  | [bigint, bigint];
```

<a id="evaluateoptions" name="evaluateoptions"></a>

### EvaluateOptions

```ts
type EvaluateOptions = object;
```

Options for `BoxedExpression.evaluate()`

#### Type declaration

<a id="numericapproximation"></a>

##### numericApproximation

<a id="numericapproximation" name="numericapproximation"></a>

<MemberCard>

##### EvaluateOptions.numericApproximation

```ts
numericApproximation: boolean;
```

</MemberCard>

<a id="signal"></a>

##### signal

<a id="signal" name="signal"></a>

<MemberCard>

##### EvaluateOptions.signal

```ts
signal: AbortSignal;
```

</MemberCard>

<a id="canonicalform" name="canonicalform"></a>

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
   application (`f(x)`).
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

<a id="metadata-1" name="metadata-1"></a>

### Metadata

```ts
type Metadata = object;
```

Metadata that can be associated with a `BoxedExpression`

#### Type declaration

<a id="latex-1"></a>

##### latex?

<a id="latex-1" name="latex-1"></a>

<MemberCard>

##### Metadata.latex?

```ts
optional latex: string;
```

</MemberCard>

<a id="wikidata-4"></a>

##### wikidata?

<a id="wikidata-4" name="wikidata-4"></a>

<MemberCard>

##### Metadata.wikidata?

```ts
optional wikidata: string;
```

</MemberCard>

<a id="substitutiont" name="substitutiont"></a>

### Substitution\<T\>

```ts
type Substitution<T> = object;
```

A substitution describes the values of the wildcards in a pattern so that
the pattern is equal to a target expression.

A substitution can also be considered a more constrained version of a
rule whose `match` is always a symbol.

#### Type Parameters

• **T** = [`SemiBoxedExpression`](#semiboxedexpression)

#### Index Signature

```ts
[symbol: string]: T
```

<a id="boxedsubstitution" name="boxedsubstitution"></a>

### BoxedSubstitution

```ts
type BoxedSubstitution = Substitution<BoxedExpression>;
```

## Pattern Matching

<a id="patternmatchoptions" name="patternmatchoptions"></a>

### PatternMatchOptions

```ts
type PatternMatchOptions = object;
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

#### Type declaration

<a id="substitution"></a>

##### substitution?

<a id="substitution" name="substitution"></a>

<MemberCard>

##### PatternMatchOptions.substitution?

```ts
optional substitution: BoxedSubstitution;
```

</MemberCard>

<a id="recursive"></a>

##### recursive?

<a id="recursive" name="recursive"></a>

<MemberCard>

##### PatternMatchOptions.recursive?

```ts
optional recursive: boolean;
```

</MemberCard>

<a id="usevariations"></a>

##### useVariations?

<a id="usevariations" name="usevariations"></a>

<MemberCard>

##### PatternMatchOptions.useVariations?

```ts
optional useVariations: boolean;
```

</MemberCard>

## Rules

<a id="rulereplacefunction" name="rulereplacefunction"></a>

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

##### expr

[`BoxedExpression`](#boxedexpression)

##### wildcards

[`BoxedSubstitution`](#boxedsubstitution)

[`BoxedExpression`](#boxedexpression) \| `undefined`

<a id="ruleconditionfunction" name="ruleconditionfunction"></a>

### RuleConditionFunction()

```ts
type RuleConditionFunction = (wildcards, ce) => boolean;
```

##### wildcards

[`BoxedSubstitution`](#boxedsubstitution)

##### ce

`IComputeEngine`

`boolean`

<a id="rulefunction" name="rulefunction"></a>

### RuleFunction()

```ts
type RuleFunction = (expr) => 
  | undefined
  | BoxedExpression
  | RuleStep;
```

##### expr

[`BoxedExpression`](#boxedexpression)

  \| `undefined`
  \| [`BoxedExpression`](#boxedexpression)
  \| [`RuleStep`](#rulestep)

<a id="rulestep" name="rulestep"></a>

### RuleStep

```ts
type RuleStep = object;
```

#### Type declaration

<a id="value-2"></a>

##### value

<a id="value-2" name="value-2"></a>

<MemberCard>

##### RuleStep.value

```ts
value: BoxedExpression;
```

</MemberCard>

<a id="because"></a>

##### because

<a id="because" name="because"></a>

<MemberCard>

##### RuleStep.because

```ts
because: string;
```

</MemberCard>

<a id="rulesteps" name="rulesteps"></a>

### RuleSteps

```ts
type RuleSteps = RuleStep[];
```

<a id="rule" name="rule"></a>

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

<a id="boxedrule" name="boxedrule"></a>

### BoxedRule

```ts
type BoxedRule = object;
```

If the `match` property is `undefined`, all expressions match this rule
and `condition` should also be `undefined`. The `replace` property should
be a `BoxedExpression` or a `RuleFunction`, and further filtering can be
done in the `replace` function.

#### Type declaration

<a id="match-1"></a>

##### match

<a id="match-1" name="match-1"></a>

<MemberCard>

##### BoxedRule.match

```ts
match: undefined | BoxedExpression;
```

</MemberCard>

<a id="replace-1"></a>

##### replace

<a id="replace-1" name="replace-1"></a>

<MemberCard>

##### BoxedRule.replace

```ts
replace: 
  | BoxedExpression
  | RuleReplaceFunction
  | RuleFunction;
```

</MemberCard>

<a id="condition"></a>

##### condition

<a id="condition" name="condition"></a>

<MemberCard>

##### BoxedRule.condition

```ts
condition: 
  | undefined
  | RuleConditionFunction;
```

</MemberCard>

<a id="usevariations-2"></a>

##### useVariations?

<a id="usevariations-2" name="usevariations-2"></a>

<MemberCard>

##### BoxedRule.useVariations?

```ts
optional useVariations: boolean;
```

</MemberCard>

<a id="id"></a>

##### id?

<a id="id" name="id"></a>

<MemberCard>

##### BoxedRule.id?

```ts
optional id: string;
```

</MemberCard>

<a id="boxedruleset" name="boxedruleset"></a>

### BoxedRuleSet

```ts
type BoxedRuleSet = object;
```

To create a BoxedRuleSet use the `ce.rules()` method.

Do not create a `BoxedRuleSet` directly.

#### Type declaration

<a id="rules-1"></a>

##### rules

<a id="rules-1" name="rules-1"></a>

<MemberCard>

##### BoxedRuleSet.rules

```ts
rules: ReadonlyArray<BoxedRule>;
```

</MemberCard>

## Assumptions

<a id="expressionmapinterfaceu" name="expressionmapinterfaceu"></a>

### ExpressionMapInterface\<U\>

#### Type Parameters

• **U**

<a id="has-1" name="has-1"></a>

<MemberCard>

##### ExpressionMapInterface.has()

```ts
has(expr): boolean
```

###### expr

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="get-1" name="get-1"></a>

<MemberCard>

##### ExpressionMapInterface.get()

```ts
get(expr): U
```

###### expr

[`BoxedExpression`](#boxedexpression)

`U`

</MemberCard>

<a id="set" name="set"></a>

<MemberCard>

##### ExpressionMapInterface.set()

```ts
set(expr, value): void
```

###### expr

[`BoxedExpression`](#boxedexpression)

###### value

`U`

`void`

</MemberCard>

<a id="delete" name="delete"></a>

<MemberCard>

##### ExpressionMapInterface.delete()

```ts
delete(expr): void
```

###### expr

[`BoxedExpression`](#boxedexpression)

`void`

</MemberCard>

<a id="clear" name="clear"></a>

<MemberCard>

##### ExpressionMapInterface.clear()

```ts
clear(): void
```

`void`

</MemberCard>

<a id="iterator" name="iterator"></a>

<MemberCard>

##### ExpressionMapInterface.\[iterator\]()

```ts
iterator: IterableIterator<[BoxedExpression, U]>
```

`IterableIterator`\<\[[`BoxedExpression`](#boxedexpression), `U`\]\>

</MemberCard>

<a id="entries" name="entries"></a>

<MemberCard>

##### ExpressionMapInterface.entries()

```ts
entries(): IterableIterator<[BoxedExpression, U]>
```

`IterableIterator`\<\[[`BoxedExpression`](#boxedexpression), `U`\]\>

</MemberCard>

<a id="assumeresult" name="assumeresult"></a>

### AssumeResult

```ts
type AssumeResult = 
  | "internal-error"
  | "not-a-predicate"
  | "contradiction"
  | "tautology"
  | "ok";
```

## Compiling

<a id="compiledtype" name="compiledtype"></a>

### CompiledType

```ts
type CompiledType = boolean | number | string | object;
```

<a id="compiledexpression" name="compiledexpression"></a>

### CompiledExpression

```ts
type CompiledExpression = object;
```

#### Type declaration

<a id="evaluate-1"></a>

##### evaluate()?

<a id="evaluate-1" name="evaluate-1"></a>

<MemberCard>

##### CompiledExpression.evaluate()?

```ts
optional evaluate: (scope) => number | BoxedExpression;
```

###### scope

`number` \| [`BoxedExpression`](#boxedexpression)

</MemberCard>

## Definitions

<a id="eqhandlers" name="eqhandlers"></a>

### EqHandlers

```ts
type EqHandlers = object;
```

These handlers compare two expressions.

If only one of the handlers is provided, the other is derived from it.

Having both may be useful if comparing non-equality is faster than equality.

#### Type declaration

<a id="eq-2"></a>

##### eq()

<a id="eq-2" name="eq-2"></a>

<MemberCard>

##### EqHandlers.eq()

```ts
eq: (a, b) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

###### b

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

<a id="neq-1"></a>

##### neq()

<a id="neq-1" name="neq-1"></a>

<MemberCard>

##### EqHandlers.neq()

```ts
neq: (a, b) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

###### b

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

<a id="hold" name="hold"></a>

### Hold

```ts
type Hold = "none" | "all" | "first" | "rest" | "last" | "most";
```

<a id="symboldefinition-1" name="symboldefinition-1"></a>

### SymbolDefinition

```ts
type SymbolDefinition = BaseDefinition & Partial<SymbolAttributes> & object;
```

A bound symbol (i.e. one with an associated definition) has either a type
(e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... type = 'real')

#### Type declaration

##### type?

<MemberCard>

##### SymbolDefinition.type?

```ts
optional type: 
  | Type
  | TypeString;
```

</MemberCard>

##### inferred?

<MemberCard>

##### SymbolDefinition.inferred?

```ts
optional inferred: boolean;
```

If true, the type is inferred, and could be adjusted later
as more information becomes available or if the symbol is explicitly
declared.

</MemberCard>

##### value?

<MemberCard>

##### SymbolDefinition.value?

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

##### flags?

<MemberCard>

##### SymbolDefinition.flags?

```ts
optional flags: Partial<NumericFlags>;
```

</MemberCard>

##### eq()?

<MemberCard>

##### SymbolDefinition.eq()?

```ts
optional eq: (a) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

##### neq()?

<MemberCard>

##### SymbolDefinition.neq()?

```ts
optional neq: (a) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

##### cmp()?

<MemberCard>

##### SymbolDefinition.cmp()?

```ts
optional cmp: (a) => "=" | ">" | "<" | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

`"="` \| `">"` \| `"<"` \| `undefined`

</MemberCard>

##### collection?

<MemberCard>

##### SymbolDefinition.collection?

```ts
optional collection: Partial<CollectionHandlers>;
```

</MemberCard>

<a id="functiondefinition-1" name="functiondefinition-1"></a>

### FunctionDefinition

```ts
type FunctionDefinition = BaseDefinition & Partial<FunctionDefinitionFlags> & object;
```

Definition record for a function.

#### Type declaration

##### signature?

<MemberCard>

##### FunctionDefinition.signature?

```ts
optional signature: 
  | Type
  | TypeString;
```

The function signature.

If a `type` handler is provided, the return type of the function should
be a subtype of the return type in the signature.

</MemberCard>

##### type()?

<MemberCard>

##### FunctionDefinition.type()?

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

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

  \| [`Type`](#type-2)
  \| [`TypeString`](#typestring)
  \| [`BoxedType`](#boxedtype)
  \| `undefined`

</MemberCard>

##### sgn()?

<MemberCard>

##### FunctionDefinition.sgn()?

```ts
optional sgn: (ops, options) => Sign | undefined;
```

Return the sign of the function expression.

If the sign cannot be determined, return `undefined`.

When determining the sign, only literal values and the values of
symbols, if they are literals, should be considered.

Do not evaluate the arguments.

The type and sign of the arguments can be used to determine the sign.

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

[`Sign`](#sign) \| `undefined`

</MemberCard>

##### even()?

<MemberCard>

##### FunctionDefinition.even()?

```ts
optional even: (ops, options) => boolean | undefined;
```

Return true of the function expression is even, false if it is odd and
undefined if it is neither.

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

`boolean` \| `undefined`

</MemberCard>

##### complexity?

<MemberCard>

##### FunctionDefinition.complexity?

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

</MemberCard>

##### canonical()?

<MemberCard>

##### FunctionDefinition.canonical()?

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

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

[`BoxedExpression`](#boxedexpression) \| `null`

</MemberCard>

##### evaluate?

<MemberCard>

##### FunctionDefinition.evaluate?

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

</MemberCard>

##### evaluateAsync()?

<MemberCard>

##### FunctionDefinition.evaluateAsync()?

```ts
optional evaluateAsync: (ops, options) => Promise<BoxedExpression | undefined>;
```

An option asynchronous version of `evaluate`.

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

[`EvaluateOptions`](#evaluateoptions) & `object`

`Promise`\<[`BoxedExpression`](#boxedexpression) \| `undefined`\>

</MemberCard>

##### evalDimension()?

<MemberCard>

##### FunctionDefinition.evalDimension()?

```ts
optional evalDimension: (args, options) => BoxedExpression;
```

**`Experimental`**

Dimensional analysis

###### args

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

[`EvaluateOptions`](#evaluateoptions) & `object`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

##### compile()?

<MemberCard>

##### FunctionDefinition.compile()?

```ts
optional compile: (expr) => CompiledExpression;
```

Return a compiled (optimized) expression.

###### expr

[`BoxedExpression`](#boxedexpression)

[`CompiledExpression`](#compiledexpression)

</MemberCard>

##### eq()?

<MemberCard>

##### FunctionDefinition.eq()?

```ts
optional eq: (a, b) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

###### b

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

##### neq()?

<MemberCard>

##### FunctionDefinition.neq()?

```ts
optional neq: (a, b) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

###### b

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

##### collection?

<MemberCard>

##### FunctionDefinition.collection?

```ts
optional collection: Partial<CollectionHandlers>;
```

</MemberCard>

<a id="basedefinition-1" name="basedefinition-1"></a>

### BaseDefinition

```ts
type BaseDefinition = object;
```

#### Type declaration

<a id="description-3"></a>

##### description?

<a id="description-3" name="description-3"></a>

<MemberCard>

##### BaseDefinition.description?

```ts
optional description: string | string[];
```

A short (about 1 line) description. May contain Markdown.

</MemberCard>

<a id="url-3"></a>

##### url?

<a id="url-3" name="url-3"></a>

<MemberCard>

##### BaseDefinition.url?

```ts
optional url: string;
```

A URL pointing to more information about this symbol or operator.

</MemberCard>

<a id="wikidata-3"></a>

##### wikidata?

<a id="wikidata-3" name="wikidata-3"></a>

<MemberCard>

##### BaseDefinition.wikidata?

```ts
optional wikidata: string;
```

A short string representing an entry in a wikibase.

For example `Q167` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
for the `Pi` constant.

</MemberCard>

<a id="identifierdefinition" name="identifierdefinition"></a>

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

<a id="identifierdefinitions" name="identifierdefinitions"></a>

### IdentifierDefinitions

```ts
type IdentifierDefinitions = Readonly<{}>;
```

<a id="numericflags" name="numericflags"></a>

### NumericFlags

```ts
type NumericFlags = object;
```

When used in a `SymbolDefinition` or `Functiondefinition` these flags
provide additional information about the value of the symbol or function.

If provided, they will override the value derived from
the symbol's value.

#### Type declaration

<a id="sgn-3"></a>

##### sgn

<a id="sgn-3" name="sgn-3"></a>

<MemberCard>

##### NumericFlags.sgn

```ts
sgn: Sign | undefined;
```

</MemberCard>

<a id="even-1"></a>

##### even

<a id="even-1" name="even-1"></a>

<MemberCard>

##### NumericFlags.even

```ts
even: boolean | undefined;
```

</MemberCard>

<a id="odd-1"></a>

##### odd

<a id="odd-1" name="odd-1"></a>

<MemberCard>

##### NumericFlags.odd

```ts
odd: boolean | undefined;
```

</MemberCard>

<a id="collectionhandlers" name="collectionhandlers"></a>

### CollectionHandlers

```ts
type CollectionHandlers = object;
```

These handlers are the primitive operations that can be performed on
collections.

There are two types of collections:

- finite collections, such as lists, tuples, sets, matrices, etc...
 The `size()` handler of finite collections returns the number of elements

- infinite collections, such as sequences, ranges, etc...
 The `size()` handler of infinite collections returns `Infinity`
 Infinite collections are not indexable: they have no `at()` handler.

#### Type declaration

#### Definitions

<a id="iterator-1"></a>

###### iterator()

<a id="iterator-1" name="iterator-1"></a>

<MemberCard>

###### CollectionHandlers.iterator()

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

###### collection

[`BoxedExpression`](#boxedexpression)

###### start?

`number`

###### count?

`number`

`Iterator`\<[`BoxedExpression`](#boxedexpression), `undefined`\>

</MemberCard>

#### Other

<a id="size-1"></a>

###### size()

<a id="size-1" name="size-1"></a>

<MemberCard>

###### CollectionHandlers.size()

```ts
size: (collection) => number;
```

Return the number of elements in the collection.

An empty collection has a size of 0.

###### collection

[`BoxedExpression`](#boxedexpression)

`number`

</MemberCard>

<a id="contains-1"></a>

###### contains()

<a id="contains-1" name="contains-1"></a>

<MemberCard>

###### CollectionHandlers.contains()

```ts
contains: (collection, target) => boolean;
```

Return `true` if the target
expression is in the collection, `false` otherwise.

###### collection

[`BoxedExpression`](#boxedexpression)

###### target

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="at-2"></a>

###### at()

<a id="at-2" name="at-2"></a>

<MemberCard>

###### CollectionHandlers.at()

```ts
at: (collection, index) => undefined | BoxedExpression;
```

Return the element at the specified index.

The first element is `at(1)`, the last element is `at(-1)`.

If the index is &lt;0, return the element at index `size() + index + 1`.

The index can also be a string for example for maps. The set of valid keys
is returned by the `keys()` handler.

If the index is invalid, return `undefined`.

###### collection

[`BoxedExpression`](#boxedexpression)

###### index

`number` | `string`

`undefined` \| [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="keys"></a>

###### keys()

<a id="keys" name="keys"></a>

<MemberCard>

###### CollectionHandlers.keys()

```ts
keys: (collection) => undefined | Iterable<string>;
```

If the collection can be indexed by strings, return the valid values
for the index.

###### collection

[`BoxedExpression`](#boxedexpression)

`undefined` \| `Iterable`\<`string`\>

</MemberCard>

<a id="indexof-1"></a>

###### indexOf()

<a id="indexof-1" name="indexof-1"></a>

<MemberCard>

###### CollectionHandlers.indexOf()

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

###### collection

[`BoxedExpression`](#boxedexpression)

###### target

[`BoxedExpression`](#boxedexpression)

###### from?

`number`

`number` \| `undefined`

</MemberCard>

<a id="subsetof"></a>

###### subsetOf()

<a id="subsetof" name="subsetof"></a>

<MemberCard>

###### CollectionHandlers.subsetOf()

```ts
subsetOf: (collection, target, strict) => boolean;
```

Return `true` if all the elements of `target` are in `expr`.
Both `expr` and `target` are collections.
If strict is `true`, the subset must be strict, that is, `expr` must
have more elements than `target`.

###### collection

[`BoxedExpression`](#boxedexpression)

###### target

[`BoxedExpression`](#boxedexpression)

###### strict

`boolean`

`boolean`

</MemberCard>

<a id="eltsgn"></a>

###### eltsgn()

<a id="eltsgn" name="eltsgn"></a>

<MemberCard>

###### CollectionHandlers.eltsgn()

```ts
eltsgn: (collection) => Sign | undefined;
```

Return the sign of all the elements of the collection.

###### collection

[`BoxedExpression`](#boxedexpression)

[`Sign`](#sign) \| `undefined`

</MemberCard>

<a id="elttype"></a>

###### elttype()

<a id="elttype" name="elttype"></a>

<MemberCard>

###### CollectionHandlers.elttype()

```ts
elttype: (collection) => Type | undefined;
```

Return the widest type of all the elements in the collection

###### collection

[`BoxedExpression`](#boxedexpression)

[`Type`](#type-2) \| `undefined`

</MemberCard>

<a id="boxedbasedefinition" name="boxedbasedefinition"></a>

### BoxedBaseDefinition

#### Extended by

- [`BoxedSymbolDefinition`](#boxedsymboldefinition)

<a id="name" name="name"></a>

<MemberCard>

##### BoxedBaseDefinition.name

```ts
name: string;
```

</MemberCard>

<a id="wikidata-1" name="wikidata-1"></a>

<MemberCard>

##### BoxedBaseDefinition.wikidata?

```ts
optional wikidata: string;
```

</MemberCard>

<a id="description-1" name="description-1"></a>

<MemberCard>

##### BoxedBaseDefinition.description?

```ts
optional description: string | string[];
```

</MemberCard>

<a id="url-1" name="url-1"></a>

<MemberCard>

##### BoxedBaseDefinition.url?

```ts
optional url: string;
```

</MemberCard>

<a id="scope-1" name="scope-1"></a>

<MemberCard>

##### BoxedBaseDefinition.scope

```ts
scope: object;
```

The scope this definition belongs to.

This field is usually undefined, but its value is set by `getDefinition()`

<a id=""></a>

###### parentScope?

<MemberCard>

###### scope.parentScope?

```ts
optional parentScope: { parentScope?: ...; ids?: RuntimeIdentifierDefinitions; assumptions: ExpressionMapInterface<boolean>; };
```

</MemberCard>

<a id=""></a>

###### ids?

<MemberCard>

###### scope.ids?

```ts
optional ids: RuntimeIdentifierDefinitions;
```

</MemberCard>

<a id=""></a>

###### assumptions

<MemberCard>

###### scope.assumptions

```ts
assumptions: ExpressionMapInterface<boolean>;
```

</MemberCard>

</MemberCard>

<a id="collection" name="collection"></a>

<MemberCard>

##### BoxedBaseDefinition.collection?

```ts
optional collection: Partial<CollectionHandlers>;
```

If this is the definition of a collection, the set of primitive operations
that can be performed on this collection (counting the number of elements,
enumerating it, etc...).

</MemberCard>

<a id="reset" name="reset"></a>

<MemberCard>

##### BoxedBaseDefinition.reset()

```ts
reset(): void
```

When the environment changes, for example the numerical precision,
call `reset()` so that any cached values can be recalculated.

`void`

</MemberCard>

<a id="symbolattributes" name="symbolattributes"></a>

### SymbolAttributes

```ts
type SymbolAttributes = object;
```

#### Type declaration

<a id="constant-1"></a>

##### constant

<a id="constant-1" name="constant-1"></a>

<MemberCard>

##### SymbolAttributes.constant

```ts
constant: boolean;
```

If `true` the value of the symbol is constant. The value or type of
symbols with this attribute set to `true` cannot be changed.

If `false`, the symbol is a variable.

**Default**: `false`

</MemberCard>

<a id="holduntil-1"></a>

##### holdUntil

<a id="holduntil-1" name="holduntil-1"></a>

<MemberCard>

##### SymbolAttributes.holdUntil

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

<a id="sgn-2" name="sgn-2"></a>

<MemberCard>

##### BoxedSymbolDefinition.sgn?

```ts
optional sgn: Sign;
```

</MemberCard>

<a id="even" name="even"></a>

<MemberCard>

##### BoxedSymbolDefinition.even?

```ts
optional even: boolean;
```

</MemberCard>

<a id="odd" name="odd"></a>

<MemberCard>

##### BoxedSymbolDefinition.odd?

```ts
optional odd: boolean;
```

</MemberCard>

<a id="name-1" name="name-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.name

```ts
name: string;
```

</MemberCard>

<a id="wikidata-2" name="wikidata-2"></a>

<MemberCard>

##### BoxedSymbolDefinition.wikidata?

```ts
optional wikidata: string;
```

</MemberCard>

<a id="description-2" name="description-2"></a>

<MemberCard>

##### BoxedSymbolDefinition.description?

```ts
optional description: string | string[];
```

</MemberCard>

<a id="url-2" name="url-2"></a>

<MemberCard>

##### BoxedSymbolDefinition.url?

```ts
optional url: string;
```

</MemberCard>

<a id="scope-2" name="scope-2"></a>

<MemberCard>

##### BoxedSymbolDefinition.scope

```ts
scope: object;
```

The scope this definition belongs to.

This field is usually undefined, but its value is set by `getDefinition()`

<a id=""></a>

###### parentScope?

<MemberCard>

###### scope.parentScope?

```ts
optional parentScope: { parentScope?: ...; ids?: RuntimeIdentifierDefinitions; assumptions: ExpressionMapInterface<boolean>; };
```

</MemberCard>

<a id=""></a>

###### ids?

<MemberCard>

###### scope.ids?

```ts
optional ids: RuntimeIdentifierDefinitions;
```

</MemberCard>

<a id=""></a>

###### assumptions

<MemberCard>

###### scope.assumptions

```ts
assumptions: ExpressionMapInterface<boolean>;
```

</MemberCard>

</MemberCard>

<a id="collection-1" name="collection-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.collection?

```ts
optional collection: Partial<CollectionHandlers>;
```

If this is the definition of a collection, the set of primitive operations
that can be performed on this collection (counting the number of elements,
enumerating it, etc...).

</MemberCard>

<a id="constant" name="constant"></a>

<MemberCard>

##### BoxedSymbolDefinition.constant

```ts
constant: boolean;
```

If `true` the value of the symbol is constant. The value or type of
symbols with this attribute set to `true` cannot be changed.

If `false`, the symbol is a variable.

**Default**: `false`

</MemberCard>

<a id="holduntil" name="holduntil"></a>

<MemberCard>

##### BoxedSymbolDefinition.holdUntil

```ts
holdUntil: "never" | "N" | "evaluate";
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

<a id="isfunction" name="isfunction"></a>

<MemberCard>

##### BoxedSymbolDefinition.isFunction

```ts
readonly isFunction: boolean;
```

</MemberCard>

<a id="isconstant-1" name="isconstant-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.isConstant

```ts
readonly isConstant: boolean;
```

</MemberCard>

<a id="eq-1" name="eq-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.eq()?

```ts
optional eq: (a) => boolean;
```

###### a

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="neq" name="neq"></a>

<MemberCard>

##### BoxedSymbolDefinition.neq()?

```ts
optional neq: (a) => boolean;
```

###### a

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="cmp" name="cmp"></a>

<MemberCard>

##### BoxedSymbolDefinition.cmp()?

```ts
optional cmp: (a) => "<" | ">" | "=";
```

###### a

[`BoxedExpression`](#boxedexpression)

`"<"` \| `">"` \| `"="`

</MemberCard>

<a id="inferredtype" name="inferredtype"></a>

<MemberCard>

##### BoxedSymbolDefinition.inferredType

```ts
inferredType: boolean;
```

</MemberCard>

<a id="type-3" name="type-3"></a>

<MemberCard>

##### BoxedSymbolDefinition.type

```ts
type: BoxedType;
```

</MemberCard>

<a id="value-1" name="value-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.value

###### Get Signature

```ts
get value(): BoxedExpression
```

[`BoxedExpression`](#boxedexpression)

```ts
set value(val): void
```

###### Parameters

###### val

`number` | [`BoxedExpression`](#boxedexpression)

`void`

</MemberCard>

<a id="reset-1" name="reset-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.reset()

```ts
reset(): void
```

When the environment changes, for example the numerical precision,
call `reset()` so that any cached values can be recalculated.

`void`

</MemberCard>

<a id="functiondefinitionflags" name="functiondefinitionflags"></a>

### FunctionDefinitionFlags

```ts
type FunctionDefinitionFlags = object;
```

A function definition can have some flags to indicate specific
properties of the function.

#### Type declaration

<a id="lazy"></a>

##### lazy

<a id="lazy" name="lazy"></a>

<MemberCard>

##### FunctionDefinitionFlags.lazy

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

</MemberCard>

<a id="threadable"></a>

##### threadable

<a id="threadable" name="threadable"></a>

<MemberCard>

##### FunctionDefinitionFlags.threadable

```ts
threadable: boolean;
```

If `true`, the function is applied element by element to lists, matrices
(`["List"]` or `["Tuple"]` expressions) and equations (relational
operators).

**Default**: `false`

</MemberCard>

<a id="associative"></a>

##### associative

<a id="associative" name="associative"></a>

<MemberCard>

##### FunctionDefinitionFlags.associative

```ts
associative: boolean;
```

If `true`, `["f", ["f", a], b]` simplifies to `["f", a, b]`

**Default**: `false`

</MemberCard>

<a id="commutative"></a>

##### commutative

<a id="commutative" name="commutative"></a>

<MemberCard>

##### FunctionDefinitionFlags.commutative

```ts
commutative: boolean;
```

If `true`, `["f", a, b]` equals `["f", b, a]`. The canonical
version of the function will order the arguments.

**Default**: `false`

</MemberCard>

<a id="commutativeorder"></a>

##### commutativeOrder

<a id="commutativeorder" name="commutativeorder"></a>

<MemberCard>

##### FunctionDefinitionFlags.commutativeOrder

```ts
commutativeOrder: (a, b) => number | undefined;
```

If `commutative` is `true`, the order of the arguments is determined by
this function.

If the function is not provided, the arguments are ordered by the
default order of the arguments.

</MemberCard>

<a id="idempotent"></a>

##### idempotent

<a id="idempotent" name="idempotent"></a>

<MemberCard>

##### FunctionDefinitionFlags.idempotent

```ts
idempotent: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `["f", x]`.

**Default**: `false`

</MemberCard>

<a id="involution"></a>

##### involution

<a id="involution" name="involution"></a>

<MemberCard>

##### FunctionDefinitionFlags.involution

```ts
involution: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `x`.

**Default**: `false`

</MemberCard>

<a id="pure"></a>

##### pure

<a id="pure" name="pure"></a>

<MemberCard>

##### FunctionDefinitionFlags.pure

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

### BoxedFunctionDefinition

```ts
type BoxedFunctionDefinition = BoxedBaseDefinition & FunctionDefinitionFlags & object;
```

#### Type declaration

##### complexity

<MemberCard>

##### BoxedFunctionDefinition.complexity

```ts
complexity: number;
```

</MemberCard>

##### inferredSignature

<MemberCard>

##### BoxedFunctionDefinition.inferredSignature

```ts
inferredSignature: boolean;
```

If true, the signature was inferred from usage and may be modified
as more information becomes available.

</MemberCard>

##### signature

<MemberCard>

##### BoxedFunctionDefinition.signature

```ts
signature: BoxedType;
```

The type of the arguments and return value of this function

</MemberCard>

##### type()?

<MemberCard>

##### BoxedFunctionDefinition.type()?

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

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

  \| [`Type`](#type-2)
  \| [`TypeString`](#typestring)
  \| [`BoxedType`](#boxedtype)
  \| `undefined`

</MemberCard>

##### sgn()?

<MemberCard>

##### BoxedFunctionDefinition.sgn()?

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

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

[`Sign`](#sign) \| `undefined`

</MemberCard>

##### eq()?

<MemberCard>

##### BoxedFunctionDefinition.eq()?

```ts
optional eq: (a, b) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

###### b

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

##### neq()?

<MemberCard>

##### BoxedFunctionDefinition.neq()?

```ts
optional neq: (a, b) => boolean | undefined;
```

###### a

[`BoxedExpression`](#boxedexpression)

###### b

[`BoxedExpression`](#boxedexpression)

`boolean` \| `undefined`

</MemberCard>

##### canonical()?

<MemberCard>

##### BoxedFunctionDefinition.canonical()?

```ts
optional canonical: (ops, options) => BoxedExpression | null;
```

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

[`BoxedExpression`](#boxedexpression) \| `null`

</MemberCard>

##### evaluate()?

<MemberCard>

##### BoxedFunctionDefinition.evaluate()?

```ts
optional evaluate: (ops, options) => BoxedExpression | undefined;
```

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

`Partial`\<[`EvaluateOptions`](#evaluateoptions)\> & `object`

[`BoxedExpression`](#boxedexpression) \| `undefined`

</MemberCard>

##### evaluateAsync()?

<MemberCard>

##### BoxedFunctionDefinition.evaluateAsync()?

```ts
optional evaluateAsync: (ops, options?) => Promise<BoxedExpression | undefined>;
```

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options?

`Partial`\<[`EvaluateOptions`](#evaluateoptions)\> & `object`

`Promise`\<[`BoxedExpression`](#boxedexpression) \| `undefined`\>

</MemberCard>

##### evalDimension()?

<MemberCard>

##### BoxedFunctionDefinition.evalDimension()?

```ts
optional evalDimension: (ops, options) => BoxedExpression;
```

###### ops

`ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

###### options

###### engine

`IComputeEngine`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

##### compile()?

<MemberCard>

##### BoxedFunctionDefinition.compile()?

```ts
optional compile: (expr) => CompiledExpression;
```

###### expr

[`BoxedExpression`](#boxedexpression)

[`CompiledExpression`](#compiledexpression)

</MemberCard>

<a id="runtimeidentifierdefinitions" name="runtimeidentifierdefinitions"></a>

### RuntimeIdentifierDefinitions

```ts
type RuntimeIdentifierDefinitions = Map<string, OneOf<[BoxedSymbolDefinition, BoxedFunctionDefinition]>>;
```

The entries have been validated and optimized for faster evaluation.

When a new scope is created with `pushScope()` or when creating a new
engine instance, new instances of this type are created as needed.

## Latex Parsing and Serialization

<a id="latexstring" name="latexstring"></a>

### LatexString

```ts
type LatexString = string;
```

A LatexString is a regular string of LaTeX, for example:
`\frac{\pi}{2}`

<a id="delimiterscale" name="delimiterscale"></a>

### DelimiterScale

```ts
type DelimiterScale = "normal" | "scaled" | "big" | "none";
```

<a id="serializelatexoptions" name="serializelatexoptions"></a>

### SerializeLatexOptions

```ts
type SerializeLatexOptions = NumberSerializationFormat & object;
```

The LaTeX serialization options can used with the `expr.toLatex()` method.

#### Type declaration

##### prettify

<MemberCard>

##### SerializeLatexOptions.prettify

```ts
prettify: boolean;
```

If true, prettify the LaTeX output.

For example, render `\frac{a}{b}\frac{c}{d}` as `\frac{ac}{bd}`

</MemberCard>

##### invisibleMultiply

<MemberCard>

##### SerializeLatexOptions.invisibleMultiply

```ts
invisibleMultiply: LatexString;
```

LaTeX string used to render an invisible multiply, e.g. in '2x'.

If empty, both operands are concatenated, i.e. `2x`.

Use `\cdot` to insert a `\cdot` operator between them, i.e. `2 \cdot x`.

Empty by default.

</MemberCard>

##### invisiblePlus

<MemberCard>

##### SerializeLatexOptions.invisiblePlus

```ts
invisiblePlus: LatexString;
```

LaTeX string used to render [mixed numbers](https://en.wikipedia.org/wiki/Fraction#Mixed_numbers) e.g. '1 3/4'.

Leave it empty to join the main number and the fraction, i.e. render it
as `1\frac{3}{4}`.

Use `+` to insert an explicit `+` operator between them,
 i.e. `1+\frac{3}{4}`

Empty by default.

</MemberCard>

##### multiply

<MemberCard>

##### SerializeLatexOptions.multiply

```ts
multiply: LatexString;
```

LaTeX string used to render an explicit multiply operator.

For example, `\times`, `\cdot`, etc...

Default: `\times`

</MemberCard>

##### missingSymbol

<MemberCard>

##### SerializeLatexOptions.missingSymbol

```ts
missingSymbol: LatexString;
```

Serialize the expression `["Error", "'missing'"]`,  with this LaTeX string

</MemberCard>

##### applyFunctionStyle()

<MemberCard>

##### SerializeLatexOptions.applyFunctionStyle()

```ts
applyFunctionStyle: (expr, level) => DelimiterScale;
```

###### expr

[`Expression`](#expression)

###### level

`number`

[`DelimiterScale`](#delimiterscale)

</MemberCard>

##### groupStyle()

<MemberCard>

##### SerializeLatexOptions.groupStyle()

```ts
groupStyle: (expr, level) => DelimiterScale;
```

###### expr

[`Expression`](#expression)

###### level

`number`

[`DelimiterScale`](#delimiterscale)

</MemberCard>

##### rootStyle()

<MemberCard>

##### SerializeLatexOptions.rootStyle()

```ts
rootStyle: (expr, level) => "radical" | "quotient" | "solidus";
```

###### expr

[`Expression`](#expression)

###### level

`number`

`"radical"` \| `"quotient"` \| `"solidus"`

</MemberCard>

##### fractionStyle()

<MemberCard>

##### SerializeLatexOptions.fractionStyle()

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

###### expr

[`Expression`](#expression)

###### level

`number`

  \| `"quotient"`
  \| `"block-quotient"`
  \| `"inline-quotient"`
  \| `"inline-solidus"`
  \| `"nice-solidus"`
  \| `"reciprocal"`
  \| `"factor"`

</MemberCard>

##### logicStyle()

<MemberCard>

##### SerializeLatexOptions.logicStyle()

```ts
logicStyle: (expr, level) => "word" | "boolean" | "uppercase-word" | "punctuation";
```

###### expr

[`Expression`](#expression)

###### level

`number`

`"word"` \| `"boolean"` \| `"uppercase-word"` \| `"punctuation"`

</MemberCard>

##### powerStyle()

<MemberCard>

##### SerializeLatexOptions.powerStyle()

```ts
powerStyle: (expr, level) => "root" | "solidus" | "quotient";
```

###### expr

[`Expression`](#expression)

###### level

`number`

`"root"` \| `"solidus"` \| `"quotient"`

</MemberCard>

##### numericSetStyle()

<MemberCard>

##### SerializeLatexOptions.numericSetStyle()

```ts
numericSetStyle: (expr, level) => "compact" | "regular" | "interval" | "set-builder";
```

###### expr

[`Expression`](#expression)

###### level

`number`

`"compact"` \| `"regular"` \| `"interval"` \| `"set-builder"`

</MemberCard>

## Other

<a id="oneoftypesarray-res-allproperties" name="oneoftypesarray-res-allproperties"></a>

### OneOf\<TypesArray, Res, AllProperties\>

```ts
type OneOf<TypesArray, Res, AllProperties> = TypesArray extends [infer Head, ...(infer Rem)] ? OneOf<Rem, Res | OnlyFirst<Head, AllProperties>, AllProperties> : Res;
```

#### Type Parameters

• **TypesArray** *extends* `any`[]

• **Res** = `never`

• **AllProperties** = `MergeTypes`\<`TypesArray`\>

<a id="boxedtype" name="boxedtype"></a>

### BoxedType

<a id="constructors" name="constructors"></a>

<MemberCard>

##### new BoxedType()

##### new BoxedType()

```ts
new BoxedType(type): BoxedType
```

###### type

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`MapType`](#maptype) | [`TupleType`](#tupletype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference)

[`BoxedType`](#boxedtype)

</MemberCard>

<a id="unknown" name="unknown"></a>

<MemberCard>

##### BoxedType.unknown

```ts
static unknown: BoxedType;
```

</MemberCard>

<a id="type" name="type"></a>

<MemberCard>

##### BoxedType.type

```ts
type: Type;
```

</MemberCard>

<a id="isunknown" name="isunknown"></a>

<MemberCard>

##### BoxedType.isUnknown

###### Get Signature

```ts
get isUnknown(): boolean
```

`boolean`

</MemberCard>

<a id="matches" name="matches"></a>

<MemberCard>

##### BoxedType.matches()

```ts
matches(other): boolean
```

###### other

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`MapType`](#maptype) | [`TupleType`](#tupletype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference) | [`BoxedType`](#boxedtype)

`boolean`

</MemberCard>

<a id="is" name="is"></a>

<MemberCard>

##### BoxedType.is()

```ts
is(other): boolean
```

###### other

`string` | [`AlgebraicType`](#algebraictype) | [`NegationType`](#negationtype) | [`CollectionType`](#collectiontype) | [`ListType`](#listtype) | [`SetType`](#settype) | [`MapType`](#maptype) | [`TupleType`](#tupletype) | [`FunctionSignature`](#functionsignature) | [`ValueType`](#valuetype) | [`TypeReference`](#typereference)

`boolean`

</MemberCard>

<a id="tostring" name="tostring"></a>

<MemberCard>

##### BoxedType.toString()

```ts
toString(): string
```

`string`

</MemberCard>

<a id="tojson" name="tojson"></a>

<MemberCard>

##### BoxedType.toJSON()

```ts
toJSON(): string
```

`string`

</MemberCard>

<a id="toprimitive" name="toprimitive"></a>

<MemberCard>

##### BoxedType.\[toPrimitive\]()

```ts
toPrimitive: string
```

###### hint

`string`

`string`

</MemberCard>

<a id="valueof" name="valueof"></a>

<MemberCard>

##### BoxedType.valueOf()

```ts
valueOf(): string
```

`string`

</MemberCard>

<a id="isrulestep" name="isrulestep"></a>

<MemberCard>

### isRuleStep()

```ts
function isRuleStep(x): x is RuleStep
```

##### x

`any`

`x is RuleStep`

</MemberCard>

<a id="isboxedrule" name="isboxedrule"></a>

<MemberCard>

### isBoxedRule()

```ts
function isBoxedRule(x): x is BoxedRule
```

##### x

`any`

`x is BoxedRule`

</MemberCard>

<a id="datatypemap" name="datatypemap"></a>

### DataTypeMap

```ts
type DataTypeMap = object;
```

#### Type declaration

<a id="float64"></a>

##### float64

<a id="float64" name="float64"></a>

<MemberCard>

##### DataTypeMap.float64

```ts
float64: number;
```

</MemberCard>

<a id="float32"></a>

##### float32

<a id="float32" name="float32"></a>

<MemberCard>

##### DataTypeMap.float32

```ts
float32: number;
```

</MemberCard>

<a id="int32"></a>

##### int32

<a id="int32" name="int32"></a>

<MemberCard>

##### DataTypeMap.int32

```ts
int32: number;
```

</MemberCard>

<a id="uint8"></a>

##### uint8

<a id="uint8" name="uint8"></a>

<MemberCard>

##### DataTypeMap.uint8

```ts
uint8: number;
```

</MemberCard>

<a id="complex128"></a>

##### complex128

<a id="complex128" name="complex128"></a>

<MemberCard>

##### DataTypeMap.complex128

```ts
complex128: Complex;
```

</MemberCard>

<a id="complex64"></a>

##### complex64

<a id="complex64" name="complex64"></a>

<MemberCard>

##### DataTypeMap.complex64

```ts
complex64: Complex;
```

</MemberCard>

<a id="bool"></a>

##### bool

<a id="bool" name="bool"></a>

<MemberCard>

##### DataTypeMap.bool

```ts
bool: boolean;
```

</MemberCard>

<a id="string-1"></a>

##### string

<a id="string-1" name="string-1"></a>

<MemberCard>

##### DataTypeMap.string

```ts
string: string;
```

</MemberCard>

<a id="expression-5"></a>

##### expression

<a id="expression-5" name="expression-5"></a>

<MemberCard>

##### DataTypeMap.expression

```ts
expression: BoxedExpression;
```

</MemberCard>

<a id="tensordatatype" name="tensordatatype"></a>

### TensorDataType

```ts
type TensorDataType = keyof DataTypeMap;
```

<a id="maketensorfield" name="maketensorfield"></a>

<MemberCard>

### makeTensorField()

```ts
function makeTensorField<DT>(ce, dtype): TensorField<DataTypeMap[DT]>
```

• **DT** *extends* keyof [`DataTypeMap`](#datatypemap)

##### ce

`IComputeEngine`

##### dtype

`DT`

[`TensorField`](#tensorfieldt)\<[`DataTypeMap`](#datatypemap)\[`DT`\]\>

</MemberCard>

<a id="tensorfieldt" name="tensorfieldt"></a>

### TensorField\<T\>

#### Type Parameters

• **T** *extends* 
  \| `number`
  \| `Complex`
  \| [`BoxedExpression`](#boxedexpression)
  \| `boolean`
  \| `string` = `number`

<a id="one-3" name="one-3"></a>

<MemberCard>

##### TensorField.one

```ts
readonly one: T;
```

</MemberCard>

<a id="zero-3" name="zero-3"></a>

<MemberCard>

##### TensorField.zero

```ts
readonly zero: T;
```

</MemberCard>

<a id="nan-3" name="nan-3"></a>

<MemberCard>

##### TensorField.nan

```ts
readonly nan: T;
```

</MemberCard>

<a id="cast-3" name="cast-3"></a>

<MemberCard>

##### TensorField.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`T`

###### dtype

`"float64"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`T`

###### dtype

`"float32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`T`

###### dtype

`"int32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`T`

###### dtype

`"uint8"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

`T`

###### dtype

`"complex128"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

`T`

###### dtype

`"complex64"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

###### x

`T`

###### dtype

`"bool"`

`boolean`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

###### x

`T`

###### dtype

`"string"`

`string`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

###### x

`T`

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`T`[]

###### dtype

`"float64"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`T`[]

###### dtype

`"float32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`T`[]

###### dtype

`"int32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`T`[]

###### dtype

`"uint8"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

`T`[]

###### dtype

`"complex128"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

`T`[]

###### dtype

`"complex64"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

###### x

`T`[]

###### dtype

`"bool"`

`boolean`[]

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

###### x

`T`[]

###### dtype

`"string"`

`string`[]

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

###### x

`T`[]

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)[]

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

`T` | `T`[]

###### dtype

keyof [`DataTypeMap`](#datatypemap)

`any`

</MemberCard>

<a id="expression-4" name="expression-4"></a>

<MemberCard>

##### TensorField.expression()

```ts
expression(x): BoxedExpression
```

###### x

`T`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="iszero-5" name="iszero-5"></a>

<MemberCard>

##### TensorField.isZero()

```ts
isZero(x): boolean
```

###### x

`T`

`boolean`

</MemberCard>

<a id="isone-4" name="isone-4"></a>

<MemberCard>

##### TensorField.isOne()

```ts
isOne(x): boolean
```

###### x

`T`

`boolean`

</MemberCard>

<a id="equals-4" name="equals-4"></a>

<MemberCard>

##### TensorField.equals()

```ts
equals(lhs, rhs): boolean
```

###### lhs

`T`

###### rhs

`T`

`boolean`

</MemberCard>

<a id="add-6" name="add-6"></a>

<MemberCard>

##### TensorField.add()

```ts
add(lhs, rhs): T
```

###### lhs

`T`

###### rhs

`T`

`T`

</MemberCard>

<a id="addn-3" name="addn-3"></a>

<MemberCard>

##### TensorField.addn()

```ts
addn(...xs): T
```

###### xs

...`T`[]

`T`

</MemberCard>

<a id="neg-5" name="neg-5"></a>

<MemberCard>

##### TensorField.neg()

```ts
neg(x): T
```

###### x

`T`

`T`

</MemberCard>

<a id="sub-5" name="sub-5"></a>

<MemberCard>

##### TensorField.sub()

```ts
sub(lhs, rhs): T
```

###### lhs

`T`

###### rhs

`T`

`T`

</MemberCard>

<a id="mul-5" name="mul-5"></a>

<MemberCard>

##### TensorField.mul()

```ts
mul(lhs, rhs): T
```

###### lhs

`T`

###### rhs

`T`

`T`

</MemberCard>

<a id="muln-3" name="muln-3"></a>

<MemberCard>

##### TensorField.muln()

```ts
muln(...xs): T
```

###### xs

...`T`[]

`T`

</MemberCard>

<a id="div-5" name="div-5"></a>

<MemberCard>

##### TensorField.div()

```ts
div(lhs, rhs): T
```

###### lhs

`T`

###### rhs

`T`

`T`

</MemberCard>

<a id="pow-5" name="pow-5"></a>

<MemberCard>

##### TensorField.pow()

```ts
pow(rhs, n): T
```

###### rhs

`T`

###### n

`number`

`T`

</MemberCard>

<a id="conjugate-3" name="conjugate-3"></a>

<MemberCard>

##### TensorField.conjugate()

```ts
conjugate(x): T
```

###### x

`T`

`T`

</MemberCard>

<a id="tensorfieldnumber" name="tensorfieldnumber"></a>

### TensorFieldNumber

#### Implements

- [`TensorField`](#tensorfieldt)\<`number`\>

<a id="constructors-1" name="constructors-1"></a>

<MemberCard>

##### new TensorFieldNumber()

##### new TensorFieldNumber()

```ts
new TensorFieldNumber(ce): TensorFieldNumber
```

###### ce

`IComputeEngine`

[`TensorFieldNumber`](#tensorfieldnumber)

</MemberCard>

<a id="one" name="one"></a>

<MemberCard>

##### TensorFieldNumber.one

```ts
one: number = 1;
```

</MemberCard>

<a id="zero" name="zero"></a>

<MemberCard>

##### TensorFieldNumber.zero

```ts
zero: number = 0;
```

</MemberCard>

<a id="nan" name="nan"></a>

<MemberCard>

##### TensorFieldNumber.nan

```ts
nan: number = NaN;
```

</MemberCard>

<a id="cast" name="cast"></a>

<MemberCard>

##### TensorFieldNumber.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`number`

###### dtype

`"float64"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`number`

###### dtype

`"float32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`number`

###### dtype

`"int32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`number`

###### dtype

`"uint8"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

`number`

###### dtype

`"complex128"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

`number`

###### dtype

`"complex64"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

###### x

`number`

###### dtype

`"bool"`

`boolean`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

###### x

`number`

###### dtype

`"string"`

`string`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

###### x

`number`

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`number`[]

###### dtype

`"float64"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`number`[]

###### dtype

`"float32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`number`[]

###### dtype

`"int32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`number`[]

###### dtype

`"uint8"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

`number`[]

###### dtype

`"complex128"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

`number`[]

###### dtype

`"complex64"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

###### x

`number`[]

###### dtype

`"bool"`

`boolean`[]

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

###### x

`number`[]

###### dtype

`"string"`

`string`[]

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

###### x

`number`[]

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="expression" name="expression"></a>

<MemberCard>

##### TensorFieldNumber.expression()

```ts
expression(x): BoxedExpression
```

###### x

`number`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="iszero" name="iszero"></a>

<MemberCard>

##### TensorFieldNumber.isZero()

```ts
isZero(x): boolean
```

###### x

`number`

`boolean`

</MemberCard>

<a id="isone" name="isone"></a>

<MemberCard>

##### TensorFieldNumber.isOne()

```ts
isOne(x): boolean
```

###### x

`number`

`boolean`

</MemberCard>

<a id="equals" name="equals"></a>

<MemberCard>

##### TensorFieldNumber.equals()

```ts
equals(lhs, rhs): boolean
```

###### lhs

`number`

###### rhs

`number`

`boolean`

</MemberCard>

<a id="add" name="add"></a>

<MemberCard>

##### TensorFieldNumber.add()

```ts
add(lhs, rhs): number
```

###### lhs

`number`

###### rhs

`number`

`number`

</MemberCard>

<a id="addn" name="addn"></a>

<MemberCard>

##### TensorFieldNumber.addn()

```ts
addn(...xs): number
```

###### xs

...`number`[]

`number`

</MemberCard>

<a id="neg" name="neg"></a>

<MemberCard>

##### TensorFieldNumber.neg()

```ts
neg(x): number
```

###### x

`number`

`number`

</MemberCard>

<a id="sub" name="sub"></a>

<MemberCard>

##### TensorFieldNumber.sub()

```ts
sub(lhs, rhs): number
```

###### lhs

`number`

###### rhs

`number`

`number`

</MemberCard>

<a id="mul" name="mul"></a>

<MemberCard>

##### TensorFieldNumber.mul()

```ts
mul(lhs, rhs): number
```

###### lhs

`number`

###### rhs

`number`

`number`

</MemberCard>

<a id="muln" name="muln"></a>

<MemberCard>

##### TensorFieldNumber.muln()

```ts
muln(...xs): number
```

###### xs

...`number`[]

`number`

</MemberCard>

<a id="div" name="div"></a>

<MemberCard>

##### TensorFieldNumber.div()

```ts
div(lhs, rhs): number
```

###### lhs

`number`

###### rhs

`number`

`number`

</MemberCard>

<a id="pow" name="pow"></a>

<MemberCard>

##### TensorFieldNumber.pow()

```ts
pow(lhs, rhs): number
```

###### lhs

`number`

###### rhs

`number`

`number`

</MemberCard>

<a id="conjugate" name="conjugate"></a>

<MemberCard>

##### TensorFieldNumber.conjugate()

```ts
conjugate(x): number
```

###### x

`number`

`number`

</MemberCard>

<a id="tensorfieldexpression" name="tensorfieldexpression"></a>

### TensorFieldExpression

#### Implements

- [`TensorField`](#tensorfieldt)\<[`BoxedExpression`](#boxedexpression)\>

<a id="constructors-2" name="constructors-2"></a>

<MemberCard>

##### new TensorFieldExpression()

##### new TensorFieldExpression()

```ts
new TensorFieldExpression(ce): TensorFieldExpression
```

###### ce

`IComputeEngine`

[`TensorFieldExpression`](#tensorfieldexpression)

</MemberCard>

<a id="one-1" name="one-1"></a>

<MemberCard>

##### TensorFieldExpression.one

```ts
one: BoxedExpression;
```

</MemberCard>

<a id="zero-1" name="zero-1"></a>

<MemberCard>

##### TensorFieldExpression.zero

```ts
zero: BoxedExpression;
```

</MemberCard>

<a id="nan-1" name="nan-1"></a>

<MemberCard>

##### TensorFieldExpression.nan

```ts
nan: BoxedExpression;
```

</MemberCard>

<a id="cast-1" name="cast-1"></a>

<MemberCard>

##### TensorFieldExpression.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"float64"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"float32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"int32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"uint8"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"complex128"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"complex64"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"bool"`

`boolean`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"string"`

`string`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

###### x

[`BoxedExpression`](#boxedexpression)

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"float64"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"float32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"int32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"uint8"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"complex128"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"complex64"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"bool"`

`boolean`[]

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"string"`

`string`[]

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

###### x

[`BoxedExpression`](#boxedexpression)[]

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="expression-1" name="expression-1"></a>

<MemberCard>

##### TensorFieldExpression.expression()

```ts
expression(x): BoxedExpression
```

###### x

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="iszero-1" name="iszero-1"></a>

<MemberCard>

##### TensorFieldExpression.isZero()

```ts
isZero(x): boolean
```

###### x

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="isone-1" name="isone-1"></a>

<MemberCard>

##### TensorFieldExpression.isOne()

```ts
isOne(x): boolean
```

###### x

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="equals-1" name="equals-1"></a>

<MemberCard>

##### TensorFieldExpression.equals()

```ts
equals(lhs, rhs): boolean
```

###### lhs

[`BoxedExpression`](#boxedexpression)

###### rhs

[`BoxedExpression`](#boxedexpression)

`boolean`

</MemberCard>

<a id="add-1" name="add-1"></a>

<MemberCard>

##### TensorFieldExpression.add()

```ts
add(lhs, rhs): BoxedExpression
```

###### lhs

[`BoxedExpression`](#boxedexpression)

###### rhs

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="addn-1" name="addn-1"></a>

<MemberCard>

##### TensorFieldExpression.addn()

```ts
addn(...xs): BoxedExpression
```

###### xs

...[`BoxedExpression`](#boxedexpression)[]

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="neg-1" name="neg-1"></a>

<MemberCard>

##### TensorFieldExpression.neg()

```ts
neg(x): BoxedExpression
```

###### x

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="sub-1" name="sub-1"></a>

<MemberCard>

##### TensorFieldExpression.sub()

```ts
sub(lhs, rhs): BoxedExpression
```

###### lhs

[`BoxedExpression`](#boxedexpression)

###### rhs

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="mul-1" name="mul-1"></a>

<MemberCard>

##### TensorFieldExpression.mul()

```ts
mul(lhs, rhs): BoxedExpression
```

###### lhs

[`BoxedExpression`](#boxedexpression)

###### rhs

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="muln-1" name="muln-1"></a>

<MemberCard>

##### TensorFieldExpression.muln()

```ts
muln(...xs): BoxedExpression
```

###### xs

...[`BoxedExpression`](#boxedexpression)[]

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="div-1" name="div-1"></a>

<MemberCard>

##### TensorFieldExpression.div()

```ts
div(lhs, rhs): BoxedExpression
```

###### lhs

[`BoxedExpression`](#boxedexpression)

###### rhs

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="pow-1" name="pow-1"></a>

<MemberCard>

##### TensorFieldExpression.pow()

```ts
pow(lhs, rhs): BoxedExpression
```

###### lhs

[`BoxedExpression`](#boxedexpression)

###### rhs

`number`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="conjugate-1" name="conjugate-1"></a>

<MemberCard>

##### TensorFieldExpression.conjugate()

```ts
conjugate(x): BoxedExpression
```

###### x

[`BoxedExpression`](#boxedexpression)

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="tensorfieldcomplex" name="tensorfieldcomplex"></a>

### TensorFieldComplex

#### Implements

- [`TensorField`](#tensorfieldt)\<`Complex`\>

<a id="constructors-3" name="constructors-3"></a>

<MemberCard>

##### new TensorFieldComplex()

##### new TensorFieldComplex()

```ts
new TensorFieldComplex(ce): TensorFieldComplex
```

###### ce

`IComputeEngine`

[`TensorFieldComplex`](#tensorfieldcomplex)

</MemberCard>

<a id="one-2" name="one-2"></a>

<MemberCard>

##### TensorFieldComplex.one

```ts
one: Complex;
```

</MemberCard>

<a id="zero-2" name="zero-2"></a>

<MemberCard>

##### TensorFieldComplex.zero

```ts
zero: Complex;
```

</MemberCard>

<a id="nan-2" name="nan-2"></a>

<MemberCard>

##### TensorFieldComplex.nan

```ts
nan: Complex;
```

</MemberCard>

<a id="cast-2" name="cast-2"></a>

<MemberCard>

##### TensorFieldComplex.cast()

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`Complex`

###### dtype

`"float64"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`Complex`

###### dtype

`"float32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`Complex`

###### dtype

`"int32"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

###### x

`Complex`

###### dtype

`"uint8"`

`number`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

`Complex`

###### dtype

`"complex128"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

###### x

`Complex`

###### dtype

`"complex64"`

`any`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

###### x

`Complex`

###### dtype

`"bool"`

`boolean`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

###### x

`Complex`

###### dtype

`"string"`

`string`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

###### x

`Complex`

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`Complex`[]

###### dtype

`"float64"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`Complex`[]

###### dtype

`"float32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`Complex`[]

###### dtype

`"int32"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

###### x

`Complex`[]

###### dtype

`"uint8"`

`number`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

`Complex`[]

###### dtype

`"complex128"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

###### x

`Complex`[]

###### dtype

`"complex64"`

`Complex`[]

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

###### x

`Complex`[]

###### dtype

`"bool"`

`boolean`[]

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

###### x

`Complex`[]

###### dtype

`"string"`

`string`[]

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

###### x

`Complex`[]

###### dtype

`"expression"`

[`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="expression-2" name="expression-2"></a>

<MemberCard>

##### TensorFieldComplex.expression()

```ts
expression(z): BoxedExpression
```

###### z

`Complex`

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="iszero-2" name="iszero-2"></a>

<MemberCard>

##### TensorFieldComplex.isZero()

```ts
isZero(z): boolean
```

###### z

`Complex`

`boolean`

</MemberCard>

<a id="isone-2" name="isone-2"></a>

<MemberCard>

##### TensorFieldComplex.isOne()

```ts
isOne(z): boolean
```

###### z

`Complex`

`boolean`

</MemberCard>

<a id="equals-2" name="equals-2"></a>

<MemberCard>

##### TensorFieldComplex.equals()

```ts
equals(lhs, rhs): boolean
```

###### lhs

`Complex`

###### rhs

`Complex`

`boolean`

</MemberCard>

<a id="add-2" name="add-2"></a>

<MemberCard>

##### TensorFieldComplex.add()

```ts
add(lhs, rhs): Complex
```

###### lhs

`Complex`

###### rhs

`Complex`

`Complex`

</MemberCard>

<a id="addn-2" name="addn-2"></a>

<MemberCard>

##### TensorFieldComplex.addn()

```ts
addn(...xs): Complex
```

###### xs

...`Complex`[]

`Complex`

</MemberCard>

<a id="neg-2" name="neg-2"></a>

<MemberCard>

##### TensorFieldComplex.neg()

```ts
neg(z): Complex
```

###### z

`Complex`

`Complex`

</MemberCard>

<a id="sub-2" name="sub-2"></a>

<MemberCard>

##### TensorFieldComplex.sub()

```ts
sub(lhs, rhs): Complex
```

###### lhs

`Complex`

###### rhs

`Complex`

`Complex`

</MemberCard>

<a id="mul-2" name="mul-2"></a>

<MemberCard>

##### TensorFieldComplex.mul()

```ts
mul(lhs, rhs): Complex
```

###### lhs

`Complex`

###### rhs

`Complex`

`Complex`

</MemberCard>

<a id="muln-2" name="muln-2"></a>

<MemberCard>

##### TensorFieldComplex.muln()

```ts
muln(...xs): Complex
```

###### xs

...`Complex`[]

`Complex`

</MemberCard>

<a id="div-2" name="div-2"></a>

<MemberCard>

##### TensorFieldComplex.div()

```ts
div(lhs, rhs): Complex
```

###### lhs

`Complex`

###### rhs

`Complex`

`Complex`

</MemberCard>

<a id="pow-2" name="pow-2"></a>

<MemberCard>

##### TensorFieldComplex.pow()

```ts
pow(lhs, rhs): Complex
```

###### lhs

`Complex`

###### rhs

`number`

`Complex`

</MemberCard>

<a id="conjugate-2" name="conjugate-2"></a>

<MemberCard>

##### TensorFieldComplex.conjugate()

```ts
conjugate(z): Complex
```

###### z

`Complex`

`Complex`

</MemberCard>

<a id="getsupertype" name="getsupertype"></a>

<MemberCard>

### getSupertype()

```ts
function getSupertype(t1, t2): TensorDataType
```

##### t1

keyof [`DataTypeMap`](#datatypemap)

##### t2

keyof [`DataTypeMap`](#datatypemap)

[`TensorDataType`](#tensordatatype)

</MemberCard>

<a id="getexpressiondatatype" name="getexpressiondatatype"></a>

<MemberCard>

### getExpressionDatatype()

```ts
function getExpressionDatatype(expr): TensorDataType
```

##### expr

[`BoxedExpression`](#boxedexpression)

[`TensorDataType`](#tensordatatype)

</MemberCard>

<a id="numberformat" name="numberformat"></a>

### NumberFormat

```ts
type NumberFormat = object;
```

These options control how numbers are parsed and serialized.

#### Type declaration

<a id="positiveinfinity"></a>

##### positiveInfinity

<a id="positiveinfinity" name="positiveinfinity"></a>

<MemberCard>

##### NumberFormat.positiveInfinity

```ts
positiveInfinity: LatexString;
```

</MemberCard>

<a id="negativeinfinity"></a>

##### negativeInfinity

<a id="negativeinfinity" name="negativeinfinity"></a>

<MemberCard>

##### NumberFormat.negativeInfinity

```ts
negativeInfinity: LatexString;
```

</MemberCard>

<a id="notanumber"></a>

##### notANumber

<a id="notanumber" name="notanumber"></a>

<MemberCard>

##### NumberFormat.notANumber

```ts
notANumber: LatexString;
```

</MemberCard>

<a id="imaginaryunit"></a>

##### imaginaryUnit

<a id="imaginaryunit" name="imaginaryunit"></a>

<MemberCard>

##### NumberFormat.imaginaryUnit

```ts
imaginaryUnit: LatexString;
```

</MemberCard>

<a id="decimalseparator"></a>

##### decimalSeparator

<a id="decimalseparator" name="decimalseparator"></a>

<MemberCard>

##### NumberFormat.decimalSeparator

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

</MemberCard>

<a id="digitgroupseparator"></a>

##### digitGroupSeparator

<a id="digitgroupseparator" name="digitgroupseparator"></a>

<MemberCard>

##### NumberFormat.digitGroupSeparator

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

</MemberCard>

<a id="digitgroup"></a>

##### digitGroup

<a id="digitgroup" name="digitgroup"></a>

<MemberCard>

##### NumberFormat.digitGroup

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

<a id="exponentproduct"></a>

##### exponentProduct

<a id="exponentproduct" name="exponentproduct"></a>

<MemberCard>

##### NumberFormat.exponentProduct

```ts
exponentProduct: LatexString;
```

</MemberCard>

<a id="beginexponentmarker"></a>

##### beginExponentMarker

<a id="beginexponentmarker" name="beginexponentmarker"></a>

<MemberCard>

##### NumberFormat.beginExponentMarker

```ts
beginExponentMarker: LatexString;
```

</MemberCard>

<a id="endexponentmarker"></a>

##### endExponentMarker

<a id="endexponentmarker" name="endexponentmarker"></a>

<MemberCard>

##### NumberFormat.endExponentMarker

```ts
endExponentMarker: LatexString;
```

</MemberCard>

<a id="truncationmarker"></a>

##### truncationMarker

<a id="truncationmarker" name="truncationmarker"></a>

<MemberCard>

##### NumberFormat.truncationMarker

```ts
truncationMarker: LatexString;
```

</MemberCard>

<a id="repeatingdecimal-1"></a>

##### repeatingDecimal

<a id="repeatingdecimal-1" name="repeatingdecimal-1"></a>

<MemberCard>

##### NumberFormat.repeatingDecimal

```ts
repeatingDecimal: "auto" | "vinculum" | "dots" | "parentheses" | "arc" | "none";
```

</MemberCard>

<a id="numberserializationformat" name="numberserializationformat"></a>

### NumberSerializationFormat

```ts
type NumberSerializationFormat = NumberFormat & object;
```

#### Type declaration

##### fractionalDigits

<MemberCard>

##### NumberSerializationFormat.fractionalDigits

```ts
fractionalDigits: "auto" | "max" | number;
```

The maximum number of significant digits in serialized numbers.
- `"max"`: all availabe digits are serialized.
- `"auto"`: use the same precision as the compute engine.

Default: `"auto"`

</MemberCard>

##### notation

<MemberCard>

##### NumberSerializationFormat.notation

```ts
notation: "auto" | "engineering" | "scientific";
```

</MemberCard>

##### avoidExponentsInRange

<MemberCard>

##### NumberSerializationFormat.avoidExponentsInRange

```ts
avoidExponentsInRange: undefined | null | [number, number];
```

</MemberCard>

<a id="exactnumericvaluedata" name="exactnumericvaluedata"></a>

### ExactNumericValueData

```ts
type ExactNumericValueData = object;
```

The value is equal to `(decimal * rational * sqrt(radical)) + im * i`

#### Type declaration

<a id="rational"></a>

##### rational?

<a id="rational" name="rational"></a>

<MemberCard>

##### ExactNumericValueData.rational?

```ts
optional rational: Rational;
```

</MemberCard>

<a id="radical"></a>

##### radical?

<a id="radical" name="radical"></a>

<MemberCard>

##### ExactNumericValueData.radical?

```ts
optional radical: number;
```

</MemberCard>

<a id="numericvaluedata" name="numericvaluedata"></a>

### NumericValueData

```ts
type NumericValueData = object;
```

#### Type declaration

<a id="re-2"></a>

##### re?

<a id="re-2" name="re-2"></a>

<MemberCard>

##### NumericValueData.re?

```ts
optional re: Decimal | number;
```

</MemberCard>

<a id="im-2"></a>

##### im?

<a id="im-2" name="im-2"></a>

<MemberCard>

##### NumericValueData.im?

```ts
optional im: number;
```

</MemberCard>

<a id="numericvaluefactory" name="numericvaluefactory"></a>

### NumericValueFactory()

```ts
type NumericValueFactory = (data) => NumericValue;
```

##### data

`number` | `Decimal` | [`NumericValueData`](#numericvaluedata)

[`NumericValue`](#numericvalue)

<a id="numericvalue" name="numericvalue"></a>

### `abstract` NumericValue

<a id="constructors-4" name="constructors-4"></a>

<MemberCard>

##### new NumericValue()

##### new NumericValue()

```ts
new NumericValue(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="im" name="im"></a>

<MemberCard>

##### NumericValue.im

```ts
readonly im: number;
```

The imaginary part of this numeric value.

Can be negative, zero or positive.

</MemberCard>

<a id="type-1" name="type-1"></a>

<MemberCard>

##### NumericValue.type

###### Get Signature

```ts
get abstract type(): NumericType
```

[`NumericType`](#numerictype)

</MemberCard>

<a id="isexact" name="isexact"></a>

<MemberCard>

##### NumericValue.isExact

###### Get Signature

```ts
get abstract isExact(): boolean
```

True if numeric value is the product of a rational and the square root of an integer.

This includes: 3/4√5, -2, √2, etc...

But it doesn't include 0.5, 3.141592, etc...

`boolean`

</MemberCard>

<a id="asexact" name="asexact"></a>

<MemberCard>

##### NumericValue.asExact

###### Get Signature

```ts
get abstract asExact(): NumericValue
```

If `isExact()`, returns an ExactNumericValue, otherwise returns undefined.

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="re" name="re"></a>

<MemberCard>

##### NumericValue.re

###### Get Signature

```ts
get abstract re(): number
```

The real part of this numeric value.

Can be negative, 0 or positive.

`number`

</MemberCard>

<a id="bignumre" name="bignumre"></a>

<MemberCard>

##### NumericValue.bignumRe

###### Get Signature

```ts
get bignumRe(): Decimal
```

bignum version of .re, if available

`Decimal`

</MemberCard>

<a id="bignumim" name="bignumim"></a>

<MemberCard>

##### NumericValue.bignumIm

###### Get Signature

```ts
get bignumIm(): Decimal
```

`Decimal`

</MemberCard>

<a id="numerator" name="numerator"></a>

<MemberCard>

##### NumericValue.numerator

###### Get Signature

```ts
get abstract numerator(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="denominator" name="denominator"></a>

<MemberCard>

##### NumericValue.denominator

###### Get Signature

```ts
get abstract denominator(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="isnan" name="isnan"></a>

<MemberCard>

##### NumericValue.isNaN

###### Get Signature

```ts
get abstract isNaN(): boolean
```

`boolean`

</MemberCard>

<a id="ispositiveinfinity" name="ispositiveinfinity"></a>

<MemberCard>

##### NumericValue.isPositiveInfinity

###### Get Signature

```ts
get abstract isPositiveInfinity(): boolean
```

`boolean`

</MemberCard>

<a id="isnegativeinfinity" name="isnegativeinfinity"></a>

<MemberCard>

##### NumericValue.isNegativeInfinity

###### Get Signature

```ts
get abstract isNegativeInfinity(): boolean
```

`boolean`

</MemberCard>

<a id="iscomplexinfinity" name="iscomplexinfinity"></a>

<MemberCard>

##### NumericValue.isComplexInfinity

###### Get Signature

```ts
get abstract isComplexInfinity(): boolean
```

`boolean`

</MemberCard>

<a id="iszero-3" name="iszero-3"></a>

<MemberCard>

##### NumericValue.isZero

###### Get Signature

```ts
get abstract isZero(): boolean
```

`boolean`

</MemberCard>

<a id="isone-3" name="isone-3"></a>

<MemberCard>

##### NumericValue.isOne

###### Get Signature

```ts
get abstract isOne(): boolean
```

`boolean`

</MemberCard>

<a id="isnegativeone" name="isnegativeone"></a>

<MemberCard>

##### NumericValue.isNegativeOne

###### Get Signature

```ts
get abstract isNegativeOne(): boolean
```

`boolean`

</MemberCard>

<a id="iszerowithtolerance" name="iszerowithtolerance"></a>

<MemberCard>

##### NumericValue.isZeroWithTolerance()

```ts
isZeroWithTolerance(_tolerance): boolean
```

###### \_tolerance

`number` | `Decimal`

`boolean`

</MemberCard>

<a id="sgn" name="sgn"></a>

<MemberCard>

##### NumericValue.sgn()

```ts
abstract sgn(): -1 | 0 | 1
```

The sign of complex numbers is undefined

`-1` \| `0` \| `1`

</MemberCard>

<a id="n" name="n"></a>

<MemberCard>

##### NumericValue.N()

```ts
abstract N(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="neg-3" name="neg-3"></a>

<MemberCard>

##### NumericValue.neg()

```ts
abstract neg(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="inv" name="inv"></a>

<MemberCard>

##### NumericValue.inv()

```ts
abstract inv(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="add-3" name="add-3"></a>

<MemberCard>

##### NumericValue.add()

```ts
abstract add(other): NumericValue
```

###### other

`number` | [`NumericValue`](#numericvalue)

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="sub-3" name="sub-3"></a>

<MemberCard>

##### NumericValue.sub()

```ts
abstract sub(other): NumericValue
```

###### other

[`NumericValue`](#numericvalue)

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="mul-3" name="mul-3"></a>

<MemberCard>

##### NumericValue.mul()

```ts
abstract mul(other): NumericValue
```

###### other

`number` | `Decimal` | [`NumericValue`](#numericvalue)

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="div-3" name="div-3"></a>

<MemberCard>

##### NumericValue.div()

```ts
abstract div(other): NumericValue
```

###### other

`number` | [`NumericValue`](#numericvalue)

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="pow-3" name="pow-3"></a>

<MemberCard>

##### NumericValue.pow()

```ts
abstract pow(n): NumericValue
```

###### n

`number` | [`NumericValue`](#numericvalue) | \{
`re`: `number`;
`im`: `number`;
\}

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="root" name="root"></a>

<MemberCard>

##### NumericValue.root()

```ts
abstract root(n): NumericValue
```

###### n

`number`

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="sqrt" name="sqrt"></a>

<MemberCard>

##### NumericValue.sqrt()

```ts
abstract sqrt(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="gcd" name="gcd"></a>

<MemberCard>

##### NumericValue.gcd()

```ts
abstract gcd(other): NumericValue
```

###### other

[`NumericValue`](#numericvalue)

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="abs" name="abs"></a>

<MemberCard>

##### NumericValue.abs()

```ts
abstract abs(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="ln" name="ln"></a>

<MemberCard>

##### NumericValue.ln()

```ts
abstract ln(base?): NumericValue
```

###### base?

`number`

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="exp" name="exp"></a>

<MemberCard>

##### NumericValue.exp()

```ts
abstract exp(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="floor" name="floor"></a>

<MemberCard>

##### NumericValue.floor()

```ts
abstract floor(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="ceil" name="ceil"></a>

<MemberCard>

##### NumericValue.ceil()

```ts
abstract ceil(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="round" name="round"></a>

<MemberCard>

##### NumericValue.round()

```ts
abstract round(): NumericValue
```

[`NumericValue`](#numericvalue)

</MemberCard>

<a id="eq" name="eq"></a>

<MemberCard>

##### NumericValue.eq()

```ts
abstract eq(other): boolean
```

###### other

`number` | [`NumericValue`](#numericvalue)

`boolean`

</MemberCard>

<a id="lt" name="lt"></a>

<MemberCard>

##### NumericValue.lt()

```ts
abstract lt(other): boolean
```

###### other

`number` | [`NumericValue`](#numericvalue)

`boolean`

</MemberCard>

<a id="lte" name="lte"></a>

<MemberCard>

##### NumericValue.lte()

```ts
abstract lte(other): boolean
```

###### other

`number` | [`NumericValue`](#numericvalue)

`boolean`

</MemberCard>

<a id="gt" name="gt"></a>

<MemberCard>

##### NumericValue.gt()

```ts
abstract gt(other): boolean
```

###### other

`number` | [`NumericValue`](#numericvalue)

`boolean`

</MemberCard>

<a id="gte" name="gte"></a>

<MemberCard>

##### NumericValue.gte()

```ts
abstract gte(other): boolean
```

###### other

`number` | [`NumericValue`](#numericvalue)

`boolean`

</MemberCard>

<a id="valueof-1" name="valueof-1"></a>

<MemberCard>

##### NumericValue.valueOf()

```ts
valueOf(): string | number
```

Object.valueOf(): returns a primitive value

`string` \| `number`

</MemberCard>

<a id="toprimitive-1" name="toprimitive-1"></a>

<MemberCard>

##### NumericValue.\[toPrimitive\]()

```ts
toPrimitive: string | number
```

Object.toPrimitive()

###### hint

`"string"` | `"number"` | `"default"`

`string` \| `number`

</MemberCard>

<a id="tojson-1" name="tojson-1"></a>

<MemberCard>

##### NumericValue.toJSON()

```ts
toJSON(): any
```

Object.toJSON

`any`

</MemberCard>

<a id="print" name="print"></a>

<MemberCard>

##### NumericValue.print()

```ts
print(): void
```

`void`

</MemberCard>

<a id="bignum-1" name="bignum-1"></a>

### BigNum

```ts
type BigNum = Decimal;
```

<a id="ibignum" name="ibignum"></a>

### IBigNum

<a id="_bignum_nan" name="_bignum_nan"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_NAN

```ts
readonly _BIGNUM_NAN: Decimal;
```

</MemberCard>

<a id="_bignum_zero" name="_bignum_zero"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_ZERO

```ts
readonly _BIGNUM_ZERO: Decimal;
```

</MemberCard>

<a id="_bignum_one" name="_bignum_one"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_ONE

```ts
readonly _BIGNUM_ONE: Decimal;
```

</MemberCard>

<a id="_bignum_two" name="_bignum_two"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_TWO

```ts
readonly _BIGNUM_TWO: Decimal;
```

</MemberCard>

<a id="_bignum_half" name="_bignum_half"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_HALF

```ts
readonly _BIGNUM_HALF: Decimal;
```

</MemberCard>

<a id="_bignum_pi" name="_bignum_pi"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_PI

```ts
readonly _BIGNUM_PI: Decimal;
```

</MemberCard>

<a id="_bignum_negative_one" name="_bignum_negative_one"></a>

<MemberCard>

##### IBigNum.\_BIGNUM\_NEGATIVE\_ONE

```ts
readonly _BIGNUM_NEGATIVE_ONE: Decimal;
```

</MemberCard>

<a id="bignum" name="bignum"></a>

<MemberCard>

##### IBigNum.bignum()

```ts
bignum(value): Decimal
```

###### value

`string` | `number` | `bigint` | `Decimal`

`Decimal`

</MemberCard>

<a id="smallinteger" name="smallinteger"></a>

### SmallInteger

```ts
type SmallInteger = IsInteger<number>;
```

A `SmallInteger` is an integer < 1e6

<a id="isrational-1" name="isrational-1"></a>

<MemberCard>

### isRational()

```ts
function isRational(x): x is Rational
```

##### x

`any`

`x is Rational`

</MemberCard>

<a id="ismachinerational" name="ismachinerational"></a>

<MemberCard>

### isMachineRational()

```ts
function isMachineRational(x): x is [number, number]
```

##### x

`any`

`x is [number, number]`

</MemberCard>

<a id="isbigrational" name="isbigrational"></a>

<MemberCard>

### isBigRational()

```ts
function isBigRational(x): x is [bigint, bigint]
```

##### x

`any`

`x is [bigint, bigint]`

</MemberCard>

<a id="iszero-6" name="iszero-6"></a>

<MemberCard>

### isZero()

```ts
function isZero(x): boolean
```

##### x

[`Rational`](#rational-1)

`boolean`

</MemberCard>

<a id="ispositive-1" name="ispositive-1"></a>

<MemberCard>

### isPositive()

```ts
function isPositive(x): boolean
```

##### x

[`Rational`](#rational-1)

`boolean`

</MemberCard>

<a id="isone-5" name="isone-5"></a>

<MemberCard>

### isOne()

```ts
function isOne(x): boolean
```

##### x

[`Rational`](#rational-1)

`boolean`

</MemberCard>

<a id="isnegativeone-1" name="isnegativeone-1"></a>

<MemberCard>

### isNegativeOne()

```ts
function isNegativeOne(x): boolean
```

##### x

[`Rational`](#rational-1)

`boolean`

</MemberCard>

<a id="isinteger-1" name="isinteger-1"></a>

<MemberCard>

### isInteger()

```ts
function isInteger(x): boolean
```

##### x

[`Rational`](#rational-1)

`boolean`

</MemberCard>

<a id="machinenumerator" name="machinenumerator"></a>

<MemberCard>

### machineNumerator()

```ts
function machineNumerator(x): number
```

##### x

[`Rational`](#rational-1)

`number`

</MemberCard>

<a id="machinedenominator" name="machinedenominator"></a>

<MemberCard>

### machineDenominator()

```ts
function machineDenominator(x): number
```

##### x

[`Rational`](#rational-1)

`number`

</MemberCard>

<a id="rationalasfloat" name="rationalasfloat"></a>

<MemberCard>

### rationalAsFloat()

```ts
function rationalAsFloat(x): number
```

##### x

[`Rational`](#rational-1)

`number`

</MemberCard>

<a id="isneg" name="isneg"></a>

<MemberCard>

### isNeg()

```ts
function isNeg(x): boolean
```

##### x

[`Rational`](#rational-1)

`boolean`

</MemberCard>

<a id="div-6" name="div-6"></a>

<MemberCard>

### div()

```ts
function div(lhs, rhs): Rational
```

##### lhs

[`Rational`](#rational-1)

##### rhs

[`Rational`](#rational-1)

[`Rational`](#rational-1)

</MemberCard>

<a id="add-7" name="add-7"></a>

<MemberCard>

### add()

```ts
function add(lhs, rhs): Rational
```

Add a literal numeric value to a rational.
If the rational is a bigint, this is a hint to do the calculation in bigint
(no need to check `bignumPreferred()`).

##### lhs

[`Rational`](#rational-1)

##### rhs

[`Rational`](#rational-1)

[`Rational`](#rational-1)

</MemberCard>

<a id="mul-6" name="mul-6"></a>

<MemberCard>

### mul()

```ts
function mul(lhs, rhs): Rational
```

##### lhs

[`Rational`](#rational-1)

##### rhs

[`Rational`](#rational-1)

[`Rational`](#rational-1)

</MemberCard>

<a id="neg-6" name="neg-6"></a>

<MemberCard>

### neg()

#### neg(x)

```ts
function neg(x): [SmallInteger, SmallInteger]
```

###### x

\[`number`, `number`\]

\[[`SmallInteger`](#smallinteger), [`SmallInteger`](#smallinteger)\]

#### neg(x)

```ts
function neg(x): [bigint, bigint]
```

###### x

\[`bigint`, `bigint`\]

\[`bigint`, `bigint`\]

#### neg(x)

```ts
function neg(x): Rational
```

###### x

[`Rational`](#rational-1)

[`Rational`](#rational-1)

</MemberCard>

<a id="inverse-1" name="inverse-1"></a>

<MemberCard>

### inverse()

#### inverse(x)

```ts
function inverse(x): [SmallInteger, SmallInteger]
```

###### x

\[`number`, `number`\]

\[[`SmallInteger`](#smallinteger), [`SmallInteger`](#smallinteger)\]

#### inverse(x)

```ts
function inverse(x): [bigint, bigint]
```

###### x

\[`bigint`, `bigint`\]

\[`bigint`, `bigint`\]

#### inverse(x)

```ts
function inverse(x): Rational
```

###### x

[`Rational`](#rational-1)

[`Rational`](#rational-1)

</MemberCard>

<a id="asmachinerational" name="asmachinerational"></a>

<MemberCard>

### asMachineRational()

```ts
function asMachineRational(r): [SmallInteger, SmallInteger]
```

##### r

[`Rational`](#rational-1)

\[[`SmallInteger`](#smallinteger), [`SmallInteger`](#smallinteger)\]

</MemberCard>

<a id="pow-6" name="pow-6"></a>

<MemberCard>

### pow()

```ts
function pow(r, exp): Rational
```

##### r

[`Rational`](#rational-1)

##### exp

`number`

[`Rational`](#rational-1)

</MemberCard>

<a id="sqrt-2" name="sqrt-2"></a>

<MemberCard>

### sqrt()

```ts
function sqrt(r): Rational | undefined
```

##### r

[`Rational`](#rational-1)

[`Rational`](#rational-1) \| `undefined`

</MemberCard>

<a id="rationalgcd" name="rationalgcd"></a>

<MemberCard>

### rationalGcd()

```ts
function rationalGcd(lhs, rhs): Rational
```

##### lhs

[`Rational`](#rational-1)

##### rhs

[`Rational`](#rational-1)

[`Rational`](#rational-1)

</MemberCard>

<a id="reducedrational" name="reducedrational"></a>

<MemberCard>

### reducedRational()

#### reducedRational(r)

```ts
function reducedRational(r): [SmallInteger, SmallInteger]
```

###### r

\[`number`, `number`\]

\[[`SmallInteger`](#smallinteger), [`SmallInteger`](#smallinteger)\]

#### reducedRational(r)

```ts
function reducedRational(r): [bigint, bigint]
```

###### r

\[`bigint`, `bigint`\]

\[`bigint`, `bigint`\]

#### reducedRational(r)

```ts
function reducedRational(r): Rational
```

###### r

[`Rational`](#rational-1)

[`Rational`](#rational-1)

</MemberCard>

<a id="rationalize" name="rationalize"></a>

<MemberCard>

### rationalize()

```ts
function rationalize(x): [number, number] | number
```

Return a rational approximation of x

##### x

`number`

\[`number`, `number`\] \| `number`

</MemberCard>

<a id="reducerationalsquareroot" name="reducerationalsquareroot"></a>

<MemberCard>

### reduceRationalSquareRoot()

```ts
function reduceRationalSquareRoot(n): [Rational, number | bigint]
```

Return [factor, root] such that factor * sqrt(root) = sqrt(n)
when factor and root are rationals

##### n

[`Rational`](#rational-1)

\[[`Rational`](#rational-1), `number` \| `bigint`\]

</MemberCard>

<a id="tensordatadt" name="tensordatadt"></a>

### TensorData\<DT\>

#### Type Parameters

• **DT** *extends* keyof [`DataTypeMap`](#datatypemap) = `"float64"`

<a id="dtype-1" name="dtype-1"></a>

<MemberCard>

##### TensorData.dtype

```ts
dtype: DT;
```

</MemberCard>

<a id="shape-2" name="shape-2"></a>

<MemberCard>

##### TensorData.shape

```ts
shape: number[];
```

</MemberCard>

<a id="data-1" name="data-1"></a>

<MemberCard>

##### TensorData.data

```ts
data: DataTypeMap[DT][];
```

</MemberCard>

<a id="nestedarrayt" name="nestedarrayt"></a>

### NestedArray\<T\>

```ts
type NestedArray<T> = NestedArray_<T>[];
```

#### Type Parameters

• **T**

<a id="nestedarray_t" name="nestedarray_t"></a>

### NestedArray\_\<T\>

```ts
type NestedArray_<T> = T | NestedArray_<T>[];
```

#### Type Parameters

• **T**

<a id="abstracttensordt" name="abstracttensordt"></a>

### `abstract` AbstractTensor\<DT\>

#### Type Parameters

• **DT** *extends* keyof [`DataTypeMap`](#datatypemap)

#### Implements

- [`TensorData`](#tensordatadt)\<`DT`\>

<a id="constructors-5" name="constructors-5"></a>

<MemberCard>

##### new AbstractTensor()

##### new AbstractTensor()

```ts
new AbstractTensor<DT>(ce, tensorData): AbstractTensor<DT>
```

###### ce

`IComputeEngine`

###### tensorData

[`TensorData`](#tensordatadt)\<`DT`\>

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="field" name="field"></a>

<MemberCard>

##### AbstractTensor.field

```ts
readonly field: TensorField<DataTypeMap[DT]>;
```

</MemberCard>

<a id="shape" name="shape"></a>

<MemberCard>

##### AbstractTensor.shape

```ts
readonly shape: number[];
```

</MemberCard>

<a id="rank" name="rank"></a>

<MemberCard>

##### AbstractTensor.rank

```ts
readonly rank: number;
```

</MemberCard>

<a id="dtype" name="dtype"></a>

<MemberCard>

##### AbstractTensor.dtype

###### Get Signature

```ts
get abstract dtype(): DT
```

`DT`

</MemberCard>

<a id="data" name="data"></a>

<MemberCard>

##### AbstractTensor.data

###### Get Signature

```ts
get abstract data(): DataTypeMap[DT][]
```

[`DataTypeMap`](#datatypemap)\[`DT`\][]

</MemberCard>

<a id="expression-3" name="expression-3"></a>

<MemberCard>

##### AbstractTensor.expression

###### Get Signature

```ts
get expression(): BoxedExpression
```

[`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="array" name="array"></a>

<MemberCard>

##### AbstractTensor.array

###### Get Signature

```ts
get array(): NestedArray<DataTypeMap[DT]>
```

Like expression(), but return a nested JS array instead
of a BoxedExpression

[`NestedArray`](#nestedarrayt)\<[`DataTypeMap`](#datatypemap)\[`DT`\]\>

</MemberCard>

<a id="issquare" name="issquare"></a>

<MemberCard>

##### AbstractTensor.isSquare

###### Get Signature

```ts
get isSquare(): boolean
```

`boolean`

</MemberCard>

<a id="issymmetric" name="issymmetric"></a>

<MemberCard>

##### AbstractTensor.isSymmetric

###### Get Signature

```ts
get isSymmetric(): boolean
```

`boolean`

</MemberCard>

<a id="isskewsymmetric" name="isskewsymmetric"></a>

<MemberCard>

##### AbstractTensor.isSkewSymmetric

###### Get Signature

```ts
get isSkewSymmetric(): boolean
```

`boolean`

</MemberCard>

<a id="isuppertriangular" name="isuppertriangular"></a>

<MemberCard>

##### AbstractTensor.isUpperTriangular

###### Get Signature

```ts
get isUpperTriangular(): boolean
```

`boolean`

</MemberCard>

<a id="islowertriangular" name="islowertriangular"></a>

<MemberCard>

##### AbstractTensor.isLowerTriangular

###### Get Signature

```ts
get isLowerTriangular(): boolean
```

`boolean`

</MemberCard>

<a id="istriangular" name="istriangular"></a>

<MemberCard>

##### AbstractTensor.isTriangular

###### Get Signature

```ts
get isTriangular(): boolean
```

`boolean`

</MemberCard>

<a id="isdiagonal" name="isdiagonal"></a>

<MemberCard>

##### AbstractTensor.isDiagonal

###### Get Signature

```ts
get isDiagonal(): boolean
```

`boolean`

</MemberCard>

<a id="isidentity" name="isidentity"></a>

<MemberCard>

##### AbstractTensor.isIdentity

###### Get Signature

```ts
get isIdentity(): boolean
```

`boolean`

</MemberCard>

<a id="iszero-4" name="iszero-4"></a>

<MemberCard>

##### AbstractTensor.isZero

###### Get Signature

```ts
get isZero(): boolean
```

`boolean`

</MemberCard>

<a id="align" name="align"></a>

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

• **T1** *extends* keyof [`DataTypeMap`](#datatypemap)

• **T2** *extends* keyof [`DataTypeMap`](#datatypemap)

###### lhs

[`AbstractTensor`](#abstracttensordt)\<`T1`\>

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`T2`\>

\[[`AbstractTensor`](#abstracttensordt)\<`T1`\>, [`AbstractTensor`](#abstracttensordt)\<`T1`\>\]

###### align(lhs, rhs)

```ts
static align<T1, T2>(lhs, rhs): [AbstractTensor<T2>, AbstractTensor<T2>]
```

Return a tuple of tensors that have the same dtype.
If necessary, one of the two input tensors is upcast.

The shape of the tensors is reshaped to a compatible
shape. If the shape is not compatible, `undefined` is returned.

• **T1** *extends* keyof [`DataTypeMap`](#datatypemap)

• **T2** *extends* keyof [`DataTypeMap`](#datatypemap)

###### lhs

[`AbstractTensor`](#abstracttensordt)\<`T1`\>

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`T2`\>

\[[`AbstractTensor`](#abstracttensordt)\<`T2`\>, [`AbstractTensor`](#abstracttensordt)\<`T2`\>\]

</MemberCard>

<a id="broadcast" name="broadcast"></a>

<MemberCard>

##### AbstractTensor.broadcast()

```ts
static broadcast<T>(
   fn, 
   lhs, 
rhs): AbstractTensor<T>
```

Apply a function to the elements of two tensors, or to a tensor
and a scalar.

The tensors are aligned and broadcasted if necessary.

• **T** *extends* keyof [`DataTypeMap`](#datatypemap)

###### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`T`\]

###### lhs

[`AbstractTensor`](#abstracttensordt)\<`T`\>

###### rhs

[`DataTypeMap`](#datatypemap)\[`T`\] | [`AbstractTensor`](#abstracttensordt)\<`T`\>

[`AbstractTensor`](#abstracttensordt)\<`T`\>

</MemberCard>

<a id="at" name="at"></a>

<MemberCard>

##### AbstractTensor.at()

```ts
at(...indices): DataTypeMap[DT]
```

The number of indices should match the rank of the tensor.

Note: the indices are 1-based
Note: the data is broadcast (wraps around) if the indices are out of bounds

LaTeX notation `A\lbracki, j\rbrack` or `A_{i, j}`

###### indices

...`number`[]

[`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="diagonal" name="diagonal"></a>

<MemberCard>

##### AbstractTensor.diagonal()

```ts
diagonal(axis1?, axis2?): DataTypeMap[DT][]
```

###### axis1?

`number`

###### axis2?

`number`

[`DataTypeMap`](#datatypemap)\[`DT`\][]

</MemberCard>

<a id="trace" name="trace"></a>

<MemberCard>

##### AbstractTensor.trace()

```ts
trace(axis1?, axis2?): DataTypeMap[DT]
```

###### axis1?

`number`

###### axis2?

`number`

[`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="reshape" name="reshape"></a>

<MemberCard>

##### AbstractTensor.reshape()

```ts
reshape(...shape): AbstractTensor<DT>
```

Change the shape of the tensor

The data is reused (and shared) between the two tensors.

###### shape

...`number`[]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="flatten" name="flatten"></a>

<MemberCard>

##### AbstractTensor.flatten()

```ts
flatten(): DataTypeMap[DT][]
```

[`DataTypeMap`](#datatypemap)\[`DT`\][]

</MemberCard>

<a id="upcast" name="upcast"></a>

<MemberCard>

##### AbstractTensor.upcast()

```ts
upcast<DT>(dtype): AbstractTensor<DT>
```

• **DT** *extends* keyof [`DataTypeMap`](#datatypemap)

###### dtype

`DT`

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="transpose" name="transpose"></a>

<MemberCard>

##### AbstractTensor.transpose()

###### transpose()

```ts
transpose(): AbstractTensor<DT>
```

Transpose the first and second axis

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

###### transpose(axis1, axis2, fn)

```ts
transpose(
   axis1, 
   axis2, 
fn?): AbstractTensor<DT>
```

Transpose two axes.

###### axis1

`number`

###### axis2

`number`

###### fn?

(`v`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="conjugatetranspose" name="conjugatetranspose"></a>

<MemberCard>

##### AbstractTensor.conjugateTranspose()

```ts
conjugateTranspose(axis1, axis2): AbstractTensor<DT>
```

###### axis1

`number`

###### axis2

`number`

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="determinant" name="determinant"></a>

<MemberCard>

##### AbstractTensor.determinant()

```ts
determinant(): DataTypeMap[DT]
```

[`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="inverse" name="inverse"></a>

<MemberCard>

##### AbstractTensor.inverse()

```ts
inverse(): AbstractTensor<DT>
```

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="pseudoinverse" name="pseudoinverse"></a>

<MemberCard>

##### AbstractTensor.pseudoInverse()

```ts
pseudoInverse(): AbstractTensor<DT>
```

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="adjugatematrix" name="adjugatematrix"></a>

<MemberCard>

##### AbstractTensor.adjugateMatrix()

```ts
adjugateMatrix(): AbstractTensor<DT>
```

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="minor" name="minor"></a>

<MemberCard>

##### AbstractTensor.minor()

```ts
minor(i, j): DataTypeMap[DT]
```

###### i

`number`

###### j

`number`

[`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<a id="map1" name="map1"></a>

<MemberCard>

##### AbstractTensor.map1()

```ts
map1(fn, scalar): AbstractTensor<DT>
```

###### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

###### scalar

[`DataTypeMap`](#datatypemap)\[`DT`\]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="map2" name="map2"></a>

<MemberCard>

##### AbstractTensor.map2()

```ts
map2(fn, rhs): AbstractTensor<DT>
```

###### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="add-4" name="add-4"></a>

<MemberCard>

##### AbstractTensor.add()

```ts
add(rhs): AbstractTensor<DT>
```

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="subtract" name="subtract"></a>

<MemberCard>

##### AbstractTensor.subtract()

```ts
subtract(rhs): AbstractTensor<DT>
```

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="multiply" name="multiply"></a>

<MemberCard>

##### AbstractTensor.multiply()

```ts
multiply(rhs): AbstractTensor<DT>
```

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="divide" name="divide"></a>

<MemberCard>

##### AbstractTensor.divide()

```ts
divide(rhs): AbstractTensor<DT>
```

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="power" name="power"></a>

<MemberCard>

##### AbstractTensor.power()

```ts
power(rhs): AbstractTensor<DT>
```

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | [`DataTypeMap`](#datatypemap)\[`DT`\]

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

</MemberCard>

<a id="equals-3" name="equals-3"></a>

<MemberCard>

##### AbstractTensor.equals()

```ts
equals(rhs): boolean
```

###### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\>

`boolean`

</MemberCard>

<a id="maketensor" name="maketensor"></a>

<MemberCard>

### makeTensor()

```ts
function makeTensor<T>(ce, data): AbstractTensor<T>
```

• **T** *extends* keyof [`DataTypeMap`](#datatypemap)

##### ce

`IComputeEngine`

##### data

[`TensorData`](#tensordatadt)\<`T`\> | \{
`operator`: `string`;
`ops`: [`BoxedExpression`](#boxedexpression)[];
`dtype`: `T`;
`shape`: `number`[];
\}

[`AbstractTensor`](#abstracttensordt)\<`T`\>

</MemberCard>

<a id="sign" name="sign"></a>

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

<a id="canonicaloptions" name="canonicaloptions"></a>

### CanonicalOptions

```ts
type CanonicalOptions = 
  | boolean
  | CanonicalForm
  | CanonicalForm[];
```


<a name="math-jsonmd"></a>

## MathJSON

<a id="mathjsonattributes" name="mathjsonattributes"></a>

### MathJsonAttributes

```ts
type MathJsonAttributes = object;
```

#### Type declaration

<a id="comment"></a>

##### comment?

<a id="comment" name="comment"></a>

<MemberCard>

##### MathJsonAttributes.comment?

```ts
optional comment: string;
```

A human readable string to annotate this expression, since JSON does not
allow comments in its encoding

</MemberCard>

<a id="documentation"></a>

##### documentation?

<a id="documentation" name="documentation"></a>

<MemberCard>

##### MathJsonAttributes.documentation?

```ts
optional documentation: string;
```

A Markdown-encoded string providing documentation about this expression.

</MemberCard>

<a id="latex"></a>

##### latex?

<a id="latex" name="latex"></a>

<MemberCard>

##### MathJsonAttributes.latex?

```ts
optional latex: string;
```

A visual representation of this expression as a LaTeX string.

This can be useful to preserve non-semantic details, for example
parentheses in an expression or styling attributes.

</MemberCard>

<a id="wikidata"></a>

##### wikidata?

<a id="wikidata" name="wikidata"></a>

<MemberCard>

##### MathJsonAttributes.wikidata?

```ts
optional wikidata: string;
```

A short string referencing an entry in a wikibase.

For example:

`"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
 for the `Pi` constant.

</MemberCard>

<a id="wikibase"></a>

##### wikibase?

<a id="wikibase" name="wikibase"></a>

<MemberCard>

##### MathJsonAttributes.wikibase?

```ts
optional wikibase: string;
```

A base URL for the `wikidata` key.

A full URL can be produced by concatenating this key with the `wikidata`
key. This key applies to this node and all its children.

The default value is "https://www.wikidata.org/wiki/"

</MemberCard>

<a id="openmathsymbol"></a>

##### openmathSymbol?

<a id="openmathsymbol" name="openmathsymbol"></a>

<MemberCard>

##### MathJsonAttributes.openmathSymbol?

```ts
optional openmathSymbol: string;
```

A short string indicating an entry in an OpenMath Content Dictionary.

For example: `arith1/#abs`.

</MemberCard>

<a id="openmathcd"></a>

##### openmathCd?

<a id="openmathcd" name="openmathcd"></a>

<MemberCard>

##### MathJsonAttributes.openmathCd?

```ts
optional openmathCd: string;
```

A base URL for an OpenMath content dictionary. This key applies to this
node and all its children.

The default value is "http://www.openmath.org/cd".

</MemberCard>

<a id="sourceurl"></a>

##### sourceUrl?

<a id="sourceurl" name="sourceurl"></a>

<MemberCard>

##### MathJsonAttributes.sourceUrl?

```ts
optional sourceUrl: string;
```

A URL to the source code from which this expression was generated.

</MemberCard>

<a id="sourcecontent"></a>

##### sourceContent?

<a id="sourcecontent" name="sourcecontent"></a>

<MemberCard>

##### MathJsonAttributes.sourceContent?

```ts
optional sourceContent: string;
```

The source code from which this expression was generated.

It could be a LaTeX expression, or some other source language.

</MemberCard>

<a id="sourceoffsets"></a>

##### sourceOffsets?

<a id="sourceoffsets" name="sourceoffsets"></a>

<MemberCard>

##### MathJsonAttributes.sourceOffsets?

```ts
optional sourceOffsets: [number, number];
```

A character offset in `sourceContent` or `sourceUrl` from which this
expression was generated.

</MemberCard>

<a id="mathjsonidentifier" name="mathjsonidentifier"></a>

### MathJsonIdentifier

```ts
type MathJsonIdentifier = string;
```

<a id="mathjsonnumber" name="mathjsonnumber"></a>

### MathJsonNumber

```ts
type MathJsonNumber = object & MathJsonAttributes;
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

#### Type declaration

##### num

<MemberCard>

##### MathJsonNumber.num

```ts
num: "NaN" | "-Infinity" | "+Infinity" | string;
```

</MemberCard>

<a id="mathjsonsymbol" name="mathjsonsymbol"></a>

### MathJsonSymbol

```ts
type MathJsonSymbol = object & MathJsonAttributes;
```

#### Type declaration

##### sym

<MemberCard>

##### MathJsonSymbol.sym

```ts
sym: MathJsonIdentifier;
```

</MemberCard>

<a id="mathjsonstring" name="mathjsonstring"></a>

### MathJsonString

```ts
type MathJsonString = object & MathJsonAttributes;
```

#### Type declaration

##### str

<MemberCard>

##### MathJsonString.str

```ts
str: string;
```

</MemberCard>

<a id="mathjsonfunction" name="mathjsonfunction"></a>

### MathJsonFunction

```ts
type MathJsonFunction = object & MathJsonAttributes;
```

#### Type declaration

##### fn

<MemberCard>

##### MathJsonFunction.fn

```ts
fn: [MathJsonIdentifier, ...Expression[]];
```

</MemberCard>

<a id="expression" name="expression"></a>

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

## Other

<a id="expressionobject" name="expressionobject"></a>

### ExpressionObject

```ts
type ExpressionObject = 
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  | MathJsonFunction;
```
