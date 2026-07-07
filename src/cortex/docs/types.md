---
title: Cortex Types
permalink: /cortex/types/
layout: single
date: Last Modified
sidebar:
  - nav: "universal"
---

# Types

Cortex does not have its own type system: it reuses the Compute Engine's
type language (`src/common/type/`), the same syntax accepted by
`ce.declare("f", "(real) -> real")`. This page covers where a type
annotation is written in Cortex source and what it means; the type grammar
itself — unions, intersections, tuples, records, function signatures, and so
on — is defined by the BNF grammar documented at the top of
[`src/common/type/parser.ts`](https://github.com/cortex-js/compute-engine/blob/main/src/common/type/parser.ts).
This page does not fork or duplicate that grammar.

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

Function parameter and return-type annotations (`f(x: real, n: integer) ->
real`) are planned for Phase 4, once function definitions are designed; they
are not yet part of the grammar.

## Current parse shape

The Cortex parser parses a type annotation and holds it, unevaluated, as a
string inside the produced MathJSON — the final `Declare`/`Assign` shape is
still being finalized as part of the Phase 4 declaration design. Today:

```cortex
x: real = 5
```

```json
["Declare", "x", {"str": "real"}, 5]
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

An annotation compiles to the same engine type machinery used by
`ce.declare()`. Type checking is not a separate Cortex-side pass — it happens
at canonicalization/evaluation time, the same way it does for any other
declared symbol. Cortex does not add a second type checker on top of the
engine's.

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

```cortex
x: notatype
```

produces a `type-annotation-error` diagnostic pointing at `notatype`.
