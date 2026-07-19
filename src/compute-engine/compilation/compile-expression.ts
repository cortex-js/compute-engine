import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Expression, JSSource } from '../global-types.js';
import type { CompileTarget, CompilationResult } from './types.js';
import { BaseCompiler } from './base-compiler.js';
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
  iterationBudget?: number;
  quadrature?: 'adaptive' | 'monte-carlo';
  symbolDeps?: Set<MathJsonSymbol>;
};

/**
 * Compile a boxed expression.
 *
 * Returns a `CompilationResult` with the generated source code and,
 * for JS-executable targets, a `run` function.
 *
 * When `realOnly` is true, the return type of `run` is narrowed to `number`.
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

  try {
    // Determine the target to use
    if (options?.target) {
      // Direct target override - use BaseCompiler. Registered language
      // targets apply the angular-unit rewrite in their own compile();
      // this raw-target path must do it itself.
      const code = BaseCompiler.compile(
        rewriteAngularUnit(expr),
        options.target
      );
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

    // Use the language target to compile
    return languageTarget.compile(expr, {
      operators: options?.operators,
      functions: options?.functions,
      vars: options?.vars,
      imports: options?.imports,
      preamble: options?.preamble,
      realOnly: options?.realOnly,
      iterationBudget: options?.iterationBudget,
      quadrature: options?.quadrature,
      symbolDeps: options?.symbolDeps,
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
        options?.vars ? new Set(Object.keys(options.vars)) : undefined
      );
    }
    throw e;
  }
}
