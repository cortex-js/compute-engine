import type { MathJsonSymbol } from '../../math-json/types.js';
import { entrySource } from './function-purity.js';
import type { Expression, JSSource } from '../global-types.js';
import type {
  CompileMode,
  CompileTarget,
  CompilationOptions,
  CompilationResult,
  DefaultRunnerResult,
  StorageHint,
} from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { withDirectLoopPassReset } from './compile-loops.js';
import {
  CancellationError,
  throwIfCallerCancellation,
} from '../../common/interruptible.js';
import { resolveStorageHints } from './storage-hints.js';
import {
  compileDiagnosticOf,
  isCompileDeclineError,
  isKindDeclineError,
} from './diagnostics.js';
import { rawTargetCheck } from './raw-target-check.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { rewritePartialApplications } from './partial-application.js';
import {
  overriddenCompilationHeads,
  unrollFixedWidthCollections,
} from './fixed-width-unroll.js';
import { assertCompilationOptionsContract } from '../engine-extension-contracts.js';
import { withVarsValuesHidden } from './vars-inputs.js';
import { fragmentErrorDiagnostic } from './fragment.js';
import type { CanCompileResult } from './fragment.js';
import { ScalarFragmentJavaScriptTarget } from './javascript-fragment-target.js';
import { compileWithIrProfile, type IR_OPTIONS } from './ir/adapter.js';
import {
  jsProfileShadowConsumer,
  recordJsProfileShadow,
} from '../js-profile-switch.js';

export type { CanCompileResult } from './fragment.js';

export type CompileExpressionOptions<T extends string = string> = {
  to?: T;
  target?: CompileTarget<Expression>;
  operators?:
    | Partial<Record<MathJsonSymbol, [op: string, prec: number]>>
    | ((op: MathJsonSymbol) => [op: string, prec: number] | undefined);
  functions?: Record<
    MathJsonSymbol,
    JSSource | ((...args: unknown[]) => unknown)
  >;
  vars?: Record<MathJsonSymbol, JSSource>;
  imports?: unknown[];
  preamble?: string;
  fallback?: boolean;
  mode?: CompileMode;
  entryChecks?: boolean;
  broadcast?: boolean;
  iterationBudget?: number;
  quadrature?: 'adaptive' | 'monte-carlo';
  symbolDeps?: Set<MathJsonSymbol>;
  varsObjectRefs?: Set<MathJsonSymbol>;
  cse?: boolean;
  constantFold?: boolean;
  storage?: Readonly<Record<MathJsonSymbol, StorageHint>>;
  strictTypes?: boolean;
  profile?: 'numeric-kernel' | 'ir';
};

/**
 * Every option of `compile()` has a class in the profile `ir`
 * (`IR_OPTIONS` in `ir/adapter.ts`), and the table names no other option: a
 * new option fails this check until it is classified there.
 */
const IR_OPTIONS_CLASSIFIED: [keyof CompileExpressionOptions] extends [
  keyof typeof IR_OPTIONS,
]
  ? [keyof typeof IR_OPTIONS] extends [keyof CompileExpressionOptions]
    ? true
    : false
  : false = true;
void IR_OPTIONS_CLASSIFIED;

/**
 * Throw when the `profile` option is given with a target other than
 * `javascript`, or with a direct target (`target`): the profile is defined
 * for the JavaScript target only. It is an error of the options, thrown
 * whatever `fallback` says, as for the other invalid options.
 */
function assertProfileTarget(options: CompileExpressionOptions | undefined) {
  if (options?.profile === undefined) return;
  if (options.target !== undefined)
    throw new Error(
      `Invalid compilation option "profile": the profile "${options.profile}" is ` +
        'defined for the target "javascript" only, not for a direct target ' +
        '(the `target` option)'
    );
  const to = options.to ?? 'javascript';
  if (to !== 'javascript')
    throw new Error(
      `Invalid compilation option "profile": the profile "${options.profile}" is ` +
        `defined for the target "javascript" only, not for "${to}"`
    );
}

/**
 * Compile a boxed expression.
 *
 * Returns a `CompilationResult` with the generated source code and,
 * for JS-executable targets, a `run` function.
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
 * With `profile: 'numeric-kernel'` (experimental, `javascript` only), the
 * structured compiler of the JavaScript target compiles the expression,
 * and the result reports `profile`, `pure` and `shippable`
 * (`CompilationOptions.profile`).
 *
 * ## Real-only special functions (compile targets)
 *
 * The built-in targets implement most special functions (`Erf`, `Gamma`,
 * `Zeta`, the Bessel/Airy family, …) with **real-only** library helpers
 * (`_SYS.erf`, `scipy.special.erf`, GLSL `log2`, …). They accept a real scalar
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
 *
 * With the internal shadow measure `ce._jsProfileShadow` on, a compilation
 * is also measured with the profile (`compileWithShadow()`).
 */
export function compile<
  T extends string = 'javascript',
  R = DefaultRunnerResult<T>,
>(
  expr: Expression,
  options?: CompileExpressionOptions<T>
): CompilationResult<T, R> {
  const ce = expr.engine;
  if (ce._jsProfileShadow && shadowDepth === 0 && !ce._opensOperation(false)) {
    const consumer = shadowConsumerOf(options);
    if (consumer !== undefined)
      return compileWithShadow(expr, options, consumer);
  }
  return compileExpression(expr, options);
}

/**
 * The number of compilations with the profile of the shadow measure in
 * progress: a compilation that one of them starts is not measured.
 */
let shadowDepth = 0;

/**
 * The consumer under which the shadow measure counts a compilation with
 * `options` (`jsProfileShadowConsumer()`), or `undefined` when it is not
 * measured: a target other than `javascript`, a direct target, a profile
 * asked for, or a compilation of `implicitCompile()` that follows an
 * attempt of its switch.
 */
function shadowConsumerOf(
  options: CompileExpressionOptions | undefined
): string | undefined {
  if (
    options !== undefined &&
    (options.profile !== undefined ||
      options.target !== undefined ||
      (options.to ?? 'javascript') !== 'javascript')
  )
    return undefined;
  return jsProfileShadowConsumer(options);
}

/**
 * The compilation of `expr` with `options`, and then, for the shadow
 * measure, a compilation of `expr` with the same options and the profile
 * `numeric-kernel` (or `ir` when `ce._jsProfileShadow` is `'ir'`), whose outcome is counted under `consumer`
 * (`recordJsProfileShadow()`) and whose result is discarded. The result,
 * or the error, is that of the first compilation. A cancellation of the
 * first compilation is thrown with no second one.
 *
 * The second compilation writes nothing that the caller reads: it has
 * `fallback: false` (no warning, no interpreter fallback), fresh sets in
 * place of `symbolDeps` and `varsObjectRefs`, and every error it throws,
 * a cancellation included, is caught and counted `failed`. A compilation
 * that it starts is not measured (`shadowDepth`).
 */
function compileWithShadow<T extends string, R>(
  expr: Expression,
  options: CompileExpressionOptions<T> | undefined,
  consumer: string
): CompilationResult<T, R> {
  let result: CompilationResult<T, R>;
  try {
    result = compileExpression<T, R>(expr, options);
  } catch (e) {
    // No second compilation after a cancellation, or after an `EvalError`:
    // a Content Security Policy that blocks dynamic code would report a
    // second violation.
    if (!isCancellationError(e) && !(e instanceof EvalError))
      measureProfile(expr, options, consumer, false, (e as Error)?.message);
    throw e;
  }
  measureProfile(
    expr,
    options,
    consumer,
    result.success === true,
    result.error
  );
  return result;
}

/** Compile `expr` with `options` and the profile, and count the outcome
 * (`compileWithShadow()`). */
function measureProfile(
  expr: Expression,
  options: CompileExpressionOptions | undefined,
  consumer: string,
  baselineSucceeded: boolean,
  baselineMessage?: string
): void {
  const ce = expr.engine;
  // The profile lowers a node reached on several paths once where it can,
  // and declines a program over its limit of operations
  // (`STRUCTURED_OPERATION_LIMIT`), so the measure cannot hang.
  shadowDepth += 1;
  try {
    const result = compileExpression(expr, {
      ...options,
      ...(options?.symbolDeps === undefined ? {} : { symbolDeps: new Set() }),
      ...(options?.varsObjectRefs === undefined
        ? {}
        : { varsObjectRefs: new Set() }),
      profile: ce._jsProfileShadow === 'ir' ? 'ir' : 'numeric-kernel',
      fallback: false,
    });
    if (result.success === true)
      recordJsProfileShadow(
        ce,
        consumer,
        baselineSucceeded,
        'admitted',
        undefined,
        baselineMessage
      );
    else {
      const diagnostic = result.diagnostic;
      recordJsProfileShadow(
        ce,
        consumer,
        baselineSucceeded,
        diagnostic?.code === 'outside-profile' ? 'declined' : 'failed',
        diagnostic === undefined
          ? result.error
          : profileMessage(diagnostic.code, diagnostic.message),
        baselineMessage
      );
    }
  } catch (e) {
    const diagnostic = compileDiagnosticOf(e);
    recordJsProfileShadow(
      ce,
      consumer,
      baselineSucceeded,
      isCompileDeclineError(e) && diagnostic.code === 'outside-profile'
        ? 'declined'
        : 'failed',
      profileMessage(diagnostic.code, diagnostic.message),
      baselineMessage
    );
  } finally {
    shadowDepth -= 1;
  }
}

/** The message of an outcome of the profile, with its code unless the code
 * is `outside-profile`. */
function profileMessage(code: string, message: string): string {
  return code === 'outside-profile' ? message : `${code}: ${message}`;
}

/** Whether `e` is a cancellation (a deadline, an abort, a limit). */
function isCancellationError(e: unknown): boolean {
  return (
    e instanceof CancellationError ||
    (e as { name?: unknown } | undefined)?.name === 'CancellationError'
  );
}

/** The compilation of `compile()`, with no shadow measure. */
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
  assertCompilationOptionsContract(options);
  assertProfileTarget(options);
  // (The shared per-compilation budgets — the antiderivative pool — are NOT
  // reset here: this entry is not the only compilation route (a registered
  // target invoked directly bypasses it), so the reset lives at the depth-0
  // boundary of `BaseCompiler.compile`, which every route crosses.)

  // An option-contract violation, not a compilation failure: raised outside
  // the `try` so the interpreter fallback cannot swallow it. A direct custom
  // target does not support CSE, so an explicit `cse: true` here
  // is a request that cannot be honored — silently stamping it off would leave
  // the caller believing CSE ran.
  if (options?.target !== undefined && options.cse === true)
    throw new Error(
      'CSE is not supported on direct custom targets in Phase 1; omit `cse` ' +
        'or use a registered target.'
    );

  // The `storage` hints, validated on EVERY target — the same option-contract
  // class as the CSE check above, and outside the `try` for the same reason:
  // the hint is ignored on the non-shader targets, so an unknown storage kind
  // or a hint naming something that is not a free symbol of `expr` would
  // otherwise pass silently there, and an interpreter fallback must not
  // swallow the error either. A registered target validates again in its own
  // `compile()` (the route that bypasses this entry); the check is idempotent.
  // An unregistered `to` has no target to analyze references with; it is
  // skipped here and reported by the registry lookup below, as before.
  //
  // A DIRECT custom target refuses a non-empty hint set outright, like CSE: the
  // gate that fails a sampler-backed symbol closed outside a positional read,
  // and the preamble channel that delivers the texel helper, both live in the
  // registered shader target's own `compile()`. A raw `createTarget()` target
  // has neither, so honoring the hint there would emit a bare `S` as a value
  // and a helper call with no declaration behind a reported success.
  if (
    options?.target !== undefined &&
    options.storage !== undefined &&
    Object.keys(options.storage).length > 0
  )
    throw new Error(
      'The `storage` option is not supported on direct custom targets: the ' +
        'sampler-backed read needs the reference gate and the helper ' +
        'preamble a registered target provides. Omit `storage` or use a ' +
        'registered target (`to: "glsl"`).'
    );
  if (options?.target === undefined && options?.storage !== undefined) {
    const analysisTarget = expr.engine
      ._getCompilationTarget(options.to ?? 'javascript')
      ?.createTarget();
    if (analysisTarget !== undefined)
      resolveStorageHints(options.storage, [expr], analysisTarget, {
        vars: options.vars,
        functions: options.functions,
      });
  }

  try {
    // Determine the target to use
    if (options?.target) {
      // Direct target override - use BaseCompiler. Registered language
      // targets apply the angular-unit rewrite in their own compile();
      // this raw-target path must do it itself. `compileRoot` opens the
      // compilation boundary: the caller's target may be one it built once
      // and reuses, and per-compilation numbering must restart for each
      // `compile()` call (recompile-replay determinism).
      // The fixed-width unroll turns a collection whose width is known at
      // compile time into straight-line scalar code; like the angular-unit
      // rewrite it is target independent, and a raw target gets it here
      // because it has no `compileOrThrow` of its own to apply it
      // (`fixed-width-unroll.ts`).
      // Caller-defined heads receive their original operands. Other
      // applied literals infer bare parameter types from arguments they
      // bind whole, before fixed-width collections are expanded.
      const skipHeads = overriddenCompilationHeads(
        options.operators,
        options.functions
      );
      const unrolled = unrollFixedWidthCollections(
        rewritePartialApplications(rewriteAngularUnit(expr), skipHeads),
        {
          skipHeads,
          // The budget a DIRECT target applies is its own; the
          // `iterationBudget` option is read by the registered-target route
          // only.
          iterationBudget: options.target.iterationBudget,
          readsLiveSource: (name) => typeof options.vars?.[name] === 'string',
        }
      );
      // A target that has no lowering of `Apply` writes each application of
      // a derivative as the closed form applied to its arguments
      // (`CompileTarget.applyDerivatives`, the GLSL target). Its check
      // (`rawTargetCheck()` below) types the tree of its own preparation,
      // which has this rewrite, so the tree written here has it too. An
      // application that the rewrite leaves is refused by the check.
      const rewritten =
        options.target.applyDerivatives?.(unrolled, options.target) ?? unrolled;
      // Install a fresh naming context for generated temporaries on every call,
      // so a target the caller reuses never carries stale numbering into the
      // next compilation; `compileRoot`'s signature is unchanged — this is the
      // options channel. Seeded with the names this compilation must not
      // reuse: the expression's own symbols and any `_tv`/`_cse` token in the
      // source the caller splices in.
      const namingSources = [
        options.preamble,
        options.target.preamble,
        ...(options.vars ? Object.values(options.vars) : []),
        ...(options.functions
          ? Object.values(options.functions).map((f) => {
              // Through `entrySource`, so a `{ source, pure? }` descriptor
              // whose source is a string still has that text scanned for the
              // `_tv`/`_cse` identifiers this compilation must not reuse. A
              // bare-object read would map every descriptor to `undefined` and
              // silently drop the collision check.
              const source = entrySource(f);
              return typeof source === 'string' ? source : undefined;
            })
          : []),
      ];
      options.target.naming = BaseCompiler.newNamingContext(
        rewritten,
        namingSources
      );
      // A direct custom target gets no CSE: a `cseBind` attests binding syntax,
      // not that the target's other emitters
      // are pure and eager, and its resolver closures carry no override
      // provenance for the emission-purity gate (G1b) to consult. Stamped per
      // call, like the naming context, so a reused caller target never carries
      // stale state.
      // The option-contract check before this `try` rejects explicit
      // `cse: true`;
      // omitting the option keeps the silent off.
      options.target.cse = { enabled: false, instances: [] };
      // Stamp the caller's constant-folding choice per call, like the naming
      // context and CSE state above, so a reused caller target never carries a
      // previous call's setting. Stamped UNCONDITIONALLY: an omitted option
      // must reset the field to `undefined` (= enabled, the BaseCompiler
      // default), or a target reused after a `constantFold: false` call would
      // silently keep folding disabled.
      options.target.constantFold = options.constantFold;
      // No storage hints reach a direct target (refused above when non-empty),
      // and the field is cleared per call for the same reason as the
      // `constantFold` stamp above: a reused caller target must not carry
      // state from a previous call.
      options.target.storage = undefined;
      // The requested compile mode, stamped per call (an omitted option must
      // reset the field, like the two above, so a reused target never keeps
      // a previous call's mode). A requested mode the target does not offer
      // is the `unsupported-mode` decline, raised by `BaseCompiler.compile`
      // when it latches the mode.
      options.target.mode = options.mode;
      // A target object made by a language target whose emitter relies on a
      // typing pass (the GLSL target) carries that pass
      // (`raw-target-check.ts`). It runs on the expression as the caller
      // wrote it, with the preparation and the pass of `canCompile()`, and a
      // refusal declines with the diagnostic of `canCompile()`; any other
      // error propagates (a cancellation reaches the catch below as itself).
      // It runs after the per-call fields above are reset, so that a reused
      // target object keeps no field of a previous call after a decline.
      //
      // The options are those that the raw route applies: `vars` (whose
      // values the pass hides, as the raw route does below), the budget of
      // the target object, no common-subexpression pass, and the
      // constant-folding choice. `functions` and `preamble` are not passed:
      // the raw route does not install them, so the stock lowering of each
      // head is written, and the pass must judge that head by its own
      // signature. `mode` is not passed: a mode that the target does not
      // offer is the `unsupported-mode` decline of `BaseCompiler.compile`
      // below.
      //
      // The pass judges the tree of its own preparation (which also writes
      // point values and some calls of user functions in place), while the
      // raw route writes `rewritten`, which is prepared less. The check
      // makes the raw route decline what `compile()` with `to: 'glsl'`
      // declines; it does not judge each emission. Its cost is one
      // preparation and one pass in addition to the compilation.
      const check = rawTargetCheck(options.target);
      if (check !== undefined)
        check(expr, {
          vars: options.vars,
          iterationBudget: options.target.iterationBudget,
          cse: false,
          constantFold: options.constantFold,
        } as CompilationOptions<Expression>);
      // A `vars`-mapped symbol is compiled as the valueless input of its
      // declared type (`withVarsValuesHidden`), as on a registered target.
      // The `vars` keys also ride on the target (`varsKeys`), so neither the
      // constant folder nor the symbol read folds the value of a mapped
      // symbol the hiding does not cover (one whose type was inferred from
      // its value): it stays a live input. The keys are stamped on the
      // caller's target object for this call only, and the previous value is
      // restored when the call ends, because the caller can reuse the target
      // for a compilation with other `vars`. The target is not copied: a copy
      // made with object spread loses the methods of a class-instance target,
      // and a hook that writes to `this` writes to the copy.
      // The reachability memo of the constant folder (`foldReachMemo`) is
      // replaced by an empty one for this call and restored with `varsKeys`.
      // Its answers depend on the `vars` keys and on the engine's
      // definitions, and both can change between two calls on the same
      // target: an answer cached by a call without `u` among the keys would
      // let a later call with `vars: { u }` fold a function that reads `u`.
      const vars = options.vars;
      const target = options.target;
      const previousVarsKeys = target.varsKeys;
      const previousFoldReachMemo = target.foldReachMemo;
      target.foldReachMemo = new Map();
      if (vars !== undefined && Object.keys(vars).length > 0)
        target.varsKeys = new Set([
          ...(previousVarsKeys ?? []),
          ...Object.keys(vars),
        ]);
      let direct: CompilationResult<T, R>;
      try {
        direct = withVarsValuesHidden(expr, vars, () => {
          const code = withDirectLoopPassReset(
            rewritten,
            target,
            BaseCompiler.compileRoot(rewritten, target)
          );
          return BaseCompiler.withReferences(
            {
              target: (target.language ?? 'custom') as T,
              success: true,
              code,
            } as CompilationResult<T, R>,
            expr,
            target,
            vars ? new Set(Object.keys(vars)) : undefined
          );
        });
      } finally {
        target.varsKeys = previousVarsKeys;
        target.foldReachMemo = previousFoldReachMemo;
      }
      return strictTypesChecked(expr, direct, options, undefined);
    }

    const targetName = (options?.to ?? 'javascript') as T;

    // Look up the target in the registry
    const languageTarget = expr.engine._getCompilationTarget(targetName);

    if (!languageTarget) {
      throw new Error(
        `Compilation target "${targetName}" is not registered. Available targets: ${expr.engine
          ._listCompilationTargets()
          .join(', ')}`
      );
    }

    // Use the language target to compile. `fallback` is passed through so the
    // target normalizes its own failures — this matters for interval-js, whose
    // primary failure class returns `success: false` WITHOUT throwing (so the
    // catch below never sees it); without the pass-through such a decline
    // reached the caller with no `run` at all, violating the fallback
    // contract. The catch below remains for custom registered targets and
    // pre-compile errors.
    const targetOptions = {
      fallback: options?.fallback ?? true,
      operators: options?.operators,
      functions: options?.functions,
      vars: options?.vars,
      imports: options?.imports,
      preamble: options?.preamble,
      mode: options?.mode,
      entryChecks: options?.entryChecks,
      broadcast: options?.broadcast,
      iterationBudget: options?.iterationBudget,
      quadrature: options?.quadrature,
      symbolDeps: options?.symbolDeps,
      varsObjectRefs: options?.varsObjectRefs,
      cse: options?.cse,
      constantFold: options?.constantFold,
      storage: options?.storage,
    };
    // The `numeric-kernel` profile compiles on the structured route of the
    // JavaScript target (`ScalarFragmentJavaScriptTarget`), with the
    // assembly of the JavaScript target.
    // The profile `ir` (experimental) compiles with the IR compiler
    // (`ir/adapter.ts`); a decline falls back in the catch below.
    if (options?.profile === 'ir')
      return compileWithIrProfile(expr, options) as unknown as CompilationResult<
        T,
        R
      >;
    if (options?.profile === 'numeric-kernel')
      return strictTypesChecked(
        expr,
        new ScalarFragmentJavaScriptTarget('structured').compile(expr, {
          ...targetOptions,
          profile: 'numeric-kernel',
        }) as unknown as CompilationResult<T, R>,
        options,
        languageTarget
      );
    return strictTypesChecked(
      expr,
      languageTarget.compile(expr, targetOptions) as CompilationResult<T, R>,
      options,
      languageTarget
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
    if (options?.fallback ?? true) {
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: ${options?.to ?? 'javascript'}): ${error}`
      );
      const target = (options?.to ?? 'javascript') as T;
      // The interval target's own fallback wrapper produces an
      // interval-shaped `run` (degenerate `{lo, hi}` intervals); the generic
      // interpreter fallback below returns plain numbers, which would violate
      // the interval-js result contract. Delegate to the target.
      if ((target as string) === 'interval-js') {
        const registered = expr.engine._getCompilationTarget('interval-js');
        // `target === 'interval-js'` pins `T` to 'interval-js' at runtime,
        // but TypeScript cannot correlate the narrowed string with the type
        // parameter — hence the two-step conversion.
        if (registered)
          return registered.compile(expr, {
            vars: options?.vars,
            fallback: true,
          }) as unknown as CompilationResult<T, R>;
      }
      const compileTarget =
        options?.target ??
        expr.engine._getCompilationTarget(target as string)?.createTarget();
      // The fallback builds the ordinary (default-`R`) result; `R` is a
      // caller-supplied narrowing assertion with no runtime counterpart, so
      // it is re-applied here rather than threaded through the builder.
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        target,
        compileTarget,
        options?.vars ? new Set(Object.keys(options.vars)) : undefined,
        compileDiagnosticOf(e, error)
      ) as CompilationResult<T, R>;
    }
    throw e;
  }
}

/**
 * Whether `compile(expr, options)` gives code for `expr`, without writing
 * code: `{ ok: true }`, or `{ ok: false, diagnostic }` with the code
 * `outside-fragment`, naming the first node outside the fragment of the
 * target (its head in `operator`, or the name of a free symbol without a
 * numeric type in `binding`).
 *
 * It takes the options of `compile()`. The answer depends on the
 * expression, the options and the declarations that the expression reaches
 * (the types of its free symbols, the definitions of the functions it
 * calls): a host that keeps the answer must discard it when one of those
 * declarations changes.
 *
 * Only the `glsl` target has a fragment. For another target, or a direct
 * custom target (`target` option), the answer is `ok: false`: the predicate
 * has no list of what that target compiles, and a "yes" that `compile()`
 * then contradicts would be wrong.
 *
 * **Experimental.** With the option `profile: 'numeric-kernel'` (and the
 * target `javascript`), it answers for the profile: `{ ok: true, pure,
 * shippable }` exactly when `compile()` with the same options gives code,
 * with the `pure` and `shippable` fields of that result; otherwise `{ ok:
 * false, diagnostic }`, with the diagnostic of the decline that `compile()`
 * gives (`'outside-profile'` with the first node outside the profile, or
 * the code of another decline), or a `'compile-error'` with the message of
 * an invalid option. It runs the whole compilation, emission included, so
 * it costs as much as `compile()`. With `profile: 'ir'` (experimental too),
 * it answers in the same way for that profile; its positive answer has
 * `shippable: false` and no `pure`.
 *
 * It never throws: an invalid expression, an invalid option or an error of
 * the preparation of the tree gives `ok: false` with the message of the
 * error.
 */
export function canCompile(
  expr: Expression,
  options?: CompileExpressionOptions
): CanCompileResult {
  if (options?.profile !== undefined) {
    try {
      // The sets `symbolDeps` and `varsObjectRefs` are filled by a
      // compilation; the predicate writes nothing that the caller holds.
      const result = compile(expr, {
        ...options,
        symbolDeps: undefined,
        varsObjectRefs: undefined,
        fallback: false,
      });
      return {
        ok: true,
        pure: result.pure,
        shippable: result.shippable,
        ...(result.defaultedSymbols === undefined
          ? {}
          : { defaultedSymbols: result.defaultedSymbols }),
      };
    } catch (e) {
      return { ok: false, diagnostic: compileDiagnosticOf(e) };
    }
  }
  try {
    assertCompilationOptionsContract(options);
    if (!expr.isValid)
      return {
        ok: false,
        diagnostic: {
          code: 'outside-fragment',
          kind: 'capability',
          message: `Could not compile: the expression is not valid.`,
          value: expr.toString(),
        },
      };
    const name =
      options?.target === undefined ? (options?.to ?? 'javascript') : undefined;
    const languageTarget =
      name === undefined ? undefined : expr.engine._getCompilationTarget(name);
    const check = (
      languageTarget as
        | {
            canCompile?: (
              expr: Expression,
              options: Record<string, unknown>
            ) => CanCompileResult;
          }
        | undefined
    )?.canCompile;
    if (name !== 'glsl' || typeof check !== 'function')
      return {
        ok: false,
        diagnostic: {
          code: 'outside-fragment',
          kind: 'capability',
          message:
            `canCompile() answers for the 'glsl' target only: the target ` +
            `'${name ?? 'custom'}' has no fragment definition. Call compile().`,
        },
      };
    return check.call(languageTarget, expr, {
      functions: options?.functions,
      vars: options?.vars,
      preamble: options?.preamble,
      mode: options?.mode,
      iterationBudget: options?.iterationBudget,
      cse: options?.cse,
      constantFold: options?.constantFold,
      storage: options?.storage,
      strictTypes: options?.strictTypes,
    });
  } catch (e) {
    return { ok: false, diagnostic: fragmentErrorDiagnostic(e) };
  }
}

/**
 * The error of the `strictTypes` option for the type report `types` of the
 * free symbols (`CompilationResult.freeSymbolTypes`): the message, and the
 * names of the free symbols whose type was inferred from their uses, not
 * declared. `undefined` when every free symbol is declared.
 */
export function strictTypesError(
  types: CompilationResult['freeSymbolTypes'] | undefined
): { message: string; names: string[] } | undefined {
  const undeclared = Object.entries(types ?? {}).filter(
    ([, t]) => t.provenance !== 'declared'
  );
  if (undeclared.length === 0) return undefined;
  const message =
    `strictTypes: ` +
    undeclared
      .map(
        ([name, t]) =>
          `declare \`${name}\` (inferred \`${t.type}\`, would lower to ` +
          `\`${t.lowered}\`)`
      )
      .join(', ') +
    `. Every free symbol must have a declaration (\`ce.declare\`) when the ` +
    `\`strictTypes\` option is set.`;
  return { message, names: undeclared.map(([name]) => name) };
}

/**
 * Apply the `strictTypes` option to the result of a compilation: when it is
 * set and the compilation succeeded, every free symbol must have a
 * declaration. A free symbol whose type was inferred from its uses turns the
 * result into a decline, whose error names the symbol, the inferred type and
 * the type the code reads it as (`CompilationResult.freeSymbolTypes`).
 *
 * The decline follows the `fallback` option: it throws when `fallback` is
 * `false`, and otherwise returns the `success: false` result with an
 * interpreter-backed `run`. That result keeps the type report of the
 * compilation, which a fresh analysis could not reproduce (a shader reads a
 * colour operand as a `vec3` only because the emission recorded it). On
 * interval-js the result keeps the compiled `run`, which already honours the
 * interval value contract that the generic interpreter fallback does not.
 */
function strictTypesChecked<T extends string, R>(
  expr: Expression,
  result: CompilationResult<T, R>,
  options: CompileExpressionOptions<T> | undefined,
  languageTarget: { createTarget(): CompileTarget<Expression> } | undefined
): CompilationResult<T, R> {
  if (options?.strictTypes !== true || !result.success) return result;
  const error = strictTypesError(result.freeSymbolTypes)?.message;
  if (error === undefined) return result;
  const e = new Error(error);
  if (options.fallback === false) throw e;
  console.warn(
    `Compilation fallback for "${expr.operator}" (target: ${result.target}): ${error}`
  );
  const diagnostic = compileDiagnosticOf(e, error);
  if ((result.target as string) === 'interval-js')
    return { ...result, success: false, code: '', error, diagnostic };
  const fallback = BaseCompiler.buildInterpreterFallback(
    expr,
    error,
    result.target,
    options.target ?? languageTarget?.createTarget(),
    options.vars ? new Set(Object.keys(options.vars)) : undefined,
    diagnostic
  ) as CompilationResult<T, R>;
  fallback.freeSymbolTypes = result.freeSymbolTypes;
  return fallback;
}
