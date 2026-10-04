# The lenient grammar reports each reading choice that has a second common reading

Status: DESIGN, decided 2026-10-01 (Arno). Implementation in progress.

## 1. Goal

A host that converts text a person types or pastes, such as the paste
converter of Tycho (`plainTextToLatex` in `src/graph-paper/graph/paste-rows.ts`
of the Tycho repository), must not need its own parser. It parses with the
lenient grammar, `ce.parse(text, { strict: false, diagnostics: true })`, and it
refuses a line when the parse holds an `Error` node or a diagnostic whose code
starts with `ambiguous-`.

The lenient grammar reads almost any text, and it gives each input one
reading. Many inputs have a second reading that a person often means:
`e^2pi` is read as `e²·π`, and a person can mean `e^{2π}`. A host cannot see
which inputs these are. Today Tycho keeps a list of the tokens and token
orders it accepts, and it refuses everything else; that list is fragile and
grows with each review.

## 2. The contract

Decided 2026-10-01 (Arno), accepted by Tycho the same day:

1. This document lists every reading choice of the lenient grammar that has
   a second common reading (section 5).
2. Each choice in the list reports a parse diagnostic with its own code. All
   these codes start with `ambiguous-`, so a host can refuse on the prefix.
3. A reading choice that has a second common reading and reports no code is
   a CE defect. A host reports it with the input; CE adds a code, or explains
   why the reading is the only common one and lists it in section 6.
4. A code never changes the reading. The parse result with
   `diagnostics: true` is the same as without it.
5. The strict grammar reports none of these codes.

"Common" means that a person writing plain-text math, in a calculator, a
spreadsheet, a programming language or a text message, would write this text
to mean the second reading. It does not mean "possible".

## 3. The diagnostic

Each code is a `ParseDiagnostic` (`types-kernel-serialization.ts`) with:

- `code`: one of the codes of section 5;
- `start`, `end`: the span of the text that has two readings, in the
  normalized-LaTeX offsets that the other parse diagnostics use;
- `detail`: an object with the parts of the reading that a host needs to
  explain the refusal (each code names its fields below). `detail` can be
  empty.

The four codes added on 2026-10-01 for the first round of host requests
were published in 0.144.0 under their first names. They are renamed into the
group in the next release (decided 2026-10-01; listed under Behavior
Changes):

| Before | Now |
| --- | --- |
| `letter-run-split` | `ambiguous-letter-run` |
| `implicit-product-in-denominator` | `ambiguous-denominator` |
| `spaced-digit-groups` | `ambiguous-digit-groups` |
| `letter-before-decimal` | `ambiguous-letter-decimal` |

## 4. The `onAmbiguity` option

`ce.parse(text, { strict: false, onAmbiguity: 'error' })` puts an `Error`
node in place of the smallest expression that holds the span of each
`ambiguous-*` diagnostic. The error code is the diagnostic code:
`["Error", "'ambiguous-exponent-end'", ["LatexString", "'e^2pi'"]]`. The
default is `'report'`: the diagnostic is reported when `diagnostics: true`,
and the reading is kept. In strict mode the option has no effect.

## 5. The reading choices and their codes

Each entry gives the input, today's reading, the second common reading, and
the code. "Name" means a run of letters read as one symbol, a Greek letter,
or a library constant.

### 5.1 Exponents and subscripts

- **`ambiguous-exponent-end`** — where an unbraced exponent ends.
  - An operand directly after the exponent: `e^2pi` (`e²·π` / `e^{2π}`),
    `x^2y` (`x²·y` / `x^{2y}`). Also a one-letter exponent directly
    followed by a letter: `x^xy` (`x^x·y` / `x^{xy}`). This input also
    reports `ambiguous-letter-run`. The radical glyph `√` starts an
    operand: `e^θ√z` (`e^θ·√z` / `e^{θ√z}`), `x^√θ√g`.
  - An operand after white space when the exponent is a name or is signed,
    or the base is `e`: `e^i pi`, `e^-x y`, `e^2 pi i`, `e^x √z`. The rule
    is the same for every operand after the white space, and a function
    name is an operand: `e^x cos(x)` (`e^x·cos(x)` / `e^{x cos(x)}`),
    `e^x sin x`, `e^-x sin x`. A number exponent then white space is not
    reported, also before a function name: `x^2 y` is `x²·y`, `x^2 sin x`
    is `x²·sin x`. The word `in` and a differential (`e^x dx`) are not
    operands here.
    Decided 2026-10-03 (Arno), for a host report: until then a function
    name after the white space was reported only when the exponent was
    signed (`e^-x sin x`), and `e^x sin x` was an exception with no code.
    The exception is removed. The reason: a person who types an exponent
    without braces can mean that the exponent continues after the white
    space, whatever the operand is. `e^x y` and `e^i pi` were already
    reported for this reason, and a function name is not different. The
    first reading (`e^x·cos(x)`) is the more frequent one, but the contract
    of section 2 asks for a code when a second reading is common, and a
    host that refuses on the code shows the line as text.
  - A `/` after an exponent that is a name, is signed, or is the number 1:
    `e^x/2`, `e^-x/2`, `x^pi/2`, `x^1/2` (`(x^1)/2` / `x^{1/2}`). `x^3/2` is
    not reported: the decision of 2026-09-30 is that `^` binds tighter than
    `/`.
  - The span starts at the base and ends at the end of the operand that has
    the second reading (`e^2pi` is the span `e^2pi`).
  - `detail`: `{ exponent }` (the source text of the exponent read).
  - `**` is read as `^` in the lenient grammar, so `x**2y` and `e**2pi` are
    reported as `x^2y` and `e^2pi` are.
- **Readings with no code (added 2026-10-02 for a host report).** These
  give one reading, the one of the equal LaTeX-like spelling:
  - `**` is read as `^` (decision 2026-10-02): `-e**θ` is `-(e^θ)`, as
    `-e^θ` is. A `^` after a `**` exponent, or a `**` after a `^` exponent,
    is a second superscript and gives an `unexpected-superscript` error, as
    `1^x^M` does: `1**x^M`, `x^2**3`. A chain of `**` alone is read from the
    right, as in all programming languages that have `**`: `2**3**2` is
    `2^(3^2)`.
  - White space after `^` does not change the reading: `x ^ pi` is `x^π`.
    White space after the `-` of an exponent on a letter is also skipped:
    `e^- x` is `e^{-x}`. After a `+` (`A^+ x`, the pseudo-inverse of `A`
    times `x`), and after a base that is a command, a digit or a group
    (`\R^- x`, `0^- x`), the postfix reading is kept.
  - Two superscript markers in a row are an error, in both grammars:
    `x^^2`, `x^²` (`^` then the superscript digit). A TeX character code
    such as `^^41` is still read.
- **`ambiguous-implicit-subscript`** — a letter directly followed by a digit
  is read as a subscript: `x2`, `θ2`, `π2`, `α1`, `y = x2` (`x_2` / `x·2`).
  Also a digit subscript directly followed by a letter: `x_1y` (`x_1·y` /
  `x_{1y}`). A library function name with a digit (`atan2`, `log2`, `log10`)
  is not reported. Two more cases where an unbraced subscript of letters
  ends:
  - a digit directly after the letters: `M_max0.5` (`M_max·0.5` / a
    subscript that holds the number), `x_a2`;
  - the letters end with a function name and have more letters before it:
    `A_maxsin t` (`A_maxsin·t` / `A_max·sin t`).
  A Greek base is the same as a Latin base: `Δ_a2` (`Δ_a·2`), `θ_max0.5`.
  So is a constant or a group: `π_a2` (`π_a·2`), `(x)_a2`, and a digit
  subscript then a letter, `π_1y` (`π_1·y` / `π_{1y}`). An unbraced
  subscript of digits is the whole run of digits on every base: `π_12` is
  `π_{12}`, as `x_12` is `x_{12}` (section 7). On a base that is not a
  symbol, a run that starts with `0` is not taken, because its number
  value drops the zero: the subscript is the one token `0`, as in the
  strict grammar, and the reading is reported: `(x)_01` (`(x)_0·1` /
  `(x)_{01}`), `[1,2,3]_01`, `(x)^2_01`. A symbol base keeps the text in
  the symbol name, in each order of the scripts and with each spelling of
  the base, and nothing is reported: `x_01`, `x^2_01`, `π_01`, `\pi_01`,
  `π^2_01` and `\alpha^2_01` are `x_01`, `x_01^2`, `Pi_01`, `Pi_01`,
  `Pi_01^2` and `alpha_01^2` (section 7, item 11). A letter directly
  followed by such a run keeps the text, as `x_01` does: `x01` is the
  symbol `x_01` (reported as `x2` is). On a number base (`1_000`) only
  `ambiguous-number-notation` is reported.
  Also an unbraced subscript of two letters that is split because a `_`, a
  `^` or a digit follows it: `x_ab^2` is `x_a·b^2` and `a_kx^k` is
  `a_k·x^k` (`x_{ab}^2` / `a_{kx}^k`), and `a_nb_n` is `a_n·b_n`. The
  second reading is the reading of the other order of the scripts:
  `x^2_ab` is `x_ab^2`, and is not reported. The span is the `_` and the
  two letters; `subscript` is the first letter.
  A braced subscript (`M_{max}0.5`, `A_{maxsin} t`) and `A_max sin t` are
  not reported. The span starts at the `_`. `detail`: `{ base, subscript }`,
  and `function` for the second case.
- **`ambiguous-name-digits`** — a run of letters and digits that is not a
  library function, before a parenthesis: `atan3(y)` is `arctan(3·y)`.

### 5.2 Names and functions

- `ambiguous-letter-run` (renamed): a run of letters read as a product of its
  letters or parts (`eps`, `sinx`, `pie`, `alphabet`).
- **`ambiguous-function-argument`** — a library function name with no
  parentheses, followed by more than one factor: `sin x y` (`sin(x·y)` /
  `sin(x)·y`), `sqrt 2 x`, `ln 2 x`, `exp 2 x`, `abs 2 x`. Also `log` with
  no parentheses before a number: `log 2 x` is read as `log₂(x)`. `sin 2x`
  (no white space inside the argument) is not reported. Three more cases:
  - a power of `e` after the first factor of the argument: `sin2e^a`
    (`sin(2e^a)` / `sin(2)·e^a`). The power of `e` is the exponential
    function, a second function next to the first. `sin2x` and `sin e^x`
    are not reported;
  - a function name with no argument, read as a symbol: `y = min`, `sin*x`
    (`sin·x` / a call with an argument that is missing). `min(a, b)` is not
    reported;
  - an argument with no parentheses that starts with `+`: `ln+1`, `ln +1`,
    `sin+x` are read as `ln(1)` and `sin(x)`, and the `+` is dropped; a
    person can mean a sum with a missing argument, or the letters `l·n`
    plus 1. A `-` is not reported: `sin -x` is `sin(-x)` (section 6).
- **`ambiguous-function-subscript`** — a function name other than `log`
  with a subscript: `tan_1x`, `ln_3(x)`, `sqrt _110theta`, `sin_a(x)`. The
  subscript is kept as the strict grammar keeps it: `ln_3(x)` is
  `Log(x, 3)` (as `\ln_3(x)`), and `tan_1x` is
  `Apply(Subscript(Tan, 1), x)` (as `\tan_1 x`). A person can mean a name
  with an index (`tan_1·x`), or `tan(x)` with a subscript that is a typing
  error. `log_2(8)` and `log_a(x)` (the base of `log`) are not reported.
  Before 2026-10-03 the subscript was dropped: `tan_1x` was `tan(x)`
  (section 7). The span is the call. `detail`: `{ name, subscript }`.
  A name read as a special form keeps that form, and the subscript goes on
  its head: `cbrt_2(x)` is `Apply(Subscript(Root, 2), x, 3)`. The count
  `nPr` has no head, so the subscript goes on the count: `nPr_2(5, 2)` is
  `Subscript(Binomial(5, 2)·2!, 2)` (`Permutations`, the name of `nPr` in
  the function table, is the collection of the arrangements). An exponent
  on the call is a power (`ln_3^2(x)` is `(log₃ x)²`), and an exponent `-1`
  on `ln` is the inverse (see `ambiguous-inverse-function`).
  The base of `log` is reported when it is the `0` of a longer run of
  digits: `log_01(x)` and `log012(x)` are read as the logarithm in base 0
  of `1(x)` and `12(x)`, as the strict `\log_01(x)` is. A person never
  means base 0: the digits are a base with a leading zero, or a typing
  error. This code is used, not `ambiguous-number-notation`, because the
  reading choice is the extent of the subscript of a function name, as
  for `tan_01x`. `log_0(x)` and `log0(x)` are not reported.
- **`ambiguous-function-without-parentheses`** — a symbol declared as a
  function in the engine, followed by an operand with no parenthesis: `f x`,
  `2 f x` (`f·x` / `f(x)`).
- **`ambiguous-name-then-number`** — a name that is not a function, white
  space, then a number: `x 2`, `θ 2` (`x·2` / `x_2`). Also a run of letters
  read one letter at a time, white space, then a number: `xy 0.5`
  (`x·y·0.5`); the span is the whole run, and `detail.name` is the run. A
  function name of the lenient grammar is a word, not a name: `7 mod 3`
  reports only `ambiguous-letter-run`. Also the glyph `∞` directly
  followed by a digit: `∞2` (`∞·2` / an index, as `π2` is read `π_2`). The
  LaTeX command `\infty2` is not reported.
- **`ambiguous-delta`** — `Δ` or `Delta` directly followed by a letter:
  `Δx`, `ΔxΔy`, `Q = m c ΔT` (`Δ·x` / the one symbol "change in x").
  A sign before `Δ` does not change this: `-Δα` is reported.
- **`ambiguous-constant-name`** — a library constant (`e`, `i`, `pi`, `π`,
  `inf`) alone on the left of `=`: `e = 1.6e-19`, `i = V/R`, `pi = 3.14`. A
  person usually means a variable with that name. Also the constant directly
  followed by a parenthesized group on the left of `=`: `pi(x) = x` is read
  as `π·x = x`, `e(t) = t^2` as `e·t = t²`, and a person can mean the
  definition of a function with that name. `f(pi) = 3`, `2pi(x) = 3` and
  `pi(x)` with no `=` are not reported. The span is the left side of `=`.
  Also the name `ii`, read as the imaginary unit, where a person can mean
  the product `i·i`. `detail`: `{ name }` (the MathJSON name: `Pi`, `e`,
  `i`, `ImaginaryUnit`).
- **`ambiguous-missing-base`** — a `_` with no base before it (at the start
  of the line, after white space, an operator or an opening bracket) is read
  as the symbol `_`: `-_1` is `(-_)·1`. A person can mean a subscript of a
  base that is missing, or the text has a typing error. The span is the `_`
  and the script after it.
- **`ambiguous-log-base`** — `log` with two arguments in parentheses:
  `log(x, 2)` is `Log(x, 2)`, the logarithm of `x` in base 2 (the base
  second, as in Python and in spreadsheets), and other tools put the base
  first (`log(2, x)`). Every two-argument `log(…, …)` is reported. Also the
  name `lg`, with or without parentheses: `lg(x)` is the base-10 logarithm
  (ISO 80000-2), and in computer science `lg` is the base-2 logarithm.
  `log(x)`, `log_2(x)`, `log2(x)`, `log10(x)`, `lb(x)` and the LaTeX
  commands `\lg`, `\log` are not reported. The span is the call.
  `detail`: `{ name }` (`log` or `lg`).
- **`ambiguous-engine-operator`** — a library operator whose name is one
  letter, written as a plain letter before a parenthesis, is read as a call
  of the operator: `N(x)` (numeric evaluation), `D(x)`, `D(x^2, x)`
  (derivative). A person writing plain text usually means a function of
  their own. These are the only one-letter library operators (`H` is not
  one: `H(x)` is read as a call of an undeclared `H`, as `f(x)` is, and is
  not reported). A multi-letter library name (`Floor(x)`, `Gamma(x)`)
  spells out the function, and its reading is the one a person means, so it
  is not reported. Not reported either: the plain-text function names
  (`sin(x)`, `mod(x,2)`, `Re(x)`), `f(x)`, `N` with no parenthesis, `N(x)`
  in the scope of a quantifier (a predicate), and the LaTeX command
  `\operatorname{N}(x)`, which is a deliberate spelling of the operator.
  The span is the call. `detail`: `{ name }`.
- **`ambiguous-inverse-function`** — a function name with the unbraced
  exponent `-1` in plain text: `sin^-1(x)`, `cos^-1(x)`, `tan^-1(y/x)` are
  read as the inverse function, and a person also means the reciprocal
  `1/sin(x)`. The LaTeX `\sin^{-1}(x)` is not reported. The span is the call.
  `detail`: `{ name }`. (Added 2026-10-01 for a host report.) A braced
  `-1` is the same as an unbraced one: `sin^{-1}(x)`, and `sin⁻¹(x)`, which
  the tokenizer reads as `sin^{-1}(x)`, were the reciprocal with no code
  (section 7). The inverse of a logarithm is a power, as in the strict
  grammar: `ln^-1(x)` is `exp(x)`, `log^-1(x)` and `lg^-1(x)` are `10^x`,
  and a base replaces `e` or 10: `ln_3^-1(x)` and `log_3^-1(x)` are `3^x`.
  On another function name with a subscript, `-1` is a power, as in the
  strict grammar: `sin_2^-1(x)` is `1/sin_2(x)`, with only
  `ambiguous-function-subscript`.
- **`ambiguous-lookalike-letter`** — a Greek letter that looks like a Latin
  letter: the capitals Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Υ Χ, and ο (omicron).
- **`ambiguous-unknown-character`** — a character that the lenient grammar
  reads as a string because it is not math (`y = ж`).

### 5.3 Products and groups

- `ambiguous-denominator` (renamed): an implicit product after `/` or `÷`
  (`1/2 x`, `13÷2x`: `13/(2x)` / `(13/2)·x`). The `÷` spelling was added
  2026-10-02 for a host report.
- **`ambiguous-equation-number`** — a parenthesized number or single letter
  at the end of a line, after white space: `y = x^2 (2)`, `y = 2x + 1 (4)`,
  `x = 4 (m)`, `g(t) = 3 (1)` (a product / an equation label or a unit).
- **`ambiguous-group-product`** — a parenthesized single name followed by a
  parenthesized group with a comma (`(x)(1,2)`, `(t)(cos t, sin t)`): a
  product of a scalar and a point / a call. (Decision 2026-10-01: a
  parenthesized name is never a function head, so `(a)(b)` and `(k)(x-1)`
  are products in both grammars and are not reported.)
- **`ambiguous-radical`** — the extent of `√` with no parentheses: `√2π`,
  `√2x`, `√xy` (`√2·π` / `√(2π)`); `√x²` and `√x²+y²` (`(√x)²` / `√(x²)`);
  and a number directly before `√`: `3√8` (`3·√8` / the cube root of 8).
  A number directly after `√`, or after `√` and white space, is the whole
  radicand: `√12` is `√(12)`, `√2.5` is `√(2.5)`, `√.5` is `√(0.5)`, as
  `sqrt12` and `sqrt2.5` are (section 7). The number ends the radicand:
  `√12x` is `√12·x` and `√1.5.5` is `√1.5·0.5`. In TeX a radicand without
  braces is one token (`\sqrt12` is `\sqrt{1}2`, and the strict grammar
  keeps that reading), so a number of more than one token is reported:
  `√12`, `√2.5` (`√(12)` / `√1·2`). `√2` is not reported. A number after
  the number and white space is reported too: `√1 000` is `√1·0`, and a
  person can mean `√1000`. A number of more than one token before the
  white space is reported once, with the wider span: `√12 000`, `√2.5 3`.
  `sqrt12` is not reported: it is not TeX.
  Also a Latin letter directly before `√`: `t√y` (`t·√y` / the root of
  index `t`); a Greek letter or a constant (`π√2`) is not reported. The
  letter can end a run of letters that is read one letter at a time:
  `xy√i` (`x·y·√i`, which also reports `ambiguous-letter-run`). A function
  name (`sin√x` is `sin(√x)`), a constant (`pi√2`, `xpi√2`) and a run
  after `_` (`x_ab√c`) are not reported. The test is made for each glyph:
  each letter of its run must be read as a symbol directly before the
  `Sqrt`. So `n√2 + sin√x` and `i√3 + pi√2` do not report `√x` and `pi√2`
  (`n√2` and `i√3` are reported, as `t√y` is). Also a radicand that is one
  letter, with or without an unbraced subscript, then white space and an
  operand: `√a b`, `√a_1 b` (`√a·b` / `√(ab)`). A number radicand
  (`√2 x`), a braced or parenthesized radicand (`\sqrt{a} b`, `√(a) b`)
  and a word of two or more letters after the white space (`√x sin x`,
  `√x dx`) are not reported.
- **`ambiguous-absolute-value`** — bars that pair two ways: `|x|y|z|`.

### 5.4 Signs and operators

- **`ambiguous-sign`** — a prefix `±` or `∓` with no left operand
  (`x = ±1` is `Measurement(0, 1)`; a person means the two values `1` and
  `-1`), two signs in a row (`--x`, `x - -y`, `a<--b`), and `-+`. Decision
  2026-10-01: in the lenient grammar `+-` is read as `±` and `-+` as `∓`, so
  `2 +- 0.1` is `Measurement(2, 0.1)` and is not reported. A prefix `∓`
  (also `\mp`, and `-+` in the lenient grammar) is read as `MinusPlus(0, x)`,
  as a prefix `±` is read as `Measurement(0, x)`, and is reported.
- **`ambiguous-factorial`** — `!=` directly after an operand with no space:
  `5!=120` (`5 ≠ 120` / `5! = 120`), `n!=n(n-1)!`, `k!=1`. Also what a `!`
  applies to, next to an unbraced exponent or radicand:
  - a `!` directly after an exponent or a radicand: `M³!` (`(M³)!` /
    `M^{3!}`), `2^-k!`, `x^2!`, `√i!` (`(√i)!` / `√(i!)`). The exponent or
    the radicand can be a letter with an unbraced subscript: `√i_1!`,
    `x^a_1!`. Because the tokenizer reads `M³` as `M^{3}`, a braced
    exponent that holds only digits is reported too (`M^{3}!`); `M^{n}!`,
    `(M^3)!`, `√(i)!`, `\sqrt{i}!` and `x_1!` are not;
  - a `!` after white space after the argument of a function name with no
    parentheses: `tan x !` and `αtanπ !` are `(tan x)!` and `α·(tan π)!`,
    and a person can mean `tan(x!)`, as `tan x!` is read. `tan x != 0` is
    not reported;
  - a superscript directly after a `!`: `n!²` (`(n!)²` / `(n²)!`).
    `(n!)²`, `n!` and `n!!` are not reported. When the operand of the `!`
    is an exponent, the span starts at the base of the exponent, and the
    `!` is also reported as the `!` of `x^2!` is: `x^2!^3`
    (`((x²)!)³`) reports the spans `x^2!^3` and `x^2!`.
- **`ambiguous-arrow`** — `<-`: `x <- 2` (`x < -2` / an assignment arrow).
- **`ambiguous-equal-chain`** — more than one `=` in a chain:
  `x = x = x = x`.
- **`ambiguous-element`** — the word or symbol `in`/`∈` whose left operand is
  an equation: `y = x in [0,1]` (`(y = x) ∈ [0,1]` / a restriction of `y = x`
  to `x ∈ [0,1]`).
- **`ambiguous-interval`** — after `in`, `\in`, `∈` or `\notin`, a bracket
  pair `[a,b]` or `(a,b)` followed by an operator is read as a list or a
  tuple, not as an interval: `M in [0,1]^2` is
  `Element(M, Power(List(0, 1), 2))`, and a person can mean the square of
  the interval. Also `M in [0,1] + 1`, `M in [0,1]/2`, `M in [0, 1] * 2`,
  `M in (0,1)^2`, and a range in brackets followed by an operator
  (`M in [0..1]^2`). Not reported: an operand that is only the bracket pair
  (`M in [0,1]`, `x in (0, inf)`, read as intervals), a half-open interval
  (`x in [0,1)`, also with an operator after it), a bracket with more than
  two values, and a set operator between two pairs
  (`x in [0,1] \cup [2,3]`, where each pair is read as an interval). The
  span is the bracket pair and the token after it.
- **`ambiguous-range`** — a range with two `..`: `1..10..2` (first, second,
  last / first, last, step). Also a range with one `..` next to an operation:
  `1..5/2`, `1..n+1`, `2*1..5` (the operation on one bound / on the whole
  range, `(1..5)/2`, the way Desmos scales a list). A sign is not an
  operation here: `-1..5` and `1..-5` are not reported. (The second rule was
  added 2026-10-01 for a host report.) Also `...` directly followed by a
  digit, when the left operand is a decimal number: `.5...5` is the range
  from 0.5 to 5 (the ellipsis `...` and `5`), and a person who writes `.5`
  for 0.5 can mean `.5..` and `.5`, the range from 0.5 to 0.5. `1...5` and
  `[-9...9]` are not reported: after an integer, the ellipsis is the common
  reading. (Added 2026-10-02 for a host report.)
- **`ambiguous-percent`** — `%` after a number (`y = 50%`): LaTeX reads `%`
  as the start of a comment; a person means a percentage.

### 5.5 Numbers and layout

- `ambiguous-digit-groups` (renamed): white space joins digit groups
  (`2 3`, `1 000`). Also white space between the whole part and the decimal
  separator: `3 .5` is read as 3.5 (`3.5` / `3·0.5`). (Added 2026-10-02 for
  a host report.)
- `ambiguous-letter-decimal` (renamed): a period directly followed by
  digits after an operand that is not a number is read as a product with a
  decimal number: `x.5` (`x·0.5`). The second reading is a decimal number
  with a typing error, a member access, or a period used as a
  multiplication dot (`x·5`). Also after a radical, a power, a group or an
  absolute value: `√b.5`, `e^f.5`, `(x+1).5`, `|x|.5`. (Widened
  2026-10-03 for a host report.) Not reported: a number exponent
  (`x^2.5` is `x^{2.5}`), and an operand that is not a symbol and ends with
  a LaTeX brace or `\right)`: `t^{i}.4` and `\left(1-t\right).9` are the
  spelling of Desmos for a product with a decimal number. A superscript of
  digits is reported, braced or not: `x².5` and `x^{2}.5` (`x²·0.5`). The
  tokenizer reads `x²` as `x^{2}`, so the two spellings cannot be told
  apart, and the Unicode superscript is plain text. An operand that is an
  `Error` is not reported: `1.2.3` and `1.5.5` already hold the error of
  their first `.`. `detail`: `{ name }` for a symbol, else `{}`.
- **`ambiguous-comma`** — a comma outside every bracket: `1,5` (a pair / the
  decimal number 1.5 in many locales).
- **`ambiguous-list-label`** — a number and a period at the start of a line,
  followed by white space (`1. y = x`, `10. 5`, `x = 1. 5`), a
  parenthesized number or letter at the start of a line followed by more
  (`(1) y = x`, `a) y = x`; a letter label is one of `a` to `h`), and a
  line that is only a label: digits, a Roman numeral or a letter from `a`
  to `h` (`1.`, `(1)`, `(i)`, `(iv)`, `(v)`, `(a)`, `[1]`, `[a]`). A line
  that is only `(x)` is not reported.
- **`ambiguous-number-notation`** — `1_000` (digit grouping) and `0x10`
  (hexadecimal). Also a number with a subscript of digits that is the
  argument of a function name with no parentheses: `min3_12` is
  `min(BaseForm(3, 12))`, `sin2_8`, `ln10_2` (added 2026-10-03 for a host
  report). After another letter the digits are a subscript of the letter
  (`x2_1`), and are not reported. The run of Latin letters before the
  digits must be a whole function name, and the test is made for each
  number: `x2_1 + min3_12` reports only `3_12`, and `xmin3_12` (read
  `x·m·i·n_3…`) is not reported.
- **`ambiguous-date`** — three groups of digits joined by `-` or `/`
  (`2026-10-15`, `9/30/2026`), a phone number (`555-1234`,
  `1-800-555-1234`), and two digit groups joined by `-` (`7-11`, `10-20`,
  `1999-2000`: a difference / a range; reported when the second group has
  two or more digits and is larger than the first, or a group starts with
  `0`). Two digit groups joined by `/` (`3/4`, `24/7`), two groups next to a
  parenthesis (`x = (1-10)`), `2-1` and `9-5` are not reported.

## 6. Reading choices with one common reading (no code)

These were checked against the inputs that Tycho refused on 2026-10-01. Each
gives no `ambiguous-*` code, for the reason given.

- **The conventional reading.** `sin^2(x)` is `(sin x)²`; `log2(x)`, `lb(x)`
  are base 2 and `log10(x)` is base 10; `ln|x|`, `sin|x|`, `2|x|`, `||x||`
  (a norm); `sin -x`; `y = +x`; `5! = 120` (with white space) is the
  factorial; `3/4`, `24/7`, `2-1`, `9-5` are arithmetic (see
  `ambiguous-date` for the two-group cases that are reported);
  `x^(2)(x+1)` (a parenthesized exponent has a clear end); `x in [0,1)` and `x in (0, inf)` are intervals;
  nested `sqrt(…)` and nested `e^-(…)` read as written; `gcd`, `lcm`,
  `arccot`, `min`, `mod`, `pow`, `trunc`, `Re` are library functions;
  `y = |x|`, `e^sin(x)` and `M in [0,1]` read as written.
- **A product by decision (section 7).** `(a)(b)`, `(x)(y)`, `(t)(t-1)`,
  `(x)(y)(z)`, `(k)(x - 1)`, `y = (m)(x) + b`, `y = (a)(x - h)^2 + k`,
  `(a)(b)/2`, `(x)(1..2)` (no comma in the group); and `2 (x+1)`,
  `(x+1) (x-1)`, `x(x+1)`, `t(t+1)`, `y = 1/(x(x+1))` (a name that its own
  argument uses is a factor, by the application rules of 0.131.0).
  `x = 2 +- 0.1` and `a+-b` are `Measurement` (section 7).
- **The `resolveApplication` hook decides.** A name with no definition before
  a parenthesis is read as a call in the canonical form: `f(x)`, `y = f(x)`,
  `g(t) + h`, `foo(x)`, `gamma(x)`, `alpha(x+1)`, `H(x)`, `f(pi) = 3`. A host
  that must know which names are functions passes `resolveApplication`
  (called for every such name since 0.144.0) and refuses the names it does
  not know. This is the documented way to choose the reading, so no code is
  added.
- **The canonical form holds an Error.** A library function with the wrong
  number of arguments: `atan2(y)` (`Error 'missing'`), `sin(x, y)`
  (`Error 'unexpected-argument'`). The raw form has no Error; a host that
  makes the canonical form sees it.
- **The tree shows the reading.** `x … y` holds `ContinuationPlaceholder`;
  `y = x; z = 1` is a `Delimiter` with the `;` separator (two statements);
  `y = x^2;.` is a `Block`.
- **Host policy, no reading choice.** A numeral with more digits than a
  machine float holds (`1.2345678901234567890123`, `1e400`, `1e-400`) is
  kept exactly; a host that needs a float refuses it by its own rule.
- **A document context is needed.** `f x` and `2 f x` report
  `ambiguous-function-without-parentheses` only when `f` is declared a
  function; with a plain engine they are products of symbols, and the host
  that knows its functions refuses them.

## 7. Reading changes (decided 2026-10-01)

1. **A parenthesized name is never a function head**, in both grammars: the
   canonical form of `(k)(x - 1)` is `k·(x - 1)`, was `k(x - 1)`;
   `y = (m)(x) + b` is `m·x + b`. `k(x - 1)` keeps today's rules.
2. **Lenient `+-` is `±` and `-+` is `∓`**: `x = 2 +- 0.1` is
   `Measurement(2, 0.1)`, was `2 + (-0.1)`; `y = +-sqrt(x)` is
   `Measurement(0, √x)` with the `ambiguous-sign` code, was `-√x`.
3. **A prefix `∓` has a reading**, in both grammars: `\mp 1` and `∓1` are
   `MinusPlus(0, 1)`, as a prefix `\pm 1` is `Measurement(0, 1)`. Strict
   `x = \mp 1` was an `unexpected-command` error; lenient `-+x` was
   `Negate(x)`.

4. **A subscript on a function name other than `log` is kept**
   (2026-10-04, lenient grammar), as the strict grammar keeps it:
   `ln_3(x)` is `Log(x, 3)`, as `\ln_3(x)` is, and was `ln(x)`; `tan_1x`
   is `Apply(Subscript(Tan, 1), x)`, as `\tan_1 x` is, and was `tan(x)`.
   The subscript was dropped. The reading reports
   `ambiguous-function-subscript` (section 5.2).
5. **A script after a postfix operand applies to the whole result**
   (2026-10-04, both grammars): `x^g.5^2` is `(x^g·0.5)²`, as `x.5^2` is
   `(x·0.5)²`, and was `(x^g)^{0.5}·2`; `x^2!^3` is `(x^2!)^3`, and was
   `(x^2)^{(missing)}·3`; `t^{i}.4^2` (LaTeX) is `(t^i·0.4)²`. The parser
   read the operands of the product `x^g·0.5` as the base and the
   exponent. A `^` with no exponent holds an `Error`: `x^g.5^` was
   `(x^g)^{0.5}`, and `g=^Δ` was `g^{(missing)}·Δ`, with no `=`, and now
   holds the `Equal` and an `Error`. The scripts after an unknown LaTeX
   command apply to its error, and the parse continues after them:
   `\foo^2 + y` is `Power(Error, 2) + y`; the error of the `^` handler
   fix alone dropped `+ y`.
6. **A number after `√` is the whole radicand** (2026-10-03, lenient
   grammar, Arno): `√12` is `Sqrt(12)`, was `√1·2`; `√2.5` is
   `Sqrt(2.5)`, was `√2·0.5`; `√.5` is `Sqrt(0.5)`. The reading is the one
   of `sqrt12`. The strict grammar keeps the TeX reading: `\sqrt12` and
   `√12` are `\sqrt{1}2`. The reading reports `ambiguous-radical`
   (section 5.3).
7. **An unbraced subscript of digits is the whole run of digits on every
   base** (2026-10-03, lenient grammar): `π_12` is `π_{12}`, was `π_1·2`;
   `(x)_12` and `[1,2,3]_12` likewise, and `2748_16` is the number 2748 in
   base 16 (it was `2748_1·6`; it still reports
   `ambiguous-number-notation`). A letter base already read it so
   (`x_12`). On a base that is not a symbol, a run that starts with `0`
   keeps the one-token reading (`(x)_01` is `(x)_0·1`, reported), because
   the number value drops the zero. A symbol base keeps the text (item
   11): `π_01` is `Pi_01`.
8. **A run of digits keeps its digits** (2026-10-04, lenient grammar). A
   run that a JavaScript number cannot hold exactly is a number string:
   `π_123456789012345678901` was `π_123456789012345680000`, and
   `(x)_9007199254740993` was `(x)_9007199254740992`; also a subscript or
   a base on a function name (`log_12345678901234567890(x)`) and an
   unbraced exponent (`x^123456789012345678901`). A run that starts with
   `0` after a letter keeps its text: `x01` is the symbol `x_01`, was
   `x_1`, as `x_01` is. After `_` on a base that is not a symbol, it is
   the one token `0` (item 7): `tan_01x` was `tan_1(x)` and is
   `tan_0(1·x)`. After `_` on a symbol, it is the text of the symbol name
   (item 11): `x^2_01` was `x_1^2` and is `x_01^2`.
9. **The inverse of a logarithm, and the arguments of a logarithm with a
   base** (2026-10-04). In the lenient grammar, an exponent `-1` on `ln`,
   `log` or `lg` is the inverse power, as in the strict grammar:
   `ln_3^-1(x)` is `3^x`, was `1/log₃(x)`; `log_3^-1(x)` is `3^x`, was
   `Apply(InverseFunction(Log), x, 3)`; `ln^-1(x)` is `exp(x)`. A braced
   `-1` is the inverse too: `sin^{-1}(x)` and `sin⁻¹(x)` are `arcsin(x)`,
   were `1/sin(x)`. In the strict grammar, the base of `\ln` was dropped
   by the inverse: `\ln_3^{-1}(x)` was `exp(x)`, and is `3^x`. In both
   grammars, the arguments of a logarithm with a base after the first are
   kept, so that the canonical form reports them: `ln_3(x, y)` and
   `\ln_3(x, y)` are `Log(x, 3, y)`, and `y` was dropped; `log_10(x, y)`
   was `Log(x, y)`, the logarithm in base `y`. A subscript on `cbrt` keeps
   the cube root: `cbrt_2(x)` is `Apply(Subscript(Root, 2), x, 3)`, was
   `Root_2(x)`; `nPr_2(5, 2)` is `Subscript(Binomial(5, 2)·2!, 2)`, was
   `Permutations_2(5, 2)`.
10. **A subscript on a symbol in parentheses is a compound symbol**
    (2026-10-04, both grammars, canonical form). `(x)_0` is the symbol
    `x_0`, as `x_0` is; a base that canonicalizes to a symbol is the same:
    `x2_1` (`Subscript(x_2, 1)`) is `x_2_1`. Before, the canonical form
    kept `Subscript(x, 0)`, while its type was `symbol`, the type of the
    compound symbol. So a juxtaposition with it was a `Tuple`
    (`(x)_01` was `(Subscript(x, 0), 1)`, `(x)_0 y` and `xmin3_12`
    likewise), and a sum or an explicit product was a type error
    (`x2_1 + y`, `(x)_0 \cdot 1`). A base that is not a symbol keeps the
    `Subscript`: `(x+1)_0 y` is `y·Subscript(x + 1, 0)`.
11. **The order of the scripts does not change the reading of a
    subscript** (2026-10-04, both grammars). A subscript after a
    superscript on a symbol base joins the symbol name, as a subscript
    before the superscript does, with the same rules (a base that
    evaluates its subscript, such as `\gamma`, and an indexed collection
    keep it). It reports the diagnostics of the other order. In both
    grammars, `x^2_{01}` was `x_1^2` and is `x_01^2`, as `x_{01}^2` is;
    `x'^2_{01}` is `(x_01')^2`. In the lenient grammar, `\alpha^2_01` and
    `θ^2_01` were `alpha_0^2·1` and `theta_0^2·1` (reported) and are
    `alpha_01^2` and `theta_01^2`, and `x^2_max` was `x_m^2·a·x` and is
    `x_max^2`. The strict grammar reads one token after an unbraced `_`
    in each order, as TeX does: `x^2_01` is `x_0^2·1` and `x_01^2` is
    `x_0·1^2`. The constant `π` has the reading of `\pi`, by the rule of
    `x_01` (a written symbol keeps the text of its subscript): `π_{01}`
    was `Pi_1` in both grammars and is `Pi_01`, as `\pi_{01}` is; in the
    lenient grammar `π_01` was `π_0·1` (reported) and is `Pi_01`, as
    `\pi_01` was. The strict grammar has no other reading of `π_{01}`:
    `\pi_{01}` was already `Pi_01`. In the raw form, a subscript on `π`
    now joins the name, as on `\pi`: `π_a2` is `Pi_a·2`, was
    `Subscript(Pi, a)·2`.
12. **A spelled-out Greek name takes a subscript into its name**
    (user decision 2026-10-04, lenient grammar only). A Greek name written
    without a backslash (`alpha`, `theta`, `pi`, `Delta`) takes a subscript
    into its name as the backslash spelling does, with the same rules and
    the same diagnostics: `alpha_{01}` was `alpha_1` and is `alpha_01`;
    `alpha_max` was `alpha_m·a·x` and is `alpha_max`; `pi_01` was `Pi_0·1`
    and is `Pi_01`. In both orders of the scripts: `alpha^2_{01}` and
    `alpha_{01}^2` are `alpha_01^2`. The rules for an unbraced subscript
    are the rules of item 11 and section 5.1: a run of digits keeps its
    text, a run of two letters before a script is split (`alpha_ab^2` is
    `alpha_a·b^2`, reported `ambiguous-implicit-subscript`), white space
    before the `_` stops the join (`alpha _{01}` is `alpha_1`, as
    `\alpha{}_{01}` is). A base that evaluates its subscript and a base
    that is a function trigger keep the subscript, and an indexed
    collection base takes only a declared joined name. The ASCII names of
    constants (`oo`, `inf`, `infinity`, `ii`) keep the subscript outside
    the name, as `\infty` does. Some names do not read the same as their
    backslash spelling without a subscript, and so do not with one: `gamma`
    is the symbol `gamma` and `\gamma` is `EulerGamma`; `delta_1` is
    `delta_1` and `\delta_1` is `KroneckerDelta(1)`; `zeta`, `varphi`,
    `varepsilon` and `vartheta` are their own names, while `\zeta`,
    `\varphi`, `\varepsilon` and `\vartheta` are `Zeta`, `GoldenRatio`,
    `epsilonSymbol` and `thetaSymbol`. `Gamma` joins (`Gamma_{01}` is
    `Gamma_01`), but `\Gamma` keeps its subscript (`\Gamma_{01}` is
    `Gamma_1` in the canonical form). The strict grammar does not read
    spelled-out names and does not change. Two more places read a
    spelled-out name as its command spelling: an unbraced exponent
    (`x^alpha_1` was `x^a·l·p·h·a_1` and is `x^{alpha_1}`, as `x^\alpha_1`
    is; `x^alpha2` is `x^alpha·2`, reported `ambiguous-exponent-end`), and
    a script, a prime or a digit after a run of letters, which belongs to
    the last part of the run (`xalpha_1` was `(x·alpha)_1` and is
    `x·alpha_1`, as `x\alpha_1` is; `xalpha^2` is `x·alpha^2`; `xalpha2`
    was `x·alpha·2` and is `x·alpha_2`, as `x\alpha2` is; still reported
    `ambiguous-letter-run`). An argument of one letter without braces (an
    exponent, a radicand, an argument of `\frac`) ends a word, so a whole
    spelled-out name directly after it is read as the name: `e^xalpha_1`
    was `e^x·a·l·p·h·a_1` and is `e^x·alpha_1`, `\sqrt xalpha_1` is
    `√x·alpha_1`, and `e^xpi` was `e^x·p·i` (with the imaginary unit) and
    is `e^x·π`. The codes do not change (`e^xalpha_1` reports
    `ambiguous-exponent-end` and `ambiguous-letter-run`, as `e^xy` does).
    A bare function name after such an argument is read as the function,
    as after white space: `e^xsin(t)` was `e^x·s·i·n(t)` and is
    `e^x·sin(t)`, with `ambiguous-exponent-end`. A run that is not a whole
    name stays one letter at a time (`e^xalphax_1`, a ROADMAP entry), and
    so does a word that starts at the argument (`\sqrt beta`, `x^foo`,
    `x^acos t`). In the same way as `x_11` is `x_{11}`, an unbraced run of
    digits after `\delta_` is the whole subscript, one index for each
    digit: `\delta_11` was `KroneckerDelta(1)·1` and is
    `KroneckerDelta(1, 1)`. A braced group of letters and digits after
    `\delta_` is one index for each, as in the strict grammar:
    `\delta_{n0}` was `KroneckerDelta(n_0)` (an implicit subscript) and is
    `KroneckerDelta(n, 0)`; `\delta_{nm}` no longer reports
    `ambiguous-letter-run`. A spelled-out Greek name in the group is one
    index, as its command is (the longest name, as in other letter runs):
    `\delta_{nalpha}` was `KroneckerDelta(n·alpha)` and is
    `KroneckerDelta(n, alpha)`, as `\delta_{n\alpha}` is, and reports
    `ambiguous-letter-run`; `\delta_{pi1}` and `\delta_{\pi1}` were
    `KroneckerDelta(Pi_1)` and are `KroneckerDelta(Pi, 1)`, as the strict
    `\delta_{\pi1}` is. The strict grammar reads one index for each letter
    (`\delta_{pi1}` is `KroneckerDelta(p, i, 1)`).

Also added: the lenient function names `mod` (`Mod`), `pow` (`Power`),
`trunc` (`Truncate`), `Re` (`Real`) and `Im` (`Imaginary`), which were
products of letters before a parenthesis.

## 8. Acceptance

The Tycho instrument
`scripts/repros/2026-10-01-paste-refused-inputs-lenient-probe.mts` sorts the
300 inputs of `scripts/repros/2026-10-01-paste-refused-inputs.json` into
error, diagnosed and silent. Every line that stays silent is either listed in
section 6 or is one of the five lines that need a document context (Tycho
refuses those). CE tests pin each code with a positive case, a case that is
not reported, and the unchanged reading.
