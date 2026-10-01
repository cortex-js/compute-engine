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

Each definition is listed under its Epsil spelling (the MathJSON name when
it has none), with its signature in the engine's type syntax. The
[Standard Library](/epsil/library/) page is the one-page index of every
category.

## Definitions

### about

MathJSON `About` · `(any) -> dictionary<any>`

Return information about an expression as a dictionary: its kind (symbol, constant, function, number, string, expression), its static type and, when applicable, its name, value, signature, clause listing, attributes (the algebraic flags and `lazy`), description, examples, keywords, wikidata and url.

```epsil
about(pi)
// ➔ {"name" -> "Pi", "kind" -> "constant", "type" -> "real<3.141592653589793..3.141592653589794>", "description" -> "The constant π ≈ 3.14159, the ratio of a circle's circumference to its diameter.", "examples" -> ["N(Pi)","Cos(Pi)"], "wikidata" -> "Q167"}
```

### angle

MathJSON `Angle` · `(any+) -> number`

Angle mark / measure (`\angle ABC`, `\varangle XYZ`, `∠ABC`) — opaque typed head; not evaluated.

```epsil
angle(A, B, C)
// ➔ Angle(A, B, C)
```

### Annotated

`(expression, dictionary<any>) -> expression`

Attach metadata or style annotations to an expression.

```epsil
Annotated(x^2, {"color" -> "blue"})
// ➔ x^2
```

### apply

MathJSON `Apply` · `(name: any, arguments: any*) -> unknown`

Apply a function to a list of arguments

```epsil
apply(sqrt, 16)
// ➔ 4
```

### applyWhole

MathJSON `ApplyWhole` · `(name: any, arguments: any*) -> unknown`

Apply a function to arguments, each bound whole (engine-internal).

### arc

MathJSON `Arc` · `(any+) -> number`

Arc / wide-hat accent measure (`\widehat{ABC}`) — opaque typed head; not evaluated.

```epsil
arc(A, B, C)
// ➔ Arc(A, B, C)
```

### Assign

`(expression | symbol, any) scope -> any`

Assign a value to a symbol or define a sequence. The RHS is evaluated immediately and `ce.assign(name, val)` mutates the binding in the current scope chain. When used inside a `Block`, the assignment is visible to subsequent statements in the block (sequential semantics).

```epsil
let x = 3
x = x + 1
x
```

### assume

MathJSON `Assume` · `(any) scope -> string`

Record an assumption about a symbol. Evaluates to the outcome as a string: "ok", "tautology", "contradiction", "not-a-predicate" or "internal-error".

```epsil
assume(x > 0)
```

### baseForm

MathJSON `BaseForm` · `(T, (number | string)?) -> T where T: number`

`BaseForm(expr, base=10)`

### BuiltinFunction

`(string | symbol) -> symbol`

Return a built-in function symbol by name.

```epsil
BuiltinFunction("Sqrt")(16)
// ➔ 4
```

### canonicalForm

MathJSON `CanonicalForm` · `(any, symbol*) -> any`

Return the canonical form of an expression

Can be used to sort arguments of an expression.

Sorting arguments of commutative functions is a weak form of canonicalization that can be useful in some cases, for example to accept "x+1" and "1+x" while rejecting "x+1" and "2x-x+1"

```epsil
canonicalForm(Hold(1 + x), "Order")
// ➔ Hold(x + 1)
```

### caseFold

MathJSON `CaseFold` · `(string) -> string`

CaseFold(s): a case-folded form of `s`, for case-insensitive comparison — `CaseFold(a) == CaseFold(b)` tests equality ignoring case. An approximation of Unicode full case folding.

```epsil
caseFold("Straße")
// ➔ "strasse"
```

```epsil
caseFold("Hello") == caseFold("HELLO")
// ➔ "True"
```

### characterFrom

MathJSON `CharacterFrom` · `(string) -> character`

CharacterFrom(s): the character `s` denotes. `s` must be exactly one user-perceived character (one grapheme cluster) after NFC normalization; an empty or multi-character string is an error.

```epsil
characterFrom("é")
// ➔ "é"
```

### characters

MathJSON `Characters` · `(string) -> list<character>`

Characters(s): split a string into a list of user-perceived characters (grapheme clusters). Synonym: GraphemeClusters. For stable integer decompositions see UnicodeScalars, Utf8 and Utf16. A non-string argument leaves the expression unevaluated.

```epsil
characters("héllo")
// ➔ ["h","é","l","l","o"]
```

### Coalesce

`(any+) -> unknown`

Return the first operand that is not ABSENT (`Missing`, `Undefined` or `NaN`), evaluated left-to-right. If every operand is absent, the last operand’s value is returned verbatim (still absent). `Indeterminate` is a value and is not absent.

```epsil
Coalesce(missing, NaN, 3, 4)
// ➔ 3
```

### Colon

`(any, any) -> expression`

Type annotation (`a : b`) — opaque typed head.

### conforms

MathJSON `Conforms` · `(subject: any, protocols: string+) -> boolean`

True iff the subject conforms to EVERY named protocol. A `type` VALUE subject asks whether that type conforms (the branch is unambiguous because the `type` primitive itself declares no conformances); any other subject is evaluated once and its precise type is asked. This is the lowering of the Epsil `x is Hashable & Comparable` test. A valueless or unresolved subject stays symbolic; an unknown protocol name is an error; an Error-valued subject answers `False` (the `error` type declares no conformances). Conformance is monotone but late-bound: the answer reflects the registry at the moment of evaluation.

```epsil
protocol Copyable {}
type string is Copyable
conforms("abc", "Copyable")
// ➔ "True"
```

### Declare

`(symbol, type: (string | symbol)?, value: any?, attributes: dictionary<any>?) scope -> any`

Declare a symbol in the current scope, optionally assigning a type and an initial value. An optional trailing attributes dictionary (with keys `type`, `value`, `constant` and `holdUntil`) can further describe the definition, e.g. to declare a constant. With a value, evaluates to that value; otherwise evaluates to `Nothing`.

```epsil
let x: integer = 5
x + 1
```

### DeclareConformance

`(target: string | symbol, protocols: any, whereClauseOrImplementation: any?, implementation: dictionary<any>?) scope -> nothing`

Declare that a type CONFORMS to one or more protocols — the lowering of the Epsil `type string is Hashable & Comparable` statement. The target rides as a type-expression string and must be named and ground (not a union, an anonymous structural type or a `type alias` name); the protocols ride as a `List` of names. An optional trailing dictionary carries the implementation block, member name -&gt; function literal (property handlers under the mangled keys `__get__x` / `__set__x`); it may only accompany a SINGLE protocol. A CONDITIONAL conformance carries, ahead of that block, the source text of its trailing `where` clause as a string: the target is then a head pattern naming the variables the clause binds (`list<T>` with `"where T is Comparable"`). Conformance is monotone — it can be added but never removed — and a re-declaration is a no-op. Evaluates to `Nothing`.

```epsil
protocol Copyable {}
type string is Copyable
"abc" is Copyable
// ➔ "True"
```

### DeclareProtocol

`(string | symbol, members: dictionary<any>?) scope -> nothing`

Declare a PROTOCOL: a set of function and property requirements a type may declare itself to satisfy. Protocols are engine-global (not lexically scoped) and are NOT types, so this is only valid at the top level of a program. The name is a symbol (or a string); the optional members ride as a dictionary of `member -> ["Pair", "function"|"readonly"|"readwrite", signature]`, with the signature as a type-expression string. A `function` member's first parameter must be typed `Self`, the substitution token standing for the conforming type. A protocol with no members is a SEMANTIC protocol (a marker). Evaluates to `Nothing`.

```epsil
protocol Area { function area(self: Self) -> number }
type square = tuple<side: number> is Area {
  function area(self: square) -> number { self.side^2 }
}
area(square(3))
```

### DeclareSumType

`(string | symbol, any*) scope -> nothing`

Declare a SUM TYPE: N nominal variants plus the transparent union that names them, in one statement — the lowering of the Epsil sugar `type node = lit(num: number) | plus(op1: node, op2: node)`. The name is a symbol (or a string); each variant is a `["Tuple", name, payload]` pair whose payload is a type string (`"nothing"` for a nullary variant). An optional attributes dictionary at operand 1 — ahead of the variants — carries `typeParams -> "T"` for a generic sum, whose parameters are distributed to each variant by usage. The sum name is forward-registered before the variants are declared, so a payload may name it bare. A variant name that already names a type, is reserved, or is a builtin is rejected and NOTHING is declared. Types are engine-global, so this is only valid at the top level of a program. Evaluates to `Nothing`.

```epsil
type shape = circle(r: number) | square(s: number)
match square(3) {
  circle(r) => pi * r^2
  square(s) => s^2
}
```

### DeclareType

`(string | symbol, type: string | symbol | type, attributes: dictionary<any>?) scope -> nothing`

Declare a type. Types are engine-global (not lexically scoped), so this is only valid at the top level of a program — inside a block or function body it is an error. The name is a symbol (or a string) and the type a string holding a type expression, e.g. `"tuple<x: integer, y: integer>"`. The type is nominal by default; an optional trailing attributes dictionary with `alias -> True` makes it a structural alias instead, and an additional `typeParams -> "T, U: number"` entry makes it a GENERIC alias whose uses must be applied (`Pair<integer>`). The declaration also mints a value constructor of the same name — `["point", 1, 2]`, an inert tagged value for a nominal type, a checked identity for an alias — except for a `record` body, which mints none. Evaluates to `Nothing`.

```epsil
type point = tuple<x: number, y: number>
point(1, 2)
```

### DefineFunction

`(symbol, function, dictionary<any>?) scope -> nothing`

Define one clause of a (possibly multi-clause) function: `DefineFunction(f, Function(body, params…))`. Unlike `Assign` — which replaces the binding wholesale — `DefineFunction` ACCUMULATES: a clause with the same parameter domain replaces the earlier clause in place, any other clause is appended, and calls dispatch to the most specific clause admitting the arguments.

```epsil
fact(0) = 1
fact(n) = n * fact(n - 1)
fact(5)
```

### Delimiter

`(any, string?) -> any`

Group expressions with explicit delimiters.

```epsil
Delimiter(1 + 2)
// ➔ 3
```

### digitsFrom

MathJSON `DigitsFrom` · `(string, (integer | string)?) -> integer`

Return an integer representation of the string `s` in base `base`.

```epsil
digitsFrom("ff", 16)
// ➔ 255
```

```epsil
digitsFrom("1010", 2)
// ➔ 10
```

### error

MathJSON `Error` · `(expression<ErrorCode> | string, expression?) -> nothing`

Represent an error expression.

```epsil
[1, RuntimeError("zero")]
// ➔ [1,Error("zero")]
```

### ErrorCode

`(string, any*) -> error`

Structured error code with optional arguments.

```epsil
[1, RuntimeError(ErrorCode("out-of-range", 5))]
// ➔ [1,Error(ErrorCode("out-of-range", 5))]
```

### evaluate

MathJSON `Evaluate` · `(any) -> unknown`

Evaluate an expression.

```epsil
evaluate(x + x)
// ➔ 2x
```

### evaluateAt

MathJSON `EvaluateAt` · `(function, lower: expression, upper: expression) -> unknown`

Evaluate a function at one point or between two bounds.

```epsil
evaluateAt(x => x^2, 1, 3)
// ➔ 8
```

### findRoot

MathJSON `FindRoot` · `(any, any) -> dictionary`

FindRoot(equations, params): numerically find parameter values that

zero the residuals. `equations` is an equation (`lhs == rhs`), a bare

residual expression (read as `= 0`), or a list of either. `params` is

a list of specs (a bare symbol, `(a, a0)`, or `(a, a0, lo, hi)` with

box constraints), matching `FindFit`. Returns a record

&#123;parameters, converged, residualNorm, iterations&#125;.

```epsil
findRoot(x^2 - 2, [(x, 1)])
// ➔ {"parameters" -> {"x" -> 1.4142135624638652}, "converged" -> "True", "residualNorm" -> 2.567368539985182e-10, "iterations" -> 4}
```

### Function

`(expression, (function | symbol)*) -> function`

A function literal

```epsil
(x => x^2 + 1)(3)
// ➔ 10
```

### geometricVector

MathJSON `GeometricVector` · `(any, any) -> expression`

Geometric vector (directed segment between two points) — opaque typed head. Distinct from the column-vector `Vector` operator.

```epsil
geometricVector(A, B)
// ➔ GeometricVector(A, B)
```

### graphemeClusters

MathJSON `GraphemeClusters` · `(string) -> list<character>`

A collection of grapheme clusters from a string. Synonym of Characters.

```epsil
graphemeClusters("héllo")
// ➔ ["h","é","l","l","o"]
```

### head

MathJSON `Head` · `(any) -> symbol`

Return the head of an expression, the name of the operator

```epsil
head(x^2)
// ➔ "Power"
```

### Hold

`(any) -> unknown`

Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it

```epsil
Hold(1 + 2)
// ➔ Hold(1 + 2)
```

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

```epsil
let x = 5
let y = 2
(x + y, HoldValues(x + y), HoldValues(x + y, [y]))
```

### HorizontalSpacing

`(number) -> nothing`

Horizontal spacing annotation.

### identity

MathJSON `Identity` · `(T) -> T where T`

Return the argument unchanged

```epsil
identity(x + 1)
// ➔ x + 1
```

### IndexedSequence

`(any, symbol, any, any?) -> expression`

Indexed sequence `\{a_n\}_{n=1}^{\infty}` — inert head `IndexedSequence(term, index, lower, upper?)`; not evaluated.

```epsil
IndexedSequence(1/n, n, 1, oo)
// ➔ {1 / n : n = 1..+oo}
```

### input

MathJSON `Input` · `(prompt: string?) console -> nothing | string`

Read one line of text from the host: the terminal in a command-line host, the `prompt()` dialog in a browser. The optional operand is a prompt string, displayed before reading. Evaluates to the line read, without the trailing newline; to `Nothing` at end-of-input (or a canceled dialog). On a host with no interactive input, stays unevaluated. When the host denies console access, evaluates to a `capability-denied` error.

### integerString

MathJSON `IntegerString` · `(integer, integer?) -> string`

`IntegerString(n, base=10)`       return a string representation of the integer `n` in base `base`.

```epsil
integerString(255, 16)
// ➔ "ff"
```

```epsil
integerString(10, 2)
// ➔ "1010"
```

### InvisibleOperator

`function`

Implicit operator used for juxtapositions such as function application or multiplication.

```epsil
InvisibleOperator(2, x)
// ➔ 2x
```

### isError

MathJSON `IsError` · `(any) -> boolean`

True if the expression is an `Error` value, or a frozen expression embedding one (`"a" + 1`). False otherwise. Total.

```epsil
isError(ln("a"))
// ➔ "True"
```

```epsil
isError(1 + 1)
// ➔ "False"
```

### isMissing

MathJSON `IsMissing` · `(any) -> boolean`

True if the value is ABSENT — the `Missing` or `Undefined` symbol, or a `NaN` number (regardless of provenance). R’s `is.na` (`TRUE` for both `NA` and `NaN`). There is no NaN-specific test operator (R’s `is.nan`). `Indeterminate`, the exact answer to an indeterminate form such as `0/0`, is a value and is not absent.

```epsil
[isMissing(missing), isMissing(NaN), isMissing(0)]
// ➔ ["True","True","False"]
```

### Latex

`(any+) -> string`

Serialize an expression to LaTeX

```epsil
Latex(sqrt(x) / 2)
// ➔ "\frac{\sqrt{x}}{2}"
```

### LatexString

`(string) -> string`

Value preserving type conversion/tag indicating the string is a LaTeX string

```epsil
parse(LatexString(#"\frac{1}{2}"#))
// ➔ 1/2
```

### MatchesType

`(subject: any, type: string | type) -> boolean`

True iff the first operand, EVALUATED, is a value of the given type — the engine form of the Epsil `x is T` test and of `match` type patterns, which both lower here. The subject is never unwrapped: a type VALUE is a value like any other, so `MatchesType(TypeFrom("integer"), "number")` is `False` while `MatchesType(TypeFrom("integer"), "type")` is `True`; the type-to-type question is `Subtype`. A settled subject is decided both ways; a valueless or unresolved subject answers from its static type when that decides it, and stays symbolic otherwise.

```epsil
MatchesType([1, 2], "list<integer>")
// ➔ "True"
```

### missing

MathJSON `Missing` · variable `missing`

A value that is absent but whose position is preserved (Julia `missing`, R `NA`); the sole member of the `missing` type.

```epsil
missing + 1
// ➔ NaN
```

### N

`(any, integer?) -> unknown`

N(expr): numerically evaluate an expression

N(expr, precision): evaluate to `precision` significant digits

```epsil
N(pi)
// ➔ 3.14159265358979323846
```

```epsil
N(1/3, 4)
// ➔ 0.3333
```

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

```epsil
((x, y) => x - y)(y: 2, x: 10)
// ➔ 8
```

### nothing

MathJSON `Nothing` · variable `nothing`

The absence of a value; the sole member of the unit type.

```epsil
[1, nothing, 2]
// ➔ [1,2]
```

### numberFrom

MathJSON `NumberFrom` · `(string, base: (integer | string)?) -> number`

NumberFrom(s): the number the string `s` denotes — optional surrounding whitespace, an optional sign, then ASCII digits with an optional "." fraction and an optional e/E exponent, or one of "oo", "+oo", "-oo", "NaN", "Indeterminate". The integer part may be omitted before a fraction (".5" is 0.5); a trailing "." with no fraction digits ("5.") is not accepted. Any other text, including "", is an error value (never NaN).

NumberFrom(s, base): the integer `s` denotes in `base` (2 to 36); only integer numerals are accepted.

```epsil
numberFrom("3.25")
// ➔ 3.25
```

```epsil
numberFrom("ff", 16)
// ➔ 255
```

### Object

`(any, string?) -> unknown`

Provenance head for the snapshot of a mutable object: `["Object", <record>, "'TypeName'"]`. The record holds the object's stored fields at the moment it was serialized; the second operand names the nominal type the object had. Not a constructor and not an ascription — it wraps data, it does not make an object.

### OverParen

`(any+) -> expression`

Over-paren accent (`\overparen{BC}`) — opaque typed head; not evaluated.

```epsil
OverParen(B, C)
// ➔ OverParen(B, C)
```

### padEnd

MathJSON `PadEnd` · `(string, n: integer, pad: string?) -> string`

PadEnd(s, n, pad=" "): `s` padded at the END to `n` characters by repeating `pad` (its final copy truncated on a character boundary). Returned unchanged when `s` already has `n` or more characters. `n` must be a non-negative integer; an empty `pad` is an error; a non-string `pad` leaves the expression unevaluated.

```epsil
padEnd("abc", 6, ".")
// ➔ "abc..."
```

### padStart

MathJSON `PadStart` · `(string, n: integer, pad: string?) -> string`

PadStart(s, n, pad=" "): `s` padded at the START to `n` characters by repeating `pad` (its final copy truncated on a character boundary). Returned unchanged when `s` already has `n` or more characters. `n` must be a non-negative integer; an empty `pad` is an error; a non-string `pad` leaves the expression unevaluated.

```epsil
padStart("42", 5, "0")
// ➔ "00042"
```

### parallel

MathJSON `Parallel` · `(any, any) -> expression`

Parallelism relation (`AB \parallel CD`) — opaque typed head; not evaluated.

```epsil
parallel(l, m)
// ➔ Parallel(l, m)
```

### parse

MathJSON `Parse` · `(string) -> any`

Parse a LaTeX string and evaluate to a corresponding expression

```epsil
parse(#"\frac{\pi}{2}"#)
// ➔ 1/2 * pi
```

### perpendicular

MathJSON `Perpendicular` · `(any, any) -> expression`

Perpendicularity relation (`AB \perp CD`) — opaque typed head; not evaluated.

```epsil
perpendicular(l, m)
// ➔ Perpendicular(l, m)
```

### Pipe

`(value, function) -> unknown`

Apply a function to a value: `Pipe(x, f)` evaluates to `f(x)`.

```epsil
Pipe([3, 1, 2], sort)
// ➔ [1,2,3]
```

```epsil
16 |> sqrt
// ➔ 4
```

### polygon

MathJSON `Polygon` · `(any+) -> expression`

Polygon primitive — opaque typed head.

```epsil
polygon(A, B, C, D)
// ➔ Polygon(A, B, C, D)
```

### prime

MathJSON `Prime` · `(T, integer?) -> T where T`

Derivative or prime notation (`f'`, `f^{(n)}`) — opaque typed head until a derivative library handler runs.

```epsil
prime(f)
// ➔ Prime(f)
```

### print

MathJSON `Print` · `(any*) console -> nothing`

Print the operands to the host console, separated by spaces and followed by a newline. String operands print their content (without quotes); other expressions print their text form. Evaluates to `Nothing`. On a host without a console, prints nothing. When the host denies console access, evaluates to a `capability-denied` error.

```epsil
print("Hello", 42)
```

### ProtocolMember

`(protocol: string, member: string, arguments: any*) -> unknown`

Invoke a protocol member on a value — the lowering of a QUALIFIED protocol call (`Comparable.compare(x, y)` in Epsil, whose parse, a `MemberCall` on the protocol name, canonicalizes to `Apply(Field(Comparable, "compare"), x, y)`). The first two operands name the protocol and the member; the rest are the call arguments. Dispatch is dynamic and restricted to the named protocol: the most specific conformance implementation for the runtime type of the first argument is invoked. Several equally specific implementations are `protocol-call-ambiguous`; none is `protocol-implementation-missing`; an argument whose type cannot decide the question leaves the call symbolic.

```epsil
protocol Negatable { function negated(self: Self) -> Self }
type number is Negatable { function negated(self) -> number { -self } }
Negatable.negated(5)
// ➔ -5
```

### ProtocolProperty

`(protocol: string, property: string, receiver: any, value: any?) -> unknown`

Read (or write) a protocol PROPERTY through a NAMED protocol — the lowering of the qualified field form `person.(Nameable.name)` (protocols design P6, amending the D16 field grammar). The first two operands name the protocol and the property; the third is the receiver. A fourth operand makes it a property STORE — the qualified write `person.(Nameable.name) = v` — which invokes the `set` accessor against the receiver, discards what it returns, and evaluates to the value assigned; a receiver that is not an object is `immutable-value-assignment`. Dispatch is dynamic and restricted to the named protocol: the most specific conformance implementation for the runtime type of the receiver is invoked.

```epsil
protocol Signed { readonly sign: string }
type number is Signed {
  get sign(self) -> string { if (self < 0) { "-" } else { "+" } }
}
let x = -12
x.(Signed.sign)
```

### quadrilateral

MathJSON `Quadrilateral` · `(any+) -> expression`

Quadrilateral mark (`\square ABCD`) — opaque typed head; not evaluated.

```epsil
quadrilateral(A, B, C, D)
// ➔ Quadrilateral(A, B, C, D)
```

### random

MathJSON `Random` · `((collection<any> | set<real>)?) random -> any`

Random(): non-deterministic real in [0, 1)

Random(Interval(a, b)): a real in [a, b) (endpoint markers ignored)

Random(Range(...)): an element of the range

Random(xs): an element of the finite collection `xs`

```epsil
random()
```

```epsil
random(1..6)
```

### randomChoice

MathJSON `RandomChoice` · `((T, number) random -> T where T: string) & ((collection<any> | set<real>, number) random -> list<any>)`

RandomChoice(domain, k): a list of k independent draws from `domain`, with replacement. `k` may exceed the size of the domain — that is what replacement means. Choosing from a string yields a string.

```epsil
randomChoice(["a", "b", "c"], 5)
```

### randomExpression

MathJSON `RandomExpression` · `() entropy -> expression`

Generate a random expression.

```epsil
randomExpression()
```

### ReleaseHold

`(any) -> unknown`

Release an expression held by `Hold`

```epsil
ReleaseHold(Hold(1 + 2))
// ➔ 3
```

### replaceAll

MathJSON `ReplaceAll` · `(any, any+) -> any`

ReplaceAll(expr, rules): apply one or more replacement rules to `expr`,

then evaluate the result (Mathematica `expr /. rules`).

A rule is `Rule(lhs, rhs)`, or `lhs -> rhs` in LaTeX (parsed as `To`;

in Epsil `->` builds a dictionary entry, which is not a rule). Several

rules may be given as extra arguments or as a `List`/`Set` of rules;

they are applied simultaneously in a single pass.

```epsil
replaceAll(x^2 + x, Rule(x, 3))
// ➔ 12
```

### Rule

`(match: expression, replace: expression, predicate: function?) -> expression`

Pattern replacement rule.

```epsil
replaceAll(x + y, Rule(x, 2))
// ➔ y + 2
```

### RuntimeError

`(expression<ErrorCode> | string) -> never`

Construct an error value when evaluated: the runtime counterpart of a written `Error(…)`, which is a static diagnostic node. Evaluates to `Error(code)`.

```epsil
isError(RuntimeError("oops"))
// ➔ "True"
```

### segment

MathJSON `Segment` · `(any+) -> expression`

Segment primitive — opaque typed head.

```epsil
segment(A, B)
// ➔ Segment(A, B)
```

### Sequence

`function`

Ordered sequence of expressions.

```epsil
[0, Sequence(1, 2), 3]
// ➔ [0,1,2,3]
```

### Signature

`(symbol) -> nothing | string`

Return the signature string of an operator.

```epsil
Signature(stringRepeat)
// ➔ "(string, n: integer) -> string"
```

### simplify

MathJSON `Simplify` · `(any, any?) -> expression`

Simplify(expr): simplify an expression.

Simplify(expr, assumptions): simplify under one or more boolean

assumptions (e.g. `x > 0`), or a `List`/`And` of them. The assumptions

hold only for the duration of the simplification.

```epsil
simplify(sin(x)^2 + cos(x)^2)
// ➔ 1
```

```epsil
simplify(sqrt(x^2), x > 0)
// ➔ x
```

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

```epsil
solve(x^2 - 1 == 0, x)
// ➔ [1,-1]
```

```epsil
solve([x + y == 3, x - y == 1], [x, y])
// ➔ [(2, 1)]
```

### sphere

MathJSON `Sphere` · `(any+) -> expression`

Sphere primitive — opaque typed head.

```epsil
sphere(O, r)
// ➔ Sphere(O, r)
```

### Spread

`(any) -> unknown`

Spread(t): splice the elements of the tuple `t` into the enclosing

argument list (Epsil surface syntax: `f(...t)`).

A literal tuple splices at canonicalization; a symbolic argument is

spliced by the enclosing call at evaluation (step 0 of the evaluate

path), which re-validates the resulting arity.

```epsil
max(...(4, 9, 2))
// ➔ 9
```

### String

`(any*) -> string`

A string created by joining its arguments. The arguments are converted to their default string representation.

```epsil
String("x", 2)
// ➔ "x2"
```

### stringCompare

MathJSON `StringCompare` · `(string, string) -> integer`

StringCompare(a, b): -1 when `a` sorts before `b`, 0 when they are equal, 1 when `a` sorts after `b`. The order compares Unicode scalar sequences code point by code point (NOT UTF-16 code units, which would sort astral characters below U+E000..U+FFFF).

```epsil
stringCompare("apple", "banana")
// ➔ -1
```

### stringFrom

MathJSON `StringFrom` · `(any, format: string?) -> string`

StringFrom(value, format?): create a string from `value`. With no format, a number or a list of numbers is read as Unicode scalar values (`StringFrom(65)` is `"A"`), and any other value is printed (`StringFrom(True)` is `"True"`). The formats are `"default"` (print the value), `"unicode-scalars"`, `"utf-8"` and `"utf-16"`.

```epsil
stringFrom(65)
// ➔ "A"
```

```epsil
stringFrom([72, 105])
// ➔ "Hi"
```

### stringJoin

MathJSON `StringJoin` · `(collection<character | string>, separator: string?) -> string`

StringJoin(xs): join the elements of the finite collection `xs` (strings or characters) into a string.

StringJoin(xs, sep): the same, with `sep` between consecutive elements. The inverse of StringSplit. An empty collection joins to "", a one-element collection to that element. A non-text element, or a non-finite collection, leaves the expression unevaluated. For variadic concatenation use Join(a, b, …) or string interpolation.

```epsil
stringJoin(["a", "b", "c"], "-")
// ➔ "a-b-c"
```

### stringRepeat

MathJSON `StringRepeat` · `(string, n: integer) -> string`

StringRepeat(s, n): `n` copies of the string `s`, concatenated. StringRepeat(s, 0) is "". A negative or non-integer `n` is an error.

```epsil
stringRepeat("ab", 3)
// ➔ "ababab"
```

### stringReplace

MathJSON `StringReplace` · `((string, string, string, count: integer?) -> string) & ((string, regexp, string, count: integer?) -> string) & ((string, regexp, function, count: integer?) -> string)`

StringReplace(s, target, replacement): replace every non-overlapping occurrence of `target` in `s`, scanning left to right over whole characters.

StringReplace(s, target, replacement, count): replace at most `count` occurrences, from the left. An empty `target` is an error (the "insert at every boundary" behavior is deliberately not inherited); an empty `replacement` means deletion. `count` must be a positive integer.

StringReplace(s, pattern, replacement, count?): `target` may be a regular expression, matched with the host dialect. `$1`-style templates are NOT expanded in `replacement`.

StringReplace(s, pattern, f, count?): `replacement` may be a function, called with the same match record StringMatch returns, so each replacement can be computed from its captures.

```epsil
stringReplace("banana", "a", "o")
// ➔ "bonono"
```

```epsil
stringReplace("banana", "a", "o", 1)
// ➔ "bonana"
```

### stringSplit

MathJSON `StringSplit` · `((string, string?) -> list<string>) & ((string, regexp) -> list<string>)`

StringSplit(s): split a string on runs of whitespace (the Unicode White_Space code points), dropping empty parts.

StringSplit(s, sep): split a string on the separator string `sep` (empty parts are kept). An empty separator splits into user-perceived characters (grapheme clusters), like Characters. A non-string argument leaves the expression unevaluated.

StringSplit(s, pattern): split on each match of a regular expression, with the host dialect's own semantics — including splitting at a zero-width match. Captures are not interleaved into the result; use StringMatchAll for those.

```epsil
stringSplit("a,b,c", ",")
// ➔ ["a","b","c"]
```

```epsil
stringSplit("  one two  three ")
// ➔ ["one","two","three"]
```

### Subscript

`(collection<any>, any) -> any`

Subscript notation for indexing or compound symbols.

```epsil
Subscript([10, 20, 30], 2)
// ➔ 20
```

### Subtype

`(subtype: string | type, supertype: string | type) -> boolean`

True iff the FIRST operand is a subtype of the second — `Subtype("integer", "number")` is `True`, `Subtype("number", "integer")` is `False`. This is the same compatibility relation annotations and signatures use. Operands are type values or type text; a quantified (`where`) type is not comparable and errors.

```epsil
Subtype("integer", "number")
// ➔ "True"
```

### symbol

MathJSON `Symbol` · `function`

Construct a new symbol with a name formed by concatenating the arguments

```epsil
symbol("x", 2)
// ➔ "x2"
```

### tail

MathJSON `Tail` · `(any) -> collection`

Return the tail of an expression, the operands of the expression

```epsil
[tail(max(a, b, c))]
// ➔ [a,b,c]
```

### Text

`(any*) -> string`

A sequence of strings, annotated expressions and other Text expressions

```epsil
Text("Total: ", 42)
// ➔ "Total: 42"
```

### timing

MathJSON `Timing` · `(value, repeat: integer?) -> tuple<number, value>`

`Timing(expr)` evaluates `expr` and returns a pair: the time the evaluation took, in microseconds, then the value; read them as `Timing(expr)[1]` and `Timing(expr)[2]`. `Timing(expr, n)` evaluates `expr` n times (at least 3), drops the fastest and the slowest run, and returns the mean time of the others

```epsil
timing(2 + 2)[2]
// ➔ 4
```

### to

MathJSON `To` · `(any, any) -> nothing`

Action arrow / mapping (`a \to b`) — opaque typed head.

```epsil
replaceAll(x^2 + x, to(x, 3))
// ➔ 12
```

### toLowerCase

MathJSON `ToLowerCase` · `(string) -> string`

ToLowerCase(s): the string `s` mapped to lower case using the Unicode default (locale-independent) mappings.

```epsil
toLowerCase("Hello World")
// ➔ "hello world"
```

### toUpperCase

MathJSON `ToUpperCase` · `(string) -> string`

ToUpperCase(s): the string `s` mapped to upper case using the Unicode default (locale-independent) mappings. The character count can change ("ß" uppercases to "SS").

```epsil
toUpperCase("straße")
// ➔ "STRASSE"
```

### triangle

MathJSON `Triangle` · `(any+) -> expression`

Triangle primitive — opaque typed head.

```epsil
triangle(A, B, C)
// ➔ Triangle(A, B, C)
```

### trim

MathJSON `Trim` · `(string, chars: (character | collection<character | string> | string)?) -> string`

Trim(s): remove leading and trailing whitespace (the Unicode White_Space characters).

Trim(s, chars): remove leading and trailing characters that belong to `chars` — a SET of characters, given as a character, a string (meaning the set of that string's characters) or a collection whose elements each contribute their own characters.

```epsil
trim("  hi  ")
// ➔ "hi"
```

```epsil
trim("--hi--", "-")
// ➔ "hi"
```

### trimEnd

MathJSON `TrimEnd` · `(string, chars: (character | collection<character | string> | string)?) -> string`

TrimEnd(s): remove trailing whitespace (the Unicode White_Space characters).

TrimEnd(s, chars): remove trailing characters that belong to `chars` — a SET of characters, as for Trim.

```epsil
trimEnd("hi!!", "!")
// ➔ "hi"
```

### trimStart

MathJSON `TrimStart` · `(string, chars: (character | collection<character | string> | string)?) -> string`

TrimStart(s): remove leading whitespace (the Unicode White_Space characters).

TrimStart(s, chars): remove leading characters that belong to `chars` — a SET of characters, as for Trim.

```epsil
trimStart("007", "0")
// ➔ "7"
```

### type

MathJSON `Type` · `(any) -> type`

The STATIC type of an expression, as a type value: `Type(3)` is `TypeFrom("integer")`. The observer does not evaluate its operand. Recover the text with `StringFrom(Type(x))`; in a string interpolation a type value renders as its text directly. BREAKING (2026-08-19, ruling R3 of `docs/TYPE-SYSTEM.md`): the result used to be a STRING, and `Type(x) == "some text"` is now always `False` — use `x is T`, `Subtype(Type(x), u)`, or compare `StringFrom` text.

```epsil
type("hi")
// ➔ TypeFrom("string")
```

```epsil
type([1, 2, 3])
// ➔ TypeFrom("vector<integer^3>")
```

### typeFrom

MathJSON `TypeFrom` · `(text: string) -> type`

A type expression as a first-class value, constructed from its text: `TypeFrom("list<integer>")`. The value SETTLES at construction — the text is parsed, reduced, and stored back as its canonical form — so two values built from equivalent spellings (`"integer|real"`, `"real|integer"`) are the same value. `==` between two type values is mutual subtyping (it also equates an alias with its body); `==` between a type value and anything else, a string included, is `False`. Construction never touches the type registry: a forward reference (`type X`) or an unknown name is an error, not a registration.

```epsil
TypeFrom("integer | real") == TypeFrom("real")
// ➔ "True"
```

### Typed

`(any, string | symbol) -> unknown`

Ascribe a type to an expression. The type is asserted for the type system (ascription, not a check); evaluation is transparent. Used to annotate `Function` literal parameters and return types.

```epsil
Typed(2 + 3, "integer")
// ➔ 5
```

### Unevaluated

`(any) -> unknown`

Prevent an expression from being evaluated

### unicodeScalars

MathJSON `UnicodeScalars` · `(string) -> list<integer>`

A collection of Unicode scalars from a string, same as UTF-32

```epsil
unicodeScalars("A😀")
// ➔ [65,128512]
```

### utf16

MathJSON `Utf16` · `(string) -> list<integer>`

A collection of UTF-16 code units from a string.

```epsil
utf16("A😀")
// ➔ [65,55357,56832]
```

### utf8

MathJSON `Utf8` · `(string) -> list<integer>`

A collection of UTF-8 code units from a string.

```epsil
utf8("A€")
// ➔ [65,226,130,172]
```

### Wildcard

`(symbol) -> symbol`

Single-expression pattern wildcard.

```epsil
Wildcard(x)
// ➔ _x
```

### WildcardOptionalSequence

`(symbol) -> symbol`

Pattern wildcard matching zero or more expressions.

```epsil
WildcardOptionalSequence(x)
// ➔ ___x
```

### WildcardSequence

`(symbol) -> symbol`

Pattern wildcard matching one or more expressions.

```epsil
WildcardSequence(x)
// ➔ __x
```

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

```epsil
withRandomSeed(42, [random(1..6), random(1..6), random(1..6)])
// ➔ [5,3,5]
```
