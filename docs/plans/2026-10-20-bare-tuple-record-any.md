# Collection types, missing data, and omission

Status: revised design proposal, 2026-10-20. The user requested this revision
after reviewing options A and B and discussing `Missing` and `Nothing`.
This document recommends a direction and identifies decisions still needed;
it does not authorize implementation or replace existing language rules.
The original filename is retained for existing links.

The recommended direction is **B: a bare collection name specifies its kind,
and an element annotation specifies its contents**. Keep errors as implicit
evaluation failures, track missing data through inference, and treat
`Nothing` as explicit omission. Do not make every type silently mean
“this value, a missing datum, or an instruction to remove a position.”

Developer ergonomics are a decision criterion, not a documentation task at
the end. A developer should be able to predict what a declaration promises,
what an absent argument does, and whether an operation changes positions
without knowing how the engine stores types or evaluates a particular view.

## Why these decisions belong together

The original problem is a missing type: `tuple<any>` describes exactly one
slot, so it cannot describe every tuple, including arbitrary lengths and
absent coordinates. Bare `tuple` currently excludes absent coordinates.
Consequently, `TupleFrom(L)` for `L: list<integer | missing>` can claim a type
that excludes the tuple it produces. Records have a related problem.

Broadening the bare names fixes that expressiveness problem. It does not
decide whether a function can produce absence without stating it, whether
an annotation guarantees presence, or whether a lazy collection counts a
`Nothing` result as an element.

The current rules answer those questions in different ways:

- The types guide calls absence opt-in: `missing` is not a subtype of
  `unknown`, and explicit element types exclude it unless they include it.
- The error model allows assignment of `Missing` to a non-callable declared
  symbol while retaining the declared type. A symbol declared `string` can
  therefore report `string` while evaluating to `Missing`.
- Function signatures describe successful values. Undeclared partiality
  can produce a marker at runtime without adding it to the application type.
- Some call checks accept `T | missing` where `T` is expected and defer the
  decision to runtime. This does not change the subtype relation.
- The October 20 decision lets an indexed lazy view retain and count
  `Nothing`, while converting that view to a list erases it.

These are more than implementation exceptions. They mix promises about
successful values, possible evaluation outcomes, and collection contents.
The rules below separate those promises.

References: [type guide](../../doc/08-guide-types.md),
[error model](../ERROR-MODEL.md), and [remaining work](../../ROADMAP.md).

## Proposed rules in plain language

### 1. A bare collection name says what kind of collection it is

Under B:

| Spelling | What it promises about contents |
| --- | --- |
| `list`, equivalently `list<any>` | A list, with no restriction on its element types |
| `list<unknown>` | A list whose immediate elements are values, excluding `missing`, `nothing`, and `error` |
| `list<integer>` | A list of integers |
| `list<integer \| missing>` | A list whose positions contain integers or missing data |
| `list<integer> \| missing` | A list of integers, or an absent whole list |
| `tuple` | Any tuple, with arbitrary length and slot types |
| `tuple<any>` | Exactly one tuple slot, with any type |
| `record` | Any record, including records with absent fields |

The same bare-name rule applies to `set`, `dictionary`, `collection`, and
`indexed_collection`. It does not silently change the meaning of `string`,
`range`, or the numeric defaults of `vector` and `matrix`. Spell out the
scope in the type guide, including the treatment of the `tensor` alias.

“Values only” is a restriction on the immediate elements. It does not promise
that no nested structure contains absence:
`list<list<missing>> <: list<unknown>` already holds because a list is itself
a value.

`any` is the full top, not just an abbreviation for “values plus missing.”
It also admits `nothing` and `error` as types. This rule does not change
where construction erases `Nothing` or where evaluation propagates errors.

For developers: use a bare name when only the collection kind matters.
Write an element type when its contents matter. A bare name opts out of
element restrictions; a particular element type retains them.

### 2. Omitted information may be inferred; explicit information is a contract

Recommended declaration behavior:

```text
xs: list := [1, 2]       infer integer elements; keep list as the contract
ys: list<any> := [1, 2]  keep the explicit unrestricted element contract
zs: list<unknown>        require values in the immediate element positions
```

The first two annotations denote the same set of permitted collection
values. Their difference is the author's instruction to inference: one
omits an element annotation, the other supplies it.

Store that instruction on the declaration, separately from the semantic
type. Do not infer it from whether an equivalent type is stored as a string
or a composite object. Type normalization, aliases, and caching must not
accidentally change a declaration's refinement behavior.

Separate display of a type from serialization of a declaration. A short
display may print equivalent types alike. A declaration serializer must
preserve whether the element annotation was omitted, so a round trip does
not turn `list<any>` into a different inference instruction.

This is a recommendation, not a settled declaration policy. An alternative
is to give all equivalent annotations identical refinement behavior. Choose
between them by how predictable assignment, reassignment, aliases, and
editor hovers are to users; see Q2 below.

### 3. Missing data, omission, and failure mean different things

| Result | Plain-language meaning | Effect on a collection position |
| --- | --- | --- |
| `Missing` (type `missing`) | The position exists, but its datum is absent | Keep the position |
| `Nothing` (type `nothing`) | Emit no element at a defined construction boundary | Remove the position at that boundary |
| `Error` (type `error`) | Evaluation failed or a program contract was violated | Propagate when demanded; collections may retain a failed cell |
| `NaN` | Numeric marker, including the existing encoding of numeric absence | Keep the position |
| `never` | No successful result is possible | Not a value or an erasure instruction |

An expression that remains symbolic is not missing merely because its value
is not yet known. An absent whole collection is also different from an
empty collection: one has no available collection value, the other has zero
elements.

Do not describe `Nothing` as both an ordinary unit value and an erasure
instruction. If the language needs a value meaning “completed, with no
interesting result,” decide separately whether that value can be stored.
An ordinary unit value occupies one position.

The existing distinction between `NaN` and exact `Indeterminate` remains:
this proposal does not change the numeric representation rules.

### 4. Infer absence instead of making users annotate every possible miss

Three questions have different answers:

| Question | Recommendation |
| --- | --- |
| Must the author write every `\| missing`? | No; infer it from access, conditions, callbacks, and other producers |
| Must analysis retain known absence? | Yes; a declaration or normalization must not erase the information |
| Must a possibly absent argument always be a static error? | No; propagation, explicit handling, or a runtime check may be appropriate |

Examples of the intended analysis:

- A read from a known present position retains the element's own type.
  A read that can miss adds the domain's marker.
- A read from `list<string>` can therefore produce `string | missing`;
  the collection does not need missing elements for an index to be absent.
- A read from `list<any>` must not claim values-only `unknown`: it can
  expose any element, including `Missing`.
- A read from `list<unknown>` that can miss needs `unknown | missing`.
- `Any` and `All` retain a possible `missing` result when predicate outcomes
  can leave the answer undecided. They cannot claim an unconditional
  `boolean` merely because their successful answers are booleans.
- A callback that returns `Missing` contributes `missing` to the result
  collection's element type. A callback that returns `Nothing` also requires
  a decision about output length, under rule 6.

A declared function signature may continue to describe successful, present
results. The computed information for an application must distinguish that
contract from what evaluation can actually produce. Analysis needs to know
whether presence is proved, absence is possible, or presence has not been
established. Lack of information is not proof of presence.

This does not require appending `| missing | error` to every displayed
signature. Known missing data can use the existing unions. Information about
partial evaluation can be separate. The representation and public API are
open; every consumer must know which promise it is reading.

In particular, if assignment to `s: string` continues to allow `Missing`,
then `string` is the declared successful-value contract. Reading `s` must
retain its known absence through a computed type or separate presence
information. Alternatively, make such declarations require present values.
The note recommends retaining information in either design; Q1 decides the
assignment behavior.

### 5. Accepting an absent argument must have a defined meaning

Keep subtyping separate from whether a call is allowed. `missing` does not
become a subtype of `string` just because a call accepts an expression typed
`string | missing`.

Each parameter has one of three behaviors:

| Behavior | What happens when the argument is absent |
| --- | --- |
| Propagate | Return the result domain's marker without running the ordinary handler on an invalid argument |
| Handle | Give the absent argument to a handler that explicitly understands it |
| Reject | Report a type/contract error before the ordinary handler assumes a present value |

An unannotated or `any` parameter that receives absence needs the same
defined semantics; permissive typing is not a substitute for runtime rules.
Defaults should be centralized and documented, with explicit exceptions.
A known absent argument should be accepted by a parameter that handles or
propagates it; refusal must not depend accidentally on whether its type is
`missing` alone or a union containing `missing`.

For callers:

- Use a fallback such as `xs[i] ?? fallback` when absence should be replaced.
- Pass through absence when the operation documents propagation.
- Filter absent elements explicitly when they should not participate.
- Expect a strict consumer to reject absence, either statically when
  established or at runtime if the check was deferred.

The interactive engine can defer uncertain checks while Epsil offers earlier
diagnostics. Their evaluation semantics must agree when both run the same
program. The exact diagnostic default for possibly absent arguments is Q3.

Retain the useful existing operation rules:

| Operation | Rule for `Missing` |
| --- | --- |
| Count positions, reverse, take, or zip | Preserve absent positions |
| Map | Apply the callback's absence policy; preserve position unless explicit omission is part of the selected model |
| Numeric aggregate such as sum or mean | Propagate the numeric marker; skipping is explicit |
| Filter by a predicate | Keep only a decided `True`; document that an absent verdict does not select |
| Any / All | Use three-valued logic; a decisive result may settle the answer despite another absent verdict |
| Coalesce | Explicitly replace absence |

Predicates over missing numeric data still follow the existing `NaN` rules.
This table is not a change to the accepted numeric encoding.

### 6. A collection must have a consistent account of its elements

Its indexing, iteration, count, type, and displayed contents must describe
the same sequence. Computing that sequence lazily may delay work; it must
not silently change what counts as an element.

The October 20 implementation deliberately distinguishes:

```text
m = Map(x ↦ If(x > 1, Nothing, x), [1, 2, 3])

raw view:          [1, Nothing, Nothing]    count 3
list built from m: [1]                     count 1
```

Two designs can make this coherent:

| | L: expose logical elements | R: expose raw callback results |
| --- | --- | --- |
| What iteration yields | Only emitted elements; omit `Nothing` as the iterator advances | Every callback result, including `Nothing` |
| Count in the example | 1, once enough work has been done to determine it | 3 |
| Element information | Integer elements; output length may be unknown before evaluation | `integer \| nothing`; raw result count can remain 3 |
| Conversion to a list | Preserve elements and length | Explicitly compact results, removing `Nothing` and changing length |
| Developer explanation | “A lazy collection has the same elements when materialized” | “This view records results; collecting it omits the no-result entries” |

**Recommendation: L for ordinary collection operations.** It gives users
one sequence to reason about. If a callback can omit elements, `Map` cannot
keep the input's exact length without proof. Length can require evaluation,
and indexing may require walking earlier results. This has the same cost
as filtering; an infinite source that never emits an element may never
produce a first element.

**R is the current user decision and remains an open alternative.** Keeping
it requires a semantic distinction for raw views, whether represented by a
separate type or another explicit capability. A raw view exposing `Nothing`
cannot claim `vector<integer^3>`. Compaction needs a rule that removes
`nothing` from the element type and drops or recomputes the exact length.
Ordinary numeric collection consumers must not silently treat raw results
as already compacted elements.

For either choice:

- State which sequence `Zip`, `Ordering`, `Sort`, reducers, and nested list
  construction consume. For example, `Zip` must not lose a coordinate
  merely because tuple construction erased a raw `Nothing` result.
- Apply omission only at defined boundaries. An ordinary computed function
  argument must not silently disappear and shift later arguments without
  an explicit language rule.
- Preserve `Missing` positions while removing `Nothing`; never use one as
  an implementation substitute for the other.
- Do not evaluate an effectful callback twice just to determine a count.
  Unknown counts and unevaluated expressions remain legitimate.
- Interpreter, compiled execution, and serialization must preserve the
  selected sequence semantics. A debug preview of raw results should be
  identified as a preview, not serialized as an equivalent ordinary list.

Choosing L would revise the October 20 decision. Editing this note does not
make that revision; Q4 requires an explicit choice.

### 7. Errors may be implicit; known data absence must not disappear

A signature `(A) -> B` need not include `| error` for ordinary evaluation
failure. It promises the type of successful results. Strict evaluation
propagates an error before a handler treats it as a `B`; error observers are
explicit exceptions.

Retaining failed cells in a collection is compatible with that model if
each read preserves the cell's possible failure. Successful element type,
evaluation failure, and whether the syntax tree is valid are separate
facts. Replacing a failed cell's element type with `unknown` alone does not
explain those facts.

Keep the existing numeric marker representation, but apply the same care:
`integer` describes integer successes; `integer | nan` includes a numeric
marker; `number` already includes `nan`. A concise successful-value signature
does not prove that runtime evaluation cannot produce a marker.

Compiled code may omit a check only when the relevant guarantee has been
established, or when the target's representation and operations already
implement the required behavior. The absence of a displayed union is not
enough. This is especially important where current compilation decisions
depend on finding a `missing` arm in a type.

## Decisions still needed

| Question | Recommended direction | What remains to choose |
| --- | --- | --- |
| Q1. What does `x: T` promise about presence? | Keep declared contracts separate from computed presence; never lose known absence | Retain successful-value assignments with tracked presence, or require present values unless `missing` is explicit; define the public read/type API |
| Q2. Does an omitted element annotation request inference? | Yes; record omission on the declaration, independently of type representation | Confirm this distinction from explicit `list<any>` and `list<unknown>`; specify aliases, reassignment, hovers, and declaration round trips |
| Q3. When is possible absence a diagnostic? | Permit documented propagation and handling; runtime checks for deferred strict calls | Choose Epsil's default diagnostic policy and how authors request stronger presence guarantees |
| Q4. What does a lazy collection expose? | Logical elements (L) for ordinary collections | Confirm a change to the October 20 rule, or retain raw results (R) with explicit typing and compaction semantics |
| Q5. Where does `Nothing` erase? | Explicit construction/emission boundaries | Enumerate argument lists, tuple/list/set/record construction, raw views, nested construction, and serialization; decide whether a distinct unit value is needed |
| Q6. What do unspecified record fields promise? | Do not infer restrictions on fields the type does not constrain | Choose open records, closed records, or an explicit remainder type, and their dictionary relationships |
| Q7. How should unbound generic variables behave? | Keep the current fallback initially; bind from actual arguments normally | Test local explicit `where T: any` bounds and overload inference before considering a global fallback change |

Two inherited conventions also need explicit compatibility checks:

- A tuple whose coordinates are all absent currently evaluates to
  `Missing`, including a tuple produced by `Zip`. That collapses “a present
  tuple with absent coordinates” into “an absent tuple.” Decide whether this
  remains a general tuple rule or is specific to mathematical points. It
  must not be silently implied by B.
- `Undefined` participates in absence handling but is still declared
  `unknown` in some paths. Align its analysis with its runtime behavior;
  a separate spelling must not hide an absent element.

## Alternatives and tradeoffs

### A: broaden only tuple and record

This is a smaller compatibility change and repairs the original lack of a
top for those two kinds. It leaves users with two bare-name rules:
`tuple` permits absent slots, while `list` excludes absent elements.
It also removes the bare subtype relationships from `tuple` to
`indexed_collection` and from `record` to `dictionary`.

Use A if minimizing immediate scope outweighs a uniform rule. It does not
resolve the successful-value versus evaluation-outcome questions above.

### B: broaden the collection family names

Recommended for the uniform explanation in rule 1. It weakens promises made
by existing bare result types, so preserve specific element guarantees
where producers can provide them. Broadening a function's input can accept
more callers; broadening its result can break downstream consumers.
Function-valued arguments need their own variance checks.

The prototype's N variant preserves explicit `X<any>` composite types and
relates them to bare `X`. This is a useful migration technique, not a reason
to make representation determine declaration behavior permanently.
Canonical composite types plus separate annotation metadata are another
implementation choice. F's collapse to primitive names is not the only
possible canonical representation.

### C: preserve the current bare names and add the missing type forms

An arbitrary-length tuple element type and a record remainder/top form
could express absence without changing the existing bare names.
Illustrative syntax such as `tuple<...E>` is not implemented or selected.

This preserves the stronger rule that absence is written explicitly, at
the cost of new syntax and type-system machinery. It also provides useful
precision: “a tuple of any length whose elements are integers” or “whose
elements are `integer | missing`.” B alone does not provide those types.
Such forms could be added later alongside B, helping `Shape` and
`TupleFrom` avoid unnecessarily broad results.

An interim honest result such as `indexed_collection<any>` is also possible.
It loses tuple specificity, but leaving the original false type is not the
only alternative to implementing A or B immediately.

### Universal implicit missing

Another coherent option is to say that every `T` means “a `T` when present”
and permit absence everywhere without recording it in ordinary types.
This reduces annotation and diagnostic friction for interactive work.

Its cost is that `list<T>` no longer proves that its elements are present.
Handlers and compilation must preserve absence generally, and authors who
need a stronger guarantee need a separate presence qualifier, check, or
proof. Whole-collection absence and absent cells still require distinct
runtime handling. `Nothing` still needs explicit length and position rules.

This note does not recommend universal implicit missing. Inferred presence
information plus defined argument behavior offers convenience without
discarding facts that collection operations and compiled code need.

## Corrections and evidence from the review

Focused in-memory probes during this review, across checkouts `25f05351d`
and `a64876f1f`, confirmed the following. They are not a rerun of the
prototypes or a full conformance audit.

### Tuple arguments already bind generic element types

```text
(collection<T>) -> T where T
  applied to tuple<integer, missing>
  binds T = integer | missing

(indexed_collection<T>) -> T where T
  applied to tuple<integer, missing>
  binds T = integer | missing

Reverse(t: tuple<integer, missing>) -> list<integer | missing>
CountIf(t, F)                      -> accepted
Map(x ↦ x + 10, t)                -> incompatible-type error
```

The original note incorrectly attributed the lazy-operator refusal to a
missing tuple-binding rule. The solver already reads the tuple slots.
The lazy path instead goes through `checkCollectionOperand` and
`checkType(x, 'collection')`, where the list and tuple routes differ.
The current roadmap records that diagnosis. Fix and verify the validation
path independently; do not introduce a solver fix on the old premise.

### Record transitivity requires a structural decision

```text
record{a: integer, b: missing} <: record{a: integer}
record{a: integer}            <: dictionary<unknown>
record{a: integer, b: missing} is not <: dictionary<unknown>
```

The first relation permits additional fields. The second assumes every
field is values-only. Those assumptions are incompatible: saying that
field `a` is an integer says nothing about another field `b`.

B removes paths through the old bare names; it does not repair this example
through explicit types. The same decision affects the inferred type of
enumerating all values of an open record. Treat Q6 as a design question,
not merely a few incorrect subtype answers.

### Computed outcomes and collection lengths disagree with reported types

```text
Map(x ↦ If(x > 1, Nothing, x), [1, 2, 3])
  reported type:    vector<integer^3>
  view elements:    1, Nothing, Nothing
  constructed list: [1], typed vector<integer^1>

Any([1, Missing], x ↦ x > 2)
  reported type: boolean
  result:        Missing, typed missing

s: string := Missing
  reported symbol type: string
  evaluated symbol:     Missing
```

The first two need rules 4 and 6. The third is authorized by the existing
assignment rule and requires Q1, rather than being classified automatically
as an assignment bug.

Relevant recent commits:

- `58abb40ff`: retain absent element types across collection operations.
- `85e4ca049`: more precise absent-cell arithmetic, callback and accessor
  results, and consistent all-absent `Zip` elements.
- `d4361e1f1`: use a declared numeric element domain for an empty-list miss;
  retain `Nothing` in indexed view previews and erase it on list construction.

## Historical prototype measurements

These measurements predate this revision. The original A baseline was
`1efbbe884`; the B figures are retained from the original note's prototype
runs. “Baseline” below means the corresponding original run, not the current
checkout. No implementation of this revised proposal has been measured.

### A: subtype-only prototype

The prototype changed primitive subtype relationships, acceptance of bare
tuple/record types, their relationships to parameterized collections, and
`couldMatch`. The primitive intersection calculation retained the old
overlaps because a values-only tuple still inhabits both tuple and
values-only indexed collection types.

Across 47 sampled types:

| Check | Baseline | A prototype |
| --- | --- | --- |
| Transitivity violations | 11 | 5 |
| `couldMatch` false despite a common subtype | 27 | 15 |
| Disjoint pairs sharing a subtype; `couldMatch` asymmetries | 0 | 0 |

Full suite under the box lock: 3 failing tests, 0 changed snapshots (4,273).
The failures were old tuple/record subtype expectations, a diagnostic whose
expected type changed from `collection` to `collection | tuple`, and
`Map` rejecting a bare tuple. The original extrapolation of that rejection
to every generic collection operator was incorrect; see the corrected
validation diagnosis above.

`TupleFrom` over absent cells gained a type that held its result. A probed
record `Join` value matched its reported type both before and after; that
single example is not proof that every record-producing route is sound.

### B: two representation variants

F reduced `X<any>` to the bare name. N retained the composite form and made
it mutually subtype-related to the bare name.

Across 79 sampled types:

| Check | Baseline | B prototype |
| --- | --- | --- |
| Transitivity violations | 23 (8 through bare names) | 15 (0 through bare names) |
| `couldMatch` false despite a common subtype | 68 (31 through bare names) | 45 (8 involving `list<list>` vs `matrix<integer>`) |
| Disjointness violations; `couldMatch` asymmetries | 0 | 0 |

This reduced measured defects. It did not prove the relation correct.
In particular, the remaining record issue survives through explicit
`<unknown>` types, and some bare-name overlap misses remain.

| Full-suite result | F | N |
| --- | --- | --- |
| Failing tests | 267 | 237 |
| Failing inline snapshots | 18 | 18 |
| Originally classified as intended printing/type/default changes | 166 | 184 |
| Originally classified as acceptable diagnostics or wider results | 53 | 51 |
| Originally classified as regressions | 48 | 2 |

These are historical classifications, not acceptance criteria. Wider
results require a downstream compatibility review; they are not equivalent
to cosmetic diagnostic changes.

The two remaining N regressions were the Epsil corpus programs `horner` and
Euler 36, involving `Reverse` and overload inference. Under B,
`list<any>` and `indexed_collection<unknown>` are incomparable: the first
restricts kind, the second contents. The original note incorrectly called
the latter a strict subtype of the former.

The union of projected overload parameters no longer simplifies as before.
Test explicit `where T: any` bounds for appropriate operations and review
that projection before changing the global unbound-variable fallback.
Neither candidate fix was tested in this review.

F's additional regressions came from consumers expecting composite types,
including `parameterIndexReadType`, and declaration-placeholder detection.
N avoided those failures but left inference dependent on equivalent types'
representations. Rule 2 addresses the underlying distinction.

Other original observations:

- A bare-list assignment of `[1, Missing]` was already accepted; B made its
  value type a subtype of the bare collection contract.
- The sampled arithmetic, indexing, mapping, and compiled summation routes
  produced the same results. That demonstrates compatibility for those
  examples, not correct presence tracking.
- Explicit `list<unknown>` ceased normalizing to bare `list` and became a
  fixed element contract in the prototype.
- About 145–163 printed expectations changed. The B prototype touched
  eight core type files. Counts are estimates from those runs, not a work
  estimate for this broader design.

## Implementation boundaries and acceptance criteria

No code change follows merely from approval to edit this note. Resolve the
relevant questions before implementing their dependent behavior.

Suggested sequence:

1. Agree on the user-facing rules and the answers to Q1–Q5. Walk through
   the examples without implementation terminology. Record where an author
   must write an annotation or fallback and where inference suffices.
2. Correct independent validation defects using the current rules. Preserve
   the distinction between a verified bug and an unresolved policy choice.
3. Implement B separately from a global generic-default change. Keep the
   current unbound fallback initially; measure local overload fixes.
4. Separate declaration intent from type representation before relying on
   normalization or serialization of equivalent bare/explicit types.
5. Implement the selected absence and omission semantics with honest
   computed outcomes, element types, and lengths. Centralize shared rules
   instead of adding operator-specific exceptions.
6. Resolve or explicitly track record constraints and additional tuple
   precision. Broader family names must not conceal remaining relation gaps.
7. Review signatures, compiler assumptions, documentation, and migration
   effects; rerun the full suite and corpus against a recorded baseline.

Concrete checks for the design and its implementation:

- The five parameterized collection family names and their bare equivalents
  agree for `<any>` in subtype checks and element reads. Bare `tuple` and
  `record` cover their whole families; `tuple<any>` still has one slot.
  Explicit element constraints survive.
- A tuple source with absent slots works through the same documented
  parameter policy as a list source. Cover parse, box, and pre-boxed routes.
- A possible miss from `unknown` or `any` elements remains visible to
  analysis. Declaring or assigning a symbol does not erase known absence.
- `Any`/`All`, `Map`, `FlatMap`, and accessors report outcomes consistent
  with their values, including empty, all-absent, and nested cases.
- For the selected lazy model, indexing, iteration, count, display,
  compaction, `Zip`, `Sort`, `Ordering`, and reducers agree about positions.
  Include callbacks with effects and unknown or infinite counts.
- Type display and declaration serialization do not change inference
  instructions on a round trip. Include aliases and reassignment.
- Interpreter and compiled results preserve whole-value absence, absent
  cells, omission, and numeric markers at the correct nesting level.
- Audit broader result types for lost guarantees, especially numeric and
  values-only producers. Do not approve these as snapshot updates alone.
- Check transitivity and overlap with explicit as well as bare types;
  explain remaining counterexamples instead of using aggregate counts as
  a correctness claim.

Migration documentation must update the type guide, error model, API-trap
guidance, relevant inference and collection documentation, and changelog.
The bare-collection shape-check lint rule becomes obsolete under B; replace
its guidance with explicit values-only checks where those are intended.
Historical estimates of affected signatures and helper sites are starting
points for a fresh inventory, not exhaustive lists.
