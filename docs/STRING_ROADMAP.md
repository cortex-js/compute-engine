# Strings Roadmap

## Current State

Elements of type `string` are represented as an opaque, non-iterable object
(`BoxedString`). Strings are normalized to Unicode NFC at construction and
lazily cache derived views (UTF-8 buffer, Unicode scalar values).

The justification for opacity is that dividing a string into subelements can
easily be done incorrectly, splitting code sequences that should remain
intact (combining marks, ZWJ emoji sequences). Those issues are invisible
with ASCII-range strings but appear with complex scripts and emoji. So the
current design requires the developer to be explicit about the decomposition
they want, via four views:

- `Characters` (synonym `GraphemeClusters`): the string split into
  user-perceived characters, i.e. grapheme clusters (UAX #29, via
  `Intl.Segmenter`). The safest decomposition, but not guaranteed stable
  across Unicode versions, and the most expensive to compute.
- `UnicodeScalars`, `Utf16`, `Utf8`: lists of integers for the corresponding
  code points / code units. Stable and fast, but not suitable for substring
  search or replacement.

The downside is tedium and silent failure: collection operations on a bare
string are inert.

```epsil
  let digits = Characters("0123456789")
  isDigit(c) = c in digits

  const l = Length("Sightglass Coffee Shop")
  // Silently inert: Length returns undefined for non-collections, the
  // expression stays symbolic.
```

## Decision: strings become indexed collections of characters

**Ratified direction (2026-08-13).** Introduce a new scalar type,
`character`, denoting exactly one grapheme cluster. The `string` type becomes
an indexed collection of characters: iterable, indexable (1-based, like other
collections), and countable, with the grapheme decomposition as the default
view. The explicit views (`Characters`, `UnicodeScalars`, `Utf8`, `Utf16`)
remain for when the developer needs a specific decomposition.

```epsil
isDigit(c) = c in "0123456789"   // works: elements of a string are characters
const l = Length("shop")          // -> 4 (grapheme clusters)
```

This is the design Swift converged on (String is a Collection of Character)
after trying both extremes: String was a collection in Swift 1, demoted in
Swift 2 over exactly the concerns above, re-promoted in Swift 4 because the
ergonomics loss wasn't worth it. Python's `str`-iterates-as-`str` is the
cautionary tale the `character` type avoids (see "Rejected alternatives").

### The `character` value model

The type alone is not implementable without the value model; this section is
part of the Phase 1 contract.

- **Representation.** A new boxed kind, `BoxedCharacter`, wrapping a native
  JS string whose content is exactly one NFC-normalized grapheme cluster.
  Its `type` is `character`. Like `BoxedString`, it is canonical and pure by
  construction.
- **Construction and validation.** `CharacterFrom(s)` (following the house
  `XFrom` conversion convention) evaluates to a character iff `s`, after NFC
  normalization, segments to exactly one grapheme cluster under the engine's
  segmenter. An empty string or a multi-cluster string produces an error
  value (a diagnostic, never a silent truncation). Literal narrowing
  (constraint 4 below) uses this same criterion — there is exactly one
  definition of "one character" in the system.
- **Equality and hashing.** Two characters are equal iff their NFC scalar
  sequences are identical. The hash is derived from that same scalar
  sequence. (Both are required by the Phase-1-free operators
  `Contains`/`Tally`/`Unique` and by `Set` membership — `Contains` uses
  `===` structural identity, which for characters is this scalar-sequence
  equality.)
- **Ordering.** Lexicographic over the NFC scalar sequence of the cluster.
  This is the v1 `Sort` order (see "Collation" under Open questions);
  locale-aware collation, if it ever arrives, is an explicit argument.
- **Serialization.** MathJSON has only string literals, so a character value
  serializes as the call form `["CharacterFrom", "'x'"]`, which
  canonicalizes back to the identical character — the round-trip law
  `box(json(c)) === c` holds. A bare narrowed literal does NOT survive
  serialization as a character; the call form is the wire format.
- **Conversion to string.** `String(c)` produces the one-cluster string.
  `CharacterFrom(String(c)) == c` always holds (a single cluster re-segments
  to itself).

### Design constraints (each load-bearing)

1. **`character` is a disjoint sibling of `string`, not a subtype.** If
   `character <: string` and `string` is a collection type, then `character`
   is statically a collection while the runtime says it is not iterable —
   the static pass would act on the lie. Disjointness is also what removes
   the self-iteration fixpoint at both the value and type level: a
   character has no elements, so recursive walkers (value-level `Flatten`,
   type-level element/depth computation) terminate structurally, with no
   per-call-site fencing.

2. **`string` is NOT an alias for `list<character>`.** Grapheme segmentation
   is not stable under concatenation: a string's characters are a property
   of the whole string, not of its parts. `"e"` (U+0065) and the combining
   acute (U+0301) are each one character — a lone combining mark forms its
   own grapheme cluster — so the list of the two has 2 elements, but the
   string formed by joining them is `"é"`, which has 1 character. List
   concatenation adds lengths; string concatenation can merge adjacent
   characters (ZWJ emoji sequences are the everyday case). Two supporting
   reasons: NFC normalization is a string invariant that lists don't have,
   and the representations differ (one native JS string with lazily cached
   views vs. a heap of boxed elements).

   The relationship: `string` and `list<character>` are siblings under
   `indexed_collection<character>` — same iteration interface, same element
   type, neither a subtype of the other.

3. **Conversion laws are asymmetric, and `String` needs a join carve-out to
   honor them.** `Characters(s)` is the explicit projection freezing the
   current segmentation into a genuine list. `String(cs)` joins and
   re-segments (and re-normalizes to NFC).
   - `String(Characters(s)) == s` — always.
   - `Characters(String(cs))` may have FEWER elements than `cs` — adjacent
     characters can merge on joining. This is inherent, not a bug.

   **Dispatch rule (required for the laws to hold):** `String` is declared
   `broadcastable: true`, and a `list<character>` is an ordinary
   broadcast-eligible list — so without a carve-out, `String(Characters(s))`
   would broadcast element-wise and return `list<string>`, not the joined
   string. Therefore `String` called with EXACTLY ONE argument that is a
   finite collection JOINS that collection's elements (coercing each to its
   string content), and this single-collection form takes precedence over
   broadcast lifting. This mirrors the carve-out `StringJoin` already
   implements (its `ops.length === 1 && ops[0].isCollection` branch).
   Multi-argument calls keep the current coercing-join-with-broadcast
   semantics unchanged. A single NON-finite collection argument stays
   symbolic (as in `StringJoin`).

   Consequence for "string-in → string-out" operations: even a
   string-preserving `Reverse` means segment → reverse → join → re-segment,
   and the result can have a different character count than the input
   (reversing may place a combining mark where it combines differently).
   Document this at each such operation.

4. **Literal narrowing.** Epsil has no character literal; `"a"` is a string.
   A string literal narrows to `character` in character-expecting positions
   (`c == "a"`, pattern matches, default parameter values, `Set` literals
   of characters) iff it satisfies the `CharacterFrom` criterion: after NFC,
   it segments to exactly one grapheme cluster under the engine's segmenter.
   ("One character" means one CLUSTER, not one code point — `"é"` and a ZWJ
   emoji narrow.) Without narrowing the feature is unusable in practice.
   Non-literal strings do NOT implicitly convert; use `CharacterFrom(s)`.

5. **Strings are broadcast-atomic.** `isBroadcastableCollection`
   (`src/compute-engine/collection-utils.ts`) must exclude strings exactly
   as it excludes tuples ("tuples carry point/vector semantics and stay
   atomic"). Otherwise every broadcastable operator — including `String`
   itself — starts mapping over the graphemes of any string operand, and a
   scalar-parameter lambda applied to a string maps instead of receiving
   the string. (This constraint governs STRING operands; the
   single-collection join carve-out in constraint 3 governs a LIST-valued
   argument to `String` specifically, and takes precedence there.)

6. **Strings are `Flatten`-atomic.** `Flatten` and any deep-descent walker
   treat strings as leaves: `Flatten(["ab", "cd"])` is `["ab", "cd"]`, not
   `["a", "b", "c", "d"]`. (With the disjoint `character` type this is a
   semantic choice, not a termination requirement — but it is the choice
   users expect.)

7. **`in` is element membership, not substring search.** Consistent with
   every other collection: the elements of a string are its characters, so
   `c in s` tests character membership. Substring search is a separate
   operation (`ContainsSequence`). Mixing the two (Python's `in`) makes the
   operator mean different things depending on operand length.

8. **Type-lattice change ships with the runtime facets, atomically.**
   `string` becomes a subtype of `indexed_collection<character>`. Runtime
   facets without the lattice change (or vice versa) makes the static pass
   and the interpreter disagree about which calls are well-typed. This also
   means every `(collection<T>)` signature in the library newly accepts
   strings — the Phase 1 audit classifies each one under the
   string-preservation rule (see "String preservation rule" below).

9. **API migration.** `Characters` / `GraphemeClusters` (shipped since
   v0.30) migrate from `(string) -> list<string>` to
   `(string) -> list<character>`. `StringJoin(xs, sep?)` accepts character
   elements in `xs` (its variadic form is removed — see "`Join` vs.
   `StringJoin`"). `String(c)` converts a character to a string (see the
   value model above for equality, ordering, hashing, and serialization).

10. **Cross-target compilation contract (decided; Phase 1 acceptance
    criterion).** The Phase 1 deliverable includes a target matrix — for
    each of {`Length`, `At`/indexing, iteration-derived operators, list-out
    operators, string-preserving operators, **and the `character` scalar
    itself**} × {JavaScript, Python, GLSL/WGSL}, each cell is either
    implemented grapheme-correctly or fails closed with a diagnostic. The
    `character` row is not implied by the string rows and must be decided
    per target on its own: `CharacterFrom`, narrowed character literals,
    `String(c)`, character equality/ordering/hashing, and
    `list<character>` values. (JavaScript's natural lowering is a
    one-cluster JS string, making the distinction compile-time-only;
    Python's string-collection type-gate does NOT by itself answer
    whether `CharacterFrom("a")` compiles.) Per target:
    - **JavaScript**: `isIndexedCollectionOperand`
      (`compilation/javascript-target.ts`) currently excludes strings ONLY
      because `string` does not match `indexed_collection` — the lattice
      change flips that predicate silently, and generic lowerings would
      then treat a string as a JS array (`Length` lowering to `.length`
      counts UTF-16 code units, not characters). Phase 1 must first add an
      explicit string exclusion there, then add grapheme-aware lowerings
      (the target already has a grapheme segmenter helper) for the
      supported operator set. `Length` of a string must never lower to
      `.length`.
    - **Python (v1 decision): type-gate, fail closed.** Python has no
      stdlib grapheme segmentation (`len()` counts code points), so v1
      does not compile string collection operations to Python — they fail
      with a target-capability diagnostic. Vendoring a segmenter (or
      depending on the third-party `regex` module) is a later upgrade if
      consumer demand appears.
    - **GLSL/WGSL**: these targets have no string support at all, and that
      does not change. The requirement is only that string-typed operands
      CONTINUE to be rejected with the existing diagnostics, unaffected by
      the lattice change — add a test locking that in.

11. **Unicode-version stability.** Grapheme counts can drift across Unicode
    versions (Node ICU updates). Two consequences:
    - Runtime/tests: keep exotic clusters out of snapshot tests, or pin
      expectations deliberately with a comment naming the Unicode version
      assumed.
    - **Type level**: literal narrowing (constraint 4) is decided by the
      engine's segmenter at parse time, so an ICU upgrade that changes a
      literal's cluster count changes whether the same source TYPE-CHECKS.
      This is an accepted, documented risk (segmentation changes to
      already-assigned sequences are rare in practice); it is mitigated by
      pinning the Node/ICU version in CI, not by restricting narrowing to
      an ASCII-only subset.

12. **Well-formedness: no lone surrogates, enforced at ingress.** Engine
    strings are native JS strings, which can hold unpaired UTF-16
    surrogates (they arrive via public construction and `StringFrom`
    `utf-16` input, and were produced by the now-fixed `StringSplit`
    defect). Segmentation, UTF-8 encoding, equality, and serialization are
    undefined or replacement-dependent on such values, so `character` would
    have no defined domain there. Policy: the `BoxedString` constructor
    replaces each unpaired surrogate with U+FFFD (REPLACEMENT CHARACTER) —
    one deterministic scan, foldable into the ASCII fast-path scan — so
    every `BoxedString` is well-formed Unicode and every downstream
    operation is total. All string ingresses route through the constructor,
    so this is a single enforcement point.

### String preservation rule (which operations return `string`)

The rule is derivable from the operator's declared signature, not an ad-hoc
list:

- **Element-preserving operators (subset / reordering of the input's own
  characters) — string-preserving in PHASE 1.** `Reverse`, `Rest`,
  `Most`, `Take`, `Drop`, `Slice`, `Unique`, `Sort`,
  `RotateLeft`/`RotateRight`, `Filter`. Phase 0 gives each a per-kind
  result rule (see "Signature refinement" below); Phase 1 adds the
  `string -> string` arm. Doing this in Phase 1 rather than later is
  forced, not chosen: once Phase 0's rule says `string -> string` and
  Phase 1 flips the lattice, a list-out runtime would contradict
  constraint 8's static/runtime agreement. Each documents the
  re-segmentation caveat (constraint 3). `Join` is the one member that
  waits for Phase 2, because it is not just an arm but a role change —
  it becomes THE variadic string concatenation (see "`Join` vs.
  `StringJoin`" in the Operations Review).
- **Element-TRANSFORMING higher-order operators — permanently list-out.**
  `Map`, `FlatMap`, `Scan`, `Zip` return `list` for string input, always —
  even for a character→character callback. There is no type-level rule for
  detecting "the callback returns characters" that is worth its complexity;
  rejoin explicitly with `String(...)`. Note this is also why
  `ToUpperCase`/`ToLowerCase`/`CaseFold` are whole-string primitives, NOT
  `Map` wrappers: full-string case mapping is contextual (Greek final sigma
  `Σ → ς` depends on position in the word), so a per-character map is the
  wrong primitive anyway.

#### Signature refinement: honest per-kind results (decided 2026-08-14, corrected 2026-08-15)

Several collection signatures are looser than the operations they
describe (e.g. `RotateLeft: (indexed_collection, integer?) ->
indexed_collection` — rotation never changes the collection's element
type or length, but the signature says nothing of the kind), and one is
already actively WRONG (see the `Reverse` defect below). The string work
forces a per-operator signature audit anyway, so Phase 0 fixes them.

**The honesty test: is the operation closed over the kind?** A bounded
signature `(T, …) -> T where T: indexed_collection` is a promise about
EVERY kind the bound admits, and the runtime must deliver each one. The
first draft of this section assumed the promise held for most operators;
it does not. The lattice's indexed kinds are `list`, `tuple`, `range`
(new — see "The `range` type"), and `string` (after Phase 1); there is no
`linspace` type (a `Linspace` value types as `indexed_collection<number>`).
Checking each kind against each operation:

- **`tuple` breaks every one of them.** A tuple's type carries its arity
  and per-position element types, so `Reverse((1, "a"))` must be
  `tuple<string, finite_integer>`, and `Rest`/`Most`/`Take`/`Drop`/
  `Slice` change arity. This is not hypothetical: shipped `Reverse` is
  `(T) -> T where T: indexed_collection` and `tuple` matches that bound,
  so `Reverse((1, "a"))` STATICALLY claims `tuple<finite_integer,
  string>` for the value `("a", 1)` — a live defect, filed in
  `ROADMAP.md`, that this phase fixes.
- **`range` breaks them too, in two ways** (both verified): the type has
  no EMPTY inhabitant, but `Take(1..5, 0)`, `Drop(1..5, 10)`,
  `Rest(1..1)`, and `Most(1..1)` all evaluate to an empty collection;
  and `Reverse(1..5)` is `[5, 4, 3, 2, 1]`, descending, which the `range`
  type deliberately excludes.
- **`list` and `string` are closed** under all of them.

So the honest mechanism is NOT a universal bound but a **per-kind result
rule**: `string -> string`, `list -> list`, and every other indexed kind
falls back to `list<T>`. Spell it as an overload set, or — if the type
system admits a union bound — as `(T, …) -> T where T: list | string`
plus the generic arm; the two spellings express the same contract, and
the choice is an implementation detail recorded in the Phase 0 audit.
The operators: `Reverse`, `Rest`, `Most`, `Take`, `Drop`, `Slice`,
`Unique`, `Sort` (unary), `RotateLeft`/`RotateRight`, `Filter`, `Sort`
(with a comparator). One operator needs extra care: **`Sort` today is a
single signature with an OPTIONAL `order`** (`(indexed_collection<T>,
order: function?) -> list<T>`), so giving its unary form a
kind-preserving result requires splitting it into two arms by arity —
with `order` becoming REQUIRED in the comparator arm — and deliberately
superseding the pin in its `evaluate` handler (whose comment explains
that results rebuild as `List`, "never the source's head", because a
`Range`/`Linspace` head would reinterpret sorted elements as lo/hi/step).
The unary arm must reconstruct a proper `Range` call, not swap the head.

**Static promises and runtime kinds are decoupled.** Dropping the
over-strong static promise does NOT drop the laziness win: `Take(1..10^6,
3)` should still RETURN a `Range` value (a lazy kind-preserving view)
rather than materializing a million-element list — it simply types as
`indexed_collection<integer>`, which that value satisfies. Runtime
kind-preservation is a performance property; the static signature is a
promise, and the two are tightened independently.

**Sequencing (decided 2026-08-14): this happens UPFRONT, as Phase 0,
before any string work.** It is independent of strings — the kinds
involved are `list`/`tuple`/`range` — and front-loading pays three ways:
the fix lands while the promise covers three kinds rather than four; the
lazy kind-preserving runtime machinery is exercised against ranges with
today's test suite before the string work depends on it; and Phase 1's
string arms become a small, uniform delta (add the `string -> string` arm
to an operator that already dispatches per kind) instead of a redesign.
The live `Reverse`-on-tuple defect is fixed here, not deferred.

The costs, accepted: two breaking rounds instead of one (Phase 0 changes
static result types — `Reverse((1, "a"))` newly types as
`list<finite_integer | string>` (the per-kind rule's `list<T>` for a
tuple operand; the value is a materialized `List`, not a tuple), and
operators that silently promised
`(T) -> T` for exotic kinds now say `list<T>` — plus runtime value kinds
where laziness is added; each round gets its own CHANGELOG migration
note), and Phase 1 must add the string arm for every operator in the set
(mandatory, not optional, per the preservation rule).

### Impact on existing user code

The lattice change is global: any user-authored Epsil function, protocol
conformance, or pattern typed over `collection<T>` /
`indexed_collection<T>` silently starts accepting strings when Phase 1
ships. This is an ACCEPTED breaking change for the release that carries
Phase 1: it gets a CHANGELOG entry, and the release notes advise users to
re-audit `where T: collection`-style constraints (and any dispatch that
must exclude strings, which can now write `T: collection & !string` — or
the negation spelling the type system offers).

### Performance

- Cache the grapheme array lazily on `BoxedString`, following the existing
  `_utf8Buffer` / `_unicodeScalarValues` pattern.
- ASCII fast path: a single scan (at construction or first access) sets a
  flag; for all-ASCII strings, code-unit indexing coincides with grapheme
  indexing and the native string is used directly. ASCII is NFC-stable, so
  the existing normalization does not interfere. The well-formedness scan
  (constraint 12) folds into this same pass.

### Rejected alternatives

- **`character` as a subtype of `string`** ("a string of length 1"): the
  character is then itself iterable — with one element, itself, forever.
  All recursive walkers still need a string base case, so the new type
  buys no structural termination; strictly worse than no `character` type.
- **No `character` type, strings as "leaf collections"** (elements are
  single-grapheme strings, with `isString` base cases fencing every
  recursive walker): workable, and the tuple broadcast carve-out is
  precedent, but termination is then a convention enforced by audit at N
  call sites rather than a property of the design — every future walker is
  a hazard. Rejected in favor of paying the (finite, one-time) `character`
  costs.
- **`string` as an alias for `list<character>`**: contradictory — see
  constraint 2 (segmentation is not concatenation-stable, so the same
  value would have two different lengths).

## The `range` type (new in Phase 0)

**Ratified 2026-08-14.** Add a `range` type to the lattice denoting an
INDEX SPAN — a contiguous, ascending run of 1-based collection indices.
It is not a mathematical range: continuous intervals are `Interval`, and
the statistical "range of a data set" (the extent of its values) remains
`Min`/`Max`. Its purpose is to give index spans a name so that
`Slice(xs, r)` and `RangeOf`'s result are typed rather than
runtime-checked.

### Definition

A value has type `range` iff it is a `Range` whose bounds are provably:

- **integers** — no floats (`Range(0.5, 2.5)` is not a `range`);
- **≥ 1** — a valid 1-based index, so `Range(0, 5)` and negative bounds
  are excluded (NOTE: the ruling was phrased "integer > 1"; it is
  implemented as "≥ 1", since indices are 1-based and `Range(1, n)`
  must qualify — flag if ≥ 2 was actually intended);
- **ascending** — `lower ≤ upper`, so `Range(5, 2)` is excluded;
- **step 1** — contiguous, so `Range(1, 10, 2)` is excluded. (The
  ruling named integer/ascending; contiguity is the completion that
  makes the type mean "span". A stepped range is a GATHER, and gathering
  already has an operator: `At(xs, r)`.)
- **finite** — `Range(1, oo)` is excluded, following the ruling's
  "integer" literally. Consequence, accepted: `Slice(xs, 1..oo)` is a
  type error and the positional form `Slice(xs, 1, oo)` is used instead.
  Revisit if the infinite tail proves common.

Anything else stays `indexed_collection<integer>` /
`indexed_collection<number>`, exactly as today — so this is a NARROWING
of `Range`'s result type in the qualifying cases, never a widening
elsewhere.

### Lattice placement

`range <: indexed_collection<integer>`, added to `INDEXED_COLLECTION_TYPES`
(`src/common/type/primitive.ts`) and to the `indexed_collection` entry of
the subtype map (`src/common/type/subtype.ts`). It is NOT parameterized:
the elements of an index span are always positive integers, so `range`
carries no element-type argument. Every existing signature that accepts
`indexed_collection` therefore accepts a `range` unchanged.

### Typing rule for `Range`

`Range`'s existing `type` handler (`library/collections.ts`) gains the
qualification check (`isIndexSpan`). Provability is literal-based in v1: all
present operands must be integer LITERALS meeting the constraints above. The
one-operand form `Range(n)` means `1..n`, so it qualifies whenever `n` is an
integer literal `>= 1`. Note the literal test cannot be `toInteger` alone —
that helper ROUNDS, so it maps the `Range(0.5, 2.5)` bounds (a sequence of
halves) onto `1..3`; the check is guarded by `isInteger` first.
Symbolic or assumption-bound operands (`Range(a, b)` with `a`, `b`
declared integers and `a ≤ b` assumed) do NOT yield `range` — narrowing
through assumptions is a possible later refinement, deliberately out of
scope, and its absence is never unsound (the result merely types wider).

### What the type buys

- `Slice(xs, r: range)` — the overload becomes STATICALLY safe: a
  descending or stepped range is now a TYPE error at the call site
  rather than a runtime error value, and the "which ranges are valid
  spans" rule lives in the type instead of in each operator's handler.
- `RangeOf(xs, needle, from?) -> range | nothing` — the signature is now
  literal and parseable, and the type itself certifies that the result
  is a usable index span.
- Any future span-consuming operator (`ReplaceAt`-style splicing, a
  collation-aware search returning a match span) inherits the same
  guarantee for free.

### What it does NOT do (and why)

`range` is deliberately absent from the kind-preserving result rule (see
"Signature refinement"): it has **no empty inhabitant** — `Take(1..5, 0)`
and `Rest(1..1)` both evaluate to an empty collection, which is not an
ascending non-empty span — and no descending inhabitant, so
`Reverse(1..5)` is not one either. Operations that can empty or reverse a
range therefore report `list<T>` (their runtime may still return a lazy
`Range` value; see the static/runtime decoupling note).

### The empty-range question (re-examined and re-confirmed 2026-08-15)

Whether `range` should have an empty inhabitant was reopened, on the
argument that a non-empty type forces `range | nothing` on any operator
that might produce an empty span. Re-confirmed NON-EMPTY, for four
reasons:

- **It would not remove a single union.** `RangeOf`'s `| nothing`
  encodes ABSENCE, not emptiness — "not found" and "found a zero-width
  span at position p" are different claims, and the second needs a
  position. Since an empty needle is rejected, zero-width matches never
  arise, so `| nothing` is required either way. No other specified
  operator returns a range-typed result at all.
- **Potentially-empty results widen instead of unionizing.** The escape
  hatch is `indexed_collection<integer>`, which admits both a `Range`
  value and an empty list — no union, no new inhabitant. This is
  already what the per-kind result rule does for `Take`/`Slice`/`Rest`
  on a range.
- **There is no spelling.** `Range(6, 5)` is the DESCENDING pair
  `[6, 5]` (verified), so the "bounds crossed" encoding is occupied. An
  empty range would need a new sentinel value or a breaking
  reinterpretation of descending ranges. (Swift's `Range` gets empty for
  free because it is half-open — `5..<5` — but the engine's `Range` is
  inclusive and shipped.)
- **It would trade a producer-side union for consumer-side
  partiality.** With an empty inhabitant, `First(r)`/`Last(r)` become
  partial and the clean `Slice(xs, r) ≡ Slice(xs, First(r), Last(r))`
  definition needs a special case — pushing "handle the empty case" onto
  every consumer, which is the larger population.

Accepted cost, documented so it is not rediscovered as a bug: the
"span after a match" idiom `Range(Last(r) + 1, Length(xs))` produces a
DESCENDING range when the match ends at the last element, which is not a
`range` and so is rejected by `Slice(xs, r: range)`. Use the positional
form `Slice(xs, Last(r) + 1, Length(xs))` (where `start > end` yields
the empty collection) or `Drop(xs, Last(r))`. Neither reversibility
direction is free — adding an empty inhabitant later would break
consumers that rely on `First`/`Last` totality, and removing one later
would break producers — so this is decided on merits, not deferred.

## Operations Review (2026-08-13)

### Current surface

String-specific operators today:

| Area | Operators |
| --- | --- |
| Construction / concatenation | `String` (coercing interpolation join), `StringJoin` (strict: non-string operand stays symbolic), `Text` (like `String`, but unwraps `Annotated` — the LaTeX text-mode carrier) |
| Splitting | `StringSplit(s, sep?)` (no `sep`: split on Unicode White_Space runs, dropping empties; with `sep`: JS `split` semantics, empties kept; `sep = ""`: split into grapheme clusters) |
| Views | `Characters`/`GraphemeClusters`, `UnicodeScalars`, `Utf16`, `Utf8` |
| Numeric ↔ string | `IntegerString(n, base?)`, `DigitsFrom(s, base?)`, `BaseForm`, `StringFrom(x, format?)` (from `utf-8`/`utf-16`/`unicode-scalars` integer collections) |
| LaTeX | `LatexString`, `Latex`, `Parse` |

Two defects found during this review were FIXED 2026-08-14 (user ruling:
fix immediately rather than defer): `IntegerString(-42)` dropped the sign
(returned `"42"`, breaking the `DigitsFrom` round-trip) — it now preserves
it; and `StringSplit(s, "")` split into UTF-16 code units, shattering
surrogate pairs — an empty separator now splits into grapheme clusters
(the same segmentation as `Characters`, returned as one-cluster strings).

Observations:

- Three concatenators is the right split (coercing vs. strict vs.
  text-mode), but the roles must be documented where users will find them.
  `Text` stays (user ruling 2026-08-13): it is the carrier for LaTeX text
  expressions, whose content can include styling information (`Annotated`
  strings) that a plain `string` value cannot represent — it is not
  removable plumbing.
- `IntegerString`/`DigitsFrom` are a conversion pair but the names don't
  advertise it; the house convention for conversions is `XFrom`
  (`ListFrom`, `SetFrom`, `StringFrom`, `DigitsFrom`). Keep `IntegerString`
  (shipped), but new conversions should follow the `From` convention.

### Free once strings are collections (Phase 1)

With `string <: indexed_collection<character>`, the generic collection
operators become TYPE-APPLICABLE to strings — the lattice change alone
makes the calls well-typed. (It does not make them all free of
string-specific code: the element-preserving members below need the
Phase-1 `string -> string` arm, since a generic list-producing runtime
would contradict their signature. Free-as-in-no-new-code are the ones
whose result is not a collection of the source's kind — `Length`,
`IsEmpty`, `Contains`, `Count`, `Any`/`All`, `IndexOf`, `At`, `First`,
`Last`, `Position`, `Find`, and the permanently list-out higher-order
operators.) The full list that becomes applicable: `Length`,
`IsEmpty`, `Contains`/`Count`/`Tally` (character membership / frequency),
`Any`/`All`, `Map`/`Filter`/`Reduce`/`Fold`, `At`/`First`/`Last`/`Rest`/
`Most`/`Take`/`Drop`/`Slice`, `Reverse`, `IndexOf` (character; returns 0
when absent, the house convention), `Sort`, `Unique`, `Zip`, `Position`,
`Find`. Which of these return `string` vs. `list` — and when — is governed
by the "String preservation rule" above (kind-preserving signatures are
string-out in Phase 1; element-preserving list-out signatures are promoted
in Phase 2; element-transforming ones never are).

### `Join` vs. `StringJoin` (decided 2026-08-14)

Once strings are collections, `Join("ab", "cd")` is well-typed, and the
Phase-2 string-preserving overload makes `Join` THE variadic string
concatenation. `StringJoin`'s variadic form is REMOVED in the same phase
(user ruling 2026-08-14 — no compatibility spelling): `StringJoin("ab",
"cd")` becomes a signature error directing to `Join` or interpolation.
Removing it is what makes the single remaining signature unambiguous —
with both forms live, `StringJoin(xs, sep)` for a collection-valued `xs`
could not be told apart from two strings to concatenate. Breaking change:
CHANGELOG entry with the migration (`Join(a, b)`, or `"\(a)\(b)"`).
`StringJoin` itself is NOT removed — it is sharpened to the one job `Join`
structurally cannot do, and gains the feature that job has always wanted:

The string-preserving overload's trigger is EVERY operand being a
`string`; that is what returns a string. A mixed call such as
`Join("ab", ["c", "d"])` — a string and a `list<character>`, siblings
under `indexed_collection<character>` by constraint 2 — falls back to
the generic arm and yields `list<character>`; rejoin explicitly with
`String(…)` if a string is wanted. Requiring homogeneity keeps the rule
predictable (the result kind is readable from the operand kinds, with no
"majority wins" subtlety) and leaves the more permissive rule available
later, since widening a trigger is not a breaking change.

- **`Join` cannot take a separator.** Its signature is
  `(collection*) -> collection`, and once strings are collections a
  trailing separator is indistinguishable from one more operand:
  `Join(parts, ", ")` must mean "concatenate `parts`, then the string
  `", "`". Any separator-taking join is necessarily a different operator.
- **The two operate one level apart.** `Join(xs)` with a single argument
  is the concatenation of one collection — i.e. `xs` itself — while
  `StringJoin(xs)` joins xs's ELEMENTS into a string. (Spread makes the
  element form reachable through `Join`, but that is not the discoverable
  spelling.)

The sharpened contract: **`StringJoin(xs, separator?)`** — join the
elements of one collection of strings/characters into a string, with the
separator between consecutive elements, defaulting to `""` (which makes
the shipped single-collection form a special case of the new signature).
Precedents: Python's `sep.join(xs)`, Mathematica's `StringRiffle`. It is
the inverse of `StringSplit`: `StringJoin(StringSplit(s, sep), sep) == s`
whenever `sep` occurs in `s` only as a separator. Strictness is unchanged:
a non-string, non-character element leaves the expression unevaluated.
An EMPTY collection joins to `""` (with any separator — no separator is
emitted before the first element, and there is none); a one-element
collection yields that element unchanged. A non-finite collection leaves
the expression unevaluated, as today. The separator parameter lands in
Phase 2.

### Missing operations (proposed)

**Sequence-search operations** (Phase 2; decided 2026-08-14). Substring
search generalizes to CONTIGUOUS-SUBSEQUENCE search over any indexed
collection — one generic operator, strings just benefit, and the whole
family (`RangeOf`, `ContainsSequence`, `StartsWith`, `EndsWith`) is
introduced together in this phase. Two design points make this sound:

**Not an `IndexOf` overload.** `IndexOf(xs, v)` is ELEMENT search
(shipped). Overloading it for collection-valued needles would recreate the
exact ambiguity constraint 7 rejects for `in`: with nested lists,
`IndexOf([[1,2],[3,4]], [3,4])` cannot distinguish "element equal to
`[3,4]`" from "subsequence 3-then-4" — and on a string, `IndexOf(s, "ab")`
would be an element search for a two-cluster character that cannot exist,
silently returning 0. So sequence search is a SEPARATE operator, and its
needle is ALWAYS read as a sequence of elements (to search for one element,
use `IndexOf`; to search for a one-element sequence, wrap it).

**Element-wise matching makes grapheme safety structural.** On strings, the
generic operator compares the needle's CHARACTERS against the subject's
CHARACTERS (both NFC, both segmented). Whole-character comparison cannot
split a cluster, so the grapheme-boundary guarantee is a consequence of the
semantics, not an extra rule — though implementations that accelerate via
host code-unit `indexOf` must still validate candidates against cluster
boundaries and map code-unit offsets to 1-based character indices. Examples
that lock the behavior in:

- `RangeOf("x́y", "x")` → `Nothing` (no match): NFC has no precomposed
  form of `x́` (`x` + U+0301), so the cluster stays decomposed and a
  code-unit search finds `x` — but the subject's characters are
  `[x́, y]`, and `x ≠ x́`.
- `RangeOf("👨‍👩‍👧", "👩")` → `Nothing` (no match): the woman emoji's
  code units occur inside the ZWJ family cluster, but the subject has ONE
  character, and it is not `👩`.
- `RangeOf("ée", "e")` → `2..2`, the span of the FINAL `e` (the
  leading `e` is inside the `é` cluster formed with the following
  combining acute; the subject's characters are `[é, e]`).

The operators:

- `RangeOf(xs, needle, from?) -> range | nothing` — the SPAN of the
  first occurrence of `needle` as a contiguous subsequence starting at
  index `from` or later, as a 1-based inclusive index range
  (`RangeOf([9,7,5,3], [7,5])` → `2..3`), or `Nothing` when absent.
  Signature `(indexed_collection<T>, indexed_collection<T>, integer?) ->
  range | nothing where T` — a literal, parseable signature now that
  `range` is a real type (see "The `range` type"). On strings the needle
  is a string (or a `list<character>`) and the span is in character
  indices. Returning the span rather than a start index (Swift's
  `range(of:)`) is deliberate: it feeds slicing and replacement
  directly, and it stays honest if a future matching mode has spans that
  differ from the needle's length (case-insensitive `"ß"`/`"SS"`,
  collation-aware search).

  The defining law, stated ELEMENT-WISE: when the needle is found,
  `Slice(xs, RangeOf(xs, needle))` has the same element sequence as the
  needle. It is deliberately not spelled `== needle`: the needle may be
  a sibling kind of the subject (searching a string with a
  `list<character>` needle is well-typed), and `Slice` is
  kind-preserving, so the two sides can be a `string` and a
  `list<character>` — equal element-wise, never `==` (constraint 2 makes
  those kinds disjoint). When needle and subject are the same kind, the
  stronger `==` does hold. This consumes the `Slice(xs, r: range)`
  overload, batched into Phase 0 (no string dependency).

  Finiteness: the subject must be a finite collection. On an infinite or
  unknown-length subject the expression stays SYMBOLIC (the house
  pattern — `Sort` and `StringJoin` already decline this way) rather
  than searching forever or guessing; an absent needle in `1..oo` would
  otherwise not terminate. The needle must be finite too. The same rule
  applies to `ContainsSequence`, `StartsWith`, and `EndsWith` —
  `EndsWith` additionally requires a known length, since it must inspect
  the tail.

  The `from` parameter (default 1) is what makes iteration expressible
  without re-slicing: the returned span is always in the ORIGINAL
  subject's indices, so find-next is `RangeOf(xs, needle, Last(r) + 1)`
  for non-overlapping matches (or `First(r) + 1` to allow overlaps), and
  find-all is that loop run to `Nothing`. Domain rules are loop-friendly
  by design: `from` must be an integer ≥ 1 (fractional or < 1 is an
  error value), and any `from` past the end simply yields `Nothing` —
  never an error — because the natural loop legitimately produces
  `Length(xs) + 1` after a match at the very end. A lazy all-spans
  variant (`RangesOf`) is NOT added now; the loop covers it, and a
  collection-returning form can be added later without disturbing this
  one.

  Two deviations from `IndexOf`'s conventions, both forced: absence is
  `Nothing`, not 0 (0 is an index sentinel; it is not a range), and an
  EMPTY needle is an error value — an empty span is not representable
  (`Range(1, 0)` is the DESCENDING range `[1, 0]`, not empty), and
  rejecting it matches `StringReplace`'s empty-target ruling. This
  subsumes the earlier `StringFind` proposal, which is dropped (it never
  shipped; renaming is free). Shape-rule compliance: `from` claims the
  positional tail as an option in options-last position; any FUTURE
  option (a collation, a matching mode) arrives as a NAMED argument, as
  the collation table already specifies. Naming caveat, accepted: in
  statistics "range of a data set" means the extent of its VALUES — the
  two-argument signature disambiguates, and the value-extent operation
  remains `Min`/`Max`.
- `ContainsSequence(xs, needle) -> boolean` — subsequence test; for a
  non-empty needle, equivalent to `RangeOf(xs, needle)` not being
  `Nothing` (distinct from `Contains`, which is element membership; see
  design constraint 7). Empty needle → `True` by definition (the empty
  sequence is a subsequence of everything) — the one place its edge rule
  intentionally diverges from `RangeOf`'s, since a boolean needs no span.
  Subsumes the earlier `StringContains` proposal (also unshipped, also
  dropped).
- `StartsWith(xs, prefix)` / `EndsWith(xs, suffix)` — the same generic
  family: prefix/suffix as contiguous subsequences anchored at an end.
  For strings, a prefix that ends mid-cluster does not match (same
  structural guarantee as above). An EMPTY prefix/suffix matches
  everything (`True`), following `ContainsSequence`'s rule rather than
  `RangeOf`'s: like `ContainsSequence` these return a boolean, so the
  no-representable-empty-span problem that forces `RangeOf` to reject an
  empty needle does not arise.

**String-specific operations** (Phase 2). `StringReplace` deliberately
stays string-only: replacement is where strings genuinely diverge from
lists (splicing forces join + re-segmentation, constraint 3), generic
sequence-replace has weak demand against the existing rules/`ReplaceAll`
machinery, and — because it shares the subjects-first shape — it can be
generalized later without breaking anything if demand appears.

- `StringReplace(s, target, replacement, count?)` — signature
  `(string, string, string, integer?) -> string`; a non-string operand
  leaves the expression unevaluated, as elsewhere. Occurrences are found
  by character-wise matching (the same semantics as `RangeOf`),
  non-overlapping, scanning left to right. The scan walks the ORIGINAL
  subject's character sequence and skips past each match's span, so a
  replacement's content is never re-matched (`StringReplace("aa", "a",
  "aa")` is `"aaaa"`, not an infinite expansion) — and re-segmentation
  happens ONCE, when the pieces are joined to build the result, per
  constraint 3. All occurrences by default; `count` limits from the left
  and must be a positive integer (0, negative, or non-integer `count` is
  an error value). An EMPTY `target` is an error value — the host
  `replaceAll("", x)` insert-at-every-boundary behavior is a well-known
  surprise and is deliberately rejected, not inherited. An empty
  `replacement` is legal and means DELETION.
- `Trim(s, chars?)` / `TrimStart` / `TrimEnd` — default trim set is the
  same Unicode White_Space set `StringSplit` uses (`UNICODE_WHITESPACE`).
  The optional `chars` argument is a SET of characters to strip — typed
  `string | collection<character>`, with a string argument meaning "the
  set of this string's characters", never a literal substring.
- `StringRepeat(s, n)` — `n` copies joined (and re-segmented, constraint
  3). `StringRepeat(s, 0)` → `""`; negative or non-integer `n` is an
  error value. (`Repeat` is taken: it is the infinite lazy collection
  constructor.)
- `PadStart(s, n, pad?)` / `PadEnd(s, n, pad?)` — `n` counts characters;
  if the string already has ≥ `n` characters it is returned unchanged. A
  multi-character `pad` repeats, and the final copy is truncated ON A
  CHARACTER BOUNDARY to fit exactly (JS `padStart` semantics, lifted from
  code units to characters). `pad` defaults to a single space `" "`; an
  EMPTY `pad` is an error value (there is no way to reach length `n` with
  it, and silently returning `s` unchanged would hide the caller's bug);
  a non-string `pad` leaves the expression unevaluated, like every other
  operand here. `n` must be a non-negative integer. Aligning to
  terminal/display width is an explicit non-goal.

**Case operations** (Phase 2):

- `ToUpperCase(s)` / `ToLowerCase(s)` — Unicode default (locale-independent)
  case mappings; no locale parameter in v1 (the Turkish dotless-i problem
  is documented, not solved). These are whole-string primitives, not
  per-character maps: full-string case mapping is contextual (Greek final
  sigma) — see the String preservation rule. Note: case mapping can change
  the character count (`"ß"` uppercases to `"SS"`).
- `CaseFold(s)` — Unicode case folding, the correct primitive for
  case-insensitive comparison (`CaseFold(a) == CaseFold(b)`), rather than
  comparing `ToLowerCase` results.

**Conversions**:

- `NumberFrom(s, base?) -> number | error` — entirely missing today
  (`DigitsFrom` is integer-only); follows the `From` convention. Parse
  contract, so implementations cannot drift: the accepted grammar is
  optional leading/trailing Unicode White_Space, an optional sign, then
  either a decimal numeral (digits with an optional `.` fraction and an
  optional `e`/`E` exponent) or one of the exact spellings `oo`/`+oo`/
  `-oo`/`NaN`. ASCII digits only in v1 (other Unicode decimal digits are
  rejected — silently accepting them invites homoglyph confusion). Any
  other input, including the empty string, is an ERROR value, never
  `NaN`: `NaN` is a legitimate parse RESULT for the literal `"NaN"`, so
  it cannot double as the failure signal. Exactness follows the engine's
  evaluate/N contract: a numeral with no fraction or exponent parses to
  an exact integer, `"1/3"` is NOT accepted (use `DigitsFrom` or
  arithmetic), and a fractional/exponent numeral parses to an exact
  decimal, numericized only by `.N()`. The optional `base` mirrors
  `DigitsFrom`'s (2–36, integer numerals only).
- `CharacterFrom(string) -> character` — see "The `character` value model"
  (Phase 1, since literal narrowing and serialization depend on it).
- Number FORMATTING (fixed decimals, scientific notation, grouping
  separators) is a real gap for display-oriented consumers but a large
  design surface (format-string mini-language vs. options record); deferred
  to its own phase, out of scope here.

**Regex** (Phase 3, sketch below): `RegExp(pattern)` value, `IsMatch`,
`StringMatch` (first match, with capture groups; named groups as a
dictionary), `StringMatchAll`, plus regex overloads of `StringReplace`
(including function replacements) and `StringSplit`.

### Open questions (need a ruling)

- **Infix concatenation operator — RESOLVED (user ruling 2026-08-13): none.**
  String interpolation is the concatenation idiom: Epsil already supports
  Swift-style `\(…)` interpolation in string literals (lowering to a
  `String` call with alternating literal and expression operands), so
  `"\(a)\(b)"` concatenates, and `Join`/`StringJoin` cover the
  programmatic/collection cases. Overloading `+` was rejected (`Add` is
  commutative and broadcastable; concatenation is neither), `&` is
  visually taken by intersection types, and a new `++` operator adds
  surface without adding capability interpolation doesn't already have.
  Note the semantic difference between the spellings: interpolation
  COERCES each hole via its default string representation, while
  `StringJoin` is strict (a non-string operand stays symbolic) — both
  behaviors remain available, and this is a feature, not a conflict.
- **Collation.** Character `Sort` order in v1 is the scalar-sequence order
  defined in "The `character` value model". Locale-aware collation is
  deferred, but its future shape is designed now — see "Future: locale-aware
  collation" below, which fixes the extension points so nothing shipped in
  Phases 1–2 has to change when (if) collation arrives. The remaining open
  part is only whether it ever ships, not what it would look like.

## Future: locale-aware collation (not built now; shapes decided now)

Collation — ordering and comparing text the way a human reader of a given
language expects (UTS #10 / CLDR: Swedish sorts `ö` after `z`, German
phonebook order sorts it with `o`; "strength" levels let a comparison
ignore accents and/or case) — is deliberately NOT in Phases 1–3. But
comparison-flavored operators are being designed in Phase 2, and a wrong
shape now would force breaking changes later. This section records the
future design in enough detail to derive the shape rules the current
operators must follow.

### The invariant that never changes: engine identity is collation-blind

Structural equality (`==`/`===`/`isSame`), `in`/`Contains` membership,
character equality/hashing, pattern matching, and canonical ordering are
PERMANENTLY defined on NFC scalar sequences (see "The `character` value
model") and will never take a locale. This is not a v1 simplification — it
is load-bearing: canonical forms, dedup keys, and match plans must be
deterministic and identical on every host, and collation data varies by
CLDR/ICU version and by host. Collation equivalence ("`é` equals `e` at
primary strength") is only ever an EXPLICIT user-space operation, never an
identity. Consequence for today: no equality-adjacent operator needs a
"collation-ready" shape — what they need is this documented promise that
they will never change.

### The future surface: one reified value, two projections

- **A first-class `collation` value** — `Collation(locale, options?)`
  (e.g. `Collation("sv")`, `Collation("de", strength: "primary")`) —
  following the same pattern as the Phase-3 `regexp` value: constructed
  explicitly, passed explicitly, never ambient engine state. (Explicit
  ruling, recorded above: no global locale, ever.)
- **Comparator projection**: a `collation` is usable wherever an order
  FUNCTION is expected. `Sort` already has the slot — its signature is
  `(indexed_collection<T>, order: function?)` — so `Sort(names,
  Collation("sv"))` works by widening that one parameter to
  `function | collation`, with no new operator and no breaking change.
- **Sort-key projection**: `CollationKey(s, collation)` returns an opaque
  comparable key (the UCA sort key). This is what makes collation compose
  with the KEY-function family — `MaxBy`/`MinBy`/`Ordering`/`GroupBy` and
  friends all take a key or comparator already, so collation-aware
  grouping ("group names ignoring accents") needs zero new variants of
  those operators: `GroupBy(names, n => CollationKey(n, c))`.

Locale-sensitive CASING (`ToUpperCase(s, locale)` — the Turkish dotless-i)
is a separate, smaller feature: an optional trailing argument on the case
operators, already anticipated in their Phase 2 description.

### How each Phase-2 operator accommodates this (decided now)

| Operator (Phase 2 shape) | Future collation path | Change needed later |
| --- | --- | --- |
| `Sort(xs, order?)` | pass a `collation` as `order` | widen one param type |
| `MaxBy`/`MinBy`/`Ordering`/`GroupBy` | key fn via `CollationKey` | none |
| `StringCompare(a, b)` (add in Phase 2, see below) | optional trailing `collation` | add optional param |
| `ToUpperCase`/`ToLowerCase` | optional trailing locale | add optional param |
| `CaseFold` + `==` | unchanged — the fast, deterministic caseless path | none (subsumed but not replaced) |
| `==`, `in`, `Contains`, `Unique`, `Tally` | never collation-aware (invariant above) | none, by promise |
| `ContainsSequence`/`RangeOf`/`StartsWith` | stay character-literal; collation-aware search (accent-insensitive matching) would be a NEW operator or a named option, not a redefinition | none |

One addition this analysis feeds back into Phase 2: **`StringCompare(a, b)
-> -1 | 0 | 1`**, three-valued comparison under the default scalar-sequence
order. It is independently useful (a comparator primitive for user-written
sorts), and it is the natural future home of the optional `collation`
argument — without it, "compare two strings under a collation" has no
operator to land on.

### Shape rules adopted now (binding on Phases 1–3)

1. **Subjects first, options last.** Comparison-flavored operators put
   their string subject(s) in the leading positions and keep the trailing
   position(s) free for optional/named arguments — so a future `collation`
   or locale argument appends without breaking any call. (Named arguments
   exist in Epsil, so future options can also arrive as named parameters;
   either way the tail must be unclaimed.)
2. **Collation is a value, not a mode.** Any future locale sensitivity
   arrives as an explicit argument (or a `collation` value in a
   function-shaped slot) — never as engine state, an engine constructor
   option, or an ambient default. This is the same ruling as the
   equality-tier and broadcast policies: behavior must be readable at the
   call site.
3. **Order-taking operators accept values-as-comparators.** Wherever
   Phase 2 adds an `order:`/`compare:` function parameter, its future type
   is `function | collation`; write signatures so that widening is
   additive.
4. **Identity operations are exempt and frozen.** Nothing in the equality/
   membership/hashing family is designed for collation, per the invariant
   above.

### Feasibility notes (so the future estimate is honest)

- **Hosts**: JS has `Intl.Collator` (comparator; no sort-key API — a
  `CollationKey` would be JS-emulated or comparator-only at first). Python
  needs PyICU or OS `locale` (non-portable) — so collation would be
  interpreter-only or type-gated on compile targets, like grapheme
  iteration (constraint 10).
- **Determinism**: CLDR tailorings drift across ICU versions, exactly like
  grapheme segmentation (constraint 11) — same test policy applies, and
  it is one more reason collation can never participate in canonical
  forms.

## Phases

0. **The `range` type + honest per-kind signatures (upfront — no string
   involvement).** Three pieces, all independent of strings:

   a. **The `range` type** — add it to the lattice as
      `range <: indexed_collection<integer>` and gate `Range`'s type
      handler on the qualification check (integer, ≥ 1, ascending,
      step 1, finite). See "The `range` type".

      Note (learned while implementing, 2026-08-15): step (a) cannot ship
      WITHOUT `Reverse`'s per-kind case from step (b). The moment
      qualifying ranges type as `range`, `Reverse`'s declared
      `(T) -> T where T: indexed_collection` binds `T = range` and claims
      `range` for `Reverse(1..10)` = `[10, 9, …, 1]` — a descending
      sequence the type excludes. Introducing the type therefore CREATES
      a false static type unless `Reverse` widens a span operand to
      `indexed_collection<integer>` in the same change. Any other
      operator given a kind-preserving signature has the same coupling:
      the type and its per-kind cases are one unit.

   b. **Per-kind result rule** for `Reverse`, `Rest`, `Most`, `Take`,
      `Drop`, `Slice`, `Unique`, `Sort` (unary and comparator arms —
      note the arity split and the superseded List-rebuild pin),
      `RotateLeft`/`RotateRight`, `Filter`: `string -> string` (Phase 1),
      `list -> list`, every other indexed kind → `list<T>`. This FIXES
      the live `Reverse`-on-tuple defect (filed in `ROADMAP.md`), where
      the current `(T) -> T` signature claims `tuple<finite_integer,
      string>` for the value `("a", 1)`. Separately, keep/extend runtime
      laziness so `Take(1..10^6, 3)` still returns a `Range` VALUE — a
      perf property, independent of the static type (see the decoupling
      note in "Signature refinement").

      Shipped 2026-08-15. Spelling: `Reverse`, `RotateLeft`, `RotateRight`
      (length-preserving) are overload sets `((T, …) -> T where T: list) &
      ((indexed_collection<T>, …) -> list<T> where T)` — the `list` arm
      keeps the shape, most-specific-wins picks it for a list operand;
      `Rest`/`Most` (length-changing) are `(indexed_collection<T>) ->
      list<T> where T` for every kind, since a `list` type carries no
      length; `Filter`'s `type` handler yields `list<T>` for an indexed
      source (it echoed the source type — `vector<3>`, `tuple<…>`,
      `range` — all length lies) and the source type for a set. `Take`,
      `Drop`, `Slice`, `Unique`, `Sort` already returned `list<T>` and
      were left alone: `list<T>` IS the `list -> list` case, and the
      arity split of `Sort` matters only once a `string -> string` arm
      exists, so it lands with Phase 1. The tuple result is `list<T>`
      (the join of the position types), per the mechanism, not the
      reversed tuple type the Breaking note below once anticipated: the
      lazy view materializes to a `List`. `Reverse`'s `range` case, which
      shipped early with step (a) as a `type` handler widening to
      `indexed_collection<integer>`, is subsumed by the generic arm
      (`list<integer>`). Tests: `type-variables-collections.test.ts`
      ("the per-kind result rule"), `range-type.test.ts`.

   c. **The `Slice(xs, r: range)` overload** the `RangeOf` law consumes.
      `Slice` today takes only positional bounds (`(xs, start, end)`,
      1-based inclusive, clamping out-of-bounds, negatives counting from
      the end, `start > end` → empty) — a range argument is a type error.
      `Slice(xs, r)` is defined as `Slice(xs, First(r), Last(r))`,
      inheriting the clamping semantics. Because the parameter is typed
      `range`, a descending or stepped argument is rejected STATICALLY
      (no runtime error branch needed): `Slice(xs, 3, 2)` is empty, but
      the collection `3..2` is the descending pair `[3, 2]`, so unpacking
      its bounds would contradict its own meaning. Gather-by-indices (any
      order, any step) is `At(xs, r)`, which accepts the wider
      `indexed_collection<integer>` — the diagnostic points there.
      Division of labor: `Slice` = contiguous span, clamping,
      kind-preserving for list/string; `At` = gather, list-out,
      element-exact.

      Shipped 2026-08-15 as an overload set —
      `((indexed_collection<T>, span: range) -> list<T> where T) &
      ((indexed_collection<T>, start: number, end: number) -> list<T>
      where T)`. Both arms share the one lazy facet set (`sliceBounds`
      reads the span through `spanBounds`, which re-checks contiguity at
      runtime so a `range`-declared symbol with a non-span value declines
      instead of being reinterpreted); the JavaScript target lowers the
      span arm to a native `slice`, gated on the operand's STATIC type so
      a `range` symbol compiles too. Landing it surfaced one defect in the
      overload machinery, fixed alongside: `diagnoseNoMatch` displayed an
      unbound type variable as `unknown` (`indexed_collection<unknown>`),
      where the single-signature path already showed the declared
      skeleton. Tests: `collections.test.ts` ("SLICE (range)"),
      `compile.test.ts`.

   Breaking: static result types change (`Reverse((1, "a"))` newly types
   as `list<finite_integer | string>`; operators that silently promised
   `(T) -> T` for exotic kinds now say `list<T>`; qualifying `Range`
   calls newly type as `range`) — CHANGELOG migration note. Ships
   before, and independently of, everything below. **Phase 0 shipped in
   full 2026-08-15** (a: `range` type; b: per-kind rule; c: `Slice(xs,
   range)`).
1. **`character` type + collection facets.** The `character` scalar type in
   the lattice with its full value model (representation, `CharacterFrom`,
   equality/ordering/hashing, serialization); `string <:
   indexed_collection<character>`; `BoxedString` facets (`count`, `each`,
   `at`); broadcast and `Flatten` atomicity; the `String`
   single-collection join carve-out (constraint 3); literal narrowing;
   well-formedness at ingress (constraint 12); `Characters` migration;
   the `string -> string` arm for every operator given a per-kind result
   rule in Phase 0 (mandatory, per the preservation rule: their
   signatures promise string-out the moment the lattice flips — the
   delta is segment → operate → join
   on machinery Phase 0 already made kind-preserving); library signature
   audit under the String preservation rule; the compile-target matrix
   (constraint 10: JS explicit exclusion + grapheme lowerings, Python
   type-gate, GLSL rejection test); CHANGELOG entry + release-note
   guidance for the user-code impact; update
   `doc/97-reference-strings.md` (it currently states "Strings are not
   handled as collections" and documents `Characters` as `list<string>` —
   both false after this phase). Ships as one unit (constraint 8).
2. **`Join`/`StringJoin` roles + substring/case operations.** (The
   `string -> string` arms for the element-preserving operators all
   land in Phase 1; what remains here is the one role change and the new
   operations.) The `Join` string-preserving overload — all-string
   operands, see "`Join` vs. `StringJoin`" — documenting the
   re-segmentation caveat (constraint 3). `StringJoin` is narrowed to
   `(collection, separator?) -> string` and its variadic form removed
   (see "`Join` vs. `StringJoin`"; breaking, CHANGELOG + migration
   note). The new operations from the Operations Review: substring
   search/replace via the generic sequence-search family
   (`RangeOf`, `ContainsSequence`, `StartsWith`/`EndsWith` — generic
   over indexed collections, character-wise on strings; the
   `Slice(xs, range)` overload they depend on ships in Phase 0) and the
   string-specific `StringReplace`,
   trim/pad/repeat with the edge-case rules as specified, case
   operations (`ToUpperCase`/`ToLowerCase`/`CaseFold`), `StringCompare`
   (three-valued, scalar-sequence order — the future landing spot for an
   optional collation argument, see "Future: locale-aware collation"),
   `NumberFrom`. All comparison-flavored operators follow the collation
   shape rules (subjects first, tail free; order slots typed to admit a
   future `collation` value). Update `doc/97-reference-strings.md` again
   with the new operators.
3. **Regular expressions.** Independent of the collection change.

## Regular Expressions (Phase 3 sketch)

```epsil
const numberRE = RegExp(#"[0-9]+(\.[0-9]+)?"#)
```

- Raw string literal syntax `#"..."#` (Swift precedent) avoids
  double-escaping.
- A `regexp` value type; keep the initial API small: `RegExp(pattern)`,
  match / replace / split operations.
- Always compile host regexes with the `v` (or `u`) flag so character
  classes are code-point-aware.
- Decide up front whether the dialect is "host JS regex, documented as
  such" or a portable subset: Python's `re` diverges from JS on enough
  features (`v`-mode set operations, some lookbehind) that compiled-code
  parity is otherwise a trap.
- **Resource safety is part of the dialect decision, not an afterthought.**
  Host JS/Python regex engines backtrack, so an arbitrary user pattern
  against attacker-controlled input is an unbounded ReDoS path — the
  `v`/`u` flags do not mitigate it, and a synchronous host regex cannot be
  interrupted by the engine's deadline checks (per `docs/TIMEOUT-MODEL.md`,
  work outside a `withTimeLimit` span is unbounded). Before Phase 3 lands,
  pick one: a non-backtracking engine, a restricted dialect that excludes
  catastrophic patterns, or explicit pattern/input/step limits enforced at
  an interruptible boundary — and define the timeout/error result the
  caller sees.
