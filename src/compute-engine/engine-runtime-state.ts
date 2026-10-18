import {
  CancellationError,
  DEFAULT_ITERATION_LIMIT,
  frameExpired,
  type DeadlineFrame,
} from '../common/interruptible.js';
import type { RandomSeedFrame } from './numerics/random.js';

/**
 * The error that ends a runaway user-function recursion: a
 * `CancellationError` with the cause `recursion-depth-exceeded`. It is thrown
 * when the depth reaches `recursionLimit`, and also when the JavaScript call
 * stack is full before the depth reaches the limit (see
 * {@linkcode isStackOverflow}), so the host gets the same error in both cases.
 */
export function recursionLimitError(): CancellationError {
  return new CancellationError({
    cause: 'recursion-depth-exceeded',
    message: 'Recursion limit exceeded',
  });
}

/**
 * Is `e` the error that a JavaScript engine throws when its call stack is
 * full? V8 (Chrome, Node) and JavaScriptCore (Safari) throw a `RangeError`
 * whose message starts with "Maximum call stack size exceeded";
 * SpiderMonkey (Firefox) throws an `InternalError` with the message "too much
 * recursion". Any other `RangeError` (an invalid array length, an invalid
 * index) is not a stack overflow and gives `false`.
 *
 * The test reads the name and the message, not the class: `InternalError` is
 * not a global outside SpiderMonkey. It runs when the stack is nearly full,
 * so it uses no regular expression: compiling one needs stack, and failed
 * there with a `SyntaxError` that hid the overflow. When the test itself
 * overflows, it throws a new stack-overflow `RangeError`, which the caller
 * one level up tests again with more room.
 */
export function isStackOverflow(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e instanceof RangeError)
    return e.message.startsWith('Maximum call stack size exceeded');
  return e.name === 'InternalError' && e.message === 'too much recursion';
}

/** The user-function depth from which `enterRecursion()` measures the free
 * stack (see {@linkcode hasStackRoom}). */
const STACK_ROOM_MIN_DEPTH = 32;

/** The number of arguments of the call that measures the free stack: 8192
 * arguments of 8 bytes each, that is 64 KB. */
const STACK_ROOM_ARGUMENTS = 8192;

let stackRoomArguments: unknown[] | undefined;

function noop(): void {}

/**
 * Is there at least 64 KB of free JavaScript stack? The test calls a
 * function with `STACK_ROOM_ARGUMENTS` arguments: the engine puts the
 * arguments on the stack, and throws a stack-overflow error when they do not
 * fit. The size of an argument does not depend on how the engine compiled
 * the code, which a test that recursed through small frames would. The call
 * takes about 2 µs. A host where the call does not throw at the stack limit
 * gets `true`, and the catch in `wrapRecursion()` (`function-utils.ts`)
 * still converts the overflow.
 */
function hasStackRoom(): boolean {
  stackRoomArguments ??= new Array<unknown>(STACK_ROOM_ARGUMENTS).fill(0);
  try {
    Reflect.apply(noop, undefined, stackRoomArguments);
    return true;
  } catch (e) {
    if (isStackOverflow(e)) return false;
    throw e;
  }
}

export class EngineRuntimeState {
  private _iterationLimit = DEFAULT_ITERATION_LIMIT;
  private _recursionLimit = 256;
  private _recursionDepth = 0;
  private _maxCollectionSize = 10_000;
  private _deadlineFrame: DeadlineFrame | undefined = undefined;
  private _randomFrame: RandomSeedFrame | undefined = undefined;
  private _isVerifying = false;

  get iterationLimit(): number {
    return this._iterationLimit;
  }

  set iterationLimit(value: number) {
    this._iterationLimit = value <= 0 ? Number.POSITIVE_INFINITY : value;
  }

  /**
   * True once a host has assigned `iterationLimit`, even to the default
   * value. An engine that runs an Epsil program drops its iteration limit
   * unless this is true, and keeps it dropped for every later evaluation on
   * the same engine (a lazy result of the program may be enumerated after the
   * run): the default limit protects symbolic evaluation from a runaway
   * internal loop, and a loop written by the author of a program is not such
   * a loop. A host that wants a bound, for Epsil programs or for the other
   * evaluations it runs on the same engine, assigns the limit, and that
   * assignment is then honored.
   */
  iterationLimitIsExplicit = false;

  get recursionLimit(): number {
    return this._recursionLimit;
  }

  set recursionLimit(value: number) {
    this._recursionLimit = value <= 0 ? Number.POSITIVE_INFINITY : value;
  }

  /** The current user-function call depth (see {@linkcode enterRecursion}). */
  get recursionDepth(): number {
    return this._recursionDepth;
  }

  /**
   * Enter a user-function application. Throws a `CancellationError`
   * (`cause: 'recursion-depth-exceeded'`) when the depth would exceed
   * `recursionLimit`, leaving the depth unchanged so a caller's `finally`
   * stays balanced. Otherwise increments the depth.
   *
   * This bounds user-function recursion (`f(x) := … f(x-1) …`) with a clean,
   * catchable error instead of letting it overflow the native JS call stack
   * with a `RangeError`. Balanced with {@linkcode exitRecursion}.
   *
   * The same error is thrown when the JavaScript stack has less than
   * `STACK_ROOM_ARGUMENTS` × 8 bytes (64 KB) free, which can happen before
   * the depth reaches the limit: a level of a recursion uses several
   * kilobytes of stack, and the size of the stack depends on the host. The
   * error must be thrown while there is room left. After a stack overflow,
   * V8 refuses calls until about 40 KB of the stack is free again, so the
   * `finally` blocks of the levels near the overflow cannot run: their
   * evaluation contexts, counters and scope bookkeeping stay as they were in
   * the recursion. Thrown here, at the entry of a level, the error lets
   * every `finally` block run. The room is measured only from a depth of
   * `STACK_ROOM_MIN_DEPTH`, so a shallow application does not pay for the
   * measurement.
   *
   * Returns the depth before the entry, for {@linkcode exitRecursion}.
   */
  enterRecursion(): number {
    const depth = this._recursionDepth;
    if (
      depth >= this._recursionLimit ||
      (depth >= STACK_ROOM_MIN_DEPTH && !hasStackRoom())
    )
      throw recursionLimitError();
    this._recursionDepth = depth + 1;
    return depth;
  }

  /** Leave a user-function application. Balanced with
   * {@linkcode enterRecursion}: `depth` is the value that `enterRecursion()`
   * returned. The depth is set to that value rather than decremented, so a
   * level whose own exit was skipped (a stack overflow can make a `finally`
   * block fail) does not leave the depth too high once an enclosing level
   * exits. */
  exitRecursion(depth: number): void {
    this._recursionDepth = depth;
  }

  get maxCollectionSize(): number {
    return this._maxCollectionSize;
  }

  set maxCollectionSize(value: number) {
    this._maxCollectionSize = value <= 0 ? Number.POSITIVE_INFINITY : value;
  }

  /** The full deadline frame (or `undefined` when unarmed). */
  get deadlineFrame(): DeadlineFrame | undefined {
    return this._deadlineFrame;
  }

  set deadlineFrame(frame: DeadlineFrame | undefined) {
    this._deadlineFrame = frame;
  }

  /**
   * Compatibility accessor: the absolute ms timestamp of the effective
   * deadline. Reading returns `frame?.at`; writing a bare number wraps it into
   * a fresh (unlabelled) frame, and `undefined` clears the deadline.
   */
  get deadline(): number | undefined {
    return this._deadlineFrame?.at;
  }

  set deadline(value: number | undefined) {
    this._deadlineFrame =
      value === undefined ? undefined : { at: value, spans: [] };
  }

  /**
   * The innermost active `WithRandomSeed` frame (or `undefined` when no frame
   * is active, i.e. draws are live).
   *
   * Stored and swapped exactly like {@linkcode deadlineFrame}: the "stack" is
   * the JS call stack — `withRandomSeedFrame` saves the previous frame, sets
   * its own, and restores in a `finally`. It belongs to the evaluation
   * context, never a module-level slot, so engines never share frames.
   */
  get randomFrame(): RandomSeedFrame | undefined {
    return this._randomFrame;
  }

  set randomFrame(frame: RandomSeedFrame | undefined) {
    this._randomFrame = frame;
  }

  get timeRemaining(): number {
    if (this._deadlineFrame === undefined) return Number.POSITIVE_INFINITY;
    // A spent step budget leaves no time either: a loop driven by this value
    // (`run(gen, ce._timeRemaining)`) must stop as `checkDeadline` would.
    if (frameExpired(this._deadlineFrame)) return 0;
    return this._deadlineFrame.at - Date.now();
  }

  get isVerifying(): boolean {
    return this._isVerifying;
  }

  set isVerifying(value: boolean) {
    this._isVerifying = value;
  }

  shouldContinueExecution(): boolean {
    return !frameExpired(this._deadlineFrame);
  }
}
