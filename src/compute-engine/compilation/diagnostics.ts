import type { CompileDiagnostic } from './types.js';

/**
 * The `code` of the decline of an expression with an input (a free symbol)
 * whose static type is `unknown` or `any`. The interpreter fallback puts the
 * name of each such input in `unsupported`.
 */
export const UNTYPED_INPUT_CODE = 'untyped-input';

/**
 * The `code` of the decline of a value with no settled shape: an `If`, a
 * `Which` or a `Match` whose branches have different shapes, or a function
 * literal or the root of the compilation whose values (the value of each
 * `Return`, and the last value) have different shapes, or a name that gets
 * values of different shape classes in one scope. A lowering uses the same
 * code for an operand whose type admits more than one shape, which the code
 * would have to tell apart at run time. The same code is used for an effect
 * that the compiled code does not reproduce as the interpreter does: an
 * assignment in a callback, in a `Comprehension` or an `Integrate`, in a
 * branch of an element-wise conditional, an assignment of an enclosing loop
 * index in a function literal, and a `Return` inside a `Loop`. The
 * interpreter fallback puts the node, as `toString()` writes it, in
 * `unsupported`.
 */
export const UNSETTLED_SHAPE_CODE = 'unsettled-shape';

/**
 * The `code` of the decline of an expression with an input declared with a
 * union of shapes (`tuple<real, real> | list<real>`) that the compiled code
 * cannot read with one body per member: no run-time test tells the members
 * apart, or the inputs declared this way would need more than four bodies.
 * `value`
 * holds the names of the inputs, separated by commas, and the interpreter
 * fallback puts each name in `unsupported`.
 */
export const UNION_DISPATCH_CODE = 'union-dispatch';

/** The `code` of the decline of an expression whose static type is an
 *  error. */
export const STATIC_TYPE_ERROR_CODE = 'static-type-error';

/**
 * The `code` of the decline of a value that can be `Nothing` where compiled
 * code needs a value: an element of a collection or a coordinate of a tuple
 * whose static type has an explicit `nothing` arm (`hasNothingArm()`; `any`
 * has no such arm), the operand of `IsMissing`, `Coalesce` or
 * `AssertPresent`, the value of an entry of a dictionary literal, and the
 * symbol `Nothing` read as an operand. `Nothing` is the value of an empty
 * block or of a statement with no value, and compiled code has no
 * representation of it as a value.
 */
export const POSSIBLE_NOTHING_CODE = 'possible-nothing';

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
 * The compilation is not redone in another mode: a host that wants the
 * complex value compiles with `mode: 'complex'`.
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
      `Lane mismatch at ${payload.boundary}: the complex-shaped value \`${payload.value}\` reaches ${payload.binding}, which this compilation shaped real. Declare it complex, or compile with \`mode: 'complex'\`.`;
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

/**
 * The decline of an expression that holds a value of a kind type which has
 * no interpreter fallback: on `interval-js`, an expression with an input or
 * a result typed `enclosure` (`holdsEnclosureInputOrResult()` in
 * `interval-fallback.ts`). The interpreter fallback reads an
 * interval input as its midpoint, which would return a point where the
 * caller asked for an enclosure, so the decline is thrown even with
 * `fallback: true`. The engine-level `compile()` throws it again as it is,
 * with no "Compilation fallback" warning and no second compilation.
 *
 * The diagnostic is the one of the decline it replaces (`compileDiagnosticOf`
 * of the caught error), so the `code` of the diagnostic does not change.
 */
export class KindDeclineError extends CompileDeclineError {
  constructor(diagnostic: CompileDiagnostic) {
    super(diagnostic);
    this.name = 'KindDeclineError';
  }
}

/** Whether `e` is a `CompileDeclineError` (name-keyed, bundle-safe). */
export function isCompileDeclineError(e: unknown): e is CompileDeclineError {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: unknown }).name !== undefined &&
    ((e as { name: string }).name === 'CompileDeclineError' ||
      (e as { name: string }).name === 'LaneMismatchError' ||
      (e as { name: string }).name === 'KindDeclineError') &&
    typeof (e as { diagnostic?: unknown }).diagnostic === 'object'
  );
}

/** Whether `e` is a `KindDeclineError` (name-keyed, bundle-safe). */
export function isKindDeclineError(e: unknown): e is KindDeclineError {
  return isCompileDeclineError(e) && e.name === 'KindDeclineError';
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

/**
 * Decline the compilation when an input has the static type `unknown` or
 * `any` (`untypedInputs()`): `names` are the names of these inputs.
 *
 * The compiled code reads each input in one shape, a number, a list or a
 * point, and the shape comes from the input's type. With no type, the shape
 * is not known, and the compiled value can differ from the interpreter's:
 * with `M` undeclared, `If(M < 3, M, 0)` read `M` as a number, and gave `0`
 * for `M = [1, 5]` where the interpreter gives `[1, 0]`. The host declares
 * the input (`ce.declare("M", "real")`, or a union such as
 * `real | list<real>` when it can pass both shapes).
 *
 * This applies on every target. The diagnostic has the code
 * `'untyped-input'` and the kind `'correctness'`. Its `value` is the names
 * of the inputs, separated by commas, for display. The interpreter fallback
 * puts each name in `unsupported` (`buildInterpreterFallback()`): the
 * names of `value`, and those that `untypedInputsOf()` finds (also when
 * another reason declines first).
 */
export function throwUntypedInputs(names: ReadonlyArray<string>): never {
  const list = names.map((name) => `\`${name}\``).join(', ');
  throw new CompileDeclineError({
    code: UNTYPED_INPUT_CODE,
    kind: 'correctness',
    message:
      `Could not compile: the input${names.length > 1 ? 's' : ''} ${list} ` +
      `${names.length > 1 ? 'have' : 'has'} no type (\`unknown\` or ` +
      `\`any\`). Declare the type of each input, for example with ` +
      `\`ce.declare("${names[0]}", "real")\`.`,
    value: names.join(','),
  });
}
