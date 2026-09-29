# `Indeterminate`: an exact value for an exact question with no answer

**Status:** Decided 2026-09-28. The user took the recommended option of every
decision in §7 (D1 two values; D2 a marked second literal with `isExact`
false; D3 contact with an inexact operand gives `NaN`; D4 the
`Indeterminate` spellings; D5 the arithmetic forms plus the exact-lane
funnel if Phase 0 confirms it; D6 handlers without the gate answer `NaN`;
D7 `IsMissing(Indeterminate)` is `False`). Amended after Phase 0: the
eight findings of §6 Phase 0 are resolved in §4, §5, §6 (Phases 1–3) and
§7 — the forwarding rule moves into the `Sum`/`Product` fold classes and
the reducers, D7 is applied to the shared absence test, `.N()` gets a
final map, and D5 is widened to every exact form with no value while the
exact-lane funnel is NOT switched (the user confirmed the widened D5 on
2026-09-29; recorded in §7 D5). Revised the same day after a
spec review (one reviewer, 18 findings, all folded in; the second reviewer
was unavailable). Proposed by the reporter of GitHub issue #355
(enumeratio); the direction was accepted by the user on 2026-09-28, with the
design written before any code. Phase 0 done 2026-09-28 (results in §6; they correct §2 and found eight places where §4–§5 could not be implemented as first written, resolved in the amendment above). Phase 1 (the value, no producer switched) done 2026-09-28. Phase 2 (the exact producers switched) done 2026-09-29, results in §6 Phase 2. Every fact in §2 was read from the
code at commit `af09cc1c` (all paths under `src/compute-engine/` unless
stated).

## 1. The problem

Exact indeterminate forms evaluate to `NaN`, although no floating-point value
is involved. Several of them fold at canonicalization, before `evaluate()`:

| Input | Canonical form today | `evaluate()` today | Proposed |
| --- | --- | --- | --- |
| `["Divide", 0, 0]`, `\frac{0}{0}` | `NaN` | `NaN` | `Indeterminate` |
| `["Power", 0, 0]`, `0^0` | `NaN` | `NaN` | `Indeterminate` |
| `["Divide", "PositiveInfinity", "PositiveInfinity"]` | `NaN` | `NaN` | `Indeterminate` |
| `["Power", "PositiveInfinity", 0]`, `["Power", 1, "PositiveInfinity"]` | `NaN` | `NaN` | `Indeterminate` |
| `["Multiply", 0, "PositiveInfinity"]` | kept | `NaN` | `Indeterminate` |
| `["Subtract", "PositiveInfinity", "PositiveInfinity"]` | kept | `NaN` | `Indeterminate` |
| `["Mod", 5, 0]` | kept | `NaN` | `Indeterminate` |
| `["Fract", "PositiveInfinity"]` (`∞ − ⌊∞⌋`) | kept | `NaN` | `Indeterminate` |
| `["Divide", {"num": "0.0"}, {"num": "0.0"}]`, `\frac{0.0}{0.0}` | `NaN` | `NaN` | `NaN` (unchanged) |
| `["Add", "NaN", {"num": "1.5"}]` | kept | `NaN` | `NaN` (unchanged) |

(A JSON literal `0.0` is the integer `0`; a float input is written
`{"num": "0.0"}` or in LaTeX.)

`NaN` is an IEEE 754 notion: the result of a floating-point operation with no
meaningful value. The mathematical notion is an indeterminate form. The engine
splits exact from inexact everywhere else (a literal `2.0` is a float, `2` is
exact; `Round(2.5)` is the exact `3` since 2026-09-28), and "0/0 has no value"
is an exact statement about an exact question. Answering it with the float
marker breaks the exactness contract in the same way `Round(2.5)` answering
`3.0` did.

The reporter's second motive is interoperability: they cross-check examples
against a Wolfram kernel, where `Indeterminate` is the answer to these forms,
and today every `Indeterminate` must be mapped to `NaN`, which loses the
difference between "this exact expression has no value" and "a floating-point
computation failed".

## 2. What the code does today

- **`NaN` is a number literal, not a symbol.** `ce.NaN` is one interned
  `BoxedNumber` whose value is the double `NaN`: `isNumber` is `true`,
  `isNaN` is `true`, `isExact` is `false` (deliberately, see below), and
  `isMachineNumeric` is `true`. Its `.type` is the value type `NaN` (kind
  `value`, printed `NaN`), which widens to the singleton `nan`
  (`common/type/widen-value.ts:127`, `subtype.ts:1166`); `matches('nan')` is
  `true`. Its MathJSON spelling is the symbol string `"NaN"`
  (`boxed-expression/serialize.ts:1002`), `{num: "NaN"}` is also accepted on
  input (`boxed-number.ts:1915`); its LaTeX is `\operatorname{NaN}`; its
  Epsil is `NaN` (`src/epsil/serialize-epsil.ts:58`, the value-spelling
  table at line 1831, and `NaN` in the Epsil reserved words, parser, library
  names and syntax highlighter).
- **`isExact` is `false` on purpose** (`boxed-number.ts:1377–1401`): a
  numeric function of a `NaN` argument must numericize under plain
  `evaluate()`, so that `sin(NaN)` answers `NaN` instead of staying inert,
  which `docs/ERROR-MODEL.md` §1 forbids as the terminal answer to a
  decidable question. The `apply.ts` exactness test and many handlers
  (`trigonometry.ts` and others) branch on `isExact`.
- **The propagate gate.** Before an operator's handler runs, the generic
  evaluation code scans the operands for `isNaN` and applies the
  operator's `nanBehavior` policy (`boxed-function.ts:4960–4983`, and again
  at `:5894`): `reject` answers an `unexpected-argument` error, `propagate`
  answers **a fresh `this.engine.NaN`**, not the operand it saw. Operators
  that bypass the gate (a `reject` slot, a lazy operator, a broadcast cell
  under the `widen-nan-cells` rule) reach their handler, which typically
  rebuilds a result from `.re` and so produces a fresh machine `NaN` as
  well.
- **Identity.** `isSame` compares number literals by numeric value, not by
  spelling: the exact `1/2` and the float `0.5` are the same literal and hash
  alike (`boxed-number.ts:311`, hash `${re}:${im}` at `:323`). So
  `ce.NaN.isSame(ce.NaN)` is `true`; `NaN.is(NaN)` is `true` (through
  `isSame`); `Equal(NaN, NaN)` evaluates to `False`; `NaN.isEqual(NaN)` is
  `false`; `Max(1, NaN)` (its handler) and `Sqrt(NaN)` (the gate) are `NaN`; a list cell
  `[1, 0/0]` is typed `list<integer | nan^2>`.
- **Absence discharge.** `IsMissing(NaN)` is `True` and `Coalesce(NaN, 5)`
  is `5`: the absence-discharge operators treat `NaN` as absent, an
  information loss that ERROR-MODEL §1 records. `IsMissing(0/0)` is
  therefore `True` today.
- **Boolean context.** `And(NaN, True)`, `Or(NaN, False)`, `Not(NaN)` and
  `If(NaN, 1, 2)` are `incompatible-type` errors; the Kleene rules of
  2026-09-27 apply to `Missing`/`Undefined`, not to `NaN`. Comparisons with
  `NaN` are `False`.
- **Search and order.** `Element(NaN, [1, NaN])` is `True` and
  `IndexOf([1, NaN], NaN)` is `2` (structural identity); `Sort([3, NaN, 1])`
  is `[1, 3, NaN]`; `Unique([NaN, NaN, 0/0])` is `[NaN]`.
- **Producers** (counts to be taken again in Phase 0; the figures here are
  from `af09cc1c`): `ce.NaN` is returned at about 88 sites in the arithmetic
  folds (`boxed-expression/arithmetic-add.ts`, `arithmetic-mul-div.ts`,
  `arithmetic-power.ts`, `library/arithmetic.ts`) and in `boxed-number.ts`
  and the gate in `boxed-function.ts`; the exact numeric-value class
  (`numeric-value/exact-numeric-value.ts`) makes an exact-lane `NaN` as the
  rational `[NaN, 1]` (its `isExact` is always `true`), which
  `fromNumericValue` (`box.ts:3784`) maps to `ce.NaN` on the way out. The
  producers fall into three kinds:
  1. **exact indeterminate forms** on the exact route: `0/0`, `0·∞`, `∞/∞`,
     `∞ − ∞`, `0^0`, `∞^0`, `1^∞`, `0·~oo`, `~oo ± ~oo`, `Mod(x, 0)` (also
     with a symbolic `x`), `Ln(0)/Ln(0)` and the like (`Gamma(0)` and
     `Gamma(0, 0)` are not: they are the pole `ComplexInfinity`);
  2. **floating-point failures**: a machine or big-decimal kernel returned
     `NaN` (`0.0/0.0`, a float out of a real kernel's domain, a decline
     signalled by a numeric kernel);
  3. **absence markers**: an absent operand minted to `NaN` by the
     2026-09-26 rules (`Missing + 2` in a broadcast cell is `NaN`,
     `Length(Missing)` is `NaN`, a `Map` callback that errors per element
     answers a `NaN` cell under `.N()`), and every `propagate` site that
     forwards a `NaN` it received.
- **Type.** `nan` is a refinement of `number`, disjoint from `complex`,
  `infinity` and `error` (ERROR-MODEL §5, ratified 2026-08-27, where it is
  called a singleton). Contract B derives result types such as `real | nan`.
- **Compiled routes.** The JavaScript, GLSL, WGSL, Python and interval
  targets spell the value as the target's IEEE `NaN` through per-target
  symbol tables (`NaN: 'Number.NaN'` in `javascript-target.ts`); the
  compiler has paths keyed on `isExact` for number literals
  (`base-compiler.ts`: `literalHasNoDoubleValue`, `exactRationalDivisor`,
  the exact-exponent tests); a constant fold that meets a `NaN` cell
  declines (2026-09-27), because it cannot tell an error's `NaN` from a
  computed one.
- **`Indeterminate` today** is a free user symbol: `ce.box("Indeterminate")`
  is typed `unknown`, `Indeterminate + 1` stays symbolic, and
  `\operatorname{Indeterminate}` parses as a product of letters.
- **Footprint.** 179 test files under `test/compute-engine/` assert a `NaN`
  in some form; one snapshot file mentions `NaN` (12 lines). Most of those
  assertions are kinds 2 and 3 and do not change.

## 3. What Mathematica does

Mathematica has one symbol, `Indeterminate`, and **no `NaN`**. It is the
answer to `0/0`, `0 ∞`, `∞ − ∞`, `0^0` and `Mod[5, 0]`, and also to the
machine-float `0./0.` (with messages). `Limit` returns it for a limit that
does not exist, and `FunctionConvexity` returns it for a function that is
neither convex nor concave: both are decided answers, "no determinate
value", not "the kernel could not decide". So the precedent supports the
**name** and one meaning; the exact/inexact **split** the reporter proposes
is this engine's own convention, applied to one more case. (Wolfram
behaviors stated from documentation knowledge, not checked against a
kernel.)

## 4. The proposal

Two values, one type, one exactness answer:

- **`Indeterminate`** is the exact-route answer to an indeterminate form. It
  is a second interned number literal with the double value `NaN`:
  `isNumber` true, `isNaN` true, and a new mark `isIndeterminate` true.
  `isExact` stays **`false`**, exactly as for `NaN`, for the reason recorded
  in `boxed-number.ts`: an `isExact` marker would send the value into every
  "exact argument stays symbolic" branch and make `sin(0/0)` inert, which
  the error model forbids. The exactness the value represents is a fact
  about the ROUTE that produced it, carried by the mark, not by the literal's
  exactness flag. Its `.type` is a new value type printed `Indeterminate`,
  which widens to the same `nan` (so `nan` has two members from now on and
  the word "singleton" in ERROR-MODEL §5 is amended).
- **`NaN`** stays the floating-point failure and the absence marker,
  exactly as today.
- **The gate forwards.** The propagate gate (`boxed-function.ts:4983`,
  `:5894`) answers the `NaN`-valued operand it saw when every `NaN`-valued
  operand is `Indeterminate` and no operand is inexact, and `ce.NaN`
  otherwise (so `Sqrt(Indeterminate)`, `Abs(Indeterminate)` and
  `Sin(Indeterminate)` are `Indeterminate`, and `Arctan2(Indeterminate,
  NaN)` is `NaN`). The `reject` policy is unchanged (an error). Every other
  guard, policy, Contract B derivation and fail-closed compile decision
  sees `Indeterminate` as a `nan` and behaves as it does for `NaN`.
- **The fold classes forward.** `Add` and `Multiply` are `lazy`, so the
  gate never runs for them; their `NaN` handling is in the fold classes
  `Sum` (`arithmetic-add.ts:1003`) and `Product`
  (`arithmetic-mul-div.ts:197`, `:735`, `:816`). The same rule lives there:
  an `Indeterminate` term makes the sum or product `Indeterminate`, UNLESS
  any term is inexact (a float or `NaN`), in which case the answer is
  `NaN`. `Sum` must look for an inexact term BEFORE it short-circuits on a
  `NaN`-valued one: today it drops the other terms at that point, which
  made `Indeterminate + 1.5` answer `Indeterminate` in the Phase 0 probe.
- **The reducers forward.** `Max`, `Min`, and every reducer that does not
  run the gate (the statistics reducers that read their data through
  `collectData`, `library/statistics.ts:1764`, and the quantile family,
  `library/distributions.ts:1323`) follow one handler rule: an
  `Indeterminate` operand with no `NaN` operand gives `Indeterminate`; a
  `NaN` operand gives `NaN`. So `Max(1, Indeterminate)` and
  `Mean([1, Indeterminate])` are `Indeterminate`, and
  `Max(Indeterminate, NaN)` and `Max(NaN, Indeterminate)` are `NaN`.
- **Elsewhere, where the gate does not run, the answer is `NaN`.** A
  handler outside the gate, the fold classes and the reducers above, when
  reached with an `Indeterminate` operand (an operator whose policy is
  `inert` or `handle`, another lazy operator, a broadcast cell under
  `widen-nan-cells`), computes through its kernel and produces a machine
  `NaN`. That is the inexact route, and `NaN` is its correct answer. Phase
  0 (c) lists the operators concerned so that the CHANGELOG can name them;
  they are not audited one by one.
- **`.N()` of `Indeterminate` is `NaN`**, and so is any contact with an
  inexact operand (`Indeterminate + 1.5` is `NaN`): the 2026-09-27 rule that
  a float operand makes a numeric result a float applies, and the compiled
  targets, which have only IEEE `NaN`, fold it to `NaN`. The mechanism is a
  final `Indeterminate` → `NaN` map at the entry points of numeric
  evaluation — `BoxedFunction.N()`, `BoxedNumber.N()` and
  `evaluate({numericApproximation: true})` — so that every numeric route
  ends in `NaN` whatever a producer knew. A producer cannot always know:
  under `.N()` the product is rebuilt through `Product.asExpression()`
  without the `numericApproximation` option (`mulNEvaluated`,
  `arithmetic-mul-div.ts:2649`).
- **Spelling.** MathJSON: the symbol string `"Indeterminate"` (as `"NaN"` is
  a symbol string today); `{num: "Indeterminate"}` is NOT accepted, `{num:
  …}` stays numeric text. LaTeX: `\operatorname{Indeterminate}`, with a
  dictionary entry so that it parses. Epsil: `Indeterminate`, added to the
  reserved words, the parser, the library names, the value-spelling table
  and the syntax highlighter next to `NaN`. `String(Indeterminate)` is the
  string `"Indeterminate"` and `Interpret("Indeterminate")` gives the value.
  Both spellings parse from every route; `ce.Indeterminate` joins `ce.NaN`
  on the engine API. The CLI, MCP and VS Code formatters print the value as
  they print `NaN`, with the new spelling.
- **Absence discharge** (decision D7): `IsMissing(Indeterminate)` is
  `False` and `Coalesce(Indeterminate, 5)` is `Indeterminate`. An
  indeterminate form is a value with no number, not a missing entry, and
  this is the one place where the new value removes the information loss
  ERROR-MODEL §1 records for `NaN`. The mechanism is the SHARED test
  `isAbsentValue` (`boxed-expression/type-guards.ts:112`): it becomes
  "an absence symbol, or `isNaN` and not `isIndeterminate`", so none of
  the absence machinery treats `Indeterminate` as absent, and the operators
  that use the test then answer through the forwarding rules above
  (`Mean([1, Indeterminate])` is `Indeterminate`, not the absence answer).
  Its users are `IsMissing` (`library/core.ts:3209`), `Coalesce`
  (`:3263`), `processMinMaxItem` for `Max`/`Min`
  (`library/arithmetic.ts:9530`), the statistics data readers
  (`library/statistics.ts:1796`, `:1810`, `:1879`, `:2263`, `:2402`), the
  empirical quantile (`library/distributions.ts:1366`), `PointList`
  (`library/collections.ts:5130`), `Field` (`:8866`) and chained `At`
  (`:9485`, `:9504`). The numeric missing-value gate does NOT use it: it
  reads `isAbsentScalarSymbol` (`validate.ts:866`), which has no `NaN` arm,
  and the compiler has a local test of the same name
  (`base-compiler.ts:28533`) that reads the two absence symbols only; both
  are unchanged. The list-cell repair of `validate.ts:952`, which rewrites
  a `NaN` cell of a `List` to `Missing` when the element type admits
  `missing`, excludes `Indeterminate` too.
- **Not introduced:** a "cannot decide" meaning. The engine answers that by
  staying inert or by returning `undefined` from a handler, and the error
  model separates "no value" from "not decided" on purpose (ERROR-MODEL
  §1). Mathematica's `Indeterminate` is one meaning (§3), so nothing is lost
  by not adding a second.

## 5. The decision table at the seams

The absent-values round of 2026-09-26 showed that a new "no value" marker
costs its seams, not its definition. Each row is a behavior that has to be
pinned by a test.

| Seam | Rule | Note |
| --- | --- | --- |
| Exact fold or canonicalization meets an exact form with no value | `Indeterminate` | The producers of D5 switch, including the canonical-time folds (`0/0`, `0^0`, `∞/∞`, `∞^0`, `1^∞`), `Mod(x, 0)`, `Fract(±∞)`, `(−1)^±∞`, `∞^(imaginary)`, `0^(imaginary)` and the special functions at an infinite point with no limit; kinds 2 and 3 stay `NaN`. The exact-lane funnel `fromNumericValue` is NOT switched. |
| Propagate gate, all `NaN`-valued operands are `Indeterminate`, none inexact | `Indeterminate` | The gate forwards the operand. `Sqrt`, `Abs`, `Sin` (the gate runs before the kernel). |
| Propagate gate, any operand is `NaN` or inexact | `NaN` | The inexact marker wins, as `2 + 1.5` is a float. |
| `Add`/`Multiply` (lazy), fold classes `Sum` and `Product` | `Indeterminate` unless a term is inexact, then `NaN` | `Indeterminate + 1` and `2·Indeterminate` are `Indeterminate`; `Indeterminate + 1.5` and `Indeterminate·NaN` are `NaN`. `Sum` checks for an inexact term before its `NaN` short-circuit. |
| Reducers outside the gate (`Max`, `Min`, the statistics reducers, the quantile family) | `Indeterminate` with no `NaN` operand; `NaN` with one | A handler rule. `Max(1, Indeterminate)` and `Mean([1, Indeterminate])` are `Indeterminate`; `Max(Indeterminate, NaN)` is `NaN`. |
| Any other handler reached without the gate (`inert`/`handle` policy, other lazy operators, broadcast cell) | `NaN` | The kernel route; named in the CHANGELOG from the Phase 0 (c) list. |
| `reject` policy | error | Unchanged. |
| An inexact operand anywhere in the operation | `NaN` | `Indeterminate + 1.5`, `Indeterminate·2.0`, `Indeterminate` in a float list cell. |
| `.N()`, `evaluate({numericApproximation: true})` | `NaN` | A float. A final `Indeterminate` → `NaN` map at these entry points (`BoxedFunction.N()`, `BoxedNumber.N()`, `evaluate` with `numericApproximation`), so every route ends in `NaN` whatever a producer knew. |
| Compiled routes (JS, GLSL, WGSL, Python, interval) | IEEE `NaN` | A constant `Indeterminate` folds to `NaN`; the `isExact`-keyed literal paths of the compiler never see it, because `isExact` is `false`; the symbol tables gain an `Indeterminate` key for raw MathJSON. |
| `isSame` | Only to itself | An EXCEPTION to the value-based rule for number literals (`1/2` is `0.5`): the two literals differ in kind, so `Indeterminate.isSame(NaN)` is `false` in both directions, and `isSame` with a JavaScript `NaN` primitive is `true` only for `ce.NaN`. The hash gains the kind. |
| `.is()` | Same as `isSame` | Symmetric; the numeric fallback never holds for two `NaN` values. |
| `Equal`, `isEqual`, `IdenticallyEqual` | `False` / `false` | As for `NaN` today, for both values and across them. |
| `Element`, `IndexOf`, `Contains`, `Tally`, `Unique` | Structural identity | `Element(Indeterminate, [NaN])` is `False`; `Unique([NaN, 0/0])` keeps both. |
| Ordering (`Less`, `Max`, `Sort`) | As `NaN` | `Max(1, Indeterminate)` is `Indeterminate` (the reducer rule of `Max`, which does not run the gate); `Sort` places both values where it places `NaN` today, keeping their input order relative to each other. |
| Type | `nan` | `Indeterminate.type` is the value type `Indeterminate`; `matches('nan')` is `true`; no type-keyed guard changes; `list<integer | nan^2>` stays. Code that maps a literal or value type back to a value must keep the kind (Phase 0 search). |
| `isExact` | `false` | Unchanged from `NaN`, see §4. |
| `isMachineNumeric` | `false` | `ce.number(NaN)` does not reproduce it, so by the definition it is not machine numeric; a list holding it leaves the machine and array fast lane, while `[1, NaN]` stays in it. Rare (the list holds an indeterminate form) and lossless. |
| Absence rules (`Missing`, `Undefined`, `Nothing`) | Unchanged | An absent operand still mints `NaN`, never `Indeterminate`. |
| Absence discharge (`IsMissing`, `Coalesce`, and the other operators ERROR-MODEL §3 lists) | Not absent | `IsMissing(Indeterminate)` is `False`; `Coalesce(Indeterminate, 5)` is `Indeterminate` (D7). The shared test `isAbsentValue` excludes `Indeterminate`, so every user of it (listed in §4) sees a value; the operators among them answer by the forwarding rules. |
| List-cell repair (`validate.ts:952`) | Not repaired | A `NaN` cell of a `List` becomes `Missing` when the element type admits `missing`; an `Indeterminate` cell is kept. |
| Boolean context (`And`, `Or`, `Not`, `If`) | `incompatible-type` error | As for `NaN` today. Comparisons are `False`. |
| Serialization round trip | Both spellings parse | `"Indeterminate"` ↔ `Indeterminate`, `"NaN"` ↔ `NaN`, on MathJSON (`.json`, and `form: 'raw'` keeps `Divide(0, 0)`), LaTeX and Epsil. `String`, `Interpret`, the CLI, MCP and VS Code formatters follow. |

The reporter's Wolfram cross-check is not an engine behavior: Wolfram has no
`NaN`, so on their side both values map to `Indeterminate` (§9).

## 6. Blast radius and migration

The `nan` type does not change, so the guard-sweep hazard that the `~oo`
retyping hit (ERROR-MODEL §5, "retyping the literals changes what
type-keyed guards see") does not apply. What changes is the printed answer
of every exact indeterminate form, and the identity of two literals that
used to be one; the risk is in expectations, in `isSame`-keyed code, and in
the funnels that collapse every `NaN`-valued number to `ce.NaN`.

**Phase 0 — measure and list (done 2026-09-28 at `e7249dc5`).** The probe
diff and the raw lists are kept outside the repository (the session
scratch directory: `indet-phase0/probe.diff`, `REPORT.md`); every probe
edit was reverted, and the results are these.

(a) **Blast radius.** The probe added a second interned `NaN`-valued
`BoxedNumber` with a private mark, spelled `Indeterminate` by `.json`,
`toString()` and LaTeX (`\mathrm{Indeterminate}`), with `isSame` and the
hash keyed on the mark, `isMachineNumeric` false and `.N()` giving `NaN`.
Its `.type` stayed the `NaN` value type (so type-keyed code saw no change).
It switched these producers: `box.ts:524` (integer `0/0`);
`canonicalDivide`/`div` in `arithmetic-mul-div.ts` (`:1108`, `:1232`,
`:1250`, `:1384`, `:1486`, `:1557`, `:1591`, `:1593`); the `Product`
coefficient (`:735`, `:776`, `:778`, `:795`, `:816`, `:829`, `:831`,
`:850`) and the `0·∞` fold (`:1848`); `arithmetic-add.ts:1003` and `:1017`
(`∞ − ∞`); `arithmetic-power.ts` `:130`, `:527`, `:529`, `:568`, `:582`,
`:630`, `:642`, `:673`, `:677`, `:747`, `:1833`, `:1840`; the `0·∞` guards
of `BoxedNumber.mul` (`boxed-number.ts:582`, `:589`, `:613`, `:614`,
`:624`); the Contract B `definedWhen` marker (`boxed-function.ts:5042`,
`:5944`, which is where `Mod(x, 0)` and `Fract(±∞)` get their `NaN`); and
the forwarding sites of the gate (`boxed-function.ts:4983`, `:5894`) and of
`library/arithmetic.ts` (`:3332`, `:3393`, `:3505`, `:9650`, `:9833`,
`:9959`, `:10042`). An operand that is a float, or a `NaN` that is not the
placeholder, gave `NaN`. The exact-lane funnel (`fromNumericValue`) was NOT
switched, see (d).

One full-suite run: **11 failing suites of 968, 46 failing tests of
42431, 19 failing snapshots of 4268** (all inline snapshots; the
`arithmetic.test.ts.snap` file did not change). The same 11 files pass on
the unmodified tree, so all 46 failures come from the probe.

| Cause | Tests | Files |
| --- | --- | --- |
| Expects the spelling `NaN` (`toString`, `.latex`, inline snapshot) | 38 | `simplify.test.ts` 19 (10 LaTeX comparisons, 9 inline snapshots), `canonical-form.test.ts` 6 (10 snapshots), `points-arithmetic.test.ts` 5, `non-finite-typing.test.ts` 2, `arithmetic.test.ts` 1, `pipeline-contracts.test.ts` 1, `error-model-statistics.test.ts` 1, `error-model-linear-algebra.test.ts` 1, `complex-division-scaling.test.ts` 1, `test/epsil/documentation.test.ts` 1 (two examples of `src/epsil/docs/reference/arithmetic.md`, lines 184 and 1055) |
| `isSame(ce.NaN)` / identity | 8 | `error-model.test.ts` 8 (its `isNaNValue` helper is `x.isSame(ce.NaN)`; `Mod(1, 0)` on three routes, `0·∞`, `Power`, `Divide`, and the elementary and rational families) |
| Type | 0 | — (the placeholder kept the `NaN` value type, so this was not measured; the `nan` type does not change in the design) |
| `isMachineNumeric` / array lane | 0 | — |
| Other | 0 | — |

Three of the failures are answers of library operators that reach a
kind-1 form through arithmetic, and so change without being named in §2:
`Variance([5])` (the sample variance of one datum, `0/0`),
`MatrixPower` cells that compute `0·∞`, and a broadcast `[0, 1]/0`.
The CHANGELOG must name them.

(b) **Funnels.** About 135 places turn any `NaN`-valued number into
`ce.NaN` or into the text `NaN`. The ones Phase 1 must change:

- Boxing: `fromNumericValue` (`box.ts:3784`); `ce.number` of a `NaN`
  (`engine-expression-entrypoints.ts:384`, `:396`); `canonicalNumber`
  (`boxed-number.ts:1734`, `:1767`, `:1780`, `:1821`, `:1825`, `:1830`,
  `:1915`); the string `"NaN"` goes to the SYMBOL `NaN`
  (`box.ts:1536`), whose library definition (`library/arithmetic.ts:7274`,
  value at `:7281`) answers `engine.NaN`, so `"Indeterminate"` needs its
  own symbol definition, not a number-string path; `boxed-symbol.ts:408`
  and `:455` (the symbol `NaN` factored and evaluated).
- `BoxedNumber`: `json` (`:365`), `operator` (`:377`, `:384`), `hash`
  (`:318`, value `${re}:${im}`), `digest` (`:326`, through `json`),
  `isSame` (`:1504`, `:1506`), `is` (through `isSame`), `N()` (`:1600`),
  the literal type (`:973`, `:1027`, `:1033`), `isMachineNumeric`
  (`:1369`); `compare.ts:314` and `:346` (`same()` and the store
  comparison); `ascii-math.ts:205` and `:981` (`toString()`).
- MathJSON: `serialize.ts:1002`, `:1141`, `:1213`, `:1286`, and the entry
  for a number literal at `serializeJsonExpression` (`:1379`).
- LaTeX: `latex-syntax/serializer.ts:153` (the `NUMBER_SPELLING_SYMBOLS`
  set) and `:535`; `serialize-number.ts:127`, `:172` (`notANumber`);
  the defaults `latex-syntax.ts:111`, `:149`; the parser `parse.ts:1049`,
  `:3773`. There is no dictionary entry for `NaN`: it is handled by the
  `notANumber` option, so `Indeterminate` needs a dictionary entry or a
  second option.
- Epsil: `serialize-epsil.ts:58`, `:233`, `:241`, and `:612`, `:616`,
  `:968`, `:987`, `:1665`; the value-spelling table `:1831`; the parser
  `parser.ts:4186`, `:5961`, `:5992`, `:8119`, `:9266`;
  `reserved-words.ts:44`, `:138`; `library-names.ts:157`;
  `highlight-js-mode.js:180`; `vscode-epsil/syntaxes/epsil.tmLanguage.json:421`.
- CLI and MCP: `src/cli/format.ts:46`, `:59`, `:80`; `src/cli/mcp.ts:665`,
  `:726`, `:874` — all go through `toMathJson`, `serializeEpsil` or
  `toString()`, so they need no code of their own.
- Types: `common/type/lexer.ts:452`, `parser.ts:2337`,
  `common/type/serialize.ts:95`, `immutable.ts:45` (one shared `NaN` value
  type), `widen-value.ts:136`, `subtype.ts:1173`, `:1920`, `:2452`,
  `utils.ts:106`; type-to-value: `multi-clause.ts:1603` (a finite domain
  of value types is boxed with `ce.number`), `library/type-handlers.ts:207`,
  `:232`, `library/arithmetic.ts:1123`.
- Numeric values: `toJSON`/`toString`/`type` of the three numeric-value
  classes (`exact-numeric-value.ts:225`, `:251`; `big-numeric-value.ts:78`,
  `:127`, `:164`; `machine-numeric-value.ts:63`, `:111`, `:134`), and about
  70 kernel lines that make a fresh `NaN` (`clone(NaN)` and the like): a
  `NumericValue` cannot carry the kind.
- Collections and order: `machine-number.ts:29` and `:89` (numeric stores;
  the design keeps the value out of them through `isMachineNumeric`);
  `order.ts:196`–`:351` (one sort rank for every `NaN`);
  `compare.ts:548`, `:2404`; `collection-utils.ts:3352`.
- Two funnels that change a decided rule, see "Contradictions" below:
  `type-guards.ts:112` (`isAbsentValue`) and `validate.ts:952`.

(c) **Gate bypass.** The gate runs only in `evaluate()`, for an operator
whose resolved per-slot policy (`resolvedNanBehaviorAt`,
`boxed-operator-definition.ts:1016`) is `propagate`, that is not `lazy`
and not a user function, and not for a broadcastable operator with a
collection operand. Of the 633 library operators: 105 propagate in every
slot and 8 in some slots (these see the gate); 175 reject in every slot;
156 are `lazy`; 189 are `inert` or `handle` in some or all slots (the
carrier admits `nan`, or the signature is inferred). The full list per
group is in the scratch report. The groups that matter:

- **Lazy:** `Add` and `Multiply` themselves, the comparisons (`Equal`,
  `Less`, `Greater` and the others), `If`, `Which`, `Sum`, `Product`,
  `Integrate`, `Map`, `Filter`, `Fold`, `Block`, `Hold`, and the symbolic
  operators (`D`, `Solve`, `Limit`, `Series`, `Simplify` and the others).
  For `Add` and `Multiply` the `NaN` handling is in the `Sum` and `Product`
  classes (`arithmetic-add.ts:1003`, `arithmetic-mul-div.ts:197`–`:201`,
  `:735`, `:816`), not in the gate.
- **Inert (handler owns `NaN`):** `Max`, `Min`, `Mean`, `Median`,
  `Variance` and the statistics reducers, `GCD`, `LCM`, `Exp`, `Exp2`,
  `Log2`, `Log10`, `Hypot`, `Square`, `Subtract`, `Remainder`, `Chop`,
  `Rational`, `Complex`, `Length`, `Sort`, `Unique`, `IndexOf`,
  `Contains`, `IsMissing`, `Range`, `Linspace` and the collection
  operators.
- **Probes (a `NaN` operand, unmodified tree):** `Map(x ↦ x + 1, [1, NaN])`
  is `[2, NaN]`; `Sin([1, NaN])` is `[sin(1), NaN]` (the cell goes
  through the gate per element); `Sum(NaN, k, 1, 3)` is `NaN`;
  `Integrate(0/0, x)` is `NaN` under `evaluate()` but stays
  `int(NaN dx)` under `.N()`, and `Integrate(NaN, x, 0, 1)` stays inert on
  both; `If(NaN > 0, 1, 2)` and `Which(NaN > 0, 1, True, 2)` are
  `Missing`; `Which(True, NaN)` is `NaN`; `Length(NaN)` and `First(NaN)`
  are `incompatible-type` errors; `First([NaN, 1])` is `NaN`;
  `Max(1, NaN)`, `Mean([1, NaN])`, `Hypot(3, NaN)`, `Exp(NaN)`,
  `GCD(NaN, 2)`, `Round(NaN)` are `NaN`;
  compiled JavaScript `sin(x) + 0/0` is `Math.sin(_.x) + NaN`, and the
  compiled `x/y` and `x^y` at `(0, 0)` both answer `NaN`.

(d) **Exact lane.** An `ExactNumericValue` becomes `NaN` (`[NaN, 1]`) in
these cases:

| Where (`exact-numeric-value.ts`) | Case | Kind |
| --- | --- | --- |
| `:464` normalization | `NaN` radical | propagates the input |
| `:474` normalization | denominator 0: `[n, 0]`, also `n ≠ 0` | `0/0` is kind 1; `n/0` is a POLE (`~oo`), not kind 1 |
| `:546` normalization | a `NaN` or non-finite imaginary part | representation limit (no `~oo` in the exact lane) |
| `:791`, `:841`, `:856` `mul` | `0·±∞`, `0·~oo` | kind 1 |
| `:847`, `:930` `mul`/`div` | a `NaN` operand | propagates the input |
| `:907` `div(0)` | `x/0` for EVERY `x` (`5.div(0)` is `NaN`) | kind 1 only for `0/0`; otherwise a pole |
| `:927` `div` | `0/0` | kind 1 |
| `:996`, `:1014` `pow` | a `NaN` exponent | propagates the input |
| `:1067` `pow` | `(−∞)^∞` | kind 1 |
| `:1073` `pow` | `(±1)^(±∞)` | kind 1 |
| `:1158` `root(0)` | the 0-th root | not kind 1 (`Root(x, 0)` is a precondition error on the boxed route) |
| `:1404`, `:1409` `ln` | `ln 0`, `ln` of a negative | a pole (`−∞`) and a real-domain failure, not kind 1 |
| `:1417` `exp`, `:1458`–`:1472` `floor`/`ceil`/`round` | a `NaN` input; a COMPLEX input | propagates; a domain failure, not kind 1 |
| `:1685` `sum` | a `NaN` summand | propagates the input |
| `numerics/rationals.ts:192`, `:208`, `:213` | `add`/`mul` with an infinite machine rational (`inv(0).mul(2)` is `NaN`, not `∞`) | representation limit, not kind 1 |
| `gaussian-integer.ts` | none | — |

Many exact-lane `NaN` values are not indeterminate forms, and some are
reachable from the public API: `ce.number([5, 0])` is `NaN` (through
`canonicalNumber`, `boxed-number.ts:1821`), where `Rational(5, 0)` and
`Divide(5, 0)` are `~oo`. **Conclusion for D5: mapping an exact-lane `NaN`
to `Indeterminate` in `fromNumericValue` is NOT safe** — it would spell a
pole (`5/0`), a real-domain failure (`ln(−2)`), and a representation limit
as an indeterminate form. D5 (a) therefore reduces to its first half: the
kind-1 sites switch one by one, as in the probe. The `Product` coefficient
cannot use the exact lane either: `0·∞` there is a `BigNumericValue`
`NaN` (the infinity is not in the exact lane), so the probe decided it from
the operands (no float factor, no `NaN` factor other than the placeholder).
Also noted: the exact lane answers `0.pow(0)` as `1`, where every boxed
route answers the indeterminate form; the fold in `canonicalPower` runs
first, so this is not reached from `0^0`.

**Contradictions with §4–§5 found in Phase 0** (each is resolved in the
amended §4, §5, §6 Phases 1–3 and §7).

1. *The gate does not see the arithmetic core.* `Add` and `Multiply` are
   `lazy`, so "the gate forwards" does not cover `Indeterminate + 1` or
   `2·Indeterminate`; the `Sum` and `Product` classes need the forwarding
   rule of their own (the probe had to add it at `arithmetic-add.ts:1003`
   and `arithmetic-mul-div.ts:197`). `Sum` also absorbs a `NaN` term by
   discarding the other terms (`:1003`), so `Indeterminate + 1.5` answered
   `Indeterminate` in the probe: the §5 rule "an inexact operand gives
   `NaN`" needs a look at every term there.
2. *`Max(1, Indeterminate)` is not decided by the gate.* `Max` and `Min`
   are `inert` (`missingBehavior: 'handle'`): they reduce through
   `isAbsentValue` (`type-guards.ts:112`), which treats EVERY `NaN` as an
   absence marker. The probe answered `NaN`. §5 says `Indeterminate`
   "(the gate)". Either `Max`/`Min` get a forwarding rule in their handler
   (`library/arithmetic.ts:9650`, `:9959`), or the table changes.
3. *D7 cannot be done in `IsMissing`/`Coalesce` alone.* `isAbsentValue` is
   the one test for the missing-value gate, chained `At`, `Min`/`Max`, the
   statistics reducers, `Coalesce` and `IsMissing`. Changing it to "`isNaN`
   and not `isIndeterminate`" changes all of them (`Mean([1,
   Indeterminate])` would no longer be the absence answer); changing only
   the two operators needs a second predicate. The note must say which.
4. *A list cell is repaired to `Missing`.* `validate.ts:952` rewrites a
   `NaN` cell of a `List` to `Missing` when the expected element type
   admits `missing`; an `Indeterminate` cell would be rewritten the same
   way, which contradicts D7.
5. *`.N()` is not always told.* Under `.N()` the `Product` is expanded by
   `expandProduct` → `asExpression()` without the `numericApproximation`
   option (`mulNEvaluated`, `arithmetic-mul-div.ts:2649`), so a producer
   cannot know it is on the `.N()` route; the probe needed a final
   `Indeterminate` → `NaN` map in `BoxedFunction.N()`. A call to
   `evaluate({numericApproximation: true})` does not pass through `N()`.
6. *`Mod(x, 0)` and `Fract(±∞)` share one site.* Their `NaN` is the
   generic Contract B `definedWhen` codomain marker
   (`boxed-function.ts:5042`, `:5944`), not a handler. Switching it
   switches every operator that declares `definedWhen` (today only `Mod`
   and `Fract`); `Fract(±∞)` then answers `Indeterminate` too, which the
   design did not list.
7. *`~oo ± ~oo` is not a producer* (it is `~oo`), see §2.
8. *Special functions at an infinite point* (`library/arithmetic.ts`
   `:1752`–`:1995`, `:2135`, `:4000`, `:4259`: `Gamma`, `Zeta`, the Airy
   and incomplete-gamma families at `−∞` or `~oo`, "the limit does not
   exist") are exact questions with no value, as `(−1)^∞` is. D5 (a) names
   only arithmetic; these stay `NaN` unless D5 is widened.

**Defects found on the way (unmodified tree, not caused by the design).**
`ce.number([5, 0])` is `NaN` where `Rational(5, 0)` is `~oo`
(`boxed-number.ts:1821`); `ExactNumericValue` answers `n/0` as `NaN` for
every `n` (`:907`) and `∞·2` as `NaN` (`rationals.ts:208`), unreachable
from the boxed routes found so far; `Integrate(0/0, x)` is `NaN` under
`evaluate()` but inert under `.N()`, and `Integrate(NaN, x, 0, 1)` stays
inert (ERROR-MODEL §1 forbids an inert terminal answer). All recorded in
`ROADMAP.md`.

**Phase 1 — the value, no producer switched.** `ce.Indeterminate`; the
literal with `isIndeterminate`, `isNaN` true, `isExact` false, the value
type `Indeterminate`; MathJSON, LaTeX (dictionary entry) and Epsil spelling
and parsing (reserved word, parser, library names, highlighter); `isSame`,
hash, `.is()`, `Equal`, ordering; `.N()` and the inexact-contact rule, with
the final `Indeterminate` → `NaN` map at `BoxedFunction.N()`,
`BoxedNumber.N()` and `evaluate({numericApproximation: true})`; the gate
forwarding (`boxed-function.ts:4983`, `:5894`); the forwarding rule in the
fold classes `Sum` (`arithmetic-add.ts:1003`, with the inexact-term check
before the `NaN` short-circuit) and `Product` (`arithmetic-mul-div.ts:197`,
`:735`, `:816`); the reducer rule of `Max`/`Min`
(`library/arithmetic.ts:9530`, `:9650`, `:9959`), the statistics reducers
and the quantile family; D7 through the shared test `isAbsentValue`
(`type-guards.ts:112`), with one pinned test per user: `IsMissing`,
`Coalesce`, `Max`/`Min`, the statistics data readers
(`statistics.ts:1796`, `:1810`, `:1879`, `:2263`, `:2402`), the empirical
quantile (`distributions.ts:1366`), `PointList`, `Field` and chained `At`
(`collections.ts:5130`, `:8866`, `:9485`, `:9504`); the list-cell repair
of `validate.ts:952` excluding `Indeterminate`; the funnels of Phase 0 (b)
(the symbol `Indeterminate` gets its own library definition, since the
string `"NaN"` boxes to a symbol whose value collapses to `ce.NaN`; LaTeX
needs a dictionary entry because `NaN` goes through the `notANumber`
option); the compiled constant and the
symbol tables; the CLI, MCP and VS Code formatters; tests for every row of
§5 with `Indeterminate` given as INPUT. No computed answer changes yet, but
the name `Indeterminate` becomes reserved (a user symbol of that name
changes meaning): a Behavior Changes bullet.

**Phase 2 — switch the exact producers.** The sites of D5 (a) return
`ce.Indeterminate` instead of `ce.NaN`, each listed here as it is switched:
the arithmetic forms (the sites the Phase 0 probe switched, §6 Phase 0 (a),
the canonical-time folds in `box.ts:524`, `canonicalDivide` and
`canonicalPower` included); `(−1)^±∞` (`arithmetic-power.ts:630`, `:673`);
an exact unit-modulus base to an infinite power (`:130`);
`∞^(imaginary)` (`:747`); `0^(imaginary)` (`:527`); `Mod(x, 0)` and
`Fract(±∞)` through the Contract B `definedWhen` marker
(`boxed-function.ts:5042`, `:5944`); and the special functions at an
infinite point where the limit does not exist (`library/arithmetic.ts`
`:1752`–`:1995`, `:2135`, `:4000`, `:4259`, each checked site by site). A
`NaN` that means "outside the domain" or a kernel failure stays `NaN`. The
exact-lane funnel (`fromNumericValue`, `box.ts:3784`) is NOT switched: Phase
0 (d) showed that exact-lane `NaN` values include poles, real-domain
failures and representation limits. Each site is a one-line change plus a
test. CHANGELOG under Behavior Changes, naming the inputs whose printed
answer changes (`0/0` was `NaN`, is `Indeterminate`), the three library
answers found in Phase 0 (`Variance([5])`, `MatrixPower` cells that
compute `0·∞`, the broadcast `[0, 1]/0`), and the operators of Phase 0 (c)
that answer `NaN` for an `Indeterminate` operand. Snapshots updated with
the Phase 0 count stated (46 tests, 19 inline snapshots, 11 files, before
the widening of D5).

**Phase 2 results (done 2026-09-29).** One helper decides every switched
site: `indeterminateFormAnswer(ce, operands)` (`type-guards.ts`) answers
`Indeterminate`, or `NaN` when an operand of the form is a float, the `NaN`
literal, an absent symbol or a symbol whose value is `NaN` (D3). Line
numbers are those of the Phase 2 tree; all paths are under
`src/compute-engine/`.

- Canonicalization and division: the integer `0/0` fold in boxing
  (`boxed-expression/box.ts:529`; `asBigint` reads the float `0.0` as the
  integer 0, so the operands are boxed and tested); `canonicalDivide` `0/0`
  (`arithmetic-mul-div.ts:1301`), `∞/∞` (`:1320`) and the integer-literal
  `0/0` (`:1458`); `div()` `0/0` (`:1640`, `:1680`).
- Products: the `Product` fold marks its own indeterminate forms
  (`_indeterminateForm`, set at `arithmetic-mul-div.ts:308` `~oo·0` and
  `±∞·0`, `:314` `0^0` as a factor, `:335` `0·±∞`) and answers them in
  `_nanAnswer()` (`:846`) and `_formAnswer()` (`:858`); the canonical
  `0·∞` fold (`:1940`); `BoxedNumber.mul` guards (`boxed-number.ts:667`,
  `:675`, `:699`, `:701`, `:711`).
- Sums: `∞ − ∞` in the `Terms` fold (`arithmetic-add.ts:1032`) and in
  `BoxedNumber.add` (`boxed-number.ts:584`, review round), which the
  broadcast and matrix kernels use for their cells (`[∞, 1] + [−∞, 2]` is
  `[Indeterminate, 3]`); `Mean` of data holding `+∞` and `−∞`
  (`library/statistics.ts:679`, review round).
- Powers (`arithmetic-power.ts`): an exact unit-modulus base to `±∞`
  (`:139`); `0^(imaginary)` (`:543`); `0^0` (`:545`); `∞^0` (`:594`);
  `1^±∞` (`:609`); `(−1)^∞` (`:659`) and `(−1)^−∞` (`:704`);
  `∞^(imaginary)` (`:779`); `Root(0, ∞)` and `Root(∞, ∞)` (`:1886`).
- The Contract B `definedWhen` marker, so `Mod(x, 0)` and `Fract(±∞)`
  (`boxed-function.ts:5064`, `:5976`).
- `Log(1, 1)` (`0/0`) and `Log(∞, ∞)` (`∞/∞`) in
  `logarithmAtExceptionalPoint` (`boxed-expression/logarithm.ts:173`,
  `:179`).
- Special functions at an infinite point with no limit
  (`library/arithmetic.ts`): the Γ family at `−∞` and `~oo` (`:1756`); the
  polygammas (`:1798`) and Bessel at `~oo` (`:1850`), both reading the
  ORDER as an expression too, so that a float order (`BesselJ(0.0, ~oo)`)
  gives `NaN` (review round); Airy `Ai′`/`Bi′` at `−∞` and every Airy head
  at `~oo` (`:1927`, `:1928`); `Beta` (`:1987`, `:1992`: two infinite
  operands are `0` for `B(+∞, +∞)`, verified with mpmath
  `beta(1e6, 1e6) = 3.6e-602063` and `beta(1e3, 1e9) = 4.0e-6436`, and
  `Indeterminate` for every other pair, review round; one infinite operand
  at `−∞`/`~oo` is `Indeterminate`); the upper incomplete gamma with two
  infinite operands, an infinite `s` at `z = +∞`, `z = ~oo`, and `s = ~oo`
  (`:2028`, `:2030`, `:2035`, `:2038`); Hurwitz `Zeta(s, a)` at
  `s = −∞`/`~oo` (`:2178`); `Zeta` at `−∞`/`~oo` (`:4047`); `Remainder(x,
  0)`, as `Mod(x, 0)` (`:6695`, in the handler, review round). Found beyond the Phase 0 list, with the
  same meaning: `Binomial` and `Pochhammer` at the points their comments
  call "no limit" (`library/combinatorics.ts:202`, `:212`, `:220`, `:223`,
  `:479`, `:487`, `:496`, `:499`); `GammaRegularized` (`Q(−∞, z)`, `~oo`,
  two infinities; `library/distributions.ts:319`, `:340`, `:342`);
  `ErfInv` at every infinity (`library/statistics.ts:538`);
  `SinIntegral`, `CosIntegral`, `SinhIntegral`, `CoshIntegral` at `~oo`
  (`library/trigonometry.ts:1255`, `:1323`, `:1384`, `:1452`);
  `ExpIntegralEi` and `LogIntegral` at `~oo`
  (`library/special-functions.ts:797`, `:870`); `Real`, `Imaginary` and
  `Argument` of `~oo` (`library/complex.ts:515`, `:569`, `:670`; so the
  `AbsArg(~oo)` pair is `(+∞, Indeterminate)`).

Kept `NaN`, each for a stated reason: an anonymous infinity such as
`∞ + i` (a float literal; the helper answers `NaN` for it by itself);
`Γ(s, −∞)`, `B(+∞, b)` for a `b` with a non-positive real part, and
`Q(a, −∞)` for a non-integer `a` (the recorded rulings answer `NaN`
because the divergence has a sign or a complex direction that depends on
the other operand, not because the form has no value — switching them
would state a false "no value"; the correct answers would be signed or
complex infinities, a decision for the user); `AGM` with two infinite
operands (not documented as "no limit"); `Root(x, 0)` and `root(0)` (a
precondition error on the boxed route); the numeric-only cases of the
Hurwitz and Lerch zeta at `Re(s) = 0` (they run under `.N()` only); the
exact-lane funnel (`ce.number([5, 0])` and `ce.number([0, 0])` are still
`NaN`).

Three changes were needed beyond the one-line switches. (1) `.N()` of a
broadcast or a matrix kernel kept an `Indeterminate` cell (`[0, 1]·∞`,
`MatrixPower([[∞, 0], [0, 1]], 2)`): the kernels compute the cells with
`.mul()`, which does not know the route is numeric. The final map
`indeterminateAsNaN()` (`boxed-function.ts:9405`) now reaches the cells of a
`List` or `Tuple` result at any depth. (2) The pairwise fold of
`expandProducts` turns `0 · 2.5` into the exact `0`, so `0 · 2.5 · ∞` was
`Indeterminate`; `mulImpl` reads the operands again when the product is
`Indeterminate` (`arithmetic-mul-div.ts:2370`) and answers `NaN` for a
float operand. (3) Two defects met in the code switched: `div()` answered
`NaN` for `0/∞` and `0/~oo` where `Divide(0, ∞)` is `0` (it is not an
indeterminate form; now `0`), and a float base `1.0` to `±∞` answered `0`
(the `−1 < a < 1` arm) where `1^∞` has no value (now `NaN`, the float
twin of `Indeterminate`). In the review round, the `a/∞ = 0` folds keep a float: a float
numerator over an infinity is the float `0` (`Divide(2.5, ∞)` and
`Divide(0.0, ∞)` are `0.0`; `arithmetic-mul-div.ts:1327`, `:1683`).

A known limit of the float rule: it reads the operands of a form as they
are when the form is built. A float first absorbed by an infinity is gone
by then, so `Fract(∞ + 0.5)` and `0·(∞ + 0.5)` are `Indeterminate` although
a float was written (`∞ + 0.5` is the exact `∞`). Both answers are pinned in
`indeterminate.test.ts` and recorded in ROADMAP. `Quotient(5, 0)` stays
inert because `Quotient` is not a library operator (it is an undefined
function head), so there is no answer to switch.

Expectations changed (tests edited by hand; no `-u`): `simplify.test.ts`
20 tests (11 comparisons, 9 inline snapshots), `canonical-form.test.ts` 6
tests (10 inline snapshots), `error-model.test.ts` 10 tests (a helper
`isIndeterminateValue` and a route-aware `both` check: `Indeterminate` under
`evaluate()`, `NaN` under `.N()`), `points-arithmetic.test.ts` 5,
`non-finite-typing.test.ts` 4, `arithmetic.test.ts` 3,
`pipeline-contracts.test.ts` 1, `error-model-statistics.test.ts` 1,
`error-model-linear-algebra.test.ts` 1, `complex-division-scaling.test.ts`
1, the Epsil documentation test 1 (`src/epsil/docs/reference/arithmetic.md`:
the introduction example, and the `NaN` entry whose example `0/0` became
`0.0/0.0`), `error-model-combinatorics.test.ts` 6 (`Binomial`,
`Pochhammer` and `GammaRegularized` at their points with no limit, with a
route-aware check), and the 8 Phase 1 pins of `indeterminate.test.ts` that
asserted "no producer is switched" (replaced by the Phase 2 `describe`
blocks). In all: 67 tests in 13 files, 19 inline snapshots. Every changed expectation
is an exact form with no value; none was a float, absence or domain case.
The review round changed no existing expectation (only new tests). Full suite after the review round: 959 suites passed (10 skipped), 41669 tests passed (904 skipped, 1 todo), 4268 snapshots passed, exit 0.

**Phase 3 — documents and consumers.** ERROR-MODEL §1 (the `IsMissing`
information loss now applies to `NaN` only), §3 (the absence test
`isAbsentValue` no longer covers `Indeterminate`, and the forwarding rules
of the fold classes and reducers) and §5 (two members of
`nan`); the numeric-evaluation guide's exact/inexact section; the Epsil
reference; a Tycho notice (Tycho reads `isNaN` and the compiled `NaN`, so
nothing breaks, but a displayed `Indeterminate` symbol is new to their
formatter). Reply on #355.

## 7. Decisions for the user

- **D1 — one value or two.** (a) Two values, `Indeterminate` exact-route and
  `NaN` inexact, as proposed (**recommended**: it extends the engine's own
  exact/inexact split, and the type, the policies and the compiled output
  are untouched). (b) One value renamed `Indeterminate` everywhere,
  Mathematica-faithful: every `NaN` in every output changes spelling, the
  JavaScript-facing `{num: "NaN"}` convenience goes, and the absent-value
  rules of 2026-09-26 are re-spelled; a larger blast radius for no gain in
  meaning. (c) Alias only: accept `Indeterminate` as an input spelling of
  `NaN`; cheapest, but it does not answer the exactness argument. Saying no
  to all three keeps today's behavior and closes #355 as "by design".
- **D2 — representation.** (a) A second `NaN`-valued number literal with an
  `isIndeterminate` mark, `isExact` false (**recommended**: every
  exactness-keyed branch, kernel bridge and compiler path behaves as for
  `NaN`; only the gate, the identity functions and the funnels of Phase 0
  (b) change). (b) The same literal with `isExact` true: reverses the
  documented decision in `boxed-number.ts` and sends the value into the
  "exact argument stays symbolic" branches (`sin(0/0)` would stay inert
  wherever the gate does not run). (c) A symbol constant whose value is
  `NaN`: it collapses to `NaN` on the first evaluation and cannot carry the
  distinction.
- **D3 — contact with an inexact operand.** (a) `NaN` (**recommended**: the
  2026-09-27 float rule, and consistent with `.N()`). (b) `Indeterminate`
  (Mathematica's answer, which has no `NaN` to fall to): it would make an
  exact-route marker survive a float computation, the reverse of every other
  rule.
- **D4 — spelling.** (a) `"Indeterminate"` / `\operatorname{Indeterminate}`
  / `Indeterminate`, both spellings parsed (**recommended**). (b) A shorter
  LaTeX such as `\mathrm{Indet}`: nothing renders it better.
- **D5 — which producers switch.** (a) Every exact-route answer that is
  `NaN` today BECAUSE THE FORM HAS NO VALUE: the arithmetic forms of §2
  kind 1, `(−1)^±∞`, `∞^(imaginary)`, `0^(imaginary)`, `Fract(±∞)`, and the
  special functions at an infinite point where the limit does not exist,
  at canonicalization and at evaluation (**recommended**; chosen). A `NaN`
  that means "outside the domain" or a kernel failure stays `NaN`. The
  exact-lane funnel is NOT switched: Phase 0 (d) found poles
  (`ce.number([5, 0])`), real-domain failures (`ln(−2)`) and
  representation limits among the exact-lane `NaN` values. As decided on
  2026-09-28 before Phase 0, (a) named only the arithmetic forms plus the
  funnel; the widening to the other forms with no value and the removal of
  the funnel follow from the Phase 0 findings, and the user confirmed the
  widened (a) on 2026-09-29. (b) Also the absent-value minting
  sites: rejected here, because a missing value is not an indeterminate form,
  and the 2026-09-26 rules were decided with `NaN` as their marker.
- **D6 — where the gate does not run.** (a) Those handlers answer `NaN`
  (**recommended**: it is the kernel route, and the operators are named in
  the CHANGELOG). (b) Audit every handler to forward `Indeterminate`: open
  ended, and it would make a kernel's `NaN` and a forwarded value
  indistinguishable in the handler. Phase 0 found two groups that (a) must
  not cover, because the arithmetic core and the ordering answers depend on
  them: the fold classes `Sum`/`Product` (`Add` and `Multiply` are lazy)
  and the reducers (`Max`, `Min`, the statistics reducers, the quantile
  family). They get the forwarding rule of §4; every other handler outside
  the gate answers `NaN`.
- **D7 — absence discharge.** (a) `IsMissing(Indeterminate)` is `False`,
  `Coalesce` keeps it (**recommended**: an indeterminate form is a value, and
  this removes a recorded information loss for the exact case). (b) Treat it
  as absent, like `NaN`: keeps the operators one-rule, keeps the loss. The
  user chose (a). Phase 0 showed that `IsMissing` and `Coalesce` share the
  test `isAbsentValue` with `Max`/`Min`, the statistics reducers, the
  quantile family, `PointList`, `Field` and chained `At`; (a) is applied to
  that shared test, so none of them reads `Indeterminate` as absent (for
  example `Mean([1, Indeterminate])` is `Indeterminate`, not the absence
  answer). This is a consequence of the decision the user accepted, not a
  new decision.

## 8. Tests

- One test file, `test/compute-engine/indeterminate.test.ts`, with one
  `describe` per row of §5, on the box, parse and Epsil routes (a lazy
  operator that holds its operands must see both spellings; see the
  route-parity block in `test/compute-engine/find-fit.test.ts`).
- The inputs of §1 pinned on `.json` (canonical form), `form: 'raw'`,
  `evaluate()` and `.N()`; the float inputs written `{num: "0.0"}` or in
  LaTeX.
- `Sin`, `Ln`, `Gamma`, `Arctan`, `Floor`, `Erf` of `Indeterminate` under
  `evaluate()`: `Indeterminate` through the gate, never an inert
  `Sin(Indeterminate)`.
- The gate with mixed operands: `Arctan2(Indeterminate, NaN)` is `NaN`.
- The fold classes: `Indeterminate + 1` and `2·Indeterminate` are
  `Indeterminate`; `Indeterminate + 1.5`, `1.5 + Indeterminate` and
  `Indeterminate·NaN` are `NaN`.
- The reducers: `Max(1, Indeterminate)`, `Min(Indeterminate, 2)` and
  `Mean([1, Indeterminate])` are `Indeterminate`; `Max(Indeterminate, NaN)`
  and `Max(NaN, Indeterminate)` are `NaN`.
- `.N()` and `evaluate({numericApproximation: true})` of `0·∞`, `0/0` and
  `Mod(5, 0)` are `NaN` on every route.
- `Fract(±∞)`, `(−1)^∞`, `∞^i`, `0^i` evaluate to `Indeterminate`;
  `ce.number([5, 0])`, `Ln(−2)` stay as they are (not switched).
- The list-cell repair keeps an `Indeterminate` cell where it rewrites a
  `NaN` cell to `Missing`.
- `isSame`, `.is()`, `isEqual`, `Equal`, hash, `Unique`, `Tally`, `Element`,
  `IndexOf`, `Sort` with both values present.
- `IsMissing`, `Coalesce` and every absence-discharge operator with
  `Indeterminate` (D7), and the absence rules re-pinned: `Missing + 2`,
  `Length(Missing)`, the `Map` error cell still give `NaN`.
- `isMachineNumeric` and the array lane: `[1, Indeterminate]` keeps its cell
  through `.array`-free routes and prints `Indeterminate`; `[1, NaN]`
  unchanged.
- A compiled-route probe per target: the constant folds to `NaN`;
  `Indeterminate` as a divisor, as an exponent and inside a folded constant
  expression; raw MathJSON `"Indeterminate"` reaching the symbol tables; a
  computation that produces `0/0` at runtime gives the target's `NaN`.
- `String`, `Interpret`, the CLI formatter and the Epsil serializer with both
  values.

## 9. What this does not do

It does not change any type, any `nanBehavior` policy, any compiled output,
any absence rule (an absent operand still mints `NaN`; only the absence
TEST stops reading `Indeterminate` as absent, per D7), or the answer of any
float computation. It changes the
printed answer of exact indeterminate forms from `NaN` to `Indeterminate`,
gives that value its own identity, and lets the absence-discharge operators
tell it from a missing entry. It adds no Wolfram serializer: on the
reporter's side both values map to Wolfram's single `Indeterminate`.

## Related documents

- `docs/ERROR-MODEL.md` §1 (channels and the `IsMissing` loss), §3
  (propagation), §5 (the `nan` refinement).
- `docs/plans/2026-09-26-absent-values-in-collection-operators.md` (the
  absence markers, which keep `NaN`).
- `docs/plans/2026-09-27-big-decimal-imaginary-part.md` (the phase and
  review discipline this plan follows).
- GitHub issue cortex-js/compute-engine#355.
