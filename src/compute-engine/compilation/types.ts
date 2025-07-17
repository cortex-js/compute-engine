import type { MathJsonSymbol } from '../../math-json/types';
import type { BoxedExpression } from '../global-types';

/**
 * Source code in the target language
 */
export type TargetSource = string;

/**
 * A compiled function that can be executed
 */
export type CompiledFunction =
  | string
  | ((
      args: ReadonlyArray<BoxedExpression>,
      compile: (expr: BoxedExpression) => TargetSource,
      target: CompileTarget
    ) => TargetSource);

/**
 * Mapping of operators to their target language representation and precedence
 */
export type CompiledOperators = Record<
  MathJsonSymbol,
  [op: string, prec: number]
>;

/**
 * Mapping of function names to their target language implementation
 */
export type CompiledFunctions = {
  [id: MathJsonSymbol]: CompiledFunction;
};

/**
 * Target language compilation configuration
 */
export interface CompileTarget {
  /** Get operator representation for the target language */
  operators?: (op: MathJsonSymbol) => [op: string, prec: number] | undefined;

  /** Get function implementation for the target language */
  functions?: (id: MathJsonSymbol) => CompiledFunction | undefined;

  /** Get variable representation for the target language */
  var: (id: MathJsonSymbol) => string | undefined;

  /** Format string literals for the target language */
  string: (str: string) => string;

  /** Format numeric literals for the target language */
  number: (n: number) => string;

  /** Format whitespace for the target language */
  ws: (s?: string) => string;

  /** Code to be inserted at the beginning of the compiled output */
  preamble: string;

  /** Current indentation level */
  indent: number;

  /** Target language identifier (for debugging/logging) */
  language?: string;
}

/**
 * Base interface for language-specific compilation targets
 */
export interface LanguageTarget {
  /** Get the default operators for this language */
  getOperators(): CompiledOperators;

  /** Get the default functions for this language */
  getFunctions(): CompiledFunctions;

  /** Create a CompileTarget for this language */
  createTarget(options?: Partial<CompileTarget>): CompileTarget;

  /** Compile an expression to executable code in this language */
  compileToExecutable(
    expr: BoxedExpression,
    options?: CompilationOptions
  ): CompiledExecutable;
}

/**
 * Options for compilation
 */
export interface CompilationOptions {
  /** Custom function implementations */
  functions?: Record<MathJsonSymbol, TargetSource | Function>;

  /** Variable bindings */
  vars?: Record<MathJsonSymbol, TargetSource>;

  /** Additional imports/libraries to include */
  imports?: unknown[];

  /** Additional preamble code */
  preamble?: string;
}

/**
 * A compiled expression that can be executed
 */
export interface CompiledExecutable {
  /** Execute the compiled code */
  (...args: any[]): any;

  /** Get the source code */
  toString(): string;

  /** Flag indicating this is a compiled expression */
  isCompiled: true;
}
