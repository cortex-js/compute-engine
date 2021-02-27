---
title: Cortex
permalink: /cortex/
layout: single
date: Last Modified
sidebar:
  - nav: 'mathjson'
---

# Cortex

Cortex is a text-based programming language for scientific computing.

Here is Hello World in Cortex:

```cortex
"Hello World"
```

A cortex program is an expression that gets desugared to MathJSON, compiled,
evaluated by the Cortex Compute Engine before being displayed.

Here are a few more examples:

```cortex
Simplify(2 + 3x^3 + 2x^2 + x^3 + 1)
// -> 4x^3 + 2x^2 + 3

x = 2^11 - 1
String(x , " is a ", Domain(x))
// -> "x is a PrimeNumber"
```

Comments follow the C/JavaScript tradition.

Each expression in a Cortex program is written one or more lines.

If a line ends with a `\` character, the next line is considered a continuation.
While this is not needed often as in most cases a new line is just considered
whitespace that is skipped, it can come in handy when writing a very long
string.

## Comments

Everything after a `//` is ignored.

Block (multi-line) comments start with `/*` and end with `*/`. Block comments
can be nested.

To indicate that a comment is part of the documentation and is formatted using
markdown use `///` for single line comments and `/** */` for block comments.

## Symbols

To use a symbol which would otherwise be difficult to parse correctly, put a
backtick **`` ` ``** (**U+0060 GRAVE ACCENT**) before and after its name.

```cortex
`Hello+World`
```

## Numbers

Integer literals can be written as:

- A decimal number, with no prefix
- A binary number, with a `0b` prefix
- A hexadecimal number, with a `0x` prefix

Floating-point literals can be decimal (with no prefix), or hexadecimal (with a
`0x` prefix). They must always have a number (or hexadecimal number) on both
sides of the decimal point. Decimal floats can also have an optional exponent,
indicated by an uppercase or lowercase `e`; hexadecimal floats must have an
exponent, indicated by an uppercase or lowercase `p`.

- `1.25e2` means $$1.25 \times 10^2$$, or $$125.0$$.
- `1.25e-2` means $$1.25 \times 10^{-2}$$, or $$0.0125$$.
- `0xFp2` means $$15 \times 2^2$$, or $$60.0$$.
- `0xFp-2` means $$15 \times 2^{-2}$$, or $$3.75$$.

This format was introduced by
[the C99 standard](http://www.open-std.org/jtc1/sc22/wg14/www/docs/n1256.pdf)
(p.57-58). {.notice--info}

Numeric literals can contain extra formatting to make them easier to read. Both
integers and floats can be padded with extra zeros and can contain underscores
to help with readability. Neither type of formatting affects the underlying
value of the literal.

## Arithmetic operations

### `+`, `-`, `/`, `*`, `^`

### `<`, `<=`, `=`, `>=`, '`>`, '!='

### `==`, '!=='

## Logic operations

### `&&`, `||`, `!`, `=>`, `<=>`

## Symbols

## Strings

Inside a string, `\` is the escape character:

- `\\` is a backslash character
- `\'` is a single quote character
- `\"` is a single quote
- `\t` is a tab character
- `\n` is a newline character
- `\r` is a carriage return character
- `\u{61}` is the Unicode character **U+0061 LATIN SMALL LETTER A**.

### Multi-line string literals

```
x = """
Hello
World
"""
```

If there is some whitespace before the final `"""`, this whitespace will be
excluded from all the lines before it.

## Functions

## Tuples

## Dictionaries

## Lists

## Sets

## Desugaring

The process to convert a Cortex program into a MathJSON expression is pretty
straightforward:

- Comments get added as metadata to the nearest expression
- Function calls gets converted into MathJSON functions:

```cortex
Print("x =", x)
```

```json
["Print", "'x'", "x"]
```

- Collections (List, Set, Tuple, Sequence) get converted into a corresponding
  MathJSON expression:

```cortex
set =  {2, 5, 7, 11, 13}
list = [2, 7, 2, 4, 2]
tuple = (1.5, 0.5)
sequence = 2, 5, 7
```

```json
["Equal", "set", ["Set", 2, 5, 7, 11, 13]][
  ("Equal", "list", ["List", 2, 7, 2, 4, 2])
][("Equal", "tuple", ["Tuple", 1.5, 0.5])][
  ("Equal", "sequence", ["Sequence", 2, 5, 7])
]
```

- Control structures also get converted to an appropriate expression:

```cortex
if (x in PrimeNumber) {
  Print(x);
   x += 1;
} else {
  x += 2;
}
```

```MathJSON
["If",
  ["Element", "x", "PrimeNumber"],
  ["Evaluate", ["Print", "x"], ["Equal", "x", ["Add", "x", 1]]],
  ["Add", "x", 2]]
]
```
