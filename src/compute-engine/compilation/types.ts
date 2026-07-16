import type { MathJsonSymbol } from '../../math-json/types.js';
import type { Interval, IntervalResult } from '../interval/types.js';

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
   * Bind one or more values to fresh temporaries in expression position, then
   * evaluate `body` with those temporaries in scope, returning target source
   * that is itself an expression. Used to evaluate a sub-expression exactly
   * once when it would otherwise be spliced in multiple times — e.g. the shared
   * middle operand of a chained relation `Less(a, m, b)` → `(a < m) && (m < b)`,
   * where `m` must be drawn once (matching the interpreter) even if it is a
   * non-deterministic `Random()` call.
   *
   * Targets that cannot express a value binding in expression position (GPU
   * shaders) leave this undefined; the compiler then falls back to inlining the
   * sub-expression — safe when it is deterministic, the only case those targets
   * support (their `Random` requires an explicit deterministic seed).
   *
   * JavaScript emits an IIFE; Python a `lambda`.
   */
  bindExpr?: (
    bindings: Array<[name: string, value: string]>,
    body: string
  ) => string;

  /**
   * Wrap a compiled `Which`/`When` condition that is **not** provably boolean so
   * that a non-boolean value (notably `NaN`) fails closed at run time, matching
   * the interpreter — which throws `Condition must evaluate to "True" or
   * "False"` rather than silently taking the default branch. Only applied when
   * the source condition is not a relational/logical/boolean expression (the
   * common case emits a bare, unwrapped condition, so there is no overhead).
   *
   * Targets that cannot throw in expression position (GPU shaders) leave this
   * undefined; they instead keep the documented fail-closed value (the default
   * branch / NaN) — see the GPU `Which`/`When` handlers.
   */
  assertBoolean?: (code: string) => string;

  /**
   * Map a free (declarable) identifier to the source token emitted for it, or
   * **throw to fail closed (D6)** when the identifier cannot be represented in
   * the target — e.g. a GLSL/WGSL reserved keyword (`in`, `sample`, `filter`,
   * `texture`, …) used as a user variable name, which would emit a shader that
   * fails to compile. Applied by the base compiler only to the bare-symbol
   * fallback: a genuinely free symbol with no engine value and no `vars`
   * mapping. Default: identity.
   */
  mangleId?: (id: string) => string;

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

  /**
   * When set, a cap on the trip count of emitted `Sum`/`Product` loops: a
   * loop whose iteration count would exceed the budget (including infinite
   * or `NaN` bounds) evaluates to `NaN` instead of running. Internal numeric
   * probes (the Richardson limit ladder) set this so a single compiled call
   * stays cheap enough for the engine deadline to be honored between calls;
   * it is never set on user-facing `compile()` paths, whose loops remain
   * unguarded (zero overhead).
   */
  iterationBudget?: number;

  /**
   * Quadrature strategy for compiled definite integrals (`Integrate`).
   * `'adaptive'` (default) emits deterministic adaptive Gauss–Kronrod with an
   * automatic Monte-Carlo fallback on non-convergence; `'monte-carlo'` forces
   * the legacy stochastic estimator. See `CompilationOptions.quadrature`.
   */
  quadrature?: 'adaptive' | 'monte-carlo';

  /**
   * The keys of the `vars` option (symbols the caller mapped to explicit
   * runtime inputs / uniforms). A `vars`-mapped symbol must never be folded to
   * a constant — it stays a live input. Consulted by the `Integrate` handler:
   * the antiderivative-first optimization resolves a definite integral to a
   * closed form via `evaluate()`, which *would* fold such a symbol, so it is
   * skipped when the integral references any `vars`-mapped symbol.
   */
  varsKeys?: ReadonlySet<string>;

  /** Target language identifier (for debugging/logging) */
  language?: string;

  /**
   * When set (the engine's `randomSeed` is non-null at compile time), each
   * `Random` node is **baked** to a deterministic value derived from this
   * numeric seed and the node's position (see `randomState`), rather than
   * emitting `Math.random()`. Every call of the compiled function then returns
   * the same value for that call site — matching a document-level "one draw
   * per render" model. `null`/`undefined` keeps the non-deterministic emission.
   */
  randomSeed?: number | null;

  /**
   * Mutable per-compile counter distinguishing distinct `Random` call sites,
   * so two `Random` nodes in one expression bake to different values. Stored
   * as an object so it survives the shallow `{ ...target }` spreads the
   * compiler makes while recursing. Only consulted when `randomSeed` is set.
   */
  randomState?: { counter: number };

  /**
   * Mutable per-compile registry for user-defined functions — a symbol whose
   * engine definition is a `Function` literal (`f(x) := …`, `x ↦ …`, or an
   * `ce.assign(name, lambda)`) encountered as an *operator* (`f(2)`). Each such
   * function is emitted **once** as a named local function
   * (`const _fn_f = (x) => …;`), collected here and prepended to the compiled
   * preamble; its call sites compile to `_fn_f(arg)`. Stored as an object so it
   * survives the `{ ...target }` spreads the compiler makes while recursing.
   *
   * A target opts in by providing this registry (the executable JS targets do,
   * in their `compile()`); a target that leaves it undefined keeps the historic
   * `Unknown operator` throw for a user-function head (raw direct-target /
   * GPU / source-only paths). `defs` is keyed by the generated local name, in
   * insertion order, so a dependency (`f`) is emitted before a dependent
   * (`g(x) := f(x)+1`). `compiling` is the in-progress stack used to fail
   * closed (D6) on recursive / mutually-recursive definitions.
   */
  userFunctions?: {
    defs: Map<string, string>;
    compiling: Set<string>;
    /** Symbols proven (this compile) NOT to name a user-defined function, so a
     * repeated bare free symbol in value position doesn't re-hit
     * `lookupDefinition` on every occurrence. Populated lazily. */
    misses?: Set<string>;
  };
}

/**
 * Base interface for language-specific compilation targets.
 *
 * `T`/`R`/`V` describe the shape of this target's `compile()` result — its
 * target name, `run` return type, and `run` variable/argument value type. They
 * default to the generic `string`/`unknown`/`number`, so `LanguageTarget<Expr>`
 * keeps its historical meaning; the executable targets bind them concretely
 * (see the `getCompilationTarget` overloads on the engine) so a caller gets a
 * precisely-typed runner without a cast — e.g. the `interval-js` target's
 * `run` is `(vars: Record<string, number | Interval>) => IntervalResult`.
 */
export interface LanguageTarget<
  Expr = unknown,
  T extends string = string,
  R = unknown,
  V = number,
> {
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
  ): CompilationResult<T, R, V>;
}

/**
 * The `interval-js` target, typed concretely: its compiled `run` accepts
 * `number | Interval` variables (a plain number is auto-converted to a point
 * interval) and returns an `IntervalResult`. Returned by
 * `getCompilationTarget("interval-js")` so callers get this without a cast.
 *
 * Defined here (not in a `types-*.ts` file) because the layering rules forbid
 * the type-definition layer from importing `interval/`; `compilation/` may.
 */
export type IntervalJsCompilationTarget<Expr = unknown> = LanguageTarget<
  Expr,
  'interval-js',
  IntervalResult,
  number | Interval
>;

/**
 * The `javascript` target, typed concretely: its compiled `run` accepts
 * `number | ComplexResult` variables (plain reals or complex domain-coloring
 * inputs) and returns `number | ComplexResult`. Returned by
 * `getCompilationTarget("javascript")`.
 */
export type JavaScriptCompilationTarget<Expr = unknown> = LanguageTarget<
  Expr,
  'javascript',
  number | ComplexResult,
  number | ComplexResult
>;

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

  /**
   * Cap the trip count of emitted `Sum`/`Product` loops: a loop whose
   * iteration count would exceed the budget (including infinite bounds)
   * evaluates to `NaN` instead of running. See `CompileTarget.iterationBudget`.
   */
  iterationBudget?: number;

  /**
   * Quadrature strategy for compiled definite integrals (`Integrate`).
   *
   * - `'adaptive'` (default) — deterministic adaptive Gauss–Kronrod (GK15):
   *   near machine precision on smooth integrands, µs-scale, with automatic
   *   Monte-Carlo fallback on non-convergence.
   * - `'monte-carlo'` — force the legacy stochastic Monte-Carlo estimator
   *   (~1e-4 typical error, different result each call).
   */
  quadrature?: 'adaptive' | 'monte-carlo';
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
export type ExpressionRunner<R = number | ComplexResult, V = number> = (
  vars: Record<string, V>
) => R;

/**
 * Runner for compiled lambda (`Function`) expressions — called with
 * positional arguments.
 *
 * ```typescript
 * result.run(0.5, 1.0)
 * ```
 */
export type LambdaRunner<R = number | ComplexResult, V = number> = (
  ...args: V[]
) => R;

/**
 * Overloaded callable that accepts both calling conventions.
 *
 * Supports two calling styles:
 * - **Expression**: `run({ x: 0.5 })` — pass a variables object
 * - **Lambda**: `run(0.5, 1.0)` — pass positional arguments
 *
 * Check `calling` on the `CompilationResult` to know which convention
 * the compiled expression actually uses.
 *
 * `V` is the type of the variable/argument values. It defaults to `number`
 * (the `javascript` target's real-valued convention). Non-`number` targets
 * bind it to their own value type — e.g. `interval-js` uses
 * `number | Interval` (a plain number is auto-converted to a point interval),
 * and a complex domain-coloring runner uses `number | ComplexResult`.
 */
export interface CompiledRunner<R = number | ComplexResult, V = number> {
  /** Call with a variables object (for compiled expressions) */
  (vars: Record<string, V>): R;
  /** Call with positional arguments (for compiled lambda expressions) */
  (...args: V[]): R;
}

/**
 * Result of compiling an expression.
 *
 * Three type parameters control the shape:
 * - `T` — the target name. For executable targets (`'javascript'` |
 *   `'interval-js'`), `run` and `calling` are guaranteed present.
 * - `R` — the return type of `run`. Defaults to `number | ComplexResult`.
 *   Pass `number` when `realOnly: true`.
 * - `V` — the type of the variable/argument values `run` accepts. Defaults to
 *   `number`; `interval-js` binds it to `number | Interval`, a complex runner
 *   to `number | ComplexResult`. (Positioned after `R` so existing
 *   `CompilationResult<T, R>` uses keep the `number` default.)
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
  V = number,
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
  run?: CompiledRunner<R, V>;
} & (T extends ExecutableTarget
  ? { calling: 'expression' | 'lambda'; run: CompiledRunner<R, V> }
  : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    {});
