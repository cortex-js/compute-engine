# CE-1548: lists of strings on the javascript target of the IR compiler

Status: design note, revision 2, not approved. No code is written.

Goal: `Characters(s)`, `GraphemeClusters(s)`, `StringJoin(L)` and
`StringJoin(L, sep)` with `L: list<string>` (or `list<character>`), and
`ColorToString(c)` compile on javascript again, as they did in 0.193.0
(`javascript-target.ts`, `javascript-runtime.ts` at `384222963`).

Cost rule: code in the core of the compiler (lowering machinery, passes,
shapes, lanes, printer machinery) is the cost to minimise; per-operator code
is cheap; a decline is always acceptable.

## 1. Where things stand

Measured with `compile()` of `compilation/compile-expression.ts`:

- `TARGETS.javascript.scalarLanes` is `['string']` (`ir/index.ts`):
  `admits()` refuses every `string` value with a shape. A list literal of
  strings lowers (`list()` of `lower.ts`); only `admits()` refuses it.
- `inputType()` (`ir/lower-functions.ts`) gives the lane `string` to a
  scalar only, so `L: list<string>` declines in `input()` of `lower.ts`.
- `Characters`, `GraphemeClusters` and `ColorToString` have no row ("not
  supported"). `StringJoin` has rows for a string operand only; a list
  declines in `apply()` of `lower.ts` ("StringJoin of a list").

## 2. Design: a list of strings is a boundary value

The rule is stated over the program that `admits()` checks: the IR after
the passes (`compileSlice()` of `index.ts` runs `runPasses()` before
`admits()`). A value `v` with the lane `string` and a shape:

- has rank 1;
- is defined by a `list` instruction, by the region `text.chars`
  (`Characters`), or is a parameter of the entry body;
- is used only as the list operand of `text.joinl` or `text.joinl.sep`
  (`StringJoin`), or, when it is not an entry parameter, as a yield of the
  entry body (the result).

Anything else refuses: "a list of strings other than a literal, Characters,
an input read by StringJoin, or the result". An entry parameter is read by
`StringJoin` only, so an input list is never returned or indexed as the host
gave it (section 5, "inputs").

**What the passes leave.** `fold` turns `At(l, k)` of a constant index in
range of a list of constant length into `elem` (`atToElem()` of
`passes.ts`) and replaces `elem` of a `list` instruction by the element
(`fold`, `sameLane()`); `inline` removes calls; the lowering writes short
builds out (`built()`, `over()` of `lower-lists.ts`, `unrollBuilds`). So a
list of strings of constant length, from a literal, compiles through
`Reverse`, `Take`, `At` of a constant index, a short `Map` and an inlined
user function, and its value is the interpreter's: the remaining program is
a `list` of the same scalar strings. With `constantFold: false` the same
programs keep their `elem` reads and decline. A list of run-time length (an
input, `Characters(s)`) is never written out, so every read of an element
survives and refuses.

| Audit item of CE-1548                        | Surviving instruction                        | Result |
| -------------------------------------------- | -------------------------------------------- | ------ |
| element read out of range (`_at` is `NaN`)   | `at`, `atu`, `atp`, `getat`                  | refused |
| `Sort`, `Unique`, `Ordering`                 | `sort`, `ordering`, `sortby`, `Equal` of strings (no row) | refused or declined |
| `Equal` of lists                             | declines in `apply()`                        | declined |
| `Map`, `Filter`, folds, of run-time length   | `elem` in a `build`, `filter` or loop        | refused |
| the same of a literal, passes on             | none: a `list` of scalar strings             | compiles, same value |
| `If`, `Loop`, a user function not inlined    | an inner yield, a parameter, a `call`        | refused |
| broadcast, workers                           | section 2, "strings flag"                    | boundary only |
| entry check                                  | `plan.lists` (refuses a string, a typed array) | unchanged |
| result normalisation                         | `normalizeRunResult()` passes string cells through | unchanged |

`Length(L)` and `Length(Characters(s))` read the length of the shape (a
parameter, the count of `text.chars`), not the list, so they compile.

**Producers.** Reading the readers is not enough: a lowering that makes a
`list` from a scalar string where the interpreter spreads the string makes
a wrong list that the rule above admits. The producers, audited:

- `join()` of `lower-lists.ts` (`ListJoin`, `Join`, the Epsil spread
  `[...s, "x"]`, which is `ListJoin(s, ["x"])`): `source(x, true)` makes a
  scalar operand one element. The interpreter spreads a string:
  `ListJoin("bc")` is `["b", "c"]` (probed). **Fix: `join()` declines an
  operand on the lane `string` with no shape.** `joinLists()` already
  requires list operands.
- `source(x, true)` in the reductions and `meanParts()` (`lower-lists.ts`):
  the elements meet `Add`, `Max`, …, which have no string row: declines.
- `source(x)` with `scalars` false: a scalar declines ("a scalar where a
  list is required"), so `Reverse("abc")`, `Map("abc", f)` decline.
- `Append`, `Insert` and the other list operators of `more()`: their
  element checks admit numbers and booleans only.
- `lower-matrices.ts` (`Shape`, `Flatten`, `Transpose`, `Cross`,
  `cx.list`): `numbers()` declines an operand off the real lanes.
- `list()` of `lower.ts`: `List` does not spread a string in the
  interpreter either (`["a", "bc"]` has two elements; probed with `Append`).
- `built()` and `over()`: the elements are values of the body, lowered by
  their own rows.
- `perElement()` and the element rule of `fold`: only threading rows, and
  no text row threads.

## 3. Core touch points

1. **`admits()`, `ir/index.ts`.** `scalarLanes` becomes `[]` on javascript;
   one walk applies section 2 and checks that the list operand of
   `text.joinl` has the lane `string`. The operation names come from
   `ir/lower-strings.ts` (`TEXT_LIST_READS`), and the `Profile.scalarLanes`
   comment changes. About 40 lines.
2. **`inputType()`, `ir/lower-functions.ts`.** With `strings`, an element
   `string` or `character` of a rank-1 list has the lane `string`. About 3
   lines.
3. **`input()`, `ir/lower.ts`.** `text.in` reads a scalar string only
   (`shape.length === 0`); a list parameter is used as it is. 1 line.
4. **`join()`, `ir/lower-lists.ts`.** The decline of section 2. 2 lines.
5. **`REGION_ROWS`, `ir/operators.ts`.** The region `text.chars`: operand
   `string`, no parameter, empty body, results the count and
   `list<string>[count]`, effect `pure`, as `choice` and `sample` (an `op`
   cannot make a length that no operand gives: `resultType()`). About 12
   lines.
6. **`JS.regions`, `ir/print-js.ts`.** Spread `TEXT_REGIONS` of
   `print-js-text.ts`. 1 line.
7. **The entry plan, `ir/adapter.ts`** (the parameter loop of the
   JavaScript adapter): a list parameter on the lane `string` sets
   `strings` before `if (!checks) return;`, so the flag holds with
   `entryChecks: false`. 1 line.
8. **`lower.ts` dispatch.** Cases for `Characters`, `GraphemeClusters` and
   `ColorToString`, which call `lower-strings.ts`. About 6 lines.

**Strings flag.** `strings` (no batch, `shippable: false`) stays a property
of the boundary: a string entry parameter or result. A program whose
inputs and result are numbers and whose inside holds strings
(`Length(Characters(ColorToString(Rgb(x, 0, 0))))`) has a batch of numbers,
and the worker runtime is the same `javascript-runtime.ts`, which spreads
`TEXT_HELPERS`. Phase 1 already compiles such programs: `x +
Length(StringRepeat("ab", Floor(x)))` compiles with no `strings` flag and
`shippable: true` (probed). No change; a test pins it.

No pass, shape rule or lane conversion changes; no pass gets a case for the
lane.

## 4. Per-operator code

- **`lower-strings.ts`**: `characters(e, cx)`: the operand's static type is
  `string` or `character`, then `cx.region('text.chars', [s], [], () => [],
  e)[1]`. `checkTextDomains()` gets `StringJoin`: the first operand's
  static type is `string`, `character`, or a list of `string | character`
  elements; else it declines (`StringJoin([1, 2])` is unevaluated).
  `colorToString(e, cx)`: section 5.
- **`operators.ts`**: the `StringJoin` rows get a second signature after
  their string one: `[['list'], 'element', 'text.joinl']` and
  `[['list', S], 'element', 'text.joinl.sep']`. The result is `'element'`
  because `resultType()` gives a lane result the shape of the first list
  operand, and `verify()` derives it again; the element of a
  `list<string>` is a `string`. `isTextRow()` still holds: the rows also
  have their `[[S], S, …]` signature. The `ColorToString` rows (section 5)
  have a `string` result and `effect: 'may-fail'`, as `text.repeat`.
- **`print-js-text.ts`**: `text.joinl` → `_SYS.tjoinl($0, '')`,
  `text.joinl.sep` → `_SYS.tjoinl($0, $1)`; the region `text.chars` →
  `const out = _SYS.tchars(s); const c = out.length;`; the `ColorToString`
  spellings.
- **`text-runtime.ts`**: `tchars(s)` is
  `splitGraphemeClusters(s).map(condition)`; `tjoinl(l, sep)` is
  `condition(l.map(condition).join(sep))`. The conditioning of each element
  is in the join, whose cost is already the length of the list, so the entry
  reads no element (`COMPILATION-MODEL.md`, R6 and "Target boundaries": a
  constant amount of work per binding).
- **Colour kernel**: the formatting of `ColorToString` in
  `library/colors.ts` (`rgbToHex()`, the `rgb`, `hsl`, `oklch` and
  `display-p3` strings) moves to `numerics/color-conversion.ts`; the
  interpreter and `_SYS.colorToString` call it, from a space and three
  raw channels, read by `readColorChannels()` (section 5).

## 5. Contracts against the interpreter

Inputs of their declared types; the caveats of `COMPILATION-MODEL.md`.

- **`Characters(s)`, `GraphemeClusters(s)`**: the interpreter's elements in
  order, as an array of strings: the grapheme clusters of `s`
  (`splitGraphemeClusters()`), each conditioned as `BoxedCharacter`
  conditions it (NFC, then a lone surrogate replaced). `Characters("")` is
  `[]`.
- **`StringJoin(L)`, `StringJoin(L, sep)`**: the interpreter's string, for
  a literal, `Characters(s)` or an input: each element conditioned as the
  engine boxes it, joined with `sep` (`""` when absent), the result
  conditioned. An input of length 0 gives `""`; an empty list literal
  declines (`list()`), as today. No admitted producer gives an absent
  element. A cell that is not a string is outside the declared type.
- **Inputs**: an input `list<string>` passes as the host gave it, with no
  walk and no copy; only `StringJoin` reads it, and it conditions what it
  reads, so no element reaches the result unconditioned. A string or a
  typed array for it throws (`plan.lists`).
- **A list of strings as the result**: an array, read-only by the result
  contract of `normalizeRunResult()`. Its elements are JavaScript strings
  where the interpreter's are character or string values.
- **`ColorToString(c)`, `ColorToString(c, f)`**. Compiled `Rgb`, `Hsl` and
  `Hsv` are stored in OKLCh (`rgb()`, `hsl()`, `hsv()` of
  `javascript-runtime.ts`), so formatting one in an sRGB format round-trips
  sRGB → OKLCh → sRGB: `Rgb(0, x, 0.25)` at `x = 0.5` gives `#007f40`
  where the interpreter gives `#008040` (the review measured 211 of 804
  samples one unit off). That is a wrong value. A rounding to a unit
  amplifies any difference of the channels, so the string is the
  interpreter's only when the formatter gets the interpreter's own source
  channels, not merely a colour of the same space: compiled
  `AsRgb(Rgb(0, x, 0.25))` at `x = 0.5` has green `0.49999999999999883`
  and gives `#007f40` (review round 2). The rule:
  - **Own channels.** The operand's defining operation, read from
    `b.defs` (the `op` of each value, filled by `emit()` and `entryOp()` of
    `ir.ts`), is a constructor `rgb`, `hsl`, `hsv`, `oklab` or `oklch` of
    three channels, or a conversion to the same space of one (`asrgb` of
    an `rgb`, `ashsl` or `ashsl.own` of an `hsl`, `ashsv` or `ashsv.own` of
    an `hsv`, `asoklab` of an `oklab`, `asoklch` of an `oklch`), seen
    through as the `AsHsv`/`AsHsl` lowering sees through it (in review:
    `lower.ts` of worktree `agent-a048e2c87ec222b6f`). The interpreter
    answers such a conversion with its operand unchanged, and formats a
    constructor from its channels (`readColorExpr()` then `colorExprToRgb()`
    or `colorExprToOklch()` of `library/colors.ts`). The compiled code
    passes those three channels and the space to the shared kernel, which
    runs the same steps: the rows `colortostring.<space>.<f>` of three
    reals. A name whose value is a literal constructor lowers to that
    constructor, so it takes this path too. A tuple of three numbers is the
    channels of `rgb` (its three elements), not `apply()`'s conversion to
    an OKLCh `rgb` value.
  - **The compiled colour.** No operation is admitted here in this change.
    Formatting from the compiled object is exact only where its channels
    are the interpreter's source bit for bit. Every candidate fails that
    test: a cross-space conversion, `ColorMix`, `GamutMap`,
    `ContrastingColor` and `Colormap` all read operands that compiled
    constructors hold in OKLCh, where the interpreter holds `Rgb`, `Hsl`
    and `Hsv` in their own space. A later change adds an operation with
    that proof (for example `ColorMix` of two `Oklch` constructors), in its
    own set, `COLOR_EXACT`, not `COLOR_SAFE`, which stays the rule of
    `AsHsv` (a proof of the space only).
  - Anything else declines: a cross-space conversion, `ColorMix`,
    `GamutMap`, `ContrastingColor`, `Colormap`, an `If`, a call of a user
    function, a loop value.

  The operand's shape does not change the rule: a list of colours is
  looked up the same way and then declines at the row, which does not
  thread (the interpreter's signature takes one colour). The look-through of
  `b.defs` is one helper of `lower.ts`, factored out of the `AsHsv` case and
  shared by the two operators (about 10 lines moved, not added); each
  operator keeps its own set. This part of CE-1548 lands after that fix.

  The kernel reads the channels with `readColorChannels()` of
  `numerics/color-conversion.ts`, as `readColorExpr()` does: it clamps the
  saturation, value and lightness of `hsl` and `hsv` into [0, 1], also
  `±∞` (`ColorToString(Hsl(30, +∞, 0.5))` is `#ff8000`), and wraps a hue.
  The kernel throws a `RangeError` only where that read gives `undefined`
  (a `NaN` channel, an infinite hue or other unclamped channel), where the
  interpreter's value is `incompatible-type` (probed: `Rgb(NaN, 0, 0)`).
  The format is absent (`hex`) or a string literal, read without case:
  `hex`, `srgb`, `rgb`, `hsl`, `oklch`, `display-p3`. Another literal
  (`expected-value`) and a non-literal decline. A string operand declines.
  A compiled colour has no alpha.
- **Shapes (R1 to R6)**: every admitted list has rank 1, the lane `string`
  and a length that is a parameter, a constant or the count of
  `text.chars`; no run-time test of a type is emitted.

What still declines, with the remedy (the interpreter): a read of an
element, `Map`, `Filter`, a fold, `Sort`, `Reverse` and the other list
operators over an input list or `Characters(s)`, and over a literal when the
passes leave a read; a list of strings in an `If`, a `Loop`, or a user
function that is not inlined; a list of lists of strings; an input list
returned as the result; `ColorToString` of a colour that is not a
constructor or a same-space conversion of one. Each is a
known-limitations line of
`COMPILATION-MODEL.md`.

## 6. Tests

New file `test/compute-engine/compile-ir-list-of-strings.test.ts`; each
case is compiled and compared with `evaluate()`, with the passes on and with
`constantFold: false` where the result depends on them:

- `Characters(s)`, `GraphemeClusters(s)` and `Length(Characters(s))` at
  `"héllo"`, `"e\u0301a"`, a ZWJ family, a flag, a lone surrogate, `""`.
- `StringJoin(L)`, `StringJoin(L, "-")` with `L: list<string>` and
  `list<character>`, at `[]`, `["e", "\u0301"]`, `["a\u0301", "b"]` (an
  element not in NFC), `["a", "b"]`; `StringJoin(["a", s], "-")`;
  `StringJoin(Characters(s), "-")`.
- Producers: `ListJoin(s)`, `[...s, "x"]` (Epsil) and
  `StringJoin(ListJoin(s), "-")` decline; `Append(["a"], s)` declines.
- After the passes: `Reverse(["a", s])`, `Take(["a", s], 1)`,
  `At(["a", s], 2)`, `Map(["a", s], ToUpperCase)`, a user function that
  returns `["a", s]`: the interpreter's value with the passes, a decline
  with `constantFold: false`.
- Declines on lists of run-time length: `At(L, 1)`, `Map(L, ToUpperCase)`,
  `Sort(L)`, `Reverse(Characters(s))`, `If(b, L, ["x"])`, `L` itself, an
  input `list<list<string>>`, `StringJoin([1, 2])`.
- Entry: a string for `L` throws; `broadcast()` throws, `shippable` is
  false, `strings` is true, also with `entryChecks: false`.
  `Length(Characters(ColorToString(Rgb(x, 0, 0))))` broadcasts, each cell
  the value of `run()`.
- `ColorToString` with each format literal (also `"HSL"`), of `Rgb(0, x,
  0.25)` at `x = 0.5` (`#008040`) and over the review's 804 samples, of
  `Hsl`, `Hsv`, `Oklch`, `Oklab`, a tuple `(x, 0, 0)` and an out-of-gamut
  `Oklch`; of the same-space conversions `AsRgb(Rgb(0, x, 0.25))` at
  `x = 0.5` (`#008040`), `AsHsl(Hsl(…))`, `AsOklab(Oklab(…))`; of
  `c := Rgb(0, x, 0.25); ColorToString(c)` at `x = 0.5` (`#008040`).
  Channels: `Hsl(30, +∞, 0.5)` (`#ff8000`), `-∞` in a saturation, value or
  lightness of `Hsl` and `Hsv` (clamped, the interpreter's string), a hue
  of 400 (wrapped); a `NaN` channel, an infinite hue and an infinite `Rgb`
  channel throw. Declines: `AsRgb(Oklch(…))`, `AsHsl(Rgb(…))`,
  `ColorMix(…)`, `GamutMap(…)`, `ColorToString(If(b, Rgb(…), Hsl(…)))`,
  `ColorToString(ContrastingColor(bg, Rgb(…), Hsl(…)))`, a list of colours,
  `ColorToString(c, "xyz")`, `ColorToString(c, f)` with `f: string`,
  `ColorToString("red")`; `Characters(s)` declines on glsl and in
  the bigint mode.
- Changed pins: `compile-string-fail-closed.test.ts` ("tier 2: Characters /
  GraphemeClusters", "tier 2: StringJoin"),
  `compile-string-operations.test.ts` (the `StringJoin` block),
  `compile-string-collection.test.ts` (its header);
  `compile-color-broadcast.test.ts` compares `ColorToString` of `AsRgb(A)`
  with `ColorToString(A)`. Each changed expectation is listed in the report.

## 7. Size estimate (an estimate, not measured)

- **Core**: about 66 lines in `index.ts`, `lower-functions.ts`, `lower.ts`,
  `lower-lists.ts`, `operators.ts` (the region row), `print-js.ts` and
  `adapter.ts` (section 3).
- **Peripheral**: about 190 lines (`lower-strings.ts` 70, rows 20,
  spellings 25, `text-runtime.ts` 10, colour kernel 25 new plus 60 moved,
  docs 40), and about 250 lines of tests.

## 8. Alternatives considered

- **Admit lists of strings everywhere and audit each list path** (an
  `undefined` arm of `at`, a code-point order for `sort`, string `Equal`,
  `Unique`). Rejected: most of `lower-lists.ts` (2,425 lines) and the
  helpers of `print-js.ts`; an omission is a wrong value, not a decline; no
  witness needs it.
- **A lane `stringlist`, or a `Profile` field for boundary lanes.** Rejected:
  a lane is the most expensive core change.
- **`Characters` as an `op`.** Rejected: an `op` cannot name a fresh length
  (`resultType()`); the region row is the existing mechanism.
- **Condition each element of an input at the entry (`l.map(ct)`).**
  Rejected: a walk and a copy per call, against R6; the join conditions
  what it reads instead.
- **`ColorToString`: a caveat line** ("a channel at a rounding boundary may
  print one unit off"). Rejected here: it changes the contract to admit a
  wrong finite value. **Constructors that keep their own space** (`rgb()`
  giving an sRGB object): correct, but it changes the representation of
  every compiled colour and the values of the other colour operators. The
  own-channel rule of section 5 gives the interpreter's string for a
  constructor, a name holding one and a same-space conversion of one, with
  no representation change. **Reuse `COLOR_SAFE` for formatting**:
  rejected; it proves the space, not the channels (`AsRgb(Rgb(0, 0.5,
  0.25))` gives `#007f40`).

## 9. Open questions

1. **Per-element operations over a list of run-time length** (`At`, `Map`,
   `Filter`, `Count` of `Characters(s)`), witness `plausible`:
   `Count(Characters(s), c -> c == "a")`. Recommendation: not in this
   change; it needs `Equal` of strings and an absent string of `At`, and it
   is a new issue when wanted.

Decisions taken, each a known-limitations line, not a question: the
elements of a compiled list of strings are JavaScript strings (as 0.193.0);
`ColorToString` of a format that is not a literal declines, as the other
colour operators read a space, a gamut or a palette as a literal; an input
list of strings returned as the result declines.
