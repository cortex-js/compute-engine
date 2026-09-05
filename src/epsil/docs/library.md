---
title: Epsil Standard Library
sidebar_label: Standard Library
slug: /epsil/library/
description: "Every function and constant of the Epsil standard library, by category, with signatures, summaries, and executable examples."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. Source: the library definitions
# (src/compute-engine/library/) as `epsil doc` describes them; regenerate
# with `npm run doc` (scripts/build-library-docs.ts).
---
# Epsil Standard Library

The 675 functions and constants of the standard library, by category.
Each row gives a name, its signature (for a function) or its kind and type
(for a constant or variable), and the first sentence of its description —
the same description `epsil doc <name>` prints in full and the editor
shows as a hover. The examples are executed when this page is generated,
and the value each one evaluates to is written after it as `// ➔`; the
documentation test runs them again, so an example that stops being true
fails the build.

To search the library by concept rather than by name, use
`epsil doc <keywords>` (see the [CLI](/epsil/cli/)); the
[guide for agents](/epsil/for-agents/) lists the names most often needed.

- [Core](#core) — 112 definitions
- [Control structures](#control-structures) — 14 definitions
- [Logic](#logic) — 27 definitions
- [Collections](#collections) — 121 definitions
- [Colors](#colors) — 19 definitions
- [Regular expressions](#regular-expressions) — 4 definitions
- [Fractals](#fractals) — 2 definitions
- [Relations](#relations) — 30 definitions
- [Arithmetic](#arithmetic) — 96 definitions
- [Trigonometry](#trigonometry) — 42 definitions
- [Calculus](#calculus) — 19 definitions
- [Polynomials](#polynomials) — 17 definitions
- [Combinatorics](#combinatorics) — 11 definitions
- [Number theory](#number-theory) — 52 definitions
- [Special functions](#special-functions) — 14 definitions
- [Linear algebra](#linear-algebra) — 42 definitions
- [Statistics](#statistics) — 35 definitions
- [Units](#units) — 7 definitions
- [Physics](#physics) — 11 definitions

## Core

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `About` | `(any) -> dictionary<any>` | Return information about an expression as a dictionary: its kind (symbol, constant, function, number, string, expression), its static type and, when applicable, its name, value, signature, clause listing, algebraic attributes, description,… |
| `Angle` | `(any+) -> number` | Angle mark / measure (`\angle ABC`, `\varangle XYZ`, `∠ABC`) — opaque typed head; not evaluated. |
| `Annotated` | `(expression, dictionary<any>) -> expression` | Attach metadata or style annotations to an expression. |
| `Apply` | `(name: any, arguments: any*) -> unknown` | Apply a function to a list of arguments |
| `Arc` | `(any+) -> number` | Arc / wide-hat accent measure (`\widehat{ABC}`) — opaque typed head; not evaluated. |
| `Assign` | `(expression \| symbol, any) scope -> any` | Assign a value to a symbol or define a sequence. |
| `Assume` | `(any) scope -> string` | Record an assumption about a symbol. |
| `BaseForm` | `(T, (number \| string)?) -> T where T: number` | `BaseForm(expr, base=10)` |
| `BuiltinFunction` | `(string \| symbol) -> symbol` | Return a built-in function symbol by name. |
| `CanonicalForm` | `(any, symbol*) -> any` | Return the canonical form of an expression |
| `CaseFold` | `(string) -> string` | CaseFold(s): a case-folded form of `s`, for case-insensitive comparison — `CaseFold(a) == CaseFold(b)` tests equality ignoring case. |
| `CharacterFrom` | `(string) -> character` | CharacterFrom(s): the character `s` denotes. |
| `Characters` | `(string) -> list<character>` | Characters(s): split a string into a list of user-perceived characters (grapheme clusters). |
| `Coalesce` | `(any+) -> unknown` | Return the first operand that is not ABSENT (`Missing` or `NaN`), evaluated left-to-right. |
| `Colon` | `(any, any) -> expression` | Type annotation (`a : b`) — opaque typed head. |
| `Conforms` | `(subject: any, protocols: string+) -> boolean` | True iff the subject conforms to EVERY named protocol. |
| `Declare` | `(symbol, type: (string \| symbol)?, value: any?, attributes: dictionary<any>?) scope -> any` | Declare a symbol in the current scope, optionally assigning a type and an initial value. |
| `DeclareConformance` | `(target: string \| symbol, protocols: any, whereClauseOrImplementation: any?, implementation: dictionary<any>?) scope -> nothing` | Declare that a type CONFORMS to one or more protocols — the lowering of the Epsil `type string is Hashable & Comparable` statement. |
| `DeclareProtocol` | `(string \| symbol, members: dictionary<any>?) scope -> nothing` | Declare a PROTOCOL: a set of function and property requirements a type may declare itself to satisfy. |
| `DeclareSumType` | `(string \| symbol, any*) scope -> nothing` | Declare a SUM TYPE: N nominal variants plus the transparent union that names them, in one statement — the lowering of the Epsil sugar `type node = lit(num: number) \| plus(op1: node, op2: node)`. |
| `DeclareType` | `(string \| symbol, type: string \| symbol \| type, attributes: dictionary<any>?) scope -> nothing` | Declare a type. |
| `DefineFunction` | `(symbol, function, dictionary<any>?) scope -> nothing` | Define one clause of a (possibly multi-clause) function: `DefineFunction(f, Function(body, params…))`. |
| `Delimiter` | `(any, string?) -> any` | Group expressions with explicit delimiters. |
| `DigitsFrom` | `(string, (integer \| string)?) -> integer` | Return an integer representation of the string `s` in base `base`. |
| `Error` | `(expression<ErrorCode> \| string, expression?) -> nothing` | Represent an error expression. |
| `ErrorCode` | `(string, any*) -> error` | Structured error code with optional arguments. |
| `Evaluate` | `(any) -> unknown` | Evaluate an expression. |
| `EvaluateAt` | `(function, lower: expression, upper: expression) -> unknown` | Evaluate a function at one point or between two bounds. |
| `FindRoot` | `(any, any) -> dictionary` | FindRoot(equations, params): numerically find parameter values that |
| `Function` | `(expression, (function \| symbol)*) -> function` | A function literal |
| `GeometricVector` | `(any, any) -> expression` | Geometric vector (directed segment between two points) — opaque typed head. |
| `GraphemeClusters` | `(string) -> list<character>` | A collection of grapheme clusters from a string. |
| `Head` | `(any) -> symbol` | Return the head of an expression, the name of the operator |
| `Hold` | `(any) -> unknown` | Hold an expression, preventing it from being canonicalized or evaluated until `ReleaseHold` is applied to it |
| `HoldValues` | `(any, any?) -> expression` | HoldValues(body): evaluate `body` with its assigned free symbols |
| `HorizontalSpacing` | `(number) -> nothing` | Horizontal spacing annotation. |
| `Identity` | `(T) -> T where T` | Return the argument unchanged |
| `IndexedSequence` | `(any, symbol, any, any?) -> expression` | Indexed sequence `\{a_n\}_{n=1}^{\infty}` — inert head `IndexedSequence(term, index, lower, upper?)`; not evaluated. |
| `Input` | `(prompt: string?) console -> nothing \| string` | Read one line of text from the host: the terminal in a command-line host, the `prompt()` dialog in a browser. |
| `IntegerString` | `(integer, integer?) -> string` | `IntegerString(n, base=10)` return a string representation of the integer `n` in base `base`. |
| `InvisibleOperator` | `function` | Implicit operator used for juxtapositions such as function application or multiplication. |
| `IsError` | `(any) -> boolean` | True if the expression is an `Error` value, or a frozen expression embedding one (`"a" + 1`). |
| `IsMissing` | `(any) -> boolean` | True if the value is ABSENT — the `Missing` symbol, or a `NaN` number (regardless of provenance). |
| `Latex` | `(any+) -> string` | Serialize an expression to LaTeX |
| `LatexString` | `(string) -> string` | Value preserving type conversion/tag indicating the string is a LaTeX string |
| `MatchesType` | `(subject: any, type: string \| type) -> boolean` | True iff the first operand, EVALUATED, is a value of the given type — the engine form of the Epsil `x is T` test and of `match` type patterns, which both lower here. |
| `Missing` | variable `missing` | A value that is absent but whose position is preserved (Julia `missing`, R `NA`); the sole member of the `missing` type. |
| `N` | `(any, integer?) -> unknown` | N(expr): numerically evaluate an expression |
| `NamedArgument` | `(string, any) -> nothing` | NamedArgument(name, value): one named argument of a call (Epsil |
| `Nothing` | variable `nothing` | The absence of a value; the sole member of the unit type. |
| `NumberFrom` | `(string, base: (integer \| string)?) -> number` | NumberFrom(s): the number the string `s` denotes — optional surrounding whitespace, an optional sign, then ASCII digits with an optional "." fraction and an optional e/E exponent, or one of "oo", "+oo", "-oo", "NaN". |
| `Object` | `(any, string?) -> unknown` | Provenance head for the snapshot of a mutable object: `["Object", <record>, "'TypeName'"]`. |
| `OverParen` | `(any+) -> expression` | Over-paren accent (`\overparen{BC}`) — opaque typed head; not evaluated. |
| `PadEnd` | `(string, n: integer, pad: string?) -> string` | PadEnd(s, n, pad=" "): `s` padded at the END to `n` characters by repeating `pad` (its final copy truncated on a character boundary). |
| `PadStart` | `(string, n: integer, pad: string?) -> string` | PadStart(s, n, pad=" "): `s` padded at the START to `n` characters by repeating `pad` (its final copy truncated on a character boundary). |
| `Parallel` | `(any, any) -> expression` | Parallelism relation (`AB \parallel CD`) — opaque typed head; not evaluated. |
| `Parse` | `(string) -> any` | Parse a LaTeX string and evaluate to a corresponding expression |
| `Perpendicular` | `(any, any) -> expression` | Perpendicularity relation (`AB \perp CD`) — opaque typed head; not evaluated. |
| `Pipe` | `(value, function) -> unknown` | Apply a function to a value: `Pipe(x, f)` evaluates to `f(x)`. |
| `Polygon` | `(any+) -> expression` | Polygon primitive — opaque typed head. |
| `Prime` | `(T, integer?) -> T where T` | Derivative or prime notation (`f'`, `f^{(n)}`) — opaque typed head until a derivative library handler runs. |
| `Print` | `(any*) console -> nothing` | Print the operands to the host console, separated by spaces and followed by a newline. |
| `ProtocolMember` | `(protocol: string, member: string, arguments: any*) -> unknown` | Invoke a protocol member on a value — the lowering of a QUALIFIED protocol call (`Comparable.compare(x, y)` in Epsil, whose parse, a `MemberCall` on the protocol name, canonicalizes to `Apply(Field(Comparable, "compare"), x, y)`). |
| `ProtocolProperty` | `(protocol: string, property: string, receiver: any, value: any?) -> unknown` | Read (or write) a protocol PROPERTY through a NAMED protocol — the lowering of the qualified field form `person.(Nameable.name)` (protocols design P6, amending the D16 field grammar). |
| `Quadrilateral` | `(any+) -> expression` | Quadrilateral mark (`\square ABCD`) — opaque typed head; not evaluated. |
| `Random` | `((collection<any> \| set<real>)?) random -> any` | Random(): non-deterministic real in [0, 1) |
| `RandomChoice` | `(collection<any> \| set<real>, number) random -> list<any>` | RandomChoice(domain, k): a list of k independent draws from `domain`, with replacement. |
| `RandomExpression` | `() entropy -> expression` | Generate a random expression. |
| `ReleaseHold` | `(any) -> unknown` | Release an expression held by `Hold` |
| `ReplaceAll` | `(any, any+) -> any` | ReplaceAll(expr, rules): apply one or more replacement rules to `expr`, |
| `Rule` | `(match: expression, replace: expression, predicate: function?) -> expression` | Pattern replacement rule. |
| `RuntimeError` | `(expression<ErrorCode> \| string) -> never` | Construct an error value when evaluated: the runtime counterpart of a written `Error(…)`, which is a static diagnostic node. |
| `Segment` | `(any+) -> expression` | Segment primitive — opaque typed head. |
| `Sequence` | `function` | Ordered sequence of expressions. |
| `Signature` | `(symbol) -> nothing \| string` | Return the signature string of an operator. |
| `Simplify` | `(any, any?) -> expression` | Simplify(expr): simplify an expression. |
| `Solve` | `(any, any*) -> list` | Solve(equation, unknown): the list of solutions of an equation for the |
| `Sphere` | `(any+) -> expression` | Sphere primitive — opaque typed head. |
| `Spread` | `(any) -> unknown` | Spread(t): splice the elements of the tuple `t` into the enclosing |
| `String` | `(any*) -> string` | A string created by joining its arguments. |
| `StringCompare` | `(string, string) -> integer` | StringCompare(a, b): -1 when `a` sorts before `b`, 0 when they are equal, 1 when `a` sorts after `b`. |
| `StringFrom` | `(any, format: string?) -> string` | Create a string by converting its arguments to a string and joining them. |
| `StringJoin` | `(collection<character \| string>, separator: string?) -> string` | StringJoin(xs): join the elements of the finite collection `xs` (strings or characters) into a string. |
| `StringRepeat` | `(string, n: integer) -> string` | StringRepeat(s, n): `n` copies of the string `s`, concatenated. |
| `StringReplace` | `((string, string, string, count: integer?) -> string) & ((string, regexp, string, count: integer?) -> string) & ((string, regexp, function, count: integer?) -> string)` | StringReplace(s, target, replacement): replace every non-overlapping occurrence of `target` in `s`, scanning left to right over whole characters. |
| `StringSplit` | `((string, string?) -> list<string>) & ((string, regexp) -> list<string>)` | StringSplit(s): split a string on runs of whitespace (the Unicode White_Space code points), dropping empty parts. |
| `Subscript` | `(collection<any>, any) -> any` | Subscript notation for indexing or compound symbols. |
| `Subtype` | `(subtype: string \| type, supertype: string \| type) -> boolean` | True iff the FIRST operand is a subtype of the second — `Subtype("integer", "number")` is `True`, `Subtype("number", "integer")` is `False`. |
| `Symbol` | `function` | Construct a new symbol with a name formed by concatenating the arguments |
| `Tail` | `(any) -> collection` | Return the tail of an expression, the operands of the expression |
| `Text` | `(any*) -> string` | A sequence of strings, annotated expressions and other Text expressions |
| `Timing` | `(value, repeat: integer?) -> tuple<result: value, time: number>` | `Timing(expr)` evaluates `expr` and return a `Pair` of the number of second elapsed for the evaluation, and the value of the evaluation |
| `To` | `(any, any) -> nothing` | Action arrow / mapping (`a \to b`) — opaque typed head. |
| `ToLowerCase` | `(string) -> string` | ToLowerCase(s): the string `s` mapped to lower case using the Unicode default (locale-independent) mappings. |
| `ToUpperCase` | `(string) -> string` | ToUpperCase(s): the string `s` mapped to upper case using the Unicode default (locale-independent) mappings. |
| `Triangle` | `(any+) -> expression` | Triangle primitive — opaque typed head. |
| `Trim` | `(string, chars: (character \| collection<character \| string> \| string)?) -> string` | Trim(s): remove leading and trailing whitespace (the Unicode White_Space characters). |
| `TrimEnd` | `(string, chars: (character \| collection<character \| string> \| string)?) -> string` | TrimEnd(s): remove trailing whitespace (the Unicode White_Space characters). |
| `TrimStart` | `(string, chars: (character \| collection<character \| string> \| string)?) -> string` | TrimStart(s): remove leading whitespace (the Unicode White_Space characters). |
| `Type` | `(any) -> type` | The STATIC type of an expression, as a type value: `Type(3)` is `TypeFrom("integer")`. |
| `TypeFrom` | `(text: string) -> type` | A type expression as a first-class value, constructed from its text: `TypeFrom("list<integer>")`. |
| `Typed` | `(any, string \| symbol) -> unknown` | Ascribe a type to an expression. |
| `Unevaluated` | `(any) -> unknown` | Prevent an expression from being evaluated |
| `UnicodeScalars` | `(string) -> list<integer>` | A collection of Unicode scalars from a string, same as UTF-32 |
| `Utf16` | `(string) -> list<integer>` | A collection of UTF-16 code units from a string. |
| `Utf8` | `(string) -> list<integer>` | A collection of UTF-8 code units from a string. |
| `Wildcard` | `(symbol) -> symbol` | Single-expression pattern wildcard. |
| `WildcardOptionalSequence` | `(symbol) -> symbol` | Pattern wildcard matching zero or more expressions. |
| `WildcardSequence` | `(symbol) -> symbol` | Pattern wildcard matching one or more expressions. |
| `WithRandomSeed` | `(real \| string, any) -> expression` | WithRandomSeed(seed, body): evaluate `body` with a random seed frame |
| `input` | `(prompt: string?) console -> nothing \| string` | Lowercase alias for `Input` (the Epsil command spelling); canonicalizes to `Input`. |
| `print` | `(any*) console -> nothing` | Lowercase alias for `Print` (the Epsil command spelling); canonicalizes to `Print`. |

## Control structures

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `Alternatives` | `(expression+) -> nothing` | Inside a `Match` pattern, `Alternatives(p1, p2, …)` matches if any alternative matches. |
| `Block` | `(unknown*) -> unknown` | Evaluate a sequence of expressions in a local scope, **sequentially**. |
| `Break` | `(value: any?) -> nothing` | Exit the enclosing loop immediately, optionally with a value (`Break(v)`) that becomes the loop value. |
| `Comprehension` | `(body: expression, iterators: expression+) -> indexed_collection` | Value-producing comprehension: evaluate `body` in nested iteration over one or more `Element` clauses and collect the results into an indexed collection (a `List`). |
| `Condition` | `(expression, symbol?) -> boolean` | Test whether a value satisfies one or more conditions. |
| `Continue` | `() -> nothing` | Skip to the next iteration of the enclosing loop. |
| `FixedPoint` | `(any) -> unknown` | Iterate a function until a fixed point is reached. |
| `If` | `(expression, expression, expression?) -> any` | Conditional branch: evaluate one of two expressions. |
| `Loop` | `(body: expression, iterators: expression*) -> any` | Imperative loop, evaluated **for effect**. |
| `Match` | `(expression, expression+) -> unknown` | Structural pattern match. |
| `MatchCase` | `(expression, expression, expression?) -> nothing` | A case of a `Match`: `MatchCase(pattern, body)` or `MatchCase(pattern, guard, body)`. |
| `Pin` | `(expression) -> nothing` | Inside a `Match` pattern, `Pin(expr)` matches the value of `expr` (evaluated at match time) rather than its structure. |
| `When` | `(expression, boolean) -> any` | Conditional/restriction value. |
| `Which` | `(expression+) -> unknown` | Return the value for the first condition that is true. |

## Logic

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `And` | `(boolean+) -> boolean` | Logical conjunction (AND): true when all operands are true. |
| `Boole` | `(boolean) -> integer` | Return 1 if the argument is true, 0 otherwise. |
| `Equivalent` | `(boolean, boolean) -> boolean` | Logical equivalence (if and only if): true when both operands have the same truth value. |
| `Exists` | `(value, boolean) -> boolean` | Existential quantifier (there exists): true when the predicate holds for at least one value. |
| `ExistsUnique` | `(value, boolean) -> boolean` | Unique existential quantifier (there exists exactly one value satisfying the predicate). |
| `False` | constant `boolean` | The boolean truth value false. |
| `ForAll` | `(value, boolean) -> boolean` | Universal quantifier (for all): true when the predicate holds for every value. |
| `Implies` | `(boolean, boolean) -> boolean` | Logical implication: false only when the antecedent is true and the consequent is false. |
| `IsSatisfiable` | `(boolean) -> boolean` | Check satisfiability using brute-force enumeration. |
| `IsTautology` | `(boolean) -> boolean` | Check if expression is a tautology using brute-force enumeration. |
| `KroneckerDelta` | `(value+) -> integer` | Return 1 if the arguments are equal, 0 otherwise. |
| `MinimalCNF` | `(boolean) -> boolean` | Convert to minimal CNF using Quine-McCluskey. |
| `MinimalDNF` | `(boolean) -> boolean` | Convert to minimal DNF using Quine-McCluskey. |
| `Nand` | `(boolean+) -> boolean` | Logical NAND: the negation of AND (n-ary). |
| `Nor` | `(boolean+) -> boolean` | Logical NOR: the negation of OR (n-ary). |
| `Not` | `(boolean) -> boolean` | Logical negation (NOT). |
| `NotExists` | `(value, boolean) -> boolean` | Negated existential quantifier (there does not exist): true when the predicate holds for no value. |
| `NotForAll` | `(value, boolean) -> boolean` | Negated universal quantifier (not for all): true when the predicate fails for at least one value. |
| `Or` | `(boolean+) -> boolean` | Logical disjunction (OR): true when at least one operand is true. |
| `Predicate` | `(symbol, value+) -> boolean` | Apply a predicate to arguments, returning a boolean |
| `PrimeImplicants` | `(boolean) -> list` | Find all prime implicants using Quine-McCluskey. |
| `PrimeImplicates` | `(boolean) -> list` | Find all prime implicates using Quine-McCluskey. |
| `ToCNF` | `(boolean) -> boolean` | Convert a boolean expression to conjunctive normal form (CNF), an AND of ORs. |
| `ToDNF` | `(boolean) -> boolean` | Convert a boolean expression to disjunctive normal form (DNF), an OR of ANDs. |
| `True` | constant `boolean` | The boolean truth value true. |
| `TruthTable` | `(boolean) -> list` | Generate truth table for expression. |
| `Xor` | `(boolean+) -> boolean` | Exclusive or: true when an odd number of operands are true |

## Collections

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `Adjoin` | `(set<any>, any+) -> set` | The ring obtained by adjoining one or more elements to a base ring. |
| `All` | `(collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T` | Return True if the predicate holds for every element of the collection (or if every element is True when no predicate is given). |
| `Any` | `(collection<T>, predicate: ((T) any -> boolean)?) -> boolean where T` | Return True if the predicate holds for at least one element of the collection (or if any element is True when no predicate is given). |
| `Append` | `(collection<any>, value+) -> collection` | Add one or more elements to the end of a collection. |
| `ArgMax` | `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T` | Return the 1-based index of the element that maximizes the given key function (or the element itself when no key is given). |
| `ArgMin` | `(indexed_collection<T>, key: ((T) any -> unknown)?) -> integer where T` | Return the 1-based index of the element that minimizes the given key function (or the element itself when no key is given). |
| `At` | `(value: any, index: (boolean \| indexed_collection<any> \| number \| string)+) -> unknown` | Access an element of an indexed collection. |
| `Chunk` | `((S, integer) -> list<string> where S: string) & ((collection, integer) -> list<list>)` | Split the collection into `k` nearly equal-sized groups. |
| `ChunkBy` | `((S, key: (character) any -> unknown) -> list<string> where S: string) & ((collection<T>, key: (T) any -> unknown) -> list<list<T>> where T)` | Split the collection into maximal runs of consecutive elements over which the key function yields the same value. |
| `Complement` | `(set<any>+) -> set` | Return the elements of the first set that are not in any of the subsequent sets. |
| `ComplexNumbers` | constant `set<complex>` | The set of all finite complex numbers. |
| `Contains` | `(collection<any>, element: any) -> boolean` | Return True if the collection contains the given element (structural identity, like `===`), False otherwise. |
| `ContainsSequence` | `(indexed_collection<T>, indexed_collection<T>) -> boolean where T` | Return `True` when `needle` occurs as a contiguous subsequence of the indexed collection. |
| `Count` | `(collection<any>, any?) -> infinity \| integer` | `Count(xs)`: the number of elements in the collection. |
| `CountIf` | `(collection<T>, predicate: (T) any -> boolean) -> integer where T` | Return the number of elements in the collection satisfying the predicate. |
| `Cycle` | `(list<any>) -> list` | Produce an infinite sequence by cycling through the elements of a finite collection. |
| `Dedup` | `(collection<any>) -> collection` | Return the collection with consecutive duplicate elements collapsed to a single element. |
| `DeleteAt` | `((T, integer) -> T where T: string) & ((indexed_collection<T>, integer) -> list<T> where T)` | Return a copy of the indexed collection with the element at the 1-based `index` removed. |
| `Dictionary` | `(tuple<string, unknown>*) -> dictionary` | A collection of key -&gt; value entries with string keys (`{x -> 1, y -> 2}` in Epsil). |
| `DictionaryFrom` | `(collection<any>) -> dictionary` | Create a dictionary from the elements of a collection of (key, value) pairs. |
| `Differences` | `(collection<any>) -> indexed_collection` | Return the successive differences of a collection: a collection whose k-th element is `x(k+1) − xk`, of length one less than the input. |
| `Drop` | `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)` | Return the collection without the first n elements. |
| `DropWhile` | `(collection<T>, predicate: (T) any -> boolean) -> collection where T` | Return the collection with its leading elements for which the predicate returns True removed; the remaining elements are returned unfiltered. |
| `Element` | `(any, any, boolean?) -> boolean` | Test whether a value is an element of a collection. |
| `EmptySet` | constant `set` | The empty set, a set containing no elements. |
| `EndsWith` | `(indexed_collection<T>, suffix: indexed_collection<T>) -> boolean where T` | Return `True` when the indexed collection ends with `suffix` as a contiguous subsequence. |
| `ExtendedComplexNumbers` | constant `set<complex \| infinity>` | The set of all complex numbers, including infinities. |
| `ExtendedIntegers` | constant `set<integer \| signed_infinity>` | The set of all integers, including infinities. |
| `ExtendedRationalNumbers` | constant `set<rational \| signed_infinity>` | The set of all rational numbers, including infinities. |
| `ExtendedRealNumbers` | constant `set<real \| signed_infinity>` | The set of all real numbers, including infinities. |
| `Field` | `(value: any, field: string) -> unknown` | Access a named field of a value: `p.x` in Epsil. |
| `Fill` | `(function, tuple) -> list` | Produce a 2D list (matrix) by applying a function to each pair of row and column indexes. |
| `Filter` | `(collection<T>, predicate: (T) any -> boolean) -> collection where T` | Return the elements of the collection for which the predicate function returns True. |
| `Find` | `(collection<T>, predicate: (T) any -> boolean) -> any where T` | Return the first element of the collection satisfying the predicate, or Nothing if none found. |
| `First` | `(xs: indexed_collection<any>) -> any` | The first element of a collection. |
| `FlatMap` | `(collection<T>, mapping: (T) any -> U) -> list where T, U` | Map a function over a collection and concatenate the results into a single list, splicing collection-valued results and keeping scalar results as single elements. |
| `Fold` | `(reducer: (unknown, T) any -> unknown, initial: value, collection<T>) -> value where T` | Fold a collection to a single value, applying a binary function f(accumulator, element) left to right from an initial value. |
| `GroupBy` | `(collection<T>, key: (T) any -> unknown) -> dictionary<list> where T` | Partition the collection into a dictionary of lists based on the key returned by the function. |
| `ImaginaryNumbers` | constant `set<imaginary>` | The set of all imaginary numbers. |
| `IndexOf` | `(collection<any>, any) -> integer` | Return the 1-based index of the first occurrence of value in collection, or 0 if not found. |
| `IndexWhere` | `(collection<T>, predicate: (T) any -> boolean) -> integer where T` | Return the 1-based index of the first element satisfying the predicate, or 0 if not found. |
| `Insert` | `(indexed_collection<T>, integer, T) -> list<T> where T` | Return a copy of the indexed collection with `value` inserted before the 1-based `index`. |
| `Integers` | constant `set<integer>` | The set of all finite integers. |
| `Intersection` | `(any+) -> set` | Return the intersection of one or more collections as a set. |
| `Interval` | `(number, number) -> set<real>` | A set of real numbers between two endpoints. |
| `IsEmpty` | `(collection<any>) -> boolean` | Return True if the collection is empty, False otherwise. |
| `Iterate` | `(function, initial: any?) -> list` | Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value. |
| `Join` | `((T+) -> T where T: string) & ((collection<any>*) -> collection)` | Join the elements of some collections into a flat collection. |
| `KeyValuePair` | `(key: string, value: T) -> tuple<string, T> where T` | A key/value pair |
| `Keys` | `(dictionary<any>) -> list<string>` | Return a list of the keys of a dictionary. |
| `Last` | `(xs: indexed_collection<any>) -> any` | The last element of a collection. |
| `Length` | `(any) -> infinity \| integer` | Number of elements in a collection. |
| `Linspace` | `(start: number, end: number?, count: number?) -> indexed_collection` | A sequence of evenly spaced numbers between a start and end value, both endpoints included. |
| `List` | `(any*) -> list` | An ordered collection of elements (a list). |
| `ListFrom` | `(value*) -> list` | Create a list from the elements of a collection. |
| `Map` | `(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U` | Return the collection where each element has been transformed by the mapping function. |
| `MaxBy` | `(collection<T>, key: (T) any -> unknown) -> value where T` | Return the element of the collection that maximizes the given key function. |
| `MemberCall` | `(receiver: any, member: string, arguments: any*) -> unknown` | Call the member `name` of a value with the value as its first argument: `c.area(2)` in Epsil. |
| `MinBy` | `(collection<T>, key: (T) any -> unknown) -> value where T` | Return the element of the collection that minimizes the given key function. |
| `Most` | `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)` | Return the collection without the last element. |
| `NegativeIntegers` | constant `set<integer>` | The set of all negative integers. |
| `NegativeNumbers` | constant `set<real>` | The set of all negative real numbers. |
| `NonNegativeIntegers` | constant `set<integer>` | The set of all non-negative integers. |
| `NonNegativeNumbers` | constant `set<real>` | The set of all non-negative real numbers. |
| `NonPositiveIntegers` | constant `set<integer>` | The set of all non-positive integers. |
| `NonPositiveNumbers` | constant `set<real>` | The set of all non-positive real numbers. |
| `NotElement` | `(any, any) -> boolean` | Test whether a value is not an element of a collection. |
| `NotSubset` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is not a strict subset of the second. |
| `NotSuperset` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is not a strict superset of the second. |
| `NotSupersetEqual` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is not a superset (possibly equal) of the second. |
| `Numbers` | constant `set<number>` | The set of all numbers. |
| `Ordering` | `(indexed_collection<T>, order: (((T) any -> unknown) \| ((any, any) any -> boolean \| number))?) -> list<integer> where T` | Return the indexes that would sort the collection. |
| `Pair` | `(first: T, second: U) -> tuple<T, U> where T, U` | A tuple of two elements |
| `Partition` | `(collection<T>, ((T) any -> boolean) \| integer, integer?) -> list<list<T>> where T` | Partition a collection into consecutive chunks each of size `n`; the trailing chunk may be shorter when `n` does not divide the length. |
| `PointList` | `(any+) -> any` | A list of points: zips collection components into a List of point-tuples (Desmos point-list idiom); a plain point when no component is a collection. |
| `PointX` | `(xs: collection<any> \| tuple) -> any` | The x-coordinate of a point, broadcasting over a list of points. |
| `PointY` | `(xs: collection<any> \| tuple) -> any` | The y-coordinate of a point, broadcasting over a list of points. |
| `PointZ` | `(xs: collection<any> \| tuple) -> any` | The z-coordinate of a point, broadcasting over a list of points. |
| `Position` | `(collection<T>, predicate: (T) any -> boolean) -> list<integer> where T` | Return a list of indexes of elements in the collection satisfying the predicate. |
| `PositiveIntegers` | constant `set<integer>` | The set of all positive integers. |
| `PositiveNumbers` | constant `set<real>` | The set of all positive real numbers. |
| `QuotientRing` | `(set<any>, any) -> set` | The quotient of a ring by the ideal generated by the second argument. |
| `RandomShuffle` | `((T) random -> T where T: string) & ((indexed_collection<T>) random -> list<T> where T)` | Randomize the order of the elements in the collection. |
| `Range` | `(number, number?, step: number?) -> indexed_collection<number>` | A sequence of numbers from a start to an end value with an optional step. |
| `RangeOf` | `(indexed_collection<T>, indexed_collection<T>, from: integer?) -> nothing \| range where T` | Return the 1-based inclusive index span of the first occurrence of `needle` as a contiguous subsequence of the indexed collection, or `Nothing` when it does not occur. |
| `RationalNumbers` | constant `set<rational>` | The set of all finite rational numbers. |
| `RealNumbers` | constant `set<real>` | The set of all finite real numbers. |
| `Reduce` | `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T` | Reduce (fold) a collection to a single value by repeatedly applying a binary function, with an optional initial value. |
| `Repeat` | `(value: any, count: integer?) -> list` | Produce a sequence by repeating a single value. |
| `ReplaceAt` | `(indexed_collection<T>, integer, T) -> list<T> where T` | Return a copy of the indexed collection with the element at the 1-based `index` replaced by `value`. |
| `Rest` | `((T) -> T where T: string) & ((indexed_collection<T>) -> list<T> where T)` | Return the collection without the first element. |
| `Reverse` | `((T) -> T where T: string) & ((T) -> T where T: list) & ((indexed_collection<T>) -> list<T> where T)` | Reverse the order of the elements of an indexed collection. |
| `RotateLeft` | `((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)` | Rotate the elements of the collection to the left by n positions. |
| `RotateRight` | `((T, integer?) -> T where T: string) & ((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)` | Rotate the elements of the collection to the right by n positions. |
| `Scan` | `(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T` | Return the cumulative fold of a collection: a same-length collection whose k-th element is the running result of applying a binary function left to right (optionally seeded by an initial value). |
| `Second` | `(xs: indexed_collection<any>) -> any` | The second element of a collection. |
| `Set` | `(any*) -> set` | An unordered collection of distinct elements (a set). |
| `SetFrom` | `(value*) -> set` | Create a set from the elements of a collection. |
| `SetMinus` | `(set<any>, value*) -> set` | Return the set difference between the first set and subsequent values. |
| `Single` | `(value: T) -> tuple<T> where T` | A tuple with a single element |
| `Slice` | `((value: T, span: range) -> T where T: string) & ((value: T, span: nothing \| range) -> T \| nothing where T: string) & ((value: T, start: number, end: number) -> T where T: string) & ((value: indexed_collection<T>, span: range) -> list<T> where T) & ((value: indexed_collection<T>, span: nothing \| range) -> list<T> \| nothing where T) & ((value: indexed_collection<T>, start: number, end: number) -> list<T> where T)` | Return a contiguous run of elements from an indexed collection. |
| `Sort` | `((T, order: (((character) any -> unknown) \| ((character, character) any -> boolean \| number))?) -> T where T: string) & ((indexed_collection<T>, order: (((T) any -> unknown) \| ((any, any) any -> boolean \| number))?) -> list<T> where T)` | Return the elements of the collection sorted according to the given comparison function. |
| `StartsWith` | `(indexed_collection<T>, prefix: indexed_collection<T>) -> boolean where T` | Return `True` when the indexed collection begins with `prefix` as a contiguous subsequence. |
| `Subset` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is a strict subset of the second. |
| `SubsetEqual` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is a subset (possibly equal) of the second. |
| `Superset` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is a strict superset of the second. |
| `SupersetEqual` | `(lhs: any, rhs: any) -> boolean` | Test whether the first collection is a superset (possibly equal) of the second. |
| `SymmetricDifference` | `(set<any>, set<any>) -> set` | Return the symmetric difference of two sets (elements in either set but not both). |
| `Table` | `(function, integer, integer?) -> collection` | An alias for `Tabulate` (the preferred name) that additionally accepts |
| `Tabulate` | `(generator: function, integer, integer?) -> indexed_collection` | Create a collection by applying a function to each index in the specified dimensions. |
| `Take` | `((xs: T, count: number) -> T where T: string) & ((xs: indexed_collection<T>, count: number) -> list<T> where T)` | Return `n` elements from a collection. |
| `TakeWhile` | `(collection<T>, predicate: (T) any -> boolean) -> collection where T` | Return the leading elements of the collection for which the predicate returns True, stopping at the first element that does not. |
| `Tally` | `(collection<T>) -> tuple<list<T>, list<integer>> where T` | Return a tuple with the unique elements of the collection and their respective counts. |
| `Third` | `(xs: indexed_collection<any>) -> any` | The third element of a collection. |
| `Triple` | `(first: T, second: U, third: V) -> tuple<T, U, V> where T, U, V` | A tuple of three elements |
| `Tuple` | `(any*) -> tuple` | A fixed number of heterogeneous elements |
| `TupleFrom` | `(value*) -> tuple` | Create a tuple from the elements of a collection. |
| `Union` | `(any+) -> set` | Return the union of two or more collections as a set. |
| `Unique` | `((T) -> T where T: string) & ((collection<T>) -> list<T> where T)` | Return a list of the unique elements of the collection. |
| `Values` | `(dictionary<any>) -> list` | Return a list of the values of a dictionary. |
| `Zip` | `(indexed_collection<any>+) -> list` | Combine multiple collections element-wise into a list of tuples. |

## Colors

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `AsHsl` | `(color) -> color` | Convert any color to HSL (hue degrees, s/l 0-1) |
| `AsHsv` | `(color) -> color` | Convert any color to HSV (hue degrees, s/v 0-1) |
| `AsOklab` | `(color) -> color` | Convert any color to OKLab |
| `AsOklch` | `(color) -> color` | Convert any color to OKLCh |
| `AsRgb` | `(color) -> color` | Convert any color to sRGB (channels 0-1) |
| `Color` | `(string) -> color` | Parse a CSS-style color string to an Oklch color |
| `ColorContrast` | `(color \| string \| tuple, color \| string \| tuple) -> number` | APCA contrast ratio between two colors |
| `ColorDelta` | `(color \| string \| tuple, color \| string \| tuple) -> number` | Perceptual color difference (ΔE_OK) between two colors |
| `ColorFromColorspace` | `(color \| tuple, string) -> tuple` | Convert color space components to a canonical sRGB tuple |
| `ColorMix` | `(color \| string \| tuple, color \| string \| tuple, number?) -> color` | Mix two colors in OKLCh space |
| `ColorToColorspace` | `(color \| string \| tuple, string) -> tuple` | Convert a color to components in a target color space |
| `ColorToString` | `(color \| string \| tuple, string?) -> string` | Convert a color to a string in the specified format |
| `Colormap` | `(string, number?) -> color \| list<color>` | Sample colors from a named palette |
| `ContrastingColor` | `(color \| string \| tuple, (color \| string \| tuple)?, (color \| string \| tuple)?) -> color` | Choose the foreground color with better APCA contrast against a background |
| `Hsl` | `(number, number, number, number?) -> color` | HSL color (hue degrees, saturation/lightness 0-1, optional alpha) |
| `Hsv` | `(number, number, number, number?) -> color` | HSV color (hue degrees, saturation/value 0-1, optional alpha) |
| `Oklab` | `(number, number, number, number?) -> color` | OKLab color (L 0-1, a/b ~ -0.4..0.4, optional alpha) |
| `Oklch` | `(number, number, number, number?) -> color` | OKLCh color (L 0-1, C 0-~0.4, hue degrees, optional alpha) |
| `Rgb` | `(number, number, number, number?) -> color` | sRGB color (channels 0-1, optional alpha 0-1) |

## Regular expressions

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `IsMatch` | `(subject: string, pattern: regexp) -> boolean` | Whether a string contains a match for a regular expression. |
| `RegExp` | `(pattern: string, flags: string?) -> regexp` | A compiled regular expression, using the host JavaScript dialect. |
| `StringMatch` | `(subject: string, pattern: regexp) -> nothing \| record` | The first match of a regular expression in a string, as a record. |
| `StringMatchAll` | `(subject: string, pattern: regexp) -> list<record>` | Every non-overlapping match of a regular expression in a string, as a list of records. |

## Fractals

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `Julia` | `(number, number, integer) -> real` | Smooth escape-time value for a Julia set with parameter c. |
| `Mandelbrot` | `(number, integer) -> real` | Smooth escape-time value for the Mandelbrot set. |

## Relations

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `Approx` | `(any, any*) -> boolean` | Approximate-equality relation (approximately equal). |
| `ApproxEqual` | `(any, any*) -> boolean` | Approximately-equal relation. |
| `ApproxNotEqual` | `(any, any*) -> boolean` | Approximately-not-equal relation. |
| `Congruent` | `(number, number, modulo: number) -> boolean` | Indicate that two expressions are congruent modulo a number |
| `Equal` | `(any, any) -> boolean` | Equality comparison (equal to). |
| `Greater` | `(any, any*) -> boolean` | Greater-than comparison (strictly greater than). |
| `GreaterEqual` | `(any, any*) -> boolean` | Greater-than-or-equal comparison (greater than or equal to). |
| `IdenticallyEqual` | `(any, any) -> boolean` | Identity comparison (`\equiv`). |
| `IsSame` | `(any, any) -> boolean` | Compare two expressions for structural equality |
| `Less` | `(any, any*) -> boolean` | Less-than comparison (strictly less than). |
| `LessEqual` | `(any, any*) -> boolean` | Less-than-or-equal comparison (less than or equal to). |
| `NotApprox` | `(any, any*) -> boolean` | Negated approximate-equality relation (not approximately equal). |
| `NotApproxEqual` | `(any*) -> unknown` | Negated approximately-equal relation. |
| `NotApproxNotEqual` | `(any, any*) -> boolean` | Negated approximately-not-equal relation. |
| `NotEqual` | `(any, any) -> boolean` | Inequality comparison (not equal to). |
| `NotGreater` | `(any, any*) -> boolean` | Negated greater-than relation (not greater than). |
| `NotGreaterNotEqual` | `(any, any*) -> boolean` | Neither greater than nor equal to. |
| `NotLess` | `(any, any*) -> boolean` | Negated less-than relation (not less than). |
| `NotLessNotEqual` | `(any, any*) -> boolean` | Neither less than nor equal to. |
| `NotPrecedes` | `(any, any*) -> boolean` | Negated precedes relation (does not precede). |
| `NotSucceeds` | `(any, any*) -> boolean` | Negated succeeds relation (does not succeed). |
| `NotTilde` | `(any, any*) -> boolean` | Negated similarity relation (not similar). |
| `NotTildeEqual` | `(any, any*) -> boolean` | Negated approximately/asymptotically-equal relation (not approximately equal). |
| `NotTildeFullEqual` | `(any, any*) -> boolean` | Negated isomorphism/congruence relation (not isomorphic or congruent). |
| `Precedes` | `(any, any*) -> boolean` | Precedes relation in an ordering (comes before). |
| `Same` | `(any, any*) -> boolean` | Structural identity comparison (Epsil `===`). |
| `Succeeds` | `(any, any*) -> boolean` | Succeeds relation in an ordering (comes after). |
| `Tilde` | `(any, any*) -> boolean` | Generic similarity relation (`\sim`): similar geometric figures, asymptotic equivalence, or "is distributed as". |
| `TildeEqual` | `(any, any*) -> boolean` | Approximately or asymptotically equal |
| `TildeFullEqual` | `(any, any*) -> boolean` | Indicate isomorphism, congruence and homotopic equivalence |

## Arithmetic

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `Abs` | `(complex \| infinity) -> number` | Absolute value (magnitude) of a number. |
| `AbsArg` | `(complex \| infinity) -> tuple<+oo \| real, real>` | Tuple of magnitude and argument of a complex number. |
| `Add` | `(value+) -> value` | Sum of two or more values. |
| `AiryAi` | `(complex \| infinity) -> number` | Airy function of the first kind |
| `AiryAiPrime` | `(complex \| infinity) -> number` | Derivative of the Airy function of the first kind |
| `AiryBi` | `(complex \| infinity) -> number` | Airy function of the second kind |
| `AiryBiPrime` | `(complex \| infinity) -> number` | Derivative of the Airy function of the second kind |
| `Arg` | `(complex \| infinity) -> number` | `Arg` is an alias for `Argument`, which is the preferred name. |
| `Argument` | `(complex \| infinity) -> number` | Complex argument (phase angle) of a number. |
| `BesselI` | `(order: complex, complex \| infinity) -> number` | Modified Bessel function of the first kind |
| `BesselJ` | `(order: complex, complex \| infinity) -> number` | Bessel function of the first kind |
| `BesselK` | `(order: complex, complex \| infinity) -> number` | Modified Bessel function of the second kind (Macdonald function) |
| `BesselY` | `(order: complex, complex \| infinity) -> number` | Bessel function of the second kind (Neumann function) |
| `Beta` | `(complex \| infinity, complex \| infinity) -> number` | Euler beta function |
| `CatalanConstant` | constant `real<0.915965594177219..0.9159655941772191>` = `0.915965594177219015055` | Catalan's constant G ≈ 0.9160. |
| `Ceil` | `(real \| signed_infinity) -> integer \| signed_infinity` | Rounds a number up to the next largest integer |
| `Chop` | `(T) -> T where T: number` | Replace tiny numeric values with zero. |
| `Clamp` | `(real \| signed_infinity, real \| signed_infinity, real \| signed_infinity) -> real \| signed_infinity` | Clamp a value to the range [lo, hi] = min(max(x, lo), hi). |
| `Complex` | `(real: number, imaginary: number) -> complex` | Construct a complex number from real and imaginary parts. |
| `ComplexInfinity` | constant `number` = `~oo` | Complex infinity, a single unsigned infinity in the complex plane. |
| `ComplexRoots` | `(complex, integer) -> list<number>` | All n-th complex roots of a number. |
| `Conjugate` | `(T) -> T where T: number` | Complex conjugate of a number. |
| `ContinuationPlaceholder` | constant `unknown` | This symbol indicates that some elements in a collection have been omitted, for example in a long list of numbers, or in an infinite set |
| `Denominator` | `(number) -> nothing \| number` | Denominator of an expression |
| `Digamma` | `(complex \| infinity) -> number` | Digamma function, the logarithmic derivative of the gamma function |
| `Distance` | `(list<list<number>> \| list<number> \| list<tuple> \| tuple, list<list<number>> \| list<number> \| list<tuple> \| tuple) -> number` | Euclidean distance between two points, broadcasting over a list of points. |
| `Divide` | `(complex \| infinity, (complex \| infinity)+) -> number` | Quotient of a numerator and one or more denominators. |
| `ElementMax` | `(real \| signed_infinity, (real \| signed_infinity)+) -> real \| signed_infinity` | Element-wise maximum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. |
| `ElementMin` | `(real \| signed_infinity, (real \| signed_infinity)+) -> real \| signed_infinity` | Element-wise minimum: broadcasts scalars over collections (and zips collections), returning a collection; all-scalar arguments give a scalar. |
| `EulerGamma` | constant `real<0.5772156649015328..0.5772156649015329>` = `0.577215664901532860607` | The Euler–Mascheroni constant γ ≈ 0.5772. |
| `Exp` | `(number) -> number` | Natural exponential function: e^x. |
| `Exp2` | `(number) -> number` | Base-2 exponential: 2^x |
| `ExponentialE` | constant `real<2.718281828459045..2.718281828459046>` = `2.71828182845904523536` | Euler's number e ≈ 2.71828, the base of the natural logarithm. |
| `Factorial` | `(complex \| infinity) -> number` | Factorial function: the product of all positive integers less than or equal to n |
| `Factorial2` | `(complex \| infinity) -> number` | Double Factorial Function |
| `Floor` | `(real \| signed_infinity) -> integer \| signed_infinity` | Rounds a number down to the nearest integer. |
| `Fract` | `(real \| signed_infinity) -> real<0..1>` | Fractional part of a number: x - floor(x) |
| `GCD` | `(any*) -> number` | Greatest Common Divisor |
| `Gamma` | `(complex \| infinity, (complex \| infinity)?) -> number` | Gamma function Γ(z); with two arguments, the upper incomplete gamma Γ(s, z) = ∫_z^∞ tˢ⁻¹ e⁻ᵗ dt. |
| `GammaLn` | `(complex \| infinity) -> number` | Natural logarithm of the gamma function. |
| `GoldenRatio` | constant `real<1.618033988749894..1.618033988749895>` = `1/2 * (1 + sqrt(5))` | The golden ratio φ = (1+√5)/2 ≈ 1.618. |
| `Half` | constant `rational` = `1/2` | The rational number one half (1/2). |
| `Heaviside` | `(real \| signed_infinity) -> rational<0..1>` | Heaviside step function. |
| `Im` | `(complex \| infinity) -> number` | `Im` is an alias for `Imaginary`, which is the preferred name. |
| `Imaginary` | `(complex \| infinity) -> number` | Imaginary part of a complex number. |
| `ImaginaryUnit` | constant `imaginary` = `i` | The imaginary unit, whose square is −1. |
| `Infimum` | `(value*) -> number` | Like Min, but defined for open sets |
| `Interpret` | `(any) -> any` | Interpret a notational expression as its mathematical meaning. |
| `IsComposite` | `(number) -> boolean` | `IsComposite(n)` returns `True` if `n` is a composite number |
| `IsEven` | `(number) -> boolean` | `IsEven(n)` returns `True` if `n` is an even number |
| `IsOdd` | `(number) -> boolean` | `IsOdd(n)` returns `True` if `n` is an odd number |
| `IsPrime` | `(number) -> boolean` | `IsPrime(n)` returns `True` if `n` is a prime number |
| `LCM` | `(any*) -> number` | Least Common Multiple |
| `LambertW` | `(complex \| infinity, number?) -> number` | Lambert W function (product logarithm) |
| `Lb` | `(number) -> number` | Base-2 Logarithm |
| `Lg` | `(number) -> number` | Base-10 Logarithm |
| `Ln` | `(complex \| infinity, base: (complex \| infinity)?) -> complex \| infinity` | Natural Logarithm |
| `Log` | `(complex \| infinity, base: (complex \| infinity)?) -> number` | Log(z, b = 10) = Logarithm of base b |
| `Log10` | `(number) -> number` | Base-10 Logarithm |
| `Log2` | `(number) -> number` | Base-2 Logarithm |
| `MachineEpsilon` | constant `real` = `2.220446049250313e-16` | The difference between 1 and the next larger floating point number (machine epsilon). |
| `Max` | `(value*) -> number` | Maximum of two or more numbers |
| `Measurement` | `(value, value) -> value` | A nominal value carrying a 1σ absolute uncertainty. |
| `Min` | `(value+) -> number` | Minimum of two or more numbers |
| `Mod` | `(real, real) -> real` | Modulo: the remainder of the floored division of x by y. |
| `Multiply` | `(number*) -> number` | Product of two or more values. |
| `NaN` | constant `number` = `NaN` | Not a Number, the result of an undefined or unrepresentable numeric operation. |
| `Negate` | `(complex \| infinity) -> number` | Additive Inverse |
| `NegativeInfinity` | constant `-oo` = `-oo` | Negative infinity (−∞). |
| `Numerator` | `(number) -> nothing \| number` | Numerator of an expression |
| `NumeratorDenominator` | `(number) -> nothing \| tuple<number, number>` | Sequence of Numerator and Denominator of an expression |
| `PlusMinus` | `(T, U) -> tuple<T, U> where T: value, U: value` | Plus or Minus |
| `PolyGamma` | `(order: integer, complex \| infinity) -> number` | Polygamma function, the n-th derivative of the digamma function |
| `PositiveInfinity` | constant `+oo` = `+oo` | Positive infinity (+∞). |
| `Power` | `(complex \| infinity, complex \| signed_infinity) -> number` | Exponentiation: raise a base to a power. |
| `PreDecrement` | `(number) -> number` | Decrement a number by one. |
| `PreIncrement` | `(number) -> number` | Increment a number by one. |
| `Product` | `(any, tuple*) -> number` | `Product(f, a, b)` computes the product of `f` from `a` to `b` |
| `Rational` | `((integer, integer) -> rational) \| ((real) -> rational)` | Construct a rational number from a numerator and denominator. |
| `Rationalize` | `(real, real<0..>?) -> rational` | Approximate a real number by a rational. |
| `Re` | `(complex \| infinity) -> number` | `Re` is an alias for `Real`, which is the preferred name. |
| `Real` | `(complex \| infinity) -> number` | Real part of a complex number. |
| `Remainder` | `(T, T) -> T where T: number` | IEEE remainder: the signed remainder after dividing x by y, with the quotient rounded to the nearest integer (ties round toward +Infinity, matching JavaScript `Math.round`) |
| `Root` | `(complex \| infinity, complex \| infinity) -> number` | n-th root of a value. |
| `Round` | `(real \| signed_infinity, integer?) -> real \| signed_infinity` | Rounds a number to the nearest integer, or (with a precision argument) to `n` decimal places. |
| `Sign` | `(complex \| signed_infinity) -> complex` | Sign of a number: -1, 0, or 1 for a real; `z/\|z\|`, the point of the unit circle in its direction, for a complex `z`. |
| `Sqrt` | `(complex \| infinity) -> complex \| infinity` | Square Root |
| `Square` | `(number) -> number` | Square of a number: x^2. |
| `Subtract` | `(number+) -> number` | Difference between two or more values. |
| `Sum` | `(any, tuple*) -> number` | `Sum(f, [a, b])` computes the sum of `f` from `a` to `b`; `Sum(L)` sums the elements of a collection `L` |
| `Supremum` | `(value*) -> number` | Like Max, but defined for open sets |
| `Trigamma` | `(complex \| infinity) -> number` | Trigamma function, the derivative of the digamma function |
| `Truncate` | `(real \| signed_infinity) -> integer \| signed_infinity` | Rounds a number towards zero (removes the fractional part) |
| `Zeta` | `(complex \| infinity) -> number` | Riemann zeta function |
| `e` | constant `real<2.718281828459045..2.718281828459046>` = `e` | Euler's number e ≈ 2.71828, the base of the natural logarithm. |
| `i` | constant `imaginary` = `i` | The imaginary unit, whose square is −1. |

### Examples

```epsil
Rationalize(1.75)
// ➔ 7/4
```

```epsil
Rationalize(Sqrt(3), 1/500)
// ➔ 26/15
```

## Trigonometry

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `Arccos` | `(complex) -> number` | Arccosine, the inverse cosine function. |
| `Arccot` | `(complex \| signed_infinity) -> number` | Arccotangent, the inverse cotangent function. |
| `Arccsc` | `(complex \| infinity) -> number` | Arccosecant, the inverse cosecant function. |
| `Arcosh` | `(complex \| signed_infinity) -> number` | Inverse hyperbolic cosine (area hyperbolic cosine). |
| `Arcoth` | `(complex \| infinity) -> number` | Inverse hyperbolic cotangent (area hyperbolic cotangent). |
| `Arcsch` | `(complex \| infinity) -> number` | Inverse hyperbolic cosecant (area hyperbolic cosecant). |
| `Arcsec` | `(complex \| infinity) -> number` | Arcsecant, the inverse secant function. |
| `Arcsin` | `(complex) -> number` | Arcsine, the inverse sine function. |
| `Arctan` | `(complex \| signed_infinity) -> number` | Inverse tangent. |
| `Arctan2` | `(y: real \| signed_infinity, x: real \| signed_infinity) -> real` | Two-argument arctangent giving the angle of a vector. |
| `Arsech` | `(complex \| signed_infinity) -> number` | Inverse hyperbolic secant (area hyperbolic secant). |
| `Arsinh` | `(complex \| signed_infinity) -> number` | Inverse hyperbolic sine (area hyperbolic sine). |
| `Artanh` | `(complex \| signed_infinity) -> number` | Inverse hyperbolic tangent (area hyperbolic tangent). |
| `Cos` | `(complex) -> number` | Cosine of an angle. |
| `CosIntegral` | `(complex \| infinity) -> number` | Cosine integral: γ + ln(x) + ∫₀ˣ (cos(t)−1)/t dt. |
| `Cosh` | `(complex \| signed_infinity) -> number` | Hyperbolic cosine. |
| `CoshIntegral` | `(complex \| infinity) -> number` | Hyperbolic cosine integral: γ + ln\|x\| + ∫₀ˣ (cosh(t)−1)/t dt. |
| `Cot` | `(complex) -> number` | Cotangent, the reciprocal of tangent. |
| `Coth` | `(complex \| signed_infinity) -> number` | Hyperbolic cotangent, the reciprocal of hyperbolic tangent. |
| `Csc` | `(complex) -> number` | Cosecant, the reciprocal of sine. |
| `Csch` | `(complex \| signed_infinity) -> number` | Hyperbolic cosecant, the reciprocal of hyperbolic sine. |
| `DMS` | `(number, number?, number?) -> number` | Construct an angle from degrees, minutes, and seconds. |
| `Degrees` | `(real) -> real` | Convert an angle in degrees. |
| `FresnelC` | `(complex \| signed_infinity) -> complex` | Fresnel cosine integral. |
| `FresnelS` | `(complex \| signed_infinity) -> complex` | Fresnel sine integral. |
| `Haversine` | `(real) -> number` | Haversine function. |
| `Hypot` | `(infinity \| real, infinity \| real) -> +oo \| nan \| real` | Hypotenuse length: sqrt(x^2 + y^2). |
| `InverseFunction` | `(function) -> function` | Inverse of a function. |
| `InverseHaversine` | `(real) -> number` | Inverse haversine function. |
| `Pi` | constant `real<3.141592653589793..3.141592653589794>` = `3.14159265358979323846` | The constant π ≈ 3.14159, the ratio of a circle's circumference to its diameter. |
| `Sec` | `(complex) -> number` | Secant, the reciprocal of cosine. |
| `Sech` | `(complex \| signed_infinity) -> number` | Hyperbolic secant, the reciprocal of hyperbolic cosine. |
| `Sin` | `(complex) -> number` | Sine of an angle. |
| `SinIntegral` | `(complex \| infinity) -> number` | Sine integral: ∫₀ˣ sin(t)/t dt. |
| `Sinc` | `(complex \| signed_infinity) -> complex` | Unnormalized sinc function: sin(x)/x with sinc(0)=1. |
| `Sinh` | `(complex \| signed_infinity) -> number` | Hyperbolic sine. |
| `SinhIntegral` | `(complex \| infinity) -> number` | Hyperbolic sine integral: ∫₀ˣ sinh(t)/t dt. |
| `Tan` | `(complex) -> number` | Tangent of an angle. |
| `Tanh` | `(complex \| signed_infinity) -> number` | Hyperbolic tangent. |
| `TrigExpand` | `(value) -> value` | Expand trigonometric and hyperbolic functions of sums and integer multiples of angles. |
| `TrigReduce` | `(value) -> value` | Rewrite products and integer powers of trigonometric and hyperbolic functions as a linear combination of functions of multiple angles (the inverse of TrigExpand). |
| `TrigToExp` | `(value) -> value` | Rewrite trigonometric and hyperbolic functions in terms of the complex exponential, exactly. |

## Calculus

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `BigO` | `(value) -> number` | Landau big-O remainder term. |
| `CircularIntegrate` | `(function, limits+) -> number` | Contour (closed-path) integral. |
| `D` | `(expression, variables: symbol*) -> expression` | Symbolic partial derivative with respect to one or more variables. |
| `DSolve` | `(expression, symbol, symbol) -> expression` | Symbolic differential equation solver. |
| `Derivative` | `(function, order: number*) -> function` | Derivative operator that returns a derivative function. |
| `Integrate` | `(function, limits+) -> number` | Symbolic integral with optional bounds. |
| `InterpolatingFunction` | `(list<any>, number?) -> number` | Piecewise-quartic dense-output interpolant of a numeric ODE solution (produced by `NDSolveFunction`). |
| `JacobianMatrix` | `(any, any?) -> value` | JacobianMatrix(fs, vars): the matrix of partial derivatives |
| `Limit` | `(function, point: number, direction: number?) -> number` | Limit of a function |
| `Limits` | `(index: symbol, lower: value, upper: value) -> tuple` | Limits of a function |
| `ND` | `(function, at: number) -> number` | Numerical derivative evaluated at a point. |
| `NDSolve` | `(expression, symbol, limits: symbol \| tuple, number, number?) -> list` | Numerical differential equation solver. |
| `NDSolveFunction` | `(expression, symbol, limits: symbol \| tuple, number) -> function` | Numerically solve an ordinary differential equation and return the solution as an applicable function (a `Function` literal wrapping an `InterpolatingFunction`), usable at any point of the integration interval. |
| `NIntegrate` | `(function, limits: (symbol \| tuple)?) -> number` | Numerical approximation of a definite integral. |
| `NLimit` | `(function, point: number, direction: number?) -> number` | Numerical approximation of the limit of a function |
| `Normal` | `(value) -> value` | Strip Big-O remainder terms from a series, yielding the truncated polynomial. |
| `RSolve` | `(expression, symbol, symbol) -> expression` | Symbolic recurrence equation solver. |
| `Residue` | `(expression, variable: symbol, point: value) -> number` | Residue of a function at a point (the coefficient of (x-a)⁻¹ in its Laurent expansion) |
| `Series` | `(expression, variable: symbol?, point: value?, order: number?) -> number` | Taylor series expansion of an expression about a point (or an asymptotic expansion at ±∞), including Laurent, Puiseux (fractional-power), and log-aware expansions at poles and branch points. |

## Polynomials

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `Apart` | `(value, symbol?) -> value` | Alias for PartialFraction. |
| `Cancel` | `(value, symbol?) -> value` | Cancel common polynomial factors in the numerator and denominator of a rational expression. |
| `CoefficientList` | `(value, symbol?) -> list<value>` | Return the list of coefficients of a polynomial, from highest to lowest degree. |
| `Discriminant` | `(value, symbol?) -> value` | Return the discriminant of a polynomial. |
| `Distribute` | `(value) -> value` | Distribute multiplication over addition |
| `Expand` | `(value) -> value` | Expand out products and positive integer powers |
| `ExpandAll` | `(value) -> value` | Recursively expand out products and positive integer powers |
| `Factor` | `(value, symbol?) -> value` | Factor a polynomial expression into a product of irreducible factors. |
| `PartialFraction` | `(value, symbol?) -> value` | Decompose a rational expression into partial fractions. |
| `Polynomial` | `(list<value>, symbol) -> value` | Construct a polynomial from a list of coefficients (highest to lowest degree) and a variable. |
| `PolynomialDegree` | `(value, symbol?) -> integer` | Return the degree of a polynomial with respect to a variable. |
| `PolynomialGCD` | `(a: value, b: value, variable: symbol?) -> value` | Return the greatest common divisor of two polynomials. |
| `PolynomialQuotient` | `(dividend: value, divisor: value, variable: symbol?) -> value` | Return the quotient of polynomial division of dividend by divisor. |
| `PolynomialRemainder` | `(dividend: value, divisor: value, variable: symbol?) -> value` | Return the remainder of polynomial division of dividend by divisor. |
| `PolynomialRoots` | `(value, symbol?) -> set<value>` | Return the roots of a polynomial expression. |
| `Resultant` | `(a: value, b: value, variable: symbol?) -> value` | Return the resultant of two polynomials with respect to a variable. |
| `Together` | `(value) -> value` | Combine rational expressions into a single fraction |

## Combinatorics

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `BellNumber` | `(integer) -> integer` | Compute the Bell number B(n), the number of partitions of a set of n elements. |
| `Binomial` | `(complex \| infinity, complex \| infinity) -> number` | Compute the binomial coefficient C(n, k) = n! / (k! |
| `CartesianProduct` | `(set<any>+) -> set` | Return the Cartesian product of input sets. |
| `Choose` | `(n: complex \| infinity, m: complex \| infinity) -> number` | Binomial coefficient: number of ways to choose k items from n. |
| `Combinations` | `((S, integer) -> list<string> where S: string) & ((collection, integer) -> list<list>)` | Return all k-element combinations of a collection. |
| `Fibonacci` | `(integer) -> integer` | Compute the nth Fibonacci number. |
| `Multinomial` | `(integer+) -> integer` | Compute the multinomial coefficient for multiple integers. |
| `Permutations` | `((S, integer?) -> list<string> where S: string) & ((collection, integer?) -> list<list>)` | Return all permutations of length k (default full length) of a collection. |
| `Pochhammer` | `(complex \| infinity, complex \| infinity) -> number` | Rising factorial (Pochhammer symbol) (a)_k = a(a+1)…(a+k-1). |
| `PowerSet` | `(set<any>) -> set` | Return the power set of a set (set of all subsets). |
| `Subfactorial` | `(integer) -> integer` | Compute the number of derangements (subfactorial) of n items. |

## Number theory

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `BernoulliB` | `(integer) -> rational` | Return the nth Bernoulli number Bₙ as an exact rational, using the convention B₁ = -1/2. |
| `CarmichaelLambda` | `(integer) -> integer` | Return the Carmichael function λ(n) (the reduced totient): the smallest positive integer `m` such that `a^m ≡ 1 (mod n)` for every `a` coprime to `n`. |
| `CatalanNumber` | `(integer) -> integer` | Return the nth Catalan number `C(n) = (2n)! / ((n+1)! · n!)`: 1, 1, 2, 5, 14, 42, … Defined for `n ≥ 0`. |
| `ChineseRemainder` | `(collection<any>, collection<any>) -> integer` | Solve a system of simultaneous congruences: return the smallest non-negative integer `x` such that `x ≡ residues[i] (mod moduli[i])` for every `i`. |
| `ContinuedFraction` | `(real, integer?) -> list<integer>` | Return the continued-fraction expansion of `x` as a list of integer terms `[a0, a1, …]`. |
| `DigitCount` | `(integer, integer?, integer?) -> integer \| list<integer>` | Count digits of `n` in the given `base` (default 10); the sign of `n` is ignored. |
| `DigitSum` | `(integer, integer?) -> integer` | Return the sum of the digits of `n` in the given `base` (default 10). |
| `Divides` | `(integer, integer) -> boolean` | `Divides(a, b)` returns `True` if `a` divides `b` (i.e. |
| `DivisorSigma` | `(integer, integer) -> integer` | The divisor function σ_k(n) = Σ_&#123;d \| n&#125; dᵏ over the positive divisors of `n`. σ₀ counts divisors, σ₁ sums them. |
| `Divisors` | `(integer) -> list<integer>` | Return the sorted list of positive divisors of an integer `n`. |
| `Eulerian` | `(integer, integer) -> integer` | Eulerian number A(n, m): number of permutations of &#123;1..n&#125; with exactly m ascents. |
| `ExtendedGCD` | `(integer, integer) -> tuple<integer, integer, integer>` | Return the extended GCD of `a` and `b` as a tuple `(g, x, y)` where `g = gcd(a, b)` is non-negative and `a·x + b·y = g` (Bézout coefficients). |
| `FactorInteger` | `(integer) -> list<tuple<integer, integer>>` | Return the prime factorization of an integer `n` as a list of `[prime, exponent]` tuples, ordered by ascending prime. |
| `FromContinuedFraction` | `(collection<any>) -> number` | Reconstruct the (rational) value of a continued fraction given its list of integer terms `[a0, a1, …]`. |
| `FromDigits` | `(collection<any>, integer?) -> integer` | Reconstruct an integer from its list of digits (most-significant first) in the given `base` (default 10). |
| `IntegerDigits` | `(integer, integer?, integer?) -> list<integer>` | Return the digits of `n` in the given `base` (default 10), most-significant first. |
| `IntegerSqrt` | `(integer) -> integer` | Return the integer square root of `n`, i.e. the largest integer `m` such that `m² ≤ n`. |
| `IsAbundant` | `(integer) -> boolean` | True if n is an abundant number (sum of divisors &gt; 2n). |
| `IsCenteredSquare` | `(integer) -> boolean` | True if n is a centered square number. |
| `IsHappy` | `(integer) -> boolean` | True if n is a happy number, a number which eventually reaches 1 when the number is replaced by the sum of the square of each digit |
| `IsOctahedral` | `(integer) -> boolean` | True if n is an octahedral number. |
| `IsPerfect` | `(integer) -> boolean` | Returns "True" if n is a perfect number, a positive integer which equals the sum of all its divisors. |
| `IsPerfectPower` | `(integer) -> boolean` | Return `"True"` if `n` is a perfect power `a^b` for integers `a` and `b ≥ 2` (a negative `n` requires an odd exponent). |
| `IsSquare` | `(integer) -> boolean` | True if n is a perfect square. |
| `IsSquareFree` | `(integer) -> boolean` | Return `"True"` if `n` is square-free (not divisible by any perfect square &gt; 1). |
| `IsTriangular` | `(integer) -> boolean` | True if n is a triangular number. |
| `JacobiSymbol` | `(integer, integer) -> integer` | The Jacobi symbol (a/n) for an odd `n > 0`. |
| `LegendreSymbol` | `(integer, integer) -> integer` | The Legendre symbol (a/p) for an odd prime `p`. |
| `Lucas` | `(integer) -> integer` | `Lucas` is an alias for `LucasL`, which is the preferred name. |
| `LucasL` | `(integer) -> integer` | Return the nth Lucas number: `LucasL(0)` is 2, `LucasL(1)` is 1, and `LucasL(n) = LucasL(n-1) + LucasL(n-2)`. |
| `ModularInverse` | `(integer, integer) -> integer` | Return the modular multiplicative inverse of `a` modulo `m`: the integer `x` in [0, m) with `a·x ≡ 1 (mod m)`. |
| `MoebiusMu` | `(integer) -> integer` | Return the Möbius function μ(n): 0 if `n` is divisible by a perfect square &gt; 1, otherwise (-1) raised to the number of distinct prime factors. |
| `MultiplicativeOrder` | `(integer, integer) -> integer` | The multiplicative order of `a` modulo `n`: the smallest `k > 0` such that `a^k ≡ 1 (mod n)`. |
| `NPartition` | `(integer) -> integer` | Number of integer partitions of n. |
| `NextPrime` | `(integer, integer?) -> integer` | Return the smallest prime greater than `n`. |
| `NotDivides` | `(integer, integer) -> boolean` | `NotDivides(a, b)` returns `True` if `a` does not divide `b`, corresponding to the notation `a ∤ b`. |
| `NthPrime` | `(integer) -> integer` | Return the nth prime number (1-based): `NthPrime(1)` is 2, `NthPrime(2)` is 3, … |
| `PowerMod` | `(integer, integer, integer) -> integer` | Return `a^b mod m` (modular exponentiation). |
| `PrimeFactors` | `(integer) -> list<integer>` | Return the sorted list of distinct prime factors of an integer `n`. |
| `PrimeNu` | `(integer) -> integer` | Return ω(n), the number of distinct prime factors of `n`. |
| `PrimeNumber` | `(integer) -> integer` | The nth prime number. |
| `PrimeOmega` | `(integer) -> integer` | Return Ω(n), the number of prime factors of `n` counted with multiplicity. |
| `PrimePi` | `(real) -> integer` | Return π(n), the prime-counting function: the number of primes less than or equal to `n`. |
| `PrimitiveRoot` | `(integer) -> integer` | The smallest primitive root modulo `n` (a generator of the multiplicative group of integers mod `n`), or undefined if none exists (which happens unless `n` is 1, 2, 4, pᵏ, or 2pᵏ for an odd prime p). |
| `Radical` | `(integer) -> integer` | Return the radical of `n` (its square-free kernel): the product of its distinct prime factors. |
| `RandomPrime` | `(integer, integer?) random -> integer` | Return a random prime. |
| `Sigma0` | `(integer) -> integer` | Number of positive divisors of n. |
| `Sigma1` | `(integer) -> integer` | Sum of positive divisors of n. |
| `SigmaMinus1` | `(integer) -> rational` | Sum of reciprocals of positive divisors of n. |
| `Stirling` | `(integer, integer) -> integer` | Stirling number of the second kind S(n, m): ways to partition n elements into m non-empty subsets. |
| `StirlingS1` | `(integer, integer) -> integer` | Signed Stirling number of the first kind s(n, m): the coefficient of x^m in the falling factorial x(x−1)…(x−n+1). |
| `Totient` | `(integer) -> integer` | Euler's totient function φ(n): count of positive integers ≤ n that are coprime to n. |

### Examples

```epsil
BernoulliB(2)
// ➔ 1/6
```

```epsil
CarmichaelLambda(15)
// ➔ 4
```

```epsil
CatalanNumber(5)
// ➔ 42
```

```epsil
ChineseRemainder([2, 3, 2], [3, 5, 7])
// ➔ 23
```

```epsil
ContinuedFraction(43/19)
// ➔ [2,3,1,4]
```

```epsil
DigitCount(122, 10, 2)
// ➔ 2
```

```epsil
DigitSum(1234)
// ➔ 10
```

```epsil
Divides(3, 12)
// ➔ "True"
```

```epsil
DivisorSigma(2, 6)
// ➔ 50
```

```epsil
Divisors(12)
// ➔ [1,2,3,4,6,12]
```

```epsil
ExtendedGCD(12, 18)
// ➔ (6, -1, 1)
```

```epsil
FactorInteger(360)
// ➔ [(2, 3),(3, 2),(5, 1)]
```

```epsil
FromContinuedFraction([2, 3, 1, 4])
// ➔ 43/19
```

```epsil
FromDigits([1, 2, 3, 4])
// ➔ 1234
```

```epsil
IntegerDigits(255, 16)
// ➔ [15,15]
```

```epsil
IntegerSqrt(17)
// ➔ 4
```

```epsil
IsPerfectPower(64)
// ➔ "True"
```

```epsil
IsSquareFree(30)
// ➔ "True"
```

```epsil
JacobiSymbol(5, 21)
// ➔ 1
```

```epsil
LegendreSymbol(3, 7)
// ➔ -1
```

```epsil
LucasL(10)
// ➔ 123
```

```epsil
ModularInverse(3, 7)
// ➔ 5
```

```epsil
MoebiusMu(30)
// ➔ -1
```

```epsil
MultiplicativeOrder(2, 7)
// ➔ 3
```

```epsil
NextPrime(10)
// ➔ 11
```

```epsil
NextPrime(10, -1)
// ➔ 7
```

```epsil
NthPrime(10)
// ➔ 29
```

```epsil
PowerMod(2, 10, 1000)
// ➔ 24
```

```epsil
PrimeFactors(360)
// ➔ [2,3,5]
```

```epsil
PrimeNu(360)
// ➔ 3
```

```epsil
PrimeOmega(360)
// ➔ 6
```

```epsil
PrimePi(10)
// ➔ 4
```

```epsil
PrimitiveRoot(7)
// ➔ 3
```

```epsil
Radical(360)
// ➔ 30
```

```epsil
RandomPrime(100)
```

```epsil
StirlingS1(5, 2)
// ➔ -50
```

## Special functions

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `AGM` | `(complex \| infinity, (complex \| infinity)?) -> number` | Arithmetic-geometric mean. |
| `AppellF1` | `(complex \| infinity, complex \| infinity, complex \| infinity, complex \| infinity, complex \| infinity, complex \| infinity) -> number` | Appell hypergeometric function F₁(a; b₁, b₂; c; x, y), double series for \|x\|, \|y\| &lt; 1. |
| `DedekindEta` | `(complex \| infinity) -> number` | Dedekind eta function η(τ), Im(τ) &gt; 0. |
| `EisensteinE` | `(number, complex \| infinity) -> number` | Normalized Eisenstein series Eₛ(τ) of even weight s ≥ 2, Im(τ) &gt; 0. |
| `EllipticE` | `(complex \| infinity, (complex \| infinity)?) -> number` | Elliptic integral of the second kind: complete E(m) with one argument, incomplete E(φ\|m) with two (amplitude first, parameter convention m = k², as in Mathematica). |
| `EllipticF` | `(complex \| infinity, complex \| infinity) -> number` | Incomplete elliptic integral of the first kind F(φ\|m) (amplitude first, parameter convention m = k², as in Mathematica). |
| `EllipticK` | `(complex \| infinity) -> number` | Complete elliptic integral of the first kind K(m), parameter convention m = k². |
| `EllipticPi` | `(complex \| infinity, complex \| infinity, (complex \| infinity)?) -> number` | Elliptic integral of the third kind: complete Π(n\|m) with two arguments, incomplete Π(n; φ\|m) with three (characteristic first, amplitude second, parameter convention m = k², as in Mathematica). |
| `ExpIntegralEi` | `(complex \| infinity) -> number` | Exponential integral Ei(x) = PV ∫_&#123;−∞&#125;^x eᵗ/t dt. |
| `Hypergeometric1F1` | `(complex \| infinity, complex \| infinity, complex \| infinity) -> number` | Kummer confluent hypergeometric function ₁F₁(a; b; z) = M(a, b, z). |
| `Hypergeometric2F1` | `(complex \| infinity, complex \| infinity, complex \| infinity, complex \| infinity) -> number` | Gauss hypergeometric function ₂F₁(a, b; c; z). |
| `JacobiTheta` | `(number, complex \| infinity, complex \| infinity, number?) -> number` | Jacobi theta function θⱼ(z, τ), j ∈ &#123;1,2,3,4&#125;, nome q = e^&#123;iπτ&#125; (Fungrim convention). |
| `LogIntegral` | `(complex \| infinity) -> number` | Logarithmic integral li(x) = PV ∫₀ˣ dt/ln t = Ei(ln x). |
| `PolyLog` | `(complex \| infinity, complex \| infinity) -> number` | Polylogarithm Liₛ(z) = Σ_&#123;k≥1&#125; zᵏ/kˢ. |

## Linear algebra

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `AdjugateMatrix` | `(matrix) -> matrix` | Adjugate (classical adjoint) of a square matrix. |
| `CharacteristicPolynomial` | `(matrix, any?) -> expression` | Characteristic polynomial det(x·I − A) of a square matrix (monic). |
| `CholeskyDecomposition` | `(matrix) -> matrix` | Cholesky decomposition of a positive-definite matrix. |
| `ConjugateTranspose` | `(value, axis1: integer?, axis2: integer?) -> value` | Conjugate transpose (Hermitian adjoint) of a matrix or tensor. |
| `Cross` | `(tuple \| vector, tuple \| vector) -> vector` | Cross product of two 3-vectors. |
| `Degree` | `(value) -> integer` | Degree of an object |
| `Determinant` | `(matrix) -> number` | Determinant of a square matrix. |
| `Diagonal` | `(value) -> value` | Extract a matrix diagonal or build a diagonal matrix. |
| `Dimension` | `(value) -> integer` | Dimension of an object |
| `Dot` | `(matrix \| tuple \| vector, matrix \| tuple \| vector) -> value` | Dot product (vector inner product) or matrix product. |
| `Eigen` | `(matrix) -> tuple` | Eigenvalue-eigenvector decomposition of a square matrix. |
| `Eigenvalues` | `(matrix) -> list` | Eigenvalues of a square matrix. |
| `Eigenvectors` | `(matrix) -> list` | Eigenvectors of a square matrix. |
| `Flatten` | `(value, integer?) -> list` | Flatten a tensor or collection into a list. |
| `HadamardProduct` | `(matrix \| vector, matrix \| vector) -> matrix \| vector` | Hadamard (element-wise) product of two vectors or matrices of the same shape. |
| `Hom` | `(value*) -> value` | Hom-set of morphisms between objects |
| `IdentityMatrix` | `(integer) -> matrix` | n-by-n identity matrix. |
| `Inverse` | `(T) -> T where T: matrix` | Multiplicative inverse of a square matrix. |
| `IsDiagonal` | `(value) -> boolean` | Whether the matrix is diagonal (all off-diagonal entries are zero). |
| `IsSquareMatrix` | `(value) -> boolean` | Whether the value is a square matrix. |
| `IsSymmetric` | `(value) -> boolean` | Whether the matrix is symmetric (A equals its transpose). |
| `Kernel` | `(value) -> list` | Kernel (null space) of a linear map |
| `LUDecomposition` | `(matrix) -> tuple` | LU decomposition of a square matrix. |
| `LinearSolve` | `(matrix, matrix \| vector) -> value` | Solve the linear system A·x = b for x. |
| `Matrix` | `(matrix, string?, string?) -> matrix` | Matrix constructor and canonicalizer. |
| `MatrixMultiply` | `(matrix \| vector, matrix \| vector) -> matrix \| vector` | Matrix and vector multiplication. |
| `MatrixPower` | `(matrix, real) -> matrix` | Square matrix raised to a power. |
| `MatrixRank` | `(value) -> integer` | Rank of a matrix (number of linearly independent rows/columns). |
| `Norm` | `(list<number> \| list<tuple> \| number \| tuple, (+oo \| real \| string)?) -> +oo \| nan \| real` | Vector or matrix norm. |
| `OnesMatrix` | `(integer, integer?) -> matrix` | Matrix filled with ones. |
| `PseudoInverse` | `(matrix) -> matrix` | Moore-Penrose pseudoinverse of a matrix. |
| `QRDecomposition` | `(matrix) -> tuple` | QR decomposition of a matrix. |
| `Rank` | `(value) -> integer` | The length of the shape of the expression. |
| `Reshape` | `(value, tuple) -> value` | Reshape a tensor or collection to a target shape. |
| `RowReduce` | `(matrix) -> matrix` | Reduced row echelon form (RREF) of a matrix. |
| `SVD` | `(matrix) -> tuple` | Singular value decomposition of a matrix. |
| `Shape` | `(value) -> tuple` | Return the shape tuple of an expression. |
| `SingularValues` | `(matrix) -> list` | The singular values of a matrix, sorted in descending order (including any zero values). |
| `Trace` | `(list<number> \| number, axis1: integer?, axis2: integer?) -> list<number> \| number` | Trace of a matrix or pair of tensor axes. |
| `Transpose` | `(value, axis1: integer?, axis2: integer?) -> value` | Transpose a matrix or swap two tensor axes. |
| `Vector` | `(any+) -> vector` | Construct a column vector. |
| `ZeroMatrix` | `(integer, integer?) -> matrix` | Matrix filled with zeros. |

## Statistics

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `BetaRegularized` | `(complex \| infinity, complex \| infinity, complex \| infinity) -> number` | Regularized incomplete beta function I_x(a, b) |
| `BinCounts` | `(collection<any>, list<number> \| number) -> list<number>` | Count the number of elements falling into each bin. |
| `BinomialDistribution` | `(integer<0..>, real<0..1>) -> expression<BinomialDistribution>` | Binomial distribution: number of successes in n independent trials, each with success probability p. |
| `CDF` | `(distribution, real \| signed_infinity) -> nan \| real<0..1>` | Cumulative distribution function P(X ≤ x) of a distribution. |
| `Correlation` | `(collection<any>, collection<any>?) -> nan \| real` | Pearson's correlation coefficient of paired data, given as two equal-length collections or one collection of (x, y) pairs. |
| `Covariance` | `(collection<any>, collection<any>?) -> nan \| real` | Sample covariance (n − 1 denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs. |
| `Erf` | `(complex \| signed_infinity) -> complex` | Gauss error function |
| `ErfInv` | `(complex \| infinity) -> number` | Inverse of the error function |
| `Erfc` | `(complex \| signed_infinity) -> complex` | Complementary error function: 1 - Erf(x) |
| `Erfi` | `(complex \| signed_infinity) -> complex \| signed_infinity` | Imaginary error function: -i·Erf(i·x) |
| `ExponentialDistribution` | `(real<0<..>) -> expression<ExponentialDistribution>` | Exponential distribution with rate parameter λ. |
| `FindFit` | `(any, any, any, any) -> dictionary` | Nonlinear least-squares fit of a model to data. |
| `GammaRegularized` | `(complex \| infinity, complex \| infinity) -> number` | Regularized upper incomplete gamma function Q(a, z) = Γ(a, z)/Γ(a) |
| `Histogram` | `(collection<any>, list<number> \| number) -> list<tuple<number, integer>>` | Compute a histogram of the values in a collection. |
| `InterquartileRange` | `((collection<any> \| number)+) -> +oo \| nan \| real<0..>` | Interquartile range (Q3 - Q1) of a collection. |
| `Kurtosis` | `((collection<any> \| number)+) -> nan \| real` | Kurtosis of a collection of numbers. |
| `LinearRegression` | `(any+) -> tuple<number, number>` | Least-squares linear fit b0 + b1·x. |
| `Mean` | `((collection<any> \| distribution \| number)+) -> number` | Arithmetic mean (average) of a collection of numbers. |
| `Median` | `((collection<any> \| number)+) -> nan \| real \| signed_infinity` | Median of a collection of numbers. |
| `Mode` | `((collection<any> \| number)+) -> nan \| real \| signed_infinity` | Most frequently occurring value in a collection. |
| `NormalDistribution` | `(real, real<0<..>) -> expression<NormalDistribution>` | Normal (Gaussian) distribution with mean μ and standard deviation σ. |
| `PDF` | `(distribution, real \| signed_infinity) -> nan \| real<0..>` | Probability density (continuous) or mass (discrete) function of a distribution, evaluated at x. |
| `PoissonDistribution` | `(real<0<..>) -> expression<PoissonDistribution>` | Poisson distribution with rate parameter λ. |
| `PolynomialFit` | `(any+) -> list<number>` | Least-squares polynomial fit of the given degree. |
| `PopulationCovariance` | `(collection<any>, collection<any>?) -> nan \| real` | Population covariance (n denominator) of paired data, given as two equal-length collections or one collection of (x, y) pairs. |
| `PopulationStandardDeviation` | `((collection<any> \| number)+) -> nan \| real<0..>` | Population Standard Deviation of a collection of numbers. |
| `PopulationVariance` | `((collection<any> \| number)+) -> nan \| real<0..>` | Population variance of a collection of numbers. |
| `Quantile` | `(collection<any> \| distribution, real<0..1>) -> nan \| real \| signed_infinity` | Quantile (inverse CDF): the least x with CDF(x) ≥ p, for p in [0, 1]. |
| `Quartiles` | `((collection<any> \| number)+) -> tuple<lower: nan \| real \| signed_infinity, mid: nan \| real \| signed_infinity, upper: nan \| real \| signed_infinity>` | Lower quartile, median, and upper quartile of a collection. |
| `RandomSample` | `((T, number) random -> T where T: string) & ((indexed_collection, number) random -> list)` | RandomSample(xs, k): a list of k elements drawn from the indexed collection `xs`, without replacement. "Without replacement" is over POSITIONS, not values: on a multiset, repeats are expected — RandomSample([1, 1, 2], 2) can return [1, 1]. |
| `Skewness` | `((collection<any> \| number)+) -> nan \| real` | Skewness of a collection of numbers. |
| `SlidingWindow` | `((S, integer, integer?) -> list<string> where S: string) & ((collection, integer, integer?) -> list<list>)` | Return overlapping sliding windows of fixed size over the collection. |
| `StandardDeviation` | `((collection<any> \| distribution \| number)+) -> nan \| real<0..>` | Sample Standard Deviation of a collection of numbers. |
| `UniformDistribution` | `(real, real) -> expression<UniformDistribution>` | Continuous uniform distribution on the interval [a, b]. |
| `Variance` | `((collection<any> \| distribution \| number)+) -> nan \| real<0..>` | Sample variance of a collection of numbers. |

### Examples

```epsil
BinCounts([1, 2, 2, 3], 3)
// ➔ [1,2,1]
```

```epsil
Histogram([1, 2, 2, 3], 3)
// ➔ [(1, 1),(1.6666666666666665, 2),(2.333333333333333, 1)]
```

```epsil
Median([3, 1, 4, 2])
// ➔ 5/2
```

```epsil
Mode([1, 2, 2, 3])
// ➔ 2
```

```epsil
Quartiles([1, 2, 3, 4, 5])
// ➔ (3/2, 3, 9/2)
```

```epsil
SlidingWindow([1, 2, 3, 4], 2)
// ➔ [[1,2],[2,3],[3,4]]
```

```epsil
SlidingWindow("abcd", 2)
// ➔ ["ab","bc","cd"]
```

## Units

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `IsCompatibleUnit` | `(value, value) -> value` | Check if two units have the same dimension |
| `Quantity` | `(value, value) -> value` | A value paired with a physical unit |
| `QuantityMagnitude` | `(value) -> value` | Extract the numeric value from a quantity |
| `QuantityUnit` | `(value) -> value` | Extract the unit from a quantity |
| `UnitConvert` | `(value, value) -> value` | Convert a quantity to a different compatible unit |
| `UnitDimension` | `(value) -> value` | Return the dimension vector of a unit |
| `UnitSimplify` | `(value) -> value` | Simplify a quantity unit to a named derived unit if possible |

## Physics

| Name | Signature | Summary |
|:-----|:----------|:--------|
| `AvogadroConstant` | constant `value` = `602214075999999987023872 mol^-1` | Avogadro constant |
| `BoltzmannConstant` | constant `value` = `1.380649e-23 J/K` | Boltzmann constant |
| `ElementaryCharge` | constant `value` = `1.602176634e-19 C` | Elementary electric charge |
| `GasConstant` | constant `value` = `8.314462618 J/mol⋅K` | Molar gas constant |
| `GravitationalConstant` | constant `value` = `6.6743e-11 m^3/kg⋅s^2` | Newtonian constant of gravitation |
| `Mu0` | constant `value` = `0.00000125663706212 N/A^2` | Vacuum permeability |
| `PlanckConstant` | constant `value` = `6.62607015e-34 J⋅s` | Planck constant |
| `SpeedOfLight` | constant `value` = `299792458 m/s` | Speed of light in vacuum |
| `StandardGravity` | constant `value` = `9.80665 m/s^2` | Standard acceleration due to gravity |
| `StefanBoltzmannConstant` | constant `value` = `5.670374419e-8 W/m^2⋅K^4` | Stefan-Boltzmann constant |
| `VacuumPermittivity` | constant `value` = `8.8541878128e-12 F/m` | Vacuum permittivity (electric constant) |
