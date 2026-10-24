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
import type { DeadlineFrame } from '../../common/interruptible.js';

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
  /** The deadline frame in force when the evaluation started: the frame of
   * the `ce.withTimeLimit()` span (or step budget) that encloses the
   * `evaluateAsync()` call. A span is armed and restored around a
   * synchronous call, so it has closed by the time the evaluation resumes
   * after its first `await`; each synchronous part of the evaluation puts
   * this frame back in place (`runWithEvaluationEffects`,
   * `effects-registry.ts`), so the time limit applies to the whole
   * evaluation. `undefined` when no span enclosed the call. */
  deadlineFrame?: DeadlineFrame;
};

/** The asynchronous evaluation of each evaluation-context stack that one
 * owns. The engine's own stack has none. */
const asyncEvaluations = new WeakMap<object, AsyncEvaluation>();

/** The deadline frame of a context stack that is a part of an asynchronous
 * evaluation but has a shorter time limit (or more step budgets) than the
 * evaluation: the stack of an `evaluateAsync(options)` call that joins a
 * pending evaluation from inside a `ce.withTimeLimit()` span
 * (`joinAsyncEvaluation`). The frame is kept here, not on the shared
 * `AsyncEvaluation`, so that it applies to that call and to the stacks
 * copied from its stack, and not to the other parts of the evaluation. */
const stackDeadlineFrames = new WeakMap<object, DeadlineFrame>();

/**
 * The frame in force when the frame `inner` is put in place while the
 * frame `outer` is already in place: the earlier time limit, and the step
 * budgets of both frames, so that a step counts against each of them.
 * Returns `outer` (or `inner`) itself when it already ends at least as
 * soon as the other one and holds all its budgets and span labels, so a
 * frame that changes nothing keeps its identity (and its stride counter,
 * `DeadlineFrame.tick`).
 */
export function mergeDeadlineFrames(
  outer: DeadlineFrame | undefined,
  inner: DeadlineFrame | undefined
): DeadlineFrame | undefined {
  if (inner === undefined || inner === outer) return outer;
  if (outer === undefined) return inner;
  const outerBudgets = outer.budgets ?? [];
  const innerBudgets = inner.budgets ?? [];
  const covers = (a: DeadlineFrame, b: DeadlineFrame) =>
    a.at <= b.at &&
    (b.budgets ?? []).every((x) => (a.budgets ?? []).includes(x)) &&
    b.spans.every((x) => a.spans.includes(x));
  if (covers(outer, inner)) return outer;
  if (covers(inner, outer)) return inner;
  const owner = inner.at < outer.at ? inner.owner : outer.owner;
  const frame: DeadlineFrame = {
    at: Math.min(outer.at, inner.at),
    spans: [
      ...outer.spans,
      ...inner.spans.filter((x) => !outer.spans.includes(x)),
    ],
  };
  if (owner !== undefined) frame.owner = owner;
  const budgets = [
    ...outerBudgets,
    ...innerBudgets.filter((x) => !outerBudgets.includes(x)),
  ];
  if (budgets.length > 0) frame.budgets = budgets;
  return frame;
}

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
  engine: {
    _evalContextStack: T[];
    _evaluationDepth: number;
    _deadlineFrame?: DeadlineFrame | undefined;
  },
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
  // The deadline frame of the asynchronous evaluation whose stack this
  // copies (a nested call made after a span closed), merged with the frame
  // of the span that encloses the call.
  const deadlineFrame = mergeDeadlineFrames(
    deadlineFrameOf(source),
    engine._deadlineFrame
  );
  const evaluation: AsyncEvaluation = {
    epoch,
    startedByHost,
    pending: 0,
    delegated: 0,
  };
  if (deadlineFrame !== undefined) evaluation.deadlineFrame = deadlineFrame;
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
  const evaluation: AsyncEvaluation = {
    epoch: lastEpoch,
    startedByHost: false,
    pending: 0,
    delegated: 0,
  };
  // A statement of the program keeps the time limit of the program.
  const deadlineFrame = deadlineFrameOf(stack);
  if (deadlineFrame !== undefined) evaluation.deadlineFrame = deadlineFrame;
  asyncEvaluations.set(own, evaluation);
  return own;
}

/** The deadline frame of the context stack `stack`: the frame of a call
 * that joined its evaluation inside a shorter span (`joinAsyncEvaluation`),
 * or else the frame that the asynchronous evaluation owning `stack`
 * captured when it started (`AsyncEvaluation.deadlineFrame`), if any. */
export function deadlineFrameOf(
  stack: object | undefined
): DeadlineFrame | undefined {
  if (stack === undefined) return undefined;
  return (
    stackDeadlineFrames.get(stack) ?? asyncEvaluations.get(stack)?.deadlineFrame
  );
}

/**
 * The context stack for an `evaluateAsync(options)` call that receives the
 * stack `stack` of a pending asynchronous evaluation, and so joins it.
 *
 * Usually `stack` itself. But when the call is made inside a
 * `ce.withTimeLimit()` (or step budget) span that ends sooner than the
 * frame of `stack`, or that has budgets this frame does not have, the span
 * has closed by the time the call resumes after its first `await`. So the
 * call gets a copy of `stack`, in the same evaluation, that carries the
 * merged frame (`mergeDeadlineFrames`): each later synchronous part of the
 * call puts that frame in place (`runWithEvaluationEffects`,
 * `effects-registry.ts`). The other parts of the evaluation keep the frame
 * of `stack`.
 */
export function joinAsyncEvaluation<T>(
  engine: { _deadlineFrame?: DeadlineFrame | undefined },
  stack: T[]
): T[] {
  const carried = deadlineFrameOf(stack);
  const frame = mergeDeadlineFrames(carried, engine._deadlineFrame);
  if (frame === carried || frame === undefined) return stack;
  const copy = copyContextStack(stack);
  stackDeadlineFrames.set(copy, frame);
  return copy;
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
  const frame = stackDeadlineFrames.get(stack);
  if (frame !== undefined) stackDeadlineFrames.set(copy, frame);
  return copy;
}
