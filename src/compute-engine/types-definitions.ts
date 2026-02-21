import type { OneOf } from '../common/one-of';
import type { Type, TypeString } from '../common/type/types';
import type { BoxedType } from '../common/type/boxed-type';
import type { LatexString, LatexDictionaryEntry } from './latex-syntax/types';
import type {
  Expression,
  ExpressionInput,
  CompiledExpression,
} from './types-expression';
import type {
  EvaluateOptions as KernelEvaluateOptions,
  Rule as KernelRule,
  BoxedRule as KernelBoxedRule,
  BoxedRuleSet as KernelBoxedRuleSet,
  Scope as KernelScope,
} from './types-kernel-evaluation';

/**
 * Compute engine surface used by definition callbacks.
 *
 * This interface is augmented by `types-engine.ts` with the concrete
 * `IComputeEngine` members to avoid type-layer circular dependencies.
 *
 * @category Compute Engine
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ComputeEngine {}

type EvaluateOptions = KernelEvaluateOptions;
type Rule = KernelRule<Expression, ExpressionInput, ComputeEngine>;
type BoxedRule = KernelBoxedRule<Expression, ComputeEngine>;
type BoxedRuleSet = KernelBoxedRuleSet<Expression, ComputeEngine>;
type Scope = KernelScope<BoxedDefinition>;

/**
 * A bound symbol (i.e. one with an associated definition) has either a type
 * (e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... type = 'real').
 *
 * @category Definitions
 */
export type ValueDefinition = BaseDefinition & {
  holdUntil: 'never' | 'evaluate' | 'N';

  type: Type | TypeString | BoxedType;

  /** If true, the type is inferred, and could be adjusted later
   * as more information becomes available or if the symbol is explicitly
   * declared.
   */
  inferred: boolean;

  /** `value` can be a JS function since for some constants, such as
   * `Pi`, the actual value depends on the `precision` setting of the
   * `ComputeEngine` and possible other environment settings */
  value:
    | LatexString
    | ExpressionInput
    | ((ce: ComputeEngine) => Expression | null);

  eq: (a: Expression) => boolean | undefined;
  neq: (a: Expression) => boolean | undefined;
  cmp: (a: Expression) => '=' | '>' | '<' | undefined;

  collection: CollectionHandlers;

  /**
   * Custom evaluation handler for subscripted expressions of this symbol.
   * Called when evaluating `Subscript(symbol, index)`.
   *
   * @param subscript - The subscript expression (already evaluated)
   * @param options - Contains the compute engine and evaluation options
   * @returns The evaluated result, or `undefined` to fall back to symbolic form
   */
  subscriptEvaluate?: (
    subscript: Expression,
    options: { engine: ComputeEngine; numericApproximation?: boolean }
  ) => Expression | undefined;
};

/**
 * Definition for a sequence declared with `ce.declareSequence()`.
 *
 * A sequence is defined by base cases and a recurrence relation.
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
 *
 * @category Definitions
 */
export interface SequenceDefinition {
  /**
   * Index variable name for single-index sequences, default 'n'.
   * For multi-index sequences, use `variables` instead.
   */
  variable?: string;

  /**
   * Index variable names for multi-index sequences.
   * Example: `['n', 'k']` for Pascal's triangle `P\_{n,k}`
   *
   * If provided, this takes precedence over `variable`.
   */
  variables?: string[];

  /**
   * Base cases as index → value mapping.
   *
   * For single-index sequences, use numeric keys:
   * ```typescript
   * base: { 0: 0, 1: 1 }  // F_0 = 0, F_1 = 1
   * ```
   *
   * For multi-index sequences, use comma-separated string keys:
   * ```typescript
   * base: {
   *   '0,0': 1,    // Exact: P_{0,0} = 1
   *   'n,0': 1,    // Pattern: P_{n,0} = 1 for all n
   *   'n,n': 1,    // Pattern: P_{n,n} = 1 (diagonal)
   * }
   * ```
   *
   * Pattern keys use variable names to match any value. When the same
   * variable appears multiple times (e.g., 'n,n'), the indices must be equal.
   */
  base: Record<number | string, number | Expression>;

  /** Recurrence relation as LaTeX string or Expression */
  recurrence: string | Expression;

  /** Whether to memoize computed values (default: true) */
  memoize?: boolean;

  /**
   * Valid index domain constraints.
   *
   * For single-index sequences:
   * ```typescript
   * domain: { min: 0, max: 100 }
   * ```
   *
   * For multi-index sequences, use per-variable constraints:
   * ```typescript
   * domain: { n: { min: 0 }, k: { min: 0 } }
   * ```
   */
  domain?:
    | { min?: number; max?: number }
    | Record<string, { min?: number; max?: number }>;

  /**
   * Constraint expression for multi-index sequences.
   * The expression should evaluate to a boolean/numeric value.
   * If it evaluates to false or 0, the subscript is considered out of domain.
   *
   * Example: `'k <= n'` for Pascal's triangle (only valid when k ≤ n)
   */
  constraints?: string | Expression;
}

/**
 * Status of a sequence definition.
 * @category Definitions
 */
export interface SequenceStatus {
  /**
   * Status of the sequence:
   * - 'complete': Both base case(s) and recurrence defined
   * - 'pending': Waiting for base case(s) or recurrence
   * - 'not-a-sequence': Symbol is not a sequence
   */
  status: 'complete' | 'pending' | 'not-a-sequence';

  /** Whether at least one base case is defined */
  hasBase: boolean;

  /** Whether a recurrence relation is defined */
  hasRecurrence: boolean;

  /**
   * Keys of defined base cases.
   * For single-index: numeric indices (e.g., [0, 1])
   * For multi-index: string keys including patterns (e.g., ['0,0', 'n,0', 'n,n'])
   */
  baseIndices: (number | string)[];

  /** Index variable name if recurrence is defined (single-index) */
  variable?: string;

  /** Index variable names if recurrence is defined (multi-index) */
  variables?: string[];
}

/**
 * Information about a defined sequence for introspection.
 * @category Definitions
 */
export interface SequenceInfo {
  /** The sequence name */
  name: string;

  /** Index variable name for single-index sequences (e.g., `"n"`) */
  variable?: string;

  /** Index variable names for multi-index sequences (e.g., `["n", "k"]`) */
  variables?: string[];

  /**
   * Base case keys.
   * For single-index: numeric indices
   * For multi-index: string keys including patterns
   */
  baseIndices: (number | string)[];

  /** Whether memoization is enabled */
  memoize: boolean;

  /**
   * Domain constraints.
   * For single-index: `{ min?, max? }`
   * For multi-index: per-variable constraints
   */
  domain:
    | { min?: number; max?: number }
    | Record<string, { min?: number; max?: number }>;

  /** Number of cached values */
  cacheSize: number;

  /** Whether this is a multi-index sequence */
  isMultiIndex: boolean;
}

/**
 * Result from an OEIS lookup operation.
 * @category OEIS
 */
export interface OEISSequenceInfo {
  /** OEIS sequence ID (e.g., 'A000045') */
  id: string;

  /** Sequence name/description */
  name: string;

  /** First several terms of the sequence */
  terms: number[];

  /** Formula or recurrence (if available) */
  formula?: string;

  /** Comments about the sequence */
  comments?: string[];

  /** URL to the OEIS page */
  url: string;
}

/**
 * Options for OEIS operations.
 * @category OEIS
 */
export interface OEISOptions {
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;

  /** Maximum number of results to return for lookups (default: 5) */
  maxResults?: number;
}

/**
 * Definition record for a function.
 * @category Definitions
 *
 */
export type OperatorDefinition = Partial<BaseDefinition> &
  Partial<OperatorDefinitionFlags> & {
    /**
     * The function signature, describing the type of the arguments and the
     * return type.
     *
     * If a `type` handler is provided, the return type of the function should
     * be a subtype of the return type in the signature.
     *
     */
    signature?: Type | TypeString | BoxedType;

    /**
     * The type of the result (return type) based on the type of
     * the arguments.
     *
     * Should be a subtype of the type indicated by the signature.
     *
     * For example, if the signature is `(number) -> real`, the type of the
     * result could be `real` or `integer`, but not `complex`.
     *
     * :::info[Note]
     * Do not evaluate the arguments.
     *
     * However, the type of the arguments can be used to determine the type of
     * the result.
     * :::
     *
     */
    type?: (
      ops: ReadonlyArray<Expression>,
      options: { engine: ComputeEngine }
    ) => Type | TypeString | BoxedType | undefined;

    /** Return the sign of the function expression.
     *
     * If the sign cannot be determined, return `undefined`.
     *
     * When determining the sign, only literal values and the values of
     * symbols, if they are literals, should be considered.
     *
     * Do not evaluate the arguments.
     *
     * However, the type and sign of the arguments can be used to determine the
     * sign.
     *
     */
    sgn?: (
      ops: ReadonlyArray<Expression>,
      options: { engine: ComputeEngine }
    ) => Sign | undefined;

    /** The value of this expression is > 0, same as `isGreater(0)`
     *
     * @category Numeric Expression
     */
    readonly isPositive?: boolean | undefined;

    /** The value of this expression is >= 0, same as `isGreaterEqual(0)`
     *
     * @category Numeric Expression
     */
    readonly isNonNegative?: boolean | undefined;

    /** The value of this expression is &lt; 0, same as `isLess(0)`
     *
     * @category Numeric Expression
     */
    readonly isNegative?: boolean | undefined;

    /** The  value of this expression is &lt;= 0, same as `isLessEqual(0)`
     *
     * @category Numeric Expression
     */
    readonly isNonPositive?: boolean | undefined;

    /** Return `true` if the function expression is even, `false` if it is odd
     * and `undefined` if it is neither (for example if it is not a number,
     * or if it is a complex number).
     */
    even?: (
      ops: ReadonlyArray<Expression>,
      options: { engine: ComputeEngine }
    ) => boolean | undefined;

    /**
     * A number used to order arguments.
     *
     * Argument with higher complexity are placed after arguments with
     * lower complexity when ordered canonically in commutative functions.
     *
     * - Additive functions: 1000-1999
     * - Multiplicative functions: 2000-2999
     * - Root and power functions: 3000-3999
     * - Log functions: 4000-4999
     * - Trigonometric functions: 5000-5999
     * - Hypertrigonometric functions: 6000-6999
     * - Special functions (factorial, Gamma, ...): 7000-7999
     * - Collections: 8000-8999
     * - Inert and styling:  9000-9999
     * - Logic: 10000-10999
     * - Relational: 11000-11999
     *
     * **Default**: 100,000
     */
    complexity?: number;

    /**
     * Return the canonical form of the expression with the arguments `args`.
     *
     * The arguments (`args`) may not be in canonical form. If necessary, they
     * can be put in canonical form.
     *
     * This handler should validate the type and number of the arguments
     * (arity).
     *
     * If a required argument is missing, it should be indicated with a
     * `["Error", "'missing"]` expression. If more arguments than expected
     * are present, this should be indicated with an
     * `["Error", "'unexpected-argument'"]` error expression
     *
     * If the type of an argument is not compatible, it should be indicated
     * with an `incompatible-type` error.
     *
     * `["Sequence"]` expressions are not folded and need to be handled
     *  explicitly.
     *
     * If the function is associative, idempotent or an involution,
     * this handler should account for it. Notably, if it is commutative, the
     * arguments should be sorted in canonical order.
     *
     *
     * Values of symbols should not be substituted, unless they have
     * a `holdUntil` attribute of `"never"`.
     *
     * The handler should not consider the value or any assumptions about any
     * of the arguments that are symbols or functions (i.e. `arg.isZero`,
     * `arg.isInteger`, etc...) since those may change over time.
     *
     * The result of the handler should be a canonical expression.
     *
     * If the arguments do not match, they should be replaced with an
     * appropriate `["Error"]` expression. If the expression cannot be put in
     * canonical form, the handler should return `null`.
     *
     */
    canonical?: (
      ops: ReadonlyArray<Expression>,
      options: { engine: ComputeEngine; scope: Scope | undefined }
    ) => Expression | null;

    /**
     * Evaluate a function expression.
     *
     * When the handler is invoked, the arguments have been evaluated, except
     * if the `lazy` option is set to `true`.
     *
     * It is not necessary to further simplify or evaluate the arguments.
     *
     * If performing numerical calculations and `options.numericalApproximation`
     * is `false` return an exact numeric value, for example return a rational
     * number or a square root, rather than a floating point approximation.
     * Use `ce.number()` to create the numeric value.
     *
     * If the expression cannot be evaluated, due to the values, types, or
     * assumptions about its arguments, return `undefined` or
     * an `["Error"]` expression.
     */
    evaluate?:
      | ((
          ops: ReadonlyArray<Expression>,
          options: EvaluateOptions & { engine: ComputeEngine }
        ) => Expression | undefined)
      | Expression;

    /**
     * An asynchronous version of `evaluate`.
     *
     */
    evaluateAsync?: (
      ops: ReadonlyArray<Expression>,
      options: EvaluateOptions & { engine: ComputeEngine }
    ) => Promise<Expression | undefined>;

    /** Dimensional analysis
     * @experimental
     */
    evalDimension?: (
      args: ReadonlyArray<Expression>,
      options: EvaluateOptions & { engine: ComputeEngine }
    ) => Expression;

    /** Return a compiled (optimized) expression. */
    xcompile?: (expr: Expression) => CompiledExpression;

    eq?: (a: Expression, b: Expression) => boolean | undefined;
    neq?: (a: Expression, b: Expression) => boolean | undefined;

    collection?: CollectionHandlers;
  };

/**
 * Metadata common to both symbols and functions.
 *
 * @category Definitions
 *
 */
export interface BaseDefinition {
  /**
   * If a string, a short description, about one line long.
   *
   * Otherwise, a list of strings, each string a paragraph.
   *
   * May contain Markdown.
   */
  description: string | string[];

  /** A list of examples of how to use this symbol or operator.
   *
   * Each example is a string, which can be a MathJSON expression or LaTeX, bracketed by `$` signs.
   * For example, `["Add", 1, 2]` or `$\\sin(\\pi/4)$`.
   */
  examples: string | string[];

  /** A URL pointing to more information about this symbol or operator. */
  url: string;

  /**
   * A short string representing an entry in a wikibase.
   *
   * For example `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   * for the `Pi` constant.
   */
  wikidata: string;

  /** If true, the value or type of the definition cannot be changed */
  readonly isConstant?: boolean;
}

/** Options for `Expression.simplify()`
 *
 * @category Boxed Expression
 */
export type SimplifyOptions = {
  /**
   * The set of rules to apply. If `null`, use no rules. If not provided,
   * use the default simplification rules.
   */
  rules?: null | Rule | ReadonlyArray<BoxedRule | Rule> | BoxedRuleSet;

  /**
   * Use this cost function to determine if a simplification is worth it.
   *
   * If not provided, `ce.costFunction`, the cost function of the engine is
   * used.
   */
  costFunction?: (expr: Expression) => number;

  /**
   * The simplification strategy to use.
   *
   * - `'default'`: Use standard simplification rules (default)
   * - `'fu'`: Use the Fu algorithm for trigonometric simplification.
   *   This is more aggressive for trig expressions and may produce
   *   different results than the default strategy.
   *
   *   **Note:** When using the `'fu'` strategy, the `costFunction` and `rules`
   *   options are ignored. The Fu algorithm uses its own specialized cost
   *   function that prioritizes minimizing the number of trigonometric
   *   functions. Standard simplification is applied before and after the
   *   Fu transformations using the engine's default rules.
   */
  strategy?: 'default' | 'fu';
};

/**
 * A table mapping symbols to their definition.
 *
 * Symbols should be valid MathJSON symbols. In addition, the
 * following rules are recommended:
 *
 * - Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
 * - The first character should be a letter: `/^[a-zA-Z]/`
 * - Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`
 *
 * @category Definitions
 *
 */

export type SymbolDefinition = OneOf<[ValueDefinition, OperatorDefinition]>;

/**
 * @category Definitions
 *
 */
export type SymbolDefinitions = Readonly<{
  [id: string]: Partial<SymbolDefinition>;
}>;

/**
 * A library bundles symbol/operator definitions with their LaTeX dictionary
 * entries and declares dependencies on other libraries.
 *
 * Use with the `libraries` constructor option to load standard or custom
 * libraries:
 *
 * ```ts
 * const ce = new ComputeEngine({
 *   libraries: ['core', 'arithmetic', {
 *     name: 'custom',
 *     requires: ['arithmetic'],
 *     definitions: { G: { value: 6.674e-11, type: 'real', isConstant: true } },
 *   }],
 * });
 * ```
 *
 * @category Definitions
 */
export interface LibraryDefinition {
  /** Library identifier */
  name: string;
  /** Libraries that must be loaded before this one */
  requires?: string[];
  /** Symbol and operator definitions */
  definitions?: SymbolDefinitions | SymbolDefinitions[];
  /** LaTeX dictionary entries for parsing/serialization */
  latexDictionary?: Readonly<Partial<LatexDictionaryEntry>[]>;
}

/**
 * When a unitless value is passed to or returned from a trigonometric function,
 * the angular unit of the value.
 *
 * | Angular Unit | Description |
 * |:--------------|:-------------|
 * | `rad` | radians, 2π radians is a full circle |
 * | `deg` | degrees, 360 degrees is a full circle |
 * | `grad` | gradians, 400 gradians is a full circle |
 * | `turn` | turns, 1 turn is a full circle |
 *
 * To change the angular unit used by the Compute Engine, use:
 *
 * ```js
 * ce.angularUnit = 'deg';
 * ```
 *
 * @category Compute Engine
 */
export type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';

/** @category Numerics */
export type Sign =
  /** The expression is equal to 0 */
  | 'zero'

  /** The expression is > 0 */
  | 'positive'

  /** The expression is < 0 */
  | 'negative'

  /** The expression is >= 0 and isPositive is either false or undefined*/
  | 'non-negative'

  /** The expression is <= 0 and isNegative is either false or undefined*/
  | 'non-positive'

  /** The expression is not equal to 0 (possibly with an imaginary part) and isPositive, isNegative, isUnsigned are all false or undefined */
  | 'not-zero'

  /** The expression has an imaginary part or is NaN */
  | 'unsigned';

/**
 * These handlers are the primitive operations that can be performed on
 * all collections, indexed or not.
 *
 *  @category Definitions
 */
export interface BaseCollectionHandlers {
  /**
   * Return an iterator that iterates over the elements of the collection.
   *
   * The order in which the elements are returned is not defined. Requesting
   * two iterators on the same collection may return the elements in a
   * different order.
   *
   * @category Definitions
   */
  iterator: (
    collection: Expression
  ) => Iterator<Expression, undefined> | undefined;

  /** Return the number of elements in the collection.
   *
   * An empty collection has a count of 0.
   */
  count: (collection: Expression) => number | undefined;

  /** Optional flag to quickly check if the collection is empty, without having to count exactly how may elements it has (useful for lazy evaluation). */
  isEmpty?: (collection: Expression) => boolean | undefined;

  /** Optional flag to quickly check if the collection is finite, without having to count exactly how many elements it has (useful for lazy evaluation). */
  isFinite?: (collection: Expression) => boolean | undefined;

  /** Return `true` if the collection is lazy, `false` otherwise.
   * If the collection is lazy, it means that the elements are not
   * computed until they are needed, for example when iterating over the
   * collection.
   *
   * Default: `true`
   */
  isLazy?: (collection: Expression) => boolean;

  /**
   * Return `true` if the target expression is in the collection,
   * `false` otherwise.
   *
   * Return `undefined` if the membership cannot be determined.
   */
  contains?: (
    collection: Expression,
    target: Expression
  ) => boolean | undefined;

  /**
   * Return `true` if all the elements of `other` are in `collection`.
   * Both `collection` and `other` are collections.
   *
   * If strict is `true`, the subset must be strict, that is, `collection` must
   * have more elements than `other`.
   *
   * Return `undefined` if the subset relation cannot be determined.
   */
  subsetOf?: (
    collection: Expression,
    other: Expression,
    strict: boolean
  ) => boolean | undefined;

  /** Return the sign of all the elements of the collection. */
  eltsgn?: (collection: Expression) => Sign | undefined;

  /** Return the widest type of all the elements in the collection */
  elttype?: (collection: Expression) => Type | undefined;
}

/**
 * These additional collection handlers are applicable to indexed
 * collections only.
 *
 * The elements of an indexed collection can be accessed by index, and
 * the order of the elements is defined.
 *
 *  @category Definitions
 */
export interface IndexedCollectionHandlers {
  /**
   * Return the element at the specified index.
   *
   * The first element is `at(1)`, the last element is `at(-1)`.
   *
   * If the index is &lt;0, return the element at index `count() + index + 1`.
   *
   * The index can also be a string for example for records. The set of valid
   * keys is returned by the `keys()` handler.
   *
   * If the index is invalid, return `undefined`.
   */
  at: (
    collection: Expression,
    index: number | string
  ) => undefined | Expression;

  /**
   * Return the index of the first element that matches the predicate.
   *
   * If no element matches the predicate, return `undefined`.
   */
  indexWhere: (
    collection: Expression,
    predicate: (element: Expression) => boolean
  ) => number | undefined;
}

/**
 * The collection handlers are the primitive operations that can be
 * performed on collections, such as lists, sets, tuples, etc...
 *
 *  @category Definitions
 */
export type CollectionHandlers = BaseCollectionHandlers &
  Partial<IndexedCollectionHandlers>;

/**
 *
 * The definition for a value, represented as a tagged object literal.
 * @category Definitions
 *
 */
export type TaggedValueDefinition = {
  value: BoxedValueDefinition;
};

/**
 *
 * The definition for an operator, represented as a tagged object literal.
 *
 * @category Definitions
 *
 */
export type TaggedOperatorDefinition = {
  operator: BoxedOperatorDefinition;
};

/**
 * A definition can be either a value or an operator.
 *
 * It is collected in a tagged object literal, instead of being a simple union
 * type, so that the type of the definition can be changed while keeping
 * references to the definition in bound expressions.
 *
 * @category Definitions
 *
 */
export type BoxedDefinition = TaggedValueDefinition | TaggedOperatorDefinition;

/**
 * @category Definitions
 *
 */
export interface BoxedBaseDefinition extends Partial<BaseDefinition> {
  /** If this is the definition of a collection, the set of primitive operations
   * that can be performed on this collection (counting the number of elements,
   * enumerating it, etc...).
   */
  collection?: CollectionHandlers;
}

/**
 *
 * @category Definitions
 */
export interface BoxedValueDefinition extends BoxedBaseDefinition {
  /**
    * If the symbol has a value, it is held as indicated in the table below.
    * A green checkmark indicate that the symbol is substituted.

  <div className="symbols-table">

  | Operation     | `"never"` | `"evaluate"` | `"N"` |
  | :---          | :-----:   | :----:      | :---:  |
  | `canonical()` |    (X)    |              |       |
  | `evaluate()`  |    (X)    |     (X)      |       |
  | `"N()"`       |    (X)    |     (X)      |  (X)  |

  </div>

    * Some examples:
    * - `ImaginaryUnit` has `holdUntil: 'never'`: it is substituted during canonicalization
    * - `x` has `holdUntil: 'evaluate'` (variables)
    * - `Pi` has `holdUntil: 'N'` (special numeric constant)
    *
    * **Default:** `evaluate`
    */
  holdUntil: 'never' | 'evaluate' | 'N';

  /** The current value of the symbol. For constants, this is immutable.
   *  The definition object is the single source of truth — there is no
   *  separate evaluation-context values map.
   */
  value: Expression | undefined;

  eq?: (a: Expression) => boolean | undefined;
  neq?: (a: Expression) => boolean | undefined;
  cmp?: (a: Expression) => '=' | '>' | '<' | undefined;

  /**
   * True if the type has been inferred. An inferred type can be updated as
   * more information becomes available.
   *
   * A type that is not inferred, but has been set explicitly, cannot be updated.
   */
  inferredType: boolean;

  type: BoxedType;

  /**
   * Custom evaluation handler for subscripted expressions of this symbol.
   * Called when evaluating `Subscript(symbol, index)`.
   */
  subscriptEvaluate?: (
    subscript: Expression,
    options: { engine: ComputeEngine; numericApproximation?: boolean }
  ) => Expression | undefined;
}

/**
 * An operator definition can have some flags to indicate specific
 * properties of the operator.
 * @category Definitions
 */
export type OperatorDefinitionFlags = {
  /**
   * If `true`, the arguments to this operator are not automatically
   * evaluated. The default is `false` (the arguments are evaluated).
   *
   * This can be useful for example for operators that take symbolic
   * expressions as arguments, such as `Declare` or `Integrate`.
   *
   * This is also useful for operators that take an argument that is
   * potentially an infinite collection.
   *
   * It will be up to the `evaluate()` handler to evaluate the arguments as
   * needed. This is convenient to pass symbolic expressions as arguments
   * to operators without having to explicitly use a `Hold` expression.
   *
   * This also applies to the `canonical()` handler.
   *
   */
  lazy: boolean;

  /**
   * If `true`, the operator requires a new lexical scope when canonicalized.
   * This will allow it to declare variables that are not visible outside
   * the function expression using the operator.
   *
   * **Default**: `false`
   */
  scoped: boolean;

  /**  If `true`, the operator is applied element by element to lists, matrices
   * (`["List"]` or `["Tuple"]` expressions) and equations (relational
   * operators).
   *
   * **Default**: `false`
   */
  broadcastable: boolean;

  /** If `true`, `["f", ["f", a], b]` simplifies to `["f", a, b]`
   *
   * **Default**: `false`
   */
  associative: boolean;

  /** If `true`, `["f", a, b]` equals `["f", b, a]`. The canonical
   * version of the function will order the arguments.
   *
   * **Default**: `false`
   */
  commutative: boolean;

  /**
   * If `commutative` is `true`, the order of the arguments is determined by
   * this function.
   *
   * If the function is not provided, the arguments are ordered by the
   * default order of the arguments.
   *
   */
  commutativeOrder: ((a: Expression, b: Expression) => number) | undefined;

  /** If `true`, when the operator is univariate, `["f", ["Multiply", x, c]]`
   * simplifies to `["Multiply", ["f", x], c]` where `c` is constant
   *
   * When the operator is multivariate, multiplicativity is considered only on
   * the first argument: `["f", ["Multiply", x, y], z]` simplifies to
   * `["Multiply", ["f", x, z], ["f", y, z]]`
   *
   * Default: `false`
   */

  /** If `true`, `["f", ["f", x]]` simplifies to `["f", x]`.
   *
   * **Default**: `false`
   */
  idempotent: boolean;

  /** If `true`, `["f", ["f", x]]` simplifies to `x`.
   *
   * **Default**: `false`
   */
  involution: boolean;

  /** If `true`, the value of this operator is always the same for a given
   * set of arguments and it has no side effects.
   *
   * An expression using this operator is pure if the operator and all its
   * arguments are pure.
   *
   * For example `Sin` is pure, `Random` isn't.
   *
   * This information may be used to cache the value of expressions.
   *
   * **Default:** `true`
   */
  pure: boolean;
};

/**
 *
 * The definition includes information specific about an operator, such as
 * handlers to canonicalize or evaluate a function expression with this
 * operator.
 *
 * @category Definitions
 *
 */
export interface BoxedOperatorDefinition
  extends BoxedBaseDefinition, OperatorDefinitionFlags {
  complexity: number;

  /** If true, the signature was inferred from usage and may be modified
   * as more information becomes available.
   */
  inferredSignature: boolean;

  /** The type of the arguments and return value of this function */
  signature: BoxedType;

  /** If present, this handler can be used to more precisely determine the
   * return type based on the type of the arguments. The arguments themselves
   * should *not* be evaluated, only their types should be used.
   */
  type?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Type | TypeString | BoxedType | undefined;

  /** If present, this handler can be used to determine the sign of the
   *  return value of the function, based on the sign and type of its
   *  arguments.
   *
   * The arguments themselves should *not* be evaluated, only their types and
   * sign should be used.
   *
   * This can be used in some case for example to determine when certain
   * simplifications are valid.
   */
  sgn?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Sign | undefined;

  eq?: (a: Expression, b: Expression) => boolean | undefined;
  neq?: (a: Expression, b: Expression) => boolean | undefined;

  canonical?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine; scope: Scope | undefined }
  ) => Expression | null;

  evaluate?: (
    ops: ReadonlyArray<Expression>,
    options: Partial<EvaluateOptions> & { engine?: ComputeEngine }
  ) => Expression | undefined;

  evaluateAsync?: (
    ops: ReadonlyArray<Expression>,
    options?: Partial<EvaluateOptions> & { engine?: ComputeEngine }
  ) => Promise<Expression | undefined>;

  evalDimension?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Expression;

  compile?: (expr: Expression) => CompiledExpression;

  /** @internal */
  update(def: OperatorDefinition): void;
}
