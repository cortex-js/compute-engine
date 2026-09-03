# Epsil Roadmap

**Status:** active maintainer backlog.

Epsil's parser, serializer, evaluator, CLI, REPL, MCP server, public docs, and
experimental package entry point have shipped. This file contains only work
that remains applicable after auditing the former `roadmap/cortex/` archive.
Items are demand-gated unless another roadmap gives them higher priority.

## Language design

- **`while let`.** `if let pattern = subject { … } else { … }` shipped
  (2026-09-03) as surface sugar over a two-case `Match` with a wildcard
  fallback; the typed pattern decides the failure family (`v: !error` refuses
  error values, `v: !missing` refuses absence), so no dedicated failure type
  was needed. The loop form is not implemented. It would lower to
  `Loop(Match(subject, MatchCase(pattern, body), MatchCase(_, Break())))` —
  a `Break` returned by a match arm already ends the enclosing `Loop`, since
  a `match` arm inside a `for` body can `break` today — and the serializer
  would need to recognize that shape, as it does the `while` lowering.
  Demand-gated.
- **Constructing an error value.** A function whose body writes a literal
  `Error(…)` cannot be declared: the function literal types `error` and the
  declaration is inert (`ROADMAP.md`, "A function literal whose body contains
  an `Error(…)` literal types `error`"). Until that is ruled, an Epsil program
  can only pass on the errors the engine produces, which limits the
  `if let v: !error = f(x) { … }` idiom to engine-raised failures.
- **Unit literals.** Units currently enter through LaTeX islands or
  `Quantity(value, unit)`. Native unit notation needs a grammar and
  round-trip decision before implementation.
- **UFCS/dot calls.** Decide whether `a.f(b)` may mean `f(a, b)`. Any proposal
  must remain unambiguous with dictionary, record, object, and component field
  access; the pipe remains the existing composition syntax.
- **Match exhaustiveness.** Add a lint for statically known sums and other
  closed scrutinee types. Do not claim exhaustiveness for open or untagged
  unions without a sound proof.
- **Mutually recursive one-step definitions.** Self-recursion works in a
  one-step definition. Mutually recursive functions still require explicit
  `let` declarations for every name before assignment. Removing that ceremony
  requires a sibling forward-declaration pass.

## Runtime and representation

- **Comment fidelity.** Parsing discards comments and serialization can emit
  only a single normalized MathJSON `comment` field. A first useful rung is
  leading comments on statements in raw parse/serialize workflows. Trailing,
  orphan, multiple, and through-boxing comments require a broader metadata
  model. The current lossy contract remains public in
  `src/epsil/docs/comments.md`.
- **Loop accumulation.** Repeated `xs = Join(xs, [x])` builds an O(n)-deep lazy
  recipe. Prefer documenting `Map`/`Fold` for value construction; an engine
  optimization may flatten materialized operands only after preserving lazy
  `Join`, tuple atomicity, effects, and size limits.
- **Python compilation tails.** Epsil programs using `Comprehension`,
  stepped/descending `Range`, or multi-`Element` `Loop` still depend on target
  support. The Python target must continue to fail closed until it implements
  equivalent lowering.

## Tooling and documentation

- **Effect summaries from `epsil check`.** Static checking enforces declared
  effect contracts. A separate report mode could expose inferred impurity and
  nondeterminism for callers without requiring a violated declaration.
- **Test runner.** Consider `epsil test` with test blocks and assertion
  builtins. Assertions should produce ordinary error values and diagnostics,
  not introduce a new effect label.
- **Standard-library index.** Build human-facing categorized tables from the
  same operator metadata used by `epsil doc`, with signatures, summaries, and
  executable examples. Avoid a separately maintained inventory.
- **Style guide.** Consolidate the idioms currently distributed across
  `examples.md`, `for-agents.md`, and test headers: declaration style,
  recursion, collection pipelines, indexing, errors-as-values, and effects.

## Maintenance

- Keep `src/epsil/docs/` synchronized with the published documentation during
  releases.
- Revalidate `src/epsil/highlight-js-mode.js` whenever tokens, reserved words,
  or grammar change. Its structural checks live in `test/epsil/` because
  highlight.js is not a development dependency.

Completed investigations and implementation chronology belong in
`docs/STATUS_REPORT.md` at initiative granularity and in Git history at full
detail; they do not stay in this roadmap.
