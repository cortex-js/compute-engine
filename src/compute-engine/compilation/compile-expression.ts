import type { MathJsonSymbol } from '../../math-json/types';
import type { Expression, JSSource } from '../global-types';
import type { CompileTarget, CompilationResult, CompiledRunner } from './types';
import { BaseCompiler } from './base-compiler';
import { isFunction } from '../boxed-expression/type-guards';
import { assertCompilationOptionsContract } from '../engine-extension-contracts';

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
      // Direct target override - use BaseCompiler
      const code = BaseCompiler.compile(expr, options.target);
      return {
        target: (options.target.language ?? 'custom') as T,
        success: true,
        code,
      } as CompilationResult<T>;
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
    }) as CompilationResult<T>;
  } catch (e) {
    if (options?.fallback ?? true) {
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: ${options?.to ?? 'javascript'}): ${(e as Error).message}`
      );
      const ce = expr.engine;
      const target = (options?.to ?? 'javascript') as T;

      // A function literal (lambda) compiles to the 'lambda' calling
      // convention — `run(a, b, ...)` with positional arguments (see
      // `compileToTarget` in javascript-target.ts). The fallback must mirror
      // that by applying the function to its positional arguments via the
      // interpreter. Otherwise positional arguments are silently dropped and
      // the unbound lambda evaluates to nothing.
      if (isFunction(expr, 'Function')) {
        const lambdaRun = ((...args: number[]) =>
          ce.function('Apply', [expr, ...args.map((a) => ce.expr(a))]).evaluate()
            .re) as unknown as CompiledRunner;
        return {
          target,
          success: false,
          code: '',
          calling: 'lambda',
          run: lambdaRun,
        } as CompilationResult<T>;
      }

      // Otherwise, the expression uses the 'expression' calling convention:
      // `run({ x, y, ... })` with a variables object.
      const fallbackRun = ((vars: Record<string, number>) => {
        ce.pushScope();
        try {
          if (vars && typeof vars === 'object') {
            for (const [k, v] of Object.entries(vars)) ce.assign(k, v);
          }
          return expr.evaluate().re;
        } finally {
          ce.popScope();
        }
      }) as unknown as CompiledRunner;
      return {
        target,
        success: false,
        code: '',
        calling: 'expression',
        run: fallbackRun,
      } as CompilationResult<T>;
    }
    throw e;
  }
}
