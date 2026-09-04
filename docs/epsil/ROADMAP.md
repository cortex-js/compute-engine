# Epsil Roadmap

**Status:** active maintainer backlog.

Epsil's parser, serializer, evaluator, CLI, REPL, MCP server, public docs, and
experimental package entry point have shipped. This file contains only work
that remains applicable after auditing the former `roadmap/cortex/` archive.
Items are demand-gated unless another roadmap gives them higher priority.

## Language design

- **Unit literals.** Units currently enter through LaTeX islands or
  `Quantity(value, unit)`. Native unit notation needs a grammar and
  round-trip decision before implementation.
- **UFCS/dot calls.** Decide whether `a.f(b)` may mean `f(a, b)`. Any proposal
  must remain unambiguous with dictionary, record, object, and component field
  access; the pipe remains the existing composition syntax.

## Runtime and representation

- **Comment fidelity.** Parsing discards comments and serialization can emit
  only a single normalized MathJSON `comment` field. A first useful rung is
  leading comments on statements in raw parse/serialize workflows. Trailing,
  orphan, multiple, and through-boxing comments require a broader metadata
  model. The current lossy contract remains public in
  `src/epsil/docs/comments.md`.
- **Compilation tails.** Epsil has no comprehension syntax (`Map`/`Filter`
  and the pipe are the idiom), and the engine's `Comprehension`, stepped or
  descending `Range`, multi-`Element` `Loop`, and destructuring `for (p, q)
  in pairs` loop binder all compile on the JavaScript target; the Python
  target lowers the same forms to nested `for` statements, a native `range`
  for integer literal bounds, a tuple pattern, and a list comprehension. A
  destructuring binder compiles only when the source's static element type
  proves tuples of the pattern's arity (the interpreter refuses any other
  element with an error value, which compiled code cannot reproduce): a
  `Zip`, a literal list of tuples, or a `list<tuple<…>>` annotation
  qualifies; a bare `list` declines. Still failing closed: a `match` on the
  Python target, a symbolic descending `Range` in a Python `for` header (it
  reads ascending), and a `Comprehension` whose body is several statements
  on Python. A `match` on the JavaScript target compiles natively in
  statement position (a `while let`, or a `match` arm that `break`s a
  `for`) and in value position, and a typed binding compiles when its type
  has a faithful test on the JS value model (machine types, value types,
  numeric ranges, unions of those, and the variants and sums of a tagged,
  non-generic sum). `v: !error` still fails closed there: compiled code has
  no error value to test for — a compiled `match` with no matching case
  yields `NaN` — so it needs an error representation in the compiled lane
  first.

## Tooling and documentation

- **Effect summaries from `epsil check`.** Static checking enforces declared
  effect contracts. A separate report mode could expose inferred impurity and
  nondeterminism for callers without requiring a violated declaration.
- **Test runner.** Consider `epsil test` with test blocks and assertion
  builtins. Assertions should produce ordinary error values and diagnostics,
  not introduce a new effect label.

## Maintenance

- Keep `src/epsil/docs/` synchronized with the published documentation during
  releases.
- Revalidate `src/epsil/highlight-js-mode.js` whenever tokens, reserved words,
  or grammar change. Its structural checks live in `test/epsil/` because
  highlight.js is not a development dependency.

Completed investigations and implementation chronology belong in
`docs/STATUS_REPORT.md` at initiative granularity and in Git history at full
detail; they do not stay in this roadmap.
