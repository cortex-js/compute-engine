---
title: Cortex Types
sidebar_label: Types
slug: /cortex/types/
description: "Cortex has no type system of its own — it reuses the Compute Engine's type language, the same syntax accepted by ce.declare(\"f\", \"(real) -> real\"), and adds a type statement to name new types."
hide_title: true
date: Last Modified
---
# Types

Cortex does not have its own type system: it reuses the Compute Engine's
type language, the same syntax accepted by
`ce.declare("f", "(real) -> real")`. See the
[Compute Engine type guide](/compute-engine/guides/types/) for the type
language itself. This page covers where a type
annotation is written in Cortex source and what it means, and how a program
declares type names of its own; the type grammar
includes unions, intersections, tuples, records, function signatures, and
generic collection types.

## Annotation positions

A type annotation follows a `:` after a declaration target:

```cortex
x: real
x: real = 5
```

Type-syntax tokens — `<`, `>`, `->`, `|`, `&` — are only meaningful **inside**
a type annotation. They are never part of the general expression grammar:
once the parser sees a leading `symbol :`, it hands the rest of the type
expression to the type subparser and resumes parsing Cortex source exactly
where the type subparser stopped. An unrelated `:` that doesn't follow a
declaration target at the start of a statement is not treated as an
annotation at all.

Function parameters and return values can also be annotated:

```cortex
f(x: real, n: integer) -> real = x^n
function g(x: integer) -> integer { x + 1 }
(x: integer) |-> x + 1
```

Parameter annotations are enforced when a function is called. A return-type
annotation is recorded in the function's signature, but the current runtime
does not reject a returned value merely because its inferred type differs from
the annotation.

## MathJSON representation

The parser holds a type annotation as a MathJSON string. A declaration places
that string after the declared symbol. An initializer is stored in the
declaration's attributes dictionary:

```cortex
x: real = 5
```

```json
["Declare", "x", {"str": "real"},
  ["Dictionary", ["KeyValuePair", "value", 5]]]
```

```cortex
xs: list<integer>
```

```json
["Declare", "xs", {"str": "list<integer>"}]
```

```cortex
f: (real) -> real
```

```json
["Declare", "f", {"str": "(real) -> real"}]
```

Note that `<`, `>`, `|`, `&`, and `->` inside the type annotation are
consumed entirely by the type subparser — for example
`u: integer | boolean` holds the whole `"integer | boolean"` string, and none
of those tokens are visible to (or reinterpreted by) the surrounding
expression grammar.

## Semantics

An annotation uses the same engine type machinery as
`ce.declare()`. Type checking is not a separate Cortex-side pass — it happens
at canonicalization/evaluation time, the same way it does for any other
declared symbol. Cortex does not add a second type checker on top of the
engine's.

Typed parameters are represented with `Typed` nodes:

```cortex
f(x: integer) -> real = x + 1
```

```json
["Assign", "f",
  ["Function",
    ["Typed", ["Add", "x", 1], {"str": "real"}],
    ["Typed", "x", {"str": "integer"}]]]
```

## Inference

A symbol with no annotation gets its type inferred by the engine from how it
is used — the same inference the engine already performs for any undeclared
symbol. This includes the engine's existing convention that evaluating a
bare symbol as a boolean operand (`And`/`Or`/`Xor`/`Not`) infers that symbol
`boolean` for the lifetime of the engine; a later numeric use of the same
symbol in the same scope will then error. This is engine behavior, not
something specific to Cortex.

## Declaring a type

A `type` statement gives a name to a type. The name is usable by every
annotation later in the program — and by later cells sharing the same engine.
There are two forms, and they mean different things.

**`type` declares a new, distinct type.** Nothing that merely *looks* like the
definition belongs to it: the definition describes how the type is built, not
which values are already members of it.

```cortex-live
type point = tuple<x: number, y: number>
let p = point(1, 2)
p
// ➔ point(1, 2)
```

**`type alias` declares another name for an existing type.** Any value of
that shape is a value of the alias — it is an abbreviation, not a new type.

```cortex-live
type alias pair = tuple<number, number>
let a: pair = (1, 2)
a
// ➔ (1, 2)
```

Reach for `type alias` to shorten a type you write often
(`type alias grid = list<list<number>>`), and for `type` when the new type is
meant to be its own thing — a `meters` that a bare number cannot be mistaken
for.

Neither `type` nor `alias` is a reserved word. Only the statement-position
shapes `type name =`, `type name<`, `type alias name =` and
`type alias name<` are read as a type declaration, so `type` remains an
ordinary identifier everywhere else — `type: integer = 4` still declares a
variable named `type`:

```cortex-live
let type = 5
type + 1
// ➔ 6
```

(And `type alias = tuple<number, number>`, with nothing between `alias` and
`=`, declares a type *named* `alias` — legal, but not a spelling to reach
for.)

### Constructors

A type declaration also declares a **constructor**: a function of the same
name that builds values of the type. A `tuple` definition gives a constructor
with one argument per field; any other definition gives a one-argument
constructor:

```cortex-live
type point = tuple<x: number, y: number>
type meters = number
(point(1, 2), meters(5))
// ➔ (point(1, 2), meters(5))
```

The arguments are checked against the definition, so `point(1)` and
`point("a", 2)` produce an error value rather than a malformed point.

A value built this way carries its type with it, wherever it goes:

```cortex-live
type point = tuple<x: number, y: number>
let ps = [point(1, 2), point(3, 4)]
Type(ps)
// ➔ "list<point^2>"
```

An **alias** constructor is a checked cast instead of a tag: it validates the
arguments against the definition and hands back the plain value.

```cortex-live
type alias pair = tuple<number, number>
pair(1, 2)
// ➔ (1, 2)
```

A `record` definition declares **no** constructor: a record's fields are
named, so building one from positional arguments would silently depend on the
order the fields happen to be written in. Calling such a name reports a
`type-not-callable` warning; annotate a value with the type instead.

```cortex
type place = record<x: number, y: number>
place(1, 2)
```

### Values of a new type are opaque

A `point` is not the tuple it is defined from — that is what makes it a new
type. So a plain tuple is not accepted where a `point` is expected, and the
operations that take a tuple apart do not reach inside one:

```cortex
type point = tuple<x: number, y: number>
let q: point = (1, 2)   // error: a tuple is not a point
let p = point(1, 2)
First(p)                // error
let (a, b) = p          // error
```

Each of those lines parses: the rejection happens when the program runs, as
an [error value](/cortex/evaluation/#errors-are-values), not as a parse
error.

To read the parts back, [`match`](/cortex/control-flow/#match) on the
constructor — a constructor pattern is an ordinary operator pattern, and
binds one variable per field:

```cortex-live
type point = tuple<x: number, y: number>
let p = point(3, 4)
match p {
  point(x, y) => x + y
}
// ➔ 7
```

There is no `p.x` field-access syntax: `match` is how a value of a declared
type is taken apart.

An **alias** has none of this reserve — it *is* its definition, so an
alias-typed value works anywhere the underlying shape works:

```cortex-live
type alias meters = number
function height(m: meters) { m + 1 }
height(2)
// ➔ 3
```

### Equality

Two values built by the same constructor are equal when their arguments are.
Values built by different constructors are never equal, and neither is a
constructed value and a plain one of the same shape:

```cortex-live
type point = tuple<x: number, y: number>
type polar = tuple<r: number, t: number>
(point(1, 2) == point(1, 2), point(1, 2) == (1, 2), polar(1, 2) == point(1, 2))
// ➔ (True, False, False)
```

### Scope, and re-running a cell

A type declaration — both the type name and its constructor — lives in the
current scope, like a `let`. One inside a block or a loop body stays there:

```cortex-live
let origin = 0
do {
  type inner = tuple<number, number>
  inner(3, 4)
}
// ➔ inner(3, 4)
```

Re-running a `type` statement for a name that an earlier `type` statement
declared **replaces** the earlier definition, constructor included, so
re-executing a notebook cell after editing a type works. A name declared some
other way — a `function` of that name, or a type declared by the host
application — is not replaced: the statement reports an error value and
declares nothing.

### Type variables

The syntax `type point<T> = tuple<T, T>` is **reserved** for a future
release. It parses, and reports a dedicated `type-variables-unsupported`
diagnostic, in both forms:

<!-- cortex-test: expect-diagnostics -->

```cortex
type point<T> = tuple<T, T>
```

### Encoding

A `type` statement lowers to the engine's `DeclareType` operator — the
MathJSON mirror of `ce.declareType()`. The body is carried as the source text
of the type. The bare form has no attributes; the `alias` form adds an
attributes dictionary with `alias -> True`:

```cortex
type point = tuple<x: number, y: number>
```

```json
["DeclareType", "point", {"str": "tuple<x: number, y: number>"}]
```

```cortex
type alias pair = tuple<number, number>
```

```json
["DeclareType", "pair", {"str": "tuple<number, number>"},
  ["Dictionary", ["KeyValuePair", "alias", "True"]]]
```

A type is registered when its statement is canonicalized, which is why the
statements after it — in the same program or in a later cell — can annotate
with it. A type declared by the host with `ce.declareType()` is visible to a
program the same way, constructor and all.

## Diagnostics

An invalid type inside an annotation position surfaces as a
`type-annotation-error` diagnostic, offset-corrected to point at the
offending token within the type text (not at the `:` or the declaration
target):

<!-- cortex-test: expect-diagnostics -->

```cortex
x: notatype
```

produces a `type-annotation-error` diagnostic pointing at `notatype`.
