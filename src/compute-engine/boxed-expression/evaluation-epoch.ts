/**
 * The number of the top-level evaluation that runs now: an evaluation that
 * is not nested in another evaluation.
 *
 * A `Block` reads it to tell a new evaluation from a new run of the block
 * inside the same evaluation (an iteration of a loop body). A local that an
 * assignment makes in the block (`x ≔ x + 1` with `x` not declared) starts
 * with no value in each new evaluation, and keeps its value from one run of
 * the block to the next inside one evaluation, as a variable of a JavaScript
 * or Python function keeps its value across the iterations of a loop
 * (`sweepCanonicalizationBindings`, `library/control-structures.ts`). The
 * sticky rule of a call whose head had no value reads it too
 * (`EVALUATED_UNRESOLVED_CALLS`, `boxed-function.ts`).
 *
 * A synchronous evaluation reads the number of its engine.
 * `BoxedFunction.evaluate` gives the engine a new number when an evaluation
 * that is not nested in another one starts (`beginTopLevelEvaluation`). The
 * number is kept for each engine, so a top-level evaluation on another
 * engine (an evaluation on engine B inside a handler of an evaluation on
 * engine A) does not change the number that the evaluation on A reads.
 *
 * An asynchronous evaluation has its own number, which does not change while
 * it is pending, whatever other evaluations run on the engine between two of
 * its parts. The number is carried by the evaluation-context stack of the
 * evaluation (`EvaluateOptions._contextStack`): `BoxedFunction.evaluateAsync`
 * gives a new asynchronous evaluation its own copy of the stack
 * (`beginAsyncEvaluation`), each synchronous part of the evaluation puts
 * that copy in place of the engine's stack while it runs
 * (`runWithEvaluationEffects`, `effects-registry.ts`), and a copy of the
 * stack that the evaluation makes to push a frame of its own carries the
 * same number (`copyContextStack`). So two asynchronous evaluations that run
 * at the same time, and a synchronous evaluation that runs while an
 * asynchronous one is pending, each read their own number.
 */
const currentEpoch = new WeakMap<object, number>();

/** The last number given, for all the engines and all the asynchronous
 * evaluations, so that two evaluations never have the same number. */
let lastEpoch = 0;

/**
 * An asynchronous evaluation, shared by all the copies of its
 * evaluation-context stack.
 */
export type AsyncEvaluation = {
  /** The number of the evaluation. */
  epoch: number;
  /** True when the host started the evaluation: it is not nested in another
   * evaluation, and it is not a statement of a program block
   * (`beginAsyncStatement`). */
  startedByHost: boolean;
  /** How many `evaluateAsync()` calls of this evaluation are pending, the
   * call that started it included. */
  pending: number;
  /** How many of the `pending` calls are delegations: the `evaluateAsync()`
   * of an expression that is not canonical evaluates its canonical form in
   * its place (`delegateEvaluationAsync`, `boxed-function.ts`). */
  delegated: number;
};

/** The asynchronous evaluation of each evaluation-context stack that one
 * owns. The engine's own stack has none. */
const asyncEvaluations = new WeakMap<object, AsyncEvaluation>();

/** Record the start of a synchronous top-level evaluation on `engine`. */
export function beginTopLevelEvaluation(engine: object): void {
  lastEpoch += 1;
  currentEpoch.set(engine, lastEpoch);
}

/**
 * The number of the evaluation that runs now on `engine`: the number of the
 * asynchronous evaluation whose context stack is in place of the engine's
 * stack, or else the number of the current (or last) synchronous top-level
 * evaluation on `engine`.
 */
export function topLevelEvaluationEpoch(engine: {
  _evalContextStack: object;
}): number {
  return (
    asyncEvaluations.get(engine._evalContextStack)?.epoch ??
    currentEpoch.get(engine) ??
    0
  );
}

/** The asynchronous evaluation that owns the context stack `stack`, if any. */
export function asyncEvaluationOf(
  stack: object | undefined
): AsyncEvaluation | undefined {
  return stack === undefined ? undefined : asyncEvaluations.get(stack);
}

/**
 * Start a new asynchronous evaluation on `engine`, and return it with its
 * own context stack: a copy of `stack`, or of the engine's stack when
 * `stack` is `undefined`.
 *
 * The evaluation is started by the host, and gets a new number, when the
 * caller gives no stack (a caller that gives one is a part of the engine,
 * never the host), no synchronous evaluation is in progress, and the
 * engine's stack is not the stack of a part of another asynchronous
 * evaluation. Otherwise it is nested (a handler started it), and it gets the
 * number of the evaluation that runs now, which it keeps after that
 * evaluation moves on to a new number.
 *
 * The test does not read the registry slot of the engine
 * (`_evaluationEffects`): a route that only puts a registry in place
 * around a part of its work (`ce.withEvaluationContext`, the asynchronous
 * evaluation of a symbol) is not an evaluation that runs. Such a route
 * starts the asynchronous evaluation itself, before it gives a stack to a
 * nested call (`BoxedSymbol.evaluateAsync`).
 */
export function beginAsyncEvaluation<T>(
  engine: { _evalContextStack: T[]; _evaluationDepth: number },
  stack: T[] | undefined
): { stack: T[]; evaluation: AsyncEvaluation } {
  const source = stack ?? engine._evalContextStack;
  const startedByHost =
    stack === undefined &&
    asyncEvaluations.get(engine._evalContextStack) === undefined &&
    engine._evaluationDepth === 0;
  let epoch: number;
  if (startedByHost) {
    lastEpoch += 1;
    epoch = lastEpoch;
  } else
    epoch =
      asyncEvaluations.get(source)?.epoch ?? topLevelEvaluationEpoch(engine);
  const own = [...source];
  const evaluation = { epoch, startedByHost, pending: 0, delegated: 0 };
  asyncEvaluations.set(own, evaluation);
  return { stack: own, evaluation };
}

/**
 * A new top-level evaluation for a statement of a program block that runs
 * asynchronously, after the first statement (`evaluateStatementsAsync`,
 * `function-utils.ts`): a copy of `stack`, the context stack of the block,
 * with a new number. An asynchronous evaluation that an earlier statement
 * started and did not await keeps the number of that statement.
 */
export function beginAsyncStatement<T>(stack: ReadonlyArray<T>): T[] {
  lastEpoch += 1;
  const own = [...stack];
  asyncEvaluations.set(own, {
    epoch: lastEpoch,
    startedByHost: false,
    pending: 0,
    delegated: 0,
  });
  return own;
}

/**
 * A copy of the context stack `stack` with `frames` pushed on it, for an
 * asynchronous evaluation that holds a frame of its own across an `await`.
 * The copy belongs to the same asynchronous evaluation as `stack`.
 */
export function copyContextStack<T>(
  stack: ReadonlyArray<T>,
  ...frames: T[]
): T[] {
  const copy = [...stack, ...frames];
  const evaluation = asyncEvaluations.get(stack);
  if (evaluation !== undefined) asyncEvaluations.set(copy, evaluation);
  return copy;
}
