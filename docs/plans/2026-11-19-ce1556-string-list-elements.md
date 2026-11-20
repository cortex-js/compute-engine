# CE-1556: per-element reads of a list of strings on javascript

Status: design note, revision 4, not approved. No code is written.

Goal: on the javascript target of the IR compiler, with `s: string` and
`L: list<string>`, compile `Map(f, L)`, `Filter(L, p)`, `Count(L, p)`, the
structural list operators over a list of strings of run-time length,
`At(L, i)` with its discharges, and `Equal`/`NotEqual` of two strings, so
that `Count(Characters(s), c -> c == "a")` compiles. (MathJSON order:
`Map(ToUpperCase, L)`; the callback comes first, `library/collections.ts`.)

Cost rule: code in the core of the compiler (lowering machinery, passes,
shapes, lanes, verifier, printer machinery) is the cost to minimise;
per-operator code is cheap; a decline is always acceptable.

## 1. Where things stand

Read in the source and probed with `compile()` of `src/compile`:

- `stringListRefusal()` of `ir/index.ts` runs after the passes. A list of
  strings is made by `list`, the region `text.chars` or an entry parameter,
  and read only as operand 0 of `TEXT_LIST_READS` (`lower-strings.ts`:
  `text.joinl`, `text.joinl.sep`), or yielded by the entry when it is not a
  parameter.
- A source's element read is `elem` (`listSource().at` of
  `lower-lists.ts`); `Map`, `Filter`, `Count(L, p)`, `Any`, `All`,
  `TakeWhile`, `CountIf`, `Reverse`, `Take`, `Drop`, `Rest`, `Most` and the
  rotations all read through it (`over()`, `reindexed()`, `where()`). Each
  survives the passes for a run-time length and refuses.
- `at()` of `lower.ts` (used by `At`, `First`, `Second`, `Third`, `Last`)
  sends a flat list of strings to the row `at`, whose `_at` gives `NaN` out
  of range.
- `Equal`, `NotEqual` and the orders have no string signature
  (`operators.ts`): "Equal of string, string".
- Every string value of compiled code is conditioned (NFC, then a lone
  surrogate replaced), except the elements of an input list, which the
  entry passes as the host gave them (R6) and only `tjoinl` conditions
  (`text-runtime.ts`, header). No string value is absent today, and the
  string rows and regions (`text.length`, `text.startswith`, `text.chars`,
  `text.joinl`, …) call string methods on their operands: they throw on
  `undefined`, also where a pass evaluates them speculatively (`hoist`,
  `invariants` of `passes.ts`).

This change builds on the separate fix of `absent()` (`lower.ts`) for the
string and colour lanes, in progress (worktree
`.claude/worktrees/agent-a789a05385689d417`): the discharges of a string
read `text.isundef` (`isundef` row) and `AssertPresent` reads
`text.present` (`present` row).

## 2. Design

### 2.1 Every read of a list of strings conditions what it reads

The rule of `stringListRefusal()` keeps its form. Two of its sets grow:

- **Producers**: `list`, the regions `text.chars`, `build` and `filter`
  (new: the list results of `Map`, `Filter`, `Reverse`, …), an entry
  parameter.
- **Readers** (`TEXT_LIST_READS`): `text.joinl`, `text.joinl.sep`, and two
  new rows, `text.elem(l, k)` (index from 0, in range by construction) and
  `text.at(l, i)` (the interpreter's `At` index: from 1, from the end when
  negative, `undefined` when 0, not an integer or out of range). Each
  conditions a present element and returns `undefined` unchanged
  (`const x = l[k]; return x === undefined ? x : condition(x)`).

Everything else stays refused: a generic `elem`, `at`, `atu`, `getat`,
`copy`, `sort`, `ordering`, an element-wise operation whose operand is a
list of strings, a list of strings as a region parameter, an inner yield, a
loop carry, a call argument, rank 2, an `If` arm, an entry parameter
returned.

**After the passes.** The lowering emits `text.elem` and `text.at` for the
lane `string`, never `elem`; no pass makes either one (`atToElem()`
rewrites `at`, `atu` and `atp` only, `fold` rewrites `elem` only), and a
pass that turned a read into `elem` would be refused. `scalarize` (on
JavaScript, the short static lists, `unrollBuilds`) writes an element-wise
operation out with generic `elem` reads (`perElement()` of `passes.ts`):
over a `list` instruction `fold` replaces each by the element; over an
input `list<string^2>`, or with `constantFold: false`, the `elem` remains
and refuses.

### 2.2 No absent string reaches a reader

The simple, sound version (AGENTS.md): absent strings are made impossible
outside the discharges, so no effect analysis and no pass change is
needed.

- **`text.elem` is never absent.** Its index comes from a build, a filter
  or a loop over the length of the list (`over()`, `reindexed()`,
  `mapLists()`, `where()`), or from a constant in range. The one reader of
  `listSource().at` at a computed index, `s.at(head(kept))` of `Find`,
  declines for strings ("Find in a list of other than real numbers");
  `elementOf()` lowers its read in a region that is not emitted. The
  implementation lists every caller of `.at(` of a source and records this
  in the comment of `listSource()`.
- **`text.at` is read only by a discharge or the result.** `at()` emits
  `text.elem` when the list has a constant length and the index is a
  constant in range (the test it already makes for booleans), and
  `text.at` otherwise. A value of `text.at` may be used only as:
  1. operand 0 of `text.isundef` (`IsMissing`, and the test of `Coalesce`
     and `AssertPresent`);
  2. operand 1 of `text.present` (`AssertPresent`, which throws where the
     value is absent);
  3. the yield of the `else` arm of an `if` whose condition is
     `text.isundef` of that same value (`Coalesce`: `branch()` of
     `lower.ts` makes `if (absent) { next } else { v }`);
  4. a yield of the entry (the program's result: `undefined` for
     `Missing` is within the caveats).

  Any other use refuses, in `stringListRefusal()`: an operand of any other
  operation, a cell of a `list`, the yield of a `build`, a loop or a
  function other than the entry, an argument of a call. A local that holds
  it is the same value in the IR, so its readers are checked; a call that
  is not inlined refuses at its argument or at the callee's yield, and an
  inlined one is checked at the reader. `text.at` stays `may-fail`.
- **`Coalesce(At(L, i), "z")` is a present string.** Its value is the output
  of the `if`, not of `text.at`, so it is read anywhere afterwards. With
  three operands, the inner `Coalesce` is the `then` arm; an arm that
  yields a second `text.at` (`Coalesce(At(L, i), At(L, j))`) refuses by
  rule 3, as it can be absent.

So every string value that reaches a helper, a region or a list cell is
present, whatever a pass speculates. The guarded forms that the program
writes with `Coalesce` compile; the bare reads decline (section 5), and the
remedy is the discharge: `ToUpperCase(Coalesce(At(L, i), ""))`.

**R6.** The entry still does one step per binding: an input list passes
with no walk and no copy (`plan.lists` still refuses a string for it). The
conditioning is done at each read, inside the loop the program already
runs. `Length(L)` still reads `.length`.

**R1 to R5.** Every admitted list has rank 1, the lane `string`, and a
length that is a parameter, a constant, the count of `text.chars` or the
length operand of a `build` or `filter`. No run-time test of a type is
emitted. The lane `rows` (CE-1549) and its `resultOnly` entries are not
touched: a `Chunk` of a list of strings has rank 2 and is refused as now.

**Strings flag and workers.** Unchanged: a program with numbers at its
boundary is shippable, and the worker runtime spreads `TEXT_HELPERS`.

## 3. Core touch points

1. **`stringListRefusal()`, `ir/index.ts`.** The producer test admits the
   regions `build` and `filter` beside `text.chars` (one set,
   `TEXT_LIST_MAKERS` of `lower-strings.ts`); the reader test is unchanged
   code over the larger `TEXT_LIST_READS`; the cause of a non-string list
   read names the operation. The same walk checks the uses of each
   `text.at` value by the four rules of section 2.2: a set of `text.at`
   outputs, the definition of each `if` condition, the arm and the region
   of each yield. The comment, the refusal texts and the
   `Profile.scalarLanes` comment change. About 20 lines.
2. **`listSource().at`, `ir/lower-lists.ts`.** For the lane `string`, the
   read is `text.elem` (through `cx.apply`), not `elem`. About 3 lines.
3. **`absent()`, `ir/lower.ts`**: no change; the separate fix gives the
   string test.

No pass, effect rule, shape rule, lane, verifier rule or printer machinery
changes: the new operations are rows, checked by `verify()` like
`text.joinl`.

## 4. Per-operator code

- **`operators.ts`**: `row(undefined, 2, [[['list', I], 'element',
  'text.elem']], list)`; `row('At', 2, [[['list', R], 'element',
  'text.at']], { ...list, effect: 'may-fail' })`, after the existing `At`
  rows so `rowOfHead` keeps `at`; `Equal` gets `[[S], B, 'text.eq']`,
  `NotEqual` gets `[[S, S], B, 'text.ne']`. `text.isundef` and
  `text.present` come from the `absent()` fix.
- **`lower.ts`**: in `at()`, a flat list on the lane `string`, on
  JavaScript and not in the bigint mode, is `text.elem` at a constant index
  in range of a constant length and `text.at` otherwise (about 5 lines). In
  the `KroneckerDelta` case, two operands on the lane `string` take the
  `Boole(Equal(x, y))` branch that integers take (1 line): the `Or` with
  `isnan` would decline, `isnan` having a real signature only. The
  interpreter gives 1 and 0 (probed: `KroneckerDelta(s, t)` at `"a"`,
  `"a"` and at `"a"`, `"b"`).
- **`lower-strings.ts`**: `TEXT_LIST_READS` gains the two reads,
  `TEXT_LIST_MAKERS` is new, and the comment states both rules.
- **`print-js-text.ts`**: `text.elem` → `_SYS.tel($0, $1)`, `text.at` →
  `_SYS.tat($0, $1)`, `text.eq` → `($0 === $1)`, `text.ne` → `($0 !== $1)`.
- **`text-runtime.ts`**: `tel` and `tat` (section 2.1); the header sentence
  on input lists.

## 5. What is admitted, what stays declined

Witness strengths are those of `docs/ISSUE_TRACKING.md`. All the witnesses
of CE-1556 are `plausible`: one-line programs over a declared list of
strings or the characters of a string.

| Program (`s: string`, `L: list<string>`) | Witness | Result |
| --- | --- | --- |
| `Count(Characters(s), c -> c == "a")`, `Count(L, p)` | plausible | admitted |
| `Map(ToUpperCase, L)`, `Map(f, L1, L2)`, `Filter(L, p)` | plausible | admitted |
| `Any`, `All`, `CountIf`, `TakeWhile`, `DropWhile`, `IndexWhere` with a predicate | plausible | admitted (same reads) |
| `Reverse(Characters(s))`, `Take`, `Drop`, `Rest`, `Most`, rotations | plausible | admitted (same reads) |
| `At(L, i)`, `At(Characters(s), 1)`, `First(L)`, `Last(L)` as the result | plausible | admitted |
| `IsMissing`, `Coalesce`, `AssertPresent` of `At(L, i)`; anything of `Coalesce(At(L, i), "z")` | plausible | admitted |
| `At(["a", s], 2)` read anywhere (constant index in range) | plausible | admitted (`text.elem`) |
| `Equal`, `NotEqual`, `KroneckerDelta` of two strings | plausible | admitted |
| `Equal(["a", s], "a")` (a short literal list) | crafted | admitted through `scalarize`, the interpreter's `[True, False]` |
| `ToUpperCase(At(L, i))`, `At(L, i) == "a"`, `Length(First(L))`, `StringJoin([At(L, 1), "x"])` | plausible | **newly declined**: a bare read that can be absent; remedy `Coalesce(At(L, i), "")` |
| `Map(k -> At(L, k), Range(1, n))`, `[First(L), Last(L)]`, a user function returning `At(…)` that is not inlined, `f(At(L, i))` not inlined | plausible | newly declined, same remedy |
| `Coalesce(At(L, i), At(L, j))` | crafted | declined (rule 3) |
| `Sort(L)`, `Unique(L)`, `Less` of strings, `Max(L)` | plausible | declined, question 1 |
| `Contains(L, "x")`, `IndexOf(L, "x")`, `Find` | plausible | declined: `same()` and `Find` read real numbers only; a later per-operator change |
| `Reduce`, `Fold` of `String` over `Characters(s)` | plausible | declined, as now: `reduce()` needs an initial value and reads a real one only |
| `Equal(L, "a")` of an input or a run-time-length list | crafted | declined (an element-wise row of a list of strings) |
| `ToUpperCase(["a", s])` | — | declined: a static type error of the canonical form |
| `L` returned, `If(b, L, ["x"])`, a loop carry, a call, `list<list<string>>` | crafted | declined, as now |

The structural operators come with no code of their own: they are builds
over `listSource().at`, so they move conditioned elements without computing
on them. An operation that does compute on an element is a row, chosen by
lane; a row with no string signature declines (`signatureOf()`). The newly
declined reads are a `plausible` known-limitations line of
`COMPILATION-MODEL.md` with the `Coalesce` remedy.

## 6. Contracts against the interpreter

Inputs of their declared types; the caveats of `COMPILATION-MODEL.md`.

- **Equality.** The interpreter's `Equal` of a string or a character with a
  string or a character is `a.string === b.string` of the boxed, conditioned
  texts (`boxed-expression/compare.ts`, the `BoxedString` and
  `BoxedCharacter` bridge: a character equals a one-cluster string of the
  same content). Every string operand of `text.eq` is present and
  conditioned (a literal by the engine, an input by `text.in`, an element
  by `tel`, a `Coalesce` of `tat`, a result by its helper), so `===` is
  that value. Probed: `Equal(s, "é")` with `s` decomposed is `True`;
  `Equal(At(L, 3), "é")` with `L[2]` written `e` + U+0301 is `True`, so the
  read must condition. `Equal(s, 3)` is `False` in the interpreter and
  declines (no signature of two lanes). `NotEqual` is its negation;
  `KroneckerDelta` is `Boole` of it.
- **`At` out of range.** The interpreter gives `Missing` for an index that
  is 0, not an integer, or past either end (probed: `At(L, 5)`, `At(L, 0)`,
  `At(L, 1.5)`, `At(L, -4)` of three elements); `text.at` gives
  `undefined`. As the result, that is the absent object of the caveats on
  JavaScript; at a discharge, the interpreter's value (`IsMissing` is
  `true`, `Coalesce` the next operand, `AssertPresent` throws
  `expected-present`). No other reader sees it (section 2.2).
- **Character values.** The interpreter's elements of `Characters(s)` are
  character values, those of `L` strings; compiled, both are conditioned
  JavaScript strings. A result list holds JavaScript strings (the existing
  known-limitations line). An input element is conditioned at each read,
  so a result built from it (`Map(c -> c, L)`) holds the interpreter's
  texts.
- **Effects in a predicate or a callback.** `Filter`, `Map` and
  `Count(L, p)` go through `build()` and `over()`, which do not refuse an
  effect; `Any`, `All` and the `where()` family (`CountIf`, `TakeWhile`,
  `IndexWhere`) do, because the interpreter stops at the element that
  decides. This is the behaviour of lists of numbers today: with
  `R: list<real>`, `Count(R, x -> Random() < 0.5)` compiles to a loop that
  draws once per element, in order. The interpreter evaluates the
  predicate once per element, in order: with a counter assigned in the
  predicate, `Count`, `Filter` and `Length(Filter(…))` over three elements
  each leave it at 3 (probed). The values agree; no guard is added for
  strings.

## 7. Tests

In `test/compute-engine/compile-ir-list-of-strings.test.ts`, each case
compiled and compared with `evaluate()`, with the passes on, with
`passes: false` and with `constantFold: false` where the passes matter:

- The witnesses: `Count(Characters(s), c -> c == "a")` at `"banana"`, `""`,
  and `a` + U+0301 + `a`; `Count(L, c -> c != "a")`; `Map(ToUpperCase, L)`,
  `Filter(L, c -> StartsWith(c, "a"))`, `Map(f, L, Characters(s))`.
- Conditioning: `L` holding `e` + U+0301 and `a` + U+0301 + `b`, read by
  `Map(c -> c, L)`, `Map(c -> c == "é", L)`, `Coalesce(At(L, 1), "") ==
  "é"`, `At(L, 2)` as the result.
- `At(L, i)`, `First(L)`, `Last(L)` as the result at `i` = 1, -1, 0, 1.5,
  past each end, and of `[]`; `IsMissing`, `Coalesce(…, "z")` (also then
  read by `ToUpperCase` and `Length`), `AssertPresent` of each; `At(["a",
  s], 2)` read by `ToUpperCase`.
- The earlier witnesses of absent strings, each now declining:
  `IsMissing(At(Map(k -> At(L, k), Range(1, n)), 2))`; `And(i <=
  Length(L), StartsWith(At(L, i), "a"))`; `If(i <= Length(L), Length(At(L,
  i)) > 1, False)`; `Block(c := At(L, i), And(i <= Length(L), StartsWith(c,
  "a")))`; `Block(c := At(L, i), And(i <= Length(L), Length(Characters(c))
  > 1))`; `Block(B := Map(k -> At(L, k), Range(1, n)), And(n <= Length(L),
  StartsWith(StringJoin(B), "a")))`; with `f(t, k) := At(Characters(t),
  k)`, `Block(c := f(s, i), And(i <= Length(s), Length(Characters(c)) >
  1))`; each also with the guard written by `Coalesce`, which compiles and
  gives `False` at `i = 9` (and `n = 2`, `L = ["a"]`). `Trim(" a ")`,
  `TrimStart`, `TrimEnd` unchanged.
- The other new declines of section 5: `ToUpperCase(At(L, i))`, `At(L, i)
  == "a"`, `StringJoin([At(L, 1), "x"])`, `[First(L), Last(L)]`,
  `Coalesce(At(L, i), At(L, j))`.
- Structural: `Reverse`, `Take` (±), `Drop`, `Rest`, `RotateLeft` of
  `Characters(s)` and of `L`, at lengths 0, 1, 3.
- `Equal`/`NotEqual` of scalars (`s == "a"`, a three-operand chain),
  `KroneckerDelta(s, t)`; `Any`/`All`; `Equal(["a", s], "a")`, and with
  `constantFold: false` (declines).
- Declines: `Sort(L)`, `Unique(L)`, `Less(s, "b")`, `Max(L)`,
  `Contains(L, "x")`, `Reduce(Characters(s), (a, b) -> String(a, b))`
  with and without `""`, `Equal(L, "a")` with the input `L` (also declared
  `list<string^2>`), `L` returned, `If(b, L, ["x"])`, `Chunk(L, 2)`, every
  case on glsl and in the bigint mode.
- No code change for a program with no list of strings: the printed code of
  `And(StartsWith(s, "a"), EndsWith(s, "b"))` and `Sum(Length(ToUpperCase(s)),
  k, 1, n)` is pinned before and after.
- Entry and workers: a string for `L` still throws; `strings` true and
  `shippable` false; `Count(Map(k -> If(k > 2, "a", "b"), Range(1, n)), c
  -> c == "a")` with `n: integer` is shippable and each cell of
  `broadcast()` equals `run()`.
- Changed pins, each listed in the report: in this file, the CE-1548 cases
  "after the passes, a decline with `constantFold: false`" now compile in
  both modes, and the run-time-length declines `Map(ToUpperCase, L)` and
  `Reverse(Characters(s))` now compile (`At(L, 1)` compiles as the result);
  `compile-string-fail-closed.test.ts` and
  `compile-string-operations.test.ts` where they pin `Equal` of strings as
  a decline (to be listed when the change is made).

Docs: README "The string lane"; in `COMPILATION-MODEL.md` the CE-1556
known-limitations line becomes the declined rows of section 5.

## 8. Size estimate (an estimate, not measured)

- **Core**: about 23 lines, in `index.ts` (20) and `lower-lists.ts` (3).
- **Peripheral**: about 35 lines (rows 4, `at()` 5, `KroneckerDelta` 1,
  `lower-strings.ts` 10, spellings 4, `text-runtime.ts` 6, comments 5),
  about 35 lines of docs, and about 250 lines of tests.

## 9. Alternatives rejected

- **Condition an input list at the entry** (`L.map(ct)`): a walk and a copy
  per call, against R6.
- **Admit reads of lists that the program makes, and keep an input list
  boundary-only**: `Map(ToUpperCase, L)`, a plausible witness, still
  declines, and the refusal needs the provenance of each list.
- **Keep `elem`/`atu` and add a conditioning op after each read**: the
  refusal would have to prove that every read of an input list feeds the
  conditioning op (a use index). A read op that conditions is checked by
  its name.
- **Let absent strings flow and stop the passes from speculating on them.**
  Three versions were reviewed and each had a hole: a wrapper that makes
  the pure helpers return `undefined` (not sound: `trimText` takes
  `undefined` on purpose, `text.chars` reads `.length`, `tjoinl` conditions
  each cell); no instruction on the lane `string` speculatable in `hoist`
  and `invariants` (sound, but it keeps pure string work of today's
  programs in loops of run-time length: `Sum(Length(ToUpperCase(s)), k, 1,
  n)` and `Count(R, x -> x < Length(ToUpperCase(s)))` compute `tupper` once
  today, once per pass under it); a closure "computed from a `text.at`" in
  `effects.ts` (it missed the yield of a callee, `f(t, k) :=
  At(Characters(t), k)`, and each path is one more case). The restriction
  of section 2.2 has no path to miss: an absent string has four uses, all
  named.
- **Let the passes fold `text.elem` of a `list`** as they fold `elem`: a
  pass case for the lane (no pass has one, README); the unfolded read gives
  the same value.
- **Keep `KroneckerDelta` of strings declined**: the branch is one line and
  the interpreter's value was probed.

## 10. Open questions

1. **Orders of strings** (`Sort(L)`, witness `plausible`, in CE-1556;
   also `Unique(L)` and `Less(s, t)`). The interpreter has two orders
   (`boxed-expression/compare.ts`): between a character and a character or
   one-cluster string, the NFC code points; between two strings,
   JavaScript `<` on UTF-16 code units; a character against a longer string
   is undecided (unevaluated). `Sort` goes through `sortWalk()` of
   `library/collections.ts`, whose comparator this note did not trace. The
   compiled lane does not tell a character from a string, so an order row
   would be chosen by static type, and `Unique` needs the equality of
   section 6 in a helper. Recommendation: keep them declined in this
   change; they are one per-operator issue when wanted (about 30 lines and
   one more reader of `TEXT_LIST_READS`, no core change).

Decisions taken, not questions: an input element is conditioned at each
read, not once; a read of a list of strings that can be absent is admitted
only as the result or under a discharge, and the bare reads of section 5
decline with the `Coalesce` remedy (the simple, sound version; a precise
analysis is a separate task when asked for by name); `Contains`, `IndexOf`,
`Find` and the folds of strings stay declined; the element-wise
`Equal(L, "a")` of an input declines; `KroneckerDelta` of two strings
compiles.
