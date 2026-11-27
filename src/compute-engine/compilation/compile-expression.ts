import { isFunction } from '../boxed-expression/type-guards.js';
import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Expression, JSSource } from '../global-types.js';
import type {
  CompileMode,
  CompileDiagnostic,
  CompilationResult,
  DefaultRunnerResult,
  StorageHint,
} from './types.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import { resolveStorageHintsOfInputs } from './storage-hints.js';
import { interpreterFallback } from './interpreter-fallback.js';
import {
  compileDiagnosticOf,
  isCompileDeclineError,
  isKindDeclineError,
  CompileDeclineError,
  KindDeclineError,
} from './diagnostics.js';
import {
  buildIntervalFallback,
  holdsEnclosureInputOrResult,
} from './interval-fallback.js';
import { compilationScope, inCallerScope } from './compile-scope.js';
import { withAdmittedValueWrites } from '../boxed-expression/prepared-import-binding.js';
import { assertCompilationOptionsContract } from '../engine-extension-contracts.js';
import {
  compileInputNames,
  sealedInputDefinitions,
  symbolicInputsRead,
  withSymbolicInputs,
  withTypedInputs,
} from './vars-inputs.js';
import { compileWithIrProfile, type IR_OPTIONS } from './ir/adapter.js';
import { compileWithIrProfileGlsl } from './ir/adapter-glsl.js';
import { compileWithIrProfileInterval } from './ir/adapter-interval.js';
import { BUILT_IN_TARGETS } from './targets.js';
import { isLibraryOperator } from '../library-shadowing.js';

/** The answer of `canCompile()`. A positive answer also carries the
 *  `shippable` field of the result that `compile()` gives
 *  (`CompilationResult`). */
export type CanCompileResult =
  | {
      ok: true;
      shippable?: boolean;
    }
  | { ok: false; diagnostic: CompileDiagnostic };

/** The `outside-fragment` diagnostic of an error that the check of an
 *  option raised, for `canCompile()`. */
function optionErrorDiagnostic(e: unknown): CompileDiagnostic {
  const message =
    e instanceof Error ? e.message : `Could not compile: ${String(e)}`;
  const diagnostic: CompileDiagnostic = {
    code: 'outside-fragment',
    kind: 'capability',
    message,
  };
  // A decline of the compiler carries its own fields: the name and the
  // value that it is about.
  const inner = (e as { diagnostic?: CompileDiagnostic } | undefined)
    ?.diagnostic;
  if (inner?.binding !== undefined) diagnostic.binding = inner.binding;
  if (inner?.value !== undefined) diagnostic.value = inner.value;
  return diagnostic;
}

export type CompileExpressionOptions<T extends string = string> = {
  to?: T;
  vars?: Record<MathJsonSymbol, JSSource>;
  symbolic?: readonly MathJsonSymbol[];
  /**
   * The inputs of the compiled code, each with its type (a type string):
   * `compile(expr, { inputs: { x: 'real', P: 'tuple<real, real>' } })`.
   *
   * A name of `inputs` is an input with the given type, whatever the scopes
   * declare for it and whatever value it holds: the compilation declares
   * the name with that type in a scope of its own, binds the occurrences of
   * the name in the expression to that declaration, and reads the name as
   * an input wherever else it reads it, as a name of `symbolic`. The other
   * names of the expression keep the definitions they were boxed with. No
   * scope has to be pushed around the compilation.
   *
   * The body of a function that the expression calls reads the input too.
   * When that body was written with a declaration of the name, it keeps the
   * type of that declaration.
   *
   * The rules of a declared input apply to the given type
   * (`docs/COMPILATION-MODEL.md`). A type string that is not a type throws.
   */
  inputs?: Readonly<Record<MathJsonSymbol, string>>;
  fallback?: boolean;
  mode?: CompileMode;
  entryChecks?: boolean;
  iterationBudget?: number;
  quadrature?: 'adaptive' | 'monte-carlo';
  symbolDeps?: Set<MathJsonSymbol>;
  varsObjectRefs?: Set<MathJsonSymbol>;
  cse?: boolean;
  constantFold?: boolean;
  storage?: Readonly<Record<MathJsonSymbol, StorageHint>>;
  /** Accepted for the hosts that set it: every compilation uses the
   *  profile `ir`. */
  profile?: 'ir';
};

/**
 * Every option of `compile()` has a class in the compiler (`IR_OPTIONS` in
 * `ir/adapter.ts`): a new option fails this check until it is classified
 * there.
 */
const IR_OPTIONS_CLASSIFIED: [keyof CompileExpressionOptions] extends [
  keyof typeof IR_OPTIONS,
]
  ? true
  : false = true;
void IR_OPTIONS_CLASSIFIED;

/**
 * Throw when the `profile` option is given with a target other than
 * `javascript`, `glsl` or `interval-js`. It is an error of the options,
 * thrown whatever `fallback` says, as for the other invalid options.
 */
function assertProfileTarget(options: CompileExpressionOptions | undefined) {
  if (options?.profile === undefined) return;
  const targets = 'the targets "javascript", "glsl" and "interval-js"';
  const to = options.to ?? 'javascript';
  if (to !== 'javascript' && to !== 'glsl' && to !== 'interval-js')
    throw new Error(
      `Invalid compilation option "profile": the profile "${options.profile}" is ` +
        `defined for ${targets} only, not for "${to}"`
    );
}

/**
 * Compile a boxed expression.
 *
 * Returns a `CompilationResult` with the generated source code and,
 * for JS-executable targets, a `run` function. The built-in targets
 * (`javascript`, `glsl`, `interval-js`) compile with the profile `ir` only
 * (`compileInScope()`).
 *
 * `mode` selects the arithmetic discipline (`'strict'` | `'complex'` |
 * `'bigint'`, see `CompileMode` in `compilation/types.ts`); the effective
 * mode is `options.mode` ?? the target's `mode` ?? `'strict'`, and a mode
 * the target does not offer is a `capability` decline. The result reports
 * the discipline used (`mode`) and, on a decline, the structured
 * `diagnostic` beside `error`.
 *
 * If the expression cannot be compiled, falls back to interpretation
 * (success: false, run: applicableN1) unless `options.fallback` is false,
 * in which case it throws.
 *
 * ## Real-only special functions (compile targets)
 *
 * The built-in targets implement most special functions (`Erf`, `Gamma`,
 * `Zeta`, the Bessel/Airy family, …) with **real-only** library helpers
 * (`_SYS.erf`, GLSL `log2`, …). They accept a real scalar
 * only. Elementary functions that *do* have a complex extension (`Sin`, `Exp`,
 * `Sqrt`, `Power`, …) dispatch to a complex helper when an argument is
 * complex-valued; the real-only special functions do not. A complex value
 * must never reach a real helper (a compiled `Erf(z)` would return −1): under
 * `mode: 'strict'` (the default) the compiler fails closed with the offending
 * head; under `complex` a MAYBE-complex operand (a `complex`-typed symbol, a
 * promoted radical, a wide binding) uses a runtime guard: the real helper runs when the value's
 * imaginary part is exactly zero, `NaN` otherwise — and only a STATICALLY
 * non-real operand (`Erf(2i)`) is the compile-time decline. The shader
 * targets always fail closed. (`Real`/`Imaginary`/`Argument`/`Conjugate` are
 * exempt: they consume a complex value by design.)
 */
export function compile<
  T extends string = 'javascript',
  R = DefaultRunnerResult<T>,
>(
  expr: Expression,
  options?: CompileExpressionOptions<T>
): CompilationResult<T, R> {
  const ce = expr.engine;
  // A compiled Program owns its emitted locals, exactly as a Block does:
  // it is compiled as that Block.
  // A user function named `Program` is a user call.
  if (isFunction(expr, 'Program') && isLibraryOperator(expr))
    expr = ce._fn('Block', expr.ops);
  return compileExpression(expr, options);
}

/** The compilation of `compile()`. */
function compileExpression<
  T extends string = 'javascript',
  R = DefaultRunnerResult<T>,
>(
  expr: Expression,
  options?: CompileExpressionOptions<T>
): CompilationResult<T, R> {
  // A compilation is an operation: it
  // runs in an operation environment of its own, whose parents are the
  // environments of the occurrences of `expr`. Each occurrence of an input
  // then reads the meet of the requirements of the units of `expr`, and an
  // input whose units disagree has the type `unknown` and declines with
  // `untyped-input` (rule 8 of
  // `docs/plans/2026-11-09-binding-units-slice-1-spec.md`, see
  // `ce._opensOperation()`).
  const ce = expr.engine;
  if (ce._opensOperation(false))
    return ce._withOperation(expr, () => compile<T, R>(expr, options));
  // The option `inputs`: the compilation of the expression with the names
  // bound to typed declarations of its own (`withCompileInputs()`).
  if (options?.inputs !== undefined && Object.keys(options.inputs).length > 0) {
    // The interpreter fallback is the one of `expr` as it was given, built
    // for the scope of the call: a run gives each input its value on the
    // definition of that scope, which the bodies of the functions that
    // `expr` calls read too. The expression bound to the declarations of
    // the compilation would give the value to its own occurrences only.
    // An input that is a Document row is sealed: a run admits the write of
    // the run's value on the row and its restore (`withAdmittedValueWrites()`),
    // as the compiled code reads the input in place of the row (CE-1707),
    // when the row's type holds the given type (`sealedInputDefinitions()`).
    const inputs = options.inputs;
    const fallback = (decline: CompileDeclineError): CompilationResult<T, R> =>
      inCallerScope(expr, () => {
        const result = compileInScope<T, R>(expr, options, decline);
        const rows = sealedInputDefinitions(expr, inputs);
        const run = result.run as ((...args: unknown[]) => unknown) | undefined;
        if (rows.size === 0 || run === undefined) return result;
        return {
          ...result,
          run: ((...args: unknown[]) =>
            withAdmittedValueWrites(rows, () => run(...args))) as never,
        };
      });
    const result = withCompileInputs(expr, options, (bound, rest) =>
      compileExpression<T, R>(bound, rest)
    );
    if (isCompileDeclineError(result)) return fallback(result);
    if (result.success !== false) return result;
    return fallback(
      new CompileDeclineError(
        result.diagnostic ?? {
          code: 'compile-error',
          kind: 'capability',
          message: result.error ?? 'Could not compile',
        }
      )
    );
  }
  // The compiler looks a name up by its spelling from the current scope, and
  // the expression reads each name from the scope it was boxed in: the
  // compilation runs in a scope that gives each name of `expr` the
  // definition that its occurrence reads, or declines
  // (`compilationScope()`).
  // Its interpreter fallback is built for the scope of the call
  // (`inCallerScope()`).
  // A name of the `symbolic` option is an input wherever it is read: its
  // value is hidden for the time of the compilation (`withSymbolicInputs()`).
  const scope = compilationScope(expr, compileInputNames(options));
  const symbolic = options?.symbolic;
  const run = (): CompilationResult<T, R> => {
    const result = withSymbolicInputs(expr, symbolic, () =>
      compileInScope<T, R>(expr, options)
    );
    return isCompileDeclineError(result)
      ? compileInScope<T, R>(expr, options, result)
      : result;
  };
  return inCallerScope(expr, () => {
    if (scope === undefined) return run();
    if (isCompileDeclineError(scope))
      return compileInScope<T, R>(expr, options, scope);
    return ce._inScope(scope, run);
  });
}

/**
 * Run `fn` with the option `inputs` applied: each name of `inputs` is
 * declared, with its type and no value, in a scope that is pushed for the
 * time of `fn`; the occurrences of the name in `expr` are replaced by
 * occurrences bound to that declaration (`subs()` leaves the occurrences
 * that a binder, a block or a function literal of `expr` binds, and the
 * other names keep their definitions); and the names are added to
 * `symbolic`, so that the bodies and the values that the compilation reads
 * take them as inputs too. `fn` gets that expression and the options
 * without `inputs`.
 *
 * The scope is a child of the scope that the other names of `expr` are read
 * from (`compilationScope()`): the names of `inputs` take no part in that
 * choice. When there is no such scope, or when a name of `inputs` cannot
 * be an input of a body that `expr` calls (`symbolicInputsRead()`), the
 * result is the `CompileDeclineError`, and `fn` is not run.
 */
function withCompileInputs<O extends CompileExpressionOptions, X>(
  expr: Expression,
  options: O,
  fn: (bound: Expression, rest: O) => X
): X | CompileDeclineError {
  const ce = expr.engine;
  const inputs = options.inputs ?? {};
  const names = Object.keys(inputs);
  const rest: O = {
    ...options,
    inputs: undefined,
    symbolic: [...(options.symbolic ?? []), ...names],
  };
  const scope = compilationScope(expr, compileInputNames(rest));
  if (isCompileDeclineError(scope)) return scope;
  const types = new Map(
    names.map((name) => [name, ce.type(inputs[name]).type])
  );
  const run = (): X | CompileDeclineError =>
    withTypedInputs(types, () => runWithInputs());
  const runWithInputs = (): X | CompileDeclineError => {
    ce.pushScope();
    try {
      const occurrences: Record<string, Expression> = Object.create(null);
      for (const name of names) {
        ce.declare(name, inputs[name]);
        occurrences[name] = ce.symbol(name);
      }
      const bound = expr.subs(occurrences);
      // A name that a called body reads from a definition whose value
      // cannot be hidden (a constant, a function): the refusal names the
      // option `inputs`, which the caller gave, not `symbolic`.
      const refused = symbolicInputsRead(bound, names, 'inputs');
      if (isCompileDeclineError(refused)) return refused;
      return fn(bound, rest);
    } finally {
      ce.popScope();
    }
  };
  return scope === undefined ? run() : ce._inScope(scope, run);
}

/**
 * `compileExpression()` in the current scope. With `decline`, the
 * compilation declines with it, after the checks of the options.
 *
 * The built-in names (`BUILT_IN_TARGETS`) compile with the profile `ir`,
 * whether the option `profile` is given or not: `javascript`
 * (`ir/adapter.ts`), `glsl` (`ir/adapter-glsl.ts`) and `interval-js`
 * (`ir/adapter-interval.ts`). Another name is a decline that lists them.
 * A decline falls back in the catch below, or throws with
 * `fallback: false`.
 */
function compileInScope<
  T extends string = 'javascript',
  R = DefaultRunnerResult<T>,
>(
  expr: Expression,
  options?: CompileExpressionOptions<T>,
  decline?: CompileDeclineError
): CompilationResult<T, R> {
  assertCompilationOptionsContract(options);
  assertProfileTarget(options);
  const targetName = (options?.to ?? 'javascript') as T;

  // The `storage` hints, validated on EVERY target, outside the `try`: an
  // option-contract violation, not a compilation failure, which an
  // interpreter fallback must not swallow. The hint is ignored on the
  // non-shader targets, so an unknown storage kind or a hint naming
  // something that is not a free symbol of `expr` would otherwise pass
  // silently there. The hints are validated with no compiler: a hinted name
  // must be one that the run of the expression takes from its inputs
  // (`resolveStorageHintsOfInputs()`).
  if (options?.storage !== undefined)
    resolveStorageHintsOfInputs(options.storage, expr, {
      vars: compileInputNames(options),
    });

  try {
    if (decline !== undefined) throw decline;

    // The removed mode `'auto'`, from a host that does not type-check its
    // options: the `unsupported-mode` decline that names its replacement.
    if (
      (options?.mode as string) === 'auto' &&
      (targetName === 'javascript' || targetName === 'glsl')
    )
      throw new CompileDeclineError({
        code: 'unsupported-mode',
        kind: 'capability',
        message:
          "Could not compile: the mode 'auto' was removed. Request " +
          "mode: 'complex' for complex intermediate values, or omit the mode " +
          "for 'strict', the default.",
      });

    if (targetName === 'interval-js')
      return compileWithIrProfileInterval(
        expr,
        options
      ) as unknown as CompilationResult<T, R>;
    if (targetName === 'glsl')
      return compileWithIrProfileGlsl(
        expr,
        options
      ) as unknown as CompilationResult<T, R>;
    if (targetName === 'javascript')
      return compileWithIrProfile(
        expr,
        options
      ) as unknown as CompilationResult<T, R>;

    throw new Error(
      `Compilation target "${targetName}" is not a built-in target. ` +
        `Available targets: ${BUILT_IN_TARGETS.join(', ')}`
    );
  } catch (e) {
    // A cancellation that is not a timeout (an abort, an iteration or
    // recursion limit), or a timeout of an expired enclosing span, belongs
    // to the caller: it is thrown again, not changed into a fallback
    // (docs/TIMEOUT-MODEL.md §2).
    throwIfCallerCancellation(e, expr.engine._deadlineFrame);
    // A kind decline (an `enclosure` input or result on interval-js) has no
    // interpreter fallback: the target throws it even with `fallback: true`.
    // It is thrown again here, with no fallback warning and no second
    // compilation, which would throw the same decline again.
    if (isKindDeclineError(e)) throw e;
    // A decline on `interval-js` of an expression with an `enclosure` input
    // or result is a kind decline, whatever `fallback` says: it has no
    // interpreter fallback (`holdsEnclosureInputOrResult()`).
    if (
      options?.to === 'interval-js' &&
      isCompileDeclineError(e) &&
      holdsEnclosureInputOrResult(expr)
    )
      throw new KindDeclineError(compileDiagnosticOf(e, e.message));
    if (options?.fallback ?? true) {
      const error = (e as Error).message;
      const target = targetName;
      const inputNames = compileInputNames(options);
      const inputs = new Map(
        Object.keys(inputNames ?? {}).map((name) => [
          name,
          options?.inputs && Object.hasOwn(options.inputs, name)
            ? expr.engine.type(options.inputs[name]).type
            : undefined,
        ])
      );
      // The fallback of `interval-js` gives an interval-shaped `run`
      // (`buildIntervalFallback()`, which warns); the generic interpreter
      // fallback below returns plain numbers, which would violate the
      // interval-js result contract.
      if ((target as string) === 'interval-js') {
        if (holdsEnclosureInputOrResult(expr))
          throw new KindDeclineError(compileDiagnosticOf(e, error));
        // `target === 'interval-js'` pins `T` to 'interval-js' at runtime,
        // but TypeScript cannot correlate the narrowed string with the type
        // parameter — hence the two-step conversion.
        return buildIntervalFallback(
          expr,
          error,
          inputs,
          compileDiagnosticOf(e, error)
        ) as unknown as CompilationResult<T, R>;
      }
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: ${target}): ${error}`
      );
      // A decline: the result is built with no compiler
      // (`interpreterFallback()`). On a target other than `javascript` it
      // has no code; its `run` is the interpreter, as on `javascript`.
      return {
        ...interpreterFallback(
          expr,
          error,
          compileDiagnosticOf(e, error),
          inputs
        ),
        target,
      } as unknown as CompilationResult<T, R>;
    }
    throw e;
  }
}

/**
 * Whether `compile(expr, options)` gives code for `expr`.
 *
 * It takes the options of `compile()`. The answer depends on the
 * expression, the options and the declarations that the expression reaches
 * (the types of its free symbols, the definitions of the functions it
 * calls): a host that keeps the answer must discard it when one of those
 * declarations changes.
 *
 * It answers `{ ok: true, shippable }` exactly when `compile()` with the
 * same options gives code, with the `shippable` field of that result;
 * otherwise `{ ok: false, diagnostic }`, with the diagnostic of the decline
 * that `compile()` gives (`'outside-profile'` with the first node outside
 * the profile, or the code of another decline), or a `'compile-error'` with
 * the message of an invalid option. It runs the whole compilation, emission
 * included, so it costs as much as `compile()`.
 *
 * For a target that is not built in, the answer is `ok: false` with the
 * code `outside-fragment`.
 *
 * It never throws: an invalid expression or an invalid option gives
 * `ok: false` with the message of the error.
 */
export function canCompile(
  expr: Expression,
  options?: CompileExpressionOptions
): CanCompileResult {
  if (options?.inputs !== undefined && Object.keys(options.inputs).length > 0)
    try {
      const result = withCompileInputs(expr, options, (bound, rest) =>
        canCompile(bound, rest)
      );
      return isCompileDeclineError(result)
        ? { ok: false, diagnostic: result.diagnostic }
        : result;
    } catch (e) {
      // A type string that is not a type: the predicate does not throw.
      return { ok: false, diagnostic: optionErrorDiagnostic(e) };
    }
  const name = options?.to ?? 'javascript';
  if ((BUILT_IN_TARGETS as readonly string[]).includes(name)) {
    try {
      // The sets `symbolDeps` and `varsObjectRefs` are filled by a
      // compilation; the predicate writes nothing that the caller holds.
      const result = compile(expr, {
        ...options,
        symbolDeps: undefined,
        varsObjectRefs: undefined,
        fallback: false,
      });
      return { ok: true, shippable: result.shippable };
    } catch (e) {
      return { ok: false, diagnostic: compileDiagnosticOf(e) };
    }
  }
  try {
    assertCompilationOptionsContract(options);
    return {
      ok: false,
      diagnostic: {
        code: 'outside-fragment',
        kind: 'capability',
        message:
          `canCompile() answers for the targets ${BUILT_IN_TARGETS.join(', ')} ` +
          `only, not for the target '${name}'.`,
      },
    };
  } catch (e) {
    return { ok: false, diagnostic: optionErrorDiagnostic(e) };
  }
}
