# CE-423: the batch body of a compiled kernel is built on request

Status: DECIDED and IMPLEMENTED 2026-10-25. User decisions: the option is
named `broadcast`, its default is `false` (the batch body is built only when
the caller asks), and the engine's own compilations keep the default. The
recommendations of sections 4.1 and 6 below (default `true`, name `batch`)
were NOT taken; they stay as the record of the alternatives. Tests:
`test/compute-engine/ce-423-broadcast-option.test.ts`.

## 1. The problem

Since CE-410 (0.166.0), `compile()` of an expression that reads a free list
declared as a list of numbers at a scalar index (`F_{i+1}` with
`F: list<number>`) runs the code emitter twice. The first pass gives the
ordinary body that `run()` calls. The second pass gives the batch body: the
same expression, with each free symbol read from a parameter of the body and
each read of the shared list made directly on the checked array. `broadcast()`
runs the batch body for a whole batch when the shared lists pass a check made
once per batch, and that is where the "up to 15 times faster" of CE-410 comes
from.

The second pass runs on every such `compile()`, also when the caller never
calls `broadcast()`. Measured on 2026-10-24 on Tycho's march kernel: 35 to 48%
of the compile time (1.40 to 1.68 ms, of which 0.65 to 0.78 ms is the batch
body).

## 2. What the second pass costs, measured

Measured 2026-10-25 from source with `tsx` (Node 26, the CE-410 march kernel
of `test/compute-engine/ce-410-batch-body.test.ts`, `F: list<number>`,
`i: integer<0..>`, 4,000 compiles after 200 warm-up compiles, CPU profile
summarized by inclusive time):

| Phase                                           | Share of one `compile()` |
| ----------------------------------------------- | ------------------------ |
| `compileBatchBody` (the second pass, inclusive) | 46%                      |
| `prepareCompilation`, both passes together      | 15% (about 7% per pass)  |
| `compileCseRoot`, both passes together          | 80%                      |
| `loadBatchBody` (`new Function` of the body)    | under 1%                 |
| `withReferences`, `createTarget`, shippability  | under 3% together        |

One `compile()` took 0.90 ms on this machine. Two conclusions:

- The cost is the emission itself (`compileCseRoot`), not the preparation.
  Sharing the prepared expression (the angular-unit rewrite, the fixed-width
  unroll, the target) between the two passes would save about 7% of the
  compile, not the 46%.
- The second pass is as expensive as the first because it emits the same
  tree with the same analyses (type facts, constant folding, CSE); only two
  emission points differ (the read of a free symbol, the `At` of a shared
  list), plus the preamble split and the skipped last-call memo.

A side observation, not a defect: when the engine runs from source (`tsx`,
jest), the `console.assert` at the top of `lookup()`
(`src/compute-engine/function-utils.ts`) is about 20% of a compile in this
profile, called through `lookupDefinition` from `bindingSiteSelectorOf`,
`userFunctionLiteral` and `hasCallerCompileHandler`. The production bundle
strips every `console.*` call, so a consumer does not pay it. A benchmark run
from source overstates the compile time by that share.

## 3. Who pays, who benefits

- The engine's own compilations (`implicitCompile`,
  `src/compute-engine/implicit-compile.ts`: the `Map` drains, the numeric
  kernels of `NDSolve`, `Solve`, the collection fast paths, the nonlinear fit)
  never call `broadcast()` on their result. The fit ships its result to the
  kernel pool, but its stored form (`storedKernel()`,
  `src/compute-engine/nonlinear-fit.ts`) does not copy the `batch` field, so
  the pool runs the ordinary body there too. Most of these compile a
  `Function` literal, which has no vars object and no batch body; the ones
  that compile an expression pay the second pass for nothing when the
  expression reads a shared list.
- Tycho compiles every plot row through one routine
  (`~/dev/tycho/src/plot-core/ce-module-registry.ts`, `compile(expr, options)`)
  and reads both `run()` (the per-cell evaluator) and `broadcast()`
  (`Function2D.batch`, `src/plot/series/implicit-series.ts`) from the same
  result. For those rows the second pass is the price of the CE-410 speed and
  stays. Tycho also has `run()`-only sites (for example `node.run(args)` in
  `src/plot/ce-compile.ts`); those can opt out once an option exists. Tycho's
  march kernel, the example of the ROADMAP entry, is a `broadcast()` kernel:
  its compile time does not change under this design unless Tycho compiles it
  for `run()` only somewhere.

## 4. Options considered

### 4.1 An option of `compile()` (recommended)

A boolean option, `batch`, on `CompilationOptions`. `true` (the default)
keeps the current behavior: the JavaScript target compiles the batch body
when the ordinary body reads a shared list of numbers at a scalar index.
`false` skips the second pass: the result has no `batch` field, and
`broadcast()`, `broadcastAsync()` and a kernel worker run the ordinary body
for every cell, as before CE-410. The other targets ignore the option (only
the JavaScript target builds a batch body). The values are the same either
way; only the speed of `broadcast()` differs.

Where it plugs in: `compileOrThrow()`
(`src/compute-engine/compilation/javascript-target.ts`) passes the batch-body
builder to `compileToTarget()`; with `batch: false` it passes `undefined`, and
`compileToTarget()` already treats an absent builder as "no batch body". The
`At` lowering keeps recording the candidates (the set is cheap); nothing
reads it when the builder is absent. `implicitCompile()` passes
`batch: false` unless its caller's options say otherwise, for the reason of
section 3. `assertCompilationOptionsContract()`
(`src/compute-engine/engine-extension-contracts.ts`) checks the type of each
option it knows; add a line for the new one.

Cost: about 30 lines, one test file, one guide paragraph. Gain: the full 46%
at every opted-out site, nothing at a site that broadcasts.

Name: `batch` matches the result field it controls (`CompilationResult.batch`,
`StoredBatchBody`) and the spelling of the other switches (`entryChecks`,
`constantFold`, `cse`). `broadcast` would be wrong: `broadcast()` still works
with the option off. `batchBody` is the unambiguous alternative; it is longer
and names nothing else on the public surface.

Default: `true`. A result's `broadcast()` is at full speed by default, and
the consumers who exist (Tycho's plot rows) keep the CE-410 speed with no
change. The cost falls on the kernels that read a shared list, a minority,
and a `run()`-only caller opts out in one word. With the default `false`,
every consumer who broadcasts would lose the 15 times of CE-410 silently
until it passes the option; CHANGELOG readers rarely notice that kind of
change.

### 4.2 Build the batch body lazily on the first `broadcast()` (rejected)

The ROADMAP entry gives the reason: the compilation reads the engine state
(assigned values, declarations, the angular unit, the precision) and module
globals (`BigDecimal.precision`, the reconstruction digits) while it emits,
so a later build can fold other values than the ordinary body did, and the
two bodies would disagree.

A variant was considered here: on the first `broadcast()`, rerun the whole
compilation (both passes) and keep the batch body only when the regenerated
ordinary body, preambles, entry plan and reconstruction digits are
text-identical to the stored ones; a difference means the state moved, and
the batches run the ordinary body. The witness is sound, but the cost profile
is wrong: a consumer that broadcasts, the main one, would pay a full compile
(two passes) at its first batch instead of one extra pass at compile time,
and a `run()`-only consumer gets exactly what option 4.1 gives it for free.
It also adds a mechanism to explain. Not worth it.

### 4.3 One emission pass that produces both bodies (rejected for now)

The two bodies differ at two emission points. A single pass could emit the
ordinary text with content-keyed markers around each differing fragment and
a side table of the batch fragments, then produce the two texts by
substitution after the pass. The difficulty is everything that reads emitted
text during the pass: the CSE session deduplicates fragments by their text
(so a marker must be a function of the content, never of a counter), the
value-facts analyses and the statement forms (`javascriptStatements`) parse
or wrap the text, `localVarsObjectStatement`, `VARS_OBJECT_READ`,
`isShippableCode` and `identifierPattern` test it, user-function definitions
are split differently for the batch body (`splitPreambleDefs` with the
locals), and the last-call memo (`memoizeSharedDefinitions`) must appear in
one body only. The emitter is about 30,000 lines. The saving is about 0.4 ms
per compile of a kernel that reads a shared list. Days of work and a real
regression risk for that; revisit only if a consumer shows that compile time
of such kernels is on its critical path after 4.1.

### 4.4 Share the prepared expression between the two passes (not enough)

Saves about 7% of the compile (section 2). It would not change the ROADMAP
entry's numbers in a way a consumer notices. Not done.

## 5. The plan (after the decisions of section 6)

1. `CompilationOptions.batch?: boolean` in
   `src/compute-engine/compilation/types.ts`, documented in the style of
   `entryChecks`. `assertCompilationOptionsContract()` checks it is a boolean
   when present.
2. `JavaScriptTarget.compileOrThrow()` passes the batch-body builder only when
   `options.batch !== false`.
3. `implicitCompile()` adds `batch: false` to the options it builds, after the
   caller's options (so a caller can ask for it). No caller does today.
4. Tests, `test/compute-engine/ce-423-batch-option.test.ts`: with
   `batch: false` the result has no `batch` field; `broadcast()` gives the
   same cells as with the batch body (the CE-410 march kernel, both index
   types); a kernel pool runs such a result (the stored form has no batch);
   the `interval-js` target accepts the option. One timing check in the
   `CE_PERF` suite is not needed: the saving is the absence of a pass.
5. `doc/13-guide-compile.md`, section "Batch body and declared types": one
   paragraph, "a caller that only calls `run()` passes `batch: false` and
   saves the second compilation; `broadcast()` then runs the ordinary body
   per cell". `CHANGELOG.md` under Performance.
6. Tycho: a row in `~/dev/tycho/docs/COMPUTE_ENGINE.md` that names the option
   for its `run()`-only compile sites. The plot rows keep the default.
7. Remove CE-423 from `ROADMAP.md` when the change lands.

## 6. Decisions wanted

1. The name: `batch` (recommended) or `batchBody`. Saying no to both means the
   option is named by the user.
2. The default: `true` (recommended; the batch body is built unless the caller
   opts out) or `false` (a consumer that broadcasts must ask for it). With
   `false`, Tycho has to pass `batch: true` in its registry routine before it
   adopts the release, or its implicit plots lose the CE-410 speed.
3. Engine-initiated compilations opt out (recommended: `implicitCompile`
   passes `batch: false`; no internal site reads the batch body today) or keep
   the default. Keeping it costs the second pass on the few implicit
   compilations of an expression that reads a shared list.

If nothing is decided, the entry stays open and the second pass keeps running
on every compile.
