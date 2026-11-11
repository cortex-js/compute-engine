# A `program` profile for the JavaScript target (step 9): specification

**Status: DRAFT, not approved by the user.** Each choice is the recommended
option; section 8 lists those that need the user.

## The situation

The [plan](2026-11-09-js-compiler-status-and-plan.md) names two profiles of
the structured route, `numeric-kernel` and `program`, and asks for this spec
first (step 9; "Next work, in order", item 4). The shadow measure over the
suite at `4c0828dff198102e1f8c737c346c63ce3959f325`: of 31,049 JavaScript
compilations that the existing compiler compiles, `numeric-kernel` admits
20,959 (67.5%). This spec covers the value kinds that the existing compiler
compiles and the profile declines. Lists, tuples and function operands are in
[the collections note](2026-11-11-structured-collections-and-lambdas.md);
nested lists, lists of tuples, `Range` with a step, user functions as function
operands and `Integrate`/`D` have their own notes and are not covered here.

**The census.** A Jest setup file (scratchpad `design-program/log-setup.ts`)
wraps `compile()` and `recordJsProfileShadow()` and logs each compilation that
the existing compiler compiles and the profile declines (program, options,
symbol types and values, existing code, message). Five runs (`-w 4`) over the
449 test files that name a colour or point head, a string or dictionary
operation or type, a value kind or a selection gave 7,282 declines; they hold
the full-suite declines of the messages treated here (`String` 124,
`PointList` 128, `ColorToString` 108, `GamutMap` 101, `AsRgb` 98 in both).
Probes of the existing emitter (`cse: false, constantFold: false`):
`design-program/probe-[1-4].ts`, `probe-*.log`; classifier `classify.py`.
Test programs are `crafted` or `plausible` witnesses; `tycho-*` files come
from Tycho.

**Tycho's showcases** (read only). Of the 43 functions of 14 of the 15
preludes (`design-program/census.ts`; `turing-patterns` did not finish in
300 s), 28 compile under the profile. The one kind beyond numbers, booleans, lists and
tuples is the colour: `c` (`buddhabrot`) and `shade` (`julia-set`) return
`rgb(…)` as `-> color`. No prelude function uses a string, a dictionary or a
record (the plan's `Dictionary` is the `let` form `Declare(x, {"value" ->
…})`). The colour rows of `template-data.js` (lines 873-886, 975-976) are
`Which` of `oklch(…)` and `rgb(…)`: corpus witnesses for colours.

## 1. Scope

| Option | Public API | `canCompile()` | Result | Retirement |
| --- | --- | --- | --- | --- |
| A. `profile: 'program'`, a superset of `numeric-kernel` | a second value of the option | answers per profile | `profile: 'program'` | when `program` admits what must keep compiling (D4), a call with no `profile` uses it |
| B. Widen `numeric-kernel` | none | one answer | unchanged | the same; `numeric-kernel` then admits strings and colours |
| C. Internal until it is the default | none until the switch | `ok: false` for the new kinds until then | unchanged | the switch is the first public change |

**Recommended: A.** One route and one admission, the vocabulary a parameter
of the admission: `numeric-kernel` is `program` restricted to numbers,
booleans, lists and tuples of numbers and function operands as regions, and a
program that `numeric-kernel` admits gets the same code under `program` (a
test). B removes what a host of `numeric-kernel` relies on (every value is a
number, a boolean or an array of them); C gives Tycho no way to try the
profile before the default changes.

**Carried over** from the
[numeric-kernel spec](2026-11-10-js-numeric-kernel-profile-spec.md): the
contract (the interpreter's value within the caveats and the existing
compiler's values and shapes with `cse: false, constantFold: false`, or a
decline); `outside-profile` naming the first node; `canCompile()` answers as
`compile()`; names with no declared type (a number of the mode; a use as a
string, colour or record declines); types written by `ce.infer()`,
`ce.assume()`, `ce.assign()`; the options of the host; `cse` and
`constantFold` ignored (a colour value is never folded on the existing route
either); `pure`, `shippable`, `defaultedSymbols`. **New rules**: a host
function takes and gives numbers, so a host call with a value of a new kind
declines; the route passes the result type it proves to the assembly, which
normalizes by it (`normalizeKeyedRunResult()` for a record);
`freeSymbolTypes[…].lowered` names each input's representation (`string`,
`color`, `array`, `number`; probe-4); the stored metadata holds the profile.

## 2. The value kinds, most frequent first

Each kind is a type of the core (`structured-ir.ts`), represented by the
JavaScript policy (`javascript-structured-policy.ts`); the verifier checks each
signature and representation. Operations follow the `collection` pattern: one
kind per family with a function name, whose signature the core states and
whose helper the emitter writes. All are `pure`; some can abort (`error`).

### 2.1 Colours (581 in the census)

**Type** `color`, with no space in the type (on JavaScript the value carries
it, on GLSL it is a compile-time fact: COMPILATION-MODEL "Color values");
`list<color>`; `tuple<real, real, real>` for components.

**Existing code** (`javascript-target.ts`, handlers `Color` to `ColorDelta`;
`colorHelpers`, `javascript-runtime.ts`; probe-1): one helper per head.
`Rgb(x, y, 0.5)` is `_SYS.rgb(_.x, _.y, 0.5)`, the object `{space: "oklch",
c0, c1, c2, alpha: undefined}` (`Hsv`, `Hsl`, `Oklab`, `Oklch`, `Color("red")`
alike); `AsRgb(c)` gives `space: "rgb"`; `AsOklch(Rgb(…))` is the operand
itself when `colorSpaceOf()` proves it canonical; `ColorToString(c)` a string
(`"#336680"`); `ColorDelta` a number; `ColorToColorspace(c, "hsv")` an array
of 3 channels (4 with an alpha). A list of colours is an array (`AsRgb(L)` is
`_SYS.bcastColor(…)`). A `color` input accepts an object or a CSS string
(`"red"` gives `"#d7170b"`; an array throws a `TypeError`; probe-4).

**Operations**: `color` with the names `rgb`, `hsv`, `hsl`, `oklab`, `oklch`,
`parse`, `as-rgb` (and the other four), `to-string`, `gamut-map`, `mix`,
`delta`, `contrast`, `contrasting`, `to-colorspace`, `from-colorspace`. A
literal tuple at a colour position is converted as `Rgb(r, g, b)`; another
tuple at a head that consumes a colour declines, as now. The `AsOklch`
identity is a rule of the lowering (`colorSpaceOf()`, `color-space-fact.ts`).
An element-wise form is a `build` of the scalar operation.

**Policy**: `color` is the object; an input is `color-input` (the object or a
CSS string), which only colour operations read and a result returns as it is
(`If(x > 0, c, Rgb(1, 0, 0))`, as now). No equality or ordering of colours.
**Declines**: `Colormap` (type `color | list<color>`; 12); a use of
`ColorToColorspace` other than `At` at a literal 1 to 3; a format or gamut
that is not a literal.

### 2.2 Strings and characters (480: heads 348, bindings 89, `list<string>` 43)

**Types** `string`, `character` (one grapheme cluster), `list<string>`,
`list<character>`.

**Existing code** (`javascript-target.ts`, `String`, `StringJoin`,
`Characters`, the sequence-search family; `chars`, `ct`, `eqt`, `cmpc` and
other helpers, `javascript-runtime.ts`; probe-2): a literal is a JavaScript
string; an input is read raw (`_.s`); `String(s, t)` is `((_.s) +
(_.t)).normalize()`; `Length(s)` is `_SYS.chars(_.s).length` (grapheme
clusters, `Intl.Segmenter`); `At(s, 2)` is `_SYS.at(_SYS.chars(_.s), 2)` with
`NaN` read as `undefined`; `ToUpperCase(s)` is
`_SYS.ct(_.s).toUpperCase().normalize()`; `StringReplace`, `PadStart`, `Trim`,
`IsMatch` a helper each; `StringRepeat` checks its count (`_SYS.domi`, a
throw). `String(x)` of a number declines there.

**Equality and ordering** (D3): `s == t` is `_SYS.eqt(s, t)`, equality of the
conditioned content (NFC, lone surrogates replaced), so the precomposed é
(U+00E9) equals e followed by U+0301, as in the interpreter; `s < t` is
`_SYS.ct(s) < _SYS.ct(t)`, UTF-16 code-unit order of the conditioned text,
which the runtime comment calls the interpreter's own; characters compare by
code points (`_SYS.cmpc`, also `StringCompare`).

**Operations**: `text` with the names `concat`, `join`, `string-join`,
`length`, `at`, `chars`, the comparisons, `compare`, `upper`, `lower`,
`case-fold`, `replace`, `pad`, `trim`, `repeat` and `is-match` (both can
abort), `starts-with`, `ends-with`, `contains`, `index-of`, `reverse`, `take`,
`drop`. A string literal is an `IRLiteral` of type `string`. A helper called
with a string argument is a function of its own (R2; `_fn_f_string`).
**Policy**: a JavaScript string, not conditioned at entry, each operation
conditioning its operands as the helper does; `list<string>` an array of
strings; the absent string or character `undefined`. **Declines**: `String`
of a value that is not text (as now); a union of text and another kind
(`character | string` 9; section 3).

### 2.3 Points (347: heads 310, point restriction 17, wide tuple inputs 20)

**Existing code** (probe-3): `PointList(x, y)` is `[_.x, _.y]`, of lists a
loop to the shorter length; `PointX(P)` is `(_.P[0] ?? NaN)`, of a list of
points a `map`; `Distance(P, Q)` is `_SYS.distance`; `P == Q` is
`_SYS.eq(P, Q)` (`eqTensor()`); `If(0 < x, (x, y))` gives `[NaN, NaN]` when
false; `(z, 1)` is `[{re: 1, im: 2}, 1]`.

**Rules**: the tuples of the core gain `complex` coordinates (a mixed array,
as for `list<complex>`). `PointList` of scalars is `tuple`; `PointX`,
`PointY`, `PointZ` of a tuple are `get`; `Distance`, `Quadrance` and `same`
(`Equal`, `NotEqual` of two arrays, written `_SYS.eq`) are `collection`
functions; a point-valued `If` with no else gives `[NaN, …]`. A tuple element
declared `number` is real in the `strict` mode, as a name declared `number`
is. `PointList` of lists and `PointX` of a list of points wait for lists of
tuples (collections note, slice 4).

### 2.4 Absence (106: operators 59, the symbol `Missing` 47)

**Existing code**: the absent value is `NaN` for a number, `[NaN, …]` for a
point, `undefined` otherwise (caveats of compiled code). `IsMissing(v)` is
`Number.isNaN((v) ?? Number.NaN)`; `Coalesce(a, b)` is `((_c) =>
Number.isNaN(_c ?? Number.NaN) ? b : _c)(a)`; `AssertPresent` throws
(`compileExprIsMissing()`, `compiler-core.ts`; `compile-expr-handlers.ts`;
`compile-conditionals.ts`). **Operations**: `absent` (a literal whose value
the policy gives per type), `is-absent`, `coalesce` (a region operation whose
second region runs only when the first value is absent), `assert-present`
(can abort). They discharge the caveats, so their values must be exact.

### 2.5 Records and dictionaries (19)

**Existing code** (COMPILATION-MODEL "Dictionary literals"; probe-3): `{"a" ->
x + 1, "b" -> "s"}` (`record{a: real, b: string}`) is `({"a": _.x + 1, "b":
"s"})`, a new object per evaluation; a dictionary input passes through
(`({"a": _.d})`). No read compiles there (`At(d, "a")`, `Field(r, "a")`,
`Keys(d)`, `Length(d)` decline). **Rules**: types `record{k: T, …}` and
`dictionary<T>`; one operation `record` (keys, then the values in literal
order); a value of type `unknown`, `any` or that can be `Nothing` declines.

### 2.6 Kinds outside the first version

| Kind | Census | Existing code | Why later |
| --- | --- | --- | --- |
| function values (a root parameter of a function type, a local function assigned twice) and recursion | 73 | the host's JS function; `const _fn_R_0 = (i, x, y) => … _fn_R_0(…)` | a call graph with cycles in `analyzeExecution()`; an effect for an unknown callee; `fill` of `apollonian-gasket` is a corpus witness |
| `RandomChoice`, `RandomSample`, `RandomShuffle` | 49 | `_SYS.randomSample(_SYS.domainRange(…), 6)` | run-time domain checks (random note §5) |
| `Match` | 32 | an applied arrow function | a lowering to `if` regions |
| value kinds with a contract (`gf8`, `Row`, `mpt`, …) | 31 | the hooks' text (`kind-lowering.ts`) | an operation carrying that text, a representation named by `lowered()` |
| protocol and multi-clause dispatch | 30 | the nominal tag at run time | a dispatch region |
| a declared union at a binding (`list<real> \| real`) | 95 | `(Array.isArray(_.u) ? … : …)` | R4 |

Sets and intervals as values, `Hold` (a symbol as a value), `Quantity`,
`Measurement`, `Error` and `Nothing` as an operand decline on the existing
route too (probe-3): retirement needs nothing for them.

## 3. Shape rules

R1 to R6 of COMPILATION-MODEL ("Shapes are settled at compile time") hold as
for the numeric kernel. **R1**: a name with no declared type is a number; a
string, colour, record or dictionary input is declared. **R2**: a helper is
one function per argument types (`_fn_f_string`). **R3**: each value has one
representation; a union of kinds with different representations (`string |
real`, `color | list<color>`) declines (`unsettled-shape` where the existing
compiler has that code, `outside-profile` otherwise). Two unions are one
representation that only helpers read: `color-input` and the mixed array of
complex values. A record type that does not state its fields
(`dictionary<any>`) passes through and is never read; `any` and `unknown`
decline. **R4**: a declared union at a binding (one dispatch, one body per
member) is not in the first version: 95 in the census, all test programs.
**R5, R6**: no new run-time test; the entry steps stay those of the assembly,
which refuse no value for a `string` binding (`Length(s)` at `s = 3` throws in
`_SYS.chars`, a value outside its type, as now).

## 4. Element-wise selection (148, and `list<boolean>` inputs 18)

**Existing code** (`compileJSSelection()`, `javascript-target.ts`; `select`,
`restrict`, `javascript-runtime.ts`): `If(0 < L, 1, 2)` is `_SYS.select(() =>
(cond), () => (1), () => (true), () => (2))`. The helper tests at run time
whether each condition is an array, evaluates a condition at most once and an
arm only when some position selects it (then once, whole), gives `NaN` when
two array participants differ in length, and the cell's absent value where no
clause selects. A restriction `If(0 < L, x)` is `_SYS.restrict(conds, value,
zip, absent)`: a list value aligned and cut to the shorter, a scalar repeated
(`[7, NaN]`).

**Rule for the route.** The type settles whether a condition is a boolean or
a `list<boolean>`, so nothing is tested at run time. A list condition makes a
`build` over its length whose body is the scalar selection of the cell (`if`
regions in clause order), each arm read with `at` or as a scalar. Admitted
when every list participant has a length equal by construction to the first
condition's (otherwise the existing code can give `NaN`, another shape), and
every arm and later condition is pure and cannot abort (the route evaluates
them at every position; the existing code skips an arm that no position
selects). A restriction is a `build` to the minimum of the two lengths. A
point arm stays whole, its absent cell `[NaN, NaN]`; a string arm declines, as
now. The policy gains `list<boolean>` (`0 < L` is an array of booleans).

## 5. Effects

None of these kinds brings an effect. No string helper depends on a locale:
`chars` uses `Intl.Segmenter('en', { granularity: 'grapheme' })` (UAX #29),
`toUpperCase()` is locale-independent, and no helper calls `toLocale*` or
`localeCompare` (`javascript-runtime.ts`, searched). Colours, strings and
records are plain data that a worker can receive, and the existing compiler
reports `shippable: true` for each probe of probe-4. So `pure` and
`shippable` keep their definitions. The aborts (`repeat`, `is-match`,
`assert-present`) are not effects: no transformation removes one or runs it
where the program would not (bigint note §3).

## 6. The census by class

Counts of the 7,282 declines of the sample, each program once, by its first
refusal (a later refusal can be hidden).

| Class (first refusal) | Count | Section | First version |
| --- | --- | --- | --- |
| colour heads | 581 | 2.1 | yes |
| strings and characters | 480 | 2.2 | yes |
| point heads, point restriction, wide tuple inputs | 347 | 2.3 | yes, except lists of points |
| element-wise selection, `list<boolean>` inputs | 166 | 4 | yes |
| absence operators and `Missing` | 106 | 2.4 | yes |
| record and dictionary literals | 19 | 2.5 | yes |
| function values and recursion 73; random collections, `Match`, value kinds, protocol dispatch 142; declared unions at a binding 95; `set<…>` parameters 20 | 330 | 2.6, 3 | later (sets decline) |
| numeric-kernel and collections work: scalar forms, modes and options (`Mod`, a folded `Root`, `Limit`, complex comparisons, `bigint`, …) 2,012; parameters typed `any` or `collection<…>` or with no annotation 485; other list types and list operands (`list<number>`, `vector<n>`, list arguments, broadcast comparisons) 587; flat-list functions (`IndexOf`, `Second`, …), statistics, loops over a list, captured lists 693; statements and locals (`Return`, a destructuring `Assign`, `ParallelLoop`) 167; other bindings 13 | 3,957 | — | other notes |
| helper results that are not numbers or lists of numbers (mostly points) | 44 | 2.3 | with points |
| excluded: nested lists 752, lists of tuples 269, `Integrate`/`D` 105, user functions as operands 77, `Range` with a step 52 | 1,255 | — | own notes |

**Estimate.** The first version would admit about 1,700 of these programs,
fewer by those with a second refusal. Since the sample holds nearly all the
full-suite declines of these classes, the full suite would move from 20,959
to about 22,300 to 22,700 of 31,049 (72 to 73%). What remains: the numeric
kernel and collections work (about 4,000 in the sample), the excluded classes
(1,255), and the later kinds of this spec (about 330).

## 7. Implementation order

Each slice is one reviewed commit with a test file
`compile-javascript-structured-<kind>.test.ts` (both modes; against the
existing compiler with `cse: false, constantFold: false`: numbers by
`Object.is`, strings by `===`, a colour's `space`, channels and `alpha`;
against the interpreter), verifier cases, a negative test per decline,
generators in `scripts/js-profile-fuzz.ts`, the shadow measure on the files
of its heads, and the prelude census.

1. **The option**: `profile: 'program'` in `compile()` and `canCompile()`, the
   admission's vocabulary parameter, the stored metadata, a shadow measure of
   a chosen profile (`CE_JS_PROFILE_SHADOW=program`). Test: each program that
   `numeric-kernel` admits has the same code under `program`.
2. **Colours**, strings only as literals, results and pass-through (2.1):
   `shade`, `c` (which also needs the `let` value form), `template-data.js`,
   the `tycho-item-*` colour tests. About 580.
3. **Strings and characters** (2.2), about 480. 4. **Points** without lists of
   points (2.3), about 330. 5. **Absence** (2.4), about 100. 6. **Element-wise
   selection** with `list<boolean>` (4), about 160. 7. **Records and
   dictionaries** (2.5), about 20.
8. **Later**, each with a note and a measure: function values and recursion,
   R4 dispatch, `Match`, random collections, value kinds.

## 8. Decisions for the user

**D1. The option.** (a) `profile: 'program'`, a superset of
`numeric-kernel`: `compile(e, { to: 'javascript', profile: 'program' })`
compiles `ColorToString(Rgb(x, 0, 0))`, and with `'numeric-kernel'` it
declines with `outside-profile`; (b) widen `numeric-kernel` (the same call
with `'numeric-kernel'` compiles); (c) no option until the default switches.
Recommended: (a).

**D2. Representations as a public contract.** (a) The values are those that
COMPILATION-MODEL documents for the existing compiler, and the guide says so
(a colour `{space, c0, c1, c2, alpha}`, a JavaScript string, a plain object
for a record, the absent value `NaN`, `[NaN, NaN]` or `undefined`); (b) only
the value of `run()` is public. Recommended: (a), which retirement needs.

**D3. Compiled comparison of strings.** (a) As now, and as the interpreter:
equality of conditioned content, `<` on conditioned UTF-16 code units,
characters by code points (é as U+00E9 equals e plus U+0301); (b) raw `===`
and `<` (that pair is unequal where the interpreter says equal: a wrong value,
which would need a caveat); (c) code-point order for strings too (U+10000
then sorts after U+FFFF, where the interpreter's `<` sorts it before).
Recommended: (a).

**D4. What the default needs before it switches.** (a) The profile admits
every class that the existing compiler compiles; (b) every class with a
`corpus` or `plausible` witness, and a class with only `crafted` witnesses
falls back to the interpreter on the new default, with a known-limitations
line (`AGENTS.md`: a decline is removed only for such a witness) and the
changed `canCompile()` answers in `CHANGELOG.md`. Example:
`Match(x, MatchCase(1, 2), MatchCase(_, 3))` (`compile-admission.test.ts`)
compiles today and would fall back under (b) if its witnesses are crafted.
Recommended: (b), with the witness strength of each class of section 6
recorded before the switch.

**D5. A colour input given as a CSS string.** (a) Keep it (`color-input`, as
now); (b) require an object (`run({ c: "red" })` throws). Recommended: (a):
(b) breaks a host that passes `"red"` today.

**Open technical choices** (recommendation first): the new kinds are named
types of the core, represented by the policy (not opaque types named by a
target); one operation kind per family (`color`, `text`, `record`, absence),
so that the verifier checks a signature per name (not one generic runtime
call); the colour space is a fact of the lowering, not a type; a selection
arm runs at every position only when it is pure and cannot abort, else the
selection declines; the shadow measure takes the profile.

## Not determined

- The witness strength of the string, record and absence classes: the census
  saw only test programs, and the showcases use none of these kinds.
- Counts per class over the whole suite: the census is a sample of 449 files,
  and a first refusal hides the later ones.
- Whether the colour helpers give the same doubles when the route writes the
  same calls in the same order (expected, not measured).
- How `_SYS.eq` (`eqTensor()`) treats `NaN` and `-0` coordinates, which
  `same` must state; not read. Equality of two colours: not probed.
