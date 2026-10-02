# Review checklist

The code reviewers (the `review-staged` and `review-files` skills, both the
Claude and the Codex reviewer) read this file and check a diff against each
item that applies. It lists the mistakes that are easy to make in this
repository and hard to see in a diff. The full rules are in `CLAUDE.md`,
`ARCHITECTURE.md` and the `docs/*-MODEL.md` files; each item names its source.

Keep each item short and testable. Add an item when a review misses a mistake
that a reader of the diff could have seen.

## Correctness

- **Exact results stay exact.** An `evaluate` handler returns an exact value or
  stays symbolic for an exact operand (`ln(2)` stays `Ln(2)`); it computes a
  float only under `numericApproximation` (`.N()`) or for a float operand. Use
  `isExact` to decide. (`CLAUDE.md`, "Evaluate vs. N".)
- **A function that jumps** (`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`,
  `Mod`, `Sign`, `Heaviside`, the comparisons) uses the exact value of an exact
  operand under `.N()`, and returns a float.
- **Two exact numbers compare exactly**, without tolerance, in `Equal`/`Less`
  and in `.isEqual()`/`.isLess()`. Only `.is()` and float operands use the
  tolerance.
- **`.isSame()` is syntactic.** It never reads a symbol's value. Internal code
  uses it for literal checks (`.isSame(0)`); a check that can see a symbol must
  test `isNumber(op)` first. `.is()` is for the public API only.
- **`NaN` and `Indeterminate`.** An exact form without a value (`0/0`,
  `∞ − ∞`) gives `Indeterminate` through `indeterminateFormAnswer()`, never
  `ce.Indeterminate` directly from code that can see a float. Test `isNaN`,
  not `isSame(ce.NaN)`. (`docs/ERROR-MODEL.md`.)
- **Canonical folds read number literals only**, never the value assigned to a
  symbol (a fold of a value stays wrong after the symbol is reassigned).
- **`.add()` / `.mul()` methods** turn two exact literals into a float, and
  `.mul()` expands a product of sums. To build an exact or factored result,
  use `ce.function('Add' | 'Multiply', …)`. `evaluate()` and `.N()` keep a
  product of sums factored; do not remove `mulFactored`.
- **No `.simplify()` inside the simplification pipeline** (simplify rules,
  polynomial functions that rules call): it causes infinite recursion.
- **Expression forms.** A `form: 'raw'` expression is not bound and must not
  reach `.mul()`, `.add()` or other arithmetic; use `form: 'structural'`.
- **Collection shape tests** use `collection<any>` or the `*_SHAPE_TYPE`
  constants, never a bare `list`/`collection` (`list<any>` does not match bare
  `list`).
- **A lazy operator** (`lazy: true`) gets its operands unbound: the handler
  must call `.canonical` on each operand it uses. Its tests must include the
  `ce.box(...)` and `ce.parse(...)` routes, not only `ce.function(...)`.
- **An operator that binds a variable** declares it with a `scoped` binding
  site selector; binding symbols come from `ce._bindingSymbol`, never
  `ce.symbol(name)`.
- **`BigDecimal.precision` is global**: code that changes it saves and
  restores it.
- **Plugin bundles**: no `instanceof` or `constructor.name` check across the
  host/plugin boundary; compare names as strings.
- **Compiled targets** (JavaScript, GLSL, WGSL, Python, interval) give the same
  result as `evaluate()`/`.N()` for the same input, or fail closed. A new
  operator or a new case in `evaluate` needs the same change in each target
  that supports the operator, or an explicit refusal there.

## Conventions

- No new import cycle in `src/compute-engine` (runtime or `import type`).
- No leftover `console.log` (`console.assert` is allowed).
- Comments explain the mechanism in full sentences, without session shorthand
  or references to unnamed audits or decisions. (`docs/COMMENTING-GUIDELINES.md`.)
- A user-visible behavior change has a `CHANGELOG.md` entry under "Behavior
  Changes" that says which input now gives a different result.
- Do not edit generated files by hand: `src/api.md`,
  `src/epsil/docs/errors.md`, `src/epsil/docs/library.md`.
- A defect found during the work is fixed in the same change, or added to
  `ROADMAP.md`; a "follow-up" comment alone is a finding.
- Never update a snapshot marked `@fixme`.

## Verification

These rules apply to fix subagents and to the check after the fixes. Several
sessions share this machine: read `docs/SHARED-BOX-PROTOCOL.md`.

- Typecheck: `npm run typecheck`. For all of `src/`:
  `./node_modules/@typescript/native/bin/tsc -p tsconfig.json --noEmit`.
- Tests: only the test files that match the changed source files, with
  `npx jest --config ./config/jest.config.cjs -w 2 -- <file>` (one file) or
  `-w 4` (several files). Never run jest without the config. Never run the
  full suite here.
- A jest path that matches no file is dropped without an error: check that the
  number of suites run is the number of files given.
- After a change to imports: `npm run check:deps`.
