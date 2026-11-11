# Structured route: random draws and effects that name their state

**Status: design, not approved. A change of the `numeric-kernel` profile of
the [JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md)
(objective 3, "Effects name what they touch"; row Effects of "Decisions to
preserve"). The choices marked "choice" can be reversed.**

The shadow measure of the whole suite counts 572 declines "unsupported head
Random", 64 "unsupported head WithRandomSeed" and 41 "the helper … is not
pure: its signature has effects". Today every operation that the route
admits is `pure`, except the test operation `trace`.

## 1. What the existing compiler writes, and the witnesses

Probes: the scratchpad of this session, `design-random/forms.ts`,
`order.ts`, `parity.ts`, `helpers.ts`, `loops.ts`, `lazy.ts`, with
`cse: false, constantFold: false`, on
`29ee7c0f7aa216b3c5bf05b125393ef6b4a5828c` with uncommitted edits of another
session in the tree (`javascript-fragment-target.ts`,
`javascript-structured-lower.ts`, `javascript-target.ts`).

| Program | Code of the existing compiler |
| --- | --- |
| `Random()` | `_SYS.drawNextRandomNumber()` |
| `Random(Interval(2, 5))` | `(2 + _SYS.drawNextRandomNumber() * 3)` |
| `Random(Range(1, 6))` | `(1 + 1 * Math.floor(_SYS.drawNextRandomNumber() * 6))` |
| `Random(Range(1, n))` | `_SYS.randomPick(_SYS.domainRange("Random", 1, _.n))` |
| `Random(L)`, `L: list<real>` | `_SYS.randomPick(_SYS.domainList("Random", _.L))` |
| `If(0 < x, Random(), 0)` | `((0 < _.x) ? (_SYS.drawNextRandomNumber()) : (0))` |
| `WithRandomSeed(s, Random())` | `_SYS.withRandomSeed(_.s, () => _SYS.drawNextRandomNumber())` |
| `WithRandomSeed(42, Random() + Random())` | `_rnd_1()`, a preamble memo that runs `_SYS.withRandomSeed(42, () => …)` once per compiled artifact |
| `walk(n)`, a helper with `for` and `break` | `s = s + -0.5 + _SYS.drawNextRandomNumber();` in the loop of `_fn_walk` |

Facts behind these forms (`javascript-target.ts`, handlers `Random` and
`WithRandomSeed`; `javascript-runtime.ts`, `makeRandomHelpers()`;
`docs/RANDOMNESS-MODEL.md` §2, §5, §7):

- `_SYS.drawNextRandomNumber()` reads the frame slot of the engine (or of a
  host runtime) **when the code runs**: a compiled function called inside
  an interpreted `WithRandomSeed` draws from that frame; with no frame it
  calls the `entropy` handler (`Math.random` by default,
  `effects-registry.ts`).
- `_SYS.withRandomSeed(seed, body)` installs a frame on that slot and
  restores the previous one in a `finally`; counters are per frame. A seed
  that is not a finite real or a string throws; a `{re, im}` seed with a
  zero imaginary part is read as its real part.
- Operands are evaluated in the order of the **prepared** tree:
  `Random() - 2·Random()` is `Add(Multiply(-2, Random()), Random())`.
  With `Math.random` stubbed by a counter, the interpreter and the existing
  code consume the same draws in the same order and count for the 12
  programs of `order.ts` (sums, products, `Max`, `Mod`, `Divide`, `Power`,
  `If` and `And` with draws, a seeded region next to an unseeded draw).
- Under `WithRandomSeed(42, …)` the existing code gives the interpreter's
  doubles or differs in the last place (`Random() + 10·Random()`:
  `7.817153264491864` against `…863`, `parity.ts`), within the caveat of
  the precision of the target. A compiled body called inside an
  interpreted frame draws the frame's sequence.
- `isPure` of `WithRandomSeed(42, Random())` is `true`: the operator
  discharges `random` (`library/core.ts`, `discharges: { 1: ['random'] }`).
  `isShippableCode()` (`kernel-pool.ts`) refuses code that names
  `_SYS.drawNextRandomNumber` or `_SYS.withRandomSeed`.

**Witnesses.** The 235 test files whose text names `Random`, run with
`CE_JS_PROFILE_SHADOW=1` and a setup file that wraps
`ScalarFragmentJavaScriptTarget.prototype.compileInProfile` (scratchpad
`design-random/log-setup.ts`; no source change): 742 declines whose message
names `Random`, `WithRandomSeed` or effects, 221 distinct programs (file,
program, mode). The tallies: 14,358 tests passed; one failed, the test that
asserts the default route never calls the profile, as expected.

| First decline | Programs | Forms |
| --- | --- | --- |
| `Random` | 140 | no domain 105, literal `Range` 6, literal `Interval` 2, a list 1; in an expression 115, in an `If` 11, the whole root 6, in a lambda 6, in `Sum` 1, in `Reduce` 1 |
| `WithRandomSeed` | 62 | 31 with `Random()`; the others hold `RandomChoice`, `RandomSample`, `RandomShuffle` or a `parallel for` |
| a helper with effects | 18 | of the two probed, `f7 := x ↦ x + Random()` has `(x: unknown) random -> number` and `total` (a `parallel for`, no draw) `(…) random -> number` (`sigeff.ts`); the other 16 were not probed |

An estimate (`next.ts`: each `Random()` and literal-domain `Random`
replaced by a real name, each `WithRandomSeed(s, b)` by `b`, compiled again
in a fresh engine, without the tests' declarations): 63 of 193 programs
compile, 57 unseeded and 6 seeded (`x + Random()`, `If(Random() < x, 5,
-1)`, `max(sqrt(x), Random())`, `WithRandomSeed(s, Random())`). The others
decline next on `RandomChoice` 37, `RandomShuffle` 8, `RandomSample` 8, a
comparison of three or more operands 27, a list literal 12, a tuple 8, a
complex operand of `Less` or `Max` 7.

## 2. The operations

**`draw`** (choice): no operand, a real result in `[0, 1)`. Effect fact
`effectful`, and it names its state: `touches: ['random']`, the random
stream of the runtime, which the draw reads and advances. There is one such
state, not one per generator: which generator a draw uses (the seeded frame
of a region, of a caller, or the live source) is decided when the code
runs, so the program cannot name it. The literal domains are pure
arithmetic around one `draw`, as the existing code is: `Interval(a, b)` is
`a + u·w` with the double `w = b - a` computed at compile time by the same
reader (`interval()`), `Range` is `first + step·floor(u·n)` with the
parameters of `literalRangeParams()`, an integer result. A domain that the
existing compiler refuses at compile time (`assertDrawableInterval`,
`assertDrawableRange`) declines.

**`seeded`**: a region operation, the structured form of `WithRandomSeed`.
Its operand is the seed (real, or complex in the `complex` mode, passed as
the existing code passes it), or no operand and a literal seed (a number or
a string: the representation has no string values). Its body is an open
region that yields one value, the result. Semantics: the body runs once,
with a new frame of the stream seeded by the seed; the frame of the caller
is in place again after it, also when the body throws.

**Its effect, discharged** (choice): the effect of `seeded` is the effect of
its body without the state `random`. A body whose only effects are draws,
directly or through calls, makes a `pure` operation, as `isPure` says of the
expression. Draws in the seed are operations of the enclosing region and
keep their effect. A `seeded` whose seed is not a literal records that it
can abort (the throw of an invalid seed), so no pass removes or moves it.

**Not taken: the state threaded as a value** (a region parameter; a draw
takes a state and gives a value and a new state; calls, `if` and `loop`
carry it). Order would be a data dependence. But the state is not the
program's: the code must still read the shared slot (a compiled function
called inside an interpreted frame advances that frame's counter,
`docs/RANDOMNESS-MODEL.md` §7), so the value would name a global, and every
analysis and helper signature would carry a value that no target writes.

**Against the objectives.** (1) `draw` and `seeded` name no target; the
JavaScript emitter writes `_SYS.drawNextRandomNumber()` and
`_SYS.withRandomSeed(seed, () => { …; return v; })`; a target without draws
(GLSL, `docs/RANDOMNESS-MODEL.md` §8) has neither in its policy, so the
verifier refuses them there. (2) Each defines one value; no variable is
written. (3) The state is on the operation; a region summary carries the
union of the states of its operations.

**What `analyzeExecution()` answers** (`structured-execution.ts`):

| Program | `pure` (independent calls) | `shippable` | loop candidate |
| --- | --- | --- | --- |
| a draw outside every `seeded` | no: two calls give different values, and a call inside a frame moves its counter | no | no: the values of a pass depend on the passes before it |
| draws only inside `seeded` regions | yes | no (choice): the analysis reports the stream as not portable, as `isShippableCode()` does | as the rest of the body |
| a helper whose body draws, called outside a region | no | no | no |

## 3. Rules for each reader

- **Admission** (`javascript-fragment-target.ts`): `Random` with no operand
  or a literal `Interval`/`Range`; `WithRandomSeed` with a real seed or a
  literal string or number seed. The effect fact of each node keeps coming
  from `shallowApplicationEffects()`; a node whose effects name a label
  other than `random`, or are `any`, declines. A binding whose stored value
  draws (`r := Random()`, which the existing compiler draws at each read)
  keeps its decline "unsupported binding r": `isPure` of `r` is `true`, so
  admission never reads `isPure` to admit an effect.
- **Lowering**: operands in the order of the prepared tree, each draw an
  operation where its node is lowered. A rule that takes a literal first (a
  complex or rational factor) moves no draw: a literal has no operation. An
  expression statement with an effect (`Random();` before the last
  statement) declines (`crafted`). An `If` statement whose branch only
  draws is kept (`ifStatement()` drops only a pure `If` with no result).
- **Emitter** (`javascript-structured-emit.ts`): the rules that already
  hold for `trace`. An effectful operation is a `const` at its position; a
  pure value moves to its use only across pure operations (`writtenAtUse()`);
  a branch that draws is a statement. A `seeded` is the closure call, bound
  at its position also when it is pure; only its result leaves the closure.
- **Verifier** (`structured-verify.ts`): a `draw` has no operand, a real
  result, `effectful` and exactly `['random']`; every `effectful` operation
  names at least one state, a `pure` or `unknown` one none; a region's
  states are the union of its operations' states; `seeded` has the effect of
  its body without `random` (pure when nothing remains) and `canAbort` when
  its seed is not a literal; no `exit` inside a `seeded` leaves a loop
  outside it (only `if` branches separate an `exit` from its loop). The
  summary keeps `unknown` apart from the named states (the comment of
  `joinEffects()` asks for this before a pass tells them apart): a body with
  an `unknown` operation is never discharged.
- **Update in place** (`structured-in-place.ts`): a draw reads no list. The
  body of a `seeded` is a region evaluated once at its position, reached by
  `regionsOf()`; a test pins a list updated inside and read after.
- **Execution analysis**: the table above; the reason of a blocker names the
  state ("draws from the random stream of the engine").
- **Shared subexpressions** (`2026-11-11-structured-shared-subexpressions.md`,
  condition 4): a node is shared only when every operation of its lowering
  is pure and cannot abort, so a draw, and every node above it (`Sqrt(Random()
  - 0.5)`, whose own fact is pure), is lowered again at each occurrence. One
  node object reached twice gives two draws, as CE-1176 binds each reached
  occurrence and as the interpreter evaluates `Max(e, e)` twice. A `seeded`
  with a literal seed and a pure result can be shared: both occurrences give
  the same value.

## 4. Helpers

A helper is admitted when its body is, and its declared effects (the
signature) are none or `random`. The effect of a call is the join of the
summary of the body and the declared states: a declared `random` on a body
that does not draw keeps the call ordered, and changes no value. The effect
comes from the body also when the signature states none (`g` declared
`(real) -> real` with the body `u + Random()` has no effects in its
signature, `helpers.ts`). Declined: any other label, an unknown effect, and
a body that declines on its own (a `parallel for`, whose signature has
`random`).

## 5. What stays declined

| Form | Reason |
| --- | --- |
| a draw in the body of a `build` (`[random() for k in 1..n]`) | the interpreter's comprehension is a lazy view that draws when it is read (`docs/RANDOMNESS-MODEL.md` §6): `WithRandomSeed(7, {L = [Random() for k in 1..3]; r = Random(); 1000r + L[1]})` gives `85.026…`, `r` drawn first (`lazy.ts`); an eager list draws `L` first |
| `Random(Range(1, n))`, `Random(L)`, `Random(Interval(lo, hi))` with symbols | a run-time domain and its checks (`_SYS.domain*`); slice 4, if the measure asks for it |
| `RandomChoice`, `RandomSample`, `RandomShuffle` | list results of a length known at run time: the `program` profile |
| a lambda that draws (`Map`, `Apply`, `Reduce`) | lambdas: the `program` profile |
| `Break` inside `WithRandomSeed`, a write in it to a local declared outside | `crafted`; the region yields one value |
| a seed that is a string expression, not a literal | no string values in the representation |
| a binding whose value draws (`r := Random()`) | a held expression, not a number snapshot |

## 6. Slices

Each slice: route tests, the core suite, the type check; the full suite
with the switch off and on; the shadow measure again, its counts in the
plan; a Claude review with probe programs and a Codex review.

**The test method** (every slice): each program runs on both routes (a)
inside `WithRandomSeed(k, …)` compiled with it, equal doubles; (b) without
a region, called inside an interpreted frame (`withRandomSeedFrame()`),
equal doubles and equal counter of the frame after the call; (c) with
`Math.random` stubbed by a counting sequence, equal values and equal number
of calls. The interpreter's value is compared within the caveats.

1. **Named states and `draw`.** Core: `touches` on operations and regions,
   the summary that keeps `unknown`, the verifier rules, the reasons of the
   analysis. `Random()` and the literal domains at the root, in helper
   bodies, branches, `And`/`Or` and loops. Tests: pairs that differ only by
   `Random()` against a name, for order (`Random() - 2·Random()`), count
   (`Power(Random(), 2)` draws once) and conditional execution (`If`, `And`,
   a `Break` after a draw); `pure`, `shippable`, loop candidates; a refusal
   test per malformed form. The tests that pin the decline of `Random`
   change (`compile-javascript-profile.test.ts`, `OTHER_PRELUDE`'s
   `jitter`), and the decline example of `docs/COMPILATION-MODEL.md`, of the
   profile spec and of `~/dev/cortexjs.io/docs/compute-engine/13-guide-compile.md`
   takes another head; CHANGELOG.
2. **Helpers with `random`** (section 4): a declared and an inferred
   signature, the counter of a frame across two calls.
3. **`WithRandomSeed`**: `seeded`, discharge, `canAbort`, literal string
   seeds, a complex seed in the `complex` mode. Tests: nested regions
   (`WithRandomSeed(1, Random() + WithRandomSeed(2, Random()) + Random())`),
   a region in a loop body, an invalid seed that throws and leaves the
   caller's frame in place, `pure: true` for a fully seeded program, a
   constant region at each call against the existing preamble memo.
4. **Run-time domains**, only if the shadow measure after slice 3 has them
   among the frequent declines.

**Open choices** (recommended option first):

- The state on the operation, or a threaded state value (section 2).
- `seeded` discharges `random`, so a fully seeded program is `pure` (it
  agrees with `isPure` and `docs/EFFECTS-MODEL.md`); or it stays
  `effectful` (simpler; `pure` then says less than `isPure`).
- Literal domains as `draw` plus pure arithmetic (one effectful kind), or a
  `draw` with a domain attribute.
- The closure of `_SYS.withRandomSeed` (the existing helper), or an
  enter/leave pair with `try`/`finally` (no closure per pass, two new
  runtime helpers).
- A constant seeded region runs at each call (same values; the memo is an
  optimization for step 8), or the route reproduces the memo.
- A seeded region is not portable (one rule with `isShippableCode()`), or
  portable in the analysis and refused by the JavaScript assembly.

## Result

Implemented on `6ac31a524af52fecc8744852886ebaba2fac18c8`, then moved onto
`1c448807b4e9fc40fbb33c2b72babd151cb505a7`, slices 1 to 3,
with the recommended option of each open choice: the state on the
operation, a `seeded` that discharges `random`, literal domains as `draw`
and pure arithmetic, the closure of `_SYS.withRandomSeed`, a constant
region that runs at each call, and a seeded region that is not portable.
Tests: `test/compute-engine/compile-javascript-structured-random.test.ts`
(each program on both routes in an interpreted frame, with the position of
the frame after the call, with `Math.random` replaced by a counter, and
inside `WithRandomSeed`).

**Slice 1.** Admitted: `Random()`, `Random(Interval(a, b))` with number
literal endpoints and `b > a`, `Random(Range(…))` of number literals whose
first element and step are safe integers (an integer result), anywhere the
route admits a real value (branches, `And`/`Or`, `Which`, written-out terms
and loops of a `Sum`, loop bodies, locals, helper bodies). The core has
`IRState` (a label, `random` for the stream), `touches` on operations and
regions, the operations `draw` and `seeded`, and the verifier rules of
section 3. A draw is a `const` at its position on the emitter.

**Slice 2.** Admitted: helpers whose signature states `random` or no effect,
whose body draws (inferred `(t: unknown) random -> number` too), and a
helper declared `random` whose body does not draw (the call is `effectful`,
the value unchanged).

**Slice 3.** Admitted: `WithRandomSeed(seed, body)` with a scalar body and a
seed that is a number or string literal (no operation, cannot abort), a
real value, or a complex value in the `complex` mode (it can abort). A
program whose draws are all in seeded regions reports `pure: true`,
`shippable: false`.

**Where it differs from the note.**

- The order of the effect facts is `pure < effectful < unknown` (it was
  `pure < unknown < effectful`): with the named states kept apart in
  `touches`, a summary of the effect `unknown` still names its states, and
  `dischargedEffect()` never discharges it.
- A test operation names the labels of its declaration (`console`), so
  every `effectful` operation names a state. The hand-made programs of the
  emit, step 5, IR and execution tests carry `touches: ['console']`.
- The admission refuses a node whose own effects name another label than
  `random`, or are unknown, except a test head and a helper call, whose
  states come from its body (`stateFacts()`).
- `closedJumpRefusal()` and `inexactJumpConstant()` no longer refuse a
  node that is not pure: the fold evaluates only a pure node, so the
  existing compiler writes the code of `Less(Random(), 1/2)` and
  `Floor(6·Random())`.
- A literal `Interval` needs number literal endpoints (the existing reader
  `interval()` also takes a constant such as `Pi` through `N()`); a `Range`
  with a step that is not an integer declines.
- A draw in a comprehension declines unless it is inside a `seeded` region
  in the body of the comprehension: `[WithRandomSeed(k, Random()) for k in
  1..3]` is admitted, since each element has the same value whenever it is
  read. A comprehension that draws inside a seeded region still declines.
- In the analysis, a draw in the body of a seeded region that has another
  effect is not a blocker; the other effect is.
- `draw` and `seeded` are optional in a `RepresentationPolicy`: a target
  without them refuses them in the verifier.
- An `If` statement whose branch is only a draw (`If(c, Random())` as a
  statement) declines, as an expression statement that draws does (the
  profile admits no statement `Random` in a branch of an `If`); §3 said it
  was kept.
- A draw in a domain of a `Comprehension` (`Element(j, Range(1, 2 +
  Random(Range(1, 3))))`) declines, as a draw in its body does: the
  interpreter evaluates the domain when the list is read. Seeded probes of
  the other constructs that the route admits with a draw inside (the bounds
  and the body of a `Loop`, the body of a `Sum`, `ReplaceAt`, `At` of a
  comprehension, a helper argument that the body does not read or reads
  twice, an initializer that is not read, the branch of an `If` or a
  `Which` that is not taken, `Or`, `Max`) give the draws of the compilers.
- With the memo of shared subexpressions (`Lowering.value()`), a node
  object that draws, reached twice, draws twice: the memo records a value
  only when each operation of its lowering is `pure` and cannot abort, and
  a `draw` is `effectful`, as is a call of a helper whose body draws. A
  `seeded` region with a literal seed is `pure` and cannot abort, so the
  memo shares it (the same seed gives the same value); one with an input
  seed can abort and is lowered at each use. The body of a `seeded` region
  is a region of the memo (`inRegion()`); it binds no name.
- Two or more draws of which one is in a complex value decline
  (`refuseHoistedDraws()`): the existing emitter binds a complex operand to
  a `const` ahead of the code that it writes inline for the other operands,
  so `Random() + Sqrt(Random(Range(-2, 8, 2)))` in the `complex` mode draws
  for the square root first. Found by the random differential tester with
  `--random`.
- A `WithRandomSeed` takes the lane that the existing compiler gives it by
  its type. In the `complex` mode a real body of a wide type (`number`) is
  converted to complex in the region, the value that `_SYS.cplx()` makes
  around the call there; in the `strict` mode a real body of a type of
  numbers that are not real declines, since the existing code reads the
  parts of the number (`NaN`, a known-limitations line in
  `docs/COMPILATION-MODEL.md`); another type that is not real declines in
  the `complex` mode.

**Disagreements between the interpreter and the existing compiler** (none
in the doubles of an admitted program):

- `WithRandomSeed(z, Random())` with `z` declared `complex`, in the
  `strict` mode, `z = 3`: the interpreter keeps the expression unevaluated,
  the existing code gives `0.4706436893981194` (within the caveats: an
  unevaluated form). The profile declines a complex seed in the `strict`
  mode.
- `Sqrt(Random() - 0.5)` in the `strict` mode, seed 7: the interpreter
  gives `0.6443…i`, both compilers `NaN` (within the caveats).

**The shadow measure**, over the 137 test files that name `Random` and
compile (138 after, with the new test file), `CE_JS_PROFILE_SHADOW=1`:

| Decline | Before | After |
| --- | --- | --- |
| `unsupported head Random` | 575 | 0 |
| `unsupported head WithRandomSeed` | 65 | 0 |
| `the helper … is not pure: its signature has effects` | 34 | 16 (`scope` 11, `any` 5) |
| `Less with n operands` (the next decline of programs that pass `Random`) | 11 | 126 |
| `unsupported head RandomChoice` / `RandomShuffle` / `RandomSample` | 17 / 7 / 6 | 38 / 10 / 9 |
| `Random(<domain>)`, a run-time domain | — | 4 |
| `Sqrt` of `Random()`, which the engine proves non-negative | — | 3 |
| `Power` with the exponent `Random()` and no unknown | — | 1 |

Admitted by the profile, of the compilations that the existing compiler
compiled: 1,146 of 4,817 before, 1,396 of 4,877 after (the new test file
adds 60 compilations). No new failure. The same files run with and without
`CE_JS_PROFILE=numeric-kernel`: 9,108 passed, 12 skipped, 1 todo, in both.
Slice 4 (run-time domains) has 4 declines in this measure. The measure
was made on `6ac31a524`, before the two refusals above.

**The random differential tester** (`scripts/js-profile-fuzz.ts --random`):
draws in leaves, `WithRandomSeed` with a literal or an input seed, and two
helpers whose body draws; each call of a compiled function runs with
`Math.random` replaced by the same deterministic sequence, started again
before the call, and the number of draws is part of the outcome. With
`--seed 41,42,43 --count 5000` (15,000 programs, 19,985 compiled by both
in a mode), before the two refusals above, the classes with draws were the
order of draws next to a complex value (11 shapes), the lane of a seeded
region (5 shapes of values, 10 of the shape that the code makes), and 109
failures of the emitter where a draw from a literal domain is a real
operand of a complex sum. The emitter now writes that draw in parentheses,
as the `Random` handler of the existing emitter does. After the changes:
no program draws a different number of times, no failure of the profile
has a draw, and the two differences with a draw are of classes that the run
without `--random` also has (a `real` local that holds a complex value,
`Mod` of a value beyond the safe integers).
