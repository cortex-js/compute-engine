# Strings Phase 3 — Regular expressions

**Spec (system of record):** `docs/STRING_ROADMAP.md` — "Regular Expressions
(Phase 3 sketch)" and the Phase 3 entry under "Phases". This document is the
IMPLEMENTATION plan: it fixes the decisions the spec left open, decomposes the
work, and lists acceptance tests. Where this plan and the spec disagree, the
spec wins; "Decisions taken here" names each place the plan resolves something
the spec did not.

**Status: SHIPPED 2026-08-17.** All workstreams landed; deviations from the
plan as written are recorded in "Deviations" at the end. Plan written
2026-08-17. Phase 1 (character type,
string-as-collection) and Phase 2 (`Join`/`StringJoin` roles, sequence search,
string operations) are shipped and committed
(`docs/plans/2026-08-16-string-phase1-character-type.md`,
`docs/plans/2026-08-16-string-phase2-join-search-ops.md`).

**D2 was RULED on 2026-08-17 (native regex, no caps, no limitations); the phase is unblocked.** The paragraph below is kept as the record of what was decided and why.

**~~This plan has a BLOCKING ruling (D2).~~** The spec itself gates the phase on
it: "Before Phase 3 lands, pick one". D2 decides the regex dialect and the
resource-safety story together, because they are the same decision, and it
determines how large the phase is — from roughly a week's work to roughly
three. Nothing below D2 can be implemented until it is answered, because the
dialect decides what `RegExp` accepts, what the operators mean, and what the
compiled code emits. D1 and D3–D5 are written so they hold under either
answer.

---

## What Phase 3 delivers (from the spec)

1. A raw string literal for patterns, avoiding double-escaping:
   `RegExp(#"[0-9]+(\.[0-9]+)?"#)`.
2. A `regexp` value type, with a deliberately small API.
3. `IsMatch`, `StringMatch` (first match, with capture groups; named groups as
   a dictionary), `StringMatchAll`.
4. Regex overloads of `StringReplace` (including function replacements) and
   `StringSplit`.
5. Code-point-aware matching (the `v`/`u` flag family, per the spec).
6. A resource-safety story, and the timeout/error result the caller sees.

---

## What the ground already gives us (verified 2026-08-17)

Three findings change the shape of this phase, all confirmed against source:

- **The raw literal already exists.** `src/epsil/lexer.ts` `scanHash()`
  (:627-652) recognizes one-or-more `#` followed by `"` and hands off to
  `scanExtendedString()` (:658-695), which performs NO escape processing and
  closes on `"` plus a matching count of `#` — precisely the Swift form the
  spec sketches, already emitted as a `STRING` token. A multi-line `"""…"""`
  form with indentation stripping exists alongside it (:794+). **Deliverable 1
  needs no lexer work at all**; `RegExp(#"[0-9]+"#)` parses today, and
  `RegExp` receives an ordinary `string`. This also means the pattern reaches
  `RegExp` as a plain string with no marker distinguishing it from a computed
  one — see D4.
- **Regex is greenfield.** No user-facing regex operator exists. Every
  `RegExp` occurrence in `src/` is internal machinery (the LaTeX tokenizer's
  sticky-regex cache, identifier classification in `math-json/symbols.ts`,
  the GPU target's source scanning, number serialization). `Match`
  (`library/control-structures.ts:539`) is Epsil STRUCTURAL pattern matching
  over expressions, unrelated to text; the name collision is worth avoiding in
  the new surface (D5).
- **A synchronous host regex cannot be interrupted.** `docs/TIMEOUT-MODEL.md`
  is explicit that a deadline is armed only by entering a `withTimeLimit`
  span, that `checkDeadline()` is cooperative polling at instrumented sites
  (~90 of them), and that async/`AbortSignal` reaches only four handlers
  (`Loop`, `Factorial`, `Product`, `Sum`). A regex operator's `evaluate`
  handler is an ordinary synchronous handler, so `checkDeadline` can fire
  BETWEEN steps but never inside one `RegExp.exec()`. **No amount of span
  discipline bounds a catastrophically backtracking match.** This is what
  makes D2 a real fork rather than a preference.

---

## Decisions taken here

### D1. The `regexp` type is a new SCALAR primitive

`regexp` joins `SCALAR_TYPES` in `src/common/type/primitive.ts` and the
`PrimitiveType` union in `src/common/type/types.ts`, with a `[]` entry in
`PRIMITIVE_SUBTYPES` (`src/common/type/subtype.ts`). It is a disjoint sibling
of `string`, exactly as `character` is: a pattern is not text, and
`IsMatch(s, p)` wants the two apart in the signature.

It has **no hidden element type**. That matters more than it sounds: the
hidden-element machinery is where the primitive-type checklist keeps its traps
(`walkPattern`, without which type variables silently bind `any`;
`mapResultType`, without which `Map` over the value rebuilds with the wrong
head; `liftedElementTypeOf`; `isMappedActual`). A `regexp` is not a
collection, so none of those sites apply and the checklist reduces to its
three declaration sites plus the verification order.

The one checklist item that DOES apply is the narrowing-lie check: a new type
can turn an existing `(T) -> T` signature into a lie. `regexp` is not a
collection and not a number, so it cannot bind the kind-preserving collection
signatures that bit `range`/`string`/`character` in Phase 0. To be confirmed
by a census in WS-A rather than asserted here.

Release-note obligation (checklist items 7–8): `regexp` is a PRIMITIVE, a bare
string in the type AST with no `.kind`, and consumers that switch on `.kind`
must be told by name.

### D2. Dialect and resource safety — **RULED 2026-08-17: native regex, no caps, no dialect restrictions**

The user's ruling: use the host's regular-expression engine directly, with no
input-size cap, no pattern-complexity cap, and no feature subset. Option (a)
from the ruling section below, minus the caps I had recommended alongside it.

What that settles:

- **Dialect is JavaScript's**, documented as such. Backreferences, lookahead
  and lookbehind all work. Compiled JavaScript emits the host `RegExp`, so the
  interpreter and compiled code agree by construction — the parity trap is
  closed for free, which is the main thing this buys.
- **Python stays fail-closed** (D7), now for a second reason: `re` diverges
  from JS on `v`-mode set operations and some lookbehind, so a lowering would
  silently change semantics.
- **Catastrophic backtracking is a documented property, not a guarded one.**
  `RegExp(#"(a+)+$"#)` against a 30-character non-matching subject explores on
  the order of 2³⁰ paths, and the engine cannot interrupt it: deadlines are
  cooperative polling between evaluation steps (`docs/TIMEOUT-MODEL.md`) and
  one `RegExp.exec()` is a single step. There is no timeout, abort signal or
  span that bounds it. This is a property of the ruling and belongs in the
  user-facing docs next to `RegExp`, stated plainly, so a caller writing a
  pattern against untrusted input knows what they are choosing.

I recommended the caps and was overruled; recording that here so the reasoning
is not re-litigated later, and so the docs obligation above is not mistaken
for a leftover concern. The one thing this changes downstream: D6 (grapheme-
cluster offsets) now costs a per-match translation on every call, since a host
regex indexes by code unit.

### D3. `RegExp(pattern, flags?)` is the only constructor

One constructor, `RegExp(pattern: string, flags: string?) -> regexp`, rather
than a literal syntax of its own. Rationale: the raw-string literal already
carries the ergonomics (`RegExp(#"\d+"#)`), and a dedicated `/…/` literal
would collide with division in every surface the engine parses. `flags` is a
string of single letters, validated at construction; the code-point-aware flag
is implied and not spellable (the spec requires it always).

An invalid pattern is an ERROR VALUE, not a throw, matching `NumberFrom`'s
Phase 2 contract for unparseable input. A `regexp` built from a literal
pattern is validated at CANONICALIZATION so the error surfaces at parse time;
a computed pattern is validated at evaluation.

### D4. Literal vs. computed patterns are distinguished by operand shape only

`RegExp` receives a plain `string`; the raw-literal token leaves no marker.
The engine therefore treats "literal pattern" as "the operand is a string
LITERAL at canonicalization", the same test the compile targets already use to
decide domain errors at compile time versus runtime (the `StringReplace`
precedent in `javascript-target.ts`, and the #2a ruling from Phase 2). This is
observable: a pattern that is invalid gets a canonicalization-time error when
written literally and an evaluation-time error when assembled at runtime.

### D5. Operator names avoid the existing `Match`

`Match` is taken by Epsil structural pattern matching
(`library/control-structures.ts:539`) and must not be overloaded with text
semantics — the two have unrelated argument types and unrelated failure
modes, and a shared name would make the diagnostics unreadable. The spec's
names are already clear of it: `IsMatch`, `StringMatch`, `StringMatchAll`.
Keep them exactly.

Result shapes:

- `IsMatch(s: string, p: regexp) -> boolean`.
- `StringMatch(s, p) -> record | nothing` — `Nothing` when there is no match,
  so the Phase 2 `Slice(xs, RangeOf(…))` precedent for a `| nothing` arm
  applies (and with it the `isCollection`-handler requirement that a
  `| nothing` result type carries — see the Phase 2 trap list).
- `StringMatchAll(s, p) -> list<record>`, lazy.

The match record carries the matched text, its `range` (reusing the Phase 0
`range` type, so `Slice(s, m.range)` composes), and captures — numbered and
named. Exact field names are WS-B's, pinned by tests.

### D6. Offsets are GRAPHEME-CLUSTER indices, not code-unit indices

Every string operator shipped in Phases 1 and 2 indexes by grapheme cluster;
`Length("é")` is 1 whatever its normalization. A regex operator that returned
JS code-unit offsets would be the only string operator in the library that
does not, and `Slice(s, m.range)` — the composition the `range` field exists
for — would silently cut into the middle of a cluster. Offsets are therefore
translated to cluster indices at the boundary.

This is a real cost, not a formality: the translation is a walk, and it is the
main reason the compiled lowering cannot be a bare host `RegExp` call even on
the JS target. It also interacts with D2: a matcher that operates on clusters
natively pays nothing here, a host regex pays a per-match translation.

### D7. Python and the GPU targets fail closed

Consistent with the Phase 2 policy the research confirmed: `StringReplace`,
`StringSplit`, `StringCompare`, `StartsWith`/`EndsWith` are simply ABSENT from
the Python operator table and fall through to
`BaseCompiler.noLoweringMessage()` (`base-compiler.ts:5102-5134`, "the
operator is known to the engine but target '<lang>' has no lowering for it.
Fail closed (D6)"). The regex surface inherits that: absent from the Python
table, absent from GLSL/WGSL, which have no string support at all. Python's
`re` diverges from JS on `v`-mode set operations and some lookbehind, which is
exactly the parity trap the spec warns about; failing closed is the honest
answer until someone needs it.

### D8. `StringReplace` and `StringSplit` gain regex arms, not new operators

Per the spec. The arms are added to the existing overload sets, with the
Phase 1/2 lesson applied: spell an added arm so it cannot win on an
`unknown`-typed operand. `regexp` is a ground type here rather than a bounded
variable, but the existing `string` arms are the ones at risk of being
displaced, so the census in WS-C must check both directions on an `unknown`
operand. The function-replacement form of `StringReplace` (a callback
receiving the match record) is part of this phase per the spec.

### D9. `isSame`, hashing, and serialization for a `regexp`

Two `regexp` values are `isSame` when their pattern text and their flag set
are equal — a syntactic test, matching `isSame`'s documented contract, with no
attempt at language equivalence (deciding whether two patterns match the same
language is not something the equality relation should be doing). Hash follows
from the same two fields, preserving the `isSame ⇒ hash` invariant that the
Phase 3 dedup work depends on.

Serialization round-trips as `RegExp("…", "…")` with the pattern as an
ordinary string literal — never as a raw literal, since the raw form is a
surface convenience of one parser and the MathJSON must be parser-independent.
This mirrors the Phase 1 ruling that a `character` serializes as
`CharacterFrom("x")` rather than a bare string.

### D10. No implicit string-to-regexp coercion

`IsMatch(s, "abc")` is a TYPE ERROR, not a pattern built from `"abc"`.
Implicit coercion would make every plain-string call site silently
regex-sensitive — `"a.c"` would stop meaning what it says — and the engine has
no way to warn about it. `RegExp` is one call and makes the intent explicit.

### D11. The evaluate/N contract does not apply

Regex operators are not numeric: there is no exact/approximate split, so
`evaluate` and `.N()` agree. `IsMatch` over a string literal folds at
canonicalization when both operands are literals; `StringMatchAll` is lazy,
like the other collection-producing string operators, and inherits the Phase 2
laziness rules (a non-finite subject stays symbolic).

### D12. Deferred, explicitly

Not in this phase, and named so they are not silently assumed: locale-aware
matching; `RegExp` construction from a compiled pattern object; substitution
templates with `$1`-style backreferences in the REPLACEMENT string (the
function-replacement form covers the need and has no parsing ambiguity);
splitting with captures retained.

---

## The blocking ruling (D2): which regex dialect, and what stops a runaway match

**The situation.** A regular expression can be matched in two very different
ways, and the choice decides both what patterns are legal and whether a match
can hang the engine.

Host regex engines — JavaScript's `RegExp`, Python's `re` — match by
BACKTRACKING. That makes powerful features possible (backreferences,
lookaround) but means some ordinary-looking patterns take exponential time. The
classic example is small:

```
RegExp(#"(a+)+$"#)  matched against  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!"
```

Thirty characters, a pattern with nothing exotic in it — just grouping and two
`+` quantifiers — and a JS engine will explore on the order of 2³⁰ paths
before answering `false`. On this machine that is minutes to hours in a single
`RegExp.exec()` call.

**Why the engine cannot rescue itself.** I checked this rather than assuming
it. `docs/TIMEOUT-MODEL.md` states that a deadline is armed only inside a
`ce.withTimeLimit(...)` span and is checked by *cooperative polling* —
`checkDeadline()` is called at about ninety instrumented points in the
interpreter. Those checks fire BETWEEN evaluation steps. One call into the
host's regex engine is a single step: control does not come back until the
match finishes. Async cancellation reaches only four handlers (`Loop`,
`Factorial`, `Product`, `Sum`), and a regex operator would not be one of them.
So a timeout, a deadline, and an abort signal are all equally powerless here —
the tab freezes. Restricting which FEATURES the dialect allows does not help
either: the example above uses only grouping and quantifiers, which any useful
subset must keep.

**The three ways out.**

**(a) Host regex, documented and bounded by input size.** Use the host's
`RegExp` in the interpreter and emit the host's `RegExp` in compiled JS.
Cheapest by far — roughly a week — and the dialect is exactly JavaScript's,
which many users already know. Full feature set: backreferences, lookahead and
lookbehind all work. The mitigation available is a cap on subject length and
pattern length, which reduces the blast radius without removing it: a
catastrophic pattern against a 10 KB string still hangs. Python compilation
stays closed (its dialect differs), so this also means "regex works when
interpreted and when compiled to JS, nowhere else". Appropriate if patterns
are always authored by the person running the notebook and never arrive from
elsewhere.

**(b) Host regex, plus a hard cap enforced by chunking the subject.** As (a),
but the operators never hand the host a whole large subject at once; they
match against bounded windows and count steps between windows, so
`checkDeadline()` gets a chance to fire. This makes long-SUBJECT cases
interruptible. It does NOT make a catastrophic pattern against a SHORT subject
interruptible — the thirty-character example above lives entirely inside one
window — so it narrows the hole rather than closing it, at meaningfully more
complexity than (a). I mention it for completeness; I do not recommend it,
because it costs much of (c)'s complexity for a fraction of its guarantee.

**(c) A linear-time matcher owned by the engine.** Implement Thompson NFA
simulation (the RE2/Go approach): matching time is bounded by
pattern-size × subject-size, with no backtracking and therefore no
catastrophic case — the example above answers in microseconds. Because the
matcher takes explicit steps, `checkDeadline()` can be polled inside it, so a
`withTimeLimit` span actually bounds a match, and the timeout result is a
real, describable error rather than a frozen tab. It also matches grapheme
clusters natively, which D6 needs anyway. Two real costs. First, size and
effort: roughly 1,000–1,500 lines for a useful subset, call it two to three
weeks with tests. Second, and more important, the dialect must DROP
backreferences and lookaround — they are not expressible in a non-backtracking
automaton. Patterns like `#"(\w)\1"#` (a doubled character) become
unsupported, and that is a visible limitation users will meet.

There is a parity consideration that cuts toward (c) and is easy to miss:
whatever the interpreter uses, compiled JavaScript must agree with it. Under
(a) both sides are the host `RegExp` and agree by construction. Under (c) the
compiled output has to carry the same matcher into `_SYS`, adding to the
compiled bundle — but if the engine ever matched with a custom matcher while
compiled code used the host's, the two would diverge on real patterns, which
is exactly the class of bug this codebase treats as most serious.

**What happens if nothing is decided:** Phase 3 does not start. The spec makes
this ruling a precondition ("Before Phase 3 lands, pick one"), and I have not
written code against any of the three, because the dialect determines what
`RegExp` accepts, what each operator means, and what the compiled target
emits. Phases 1 and 2 remain shipped and unaffected.

**My recommendation: (a), with the caps, and the limitation stated plainly in
the docs** — on the reading that Compute Engine patterns are authored by the
notebook's own author rather than supplied by a third party, which is the
usage I can actually see in this repo and in the Tycho consumer. That reading
is the whole of the argument, and it is the part I am least able to verify
from inside the repo. If patterns or subjects can arrive from an untrusted
source in any consumer — a shared notebook, a URL parameter, a form field —
then (a) is a hang waiting to happen and the answer should be (c) instead.
**If you can tell me which of those two worlds we are in, that settles it.**

---

## Workstreams (all conditional on D2)

### WS-A — the `regexp` type (independent of D2)

`common/type/types.ts`, `common/type/primitive.ts`, `common/type/subtype.ts`.
Add the primitive; run the narrowing-lie census (D1) over every
kind-preserving signature; lattice assertions
(`ce.type('regexp').matches(…)`); `npm run typecheck`; targeted suites.
This is the only workstream that can start before the ruling.

### WS-B — `RegExp` construction, validation, the match record

`library/core.ts` (or a new `library/regexp.ts` if the surface warrants it),
plus `boxed-expression/` for the value model, `isSame`/hash (D9) and
serialization. Depends on D2 for what "valid" means.

### WS-C — the operator surface

`IsMatch`, `StringMatch`, `StringMatchAll`, and the regex arms of
`StringReplace`/`StringSplit` (D8), including the overload-displacement census
on `unknown` operands. Grapheme-offset translation (D6).

### WS-D — compile targets

JavaScript lowering following the `StringReplace` precedent
(`javascript-target.ts`), literal-arg domain errors at compile time and
computed-arg guards at runtime per the Phase 2 #2a ruling. Python and the GPU
targets: confirm the fail-closed path (D7) by test, do not add handlers.

### WS-E — docs, CHANGELOG, ROADMAP

`doc/97-reference-strings.md`, the operator index in
`doc/82-reference-collections.md`, `doc/13-guide-compile.md` for the
fail-closed rows, CHANGELOG (new primitive type — the release-note obligation
in D1), STRING_ROADMAP Phase 3 entry.

### WS-F — final gate

Full suite with the box lock, snapshot blast radius measured and reported.

---

## Acceptance

- `RegExp(#"[0-9]+"#)` parses and types `regexp`; an invalid literal pattern
  is an error value at canonicalization, a computed one at evaluation (D3/D4).
- `IsMatch("abc123", RegExp(#"\d+"#))` is `True`; `IsMatch(s, "abc")` is a
  type error (D10).
- `StringMatch` returns `Nothing` on no match, and its `range` composes:
  `Slice(s, m.range)` is the matched text, on a string containing multi-code-
  point grapheme clusters (D6).
- Named groups reach the caller as a dictionary.
- `StringMatchAll` is lazy and stays symbolic on a non-finite subject (D11).
- Two `regexp` values with the same pattern and flags are `isSame` and hash
  equally; serialization round-trips (D9).
- Python and GLSL/WGSL compilation of every new operator fails closed with the
  `noLoweringMessage` text (D7).
- Per the D2 ruling there is no resource cap to pin. Instead the DOCS carry
  the catastrophic-backtracking property explicitly (D2), and a test pins that
  a pattern using a backreference or lookbehind — the features the rejected
  option (c) could not express — actually works, since the ruling is what buys
  them.


---

## Deviations from this plan, and why

Recorded so the plan and the code do not drift apart silently.

**D5 / D11 — `StringMatchAll` is EAGER, not lazy.** The plan called for a lazy
collection. It builds the whole list in `evaluate` instead, and declines
(staying symbolic) past `ce.maxCollectionSize`. The reason is that laziness
buys very little here and costs a lot: the number of matches is bounded by the
subject length, every match record is built by the same `exec` walk that a
lazy iterator would run anyway, and a lazy version would need its own
`g`-flagged compiled object living across `next()` calls — precisely the
shared-mutable-state shape that caused the re-entrancy hang (see below). If a
consumer appears that needs to stream matches out of a very large subject,
this is the place to revisit.

**D5 — the match record's `range` is ABSENT, not `Nothing`, when there is no
span.** A `Nothing` value is erased from a dictionary by the engine's own
literal rule, so the key simply does not appear and reading it answers
`Missing` — which is the right marker for "absent but meaningful" anyway. More
importantly, the set of cases where there is no span is WIDER than the plan
assumed: not just an empty match, but any match that starts or ends INSIDE a
grapheme cluster. A host regex can match `👩` within the single character
`👨‍👩‍👧`, and widening the span outward to the containing cluster would
make `Slice(subject, m.range)` return the whole family emoji while `match` is
the component — silently breaking the composition law the field exists for.
There is no honest span for such a match, so the field is absent and `match`
carries the exact text.

**D2 — `u`, not `v`.** The spec allowed either. `v` is STRICTER: it rejects
patterns with an unescaped `[`, `{` or `-` inside a character class that `u`
accepts. Rejecting a pattern a user wrote is a dialect limitation, which the
ruling excludes, so `u` is the permissive choice and the one taken.

**WS-D — compile coverage is narrower than the operator surface**, and this is
a coverage boundary rather than a dialect one. `IsMatch` and `StringReplace`
with a literal pattern and a string replacement lower to JavaScript.
`StringMatch`, `StringMatchAll`, a function replacement and a computed pattern
fail closed. The first three report grapheme-cluster positions or match
RECORDS that compiled code has no representation for; lowering them would
report code-unit offsets that disagree with the interpreter, which is worse
than declining. A computed pattern has no text at compile time, and emitting
`new RegExp(<expr>)` would move a construction error the interpreter reports
at canonicalization into the artifact. `StringSplit` has no JavaScript
lowering at all, regex arm or otherwise — it did not have one before this
phase either.

## Defects found and fixed during review

Both were found by the dual review, and both were real:

**A shared compiled pattern hung the engine.** Compiled `RegExp` objects were
cached and reused, including the `g`-flagged ones. A `g`-flagged object keeps
its scan position in `lastIndex`, so two live loops over one object corrupt
each other — and that is reachable from ordinary user code, not just in
principle: a function replacement whose body matches the same pattern
re-enters the library mid-scan, resets `lastIndex` under the outer loop, and
the outer loop restarts forever. Now anything that ITERATES compiles its own
object per call (`iteratingRegExp`); only the stateless non-global objects are
cached, and that cache is bounded.

**Zero-width separators did not split.** `StringSplit("ab", RegExp("(?=b)"))`
answered `["ab"]` where the host answers `["a", "b"]`. Splitting on a
zero-width match needs the host's actual rule — a match whose END equals the
current segment start produces no split, and a match at the very end of the
subject produces none either — rather than an `exec` loop that skips empty
matches. Now pinned against `String.prototype.split` over fourteen shapes,
including `(?=b)`, `a*`, `(?:)`, `\b`, `^`, `$` and an astral subject.
