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

1. **Type annotations reuse the engine's type language.** `src/common/type/`
   (hand-written `Lexer` + recursive-descent `Parser`) is used as a subparser in
   annotation positions (`x: real`, function signatures). It needs a
   prefix-parse API (parse from an offset, report the end, no EOF requirement)
   and thrown-error → diagnostic bridging. Type-syntax tokens (`<`, `>`, `->`,
   `|`, `&`) never enter the expression grammar.
2. **The loose `ce.parse()` is NOT the expression parser — align with it
   instead.** The non-strict AsciiMath/Typst grammar is a math-notation parser
   over a LaTeX token model (unknown multi-letter identifiers split into letter
   products: `foo` → `f·o·o`; `&&`, `in`, `0x1F`, strings, comments are foreign
   to it). Instead: (i) keep Cortex syntax _compatible_ where the grammars
   overlap (`**`, `|>`, `[1,2,3]`, `f(x,y)`, bare function names); (ii) reuse
   dictionary _data_ and `serialize-number`; (iii) **`$...$` LaTeX islands**: a
   `$...$` span is a primary expression — its contents are parsed as LaTeX by an
   _injected_ parser (mirroring the engine's `ILatexSyntax` injection pattern)
   and the resulting MathJSON is spliced into the Cortex AST like any other
   operand (`2 * $\frac{1}{2}$` → `["Multiply", 2, ["Divide", 1, 2]]`). Islands
   parse raw/structural by default (Cortex owns canonicalization); island
   diagnostics must be offset-mapped into the Cortex source.
3. **`point-free-parser` is retired.** The Cortex parser is a hand-written
   `Lexer` + Pratt/recursive-descent parser in the house style of
   `src/common/type/lexer.ts`/`parser.ts`, with diagnostic accumulation +
   panic-mode recovery (always a partial AST + diagnostics — never
   throw-on-first-error) and source ranges on every node. The working lexical
   layer, the `characters.ts` Unicode tables, and the `ParsingDiagnostic`/fix-it
   types were ported; the combinator machinery was deleted.

## Roadmap

The revival (phases 0–5) is complete and shipped; this is the backlog of what
genuinely remains. It is the single list of open Cortex work — items leave it
once they land, and the record moves to the completed log in
[`STATUS_REPORT.md`](./STATUS_REPORT.md). None of these block use of the
experimental entry point; they are gated on demand from the first consumer
(Cortex fragments in Tycho notebooks). Effort tags: S small / M medium / L
large.

### Release-protocol (do at/around each release)

- **Docs sync (S).** Route `src/cortex/docs/` through the normal `doc/` workflow
  to cortexjs.io at release time (never edit cortexjs.io directly). The
  page-content prep is **done** (2026-07-12): `naming.md` is filled
  (language-review §2.10), `cortex.md` has the "Future directions" non-goals
  section (§2.12) plus a Flow-Control summary, and `syntax.md` had its final
  grammar pass (undefined `_exponent_` production defined, `_extended-string_`
  and `_signed-number_` productions completed, `_` digit separators noted). Only
  the user-driven sync itself remains.
- **Highlight-mode revalidation (S).** `highlight-js-mode.js` was re-validated
  2026-07-12 (see its header) — the structural check passes and the lowercase
  `true`/`false` literal aliases were added to the constants table. highlight.js
  is not a devDependency, so re-run the header's structural check whenever the
  grammar changes. Deriving a CodeMirror grammar for Tycho remains a Tycho-side
  item, gated on demand.

### Findings from the example programs (2026-07-10)

The examples sweep (`test/cortex/programs.test.ts` / `docs/examples.md`)
surfaced engine bugs and Cortex gaps. Already **fixed** (see the completed log
in `STATUS_REPORT.md`): the canonical-fold value-leak (`Divide(2, x)` → `2`
while `x` held `1`), the `String(…)` concatenation bug (interpolation now works,
incl. the `cortex.md` headline example), the `Type` operator reporting `unknown`
for lazy operands, silent indexed assignment (`xs[2] = 9` now emits a
`runtime-error` diagnostic — as does any non-final statement that evaluates to
an error value), and — 2026-07-11 — recursion knot-tying (one-step `f(n) = …`
now works), chained indexing `m[2][1]`, the builtins batch (`Pipe` evaluation,
`Append`, `Fold`, `StringJoin`, `RandomInteger`), and the lazy-collections
decision (**ratified: literals are values, pipelines are generators** —
`List`/`Dictionary` literals evaluate their elements like `Set`/`Tuple` always
did; lazy operators keep late binding, documented as generator semantics in
`evaluation.md`).

All engine-side findings from the sweep are closed; the section that mirrored
them in the repo-root `ROADMAP.md` has been retired.

### Findings from the examples sweep 3 (2026-07-11)

A third exploration wave (control flow/predicates, integers/strings, math depth)
added 18 programs to the suite (now 68) and surfaced seven engine bugs, all
**fixed same day** (see CHANGELOG `[Unreleased]`): dictionary-`At` value typing,
big-integer truncation in tensor-promoted list literals, `Reduce`/`Fold` float
fast-path exactness + imaginary-part drop, `Map` element-type inference,
`StringFrom` broadcast pre-empting its collection join, non-exact `e^{iθ}` for
constructible angles, and one-step function definitions not binding inside
applied function bodies.

Residuals (engine, small):

- **Exact big integers serialize in a compact exponent form (S) — investigated
  2026-07-12, closed as intentional.** `Fold`-computed `25!` prints as
  `15511210043330985984e+6` and `String(100!)` as `…e+24`, so naive string-based
  digit manipulation reads scientific notation instead of full digits. On
  investigation this is **not** a bug: the root cause is not
  `BigDecimal.toString` (that path isn't reached) but `numberToString`
  (`numerics/strings.ts`), which compacts any bigint with > 5 trailing zeros to
  `<head>e+<zeros>`. That form is **exact and round-trips losslessly** — it is
  the deliberate serialization mandated by the `RT-P0-1` contract
  (`numbers.test.ts`): exact big integers must emit a compact *string*
  (`{num:"1e+23"}`), never a JSON float (`Number(10n**23n) === 1e+23 ≠ 10^23`,
  which would corrupt on reconstruction). Non-round integers (`7^30`) already
  serialize as full digits; only trailing-zero runs compact. The behavior is
  locked by `RT-P0-1` plus inline snapshots (`602e+21`, `1234567e+19`). A
  targeted refinement exists (compact only when trailing-zeros ≥ head-length,
  which would leave every existing snapshot unchanged while giving factorials
  full digits), but per the 2026-07-12 decision we keep the current tested
  behavior; the fix is a Cortex-side `String()` boundary formatting choice if a
  consumer ever needs full-digit output.

Ratified and **landed 2026-07-11** (record in `STATUS_REPORT.md` completed
log): lowercase `true`/`false` are input aliases for `True`/`False` (reserved
as binding names; serializer unchanged); ASCII `..` is a range operator
(precedence 65 — `k in 1..n-1` groups as expected; input alias only, `Range`
still serializes as a call since infix can't express a 3-arg stepped range;
the number lexer no longer eats the first dot of `1..5`); `StringJoin`
accepts a single collection of strings, including a lazy `Map` result, so
`StringJoin(Reverse(Characters(s)))` works.

### Semantics gaps shipped as v0 caveats (complete on demand)

- **Typed function params: CLOSED (native typed function literals, committed
  652a20fc 2026-07-12).** Typed defs (`f(x: integer) -> real = …`,
  `function f(x) -> real { … }`), anonymous `(x: integer) |-> …`, enforcement,
  return types, and faithful serialize round-trip all ship natively via
  `["Typed", …]` annotations on the `Function` literal — see
  [`docs/plans/2026-07-12-typed-function-literals-design.md`](../../docs/plans/2026-07-12-typed-function-literals-design.md).
  Nothing remains for Cortex; the demand-gated engine follow-ons
  (optional/variadic annotations, strict-mode runtime return check) are
  tracked in the root `ROADMAP.md`.
- **Comment fidelity through serialize (M — investigated 2026-07-12, deferred).**
  Comments are dropped on a `parseCortex → serializeCortex` round-trip
  (documented lossy in `comments.md`). The gap is **one-sided**: the serializer
  already emits `/* … */` from a MathJSON `comment` metadata field
  (`serialize-cortex.ts` `serializeComment`), and the lexer already captures
  doc comments (`///`, `/** */`) with text + offsets onto `token.docComments`
  — but the parser never reads `token.docComments`, and ordinary `//` / `/*`
  comments are discarded as trivia, so nothing on the parse side ever populates
  the `comment` field the serializer knows how to print. Making it faithful is
  a cluster of design decisions, not a thread-through: (1) **attachment model**
  — a leading comment maps to the following statement (the lexer's
  "for the next token" model), but MathJSON has no trailing-comment slot
  (`x + 1 // note`) and no host for an orphan comment on its own line;
  (2) **style is lossy** — one `comment` string per node, always re-emitted as
  `/* … */`, so `//` vs `///` vs `/* */` all collapse and delimiters must be
  stripped on parse to avoid double-wrapping; (3) **multiplicity** — one field
  can't hold several comments on one node; (4) **boxing strips it** — verified
  `ce.box({fn:[…], comment:'…'}).json` drops the field, so a parser fix alone
  buys fidelity only for a *pure* parse→serialize pass on raw MathJSON, not
  through `evaluate()`/`box()` (that would need `comment` metadata carried in
  core CE's boxed layer — a cross-cutting change outside Cortex). The tractable
  ~M-sized subset is "leading comments on statements" (lexer captures ordinary
  comments too → parser attaches them to the next node's `comment` field →
  orphan/trailing comments hang off the enclosing `Block`); trailing-comment
  and through-engine fidelity are separately larger. **Deferred**: the v0
  lossiness is a deliberate scope call (notebooks keep prose in markdown cells,
  not code comments), and there's no current consumer demand for code-comment
  round-tripping — revisit only if a Tycho use case needs it.
- **Mutual recursion in one-step definitions (M — on demand).** One-step
  self-recursion works (2026-07-11), but two functions defined in terms of each
  other still need `let` declarations first; a one-step form would require
  forward-declaring sibling references.
- **String concatenation stays interpolation + `StringJoin` (decided
  2026-07-11).** No `+` overload or dedicated operator; `"a" + "b"` remains a
  type error by design.
- **Loop accumulation builds an O(n)-deep lazy `Join` chain (M — found by the
  2026-07-24 agent eval, see `agent-eval-2026-07-24.md`).** The documented
  idiom `for k in 1..n { xs = Join(xs, [k]) }` stores `xs` as an n-deep
  `["Join",["Join",…]]` tree — every later operation re-walks (and recurses
  through) the chain, and its `toMathJson()` serializes the recipe. A
  targeted fix (eagerly flatten `Join` when all operands are materialized
  lists, below a size cap) must respect the deliberate Join laziness and the
  0.92.1 tuple-atomic Join semantics — needs its own design pass. The CLI
  `--json` materialization (2026-07-24) hides the symptom for display but
  not the accumulation cost.

### Language-design candidates from the examples sweep 2 (2026-07-11)

Found while writing the second examples wave; each is a design decision, not a
bug — decide when Tycho demand appears:

- **Unit-literal notation (M — design).** Cortex has no native unit syntax: bare
  `km` is a free symbol. Units are expressible today via `$…$` LaTeX islands
  (`$30\,\mathrm{km/h}$`) or `Quantity(30, "km/h")`. A first-class unit literal
  (e.g. `30 `km/h``?) needs a grammar decision.
- **Refutable binding — `if let` / `while let` (M — design sketched
  2026-07-29, gated on `Match` typed patterns).** The refutable counterpart
  of the destructuring `let` (which `declarations.md` rules irrefutable in
  form, pointing at `match` for conditional destructuring):
  `if let x = parse(s) { … } else { … }`, tuple patterns included. Design
  (from the effects-model discussion, see the "Rejected: `error`/partiality"
  section of `docs/EFFECTS-MODEL.md`): pure parser sugar lowering onto
  `Match`/`MatchCase` — no new engine primitive — with the bound symbol
  narrowed to `typeOf(scrutinee) & !error` via the existing `NegationType`.
  **Concrete engine prerequisite: a type-refutable `Match` pattern** (typed
  pattern `x: T`, incl. negation types) — today's `_x` wildcard matches
  anything, including `Error` values; a typed pattern is independently
  useful in plain `match`. Open ruling before implementing: the failure
  family — `error` alone, or `error | nothing` (Swift-`nil` intuition says
  include `nothing`, but `Nothing` is the engine's *erasure* marker,
  position-preserving only as `Missing`/`NaN`, so the scrutinee/lowering
  interaction with erasure must be specified and pinned by a test).
  `while let` and a `guard`-style `let x = e else { … }` are the same sugar
  at different lowerings. **Declined**: Rust/Swift `?` propagation —
  requires early-return (non-local control flow), which the
  expression-`Block` model deliberately lacks.
- **Block-expression closure bodies — `do { … }` RATIFIED 2026-07-11 (M).**
  `{…}` in expression position stays a set literal; the block-in-expression
  form is an explicit `do { … }` (the keyword is already reserved): a
  statement block in any expression position whose value is its final
  statement. Rejected: JS-style "block after `|->`" (silently changes the
  meaning of set-valued lambdas like `x |-> {x, -x}`). Ladder status
  (2026-07-11): rungs 1, 2 and 4 **landed** — `do { … }` parses in any
  expression position (serializer emits `do {…}` for expression-position
  Blocks only), zero-param lambdas `() |-> …` parse and apply, and a named
  inner function escapes its defining scope as a first-class value (the
  operator-def's captured `_lambdaLiteral` is resolved at the two
  value-position return points; the broader resolve-in-`BoxedSymbol.evaluate`
  approach breaks name-position `Assign`/`Declare` — don't re-attempt). The
  ladder is **complete: rung 3 landed 2026-07-11.** Separate `makeCounter()`
  invocations now get independent captured state — `[a(), a(), b(), a()]` on
  two counters returns `[1, 2, 1, 3]`. Root cause was narrower than the
  "needs a redesign" framing: the n-ary application path (`invoke` in
  `function-utils.ts`) already instantiates a fresh per-call scope and runs
  `captureClosures`, so *parameterized* factories were always independent;
  only the **nullary shortcut** (`makeLambda`, `ops.length === 1`) bypassed
  that machinery and evaluated the body in the shared persistent
  canonicalization scope. Fix: nullary functions with a scoped-`Block` body
  now evaluate their statements in a fresh scope parented to the defining
  scope and run `captureClosures` too (arguments ignored, preserving the
  nullary contract); plain-thunk / bare-expression bodies keep the direct
  fast path. No snapshot churn; the failed fresh-runtime-scope redesign was
  never needed because this leaves the shared canon-scope model intact
  everywhere else.

### Candidates from the Hica language review (2026-07-31)

A review of [hica.dev](https://www.hica.dev) (a small immutable-by-default
functional language with an unusually strong doc site) confirmed Cortex
already covers most of its language surface — `match` with pins/guards/rest/
dict patterns, destructuring `let`, if-as-expression, `|>`, interpolation,
lazy pipelines, errors-as-values, `_` digit separators — and is ahead on
CI-executed doc examples and the agents card + MCP server. Worth taking:

- **Range patterns in `match` — landed 2026-07-31** (see the completed log
  in `STATUS_REPORT.md`; spec = §8 of
  `docs/plans/2026-07-12-cortex-match-design.md`).
- **Effect surfacing in `cortex check` (S–M).** Hica marks any function
  using `random()` with an `ndet` effect reported by `hica check` — an
  independent validation of the paused effects model
  (`docs/EFFECTS-MODEL.md`). A cheap rung available before resuming the full
  model: `cortex check` reports nondeterminism/impurity derived from the
  existing `pure: false` operator metadata.
- **`cortex test` + assertion builtins (M).** Hica's
  `test "name" { assert_eq(…) }` blocks plus `hica test`. For Cortex:
  `Assert`/`AssertEqual` builtins (errors-as-values on failure) and a
  `cortex test` CLI subcommand, letting agents write self-checking programs —
  directly serves the feedback-loop goal from the 2026-07-24 agent eval.
- **Error propagation & rescue — COMPLETE: rungs 1–3 ALL LANDED
  2026-07-31** (rung 3 = operator-level bubbling + `ErrorTrace`
  breadcrumb per the measured §6a revision: no lazy gate,
  definition-derived collection carve-out, audited `inspectsErrors`
  widening, `Assume` errors-as-values; `Assume` result type fixed to
  string same day — `(any) -> string`, see §8a). Remaining follow-ups:
  breadcrumb sibling-value carry (deliberately out of v1); silent-NaN
  sites revisit (`xs[10]` → `Error`?) now unblocked since errors are
  rescuable. Landed: Match decides on
  error subjects, `IsError` observer, error bubbling at application/`|>`
  (callee-keyed — built-in operators stay frozen per the rung-3 boundary),
  `Nothing` argument-list erasure with route parity, and
  `cortex check`/run-path static `static-type-error` diagnostics. See §8a
  implementation notes in the design doc for the binding conventions
  (`inspectsErrors` flag, callee-keyed bubbling, the `.errors` walk).
  **New gap pinned:** typed patterns cannot express `x: !error` (`Element`
  resolves only simple named types) — this now blocks the refutable
  `if let` item below; compound/negation-type resolution in typed
  patterns is its concrete prerequisite (an unsupported annotation now
  at least diagnoses `type-pattern-unsupported` instead of silently
  never matching — adversarial-review fix). The `->` vs `|->` typo is
  now CAUGHT by `check` (the review found the error was minted but
  hidden inside a dictionary literal the walk didn't descend into; the
  general fix also surfaces `let g = "a" + 1`-class initializer errors).
  Remaining residuals: a **diagnostic-anchoring inconsistency**
  (`static-type-error` carets the statement start, `runtime-error` its
  end — unify when convenient); **`Assume` throws on the direct route
  while freezing on the pipe route** for an error operand (found by the
  review's divergence sweep — worse than a divergence, deserves its own
  fix; the other divergent lazy heads are `Simplify`/`Expand`/`Factor`/
  `Together`/`Hold`, see design-doc §8a). Full design + rationale:
  `docs/plans/2026-07-31-error-propagation-design.md` (`f(⊥) = ⊥`
  bubbling, observers, `|>` stays application sugar, NaN short-circuit
  rejected, effects-model reconciliation).
- **Exhaustiveness lint.** Already a v2 deferral in the match design (§7);
  Hica shipping it in a language this small is evidence it earns its keep —
  raise its priority when the type system tightens.
- **Documentation program** (from the doc-site review):
  - **On-ramp comparison pages — landed 2026-07-31**
    (`from-python.md`/`from-mathematica.md`, CI-executed; see the completed
    log in `STATUS_REPORT.md` and the probing findings below).
  - **REPL/CLI playbook (S).** Workflow-oriented doc (check-before-run,
    `cortex doc` lookup flow, MCP loop, lazy-display/`//`/`xs[0]` traps) —
    a distinct genre from the `cli.md` reference.
  - **Standard-library reference tables (M).** Human-facing categorized
    three-column tables (name / signature / one-liner) with one runnable
    example per category; the for-agents Quick Roster is the seed.
  - **User-facing style guide (S).** One canonical idiomatic-Cortex page,
    promoted from the idioms scattered across `examples.md` and test
    headers (recursion pre-declare, `m[i,j]`, tuples-eager/lists-lazy).

**Findings from writing the on-ramp pages (2026-07-31).** Probing every
idiom for `from-python.md`/`from-mathematica.md` surfaced these gaps (each a
design decision or small feature, not a bug):

- **String library thinness (M).** Only `String`/`StringJoin`/`StringSplit`/
  `Characters`/`GraphemeClusters`/`UnicodeScalars`/`StringFrom` exist — no
  `StringLength`, case conversion, replace/find/trim, and no string→number
  parse (`Number("42")` is inert). The on-ramp pages must teach
  "decompose to characters and rebuild" for anything nontrivial.
- **Wolfram-familiar names — RESOLVED 2026-07-31 (user-ruled: did-you-mean
  only, no real aliases).** Eight `CURATED_SYNONYMS` entries added
  (`total`→`Sum`, `select`/`cases`→`Filter`, `memberq`→`Element`,
  `accumulate`→`Scan`, `randomreal`→`Random`, `nest`/`nestlist`→`Iterate`);
  the namespace stays Cortex-native. And `Count` gained the 2-arg forms
  (user-ruled): `Count(xs, v)` counts `isSame` matches, `Count(xs, f)`
  counts predicate-True elements by delegating to `Filter` (inheriting its
  strict non-boolean-result throw).
- **`===` (`Same`) — RESOLVED 2026-07-31.** The engine now defines `Same`
  (total, structural, n-ary): `1 === 1.0` → True (value identity at number
  leaves — the lexer folds `1.0` to `1`, and `isSame(0.5, 1/2)` is true by
  exact value; deliberately unlike Wolfram's `SameQ[1, 1.]`, documented in
  `from-mathematica.md`), `x === y` → False where `==` stays inert,
  `Missing === Missing`/`NaN === NaN` → True. Compile fails closed.
- **`Table` iterator asymmetry — RESOLVED 2026-07-31.** `Table` now accepts
  tuple iterator specs `(k, lo, hi[, step])` like `Sum`/`Product`/
  `Integrate`/`D`. Two residuals (both pre-existing, found at review):
  (1) the **LaTeX** route `\mathrm{Sum}(i^2, (i, 1, 5))` hands the held
  spec over as `["Delimiter", ["Sequence", …]]`, not a `Tuple`, so tuple
  specs through LaTeX stay inert for all iterator operators (S);
  (2) **`canonicalIndexingSet`'s Tuple branch silently drops a fourth
  (step) element** — `Sum(k, (k, 1, 10, 2))` evaluates to `55` (the
  unstepped 1..10 sum, not `25`), a silent-wrong-answer trap; decide
  between supporting the step there (matching the `Set` branch and now
  `Table`) or erroring on 4-element tuples (S–M).
- Cosmetic (open): a dictionary as the final program value renders as raw
  MathJSON (`{"dict":{…}}`) — engine `.toString()` has no dictionary case;
  small serializer item. And `let a = Nothing; a` renders as `a` — this is
  the documented Nothing-as-erasure semantics (assigning `Nothing` stores
  no value), recommend documenting rather than changing.

**Declined from the review** (recorded so we don't re-derive): UFCS
dot-call `a.f(b)` ≡ `f(a, b)` — `|>` already covers left-to-right
composition, and `.` is loaded (`..`, decimals; dictionary `.key` access was
already not adopted). `?` error propagation — already declined under
refutable binding above; Hica needs it to unwrap `Maybe`/`Result` wrapper
types, while Cortex errors-as-values propagate through evaluation without
unwrapping. Structs/enums/ADTs — a different language direction; tuples +
dictionaries + the engine type system cover the notebook use case.

### Serializer / compile-target polish

- **Python compile-target tails (M).** The Cortex→engine lowering currently
  fails closed in the Python target on `Comprehension`, stepped/descending
  `Range`, and multi-`Element` `Loop`; implement these when a Cortex program
  needs them.
