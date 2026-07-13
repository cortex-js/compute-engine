import type { Complex } from 'complex-esm';
import type { OneOf } from '../common/one-of.js';
import type { MathJsonSymbol, MathJsonNumberObject } from '../math-json.js';
import type { Type, TypeString, TypeResolver } from '../common/type/types.js';
import type { BoxedType } from '../common/type/boxed-type.js';
import type { ConfigurationChangeListener } from '../common/configuration-change.js';
import type {
  ParseLatexOptions,
  SerializeLatexOptions,
} from './latex-syntax/types.js';
import type {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from './numeric-value/types.js';
import type { BigNum, Rational } from './numerics/types.js';

import type { Expression, ExpressionInput } from './types-expression.js';
import type {
  Metadata,
  CanonicalOptions,
  FormOption,
  BoxedSubstitution,
} from './types-serialization.js';
import type {
  AngularUnit,
  SymbolDefinition,
  OperatorDefinition,
  ValueDefinition,
  BoxedDefinition,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
  InterpretResult,
} from './types-definitions.js';
import type {
  AssumeResult,
  Rule as KernelRule,
  BoxedRule as KernelBoxedRule,
  BoxedRuleSet as KernelBoxedRuleSet,
  RulePurpose,
  RuleStep as KernelRuleStep,
  AssignValue as KernelAssignValue,
  Scope as KernelScope,
  EvalContext as KernelEvalContext,
} from './types-kernel-evaluation.js';
import type {
  LanguageTarget,
  CompilationResult,
  IntervalJsCompilationTarget,
  JavaScriptCompilationTarget,
} from './compilation/types.js';

export type { RulePurpose } from './types-kernel-evaluation.js';

type Rule = KernelRule<Expression, ExpressionInput, IComputeEngine>;
type BoxedRule = KernelBoxedRule<Expression, IComputeEngine>;
type BoxedRuleSet = KernelBoxedRuleSet<Expression, IComputeEngine>;
type RuleStep = KernelRuleStep<Expression>;
type AssignValue = KernelAssignValue<
  Expression,
  ExpressionInput,
  IComputeEngine
>;
type Scope = KernelScope<BoxedDefinition>;
type EvalContext = KernelEvalContext<Expression, BoxedDefinition>;

/** Minimal interface for a LaTeX parser/serializer.
 *  Structurally compatible with `LatexSyntax` without importing it. */
export interface ILatexSyntax {
  parse(
    latex: string,
    options?: Partial<ParseLatexOptions>
  ): import('../math-json/types.js').MathJsonExpression | null;
  serialize(
    expr: import('../math-json/types.js').MathJsonExpression,
    options?: Record<string, unknown>
  ): string;

  /** Named dictionary entries with their LaTeX trigger strings, for reverse
   *  library search (`ce.searchDefinitions()`). Optional: MathJSON-only
   *  builds and minimal injected syntaxes may not implement it. */
  getNamedTriggers?(): ReadonlyArray<{ name: string; triggers: string[] }>;
}

export type OperatorInfo = {
  kind: 'function' | 'opaque';
  signature?: BoxedType;

  /**
   * `true` when the operator's definition provides an evaluation rule — an
   * `evaluate` handler or a `collection` handler — so that applying it can
   * produce a computed result. `false` for a registered-but-inert head that
   * only parses/serializes (e.g. `Triangle`), which is returned unchanged by
   * `evaluate()`.
   *
   * This is a "has an evaluation rule" signal, **not** a guarantee that the
   * head computes. A few common heads reduce only through a `canonical`
   * rewrite to a different operator and therefore report `false` even though
   * they do compute: `Exp` (→ `Power`), `Square` (→ `Power`), `Complex`,
   * and `Greater` (→ `Less`). Equivalent to `kind === 'function'`.
   */
  canEvaluate: boolean;
};

export type SymbolInfo = {
  kind: 'constant' | 'variable';
  type: BoxedType;
};

/** One result of `ce.searchDefinitions()`. */
export type DefinitionSearchResult = {
  /** The canonical identifier, e.g. `'GCD'`. Always resolvable via
   * `ce.lookupDefinition(id)`. */
  id: MathJsonSymbol;

  /** The kind of definition, using the same semantics as
   * `operatorInfo()`/`symbolInfo()`:
   * - `'function'` — an operator with an `evaluate` or `collection` handler
   * - `'opaque'` — a registered-but-inert operator head
   * - `'constant'` — a constant value symbol (e.g. `Pi`)
   * - `'variable'` — a declared, non-constant value symbol
   */
  kind: 'function' | 'opaque' | 'constant' | 'variable';
};

/** @internal */
/** A symbolic-integration provider: given an integrand and the integration
 * variable, returns a closed-form antiderivative (an expression in `variable`),
 * or `null` when it cannot integrate it. See `IComputeEngine._integrationProvider`.
 *
 * When an optional `trace` accumulator is passed (by `expr.explain('Integrate')`),
 * the provider appends a curated, whole-state step chain describing how the
 * antiderivative was found. The argument is backward-compatible: the plain
 * `Integrate` evaluator calls the provider with two arguments and never traces. */
export type IntegrationProvider = (
  integrand: Expression,
  variable: string,
  trace?: RuleStep[]
) => Expression | null;

export interface IComputeEngine {
  /** The LatexSyntax instance used for LaTeX parsing/serialization.
   *  `undefined` when no LatexSyntax was provided to the constructor.
   */
  readonly latexSyntax: ILatexSyntax | undefined;

  /** @internal Returns the LatexSyntax instance or throws if unavailable. */
  _requireLatexSyntax(): ILatexSyntax;

  /** @internal An optional symbolic-integration provider. When set, the
   * `Integrate` evaluator consults it for an indefinite antiderivative before
   * falling back to the built-in `antiderivative()`. Returns a closed-form
   * antiderivative (an expression in `variable`), or `null`/an inert
   * `Integrate` when it cannot integrate the integrand. This is the slot the
   * opt-in `loadIntegrationRules()` (Rubi rule driver) registers into. */
  _integrationProvider?: IntegrationProvider;

  /** Engine-wide LaTeX parse/serialize options (e.g. `decimalSeparator`).
   *  Merged into every `parse()` and `toLatex()` call between LatexSyntax
   *  defaults and per-call overrides. */
  latexOptions: Partial<ParseLatexOptions & SerializeLatexOptions>;

  // Common symbols
  readonly True: Expression;
  readonly False: Expression;
  readonly Pi: Expression;
  readonly E: Expression;
  readonly Nothing: Expression;

  readonly Zero: Expression;
  readonly One: Expression;
  readonly Half: Expression;
  readonly NegativeOne: Expression;
  /** ImaginaryUnit */
  readonly I: Expression;
  readonly NaN: Expression;
  readonly PositiveInfinity: Expression;
  readonly NegativeInfinity: Expression;
  readonly ComplexInfinity: Expression;

  readonly context: EvalContext;
  contextStack: ReadonlyArray<EvalContext>;

  /** @internal */
  _evalContextStack: EvalContext[];

  /** @internal */
  _isVerifying: boolean;

  /** @internal */
  readonly isVerifying: boolean;

  /** @internal */
  readonly _typeResolver: TypeResolver;

  /** Absolute time beyond which evaluation should not proceed
   * @internal
   */
  _deadline?: number;

  /** Time remaining before _deadline
   * @internal
   */
  _timeRemaining: number;

  /** @internal */
  _generation: number;

  timeLimit: number;

  iterationLimit: number;

  recursionLimit: number;

  maxCollectionSize: number;

  chop(n: number): number;
  chop(n: BigNum): BigNum | 0;
  chop(n: number | BigNum): number | BigNum;

  bignum: (a: string | number | bigint | BigNum) => BigNum;

  complex: (a: number | Complex, b?: number) => Complex;

  /** @internal */
  _numericValue(
    value:
      | number
      | bigint
      | OneOf<[BigNum | NumericValueData | ExactNumericValueData]>
  ): NumericValue;

  set precision(p: number | 'machine' | 'auto');
  get precision(): number;

  tolerance: number;

  /** Seed controlling deterministic, reproducible randomness. `null` (default)
   *  is non-deterministic. See the accessor on `ComputeEngine` for the full
   *  semantics (stream reset on assignment, compile-time baking). */
  randomSeed: number | string | null;

  /** @internal Draw the next uniform in [0, 1) from the seeded stream (or
   *  `Math.random()` when no seed is set). */
  _random(): number;

  /** @internal The hashed numeric seed for compile-time baking, or `null`. */
  _randomNumericSeed(): number | null;

  angularUnit: AngularUnit;

  costFunction: (expr: Expression) => number;

  /** The rules used by `.simplify()` when no explicit `rules` option is passed.
   *  Initialized to the built-in simplification rules.
   *  Users can `push()` additional rules or replace the entire array. */
  simplificationRules: Rule[];

  /** The rules used by `solve()` to find roots of univariate expressions.
   *  Each rule matches a normalized equation `f(_x) = 0` — the unknown is
   *  the wildcard `_x` — and `replace` produces a root expression.
   *  Conditions should reject matches where other wildcards capture `_x`.
   *  Candidate roots are validated against the original equation, so an
   *  over-eager template degrades to a no-op rather than a wrong answer.
   *  Initialized to the built-in root-finding rules; `push()` to extend,
   *  assign to replace. */
  solveRules: Rule[];

  /** The rules used by `solve()` to transform an equation into equivalent,
   *  easier-to-solve forms before root-finding (e.g. `ln f(x) → f(x) - 1`).
   *  Same conventions and extension pattern as `solveRules`. */
  harmonizationRules: Rule[];

  strict: boolean;

  expr(
    expr: NumericValue | ExpressionInput,
    options?: {
      form?: FormOption;
      scope?: Scope;
    }
  ): Expression;

  /** @deprecated Use `expr()` instead. */
  box(
    expr: NumericValue | ExpressionInput,
    options?: {
      form?: FormOption;
      scope?: Scope;
    }
  ): Expression;

  /**
   * Parse a LaTeX string and return a boxed expression.
   *
   * This is a convenience method equivalent to `ce.expr(parse(latex))`,
   * but uses the engine's symbol definitions for better parsing accuracy.
   */
  parse(
    latex: string,
    options?: Partial<ParseLatexOptions> & { form?: FormOption }
  ): Expression;
  parse(
    latex: string | null,
    options?: Partial<ParseLatexOptions> & { form?: FormOption }
  ): Expression | null;

  /**
   * The symbols that appear in function-application syntax `f(…)` in `latex`
   * but are not defined as functions in the current scope (so they parse as
   * implicit multiplication or are left unresolved). Scope-aware and
   * side-effect-free. Intended to flag calls to undefined functions in tools
   * such as notebooks; intersect with {@link Expression.freeVariables}
   * to drop deliberate multiplication of defined values.
   */
  appliedNonFunctions(latex: string): string[];

  function(
    name: string,
    ops: ReadonlyArray<ExpressionInput>,
    options?: {
      metadata?: Metadata;
      form?: FormOption;
      structural?: boolean;
      scope?: Scope;
    }
  ): Expression;

  /**
   * This is a primitive to create a boxed function.
   *
   * In general, consider using `ce.expr()` or `ce.function()` or
   * `canonicalXXX()` instead.
   *
   * The caller must ensure that the arguments are in canonical form:
   * - arguments are `canonical()`
   * - arguments are sorted
   * - arguments are flattened and desequenced
   *
   * @internal
   */
  _fn(
    name: string,
    ops: ReadonlyArray<Expression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      scope?: Scope;
    }
  ): Expression;

  /** @internal Compile a boxed expression. */
  _compile(
    expr: Expression,
    options?: Record<string, unknown>
  ): CompilationResult;

  /**
   * @internal Get a registered compilation target by name.
   *
   * The two built-in executable targets are typed concretely so their compiled
   * `run` needs no cast: `interval-js` accepts `number | Interval` variables
   * and returns `IntervalResult`; `javascript` accepts `number | ComplexResult`
   * variables (plain reals or complex domain-coloring inputs) and returns
   * `number | ComplexResult`. Any other name (source-only or custom targets)
   * falls back to the generic `LanguageTarget<Expression>`.
   */
  getCompilationTarget(
    name: 'interval-js'
  ): IntervalJsCompilationTarget<Expression> | undefined;
  getCompilationTarget(
    name: 'javascript'
  ): JavaScriptCompilationTarget<Expression> | undefined;
  getCompilationTarget(name: string): LanguageTarget<Expression> | undefined;

  /** @internal Return the names of all registered compilation targets. */
  listCompilationTargets(): string[];

  /** @internal Register a compilation target. */
  registerCompilationTarget(
    name: string,
    target: LanguageTarget<Expression>
  ): void;

  /** @internal Remove a registered compilation target. */
  unregisterCompilationTarget(name: string): void;

  /** @internal Fu trigonometric simplification algorithm */
  _fuAlgorithm(
    expr: Expression,
    options?: Record<string, unknown>
  ): RuleStep | undefined;

  number(
    value:
      | number
      | bigint
      | string
      | NumericValue
      | MathJsonNumberObject
      | BigNum
      | Complex
      | Rational,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): Expression;

  symbol(
    sym: string,
    options?: { canonical?: CanonicalOptions; metadata?: Metadata }
  ): Expression;

  string(s: string, metadata?: Metadata): Expression;

  error(message: string | string[], where?: string): Expression;

  typeError(
    expectedType: Type,
    actualType: undefined | Type | BoxedType,
    where?: ExpressionInput
  ): Expression;

  hold(expr: ExpressionInput): Expression;

  tuple(...elements: ReadonlyArray<number>): Expression;
  tuple(...elements: ReadonlyArray<Expression>): Expression;

  type(type: Type | TypeString | BoxedType): BoxedType;

  rules(
    rules:
      | Rule
      | ReadonlyArray<Rule | BoxedRule>
      | BoxedRuleSet
      | undefined
      | null,
    options?: {
      canonical?: boolean;
      /** Default purpose applied to any rule in the set that doesn't carry
       *  its own `purpose` tag (a per-rule tag takes precedence). */
      purpose?: RulePurpose;
    }
  ): BoxedRuleSet;

  getRuleSet(
    id?: 'harmonization' | 'solve-univariate' | 'standard-simplification'
  ): BoxedRuleSet | undefined;

  pushScope(scope?: Scope, name?: string): void;
  popScope(): void;

  /**
   *
   * When a new eval context is created, it has slots for the local variables
   * from the current lexical scope. It also copies the current set of
   * assumptions.
   *
   * Need a pointer to the current lexical scope (may have a scope chain without an evaluation context). Each lexical scope includes a pointer to the parent scope (it's a DAG).
   *
   * If a function is "scoped" (has a `scoped` flag), create a new lexical scope
   * when the function is canonicalized, store the scope with the function
   * definition (if the function has a lazy flag, and a canonical handler, it
   * can behave like a scoped function, but a scoped flag is convenient,
   * it would still evaluate the arguments).
   *
   * Note: if an expression is not canonical, evaluating it return itself.
   * This is important to support arguments that are just symbol names
   * (they are not canonicalized).
   *
   * When the function expression is evaluated, if it is "scoped", push the
   * scope associated with the function (maybe not?) and a matching eval
   * context, including all the symbols in the lexical scope (including
   * constants). Need some way to indicate that a symbol maps to an argument
   * (in value definition?).
   *
   * When searching the value of a symbol, start with the current
   * eval context, then the previous one.
   *
   * When looking for a definition, start with the lexical scope of the
   * current eval context, then the parent lexical context.
   *
   * @internal */
  _pushEvalContext(scope: Scope, name?: string): void;

  /** @internal */
  _popEvalContext(): void;

  /**
   * Temporarily sets the lexical scope to the provided scope, then
   * executes the function `f` in that scope and returns the result.
   * @internal */
  _inScope<T>(scope: Scope | undefined, f: () => T): T;

  /**
   * For internal use. Use `ce.declare()` instead.
   * @internal */
  _declareSymbolValue(
    name: MathJsonSymbol,
    def: Partial<ValueDefinition>,
    scope?: Scope
  ): BoxedDefinition;

  /**
   * For internal use. Use `ce.declare()` instead.
   * @internal */
  _declareSymbolOperator(
    name: string,
    def: OperatorDefinition,
    scope?: Scope
  ): BoxedDefinition;

  /**
   * Push a set of parameter names that, while canonicalizing a function body,
   * shadow any same-named constant (`i`, `e`, ...) so they resolve as ordinary
   * local variables. Balanced with `_popShadowedParameters`. Optional `types`
   * carry declared types for annotated parameters so the auto-declaration
   * during body canonicalization uses the declared (non-inferred) type.
   * @internal */
  _pushShadowedParameters(
    names: ReadonlyArray<string>,
    types?: ReadonlyMap<string, Type>
  ): void;
  /** @internal */
  _popShadowedParameters(): void;
  /** True if `name` is an active shadowed parameter (see above). @internal */
  _isShadowedParameter(name: string): boolean;
  /** The declared type of an active shadowed parameter, if any. @internal */
  _shadowedParameterType(name: string): Type | undefined;
  /** The binding already auto-declared for an active shadowed parameter during
   * the current body's canonicalization, if any. @internal */
  _shadowedParameterDef(name: string): BoxedDefinition | undefined;
  /** Cache the binding auto-declared for an active shadowed parameter so later
   * references reuse it. @internal */
  _setShadowedParameterDef(name: string, def: BoxedDefinition): void;

  /** Enter a user-function application, throwing a `CancellationError`
   * (`cause: 'recursion-depth-exceeded'`) when `recursionLimit` is exceeded.
   * Balanced with `_exitRecursion`. @internal */
  _enterRecursion(): void;
  /** Leave a user-function application. Balanced with `_enterRecursion`.
   * @internal */
  _exitRecursion(): void;

  /**
   * Use `ce.expr(id)` instead
   * @internal */
  _getSymbolValue(id: MathJsonSymbol): Expression | undefined;
  /**
   * Use `ce.assign(id, value)` instead.
   * @internal */
  _setSymbolValue(
    id: MathJsonSymbol,
    value: Expression | boolean | number | undefined
  ): void;

  /** A list of the function calls to the current evaluation context */
  trace: ReadonlyArray<string>;

  lookupDefinition(id: MathJsonSymbol): undefined | BoxedDefinition;

  assign(ids: { [id: MathJsonSymbol]: AssignValue }): IComputeEngine;
  assign(id: MathJsonSymbol, value: AssignValue): IComputeEngine;
  assign(
    arg1: MathJsonSymbol | { [id: MathJsonSymbol]: AssignValue },
    arg2?: AssignValue
  ): IComputeEngine;

  declareType(name: string, type: Type, options?: { alias?: boolean }): void;

  declare(symbols: {
    [id: MathJsonSymbol]: Type | TypeString | Partial<SymbolDefinition>;
  }): IComputeEngine;
  declare(
    id: MathJsonSymbol,
    def: Type | TypeString | Partial<SymbolDefinition>,
    scope?: Scope
  ): IComputeEngine;
  declare(
    arg1:
      | MathJsonSymbol
      | {
          [id: MathJsonSymbol]: Type | TypeString | Partial<SymbolDefinition>;
        },
    arg2?: Type | TypeString | Partial<SymbolDefinition>,
    arg3?: Scope
  ): IComputeEngine;

  assume(predicate: Expression | string): AssumeResult;

  /**
   * Declare a sequence with a recurrence relation.
   *
   * @example
   * ```typescript
   * // Fibonacci sequence
   * ce.declareSequence('F', {
   *   base: { 0: 0, 1: 1 },
   *   recurrence: 'F_{n-1} + F_{n-2}',
   * });
   * ce.parse('F_{10}').evaluate();  // → 55
   * ```
   */
  declareSequence(name: string, def: SequenceDefinition): IComputeEngine;

  /**
   * Get the status of a sequence definition.
   *
   * @example
   * ```typescript
   * ce.parse('F_0 := 0').evaluate();
   * ce.getSequenceStatus('F');
   * // → { status: 'pending', hasBase: true, hasRecurrence: false, baseIndices: [0] }
   * ```
   */
  getSequenceStatus(name: string): SequenceStatus;

  /**
   * Get information about a defined sequence.
   * Returns `undefined` if the symbol is not a sequence.
   */
  getSequence(name: string): SequenceInfo | undefined;

  /**
   * List all defined sequences.
   * Returns an array of sequence names.
   */
  listSequences(): string[];

  /**
   * Check if a symbol is a defined sequence.
   */
  isSequence(name: string): boolean;

  /**
   * Clear the memoization cache for a sequence.
   * If no name is provided, clears caches for all sequences.
   */
  clearSequenceCache(name?: string): void;

  /**
   * Get the memoization cache for a sequence.
   * Returns a Map of index → value, or `undefined` if not a sequence or memoization is disabled.
   *
   * For single-index sequences, keys are numbers.
   * For multi-index sequences, keys are comma-separated strings (e.g., '5,2').
   */
  getSequenceCache(name: string): Map<number | string, Expression> | undefined;

  /**
   * Generate a list of sequence terms from start to end (inclusive).
   *
   * @param name - The sequence name
   * @param start - Starting index (inclusive)
   * @param end - Ending index (inclusive)
   * @param step - Step size (default: 1)
   * @returns Array of BoxedExpressions, or undefined if not a sequence
   *
   * @example
   * ```typescript
   * ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
   * ce.getSequenceTerms('F', 0, 10);
   * // → [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
   * ```
   */
  getSequenceTerms(
    name: string,
    start: number,
    end: number,
    step?: number
  ): Expression[] | undefined;

  /**
   * Look up sequences in OEIS by their terms.
   *
   * @param terms - Array of sequence terms to search for
   * @param options - Optional configuration (timeout, maxResults)
   * @returns Promise resolving to array of matching sequences
   *
   * @example
   * ```typescript
   * const results = await ce.lookupOEIS([0, 1, 1, 2, 3, 5, 8, 13]);
   * // → [{ id: 'A000045', name: 'Fibonacci numbers', ... }]
   * ```
   */
  lookupOEIS(
    terms: (number | Expression)[],
    options?: OEISOptions
  ): Promise<OEISSequenceInfo[]>;

  /**
   * Check if a defined sequence matches an OEIS sequence.
   *
   * @param name - Name of the defined sequence
   * @param count - Number of terms to check (default: 10)
   * @param options - Optional configuration
   * @returns Promise with match results including OEIS matches and generated terms
   *
   * @example
   * ```typescript
   * ce.declareSequence('F', { base: { 0: 0, 1: 1 }, recurrence: 'F_{n-1} + F_{n-2}' });
   * const result = await ce.checkSequenceOEIS('F', 10);
   * // → { matches: [{ id: 'A000045', name: 'Fibonacci numbers', ... }], terms: [0, 1, 1, ...] }
   * ```
   */
  checkSequenceOEIS(
    name: string,
    count?: number,
    options?: OEISOptions
  ): Promise<{ matches: OEISSequenceInfo[]; terms: number[] }>;

  /**
   * Interpret a notational expression, then propose OEIS-attributed closed
   * forms for it (the async v4 of the `Interpret` ladder).
   *
   * `result.expression` is exactly what the synchronous `Interpret` head
   * returns (a `Sum`/`Product`, or the input unchanged); `result.candidates`
   * are OEIS-attributed closed forms, each verified to reproduce every
   * extracted sample exactly. This is the only interpretation path that
   * performs a network lookup. Too few samples, being offline, a timeout, or an
   * empty result all yield an empty candidate list rather than a rejection.
   *
   * @param expr - The (typically inert, continuation-bearing) expression
   * @param options - OEIS request options (timeout, maxResults)
   *
   * @example
   * ```typescript
   * const { expression, candidates } = await ce.interpret(
   *   ce.parse('1 + 3 + 6 + 10 + \\cdots + n')
   * );
   * ```
   */
  interpret(expr: Expression, options?: OEISOptions): Promise<InterpretResult>;

  forget(symbol?: MathJsonSymbol | MathJsonSymbol[]): void;

  ask(pattern: Expression): BoxedSubstitution[];

  verify(query: Expression | string): boolean | undefined;

  /** @internal */
  _shouldContinueExecution(): boolean;

  /** @internal */
  _checkContinueExecution(): void;

  /** @internal */
  _cache<T>(name: string, build: () => T, purge?: (t: T) => T | undefined): T;

  /** @internal */
  _reset(): void;

  /** @internal */
  listenToConfigurationChange(tracker: ConfigurationChangeListener): () => void;

  /**
   * Introspect a registered operator head.
   *
   * Returns `undefined` if no definition is registered in this engine.
   * Otherwise returns `{ kind, signature? }` where `kind` is `'function'`
   * when the operator has an `evaluate` or `collection` handler, and
   * `'opaque'` when it is declared as a typed-but-opaque node (e.g.,
   * `Triangle`, `Sphere`).
   *
   * Use this to classify heads encountered in parsed MathJSON without
   * maintaining a parallel list of "known" operators.
   */
  operatorInfo(head: string): OperatorInfo | undefined;

  /**
   * Convert a LaTeX identifier string to its canonical MathJSON name without
   * declaring the symbol in the engine scope.
   *
   * Examples:
   * - `'R_{3}'` → `'R_3'`
   * - `'\\theta_x'` → `'theta_x'`
   * - `'\\alpha'` → `'alpha'`
   * - `'1 + 2'` → `''` (not an identifier)
   *
   * Use this instead of `ce.parse(latex).symbol` when you need the canonical
   * name without the side-effect of auto-declaring the symbol.
   */
  normalizeIdentifier(latex: string): string;

  /**
   * Return introspection metadata for a symbol (value definition) in the
   * current scope chain.
   *
   * - `kind: 'constant'` when the symbol is a CE-registered constant
   *   (e.g. `Pi`, `True`, `ExponentialE`).
   * - `kind: 'variable'` for declared but non-constant value symbols
   *   (e.g. after `ce.declare('a', 'real')`).
   *
   * Returns `undefined` for unknown names and for names that resolve to
   * operator/function definitions (use `operatorInfo()` for those — the
   * two methods are non-overlapping).
   */
  symbolInfo(name: string): SymbolInfo | undefined;

  /**
   * Reverse library search: map a plain-text concept query to a ranked list
   * of matching identifiers in the current scope chain (standard library plus
   * any user declarations).
   *
   * Every returned `id` resolves via `ce.lookupDefinition(id)`; chain that
   * call for full detail.
   */
  searchDefinitions(
    query: string,
    options?: { limit?: number }
  ): DefinitionSearchResult[];
}

declare module './types-expression.js' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ExpressionComputeEngine extends IComputeEngine {}
}

declare module './types-definitions.js' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ComputeEngine extends IComputeEngine {}
}
