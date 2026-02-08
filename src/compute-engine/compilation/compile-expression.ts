import type { MathJsonSymbol } from '../../math-json/types';
import type { BoxedExpression, JSSource } from '../global-types';
import { BaseCompiler } from './base-compiler';
import { applicableN1 } from '../function-utils';

/**
 * Compile a boxed expression to an executable function.
 *
 * The function takes an object as argument, with the keys being the
 * symbols in the expression, and returns the value of the expression.
 *
 * ```javascript
 * const expr = ce.parse("x^2 + y^2");
 * const f = compile(expr);
 * console.log(f({x: 2, y: 3}));
 * // -> 13
 * ```
 *
 * If the expression is a function literal, the function takes the
 * arguments of the function as arguments, and returns the value of the
 * expression.
 *
 * If the expression cannot be compiled, a JS function is returned that
 * falls back to interpreting the expression, unless `options.fallback`
 * is set to `false`. If it is set to `false`, the function will throw
 * an error if it cannot be compiled.
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
): ((...args: any[]) => any) & { isCompiled?: boolean } {
  try {
    // Determine the target to use
    if (options?.target) {
      // Direct target override - use BaseCompiler
      const code = BaseCompiler.compile(expr, options.target);

      // Create a function that returns the compiled code
      const result = function () {
        return code;
      };
      Object.defineProperty(result, 'toString', { value: () => code });
      Object.defineProperty(result, 'isCompiled', { value: true });
      return result as any;
    }

    const targetName = options?.to ?? 'javascript';

    // Look up the target in the registry
    // @ts-expect-error - accessing internal property
    const languageTarget = expr.engine._getCompilationTarget(targetName);

    if (!languageTarget) {
      throw new Error(
        `Compilation target "${targetName}" is not registered. Available targets: ${Array.from((expr.engine as any)['_compilationTargets'].keys()).join(', ')}`
      );
    }

    // Use the language target to compile
    return languageTarget.compileToExecutable(expr, {
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
      return applicableN1(expr);
    }
    throw e;
  }
}
