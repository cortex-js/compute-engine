
<a name="commonmd"></a>

## Error Handling

<a id="runtimesignalcode" name="runtimesignalcode"></a>

### RuntimeSignalCode

```ts
type RuntimeSignalCode: "timeout" | "out-of-memory" | "recursion-depth-exceeded" | "iteration-limit-exceeded";
```

<a id="signalcode" name="signalcode"></a>

### SignalCode

```ts
type SignalCode: RuntimeSignalCode | 
  | "invalid-name"
  | "expected-predicate"
  | "expected-symbol"
  | "operator-requires-one-operand"
  | "postfix-operator-requires-one-operand"
  | "prefix-operator-requires-one-operand"
  | "unbalanced-symbols"
  | "expected-argument"
  | "unexpected-command"
  | "cyclic-definition"
  | "invalid-supersets"
  | "expected-supersets"
  | "unknown-domain"
  | "duplicate-wikidata"
  | "invalid-dictionary-entry"
  | "syntax-error";
```

<a id="signalmessage" name="signalmessage"></a>

### SignalMessage

```ts
type SignalMessage: SignalCode | [SignalCode, ...any[]];
```

<a id="signalorigin" name="signalorigin"></a>

### SignalOrigin

```ts
type SignalOrigin: Object;
```

#### Type declaration

<a id="url" name="url"></a>

<MemberCard>

##### SignalOrigin.url?

```ts
optional url: string;
```

</MemberCard>

<a id="source" name="source"></a>

<MemberCard>

##### SignalOrigin.source?

```ts
optional source: string;
```

</MemberCard>

<a id="offset" name="offset"></a>

<MemberCard>

##### SignalOrigin.offset?

```ts
optional offset: number;
```

</MemberCard>

<a id="line" name="line"></a>

<MemberCard>

##### SignalOrigin.line?

```ts
optional line: number;
```

</MemberCard>

<a id="column" name="column"></a>

<MemberCard>

##### SignalOrigin.column?

```ts
optional column: number;
```

</MemberCard>

<a id="around" name="around"></a>

<MemberCard>

##### SignalOrigin.around?

```ts
optional around: string;
```

</MemberCard>

<a id="signal" name="signal"></a>

### Signal

```ts
type Signal: Object;
```

#### Type declaration

<a id="severity" name="severity"></a>

<MemberCard>

##### Signal.severity?

```ts
optional severity: "warning" | "error";
```

</MemberCard>

<a id="message" name="message"></a>

<MemberCard>

##### Signal.message

```ts
message: SignalMessage;
```

An error/warning code or, a code with one or more arguments specific to
the signal code.

</MemberCard>

<a id="head" name="head"></a>

<MemberCard>

##### Signal.head?

```ts
optional head: string;
```

If applicable, the head of the function about which the
signal was raised

</MemberCard>

<a id="origin" name="origin"></a>

<MemberCard>

##### Signal.origin?

```ts
optional origin: SignalOrigin;
```

Location where the signal was raised.

</MemberCard>

<a id="errorsignal" name="errorsignal"></a>

### ErrorSignal

```ts
type ErrorSignal: Signal & Object;
```

#### Type declaration

<MemberCard>

##### ErrorSignal.severity

```ts
severity: "error";
```

</MemberCard>

<a id="warningsignal" name="warningsignal"></a>

### WarningSignal

```ts
type WarningSignal: Signal & Object;
```

#### Type declaration

<MemberCard>

##### WarningSignal.severity

```ts
severity: "warning";
```

</MemberCard>

<a id="warningsignalhandler" name="warningsignalhandler"></a>

### WarningSignalHandler

```ts
type WarningSignalHandler: (warnings) => void;
```

• **warnings**: [`WarningSignal`](#warningsignal)[]

<a id="errorcode" name="errorcode"></a>

### ErrorCode

```ts
type ErrorCode: 
  | "expected-argument"
  | "unexpected-argument"
  | "expected-operator"
  | "expected-operand"
  | "invalid-name"
  | "invalid-dictionary-entry"
  | "unknown-symbol"
  | "unknown-operator"
  | "unknown-function"
  | "unknown-command"
  | "unexpected-command"
  | "unbalanced-symbols"
  | "unexpected-superscript"
  | "unexpected-subscript"
  | "unexpected-sequence"
  | "non-associative-operator"
  | "function-has-too-many-arguments"
  | "function-has-too-few-arguments"
  | "operator-requires-one-operand"
  | "infix-operator-requires-two-operands"
  | "prefix-operator-requires-one-operand"
  | "postfix-operator-requires-one-operand"
  | "associative-function-has-too-few-arguments"
  | "commutative-function-has-too-few-arguments"
  | "threadable-function-has-too-few-arguments"
  | "hold-first-function-has-too-few-arguments"
  | "hold-rest-function-has-too-few-arguments"
  | "base-out-of-range"
  | "syntax-error";
```

The error codes can be used in an `ErrorCode` expression:

       `["ErrorCode", "'syntax-error'", arg1]`

It evaluates to a localized, human-readable string.

* `unknown-symbol`: a symbol was encountered which does not have a
definition.

* `unknown-operator`: a presumed operator was encountered which does not
have a definition.

* `unknown-function`: a LaTeX command was encountered which does not
have a definition.

* `unexpected-command`: a LaTeX command was encountered when only a string
was expected

* `unexpected-superscript`: a superscript was encountered in an unexpected
context, or no `powerFunction` was defined. By default, superscript can
be applied to numbers, symbols or expressions, but not to operators (e.g.
`2+^34`) or to punctuation.

* `unexpected-subscript`: a subscript was encountered in an unexpected
context or no 'subscriptFunction` was defined. By default, subscripts
are not expected on numbers, operators or symbols. Some commands (e.g. `\sum`)
do expected a subscript.

* `unexpected-sequence`: some adjacent elements were encountered (for
example `xy`), but the elements could not be combined. By default, adjacent
symbols are combined with `Multiply`, but adjacent numbers or adjacent
operators are not combined.

* `expected-argument`: a LaTeX command that requires one or more argument
was encountered without the required arguments.

* `expected-operand`: an operator was encountered without its required
operands.

* `non-associative-operator`: an operator which is not associative was
encountered in an associative context, for example: `a < b < c` (assuming
`<` is defined as non-associative)

* `postfix-operator-requires-one-operand`: a postfix operator which requires
a single argument was encountered with no arguments or more than one argument

* `prefix-operator-requires-one-operand`: a prefix operator which requires
a single argument was encountered with no arguments or more than one argument

* `base-out-of-range`:  The base is expected to be between 2 and 36.


<a name="compute-enginemd"></a>

The Compute Engine is a symbolic computation engine that can be used to
manipulate and evaluate mathematical expressions.

Use an instance of [`ComputeEngine`](#computeengine) to create boxed expressions
with [`ComputeEngine.parse`](#parse) and [`ComputeEngine.box`](#box).

Use a [`BoxedExpression`](#boxedexpression) object to manipulate and evaluate
mathematical expressions.

## Compute Engine

<a id="computeengine" name="computeengine"></a>

### ComputeEngine

To use the Compute Engine, create a `ComputeEngine` instance:

```js
ce = new ComputeEngine();
```

If using a mathfield, use the default Compute Engine instance from the
`MathfieldElement` class:

```js
ce = MathfieldElement.computeEngine
```

Use the instance to create boxed expressions with `ce.parse()` and `ce.box()`.

```js
const ce = new ComputeEngine();

let expr = ce.parse("e^{i\\pi}");
console.log(expr.N().latex);
// ➔ "-1"

expr = ce.box(["Expand", ["Power", ["Add", "a", "b"], 2]]);
console.log(expr.evaluate().latex);
// ➔ "a^2 +  2ab + b^2"
```

<a id="constructors" name="constructors"></a>

<MemberCard>

##### new ComputeEngine()

```ts
new ComputeEngine(options?): ComputeEngine
```

Construct a new `ComputeEngine` instance.

Identifier tables define functions and symbols (in `options.ids`).
If no table is provided the MathJSON Standard Library is used (`ComputeEngine.getStandardLibrary()`)

The LaTeX syntax dictionary is defined in `options.latexDictionary`.

The order of the dictionaries matter: the definitions from the later ones
override the definitions from earlier ones. The first dictionary should
be the `'core'` dictionary which include some basic definitions such
as domains (`Booleans`, `Numbers`, etc...) that are used by later
dictionaries.

• **options?**

• **options\.numericMode?**: [`NumericMode`](#numericmode-1)

The default mode is `"auto"`. Use `"machine"`
to perform numeric calculations using 64-bit floats. Use `"bignum"` to
perform calculations using arbitrary precision floating point numbers.
Use `"auto"` or `"complex"` to allow calculations on complex numbers.

• **options\.numericPrecision?**: `number`

Specific how many digits of precision
for the numeric calculations. Default is 100.

• **options\.ids?**: readonly `Readonly`\<`Object`\>[]

• **options\.tolerance?**: `number`

If the absolute value of the difference of two
numbers is less than `tolerance`, they are considered equal. Used by
`chop()` as well.

</MemberCard>

<a id="anything" name="anything"></a>

<MemberCard>

##### ComputeEngine.Anything

```ts
readonly Anything: BoxedDomain;
```

</MemberCard>

<a id="void" name="void"></a>

<MemberCard>

##### ComputeEngine.Void

```ts
readonly Void: BoxedDomain;
```

</MemberCard>

<a id="strings" name="strings"></a>

<MemberCard>

##### ComputeEngine.Strings

```ts
readonly Strings: BoxedDomain;
```

</MemberCard>

<a id="booleans" name="booleans"></a>

<MemberCard>

##### ComputeEngine.Booleans

```ts
readonly Booleans: BoxedDomain;
```

</MemberCard>

<a id="numbers" name="numbers"></a>

<MemberCard>

##### ComputeEngine.Numbers

```ts
readonly Numbers: BoxedDomain;
```

</MemberCard>

<a id="true" name="true"></a>

<MemberCard>

##### ComputeEngine.True

```ts
readonly True: BoxedExpression;
```

</MemberCard>

<a id="false" name="false"></a>

<MemberCard>

##### ComputeEngine.False

```ts
readonly False: BoxedExpression;
```

</MemberCard>

<a id="pi" name="pi"></a>

<MemberCard>

##### ComputeEngine.Pi

```ts
readonly Pi: BoxedExpression;
```

</MemberCard>

<a id="e" name="e"></a>

<MemberCard>

##### ComputeEngine.E

```ts
readonly E: BoxedExpression;
```

</MemberCard>

<a id="nothing" name="nothing"></a>

<MemberCard>

##### ComputeEngine.Nothing

```ts
readonly Nothing: BoxedExpression;
```

</MemberCard>

<a id="zero" name="zero"></a>

<MemberCard>

##### ComputeEngine.Zero

```ts
readonly Zero: BoxedExpression;
```

</MemberCard>

<a id="one" name="one"></a>

<MemberCard>

##### ComputeEngine.One

```ts
readonly One: BoxedExpression;
```

</MemberCard>

<a id="half" name="half"></a>

<MemberCard>

##### ComputeEngine.Half

```ts
readonly Half: BoxedExpression;
```

</MemberCard>

<a id="negativeone" name="negativeone"></a>

<MemberCard>

##### ComputeEngine.NegativeOne

```ts
readonly NegativeOne: BoxedExpression;
```

</MemberCard>

<a id="i" name="i"></a>

<MemberCard>

##### ComputeEngine.I

```ts
readonly I: BoxedExpression;
```

</MemberCard>

<a id="nan" name="nan"></a>

<MemberCard>

##### ComputeEngine.NaN

```ts
readonly NaN: BoxedExpression;
```

</MemberCard>

<a id="positiveinfinity" name="positiveinfinity"></a>

<MemberCard>

##### ComputeEngine.PositiveInfinity

```ts
readonly PositiveInfinity: BoxedExpression;
```

</MemberCard>

<a id="negativeinfinity" name="negativeinfinity"></a>

<MemberCard>

##### ComputeEngine.NegativeInfinity

```ts
readonly NegativeInfinity: BoxedExpression;
```

</MemberCard>

<a id="complexinfinity" name="complexinfinity"></a>

<MemberCard>

##### ComputeEngine.ComplexInfinity

```ts
readonly ComplexInfinity: BoxedExpression;
```

</MemberCard>

<a id="context" name="context"></a>

<MemberCard>

##### ComputeEngine.context

```ts
context: RuntimeScope;
```

The current scope.

A **scope** stores the definition of symbols and assumptions.

Scopes form a stack, and definitions in more recent
scopes can obscure definitions from older scopes.

The `ce.context` property represents the current scope.

</MemberCard>

<a id="strict" name="strict"></a>

<MemberCard>

##### ComputeEngine.strict

```ts
strict: boolean;
```

In strict mode (the default) the Compute Engine performs
validation of domains and signature and may report errors.

These checks may impact performance

When strict mode is off, results may be incorrect or generate JavaScript
errors if the input is not valid.

</MemberCard>

<a id="latexdictionary" name="latexdictionary"></a>

<MemberCard>

##### ComputeEngine.latexDictionary

```ts
get latexDictionary(): readonly LatexDictionaryEntry[]
```

```ts
set latexDictionary(dic): void
```

readonly [`LatexDictionaryEntry`](#latexdictionaryentry)[]

• **dic**: readonly [`LatexDictionaryEntry`](#latexdictionaryentry)[]

</MemberCard>

<a id="precision" name="precision"></a>

<MemberCard>

##### ComputeEngine.precision

```ts
get precision(): number
```

```ts
set precision(p): void
```

The precision, or number of significant digits, of numeric
calculations when the numeric mode is `"auto"` or `"bignum"`.

To make calculations using more digits, at the cost of expanded memory
usage and slower computations, set the `precision` higher.

If the numeric mode is not `"auto"` or `"bignum"`, it is set to `"auto"`.

Trigonometric operations are accurate for precision up to 1,000.

`number`

• **p**: `number` \| `"machine"`

</MemberCard>

<a id="numericmode" name="numericmode"></a>

<MemberCard>

##### ComputeEngine.numericMode

```ts
get numericMode(): NumericMode
```

```ts
set numericMode(f): void
```

The numeric evaluation mode:

<div className="symbols-table">

| Mode | |
| :--- | :----- |
| `"auto"`| Use bignum or complex numbers. |
| `"machine"` |  **IEEE 754-2008**, 64-bit floating point numbers: 52-bit mantissa, about 15 digits of precision |
| `"bignum"` | Arbitrary precision floating point numbers, as provided by the "decimal.js" library | 
| `"complex"` | Complex number represented by two machine numbers, a real and an imaginary part, as provided by the "complex.js" library |

</div>

[`NumericMode`](#numericmode-1)

• **f**: [`NumericMode`](#numericmode-1)

</MemberCard>

<a id="angularunit" name="angularunit"></a>

<MemberCard>

##### ComputeEngine.angularUnit

```ts
get angularUnit(): AngularUnit
```

```ts
set angularUnit(u): void
```

The unit used for angles in trigonometric functions.
Default is `"rad"` (radians).

[`AngularUnit`](#angularunit-1)

• **u**: [`AngularUnit`](#angularunit-1)

</MemberCard>

<a id="timelimit" name="timelimit"></a>

<MemberCard>

##### ComputeEngine.timeLimit

```ts
get timeLimit(): number
```

`number`

</MemberCard>

<a id="iterationlimit" name="iterationlimit"></a>

<MemberCard>

##### ComputeEngine.iterationLimit

```ts
get iterationLimit(): number
```

`number`

</MemberCard>

<a id="recursionlimit" name="recursionlimit"></a>

<MemberCard>

##### ComputeEngine.recursionLimit

```ts
get recursionLimit(): number
```

`number`

</MemberCard>

<a id="tolerance" name="tolerance"></a>

<MemberCard>

##### ComputeEngine.tolerance

```ts
get tolerance(): number
```

```ts
set tolerance(val): void
```

Values smaller than the tolerance are considered to be zero for the
purpose of comparison, i.e. if `|b - a| <= tolerance`, `b` is considered
equal to `a`.

`number`

• **val**: `number`

</MemberCard>

<a id="costfunction" name="costfunction"></a>

<MemberCard>

##### ComputeEngine.costFunction

```ts
get costFunction(): (expr) => number
```

```ts
set costFunction(fn): void
```

The cost function is used to determine the "cost" of an expression. For example, when simplifying an expression, the simplification that results in the lowest cost is chosen.

(`expr`) => `number`

> • **expr**: [`BoxedExpression`](#boxedexpression)
>

• **fn**

</MemberCard>

<a id="assumptions" name="assumptions"></a>

<MemberCard>

##### ComputeEngine.assumptions

```ts
get assumptions(): ExpressionMapInterface<boolean>
```

[`ExpressionMapInterface`](#expressionmapinterfaceu)\<`boolean`\>

</MemberCard>

<a id="latexoptions" name="latexoptions"></a>

<MemberCard>

##### ComputeEngine.latexOptions

```ts
get latexOptions(): NumberFormattingOptions & ParseLatexOptions & SerializeLatexOptions
```

```ts
set latexOptions(opts): void
```

The LaTeX serialization options can be set using the
[`ComputeEngine.latexOptions`](#latexoptions) property.

[`NumberFormattingOptions`](#numberformattingoptions) & [`ParseLatexOptions`](#parselatexoptions) & [`SerializeLatexOptions`](#serializelatexoptions)

• **opts**: `Partial`\<[`NumberFormattingOptions`](#numberformattingoptions)\> & `Partial`\<[`ParseLatexOptions`](#parselatexoptions)\> & `Partial`\<[`SerializeLatexOptions`](#serializelatexoptions)\>

</MemberCard>

<a id="jsonserializationoptions" name="jsonserializationoptions"></a>

<MemberCard>

##### ComputeEngine.jsonSerializationOptions

```ts
get jsonSerializationOptions(): Readonly<JsonSerializationOptions>
```

```ts
set jsonSerializationOptions(val): void
```

`Readonly`\<[`JsonSerializationOptions`](#jsonserializationoptions-1)\>

• **val**: `Partial`\<[`JsonSerializationOptions`](#jsonserializationoptions-1)\>

</MemberCard>

<a id="getstandardlibrary" name="getstandardlibrary"></a>

<MemberCard>

##### ComputeEngine.getStandardLibrary()

```ts
static getStandardLibrary(categories): readonly Readonly<Object>[]
```

Return identifier tables suitable for the specified categories, or `"all"`
for all categories (`"arithmetic"`, `"algebra"`, etc...).

An identifier table defines how the symbols and function names in a
MathJSON expression should be interpreted, i.e. how to evaluate and
manipulate them.

• **categories**: `"all"` \| [`LibraryCategory`](#librarycategory) \| [`LibraryCategory`](#librarycategory)[]= `'all'`

</MemberCard>

<a id="chop" name="chop"></a>

<MemberCard>

##### ComputeEngine.chop()

###### chop(n)

```ts
chop(n): number
```

Replace a number that is close to 0 with the exact integer 0.

How close to 0 the number has to be to be considered 0 is determined by [`tolerance`](#tolerance).

• **n**: `number`

###### chop(n)

```ts
chop(n): 0 | Decimal
```

• **n**: `Decimal`

###### chop(n)

```ts
chop(n): 0 | Complex
```

• **n**: `Complex`

</MemberCard>

<a id="bignum" name="bignum"></a>

<MemberCard>

##### ComputeEngine.bignum()

```ts
bignum(a): Decimal
```

Create an arbitrary precision number. 

The return value is an object with methods to perform arithmetic
operations:
- `toNumber()`: convert to a JavaScript `number` with potential loss of precision
- `add()`
- `sub()`
- `neg()` (unary minus)
- `mul()`
- `div()`
- `pow()`
- `sqrt()` (square root)
- `cbrt()` (cube root)
- `exp()`  (e^x)
- `log()` 
- `ln()` (natural logarithm)
- `mod()`

- `abs()`
- `ceil()`
- `floor()`
- `round()`

- `equals()`
- `gt()`
- `gte()`
- `lt()`
- `lte()`

- `cos()`
- `sin()`
- `tanh()`
- `acos()`
- `asin()`
- `atan()`
- `cosh()`
- `sinh()`
- `acosh()`
- `asinh()`
- `atanh()`

- `isFinite()`
- `isInteger()`
- `isNaN()`
- `isNegative()`
- `isPositive()`
- `isZero()`
- `sign()` (1, 0 or -1)

• **a**: `bigint` \| `Value`

</MemberCard>

<a id="complex" name="complex"></a>

<MemberCard>

##### ComputeEngine.complex()

```ts
complex(a, b?): Complex
```

Create a complex number.
The return value is an object with methods to perform arithmetic
operations:
- `re` (real part, as a JavaScript `number`)
- `im` (imaginary part, as a JavaScript `number`)
- `add()`
- `sub()`
- `neg()` (unary minus)
- `mul()`
- `div()`
- `pow()`
- `sqrt()` (square root)
- `exp()`  (e^x)
- `log()` 
- `ln()` (natural logarithm)
- `mod()`

- `abs()`
- `ceil()`
- `floor()`
- `round()`

- `arg()` the angle of the complex number
- `inverse()` the inverse of the complex number 1/z
- `conjugate()` the conjugate of the complex number

- `equals()`

- `cos()`
- `sin()`
- `tanh()`
- `acos()`
- `asin()`
- `atan()`
- `cosh()`
- `sinh()`
- `acosh()`
- `asinh()`
- `atanh()`

- `isFinite()`
- `isNaN()`
- `isZero()`
- `sign()` (1, 0 or -1)

• **a**: `number` \| `Complex` \| `Decimal`

• **b?**: `number` \| `Decimal`

</MemberCard>

<a id="isbignum" name="isbignum"></a>

<MemberCard>

##### ComputeEngine.isBignum()

```ts
isBignum(a): a is Decimal
```

• **a**: `unknown`

</MemberCard>

<a id="iscomplex" name="iscomplex"></a>

<MemberCard>

##### ComputeEngine.isComplex()

```ts
isComplex(a): a is Complex
```

• **a**: `unknown`

</MemberCard>

<a id="getlatexdictionary" name="getlatexdictionary"></a>

<MemberCard>

##### ComputeEngine.getLatexDictionary()

```ts
static getLatexDictionary(domain): readonly object[]
```

• **domain**: `"all"` \| [`LibraryCategory`](#librarycategory)= `'all'`

</MemberCard>

<a id="lookupsymbol" name="lookupsymbol"></a>

<MemberCard>

##### ComputeEngine.lookupSymbol()

```ts
lookupSymbol(
   symbol, 
   wikidata?, 
   scope?): BoxedSymbolDefinition
```

Return a matching symbol definition, starting with the current
scope and going up the scope chain. Prioritize finding a match by
wikidata, if provided.

• **symbol**: `string`

• **wikidata?**: `string`

• **scope?**: [`RuntimeScope`](#runtimescope)

</MemberCard>

<a id="lookupfunction" name="lookupfunction"></a>

<MemberCard>

##### ComputeEngine.lookupFunction()

```ts
lookupFunction(head, scope?): BoxedFunctionDefinition
```

Return the definition for a function matching this head.

Start looking in the current context, than up the scope chain.

This is a very rough lookup, since it doesn't account for the domain
of the argument or the codomain. However, it is useful during parsing
to differentiate between symbols that might represent a function application, e.g. `f` vs `x`.

• **head**: `string` \| [`BoxedExpression`](#boxedexpression)

• **scope?**: [`RuntimeScope`](#runtimescope)

</MemberCard>

<a id="_definesymbol" name="_definesymbol"></a>

<MemberCard>

##### ComputeEngine.\_defineSymbol()

```ts
_defineSymbol(name, def): BoxedSymbolDefinition
```

• **name**: `string`

• **def**: [`SymbolDefinition`](#symboldefinition-1)

</MemberCard>

<a id="_definefunction" name="_definefunction"></a>

<MemberCard>

##### ComputeEngine.\_defineFunction()

```ts
_defineFunction(name, def): BoxedFunctionDefinition
```

• **name**: `string`

• **def**: [`FunctionDefinition`](#functiondefinition-1)

</MemberCard>

<a id="pushscope" name="pushscope"></a>

<MemberCard>

##### ComputeEngine.pushScope()

```ts
pushScope(scope?): ComputeEngine
```

Create a new scope and add it to the top of the scope stack

The `scope` argument can be used to specify custom precision,
etc... for this scope

• **scope?**: `Partial`\<[`Scope`](#scope-2)\>

</MemberCard>

<a id="popscope" name="popscope"></a>

<MemberCard>

##### ComputeEngine.popScope()

```ts
popScope(): ComputeEngine
```

Remove the most recent scope from the scope stack, and set its
 parent scope as current.

</MemberCard>

<a id="swapscope" name="swapscope"></a>

<MemberCard>

##### ComputeEngine.swapScope()

```ts
swapScope(scope): RuntimeScope
```

Set the current scope, return the previous scope.

• **scope**: [`RuntimeScope`](#runtimescope)

</MemberCard>

<a id="declare" name="declare"></a>

<MemberCard>

##### ComputeEngine.declare()

###### declare(id, def)

```ts
declare(id, def): ComputeEngine
```

Declare an identifier: specify their domain, and other attributes,
including optionally a value.

Once the domain of an identifier has been declared, it cannot be changed.
The domain information is used to calculate the canonical form of
expressions and ensure they are valid. If the domain could be changed
after the fact, previously valid expressions could become invalid.

Use the `Anyting` domain for a very generic domain.

• **id**: `string`

• **def**: [`BoxedDomain`](#boxeddomain) \| [`SymbolDefinition`](#symboldefinition-1) \| [`FunctionDefinition`](#functiondefinition-1) \| [`DomainExpression`](#domainexpressiont)

###### declare(identifiers)

```ts
declare(identifiers): ComputeEngine
```

• **identifiers**

</MemberCard>

<a id="assign" name="assign"></a>

<MemberCard>

##### ComputeEngine.assign()

###### assign(id, value)

```ts
assign(id, value): ComputeEngine
```

Assign a value to an identifier in the current scope.
Use `undefined` to reset the identifier to no value.

The identifier should be a valid MathJSON identifier
not a LaTeX string.

The identifier can take the form "f(x, y") to create a function
with two parameters, "x" and "y".

If the id was not previously declared, an automatic declaration
is done. The domain of the identifier is inferred from the value.
To more precisely define the domain of the identifier, use `ce.declare()`
instead, which allows you to specify the domain, value and other
attributes of the identifier.

• **id**: `string`

• **value**: [`AssignValue`](#assignvalue)

###### assign(ids)

```ts
assign(ids): ComputeEngine
```

• **ids**

</MemberCard>

<a id="box" name="box"></a>

<MemberCard>

##### ComputeEngine.box()

```ts
box(expr, options?): BoxedExpression
```

Return a boxed expression from a number, string or semiboxed expression.
Calls `ce.function()`, `ce.number()` or `ce.symbol()` as appropriate.

• **expr**: [`SemiBoxedExpression`](#semiboxedexpression) \| [`number`, `number`]

• **options?**

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="function" name="function"></a>

<MemberCard>

##### ComputeEngine.function()

```ts
function(
   head, 
   ops, 
   options?): BoxedExpression
```

• **head**: `string`

• **ops**: [`SemiBoxedExpression`](#semiboxedexpression)[]

• **options?**

• **options\.metadata?**: [`Metadata`](#metadata)

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="error" name="error"></a>

<MemberCard>

##### ComputeEngine.error()

```ts
error(message, where?): BoxedExpression
```

Shortcut for `this.box(["Error",...])`.

The result is canonical.

• **message**: `string` \| [`string`, `...SemiBoxedExpression[]`]

• **where?**: [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

<a id="domainerror" name="domainerror"></a>

<MemberCard>

##### ComputeEngine.domainError()

```ts
domainError(
   expectedDomain, 
   actualDomain, 
   where?): BoxedExpression
```

• **expectedDomain**: [`BoxedDomain`](#boxeddomain) \| [`DomainLiteral`](#domainliteral)

• **actualDomain**: [`BoxedDomain`](#boxeddomain)

• **where?**: [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

<a id="hold" name="hold"></a>

<MemberCard>

##### ComputeEngine.hold()

```ts
hold(expr): BoxedExpression
```

Add a`["Hold"]` wrapper to `expr.

• **expr**: [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

<a id="add" name="add"></a>

<MemberCard>

##### ComputeEngine.add()

```ts
add(...ops): BoxedExpression
```

Shortcut for `this.box(["Add", ...]).evaluate()`.

• ...**ops**: [`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="neg" name="neg"></a>

<MemberCard>

##### ComputeEngine.neg()

```ts
neg(expr): BoxedExpression
```

Shortcut for `this.box(["Negate", expr]).evaluate()`

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="mul" name="mul"></a>

<MemberCard>

##### ComputeEngine.mul()

```ts
mul(...ops): BoxedExpression
```

Shortcut for `this.box(["Multiply", ...]).evaluate()`

• ...**ops**: readonly [`BoxedExpression`](#boxedexpression)[]

</MemberCard>

<a id="div" name="div"></a>

<MemberCard>

##### ComputeEngine.div()

```ts
div(num, denom): BoxedExpression
```

Shortcut for `this.box(["Divide", num, denom]).evaluate()`

The result is canonical.

• **num**: [`BoxedExpression`](#boxedexpression)

• **denom**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="sqrt" name="sqrt"></a>

<MemberCard>

##### ComputeEngine.sqrt()

```ts
sqrt(base): any
```

Shortcut for `this.box(["Sqrt", base]).evaluate()`

• **base**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="pow" name="pow"></a>

<MemberCard>

##### ComputeEngine.pow()

```ts
pow(base, exponent): BoxedExpression
```

Shortcut for `this.box(["Power", base, exponent]).evaluate()`

• **base**: [`BoxedExpression`](#boxedexpression)

• **exponent**: `number` \| [`BoxedExpression`](#boxedexpression) \| [`Rational`](#rational)

</MemberCard>

<a id="inv" name="inv"></a>

<MemberCard>

##### ComputeEngine.inv()

```ts
inv(expr): BoxedExpression
```

Shortcut for `this.box(["Divide", 1, expr]).evaluate()`

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="pair" name="pair"></a>

<MemberCard>

##### ComputeEngine.pair()

```ts
pair(
   first, 
   second, 
   metadata?): BoxedExpression
```

Shortcut for `this.box(["Pair", ...])`

The result is canonical.

• **first**: [`BoxedExpression`](#boxedexpression)

• **second**: [`BoxedExpression`](#boxedexpression)

• **metadata?**: [`Metadata`](#metadata)

</MemberCard>

<a id="tuple" name="tuple"></a>

<MemberCard>

##### ComputeEngine.tuple()

###### tuple(elements, metadata)

```ts
tuple(elements, metadata?): BoxedExpression
```

Shortcut for `this.box(["Tuple", ...])`

The result is canonical.

• **elements**: `number`[]

• **metadata?**: [`Metadata`](#metadata)

###### tuple(elements, metadata)

```ts
tuple(elements, metadata?): BoxedExpression
```

• **elements**: [`BoxedExpression`](#boxedexpression)[]

• **metadata?**: [`Metadata`](#metadata)

</MemberCard>

<a id="array" name="array"></a>

<MemberCard>

##### ComputeEngine.array()

```ts
array(elements, metadata?): BoxedExpression
```

• **elements**: [`ArrayValue`](#arrayvalue)[] \| [`ArrayValue`](#arrayvalue)[][]

• **metadata?**: [`Metadata`](#metadata)

</MemberCard>

<a id="string" name="string"></a>

<MemberCard>

##### ComputeEngine.string()

```ts
string(s, metadata?): BoxedExpression
```

• **s**: `string`

• **metadata?**: [`Metadata`](#metadata)

</MemberCard>

<a id="symbol" name="symbol"></a>

<MemberCard>

##### ComputeEngine.symbol()

```ts
symbol(name, options?): BoxedExpression
```

Return a boxed symbol

• **name**: `string`

• **options?**

• **options\.metadata?**: [`Metadata`](#metadata)

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="domain" name="domain"></a>

<MemberCard>

##### ComputeEngine.domain()

```ts
domain(domain, metadata?): BoxedDomain
```

Return a canonical boxed domain.

If the domain is invalid, may return an `["Error"]` expression

• **domain**: [`BoxedDomain`](#boxeddomain) \| [`DomainExpression`](#domainexpressiont)

• **metadata?**: [`Metadata`](#metadata)

</MemberCard>

<a id="number" name="number"></a>

<MemberCard>

##### ComputeEngine.number()

```ts
number(value, options?): BoxedExpression
```

This function tries to avoid creating a boxed number if `num` corresponds
to a common value for which we have a shared instance (-1, 0, NaN, etc...)

• **value**: 
  \| `string`
  \| `number`
  \| `bigint`
  \| `Complex`
  \| `Decimal`
  \| [`MathJsonNumber`](#mathjsonnumber)
  \| [`Rational`](#rational)

• **options?**

• **options\.metadata?**: [`Metadata`](#metadata)

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="rules" name="rules"></a>

<MemberCard>

##### ComputeEngine.rules()

```ts
rules(rules): BoxedRuleSet
```

• **rules**: [`Rule`](#rule)[]

</MemberCard>

<a id="parse" name="parse"></a>

<MemberCard>

##### ComputeEngine.parse()

###### parse(latex, options)

```ts
parse(latex, options?): BoxedExpression
```

Parse a string of LaTeX and return a corresponding `BoxedExpression`.

The result may not be canonical.

• **latex**: `string`

• **options?**

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

###### parse(s, options)

```ts
parse(s, options?): null
```

• **s**: `null`

• **options?**

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

###### parse(latex, options)

```ts
parse(latex, options?): BoxedExpression
```

• **latex**: `string`

• **options?**

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="serialize" name="serialize"></a>

<MemberCard>

##### ComputeEngine.serialize()

```ts
serialize(x, options?): string
```

Serialize a `BoxedExpression` or a `MathJSON` expression to a LaTeX
string.

If the `canonical` option is set to `true`, the result will use canonical
serialization rules (for example (a/b)*(c/d) -> (a*c)/(b*d)).
If false, avoid any canonicalization (i.e. (a/b)*(c/d) -> (a/b)*(c/d)).

The `canonical` option is true by default.

• **x**: [`Expression`](#expression) \| [`BoxedExpression`](#boxedexpression)

• **options?**

• **options\.canonical?**: `boolean`

</MemberCard>

<a id="rawjson" name="rawjson"></a>

<MemberCard>

##### ComputeEngine.rawJson()

```ts
rawJson(expr): Expression
```

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="ask" name="ask"></a>

<MemberCard>

##### ComputeEngine.ask()

```ts
ask(pattern): BoxedSubstitution[]
```

Return a list of all the assumptions that match a pattern.

```js
 ce.assume(['Element', 'x', 'PositiveIntegers');
 ce.ask(['Greater', 'x', '_val'])
 //  -> [{'val': 0}]
```

• **pattern**: [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

<a id="verify" name="verify"></a>

<MemberCard>

##### ComputeEngine.verify()

```ts
verify(_query): boolean
```

Answer a query based on the current assumptions.

• **\_query**: [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

<a id="assume" name="assume"></a>

<MemberCard>

##### ComputeEngine.assume()

```ts
assume(predicate): AssumeResult
```

Add an assumption.

Note that the assumption is put into canonical form before being added.

Returns:
- `contradiction` if the new assumption is incompatible with previous
ones.
- `tautology` if the new assumption is redundant with previous ones.
- `ok` if the assumption was successfully added to the assumption set.

• **predicate**: [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

<a id="forget" name="forget"></a>

<MemberCard>

##### ComputeEngine.forget()

```ts
forget(symbol): void
```

Remove all assumptions about one or more symbols

• **symbol**: `string` \| `string`[]

</MemberCard>

<a id="numericmode-1" name="numericmode-1"></a>

### NumericMode

```ts
type NumericMode: "auto" | "machine" | "bignum" | "complex";
```

The numeric evaluation mode:

<div className="symbols-table">

| Mode | |
| :--- | :----- |
| `"auto"`| Use bignum or complex numbers. |
| `"machine"` |  **IEEE 754-2008**, 64-bit floating point numbers: 52-bit mantissa, about 15 digits of precision |
| `"bignum"` | Arbitrary precision floating point numbers, as provided by the "decimal.js" library | 
| `"complex"` | Complex number represented by two machine numbers, a real and an imaginary part, as provided by the "complex.js" library |

</div>

<a id="angularunit-1" name="angularunit-1"></a>

### AngularUnit

```ts
type AngularUnit: "rad" | "deg" | "grad" | "turn";
```

When a unitless value is passed to or returned from a trigonometric function,
the angular unit of the value.

- `rad`: radians, 2π radians is a full circle
- `deg`: degrees, 360 degrees is a full circle
- `grad`: gradians, 400 gradians is a full circle
- `turn`: turns, 1 turn is a full circle

<a id="hold-1" name="hold-1"></a>

### Hold

```ts
type Hold: 
  | "none"
  | "all"
  | "first"
  | "rest"
  | "last"
  | "most";
```

<a id="simplifyoptions" name="simplifyoptions"></a>

### SimplifyOptions

```ts
type SimplifyOptions: Object;
```

Options for `BoxedExpression.simplify()`

#### Type declaration

<a id="recursive" name="recursive"></a>

<MemberCard>

##### SimplifyOptions.recursive?

```ts
optional recursive: boolean;
```

</MemberCard>

<a id="rules-1" name="rules-1"></a>

<MemberCard>

##### SimplifyOptions.rules?

```ts
optional rules: BoxedRuleSet;
```

</MemberCard>

<a id="jsonserializationoptions-1" name="jsonserializationoptions-1"></a>

### JsonSerializationOptions

```ts
type JsonSerializationOptions: Object;
```

Options to control the serialization to MathJSON when using `BoxedExpression.json`.

#### Type declaration

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

<a id="shorthands" name="shorthands"></a>

<MemberCard>

##### JsonSerializationOptions.shorthands

```ts
shorthands: (
  | "all"
  | "number"
  | "symbol"
  | "function"
  | "dictionary"
  | "string")[];
```

A list of space separated keywords indicating which MathJSON expressions
can use a shorthand.

**Default**: `["all"]`

</MemberCard>

<a id="metadata-1" name="metadata-1"></a>

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

<a id="repeatingdecimals" name="repeatingdecimals"></a>

<MemberCard>

##### JsonSerializationOptions.repeatingDecimals

```ts
repeatingDecimals: boolean;
```

If true, repeating decimals are detected and serialized accordingly
For example:
- `1.3333333333333333` \( \to \) `1.(3)`
- `0.142857142857142857142857142857142857142857142857142` \( \to \) `0.(1428571)`

**Default**: `true`

</MemberCard>

<a id="precision-2" name="precision-2"></a>

<MemberCard>

##### JsonSerializationOptions.precision

```ts
precision: "auto" | "max" | number;
```

Number literals are serialized with this precision.
If `"auto"`, the same precision as the compute engine calculations is used
If `"max"`, all available digits are serialized

**Default**: `"auto"`

</MemberCard>

<a id="scope-2" name="scope-2"></a>

### Scope

```ts
type Scope: Object;
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

#### Type declaration

<a id="timelimit-1" name="timelimit-1"></a>

<MemberCard>

##### Scope.timeLimit

`Experimental`

```ts
timeLimit: number;
```

Signal `timeout` when the execution time for this scope is exceeded.

Time in seconds, default 2s.

</MemberCard>

<a id="memorylimit" name="memorylimit"></a>

<MemberCard>

##### Scope.memoryLimit

`Experimental`

```ts
memoryLimit: number;
```

Signal `out-of-memory` when the memory usage for this scope is exceeded.

Memory is in Megabytes, default: 1Mb.

</MemberCard>

<a id="recursionlimit-1" name="recursionlimit-1"></a>

<MemberCard>

##### Scope.recursionLimit

`Experimental`

```ts
recursionLimit: number;
```

Signal `recursion-depth-exceeded` when the recursion depth for this
scope is exceeded.

</MemberCard>

<a id="iterationlimit-2" name="iterationlimit-2"></a>

<MemberCard>

##### Scope.iterationLimit

`Experimental`

```ts
iterationLimit: number;
```

Signal `iteration-limit-exceeded` when the iteration limit
in a loop is exceeded. Default: no limits.

</MemberCard>

<a id="runtimescope" name="runtimescope"></a>

### RuntimeScope

```ts
type RuntimeScope: Scope & Object;
```

#### Type declaration

<MemberCard>

##### RuntimeScope.parentScope?

```ts
optional parentScope: RuntimeScope;
```

</MemberCard>

<MemberCard>

##### RuntimeScope.ids?

```ts
optional ids: RuntimeIdentifierDefinitions;
```

</MemberCard>

<MemberCard>

##### RuntimeScope.assumptions

```ts
assumptions: undefined | ExpressionMapInterface<boolean>;
```

</MemberCard>

<a id="assignvalue" name="assignvalue"></a>

### AssignValue

```ts
type AssignValue: 
  | boolean
  | number
  | string
  | Decimal
  | Complex
  | LatexString
  | SemiBoxedExpression
  | (ce, args) => BoxedExpression
  | undefined;
```

<a id="arrayvalue" name="arrayvalue"></a>

### ArrayValue

```ts
type ArrayValue: 
  | boolean
  | number
  | string
  | Decimal
  | Complex
  | BoxedExpression
  | undefined;
```

## Boxed Expression

<a id="rational" name="rational"></a>

### Rational

```ts
type Rational: [number, number] | [bigint, bigint];
```

<a id="metadata" name="metadata"></a>

### Metadata

```ts
type Metadata: Object;
```

Metadata that can be associated with a `BoxedExpression`

#### Type declaration

<a id="latex-2" name="latex-2"></a>

<MemberCard>

##### Metadata.latex?

```ts
optional latex: string;
```

</MemberCard>

<a id="wikidata-2" name="wikidata-2"></a>

<MemberCard>

##### Metadata.wikidata?

```ts
optional wikidata: string;
```

</MemberCard>

<a id="evaluateoptions" name="evaluateoptions"></a>

### EvaluateOptions

```ts
type EvaluateOptions: Object;
```

Options for `BoxedExpression.evaluate()`

#### Type declaration

<a id="numericmode-2" name="numericmode-2"></a>

<MemberCard>

##### EvaluateOptions.numericMode?

```ts
optional numericMode: boolean;
```

</MemberCard>

<a id="noptions" name="noptions"></a>

### NOptions

```ts
type NOptions: Object;
```

Options for `BoxedExpression.N()`

<a id="replaceoptions" name="replaceoptions"></a>

### ReplaceOptions

```ts
type ReplaceOptions: Object;
```

#### Type declaration

<a id="recursive-1" name="recursive-1"></a>

<MemberCard>

##### ReplaceOptions.recursive?

```ts
optional recursive: boolean;
```

If `true`, apply replacement rules to all sub-expressions.
If `false`, only consider the top-level expression.

**Default**: `false`

</MemberCard>

<a id="once" name="once"></a>

<MemberCard>

##### ReplaceOptions.once?

```ts
optional once: boolean;
```

If `true`, stop after the first rule that matches.

If `false`, apply all the remaining rules even after the first match.

**Default**: `false`

</MemberCard>

<a id="iterationlimit-1" name="iterationlimit-1"></a>

<MemberCard>

##### ReplaceOptions.iterationLimit?

```ts
optional iterationLimit: number;
```

If `iterationLimit` > 1, the rules will be repeatedly applied
until no rules apply, up to `maxIterations` times.

Note that if `once` is true, `maxIterations` has no effect.

**Default**: `1`

</MemberCard>

<a id="substitutiont" name="substitutiont"></a>

### Substitution\<T\>

```ts
type Substitution<T>: Object;
```

A substitution describes the values of the wildcards in a pattern so that
the pattern is equal to a target expression.

A substitution can also be considered a more constrained version of a
rule whose `lhs` is always a symbol.

#### Type parameters

• **T** = [`SemiBoxedExpression`](#semiboxedexpression)

#### Index signature

 \[`symbol`: `string`\]: `T`

<a id="boxedsubstitution" name="boxedsubstitution"></a>

### BoxedSubstitution

```ts
type BoxedSubstitution: Substitution<BoxedExpression>;
```

<a id="domaincompatibility" name="domaincompatibility"></a>

### DomainCompatibility

```ts
type DomainCompatibility: "covariant" | "contravariant" | "bivariant" | "invariant";
```

Use `contravariant` for the arguments of a function.
Use `covariant` for the result of a function.
Use `bivariant` to check the domain matches exactly.

<a id="domainconstructor" name="domainconstructor"></a>

### DomainConstructor

```ts
type DomainConstructor: 
  | "FunctionOf"
  | "ListOf"
  | "DictionaryOf"
  | "TupleOf"
  | "Intersection"
  | "Union"
  | "OptArg"
  | "VarArg"
  | "Covariant"
  | "Contravariant"
  | "Bivariant"
  | "Invariant";
```

A domain constructor is the head of a domain expression.

<a id="domainliteral" name="domainliteral"></a>

### DomainLiteral

```ts
type DomainLiteral: 
  | "Anything"
  | "Values"
  | "Domains"
  | "Void"
  | "NothingDomain"
  | "Booleans"
  | "Strings"
  | "Symbols"
  | "Collections"
  | "Lists"
  | "Dictionaries"
  | "Sequences"
  | "Tuples"
  | "Sets"
  | "Functions"
  | "Predicates"
  | "LogicOperators"
  | "RelationalOperators"
  | "NumericFunctions"
  | "RealFunctions"
  | "Numbers"
  | "ComplexNumbers"
  | "ExtendedRealNumbers"
  | "ImaginaryNumbers"
  | "Integers"
  | "Rationals"
  | "PositiveNumbers"
  | "PositiveIntegers"
  | "NegativeNumbers"
  | "NegativeIntegers"
  | "NonNegativeNumbers"
  | "NonNegativeIntegers"
  | "NonPositiveNumbers"
  | "NonPositiveIntegers"
  | "ExtendedComplexNumbers"
  | "TranscendentalNumbers"
  | "AlgebraicNumbers"
  | "RationalNumbers"
  | "RealNumbers";
```

<a id="domainexpressiont" name="domainexpressiont"></a>

### DomainExpression\<T\>

```ts
type DomainExpression<T>: 
  | DomainLiteral
  | ["Union", ...DomainExpression<T>[]]
  | ["Intersection", ...DomainExpression<T>[]]
  | ["ListOf", DomainExpression<T>]
  | ["DictionaryOf", DomainExpression<T>]
  | ["TupleOf", ...DomainExpression<T>[]]
  | ["OptArg", ...DomainExpression<T>[]]
  | ["VarArg", DomainExpression<T>]
  | ["Covariant", DomainExpression<T>]
  | ["Contravariant", DomainExpression<T>]
  | ["Bivariant", DomainExpression<T>]
  | ["Invariant", DomainExpression<T>]
  | ["FunctionOf", ...DomainExpression<T>[]];
```

#### Type parameters

• **T** = [`SemiBoxedExpression`](#semiboxedexpression)

<a id="boxeddomain" name="boxeddomain"></a>

### BoxedDomain

#### Extends

- [`BoxedExpression`](#boxedexpression)

<a id="isnumeric" name="isnumeric"></a>

<MemberCard>

##### BoxedDomain.isNumeric

```ts
readonly isNumeric: boolean;
```

</MemberCard>

<a id="isfunction" name="isfunction"></a>

<MemberCard>

##### BoxedDomain.isFunction

```ts
readonly isFunction: boolean;
```

</MemberCard>

<a id="canonical-1" name="canonical-1"></a>

<MemberCard>

##### BoxedDomain.canonical

```ts
get canonical(): BoxedDomain
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

[`BoxedDomain`](#boxeddomain)

</MemberCard>

<a id="json" name="json"></a>

<MemberCard>

##### BoxedDomain.json

```ts
get json(): Expression
```

MathJSON representation of this expression.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

[`Expression`](#expression)

</MemberCard>

<a id="base" name="base"></a>

<MemberCard>

##### BoxedDomain.base

```ts
get base(): DomainLiteral
```

[`DomainLiteral`](#domainliteral)

</MemberCard>

<a id="ctor" name="ctor"></a>

<MemberCard>

##### BoxedDomain.ctor

```ts
get ctor(): DomainConstructor
```

[`DomainConstructor`](#domainconstructor)

</MemberCard>

<a id="params" name="params"></a>

<MemberCard>

##### BoxedDomain.params

```ts
get params(): DomainExpression<SemiBoxedExpression>[]
```

[`DomainExpression`](#domainexpressiont)\<[`SemiBoxedExpression`](#semiboxedexpression)\>[]

</MemberCard>

<a id="iscompatible" name="iscompatible"></a>

<MemberCard>

##### BoxedDomain.isCompatible()

```ts
isCompatible(dom, kind?): boolean
```

True if a valid domain, and compatible with `dom`
`kind` is '"covariant"' by default, i.e. `this <: dom`

• **dom**: [`BoxedDomain`](#boxeddomain) \| [`DomainLiteral`](#domainliteral)

• **kind?**: [`DomainCompatibility`](#domaincompatibility)

</MemberCard>

<a id="canonicalform" name="canonicalform"></a>

### CanonicalForm

```ts
type CanonicalForm: 
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

To get a boxed expression, use `ce.box()` or `ce.parse()`.

#### Extended by

- [`BoxedDomain`](#boxeddomain)

#### Dictionary Expression

<a id="keys" name="keys"></a>

<MemberCard>

##### BoxedExpression.keys

```ts
readonly keys: IterableIterator<string>;
```

The keys of the dictionary.

If this expression not a dictionary, return `null`

</MemberCard>

<a id="keyscount" name="keyscount"></a>

<MemberCard>

##### BoxedExpression.keysCount

```ts
readonly keysCount: number;
```

</MemberCard>

<a id="getkey" name="getkey"></a>

<MemberCard>

##### BoxedExpression.getKey()

```ts
getKey(key): BoxedExpression
```

If this expression is a dictionary, return the value of the `key` entry.

• **key**: `string`

</MemberCard>

<a id="haskey" name="haskey"></a>

<MemberCard>

##### BoxedExpression.hasKey()

```ts
hasKey(key): boolean
```

If this expression is a dictionary, return true if the
 dictionary has a `key` entry.

• **key**: `string`

</MemberCard>

#### Domain Properties

<a id="isnumber" name="isnumber"></a>

<MemberCard>

##### BoxedExpression.isNumber

```ts
readonly isNumber: boolean;
```

`true` if the value of this expression is a number.

`isExtendedComplex || isNaN` = `isReal || isImaginary || isInfinity || isNaN`

Note that in a fateful twist of cosmic irony, `NaN` ("Not a Number")
**is** a number.

</MemberCard>

<a id="isinteger" name="isinteger"></a>

<MemberCard>

##### BoxedExpression.isInteger

```ts
readonly isInteger: boolean;
```

The value of this expression is an element of the set ℤ: ...,-2, -1, 0, 1, 2...

</MemberCard>

<a id="isrational" name="isrational"></a>

<MemberCard>

##### BoxedExpression.isRational

```ts
readonly isRational: boolean;
```

The value of this expression is an element of the set ℚ, p/q with p ∈ ℕ, q ∈ ℤ ⃰  q >= 1

Note that every integer is also a rational.

</MemberCard>

<a id="isalgebraic" name="isalgebraic"></a>

<MemberCard>

##### BoxedExpression.isAlgebraic

```ts
readonly isAlgebraic: boolean;
```

The value of this expression is a number that is the root of a non-zero
univariate polynomial with rational coefficients.

All integers and rational numbers are algebraic.

Transcendental numbers, such as \\( \pi \\) or \\( e \\) are not algebraic.

</MemberCard>

<a id="isreal" name="isreal"></a>

<MemberCard>

##### BoxedExpression.isReal

```ts
readonly isReal: boolean;
```

The value of this expression is real number: finite and not imaginary.

`isFinite && !isImaginary`

</MemberCard>

<a id="isextendedreal" name="isextendedreal"></a>

<MemberCard>

##### BoxedExpression.isExtendedReal

```ts
readonly isExtendedReal: boolean;
```

Real or ±Infinity

`isReal || isInfinity`

</MemberCard>

<a id="iscomplex-1" name="iscomplex-1"></a>

<MemberCard>

##### BoxedExpression.isComplex

```ts
readonly isComplex: boolean;
```

The value of this expression is a number, but not `NaN` or any Infinity

`isReal || isImaginary`

</MemberCard>

<a id="isextendedcomplex" name="isextendedcomplex"></a>

<MemberCard>

##### BoxedExpression.isExtendedComplex

```ts
readonly isExtendedComplex: boolean;
```

`isReal || isImaginary || isInfinity`

</MemberCard>

<a id="isimaginary" name="isimaginary"></a>

<MemberCard>

##### BoxedExpression.isImaginary

```ts
readonly isImaginary: boolean;
```

The value of this expression is a number with a imaginary part

</MemberCard>

#### Function Expression

<a id="ops" name="ops"></a>

<MemberCard>

##### BoxedExpression.ops

```ts
readonly ops: readonly BoxedExpression[];
```

The list of arguments of the function, its "tail".

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

First operand, i.e.`this.ops[0]`

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

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

#### Numeric Expression

<a id="isnan" name="isnan"></a>

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

<a id="iszero" name="iszero"></a>

<MemberCard>

##### BoxedExpression.isZero

```ts
readonly isZero: boolean;
```

The numeric value of this expression is 0.

</MemberCard>

<a id="isnotzero" name="isnotzero"></a>

<MemberCard>

##### BoxedExpression.isNotZero

```ts
readonly isNotZero: boolean;
```

The numeric value of this expression is not 0.

</MemberCard>

<a id="isone" name="isone"></a>

<MemberCard>

##### BoxedExpression.isOne

```ts
readonly isOne: boolean;
```

The numeric value of this expression is not 1.

</MemberCard>

<a id="isnegativeone" name="isnegativeone"></a>

<MemberCard>

##### BoxedExpression.isNegativeOne

```ts
readonly isNegativeOne: boolean;
```

The numeric value of this expression is not -1.

</MemberCard>

<a id="isinfinity" name="isinfinity"></a>

<MemberCard>

##### BoxedExpression.isInfinity

```ts
readonly isInfinity: boolean;
```

The numeric value of this expression is ±Infinity or Complex Infinity

</MemberCard>

<a id="isfinite" name="isfinite"></a>

<MemberCard>

##### BoxedExpression.isFinite

```ts
readonly isFinite: boolean;
```

This expression is a number, but not ±Infinity and not `NaN`

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

<a id="isprime" name="isprime"></a>

<MemberCard>

##### BoxedExpression.isPrime

```ts
readonly isPrime: boolean;
```

</MemberCard>

<a id="iscomposite" name="iscomposite"></a>

<MemberCard>

##### BoxedExpression.isComposite

```ts
readonly isComposite: boolean;
```

</MemberCard>

<a id="numericvalue" name="numericvalue"></a>

<MemberCard>

##### BoxedExpression.numericValue

```ts
readonly numericValue: number | Complex | Decimal | Rational;
```

Return the value of this expression, if a number literal.

Note it is possible for `numericValue` to be `null`, and for `isNotZero`
to be true. For example, when a symbol has been defined with an assumption.

Conversely, `isNumber` may be true even if `numericValue` is `null`,
example the symbol `Pi` return true for `isNumber` but `numericValue` is
`null`. Its value can be accessed with `.value.numericValue`

</MemberCard>

<a id="sgn" name="sgn"></a>

<MemberCard>

##### BoxedExpression.sgn

```ts
readonly sgn: 0 | 1 | -1;
```

Return the following, depending on the value of this expression:

* `-1` if it is `< 0
* `0` if it is = 0
* `+1` if it is >` 0
* `undefined` this value may be positive, negative or zero. We don't know
   right now (a symbol with an Integer domain, but no currently assigned
   value, for example)
* `null` this value will never be positive, negative or zero (`NaN`,
    a string or a complex number for example)

Note that complex numbers have no natural ordering,
so if the value is a complex number, `sgn` is either 0, or `null`

If a symbol, this does take assumptions into account, that is `this.sgn`
will return `1` if `isPositive` is `true`, even if this expression has
no value

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

<a id="iscanonical" name="iscanonical"></a>

<MemberCard>

##### BoxedExpression.isCanonical

```ts
get isCanonical(): boolean
```

If `true`, this expression is in a canonical form.

`boolean`

</MemberCard>

<a id="json-1" name="json-1"></a>

<MemberCard>

##### BoxedExpression.json

```ts
readonly json: Expression;
```

MathJSON representation of this expression.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="scope" name="scope"></a>

<MemberCard>

##### BoxedExpression.scope

```ts
readonly scope: RuntimeScope;
```

The scope in which this expression has been defined.
Is null when the expression is not canonical.

</MemberCard>

<a id="latex-1" name="latex-1"></a>

<MemberCard>

##### BoxedExpression.latex

```ts
get latex(): string
```

LaTeX representation of this expression.

The serialization can be customized with `ComputeEngine.latexOptions`

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

`string`

</MemberCard>

<a id="isnothing" name="isnothing"></a>

<MemberCard>

##### BoxedExpression.isNothing

```ts
readonly isNothing: boolean;
```

If this is the `Nothing` symbol, return `true`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="getsubexpressions" name="getsubexpressions"></a>

<MemberCard>

##### BoxedExpression.getSubexpressions()

```ts
getSubexpressions(head): readonly BoxedExpression[]
```

All the subexpressions matching the head

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

• **head**: `string`

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

All the `["Error"]` subexpressions

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<a id="head" name="head"></a>

<MemberCard>

##### BoxedExpression.head

```ts
readonly head: string | BoxedExpression;
```

All boxed expressions have a head.

If not a function this can be `Symbol`, `String`, `Number` or `Dictionary`.

If the head expression can be represented as a string, it is returned
as a string.

:::info[Note]
Applicable to canonical and non-canonical expressions. The head
of a non-canonical expression may be different than the head of its
canonical counterpart. For example the canonical counterpart of `["Divide", 5, 7]` is `["Rational", 5, 5]`.
:::

</MemberCard>

<a id="isexact" name="isexact"></a>

<MemberCard>

##### BoxedExpression.isExact

```ts
readonly isExact: boolean;
```

An exact value is not further transformed when evaluated. To get an
approximate evaluation of an exact value, use `.N()`.

Exact numbers are:
- rationals (including integers)
- complex numbers with integer real and imaginary parts (Gaussian integers)
- square root of rationals

Non-exact values includes:
- numbers with a fractional part
- complex numbers with a real or imaginary fractional part

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

True if the expression is a constant, that is a symbol with an immutable value

</MemberCard>

<a id="canonical-2" name="canonical-2"></a>

<MemberCard>

##### BoxedExpression.canonical

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

<a id="subs" name="subs"></a>

<MemberCard>

##### BoxedExpression.subs()

```ts
subs(sub, options?): BoxedExpression
```

Replace all the symbols in the expression as indicated.

Note the same effect can be achieved with `this.replace()`, but
using `this.subs()` is more efficient, and simpler.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

• **sub**: [`Substitution`](#substitutiont)\<[`SemiBoxedExpression`](#semiboxedexpression)\>

• **options?**

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="map" name="map"></a>

<MemberCard>

##### BoxedExpression.map()

```ts
map(fn, options?): BoxedExpression
```

Recursively replace all the terms in the expression as indicated.

To remove a subexpression, return an empty Sequence expression.

The canonical option is applied to each function subexpression after
the substitution is applied.

• **fn**

• **options?**

• **options\.canonical?**: [`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<a id="replace" name="replace"></a>

<MemberCard>

##### BoxedExpression.replace()

```ts
replace(rules, options?): BoxedExpression
```

Transform the expression by applying the rules:

If the expression matches the `match` pattern, replace it with
the `replace` pattern.

If no rules apply, return `null`.

See also `subs` for a simple substitution.

:::info[Note]
Applicable to canonical and non-canonical expressions. If the
expression is non-canonical, the result is also non-canonical.
:::

• **rules**: [`BoxedRuleSet`](#boxedruleset) \| [`Rule`](#rule) \| [`Rule`](#rule)[]

• **options?**: [`ReplaceOptions`](#replaceoptions)

</MemberCard>

<a id="has" name="has"></a>

<MemberCard>

##### BoxedExpression.has()

```ts
has(v): boolean
```

True if the expression includes a symbol `v` or a function head `v`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

• **v**: `string` \| `string`[]

</MemberCard>

<a id="match-1" name="match-1"></a>

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

• **pattern**: [`SemiBoxedExpression`](#semiboxedexpression) \| [`number`, `number`]

• **options?**: [`PatternMatchOptions`](#patternmatchoptions)

</MemberCard>

<a id="shape" name="shape"></a>

<MemberCard>

##### BoxedExpression.shape

```ts
readonly shape: number[];
```

The shape describes the axis of the expression.
When the expression is a scalar (number), the shape is `[]`.
When the expression is a vector, the shape is `[n]`.
When the expression is a matrix, the shape is `[n, m]`.

</MemberCard>

<a id="rank" name="rank"></a>

<MemberCard>

##### BoxedExpression.rank

```ts
readonly rank: number;
```

Return 0 for a scalar, 1 for a vector, 2 for a matrix, > 2 for a multidimensional matrix. It's the length of `expr.shape`

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
 function head.

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

For symbols and functions, a possible definition associated with the
 expression. `baseDefinition` is the base class of symbol and function
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

For functions, a possible definition associated with the expression.

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

For symbols, a possible definition associated with the expression.

Return `undefined` if not a symbol

</MemberCard>

<a id="simplify" name="simplify"></a>

<MemberCard>

##### BoxedExpression.simplify()

```ts
simplify(options?): BoxedExpression
```

Return a simpler form of the canonical form of this expression.

A series of rewriting rules are applied repeatedly, until no more rules
apply.

If a custom `simplify` handler is associated with this function
definition, it is invoked.

The values assigned to symbols and the assumptions about symbols may be
used, for example `arg.isInteger` or `arg.isPositive`.

No calculations involving decimal numbers (numbers that are not
integers) are performed but exact calculations may be performed,
for example:

\\( \sin(\frac\{\pi\}\{4\}) \longrightarrow \frac\{\sqrt\{2}}\{2\} \\).

The result is in canonical form.

• **options?**: [`SimplifyOptions`](#simplifyoptions)

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

Only exact calculations are performed, no approximate calculations on
decimal numbers (non-integer numbers). Constants, rational numbers and
square root of rational numbers are preserved.

To perform approximate calculations, use `expr.N()` instead.

The result of `expr.evaluate()` may be the same as `expr.simplify()`.

The result is in canonical form.

• **options?**: [`EvaluateOptions`](#evaluateoptions)

</MemberCard>

<a id="n" name="n"></a>

<MemberCard>

##### BoxedExpression.N()

```ts
N(options?): BoxedExpression
```

Return a numeric approximation of the canonical form of this expression.

Any necessary calculations, including on decimal numbers (non-integers),
are performed.

The calculations are performed according to the `numericMode` and
`precision` properties of the `ComputeEngine`.

To only perform exact calculations, use `this.evaluate()` instead.

If the function is not numeric, the result of `this.N()` is the same as
`this.evaluate()`.

The result is in canonical form.

• **options?**: [`NOptions`](#noptions)

</MemberCard>

<a id="compile" name="compile"></a>

<MemberCard>

##### BoxedExpression.compile()

```ts
compile(to?, options?): (args) => any
```

• **to?**: `"javascript"`

• **options?**

• **options\.optimize?**: (`"simplify"` \| `"evaluate"`)[]

</MemberCard>

<a id="solve" name="solve"></a>

<MemberCard>

##### BoxedExpression.solve()

```ts
solve(vars): readonly BoxedExpression[]
```

• **vars**: `string` \| `Iterable`\<`string`\> \| [`BoxedExpression`](#boxedexpression) \| `Iterable`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="value" name="value"></a>

<MemberCard>

##### BoxedExpression.value

```ts
get value(): string | number | boolean | number[]
```

```ts
set value(value): void
```

Return a JavaScript primitive representing the value of this expression.

Equivalent to `expr.N().valueOf()`.

Only the value of variables can be changed (symbols that are not
constants).

Throws a runtime error if a constant.

:::info[Note]
If non-canonical, does nothing
:::

`string` \| `number` \| `boolean` \| `number`[]

• **value**: 
  \| `string`
  \| `number`
  \| `boolean`
  \| `number`[]
  \| `Complex`
  \| `Decimal`
  \| [`BoxedExpression`](#boxedexpression)
  \| `Object`
  \| `Object`

</MemberCard>

<a id="domain-1" name="domain-1"></a>

<MemberCard>

##### BoxedExpression.domain

```ts
get domain(): BoxedDomain
```

```ts
set domain(domain): void
```

The domain of the value of this expression.

If a function expression, the domain  of the value of the function
(the codomain of the function).

If a symbol the domain of the value of the symbol.

Use `expr.head` to determine if an expression is a symbol or function
expression.

:::info[Note]
If non-canonical or not valid, return `undefined`.
:::

Modify the domain of a symbol.

:::info[Note]
If non-canonical does nothing
:::

[`BoxedDomain`](#boxeddomain)

• **domain**: [`BoxedDomain`](#boxeddomain) \| [`DomainExpression`](#domainexpressiont)\<[`SemiBoxedExpression`](#semiboxedexpression)\>

</MemberCard>

#### Primitive Methods

<a id="valueof" name="valueof"></a>

<MemberCard>

##### BoxedExpression.valueOf()

```ts
valueOf(): string | number | boolean | any[]
```

From `Object.valueOf()`, return a primitive value for the expression.

If the expression is a machine number, or bignum or rational that can be
converted to a machine number, return a JavaScript `number`.

If the expression is a symbol, return the name of the symbol as a `string`.

Otherwise return a JavaScript primitive representation of the expression.

</MemberCard>

<a id="tostring" name="tostring"></a>

<MemberCard>

##### BoxedExpression.toString()

```ts
toString(): string
```

From `Object.toString()`, return a string representation of the
 expression. This string is suitable to be output to the console
for debugging, for example. To get a LaTeX representation of the
expression, use `expr.latex`.

Used when coercing a `BoxedExpression` to a `String`.

</MemberCard>

<a id="print" name="print"></a>

<MemberCard>

##### BoxedExpression.print()

```ts
print(): void
```

Output to the console a string representation of the expression.

</MemberCard>

<a id="[toprimitive]" name="[toprimitive]"></a>

<MemberCard>

##### BoxedExpression.`[toPrimitive]`()

```ts
toPrimitive: string | number
```

Similar to`expr.valueOf()` but includes a hint.

• **hint**: `"string"` \| `"number"` \| `"default"`

</MemberCard>

<a id="tojson" name="tojson"></a>

<MemberCard>

##### BoxedExpression.toJSON()

```ts
toJSON(): Expression
```

Used by `JSON.stringify()` to serialize this object to JSON.

Method version of `expr.json`.

</MemberCard>

<a id="is" name="is"></a>

<MemberCard>

##### BoxedExpression.is()

```ts
is(rhs): boolean
```

From `Object.is()`. Equivalent to `BoxedExpression.isSame()`

• **rhs**: `unknown`

</MemberCard>

#### Relational Operator

<a id="issame" name="issame"></a>

<MemberCard>

##### BoxedExpression.isSame()

```ts
isSame(rhs): boolean
```

Structural/symbolic equality (weak equality).

`ce.parse('1+x').isSame(ce.parse('x+1'))` is `false`

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

• **rhs**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="isless" name="isless"></a>

<MemberCard>

##### BoxedExpression.isLess()

```ts
isLess(rhs): boolean
```

If the expressions cannot be compared, return `undefined`

The numeric value of both expressions are compared.

• **rhs**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="islessequal" name="islessequal"></a>

<MemberCard>

##### BoxedExpression.isLessEqual()

```ts
isLessEqual(rhs): boolean
```

The numeric value of both expressions are compared.

• **rhs**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="isgreater" name="isgreater"></a>

<MemberCard>

##### BoxedExpression.isGreater()

```ts
isGreater(rhs): boolean
```

The numeric value of both expressions are compared.

• **rhs**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="isgreaterequal" name="isgreaterequal"></a>

<MemberCard>

##### BoxedExpression.isGreaterEqual()

```ts
isGreaterEqual(rhs): boolean
```

The numeric value of both expressions are compared.

• **rhs**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="isequal" name="isequal"></a>

<MemberCard>

##### BoxedExpression.isEqual()

```ts
isEqual(rhs): boolean
```

Mathematical equality (strong equality), that is the value
of this expression and of `rhs` are numerically equal.

The numeric value of both expressions are compared.

Numbers whose difference is less than `engine.tolerance` are
considered equal. This tolerance is set when the `engine.precision` is
changed to be such that the last two digits are ignored.

• **rhs**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

#### String Expression

<a id="string-1" name="string-1"></a>

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

<a id="symbol-1" name="symbol-1"></a>

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
LaTeX. For canonical expression, this may indicate argument domain
mismatch, or missing or unexpected arguments.
:::

</MemberCard>

<a id="semiboxedexpression" name="semiboxedexpression"></a>

### SemiBoxedExpression

```ts
type SemiBoxedExpression: 
  | number
  | string
  | Decimal
  | Complex
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  | MathJsonFunction
  | MathJsonDictionary
  | SemiBoxedExpression[]
  | BoxedExpression;
```

A semi boxed expression is a MathJSON expression which can include some
boxed terms.

This is convenient when creating new expressions from portions
of an existing `BoxedExpression` while avoiding unboxing and reboxing.

## Pattern Matching

<a id="patternmatchoptions" name="patternmatchoptions"></a>

### PatternMatchOptions

```ts
type PatternMatchOptions: Object;
```

Control how a pattern is matched to an expression.

- `substitution`: if present, assumes these values for the named wildcards, and ensure that subsequent occurence of the same wildcard have the same value.
- `recursive`: if true, match recursively, otherwise match only the top level.
- `numericTolerance`: if present, the tolerance for numeric comparison.
- `exact`: if true, only match expressions that are structurally identical. If false, match expressions that are structurally identical or equivalent. For example, when false, `["Add", '_a', 2]` matches `2`, with a value of `_a` of `0`. If true, the expression does not match.

#### Type declaration

<a id="substitution" name="substitution"></a>

<MemberCard>

##### PatternMatchOptions.substitution?

```ts
optional substitution: BoxedSubstitution;
```

</MemberCard>

<a id="recursive-2" name="recursive-2"></a>

<MemberCard>

##### PatternMatchOptions.recursive?

```ts
optional recursive: boolean;
```

</MemberCard>

<a id="numerictolerance" name="numerictolerance"></a>

<MemberCard>

##### PatternMatchOptions.numericTolerance?

```ts
optional numericTolerance: number;
```

</MemberCard>

<a id="exact" name="exact"></a>

<MemberCard>

##### PatternMatchOptions.exact?

```ts
optional exact: boolean;
```

</MemberCard>

<a id="pattern" name="pattern"></a>

### Pattern

```ts
type Pattern: BoxedExpression;
```

#### No Inherit Doc

## Rules

<a id="patternreplacefunction" name="patternreplacefunction"></a>

### PatternReplaceFunction

```ts
type PatternReplaceFunction: (expr, wildcards) => BoxedExpression;
```

• **expr**: [`BoxedExpression`](#boxedexpression)

• **wildcards**: [`BoxedSubstitution`](#boxedsubstitution)

<a id="patternconditionfunction" name="patternconditionfunction"></a>

### PatternConditionFunction

```ts
type PatternConditionFunction: (wildcards, ce) => boolean;
```

• **wildcards**: [`BoxedSubstitution`](#boxedsubstitution)

• **ce**: `IComputeEngine`

<a id="rule" name="rule"></a>

### Rule

```ts
type Rule: Object;
```

A rule describes how to modify an expressions that matches a pattern `match`
into a new expression `replace`.

`x-1` \( \to \) `1-x`
`(x+1)(x-1)` \( \to \) `x^2-1

The `match` pattern can be expressed as a LaTeX string or a
MathJSON expression.

Anonymous wildcards (`_`) will match any
expression. Named wildcards (`_x`, `_a`, etc...) will match any expression
and bind the expression to the wildcard name.

In addition the sequence wildcard (`__1`, `__a`, etc...) will match
a sequence of one or more expressions, and bind the sequence to the
wildcard name.

#### Type declaration

<a id="match-2" name="match-2"></a>

<MemberCard>

##### Rule.match

```ts
match: LatexString | SemiBoxedExpression | Pattern;
```

</MemberCard>

<a id="replace-1" name="replace-1"></a>

<MemberCard>

##### Rule.replace

```ts
replace: LatexString | SemiBoxedExpression | PatternReplaceFunction;
```

</MemberCard>

<a id="condition-1" name="condition-1"></a>

<MemberCard>

##### Rule.condition?

```ts
optional condition: LatexString | PatternConditionFunction;
```

</MemberCard>

<a id="priority" name="priority"></a>

<MemberCard>

##### Rule.priority?

```ts
optional priority: number;
```

</MemberCard>

<a id="id" name="id"></a>

<MemberCard>

##### Rule.id?

```ts
optional id: string;
```

</MemberCard>

<a id="boxedrule" name="boxedrule"></a>

### BoxedRule

```ts
type BoxedRule: Object;
```

#### Type declaration

<a id="match-3" name="match-3"></a>

<MemberCard>

##### BoxedRule.match

```ts
match: Pattern;
```

</MemberCard>

<a id="replace-2" name="replace-2"></a>

<MemberCard>

##### BoxedRule.replace

```ts
replace: BoxedExpression | PatternReplaceFunction;
```

</MemberCard>

<a id="condition-2" name="condition-2"></a>

<MemberCard>

##### BoxedRule.condition

```ts
condition: undefined | PatternConditionFunction;
```

</MemberCard>

<a id="priority-1" name="priority-1"></a>

<MemberCard>

##### BoxedRule.priority

```ts
priority: number;
```

</MemberCard>

<a id="id-1" name="id-1"></a>

<MemberCard>

##### BoxedRule.id?

```ts
optional id: string;
```

</MemberCard>

<a id="boxedruleset" name="boxedruleset"></a>

### BoxedRuleSet

```ts
type BoxedRuleSet: ReadonlySet<BoxedRule>;
```

## Assumptions

<a id="expressionmapinterfaceu" name="expressionmapinterfaceu"></a>

### ExpressionMapInterface\<U\>

• **U**

<a id="has-1" name="has-1"></a>

<MemberCard>

##### ExpressionMapInterface.has()

```ts
has(expr): boolean
```

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="get" name="get"></a>

<MemberCard>

##### ExpressionMapInterface.get()

```ts
get(expr): U
```

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="set" name="set"></a>

<MemberCard>

##### ExpressionMapInterface.set()

```ts
set(expr, value): void
```

• **expr**: [`BoxedExpression`](#boxedexpression)

• **value**: `U`

</MemberCard>

<a id="delete" name="delete"></a>

<MemberCard>

##### ExpressionMapInterface.delete()

```ts
delete(expr): void
```

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="clear" name="clear"></a>

<MemberCard>

##### ExpressionMapInterface.clear()

```ts
clear(): void
```

</MemberCard>

<a id="[iterator]" name="[iterator]"></a>

<MemberCard>

##### ExpressionMapInterface.`[iterator]`()

```ts
iterator: IterableIterator<[BoxedExpression, U]>
```

</MemberCard>

<a id="entries" name="entries"></a>

<MemberCard>

##### ExpressionMapInterface.entries()

```ts
entries(): IterableIterator<[BoxedExpression, U]>
```

</MemberCard>

<a id="assumeresult" name="assumeresult"></a>

### AssumeResult

```ts
type AssumeResult: 
  | "internal-error"
  | "not-a-predicate"
  | "contradiction"
  | "tautology"
  | "ok";
```

## Compiling

<a id="compiledexpression" name="compiledexpression"></a>

### CompiledExpression

```ts
type CompiledExpression: Object;
```

#### Type declaration

<a id="evaluate-3" name="evaluate-3"></a>

<MemberCard>

##### CompiledExpression.evaluate?

```ts
optional evaluate: (scope) => number | BoxedExpression;
```

• **scope**

</MemberCard>

## Definitions

<a id="identifierdefinition" name="identifierdefinition"></a>

### IdentifierDefinition

```ts
type IdentifierDefinition: SymbolDefinition | FunctionDefinition | SemiBoxedExpression;
```

A table mapping identifiers to their definition.

Identifiers should be valid MathJSON identifiers. In addition, the
following rules are recommended:

- Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
- The first character should be a letter: `/^[a-zA-Z]/`
- Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`

If a semi boxed expression

<a id="identifierdefinitions" name="identifierdefinitions"></a>

### IdentifierDefinitions

```ts
type IdentifierDefinitions: Readonly<Object>;
```

#### Type declaration

<a id="runtimeidentifierdefinitions" name="runtimeidentifierdefinitions"></a>

### RuntimeIdentifierDefinitions

```ts
type RuntimeIdentifierDefinitions: Map<string, BoxedSymbolDefinition | BoxedFunctionDefinition>;
```

The entries have been validated and optimized for faster evaluation.

When a new scope is created with `pushScope()` or when creating a new
engine instance, new instances of this type are created as needed.

<a id="basedefinition-1" name="basedefinition-1"></a>

### BaseDefinition

```ts
type BaseDefinition: Object;
```

#### Type declaration

<a id="description-2" name="description-2"></a>

<MemberCard>

##### BaseDefinition.description?

```ts
optional description: string | string[];
```

A short (about 1 line) description. May contain Markdown.

</MemberCard>

<a id="url-2" name="url-2"></a>

<MemberCard>

##### BaseDefinition.url?

```ts
optional url: string;
```

A URL pointing to more information about this symbol or head.

</MemberCard>

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
scope: RuntimeScope;
```

The scope this definition belongs to.

This field is usually undefined, but its value is set by `getDefinition()`

</MemberCard>

<a id="reset" name="reset"></a>

<MemberCard>

##### BoxedBaseDefinition.reset()

```ts
reset(): any
```

When the environment changes, for example the numerical precision,
call `reset()` so that any cached values can be recalculated.

</MemberCard>

<a id="functiondefinitionflags" name="functiondefinitionflags"></a>

### FunctionDefinitionFlags

```ts
type FunctionDefinitionFlags: Object;
```

A function definition can have some flags to indicate specific
properties of the function.

#### Type declaration

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

<a id="associative" name="associative"></a>

<MemberCard>

##### FunctionDefinitionFlags.associative

```ts
associative: boolean;
```

If `true`, `["f", ["f", a], b]` simplifies to `["f", a, b]`

**Default**: `false`

</MemberCard>

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

<a id="idempotent" name="idempotent"></a>

<MemberCard>

##### FunctionDefinitionFlags.idempotent

```ts
idempotent: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `["f", x]`.

**Default**: `false`

</MemberCard>

<a id="involution" name="involution"></a>

<MemberCard>

##### FunctionDefinitionFlags.involution

```ts
involution: boolean;
```

If `true`, `["f", ["f", x]]` simplifies to `x`.

**Default**: `false`

</MemberCard>

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

<a id="inert" name="inert"></a>

<MemberCard>

##### FunctionDefinitionFlags.inert

```ts
inert: boolean;
```

An inert function evaluates directly to one of its argument, typically
the first one. They may be used to provide formating hints, but do
not affect simplification or evaluation.

**Default:** false

</MemberCard>

<a id="numeric" name="numeric"></a>

<MemberCard>

##### FunctionDefinitionFlags.numeric

```ts
numeric: boolean;
```

All the arguments of a numeric function are numeric,
and its value is numeric.

</MemberCard>

<a id="functionsignature" name="functionsignature"></a>

### FunctionSignature

```ts
type FunctionSignature: Object;
```

#### Type declaration

<a id="domain-3" name="domain-3"></a>

<MemberCard>

##### FunctionSignature.~~domain?~~

```ts
optional domain: DomainExpression;
```

The domain of this signature, a domain compatible with the `Functions`
domain).

###### Deprecated

Use params, optParams, restParam and result instead

</MemberCard>

<a id="params-1" name="params-1"></a>

<MemberCard>

##### FunctionSignature.params?

```ts
optional params: DomainExpression[];
```

</MemberCard>

<a id="optparams" name="optparams"></a>

<MemberCard>

##### FunctionSignature.optParams?

```ts
optional optParams: DomainExpression[];
```

</MemberCard>

<a id="restparam" name="restparam"></a>

<MemberCard>

##### FunctionSignature.restParam?

```ts
optional restParam: DomainExpression;
```

</MemberCard>

<a id="result" name="result"></a>

<MemberCard>

##### FunctionSignature.result?

```ts
optional result: DomainExpression | (ce, args) => BoxedDomain | null | undefined;
```

The domain of the result of the function. Either a domain
expression, or a function that returns a boxed domain.

</MemberCard>

<a id="canonical-3" name="canonical-3"></a>

<MemberCard>

##### FunctionSignature.canonical?

```ts
optional canonical: (ce, args) => BoxedExpression | null;
```

Return the canonical form of the expression with the arguments `args`.

The arguments (`args`) may not be in canonical form. If necessary, they
can be put in canonical form.

This handler should validate the domain and number of the arguments.

If a required argument is missing, it should be indicated with a
`["Error", "'missing"]` expression. If more arguments than expected
are present, this should be indicated with an
["Error", "'unexpected-argument'"]` error expression

If the domain of an argument is not compatible, it should be indicated
with an `incompatible-domain` error.

`["Sequence"]` expressions are not folded and need to be handled
 explicitly.

If the function is associative, idempotent or an involution,
this handler should account for it. Notably, if it is commutative, the
arguments should be sorted in canonical order.

The handler can make transformations based on the value of the arguments
that are exact and literal (i.e.
`arg.numericValue !== null && arg.isExact`).

Values of symbols should not be substituted, unless they have
a `holdUntil` attribute of `"never"`.

The handler should not consider the value or any assumptions about any
of the arguments that are symbols or functions (i.e. `arg.isZero`,
`arg.isInteger`, etc...) since those may change over time.

The result of the handler should be a canonical expression.

If the arguments do not match, they should be replaced with an appropriate
`["Error"]` expression. If the expression cannot be put in canonical form,
the handler should return `null`.

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="simplify-1" name="simplify-1"></a>

<MemberCard>

##### FunctionSignature.simplify?

```ts
optional simplify: (ce, args) => BoxedExpression | undefined;
```

Rewrite an expression into a simpler form.

The arguments are in canonical form and have been simplified.

The handler can use the values assigned to symbols and the assumptions
about symbols, for example with `arg.numericValue`, `arg.isInteger` or
`arg.isPositive`.

Even though a symbol may not have a value, there may be some information
about it reflected for example in `this.isZero` or `this.isPrime`.

The handler should not perform approximate numeric calculations, such
as calculations involving decimal numbers (non-integers). Making exact
calculations on integers or rationals is OK.

Do not reduce constants with a `holdUntil` attribute of `"N"`
or `"evaluate"`.

This handler should not have any side-effects: do not modify
the environment of the `ComputeEngine` instance, do not perform I/O,
do not do calculations that depend on random values.

If no simplification can be performed due to the values, domains or
assumptions about its arguments, for example, return `undefined`.

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="evaluate-1" name="evaluate-1"></a>

<MemberCard>

##### FunctionSignature.evaluate?

```ts
optional evaluate: SemiBoxedExpression | (ce, args) => BoxedExpression | undefined;
```

Evaluate a function expression.

The arguments have been evaluated, except the arguments to which a
`hold` applied.

It is not necessary to further simplify or evaluate the arguments.

If performing numerical calculations, if all the arguments are exact,
return an exact expression. If any of the arguments is not exact, that is
if it is a literal decimal (non-integer) number, return an approximation.
In this case, the value may be the same as `expr.N()`.

When doing an exact calculation:
- do not reduce rational numbers to decimal (floating point approximation)
- do not down convert bignums to machine numbers
- do not reduce square roots of rational numbers
- do not reduce constants with a `holdUntil` attribute of `"N"`

If the expression cannot be evaluated, due to the values, domains, or
assumptions about its arguments, for example, return `undefined` or
an `["Error"]` expression.

</MemberCard>

<a id="n-1" name="n-1"></a>

<MemberCard>

##### FunctionSignature.N?

```ts
optional N: (ce, args) => BoxedExpression | undefined;
```

Evaluate numerically a function expression.

The arguments `args` have been simplified and evaluated, numerically
if possible, except the arguments to which a `hold` apply.

The arguments may be a combination of numbers, symbolic
expressions and other expressions.

Perform as many calculations as possible, and return the result.

Return `undefined` if there isn't enough information to perform
the evaluation, for example one of the arguments is a symbol with
no value. If the handler returns `undefined`, symbolic evaluation of
the expression will be returned instead to the caller.

Return `NaN` if there is enough information to  perform the
evaluation, but a literal argument is out of range or
not of the expected type.

Use the value of `ce.numericMode` to determine how to perform
the numeric evaluation.

Note that regardless of the current value of `ce.numericMode`, the
arguments may be boxed numbers representing machine numbers, bignum
numbers, complex numbers, rationals or big rationals.

If the numeric mode does not allow complex numbers (the
`engine.numericMode` is not `"complex"` or `"auto"`) and the result of
the evaluation would be a complex number, return `NaN` instead.

If `ce.numericMode` is `"bignum"` or `"auto"` the evaluation should
be done using bignums.

Otherwise, `ce.numericMode` is `"machine", the evaluation should be
performed using machine numbers.

You may perform any necessary computations, including approximate
calculations on floating point numbers.

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="evaldimension" name="evaldimension"></a>

<MemberCard>

##### FunctionSignature.evalDimension?

`Experimental`

```ts
optional evalDimension: (ce, args) => BoxedExpression;
```

`Experimental`

Dimensional analysis

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="sgn-1" name="sgn-1"></a>

<MemberCard>

##### FunctionSignature.sgn?

```ts
optional sgn: (ce, args) => -1 | 0 | 1 | undefined;
```

Return the sign of the function expression.

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="compile-1" name="compile-1"></a>

<MemberCard>

##### FunctionSignature.compile?

```ts
optional compile: (expr) => CompiledExpression;
```

Return a compiled (optimized) expression.

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="boxedfunctionsignature" name="boxedfunctionsignature"></a>

### BoxedFunctionSignature

```ts
type BoxedFunctionSignature: Object;
```

#### Type declaration

<a id="inferredsignature" name="inferredsignature"></a>

<MemberCard>

##### BoxedFunctionSignature.inferredSignature

```ts
inferredSignature: boolean;
```

</MemberCard>

<a id="params-2" name="params-2"></a>

<MemberCard>

##### BoxedFunctionSignature.params

```ts
params: BoxedDomain[];
```

</MemberCard>

<a id="optparams-1" name="optparams-1"></a>

<MemberCard>

##### BoxedFunctionSignature.optParams

```ts
optParams: BoxedDomain[];
```

</MemberCard>

<a id="restparam-1" name="restparam-1"></a>

<MemberCard>

##### BoxedFunctionSignature.restParam?

```ts
optional restParam: BoxedDomain;
```

</MemberCard>

<a id="result-1" name="result-1"></a>

<MemberCard>

##### BoxedFunctionSignature.result

```ts
result: BoxedDomain | (ce, args) => BoxedDomain | null | undefined;
```

</MemberCard>

<a id="canonical-4" name="canonical-4"></a>

<MemberCard>

##### BoxedFunctionSignature.canonical?

```ts
optional canonical: (ce, args) => BoxedExpression | null;
```

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="simplify-2" name="simplify-2"></a>

<MemberCard>

##### BoxedFunctionSignature.simplify?

```ts
optional simplify: (ce, args) => BoxedExpression | undefined;
```

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="evaluate-2" name="evaluate-2"></a>

<MemberCard>

##### BoxedFunctionSignature.evaluate?

```ts
optional evaluate: (ce, args) => BoxedExpression | undefined;
```

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="n-2" name="n-2"></a>

<MemberCard>

##### BoxedFunctionSignature.N?

```ts
optional N: (ce, args) => BoxedExpression | undefined;
```

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="evaldimension-1" name="evaldimension-1"></a>

<MemberCard>

##### BoxedFunctionSignature.evalDimension?

```ts
optional evalDimension: (ce, args) => BoxedExpression;
```

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="sgn-2" name="sgn-2"></a>

<MemberCard>

##### BoxedFunctionSignature.sgn?

```ts
optional sgn: (ce, args) => -1 | 0 | 1 | undefined;
```

• **ce**: `IComputeEngine`

• **args**: `ReadonlyArray`\<[`BoxedExpression`](#boxedexpression)\>

</MemberCard>

<a id="compile-2" name="compile-2"></a>

<MemberCard>

##### BoxedFunctionSignature.compile?

```ts
optional compile: (expr) => CompiledExpression;
```

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="collectionhandlers" name="collectionhandlers"></a>

### CollectionHandlers

```ts
type CollectionHandlers: Object;
```

The handlers are the primitive operations that can be performed on
collections.

There are two types of collections:
- finite collections, such as lists, tuples, sets, matrices, etc...
 The `size()` handler of finite collections returns the number of elements
- infinite collections, such as sequences, ranges, etc...
 The `size()` handler of infinite collections returns `Infinity`
 Infinite collections are not indexable, they have no `at()` handler.

#### Type declaration

<a id="iterator" name="iterator"></a>

<MemberCard>

##### CollectionHandlers.iterator

```ts
iterator: (expr, start?, count?) => Iterator<BoxedExpression, undefined>;
```

Return an iterator
- start is optional and is a 1-based index.
- if start is not specified, start from index 1
- count is optional and is the number of elements to return
- if count is not specified or negative, return all the elements from start to the endna

If there is a `keys()` handler, there is no `iterator()` handler.

• **expr**: [`BoxedExpression`](#boxedexpression)

• **start?**: `number`

• **count?**: `number`

</MemberCard>

<a id="at" name="at"></a>

<MemberCard>

##### CollectionHandlers.at

```ts
at: (expr, index) => undefined | BoxedExpression;
```

Return the element at the specified index.
The first element is `at(1)`, the last element is `at(-1)`.
If the index is &lt;0, return the element at index `size() + index + 1`.
The index can also be a string for example for dictionaries.
If the index is invalid, return `undefined`.

• **expr**: [`BoxedExpression`](#boxedexpression)

• **index**: `number` \| `string`

</MemberCard>

<a id="size" name="size"></a>

<MemberCard>

##### CollectionHandlers.size

```ts
size: (expr) => number;
```

Return the number of elements in the collection.
An empty collection has a size of 0.

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="keys-1" name="keys-1"></a>

<MemberCard>

##### CollectionHandlers.keys

```ts
keys: (expr) => undefined | Iterator<string>;
```

If the collection is indexed by strings, return the valid values
for the index.

• **expr**: [`BoxedExpression`](#boxedexpression)

</MemberCard>

<a id="indexof" name="indexof"></a>

<MemberCard>

##### CollectionHandlers.indexOf

```ts
indexOf: (expr, target, from?) => number | string | undefined;
```

Return the index of the first element that matches the target expression.
The comparison is done using the `target.isEqual()` method.
If the expression is not found, return `undefined`.
If the expression is found, return the index, 1-based.
If the expression is found multiple times, return the index of the first
match.

From is the starting index for the search. If negative, start from the end
and search backwards.

• **expr**: [`BoxedExpression`](#boxedexpression)

• **target**: [`BoxedExpression`](#boxedexpression)

• **from?**: `number`

</MemberCard>

<a id="functiondefinition-1" name="functiondefinition-1"></a>

### FunctionDefinition

```ts
type FunctionDefinition: BaseDefinition & Partial<CollectionHandlers> & Partial<FunctionDefinitionFlags> & Object;
```

Definition record for a function.

#### Type declaration

<MemberCard>

##### FunctionDefinition.complexity?

```ts
optional complexity: number;
```

A number used to order arguments.

Argument with higher complexity are placed after arguments with lower
complexity when ordered canonically in commutative functions.

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

<MemberCard>

##### FunctionDefinition.hold?

```ts
optional hold: Hold;
```

- `"none"` Each of the arguments is evaluated (default)
- `"all"` None of the arguments are evaluated and they are passed as is
- `"first"` The first argument is not evaluated, the others are
- `"rest"` The first argument is evaluated, the others aren't
- `"last"`: The last argument is not evaluated, the others are
- `"most"`: All the arguments are evaluated, except the last one

**Default**: `"none"`

</MemberCard>

<MemberCard>

##### FunctionDefinition.signature

```ts
signature: FunctionSignature;
```

</MemberCard>

<a id="boxedfunctiondefinition" name="boxedfunctiondefinition"></a>

### BoxedFunctionDefinition

```ts
type BoxedFunctionDefinition: BoxedBaseDefinition & Partial<CollectionHandlers> & FunctionDefinitionFlags & Object;
```

#### Type declaration

<MemberCard>

##### BoxedFunctionDefinition.complexity

```ts
complexity: number;
```

</MemberCard>

<MemberCard>

##### BoxedFunctionDefinition.hold

```ts
hold: Hold;
```

</MemberCard>

<MemberCard>

##### BoxedFunctionDefinition.signature

```ts
signature: BoxedFunctionSignature;
```

</MemberCard>

<a id="numericflags" name="numericflags"></a>

### NumericFlags

```ts
type NumericFlags: Object;
```

When used in a `SymbolDefinition`, these flags are optional.

If provided, they will override the value derived from
the symbol's value.

For example, it might be useful to override `algebraic = false`
for a transcendental number.

#### Type declaration

<a id="number-1" name="number-1"></a>

<MemberCard>

##### NumericFlags.number

```ts
number: boolean | undefined;
```

</MemberCard>

<a id="integer" name="integer"></a>

<MemberCard>

##### NumericFlags.integer

```ts
integer: boolean | undefined;
```

</MemberCard>

<a id="rational-1" name="rational-1"></a>

<MemberCard>

##### NumericFlags.rational

```ts
rational: boolean | undefined;
```

</MemberCard>

<a id="algebraic" name="algebraic"></a>

<MemberCard>

##### NumericFlags.algebraic

```ts
algebraic: boolean | undefined;
```

</MemberCard>

<a id="real" name="real"></a>

<MemberCard>

##### NumericFlags.real

```ts
real: boolean | undefined;
```

</MemberCard>

<a id="extendedreal" name="extendedreal"></a>

<MemberCard>

##### NumericFlags.extendedReal

```ts
extendedReal: boolean | undefined;
```

</MemberCard>

<a id="complex-1" name="complex-1"></a>

<MemberCard>

##### NumericFlags.complex

```ts
complex: boolean | undefined;
```

</MemberCard>

<a id="extendedcomplex" name="extendedcomplex"></a>

<MemberCard>

##### NumericFlags.extendedComplex

```ts
extendedComplex: boolean | undefined;
```

</MemberCard>

<a id="imaginary" name="imaginary"></a>

<MemberCard>

##### NumericFlags.imaginary

```ts
imaginary: boolean | undefined;
```

</MemberCard>

<a id="positive" name="positive"></a>

<MemberCard>

##### NumericFlags.positive

```ts
positive: boolean | undefined;
```

</MemberCard>

<a id="nonpositive" name="nonpositive"></a>

<MemberCard>

##### NumericFlags.nonPositive

```ts
nonPositive: boolean | undefined;
```

</MemberCard>

<a id="negative" name="negative"></a>

<MemberCard>

##### NumericFlags.negative

```ts
negative: boolean | undefined;
```

</MemberCard>

<a id="nonnegative" name="nonnegative"></a>

<MemberCard>

##### NumericFlags.nonNegative

```ts
nonNegative: boolean | undefined;
```

</MemberCard>

<a id="zero-1" name="zero-1"></a>

<MemberCard>

##### NumericFlags.zero

```ts
zero: boolean | undefined;
```

</MemberCard>

<a id="notzero" name="notzero"></a>

<MemberCard>

##### NumericFlags.notZero

```ts
notZero: boolean | undefined;
```

</MemberCard>

<a id="one-1" name="one-1"></a>

<MemberCard>

##### NumericFlags.one

```ts
one: boolean | undefined;
```

</MemberCard>

<a id="negativeone-1" name="negativeone-1"></a>

<MemberCard>

##### NumericFlags.negativeOne

```ts
negativeOne: boolean | undefined;
```

</MemberCard>

<a id="infinity" name="infinity"></a>

<MemberCard>

##### NumericFlags.infinity

```ts
infinity: boolean | undefined;
```

</MemberCard>

<a id="nan-1" name="nan-1"></a>

<MemberCard>

##### NumericFlags.NaN

```ts
NaN: boolean | undefined;
```

</MemberCard>

<a id="finite" name="finite"></a>

<MemberCard>

##### NumericFlags.finite

```ts
finite: boolean | undefined;
```

</MemberCard>

<a id="even" name="even"></a>

<MemberCard>

##### NumericFlags.even

```ts
even: boolean | undefined;
```

</MemberCard>

<a id="odd" name="odd"></a>

<MemberCard>

##### NumericFlags.odd

```ts
odd: boolean | undefined;
```

</MemberCard>

<a id="prime" name="prime"></a>

<MemberCard>

##### NumericFlags.prime

```ts
prime: boolean | undefined;
```

</MemberCard>

<a id="composite" name="composite"></a>

<MemberCard>

##### NumericFlags.composite

```ts
composite: boolean | undefined;
```

</MemberCard>

<a id="symbolattributes" name="symbolattributes"></a>

### SymbolAttributes

```ts
type SymbolAttributes: Object;
```

#### Type declaration

<a id="constant" name="constant"></a>

<MemberCard>

##### SymbolAttributes.constant

```ts
constant: boolean;
```

If `true` the value of the symbol is constant. The value or domain of
symbols with this attribute set to `true` cannot be changed.

If `false`, the symbol is a variable.

**Default**: `false`

</MemberCard>

<a id="holduntil" name="holduntil"></a>

<MemberCard>

##### SymbolAttributes.holdUntil

```ts
holdUntil: "never" | "simplify" | "evaluate" | "N";
```

If the symbol has a value, it is held as indicated in the table below.
A green checkmark indicate that the symbol is substituted.

<div className="symbols-table">

| Operation | `"never"` | `"simplify"` | `"evaluate"` | `"N"` |
| :--- | :----- |
| `canonical()`|  (X) | | | |
| `simplify()` |   (X) | (X) | | |
| `evaluate()` |   (X) | (X) | (X) | |
| `"N()"` |  (X) | (X)  |  (X) | (X)  |

</div>

Some examples:
- `i` has `holdUntil: 'never'`
- `GoldenRatio` has `holdUntil: 'simplify'` (symbolic constant)
- `x` has `holdUntil: 'evaluate'` (variables)
- `Pi` has `holdUntil: 'N'` (special numeric constant)

**Default:** `evaluate`

</MemberCard>

<a id="symboldefinition-1" name="symboldefinition-1"></a>

### SymbolDefinition

```ts
type SymbolDefinition: BaseDefinition & Partial<SymbolAttributes> & Object;
```

A bound symbol (i.e. one with an associated definition) has either a domain
(e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... domain = TranscendentalNumbers)

#### Type declaration

<MemberCard>

##### SymbolDefinition.domain?

```ts
optional domain: DomainLiteral | BoxedDomain;
```

</MemberCard>

<MemberCard>

##### SymbolDefinition.inferred?

```ts
optional inferred: boolean;
```

If true, the domain is inferred, and could be adjusted later
as more information becomes available or if the symbol is explicitly
declared.

</MemberCard>

<MemberCard>

##### SymbolDefinition.value?

```ts
optional value: LatexString | SemiBoxedExpression | (ce) => SemiBoxedExpression | null;
```

`value` can be a JS function since for some constants, such as
`Pi`, the actual value depends on the `precision` setting of the
`ComputeEngine` and possible other environment settings

</MemberCard>

<MemberCard>

##### SymbolDefinition.flags?

```ts
optional flags: Partial<NumericFlags>;
```

</MemberCard>

<a id="boxedsymboldefinition" name="boxedsymboldefinition"></a>

### BoxedSymbolDefinition

#### Extends

- [`BoxedBaseDefinition`](#boxedbasedefinition).[`SymbolAttributes`](#symbolattributes).`Partial`\<[`NumericFlags`](#numericflags)\>

<a id="domain-2" name="domain-2"></a>

<MemberCard>

##### BoxedSymbolDefinition.domain

```ts
domain: BoxedDomain;
```

</MemberCard>

<a id="inferreddomain" name="inferreddomain"></a>

<MemberCard>

##### BoxedSymbolDefinition.inferredDomain

```ts
inferredDomain: boolean;
```

</MemberCard>

<a id="value-1" name="value-1"></a>

<MemberCard>

##### BoxedSymbolDefinition.value

```ts
get value(): BoxedExpression
```

```ts
set value(val): void
```

[`BoxedExpression`](#boxedexpression)

• **val**: [`SemiBoxedExpression`](#semiboxedexpression)

</MemberCard>

## Latex Parsing and Serialization

<a id="latextoken" name="latextoken"></a>

### LatexToken

```ts
type LatexToken: 
  | string
  | "<{>"
  | "<}>"
  | "<space>"
  | "<$>"
  | "<$$>";
```

A `LatexToken` is a token as returned by `Scanner.peek`.

It can be one of the indicated tokens, or a string that starts with a
`` for LaTeX commands, or a LaTeX character which includes digits,
letters and punctuation.

<a id="delimiter" name="delimiter"></a>

### Delimiter

```ts
type Delimiter: 
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
  | "\\lceil"
  | "\\rceil"
  | "\\lfloor"
  | "\\rfloor";
```

Open and close delimiters that can be used with [`MatchfixEntry`](#matchfixentry)
record to define new LaTeX dictionary entries.

<a id="librarycategory" name="librarycategory"></a>

### LibraryCategory

```ts
type LibraryCategory: 
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

<a id="precedence" name="precedence"></a>

### Precedence

```ts
type Precedence: number;
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

<a id="terminator" name="terminator"></a>

### Terminator

```ts
type Terminator: Object;
```

This indicates a condition under which parsing should stop:
- an operator of a precedence higher than specified has been encountered
- the last token has been reached
- or if a condition is provided, the condition returns true;

#### Type declaration

<a id="minprec" name="minprec"></a>

<MemberCard>

##### Terminator.minPrec

```ts
minPrec: Precedence;
```

</MemberCard>

<a id="condition" name="condition"></a>

<MemberCard>

##### Terminator.condition?

```ts
optional condition: (parser) => boolean;
```

• **parser**: [`Parser`](#parser)

</MemberCard>

<a id="expressionparsehandler" name="expressionparsehandler"></a>

### ExpressionParseHandler

```ts
type ExpressionParseHandler: (parser, until?) => Expression | null;
```

Custom parsing handler.

When invoked the scanner points right after the LaTeX fragment that triggered
this parsing handler.

The scanner should be moved, by calling `scanner.next()` for every consumed
token.

If it was in an infix or postfix context, `lhs` will represent the
left-hand side argument. In a prefix or matchfix context, `lhs` is `null`.

In a superfix (^) or subfix (_) context (that is if the first token of the
trigger is `^` or `_`), lhs is `["Superscript", lhs, rhs]`
and `["Subscript", lhs, rhs]`, respectively.

The handler should return `null` if the expression could not be parsed
(didn't match the syntax that was expected). The matching expression
otherwise.

• **parser**: [`Parser`](#parser)

• **until?**: `Readonly`\<[`Terminator`](#terminator)\>

<a id="prefixparsehandler" name="prefixparsehandler"></a>

### PrefixParseHandler

```ts
type PrefixParseHandler: (parser, until?) => Expression | null;
```

• **parser**: [`Parser`](#parser)

• **until?**: `Readonly`\<[`Terminator`](#terminator)\>

<a id="symbolparsehandler" name="symbolparsehandler"></a>

### SymbolParseHandler

```ts
type SymbolParseHandler: (parser, until?) => Expression | null;
```

• **parser**: [`Parser`](#parser)

• **until?**: `Readonly`\<[`Terminator`](#terminator)\>

<a id="functionparsehandler" name="functionparsehandler"></a>

### FunctionParseHandler

```ts
type FunctionParseHandler: (parser, until?) => Expression | null;
```

• **parser**: [`Parser`](#parser)

• **until?**: `Readonly`\<[`Terminator`](#terminator)\>

<a id="environmentparsehandler" name="environmentparsehandler"></a>

### EnvironmentParseHandler

```ts
type EnvironmentParseHandler: (parser, until?) => Expression | null;
```

• **parser**: [`Parser`](#parser)

• **until?**: `Readonly`\<[`Terminator`](#terminator)\>

<a id="postfixparsehandler" name="postfixparsehandler"></a>

### PostfixParseHandler

```ts
type PostfixParseHandler: (parser, lhs, until?) => Expression | null;
```

• **parser**: [`Parser`](#parser)

• **lhs**: [`Expression`](#expression)

• **until?**: `Readonly`\<[`Terminator`](#terminator)\>

<a id="infixparsehandler" name="infixparsehandler"></a>

### InfixParseHandler

```ts
type InfixParseHandler: (parser, lhs, until) => Expression | null;
```

• **parser**: [`Parser`](#parser)

• **lhs**: [`Expression`](#expression)

• **until**: `Readonly`\<[`Terminator`](#terminator)\>

<a id="matchfixparsehandler" name="matchfixparsehandler"></a>

### MatchfixParseHandler

```ts
type MatchfixParseHandler: (parser, body) => Expression | null;
```

• **parser**: [`Parser`](#parser)

• **body**: [`Expression`](#expression)

<a id="latexargumenttype" name="latexargumenttype"></a>

### LatexArgumentType

```ts
type LatexArgumentType: 
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

<a id="trigger" name="trigger"></a>

### Trigger

```ts
type Trigger: Object;
```

The trigger is the set of tokens that will make this record eligible to
parse the stream and generate an expression. If the trigger matches,
the `parse` handler is called, if available.

The trigger can be specified either as a LaTeX string (`latexTrigger`) or
as an identifier (`identifierTrigger`), which can be wrapped in a LaTeX
command, for example `\operatorname{mod}` or `\mathbin{gcd}`, with `"gcd"`
 being the `identifierTrigger`.

`matchfix` operators use `openTrigger` and `closeTrigger` instead.

#### Type declaration

<a id="latextrigger" name="latextrigger"></a>

<MemberCard>

##### Trigger.latexTrigger?

```ts
optional latexTrigger: LatexString | LatexToken[];
```

</MemberCard>

<a id="identifiertrigger" name="identifiertrigger"></a>

<MemberCard>

##### Trigger.identifierTrigger?

```ts
optional identifierTrigger: string;
```

</MemberCard>

<a id="baseentry" name="baseentry"></a>

### BaseEntry

```ts
type BaseEntry: Object;
```

Maps a string of LaTeX tokens to a function or symbol and vice-versa.

#### Type declaration

<a id="name-1" name="name-1"></a>

<MemberCard>

##### BaseEntry.name?

```ts
optional name: string;
```

Map a MathJSON function or symbol name to this entry.

Each entry should have at least a `name` or a `parse` handler.

An entry with no `name` cannot be serialized: the `name` is used to map
a MathJSON function or symbol name to the appropriate entry for serializing.
However, an entry with no `name` can be used to define a synonym (for example
for the symbol `\varnothing` which is a synonym for `\emptyset`).

If no `parse` handler is provided, only the trigger is used to select this
entry. Otherwise, if the trigger of the entry matches the current
token, the `parse` handler is invoked.

</MemberCard>

<a id="serialize-2" name="serialize-2"></a>

<MemberCard>

##### BaseEntry.serialize?

```ts
optional serialize: LatexString | SerializeHandler;
```

Transform an expression into a LaTeX string.
If no `serialize` handler is provided, the `trigger` property is used

</MemberCard>

<a id="defaultentry" name="defaultentry"></a>

### DefaultEntry

```ts
type DefaultEntry: BaseEntry & Trigger & Object;
```

#### Type declaration

<MemberCard>

##### DefaultEntry.parse

```ts
parse: Expression | ExpressionParseHandler;
```

</MemberCard>

<a id="expressionentry" name="expressionentry"></a>

### ExpressionEntry

```ts
type ExpressionEntry: BaseEntry & Trigger & Object;
```

#### Type declaration

<MemberCard>

##### ExpressionEntry.kind

```ts
kind: "expression";
```

</MemberCard>

<MemberCard>

##### ExpressionEntry.parse

```ts
parse: Expression | ExpressionParseHandler;
```

</MemberCard>

<MemberCard>

##### ExpressionEntry.precedence?

```ts
optional precedence: Precedence;
```

</MemberCard>

<a id="matchfixentry" name="matchfixentry"></a>

### MatchfixEntry

```ts
type MatchfixEntry: BaseEntry & Object;
```

#### Type declaration

<MemberCard>

##### MatchfixEntry.kind

```ts
kind: "matchfix";
```

</MemberCard>

<MemberCard>

##### MatchfixEntry.openTrigger

```ts
openTrigger: Delimiter | LatexToken[];
```

If `kind` is `'matchfix'`: the `openTrigger` and `closeTrigger`
properties are required.

</MemberCard>

<MemberCard>

##### MatchfixEntry.closeTrigger

```ts
closeTrigger: Delimiter | LatexToken[];
```

</MemberCard>

<MemberCard>

##### MatchfixEntry.parse?

```ts
optional parse: MatchfixParseHandler;
```

When invoked, the parser is pointing after the close delimiter.
The argument of the handler is the body, i.e. the content between
the open delimiter and the close delimiter.

</MemberCard>

<a id="infixentry" name="infixentry"></a>

### InfixEntry

```ts
type InfixEntry: BaseEntry & Trigger & Object;
```

#### Type declaration

<MemberCard>

##### InfixEntry.kind

```ts
kind: "infix";
```

Infix position, with an operand before and an operand after: `a ⊛ b`.

Example: `+`, `\times`.

</MemberCard>

<MemberCard>

##### InfixEntry.associativity?

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

<MemberCard>

##### InfixEntry.precedence?

```ts
optional precedence: Precedence;
```

</MemberCard>

<MemberCard>

##### InfixEntry.parse?

```ts
optional parse: string | InfixParseHandler;
```

</MemberCard>

<a id="postfixentry" name="postfixentry"></a>

### PostfixEntry

```ts
type PostfixEntry: BaseEntry & Trigger & Object;
```

#### Type declaration

<MemberCard>

##### PostfixEntry.kind

```ts
kind: "postfix";
```

Postfix position, with an operand before: `a ⊛`

Example: `!`.

</MemberCard>

<MemberCard>

##### PostfixEntry.precedence?

```ts
optional precedence: Precedence;
```

</MemberCard>

<MemberCard>

##### PostfixEntry.parse?

```ts
optional parse: string | PostfixParseHandler;
```

</MemberCard>

<a id="prefixentry" name="prefixentry"></a>

### PrefixEntry

```ts
type PrefixEntry: BaseEntry & Trigger & Object;
```

#### Type declaration

<MemberCard>

##### PrefixEntry.kind

```ts
kind: "prefix";
```

Prefix position, with an operand after: `⊛ a`

Example: `-`, `\not`.

</MemberCard>

<MemberCard>

##### PrefixEntry.precedence

```ts
precedence: Precedence;
```

</MemberCard>

<MemberCard>

##### PrefixEntry.parse?

```ts
optional parse: string | PrefixParseHandler;
```

</MemberCard>

<a id="environmententry" name="environmententry"></a>

### EnvironmentEntry

```ts
type EnvironmentEntry: BaseEntry & Object;
```

A LaTeX dictionary entry for an environment, that is a LaTeX
construct using `\begin{...}...\end{...}`.

#### Type declaration

<MemberCard>

##### EnvironmentEntry.kind

```ts
kind: "environment";
```

</MemberCard>

<MemberCard>

##### EnvironmentEntry.parse

```ts
parse: EnvironmentParseHandler;
```

</MemberCard>

<MemberCard>

##### EnvironmentEntry.identifierTrigger

```ts
identifierTrigger: string;
```

</MemberCard>

<a id="symbolentry" name="symbolentry"></a>

### SymbolEntry

```ts
type SymbolEntry: BaseEntry & Trigger & Object;
```

#### Type declaration

<MemberCard>

##### SymbolEntry.kind

```ts
kind: "symbol";
```

</MemberCard>

<MemberCard>

##### SymbolEntry.precedence?

```ts
optional precedence: Precedence;
```

Used for appropriate wrapping (i.e. when to surround it with parens)

</MemberCard>

<MemberCard>

##### SymbolEntry.parse

```ts
parse: Expression | SymbolParseHandler;
```

</MemberCard>

<a id="functionentry" name="functionentry"></a>

### FunctionEntry

```ts
type FunctionEntry: BaseEntry & Trigger & Object;
```

A function is an identifier followed by:
- some postfix operators such as `\prime`
- an optional list of arguments in an enclosure (parentheses)

For more complex situations, for example implicit arguments or
inverse functions postfix (i.e. ^\{-1\}), use a custom parse handler with a
entry of kind `expression`.

#### Type declaration

<MemberCard>

##### FunctionEntry.kind

```ts
kind: "function";
```

</MemberCard>

<MemberCard>

##### FunctionEntry.parse?

```ts
optional parse: Expression | FunctionParseHandler;
```

</MemberCard>

<a id="latexdictionaryentry" name="latexdictionaryentry"></a>

### LatexDictionaryEntry

```ts
type LatexDictionaryEntry: 
  | DefaultEntry
  | ExpressionEntry
  | MatchfixEntry
  | InfixEntry
  | PostfixEntry
  | PrefixEntry
  | SymbolEntry
  | FunctionEntry
  | EnvironmentEntry;
```

A dictionary entry is a record that maps a LaTeX token or string of tokens
to a MathJSON expression or to a parsing handler.

Set the [`ComputeEngine.latexDictionary`](#latexdictionary) property to an array of
dictionary entries to define custom LaTeX parsing and serialization.

<a id="parselatexoptions" name="parselatexoptions"></a>

### ParseLatexOptions

```ts
type ParseLatexOptions: Object;
```

The LaTeX parsing options can be set using the
[`ComputeEngine.latexOptions`](#latexoptions) property.

#### Type declaration

<a id="skipspace-1" name="skipspace-1"></a>

<MemberCard>

##### ParseLatexOptions.skipSpace

```ts
skipSpace: boolean;
```

If true, ignore space characters in math mode.

**Default**: `true`

</MemberCard>

<a id="parseargumentsofunknownlatexcommands" name="parseargumentsofunknownlatexcommands"></a>

<MemberCard>

##### ParseLatexOptions.parseArgumentsOfUnknownLatexCommands

```ts
parseArgumentsOfUnknownLatexCommands: boolean;
```

When an unknown LaTeX command is encountered, attempt to parse
any arguments it may have.

For example, `\foo{x+1}` would produce `['\foo', ['Add', 'x', 1]]` if
this property is true, `['LatexSymbols', '\foo', '<{>', 'x', '+', 1, '<{>']`
otherwise.

</MemberCard>

<a id="parsenumbers" name="parsenumbers"></a>

<MemberCard>

##### ParseLatexOptions.parseNumbers

```ts
parseNumbers: "auto" | "rational" | "decimal" | "never";
```

When parsing a decimal number (e.g. `3.1415`):

- `"auto"` or `"decimal"`: if a decimal number parse it as an approximate
  decimal number with a whole part and a fractional part
- `"rational"`: if a decimal number, parse it as an exact rational number
  with a numerator  and a denominator. If not a decimal number, parse
  it as a regular number.
- `"never"`: do not parse numbers, instead return each token making up
 the number (minus sign, digits, decimal marker, etc...).

Note: if the number includes repeating digits (e.g. `1.33(333)`),
it will be parsed as a decimal number even if this setting is `"rational"`.

**Default**: `"auto"`

</MemberCard>

<a id="parseunknownidentifier" name="parseunknownidentifier"></a>

<MemberCard>

##### ParseLatexOptions.parseUnknownIdentifier

```ts
parseUnknownIdentifier: (identifier, parser) => "symbol" | "function" | "unknown";
```

This handler is invoked when the parser encounters an identifier
that does not have a corresponding entry in the dictionary.

The `identifier` argument is a (valid identifier)[/math-json/#identifiers].

The handler can return:

- `"symbol"`: the identifier is a constant or variable name.

- `"function"`: the identifier is a function name. If an apply
function operator (typically, parentheses) follow, they will be parsed
as arguments to the function.

- `"unknown"`: the identifier is not recognized.

• **identifier**: `string`

• **parser**: [`Parser`](#parser)

</MemberCard>

<a id="preservelatex" name="preservelatex"></a>

<MemberCard>

##### ParseLatexOptions.preserveLatex

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

<a id="delimiterscale" name="delimiterscale"></a>

### DelimiterScale

```ts
type DelimiterScale: "normal" | "scaled" | "big" | "none";
```

<a id="serializelatexoptions" name="serializelatexoptions"></a>

### SerializeLatexOptions

```ts
type SerializeLatexOptions: Object;
```

The LaTeX serialization options can be set using the
[`ComputeEngine.latexOptions`](#latexoptions) property.

#### Type declaration

<a id="invisiblemultiply" name="invisiblemultiply"></a>

<MemberCard>

##### SerializeLatexOptions.invisibleMultiply

```ts
invisibleMultiply: LatexString;
```

LaTeX string used to render an invisible multiply, e.g. in '2x'.

Leave it empty to join the adjacent terms, i.e. `2x`.

Use `\cdot` to insert a `\cdot` operator between them, i.e. `2\cdot x`.

Empty by default.

</MemberCard>

<a id="invisibleplus" name="invisibleplus"></a>

<MemberCard>

##### SerializeLatexOptions.invisiblePlus

```ts
invisiblePlus: LatexString;
```

LaTeX string used for an invisible plus with mixed numbers e.g. in '1 3/4'.

Leave it empty to join the main number and the fraction, i.e. render it
as `1\frac{3}{4}`.

Use `+` to insert an explicit `+` operator between them,
 i.e. `1+\frac{3}{4}`

Empty by default.

</MemberCard>

<a id="multiply" name="multiply"></a>

<MemberCard>

##### SerializeLatexOptions.multiply

```ts
multiply: LatexString;
```

LaTeX string used for an explicit multiply operator,

Default: `\times`

</MemberCard>

<a id="missingsymbol" name="missingsymbol"></a>

<MemberCard>

##### SerializeLatexOptions.missingSymbol

```ts
missingSymbol: LatexString;
```

When an expression contains the error expression `["Error", "'missing'"]`,
serialize it with this LaTeX string

</MemberCard>

<a id="applyfunctionstyle-1" name="applyfunctionstyle-1"></a>

<MemberCard>

##### SerializeLatexOptions.applyFunctionStyle

```ts
applyFunctionStyle: (expr, level) => DelimiterScale;
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="groupstyle-1" name="groupstyle-1"></a>

<MemberCard>

##### SerializeLatexOptions.groupStyle

```ts
groupStyle: (expr, level) => DelimiterScale;
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="rootstyle-1" name="rootstyle-1"></a>

<MemberCard>

##### SerializeLatexOptions.rootStyle

```ts
rootStyle: (expr, level) => "radical" | "quotient" | "solidus";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="fractionstyle-1" name="fractionstyle-1"></a>

<MemberCard>

##### SerializeLatexOptions.fractionStyle

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

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="logicstyle-1" name="logicstyle-1"></a>

<MemberCard>

##### SerializeLatexOptions.logicStyle

```ts
logicStyle: (expr, level) => "word" | "boolean" | "uppercase-word" | "punctuation";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="powerstyle-1" name="powerstyle-1"></a>

<MemberCard>

##### SerializeLatexOptions.powerStyle

```ts
powerStyle: (expr, level) => "root" | "solidus" | "quotient";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="numericsetstyle-1" name="numericsetstyle-1"></a>

<MemberCard>

##### SerializeLatexOptions.numericSetStyle

```ts
numericSetStyle: (expr, level) => "compact" | "regular" | "interval" | "set-builder";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="numberformattingoptions" name="numberformattingoptions"></a>

### NumberFormattingOptions

```ts
type NumberFormattingOptions: Object;
```

The options to format numbers can be set using the
[`ComputeEngine.latexOptions`](#latexoptions) property.

#### Type declaration

<a id="precision-1" name="precision-1"></a>

<MemberCard>

##### NumberFormattingOptions.precision

```ts
precision: number;
```

</MemberCard>

<a id="positiveinfinity-1" name="positiveinfinity-1"></a>

<MemberCard>

##### NumberFormattingOptions.positiveInfinity

```ts
positiveInfinity: LatexString;
```

</MemberCard>

<a id="negativeinfinity-1" name="negativeinfinity-1"></a>

<MemberCard>

##### NumberFormattingOptions.negativeInfinity

```ts
negativeInfinity: LatexString;
```

</MemberCard>

<a id="notanumber" name="notanumber"></a>

<MemberCard>

##### NumberFormattingOptions.notANumber

```ts
notANumber: LatexString;
```

</MemberCard>

<a id="decimalmarker" name="decimalmarker"></a>

<MemberCard>

##### NumberFormattingOptions.decimalMarker

```ts
decimalMarker: LatexString;
```

A string representing the decimal marker, the string separating
the whole portion of a number from the fractional portion, i.e.
the '.' in '3.1415'.

Some countries use a comma rather than a dot. In this case it is
recommended to use `"{,}"` as the marker: the surrounding brackets ensure
there is no additional gap after the comma.

**Default**: `"."`

</MemberCard>

<a id="groupseparator" name="groupseparator"></a>

<MemberCard>

##### NumberFormattingOptions.groupSeparator

```ts
groupSeparator: LatexString;
```

A string representing the separator between groups of digits,
used to improve readability of numbers with lots of digits.

If you change it to another value, be aware that this may lead to
unexpected results. For example, if changing it to `,` the expression
`\operatorname{Hypot}(1,2)` will parse as `["Hypot", 1.2]` rather than
`["Hypot", 1, 2]`.

**Default**: `"\\,"` (thin space, 3/18mu) (Resolution 7 of the 1948 CGPM)

</MemberCard>

<a id="exponentproduct" name="exponentproduct"></a>

<MemberCard>

##### NumberFormattingOptions.exponentProduct

```ts
exponentProduct: LatexString;
```

</MemberCard>

<a id="beginexponentmarker" name="beginexponentmarker"></a>

<MemberCard>

##### NumberFormattingOptions.beginExponentMarker

```ts
beginExponentMarker: LatexString;
```

</MemberCard>

<a id="endexponentmarker" name="endexponentmarker"></a>

<MemberCard>

##### NumberFormattingOptions.endExponentMarker

```ts
endExponentMarker: LatexString;
```

</MemberCard>

<a id="notation" name="notation"></a>

<MemberCard>

##### NumberFormattingOptions.notation

```ts
notation: "engineering" | "auto" | "scientific";
```

</MemberCard>

<a id="truncationmarker" name="truncationmarker"></a>

<MemberCard>

##### NumberFormattingOptions.truncationMarker

```ts
truncationMarker: LatexString;
```

</MemberCard>

<a id="beginrepeatingdigits" name="beginrepeatingdigits"></a>

<MemberCard>

##### NumberFormattingOptions.beginRepeatingDigits

```ts
beginRepeatingDigits: LatexString;
```

</MemberCard>

<a id="endrepeatingdigits" name="endrepeatingdigits"></a>

<MemberCard>

##### NumberFormattingOptions.endRepeatingDigits

```ts
endRepeatingDigits: LatexString;
```

</MemberCard>

<a id="imaginaryunit" name="imaginaryunit"></a>

<MemberCard>

##### NumberFormattingOptions.imaginaryUnit

```ts
imaginaryUnit: LatexString;
```

</MemberCard>

<a id="avoidexponentsinrange" name="avoidexponentsinrange"></a>

<MemberCard>

##### NumberFormattingOptions.avoidExponentsInRange

```ts
avoidExponentsInRange: undefined | null | [number, number];
```

</MemberCard>

<a id="serializer" name="serializer"></a>

### Serializer

An instance of `Serializer` is provided to the `serialize` handlers of custom
LaTeX dictionary entries.

<a id="onerror" name="onerror"></a>

<MemberCard>

##### Serializer.onError

```ts
readonly onError: WarningSignalHandler;
```

</MemberCard>

<a id="options" name="options"></a>

<MemberCard>

##### Serializer.options

```ts
readonly options: Required<SerializeLatexOptions>;
```

</MemberCard>

<a id="level" name="level"></a>

<MemberCard>

##### Serializer.level

```ts
level: number;
```

"depth" of the expression:
- 0 for the root
- 1 for the arguments of the root
- 2 for the arguments of the arguments of the root
- etc...

This allows for variation of the LaTeX serialized based
on the depth of the expression, for example using `\Bigl(`
for the top level, and `\bigl(` or `(` for others.

</MemberCard>

<a id="canonical" name="canonical"></a>

<MemberCard>

##### Serializer.canonical?

```ts
optional canonical: boolean;
```

If true, apply transformations to the expression so the output
doesn't necessarily match the raw MathJSON, but is more visually pleasing
and easier to read. If false, output the raw MathJSON.

</MemberCard>

<a id="serialize-1" name="serialize-1"></a>

<MemberCard>

##### Serializer.serialize

```ts
serialize: (expr) => string;
```

Output a LaTeX string representing the expression

• **expr**: [`Expression`](#expression)

</MemberCard>

<a id="wrap" name="wrap"></a>

<MemberCard>

##### Serializer.wrap

```ts
wrap: (expr, prec?) => string;
```

Add a group fence around the expression if it is
an operator of precedence less than or equal to `prec`.

• **expr**: [`Expression`](#expression)

• **prec?**: `number`

</MemberCard>

<a id="applyfunctionstyle" name="applyfunctionstyle"></a>

<MemberCard>

##### Serializer.applyFunctionStyle

```ts
applyFunctionStyle: (expr, level) => DelimiterScale;
```

Styles

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="groupstyle" name="groupstyle"></a>

<MemberCard>

##### Serializer.groupStyle

```ts
groupStyle: (expr, level) => DelimiterScale;
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="rootstyle" name="rootstyle"></a>

<MemberCard>

##### Serializer.rootStyle

```ts
rootStyle: (expr, level) => "radical" | "quotient" | "solidus";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="fractionstyle" name="fractionstyle"></a>

<MemberCard>

##### Serializer.fractionStyle

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

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="logicstyle" name="logicstyle"></a>

<MemberCard>

##### Serializer.logicStyle

```ts
logicStyle: (expr, level) => "boolean" | "word" | "uppercase-word" | "punctuation";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="powerstyle" name="powerstyle"></a>

<MemberCard>

##### Serializer.powerStyle

```ts
powerStyle: (expr, level) => "quotient" | "solidus" | "root";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="numericsetstyle" name="numericsetstyle"></a>

<MemberCard>

##### Serializer.numericSetStyle

```ts
numericSetStyle: (expr, level) => "interval" | "compact" | "regular" | "set-builder";
```

• **expr**: [`Expression`](#expression)

• **level**: `number`

</MemberCard>

<a id="wrapstring" name="wrapstring"></a>

<MemberCard>

##### Serializer.wrapString()

```ts
wrapString(
   s, 
   style, 
   delimiters?): string
```

Output `s` surrounded by delimiters.

If `delimiters` is not specified, use `()`

• **s**: `string`

• **style**: [`DelimiterScale`](#delimiterscale)

• **delimiters?**: `string`

</MemberCard>

<a id="wraparguments" name="wraparguments"></a>

<MemberCard>

##### Serializer.wrapArguments()

```ts
wrapArguments(expr): string
```

A string with the arguments of expr fenced appropriately and separated by
commas.

• **expr**: [`Expression`](#expression)

</MemberCard>

<a id="wrapshort" name="wrapshort"></a>

<MemberCard>

##### Serializer.wrapShort()

```ts
wrapShort(expr): string
```

Add a group fence around the expression if it is
short (not a function)

• **expr**: [`Expression`](#expression)

</MemberCard>

<a id="serializefunction" name="serializefunction"></a>

<MemberCard>

##### Serializer.serializeFunction()

```ts
serializeFunction(expr): string
```

• **expr**: [`Expression`](#expression)

</MemberCard>

<a id="serializesymbol" name="serializesymbol"></a>

<MemberCard>

##### Serializer.serializeSymbol()

```ts
serializeSymbol(expr): string
```

• **expr**: [`Expression`](#expression)

</MemberCard>

<a id="serializehandler" name="serializehandler"></a>

### SerializeHandler

```ts
type SerializeHandler: (serializer, expr) => string;
```

The `serialize` handler of a custom LaTeX dictionary entry can be
a function of this type.

• **serializer**: [`Serializer`](#serializer)

• **expr**: [`Expression`](#expression)

<a id="parser" name="parser"></a>

### Parser

An instance of `Parser` is provided to the `parse` handlers of custom
LaTeX dictionary entries.

<a id="options-1" name="options-1"></a>

<MemberCard>

##### Parser.options

```ts
readonly options: Required<ParseLatexOptions>;
```

</MemberCard>

<a id="computeengine-1" name="computeengine-1"></a>

<MemberCard>

##### Parser.computeEngine?

```ts
optional readonly computeEngine: IComputeEngine;
```

</MemberCard>

<a id="index" name="index"></a>

<MemberCard>

##### Parser.index

```ts
index: number;
```

The index of the current token

</MemberCard>

<a id="atend" name="atend"></a>

<MemberCard>

##### Parser.atEnd

```ts
readonly atEnd: boolean;
```

True if the last token has been reached.
Consider also `atTerminator()`.

</MemberCard>

<a id="peek" name="peek"></a>

<MemberCard>

##### Parser.peek

```ts
readonly peek: string;
```

Return the next token, without advancing the index

</MemberCard>

<a id="atboundary" name="atboundary"></a>

<MemberCard>

##### Parser.atBoundary

```ts
get atBoundary(): boolean
```

`boolean`

</MemberCard>

<a id="atterminator" name="atterminator"></a>

<MemberCard>

##### Parser.atTerminator()

```ts
atTerminator(t): boolean
```

Return true if the terminator condition is met or if the last token
has been reached.

• **t**: [`Terminator`](#terminator)

</MemberCard>

<a id="nexttoken" name="nexttoken"></a>

<MemberCard>

##### Parser.nextToken()

```ts
nextToken(): string
```

Return the next token and advance the index

</MemberCard>

<a id="latex" name="latex"></a>

<MemberCard>

##### Parser.latex()

```ts
latex(start, end?): string
```

Return a string representation of the expression
between `start` and `end` (default: the whole expression)

• **start**: `number`

• **end?**: `number`

</MemberCard>

<a id="error-1" name="error-1"></a>

<MemberCard>

##### Parser.error()

```ts
error(code, fromToken): Expression
```

Return an error expression with the specified code and arguments

• **code**: `string` \| [`string`, `...Expression[]`]

• **fromToken**: `number`

</MemberCard>

<a id="skipspace" name="skipspace"></a>

<MemberCard>

##### Parser.skipSpace()

```ts
skipSpace(): boolean
```

If there are any space, advance the index until a non-space is encountered

</MemberCard>

<a id="skipvisualspace" name="skipvisualspace"></a>

<MemberCard>

##### Parser.skipVisualSpace()

```ts
skipVisualSpace(): void
```

Skip over "visual space" which
includes space tokens, empty groups `{}`, and commands such as `\,` and `\!`

</MemberCard>

<a id="match" name="match"></a>

<MemberCard>

##### Parser.match()

```ts
match(token): boolean
```

If the next token matches the target advance and return true. Otherwise
return false

• **token**: `string`

</MemberCard>

<a id="matchall" name="matchall"></a>

<MemberCard>

##### Parser.matchAll()

```ts
matchAll(tokens): boolean
```

Return true if the next tokens match the argument, an array of tokens, or null otherwise

• **tokens**: `string`[]

</MemberCard>

<a id="matchany" name="matchany"></a>

<MemberCard>

##### Parser.matchAny()

```ts
matchAny(tokens): string
```

Return the next token if it matches any of the token in the argument or null otherwise

• **tokens**: `string`[]

</MemberCard>

<a id="matchchar" name="matchchar"></a>

<MemberCard>

##### Parser.matchChar()

```ts
matchChar(): string
```

If the next token is a character, return it and advance the index
This includes plain characters (e.g. 'a', '+'...), characters
defined in hex (^^ and ^^^^), the `\char` and `\unicode` command.

</MemberCard>

<a id="parsegroup" name="parsegroup"></a>

<MemberCard>

##### Parser.parseGroup()

```ts
parseGroup(): Expression
```

Parse an expression in aLaTeX group enclosed in curly brackets `{}`.
These are often used as arguments to LaTeX commands, for example
`\frac{1}{2}`.

Return `null` if none was found
Return `['Sequence']` if an empty group `{}` was found

</MemberCard>

<a id="parsetoken" name="parsetoken"></a>

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

<a id="parseoptionalgroup" name="parseoptionalgroup"></a>

<MemberCard>

##### Parser.parseOptionalGroup()

```ts
parseOptionalGroup(): Expression
```

Parse an expression enclosed in a LaTeX optional group enclosed in square brackets `[]`.

Return `null` if none was found.

</MemberCard>

<a id="parsestringgroup" name="parsestringgroup"></a>

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

• **optional?**: `boolean`

</MemberCard>

<a id="parsesymbol" name="parsesymbol"></a>

<MemberCard>

##### Parser.parseSymbol()

```ts
parseSymbol(until?): Expression
```

A symbol can be:
- a single-letter identifier: `x`
- a single LaTeX command: `\pi`
- a multi-letter identifier: `\operatorname{speed}`

• **until?**: `Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<a id="parsetabular" name="parsetabular"></a>

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

<a id="parsearguments" name="parsearguments"></a>

<MemberCard>

##### Parser.parseArguments()

```ts
parseArguments(kind?, until?): Expression[]
```

Parse an argument list, for example: `(12, x+1)` or `\left(x\right)`

- 'enclosure' : will look for arguments inside an enclosure
   (an open/close fence) (**default**)
- 'implicit': either an expression inside a pair of `()`, or just a primary
   (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)

Return an array of expressions, one for each argument, or `null` if no
argument was found.

• **kind?**: `"implicit"` \| `"enclosure"`

• **until?**: [`Terminator`](#terminator)

</MemberCard>

<a id="parsepostfixoperator" name="parsepostfixoperator"></a>

<MemberCard>

##### Parser.parsePostfixOperator()

```ts
parsePostfixOperator(lhs, until?): Expression
```

Parse a postfix operator, such as `'` or `!`.

Prefix, infix and matchfix operators are handled by `parseExpression()`

• **lhs**: [`Expression`](#expression)

• **until?**: `Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<a id="parseexpression" name="parseexpression"></a>

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

• **until?**: `Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<a id="parsenumber" name="parsenumber"></a>

<MemberCard>

##### Parser.parseNumber()

```ts
parseNumber(): Expression
```

Parse a number.

</MemberCard>

<a id="addboundary" name="addboundary"></a>

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

• **boundary**: `string`[]

</MemberCard>

<a id="removeboundary" name="removeboundary"></a>

<MemberCard>

##### Parser.removeBoundary()

```ts
removeBoundary(): void
```

</MemberCard>

<a id="matchboundary" name="matchboundary"></a>

<MemberCard>

##### Parser.matchBoundary()

```ts
matchBoundary(): boolean
```

</MemberCard>

<a id="boundaryerror" name="boundaryerror"></a>

<MemberCard>

##### Parser.boundaryError()

```ts
boundaryError(msg): Expression
```

• **msg**: `string` \| [`string`, `...Expression[]`]

</MemberCard>

<a id="latexstring" name="latexstring"></a>

### LatexString

```ts
type LatexString: string;
```

A LaTeX string starts and end with `$`, for example
`"$\frac{\pi}{2}$"`.

## Other

<a id="canonicaloptions" name="canonicaloptions"></a>

### CanonicalOptions

```ts
type CanonicalOptions: boolean | CanonicalForm | CanonicalForm[];
```


<a name="math-jsonmd"></a>

## MathJSON

<a id="attributes" name="attributes"></a>

### Attributes

```ts
type Attributes: Object;
```

#### Type declaration

<a id="comment" name="comment"></a>

<MemberCard>

##### Attributes.comment?

```ts
optional comment: string;
```

A human readable string to annotate this expression, since JSON does not
allow comments in its encoding

</MemberCard>

<a id="documentation" name="documentation"></a>

<MemberCard>

##### Attributes.documentation?

```ts
optional documentation: string;
```

A Markdown-encoded string providing documentation about this expression.

</MemberCard>

<a id="latex" name="latex"></a>

<MemberCard>

##### Attributes.latex?

```ts
optional latex: string;
```

A visual representation of this expression as a LaTeX string.

This can be useful to preserve non-semantic details, for example
parentheses in an expression or styling attributes.

</MemberCard>

<a id="wikidata" name="wikidata"></a>

<MemberCard>

##### Attributes.wikidata?

```ts
optional wikidata: string;
```

A short string referencing an entry in a wikibase.

For example:

`"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
 for the `Pi` constant.

</MemberCard>

<a id="wikibase" name="wikibase"></a>

<MemberCard>

##### Attributes.wikibase?

```ts
optional wikibase: string;
```

A base URL for the `wikidata` key.

A full URL can be produced by concatenating this key with the `wikidata`
key. This key applies to this node and all its children.

The default value is "https://www.wikidata.org/wiki/"

</MemberCard>

<a id="openmathsymbol" name="openmathsymbol"></a>

<MemberCard>

##### Attributes.openmathSymbol?

```ts
optional openmathSymbol: string;
```

A short string indicating an entry in an OpenMath Content Dictionary.

For example: `arith1/#abs`.

</MemberCard>

<a id="openmathcd" name="openmathcd"></a>

<MemberCard>

##### Attributes.openmathCd?

```ts
optional openmathCd: string;
```

A base URL for an OpenMath content dictionary. This key applies to this
node and all its children.

The default value is "http://www.openmath.org/cd".

</MemberCard>

<a id="sourceurl" name="sourceurl"></a>

<MemberCard>

##### Attributes.sourceUrl?

```ts
optional sourceUrl: string;
```

A URL to the source code from which this expression was generated.

</MemberCard>

<a id="sourcecontent" name="sourcecontent"></a>

<MemberCard>

##### Attributes.sourceContent?

```ts
optional sourceContent: string;
```

The source code from which this expression was generated.

It could be a LaTeX expression, or some other source language.

</MemberCard>

<a id="sourceoffsets" name="sourceoffsets"></a>

<MemberCard>

##### Attributes.sourceOffsets?

```ts
optional sourceOffsets: [number, number];
```

A character offset in `sourceContent` or `sourceUrl` from which this
expression was generated.

</MemberCard>

<a id="mathjsonidentifier" name="mathjsonidentifier"></a>

### MathJsonIdentifier

```ts
type MathJsonIdentifier: string;
```

<a id="mathjsonnumber" name="mathjsonnumber"></a>

### MathJsonNumber

```ts
type MathJsonNumber: Object & Attributes;
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

<MemberCard>

##### MathJsonNumber.num

```ts
num: "NaN" | "-Infinity" | "+Infinity" | string;
```

</MemberCard>

<a id="mathjsonsymbol" name="mathjsonsymbol"></a>

### MathJsonSymbol

```ts
type MathJsonSymbol: Object & Attributes;
```

#### Type declaration

<MemberCard>

##### MathJsonSymbol.sym

```ts
sym: MathJsonIdentifier;
```

</MemberCard>

<a id="mathjsonstring" name="mathjsonstring"></a>

### MathJsonString

```ts
type MathJsonString: Object & Attributes;
```

#### Type declaration

<MemberCard>

##### MathJsonString.str

```ts
str: string;
```

</MemberCard>

<a id="mathjsonfunction" name="mathjsonfunction"></a>

### MathJsonFunction

```ts
type MathJsonFunction: Object & Attributes;
```

#### Type declaration

<MemberCard>

##### MathJsonFunction.fn

```ts
fn: [MathJsonIdentifier | MathJsonFunction, ...Expression[]];
```

</MemberCard>

<a id="mathjsondictionary" name="mathjsondictionary"></a>

### MathJsonDictionary

```ts
type MathJsonDictionary: Object & Attributes;
```

#### Type declaration

<MemberCard>

##### MathJsonDictionary.dict

```ts
dict: Object;
```

###### Index signature

 \[`key`: `string`\]: [`Expression`](#expression)

</MemberCard>

<a id="expression" name="expression"></a>

### Expression

```ts
type Expression: 
  | number
  | MathJsonIdentifier
  | string
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  | MathJsonFunction
  | MathJsonDictionary
  | [MathJsonIdentifier | MathJsonFunction, ...Expression[]];
```

A MathJSON expression is a recursive data structure.

The leaf nodes of an expression are numbers, strings and symbols.
The dictionary and function nodes can contain expressions themselves.


<a name="readmemd"></a>

## Modules

- ["common"](%22common%22.md)
- ["compute-engine"](%22compute-engine%22.md)
- ["math-json"](%22math-json%22.md)
