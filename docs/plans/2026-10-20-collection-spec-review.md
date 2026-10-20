# Dual review of collection and absence semantics

Date: 2026-10-20.

Scope: the full working versions of
[the collection design note](2026-10-20-bare-tuple-record-any.md),
[ERROR-MODEL](../ERROR-MODEL.md), and
[TYPE-SYSTEM](../TYPE-SYSTEM.md). This was a specification review, not a
review of staged code. No implementation changes were authorized.

Reviewers: Claude Sonnet with high effort and an independent Codex
GPT-6.1 reviewer with high reasoning. GPT-5.5, the workflow's preferred
Codex model, was unavailable. Both received the same scope, accepted
decisions, and unresolved choices.

Codex's independent review returned no findings, treating the listed
policy choices as explicitly open. Claude returned 14 candidates.
Reconciliation produced nine actionable groups: four medium and five low.
Codex subsequently confirmed the content-type wording issue raised during
reconciliation; this was not an independently overlapping finding.

The agreed direction remains viable. The review identifies three additional
semantic decisions needed for predictable composition of raw lazy views.
Other corrections clarify consequences of existing decisions or make the
implementation checks more explicit.

Subsequent user decisions: Q9 selects callback bypass for `Nothing`, with
raw positions retained by `Map`; Q10 selects whole-observation skipping
for paired statistics. The original findings and recommendations below
remain as review history. The primary design note records the selected
rules and remaining operator-specific details.

## Findings and disposition

### 1. Medium — `Nothing` entering a callback

Source: Claude. Decision needed.

```text
m = Map(x ↦ If(x > 1, Nothing, x), [1, 2, 3])
Map(x ↦ x * 2, m)
```

The inner view has three positions. Keeping those positions does not decide
whether the outer callback receives `Nothing`, is bypassed for that position,
or fails through its parameter contract.

Recommendation: deliver each raw result to `Map`'s callback; a strict
parameter excluding `nothing` rejects it unless explicit handling applies.
An alternative is an explicitly specified bypass that preserves `Nothing`
without invoking the callback. This choice affects effects as well as values.
Structural operations such as `Take` and `Zip` must be distinguished from
callback execution.

Follow-up disposition: the user selected bypass rather than the review's
delivery recommendation. The primary note now records the resulting
callback, effect, and typing rules. `Filter`'s treatment of the bypassed
position still needs specification.

### 2. Medium — Paired reductions must preserve alignment

Source: Claude. Decision needed.

```text
left:  [1, Nothing, 3]
right: [10, 20, 30]
```

Independent omission would destroy the pairing. A paired reducer must either
omit the entire corresponding pair, reject the omitted contribution, or
document another operation-specific rule. It must not pair `3` with `20`.

Recommendation for paired statistics: omit a whole observation when one of
its inputs is `Nothing`. Decide the scope explicitly for `Covariance`,
`Correlation`, `Dot`, and callback reductions; one generic rule must not
silently change all of them. `Missing` retains its separate propagation
policy. The existing `Mean` denominator decision is already explicit and
is not a new defect.

Follow-up disposition: whole-observation skipping is selected for paired
statistics. `Dot` and custom callback reductions remain separately scoped.

### 3. Medium — Repeated reads and captured state

Source: Claude. Decision needed.

```text
m = Map(effectfulCallback, xs)
m[2]
m[2]
Sum(m)
```

The raw-view decision specifies positions and avoids evaluation just to count.
It does not specify whether a second read repeats effects, returns a cached
result, or is disallowed by a purity requirement. The time at which captured
variables are observed is a separate question.

The primary note now records reevaluation, memoization, and purity options.
Reevaluation costs work and may change results; memoization retains memory
and still requires capture rules; requiring purity restricts usable callbacks.
No policy was selected by this review.

### 4. Medium — Content contracts and assertion refinement

Source: Claude and Codex reconciliation. Documentation correction.

`nan` is within `number`, `value`, and `expression`. Therefore `NaN` and
`Indeterminate` satisfy those content contracts even though the agreed
absence predicate classifies them as absent.

The phrase “absence-excluding” overstated what `value` and `expression`
guarantee. They exclude the specific types `missing`, `nothing`, and `error`.
The reference documents and proposal now make that distinction explicit.

The assertion's successful result must exclude the handled absence outcomes,
while preserving other possible outcomes:

```text
string | missing                 → string
integer | nothing | missing      → integer | nothing
number                           → number & !nan
```

The numeric refinement retains infinities; substituting `real` or `complex`
would remove unrelated values. `??` applies the refinement to all but its
last operand; its final fallback may itself be absent. `Undefined` and
unresolved inference information still require the migration work already
listed in the spec.

### 5. Low — Inventory omission boundaries and conditional keys

Source: Claude. Coverage correction; policies remain open.

The selected rules classify lists, raw views, tuples, ordinary arguments,
and aggregating reduction. They do not classify every constructor or
structural conversion. The note now lists these boundaries explicitly
rather than extending the mnemonic to unreviewed operations.

If the proposed record rule omits `Missing`, then:

```text
f(x): integer | missing
{a -> f(x)}
```

does not always contain `a`. A required `a: integer | missing` field
cannot express that shape. Optional/conditional shape information or a
conservative guarantee about only the definitely present fields is needed.
This dependency is now explicit; field omission is still a preference,
not a final decision.

The existing `NaN`-to-`Missing` repair in `validate.ts` traverses nested
lists, not dictionaries or records. The review did not establish the
suggested current dictionary-deletion bug. Migration must avoid introducing
one by broadening the repair.

### 6. Low — Scope the numeric absence change

Source: Claude. Acceptance-criteria correction.

The agreed change affects `IsMissing`, `Coalesce` / `??`, and the proposed
assertion. It does not authorize changing exact arithmetic propagation.
The documents now make the distinction concrete:

```text
Coalesce(Indeterminate, 5)      → 5              intended new behavior
Mean([1, Indeterminate])       → Indeterminate  existing exact behavior
Max(1, Indeterminate)          → Indeterminate  existing exact behavior
```

Implementation must audit shared predicate callers. The review does not
require a particular helper name or mandate one new global predicate.

### 7. Low — Specify assertion lexing

Source: Claude. Coverage correction.

The lexer groups adjacent operator characters. An isolated `?!` token does
not establish how `?!!`, `?!=`, or `?!-` should parse. The existing Unicode
mapping also maps `⁈` to `?!`.

The note now calls out separator rules, adjacency cases, and the Unicode
alias for the syntax decision. The spelling remains proposed. This is
not grounds to redesign existing operator lexing as part of the review.

### 8. Low — State the compiler refusal conditions

Source: Claude. Acceptance-criteria correction.

A target must either preserve a checked assertion's failure behavior or
refuse compilation, unless proof eliminates the check. Returning `NaN`
on assertion failure would defeat the assertion.

A raw `Nothing` result likewise requires a distinct representation or a
sound compilation transformation at an explicit omission boundary.
Substituting `NaN` confuses omission with numeric absence.

These are consequences of the existing interpreter/compiler agreement
requirement. The review does not prescribe new lowerings or require all
targets to reject every such expression permanently.

### 9. Low — Remove stale alternatives and label migration examples

Source: Claude. Documentation correction.

Some prose still made raw `Map` omission sound undecided. It now states
that `Nothing` retains one raw position and counts as one raw result;
`ListFrom` omits it.

Subtype examples involving `<unknown>` are labeled as current or historical
implementation relationships. They are not target-model subtype queries
against an inference marker.

The migration inventory explicitly includes library parameter/result uses
of `unknown`. The implementation sequence does not imply shipping an
intermediate public meaning without corresponding documentation and a
coherent migration.

## Candidate findings not accepted as stated

- A retained marker is not necessarily an ordinary unit value. The decided
  boundary behavior does not force a new unit type; wording was clarified.
- `Nothing?!` passing through is an explicit policy, not a missed runtime
  check. The real correction is to preserve `nothing` in the result type
  and explain what the assertion proves.
- The spec already distinguishes the five element-parameterized collection
  families from tuple slot types and record field types. `tuple<any>` having
  one slot is explicitly documented, not a newly discovered inconsistency.
- Current-versus-target `<unknown>` semantics and compiler support were
  already migration concerns. They warranted clearer acceptance criteria,
  not automatic reversal of the implementation plan.
- Claude's suggested wording that a raw `Nothing` contributes nothing to
  element counts was rejected: under R it contributes one raw position.
- The shared numeric gate uses absence-symbol logic rather than uniformly
  calling `isAbsentValue`; changing every caller to one predicate is not
  justified by the implementation evidence.

## Verification and scope

The orchestrator verified numeric subtype membership directly and inspected
the lexer, numeric predicate callers, list-only marker repair, and current
compiler error behavior where the candidate findings depended on them.
No implementation was changed, and no behavioral test result is claimed
for the proposed semantics.

Verification completed:

- `git diff --check` passed.
- Markdown fence and table-column checks passed for all four documents.
- `npm run typecheck` passed, including CLI, type-level pins, dependency
  cycles, and public type surfaces.

The specification changes remain uncommitted and unstaged.
