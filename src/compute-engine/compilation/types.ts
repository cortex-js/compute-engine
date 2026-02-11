import type { MathJsonSymbol } from '../../math-json/types';

/**
 * Source code in the target language
 */
export type TargetSource = string;

/**
 * A compiled function that can be executed
 */
export type CompiledFunction<Expr = unknown> =
  | string
  | ((
      args: ReadonlyArray<Expr>,
      compile: (expr: Expr) => TargetSource,
      target: CompileTarget<Expr>
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
export type CompiledFunctions<Expr = unknown> = {
  [id: MathJsonSymbol]: CompiledFunction<Expr>;
};

/**
 * Target language compilation configuration
 */
export interface CompileTarget<Expr = unknown> {
  /** Get operator representation for the target language */
  operators?: (op: MathJsonSymbol) => [op: string, prec: number] | undefined;

  /** Get function implementation for the target language */
  functions?: (id: MathJsonSymbol) => CompiledFunction<Expr> | undefined;

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
export interface LanguageTarget<Expr = unknown> {
  /** Get the default operators for this language */
  getOperators(): CompiledOperators;

  /** Get the default functions for this language */
  getFunctions(): CompiledFunctions<Expr>;

  /** Create a CompileTarget for this language */
  createTarget(options?: Partial<CompileTarget<Expr>>): CompileTarget<Expr>;

  /** Compile an expression to this language */
  compile(expr: Expr, options?: CompilationOptions<Expr>): CompilationResult;
}

/**
 * Options for compilation
 */
export interface CompilationOptions<Expr = unknown> {
  /**
   * Target language for compilation.
   *
   * Built-in targets:
   * - `'javascript'` (default) - Compile to JavaScript
   * - `'glsl'` - Compile to GLSL (OpenGL Shading Language)
   * - `'wgsl'` - Compile to WGSL (WebGPU Shading Language)
   * - `'interval-js'` - Compile to JavaScript with interval arithmetic
   * - `'interval-glsl'` - Compile to GLSL with interval arithmetic
   * - `'interval-wgsl'` - Compile to WGSL with interval arithmetic
   *
   * Custom targets can be registered using `ce.registerCompilationTarget()`.
   *
   * @example
   * ```typescript
   * // Compile to GLSL
   * const glslCode = expr.compile({ to: 'glsl' });
   *
   * // Compile to custom target
   * ce.registerCompilationTarget('python', new PythonTarget());
   * const pythonCode = expr.compile({ to: 'python' });
   * ```
   */
  to?: string;

  /**
   * Direct compilation target override.
   *
   * When provided, this takes precedence over the `to` option.
   * Useful for one-off custom targets without registration.
   *
   * @example
   * ```typescript
   * const customTarget: CompileTarget = {
   *   language: 'custom',
   *   operators: (op) => ...,
   *   functions: (id) => ...,
   *   // ... other methods
   * };
   *
   * const code = expr.compile({ target: customTarget });
   * ```
   */
  target?: CompileTarget<Expr>;

  /**
   * Custom operator mappings. Can be:
   * - A partial object mapping operator names to [operator, precedence] tuples
   * - A function that returns the operator mapping for a given symbol
   *
   * When an operator is overridden, it will be compiled using the specified
   * string and precedence instead of the default for the target language.
   *
   * @example
   * ```typescript
   * // Override operators as object
   * { operators: { Add: ['add', 11], Multiply: ['mul', 12] } }
   *
   * // Override operators as function
   * { operators: (op) => op === 'Add' ? ['add', 11] : undefined }
   * ```
   */
  operators?:
    | Partial<CompiledOperators>
    | ((op: MathJsonSymbol) => [op: string, prec: number] | undefined);

  /** Custom function implementations */
  // eslint-disable-next-line @typescript-eslint/ban-types
  functions?: Record<MathJsonSymbol, TargetSource | Function>;

  /** Variable bindings */
  vars?: Record<MathJsonSymbol, TargetSource>;

  /** Additional imports/libraries to include */
  imports?: unknown[];

  /** Additional preamble code */
  preamble?: string;
}

/**
 * Result of compiling an expression
 */
export interface CompilationResult {
  /** Target language name */
  target: string;

  /** Whether compilation succeeded (vs falling back to interpretation) */
  success: boolean;

  /** Generated source code */
  code: string;

  /** Executable function (present for JS-executable targets only) */
  run?: (...args: number[]) => number;
}
