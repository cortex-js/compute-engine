import {
  CancellationError,
  type DeadlineFrame,
} from '../common/interruptible.js';

export class EngineRuntimeState {
  private _iterationLimit = 1024;
  private _recursionLimit = 256;
  private _recursionDepth = 0;
  private _maxCollectionSize = 10_000;
  private _deadlineFrame: DeadlineFrame | undefined = undefined;
  private _isVerifying = false;

  get iterationLimit(): number {
    return this._iterationLimit;
  }

  set iterationLimit(value: number) {
    this._iterationLimit = value <= 0 ? Number.POSITIVE_INFINITY : value;
  }

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
   */
  enterRecursion(): void {
    if (this._recursionDepth >= this._recursionLimit)
      throw new CancellationError({
        cause: 'recursion-depth-exceeded',
        message: 'Recursion limit exceeded',
      });
    this._recursionDepth += 1;
  }

  /** Leave a user-function application. Balanced with
   * {@linkcode enterRecursion}. */
  exitRecursion(): void {
    if (this._recursionDepth > 0) this._recursionDepth -= 1;
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

  get timeRemaining(): number {
    if (this._deadlineFrame === undefined) return Number.POSITIVE_INFINITY;
    return this._deadlineFrame.at - Date.now();
  }

  get isVerifying(): boolean {
    return this._isVerifying;
  }

  set isVerifying(value: boolean) {
    this._isVerifying = value;
  }

  shouldContinueExecution(): boolean {
    return (
      this._deadlineFrame === undefined || this._deadlineFrame.at >= Date.now()
    );
  }
}
