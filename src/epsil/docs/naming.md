---
title: Epsil Naming
sidebar_label: Naming Conventions
slug: /epsil/naming/
description: "Naming conventions in Epsil: capitalized identifiers denote library and engine operators, lowercase identifiers denote user-defined variables and functions."
hide_title: true
date: Last Modified
---
# Naming Conventions

Epsil follows the naming convention used throughout its standard library:
**capitalized** identifiers denote library operators, **lowercase**
identifiers denote user-defined variables and functions.

```epsil
Sin(x)
Simplify(2 + 3x^3)
Map(x => x^2, [1, 2, 3])
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
| `∫`   | `Integrate`       |
| `∑`   | `Sum`             |
| `∏`   | `Product`         |

```epsil
3.1 ∈ ℝ
// ➔ True
∫(1/x, x)
// ➔ Integrate(1/x, x)
```

Note the doublestruck `ⅈ`/`ⅇ` (U+2148/U+2147), not the ordinary letters:
`i` and `e` remain plain user symbols. To name a raw symbol that happens to
be a glyph, use the verbatim form (`` `π` ``).

In a **type annotation** the number-set glyphs name the type, not the set
constant: `c: ℝ` is `c: real`, `n: ℕ` is `n: integer<0..>`. See
[Types](/epsil/types/#glyph-type-names).

## Subscripts

A run of subscript letters and digits directly after a name is part of the
name, spelled with an underscore — the same name the LaTeX `x_n` produces:

| Written | Symbol  |
| :------ | :------ |
| `xₙ`    | `x_n`   |
| `a₁`    | `a_1`   |
| `a₁₂`   | `a_12`  |
| `xᵢⱼ`   | `x_ij`  |

So `xₙ` can be declared, assigned, matched and passed exactly like `x_n`,
and `let xₙ = 3` followed by `x_n` reads the same binding. A subscript that
holds a sign or a parenthesis is not a name: `xₖ₊₁` is the expression
`Subscript(x, k + 1)`. Superscripts never join a name — `x²` is `x^2`; see
[Superscripts and subscripts](/epsil/operators/#scripts).

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

