# Census of the caches of evaluated values (CE-601)

Date: 2026-10-28. Written with the change that adds the memo of shared
subexpressions (ROADMAP CE-601) and the rule for host code. This census is the
input for a later audit and architecture review of the caches of the engine.

## The rule for host code

Host code is JavaScript that the host gives to the engine and that the engine
cannot read: an operator handler, a collection handler, a `subscriptEvaluate`
handler, a protocol callback. It can read state that the engine does not
track (a JavaScript variable, `ce.symbol('x').value` read by name), keep its
own state, or change state that an expression reads.

User decision of 2026-10-28: a host operator is cached only when its
declaration states its purity (`pure: true` or `pure: false`,
`drawsRandom: true`, an `effects` set, or an effect specifier on the
signature; `drawsRandom: false` alone states nothing). An operator that states
nothing is evaluated at each occurrence. The operators of the standard
libraries keep their own purity.

One process-wide count implements the rule: `uncachedHostCallCount()` in
`src/compute-engine/boxed-expression/host-handler-changes.ts`. A cache that
keeps an evaluated value reads the count before the computation and does not
store the value when the count moved. The second table below says when the
count moves.

The operators of the standard libraries are not host code. A definition is
marked `_standardLibrary` when it is made while the engine installs a
standard library (`withStandardLibraryInstall()`), and the mark never
changes. An extension (`ce.declare(name, patch, { extend: true })`) of a
standard operator that keeps its `evaluate`, `evaluateAsync` and collection
handlers is made under the same mark, and so are the types that the
constructor declares.

## 1. The caches that keep an evaluated or derived value

Paths are relative to `src/compute-engine/`.

"Host code can reach it" means: can the stored value depend on a value that
host code returned, and survive past one top-level evaluation.

### Caches that honour the host-code rule

| Cache (file, symbol) | What it stores | Key | Lifetime | How it detects an outdated value | State the value depends on | How it honours the rule |
|---|---|---|---|---|---|---|
| Memo of shared subexpressions (`boxed-expression/shared-evaluation-memo.ts`, used by `BoxedFunction.evaluate`) | The result of a pure function node | The node and the evaluation frame, exact and numeric apart | One top-level evaluation | `_evaluationVersion`, a count of impure evaluations, precision, requested precision, assumptions hidden or not, angular unit, random seed frame, `isVerifying`, effects registry | Every value that the node reads | Part of `failClosedCount()`; an unstated host node marks the memo impure |
| Application memo of function literals (`function-utils.ts`, `validApplicationMemo`) | The result of a call of a pure function literal | The literal and the arguments | One engine, across evaluations | Versions and per-dependency write versions recorded with the entry | The values the body reads | Checked at both store sites |
| Lazy collection and inert value memo (`boxed-expression/boxed-function.ts`, `_memoizedLazyCollectionValue` and its asynchronous twin) | The value of a lazy collection view, or the inert result of a node | The node | One engine | `_anyVersion` generation, world version (epoch), scope stamp, assumptions hidden or not, object dependencies | The values the view reads | The count is sampled before the eligibility test, whose finiteness read can evaluate an operand; an unstated host node skips the memo |
| Collection element memo (`boxed-expression/collection-element-memo.ts`) | The elements of a collection, by index | The collection node and the index | One engine | World version, a dependency snapshot (`snapshotMemoDeps()`), object dependencies | The values of the symbols the collection reads | Checked at all four store sites. A recorded walk compares counts that `BoxedFunction.each()` samples before it builds the iterator and reads the finiteness (`elementMemoWalkBaseline()`): building the iterator of `Join` and the finiteness read evaluate the operands, and the generator body runs only at the first pull |
| Facet memo (`boxed-expression/boxed-function.ts`, `_memoizedFacet`) | `count`, `isEmpty`, `isFinite` of a collection | The node and the facet | One engine | World version, assumptions hidden or not, dependency snapshot, object dependencies | The collection handlers, and the predicates that a library `count` evaluates | Checked before the store |
| `at()` of a function node with no collection handlers (`boxed-expression/boxed-function.ts`, `_materializedAt`, slot `_eagerSource`) | The full `evaluate()` result of a collection-typed node | The node | One engine | `_cacheGeneration()` | Everything the node reads | The cell is cleared when the count moved |
| Slice bounds memo (`library/collections.ts`, `SLICE_BOUNDS_MEMO`) | The start and end of a `Slice` window | The `Slice` node | One engine | World version, assumptions hidden or not, dependency snapshot | The `count` of the source and the evaluated span operands | Checked before the store |
| Stored value of a symbol (`boxed-expression/boxed-symbol.ts`, `_memoizedStoredValue`) | The evaluated value of the value of a symbol (exact, numeric, and the `N()` read) | The stored value expression and the route | One engine | World version, assumptions hidden or not, dependency snapshot, object dependencies | The values that the stored value reads | Checked after the cycle check |
| Sequence term memos (`sequence.ts`: `memo`, `numericMemo`, `declined`) | The terms of a sequence declared with `ce.declareSequence()` | The index (and precision for numeric terms) | One sequence definition | A memo stamp that records what the recurrence, base values and constraints read (`memoStampIsValid`) | The values the recurrence reads | No term of a read is memoized when the count moved since the read started; the terms of one read are kept in `read.terms` for that read only |
| Exact-zero and exact-parts memos (`symbolic/contour.ts`, `zeroMemo`, `partsMemo`; the test of constant symbols reads each shared node once) | The verdict "this expression is exactly 0", the exact real and imaginary parts of a constant | The structure of the expression (hash, then `isSame`), angular unit, precision, `_definitionVersion` | One engine. A new entry for an expression replaces the earlier entries for the same expression (`isSame`), and the memo is cleared when it holds 2000 entries | The key. The parts memo stores only an expression whose symbols are all constants. A zero verdict of an expression that reads another symbol (the series code passes `sin(a) − sin(1)` with `a := 1`: it has no unknowns) is stored with the cache generation and served only while the generation is unchanged | The definitions of the operators in the expression, and the values of the symbols it reads | Checked before each store. The `_definitionVersion` part of the key is new: an extension that replaces `evaluate` does not move the world version. Before the generation stamp, `Series((x + sin(a) − sin(1))/x, x, 0, 2)` gave `1 + BigO(x^5)` after `a` changed from 1 to 2 |
| Approximations of the comparisons (`boxed-expression/compare.ts`, `approximations`) | A value with an error bound | The expression, and a key of precision, decimal precision, angular unit and rounding rule | The last two keys of each expression | The key only; only values whose symbols are constants are stored | The value of constant symbols | Checked before the store. No test reaches a host-derived value here; it is a guard |
| Compiled probes of `Limit` (`symbolic/limit.ts`, `probeCache`) | A machine-float function of the limit variable, or "cannot compile" | The probed expression; the entry also records the variable | Weak, per expression | World version, `_definitionVersion`, assumptions hidden or not, dependency snapshot of the expression; checkpoint journal | The values of the symbols of the expression, the definitions in force | Not stored when the count moved during the compile. Before this change the cache had no version stamp, and `Limit(e^(a x)/x^3, x → ∞)` kept its answer `+∞` after `a` changed from 2 to −2 |
| Compiled functions of `Map` (`library/map-auto-compile.ts`, `mapCompileCaches`) | A compiled element function, or a "no compile" mark | The `Map` node | Weak, per node | `_semanticVersion`, per-dependency write versions and bindings, world version, tolerance, angular unit, rounding rule | The values that the compiler folds | A compile that ran host code is recorded as "no compile". With dependency tracking the compiler folds no host operator, so no test reaches it; it is a guard |
| Values of eager sources (`boxed-expression/eager-source-values.ts`: `keptByEngine` and the shared store) | The evaluated value of an operand that the finiteness test of a lazy view evaluated, for the operand step | The operand expression; a value that host code computed is kept in a second map, `hostKeptByEngine`, by top-level evaluation (`topLevelEvaluationEpoch()`) and then by operand | `keptByEngine`: the evaluations in progress on the engine, released when none is in progress. `hostKeptByEngine`: one top-level evaluation, released when it ends (`releaseHostEagerSourceValues()`). The shared store: one evaluation of one view | Scope, assumptions hidden or not, precision, versions in the entry | The operand | A value computed while the count moved is kept for the top-level evaluation that computed it only: every consumer of the same source node in that evaluation (the operand step of the view, a `Sum` that reads the finiteness of the view and iterates it, an enclosing view) reads the one value, so the host code runs once per top-level evaluation. Two asynchronous evaluations that run at the same time each keep their own value and call the host once each. Each use counts the host code again, so a memo around the use does not keep the result |

### Caches that need no check

| Cache | What it stores | Why no check |
|---|---|---|
| `BoxedFunction._sgn` (`boxed-function.ts`) | The sign of a node, keyed on `_cacheGeneration()` | It keeps the answer of a `sgn` hook, which describes the operator. The library `sgn` handlers read the signs of the operands and do not evaluate them |
| `BoxedFunction._type` (`boxed-function.ts`) | The type of a node | It keeps the answer of a `type` hook, which describes the operator |
| `FACTOR_MEMO` (`boxed-expression/factor.ts`) | A factorization, keyed on digest and `_cacheGeneration()` | Its `.N()` root search can run host code, but a factor is kept only after an exact polynomial division confirms it |
| `FOLDED_INTERVAL_CODE` (`compilation/interval-javascript-target.ts`) | A folded form of a constant interval code string | Only a fixed list of interval routines may appear in the code; no host code runs |
| Constant value from a function `value` (`boxed-expression/boxed-value-definition.ts`) | The value of a constant | It is the stored value of the definition, by contract. The function is called when the definition is made and again after a change of configuration |
| `_foldValueMemo` and its siblings (`compilation/base-compiler.ts`) | Constant folds during one compile | Reset at each outermost compile. An explicit `compile()` folds a constant host operator into its code, as it does for the value of a symbol: the compiled function is a snapshot |
| `DECLINED_DERIVATIVES` (`library/calculus.ts`) | A record that a derivative has no closed form | Symbolic only |
| Structure-only caches: the apply-site memo (`apply-site.ts`), `LITERAL_SET_INDEX` (`collections.ts`), the exact-proof memos (`map-exact-proof.ts`), `spineMemo` (`map-lowering.ts`), the interval type caches (`numerics/interval-arithmetic.ts`) | Structure, types, or proof verdicts | Nothing is evaluated |
| Caches for one call: `foldRefinementStates` (`collections.ts`), `exactDivergenceChecks` (`calculus.ts`), `guardedPrecision` (`exact-operands-under-n.ts`) | Values for one call | They do not survive the call |
| Kernel pool (`kernel-worker.ts`, `kernel-pool.ts`) | Compiled code and shared input arrays | They keep no evaluated result |

## 2. Host hooks that run during evaluation

| Hook | Counted |
|---|---|
| Operator `evaluate`, operator `evaluateAsync` | An operator that does not state its purity: at each evaluation of each application, on both routes. An operator that states it: at each call that moves the persistent evaluation version (the handler changed state) |
| The `evaluateAsync` handler of a user function (a definition whose `evaluate` is a function literal) | On the asynchronous route, which calls the host handler, as for any host operator |
| A JavaScript function assigned with `ce.assign()` | It becomes a host operator that does not state its purity |
| Collection handlers of a host operator (`at`, `iterator` and each step of the iterator, `count`, `contains`, `countOf`, `subsetOf`, `indexWhere`, `atBigint`, `indexOf`, `isEmpty`, `isFinite`) | An operator that does not state its purity: every call. An operator that states it: a call that changes state |
| Collection handlers of a symbol that the host declares | Every call: a value definition cannot state its purity |
| Collection handlers that describe the collection (`isCollection`, `isLazy`, `isEnumerable`, `eltsgn`, `elttype`) | Not counted. They are called with `this` bound to the handlers that the host gave |
| A `subscriptEvaluate` handler that the host gives | Every call. The handlers that the engine makes for a sequence and for parsing are marked and not counted |
| A host callback of a protocol implementation (`ce.declareProtocolImplementation()` with a JavaScript function, getter or setter) | Every call (`invokeImplementation`, `engine-protocols.ts`) |
| `declareSequence` | Not host code: its recurrence, base values and constraints are expressions |
| `canonical`, `type`, `sgn`, `even`, `eq`, `neq`, `cmp`, `canEnumerate`, `elementCount`, `inferOperandTypes`, `evalDimension`, `derivative`, `compile`, `definedWhen`, `requires`, `commutativeOrder`, `costFunction` | Not counted. They describe the operator |
| A function `value` of a value definition | Not counted. Its result is the stored value |
| Functions passed to `compile` | Not counted. They run when the compiled code runs, outside every evaluation memo |
| The debugger hook | Every memo of shared subexpressions is off while a debugger hook is set |
| An entropy handler installed by `withEffects()` | The memo of shared subexpressions records the registry in its stamp |

## 3. Validity counters

| Counter | Advanced by | Meaning |
|---|---|---|
| `_anyVersion` | Every state event whose mask selects the `any` axis (`noteStateEvent`, `axisMaskOf`, `engine-configuration-lifecycle.ts`): value writes, declarations, assumptions, configuration, scope pops | Something changed |
| `_cacheGeneration()` | `_anyVersion` × 2, plus 1 while the assumptions are hidden | A key for caches that must see every change and keep the two sides of hidden assumptions apart. A declaration of a function literal's parameter moves it, so it is not a usable stamp for a value that a cache rebuilds through a new literal |
| `_semanticVersion` | Semantic mutations; not the ephemeral writes of a loop index, not a clean scope pop | Keys caches that must survive unrelated scoped evaluations |
| `_worldVersion` | Rare global events: assumptions, redefinition events, inference, configuration | Keys caches whose dependency snapshot already covers value writes. An extension that replaces the `evaluate` of an operator does NOT move it |
| `_definitionVersion` | A change of an existing definition: a retype, a declaration that shadows a callable, a change of a callable other than a declaration | Keys caches whose value depends on the definitions of operators |
| `_callableVersion` | World events, callable writes, declarations, retypes and swaps, pops with changed assumptions | Keys `BoxedFunction._effects` |
| `_evaluationVersion` | Every event except a declaration that neither shadows a callable nor changes a binding visible from a frame, a scope pop with unchanged assumptions, and a binding repair with no `any` axis | Keys the memo of shared subexpressions: something that a frame still on the stack can read changed |
| `_persistentEvaluationVersion` | `_evaluationVersion` less the ephemeral value writes (a loop index) | Tells whether a host handler changed state that outlives it |
| Per-definition `_writeVersion` | A write to that definition | Read by dependency snapshots (`snapshotMemoDeps()`) |
| `uncachedHostCallCount()` | See section 2 | Host code ran: a memo must not keep a value computed across it |
| Fail-closed counts: `cycleDetectionCount()`, `sequenceReadStopCount()`, `reentrantSignatureReadCount()`, `incompleteWalkCount()`, `iterationLimitCancellationCount()`, `_lazyValueProvisionalReads`, the provisional reads of `cachedValue` | A provisional answer, a cut cycle, a stopped read | A value computed across one of them is not final |
| Stamps of the memo of shared subexpressions | Read at each look-up: precision, requested precision, assumptions hidden or not (`_factsHidden()`), angular unit, random seed frame (`_randomFrame`), `isVerifying`, effects registry (`_evaluationEffects`) | Each is a setting that changes a value without a state event |

## 4. Gaps and overlaps that are not fixed

- **Several stamps for one question.** The caches answer "is this value still
  valid" with different stamps: `_cacheGeneration()` (`_sgn`, `_type`,
  `_eagerSource`, `FACTOR_MEMO`), world version plus dependency snapshot (the
  element, facet, slice and stored-value memos, the `Limit` probes), a
  structural key with no version (the contour memos, the approximations), and
  the `Map` record's own list of stamps. An audit could reduce these to two or
  three shared helpers.
- **Keys that do not see a redefinition.** The world version does not move
  when an extension replaces an `evaluate` handler. The contour memos now add
  `_definitionVersion`. Other caches keyed on the world version with a
  dependency snapshot depend on the snapshot to see a new binding; whether
  every one of them sees an in-place extension was not checked.
- **An extension does not reach expressions boxed before it** (ROADMAP
  CE-615, for a user decision). `ce.declare(name, patch, { extend: true })`
  installs a new definition object; an expression boxed before it is bound
  to the old definition object and keeps evaluating with the old handlers.
  The cause is the binding of the expression to the definition object, not a
  memo, so no cache stamp can fix it.
- **The approximations of the comparisons** (`compare.ts`) have no version in
  their key and store only values whose symbols are constants. A constant
  whose value holds an operator that is later redefined would keep its old
  approximation. No test reaches this.
- **`builtinOperatorDefinition`** (`compilation/base-compiler.ts`) treats any
  binding in the system scope as built in, so an operator of a custom library
  can pass the compiler's fold requirement for `Map`. The new guard of the
  `Map` cache covers the cache, but the classification is unchanged.
- **An explicit `compile()`** folds a constant host operator into its code.
  This is a snapshot by design, but it is not stated in the user docs.
- **The finiteness read of a lazy view** has two defences against an
  unstated host source (the count is sampled before the eligibility test, and
  each use of a host-derived shared value counts the host code again). The
  test of this case fails only when both are removed.
- **Static-property hooks** (`sgn`, `type`, `eq`, and the descriptive
  collection handlers) are trusted to describe the operator. A host that
  answers them from outside state gets cached answers. This is the documented
  contract, not checked at run time.
