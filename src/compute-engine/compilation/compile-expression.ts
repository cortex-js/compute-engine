import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Expression, JSSource } from '../global-types.js';
import type { CompileMode, CompileTarget, CompilationResult } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { assertCompilationOptionsContract } from '../engine-extension-contracts.js';

type CompileExpressionOptions<T extends string = string> = {
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
  realOnly?: boolean;
  complexPromotion?: boolean;
  mode?: CompileMode;
  entryChecks?: boolean;
  iterationBudget?: number;
  quadrature?: 'adaptive' | 'monte-carlo';
  symbolDeps?: Set<MathJsonSymbol>;
  cse?: boolean;
  constantFold?: boolean;
};

/**
 * Compile a boxed expression.
 *
 * Returns a `CompilationResult` with the generated source code and,
 * for JS-executable targets, a `run` function.
 *
 * When `realOnly` is true, the return type of `run` is narrowed to `number`.
 *
 * `mode` selects the arithmetic discipline (`'strict'` | `'complex'` |
 * `'auto'`, see `CompileMode` in `compilation/types.ts`); the effective mode
 * is `options.mode` ?? the target's `mode` ?? the target's default (`'auto'`
 * where offered, else `'strict'`), and a mode the target does not offer is a
 * `capability` decline. The result reports the discipline used (`mode`),
 * whether a radical was promoted (`promoted`) and, on a decline, the
 * structured `diagnostic` beside `error`.
 *
 * If the expression cannot be compiled, falls back to interpretation
 * (success: false, run: applicableN1) unless `options.fallback` is false,
 * in which case it throws.
 *
 * ## Real-only special functions (compile targets)
 *
 * The built-in targets implement most special functions (`Erf`, `Gamma`,
 * `Zeta`, the Bessel/Airy family, …) with **real-only** library helpers
 * (`_SYS.erf`, `scipy.special.erf`, GLSL `log2`, …). They accept a real scalar
 * only. Elementary functions that *do* have a complex extension (`Sin`, `Exp`,
 * `Sqrt`, `Power`, …) dispatch to a complex helper when an argument is
 * complex-valued; the real-only special functions do not. Rather than hand a
 * complex value to a real helper — which silently returns garbage (e.g. a
 * compiled `Erf(z)` returning −1) — the compiler **fails closed** (D6) with the
 * offending head. Compile such subexpressions numerically, or restrict them to
 * real arguments. (`Real`/`Imaginary`/`Argument`/`Conjugate` are exempt: they
 * consume a complex value by design.)
 */
export function compile<T extends string = 'javascript'>(
  expr: Expression,
  options: CompileExpressionOptions<T> & { realOnly: true }
): CompilationResult<T, number>;
export function compile<T extends string = 'javascript'>(
  expr: Expression,
  options?: CompileExpressionOptions<T>
): CompilationResult<T>;
export function compile<T extends string = 'javascript'>(
  expr: Expression,
  options?: CompileExpressionOptions<T>
): CompilationResult<T> {
  assertCompilationOptionsContract(options);

  // An option-contract violation, not a compilation failure: raised OUTSIDE
  // the `try` so the interpreter fallback cannot swallow it. A direct custom
  // target never gets CSE in Phase 1 (§4.2), so an EXPLICIT `cse: true` here
  // is a request that cannot be honored — silently stamping it off would leave
  // the caller believing CSE ran.
  if (options?.target !== undefined && options.cse === true)
    throw new Error(
      'CSE is not supported on direct custom targets in Phase 1; omit `cse` ' +
        'or use a registered target.'
    );

  try {
    // Determine the target to use
    if (options?.target) {
      // Direct target override - use BaseCompiler. Registered language
      // targets apply the angular-unit rewrite in their own compile();
      // this raw-target path must do it itself. `compileRoot` opens the
      // compilation boundary: the caller's target may be one it built once
      // and reuses, and per-compilation numbering must restart for each
      // `compile()` call (recompile-replay determinism).
      const rewritten = rewriteAngularUnit(expr);
      // Stamp a FRESH naming context for the generated temporaries. Per-call,
      // so a target the caller reuses never carries stale numbering into the
      // next compilation; `compileRoot`'s signature is unchanged — this is the
      // options channel. Seeded with the names this compilation must not
      // reuse: the expression's own symbols and any `_tv`/`_cse` token in the
      // source the caller splices in.
      options.target.naming = BaseCompiler.newNamingContext(rewritten, [
        options.preamble,
        options.target.preamble,
        ...(options.vars ? Object.values(options.vars) : []),
        ...(options.functions
          ? Object.values(options.functions).map((f) =>
              typeof f === 'string' ? f : undefined
            )
          : []),
      ]);
      // A DIRECT custom target gets no CSE in Phase 1 (design §4.2): a
      // `cseBind` attests binding SYNTAX, not that the target's other emitters
      // are pure and eager, and its resolver closures carry no override
      // provenance for the emission-purity gate (G1b) to consult. Stamped per
      // call, like the naming context, so a reused caller target never carries
      // stale state.
      // An EXPLICIT `cse: true` is rejected up front (see above the `try`):
      // omitting the option keeps the silent off.
      options.target.cse = { enabled: false, instances: [] };
      // Stamp the caller's constant-folding choice per call, like the naming
      // context and CSE state above, so a reused caller target never carries a
      // previous call's setting. Stamped UNCONDITIONALLY: an omitted option
      // must reset the field to `undefined` (= enabled, the BaseCompiler
      // default), or a target reused after a `constantFold: false` call would
      // silently keep folding disabled.
      options.target.constantFold = options.constantFold;
      // Stamped unconditionally for the same reason as `constantFold` above: an
      // omitted option must reset the field, or a target reused after a
      // `complexPromotion: true` call would silently keep promoting.
      options.target.complexPromotion = options.complexPromotion;
      // The effective compile mode, resolved for a DIRECT target and stamped
      // per call (an omitted option must reset the field, like the two
      // above). A direct target offers `'complex'` only with the two lowering
      // hooks and `'auto'` only with `reset()` as well (there is no fresh
      // per-compilation target to retry on); a requested `'auto'` that the
      // target declares but cannot retry resolves to `'strict'`, as
      // documented on `CompileTarget.supportedModes`. A requested mode the
      // target does not declare at all is the `unsupported-mode` decline,
      // raised by `BaseCompiler.compile` when it latches the mode.
      options.target.mode = resolveDirectTargetMode(
        options.target,
        options.mode
      );
      const code = BaseCompiler.compileRoot(rewritten, options.target);
      return BaseCompiler.withReferences(
        {
          target: (options.target.language ?? 'custom') as T,
          success: true,
          code,
        } as CompilationResult<T>,
        expr,
        options.target,
        options.vars ? new Set(Object.keys(options.vars)) : undefined
      );
    }

    const targetName = (options?.to ?? 'javascript') as T;

    // Look up the target in the registry
    const languageTarget = expr.engine.getCompilationTarget(targetName);

    if (!languageTarget) {
      throw new Error(
        `Compilation target "${targetName}" is not registered. Available targets: ${expr.engine
          .listCompilationTargets()
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
    return languageTarget.compile(expr, {
      fallback: options?.fallback ?? true,
      operators: options?.operators,
      functions: options?.functions,
      vars: options?.vars,
      imports: options?.imports,
      preamble: options?.preamble,
      realOnly: options?.realOnly,
      complexPromotion: options?.complexPromotion,
      mode: options?.mode,
      entryChecks: options?.entryChecks,
      iterationBudget: options?.iterationBudget,
      quadrature: options?.quadrature,
      symbolDeps: options?.symbolDeps,
      varsObjectRefs: options?.varsObjectRefs,
      cse: options?.cse,
      constantFold: options?.constantFold,
    }) as CompilationResult<T>;
  } catch (e) {
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
        const registered = expr.engine.getCompilationTarget('interval-js');
        // `target === 'interval-js'` pins `T` to 'interval-js' at runtime,
        // but TypeScript cannot correlate the narrowed string with the type
        // parameter — hence the two-step conversion.
        if (registered)
          return registered.compile(expr, {
            vars: options?.vars,
            fallback: true,
          }) as unknown as CompilationResult<T>;
      }
      const compileTarget =
        options?.target ??
        expr.engine.getCompilationTarget(target as string)?.createTarget();
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        target,
        compileTarget,
        options?.vars ? new Set(Object.keys(options.vars)) : undefined,
        compileDiagnosticOf(e, error),
        options?.realOnly
      );
    }
    throw e;
  }
}

/**
 * The effective compile mode for a DIRECT (caller-owned) target: the modes it
 * OFFERS are its declared `supportedModes` (default `['strict']`) narrowed by
 * the hooks each needs — `'complex'` needs `complexLift` and `complexIsReal`
 * (the declaration contract already rejects a target declaring it without
 * them), `'auto'` needs those and `reset()`. A requested `'auto'` that is
 * declared but not offered (no `reset()`) resolves to `'strict'`; the
 * default with nothing requested is `'auto'` when offered, else `'strict'`.
 * Any other requested mode is returned as-is for `BaseCompiler.compile` to
 * validate against the declared list (the `unsupported-mode` decline).
 *
 * Only the per-call `options.mode` is "requested". The resolved value is
 * STAMPED onto `target.mode` by the caller (like `constantFold` and
 * `complexPromotion`), so on a reused direct target `target.mode` holds the
 * PREVIOUS call's resolution — reading it back as a request would make an
 * omitted `mode` inherit the last explicit choice instead of resetting to the
 * target's default.
 */
function resolveDirectTargetMode(
  target: CompileTarget<Expression>,
  requested: CompileMode | undefined
): CompileMode {
  const declared: readonly CompileMode[] = target.supportedModes ?? ['strict'];
  const hasLowering =
    typeof target.complexLift === 'function' &&
    typeof target.complexIsReal === 'function';
  const offersAuto =
    declared.includes('auto') &&
    hasLowering &&
    typeof target.reset === 'function';
  if (requested === undefined) return offersAuto ? 'auto' : 'strict';
  if (requested === 'auto' && declared.includes('auto') && !offersAuto)
    return 'strict';
  return requested;
}
