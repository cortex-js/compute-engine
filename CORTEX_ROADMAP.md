# Cortex Language — Roadmap

_Status tracker for the Cortex language revival (`src/cortex/`,
`src/point-free-parser/`, `src/cortex.ts`, `test/cortex/`). Audited
2026-07-05; direction decided the same day. Detailed per-phase
implementation plans live in [`roadmap/cortex/`](./roadmap/cortex/README.md)
— this file tracks status and records decisions. Move completed work to the
log at the bottom._

## 1. What Cortex is

Cortex is a text-syntax programming language for scientific computing whose
IR is MathJSON, evaluated by the Compute Engine (language design in
`src/cortex/docs/*.md`; see the
[language review](./roadmap/cortex/language-review.md) for its current
consistency state and gaps). Two public functions today:

- `parseCortex(source, url?) → [MathJsonExpression, ParsingDiagnostic[]]`
- `serializeCortex(expr, options?) → string`

**Goal**: a shippable experimental v0 whose first consumer is **Cortex
fragments in Tycho notebooks**.

## 2. Decisions (2026-07-05)

1. **Type annotations reuse the engine's type language.**
   `src/common/type/` (hand-written `Lexer` + recursive-descent `Parser`)
   is used as a subparser in annotation positions (`x: real`, function
   signatures). It needs a prefix-parse API (parse from an offset, report
   the end, no EOF requirement) and thrown-error → diagnostic bridging.
   Type-syntax tokens (`<`, `>`, `->`, `|`, `&`) never enter the expression
   grammar.
2. **The loose `ce.parse()` is NOT the expression parser — align with it
   instead.** The non-strict AsciiMath/Typst grammar is a math-notation
   parser over a LaTeX token model (unknown multi-letter identifiers split
   into letter products: `foo` → `f·o·o`; `&&`, `in`, `0x1F`, strings,
   comments are foreign to it). Instead: (i) keep Cortex syntax
   *compatible* where the grammars overlap (`**`, `|>`, `[1,2,3]`,
   `f(x,y)`, bare function names); (ii) reuse dictionary *data* and
   `serialize-number`; (iii) **`$...$` LaTeX islands**: a `$...$` span is a
   primary expression — its contents are parsed as LaTeX by an *injected*
   parser (mirroring the engine's `ILatexSyntax` injection pattern) and the
   resulting MathJSON is spliced into the Cortex AST like any other operand
   (`2 * $\frac{1}{2}$` → `["Multiply", 2, ["Divide", 1, 2]]`). Islands
   parse raw/structural by default (Cortex owns canonicalization); island
   diagnostics must be offset-mapped into the Cortex source.
3. **`point-free-parser` is retired.** The Cortex parser is rewritten as a
   hand-written `Lexer` + Pratt/recursive-descent parser in the house style
   of `src/common/type/lexer.ts`/`parser.ts`, with diagnostic accumulation
   + panic-mode recovery (always a partial AST + diagnostics — never
   throw-on-first-error) and source ranges on every node. The working
   lexical layer, the `characters.ts` Unicode tables, and the
   `ParsingDiagnostic`/fix-it types are ported; the combinator machinery is
   deleted.

## 3. Phases

Dependency order: **0 ∥ 1 → 2 → (3 ∥ 4) → 5**. Full plans in
[`roadmap/cortex/`](./roadmap/cortex/README.md).

| Phase | Scope | Plan | Status |
| --- | --- | --- | --- |
| 0 — Hygiene | Mechanical fixes to current code + docs (`#date` bug, List/Set swap, `Element` naming, console output, docs errors) | [plan](./roadmap/cortex/phase-0-hygiene.md) | ✅ done (2026-07-07) |
| 1 — Parser foundation | New lexer/parser, diagnostics + recovery, port lexical layer (49 green tests = DoD), delete `point-free-parser` | [plan](./roadmap/cortex/phase-1-parser-foundation.md) | ✅ done (2026-07-07) |
| 2 — Expression layer | Shared operator table, Pratt + whitespace rule, calls, collections, dictionaries, type annotations, `$…$` islands; un-skip all suites | [plan](./roadmap/cortex/phase-2-expression-layer.md) | ✅ done (2026-07-07) |
| 3 — Round-trip | Serializer completion, parse∘serialize property test, loose-syntax compat check | [plan](./roadmap/cortex/phase-3-round-trip.md) | not started |
| 4 — Semantics & execution | `executeCortex`, declarations/scoping, function definitions, control flow, pragma security, Tycho integration | [plan](./roadmap/cortex/phase-4-semantics.md) | not started |
| 5 — Ship | Build target, `./cortex` export, docs sync, highlight mode, CHANGELOG (experimental) | [plan](./roadmap/cortex/phase-5-ship.md) | not started |

Open design questions are flagged inside the phase plans (Phase 2: pipe
precedence, chained relationals; Phase 4: anonymous-function syntax, loop
form) and in the [language review](./roadmap/cortex/language-review.md)
(gaps §2.1–§2.12, each assigned to a phase).

## 4. Audit record (2026-07-05)

Kept for reference; the defects below are owned by Phase 0 (mechanical
ones) and Phases 1–3 (structural ones).

### Status found: dormant, unshipped, half-built

- **Feature work stopped March 2021** (`52b4c057` "cortex parsing of
  numbers"); everything since is repo-wide chore churn.
- **Not shipped**: no `./cortex` export; `cortex` build target excluded
  from the default `TARGETS`; never in CHANGELOG or ROADMAP.
- **No consumers** outside `src/cortex.ts`; no CLI/REPL/playground.
- **Tests green but hollow**: 49 pass (lexical layer only) / 21 skipped
  (every expression-level suite).

### What worked / didn't (verified empirically)

Numbers, symbols (incl. verbatim), all three string forms with
interpolation, comments, shebang, and pragmas parse. **Operators, function
calls, collections, and dictionaries never parsed**: `2 + 3` fails with
`unexpected-symbol`; `f(x)` parses as juxtaposition `["Do","f","x"]`. Root
cause: `parseWithPrecedence` (`point-free-parser/combinators.ts:257`) was a
stub returning a bare term — the shunting-yard engine behind the operator
table was never written. The serializer works but diverged from the parser
and the docs.

### Defect list

1. `#date` pragma returns day-of-week (`getDay()` for `getDate()`,
   `parse-cortex.ts:113`). → Phase 0
2. Serializer swaps List/Set delimiters vs docs (`["List",1,2,3]` →
   `"{1, 2, 3}"`). → Phase 0
3. Parser emits `Element`/`NotElement`; serializer only knows
   `ElementOf`/`NotElementOf` — round-trip broken. → Phase 0
4. `2+3` (no spaces) parses as two expressions `["Do", 2, 3]` — signed-
   number lexing swallows infix `+`/`-`. → Phase 2 (whitespace rule)
5. Reserved words not enforced (`in` parses as a symbol). → Phase 2
6. Precedence-table anomalies (And/Or tighter than Power; Multiply 390 vs
   Divide 660). → Phase 2 (shared table review)
7. `console.log`/`console.error` in `#warning`/`#error` pragmas. → Phase 0
8. `point-free-parser` latent bugs — inverted guard in
   `someSeparatedBetween`, needle/haystack bound in `skipUntilString`,
   stubbed `parseKeyString`, machine-float numeric parsing, never-populated
   fix-it machinery, no unit tests, ~40% dead commented code. → resolved by
   deletion (Phase 1)
9. Docs drift — broken readmore links, malformed JSON examples, glyph
   typos, reserved-word list drift, two overlapping pragma families,
   lexical-only grammar in `syntax.md`. → Phase 0 (mechanical) +
   [language review](./roadmap/cortex/language-review.md) Part 1 (rest)

## 5. Inventory (as of the audit)

| Path | Lines | Role |
| --- | --- | --- |
| `src/cortex/parse-cortex.ts` | 449 | Grammar rules, pragmas, top-level `parseCortex` |
| `src/cortex/serialize-cortex.ts` | 475 | MathJSON → Cortex text, operator/function tables |
| `src/cortex/formatter.ts` | 539 | Layout engine used by the serializer |
| `src/cortex/reserved-words.ts` | 84 | Reserved-word list (serializer-only today) |
| `src/cortex/utils.ts` | 21 | Misc helpers |
| `src/cortex/highlight-js-mode.js` | 196 | highlight.js syntax mode |
| `src/cortex/docs/*.md` | 888 | Language design docs (cortexjs.io frontmatter) |
| `src/point-free-parser/*.ts` | ~2,950 | Combinator library — to be deleted in Phase 1 |
| `src/cortex.ts` | 19 | Entry point (not in build TARGETS yet) |
| `test/cortex/*.test.ts` | 1,358 | 49 passing (lexical), 21 skipped (expression layer) |

## Completed log

- 2026-07-07 — **Phase 2 (Expression layer)**: every skipped parse suite is
  now enabled and green (0 `describe.skip`/`test.skip` in `test/cortex`).
  Landed in four stages. **A** — shared `src/cortex/operators.ts` consumed by
  both parser and serializer (the two-table `Element`/`ElementOf` divergence is
  structurally gone); Pratt precedence-climbing with the both-sides-or-neither
  whitespace rule; prefix unary + negative-literal folding; reserved-word
  rejection; n-ary chained relationals; `**`/`~>` aliases. **B** — postfix
  calls (`f(x)`→`["f","x"]`, compound callee→`Apply`) and 1-based indexing
  (`xs[i]`→`["At",xs,i]`); invisible multiplication (number→symbol/`(`,
  `2x`/`3x^3`/`2(2+1)`); `Tuple`/`List`/`Set`/`Dictionary` with the `{}`
  disambiguation (dict = `KeyValuePair` entries, string keys); the full §2.5
  sequencing rule (linebreak/`;` separators, no silent juxtaposition);
  serializer `Tuple`/`At`/`Dictionary` cases for round-trip. **C-code** —
  additive `parseTypePrefix()` in `common/type` (tolerant/allowTrailing,
  end-offset, heuristics scoped; 8 existing `parseType` callers untouched);
  Cortex type annotations parse-and-held as `["Declare","x",{str:T},expr?]`
  (final shape deferred to Phase 4); `$…$` LaTeX islands via an injected
  `parseLatex` (no static `latex-syntax` import; `2*$\frac12$`→`Multiply(2,
  Divide(1,2))`). **C-docs** — `operators.md`/`syntax.md` rewritten from the
  implemented grammar, new `types.md`, LaTeX-island section in `literals.md`
  (examples verified against the test suite). Ratified decisions recorded in
  the phase plan (pipe loose, chained relationals n-ary, `**` alias, 1-based
  index, invisible-multiply in). Open item logged: language-review §2.13
  (verbatim symbols vs `\sin`-style names). Not committed here (staged in
  parts). Next: Phase 3 (round-trip) ∥ Phase 4 (semantics & execution).
- 2026-07-07 — **Phase 1 (Parser foundation)**: hand-written `Lexer` +
  `Parser` in the `common/type` house style replaces `point-free-parser/`
  (all 9 files deleted). New files under `src/cortex/`: `tokens.ts`,
  `lexer.ts`, `parser.ts`, `diagnostics.ts` (ported types), `characters.ts`
  (moved from point-free); `test/cortex/lexer.test.ts` (53 new unit tests, the
  old library had none). `parseCortex` rewired behind its unchanged public
  signature; never-throws + two-level panic-mode recovery; numbers lex as raw
  text and convert to `{num}` with full precision (40-digit check passes).
  All previously-passing cortex tests green (104 passed / 21 still skipped for
  Phase 2), typecheck + `tsc -p` + madge (0 cycles, `src/cortex` stays out of
  the `compute-engine` graph) clean, zero `point-free-parser` references remain.
  Two intentional value-snapshot changes (spec-correct, not regressions): the
  stricter exponent lexer splits `2et` → `2`,`et` (old half-consumed the `e`),
  and multiline `\`-continuation now joins lines per `docs/literals.md`
  (`"""…hello\⏎world…"""` → `helloworld`, fixing the old `.slice(-1)` bug).
  Diagnostic-message snapshots also shifted (reviewed; values unchanged). Not
  committed. Fullwidth-digit support kept (open question resolved). Next: Phase 2
  (expression layer) — un-skip the 21 suites.
- 2026-07-07 — **Phase 0 (Hygiene)**: all 11 items landed. Code — `#date`
  `getDay()`→`getDate()`; serializer List `[…]` / Set `{…}` (empty `{}`);
  `ElementOf`/`NotElementOf` keys → `Element`/`NotElement`; dropped
  `console.log`/`console.error` from `#warning`/`#error` (warning-diagnostic
  threading deferred to Phase 1 — the point-free `combine()` snapshots
  diagnostics before the action callback, so there's no clean hook in the
  dying combinator layer). Docs — readmore links, false `Domain(x)`/PrimeNumber
  example, malformed JSON + `+=`/`Equal`→`Assign` in implementation.md, glyphs +
  reserved-word sync in literals.md (new `test/cortex/reserved-words.test.ts`
  asserts docs↔`reserved-words.ts` set-equality, 82 words), pragmas/operators/
  principles cleanup. Cortex suites green (51 passed, snapshot diff limited to
  List/Set/Element), typecheck clean. Not committed.
- 2026-07-05 — Audit; direction decided (revive for Tycho notebooks);
  architecture decisions §2 ratified; per-phase plans + language review
  written in `roadmap/cortex/`.
