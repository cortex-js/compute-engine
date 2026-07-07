# Phase 2 — Expression Layer

_Everything between a lexed token stream and a full expression grammar:
Pratt precedence, calls, collections, dictionaries, type annotations, and
`$…$` LaTeX islands. At the end of this phase every currently-skipped parse
suite is enabled. Depends on Phase 1; the serializer-side table unification
also closes several Phase 0 wounds permanently._

## 1. Shared operator table — `src/cortex/operators.ts`

One module consumed by both parser and serializer (they diverged before —
`Element` vs `ElementOf` — because there were two tables):

```ts
interface OperatorDef {
  name: MathJsonSymbol;        // 'Add'
  symbol: string;              // '+'
  fancySymbol?: string;        // '−', '×', '∈', '≠', …
  precedence: number;
  kind: 'infix' | 'prefix' | 'postfix';
  assoc?: 'left' | 'right';    // infix only
  relational?: boolean;        // serializer spacing class
}
```

**The table must be reviewed before wiring** (audit found And/Or binding
tighter than Power, and Multiply 390 / Divide 660 copied from LaTeX-side
constants). Proposed ordering, loosest → tightest (exact numbers free, gaps
of 10):

```
Assign(right)  <  Pipe(|> ~>, left)  <  KeyValuePair(->)  <  Or(||)  <  And(&&)
  <  relational (== === != < <= > >= in !in, n-ary chainable — see below)
  <  Add/Subtract(left)  <  Multiply/Divide(left, SAME precedence)
  <  unary prefix (- ! Not)  <  Power(^, right)
  <  postfix call/index
```

Deviations from the old table are deliberate: And/Or below relational
(standard); Multiply == Divide (left-assoc, so `a/b*c = (a/b)*c`); Power
right-assoc and above unary minus (`-x^2` = `-(x^2)`, matching math
convention and the engine). **Pipe precedence — DECIDED 2026-07-07: loose
(Elixir-style).** `|>`/`~>` sit at the loose end — looser than arithmetic,
relational, and boolean — but tighter than `Assign`, so `a + b |> f`
parses as `(a + b) |> f`, `a || b |> f` as `(a || b) |> f`, and
`x = a |> f` as `x = (a |> f)`. The docs must state this with those
examples. Fancy Unicode aliases come from the ported `FANCY_UNICODE`
tables and are pure alternate spellings (same table row).

**`**` as a `^` alias — DECIDED 2026-07-07: yes** (a single extra table
row; aligns with loose `ce.parse`).

Serializer switches `OPERATORS` to this module; `docs/operators.md` is
rewritten from it (table with precedence, associativity, fancy forms).

## 2. Pratt parsing with the whitespace rule

Standard precedence-climbing loop over `parsePrimary`. The documented
Cortex-specific rule (`docs/operators.md`): an infix operator has
whitespace on **both** sides or **neither**; prefix operators have **no**
whitespace before their operand. Implementation: the Phase 1
`precededByWhitespace` token flag, checked when deciding whether an
`OPERATOR` token continues the current expression:

- `a + b`, `a+b` → infix Add.
- `a +b` → NOT infix: expression `a` ends; `+b` starts a new statement
  (signed number / prefix). This is what makes separator-free multi-line
  programs parse deterministically.
- `a+ b` → diagnostic (`asymmetric-operator-whitespace`, with a fix-it) —
  more useful than silently ending the statement.

This same rule resolves the audit's `2+3` → `Do(2,3)` defect: the lexer no
longer folds signs into `NUMBER` tokens; the *parser* applies prefix `-`/`+`
(constant-folding negative literals into `{num: '-…'}` as the old code did),
and the whitespace rule decides sign vs infix.

**Reserved words**: `SYMBOL` tokens matching `RESERVED_WORDS` are rejected
in expression position with a diagnostic (verbatim form still works). `in`
and `!in` are recognized as operators by the Pratt loop (word-operators are
matched from the shared table, not hardcoded).

**Statement sequencing** (settles language-review §2.5): top-level and
block-level expressions are separated by linebreaks or `;`. Two expressions
on one line without a separator = diagnostic (no silent `Do`-juxtaposition
— today's `f(x)` → `Do(f, x)` behavior disappears when calls land). The
program still wraps multiple statements in `["Do", …]`.

## 3. Postfix: calls and indexing

- `f(a, b)` → `["f", a, b]`; expression callee `(getF())(x)` →
  `["Apply", callee, x]`. The `(` must NOT be preceded by whitespace
  (otherwise it starts a parenthesized/tuple expression — same
  whitespace-sensitivity as operators, and matches the serializer).
- Indexing `xs[i]` → `["At", xs, i]` — **1-based like the engine** (DECIDED
  2026-07-07; requires the `cortex.md` 0-based claim to be fixed; see
  language-review §2.7). Same no-whitespace rule.
- Empty call `f()` → `["f"]`.

## 4. Collections and dictionaries

- `(a, b)` → `["Tuple", a, b]`; `(a)` → parenthesized `a`; `()` →
  diagnostic (no empty tuple in v0).
- `[a, b]` → `["List", a, b]`; `[]` → `["List"]`.
- `{ … }` disambiguation (ratifies language-review §1.5): `{}` → `["Set"]`;
  `{->}` → empty `Dictionary`; after parsing the first element, a top-level
  `->` marks a dictionary (then all elements must be `key -> value`,
  unquoted keys = symbol-or-string per `docs/cortex.md`, with the
  no-escape-sequence caveat for unquoted); otherwise a `Set`. Blocks are
  NOT expressions (Phase 4 gives keywords their own block grammar).
- Trailing commas: allowed everywhere (friendly to notebooks/diffs);
  document it.
- Bare-comma `Sequence` (in `implementation.md`) is dropped from v0.

## 5. Type annotations — `common/type` subparser

Engine-side change (small, separate commit):
`common/type/parser.ts` gains a prefix mode —
`parseTypePrefix(source, offset): { ast: TypeNode; end: number }` (or a
`Parser` option `{ allowTrailing: true }` plus an end-position getter).
No EOF check in this mode; the "did you mean `list<…>`" heuristics that
scan `this.lexer.input` globally must be scoped to the consumed range.
Thrown errors are caught at the Cortex boundary and converted to
`ParsingDiagnostic`s (offset-shifted).

Cortex side: in annotation positions only — after `:` in a declaration
(`x: real = 5`) and, in Phase 4, in parameter lists/return types — the
Cortex parser calls the type subparser and resumes at `end`. The annotation
compiles to declaration metadata (v0: emit
`["Declare", "x", {str: "<typestring>"}]`-shaped MathJSON or attach to the
`Assign` — **decide with Phase 4's declaration design; until then the
parser can parse-and-hold the annotation**). Type-syntax tokens never leak
into the expression grammar.

## 6. `$…$` LaTeX islands

- Lexed in Phase 1 as `LATEX_ISLAND` (content span between single `$`
  delimiters; `\$` escape inside; unterminated → diagnostic; no `$$`).
- The parser hands the content to an **injected** LaTeX parser:
  `parseCortex` gains an option
  `{ parseLatex?: (latex: string) => MathJsonExpression }` (structural
  mirror of the engine's `ILatexSyntax` injection — `src/cortex` must not
  statically import `latex-syntax`). Absent the option, a `$…$` island is a
  diagnostic (`latex-parsing-unavailable`).
- Default parse form: raw/structural MathJSON (Cortex owns
  canonicalization uniformly at execution time). The returned expression is
  spliced in as a primary; its `sourceOffsets` are set to the island's
  Cortex-source range. Diagnostics *inside* the LaTeX (the engine's
  `Error`-node convention) stay embedded in the returned expression — v0
  does not translate them into `ParsingDiagnostic`s (revisit for notebook
  UX in Phase 4).

## 7. Tests

- Un-skip and flesh out: `OPERATORS` (incl. whitespace-rule cases:
  `a +b` two-statements, `a+ b` diagnostic, `-x^2`, `a/b*c`),
  `FANCY SYMBOLS`, `FUNCTIONS`, `COLLECTIONS`, `DICTIONARY`.
- New suites: type annotations (valid, invalid, offset-correct
  diagnostics), LaTeX islands (with a stub injected parser in unit tests +
  one integration test wiring real `ce.parse`), operator-table/serializer
  agreement (for every table row: `parse(serialize(["Op", a, b]))`
  round-trips).

## Definition of done

- All `test/cortex` suites enabled and green; no remaining `describe.skip`.
- `parse(serialize(x))` round-trips for every operator-table row and the
  collection forms.
- `docs/operators.md` and `docs/syntax.md` updated to the implemented
  grammar (they are the normative spec from here on).

## Decisions (settled 2026-07-07)

- **Pipe precedence: loose** (Elixir-style) — `a + b |> f` = `(a + b) |> f`;
  looser than arithmetic/relational/boolean, tighter than `Assign`. See §1.
- **Chained relationals: n-ary** — `a < b < c` → `["Less", a, b, c]`, like
  the engine (what math users expect; MathJSON supports it).
- **`**` as a `^` alias: yes** — a single table row.
- **Indexing: 1-based** — `xs[i]` → `["At", xs, i]`, matching the engine;
  fix the `cortex.md` 0-based claim (§3).
- **Invisible multiplication: in for v0** — number immediately followed by a
  symbol (no whitespace) only (`2x`, `3x^3`, `2i`); the whitespace rule
  disambiguates (language-review §2.11). `i` is the engine's `ImaginaryUnit`.
