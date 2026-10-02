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
    `x^2y` (`x²·y` / `x^{2y}`).
  - An operand after white space when the exponent is a name or is signed,
    or the base is `e`: `e^i pi`, `e^-x y`, `e^2 pi i`. A number exponent
    then white space is not reported: `x^2 y` is `x²·y`.
  - A `/` after an exponent that is a name, is signed, or is the number 1:
    `e^x/2`, `e^-x/2`, `x^pi/2`, `x^1/2` (`(x^1)/2` / `x^{1/2}`). `x^3/2` is
    not reported: the decision of 2026-09-30 is that `^` binds tighter than
    `/`.
  - The span starts at the base and ends at the end of the operand that has
    the second reading (`e^2pi` is the span `e^2pi`).
  - `detail`: `{ exponent }` (the source text of the exponent read).
- **`ambiguous-implicit-subscript`** — a letter directly followed by a digit
  is read as a subscript: `x2`, `θ2`, `π2`, `α1`, `y = x2` (`x_2` / `x·2`).
  Also a digit subscript directly followed by a letter: `x_1y` (`x_1·y` /
  `x_{1y}`). A library function name with a digit (`atan2`, `log2`, `log10`)
  is not reported.
- **`ambiguous-name-digits`** — a run of letters and digits that is not a
  library function, before a parenthesis: `atan3(y)` is `arctan(3·y)`.

### 5.2 Names and functions

- `ambiguous-letter-run` (renamed): a run of letters read as a product of its
  letters or parts (`eps`, `sinx`, `pie`, `alphabet`).
- **`ambiguous-function-argument`** — a library function name with no
  parentheses, followed by more than one factor: `sin x y` (`sin(x·y)` /
  `sin(x)·y`), `sqrt 2 x`, `ln 2 x`, `exp 2 x`, `abs 2 x`. Also `log` with
  no parentheses before a number: `log 2 x` is read as `log₂(x)`. `sin 2x`
  (no white space inside the argument) is not reported.
- **`ambiguous-function-without-parentheses`** — a symbol declared as a
  function in the engine, followed by an operand with no parenthesis: `f x`,
  `2 f x` (`f·x` / `f(x)`).
- **`ambiguous-name-then-number`** — a name that is not a function, white
  space, then a number: `x 2`, `θ 2` (`x·2` / `x_2`).
- **`ambiguous-delta`** — `Δ` or `Delta` directly followed by a letter:
  `Δx`, `ΔxΔy`, `Q = m c ΔT` (`Δ·x` / the one symbol "change in x").
- **`ambiguous-constant-name`** — a library constant (`e`, `i`, `pi`, `π`,
  `inf`) alone on the left of `=`: `e = 1.6e-19`, `i = V/R`, `pi = 3.14`. A
  person usually means a variable with that name. Also the constant directly
  followed by a parenthesized group on the left of `=`: `pi(x) = x` is read
  as `π·x = x`, `e(t) = t^2` as `e·t = t²`, and a person can mean the
  definition of a function with that name. `f(pi) = 3`, `2pi(x) = 3` and
  `pi(x)` with no `=` are not reported. The span is the left side of `=`.
  `detail`: `{ name }` (the MathJSON name: `Pi`, `e`, `i`).
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
  `detail`: `{ name }`. (Added 2026-10-01 for a host report.)
- **`ambiguous-lookalike-letter`** — a Greek letter that looks like a Latin
  letter: the capitals Α Β Ε Ζ Η Ι Κ Μ Ν Ο Ρ Τ Υ Χ, and ο (omicron).
- **`ambiguous-unknown-character`** — a character that the lenient grammar
  reads as a string because it is not math (`y = ж`).

### 5.3 Products and groups

- `ambiguous-denominator` (renamed): an implicit product after `/`
  (`1/2 x`).
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
  `5!=120` (`5 ≠ 120` / `5! = 120`), `n!=n(n-1)!`, `k!=1`.
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
  added 2026-10-01 for a host report.)
- **`ambiguous-percent`** — `%` after a number (`y = 50%`): LaTeX reads `%`
  as the start of a comment; a person means a percentage.

### 5.5 Numbers and layout

- `ambiguous-digit-groups` (renamed): white space joins digit groups
  (`2 3`, `1 000`).
- `ambiguous-letter-decimal` (renamed): `x.5`.
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
  (hexadecimal).
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
