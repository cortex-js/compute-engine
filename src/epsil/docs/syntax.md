---
title: Epsil Syntax
sidebar_label: Syntax
slug: /epsil/syntax/
description: "The complete Epsil grammar: the notation used for productions, and the syntactic categories covering expressions, statements, literals and operators."
hide_title: true
date: Last Modified
---
# Epsil Syntax

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
parser. The Unicode identifier rules are described under
[Symbols](/epsil/literals/#symbols), and the type following a `:` or return
arrow is parsed using the
[Compute Engine type language](/compute-engine/guides/types/). Detailed
`match` patterns are documented under
[Control Flow](/epsil/control-flow/#match).

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
**`-Infinity`** | **`oo`** | **`+oo`** | **`-oo`**

(`oo` is an input alias for `Infinity`; the serializer always emits the
canonical `Infinity` spelling.)

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
are applied, and it must still be a valid symbol name. The form exists to
write symbols whose name is a reserved word, e.g. `` `while` ``.

_inline-symbol_ → _symbol-start_ (_symbol-continue_)\*

_symbol-start_ and _symbol-continue_ follow the Unicode profile described
under [Symbols](/epsil/literals/#symbols). Reserved words are not accepted as
_inline-symbol_; use the verbatim form.

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
specified in [Literals](/epsil/literals/#strings).

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

_call-clause_ → **`(`** \[(_argument_)#**`,`**\] **`)`**

_argument_ → \[**`...`**\] _expression_

_index-clause_ → **`[`** (_expression_)#**`,`** **`]`**

_field-clause_ → **`.`** _symbol_
&nbsp;&nbsp;&nbsp;&nbsp;— the `.` must abut the base; not after a number
literal

_postfix-expression_ → _primary_ (_call-clause_ | _index-clause_ |
_field-clause_ | **`!`**)\*

_expression_ → _primary_ | _prefix-expression_ | _infix-expression_ |
_postfix-expression_

_prefix-expression_ → (**`-`** | **`!`**) _expression_

_infix-expression_ → _expression_ _operator_ _expression_

_literal-parameter_ → _signed-number_ | _string_ | **`true`** | **`false`**
&nbsp;&nbsp;&nbsp;&nbsp;— a string literal parameter cannot contain interpolation

_parameter_ → _symbol_ \[**`:`** _type_\] | _literal-parameter_

_parameters_ → **`(`** \[(_parameter_)#**`,`**\] **`)`**

_effect-label_ → **`console`** | **`entropy`** | **`environment`** |
**`fs_read`** | **`fs_write`** | **`network`** | **`random`** |
**`scope`** | **`time`**

_effect-specifier_ → **`pure`** | **`any`** | (_effect-label_)+
&nbsp;&nbsp;&nbsp;&nbsp;— labels are space-separated; duplicates are rejected;
**`pure`** and **`any`** cannot be combined with another word

_declaration_ → (**`let`** | **`const`**) _symbol_
\[**`:`** _type_\] \[**`=`** _expression_\] |
(**`let`** | **`const`**) _tuple-pattern_ **`=`** _expression_ |
_symbol_ **`:`** _type_ \[**`=`** _expression_\]

_tuple-pattern_ → **`(`** (_symbol_ | _tuple-pattern_)#**`,`** **`)`**
&nbsp;&nbsp;&nbsp;&nbsp;— at least two elements; `_` skips a position

_math-function-signature_ → **`->`** _type_ |
_effect-specifier_ **`->`** _type_

_type-parameter_ → _symbol_ \[**`:`** _type_\]
&nbsp;&nbsp;&nbsp;&nbsp;— the bound must be a ground type (it may not mention
another type parameter)

_type-parameter-clause_ → **`<`** (_type-parameter_)#**`,`** **`>`**
&nbsp;&nbsp;&nbsp;&nbsp;— at least one parameter (`<>` is rejected); duplicate
names are rejected; the names scope over the definition's HEAD only (its
parameters, effect specifier, and return type), not over its body

_function-definition_ → _symbol_ _parameters_
\[_math-function-signature_\] **`=`** _expression_ |
**`function`** _symbol_ \[_type-parameter-clause_\] _parameters_
\[_effect-specifier_\] \[**`->`** _type_\] _block_
&nbsp;&nbsp;&nbsp;&nbsp;— the `<…>` clause is claimed only by the
**`function`** form: `f<T>(x) = x` is genuinely ambiguous with a relational
expression, so the math form does not take it

_type-declaration_ → **`type`** **`alias`** _symbol_
\[_type-parameter-clause_\] **`=`** _type_ |
**`type`** _symbol_ \[_type-parameter-clause_\] **`=`** _type_
&nbsp;&nbsp;&nbsp;&nbsp;— both forms take a clause (a variance marker such
as `out T` is legal only on the bare, nominal, form). The clause names scope
over the definition only, and each must be used in it. Types are global, so
a _type-declaration_ is only valid at the top level of a program — inside a
block or function body it is the `type-declaration-not-top-level` error

_while-statement_ → **`while`** _expression_ _block_

_for-statement_ → **`for`** _symbol_ **`in`** _expression_ _block_

_statement_ → _declaration_ | _type-declaration_ | _function-definition_ |
_while-statement_ | _for-statement_ | _expression_

_statement-separator_ → **`;`** | _linebreak_

_shebang_ → **`#!`** (unicode-char)\* (_linebreak | \_eof_)

_epsil_ → (\[_shebang_\] (_statement_)#_statement-separator_ \[_eof_\])

The Pratt (precedence-climbing) grammar for `_infix-expression_`,
`_prefix-expression_`, and `_postfix-expression_` — the operator set, its
precedence, and its associativity — is documented as a table in
[Operators](/epsil/operators/) rather than spelled out production by
production; the whitespace rule described there (an infix operator has
whitespace on both sides or neither; a prefix operator has no whitespace after
it, and a postfix operator none before it) is part of this grammar, not a
separate lexical concern.

## Statements and sequencing

A program is a sequence of statements separated by a linebreak or a `;`. Two
expressions on the same line with no separator between them is **not** a
silent sequence — it is a diagnostic:

<!-- epsil-test: expect-diagnostics -->

```epsil
1 2
```

```
Error: unexpected-symbol "2"
```

A multi-statement program is a sequence, evaluated in order, whose value is the
value of its last statement. `;` is interchangeable with a linebreak as a
separator, so these two programs are identical:

```epsil
a
2
```

```epsil
a; 2
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
  [LaTeX Islands](/epsil/literals/#latex-islands)
- a function call: `f(x, y)`
- an index expression: `xs[i]`
- a field access: `p.x`

## Calls, indexing and field access

A call is a symbol (or another primary) immediately followed — with **no**
whitespace — by a parenthesized, comma-separated argument list:

```epsil
f(x, y)
f()
```

An argument may be prefixed with `...` to spread a tuple's elements into the
call's arguments (valid only in call argument lists — see
[Spread](/epsil/operators/#spread)):

```epsil
f(...p)
f(1, ...p)
```

The callee does not have to be a bare symbol. A parenthesized expression, or
the result of another call, can be called too:

```epsil
(getF())(x)
(a + b)(2+1)
```

### Named arguments

An argument can be passed by the name of the parameter it is for, written
`name: value`. Named arguments may be given in any order, and may follow
positional arguments — but never precede them:

```epsil
function interest(principal: number, rate: number) -> number {
  principal * rate
}

interest(principal: 1000, rate: 0.05)   // ➔ 50
interest(rate: 0.05, principal: 1000)   // ➔ 50 — order-free
interest(1000, rate: 0.05)              // ➔ 50 — positional prefix is fine
interest(rate: 0.05, 1000)              // ✘ positional after named
```

The names checked are the ones the callee's **declaration** carries — a
`function` definition's parameters, a
[named function-type annotation](/epsil/declarations/#function-type-annotations-bind-their-parameter-names),
an annotated lambda, or a protocol member's requirement (both the bare
call `compare(other: y, self: x)` and the qualified
`Comparable.compare(other: y, self: x)`, which dispatch on `self`
wherever it is written). A parameter without a declared name is
positional-only, and a callee whose parameter names the engine cannot
read — a forward reference, a value typed only as `function`, or an
inline lambda applied directly, `((x: number) |-> x + 1)(x: 5)` —
cannot take named arguments at all. A misspelled name gets a "did you
mean" pointing at the closest declared one.

A call that names any argument is a **complete** call: optional
parameters may simply be omitted, but a missing required parameter is an
error — a named call never turns into a partial application — and a
variadic tail cannot be filled (nor can `...` spread arguments mix with
names). Partial application and spreads remain available through purely
positional calls.

When a function has several clauses or overloads, a named argument is
also a **branch selector**: a clause that does not declare the written
name is never chosen, even if the argument's value would have selected
it. With clauses `(z: 0)`, `(o: 1)` and `(n: integer)`, the call
`f(n: 0)` runs the general `n` clause with the argument `0`, while
`f(0)` runs the `z: 0` base clause. Among the clauses that do declare
the written names, selection works exactly as for a positional call. If
the surviving overloads read the same names in different orders and
nothing else tells them apart, the call is an error asking you to be
explicit — call it positionally.

Note the disambiguations: `f(a := 1)` passes the *assignment* `a := 1`
as an ordinary argument (the token is `:=`, not `:`), and each
diagnostic these rules produce has an extended explanation under
`epsil doc <code>` (e.g. `epsil doc argument-name-unknown`).

Indexing is a primary immediately followed — with no whitespace — by a
bracketed index expression. Indexing is **1-based** (`xs[1]` is the first
element):

```epsil
xs[i]
f(x)[0]
```

Field access is a primary immediately followed — with no whitespace — by a
`.` and a symbol. Chains associate left, and a field value can be called like
any other computed callee:

```epsil
p.x
a.b.c
p.x(2)
```

A number literal never takes a field: the lexer folds a trailing dot into
the number, so `2.x` is the multiplication `2. * x`, and `1..5` stays a
range. See [Types](/epsil/types/#values-of-a-new-type-are-opaque) for what
`p.x` means on values of declared types, records and dictionaries.

In all three cases the `(`, `[` or `.` must directly abut the
callee/indexed expression: whitespace before it means the form is a
separate primary (or, for `.`, a diagnosed stray token), not a
call/index/field — the same whitespace-sensitivity that governs operators.

## Collections, tuples, and dictionaries

- **List**: `[a, b]`; `[]` is the empty list.
- **Set**: `{a, b}`; `{}` is the empty set.
- **Tuple**: `(a, b)`. A single parenthesized element, `(a)`, is just the
  parenthesized expression `a`, not a one-element tuple; `()` is a diagnostic
  (`expression-expected`) — there is no empty tuple — **except** immediately
  before a mapsto arrow, where `() |-> expr` is a zero-parameter lambda.
- **Dictionary**: `{k -> v}`; an unquoted key becomes a string key. The empty
  dictionary is spelled `{->}`, not `{}` (which is the empty set).

`{ … }` is disambiguated by looking at the first element once it has been
parsed: if it is followed by a top-level `->`, the whole `{ … }` is a
dictionary and every subsequent element must also be a `key -> value` pair;
otherwise `{ … }` is a set.

A `{` in expression position is therefore **always** a collection literal (set
or dictionary); to open a statement block in expression position, prefix it
with `do`. `do { … }` is a block expression — a statement sequence whose value
is its last statement — while a bare `{ … }` stays a set/dictionary. See
[Blocks](/epsil/control-flow/#blocks).

```epsil
{ one -> 1, two -> 2 }
```

Trailing commas are allowed in every collection form (lists, sets, tuples,
dictionaries, and call/index argument lists) — friendly to notebook editing
and diffs:

```epsil
[1, 2, 3,]    // same as [1, 2, 3]
```

A bare, top-level comma-separated sequence with no enclosing delimiter (for
example `1, 2, 3` on its own) is **not** a sequence literal — it is a
diagnostic. A sequence is written only as an explicit call, `Sequence(1, 2, 3)`.

## Round-trips

Reading a program and writing it back out reproduces its meaning, but not
necessarily its spelling. A few forms have one canonical rendering: numbers get
a single spelling (with `_` digit grouping), a division is always written with
an explicit `/`, `2x` keeps its juxtaposed form where that re-reads
unambiguously (but `2(x+1)` and `(x+y)(3+4)` keep an explicit `*`, since a
juxtaposed group would read as a call), and `is` is written as `in` — the two
spell the same membership test.

Comments are **not** preserved by a round-trip — see
[Comments](/epsil/comments/). For the exact list of normalizations, see
[Round-trip and serialization normalizations](/epsil/implementation/#round-trip-and-serialization-normalizations).

## Relationship to the loose math parser

Epsil is a **programming-language** syntax. The Compute Engine also ships a
*loose math parser* that reads LaTeX/ASCII-math notation. The two share a few
surface forms but are **not** the same language: in Epsil a juxtaposed name is
a single identifier (`sin` is one symbol, not `s·i·n`), `f(x, y)` is a function
call rather than a product, and `**` is exponentiation. Do not assume a snippet
means the same thing to both. See
[Relationship to the loose math parser](/epsil/implementation/#relationship-to-the-loose-math-parser)
for a form-by-form comparison.
