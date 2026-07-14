### Motivation

Consumers that feed **machine-generated** LaTeX into `ce.parse()` — LLM
translation output, OCR — need to distinguish "parsed as the author intended"
from "parsed via charitable interpretation / error recovery." For a human typing
in an editor, charity is the right default. For generated input, each charitable
decision is overwhelmingly likely to be a generator error, and today it is
invisible: all of the following parse with `isValid=true`, no `Error` nodes,
identical output at `strict: true` and `strict: false` (verified on 0.77.1):

| Input                                                      | Parse                           | The silent decision                                                                                              |
| ---------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `x(3)` (`x` undeclared)                                    | `["Multiply",3,"x"]`            | application-shaped source read as multiplication                                                                 |
| `\mathrm{Frobnicate}(x)`                                   | `["Multiply","Frobnicate","x"]` | unknown name auto-declared, juxtaposition → multiply                                                             |
| `\mathrm{Eigenvalues}\begin{pmatrix}2&1\\1&2\end{pmatrix}` | `["Multiply","Eigenvalues",…]`  | registered _function_ operator juxtaposed with a matrix → multiply (the `\left(…\right)` form applies correctly) |
| `2 + 2 % + 100`                                            | `4`                             | unescaped `%` comment discards the rest of the input                                                             |

### Request: opt-in parse diagnostics (additive; no behavior change)

```ts
const expr = ce.parse(latex, { diagnostics: true });
expr.parseDiagnostics: ReadonlyArray<{
  code: string;                  // open enum, see below
  start: number; end: number;    // source span (unit per CE's convention, documented)
  detail?: Record<string, unknown>;
}>
```

Diagnostic codes, in priority order:

1. **`auto-declared-symbol`** — a symbol with no prior declaration was
   auto-declared during parse/canonicalization. `detail: { name, type }`.
   (`expr.unknowns` exists but is post-hoc, span-less, and doesn't say _why_ the
   name is unknown.)
2. **`juxtaposition-as-multiply`** — a juxtaposition of a symbol with a
   delimited group or matrix was interpreted as multiplication _where the source
   shape is application-like_ (name immediately followed by `(…)` /
   environment).
   `detail: { name, declaredAs: "unknown" | "value" | "function" }`. This single
   code covers all three mis-parse rows above.
3. **`comment-discarded`** — an unescaped `%` discarded input.
   `detail: { discardedLength }`. For generated LaTeX this is virtually always
   an under-escaped `\%`.
4. **`recovered`** — any token skipped/coerced by non-strict error recovery that
   does not already surface as an `Error` node.

Secondary (independent, lower priority):

5. **Operator capability introspection** — extend `operatorInfo(name)` (or a
   sibling) to expose whether an evaluate/N implementation is registered, so a
   consumer can predict "this will echo back inert" without evaluating.

Discussion item (behavior question, not a request): should juxtaposition of a
**registered function operator** with a matrix/delimited group parse as
application rather than multiplication (`\mathrm{Eigenvalues}\begin{pmatrix}…`
vs the working `\left(…\right)` form)? We recognize `2A`-style scalar products
make this ambiguous; flagging via diagnostic code 2 may be the better
resolution.

---

## Response (CE maintainers, 2026-07-14)

**Accepted.** All four motivating behaviors reproduce verbatim on current main
(0.77.1). We will implement codes 1–4 as an opt-in `diagnostics: true` parse
option attaching `parseDiagnostics` to the returned expression — your proposed
API shape is fine as-is (it matches the precedent of our existing
`preserveLatex` option, which also conditionally attaches per-node metadata).
No behavior change, purely additive. Two amendments and one already-shipped
item below.

### Amendment 1: code 1 becomes "undeclared symbol referenced" (parse-time semantics)

The literal event you named — auto-declaration — happens at **bind/
canonicalization time**, on boxed expressions that no longer carry token
indices. Instrumenting those sites would need a diagnostics collector threaded
through the engine (a parse/canonicalize layering violation on our side), and
would silently emit nothing under `ce.parse(…, { canonical: false })`.

Instead we will emit the diagnostic at **parse time**, where the parser already
knows the symbol's declaration status (via its `getSymbolType` hook) and has
exact source spans. The semantics shift slightly: from "was auto-declared" to
"references a name with no prior declaration." For generated-LaTeX validation
we believe this is the more useful signal anyway (it fires deterministically at
the reference site, independent of canonicalization mode). `detail` stays
`{ name, type }`. Flag it if the distinction matters to you.

Code 2 is likewise emitted at parse time, at the neutral juxtaposition node,
where the application-like source shape (name immediately followed by `(…)` or
an environment) is directly visible and `declaredAs` is available — exactly
your stated criterion. It covers all three mis-parse rows, including the
matrix-environment case.

Interim note: `ce.appliedNonFunctions(latex)` exists today and is a post-hoc,
span-less approximation of code 2 — it may cover part of your need before this
ships.

### Amendment 2: span convention

Parser spans are offsets into CE's **normalized LaTeX** (the re-serialized
token stream), which equals your original string only when the input
round-trips unchanged — comments and Unicode normalization (NFC, `−`→`-`,
super/subscript rewrites) shift them. This is the documented unit for codes 1,
2, and 4.

The exception is **`comment-discarded`** (code 3), where the post-tokenization
convention would be wrong by construction — the comment is what got stripped.
Comment stripping happens before tokenization and has original-string offsets
in hand, so code 3 will report **original-input** coordinates, and
`detail: { discardedLength }` as requested.

If your inputs routinely mix comments with other diagnostics, be aware codes
1/2/4 spans on such inputs are approximate (shifted left by the stripped
comment lengths). An exact original-string offset map is possible but is
tokenizer surgery we'd rather not couple to v1.

### Item 5: already shipped

`ce.operatorInfo(name)` (0.74.0, from your post-0.73.0 round) returns
`canEvaluate`, true iff an evaluate or collection handler is registered — i.e.
exactly the "will this echo back inert" predicate. There is no separate N-flag
because CE has no separate N handler: the `evaluate` handler serves both exact
and `numericApproximation` modes, so `canEvaluate` covers `.N()` too. If you're
seeing a gap `canEvaluate` doesn't close, tell us what it is — otherwise we
consider this one done.

### Discussion item: resolved as "no behavior change; diagnostic 2 flags it"

We agree with your own instinct. Mechanically, the `\left(…\right)` form works
because a delimited group reaches the symbol-with-delimiter branch of invisible-
operator canonicalization, while a matrix environment is already a `Matrix`
node and falls through to multiplication. Making function-typed symbols apply
to juxtaposed matrices is defensible, but `2A` / `xM`-style products make
juxtaposition genuinely ambiguous, and it's a behavior change with unmeasured
snapshot blast radius. Diagnostic 2 gives your pipeline the signal with zero
churn. If it ever becomes load-bearing for you, the narrow variant (apply only
when the symbol's *declared* — not inferred — type is `function`) can be
evaluated separately, blast-radius-measured first.

### Ratification (Tycho, 2026-07-14)

Tycho accepted the response in full; `parseDiagnostics` is now the ratified
basis of their generated-LaTeX validation gate, so codes 1–4 are **confirmed
load-bearing**. Points of record from their reply:

- **Amendment 1 accepted** — the parse-time "undeclared symbol referenced"
  semantics is *preferred*: their validator declares in-scope definitions
  before parsing, so this is exactly their predicate.
- **Amendment 2 accepted** — their policy keys on `code` + `detail`; spans are
  informational. No exact original-offset map needed in v1.
- **Item 5 closed** — `canEvaluate` verified on 0.77.1. Their doc note (it's
  per-operator capability, not per-call inertness; `Element`/`ForAll` report
  `true` yet echo back unevaluated) is now reflected in the `OperatorInfo`
  JSDoc.
- **`appliedNonFunctions` coverage note** — it misses the matrix-environment
  row (`\mathrm{Eigenvalues}\begin{pmatrix}…` → `[]`), consistent with the
  Multiply-branch explanation; now noted in its JSDoc. Their interim plan
  retains their own check for that case.
- **Discussion item closed** — no parse behavior change; diagnostic 2 is the
  signal.

Their adoption plan: Phase 1 (now) replaces their hard-coded head allowlist
with `operatorInfo`; Phase 2 cuts over to `parseDiagnostics` and deletes their
hand-rolled tree walk — **triggered by our release**. Action items on us when
this ships: tag the CHANGELOG entry / drop them a note, and give them a target
version. They offer beta-testing against a pre-release build with a recorded
corpus of malformed LLM output exercising codes 1–4 — worth taking them up on
before cutting the release.

### Implementation notes (CE-side, for reference)

- Codes 1–2: emit at the parser's `InvisibleOperator` production and symbol
  reference sites; spans via the existing `sourceOffsets` machinery.
- Code 3: capture discarded length/offset in `tokenize()` before stripping.
- Code 4: emit from the centralized non-strict trailing-recovery path in
  `parse()`.
- Channel: new `diagnostics` flag in `ParseLatexOptions`; collector on the
  parser; `parseDiagnostics` attached to the top-level boxed result alongside
  the existing `latex`/`sourceOffsets` metadata.
