---
title: Core Reference
sidebar_label: Core
slug: /epsil/reference/core/
description: "The core library of Epsil: every definition with its Epsil spelling, MathJSON name, signature, and full description."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. The entries come from the library
# definitions (src/compute-engine/library/) as `epsil doc` describes them;
# the introduction comes from core.intro.md when that file exists.
# Regenerate with `npm run doc` (scripts/build-library-reference.ts).
---
# Core

The 111 definitions of the core library, each with its Epsil spelling, its MathJSON name, its signature and its full description.

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### about

MathJSON `About` · `(any) -> dictionary<any>`

Return information about an expression as a dictionary: its kind (symbol, constant, function, number, string, expression), its static type and, when applicable, its name, value, signature, clause listing, algebraic attributes, description, wikidata and url.

### angle

MathJSON `Angle` · `(any+) -> number`

Angle mark / measure (`\angle ABC`, `\varangle XYZ`, `∠ABC`) — opaque typed head; not evaluated.

### Annotated

`(expression, dictionary<any>) -> expression`

Attach metadata or style annotations to an expression.

### apply

MathJSON `Apply` · `(name: any, arguments: any*) -> unknown`

Apply a function to a list of arguments

### applyWhole

MathJSON `ApplyWhole` · `(name: any, arguments: any*) -> unknown`

Apply a function to arguments, each bound whole (engine-internal).

### arc

MathJSON `Arc` · `(any+) -> number`

Arc / wide-hat accent measure (`\widehat{ABC}`) — opaque typed head; not evaluated.

### Assign

`(expression | symbol, any) scope -> any`

Assign a value to a symbol or define a sequence. The RHS is evaluated immediately and `ce.assign(name, val)` mutates the binding in the current scope chain. When used inside a `Block`, the assignment is visible to subsequent statements in the block (sequential semantics).

### assume

MathJSON `Assume` · `(any) scope -> string`

Record an assumption about a symbol. Evaluates to the outcome as a string: "ok", "tautology", "contradiction", "not-a-predicate" or "internal-error".

### baseForm

MathJSON `BaseForm` · `(T, (number | string)?) -> T where T: number`

`BaseForm(expr, base=10)`

### BuiltinFunction

`(string | symbol) -> symbol`

Return a built-in function symbol by name.

### canonicalForm

MathJSON `CanonicalForm` · `(any, symbol*) -> any`

Return the canonical form of an expression

Can be used to sort arguments of an expression.

Sorting arguments of commutative functions is a weak form of canonicalization that can be useful in some cases, for example to accept "x+1" and "1+x" while rejecting "x+1" and "2x-x+1"

### caseFold

MathJSON `CaseFold` · `(string) -> string`

CaseFold(s): a case-folded form of `s`, for case-insensitive comparison — `CaseFold(a) == CaseFold(b)` tests equality ignoring case. An approximation of Unicode full case folding.

### characterFrom

MathJSON `CharacterFrom` · `(string) -> character`

CharacterFrom(s): the character `s` denotes. `s` must be exactly one user-perceived character (one grapheme cluster) after NFC normalization; an empty or multi-character string is an error.

### characters

MathJSON `Characters` · `(string) -> list<character>`

Characters(s): split a string into a list of user-perceived characters (grapheme clusters). Synonym: GraphemeClusters. For stable integer decompositions see UnicodeScalars, Utf8 and Utf16. A non-string argument leaves the expression unevaluated.

### Coalesce

`(any+) -> unknown`

Return the first operand that is not ABSENT (`Missing`, `Undefined` or `NaN`), evaluated left-to-right. If every operand is absent, the last operand’s value is returned verbatim (still absent).

### Colon

`(any, any) -> expression`

Type annotation (`a : b`) — opaque typed head.

### conforms

MathJSON `Conforms` · `(subject: any, protocols: string+) -> boolean`

True iff the subject conforms to EVERY named protocol. A `type` VALUE subject asks whether that type conforms (the branch is unambiguous because the `type` primitive itself declares no conformances); any other subject is evaluated once and its precise type is asked. This is the lowering of the Epsil `x is Hashable & Comparable` test. A valueless or unresolved subject stays symbolic; an unknown protocol name is an error; an Error-valued subject answers `False` (the `error` type declares no conformances). Conformance is monotone but late-bound: the answer reflects the registry at the moment of evaluation.

### Declare

`(symbol, type: (string | symbol)?, value: any?, attributes: dictionary<any>?) scope -> any`

Declare a symbol in the current scope, optionally assigning a type and an initial value. An optional trailing attributes dictionary (with keys `type`, `value`, `constant` and `holdUntil`) can further describe the definition, e.g. to declare a constant. With a value, evaluates to that value; otherwise evaluates to `Nothing`.

### DeclareConformance

`(target: string | symbol, protocols: any, whereClauseOrImplementation: any?, implementation: dictionary<any>?) scope -> nothing`

Declare that a type CONFORMS to one or more protocols — the lowering of the Epsil `type string is Hashable & Comparable` statement. The target rides as a type-expression string and must be named and ground (not a union, an anonymous structural type or a `type alias` name); the protocols ride as a `List` of names. An optional trailing dictionary carries the implementation block, member name -&gt; function literal (property handlers under the mangled keys `__get__x` / `__set__x`); it may only accompany a SINGLE protocol. A CONDITIONAL conformance carries, ahead of that block, the source text of its trailing `where` clause as a string: the target is then a head pattern naming the variables the clause binds (`list<T>` with `"where T is Comparable"`). Conformance is monotone — it can be added but never removed — and a re-declaration is a no-op. Evaluates to `Nothing`.

### DeclareProtocol

`(string | symbol, members: dictionary<any>?) scope -> nothing`

Declare a PROTOCOL: a set of function and property requirements a type may declare itself to satisfy. Protocols are engine-global (not lexically scoped) and are NOT types, so this is only valid at the top level of a program. The name is a symbol (or a string); the optional members ride as a dictionary of `member -> ["Pair", "function"|"readonly"|"readwrite", signature]`, with the signature as a type-expression string. A `function` member's first parameter must be typed `Self`, the substitution token standing for the conforming type. A protocol with no members is a SEMANTIC protocol (a marker). Evaluates to `Nothing`.

### DeclareSumType

`(string | symbol, any*) scope -> nothing`

Declare a SUM TYPE: N nominal variants plus the transparent union that names them, in one statement — the lowering of the Epsil sugar `type node = lit(num: number) | plus(op1: node, op2: node)`. The name is a symbol (or a string); each variant is a `["Tuple", name, payload]` pair whose payload is a type string (`"nothing"` for a nullary variant). An optional attributes dictionary at operand 1 — ahead of the variants — carries `typeParams -> "T"` for a generic sum, whose parameters are distributed to each variant by usage. The sum name is forward-registered before the variants are declared, so a payload may name it bare. A variant name that already names a type, is reserved, or is a builtin is rejected and NOTHING is declared. Types are engine-global, so this is only valid at the top level of a program. Evaluates to `Nothing`.

### DeclareType

`(string | symbol, type: string | symbol | type, attributes: dictionary<any>?) scope -> nothing`

Declare a type. Types are engine-global (not lexically scoped), so this is only valid at the top level of a program — inside a block or function body it is an error. The name is a symbol (or a string) and the type a string holding a type expression, e.g. `"tuple<x: integer, y: integer>"`. The type is nominal by default; an optional trailing attributes dictionary with `alias -> True` makes it a structural alias instead, and an additional `typeParams -> "T, U: number"` entry makes it a GENERIC alias whose uses must be applied (`Pair<integer>`). The declaration also mints a value constructor of the same name — `["point", 1, 2]`, an inert tagged value for a nominal type, a checked identity for an alias — except for a `record` body, which mints none. Evaluates to `Nothing`.

### DefineFunction

`(symbol, function, dictionary<any>?) scope -> nothing`

Define one clause of a (possibly multi-clause) function: `DefineFunction(f, Function(body, params…))`. Unlike `Assign` — which replaces the binding wholesale — `DefineFunction` ACCUMULATES: a clause with the same parameter domain replaces the earlier clause in place, any other clause is appended, and calls dispatch to the most specific clause admitting the arguments.

### Delimiter

`(any, string?) -> any`

Group expressions with explicit delimiters.

### digitsFrom

MathJSON `DigitsFrom` · `(string, (integer | string)?) -> integer`

Return an integer representation of the string `s` in base `base`.

### error

MathJSON `Error` · `(expression<ErrorCode> | string, expression?) -> nothing`

Represent an error expression.

### ErrorCode

`(string, any*) -> error`

Structured error code with optional arguments.

### evaluate

MathJSON `Evaluate` · `(any) -> unknown`

Evaluate an expression.

### evaluateAt

MathJSON `EvaluateAt` · `(function, lower: expression, upper: expression) -> unknown`

Evaluate a function at one point or between two bounds.

### findRoot

MathJSON `FindRoot` · `(any, any) -> dictionary`

FindRoot(equations, params): numerically find parameter values that

zero the residuals. `equations` is an equation (`lhs == rhs`), a bare

residual expression (read as `= 0`), or a list of either. `params` is

a list of specs (a bare symbol, `(a, a0)`, or `(a, a0, lo, hi)` with

box constraints), matching `FindFit`. Returns a record

&#123;parameters, converged, residualNorm, iterations&#125;.

### Function

`(expression, (function | symbol)*) -> function`

A function literal

### geometricVector

MathJSON `GeometricVector` · `(any, any) -> expression`

Geometric vector (directed segment between two points) — opaque typed head. Distinct from the column-vector `Vector` operator.

### graphemeClusters

MathJSON `GraphemeClusters` · `(string) -> list<character>`

A collection of grapheme clusters from a string. Synonym of Characters.

### head

MathJSON `Head` · `(any) -> symbol`

Return the head of an expression, the name of the operator

### Hold

`(any) -> unknown`

Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it

### HoldValues

`(any, any?) -> expression`

HoldValues(body): evaluate `body` with its assigned free symbols

shielded — each such symbol becomes a pure symbol (its declared type

and in-scope assumptions apply, its assigned value does NOT) for the

duration. The value-blind counterpart of evaluating `body` directly;

analogous to Mathematica's `Block[{x}, …]`.

HoldValues(body, [x, y]): shield only the listed symbols (a List,

Set, Tuple, or a single symbol); every other symbol resolves normally.

Constants (`Pi`, `ExponentialE`, …) are never shielded, assumptions

survive the shield, and the global values are intact afterwards.

### HorizontalSpacing

`(number) -> nothing`

Horizontal spacing annotation.

### identity

MathJSON `Identity` · `(T) -> T where T`

Return the argument unchanged

### IndexedSequence

`(any, symbol, any, any?) -> expression`

Indexed sequence `\{a_n\}_{n=1}^{\infty}` — inert head `IndexedSequence(term, index, lower, upper?)`; not evaluated.

### input

MathJSON `Input` · `(prompt: string?) console -> nothing | string`

Read one line of text from the host: the terminal in a command-line host, the `prompt()` dialog in a browser. The optional operand is a prompt string, displayed before reading. Evaluates to the line read, without the trailing newline; to `Nothing` at end-of-input (or a canceled dialog). On a host with no interactive input, stays unevaluated. When the host denies console access, evaluates to a `capability-denied` error.

### integerString

MathJSON `IntegerString` · `(integer, integer?) -> string`

`IntegerString(n, base=10)`       return a string representation of the integer `n` in base `base`.

### InvisibleOperator

`function`

Implicit operator used for juxtapositions such as function application or multiplication.

### isError

MathJSON `IsError` · `(any) -> boolean`

True if the expression is an `Error` value, or a frozen expression embedding one (`"a" + 1`). False otherwise. Total.

### isMissing

MathJSON `IsMissing` · `(any) -> boolean`

True if the value is ABSENT — the `Missing` or `Undefined` symbol, or a `NaN` number (regardless of provenance). R’s `is.na` (`TRUE` for both `NA` and `NaN`). There is no NaN-specific test operator (R’s `is.nan`).

### Latex

`(any+) -> string`

Serialize an expression to LaTeX

### LatexString

`(string) -> string`

Value preserving type conversion/tag indicating the string is a LaTeX string

### MatchesType

`(subject: any, type: string | type) -> boolean`

True iff the first operand, EVALUATED, is a value of the given type — the engine form of the Epsil `x is T` test and of `match` type patterns, which both lower here. The subject is never unwrapped: a type VALUE is a value like any other, so `MatchesType(TypeFrom("integer"), "number")` is `False` while `MatchesType(TypeFrom("integer"), "type")` is `True`; the type-to-type question is `Subtype`. A settled subject is decided both ways; a valueless or unresolved subject answers from its static type when that decides it, and stays symbolic otherwise.

### missing

MathJSON `Missing` · variable `missing`

A value that is absent but whose position is preserved (Julia `missing`, R `NA`); the sole member of the `missing` type.

### N

`(any, integer?) -> unknown`

N(expr): numerically evaluate an expression

N(expr, precision): evaluate to `precision` significant digits

### NamedArgument

`(string, any) -> nothing`

NamedArgument(name, value): one named argument of a call (Epsil

surface syntax: `f(rate: 0.05)`).

A parse-level carrier, like `Spread`, but one that never survives:

the enclosing call consumes it at canonicalization, permuting the

written arguments into the order its callee declares.

Reaching this definition therefore means the carrier was NOT

consumed — the callee supplied no parameter names to match — which

is the `argument-names-unavailable` error.

### nothing

MathJSON `Nothing` · variable `nothing`

The absence of a value; the sole member of the unit type.

### numberFrom

MathJSON `NumberFrom` · `(string, base: (integer | string)?) -> number`

NumberFrom(s): the number the string `s` denotes — optional surrounding whitespace, an optional sign, then ASCII digits with an optional "." fraction and an optional e/E exponent, or one of "oo", "+oo", "-oo", "NaN". The integer part may be omitted before a fraction (".5" is 0.5); a trailing "." with no fraction digits ("5.") is not accepted. Any other text, including "", is an error value (never NaN).

NumberFrom(s, base): the integer `s` denotes in `base` (2 to 36); only integer numerals are accepted.

### Object

`(any, string?) -> unknown`

Provenance head for the snapshot of a mutable object: `["Object", <record>, "'TypeName'"]`. The record holds the object's stored fields at the moment it was serialized; the second operand names the nominal type the object had. Not a constructor and not an ascription — it wraps data, it does not make an object.

### OverParen

`(any+) -> expression`

Over-paren accent (`\overparen{BC}`) — opaque typed head; not evaluated.

### padEnd

MathJSON `PadEnd` · `(string, n: integer, pad: string?) -> string`

PadEnd(s, n, pad=" "): `s` padded at the END to `n` characters by repeating `pad` (its final copy truncated on a character boundary). Returned unchanged when `s` already has `n` or more characters. `n` must be a non-negative integer; an empty `pad` is an error; a non-string `pad` leaves the expression unevaluated.

### padStart

MathJSON `PadStart` · `(string, n: integer, pad: string?) -> string`

PadStart(s, n, pad=" "): `s` padded at the START to `n` characters by repeating `pad` (its final copy truncated on a character boundary). Returned unchanged when `s` already has `n` or more characters. `n` must be a non-negative integer; an empty `pad` is an error; a non-string `pad` leaves the expression unevaluated.

### parallel

MathJSON `Parallel` · `(any, any) -> expression`

Parallelism relation (`AB \parallel CD`) — opaque typed head; not evaluated.

### parse

MathJSON `Parse` · `(string) -> any`

Parse a LaTeX string and evaluate to a corresponding expression

### perpendicular

MathJSON `Perpendicular` · `(any, any) -> expression`

Perpendicularity relation (`AB \perp CD`) — opaque typed head; not evaluated.

### Pipe

`(value, function) -> unknown`

Apply a function to a value: `Pipe(x, f)` evaluates to `f(x)`.

### polygon

MathJSON `Polygon` · `(any+) -> expression`

Polygon primitive — opaque typed head.

### prime

MathJSON `Prime` · `(T, integer?) -> T where T`

Derivative or prime notation (`f'`, `f^{(n)}`) — opaque typed head until a derivative library handler runs.

### print

MathJSON `Print` · `(any*) console -> nothing`

Print the operands to the host console, separated by spaces and followed by a newline. String operands print their content (without quotes); other expressions print their text form. Evaluates to `Nothing`. On a host without a console, prints nothing. When the host denies console access, evaluates to a `capability-denied` error.

### ProtocolMember

`(protocol: string, member: string, arguments: any*) -> unknown`

Invoke a protocol member on a value — the lowering of a QUALIFIED protocol call (`Comparable.compare(x, y)` in Epsil, whose parse, a `MemberCall` on the protocol name, canonicalizes to `Apply(Field(Comparable, "compare"), x, y)`). The first two operands name the protocol and the member; the rest are the call arguments. Dispatch is dynamic and restricted to the named protocol: the most specific conformance implementation for the runtime type of the first argument is invoked. Several equally specific implementations are `protocol-call-ambiguous`; none is `protocol-implementation-missing`; an argument whose type cannot decide the question leaves the call symbolic.

### ProtocolProperty

`(protocol: string, property: string, receiver: any, value: any?) -> unknown`

Read (or write) a protocol PROPERTY through a NAMED protocol — the lowering of the qualified field form `person.(Nameable.name)` (protocols design P6, amending the D16 field grammar). The first two operands name the protocol and the property; the third is the receiver. A fourth operand makes it a property STORE — the qualified write `person.(Nameable.name) = v` — which invokes the `set` accessor against the receiver, discards what it returns, and evaluates to the value assigned; a receiver that is not an object is `immutable-value-assignment`. Dispatch is dynamic and restricted to the named protocol: the most specific conformance implementation for the runtime type of the receiver is invoked.

### quadrilateral

MathJSON `Quadrilateral` · `(any+) -> expression`

Quadrilateral mark (`\square ABCD`) — opaque typed head; not evaluated.

### random

MathJSON `Random` · `((collection<any> | set<real>)?) random -> any`

Random(): non-deterministic real in [0, 1)

Random(Interval(a, b)): a real in [a, b) (endpoint markers ignored)

Random(Range(...)): an element of the range

Random(xs): an element of the finite collection `xs`

### randomChoice

MathJSON `RandomChoice` · `((T, number) random -> T where T: string) & ((collection<any> | set<real>, number) random -> list<any>)`

RandomChoice(domain, k): a list of k independent draws from `domain`, with replacement. `k` may exceed the size of the domain — that is what replacement means. Choosing from a string yields a string.

### randomExpression

MathJSON `RandomExpression` · `() entropy -> expression`

Generate a random expression.

### ReleaseHold

`(any) -> unknown`

Release an expression held by `Hold`

### replaceAll

MathJSON `ReplaceAll` · `(any, any+) -> any`

ReplaceAll(expr, rules): apply one or more replacement rules to `expr`,

then evaluate the result (Mathematica `expr /. rules`).

A rule is `lhs -> rhs` (parsed as `To`) or `Rule(lhs, rhs)`. Several

rules may be given as extra arguments or as a `List`/`Set` of rules;

they are applied simultaneously in a single pass.

### Rule

`(match: expression, replace: expression, predicate: function?) -> expression`

Pattern replacement rule.

### RuntimeError

`(expression<ErrorCode> | string) -> never`

Construct an error value when evaluated: the runtime counterpart of a written `Error(…)`, which is a static diagnostic node. Evaluates to `Error(code)`.

### segment

MathJSON `Segment` · `(any+) -> expression`

Segment primitive — opaque typed head.

### Sequence

`function`

Ordered sequence of expressions.

### Signature

`(symbol) -> nothing | string`

Return the signature string of an operator.

### simplify

MathJSON `Simplify` · `(any, any?) -> expression`

Simplify(expr): simplify an expression.

Simplify(expr, assumptions): simplify under one or more boolean

assumptions (e.g. `x > 0`), or a `List`/`And` of them. The assumptions

hold only for the duration of the simplification.

### solve

MathJSON `Solve` · `(any, any*) -> list`

Solve(equation, unknown): the list of solutions of an equation for the

unknown. The equation may be an `Equal` expression or a bare expression

(read as `= 0`), e.g. `Solve(x^2 - 1 == 0, x)` or `Solve(x^2 - 1, x)`.

The unknown may be omitted: it defaults to the equation's single free

variable, or to `x` when there are several and one of them is `x`.

Solve([eq1, eq2, …], [x, y, …]): solve a system of equations; each

solution is a tuple of values in the order of the variable list, e.g.

Solve([x + y == 3, x - y == 1], [x, y]) → [(2, 1)].

### sphere

MathJSON `Sphere` · `(any+) -> expression`

Sphere primitive — opaque typed head.

### Spread

`(any) -> unknown`

Spread(t): splice the elements of the tuple `t` into the enclosing

argument list (Epsil surface syntax: `f(...t)`).

A literal tuple splices at canonicalization; a symbolic argument is

spliced by the enclosing call at evaluation (step 0 of the evaluate

path), which re-validates the resulting arity.

### String

`(any*) -> string`

A string created by joining its arguments. The arguments are converted to their default string representation.

### stringCompare

MathJSON `StringCompare` · `(string, string) -> integer`

StringCompare(a, b): -1 when `a` sorts before `b`, 0 when they are equal, 1 when `a` sorts after `b`. The order compares Unicode scalar sequences code point by code point (NOT UTF-16 code units, which would sort astral characters below U+E000..U+FFFF).

### stringFrom

MathJSON `StringFrom` · `(any, format: string?) -> string`

StringFrom(value, format?): create a string from `value`. With no format, a number or a list of numbers is read as Unicode scalar values (`StringFrom(65)` is `"A"`), and any other value is printed (`StringFrom(True)` is `"True"`). The formats are `"default"` (print the value), `"unicode-scalars"`, `"utf-8"` and `"utf-16"`.

### stringJoin

MathJSON `StringJoin` · `(collection<character | string>, separator: string?) -> string`

StringJoin(xs): join the elements of the finite collection `xs` (strings or characters) into a string.

StringJoin(xs, sep): the same, with `sep` between consecutive elements. The inverse of StringSplit. An empty collection joins to "", a one-element collection to that element. A non-text element, or a non-finite collection, leaves the expression unevaluated. For variadic concatenation use Join(a, b, …) or string interpolation.

### stringRepeat

MathJSON `StringRepeat` · `(string, n: integer) -> string`

StringRepeat(s, n): `n` copies of the string `s`, concatenated. StringRepeat(s, 0) is "". A negative or non-integer `n` is an error.

### stringReplace

MathJSON `StringReplace` · `((string, string, string, count: integer?) -> string) & ((string, regexp, string, count: integer?) -> string) & ((string, regexp, function, count: integer?) -> string)`

StringReplace(s, target, replacement): replace every non-overlapping occurrence of `target` in `s`, scanning left to right over whole characters.

StringReplace(s, target, replacement, count): replace at most `count` occurrences, from the left. An empty `target` is an error (the "insert at every boundary" behavior is deliberately not inherited); an empty `replacement` means deletion. `count` must be a positive integer.

StringReplace(s, pattern, replacement, count?): `target` may be a regular expression, matched with the host dialect. `$1`-style templates are NOT expanded in `replacement`.

StringReplace(s, pattern, f, count?): `replacement` may be a function, called with the same match record StringMatch returns, so each replacement can be computed from its captures.

### stringSplit

MathJSON `StringSplit` · `((string, string?) -> list<string>) & ((string, regexp) -> list<string>)`

StringSplit(s): split a string on runs of whitespace (the Unicode White_Space code points), dropping empty parts.

StringSplit(s, sep): split a string on the separator string `sep` (empty parts are kept). An empty separator splits into user-perceived characters (grapheme clusters), like Characters. A non-string argument leaves the expression unevaluated.

StringSplit(s, pattern): split on each match of a regular expression, with the host dialect's own semantics — including splitting at a zero-width match. Captures are not interleaved into the result; use StringMatchAll for those.

### Subscript

`(collection<any>, any) -> any`

Subscript notation for indexing or compound symbols.

### Subtype

`(subtype: string | type, supertype: string | type) -> boolean`

True iff the FIRST operand is a subtype of the second — `Subtype("integer", "number")` is `True`, `Subtype("number", "integer")` is `False`. This is the same compatibility relation annotations and signatures use. Operands are type values or type text; a quantified (`where`) type is not comparable and errors.

### symbol

MathJSON `Symbol` · `function`

Construct a new symbol with a name formed by concatenating the arguments

### tail

MathJSON `Tail` · `(any) -> collection`

Return the tail of an expression, the operands of the expression

### Text

`(any*) -> string`

A sequence of strings, annotated expressions and other Text expressions

### timing

MathJSON `Timing` · `(value, repeat: integer?) -> tuple<time: number, result: value>`

`Timing(expr)` evaluates `expr` and returns a pair: the time the evaluation took, in microseconds, then the value. `Timing(expr, n)` evaluates `expr` n times (at least 3), drops the fastest and the slowest run, and returns the mean time of the others

### to

MathJSON `To` · `(any, any) -> nothing`

Action arrow / mapping (`a \to b`) — opaque typed head.

### toLowerCase

MathJSON `ToLowerCase` · `(string) -> string`

ToLowerCase(s): the string `s` mapped to lower case using the Unicode default (locale-independent) mappings.

### toUpperCase

MathJSON `ToUpperCase` · `(string) -> string`

ToUpperCase(s): the string `s` mapped to upper case using the Unicode default (locale-independent) mappings. The character count can change ("ß" uppercases to "SS").

### triangle

MathJSON `Triangle` · `(any+) -> expression`

Triangle primitive — opaque typed head.

### trim

MathJSON `Trim` · `(string, chars: (character | collection<character | string> | string)?) -> string`

Trim(s): remove leading and trailing whitespace (the Unicode White_Space characters).

Trim(s, chars): remove leading and trailing characters that belong to `chars` — a SET of characters, given as a character, a string (meaning the set of that string's characters) or a collection whose elements each contribute their own characters.

### trimEnd

MathJSON `TrimEnd` · `(string, chars: (character | collection<character | string> | string)?) -> string`

TrimEnd(s): remove trailing whitespace (the Unicode White_Space characters).

TrimEnd(s, chars): remove trailing characters that belong to `chars` — a SET of characters, as for Trim.

### trimStart

MathJSON `TrimStart` · `(string, chars: (character | collection<character | string> | string)?) -> string`

TrimStart(s): remove leading whitespace (the Unicode White_Space characters).

TrimStart(s, chars): remove leading characters that belong to `chars` — a SET of characters, as for Trim.

### type

MathJSON `Type` · `(any) -> type`

The STATIC type of an expression, as a type value: `Type(3)` is `TypeFrom("integer")`. The observer does not evaluate its operand. Recover the text with `StringFrom(Type(x))`; in a string interpolation a type value renders as its text directly. BREAKING (2026-08-19, ruling R3 of `docs/TYPE-SYSTEM.md`): the result used to be a STRING, and `Type(x) == "some text"` is now always `False` — use `x is T`, `Subtype(Type(x), u)`, or compare `StringFrom` text.

### typeFrom

MathJSON `TypeFrom` · `(text: string) -> type`

A type expression as a first-class value, constructed from its text: `TypeFrom("list<integer>")`. The value SETTLES at construction — the text is parsed, reduced, and stored back as its canonical form — so two values built from equivalent spellings (`"integer|real"`, `"real|integer"`) are the same value. `==` between two type values is mutual subtyping (it also equates an alias with its body); `==` between a type value and anything else, a string included, is `False`. Construction never touches the type registry: a forward reference (`type X`) or an unknown name is an error, not a registration.

### Typed

`(any, string | symbol) -> unknown`

Ascribe a type to an expression. The type is asserted for the type system (ascription, not a check); evaluation is transparent. Used to annotate `Function` literal parameters and return types.

### Unevaluated

`(any) -> unknown`

Prevent an expression from being evaluated

### unicodeScalars

MathJSON `UnicodeScalars` · `(string) -> list<integer>`

A collection of Unicode scalars from a string, same as UTF-32

### utf16

MathJSON `Utf16` · `(string) -> list<integer>`

A collection of UTF-16 code units from a string.

### utf8

MathJSON `Utf8` · `(string) -> list<integer>`

A collection of UTF-8 code units from a string.

### Wildcard

`(symbol) -> symbol`

Single-expression pattern wildcard.

### WildcardOptionalSequence

`(symbol) -> symbol`

Pattern wildcard matching zero or more expressions.

### WildcardSequence

`(symbol) -> symbol`

Pattern wildcard matching one or more expressions.

### withRandomSeed

MathJSON `WithRandomSeed` · `(real | string, any) -> expression`

WithRandomSeed(seed, body): evaluate `body` with a random seed frame

seeded by `seed` (a finite real or a string). The block replays

identically, while repeated draws WITHIN the frame differ (the n-th

draw is hash(seed, n)).

Scoping is dynamic: the frame is active through user-function calls,

not just lexically inside `body`. Frames nest and the innermost wins.

Counters are per-frame, so a nested frame does not perturb its

parent's subsequent draws.

Outside any frame, draws are live (non-deterministic).
