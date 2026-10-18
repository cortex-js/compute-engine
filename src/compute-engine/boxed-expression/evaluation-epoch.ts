/**
 * The number of the top-level evaluation that runs now on an engine: an
 * evaluation that is not nested in another evaluation of that engine.
 * `BoxedFunction.evaluate` and `BoxedFunction.evaluateAsync` give a new
 * number when such an evaluation starts (`beginTopLevelEvaluation`).
 *
 * A `Block` reads it to tell a new evaluation from a new run of the block
 * inside the same evaluation (an iteration of a loop body). A local that an
 * assignment makes in the block (`x ≔ x + 1` with `x` not declared) starts
 * with no value in each new evaluation, and keeps its value from one run of
 * the block to the next inside one evaluation, as a variable of a JavaScript
 * or Python function keeps its value across the iterations of a loop
 * (`sweepCanonicalizationBindings`, `library/control-structures.ts`).
 *
 * The number is kept for each engine, so a top-level evaluation on another
 * engine (an evaluation on engine B inside a handler of an evaluation on
 * engine A) does not change the number that the evaluation on A reads.
 *
 * An asynchronous evaluation keeps its number while it is pending: a
 * synchronous top-level evaluation that runs between two of its parts gets
 * a new number, and gives back the number of the asynchronous evaluation
 * when it ends (`endTopLevelEvaluation`).
 */
const currentEpoch = new WeakMap<object, number>();

/** The last number given, for all the engines. */
let lastEpoch = 0;

/**
 * Record the start of a top-level evaluation on `engine`. Return the number
 * that was current before, for `endTopLevelEvaluation`.
 */
export function beginTopLevelEvaluation(engine: object): number {
  const outer = currentEpoch.get(engine) ?? 0;
  lastEpoch += 1;
  currentEpoch.set(engine, lastEpoch);
  return outer;
}

/**
 * Give back to `engine` the number `outer` that `beginTopLevelEvaluation`
 * returned: the number of the asynchronous evaluation that is pending.
 */
export function endTopLevelEvaluation(engine: object, outer: number): void {
  currentEpoch.set(engine, outer);
}

/** The number of the current (or last) top-level evaluation on `engine`. */
export function topLevelEvaluationEpoch(engine: object): number {
  return currentEpoch.get(engine) ?? 0;
}
