import type { MathJsonSymbol } from '../../math-json/types.js';
import { entrySource } from './function-purity.js';
import type { Expression, JSSource } from '../global-types.js';
import type {
  CompileDiagnostic,
  CompileMode,
  CompileTarget,
  CompilationResult,
  DefaultRunnerResult,
} from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { compileDiagnosticOf, isLaneMismatchError } from './diagnostics.js';
import { normalizeDeprecatedCompileOptions } from './deprecation-warnings.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { assertCompilationOptionsContract } from '../engine-extension-contracts.js';

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
  complexPromotion?: boolean;
  mode?: CompileMode;
  entryChecks?: boolean;
  iterationBudget?: number;
  quadrature?: 'adaptive' | 'monte-carlo';
  symbolDeps?: Set<MathJsonSymbol>;
  varsObjectRefs?: Set<MathJsonSymbol>;
  cse?: boolean;
  constantFold?: boolean;
};

/**
 * Compile a boxed expression.
 *
 * Returns a `CompilationResult` with the generated source code and,
 * for JS-executable targets, a `run` function.
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
 * complex-valued; the real-only special functions do not. A complex value
 * must never reach a real helper (a compiled `Erf(z)` would return −1): under
 * `mode: 'strict'` the compiler fails closed with the offending
 * head; under `auto` (the default) and `complex` a MAYBE-complex operand (a
 * `complex`-typed symbol, a promoted radical, a wide binding in complex mode)
 * uses a runtime guard: the real helper runs when the value's
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
  assertCompilationOptionsContract(options);
  // The deprecated `complexPromotion: true` maps to `mode: 'complex'` — but
  // only where the target offers complex mode. The flag is ignored on shader
  // targets, which keep the real kernel. A caller passing it globally must not
  // see a shader compilation decline with `unsupported-mode`; on such a
  // target the alias is dropped and the target's default mode applies.
  const deprecated = applyDeprecatedModeOptions(options);
  options = deprecated.options;
  const modeFromAlias = deprecated.modeFromAlias;

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
        modeFromAlias &&
          !(options.target.supportedModes ?? ['strict']).includes('complex')
          ? undefined
          : options.mode
      );
      let code: string;
      let escalation: CompileDiagnostic | undefined;
      try {
        code = BaseCompiler.compileRoot(rewritten, options.target);
      } catch (e) {
        // The `auto` escalation (design §4) for a CALLER-OWNED target: a
        // `LaneMismatch` in the strict attempt redoes the compilation under
        // the complex discipline, on FRESH target state — a direct target
        // offers `auto` only when it provides `reset()`
        // (`resolveDirectTargetMode`), which drops whatever the failed attempt
        // wrote (helpers, definitions, temporaries). A REGISTERED target
        // escalates inside its own `compile()` instead
        // (`compileWithAutoEscalation`, `auto-escalation.ts`), which is what
        // makes the target-level route behave like this entry; this branch
        // cannot use that helper, because a caller's target is reused across
        // calls and its state has to be reset between the two attempts.
        if (!isLaneMismatchError(e) || options.target.mode !== 'auto') throw e;
        options.target.reset?.();
        options.target.mode = 'complex';
        // The SAME collision seed as the first attempt (the caller's spliced
        // `vars`/`functions` source included), or the retry could number a
        // temporary into a name the caller's own source uses.
        options.target.naming = BaseCompiler.newNamingContext(
          rewritten,
          namingSources
        );
        code = BaseCompiler.compileRoot(rewritten, options.target);
        escalation = e.diagnostic;
      }
      const direct = BaseCompiler.withReferences(
        {
          target: (options.target.language ?? 'custom') as T,
          success: true,
          code,
        } as CompilationResult<T, R>,
        expr,
        options.target,
        options.vars ? new Set(Object.keys(options.vars)) : undefined
      );
      if (escalation !== undefined) direct.escalation = escalation;
      return direct;
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
      complexPromotion: options?.complexPromotion,
      mode: options?.mode,
      entryChecks: options?.entryChecks,
      iterationBudget: options?.iterationBudget,
      quadrature: options?.quadrature,
      symbolDeps: options?.symbolDeps,
      varsObjectRefs: options?.varsObjectRefs,
      cse: options?.cse,
      constantFold: options?.constantFold,
    };
    // The alias is dropped on a target that does not offer complex mode (see
    // `modeFromAlias` above): the target's default applies.
    if (modeFromAlias && !targetSupportsMode(languageTarget, 'complex'))
      targetOptions.mode = undefined;
    // The `auto` escalation (design §4) is NOT applied here: a registered
    // target owns it, inside its own `compile()`
    // (`compileWithAutoEscalation`, `auto-escalation.ts`), so that a caller
    // reaching the target directly through `ce._getCompilationTarget(name)`
    // escalates identically to one coming through this entry. A `LaneMismatch`
    // in the strict attempt therefore never surfaces here: the target has
    // already redone the compilation under the complex discipline and set
    // `escalation` on the result.
    return languageTarget.compile(expr, targetOptions) as CompilationResult<T, R>;
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
 * Whether a registered target offers `mode` — read once per `LanguageTarget`
 * instance from a target it creates (`supportedModes`), so the decision costs
 * nothing per compilation after the first.
 */
const modeSupport = new WeakMap<object, readonly CompileMode[]>();
function targetSupportsMode(
  lt: { createTarget(): CompileTarget<Expression> },
  mode: CompileMode
): boolean {
  let known = modeSupport.get(lt);
  if (known === undefined) {
    known = lt.createTarget().supportedModes ?? ['strict'];
    modeSupport.set(lt, known);
  }
  return known.includes(mode);
}

/**
 * Map the deprecated pre-mode `complexPromotion` option at the public entry
 * before anything is compiled. It is consulted only when `mode` is absent:
 * `true` maps to `mode: 'complex'`; `false` selects nothing. With an explicit
 * `mode` the flag is ignored (no conflict error). Every present spelling gets
 * a one-time console warning. It is not passed on to the target: the
 * discipline now carries the promotion.
 *
 * The removed `realOnly` option is warned about here too, on the same route,
 * so an untyped caller still passing it learns the projection is gone.
 */
function applyDeprecatedModeOptions<T extends string>(
  options: CompileExpressionOptions<T> | undefined
): {
  options: CompileExpressionOptions<T> | undefined;
  modeFromAlias: boolean;
} {
  if (options === undefined) return { options, modeFromAlias: false };
  // Both the warning and the mapping live in `deprecation-warnings.ts`,
  // because the target-level `.compile()` route owes the caller the same ones
  // and cannot reach this module (see that file's header). The target is not
  // known yet here, so the alias is mapped onto `mode` unconditionally and the
  // returned `modeFromAlias` lets the caller drop it once the target turns out
  // not to offer complex mode. `normalizeDeprecatedCompileOptions` warns at
  // most once per process per deprecated option, so a compilation that passes
  // through this entry and the target's own `compile()` still produces exactly
  // one warning.
  return normalizeDeprecatedCompileOptions(options);
}

/**
 * The effective compile mode for a direct, caller-owned target. Its declared
 * `supportedModes` (default `['strict']`) are narrowed by
 * the hooks each needs — `'complex'` needs `complexLift` and `complexIsReal`
 * (the declaration contract already rejects a target declaring it without
 * them), `'auto'` needs those and `reset()`. A requested `'auto'` that is
 * declared but not offered (no `reset()`) resolves to `'strict'`; the
 * default with nothing requested is `'auto'` when offered, else `'strict'`.
 * Any other requested mode is returned as-is for `BaseCompiler.compile` to
 * validate against the declared list (the `unsupported-mode` decline).
 *
 * Only the per-call `options.mode` is requested. The resolved value is
 * recorded on `target.mode` by the caller (like `constantFold` and
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
