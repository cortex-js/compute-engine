---
title: Epsil Naming
sidebar_label: Naming Conventions
slug: /epsil/naming/
description: "Naming conventions in Epsil: every library function and constant has a lowercase spelling (sin, map, pi) next to its MathJSON name (Sin, Map, Pi); user names are lowercase too, and a user binding shadows a library name by scope."
hide_title: true
date: Last Modified
---
# Naming Conventions

Epsil spells the standard library in **lowercase**: `sin`, `map`,
`isPrime`, `pi`. Every function and constant of the library also answers to
its MathJSON name, with an initial capital: `Sin`, `Map`, `IsPrime`, `Pi`.
The two spellings name the same thing.

```epsil
sin(pi / 2)
// ➔ 1
Sin(Pi / 2)
// ➔ 1
map(sin, [0, pi / 2])
// ➔ [0, 1]
```

The lowercase spelling is the style of the language. The capitalized
spelling is what MathJSON uses and what the engine reports: a value prints
back with the MathJSON names, and a diagnostic names the operator as `Sin`.

## How the spelling is formed

The lowercase spelling of a library name lowercases its first letter:
`Floor` is `floor`, `IsPrime` is `isPrime`, `StringJoin` is `stringJoin`,
`GoldenRatio` is `goldenRatio`. When the name starts with several capital
letters, the whole run is lowercased and the last letter of the run stays a
capital when it starts the next word: `GCD` is `gcd`, `LCM` is `lcm`,
`LUDecomposition` is `luDecomposition`, `NDSolve` is `ndSolve`.

The [Standard Library](/epsil/library/) page lists both spellings of every
definition.

## Names with no lowercase spelling

A library name has no lowercase spelling when Epsil already has a way to
write it:

- **Operators the language writes as symbols**: `Add` is `+`, `Power` is
  `^`, `Pipe` is `|>`, `Equal` is `==`, `And` is `&&`, `Element` is `in`,
  `Range` is `..`, and so on for the whole [operator table](/epsil/operators/).
- **Constructs with their own syntax**: `If` and `Which` are `if`/`else`,
  `Match` is `match`, `Loop` is `for` and `while`, `Function` is `=>` and
  `function`, `Declare` is `let` and `const`, `Block` is `{ … }`, `Typed` is
  `x: T`, `Spread` is `...xs`, `At` is `xs[i]`.
- **Literals**: `List` is `[…]`, `Tuple` is `(a, b)`, `Set` is `{…}`,
  `Dictionary` is `{k: v}`, `String` is `"…"`, `True` and `False` are
  `true` and `false`, `NaN` and `Infinity` are literal words.
- **Single-letter names**: `D` and `N` stay capitalized, because `d` and `n`
  are ordinary variable names.
- **Relation glyphs** with no reading as a function (`Approx`, `Tilde`,
  `Precedes`, `PlusMinus`, …): write them through a LaTeX island.
- **Engine-internal heads** that a program never writes (`ErrorCode`,
  `RuntimeError`, `Signature`, …).

Writing one of these in lowercase is an unknown call, reported with a
did-you-mean suggestion when a close name exists.

## User names and shadowing

User-defined variables, functions, and types are lowercase too: `total`,
`area`, `type point = …`. Nothing in the parser or the engine enforces a
case; the library spellings and the user names share one namespace and
resolve by **scope**, not by case.

A user binding shadows a library name for the rest of its scope, whichever
spelling the library name has: a `let`, a `const`, a parameter, a loop
variable, a `match` pattern, or a `function` definition.

```epsil
let sum = 0
sum + 1
// ➔ 1
```

```epsil
function mean(x) { 42 }
mean(7)
// ➔ 42
```

```epsil
[1, 2, 3] |> map(count => count * 2)
// ➔ [2, 4, 6]
```

A bare library name that nothing shadows IS the library definition, in
every position: `mean` alone is the `Mean` function, so `mean + 1` is a type
error rather than a sum with an unknown number. Declare the variable first.

```epsil
let mean = 5
mean + 1
// ➔ 6
```

The constants `e` and `i` are lowercase library values already: `e^2` is
the exponential, `i^2` is `-1`, and `1 + 2i` is a complex number. They
shadow like any other name — `let e = 3; e^2` is `9`.

To name a raw symbol that happens to spell a library name, use the verbatim
form: `` `sin` `` is the symbol `sin`, not the sine function.

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
`i` and `e` are the lowercase library constants described above. To name a
raw symbol that happens to be a glyph, use the verbatim form (`` `π` ``).

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
