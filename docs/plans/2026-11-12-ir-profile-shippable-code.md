# The profile `ir`: shippable code, and the `bigint` lane (design note, cov3)

## What blocks shipping today

The code of the profile is `(_) => { … }` in a scope where `_rt` is
`javascriptRuntime(ce, budget)` (`ir/print-js.ts`). That object closes over
the engine (`ce._randomFrame`, `ce._random()`, `ce._deadlineFrame`) and over
the budget, and has no version. A stored or shipped kernel of the existing
target is `StoredKernel` (`kernel-protocol.ts:50-80`): `code`, the preambles,
`runtimeVersion`. The receiving side builds `_SYS` with
`createJavaScriptRuntime()` → `makeSysHelpers(source: RuntimeSource)`
(`javascript-runtime.ts:7041`, `RuntimeSource` at `:6611`: `random`, `draw`,
`frame`, `setFrame`, `iterationLimit`, `deadline`), and `load()` (`:8063`)
refuses a missing or different `runtimeVersion`, then runs the code through
`twoStageRunner` (`:8494`): `new Function('_SYS', hoisted + 'return
function(params){perCall; return code}')`. The worker (`src/kernel-worker.ts`
`:149`) makes one such runtime and sets `iterationLimit`/`deadline` per task.
`pool-loop.ts:846,870` declines with a budget or unshippable code;
`isShippableCode` (`kernel-pool.ts:322-327`) rejects draws and `integrate`.

## Option A: print for `_SYS` (recommended)

The printer spells the runtime as `_SYS.<member>` and splits its output into
`preambleOnce` (helpers, user functions) and the body; the adapter sets
`runtimeVersion = RUNTIME_VERSION`, `shippable = isShippableCode(code)`, and
the budget as the existing target does (`_SYS.countLoopPass(N)` in each
`Loop` pass, `_SYS.resetLoopPasses()` per call). The members the IR calls
that `SYS_HELPERS` lacks are added to it once: the `REAL_FUNCTIONS` and
`COMPLEX_FUNCTIONS` by name (most already are SYS members: the complex ones
are `SYS_HELPERS`), `realPow`, `floorMod`, `rangeCount`, and a `tick()` that
reads `source.deadline()` (today `_SYS` has no general deadline member). The
local `run()` is then `createJavaScriptRuntime(engineRuntimeSource(ce))`
`.load(result)` or the same two-stage runner, so local and shipped code are
one code path. No change to the worker, the protocol or the pool.

Estimate: print-js ~25 lines, javascript-runtime ~20, adapter ~20, README
~10; 60-80 lines changed, net smaller (`javascriptRuntime()`, 45 lines, goes
away). Risk: one name space with the existing helpers (a test checks that
every member the IR spells is in `SYS_HELPERS`). Draws and integrals stay
unshippable by the existing rule.

## Option B: an IR runtime with its own version

An `irRuntime(source: RuntimeSource)` with `IR_RUNTIME_VERSION`, a field in
`StoredKernel` naming the runtime, a branch in `kernel-worker.ts` and in the
`ready` version check of the pool (`kernel-pool.ts:560-566`), and a loader:
120-160 lines in five files outside `ir/`, two runtimes to keep in step.

## `mode: 'bigint'` (1,029 hits)

The integer lane printed as JavaScript `bigint`, no new IR lane: a second
`Syntax` whose `.int` spellings are bigint ones (`5n`; `_SYS` bigint helpers
for `abs`, `max`, `min`, floor division, `Mod`, integer `Power`), and an entry
conversion of each integer input with `BigInt()`. A real or complex value
declines with `code: 'bigint-lane'` (`CompileMode`): one check per signature
in `apply()`. It touches `operators.ts` (folds on `bigint`), the `fold` pass,
`elem`, loop counters and lengths (stay `number`: a conversion at `elem` and
at a `Range` bound), the printer's `constant`, and the adapter (`mode:
'bigint'`; the one root catch that turns a pole into `NaN`). Estimate 150-200
lines; a separate task.
