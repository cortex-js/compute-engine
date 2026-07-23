---
title: Cortex Literals
sidebar_label: Literals
slug: /cortex/literals/
description: "Cortex Literals"
hide_title: true
date: Last Modified
---
# Literals

## Symbols

**Symbols** are names that identify variables, constants and functions. The
name of a symbol must be a valid [MathJSON symbol](/math-json/#symbols): a
profile of [Unicode UAX31](https://unicode.org/reports/tr31/) — a letter or
underscore followed by letters, digits and underscores, drawn from the
Unicode recommended scripts (emoji are also allowed). The prohibited
characters below can never appear in a symbol name.

When expressions are boxed for execution, symbol bindings are normalized to the
[Unicode Normalization Form Canonical Composition (NFC)](http://www.macchiato.com/unicode/nfc-faq).
They are stored and compared using NFC. For example, `Å`
written as **U+00C5 LATIN CAPITAL LETTER A WITH RING ABOVE** and as
**U+0041 LATIN CAPITAL LETTER A** followed by **U+030A COMBINING RING ABOVE**
represent the same symbol.

### Prohibited Symbol Characters

The name of a symbol cannot contain any of the following characters:

- **U+0000** to **U+0020**
- **U+0022 QUOTATION MARK**: **`"`**
- **U+0060 GRAVE ACCENT** backtick : **`` ` ``**
- **U+2028 LINE SEPARATOR**
- **U+2029 PARAGRAPH SEPARATOR**
- **U+FEFF BYTE ORDER MARK**
- **U+FFFE** Invalid Byte Order Mark

In addition, the first character of a symbol cannot be:

- **U+0021 EXCLAMATION MARK** : **`!`**
- **U+0023 NUMBER SIGN** : **`#`**
- **U+0024 DOLLAR SIGN** : **`$`**
- **U+0025 PERCENT** : **`%`**
- **U+0026 AMPERSAND** : **`&`**
- **U+0027 APOSTROPHE** : **`'`**
- **U+0028 LEFT PARENTHESIS** : **`(`**
- **U+0029 RIGHT PARENTHESIS** : **`)`**
- **U+002E FULL STOP** : **`.`**
- **U+003A COLON** : **`:`**
- **U+003C LESS THAN SIGN** : **`<`**
- **U+003F QUESTION MARK** : **`?`**
- **U+0040 COMMERCIAL AT** : **`@`**
- **U+005B LEFT SQUARE BRACKET** : **`[`**
- **U+005D RIGHT SQUARE BRACKET** : **`]`**
- **U+005E CIRCUMFLEX ACCENT** : **`^`**
- **U+007B LEFT CURLY BRACKET** : **`{`**
- **U+007D RIGHT CURLY BRACKET** : **`}`**
- **U+007E TILDE** : **`~`**

### Verbatim Form

The Verbatim Form must be used if the symbol name is a reserved word.

**Reserved words** are: `abstract`, `at`, `and`, `as`, `async`, `assert`,
`await`, `begin`, `break`, `case`, `catch`, `class`, `const`, `continue`,
`debugger`, `default`, `delete`, `dynamic`, `do`, `each`, `else`, `end`,
`export`, `extern`, `false`, `finally`, `for`, `from`, `function`, `generator`,
`get`, `global`, `goto`, `if`, `in`, `inline`, `interface`, `internal`,
`import`, `iterator`, `label`, `lazy`, `local`, `loop`, `match`, `module`,
`namespace`, `native`, `new`, `not`, `of`, `on`, `optional`, `or`, `package`,
`parallel`, `private`, `protected`, `protocol`, `public`, `repeat`, `return`,
`self`, `set`, `static`, `super`, `switch`, `this`, `throw`, `to`, `true`,
`try`, `union`, `until`, `using`, `var`, `variant`, `warn`, `when`, `where`,
`while`, `with`, `xor`, `yield`.

**To write a symbol with the _Verbatim Form_** , put a backtick **`` ` ``**
(**U+0060 GRAVE ACCENT**) before and after its name.

The characters between the two backticks are taken literally: no escape
sequences are applied. The name must still be a valid
[MathJSON symbol](/math-json/#symbols) — the Verbatim Form does not allow
names that would otherwise be invalid, such as names containing whitespace,
a backslash, or characters with the **Pattern_Syntax** Unicode property
(`+`, `<`, `|`, ...).

Since the name cannot include a line break, a verbatim symbol must open and
close on the same line.

```cortex
`new`
`while`
```

## Numbers

Numbers can be written as:

- A decimal number, with no prefix
- A binary number, with a `0b` prefix
- A hexadecimal number, with a `0x` prefix

**Decimal digits** include **U+0030** to **U+0039** (0-9) and **U+FF10** to
**U+FF19** (**FULLWIDTH DIGIT ZERO** to **FULLWIDTH DIGIT NINE**).

Hexadecimal digits include decimal digits and **a** to **f** and **A** to **F**.

Decimal floating point numbers can include an exponent indicated by an uppercase
or lowercase letter `e`. This exponent is a power of 10. The value of the
exponent is a decimal integer.

Hexadecimal floats **must** have an exponent, indicated by an uppercase or
lowercase `p`. This exponent is a power of 2. The value of the exponent is a
decimal integer.

- `1.25e2` means $$1.25 \times 10^2$$, or $$125.0$$.
- `1.25e-2` means $$1.25 \times 10^{-2}$$, or $$0.0125$$.
- `0xFp2` means $$15 \times 2^2$$, or $$60.0$$.
- `0xFp-2` means $$15 \times 2^{-2}$$, or $$3.75$$.

:::info

The hexadecimal float format is documented in
[the C99 standard](http://www.open-std.org/jtc1/sc22/wg14/www/docs/n1256.pdf)
(p.57-58).

:::

Numeric literals can contain extra formatting to make them easier to read. Both
integers and floats can be padded with extra zeros and can contain underscores
to help with readability. Neither type of formatting affects the underlying
value of the literal.

```cortex
+03.14_15_92_65
```

## Strings

### Single Line String

A single-line string is delimited by a `"` character (**U+0022 QUOTATION
MARK**).

A single-line string cannot include an unescaped `"` (**U+0022 QUOTATION
MARK**), an unescaped backslash `\` (**U+005C REVERSE SOLIDUS**), or an
unescaped **new line character** (**U+00A LINE FEED**, **U+00D CARRIAGE
RETURN**, **U+2028 LINE SEPARATOR** or **U+2029 PARAGRAPH SEPARATOR**).

### Escape Sequence

Inside a string, backslash `\` (**U+005C REVERSE SOLIDUS**) is the escape
character:

- `\0` is the NULL character (**U+0000**)
- `\\` is a backslash character
- `\'` is a single quote character
- `\"` is a quotation mark
- `\b` is a backspace character
- `\f` is a form-feed character
- `\s` is a space character
- `\t` is a tab character
- `\n` is a line feed character
- `\r` is a carriage return character
- `\u0061` is the Unicode character **U+0061 LATIN SMALL LETTER A**. In this
  form, the `\u` must be followed by exactly 4 hex-digits.
- `\u{61}` is the Unicode character **U+0061 LATIN SMALL LETTER A**. In this
  form, a string of 1 to 8 hex-digits must be included between `\u{` and `}`.

### Multi-line String Literals

A multiline string is delimited by `"""` (three quotation marks).

```cortex
let message = """
    Cortex supports
    multiline strings.
    """
```

A multiline string can contain `"` or new line characters. It can't contain an
unescaped sequence of `"""`.

Only spaces or tabs may follow the opening `"""` on its line. The line break
after the delimiter is not part of the string.

The line break before the `"""` that ends the literal is also not part of the
string. To make a multiline string literal that begins or ends with a line feed,
write a blank line as its first or last line.

A multiline string literal can be indented using any combination of spaces and
tabs; this indentation isn’t included in the string. The `"""` that ends the
literal determines the indentation: Every nonblank line in the literal must
begin with exactly the same indentation that appears before the closing `"""`;
there’s no conversion between tabs and spaces. You can include additional spaces
and tabs after that indentation; those spaces and tabs appear in the string.

Line breaks in a multiline string literal are normalized to use the line feed
character. Even if your source file has a mix of carriage returns and line
feeds, all of the line breaks in the string will be the same.

If a line of a multiline string ends with a `\` character, the next line is
considered a continuation and the string will include neither the `\` nor the
new line characters. Any whitespace between the backslash and the line break is
also omitted. This continuation form applies to multiline strings.

```cortex
let hello = """
Hello \
World
""" // Same as "Hello World"
```

```cortex
hello2 = """
Hello
World
""" // Same as "Hello\nWorld"

hello3 = """
    Hello
    World
    """ // Same as "Hello\nWorld"
```

If there is some whitespace before the final `"""`, this whitespace will be
excluded from all the lines before it.

### Interpolated Strings

A single-line string or a multiline string can include interpolated expressions
that are indicated by an expression in parentheses after a backslash (**U+005C
REVERSE SOLIDUS**). The interpolated expression can contain a string literal,
but can’t contain an unescaped backslash, or a **new line character** (**U+000A
LINE FEED**, **U+000D CARRIAGE RETURN**, **U+2028 LINE SEPARATOR**, **U+2029
PARAGRAPH SEPARATOR**)

```cortex
"1 2 3"
"1 2 \("3")"
"1 2 \(3)"
"1 2 \(1 + 2)"
```

### Extended String Literal

An extended string literal contains no escape sequences and is delimited by one
or more `#` characters and a quotation mark. Extended strings are single-line;
a line break before the matching delimiter is an error.

```cortex
#"There is no escaping now"#
#"Using "quotation marks" and \ without escaping"#
##"As many # as one needs"##
```

These strings are useful for text containing characters such as quotation marks
or backslash that would otherwise need to be escaped, leading to the
[Leaning Tootpick Syndrome](https://en.wikipedia.org/wiki/Leaning_toothpick_syndrome).

## LaTeX Islands

A `$…$` island is a primary expression whose contents are LaTeX rather than
Cortex. The text between the delimiters is handed to an **injected** LaTeX
parser, and the MathJSON it returns is spliced into the Cortex AST at that
point, composing with the surrounding expression like any other primary:

```cortex
2 * $\frac{1}{2}$
```

```json
["Multiply", 2, ["Divide", 1, 2]]
```

### Delimiters

- Islands do not nest: the first unescaped `$` after the opening `$` closes
  the island.
- `\$` inside an island is an escaped literal `$` character, not a
  delimiter.
- An unterminated island (no closing `$` before the end of input) is a
  parse error.

### Dialect

The LaTeX dialect accepted inside an island is whatever the injected parser
accepts — Cortex does not define or restrict it. In practice this is the
Compute Engine's LaTeX parser (`ce.parse()`), but Cortex's own parser has no
static dependency on it: the parser is passed in by the caller, the same way
the engine itself injects `LatexSyntax` rather than importing it directly.
Without an injected parser, a `$…$` island produces a
`latex-parsing-unavailable` diagnostic instead of a spliced expression.

### Why `$` is prohibited as a symbol's first character

`$` cannot start a Cortex symbol name (see
[Prohibited Symbol Characters](#prohibited-symbol-characters) above). This is
what keeps the lexer unambiguous: seeing a `$` at the start of a primary
always means "LaTeX island begins here," never "symbol reference."

