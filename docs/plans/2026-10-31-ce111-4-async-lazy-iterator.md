# CE-111.4: an asynchronous iterator for lazy collections

Status: spec, revision 3 (after two dual reviews,
`docs/scratch/2026-10-31-ce111-4-async-lazy-iterator_SPEC_REVIEW.md` and
`docs/scratch/2026-10-31-ce111-4-async-lazy-iterator_SPEC_REVIEW_ROUND2.md`). The
trade-offs of section 7 were chosen by the user on 2026-10-31. Decision of
2026-10-31 (ROADMAP CE-111.4): a lazy collection gives its elements
asynchronously to the asynchronous readers.

## 1. The defect

`AsyncOnly` is declared `(number) -> number` and has only an `evaluateAsync`
handler, which returns `x + 5` (setup in
`test/compute-engine/apply-evaluate-async.test.ts`). The element of a lazy view
is computed by the synchronous iterator of the view: `mapIteratorImpl()`
(`library/collections.ts`) applies the callback with the synchronous `apply()`.
So, under `evaluateAsync()`, the callback never awaits, and every reader that
gets the elements from `each()` reads the synchronous elements.

Measured on the main tree over commit
`ddf9650f0a1fb1aa4e9c4fd1bc82de6ccdc1e8bd` (with the uncommitted work of the
peer sessions) with `await ce.box(…).evaluateAsync(options)`. "Proposal" is the
value under the rule of section 2 and the choices of section 7.

| Input                                                      | Options                 | Today                                        | Proposal                     |
| ---------------------------------------------------------- | ----------------------- | -------------------------------------------- | ---------------------------- |
| `Map(AsyncOnly, [1, 2])`                                   | none                    | the view; prints `[AsyncOnly(1), AsyncOnly(2)]` | `List [6, 7]` (T1)        |
| `Map(y ↦ y + 1, [1, 2])`                                   | none                    | the view; prints `[2, 3]`                    | `List [2, 3]` (T1)           |
| `Take(Apply(y ↦ AsyncOnly(y), Range(1, 100000)), 2)`       | none                    | the view; prints `[AsyncOnly(1), AsyncOnly(2)]` | `List [6, 7]` (T1)        |
| `Map(y ↦ String(AsyncOnly(y)), [1, 2])`                    | `materialization: true` | `["AsyncOnly(1)", "AsyncOnly(2)"]`           | `["6", "7"]`                 |
| `Take(Map(AsyncOnly, Range(1, ∞)), 3)`                     | `materialization: true` | `[6, 7, 8]`                                  | `[6, 7, 8]`, 3 calls         |
| `FlatMap([1, 2], y ↦ [AsyncOnly(y)])`                      | `materialization: true` | `[AsyncOnly(1), AsyncOnly(2)]`, 0 calls      | `[6, 7]`, 2 calls            |
| `Tuple(Map(AsyncOnly, [1, 2]), 3)`                         | none                    | `(Map(AsyncOnly, [1, 2]), 3)`                | `([6, 7], 3)` (T1)           |
| `At(Tabulate(i ↦ Counted(i), 1000), 1000)`                 | none                    | `1005`, 1 call                               | `1005`, 1 call               |
| `Map(AsyncOnly, Range(1, 1000))`                           | `materialization: [2, 2]` | `[6, 7, …, 1004, 1005]`, 4 calls           | the same, 4 calls            |
| `Sum(Map(AsyncOnly, [1, 2, 3]))`                           | none                    | `AsyncOnly(1) + AsyncOnly(2) + AsyncOnly(3)` | `21`                         |
| `Mean(Map(AsyncOnly, [1, 2, 3]))`                          | none                    | unevaluated                                  | `7`                          |
| `Find(Map(AsyncOnly, [1, 2]), y ↦ y > 6)`                  | none                    | `AsyncOnly(2)`                               | `7`                          |
| `Union(Map(AsyncOnly, [1, 2]), [9])`                       | `materialization: true` | `Set(9, AsyncOnly(1), AsyncOnly(2))`         | `Set(9, 6, 7)`               |
| `Filter([1, 2, 3], y ↦ AsyncOnly(y) > 7)`                  | none                    | error "Filter predicate must return…"        | `List [3]` (T1)              |
| `Length(Filter(Range(1, 10), y ↦ AsyncOnly(y) > 10))`      | none                    | throws the same error                        | `5`                          |
| `First(Filter(Range(1, ∞), y ↦ AsyncOnly(y) > 10))`        | none                    | throws the same error                        | `6`                          |
| `At(Map(AsyncOnly, Range(1, 10)), 3)`                      | none                    | `AsyncOnly(3)`                               | `8`, 1 call                  |
| `Length(Map(Counted, Range(1, ∞)))`                        | none                    | `+∞`, 0 calls                                | `+∞`, 0 calls                |
| `Take(Reverse(Map(Counted, Range(1, 100000))), 1)`         | `materialization: true` | `[100005]`, 1 call                           | `[100005]`, 1 call           |
| `Sum(Sum(Map(y ↦ AsyncOnly(y + k), [1, 2])), k, 1, 2)`     | none                    | `2AsyncOnly(3) + AsyncOnly(2) + AsyncOnly(4)` | `32`                        |

`Counted` is an operator with a synchronous `evaluate` handler that counts its
calls. The `String` row shows why the current re-evaluation of the elements in
`materializeAsync()` is not sound: the synchronous walk applies `String` to the
held call `AsyncOnly(1)`, and re-evaluating the string `"AsyncOnly(1)"` keeps
it. A body whose operators await their operands (`If(AsyncOnly(y) > 6, 1, 0)`)
already gives the right value today, because re-evaluation reaches the held
call.

## 2. The rule

On the asynchronous route, every reader that gets the elements of a collection
gets them from one function, `eachAsync(collection, options)`, which returns an
`AsyncWalk`: an `AsyncIterable<Expression>` with the walk-local record of
rule 7. A reader reads one element with `atAsync(collection, index, options)`.

1. **Values.** Each element is the value that the view gives when every
   callback it applies is applied on the asynchronous route (`apply()` with
   `awaitStatements: true` and the `_effects`, `_contextStack`,
   `_precisionWindow` and `signal` of `options`) and awaited. A predicate, a key
   (`ChunkBy`), an accumulator (`Scan`, `Iterate`, `FixedPoint`) and an inner
   collection (`FlatMap`) are awaited before the view decides what to give next.
   When `apply()` returns a value that is not a promise (section 6, "One
   suspended frame"), that value is the element.
2. **Demand.** Elements are computed one at a time, in the order of the
   synchronous walk. For each callback view, the callback is applied to the same
   source positions, in the same order, as on the synchronous route: no more
   calls, no other positions. A view that reads its source by position on the
   synchronous route (`Reverse`, `RotateLeft`, a negative `Take`) reads it with
   `atAsync()` on the asynchronous route.
3. **Shortcut.** `eachAsync()` asks the collection's `asyncIterator` handler
   for an iterator. A handler can return `undefined`: then the collection is
   read with its synchronous `each()` and `at()`, with no `await` per element.
   A kind-C view always returns an iterator. A kind-P view returns `undefined`
   when every source returns `undefined`. A kind-S collection has no handler.
   A custom collection decides for itself. So a custom view with its own
   asynchronous handler is never bypassed, and a tree with no callback view
   costs no `await`.
4. **Pacing.** The deadline is the deadline of the evaluation
   (`ce._deadlineFrame` and the time limit of `evaluateAsync()`); no walk adds
   its own. The walk checks `options.signal` and the deadline before each pull
   from a source and after each `await`. When the reader is a synchronous
   generator driven by `runAsync()` (`runWalkAsync()`, `collections.ts`), it
   yields the promise of each `next()` to its driver, which awaits it
   (`runAsync()` already accepts a thenable), and the driver owns the time
   slices: `eachAsync()` does not yield then. Otherwise the outermost
   `eachAsync()` or `atAsync()` yields to the event loop once per slice of
   16 ms. The inner levels of a nested walk never yield on their own.
5. **Context.** Every synchronous step of the walk (a pull from a source, the
   start of an application, the test of a predicate result) runs inside
   `ce.withEvaluationContext(options, …)`: the host capability registry, the
   evaluation-context stack (the scopes of the enclosing scoped operators) and
   the working precision of this evaluation. No module-level window
   (`computeBroadcastCell()`, `withAmbientDeadline()`, a transient precision) is
   open across an `await`: a step closes its window before it awaits, and the
   next step opens it again.
6. **End.** When the reader stops early (a short-circuit of `Any`, the end of a
   `Take`, an abort, an error), the walk calls `return()` on every source
   iterator it opened, as the synchronous walk does.
7. **Same outcomes as the synchronous route.** A callback error that is not a
   cancellation reaches the reader as it does on the synchronous route: as an
   error value in the cell, or as the thrown error, whichever the synchronous
   route gives for the same reader. An `iteration-limit-exceeded` that a
   synchronous handler turns into an undecided answer (`Filter.at`, `contains`,
   `count`) gives the same undecided answer.
8. **Incomplete walks.** The count of incomplete walks
   (`incompleteWalkCount()`, `incomplete-walks.ts`) belongs to the process, and
   a reading before an `await` and after it can see the walks of another
   evaluation (header of `incomplete-walks.ts`). So the asynchronous walk does
   not read it across an `await`. Each `AsyncWalk` keeps its own record,
   `missedElements` and `failedWalkError`. It sets them from measurements of
   its synchronous steps only (a pull from a synchronous source, the splice of
   an inner collection), each step measured on its own, as
   `measureWalkFailure()` does (`boxed-function.ts`). A nested walk adds its
   record to the record of the walk that reads it. A reader that the
   synchronous route makes stay unevaluated after an incomplete walk reads
   this record (section 4, items 1, 4, 5 and 6, and T1), not the count. A
   walk also calls `noteIncompleteWalk()` once when it ends with a missed
   element, so that a synchronous reader around it sees it as today.
   Limit: this record covers the pulls of the walk, not the walks that a
   callback makes after its own first `await` (a predicate that walks a
   collection with no known elements after it awaited). Those are still read
   from the shared count, which cannot be read across an `await`. ROADMAP
   CE-111.5 records the same limit for `IndexWhere`; its fix (a count for each
   evaluation context) fixes this case too, and is not part of this change.

## 3. Which operators get the asynchronous iterator

The census is every `iterator` handler in `src/compute-engine` (72 handlers at
commit `ddf9650f0`). Each operator is in one kind.

- **Kind C, views that apply a callback per element.** `Map`, `Filter`, `Scan`,
  `TakeWhile`, `DropWhile`, `FlatMap`, `Tabulate`, `Fill`, `ChunkBy`, `Iterate`,
  `FixedPoint`, `Comprehension`. Each gets an `asyncIterator` handler. `Map`,
  `Tabulate` and `Fill` also get `atAsync` (one application at the position,
  as their synchronous `at`), and `Filter` gets `containsAsync` (the source
  membership is read synchronously, then the predicate is applied to the
  target only, as the synchronous `contains`). Every other synchronous facet of
  a kind-C view that applies the callback at chosen positions only gets the
  same kind of twin; the implementation lists them.
- **Kind P, views over one or more sources, with no callback.** `Take`, `Drop`,
  `Rest`, `Most`, `Slice`, `Reverse`, `RotateLeft`, `RotateRight`, `DeleteAt`,
  `Insert`, `ReplaceAt`, `Append`, `Join`, `ListJoin`, `DictionaryFrom`, `Zip`,
  `Cycle`, `Repeat`, `Dedup`, `Differences`, `Partition`, `SlidingWindow`, the
  restricted view of `When` (`whenCollectionHandlers()`), `Union`,
  `Intersection`, `SetMinus`, `SymmetricDifference`, `Complement`,
  `CartesianProduct`, `PowerSet`, `Permutations`, `Combinations`. Each gets an
  `asyncIterator`, and each that reads a source by position gets `atAsync`. Both
  are used only when the source tree holds a kind-C view (rule 3).
- **Kind S, sources.** `List`, `Tuple`, `Set` literals, `Range`, `Interval`,
  `Linspace`, the number sets (`Integers`, `Primes`, `RealNumbers` and the
  others in `library/sets.ts`), `QuotientRing`, `EmptySet`, strings,
  dictionaries. They keep the synchronous `each()`. A symbol whose value is a
  collection (`defaultCollectionHandlers()`) reads that value with
  `eachAsync()`.

Shared iterator code: `refusingUnindexedSource()` (18 kind-P and kind-C
operators), `windowedCollectionOps()` and `JOIN_COLLECTION_HANDLERS` each get
one asynchronous form, so their operators do not each need their own.

The asynchronous twins (T3) share their pure helpers (position and count
arithmetic, deduplication keys) with the synchronous iterators.

## 4. Which readers use it

1. **Materialization.** `materializeAsync()` and `materializeLazyResultAsync()`
   (`boxed-function.ts`) take their elements from `eachAsync()` for
   `materialization: true`, and from `eachAsync()` for the head and `atAsync()`
   for the tail for `materialization: n` and `[head, tail]`. An element that
   the walk computed is not evaluated again. A nested lazy element is evaluated
   with the `materialization` option, on the asynchronous route.
2. **The checks before the element loop.** The facets that
   `materializationSteps()` reads first (`viewOverListedSource()`,
   `isEmptyCollection`, `isEnumerableCollection`, `count`) and that run a
   callback (`Filter`, `TakeWhile`, `DropWhile`, `FlatMap`, `ChunkBy`,
   `Iterate`, `FixedPoint` and a kind-P view over one of these) are computed
   from the asynchronous walk. A facet that runs no callback (the count of a
   `Map`, a `Take`, a `Reverse`) is read synchronously. As on the synchronous
   route (`RepeatableWalk`, `walkDecidesEmptiness()`), one walk is shared: the
   emptiness decision, the count to the cap and the element loop read one
   buffered `AsyncWalk`, so each callback is applied once per position. The
   count walk keeps its handling of `iteration-limit-exceeded`.
3. **Eager branches of a listed view.** `FlatMap`'s `evaluate` handler (which
   walks its source with `each()` when `materialization` is set) gets an
   `evaluateAsync` twin built on `eachAsync()`, with the same checks of an
   infinite inner collection and of `maxCollectionSize`. `ChunkBy` already has
   an `evaluateAsync` handler (the CE-111.3 work, commit `07b9f66fa`);
   its `each()` read becomes `eachAsync()`.
   `evaluateStringPreservingCollection()` gets an asynchronous form for a view
   whose tree holds a kind-C view (`Filter` over a string).
4. **Walk readers with an `evaluateAsync` handler.** `Sum`, `Product`
   (`arithmetic.ts`), `Any`, `All`, `MaxBy`, `MinBy`, `ArgMax`, `ArgMin`,
   `Reduce`, `Dedup`, `List`, `Set`, `CountIf`, `Ordering` (`collections.ts`),
   `Loop` over a lazy domain, the readers to which the CE-111.3 work (commit
   `07b9f66fa`) added awaited callbacks (`Find`, `Sort`, `GroupBy`,
   `Partition`, `ChunkBy`, `Position`, `IndexWhere`; `Fold` is rewritten to
   `Reduce` when it is canonicalized), and the eager
   branch of `Apply` (`applyLiteralMapped()` and `zipBroadcast()`,
   `library/core.ts`), which reads its rows with `eachAsync()` when an argument
   tree holds a kind-C view. Each replaces its `each()` read of a collection
   operand with `eachAsync()`. A walk that returns or keeps a source element
   (`Find`, `Sort`, `MaxBy`) then returns the awaited element.
5. **Positional and count readers.** `At`, `First`, `Second`, `Third`, `Last`,
   `Length`, `Count`, `IsEmpty`, `Contains`, `IndexOf`. Each gets an
   `evaluateAsync` handler, used only when the operand tree holds a kind-C view.
   The handler reads the facet synchronously when the facet runs no callback
   (`Length(Map(f, Range(1, ∞)))` is `+∞` with no call of `f`), reads one
   element with `atAsync()` when the view has it, and otherwise walks with
   `eachAsync()` (`Length(Filter(…))`, `First(Filter(…))`).
6. **Readers that read every element and have no asynchronous handler.** A
   named list of operators whose synchronous handler reads every element of a
   collection operand before it answers: `Mean`, `Median`, `Mode`,
   `Variance`, `StandardDeviation`, the other statistics that call
   `collectData()` (`statistics.ts`), `Max`, `Min`, `Tally`, `Total`, `Dot`.
   The implementation completes the list from the code; an operator goes on it
   only when its synchronous handler reads every element or stops at the first
   failed element. On the asynchronous route, before such a handler runs, each
   operand that is a finite lazy collection with an asynchronous iterator
   (rule 3) is materialized with `eachAsync()`, up to `engine.maxCollectionSize`
   elements. The materialization stops after the first element that is an
   error value, as `collectData()` stops at the first failed cell, so no
   later callback runs. A larger or infinite operand stays the view, and the
   handler reads it synchronously, as today: this limit is documented with the
   example `Mean(Map(AsyncOnly, Range(1, 10^6)))`. Not on the list: a user
   function (it receives the view: `g(xs) := First(xs)` applies the callback
   once), a `lazy` operator (it reads its operands itself), and a kind-P view
   or builder with an `evaluate` handler (`Union`, `SetMinus`, `ListJoin`,
   `ListFrom`, `TupleFrom`), which reads its sources through section 3.

## 5. The asynchronous handlers

Three optional collection handlers are added to the public types (T2 (a)):

- `asyncIterator?: (collection: Expression, options: EvaluateHandlerOptions) =>
  AsyncIterator<Expression, undefined> | undefined` in
  `BaseCollectionHandlers`. `undefined` means "read me synchronously" (rule 3).
- `containsAsync?: (collection: Expression, target: Expression, options:
  EvaluateHandlerOptions) => Promise<boolean | undefined>` in
  `BaseCollectionHandlers`.
- `atAsync?: (collection: Expression, index: number | string, options:
  EvaluateHandlerOptions) => Promise<Expression | undefined>` in the indexed
  collection handlers.

A collection with no `asyncIterator` is read with its synchronous `each()` on
the asynchronous route, as today; a collection with no `atAsync` or
`containsAsync` is read with `eachAsync()` up to the index or the match.

A host collection handler is wrapped so that the memos do not keep a result
that depends on host code that does not state its purity
(`withHostCollectionHandlers()`, `COLLECTION_HANDLER_NAMES`,
`shared-evaluation-memo.ts`; rule in `host-handler-changes.ts`). The three
handlers are added to that list. Their wrapper counts the call from its start
to the end of the promise that it returns (and, for an iterator, of each
`next()`, `return()` and `throw()`), as the host `evaluateAsync` call is
counted with `Promise.resolve(answer).finally(…)` in `boxed-function.ts`. Their documentation in `types-definitions.ts`
states rules 1, 2 and 5 as the contract of a handler. `eachAsync()` and
`atAsync()` are internal functions; a user reads a collection on the
asynchronous route through `evaluateAsync()`.

## 6. Hard cases

- **Nested lazy views.** `Map(AsyncOnly, Filter(Range(1, 10), p))`: the outer
  `Map` pulls each element of the `Filter` through `eachAsync()`, so the
  predicate is awaited before the outer callback runs. The Map lowering
  (`lowerMapSpine()`, `map-lowering.ts`) and the compiled element function
  (`mapAutoCompileRunner()`) are not used on the asynchronous route. A
  synchronous run cannot be checked afterwards: `String(AsyncOnly(1))` gives a
  string with no held call left. A test before the run is not sound either:
  the compiler reads custom `compile` handlers of operators that have no
  `evaluate` handler (`compiler-core.ts`). Cost: a numeric `Map` under
  `evaluateAsync()` is interpreted, not compiled. A sound test that keeps the
  compiled route (for example, every operator in the callback, and in the body
  of every function it calls, has an `evaluate` handler) is a separate task,
  done when the user asks for it.
- **`Take` of an infinite source.** `Take(Map(AsyncOnly, Range(1, ∞)), 3)`
  pulls three elements of the `Map`, calls `return()` on it, and never computes
  a fourth element (rule 2). `TakeWhile` stops at the first awaited `False`.
  `First(Filter(Range(1, ∞), y ↦ y < 0))` stays unevaluated, as today, when the
  walk reaches `iterationLimit` (rule 7); a cancellation or the deadline throws.
- **Abort.** An abort between two elements is seen before the next pull (rule
  4). A callback that is suspended in the engine (`evaluateStatementsAsync()`)
  checks the signal itself and throws a `CancellationError`. A host
  `evaluateAsync` handler that awaits its own promise is not interrupted:
  cancellation is cooperative (`docs/TIMEOUT-MODEL.md` §6.4). The walk checks
  the signal when that promise settles and throws before it gives the element.
  In every case the walk calls `return()` on its sources and commits no
  partial element memo. The error is the `CancellationError` that
  `evaluateAsync()` throws today for an aborted walk.
- **The evaluation context across an `await`.** The callback of
  `Sum(Sum(Map(y ↦ AsyncOnly(y + k), [1, 2])), k, 1, 2)` reads the index `k`
  of the outer `Sum`. Each step after an `await` must see the scope that binds
  `k` (rule 5). The `withEvaluationEffects()` wrapper (`effects-registry.ts`)
  does this for a synchronous generator driven by `runAsync()`; the
  asynchronous iterator calls `withEvaluationContext()` around each of its
  synchronous steps.
- **The element memo (T4 (a)).** A kind-C view keeps the elements of a complete
  synchronous walk (`elementMemo`, `collection-element-memo.ts`), and
  `docs/RANDOMNESS-MODEL.md` ("One instance, one draw set") makes two complete
  walks of one impure view give the same draws. The asynchronous walk keeps a
  second memo on the same instance, with the same size cap. A complete
  asynchronous walk serves the next asynchronous walk from it. The two memos
  are never read across: an element of the asynchronous walk (`6`) can differ
  from the synchronous one (`AsyncOnly(1)`).
  *Dependencies across an `await`.* The synchronous memo records the reads of
  mutable objects around each pull (`recordingStream()`,
  `collection-element-memo.ts`) and treats a change made inside a pull as the
  walk's own. Neither works across an `await`: a collector open across a
  suspension collects the reads of another evaluation, and a write by another
  evaluation during the `await` looks like the walk's own. So the asynchronous
  memo opens the collectors and the store guard (`beginStoreGuard()`) around
  each synchronous step only, never across an `await`, and samples, before
  and after each `await`, the version axes, the world epoch, `objectReadCount()`
  and the count of uncached host calls (`host-handler-changes.ts`). A walk in
  which any of these moved across an `await` is not committed: the walk cannot
  tell its own changes from those of another evaluation. The asynchronous
  lazy-value memo uses the same kind of rule (`objectReadCount()` sampled
  around the computation, `boxed-function.ts`). The rules that make a host
  operator with no stated purity prevent a store (`host-handler-changes.ts`)
  apply as on the synchronous route.
  *Consequence for an impure view.* The rule "two readers of the same list — a
  plot and a mean — see the same numbers" (`docs/RANDOMNESS-MODEL.md`) holds
  on each route, not across the routes: `Map(u ↦ Random(), Range(1, 1000))`
  read by a plot with `each()` and by `Mean` under `evaluateAsync()` draws
  twice and gives two different sets of numbers. So does the `toString()` of a
  view of more than 100 elements that `evaluateAsync()` returns, against the
  asynchronous reader that read it. The randomness model gets this rule and
  this example, and a test pins it, so that a later change is a decision.
- **One suspended frame per function literal.** An application with awaited
  statements waits when another application of the same literal is suspended
  (`blockingAsyncApplication()`). It is synchronous when an argument has a free
  symbol, or in the cases of ROADMAP CE-111.2 (a recursive body). Rule 1 then
  takes the synchronous value as the element; these cases keep the defect and
  are listed in CE-111.2. Rule 2 computes elements one at a time, so two
  elements of one view never overlap; in `Map(g, Map(g, xs))` the inner element
  is complete before the outer application starts. Two concurrent
  `evaluateAsync()` calls that walk one view have their own iterators; their
  applications of one literal are serialized by the same blocking rule.

## 7. Trade-offs chosen by the user (2026-10-31)

- **T1 (b).** On the asynchronous route, the final result of `evaluateAsync()`
  with `materialization` not given, when it is a lazy view with an
  asynchronous iterator (rule 3) and a count bound (below) of at most
  `MAX_SIZE_EAGER_COLLECTION` (100, `collection-utils.ts`), is materialized
  with `eachAsync()`. The result follows the kind rules of
  `materializationSteps()`: a `List`, a `Set` for a set-kind view, a
  `Dictionary` for a dictionary-kind view. The same applies to a view that is
  an element of a container literal result, as `lazyResultSteps()` does for
  the `materialization` option (`Tuple(Map(AsyncOnly, [1, 2]), 3)` gives
  `([6, 7], 3)`). This applies to the final result only, not to an operand:
  the operand of `Take(Map(f, Range(1, 100)), 1)` is not materialized, and `f`
  is applied once.
  The *count bound* is an internal function, `countBound()`: the `count` when
  it is known; for `Filter`, `TakeWhile`, `DropWhile`, `Dedup` and `ChunkBy`,
  the bound of the source; for `Take(·, n)`, the smaller of `n` and the bound
  of the source; for the other kind-P views that do not add elements, the
  bound of the source; otherwise (`FlatMap`, `Iterate`, `FixedPoint`, a custom
  view) none, and the view stays a view. `materialization: false` keeps
  the view. A view with more elements, or an unknown or infinite count, stays
  the view: a synchronous read of it later (`toString()`, `.json`) cannot
  await, and shows the synchronous elements. This also changes the
  asynchronous result of a view with no asynchronous callback (`Map(y ↦ y + 1,
  [1, 2])` becomes `List [2, 3]`). The number of changed tests and snapshots is
  measured during the implementation and reported.
- **T2 (a).** `asyncIterator`, `atAsync` and `containsAsync` are public,
  optional handlers (section 5). The user chose (a) for `asyncIterator`; the
  other two were added after that choice, by the review, and follow it.
- **T3 (a).** An asynchronous twin of each iterator (section 3); the
  synchronous iterators do not change.
- **T4 (a).** The asynchronous walk keeps its own element memo (section 6).
- **T5, the recommendation.** The positional and count readers as in section 4,
  item 5.

## 8. Not in this change

- **A held call of an operator with only an `evaluateAsync` handler as an
  undecided predicate on the synchronous route.** `Length(Filter(Range(1, 10),
  y ↦ AsyncOnly(y) > 10))` throws on `evaluate()`, because `AsyncOnly(1) > 10`
  has no unknown symbol and is read as a malformed predicate
  (`predicateResultError()`, `collections.ts`). This change does not touch the
  synchronous route. The question is reported to the user.
- **Elements computed in parallel** (`Promise.all` over a window). Rule 2 keeps
  the order of effects and the one-frame rule of CE-111.2.
- **A compiled `Map` on the asynchronous route** (section 6, first case).

## 9. Order of work

The CE-111.3 work (the awaited callbacks of the eager walk readers; the
ROADMAP entry is removed because it is fixed) is committed in `07b9f66fa4253abc92e8ab941a04a9edd0970800` ("Eager collection
operators await their callback under evaluateAsync()"). This change replaces
the `each()` reads of those readers. Check at the start which readers of
section 4, item 4 have an `evaluateAsync` handler at that commit; a reader
that still has none gets one in step 4.

Steps, each with its tests: (1) `eachAsync()`, `atAsync()`, the handler types
and the kind-C iterators; (2) materialization and its checks (section 4,
items 1 to 3) and T1; (3) the kind-P iterators; (4) the walk, positional and
other readers (items 4 to 6); (5) the element memo.

## 10. Definition of done

- A new `test/compute-engine/lazy-collection-evaluate-async.test.ts` with: each
  row of the table of section 1; one test per kind-C and kind-P operator over a
  kind-C source; for `Take` of an infinite `Map`, for `Length(Map(…))` and for
  `Take(Reverse(Map(…)), 1)`, the count of callback calls (3, 0 and 1); an abort
  while an engine callback is suspended, and while a host promise is pending
  (a `CancellationError`, no element after the abort); the `Sum` index case;
  `First(Filter(Range(1, ∞), y ↦ y < 0))` unevaluated; a callback error per
  reader kind, compared with the synchronous route; two complete asynchronous
  walks of `Map(u ↦ Random() + AsyncPure(u), [1, 2])` that give the same
  values, where `AsyncPure` is `AsyncOnly` declared with `pure: true` (a host
  operator with no stated purity prevents the store, tested separately); a
  synchronous and an asynchronous walk of one `Map(u ↦ Random(), Range(1,
  10))` that give different draws (section 6); a concurrent `ce.assign('a', …)`
  while the callback of `Map(u ↦ a + AsyncPure(u), [1, 2])` is suspended, then
  a second asynchronous walk that sees the new `a`; two interleaved
  evaluations, one of which reads an incomplete walk
  (`Sum(Take(FlatMap([1, 2], x ↦ Join([AsyncOnly(x)], v)), 3))` with a `v`
  that has no value stays unevaluated) while the other completes; a count of
  calls for `Filter([1, 2, 3], y ↦ AsyncOnly(y) > 0)` with `materialization:
  true` (3), for `At(Tabulate(…), 1000)` (1) and for `Contains(Filter(Range(1,
  100000), p), 100000)` (1); `Mean` over a view with a failed element in
  position 2 (no call after position 2); a custom collection whose
  synchronous and asynchronous elements differ; a host collection with an
  impure `asyncIterator` (no memo stores); `Filter` over a dictionary (a
  `Dictionary` under T1); `ChunkBy` over a small and a large source; `Filter`
  over a string; `materialization` `true`, `n` and `[2, 2]`; a free-symbol
  argument and a recursive callback (the synchronous value, as documented).
- The synchronous results of the same inputs do not change.
- `docs/COLLECTIONS-MODEL.md` gets a section on the asynchronous route (rules
  1 to 7, the kinds, T1); `docs/RANDOMNESS-MODEL.md` gets the sentence of
  section 6; the CHANGELOG gets an entry; ROADMAP CE-111.4 is closed, and the
  `FlatMap` part of CE-111.1 and the limits of section 6 and section 8 are
  recorded in CE-111.
