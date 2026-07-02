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
      // Direct target override - use BaseCompiler
      const code = BaseCompiler.compile(expr, options.target);
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
    }) as CompilationResult<T>;
  } catch (e) {
    if (options?.fallback ?? true) {
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: ${options?.to ?? 'javascript'}): ${error}`
      );
      const ce = expr.engine;
      const target = (options?.to ?? 'javascript') as T;

      // Compute the declarative reference analysis so the (success: false)
      // result still tells the caller *why* it could not be compiled —
      // `unsupported` lists the unlowerable operators, `freeSymbols` the
      // referenced inputs — without them having to parse `error`. Never let the
      // analysis itself break the fallback.
      let refs: { freeSymbols: string[]; unsupported: string[] } = {
        freeSymbols: [],
        unsupported: [],
      };
      try {
        const compileTarget =
          options?.target ??
          expr.engine.getCompilationTarget(target as string)?.createTarget();
        if (compileTarget)
          refs = BaseCompiler.analyzeReferences(
            expr,
            compileTarget,
            options?.vars ? new Set(Object.keys(options.vars)) : undefined
          );
      } catch {
        /* keep the empty analysis */
      }

      // A function literal (lambda) compiles to the 'lambda' calling
      // convention — `run(a, b, ...)` with positional arguments (see
      // `compileToTarget` in javascript-target.ts). The fallback must mirror
      // that by applying the function to its positional arguments via the
      // interpreter. Otherwise positional arguments are silently dropped and
      // the unbound lambda evaluates to nothing.
      if (isFunction(expr, 'Function')) {
        const lambdaRun = ((...args: number[]) =>
          ce
            .function('Apply', [expr, ...args.map((a) => ce.expr(a))])
            .evaluate().re) as unknown as CompiledRunner;
        return {
          target,
          success: false,
          code: '',
          calling: 'lambda',
          run: lambdaRun,
          error,
          ...refs,
        } as CompilationResult<T>;
      }

      // Otherwise, the expression uses the 'expression' calling convention:
      // `run({ x, y, ... })` with a variables object.
      const fallbackRun = ((vars: Record<string, number>) => {
        ce.pushScope();
        try {
          if (vars && typeof vars === 'object') {
            for (const [k, v] of Object.entries(vars)) {
              // Declare a fresh binding in the just-pushed scope *before*
              // assigning. `ce.assign` mutates the binding in whatever scope the
              // symbol was declared in; when the expression already boxed the
              // symbol in an outer/global scope, a bare `assign` would mutate
              // that outer binding and `popScope` could not restore it —
              // permanently leaking the argument value engine-wide. Declaring a
              // local shadow first makes `assign` target this scope, so
              // `popScope` fully restores the previous state.
              ce.declare(k, 'number');
              ce.assign(k, v);
            }
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
        error,
        ...refs,
      } as CompilationResult<T>;
    }
    throw e;
  }
}
