import type { CompileDiagnostic } from './types.js';
import type { Expression } from '../global-types.js';

/**
 * The `code` of the decline of an expression with an input (a free symbol)
 * whose static type is `unknown` or `any` (`assertAdmitted()`,
 * `compile-admission.ts`). The interpreter fallback puts the name of each
 * such input in `unsupported`.
 */
export const UNTYPED_INPUT_CODE = 'untyped-input';

/**
 * The `code` of the decline of a value with no settled shape
 * (`assertAdmitted()`, `compile-admission.ts`): an `If`, a `Which` or a
 * `Match` whose branches have different shapes, or a function literal or
 * the root of the compilation whose values (the value of each `Return`, and
 * the last value) have different shapes, or a name that gets values of
 * different shape classes in one scope. A lowering uses the same code,
 * through `unsettledShapeDecline()`, for an operand whose type admits more
 * than one shape, which the code would have to tell apart at run time. The
 * same code is used for an effect that the compiled code does not reproduce
 * as the interpreter does: an assignment in a callback, in a
 * `Comprehension` or an `Integrate`, in a branch of an element-wise
 * conditional, an assignment of an enclosing loop index in a function
 * literal, and a `Return` inside a `Loop` (`UnsettledShape.reason`,
 * `compiler-types.ts`, lists them). The interpreter fallback puts the node,
 * as `toString()` writes it, in `unsupported`.
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
 * The decline of a lowering for an operand `node` whose static type admits
 * several shapes, which the code would have to tell apart at run time
 * (rule R3 of "Shapes are settled at compile time",
 * `docs/COMPILATION-MODEL.md`). The diagnostic has the code
 * `'unsettled-shape'` and the kind `'capability'`; its `value` is `node`,
 * as `toString()` writes it. `why` completes the message: what the
 * operand is and why its shape is not settled.
 */
export function unsettledShapeDecline(
  node: Expression,
  why: string
): CompileDeclineError {
  const value = node.toString();
  return new CompileDeclineError({
    code: UNSETTLED_SHAPE_CODE,
    kind: 'capability',
    message:
      `Could not compile "${value}": ${why}, so the shape of its value is ` +
      `known only at run time. Declare one shape for it, or compile one ` +
      `function for each shape.`,
    value,
  });
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
 * `interval-javascript-target.ts`). The interpreter fallback reads an
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

/**
 * The decline of `mode: 'bigint'` (JavaScript target only): a node that is
 * not on the integer lane, so the compilation cannot compute it with
 * JavaScript `bigint` values. Reported as `code: 'bigint-lane'`, `kind:
 * 'capability'`: no value that was computed right before is withdrawn, the
 * expression runs on the interpreter instead.
 *
 * It is NOT a lane mismatch (`isLaneMismatchError` is `false` for it): the
 * two codes stay separate so that no route can change one decline into the
 * other.
 *
 * `node` is the node as `toString()` writes it (carried as `value` on the
 * diagnostic), `type` its static type, and `reason` says why the node is not
 * on the lane. `message`, when given, replaces the whole message: the
 * decline that is not about one node (the lane analysis is not implemented
 * yet) must not say that the node is off the lane.
 */
export function bigintLaneError(payload: {
  node: string;
  type: string;
  reason: string;
  message?: string;
}): CompileDeclineError {
  return new CompileDeclineError({
    code: 'bigint-lane',
    kind: 'capability',
    message:
      payload.message ??
      `Could not compile in mode 'bigint': \`${payload.node}\` (type \`${payload.type}\`) is not on the integer lane: ${payload.reason}.`,
    value: payload.node,
  });
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
 * The object of "Could not compile …" in a decline message raised by a check
 * of a compiled body (the GPU and Python targets check that a body emits as a
 * single expression, or places its `return` correctly). Such a check
 * receives a `subject` that is one of four things: a user function name
 * (`f`), which is quoted; an API entry point (`compileToSource()`), which is
 * what the compilation ran "with"; an entry point followed by the part it
 * compiles; or a phrase ("this function body"), which reads as it is.
 */
export function compileSubject(subject: string): string {
  if (/^[A-Za-z_][\w]*$/.test(subject)) return `\`${subject}\``;
  if (subject.endsWith('()')) return `with \`${subject}\``;
  // An entry point followed by the part it compiles:
  // `compileShader() body statement "fragColor"` reads as
  // `the body statement "fragColor" of \`compileShader()\``.
  const part = /^(\w+\(\)) (.+)$/.exec(subject);
  if (part !== null) return `the ${part[2]} of \`${part[1]}\``;
  return subject;
}

/**
 * Throw the strict-mode `LaneMismatch` decline for a complex-shaped value
 * that reaches a parameter of a block-local function, which the
 * compilation shaped real. `binding` names the parameter and the function
 * (`userParamBinding()` in `compile-lanes.ts`). `value` is the argument,
 * rendered as LaTeX, or a description of the value when the argument is a
 * name that the compiler made (`an element of \`L\``).
 *
 * The body of a block-local function is compiled in the lane of the
 * parameter types of its literal. A signature declared with `Declare` (`g:
 * (complex, complex) -> complex`), if there is one, does not change that
 * lane, so the message asks for an annotation of the parameter in the
 * literal.
 */
export function localLaneMismatch(
  boundary: string,
  binding: string,
  value: Expression | string
): never {
  let rendered: string;
  let phrase: string;
  if (typeof value === 'string') {
    rendered = value;
    phrase = value;
  } else {
    try {
      rendered = value.latex;
    } catch {
      rendered = value.toString();
    }
    phrase = `the complex-shaped value \`${rendered}\``;
  }
  throw new LaneMismatchError({
    boundary,
    binding,
    value: rendered,
    message:
      `Lane mismatch at ${boundary}: ${phrase} reaches ${binding}, ` +
      `which this compilation shaped real. The body of a block-local ` +
      `function is compiled in the lane of the parameter types of its ` +
      `literal; a signature declared with \`Declare\` does not change ` +
      `that lane. Annotate the parameter in the ` +
      `literal with a complex type (\`(a: complex) => …\`), or compile ` +
      `with \`mode: 'complex'\`.`,
  });
}
