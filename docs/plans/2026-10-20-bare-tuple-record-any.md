# Collection types, missing data, and omission

Status: revised design proposal, 2026-10-20. The user requested this revision
after reviewing options A and B and discussing `Missing` and `Nothing`.
User decision from the follow-up discussion: `unknown` is an inference
marker/placeholder, not a concrete type requiring a position in the lattice.
`value` and `expression` provide explicit content contracts. This separation
is agreed in principle; migration from the current implementation remains
to be designed.
User decision from the lazy-view discussion: choose R, retaining raw callback
results and their positions. `ListFrom(view)` constructs a materialized list
with `Nothing` omitted. Preserve inexpensive counts and direct indexing
where the source and operation support them.
Follow-up decisions: aggregating reducers skip `Nothing`; storing, passing,
or nesting a view does not implicitly compact it; data tuples retain their
positions, including `Nothing`. Explicit annotations excluding absence are
the user's current preference, not yet a final decision. Keep the current
open-record model. The user also wants a syntactic presence assertion;
postfix `?!` is a candidate, not yet a selected spelling. Record-field
omission and the default diagnostic policy for possible absence remain open.
User decision on numeric absence handling: treat `NaN` and `Indeterminate`
alike in `IsMissing`, `Coalesce` / `??`, and the proposed presence assertion.
Both trigger a fallback or fail the assertion. The first implementation
slice aligns `IsMissing` and `Coalesce` and corrects successful fallback
typing. The new assertion remains pending. This does not merge their
representations or change arithmetic evaluation.
User decisions on composition: bypass callbacks for `Nothing`; a chained
`Map` preserves that raw position as `Nothing`. Paired statistics skip the
whole observation when any participating coordinate is `Nothing`.
This document recommends a direction and identifies decisions still needed;
it does not authorize implementation or replace existing language rules.
The original filename is retained for existing links.

The [dual review](2026-10-20-collection-spec-review.md) is incorporated into
the rules, examples, migration requirements, and acceptance criteria below.
Its three additional semantic questions are callback delivery (Q9), paired
reductions (Q10), and repeated reads/captured state (Q11). The callback
bypass and whole-observation skip policies are now selected; remaining
recommendations are not decisions. The review report preserves the
findings and their disposition; this document holds the current proposal.

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
| `list<value>` | A list of data values; excludes immediate functions, symbolic expressions typed as `symbol` or `expression`, and immediate `missing`, `nothing`, and `error` |
| `list<expression>` | A list of data values, functions, or symbolic expressions; excludes immediate `missing`, `nothing`, and `error` |
| `list<unknown>` | Agreed intent: infer the element type; this is an inference request, not a fixed content contract (migration pending) |
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

The `value` and `expression` restrictions apply to the immediate elements.
They do not promise that no nested structure contains absence:
`list<list<missing>> <: list<value>` already holds because a list is itself
a value. Moreover, the named exclusions are not a guarantee of presence:
`nan <: number <: value <: expression`, so both `NaN` and exact
`Indeterminate` remain permitted numeric outcomes even though the agreed
absence predicate treats them as absent. `value` and `expression` exclude
the named types `missing`, `nothing`, and `error`, not every absent outcome.
Use the actual type names instead of the ambiguous phrase
“values only” when stating a contract.

`any` is the full top, not just an abbreviation for “values plus missing.”
It also admits `nothing` and `error` as types. This rule does not change
where construction erases `Nothing` or where evaluation propagates errors.

For developers: use a bare name when only the collection kind matters.
Write an element type when its contents matter. A bare name opts out of
element restrictions; a particular element type retains them.

### 2. Unknown requests inference; a content type states a contract

Recommended declaration behavior:

```text
xs: list := [1, 2]          infer integer elements; keep list as the contract
ys: list<any> := [1, 2]     keep the explicit unrestricted element contract
zs: list<expression>        require expressions, excluding missing/nothing/error
ds: list<value>             require data values, excluding functions/symbols
us: list<unknown>           explicitly ask to infer the element type
```

The first two annotations denote the same set of permitted collection
values. Their difference is the author's instruction to inference: one
omits an element annotation, the other supplies a content contract.
Explicit `unknown` requests inference too; it does not mean an explicit
contract excluding the named types `missing`, `nothing`, and `error`.

For example, the proposed rule infers `integer | missing` for the element
of `list<unknown> := [1, Missing]`. The same contents do not satisfy
`list<expression>`. Whether an assignment is refused immediately or checked
later remains part of Q1; inference must retain the absent possibility.

Store that instruction on the declaration, separately from the semantic
type. Do not infer it from whether an equivalent type is stored as a string
or a composite object. Type normalization, aliases, and caching must not
accidentally change a declaration's refinement behavior.

Separate display of a type from serialization of a declaration. A short
display may print equivalent types alike. A declaration serializer must
preserve whether the element annotation was omitted, so a round trip does
not turn `list<any>` into a different inference instruction. It must also
preserve an explicit request to infer through `unknown`.

This is a recommendation, not a settled declaration policy. An alternative
is to give all equivalent annotations identical refinement behavior. Choose
between them by how predictable assignment, reassignment, aliases, and
editor hovers are to users; see Q2 below.

#### Current subtyping and the agreed inference-marker role

The implemented relation currently includes:

```text
integer <: value <: expression <: unknown <: any
never <: every type
```

`unknown` is therefore a supertype of ordinary expression types today,
despite its intended role as “a type to be inferred.” It is not a sibling of
`expression` under `any`. Neither `any` nor the marker types `missing`,
`nothing`, and `error` are subtypes of `unknown`. The type guide documents
these current relationships, not the proposal.

Agreed rule: `unknown` means unfinished type information. It is a marker,
conceptually separate from the lattice of content contracts:

```text
Content types (intended model):      Inference information:
any                                unknown = infer a type here
├── error
├── nothing
├── missing
└── expression
    ├── symbol
    ├── function
    └── value

never is below every content type.
```

The implementation consequences still need design:

- Resolve it from assignments, function bodies, and other valid constraints.
  Do not give it an implicit “no absence” bound.
- Different `unknown` positions need not resolve to the same type. Use a
  named type variable such as `T` to state a relationship between positions.
- An unresolved type proves nothing about presence or the operations its
  value supports. Defer checking or report insufficient information when a
  guarantee is needed; do not assume the required type has been established.
- Use `any` for an unrestricted opaque external result, or `expression`
  when a contract excludes immediate `missing`, `nothing`, and `error`.
  An external result must not acquire a guaranteed type just because the
  caller wants that type.

No new top type excluding those named marker types is needed:
`expression` already includes data values, functions, and symbols. `value`
supplies a narrower data-only contract.

This is a separate change from B. Replacing the implemented top-like
`unknown` with inference variables requires a migration plan for subtype
queries, unresolved computed types, unions, and generic fallback behavior.
If a compatibility rule such as `unknown <: any` remains, it must not serve
as proof that an unresolved value satisfies another contract. Q8 records
the representation and migration decision, not whether `unknown` should
be a concrete content type.

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
- A read from `list<any>` can expose any element, including `Missing`;
  calling its result `unknown` must not hide that fact.
- A read from `list<expression>` that can miss needs
  `expression | missing`.
- A read from `list<unknown>` must retain a possible miss while its element
  type is inferred. Under the current lattice this can be represented by
  `unknown | missing`; under the proposed inference-marker model it must
  remain attached to the unresolved result and survive resolution.
- `Any` and `All` retain a possible `missing` result when predicate outcomes
  can leave the answer undecided. They cannot claim an unconditional
  `boolean` merely because their successful answers are booleans.
- A callback that returns `Missing` contributes `missing` to the result
  collection's element type. A callback that returns `Nothing` contributes
  `nothing` and retains one raw result and its position under the selected
  R model; `ListFrom` omits it, under rule 6.

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
- Use a checked presence assertion when absence should fail, rather than
  supplying an invented replacement. The existing expression
  `xs[i] ?? RuntimeError("expected-present")` has this runtime behavior,
  but its type derivation needs correction; see the discussion below.
- Pass through absence when the operation documents propagation.
- Filter absent elements explicitly when they should not participate.
- Expect a strict consumer to reject absence, either statically when
  established or at runtime if the check was deferred.

The interactive engine can defer uncertain checks while Epsil offers earlier
diagnostics. Their evaluation semantics must agree when both run the same
program. The exact diagnostic default for possibly absent arguments is Q3.

#### Presence checks must be usable before strict diagnostics become mandatory

The user is considering static rejection of possibly absent arguments, but
has not selected it. Requiring a fallback everywhere would force authors to
invent values even when absence is a violated precondition.

There are three distinct author intentions:

```text
f(xs[i] ?? "default")                         replace an absent datum
f(xs[i] ?? RuntimeError("expected-present"))   fail if the datum is absent
f(xs[2])                                     use an established guarantee
```

The assertion form evaluates the access once and fails only on the absent
branch. Its successful result should exclude the handled absence. It is a
runtime check, not an unchecked instruction to trust the programmer.
Postfix `!` is already factorial in Epsil; `xs[i]!` is not an assertion.
The user wants a syntactic shortcut for a presence assertion. Postfix `?!`
is the proposed spelling:

```text
f(xs[i]?!)       proposed: pass the datum, or fail if it is absent
xs[i] as integer
                possible separate cast syntax, not currently implemented
```

Neither form is currently accepted as an expression. The lexer scans maximal
operator runs: an isolated `?!` is recognized as a token, but the parser
gives it no assertion meaning. Adjacent runs such as `?!!`, `?!=`, and `?!-`
need separation under current spacing conventions or an explicit lexing
decision. U+2048 `⁈` already maps to `?!`; decide whether it is also an
assertion alias and cover these cases in parsing and serialization checks.
No implementation or final spelling has been authorized.

Recommended semantics for the shortcut:

- Evaluate its operand once. Return the present value unchanged; report
  an ordinary runtime error when absent. Existing errors propagate.
- Use the agreed absence predicate shared with `??` / `IsMissing`:
  `Missing`, `Undefined`, `NaN`, and `Indeterminate`. All four fail the
  assertion. `Nothing` is an omission marker, not missing data, and passes
  through. Including `Indeterminate` is a decided change from current
  exact-evaluation behavior.
- Supply presence evidence to analysis for the returned value. A compiler
  may remove the runtime check only if it already has a valid proof.
  This is a checked escape from conservative analysis, not an unchecked
  assertion that may silently pass an invalid value to a strict function.
- Check only this value, not its nested elements. Preserve every remaining
  type possibility using the `Present(T)` rule below; unresolved content
  still does not establish a concrete type just because it is present.
- Bind as a postfix assertion on the whole access, with explicit parser
  and serialization rules for chaining, calls, and factorial. Requiring
  the operator to abut the operand would follow the existing postfix style.

A future checked `as T` would answer a broader question: whether the value
conforms to `T`. For example, a present `1.5` passes a presence assertion
but fails an `integer` cast. A conversion that rounds `1.5` is different
again. Do not make the presence assertion depend on introducing general
cast syntax, and do not silently turn either checked form into a request
to bypass runtime contracts.

**Decision: uniform numeric absence handling.** Both `NaN` and
`Indeterminate` count as absent for `IsMissing`, trigger a fallback in
`Coalesce` / `??`, and fail the proposed presence assertion. This includes
results of arithmetic, not just out-of-range reads. Their representations
and arithmetic propagation remain distinct where they already are; this
decision concerns absence handling. It does not authorize changing exact
arithmetic results or mandate a helper name or a new shared predicate
implementation. `Mean([1, Indeterminate])` and `Max(1, Indeterminate)` must
preserve their current exact `Indeterminate` results; wrapping either in
`Coalesce(..., 5)` returns `5` under the selected observer semantics.

| Expression | Agreed result; checks and fallbacks implemented, assertion pending |
| --- | --- |
| `IsMissing(NaN)` / `IsMissing(Indeterminate)` | `True` in both cases |
| `NaN ?? 5` / `Indeterminate ?? 5` | `5` in both cases |
| `NaN?!` / `Indeterminate?!` | Runtime error in both cases; assertion spelling still proposed |
| `Nothing ?? 5` / `Nothing?!` | `Nothing` passes through; omission is not missing data |

The first implementation slice removes the exact/numeric difference in
these absence tests. It uses a separate observer predicate so existing
arithmetic, field omission, and tuple normalization do not change merely
because they share an older absence helper.

The first slice also corrects `Coalesce(x, RuntimeError(...))`: for
`x: string | missing`, its successful-result type is now `string`, rather
than `never`. A fallback that always fails does not erase successes from
an earlier operand. The existing runtime idiom still works, including
inside a typed function. Compiler support is separate: JavaScript currently
rejects `RuntimeError` rather than silently dropping the required failure.
Residual compiled absence checks also reject inputs whose types permit
`nothing`, because the current target representations cannot distinguish
it from missing data. Constant expressions can still fold before this check.
`Coalesce` handles numeric absence (`NaN`) too; it does not mean “remove
only a `missing` type arm,” and it does not skip `Nothing`.

Define `Present(T)` semantically as the outcomes of `T` for which the agreed
absence predicate is false. An assertion's successful outcomes are
`Present(T)`: `string | missing` becomes `string`,
`integer | nothing | missing` becomes `integer | nothing`, and `number`
becomes `number & !nan` (semantic notation, preserving infinities).
`Nothing` remains possible: `m[2]?!` can return `Nothing` and does not
promise numeric validity. For `Coalesce` operands of types `T1` through
`Tn`, a safe result type is the union of `Present(T1)` through
`Present(Tn-1)` and `Tn`; proven short-circuiting may narrow it further.
The final fallback can itself be absent; `never`
contributes no successful outcomes. The representation of `Undefined` in
analysis remains unresolved; this rule does not assume a named `undefined`
type or manufacture a concrete content type from unresolved `unknown`.

Static presence evidence already covers some useful cases:

| Read | Current information |
| --- | --- |
| `["a", "b"][2]` | `string`; the position exists |
| `xs[2]`, with `xs: list<string^3>` | `string`; the declared length proves the position exists |
| `xs[i]`, with `xs: list<string^3>` and `i: integer` | `string \| missing`; the index is not proved in range |
| `xs[2]`, with `xs: tuple<string, string \| missing>` | A present position can still hold a missing datum; bounds alone cannot prove the datum present |

Current literal-index reasoning is not general proof of bounds from
conditions or loop ranges. A future rule might use `1 <= i <= Length(xs)`
in a guarded branch, provided the index, collection, and relevant length
remain stable. It must not evaluate lazy callbacks just to prove presence.
Even perfect bounds checking cannot eliminate absence already allowed by
the element type.

Recommendation: provide reliable fallback, checked assertion, and basic
presence proofs before making possible absence a hard diagnostic by
default. A transitional warning with runtime checking is another option.
This sequencing recommendation does not settle Q3.

Retain the useful existing operation rules:

| Operation | Rule for `Missing` |
| --- | --- |
| Count positions, reverse, take, or zip | Preserve absent positions |
| Map | Apply the callback's absence policy; R retains each raw callback result, including `Nothing`, as one counted position |
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

The alternatives considered were:

| | L: expose logical elements | R: expose raw callback results |
| --- | --- | --- |
| What iteration yields | Only emitted elements; omit `Nothing` as the iterator advances | Every callback result, including `Nothing` |
| Count in the example | 1, once enough work has been done to determine it | 3 |
| Element information | Integer elements; output length may be unknown before evaluation | `integer \| nothing`; raw result count can remain 3 |
| Conversion to a list | Preserve elements and length | Explicitly compact results, removing `Nothing` and changing length |
| Developer explanation | “A lazy collection has the same elements when materialized” | “This view records results; collecting it omits the no-result entries” |

**Decision: R.** A lazy view retains its callback results, including
`Nothing`, in their original positions; each counts as one raw result.
`ListFrom(view)` evaluates the view
into a list and omits `Nothing`. `Missing` retains its position in both.
Materialization plus omission is an explicit transformation, not merely a
different storage representation of the same sequence.

The reason is predictable cost and developer control. A one-result-per-input
`Map` can retain the source count without running callbacks solely to count.
It can compute an indexed result directly when the source supports that
access. This does not promise constant-time counting or indexing for every
view: `Filter`, `Scan`, or an uncounted source can still require traversal.

L would require evaluating results to discover which positions survive.
It need not retain all earlier results in memory, but counting may require
a full traversal and indexed access may require earlier evaluations. The
cost and possible callback effects motivated the choice of R.

R requires a semantic distinction for raw views, whether represented by a
separate type or another explicit capability. A raw view exposing `Nothing`
cannot claim `vector<integer^3>`. `ListFrom` removes `nothing` from the
element type and drops or recomputes the exact length. An unbounded view
needs a finite bound before it can be fully materialized.

**Decided consumer rules, implementation pending:**

- Aggregating reducers skip immediate `Nothing` results. In the example,
  `Sum(m) = 1` and `Mean(m) = 1`, while `Length(m) = 3`. The mean's
  denominator counts participating results, not raw positions. An all-omitted
  input follows the reducer's ordinary empty-input rule. Skipping can happen
  during traversal without constructing an intermediate list. This does not
  make `Missing` skippable or recursively remove markers inside data values.
- Storing a view, passing it to a function, or nesting it in `[view]` does
  not implicitly compact it. `[view]` contains one view; `ListFrom(view)`
  explicitly materializes its results and omits `Nothing`. This changes
  current paths that materialize finite lazy collections on assignment.
- Data tuples preserve their slots: `(Nothing, 8)` is a two-slot tuple.
  `Zip` therefore retains coordinate alignment. An ordinary computed
  argument similarly must not disappear and shift later arguments:
  `f(Nothing, 8)` passes two arguments, and the first parameter must
  accept, handle, or reject `Nothing`.
- Preserve `Missing` positions while removing `Nothing`; never use one as
  an implementation substitute for the other.
- Do not evaluate an effectful callback twice just to determine a count.
  Unknown counts and unevaluated expressions remain legitimate.
- Interpreter, compiled execution, and serialization must preserve the
  selected sequence semantics. A debug preview of raw results should be
  identified as a preview, not serialized as an equivalent ordinary list.

The user's suggested mnemonic is “Nothing is skipped in a sequence, but
preserved otherwise.” Qualify “sequence”: a raw view is itself iterable,
yet retains `Nothing`. The more precise rule is:

> List construction and aggregating reduction skip `Nothing`. Raw
> views and fixed slots preserve it. Merely iterating does not erase it.

Thus `[1, Nothing, 3]` constructs `[1, 3]`, `(1, Nothing, 3)` retains three
slots, and an iterator over the raw mapped results still yields `Nothing`.
`Length` counts raw positions; it is not a count of contributions to a sum
or mean. A reducer's deliberate skip policy does not alter the source.

#### Construction and consumption boundaries

The boundary inventory is deliberately narrower than “all sequence operations”:

| Boundary or consumer | `Nothing` policy |
| --- | --- |
| Raw `Map`, indexing, count, iteration | Decided: retain each raw result and position; count it once |
| Chained `Map` callback | Decided: bypass an input `Nothing`, retaining `Nothing` at that raw position |
| `List` / `ListFrom` construction | Decided: omit immediate `Nothing` |
| Data tuple / ordinary argument | Decided: retain the slot; parameter handling is separate |
| Aggregating reducers | Implemented for the numeric families listed below: skip immediate `Nothing`; `Mean` counts participating results |
| Paired statistics (`Covariance`, `Correlation`) | Decided: skip the whole observation if any participating coordinate is `Nothing`; never compact inputs independently |
| `Append`, `Insert`, `Join`, `Flatten` | Unclassified; specify boundaries and representation before implementation |
| `SetFrom`, `TupleFrom`, `DictionaryFrom`, other structural conversions | Unclassified or dependent on the chosen representation and record policy |
| `Sort`, `Ordering`, custom `Fold` / `Reduce` | Unclassified; raw retention alone does not select their handling |

Implemented numeric-aggregate inventory:

| Operators | Handling of a raw `Nothing` datum |
| --- | --- |
| `Sum`, `Product` | Skip it; no retained data gives the ordinary identities `0` and `1` |
| `Min`, `Max`, `Infimum`, `Supremum` | Skip it while traversing their numeric data; all-omitted input uses their ordinary empty-input result |
| `Mean`, `Median`, `Variance`, `PopulationVariance`, `StandardDeviation`, `PopulationStandardDeviation`, `Kurtosis`, `Skewness`, `Mode`, `Quartiles`, `InterquartileRange` | Skip immediate omitted data; all calculations and sample sizes use retained data; all-omitted input follows each operator's ordinary empty-input rule |

These operations do not compact or change the source. A statistic does not
silently remove an entire nested datum because it contains a marker: its
existing rules for nested collections still apply. `Missing`, numeric absence,
and errors retain their existing handling. `Product(collection)` is currently
represented as a seeded `Multiply` reduction; this does not select a new policy
for custom folds. Compilation refuses omission-capable sources until the target
can preserve omission distinctly or safely implement it at the aggregate.
`Histogram` and `BinCounts` are separate binning operations; their policies are
not changed by this numeric-reducer slice. `Total` is not a registered operator
in the current library; the sum operation is `Sum`.

The inventory must be completed for affected operators before their
implementation changes. If a custom fold always skips
`Nothing`, it cannot observe every raw result; distinguish that aggregate
API from any raw-result fold/visitor. An explicit lazy omission adapter may
still be useful for composition, but is not required just to sum a view.

#### Callback delivery and strict parameters (Q9)

**Decided: bypass `Nothing`.** `Map` and `Filter` do not invoke their
callbacks for an input `Nothing`. For `Map`, that position remains
`Nothing` in the output:

```text
m = Map(x ↦ If(x > 1, Nothing, x), [1, 2, 3])
Map(x ↦ x * 2, m)
```

The inner view exposes `1, Nothing, Nothing`. The outer callback receives
only `1`, producing raw results `2, Nothing, Nothing`. Its raw length is
still 3; `ListFrom` produces `[2]`. During one uncached traversal, the outer
callback runs once. It cannot observe or replace the two omitted results,
even if it accepts `nothing`, and its effects do not run at those positions.
Repeated-read and cache behavior remains Q11.

In plain language: **skip the callback, keep the position**. This applies
only when the input itself is `Nothing`; it does not inspect nested values
or make `Missing` skippable. A callback can itself return `Nothing`, which
also remains a raw result until an explicit omission boundary.

Callback input validation and inference must account for bypass: an input
element type `integer | nothing` does not require this `Map` callback to
accept `nothing`. The output type must still include `nothing` when an
input may be bypassed or the callback may return it.

Separately, recommend that an ordinary strict parameter excluding `nothing`
reject it, unless the function has an explicit handling policy. Merely
retaining the argument slot does not make `Nothing` satisfy `integer`.
This ordinary-parameter recommendation remains open; callback bypass does
not make a direct call such as `f(Nothing, 8)` omit an argument or bypass
the function.

**Decided: `Filter` drops immediate `Nothing` inputs without calling the
predicate.** Filtering the raw view `1, Nothing, 3` with `x ↦ True` produces
`1, 3`; the predicate runs twice during one uncached traversal. Its result
element type excludes immediate `nothing`, while retaining any nested marker.
`Missing` still reaches the predicate and follows its ordinary contract.
`Count(source, predicate)` uses the same selection rule as counting the
corresponding filtered view.

In plain language: **`Map` skips the callback and keeps the position;
`Filter` skips the predicate and drops the element.** A filter already changes
cardinality, so it does not promise source alignment. Counting or indexing it
may scan the source. Omitted inputs count toward the existing bound on an
unbroken run of rejected inputs, so an infinite omitted source cannot hang a
consumer. Structural `Take` and `Zip` preserve positions and alignment without
invoking a user callback; they keep their separate rules.

#### Paired reductions (Q10)

**Decided: skip the whole observation.** For paired statistics such as
`Covariance` and `Correlation`, if any participating coordinate is
`Nothing`, that observation contributes to none of the calculation.
For example, raw inputs expose these aligned positions:

```text
left:   1, Nothing, 3
right: 10,      20, 30
```

Consume `(1, 10)` and `(3, 30)`; skip `(Nothing, 20)` entirely. All means,
counts, variances, and other terms used by the paired statistic must use
these same retained observations. Do not compute marginal means from
different subsets. Compacting each input independently is invalid: it must
never pair `3` with `20`. The source views retain their raw positions.

The decision settles paired statistics. `Dot` and custom `Fold` / `Reduce`
retain their separately identified scope questions; this does not silently
classify every multi-input operation as a paired statistic.
`Missing` retains its propagation policy, and an all-omitted
input follows the operation's empty-input rule. This does not reopen the
decided denominator rule for `Mean`.

#### Repeated reads and captured state (Q11)

**Open.** R and the ban on implicit compaction do not determine the number
of callback executions:

```text
m = Map(effectfulCallback, xs)
m[2]
m[2]
Sum(m)
```

Three independent choices must be recorded:

| Question | Options and consequences |
| --- | --- |
| Is a demanded result retained? | Reevaluation avoids a result cache but repeats work/effects; demand caching retains results at a memory cost |
| Are effectful callbacks allowed? | Allowing them makes demand order observable; requiring pure callbacks restricts which functions can form views |
| When are source and captured bindings observed? | Live bindings observe later changes; capturing a snapshot stabilizes inputs but needs a defined capture boundary and may copy state |

The [Q11 investigation](2026-10-20-lazy-view-read-capture-probes.md) checked
the existing behavior with isolated probes and 120 passing focused tests.
It found two existing regimes: some effectful callbacks rerun on each
consumption, while eligible complete traversals are cached, including
random results. Direct indexing need not fill a prefix. Current language
assignment sometimes materializes a view to preserve its inputs; nesting
in a list or tuple can also materialize it. These are migration concerns,
not the selected behavior under R.

**Revised recommendation, not yet a decision:** preserve the existing
effect and cache rules where compatible with R. Do not introduce a blanket
purity requirement or promise that every position is evaluated exactly
once. Explicit `ListFrom` is the way to obtain a materialized sequence
snapshot, with the already-selected omission of `Nothing`. Existing random
view caches remain useful, but are conditional and invalidatable; they are
not equivalent to an explicit snapshot.

For language assignment, preserve the intent that stored computations keep
their input bindings, but capture those bindings without enumerating the
view. For example, after `offset = 10; m = Map(x ↦ x + offset, [1, 2]);
offset = 20`, recommend `m[1] = 11`. A live-binding alternative returns
`21`. Either can be specified coherently, but simply removing today's
materialization would change existing results and can break
`xs = Map(f, xs)`. Passing and escaping a scope must also preserve the
appropriate bindings without compacting the view.

This capture recommendation is not a deep copy of mutable objects and is
not a proposal to freeze every variable an effectful callback may access.
The scope of capture, including mutable objects and callbacks with explicit
access to enclosing state, still needs a decision. Keep the existing live
host `ce.assign()` behavior separate from language assignment unless an
explicit API change is chosen. A pure/repeatable view contract remains an
alternative; purity alone does not determine capture timing.

For effectful callbacks, the selected policy must state how many calls the
example makes and when. Regardless of that policy, `Length(m)` must not
evaluate callbacks solely to compact or count this one-result-per-input
view. Snapshot capture must not silently restore full materialization on
assignment.

#### Record and dictionary construction

For records, the user leans toward omitting a field whose
value is `Missing`, replacing the existing `Nothing` omission rule:
`{a -> missing, b -> 3}` would construct `{b -> 3}`, while a `Nothing` field
would be retained. This is the current direction under discussion, not a
final decision. It distinguishes positional absence (retain the slot)
from keyed absence (omit the key). It replaces the earlier recommendation
to retain both kinds of marker in named fields.

Two details must be explicit before adopting it. First, a required key
whose type includes `missing` is not the same as an optional key: omitting
the key cannot satisfy a contract requiring it. Second, omitting the marker
`Missing` (including a computed result) is different from omitting every
value accepted by `IsMissing`.
Recommendation: only `Missing` requests field omission; numeric `NaN` and
`Indeterminate` remain stored results even though they trigger absence
handling. Otherwise arithmetic can silently remove a field. Neither this
recommendation nor optional-field syntax is selected yet.

For `f(x): integer | missing`, `{a -> f(x)}` cannot promise a required
`a` after conditional omission. Possible future approaches are an optional
or conditional shape, or a conservative type that promises only guaranteed
fields; no optional-field syntax is selected here. The current numeric
`NaN`-to-`Missing` repair in `validate.ts` (around lines 1410–1444) applies
to nested Lists, not dictionaries or records. Do not describe it as an
existing dictionary bug or broaden that repair into field omission.

Current dictionary behavior differs from that candidate:

```text
{a -> nothing, b -> 3}     currently constructs {b -> 3}
```

Both literal `Nothing` and a value that evaluates to `Nothing` are omitted
when the dictionary is constructed/reconstructed. Keeping a named field
whose value is `Nothing` would therefore change construction semantics.
The decision to retain open record types does not settle this omission rule.

An existing way to remove a key from an existing dictionary is to filter
its key/value entries and construct a replacement:

```text
let d = {a -> 1, b -> 3}
DictionaryFrom(Filter(d, entry => entry[1] != "a"))   // {b -> 3}
```

This was verified through Epsil. It returns a new dictionary; it does not
mutate `d`. `DeleteAt(d, "a")` is not supported: `DeleteAt` takes integer
indices into indexed collections. Assigning `nothing` to `d["a"]` is not
an implemented deletion operation either.

Recommendation: provide an explicit key-removal operation, independently
of the field-value omission decision. A name such as `DeleteKey(d, "a")`
is illustrative, not selected or implemented. It should return a new
dictionary without that key and leave the contents unchanged if the key
was already absent. Removing a required record field changes the result's
contract; it cannot still claim that field exists.

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

For an assertion, compilation must preserve the required runtime failure
or fail compilation unless proof eliminates the check. This is a
capability requirement, not a permanent ban on any compiler or a selected
JavaScript error lowering. Never silently replace a failed assertion with
`NaN`. Raw `Nothing` likewise requires a distinct representation or sound
fusion at an explicit omission boundary; otherwise reject compilation.
`NaN` cannot stand for `Nothing`.

## Decisions still needed

| Question | Recommended direction | What remains to choose |
| --- | --- | --- |
| Q1. What does `x: T` promise about presence? | User leans toward explicit data annotations excluding absence unless permitted by `T`; not final | Confirm strict assignment contracts versus successful-value contracts with tracked presence; keep inferred absence and numeric marker policy distinct |
| Q2. How are inference requests expressed? | Omitted element annotations and explicit `unknown` request inference; `value`, `expression`, and `any` state content contracts | Specify aliases, reassignment, hovers, and declaration round trips independently of type representation |
| Q3. When is possible absence a diagnostic? | A syntactic presence assertion is requested; checks/fallbacks treat `NaN` and `Indeterminate` alike and the failing-fallback idiom's type is corrected | Select assertion spelling; choose diagnostic default, specify supported presence proofs, and implement assertion compilation |
| Q4. What does a lazy collection expose? | Decided: R, raw callback results; `ListFrom` materializes and omits `Nothing` | Implement honest element and length information; remaining consumer and conversion policies are Q5 |
| Q5. Where does `Nothing` erase? | Decided: aggregates skip it, no implicit view compaction, data tuples/ordinary arguments preserve slots | Record fields, boundary inventory, custom folds, ordering operations, serialization, and whether a distinct unit value is needed remain open; callback and paired-consumer policies are Q9–Q10 |
| Q6. What do unspecified record fields promise? | Decided: retain current open records and width subtyping | Make enumeration and dictionary relationships respect unconstrained extra fields; no closed-record syntax required for this work |
| Q7. How should unbound generic variables behave? | Keep the current fallback initially; bind from actual arguments normally | Test local explicit `where T: any` bounds and overload inference before considering a global fallback change |
| Q8. How should the agreed inference-marker role of `unknown` be implemented? | The role is decided: it is a placeholder, not a concrete content type | Decide unresolved-type representation, subtype API behavior, bounds, and migration from the current lattice; inventory library signatures and classify inference requests versus explicit content contracts or named generics; coordinate with Q7 |
| Q9. How do strict parameters and chained callbacks handle `Nothing`? | Decided: bypass callbacks for `Nothing`; `Map` preserves the raw position | `Map` preserves omitted positions; `Filter` drops them; callback bypass and immediate omission typing implemented for both; ordinary strict parameter contracts remain separate |
| Q10. How do paired reductions handle an omitted coordinate? | Decided: skip the whole observation for paired statistics; preserve alignment and use one shared set of observations | Paired statistics implemented; decide `Dot` and custom `Fold`/`Reduce` separately |
| Q11. What do repeated view reads observe? | UNDECIDED recommendation after probes: preserve existing effect/cache rules; retain input bindings without eager enumeration on language assignment | Confirm binding capture versus live reassignment; define capture scope for mutable objects and effectful callbacks; do not promise exactly-once evaluation or impose new purity restrictions incidentally |

Two inherited conventions also need explicit compatibility checks:

- Implemented for data tuples and `Zip`: `Nothing` retains its slot, and a
  tuple whose coordinates are all absent remains a present tuple. Mathematical
  point arithmetic still propagates a missing whole point; the constructor
  does not collapse an explicitly rebuilt tuple. Tuple slot types preserve
  `nothing`. Compilation declines omission-capable construction/zip until
  targets can distinguish `Nothing`. `TupleFrom` keeps its prior omission
  behavior until structural conversions are classified; ordinary argument
  retention and Q11 remain separate. The legacy empty-tuple type still reduces
  to `nothing`, pending the unit/empty-tuple representation decision.
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

### Open records require conservative treatment of extra fields

Current `RecordType` has a field map, with no exact/open flag or remainder
type. Both its documented contract and `isSubtype` allow additional fields.
Tests explicitly rely on width subtyping. The parser rejects illustrative
rest forms such as `record{a: integer, ...}`. A record value having a fixed
set of keys does not mean its structural type requires exactly those keys.
Thus closed-by-default records with opt-in openness would be a language
change, not documentation of existing behavior.

**Decision: retain the current open-record model.** An annotation promises
the named fields and permits additional fields. This settles openness,
but not whether `Nothing` removes a field during construction. It also
does not preserve unsound claims about the types of unspecified fields.

These are current-lattice observations, not proposed content contracts for
the inference marker `unknown`:

```text
record{a: integer, b: missing} <: record{a: integer}
record{a: integer}            <: dictionary<unknown>
record{a: integer, b: missing} is not <: dictionary<unknown>
```

The first relation permits additional fields. The second assumes every
field excludes the named marker types under the current lattice. Those
assumptions are incompatible: saying that field `a` is an integer says
nothing about another field `b`.

B removes paths through the old bare names; it does not repair this example
through explicit types. The same decision affects the inferred type of
enumerating all values of an open record. Under the selected open-record
model, reading the known field `a` can promise an integer; enumerating all
fields cannot promise only integers or exclude the named marker types.
Without additional evidence or constraints, the dictionary relationship
must allow unrestricted extra values.

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
Euler 36, involving `Reverse` and overload inference. In that historical
B prototype with the then-current lattice,
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
  fixed element contract in the prototype. That historical behavior is
  superseded by this note's recommendation to use `list<expression>` for
  that content restriction and `list<unknown>` to request inference.
- About 145–163 printed expectations changed. The B prototype touched
  eight core type files. Counts are estimates from those runs, not a work
  estimate for this broader design.

## Implementation boundaries and acceptance criteria

No code change follows merely from approval to edit this note. Resolve the
relevant questions before implementing their dependent behavior.

These are implementation steps, not independent public releases. Each
exposed phase must describe its actual user-facing semantics honestly and
make dependent promises only when they are supported.

Suggested sequence:

1. Agree on the user-facing rules and the answers to Q1–Q5. Walk through
   the examples without implementation terminology. Record where an author
   must write an annotation or fallback and where inference suffices. Resolve
   the remaining Q9–Q11 details before implementing their dependent
   consumers or view behavior.
2. First slice implemented: align `IsMissing` and `Coalesce` for
   `NaN`/`Indeterminate` and correct successful-result typing for a failing
   fallback. Next add the checked assertion once its spelling is
   selected. Cover parsing, typing, interpreter and compiled behavior, and
   serialization. Establish this usable assertion before requiring authors
   to discharge uncertain presence statically.
3. Correct independent validation defects using the current rules. Preserve
   the distinction between a verified bug and an unresolved policy choice.
4. Implement B separately from a global generic-default change. Keep the
   current unbound fallback initially; measure local overload fixes.
5. Separate declaration intent from type representation before relying on
   normalization or serialization of equivalent bare/explicit types. Plan
   the Q8 migration separately; B alone does not change the role of
   `unknown` in the implemented subtype relation. Inventory library signature
   uses of `unknown` and decide which request inference and which need an
   explicit content type or named generic; Q8 does not yet select migration
   policy.
6. Implement the remaining selected absence and omission semantics with honest
   computed outcomes, element types, and lengths. Centralize shared rules
   instead of adding operator-specific exceptions.
7. Resolve or explicitly track record constraints and additional tuple
   precision. Broader family names must not conceal remaining relation gaps.
8. Review signatures, compiler assumptions, documentation, and migration
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
- For Q9, a chained `Map` bypasses source `Nothing` results and preserves
  their positions. Verify bypass even when the callback accepts `nothing`,
  no callback effects at those positions, and acceptance of a callback
  whose strict input type excludes `nothing`. Retain possible `nothing`
  in the result type. `Filter` bypasses its predicate and drops immediate
  omissions; cover iteration, count, indexing, membership, empty results, and
  bounded rejected-input scans. Cover ordinary calls separately.
- For Q10, use differently located `Nothing` results in aligned inputs.
  Verify that no independent compaction shifts pairs, that every term of
  the paired statistic uses the same retained observations, and that an
  all-omitted input follows the operation's empty-input behavior.
- For Q11, cover repeated indexing followed by reduction, changes to a
  captured binding between reads, and callback effects. Pin the selected
  evaluation/cache/capture policy without introducing callback evaluation
  just to determine a raw count. Include literal and variable sources,
  assignment, self-reassignment, nesting, argument passing, and scope exit.
  Preserve raw `Nothing` positions in caches. Cover partial and complete
  random-view reads, dependency invalidation, and the cache-size boundary;
  distinguish existing conditional caching from an explicit snapshot.
- If field omission is adopted, construct a field whose computed value is
  sometimes `Missing`. Verify actual key presence, required-field checks,
  and the reported shape; a possible omitted key must not be typed as
  unconditionally required.
- Type display and declaration serialization do not change inference
  instructions on a round trip. Include aliases and reassignment.
- Under the proposed inference-marker model, `list<unknown>` can infer
  `missing` elements, while `list<expression>` excludes immediate `missing`,
  `nothing`, and `error` but still permits numeric absence. No unresolved
  type is used as evidence of presence or of a concrete runtime type.
- Interpreter and compiled results preserve whole-value absence, absent
  cells, omission, and numeric markers at the correct nesting level.
- Assert `string | missing` to `string`, preserve `nothing` in
  `integer | nothing | missing`, and narrow `number` to present numeric
  outcomes while preserving infinities. Check `Coalesce` with an absent
  final fallback and with `never`, and retain unresolved content information.
- Preserve exact `Indeterminate` for `Mean([1, Indeterminate])` and
  `Max(1, Indeterminate)`; `Coalesce` of either result with `5` yields `5`.
- A compiler either implements assertion failure exactly, proves it
  unnecessary, or rejects compilation; it never substitutes `NaN`. Raw
  `Nothing` stays distinct or is soundly fused at an explicit omission
  boundary; unsupported lowering rejects compilation.
- Cover isolated `?!`, adjacent `?!!` / `?!=` / `?!-`, spacing, and `⁈`
  according to the eventual spelling and alias decision.
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
