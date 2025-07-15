/**
 * A Result type that encapsulates the outcome of an operation, allowing for
 * both successful results and errors.
 *
 * ```typescript
 * const result = Result.ok(42);
 * if (result.ok) {
 *   console.log(result.value); // 42
 * } else {
 *   console.error(result.error); // Error message
 * }
 * ```
 *
 * Results can be chained:
 *
 * ```typescript
 * const result = ok(42)
 *  .map(x => x + 1)
 *  .andThen(x => ok(x * 2))
 *  .orElse(err => ok(0));
 * ```
 *
 * The `??` operator can be used to provide a default value when unwrapping,
 * if the result can never be `undefined`:
 * ```typescript
 * const result = ok(42);
 * const value = result.value ?? 0; // 42
 * ```
 */
export class Result<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string | Error;

  private constructor(ok: boolean, x?: T | string | Error) {
    this.ok = ok;
    if (ok) this.value = x as T;
    else this.error = x as string | Error;
  }

  static ok<T>(value: T): Result<T> {
    return new Result<T>(true, value);
  }

  static err<T>(error: string | Error): Result<T> {
    return new Result<T>(false, error);
  }

  static from<T>(values: Iterable<T | Result<T>>): Result<T>[] {
    const result: Result<T>[] = [];
    for (const value of values) {
      if (Result.isResult(value)) {
        if (!value.ok) return [value];
        result.push(value);
      } else {
        result.push(Result.ok(value));
      }
    }
    return result;
  }

  isOk(result: Result<T>): result is Result<T> & { ok: true } {
    return result.ok;
  }

  static isErr<T>(result: Result<T>): result is Result<T> & { ok: false } {
    return !result.ok;
  }

  static isResult<T>(value: any): value is Result<T> {
    return (
      (value &&
        typeof value === 'object' &&
        'ok' in value &&
        value.ok === true &&
        'value' in value) ||
      (value.ok === false && 'error' in value)
    );
  }

  static resultToString<T>(result: Result<T>): string {
    if (result.ok) {
      return `Ok(${JSON.stringify(result.value)})`;
    } else {
      return `Err(${result.error?.toString() || 'Unknown error'})`;
    }
  }

  static resultToJSON<T>(result: Result<T>): string {
    if (result.ok) {
      return JSON.stringify({
        ok: true,
        value: result.value,
      });
    }
    return JSON.stringify({
      ok: false,
      error: result.error?.toString(),
    });
  }

  static resultFromJSON<T>(json: string): Result<T> {
    const obj = JSON.parse(json);
    if (obj.ok) {
      return Result.ok(obj.value);
    } else {
      return Result.err(obj.error || 'Unknown error');
    }
  }

  unwrap(): T {
    if (this.ok) return this.value as T;

    throw new Error(this.error?.toString() || 'Unknown error');
  }

  unwrapOr(defaultValue: T): T {
    if (this.ok) return this.value as T;
    return defaultValue;
  }

  // From Rust: expect() is like unwrap(), but with a custom error message
  expect(message: string): T {
    if (this.ok) return this.value as T;

    throw new Error(
      message + ': ' + (this.error?.toString() || 'Unknown error')
    );
  }

  map<U>(fn: (value: T) => U): Result<U> {
    if (this.ok) return Result.ok(fn(this.value as T));
    return Result.err(this.error as string);
  }

  /** Useful for debugging, e.g.
   * ```typescript
   * const result = ok(42)
   *  .inspect(x => console.log('Value:', x))
   *  .map(x => x + 1)
   *  .andThen(x => ok(x * 2))
   *  .orElse(err => ok(0));
   * console.log(result.toString()); // Ok(84)
   * ```
   * From Rust.
   */
  inspect<U>(fn: (value: T) => void): Result<T> {
    if (this.ok) fn(this.value as T);
    return this;
  }

  inspectErr(fn: (error: string | Error) => void): Result<T> {
    if (!this.ok) fn(this.error as string | Error);
    return this;
  }

  andThen<U>(fn: (value: T) => Result<U>): Result<U> {
    if (this.ok) return fn(this.value as T);
    return this as unknown as Result<U>;
  }

  orElse(
    otherwise: ((error: string | Error) => Result<T>) | Result<T>
  ): Result<T> {
    if (this.ok) return this;

    if (typeof otherwise !== 'function') return otherwise;
    return otherwise(this.error as string | Error);
  }

  toString(): string {
    return Result.resultToString(this);
  }

  toJSON(): string {
    return Result.resultToJSON(this);
  }
}

export function ok<T>(value: T): Result<T> {
  return Result.ok(value);
}

export function err<T>(error: string | Error): Result<T> {
  return Result.err(error);
}
