import type { Complex } from 'complex-esm';
import type { OneOf } from '../common/one-of';
import type { MathJsonSymbol, MathJsonNumberObject } from '../math-json';
import type { Type, TypeString, TypeResolver } from '../common/type/types';
import type { BoxedType } from '../common/type/boxed-type';
import type { ConfigurationChangeListener } from '../common/configuration-change';
import type {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from './numeric-value/types';
import type { BigNum, IBigNum, Rational } from './numerics/types';
import type {
  LatexDictionaryEntry,
  LatexString,
  ParseLatexOptions,
} from './latex-syntax/types';
import type { IndexedLatexDictionary } from './latex-syntax/dictionary/definitions';

import type { BoxedExpression, SemiBoxedExpression } from './types-expression';
import type {
  Metadata,
  CanonicalOptions,
  BoxedSubstitution,
} from './types-serialization';
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
} from './types-definitions';
import type {
  AssumeResult,
  Rule,
  BoxedRule,
  BoxedRuleSet,
  RuleStep,
  AssignValue,
  Scope,
  EvalContext,
} from './types-evaluation';
import type { LanguageTarget } from './compilation/types';

/** @internal */
export interface IComputeEngine extends IBigNum {
  latexDictionary: readonly LatexDictionaryEntry[];

  /** @private */
  _indexedLatexDictionary: IndexedLatexDictionary;

  decimalSeparator: LatexString;

  // Common symbols
  readonly True: BoxedExpression;
  readonly False: BoxedExpression;
  readonly Pi: BoxedExpression;
  readonly E: BoxedExpression;
  readonly Nothing: BoxedExpression;

  readonly Zero: BoxedExpression;
  readonly One: BoxedExpression;
  readonly Half: BoxedExpression;
  readonly NegativeOne: BoxedExpression;
  /** ImaginaryUnit */
  readonly I: BoxedExpression;
  readonly NaN: BoxedExpression;
  readonly PositiveInfinity: BoxedExpression;
  readonly NegativeInfinity: BoxedExpression;
  readonly ComplexInfinity: BoxedExpression;

  /** @internal */
  readonly _BIGNUM_NAN: BigNum;
  /** @internal */
  readonly _BIGNUM_ZERO: BigNum;
  /** @internal */
  readonly _BIGNUM_ONE: BigNum;
  /** @internal */
  readonly _BIGNUM_TWO: BigNum;
  /** @internal */
  readonly _BIGNUM_HALF: BigNum;
  /** @internal */
  readonly _BIGNUM_PI: BigNum;
  /** @internal */
  readonly _BIGNUM_NEGATIVE_ONE: BigNum;

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

  angularUnit: AngularUnit;

  costFunction: (expr: BoxedExpression) => number;

  /** The rules used by `.simplify()` when no explicit `rules` option is passed.
   *  Initialized to the built-in simplification rules.
   *  Users can `push()` additional rules or replace the entire array. */
  simplificationRules: Rule[];

  strict: boolean;

  box(
    expr: NumericValue | SemiBoxedExpression,
    options?: {
      canonical?: CanonicalOptions;
      structural?: boolean;
      scope?: Scope;
    }
  ): BoxedExpression;

  function(
    name: string,
    ops: ReadonlyArray<SemiBoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: CanonicalOptions;
      structural?: boolean;
      scope?: Scope;
    }
  ): BoxedExpression;

  /**
   * This is a primitive to create a boxed function.
   *
   * In general, consider using `ce.box()` or `ce.function()` or
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
    ops: ReadonlyArray<BoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      scope?: Scope;
    }
  ): BoxedExpression;

  /** @internal Compile a boxed expression to an executable function. */
  _compile(
    expr: BoxedExpression,
    options?: Record<string, any>
  ): ((...args: any[]) => any) & { isCompiled?: boolean };

  /** Register a custom compilation target. */
  registerCompilationTarget(name: string, target: LanguageTarget): void;

  /** Get a registered compilation target by name. */
  getCompilationTarget(name: string): LanguageTarget | undefined;

  /** Return the names of all registered compilation targets. */
  listCompilationTargets(): string[];

  /** Remove a registered compilation target. */
  unregisterCompilationTarget(name: string): void;

  /** @internal Fu trigonometric simplification algorithm */
  _fuAlgorithm(
    expr: BoxedExpression,
    options?: Record<string, any>
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
  ): BoxedExpression;

  symbol(
    sym: string,
    options?: { canonical?: CanonicalOptions; metadata?: Metadata }
  ): BoxedExpression;

  string(s: string, metadata?: Metadata): BoxedExpression;

  error(message: string | string[], where?: string): BoxedExpression;

  typeError(
    expectedType: Type,
    actualType: undefined | Type | BoxedType,
    where?: SemiBoxedExpression
  ): BoxedExpression;

  hold(expr: SemiBoxedExpression): BoxedExpression;

  tuple(...elements: ReadonlyArray<number>): BoxedExpression;
  tuple(...elements: ReadonlyArray<BoxedExpression>): BoxedExpression;

  type(type: Type | TypeString | BoxedType): BoxedType;

  rules(
    rules:
      | Rule
      | ReadonlyArray<Rule | BoxedRule>
      | BoxedRuleSet
      | undefined
      | null,
    options?: { canonical?: boolean }
  ): BoxedRuleSet;

  getRuleSet(
    id?: 'harmonization' | 'solve-univariate' | 'standard-simplification'
  ): BoxedRuleSet | undefined;

  parse(
    latex: null,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): null;
  parse(
    latex: LatexString,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): BoxedExpression;
  parse(
    latex: LatexString | null,
    options?: Partial<ParseLatexOptions> & { canonical?: CanonicalOptions }
  ): BoxedExpression | null;

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
   * Use `ce.box(id)` instead
   * @internal */
  _getSymbolValue(id: MathJsonSymbol): BoxedExpression | undefined;
  /**
   * Use `ce.assign(id, value)` instead.
   * @internal */
  _setSymbolValue(
    id: MathJsonSymbol,
    value: BoxedExpression | boolean | number | undefined
  ): void;

  /**
   * Set a value directly in the current context's values map.
   * Used for assumptions so values are properly scoped.
   * @internal */
  _setCurrentContextValue(
    id: MathJsonSymbol,
    value: BoxedExpression | boolean | number | undefined
  ): void;

  /** A list of the function calls to the current evaluation context */
  trace: ReadonlyArray<string>;

  lookupContext(id: MathJsonSymbol): undefined | EvalContext;

  /** @internal */
  _swapContext(context: EvalContext): void;

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

  assume(predicate: BoxedExpression): AssumeResult;

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
  getSequenceCache(
    name: string
  ): Map<number | string, BoxedExpression> | undefined;

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
  ): BoxedExpression[] | undefined;

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
    terms: (number | BoxedExpression)[],
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

  forget(symbol?: MathJsonSymbol | MathJsonSymbol[]): void;

  ask(pattern: BoxedExpression): BoxedSubstitution[];

  verify(query: BoxedExpression): boolean | undefined;

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
}
