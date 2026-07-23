---
title: Cortex Types
sidebar_label: Types
slug: /cortex/types/
description: "Cortex Types"
hide_title: true
date: Last Modified
---
# Types

Cortex does not have its own type system: it reuses the Compute Engine's
type language, the same syntax accepted by
`ce.declare("f", "(real) -> real")`. See the
[Compute Engine type guide](/compute-engine/guides/types/) for the type
language itself. This page covers where a type
annotation is written in Cortex source and what it means; the type grammar
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
