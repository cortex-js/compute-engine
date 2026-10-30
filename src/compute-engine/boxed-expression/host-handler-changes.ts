/**
 * Host code and the memos of evaluated results.
 *
 * An operator that the host declares (with `ce.declare()`, in a library
 * passed to the constructor, with `ce.loadLibrary()`, or a JavaScript
 * function assigned with `ce.assign()`) is pure by default
 * for the effects model, but no memo keeps a result that depends on it
 * unless the host states its purity (user decision 2026-10-28, ROADMAP
 * CE-601): its handlers are code that the engine cannot read, which can read
 * engine state by name (`ce.symbol('x').value`), keep its own state, or
 * change state that an expression reads.
 *
 * ONE count implements the rule for every memo (`uncachedHostCallCount()`).
 * It moves (`noteUncachedHostCall()`):
 *
 * - at each evaluation of an application of a host operator that does not
 *   state its purity (`BoxedFunction._isUncachedHostOperator`), on the
 *   synchronous and on the asynchronous route;
 * - at each call of a collection handler of such an operator, and of a
 *   symbol that the host declares with collection handlers, including each
 *   step of an iterator (`withHostCollectionHandlers()`,
 *   `shared-evaluation-memo.ts`). The handlers that describe the collection
 *   (`isCollection`, `isLazy`, `isEnumerable`, `eltsgn`, `elttype`) compute
 *   no value and are not counted;
 * - at each call of a host callback of a protocol implementation
 *   (`ce.declareProtocolImplementation()` with `{ host: f }`: a function, a
 *   getter or a setter; `invokeImplementation`, `engine-protocols.ts`);
 * - at each call of a `subscriptEvaluate` handler that the host gives
 *   (`Subscript`, `library/core.ts`): a value definition cannot state its
 *   purity. The handlers that the engine makes for a sequence are not host
 *   code (`markEngineSubscriptHandler()`);
 * - at each call of a handler of a host operator that states its purity
 *   (`evaluate`, `evaluateAsync`, or a collection handler) during which the
 *   persistent evaluation version of the engine moved: the handler changed
 *   state (`withHostHandlerCall()`, `shared-evaluation-memo.ts`).
 *
 * Every memo that keeps an evaluated result reads the count before a
 * computation and does not store the result when the count moved:
 *
 * - the memo of shared evaluations (`shared-evaluation-memo.ts`);
 * - the memo of the applications of pure function literals
 *   (`validApplicationMemo`, `function-utils.ts`);
 * - the memo of the value of a lazy collection or an inert expression
 *   (`BoxedFunction._memoizedLazyCollectionValue` and its asynchronous
 *   twin);
 * - the memo of the elements of a collection (`collection-element-memo.ts`);
 * - the memo of the `count`, `isEmpty` and `isFinite` of a collection
 *   (`BoxedFunction._memoizedFacet`);
 * - the evaluated value that `at()` reads for a function expression with no
 *   collection handlers (`BoxedFunction._materializedAt`);
 * - the memo of the bounds of a slice (`sliceBounds`,
 *   `library/collections.ts`);
 * - the memo of the value of a symbol
 *   (`BoxedSymbol._memoizedStoredValue`);
 * - the memo of the terms of a sequence (`sequence.ts`);
 * - the memos of exact zeros and exact complex parts (`symbolic/contour.ts`);
 * - the memo of the approximations of the comparisons (`compare.ts`);
 * - the compiled probes of `Limit` (`symbolic/limit.ts`);
 * - the compiled functions of `Map` (`library/map-auto-compile.ts`);
 * - the values of eager sources that a finiteness read evaluates and shares
 *   with the operand step (`evaluateEagerSource`, `eager-source-values.ts`):
 *   a value computed with host code is kept for the top-level evaluation
 *   that computed it only (`hostKeptByEngine`, by evaluation number), for
 *   every consumer of the same source node in that evaluation, and each use of it counts the host code again, since
 *   the use runs no host code that an enclosing memo could see.
 *
 * The other hooks of a definition (`canonical`, `type`, `sgn`, `eq`, `neq`,
 * `cmp`, `even`, `canEnumerate`, `elementCount`, `derivative`, `compile`,
 * and the function `value` of a constant, called when the definition is
 * made and after a change of configuration) describe the operator or the
 * symbol: the caches that keep their answers do not read the count.
 *
 * Two caches need no check. The memo of factorizations (`FACTOR_MEMO`,
 * `factor.ts`) finds a candidate root with `.N()`, which can run host code,
 * but keeps a factor only after an exact polynomial division confirms it,
 * so the stored factorization does not depend on a value that the host code
 * returned. The cache of folded interval code (`FOLDED_INTERVAL_CODE`,
 * `compilation/interval-javascript-target.ts`) maps a code string that the
 * compiler made to its folded form: no host code runs to make it.
 *
 * The definitions of the standard libraries are not host code. They are
 * marked when they are made, while the engine installs the standard
 * libraries (`withStandardLibraryInstall()`, `engine-library-bootstrap.ts`):
 * the mark is set on the definition the standard library made, so a custom
 * library that tries to define a standard name, or a declaration that reuses
 * a standard definition under another name, does not change it. An
 * extension of a standard operator that keeps its `evaluate`,
 * `evaluateAsync` and collection handlers is made under the same mark
 * (`declareFn`, `engine-declarations.ts`), and so are the types that the
 * constructor declares.
 *
 * The count is for the process, not for one engine: an evaluation on one
 * engine stops a store on another, which is only a missed store. It only
 * increases.
 *
 * This module imports nothing, so that each module can import it with no
 * dependency cycle.
 */

let uncachedHostCalls = 0;

/** The number of the evaluations of host code that a memo must not keep a
 * result across. */
export function uncachedHostCallCount(): number {
  return uncachedHostCalls;
}

/** Count an evaluation of host code that a memo must not keep a result
 * across. */
export function noteUncachedHostCall(): void {
  uncachedHostCalls += 1;
}

let standardLibraryInstalls = 0;

/** Run `f` while the engine installs a standard library: an operator
 * definition made during `f` is a definition of the standard library
 * (`isInstallingStandardLibrary()`). */
export function withStandardLibraryInstall<T>(f: () => T): T {
  standardLibraryInstalls += 1;
  try {
    return f();
  } finally {
    standardLibraryInstalls -= 1;
  }
}

/** Is a standard library being installed now? */
export function isInstallingStandardLibrary(): boolean {
  return standardLibraryInstalls > 0;
}

/** The `subscriptEvaluate` handlers that the engine made: the handler of a
 * sequence (`ce.declareSequence()`), and the handlers that the engine
 * installs while it parses or declares a sequence. Any other
 * `subscriptEvaluate` handler is host code. */
const engineSubscriptHandlers = new WeakSet<object>();

/** Record that the engine made the `subscriptEvaluate` handler `handler`.
 * Returns `handler`. */
export function markEngineSubscriptHandler<T extends object>(handler: T): T {
  engineSubscriptHandlers.add(handler);
  return handler;
}

/** Is `handler` a `subscriptEvaluate` handler that the engine made? */
export function isEngineSubscriptHandler(handler: object): boolean {
  return engineSubscriptHandlers.has(handler);
}
