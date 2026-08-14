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

3. **Conversion laws are asymmetric.** `Characters(s)` is the explicit
   projection freezing the current segmentation into a genuine list.
   `String(cs)` joins and re-segments (and re-normalizes to NFC).
   - `String(Characters(s)) == s` — always.
   - `Characters(String(cs))` may have FEWER elements than `cs` — adjacent
     characters can merge on joining. This is inherent, not a bug.

   Consequence for "string-in → string-out" operations: even a
   string-preserving `Reverse` means segment → reverse → join → re-segment,
   and the result can have a different character count than the input
   (reversing may place a combining mark where it combines differently).
   Document this at each such operation.

4. **Literal narrowing.** Epsil has no character literal; `"a"` is a string.
   A single-character string literal must narrow to `character` in
   character-expecting positions (`c == "a"`, pattern matches, default
   parameter values, `Set` literals of characters). Without this the
   feature is unusable in practice. Non-literal strings do NOT implicitly
   convert; use an explicit conversion.

5. **Strings are broadcast-atomic.** `isBroadcastableCollection`
   (`src/compute-engine/collection-utils.ts`) must exclude strings exactly
   as it excludes tuples ("tuples carry point/vector semantics and stay
   atomic"). Otherwise every broadcastable operator — including `String`
   itself, which is declared `broadcastable: true` — starts mapping over
   the graphemes of any string operand, and a scalar-parameter lambda
   applied to a string maps instead of receiving the string.

6. **Strings are `Flatten`-atomic.** `Flatten` and any deep-descent walker
   treat strings as leaves: `Flatten(["ab", "cd"])` is `["ab", "cd"]`, not
   `["a", "b", "c", "d"]`. (With the disjoint `character` type this is a
   semantic choice, not a termination requirement — but it is the choice
   users expect.)

7. **`in` is element membership, not substring search.** Consistent with
   every other collection: the elements of a string are its characters, so
   `c in s` tests character membership. Substring search is a separate
   operation (`StringContains`). Mixing the two (Python's `in`) makes the
   operator mean different things depending on operand length.

8. **Type-lattice change ships with the runtime facets, atomically.**
   `string` becomes a subtype of `indexed_collection<character>`. Runtime
   facets without the lattice change (or vice versa) makes the static pass
   and the interpreter disagree about which calls are well-typed. This also
   means every `(collection<T>)` signature in the library newly accepts
   strings — audit them, and decide per-operator between list-out (the
   generic default) and a string-preserving overload (Phase 2).

9. **API migration.** `Characters` / `GraphemeClusters` (shipped since
   v0.30) migrate from `(string) -> list<string>` to
   `(string) -> list<character>`. `StringJoin` accepts characters.
   `String(c)` converts a character to a string. Characters need equality,
   ordering (so `Sort` works), and hashing.

10. **Cross-target parity.** The JS compile target already segments grapheme
    clusters (`javascript-target.ts`). Python has NO stdlib grapheme
    segmentation — `len()` counts code points — so grapheme `Length` /
    iteration on the Python target requires vendoring a segmenter, depending
    on the third-party `regex` module, or type-gating string iteration out
    of that target. Decide before Phase 1 lands; verify on the python and
    glsl statement paths, not just JS.

11. **Unicode-version stability.** Grapheme counts can drift across Unicode
    versions (Node ICU updates). Keep exotic clusters out of snapshot
    tests, or pin expectations deliberately with a comment naming the
    Unicode version assumed.

### Performance

- Cache the grapheme array lazily on `BoxedString`, following the existing
  `_utf8Buffer` / `_unicodeScalarValues` pattern.
- ASCII fast path: a single scan (at construction or first access) sets a
  flag; for all-ASCII strings, code-unit indexing coincides with grapheme
  indexing and the native string is used directly. ASCII is NFC-stable, so
  the existing normalization does not interfere.

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
| Splitting | `StringSplit(s, sep?)` (no `sep`: split on Unicode White_Space runs, dropping empties; with `sep`: JS `split` semantics, empties kept) |
| Views | `Characters`/`GraphemeClusters`, `UnicodeScalars`, `Utf16`, `Utf8` |
| Numeric ↔ string | `IntegerString(n, base?)`, `DigitsFrom(s, base?)`, `BaseForm`, `StringFrom(x, format?)` (from `utf-8`/`utf-16`/`unicode-scalars` integer collections) |
| LaTeX | `LatexString`, `Latex`, `Parse` |

Known defects (filed in `ROADMAP.md`, "String-operation defects"):
`IntegerString(-42)` drops the sign (returns `"42"`, breaking the
`DigitsFrom` round-trip), and `StringSplit(s, "")` splits into UTF-16 code
units, shattering surrogate pairs into lone `�` halves.

Observations:

- Three concatenators is defensible (coercing vs. strict vs. text-mode) but
  the role split must be documented where users will find it; revisit
  whether `Text` should remain user-facing or become serialization plumbing.
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
`Find`. These are list-out by default; Phase 2 selects the
string-preserving subset.

`Join` (generic collection concatenation) deserves a special note: once
strings are collections, `Join("ab", "cd")` is well-typed and the
string-preserving overload should make it THE string concatenation —
subsuming the `StringJoin(collection)` convenience form.

### Missing operations (proposed)

**Substring operations** (Phase 2 — these operate on the string as a whole,
not per-character, and are grapheme-safe by construction since the operands
are literal substrings):

- `StringContains(s, sub) -> boolean` — substring test (distinct from
  `Contains`, which is character membership; see design constraint 7).
- `StartsWith(s, prefix)` / `EndsWith(s, suffix)` — proposed as GENERIC
  indexed-collection operators (prefix/suffix of a list works the same
  way), with strings just benefiting.
- `StringFind(s, sub) -> integer` — 1-based character index of the first
  occurrence, 0 when absent (mirrors `IndexOf`).
- `StringReplace(s, target, replacement, count?)` — replaces all
  occurrences by default; `count` limits from the left.
- `Trim(s, chars?)` / `TrimStart` / `TrimEnd` — default trim set is the
  same Unicode White_Space set `StringSplit` uses (`UNICODE_WHITESPACE`).
- `StringRepeat(s, n)` — (`Repeat` is taken: it is the infinite lazy
  collection constructor).
- `PadStart(s, n, pad?)` / `PadEnd(s, n, pad?)` — `n` counts characters;
  aligning to terminal/display width is an explicit non-goal.

**Case operations** (Phase 2):

- `ToUpperCase(s)` / `ToLowerCase(s)` — Unicode default (locale-independent)
  case mappings; no locale parameter in v1 (the Turkish dotless-i problem
  is documented, not solved). Note: case mapping can change the character
  count (`"ß"` uppercases to `"SS"`).
- `CaseFold(s)` — Unicode case folding, the correct primitive for
  case-insensitive comparison (`CaseFold(a) == CaseFold(b)`), rather than
  comparing `ToLowerCase` results.

**Conversions**:

- `NumberFrom(string) -> number` — entirely missing today (`DigitsFrom` is
  integer-only); follows the `From` convention.
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
- **Collation.** Character `Sort` order in v1 is Unicode scalar order of
  the cluster; locale-aware collation (and locale-sensitive casing) is
  deferred, and should arrive — if ever — as an explicit locale argument,
  never as ambient state.
- **`Text`'s role** — user-facing operator or serialization plumbing.

## Phases

1. **`character` type + collection facets.** The `character` scalar type in
   the lattice; `string <: indexed_collection<character>`; `BoxedString`
   facets (`count`, `each`, `at`); broadcast and `Flatten` atomicity;
   literal narrowing; `Characters` migration; library signature audit;
   cross-target decision for Python. Ships as one unit (constraint 8).
2. **String-preserving sequence operations + substring/case operations.**
   Curated overloads so `Reverse`, `Take`, `Drop`, `Sort`, `Join`, slicing
   return strings for string input, each documenting the re-segmentation
   caveat (constraint 3). The new operations from the Operations Review:
   substring search/replace (`StringContains`, `StringFind`,
   `StringReplace`, `StartsWith`/`EndsWith`), trim/pad/repeat, case
   operations (`ToUpperCase`/`ToLowerCase`/`CaseFold`), `NumberFrom`.
   Fix the two filed defects (`IntegerString` sign, `StringSplit` empty
   separator) no later than this phase.
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
