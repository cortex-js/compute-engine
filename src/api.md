

## Rules

<a id="isrulestep" name="isrulestep"></a>

<MemberCard>

### isRuleStep()

```ts
function isRuleStep(x): x is RuleStep
```

##### x

`any`

</MemberCard>

<a id="isboxedrule" name="isboxedrule"></a>

<MemberCard>

### isBoxedRule()

```ts
function isBoxedRule(x): x is BoxedRule
```

##### x

`any`

</MemberCard>

## Latex Parsing and Serialization

<a id="latexstring" name="latexstring"></a>

<MemberCard>

### LatexString

```ts
type LatexString = string;
```

A LatexString is a regular string of LaTeX, for example:
`\frac{\pi}{2}`

</MemberCard>

<a id="delimiterscale" name="delimiterscale"></a>

<MemberCard>

### DelimiterScale

```ts
type DelimiterScale = "normal" | "scaled" | "big" | "none";
```

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

## Numerics

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

## Serialization

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

<a id="maketensorfield" name="maketensorfield"></a>

<MemberCard>

### makeTensorField()

```ts
function makeTensorField<DT>(ce, dtype): TensorField<DataTypeMap[DT]>
```

• DT extends keyof `DataTypeMap`

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

keyof `DataTypeMap`

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

<a id="tensorfieldt_add-5" name="tensorfieldt_add-5"></a>

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

<a id="tensorfieldt_neg-4" name="tensorfieldt_neg-4"></a>

<MemberCard>

##### TensorField.neg()

```ts
neg(x): T
```

####### x

`T`

</MemberCard>

<a id="tensorfieldt_sub-4" name="tensorfieldt_sub-4"></a>

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

<a id="tensorfieldt_mul-4" name="tensorfieldt_mul-4"></a>

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

<a id="tensorfieldt_div-4" name="tensorfieldt_div-4"></a>

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

<a id="tensorfieldt_pow-4" name="tensorfieldt_pow-4"></a>

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

`BoxedExpression`

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`BoxedExpression`

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`BoxedExpression`

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number
```

####### x

`BoxedExpression`

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`BoxedExpression`

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): any
```

####### x

`BoxedExpression`

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean
```

####### x

`BoxedExpression`

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string
```

####### x

`BoxedExpression`

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression
```

####### x

`BoxedExpression`

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`BoxedExpression`[]

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`BoxedExpression`[]

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`BoxedExpression`[]

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[]
```

####### x

`BoxedExpression`[]

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`BoxedExpression`[]

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[]
```

####### x

`BoxedExpression`[]

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[]
```

####### x

`BoxedExpression`[]

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): string[]
```

####### x

`BoxedExpression`[]

####### dtype

`"string"`

###### cast(x, dtype)

```ts
cast(x, dtype): BoxedExpression[]
```

####### x

`BoxedExpression`[]

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

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_iszero-2" name="tensorfieldexpression_iszero-2"></a>

<MemberCard>

##### TensorFieldExpression.isZero()

```ts
isZero(x): boolean
```

####### x

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_isone-2" name="tensorfieldexpression_isone-2"></a>

<MemberCard>

##### TensorFieldExpression.isOne()

```ts
isOne(x): boolean
```

####### x

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_equals-1" name="tensorfieldexpression_equals-1"></a>

<MemberCard>

##### TensorFieldExpression.equals()

```ts
equals(lhs, rhs): boolean
```

####### lhs

`BoxedExpression`

####### rhs

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_add-2" name="tensorfieldexpression_add-2"></a>

<MemberCard>

##### TensorFieldExpression.add()

```ts
add(lhs, rhs): BoxedExpression
```

####### lhs

`BoxedExpression`

####### rhs

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_addn-1" name="tensorfieldexpression_addn-1"></a>

<MemberCard>

##### TensorFieldExpression.addn()

```ts
addn(...xs): BoxedExpression
```

####### xs

...`BoxedExpression`[]

</MemberCard>

<a id="tensorfieldexpression_neg-2" name="tensorfieldexpression_neg-2"></a>

<MemberCard>

##### TensorFieldExpression.neg()

```ts
neg(x): BoxedExpression
```

####### x

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_sub-2" name="tensorfieldexpression_sub-2"></a>

<MemberCard>

##### TensorFieldExpression.sub()

```ts
sub(lhs, rhs): BoxedExpression
```

####### lhs

`BoxedExpression`

####### rhs

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_mul-2" name="tensorfieldexpression_mul-2"></a>

<MemberCard>

##### TensorFieldExpression.mul()

```ts
mul(lhs, rhs): BoxedExpression
```

####### lhs

`BoxedExpression`

####### rhs

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_muln-1" name="tensorfieldexpression_muln-1"></a>

<MemberCard>

##### TensorFieldExpression.muln()

```ts
muln(...xs): BoxedExpression
```

####### xs

...`BoxedExpression`[]

</MemberCard>

<a id="tensorfieldexpression_div-2" name="tensorfieldexpression_div-2"></a>

<MemberCard>

##### TensorFieldExpression.div()

```ts
div(lhs, rhs): BoxedExpression
```

####### lhs

`BoxedExpression`

####### rhs

`BoxedExpression`

</MemberCard>

<a id="tensorfieldexpression_pow-2" name="tensorfieldexpression_pow-2"></a>

<MemberCard>

##### TensorFieldExpression.pow()

```ts
pow(lhs, rhs): BoxedExpression
```

####### lhs

`BoxedExpression`

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

`BoxedExpression`

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

`TensorData`\<`DT`\>

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

• T1 extends keyof `DataTypeMap`

• T2 extends keyof `DataTypeMap`

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

• T1 extends keyof `DataTypeMap`

• T2 extends keyof `DataTypeMap`

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

• T extends keyof `DataTypeMap`

####### fn

(`lhs`, `rhs`) => `DataTypeMap`\[`T`\]

####### lhs

[`AbstractTensor`](#abstracttensordt)\<`T`\>

####### rhs

`DataTypeMap`\[`T`\] | [`AbstractTensor`](#abstracttensordt)\<`T`\>

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

• DT extends keyof `DataTypeMap`

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

(`v`) => `DataTypeMap`\[`DT`\]

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

(`lhs`, `rhs`) => `DataTypeMap`\[`DT`\]

####### scalar

`DataTypeMap`\[`DT`\]

</MemberCard>

<a id="abstracttensordt_map2" name="abstracttensordt_map2"></a>

<MemberCard>

##### AbstractTensor.map2()

```ts
map2(fn, rhs): AbstractTensor<DT>
```

####### fn

(`lhs`, `rhs`) => `DataTypeMap`\[`DT`\]

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

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | `DataTypeMap`\[`DT`\]

</MemberCard>

<a id="abstracttensordt_subtract" name="abstracttensordt_subtract"></a>

<MemberCard>

##### AbstractTensor.subtract()

```ts
subtract(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | `DataTypeMap`\[`DT`\]

</MemberCard>

<a id="abstracttensordt_multiply" name="abstracttensordt_multiply"></a>

<MemberCard>

##### AbstractTensor.multiply()

```ts
multiply(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | `DataTypeMap`\[`DT`\]

</MemberCard>

<a id="abstracttensordt_divide" name="abstracttensordt_divide"></a>

<MemberCard>

##### AbstractTensor.divide()

```ts
divide(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | `DataTypeMap`\[`DT`\]

</MemberCard>

<a id="abstracttensordt_power" name="abstracttensordt_power"></a>

<MemberCard>

##### AbstractTensor.power()

```ts
power(rhs): AbstractTensor<DT>
```

####### rhs

[`AbstractTensor`](#abstracttensordt)\<`DT`\> | `DataTypeMap`\[`DT`\]

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

• T extends keyof `DataTypeMap`

##### ce

`ComputeEngine`

##### data

`TensorData`\<`T`\> | \{
`operator`: `string`;
`ops`: `BoxedExpression`[];
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
