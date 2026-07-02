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

  /** Format a complex numeric literal for the target language.
   *  Only called when the imaginary part is non-zero. */
  complex?: (re: number, im: number) => string;

  /** Format whitespace for the target language */
  ws: (s?: string) => string;

  /** Code to be inserted at the beginning of the compiled output */
  preamble: string;

  /** Current indentation level */
  indent: number;

  /** Format a variable declaration. Default: `let ${name}`.
   *  `typeHint` is an optional target-language type string (e.g. `'vec2'`)
   *  inferred from subsequent assignments. */
  declare?: (name: string, typeHint?: string) => string;

  /** Format a block expression. Receives compiled statements; the last
   *  element is the block's return value (without `return` prefix).
   *  Default: JavaScript IIFE. */
  block?: (statements: string[]) => string;

  /**
   * The infix operator used to conjoin the pairs of a chained relational
   * expression (e.g. `Less(a, b, c)` → `(a < b) && (b < c)`). Default: `'&&'`
   * (JavaScript / GLSL / WGSL). Word-operator targets set this to their
   * language keyword (e.g. Python `'and'`), so the emitted source is valid in
   * that language.
   */
  chainOp?: string;

  /**
   * When `true`, this target's multi-statement constructs (loop-form
   * `Sum`/`Product`, `Loop`, `Block`) are emitted as **bare statement
   * sequences** — valid only at statement position (a function body), never
   * as a sub-expression. GPU shader languages (GLSL/WGSL) set this: unlike the
   * JavaScript target, which wraps such constructs in an IIFE (a self-contained
   * expression), a shader has no expression-level loop or IIFE. The compiler
   * uses this flag to **fail closed** (D6) rather than splice a bare statement
   * block into the middle of an expression (which would emit invalid shader
   * source such as `return _acc; + 1.0`).
   */
  bareStatementBlocks?: boolean;

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
  compile(
    expr: Expr,
    options?: CompilationOptions<Expr>
  ): CompilationResult<string, unknown>;
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  functions?: Record<MathJsonSymbol, TargetSource | Function>;

  /**
   * Map a symbol to the target-language source emitted for it (e.g. a GLSL
   * uniform name `{ a: 'u_var_a' }`, or a JS literal `{ a: 5 }`).
   *
   * A `vars`-mapped symbol is **never constant-folded**, even when the symbol
   * has an assigned value in the engine (`ce.assign('a', …)`). The mapping
   * always wins, so the generated code keeps referencing the mapped
   * identifier — a per-frame uniform / argument write updates the result
   * without recompiling. This is a guaranteed contract.
   *
   * A symbol that is *not* mapped here but *is* known to the engine (an
   * assigned value or a declared constant) is folded into the generated code,
   * matching `evaluate()` and `expr.unknowns`. A genuinely free symbol (no
   * mapping, no value) is emitted through the target's free-symbol plumbing.
   */
  vars?: Record<MathJsonSymbol, TargetSource>;

  /** Additional imports/libraries to include */
  imports?: unknown[];

  /** Additional preamble code */
  preamble?: string;

  /**
   * When true, complex results (`{ re, im }`) are converted to real numbers:
   * - If the imaginary part is zero, the real part is returned
   * - Otherwise, `NaN` is returned
   *
   * This avoids object allocations for callers that only need real-valued
   * results (e.g., plotting).
   */
  realOnly?: boolean;
}

/**
 * Built-in targets that produce an executable `run` function.
 */
export type ExecutableTarget = 'javascript' | 'interval-js';

/**
 * Result of a complex number computation: `{ re, im }`.
 */
export type ComplexResult = { re: number; im: number };

/**
 * Runner for compiled expressions — called with a variables object.
 *
 * ```typescript
 * result.run({ x: 0.5, y: 1.0 })
 * ```
 */
export type ExpressionRunner<R = number | ComplexResult> = (
  vars: Record<string, number>
) => R;

/**
 * Runner for compiled lambda (`Function`) expressions — called with
 * positional arguments.
 *
 * ```typescript
 * result.run(0.5, 1.0)
 * ```
 */
export type LambdaRunner<R = number | ComplexResult> = (...args: number[]) => R;

/**
 * Overloaded callable that accepts both calling conventions.
 *
 * Supports two calling styles:
 * - **Expression**: `run({ x: 0.5 })` — pass a variables object
 * - **Lambda**: `run(0.5, 1.0)` — pass positional arguments
 *
 * Check `calling` on the `CompilationResult` to know which convention
 * the compiled expression actually uses.
 */
export interface CompiledRunner<R = number | ComplexResult> {
  /** Call with a variables object (for compiled expressions) */
  (vars: Record<string, number>): R;
  /** Call with positional arguments (for compiled lambda expressions) */
  (...args: number[]): R;
}

/**
 * Result of compiling an expression.
 *
 * Two type parameters control the shape:
 * - `T` — the target name. For executable targets (`'javascript'` |
 *   `'interval-js'`), `run` and `calling` are guaranteed present.
 * - `R` — the return type of `run`. Defaults to `number | ComplexResult`.
 *   Pass `number` when `realOnly: true`.
 *
 * The `calling` field indicates which convention `run` uses:
 * - `'expression'` — call with a vars object: `run({ x: 0.5 })`
 * - `'lambda'` — call with positional args: `run(0.5, 1.0)`
 *
 * @example
 * ```typescript
 * // run is guaranteed, may return complex
 * const js = compile(expr);
 * js.run({ x: 0.5 });
 *
 * // run is guaranteed, returns number only
 * const real = compile(expr, { realOnly: true });
 * real.run({ x: 0.5 }); // number
 *
 * // check calling convention
 * if (result.calling === 'lambda') {
 *   result.run(0.5, 1.0);
 * }
 *
 * // no run (source-only target)
 * const py = compile(expr, { to: 'python' });
 * py.code; // string
 * ```
 */
export type CompilationResult<
  T extends string = string,
  R = number | ComplexResult,
> = {
  /** Target language name */
  target: T;

  /** Whether compilation succeeded (vs falling back to interpretation) */
  success: boolean;

  /** Generated source code */
  code: string;

  /**
   * Identifiers the generated `code` references that the caller must supply at
   * run time (JS vars-object keys / GLSL uniforms) for the result to be
   * self-contained.
   *
   * These are the expression's free symbols *as the generated code sees them*:
   * symbols with no value in the engine, after assigned values and declared
   * constants are folded in (so an assigned symbol is **not** listed — its
   * value is inlined, matching `evaluate()`), and after bound variables (lambda
   * parameters, `Sum`/`Product`/`Integrate`/`Loop` indices, `Block` locals) are
   * excluded. A symbol supplied through the `vars` option is always listed —
   * the mapping makes it an external input.
   *
   * Populated by the built-in targets on a successful compile. Use it instead
   * of `expr.unknowns` when building a uniforms / vars mapping: unlike
   * `unknowns`, it is guaranteed consistent with what the code actually
   * references (including symbols reachable only through a folded value).
   */
  freeSymbols?: string[];

  /**
   * Operator heads in the expression that this target cannot lower — they have
   * no operator or function mapping and are not one of the structural forms the
   * compiler handles directly. An empty array means every operator was
   * lowerable.
   *
   * On the built-in `LanguageTarget.compile` paths a genuinely unsupported
   * operator throws (so the engine-level `compile()` can fall back to
   * interpretation); this field lets a caller detect the condition
   * **declaratively** — it is populated on the engine-level `compile()` result
   * (including its `success: false` fallback) and on successful direct-target
   * compiles (where it is `[]`).
   */
  unsupported?: string[];

  /**
   * When `success` is `false`, a human-readable reason the expression could not
   * be compiled to the target (e.g. `Unknown operator \`SinIntegral\``).
   */
  error?: string;

  /**
   * Library/helper code that must be included before the compiled `code`.
   *
   * For targets like `interval-js`, this contains the interval arithmetic
   * library (helper functions, etc.) that the compiled expression references.
   */
  preamble?: string;

  /**
   * How `run` should be called (present only for executable targets).
   * - `'expression'` — call with a vars object: `run({ x: 0.5 })`
   * - `'lambda'` — call with positional args: `run(0.5, 1.0)`
   */
  calling?: 'expression' | 'lambda';

  /** Executable function (present for JS-executable targets only). */
  run?: CompiledRunner<R>;
} & (T extends ExecutableTarget
  ? { calling: 'expression' | 'lambda'; run: CompiledRunner<R> }
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {});
