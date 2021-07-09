//
// What is Compute Engine doing in the `math-json` directory?
//
// The LatexSyntax class has an (optional) reference to a ComputeEngine instance.
// This is  used during parsing to query about the domain of some objects.
// For example to correctly parse `A \times B`, we need to know if `A` is a
// number (in which case `\times\ -> `Multiply`) or a set (in which case
// `\times` -> `CartesianProduct`)
//
// So, the declaration of the **interface** of `ComputeEngine` is here,
// while the implementation is in the `compute-engine` directory.

import type { Expression, Substitution } from './math-json-format';
import type { ExpressionMap } from './expression-map';
import type {
  DictionaryCategory,
  ErrorSignal,
  LatexString,
  Serializer,
  WarningSignal,
  WarningSignalHandler,
} from './public';
import type { Decimal } from 'decimal.js';
import type { Complex } from 'complex.js';

export type NumericDomain =
  | 'Number'
  | 'ExtendedComplexNumber'
  | 'ExtendedRealNumber'
  | 'ComplexNumber'
  | 'ImaginaryNumber'
  | 'RealNumber'
  | 'TranscendentalNumber'
  | 'AlgebraicNumber'
  | 'RationalNumber'
  | 'Integer'
  | 'NegativeInteger'
  | 'NegativeNumber'
  | 'NonNegativeNumber'
  | 'NonNegativeInteger'
  | 'NonPositiveNumber'
  | 'NonPositiveInteger'
  | 'PositiveInteger'
  | 'PositiveNumber';

export type Numeric = number | Decimal | Complex;

export type Pattern<T extends number = Numeric> = Expression<T>;

export type Rule<T extends number = Numeric> = [
  lhs: string | Pattern<T>,
  rhs: string | Pattern<T>,
  condition?:
    | string
    | ((ce: ComputeEngine<T>, args: Substitution<T>) => boolean)
];

export type RuleSet<T extends number = Numeric> = Iterable<Rule<T>>;

/**
 * A dictionary maps a MathJSON name to a definition.
 *
 * A named entry in a dictionary can refer to a symbol, as in the expression,
 * `"Pi"`, to a function: "Add" in the expression `["Add", 2, 3]`, or
 * to a `"Set`".
 *
 * The name can be an arbitrary string of Unicode characters, however
 * the following conventions are recommended:
 *
 * - Use only letters, digits and `-`, and the first character should be
 * a letter: `/^[a-zA-Z][a-zA-Z0-9-]+/`
 * - Built-in functions and symbols should start with an uppercase letter
 *
 * As a shorthand for a numeric symbol definition, a number can be used as
 * well. In that case the domain is determined automatically.
 *
 * ```json
 * { "x": 1.0 }
 * { "x" : { "domain": "RealNumber", "value": 1.0 } }
 * ```
 */
export type Dictionary<T extends number = number> = {
  [name: string]: T | Definition<T>;
};
/**
 * The entries of a `CompiledDictionary` have been validated and
 * optimized for faster evaluation.
 *
 * When a new scope is created with `pushScope()` or when creating a new
 * engine instance, new instances of `CompiledDictionary` are created as needed.
 */
export type CompiledDictionary<T extends number = number> = Map<
  string,
  Definition<T>
>;

/**
 * A scope is a set of names in a dictionary that are bound (defined) in
 * a MathJSON expression.
 *
 * Scopes are arranged in a stack structure. When an expression that defined
 * a new scope is evaluated, the new scope is added to the scope stack.
 * Outside of the expression, the scope is removed from the scope stack.
 *
 * The scope stack is used to resolve symbols, and it is possible for
 * a scope to 'mask' definitions from previous scopes.
 *
 * Scopes are lexical (also called a static scope): they are defined based on
 * where they are in an expression, they are not determined at runtime.
 *
 */
export type Scope = {
  /** This handler is invoked when exiting this scope if there are any
   * warnings pending. */
  warn?: WarningSignalHandler;

  /** Signal `timeout` when the execution time for this scope is exceeded.
   * Time in seconds, default 2s.
   */
  timeLimit?: number;

  /** Signal `out-of-memory` when the memory usage for this scope is exceeded.
   * Memory in Megabytes, default: 1Mb.
   */
  memoryLimit?: number;

  /** Signal `recursion-depth-exceeded` when the recursion depth for this
   * scope is exceeded. */
  recursionLimit?: number;

  /** Signal `iteration-limit-exceeded` when the iteration limit for this
   * scope is exceeded. Default: no limits.*/
  iterationLimit?: number;
};

export type RuntimeScope<T extends number = number> = Scope & {
  parentScope: RuntimeScope<T>;

  dictionary?: CompiledDictionary<T>;

  assumptions: undefined | ExpressionMap<T, boolean>;

  /** The location of the call site that created this scope */
  origin?: {
    name?: string;
    line?: number;
    column?: number;
  };

  /** Free memory should not go below this level for execution to proceed */
  lowWaterMark?: number;

  /** Set when one or more warnings have been signaled in this scope */
  warnings?: WarningSignal[];
};

/**
 * A function definition can have some flags set indicating specific
 * properties of the function.
 */
export type FunctionFeatures = {
  /**  If true, the function is applied element by element to lists, matrices
   * and equations.
   *
   * Default: false
   */
  threadable: boolean;

  /** If true, [f, [f, a], b] simplifies to [f, a, b]
   *
   * Default: false
   */
  associative: boolean;

  /** If true, [f, a, b] simplifies to [f, b, a]
   *
   * Default: false
   */
  commutative: boolean;

  /** If true, when the function is univariate, `[f, ["Add", x, c]]` where `c`
   * is constant, is simplified to `["Add", [f, x], c]`.
   *
   * When the function is multivariate, additivity is considered only on the
   * first argument: `[f, ["Add", x, c], y]` simplifies to `["Add", [f, x, y], c]`.
   *
   * Default: false
   */
  additive: boolean;

  /** If true, when the function is univariate, `[f, ["Multiply", x, y]]`
   * simplifies to `["Multiply", [f, x], [f, y]]`.
   *
   * When the function is multivariate, multiplicativity is considered only on the
   * first argument: `[f, ["Multiply", x, y], z]` simplifies to
   * `["Multiply", [f, x, z], [f, y, z]]`
   *
   * Default: false
   */
  multiplicative: boolean;

  /** If true, when the function is univariate, `[f, ["Multiply", x, c]]`
   * simplifies to `["Multiply", [f, x], c]` where `c` is constant
   *
   * When the function is multivariate, multiplicativity is considered only on the
   * first argument: `[f, ["Multiply", x, y], z]` simplifies to
   * `["Multiply", [f, x, z], [f, y, z]]`
   *
   * Default: false
   */
  outtative: boolean;

  /** If true, `[f, [f, x]]` simplifies to `[f, x]`.
   *
   * Default: false
   */
  idempotent: boolean;

  /** If true, `[f, [f, x]]` simplifies to `x`.
   *
   * Default: false
   */
  involution: boolean;

  /**
   * If true, the input arguments and the result are expected to be `number`.
   *
   * Default: false
   */
  numeric: boolean;

  /** If true, invoking the function with a given set of arguments will
   * always return the same value, i.e. `Sin` is pure, `Random` isn't.
   * This is used to cache the result of the function.
   *
   * Default: true
   */
  pure: boolean;
};

/** A domain such as `Number` or `Boolean` represents a set of values.
 *
 * Domains can be defined as a union or intersection of domains:
 * - `["Union", "Number", "Boolean"]` A number or a boolean.
 * - `["SetMinus", "Number", 1]`  Any number except "1".
 *
 * Domains are defined in a hierarchy (a lattice).
 */
export type Domain =
  | 'Anything'
  | 'Nothing'
  | 'Domain'
  | 'Expression'
  | NumericDomain
  | 'Boolean'
  | 'MaybeBoolean'
  | 'Function'
  | 'ParametricDomain'
  | 'Predicate'
  | 'LogicalFunction'
  | 'TrigonometricFunction'
  | 'HyperbolicFunction'
  | 'Collection'
  | 'String'
  | 'Dictionary'
  | 'Symbol'
  | 'List'
  | 'Set'; // @todo should be `string`
export type DomainExpression<T extends number = Numeric> = Expression<T>;

export type BaseDefinition = {
  /**
   * The domain of this item.
   */
  domain: Domain;
  /**
   * A short string representing an entry in a wikibase.
   *
   * For example `Q167` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   * for the `Pi` constant.
   */
  wikidata?: string;

  /**
   * The scope this definition belongs to.
   *
   * This field is usually undefined, but its value is set by `getDefinition()`,
   * `getFunctionDefinition()`
   */
  scope?: Scope;
};

/**
 *
 *
 */
export type FunctionDefinition<T extends number = number> = BaseDefinition &
  Partial<FunctionFeatures> & {
    /**
     * - `none`: Each of the arguments is evaluated
     * - `all`: None of the arguments are evaluated and they are passed as is
     * - `first`: The first argument is not evaluated, the others are
     * - `rest`: The first argument is evaluated, the others aren't
     */

    hold?: 'none' | 'all' | 'first' | 'rest';

    /**
     * If true, `Sequence` arguments are not automatically spliced in
     */
    sequenceHold?: boolean;

    /**
     * The value of this function, as a lambda function.
     * The arguments are `_`, `_2`, `_3`, etc...
     *
     * This property may be used to perform some simplification, or
     * to numerically evaluate the function if no `evalNumber` property
     * is provided.
     */
    value?: T | Expression;

    /**
     * Rewrite the expression into a simplified form.
     *
     * Only make simple rewrites of the expression.
     *
     * If appropriate, make use of assumptions with `ce.is()`.
     *
     * Do not resolve the values of variables, that is `ce.simplify("x+1")` is
     * `x + 1` even if `x = 0`. However, resolving constants is OK.
     *
     * Do not make approximate evaluations (i.e. floating point operations).
     *
     * Do not perform complex or lengthy operations: do these in `ce.evaluate()`.
     *
     * The passed-in arguments have been simplified already,
     * except for those to which a `hold` apply.
     */
    simplify?: (
      ce: ComputeEngine<T>,
      ...args: Expression<T>[]
    ) => null | Expression<T>;

    /**
     *
     * Calculate the domain of the result, based on the input domains.
     *
     * `doms` is the domain of the arguments as domain symbol such as
     * `ComplexNumber` or `Integer`.
     *
     * The return value is null if the input domains cannot be handled by
     * this definition.
     *
     * Otherwise, the return value is the domain of the result.
     *
     * This function is used to select an appropriate definition, in case there
     * are multiple available. For example it allows to distinguish between
     * a `Add` function that applies to numbers and an `Add` function that
     * applies to tensors.
     *
     */
    evalDomain: (ce: ComputeEngine, ...doms: Domain[]) => null | Domain;

    /** Dimensional analysis */
    evalDimension?: (
      ce: ComputeEngine<T>,
      ...args: Expression<T>[]
    ) => Expression<T>;

    /**
     * Make a numeric evaluation of the arguments.
     *
     * The arguments have already been numerically evaluated unless they
     * have a `hold` property.
     *
     * If the function is `numeric` all the arguments are guaranteed to be
     * numbers and the function should return a number.
     *
     */
    evalNumber?: (ce: ComputeEngine<T>, ...args: number[]) => number;

    /** Like `evalNumber()` but for `Complex` numbers */
    evalComplex?: (
      ce: ComputeEngine<T>,
      ...args: (number | Complex)[]
    ) => Complex;

    /** Live `evalNumber()` but for `Decimal` numbers (arbitrary large floating
     * point numbers).
     */
    evalDecimal?: (
      ce: ComputeEngine<T>,
      ...args: (number | Decimal)[]
    ) => Decimal;

    /**
     * Evaluate the arguments.
     *
     * This will be invoked by the `ce.evaluate()` function.
     *
     * If a function must perform any computations that may take a long time
     * (>100ms), because they are computationally expensive, or because they
     * require a network fetch, defer these computations to `ce.evaluate()`
     * rather than `ce.simplify()`.
     *
     * If a synchronous `ce.evaluate()` function is provided it will be used and
     * `ce.evaluateAsync()` will not be called.
     *
     * The arguments have been simplified and numerically evaluated, except
     * the arguments to which a `hold` apply.
     */
    evaluate?: (
      ce: ComputeEngine<T>,
      ...args: Expression<T>[]
    ) => Expression<T>;
    evaluateAsync?: (
      ce: ComputeEngine<T>,
      ...args: Promise<Expression<T>>[]
    ) => Promise<Expression<T>>;

    /** Return a compiled (optimized) function. */
    compile?: (
      ce: ComputeEngine<T>,
      ...args: CompiledExpression<T>[]
    ) => CompiledExpression<T>;
  };

export type SymbolFeatures = {
  /**
   * If true the value of the symbol is constant.
   *
   * If false, the symbol is a variable.
   */
  constant: boolean;

  /**
   * If false, the value of the symbol is substituted during a `ce.simplify().
   * If true, the symbol is unchanged during a `ce.simplify()` and the value
   * is only used during a `ce.N()` or `ce.evaluate()`.
   *
   * True by default;
   */
  hold?: boolean;
};

export type SymbolDefinition<T extends number = number> = BaseDefinition &
  SymbolFeatures & {
    /** `value` can be a function to account since for some constants, such as
     * `Pi`, the actual value depends on the `precision` setting of the
     * `ComputeEngine` */
    value?: Expression<T> | ((ce: ComputeEngine) => Expression<T>);
  };

export type CollectionDefinition<T extends number = number> = BaseDefinition & {
  /** If true, the elements of the collection can be iterated over using
   * the `iterator() function
   */
  iterable?: boolean;
  iterator?: {
    next: () => Expression<T>;
    done: () => boolean;
  };
  /** If true, elements of the collection can be accessed with a numerical
   * index with the `at()` function
   */
  indexable?: boolean;
  at?: (index: number) => Expression<T>;

  /** If true, the size of the collection is finite.
   *
   */
  countable: boolean;
  /** Return the number of elements in the collection.
   */
  size?: () => number;

  /** A predicate function to determine if an expression
   * is a member of the collection or not (answers `True`, `False` or `Maybe`).
   */
  isElementOf?: (expr: Expression<T>) => boolean;
};

export type SetDefinition<T extends number = number> =
  CollectionDefinition<T> & {
    /** The supersets of this set: they should be symbols with a `Set` domain */
    supersets: Domain[];

    /** If a set can be defined explicitely in relation to other sets,
     * the `value` represents that relationship.
     */
    value?: Expression<T>;

    /**
     * A function that determins if a set is a subset of another.
     * The `rhs` argument is either the name of the symbol, or a function
     * with the head of the symbol.
     */
    isSubsetOf?: (
      engine: ComputeEngine,
      lhs: Expression<T>,
      rhs: Expression<T>
    ) => boolean;
  };

export type Definition<T extends number = number> =
  | SymbolDefinition<T>
  | FunctionDefinition
  | SetDefinition
  | CollectionDefinition<T>;

export type CompiledExpression<T extends number = number> = {
  evaluate?: (scope: { [symbol: string]: T | Expression<T> }) => Expression<T>;
  asyncEvaluate?: (scope: {
    [symbol: string]: T | Expression<T>;
  }) => Promise<T | Expression<T>>;
};

export type Simplification = 'simplify-all' | 'simplify-arithmetic';

export type NumericFormat = 'auto' | 'machine' | 'decimal' | 'complex';

export type AssumeResult =
  | 'internal-error'
  | 'not-a-predicate'
  | 'contradiction'
  | 'tautology'
  | 'ok';

export declare class ComputeEngine<T extends number = Numeric> {
  static getDictionaries(
    categories: DictionaryCategory[] | 'all'
  ): Readonly<Dictionary<any>>[];

  context: RuntimeScope<T>;

  readonly assumptions: ExpressionMap<T, boolean>;

  /** Absolute time beyond which evaluation should not proceed */
  deadline?: number;

  readonly timeLimit: number;
  readonly iterationLimit: number;
  readonly recursionLimit: number;

  set precision(p: number | 'machine');
  get precision(): number;

  numericFormat: NumericFormat;

  tolerance: number;

  serializer: Serializer<T>;

  cost: (expr: Expression) => number;

  constructor(options?: { dictionaries?: Readonly<Dictionary<T>>[] });

  pushScope(options?: {
    dictionary?: Readonly<Dictionary<Numeric>>;
    assumptions?: (LatexString | Expression)[];
    scope?: Partial<Scope>;
  }): void;

  popScope(): void;

  signal(sig: ErrorSignal | WarningSignal): void;

  shouldContinueExecution(): boolean;
  checkContinueExecution(): void;

  getFunctionDefinition(expr: Expression): FunctionDefinition<T> | null;
  getDefinition(name: string): Definition<T> | null;

  canonical(expr: Expression<T> | null): Expression<T> | null;

  /** Format the expression according to the specified forms.
   *
   * If no form is provided, the expression is formatted with the 'canonical'
   * form.
   *
   */
  format(
    expr: Expression<T> | null,
    forms?: Form | Form[]
  ): Expression<T> | null;

  evaluate(
    expr: Expression<T>,
    options?: { timeLimit?: number; iterationLimit?: number }
  ): Promise<Expression<T> | null>;

  simplify(
    expr: Expression<T>,
    options?: {
      timeLimit?: number;
      iterationLimit?: number;
      simplifications?: Simplification[];
    }
  ): Expression<T> | null;

  N(
    expr: Expression<T>,
    options?: { precision?: number }
  ): T | Expression<T> | null;

  solve(exp: Expression<T>, vars: Iterable<string>): null | Expression<T>[];

  is(symbol: Expression<T>, domain: Domain): boolean | undefined;
  is(predicate: Expression<T>): boolean | undefined;
  is(arg1: Expression<T>, arg2?: Domain): boolean | undefined;

  ask(pattern: Expression<T>): Substitution<T>[];

  replace(expr: Expression<T>, rules: RuleSet<T>): Expression<T>;

  assume(symbol: Expression<T>, domain: Domain): AssumeResult;
  assume(predicate: Expression<T>): AssumeResult;
  assume(arg1: Expression<T>, arg2?: Domain): AssumeResult;

  forget(symbol?: string | string[]): void;

  match(expr: Expression<T>, pattern: Expression<T>): Substitution | null;

  // Convenience functions: using the same dictionary as the engine
  // use a LatexParser to parse/serialize to LaTeX.
  parse(s: string): Expression<T>;
  serialize(x: Expression<T>): string;

  cache<T>(entry: string, fn: null | (() => T)): T;

  domain(expr: Expression<T>): Expression<T> | null;

  getVars(expr: Expression<T>): Set<string>;

  chop(n: Numeric): Numeric;

  isSubsetOf(lhs: Domain | null, rhs: Domain | null): boolean | undefined;

  // Predicate: use assumptions, if available to answer
  isZero(x: Expression<T>): boolean | undefined;
  isNotZero(x: Expression<T>): boolean | undefined;
  isNumeric(x: Expression<T>): boolean | undefined;
  isInfinity(x: Expression<T>): boolean | undefined;
  // Not +- Infinity, not NaN
  isFinite(x: Expression<T>): boolean | undefined;
  // x >= 0
  isNonNegative(x: Expression<T>): boolean | undefined;
  // x > 0
  isPositive(x: Expression<T>): boolean | undefined;
  // x < 0
  isNegative(x: Expression<T>): boolean | undefined;
  // x <= 0
  isNonPositive(x: Expression<T>): boolean | undefined;
  isInteger(x: Expression<T>): boolean | undefined;
  isRational(x: Expression<T>): boolean | undefined;
  isAlgebraic(x: Expression<T>): boolean | undefined;
  isReal(x: Expression<T>): boolean | undefined;
  // Real or +-Infinity
  isExtendedReal(x: Expression<T>): boolean | undefined;
  isComplex(x: Expression<T>): boolean | undefined;
  isOne(x: Expression<T>): boolean | undefined;
  isNegativeOne(x: Expression<T>): boolean | undefined;
  isElement(x: Expression<T>, set: Expression<T>): boolean | undefined;

  isEqual(lhs: Expression<T>, rhs: Expression<T>): boolean | undefined;
  isLess(lhs: Expression<T>, rhs: Expression<T>): boolean | undefined;
  isLessEqual(lhs: Expression<T>, rhs: Expression<T>): boolean | undefined;
  isGreater(lhs: Expression<T>, rhs: Expression<T>): boolean | undefined;
  isGreaterEqual(lhs: Expression<T>, rhs: Expression<T>): boolean | undefined;
}

/**
 * A given mathematical expression can be represented in multiple equivalent
 * ways as a MathJSON expression.
 *
 * Learn more about [Canonical Forms](https://cortexjs.io/compute-engine/guides/forms/).
 */
export type Form =
  | 'canonical'
  | 'canonical-add'
  | 'canonical-boolean'
  | 'canonical-constants'
  | 'canonical-divide'
  | 'canonical-domain'
  | 'canonical-exp'
  | 'canonical-list'
  | 'canonical-multiply'
  | 'canonical-power'
  | 'canonical-negate'
  | 'canonical-number'
  | 'canonical-rational'
  | 'canonical-root'
  | 'canonical-set'
  | 'canonical-subtract'
  | 'canonical-domain'
  | 'flatten'
  | 'json'
  | 'object-literal'
  | 'sorted'
  | 'stripped-metadata'
  | 'sum-product';
