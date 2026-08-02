---
title: Cortex Naming
sidebar_label: Naming Conventions
slug: /cortex/naming/
description: "Naming conventions in Cortex: capitalized identifiers denote library and engine operators, lowercase identifiers denote user-defined variables and functions."
hide_title: true
date: Last Modified
---
# Naming Conventions

Cortex follows the naming convention already used throughout MathJSON and
the Compute Engine's library: **capitalized** identifiers denote library or
engine operators, **lowercase** identifiers denote user-defined variables
and functions.

```cortex
Sin(x)
Simplify(2 + 3x^3)
Map([1, 2, 3], x |-> x^2)
```

`Sin`, `Simplify`, and `Map` are library operators; `x` is an ordinary user
symbol.

## Glyph Aliases

A few mathematical glyphs are **input aliases** for library symbols,
canonicalized at the lexer — every position (expression, parameter,
binding, match pattern) treats the glyph exactly like its ASCII spelling,
and serialization emits the canonical name:

| Glyph | Symbol            |
| :---- | :---------------- |
| `π`   | `Pi`              |
| `∞`   | `Infinity`        |
| `ⅈ`   | `ImaginaryUnit`   |
| `ⅇ`   | `ExponentialE`    |
| `∅`   | `EmptySet`        |
| `⧝`   | `ComplexInfinity` |
| `ℝ`   | `RealNumbers`     |
| `ℤ`   | `Integers`        |
| `ℚ`   | `RationalNumbers` |
| `ℕ`   | `NonNegativeIntegers` |
| `ℂ`   | `ComplexNumbers`  |

```cortex
3.1 ∈ ℝ
// ➔ True
```

Note the doublestruck `ⅈ`/`ⅇ` (U+2148/U+2147), not the ordinary letters:
`i` and `e` remain plain user symbols. To name a raw symbol that happens to
be a glyph, use the verbatim form (`` `π` ``).

This is a **convention with no enforced semantics** — nothing in the parser
or the engine requires a capitalized name to be an operator or a lowercase
name to be a variable. A user can declare a lowercase function or a
capitalized variable; it will work exactly the same way. The convention
exists so that, by scanning a program, it's usually obvious at a glance
which names come from the library and which are the author's own.

Because the convention isn't enforced, a name collision — a user symbol
that happens to share a capitalized library name, or vice versa — isn't a
parse error. It resolves the same way any other symbol lookup does: by
**scope**, not by case. A local declaration shadows an outer one (including
a library operator) for the rest of that scope, exactly as it would for any
other symbol.

