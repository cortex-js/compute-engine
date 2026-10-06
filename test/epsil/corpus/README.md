# Epsil program corpus

One complete Epsil program per `.epsil` file, run end to end by
`test/epsil/corpus.test.ts` against a fresh engine. The corpus exists to test
the language the way a user writes it, whole programs rather than one feature at
a time, and to record the bugs those programs find.

## File format

A program states its own expectation in comments:

- The last `// ➔ <text>` line is the expected value of the program, in the
  engine's textual form. Whitespace is ignored in the comparison, and a quoted
  `"True"`/`"False"` equals the bare word. `// ➔ ≈ <number>` compares
  numerically to ten significant digits.
- `// corpus: expect-diagnostic <text>` at the top means the program must
  produce an error diagnostic whose message contains `<text>`; there is then no
  `// ➔` line.
- `// corpus: known-failure <reason>` at the top records a program that finds a
  bug. The test runs with `test.failing`: it passes while the program still
  fails and FAILS the day the bug is fixed, which forces the header to be
  removed and the matching `ROADMAP.md` entry to be closed in the same change.
  The reason is one plain sentence and names the ROADMAP entry.

A program should hold a single value as its last statement. A lazy collection
inside a tuple stays a recipe when printed, so wrap it in `listFrom(...)` when a
tuple is the program's value.

## Running

The whole corpus:
`npx jest --config ./config/jest.config.cjs -w 2 -- test/epsil/corpus.test.ts`.
One program through the CLI, without a build:
`npx tsx src/cli/epsil.ts test/epsil/corpus/<category>/<name>.epsil`.

## Categories

- `exercism/`: small algorithmic exercises on strings, collections and integers,
  written from the public Exercism problem statements (MIT) in our own words and
  code.
- `euler/`: Project Euler problems with a known integer answer; a few are
  reduced in size so that they stay under the engine's iteration limit, and the
  file says so.
- `rosetta/`: classic Rosetta Code tasks, written as our own programs from the
  task idea (the site's content is GFDL and is not copied).
- `symbolic/`: exact and symbolic computation, which is what Epsil is for.
- `language/`: minimal reproductions of language and library findings, one per
  file, most of them `known-failure`.

## Adding a program

Write the file, run it through the CLI, and check the output by an independent
means before writing the `// ➔` line (a known answer, a second computation, or
the library's own function next to the hand-written one). When the engine
disagrees with a verified answer, keep the natural spelling of the program, add
the `known-failure` header, and open a ROADMAP entry; add a second program with
a workaround only when the exercise itself is worth keeping green.
