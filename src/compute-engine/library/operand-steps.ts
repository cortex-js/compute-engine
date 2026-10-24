import type { Expression } from '../global-types.js';
import type { EvaluateHandlerOptions } from '../types-definitions.js';

/**
 * The evaluate handler of a lazy operator written once for both routes: a
 * generator that yields each held operand it needs evaluated, receives the
 * value, and returns the result of the handler.
 *
 * `runOperandSteps` evaluates each operand with `evaluate()`, as the
 * synchronous handler did. `runOperandStepsAsync` evaluates it with
 * `evaluateAsync()`, so that an operand whose operator has an asynchronous
 * handler (a `FindFit` that runs its scan on a worker pool) runs on its
 * asynchronous route. Everything else the handler does — its refusals, the
 * state it sets around the evaluation, the order of its steps — is the same
 * code on both routes. An exception of the evaluation goes back into the
 * generator at the `yield`, as an exception of `evaluate()` did.
 */
export type OperandSteps<R> = Generator<Expression, R, Expression>;

export function runOperandSteps<R>(steps: OperandSteps<R>): R {
  let step = steps.next();
  while (!step.done) {
    let value: Expression;
    try {
      value = step.value.evaluate();
    } catch (e) {
      step = steps.throw(e);
      continue;
    }
    step = steps.next(value);
  }
  return step.value;
}

/**
 * The asynchronous driver of `OperandSteps`. Each operand is evaluated with
 * the options of the evaluation that runs the handler (its abort signal, its
 * capability registry, its context stack and its working precision), with no
 * numeric approximation, as the synchronous `evaluate()` of the operand.
 * The engine keeps the context of the evaluation in place only until the
 * first `await` of the handler, so each later part of the generator runs
 * inside `withEvaluationContext`.
 */
export async function runOperandStepsAsync<R>(
  steps: OperandSteps<R>,
  {
    engine,
    signal,
    effects,
    _contextStack,
    _precisionWindow,
  }: EvaluateHandlerOptions
): Promise<R> {
  const options = {
    signal,
    _effects: effects,
    _contextStack,
    _precisionWindow,
  };
  let step = steps.next();
  while (!step.done) {
    let value: Expression | undefined;
    let failure: { error: unknown } | undefined;
    try {
      value = await step.value.evaluateAsync(options);
    } catch (e) {
      failure = { error: e };
    }
    step = engine.withEvaluationContext(options, () =>
      failure !== undefined ? steps.throw(failure.error) : steps.next(value!)
    );
  }
  return step.value;
}
