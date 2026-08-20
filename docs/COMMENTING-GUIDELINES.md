# Code Comment Guidelines

Comments should make the current code easier to understand and change. They
are not a substitute for clear names, tests, version control, or design
documents.

## What to comment

Write a comment when it records information that the code cannot express
clearly on its own:

- the reason for a non-obvious choice;
- an invariant or precondition that a future change must preserve;
- a boundary imposed by another subsystem, file format, standard, or
  third-party API;
- a numerical derivation, algorithmic trade-off, or intentional precision
  limit;
- the observable behavior of a compatibility path;
- why an apparently simpler implementation is incorrect.

Prefer a short comment next to the smallest relevant unit. Use a doc comment
for a public contract and a design document for reasoning that needs examples,
alternatives, measurements, or a decision history.

## Write for the current reader

- Describe the current rule in present tense. A regression comment should say
  what must remain true, not narrate what an older implementation did.
- Make local comments self-contained. Avoid bare references such as “see
  above,” “Appendix B,” “R5,” or “Phase 2.” Name the function, invariant, or
  behavior instead.
- If a design document adds useful detail, link its repository path and a
  stable heading after stating the rule locally. The link is supporting
  context, not the explanation.
- Use domain terms when they are the clearest words available, and define
  project-specific shorthand on first use. Prefer established identifiers over
  newly invented labels.
- Use ordinary sentence emphasis. Avoid all-caps emphasis, repeated warnings,
  and editorial language such as “obviously,” “simply,” or “verbatim.”
- Keep one idea per paragraph. If a comment needs a long decision record, move
  that record to `docs/` and leave a concise invariant at the code site.

## Keep comments durable

- Do not record dates, rollout phases, review finding numbers, or the sequence
  of past fixes unless the chronology is itself part of a compatibility
  contract.
- Do not leave commented-out code. Delete it; version control retains it. Keep
  disabled examples only when they are test fixtures or documentation, and
  state why they are disabled.
- Do not restate the next line of code. Explain why the line exists or remove
  the comment.
- Update nearby comments whenever behavior changes. A change is incomplete if
  its comments still describe the previous implementation.
- Treat performance measurements as snapshots. State the durable conclusion
  near the code and keep benchmark conditions and raw numbers in a benchmark
  or design document.

## Use plain english

- Be concise. Avoid filler words. Eliminate unnecessary qualifiers.

- Avoid jargon (shape, lane, width, gate, admission, blast radius, fan-out, lowering, fail closed, failure mode, ...)

  - Dense example: “the lowering declines before emission.”
  - Clearer: “This target does not compile the expression, so no source is produced.”

  - Dense example: “the aggregate-consuming capability steps the shape gate aside.”
  - Clearer: “Skip the generic shape check because this handler has already reduced every collection to scalars.”

  - Dense example: “a wide parameter admits a complex-shaped scalar but shapes the body real.”
  - Clearer: “The parameter accepts a complex value, but the compiled function body expects a plain real number.”

  - Dense example: “a scalar in a mandatory-vector slot of the emitted call tree.”
  - Clearer: “Argument 2 must be a vector, but this expression produces a scalar.”


## Action comments

Avoid bare `TODO` and `FIXME` markers. An action comment must say:

1. what behavior is missing or incorrect;
2. what the current fallback or consequence is; and
3. an issue or design-document link when the work is tracked elsewhere.

If the code is an intentional unsupported stub, describe that current contract
without a `TODO`. If nobody intends to act on the note and it does not explain
the current code, remove it.

## Tests

Test names and assertions should carry most of the explanation. Add a comment
when it clarifies a surprising fixture, identifies the boundary being pinned,
or explains why a plausible assertion would be wrong. Prefer “This remains
symbolic because…” to “This used to fail because…”.

## Links in doc comments

Doc comments on exported declarations are published as `src/api.md`, which
mathlive.io renders at `/compute-engine/api/`. Typedoc rewrites links on the
way out, and four rewrites turn a reasonable-looking comment into a dead or
silently wrong link. Docusaurus reports the dead ones; nothing reports the
wrong ones.

**Use `{@link}` for symbols, markdown for URLs.** `{@link}` resolves a symbol
name and nothing else. Given a path it fails, and the failure is quiet in the
output: `{@link mathfield/guides/speech/ | Guide: Speech}` renders as the
literal text `mathfield/guides/speech/ \| Guide: Speech`, not a link. Typedoc
does warn — `Failed to resolve link to ...` — so read the warnings when
regenerating.

**Never put a `#fragment` on a site-absolute link.** Typedoc strips the path
and keeps the fragment, so

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

`{@link OperatorDefinitionFlags.scoped}` resolves — typedoc assigns it an
anchor — but the anchor is never emitted. Link to `{@link
OperatorDefinitionFlags}` and name the property in the prose.

**Avoid reusing a name across exported symbols.** Anchors are the lowercased
member name, disambiguated by document order: a second `Expression` becomes
`#expression-1`, a sixth `#expression-5`. Links inside `api.md` are generated
in the same pass and stay consistent, but the numbering shifts whenever a
same-named export is added, removed or renamed — so anything outside the file
that points at a numbered anchor breaks silently. Distinct names give stable,
readable anchors.

Prose pages in the cortexjs.io repo should link to a symbol heading they can
see in the generated `api.md`, and be re-checked after an API rename. `npm run
build` there reports broken anchors.

## Review checklist

Before accepting a comment, ask:

- Would the code be just as clear without it?
- Does it explain why rather than translate the syntax?
- Can a reader understand it without opening an unnamed section or old review?
- Does every historical claim still affect current behavior?
- Is the detail proportional to the code it protects?
- Will a future behavior change make the comment visibly wrong?
- Does every link follow the rules above, and did the typedoc run come back
  without `Failed to resolve link` warnings?

