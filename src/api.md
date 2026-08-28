

## Compute Engine

<MemberCard>

### AngularUnit {#angularunit}

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

<MemberCard>

### AssignValue {#assignvalue}

```ts
type AssignValue = KernelAssignValue<Expression, ExpressionInput, IComputeEngine>;
```

Assignable value for `ce.assign()`.

</MemberCard>

### ~~ExpressionComputeEngine~~ {#expressioncomputeengine}

Compute engine surface used by expression types.

This interface is augmented by `types-engine.ts` with the concrete
`IComputeEngine` members to avoid type-layer circular dependencies.

#### Deprecated

Use `ComputeEngine` (the type exported from the package entry
points) or `IComputeEngine` instead — the three are interchangeable, and
this alias will be removed in a future release.

#### Extends

- [`IComputeEngine`](#icomputeengine)

<MemberCard>

##### ExpressionComputeEngine.~~latexSyntax~~ {#latexsyntax-1}

```ts
readonly latexSyntax: ILatexSyntax | undefined;
```

The LatexSyntax instance used for LaTeX parsing/serialization.
 `undefined` when no LatexSyntax was provided to the constructor.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~latexOptions~~ {#latexoptions-1}

```ts
latexOptions: Partial<ParseLatexOptions & SerializeLatexOptions>;
```

Engine-wide LaTeX parse/serialize options (e.g. `decimalSeparator`).
 Merged into every `parse()` and `toLatex()` call between LatexSyntax
 defaults and per-call overrides.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~True~~ {#true-1}

```ts
readonly True: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~False~~ {#false-1}

```ts
readonly False: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~Pi~~ {#pi-1}

```ts
readonly Pi: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~E~~ {#e-1}

```ts
readonly E: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~Nothing~~ {#nothing-1}

```ts
readonly Nothing: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~Missing~~ {#missing-1}

```ts
readonly Missing: Expression;
```

The `Missing` symbol: an absent value whose position is preserved.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~Zero~~ {#zero-1}

```ts
readonly Zero: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~One~~ {#one-1}

```ts
readonly One: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~Half~~ {#half-1}

```ts
readonly Half: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~NegativeOne~~ {#negativeone-1}

```ts
readonly NegativeOne: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~Two~~ {#two-1}

```ts
readonly Two: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~I~~ {#i-1}

```ts
readonly I: Expression;
```

ImaginaryUnit

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~NaN~~ {#nan-2}

```ts
readonly NaN: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~PositiveInfinity~~ {#positiveinfinity-2}

```ts
readonly PositiveInfinity: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~NegativeInfinity~~ {#negativeinfinity-2}

```ts
readonly NegativeInfinity: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~ComplexInfinity~~ {#complexinfinity-1}

```ts
readonly ComplexInfinity: Expression;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~context~~ {#context-1}

```ts
readonly context: EvalContext;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~contextStack~~ {#contextstack-1}

```ts
contextStack: readonly EvalContext[];
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~iterationLimit~~ {#iterationlimit-1}

```ts
iterationLimit: number;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~recursionLimit~~ {#recursionlimit-1}

```ts
recursionLimit: number;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~maxCollectionSize~~ {#maxcollectionsize-1}

```ts
maxCollectionSize: number;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~bignum~~ {#bignum-2}

```ts
bignum: (a) => BigDecimal;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~complex~~ {#complex-2}

```ts
complex: (a, b?) => Complex;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~tolerance~~ {#tolerance-1}

```ts
tolerance: number;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~angularUnit~~ {#angularunit-2}

```ts
angularUnit: AngularUnit;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~costFunction~~ {#costfunction-2}

```ts
costFunction: (expr) => number;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~simplificationRules~~ {#simplificationrules-1}

```ts
simplificationRules: Rule[];
```

The rules used by `.simplify()` when no explicit `rules` option is passed.
 Initialized to the built-in simplification rules.
 Users can `push()` additional rules or replace the entire array.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~solveRules~~ {#solverules-1}

```ts
solveRules: Rule[];
```

The rules used by `solve()` to find roots of univariate expressions.
 Each rule matches a normalized equation `f(_x) = 0` — the unknown is
 the wildcard `_x` — and `replace` produces a root expression.
 Conditions should reject matches where other wildcards capture `_x`.
 Candidate roots are validated against the original equation, so an
 over-eager template degrades to a no-op rather than a wrong answer.
 Initialized to the built-in root-finding rules; `push()` to extend,
 assign to replace.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~harmonizationRules~~ {#harmonizationrules-1}

```ts
harmonizationRules: Rule[];
```

The rules used by `solve()` to transform an equation into equivalent,
 easier-to-solve forms before root-finding (e.g. `ln f(x) → f(x) - 1`).
 Same conventions and extension pattern as `solveRules`.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~strict~~ {#strict-1}

```ts
strict: boolean;
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~jit~~ {#jit-1}

```ts
jit: "auto" | "off";
```

Whether the engine may implicitly generate and execute compiled code as
a performance optimization (auto-compiled `Map` drains, compiled numeric
quadrature/limit kernels). `'auto'` (default) attempts implicit
compilation and latches to `'off'` engine-wide on the first CSP
`EvalError`; `'off'` never attempts it. Explicit `compile()` is exempt.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~trace~~ {#trace-1}

```ts
trace: readonly string[];
```

A list of the function calls to the current evaluation context

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~precision~~ {#precision-1}

```ts
get precision(): number
set precision(p: number | "auto" | "machine"): void
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~checkpoint()~~ {#checkpoint-1}

```ts
checkpoint(label?): EngineCheckpoint
```

Take a checkpoint of the engine's state at a quiescent point — between
statements, at any scope depth — so a later [restore](#restore) can rewind
to it. Legal on a freshly constructed engine, which is how a client gets
a `cp[0]` covering an edit of the first cell, and inside a host-pushed
scope, which is how a notebook takes per-cell checkpoints within a pass.
A checkpoint taken inside a scope dies when that scope pops. Throws a
`CheckpointError` when the engine is mid-evaluation or mid-pre-pass;
[restore](#restore) additionally requires the same scope stack the
checkpoint was taken on.

####### label?

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~restore()~~ {#restore-1}

```ts
restore(cp): void
```

Rewind to `cp`, invalidating every checkpoint taken after it; `cp` itself
stays live and can be restored again. Expressions built BEFORE `cp` stay
valid — their definitions are rewritten in place. Expressions built
during the rewound window are not: cache cell outputs as serialized
artifacts, never as live boxed nodes.

####### cp

[`EngineCheckpoint`](#enginecheckpoint)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~discard()~~ {#discard-1}

```ts
discard(cp): void
```

Release `cp`'s restore capability. Restoring past a discarded INTERIOR
checkpoint stays possible through any earlier live one; discarding the
OLDEST makes the state before the next-younger one unreachable.

####### cp

[`EngineCheckpoint`](#enginecheckpoint)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~declareProtocol()~~ {#declareprotocol-1}

```ts
declareProtocol(name, members): void
```

Declare a protocol (Appendix A "Host API"). Throws on error, including
on re-declaration — the Epsil statement route replaces instead (P5).

####### name

`string`

####### members

[`ProtocolMembersInput`](#protocolmembersinput)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~declareProtocolImplementation()~~ {#declareprotocolimplementation-1}

```ts
declareProtocolImplementation(
   type, 
   protocol, 
   impl, 
   options?): void
```

Implement `protocol` for `type`, declaring the conformance edge if it is
not already registered (Appendix A "Host API").

THROWS on every error — the host channel; the Epsil statement route
returns error VALUES instead. A second host implementation of the same
(type, protocol) pair throws rather than replacing (P5).

The callbacks are JavaScript functions, so they carry no signature the
engine can check: they are trusted like host-declared operator handlers,
and only member-name coverage, unknown members and a `set` handler on a
`readonly` property are validated.

`options.where` declares a CONDITIONAL conformance: `type` is then a HEAD
PATTERN naming the variables (`'list<T>'`) and `where` is the clause SOURCE
that binds them (`'where T is Comparable'`; the `where` word may be
omitted). A malformed clause, or a head variable the clause does not bind,
throws.

####### type

`string`

####### protocol

`string`

####### impl

[`ProtocolImplementationInput`](#protocolimplementationinput)

####### options?

####### where?

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~withTimeLimit()~~ {#withtimelimit-1}

```ts
withTimeLimit<T>(limit, fn): T
```

Run `fn` with at most `ms` milliseconds (numeric form) or `limit.ms`
(object form, which also accepts an attribution `label`). A tighter
enclosing span preempts this limit; use the label and
`CancellationError.attribution`/`spans` to tell which limit fired.

**⚠️ `fn` MUST be synchronous.** The span is restored in a synchronous
`finally`, so a `Promise`-returning (`async`) callback hands control back
at its first `await` while the span is still open: work that resumes after
that point runs **outside** the deadline and is never cancelled (see
`docs/TIMEOUT-MODEL.md` §6.4). For asynchronous cancellation use
`expr.evaluateAsync({ signal })` with an `AbortSignal` instead.

• T

####### limit

  \| `number`
  \| \{
  `ms`: `number`;
  `label`: `string`;
 \}

####### fn

() => `T` *extends* `Promise`\<`unknown`\> ? `never` : `T`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~chop()~~ {#chop-1}

###### chop(n)

```ts
chop(n): number
```

####### n

`number`

###### chop(n)

```ts
chop(n): 0 | BigDecimal
```

####### n

`BigDecimal`

###### chop(n)

```ts
chop(n): number | BigDecimal
```

####### n

`number` \| `BigDecimal`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~expr()~~ {#expr-3}

```ts
expr(expr, options?): Expression
```

####### expr

  \| [`NumericValue`](#abstract-numericvalue)
  \| [`ExpressionInput`](#expressioninput)

####### options?

####### form?

[`FormOption`](#formoption)

####### scope?

`Scope`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~box()~~ {#box-1}

```ts
box(expr, options?): Expression
```

####### expr

  \| [`NumericValue`](#abstract-numericvalue)
  \| [`ExpressionInput`](#expressioninput)

####### options?

####### form?

[`FormOption`](#formoption)

####### scope?

`Scope`

###### Deprecated

Use `expr()` instead.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~parse()~~ {#parse-2}

###### parse(latex, options)

```ts
parse(latex, options?): Expression
```

Parse a LaTeX string and return a boxed expression.

This is a convenience method equivalent to `ce.expr(parse(latex))`,
but uses the engine's symbol definitions for better parsing accuracy.

`options.scope` RECEIVES the parse's writes: the whole parse runs with
that scope as the current lexical scope, so name resolution (including
the parser's symbol oracle) walks `scope → parents`, and every
auto-declare and inference lands rooted there. Discarding the scope
discards the writes. Use `ce.createScope()` to make one that can be read
back.

`options.speculative` leaves NO trace in the engine's type state: the
parse runs inside a transient scope (auto-declares land there and are
discarded with it), and every ambient symbol whose type is currently
inferred is shadowed in that scope with its current type — so a
narrowing use in `latex` refines the discarded shadow instead of
persistently narrowing the ambient symbol. Use it for derive-style
parses that only READ the result (its type, structure, or
serialization): the result's bindings refer to the discarded scope, so
do not retain, evaluate, or compare it against later expressions.
Mutually exclusive with `scope`.

####### latex

`string`

####### options?

`Partial`\<[`ParseLatexOptions`](#parselatexoptions)\> & \{
  `form`: [`FormOption`](#formoption);
  `scope`: `Scope`;
  `speculative`: `boolean`;
 \}

###### parse(latex, options)

```ts
parse(latex, options?): Expression | null
```

####### latex

`string` \| `null`

####### options?

`Partial`\<[`ParseLatexOptions`](#parselatexoptions)\> & \{
  `form`: [`FormOption`](#formoption);
  `scope`: `Scope`;
  `speculative`: `boolean`;
 \}

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~appliedNonFunctions()~~ {#appliednonfunctions-1}

```ts
appliedNonFunctions(latex): string[]
```

The symbols that appear in function-application syntax `f(…)` in `latex`
but are not defined as functions in the current scope (so they parse as
implicit multiplication or are left unresolved). Scope-aware and
side-effect-free. Intended to flag calls to undefined functions in tools
such as notebooks; intersect with [Expression.freeVariables](#freevariables)
to drop deliberate multiplication of defined values.

Only parenthesized-group application is detected: a symbol juxtaposed
with a matrix environment (`\mathrm{Eigenvalues}\begin{pmatrix}…`) is
not reported, since a matrix never reaches the symbol-with-delimiter
juxtaposition analysis.

####### latex

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~function()~~ {#function-1}

```ts
function(name, ops, options?): Expression
```

####### name

`string`

####### ops

readonly [`ExpressionInput`](#expressioninput)[]

####### options?

####### metadata?

[`Metadata`](#metadata-1)

####### form?

[`FormOption`](#formoption)

####### scope?

`Scope`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~\_getCompilationTarget()~~ {#_getcompilationtarget-1}

###### \_getCompilationTarget(name)

```ts
_getCompilationTarget(name): 
  | JavaScriptCompilationTarget<Expression>
  | undefined
```

####### name

`"javascript"`

###### \_getCompilationTarget(name)

```ts
_getCompilationTarget(name): 
  | LanguageTarget<Expression, string, unknown, number>
  | undefined
```

####### name

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~number()~~ {#number-2}

```ts
number(value, options?): Expression
```

####### value

  \| `string`
  \| `number`
  \| `bigint`
  \| [`MathJsonNumberObject`](#mathjsonnumberobject)
  \| `BigDecimal`
  \| [`Rational`](#rational-1)
  \| [`NumericValue`](#abstract-numericvalue)
  \| `Complex`

####### options?

####### metadata?

[`Metadata`](#metadata-1)

####### canonical?

[`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~symbol()~~ {#symbol-1}

```ts
symbol(sym, options?): Expression
```

####### sym

`string`

####### options?

####### canonical?

[`CanonicalOptions`](#canonicaloptions)

####### metadata?

[`Metadata`](#metadata-1)

####### autoDeclare?

`boolean`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~string()~~ {#string-2}

```ts
string(s, metadata?): Expression
```

####### s

`string`

####### metadata?

[`Metadata`](#metadata-1)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~character()~~ {#character-2}

```ts
character(s, metadata?): Expression
```

Create a boxed character — one user-perceived character.

`s` must be exactly one grapheme cluster after NFC normalization; use the
`CharacterFrom` operator when the content is not known to satisfy that, as
it reports a diagnostic instead.

####### s

`string`

####### metadata?

[`Metadata`](#metadata-1)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~error()~~ {#error-2}

```ts
error(message, where?): Expression
```

####### message

`string` \| `string`[]

####### where?

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~typeError()~~ {#typeerror-1}

```ts
typeError(expectedType, actualType, where?): Expression
```

####### expectedType

[`Type`](#type-3)

####### actualType

  \| [`Type`](#type-3)
  \| [`BoxedType`](#boxedtype)
  \| `undefined`

####### where?

[`ExpressionInput`](#expressioninput)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~hold()~~ {#hold-1}

```ts
hold(expr): Expression
```

####### expr

[`ExpressionInput`](#expressioninput)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~tuple()~~ {#tuple-1}

###### tuple(elements)

```ts
tuple(...elements): Expression
```

####### elements

...readonly `number`[]

###### tuple(elements)

```ts
tuple(...elements): Expression
```

####### elements

...readonly [`Expression`](#expression-5)[]

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~type()~~ {#type-11}

```ts
type(type): BoxedType
```

####### type

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~rules()~~ {#rules-2}

```ts
rules(rules, options?): BoxedRuleSet
```

####### rules

`Rule` \| readonly Rule \| BoxedRule[] \| `BoxedRuleSet` \| `null` \| `undefined`

####### options?

####### canonical?

`boolean`

####### purpose?

[`RulePurpose`](#rulepurpose)

Default purpose applied to any rule in the set that doesn't carry
 its own `purpose` tag (a per-rule tag takes precedence).

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~getRuleSet()~~ {#getruleset-1}

```ts
getRuleSet(id?): BoxedRuleSet | undefined
```

####### id?

`"harmonization"` \| `"solve-univariate"` \| `"standard-simplification"`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~pushScope()~~ {#pushscope-1}

```ts
pushScope(scope?, name?): void
```

####### scope?

`Scope`

####### name?

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~popScope()~~ {#popscope-1}

```ts
popScope(): void
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~createScope()~~ {#createscope-1}

```ts
createScope(bindings?, parent?): InspectableScope
```

####### bindings?

`Record`\<`string`, 
  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`TaggedValueDefinition`](#taggedvaluedefinition)
  \| [`TaggedOperatorDefinition`](#taggedoperatordefinition)\>

####### parent?

`Scope`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~lookupDefinition()~~ {#lookupdefinition-2}

```ts
lookupDefinition(id): BoxedDefinition | undefined
```

####### id

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~assign()~~ {#assign-1}

###### assign(ids)

```ts
assign(ids): IComputeEngine
```

####### ids

###### assign(id, value)

```ts
assign(id, value): IComputeEngine
```

####### id

`string`

####### value

`AssignValue`

###### assign(arg1, arg2)

```ts
assign(arg1, arg2?): IComputeEngine
```

####### arg1

`string` \| \{\}

####### arg2?

`AssignValue`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~declareType()~~ {#declaretype-1}

```ts
declareType(name, type, options?): void
```

####### name

`string`

####### type

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

####### options?

####### alias?

`boolean`

####### fromStatement?

`boolean`

####### mint?

`boolean`

####### typeParams?

[`TypeParamsOption`](#typeparamsoption)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~declare()~~ {#declare-1}

###### declare(symbols)

```ts
declare(symbols): IComputeEngine
```

####### symbols

###### declare(id, def, scope)

```ts
declare(id, def, scope?): IComputeEngine
```

####### id

`string`

####### def

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| `Partial`\<`OnlyFirst`\<[`ValueDefinition`](#valuedefinition), [`BaseDefinition`](#basedefinition) & \{
  `holdUntil`: `"never"` \| `"evaluate"` \| `"N"`;
  `type`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferred`: `boolean`;
  `effectsDeclared`: `boolean`;
  `value`: ExpressionInput \| ((ce: ComputeEngine) =\> Expression \| null);
  `eq`: (`a`) => `boolean` \| `undefined`;
  `neq`: (`a`) => `boolean` \| `undefined`;
  `cmp`: (`a`) => `"<"` \| `">"` \| `"="` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `subscriptEvaluate`: (`subscript`, `options`) => [`Expression`](#expression-5) \| `undefined`;
 \} & [`OperatorDefinition`](#operatordefinition)\>\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"expressions"`;
  `type`: [`OperatorTypeHandlerOnExpressions`](#operatortypehandleronexpressions);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"types"`;
  `type`: [`OperatorTypeHandlerOnTypes`](#operatortypehandlerontypes);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>

####### scope?

`Scope`

###### declare(arg1, arg2, arg3)

```ts
declare(arg1, arg2?, arg3?): IComputeEngine
```

####### arg1

`string` \| \{\}

####### arg2?

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| `Partial`\<`OnlyFirst`\<[`ValueDefinition`](#valuedefinition), [`BaseDefinition`](#basedefinition) & \{
  `holdUntil`: `"never"` \| `"evaluate"` \| `"N"`;
  `type`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferred`: `boolean`;
  `effectsDeclared`: `boolean`;
  `value`: ExpressionInput \| ((ce: ComputeEngine) =\> Expression \| null);
  `eq`: (`a`) => `boolean` \| `undefined`;
  `neq`: (`a`) => `boolean` \| `undefined`;
  `cmp`: (`a`) => `"<"` \| `">"` \| `"="` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `subscriptEvaluate`: (`subscript`, `options`) => [`Expression`](#expression-5) \| `undefined`;
 \} & [`OperatorDefinition`](#operatordefinition)\>\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"expressions"`;
  `type`: [`OperatorTypeHandlerOnExpressions`](#operatortypehandleronexpressions);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"types"`;
  `type`: [`OperatorTypeHandlerOnTypes`](#operatortypehandlerontypes);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>

####### arg3?

`Scope`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~assume()~~ {#assume-1}

```ts
assume(predicate): AssumeResult
```

####### predicate

`string` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~declareSequence()~~ {#declaresequence-1}

```ts
declareSequence(name, def): IComputeEngine
```

Declare a sequence with a recurrence relation.

####### name

`string`

####### def

[`SequenceDefinition`](#sequencedefinition)

###### Example

```typescript
// Fibonacci sequence
ce.declareSequence('F', {
  base: { 0: 0, 1: 1 },
  recurrence: 'F_{n-1} + F_{n-2}',
});
ce.parse('F_{10}').evaluate();  // → 55
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~getSequenceStatus()~~ {#getsequencestatus-1}

```ts
getSequenceStatus(name): SequenceStatus
```

Get the status of a sequence definition.

####### name

`string`

###### Example

```typescript
ce.parse('F_0 := 0').evaluate();
ce.getSequenceStatus('F');
// → { status: 'pending', hasBase: true, hasRecurrence: false, baseIndices: [0] }
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~getSequence()~~ {#getsequence-1}

```ts
getSequence(name): SequenceInfo | undefined
```

Get information about a defined sequence.
Returns `undefined` if the symbol is not a sequence.

####### name

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~listSequences()~~ {#listsequences-1}

```ts
listSequences(): string[]
```

List all defined sequences.
Returns an array of sequence names.

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~isSequence()~~ {#issequence-1}

```ts
isSequence(name): boolean
```

Check if a symbol is a defined sequence.

####### name

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~clearSequenceCache()~~ {#clearsequencecache-1}

```ts
clearSequenceCache(name?): void
```

Clear the memoization cache for a sequence.
If no name is provided, clears caches for all sequences.

####### name?

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~getSequenceCache()~~ {#getsequencecache-1}

```ts
getSequenceCache(name): 
  | Map<string | number, Expression>
  | undefined
```

Get the memoization cache for a sequence.
Returns a Map of index → value, or `undefined` if not a sequence or memoization is disabled.

For single-index sequences, keys are numbers.
For multi-index sequences, keys are comma-separated strings (e.g., '5,2').

####### name

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~getSequenceTerms()~~ {#getsequenceterms-1}

```ts
getSequenceTerms(
   name, 
   start, 
   end, 
   step?): Expression[] | undefined
```

Generate a list of sequence terms from start to end (inclusive).

####### name

`string`

The sequence name

####### start

`number`

Starting index (inclusive)

####### end

`number`

Ending index (inclusive)

####### step?

`number`

Step size (default: 1)

###### Example

```typescript
ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
ce.getSequenceTerms('F', 0, 10);
// → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~lookupOEIS()~~ {#lookupoeis-1}

```ts
lookupOEIS(terms, options?): Promise<OEISSequenceInfo[]>
```

Look up sequences in OEIS by their terms.

####### terms

(`number` \| [`Expression`](#expression-5))[]

Array of sequence terms to search for

####### options?

[`OEISOptions`](#oeisoptions)

Optional configuration (timeout, maxResults)

###### Example

```typescript
const results = await ce.lookupOEIS([0, 1, 1, 2, 3, 5, 8, 13]);
// → [{ id: 'A000045', name: 'Fibonacci numbers', ... }]
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~checkSequenceOEIS()~~ {#checksequenceoeis-1}

```ts
checkSequenceOEIS(name, count?, options?): Promise<{
  matches: OEISSequenceInfo[];
  terms: number[];
}>
```

Check if a defined sequence matches an OEIS sequence.

####### name

`string`

Name of the defined sequence

####### count?

`number`

Number of terms to check (default: 10)

####### options?

[`OEISOptions`](#oeisoptions)

Optional configuration

###### Example

```typescript
ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
const result = await ce.checkSequenceOEIS('F', 10);
// → { matches: [{ id: 'A000045', name: 'Fibonacci numbers', ... }], terms: [0, 1, 1, ...] }
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~interpret()~~ {#interpret-1}

```ts
interpret(expr, options?): Promise<InterpretResult>
```

Interpret a notational expression, then propose OEIS-attributed closed
forms for it (the async v4 of the `Interpret` ladder).

`result.expression` is exactly what the synchronous `Interpret` head
returns (a `Sum`/`Product`, or the input unchanged); `result.candidates`
are OEIS-attributed closed forms, each verified to reproduce every
extracted sample exactly. This is the only interpretation path that
performs a network lookup. Too few samples, being offline, a timeout, or an
empty result all yield an empty candidate list rather than a rejection.

####### expr

[`Expression`](#expression-5)

The (typically inert, continuation-bearing) expression

####### options?

[`OEISOptions`](#oeisoptions)

OEIS request options (timeout, maxResults)

###### Example

```typescript
const { expression, candidates } = await ce.interpret(
  ce.parse('1 + 3 + 6 + 10 + \\cdots + n')
);
```

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~forget()~~ {#forget-1}

```ts
forget(symbol?): void
```

####### symbol?

`string` \| `string`[]

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~ask()~~ {#ask-1}

```ts
ask(pattern): BoxedSubstitution[]
```

####### pattern

[`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~verify()~~ {#verify-1}

```ts
verify(query): boolean | undefined
```

####### query

`string` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~operatorInfo()~~ {#operatorinfo-2}

```ts
operatorInfo(head): OperatorInfo | undefined
```

Introspect a registered operator head.

Returns `undefined` if no definition is registered in this engine.
Otherwise returns `{ kind, signature? }` where `kind` is `'function'`
when the operator has an `evaluate` or `collection` handler, and
`'opaque'` when it is declared as a typed-but-opaque node (e.g.,
`Triangle`, `Sphere`).

Use this to classify heads encountered in parsed MathJSON without
maintaining a parallel list of "known" operators.

####### head

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~normalizeIdentifier()~~ {#normalizeidentifier-1}

```ts
normalizeIdentifier(latex): string
```

Convert a LaTeX identifier string to its canonical MathJSON name without
declaring the symbol in the engine scope.

Examples:
- `'R_{3}'` → `'R_3'`
- `'\\theta_x'` → `'theta_x'`
- `'\\alpha'` → `'alpha'`
- `'1 + 2'` → `''` (not an identifier)

Use this instead of `ce.parse(latex).symbol` when you need the canonical
name without the side-effect of auto-declaring the symbol.

####### latex

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~symbolInfo()~~ {#symbolinfo-2}

```ts
symbolInfo(name): SymbolInfo | undefined
```

Return introspection metadata for a symbol (value definition) in the
current scope chain.

- `kind: 'constant'` when the symbol is a CE-registered constant
  (e.g. `Pi`, `True`, `ExponentialE`).
- `kind: 'variable'` for declared but non-constant value symbols
  (e.g. after `ce.declare('a', 'real')`).

Returns `undefined` for unknown names and for names that resolve to
operator/function definitions (use `operatorInfo()` for those — the
two methods are non-overlapping).

####### name

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~searchDefinitions()~~ {#searchdefinitions-1}

```ts
searchDefinitions(query, options?): DefinitionSearchResult[]
```

Reverse library search: map plain-text concept keywords to a ranked list
of matching identifiers in the current scope chain (standard library plus
any user declarations).

The query is a string (tokenized on whitespace) or an array of strings;
tokens are OR-ed — a definition matches when **any** token matches — and
definitions matching more tokens, or matching them more exactly, rank
higher.

Every returned `id` resolves via `ce.lookupDefinition(id)`; chain that
call for full detail.

####### query

`string` \| `string`[]

####### options?

####### limit?

`number`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~suggestOperatorName()~~ {#suggestoperatorname-1}

```ts
suggestOperatorName(name): string | undefined
```

Given a `name` that is **not** a known operator, return the closest known
operator name — a "did you mean" suggestion — or `undefined` when nothing
is close enough. Powers the Epsil `unknown-function` diagnostic.

Matching is conservative and applied in priority order (first match wins):
case-insensitive exact match, singular/plural, Damerau–Levenshtein
distance (≤ 2 for names of length ≥ 6, ≤ 1 for length 5, never for
shorter names), then a prefix match against exactly one operator. Ties
prefer the candidate sharing the longest prefix with the query.

```ts
ce.suggestOperatorName('Quartile'); // → 'Quartiles'
ce.suggestOperatorName('foo');      // → undefined
```

####### name

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~functionProperties()~~ {#functionproperties-2}

```ts
functionProperties(name): FunctionProperties | undefined
```

Return the known analytic properties of an operator — poles, zeros, branch
points/cuts, residues, holomorphic/meromorphic domains — drawn from the
Fungrim-derived metadata store, or `undefined` if none are recorded.

```ts
ce.functionProperties('Gamma')?.poles?.toString(); // 'NonPositiveIntegers'
```

The set-valued accessors (`poles`, `zeros`, ...) return a boxed set for the
unconditional record of that kind; parametric / conditional records (e.g.
residues that depend on parameters) are available via `entries`.

####### name

`string`

</MemberCard>

<MemberCard>

##### ExpressionComputeEngine.~~toJSON()~~ {#tojson-3}

```ts
toJSON(): string
```

Debug representation, e.g. for `JSON.stringify()`.

</MemberCard>

## Boxed Expression

<MemberCard>

### SimplifyOptions {#simplifyoptions}

```ts
type SimplifyOptions = {
  rules: null | Rule | ReadonlyArray<BoxedRule | Rule> | BoxedRuleSet;
  costFunction: (expr) => number;
  strategy: "default" | "fu" | "trig";
};
```

Options for `Expression.simplify()`

</MemberCard>

<MemberCard>

### ExplainOptions {#explainoptions}

```ts
type ExplainOptions = SimplifyOptions & {
  verbosity: ExplainVerbosity;
  variable: string | string[];
  order: number;
};
```

Options for `Expression.explain()`

In addition to the `SimplifyOptions` (honored when explaining a
`'simplify'` operation, so that `explain('simplify', options).result`
matches `simplify(options)`):

- `verbosity`: `'default'` returns the curated step chain (bookkeeping
  steps filtered out); `'all'` returns the raw, uncurated chain.
- `variable`: the unknown, for the `'solve'` and `'D'` operations. For a
  system of equations (`explain('solve')` on a `List`/`And`), pass the
  unknowns as an array, in order.
- `order`: for the `'D'` operation only, the order of the derivative to
  explain (the n-th derivative with respect to `variable`). Defaults to `1`.
  Ignored when the receiver is already a `D(…)` expression (which encodes
  its own differentiation sequence).

</MemberCard>

<MemberCard>

### EvaluateOptions {#evaluateoptions}

```ts
type EvaluateOptions = KernelEvaluateOptions;
```

Options for evaluating boxed expressions.

This is the compute-engine-specialized form of the generic kernel type.

</MemberCard>

<MemberCard>

### IntervalBounds {#intervalbounds}

```ts
type IntervalBounds = {
  lower: Expression;
  lowerStrict: boolean;
  upper: Expression;
  upperStrict: boolean;
};
```

Lower and upper bounds for a symbol extracted from a domain restriction.

`lowerStrict`/`upperStrict` are `true` for strict (`<`, `>`) bounds and
`false` (or `undefined`) for non-strict (`≤`, `≥`) bounds.

</MemberCard>

### NumberLiteralInterface {#numberliteralinterface}

Narrowed interface for number literal expressions.

Obtained via `isNumber()`.

<MemberCard>

##### NumberLiteralInterface.numericValue {#numericvalue}

```ts
readonly numericValue: number | NumericValue;
```

</MemberCard>

<MemberCard>

##### NumberLiteralInterface.isExact {#isexact-1}

```ts
readonly isExact: boolean;
```

</MemberCard>

<MemberCard>

##### NumberLiteralInterface.isNumberLiteral {#isnumberliteral}

```ts
readonly isNumberLiteral: true;
```

</MemberCard>

### SymbolInterface {#symbolinterface}

Narrowed interface for symbol expressions.

Obtained via `isSymbol()`.

<MemberCard>

##### SymbolInterface.symbol {#symbol-2}

```ts
readonly symbol: string;
```

</MemberCard>

### FunctionInterface {#functioninterface}

Narrowed interface for function expressions.

Obtained via `isFunction()`.

<MemberCard>

##### FunctionInterface.isFunctionExpression {#isfunctionexpression}

```ts
readonly isFunctionExpression: true;
```

</MemberCard>

<MemberCard>

##### FunctionInterface.ops {#ops-1}

```ts
readonly ops: readonly Expression[];
```

</MemberCard>

<MemberCard>

##### FunctionInterface.nops {#nops}

```ts
readonly nops: number;
```

</MemberCard>

<MemberCard>

##### FunctionInterface.op1 {#op1}

```ts
readonly op1: Expression;
```

</MemberCard>

<MemberCard>

##### FunctionInterface.op2 {#op2}

```ts
readonly op2: Expression;
```

</MemberCard>

<MemberCard>

##### FunctionInterface.op3 {#op3}

```ts
readonly op3: Expression;
```

</MemberCard>

### StringInterface {#stringinterface}

Narrowed interface for string expressions.

Obtained via `isString()`.

<MemberCard>

##### StringInterface.string {#string-3}

```ts
readonly string: string;
```

</MemberCard>

<MemberCard>

##### StringInterface.buffer {#buffer}

```ts
readonly buffer: Uint8Array;
```

The UTF-8 encoding of the string, as a byte buffer.

</MemberCard>

<MemberCard>

##### StringInterface.unicodeScalars {#unicodescalars}

```ts
readonly unicodeScalars: number[];
```

The Unicode scalar values (code points) of the string.

</MemberCard>

### CharacterInterface {#characterinterface}

Narrowed interface for a character expression — one NFC-normalized grapheme
cluster (UAX #29).

Obtained via `isCharacter()`.

`string` holds the cluster's content and is deliberately spelled the same as
`StringInterface.string`, so a consumer that only needs the text (the
`String` interpolation join, `StringJoin`) can read either kind through one
property without first deciding which it has.

<MemberCard>

##### CharacterInterface.string {#string-4}

```ts
readonly string: string;
```

The content of the character: exactly one grapheme cluster.

</MemberCard>

<MemberCard>

##### CharacterInterface.unicodeScalars {#unicodescalars-1}

```ts
readonly unicodeScalars: number[];
```

The Unicode scalar values (code points) of the cluster.

</MemberCard>

### TensorInterface {#tensorinterface}

Narrowed interface for tensor expressions.

Obtained via `isTensor()`.

<MemberCard>

##### TensorInterface.shape {#shape-4}

```ts
readonly shape: number[];
```

</MemberCard>

<MemberCard>

##### TensorInterface.rank {#rank-3}

```ts
readonly rank: number;
```

</MemberCard>

### CollectionInterface {#collectioninterface}

Narrowed interface for collection expressions.

Obtained via `isCollection()`.

#### Extended by

- [`IndexedCollectionInterface`](#indexedcollectioninterface)

<MemberCard>

##### CollectionInterface.isCollection {#iscollection-2}

```ts
readonly isCollection: true;
```

</MemberCard>

<MemberCard>

##### CollectionInterface.count {#count-2}

```ts
readonly count: number | undefined;
```

</MemberCard>

<MemberCard>

##### CollectionInterface.isFiniteCollection {#isfinitecollection-1}

```ts
readonly isFiniteCollection: boolean | undefined;
```

</MemberCard>

<MemberCard>

##### CollectionInterface.isEmptyCollection {#isemptycollection-1}

```ts
readonly isEmptyCollection: boolean | undefined;
```

</MemberCard>

<MemberCard>

##### CollectionInterface.isEnumerableCollection {#isenumerablecollection-1}

```ts
readonly isEnumerableCollection: boolean | undefined;
```

</MemberCard>

<MemberCard>

##### CollectionInterface.each() {#each-1}

```ts
each(): Generator<Expression>
```

</MemberCard>

<MemberCard>

##### CollectionInterface.contains() {#contains-2}

```ts
contains(rhs): boolean | undefined
```

####### rhs

[`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### CollectionInterface.subsetOf() {#subsetof-2}

```ts
subsetOf(other, strict): boolean | undefined
```

####### other

[`Expression`](#expression-5)

####### strict

`boolean`

</MemberCard>

### IndexedCollectionInterface {#indexedcollectioninterface}

Narrowed interface for indexed collection expressions (lists, vectors,
matrices, tuples).

Obtained via `isIndexedCollection()`.

#### Extends

- [`CollectionInterface`](#collectioninterface)

<MemberCard>

##### IndexedCollectionInterface.isIndexedCollection {#isindexedcollection-1}

```ts
readonly isIndexedCollection: true;
```

</MemberCard>

<MemberCard>

##### IndexedCollectionInterface.at() {#at-3}

```ts
at(index): Expression | undefined
```

####### index

`number`

</MemberCard>

<MemberCard>

##### IndexedCollectionInterface.indexWhere() {#indexwhere-2}

```ts
indexWhere(predicate): number | undefined
```

####### predicate

(`element`) => `boolean`

</MemberCard>

<MemberCard>

### ExpressionInput {#expressioninput}

```ts
type ExpressionInput = 
  | number
  | bigint
  | boolean
  | string
  | BigNum
  | Complex
  | MathJsonNumberObject
  | MathJsonStringObject
  | MathJsonSymbolObject
  | MathJsonFunctionObject
  | MathJsonDictionaryObject
  | readonly [MathJsonSymbol, ...ExpressionInput[]]
  | MathJsonExpression
  | Expression;
```

An expression input is a MathJSON expression which can include some
engine expression terms.

This is convenient when creating new expressions from portions
of an existing `Expression` while avoiding unboxing and reboxing.

</MemberCard>

### ObjectInterface {#objectinterface}

Narrowed interface for **object** expressions — the engine's one mutable
value kind (a reference to a record whose stored fields can be changed in
place).

Obtained via `isObject()`. The instance IS the heap record: host reference
identity of the expression is object identity, so every comparison tier
(`isSame`, `isEqual`, `isIdenticallyEqual`) answers `a === b` for objects,
and no code path may clone, rebuild or re-box one.

The members below are engine-internal (they are how the property-access
operators and the serialization walk reach the slots); user code reads and
writes fields through the language's property syntax, not through these.

Design: `docs/TYPE-SYSTEM.md`;
semantics: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B.

<MemberCard>

##### ObjectInterface.typeName {#typename}

```ts
readonly typeName: string;
```

The name of the nominal type this object was constructed with. The
resolved type itself is pinned on the instance and returned by `.type`;
this is the name that rides serialization (the `Object` provenance head
and `CircularReference` markers).

</MemberCard>

<MemberCard>

### ReplaceOptions {#replaceoptions}

```ts
type ReplaceOptions = {
  recursive: boolean;
  once: boolean;
  useVariations: boolean;
  matchPermutations: boolean;
  iterationLimit: number;
  canonical: CanonicalOptions;
  form: FormOption;
  direction: "left-right" | "right-left";
};
```

Options for `Expression.replace()`.

</MemberCard>

<MemberCard>

### CanonicalForm {#canonicalform}

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

Canonical normalization transforms.

</MemberCard>

<MemberCard>

### CanonicalOptions {#canonicaloptions}

```ts
type CanonicalOptions = 
  | boolean
  | CanonicalForm
  | CanonicalForm[];
```

</MemberCard>

<MemberCard>

### FormOption {#formoption}

```ts
type FormOption = 
  | "canonical"
  | "structural"
  | "raw"
  | CanonicalForm
  | CanonicalForm[];
```

Controls how expressions are created.

</MemberCard>

<MemberCard>

### Metadata {#metadata-1}

```ts
type Metadata = {
  latex: string;
  wikidata: string;
  sourceOffsets: [number, number];
};
```

Metadata that can be associated with a MathJSON expression.

</MemberCard>

## Pattern Matching

<MemberCard>

### Substitution {#substitution}

```ts
type Substitution<T> = KernelSubstitution<T>;
```

A substitution describes the values of the wildcards in a pattern so that
the pattern is equal to a target expression.

A substitution can also be considered a more constrained version of a
rule whose `match` is always a symbol.

#### Type Parameters

• T = [`ExpressionInput`](#expressioninput)

</MemberCard>

<MemberCard>

### BoxedSubstitution {#boxedsubstitution}

```ts
type BoxedSubstitution<T> = KernelBoxedSubstitution<T>;
```

#### Type Parameters

• T = [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

### PatternMatchOptions {#patternmatchoptions}

```ts
type PatternMatchOptions<T> = KernelPatternMatchOptions<T>;
```

Control how a pattern is matched to an expression.

#### Type Parameters

• T = [`Expression`](#expression-5)

</MemberCard>

## Rules

<MemberCard>

### RuleReplaceFunction {#rulereplacefunction}

```ts
type RuleReplaceFunction = KernelRuleReplaceFunction<Expression>;
```

Rule replacement callback specialized to boxed expressions.

</MemberCard>

<MemberCard>

### RuleConditionFunction {#ruleconditionfunction}

```ts
type RuleConditionFunction = KernelRuleConditionFunction<Expression, IComputeEngine>;
```

Rule condition callback with access to the compute engine.

</MemberCard>

<MemberCard>

### RuleFunction {#rulefunction}

```ts
type RuleFunction = KernelRuleFunction<Expression>;
```

Dynamic rule callback.

</MemberCard>

<MemberCard>

### Rule {#rule}

```ts
type Rule = KernelRule<Expression, ExpressionInput, IComputeEngine>;
```

Rule declaration specialized to boxed expression and compute engine types.

</MemberCard>

<MemberCard>

### RulePurpose {#rulepurpose}

```ts
type RulePurpose = "simplify" | "transform" | "expand";
```

The purpose of a rule determines how its result is treated by
the simplification cost policy:

- `'simplify'`: the result must pass the cost gate (the default;
  today's behavior — results that grow the expression are discarded).
- `'transform'`: a mathematically-preferred rewrite; exempt from the
  cost gate (accepted by `simplify()` even if structurally larger).
- `'expand'`: growth-by-design (series, argument expansion); skipped by
  `simplify()`, but reachable via `expr.replace()` and future expand APIs.

</MemberCard>

<MemberCard>

### ExplainOperation {#explainoperation}

```ts
type ExplainOperation = "simplify" | "solve" | "D" | "Integrate";
```

The operation that an `Explanation` traces. See `expr.explain()`.

</MemberCard>

<MemberCard>

### ExplainVerbosity {#explainverbosity}

```ts
type ExplainVerbosity = "default" | "all";
```

How much of the raw rule trace `expr.explain()` returns:

- `'default'`: curated — bookkeeping steps (driver-internal markers) and
  no-op steps are filtered out.
- `'all'`: the raw, uncurated chain (for rule authors and debugging).

</MemberCard>

## Assumptions

<MemberCard>

### ExpressionMapInterface {#expressionmapinterface}

```ts
type ExpressionMapInterface<U> = KernelExpressionMapInterface<U, Expression>;
```

Map-like interface keyed by boxed expressions.

#### Type Parameters

• U

</MemberCard>

<MemberCard>

### Assumption {#assumption}

```ts
type Assumption = KernelAssumption<Expression, IComputeEngine>;
```

Assumption predicates bound to this compute engine.

</MemberCard>

<MemberCard>

### AssumeResult {#assumeresult}

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

<MemberCard>

### CompiledType {#compiledtype}

```ts
type CompiledType = boolean | number | string | object;
```

</MemberCard>

<MemberCard>

### JSSource {#jssource}

```ts
type JSSource = string;
```

</MemberCard>

<MemberCard>

### CompiledExpression {#compiledexpression}

```ts
type CompiledExpression = {
  evaluate: (scope) => number | Expression;
};
```

</MemberCard>

<MemberCard>

### OperatorCompileContext {#operatorcompilecontext}

```ts
type OperatorCompileContext = {
  language: string;
};
```

The context passed to a custom operator [OperatorCompileHandler](#operatorcompilehandler). A
curated, stable subset of the internal compilation target: enough to emit
target-specific source without exposing the full internal machinery.

</MemberCard>

<MemberCard>

### OperatorCompileHandler {#operatorcompilehandler}

```ts
type OperatorCompileHandler = (args, compile, context) => string | undefined;
```

A custom compilation handler for an operator, set on an
`OperatorDefinition`. It mirrors a built-in compiled-function handler:
it receives the (canonical) operands, a `compile` callback to lower a
sub-expression to target source, and the compilation `context` (branch on
`context.language`). It returns target source, or `undefined` (or
an empty string) to fall back to the target's default compilation of this
operator (a `null` returned from untyped JavaScript is tolerated and
treated the same).

Takes precedence over the target's built-in operator/function mapping and
broadcast lowering, so it can override how a built-in operator compiles
(e.g. a custom-tolerance `GCD`, or a re-mapped `Add`/`Multiply`/`Power`/
relational operator). It does NOT override the structural / control-flow
heads (`Sequence`, `Sum`, `Product`, `Function`, `Declare`, `Assign`,
`Return`, `Break`, `Continue`, `Loop`, `Comprehension`, `If`, `Which`,
`When`, `Match`, `Block`), which have their own bespoke lowering; a handler
declared on one of those heads is ignored.

```ts
ce.declare('MyGcd', {
  signature: '(number, number) -> number',
  compile: (args, compile, { language }) =>
    language === 'javascript'
      ? `_gcd(${compile(args[0])}, ${compile(args[1])})`
      : undefined,
});
```

</MemberCard>

## Definitions

<MemberCard>

### EvaluateHandlerOptions {#evaluatehandleroptions}

```ts
type EvaluateHandlerOptions = Partial<EvaluateOptions> & {
  engine: ComputeEngine;
  expression: Expression;
};
```

The `options` argument passed to an `evaluate` / `evaluateAsync` handler.

#### EvaluateHandlerOptions.expression?

```ts
optional expression?: Expression;
```

The canonical expression node being evaluated.

Its `ops` are the **raw** operands: canonical and bound, but
**pre-numericization** — the same objects the `type` handler sees. The
handler's first parameter, by contrast, holds the *evaluated* operands,
which under `numericApproximation` have already been turned into floats.

That makes this the handler's only access to the operands' exactness. For
example `Power` reads the exact rational `p/q` of its exponent from
`expression.op2` to decide the branch of a negative base — under `.N()`
the exponent it receives as an operand is a double, from which `p/q`
can only be guessed.

**`expression.ops[i]` is NOT in general the provenance of `ops[i]`.** The
evaluated operands come from `holdMap`, which reindexes them: it FLATTENS
an associative operator (`f(a, f(b, c))` arrives as three operands, one
more than the node has), it UNWRAPS `ReleaseHold` (so `expression.ops[i]`
is the wrapper, not what was evaluated), and it DROPS an operand whose
evaluation yields nothing. The correspondence holds only for a
non-associative operator with no `ReleaseHold` and no dropped operand — so
a handler that indexes into `expression.ops` must treat
`expression.ops.length !== ops.length` as "no provenance" and fall back to
what it can compute from the evaluated operands alone.

**On a `lazy: true` operator there is no contrast to draw**: `holdMap`
returns the operands unchanged, so the handler's first parameter is raw
and held too — and, on the box/parse routes, not even canonicalized (see
the lazy-operator trap in `CLAUDE.md`: such a handler must canonicalize
each held operand it consumes).

Read-only: do not mutate it, and do not assume it is present (a handler
invoked outside the evaluation driver may not receive one).

</MemberCard>

<MemberCard>

### ValueDefinition {#valuedefinition}

```ts
type ValueDefinition = BaseDefinition & {
  holdUntil: "never" | "evaluate" | "N";
  type:   | Type
     | TypeString
     | BoxedType;
  inferred: boolean;
  effectsDeclared: boolean;
  value:   | LatexString
     | ExpressionInput
     | ((ce) => Expression | null);
  eq: (a) => boolean | undefined;
  neq: (a) => boolean | undefined;
  cmp: (a) => "=" | ">" | "<" | undefined;
  collection: CollectionHandlers;
  subscriptEvaluate: (subscript, options) => Expression | undefined;
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

#### ValueDefinition.effectsDeclared

```ts
effectsDeclared: boolean;
```

Annotation provenance on the EFFECTS axis of a function-typed
declaration (`docs/EFFECTS-MODEL.md`, "Annotation provenance") — the
effects-axis analog of `inferred`.

True when the author STATED the arrow's effects: a non-empty specifier
(`(number) scope -> number`), or the `pure` keyword — which denotes the
same empty set a bare arrow does, so the type alone cannot tell them
apart. A bare arrow leaves effects on the inferred track: assigning a
body re-stamps them freely. A stated set is a CONTRACT: every assigned
body must satisfy `inferred ⊆ declared`.

Set by `ce.declare()` from the parsed declaration; not normally written
by hand.

#### ValueDefinition.value

```ts
value: 
  | LatexString
  | ExpressionInput
  | ((ce) => Expression | null);
```

`value` can be a JS function since for some constants, such as
`Pi`, the actual value depends on the `precision` setting of the
`ComputeEngine` and possible other environment settings

#### ValueDefinition.subscriptEvaluate?

```ts
optional subscriptEvaluate?: (subscript, options) => Expression | undefined;
```

Custom evaluation handler for subscripted expressions of this symbol.
Called when evaluating `Subscript(symbol, index)`.

###### subscript

[`Expression`](#expression-5)

The subscript expression (already evaluated)

###### options

Contains the compute engine and evaluation options

####### engine

`ComputeEngine`

####### numericApproximation?

`boolean`

</MemberCard>

### SequenceDefinition {#sequencedefinition}

Definition for a sequence declared with `ce.declareSequence()`.

A sequence is defined by base cases and a recurrence relation.

#### Example

```typescript
// Fibonacci sequence
ce.declareSequence('F', {
  base: { 0: 0, 1: 1 },
  recurrence: 'F_{n-1} + F_{n-2}',
});
ce.parse('F_{10}').evaluate();  // → 55
```

<MemberCard>

##### SequenceDefinition.variable? {#variable}

```ts
optional variable?: string;
```

Index variable name for single-index sequences, default 'n'.
For multi-index sequences, use `variables` instead.

</MemberCard>

<MemberCard>

##### SequenceDefinition.variables? {#variables}

```ts
optional variables?: string[];
```

Index variable names for multi-index sequences.
Example: `['n', 'k']` for Pascal's triangle `P\_{n,k}`

If provided, this takes precedence over `variable`.

</MemberCard>

<MemberCard>

##### SequenceDefinition.base {#base}

```ts
base: Record<number | string, number | Expression>;
```

Base cases as index → value mapping.

For single-index sequences, use numeric keys:
```typescript
base: { 0: 0, 1: 1 }  // F_0 = 0, F_1 = 1
```

For multi-index sequences, use comma-separated string keys:
```typescript
base: {
  '0,0': 1,    // Exact: P_{0,0} = 1
  'n,0': 1,    // Pattern: P_{n,0} = 1 for all n
  'n,n': 1,    // Pattern: P_{n,n} = 1 (diagonal)
}
```

Pattern keys use variable names to match any value. When the same
variable appears multiple times (e.g., 'n,n'), the indices must be equal.

</MemberCard>

<MemberCard>

##### SequenceDefinition.recurrence {#recurrence}

```ts
recurrence: string | Expression;
```

Recurrence relation as LaTeX string or Expression

</MemberCard>

<MemberCard>

##### SequenceDefinition.memoize? {#memoize}

```ts
optional memoize?: boolean;
```

Whether to memoize computed values (default: true)

</MemberCard>

<MemberCard>

##### SequenceDefinition.domain? {#domain-1}

```ts
optional domain?: 
  | {
  min: number;
  max: number;
 }
  | Record<string, {
  min: number;
  max: number;
}>;
```

Valid index domain constraints.

For single-index sequences:
```typescript
domain: { min: 0, max: 100 }
```

For multi-index sequences, use per-variable constraints:
```typescript
domain: { n: { min: 0 }, k: { min: 0 } }
```

</MemberCard>

<MemberCard>

##### SequenceDefinition.constraints? {#constraints}

```ts
optional constraints?: string | Expression;
```

Constraint expression for multi-index sequences.
The expression should evaluate to a boolean/numeric value.
If it evaluates to false or 0, the subscript is considered out of domain.

Example: `'k <= n'` for Pascal's triangle (only valid when k ≤ n)

</MemberCard>

### SequenceStatus {#sequencestatus}

Status of a sequence definition.

<MemberCard>

##### SequenceStatus.status {#status}

```ts
status: "complete" | "pending" | "not-a-sequence";
```

Status of the sequence:
- 'complete': Both base case(s) and recurrence defined
- 'pending': Waiting for base case(s) or recurrence
- 'not-a-sequence': Symbol is not a sequence

</MemberCard>

<MemberCard>

##### SequenceStatus.hasBase {#hasbase}

```ts
hasBase: boolean;
```

Whether at least one base case is defined

</MemberCard>

<MemberCard>

##### SequenceStatus.hasRecurrence {#hasrecurrence}

```ts
hasRecurrence: boolean;
```

Whether a recurrence relation is defined

</MemberCard>

<MemberCard>

##### SequenceStatus.baseIndices {#baseindices}

```ts
baseIndices: (string | number)[];
```

Keys of defined base cases.
For single-index: numeric indices (e.g., [0, 1])
For multi-index: string keys including patterns (e.g., ['0,0', 'n,0', 'n,n'])

</MemberCard>

<MemberCard>

##### SequenceStatus.variable? {#variable-1}

```ts
optional variable?: string;
```

Index variable name if recurrence is defined (single-index)

</MemberCard>

<MemberCard>

##### SequenceStatus.variables? {#variables-1}

```ts
optional variables?: string[];
```

Index variable names if recurrence is defined (multi-index)

</MemberCard>

### SequenceInfo {#sequenceinfo}

Information about a defined sequence for introspection.

<MemberCard>

##### SequenceInfo.name {#name-1}

```ts
name: string;
```

The sequence name

</MemberCard>

<MemberCard>

##### SequenceInfo.variable? {#variable-2}

```ts
optional variable?: string;
```

Index variable name for single-index sequences (e.g., `"n"`)

</MemberCard>

<MemberCard>

##### SequenceInfo.variables? {#variables-2}

```ts
optional variables?: string[];
```

Index variable names for multi-index sequences (e.g., `["n", "k"]`)

</MemberCard>

<MemberCard>

##### SequenceInfo.baseIndices {#baseindices-1}

```ts
baseIndices: (string | number)[];
```

Base case keys.
For single-index: numeric indices
For multi-index: string keys including patterns

</MemberCard>

<MemberCard>

##### SequenceInfo.memoize {#memoize-1}

```ts
memoize: boolean;
```

Whether memoization is enabled

</MemberCard>

<MemberCard>

##### SequenceInfo.domain {#domain-2}

```ts
domain: 
  | {
  min: number;
  max: number;
 }
  | Record<string, {
  min: number;
  max: number;
}>;
```

Domain constraints.
For single-index: `{ min?, max? }`
For multi-index: per-variable constraints

</MemberCard>

<MemberCard>

##### SequenceInfo.cacheSize {#cachesize}

```ts
cacheSize: number;
```

Number of cached values

</MemberCard>

<MemberCard>

##### SequenceInfo.isMultiIndex {#ismultiindex}

```ts
isMultiIndex: boolean;
```

Whether this is a multi-index sequence

</MemberCard>

<MemberCard>

### Tri {#tri}

```ts
type Tri = boolean | undefined;
```

A three-valued fact about an operand: `true` (provably yes), `false`
(provably no), `undefined` (not decidable from what the descriptor knows).

</MemberCard>

<MemberCard>

### OperandFacts {#operandfacts}

```ts
type OperandFacts = {
  finite: Tri;
  sgn: Sign;
  bounds: {
     lower: number;
     lowerStrict: boolean;
     upper: number;
     upperStrict: boolean;
    };
  closed: Tri;
  collection: Tri;
  finiteCollection: Tri;
  indexed: Tri;
  shape: readonly number[];
};
```

The facts a `type` handler in the `'types'` shape may read about one
operand, beside the operand's type. Every fact is derived from pure
sources — the operand's type, a literal's value, a symbol's held value or
recorded assumptions, structural reads — never by canonicalizing,
declaring, or evaluating anything.

The set is deliberately minimal: a fact earns a field only when the
operand's TYPE cannot carry it. Anything the type proves is read off
`OperandDescriptor.type` directly — an error operand's type IS `'error'`
(so there is no `valid` field), and a literal's value, sign, and
finiteness normally travel in its value-carrying type. Each field below
merges the type channel with the pure value channel, so a handler reads
ONE place and never re-derives the combination; the doc of each field
names the residue that justifies it.

</MemberCard>

<MemberCard>

### OperandStructure {#operandstructure}

```ts
type OperandStructure = 
  | {
  kind: "symbol";
  name: string;
  inferred: boolean;
 }
  | {
  kind: "string";
  text: string;
 }
  | {
  kind: "number";
  literal: 0 | 1;
 }
  | {
  kind: "application";
  head: string;
  children: ReadonlyArray<OperandDescriptor>;
 }
  | {
  kind: "function-literal";
  parameters: ReadonlyArray<{
     name: string;
     annotated: Type;
    }>;
  body: OperandStructure;
 }
  | {
  kind: "tuple";
  arity: number;
 }
  | {
  kind: "list-literal";
  shape: readonly number[];
};
```

An inert, expression-free structural view of an operand, for `type`
handlers in the `'types'` shape that need more than the operand's type
(is it a symbol? a string literal? an application of which operator?).
Children appear as descriptors, so a handler can recurse without ever
holding an expression.

#### Type Declaration

\{
  `kind`: `"symbol"`;
  `name`: `string`;
  `inferred`: `boolean`;
 \}

#### OperandStructure.inferred?

```ts
optional inferred?: boolean;
```

Present (`true`) when the symbol's recorded type was INFERRED
(subject to revision) rather than declared — the fact the
`Multiply` and `List`-fold handlers consult when deciding how much
to trust an operand's type. Lives on the structure node, not in
`OperandFacts`: it is a property of this symbol, not of a type.

\{
  `kind`: `"string"`;
  `text`: `string`;
 \}

\{
  `kind`: `"number"`;
  `literal`: `0` \| `1`;
 \}

\{
  `kind`: `"application"`;
  `head`: `string`;
  `children`: `ReadonlyArray`\<[`OperandDescriptor`](#operanddescriptor)\>;
 \}

\{
  `kind`: `"function-literal"`;
  `parameters`: `ReadonlyArray`\<\{
     `name`: `string`;
     `annotated`: [`Type`](#type-3);
    \}\>;
  `body`: [`OperandStructure`](#operandstructure);
 \}

\{
  `kind`: `"tuple"`;
  `arity`: `number`;
 \}

\{
  `kind`: `"list-literal"`;
  `shape`: readonly `number`[];
 \}

</MemberCard>

<MemberCard>

### OperandDescriptor {#operanddescriptor}

```ts
type OperandDescriptor = {
  type: Type;
  facts: OperandFacts;
  structureOf: () => OperandStructure | undefined;
};
```

What a `type` handler in the `'types'` shape receives in place of an
operand expression: the operand's handler-visible type (a number
literal's value-carrying type included), a set of three-valued facts,
and an optional on-demand structural view. Descriptors carry no
expression, so a handler cannot canonicalize, declare, or evaluate its
operands while deriving a type — which is the point of the shape: type
derivation must not modify engine state.

Built by `describe()` (from a real operand) and `describeType()` (from a
type alone) in `boxed-expression/operand-descriptor.ts`; the design is
`docs/plans/2026-08-22-type-handlers-on-types.md` §5.1.

</MemberCard>

<MemberCard>

### ReadonlyDefinitionView {#readonlydefinitionview}

```ts
type ReadonlyDefinitionView = {
  value: Readonly<BoxedValueDefinition>;
  operator: Readonly<BoxedOperatorDefinition>;
};
```

The definition view a `'types'`-shape `type` handler gets from
`PureEngineView.lookupDefinition`: the tagged value/operator halves with
every own property readonly. The shallow `Readonly` is compile-time
protection against the direct field writes a type handler must never
perform (`def.operator.signature = …`); the runtime purity guard remains
the dynamic enforcement for anything the type system cannot see.

</MemberCard>

### PureEngineView {#pureengineview}

The read-only slice of the engine available to a `type` handler in the
`'types'` shape: enough to parse and resolve types, and to look up a
definition — none of the mutating surface (`declare`, `assign`, `box`,
`parse`, `evaluate`), and the definition lookup answers a read-only view
([ReadonlyDefinitionView](#readonlydefinitionview)). The full `ComputeEngine` satisfies this
interface structurally, so the restriction is compile-time only; the
runtime purity guard (`CE_TYPE_PURITY_GUARD`, always on under test) is
what enforces it dynamically.

<MemberCard>

##### PureEngineView.\_typeResolver {#_typeresolver}

```ts
readonly _typeResolver: TypeResolver;
```

</MemberCard>

<MemberCard>

##### PureEngineView.type() {#type-4}

```ts
type(type): BoxedType
```

####### type

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### PureEngineView.lookupDefinition() {#lookupdefinition}

```ts
lookupDefinition(id): ReadonlyDefinitionView | undefined
```

####### id

`string`

</MemberCard>

<MemberCard>

### TypeHandlerContext {#typehandlercontext}

```ts
type TypeHandlerContext = {
  engine: PureEngineView;
};
```

The context argument of a `type` handler in the `'types'` shape.

A `derive(operator, operands)` member — the recursive entry point a
handler such as `Map` needs to type an application it does not have in
hand — is part of the design
(`docs/plans/2026-08-22-type-handlers-on-types.md` §5.2) and will be
added when those handlers migrate; it is absent until then.

</MemberCard>

<MemberCard>

### OperatorTypeHandlerOnExpressions {#operatortypehandleronexpressions}

```ts
type OperatorTypeHandlerOnExpressions = (ops, options) => 
  | Type
  | TypeString
  | BoxedType
  | undefined;
```

The legacy `type` handler shape: a function of the operand EXPRESSIONS.

</MemberCard>

<MemberCard>

### OperatorTypeHandlerOnTypes {#operatortypehandlerontypes}

```ts
type OperatorTypeHandlerOnTypes = (operands, context) => 
  | Type
  | TypeString
  | BoxedType
  | undefined;
```

The `type` handler shape selected by `typeHandlerKind: 'types'`: a
function of operand DESCRIPTORS. Such a handler never sees an operand
expression, so deriving a type cannot declare, canonicalize, or evaluate
anything — the state-purity contract of
`docs/plans/2026-08-22-type-handlers-on-types.md`.

</MemberCard>

<MemberCard>

### OperatorTypeHandlerVariant {#operatortypehandlervariant}

```ts
type OperatorTypeHandlerVariant = 
  | {
  typeHandlerKind: "expressions";
  type: OperatorTypeHandlerOnExpressions;
 }
  | {
  typeHandlerKind: "types";
  type: OperatorTypeHandlerOnTypes;
};
```

The two `type`-handler shapes, discriminated by the `typeHandlerKind`
flag — the flag selects the shape; the shape is never guessed from the
handler's parameter count. Omitting the flag (every pre-existing
definition) keeps the legacy expressions shape.

The flag travels WITH the handler: a definition update that supplies a
new `type` handler and omits `typeHandlerKind` resets the stored shape
to `'expressions'`, even when the previous handler was declared
`'types'`. When re-declaring a `'types'`-shape operator, always restate
the flag next to the handler — a descriptor-consuming handler filed
under the expressions shape is silently called with expressions and
derives wrong types.

#### Type Declaration

\{
  `typeHandlerKind`: `"expressions"`;
  `type`: [`OperatorTypeHandlerOnExpressions`](#operatortypehandleronexpressions);
 \}

#### OperatorTypeHandlerVariant.type?

```ts
optional type?: OperatorTypeHandlerOnExpressions;
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

\{
  `typeHandlerKind`: `"types"`;
  `type`: [`OperatorTypeHandlerOnTypes`](#operatortypehandlerontypes);
 \}

#### OperatorTypeHandlerVariant.type?

```ts
optional type?: OperatorTypeHandlerOnTypes;
```

The type of the result (return type) as a function of the operand
DESCRIPTORS — their types and facts, never the operand expressions.
See [OperatorTypeHandlerOnTypes](#operatortypehandlerontypes).

</MemberCard>

### BaseDefinition {#basedefinition}

Metadata common to both symbols and functions.

<MemberCard>

##### BaseDefinition.description {#description}

```ts
description: string | string[];
```

If a string, a short description, about one line long.

Otherwise, a list of strings, each string a paragraph.

May contain Markdown.

</MemberCard>

<MemberCard>

##### BaseDefinition.keywords? {#keywords}

```ts
optional keywords?: string[];
```

Search keywords (synonyms, alternate names) used by
`ce.searchDefinitions()`. Not shown in documentation.

</MemberCard>

<MemberCard>

##### BaseDefinition.examples {#examples}

```ts
examples: string | string[];
```

A list of examples of how to use this symbol or operator.

Each example is a string, which can be a MathJSON expression or LaTeX, bracketed by `$` signs.
For example, `["Add", 1, 2]` or `$\\sin(\\pi/4)$`.

</MemberCard>

<MemberCard>

##### BaseDefinition.url {#url-2}

```ts
url: string;
```

A URL pointing to more information about this symbol or operator.

</MemberCard>

<MemberCard>

##### BaseDefinition.wikidata {#wikidata}

```ts
wikidata: string;
```

A short string representing an entry in a wikibase.

For example `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
for the `Pi` constant.

</MemberCard>

<MemberCard>

##### BaseDefinition.isConstant? {#isconstant}

```ts
readonly optional isConstant?: boolean;
```

If true, the value or type of the definition cannot be changed

</MemberCard>

<MemberCard>

### SymbolDefinition {#symboldefinition}

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

### LibraryDefinition {#librarydefinition}

A library bundles symbol/operator definitions with their LaTeX dictionary
entries and declares dependencies on other libraries.

Use with the `libraries` constructor option to load standard or custom
libraries:

```ts
const ce = new ComputeEngine({
  libraries: ['core', 'arithmetic', {
    name: 'custom',
    requires: ['arithmetic'],
    definitions: { G: { value: 6.674e-11, type: 'real', isConstant: true } },
  }],
});
```

<MemberCard>

##### LibraryDefinition.name {#name-4}

```ts
name: string;
```

Library identifier

</MemberCard>

<MemberCard>

##### LibraryDefinition.requires? {#requires}

```ts
optional requires?: string[];
```

Libraries that must be loaded before this one

</MemberCard>

<MemberCard>

##### LibraryDefinition.definitions? {#definitions}

```ts
optional definitions?: Readonly<{}> | Readonly<{}>[];
```

Symbol and operator definitions

</MemberCard>

### BaseCollectionHandlers {#basecollectionhandlers}

These handlers are the primitive operations that can be performed on
all collections, indexed or not.

#### Definitions

<MemberCard>

##### BaseCollectionHandlers.iterator {#iterator}

```ts
iterator: (collection) => 
  | Iterator<Expression, undefined, any>
  | undefined;
```

Return an iterator that iterates over the elements of the collection.

The order in which the elements are returned is not defined. Requesting
two iterators on the same collection may return the elements in a
different order.

</MemberCard>

#### Other

<MemberCard>

##### BaseCollectionHandlers.count {#count}

```ts
count: (collection) => number | undefined;
```

Return the number of elements in the collection.

An empty collection has a count of 0.

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.isEmpty? {#isempty}

```ts
optional isEmpty?: (collection) => boolean | undefined;
```

Optional flag to quickly check if the collection is empty, without having to count exactly how may elements it has (useful for lazy evaluation).

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.isFinite? {#isfinite}

```ts
optional isFinite?: (collection) => boolean | undefined;
```

Optional flag to quickly check if the collection is finite, without having to count exactly how many elements it has (useful for lazy evaluation).

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.isEnumerable? {#isenumerable}

```ts
optional isEnumerable?: (collection) => boolean | undefined;
```

Optional predicate answering whether `iterator()` will actually produce
this collection's elements — the cheap way to tell an EMPTY collection
from one that merely cannot be walked, which are otherwise
indistinguishable (both yield nothing).

Return `false` when the elements have no computable value in the current
state: symbolic bounds (`Range(a, b)`, `Linspace(a, 1, 3)`, a symbolic
repeat count), or a source that is itself not enumerable. Return
`undefined` only when it cannot be decided without evaluating.

Implementations must be O(1) and must NOT consult `count`, `isEmpty` or
`isFinite` on themselves, nor walk the collection: a wrapper answers by
reading its source's `isEnumerableCollection`, so a chain costs one call
per level. (Reading the emptiness facets instead is exponential in the
chain depth — each read re-enters the next `isEmpty` down.)

Default when the handler is ABSENT: `true` (an operator with a
`collection` block can enumerate its elements). A handler that IS declared
owns all three states — returning `undefined` from it means "cannot tell
cheaply" and does not fall back to the default.

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.isCollection? {#iscollection}

```ts
optional isCollection?: (collection) => boolean;
```

Optional predicate for operators whose collection-ness depends on their
operands, e.g. `When(value, cond)`, which is a collection exactly when
`value` is one.

Returning `false` reports the expression as a scalar, as if it had no
collection handlers at all.

Default: `true` (an operator with a `collection` block is a collection).

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.isLazy? {#islazy}

```ts
optional isLazy?: (collection) => boolean;
```

Return `true` if the collection is lazy, `false` otherwise.
If the collection is lazy, it means that the elements are not
computed until they are needed, for example when iterating over the
collection.

Default: `false`. A collection is eager unless its definition says
otherwise: the elements of a `List` are already materialized operands,
so nothing is deferred. Lazy collections such as `Range` or `Map` declare
this handler to opt in.

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.elementMemo? {#elementmemo}

```ts
optional elementMemo?: boolean;
```

Opt this operator's instances into per-instance element memoization: a
complete walk of an unmodified instance is served from a cached prefix
on subsequent walks (`boxed-expression/collection-element-memo.ts`).

Set it on lazy operators that evaluate a function per element (`Map`,
`Filter`, `Tabulate`, …), where re-deriving an element is expensive.
Leave it off structural reindexers (`Take`, `Reverse`, `Zip`, …), which
re-serve their source's elements cheaply — when the source is itself a
flagged instance, the source's own memo already absorbs the cost.

Default: `false`

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.contains? {#contains}

```ts
optional contains?: (collection, target) => boolean | undefined;
```

Return `true` if the target expression is in the collection,
`false` otherwise.

Return `undefined` if the membership cannot be determined.

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.subsetOf? {#subsetof}

```ts
optional subsetOf?: (collection, other, strict) => boolean | undefined;
```

Return `true` if all the elements of `collection` are in `other` — that
is, `collection` ⊆ `other`. The RECEIVER is the candidate subset, matching
the public `Expression.subsetOf(other, strict)` method that dispatches
here. Both `collection` and `other` are collections.

If strict is `true`, the subset must be strict, that is, `other` must have
an element that `collection` does not.

Return `undefined` if the subset relation cannot be determined. A handler
that cannot see far enough to answer must return `undefined` rather than
`false`: `false` is read as a proof that the relation does NOT hold.

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.eltsgn? {#eltsgn}

```ts
optional eltsgn?: (collection) => Sign | undefined;
```

Return the sign of all the elements of the collection.

</MemberCard>

<MemberCard>

##### BaseCollectionHandlers.elttype? {#elttype}

```ts
optional elttype?: (collection) => Type | undefined;
```

Return the widest type of all the elements in the collection

</MemberCard>

### IndexedCollectionHandlers {#indexedcollectionhandlers}

These additional collection handlers are applicable to indexed
collections only.

The elements of an indexed collection can be accessed by index, and
the order of the elements is defined.

<MemberCard>

##### IndexedCollectionHandlers.at {#at}

```ts
at: (collection, index) => Expression | undefined;
```

Return the element at the specified index.

The first element is `at(1)`, the last element is `at(-1)`.

If the index is &lt;0, return the element at index `count() + index + 1`.

The index can also be a string, for example for records. There is no
handler that enumerates the valid string keys: a handler that accepts
them decides which ones it recognizes, and returns `undefined` for the
rest.

If the index is invalid, return `undefined`.

</MemberCard>

<MemberCard>

##### IndexedCollectionHandlers.indexWhere {#indexwhere}

```ts
indexWhere: (collection, predicate) => number | undefined;
```

Return the index of the first element that matches the predicate.

If no element matches the predicate, return `undefined`.

</MemberCard>

<MemberCard>

### CollectionHandlers {#collectionhandlers}

```ts
type CollectionHandlers = BaseCollectionHandlers & Partial<IndexedCollectionHandlers>;
```

The collection handlers are the primitive operations that can be
performed on collections, such as lists, sets, tuples, etc...

</MemberCard>

<MemberCard>

### TaggedValueDefinition {#taggedvaluedefinition}

```ts
type TaggedValueDefinition = {
  value: BoxedValueDefinition;
};
```

The definition for a value, represented as a tagged object literal.

</MemberCard>

<MemberCard>

### TaggedOperatorDefinition {#taggedoperatordefinition}

```ts
type TaggedOperatorDefinition = {
  operator: BoxedOperatorDefinition;
};
```

The definition for an operator, represented as a tagged object literal.

</MemberCard>

<MemberCard>

### BoxedDefinition {#boxeddefinition}

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

<MemberCard>

### TypeProvenanceEntry {#typeprovenanceentry}

```ts
type TypeProvenanceEntry = {
  type: BoxedType;
  kind: "declared" | "auto-declared" | "inferred" | "assumed" | "value-derived";
  previousType: BoxedType;
  axis: "type" | "effects";
  cause: Expression;
  epoch: number;
  span: {
     start: number;
     end: number;
    };
};
```

One recorded write to a definition's type (or an operator definition's
signature): the type the write installed, the mechanism that installed it,
and — for writes triggered by canonicalizing an expression — that
expression.

Provenance can never live on `Type`/`BoxedType` objects themselves: parsed
types are interned, deep-frozen, and shared across engines (the
`TYPE_CACHE` in `common/type/parse.ts`), so two occurrences of `boolean`
are the same object. The history therefore lives on the per-engine
definition, next to `inferredType`.

Design: `docs/TYPE-SYSTEM.md`, phase 1.

</MemberCard>

### BoxedBaseDefinition {#boxedbasedefinition}

#### Extends

- `Partial`\<[`BaseDefinition`](#basedefinition)\>

#### Extended by

- [`BoxedValueDefinition`](#boxedvaluedefinition)
- [`BoxedOperatorDefinition`](#boxedoperatordefinition)

<MemberCard>

##### BoxedBaseDefinition.collection? {#collection-1}

```ts
optional collection?: CollectionHandlers;
```

If this is the definition of a collection, the set of primitive operations
that can be performed on this collection (counting the number of elements,
enumerating it, etc...).

</MemberCard>

### BoxedValueDefinition {#boxedvaluedefinition}

#### Extends

- [`BoxedBaseDefinition`](#boxedbasedefinition)

<MemberCard>

##### BoxedValueDefinition.holdUntil {#holduntil}

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

<MemberCard>

##### BoxedValueDefinition.value {#value-3}

```ts
value: Expression | undefined;
```

The current value of the symbol. For constants, this is immutable.
 The definition object is the single source of truth — there is no
 separate evaluation-context values map.

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.isSelfReferential {#isselfreferential}

```ts
readonly isSelfReferential: boolean;
```

True if the current value refers to the symbol itself (a degenerate
self-referential binding, e.g. `a := a + 1` over an unbound `a`). Such a
binding forms a cycle: resolving the value would re-resolve the symbol
forever. When set, the symbol is treated as unbound during resolution so
that `evaluate()`/`.N()`/collection queries stay symbolic instead of
overflowing the stack. Computed once when the value is assigned.

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.eq? {#eq-1}

```ts
optional eq?: (a) => boolean | undefined;
```

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.neq? {#neq}

```ts
optional neq?: (a) => boolean | undefined;
```

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.cmp? {#cmp}

```ts
optional cmp?: (a) => "<" | ">" | "=" | undefined;
```

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.inferredType {#inferredtype}

```ts
inferredType: boolean;
```

True if the type has been inferred. An inferred type can be updated as
more information becomes available.

A type that is not inferred, but has been set explicitly, cannot be updated.

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.effectsDeclared {#effectsdeclared}

```ts
effectsDeclared: boolean;
```

Annotation provenance on the EFFECTS axis — the effects-axis analog of
[inferredType](#inferredtype) (`docs/EFFECTS-MODEL.md`, "Annotation provenance").

True when the declaration STATED the arrow's effects (a non-empty
specifier, or the `pure` keyword). False for a bare arrow, which leaves
effects on the inferred track: an assigned body's inferred effects are
accepted and re-stamped, never checked against the declaration.

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.type {#type-6}

```ts
type: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.subscriptEvaluate? {#subscriptevaluate-1}

```ts
optional subscriptEvaluate?: (subscript, options) => Expression | undefined;
```

Custom evaluation handler for subscripted expressions of this symbol.
Called when evaluating `Subscript(symbol, index)`.

</MemberCard>

<MemberCard>

##### BoxedValueDefinition.dispose() {#dispose}

```ts
dispose(): void
```

Release resources owned by this definition when its scope is disposed.

</MemberCard>

<MemberCard>

### BindingSite {#bindingsite}

```ts
type BindingSite = {
  path: readonly number[];
  type: TypeString;
  clauseLocal: boolean;
};
```

A located binding site: where, inside an operator expression, one of that
operator's **bound variables** sits, and how to declare it.

</MemberCard>

<MemberCard>

### BindingSiteSelector {#bindingsiteselector}

```ts
type BindingSiteSelector = (ops, phase) => readonly BindingSite[];
```

Locate an operator's binding sites among its operands.

Used as the value of the `scoped` flag of [OperatorDefinitionFlags](#operatordefinitionflags) to
declare that an operator is a *binder*: the framework mints the operator's
scope, declares each site's symbol in it before the `canonical` handler
runs, and rebinds the sites (and same-named occurrences elsewhere in the
expression) to that scope afterwards. This is what makes the parse,
`ce.box()` and `ce.function()` routes agree about which binding a bound
variable denotes.

`phase: 'pre'` runs on the RAW operands, before the `canonical` handler; it
may return fewer sites than `'post'` — return nothing rather than guess.
`phase: 'post'` runs on the handler's RESULT operands and is authoritative.

</MemberCard>

<MemberCard>

### BroadcastExemption {#broadcastexemption}

```ts
type BroadcastExemption = 
  | "tensors"
  | "tuples"
  | "collection-result"
  | "evaluated-operands"
  | "whole-collection-compare"
  | "single-collection-join";
```

A shape of operand (or result) whose broadcast handling an operator's own
handlers provide, exempting it from the generic broadcast machinery. See
[OperatorDefinitionFlags.broadcastExemptions](#broadcastexemptions) for the meaning of
each label.

</MemberCard>

<MemberCard>

### OperatorDefinitionFlags {#operatordefinitionflags}

```ts
type OperatorDefinitionFlags = {
  lazy: boolean;
  scoped: boolean | BindingSiteSelector;
  broadcastable: boolean;
  broadcastExemptions: ReadonlyArray<BroadcastExemption>;
  inspectsErrors: boolean;
  namedArgumentsRequired: boolean;
  missingBehavior: "reject" | "propagate" | "handle";
  missingStrip: "all" | number[];
  associative: boolean;
  commutative: boolean;
  commutativeOrder: ((a, b) => number) | undefined;
  commutativeMatch: boolean;
  idempotent: boolean;
  involution: boolean;
  pure: boolean;
  effects: EffectSet | undefined;
  effectsDeclared: boolean;
  frameProtocol: "seed" | undefined;
  invokes: boolean | {};
  discharges: {} | undefined;
  holdClass: "evaluate" | "quote" | "release";
  drawsRandom: boolean;
  readsRandomFrame: boolean;
};
```

An operator definition can have some flags to indicate specific
properties of the operator.

</MemberCard>

<MemberCard>

### LambdaDefinition {#lambdadefinition}

```ts
type LambdaDefinition = {
  parameters: ReadonlyArray<{
     name: string;
     type: Type | undefined;
    }>;
  body: Expression;
};
```

A traversable, public view of a user-defined function literal
(`f(x) := …`, `x ↦ …`, or `ce.assign('f', lambda)`): its parameters and
its body as a boxed expression. Returned by
[BoxedOperatorDefinition.lambda](#lambda).

</MemberCard>

### BoxedOperatorDefinition {#boxedoperatordefinition}

The definition includes information specific about an operator, such as
handlers to canonicalize or evaluate a function expression with this
operator.

#### Extends

- [`BoxedBaseDefinition`](#boxedbasedefinition).[`OperatorDefinitionFlags`](#operatordefinitionflags)

<MemberCard>

##### BoxedOperatorDefinition.scoped {#scoped-1}

```ts
scoped: boolean;
```

Normalized from the declaration's `scoped` flag: `true` when the operator
creates a lexical scope, whether it was declared `true` or as a
binding-site selector.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.bindingSites? {#bindingsites}

```ts
optional bindingSites?: BindingSiteSelector;
```

The binding-site selector of the declaration's `scoped` flag, when one
was given. `undefined` for `scoped: true` (a scope with no syntactic
bound variables) and for an unscoped operator.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.complexity {#complexity}

```ts
complexity: number;
```

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.inferredSignature {#inferredsignature}

```ts
inferredSignature: boolean;
```

If true, the signature was inferred from usage and may be modified
as more information becomes available.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.signature {#signature}

```ts
signature: BoxedType;
```

The type of the arguments and return value of this function

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.resolvedMissingBehavior {#resolvedmissingbehavior}

```ts
readonly resolvedMissingBehavior: "reject" | "propagate" | "handle" | "pass-through";
```

The *resolved* missing-value behavior (§3.A of the missing-value typing
design): the declared `missingBehavior` flag of [OperatorDefinitionFlags](#operatordefinitionflags)
when present, otherwise
`'propagate'` for a declared all-numeric signature and `'pass-through'`
for everything else. Recomputed from the current signature — never cached
across a signature mutation.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.invokesNone {#invokesnone}

```ts
readonly invokesNone: boolean;
```

True when NO operand position invokes — the cheap operator-level
pre-gate for the latent half of the projection rule.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.lambda {#lambda}

```ts
readonly lambda: LambdaDefinition | undefined;
```

If this operator definition was created from a user-defined function
literal (`f(x) := …`, `x ↦ …`, `ce.assign('f', lambda)`), a structured
view of it for traversal and classification: the parameters and the body
as a boxed expression. `undefined` for built-in operators.

The return shape and per-argument types are also available via
[signature](#signature); this accessor additionally exposes the body so a
consumer can resolve a function reference structurally — without
re-parsing or textually inlining its source.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.typeHandlerKind {#typehandlerkind}

```ts
readonly typeHandlerKind: "expressions" | "types";
```

Which shape the `type` handler takes: `'expressions'` (the legacy
shape — a function of the operand expressions) or `'types'` (a function
of operand descriptors, which cannot touch engine state). The flag is
what the dispatch reads; the handler's parameter count is never
inspected.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.type? {#type-8}

```ts
optional type?: 
  | OperatorTypeHandlerOnExpressions
  | OperatorTypeHandlerOnTypes;
```

If present, this handler can be used to more precisely determine the
return type based on the type of the arguments. The arguments themselves
should *not* be evaluated, only their types should be used.

The shape of the stored handler is recorded by [typeHandlerKind](#typehandlerkind);
a caller must dispatch on that flag before invoking it.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.sgn? {#sgn-2}

```ts
optional sgn?: (ops, options) => Sign | undefined;
```

If present, this handler can be used to determine the sign of the
 return value of the function, based on the sign and type of its
 arguments.

The arguments themselves should *not* be evaluated, only their types and
sign should be used.

This can be used in some case for example to determine when certain
simplifications are valid.

The handler MUST be a pure function of the operands: no evaluation
(`.evaluate()`, `.N()` — including indirectly, through helpers that
numericize a bound or probe a collection element), no canonicalization
of new expressions, no declarations. The type path dispatches `sgn`
handlers while deriving an application's type (the `sgn` operand fact),
so a handler that changes engine state invalidates the very caches the
derivation is filling. Audit record: open item O7 of
`docs/plans/2026-08-22-type-handlers-on-types.md`.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.eq? {#eq-2}

```ts
optional eq?: (a, b, prover?) => boolean | undefined;
```

See `OperatorDefinition.eq` for the meaning of `prover`.

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.neq? {#neq-1}

```ts
optional neq?: (a, b) => boolean | undefined;
```

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.canEnumerate? {#canenumerate}

```ts
optional canEnumerate?: (expr) => boolean | undefined;
```

The eager producer's enumerability precondition — see the
`canEnumerate` contract on [OperatorDefinition](#operatordefinition).

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.elementCount? {#elementcount}

```ts
optional elementCount?: (expr) => number | undefined;
```

The eager producer's element count — see the `elementCount` contract on
[OperatorDefinition](#operatordefinition).

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.canonical? {#canonical}

```ts
optional canonical?: (ops, options) => Expression | null;
```

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.evaluate? {#evaluate}

```ts
optional evaluate?: (ops, options) => Expression | undefined;
```

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.evaluateAsync? {#evaluateasync}

```ts
optional evaluateAsync?: (ops, options) => Promise<Expression | undefined>;
```

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.evalDimension? {#evaldimension}

```ts
optional evalDimension?: (ops, options) => Expression;
```

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.compile? {#compile}

```ts
optional compile?: OperatorCompileHandler;
```

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.stripsMissingAt() {#stripsmissingat}

```ts
stripsMissingAt(i): boolean
```

True if a `missing` arm is stripped from parameter position `i` before
validation (§3.A). Only `propagate`/`handle` operators strip; `missingStrip`
selects the positions.

####### i

`number`

</MemberCard>

<MemberCard>

##### BoxedOperatorDefinition.invokesAt() {#invokesat}

```ts
invokesAt(i): boolean
```

True if operand position `i` may INVOKE a function-valued operand — the
per-position reader for the `invokes` flag of [OperatorDefinitionFlags](#operatordefinitionflags).
Missing
map indices default to `true`. Every consumer of the metadata goes
through this accessor (or [invokesNone](#invokesnone)), never the raw field.

####### i

`number`

</MemberCard>

### EqHandlers {#eqhandlers}

These handlers compare two expressions.

If only one of the handlers is provided, the other is derived from it.

Having both may be useful if comparing non-equality is faster than equality.

<MemberCard>

##### EqHandlers.eq {#eq-3}

```ts
eq: (a, b) => boolean | undefined;
```

</MemberCard>

<MemberCard>

##### EqHandlers.neq {#neq-2}

```ts
neq: (a, b) => boolean | undefined;
```

</MemberCard>

<MemberCard>

### Hold {#hold-2}

```ts
type Hold = "none" | "all" | "first" | "rest" | "last" | "most";
```

</MemberCard>

## Latex Parsing and Serialization

<MemberCard>

### LatexToken {#latextoken}

```ts
type LatexToken = string | "<{>" | "<}>" | "<space>" | "<$>" | "<$$>";
```

A `LatexToken` is a token as returned by `Parser.peek`.

It can be one of the indicated tokens, or a string that starts with a
`` for LaTeX commands, or a LaTeX character which includes digits,
letters and punctuation.

</MemberCard>

<MemberCard>

### LatexString {#latexstring}

```ts
type LatexString = string;
```

A LatexString is a regular string of LaTeX, for example:
`\frac{\pi}{2}`

</MemberCard>

<MemberCard>

### Delimiter {#delimiter}

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

<MemberCard>

### DelimiterScale {#delimiterscale}

```ts
type DelimiterScale = "normal" | "scaled" | "big" | "none";
```

</MemberCard>

<MemberCard>

### LibraryCategory {#librarycategory}

```ts
type LibraryCategory = 
  | "arithmetic"
  | "calculus"
  | "collections"
  | "colors"
  | "control-structures"
  | "combinatorics"
  | "core"
  | "linear-algebra"
  | "logic"
  | "number-theory"
  | "other"
  | "physics"
  | "polynomials"
  | "relop"
  | "statistics"
  | "trigonometry"
  | "units";
```

</MemberCard>

<MemberCard>

### Precedence {#precedence}

```ts
type Precedence = number;
```

:::info[THEORY OF OPERATIONS]

The precedence of an operator is a number that indicates the order in which
operators are applied.

For example, in `1 + 2 * 3`, the `*` operator has a **higher** precedence
than the `+` operator, so it is applied first.

The precedence ranges from 0 to 1000. The larger the number, the higher the
precedence, the more "binding" the operator is.

### Operator Precedence Table

| Precedence | Operators | Description |
|------------|-----------|-------------|
| **880** | `\lnot` `\neg` `++` `--` `+` `-` (prefix) | Prefix/postfix unary |
| **810** | `!` `'` `!!` `'''` | Factorial, prime (postfix) |
| **800** | `_` (subscript) | Subscript |
| **780** | `\degree` `\prime` | Degree, prime symbols |
| **740** | `\%` | Percent |
| **720** | `/` (inline division) | Inline division |
| **700** | `^` `\overset` `\underset` | Exponentiation, over/underscript |
| **650** | (invisible multiply) `\cdot` | Implicit multiplication |
| **600** | `\div` `\frac` | Division |
| **390** | `\times` `*` `/` | Multiplication |
| **350** | `\cup` `\cap` | Set union/intersection |
| **275** | `+` `-` (infix) | Addition, subtraction |
| **270** | `\to` `\rightarrow` `\mapsto` | Arrows |
| **265** | `\setminus` `\smallsetminus` `:` (range) | Set difference, range |
| **260** | `:=` | Assignment |
| **255** | `\ne` | Not equal |
| **250** | `\not\approxeq` | Not approximately equal |
| **247** | `\approx` | Approximately |
| **245-246** | `=` `<` `>` `\lt` `\gt` `\nless` `\ngtr` | Equality, comparison |
| **241-244** | `\le` `\leq` `\ge` `\geq` `>=` | Less/greater or equal |
| **240** | `\in` `\notin` `\subset` `\supset` ... | Set membership/relations |
| **235** | `\land` `\wedge` `\&` | Logical AND |
| **232** | `\veebar` `\barwedge` (Xor, Nand, Nor) | Logical XOR, NAND, NOR |
| **230** | `\lor` `\vee` `\parallel` | Logical OR |
| **220** | `\implies` `\Rightarrow` `\vdash` `\models` | Implication, entailment |
| **219** | `\iff` `\Leftrightarrow` `\equiv` | Equivalence |
| **200** | `\forall` `\exists` `\exists!` | Quantifiers |
| **160** | `\mid` `\vert` (set builder) | Set builder notation |
| **19-20** | `,` `;` `\ldots` | Sequence separators |

### Key Relationships

- **Comparisons bind tighter than logic**: `x = 1 \lor y = 2` parses as
  `(x = 1) \lor (y = 2)`, not `x = (1 \lor y) = 2`
- **AND binds tighter than OR**: `a \land b \lor c` parses as
  `(a \land b) \lor c`
- **Logic operators bind tighter than implication**: `a \lor b \implies c`
  parses as `(a \lor b) \implies c`

Some constants are defined below for common precedence values.

**Note**: MathML defines
[some operator precedence](https://www.w3.org/TR/2009/WD-MathML3-20090924/appendixc.html),
but it has some issues and inconsistencies. However,
whenever possible we adopted the MathML precedence.

The JavaScript operator precedence is documented
[here](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence).

:::

</MemberCard>

<MemberCard>

### Terminator {#terminator}

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

<MemberCard>

### ParseHandler {#parsehandler}

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

<MemberCard>

### ExpressionParseHandler {#expressionparsehandler}

```ts
type ExpressionParseHandler = (parser, until?) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### PrefixParseHandler {#prefixparsehandler}

```ts
type PrefixParseHandler = (parser, until?) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### SymbolParseHandler {#symbolparsehandler}

```ts
type SymbolParseHandler = (parser, until?) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### FunctionParseHandler {#functionparsehandler}

```ts
type FunctionParseHandler = (parser, until?) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### EnvironmentParseHandler {#environmentparsehandler}

```ts
type EnvironmentParseHandler = (parser, until?) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### PostfixParseHandler {#postfixparsehandler}

```ts
type PostfixParseHandler = (parser, lhs, until?) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### InfixParseHandler {#infixparsehandler}

```ts
type InfixParseHandler = (parser, lhs, until) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### MatchfixParseHandler {#matchfixparsehandler}

```ts
type MatchfixParseHandler = (parser, body) => MathJsonExpression | null;
```

</MemberCard>

<MemberCard>

### LatexArgumentType {#latexargumenttype}

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

<MemberCard>

### Trigger {#trigger}

```ts
type Trigger = {
  latexTrigger: LatexString | LatexToken[];
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

<MemberCard>

### BaseEntry {#baseentry}

```ts
type BaseEntry = {
  name: MathJsonSymbol;
  serialize: LatexString | SerializeHandler;
  standaloneSymbol: boolean;
};
```

Maps a string of LaTeX tokens to a function or symbol and vice-versa.

</MemberCard>

<MemberCard>

### DefaultEntry {#defaultentry}

```ts
type DefaultEntry = BaseEntry & Trigger & {
  parse:   | MathJsonExpression
     | ExpressionParseHandler;
};
```

</MemberCard>

<MemberCard>

### ExpressionEntry {#expressionentry}

```ts
type ExpressionEntry = BaseEntry & Trigger & {
  kind: "expression";
  parse:   | MathJsonExpression
     | ExpressionParseHandler;
  precedence: Precedence;
};
```

</MemberCard>

<MemberCard>

### MatchfixEntry {#matchfixentry}

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
optional parse?: MatchfixParseHandler;
```

When invoked, the parser is pointing after the close delimiter.
The argument of the handler is the body, i.e. the content between
the open delimiter and the close delimiter.

</MemberCard>

<MemberCard>

### InfixEntry {#infixentry}

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
optional associativity?: "right" | "left" | "none" | "any";
```

- **`none`**: a ? b ? c -> syntax error
- **`any`**: a + b + c -> +(a, b, c)
- **`left`**: a / b / c -> /(/(a, b), c)
- **`right`**: a = b = c -> =(a, =(b, c))

- `any`-associative operators have an unlimited number of arguments
- `left`, `right` or `none` associative operators have two arguments

</MemberCard>

<MemberCard>

### PostfixEntry {#postfixentry}

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

<MemberCard>

### PrefixEntry {#prefixentry}

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

<MemberCard>

### EnvironmentEntry {#environmententry}

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

<MemberCard>

### SymbolEntry {#symbolentry}

```ts
type SymbolEntry = BaseEntry & Trigger & {
  kind: "symbol";
  precedence: Precedence;
  parse:   | MathJsonExpression
     | SymbolParseHandler;
};
```

#### SymbolEntry.precedence?

```ts
optional precedence?: Precedence;
```

Used for appropriate wrapping (i.e. when to surround it with parens)

</MemberCard>

<MemberCard>

### FunctionEntry {#functionentry}

```ts
type FunctionEntry = BaseEntry & Trigger & {
  kind: "function";
  parse:   | MathJsonExpression
     | FunctionParseHandler;
  arguments: "enclosure" | "implicit";
};
```

A function is a symbol followed by:
- some postfix operators such as `\prime`
- an optional list of arguments in an enclosure (parentheses)

For more complex situations, for example implicit arguments or
inverse functions postfix (i.e. ^{-1}), use a custom parse handler with a
entry of kind `expression`.

#### FunctionEntry.arguments?

```ts
optional arguments?: "enclosure" | "implicit";
```

How arguments are parsed:
- `'enclosure'` (default): arguments must be enclosed in parentheses,
  e.g. `\max(a, b)`.
- `'implicit'`: arguments can be provided with or without parentheses,
  e.g. `\det A` is parsed as `\det(A)`.
  Bare arguments are parsed at multiplication precedence, so
  `\det 2A + 1` is parsed as `\det(2A) + 1`.

</MemberCard>

<MemberCard>

### LatexDictionaryEntry {#latexdictionaryentry}

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

To define custom LaTeX parsing and serialization, pass a `LatexSyntax`
instance to the `ComputeEngine` constructor via the `latexSyntax` option.
The `LatexSyntax` `dictionary` option **replaces** the default dictionary, so
start from `LATEX_DICTIONARY` and append your entries:

```ts
import { ComputeEngine, LatexSyntax, LATEX_DICTIONARY } from '@cortex-js/compute-engine';

const ce = new ComputeEngine({
  latexSyntax: new LatexSyntax({ dictionary: [...LATEX_DICTIONARY, myEntry] }),
});
```

</MemberCard>

<MemberCard>

### SymbolResolution {#symbolresolution}

```ts
type SymbolResolution = {
  type:   | BoxedType
     | TypeString;
  subscriptEvaluate: boolean;
};
```

What the ambient environment knows about a declared symbol, as reported by
the [ParseLatexOptions.resolveSymbol](#parselatexoptions) handler.

Declaration is signaled by the *presence* of this record (the handler
returns `undefined` for an undeclared symbol), so a declared symbol whose
type is not known is `{ type: 'unknown' }` — there is no way to report a
type for an undeclared symbol.

</MemberCard>

<MemberCard>

### ParseLatexOptions {#parselatexoptions}

```ts
type ParseLatexOptions = NumberFormat & {
  strict: boolean;
  skipSpace: boolean;
  parseNumbers: "auto" | "rational" | "decimal" | "never";
  resolveSymbol: (symbol) => SymbolResolution | undefined;
  parseUnexpectedToken: (lhs, parser) => MathJsonExpression | null;
  preserveLatex: boolean;
  diagnostics: boolean;
  quantifierScope: "tight" | "loose";
  timeDerivativeVariable: string;
  tolerance: number;
};
```

The LaTeX parsing options can be used with the `ce.parse()` method.

#### ParseLatexOptions.strict

```ts
strict: boolean;
```

Controls the strictness of LaTeX parsing:

- `true`: Strict LaTeX syntax required (e.g., `\sin{x}`, `x^{n+1}`)
- `false`: Accept relaxed Math-ASCII/Typst-like syntax in addition to
  LaTeX (e.g., `sin(x)`, `x^(n+1)`)

**Default**: `true`

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

#### ParseLatexOptions.resolveSymbol?

```ts
optional resolveSymbol?: (symbol) => SymbolResolution | undefined;
```

The symbol oracle: invoked when the parser needs to know what the
ambient environment knows about a symbol.

Return `undefined` if the symbol is undeclared, or a [SymbolResolution](#symbolresolution)
record if it is declared. Declaration is the *presence* of the record —
a symbol declared with an `unknown` type is still declared (return
`{ type: 'unknown' }` for it), which is distinct from returning
`undefined`.

Through `ce.parse()` this handler *supplements* the engine scope: it is
consulted first, and a symbol it does not resolve (`undefined`) falls
back to the scope's definitions. Use it to inject knowledge the scope
cannot have yet — e.g. names a later pass of a multi-pass document load
will declare.

The `symbol` argument is a [valid symbol](#symbols).

#### ParseLatexOptions.parseUnexpectedToken

```ts
parseUnexpectedToken: (lhs, parser) => MathJsonExpression | null;
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

#### ParseLatexOptions.diagnostics?

```ts
optional diagnostics?: boolean;
```

If true, collect opt-in parse-time diagnostics (see [ParseDiagnostic](#parsediagnostic))
flagging charitable parse decisions — undeclared symbols, application-like
juxtaposition read as multiply, discarded `%` comments, and trailing noise
dropped by recovery.

This flag only takes effect through
[ComputeEngine.parse](#parse-1), which
wires up the collector and attaches the resulting array to the top-level
parsed expression's `parseDiagnostics` property. On the standalone
`LatexSyntax.parse()` entry point the flag is a silent no-op (that entry
returns plain MathJSON with nowhere to attach diagnostics).

This is purely additive: enabling it never changes the parse output.

**Default:** `false`

#### ParseLatexOptions.quantifierScope

```ts
quantifierScope: "tight" | "loose";
```

Controls how quantifier scope is determined when parsing expressions
like `\forall x. P(x) \rightarrow Q(x)`.

- `"tight"`: The quantifier binds only to the immediately following
  well-formed formula, stopping at logical connectives (`\rightarrow`,
  `\implies`, `\land`, `\lor`, etc.). This follows standard First-Order
  Logic conventions. Use explicit parentheses for wider scope:
  `\forall x. (P(x) \rightarrow Q(x))`.

- `"loose"`: The quantifier scope extends to the end of the expression
  or until a lower-precedence operator is encountered.

**Default:** `"tight"`

##### Example

```ts
// With "tight" (default):
// \forall x. P(x) \rightarrow Q(x)
// parses as: (∀x. P(x)) → Q(x)

// With "loose":
// \forall x. P(x) \rightarrow Q(x)
// parses as: ∀x. (P(x) → Q(x))
```

#### ParseLatexOptions.timeDerivativeVariable

```ts
timeDerivativeVariable: string;
```

The variable used for time derivatives in Newton notation
(`\dot{x}`, `\ddot{x}`, etc.).

When parsing `\dot{x}`, it will be interpreted as `["D", "x", timeDerivativeVariable]`.

**Default:** `"t"`

#### ParseLatexOptions.tolerance

```ts
tolerance: number;
```

The tolerance used when validating inferred range steps from sampled
elements (e.g. `[0, 0.1, 0.2, \ldots, 1]`). Two consecutive differences
are considered equal when they differ by less than this value.

Populated automatically from `ce.tolerance` by `ce.parse()`.

**Default:** `ce.tolerance` (typically `1e-7`)

</MemberCard>

### Parser {#parser}

An instance of `Parser` is provided to the `parse` handlers of custom
LaTeX dictionary entries.

<MemberCard>

##### Parser.options {#options}

```ts
readonly options: Readonly<ParseLatexOptions>;
```

</MemberCard>

<MemberCard>

##### Parser.inQuantifierScope {#inquantifierscope}

```ts
readonly inQuantifierScope: boolean;
```

True if currently parsing inside a quantifier body (ForAll, Exists, etc.)

</MemberCard>

<MemberCard>

##### Parser.index {#index}

```ts
index: number;
```

The index of the current token

</MemberCard>

<MemberCard>

##### Parser.atEnd {#atend}

```ts
readonly atEnd: boolean;
```

True if the last token has been reached.
Consider also `atTerminator()`.

</MemberCard>

<MemberCard>

##### Parser.peek {#peek}

```ts
readonly peek: string;
```

Return the next token, without advancing the index

</MemberCard>

<MemberCard>

##### Parser.atBoundary {#atboundary}

</MemberCard>

<MemberCard>

##### Parser.resolveSymbol() {#resolvesymbol}

```ts
resolveSymbol(id): 
  | {
  type: BoxedType;
  subscriptEvaluate: boolean;
 }
  | undefined
```

The single symbol oracle: everything the parser knows about `id`.

Merges (in priority order) parser-local bindings — sum indices, `Block`/
`Function` parameters, tracked in the parser's symbol table — over the
[ParseLatexOptions.resolveSymbol](#parselatexoptions) handler (which `ce.parse()` wires
to consult per-call/engine-wide handlers first, then the engine scope).

Returns `undefined` if `id` is undeclared. A declared symbol always gets
a record — declaration *presence* is the `!== undefined` check, distinct
from type knowledge: a symbol declared with an `unknown` type still
resolves (with `type.isUnknown` true).

####### id

`string`

</MemberCard>

<MemberCard>

##### Parser.isFunctionTriggerName() {#isfunctiontriggername}

```ts
isFunctionTriggerName(name): boolean
```

Whether `name` is claimed by a `kind: 'function'` dictionary entry's
`symbolTrigger` (`log`, `lcm`, `var`, …). Such a name owns its call
syntax — including any subscript, which its parser may bind as an
argument (`\operatorname{log}_2(x)` is `Log(x, 2)`) — so subscript
absorption must not fold `name_sub` into a plain symbol and preempt the
function reading.

####### name

`string`

</MemberCard>

<MemberCard>

##### Parser.pushSymbolTable() {#pushsymboltable}

```ts
pushSymbolTable(): void
```

</MemberCard>

<MemberCard>

##### Parser.popSymbolTable() {#popsymboltable}

```ts
popSymbolTable(): void
```

</MemberCard>

<MemberCard>

##### Parser.addSymbol() {#addsymbol}

```ts
addSymbol(id, type): void
```

####### id

`string`

####### type

`string` \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### Parser.enterQuantifierScope() {#enterquantifierscope}

```ts
enterQuantifierScope(): void
```

Enter a quantifier scope for parsing the body of ForAll, Exists, etc.

</MemberCard>

<MemberCard>

##### Parser.exitQuantifierScope() {#exitquantifierscope}

```ts
exitQuantifierScope(): void
```

Exit the current quantifier scope

</MemberCard>

<MemberCard>

##### Parser.atTerminator() {#atterminator}

```ts
atTerminator(t): boolean
```

Return true if the terminator condition is met or if the last token
has been reached.

####### t

[`Terminator`](#terminator) \| `undefined`

</MemberCard>

<MemberCard>

##### Parser.nextToken() {#nexttoken}

```ts
nextToken(): string
```

Return the next token and advance the index

</MemberCard>

<MemberCard>

##### Parser.latex() {#latex}

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

<MemberCard>

##### Parser.error() {#error}

```ts
error(code, fromToken): MathJsonExpression
```

Return an error expression with the specified code and arguments.

The returned `Error` expression includes `sourceOffsets` metadata with
zero-based, end-exclusive offsets into the serialized LaTeX. Missing-operand
errors use a collapsed (zero-width) range at the position where the operand
was expected.

####### code

`string` \| \[`string`, `...MathJsonExpression[]`\]

####### fromToken

`number`

</MemberCard>

<MemberCard>

##### Parser.sourceOffsets() {#sourceoffsets}

```ts
sourceOffsets(startToken, endToken?): [number, number]
```

Return source offsets for a token range, as zero-based, end-exclusive
character offsets into the serialized LaTeX (`tokensToString`). For input
that round-trips unchanged (e.g. editor-generated LaTeX), these match the
original input string.

####### startToken

`number`

####### endToken?

`number`

</MemberCard>

<MemberCard>

##### Parser.skipSpace() {#skipspace}

```ts
skipSpace(): boolean
```

If there are any space, advance the index until a non-space is encountered

</MemberCard>

<MemberCard>

##### Parser.skipVisualSpace() {#skipvisualspace}

```ts
skipVisualSpace(): void
```

Skip over "visual space" which
includes space tokens, empty groups `{}`, and commands such as `\,` and `\!`

</MemberCard>

<MemberCard>

##### Parser.match() {#match}

```ts
match(token): boolean
```

If the next token matches the target advance and return true. Otherwise
return false

####### token

`string`

</MemberCard>

<MemberCard>

##### Parser.matchAll() {#matchall}

```ts
matchAll(tokens): boolean
```

Return true if the next tokens match the argument, an array of tokens, or null otherwise

####### tokens

`string`[]

</MemberCard>

<MemberCard>

##### Parser.matchAny() {#matchany}

```ts
matchAny(tokens): string
```

Return the next token if it matches any of the token in the argument or null otherwise

####### tokens

`string`[]

</MemberCard>

<MemberCard>

##### Parser.parseChar() {#parsechar}

```ts
parseChar(): string | null
```

If the next token is a character, return it and advance the index
This includes plain characters (e.g. 'a', '+'...), characters
defined in hex (^^ and ^^^^), the `\char` and `\unicode` command.

</MemberCard>

<MemberCard>

##### Parser.parseGroup() {#parsegroup}

```ts
parseGroup(): MathJsonExpression | null
```

Parse an expression in a LaTeX group enclosed in curly brackets `{}`.
These are often used as arguments to LaTeX commands, for example
`\frac{1}{2}`.

Return `null` if none was found
Return `Nothing` if an empty group `{}` was found

</MemberCard>

<MemberCard>

##### Parser.parseToken() {#parsetoken}

```ts
parseToken(): MathJsonExpression | null
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

<MemberCard>

##### Parser.parseOptionalGroup() {#parseoptionalgroup}

```ts
parseOptionalGroup(): MathJsonExpression | null
```

Parse an expression enclosed in a LaTeX optional group enclosed in square brackets `[]`.

Return `null` if none was found.

</MemberCard>

<MemberCard>

##### Parser.parseEnclosure() {#parseenclosure}

```ts
parseEnclosure(): MathJsonExpression | null
```

Parse an enclosure (open paren/close paren, etc..) and return the expression inside the enclosure

</MemberCard>

<MemberCard>

##### Parser.parseStringGroup() {#parsestringgroup}

```ts
parseStringGroup(optional?, rawTokens?): string | null
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

If `rawTokens` is provided, the raw (un-normalized) tokens of the group
content are appended to it — useful when the same content must be matched
verbatim later (the returned string normalizes commands such as `\alpha`
to unicode, which is lossy).

####### optional?

`boolean`

####### rawTokens?

`string`[]

</MemberCard>

<MemberCard>

##### Parser.parseSymbol() {#parsesymbol}

```ts
parseSymbol(until?): MathJsonExpression | null
```

A symbol can be:
- a single-letter symbol: `x`
- a single LaTeX command: `\pi`
- a multi-letter symbol: `\operatorname{speed}`

####### until?

`Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<MemberCard>

##### Parser.parseTabular() {#parsetabular}

```ts
parseTabular(): 
  | MathJsonExpression[][]
  | null
```

Parse an expression in a tabular format, where rows are separated by `\\`
and columns by `&`.

Return rows of sparse columns: empty rows are indicated with `Nothing`,
and empty cells are also indicated with `Nothing`.

</MemberCard>

<MemberCard>

##### Parser.parseArguments() {#parsearguments}

```ts
parseArguments(kind?, until?): 
  | readonly MathJsonExpression[]
  | null
```

Parse an argument list, for example: `(12, x+1)` or `\left(x\right)`

- 'enclosure' : will look for arguments inside an enclosure
   (an open/close fence) (**default**)
- 'implicit': either an expression inside a pair of `()`, or just a primary
   (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)

Return an array of expressions, one for each argument, or `null` if no
argument was found.

####### kind?

`"enclosure"` \| `"implicit"`

####### until?

[`Terminator`](#terminator)

</MemberCard>

<MemberCard>

##### Parser.parseBraceArguments() {#parsebracearguments}

```ts
parseBraceArguments(): 
  | readonly MathJsonExpression[]
  | null
```

Parse one or more `{...}` groups as an argument list, exactly as if
they were a parenthesized argument list: `\gcd{a,b}` ≡ `\gcd(a,b)`,
and consecutive groups are successive arguments (`\mod{x}{2}` ≡
`\mod(x,2)`, the TeX multi-argument-macro habit). A group whose
content is a comma sequence contributes each element as an argument.

An empty group is not an argument (`{}` is spacing/grouping
decoration), and no group at all returns `null`.

Used as a fallback after `parseArguments('enclosure')` for
dictionary-registered function heads, where the writer's intent is
unambiguous even though the braces render invisibly.

</MemberCard>

<MemberCard>

##### Parser.parsePostfixOperator() {#parsepostfixoperator}

```ts
parsePostfixOperator(lhs, until?): MathJsonExpression | null
```

Parse a postfix operator, such as `'` or `!`.

Prefix, infix and matchfix operators are handled by `parseExpression()`

####### lhs

[`MathJsonExpression`](#mathjsonexpression) \| `null`

####### until?

`Partial`\<[`Terminator`](#terminator)\>

</MemberCard>

<MemberCard>

##### Parser.parseExpression() {#parseexpression}

```ts
parseExpression(until?): MathJsonExpression | null
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

<MemberCard>

##### Parser.parseNumber() {#parsenumber}

```ts
parseNumber(): MathJsonExpression | null
```

Parse a number.

</MemberCard>

<MemberCard>

##### Parser.addBoundary() {#addboundary}

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

<MemberCard>

##### Parser.removeBoundary() {#removeboundary}

```ts
removeBoundary(): void
```

</MemberCard>

<MemberCard>

##### Parser.matchBoundary() {#matchboundary}

```ts
matchBoundary(): boolean
```

</MemberCard>

<MemberCard>

##### Parser.boundaryError() {#boundaryerror}

```ts
boundaryError(msg): MathJsonExpression
```

####### msg

`string` \| \[`string`, `...MathJsonExpression[]`\]

</MemberCard>

<MemberCard>

### RootStyle {#rootstyle}

```ts
type RootStyle = "radical" | "quotient" | "solidus";
```

How to serialize a root, i.e. `\sqrt{x}`, `x^{1/2}` or `x^\frac12`.

</MemberCard>

<MemberCard>

### FractionStyle {#fractionstyle}

```ts
type FractionStyle = 
  | "quotient"
  | "block-quotient"
  | "inline-quotient"
  | "inline-solidus"
  | "nice-solidus"
  | "reciprocal"
  | "factor";
```

How to serialize a fraction.

</MemberCard>

<MemberCard>

### LogicStyle {#logicstyle}

```ts
type LogicStyle = "word" | "boolean" | "uppercase-word" | "punctuation";
```

How to serialize the logic operators.

</MemberCard>

<MemberCard>

### PowerStyle {#powerstyle}

```ts
type PowerStyle = "root" | "solidus" | "quotient";
```

How to serialize a fractional power.

</MemberCard>

<MemberCard>

### NumericSetStyle {#numericsetstyle}

```ts
type NumericSetStyle = "compact" | "regular" | "interval" | "set-builder";
```

How to serialize a numeric set, i.e. `\R^*`, `\R \setminus \lbrace 0\rbrace`.

</MemberCard>

<MemberCard>

### IndexStyle {#indexstyle}

```ts
type IndexStyle = "subscript" | "bracket";
```

How to serialize collection indexing (the `At` operator).

</MemberCard>

<MemberCard>

### StyleOption {#styleoption}

```ts
type StyleOption<T> = T | ((expr, level) => T);
```

A serialization style option: either a constant, or a function of the
expression and of its nesting level.

#### Type Parameters

• T extends `string`

</MemberCard>

<MemberCard>

### SerializeLatexOptions {#serializelatexoptions}

```ts
type SerializeLatexOptions = NumberSerializationFormat & {
  prettify: boolean;
  materialization: boolean | number | [number, number];
  invisibleMultiply: LatexString;
  invisiblePlus: LatexString;
  multiply: LatexString;
  missingSymbol: LatexString;
  keywordStyle: "text" | "keyword" | "operatorname";
  applyFunctionStyle: StyleOption<DelimiterScale>;
  groupStyle: StyleOption<DelimiterScale>;
  rootStyle: StyleOption<RootStyle>;
  fractionStyle: StyleOption<FractionStyle>;
  logicStyle: StyleOption<LogicStyle>;
  powerStyle: StyleOption<PowerStyle>;
  numericSetStyle: StyleOption<NumericSetStyle>;
  indexStyle: StyleOption<IndexStyle>;
  dotNotation: boolean;
  dmsFormat: boolean;
  angleNormalization: "none" | "0...360" | "-180...180";
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

#### SerializeLatexOptions.keywordStyle

```ts
keywordStyle: "text" | "keyword" | "operatorname";
```

How to serialize keyword constructs (`if`/`then`/`else`, `for`, `where`,
`and`, `or`, the quantifiers, …).

- `'text'` (default): `\text{if }`, `\text{ then }`, … — the conventional
  spelling. Spacing is encoded manually inside the braces.
- `'keyword'`: `\keyword{if}`, `\keyword{then}`, … — a math-mode command
  whose renderer applies symmetric keyword spacing. Requires the rendering
  environment to define `\keyword`.
- `'operatorname'`: `\operatorname{if}`, … — operator-name spacing.

All three spellings parse back to the same expression.

##### Default

```ts
'text'
```

#### SerializeLatexOptions.indexStyle

```ts
indexStyle: StyleOption<IndexStyle>;
```

Notation used to serialize collection indexing (the `At` operator), e.g.
`["At", v, 1]`.

- `'bracket'` (default): `v[1]`, `M[i,j]` — programming-style indexing,
  which always round-trips back to `At` even when the collection symbol
  is not declared.
- `'subscript'`: `v_1`, `M_{i,j}` — conventional mathematical notation,
  symmetric with how subscript indexing of an `indexed_collection`
  parses; only round-trips when the base is declared as a collection.

#### SerializeLatexOptions.dotNotation

```ts
dotNotation: boolean;
```

When `true`, member-access heads serialize to dot notation:
- `First(p)` → `p.x`
- `Second(p)` → `p.y`
- `Third(p)` → `p.z`
- `Real(z)` → `z.\operatorname{real}`
- `Imaginary(z)` → `z.\operatorname{imag}`
- `Length(L)` → `L.\operatorname{count}`
- `Sum(L)` → `L.\operatorname{total}`
- `Max(L)` → `L.\max`
- `Min(L)` → `L.\min`

When `false` (default), the standard function-call form is used.

Only applies to arity-1 forms. Multi-operand forms (e.g. `Sum` with
an index tuple) keep their standard serialization even when this is `true`.

**Serializer-only.** This flag has no effect on parsing. All input
forms continue to parse as before regardless of the flag (e.g. `|L|`,
`\operatorname{count}(L)`, and `L.\operatorname{count}` all parse to
`["Length", L]` whether `dotNotation` is on or off). The flag only
decides which form the serializer emits.

Set engine-wide via `ce.latexOptions.dotNotation = true`, or per-call
via `expr.toLatex({ dotNotation: true })`.

**Default**: `false`

#### SerializeLatexOptions.dmsFormat?

```ts
optional dmsFormat?: boolean;
```

When true, serialize angle quantities in degrees-minutes-seconds format.
When false (default), use decimal degrees.

##### Default

```ts
false
```

##### Example

```typescript
const ce = new ComputeEngine();
const angle = ce.expr(['Quantity', 9.5, 'deg']);

// DMS format
angle.latex({ dmsFormat: true });  // "9°30'"

// Decimal format (default)
angle.latex({ dmsFormat: false }); // "9.5°"

// Full DMS notation
ce.expr(['Quantity', 9.504166, 'deg'])
  .latex({ dmsFormat: true });     // "9°30'15\""
```

#### SerializeLatexOptions.angleNormalization?

```ts
optional angleNormalization?: "none" | "0...360" | "-180...180";
```

Normalize angles to a specific range during serialization.
Useful for geographic coordinates and rotations.

##### Default

```ts
'none'
```

##### Example

```typescript
const ce = new ComputeEngine();

// No normalization (show exact value)
ce.expr(['Degrees', 370])
  .latex({ angleNormalization: 'none' });  // "370°"

// Normalize to [0, 360) - useful for bearings
ce.expr(['Degrees', 370])
  .latex({ angleNormalization: '0...360' }); // "10°"

ce.expr(['Degrees', -45])
  .latex({ angleNormalization: '0...360' }); // "315°"

// Normalize to [-180, 180] - useful for longitude
ce.expr(['Degrees', 190])
  .latex({ angleNormalization: '-180...180' }); // "-170°"

// Combine with DMS format
ce.expr(['Degrees', 370])
  .latex({
    dmsFormat: true,
    angleNormalization: '0...360'
  }); // "10°0'0\""
```

</MemberCard>

<MemberCard>

### ResolvedSerializeLatexOptions {#resolvedserializelatexoptions}

```ts
type ResolvedSerializeLatexOptions = Omit<SerializeLatexOptions, 
  | "applyFunctionStyle"
  | "groupStyle"
  | "rootStyle"
  | "fractionStyle"
  | "logicStyle"
  | "powerStyle"
  | "numericSetStyle"
  | "indexStyle"> & {
  applyFunctionStyle: (expr, level) => DelimiterScale;
  groupStyle: (expr, level) => DelimiterScale;
  rootStyle: (expr, level) => RootStyle;
  fractionStyle: (expr, level) => FractionStyle;
  logicStyle: (expr, level) => LogicStyle;
  powerStyle: (expr, level) => PowerStyle;
  numericSetStyle: (expr, level) => NumericSetStyle;
  indexStyle: (expr, level) => IndexStyle;
};
```

The serialization options as seen by the serializer: the style options
have been normalized from their constant form (e.g. `rootStyle: 'solidus'`)
to their function form.

</MemberCard>

### Serializer {#serializer}

An instance of `Serializer` is provided to the `serialize` handlers of custom
LaTeX dictionary entries.

<MemberCard>

##### Serializer.options {#options-1}

```ts
readonly options: Required<ResolvedSerializeLatexOptions>;
```

</MemberCard>

<MemberCard>

##### Serializer.dictionary {#dictionary-1}

```ts
readonly dictionary: SerializerDictionary;
```

</MemberCard>

<MemberCard>

##### Serializer.level {#level}

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

<MemberCard>

##### Serializer.serialize {#serialize-1}

```ts
serialize: (expr) => string;
```

Output a LaTeX string representing the expression

</MemberCard>

<MemberCard>

##### Serializer.wrap {#wrap}

```ts
wrap: (expr, prec?) => string;
```

Add a group fence around the expression if it is
an operator of precedence less than or equal to `prec`.

</MemberCard>

<MemberCard>

##### Serializer.applyFunctionStyle {#applyfunctionstyle}

```ts
applyFunctionStyle: (expr, level) => DelimiterScale;
```

Styles

</MemberCard>

<MemberCard>

##### Serializer.groupStyle {#groupstyle}

```ts
groupStyle: (expr, level) => DelimiterScale;
```

</MemberCard>

<MemberCard>

##### Serializer.rootStyle {#rootstyle-1}

```ts
rootStyle: (expr, level) => "radical" | "quotient" | "solidus";
```

</MemberCard>

<MemberCard>

##### Serializer.fractionStyle {#fractionstyle-1}

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

<MemberCard>

##### Serializer.logicStyle {#logicstyle-1}

```ts
logicStyle: (expr, level) => "boolean" | "word" | "uppercase-word" | "punctuation";
```

</MemberCard>

<MemberCard>

##### Serializer.powerStyle {#powerstyle-1}

```ts
powerStyle: (expr, level) => "quotient" | "solidus" | "root";
```

</MemberCard>

<MemberCard>

##### Serializer.numericSetStyle {#numericsetstyle-1}

```ts
numericSetStyle: (expr, level) => "compact" | "regular" | "interval" | "set-builder";
```

</MemberCard>

<MemberCard>

##### Serializer.indexStyle {#indexstyle-1}

```ts
indexStyle: (expr, level) => "subscript" | "bracket";
```

</MemberCard>

<MemberCard>

##### Serializer.serializeFunction() {#serializefunction}

```ts
serializeFunction(expr, def?): string
```

####### expr

[`MathJsonExpression`](#mathjsonexpression)

####### def?

`SerializerDictionaryEntry`

</MemberCard>

<MemberCard>

##### Serializer.serializeSymbol() {#serializesymbol}

```ts
serializeSymbol(expr): string
```

####### expr

[`MathJsonExpression`](#mathjsonexpression)

</MemberCard>

<MemberCard>

##### Serializer.wrapString() {#wrapstring}

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

<MemberCard>

##### Serializer.wrapArguments() {#wraparguments}

```ts
wrapArguments(expr): string
```

A string with the arguments of expr fenced appropriately and separated by
commas.

####### expr

[`MathJsonExpression`](#mathjsonexpression)

</MemberCard>

<MemberCard>

##### Serializer.wrapShort() {#wrapshort}

```ts
wrapShort(expr): string
```

Add a group fence around the expression if it is
short (not a function)

####### expr

  \| [`MathJsonExpression`](#mathjsonexpression)
  \| `null`
  \| `undefined`

</MemberCard>

<MemberCard>

### SerializeHandler {#serializehandler}

```ts
type SerializeHandler = (serializer, expr) => string;
```

The `serialize` handler of a custom LaTeX dictionary entry can be
a function of this type.

</MemberCard>

<MemberCard>

### ParseDiagnostic {#parsediagnostic}

```ts
type ParseDiagnostic = {
  code: string;
  start: number;
  end: number;
  detail: Record<string, unknown>;
};
```

An opt-in parse-time diagnostic, collected when a LaTeX string is parsed
with `ce.parse(latex, { diagnostics: true })` and exposed on the top-level
result via `BoxedExpression.parseDiagnostics`.

Diagnostics flag *charitable* parse decisions that are usually errors in
machine-generated LaTeX (LLM output, OCR): a name read as multiplication
where the source looked like a function application, a reference to an
undeclared symbol, an unescaped `%` that discarded input, or trailing noise
silently dropped by error recovery. They are additive metadata — enabling
them never changes the parse output.

### Codes (`code`, an open enum)

- `"undeclared-symbol"` — a parsed symbol reference resolves to no
  declaration (neither a parser-local binding such as a sum index, nor a
  definition in the engine scope). `detail: { name, type }` where `type` is
  the string form of the resolved type (`"unknown"`). Fires at every
  reference site, including plain variables like `x`.
- `"juxtaposition-as-multiply"` — a symbol immediately followed by a
  delimited group `(…)` or a matrix environment was read as multiplication
  rather than function application. `detail: { name, declaredAs }` with
  `declaredAs` one of `"unknown" | "value" | "function"`. `name` is the
  source symbol even when it was lexed as a unit (`\mathrm{N}(2)`) or
  segmented into a letter run (`divisors(60)` → `"divisors"`). When the
  symbol was read as a unit, `detail` additionally carries
  `lexedAs: "unit"`.
- `"comment-discarded"` — an unescaped `%` discarded the rest of a line.
  `detail: { discardedLength }`.
- `"recovered"` — trailing tokens skipped/coerced by non-strict error
  recovery that do not otherwise surface as an `Error` node. `detail` may
  include the skipped fragment as `{ skipped }`.

### Span convention (`start`/`end`)

Spans for `undeclared-symbol` and `juxtaposition-as-multiply` are offsets
into CE's **normalized** LaTeX (the re-serialized token stream), which
matches the original input only when the input round-trips unchanged.
`comment-discarded` is the exception: because the comment is precisely what
was stripped before tokenization, its span is in **original-input**
coordinates. `recovered` spans are a best-effort original-input range (equal
to normalized coordinates for the comment-free trailing noise that recovery
handles). Per the ratified spec, spans are informational; policy should key
on `code` + `detail`.

</MemberCard>

## Numerics

<MemberCard>

### ExactNumericValueData {#exactnumericvaluedata}

```ts
type ExactNumericValueData = {
  rational: Rational;
  radical: number;
  imRational: Rational;
  imRadical: number;
};
```

The value is equal to `rational * sqrt(radical) + imRational * sqrt(imRadical) * i`

Representable set (enforced by `ExactNumericValue`):
- real values: `rational * sqrt(radical)` (imaginary part 0);
- Gaussian rationals: both `radical` and `imRadical` are 1 (e.g. `2+3i`, `1/2-5i/3`);
- pure-imaginary radicals: the real part is 0 (e.g. `√2·i`).

A value needing a radical on both a non-zero real AND a non-zero imaginary
component (e.g. `√2 + √3·i`) is NOT representable exactly.

</MemberCard>

<MemberCard>

### NumericValueData {#numericvaluedata}

```ts
type NumericValueData = {
  re: BigDecimal | number;
  im: number;
};
```

</MemberCard>

<MemberCard>

### NumericValueFactory {#numericvaluefactory}

```ts
type NumericValueFactory = (data) => NumericValue;
```

</MemberCard>

### `abstract` NumericValue {#abstract-numericvalue}

<MemberCard>

##### new NumericValue()

```ts
new NumericValue(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.im {#im-1}

```ts
im: number;
```

The imaginary part of this numeric value.

Can be negative, zero or positive.

</MemberCard>

<MemberCard>

##### NumericValue.type {#type-2}

</MemberCard>

<MemberCard>

##### NumericValue.isExact {#isexact}

True if numeric value is the product of a rational and the square root of an integer.

This includes: 3/4√5, -2, √2, etc...

But it doesn't include 0.5, 3.141592, etc...

</MemberCard>

<MemberCard>

##### NumericValue.asExact {#asexact}

If `isExact()`, returns an ExactNumericValue, otherwise returns undefined.

</MemberCard>

<MemberCard>

##### NumericValue.re {#re-1}

The real part of this numeric value.

Can be negative, 0 or positive.

</MemberCard>

<MemberCard>

##### NumericValue.bignumRe {#bignumre}

bignum version of .re, if available

</MemberCard>

<MemberCard>

##### NumericValue.bignumIm {#bignumim}

</MemberCard>

<MemberCard>

##### NumericValue.numerator {#numerator}

</MemberCard>

<MemberCard>

##### NumericValue.denominator {#denominator}

</MemberCard>

<MemberCard>

##### NumericValue.isNaN {#isnan}

</MemberCard>

<MemberCard>

##### NumericValue.isPositiveInfinity {#ispositiveinfinity}

</MemberCard>

<MemberCard>

##### NumericValue.isNegativeInfinity {#isnegativeinfinity}

</MemberCard>

<MemberCard>

##### NumericValue.isComplexInfinity {#iscomplexinfinity}

</MemberCard>

<MemberCard>

##### NumericValue.isZero {#iszero}

</MemberCard>

<MemberCard>

##### NumericValue.isOne {#isone}

</MemberCard>

<MemberCard>

##### NumericValue.isNegativeOne {#isnegativeone}

</MemberCard>

<MemberCard>

##### NumericValue.isZeroWithTolerance() {#iszerowithtolerance}

```ts
isZeroWithTolerance(_tolerance): boolean
```

####### \_tolerance

`number` \| `BigDecimal`

</MemberCard>

<MemberCard>

##### NumericValue.sgn() {#sgn}

```ts
abstract sgn(): 0 | 1 | -1 | undefined
```

The sign of complex numbers is undefined

</MemberCard>

<MemberCard>

##### NumericValue.N() {#n}

```ts
abstract N(): NumericValue
```

Return a non-exact representation of the numeric value

</MemberCard>

<MemberCard>

##### NumericValue.neg() {#neg}

```ts
abstract neg(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.inv() {#inv}

```ts
abstract inv(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.add() {#add}

```ts
abstract add(other): NumericValue
```

####### other

`number` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.sub() {#sub}

```ts
abstract sub(other): NumericValue
```

####### other

[`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.mul() {#mul}

```ts
abstract mul(other): NumericValue
```

####### other

`number` \| `BigDecimal` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.div() {#div}

```ts
abstract div(other): NumericValue
```

####### other

`number` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.pow() {#pow}

```ts
abstract pow(n): NumericValue
```

####### n

  \| `number`
  \| [`NumericValue`](#abstract-numericvalue)
  \| \{
  `re`: `number`;
  `im`: `number`;
 \}

</MemberCard>

<MemberCard>

##### NumericValue.root() {#root}

```ts
abstract root(n): NumericValue
```

####### n

`number`

</MemberCard>

<MemberCard>

##### NumericValue.sqrt() {#sqrt}

```ts
abstract sqrt(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.gcd() {#gcd}

```ts
abstract gcd(other): NumericValue
```

####### other

[`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.abs() {#abs}

```ts
abstract abs(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.ln() {#ln}

```ts
abstract ln(base?): NumericValue
```

####### base?

`number`

</MemberCard>

<MemberCard>

##### NumericValue.exp() {#exp}

```ts
abstract exp(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.floor() {#floor}

```ts
abstract floor(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.ceil() {#ceil}

```ts
abstract ceil(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.round() {#round}

```ts
abstract round(): NumericValue
```

</MemberCard>

<MemberCard>

##### NumericValue.eq() {#eq}

```ts
abstract eq(other): boolean
```

####### other

`number` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.lt() {#lt}

```ts
abstract lt(other): boolean | undefined
```

####### other

`number` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.lte() {#lte}

```ts
abstract lte(other): boolean | undefined
```

####### other

`number` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.gt() {#gt}

```ts
abstract gt(other): boolean | undefined
```

####### other

`number` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.gte() {#gte}

```ts
abstract gte(other): boolean | undefined
```

####### other

`number` \| [`NumericValue`](#abstract-numericvalue)

</MemberCard>

<MemberCard>

##### NumericValue.valueOf() {#valueof-1}

```ts
valueOf(): string | number
```

Object.valueOf(): returns a primitive value, preferably a JavaScript
 number over a string, even if at the expense of precision

</MemberCard>

<MemberCard>

##### NumericValue.\[toPrimitive\]() {#toprimitive-1}

```ts
toPrimitive: string | number | null
```

Object.toPrimitive()

####### hint

`"string"` \| `"number"` \| `"default"`

</MemberCard>

<MemberCard>

##### NumericValue.toJSON() {#tojson-1}

```ts
toJSON(): unknown
```

Object.toJSON

</MemberCard>

<MemberCard>

##### NumericValue.print() {#print}

```ts
print(): void
```

</MemberCard>

<MemberCard>

### SmallInteger {#smallinteger}

```ts
type SmallInteger = IsInteger<number>;
```

A `SmallInteger` is an integer < 1e6

</MemberCard>

<MemberCard>

### Rational {#rational-1}

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

<MemberCard>

### BigNum {#bignum}

```ts
type BigNum = BigDecimal;
```

</MemberCard>

<MemberCard>

### Sign {#sign}

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

## OEIS

### OEISSequenceInfo {#oeissequenceinfo}

Result from an OEIS lookup operation.

<MemberCard>

##### OEISSequenceInfo.id {#id-1}

```ts
id: string;
```

OEIS sequence ID (e.g., 'A000045')

</MemberCard>

<MemberCard>

##### OEISSequenceInfo.name {#name-2}

```ts
name: string;
```

Sequence name/description

</MemberCard>

<MemberCard>

##### OEISSequenceInfo.terms {#terms}

```ts
terms: number[];
```

First several terms of the sequence

</MemberCard>

<MemberCard>

##### OEISSequenceInfo.formula? {#formula}

```ts
optional formula?: string;
```

Formula or recurrence (if available) — the first formula line

</MemberCard>

<MemberCard>

##### OEISSequenceInfo.formulas? {#formulas}

```ts
optional formulas?: string[];
```

All free-text formula lines, as returned by OEIS (if available)

</MemberCard>

<MemberCard>

##### OEISSequenceInfo.comments? {#comments}

```ts
optional comments?: string[];
```

Comments about the sequence

</MemberCard>

<MemberCard>

##### OEISSequenceInfo.url {#url}

```ts
url: string;
```

URL to the OEIS page

</MemberCard>

### OEISOptions {#oeisoptions}

Options for OEIS operations.

<MemberCard>

##### OEISOptions.timeout? {#timeout}

```ts
optional timeout?: number;
```

Request timeout in milliseconds (default: 10000)

</MemberCard>

<MemberCard>

##### OEISOptions.maxResults? {#maxresults}

```ts
optional maxResults?: number;
```

Maximum number of results to return for lookups (default: 5)

</MemberCard>

### OEISCandidate {#oeiscandidate}

An OEIS-attributed closed-form proposal produced by `ce.interpret()`.

The `expression` has been *verified* to reproduce every extracted sample
exactly. Attribution (`id`, `name`, `url`, `formula`) is mandatory: OEIS data
is CC BY-NC, so a candidate must always carry a link back to its source.

<MemberCard>

##### OEISCandidate.expression {#expression}

```ts
expression: Expression;
```

The parsed and sample-verified closed-form expression.

</MemberCard>

<MemberCard>

##### OEISCandidate.id {#id-2}

```ts
id: string;
```

OEIS sequence ID (e.g., 'A000217').

</MemberCard>

<MemberCard>

##### OEISCandidate.name {#name-3}

```ts
name: string;
```

Sequence name/description.

</MemberCard>

<MemberCard>

##### OEISCandidate.url {#url-1}

```ts
url: string;
```

URL to the OEIS page.

</MemberCard>

<MemberCard>

##### OEISCandidate.formula {#formula-1}

```ts
formula: string;
```

The free-text OEIS formula line the expression was parsed from.

</MemberCard>

### InterpretResult {#interpretresult}

Result of `ce.interpret()`: the sync-recognized form of the input (the same
value the `Interpret` head returns), plus any OEIS-attributed candidates.

<MemberCard>

##### InterpretResult.expression {#expression-1}

```ts
expression: Expression;
```

The recognized expression, or the input unchanged when nothing fired.

</MemberCard>

<MemberCard>

##### InterpretResult.candidates {#candidates}

```ts
candidates: OEISCandidate[];
```

Verified, OEIS-attributed closed-form proposals (possibly empty).

</MemberCard>

## Other

### FunctionPropertyRecord {#functionpropertyrecord}

A single analytic-property record for an operator. The MathJSON fields are
raw (as translated from Fungrim); box them with `ce.expr` to query.

<MemberCard>

##### FunctionPropertyRecord.id {#id}

```ts
readonly id: string;
```

The Fungrim entry id (provenance).

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.property {#property}

```ts
readonly property: string;
```

One of `Poles`, `Zeros`, `BranchPoints`, `BranchCuts`, `Residue`,
`EssentialSingularities`, `IsHolomorphic`, `IsMeromorphic`,
`AnalyticContinuation`, `Solutions`, `ComplexZeroMultiplicity`.

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.var {#var}

```ts
readonly var: string | null;
```

The distinguished variable the property is stated in (e.g. `z`).

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.argIndex {#argindex}

```ts
readonly argIndex: number | null;
```

Index of `var` among the operator's arguments, or null when there is no
single argument position (parametric / composite).

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.expr {#expr}

```ts
readonly expr: ExpressionInput | null;
```

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.domain {#domain}

```ts
readonly domain: ExpressionInput | null;
```

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.point {#point}

```ts
readonly point: ExpressionInput | null;
```

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.condition {#condition}

```ts
readonly condition: ExpressionInput | null;
```

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.value {#value}

```ts
readonly value: ExpressionInput | null;
```

</MemberCard>

<MemberCard>

##### FunctionPropertyRecord.assumptions {#assumptions}

```ts
readonly assumptions: ExpressionInput | null;
```

</MemberCard>

### FunctionProperties {#functionproperties}

Queryable analytic properties of an operator, returned by
`ce.functionProperties(name)`. The set-valued accessors return a boxed set
(e.g. `NonPositiveIntegers`) for the unconditional record of that kind, or
`undefined` when no such record exists. Parametric / conditional records
(e.g. residues that depend on parameters) are available via `entries`.

<MemberCard>

##### FunctionProperties.operator {#operator}

```ts
readonly operator: string;
```

</MemberCard>

<MemberCard>

##### FunctionProperties.entries {#entries}

```ts
readonly entries: readonly FunctionPropertyRecord[];
```

All analytic-property records for this operator.

</MemberCard>

<MemberCard>

##### FunctionProperties.poles {#poles}

```ts
readonly poles: Expression | undefined;
```

</MemberCard>

<MemberCard>

##### FunctionProperties.zeros {#zeros}

```ts
readonly zeros: Expression | undefined;
```

</MemberCard>

<MemberCard>

##### FunctionProperties.branchPoints {#branchpoints}

```ts
readonly branchPoints: Expression | undefined;
```

</MemberCard>

<MemberCard>

##### FunctionProperties.branchCuts {#branchcuts}

```ts
readonly branchCuts: Expression | undefined;
```

</MemberCard>

<MemberCard>

##### FunctionProperties.essentialSingularities {#essentialsingularities}

```ts
readonly essentialSingularities: Expression | undefined;
```

</MemberCard>

<MemberCard>

##### FunctionProperties.holomorphicDomain {#holomorphicdomain}

```ts
readonly holomorphicDomain: Expression | undefined;
```

The domain on which the function is holomorphic.

</MemberCard>

<MemberCard>

##### FunctionProperties.isMeromorphic {#ismeromorphic}

```ts
readonly isMeromorphic: boolean | undefined;
```

Whether the function is meromorphic, when the corpus records it.

</MemberCard>

<MemberCard>

### SymbolTable {#symboltable}

```ts
type SymbolTable = {
  parent: SymbolTable | null;
  ids: {};
};
```

</MemberCard>

<MemberCard>

### newSymbolIds() {#newsymbolids}

```ts
function newSymbolIds(): {}
```

A prototype-free [SymbolTable.ids](#ids) map — see the note there.

</MemberCard>

<MemberCard>

### OperatorDefinition {#operatordefinition}

```ts
type OperatorDefinition = Partial<BaseDefinition> & Partial<OperatorDefinitionFlags> & OperatorTypeHandlerVariant & {
  signature:   | Type
     | TypeString
     | BoxedType;
  inferredSignature: boolean;
  sgn: (ops, options) => Sign | undefined;
  isPositive: boolean;
  isNonNegative: boolean;
  isNegative: boolean;
  isNonPositive: boolean;
  even: (ops, options) => boolean | undefined;
  complexity: number;
  canonical: (ops, options) => Expression | null;
  evaluate:   | ((ops, options) => Expression | undefined)
     | Expression;
  evaluateAsync: (ops, options) => Promise<Expression | undefined>;
  evalDimension: (args, options) => Expression;
  compile: OperatorCompileHandler;
  eq: (a, b, prover?) => boolean | undefined;
  neq: (a, b) => boolean | undefined;
  collection: CollectionHandlers;
  canEnumerate: (expr) => boolean | undefined;
  elementCount: (expr) => number | undefined;
};
```

#### OperatorDefinition.signature?

```ts
optional signature?: 
  | Type
  | TypeString
  | BoxedType;
```

The function signature, describing the type of the arguments and the
return type.

If a `type` handler is provided, the return type of the function should
be a subtype of the return type in the signature.

#### OperatorDefinition.inferredSignature?

```ts
optional inferredSignature?: boolean;
```

If `true`, the `signature` is a starting point to be refined, not a
contract: assigning a function literal to this operator narrows the
signature from the literal's body, and calls type from the narrowed
signature.

Declaring a `signature` normally pins it (`inferredSignature: false`),
which is what you want for a fixed API. Set this to `true` to vouch
that a name is an operator — so `f(x)` parses as an application rather
than a multiplication — while leaving its types to be inferred from the
body assigned later:

```js
ce.declare('q', { signature: '(unknown) -> unknown', inferredSignature: true });
ce.assign('q', ce.parse('t \\mapsto 2t+1'));
// signature is now `(unknown) -> number`, so `q(x) < y` types
// `boolean` and compiles, while `q(L) < y` over a list `L` still types
// `list<boolean>` and fails closed.
```

A declaration that omits `signature` entirely behaves the same way.

#### OperatorDefinition.sgn?

```ts
optional sgn?: (ops, options) => Sign | undefined;
```

Return the sign of the function expression.

If the sign cannot be determined, return `undefined`.

When determining the sign, only literal values and the values of
symbols, if they are literals, should be considered.

Do not evaluate the arguments.

However, the type and sign of the arguments can be used to determine the
sign.

The handler must be a pure function of the operands — the type path
dispatches it while deriving an application's type. See the purity
contract on `OperatorDefinition.sgn`.

#### OperatorDefinition.isPositive?

```ts
readonly optional isPositive?: boolean;
```

The value of this expression is > 0, same as `isGreater(0)`

#### OperatorDefinition.isNonNegative?

```ts
readonly optional isNonNegative?: boolean;
```

The value of this expression is >= 0, same as `isGreaterEqual(0)`

#### OperatorDefinition.isNegative?

```ts
readonly optional isNegative?: boolean;
```

The value of this expression is &lt; 0, same as `isLess(0)`

#### OperatorDefinition.isNonPositive?

```ts
readonly optional isNonPositive?: boolean;
```

The  value of this expression is &lt;= 0, same as `isLessEqual(0)`

#### OperatorDefinition.even?

```ts
optional even?: (ops, options) => boolean | undefined;
```

Return `true` if the function expression is even, `false` if it is odd
and `undefined` if it is neither (for example if it is not a number,
or if it is a complex number).

#### OperatorDefinition.complexity?

```ts
optional complexity?: number;
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

#### OperatorDefinition.canonical?

```ts
optional canonical?: (ops, options) => Expression | null;
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
of the arguments that are symbols or functions (i.e. `arg.is(0)`,
`arg.isInteger`, etc...) since those may change over time.

The result of the handler should be a canonical expression.

If the arguments do not match, they should be replaced with an
appropriate `["Error"]` expression. If the expression cannot be put in
canonical form, the handler should return `null`.

#### OperatorDefinition.evaluate?

```ts
optional evaluate?: 
  | ((ops, options) => Expression | undefined)
  | Expression;
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

#### OperatorDefinition.evaluateAsync?

```ts
optional evaluateAsync?: (ops, options) => Promise<Expression | undefined>;
```

An asynchronous version of `evaluate`.

#### OperatorDefinition.evalDimension?

```ts
optional evalDimension?: (args, options) => Expression;
```

**`Experimental`**

Dimensional analysis

#### OperatorDefinition.compile?

```ts
optional compile?: OperatorCompileHandler;
```

A custom compilation handler for this operator: emit target-language
source for a call to this operator. Takes precedence over the target's
built-in operator/function mapping and its broadcast lowering, so it can
override how a built-in operator compiles (e.g. a custom-tolerance `GCD`,
or a re-mapped `Add`/`Multiply`/`Power`/relational operator).

It does NOT override the structural / control-flow heads, which have
their own bespoke lowering: `Sequence`, `Sum`, `Product`, `Function`,
`Declare`, `Assign`, `Return`, `Break`, `Continue`, `Loop`,
`Comprehension`, `If`, `When`, `Match`, `Block`. A handler
declared on one of those heads is ignored.

Exception: `Which` IS overridable (it has no binding structure — its
operands are plain condition/value pairs a handler can compile through
the callback it is given). To customize how `Which` compiles while
keeping its stock evaluation semantics, attach the handler to the
engine's own definition rather than re-declaring the operator (a
re-declaration replaces the stock `evaluate`/`canonical` handlers):

```ts
const def = ce.lookupDefinition('Which');
if (def && 'operator' in def) def.operator.compile = myWhichHandler;
```

The override is per-engine (each `ComputeEngine` builds its own
standard-library definitions), and the decline contract applies: a
handler returning `undefined` falls back to the built-in `Which`
lowering, coercion and frame-protocol wrapping included.

**Attaching in place is the supported route for EVERY operator the
engine already defines, not only `Which`.** Three things follow from
re-declaring instead, and all three are silent:

- A re-declaration REPLACES the stock `evaluate`/`canonical` handlers.
  Spreading the captured definition (`ce.declare(op, {...orig, compile})`)
  is an attempt to carry them across by hand and is not equivalent —
  attaching to the definition `lookupDefinition` returns keeps them by
  construction, with nothing to carry.
- A re-declaration also replaces the definition's EFFECTS declaration,
  and that is what decides whether a compiled `Sum`/`Product` over a
  body mentioning the operator keeps its NaN early exit — the
  `if (acc !== acc) return NaN;` emitted between terms, valid because
  NaN absorbs `+` and `*`, so once the accumulator is NaN no later
  term can change the answer. An operator definition is GRANTED
  purity, so a re-declaration that states no effects keeps the exit.
  One that states any effects refuses it, since skipping terms would
  skip the effects too — and the lever is the effect SET, not the
  `pure` keyword: `pure` is a derived reading of `effects`, so
  `effects: ['random']` or an effect-annotated signature loses the
  exit exactly as `pure: false` does, while `effects: []` keeps it
  exactly as an unspecified definition does. For this exit, carrying
  a `compile` handler costs nothing by itself, whether it supplies
  source or declines for the target at hand: the gate reads the
  definition's declared effects, not who supplied the code. The one
  shape it cannot catch is a handler emitting effectful source under
  a definition that states no effects.

  The exit this governs is the one the scalar `Sum`/`Product`
  lowering emits through `BaseCompiler.isEmissionSkippable`. An
  element-wise (collection-valued) body carries a separate,
  UNCONDITIONAL latch of the same spelling, emitted so that a
  length mismatch collapsing the fold to a scalar NaN cannot be
  broadcast back over the next term's shape. That latch does not
  consult the declared effects, so declaring effects does not buy
  back the later iterations of an element-wise body.
- Call-sharing is the one cost a handler still pays for being on a
  re-declared definition, and the declared effects do not govern it. A
  `compile` handler the engine did not install is a live-source
  splice the CSE harvest cannot analyse, so every node under that
  head is refused as a candidate and every callee body mentioning it
  is refused with it. A self-recursive body loses the binding that
  made its repeated self-call linear and compiles exponentially —
  measured ×4 per two levels of `R(i,x,y) = R(i-1,x,y) +
  0.5·S(x,y,R(i-1,x,y))`. Declaring `pure: true` on the
  re-declaration does NOT restore sharing. Attaching in place is
  exempt, because the definition is still the engine's own.

The evaluate side is NOT symmetric with the decline contract above:
returning `undefined` from an `evaluate` handler leaves the expression
unevaluated rather than falling back, so a handler that means to
delegate must call the captured original explicitly.

Return `undefined` (or an empty string) to fall back to the
default compilation (a `null` returned from untyped JavaScript is
tolerated and treated the same). See [OperatorCompileHandler](#operatorcompilehandler).

#### OperatorDefinition.eq?

```ts
optional eq?: (a, b, prover?) => boolean | undefined;
```

Custom equality handler.

`prover` indicates the tier of the caller: `false` for the cheap
arithmetic tier (`eq()` / `.isEqual()`), `true` for the prover tier
(`eqIdentical()` / `.isIdenticallyEqual()`), and `undefined` when the
caller does not distinguish (e.g. `cmp()`). A handler that does
prover-tier work (sampling, expand/simplify, identity questions in the
free variables) must decline — return `undefined` — when
`prover === false`.

#### OperatorDefinition.canEnumerate?

```ts
optional canEnumerate?: (expr) => boolean | undefined;
```

For an operator that RETURNS a collection but has no `collection`
handlers (an EAGER producer — `Characters`, `Divisors`, `Eigenvalues`,
…): can `evaluate()` produce the collection's elements in the current
state?

This is the operator's own decline test — the guard at the top of its
`evaluate` handler — exposed so the enumerability facet
(`isEnumerableCollection`) can answer without evaluating. Contract
(see `docs/COLLECTIONS-MODEL.md`):

- MUST be O(1), evaluation-free and side-effect free. An impure
  producer answers from its operands' facets, consuming no draws.
- `false` means evaluation WOULD decline — callers stay inert without
  paying for the evaluation.
- `true` is a hard promise that evaluation produces the collection. An
  operator whose success is not cheaply decidable (`Solve`,
  `FindRoot`) must return `undefined`, never `true`.
- The operand seen here is the CANONICAL operand, not the evaluated
  one. An unevaluated compound operand (`Divisors(n + 1)`) whose value
  cannot be read cheaply must yield `undefined` (undecidable), not
  `false` — only a definitively unavailable operand (a valueless
  symbol, a literal of the wrong kind) yields `false`. See
  `canEnumerateOperand` (`collection-utils.ts`) for the shared
  tri-state resolution.

Ignored (never consulted) when the definition has `collection`
handlers — those own enumerability via `collection.isEnumerable`.

#### OperatorDefinition.elementCount?

```ts
optional elementCount?: (expr) => number | undefined;
```

For an operator that RETURNS a collection but has no `collection`
handlers (an EAGER producer — `Sort`, `Chunk`, `Ordering`, …): how many
elements would `evaluate()` produce?

The `count` twin of [canEnumerate](#operatordefinition), and the honest replacement for
the broadcast count fallback: `count` reads the operands' agreed length
only for a `broadcastable` operator, where agreement IS the semantics
(`docs/BROADCAST-MODEL.md`). A reshaping operator's length is its own
business, so it must say so here or report `undefined`.

Contract, mirroring `canEnumerate`:

- MUST be O(1), evaluation-free and side-effect free. An impure producer
  (`RandomShuffle`) answers from its operands' facets, consuming ZERO
  draws.
- The operands seen here are the CANONICAL ones. Anything not cheaply
  knowable — a non-literal shape argument, an unknown source length —
  must report `undefined` (decline), never a guess.
- A returned number is a hard promise: it must equal
  `expr.evaluate().count`. When evaluation would DECLINE (an infinite or
  unknown-length source), report `undefined` — a count nobody can walk is
  worse than no count (Tycho item-169 ruling).

Consulted only when the definition has no `collection.count` handler —
a declared `count` owns the answer, including its `undefined`.

</MemberCard>

<MemberCard>

### SymbolDefinitions {#symboldefinitions}

```ts
type SymbolDefinitions = Readonly<{}>;
```

</MemberCard>

### ILatexSyntax {#ilatexsyntax}

Minimal interface for a LaTeX parser/serializer.
 Structurally compatible with `LatexSyntax` without importing it.

<MemberCard>

##### ILatexSyntax.parse() {#parse}

```ts
parse(latex, options?): MathJsonExpression | null
```

####### latex

`string`

####### options?

`Partial`\<[`ParseLatexOptions`](#parselatexoptions)\>

</MemberCard>

<MemberCard>

##### ILatexSyntax.serialize() {#serialize-2}

```ts
serialize(expr, options?): string
```

####### expr

[`MathJsonExpression`](#mathjsonexpression)

####### options?

`Record`\<`string`, `unknown`\>

</MemberCard>

<MemberCard>

##### ILatexSyntax.getNamedTriggers()? {#getnamedtriggers}

```ts
optional getNamedTriggers(): readonly {
  name: string;
  triggers: string[];
 }[]
```

Named dictionary entries with their LaTeX trigger strings, for reverse
 library search (`ce.searchDefinitions()`). Optional: MathJSON-only
 builds and minimal injected syntaxes may not implement it.

</MemberCard>

<MemberCard>

### OperatorInfo {#operatorinfo}

```ts
type OperatorInfo = {
  kind: "function" | "opaque";
  signature: BoxedType;
  canEvaluate: boolean;
};
```

</MemberCard>

<MemberCard>

### SymbolInfo {#symbolinfo}

```ts
type SymbolInfo = {
  kind: "constant" | "variable";
  type: BoxedType;
};
```

</MemberCard>

<MemberCard>

### DefinitionSearchResult {#definitionsearchresult}

```ts
type DefinitionSearchResult = {
  id: MathJsonSymbol;
  kind: "function" | "opaque" | "constant" | "variable";
};
```

One result of `ce.searchDefinitions()`.

</MemberCard>

<MemberCard>

### IntegrationProvider {#integrationprovider}

```ts
type IntegrationProvider = (integrand, variable, trace?) => Expression | null;
```

A symbolic-integration provider: given an integrand and the integration
variable, returns a closed-form antiderivative (an expression in `variable`),
or `null` when it cannot integrate it. See `IComputeEngine._integrationProvider`.

When an optional `trace` accumulator is passed (by `expr.explain('Integrate')`),
the provider appends a curated, whole-state step chain describing how the
antiderivative was found. The argument is backward-compatible: the plain
`Integrate` evaluator calls the provider with two arguments and never traces.

</MemberCard>

<MemberCard>

### ProtocolMember {#protocolmember}

```ts
type ProtocolMember = 
  | {
  kind: "function";
  signature: string;
 }
  | {
  kind: "readonly" | "readwrite";
  type: string;
};
```

One requirement of a protocol. A `function` member's signature is stored
VERBATIM, with `Self` unsubstituted: `Self` is a textual substitution token
(ruling P12), never a type the registry can resolve.

</MemberCard>

<MemberCard>

### InferenceWriteEvent {#inferencewriteevent}

```ts
type InferenceWriteEvent = {
  name: string;
  binding: BoxedDefinition;
  target:   | BoxedValueDefinition
     | BoxedOperatorDefinition;
  valueDef: BoxedValueDefinition;
  from: BoxedType;
  to: BoxedType;
  kind: "inferred" | "assumed";
};
```

One write of inference evidence onto a definition, as delivered to
`IComputeEngine._noteInferenceWrite` — the single emission point whose
subscribers are the provenance history, the fresh-inference set, and the
narrowing sink. See `docs/TYPE-SYSTEM.md`
(phase 1).

</MemberCard>

<MemberCard>

### InferenceCauseContext {#inferencecausecontext}

```ts
type InferenceCauseContext = {
  operator: string;
  ops: ReadonlyArray<ExpressionInput>;
  expr: Expression;
};
```

The ambient canonicalization context recorded as the `cause` of provenance
entries: the operator expression being canonicalized when an inference
write fires. Kept as the operator name + the operand array as the
canonicalizer received it (possibly raw MathJSON — canonicalization has
not run yet); `expr` is the non-canonical materialization, built lazily on
the first write that records it (writes are rare — building an expression
per canonicalization would not be).

</MemberCard>

<MemberCard>

### JSImplementation {#jsimplementation}

```ts
type JSImplementation = {
  host: ProtocolHostHandler;
};
```

A HOST (JavaScript) implementation of a protocol member. A callback carries
no type information the engine can read, so — like a host-declared operator
handler — it is TRUSTED: only member-name coverage is checked, never its
signature. Boxed in a wrapper so it stays distinguishable from an Epsil
function literal (design P10).

</MemberCard>

<MemberCard>

### ProtocolHostHandler {#protocolhosthandler}

```ts
type ProtocolHostHandler = (...args) => unknown;
```

A host callback implementing one protocol member. Its arguments arrive as
boxed engine values (the receiver first, per P1); its result is boxed by the
engine. The engine cannot type-check it — that is what "trusted" means
here.

</MemberCard>

<MemberCard>

### ConformanceRecord {#conformancerecord}

```ts
type ConformanceRecord = {
  target: Type;
  targetKey: string;
  where: TypeParameter[];
  impl: Record<string, Expression | JSImplementation>;
  _authored: Record<string, Expression | JSImplementation>;
  _implOrigin: {
     batch: number;
     block: Expression;
    };
  pending: boolean;
  _pendingReason: string;
  declaredByStatement: boolean;
};
```

One conformance edge: "this target type conforms to this protocol".
Conformances are add-only (monotone); only their implementations replace.

</MemberCard>

<MemberCard>

### ProtocolRecord {#protocolrecord}

```ts
type ProtocolRecord = {
  name: string;
  members: Record<string, ProtocolMember>;
  conformances: ConformanceRecord[];
  declaredByStatement: boolean;
  _declOrigin: DeclarationOrigin;
};
```

A protocol declaration and every conformance registered against it.

</MemberCard>

<MemberCard>

### ProtocolMembersInput {#protocolmembersinput}

```ts
type ProtocolMembersInput = {
  functions: Record<string, string>;
  readonly: Record<string, string>;
  readwrite: Record<string, string>;
};
```

The host-API shape of a protocol's requirements. A flat
`Record<string, string>` cannot represent properties, hence the three
buckets (Appendix A "Host API").

</MemberCard>

<MemberCard>

### ProtocolImplementationInput {#protocolimplementationinput}

```ts
type ProtocolImplementationInput = {
  functions: Record<string, ProtocolHostHandler>;
  getters: Record<string, ProtocolHostHandler>;
  setters: Record<string, ProtocolHostHandler>;
};
```

The host-API shape of an IMPLEMENTATION block. Property handlers are given
under their surface names (`getters.hash`), not under the internal
`__get__hash` mangling (Appendix A "Properties": the mangling is an
implementation detail, not part of the public surface).

</MemberCard>

### EngineCheckpoint {#enginecheckpoint}

A handle on a saved engine state, from [IComputeEngine.checkpoint](#checkpoint).
Deliberately opaque: `id` is for logging and `live` is the only state a
client can act on. Declared here rather than in `checkpoint.ts` because it
is part of the engine's public type surface — and because importing it from
the implementation would make this file depend on it, closing a cycle
through the sequence registry.

<MemberCard>

##### EngineCheckpoint.id {#id-4}

```ts
readonly id: number;
```

</MemberCard>

<MemberCard>

##### EngineCheckpoint.live {#live}

```ts
readonly live: boolean;
```

False once invalidated — by a restore to an EARLIER checkpoint, by
`discard()`, or by popping a scope this checkpoint was taken inside
(the pop disposes the scope's bindings, so there is no world left to
restore). A dead checkpoint can never be restored again.

</MemberCard>

### IComputeEngine {#icomputeengine}

#### Extended by

- [`ExpressionComputeEngine`](#expressioncomputeengine)

<MemberCard>

##### IComputeEngine.latexSyntax {#latexsyntax}

```ts
readonly latexSyntax: ILatexSyntax | undefined;
```

The LatexSyntax instance used for LaTeX parsing/serialization.
 `undefined` when no LatexSyntax was provided to the constructor.

</MemberCard>

<MemberCard>

##### IComputeEngine.latexOptions {#latexoptions}

```ts
latexOptions: Partial<ParseLatexOptions & SerializeLatexOptions>;
```

Engine-wide LaTeX parse/serialize options (e.g. `decimalSeparator`).
 Merged into every `parse()` and `toLatex()` call between LatexSyntax
 defaults and per-call overrides.

</MemberCard>

<MemberCard>

##### IComputeEngine.True {#true}

```ts
readonly True: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.False {#false}

```ts
readonly False: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.Pi {#pi}

```ts
readonly Pi: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.E {#e}

```ts
readonly E: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.Nothing {#nothing}

```ts
readonly Nothing: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.Missing {#missing}

```ts
readonly Missing: Expression;
```

The `Missing` symbol: an absent value whose position is preserved.

</MemberCard>

<MemberCard>

##### IComputeEngine.Zero {#zero}

```ts
readonly Zero: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.One {#one}

```ts
readonly One: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.Half {#half}

```ts
readonly Half: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.NegativeOne {#negativeone}

```ts
readonly NegativeOne: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.Two {#two}

```ts
readonly Two: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.I {#i}

```ts
readonly I: Expression;
```

ImaginaryUnit

</MemberCard>

<MemberCard>

##### IComputeEngine.NaN {#nan-1}

```ts
readonly NaN: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.PositiveInfinity {#positiveinfinity-1}

```ts
readonly PositiveInfinity: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.NegativeInfinity {#negativeinfinity-1}

```ts
readonly NegativeInfinity: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.ComplexInfinity {#complexinfinity}

```ts
readonly ComplexInfinity: Expression;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.context {#context}

```ts
readonly context: EvalContext;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.contextStack {#contextstack}

```ts
contextStack: readonly EvalContext[];
```

</MemberCard>

<MemberCard>

##### IComputeEngine.iterationLimit {#iterationlimit}

```ts
iterationLimit: number;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.recursionLimit {#recursionlimit}

```ts
recursionLimit: number;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.maxCollectionSize {#maxcollectionsize}

```ts
maxCollectionSize: number;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.bignum {#bignum-1}

```ts
bignum: (a) => BigDecimal;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.complex {#complex-1}

```ts
complex: (a, b?) => Complex;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.tolerance {#tolerance}

```ts
tolerance: number;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.angularUnit {#angularunit-1}

```ts
angularUnit: AngularUnit;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.costFunction {#costfunction-1}

```ts
costFunction: (expr) => number;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.simplificationRules {#simplificationrules}

```ts
simplificationRules: Rule[];
```

The rules used by `.simplify()` when no explicit `rules` option is passed.
 Initialized to the built-in simplification rules.
 Users can `push()` additional rules or replace the entire array.

</MemberCard>

<MemberCard>

##### IComputeEngine.solveRules {#solverules}

```ts
solveRules: Rule[];
```

The rules used by `solve()` to find roots of univariate expressions.
 Each rule matches a normalized equation `f(_x) = 0` — the unknown is
 the wildcard `_x` — and `replace` produces a root expression.
 Conditions should reject matches where other wildcards capture `_x`.
 Candidate roots are validated against the original equation, so an
 over-eager template degrades to a no-op rather than a wrong answer.
 Initialized to the built-in root-finding rules; `push()` to extend,
 assign to replace.

</MemberCard>

<MemberCard>

##### IComputeEngine.harmonizationRules {#harmonizationrules}

```ts
harmonizationRules: Rule[];
```

The rules used by `solve()` to transform an equation into equivalent,
 easier-to-solve forms before root-finding (e.g. `ln f(x) → f(x) - 1`).
 Same conventions and extension pattern as `solveRules`.

</MemberCard>

<MemberCard>

##### IComputeEngine.strict {#strict}

```ts
strict: boolean;
```

</MemberCard>

<MemberCard>

##### IComputeEngine.jit {#jit}

```ts
jit: "auto" | "off";
```

Whether the engine may implicitly generate and execute compiled code as
a performance optimization (auto-compiled `Map` drains, compiled numeric
quadrature/limit kernels). `'auto'` (default) attempts implicit
compilation and latches to `'off'` engine-wide on the first CSP
`EvalError`; `'off'` never attempts it. Explicit `compile()` is exempt.

</MemberCard>

<MemberCard>

##### IComputeEngine.trace {#trace}

```ts
trace: readonly string[];
```

A list of the function calls to the current evaluation context

</MemberCard>

<MemberCard>

##### IComputeEngine.precision {#precision}

```ts
get precision(): number
set precision(p: number | "auto" | "machine"): void
```

</MemberCard>

<MemberCard>

##### IComputeEngine.checkpoint() {#checkpoint}

```ts
checkpoint(label?): EngineCheckpoint
```

Take a checkpoint of the engine's state at a quiescent point — between
statements, at any scope depth — so a later [restore](#restore) can rewind
to it. Legal on a freshly constructed engine, which is how a client gets
a `cp[0]` covering an edit of the first cell, and inside a host-pushed
scope, which is how a notebook takes per-cell checkpoints within a pass.
A checkpoint taken inside a scope dies when that scope pops. Throws a
`CheckpointError` when the engine is mid-evaluation or mid-pre-pass;
[restore](#restore) additionally requires the same scope stack the
checkpoint was taken on.

####### label?

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.restore() {#restore}

```ts
restore(cp): void
```

Rewind to `cp`, invalidating every checkpoint taken after it; `cp` itself
stays live and can be restored again. Expressions built BEFORE `cp` stay
valid — their definitions are rewritten in place. Expressions built
during the rewound window are not: cache cell outputs as serialized
artifacts, never as live boxed nodes.

####### cp

[`EngineCheckpoint`](#enginecheckpoint)

</MemberCard>

<MemberCard>

##### IComputeEngine.discard() {#discard}

```ts
discard(cp): void
```

Release `cp`'s restore capability. Restoring past a discarded INTERIOR
checkpoint stays possible through any earlier live one; discarding the
OLDEST makes the state before the next-younger one unreachable.

####### cp

[`EngineCheckpoint`](#enginecheckpoint)

</MemberCard>

<MemberCard>

##### IComputeEngine.declareProtocol() {#declareprotocol}

```ts
declareProtocol(name, members): void
```

Declare a protocol (Appendix A "Host API"). Throws on error, including
on re-declaration — the Epsil statement route replaces instead (P5).

####### name

`string`

####### members

[`ProtocolMembersInput`](#protocolmembersinput)

</MemberCard>

<MemberCard>

##### IComputeEngine.declareProtocolImplementation() {#declareprotocolimplementation}

```ts
declareProtocolImplementation(
   type, 
   protocol, 
   impl, 
   options?): void
```

Implement `protocol` for `type`, declaring the conformance edge if it is
not already registered (Appendix A "Host API").

THROWS on every error — the host channel; the Epsil statement route
returns error VALUES instead. A second host implementation of the same
(type, protocol) pair throws rather than replacing (P5).

The callbacks are JavaScript functions, so they carry no signature the
engine can check: they are trusted like host-declared operator handlers,
and only member-name coverage, unknown members and a `set` handler on a
`readonly` property are validated.

`options.where` declares a CONDITIONAL conformance: `type` is then a HEAD
PATTERN naming the variables (`'list<T>'`) and `where` is the clause SOURCE
that binds them (`'where T is Comparable'`; the `where` word may be
omitted). A malformed clause, or a head variable the clause does not bind,
throws.

####### type

`string`

####### protocol

`string`

####### impl

[`ProtocolImplementationInput`](#protocolimplementationinput)

####### options?

####### where?

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.withTimeLimit() {#withtimelimit}

```ts
withTimeLimit<T>(limit, fn): T
```

Run `fn` with at most `ms` milliseconds (numeric form) or `limit.ms`
(object form, which also accepts an attribution `label`). A tighter
enclosing span preempts this limit; use the label and
`CancellationError.attribution`/`spans` to tell which limit fired.

**⚠️ `fn` MUST be synchronous.** The span is restored in a synchronous
`finally`, so a `Promise`-returning (`async`) callback hands control back
at its first `await` while the span is still open: work that resumes after
that point runs **outside** the deadline and is never cancelled (see
`docs/TIMEOUT-MODEL.md` §6.4). For asynchronous cancellation use
`expr.evaluateAsync({ signal })` with an `AbortSignal` instead.

• T

####### limit

  \| `number`
  \| \{
  `ms`: `number`;
  `label`: `string`;
 \}

####### fn

() => `T` *extends* `Promise`\<`unknown`\> ? `never` : `T`

</MemberCard>

<MemberCard>

##### IComputeEngine.chop() {#chop}

###### chop(n)

```ts
chop(n): number
```

####### n

`number`

###### chop(n)

```ts
chop(n): 0 | BigDecimal
```

####### n

`BigDecimal`

###### chop(n)

```ts
chop(n): number | BigDecimal
```

####### n

`number` \| `BigDecimal`

</MemberCard>

<MemberCard>

##### IComputeEngine.expr() {#expr-2}

```ts
expr(expr, options?): Expression
```

####### expr

  \| [`NumericValue`](#abstract-numericvalue)
  \| [`ExpressionInput`](#expressioninput)

####### options?

####### form?

[`FormOption`](#formoption)

####### scope?

`Scope`

</MemberCard>

<MemberCard>

##### IComputeEngine.~~box()~~ {#box}

```ts
box(expr, options?): Expression
```

####### expr

  \| [`NumericValue`](#abstract-numericvalue)
  \| [`ExpressionInput`](#expressioninput)

####### options?

####### form?

[`FormOption`](#formoption)

####### scope?

`Scope`

###### Deprecated

Use `expr()` instead.

</MemberCard>

<MemberCard>

##### IComputeEngine.parse() {#parse-1}

###### parse(latex, options)

```ts
parse(latex, options?): Expression
```

Parse a LaTeX string and return a boxed expression.

This is a convenience method equivalent to `ce.expr(parse(latex))`,
but uses the engine's symbol definitions for better parsing accuracy.

`options.scope` RECEIVES the parse's writes: the whole parse runs with
that scope as the current lexical scope, so name resolution (including
the parser's symbol oracle) walks `scope → parents`, and every
auto-declare and inference lands rooted there. Discarding the scope
discards the writes. Use `ce.createScope()` to make one that can be read
back.

`options.speculative` leaves NO trace in the engine's type state: the
parse runs inside a transient scope (auto-declares land there and are
discarded with it), and every ambient symbol whose type is currently
inferred is shadowed in that scope with its current type — so a
narrowing use in `latex` refines the discarded shadow instead of
persistently narrowing the ambient symbol. Use it for derive-style
parses that only READ the result (its type, structure, or
serialization): the result's bindings refer to the discarded scope, so
do not retain, evaluate, or compare it against later expressions.
Mutually exclusive with `scope`.

####### latex

`string`

####### options?

`Partial`\<[`ParseLatexOptions`](#parselatexoptions)\> & \{
  `form`: [`FormOption`](#formoption);
  `scope`: `Scope`;
  `speculative`: `boolean`;
 \}

###### parse(latex, options)

```ts
parse(latex, options?): Expression | null
```

####### latex

`string` \| `null`

####### options?

`Partial`\<[`ParseLatexOptions`](#parselatexoptions)\> & \{
  `form`: [`FormOption`](#formoption);
  `scope`: `Scope`;
  `speculative`: `boolean`;
 \}

</MemberCard>

<MemberCard>

##### IComputeEngine.appliedNonFunctions() {#appliednonfunctions}

```ts
appliedNonFunctions(latex): string[]
```

The symbols that appear in function-application syntax `f(…)` in `latex`
but are not defined as functions in the current scope (so they parse as
implicit multiplication or are left unresolved). Scope-aware and
side-effect-free. Intended to flag calls to undefined functions in tools
such as notebooks; intersect with [Expression.freeVariables](#freevariables)
to drop deliberate multiplication of defined values.

Only parenthesized-group application is detected: a symbol juxtaposed
with a matrix environment (`\mathrm{Eigenvalues}\begin{pmatrix}…`) is
not reported, since a matrix never reaches the symbol-with-delimiter
juxtaposition analysis.

####### latex

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.function() {#function}

```ts
function(name, ops, options?): Expression
```

####### name

`string`

####### ops

readonly [`ExpressionInput`](#expressioninput)[]

####### options?

####### metadata?

[`Metadata`](#metadata-1)

####### form?

[`FormOption`](#formoption)

####### scope?

`Scope`

</MemberCard>

<MemberCard>

##### IComputeEngine.\_getCompilationTarget() {#_getcompilationtarget}

###### \_getCompilationTarget(name)

```ts
_getCompilationTarget(name): 
  | JavaScriptCompilationTarget<Expression>
  | undefined
```

####### name

`"javascript"`

###### \_getCompilationTarget(name)

```ts
_getCompilationTarget(name): 
  | LanguageTarget<Expression, string, unknown, number>
  | undefined
```

####### name

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.number() {#number-1}

```ts
number(value, options?): Expression
```

####### value

  \| `string`
  \| `number`
  \| `bigint`
  \| [`MathJsonNumberObject`](#mathjsonnumberobject)
  \| `BigDecimal`
  \| [`Rational`](#rational-1)
  \| [`NumericValue`](#abstract-numericvalue)
  \| `Complex`

####### options?

####### metadata?

[`Metadata`](#metadata-1)

####### canonical?

[`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<MemberCard>

##### IComputeEngine.symbol() {#symbol}

```ts
symbol(sym, options?): Expression
```

####### sym

`string`

####### options?

####### canonical?

[`CanonicalOptions`](#canonicaloptions)

####### metadata?

[`Metadata`](#metadata-1)

####### autoDeclare?

`boolean`

</MemberCard>

<MemberCard>

##### IComputeEngine.string() {#string-1}

```ts
string(s, metadata?): Expression
```

####### s

`string`

####### metadata?

[`Metadata`](#metadata-1)

</MemberCard>

<MemberCard>

##### IComputeEngine.character() {#character-1}

```ts
character(s, metadata?): Expression
```

Create a boxed character — one user-perceived character.

`s` must be exactly one grapheme cluster after NFC normalization; use the
`CharacterFrom` operator when the content is not known to satisfy that, as
it reports a diagnostic instead.

####### s

`string`

####### metadata?

[`Metadata`](#metadata-1)

</MemberCard>

<MemberCard>

##### IComputeEngine.error() {#error-1}

```ts
error(message, where?): Expression
```

####### message

`string` \| `string`[]

####### where?

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.typeError() {#typeerror}

```ts
typeError(expectedType, actualType, where?): Expression
```

####### expectedType

[`Type`](#type-3)

####### actualType

  \| [`Type`](#type-3)
  \| [`BoxedType`](#boxedtype)
  \| `undefined`

####### where?

[`ExpressionInput`](#expressioninput)

</MemberCard>

<MemberCard>

##### IComputeEngine.hold() {#hold}

```ts
hold(expr): Expression
```

####### expr

[`ExpressionInput`](#expressioninput)

</MemberCard>

<MemberCard>

##### IComputeEngine.tuple() {#tuple}

###### tuple(elements)

```ts
tuple(...elements): Expression
```

####### elements

...readonly `number`[]

###### tuple(elements)

```ts
tuple(...elements): Expression
```

####### elements

...readonly [`Expression`](#expression-5)[]

</MemberCard>

<MemberCard>

##### IComputeEngine.type() {#type-10}

```ts
type(type): BoxedType
```

####### type

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### IComputeEngine.rules() {#rules-1}

```ts
rules(rules, options?): BoxedRuleSet
```

####### rules

`Rule` \| readonly Rule \| BoxedRule[] \| `BoxedRuleSet` \| `null` \| `undefined`

####### options?

####### canonical?

`boolean`

####### purpose?

[`RulePurpose`](#rulepurpose)

Default purpose applied to any rule in the set that doesn't carry
 its own `purpose` tag (a per-rule tag takes precedence).

</MemberCard>

<MemberCard>

##### IComputeEngine.getRuleSet() {#getruleset}

```ts
getRuleSet(id?): BoxedRuleSet | undefined
```

####### id?

`"harmonization"` \| `"solve-univariate"` \| `"standard-simplification"`

</MemberCard>

<MemberCard>

##### IComputeEngine.pushScope() {#pushscope}

```ts
pushScope(scope?, name?): void
```

####### scope?

`Scope`

####### name?

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.popScope() {#popscope}

```ts
popScope(): void
```

</MemberCard>

<MemberCard>

##### IComputeEngine.createScope() {#createscope}

```ts
createScope(bindings?, parent?): InspectableScope
```

####### bindings?

`Record`\<`string`, 
  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`TaggedValueDefinition`](#taggedvaluedefinition)
  \| [`TaggedOperatorDefinition`](#taggedoperatordefinition)\>

####### parent?

`Scope`

</MemberCard>

<MemberCard>

##### IComputeEngine.lookupDefinition() {#lookupdefinition-1}

```ts
lookupDefinition(id): BoxedDefinition | undefined
```

####### id

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.assign() {#assign}

###### assign(ids)

```ts
assign(ids): IComputeEngine
```

####### ids

###### assign(id, value)

```ts
assign(id, value): IComputeEngine
```

####### id

`string`

####### value

`AssignValue`

###### assign(arg1, arg2)

```ts
assign(arg1, arg2?): IComputeEngine
```

####### arg1

`string` \| \{\}

####### arg2?

`AssignValue`

</MemberCard>

<MemberCard>

##### IComputeEngine.declareType() {#declaretype}

```ts
declareType(name, type, options?): void
```

####### name

`string`

####### type

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

####### options?

####### alias?

`boolean`

####### fromStatement?

`boolean`

####### mint?

`boolean`

####### typeParams?

[`TypeParamsOption`](#typeparamsoption)

</MemberCard>

<MemberCard>

##### IComputeEngine.declare() {#declare}

###### declare(symbols)

```ts
declare(symbols): IComputeEngine
```

####### symbols

###### declare(id, def, scope)

```ts
declare(id, def, scope?): IComputeEngine
```

####### id

`string`

####### def

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| `Partial`\<`OnlyFirst`\<[`ValueDefinition`](#valuedefinition), [`BaseDefinition`](#basedefinition) & \{
  `holdUntil`: `"never"` \| `"evaluate"` \| `"N"`;
  `type`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferred`: `boolean`;
  `effectsDeclared`: `boolean`;
  `value`: ExpressionInput \| ((ce: ComputeEngine) =\> Expression \| null);
  `eq`: (`a`) => `boolean` \| `undefined`;
  `neq`: (`a`) => `boolean` \| `undefined`;
  `cmp`: (`a`) => `"<"` \| `">"` \| `"="` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `subscriptEvaluate`: (`subscript`, `options`) => [`Expression`](#expression-5) \| `undefined`;
 \} & [`OperatorDefinition`](#operatordefinition)\>\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"expressions"`;
  `type`: [`OperatorTypeHandlerOnExpressions`](#operatortypehandleronexpressions);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"types"`;
  `type`: [`OperatorTypeHandlerOnTypes`](#operatortypehandlerontypes);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>

####### scope?

`Scope`

###### declare(arg1, arg2, arg3)

```ts
declare(arg1, arg2?, arg3?): IComputeEngine
```

####### arg1

`string` \| \{\}

####### arg2?

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| `Partial`\<`OnlyFirst`\<[`ValueDefinition`](#valuedefinition), [`BaseDefinition`](#basedefinition) & \{
  `holdUntil`: `"never"` \| `"evaluate"` \| `"N"`;
  `type`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferred`: `boolean`;
  `effectsDeclared`: `boolean`;
  `value`: ExpressionInput \| ((ce: ComputeEngine) =\> Expression \| null);
  `eq`: (`a`) => `boolean` \| `undefined`;
  `neq`: (`a`) => `boolean` \| `undefined`;
  `cmp`: (`a`) => `"<"` \| `">"` \| `"="` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `subscriptEvaluate`: (`subscript`, `options`) => [`Expression`](#expression-5) \| `undefined`;
 \} & [`OperatorDefinition`](#operatordefinition)\>\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"expressions"`;
  `type`: [`OperatorTypeHandlerOnExpressions`](#operatortypehandleronexpressions);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>
  \| `Partial`\<`Partial`\<[`BaseDefinition`](#basedefinition)\> & `Partial`\<[`OperatorDefinitionFlags`](#operatordefinitionflags)\> & \{
  `typeHandlerKind`: `"types"`;
  `type`: [`OperatorTypeHandlerOnTypes`](#operatortypehandlerontypes);
 \} & \{
  `signature`:   \| `string`
     \| [`AlgebraicType`](#algebraictype)
     \| [`NegationType`](#negationtype)
     \| [`CollectionType`](#collectiontype)
     \| [`ListType`](#listtype)
     \| [`SetType`](#settype)
     \| [`BroadcastableType`](#broadcastabletype)
     \| [`RecordType`](#recordtype)
     \| [`ObjectType`](#objecttype)
     \| [`DictionaryType`](#dictionarytype)
     \| [`TupleType`](#tupletype)
     \| [`SymbolType`](#symboltype)
     \| [`ExpressionType`](#expressiontype)
     \| [`NumericType`](#numerictype)
     \| [`FunctionSignature`](#functionsignature)
     \| [`ValueType`](#valuetype)
     \| [`TypeVariable`](#typevariable)
     \| [`TypeReference`](#typereference)
     \| [`BoxedType`](#boxedtype);
  `inferredSignature`: `boolean`;
  `sgn`: (`ops`, `options`) => [`Sign`](#sign) \| `undefined`;
  `isPositive`: `boolean`;
  `isNonNegative`: `boolean`;
  `isNegative`: `boolean`;
  `isNonPositive`: `boolean`;
  `even`: (`ops`, `options`) => `boolean` \| `undefined`;
  `complexity`: `number`;
  `canonical`: (`ops`, `options`) => [`Expression`](#expression-5) \| `null`;
  `evaluate`:   \| [`Expression`](#expression-5)
     \| ((`ops`, `options`) => [`Expression`](#expression-5) \| `undefined`);
  `evaluateAsync`: (`ops`, `options`) => `Promise`\<[`Expression`](#expression-5) \| `undefined`\>;
  `evalDimension`: (`args`, `options`) => [`Expression`](#expression-5);
  `compile`: [`OperatorCompileHandler`](#operatorcompilehandler);
  `eq`: (`a`, `b`, `prover?`) => `boolean` \| `undefined`;
  `neq`: (`a`, `b`) => `boolean` \| `undefined`;
  `collection`: [`CollectionHandlers`](#collectionhandlers);
  `canEnumerate`: (`expr`) => `boolean` \| `undefined`;
  `elementCount`: (`expr`) => `number` \| `undefined`;
 \} & \{
  `holdUntil`: `undefined`;
  `inferred`: `undefined`;
  `value`: `undefined`;
  `cmp`: `undefined`;
  `subscriptEvaluate`: `undefined`;
 \}\>

####### arg3?

`Scope`

</MemberCard>

<MemberCard>

##### IComputeEngine.assume() {#assume}

```ts
assume(predicate): AssumeResult
```

####### predicate

`string` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### IComputeEngine.declareSequence() {#declaresequence}

```ts
declareSequence(name, def): IComputeEngine
```

Declare a sequence with a recurrence relation.

####### name

`string`

####### def

[`SequenceDefinition`](#sequencedefinition)

###### Example

```typescript
// Fibonacci sequence
ce.declareSequence('F', {
  base: { 0: 0, 1: 1 },
  recurrence: 'F_{n-1} + F_{n-2}',
});
ce.parse('F_{10}').evaluate();  // → 55
```

</MemberCard>

<MemberCard>

##### IComputeEngine.getSequenceStatus() {#getsequencestatus}

```ts
getSequenceStatus(name): SequenceStatus
```

Get the status of a sequence definition.

####### name

`string`

###### Example

```typescript
ce.parse('F_0 := 0').evaluate();
ce.getSequenceStatus('F');
// → { status: 'pending', hasBase: true, hasRecurrence: false, baseIndices: [0] }
```

</MemberCard>

<MemberCard>

##### IComputeEngine.getSequence() {#getsequence}

```ts
getSequence(name): SequenceInfo | undefined
```

Get information about a defined sequence.
Returns `undefined` if the symbol is not a sequence.

####### name

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.listSequences() {#listsequences}

```ts
listSequences(): string[]
```

List all defined sequences.
Returns an array of sequence names.

</MemberCard>

<MemberCard>

##### IComputeEngine.isSequence() {#issequence}

```ts
isSequence(name): boolean
```

Check if a symbol is a defined sequence.

####### name

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.clearSequenceCache() {#clearsequencecache}

```ts
clearSequenceCache(name?): void
```

Clear the memoization cache for a sequence.
If no name is provided, clears caches for all sequences.

####### name?

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.getSequenceCache() {#getsequencecache}

```ts
getSequenceCache(name): 
  | Map<string | number, Expression>
  | undefined
```

Get the memoization cache for a sequence.
Returns a Map of index → value, or `undefined` if not a sequence or memoization is disabled.

For single-index sequences, keys are numbers.
For multi-index sequences, keys are comma-separated strings (e.g., '5,2').

####### name

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.getSequenceTerms() {#getsequenceterms}

```ts
getSequenceTerms(
   name, 
   start, 
   end, 
   step?): Expression[] | undefined
```

Generate a list of sequence terms from start to end (inclusive).

####### name

`string`

The sequence name

####### start

`number`

Starting index (inclusive)

####### end

`number`

Ending index (inclusive)

####### step?

`number`

Step size (default: 1)

###### Example

```typescript
ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
ce.getSequenceTerms('F', 0, 10);
// → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
```

</MemberCard>

<MemberCard>

##### IComputeEngine.lookupOEIS() {#lookupoeis}

```ts
lookupOEIS(terms, options?): Promise<OEISSequenceInfo[]>
```

Look up sequences in OEIS by their terms.

####### terms

(`number` \| [`Expression`](#expression-5))[]

Array of sequence terms to search for

####### options?

[`OEISOptions`](#oeisoptions)

Optional configuration (timeout, maxResults)

###### Example

```typescript
const results = await ce.lookupOEIS([0, 1, 1, 2, 3, 5, 8, 13]);
// → [{ id: 'A000045', name: 'Fibonacci numbers', ... }]
```

</MemberCard>

<MemberCard>

##### IComputeEngine.checkSequenceOEIS() {#checksequenceoeis}

```ts
checkSequenceOEIS(name, count?, options?): Promise<{
  matches: OEISSequenceInfo[];
  terms: number[];
}>
```

Check if a defined sequence matches an OEIS sequence.

####### name

`string`

Name of the defined sequence

####### count?

`number`

Number of terms to check (default: 10)

####### options?

[`OEISOptions`](#oeisoptions)

Optional configuration

###### Example

```typescript
ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
const result = await ce.checkSequenceOEIS('F', 10);
// → { matches: [{ id: 'A000045', name: 'Fibonacci numbers', ... }], terms: [0, 1, 1, ...] }
```

</MemberCard>

<MemberCard>

##### IComputeEngine.interpret() {#interpret}

```ts
interpret(expr, options?): Promise<InterpretResult>
```

Interpret a notational expression, then propose OEIS-attributed closed
forms for it (the async v4 of the `Interpret` ladder).

`result.expression` is exactly what the synchronous `Interpret` head
returns (a `Sum`/`Product`, or the input unchanged); `result.candidates`
are OEIS-attributed closed forms, each verified to reproduce every
extracted sample exactly. This is the only interpretation path that
performs a network lookup. Too few samples, being offline, a timeout, or an
empty result all yield an empty candidate list rather than a rejection.

####### expr

[`Expression`](#expression-5)

The (typically inert, continuation-bearing) expression

####### options?

[`OEISOptions`](#oeisoptions)

OEIS request options (timeout, maxResults)

###### Example

```typescript
const { expression, candidates } = await ce.interpret(
  ce.parse('1 + 3 + 6 + 10 + \\cdots + n')
);
```

</MemberCard>

<MemberCard>

##### IComputeEngine.forget() {#forget}

```ts
forget(symbol?): void
```

####### symbol?

`string` \| `string`[]

</MemberCard>

<MemberCard>

##### IComputeEngine.ask() {#ask}

```ts
ask(pattern): BoxedSubstitution[]
```

####### pattern

[`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### IComputeEngine.verify() {#verify}

```ts
verify(query): boolean | undefined
```

####### query

`string` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### IComputeEngine.operatorInfo() {#operatorinfo-1}

```ts
operatorInfo(head): OperatorInfo | undefined
```

Introspect a registered operator head.

Returns `undefined` if no definition is registered in this engine.
Otherwise returns `{ kind, signature? }` where `kind` is `'function'`
when the operator has an `evaluate` or `collection` handler, and
`'opaque'` when it is declared as a typed-but-opaque node (e.g.,
`Triangle`, `Sphere`).

Use this to classify heads encountered in parsed MathJSON without
maintaining a parallel list of "known" operators.

####### head

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.normalizeIdentifier() {#normalizeidentifier}

```ts
normalizeIdentifier(latex): string
```

Convert a LaTeX identifier string to its canonical MathJSON name without
declaring the symbol in the engine scope.

Examples:
- `'R_{3}'` → `'R_3'`
- `'\\theta_x'` → `'theta_x'`
- `'\\alpha'` → `'alpha'`
- `'1 + 2'` → `''` (not an identifier)

Use this instead of `ce.parse(latex).symbol` when you need the canonical
name without the side-effect of auto-declaring the symbol.

####### latex

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.symbolInfo() {#symbolinfo-1}

```ts
symbolInfo(name): SymbolInfo | undefined
```

Return introspection metadata for a symbol (value definition) in the
current scope chain.

- `kind: 'constant'` when the symbol is a CE-registered constant
  (e.g. `Pi`, `True`, `ExponentialE`).
- `kind: 'variable'` for declared but non-constant value symbols
  (e.g. after `ce.declare('a', 'real')`).

Returns `undefined` for unknown names and for names that resolve to
operator/function definitions (use `operatorInfo()` for those — the
two methods are non-overlapping).

####### name

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.searchDefinitions() {#searchdefinitions}

```ts
searchDefinitions(query, options?): DefinitionSearchResult[]
```

Reverse library search: map plain-text concept keywords to a ranked list
of matching identifiers in the current scope chain (standard library plus
any user declarations).

The query is a string (tokenized on whitespace) or an array of strings;
tokens are OR-ed — a definition matches when **any** token matches — and
definitions matching more tokens, or matching them more exactly, rank
higher.

Every returned `id` resolves via `ce.lookupDefinition(id)`; chain that
call for full detail.

####### query

`string` \| `string`[]

####### options?

####### limit?

`number`

</MemberCard>

<MemberCard>

##### IComputeEngine.suggestOperatorName() {#suggestoperatorname}

```ts
suggestOperatorName(name): string | undefined
```

Given a `name` that is **not** a known operator, return the closest known
operator name — a "did you mean" suggestion — or `undefined` when nothing
is close enough. Powers the Epsil `unknown-function` diagnostic.

Matching is conservative and applied in priority order (first match wins):
case-insensitive exact match, singular/plural, Damerau–Levenshtein
distance (≤ 2 for names of length ≥ 6, ≤ 1 for length 5, never for
shorter names), then a prefix match against exactly one operator. Ties
prefer the candidate sharing the longest prefix with the query.

```ts
ce.suggestOperatorName('Quartile'); // → 'Quartiles'
ce.suggestOperatorName('foo');      // → undefined
```

####### name

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.functionProperties() {#functionproperties-1}

```ts
functionProperties(name): FunctionProperties | undefined
```

Return the known analytic properties of an operator — poles, zeros, branch
points/cuts, residues, holomorphic/meromorphic domains — drawn from the
Fungrim-derived metadata store, or `undefined` if none are recorded.

```ts
ce.functionProperties('Gamma')?.poles?.toString(); // 'NonPositiveIntegers'
```

The set-valued accessors (`poles`, `zeros`, ...) return a boxed set for the
unconditional record of that kind; parametric / conditional records (e.g.
residues that depend on parameters) are available via `entries`.

####### name

`string`

</MemberCard>

<MemberCard>

##### IComputeEngine.toJSON() {#tojson-2}

```ts
toJSON(): string
```

Debug representation, e.g. for `JSON.stringify()`.

</MemberCard>

<MemberCard>

### RuleStep {#rulestep}

```ts
type RuleStep = KernelRuleStep<Expression>;
```

A single rule application step with provenance.

</MemberCard>

<MemberCard>

### RuleSteps {#rulesteps}

```ts
type RuleSteps = KernelRuleSteps<Expression>;
```

A list of rule application steps.

</MemberCard>

<MemberCard>

### ExplainStep {#explainstep}

```ts
type ExplainStep = KernelExplainStep<Expression>;
```

One step of an `Explanation`. See `expr.explain()`.

</MemberCard>

<MemberCard>

### Explanation {#explanation}

```ts
type Explanation = KernelExplanation<Expression>;
```

A structured step-by-step explanation. See `expr.explain()`.

</MemberCard>

<MemberCard>

### BoxedRule {#boxedrule}

```ts
type BoxedRule = KernelBoxedRule<Expression, IComputeEngine>;
```

A boxed/normalized rule form.

</MemberCard>

<MemberCard>

### BoxedRuleSet {#boxedruleset}

```ts
type BoxedRuleSet = KernelBoxedRuleSet<Expression, IComputeEngine>;
```

Collection of boxed rules.

</MemberCard>

<MemberCard>

### Scope {#scope}

```ts
type Scope = KernelScope<BoxedDefinition>;
```

Lexical scope specialized to boxed definitions.

</MemberCard>

<MemberCard>

### InspectableScope {#inspectablescope}

```ts
type InspectableScope = KernelInspectableScope<BoxedDefinition>;
```

A caller-owned, readable lexical scope — the product of
`ce.createScope()`. Specialized to boxed definitions.

</MemberCard>

<MemberCard>

### ScopeDeclaration {#scopedeclaration}

```ts
type ScopeDeclaration = KernelScopeDeclaration<BoxedDefinition>;
```

One entry of an [InspectableScope](#inspectablescope) harvest.

</MemberCard>

<MemberCard>

### ScopeNarrowing {#scopenarrowing}

```ts
type ScopeNarrowing = KernelScopeNarrowing<BoxedDefinition>;
```

One outer-definition narrowing observed by an [InspectableScope](#inspectablescope).

</MemberCard>

<MemberCard>

### EvalContext {#evalcontext}

```ts
type EvalContext = KernelEvalContext<Expression, BoxedDefinition>;
```

Evaluation context specialized to this engine/runtime model.

</MemberCard>

### Expression {#expression-5}

#### Function Expression

<MemberCard>

##### Expression.operator {#operator-4}

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

#### Latex Parsing and Serialization

<MemberCard>

##### Expression.parseDiagnostics? {#parsediagnostics}

```ts
optional parseDiagnostics?: readonly ParseDiagnostic[];
```

Parse-time diagnostics collected when the expression was produced by
`ce.parse(latex, { diagnostics: true })`.

This property is present (as a possibly-empty, frozen array) **only** on
the top-level expression returned by a `diagnostics: true` parse; it is
`undefined` everywhere else (sub-expressions, and any expression parsed
without the flag). Diagnostics are purely additive metadata: enabling them
never changes the parse output.

See [ParseDiagnostic](#parsediagnostic) for the code enumeration and span conventions.

</MemberCard>

#### Numeric Expression

<MemberCard>

##### Expression.isEven {#iseven}

```ts
readonly isEven: boolean | undefined;
```

If the value of this expression is not an **integer** return `undefined`.

</MemberCard>

<MemberCard>

##### Expression.isOdd {#isodd}

```ts
readonly isOdd: boolean | undefined;
```

If the value of this expression is not an **integer** return `undefined`.

</MemberCard>

<MemberCard>

##### Expression.re {#re-2}

```ts
readonly re: number;
```

Return the real part of the value of this expression, if a number.

Otherwise, return `NaN` (not a number).

</MemberCard>

<MemberCard>

##### Expression.im {#im-2}

```ts
readonly im: number;
```

If value of this expression is a number, return the imaginary part of the
value. If the value is a real number, the imaginary part is 0.

Otherwise, return `NaN` (not a number).

</MemberCard>

<MemberCard>

##### Expression.bignumRe {#bignumre-1}

```ts
readonly bignumRe: BigDecimal | undefined;
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

<MemberCard>

##### Expression.bignumIm {#bignumim-1}

```ts
readonly bignumIm: BigDecimal | undefined;
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

<MemberCard>

##### Expression.sgn {#sgn-3}

```ts
readonly sgn: Sign | undefined;
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

<MemberCard>

##### Expression.isPositive {#ispositive}

```ts
readonly isPositive: boolean | undefined;
```

The value of this expression is > 0, same as `isGreaterEqual(0)`

</MemberCard>

<MemberCard>

##### Expression.isNonNegative {#isnonnegative}

```ts
readonly isNonNegative: boolean | undefined;
```

The value of this expression is >= 0, same as `isGreaterEqual(0)`

</MemberCard>

<MemberCard>

##### Expression.isNegative {#isnegative}

```ts
readonly isNegative: boolean | undefined;
```

The value of this expression is &lt; 0, same as `isLess(0)`

</MemberCard>

<MemberCard>

##### Expression.isNonPositive {#isnonpositive}

```ts
readonly isNonPositive: boolean | undefined;
```

The  value of this expression is &lt;= 0, same as `isLessEqual(0)`

</MemberCard>

<MemberCard>

##### Expression.isNaN {#isnan-1}

```ts
readonly isNaN: boolean | undefined;
```

If true, the value of this expression is "Not a Number".

A value representing undefined result of computations, such as `0/0`,
as per the floating point format standard IEEE-754.

Note that if `isNaN` is true, `isNumber` is also true (yes, `NaN` is a
number).

</MemberCard>

<MemberCard>

##### Expression.isInfinity {#isinfinity}

```ts
readonly isInfinity: boolean | undefined;
```

The numeric value of this expression is `±Infinity` or ComplexInfinity.

</MemberCard>

<MemberCard>

##### Expression.isFinite {#isfinite-1}

```ts
readonly isFinite: boolean | undefined;
```

This expression is a number, but not `±Infinity`, `ComplexInfinity` or
 `NaN`

</MemberCard>

#### Other

<MemberCard>

##### Expression.hash {#hash}

```ts
readonly hash: number;
```

A structural hash of this expression, suitable as an **in-memory**
bucketing or cache key with a deep compare on hit.

The contract:

- **Invariant**: if `a.isSame(b)` is `true`, then `a.hash === b.hash`.
  The hash is the structural tier's companion — a pure function of the
  canonical tree. A symbol's assigned value never affects it.

- **Stability**: deterministic within a release — the same canonical
  tree yields the same hash across engine instances and processes, as
  it is computed from structure and strings only, with no engine state.
  **Not stable across releases**: the hash function may change in any
  release, so a cache keyed on it must not outlive the engine build.
  Never persist it.

- **Collisions**: a 32-bit-class, bucketing-grade hash. Distinct
  expressions may share a hash; always verify a hash hit with
  `isSame()` (or another structural compare) before treating two
  expressions as identical.

- **Bound variables**: folds bound-variable _names_ (binding-identity,
  not alpha-equivalence), matching `isSame()`: `Sum(i, i in 1..n)` and
  `Sum(j, j in 1..n)` hash differently, just as they are not `isSame()`.
  This clause co-evolves with `isSame()` semantics.

</MemberCard>

<MemberCard>

##### Expression.engine {#engine-1}

```ts
readonly engine: ExpressionComputeEngine;
```

The Compute Engine instance associated with this expression provides
a context in which to interpret it, such as definition of symbols
and functions.

</MemberCard>

<MemberCard>

##### Expression.toMathJson() {#tomathjson}

```ts
toMathJson(options?): MathJsonExpression
```

Serialize to a MathJSON expression with specified options.

Use `{ fractionalDigits: 'auto' }` to round arbitrary-precision
numbers to `ce.precision` significant digits. The default
(`'max'`) emits all available digits with no rounding.

####### options?

`Readonly`\<`Partial`\<[`JsonSerializationOptions`](#jsonserializationoptions)\>\>

</MemberCard>

<MemberCard>

##### Expression.json {#json}

```ts
readonly json: MathJsonExpression;
```

MathJSON representation of this expression.

This representation always use shorthands when possible. Metadata is not
included.

Numbers are converted to JavaScript numbers and may lose precision.

The expression is represented exactly and no sugaring is applied. For
example, `["Power", "x", 2]` is not represented as `["Square", "x"]`.

For more control over the serialization, use `expr.toMathJson()`.

Note that lazy collections are *not* eagerly evaluated.

For arbitrary-precision numbers, the full raw `BigDecimal` value is
emitted with no rounding (same as `toJSON()`). This preserves data
fidelity for round-tripping but may include trailing digits beyond
`ce.precision` that are not meaningful. Use
`toMathJson({ fractionalDigits: 'auto' })` for rounded output.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<MemberCard>

##### Expression.latex {#latex-1}

```ts
readonly latex: string;
```

Return a LaTeX representation of this expression.

This is a convenience getter that delegates to the standalone
`serialize()` function from the `latex-syntax` module.

Numeric values are rounded to `ce.precision` significant digits.
Noise digits from precision-bounded operations (division,
transcendentals) are not displayed.

</MemberCard>

<MemberCard>

##### Expression.toLatex() {#tolatex}

```ts
toLatex(options?): string
```

Return a LaTeX representation of this expression with custom
serialization options.

Numeric values are rounded to `ce.precision` significant digits.

####### options?

`Record`\<`string`, `any`\>

</MemberCard>

<MemberCard>

##### Expression.print() {#print-1}

```ts
print(): void
```

Output to the console a string representation of the expression.

Note that lazy collections are eagerly evaluated when printed.

</MemberCard>

<MemberCard>

##### Expression.verbatimLatex? {#verbatimlatex}

```ts
optional verbatimLatex?: string;
```

If the expression was constructed from a LaTeX string, the verbatim LaTeX
 string it was parsed from.

</MemberCard>

<MemberCard>

##### Expression.sourceOffsets? {#sourceoffsets-1}

```ts
optional sourceOffsets?: [number, number];
```

Source offsets in the original source string, when available.

</MemberCard>

<MemberCard>

##### Expression.isCanonical {#iscanonical}

If `true`, this expression is in a canonical form.

</MemberCard>

<MemberCard>

##### Expression.isStructural {#isstructural}

If `true`, this expression is in a structural form.

The structural form of an expression is used when applying rules to
an expression. For example, a rational number is represented as a
function expression instead of a `Expression` object.

</MemberCard>

<MemberCard>

##### Expression.canonical {#canonical-1}

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

<MemberCard>

##### Expression.structural {#structural}

Return the structural form of this expression.

Some expressions, such as rational numbers, are represented with
a `Expression` object. In some cases, for example when doing a
structural comparison of two expressions, it is useful to have a
structural representation of the expression where the rational numbers
is represented by a function expression instead.

If there is a structural representation of the expression, return it,
otherwise return `this`.

</MemberCard>

<MemberCard>

##### Expression.isValid {#isvalid}

```ts
readonly isValid: boolean;
```

`false` if this expression or any of its subexpressions is an `["Error"]`
expression.

The check is **deep**: an `["Error"]` anywhere in the expression tree
invalidates the whole expression. This includes the *elements* of a list,
vector or matrix — `(1,2) + [3,4]` broadcasts to a list of
`incompatible-type` errors, and that list is invalid — and operands held
unevaluated, such as the body of a `["Hold"]`.

:::info[Note]
Applicable to canonical and non-canonical expressions. For
non-canonical expression, this may indicate a syntax error while parsing
LaTeX. For canonical expression, this may indicate argument type
mismatch, or missing or unexpected arguments.
:::

This is a check for **well-formedness, not for meaningfulness**: it
answers "is this expression free of errors?", not "will it evaluate to a
useful value?". An expression is still valid when it contains free
symbols (`x + 1`), calls an undeclared function, or evaluates to `NaN` or
`±∞` (`0/0` and `1/0` are both valid). Conversely, a valid expression may
still fail to evaluate for reasons this property does not report.

Use it as an **admission gate** — check `isValid` before compiling,
plotting, or otherwise consuming an expression built from untrusted or
user-supplied input, since malformed input surfaces as an `["Error"]`
expression rather than as a thrown exception. To find out *what* is
wrong, walk the expression for `["Error"]` subexpressions; each carries
an error code and the offending operand.

</MemberCard>

<MemberCard>

##### Expression.isPure {#ispure}

```ts
readonly isPure: boolean;
```

If *true*, evaluating this expression has no side-effects (does not
change the state of the Compute Engine).

If *false*, evaluating this expression may change the state of the
Compute Engine or it may return a different value each time it is
evaluated, even if the state of the Compute Engine is the same.

As an example, the `["Add", 2, 3]` function expression is pure, but
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

Since Stage 2 of the effects model this is a **view** of the runtime
effect channel: "no impurity label in `effectsOf(expr)`" (see
`boxed-expression/effects-of.ts`).

</MemberCard>

<MemberCard>

##### Expression.effects {#effects-2}

```ts
readonly effects: 
  | "any"
  | readonly EffectLabel[]
  | undefined;
```

The effects of **evaluating** this expression: `undefined` when there are
none (the expression is pure), `'any'` when the effects are not known, or
the effect labels in alphabetical order.

This is the set `isPure` summarizes — `isPure` is "no impurity label in
here" — but it says *which* effects, so a consumer can act on them: a
`scope` write invalidates a memo, `random` means the value will differ on
re-evaluation, `network` means evaluating may be slow or may fail.

It reports what evaluating this expression **does**, not what the value it
produces **can do** if you later invoke it. A symbol bound to a drawing
function has no effects — evaluating it just yields the function — while
its *type* carries the draw:

```ts
ce.assign('rf', ce.box(['Function', ['Random'], 'x']));
ce.box('rf').effects;           // ➔ undefined  (producing the value)
ce.box('rf').isPure;            // ➔ true
ce.box('rf').type.effects;      // ➔ ['random'] (invoking it)
ce.box(['Map', xs, 'rf']).effects; // ➔ ['random'] (Map invokes it)
```

Numbers, strings, symbols and dictionaries have no effects. See
`docs/EFFECTS-MODEL.md` ("Projection and discharge") for how an
application's effects are computed from its operator and operands.

</MemberCard>

<MemberCard>

##### Expression.isConstant {#isconstant-1}

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

<MemberCard>

##### Expression.errors {#errors}

```ts
readonly errors: readonly Expression[];
```

All the `["Error"]` subexpressions.

If an expression includes an error, the expression is also an error.
In that case, the `this.isValid` property is `false`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<MemberCard>

##### Expression.getSubexpressions() {#getsubexpressions}

```ts
getSubexpressions(operator): readonly Expression[]
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

<MemberCard>

##### Expression.subexpressions {#subexpressions}

```ts
readonly subexpressions: readonly Expression[];
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

<MemberCard>

##### Expression.symbols {#symbols}

```ts
readonly symbols: readonly string[];
```

All the symbols in the expression, recursively, including
bound variables (e.g., summation/product index variables).

Use [unknowns](#unknowns) or [freeVariables](#freevariables) to get only the
symbols that are free (not bound by a scoping construct).

```js
const expr = ce.parse('a + b * c + d');
const symbols = expr.symbols;
// -> ['a', 'b', 'c', 'd']
```

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<MemberCard>

##### Expression.unknowns {#unknowns}

```ts
readonly unknowns: readonly string[];
```

All the symbols used in the expression that do not have a value
associated with them, i.e. they are declared but not defined.

</MemberCard>

<MemberCard>

##### Expression.freeVariables {#freevariables}

```ts
readonly freeVariables: readonly string[];
```

The free variables of the expression: symbols that are not constants,
not operators, not bound to a value, and not locally scoped (e.g.,
summation/product index variables are excluded).

This is an alias for [unknowns](#unknowns).

</MemberCard>

<MemberCard>

##### Expression.defines {#defines}

```ts
readonly defines: readonly string[];
```

The symbols **defined** by this expression: the target of a top-level
`["Assign", …]` or `["Declare", …]` (e.g. `a` in `a := 3`, `f` in
`f(x) := …`), recursing through `["Block", …]` sequences. Empty for
expressions that define nothing.

Complements [freeVariables](#freevariables) (the symbols an expression
*references*). A tool that builds a dependency graph keyed on cells —
e.g. a notebook — can use `defines` for the out-edges and
[references](#references) for the in-edges.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<MemberCard>

##### Expression.referencedFunctions {#referencedfunctions}

```ts
readonly referencedFunctions: readonly string[];
```

The user functions **applied** in this expression: the operator head of
a function application when that head is a user-definable symbol — `f` in
`f(x)`, `g` in `g(x) := f(x) + 1`. Built-in operators (`Add`, `Sin`, …),
constants, and names bound to a value or by an enclosing scope (function
parameters, summation indices, `Block` locals) are excluded — the same
predicate [freeVariables](#freevariables) applies to ordinary symbols.

Operator heads are not symbols of the expression, so they appear in
neither [symbols](#symbols) nor [freeVariables](#freevariables). This accessor recovers
the function-call dependency edges those views miss.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<MemberCard>

##### Expression.references {#references}

```ts
readonly references: readonly string[];
```

The symbols this expression **references** but does not itself define:
the union of [freeVariables](#freevariables) (referenced values) and
[referencedFunctions](#referencedfunctions) (applied user functions), minus
[defines](#defines).

This is the complete in-edge set for a dependency graph keyed on cells
(e.g. a notebook): pair it with [defines](#defines) for the out-edges.
Subtracting `defines` drops self-references, so a recursive
`g(x) := g(x - 1)` reports no dependency on itself.

```js
const cell = ce.parse('g(x) := f(x) + a', { canonical: false });
cell.defines;    // -> ['g']
cell.references; // -> ['a', 'f']
```

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

</MemberCard>

<MemberCard>

##### Expression.toNumericValue() {#tonumericvalue}

```ts
toNumericValue(): [NumericValue, Expression]
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

<MemberCard>

##### Expression.neg() {#neg-2}

```ts
neg(): Expression
```

Negate (additive inverse)

</MemberCard>

<MemberCard>

##### Expression.inv() {#inv-1}

```ts
inv(): Expression
```

Inverse (multiplicative inverse)

</MemberCard>

<MemberCard>

##### Expression.abs() {#abs-1}

```ts
abs(): Expression
```

Absolute value

</MemberCard>

<MemberCard>

##### Expression.add() {#add-3}

```ts
add(rhs): Expression
```

Addition

####### rhs

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.sub() {#sub-2}

```ts
sub(rhs): Expression
```

Subtraction

####### rhs

[`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.mul() {#mul-2}

```ts
mul(rhs): Expression
```

Multiplication

####### rhs

  \| `number`
  \| [`NumericValue`](#abstract-numericvalue)
  \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.div() {#div-2}

```ts
div(rhs): Expression
```

Division

####### rhs

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.pow() {#pow-2}

```ts
pow(exp): Expression
```

Power

####### exp

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.root() {#root-1}

```ts
root(exp): Expression
```

Exponentiation

####### exp

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.sqrt() {#sqrt-1}

```ts
sqrt(): Expression
```

Square root

</MemberCard>

<MemberCard>

##### Expression.ln() {#ln-1}

```ts
ln(base?): Expression
```

Logarithm (natural by default)

####### base?

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.numerator {#numerator-1}

Return this expression expressed as a numerator.

</MemberCard>

<MemberCard>

##### Expression.denominator {#denominator-1}

Return this expression expressed as a denominator.

</MemberCard>

<MemberCard>

##### Expression.numeratorDenominator {#numeratordenominator}

Return this expression expressed as a numerator and denominator.

</MemberCard>

<MemberCard>

##### Expression.toRational() {#torational}

```ts
toRational(): [number, number] | null
```

Return the value of this expression as a pair of integer numerator and
denominator, or `null` if the expression is not a rational number.

- For a `BoxedNumber` with an exact rational value, extracts from the
  numeric representation.
- For an integer, returns `[n, 1]`.
- For a `Divide` or `Rational` function with integer operands, returns
  `[num, den]`.
- For everything else, returns `null`.

The returned rational is always in lowest terms.

```typescript
ce.parse('\\frac{6}{4}').toRational()  // [3, 2]
ce.parse('7').toRational()              // [7, 1]
ce.parse('x + 1').toRational()          // null
ce.number(1.5).toRational()             // null (machine float)
```

</MemberCard>

<MemberCard>

##### Expression.factors() {#factors}

```ts
factors(): readonly Expression[]
```

Return the multiplicative factors of this expression as a flat array.

This is a structural decomposition — it does not perform algebraic
factoring (use `ce.function('Factor', [expr])` for that).

- `Multiply(a, b, c)` returns `[a, b, c]`
- `Negate(x)` returns `[-1, ...x.factors()]`
- Anything else returns `[expr]`

```typescript
ce.parse('2xyz').factors()     // [2, x, y, z]
ce.parse('-3x').factors()      // [-1, 3, x]
ce.parse('x + 1').factors()    // [x + 1]
```

</MemberCard>

<MemberCard>

##### Expression.polynomialCoefficients() {#polynomialcoefficients}

```ts
polynomialCoefficients(variable?): readonly Expression[] | undefined
```

Return the coefficients of this expression as a polynomial in `variable`,
in descending order of degree. Returns `undefined` if the expression is
not a polynomial in the given variable.

If `variable` is omitted, auto-detects when the expression has exactly
one unknown. Returns `undefined` if there are zero or multiple unknowns.

```typescript
ce.parse('x^2 + 2x + 1').polynomialCoefficients('x')  // [1, 2, 1]
ce.parse('x^3 + 2x + 1').polynomialCoefficients('x')  // [1, 0, 2, 1]
ce.parse('sin(x)').polynomialCoefficients('x')          // undefined
ce.parse('x^2 + 5').polynomialCoefficients()            // [1, 0, 5]
```

Subsumes `isPolynomial`:
```typescript
const isPolynomial = expr.polynomialCoefficients('x') !== undefined;
```

Subsumes `polynomialDegree`:
```typescript
const degree = expr.polynomialCoefficients('x')?.length - 1;
```

When `variable` is an array, the expression must be polynomial in ALL
listed variables. Coefficients are decomposed by the first variable;
remaining variables appear as symbolic coefficients.

```typescript
ce.parse('x^2*y + 3x + y^2').polynomialCoefficients(['x', 'y'])
// → [y, 3, y²]  (coefficients of x², x¹, x⁰)
```

####### variable?

`string` \| `string`[]

</MemberCard>

<MemberCard>

##### Expression.polynomialRoots() {#polynomialroots}

```ts
polynomialRoots(variable?): readonly Expression[] | undefined
```

Return the roots of this expression treated as a polynomial in `variable`.
Returns `undefined` if the expression is not a polynomial in the given
variable. Returns an empty array if no roots can be found.

If `variable` is omitted, auto-detects when the expression has exactly
one unknown.

```typescript
ce.parse('x^2 - 5x + 6').polynomialRoots('x')  // [2, 3]
ce.parse('x^2 + 1').polynomialRoots('x')         // [] (no real roots)
ce.parse('sin(x)').polynomialRoots('x')           // undefined
```

####### variable?

`string`

</MemberCard>

<MemberCard>

##### Expression.isScoped {#isscoped}

```ts
readonly isScoped: boolean;
```

If true, the expression has its own local scope that can be used
for local variables and arguments. Only true if the expression is a
function expression.

</MemberCard>

<MemberCard>

##### Expression.localScope {#localscope}

If this expression has a local scope, return it.

</MemberCard>

<MemberCard>

##### Expression.subs() {#subs}

```ts
subs(sub, options?): Expression
```

Replace all the symbols in the expression as indicated.

Note the same effect can be achieved with `this.replace()`, but
using `this.subs()` is more efficient and simpler, but limited
to replacing symbols.

The free symbols of the result are bound in the CURRENT scope, not in the
scope the receiver was built in. A node that owns a local scope keeps
that scope, so a binder's bound variables go on denoting the binder's own
bindings — including for a binder nested inside another one, whose scope
chain would otherwise no longer reach the outer binder's index.

If `options.canonical` is not set, the result is canonical if `this`
is canonical.

:::info[Note]
Applicable to canonical and non-canonical expressions.

If this is a function, an empty substitution is given, and the computed value of `canonical`
does not differ from that of this expr.: then a call this method is analagous to requesting a
*clone*.
:::

####### sub

`Substitution`\<[`ExpressionInput`](#expressioninput)\>

####### options?

####### canonical?

[`CanonicalOptions`](#canonicaloptions)

</MemberCard>

<MemberCard>

##### Expression.map() {#map}

```ts
map(fn, options?): Expression
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

(`expr`) => [`Expression`](#expression-5)

####### options?

####### canonical

[`CanonicalOptions`](#canonicaloptions)

####### recursive?

`boolean`

</MemberCard>

<MemberCard>

##### Expression.replace() {#replace}

```ts
replace(rules, options?): Expression | null
```

Transform the expression by applying one or more replacement rules:

- If the expression matches the `match` pattern and the `condition`
 predicate is true, replace it with the `replace` pattern.

- If no rules apply, return `null`.

The `form` option controls the form of *replacements*. The deprecated
`canonical` option is also accepted for backward compatibility; only one
of the two may be specified.

When neither `form` nor `canonical` is specified, the form of each
replacement is determined as follows:
1. the form of the replacement produced by the rule, if it has a
   non-`'raw'` form;
2. otherwise, the form of the expression being replaced;
3. otherwise, the replacement is left in its raw form.

While the form applies directly to replaced sub-expressions only, a
non-`'raw'` form also propagates 'opportunistically' up the expression
tree: an expression whose operands all share a form after replacement
assumes that form as well. (Specifying `form: 'raw'` disables this
propagation.)

:::info[Note]
Applicable to input expressions of any form.

To match a specific symbol (not a wildcard pattern), the `match` must be
a `Expression` (e.g., `{ match: ce.expr('x'), replace: ... }`).

For simple symbol substitution, consider using `subs()` instead.
:::

####### rules

`BoxedRuleSet` \| `Rule` \| `Rule`[]

####### options?

`Partial`\<[`ReplaceOptions`](#replaceoptions)\>

</MemberCard>

<MemberCard>

##### Expression.has() {#has}

```ts
has(v): boolean
```

True if the expression includes a symbol `v` or a function operator `v`.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### v

`string` \| `string`[]

</MemberCard>

<MemberCard>

##### Expression.match() {#match-1}

```ts
match(pattern, options?): BoxedSubstitution<Expression> | null
```

If this expression matches `pattern`, return a substitution that makes
`pattern` equal to `this`. Otherwise return `null`.

If `pattern` includes wildcards (symbols that start
with `_`), the substitution will include a prop for each matching named
wildcard.

If this expression matches `pattern` but there are no named wildcards,
return the empty substitution, `{}`.

`pattern` can be:
- A **string** (LaTeX): single-character symbols are auto-converted to
  wildcards (e.g., `'ax^2+bx+c'` treats `a`, `b`, `c` as wildcards).
  Results use unprefixed keys (`{a: 3}` not `{_a: 3}`) and self-matches
  are filtered out. `useVariations` and `matchMissingTerms` default to
  `true`. Unprefixed keys are accepted in `substitution`.
- A **MathJSON array** (e.g., `['Add', '_a', '_b']`): boxed automatically.
- A **BoxedExpression**: used directly.

Read more about [**patterns and rules**](/compute-engine/guides/patterns-and-rules/).

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### pattern

[`ExpressionInput`](#expressioninput)

####### options?

`PatternMatchOptions`\<[`Expression`](#expression-5)\>

</MemberCard>

<MemberCard>

##### Expression.wikidata {#wikidata-1}

```ts
readonly wikidata: string | undefined;
```

Wikidata identifier.

If not a canonical expression, return `undefined`.

</MemberCard>

<MemberCard>

##### Expression.description {#description-1}

```ts
readonly description: string[] | undefined;
```

An optional short description if a symbol or function expression.

May include markdown. Each string is a paragraph.

If not a canonical expression, return `undefined`.

</MemberCard>

<MemberCard>

##### Expression.url {#url-3}

```ts
readonly url: string | undefined;
```

An optional URL pointing to more information about the symbol or
 function operator.

If not a canonical expression, return `undefined`.

</MemberCard>

<MemberCard>

##### Expression.complexity {#complexity-1}

```ts
readonly complexity: number | undefined;
```

Expressions with a higher complexity score are sorted
first in commutative functions

If not a canonical expression, return `undefined`.

</MemberCard>

<MemberCard>

##### Expression.baseDefinition {#basedefinition-1}

```ts
readonly baseDefinition: BoxedBaseDefinition | undefined;
```

For symbols and functions, a definition associated with the
expression. `this.baseDefinition` is the base class of symbol and function
definition.

If not a canonical expression, return `undefined`.

</MemberCard>

<MemberCard>

##### Expression.operatorDefinition {#operatordefinition-1}

```ts
readonly operatorDefinition: BoxedOperatorDefinition | undefined;
```

For function expressions, the definition of the operator associated with
the expression. For symbols, the definition of the symbol if it is an
operator, for example `"Sin"`.

If not a canonical expression or not a function expression,
its value is `undefined`.

</MemberCard>

<MemberCard>

##### Expression.valueDefinition {#valuedefinition-1}

```ts
readonly valueDefinition: BoxedValueDefinition | undefined;
```

For symbols, a definition associated with the expression, if it is
not an operator.

If not a canonical expression, or not a value, its value is `undefined`.

</MemberCard>

<MemberCard>

##### Expression.simplify() {#simplify}

```ts
simplify(options?): Expression
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

`Partial`\<`SimplifyOptions`\>

</MemberCard>

<MemberCard>

##### Expression.explain() {#explain}

```ts
explain(operation?, options?): Explanation
```

Return a structured, step-by-step explanation of an operation applied
to this expression: the textbook chain *expression → step (with a
reason) → … → result*.

The `operation` defaults to `'simplify'`. The explanation runs the same
engine code as the plain method: `explain('simplify').result` is the
same value `simplify()` returns.

For `'solve'`, the receiver is a univariate equation (or an expression
`f`, read as `f = 0`); the unknown is inferred or passed via
`options.variable`. Step values are *equations* — the state after each
phase (`2x+1=5` → `2x-4=0` → `x=2`), including candidate roots and
rejected extraneous candidates — and `result` is a `List` of the same
roots `solve()` returns. Systems of equations are not supported yet.

For `'D'`, steps are whole-expression states in traversal order: each
textbook rule (sum, product, quotient, power, chain, …) first appears
with its unresolved sub-derivatives as inert `D(…)` terms, which
resolve step by step. The variable is inferred when unambiguous, or
passed via `options.variable`; `result` matches evaluating
`D(expr, variable)`.

Each step carries the expression state after the step, a stable machine
`id` (the key for localization and custom copy) and a default English
`description`. The `initial` property is the canonical form of this
expression — canonicalization happens before the first step is recorded
and is not traced.

By default the step chain is curated: internal bookkeeping steps are
filtered out. Pass `verbosity: 'all'` to get the raw chain (for
debugging and rule authoring).

####### operation?

[`ExplainOperation`](#explainoperation)

####### options?

`ExplainOptions`

</MemberCard>

<MemberCard>

##### Expression.toSignedFunction() {#tosignedfunction}

```ts
toSignedFunction(): Expression | undefined
```

For a relation expression (`Equal`, `Less`, `Greater`, `LessEqual`,
`GreaterEqual`, `NotEqual`), return the "signed function" form
useful for implicit-surface rendering and region classification:

- `Equal(a, b)` → `a - b` (zero on the surface)
- `Less(a, b)` / `LessEqual(a, b)` → `a - b` (negative when relation holds)
- `Greater(a, b)` / `GreaterEqual(a, b)` → `b - a` (negative when relation holds)
- `NotEqual(a, b)` → `a - b` (caller checks ≠ 0)

For non-relation expressions, returns `undefined`.

Strictness (strict vs non-strict inequality) and direction (less vs
greater) are encoded in the original `expr.operator`, not in the
returned expression. Callers handling 3D implicit rendering use
`expr.operator` for the boundary policy and the signed function for
the interior/exterior classification.

Notes:
- CE canonical form normalizes `GreaterEqual(a, b)` to `LessEqual(b, a)`
  (and similarly `Greater` to `Less`). Callers using `toSignedFunction()`
  on canonicalized parsed expressions will see `LessEqual`/`Less` rather
  than `GreaterEqual`/`Greater`. The signed-function semantics are
  preserved through the normalization. The `GreaterEqual`/`Greater`
  branches handle non-canonical expressions constructed via
  `ce.expr(['GreaterEqual', ...])`.
- For chained relations with more than two operands (e.g.
  `Less(a, b, c)` from `a < b < c`), only the first pair is used.
  The result is the signed function for the first sub-relation only;
  3D implicit rendering rarely uses chained relations, but if it
  does, callers should decompose first.

</MemberCard>

<MemberCard>

##### Expression.getInterval() {#getinterval}

```ts
getInterval(symbol): IntervalBounds | undefined
```

For an expression representing a domain restriction (a `When` whose
condition is a comparison or `And` of comparisons over `symbol`, or
a bare comparison expression), return the lower/upper bounds for
`symbol`. Returns `undefined` if no bounds can be extracted.

Supported shapes:
- Bare comparisons: `a < x`, `x < b`, etc.
- Chained comparisons: `a < x < b` (parsed as `Less(a, x, b)`)
- `And(c1, c2, ...)` where each `ci` is a supported shape
- `When(e, cond)` — operates on `cond`
- `Multiply(f, When(...), ...)` — the Desmos parse shape for
  `f(x)\{a < x < b\}`; bounds from each `When` factor are merged

`lowerStrict`/`upperStrict` are `true` for strict (`<`, `>`) bounds
and `false` for non-strict (`≤`, `≥`).

Returns `undefined` for unsupported shapes (e.g. equations, non-linear
constraints, comparisons over multiple symbols, disjunctions).

####### symbol

`string`

</MemberCard>

<MemberCard>

##### Expression.evaluate() {#evaluate-2}

```ts
evaluate(options?): Expression
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

**Time and recursion limits**: if the evaluation runs inside an enclosing
[`ComputeEngine.withTimeLimit`](#withtimelimit)
span and exceeds its deadline, or
exceeds the recursion limit, a `CancellationError` is thrown (its `cause`
is `'timeout'` or `'recursion-depth-exceeded'`). Catch it to distinguish
an interrupted evaluation from a symbolic (inert) result.

####### options?

`Partial`\<`EvaluateOptions`\>

</MemberCard>

<MemberCard>

##### Expression.evaluateAsync() {#evaluateasync-1}

```ts
evaluateAsync(options?): Promise<Expression>
```

Asynchronous version of `evaluate()`.

The `options` argument can include a `signal` property, which is an
`AbortSignal` object. If the signal is aborted, a `CancellationError` is thrown.

####### options?

`Partial`\<`EvaluateOptions`\>

</MemberCard>

<MemberCard>

##### Expression.N() {#n-1}

```ts
N(): Expression
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

Note on typing (SYMBOLIC P2-24, by design): `N()` produces a float
literal, so its `type` can widen relative to the exact input's — e.g.
`1/3` has type `rational` while `(1/3).N()` has type
`real`. The result type reflects the representation produced,
not the mathematical value's tightest type.

</MemberCard>

<MemberCard>

##### Expression.solve() {#solve}

```ts
solve(vars?): 
  | readonly Expression[]
  | Record<string, Expression>
  | Record<string, Expression>[]
  | null
```

If this is an equation, solve the equation for the variables in vars.
Otherwise, solve the equation `this = 0` for the variables in vars.

For univariate equations, returns an array of solutions (roots).
For systems of linear equations (List of Equal expressions), returns
an object mapping variable names to their values.
For non-linear polynomial systems (like xy=6, x+y=5), returns an array
of solution objects (multiple solutions possible).

```javascript
// Univariate equation
const expr = ce.parse("x^2 + 2*x + 1 = 0");
console.log(expr.solve("x")); // Returns array of roots

// System of linear equations
const system = ce.parse("\\begin{cases}x+y=70\\\\2x-4y=80\\end{cases}");
console.log(system.solve(["x", "y"])); // Returns { x: 60, y: 10 }

// Non-linear polynomial system (product + sum)
const nonlinear = ce.parse("\\begin{cases}xy=6\\\\x+y=5\\end{cases}");
console.log(nonlinear.solve(["x", "y"])); // Returns [{ x: 2, y: 3 }, { x: 3, y: 2 }]
```

####### vars?

  \| `string`
  \| `Iterable`\<`string`, `any`, `any`\>
  \| [`Expression`](#expression-5)
  \| `Iterable`\<[`Expression`](#expression-5), `any`, `any`\>

</MemberCard>

<MemberCard>

##### Expression.value {#value-4}

```ts
get value(): Expression | undefined
set value(value: 
  | number[]
  | ExpressionInput
  | OnlyFirst<{
  re: number;
  im: number;
 }, {
  re: number;
  im: number;
 } & {
  num: number;
  denom: number;
 } & Expression>
  | OnlyFirst<{
  num: number;
  denom: number;
 }, {
  re: number;
  im: number;
 } & {
  num: number;
  denom: number;
 } & Expression>
  | OnlyFirst<Expression, {
  re: number;
  im: number;
 } & {
  num: number;
  denom: number;
 } & Expression>
  | undefined): void
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

<MemberCard>

##### Expression.isCollection {#iscollection-1}

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

### `isCollection` is a CAPABILITY, `type.matches('collection<any>')` is a SHAPE

This is the single most common source of collection-handling bugs in the
engine, so it is worth stating precisely. The two predicates answer
different questions and neither implies the other:

- `isCollection` — "can I enumerate this **now**?" It is `false` for a
  symbol declared `list<number>`/`vector<2>` that has not been assigned
  yet, and for an application whose head returns a collection (`L(1)`
  under `L: (number) -> vector<2>`): both are collection-shaped, but
  there is nothing to walk.
- `type.matches('collection<any>')` — "is this operand
  collection-**shaped**?" It is `true` for those valueless cases, and
  `false` for a materialized collection whose type is top
  (`unknown`/`any`), which `isCollection` reports `true`.

A shape test must spell the `<any>` FAMILY TOP, never the bare name:
since the bare-synonym ruling (2026-08-17) bare `collection` is the
values-only `collection<unknown>`, so `list<any>`, `list<nothing>` and
`list<integer|missing>` — all collection-shaped — do NOT match it.
(`COLLECTION_SHAPE_TYPE` and friends in `common/type/primitive.ts` are
the same tops as `Type` constants, for `isSubtype` call sites.)

Pick by the question you are actually asking:

- About to call `each()`, `contains()`, `at()`, or read `count` — that is
  a capability question. Use `isCollection`.
- Deciding whether an operand takes the SCALAR path or the
  collection/broadcast path — that is a shape question. Test
  `isCollection || type.matches('collection<any>')`, or the operand class
  alone with `isValuelessCollectionTyped()` (`collection-utils.ts`).

Getting this wrong has a characteristic signature: the operator takes its
scalar path for an operand that is not a scalar and commits an answer that
the SAME expression contradicts once the symbol is assigned. A 2026-08-15
audit of all 95 `isCollection` sites found seven operator families doing
exactly that — `Sum(L)` answering `L`, `Union(L, Set(1))` collapsing `L`
into a single element, `SetMinus` INVERTING a membership answer,
`Mean(L)` committing `NaN`, `Which` throwing on a `list<boolean>`
condition. Pinned in
`test/compute-engine/valueless-collection-typed-operand.test.ts`, which is
the place to add a case if you touch this.

A third predicate covers a distinct case: `isPossiblyCollectionTyped()`
(`collection-utils.ts`) is for an operand that MIGHT become a collection
at runtime — a top-typed application, or a `broadcastable<T>` — where the
honest answer is that the shape is not statically visible at all.

One more operand class answers a confident `false` to BOTH `isCollection`
and `type.matches('collection<any>')` while still being able to hold a
collection: a union of a scalar branch and a collection branch — a
valueless `u: number | list<number>`, and the `2u` lifted over it, since a
broadcast over such an operand carries the union through rather than
claiming a definite list. The scalar branch defeats the match, so a gate
that must decline for a MAYBE-collection has to ask one of the two
union predicates in `collection-utils.ts` as well:
`unionMayHoldACollection()` for an ENUMERATION gate (a big op folding its
body — tuple, string and fixed-shape branches enumerate too), or
`scalarOrCollectionUnionBranches()` for a BROADCAST gate.

</MemberCard>

<MemberCard>

##### Expression.isIndexedCollection {#isindexedcollection}

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
- has an `indexWhere(predicate: (element: Expression) => boolean)`
   method that returns the index of the first element that matches the
   predicate.

</MemberCard>

<MemberCard>

##### Expression.isLazyCollection {#islazycollection}

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

<MemberCard>

##### Expression.each() {#each}

```ts
each(): Generator<Expression>
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

<MemberCard>

##### Expression.contains() {#contains-1}

```ts
contains(rhs): boolean | undefined
```

If this is a collection, return true if the `rhs` expression is in the
collection.

Return `undefined` if the membership cannot be determined without
iterating over the collection.

####### rhs

[`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.subsetOf() {#subsetof-1}

```ts
subsetOf(other, strict): boolean | undefined
```

Check if this collection is a subset of another collection, i.e.
`this` ⊆ `other`.

Returns `undefined` when the relation cannot be determined — including
when this expression is not (yet) a collection.

####### other

[`Expression`](#expression-5)

The other collection to check against.

####### strict

`boolean`

If true, the subset relation is strict (i.e., proper subset).

</MemberCard>

<MemberCard>

##### Expression.count {#count-1}

If this is a collection, return the number of elements in the collection.

Only top-level elements are counted: for a nested collection (e.g. a
matrix represented as a list of lists), this is the number of immediate
elements (the rows), not the total number of scalar entries. For example
the count of `[[2, 3, 4], [6, 7, 9]]` is 2, not 6. This is consistent
with `each()` and `at()`, which iterate over and index the same elements.

If the collection is infinite, return `Infinity`.

If the number of elements cannot be determined, return `undefined`, for
example, if the collection is lazy and not finite and the size cannot
be determined without iterating over the collection.

</MemberCard>

<MemberCard>

##### Expression.isFiniteCollection {#isfinitecollection}

```ts
isFiniteCollection: boolean | undefined;
```

If this is a finite collection, return true.

</MemberCard>

<MemberCard>

##### Expression.isEmptyCollection {#isemptycollection}

```ts
isEmptyCollection: boolean | undefined;
```

If this is an empty collection, return true.

An empty collection has a size of 0.

</MemberCard>

<MemberCard>

##### Expression.isEnumerableCollection {#isenumerablecollection}

```ts
isEnumerableCollection: boolean | undefined;
```

Whether `each()` yields this collection's actual elements.

This is the cheap predicate that separates the two reasons `each()` can
produce nothing:

- `true`: the elements are enumerable, so a walk that yields nothing
  means the collection is **empty**.
- `false`: the elements cannot be produced in the current state, so a
  walk that yields nothing means **nothing at all**. For example
  `Range(a, b)` with free variables, `Repeat(3, n)` with a symbolic
  count, or a wrapper over such a source (`Take(Range(a, b), 2)`).
- `undefined`: undecidable without evaluating — an *eager* collection
  operator (`Characters(s)`, `UnicodeScalars(s)`) has no collection
  handlers until it is evaluated, yet `each()` walks it through the
  materialize-then-iterate path.

An arithmetic **broadcast** (`x + [1, 2]`, `Sin(1..99)` — a
`broadcastable` operator whose collection-ness is a lift over its
operands) answers from its participants: `true` when they agree on a
length, evaluation is draw-free, and every collection-typed participant
is itself enumerable; `false` when a participant is definitively
unwalkable (a valueless symbol, an application of an UNBOUND head —
`x + Total([1, 2])` with `Total` undeclared binds vacuously and can
never produce elements); `undefined` when the lengths disagree or an
impure participant (`RandomShuffle(xs) + 1`) makes per-index reads
unable to promise draw coherence — there `each()` still walks, but
`at()` declines. Impurity confined to a *scalar* (lifted) operand does
not demote the answer: `[1, 2] + RandomInteger(1, 10)` is `true` — its
evaluation distributes structurally without consuming randomness, and
both `each()` and `at()` serve the unevaluated elements.

Independent of `count`: a collection can know its size and still not be
enumerable (`Linspace(a, 1, 3)` has a count of 3 and no computable
elements), and an enumerable collection can have an unknown size.

Answered structurally, without evaluating: O(1) for a leaf, O(depth) for
a chain of wrappers.

</MemberCard>

<MemberCard>

##### Expression.at() {#at-2}

```ts
at(index): Expression | undefined
```

If this is an indexed collection, return the element at the specified
 index. The first element is at index 1.

If the index is negative, return the element at index `size() + index + 1`.

The last element is at index -1.

####### index

`number`

</MemberCard>

<MemberCard>

##### Expression.get() {#get}

```ts
get(key): Expression | undefined
```

If this is a keyed collection (map, record, tuple), return the value of
the corresponding key.

If `key` is a `Expression`, it should be a string.

####### key

`string` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.indexWhere() {#indexwhere-1}

```ts
indexWhere(predicate): number | undefined
```

If this is an indexed collection, return the index of the first element
that matches the predicate.

####### predicate

(`element`) => `boolean`

</MemberCard>

#### Primitive Methods

<MemberCard>

##### Expression.valueOf() {#valueof-2}

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

<MemberCard>

##### Expression.\[toPrimitive\]() {#toprimitive-2}

```ts
toPrimitive: string | number | null
```

Similar to`expr.valueOf()` but includes a hint.

####### hint

`"string"` \| `"number"` \| `"default"`

</MemberCard>

<MemberCard>

##### Expression.toString() {#tostring-1}

```ts
toString(): string
```

Return an ASCIIMath representation of the expression. This string is
suitable to be output to the console for debugging, for example.

Based on `Object.toString()`.

To get a LaTeX representation of the expression, use `expr.latex`.

Note that lazy collections are eagerly evaluated.

Used when coercing a `Expression` to a `String`.

For arbitrary-precision numbers (`BigNumericValue`), the output is
rounded to `BigDecimal.precision` significant digits. Digits beyond the
working precision are noise from precision-bounded operations (division,
transcendentals) and are not displayed. Machine-precision numbers use
their native `Number.toString()`.

</MemberCard>

<MemberCard>

##### Expression.toJSON() {#tojson-4}

```ts
toJSON(): MathJsonExpression
```

Used by `JSON.stringify()` to serialize this object to JSON.

Method version of `expr.json`.

Based on `Object.toJSON()`.

Note that lazy collections are *not* eagerly evaluated.

The output preserves the full raw `BigDecimal` value with no rounding,
ensuring lossless round-tripping via `ce.expr(expr.json)`. Digits beyond
`ce.precision` may be present but are not guaranteed to be accurate.
Use `toMathJson({ fractionalDigits: 'auto' })` for precision-rounded
MathJSON output.

</MemberCard>

<MemberCard>

##### Expression.is() {#is-1}

```ts
is(other, tolerance?): boolean
```

Smart equality check: structural first, then numeric evaluation fallback.
Symmetric: `a.is(b)` always equals `b.is(a)`.

First tries an exact structural check (same as `isSame()`). If that fails
and the expression is constant (no free variables), evaluates numerically
and compares within `engine.tolerance`.

For literal numbers compared to primitives (`number`, `bigint`), behaves
identically to `isSame()` — no tolerance is applied. Tolerance only
applies to expressions that require evaluation (e.g., `\\sin(\\pi)`).

```typescript
ce.parse('\\cos(\\frac{\\pi}{2})').is(0)  // true — evaluates, within tolerance
ce.number(1e-17).is(0)                     // false — literal, no tolerance
ce.parse('x + 1').is(1)                    // false — has free variables
ce.parse('\\pi').is(3.14, 0.01)            // true — within custom tolerance
```

After the structural check, attempts to expand both sides (distributing
products, applying the multinomial theorem, etc.) and re-checks
structural equality. This catches equivalences like `(x+1)^2` vs
`x^2+2x+1` even when the expression has free variables.

####### other

`string` \| `number` \| `bigint` \| `boolean` \| [`Expression`](#expression-5)

####### tolerance?

`number`

If provided, overrides `engine.tolerance` for the
numeric comparison. Has no effect when the comparison is structural
(i.e., when `isSame()` succeeds or the expression has free variables).

</MemberCard>

#### Relational Operator

<MemberCard>

##### Expression.isSame() {#issame}

```ts
isSame(rhs): boolean
```

Fast exact structural/symbolic equality check.

Returns `true` if the expression is structurally identical to `rhs`.
For symbols with value bindings, follows the binding (e.g., if `one = 1`,
then `ce.symbol('one').isSame(1)` is `true`).

Accepts JavaScript primitives: `number`, `bigint`, `boolean`, `string`.

Does **not** evaluate expressions — purely structural.

`ce.parse('1+x', {form: 'raw'}).isSame(ce.parse('x+1', {form: 'raw'}))` is `false`.

See `expr.is()` for a smart check with numeric evaluation fallback,
and `expr.isEqual()` for full mathematical equality.

:::info[Note]
Applicable to canonical and non-canonical expressions.
:::

####### rhs

`string` \| `number` \| `bigint` \| `boolean` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.isLess() {#isless}

```ts
isLess(other): boolean | undefined
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.isLessEqual() {#islessequal}

```ts
isLessEqual(other): boolean | undefined
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.isGreater() {#isgreater}

```ts
isGreater(other): boolean | undefined
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.isGreaterEqual() {#isgreaterequal}

```ts
isGreaterEqual(other): boolean | undefined
```

The value of both expressions are compared.

If the expressions cannot be compared, return `undefined`

####### other

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.isEqual() {#isequal}

```ts
isEqual(other): boolean | undefined
```

Mathematical equality (strong equality), that is the value
of this expression and the value of `other` are numerically equal.

Both expressions are evaluated and the result is compared numerically.

Numbers whose difference is less than `engine.tolerance` are
considered equal. This tolerance is set when the `engine.precision` is
changed to be such that the last two digits are ignored.

Evaluating the expressions may be expensive. Other options to consider
to compare two expressions include:
- `expr.isSame(other)` for a fast exact structural comparison (no evaluation)
- `expr.is(other)` for a smart check that tries structural first, then
  numeric evaluation fallback for constant expressions

**Examples**

```js
let expr = ce.parse('2 + 2');
console.log(expr.isEqual(4)); // true
console.log(expr.isSame(4)); // false (structural only)
console.log(expr.is(4)); // true (evaluates, within tolerance)

expr = ce.parse('4');
console.log(expr.isEqual(4)); // true
console.log(expr.isSame(4)); // true
console.log(expr.is(4)); // true

```

**Free variables — "truth under constraints" semantics.** When either
expression has free variables, equality means "could these be equal
under the current (and possible) constraints?": a fact in the
assumptions database (`ce.assume(...)`) can decide it, an identity that
holds for all values (`(x+1)^2` vs `x^2+2x+1`) is `true`, and anything
else — including `x` vs `2`, or `x+1` vs `5`, which an assumption such
as `x = 4` could make true — is `undefined`, never a definitive
`false`.

####### other

`number` \| [`Expression`](#expression-5)

</MemberCard>

<MemberCard>

##### Expression.isIdenticallyEqual() {#isidenticallyequal}

```ts
isIdenticallyEqual(other): boolean | undefined
```

Identity of this expression and `other` in **all** their free variables,
that is `sin(x)^2 + cos(x)^2 ≡ 1`. This is the deepest — and most
expensive — of the three equality tiers:

| Method | Semantics |
| --- | --- |
| `expr.isSame(other)` | **Structural**: syntactic equality of the canonical forms. Always decidable, no evaluation. |
| `expr.isEqual(other)` | **Arithmetic**: the values are equal (within `engine.tolerance`). |
| `expr.isIdenticallyEqual(other)` | **Identity**: the two expressions are equal for every value of their free variables. |

Three-valued: `true` when identity could be established, `false` when the
expressions are provably different, and `undefined` when neither could be
determined. In particular, expressions that merely *disagree* at sampled
points (`x+1` vs `x+2`) are `undefined`, not `false`: an assumption could
still constrain them equal.

Identity is established by stochastic sampling (evaluating both
expressions at random points), falling back to a symbolic
expand-and-simplify proof. A `true` obtained from sampling alone is
therefore a very strong indication, but not a formal proof
([Richardson's theorem](https://en.wikipedia.org/wiki/Richardson%27s_theorem)
makes a complete decision procedure impossible).

This is the API counterpart of the `IdenticallyEqual` operator (`\equiv`
in LaTeX).

####### other

`number` \| [`Expression`](#expression-5)

</MemberCard>

#### Tensor Expression

<MemberCard>

##### Expression.shape {#shape-3}

```ts
readonly shape: number[];
```

The **shape** describes the **axes** of the expression, where each axis
represent a way to index the elements of the expression.

When the expression is a scalar (number), the shape is `[]`.

When the expression is a vector of length `n`, the shape is `[n]`.

When the expression is a `n` by `m` matrix, the shape is `[n, m]`.

</MemberCard>

<MemberCard>

##### Expression.rank {#rank-2}

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

<MemberCard>

##### Expression.type {#type-12}

```ts
get type(): BoxedType
set type(type: 
  | string
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | BroadcastableType
  | RecordType
  | ObjectType
  | DictionaryType
  | TupleType
  | SymbolType
  | ExpressionType
  | NumericType
  | FunctionSignature
  | ValueType
  | TypeVariable
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

<MemberCard>

##### Expression.isNumber {#isnumber}

```ts
readonly isNumber: boolean | undefined;
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

<MemberCard>

##### Expression.isInteger {#isinteger}

```ts
readonly isInteger: boolean | undefined;
```

The value of this expression is an element of the set ℤ: ...,-2, -1, 0, 1, 2...

Note that ±∞ and NaN are not integers.

</MemberCard>

<MemberCard>

##### Expression.isRational {#isrational}

```ts
readonly isRational: boolean | undefined;
```

The value of this expression is an element of the set ℚ, p/q with p ∈ ℕ, q ∈ ℤ ⃰  q >= 1

Note that every integer is also a rational.

This is equivalent to `this.type === "rational" || this.type === "integer"`

Note that ±∞ and NaN are not rationals.

</MemberCard>

<MemberCard>

##### Expression.isExtendedReal {#isextendedreal}

```ts
readonly isExtendedReal: boolean | undefined;
```

The value of this expression is on the **extended real line**: a finite
real number, or one of the two signed infinities `+∞` and `-∞`.

The unsigned complex infinity `~∞` is **not** on the extended real line,
and neither is `NaN`; both answer `false`. A number with a non-zero
imaginary part answers `false`.

Use this predicate for a gate that must also hold at `±∞` — sign
reasoning, the `1/±∞ = 0` fold, a claim that a result is a signed
infinity. For a **finite** real, test `this.type.matches("real")`
instead: the bare type name `real` denotes the finite reals.

</MemberCard>

<MemberCard>

##### Expression.isFunction {#isfunction}

```ts
readonly isFunction: boolean | undefined;
```

The value of this expression is a function.

This is equivalent to `this.type.matches("function")`, that is, the
expression evaluates to a function (for example a symbol bound to a
function literal, or a function literal itself).

This is distinct from `isFunctionExpression`, which is a *structural*
property (`true` when the expression is a function application node such
as `["Add", 1, 2]`).

</MemberCard>

#### Value Properties

<MemberCard>

##### Expression.constantValue {#constantvalue}

```ts
readonly constantValue: string | number | boolean | object | undefined;
```

If this expression is constant (see `isConstant`), return its value,
otherwise `undefined`.

</MemberCard>

### DictionaryInterface {#dictionaryinterface}

Interface for dictionary-like structures.
Use `isDictionary()` to check if an expression is a dictionary.

<MemberCard>

##### DictionaryInterface.keys {#keys}

</MemberCard>

<MemberCard>

##### DictionaryInterface.entries {#entries-1}

</MemberCard>

<MemberCard>

##### DictionaryInterface.values {#values}

</MemberCard>

<MemberCard>

##### DictionaryInterface.get() {#get-1}

```ts
get(key): Expression | undefined
```

####### key

`string`

</MemberCard>

<MemberCard>

##### DictionaryInterface.has() {#has-1}

```ts
has(key): boolean
```

####### key

`string`

</MemberCard>

<MemberCard>

### ~~BoxedExpression~~ {#boxedexpression}

```ts
type BoxedExpression = Expression;
```

#### Deprecated

Use `Expression` instead.

</MemberCard>

<MemberCard>

### ~~SemiBoxedExpression~~ {#semiboxedexpression}

```ts
type SemiBoxedExpression = ExpressionInput;
```

#### Deprecated

Use `ExpressionInput` instead.

</MemberCard>

## Serialization

<MemberCard>

### NumberFormat {#numberformat}

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

</MemberCard>

<MemberCard>

### NumberSerializationFormat {#numberserializationformat}

```ts
type NumberSerializationFormat = NumberFormat & {
  digits: DisplayDigits;
  fractionalDigits: "auto" | "max" | number;
  notation: "auto" | "engineering" | "scientific" | "adaptiveScientific";
  avoidExponentsInRange: undefined | null | [number, number];
};
```

#### NumberSerializationFormat.digits?

```ts
optional digits?: DisplayDigits;
```

Controls how many digits a number is displayed with. See
[DisplayDigits](#displaydigits).

When serializing via `.toLatex({ digits })`, rounding is applied at the
MathJSON (kernel) layer; the LaTeX layer only lays out the already-rounded
digits.

#### NumberSerializationFormat.~~fractionalDigits~~

```ts
fractionalDigits: "auto" | "max" | number;
```

The maximum number of significant digits in serialized numbers.
- `"max"`: all availabe digits are serialized.
- `"auto"`: use the same precision as the compute engine.

Default: `"auto"`

##### Deprecated

Use [digits](#numberserializationformat) instead.

</MemberCard>

<MemberCard>

### DisplayDigits {#displaydigits}

```ts
type DisplayDigits = 
  | "auto"
  | "max"
  | {
  significant: number;
 }
  | {
  fractional: number;
};
```

Controls how many digits a number is **displayed** with when serialized.

This is a display/formatting concern only: it does not change the stored
value, nor the precision used for computation.

- `"auto"`: round to the engine's working precision (`ce.precision`). This is
  the default used by the `.latex` getter.
- `"max"`: display all stored digits, with no rounding. This is the default
  used by `.json` / `toMathJson()`.
- `{ significant: n }`: round **inexact** values to `n` significant figures.
  Exact values (integers, rationals, radicals) are displayed in full — this
  is a no-op on them. Truncation only: trailing zeros are not padded
  (`2.0` stays `2`).
- `{ fractional: n }`: display `n` digits after the decimal point, using
  `toFixed` semantics (may pad with trailing zeros, e.g. `2` → `2.00`).

Rounding is orthogonal to notation: it never switches a number to
scientific/exponential notation as a side effect. Fixed-vs-scientific is
controlled by the `notation` / `avoidExponentsInRange` options.

</MemberCard>

<MemberCard>

### JsonSerializationOptions {#jsonserializationoptions}

```ts
type JsonSerializationOptions = {
  prettify: boolean;
  exclude: string[];
  shorthands: ("all" | "number" | "symbol" | "function" | "string" | "dictionary")[];
  metadata: ("all" | "wikidata" | "latex" | "sourceOffsets")[];
  repeatingDecimal: boolean;
  digits: DisplayDigits;
  fractionalDigits: "auto" | "max" | number;
};
```

Options to control serialization to MathJSON when using
`Expression.toMathJson()`.

</MemberCard>

## Tensors

<MemberCard>

### DataTypeMap {#datatypemap}

```ts
type DataTypeMap = {
  float64: number;
  float32: number;
  int32: number;
  uint8: number;
  complex128: Complex;
  complex64: Complex;
  bool: boolean;
  expression: Expression;
};
```

Map of `TensorDataType` to JavaScript type.

</MemberCard>

<MemberCard>

### TensorDataType {#tensordatatype}

```ts
type TensorDataType = keyof DataTypeMap;
```

The type of the cells in a tensor.

</MemberCard>

### TensorData {#tensordata}

A record representing the type, shape and data of a tensor.

#### Extended by

- [`Tensor`](#tensor)

<MemberCard>

##### TensorData.dtype {#dtype}

```ts
dtype: DT;
```

</MemberCard>

<MemberCard>

##### TensorData.shape {#shape-1}

```ts
shape: number[];
```

</MemberCard>

<MemberCard>

##### TensorData.rank? {#rank}

```ts
optional rank?: number;
```

</MemberCard>

<MemberCard>

##### TensorData.data {#data}

```ts
data: DataTypeMap[DT][];
```

</MemberCard>

### TensorField {#tensorfield}

<MemberCard>

##### TensorField.one {#one-2}

```ts
readonly one: T;
```

</MemberCard>

<MemberCard>

##### TensorField.zero {#zero-2}

```ts
readonly zero: T;
```

</MemberCard>

<MemberCard>

##### TensorField.nan {#nan-3}

```ts
readonly nan: T;
```

</MemberCard>

<MemberCard>

##### TensorField.cast() {#cast}

###### cast(x, dtype)

```ts
cast(x, dtype): number | undefined
```

####### x

`T`

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number | undefined
```

####### x

`T`

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number | undefined
```

####### x

`T`

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number | undefined
```

####### x

`T`

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex | undefined
```

####### x

`T`

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex | undefined
```

####### x

`T`

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean | undefined
```

####### x

`T`

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): Expression | undefined
```

####### x

`T`

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[] | undefined
```

####### x

`T`[]

####### dtype

`"float64"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[] | undefined
```

####### x

`T`[]

####### dtype

`"float32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[] | undefined
```

####### x

`T`[]

####### dtype

`"int32"`

###### cast(x, dtype)

```ts
cast(x, dtype): number[] | undefined
```

####### x

`T`[]

####### dtype

`"uint8"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[] | undefined
```

####### x

`T`[]

####### dtype

`"complex128"`

###### cast(x, dtype)

```ts
cast(x, dtype): Complex[] | undefined
```

####### x

`T`[]

####### dtype

`"complex64"`

###### cast(x, dtype)

```ts
cast(x, dtype): boolean[] | undefined
```

####### x

`T`[]

####### dtype

`"bool"`

###### cast(x, dtype)

```ts
cast(x, dtype): Expression[] | undefined
```

####### x

`T`[]

####### dtype

`"expression"`

###### cast(x, dtype)

```ts
cast(x, dtype): 
  | number
  | boolean
  | number[]
  | Expression
  | Complex
  | Expression[]
  | Complex[]
  | boolean[]
  | undefined
```

####### x

`T` \| `T`[]

####### dtype

keyof [`DataTypeMap`](#datatypemap)

</MemberCard>

<MemberCard>

##### TensorField.expression() {#expression-3}

```ts
expression(x): Expression
```

####### x

`T`

</MemberCard>

<MemberCard>

##### TensorField.isZero() {#iszero-1}

```ts
isZero(x): boolean
```

####### x

`T`

</MemberCard>

<MemberCard>

##### TensorField.isOne() {#isone-1}

```ts
isOne(x): boolean
```

####### x

`T`

</MemberCard>

<MemberCard>

##### TensorField.equals() {#equals}

```ts
equals(lhs, rhs): boolean
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<MemberCard>

##### TensorField.add() {#add-1}

```ts
add(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<MemberCard>

##### TensorField.addn() {#addn}

```ts
addn(...xs): T
```

####### xs

...`T`[]

</MemberCard>

<MemberCard>

##### TensorField.neg() {#neg-1}

```ts
neg(x): T
```

####### x

`T`

</MemberCard>

<MemberCard>

##### TensorField.sub() {#sub-1}

```ts
sub(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<MemberCard>

##### TensorField.mul() {#mul-1}

```ts
mul(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<MemberCard>

##### TensorField.muln() {#muln}

```ts
muln(...xs): T
```

####### xs

...`T`[]

</MemberCard>

<MemberCard>

##### TensorField.div() {#div-1}

```ts
div(lhs, rhs): T
```

####### lhs

`T`

####### rhs

`T`

</MemberCard>

<MemberCard>

##### TensorField.pow() {#pow-1}

```ts
pow(rhs, n): T
```

####### rhs

`T`

####### n

`number`

</MemberCard>

<MemberCard>

##### TensorField.conjugate() {#conjugate}

```ts
conjugate(x): T
```

####### x

`T`

</MemberCard>

### Tensor {#tensor}

#### Extends

- [`TensorData`](#tensordata)\<`DT`\>

<MemberCard>

##### Tensor.dtype {#dtype-1}

```ts
dtype: DT;
```

</MemberCard>

<MemberCard>

##### Tensor.shape {#shape-2}

```ts
shape: number[];
```

</MemberCard>

<MemberCard>

##### Tensor.rank {#rank-1}

```ts
rank: number;
```

</MemberCard>

<MemberCard>

##### Tensor.data {#data-1}

```ts
data: DataTypeMap[DT][];
```

</MemberCard>

<MemberCard>

##### Tensor.field {#field}

```ts
readonly field: TensorField<DataTypeMap[DT]>;
```

</MemberCard>

<MemberCard>

##### Tensor.expression {#expression-4}

```ts
readonly expression: Expression;
```

</MemberCard>

<MemberCard>

##### Tensor.array {#array}

```ts
readonly array: NestedArray<DataTypeMap[DT]>;
```

</MemberCard>

<MemberCard>

##### Tensor.isSquare {#issquare}

```ts
readonly isSquare: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isSymmetric {#issymmetric}

```ts
readonly isSymmetric: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isSkewSymmetric {#isskewsymmetric}

```ts
readonly isSkewSymmetric: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isDiagonal {#isdiagonal}

```ts
readonly isDiagonal: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isUpperTriangular {#isuppertriangular}

```ts
readonly isUpperTriangular: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isLowerTriangular {#islowertriangular}

```ts
readonly isLowerTriangular: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isTriangular {#istriangular}

```ts
readonly isTriangular: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isIdentity {#isidentity}

```ts
readonly isIdentity: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.isZero {#iszero-2}

```ts
readonly isZero: boolean;
```

</MemberCard>

<MemberCard>

##### Tensor.at() {#at-1}

```ts
at(...indices): DataTypeMap[DT] | undefined
```

####### indices

...`number`[]

</MemberCard>

<MemberCard>

##### Tensor.diagonal() {#diagonal}

```ts
diagonal(axis1?, axis2?): DataTypeMap[DT][] | undefined
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<MemberCard>

##### Tensor.trace() {#trace-2}

```ts
trace(axis1?, axis2?): 
  | Tensor<DT>
  | DataTypeMap[DT]
  | undefined
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<MemberCard>

##### Tensor.reshape() {#reshape}

```ts
reshape(...shape): Tensor<DT>
```

####### shape

...`number`[]

</MemberCard>

<MemberCard>

##### Tensor.slice() {#slice}

```ts
slice(index): Tensor<DT>
```

####### index

`number`

</MemberCard>

<MemberCard>

##### Tensor.flatten() {#flatten}

```ts
flatten(): DataTypeMap[DT][]
```

</MemberCard>

<MemberCard>

##### Tensor.upcast() {#upcast}

```ts
upcast<DT>(dtype): Tensor<DT>
```

• DT extends keyof [`DataTypeMap`](#datatypemap)

####### dtype

`DT`

</MemberCard>

<MemberCard>

##### Tensor.transpose() {#transpose}

```ts
transpose(axis1?, axis2?): Tensor<DT> | undefined
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<MemberCard>

##### Tensor.conjugateTranspose() {#conjugatetranspose}

```ts
conjugateTranspose(axis1?, axis2?): Tensor<DT> | undefined
```

####### axis1?

`number`

####### axis2?

`number`

</MemberCard>

<MemberCard>

##### Tensor.determinant() {#determinant}

```ts
determinant(): DataTypeMap[DT] | undefined
```

</MemberCard>

<MemberCard>

##### Tensor.inverse() {#inverse}

```ts
inverse(): Tensor<DT> | undefined
```

</MemberCard>

<MemberCard>

##### Tensor.pseudoInverse() {#pseudoinverse}

```ts
pseudoInverse(): Tensor<DT> | undefined
```

</MemberCard>

<MemberCard>

##### Tensor.adjugateMatrix() {#adjugatematrix}

```ts
adjugateMatrix(): Tensor<DT> | undefined
```

</MemberCard>

<MemberCard>

##### Tensor.minor() {#minor}

```ts
minor(axis1, axis2): DataTypeMap[DT] | undefined
```

####### axis1

`number`

####### axis2

`number`

</MemberCard>

<MemberCard>

##### Tensor.map1() {#map1}

```ts
map1(fn, scalar): Tensor<DT>
```

####### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

####### scalar

[`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<MemberCard>

##### Tensor.map2() {#map2}

```ts
map2(fn, rhs): Tensor<DT>
```

####### fn

(`lhs`, `rhs`) => [`DataTypeMap`](#datatypemap)\[`DT`\]

####### rhs

[`Tensor`](#tensor)\<`DT`\>

</MemberCard>

<MemberCard>

##### Tensor.add() {#add-2}

```ts
add(other): Tensor<DT>
```

####### other

[`Tensor`](#tensor)\<`DT`\> \| [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<MemberCard>

##### Tensor.subtract() {#subtract}

```ts
subtract(other): Tensor<DT>
```

####### other

[`Tensor`](#tensor)\<`DT`\> \| [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<MemberCard>

##### Tensor.multiply() {#multiply}

```ts
multiply(other): Tensor<DT>
```

####### other

[`Tensor`](#tensor)\<`DT`\> \| [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<MemberCard>

##### Tensor.divide() {#divide}

```ts
divide(other): Tensor<DT>
```

####### other

[`Tensor`](#tensor)\<`DT`\> \| [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<MemberCard>

##### Tensor.power() {#power}

```ts
power(other): Tensor<DT>
```

####### other

[`Tensor`](#tensor)\<`DT`\> \| [`DataTypeMap`](#datatypemap)\[`DT`\]

</MemberCard>

<MemberCard>

##### Tensor.equals() {#equals-1}

```ts
equals(other): boolean
```

####### other

[`Tensor`](#tensor)\<`DT`\>

</MemberCard>

## Type

### BoxedType {#boxedtype}

<MemberCard>

##### new BoxedType()

```ts
new BoxedType(type, typeResolver?): BoxedType
```

####### type

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)

####### typeResolver?

[`TypeResolver`](#typeresolver)

</MemberCard>

<MemberCard>

##### BoxedType.unknown {#unknown}

```ts
static unknown: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.number {#number}

```ts
static number: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.non\_finite\_number {#non_finite_number}

```ts
static non_finite_number: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.infinity {#infinity}

```ts
static infinity: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.nan {#nan}

```ts
static nan: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.complex {#complex}

```ts
static complex: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.real {#real}

```ts
static real: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.integer {#integer}

```ts
static integer: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.string {#string}

```ts
static string: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.character {#character}

```ts
static character: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.dictionary {#dictionary}

```ts
static dictionary: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.setNumber {#setnumber}

```ts
static setNumber: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.setComplex {#setcomplex}

```ts
static setComplex: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.setImaginary {#setimaginary}

```ts
static setImaginary: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.setReal {#setreal}

```ts
static setReal: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.setRational {#setrational}

```ts
static setRational: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.setInteger {#setinteger}

```ts
static setInteger: BoxedType;
```

</MemberCard>

<MemberCard>

##### BoxedType.type {#type}

```ts
type: Type;
```

</MemberCard>

<MemberCard>

##### BoxedType.isPolymorphic {#ispolymorphic}

```ts
readonly isPolymorphic: boolean;
```

True when this type is a **polytype**: a signature carrying a `where`
clause, or an overload set with at least one such arm.

Computed ONCE, here, at construction: every per-call dispatch check
(argument validation, result typing) reads this boolean and is O(1) — it
must never become a tree walk. Polytypes are legal only as signatures, so
the computation itself is a shallow field test.

</MemberCard>

<MemberCard>

##### BoxedType.typeResolver {#typeresolver}

The resolver this type was created with, so a DERIVED boxed type (a
projection of this one) can be built without losing the ability to name a
user-declared type.

</MemberCard>

<MemberCard>

##### BoxedType.unionMembers {#unionmembers}

The members of a union type, each boxed, or `[this]` for any other type.

Lets a consumer reason arm-by-arm without reading the raw `Type` AST.
Note that a union may be nested inside a parameter (`list<A | B>`), which
this does not reach — `couldMatch()` handles that case directly and is
usually what an arm walk was reaching for.

</MemberCard>

<MemberCard>

##### BoxedType.effects {#effects}

The **latent** effects on this type's arrow: what fires if a value of this
type is invoked. `undefined` when the type is not callable, or when its
arrow states nothing (the inferred track); `[]` when it states `pure`;
`'any'` for "unknown effects"; otherwise the labels, alphabetically
sorted.

This is how an operator asks "what happens if I call this operand?" —
`op.type.effects`, which resolves through symbol bindings because `.type`
does. It is the *invoking* half of the effects model; the *producing*
half — what evaluating an expression does — is `expr.effects`.

For an overload set (an intersection of signatures) the answer is the
union of the arms': an overload with one effect-bearing arm is not pure.

```ts
ce.type('(real) random -> real').effects;  // ➔ ['random']
ce.type('(real) pure -> real').effects;    // ➔ []
ce.type('(real) -> real').effects;         // ➔ undefined
ce.type('number').effects;                 // ➔ undefined
```

</MemberCard>

<MemberCard>

##### BoxedType.isUnknown {#isunknown}

</MemberCard>

<MemberCard>

##### BoxedType.widen() {#widen}

```ts
static widen(...types): BoxedType
```

####### types

...readonly ([`Type`](#type-3) \| [`BoxedType`](#boxedtype))[]

</MemberCard>

<MemberCard>

##### BoxedType.narrow() {#narrow}

```ts
static narrow(...types): BoxedType
```

####### types

...readonly ([`Type`](#type-3) \| [`BoxedType`](#boxedtype))[]

</MemberCard>

<MemberCard>

##### BoxedType.matches() {#matches}

```ts
matches(other): boolean
```

True when every value of this type is an `other`.

**A polymorphic PATTERN is a consistent existential** (D12): the pattern's
variables are solved against the subject and the match holds iff a
consistent instantiation exists — so
`ce.type('(number) -> number').matches('(T) -> T where T')` is `true`,
the probe users actually mean. `couldMatch` deliberately answers `false`
on the same row (D6's bound-reading, contravariant `any`); the two
predicates diverge by design.

A polymorphic SUBJECT is the `isSubtype` story: rule 1 against a ground
pattern (instantiate-and-check), rule 3 (α-equivalence) against a
polymorphic one.

####### other

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### BoxedType.is() {#is}

```ts
is(other): boolean
```

####### other

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### BoxedType.isDisjointFrom() {#isdisjointfrom}

```ts
isDisjointFrom(other): boolean
```

True when no value can inhabit both this type and `other`.

Use this — not `!matches()` — to decide whether two types are unrelated.
`matches()` answers "is this a subtype of `other`", so two types that
share values without either containing the other (`integer | string` vs
`integer | boolean`) fail `matches()` in both directions.

Conservative in the safe direction: when disjointness cannot be
established the answer is `false` ("they may overlap"), never a false
claim of disjointness. So `!a.isDisjointFrom(b)` reads as *possible*
overlap, and `unknown` overlaps everything.

Throws if `other` is a string that is not a valid type.

####### other

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### BoxedType.couldMatch() {#couldmatch}

```ts
couldMatch(other): boolean
```

True when *some* value inhabits both this type and `other` — "could a
value of this type be an `other`?".

This is the predicate for classifying a value by shape ("might this be a
point, a point list, a matrix"). Prefer it to `matches()`, which answers
"is EVERY value of this type an `other`" and so reports `false` for a
union whose members include exactly the shape asked about:

```ts
const t = ce.type('tuple<number, number> | list<tuple<number, number>>');
t.matches('list<tuple<number, number>>');    // false
t.couldMatch('list<tuple<number, number>>'); // true
```

Unions are distributed at every depth, so a union nested inside a
parameter is handled too — `list<integer | tuple<number, number>>` could
be a `list<tuple<number, number>>`, witness `[(1,2)]`.

Symmetric, and decisive for the composite shapes it models: a
`tuple<number, number>` could not be a `list<tuple<number, number>>`, and
`list<integer>` could not be a `list<string>`. Shapes it does not model
fall back to assignability in either direction, so the answer is never
narrower than `matches()` — with one deliberate exception: `never` is
uninhabited, so nothing could be a `never`.

`unknown` could be anything. Consumers that treat an inconclusive type as
"no" must check `isUnknown` themselves.

Throws if `other` is a string that is not a valid type.

####### other

  \| `string`
  \| [`AlgebraicType`](#algebraictype)
  \| [`NegationType`](#negationtype)
  \| [`CollectionType`](#collectiontype)
  \| [`ListType`](#listtype)
  \| [`SetType`](#settype)
  \| [`BroadcastableType`](#broadcastabletype)
  \| [`RecordType`](#recordtype)
  \| [`ObjectType`](#objecttype)
  \| [`DictionaryType`](#dictionarytype)
  \| [`TupleType`](#tupletype)
  \| [`SymbolType`](#symboltype)
  \| [`ExpressionType`](#expressiontype)
  \| [`NumericType`](#numerictype)
  \| [`FunctionSignature`](#functionsignature)
  \| [`ValueType`](#valuetype)
  \| [`TypeVariable`](#typevariable)
  \| [`TypeReference`](#typereference)
  \| [`BoxedType`](#boxedtype)

</MemberCard>

<MemberCard>

##### BoxedType.toString() {#tostring}

```ts
toString(): string
```

</MemberCard>

<MemberCard>

##### BoxedType.toJSON() {#tojson}

```ts
toJSON(): string
```

</MemberCard>

<MemberCard>

##### BoxedType.\[toPrimitive\]() {#toprimitive}

```ts
toPrimitive: string | null
```

####### hint

`string`

</MemberCard>

<MemberCard>

##### BoxedType.valueOf() {#valueof}

```ts
valueOf(): string
```

</MemberCard>



## MathJSON

<MemberCard>

### MathJsonAttributes {#mathjsonattributes}

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

</MemberCard>

<MemberCard>

### MathJsonSymbol {#mathjsonsymbol}

```ts
type MathJsonSymbol = string;
```

</MemberCard>

<MemberCard>

### MathJsonNumberObject {#mathjsonnumberobject}

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

<MemberCard>

### MathJsonSymbolObject {#mathjsonsymbolobject}

```ts
type MathJsonSymbolObject = {
  sym: MathJsonSymbol;
 } & MathJsonAttributes;
```

</MemberCard>

<MemberCard>

### MathJsonStringObject {#mathjsonstringobject}

```ts
type MathJsonStringObject = {
  str: string;
 } & MathJsonAttributes;
```

</MemberCard>

<MemberCard>

### MathJsonFunctionObject {#mathjsonfunctionobject}

```ts
type MathJsonFunctionObject = {
  fn: [MathJsonSymbol, ...MathJsonExpression[]];
 } & MathJsonAttributes;
```

</MemberCard>

<MemberCard>

### DictionaryValue {#dictionaryvalue}

```ts
type DictionaryValue = 
  | boolean
  | number
  | string
  | ExpressionObject
| ReadonlyArray<DictionaryValue>;
```

</MemberCard>

<MemberCard>

### MathJsonDictionaryObject {#mathjsondictionaryobject}

```ts
type MathJsonDictionaryObject = {
  dict: Record<string, DictionaryValue>;
 } & MathJsonAttributes;
```

</MemberCard>

<MemberCard>

### ExpressionObject {#expressionobject}

```ts
type ExpressionObject = 
  | MathJsonNumberObject
  | MathJsonStringObject
  | MathJsonSymbolObject
  | MathJsonFunctionObject
  | MathJsonDictionaryObject;
```

</MemberCard>

<MemberCard>

### MathJsonExpression {#mathjsonexpression}

```ts
type MathJsonExpression = 
  | ExpressionObject
  | number
  | MathJsonSymbol
  | string
  | readonly [MathJsonSymbol, ...MathJsonExpression[]];
```

A MathJSON expression is a recursive data structure.

The leaf nodes of an expression are numbers, strings and symbols.
The dictionary and function nodes can contain expressions themselves.

</MemberCard>



## Type

<MemberCard>

### PrimitiveType {#primitivetype}

```ts
type PrimitiveType = 
  | NumericPrimitiveType
  | "collection"
  | "indexed_collection"
  | "list"
  | "range"
  | "set"
  | "dictionary"
  | "record"
  | "object"
  | "tuple"
  | "value"
  | "scalar"
  | "function"
  | "symbol"
  | "boolean"
  | "string"
  | "character"
  | "regexp"
  | "color"
  | "type"
  | "expression"
  | "unknown"
  | "error"
  | "nothing"
  | "missing"
  | "never"
  | "any";
```

A primitive type is a simple type that represents a concrete value.

- `any`: the top type
   - `expression`
   - `error`: an invalid value, such as `["Error", "missing"]`
   - `nothing`: the type of the `Nothing` symbol, the unit type
   - `missing`: the type of the `Missing` symbol, the unit type of an
      absent-but-positioned value (Julia `missing`, R `NA`)
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
     - `character`: exactly one user-perceived character (grapheme cluster).
   - `collection`
      - `set`: a collection of unique expressions, e.g. `set<string>`.
      - `record`: a collection of specific key-value pairs,
         e.g. `record{x: number, y: boolean}`.
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
          - `string`: a string of characters, i.e. an indexed collection of
             `character`. A sibling of `list<character>`, not a subtype.

</MemberCard>

<MemberCard>

### NumericPrimitiveType {#numericprimitivetype}

```ts
type NumericPrimitiveType = 
  | "number"
  | "complex"
  | "imaginary"
  | "real"
  | "rational"
  | "integer"
  | "non_finite_number"
  | "infinity"
  | "nan";
```

The numeric tree is FINITE BY DEFAULT and DISJOINT: every numeric VALUE is a
finite number, a number of infinite magnitude, or the not-a-number marker,
and no value is two of those — `number = complex ⊔ infinity ⊔ nan` as a
partition of the values. Every bare name below `complex` contains only
finite values. A bare `real` result type is therefore a promise of
finiteness, and the extended real line is written out as
`real | non_finite_number` — `non_finite_number` being the SIGNED pair
`+∞`/`−∞`, so the union excludes the unsigned `~∞` that `infinity` would
bring in. That spelling is shared as the frozen `EXTENDED_REAL_TYPE`
constant in `common/type/primitive.ts`; use it rather than rebuilding the
union.

The partition is a statement about values, NOT one the SUBTYPE RELATION
closes over. `isSubtype('complex | infinity | nan', 'number')` is true, but
the converse `isSubtype('number', 'complex | infinity | nan')` is FALSE: a
union is a supertype only of types below one of its members, and `number` is
above all three rather than inside any one of them. Deciding the converse
needs covering-union machinery that the type checker does not have. So do
not use a three-way union as a stand-in for `number` in a signature, and do
not read the `⊔` above as a subtyping identity.

- `number`: any numeric value — a finite number, a number of infinite
  magnitude, or the not-a-number marker.
- `complex`: a FINITE complex number = `imaginary` + `real`.
- `imaginary`: a finite complex number with a real part of 0 (pure
  imaginary).
- `real`: a finite real number (imaginary part 0) = `rational` plus the
  finite irrationals.
- `rational`: a finite rational number (includes the integers).
- `integer`: a finite whole number.
- `infinity`: a number of infinite magnitude, of any direction — the signed
  `+∞` and `−∞`, the unsigned complex infinity `~∞`, and mixed directed
  values such as `∞ + i`. Disjoint from `complex`: an infinity is not a
  finite number.
- `non_finite_number`: exactly the SIGNED pair `+∞`, `−∞`. It sits under
  `infinity` alone and is the atom the sign-aware folds (`1/±∞ = 0`)
  consume; `infinity` itself admits the unsigned `~∞`, which has no sign.
- `nan`: the not-a-number marker. Its only supertype is `number`, so it is
  disjoint from `complex`, `infinity` and every type below them.

RETIRED SPELLINGS. The five names that prefixed a tier with `finite_` are
no longer members of this union. Each denoted exactly the same set of values
as one of the bare names above, because every bare name under `number` is
finite: the four per-tier spellings each meant their own tier, and the
widest of them meant `complex` ("any finite number" IS the finite complex
type). The type PARSER still accepts all five as input aliases for one
release cycle and normalizes each to the name it denotes
(`RETIRED_NUMERIC_ALIASES` in `parser.ts`), but an alias never reaches a
`Type` node and is never serialized back out.

</MemberCard>

<MemberCard>

### NamedElement {#namedelement}

```ts
type NamedElement = {
  name: string;
  type: Type;
};
```

</MemberCard>

<MemberCard>

### EffectLabel {#effectlabel}

```ts
type EffectLabel = 
  | "console"
  | "entropy"
  | "environment"
  | "fs_read"
  | "fs_write"
  | "network"
  | "random"
  | "scope"
  | "state"
  | "time";
```

An effect label: a member of a closed, engine-versioned enumeration.

Each label carries fixed metadata (impurity, observation vs action, frame
kind, handler-backed); consumers key on that metadata, never on the label
name. See `docs/EFFECTS-MODEL.md`.

The labels bear no implication relations to each other: the order on effect
sets is plain powerset inclusion, so the singletons are pairwise
incomparable (in particular `fs_write` does not imply `fs_read`).

</MemberCard>

<MemberCard>

### EffectSet {#effectset}

```ts
type EffectSet = "any" | EffectLabel[];
```

The effect set carried by a signature's arrow.

- `'any'` is the distinguished **top**: "unknown effects". Under union it
  absorbs, and no finite bound admits it.
- Otherwise a duplicate-free, alphabetically sorted list of labels, possibly
  **empty**.

An absent (`undefined`) `effects` field and `[]` denote the **same set**, ∅:
every semantic operation — subtyping, `pure`, the label predicates, union,
`matches()` — treats them identically. They differ only in **serialization**
(ruled 2026-08-01): absent is an empty specifier slot (effects were never
stated, and stay on the inferred track), while `[]` is the author's `pure`
and serializes back as ` pure`, so an explicit purity contract survives a
parse → serialize → re-declare round trip.

Build one with `normalizeEffectSet()` (inference: an empty result collapses
to `undefined`) or `normalizeStatedEffectSet()` (a stated set: an empty
result stays `[]`).

</MemberCard>

<MemberCard>

### TypeVariable {#typevariable}

```ts
type TypeVariable = {
  kind: "variable";
  name: string;
};
```

A universally quantified type variable (rank-1).

Only legal inside a function signature; declared and scoped by its arm's
`where` clause (the `typeParams` field of [FunctionSignature](#functionsignature)). A variable is
**atomic and opaque**: it is never reduced, distributed or collapsed, and it
is substituted away by instantiation at a call site.

</MemberCard>

<MemberCard>

### TypeVariance {#typevariance}

```ts
type TypeVariance = "in" | "out" | "inout";
```

How a parameterized NOMINAL type relates two of its applications
(`docs/TYPE-SYSTEM.md`).

Declared inside a type-parameter clause (`type tree<out T> = …`); the words
are contextual there and are never reserved. Only a nominal declaration
carries one — a transparent alias has no declaration-level variance, and a
`where` clause never does.

</MemberCard>

<MemberCard>

### TypeParameter {#typeparameter}

```ts
type TypeParameter = {
  name: string;
  bound: Type;
  variance: TypeVariance;
  protocols: string[];
};
```

One entry of a signature's `where` clause, or of a declared type's
type-parameter clause: the variable's name and its optional declared upper
bound.

The bound must be **ground** (no type variables) — validated when the
declared type is boxed. An unbounded variable's implicit bound is `any`.

</MemberCard>

<MemberCard>

### TypeParamsOption {#typeparamsoption}

```ts
type TypeParamsOption = 
  | string
  | ReadonlyArray<
  | string
  | {
  name: string;
  bound: Type | TypeString;
  variance: TypeVariance;
}>;
```

The `typeParams` option of a generic type declaration — an ALIAS
(`ce.declareType('Pair', 'tuple<T, T>', { alias: true, typeParams: ['T'] })`)
or a parameterized NOMINAL type
(`ce.declareType('tree', '…', { typeParams: [{ name: 'T', variance: 'out' }] })`).

Either clause TEXT (`'T, U: number'`, also accepted one entry at a time) or
pre-built parameters whose bound may be a type string. Every TEXT spelling
goes through the shared clause parser (`parseTypeParameterClause`); the
object-array form is validated directly by `normalizeDeclaredTypeParams`
(same rules: reserved names, duplicates, ground bounds).

</MemberCard>

<MemberCard>

### FunctionSignature {#functionsignature}

```ts
type FunctionSignature = {
  kind: "signature";
  args: NamedElement[];
  optArgs: NamedElement[];
  variadicArg: NamedElement;
  variadicMin: 0 | 1;
  effects: EffectSet;
  typeParams: TypeParameter[];
  result: Type;
};
```

</MemberCard>

<MemberCard>

### AlgebraicType {#algebraictype}

```ts
type AlgebraicType = {
  kind: "union" | "intersection";
  types: Type[];
};
```

</MemberCard>

<MemberCard>

### NegationType {#negationtype}

```ts
type NegationType = {
  kind: "negation";
  type: Type;
};
```

</MemberCard>

<MemberCard>

### ValueType {#valuetype}

```ts
type ValueType = {
  kind: "value";
  value: any;
};
```

</MemberCard>

<MemberCard>

### RecordType {#recordtype}

```ts
type RecordType = {
  kind: "record";
  elements: Record<string, Type>;
};
```

A record is a collection of key-value pairs.

The keys are strings. The set of keys is fixed.

For a record type to be a subtype of another record type, it must contain
every key required by the other type, and all their types must match (width
subtyping). It may contain additional keys.

</MemberCard>

<MemberCard>

### ObjectType {#objecttype}

```ts
type ObjectType = {
  kind: "object";
  elements: Record<string, Type>;
};
```

The stored-field layout of an **object** type — the engine's one mutable
value kind.

Structurally this looks like [RecordType](#recordtype), and the two are read the
same way (an ordered map from field name to field type), but they behave in
opposite ways, and the difference is deliberate:

- An object type is **nominal**. This shape is only ever the definition
  (`def`) of a declared [TypeReference](#typereference): `type Person = object{…}`.
  Two object types with identical layouts are unrelated, because a store
  through one view would break the other's declared field types (write
  `1.5` into an `object{count: integer}` viewed as `object{count: number}`).
  The nominal reference is what supplies that opacity; this shape only
  carries the layout.
- Every field is a read/write position, so a field type is **invariant**:
  two object layouts relate only when every field type is mutually equal,
  and a type variable occurring in a field verifies only as `inout`.

The bare primitive `'object'` means "any object" and is the one common
bound every declared object type is a subtype of. It sits BESIDE `record`
in the lattice and is disjoint from it — sibling categories, one
immutable/structural, one mutable/nominal — and is deliberately not a
collection.

Spec: `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Declaring an object type",
"No subtyping between object types", "Generic object types" (ruling B13),
and the lattice bullet of "The rest of the system" (ruling B6).

</MemberCard>

<MemberCard>

### DictionaryType {#dictionarytype}

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

<MemberCard>

### CollectionType {#collectiontype}

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

<MemberCard>

### ListType {#listtype}

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

<MemberCard>

### SymbolType {#symboltype}

```ts
type SymbolType = {
  kind: "symbol";
  name: string;
};
```

</MemberCard>

<MemberCard>

### ExpressionType {#expressiontype}

```ts
type ExpressionType = {
  kind: "expression";
  operator: string;
};
```

</MemberCard>

<MemberCard>

### NumericType {#numerictype}

```ts
type NumericType = {
  kind: "numeric";
  type: NumericPrimitiveType;
  lower: number;
  upper: number;
};
```

</MemberCard>

<MemberCard>

### SetType {#settype}

```ts
type SetType = {
  kind: "set";
  elements: Type;
};
```

Each element of a set is unique (is not present in the set more than once).
The elements of a set are not indexed.

</MemberCard>

<MemberCard>

### BroadcastableType {#broadcastabletype}

```ts
type BroadcastableType = {
  kind: "broadcastable";
  elements: Type;
};
```

A `broadcastable<T>` is either a `T`, or an indexed collection of `T`
applied element-wise (runtime broadcasting). It is the static type of an
arithmetic result whose operand's collection-ness is not statically visible.

A `T` (and any subtype of `T`) is a subtype of `broadcastable<T>`, and so is
any indexed collection whose elements are subtypes of `T`. It is *not* a
subtype of `T` (it may be a collection) nor of `list<T>` (it may be a
scalar). See `subtype.ts` for the full relation.

</MemberCard>

<MemberCard>

### TupleType {#tupletype}

```ts
type TupleType = {
  kind: "tuple";
  elements: NamedElement[];
};
```

The elements of a tuple are indexed and may be named or unnamed.
If one element is named, all elements must be named.

</MemberCard>

<MemberCard>

### TypeReference {#typereference}

```ts
type TypeReference = {
  kind: "reference";
  name: string;
  alias: boolean;
  def: Type | undefined;
  typeParams: TypeParameter[];
  args: Type[];
  _varianceState: "deferred" | "verified";
  _varianceBlockedOn: string[];
  _sumOf: string;
  _sumVariants: {
     name: string;
     typeParams: string[];
    }[];
  _declOrigin: DeclarationOrigin;
};
```

Nominal typing

</MemberCard>

<MemberCard>

### DeclarationOrigin {#declarationorigin}

```ts
type DeclarationOrigin = {
  batch: number;
  statementId: unknown;
  firstRange: [number, number];
};
```

Which compilation unit and which declaring statement a registry record came
from — the runtime half of the redefinition discipline
(`docs/TYPE-SYSTEM.md`, "Mechanics").

A second declaration of a name with the SAME `batch` and a DIFFERENT
`statementId` is a within-unit redefinition and is refused; the same
`statementId` re-registering is the same statement declaring itself again
(one statement registers up to three times per batch — the static pre-pass
canonicalizes it, then the evaluation loop canonicalizes and evaluates it)
and is accepted.

`statementId` is an opaque IDENTITY token, compared with `!==` and never
inspected: the raw (uncanonicalized) name operand the `Declare*` handlers
thread from their canonical handler into their evaluate handler. It is typed
`unknown` so this engine-free module needs no expression type.

</MemberCard>

<MemberCard>

### Type {#type-3}

```ts
type Type = 
  | PrimitiveType
  | AlgebraicType
  | NegationType
  | CollectionType
  | ListType
  | SetType
  | BroadcastableType
  | RecordType
  | ObjectType
  | DictionaryType
  | TupleType
  | SymbolType
  | ExpressionType
  | NumericType
  | NumericPrimitiveType
  | FunctionSignature
  | ValueType
  | TypeVariable
  | TypeReference;
```

</MemberCard>

<MemberCard>

### TypeString {#typestring}

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
               | <set>
               | <broadcastable>
               | <collection>
               | <type_reference>

(A reference to a user-declared type. The optional argument list applies a
GENERIC type alias (`Pair<integer>`); it is expanded eagerly into the
substituted alias body when the type is built, so an applied reference never
appears in a `Type`. The authoritative grammar lives with the parser in
`./parser.ts`.)

<type_reference> ::= ( "type" )? <identifier> ( "<" <type> ("," <type>)* ">" )?

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

<signature> ::=  <arguments> (" " <effects>)? " -> " <type>

<effects> ::= "pure" | "any" | <effect-label> (" " <effect-label>)*

(`pure` is the STATED empty set: the same set as an empty slot, and the
spelling that round-trips through serialization. See {@link EffectSet}.)

<effect-label> ::= "console" | "entropy" | "environment" | "fs_read"
           | "fs_write" | "network" | "random" | "scope" | "time"

<arguments> ::= "()"
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
           | "vector<" (<type> <dimensions>? | <dimensions>) ">"
           | "matrix<" (<type> <dimensions>? | <dimensions>) ">"
           | "tensor<" <type> ">"
  Note: there is no `[type]` bracket shorthand; a list is always written with
  one of the `list`/`vector`/`matrix`/`tensor` heads. The authoritative
  grammar lives with the parser in `./parser.ts`.

<dimensions> ::= "^" <fixed_size>
           | "^(" <multi_dimensional_size> ")"

<fixed_size> ::= <positive-integer_literal>

<multi_dimensional_size> ::= <positive-integer_literal> "x" <positive-integer_literal> ("x" <positive-integer_literal>)*

(The `callback<…>` constructor of Design D was RETIRED by Design E
(`docs/TYPE-SYSTEM.md`): callback
slots are ordinary arrow types, admitted by COMPATIBILITY rather than
subtyping. The spelling now fails to parse, with a migration hint.)

<set> ::= "set<" <type> ">"

<broadcastable> ::= "broadcastable" ( "<" <type> ">" )?

<collection> ::= ( "collection" | "indexed_collection" ) ( "<" <type> ">" )?

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
- `"vector<boolean^32>"` -- a list type with a fixed size of 32 elements
- `"matrix<integer^(2x3)>"` -- an integer matrix of 2 columns and 3 rows
- `"list<integer^(2x3x4)>"` -- a tensor of dimensions 2x3x4
- `"number -> number"` -- a signature with a single argument
- `"(x: number, number) -> number"` -- a signature with a named argument
- `"(number, y:number?) -> number"` -- a signature with an optional named argument (can have several optional arguments, at the end)
- `"(number, number+) -> number"` -- a signature with a rest argument (can have only one, and no optional arguments if there is a rest argument).
- `"() -> number"` -- a signature with an empty argument list
- `"(number) random -> number"` -- a signature that may draw from the seeded random stream
- `"(number) random scope -> number"` -- a signature with two effect labels
- `"(number) any -> number"` -- a signature with unknown effects
- `"number | boolean"` -- a union type
- `"(x: number) & (y: number)"` -- an intersection type
- `"number | ((x: number) & (y: number))"` -- a union type with an intersection type
- `"(number -> number) | number"` -- a union type with a signature and a primitive type

</MemberCard>

<MemberCard>

### TypeCompatibility {#typecompatibility}

```ts
type TypeCompatibility = "covariant" | "contravariant" | "bivariant" | "invariant";
```

</MemberCard>

<MemberCard>

### TypeResolver {#typeresolver}

```ts
type TypeResolver = {
  get names: string[];
  forward: (name) => TypeReference | undefined;
  resolve: (name) => TypeReference | undefined;
  conformsTo: (type, protocol) => boolean;
};
```

A type resolver should return a definition for a given type name.

</MemberCard>

----

<MemberCard>

### COMPLEX\_INFINITY\_VALUE {#complex_infinity_value}

```ts
const COMPLEX_INFINITY_VALUE: Readonly<{
  complexInfinity: true;
}>;
```

The value carried by the type of the unsigned complex infinity `~oo`, which
has no JavaScript number to stand for it: `Infinity` and `-Infinity` are the
signed pair, and `NaN` is a different value altogether.

A value-literal type holds an arbitrary runtime value (see [`ValueType`](#valuetype)), so this frozen tagged object is that value. Test for it with
[`isComplexInfinityValue`](#iscomplexinfinityvalue), which reads the TAG: a `Type` node can be
rebuilt or re-frozen on its way through the parser and the reducers, so
object identity is not a reliable test.

</MemberCard>

----

<MemberCard>

### isComplexInfinityValue() {#iscomplexinfinityvalue}

```ts
function isComplexInfinityValue(v): v is Readonly<{ complexInfinity: true }>
```

True if `v` is the [`COMPLEX_INFINITY_VALUE`](#complex_infinity_value) sentinel, i.e. the
value of the `~oo` value-literal type. Reads the tag, never the identity.

##### v

`unknown`

</MemberCard>
