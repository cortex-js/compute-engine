import type { MathJsonSymbol } from '../../math-json/types';
import type { BoxedExpression, JSSource } from '../global-types';
import type { CompileTarget, CompilationResult } from './types';
import { BaseCompiler } from './base-compiler';
import { applicableN1 } from '../function-utils';
import { assertCompilationOptionsContract } from '../engine-extension-contracts';

type CompileExpressionOptions = {
  to?: string;
  target?: CompileTarget<BoxedExpression>;
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
};

/**
 * Compile a boxed expression.
 *
 * Returns a `CompilationResult` with the generated source code and,
 * for JS-executable targets, a `run` function.
 *
 * If the expression cannot be compiled, falls back to interpretation
 * (success: false, run: applicableN1) unless `options.fallback` is false,
 * in which case it throws.
 */
export function compile(
  expr: BoxedExpression,
  options?: CompileExpressionOptions
): CompilationResult {
  assertCompilationOptionsContract(options);

  try {
    // Determine the target to use
    if (options?.target) {
      // Direct target override - use BaseCompiler
      const code = BaseCompiler.compile(expr, options.target);
      return {
        target: options.target.language ?? 'custom',
        success: true,
        code,
      };
    }

    const targetName = options?.to ?? 'javascript';

    // Look up the target in the registry
    const languageTarget = expr.engine.getCompilationTarget(targetName);

    if (!languageTarget) {
      throw new Error(
        `Compilation target "${targetName}" is not registered. Available targets: ${expr.engine.listCompilationTargets().join(', ')}`
      );
    }

    // Use the language target to compile
    return languageTarget.compile(expr, {
      operators: options?.operators,
      functions: options?.functions,
      vars: options?.vars,
      imports: options?.imports,
      preamble: options?.preamble,
    });
  } catch (e) {
    // @fixme: the fallback needs to handle multiple arguments
    if (options?.fallback ?? true) {
      console.warn(
        `Compilation fallback for "${expr.operator}": ${(e as Error).message}`
      );
      return {
        target: options?.to ?? 'javascript',
        success: false,
        code: '',
        run: applicableN1(expr),
      };
    }
    throw e;
  }
}
