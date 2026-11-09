# Real JS fragment annotation integration experiment

Pinned source: `43679ce5df346479eb94b25a5882f798eafd5c74`, isolated `/tmp/wt-js-profile-next`. This is a disposable evidence patch, not a public API or production proposal. The real fragment pass is usable for a narrow integration now; it does not make the complete JS compiler annotation-authoritative.

## What actually runs

The module-only `ExperimentalScalarJavaScriptTarget` subclasses the existing JS target. Existing preparation runs once, including original normalization/CSE setup. `typeFragment()` annotates the resulting expression. The exact annotation and prepared expression are then consumed by the original emitter and runtime assembly. No independent interpreter, toy lowering, or substitute emitter is involved. `prepareCompilation` becomes protected for this experiment only; no target is registered and no public options are added.

Admission is intentionally narrow: strict mode, scalar real/integer/boolean inputs, builtin Add/Multiply/Divide/Negate/Sin/Cos/Sqrt/Less/Greater, three-arm If, and Random for the lazy-effect check. Stored values, functions, binders/loops, containers, custom host source/vars, broadcast/batch, other compile modes and unsupported heads decline. Complex literals and provably negative radicals decline. Unknown-sign Sqrt follows the existing strict real/NaN route. Broad result types alone cannot identify the strict target's runtime lane; the initial overly conservative admission rejected the valid If/Sqrt fixture and was corrected before the recorded passing run.

The real `walkIf` joins branch facts. The slice requires no nontrivial conversions. Every visit to `compileExpression` requires a fact for that *same expression object* in the one annotation scope. Missing facts throw instead of falling back to a reader. No lexical binders are admitted, so this proves single-scope identity only, not identity through function cloning, loop unrolling, local frames or later SSA rewrites. A missing-node negative control checks the invariant explicitly. A rewrite creating a new emitted node would decline until its facts were supplied.

## Query change accounting

Ten existing decision sites now consult annotation facts when this internal target is used: Add (1), Multiply (1), Divide (2), Negate (1), Sin/Cos (2), Sqrt operand/promotion (2), branchComplexCoercion (1). Legacy targets use the same existing reader through an absent-experiment branch. Zero reader implementations are deleted; their many unsupported callers remain. This patch adds admission/annotation/identity-check cost and is not a demonstrated simplification or speedup.

Not every static replacement executes for every fixture: infix lowering and folding may bypass a function handler. The repeated arithmetic probe records 9 emission visits and 11 exact-node reads; the If/radical probe records 6 and 10. Those counts demonstrate fact lookups beyond the entry invariant, not a fact changing a decision: admission restricts this slice to real/integer/boolean facts, so every complex-lane answer is false. The Sqrt promotion site is sound here because admission separately refuses provably negative operands; operand facts alone would not answer the result-lane question in a broader target. Other admission/shape/type/purity readers in the original pipeline remain, including queries before these selected decisions. Claiming full authoritative annotation would be incorrect.

## Validation

- New test: `test/compute-engine/compile-javascript-fragment-experiment.test.ts` (31 cases). Five numeric/boolean fixtures × all four CSE/fold combinations; independent numeric oracle, byte-identical legacy source before/after, values across positive/negative/zero inputs and both branches; seeded lazy Random checks value and next-draw stream against legacy and interpreter; explicit unsupported admissions and missing-node check.
- Existing controls: `compile-complex.test.ts`, `compile-which-complex-selection.test.ts`.
- Combined exact Jest run: 3 suites, 264 tests, exit 0; zero snapshots. Command: `/opt/homebrew/bin/timeout -k 30 600 node_modules/.bin/jest --watchman=false -w 4 -- test/compute-engine/compile-javascript-fragment-experiment.test.ts test/compute-engine/compile-complex.test.ts test/compute-engine/compile-which-complex-selection.test.ts`.
- `node_modules/.bin/tsc --noEmit --incremental false`: exit 0. This checks the source project, not the full generated declaration/consumer pipeline.
- Oxlint on five changed source files: exit 0.
- Standalone correctness instrument: 8 paired fixture/options rows, 48 value comparisons, exit 0. `annotation-results.json` records emission hashes, fact/visit counts and values.
- No full suite/core suite, corpus, build, generated API checks, or public documentation edits: no public adoption is proposed and the parent owns broader validation/review.

## Replay and bounded compilation timing

From a worktree containing the patch and dependencies:

```sh
CE_ROOT="$PWD" OUTPUT_DIR=/tmp/js-profile-next node --import ./node_modules/tsx/dist/loader.mjs /tmp/js-profile-next/annotation-probe.mjs
# Only while holding the shared-box timing lock:
CE_ROOT="$PWD" OUTPUT_DIR=/tmp/js-profile-next node --import ./node_modules/tsx/dist/loader.mjs /tmp/js-profile-next/annotation-probe.mjs --timing
```

`CE_ROOT` and `OUTPUT_DIR` are configurable. The executable lives outside the repository; preserve it beside the patch before removing the worktree. The tsx CLI's IPC socket was denied by this environment; the loader invocation above works without it.

Timing ran once with the parent's explicit lock permission, exit 0. It measures normal total compile cost over already boxed expressions; both paths prepare afresh each iteration. Each of 2 fixtures × 4 option settings gets 10 alternating warmups, then 5 paired trials of 10 compilations, reversing pair order on alternating trials. No per-pass instrumentation or generated-function runtime timing.

Median milliseconds per compilation (legacy / experimental): repeated arithmetic 0.3610/0.3543, 0.3945/0.4121, 0.3527/0.2374, 0.3331/0.3587; If/radical 0.1933/0.2455, 0.1293/0.1379, 0.1814/0.1505, 0.2335/0.2329. Order is (CSE false, fold false), (false,true), (true,false), (true,true). These tiny samples show mixed ratios (0.67–1.27) and are too short/noisy to support a speedup or regression claim. Raw trials are in `annotation-timing.json`.

## Interpretation

Proceed with a similarly bounded internal migration, but first decide the shared annotation contract for target-specific constant lanes, prepared-node ownership and transforms that introduce nodes. Then replace a complete group of JS decisions and delete its duplicate readers when all callers migrate. Keep public JS unchanged until admission/emission/runtime parity is shown. This experiment supports trying that integration without first adopting CPS or SSA. It does not validate mutable locals, effect-dependent facts, user callbacks, functions, loop-carried values, general complex arithmetic, union dispatch or async/concurrent execution.
