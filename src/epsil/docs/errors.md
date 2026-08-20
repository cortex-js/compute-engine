---
title: Epsil Errors
sidebar_label: Errors
slug: /epsil/errors/
description: "Extended explanations for Epsil's diagnostic codes: what each error means, why the language works that way, and how to fix it."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. Source: src/epsil/error-explanations.ts;
# regenerate with `npm run doc` (scripts/build-error-docs.ts).
---
# Epsil Errors

Every Epsil diagnostic carries a stable, kebab-case code — `static-type-error`,
`mapsto-arrow-expected` — shown after the message in the editor and by
`epsil check`. The sections below are the extended explanations for the codes
that have more to say than their message already does; they are the same text
`epsil doc <code>` prints. In Visual Studio Code, clicking a
diagnostic's code opens its section on this page.

## `spread-tuple`

A spread (`...x`) in a list or set literal was given a tuple. Tuples are units — a point, a pair — so they do not splice into a surrounding collection; the spread would silently do nothing, which is why it is rejected instead.

To use a tuple's elements as list elements, convert explicitly: `ListFrom(t)` is the list of t's elements, so `[...ListFrom(t), 3]` splices them. (In a CALL argument list the rule is reversed: argument lists are tuple-shaped, so there `f(...t)` spreads exactly tuples.)

## `incompatible-type`

A value's type does not match what its context requires — a typed declaration (`let x: string = …`) whose initializer has a different type, an argument outside a function's signature, or a value that fails a type ascription.

The message reads "expected `T`, got `U`": T is what the context requires, U is what the value actually has. A site may follow — "for argument 2" points at a position in a call, "at `x`" quotes the offending subexpression. A type like `list<string^5>` is a list of exactly 5 strings; `finite_integer` is an integer that is not infinite.

The check runs twice by design: once statically, when the program is canonicalized (reported before anything runs), and again during evaluation, where the mismatch becomes an error value that propagates outward (see `epsil doc runtime-error`).

## `no-product-between-points`

Two points (tuples) were multiplied, and there is no implicit product between points. Multiplication of a point by a SCALAR is defined — it scales each component — and so is adding two points of the same arity, but `(1, 2) * (3, 4)` has no single meaning, so the engine rejects it rather than guessing.

Say which product you mean. `Dot(a, b)` is the inner product (`(1,2)·(3,4)` is 11) and is defined whenever the two points have the same number of components. `Cross(a, b)` is the cross product, defined only for two 3-component points; the message names it only when both operands have three components, because for a pair of plane points it would just produce an `incompatible-dimensions` error instead.

Juxtaposition, `\cdot` and `\times` all parse to the same multiplication, so writing `a \times b` between two points does not select the cross product — spell `Cross(a, b)` for that.

## `no-division-by-point`

A point (tuple) was used as a divisor. Dividing a point BY a scalar is defined — it scales each component, so `(4, 6) / 2` is `(2, 3)` — but there is no reciprocal of a point, so neither `x / (1, 2)` nor `(1, 2) / (3, 4)` has a meaning to give them.

If you meant to scale by the reciprocal of one component, index it: `p / q[1]`. If you meant a component-wise quotient, build it explicitly from the components.

## `missing`

A function was called with fewer arguments than its signature requires; the error marks the position of the argument that was not provided.

Check the signature with `epsil doc <FunctionName>`. Optional parameters never produce this error — only required ones do.

## `unexpected-argument`

A function was called with more arguments than its signature accepts; the quoted value is the first extra one.

Check the signature with `epsil doc <FunctionName>`. A common cause is passing a collection's elements separately where the function expects the collection itself (or the reverse).

## `callback-arity`

A collection operator was given a callback that declares a different number of parameters than the operator passes it — `Map((p, q) => p + q, xs)`, where Map applies the callback to one element at a time.

An ordinary call may supply fewer arguments than a function declares: `f(1)` on a two-parameter `f` is partial application, and yields a function awaiting the rest. Inside a collection operator that is never what was meant, because the OPERATOR decides how many arguments the callback receives — so `Map` would build a list of leftover functions rather than a list of results. The check is therefore specific to operator-owned callback slots; ordinary calls still curry.

If the elements are pairs (or tuples) and the callback meant to take one apart, write the parameter as a tuple pattern: `Map(((p, q)) => p + q, pairs)` — the extra parentheses make it ONE parameter that is destructured, not two parameters.

A few operators read the callback's arity as a choice between two modes and accept either: `Sort` takes a unary sort key or a binary comparator, and `Iterate` takes `f(previous)` or `f(index, previous)`. Those report this error only when the callback matches neither.

A pipe stage is checked on the same grounds but reports `pipe-stage-arity`, because the remedy there is different.

## `pipe-stage-arity`

A pipe stage declares a number of parameters it can never be called with — `[100, 200] |> (x, y, z) => x + y + z`. A pipe passes its stage exactly one value, so only a stage that accepts one argument can be applied.

As with a callback slot, an ordinary call may supply fewer arguments than a function declares — `f(1)` on a two-parameter `f` is partial application — but a pipe is not an ordinary call: the piped value is the whole argument list, so a leftover function is never the result the pipeline was written to produce.

A stage that genuinely takes several arguments is written as a CALL, with `_` marking the slot the piped value fills: `xs |> Fold(f, 0, _)`. The `_` may be left out when the call is missing exactly one required argument, so `xs |> Take(10)` means `xs |> Take(_, 10)`.

If the piped value is a collection whose elements are tuples and the stage meant to take one apart, write the parameter as a tuple pattern — `pairs |> ((p, q)) => p + q` — where the extra parentheses make it ONE parameter that is destructured.

## `argument-name-unknown`

A call passed an argument by name (`f(rate: 0.05)`), but the called function declares no parameter with that name; the message lists the names it does declare, and a "did you mean" points at the closest one.

Only parameters that carry a name in the function's declaration can be addressed by name — an unnamed parameter is positional-only. Check the signature with `epsil doc <FunctionName>`.

## `argument-order-invalid`

In a call that mixes positional and named arguments, all positional arguments must come first: once one argument is named, every later argument must be named too.

`f(1, rate: 0.05)` is fine; `f(rate: 0.05, 1)` is this error — after `rate:` there is no position left for a bare `1` to occupy unambiguously.

## `argument-name-duplicate`

The same parameter was supplied twice — either two named arguments used the same name, or a named argument repeats a parameter that an earlier positional argument already filled.

In `f(1000, principal: 2000)` the first positional argument already occupies `principal`, so naming it again is this error, not an override.

## `argument-names-unavailable`

A call passed arguments by name, but the called function has no declaration the engine can read parameter names from — it is undefined, defined later in the program, or held in a value typed only as `function`.

Named arguments are checked against the declaration the call resolves through; with no declaration visible there is nothing to check the names against. Call it positionally, or move the definition before the call.

The same error covers an OVERLOADED function whose overloads accept the call but disagree about which argument fills which parameter — the names then pick an argument order rather than just an implementation, and the engine will not guess. Call it positionally, or give the overloads distinct parameter types.

## `argument-names-required`

The called function requires every argument to be written with its parameter's name (`Person(firstName: "Alan", age: 42)`); the message lists the names, in declaration order.

Object-type constructors are the functions in this shape. An object type's fields are frequently several of the same type, so a positional call that transposed two of them would be accepted in silence and build a wrong object with no error anywhere. Because the arguments are named, their order does not matter.

## `argument-optional-skipped`

A named argument supplied an optional parameter while an optional parameter declared before it was left out.

Arguments are matched to declared positions, and there is no way to leave a hole in the argument list — so an optional parameter can only be named when every optional parameter declared before it is also supplied (by position or by name). Supply the earlier optional too, or omit both.

## `zero-index`

Indexing is 1-based: `xs[1]` is the first element of a collection and `xs[n]` the n-th, so the literal index 0 never names an element (it yields NaN).

The last element is `xs[-1]` — negative indices count from the end, which is usually what a 0-index habit is reaching for.

## `mapsto-arrow-expected`

`->` and `=>` are different operators: `->` pairs a key with a value (the key must be a string, as in a dictionary entry) and also writes function TYPES in annotations (`(number) -> number`), while `=>` is the mapsto arrow that builds a function value.

So `(x) -> x^2` reads as a key-value pair with a malformed key, not a lambda. Write `(x) => x^2` for the function; the fixit in the diagnostic applies exactly that rewrite.

## `mapsto-arrow-legacy`

`|->` was the mapsto arrow in earlier versions of the language. It is now spelled `=>`, the same arrow a `match` case uses for its body — one glyph, meaning "yields", in both places.

Write `x => x + 1`; the fixit in the diagnostic replaces the arrow for you. The expression was parsed as the function it was meant to be, so any other diagnostic reported here is a separate problem. (Function TYPES and dictionary entries are unaffected: they keep `->`, as in `(number) -> number` and `{k -> v}`.)

## `chained-assignment`

`a = b = 5` does not chain: `=` only assigns as a whole statement, so the OUTER `=` assigns and the inner one compares — `a` receives the boolean of `b = 5`.

Write `a := b := 5` to actually chain the assignment, or `a := (b == 5)` if the comparison was the intent.

## `assign-in-condition`

Inside a condition, `:=` assigns — and the assigned value, not a comparison, becomes the test: `if flag := true { … }` sets flag and then tests `true`.

Use `==` to compare, or perform the assignment on its own line before the condition. (A bare `=` in a condition already compares, so only an explicit `:=` reaches this diagnostic.)

## `floor-division-comment`

`//` starts a line comment, not floor division — everything after it on the line is ignored, which silently truncates an expression like `a // b`.

Use `Floor(a / b)` for the integer quotient.

## `control-outside-loop`

`break` and `continue` are only valid directly inside a `while` or `for` body — and the loop context resets at every function and lambda boundary, so a `break` inside a lambda DEFINED in a loop is still outside the loop.

To stop a pipeline early, restructure with a condition or a Take/Filter stage instead of breaking out of a callback.

## `symbol-expected`

A name was required at this position — after `let` or `const`, as a `for` loop's variable, as a function's or parameter's name — but something else was found there (`let = 42`).

A subtler cause: the word written there is one the grammar itself consumes. `for = 3` is not an assignment to a variable named `for` — the `for` starts a for-loop, and the loop machinery then finds no variable name. To use such a word as a name anyway, spell it verbatim, wrapped in backquote characters: "let `for` = 3" (see `epsil doc reserved-word`).

## `reserved-word`

A word the language reserves was used where it cannot be a plain identifier. Two cases share this code: an active keyword where an expression was expected — `y = while` reads as the start of a `while` loop, not as a value named `while` — and a literal word (`true`, `false`, `Infinity`, `oo`, `NaN`) used to NAME a binding (`let NaN = 1`): a literal can never be a binding name, in any position.

Only the words the grammar actually consumes today are rejected. The longer documented reservation list (`set`, `with`, `label`, …) stays fully usable — a future construct claims its word contextually where possible (as `type` and `alias` do), so those words may never be taken at all.

The verbatim form always works: the name wrapped in backquote characters, "let `while` = 3", is an ordinary symbol in every position. Note that a BINDING position may accept an active keyword bare (`let while = 3` binds), but the bound name is then unreachable in expressions — `while + 1` reads as a loop again — so the verbatim spelling is the only robust one.

## `asymmetric-operator-whitespace`

An operator was written with whitespace on one side only — `a+ b`. An operator with whitespace on both sides or neither is infix (`a + b`, `a+b`); one with whitespace only BEFORE it starts a new statement instead (`a +b` is the value `a`, then the prefix expression `+b`). The asymmetric middle case matches neither reading, so it is flagged — and recovered as infix, which is almost always what was meant. The quick fix restores the symmetry.

The spacing rule is what lets line breaks alone separate statements: the parser decides where an expression ends from the spacing, so a program without semicolons still parses exactly one way. The same abutment idea splits postfix from prefix `!`: `x!` (abutting) is Factorial, while `x !y` ends the expression `x` and starts the prefix Not `!y`.

## `duplicate-dictionary-key`

A dictionary literal repeats a key: in `{"a" -> 1, "a" -> 2}` the second entry conflicts with the first. Within one uninterrupted run of literal entries, keys are unique by construction — a repeated key there is a typo or a leftover, never an override, so it is reported instead of silently picking one of the two values. (Under error recovery the FIRST entry is the one that remains.)

A spread is an override boundary: `{"a" -> 1, ...d, "a" -> 2}` is legal, and the second `"a"` deliberately overrides whatever the spread brought in — last wins, no diagnostic. And only literal keys are checked: a key computed at runtime cannot collide until the dictionary is actually built.

## `parameter-name-mismatch`

A lambda and its type annotation name the same parameter differently — `const f: (a: number) -> number = (b) => b`. A parameter name binds wherever it is written, so the annotation's `a` and the lambda's `b` would both claim the same slot, and the engine will not guess which one the body meant.

Rename one side so the two agree — the quick fix renames the annotation's parameters to match the lambda's — or leave the annotation's parameters unnamed (`(number) -> number`): an annotation's parameter names are optional documentation, while the lambda's are the real binding.

## `function-redefinition`

Two clauses of one function in a single program have the same dispatch domain, so the second would silently replace the first — `f(x) = x` followed by `f(x) = 2 * x`. Parameter NAMES are not part of a clause's identity: `g(n) = n` then `g(m) = 2 * m` collides all the same, so renaming a parameter never resolves this error.

Only replacement is refused. Clauses that dispatch on genuinely different domains accumulate — a different arity (`k(x)` and `k(x, y)`), different parameter types (`h(x: integer)` and `h(x: string)`), or a literal pattern (`g(0) = 99` alongside `g(x) = x`). That is what multi-clause definitions are for.

The boundary is the program (one file, one cell). Within it, a same-domain redefinition is a mistake with no possible intent. Interactively, re-running an edited definition as a SEPARATE program — a later notebook cell, the next REPL line — replaces the earlier one; that is the intended redefinition gesture, and is legal.

## `type-redefinition`

One program declares the same type name twice. A sum type's variant names count as names its statement declares, so a variant colliding with a later `type` statement reports this too.

The boundary is the program (one file, one cell): within it, a second declaration of a name is a mistake with no possible intent. To redefine a type interactively, re-run the edited declaration as a SEPARATE program (a later cell) — across programs, redefinition is the intended gesture and is legal. `protocol` declarations follow the same rule (see `epsil doc protocol-redefinition`).

## `protocol-redefinition`

One program declares the same protocol name twice — the protocol counterpart of `epsil doc type-redefinition`, with the same rule and the same boundary.

Within one program a redeclaration is a mistake; re-running an edited declaration as a separate program (a later notebook cell) replaces the earlier one and is the intended interactive gesture.

## `type-declaration-not-top-level`

A `type` statement appears inside a block or a function body. Types are engine-global — a type's name, constructor and conformances are visible to the whole session, never scoped to a block — so a nested declaration would promise a locality it cannot deliver. Declare the type at the top level of the program.

`protocol` declarations follow the same rule (see `epsil doc protocol-declaration-not-top-level`).

## `protocol-function-not-a-field`

A protocol's `function` member was read with a dot, as if it were a field or a property.

A protocol declares two kinds of member, and they are used differently. A `function` member is CALLED, with the receiver as its first argument: `span(b)`. A `readonly` or `readwrite` member is a PROPERTY, read with a dot: `b.area`. So `b.span` is a spelling mistake rather than a missing field — the name exists, on a protocol the value conforms to.

The mirror mistake, calling a property (`area(b)`), is reported as `protocol-property-not-callable`.

## `protocol-declaration-not-top-level`

A `protocol` statement appears inside a block or a function body. Protocols, like types, are engine-global (see `epsil doc type-declaration-not-top-level`), so protocol declarations are legal only at the top level of a program.

## `runtime-error`

Runtime problems in Epsil are VALUES, not exceptions: a failing subexpression evaluates to an Error value, which propagates outward through the enclosing expressions. Nothing is thrown, and the rest of the program keeps running.

The parenthesized chain in the message ("in Characters argument 1, in Map argument 2") is the propagation path, innermost first — where the error was born, then the calls it traveled through. The caret in the report points at the innermost location the source can show.

Only the last statement's value is a program's result, so an error produced by an EARLIER statement would vanish silently; that is why it is reported as a diagnostic. The final statement's error simply is the program's value.

## `static-type-error`

This problem was detected before anything ran, when the program was canonicalized — the same analysis `epsil check` performs.

A static diagnostic never suppresses evaluation: the program still runs exactly as written (errors are values — see `epsil doc runtime-error`), so the same mistake may be reported a second time by the run itself. The label distinguishes the tiers: "Type error"/"Static error" for the pre-run analysis, "Runtime error" for the run.

## `unknown-protocol`

A conformance test named a protocol that does not exist: `Conforms(x, "Hashble")` where no `protocol Hashble` was ever declared. A name that does not exist is a mistake to surface, so it is an error — never a quiet `False`, which would make a typo indistinguishable from a genuine non-conformance.

This error comes from the `Conforms` operator, whose protocol names ride as strings and so are only checkable when it runs. The `is` spelling of the same test (`x is Hashable`) resolves the name when the program is parsed, so a typo there is reported earlier, as a parse-time diagnostic, and never reaches this error.

## `polytype-comparison-unsupported`

A type comparison was given a QUANTIFIED type — a generic signature with a `where` clause, such as the type of a built-in like `Sort` — and comparing those is not supported: `Subtype`, the dynamic test (`x is T`, `MatchesType`), and `Conforms` all reject a quantified operand rather than guess.

Deciding whether one generic signature is a subtype of another engages existential matching — "is there an instantiation that works" — which is a different, harder question than the ground-type compatibility these operators answer. A quantified type is still a legal VALUE (`Type(Sort)` observes one, prints it, and round-trips through `TypeFrom`/`StringFrom`); only comparing it is rejected.

To ask about a SPECIFIC use of a generic, compare the instantiated ground type instead — the type of an actual call's argument or result.
