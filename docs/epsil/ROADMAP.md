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

## Standard library

The lowercase spellings of the standard library (`sum` for `Sum`, `print`
for `Print`, `pi` for `Pi`) shipped on 2026-09-05 as a property of the
language: the resolution pass `src/epsil/resolve-library-names.ts` rewrites
free occurrences before a program is boxed, and the spelling table with its
exclusions is `src/epsil/library-names.ts`. Design, audit, and the decisions
taken: `docs/plans/2026-09-05-epsil-standard-library-lowercase-aliases.md`.

The serializer prints the lowercase spelling since 2026-09-27
(`serializeEpsil` in `src/epsil/serialize-epsil.ts`: a name whose spelling
the expression writes, or that the `isBound` option reports bound, keeps
the MathJSON name; `libraryNames: 'mathjson'` restores the old output).

The per-category reference pages (`src/epsil/docs/reference/<category>.md`,
one per library, every definition with both spellings, its signature, its
full description and its executed examples) are generated since
2026-09-27 by `scripts/build-library-reference.ts` (run by `npm run doc`);
`library.md` links each category to its page. A hand-written introduction
is spliced in from `reference/<category>.intro.md` when that file exists.

Remaining work:

- **Reference introductions.** `core.intro.md` and `collections.intro.md`
  exist (2026-09-27); every other page opens with one generated sentence.
  The prose sections of the matching website reference page
  (`doc/*-reference-*.md`, for example "Trigonometric Transformations") are
  to be ported to Epsil syntax, one category at a time: arithmetic, control
  structures and strings next.
- **Examples.** 410 of the 679 definitions have no `examples` field, so
  their reference entry is a description alone (per category, measured
  2026-09-27 after the core and collections round: arithmetic 96 of 97,
  trigonometry 42 of 42, linear algebra 42 of 42, relations 30, statistics
  29 of 35, logic 27, colors 20, calculus 19, polynomials 17, number theory
  17 of 52, control structures 14, special functions 14, combinatorics 11,
  physics 11, units 7, core 7, regular expressions 4, fractals 2,
  collections 1). The core and collections definitions left without one are
  engine-internal or display heads (`ApplyWhole`, `BaseForm`, `Colon`,
  `HorizontalSpacing`, `Object`, `Unevaluated`, `MemberCall`) and `Input`,
  whose example would wait on standard input in the documentation test. An
  example is Epsil source in the definition (`BaseDefinition.examples`),
  executed at generation and checked by the documentation test; an example
  the generator classifies as impure (a `let`, a declaration, a random
  draw) is written without a `// ➔` annotation and only its diagnostics
  are checked.


## Runtime and representation

- **Comment fidelity.** Parsing discards comments and serialization can emit
  only a single normalized MathJSON `comment` field. A first useful rung is
  leading comments on statements in raw parse/serialize workflows. Trailing,
  orphan, multiple, and through-boxing comments require a broader metadata
  model. The current lossy contract remains public in
  `src/epsil/docs/comments.md`.
- **Compilation tails.** Epsil comprehensions (`[x^2 for x in 1..10 if x %
  2 == 1]`, with set and dictionary forms, tuple patterns and guards, since
  2026-09-27) lower to the engine's `Comprehension`, which, with a stepped
  or descending `Range`, a multi-`Element` `Loop`, and the destructuring
  `for (p, q) in pairs` loop binder, compiles on the JavaScript target; the Python
  target lowers the same forms to nested `for` statements, a native `range`
  for integer literal bounds, a tuple pattern, and a list comprehension. A
  destructuring binder compiles only when the source's static element type
  proves tuples of the pattern's arity (the interpreter refuses any other
  element with an error value, which compiled code cannot reproduce): a
  `Zip`, a literal list of tuples, or a `list<tuple<…>>` annotation
  qualifies; a bare `list` declines. A two-bound `Range` with a symbolic
  bound in a Python `for` header picks its direction, and whether a bound is
  integral, at run time (`Range(n, 1)` is a descending native `range` for
  `n = 5`, and 2.5, 1.5 for `n = 2.5`, as in the interpreter). Still failing
  closed: a `match` on the Python target, and a `Comprehension` whose body
  is several statements on Python. A `match` on the JavaScript target compiles natively in
  statement position (a `while let`, or a `match` arm that `break`s a
  `for`) and in value position, and a typed binding compiles when its type
  has a faithful test on the JS value model (machine types, value types,
  numeric ranges, unions of those, and the variants and sums of a tagged,
  non-generic sum). `v: !error` still fails closed there: compiled code has
  no error value to test for — a compiled `match` with no matching case
  yields `NaN` — so it needs an error representation in the compiled lane
  first.

## Tooling and documentation

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
