# A documentation pass over the standard library

Status: approved by the user 2026-11-25 (fresh session; parameter names are
added where they help). Not started. Builds on CE-1812 and CE-1813
(`bc755fa88f39eb6a4bccd9ee1241be945ade7467`, the positional form
`e9e0810c3dbbe1cbce855d885b88d9c90a309655`). Issues it folds in: CE-1835,
CE-1836. Issue to fix first: CE-1838.

## 1. Why

The Epsil editor shows, while the user types a call, the summary of the
callee, the documentation and the sample (a placeholder shown as faint text
in the empty argument) of the parameter at the cursor, the keys of an
options dictionary, and the examples (`epsilSignatureHelp()`,
`epsilCompletions()`, `epsilHover()`, `src/epsil/docs/implementation.md`). The
engine has the fields since CE-1812; the library fills almost none of them.
The reference pages on epsil.dev are generated from the same definitions
(`scripts/build-library-reference.ts`).

## 2. Where the library stands

Measured at `e9e0810c3`, the functions that have an Epsil spelling
(`epsilLibraryNames()`): 572. Every one has a description; 276 have a
description of less than 80 characters. 375 have examples, 197 have none.
530 have at least one parameter with no name in their signature; 272 of
those have a single parameter. No definition has a `parameters` field.

| Library | Functions | One parameter | Several | No example |
| --- | --- | --- | --- | --- |
| collections | 88 | 29 | 59 | 0 |
| arithmetic | 77 | 44 | 33 | 1 |
| core | 71 | 37 | 34 | 7 |
| number-theory | 70 | 42 | 28 | 25 |
| linear-algebra | 46 | 29 | 17 | 0 |
| statistics | 43 | 20 | 23 | 37 |
| trigonometry | 41 | 38 | 3 | 0 |
| special-functions | 24 | 7 | 17 | 19 |
| calculus | 22 | 3 | 19 | 21 |
| logic | 21 | 14 | 7 | 21 |
| colors | 20 | 6 | 14 | 20 |
| polynomials | 19 | 6 | 13 | 18 |
| combinatorics | 12 | 4 | 8 | 11 |
| units | 7 | 4 | 3 | 7 |
| regexp, relop, control-structures, fractals | 11 | 1 | 10 | 10 |

"One parameter" and "Several" count the largest arm of the signature.

## 3. Rules for the content

- **A parameter with no name, in a function of one parameter** (`Sin`,
  `Abs`, `Floor`): document it by position, with a list. Do not invent a
  name.

  ```ts
  parameters: [{ description: 'The angle, in radians.', sample: 'pi / 4' }],
  ```

- **A function of several parameters**: give each parameter a name in the
  signature where the name tells the reader which argument is which
  (`(xs: indexed_collection<T>, count: integer)`), and document it by name.
  A name is part of the API: a call may then pass the argument by name
  (`take(xs, count: 2)`), and renaming it later breaks such calls. Use short
  Epsil-style names (`xs`, `count`, `f`, `start`, `end`, `n`), the same name
  for the same role across the library. Where a parameter of an overload set
  takes another role in another arm, give it another name.
- **A sample** is one line of Epsil source in the Epsil spelling (`[1, 2,
  3]`, `x => x^2`, `"crimson"`), of the type of its parameter in at least
  one arm that has it (a string arm `(T) -> T where T: string` and a list
  arm admit no common sample; prefer the list), and short: it is shown in
  the editor as faint text, and inserted when the user accepts it. Prefer a
  value that makes a call meaningful (`2` for `count`, not `0`). The test
  reads the type variables of an arm as their bounds.
- **A parameter description** is one sentence: what the argument is, its
  unit or its range when it has one, what happens at a boundary when it is
  not obvious. It does not repeat the type.
- **The description of the function**: its first line is the summary that
  the editor shows on every call, so it says what the function returns. A
  one-line description that already does so stays as it is.
- **Examples**: one line of Epsil each, written with the MathJSON names
  (the editor and the reference pages spell them, CE-1813), that evaluates
  on a fresh engine to a value worth showing; the reference page executes
  each one, so a broken example fails the documentation build. A function
  with no example gets one or two.
- **An options dictionary** (`FindRoot`, `FindFit`): document each key with
  its `type`, `description`, `sample` and `default`.

## 4. Steps

1. **Fix CE-1838** before naming any parameter: a named argument on a
   library overload set (`slice(xs, start: 2, end: 4)`) gives
   `unexpected-argument`. Naming more parameters makes it common.
2. **Make progress visible**: `scripts/build-library-reference.ts` shows the
   documentation of the parameters of each entry (a short list under the
   signature: name or position, description, sample), and its summary line
   counts the parameters with no documentation. Regenerate and check that
   only the new lists change.
3. **Pilot on `collections`** (88 functions, the most used). Measure the time
   and the tokens per function, and report them to the user before step 4.
4. **The other libraries**, one batch per library file, in the order of the
   table, each a commit: the definitions, the regenerated reference pages,
   and the tests. CE-1835 (the "Example:" sentences of about twenty
   descriptions) goes with the batch of its file.
5. **CE-1836** (the MathJSON names in the code spans of the descriptions),
   option (a) of the issue, after the content: a span that parses goes
   through `epsilSpelling()` when a description is returned and when the
   reference page is generated.

## 5. Checks of each batch

- The type check, and the test of the documentation of the library, which
  checks that every sample parses and is of the type of its parameter, and
  that every example parses in the Epsil spelling:

  ```sh
  timeout -k 30 600 node ~/.claude/scripts/run-summarized.mjs --name pd7 --log <scratchpad>/pd7.log -- npx jest -w 2 -- test/compute-engine/epsil-parameter-docs.test.ts
  ```

- The reference pages, which execute every example:

  ```sh
  npx tsx scripts/build-library-reference.ts
  ```

  The page `src/epsil/docs/reference/core.md` is out of date at
  `e9e0810c3` (the description of `Declare` changed without a regeneration),
  so the generator rewrites one line of it; commit that line with the first
  batch that regenerates `core`.
- The test files of the library operators whose signature gains names: a
  name changes the label of the signature (`signature.toString()`), which
  some tests and snapshots compare. `npx tsx scripts/where.ts <Operator>`
  finds them.
- A wording review of each batch: one reviewer reads the descriptions and
  samples for accuracy against the implementation. A signature change is a
  code change and gets the review of `docs/COMPUTE-ENGINE-BOX-SPECIFICS.md`.

## 6. Traps

- The elements of a library `description` array are lines, not paragraphs:
  the reference generator joins them up to a line that ends with `.`, `:`,
  `!`, `?` or `)` (`paragraphs()` in `scripts/build-library-reference.ts`).
  A `///` comment is split at blank lines instead.
- A `parameters` list is read by position in every arm of an overload set;
  where the arms disagree on what a position means, use names.
- An empty string, a hole or `null` in a `parameters` list leaves that
  position undocumented.
- A call cannot pass a rest parameter by name (`argument-name-unknown`),
  and the signature help shows no name for it: document a rest parameter by
  position.

## 7. Continuation prompt

> Read `docs/plans/2026-11-25-library-documentation-pass.md` and do its
> section 4 in order, starting with step 1 (CE-1838). Follow sections 3, 5
> and 6. Stop after step 3 (the pilot on `collections`) and report the cost
> per function before you start step 4. Stage each step and each batch as
> it passes its checks; commit only when the user approves it in your
> session.
