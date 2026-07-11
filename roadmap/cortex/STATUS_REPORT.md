# Cortex Language — Status Report

Status, audit history, inventory snapshot, and the per-phase completion log
for the Cortex language revival (`src/cortex/`, `src/cortex.ts`,
`test/cortex/`). Forward-looking reference (what Cortex is, architecture
decisions, plan index) lives in [`README.md`](./README.md) beside the
per-phase plans.

## Status

Shipped 2026-07-09 as the **experimental** entry point
`@cortex-js/compute-engine/cortex` (`parseCortex`, `serializeCortex`,
`executeCortex`). All phases of the 2026-07-05 revival are complete. Residual
release-protocol items — docs sync to cortexjs.io, highlight-mode validation
— stay user-driven at release time.

| Phase | Scope | Plan | Status |
| --- | --- | --- | --- |
| 0 — Hygiene | Mechanical fixes to current code + docs (`#date` bug, List/Set swap, `Element` naming, console output, docs errors) | [plan](./phase-0-hygiene.md) | ✅ done (2026-07-07) |
| 1 — Parser foundation | New lexer/parser, diagnostics + recovery, port lexical layer (49 green tests = DoD), delete `point-free-parser` | [plan](./phase-1-parser-foundation.md) | ✅ done (2026-07-07) |
| 2 — Expression layer | Shared operator table, Pratt + whitespace rule, calls, collections, dictionaries, type annotations, `$…$` islands; un-skip all suites | [plan](./phase-2-expression-layer.md) | ✅ done (2026-07-07) |
| 3 — Round-trip | Serializer completion, parse∘serialize property test, loose-syntax compat check | [plan](./phase-3-round-trip.md) | ✅ done (2026-07-07) |
| 4 — Semantics & execution | `executeCortex`, declarations/scoping, function definitions, control flow, pragma security, Tycho integration | [plan](./phase-4-semantics.md) | ✅ done (2026-07-07); v0 caveats: typed params parsed-but-unenforced; Tycho cell UX is consumer-side |
| 5 — Ship | Build target, `./cortex` export, docs sync, highlight mode, CHANGELOG (experimental) | [plan](./phase-5-ship.md) | ✅ done (2026-07-09); packaging landed — docs sync + highlight-mode validation remain user-driven at release time |

## Design documents (per phase)

The per-phase plans that drove the revival. All phases landed; these are kept
as the design record (each plan's own "open questions" were settled during its
implementation — the surviving open items are consolidated in the
[Roadmap](./README.md#roadmap)). **Dependency order**: 0 ∥ 1 → 2 → (3 ∥ 4) → 5.

| Document | Scope | Depth |
| --- | --- | --- |
| [`language-review.md`](./language-review.md) | Consistency review of `src/cortex/docs/` + language design gaps (type system, scoping, control flow, …), each gap assigned to a phase | Complete review |
| [`phase-0-hygiene.md`](./phase-0-hygiene.md) | Mechanical fixes to current code + docs; ran in parallel with Phase 1 | Detailed |
| [`phase-1-parser-foundation.md`](./phase-1-parser-foundation.md) | New lexer/parser (house style of `common/type`), diagnostics + recovery model, port strategy, `point-free-parser` retirement | Detailed |
| [`phase-2-expression-layer.md`](./phase-2-expression-layer.md) | Shared operator table, Pratt + whitespace rule, calls/collections/dictionaries, type-annotation subparser, `$…$` LaTeX islands | Detailed |
| [`phase-3-round-trip.md`](./phase-3-round-trip.md) | Serializer completion + parse∘serialize property test, loose-syntax compat check | Scoped |
| [`phase-4-semantics.md`](./phase-4-semantics.md) | Execution model, declarations/scoping, function definitions, control flow, pragma security, Tycho integration | Scoped, open decisions flagged |
| [`phase-5-ship.md`](./phase-5-ship.md) | Build targets, package export, docs sync, announcement | Checklist |

## Audit record (2026-07-05)

Kept for reference; the defects below were owned by Phase 0 (mechanical
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
   [language review](./language-review.md) Part 1 (rest)

## Inventory (as of the 2026-07-05 audit)

Snapshot from the audit — line counts and roles predate the Phase 1–5 work
(`point-free-parser/` was deleted in Phase 1; the `src/cortex/` file set grew
`tokens.ts`/`lexer.ts`/`parser.ts`/`operators.ts`/`execute-cortex.ts`).

| Path | Lines | Role |
| --- | --- | --- |
| `src/cortex/parse-cortex.ts` | 449 | Grammar rules, pragmas, top-level `parseCortex` |
| `src/cortex/serialize-cortex.ts` | 475 | MathJSON → Cortex text, operator/function tables |
| `src/cortex/formatter.ts` | 539 | Layout engine used by the serializer |
| `src/cortex/reserved-words.ts` | 84 | Reserved-word list (serializer-only today) |
| `src/cortex/utils.ts` | 21 | Misc helpers |
| `src/cortex/highlight-js-mode.js` | 196 | highlight.js syntax mode |
| `src/cortex/docs/*.md` | 888 | Language design docs (cortexjs.io frontmatter) |
| `src/point-free-parser/*.ts` | ~2,950 | Combinator library — deleted in Phase 1 |
| `src/cortex.ts` | 19 | Entry point (not in build TARGETS yet) |
| `test/cortex/*.test.ts` | 1,358 | 49 passing (lexical), 21 skipped (expression layer) |

## Completed log

- 2026-07-11 — **Release-protocol pair: runtime dist smoke + highlight
  mode.** (1) `test/consumer/cortex-runtime-smoke.mjs` (npm script
  `test:cortex-runtime`, invoked by `scripts/build.sh` right after the
  nodenext smoke in the production-build block) imports the built
  `dist/esm-min/{compute-engine,cortex}.js` bundles directly (the benchmark
  harness's consumption pattern) and asserts a tiny program evaluates to
  `3/2` with no diagnostics AND that `result.value.engine === ce` for a
  host-created engine — the cross-subpath code-split identity property.
  (2) `src/cortex/highlight-js-mode.js` could not even load (top-level
  `hljs` reference against an `_hljs` param, undefined `FUNCTION`,
  out-of-scope `rawDelimiter`); rebuilt against the shipped grammar —
  keywords/reserved words, `$…$` LaTeX islands, extended `#"…"#` strings,
  lexer-accurate operator classes incl. the new `%`/postfix `!` plus fancy
  Unicode variants, literal-classed constants, catch-all identifier moved
  last — with a validation header (date, grammar version, structural-check
  one-liner). highlight.js is deliberately NOT a devDependency; validation
  is static.
- 2026-07-11 — **Example-programs backlog round: recursion knot-tying,
  chained indexing, `%`/`!` operators, builtins batch.** (1) *Recursion*:
  the `Assign` canonical handler (`library/core.ts`) pre-declares the target
  as a function-typed symbol **before** canonicalizing a `Function` RHS, so
  a one-step `fact(n) = …` self-reference resolves and recursion unfolds
  fully (`fact(10) = 3628800`); the `let f` idiom remains for *mutual*
  recursion, which is still two-step. (2) *Chained indexing*:
  `collectionElementType` (`common/type/utils.ts`) now yields a sub-tensor
  (one fewer dimension) for a rank-≥2 list instead of collapsing to the
  scalar element type, so `At(At(m, 2), 1)` — Cortex `m[2][1]` — types and
  evaluates (`3`). (3) *Cortex grammar*: `%` = infix `Mod` (precedence 80,
  left-assoc) and postfix `!` = `Factorial` (precedence 110, must abut its
  operand; `!=`/`!in`/prefix `Not` unchanged; serializer parenthesizes
  `(n!)!`, never `n!!`). Lexer maximal-munch means unspaced `3!^2` is a
  diagnostic — write `3! ^ 2`; serialized output always round-trips.
  (4) *Engine builtins* (user-ratified as library operators, not Cortex
  lowerings): `Pipe(x, f)` evaluates via `apply` (so `a |> f` works),
  `Append(list, x)` (lazy, mirrors `Join`), `Fold(f, init, list)`
  (canonicalizes to `Reduce(list, f, init)`, foldl order),
  `StringJoin(s…)` (strict strings, unlike coercing `String(…)`; the
  pre-existing `<>` LaTeX entry now evaluates), `RandomInteger(n)` /
  `RandomInteger(a, b)` (inclusive bounds, seeded-RNG compliant,
  `pure: false`). Blast radius: full suite 15 972 passed / 0 failed,
  **zero snapshot churn** (4 080/4 080). Examples suite grew to 24 programs
  (`%` idiom throughout, one-step recursion, binomial `10!/(3!·7!)`,
  `m[2][1]`, `|> Mean`, `Fold`), mirrored in `examples.md`.
- 2026-07-10 — **String/Type/silent-error fixes (engine + executeCortex)**:
  three more items from the examples sweep closed. (1) `String(…)` joins
  operand *values* — a string operand contributes its content, not its
  serialized form (`core.ts`), so Cortex interpolation works:
  `"\(x) has type \(Type(x))"` → `"2047 has type integer"` (the `cortex.md`
  headline example, now an executable test). (2) The `Type` operator
  canonicalizes its lazy operand before reading `.type` — `Type(y)` for a
  symbol bound to an integer reported `"unknown"` (a lazy operand is not
  canonical, and a non-canonical expression has no type). (3)
  `executeCortex` emits a `runtime-error` diagnostic (with the statement's
  source range) for any *non-final* statement that evaluates to an error
  value — previously such errors vanished since only the last statement's
  value is returned; this makes `xs[2] = 9` (unsupported indexed
  assignment) and mid-program `const` reassignment loud. Final-statement
  errors stay in `value` per the errors-are-values contract. New
  `runtime-error` diagnostic code; docs (`evaluation.md`), engine tests
  (`string-and-type.test.ts`), execute tests, and a new Strings example in
  `examples.md`/`programs.test.ts`.
- 2026-07-10 — **Canonical-fold value-leak FIXED (engine)**: canonical folds
  no longer follow symbol value bindings. `.isSame(1)`/`.isSame(0)` in
  canonicalization folded a mutable symbol's *transient* value into
  canonical structure — `Divide(2, x)` → `2` while `x` held `1`, →
  `ComplexInfinity` while it held `0`, `Multiply(2, x)` → `2`, `Ln(x)` → `0`
  — so a Cortex/notebook loop `x = (x + 2/x)/2` from `x = 1` computed 63/32
  instead of √2. Fix: a structural `isLiteral(op, n)` helper
  (`arithmetic-mul-div.ts`) used at every *positive* canonical fold
  (canonicalDivide ×10, Product/canonicalMultiply ×5, tensor scalar, `div()`
  ×6, `Ln(1)→0` in `box.ts`, and `BoxedSymbol.sqrt()/ln()` folds removed);
  *negative* guards (e.g. blocking `x/x → 1` when the denominator is
  provably 0) deliberately keep value-following — they are conservative,
  not structure-minting. Evaluation semantics unchanged (values still
  substitute at evaluate). Blast radius: full suite green, **zero snapshot
  churn**; only known timing flakes (integration-rules timeout under CPU
  contention, tokenizer scale budget — both pass solo). Regression tests in
  `canonical-regressions.test.ts` ("Canonical folds must not follow symbol
  value bindings"); the Cortex Newton example now starts at the natural
  `x = 1` and doubles as an end-to-end regression.
- 2026-07-10 — **Example-programs suite**: 18 complete Cortex programs in
  `test/cortex/programs.test.ts` (executed through `executeCortex`, exact
  assertions) mirrored 1:1 in `src/cortex/docs/examples.md` — iteration
  (Euler #1, FizzBuzz-as-a-Map, Collatz, Euclid, Fibonacci, trial-division
  primes), recursion (pre-declared lambda idiom), numeric methods (Newton,
  trapezoid, Monte Carlo), exact/symbolic showcases (harmonic H₂₀ exact,
  Basel vs π²/6, D of a user function, Solve+verify, golden-ratio LaTeX
  island), collections (matrix det/transpose/`m[i,j]`, exact statistics,
  Filter+Reduce). Idioms established: tuples for multi-value display (lists
  are lazy), `Map` result materialized with `.each()`, `Mod`/`Factorial` in
  lieu of `%`/`!`. The exercise surfaced 2 engine bugs (canonicalDivide
  value-leak — the `2/x → 2` when `x:=1` wrong-answer class — and
  `String(…)` concatenation) plus 5 Cortex gaps (recursion knot-tying, lazy
  collection capture, chained indexing, silent indexed assignment, operator
  conveniences) — all recorded as backlog items in README.md.
- 2026-07-10 — **Verbatim symbols are truly literal (language-review §2.13
  resolved)**: the content of a `` `…` `` verbatim symbol undergoes NO escape
  processing and must be a valid MathJSON symbol name (checked with
  `isValidSymbol` from `src/math-json/symbols.ts`). Rationale (ratified by
  user): a symbol name must follow the MathJSON symbol profile (UAX31
  XIDS/XIDC over recommended scripts + emoji), so the verbatim form exists
  only for names the inline form reinterprets — i.e. reserved words. Since no
  character of a valid name ever needs escaping, string-style escapes inside
  backticks could only produce *invalid* names (space, controls, backslash,
  quotes are never XID_Continue) — they were pure traps (`` `\sin` `` cooked
  `\s`→space). Peers agree: Swift `` `if` ``, F# ` ``…`` `, Rust `r#if` are
  all literal. Changes: `scanVerbatimSymbol` (lexer.ts) no longer calls
  `scanEscapeSequence` and validates with `isValidSymbol`; serializer
  `escapeSymbol` unchanged behaviorally (documented: `escapeString` is the
  identity on every valid name; invalid names emit escaped for lexical
  balance and re-parse as `invalid-symbol-name`); docs rewritten
  (`literals.md` Symbols intro + Verbatim Form around the reserved-word
  rationale and the MathJSON profile; `syntax.md` grammar production +
  primary example); tests updated (`lexer.test.ts`, `cortex-parse.test.ts`
  incl. `` `new`(x) `` call head, 4 new invalid-name snapshots). 285 cortex
  tests, whole-src typecheck, madge clean.
- 2026-07-09 — **Phase 5 (Ship) — packaging**: Cortex is published as the
  experimental entry point `@cortex-js/compute-engine/cortex`. Restored `cortex`
  to `TARGETS` in `scripts/build.sh` (the `.d.ts` branch already existed);
  added `CORTEX_UMD_OPTIONS` + a `{ esmViaSplit: true }` row to the `ENTRIES`
  table in `scripts/build.mjs` and joined `./src/cortex.ts` to the
  **code-splitting** ESM invocation alongside `compute-engine` and
  `integration-rules` — so `executeCortex(ce, …)` shares the engine core chunk
  and cross-bundle identity holds (verified: engine created from the main entry,
  `executeCortex` called from `/cortex`, `3/2` with no diagnostics). Added the
  `./cortex` `exports` entry to `package.json`, extended the nodenext consumer
  smoke test (`test/consumer/nodenext-smoke.mjs`) to import `/cortex` and touch
  `parseCortex`/`serializeCortex`/`executeCortex`/`version`, and documented the
  entry in CHANGELOG (Unreleased) and README (both marked experimental). Bundle
  sizes confirm chunk-sharing: `dist/esm-min/cortex.js` ≈ 57 KB (re-exports over
  shared chunks) vs self-contained `dist/umd-min/cortex.cjs` ≈ 1.6 MB. Full
  production build (incl. version stamping + nodenext smoke), the 285 cortex
  tests, and typecheck all pass. No source under `src/cortex/` or
  `src/compute-engine/` needed changes; the CHANGELOG usage snippet was verified
  to run against the built dist before landing. Remaining Phase 5 items (docs
  sync to cortexjs.io, highlight-mode validation) stay user-driven at release
  time.
- 2026-07-07 — **Phase 4 (Semantics & execution)**: Cortex runs in a notebook
  cell via `executeCortex(ce, source, options?) → { value, diagnostics }`
  (sequential top-level statements in a shared scope; symbolic-by-default with
  explicit `N()`; errors-are-values; pragma security — `#env`/`#navigator`
  gated off by default, `#error` → diagnostic). **Declarations** use the
  enhanced engine `Declare` (`let`/`const`, const = `constant: True` binding
  attribute enforced by the engine, type inferred; a type annotation implies a
  declaration; bare `x = 5` = `Assign`). **Functions**: `f(x)=expr`,
  `function f(x){…}`, mapsto lambda `x |-> expr` → `Function`. **Control flow**:
  `if` is a true **expression** (`If`, usable as RHS/operand); `while` →
  `Loop(Block(If(Not(cond),Break), body))`; `for x in xs` → `Loop(…, Element)` —
  all real engine primitives (compile via `base-compiler`). Surfaced + fixed an
  engine `for`-binding bug (loop var assigned in a shadowing `freshScope` vs the
  Block's lexical scope — fix in `control-structures.ts runNestedElements`,
  landed with the user's Loop/Map de-conflation). Docs: `declarations.md`,
  `control-flow.md`, `evaluation.md`, `naming.md`. Notebook integration test +
  pragma-gating tests. **285 `test/cortex` green**, typecheck + madge clean.
  v0 caveats: typed function params parsed-but-unenforced; `While` custom head
  dropped in favor of the `Loop` lowering; `List` literals keep elements lazy
  (engine convention). Next: Phase 5 (ship).
- 2026-07-07 — **Phase 3 (Round-trip coherence)**: `parse∘serialize` locked
  by a 66-expression property harness (`test/cortex/round-trip.test.ts`) that
  asserts structural equality under documented normalizations AND zero
  re-parse diagnostics, covering every operator row + collection/call/index
  form. Serializer gaps filled: `Rational`→`1 / 2` (normalizes to `Divide`),
  negative-literal folding + spacing (`Add(a,-3)`→`a + -3`, `Negate(-1)`→`1`),
  narrow invisible-multiply `Multiply({num},{sym})`→`2x` behind a
  `canJuxtapose` guard (blocks `e`/`E` exponent, `0x`/`0b`, escape-needing
  syms — `Multiply(2,"e5")` stays `2 * e5`), `Do`→statement-per-line.
  Decisions: **comments lossy in v0** (documented in `comments.md`);
  **invisible-mul serialization number×symbol only**. `If` left as the generic
  `If(…)` form (Phase 2 has no `if`-expression; Phase 4 owns the statement
  form — documented). Formatter reviewed + first unit tests
  (`formatter.test.ts`); fixed a `StackBlock` continuation-indent bug (aligned
  to column, not indent-level); one cosmetic trailing-space-before-newline
  artifact left (fixing it risks corrupting `"""` literal trailing spaces).
  Loose-parser compat table added to `syntax.md` (`[1,2,3]`/`x^2` agree;
  `**`/`|>`/`f(x,y)`/bare-name/`2x` diverge — documented). `test/cortex`:
  227 passed, 0 skips. Not committed here. Next: Phase 4 (semantics &
  execution) — Phase 5 (ship) follows.
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
  architecture decisions ratified (see [`README.md`](./README.md)); per-phase
  plans + language review written in `roadmap/cortex/`.
