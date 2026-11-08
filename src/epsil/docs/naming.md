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

The lowercase spelling is the style of the language, and it is the
spelling Epsil writes: the serializer (`serializeEpsil`), the `format`
command, the `--epsil` output mode and the snippet a diagnostic quotes all
write a library name in lowercase (`sin(x)`, `map(sin, xs)`, `pi`). A
program that binds the lowercase spelling itself (`let sin = 3`, a
parameter named `pi`) is written with the capitalized name for that
library member, so the text reads back as the same program. The
capitalized spelling is what MathJSON uses, and what an engine error names.

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
variable, a `match` pattern, or a `function` definition. A function member
of a `protocol` shadows a library name the same way, from the `protocol`
statement onward. The qualified name `std::name` always names the library
definition: `std::floor(x)` calls the library function wherever the program
binds `floor` or `Floor`.

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

The capitalized spelling shadows the same way in a nested scope: in a
function body, `let Pi = 3` makes `Pi` the number `3` for the rest of the
body, and `function Square(x) { x + 100 }` makes `Square(3)` call that
function.

A definition in math style with the capitalized name of a library function,
`Sin(x) := 5` or `Sin(x) = 5`, is the error `assignment-to-library-function`,
and it defines no function. At the top level it would replace `Sin` for every
later computation on the engine, LaTeX `\sin(0)` included. Use another name,
or write `function Sin(x) { 5 }` to replace the function on purpose. A
lowercase name, `sin(x) := 5`, is a name of the program: it shadows `sin`
only. `At(xs, k) := 5` is not a definition: it assigns to an element of the
list, as `xs[k] := 5` does.

At the top level of a program, a `let` or a `const` of a library constant
that results carry by name (`Pi`, `ExponentialE`, `GoldenRatio`, `True`) is
an error, as an assignment to it is. The engine writes a result built with
the library π as the name `Pi` in MathJSON. A top-level binding of `Pi`
would make that name read the user value when the result is read again.

```epsil
let Pi = 3
// ➔ error: Cannot declare "Pi" in the global scope: it is a library constant
Pi
// ➔ pi
```

The constants `e` and `i` are not in this group. The engine never writes
them by name in a result (it writes `ExponentialE` and a complex number), so
`let e = 3` and `let i = 1` are correct at the top level.

A top-level `let` of a constant name shadows the constant only from its
statement on. A function defined before the `let` reads the constant:

```epsil
function g() { i^2 }
let i = 2
[g(), i^2]
// ➔ [-1, 4]
```

Shadowing a name that an operator builds changes the operator too: `+` is
`Add`, so a user `Add` is what `+` calls in its scope, and a definition such
as `function Add(x, y) { x + y }` calls itself without end. Compiled code
does not use a shadowed library operator. A call of a user function that
shadows a library function, such as `function Gamma(x) { x + 100 }`, compiles
as a call of the user function. These are interpreted instead: a user
definition of an operator that the language builds by name, such as `+`, `<`,
`and`, `If` and `Sum`; a multi-clause function; a function with its own
`compile` handler, `derivative`, `lazy`, `broadcastable` or declared effects
(the compiler uses its `compile` handler when it has one); and any call of a
user function on the Python target.

The markers `Nothing` and `Missing` are the exception:
they cannot be rebound, and a binding of one of them is an error
(`absence-marker-binding`). The engine recognizes them by their name — an
empty block evaluates to `Nothing`, and a `Missing` operand is read as
absent — so a binding could never behave like the value it holds. In a
`match`, test for a marker with `== Missing`: a bare `Missing` there would
be a new variable.

`Module` cannot be rebound either, and a binding of it is an error
(`module-binding`): it is the form of every qualified name (`std::pi` is
`["Module", "Pi"]`). A `let`, a `const`, an assignment or a `function`
named `Module` defines nothing and gives the error when it runs; the static
check reports every binding of `Module`, also a parameter, a loop variable,
a `match` pattern and the index of a `sum`. A qualified name reads the
library in every case, whatever the program binds.

To name a raw symbol that happens to spell a library name, use the verbatim
form: `` `sin` `` is the symbol `sin`, not the sine function.

### The qualified name `std::name`

`std` is the name of the standard library, and `std::name` is the library
definition of `name`, in either spelling: `std::pi` and `std::Pi` are the
constant π, and `std::floor(2.5)` calls the library function `Floor`. A
binding of the program never changes what a qualified name reads:

```epsil
function Floor(x) { x + 100 }
let floor = 7
std::floor(2.5) + Floor(1) + floor
// ➔ 110
```

```epsil
function f() { let Pi = 3; std::pi + Pi }
f()
// ➔ 3 + pi
```

A library name that has no lowercase spelling (see
[Names with no lowercase spelling](#names-with-no-lowercase-spelling)) takes
its capitalized name after `std::`: `std::Not(x)`, `std::Add(a, b)`,
`std::If(c, a, b)`, `std::D(f, x)`. The language writes these with `!`, `+`,
`if` and `D`, so `std::not`, `std::add`, `std::if` and `std::d` are the error
`not-a-library-name`.

`std` is not a reserved word and not a variable: `let std = 5` is a
binding like any other, and `std::pi` still names the constant π in that
program. A qualified name reads a name of a module, and `.` reads a field
of a value, so `m.x` is the field `x` of a variable `m`.

These are errors: a name other than `std` before `::` (`unknown-module`),
a name after `std::` that the library does not define, such as
`std::mine` for a function of the program (`not-a-library-name`), `std::`
with no name, and a nested name such as `std::a::b`.

A qualified call is the call of the library function, also where a
function or a parameter of the program has the name. The engine simplifies
it by the rules of the library, a library function that holds or binds an
argument, such as `std::sum(k, k in 1..3)` or `std::If(c, a, b)`, reads its
arguments as the library does, and a named argument, such as
`std::log(8, base: 2)`, is valid. The arguments read the bindings of the
program, so a call of the function of the program inside them stays a call
of that function:

```epsil
function Sum(x) { 0 }
std::sum(k, k in 1..3)
// ➔ 6
```

```epsil
function Not(x) { x }
std::Not(Not(false))
// ➔ true
```

In MathJSON, a qualified name is `["Module", "Pi"]`, and a qualified call
is `["Apply", ["Module", "Floor"], 2.5]`. The engine writes these forms in
the MathJSON of a result only in a scope where the bare name would read
another definition, so that the result, read again in that scope, keeps its
value.

## Glyph Aliases

A few mathematical glyphs are **input aliases** for library symbols,
canonicalized at the lexer — every position (expression, parameter,
binding, match pattern) treats the glyph exactly like its ASCII spelling,
and serialization writes the library spelling (`pi` for `π`):

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
