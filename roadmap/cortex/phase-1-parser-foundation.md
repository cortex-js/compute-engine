# Phase 1 — New Parser Foundation

_Replace `src/point-free-parser/` with a hand-written lexer + parser in the
house style of `src/common/type/lexer.ts` / `parser.ts`, porting the working
lexical layer. At the end of this phase the parser does exactly what it does
today (literals, strings, symbols, comments, pragmas, shebang) — on a
foundation the expression layer can be built on._

## Design

### File layout (all under `src/cortex/`)

| File | Contents |
| --- | --- |
| `tokens.ts` | `TokenType` union, `Token` interface, trivia model |
| `lexer.ts` | `Lexer` class: source → tokens |
| `parser.ts` | `Parser` class: tokens → MathJSON + diagnostics |
| `diagnostics.ts` | `ParsingDiagnostic`, `DiagnosticCode`, `Fixit` (ported types), offset→line/col via `common/debug` `Origin` |
| `characters.ts` | Unicode tables moved from `point-free-parser/characters.ts` (already imported by the serializer) |
| `parse-cortex.ts` | Thin wrapper keeping the existing public signature `parseCortex(source, url?) → [MathJsonExpression, ParsingDiagnostic[]]` |

`src/cortex.ts` (entry point) is unchanged.

### Token model

```ts
interface Token {
  type: TokenType;
  /** Raw source slice (numbers keep their digits as written) */
  text: string;
  start: number;   // offset in source
  end: number;
  /** Whitespace (incl. comments) immediately before this token —
   *  load-bearing for the infix-operator whitespace rule and for
   *  sign vs infix +/- disambiguation in Phase 2. */
  precededByWhitespace: boolean;
  precededByLinebreak: boolean;
}
```

Token types (initial set): `NUMBER`, `SYMBOL`, `VERBATIM_SYMBOL`,
`STRING` (composite, see below), `PRAGMA` (`#name`), `OPERATOR`
(one type; the actual operator table lives in Phase 2's shared module — the
lexer just maximal-munches from a known operator-character set), `OPEN_PAREN`
/ `CLOSE_PAREN` / `OPEN_BRACKET` / `CLOSE_BRACKET` / `OPEN_BRACE` /
`CLOSE_BRACE`, `COMMA`, `SEMICOLON`, `LATEX_ISLAND` (lexed here, used in
Phase 2), `SHEBANG`, `EOF`, `ERROR` (invalid character run — the lexer never
throws).

**Numbers lex as strings.** The token keeps the raw text
(`0x1F`, `1_000.5e-2`, fullwidth digits if we keep them —
[`language-review.md`](./language-review.md) Part 1); the parser converts to
a MathJSON `{num: …}` preserving full precision (no `parseFloat` round-trip
for decimal literals; hex/binary floats may normalize through the existing
numeric conversion). This fixes the acknowledged big-number `@todo` of the
old library at the design level.

**Strings are composite tokens.** The lexer resolves the string form
(single-line / multiline / extended, per the existing ported logic) and
produces a `STRING` token carrying
`parts: (string | {start, end})[]` — cooked text segments interleaved with
raw source spans for `\(…)` interpolations. The parser recursively runs a
sub-parse on each interpolation span (same `Parser`, offset-shifted), so
diagnostics inside interpolations get correct positions. Multiline-string
indentation stripping and `\`-continuations are handled in the lexer,
following the rules in `docs/literals.md` (including the ones the old
implementation only half-enforced — the "every nonblank line must begin with
the closing-delimiter indentation" error).

**Trivia**: whitespace and comments are skipped, setting the
`precededBy*` flags. Doc comments (`///`, `/** */`) are additionally
*recorded* (token-adjacent list) so a later phase can attach them; nothing
consumes them in Phase 1.

### Parser and diagnostics

`Parser` follows `common/type/parser.ts` structurally (`current` token,
`advance`/`match`/`expect`) with the two deliberate differences:

- **Never throws.** `error(code, args?, fixits?)` appends a
  `ParsingDiagnostic` and continues; `expect()` on mismatch emits a
  diagnostic and *doesn't* consume. The single exception is the `#error`
  pragma (`FatalParsingError`), caught in `parseCortex`.
- **Panic-mode recovery** at two levels: within brackets, skip to the
  matching closer (bracket-stack maintained by the parser); at top level,
  skip to the next statement boundary (linebreak-preceded token or `;`).
  Every recovery emits exactly one diagnostic for the skipped region.

Every produced MathJSON node gets `sourceOffsets: [start, end]` (keep the
existing `exprOrigin` convention). Diagnostics carry offsets; conversion to
line/col stays in `parseCortex` via `Origin` (as today).

Port the `ParsingDiagnostic` / `Fixit` types and the `DiagnosticCode` union
from `point-free-parser/parsers.ts`. `test/utils.ts` imports the
`ParsingDiagnostic` type — update that import path.

### What is ported vs rewritten

| Old (`point-free-parser/`) | Disposition |
| --- | --- |
| `characters.ts` (Unicode tables, `ESCAPED_CHARS`, `isInvisible`, `FANCY_UNICODE`, digit sets) | **Move** to `src/cortex/characters.ts`; serializer imports update |
| `numeric-parsers.ts`, `string-parsers.ts`, `identifier-parsers.ts`, `whitespace-parsers.ts` | **Port the logic** into `Lexer` methods (they are already mostly character-level scanners; strip the combinator wrappers) |
| `parsers.ts` diagnostic types | **Port** to `diagnostics.ts` |
| `core-combinators.ts`, `combinators.ts`, `grammar.ts` | **Delete** (the stubbed precedence engine, `must`/`either`/`sequence`, the markdown grammar registry) |
| Pragma handlers in `parse-cortex.ts` | **Port** as `Parser` methods (with the Phase 0 fixes) |

## Steps

1. `tokens.ts` + `lexer.ts` + unit tests (`test/cortex/lexer.test.ts`):
   token streams for numbers (all forms + `_` separators + signs), symbols,
   verbatim symbols, each string form incl. interpolation spans, comments
   (nested blocks), shebang, pragmas, operators (maximal munch: `===` not
   `==` `=`), `$…$` islands (lexed, unused), error tokens. Include the
   invalid cases from the existing parse tests (unterminated strings,
   invalid escapes).
2. `diagnostics.ts` (ported types) + `parser.ts` skeleton: primary =
   number | symbol | string | pragma | parenthesized; top-level =
   shebang? expression* EOF with `Do`-wrapping, exactly today's semantics.
3. Rewire `parse-cortex.ts` to the new parser behind the unchanged public
   signature. Run the cortex test suites; iterate until the **49 passing
   tests are green with unchanged snapshots** (diagnostic *messages* may
   differ — those snapshot changes are expected and reviewed; the parsed
   *values* must not).
4. Update `test/utils.ts` import; move `characters.ts`; update serializer
   imports.
5. Delete `src/point-free-parser/`. Run
   `npx madge --circular --extensions ts src/compute-engine` (and confirm
   `src/cortex` stays out of `src/compute-engine`'s dependency graph),
   `npm run typecheck`, `npx tsc -p tsconfig.json --noEmit`.

## Definition of done

- All 49 previously-passing cortex tests green; value snapshots unchanged.
- New lexer unit tests (the old library had none).
- `src/point-free-parser/` deleted; no references remain.
- Big-number check: `parseCortex('1234567890123456789012345678901234567890')`
  preserves all digits in the `num` payload.

## Open questions (settle during implementation)

- Fullwidth-digit support: keep or drop (language-review Part 1; costs one
  table either way — decide and document).
- Whether `ERROR` token runs should be one token per run or per character
  (affects diagnostic granularity only).
