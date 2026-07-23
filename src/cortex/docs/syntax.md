---
title: Cortex Syntax
sidebar_label: Syntax
slug: /cortex/syntax/
description: "Cortex Syntax"
hide_title: true
date: Last Modified
---
# Cortex Syntax

## Notation

In the grammar below, the following notation is used:

- An arrow (→) marks grammar productions and can be read as "can consist of"
- Syntactic categories are written in lowercase italic (_newline_) on both sides
  of a production rule.
- Placeholders for recursive syntactic categories are indicated by _···_.
- Literal words and punctuation are indicated in bold (**+**) or as a Unicode
  codepoint (U+00A0) or as a Unicode codepoint range (U+2000-U+200A).
- Alternatives are indicated by a vertical bar (|)
- Optional elements are indicated in square brackets
- Elements that can repeat 1 or more times are indicated by a trailing plus sign
- Elements that can repeat 0 or more times are indicated by a trailing star sign
- Elements that can repeat 0 or more times, separated by a another element are
  indicated with a trailing hash sign, followed by the separator. If no
  separator is provided, the comma (,) is implied.

## Grammar overview

The productions below describe the source forms accepted by the current
parser. The Unicode identifier rules are delegated to the
[MathJSON symbol profile](/math-json/#symbols), and the type following a `:`
or return arrow is parsed using the
[Compute Engine type language](/compute-engine/guides/types/). Detailed
`match` patterns are documented under
[Control Flow](/cortex/control-flow/#match).

_quoted-text-item_ → U+0000-U+0009 U+000B-U+000C U+000E-U+0021 U+0023-U+2027
U+202A-U+D7FF | U+E000-U+10FFFF

_linebreak_ → (U+000A \[U+000D\]) | U+000D | U+2028 | U+2029

_unicode-char_ → _quoted-text-item_ | _linebreak_ | U+0022

_pattern-syntax_ → U+0021-U+002F | U+003A-U+0040 | U+005b-U+005E | U+0060 |
U+007b-U+007e | U+00A1-U+00A7 | U+00A9 | U+00AB-U+00AC | U+00AE | U+00B0-U+00B1
| U+00B6 | U+00BB | U+00BF | U+00D7 | U+00F7 | U+2010-U+203E | U+2041-U+2053 |
U+2190-U+2775 | U+2794-U+27EF | U+3001-U+3003 | U+3008-U+3020 | U+3030 | U+FD3E
| U+FD3F | U+FE45 | U+FE46

_inline-space_ → U+0009 | U+0020

_pattern-whitespace_ → _inline-space_ | U+000A | U+000B | U+000C | U+000D |
U+0085 | U+200E | U+200F | U+2028 | U+2029

_whitespace_ → _pattern-whitespace_ | U+0000 | U+00A0 | U+1680 | U+180E |
U+2000-U+200A | U+202f | U+205f | U+3000

_line-comment_ → **`//`** (_unicode-char_)\* _linebreak_)

_block-comment_ → **`/*`** (((_unicode-char_)\* _linebreak_)) | _block-comment_)
**`*/`**

_digit_ → U+0030-U+0039 | U+FF10-U+FF19

_hex-digit_ → _digit_ | U+0041-U+0046 | U+0061-U+0066 | U+FF21-FF26 |
U+FF41-U+FF46

_binary-digit_ → U+0030 | U+0031 | U+FF10 | U+FF11

_numerical-constant_ → **`NaN`** | **`Infinity`** | **`+Infinity`** |
**`-Infinity`**

_base-10-exponent_ → (**`e`** | **`E`**) \[_sign_\](_digit_)+

_base-2-exponent_ → (**`p`** | **`P`**) \[_sign_\](_digit_)+

_exponent_ → _base-10-exponent_ | _base-2-exponent_

_binary-number_ → **`0b`** (_binary-digit_)+ \[**`.`** (_binary-digit_)+
\]\[_exponent_\]

_hexadecimal-number_ → **`0x`** (_hex-digit_)+ \[**`.`** (_hex-digit_)+
\]\[_base-2-exponent_\]

_decimal-number_ → (_digit_)+ \[**`.`** (_digit_)+ \]\[_exponent_\]

The digit runs of a number literal may contain **`_`** grouping separators
(`1_000`, `0xFF_FF`); an underscore is ignored and never begins or ends a
run. A _hexadecimal-number_ takes only a _base-2-exponent_ because `e` and
`E` are hexadecimal digits, so they cannot double as an exponent marker.

_sign_ → **`+`** | **`-`**

_signed-number_ → _numerical-constant_ | (\[_sign_\] (_binary-number_ |
_hexadecimal-number_ | _decimal-number_))

_symbol_ → _verbatim-symbol_ | _inline-symbol_

_verbatim-symbol_ → **`` ` ``** _symbol-start_ (_symbol-continue_)\*
**`` ` ``**

The content of a _verbatim-symbol_ is taken literally: no escape sequences
are applied, and it must be a valid MathJSON symbol name. The form exists to
write symbols whose name is a reserved word, e.g. `` `while` ``.

_inline-symbol_ → _symbol-start_ (_symbol-continue_)\*

_symbol-start_ and _symbol-continue_ follow the MathJSON symbol profile.
Reserved words are not accepted as _inline-symbol_; use the verbatim form.

_escape-expression_ → **`\(`** _expression_ **`)`**

_single-line-string_ → **`"`** (_escape-sequence_ | _escape-expression_ |
_quoted-text-item_)\* **`"`**

_multiline-string_ → **`"""`** _multiline-string-line_ **`"""`**

_extended-string_ → (**`#`**)+ **`"`** (_unicode-char_)\* **`"`** (**`#`**)+

The number of trailing **`#`** must match the number of leading **`#`** that
opened the literal (`#"…"#`, `##"…"##`, …). No escape sequences are applied
inside an extended string, so it can hold `"` and `\` literally.

_string_ → _single-line-string_ | _multiline-string_ | _extended-string_

String escapes, interpolation, multiline indentation and continuation are
specified in [Literals](/cortex/literals/#strings).

_parenthesized_ → **`(`** _expression_ **`)`**

_list_ → **`[`** \[(_expression_)#**`,`**\] **`]`**

_set_ → **`{`** \[(_expression_)#**`,`**\] **`}`**

_dictionary_ → **`{`** \[(_key-value-pair_)#**`,`**\] **`}`** | **`{->}`**

_key-value-pair_ → _expression_ **`->`** _expression_

_block_ → **`{`** \[(_statement_)#_statement-separator_\] **`}`**

_do-block_ → **`do`** _block_

_latex-island_ → **`$`** (_unicode-char_ | **`\$`**)\* **`$`**

_pragma_ → **`#line`** | **`#column`** | **`#url`** | **`#filename`** |
**`#date`** | **`#time`** | _pragma-call_

_pragma-call_ → (**`#env`** | **`#navigator`** | **`#warning`** |
**`#error`**) **`(`** \[(_expression_)#**`,`**\] **`)`**

_if-expression_ → **`if`** _expression_ _block_
\[**`else`** (_block_ | _if-expression_)\]

_match-expression_ → **`match`** _expression_ **`{`** _match-case_+ **`}`**

_primary_ → _signed-number_ | _symbol_ | _string_ | _pragma_ |
_latex-island_ | _parenthesized_ | _list_ | _set_ | _dictionary_ |
_do-block_ | _if-expression_ | _match-expression_

_call-clause_ → **`(`** \[(_expression_)#**`,`**\] **`)`**

_index-clause_ → **`[`** (_expression_)#**`,`** **`]`**

_postfix-expression_ → _primary_ (_call-clause_ | _index-clause_ | **`!`**)\*

_expression_ → _primary_ | _prefix-expression_ | _infix-expression_ |
_postfix-expression_

_prefix-expression_ → (**`-`** | **`!`**) _expression_

_infix-expression_ → _expression_ _operator_ _expression_

_parameter_ → _symbol_ \[**`:`** _type_\]

_parameters_ → **`(`** \[(_parameter_)#**`,`**\] **`)`**

_declaration_ → (**`let`** | **`const`**) _symbol_
\[**`:`** _type_\] \[**`=`** _expression_\] |
_symbol_ **`:`** _type_ \[**`=`** _expression_\]

_function-definition_ → _symbol_ _parameters_
\[**`->`** _type_\] **`=`** _expression_ |
**`function`** _symbol_ _parameters_ \[**`->`** _type_\] _block_

_while-statement_ → **`while`** _expression_ _block_

_for-statement_ → **`for`** _symbol_ **`in`** _expression_ _block_

_statement_ → _declaration_ | _function-definition_ | _while-statement_ |
_for-statement_ | _expression_

_statement-separator_ → **`;`** | _linebreak_

_shebang_ → **`#!`** (unicode-char)\* (_linebreak | \_eof_)

_cortex_ → (\[_shebang_\] (_statement_)#_statement-separator_ \[_eof_\])

The Pratt (precedence-climbing) grammar for `_infix-expression_`,
`_prefix-expression_`, and `_postfix-expression_` — the operator set, its
precedence, and its associativity — is documented as a table in
[Operators](/cortex/operators/) rather than spelled out production by
production; the whitespace rule described there (an infix operator has
whitespace on both sides or neither; a prefix operator has no whitespace after
it, and a postfix operator none before it) is part of this grammar, not a
separate lexical concern.

## Statements and sequencing

A program is a sequence of statements separated by a linebreak or a `;`. Two
expressions on the same line with no separator between them is **not** a
silent sequence — it is a diagnostic:

<!-- cortex-test: expect-diagnostics -->

```cortex
1 2
```

```
Error: unexpected-symbol "2"
```

A well-formed multi-statement program wraps its statements in `["Block", …]`; a
program consisting of a single statement is returned unwrapped (no `Block`
wrapper):

```cortex
a
2
```

```json
["Block", "a", 2]
```

`;` is interchangeable with a linebreak as a separator:

```cortex
a; 2
```

```json
["Block", "a", 2]
```

## Primary expressions

A primary is the leaf of the expression grammar — the thing an operator or a
call/index applies to. The primary forms are:

- a number: `2`, `3.14`, `0x1F`, `0b101`
- a symbol: `x`, `Add`
- a verbatim symbol: `` `while` ``
- a string: `"hello"`
- a pragma: `#env("HOME")`
- a parenthesized expression: `(2 + 3)`
- a list: `[1, 2, 3]`
- a set: `{1, 2, 3}`
- a dictionary: `{one -> 1, two -> 2}`
- a `do { … }` block expression: `do { let t = 3; t + 1 }`
- a `$…$` LaTeX island: `$\frac{1}{2}$` — see
  [LaTeX Islands](/cortex/literals/#latex-islands)
- a function call: `f(x, y)`
- an index expression: `xs[i]`

## Calls and indexing

A call is a symbol (or another primary) immediately followed — with **no**
whitespace — by a parenthesized, comma-separated argument list:

```cortex
f(x, y)     // ["f", "x", "y"]
f()         // ["f"]
```

If the callee is not a bare symbol (for example, a parenthesized expression
or the result of another call), the call lowers to `Apply`:

```cortex
(getF())(x)   // ["Apply", ["getF"], "x"]
(a + b)(2+1)  // ["Apply", ["Add", "a", "b"], ["Add", 2, 1]]
```

Indexing is a primary immediately followed — with no whitespace — by a
bracketed index expression, and lowers to `At`. Indexing is **1-based**,
matching the engine convention (`xs[1]` is the first element):

```cortex
xs[i]       // ["At", "xs", "i"]
f(x)[0]     // ["At", ["f", "x"], 0]
```

In both cases the `(` or `[` must directly abut the callee/indexed
expression: whitespace before it means the parenthesized/bracketed form is a
separate primary (a parenthesized expression or a list literal), not a
call/index — the same whitespace-sensitivity that governs operators.

## Collections, tuples, and dictionaries

- **List**: `[a, b]` → `["List", "a", "b"]`; `[]` → `["List"]`.
- **Set**: `{a, b}` → `["Set", "a", "b"]`; `{}` → `["Set"]`.
- **Tuple**: `(a, b)` → `["Tuple", "a", "b"]`; a single parenthesized element,
  `(a)`, is just the parenthesized expression `a`, not a one-element tuple;
  `()` is a diagnostic (`expression-expected`) — there is no empty tuple —
  **except** immediately before a mapsto arrow, where `() |-> expr` is a
  zero-parameter lambda (`["Function", body]`).
- **Dictionary**: `{k -> v}` → `["Dictionary", ["KeyValuePair", {str: "k"}, "v"]]`;
  an unquoted key becomes a string key. The empty dictionary is spelled
  `{->}` (not `{}`, which is the empty set) and lowers to
  `["Dictionary"]`.

`{ … }` is disambiguated by looking at the first element once it has been
parsed: if it is followed by a top-level `->`, the whole `{ … }` is a
dictionary and every subsequent element must also be a `key -> value` pair;
otherwise `{ … }` is a set.

A `{` in expression position is therefore **always** a collection literal (set
or dictionary); to open a statement block in expression position, prefix it
with `do`. `do { … }` is a block expression (the engine's `Block`) — a
statement sequence whose value is its last statement — while a bare `{ … }`
stays a set/dictionary. See [Blocks](/cortex/control-flow/#blocks).

```cortex
{ one -> 1, two -> 2 }
```

```json
["Dictionary",
  ["KeyValuePair", {"str": "one"}, 1],
  ["KeyValuePair", {"str": "two"}, 2]]
```

Trailing commas are allowed in every collection form (lists, sets, tuples,
dictionaries, and call/index argument lists) — friendly to notebook editing
and diffs:

```cortex
[1, 2, 3,]    // same as [1, 2, 3]
```

A bare, top-level comma-separated sequence with no enclosing delimiter (for
example `1, 2, 3` on its own) is **not** a `Sequence` literal — it is a
diagnostic. `Sequence` is available only as an explicit call: `Sequence(1, 2,
3)` → `["Sequence", 1, 2, 3]`.

## Round-trip and serialization normalizations

`serializeCortex` and `parseCortex` are inverses over the MathJSON the grammar
can produce, up to a small set of documented normalizations.
`parseCortex(serializeCortex(e))` is **structurally** equal to `e` after
applying:

- **Number formatting** — `2`, `{num: "2"}` and `"2"` are the same number;
  the serializer emits a single canonical spelling (with `_` digit grouping),
  which re-parses to a `{num}` object.
- **`Negate` of a literal** — `["Negate", 3]` serializes to `-3` and
  `["Negate", -1]` to `1`; both re-parse as a signed `num` literal rather than
  a `Negate` node (the sign is folded into the number).
- **`Rational` → `Divide`** — `["Rational", 1, 2]` serializes to `1 / 2`.
  There is no rational literal in the grammar, so it re-parses as
  `["Divide", 1, 2]`.
- **Invisible multiply** — a binary `["Multiply", {num}, {sym}]` serializes to
  the juxtaposed form `2x` (only when the two abut and re-lex unambiguously as
  a number followed by a symbol). All other products — n-ary, number×group
  (`2(x+1)`), group×group — stay explicit `*`, because `(x+y)(3+4)` would
  otherwise re-parse as `Apply`, not `Multiply`.
- **Associativity** — the left-associative operators
  (`Add`/`Subtract`/`Multiply`/`Divide`/`And`/`Or`) re-parse into
  left-nested binary trees; a flat n-ary form and its left-nested spelling are
  the same expression.

Comments are **not** preserved by a round-trip — see
[Comments](/cortex/comments/).

`If` and `Match` have dedicated expression spellings. Other MathJSON heads that
do not have a special surface form serialize as ordinary function calls.

## Relationship to the loose math parser

Cortex is a **programming-language** syntax. The Compute Engine also ships a
*loose math parser* (`ce.parse(src, { canonical: false })`) that reads
LaTeX/ASCII-math notation. The two share a few surface forms but are **not** the
same language, and they overlap only partially:

| Source     | Cortex `parseCortex`                | Loose `ce.parse` (non-canonical)              | Agree? |
| ---------- | ----------------------------------- | --------------------------------------------- | ------ |
| `[1, 2, 3]` | `["List", 1, 2, 3]`                | `["List", 1, 2, 3]`                           | ✅ same |
| `x^2`      | `["Power", "x", 2]`                  | `["Power", "x", 2]`                            | ✅ same |
| `2**3`     | `["Power", 2, 3]`                   | math-parser artifact (`**` is not an operator) | ❌ diverge |
| `a \|> b`   | `["Pipe", "a", "b"]`               | `["Pipe", "a", "b"]`                           | ✅ same |
| `f(x, y)`  | `["f", "x", "y"]` (call)            | `["InvisibleOperator", "f", ["Delimiter", …]]` | ❌ diverge |
| `sin`      | `"sin"` (a symbol)                  | `["InvisibleOperator", "s", "i", "n"]`         | ❌ diverge |
| `2x`       | `["Multiply", 2, "x"]`             | `["InvisibleOperator", 2, "x"]`               | ❌ diverge |

The remaining divergences are intentional: in Cortex a juxtaposed name is a
single identifier (`sin` is one symbol, not `s·i·n`), `f(x, y)` is a function
call, and `**` is exponentiation. The two parsers do agree that `|>` produces
`Pipe`. Do not rely on them agreeing except on the rows marked *same*.
