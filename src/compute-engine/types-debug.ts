import type { Expression } from './types-expression.js';
import type { PauseClock } from '../common/interruptible.js';

/**
 * A statement at which a debugger can pause a run of `executeEpsilAsync()`
 * (`ExecuteEpsilAsyncOptions.debug`).
 *
 * @category Epsil
 */
export interface EpsilDebugStatement {
  /** The statement, canonical. */
  readonly statement: Expression;

  /** The offsets of the statement in the source in which it was written,
   * `sourceContent`: the statement is `sourceContent.slice(start, end)`. */
  readonly range: readonly [start: number, end: number];

  /** The text of the source in which the statement was written. A
   * statement of a function that an earlier run of `executeEpsil()` or
   * `executeEpsilAsync()` defined (a function of an earlier notebook cell, of
   * a prelude, a function value that a host kept) has the source of that
   * run, not the source of the run that calls it. A host compares it with
   * the text of each of its sources. `undefined` when no run of Epsil parsed
   * the statement (MathJSON that carries `sourceOffsets`). */
  readonly sourceContent: string | undefined;

  /** The `url` option of the run that parsed the statement
   * (`ExecuteEpsilOptions.url`), when it had one. It tells apart two sources
   * with the same text. */
  readonly sourceUrl: string | undefined;

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
 * The hooks are called for each statement of Epsil source that the run
 * evaluates on the asynchronous route: a top-level statement, and a
 * statement of a function body, of a loop body, of a branch of `if` or of a
 * `do` block. A statement of a function that an earlier run defined calls
 * them too, with the source of that run (`EpsilDebugStatement.sourceContent`
 * and `sourceUrl`): a debugger shows it in that source, or skips it. A
 * statement that the engine evaluates on the synchronous route calls no
 * hook. This is the case of a statement of a function that a lazy
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
 * A time limit counts running time only: the time while a promise that a
 * hook returned is pending does not count against a `withTimeLimit()` span
 * around the run or against `statementTimeLimitMs`. The synchronous part of
 * a hook is running time, as is a hook that returns no promise, and a watch
 * that runs in `inScope()` during a pause. A watch also keeps the time limit
 * of a span around the call of `inScope()`. Pauses that overlap count once. So a
 * debugger keeps the time limit of a normal run: a pause of any length does
 * not end the run, and an endless loop still ends with a timeout. The paused
 * time belongs to the run: a pause does not extend the time limit of other
 * work, on this engine or on another.
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

/**
 * A debug run of `executeEpsilAsync()` (`IComputeEngine._epsilDebugRun`):
 * its pause clock. The deadline frames of the run are on it.
 * @internal
 */
export interface EpsilDebugRun {
  readonly clock: PauseClock;
}
