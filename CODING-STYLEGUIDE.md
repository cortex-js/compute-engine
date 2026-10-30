# Coding style guide

This guide owns conventions for writing code and comments. Use
[BUILD.md](BUILD.md) for commands and validation,
[ARCHITECTURE.md](ARCHITECTURE.md) for subsystem contracts, and
[the review checklist](docs/REVIEW-CHECKLIST.md) when reviewing a change. Agent
coordination belongs in [AGENTS.md](AGENTS.md) and the shared-box protocol it
references.

## Formatting and scope

- Let Prettier own formatting; do not maintain a second set of spacing or
  wrapping rules. Source formatting is applied by the commit hook and checked by
  CI, as described in BUILD.md.
- Follow surrounding naming and module conventions. Choose names that describe
  behavior or domain concepts; avoid unexplained abbreviations.
- Keep changes focused. Avoid unrelated renaming, reformatting, and refactoring.

## TypeScript and module boundaries

- Give public interfaces meaningful types. Prefer `unknown` with narrowing or
  constrained generics to explicit `any`. Oxlint enforces the public-type
  policy; any suppression needs a local reason.
- Use type-only imports for dependencies needed only as types. Follow the
  existing ESM convention of `.js` extensions on relative source imports.
- Respect the layer boundaries in `.oxlintrc.json`. Shared types and utilities
  should not introduce dependencies on higher implementation layers.
- Source imports must use declared runtime dependencies, not packages available
  only as development dependencies. Keep circular dependencies out of the
  engine; BUILD.md describes the automated check.
- Remove debugging `console.log` calls. `console.assert` is permitted.
- An operator-definition field is declared in more than one place, and the
  declarations must stay identical: the input `OperatorDefinition` and the
  runtime `BoxedOperatorDefinition` in `types-definitions.ts`, the separate copy
  of `BoxedOperatorDefinition` in `types-expression.ts`, and the class in
  `boxed-expression/boxed-operator-definition.ts`. A field that changes in only
  some of them breaks the structural identity of the boxed-expression types, and
  the type check then fails with errors far from the change.
- The public `ComputeEngine` type is the `IComputeEngine` interface
  (`compute-engine/types-engine.ts`), not the class, so a new public member of
  the engine class is invisible to clients until it is also declared on
  `IComputeEngine`. A new public static goes on `ComputeEngineConstructor` in
  both entry files, `src/compute-engine.ts` and `src/core.ts`. Make both changes
  in the same change as the member.

## Behavior and tests

- Preserve documented API and mathematical contracts. Check ARCHITECTURE.md
  before changing behavior that seems surprising.
- Verify mathematical identities and special values numerically before encoding
  them. A plausible identity can pass a symbolic test while still being wrong.
- Test observable behavior and meaningful boundaries. Names and assertions
  should explain the contract; comments supply only context they cannot express.
- Update documentation and release notes with user-visible behavior changes.
  Write `CHANGELOG.md` for external users: one bold first sentence per item and
  one or two short examples (old result, new result). Name only public
  operators, methods, options, types and error codes. Do not name internal
  functions or files, plans, ROADMAP entries, review rounds, test counts, or
  other projects (Tycho, Desmos). The exceptions are contributor credits, the
  benchmark tables, and Fungrim. Sections: Breaking Changes, New Features,
  Improvements, Behavior Changes, Resolved Issues, Performance.
- Generate derived documentation rather than editing it by hand.
- Put a timing assertion (`expect(elapsed).toBeLessThan(…)`) only in a test that
  runs under `CE_PERF=1` (`npm run test:perf`). In a normal run, other workers
  and other sessions load the machine, and the assertion fails with no change to
  the code.
- A test that pins type inference uses its own `new ComputeEngine()`. The type
  of a symbol is inferred at its first use and kept for the life of the engine,
  so in a file that uses the shared engine of `test/utils.ts`, an earlier test
  can infer the symbol first and hide a defect that depends on the order of use.
- Jest runs each test file in a separate V8 context, where a call such as
  `Math.imul(…)` is about 100 times slower than in plain Node.js. In a hot loop,
  bind the function once at module scope (`const imul = Math.imul;`). For the
  same reason, measure the duration of a test under Jest, not with `npx tsx`.
- `npx jest -- <file> -t <name>` reads `-t <name>` as a path pattern and runs
  the whole file. Put `-t <name>` before `--`.

## Engine implementation

Follow the engine contracts in [ARCHITECTURE.md](ARCHITECTURE.md), especially
its [implementation conventions](ARCHITECTURE.md#implementation-conventions).

- Return canonical results from internal helpers; let callers decide when to
  simplify. Never call `.simplify()` from a simplification rule or a helper that
  it invokes: nested calls create fresh recursion contexts and can bypass the
  outer loop's guards.
- Use `.isSame()` for internal literal comparisons, guarding with `isNumber`
  when an operand might be a symbol. Reserve `.is()`'s numerical fallback for
  public API behavior. Choose arithmetic equality or identity proof explicitly.
- Tests that change precision must account for module-global
  `BigDecimal.precision`, including changes made by constructing an engine.
  Avoid reusing numeric test symbols in Boolean contexts: that use infers a
  Boolean type. Use uppercase symbols in Boolean fixtures.
- A change to the last digit of a machine-precision result is acceptable, in
  particular for performance: a different summation order, or `Math.exp(x)`
  instead of `Math.E ** x` (user decision 2026-09-21). Report the change in
  `CHANGELOG.md` (which expressions, which digits). Exact values stay exact, and
  complex values, poles (`~oo`) and `NaN` must not change.
- A lazy operator needs tests through `ce.box` and `ce.parse`, as well as direct
  function construction. Shared-bundle behavior needs consumer tests against
  `dist`; source-only tests cannot establish package identity or resolution.
- A table keyed by symbol names has no prototype: use a `Map`, or an object
  created with `{ __proto__: null }`. A symbol name is any string, so a name
  such as `toString` or `constructor` reads the inherited member of a plain
  object. In the LaTeX parser this gave an undeclared name a function as its
  type, and the next type check threw.
- Code that makes an object for each node in a hot route uses a class, with
  getters on the prototype, not an object literal that defines a getter. V8
  creates such a literal on a slow route, about 150 ns against about 10 ns for a
  class instance (measured 2026-10-23); the operand views of
  `operand-descriptor.ts` were changed to classes for this reason.

Public Compute Engine guides live in the separate
`~/dev/cortexjs.io/docs/compute-engine/` checkout. Do not recreate this repo's
retired `doc/` directory. Epsil language docs live in `src/epsil/docs/`. Update
the relevant documentation when adding an operator or public API.

## Comments

Comments should make the current code easier to understand and change. They are
not a substitute for clear names, tests, version control, or design documents.

### What to comment

Write a comment when it records information that the code cannot express clearly
on its own:

- the reason for a non-obvious choice;
- an invariant or precondition that a future change must preserve;
- a boundary imposed by another subsystem, file format, standard, or third-party
  API;
- a numerical derivation, algorithmic trade-off, or intentional precision limit;
- the observable behavior of a compatibility path;
- why an apparently simpler implementation is incorrect.

Prefer a short comment next to the smallest relevant unit. Use a doc comment for
a public contract and a design document for reasoning that needs examples,
alternatives, measurements, or a decision history.

### Write for the current reader

- Describe the current rule in present tense. A regression comment should say
  what must remain true, not narrate what an older implementation did.
- Make local comments self-contained. Avoid bare references such as “see above,”
  “Appendix B,” “R5,” or “Phase 2.” Name the function, invariant, or behavior
  instead.
- If a design document adds useful detail, link its repository path and a stable
  heading after stating the rule locally. The link is supporting context, not
  the explanation.
- Use domain terms when they are the clearest words available, and define
  project-specific shorthand on first use. Prefer established identifiers over
  newly invented labels.
- Use ordinary sentence emphasis. Avoid all-caps emphasis, repeated warnings,
  and editorial language such as “obviously,” “simply,” or “verbatim.”
- Keep one idea per paragraph. If a comment needs a long decision record, move
  that record to `docs/` and leave a concise invariant at the code site.

### Keep comments durable

- Do not record dates, rollout phases, review finding numbers, or the sequence
  of past fixes unless the chronology is itself part of a compatibility
  contract.
- Do not leave commented-out code. Delete it; version control retains it. Keep
  disabled examples only when they are test fixtures or documentation, and state
  why they are disabled.
- Do not restate the next line of code. Explain why the line exists or remove
  the comment.
- Update nearby comments whenever behavior changes. A change is incomplete if
  its comments still describe the previous implementation.
- Treat performance measurements as snapshots. State the durable conclusion near
  the code and keep benchmark conditions and raw numbers in a benchmark or
  design document.

### Use plain English

- Be concise. Avoid filler words. Eliminate unnecessary qualifiers.

- Avoid jargon (shape, lane, width, gate, admission, blast radius, fan-out,
  lowering, fail closed, failure mode, ...)

  - Dense example: “the lowering declines before emission.”
  - Clearer: “This target does not compile the expression, so no source is
    produced.”

  - Dense example: “the aggregate-consuming capability steps the shape gate
    aside.”
  - Clearer: “Skip the generic shape check because this handler has already
    reduced every collection to scalars.”

  - Dense example: “a wide parameter admits a complex-shaped scalar but shapes
    the body real.”
  - Clearer: “The parameter accepts a complex value, but the compiled function
    body expects a plain real number.”

  - Dense example: “a scalar in a mandatory-vector slot of the emitted call
    tree.”
  - Clearer: “Argument 2 must be a vector, but this expression produces a
    scalar.”

### Action comments

Avoid bare `TODO` and `FIXME` markers. An action comment must say:

1. what behavior is missing or incorrect;
2. what the current fallback or consequence is; and
3. an issue or design-document link when the work is tracked elsewhere.

If the code is an intentional unsupported stub, describe that current contract
without a `TODO`. If nobody intends to act on the note and it does not explain
the current code, remove it.

### Tests

Test names and assertions should carry most of the explanation. Add a comment
when it clarifies a surprising fixture, identifies the boundary being pinned, or
explains why a plausible assertion would be wrong. Prefer “This remains symbolic
because…” to “This used to fail because…”.

### Links in doc comments

Doc comments on exported declarations are published as `src/api.md`. TypeDoc
rewrites links during generation, so check the generated destinations as well as
its unresolved-link warnings.

**Use `{@link}` for symbols, markdown for URLs.** `{@link}` resolves a symbol
name and nothing else. Given a path it fails, and the failure is quiet in the
output: `{@link mathfield/guides/speech/ | Guide: Speech}` renders as the
literal text `mathfield/guides/speech/ \| Guide: Speech`, not a link. Typedoc
does warn — `Failed to resolve link to ...` — so read the warnings when
regenerating.

**Never put a `#fragment` on a site-absolute link.** Typedoc strips the path and
keeps the fragment, so

```
[CSS variables](/mathfield/guides/customizing/#css-variables)
```

is published as `[CSS variables](#css-variables)` — a same-page link to a
heading that does not exist. A path with no fragment survives untouched, and so
does a full URL. Write one of:

```
[the customizing guide](/mathfield/guides/customizing/)
[CSS variables](https://mathlive.io/mathfield/guides/customizing/#css-variables)
```

**Link to a type, not to a property of one.** A type alias is rendered as a
single code block, so its properties get no heading of their own and there is
nothing for a link to land on:

```
### OperatorDefinitionFlags
  scoped: boolean | BindingSiteSelector;
```

`{@link OperatorDefinitionFlags.scoped}` resolves — typedoc assigns it an anchor
— but the anchor is never emitted. Link to `{@link OperatorDefinitionFlags}` and
name the property in the prose.

The same applies to anything `@internal`: `excludeInternal` strips it from the
output, so a link to it resolves for TypeScript and dangles in the docs
(`Comment for X links to Y which was resolved but is not included in the documentation`).
Write the name in backticks instead. Typedoc's suggested
`externalSymbolLinkMappings` fix does not apply — that option is for symbols
from other packages, not for our own excluded ones. A link between two
`@internal` comments is fine: neither is published, and it still resolves in the
IDE.

**Avoid reusing a name across exported symbols.** Anchors are the lowercased
member name, disambiguated by document order: a second `Expression` becomes
`#expression-1`, a sixth `#expression-5`. Links inside `api.md` are generated in
the same pass and stay consistent, but the numbering shifts whenever a
same-named export is added, removed or renamed — so anything outside the file
that points at a numbered anchor breaks silently. Distinct names give stable,
readable anchors.

Prose pages in the cortexjs.io repo should link to a symbol heading they can see
in the generated `api.md`, and be re-checked after an API rename.
`npm run build` there reports broken anchors.

### Type assertions in tests

A test that pins a derived type is a comment about what the engine promises, and
it must say which direction of drift it guards. Three spellings:

- **At least this precise** — the common case:
  `expectTypeBetween(expr, { atMost: 'real' })` (`test/utils.ts`). A sounder,
  more refined result still passes; a wider one fails. Prefer the helper to a
  bare `expect(t.matches('real')).toBe(true)`: the empty type `never` is a
  subtype of everything, so `.matches()` alone also accepts a derivation that
  collapsed to `never` or `vector<never^3>`; the helper rejects those and
  reports the offending type string on failure.
- **Sound, not over-narrow** — the same helper with both bounds, for a result
  the engine could over-claim: `above` names a claim that would be unsound, and
  the type must not match it —
  `expectTypeBetween(expr, { atMost: 'rational', above: 'integer' })` for a
  quotient that can be `3/2`; `above: 'vector<rational^2>'` for `Sin` over a
  literal list.
- **Exactly this tier** — the exact string,
  `expect(String(t)).toBe('rational')`, only where the exact tier is the
  contract, and the comment or test name says why. Two contracts that look like
  accidental precision but are not: `number` cells for an operand whose type is
  `unknown` (it admits NaN and ±∞, so any narrower cell tier over-claims), and a
  function signature's parameter list (parameters are contravariant, so an
  unrefined `(unknown) -> …` is a _subtype_ of the refined signature and passes
  `.matches()`).

An exact-string pin with no stated direction fails on every sound refinement
anywhere in the engine while guarding nothing in particular. The review question
for a new one: which drift would this catch that `expectTypeBetween` would not?
If the answer is "none", use the helper. (The measured cost of the unstated
pins, and the conversions that motivated this rule, are in
`docs/plans/2026-08-22-type-handlers-on-types.md` §2.3 and §3.)

### Review checklist

Before accepting a comment, ask:

- Would the code be just as clear without it?
- Does it explain why rather than translate the syntax?
- Can a reader understand it without opening an unnamed section or old review?
- Does every historical claim still affect current behavior?
- Is the detail proportional to the code it protects?
- Will a future behavior change make the comment visibly wrong?
- Does every link follow the rules above, and did the typedoc run come back
  without `Failed to resolve link` warnings?
- Does every new exact-string type assertion say which drift direction it guards
  (see "Type assertions in tests")? If it cannot, use `expectTypeBetween`.
