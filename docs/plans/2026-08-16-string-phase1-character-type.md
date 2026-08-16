# Strings Phase 1 — the `character` type and string-as-collection

**Spec (system of record):** `docs/STRING_ROADMAP.md` — "Decision: strings
become indexed collections of characters", "The `character` value model",
"Design constraints", "String preservation rule", and the Phase 1 entry
under "Phases". This document is the IMPLEMENTATION plan for that phase: it
decomposes the spec into workstreams with named files, records the
implementation-level decisions the spec left open, and lists the acceptance
tests. Where this plan and the spec disagree, the spec wins; the
"Decisions taken here" section below flags each place where the plan
resolves something the spec did not.

**Status:** plan written 2026-08-16; **all four workstreams landed the same
day** (WS-A foundation, WS-B string arms + audit fixes, WS-C compile matrix,
WS-D docs/CHANGELOG/ROADMAP). Phase 0 shipped 2026-08-15. See "Appendix B —
Resolution" at the end for what changed against this plan, and
`docs/STRING_ROADMAP.md` (Phase 1 entry) for the spec-level deviations.

## What Phase 1 delivers (from the spec, condensed)

1. A `character` primitive type (one grapheme cluster), a DISJOINT sibling
   of `string`, under `scalar`.
2. `string <: indexed_collection<character>` in the type lattice.
3. `BoxedCharacter` value + `CharacterFrom(s)` operator + `ce.character()`.
4. `BoxedString` collection facets: `isCollection`/`isIndexedCollection`,
   `count`, `each()`, `at()`, `contains()`, `indexWhere()`; grapheme array
   cached lazily; ASCII fast path; lone surrogates → U+FFFD at construction.
5. Broadcast atomicity and `Flatten` atomicity for strings.
6. `String` single-finite-collection JOIN carve-out.
7. Literal narrowing: a one-cluster string literal in a `character`-expecting
   position becomes a character; a multi-cluster literal there is a type
   error.
8. `Characters`/`GraphemeClusters` → `list<character>`; `StringJoin` accepts
   character elements.
9. The `string -> string` arm on every Phase-0 per-kind operator: `Reverse`,
   `Rest`, `Most`, `Take`, `Drop`, `Slice`, `Unique`, `Sort`,
   `RotateLeft`/`RotateRight`, `Filter`.
10. Library signature audit under the string-preservation rule.
11. Compile-target matrix (JS grapheme lowerings + explicit string exclusion;
    Python type-gate; GLSL rejection test; the `character` row decided per
    target).
12. Docs: `doc/97-reference-strings.md`, `doc/08-guide-types.md` (lattice
    tree), CHANGELOG entry with the user-code impact note, ROADMAP.

## Decisions taken here (not in the spec, or spec left them open)

D1. **`string` LEAVES `scalar`.** The spec says `string` becomes an indexed
    collection and `character` is a scalar; it does not say what happens to
    `string`'s membership in `SCALAR_TYPES`. Keeping it in both would make
    `scalar` and `collection` overlap, and every predicate that treats them
    as the two branches of `value` (`isScalar` in `subtype.ts`, the
    `broadcastable` doc "a scalar T or a collection of T", the disjointness
    tests) would carry a hidden exception. So `string` moves from
    `SCALAR_TYPES` to `INDEXED_COLLECTION_TYPES`; `character` joins
    `SCALAR_TYPES`. Doc consequence: `scalar` is "a boolean, a character, or
    a number" — `doc/08-guide-types.md` line 185 and the tree at line 81
    change. CHANGELOG must call this out (a declaration `x: scalar` no longer
    admits a string). Grep evidence that the blast radius is small: `scalar`
    appears in ONE library signature-adjacent site (none in signatures) and
    four tests.

D2. **`string` carries a HIDDEN element type, exactly like `range`.** Add
    `STRING_STRUCTURAL_TYPE = Object.freeze({kind:'indexed_collection',
    elements:'character'})` next to `RANGE_STRUCTURAL_TYPE` in
    `src/common/type/primitive.ts` and expand it at every site the
    "adding a primitive type" checklist names for `range`
    (`subtype.ts` fall-through + `broadcastableCollectionElementType` — see
    D4 for why NOT there; `utils.ts` `collectionElementType` +
    `isCollectionLike`; `instantiate.ts` `liftedElementTypeOf`,
    `isMappedActual`, `typeCouldBe…`, `walkPattern`;
    `collection-utils.ts` `typeCouldBeCollection`; `library/collections.ts`
    `mapResultType`). The element type is `character` — there is no
    "what it reported before" to match, since strings were not collections.

D3. **`typeCouldBeCollection('string')` = true; `typeCouldBeUnkeyedCollection`,
    `dimensionlessIndexedElement`, `isLinearAlgebraCollection` do NOT admit
    `string`.** The first is the "don't mistake a valueless collection-typed
    symbol for a scalar datum" predicate (materializers stay inert on it) —
    a `string`-typed symbol with no value IS such a case now. The other three
    are broadcast/threading admission and linear algebra, where strings are
    atomic (spec constraint 5).

D4. **Type-level broadcast atomicity mirrors the runtime.**
    `broadcastableCollectionElementType` (`subtype.ts`) keeps returning
    `undefined` for `string`, exactly as it does for `tuple`, so
    `string <: broadcastable<character>` is FALSE (a string is not a
    broadcast-eligible collection at the type level either). Runtime:
    `isBroadcastableCollection` (`collection-utils.ts`) adds `!isString(x)`
    beside `!isTuple(x)`.

D5. **Value-level equality bridges the two kinds; the TYPES stay disjoint.**
    `BoxedCharacter.isSame(x)` is true for a `BoxedCharacter` with the same
    NFC content AND for a `BoxedString` whose content is that same one
    cluster; `BoxedString.isSame` is symmetric. `hash` uses the SAME formula
    as `BoxedString` (`hashCode('String' + content)`) so hash agrees with
    `isSame`. Why: `Contains`, `Tally`, `Unique`, `Set` membership, `Equal`,
    `IndexOf`, pattern `match` all reduce to `isSame`, and `c == "a"`,
    `"a" in "abc"`, `IndexOf("abc", "b")` must work without adding a
    narrowing hook to each of those operators. This is a value law (two
    values with identical scalar sequences are equal), not a type
    conversion; the spec's "non-literal strings do NOT implicitly convert"
    is about the type of an expression, which this does not touch —
    `f(c: character)` still refuses a `string`-TYPED argument.

D6. **Literal narrowing lives in ONE place: argument validation.** In
    `validate.ts`, when the (instantiated) expected parameter type is
    `character` (or a union with a `character` arm and no `string` arm) and
    the actual operand is a `BoxedString` LITERAL, apply the
    `CharacterFrom` criterion: one cluster → replace the operand with
    `ce.character(content)`; otherwise → the ordinary `incompatible-type`
    error. Default parameter values, `Set` literals and pattern positions
    reach validation through the same path or through D5, so no second
    hook. Helper: `narrowStringLiteralToCharacter(ce, op): Expression |
    undefined` exported from `boxed-expression/boxed-character.ts` (single
    definition of "one character": `splitGraphemeClusters(nfc).length === 1`).

D7. **`CharacterFrom` canonical handler returns the VALUE for a valid
    literal.** `ce.box(['CharacterFrom', "'x'"])` must canonicalize to the
    identical character (spec: round-trip law), so the `canonical` handler
    returns `ce.character('x')` when the operand is a one-cluster string
    literal; for any other operand it keeps the call, and `evaluate`
    produces the character or an error value (`ce.error(...)`) for an
    empty/multi-cluster string. `BoxedCharacter.json` =
    `['CharacterFrom', "'x'"]`; `operator` = `'CharacterFrom'`;
    `type` = `BoxedType.character` (new static). Signature
    `(string) -> character`.

D8. **`BoxedCharacter` shape.** `_kind = 'character'`; `isCharacter()` type
    guard in `type-guards.ts`; `CharacterInterface { readonly string:
    string; readonly unicodeScalars: number[] }` in `types-expression.ts`
    (`string` is the one-cluster content — same property name as
    `StringInterface` so `String`'s join and `StringJoin` can read either
    kind uniformly). Canonical, pure, `complexity` 19 (same as a string).
    LaTeX/ASCII serialization mirrors `BoxedString` (`\text{x}`).
    `ce.character(s)` factory on `index.ts` AND `IComputeEngine`
    (engine-type unification rule: every new public member hits the
    interface). Ordering: `compare.ts` orders two characters by code-point
    sequence (NOT UTF-16 code units — `String.prototype.<` compares code
    units, which mis-orders astral vs U+E000–U+FFFF); a character vs a
    one-cluster string compares by the same rule; other pairs stay inert.

D9. **`Sort` keeps its optional `order` — no arity split.** Phase 0 deferred
    a `Sort` arity split "only matters with a string arm". An overload set
    with an optional parameter is legal (`(string, order: function?) ->
    string) & ((indexed_collection<T>, order: function?) -> list<T> where
    T)`), and most-specific-wins picks the `string` arm for a string
    operand, so the split buys nothing. Recorded as a deviation from the
    spec's sketch; the contract (string in → string out, comparator or not)
    is the same.

D10. **Per-kind string arm spelling.** Each operator in the set gets a
     leading `(string, …) -> string` arm in front of its Phase-0 overload
     set (or in front of its single signature, turning it into a set):
     `Reverse`, `RotateLeft`, `RotateRight`, `Rest`, `Most`, `Take`,
     `Drop`, `Slice` (both arms), `Unique`, `Sort`, `Filter` (its `type`
     handler yields `string` for a string source). Runtime: when the source
     is a `BoxedString`, the handler segments → operates on the cluster
     array → `ce.string(parts.join(''))`. Every such handler comment states
     the re-segmentation caveat (result may have a different character
     count than the input — spec constraint 3). `Filter` on a string is
     eager (strings are finite) and returns a `BoxedString`, not a lazy
     view. `String` and `Join` are NOT in this set (`Join` is Phase 2).

D11. **`Characters` returns `list<character>` of `BoxedCharacter`s;
     `StringSplit(s, "")` keeps returning one-cluster STRINGS** (ruled
     2026-08-14, unchanged). `StringJoin`'s single-collection form accepts
     character elements (`.string` on either kind).

D12. **`Flatten` atomicity**: `Flatten` (`linear-algebra.ts`) and
     `flattenToDepth` treat a `BoxedString` as a LEAF (before the
     `isFiniteIndexedCollection` branch). `Flatten("ab")` = `["ab"]`, like
     a scalar. Any other deep-descent walker that keys on
     `isFiniteIndexedCollection`/`isCollection` and is reachable from user
     input gets the same leaf check — the WS-B implementer greps for
     `isFiniteIndexedCollection(` and `.isCollection` in `library/` and
     classifies each hit.

D13. **Compile-target matrix (spec constraint 10), decided per cell:**

     | operation | JavaScript | Python | GLSL/WGSL |
     |---|---|---|---|
     | `Length(s)` | grapheme count via the target's segmenter helper — never `.length` | fail closed (type-gate) | rejected (existing diagnostic) |
     | `At(s, i)` / `s[i]` | segment then index (1-based; negative from end as `At` on lists) | fail closed | rejected |
     | iteration-derived (`Map`/`Filter`/`Reduce`/`Any`/`All`/`Contains`/`IndexOf` over a string source) | segment to an array of one-cluster JS strings, then the existing list lowering | fail closed | rejected |
     | list-out ops (`Map` etc.) | as above, result is a JS array | fail closed | rejected |
     | string-preserving ops (`Reverse`, `Take`, …) | segment → op → `join('')` | fail closed | rejected |
     | `character` scalar: `CharacterFrom("x")` literal, narrowed literal, `String(c)`, `==`/`!=`, `<`/`>` (code-point order), `list<character>` | one-cluster JS string; equality `===`; ordering via a code-point comparator helper (`_SYS`), NOT `<` | fail closed (v1) | rejected |
     | `CharacterFrom(nonLiteral)` | fail closed (would need runtime cluster-count check; not v1) | fail closed | rejected |

     JS FIRST step: `isIndexedCollectionOperand` gains an explicit
     `!t.matches('string')` (the lattice change otherwise flips it
     silently). Python: its local copy (`python-target.ts` ~line 1330) gets
     the same exclusion, plus a target-capability diagnostic for any
     string-collection operation. GLSL/WGSL: a test locking that a
     string-typed operand still produces the existing diagnostic.

D14. **Well-formedness at ingress**: `BoxedString` constructor runs one scan
     that (a) sets an `_isAscii` flag and (b) replaces each lone surrogate
     with U+FFFD (`String.prototype.toWellFormed` is available on Node ≥ 20;
     use it, guarded by a manual fallback for older hosts). NFC
     normalization stays.

D15. **Test hygiene (spec constraint 11)**: tests use ASCII, `"é"` (U+00E9
     and the decomposed pair), one ZWJ emoji family sequence, and one
     regional-indicator flag; each non-ASCII expectation carries a comment
     naming the assumed Unicode behavior. No snapshot tests over exotic
     clusters.

## Workstreams

### WS-A — Foundation (one Opus implementer, must land first)

Files: `src/common/type/types.ts`, `primitive.ts`, `subtype.ts`,
`utils.ts`, `instantiate.ts`, `boxed-type.ts`;
`src/compute-engine/boxed-expression/boxed-string.ts`, NEW
`boxed-character.ts`, `type-guards.ts`, `validate.ts`, `compare.ts`,
`serialize*.ts` as needed; `src/compute-engine/types-expression.ts`,
`types-engine.ts`/`global-types.ts`, `index.ts`;
`src/compute-engine/collection-utils.ts`; `library/core.ts`
(`CharacterFrom`, `Characters`, `GraphemeClusters`, `String` carve-out,
`StringJoin`), `library/collections.ts` (`mapResultType`),
`library/linear-algebra.ts` (`Flatten` leaf), `compilation/javascript-target.ts`
+ `python-target.ts` (explicit string exclusion ONLY — lowerings are WS-C).

Deliverables: items 1–8 of "What Phase 1 delivers", D1–D8, D11–D12, D14, the
JS/Python explicit exclusions from D13. Definition of done: `npm run
typecheck` clean; `./node_modules/@typescript/native/bin/tsc -p tsconfig.json
--noEmit` clean; madge clean; NEW test file
`test/compute-engine/character-type.test.ts` (value model: construction,
validation errors, equality/hash, ordering, JSON round-trip, `String(c)`,
narrowing at a `character` param, disjointness `ce.type('character')
.matches('string') === false` and vice-versa, `string <:
indexed_collection<character>`, `string` NOT `<: scalar`, `character <:
scalar`) and NEW `test/compute-engine/string-collection.test.ts`
(`Length("shop") == 4`, `Length("é")` both forms, ZWJ family length 1,
`"abc"[2]`, `for c in "abc"`, `"a" in "abc"`, `Contains`, `IndexOf`,
`Tally`, `Unique`, `Map(c => …, "abc")` is a `list`, `Characters` yields
characters, `String(Characters(s)) == s`, `StringJoin(Characters(s)) == s`,
broadcast atomicity: `String("ab", 1)` and a scalar-param lambda applied to
a string receives the whole string, `Flatten(["ab","cd"])`, `Sum("abc")`
stays symbolic/errors and never crashes, lone surrogate → U+FFFD). Then the
FULL suite once (only one jest at a time — check `pgrep -f "bin/[j]est"`),
classifying every failure as (a) expected churn to fix here (e.g. snapshots
of `Characters` output — never `-u` an `@fixme`), (b) a real regression to
fix here, or (c) pre-existing (message-based, since `git stash` is
blocked). Report the counts.

### WS-B — Per-kind string arms + operator sweep (Opus implementer, after A)

Files: `library/collections.ts` (`Reverse`, `Rest`, `Most`, `Take`,
`Drop`, `Slice`, `Unique`, `Sort`, `RotateLeft`, `RotateRight`, `Filter`),
`compare.ts` if WS-A left character ordering incomplete.

Deliverables: D9, D10; each handler comment carries the re-segmentation
caveat; tests appended to `string-collection.test.ts` under a
"string-preserving operators" describe: static type (`ce.parse(...).type`
is `string`) AND value for each operator, plus one re-segmentation example
(`Reverse("é")` — the combining mark lands first — documented, not
asserted on a specific count beyond "is a string"). Also D12's walker sweep.
Definition of done: typecheck + the two new test files + `collections`,
`type-variables-collections`, `range-type` suites green.

### WS-C — Compile targets (Opus implementer, after A; parallel with B)

Files: `compilation/javascript-target.ts` (+ `_SYS` runtime helpers),
`python-target.ts`, GLSL/WGSL test only.

Deliverables: D13 in full. Tests: `test/compute-engine/compile-string-collection.test.ts`
(JS: every green cell compiles AND agrees with the interpreter on the D15
inputs; every "fail closed" cell reports `success: false`), additions to
`compile-python-string-fail-closed.test.ts`, and a GLSL/WGSL rejection
test. Definition of done: typecheck + those files + `compile.test.ts` green.

### WS-D — Signature audit + docs + changelog (Opus implementer, after A;
parallel with B/C; docs part may go to mechanic if it reduces to a recipe)

Deliverables: (1) an audit table in THIS document (appendix) of every
library signature that admits `collection<T>` / `indexed_collection<T>` /
`collection`, classified: string-preserving (Phase 1 arm — must be in
WS-B's list), list-out (Phase 2 promotion candidate or permanent), free
(no code needed), or must-EXCLUDE strings (with the fix applied — e.g. an
operator whose evaluate would crash or lie on a string source). Anything
that must exclude strings and is not fixed here goes into `ROADMAP.md`. (2)
`doc/97-reference-strings.md` rewritten for the new model (strings ARE
collections; `Characters` → `list<character>`; the `character` type; the
preservation rule; the re-segmentation caveat; the compile matrix). (3)
`doc/08-guide-types.md`: tree + `scalar` row + a `character` row. (4)
`CHANGELOG.md`: breaking-change entry — lattice change, `string` no longer
`scalar`, `Characters` element type, static result types of the per-kind
operators, advice to re-audit `where T: collection` constraints and how to
exclude strings (`T: collection & !string` if the negation spelling
exists — verify, else name the spelling that does). (5) `ROADMAP.md`
entries for anything discovered and deferred with a reason.

### WS-E — Final gate (me)

Full suite; `npm run typecheck`; `check:deps`; `/review-files` over the
touched files; update `docs/STRING_ROADMAP.md` Phase 1 entry with "Shipped
2026-08-16" + the deviations (D1, D5, D9); memory update; stage (never
commit).

## Sequencing

```
WS-A ──► (WS-B ‖ WS-C ‖ WS-D) ──► WS-E
```

WS-B/C/D each edit disjoint files (B: `collections.ts`; C: `compilation/`;
D: docs + `CHANGELOG.md` + `ROADMAP.md`) — if D's audit needs a fix inside
`collections.ts`, it hands the finding to me and I route it to B (or apply
it after B reports).

## Acceptance (the whole phase)

- `isDigit(c) = c in "0123456789"` and `Length("shop")` from the roadmap's
  motivating example work verbatim.
- All spec laws hold: `String(Characters(s)) == s`; `CharacterFrom(String(c))
  == c`; `box(json(c)) === c`; `Slice(s, RangeOf…)` is Phase 2 (n/a).
- Type facts: `string <: indexed_collection<character>`; `character` and
  `string` mutually non-subtypes; `string` NOT `<: scalar`; `list<character>`
  NOT `<: string` and vice-versa; `string` NOT `<: broadcastable<character>`.
- Every per-kind operator: string in → `string` static type AND string value.
- Compile matrix: each cell behaves as D13 says, tested.
- Full suite green modulo classified pre-existing failures; snapshot blast
  radius reported as a number.


## Appendix A — Library signature audit (read-only survey, 2026-08-16)

Produced by a read-only survey of the library BEFORE the WS-B/WS-D fixes; the tree it read already had `isBroadcastableCollection`/`isFiniteBroadcastParticipant` excluding strings (WS-A in flight). Every MUST-EXCLUDE row and every walker/gate row below must be resolved by WS-A/WS-B/WS-D (fixed, or ruled non-defect with the reason written next to it) before Phase 1 is declared shipped. Rows conditional on "a character is itself a string/collection" are MOOT under plan D1 (character is a disjoint non-collection scalar) — mark them so rather than fixing them.

I explored the library and the runtime collection machinery. Here is the audit.

---

# Preliminaries (things that constrain every row below)

**The intended design already exists in-tree.** `docs/STRING_ROADMAP.md:250-277` ("String preservation rule") and `docs/STRING_ROADMAP.md:278-356` ("Signature refinement") define exactly the STRING-PRESERVING / LIST-OUT split, and `docs/STRING_ROADMAP.md:549-568` lists what becomes "free". My findings below are keyed to that but include operators the roadmap does **not** list.

**Two guards already exist and are the precedent for a string leaf-check:**
- `src/compute-engine/collection-utils.ts:278` — `isBroadcastableCollection(x) = x.isIndexedCollection === true && !isTuple(x) && !isString(x)`
- `src/compute-engine/collection-utils.ts:295` — `isFiniteBroadcastParticipant(x) = isFiniteIndexedCollection(x) && !isTuple(x) && !isString(x)`, whose doc comment cites "`docs/STRING_ROADMAP.md` design constraint 5".
- `src/compute-engine/library/core.ts:320` (`pipeImplicitMap`) — `if (isString(topic) || topic.type.matches('string')) return undefined;`
- `src/compute-engine/library/collections.ts:9556` (`enlist`) — `else if (isString(x)) { … result.push(x); }` with the comment *"A string is a collection (of strings), but we don't want to iterate it recursively"*.

**A termination hazard that gates several rows.** `character` does not exist in the type lattice today (no hit in `src/common/type/*`; `src/common/type/types.ts:24` only names `string`). If a one-grapheme `character` value is itself a `string` (and therefore itself `isCollection === true` with one element — itself), then every *recursive* element walk below becomes non-terminating. I flag each such site explicitly; the verdict "infinite recursion" is conditional on that modelling choice, "wrong value" is not.

---

# STRING-PRESERVING

Subset/reordering of the input's own elements; result must be `string` for a `string` input.

## Confirmed members (the roadmap's list)

| Operator | file:line | Declared signature |
| --- | --- | --- |
| `Reverse` | `src/compute-engine/library/collections.ts:6054` | `((T) -> T where T: list) & ((indexed_collection<T>) -> list<T> where T)` |
| `Rest` | `src/compute-engine/library/collections.ts:5853` | `(indexed_collection<T>) -> list<T> where T` |
| `Most` | `src/compute-engine/library/collections.ts:5920` | `(indexed_collection<T>) -> list<T> where T` |
| `Take` | `src/compute-engine/library/collections.ts:5543` | `(xs: indexed_collection<T>, count: number) -> list<T> where T` |
| `Drop` | `src/compute-engine/library/collections.ts:5635` | `(xs: indexed_collection<T>, count: number) -> list<T> where T` |
| `Slice` | `src/compute-engine/library/collections.ts:5979` | `((value: indexed_collection<T>, span: range) -> list<T> where T) & ((value: indexed_collection<T>, start: number, end: number) -> list<T> where T)` |
| `Unique` | `src/compute-engine/library/collections.ts:7238` | `(collection<T>) -> list<T> where T` |
| `Sort` | `src/compute-engine/library/collections.ts:6804` | `(indexed_collection<T>, order: function?) -> list<T> where T` |
| `RotateLeft` | `src/compute-engine/library/collections.ts:6423` | `((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)` |
| `RotateRight` | `src/compute-engine/library/collections.ts:6526` | `((T, integer?) -> T where T: list) & ((indexed_collection<T>, integer?) -> list<T> where T)` |
| `Filter` | `src/compute-engine/library/collections.ts:3608` | `(collection<T>, predicate: callback<(T) -> boolean>) -> collection where T` |

Note on `Sort`: its `evaluate` (`collections.ts:6819-6832`) rebuilds unconditionally as `ce.function('List', …)`, with a comment pinning "never the source's head". A `string -> string` arm requires overriding that pin, which `docs/STRING_ROADMAP.md:317-326` already anticipates.

## OTHER operators that fit the same description — for a human to rule on

These are **not** in the roadmap's preservation list but are subsets/reorderings of the source's own elements.

| Operator | file:line | Declared signature | Why it fits / evidence |
| --- | --- | --- | --- |
| `TakeWhile` | `src/compute-engine/library/collections.ts:4242` | `(collection<T>, predicate: callback<(T) -> boolean>) -> collection where T` | **Already promises kind preservation**: `type: (ops) => ops[0].type` (`collections.ts:4254`). For a string operand the static type says `string` while the runtime is a lazy character view → static/runtime disagreement (roadmap constraint 8). Must be decided, not deferred. |
| `DropWhile` | `src/compute-engine/library/collections.ts:4388` | `(collection<T>, predicate: callback<(T) -> boolean>) -> collection where T` | Same: `type: (ops) => ops[0].type` at `collections.ts:4397`. |
| `Dedup` | `src/compute-engine/library/collections.ts:7257` | `(collection) -> collection` | Same: `type: (ops) => ops[0].type` at `collections.ts:7269`. Collapses adjacent runs — a strict subset of the source's own characters. |
| `RandomShuffle` | `src/compute-engine/library/collections.ts:6986` | `(indexed_collection<T>) random -> list<T> where T` | A permutation; comment at `collections.ts:7040` says "A permutation of the source: length-preserving". `evaluate` rebuilds as `List` (`collections.ts:7049`). |
| `RandomSample` | `src/compute-engine/library/statistics.ts:823` | `(indexed_collection, number) random -> list` | Draws `k` *positions* without replacement (`statistics.ts:847-860`) — a subset of the source's own elements. |
| `DeleteAt` | `src/compute-engine/library/collections.ts:6244` | `(indexed_collection<T>, integer) -> list<T> where T` | Removes one element; result is a strict subset in original order. (`Insert`/`ReplaceAt`, `collections.ts:6132`/`6335`, are **not** — they introduce a foreign element.) |
| `RandomChoice` | `src/compute-engine/library/core.ts:4642` | `(collection \| set<real>, number) random -> list<any>` | Draws *with* replacement, so it is a multiset over the source's own elements — arguably preserving, arguably list-out. Human call. |
| `Permutations` | `src/compute-engine/library/combinatorics.ts:428` | `(collection, integer?) -> list<list>` | Each *inner* element is a reordering of the source's own characters. `list<string>` vs `list<list<character>>` is a real choice. |
| `Combinations` | `src/compute-engine/library/combinatorics.ts:469` | `(collection, integer) -> list<list>` | Same: each inner element is a subset. |
| `Partition` | `src/compute-engine/library/collections.ts:7388` | `(collection<T>, integer \| callback<(T) -> boolean>, integer?) -> list<list<T>> where T` | Outer is list-out; each *inner* chunk is a contiguous subset — `list<string>` is defensible. |
| `Chunk` | `src/compute-engine/library/collections.ts:7519` | `(collection, integer) -> list<list>` | Same shape (`evaluate` at `collections.ts:7549` builds `List` per chunk). |
| `ChunkBy` | `src/compute-engine/library/collections.ts:7569` | `(collection<T>, key: function) -> list<list<T>> where T` | Same. |
| `SlidingWindow` | `src/compute-engine/library/statistics.ts:677` | `(collection, integer, integer?) -> list<list>` | Same: each window is a contiguous subset. |
| `Cycle` | `src/compute-engine/library/collections.ts:8009` | `(list) -> list` | Repeats the source's own elements forever. Element-preserving but **infinite**, so a `string` result is impossible — I'd call this LIST-OUT, but listing it because it matches "element-preserving". |

`Intersection`/`SetMinus`/`Complement`/`SymmetricDifference` (`sets.ts:869/956/838/995`) are element-preserving but their declared result is `set`, which is unordered — so they are **not** string-preserving. Listed under LIST-OUT.

---

# LIST-OUT

Result is a new collection, not a subset/reorder of the source.

| Operator | file:line | Declared signature | Note |
| --- | --- | --- | --- |
| `Map` | `src/compute-engine/library/collections.ts:3211` | `(mapping: callback<(T) -> U>, collection<T>+) -> indexed_collection where T, U` | Permanently list-out per `docs/STRING_ROADMAP.md:269-277`. |
| `FlatMap` | `src/compute-engine/library/collections.ts:4480` | `(collection<T>, mapping: callback<(T) -> U>) -> list where T, U` | **Also a splice hazard** — see walker list: `collections.ts:4580` splices any `mapped.isCollection`, so a *string-returning* callback would newly explode into characters. |
| `Scan` | `src/compute-engine/library/collections.ts:4081` | `(collection<T>, reducer: callback<(unknown, T) -> unknown>, initial: value?) -> indexed_collection where T` | |
| `Zip` | `src/compute-engine/library/collections.ts:7779` | `(indexed_collection+) -> list` | |
| `Join` | `src/compute-engine/library/collections.ts:4602` | `(collection*) -> collection` | Roadmap defers the string-preserving overload to Phase 2 (`STRING_ROADMAP.md:570-618`). |
| `Append` | `src/compute-engine/library/collections.ts:4739` | `(collection, value+) -> collection` | Introduces foreign elements. |
| `GroupBy` | `src/compute-engine/library/collections.ts:7715` | `(collection, key: function) -> dictionary<list>` | |
| `Tally` | `src/compute-engine/library/collections.ts:7220` | `(collection<T>) -> tuple<list<T>, list<integer>> where T` | The values half becomes `list<character>`; `list<string>` is defensible. |
| `Position` | `src/compute-engine/library/collections.ts:6735` | `(collection<T>, predicate: callback<(T) -> boolean>) -> list<integer> where T` | Indices, not elements. |
| `Ordering` | `src/compute-engine/library/collections.ts:6778` | `(indexed_collection, order: function?) -> list<integer>` | Indices. |
| `ListFrom` | `src/compute-engine/library/collections.ts:8145` | `(value*) -> list` | **Silent behavior change**: `evaluate` at `collections.ts:8165` takes the `!xs.isCollection` branch today (a string is pushed whole → `["abc"]`); after the change it takes `elements.push(...Array.from(xs.each()))` → `["a","b","c"]`. Arguably the desired explode-a-string spelling — but it is a break. |
| `SetFrom` | `src/compute-engine/library/collections.ts:8220` | `(value*) -> set` | Same flip at `collections.ts:8237-8250`. |
| `TupleFrom` | `src/compute-engine/library/collections.ts:8255` | `(value*) -> tuple` | Same flip at `collections.ts:8263-8276`. |
| `DictionaryFrom` | `src/compute-engine/library/collections.ts:8281` | `(collection) -> dictionary` | `collections.ts:8290` gate flips; then `collections.ts:8316` `if (!isString(key))` rejects — stays inert. Low risk. |
| `Union` | `src/compute-engine/library/sets.ts:904` | `(collection+) -> set` | `sets.ts:1073` wraps a non-collection operand in `Set([op])`; a string stops being wrapped → `Union(Set(1), "ab")` goes from `Set(1,"ab")` to `Set(1,"a","b")`. |
| `Intersection` | `src/compute-engine/library/sets.ts:869` | `(collection+) -> set` | Gate at `sets.ts:1110` (`ops.every(op => op.isCollection)`) newly admits strings; `[...first.each()]` at `sets.ts:1126`. |
| `Complement` | `src/compute-engine/library/sets.ts:838` | `(set+) -> set` | |
| `SymmetricDifference` | `src/compute-engine/library/sets.ts:995` | `(set, set) -> set` | |
| `Adjoin` | `src/compute-engine/library/sets.ts:797` | `(set, any+) -> set` | |
| `CartesianProduct` | `src/compute-engine/library/combinatorics.ts:370` | `(set+) -> set` | `contains` handler at `combinatorics.ts:382` uses `x.isCollection` on the *candidate*. |
| `PowerSet` | `src/compute-engine/library/combinatorics.ts:403` | `(set) -> set` | `combinatorics.ts:412` same shape. |
| `Cycle` | `src/compute-engine/library/collections.ts:8009` | `(list) -> list` | Infinite; cannot be a string. |
| `Histogram` | `src/compute-engine/library/statistics.ts:626` | `(collection, number \| list<number>) -> list<tuple<number, integer>>` | Safe: `computeBinning` filters `Number.isFinite(x.re)` (`statistics.ts:88-91`), a character's `.re` is NaN → `data.length === 0` → `undefined` (inert). |
| `BinCounts` | `src/compute-engine/library/statistics.ts:658` | `(collection, number \| list<number>) -> list<number>` | Same helper, same inert outcome. |

---

# FREE

Result is not a collection of the source's kind.

## Structural / positional — no new code needed

| Operator | file:line | Declared signature |
| --- | --- | --- |
| `Length` | `src/compute-engine/library/collections.ts:1917` | `(any) -> integer` |
| `IsEmpty` | `src/compute-engine/library/collections.ts:3118` | `(collection) -> boolean` |
| `Contains` | `src/compute-engine/library/collections.ts:2979` | `(collection, element: any) -> boolean` |
| `Count` | `src/compute-engine/library/collections.ts:3010` | `(collection, any?) -> integer` |
| `CountIf` | `src/compute-engine/library/collections.ts:6693` | `(collection<T>, predicate: callback<(T) -> boolean>) -> integer where T` |
| `Any` | `src/compute-engine/library/collections.ts:3152` | `(collection<T>, predicate: callback<(T) -> boolean>?) -> boolean where T` |
| `All` | `src/compute-engine/library/collections.ts:3183` | `(collection<T>, predicate: callback<(T) -> boolean>?) -> boolean where T` |
| `IndexOf` | `src/compute-engine/library/collections.ts:6603` | `(collection, any) -> integer` |
| `IndexWhere` | `src/compute-engine/library/collections.ts:6614` | `(collection<T>, predicate: callback<(T) -> boolean>) -> integer where T` |
| `Find` | `src/compute-engine/library/collections.ts:6652` | `(collection<T>, predicate: callback<(T) -> boolean>) -> any where T` |
| `At` | `src/compute-engine/library/collections.ts:5083` | `(value: indexed_collection \| dictionary, index: (number\|string\|boolean\|indexed_collection)+) -> unknown` |
| `First`/`Second`/`Third`/`Last` | `collections.ts:5733`/`5743`/`5753`/`5843` | `(xs: indexed_collection) -> any` |
| `Reduce` | `src/compute-engine/library/collections.ts:3878` | `(collection<T>, reducer: callback<(unknown, T) -> unknown>, initial: value?) -> value where T` |
| `Fold` | `src/compute-engine/library/collections.ts:4052` | `(reducer: callback<(unknown, T) -> unknown>, initial: value, collection<T>) -> value where T` |
| `MaxBy`/`MinBy` | `collections.ts:6838`/`6866` | `(collection, key: function) -> value` |
| `ArgMax`/`ArgMin` | `collections.ts:6898`/`6943` | `(indexed_collection, key: function?) -> integer` |
| `Element`/`NotElement` | `sets.ts:489`/`636` | `(value, collection, boolean?) -> boolean` |
| `Subset`/`SubsetEqual`/`Superset`/`SupersetEqual` | `sets.ts:661`/`678`/`708`/`725` | `(lhs:collection, rhs: collection) -> boolean` |

Two implementation notes, not classification issues:
- `At` dispatches on `expr.baseDefinition?.collection?.at` (`collections.ts:5437`). `BoxedString` (`src/compute-engine/boxed-expression/boxed-string.ts`) has no `collection` handlers, no `each`, no `at`, no `count` override, so `At("abc", 2)` returns `undefined` (inert) until those are added. Same for `Length`, which reads `xs.count` at `collections.ts:1966`.
- `At` checks the string-key branch (`collections.ts:5460`) **before** the collection-index branch (`collections.ts:5473`), so a string *index* stays a dictionary key. Safe as written.

## Numeric aggregators — what the handler actually does with character elements

| Operator | file:line | Declared signature | Behavior with character elements |
| --- | --- | --- | --- |
| `Sum` | `src/compute-engine/library/arithmetic.ts:3640` | `(any, tuple*) -> number` | **Typed error.** Arity-1 collection form (`arithmetic.ts:3667`) folds via `sumAccumulate` → `reducerElementError` (`arithmetic.ts:3918-3924`): `if (isString(term)) return acc.engine.typeError('number', term.type);`. Already deliberate — its doc comment says "*Keeps `Sum` and `Product` consistent (both surface the same typed error on a string element)*". |
| `Product` | `src/compute-engine/library/arithmetic.ts:3501` | `(any, tuple*) -> number` | **Typed error**, same guard, at `arithmetic.ts:3565` and `arithmetic.ts:3622` (`reducerElementError(acc, xe) ?? acc.mul(xe)`). |
| `Mean`, `Median`, `Variance`, `PopulationVariance`, `StandardDeviation`, `PopulationStandardDeviation`, `Kurtosis`, `Skewness`, `Mode`, `Quartiles`, `InterquartileRange` | `statistics.ts:286`, `320`, `347`, `377`, `403`, `437`, `466`, `492`, `518`, `544`, `596` | `((collection\|number\|distribution)+) -> number` (variants) | **Symbolic / inert — safe.** All route through `collectData` (`statistics.ts:929-946`), which walks `op.each()` and does `if (!isNumber(v)) return null;`. A character is a `BoxedString` → `null` → every handler returns `undefined`. |
| `Max`, `Min`, `Supremum`, `Infimum` | `arithmetic.ts:3295`, `3331`, `3396`, `3408` | `(value*) -> number` / `(value+) -> number` | **Unbounded recursion (crash), conditional on the character model.** `processMinMaxItem` (`arithmetic.ts:4325`) takes the `if (item.isCollection)` branch and calls **itself** on each element (`arithmetic.ts:4341`). A one-character string is again a collection of one character → no base case → `RangeError: Maximum call stack size exceeded`. If characters are made non-collections, the fallthrough at `arithmetic.ts:4371` (`if (!item.isNumber \|\| !isNumber(item)) return [undefined, [item]]`) leaves it symbolic — safe. |
| `GCD`, `LCM` | `arithmetic.ts:3118`, `3152` | `(any*) -> number` | **Non-terminating loop (hang), conditional on the character model.** `arithmetic.ts:4497-4520`: `while (ok && current.some((x) => x.isCollection)) { … expanded.push(el) … }`. Expanding `"abc"` yields three one-character strings, each still `isCollection` → the fixpoint never converges. Not stack overflow — a live-lock bounded only by the evaluation deadline. |
| `Norm` | `linear-algebra.ts:1622` | `(value, number\|string?) -> number` | **Inert — safe.** `x.isNumber` false; `isFunction(x,'Tuple')` false; `isPointListValue(x)` false; then `if (!isTensorValue(x)) return undefined` (`linear-algebra.ts:1773`). `isTensorValue` requires a `List` head (`boxed-expression/tensor-view.ts:95` → `tensor-view.ts:120`, `isFunction(x, 'List')`). |
| `Distance` | `arithmetic.ts:3420` | `(tuple \| list<tuple> \| list<number> \| list<list<number>>, …) -> number` | **Inert — safe.** `pointOperand` (`arithmetic.ts:3995`) requires `if (!isNumber(el)) return undefined` (`arithmetic.ts:4009`). |
| `Covariance`, `PopulationCovariance`, `Correlation` | `statistics.ts:733`, `745`, `757` | `(collection, collection?) -> number` | **Definite wrong value (`NaN`).** `extractPairs` (`statistics.ts:1111`) has **no** numeric guard — the 2-arg branch (`statistics.ts:1128-1132`) just does `[...a.each()]`. `machineVals` (`statistics.ts:1141`) maps each character to `numberLiteralOf(v)?.re ?? NaN`, and `evaluateCovariance` returns `ce.number(NaN)` (`statistics.ts:1185`). Asymmetric with `collectData`, which *does* guard. |
| `LinearRegression`, `PolynomialFit` | `statistics.ts:777`, `788` | `(any+) -> tuple<number, number>` / `(any+) -> list<number>` | Same `extractPairs` route (`statistics.ts:1318`) → same `NaN` coefficients. |
| `ChineseRemainder`, `FromContinuedFraction`, `FromDigits` | `number-theory.ts:519`, `682`, `882` | `(collection, collection) -> integer` / `(collection) -> number` / `(collection, integer?) -> integer` | **Inert — safe.** All do `Array.from(op.each()).map(toBigint)` then `if (… .includes(null)) return undefined` (`number-theory.ts:527`, `689`, `891`). `toBigint` of a character is `null`. |

---

# MUST-EXCLUDE

Iterating the string as characters is a lie or a crash. Concrete behavior today when the operand's `.isCollection === true` with character elements:

| Operator | file:line | Declared signature | What happens concretely |
| --- | --- | --- | --- |
| `Flatten` | `src/compute-engine/library/linear-algebra.ts:330` | `(value, integer?) -> list` | **Stack overflow.** One-arg form reaches `linear-algebra.ts:386`: `if (isFiniteIndexedCollection(op1)) return ce.function('List', flattenToDepth(op1, Infinity))`. `flattenToDepth` (`linear-algebra.ts:3956-3964`) is `for (const e of xs.each()) { if (depth >= 1 && isFiniteIndexedCollection(e)) result.push(...flattenToDepth(e, depth - 1)) … }` — and `Infinity - 1 === Infinity`, so a one-character string recurses into itself forever. The explicit-depth form (`linear-algebra.ts:359`) terminates but still shreds the string. |
| `Transpose` | `src/compute-engine/library/linear-algebra.ts:396` | `(value, axis1: integer?, axis2: integer?) -> value` | **Silent string→list conversion.** `linear-algebra.ts:407`: `if (!isTensorValue(op1) && isFiniteIndexedCollection(op1)) op1 = ce.function('List', [...op1.each()])`. `packStructural` then reports rank 1 and `linear-algebra.ts:427` returns `op1` — i.e. `Transpose("abc")` → `["a","b","c"]`, not `"abc"`. |
| `ConjugateTranspose` | `src/compute-engine/library/linear-algebra.ts:444` | `(value, axis1: integer?, axis2: integer?) -> value` | No `isFiniteIndexedCollection` conversion, so it falls to `packStructural(ce, op1)` → `undefined` → inert. Listed for completeness alongside `Transpose`. |
| `Reshape` | `src/compute-engine/library/linear-algebra.ts:261` | `(value, tuple) -> value` | **Silent string→list conversion.** `linear-algebra.ts:307`: same `ce.function('List', [...op1.each()])` rewrite. `Reshape("abcdef", (2,3))` would yield `[["a","b","c"],["d","e","f"]]`, while the `type` handler at `linear-algebra.ts:265-277` returns `'nothing'` (not a `list`, not a numeric element type) → static/runtime disagreement on top of the semantic lie. |
| `Shape` | `src/compute-engine/library/linear-algebra.ts:234` | `(value) -> tuple` | **Definite lie.** `evaluate: ([xs], {engine: ce}) => ce.tuple(...xs.shape)`. `BoxedString` has no `shape` override, so the base answers `[]` (`boxed-expression/abstract-boxed-expression.ts:954`) → `Shape("abc")` is `()`, the shape of a *scalar*, for a value the lattice now calls a rank-1 indexed collection. Note `canEnumerate: () => true` at `linear-algebra.ts:242` claims the handler *never* declines. |
| `Rank` | `src/compute-engine/library/linear-algebra.ts:245` | `(value) -> number` | Same: `xs.rank` → `abstract-boxed-expression.ts:958` returns `0`. `Rank("abc")` = 0. |
| `Dimension` | `src/compute-engine/library/linear-algebra.ts:835` | `(value) -> integer` | **Wrong value.** The size helper at `linear-algebra.ts:3842` does `if (isFiniteIndexedCollection(value)) { let count = 0; for (const _ of value.each()) count += 1; return count; }` → `Dimension("abc")` = 3, reported as a *vector-space* dimension. |
| `GCD`, `LCM` | `arithmetic.ts:3118`, `3152` | `(any*) -> number` | Non-terminating expansion loop — see FREE table. |
| `Max`, `Min`, `Supremum`, `Infimum` | `arithmetic.ts:3295/3331/3396/3408` | `(value*) -> number` | Unbounded recursion — see FREE table. |
| `Quantile` | `src/compute-engine/library/distributions.ts:231` | `(distribution \| collection, number) -> number` | **Wrong value *and* a return-type violation.** `empiricalQuantile` (`distributions.ts:508`) does `const data = [...coll.each()]` then `data.sort((a, b) => a.re - b.re)` (`distributions.ts:519`) — every character's `.re` is `NaN`, so the comparator always returns `NaN` and the sort is a no-op. `pv <= 0` / `>= 1` / `n === 1` then `return sorted[0]` — a **character (a `string`)** returned from a `-> number` signature. |
| `Differences` | `src/compute-engine/library/collections.ts:4180` | `(collection) -> indexed_collection` | Each element is `ce.function('Subtract', [value, prev]).evaluate()` (`collections.ts:4256`, `at` handler at `collections.ts:4270`). `Differences("abc")` produces a list of unevaluated `Subtract('b','a')` nodes. Nonsense, but inert rather than crashing. Its `type` handler (`collections.ts:4185`) would claim `list<character>`. |
| `StringFrom` | `src/compute-engine/library/core.ts:5210` | `(any, format:string?) -> string` | **Regression from a good error to garbage.** Three gates flip: `core.ts:5216`, `core.ts:5232`, `core.ts:5251` all read `if (!value.isIndexedCollection) return engine.typeError(parseType('indexed_collection<integer>'), value.type)`. Today `StringFrom("abc", "utf-8")` is a clean type error; after the change the gate passes and `[...value.each()].map((x) => toInteger(x) ?? 0xfffd)` (`core.ts:5222`) yields `"\uFFFD\uFFFD\uFFFD"`. |
| `SetMinus` | `src/compute-engine/library/sets.ts:956` | `(set, value*) -> set` | **Semantics flip.** `isExcludedBy` (`sets.ts:1200-1206`): `if (val.isCollection) return val.contains(x) === true; return val.isSame(x);`. A trailing string operand switches from *excluding itself as a value* to *excluding its characters as members* — so `SetMinus(Set("ab","cd"), "ab")` stops removing `"ab"`. Same flip in the three-valued twin `isExcludedByKleene` (`sets.ts:1216`). |
| `Subscript` | `src/compute-engine/library/core.ts:4719` | `(collection, any) -> any` | The `canonical` handler checks `isString(op1)` first (`core.ts:4803`) so the base-conversion reading survives — **but the `type` handler's string branch is narrower**: `core.ts:4750` requires `isString(op1) && asSmallInteger(op2) !== null`, then falls through to `if (op1.isIndexedCollection) return collectionElementType(…)` at `core.ts:4756`. For a non-integer subscript the type says "character" while `canonical` produces a `Baseform` error node. |

---

# Deep-descent walkers needing a string leaf-check

Sites in `src/compute-engine/library/` and `src/compute-engine/boxed-expression/` (excluding `compilation/`) that call `isFiniteIndexedCollection(`, `.isIndexedCollection`, or `.isCollection` inside a walk that **recursively descends into elements**.

| file:line | Walker | Descent shape | Consequence without a leaf-check |
| --- | --- | --- | --- |
| `src/compute-engine/library/linear-algebra.ts:3956` | `flattenToDepth` | Direct self-recursion on `isFiniteIndexedCollection(e)` (`linear-algebra.ts:3960`) | Unbounded recursion at `depth = Infinity` (the `Flatten` one-arg call site, `linear-algebra.ts:386`) |
| `src/compute-engine/library/arithmetic.ts:4325` | `processMinMaxItem` | Self-recursion inside `if (item.isCollection)` (`arithmetic.ts:4325`, recursive call `arithmetic.ts:4341`) | Unbounded recursion for `Max`/`Min`/`Supremum`/`Infimum` |
| `src/compute-engine/library/arithmetic.ts:4497` | GCD/LCM operand flatten | Iterative fixpoint `while (… current.some((x) => x.isCollection))` (`arithmetic.ts:4500`, inner test `arithmetic.ts:4503`) | Non-terminating expansion |
| `src/compute-engine/library/collections.ts:4580` | `FlatMap` `collection.iterator` | One-level splice `if (mapped.isCollection) inner = mapped.each()` | A string-returning callback newly explodes into characters |
| `src/compute-engine/library/statistics.ts:1111` | `extractPairs` | One-level descent `for (const el of arg.each()) { if (!el.isFiniteCollection) return null; … }` (`statistics.ts:1119-1122`) | Silent `NaN` for `Covariance`/`Correlation`/`LinearRegression`/`PolynomialFit` |
| `src/compute-engine/library/collections.ts:9535` | `enlist` | Recursive over `Sequence` and lazy sub-collections (`collections.ts:9553`, `9561`) | **Already has the leaf-check** at `collections.ts:9556` — keep it, it is the precedent |
| `src/compute-engine/library/sets.ts:1053` (`union`) / `sets.ts:1101` (`intersection`) | `for (const elem of op.each())` after `op.isCollection` gates at `sets.ts:1073` / `sets.ts:1110` | One level, but the *elements* re-enter the same set operators via `contains` | Characters become set members |
| `src/compute-engine/boxed-expression/compare.ts:521` | `eqImpl` collection branch | Element-wise recursion `eqImpl(xa, xb.value, prover)` (`compare.ts:533`) after `a.isCollection && b.isCollection` / `a.isIndexedCollection && b.isIndexedCollection` (`compare.ts:529`) | Terminates in practice — `a.isSame(b)` at `compare.ts:511` short-circuits identical characters before the collection branch — but the descent is unbounded in principle |
| `src/compute-engine/boxed-expression/compare.ts:1051` | `containsNaNLeaf` | Recurses on `expr.ops` only (`compare.ts:1053`), never on `.each()` | Safe as written; `BoxedString` is not a function node |
| `src/compute-engine/boxed-expression/validate.ts:366` | numeric-argument validation | `isFiniteIndexedCollection(op)` → walks elements (`validate.ts:475`) | One level; a string operand would take the `typeIsProvablyNonNumericCollection` reject arm (`validate.ts:370`) and become a `typeError('number', …)` for `Add("ab", 1)` — a change from today |

## Non-recursive but unguarded broadcast gates (same fix, one predicate)

`collection-utils.ts:278`/`295` already exclude strings; the following spell the test **inline without `!isString`**, so a string operand would newly be zipped element-wise:

- `src/compute-engine/collection-utils.ts:1135` — `broadcastOverIndexedCollections`'s local `isBroadcast = (x) => isFiniteIndexedCollection(x) && !isTuple(x)` — directly below `isFiniteBroadcastParticipant`, which exists precisely to hold this rule in one place.
- `src/compute-engine/boxed-expression/boxed-function.ts:3158`, `3216`, `3302`, `3631`, `3681`, `3763`, `4035`, `4620`, `4768`, `4886`, `4978`, `5018`, `5053`
- `src/compute-engine/boxed-expression/arithmetic-add.ts:548`, `600`, `647`
- `src/compute-engine/boxed-expression/arithmetic-mul-div.ts:1592`, `1637`, `1670`
- `src/compute-engine/library/relational-operator.ts:1337` — `broadcastComparison`
- `src/compute-engine/library/logic.ts:310` — `finishShortCircuit`'s `isCollectionValue`
- `src/compute-engine/library/control-structures.ts:425` — `When`'s distribution branch
- `src/compute-engine/library/collections.ts:2063` — `PointList`

Note that `collection-utils.ts` is outside the two directories you named, but `1135` is the single site that most directly contradicts the guard at `295`, so I include it.

## Appendix B — Resolution of the plan and of Appendix A (2026-08-16)

**Implementation deviations from D1–D15 (all recorded in the code comments):**
- D2: NOT expanded at the broadcast peel (`liftedElementTypeOf`,
  `isMappedActual`, `MAPPED_KINDS`) nor in `isCollectionLike` deferral
  (expanding it made `Determinant("abc")` valid); `walkPattern`'s string
  expansion is gated on a collection-kind pattern (unconditional expansion
  broke Rule U: `type lu<T> = list<T> | string` gave `lu<unknown>`).
- D4: the runtime predicate is `isTextAtom(x)` (TYPE-aware and
  value-following, like `isTuple`) — a `string`-typed symbol and a lambda
  parameter holding a string are not `BoxedString` nodes and slipped every
  gate otherwise. ~25 inline `isFiniteIndexedCollection(x) && !isTuple(x)`
  gates now route through `isFiniteBroadcastParticipant`.
- D10 spelling: `(T, …) -> T where T: string` (bounded variable), NOT the
  ground `(string, …) -> string` — an unknown operand never refutes a
  ground arm, so `Reverse(x)` for `x: unknown` typed `string`. Runtime is a
  type-driven join step (`evaluateStringPreservingCollection` in
  `boxed-function.ts`), not an `evaluate` handler (an `evaluate` handler on a
  lazy operator disables `materialize()` and broke 24 tests).
- Constraint 3 (`String` carve-out) needed TWO extra pieces: a `String`
  clause in `skipBroadcastForVectorOps` (broadcast fired first), gated on
  "collection-TYPED" (an unevaluated `Characters(s)` is not `.isCollection`
  yet), and `broadcastElementType` no longer unwrapping `string` (multi-arg
  `String("x",[1,2])` typed `list<character^2>`).
- D7 error code: `incompatible-type` (expected `character`, actual `string`).
- Serialization: Epsil prints a character as `CharacterFrom("x")`, never the
  bare string (a Codex review finding: `"x"` reparses as a string, and an
  invalid `CharacterFrom("ab")` would reparse as a valid string).
- Compile: `Dedup` has no JS lowering for any operand (pre-existing; not a
  string cell — left). GLSL/WGSL now fail closed on a bare string literal
  and on text-typed symbols (pre-existing hole closed).

**Appendix A resolution:** every STRING-PRESERVING row (spec list +
`TakeWhile`/`DropWhile`/`Dedup`) has its string arm; every MUST-EXCLUDE row
is fixed (`Flatten`, `Max`/`Min`/`Supremum`/`Infimum`, `GCD`/`LCM`,
`Transpose`, `Reshape`, `Shape`/`Rank`, `Quantile`, `StringFrom`,
`SetMinus`, `Covariance` family, `Differences` type, `Subscript` type) or
ruled honest (`Union`/`Intersection`, `ListFrom`/`SetFrom`/`TupleFrom`);
`Max`/`GCD` recursion rows were MOOT (character is not a collection) but the
expansion itself was still wrong and is fixed. Walker rows: `flattenToDepth`,
`FlatMap`, `extractPairs`, `enlist`, set `union`/`intersection`, `eqImpl`
(found a real defect: `"ab".isEqual(["a","b"])` was `true`) — all resolved.
Every inline broadcast gate in the "non-recursive but unguarded" list is
routed through the shared predicate. Rows deferred to Phase 2 are in
`ROADMAP.md`. Two additional defects found and fixed in-round:
`DigitsFrom(s, base)` ignored an integer base; `Differences`' type handler
claimed `list<character>` for a list of `Subtract` nodes.

**Rulings made in-round — USER-CONFIRMED 2026-08-16:** spread `[..."ab"]`
→ characters (grapheme clusters, verified: `[..."éa👨‍👩‍👧🇫🇷"]` has 4
elements); `Union(Set(1), "ab")`/`Intersection` element-wise while
`SetMinus(S, "ab")`'s `value*` slots stay atomic (`(collection+)` slots take
collections, `value*` slots take values); `ListFrom("abc")` → characters;
`String([1, 2])` = `"12"`; `ce.character("ab")` throws; `Shape("abc")` =
`(3)`; `DictionaryFrom` coerces a character key to its string. Follow-up
ruling: compiled STRING equality normalizes to NFC exactly like compiled
character equality ("normalize both"); compiled string ORDERINGS normalize
too (same conditioning, then the interpreter's code-unit `<`); and the
`isSame` character↔one-cluster-string bridge (D5) is KEPT and documented as
the one deliberate cross-kind case in CLAUDE.md's `isSame` paragraph. Two defects found while confirming:
`let c: character = "a"` was rejected (literal narrowing did not reach typed
declarations/assignments — fixed, runtime + `epsil check`), and
`CharacterFrom("ab")` was not flagged by `epsil check` (canonical now
returns the error value for a non-single-cluster literal).
