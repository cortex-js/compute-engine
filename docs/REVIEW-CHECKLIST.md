# Review checklist

The code reviewers (the `review-staged` and `review-files` skills, both the
Claude and the Codex reviewer) read this file and check a diff against each item
that applies. It lists the mistakes that are easy to make in this repository and
hard to see in a diff. The full rules are in `CODING-STYLEGUIDE.md`,
`ARCHITECTURE.md` and the `docs/*-MODEL.md` files; each item names its source.

Keep each item short and testable. Add an item when a review misses a mistake
that a reader of the diff could have seen. The user has approved every rule in
this file: follow each rule as written, and propose a change to a rule rather
than skip it.

## Scope of a finding

Label each finding with where the defect comes from:

- **introduced**: the diff causes it, or it is in a line that the diff adds or
  changes;
- **older**: it is in code that the diff does not change, and the review
  reached it with a new example.

Both kinds are reported. An `introduced` finding is fixed in the change; an
`older` one becomes a follow-up task
(`~/.claude/SHARED-BOX-PROTOCOL.md` §5.2). In a second review round, which
reads only the delta of the round-1 fixes, report only regressions that those
fixes caused.

## Automated trap scan

Run this once on the changed files under `src/`. It is a read-only search, not a
build or a test, so a reviewer may run it. Pass the files of the review (for a
staged review, `git diff --cached --name-only --diff-filter=d -- 'src/*.ts'`);
never run it with an empty file list, which scans the whole current directory:

```
ast-grep scan -c config/ast-grep/sgconfig.yml <changed src/**/*.ts files>
```

The rules are in `config/ast-grep/rules/`, one trap per file, each with a note
that explains it. A `warning` has no hit in the committed `src/`, so a hit in a
changed file is most likely a bug: report it as a finding, unless an
`// ast-grep-ignore` comment with a reason covers it. A `hint` has known hits
that were checked and accepted; report one only on a line that the diff adds:

- `simplify-in-rule-path`: a new `.simplify()` in code that the simplification
  rules call, unless the diff also adds it, with the reason, to the list of
  permitted calls in the header of `symbolic/simplify-rules.ts`.
- `indeterminate-direct-return`: a new `ce.Indeterminate` result that is not
  turned into `NaN` when an operand is a float, absent or `NaN`.

When a review finds a trap that a syntax pattern can detect, add a rule for it
there.

## Correctness

- **Exact results stay exact.** An `evaluate` handler returns an exact value or
  stays symbolic for an exact operand (`ln(2)` stays `Ln(2)`); it computes a
  float only under `numericApproximation` (`.N()`) or for a float operand. Use
  `isExact` to decide. See
  [the numerical evaluation contract](../ARCHITECTURE.md#what-n-promises-user-decision-2026-09-30).
  ([exactness contract](../ARCHITECTURE.md#what-n-promises-user-decision-2026-09-30).)
- **A function that jumps** (`Floor`, `Ceil`, `Round`, `Truncate`, `Fract`,
  `Mod`, `Sign`, `Heaviside`, the comparisons) uses the exact value of an exact
  operand under `.N()`, and returns a float.
- **Two exact numbers compare exactly**, without tolerance, in `Equal`/`Less`
  and in `.isEqual()`/`.isLess()`. Only `.is()` and float operands use the
  tolerance.
- **`.isSame()` is syntactic.** It never reads a symbol's value. Internal code
  uses it for literal checks (`.isSame(0)`); a check that can see a symbol must
  test `isNumber(op)` first. `.is()` is for the public API only.
- **`NaN` and `Indeterminate`.** An exact form without a value (`0/0`, `∞ − ∞`)
  gives `Indeterminate` through `indeterminateFormAnswer()`, never
  `ce.Indeterminate` directly from code that can see a float. Test `isNaN`, not
  `isSame(ce.NaN)`. (`docs/ERROR-MODEL.md`.)
- **Canonical folds read number literals only**, never the value assigned to a
  symbol (a fold of a value stays wrong after the symbol is reassigned).
- **`.add()` / `.mul()` methods** turn two exact literals into a float, and
  `.mul()` expands a product of sums. To build an exact or factored result, use
  `ce.function('Add' | 'Multiply', …)`. `evaluate()` and `.N()` keep a product
  of sums factored; do not remove `mulFactored`.
- **No `.simplify()` inside the simplification pipeline** (simplify rules,
  polynomial functions that rules call): it causes infinite recursion.
- **Expression forms.** A `form: 'raw'` expression is not bound and must not
  reach `.mul()`, `.add()` or other arithmetic; use `form: 'structural'`.
- **Collection shape tests** use a bare family name, an explicit `<any>` content
  type, or the `*_SHAPE_TYPE` constants. These constrain kind only; use an
  explicit content type when contents matter. `tuple<any>` is one slot, whereas
  bare `tuple` admits every arity. `string` and `range` are subtypes of
  `collection<any>`: a test for a collection arm in a union must require a
  type object, or it matches `string | integer` (`docs/TYPE-SYSTEM.md`,
  "Collection family contracts").
- **Type predicates and references.** A predicate that tests the shape of a
  type unfolds a transparent alias and keeps a nominal reference folded
  (`unfoldAliasOnDescent()`), and every function that unfolds a reference
  has a cycle guard, because a recursive alias reaches itself
  (`docs/TYPE-SYSTEM.md`, "Polymorphism").
- **A change that makes an inferred type more precise than a pinned `any`**
  keeps the precise type when no value contradicts it: check sample
  arguments, including the case the old `any` existed for, then update the
  pin and mention it in the report. Ask only when a value contradicts the
  narrower type.
- **A lazy operator** (`lazy: true`) gets its operands unbound: the handler must
  call `.canonical` on each operand it uses. Its tests must include the
  `ce.box(...)` and `ce.parse(...)` routes, not only `ce.function(...)`.
  Its `evaluate` handler must not return `undefined` after it has evaluated
  operands: the engine then rebuilds the node from the held operands and the
  evaluation is lost. Inference added to the lazy branch of boxing runs for every lazy operator,
  and many of them have a collection slot that is not a source (`Subscript`,
  `Matrix`, `Dictionary`, string slots). Such inference is opt-in by operator
  name (`COLLECTION_SOURCE_OPERATORS`, `validate.ts`), checked on the boxed
  operator and on the head of the handler's result. Test it by parsing the
  same input twice in one engine: a wrong inference shows on the second
  parse (`a_{n+1}` became `At(a, n + 1)`).
- **An operator that binds a variable** declares it with a `scoped` binding site
  selector; binding symbols come from `ce._bindingSymbol`, never
  `ce.symbol(name)`.
- **`BigDecimal.precision` is global**: code that changes it saves and restores
  it.
- **Plugin bundles**: no `instanceof` or `constructor.name` check across the
  host/plugin boundary; compare names as strings.
- **Compiled targets** (JavaScript, GLSL, WGSL, Python, interval) give the same
  result as `evaluate()`/`.N()` for the same input, or fail closed. A new
  operator or a new case in `evaluate` needs the same change in each target that
  supports the operator, or an explicit refusal there.
- **A compile test with only literal inputs does not test the lowering.** The
  compiler folds a constant subtree through the interpreter and emits the
  result as a literal, so a broken lowering never runs. Give the input as a
  free or `vars` symbol, or compile with `constantFold: false`.
- **A compile rule that depends on how a symbol is supplied** (a `vars` entry,
  `hideValues`, a declared or an inferred type) is also tested with the shape a
  plot host uses for a slider: `ce.declare('T', 'real')`, `ce.assign('T', 2)`,
  then `compile(…, { vars: { T: 'T' }, hideValues: ['T'] })`. A rule that
  refuses every `vars` name misses such a host, which maps each uniform to its
  own name.
- **Before you defend a deliberate refusal, probe the sibling cases**: the same
  mathematical situation through a variable, through an assigned symbol, and
  with another operator of the same family. A refusal that applies at some
  of these and not at the others is a defect, even when a comment explains it
  and a test pins it. Keep a refusal only when it prevents a result that is
  wrong with no error; "users do not write this" is not a reason. Example: a
  compiler that refuses to fold `Sqrt(-2)` to `NaN` has this defect when
  `Ln(-2)`, `arcsin(2)` and the same `Sqrt` over a variable compile and return
  `NaN`.

## LaTeX parse and serialize

- **An absent operand is `null`, not a falsy value.** `operand(expr, n)`
  (`src/math-json/utils.ts`) returns `null` for a missing slot. The MathJSON of
  the literal number `0` is the JavaScript number `0`, so a test such as
  `if (!op) return ''` also drops a zero operand, and serializes `When(0, c)` to
  an empty string. Test with `=== null`. Where a value comes from
  `operands()` destructuring, the absence marker is `undefined`; read the
  source of the value before you choose the test.
- **Verify a serializer change by a round trip on canonical forms.** Check
  `ce.parse(e.latex).isSame(e)` and `ce.box(e.toMathJson()).isSame(e)`. Do not
  compare strings or raw parse trees: the serializer may change the spelling
  (`\operatorname{abs}(x)` comes back as `\vert x\vert`). Do not assert only that a substring
  is present: `\sum_{i=1}^{10}0` contains a `0` even if the body was dropped.
- **The LaTeX serializer hides errors.** `Serializer.serialize()`
  (`latex-syntax/serializer.ts`) catches every error thrown while it serializes
  a sub-expression and writes an empty string for it. Validate options before
  serialization starts (as `LatexSyntax` does with `validateDisplayDigits()`),
  and do not throw from serializer code on accepted input. When an operand is
  missing from the LaTeX output, look first for an error that was caught.

## Conventions

- No new import cycle in `src/compute-engine` (runtime or `import type`).
- No leftover `console.log` (`console.assert` is allowed).
- Comments explain the mechanism in full sentences, without session shorthand or
  references to unnamed audits or decisions.
  ([comment guidance](../CODING-STYLEGUIDE.md#comments).)
- A user-visible behavior change has a `CHANGELOG.md` entry under "Behavior
  Changes" that says which input now gives a different result.
- Do not edit generated files by hand: `src/api.md`, `src/epsil/docs/errors.md`,
  `src/epsil/docs/library.md`.
- A defect found during the work is fixed in the same change, or added to
  `ROADMAP.md`; a "follow-up" comment alone is a finding.
- Never update a snapshot marked `@fixme`.

## Operator and regression checks

- A binding operator uses a `scoped` binding-site selector and
  `ce._bindingSymbol`; it does not construct binding symbols with
  `ce.symbol(name)`. Integration-provider calls lift the integrand before
  passing it to the rule engine.
- A test of literal narrowing checks the type or expression kind; `.isSame()`
  intentionally equates some values of different kinds.
- Declared result types are host promises. Compiler checks must reject a body
  whose representation contradicts the declared result type.
- Package-boundary regressions include a test against built bundles; a source
  import alone cannot test shared class identity or published resolution.

## Verification

For delegated fixes, follow
[the delegated-task checklist](../BUILD.md#completing-delegated-tasks). Use
focused checks for useful feedback; the orchestrator owns validation of the
combined result and decides which checks need repeating.

- [BUILD.md](../BUILD.md#validation-frequency) owns command responsibilities and
  specialized validation requirements.
- [Shared-box specifics §2](COMPUTE-ENGINE-BOX-SPECIFICS.md#2-worker-limits-and-the-box-lock)
  owns targeted test commands, worker limits, and lock requirements.
- Before staging, the orchestrator follows
  [the staging checks](COMPUTE-ENGINE-BOX-SPECIFICS.md#checks-before-staging-source-changes),
  including the core set and any full-suite exceptions. Review verification does
  not replace this gate.
