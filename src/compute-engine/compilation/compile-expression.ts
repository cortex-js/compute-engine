import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Expression, JSSource } from '../global-types.js';
import type {
  CompileDiagnostic,
  CompileMode,
  CompileTarget,
  CompilationResult,
} from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { compileDiagnosticOf, isLaneMismatchError } from './diagnostics.js';
import { normalizeDeprecatedCompileOptions } from './deprecation-warnings.js';
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
 * When the deprecated `realOnly` is true, the return type of `run` is
 * narrowed to `number` (the old projection; the result convention already
 * returns an exactly-real value as a plain number).
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
 * `mode: 'strict'` the compiler **fails closed** (D6) with the offending
 * head; under `auto` (the default) and `complex` a MAYBE-complex operand (a
 * `complex`-typed symbol, a promoted radical, a wide binding in complex mode)
 * takes the D2/D6 runtime rule — the real helper runs when the value's
 * imaginary part is exactly zero, `NaN` otherwise — and only a STATICALLY
 * non-real operand (`Erf(2i)`) is the compile-time decline. The shader
 * targets always fail closed. (`Real`/`Imaginary`/`Argument`/`Conjugate` are
 * exempt: they consume a complex value by design.)
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
  // The deprecated `complexPromotion: true` maps to `mode: 'complex'` — but
  // only where the target OFFERS complex mode. The flag was documented as
  // ignored on the shader targets ("they keep the real kernel
  // unconditionally"), so a caller passing it globally must not see a shader
  // compile that used to succeed decline with `unsupported-mode`; on such a
  // target the alias is dropped and the target's default mode applies.
  const deprecated = applyDeprecatedModeOptions(options);
  options = deprecated.options;
  const modeFromAlias = deprecated.modeFromAlias;

  // An option-contract violation, not a compilation failure: raised OUTSIDE
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
      // Stamp a FRESH naming context for the generated temporaries. Per-call,
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
          ? Object.values(options.functions).map((f) =>
              typeof f === 'string' ? f : undefined
            )
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
        // The single retry site (design §4): under `auto`, a `LaneMismatch`
        // in the strict attempt redoes the compilation under the complex
        // discipline, on FRESH target state — a direct target offers `auto`
        // only when it provides `reset()` (`resolveDirectTargetMode`), which
        // drops whatever the failed attempt wrote (helpers, definitions,
        // temporaries).
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
        } as CompilationResult<T>,
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
    };
    // The single retry site (design §4): under `auto` — requested, or the
    // target's default — a `LaneMismatch` in the strict attempt redoes the
    // compilation under the complex discipline. A registered target builds a
    // fresh per-compilation target on every `compile()`, so the retry starts
    // from clean state. The first attempt is made with `fallback: false` so
    // the mismatch reaches this site as a THROW — not as a `success: false`
    // result the target has already wrapped in an interpreter fallback (and
    // warned about); any other failure rethrows to the catch below, which
    // builds the fallback exactly as for a target without `auto`.
    // The alias is dropped on a target that does not offer complex mode (see
    // `modeFromAlias` above): the target's default applies.
    if (modeFromAlias && !targetSupportsMode(languageTarget, 'complex'))
      targetOptions.mode = undefined;
    // `auto` is in play only where the target OFFERS it: a target that does
    // not (interval-js, the shader targets) takes the ordinary path with the
    // caller's `fallback`, and reports a requested `'auto'` as its own
    // `unsupported-mode` decline — with the interpreter-backed runner the
    // fallback contract promises.
    const auto =
      (targetOptions.mode === 'auto' || targetOptions.mode === undefined) &&
      targetSupportsAuto(languageTarget);
    if (!auto)
      return languageTarget.compile(
        expr,
        targetOptions
      ) as CompilationResult<T>;
    let first: CompilationResult<T>;
    try {
      first = languageTarget.compile(expr, {
        ...targetOptions,
        fallback: false,
      }) as CompilationResult<T>;
    } catch (e) {
      if (!isLaneMismatchError(e)) throw e;
      const retried = languageTarget.compile(expr, {
        ...targetOptions,
        mode: 'complex',
      }) as CompilationResult<T>;
      if (retried.success) retried.escalation = e.diagnostic;
      return retried;
    }
    // A target that REPORTS a decline (`success: false`, no throw) rather
    // than throwing it: honor the caller's fallback by redoing the compile
    // with it (a decline is rare; the double compile costs nothing on the
    // success path). Defensive: the two built-in targets that offer `auto`
    // (`javascript`, `python`) always THROW under `fallback: false`, so this
    // branch is reached only by a third-party `auto`-capable target that
    // reports instead — the existing suite does not exercise it.
    if (!first.success && (options?.fallback ?? true))
      return languageTarget.compile(
        expr,
        targetOptions
      ) as CompilationResult<T>;
    return first;
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
          }) as unknown as CompilationResult<T>;
      }
      const compileTarget =
        options?.target ??
        expr.engine._getCompilationTarget(target as string)?.createTarget();
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
 * Whether a registered target offers `mode: 'auto'` — read once per
 * `LanguageTarget` instance from a target it creates (`supportedModes`), so
 * the default-mode decision costs nothing per compilation after the first.
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
function targetSupportsAuto(lt: {
  createTarget(): CompileTarget<Expression>;
}): boolean {
  return targetSupportsMode(lt, 'auto');
}

/**
 * The deprecation mapping of the two pre-mode options (design §5,
 * `docs/plans/2026-08-16-compile-complex-mode.md`), applied at the public
 * entry before anything is compiled:
 *
 * - `complexPromotion` — consulted only when `mode` is absent: `true` maps to
 *   `mode: 'complex'`; `false` selects nothing. With an explicit `mode` the
 *   flag is ignored (no conflict error). Every present spelling gets a
 *   one-time console warning. It is not passed on to the target: the
 *   discipline now carries the promotion.
 * - `realOnly` — kept for one release as the OLD result projection
 *   (`{re, im}` → `NaN` unless the imaginary part is at roundoff scale,
 *   boolean → `NaN`), with a one-time warning; the result convention (§5) —
 *   a real value is a plain `number`, a `ComplexResult` always has `im !==
 *   0` — replaces it.
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
  // through this entry AND the target's own `compile()` still produces exactly
  // one warning.
  return normalizeDeprecatedCompileOptions(options);
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
