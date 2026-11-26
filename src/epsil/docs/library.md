---
title: Epsil Standard Library
sidebar_label: Standard Library
slug: /epsil/library/
description: "Every function and constant of the Epsil standard library, by category, with signatures and summaries, linked to the per-category reference pages."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. Source: the library definitions
# (src/compute-engine/library/) as `epsil doc` describes them; regenerate
# with `npm run doc` (scripts/build-library-docs.ts).
---
# Epsil Standard Library

The 750 functions and constants of the standard library, by category.
Each row gives a name, its signature (for a function) or its kind and type
(for a constant or variable), and the first sentence of its description —
the same description `epsil doc <name>` prints in full and the editor
shows as a hover. The full description and the executed examples of every
definition are on the category's reference page, linked from each heading.

To search the library by concept rather than by name, use
`epsil doc <keywords>` (see the [CLI](/epsil/cli/)); the
[guide for agents](/epsil/for-agents/) lists the names most often needed.

- [Core](#core) — 122 definitions · [full reference](/epsil/reference/core/)
- [Control structures](#control-structures) — 16 definitions · [full reference](/epsil/reference/control-structures/)
- [Logic](#logic) — 27 definitions · [full reference](/epsil/reference/logic/)
- [Collections](#collections) — 127 definitions · [full reference](/epsil/reference/collections/)
- [Colors](#colors) — 20 definitions · [full reference](/epsil/reference/colors/)
- [Regular expressions](#regular-expressions) — 4 definitions · [full reference](/epsil/reference/regexp/)
- [Relations](#relations) — 30 definitions · [full reference](/epsil/reference/relop/)
- [Arithmetic](#arithmetic) — 104 definitions · [full reference](/epsil/reference/arithmetic/)
- [Fractals](#fractals) — 2 definitions · [full reference](/epsil/reference/fractals/)
- [Trigonometry](#trigonometry) — 42 definitions · [full reference](/epsil/reference/trigonometry/)
- [Calculus](#calculus) — 24 definitions · [full reference](/epsil/reference/calculus/)
- [Polynomials](#polynomials) — 19 definitions · [full reference](/epsil/reference/polynomials/)
- [Combinatorics](#combinatorics) — 12 definitions · [full reference](/epsil/reference/combinatorics/)
- [Number theory](#number-theory) — 70 definitions · [full reference](/epsil/reference/number-theory/)
- [Special functions](#special-functions) — 24 definitions · [full reference](/epsil/reference/special-functions/)
- [Linear algebra](#linear-algebra) — 46 definitions · [full reference](/epsil/reference/linear-algebra/)
- [Statistics](#statistics) — 43 definitions · [full reference](/epsil/reference/statistics/)
- [Units](#units) — 7 definitions · [full reference](/epsil/reference/units/)
- [Physics](#physics) — 11 definitions · [full reference](/epsil/reference/physics/)

## Core

The [Core reference](/epsil/reference/core/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `about` | `About` | `(any) -> dictionary<any>` | Return information about an expression as a dictionary: its kind (symbol, constant, function, number, string, expression), its static type and, when applicable, its name, value, signature, clause listing, attributes (the algebraic flags… |
| `angle` | `Angle` | `(any+) -> number` | Angle mark / measure (`\angle ABC`, `\varangle XYZ`, `∠ABC`) — opaque typed head; not evaluated. |
| — | `Annotated` | `(expression, dictionary<any>) -> expression` | Attach metadata or style annotations to an expression. |
| `apply` | `Apply` | `(name: any, arguments: any*) -> unknown` | Apply a function to a list of arguments |
| `applyWhole` | `ApplyWhole` | `(name: any, arguments: any*) -> unknown` | Apply a function to arguments, each bound whole (engine-internal). |
| `arbitraryConstant` | `ArbitraryConstant` | `(integer) -> number` | ArbitraryConstant(k): an arbitrary number, the k-th of a result: a constant of integration, the free parameter of an identity. |
| `arbitraryInteger` | `ArbitraryInteger` | `(integer) -> integer` | ArbitraryInteger(k): an arbitrary integer, the k-th of a result: the parameter of a family of roots, of a diophantine or a congruence solution. |
| `arc` | `Arc` | `(any+) -> number` | Arc / wide-hat accent measure (`\widehat{ABC}`) — opaque typed head; not evaluated. |
| — | `AssertPresent` | `(any) -> unknown` | Assert that a value is present: return it unchanged, or an `expected-present` error when it is ABSENT (`missing`, `NaN`, or a point whose coordinates are all `NaN`). |
| — | `Assign` | `(expression \| symbol, any) scope -> any` | Assign a value to a symbol or define a sequence. |
| `assume` | `Assume` | `(any) scope -> string` | Record an assumption about a symbol. |
| `baseForm` | `BaseForm` | `(x: T, base: (number \| string)?) -> T where T: number` | BaseForm(x, base): the number `x` unchanged, marked to be written in `base` (10 by default). |
| — | `Block` | `(unknown*) -> unknown` | Evaluate a sequence of expressions in a local scope, **sequentially**. |
| — | `BuiltinFunction` | `(string \| symbol) -> symbol` | Return a built-in function symbol by name. |
| `canonicalForm` | `CanonicalForm` | `(any, symbol*) -> any` | Return the canonical form of an expression. |
| `caseFold` | `CaseFold` | `(character \| string) -> string` | CaseFold(s): a case-folded form of `s`, for case-insensitive comparison — `caseFold(a) == caseFold(b)` tests equality ignoring case. |
| `characterFrom` | `CharacterFrom` | `(character \| string) -> character` | CharacterFrom(s): the character `s` denotes. |
| `characters` | `Characters` | `(character \| string) -> list<character>` | Characters(s): split a string into a list of user-perceived characters (grapheme clusters). |
| — | `Coalesce` | `(any+) -> unknown` | Return the first operand that is not ABSENT (`missing`, `NaN`, or a point whose coordinates are all `NaN`), evaluated left-to-right. |
| — | `Colon` | `(any, any) -> expression` | Type annotation (`a : b`) — opaque typed head. |
| `composition` | `Composition` | `(function*) -> function` | The composition of functions, applied right to left: `composition(f, g, h)(x)` is `f(g(h(x)))` |
| `conforms` | `Conforms` | `(subject: any, protocols: string+) -> boolean` | True iff the subject conforms to EVERY named protocol. |
| — | `Declare` | `(symbol, type: (string \| symbol)?, value: any?, attributes: dictionary<any>?) scope -> any` | Declare a symbol in the current scope, optionally assigning a type and an initial value. |
| — | `DeclareConformance` | `(target: string \| symbol, protocols: any, whereClauseOrImplementation: any?, implementation: dictionary<any>?) scope -> nothing` | Declare that a type CONFORMS to one or more protocols — the lowering of the Epsil `type string is Hashable & Comparable` statement. |
| — | `DeclareProtocol` | `(string \| symbol, members: dictionary<any>?, parents: any?, attributes: dictionary<any>?) scope -> nothing` | Declare a PROTOCOL: a set of function and property requirements a type may declare itself to satisfy. |
| — | `DeclareSumType` | `(string \| symbol, any*) scope -> nothing` | Declare a SUM TYPE: N nominal variants plus the transparent union that names them, in one statement — the lowering of the Epsil sugar `type node = lit(num: number) \| plus(op1: node, op2: node)`. |
| — | `DeclareType` | `(string \| symbol, type: string \| symbol \| type, attributes: dictionary<any>?) scope -> nothing` | Declare a type. |
| — | `DefineFunction` | `(symbol, function, dictionary<any>?) scope -> nothing` | Define one clause of a (possibly multi-clause) function: `DefineFunction(f, Function(body, params…))`. |
| — | `Delimiter` | `(any, string?) -> any` | Group expressions with explicit delimiters. |
| `digitsFrom` | `DigitsFrom` | `(s: character \| string, base: (character \| integer \| string)?) -> integer` | Return an integer representation of the string `s` in base `base`. |
| `error` | `Error` | `(expression<ErrorCode> \| string, expression?) -> nothing` | Represent an error expression. |
| — | `ErrorCode` | `(string, any*) -> error` | Structured error code with optional arguments. |
| `evaluate` | `Evaluate` | `(any) -> unknown` | Evaluate an expression. |
| `evaluateAt` | `EvaluateAt` | `(f: function, lower: expression, upper: expression?) -> unknown` | Evaluate a function at one point or between two bounds. |
| `findRoot` | `FindRoot` | `(equations: any, params: any, options: dictionary?) -> dictionary` | FindRoot(equations, params): numerically find parameter values that zero the residuals. |
| — | `Function` | `(expression, (function \| symbol)*) -> function` | Function(body, param1, param2, …): a function literal. |
| `geometricVector` | `GeometricVector` | `(start: any, end: any) -> expression` | Geometric vector (directed segment between two points) — opaque typed head. |
| `graphemeClusters` | `GraphemeClusters` | `(character \| string) -> list<character>` | A collection of grapheme clusters from a string. |
| `head` | `Head` | `(any) -> symbol` | Return the head of an expression, the name of the operator |
| — | `Hold` | `(any) -> unknown` | Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it |
| — | `HoldValues` | `(any, any?) -> expression` | HoldValues(body): evaluate `body` with its assigned free symbols shielded — each such symbol becomes a pure symbol (its declared type and in-scope assumptions apply, its assigned value does NOT) for the duration. |
| — | `HorizontalSpacing` | `(number) -> nothing` | Horizontal spacing annotation. |
| `identity` | `Identity` | `(T) -> T where T` | Return the argument unchanged |
| — | `IndexedSequence` | `(any, symbol, any, any?) -> expression` | Indexed sequence `\{a_n\}_{n=1}^{\infty}` — inert head `IndexedSequence(term, index, lower, upper?)`; not evaluated. |
| `input` | `Input` | `(prompt: string?) console -> nothing \| string` | Read one line of text from the host: the terminal in a command-line host, the `prompt()` dialog in a browser. |
| `integerString` | `IntegerString` | `(n: integer, base: integer?, length: integer?) -> string` | `integerString(n, base=10, length)` return a string representation of the integer `n` in base `base`. |
| — | `InvisibleOperator` | `function` | Implicit operator used for juxtapositions such as function application or multiplication. |
| `isError` | `IsError` | `(any) -> boolean` | True if the expression is an `error` value, or a frozen expression embedding one (`"a" + 1`). |
| `isMissing` | `IsMissing` | `(any) -> boolean` | True for `missing`, `NaN`, or a point whose coordinates are all `NaN`, regardless of provenance. |
| — | `Latex` | `(any+) -> string` | Serialize an expression to LaTeX |
| — | `LatexString` | `(string) -> string` | Value preserving type conversion/tag indicating the string is a LaTeX string |
| — | `MatchesType` | `(subject: any, type: string \| type) -> boolean` | True iff the first operand, EVALUATED, is a value of the given type — the engine form of the Epsil `x is T` test and of `match` type patterns, which both lower here. |
| `missing` | `Missing` | variable `missing` | A value that is absent but whose position is preserved (Julia `missing`, R `NA`); the sole member of the `missing` type. |
| — | `Module` | `(symbol) -> unknown` | The definition of a name in the standard library, also where a local definition shadows the name |
| — | `N` | `(any, (integer \| list<number>)?) -> unknown` | N(expr): numerically evaluate an expression. |
| `nSolve` | `NSolve` | `(any, any*) -> list` | NSolve(equation, unknown): the solutions of an equation as floats. |
| — | `NamedArgument` | `(string, any) -> nothing` | NamedArgument(name, value): one named argument of a call (Epsil surface syntax: `f(rate: 0.05)`). |
| `nothing` | `Nothing` | variable `nothing` | The value of an empty block or of a statement with no value; the sole member of the unit type. |
| `numberFrom` | `NumberFrom` | `(s: character \| string, base: (character \| integer \| string)?) -> number` | NumberFrom(s): the number the string `s` denotes — optional surrounding whitespace, an optional sign, then ASCII digits with an optional "." fraction and an optional e/E exponent, or one of "oo", "+oo", "-oo", "NaN", "Indeterminate". |
| `numericApproximation` | `NumericApproximation` | `(any) -> unknown` | Numerically evaluate an expression, as the `.N()` method does (engine-internal). |
| — | `Object` | `(any, string?) -> unknown` | Provenance head for the snapshot of a mutable object: `["Object", <record>, "'TypeName'"]`. |
| — | `Optional` | `(any, any) -> nothing` | Optional(param, default): a parameter of a function literal with a default value (Epsil surface syntax: `(x, k = 2) => x * k`). |
| — | `OverParen` | `(any+) -> expression` | Over-paren accent (`\overparen{BC}`) — opaque typed head; not evaluated. |
| `padEnd` | `PadEnd` | `(s: character \| string, n: integer, pad: (character \| string)?) -> string` | PadEnd(s, n, pad=" "): `s` padded at the END to `n` characters by repeating `pad` (its final copy truncated on a character boundary). |
| `padStart` | `PadStart` | `(s: character \| string, n: integer, pad: (character \| string)?) -> string` | PadStart(s, n, pad=" "): `s` padded at the START to `n` characters by repeating `pad` (its final copy truncated on a character boundary). |
| `parallel` | `Parallel` | `(any, any) -> expression` | Parallelism relation (`AB \parallel CD`) — opaque typed head; not evaluated. |
| `parse` | `Parse` | `(string) any -> any` | Parse a LaTeX string and evaluate to a corresponding expression |
| `perpendicular` | `Perpendicular` | `(any, any) -> expression` | Perpendicularity relation (`AB \perp CD`) — opaque typed head; not evaluated. |
| — | `Pipe` | `(value, function) -> unknown` | Apply a function to a value: `Pipe(x, f)` evaluates to `f(x)`. |
| `polygon` | `Polygon` | `(any+) -> expression` | Polygon primitive — opaque typed head. |
| `prime` | `Prime` | `(T, integer?) -> T where T` | Derivative or prime notation (`f'`, `f^{(n)}`) — opaque typed head until a derivative library handler runs. |
| `print` | `Print` | `(any*) console -> nothing` | Print the operands to the host console, separated by spaces and followed by a newline. |
| `program` | `Program` | `(unknown*) -> unknown` | Evaluate a program in the caller scope, continuing after statement errors, and return the value of its last statement. |
| — | `ProtocolDefault` | constant `unknown` | Stands for the default value of a parameter in a call of a protocol member: the call receives the default that the selected requirement declares for that parameter. |
| — | `ProtocolMember` | `(protocol: string, member: string, arguments: any*) -> unknown` | Invoke a protocol member on a value — the lowering of a QUALIFIED protocol call (`Comparable.compare(x, y)` in Epsil, whose parse, a `MemberCall` on the protocol name, canonicalizes to `apply(field(Comparable, "compare"), x, y)`). |
| — | `ProtocolProperty` | `(protocol: string, property: string, receiver: any, value: any?) -> unknown` | Read (or write) a protocol PROPERTY through a NAMED protocol — the lowering of the qualified field form `person.(Nameable.name)` (protocols design P6, amending the D16 field grammar). |
| `quadrilateral` | `Quadrilateral` | `(any+) -> expression` | Quadrilateral mark (`\square ABCD`) — opaque typed head; not evaluated. |
| `random` | `Random` | `((collection<any> \| set<real>)?) random -> any` | Random(): non-deterministic real in [0, 1) |
| `randomChoice` | `RandomChoice` | `((T, k: number) random -> T where T: string) & ((collection<any> \| set<real>, k: number) random -> list<any>)` | RandomChoice(domain, k): a list of k independent draws from `domain`, with replacement. |
| `randomExpression` | `RandomExpression` | `() entropy -> expression` | Generate a random expression. |
| — | `ReleaseHold` | `(any) -> unknown` | Release an expression held by `Hold` |
| `replaceAll` | `ReplaceAll` | `(any, any+) -> any` | ReplaceAll(expr, rules): apply one or more replacement rules to `expr`, then evaluate the result (Mathematica `expr /. rules`). |
| — | `Rule` | `(match: expression, replace: expression, predicate: function?) -> expression` | Pattern replacement rule. |
| — | `RuntimeError` | `(expression<ErrorCode> \| string) -> never` | Construct an error value when evaluated: the runtime counterpart of a written `Error(…)`, which is a static diagnostic node. |
| `segment` | `Segment` | `(any+) -> expression` | Segment primitive — opaque typed head. |
| — | `Sequence` | `function` | Ordered sequence of expressions. |
| — | `Signature` | `(symbol) -> nothing \| string` | Return the signature string of an operator. |
| `simplify` | `Simplify` | `(any, assumptions: any?) -> expression` | Simplify(expr): simplify an expression. |
| `solve` | `Solve` | `(any, any*) -> list` | Solve(equation, unknown): the list of solutions of an equation for the unknown. |
| `sphere` | `Sphere` | `(any+) -> expression` | Sphere primitive — opaque typed head. |
| — | `Spread` | `(any) -> unknown` | Spread(t): splice the elements of the tuple `t` into the enclosing argument list (Epsil surface syntax: `f(...t)`). |
| — | `String` | `(any*) -> string` | A string created by joining its arguments. |
| `stringCompare` | `StringCompare` | `(character \| string, character \| string) -> integer` | StringCompare(a, b): -1 when `a` sorts before `b`, 0 when they are equal, 1 when `a` sorts after `b`. |
| `stringFrom` | `StringFrom` | `(any, format: string?) -> string` | StringFrom(value, format?): create a string from `value`. |
| `stringJoin` | `StringJoin` | `(collection<character \| string>, separator: (character \| string)?) -> string` | StringJoin(xs): join the elements of the finite collection `xs` (strings or characters) into a string. |
| `stringRepeat` | `StringRepeat` | `(character \| string, n: integer) -> string` | StringRepeat(s, n): `n` copies of the string `s`, concatenated. |
| `stringReplace` | `StringReplace` | `((character \| string, character \| string, character \| string, count: integer?) -> string) & ((character \| string, regexp, character \| string, count: integer?) -> string) & ((character \| string, regexp, function, count: integer?) -> string)` | StringReplace(s, target, replacement): replace every non-overlapping occurrence of `target` in `s`, scanning left to right over whole characters. |
| `stringSplit` | `StringSplit` | `((character \| string, (character \| string)?) -> list<string>) & ((character \| string, regexp) -> list<string>)` | StringSplit(s): split a string on runs of whitespace (the Unicode White_Space code points), dropping empty parts. |
| — | `Subscript` | `(collection<any>, any) -> any` | Subscript notation for indexing or compound symbols. |
| — | `Subtype` | `(subtype: string \| type, supertype: string \| type) -> boolean` | True iff the FIRST operand is a subtype of the second — `Subtype("integer", "number")` is `True`, `Subtype("number", "integer")` is `False`. |
| `symbol` | `Symbol` | `function` | Construct a new symbol with a name formed by concatenating the arguments |
| `tail` | `Tail` | `(any) -> collection` | Return the tail of an expression, the operands of the expression |
| — | `Text` | `(any*) -> string` | A sequence of strings, annotated expressions and other Text expressions |
| `timing` | `Timing` | `(value, repeat: integer?) -> tuple<number, value>` | `timing(expr)` evaluates `expr` and returns a pair: the time the evaluation took, in microseconds, then the value; read them as `timing(expr)[1]` and `timing(expr)[2]`. |
| `to` | `To` | `(any, any) -> nothing` | Action arrow / mapping (`a \to b`) — opaque typed head. |
| `toLowerCase` | `ToLowerCase` | `(character \| string) -> string` | ToLowerCase(s): the string `s` mapped to lower case using the Unicode default (locale-independent) mappings. |
| `toUpperCase` | `ToUpperCase` | `(character \| string) -> string` | ToUpperCase(s): the string `s` mapped to upper case using the Unicode default (locale-independent) mappings. |
| `triangle` | `Triangle` | `(any+) -> expression` | Triangle primitive — opaque typed head. |
| `trim` | `Trim` | `(character \| string, chars: (character \| collection<character \| string> \| string)?) -> string` | Trim(s): remove leading and trailing whitespace (the Unicode White_Space characters). |
| `trimEnd` | `TrimEnd` | `(character \| string, chars: (character \| collection<character \| string> \| string)?) -> string` | TrimEnd(s): remove trailing whitespace (the Unicode White_Space characters). |
| `trimStart` | `TrimStart` | `(character \| string, chars: (character \| collection<character \| string> \| string)?) -> string` | TrimStart(s): remove leading whitespace (the Unicode White_Space characters). |
| `type` | `Type` | `(any) -> type` | The STATIC type of an expression, as a type value: `type("hi")` is `TypeFrom("string")`. |
| `typeFrom` | `TypeFrom` | `(text: string) -> type` | A type expression as a first-class value, constructed from its text: `TypeFrom("list<integer>")`. |
| — | `Typed` | `(any, string \| symbol) -> unknown` | Ascribe a type to an expression. |
| — | `Unevaluated` | `(any) -> unknown` | Prevent an expression from being evaluated |
| `unicodeScalars` | `UnicodeScalars` | `(character \| string) -> list<integer>` | A collection of Unicode scalars from a string, same as UTF-32 |
| `utf16` | `Utf16` | `(character \| string) -> list<integer>` | A collection of UTF-16 code units from a string. |
| `utf8` | `Utf8` | `(character \| string) -> list<integer>` | A collection of UTF-8 code units from a string. |
| — | `Wildcard` | `(symbol) -> symbol` | Single-expression pattern wildcard. |
| — | `WildcardOptionalSequence` | `(symbol) -> symbol` | Pattern wildcard matching zero or more expressions. |
| — | `WildcardSequence` | `(symbol) -> symbol` | Pattern wildcard matching one or more expressions. |
| `withRandomSeed` | `WithRandomSeed` | `(seed: real \| string, body: any) -> expression` | WithRandomSeed(seed, body): evaluate `body` with a random seed frame seeded by `seed` (a finite real or a string). |

## Control structures

The [Control structures reference](/epsil/reference/control-structures/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| — | `AddTo` | `(expression, any) scope -> any` | Compound assignment: `AddTo(s, e)` is `Assign(s, Add(s, e))`, and `AddTo(At(L, i, …), e)` is `Assign(L, ReplaceAt(L, i, …, Add(At(L, i, …), e)))`, with each position evaluated once, before `e`. |
| — | `Alternatives` | `(expression+) -> nothing` | Inside a `Match` pattern, `Alternatives(p1, p2, …)` matches if any alternative matches. |
| — | `Break` | `(value: any?) -> nothing` | Exit the enclosing loop immediately, optionally with a value (`Break(v)`) that becomes the loop value. |
| — | `Comprehension` | `(body: expression, iterators: expression+) -> list` | Value-producing comprehension: evaluate `body` in nested iteration over one or more `Element` clauses and collect the results into a list. |
| — | `Condition` | `(expression, symbol?) -> boolean` | Test whether a value satisfies one or more conditions. |
| — | `Continue` | `() -> nothing` | Skip to the next iteration of the enclosing loop. |
| `fixedPoint` | `FixedPoint` | `(f: function, initial: any, maxIterations: integer?) -> unknown` | Apply a function repeatedly, starting from an initial value, until two successive values are the same: `fixedPoint(f, x)` is the first of `f(x)`, `f(f(x))`, … that `f` maps to itself. |
| — | `If` | `(expression, expression, expression?) -> any` | `If(c, e1, e2)` evaluates to `e1` when `c` is `True` and to `e2` otherwise; without `e2` it is the absent value of the domain of `e1` when `c` is `False`: `NaN` for a number, `missing` otherwise, as for a restriction `e1\{c\}`, which… |
| — | `Loop` | `(body: expression, iterators: expression*) -> any` | Imperative loop, evaluated **for effect**. |
| — | `Match` | `(expression, expression+) -> unknown` | Structural pattern match. |
| — | `MatchCase` | `(expression, expression, expression?) -> nothing` | A case of a `Match`: `MatchCase(pattern, body)` or `MatchCase(pattern, guard, body)`. |
| — | `ParallelComprehension` | `(body: expression, iterators: expression+) random -> list` | Parallel comprehension: `ParallelComprehension(body, Element(x, xs), …)` is the list that `Comprehension` with the same operands gives, but the passes of the first clause can run in any order. |
| `parallelDomain` | `ParallelDomain` | `(collection: any) random -> any` | The domain of the passes of a parallel loop (engine-internal). |
| — | `ParallelLoop` | `(body: expression, iterators: expression+) random -> any` | Parallel loop, evaluated **for effect**: `ParallelLoop(body, Element(x, coll))` evaluates `body` once for each element of `coll` (a pass), and the passes can run in any order. |
| — | `Pin` | `(expression) -> nothing` | Inside a `Match` pattern, `Pin(expr)` matches the value of `expr` (evaluated at match time) rather than its structure. |
| — | `Which` | `(expression+) -> unknown` | `Which(c1, e1, c2, e2, …)` evaluates to the value of the first `e` whose condition `c` is `True`, and to `missing` when no condition is `True`. |

## Logic

The [Logic reference](/epsil/reference/logic/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| — | `And` | `(boolean+) -> boolean` | Logical conjunction (AND): true when all operands are true. |
| `boole` | `Boole` | `(boolean) -> integer` | Return 1 if the argument is true, 0 otherwise. |
| `equivalent` | `Equivalent` | `(boolean, boolean) -> boolean` | Logical equivalence (if and only if): true when both operands have the same truth value. |
| `exists` | `Exists` | `(value, boolean) -> boolean` | Existential quantifier (there exists): true when the predicate holds for at least one value. |
| `existsUnique` | `ExistsUnique` | `(value, boolean) -> boolean` | Unique existential quantifier (there exists exactly one value satisfying the predicate). |
| — | `False` | constant `boolean` | The boolean truth value false. |
| `forAll` | `ForAll` | `(value, boolean) -> boolean` | Universal quantifier (for all): true when the predicate holds for every value. |
| `implies` | `Implies` | `(antecedent: boolean, consequent: boolean) -> boolean` | Logical implication: false only when the antecedent is true and the consequent is false. |
| `isSatisfiable` | `IsSatisfiable` | `(boolean) -> boolean` | Return `True` when some assignment of truth values to the variables of a boolean expression makes it true, `False` otherwise. |
| `isTautology` | `IsTautology` | `(boolean) -> boolean` | Return `True` when a boolean expression is true for every assignment of truth values to its variables, `False` otherwise. |
| `kroneckerDelta` | `KroneckerDelta` | `(value+) -> integer` | Return 1 if the arguments are equal, 0 otherwise. |
| `minimalCNF` | `MinimalCNF` | `(boolean) -> boolean` | Return a minimal conjunctive normal form (CNF) of a boolean expression: an AND of ORs of its prime implicates with the fewest clauses (for a large expression, the search for the fewest can stop at a budget and give a few more). |
| `minimalDNF` | `MinimalDNF` | `(boolean) -> boolean` | Return a minimal disjunctive normal form (DNF) of a boolean expression: an OR of ANDs of its prime implicants with the fewest terms (for a large expression, the search for the fewest can stop at a budget and give a few more). |
| `nand` | `Nand` | `(boolean+) -> boolean` | Logical NAND: the negation of AND (n-ary). |
| `nor` | `Nor` | `(boolean+) -> boolean` | Logical NOR: the negation of OR (n-ary). |
| — | `Not` | `(boolean) -> boolean` | Logical negation (NOT). |
| `notExists` | `NotExists` | `(value, boolean) -> boolean` | Negated existential quantifier (there does not exist): true when the predicate holds for no value. |
| `notForAll` | `NotForAll` | `(value, boolean) -> boolean` | Negated universal quantifier (not for all): true when the predicate fails for at least one value. |
| — | `Or` | `(boolean+) -> boolean` | Logical disjunction (OR): true when at least one operand is true. |
| — | `Predicate` | `(symbol, value+) -> boolean` | Apply a predicate to arguments, returning a boolean |
| `primeImplicants` | `PrimeImplicants` | `(boolean) -> list` | Return the list of the prime implicants of a boolean expression: the minimal conjunctions of literals that imply it. |
| `primeImplicates` | `PrimeImplicates` | `(boolean) -> list` | Return the list of the prime implicates of a boolean expression: the minimal disjunctions of literals that it implies. |
| `toCNF` | `ToCNF` | `(boolean) -> boolean` | Convert a boolean expression to conjunctive normal form (CNF), an AND of ORs. |
| `toDNF` | `ToDNF` | `(boolean) -> boolean` | Convert a boolean expression to disjunctive normal form (DNF), an OR of ANDs. |
| — | `True` | constant `boolean` | The boolean truth value true. |
| `truthTable` | `TruthTable` | `(boolean) -> list` | Return the truth table of a boolean expression, as a list of rows. |
| `xor` | `Xor` | `(boolean+) -> boolean` | Exclusive or: true when an odd number of operands are true |

## Collections

The [Collections reference](/epsil/reference/collections/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `adjoin` | `Adjoin` | `(set<any>, any+) -> set` | The ring obtained by adjoining one or more elements to a base ring. |
| `all` | `All` | `(xs: collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T` | Return True if the predicate holds for every element of the collection (or if every element is True when no predicate is given). |
| `any` | `Any` | `(xs: collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T` | Return True if the predicate holds for at least one element of the collection (or if any element is True when no predicate is given). |
| `append` | `Append` | `(collection<any>, any+) -> collection` | Return the collection with one or more elements added at its end. |
| `argMax` | `ArgMax` | `(xs: indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T` | Return the 1-based index of the element that maximizes the given key function (or of the largest element when no key is given); of several such elements, the first. |
| `argMin` | `ArgMin` | `(xs: indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T` | Return the 1-based index of the element that minimizes the given key function (or of the smallest element when no key is given); of several such elements, the first. |
| `arrayFrom` | `ArrayFrom` | `(value, string?) state -> array` | Make a new mutable array from the elements of a finite collection, or from the cells of an array, in order. |
| — | `At` | `(value: any, index: (boolean \| character \| indexed_collection<any> \| number \| string)+) -> unknown` | Access an element of an indexed collection. |
| `chunk` | `Chunk` | `((xs: S, count: integer) -> list<string> where S: string) & ((xs: indexed_collection, count: integer) -> list<list>)` | Return the collection split into `count` groups of consecutive elements. |
| `chunkBy` | `ChunkBy` | `((xs: S, key: (character) any -> unknown) -> list<string> where S: string) & ((xs: indexed_collection<T>, key: (T) any -> unknown) -> list<list<T>> where T: any)` | Split the collection into maximal runs of consecutive elements over which the key function yields the same value. |
| `closed` | `Closed` | `(number) -> number` | Closed(x): the endpoint x of an Interval, marked as included. |
| `complement` | `Complement` | `(set<any>+) -> set` | Return the elements of the first set that are not in any of the subsequent sets. |
| `complexNumbers` | `ComplexNumbers` | constant `set<complex>` | The set of all finite complex numbers. |
| `contains` | `Contains` | `(xs: collection<any>, element: any) -> boolean` | Return True if the collection contains the given element (structural identity, like `===`), False otherwise. |
| `containsSequence` | `ContainsSequence` | `(xs: indexed_collection<T>, needle: indexed_collection<T>) -> boolean where T` | Return `True` when `needle` occurs as a contiguous subsequence of the indexed collection. |
| `count` | `Count` | `(xs: collection<any>, element: any?, levels: any?) -> infinity \| integer` | `count(xs)`: the number of elements in the collection. |
| `countIf` | `CountIf` | `(xs: collection<T>, predicate: (T) any -> boolean) -> integer where T` | Return the number of elements in the collection satisfying the predicate. |
| `cycle` | `Cycle` | `(list<any>) -> list` | Produce an infinite sequence by cycling through the elements of a finite collection. |
| `dedup` | `Dedup` | `(collection<any>) -> collection` | Return the collection with consecutive duplicate elements collapsed to a single element. |
| `deleteAt` | `DeleteAt` | `((xs: T, index: integer) -> T where T: string) & ((xs: indexed_collection<T>, index: integer) -> list<T> where T: any) & ((xs: dictionary<V>, key: string) -> dictionary<V> where V: any)` | Return a copy of the indexed collection with the element at the 1-based `index` removed. |
| — | `Dictionary` | `(tuple<string, unknown>*) -> dictionary` | A collection of key -&gt; value entries with string keys (`{x -> 1, y -> 2}` in Epsil). |
| `dictionaryFrom` | `DictionaryFrom` | `(collection<any>) -> dictionary` | Create a dictionary from the elements of a collection of (key, value) pairs. |
| `differences` | `Differences` | `(indexed_collection<any>) -> indexed_collection` | Return the successive differences of a collection: a collection whose k-th element is `x(k+1) − xk`, of length one less than the input. |
| `drop` | `Drop` | `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T: any)` | Return the indexed collection without its first `count` elements. |
| `dropWhile` | `DropWhile` | `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> indexed_collection where T` | Return the collection with its leading elements for which the predicate returns True removed; the remaining elements are returned unfiltered. |
| — | `Element` | `(any, any, boolean?) -> boolean` | Test whether a value is an element of a collection. |
| `emptySet` | `EmptySet` | constant `set` | The empty set, a set containing no elements. |
| `endsWith` | `EndsWith` | `(xs: indexed_collection<T>, suffix: indexed_collection<T>) -> boolean where T` | Return `True` when the indexed collection ends with `suffix` as a contiguous subsequence. |
| `extendedComplexNumbers` | `ExtendedComplexNumbers` | constant `set<complex \| infinity>` | The set of all complex numbers, including infinities. |
| `extendedIntegers` | `ExtendedIntegers` | constant `set<integer \| signed_infinity>` | The set of all integers, including infinities. |
| `extendedRationalNumbers` | `ExtendedRationalNumbers` | constant `set<rational \| signed_infinity>` | The set of all rational numbers, including infinities. |
| `extendedRealNumbers` | `ExtendedRealNumbers` | constant `set<real \| signed_infinity>` | The set of all real numbers, including infinities. |
| `field` | `Field` | `(value: any, field: string) -> unknown` | Return the named field of a value: `p.x` in Epsil. |
| `filter` | `Filter` | `(xs: collection<T>, predicate: (T) any -> boolean) -> collection where T` | Return the elements of the collection for which the predicate function returns True. |
| `find` | `Find` | `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> any where T: any` | Return the first element of the collection satisfying the predicate. |
| `first` | `First` | `(xs: indexed_collection<any>, default: any?) -> any` | The first element of a collection. |
| `flatMap` | `FlatMap` | `(xs: collection<T>, mapping: (T) any -> U) -> list where T, U` | Map a function over a collection and concatenate the results into a single list, splicing collection-valued results and keeping scalar results as single elements. |
| `fold` | `Fold` | `(reducer: (unknown, T) any -> unknown, initial: value, xs: collection<T>) -> value where T` | Fold a collection to a single value, applying a binary function f(accumulator, element) left to right from an initial value. |
| `groupBy` | `GroupBy` | `(xs: collection<T>, key: (T) any -> unknown) -> dictionary<list> where T` | Partition the collection into a dictionary of lists based on the key returned by the function. |
| `imaginaryNumbers` | `ImaginaryNumbers` | constant `set<imaginary>` | The set of all imaginary numbers. |
| `indexOf` | `IndexOf` | `(xs: indexed_collection<any>, element: any) -> integer` | Return the 1-based index of the first occurrence of value in collection, or 0 if not found. |
| `indexWhere` | `IndexWhere` | `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> integer where T` | Return the 1-based index of the first element satisfying the predicate, or 0 if not found. |
| `insert` | `Insert` | `(xs: indexed_collection<T>, index: integer, element: T) -> list<T> where T: any` | Return a copy of the indexed collection with `element` inserted before the 1-based `index`. |
| `integers` | `Integers` | constant `set<integer>` | The set of all finite integers. |
| `intersection` | `Intersection` | `(any+) -> set` | Return the intersection of one or more collections as a set. |
| `interval` | `Interval` | `(start: number, end: number) -> set<real>` | A set of real numbers between two endpoints. |
| `isEmpty` | `IsEmpty` | `(collection<any>) -> boolean` | Return True if the collection is empty, False otherwise. |
| `iterate` | `Iterate` | `(f: function, initial: any?) -> list` | Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value. |
| `join` | `Join` | `((T+) -> T where T: string) & ((collection<any>*) -> collection)` | Join the elements of some collections into a flat collection. |
| — | `KeyValuePair` | `(key: string, value: T) -> tuple<string, T> where T` | A key/value pair |
| `keys` | `Keys` | `(dictionary<any>) -> list<string>` | Return a list of the keys of a dictionary. |
| `last` | `Last` | `(xs: indexed_collection<any>, default: any?) -> any` | The last element of a collection. |
| `length` | `Length` | `(any) -> infinity \| integer` | Number of elements in a collection. |
| `linspace` | `Linspace` | `(start: number, end: number?, count: number?) -> list<number>` | A sequence of evenly spaced numbers between a start and end value, both endpoints included. |
| — | `List` | `(any*) -> list` | An ordered collection of elements (a list). |
| `listFrom` | `ListFrom` | `(value*) -> list` | Create a list from the elements of a collection. |
| — | `ListJoin` | `(collection<any>*) -> list` | Join the elements of some collections into a list. |
| `map` | `Map` | `(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U` | Return the collection where each element has been transformed by the mapping function. |
| `maxBy` | `MaxBy` | `(xs: collection<T>, key: (T) any -> unknown) -> value where T` | Return the element of the collection that maximizes the given key function. |
| — | `MemberCall` | `(receiver: any, member: string, arguments: any*) -> unknown` | Call the member `name` of a value with the value as its first argument: `c.area(2)` in Epsil. |
| `minBy` | `MinBy` | `(xs: collection<T>, key: (T) any -> unknown) -> value where T` | Return the element of the collection that minimizes the given key function. |
| `most` | `Most` | `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T: any)` | Return the collection without the last element. |
| `negativeIntegers` | `NegativeIntegers` | constant `set<integer>` | The set of all negative integers. |
| `negativeNumbers` | `NegativeNumbers` | constant `set<real>` | The set of all negative real numbers. |
| `nonNegativeIntegers` | `NonNegativeIntegers` | constant `set<integer>` | The set of all non-negative integers. |
| `nonNegativeNumbers` | `NonNegativeNumbers` | constant `set<real>` | The set of all non-negative real numbers. |
| `nonPositiveIntegers` | `NonPositiveIntegers` | constant `set<integer>` | The set of all non-positive integers. |
| `nonPositiveNumbers` | `NonPositiveNumbers` | constant `set<real>` | The set of all non-positive real numbers. |
| — | `NotElement` | `(any, any) -> boolean` | Test whether a value is not an element of a collection. |
| — | `NotSubset` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is not a strict subset of the second. |
| — | `NotSuperset` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is not a strict superset of the second. |
| — | `NotSupersetEqual` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is not a superset (possibly equal) of the second. |
| `numbers` | `Numbers` | constant `set<number>` | The set of all numbers. |
| `open` | `Open` | `(number) -> number` | Open(x): the endpoint x of an Interval, marked as excluded. |
| `ordering` | `Ordering` | `(xs: indexed_collection<T>, order: (((T) any -> unknown) \| ((any, any) any -> boolean \| number))?) -> list<integer> where T: any` | Return the indexes that would sort the collection. |
| — | `Pair` | `(first: T, second: U) -> tuple<T, U> where T, U` | A tuple of two elements |
| `partition` | `Partition` | `(xs: indexed_collection<T>, count: ((T) any -> boolean) \| integer, step: integer?) -> list<list<T>> where T: any` | Partition a collection into consecutive chunks each of size `count`; the trailing chunk may be shorter when `count` does not divide the length. |
| `pointList` | `PointList` | `(any+) -> any` | A list of points: zips collection components into a List of point-tuples (Desmos point-list idiom); a plain point when no component is a collection. |
| `pointX` | `PointX` | `(xs: collection<any> \| tuple) -> any` | The x-coordinate of a point, broadcasting over a list of points. |
| `pointY` | `PointY` | `(xs: collection<any> \| tuple) -> any` | The y-coordinate of a point, broadcasting over a list of points. |
| `pointZ` | `PointZ` | `(xs: collection<any> \| tuple) -> any` | The z-coordinate of a point, broadcasting over a list of points. |
| `position` | `Position` | `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> list<integer> where T: any` | Return a list of indexes of elements in the collection satisfying the predicate. |
| `positiveIntegers` | `PositiveIntegers` | constant `set<integer>` | The set of all positive integers. |
| `positiveNumbers` | `PositiveNumbers` | constant `set<real>` | The set of all positive real numbers. |
| `primes` | `Primes` | constant `set<integer>` | The set of all prime numbers. |
| `quotientRing` | `QuotientRing` | `(set<any>, any) -> set` | The quotient of a ring by the ideal generated by the second argument. |
| `randomShuffle` | `RandomShuffle` | `((T) random -> T where T: string) & ((indexed_collection<T>) random -> list<T> where T: any)` | Randomize the order of the elements in the collection. |
| — | `Range` | `(number, number?, step: number?) -> list<number>` | A sequence of numbers from a start to an end value with an optional step. |
| `rangeOf` | `RangeOf` | `(xs: indexed_collection<T>, needle: indexed_collection<T>, from: integer?) -> missing \| range where T` | Return the 1-based inclusive index span of the first occurrence of `needle` as a contiguous subsequence of the indexed collection, or `missing` when it does not occur. |
| `rationalNumbers` | `RationalNumbers` | constant `set<rational>` | The set of all finite rational numbers. |
| `realNumbers` | `RealNumbers` | constant `set<real>` | The set of all finite real numbers. |
| `reduce` | `Reduce` | `(xs: collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T` | Reduce (fold) a collection to a single value by repeatedly applying a binary function, with an optional initial value. |
| `repeat` | `Repeat` | `(value: any, count: integer?) -> list` | Produce a sequence by repeating a single value. |
| `replaceAt` | `ReplaceAt` | `((xs: indexed_collection<T>, index: integer, element: T) -> list<T> where T: any) & ((xs: indexed_collection<any>, index: integer, integer, any+) -> list<any>)` | Return a copy of the indexed collection with the element at the 1-based `index` replaced by `element`. |
| `residueClass` | `ResidueClass` | `(k: any, n: any) -> residue` | An element of ℤ/nℤ: the class of the integer `k` modulo `n`. |
| `rest` | `Rest` | `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T: any)` | Return the collection without the first element. |
| `reverse` | `Reverse` | `((T) -> T where T: string) & ((T) -> T where T: list) & ((indexed_collection<T>) -> list<T> where T: any)` | Reverse the order of the elements of an indexed collection. |
| `rotateLeft` | `RotateLeft` | `((xs: T, n: integer?) -> T where T: string) & ((xs: T, n: integer?) -> T where T: list) & ((xs: indexed_collection<T>, n: integer?) -> list<T> where T: any)` | Rotate the elements of the collection to the left by n positions. |
| `rotateRight` | `RotateRight` | `((xs: T, n: integer?) -> T where T: string) & ((xs: T, n: integer?) -> T where T: list) & ((xs: indexed_collection<T>, n: integer?) -> list<T> where T: any)` | Rotate the elements of the collection to the right by n positions. |
| `scan` | `Scan` | `(xs: indexed_collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T` | Return the cumulative fold of a collection: a same-length collection whose k-th element is the running result of applying a binary function left to right (optionally seeded by an initial value). |
| `second` | `Second` | `(xs: indexed_collection<any>) -> any` | The second element of a collection. |
| — | `Set` | `(any*) -> set` | An unordered collection of distinct elements (a set). |
| `setFrom` | `SetFrom` | `(value*) -> set` | Create a set from the elements of a collection. |
| `setMinus` | `SetMinus` | `(set<any>, value*) -> set` | Return the set difference between the first set and subsequent values. |
| — | `Single` | `(value: T) -> tuple<T> where T` | A tuple with a single element |
| `slice` | `Slice` | `((value: T, span: range) -> T where T: string) & ((value: T, start: number, end: number) -> T where T: string) & ((value: indexed_collection<T>, span: range) -> list<T> where T: any) & ((value: indexed_collection<T>, start: number, end: number) -> list<T> where T: any)` | Return a contiguous run of elements from an indexed collection. |
| `sort` | `Sort` | `((T, order: (((character) any -> unknown) \| ((character, character) any -> boolean \| number))?) -> T where T: string) & ((indexed_collection<T>, order: (((T) any -> unknown) \| ((any, any) any -> boolean \| number))?) -> list<T> where T: any)` | Return the elements of the collection sorted according to the given comparison function. |
| `startsWith` | `StartsWith` | `(xs: indexed_collection<T>, prefix: indexed_collection<T>) -> boolean where T` | Return `True` when the indexed collection begins with `prefix` as a contiguous subsequence. |
| `subset` | `Subset` | `(any, any*) -> boolean` | Test whether the first collection is a strict subset of the second. |
| `subsetEqual` | `SubsetEqual` | `(any, any*) -> boolean` | Test whether the first collection is a subset (possibly equal) of the second. |
| `superset` | `Superset` | `(any, any*) -> boolean` | Test whether the first collection is a strict superset of the second. |
| `supersetEqual` | `SupersetEqual` | `(any, any*) -> boolean` | Test whether the first collection is a superset (possibly equal) of the second. |
| `swap` | `Swap` | `(array, array) state -> nothing` | Exchange the cells and the counts of two arrays of one cell type, in constant time, with no cell copied. |
| `symmetricDifference` | `SymmetricDifference` | `(set<any>, set<any>) -> set` | Return the symmetric difference of two sets (elements in either set but not both). |
| `table` | `Table` | `(function, integer+) -> collection` | Return the list of the values of a function at each index of the given dimensions, as `tabulate` (the preferred name) does. |
| `tabulate` | `Tabulate` | `(generator: function, integer+) -> list` | Create a collection by applying a function to each index in the specified dimensions. |
| `take` | `Take` | `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T: any)` | Return the first `n` elements of an indexed collection. |
| `takeWhile` | `TakeWhile` | `(xs: indexed_collection<T>, predicate: (T) any -> boolean) -> indexed_collection where T` | Return the leading elements of the collection for which the predicate returns True, stopping at the first element that does not. |
| `tally` | `Tally` | `(collection<T>) -> tuple<list<T>, list<integer>> where T` | Return a tuple with the unique elements of the collection and their respective counts. |
| `third` | `Third` | `(xs: indexed_collection<any>) -> any` | The third element of a collection. |
| — | `Triple` | `(first: T, second: U, third: V) -> tuple<T, U, V> where T, U, V` | A tuple of three elements |
| — | `Tuple` | `(any*) -> tuple` | A fixed number of heterogeneous elements. |
| `tupleFrom` | `TupleFrom` | `(value*) -> tuple` | Create a tuple from the elements of a collection. |
| `union` | `Union` | `(any+) -> set` | Return the union of two or more collections as a set. |
| `unique` | `Unique` | `((xs: T) -> T where T: string) & ((xs: T, test: (character, character) any -> boolean) -> T where T: string) & ((xs: collection<T>) -> list<T> where T: any) & ((xs: collection<T>, test: (T, T) any -> boolean) -> list<T> where T: any)` | Return a list of the unique elements of the collection. |
| `values` | `Values` | `(dictionary<any>) -> list` | Return a list of the values of a dictionary. |
| `zip` | `Zip` | `(indexed_collection<any>+) -> list` | Combine multiple collections element-wise into a list of tuples. |

## Colors

The [Colors reference](/epsil/reference/colors/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `asHsl` | `AsHsl` | `(color \| string \| tuple) -> color` | Convert any color to HSL (hue degrees, s/l 0-1) |
| `asHsv` | `AsHsv` | `(color \| string \| tuple) -> color` | Convert any color to HSV (hue degrees, s/v 0-1) |
| `asOklab` | `AsOklab` | `(color \| string \| tuple) -> color` | Convert any color to OKLab |
| `asOklch` | `AsOklch` | `(color \| string \| tuple) -> color` | Convert any color to OKLCh |
| `asRgb` | `AsRgb` | `(color \| string \| tuple) -> color` | Convert any color to sRGB (channels 0-1) |
| `color` | `Color` | `(string) -> color` | Parse a CSS-style color string to an Oklch color |
| `colorContrast` | `ColorContrast` | `(background: color \| string \| tuple, foreground: color \| string \| tuple) -> number` | APCA contrast ratio between two colors |
| `colorDelta` | `ColorDelta` | `(color \| string \| tuple, color \| string \| tuple) -> number` | Perceptual color difference (ΔE_OK) between two colors |
| `colorFromColorspace` | `ColorFromColorspace` | `(channels: color \| tuple, space: string) -> color` | Build a color from channel values in a named color space. |
| `colorMix` | `ColorMix` | `(a: color \| string \| tuple, b: color \| string \| tuple, ratio: number?) -> color` | Mix two colors in OKLCh space |
| `colorToColorspace` | `ColorToColorspace` | `(color: color \| string \| tuple, space: string) -> tuple` | Convert a color to components in a target color space |
| `colorToString` | `ColorToString` | `(color: color \| string \| tuple, format: string?) -> string` | Convert a color to a string in the specified format: "hex" (the default), "rgb", "hsl", "oklch", "srgb" (the same as "hex") or "display-p3" (the CSS spelling `color(display-p3 r g b)`). |
| `colormap` | `Colormap` | `(string, number?) -> color \| list<color>` | Sample colors from a named palette. |
| `contrastingColor` | `ContrastingColor` | `(background: color \| string \| tuple, a: (color \| string \| tuple)?, b: (color \| string \| tuple)?) -> color` | Choose the foreground color with better APCA contrast against a background, answered as given: the interpreter keeps the color head the candidate was written with, and a compiled target answers the same color in its canonical form |
| `gamutMap` | `GamutMap` | `(color: color \| string \| tuple, gamut: string?) -> color` | Map a color into a target gamut, "srgb" (the default) or "display-p3", with the CSS Color 4 gamut-mapping algorithm: the OKLCh chroma is reduced, at constant lightness and hue, until the color is inside the gamut or until clipping each… |
| `hsl` | `Hsl` | `(h: number, s: number, l: number, alpha: number?) -> color` | HSL color (hue degrees, saturation/lightness 0-1, optional alpha) |
| `hsv` | `Hsv` | `(h: number, s: number, v: number, alpha: number?) -> color` | HSV color (hue degrees, saturation/value 0-1, optional alpha) |
| `oklab` | `Oklab` | `(l: number, a: number, b: number, alpha: number?) -> color` | OKLab color (L 0-1, a/b ~ -0.4..0.4, optional alpha) |
| `oklch` | `Oklch` | `(l: number, c: number, h: number, alpha: number?) -> color` | OKLCh color (L 0-1, C 0-~0.4, hue degrees, optional alpha) |
| `rgb` | `Rgb` | `(r: number, g: number, b: number, alpha: number?) -> color` | sRGB color (channels 0-1, optional alpha 0-1) |

## Regular expressions

The [Regular expressions reference](/epsil/reference/regexp/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `isMatch` | `IsMatch` | `(subject: character \| string, pattern: regexp) -> boolean` | Whether a string contains a match for a regular expression. |
| `regExp` | `RegExp` | `(pattern: string, flags: string?) -> regexp` | A compiled regular expression, using the host JavaScript dialect. |
| `stringMatch` | `StringMatch` | `(subject: character \| string, pattern: regexp) -> nothing \| record` | The first match of a regular expression in a string, as a record. |
| `stringMatchAll` | `StringMatchAll` | `(subject: character \| string, pattern: regexp) -> list<record>` | Every non-overlapping match of a regular expression in a string, as a list of records. |

## Relations

The [Relations reference](/epsil/reference/relop/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| — | `Approx` | `(any, any*) -> boolean` | Approximate-equality relation (approximately equal). |
| — | `ApproxEqual` | `(any, any*) -> boolean` | Approximately-equal relation. |
| — | `ApproxNotEqual` | `(any, any*) -> boolean` | Approximately-not-equal relation. |
| `congruent` | `Congruent` | `(number, number, modulo: number) -> boolean` | Indicate that two expressions are congruent modulo a number |
| — | `Equal` | `(any, any) -> boolean` | Equality comparison (equal to). |
| — | `Greater` | `(any, any*) -> boolean` | Greater-than comparison (strictly greater than). |
| — | `GreaterEqual` | `(any, any*) -> boolean` | Greater-than-or-equal comparison (greater than or equal to). |
| `identicallyEqual` | `IdenticallyEqual` | `(any, any) -> boolean` | Identity comparison (`\equiv`). |
| `isSame` | `IsSame` | `(any, any) -> boolean` | Compare two expressions for structural equality |
| — | `Less` | `(any, any*) -> boolean` | Less-than comparison (strictly less than). |
| — | `LessEqual` | `(any, any*) -> boolean` | Less-than-or-equal comparison (less than or equal to). |
| — | `NotApprox` | `(any, any*) -> boolean` | Negated approximate-equality relation (not approximately equal). |
| — | `NotApproxEqual` | `(any*) -> unknown` | Negated approximately-equal relation. |
| — | `NotApproxNotEqual` | `(any, any*) -> boolean` | Negated approximately-not-equal relation. |
| — | `NotEqual` | `(any, any*) -> boolean` | Inequality comparison (not equal to). |
| — | `NotGreater` | `(any, any*) -> boolean` | Negated greater-than relation (not greater than). |
| — | `NotGreaterNotEqual` | `(any, any*) -> boolean` | Neither greater than nor equal to. |
| — | `NotLess` | `(any, any*) -> boolean` | Negated less-than relation (not less than). |
| — | `NotLessNotEqual` | `(any, any*) -> boolean` | Neither less than nor equal to. |
| — | `NotPrecedes` | `(any, any*) -> boolean` | Negated precedes relation (does not precede). |
| — | `NotSucceeds` | `(any, any*) -> boolean` | Negated succeeds relation (does not succeed). |
| — | `NotTilde` | `(any, any*) -> boolean` | Negated similarity relation (not similar). |
| — | `NotTildeEqual` | `(any, any*) -> boolean` | Negated approximately/asymptotically-equal relation (not approximately equal). |
| — | `NotTildeFullEqual` | `(any, any*) -> boolean` | Negated isomorphism/congruence relation (not isomorphic or congruent). |
| — | `Precedes` | `(any, any*) -> boolean` | Precedes relation in an ordering (comes before). |
| — | `Same` | `(any, any*) -> boolean` | Structural identity comparison (Epsil `===`). |
| — | `Succeeds` | `(any, any*) -> boolean` | Succeeds relation in an ordering (comes after). |
| — | `Tilde` | `(any, any*) -> boolean` | Generic similarity relation (`\sim`): similar geometric figures, asymptotic equivalence, or "is distributed as". |
| — | `TildeEqual` | `(any, any*) -> boolean` | Approximately or asymptotically equal |
| — | `TildeFullEqual` | `(any, any*) -> boolean` | Indicate isomorphism, congruence and homotopic equivalence |

## Arithmetic

The [Arithmetic reference](/epsil/reference/arithmetic/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `abs` | `Abs` | `(complex \| infinity \| quantity) -> number` | Absolute value (magnitude) of a number. |
| `absArg` | `AbsArg` | `(complex \| infinity) -> tuple<+oo \| real, real>` | Tuple of magnitude and argument of a complex number. |
| — | `Add` | `(value+) -> value` | Sum of two or more values. |
| `airyAi` | `AiryAi` | `(complex \| infinity) -> number` | Airy function of the first kind |
| `airyAiPrime` | `AiryAiPrime` | `(complex \| infinity) -> number` | Derivative of the Airy function of the first kind |
| `airyBi` | `AiryBi` | `(complex \| infinity) -> number` | Airy function of the second kind |
| `airyBiPrime` | `AiryBiPrime` | `(complex \| infinity) -> number` | Derivative of the Airy function of the second kind |
| `arg` | `Arg` | `(complex \| infinity) -> number` | `arg` is an alias for `argument`, which is the preferred name. |
| `argument` | `Argument` | `(complex \| infinity) -> number` | Complex argument (phase angle) of a number, in the engine's angular unit. |
| `besselI` | `BesselI` | `(order: complex, z: complex \| infinity) -> number` | Modified Bessel function of the first kind |
| `besselJ` | `BesselJ` | `(order: complex, z: complex \| infinity) -> number` | Bessel function of the first kind |
| `besselK` | `BesselK` | `(order: complex, z: complex \| infinity) -> number` | Modified Bessel function of the second kind (Macdonald function) |
| `besselY` | `BesselY` | `(order: complex, z: complex \| infinity) -> number` | Bessel function of the second kind (Neumann function) |
| `beta` | `Beta` | `(complex \| infinity, complex \| infinity, (complex \| infinity)?, (complex \| infinity)?) -> number` | Euler beta function |
| `catalanConstant` | `CatalanConstant` | constant `real<0.915965594177219..0.9159655941772191>` = `0.915965594177219015055` | Catalan's constant G ≈ 0.9160. |
| `ceil` | `Ceil` | `(x: real \| signed_infinity \| ~oo, step: real?) -> real \| signed_infinity \| ~oo` | Rounds a number up to the next largest integer, or with a step to the least multiple of the step that is at least the number. |
| `chop` | `Chop` | `(x: T, tolerance: real<0..>?) -> T where T: number` | Replace tiny numeric values with zero. |
| `clamp` | `Clamp` | `(x: real \| signed_infinity, lower: real \| signed_infinity, upper: real \| signed_infinity) -> real \| signed_infinity` | Clamp a value to the range [lo, hi] = min(max(x, lo), hi). |
| `complex` | `Complex` | `(real: number, imaginary: number) -> complex` | Construct a complex number from real and imaginary parts. |
| `complexInfinity` | `ComplexInfinity` | constant `number` = `~oo` | Complex infinity, a single unsigned infinity in the complex plane. |
| `complexRoots` | `ComplexRoots` | `(complex, integer) -> list<number>` | All n-th complex roots of a number. |
| `conjugate` | `Conjugate` | `(T) -> T where T: number` | Complex conjugate of a number, or the pointwise conjugate of a function. |
| — | `ContinuationPlaceholder` | constant `unknown` | This symbol indicates that some elements in a collection have been omitted, for example in a long list of numbers, or in an infinite set |
| `denominator` | `Denominator` | `(number) -> nothing \| number` | Denominator of an expression |
| `digamma` | `Digamma` | `(complex \| infinity) -> number` | Digamma function, the logarithmic derivative of the gamma function |
| `dirichletBeta` | `DirichletBeta` | `(complex \| infinity) -> number` | Dirichlet beta function β(s) = Σ_&#123;n≥0&#125; (−1)^n/(2n+1)^s = 4^(−s) (ζ(s, 1/4) − ζ(s, 3/4)), entire; β(1) = π/4, β(2) = G, β(+∞) = 1. |
| `dirichletEta` | `DirichletEta` | `(complex \| infinity) -> number` | Dirichlet eta function η(s) = Σ_&#123;n≥1&#125; (−1)^(n−1)/n^s = (1 − 2^(1−s)) ζ(s), entire; η(1) = ln 2, η(+∞) = 1. |
| `distance` | `Distance` | `(list<list<number>> \| list<number> \| list<tuple> \| tuple, list<list<number>> \| list<number> \| list<tuple> \| tuple) -> number` | Euclidean distance between two points, broadcasting over a list of points. |
| — | `Divide` | `(complex \| infinity, (complex \| infinity)+) -> number` | Quotient of a numerator and one or more denominators. |
| `elementMax` | `ElementMax` | `(real \| signed_infinity, (real \| signed_infinity)+) -> real \| signed_infinity` | Element-wise maximum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. |
| `elementMin` | `ElementMin` | `(real \| signed_infinity, (real \| signed_infinity)+) -> real \| signed_infinity` | Element-wise minimum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. |
| `enclosure` | `Enclosure` | `(nan \| real \| set<real> \| signed_infinity, (nan \| real \| signed_infinity)?) -> enclosure \| nan` | A closed interval [lo, hi] that encloses one real number, with interval arithmetic. |
| `eulerGamma` | `EulerGamma` | constant `real<0.5772156649015328..0.5772156649015329>` = `0.577215664901532860607` | The Euler–Mascheroni constant γ ≈ 0.5772. |
| `exp` | `Exp` | `(number) -> number` | Natural exponential function: e^x. |
| `exp2` | `Exp2` | `(number) -> number` | Base-2 exponential: 2^x |
| `exponentialE` | `ExponentialE` | constant `real<2.718281828459045..2.718281828459046>` = `2.71828182845904523536` | Euler's number e ≈ 2.71828, the base of the natural logarithm. |
| — | `Factorial` | `(complex \| infinity) -> number` | Factorial function: the product of all positive integers less than or equal to n |
| `factorial2` | `Factorial2` | `(complex \| infinity) -> number` | Double Factorial Function |
| `floor` | `Floor` | `(x: real \| signed_infinity \| ~oo, step: real?) -> real \| signed_infinity \| ~oo` | Rounds a number down to the nearest integer, or with a step to the greatest multiple of the step that is at most the number. |
| `fract` | `Fract` | `(real \| signed_infinity \| ~oo) -> real<0..1>` | Fractional part of a number: x - floor(x) |
| `gcd` | `GCD` | `(any*) -> number` | Greatest Common Divisor |
| `gamma` | `Gamma` | `(complex \| infinity, (complex \| infinity)?, (complex \| infinity)?) -> number` | Gamma function Γ(z); with two arguments, the upper incomplete gamma Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt; with three, Γ(s, z0) − Γ(s, z1). |
| `gammaLn` | `GammaLn` | `(complex \| infinity) -> number` | Natural logarithm of the gamma function. |
| `goldenRatio` | `GoldenRatio` | constant `real<1.618033988749894..1.618033988749895>` = `1/2 * (1 + sqrt(5))` | The golden ratio φ = (1+√5)/2 ≈ 1.618. |
| `half` | `Half` | constant `rational` = `1/2` | The rational number one half (1/2). |
| `harmonicNumber` | `HarmonicNumber` | `(complex \| infinity, (complex \| infinity)?) -> number` | Harmonic number H_n = Σ_&#123;k=1&#125;^n 1/k, exact at a non-negative integer and continued by ψ(n+1) + γ; with a second argument r, the generalized H_n^(r) = Σ_&#123;k=1&#125;^n 1/k^r = ζ(r) − ζ(r, n+1). |
| `heaviside` | `Heaviside` | `(real \| signed_infinity) -> rational<0..1>` | Heaviside step function. |
| `hurwitzZeta` | `HurwitzZeta` | `(complex \| infinity, complex \| infinity, integer?) -> number` | Hurwitz zeta function ζ(s,a) = Σ_&#123;n=0&#125;^∞ (n+a)^&#123;-s&#125; |
| `im` | `Im` | `(complex \| infinity) -> number` | `im` is an alias for `imaginary`, which is the preferred name. |
| `imaginary` | `Imaginary` | `(complex \| infinity) -> number` | Imaginary part of a complex number. |
| `imaginaryUnit` | `ImaginaryUnit` | constant `imaginary` = `i` | The imaginary unit, whose square is −1. |
| — | `Indeterminate` | constant `number` = `NaN` | An input spelling of NaN. |
| `infimum` | `Infimum` | `(value*) -> number` | The greatest lower bound of numbers, collections and intervals: like `min`, but the open end of an interval is a bound too. |
| `interpret` | `Interpret` | `(any) -> any` | Interpret a notational expression as its mathematical meaning. |
| `isComposite` | `IsComposite` | `(number) -> boolean` | `isComposite(n)` returns `True` if `n` is a composite number |
| `isEven` | `IsEven` | `(number) -> boolean` | `isEven(n)` returns `True` if `n` is an even number |
| `isOdd` | `IsOdd` | `(number) -> boolean` | `isOdd(n)` returns `True` if `n` is an odd number |
| `isPrime` | `IsPrime` | `(number) -> boolean` | `isPrime(n)` returns `True` if `n` is a prime number |
| `lcm` | `LCM` | `(any*) -> number` | Least Common Multiple |
| `lambertW` | `LambertW` | `(z: complex \| infinity, branch: integer?) -> number` | Lambert W function (product logarithm) |
| `lb` | `Lb` | `(number) -> number` | Base-2 Logarithm |
| `lerchPhi` | `LerchPhi` | `(z: complex, s: complex, a: complex) -> number` | Lerch transcendent Φ(z,s,a) = Σ_&#123;k=0&#125;^∞ zᵏ(k+a)^&#123;-s&#125; |
| `lg` | `Lg` | `(number) -> number` | Base-10 Logarithm |
| `ln` | `Ln` | `(complex \| infinity, base: (complex \| infinity)?) -> complex \| infinity` | Natural Logarithm |
| `log` | `Log` | `(complex \| infinity, base: (complex \| infinity)?) -> number` | Log(z, b = 10) = Logarithm of base b |
| `log10` | `Log10` | `(number) -> number` | Base-10 Logarithm |
| `log2` | `Log2` | `(number) -> number` | Base-2 Logarithm |
| `machineEpsilon` | `MachineEpsilon` | constant `real` = `2.220446049250313e-16` | The difference between 1 and the next larger floating point number (machine epsilon). |
| `max` | `Max` | `(value*) -> number` | Maximum of two or more numbers. |
| `measurement` | `Measurement` | `(value: value, uncertainty: value) -> measurement` | A nominal value carrying a 1σ absolute uncertainty. |
| `min` | `Min` | `(value+) -> number` | Minimum of two or more numbers. |
| — | `Mod` | `(real, real, real?) -> real` | Modulo: the remainder of the floored division of x by y. |
| — | `Multiply` | `(number*) -> number` | Product of two or more values. |
| — | `NaN` | constant `number` = `NaN` | Not a Number, the result of a floating-point operation that is undefined or unrepresentable, such as 0.0/0.0, or of an exact form with no value, such as 0/0. |
| — | `Negate` | `(complex \| infinity) -> number` | Additive Inverse |
| `negativeInfinity` | `NegativeInfinity` | constant `-oo` = `-oo` | Negative infinity (−∞). |
| `numerator` | `Numerator` | `(number) -> nothing \| number` | Numerator of an expression |
| `numeratorDenominator` | `NumeratorDenominator` | `(number) -> nothing \| tuple<number, number>` | Sequence of Numerator and Denominator of an expression |
| — | `PlusMinus` | `(T, U) -> tuple<T, U> where T: value, U: value` | Plus or Minus |
| `polyGamma` | `PolyGamma` | `(order: integer, complex \| infinity) -> number` | Polygamma function, the n-th derivative of the digamma function |
| `positiveInfinity` | `PositiveInfinity` | constant `+oo` = `+oo` | Positive infinity (+∞). |
| — | `Power` | `(complex \| infinity, complex \| signed_infinity) -> number` | Exponentiation: raise a base to a power. |
| — | `PreDecrement` | `(number) -> number` | Decrement a number by one. |
| — | `PreIncrement` | `(number) -> number` | Increment a number by one. |
| `product` | `Product` | `(any, tuple*) -> number` | `product(f, (k, a, b))` computes the product of `f` for `k` from `a` to `b`; `product(L)` multiplies the elements of a collection `L`. |
| `rational` | `Rational` | `((integer, integer) -> rational) \| ((real) -> rational)` | Construct a rational number from a numerator and denominator. |
| `rationalize` | `Rationalize` | `(x: real, tolerance: real<0..>?) -> rational` | Approximate a real number by a rational. |
| `re` | `Re` | `(complex \| infinity) -> number` | `re` is an alias for `real`, which is the preferred name. |
| `real` | `Real` | `(complex \| infinity) -> number` | Real part of a complex number. |
| `remainder` | `Remainder` | `(T, T) -> T where T: number` | IEEE remainder: the signed remainder after dividing x by y, with the quotient rounded to the nearest integer (ties round toward +Infinity, matching JavaScript `Math.round`) |
| `root` | `Root` | `(complex \| infinity, complex \| infinity) -> number` | n-th root of a value. |
| `round` | `Round` | `(x: real \| signed_infinity \| ~oo, step: real?) -> real \| signed_infinity \| ~oo` | Rounds a number to the nearest integer, or with a step to the nearest multiple of the step. |
| `sign` | `Sign` | `(complex \| signed_infinity \| ~oo) -> complex` | Sign of a number: -1, 0, or 1 for a real; `z/\|z\|`, the point of the unit circle in its direction, for a complex `z`. |
| `smoothstep` | `Smoothstep` | `(edge0: real \| signed_infinity, edge1: real \| signed_infinity, x: real \| signed_infinity) -> nan \| real` | Smooth Hermite interpolation between 0 and 1 as x goes from edge0 to edge1: t²(3 − 2t) with t = Clamp((x − edge0)/(edge1 − edge0), 0, 1). |
| `sqrt` | `Sqrt` | `(complex \| infinity) -> complex \| infinity` | Square Root |
| — | `Square` | `(number) -> number` | Square of a number: x^2. |
| — | `Subtract` | `(number+) -> number` | Difference between two or more values. |
| `sum` | `Sum` | `(any, tuple*) -> number` | `sum(f, (k, a, b))` computes the sum of `f` for `k` from `a` to `b`; `sum(L)` sums the elements of a collection `L`. |
| `supremum` | `Supremum` | `(value*) -> number` | The least upper bound of numbers, collections and intervals: like `max`, but the open end of an interval is a bound too. |
| `trigamma` | `Trigamma` | `(complex \| infinity) -> number` | Trigamma function, the derivative of the digamma function |
| `truncate` | `Truncate` | `(x: real \| signed_infinity \| ~oo, step: real?) -> real \| signed_infinity \| ~oo` | Rounds a number towards zero (removes the fractional part), or with a step to the multiple of the step nearest to the number in the direction of zero. |
| `zeta` | `Zeta` | `(s: complex \| infinity, a: (complex \| infinity)?) -> number` | Riemann zeta function; with two arguments, Wolfram's generalized zeta: for a real a, ζ(s,a) = Σ_&#123;n=0&#125;^∞ \|n+a\|^&#123;-s&#125; (a term with n+a = 0 omitted, except at s = 0, where ζ(0,a) = 1/2 - a), which is HurwitzZeta(s,a) for a &gt; 0; for a complex… |
| — | `e` | constant `real<2.718281828459045..2.718281828459046>` = `e` | Euler's number e ≈ 2.71828, the base of the natural logarithm. |
| — | `i` | constant `imaginary` = `i` | The imaginary unit, whose square is −1. |

## Fractals

The [Fractals reference](/epsil/reference/fractals/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `julia` | `Julia` | `(z: complex, c: complex, maxIterations: integer) -> real` | Smooth escape-time value for a Julia set with parameter c. |
| `mandelbrot` | `Mandelbrot` | `(c: complex, maxIterations: integer) -> real` | Smooth escape-time value for the Mandelbrot set. |

## Trigonometry

The [Trigonometry reference](/epsil/reference/trigonometry/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `arccos` | `Arccos` | `(complex \| quantity) -> number` | Arccosine, the inverse cosine function. |
| `arccot` | `Arccot` | `(complex \| quantity \| signed_infinity) -> number` | Arccotangent, the inverse cotangent function. |
| `arccsc` | `Arccsc` | `(complex \| infinity \| quantity) -> number` | Arccosecant, the inverse cosecant function. |
| `arcosh` | `Arcosh` | `(complex \| quantity \| signed_infinity) -> number` | Inverse hyperbolic cosine (area hyperbolic cosine). |
| `arcoth` | `Arcoth` | `(complex \| infinity \| quantity) -> number` | Inverse hyperbolic cotangent (area hyperbolic cotangent). |
| `arcsch` | `Arcsch` | `(complex \| infinity \| quantity) -> number` | Inverse hyperbolic cosecant (area hyperbolic cosecant). |
| `arcsec` | `Arcsec` | `(complex \| infinity \| quantity) -> number` | Arcsecant, the inverse secant function. |
| `arcsin` | `Arcsin` | `(complex \| quantity) -> number` | Arcsine, the inverse sine function. |
| `arctan` | `Arctan` | `(complex \| quantity \| signed_infinity) -> number` | Inverse tangent. |
| `arctan2` | `Arctan2` | `(y: real \| signed_infinity, x: real \| signed_infinity) -> real` | Two-argument arctangent giving the angle of a vector. |
| `arsech` | `Arsech` | `(complex \| quantity \| signed_infinity) -> number` | Inverse hyperbolic secant (area hyperbolic secant). |
| `arsinh` | `Arsinh` | `(complex \| quantity \| signed_infinity) -> number` | Inverse hyperbolic sine (area hyperbolic sine). |
| `artanh` | `Artanh` | `(complex \| quantity \| signed_infinity) -> number` | Inverse hyperbolic tangent (area hyperbolic tangent). |
| `cos` | `Cos` | `(complex \| quantity) -> number` | Cosine of an angle. |
| `cosIntegral` | `CosIntegral` | `(complex \| infinity) -> number` | Cosine integral: γ + ln(x) + ∫₀ˣ (cos(t)−1)/t dt. |
| `cosh` | `Cosh` | `(complex \| quantity \| signed_infinity) -> number` | Hyperbolic cosine. |
| `coshIntegral` | `CoshIntegral` | `(complex \| infinity) -> number` | Hyperbolic cosine integral: γ + ln\|x\| + ∫₀ˣ (cosh(t)−1)/t dt. |
| `cot` | `Cot` | `(complex \| quantity) -> number` | Cotangent, the reciprocal of tangent. |
| `coth` | `Coth` | `(complex \| quantity \| signed_infinity) -> number` | Hyperbolic cotangent, the reciprocal of hyperbolic tangent. |
| `csc` | `Csc` | `(complex \| quantity) -> number` | Cosecant, the reciprocal of sine. |
| `csch` | `Csch` | `(complex \| quantity \| signed_infinity) -> number` | Hyperbolic cosecant, the reciprocal of hyperbolic sine. |
| `dms` | `DMS` | `(degrees: number, minutes: number?, seconds: number?) -> number` | Construct an angle from degrees, minutes, and seconds. |
| `degrees` | `Degrees` | `(real) -> real` | Convert an angle in degrees. |
| `fresnelC` | `FresnelC` | `(complex \| signed_infinity) -> complex` | Fresnel cosine integral. |
| `fresnelS` | `FresnelS` | `(complex \| signed_infinity) -> complex` | Fresnel sine integral. |
| `haversine` | `Haversine` | `(real) -> number` | Haversine function. |
| `hypot` | `Hypot` | `(infinity \| real, infinity \| real) -> +oo \| nan \| real` | Hypotenuse length: sqrt(x^2 + y^2). |
| `inverseFunction` | `InverseFunction` | `(function) -> function` | Inverse of a function. |
| `inverseHaversine` | `InverseHaversine` | `(real) -> number` | Inverse haversine function. |
| `pi` | `Pi` | constant `real<3.141592653589793..3.141592653589794>` = `3.14159265358979323846` | The constant π ≈ 3.14159, the ratio of a circle's circumference to its diameter. |
| `sec` | `Sec` | `(complex \| quantity) -> number` | Secant, the reciprocal of cosine. |
| `sech` | `Sech` | `(complex \| quantity \| signed_infinity) -> number` | Hyperbolic secant, the reciprocal of hyperbolic cosine. |
| `sin` | `Sin` | `(complex \| quantity) -> number` | Sine of an angle. |
| `sinIntegral` | `SinIntegral` | `(complex \| infinity) -> number` | Sine integral: ∫₀ˣ sin(t)/t dt. |
| `sinc` | `Sinc` | `(complex \| signed_infinity) -> complex` | Unnormalized sinc function: sin(x)/x with sinc(0)=1. |
| `sinh` | `Sinh` | `(complex \| quantity \| signed_infinity) -> number` | Hyperbolic sine. |
| `sinhIntegral` | `SinhIntegral` | `(complex \| infinity) -> number` | Hyperbolic sine integral: ∫₀ˣ sinh(t)/t dt. |
| `tan` | `Tan` | `(complex \| quantity) -> number` | Tangent of an angle. |
| `tanh` | `Tanh` | `(complex \| quantity \| signed_infinity) -> number` | Hyperbolic tangent. |
| `trigExpand` | `TrigExpand` | `(value) -> value` | Expand trigonometric and hyperbolic functions of sums and integer multiples of angles. |
| `trigReduce` | `TrigReduce` | `(value) -> value` | Rewrite products and integer powers of trigonometric and hyperbolic functions as a linear combination of functions of multiple angles (the inverse of TrigExpand). |
| `trigToExp` | `TrigToExp` | `(value) -> value` | Rewrite trigonometric and hyperbolic functions in terms of the complex exponential, exactly. |

## Calculus

The [Calculus reference](/epsil/reference/calculus/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `bigO` | `BigO` | `(value) -> number` | Landau big-O remainder term. |
| `circleContour` | `CircleContour` | `(center: complex, radius: real, orientation: integer?) -> expression` | Closed circle: center, positive radius, optional orientation (+1 or -1). |
| `circularIntegrate` | `CircularIntegrate` | `(function, limits+) -> number` | Closed-path integral. |
| `contourIntegrate` | `ContourIntegrate` | `(expression, variable: symbol, contour: expression) -> number` | Symbolic integral over an explicit closed contour or the real line (`realLineContour`), using the residue theorem. |
| — | `D` | `(expression, variables: symbol*) -> expression` | Symbolic partial derivative with respect to one or more variables. |
| `dSolve` | `DSolve` | `(equation: expression, dependent: symbol, variable: symbol) -> expression` | Symbolic differential equation solver. |
| `derivative` | `Derivative` | `(function, order: number*) -> function` | Derivative operator that returns a derivative function. |
| `integrate` | `Integrate` | `(function, limits+) -> list<tuple> \| number \| tensor \| tuple` | Symbolic integral with optional bounds. |
| `interpolatingFunction` | `InterpolatingFunction` | `(list<any>, number?) -> number` | Piecewise-quartic dense-output interpolant of a numeric ODE solution (produced by `ndSolveFunction`). |
| `jacobianMatrix` | `JacobianMatrix` | `(fs: any, variables: any?) -> value` | JacobianMatrix(fs, variables): the matrix of partial derivatives ∂fᵢ/∂xⱼ, one row per function and one column per variable. |
| `limit` | `Limit` | `(function, point: number, direction: number?) -> number` | Limit of a function. |
| — | `Limits` | `(index: symbol, lower: value, upper: value, step: value?) -> tuple` | Limits of a function |
| `nd` | `ND` | `(function, at: number) -> list<number> \| number \| tuple` | Numerical derivative evaluated at a point. |
| `ndSolve` | `NDSolve` | `(equation: expression, dependent: symbol, limits: symbol \| tuple, initial: number, steps: number?) -> list` | Numerical differential equation solver. |
| `ndSolveFunction` | `NDSolveFunction` | `(equation: expression, dependent: symbol, limits: symbol \| tuple, initial: number) -> function` | Numerically solve an ordinary differential equation and return the solution as an applicable function (a `Function` literal wrapping an `interpolatingFunction`), usable at any point of the integration interval. |
| `nIntegrate` | `NIntegrate` | `(function, lower: number, upper: number) -> number` | Numerical approximation of a definite integral. |
| `nLimit` | `NLimit` | `(function, point: number, direction: number?) -> number` | Numerical approximation of the limit of a function. |
| `normal` | `Normal` | `(value) -> value` | Strip Big-O remainder terms from a series, yielding the truncated polynomial. |
| `polygonContour` | `PolygonContour` | `(vertices: list<complex>, orientation: integer?) -> expression` | Simple closed polygon: a list of complex vertices in traversal order, with optional orientation override (+1 or -1). |
| `rSolve` | `RSolve` | `(equation: expression, dependent: symbol, index: symbol) -> expression` | Symbolic recurrence equation solver. |
| `realLineContour` | `RealLineContour` | `(principalValue: boolean?) -> expression` | The real axis from minus infinity to infinity. |
| `rectangleContour` | `RectangleContour` | `(lowerLeft: complex, upperRight: complex, orientation: integer?) -> expression` | Closed rectangle: lower-left and upper-right complex corners, optional orientation (+1 or -1). |
| `residue` | `Residue` | `(expression, variable: symbol, point: value) -> number` | Residue of a function at a point (the coefficient of (x-a)⁻¹ in its Laurent expansion) |
| `series` | `Series` | `(expression, variable: symbol?, point: value?, order: number?) -> number` | Taylor series expansion of an expression about a point (or an asymptotic expansion at ±∞), including Laurent, Puiseux (fractional-power), and log-aware expansions at poles and branch points. |

## Polynomials

The [Polynomials reference](/epsil/reference/polynomials/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `algebraicGenerator` | `AlgebraicGenerator` | `(list<number>) -> number` | Deprecated: `AlgebraicGenerator(List(c₀, …, cₙ))` is `PolynomialRoot(c₀ + c₁t + … + cₙtⁿ, t)`, the abstract root of an irreducible polynomial with no complex embedding selected. |
| `apart` | `Apart` | `(expr: value, variable: symbol?) -> value` | Alias for PartialFraction. |
| `cancel` | `Cancel` | `(expr: value, variable: symbol?) -> value` | Cancel common polynomial factors in the numerator and denominator of a rational expression. |
| `coefficientList` | `CoefficientList` | `(polynomial: value, variable: symbol?) -> list<value>` | Return the list of coefficients of a polynomial, from highest to lowest degree. |
| `discriminant` | `Discriminant` | `(polynomial: value, variable: symbol?) -> value` | Return the discriminant of a polynomial of degree 2, 3 or 4; another degree stays unevaluated. |
| `distribute` | `Distribute` | `(value) -> value` | Distribute multiplication over addition. |
| `expand` | `Expand` | `(value) -> value` | Expand out products and positive integer powers. |
| `expandAll` | `ExpandAll` | `(value) -> value` | Recursively expand out products and positive integer powers, including those in the arguments of other functions. |
| `factor` | `Factor` | `(expr: value, variable: symbol?, generator: value?) -> value` | Factor a polynomial expression into a product of irreducible factors. |
| `partialFraction` | `PartialFraction` | `(expr: value, variable: symbol?) -> value` | Decompose a rational expression into partial fractions. |
| `piecewiseExpand` | `PiecewiseExpand` | `(value) -> value` | `piecewiseExpand(expr)` rewrites `abs`, `sign`, `min`, `max` and `heaviside`, wherever they occur in `expr`, into a conditional value `Which(c1, v1, …, True, vd)`. |
| `polynomial` | `Polynomial` | `(coefficients: list<value>, variable: symbol) -> value` | Construct a polynomial from a list of coefficients (highest to lowest degree) and a variable. |
| `polynomialDegree` | `PolynomialDegree` | `(polynomial: value, variable: symbol?) -> integer` | Return the degree of a polynomial with respect to a variable. |
| `polynomialGCD` | `PolynomialGCD` | `(a: value, b: value, variable: symbol?) -> value` | Return the greatest common divisor of two polynomials, with leading coefficient 1. |
| `polynomialQuotient` | `PolynomialQuotient` | `(dividend: value, divisor: value, variable: symbol?) -> value` | Return the quotient of polynomial division of dividend by divisor. |
| `polynomialRemainder` | `PolynomialRemainder` | `(dividend: value, divisor: value, variable: symbol?) -> value` | Return the remainder of polynomial division of dividend by divisor. |
| `polynomialRoots` | `PolynomialRoots` | `(polynomial: value, variable: symbol?) -> set<value>` | Return the set of the roots of a polynomial expression. |
| `resultant` | `Resultant` | `(a: value, b: value, variable: symbol?) -> value` | Return the resultant of two polynomials with respect to a variable. |
| `together` | `Together` | `(value) -> value` | Combine rational expressions into a single fraction over a common denominator. |

## Combinatorics

The [Combinatorics reference](/epsil/reference/combinatorics/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `bellNumber` | `BellNumber` | `(n: integer, x: number?) -> number` | Compute the Bell number B(n), the number of partitions of a set of n elements. |
| `binomial` | `Binomial` | `(n: complex \| infinity, k: complex \| infinity) -> number` | Compute the binomial coefficient C(n, k) = n! / (k! |
| `cartesianProduct` | `CartesianProduct` | `(set<any>+) -> set` | Return the Cartesian product of input sets. |
| `choose` | `Choose` | `(n: complex \| infinity, m: complex \| infinity) -> number` | Binomial coefficient: number of ways to choose k items from n. |
| `combinations` | `Combinations` | `((xs: S, k: integer) -> list<string> where S: string) & ((xs: collection, k: integer) -> list<list>)` | Return all k-element combinations of a collection. |
| `fibonacci` | `Fibonacci` | `(n: integer, x: number?) -> number` | Compute the nth Fibonacci number. |
| `integerPartitions` | `IntegerPartitions` | `(n: integer, k: any?, parts: list<integer>?, count: integer?) -> list<list<integer>>` | Return the partitions of n, each a list of its positive parts in non-increasing order, in reverse lexicographic order. |
| `multinomial` | `Multinomial` | `(integer+) -> integer` | Compute the multinomial coefficient for multiple integers. |
| `permutations` | `Permutations` | `((xs: S, k: integer?) -> list<string> where S: string) & ((n: integer<0..>, k: integer?) -> list<list<integer>>) & ((xs: collection, k: integer?) -> list<list>)` | Return all permutations of length k (default full length) of a collection. |
| `pochhammer` | `Pochhammer` | `(x: complex \| infinity, n: complex \| infinity) -> number` | Rising factorial (Pochhammer symbol) (x)_n = x(x+1)…(x+n-1). |
| `powerSet` | `PowerSet` | `(set<any>) -> set` | Return the power set of a set (set of all subsets). |
| `subfactorial` | `Subfactorial` | `(integer) -> integer` | Compute the number of derangements (subfactorial) of n items. |

## Number theory

The [Number theory reference](/epsil/reference/number-theory/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `algebraicNumberNorm` | `AlgebraicNumberNorm` | `(number) -> number` | The norm of a over ℚ in the field ℚ(a): (−1)ᵈ times its minimal polynomial’s constant term over its leading one. |
| `algebraicNumberTrace` | `AlgebraicNumberTrace` | `(number) -> number` | The trace of a over ℚ in the field ℚ(a): minus its minimal polynomial’s second coefficient over its leading one. |
| `bernoulliB` | `BernoulliB` | `(integer) -> rational` | Return the nth Bernoulli number Bₙ as an exact rational, using the convention B₁ = -1/2. |
| `carmichaelLambda` | `CarmichaelLambda` | `(integer) -> integer` | Return the Carmichael function λ(n) (the reduced totient): the smallest positive integer `m` such that `a^m ≡ 1 (mod n)` for every `a` coprime to `n`. |
| `catalanNumber` | `CatalanNumber` | `(real) -> number` | Return the nth Catalan number `C(n) = (2n)! / ((n+1)! · n!)`: 1, 1, 2, 5, 14, 42, … Defined for `n ≥ 0`. |
| `chineseRemainder` | `ChineseRemainder` | `(residues: collection<any>, moduli: collection<any>, lower: integer?) -> integer` | Solve a system of simultaneous congruences: return the smallest non-negative integer `x` such that `x ≡ residues[i] (mod moduli[i])` for every `i`. |
| `continuedFraction` | `ContinuedFraction` | `(x: real, count: integer?) -> list<integer \| list<integer>>` | Return the continued-fraction expansion of `x` as a list of integer terms `[a0, a1, …]`. |
| `digitCount` | `DigitCount` | `(n: integer, base: integer?, digit: integer?, length: integer?) -> integer \| list<integer>` | Count digits of `n` in the given `base` (default 10); the sign of `n` is ignored. |
| `digitSum` | `DigitSum` | `(n: integer, base: integer?, count: integer?) -> integer` | Return the sum of the digits of `n` in the given `base` (default 10). |
| `dirichletCharacter` | `DirichletCharacter` | `(k: integer, j: integer, n: integer) -> number` | The Dirichlet character χ_j(n) modulo `k`, the `j`-th of the φ(k) characters (Wolfram's indexing, `j = 1` the principal character). |
| `dirichletL` | `DirichletL` | `(k: integer, j: integer, s: number) -> number` | The Dirichlet L-function L(s, χ) = Σ χ(n)/nˢ (n ≥ 1) of the character χ_j modulo `k` (`dirichletCharacter(k, j, ·)`): `k^(−s) Σ_{r=1}^{k} χ(r) ζ(s, r/k)`. |
| `divides` | `Divides` | `(integer, integer) -> boolean` | `divides(a, b)` returns `True` if `a` divides `b` (i.e. |
| `divisorSigma` | `DivisorSigma` | `(k: integer, n: integer) -> rational` | The divisor function σ_k(n) = Σ_&#123;d \| n&#125; dᵏ over the positive divisors of `n`. σ₀ counts divisors, σ₁ sums them. |
| `divisors` | `Divisors` | `(integer) -> list<integer>` | Return the sorted list of positive divisors of an integer `n`. |
| `eulerE` | `EulerE` | `(n: integer, x: number?) -> number` | Return the nth Euler number Eₙ (1, 0, -1, 0, 5, 0, -61, …) for `eulerE(n)`, or the Euler polynomial Eₙ(x) for `eulerE(n, x)`. |
| `eulerPhi` | `EulerPhi` | `(integer) -> integer` | `eulerPhi` is an alias for `totient`, which is the preferred name. |
| `eulerian` | `Eulerian` | `(n: integer, m: integer) -> integer` | Eulerian number A(n, m): number of permutations of &#123;1..n&#125; with exactly m ascents. |
| `extendedGCD` | `ExtendedGCD` | `(integer, integer, integer*) -> tuple` | Return the extended GCD of `a` and `b` as a tuple `(g, x, y)` where `g = gcd(a, b)` is non-negative and `a·x + b·y = g` (Bézout coefficients). |
| `factorInteger` | `FactorInteger` | `(rational) -> list<tuple<integer, integer>>` | Return the prime factorization of an integer `n` as a list of `[prime, exponent]` tuples, ordered by ascending prime. |
| `fromContinuedFraction` | `FromContinuedFraction` | `(collection<any>) -> number` | Reconstruct the value of a continued fraction given its list of integer terms `[a0, a1, …]`. |
| `fromDigits` | `FromDigits` | `(digits: collection<any>, base: number?) -> number` | Reconstruct a number from its digits (most-significant first) in the given `base` (default 10). |
| `integerDigits` | `IntegerDigits` | `(n: integer, base: integer?, length: integer?) -> list<integer>` | Return the digits of `n` in the given `base` (default 10), most-significant first. |
| `integerSqrt` | `IntegerSqrt` | `(integer) -> integer` | Return the integer square root of `n`, i.e. the largest integer `m` such that `m² ≤ n`. |
| `isAbundant` | `IsAbundant` | `(integer) -> boolean` | True if n is an abundant number (sum of divisors &gt; 2n). |
| `isAlgebraicInteger` | `IsAlgebraicInteger` | `(number) -> boolean` | Whether a is an algebraic integer: a root of a monic polynomial over ℤ. |
| `isCenteredSquare` | `IsCenteredSquare` | `(integer) -> boolean` | True if n is a centered square number, n = t² + (t + 1)² for an integer t ≥ 0: 1, 5, 13, 25, 41, ... |
| `isHappy` | `IsHappy` | `(integer) -> boolean` | True if n is a happy number, a number which eventually reaches 1 when the number is replaced by the sum of the square of each digit |
| `isOctahedral` | `IsOctahedral` | `(integer) -> boolean` | True if n is an octahedral number. |
| `isPerfect` | `IsPerfect` | `(integer) -> boolean` | Returns "True" if n is a perfect number, a positive integer which equals the sum of all its divisors. |
| `isPerfectPower` | `IsPerfectPower` | `(integer) -> boolean` | Return `"True"` if `n` is a perfect power `a^b` for integers `a` and `b ≥ 2` (a negative `n` requires an odd exponent). |
| `isSquare` | `IsSquare` | `(integer) -> boolean` | True if n is a perfect square. |
| `isSquareFree` | `IsSquareFree` | `(rational) -> boolean` | Return `"True"` if `n` is square-free (not divisible by any perfect square &gt; 1). |
| `isTriangular` | `IsTriangular` | `(integer) -> boolean` | True if n is a triangular number. |
| `jacobiSymbol` | `JacobiSymbol` | `(a: integer, n: integer) -> integer` | The Jacobi symbol (a/n) for an odd `n > 0`. |
| `legendreSymbol` | `LegendreSymbol` | `(a: integer, p: integer) -> integer` | The Legendre symbol (a/p) for an odd prime `p`. |
| `lucas` | `Lucas` | `(integer) -> integer` | `lucas` is an alias for `lucasL`, which is the preferred name. |
| `lucasL` | `LucasL` | `(integer) -> integer` | Return the nth Lucas number: `lucasL(0)` is 2, `lucasL(1)` is 1, and `LucasL(n) = LucasL(n-1) + LucasL(n-2)`. |
| `minimalPolynomial` | `MinimalPolynomial` | `(a: number, variable: any) -> expression` | The minimal polynomial of the algebraic number a in x: primitive over ℤ, positive leading coefficient. |
| `modularInverse` | `ModularInverse` | `(a: integer, modulus: integer) -> integer` | Return the modular multiplicative inverse of `a` modulo `m`: the integer `x` with `a·x ≡ 1 (mod m)`. |
| `moebiusMu` | `MoebiusMu` | `(integer) -> integer` | Return the Möbius function μ(n): 0 if `n` is divisible by a perfect square &gt; 1, otherwise (-1) raised to the number of distinct prime factors. |
| `multiplicativeOrder` | `MultiplicativeOrder` | `(a: integer, modulus: integer, residues: list<integer>?) -> integer` | The multiplicative order of `a` modulo `n`: the smallest `k > 0` such that `a^k ≡ 1 (mod n)`. |
| `nPartition` | `NPartition` | `(integer) -> integer` | Number of integer partitions of n, for n ≥ 0; it is 0 for n &lt; 0. |
| `nextPrime` | `NextPrime` | `(n: real, k: integer?) -> integer` | Return the smallest prime greater than `n`. |
| `notDivides` | `NotDivides` | `(integer, integer) -> boolean` | `notDivides(a, b)` returns `True` if `a` does not divide `b`, corresponding to the notation `a ∤ b`. |
| `nthPrime` | `NthPrime` | `(integer) -> integer` | Return the nth prime number (1-based): `nthPrime(1)` is 2, `nthPrime(2)` is 3, … |
| `numberFieldDiscriminant` | `NumberFieldDiscriminant` | `(number) -> integer` | The discriminant of the field ℚ(a): of its ring of integers. |
| `numberFieldIntegralBasis` | `NumberFieldIntegralBasis` | `(number) -> list<number>` | A ℤ-basis of the ring of integers of ℚ(a), written on the powers of the generator read (the radical or root a is written in), as Wolfram writes it. |
| `numberFieldSignature` | `NumberFieldSignature` | `(number) -> list<integer>` | The signature (r₁, r₂) of ℚ(a): its real embeddings and its pairs of complex ones. |
| `partitionsP` | `PartitionsP` | `(integer) -> integer` | `partitionsP` is an alias for `nPartition`, which is the preferred name. |
| `partitionsQ` | `PartitionsQ` | `(integer) -> integer` | Number of partitions of n into distinct parts (equivalently, into odd parts), q(n); it is 0 for n &lt; 0. |
| `polynomialRoot` | `PolynomialRoot` | `(polynomial: any, variable: any, index: integer?) -> number` | The root of the polynomial p in the variable x (bound, as in Wolfram's Root[Function[x, p], k]). |
| `powerMod` | `PowerMod` | `(base: list<rational> \| rational, exponent: list<rational> \| rational, modulus: integer \| list<integer>) -> integer \| list<integer>` | Return `a^b mod m` (modular exponentiation). |
| `powerModList` | `PowerModList` | `(base: list<rational> \| rational, exponent: list<rational> \| rational, modulus: integer \| list<integer>) -> list<integer> \| list<list<integer>>` | Return the sorted list of every `x` in [0, m) with `x^r ≡ a^s (mod m)`, for the exponent `s/r`. |
| `primeFactors` | `PrimeFactors` | `(integer) -> list<integer>` | Return the sorted list of distinct prime factors of an integer `n`. |
| `primeNu` | `PrimeNu` | `(integer) -> integer` | Return ω(n), the number of distinct prime factors of `n`. |
| `primeNumber` | `PrimeNumber` | `(integer) -> integer` | The nth prime number. |
| `primeOmega` | `PrimeOmega` | `(integer) -> integer` | Return Ω(n), the number of prime factors of `n` counted with multiplicity. |
| `primePi` | `PrimePi` | `(real) -> integer` | Return π(n), the prime-counting function: the number of primes less than or equal to `n`. |
| `primitiveRoot` | `PrimitiveRoot` | `(integer) -> integer` | The smallest primitive root modulo `n` (a generator of the multiplicative group of integers mod `n`), or undefined if none exists (which happens unless `n` is 1, 2, 4, pᵏ, or 2pᵏ for an odd prime p). |
| `primitiveRootList` | `PrimitiveRootList` | `(integer) -> list<integer>` | The sorted list of all primitive roots modulo `n`: the generators of the multiplicative group of integers mod `n`. |
| `radical` | `Radical` | `(integer) -> integer` | Return the radical of `n` (its square-free kernel): the product of its distinct prime factors. |
| `randomPrime` | `RandomPrime` | `(integer, integer?) random -> integer` | Return a random prime. |
| `rationalReconstruction` | `RationalReconstruction` | `(a: integer, modulus: integer) -> rational` | The rational `p/q` with `p ≡ a·q (mod m)` and `\|p\|, q ≤ ⌊√((m − 1)/2)⌋`, the unique such fraction in lowest terms when it exists (Wang's algorithm). |
| `sigma0` | `Sigma0` | `(integer) -> integer` | Number of positive divisors of n. |
| `sigma1` | `Sigma1` | `(integer) -> integer` | Sum of positive divisors of n. |
| `sigmaMinus1` | `SigmaMinus1` | `(integer) -> rational` | Sum of reciprocals of positive divisors of n. |
| `stirling` | `Stirling` | `(n: integer, m: integer) -> integer` | Stirling number of the second kind S(n, m): ways to partition n elements into m non-empty subsets. |
| `stirlingS1` | `StirlingS1` | `(n: integer, m: integer) -> integer` | Signed Stirling number of the first kind s(n, m): the coefficient of x^m in the falling factorial x(x−1)…(x−n+1). |
| `stirlingS2` | `StirlingS2` | `(n: integer, m: integer) -> integer` | `stirlingS2` is an alias for `stirling`, which is the preferred name. |
| `totient` | `Totient` | `(integer) -> integer` | Euler's totient function φ(n): count of positive integers ≤ n that are coprime to n, for n ≥ 1; φ(0) = 0 and φ(−n) = φ(n). |

## Special functions

The [Special functions reference](/epsil/reference/special-functions/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `agm` | `AGM` | `(complex \| infinity, (complex \| infinity)?) -> number` | Arithmetic-geometric mean. |
| `appellF1` | `AppellF1` | `(a: complex \| infinity, b1: complex \| infinity, b2: complex \| infinity, c: complex \| infinity, x: complex \| infinity, y: complex \| infinity) -> number` | Appell hypergeometric function F₁(a; b₁, b₂; c; x, y), double series for \|x\|, \|y\| &lt; 1. |
| `barnesG` | `BarnesG` | `(complex \| infinity) -> number` | The Barnes G-function, the double gamma function G(z+1) = Γ(z)·G(z), G(1) = 1. |
| `chebyshevT` | `ChebyshevT` | `(degree: integer, x: complex) -> number` | Chebyshev polynomial of the first kind Tₙ(x), with Tₙ(cos θ) = cos(nθ). |
| `chebyshevU` | `ChebyshevU` | `(degree: integer, x: complex) -> number` | Chebyshev polynomial of the second kind Uₙ(x), with Uₙ(cos θ) = sin((n+1)θ)/sin θ. |
| `clausenCl` | `ClausenCl` | `(n: integer, theta: real) -> number` | Clausen function Clₙ(θ) of integer order n ≥ 1 and real θ: Im Liₙ(e^&#123;iθ&#125;) = Σ sin(kθ)/kⁿ for even n, Re Liₙ(e^&#123;iθ&#125;) = Σ cos(kθ)/kⁿ for odd n. |
| `dedekindEta` | `DedekindEta` | `(complex \| infinity) -> number` | Dedekind eta function η(τ), Im(τ) &gt; 0. |
| `eisensteinE` | `EisensteinE` | `(s: number, tau: complex \| infinity) -> number` | Normalized Eisenstein series Eₛ(τ) of even weight s ≥ 2, Im(τ) &gt; 0. |
| `ellipticE` | `EllipticE` | `(complex \| infinity, (complex \| infinity)?) -> number` | Elliptic integral of the second kind: complete E(m) with one argument, incomplete E(φ\|m) with two (amplitude first, parameter convention m = k², as in Mathematica). |
| `ellipticF` | `EllipticF` | `(phi: complex \| infinity, m: complex \| infinity) -> number` | Incomplete elliptic integral of the first kind F(φ\|m) (amplitude first, parameter convention m = k², as in Mathematica). |
| `ellipticK` | `EllipticK` | `(complex \| infinity) -> number` | Complete elliptic integral of the first kind K(m), parameter convention m = k². |
| `ellipticPi` | `EllipticPi` | `(complex \| infinity, complex \| infinity, (complex \| infinity)?) -> number` | Elliptic integral of the third kind: complete Π(n\|m) with two arguments, incomplete Π(n; φ\|m) with three (characteristic first, amplitude second, parameter convention m = k², as in Mathematica). |
| `expIntegralEi` | `ExpIntegralEi` | `(complex \| infinity) -> number` | Exponential integral Ei(x) = PV ∫_&#123;−∞&#125;^x eᵗ/t dt. |
| `hermiteH` | `HermiteH` | `(degree: integer, x: complex) -> number` | Hermite polynomial Hₙ(x) of the physicists' convention, with H₀ = 1, H₁ = 2x and Hₙ₊₁ = 2x Hₙ − 2n Hₙ₋₁. |
| `hypergeometric1F1` | `Hypergeometric1F1` | `(a: complex \| infinity, b: complex \| infinity, z: complex \| infinity) -> number` | Kummer confluent hypergeometric function ₁F₁(a; b; z) = M(a, b, z). |
| `hypergeometric2F1` | `Hypergeometric2F1` | `(a: complex \| infinity, b: complex \| infinity, c: complex \| infinity, z: complex \| infinity) -> number` | Gauss hypergeometric function ₂F₁(a, b; c; z). |
| `jacobiTheta` | `JacobiTheta` | `(j: number, z: complex \| infinity, tau: complex \| infinity, r: number?) -> number` | Jacobi theta function θⱼ(z, τ), j ∈ &#123;1,2,3,4&#125;, nome q = e^&#123;iπτ&#125; (Fungrim convention). |
| `laguerreL` | `LaguerreL` | `(degree: integer, x: complex) -> number` | Laguerre polynomial Lₙ(x) = Σₖ (−1)ᵏ C(n, k) xᵏ/k!. |
| `legendreP` | `LegendreP` | `(degree: integer, x: complex) -> number` | Legendre polynomial Pₙ(x), with P₀ = 1, P₁ = x and (n+1)Pₙ₊₁ = (2n+1)x Pₙ − n Pₙ₋₁. |
| `logBarnesG` | `LogBarnesG` | `(complex \| infinity) -> number` | The logarithm of the Barnes G-function, continued analytically with `logGamma`: its imaginary part is not principal on the negative axis. −∞ at the zeros of G, the non-positive integers. |
| `logGamma` | `LogGamma` | `(complex \| infinity) -> number` | The analytic continuation of ln Γ(z), with its branch cut on (−∞, 0]; not `gammaLn`, the principal logarithm of Γ(z), which jumps by 2πi across the zeros of Im Γ. |
| `logIntegral` | `LogIntegral` | `(complex \| infinity) -> number` | Logarithmic integral li(x) = PV ∫₀ˣ dt/ln t = Ei(ln x). |
| `polyLog` | `PolyLog` | `(s: complex \| infinity, z: complex \| infinity) -> number` | Polylogarithm Liₛ(z) = Σ_&#123;k≥1&#125; zᵏ/kˢ, at any real or complex order s. |
| `stieltjesGamma` | `StieltjesGamma` | `(n: integer, a: number?) -> number` | Generalized Stieltjes constants γₙ(a), the Laurent coefficients of ζ(s, a) at s = 1: ζ(s, a) = 1/(s−1) + Σₙ (−1)ⁿ γₙ(a)(s−1)ⁿ/n!. |

## Linear algebra

The [Linear algebra reference](/epsil/reference/linear-algebra/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `adjugateMatrix` | `AdjugateMatrix` | `(matrix) -> matrix` | Adjugate (classical adjoint) of a square matrix. |
| `characteristicPolynomial` | `CharacteristicPolynomial` | `(matrix, variable: any?) -> expression` | Characteristic polynomial det(x·I − A) of a square matrix (monic). |
| `choleskyDecomposition` | `CholeskyDecomposition` | `(matrix) -> matrix` | Cholesky decomposition of a positive-definite matrix. |
| `conjugateTranspose` | `ConjugateTranspose` | `(value, axis1: integer?, axis2: integer?) -> value` | Conjugate transpose (Hermitian adjoint) of a matrix or tensor. |
| `cross` | `Cross` | `(tuple \| vector, tuple \| vector) -> tuple \| vector` | Cross product of two 3-vectors. |
| `degree` | `Degree` | `(value) -> integer` | Degree of an object |
| `det` | `Det` | `(matrix) -> number` | `det` is an alias for `determinant`, which is the preferred name. |
| `determinant` | `Determinant` | `(matrix) -> number` | Determinant of a square matrix. |
| `diagonal` | `Diagonal` | `(value) -> value` | Extract a matrix diagonal or build a diagonal matrix. |
| `dimension` | `Dimension` | `(value) -> integer` | Return the dimension of a vector space: the number of elements of a vector, matrix or tensor, the product of the dimensions of the two objects of a `hom`, or the number of basis vectors of a `kernel` written as the argument. |
| `dot` | `Dot` | `(list<tuple> \| matrix \| tuple \| vector, list<tuple> \| matrix \| tuple \| vector) -> value` | Dot product (vector inner product) or matrix product. |
| `eigen` | `Eigen` | `(matrix) -> tuple` | Eigenvalue-eigenvector decomposition of a square matrix. |
| `eigenvalues` | `Eigenvalues` | `(matrix) -> list` | Eigenvalues of a square matrix. |
| `eigenvectors` | `Eigenvectors` | `(matrix) -> list` | Eigenvectors of a square matrix. |
| `fill` | `Fill` | `(value: any, integer+) -> list` | List or tensor with each element equal to a value. |
| `flatten` | `Flatten` | `(value, depth: (+oo \| integer)?) -> list` | Flatten a tensor or collection into a list. |
| `hadamardProduct` | `HadamardProduct` | `(matrix \| vector, matrix \| vector) -> matrix \| vector` | Hadamard (element-wise) product of two vectors or matrices of the same shape. |
| `hom` | `Hom` | `(value*) -> value` | Hom-set of morphisms between objects |
| `identityMatrix` | `IdentityMatrix` | `(integer) -> matrix` | n-by-n identity matrix. |
| `inverse` | `Inverse` | `(matrix) -> matrix` | Multiplicative inverse of a square matrix. |
| `isDiagonal` | `IsDiagonal` | `(value) -> boolean` | Whether the matrix is diagonal (all off-diagonal entries are zero). |
| `isSquareMatrix` | `IsSquareMatrix` | `(value) -> boolean` | Whether the value is a square matrix. |
| `isSymmetric` | `IsSymmetric` | `(value) -> boolean` | Whether the matrix is symmetric (A equals its transpose). |
| `kernel` | `Kernel` | `(value) -> list` | Return a basis of the kernel (null space) of a matrix, as a list of vectors; the list is empty when the columns are independent. |
| `luDecomposition` | `LUDecomposition` | `(matrix) -> tuple` | Return the LU decomposition of a square matrix A: the tuple (P, L, U) with P·A = L·U, where P is a permutation matrix, L is lower triangular with ones on its diagonal and U is upper triangular. |
| `linearSolve` | `LinearSolve` | `(matrix, matrix \| vector) -> value` | Return the solution x of the linear system A·x = b, of the shape of b. |
| `matrix` | `Matrix` | `(matrix, delimiters: string?, format: string?) -> matrix` | Return the matrix whose rows are the elements of a list of lists. |
| `matrixMultiply` | `MatrixMultiply` | `(matrix \| vector, matrix \| vector) -> matrix \| number \| vector` | Return the matrix product of two matrices, of a matrix and a vector, or of two vectors (their inner product). |
| `matrixPower` | `MatrixPower` | `(matrix, real) -> matrix` | Square matrix raised to a power. |
| `matrixRank` | `MatrixRank` | `(value) -> integer` | Rank of a matrix (number of linearly independent rows/columns). |
| `norm` | `Norm` | `(list<tuple> \| number \| tensor \| tuple, (+oo \| real \| string)?) -> +oo \| nan \| real` | Return the norm of a vector, a matrix or a point, or the absolute value of a number. |
| `ones` | `Ones` | `(integer+) -> list` | Return a list, or a tensor of any rank, whose every element is 1. |
| `onesMatrix` | `OnesMatrix` | `(rows: integer, columns: integer?) -> matrix` | Return a matrix of the given size whose every element is 1. |
| `pseudoInverse` | `PseudoInverse` | `(matrix) -> matrix` | Return the Moore-Penrose pseudoinverse of a matrix: an n×m matrix for an m×n matrix. |
| `qrDecomposition` | `QRDecomposition` | `(matrix) -> tuple` | Return the QR decomposition of an m×n matrix A: the tuple (Q, R) with A = Q·R, where Q is an m×m orthogonal matrix and R is an m×n upper triangular matrix. |
| `rank` | `Rank` | `(value) -> integer` | The length of the shape of the expression. |
| `reshape` | `Reshape` | `(value, tuple) -> value` | Return the elements of a tensor or collection, in row-major order, arranged in a target shape. |
| `rowReduce` | `RowReduce` | `(matrix) -> matrix` | Return the reduced row echelon form (RREF) of a matrix. |
| `svd` | `SVD` | `(matrix) -> tuple` | Return the singular value decomposition of an m×n matrix A, computed in machine precision: the tuple (U, S, V) with A = U·S·Vᵀ, where U and V are orthogonal and S is diagonal. |
| `shape` | `Shape` | `(value) -> tuple` | Return the shape tuple of an expression. |
| `singularValues` | `SingularValues` | `(matrix) -> list` | The singular values of a matrix, sorted in descending order (including any zero values). |
| `trace` | `Trace` | `(number \| tensor, axis1: integer?, axis2: integer?) -> number \| tensor` | Return the sum of the diagonal elements of a square matrix, or the tensor of the traces over two axes of a tensor. |
| `transpose` | `Transpose` | `(value, axis1: integer?, axis2: integer?) -> value` | Transpose a matrix or swap two tensor axes. |
| `vector` | `Vector` | `(any+) -> vector` | Return the column vector of the arguments: an n×1 matrix with one argument in each row. |
| `zeroMatrix` | `ZeroMatrix` | `(rows: integer, columns: integer?) -> matrix` | Return a matrix of the given size whose every element is 0. |
| `zeros` | `Zeros` | `(integer+) -> list` | Return a list, or a tensor of any rank, whose every element is 0. |

## Statistics

The [Statistics reference](/epsil/reference/statistics/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `betaDistribution` | `BetaDistribution` | `(real<0<..>, real<0<..>) -> expression<BetaDistribution>` | Beta distribution with shape parameters α and β, on the interval [0, 1]. |
| `betaRegularized` | `BetaRegularized` | `(complex \| infinity, complex \| infinity, complex \| infinity, (complex \| infinity)?) -> number` | Regularized incomplete beta function I_x(a, b); with four arguments, I_z1(a, b) − I_z0(a, b) |
| `binCounts` | `BinCounts` | `(xs: collection<number>, bins: list<number> \| number) -> list<number>` | Count the number of elements falling into each bin. |
| `binomialDistribution` | `BinomialDistribution` | `(n: integer<0..>, p: real<0..1>) -> expression<BinomialDistribution>` | Binomial distribution: number of successes in n independent trials, each with success probability p. |
| `cdf` | `CDF` | `(distribution, real \| signed_infinity) -> nan \| real<0..1>` | Cumulative distribution function P(X ≤ x) of a distribution. |
| `chiSquareDistribution` | `ChiSquareDistribution` | `(real<0<..>) -> expression<ChiSquareDistribution>` | Chi-square distribution with k degrees of freedom (k &gt; 0, not necessarily an integer). |
| `correlation` | `Correlation` | `(xs: collection<number \| tuple>, ys: collection<number>?) -> nan \| real<-1..1>` | Pearson's correlation coefficient of paired data, given as two equal-length collections or one collection of (x, y) pairs. |
| `covariance` | `Covariance` | `(xs: collection<number \| tuple>, ys: collection<number>?) -> nan \| real` | Sample covariance (n − 1 denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs. |
| `erf` | `Erf` | `(complex \| signed_infinity, (complex \| signed_infinity)?) -> complex` | Gauss error function; with two arguments, Erf(z1) − Erf(z0) |
| `erfInv` | `ErfInv` | `(complex \| infinity, (complex \| infinity)?) -> number` | Inverse of the error function; with two arguments, the x with Erf(z0, x) = z, that is ErfInv(z + Erf(z0)) |
| `erfc` | `Erfc` | `(complex \| signed_infinity) -> complex` | Complementary error function: 1 - Erf(x) |
| `erfi` | `Erfi` | `(complex \| signed_infinity) -> complex \| signed_infinity` | Imaginary error function: -i·Erf(i·x) |
| `exponentialDistribution` | `ExponentialDistribution` | `(real<0<..>) -> expression<ExponentialDistribution>` | Exponential distribution with rate parameter λ. |
| `fRatioDistribution` | `FRatioDistribution` | `(real<0<..>, real<0<..>) -> expression<FRatioDistribution>` | Snedecor's F distribution with d₁ degrees of freedom in the numerator and d₂ in the denominator. |
| `findFit` | `FindFit` | `(data: any, model: any, params: any, vars: any, options: dictionary?) -> dictionary` | Nonlinear least-squares fit of a model to data. |
| `gammaDistribution` | `GammaDistribution` | `(shape: real<0<..>, scale: real<0<..>) -> expression<GammaDistribution>` | Gamma distribution with shape α and scale θ: the density is x^(α−1)·e^(−x/θ)/(Γ(α)·θ^α) for x &gt; 0. |
| `gammaRegularized` | `GammaRegularized` | `(complex \| infinity, complex \| infinity, (complex \| infinity)?) -> number` | Regularized upper incomplete gamma function Q(a, z) = Γ(a, z)/Γ(a); with three arguments, Q(a, z0) − Q(a, z1) |
| `geometricDistribution` | `GeometricDistribution` | `(real<0..1>) -> expression<GeometricDistribution>` | Geometric distribution: the number of failures before the first success, each trial a success with probability p (0 &lt; p ≤ 1). |
| `histogram` | `Histogram` | `(xs: collection<number>, bins: list<number> \| number) -> list<tuple<number, integer>>` | Compute a histogram of the values in a collection. |
| `hypergeometricDistribution` | `HypergeometricDistribution` | `(draws: integer<0..>, successes: integer<0..>, population: integer<0..>) -> expression<HypergeometricDistribution>` | Hypergeometric distribution: the number of successes in n draws without replacement from a population of N items of which K are successes (0 ≤ n ≤ N, 0 ≤ K ≤ N). |
| `interquartileRange` | `InterquartileRange` | `((collection<number> \| number)+) -> +oo \| nan \| real<0..>` | Interquartile range (Q3 - Q1) of a collection. |
| `kurtosis` | `Kurtosis` | `((collection<number> \| number)+) -> nan \| real` | Kurtosis of a collection of numbers. |
| `linearRegression` | `LinearRegression` | `(any+) -> tuple<number, number>` | Least-squares linear fit b0 + b1·x. |
| `mean` | `Mean` | `((collection<number> \| distribution \| number)+) -> number` | Arithmetic mean (average) of a collection of numbers. |
| `median` | `Median` | `((collection<number> \| number)+) -> nan \| real \| signed_infinity` | Median of a collection of numbers. |
| `mode` | `Mode` | `((collection<number> \| number)+) -> nan \| real \| signed_infinity` | Most frequently occurring value in a collection. |
| `negativeBinomialDistribution` | `NegativeBinomialDistribution` | `(n: integer<1..>, p: real<0..1>) -> expression<NegativeBinomialDistribution>` | Negative binomial distribution: the number of failures before the n-th success (n a positive integer), each trial a success with probability p (0 &lt; p ≤ 1). |
| `normalDistribution` | `NormalDistribution` | `(mu: real, sigma: real<0<..>) -> expression<NormalDistribution>` | Normal (Gaussian) distribution with mean μ and standard deviation σ. |
| `pdf` | `PDF` | `(distribution, real \| signed_infinity) -> nan \| real<0..>` | Probability density (continuous) or mass (discrete) function of a distribution, evaluated at x. |
| `poissonDistribution` | `PoissonDistribution` | `(real<0<..>) -> expression<PoissonDistribution>` | Poisson distribution with rate parameter λ. |
| `polynomialFit` | `PolynomialFit` | `(any+) -> list<number>` | Least-squares polynomial fit of the given degree. |
| `populationCovariance` | `PopulationCovariance` | `(xs: collection<number \| tuple>, ys: collection<number>?) -> nan \| real` | Population covariance (n denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs. |
| `populationStandardDeviation` | `PopulationStandardDeviation` | `((collection<number> \| number)+) -> nan \| real<0..>` | Population Standard Deviation of a collection of numbers. |
| `populationVariance` | `PopulationVariance` | `((collection<number> \| number)+) -> nan \| real<0..>` | Population variance of a collection of numbers. |
| `quantile` | `Quantile` | `(collection<any> \| distribution, real<0..1>) -> nan \| real \| signed_infinity` | Quantile (inverse CDF): the least x with CDF(x) ≥ p, for p in [0, 1]. |
| `quartiles` | `Quartiles` | `((collection<number> \| number)+) -> tuple<lower: nan \| real \| signed_infinity, mid: nan \| real \| signed_infinity, upper: nan \| real \| signed_infinity>` | Lower quartile, median, and upper quartile of a collection. |
| `randomSample` | `RandomSample` | `((xs: T, count: number) random -> T where T: string) & ((xs: indexed_collection, count: number) random -> list)` | RandomSample(xs, count): a list of count elements drawn from the indexed collection `xs`, without replacement. "Without replacement" is over POSITIONS, not values: on a multiset, repeats are expected — RandomSample([1, 1, 2], 2) can return… |
| `skewness` | `Skewness` | `((collection<number> \| number)+) -> nan \| real` | Skewness of a collection of numbers. |
| `slidingWindow` | `SlidingWindow` | `((xs: S, count: integer, step: integer?) -> list<string> where S: string) & ((xs: collection, count: integer, step: integer?) -> list<list>)` | Return overlapping sliding windows of fixed size over the collection. |
| `standardDeviation` | `StandardDeviation` | `((collection<number> \| distribution \| number)+) -> nan \| real<0..>` | Sample Standard Deviation of a collection of numbers. |
| `studentTDistribution` | `StudentTDistribution` | `(real<0<..>) -> expression<StudentTDistribution>` | Student's t distribution with ν degrees of freedom (ν &gt; 0, not necessarily an integer). |
| `uniformDistribution` | `UniformDistribution` | `(lower: real, upper: real) -> expression<UniformDistribution>` | Continuous uniform distribution on the interval [a, b]. |
| `variance` | `Variance` | `((collection<number> \| distribution \| number)+) -> nan \| real<0..>` | Sample variance of a collection of numbers. |

## Units

The [Units reference](/epsil/reference/units/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `isCompatibleUnit` | `IsCompatibleUnit` | `(value, value) -> value` | Check if two units have the same dimension and convert into each other (`dB` and `Np` do, `dB` and `percent` do not) |
| `quantity` | `Quantity` | `(magnitude: value, unit: value) -> quantity` | A value paired with a physical unit |
| `quantityMagnitude` | `QuantityMagnitude` | `(value) -> value` | Extract the numeric value from a quantity |
| `quantityUnit` | `QuantityUnit` | `(value) -> value` | Extract the unit from a quantity |
| `unitConvert` | `UnitConvert` | `(quantity: value, unit: value) -> value` | Convert a quantity to a different compatible unit |
| `unitDimension` | `UnitDimension` | `(value) -> value` | Return the dimension vector of a unit |
| `unitSimplify` | `UnitSimplify` | `(value) -> value` | Simplify a quantity unit to a named derived unit if possible |

## Physics

The [Physics reference](/epsil/reference/physics/) has the full description and the examples of each definition.

| Epsil | MathJSON | Signature | Summary |
|:------|:---------|:----------|:--------|
| `avogadroConstant` | `AvogadroConstant` | constant `quantity` = `6.02214076e+23 mol^-1` | Avogadro constant |
| `boltzmannConstant` | `BoltzmannConstant` | constant `quantity` = `1.380649e-23 J/K` | Boltzmann constant |
| `elementaryCharge` | `ElementaryCharge` | constant `quantity` = `1.602176634e-19 C` | Elementary electric charge |
| `gasConstant` | `GasConstant` | constant `quantity` = `8.314462618 J/(K⋅mol)` | Molar gas constant |
| `gravitationalConstant` | `GravitationalConstant` | constant `quantity` = `6.6743e-11 m^3/(kg⋅s^2)` | Newtonian constant of gravitation |
| `mu0` | `Mu0` | constant `quantity` = `0.00000125663706212 N/A^2` | Vacuum permeability |
| `planckConstant` | `PlanckConstant` | constant `quantity` = `6.62607015e-34 J⋅s` | Planck constant |
| `speedOfLight` | `SpeedOfLight` | constant `quantity` = `299792458 m/s` | Speed of light in vacuum |
| `standardGravity` | `StandardGravity` | constant `quantity` = `9.80665 m/s^2` | Standard acceleration due to gravity |
| `stefanBoltzmannConstant` | `StefanBoltzmannConstant` | constant `quantity` = `5.670374419e-8 W/(K^4⋅m^2)` | Stefan-Boltzmann constant |
| `vacuumPermittivity` | `VacuumPermittivity` | constant `quantity` = `8.8541878128e-12 F/m` | Vacuum permittivity (electric constant) |
