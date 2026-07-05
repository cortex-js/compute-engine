# Cortex Language Design Review

_Reviewed 2026-07-05 against `src/cortex/docs/` (11 files, ~890 lines), the
implementation in `src/cortex/`, and the confirmed architecture decisions in
[`CORTEX_ROADMAP.md`](../../CORTEX_ROADMAP.md). Two parts: **consistency
defects** in what the docs already say, and **gaps** — things a v0 language
needs that the docs don't define yet. Each gap notes which phase owns it._

## Part 1 — Consistency defects

### 1.1 `operators.md` contradicts the implementation and itself

- Logic operators are listed as the word forms `and`, `or`, `not`, `=>`,
  `<=>`; the parser table and serializer use `&&`, `||`, `!`, and
  `reserved-words.ts` marks `and`/`or`/`not`/`xor` "Not in use". `=>` and
  `<=>` (implication/equivalence) appear nowhere in the implementation.
  **Decide once**: symbolic forms (`&&`) as primary with word forms as
  reserved-for-future, or the reverse. Recommendation: symbolic forms, since
  they match the loose-`ce.parse` compatibility goal and free the word forms.
- Relational list has both `=` and `==`/`!==`, without saying what `=` means;
  `implementation.md` uses `=` for assignment (`x = 2^11 - 1`), the parser
  maps `=` → `Assign` and `==` → `Equal`, `===` → `Same`. `!==` has no parser
  entry; `===` has no docs entry.
- The page defines precedence prose ("root of the parse tree has the lowest
  precedence") but no precedence table and no associativity list. The
  implementation's table has the known anomalies (And/Or bind tighter than
  Power; Multiply 390 vs Divide 660). The operators page must become the
  authoritative table that `src/cortex/operators.ts` (Phase 2 shared module)
  mirrors — including `|>`/`~>` (in the parser, absent from docs) and `->`
  (documented only under dictionaries).

### 1.2 `syntax.md` grammar stops at the lexical layer and has dangling references

The formal grammar ends with `_expression_ → _primary_` and
`_primary_ → _signed-number_ | _symbol_ | _string_` — no operators, calls,
collections, dictionaries, or control flow. It exactly documents the current
(incomplete) implementation rather than the language. Also:

- `_extended-string_ →` production is empty.
- `_escape-sequence_`, `_multiline-string-line_`, `_symbol-start_`,
  `_symbol-continue_` are referenced but never defined
  (`_symbol_start_`/`_symbol-start_` also disagree on hyphen vs underscore).
- `_binary-number_`/`_hexadecimal-number_` reference an undefined
  `_exponent_` (only `_base-10-exponent_`/`_base-2-exponent_` are defined —
  and binary numbers presumably take the base-2 exponent, which the grammar
  doesn't say).
- `_parenthesized-expression_`, `_shebang_` handling of front-matter, and the
  pragma grammar are absent.

**Action**: as each Phase 1/2 construct lands, extend this grammar; it should
be the single normative grammar (the markdown-rendering `Grammar` class dies
with `point-free-parser`).

### 1.3 Two overlapping pragma families

`pragmas.md` documents `#url`/`#filename` **and** `#sourceFile`/`#sourceUrl`
for the same concepts, plus `#sourceLocation(line, url)` for line control.
The parser implements only `#url`/`#filename`/`#line`/`#column`/`#date`/
`#time`/`#warning`/`#error`/`#env`/`#navigator`. Pick one family
(recommendation: keep the implemented short names, drop
`#sourceFile`/`#sourceUrl` from the docs, keep `#sourceLocation()` as a
documented-future line-control pragma or cut it).

### 1.4 Reserved-word list drift

`literals.md` omits six words present in `reserved-words.ts`: `async`,
`generator`, `iterator`, `parallel`, `union`, `variant`. One list must be
generated from the other (trivial: export the set, generate the docs
paragraph, or at minimum add a test asserting they match).

### 1.5 `{ }` is triply overloaded — the central grammar ambiguity

Per the docs themselves: `{}` is the empty **set** (`cortex.md`), `{->}` the
empty **dictionary**, `{k -> v, …}` a dictionary, `{a, b}` a set — and the
`implementation.md` control-flow example uses `{ … }` as a **block** after
`if`. Nothing defines how these disambiguate. Proposed resolution (to be
ratified in the Phase 2 plan):

- In expression position: `{` opens a collection. Empty → `Set`; first
  element containing a top-level `->` → `Dictionary` (all elements must
  then be key-value pairs); otherwise → `Set`.
- Blocks exist only in statement positions introduced by a keyword
  (`if … { }`, `else { }`, function bodies) — never as a bare expression.
  This keeps expression grammar unambiguous at the cost of "no bare block
  expressions", which is consistent with "everything is an expression"
  since `Do(…)` covers sequencing.

### 1.6 Smaller defects

- `cortex.md`: all four "readmore" boxes link to
  `/mathlive/cortex/comments/`; the pragma/literals/operators links are
  wrong. The `Domain(x)` example (`"2047 is a PrimeNumber"`) predates the
  type system — should become `Type(x)` or an assumption query.
- `implementation.md`: malformed JSON in three examples
  (`["List", 2, 7, 2, 4, 2])]`), "Dicitionary" typo, and the `if` example
  compiles `x += 1` to `["Equal", "x", ["Add", "x", 1]]` — `+=` is
  documented nowhere and `Equal` is surely meant to be `Assign`. The `else`
  branch also silently drops its block structure.
- `literals.md` prohibited-character table shows the wrong glyphs for
  U+002E FULL STOP and U+003C LESS THAN (copy-paste of `'` and `:`).
- `comments.md` defines doc comments (`///`, `/** */`) but no construct they
  attach to (see gap 2.9).
- `naming.md` is an empty page (title only) — see gap 2.10.
- `principles.md` ends with a dangling `- ` bullet.
- Fullwidth digits (U+FF10–FF19) are accepted as decimal/hex digits per
  `literals.md`/`syntax.md`. This is an unusual choice worth reconfirming
  (NFC normalization does not fold fullwidth forms; supporting them costs
  little but means `１２３` is the number 123 — decide and document either
  way).

## Part 2 — Gaps

Ordered roughly by how much they block later phases. Each item names an
owner phase from [`README.md`](./README.md).

### 2.1 Type system (Phase 2 for annotations; docs now)

The single biggest omission, and already decided in direction: Cortex reuses
the Compute Engine type language (`src/common/type/`, the syntax of
`ce.declare("f", "(real) -> real")`). The docs need a new `types.md`
covering:

- **Annotation positions**: declarations (`x: real = 5`), function
  parameters and return types (`f(x: real, n: integer) -> real`), and
  standalone declarations. Types are parsed by the type subparser only in
  these delimited positions — type syntax tokens (`<`, `>`, `->`, `|`, `&`)
  are *not* part of the expression grammar.
- **Semantics**: an annotation compiles to the same MathJSON/engine calls as
  `ce.declare`; checking happens at canonicalization/evaluation time by the
  engine (Cortex adds no second type checker).
- **Inference**: unannotated symbols get engine-inferred types (document the
  engine's existing behavior, including the boolean-use-retypes-symbol
  convention).
- The type grammar itself is documented in `src/common/type/parser.ts` (BNF)
  — the Cortex page should link/embed, not fork it.

### 2.2 Declarations, assignment, and scoping (Phase 4; syntax decided in Phase 2)

`=` maps to `Assign` and that's the entire current story. Undefined:

- Declaration vs assignment: is first `=` an implicit declaration (current
  engine `assign` behavior) or is a keyword required? `let`/`const`/`var`
  are reserved but "Not in use". Recommendation for notebooks: implicit
  declaration on first assignment (Desmos/engine-like), `let` reserved for
  a future explicit form.
- Scoping: lexical scopes for blocks/functions mapping onto engine scopes
  (`ce.pushScope`); what a notebook *cell* is (one program sharing the
  notebook's scope — Tycho integration decision).
- Mutability/redefinition rules, shadowing.
- Compound assignment (`+=` appears in one example) — in or out for v0
  (recommendation: out).

### 2.3 Function definitions and anonymous functions (Phase 4)

Only *calls* are designed. Undefined: named definition syntax
(`f(x) = x^2`? `function f(x) { }`?), anonymous functions/lambdas (MathJSON
has `Function`; the engine's `\mapsto`; `->` is taken by KeyValuePair),
closures and capture semantics (the engine has function-literal
canonicalization with closure capture — Cortex should map onto it, not
reinvent). Recommendation: mathematical style `f(x) = expr` as the primary
form, mapping to `["Assign", "f", ["Function", expr, "x"]]`.

### 2.4 Control flow (Phase 4)

`cortex.md` has an empty "Flow Control" heading; `implementation.md` shows
one `if/else` example. Undefined: `if` as expression vs statement (principle
says everything is an expression → `if` yields a value, maps to `["If", …]`),
loops (`for`/`while`/`loop`/`repeat` all reserved — pick one or two; map to
`Loop`/`FixedPoint`/collection operations), `break`/`continue`/`return`,
`match` (reserved; engine has no direct equivalent — defer past v0).

### 2.5 Statement termination and sequencing (Phase 2)

The `implementation.md` example uses `;` — documented nowhere. The
whitespace-sensitive operator rule exists precisely to allow multi-line
expressions without separators, but the interaction (newline vs `;` vs
juxtaposition → `Do`) is unspecified. Needs: when two adjacent expressions
are a sequence, when they're an error, what `;` adds, and what a blank line
means. This must be settled in Phase 2 since the Pratt parser's
statement-boundary recovery depends on it.

### 2.6 LaTeX islands (Phase 2; new — decided 2026-07-05)

`$...$` is a primary expression whose contents are parsed as LaTeX by an
injected parser, splicing the resulting MathJSON into the AST. Needs a docs
section (in `literals.md` or its own page): delimiter rules (no nesting;
`\$` escape inside; `$$` empty island is an error), what LaTeX dialect
(whatever the injected `ce.parse` accepts), and that `$` remains prohibited
as a symbol's first character (already the case in `literals.md`) so the
lexer is unambiguous.

### 2.7 Collection access, ranges, and tuples (Phase 2 syntax, Phase 4 semantics)

- Indexing/slicing: `list[1]`? `At(list, 1)` only? 0-based per `cortex.md`
  ("start with 0") — note the engine's `At` is 1-based; this **must** be
  reconciled (recommendation: follow the engine, 1-based, and fix
  `cortex.md`; a language/engine off-by-one would be a permanent bug farm).
- Ranges: no syntax (`1..10`? `Range(1, 10)` only?). `..` already means
  something in the type language — fine, different grammar island.
- Tuples: `(1.5, 0.5)` per `implementation.md`, but `(expr)` is a
  parenthesized expression — the one-element tuple and empty tuple are
  undefined (recommendation: no one-element tuple; `()` is `Nothing` or an
  error).
- `Sequence` via bare commas (`sequence = 2, 5, 7`) collides with argument
  and collection separators — probably drop bare-comma sequences from v0.

### 2.8 Evaluation semantics (Phase 4, but write the principle down now)

The examples imply symbolic-by-default (`Simplify(2 + 3x^3 + …)` returns a
symbolic result; `x = 2^11 - 1` then `\(x)` interpolates 2047). Undefined:
when does evaluation happen (per top-level expression, engine `evaluate()`),
what `.N()`-style numeric approximation looks like in the language, error
values ("Errors are values" per `principles.md` — presumably MathJSON
`["Error", …]` expressions flow as values; say so), and what a REPL/notebook
displays for each top-level expression.

### 2.9 Comments in the AST / doc comments (Phase 3)

The serializer honors a `comment` property on MathJSON objects; the parser
discards all comments as whitespace. Doc comments (`///`, `/** */`) have no
attachment rule. For notebook round-tripping decide: comments attach to the
following expression's MathJSON as metadata (parser support in Phase 3), or
comments are lossy in v0 (acceptable; document it).

### 2.10 Naming conventions (docs only; `naming.md` is empty)

The examples rely on an undocumented convention: capitalized identifiers are
engine/library operators (`Simplify`, `Print`, `Sin`), lowercase are user
variables (`x`, `hello`). Since MathJSON library symbols are capitalized and
user symbols typically aren't, document this as a *convention with no
enforced semantics* — and note collisions are resolved by scope, not case.

### 2.11 Number literal completeness (Phase 1/2)

- Big integers/decimals: engine is arbitrary-precision; Phase 1 lexes digit
  strings so literals don't truncate — document that numbers are exact.
- Rationals: no literal syntax (`1/3` is a `Divide` expression — that's
  fine, the engine keeps it exact; say so).
- Imaginary/complex: serializer config claims `imaginaryUnit: 'i'` but there
  is no parse story (`2i`? `2 * i`?). Recommendation: no special literal;
  `i` is the engine's `ImaginaryUnit` symbol and `2i` is invisible-multiply
  — which requires deciding invisible multiplication (`2x`) generally:
  currently serializer-`@todo`, docs use `3x^3` in examples but the
  language never defines it. **Invisible multiply is in for v0** (the docs'
  own examples depend on it); specify it as digit-followed-by-symbol only,
  with the whitespace rule disambiguating.

### 2.12 Out of scope for v0 (document as non-goals)

Pattern matching (`match`), modules/imports (`import`/`export`/`module`),
error handling keywords (`try`/`catch`/`throw` — errors are values),
concurrency (`async`/`await`/`parallel`), attributes/annotations, macros.
All have reserved words held; a short "Future directions" section in
`cortex.md` should say they're reserved, not designed.

## Suggested docs work order

1. Now (with Phase 0): fix Part 1 defects that are pure errors (broken
   links, malformed JSON, glyph typos, reserved-word sync, pragma family
   pick) — these are mechanical.
2. With Phase 2: rewrite `operators.md` around the shared operator table;
   extend `syntax.md` grammar; add `types.md` (§2.1) and the LaTeX-island
   section (§2.6); settle §1.5, §2.5, §2.7, §2.11 as part of the parser
   design review.
3. With Phase 4: `declarations.md`/`control-flow.md`/`evaluation.md`
   (§2.2–§2.4, §2.8); fill `naming.md` (§2.10).
