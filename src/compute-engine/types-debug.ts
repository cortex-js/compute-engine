import type { Expression } from './types-expression.js';

/**
 * A statement at which a debugger can pause a run of `executeEpsilAsync()`
 * (`ExecuteEpsilAsyncOptions.debug`).
 *
 * @category Epsil
 */
export interface EpsilDebugStatement {
  /** The statement, canonical. */
  readonly statement: Expression;

  /** The offsets of the statement in the source of the run: the statement is
   * `source.slice(start, end)`. */
  readonly range: readonly [start: number, end: number];

  /** The depth of the evaluation context of the statement: the number of
   * contexts on its context stack. A call adds a context, and so does a
   * nested scope (a loop body, a block, a branch of `if`): the statement of
   * an `if` branch is deeper than the `if`, although no call was made. Use
   * `callDepth` to step. */
  readonly depth: number;

  /** The number of function calls in progress at the statement: the
   * contexts named `"call"` on its context stack, 0 at the top level. A
   * debugger compares two call depths to step over a call (stop at the next
   * statement whose call depth is the same or smaller) or out of one (stop
   * at the next statement whose call depth is smaller). */
  readonly callDepth: number;

  /** Run `fn` in the evaluation context of the statement, and return its
   * value. During `fn`, `ce.context` and `ce.contextStack` are those of the
   * statement, so `ce.context.lexicalScope` and its parents hold the
   * variables the statement sees, and an expression that `fn` evaluates
   * reads their values. `fn` must be synchronous: the context is in place
   * only until `fn` returns. Use it for the variables view, a watch and a
   * conditional breakpoint. */
  inScope<T>(fn: () => T): T;
}

/**
 * Hooks with which a debugger follows a run of `executeEpsilAsync()`
 * (`ExecuteEpsilAsyncOptions.debug`).
 *
 * The hooks are called for each statement written in the source of the run
 * that is evaluated on the asynchronous route: a top-level statement, and a
 * statement of a function body, of a loop body, of a branch of `if` or of a
 * `do` block. A statement that the engine evaluates on the synchronous route
 * calls no hook. This is the case of a statement of a function that a lazy
 * collection applies when it produces an element (a function given to `map`,
 * `filter`, `takeWhile`, `any`, `all` or `count`), and of a function that an
 * operator calls while it evaluates its operands on the synchronous route (a
 * function called in the domain of a `for`, `for x in g(3)`), and of the body
 * of a loop inside `withRandomSeed`, which evaluates its body on the
 * synchronous route. It is also the
 * case of a statement that runs after the run ends, when the host reads the
 * elements of a lazy collection that the program returned.
 *
 * When a hook returns a promise, the run waits until the promise settles:
 * this is how a debugger pauses. When the hook throws, or its promise
 * rejects, the run stops, and the promise of `executeEpsilAsync()` rejects
 * with that error: this is how a debugger ends a run. An abort of the
 * `signal` of the run takes effect only when the pending promise settles.
 *
 * The run yields to the event loop only inside a loop (every 16 ms of loop
 * work): awaiting a hook that returns at once does not yield, so a timer, a
 * click or a message is not handled during a run of plain statements or of
 * recursive calls. A debugger whose Pause button sets a flag that
 * `beforeStatement` reads makes the hook yield (`await` a `setTimeout(0)`)
 * when 16 ms have passed since its last yield.
 *
 * A time limit keeps running while the run waits: a `withTimeLimit()` span
 * around the run, `statementTimeLimitMs`, and the engine's time limit. A
 * pause longer than the limit ends the run with a timeout. A debugger runs
 * the program without a time limit, and stops it with the hooks or the
 * `signal`.
 *
 * While the run waits, other evaluations can run on the engine. The hooks
 * are installed on the engine for the duration of the run, and a statement
 * of another asynchronous evaluation that runs on the engine meanwhile calls
 * them too: a debugger gives a run an engine of its own.
 *
 * @category Epsil
 */
export interface EpsilDebugHooks {
  /** Called before the statement is evaluated. */
  beforeStatement?: (at: EpsilDebugStatement) => void | PromiseLike<void>;

  /** Called after the statement is evaluated, with its value. A runtime
   * problem of Epsil is a value (`["Error", …]`), not an exception: a
   * debugger that pauses on errors tests `value.operator === 'Error'`. */
  afterStatement?: (
    at: EpsilDebugStatement,
    value: Expression
  ) => void | PromiseLike<void>;
}
