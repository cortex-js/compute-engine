# Structured route: the `bigint` compile mode

**Status: design, not approved.** It extends the structured route
(`profile: 'numeric-kernel'`) to `mode: 'bigint'`, which
`profileOptionDecline()` (`javascript-fragment-target.ts`) refuses today.
Facts were read and probed in the main tree at
`6ebc2b1574cd75487533e999288fe7339ea71228`, with uncommitted edits of other
sessions in the structured lowering.

**Contract** (user decision): for each admitted program the value equals the
interpreter's within the caveats, and a `bigint` or `boolean` result equals
that of the existing compiler in the mode with `cse: false, constantFold:
false`; a `number` result (`NaN`, `Infinity`) need not be equal (AGENTS.md;
`2026-10-31-ce715-bigint-compile-mode.md` §3.4). Anything else declines.

## 1. The existing mode

**Admission.** `requireBigintLane()` (`compile-bigint-lane.ts`) puts every
numeric node on the integer lane (refined type a subtype of
`integer | nan | infinity | signed_infinity`, head on the list of §3.1.1 of
the spec) or declines with `bigint-lane`. It writes one `BigintLaneRecord`
per node: value kind (`bigint`, `bigint-list`, `boolean`,
`rational-constant`, `parent-lowered`, `function`), refined type, lowering
(`bigint`, `number-wrapped`, `index-conversion`, `folded`, `input`), the
shape under an integer-forcing parent (`rational-product`, `quotient`,
`power`, `sqrt`), the constant of a comparison, the user call, the pole of a
folded constant.

**Inputs**: bindings of a subtype of `integer`, and `list<integer>`. A scalar
is read once into a local, a `number` converted:
`const _tv1 = typeof _.n === 'number' ? _SYS.toBigint(_.n) : _.n;`. List cells
are converted only by the entry check (`entryWrapper()` in
`compile-bigint-emit.ts`; `javascript-runtime.ts`).

**Emission** (`emitBigintLane()`, `compile-bigint-emit.ts`; helpers in
`bigint-runtime.ts`). From probes, `n`, `m` integer, `k0` `integer<0..>`,
`L` `list<integer>`, `cse: false, constantFold: false`:

| Program | Code inside the wrapper |
| --- | --- |
| `n + 2m − 3` | `((2n * _tv1) + _tv2 + (-3n))` |
| `2^70 + n` | `(_tv1 + 1180591620717411303424n)`: folded exactly, also with `constantFold: false` |
| `n^3`, `n^k0`, `(−1)^n` | `_SYS.bpow(_tv1, 3n)`, `_SYS.bpow(_tv1, _tv2)`, `_SYS.bnegOnePow(_tv1)` |
| `Mod`, `Remainder`, `GCD` | `_SYS.bfloorMod(…)`, `_SYS.bremainder(…)`, `_SYS.bgcd(…)` |
| `Floor(n/m)`, `Floor(n/3)`, `Floor(√n)` | `_SYS.bfloorDiv(_tv1, _tv2)`, `_SYS.bfloorDiv(1n * _tv1, 3n)`, `_SYS.bisqrt(_tv1)` |
| `Typed(n/2, integer)` | `_SYS.bexactDiv(1n * _tv1, 2n)` |
| `n < 7/2` | `(2n * _tv1 < 7n)` |
| `If(n < 0, 0, n!)` | `((_tv1 < 0n) ? 0n : _SYS.bfactorial(_tv1))` |
| `Sum(k!, k = 0..n)` | `(() => { let _tv1 = 0n; { const _tv4 = _tv2; for (let _tv3 = 0n; _tv3 <= _tv4; _tv3++) { _tv1 += _SYS.bfactorial(_tv3); } } return _tv1; })()` |
| `At(L, n)` | `_SYS.bat(_.L, _tv1)` |

With the default options the code was the same for every probe.

**The catch.** When an input is lifted or a helper is called, the code is
`(() => { <lifts> try { return <code>; } catch (e) { if (e instanceof
_SYS.NonFiniteValue) return e.value; throw e; } })()`. A helper at a pole
throws `NonFiniteValue` with `Infinity` (`bfactorial(-1n)`, a zero divisor
with a non-zero dividend) or `NaN` (`bfloorMod(a, 0n)`, `bisqrt` of a
negative, `bat` out of range); a folded pole is
`(() => { throw new _SYS.NonFiniteValue(Infinity); })()`. User functions are
local arrows with no catch. A `RangeError` reaches the caller for a checked
exact division with a remainder and past the size limit of 10^6 digits
(`bpow`, `bfactorial`, `bbinomial`, `bfibonacci`).

**The result** is a `bigint`, a `boolean`, an array of `bigint`, or a
`number` after a pole. Probed against `evaluate()` with `n` in {5, −7, 7, −1,
2^53 + 1, 2^64 + 7} and `m` in {3, −3, 0, 10, 2^60 + 3}: every `bigint` and
`boolean` was equal (`n^3` at 2^64 + 7 has 58 digits); `Mod(−7, 3)` is `2n`,
`Mod(7, −3)` is `-2n`, `Remainder(−7, 3)` is `-1n`, `Floor(−7/3)` is `-3n`;
`Sum(k!, k = −1..5)` is `Infinity`; `Floor(√−7)` is `NaN` (interpreter:
`floor(sqrt(-7))`).

**Declines**: a real or untyped binding (`n + x`; `Function(k!, k)` with `k`
untyped); a non-integer node outside an integer-forcing parent (`n/2`, `√n`,
`2^n`, `n + 1/2`); a head off the list (`DigitSum`, `String`, `Ln`, `Loop`,
`ParallelLoop`); a constant left symbolic by `evaluate()`
(`Fibonacci(10^9)`); `operators`, `functions`, a `vars` entry; `Piecewise`,
an `If` with no else, a multi-statement `Block`. Batch routes refuse the
mode (`bigintBroadcastError()`). No loop of the mode checks an iteration
budget.

## 2. The witnesses

A Jest setup file wrapped `JavaScriptTarget.prototype.compile` and logged
each compilation in the mode, over the 18 test files that name it (`-w 4`,
all passed): 503 compilations, 471 compiled (157 distinct programs), 32
declined. All are tests of the mode itself (`compile-bigint-emission` 344,
`-boundary` 54, `-spec-cases` 52, `-mode` 9, `-lane` 8, four files 1 each).
No engine source compiles in the mode: `implicitCompile()` uses `'strict'`
unless the caller names a mode (`implicit-compile.ts`), and the `Map` exact
tier (`map-exact`) proves integer closure within ±2^53 and compiles in that
default (`library/map-auto-compile.ts`), so it is no witness here. The 469 of
the shadow measure (whole suite, an earlier commit) is the same population,
not reconciled program by program. Inputs read: `integer` 586,
`list<integer>` 40, `integer<0..>` 22.

| Class (by the last slice of §6 it needs) | Programs |
| --- | --- |
| Scalar: arithmetic, comparisons, `If`/`Which`, logic, `Boole`, `IsPrime`, helpers (`Factorial` 65, `Binomial` 26, `Mod` 23, `Fibonacci` 16, `GCD`, `LCM`, `Min`, `Max`, `Abs`, `Sign`, `Factorial2`), folded constants | 236 |
| Integer-forcing parent (`Floor` 48, `Ceil` 29, `Round` 21, `Truncate` 18, `Typed` 15) or a rational constant in a comparison | 130 |
| `Sum`, `Product` (6 with a pole in the body) | 21 |
| User function (`quo` 7, `f` 5, `half` 3, `inc` 3, `h` 1, recursive `fact` 1) | 19 |
| Lists: reads (`At`, `First`, `Last`, `Length`, `Count`, `Take`, `Drop`, `ReplaceAt`, `List`) 40; `Range`, `Map`, `Reduce` 15 | 55 |
| `Function` literal at the root, scalar | 10 |

## 3. The design in terms of the representation

**A second policy of the JavaScript target over the same core**
(`RepresentationPolicy`, `structured-verify.ts`), named `JS-bigint`:

- `integer` is `bigint`, `boolean` is `boolean`, `list<integer>` is
  `bigint-array`; `real`, `complex` and other lists have no representation,
  so the verifier's check "each value has the representation that the policy
  gives to its type" refuses any `real` value: the exactness rule, enforced.
- No conversion inside a program. The lift of a `number` input is a boundary
  rule of the input (as `IRInput.lifted` for a complex input); the index
  conversion of `At`, `Take`, `Drop` is inside the operation.
- Only the operations below, on `bigint` operands.

**In the core, with no target** (`structured-ir.ts`): an integer operation
denotes the exact integer of its operands; when none exists (`factorial(-1)`,
a zero divisor, `isqrt` of a negative, an index out of range) it has **no
value**. A policy's integer representation is exact (`bigint`) or bounded
(`number`: exact within ±(2^53 − 1), no-value held as `NaN`/`±∞`, the double
mode). A policy with an exact integer representation has no inexact one, so
no operation that can give a non-integer can appear. A target with no big
integers (GLSL, WGSL) has no such policy and keeps `unsupported-mode`;
Python's exact integers could offer one later.

**Exact operations** (+ is new): `add`, `negate`, `multiply`, `min`, `max`,
comparisons, `mod` (floored, already so defined), `abs`, `sign`, `at`,
`length`, `replace-at`, `build`; + `remainder` (nearest quotient, a tie
toward +∞, as the interpreter), + `quotient(a, b; rounding)` with `floor`,
`ceil`, `round-ties-away`, `truncate` or `exact`, + `isqrt(t; rounding)`, +
`rounded-pow(a, e; rounding)` for a negative `e`, + `int-pow` (`e ≥ 0`), +
`neg-one-pow`, + `gcd`, `lcm`, `factorial`, `factorial2`, `binomial`,
`fibonacci`, `is-prime`, `take`, `drop`. `n < p/q` is `multiply` and a
comparison of literals (`q·n < p`): no rational value exists. The lane
analysis declines what has no exact form before lowering: `Divide` or a
negative-exponent `Power` outside an integer-forcing parent, `Sqrt` outside a
rounding parent, transcendentals, real constants.

**The pole is an abort.** The core has aborts: a `loop` with an iteration
budget, `IRRegion.canAbort`, `operationCanAbort()`, and the rule that a
transformation must not delete an operation that can abort, run it when the
program would not, or run it more often. The design gives an abort a kind:
`no-value` (the call returns the `number` of the pole) or `error` (the call
throws: budget, size limit, an `exact` quotient with a remainder,
`replace-at` out of range). The policy states per operation the kinds it can
raise on `bigint` (`factorial`: both; `add`: none); on `number` the same
operation raises none, the pole being a value. The program records
`noValueResult: 'number'`: its result type is `bigint | boolean |
bigint-array | number`, and the emitter writes one catch at the entry. This
is §3.4 with no new analysis: an abort ends the computation, so no operation
receives a non-finite value.

## 4. What each reader needs

- **Admission**: `compileInProfile()` accepts the mode and runs
  `requireBigintLane()` in place of the admission of `fragment.ts`; a record
  gives type and representation, `parentLowered` the rounding, `comparison`
  the constant, `userCall` the helper. A `bigint-lane` decline becomes an
  `outside-profile` decline.
- **Lowering**: the rules of the policy in `javascript-structured-lower.ts`.
  `IRLiteral.value` gains `bigint` (the compiler's exact integer, not a
  target value). `Sum`/`Product` are one `loop` from `lo` to `hi` by 1, none
  when `hi < lo`, with no budget, no unrolling and none of the safe-integer
  guards that `aggregate()` writes for `number` today. A folded record is a
  literal from `evaluate()`; a folded pole is a + `no-value` operation that
  aborts where it is evaluated. `numericPolicy` gains `'bigint'`.
- **Verifier**: representations, operands and abort kinds against the
  policy; `canAbort` of each region.
- **Emitter**: `123n`, `(-3n)`, `+ - *`, `< <= === !==`, the `_SYS.b*`
  helper the existing emitter calls for each other operation, a `bigint`
  loop counter, one lift per scalar input, the catch. The assembly of the
  JavaScript target already writes the entry checks, the stored plan
  (`bigints`, `bigintLists`, `mode`) and the batch refusal.
- **Execution analysis** (`structured-execution.ts`): each new operation is
  `pure`; an abort is not an effect; `shippable` as for the double policy
  (`load()` rebuilds the helpers, spec §3.5); a `Sum` loop carries a scalar,
  so it is not a parallel candidate.
- **Sharing** (`2026-11-11-structured-shared-subexpressions.md`): its
  condition 4 ("pure and cannot abort") excludes most helpers of the mode
  (choice C3). A rounded quotient is not a value of its own, so
  `Floor(n/2) + Ceil(n/2)` never shares it.

## 5. What stays declined

What the existing mode declines (§1), and: recursion
(`fact := x ↦ If(x ≤ 1, 1, x·fact(x − 1))`; the route refuses it in every
mode, `javascript-fragment-target.ts`), 1 witness; `Map`, `Reduce`, `Fold`
with a lambda (`Map(k ↦ k!, Range(−1, n))`) until the `program` profile has
lambdas, 9; the options `operators`, `functions`, `vars`, refused by the
profile in every mode.

## 6. Implementation order

One commit per slice, each measured with the shadow measure and the
switch-on full suite. Tests are differential: the route and the existing
compiler (`mode: 'bigint', cse: false, constantFold: false`) on the same
inputs; when either gives a `bigint` or `boolean` the other gives the same
(`===`, cell by cell), equal to `evaluate()`'s exact integer; a `number` is a
`number` on both; a `RangeError` on one is a `RangeError` or a `number` on
the other. Inputs include values past 2^53 and 2^64, given as `number` and as
`bigint`, negative operands of `Mod`, `Remainder` and each rounded quotient,
and zero divisors. Estimates are the witnesses of §2 that a slice admits.

1. **Policy and scalar core**: `JS-bigint`, `numericPolicy`, `bigint`
   literals, the lift, abort kinds, the catch, admission by the lane
   analysis; arithmetic, comparisons, `If`/`Which`, logic, `Boole`, `min`,
   `max`, `abs`, `sign`, `mod`, `remainder`, `int-pow`, `neg-one-pow`, the
   number-theory helpers, folded constants and poles. Tests: the rows of
   §3.1 and §3.6 of the spec; `n! + n!` and `If(n < 0, 0, n!)` at `n = −1`;
   `Fibonacci(10^9)` declines. About 236.
2. **Integer-forcing parents**: `quotient` with five roundings, `isqrt`,
   `rounded-pow`, rational constants of comparisons. Tests:
   `Floor(n/2) + Ceil(n/2)` at odd `n`; `Round(−5/2)` is `-3n`;
   `Typed(n/2, integer)` at odd `n` throws; `n ≥ (3·2^53 + 1)/2` at
   `n = 3·2^52`; `Ceil(√n)`, `Round(√n)` at 16, 17, 20, past 2^53. About 130.
3. **`Sum`, `Product`**. Tests: `Sum(k!, k = 0..n)`; a pole inside the loop
   (`Sum(k!, k = −1..n)`); `hi < lo`; nested clauses; `n = 10^6`. About 21.
4. **Helpers**: typed or specialized parameters, the `-> integer` promise.
   Tests: `half(n)` at odd `n`; `quo(m! + n!, m)` at `m = 0`; `f(n) + 1` at
   `n = −1`. About 18.
5. **Lists and the root `Function`**: `bigint-array` inputs, `at`,
   `length`, `take`, `drop`, `replace-at`, `List`, `Range` as `build`, the
   closure's catch. Tests: `At(L, 0)` and past the length (`NaN`),
   `Take(L, 0)`, `Length(L) + n`, `number` cells with the entry check on.
   About 56.

After slice 5, about 461 of the 471 are admitted; the other 10 are §5.

## 7. Open choices

- **C1. Admission.** Recommended: reuse `requireBigintLane()`; one analysis
  decides on both routes and moves to the route at retirement. Alternative:
  new rules in `fragment.ts` repeating the refined types, the list and the
  forcing parents.
- **C2. Folding.** Recommended: fold an integer-lane constant from
  `evaluate()` as the lane analysis does, also with `constantFold: false`; an
  exact fold changes no `bigint`, and without it `Fibonacci(10^9)` would be
  admitted and throw where the existing compiler declines. Alternative: no
  fold.
- **C3. Sharing an operation that can abort.** Recommended: share an
  operation whose aborts are `no-value` or `error` from its own operands
  where the first lowering dominates the reuse: the reuse aborts exactly when
  the first did. Keep the exclusion for a budget abort, whose counter depends
  on passes. Alternative: keep condition 4; shared `Binomial` and
  `Factorial` DAGs are then walked as trees (CE-1198).
- **C4. When the catch is written.** Recommended: when the program can raise
  `no-value` or lifts an input, as the existing emitter does. Alternative:
  only for `no-value`; the code differs, no value does.
- **C5. A policy, or an `exact` attribute on integer values** of the double
  policy. Recommended: a policy. The attribute lets a program mix the two
  representations, which the mode forbids (spec §3.3), and every rule would
  test it.

## Not determined

- Whether a `bigint` crosses a worker boundary of the pool on every host:
  not probed; the batch routes refuse the mode, so no consumer does it.
- The 17 programs the shadow measure counts as admitted by the profile and
  declined by the existing compiler were not examined for this mode.
