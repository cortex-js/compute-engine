# Strings Phase 2 — `Join`/`StringJoin` roles, sequence search, string operations

**Spec (system of record):** `docs/STRING_ROADMAP.md` — "`Join` vs.
`StringJoin`", "Missing operations (proposed)" (sequence-search family,
string-specific operations, case operations, conversions), "Future:
locale-aware collation" (shape rules 1–4, `StringCompare`), and the Phase 2
entry under "Phases". This document is the IMPLEMENTATION plan: it fixes the
implementation-level decisions the spec left open, decomposes the work into
workstreams with named files, and lists acceptance tests. Where this plan and
the spec disagree, the spec wins; the "Decisions taken here" section names
each place the plan resolves something the spec did not.

**Status:** plan written 2026-08-16. Phase 1 (character type,
string-as-collection) shipped and committed 2026-08-16
(`docs/plans/2026-08-16-string-phase1-character-type.md`).

## What Phase 2 delivers (from the spec, condensed)

1. `Join` gains the string-preserving overload: ALL operands strings →
   `string` (THE variadic concatenation). Mixed string/`list<character>`
   → generic arm (`list<character>`).
2. `StringJoin` NARROWS to `(collection<string | character>, separator?)
   -> string`; the variadic form is REMOVED (breaking, no compat spelling;
   migration = `Join(a, b)` or `"\(a)\(b)"`). Empty collection → `""`;
   one element → that element; non-finite → symbolic; non-text element →
   symbolic.
3. Sequence-search family, generic over indexed collections, character-wise
   on strings: `RangeOf(xs, needle, from?) -> range | nothing`,
   `ContainsSequence(xs, needle) -> boolean`, `StartsWith(xs, prefix)`,
   `EndsWith(xs, suffix)`. Rules: needle ALWAYS a sequence; `RangeOf`
   absent → `Nothing`, empty needle → error value, `from` ≥ 1 integer else
   error, `from` past end → `Nothing`; `ContainsSequence`/`StartsWith`/
   `EndsWith` empty needle → `True`; non-finite subject or needle →
   symbolic; `EndsWith` needs a known length. Law: `Slice(xs, RangeOf(xs,
   needle))` has the needle's element sequence.
4. String-specific: `StringReplace(s, target, replacement, count?)`,
   `Trim`/`TrimStart`/`TrimEnd(s, chars?)`, `StringRepeat(s, n)`,
   `PadStart`/`PadEnd(s, n, pad?)` — edge rules exactly as specified.
5. Case: `ToUpperCase`, `ToLowerCase`, `CaseFold` — whole-string, Unicode
   default (no locale in v1; tail left free for a future locale argument).
6. `StringCompare(a, b) -> -1 | 0 | 1` — scalar-sequence order; tail left
   free for a future `collation`.
7. `NumberFrom(s, base?) -> number | error` — the parse contract as
   specified (whitespace, sign, decimal numeral with optional fraction and
   exponent, `oo`/`+oo`/`-oo`/`NaN`; ASCII digits only; anything else,
   including `""`, is an ERROR value; exact integer / exact decimal per the
   evaluate/N contract; `base` 2–36 for integer numerals).
8. Phase-1 deferrals ruled "Phase 2 promotion candidates": string arms for
   the remaining ELEMENT-PRESERVING list-out operators `RandomShuffle`,
   `RandomSample`, `DeleteAt` (a permutation / a subset of the source's own
   characters). NOT in this phase (needs a ruling, see D9): the inner-string
   question for `Chunk`/`Partition`/`ChunkBy`/`SlidingWindow`/
   `Permutations`/`Combinations`, and `Tally`'s values half.
9. Compile targets for the new operators; docs (`doc/97-reference-strings.md`,
   `doc/82-reference-collections.md`); CHANGELOG (breaking: `StringJoin`
   variadic removal) ; ROADMAP closes.

## Decisions taken here

D1. **`Join` string arm spelling and runtime.** Overload set
    `((T+) -> T where T: string) & ((collection*) -> collection)` (bounded
    variable, not the ground type — Phase 1 lesson: an `unknown` operand
    never refutes a ground `string` arm). Runtime: no new handler — `Join`
    is a lazy collection with an `iterator`, so Phase 1's type-driven join
    step (`evaluateStringPreservingCollection` in `boxed-function.ts`: a
    lazy collection whose declared result type is `string` is walked once
    and its characters joined) materializes it. Verify the step fires for
    `Join`; if `Join`'s `type` handler (`joinResultType`) is what decides,
    give it the string case. Re-segmentation caveat documented (constraint
    3). `Join("ab", ["c","d"])` → generic arm, `list<character>`.

D2. **`StringJoin` signature** = `(collection<string | character>,
    separator: string?) -> string`. Variadic arm deleted, no compat: a
    two-string call is now a signature error (arity/type) whose message
    the doc points at `Join`/interpolation. All in-repo call sites of the
    variadic form (tests, `src/epsil/docs`, `doc/`) migrate to `Join(...)`
    or interpolation — grep `StringJoin(` first; ~60 hits.

D3. **`RangeOf` result construction.** The span is `ce.function('Range',
    [first, last])` with integer literals — that types as `range` by the
    Phase-0 rule (integer literals, ≥1, ascending, step 1); absence is
    `ce.Nothing`; signature `(indexed_collection<T>, indexed_collection<T>,
    from: integer?) -> range | nothing where T`. Search is element-wise with
    `isSame` over both sequences (strings: over `graphemes`/`each()` —
    grapheme safety falls out); O(n·m) naive scan is acceptable in v1 (a
    code-unit `indexOf` accelerator with cluster-boundary validation is a
    later optimization, not required). Subject/needle finiteness gate:
    `isFiniteCollection === true` else stay symbolic (return `undefined`).
    A needle given as a one-cluster string LITERAL narrows to a character
    only where a `character` is expected — here the needle slot is a
    collection, so `RangeOf("abc", "b")` reads `"b"` as a ONE-ELEMENT
    sequence (correct by the "needle is always a sequence" rule).

D4. **Where the operators live.** Sequence-search family in
    `library/collections.ts` (generic collection operators; keep them
    adjacent to `IndexOf`). String-specific, case, `StringCompare`,
    `NumberFrom` in `library/core.ts` next to `StringSplit`/`StringJoin`.
    No LaTeX dictionary entries (`Characters`/`StringSplit` have none;
    function-name parsing covers `\operatorname{…}` and Epsil identifiers) —
    unless the implementer finds `StringJoin`'s `definitions-other.ts:224`
    entry is load-bearing, in which case mirror it for `Join` only.

D5. **Case mapping implementation.** `ToUpperCase`/`ToLowerCase` = JS
    `toUpperCase()`/`toLowerCase()` (Unicode default, locale-independent,
    contextual: final sigma, `ß → SS`), result NFC-normalized by
    `ce.string`. `CaseFold` = `s.toUpperCase().toLowerCase()` with the
    Greek final sigma restored to medial (`ς → σ`, U+03C2 → U+03C3) so that
    `CaseFold("ΟΔΟΣ") == CaseFold("οδοσ")`. This is the accepted v1
    approximation of Unicode full case folding (JS has no casefold API);
    the deviations from UAX #44 `CaseFolding.txt` are documented in the
    handler comment (Cherokee, some Turkic/Lithuanian special cases). Tests
    pin ASCII, `ß`, and the sigma case.

D6. **`StringCompare`** = compare the two NFC scalar sequences code-point
    by code-point (NOT UTF-16 code units — the character ordering rule from
    Phase 1 D8, `cmp()` in `compare.ts`), returning `-1 | 0 | 1` as exact
    integers; signature `(string, string) -> integer` (tail free). Note
    that this order differs from the interpreter's raw string `<`
    (code-unit) only for astral vs U+E000–U+FFFF — document, don't change
    `<`.

D7. **`NumberFrom` exactness.** Integer numeral (no `.`/exponent) →
    `ce.number(BigInt/number)` exact; fractional or exponent numeral → an
    exact decimal via the engine's `Decimal`-backed `ce.number(new
    Decimal(text))` (find the existing route the LaTeX parser uses for
    `1.5e3` and reuse it — never `parseFloat`, which accepts a numeric
    PREFIX and would swallow `"12abc"` as 12; see the pitfall memory).
    Grammar exactly as specified; `"NaN"` → NaN value; failure → `ce.error(
    'invalid-number' or the closest existing code, s)` — pick the code
    with `grep -rn "'invalid-" src/compute-engine/library/core.ts` and say
    which. `base` (2–36) accepts integer numerals only (`DigitsFrom`
    semantics; reuse its `fromDigits`).

D8. **Compile targets (JS grapheme-correct where cheap; else fail closed;
    Python fails closed; GLSL/WGSL reject).** JS: `StartsWith`/`EndsWith`/
    `ContainsSequence`/`RangeOf` over segmented arrays (`_SYS.chars` for
    strings), element test `_SYS.eqt` for text; `StringReplace`, `Trim*`,
    `StringRepeat`, `Pad*` implemented on cluster arrays and re-joined
    (`.join('').normalize()`); `ToUpperCase`/`ToLowerCase`/`CaseFold` via
    the same JS calls as the interpreter (D5) — faithful by construction;
    `StringCompare` via a `_SYS` code-point comparator (`_SYS.cmpc` is
    already that — reuse); `NumberFrom` fails closed (parse contract +
    exactness). `Join` all-string → conditioned `join('')`. First verify
    that a NEW operator with no lowering entry declines (`success: false`)
    on every target — that is the default the matrix relies on; add one
    test locking it.

D9. **RULED 2026-08-16 (b) and implemented the same day** — recorded here
    after the fact; the paragraph below is the original request. Outcome:
    for a STRING source `Chunk`/`Partition`/`ChunkBy`/`SlidingWindow`/
    `Permutations`/`Combinations` return inner STRINGS (`list<string>`;
    e.g. `Chunk("abcdef", 3)` = `["ab","cd","ef"]` — `Chunk(xs, n)` makes
    n nearly-equal groups); `Tally("banana")` keeps `character` values.
    Mechanism: `innerRun` in `library/collections.ts` (a `List` normally, a
    joined string for a string source), string overload arms spelled with a
    bounded variable, and a `type` handler on `Partition` (a second
    callback-bearing arm would break the Design-D parameter stamp). Original
    request (recommendation in brackets): (a) inner strings for `Chunk`/`Partition`/`ChunkBy`/
    `SlidingWindow` on a string source — `Chunk("abcdef", 2)` →
    `["ab","cd","ef"]` vs `[["a","b"],…]` [recommend `list<string>`: each
    chunk is a contiguous run of the source's own characters];
    `Permutations`/`Combinations` of a string [recommend `list<string>`];
    `Tally("banana")` values half [recommend keep `character` — they are
    the elements]. Filed in ROADMAP by Phase 1 already; this plan leaves
    them there with the recommendation attached.

D10. **Test hygiene** — same as Phase 1 D15 (ASCII, `"é"` both forms, one
     ZWJ family, one flag; comment each non-ASCII expectation; the spec's
     three `RangeOf` grapheme examples are mandatory pins).

## Workstreams

WS-B and WS-C run in parallel (disjoint files); WS-D and WS-E after them.

### WS-B — `Join` string arm + sequence-search family + promotions
(`library/collections.ts`, `library/statistics.ts` for `RandomSample`; Opus)

Deliverables: items 1, 3, 8; D1, D3. Tests: new
`test/compute-engine/sequence-search.test.ts` (all four operators × list /
range / string subjects; the three grapheme pins; the `Slice(RangeOf)` law
element-wise AND `==` when same kind; `from` loop find-all; empty-needle
rules; symbolic on infinite subject `1..oo`; `EndsWith` on unknown length
symbolic) and additions to `test/compute-engine/string-collection.test.ts`
(`Join("ab","cd")` → `"abcd"` typed `string`; mixed → `list<character>`;
`RandomShuffle`/`RandomSample`/`DeleteAt` string arms: type `string`, value a
permutation/subset).

### WS-C — `StringJoin` narrowing + string operations + case + compare +
`NumberFrom` (`library/core.ts`; Opus)

Deliverables: items 2, 4, 5, 6, 7; D2, D5, D6, D7; migration of every
in-repo variadic `StringJoin(` call to `Join`/interpolation (tests,
`src/epsil/docs/*.md`, `doc/*.md` — `doc/` is gitignored, edit anyway).
Tests: new `test/compute-engine/string-operations.test.ts` (every operator,
every edge rule in the spec, D10 inputs; `StringJoin(StringSplit(s, sep),
sep) == s` law; `NumberFrom` grammar table incl. rejects; `CaseFold` sigma).

### WS-D — compile targets (`compilation/*`; Opus, after B/C)

D8 in full; new `test/compute-engine/compile-string-operations.test.ts`
(JS parity against the interpreter per cell; Python fail closed; GLSL/WGSL
reject; the "unknown operator declines by default" lock).

### WS-E — docs/CHANGELOG/ROADMAP (Opus, after B/C, parallel with D)

`doc/97-reference-strings.md` (all new operators, `Join`/`StringJoin`
roles, migration), `doc/82-reference-collections.md` (sequence-search
family, `Join` string arm), `src/epsil/docs/*.md` statements about string
ops; CHANGELOG (breaking: `StringJoin` variadic removal + migration; new
operators; promotions); ROADMAP: close the Phase-1 "RandomShuffle/…"
deferral, keep the D9 items with recommendations. Every example verified
empirically.

### WS-F — final gate (me)

Full suite; `/review-files`; `docs/STRING_ROADMAP.md` Phase 2 "Shipped"
note + deviations; memory; stage (never commit).

## Acceptance

- `Join("ab", "cd")` = `"abcd"` typed `string`; `StringJoin("ab", "cd")`
  is a signature error; `StringJoin(["a","b"], ", ")` = `"a, b"`;
  `StringJoin([])` = `""`.
- The spec's three grapheme pins for `RangeOf`; `Slice(xs, RangeOf(xs,
  needle))` law; find-all loop terminates with `Nothing`.
- Every edge rule in "Missing operations" has a test.
- Compile: each new operator either agrees with the interpreter or reports
  `success: false`; Python/GLSL fail closed/reject.
- Full suite green; snapshot blast radius reported.
