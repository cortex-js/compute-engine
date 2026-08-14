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
    operators, string-preserving operators} × {JavaScript, Python,
    GLSL/WGSL}, each cell is either implemented grapheme-correctly or fails
    closed with a diagnostic. Per target:
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

- **Kind-preserving signatures — string-preserving in PHASE 1.** An operator
  whose signature returns the bound type variable itself, e.g. `Reverse:
  `(T) -> T where T: indexed_collection`` (`library/collections.ts`),
  STATICALLY promises `string`-out the moment the lattice changes — a
  list-out runtime would contradict constraint 8's static/runtime
  agreement. These operators must be string-preserving from Phase 1. After
  the Phase 0 tightening (see "Signature refinement" below) this category
  contains not just `Reverse` but every operator that passed the honesty
  test: `Rest`, `Most`, `Take`, `Drop`, `Slice`, unary `Sort`, `Unique` —
  all of which therefore ship their string runtimes IN Phase 1.
- **Element-preserving operators that fail the honesty test — overload
  sets in PHASE 2.** Operators whose operation cannot preserve every
  indexed kind (`RotateLeft`/`RotateRight`, `Filter`, `Sort` with a
  comparator — see the classification in "Signature refinement") stay
  list-out in Phase 1 and gain `(string, …) -> string` overloads in
  Phase 2. `Join` becomes THE variadic string concatenation (see "`Join`
  vs. `StringJoin`" in the Operations Review). Each string-preserving
  result documents the re-segmentation caveat (constraint 3).
- **Element-TRANSFORMING higher-order operators — permanently list-out.**
  `Map`, `FlatMap`, `Scan`, `Zip` return `list` for string input, always —
  even for a character→character callback. There is no type-level rule for
  detecting "the callback returns characters" that is worth its complexity;
  rejoin explicitly with `String(...)`. Note this is also why
  `ToUpperCase`/`ToLowerCase`/`CaseFold` are whole-string primitives, NOT
  `Map` wrappers: full-string case mapping is contextual (Greek final sigma
  `Σ → ς` depends on position in the word), so a per-character map is the
  wrong primitive anyway.

#### Signature refinement: prefer accurate bounds over overloads (decided 2026-08-14)

Several collection signatures are looser than the operations they
describe (e.g. `RotateLeft: (indexed_collection, integer?) ->
indexed_collection` — rotation never changes the collection's element
type or length, but the signature says nothing of the kind). The string
work forces a per-operator signature audit anyway, so Phase 2 tightens
them. The mechanism is chosen by an honesty test:

**The test: is the operation kind-preserving for EVERY indexed kind?** A
bounded signature `(T, …) -> T where T: indexed_collection` is a promise
about every kind the bound admits — string, list, range, linspace — and
the runtime must deliver each one. Where the promise holds, the bound is
the right spelling: ONE signature, and string preservation falls out with
no string-specific overload (per the preservation rule, a `(T) -> T`
signature must then be string-out as soon as it ships). Where it does not
hold, forcing the bound would lie for some kind; use an overload set
instead: `(string, …) -> string`, plus the generic
`(indexed_collection<T>, …) -> list<T>` fallback.

Classification (each verified against what the operation can actually
represent in each kind):

- **Bound-tightenable — `(T, …) -> T where T: indexed_collection`**:
  `Reverse` (already spelled this way; a reversed range is a
  negative-step range), `Rest`, `Most` (dropping an end of a range or
  linspace yields a range/linspace), `Take`, `Drop`, `Slice` (contiguous
  subranges preserve every kind), `Sort` in its UNARY form (a sorted
  range/linspace is itself, possibly step-flipped; a sorted string is a
  string), `Unique` (an already-unique kind is unchanged; a list
  dedupes to a list; a string to a string).
- **Overload set — string/list preserved, generic falls back to `list`**:
  `RotateLeft`/`RotateRight` (a rotated range is NOT a range — the
  monotone step breaks at the seam), `Filter` (an arbitrary subsequence
  of a range is not a range), `Sort` WITH a comparator (an arbitrary
  permutation of a range is not a range — though the string overload
  still holds: sorted characters rejoin to a string).

**Sequencing (decided 2026-08-14): the tightening happens UPFRONT, as
Phase 0, before any string work.** The tightening is independent of
strings — today the bound only admits `list`/`range`/`linspace` — and
front-loading it pays three ways:

- **Smaller blast radius now than later.** Landing `(T) -> T` before the
  lattice change means the promise covers three kinds, not four; the
  string case arrives later as an extension of already-working machinery
  instead of shipping inside the big-bang.
- **The hard part gets battle-tested early.** The real work is making
  each tightened runtime actually produce the promised kind — `Take` on a
  range must return a range (lazy kind-preserving views or literal
  reconstruction), not a materialized list wearing a `range` type. That
  machinery is exercised against ranges/linspaces with today's test
  suite, before the string work depends on it. (It is also a standalone
  win: `Take(1..10^6, 3)` staying a range is a laziness/perf improvement
  with no string involvement.)
- **Phase 2 shrinks.** Once the signatures are tight, string preservation
  for those operators is not a "promotion" at all — the moment Phase 1
  flips the lattice, the `T` promise extends to strings automatically,
  and Phase 1 ships their string runtimes (a small delta: segment →
  operate → join, on machinery that already preserves kinds). Phase 2
  keeps only the overload-set operators and the new operations.

The costs, accepted: two breaking rounds instead of one (Phase 0 changes
static result types — `Take(1..10, 3)` types as `range`, and downstream
code annotated `list` breaks — AND runtime value kinds, so code
pattern-matching a `List` operator on a `Take`-of-range result breaks
behaviorally; each round gets its own CHANGELOG migration note), and
Phase 1 must include the string runtimes for every tightened operator
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
operators apply to strings with no string-specific code: `Length`,
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
The separator parameter lands in Phase 2.

### Missing operations (proposed)

**Sequence-search operations** (Phase 2; decided 2026-08-14). Substring
search generalizes to CONTIGUOUS-SUBSEQUENCE search over any indexed
collection, following the `StartsWith`/`EndsWith` precedent — one generic
operator, strings just benefit. Two design points make this sound:

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
- `RangeOf("e" ++ combining-acute ++ "e", "e")` → `2..2`, the span of the
  FINAL `e` (the leading `e` is inside the `é` cluster).

The operators:

- `RangeOf(xs, needle, from?) -> range | nothing` — the SPAN of the
  first occurrence of `needle` as a contiguous subsequence starting at
  index `from` or later, as a 1-based inclusive index range
  (`RangeOf([9,7,5,3], [7,5])` → `2..3`), or `Nothing` when absent.
  Signature `(indexed_collection<T>, indexed_collection<T>, integer?) ->
  range | nothing where T` — so on strings the needle is a string (or a
  `list<character>`) and the span is in character indices. Returning the
  span rather than a start index (Swift's `range(of:)`) is deliberate:
  it feeds slicing and replacement directly, and it stays honest if a
  future matching mode has spans that differ from the needle's length
  (case-insensitive `"ß"`/`"SS"`, collation-aware search). The defining
  law: `Slice(xs, RangeOf(xs, needle)) == needle` whenever the needle is
  found — which requires the `Slice(xs, range)` overload, batched into
  Phase 0 (where `Slice` is already being reworked for the tightening;
  the overload has no string dependency).

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
  structural guarantee as above).

**String-specific operations** (Phase 2). `StringReplace` deliberately
stays string-only: replacement is where strings genuinely diverge from
lists (splicing forces join + re-segmentation, constraint 3), generic
sequence-replace has weak demand against the existing rules/`ReplaceAll`
machinery, and — because it shares the subjects-first shape — it can be
generalized later without breaking anything if demand appears.

- `StringReplace(s, target, replacement, count?)` — replaces occurrences
  found by character-wise matching (the same semantics as
  `RangeOf`), non-overlapping, scanning left to right,
  with the scan resuming AFTER each replacement (a replacement's content
  is never re-matched). All occurrences by default; `count` limits from
  the left and must be a positive integer (0, negative, or non-integer
  `count` is an error value). An EMPTY `target` is an error value — the
  host `replaceAll("", x)` insert-at-every-boundary behavior is a
  well-known surprise and is deliberately rejected, not inherited.
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
  code units to characters). Aligning to terminal/display width is an
  explicit non-goal.

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

- `NumberFrom(string) -> number` — entirely missing today (`DigitsFrom` is
  integer-only); follows the `From` convention.
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
  those operators: `GroupBy(names, n |-> CollationKey(n, c))`.

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
| `ContainsSequence`/`RangeOf`/`StartsWith` | stay codepoint-literal; collation-aware search (accent-insensitive matching) would be a NEW operator or a named option, not a redefinition | none |

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

0. **Signature tightening (upfront — no string involvement).** Tighten
   the bound-tightenable operators to `(T, …) -> T where T:
   indexed_collection` (`Rest`, `Most`, `Take`, `Drop`, `Slice`, unary
   `Sort`, `Unique` — per the honesty test in "Signature refinement"),
   and make each runtime actually kind-preserving for
   `list`/`range`/`linspace` (lazy views or literal reconstruction —
   `Take(1..10^6, 3)` stays a range, a standalone laziness/perf win).
   Breaking: static result types change (`Take(1..10, 3)` types as
   `range`) and runtime value kinds change — CHANGELOG migration note.

   Also in this phase (same `Slice` touch, no string dependency): the
   **`Slice(xs, range)` overload** the `RangeOf` law consumes. `Slice`
   today takes only positional bounds (`(xs, start, end)`, 1-based
   inclusive, clamping out-of-bounds, negatives counting from the end,
   `start > end` → empty) — a range argument is a type error.
   `Slice(xs, r)` for a step-1 ASCENDING integer range is defined as
   `Slice(xs, First(r), Last(r))`, inheriting the clamping and
   negative-index semantics. Any other range — descending or stepped —
   is an ERROR value, deliberately: `Slice(xs, 3, 2)` is empty, but the
   RANGE `3..2` is the descending two-element collection `[3, 2]`, so
   unpacking its bounds would contradict the range's own meaning.
   Gather-by-indices (any order, any step) already exists as
   `At(xs, r)` — the error message points there. Division of labor:
   `Slice` = contiguous span, kind-preserving (string → string after
   Phase 1), clamping; `At` = gather, list-out, element-exact.
   Ships before, and independently of, everything below.
1. **`character` type + collection facets.** The `character` scalar type in
   the lattice with its full value model (representation, `CharacterFrom`,
   equality/ordering/hashing, serialization); `string <:
   indexed_collection<character>`; `BoxedString` facets (`count`, `each`,
   `at`); broadcast and `Flatten` atomicity; the `String`
   single-collection join carve-out (constraint 3); literal narrowing;
   well-formedness at ingress (constraint 12); `Characters` migration;
   string runtimes for every Phase-0-tightened operator plus `Reverse`
   (mandatory: their `(T) -> T` signatures extend the promise to strings
   the moment the lattice flips — the delta is segment → operate → join
   on machinery Phase 0 already made kind-preserving); library signature
   audit under the String preservation rule; the compile-target matrix
   (constraint 10: JS explicit exclusion + grapheme lowerings, Python
   type-gate, GLSL rejection test); CHANGELOG entry + release-note
   guidance for the user-code impact; update
   `doc/97-reference-strings.md` (it currently states "Strings are not
   handled as collections" and documents `Characters` as `list<string>` —
   both false after this phase). Ships as one unit (constraint 8).
2. **Overload-set promotions + substring/case operations.** String
   overloads for the operators that failed the honesty test
   (`RotateLeft`/`RotateRight`, `Filter`, `Sort` with a comparator) and
   the `Join` string-preserving overload, each documenting the
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
