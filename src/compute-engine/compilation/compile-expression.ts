import type { MathJsonSymbol } from '../../math-json/types';
import type { BoxedExpression, JSSource } from '../global-types';
import type { CompilationResult } from './types';
import { BaseCompiler } from './base-compiler';
import { applicableN1 } from '../function-utils';

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
  options?: {
    to?: string;
    target?: any; // CompileTarget, but any to avoid circular deps
    operators?:
      | Partial<Record<MathJsonSymbol, [op: string, prec: number]>>
      | ((op: MathJsonSymbol) => [op: string, prec: number] | undefined);
    functions?: Record<MathJsonSymbol, JSSource | ((...any: any[]) => any)>;
    vars?: Record<MathJsonSymbol, JSSource>;
    imports?: ((...any: any[]) => any)[];
    preamble?: string;
    fallback?: boolean;
  }
): CompilationResult {
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
