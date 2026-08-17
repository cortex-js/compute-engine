import type { CompileDiagnostic } from './types.js';

/**
 * A compile DECLINE carrying a structured `CompileDiagnostic` (see
 * `CompilationResult.diagnostic`). Thrown by the compiler where a plain
 * `Error` would lose the decline's `code`/`kind`; the target's `compile()`
 * catch and the engine-level `compile()` catch read the payload back through
 * `compileDiagnosticOf` when they build the `success: false` result.
 *
 * Identity is checked by NAME (`isCompileDeclineError`), never `instanceof`:
 * plugin bundles re-bundle engine code, so a class identity check fails across
 * the host/plugin boundary.
 */
export class CompileDeclineError extends Error {
  readonly diagnostic: CompileDiagnostic;

  constructor(diagnostic: CompileDiagnostic) {
    super(diagnostic.message);
    this.name = 'CompileDeclineError';
    this.diagnostic = diagnostic;
  }
}

/**
 * The lane-mismatch decline of strict mode: a complex-shaped value reached a
 * binding the compilation shaped REAL (a wide-typed user-function parameter, a
 * `Block` local first bound real, a callback element parameter over a
 * complex-typed source, …). Reported as `code: 'lane-mismatch'`, `kind:
 * 'correctness'` — the value the previous emission computed at that boundary
 * was wrong (`NaN`, or a `{re, im}` consumed as a number), and is withdrawn.
 * Under `mode: 'auto'` the engine-level `compile()` catches this error and
 * redoes the compilation in complex mode.
 *
 * `binding` is USER-LEGIBLE by contract: an authored identifier (the
 * parameter `x` of `b`, the local `k`) or an honest description ("an unnamed
 * parameter of `b`", "the accumulator of the `Reduce`") — never a
 * compiler-internal temporary such as `_t3` or `_fn_b`. `value` is the LaTeX
 * of the complex-shaped expression that reached the boundary.
 */
export class LaneMismatchError extends CompileDeclineError {
  readonly boundary: string;
  readonly binding: string;
  readonly value: string;

  constructor(payload: {
    boundary: string;
    binding: string;
    value: string;
    message?: string;
  }) {
    const message =
      payload.message ??
      `Lane mismatch at ${payload.boundary}: the complex-shaped value \`${payload.value}\` reaches ${payload.binding}, which this compilation shaped real. Declare it complex, or compile with \`mode: 'complex'\`. Fail closed (D6).`;
    super({
      code: 'lane-mismatch',
      kind: 'correctness',
      message,
      boundary: payload.boundary,
      binding: payload.binding,
      value: payload.value,
    });
    this.name = 'LaneMismatchError';
    this.boundary = payload.boundary;
    this.binding = payload.binding;
    this.value = payload.value;
  }
}

/** Whether `e` is a `CompileDeclineError` (name-keyed, bundle-safe). */
export function isCompileDeclineError(e: unknown): e is CompileDeclineError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name !== undefined &&
    ((e as { name: string }).name === 'CompileDeclineError' ||
      (e as { name: string }).name === 'LaneMismatchError') &&
    typeof (e as { diagnostic?: unknown }).diagnostic === 'object'
  );
}

/** Whether `e` is a `LaneMismatchError` (name-keyed, bundle-safe). */
export function isLaneMismatchError(e: unknown): e is LaneMismatchError {
  return isCompileDeclineError(e) && e.diagnostic.code === 'lane-mismatch';
}

/**
 * The structured diagnostic for a caught compile failure: the payload of a
 * `CompileDeclineError`, or — for any other error, i.e. every retained
 * pre-existing fail-closed decline — a generic `capability` diagnostic
 * (`code: 'compile-error'`) carrying the error's message.
 */
export function compileDiagnosticOf(
  e: unknown,
  message?: string
): CompileDiagnostic {
  if (isCompileDeclineError(e)) return e.diagnostic;
  return {
    code: 'compile-error',
    kind: 'capability',
    message:
      message ??
      (e instanceof Error
        ? e.message
        : typeof e === 'string'
          ? e
          : 'Compilation failed'),
  };
}
