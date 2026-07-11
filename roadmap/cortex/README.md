# Cortex Language

Cortex is a text-syntax programming language for scientific computing whose
intermediate representation is MathJSON, evaluated by the Compute Engine
(language design in `src/cortex/docs/*.md`; see the
[language review](./language-review.md) for its consistency state and gaps).

Cortex shipped as an **experimental** entry point
`@cortex-js/compute-engine/cortex` on 2026-07-09 — all phases (0–5) of the
2026-07-05 revival are complete. What genuinely remains is the
[Roadmap](#roadmap) below. History — the audit that started the revival, the
inventory snapshot, the per-phase completion log, and the per-phase design
documents — lives in [`STATUS_REPORT.md`](./STATUS_REPORT.md).

Public API:

- `parseCortex(source, url?) → [MathJsonExpression, ParsingDiagnostic[]]`
- `serializeCortex(expr, options?) → string`
- `executeCortex(ce, source, options?) → { value, diagnostics }`

## Architecture decisions (2026-07-05)

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
3. **`point-free-parser` is retired.** The Cortex parser is a hand-written
   `Lexer` + Pratt/recursive-descent parser in the house style of
   `src/common/type/lexer.ts`/`parser.ts`, with diagnostic accumulation +
   panic-mode recovery (always a partial AST + diagnostics — never
   throw-on-first-error) and source ranges on every node. The working
   lexical layer, the `characters.ts` Unicode tables, and the
   `ParsingDiagnostic`/fix-it types were ported; the combinator machinery
   was deleted.

## Roadmap

The revival (phases 0–5) is complete and shipped; this is the backlog of what
genuinely remains. It is the single list of open Cortex work — items leave it
once they land, and the record moves to the completed log in
[`STATUS_REPORT.md`](./STATUS_REPORT.md). None of these block use of the
experimental entry point; they are gated on demand from the first consumer
(Cortex fragments in Tycho notebooks). Effort tags: S small / M medium / L
large.

### Release-protocol (do at/around each release)

- **Docs sync (S).** Route `src/cortex/docs/` through the normal `doc/`
  workflow to cortexjs.io at release time (never edit cortexjs.io directly).
  Before syncing: fill `naming.md` (language-review §2.10), add the "Future
  directions" non-goals section to `cortex.md` (§2.12 — `match`, modules,
  `try`/`catch`, `async`, macros are reserved words, *not designed*), and do a
  final grammar pass on `syntax.md`.
- **Highlight mode (S).** Validate `src/cortex/highlight-js-mode.js` against
  the shipped grammar (operators, `$…$` islands, verbatim symbols, extended
  strings); derive a CodeMirror grammar for Tycho if needed (Tycho-side).
- **Runtime dist smoke in CI (S).** The nodenext consumer smoke test covers
  `/cortex` type resolution; add a runtime smoke that imports
  `@cortex-js/compute-engine/cortex` from the *packed* build and executes a
  tiny program (mirrors what the benchmark harness does for CE releases).

### Findings from the example programs (2026-07-10)

The examples sweep (`test/cortex/programs.test.ts` / `docs/examples.md`)
surfaced engine bugs and Cortex gaps. Already **fixed** (see the completed
log in `STATUS_REPORT.md`): the canonical-fold value-leak (`Divide(2, x)` →
`2` while `x` held `1`), the `String(…)` concatenation bug (interpolation
now works, incl. the `cortex.md` headline example), the `Type` operator
reporting `unknown` for lazy operands, and silent indexed assignment
(`xs[2] = 9` now emits a `runtime-error` diagnostic — as does any non-final
statement that evaluates to an error value).

The remaining engine-side items (lazy-collection semantics decision,
chained indexing, recursion knot-tying, the missing-builtins batch) are
**mirrored in the repo-root [`ROADMAP.md`](../../ROADMAP.md)** under
"Cortex example-programs findings" for engine-track visibility — when one
lands, remove it from both lists.

### Semantics gaps shipped as v0 caveats (complete on demand)

- **Enforce typed function params (M).** `f(x: integer) = …` parses and holds
  the annotation but `executeCortex` does not enforce it at call time — wire
  the annotation into parameter binding.
- **Comment fidelity through serialize (M).** Comments are dropped on
  serialize (documented lossy in `comments.md`); preserve them if round-trip
  fidelity is required for the notebook use case.
- **Recursive `f(n) = …` does not tie the knot (M).** A self-reference in a
  one-step function definition unfolds once and then stalls
  (`fact(10)` → `10·fact(9)`); the body is canonicalized before `f` exists.
  Workaround (documented in `examples.md`): `let f` first, then
  `f = n |-> …`. Fix: pre-declare the function symbol before canonicalizing
  the definition body.
- **Lazy collections capture mutable variables (M — design decision).**
  `xs = Join(xs, [k])` in a loop yields `[k, k, k]` (the list holds the
  *symbol*; a later read sees the final value), and a list literal as the
  final statement returns unevaluated elements (`[d, d+1]` → `[d, d+1]`,
  while the tuple `(d, d+1)` → `(5, 6)`). Engine lazy-collection semantics
  colliding with mutable program state — decide: eager element evaluation on
  `Assign`/statement value, or document the tuple idiom as the contract.
- **Chained indexing `m[2][1]` fails (S).** Canonicalizes to an
  `incompatible-type` error (`At` result typing); `m[2, 1]` works and is the
  documented form.
- **Operator conveniences (S, decide as a batch).** No `%` (use `Mod`), no
  postfix `!` (use `Factorial`), `a |> f` parses to `Pipe` but `Pipe` does
  not evaluate, `"a" + "b"` is a type error (no string concatenation
  operator), and `Append`/`Fold`/`StringJoin`/`RandomInteger` are not engine
  builtins (use `Join`/`Reduce`/interpolation/`Random`).

### Serializer / compile-target polish

- **Formatter trailing-space artifact (S).** One cosmetic
  trailing-space-before-newline case remains; a naive fix risks corrupting
  trailing spaces inside `"""` string literals, so it needs a scoped fix.
- **Python compile-target tails (M).** The Cortex→engine lowering currently
  fails closed in the Python target on `Comprehension`, stepped/descending
  `Range`, and multi-`Element` `Loop`; implement these when a Cortex program
  needs them.
