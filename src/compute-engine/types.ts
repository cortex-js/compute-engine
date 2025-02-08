import { Complex } from 'complex-esm';

import { OneOf } from '../common/one-of';

import {
  BoxedExpression,
  FunctionDefinition,
  SemiBoxedExpression,
  SymbolDefinition,
} from './boxed-expression/public';

import {
  LatexDictionaryEntry,
  LatexString,
  ParseLatexOptions,
} from './latex-syntax/public';
import { IndexedLatexDictionary } from './latex-syntax/dictionary/definitions';

import { BigNum, IBigNum } from './numerics/bignum';
import { Rational } from './numerics/rationals';

import {
  ExactNumericValueData,
  NumericValue,
  NumericValueData,
} from './numeric-value/public';

import { Type, TypeString } from '../common/type/types';
import { BoxedType } from '../common/type/boxed-type';
import { MathJsonNumber } from '../math-json/types';

/** @category Compiling */
export type CompiledType = boolean | number | string | object;

/** @category Compiling */
export type CompiledExpression = {
  evaluate?: (scope: {
    [symbol: string]: BoxedExpression;
  }) => number | BoxedExpression;
};

/**
 * A table mapping identifiers to their definition.
 *
 * Identifiers should be valid MathJSON identifiers. In addition, the
 * following rules are recommended:
 *
 * - Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
 * - The first character should be a letter: `/^[a-zA-Z]/`
 * - Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`
 *
 * @category Definitions
 *
 */

export type IdentifierDefinition = OneOf<
  [SymbolDefinition, FunctionDefinition, SemiBoxedExpression]
>;

/**
 * @category Definitions
 *
 */
export type IdentifierDefinitions = Readonly<{
  [id: string]: IdentifierDefinition;
}>;

/** @internal */
export interface ComputeEngineStats {
  symbols: Set<BoxedExpression>;
  expressions: null | Set<BoxedExpression>;
  highwaterMark: number;
}

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

  /** The expression has no imaginary part and a non-zero real part and isPositive and isNegative are false or undefined*/
  | 'real-not-zero'

  /** The expression has no imaginary part and isNotZero,isPositive,isNegative,isNonNegative,isNonPositive,isZero are either false or undefined*/
  | 'real'

  /** The expression is NaN */
  | 'nan'

  /** The expression is +∞ */
  | 'positive-infinity'

  /** The expression is -∞ */
  | 'negative-infinity'

  /** The expression is ~∞ */
  | 'complex-infinity'

  /** The expression has an imaginary part or is NaN */
  | 'unsigned';

/**
 * When used in a `SymbolDefinition` or `Functiondefinition` these flags
 * provide additional information about the value of the symbol or function.
 *
 * If provided, they will override the value derived from
 * the symbol's value.
 *
 * @category Definitions
 */
export type NumericFlags = {
  sgn: Sign | undefined;

  even: boolean | undefined;
  odd: boolean | undefined;
};

/**
 * These handlers are the primitive operations that can be performed on
 * collections.
 *
 * There are two types of collections:
 *
 * - finite collections, such as lists, tuples, sets, matrices, etc...
 *  The `size()` handler of finite collections returns the number of elements
 *
 * - infinite collections, such as sequences, ranges, etc...
 *  The `size()` handler of infinite collections returns `Infinity`
 *  Infinite collections are not indexable: they have no `at()` handler.
 *
 *  @category Definitions
 */
export type CollectionHandlers = {
  /** Return the number of elements in the collection.
   *
   * An empty collection has a size of 0.
   */
  size: (collection: BoxedExpression) => number;

  /**
   * Return `true` if the target
   * expression is in the collection, `false` otherwise.
   */
  contains: (collection: BoxedExpression, target: BoxedExpression) => boolean;

  /** Return an iterator
   * - start is optional and is a 1-based index.
   * - if start is not specified, start from index 1
   * - count is optional and is the number of elements to return
   * - if count is not specified or negative, return all the elements from
   *   start to the end
   *
   * If there is a `keys()` handler, there is no `iterator()` handler.
   *
   * @category Definitions
   */
  iterator: (
    collection: BoxedExpression,
    start?: number,
    count?: number
  ) => Iterator<BoxedExpression, undefined>;

  /**
   * Return the element at the specified index.
   *
   * The first element is `at(1)`, the last element is `at(-1)`.
   *
   * If the index is &lt;0, return the element at index `size() + index + 1`.
   *
   * The index can also be a string for example for maps. The set of valid keys
   * is returned by the `keys()` handler.
   *
   * If the index is invalid, return `undefined`.
   */
  at: (
    collection: BoxedExpression,
    index: number | string
  ) => undefined | BoxedExpression;

  /**
   * If the collection can be indexed by strings, return the valid values
   * for the index.
   */
  keys: (collection: BoxedExpression) => undefined | Iterable<string>;

  /**
   * Return the index of the first element that matches the target expression.
   *
   * The comparison is done using the `target.isEqual()` method.
   *
   * If the expression is not found, return `undefined`.
   *
   * If the expression is found, return the index, 1-based.
   *
   * Return the index of the first match.
   *
   * `from` is the starting index for the search. If negative, start from
   * the end  and search backwards.
   */
  indexOf: (
    collection: BoxedExpression,
    target: BoxedExpression,
    from?: number
  ) => number | undefined;

  /**
   * Return `true` if all the elements of `target` are in `expr`.
   * Both `expr` and `target` are collections.
   * If strict is `true`, the subset must be strict, that is, `expr` must
   * have more elements than `target`.
   */
  subsetOf: (
    collection: BoxedExpression,
    target: BoxedExpression,
    strict: boolean
  ) => boolean;

  /** Return the sign of all the elements of the collection. */
  eltsgn: (collection: BoxedExpression) => Sign | undefined;

  /** Return the widest type of all the elements in the collection */
  elttype: (collection: BoxedExpression) => Type | undefined;
};

/**
 * @category Definitions
 *
 */
export interface BoxedBaseDefinition {
  name: string;
  wikidata?: string;
  description?: string | string[];
  url?: string;

  /**
   * The scope this definition belongs to.
   *
   * This field is usually undefined, but its value is set by `getDefinition()`
   */
  scope: RuntimeScope | undefined;

  /** If this is the definition of a collection, the set of primitive operations
   * that can be performed on this collection (counting the number of elements,
   * enumerating it, etc...). */
  collection?: Partial<CollectionHandlers>;

  /** When the environment changes, for example the numerical precision,
   * call `reset()` so that any cached values can be recalculated.
   */
  reset(): void;
}

/**
 * @category Definitions
 *
 */
export type SymbolAttributes = {
  /**
   * If `true` the value of the symbol is constant. The value or type of
   * symbols with this attribute set to `true` cannot be changed.
   *
   * If `false`, the symbol is a variable.
   *
   * **Default**: `false`
   */
  constant: boolean;

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
};

/**
 * @category Definitions
 */
export interface BoxedSymbolDefinition
  extends BoxedBaseDefinition,
    SymbolAttributes,
    Partial<NumericFlags> {
  get value(): BoxedExpression | undefined;
  set value(val: BoxedExpression | number | undefined);

  readonly isFunction: boolean;
  readonly isConstant: boolean;

  eq?: (a: BoxedExpression) => boolean | undefined;
  neq?: (a: BoxedExpression) => boolean | undefined;
  cmp?: (a: BoxedExpression) => '=' | '>' | '<' | undefined;

  // True if the type has been inferred: while a type is inferred,
  // it can be updated as more information becomes available.
  // A type that is not inferred, but has been set explicitly,
  // cannot be updated.
  inferredType: boolean;

  type: BoxedType;
}

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
 * @category Compute Engine
 */
export type Scope = {};

/** Options for `BoxedExpression.evaluate()`
 *
 * @category Boxed Expression
 */
export type EvaluateOptions = {
  numericApproximation: boolean; // Default to false
  signal: AbortSignal;
};

/**
 * A function definition can have some flags to indicate specific
 * properties of the function.
 * @category Definitions
 */
export type FunctionDefinitionFlags = {
  /**
   * If `true`, the arguments to this function are not automatically
   * evaluated. The default is `false` (the arguments are evaluated).
   *
   * This can be useful for example for functions that take symbolic
   * expressions as arguments, such as `D` or `Integrate`.
   *
   * This is also useful for functions that take an argument that is
   * potentially an infinite collection.
   *
   * It will be up to the `evaluate()` handler to evaluate the arguments as
   * needed. This is conveninent to pass symbolic expressions as arguments
   * to functions without having to explicitly use a `Hold` expression.
   *
   * This also applies to the `canonical()` handler.
   *
   */
  lazy: boolean;

  /**  If `true`, the function is applied element by element to lists, matrices
   * (`["List"]` or `["Tuple"]` expressions) and equations (relational
   * operators).
   *
   * **Default**: `false`
   */
  threadable: boolean;

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
  commutativeOrder:
    | ((a: BoxedExpression, b: BoxedExpression) => number)
    | undefined;

  /** If `true`, when the function is univariate, `["f", ["Multiply", x, c]]`
   * simplifies to `["Multiply", ["f", x], c]` where `c` is constant
   *
   * When the function is multivariate, multiplicativity is considered only on
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

  /** If `true`, the value of this function is always the same for a given
   * set of arguments and it has no side effects.
   *
   * An expression using this function is pure if the function and all its
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
 * @category Definitions
 *
 */
export type BoxedFunctionDefinition = BoxedBaseDefinition &
  FunctionDefinitionFlags & {
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
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: IComputeEngine }
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
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: IComputeEngine }
    ) => Sign | undefined;

    eq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;
    neq?: (a: BoxedExpression, b: BoxedExpression) => boolean | undefined;

    canonical?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: IComputeEngine }
    ) => BoxedExpression | null;

    evaluate?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: Partial<EvaluateOptions> & { engine?: IComputeEngine }
    ) => BoxedExpression | undefined;

    evaluateAsync?: (
      ops: ReadonlyArray<BoxedExpression>,
      options?: Partial<EvaluateOptions> & { engine?: IComputeEngine }
    ) => Promise<BoxedExpression | undefined>;

    evalDimension?: (
      ops: ReadonlyArray<BoxedExpression>,
      options: { engine: IComputeEngine }
    ) => BoxedExpression;

    compile?: (expr: BoxedExpression) => CompiledExpression;
  };

/**
 * The entries have been validated and optimized for faster evaluation.
 *
 * When a new scope is created with `pushScope()` or when creating a new
 * engine instance, new instances of this type are created as needed.
 *
 * @category Definitions
 */
export type RuntimeIdentifierDefinitions = Map<
  string,
  OneOf<[BoxedSymbolDefinition, BoxedFunctionDefinition]>
>;

/** @category Assumptions */
export interface ExpressionMapInterface<U> {
  has(expr: BoxedExpression): boolean;
  get(expr: BoxedExpression): U | undefined;
  set(expr: BoxedExpression, value: U): void;
  delete(expr: BoxedExpression): void;
  clear(): void;
  [Symbol.iterator](): IterableIterator<[BoxedExpression, U]>;
  entries(): IterableIterator<[BoxedExpression, U]>;
}

/** @category Assumptions */
export type AssumeResult =
  | 'internal-error'
  | 'not-a-predicate'
  | 'contradiction'
  | 'tautology'
  | 'ok';

/**
 * When a unitless value is passed to or returned from a trigonometric function,
 * the angular unit of the value.
 *
 * - `rad`: radians, 2π radians is a full circle
 * - `deg`: degrees, 360 degrees is a full circle
 * - `grad`: gradians, 400 gradians is a full circle
 * - `turn`: turns, 1 turn is a full circle
 *
 * @category Compute Engine
 */
export type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';

/** @category Compute Engine */
export type RuntimeScope = Scope & {
  parentScope?: RuntimeScope;

  ids?: RuntimeIdentifierDefinitions;

  assumptions: undefined | ExpressionMapInterface<boolean>;

  /** The location of the call site that created this scope */
  // origin?: {
  //   name?: string;
  //   line?: number;
  //   column?: number;
  // };

  /** Free memory should not go below this level for execution to proceed */
  // lowWaterMark?: number;
};

/**
 * When provided, canonical forms are used to put an expression in a
 * "standard" form.
 *
 * Each canonical form applies some transformation to an expression. When
 * specified as an array, each transformation is done in the order in which
 * it was provided.
 *
 * - `InvisibleOperator`: replace use of the `InvisibleOperator` with
 *    another operation, such as multiplication (i.e. `2x` or function
 *    application (`f(x)`).
 * - `Number`: replace all numeric values with their
 *    canonical representation, for example, reduce
 *    rationals and replace complex numbers with no imaginary part with a real number.
 * - `Multiply`: replace negation with multiplication by -1, remove 1 from multiplications, simplify signs (`-y \times -x` -> `x \times y`), complex numbers are promoted (['Multiply', 2, 'ImaginaryUnit'] -> `["Complex", 0, 2]`)
 * - `Add`: replace `Subtract` with `Add`, removes 0 in addition, promote complex numbers (["Add", "a", ["Complex", 0, "b"] -> `["Complex", "a", "b"]`)
 * - `Power`: simplify `Power` expression, for example, `x^{-1}` -> `\frac{1}{x}`, `x^0` -> `1`, `x^1` -> `x`, `1^x` -> `1`, `x^{\frac{1}{2}}` -> `\sqrt{x}`, `a^b^c` -> `a^{bc}`...
 * - `Divide`: replace with a `Rational` number if numerator and denominator are integers, simplify, e.g. `\frac{x}{1}` -> `x`...
 * - `Flatten`: remove any unnecessary `Delimiter` expression, and flatten any associative functions, for example `["Add", ["Add", "a", "b"], "c"]` -> `["Add", "a", "b", "c"]`
 * - `Order`: when applicable, sort the arguments in a specific order, for
 *    example for addition and multiplication.
 *
 *
 * @category Boxed Expression
 */
export type CanonicalForm =
  | 'InvisibleOperator'
  | 'Number'
  | 'Multiply'
  | 'Add'
  | 'Power'
  | 'Divide'
  | 'Flatten'
  | 'Order';

export type CanonicalOptions = boolean | CanonicalForm | CanonicalForm[];

/**
 * Metadata that can be associated with a `BoxedExpression`
 *
 * @category Boxed Expression
 */

export type Metadata = {
  latex?: string | undefined;
  wikidata?: string | undefined;
};

/**
 * A substitution describes the values of the wildcards in a pattern so that
 * the pattern is equal to a target expression.
 *
 * A substitution can also be considered a more constrained version of a
 * rule whose `match` is always a symbol.

* @category Boxed Expression
 */
export type Substitution<T = SemiBoxedExpression> = {
  [symbol: string]: T;
};

/**
 * @category Boxed Expression
 *
 */
export type BoxedSubstitution = Substitution<BoxedExpression>;

/**
 * Given an expression and set of wildcards, return a new expression.
 *
 * For example:
 *
 * ```ts
 * {
 *    match: '_x',
 *    replace: (expr, {_x}) => { return ['Add', 1, _x] }
 * }
 * ```
 *
 * @category Rules */
export type RuleReplaceFunction = (
  expr: BoxedExpression,
  wildcards: BoxedSubstitution
) => BoxedExpression | undefined;

/** @category Rules */
export type RuleConditionFunction = (
  wildcards: BoxedSubstitution,
  ce: IComputeEngine
) => boolean;

/** @category Rules */
export type RuleFunction = (
  expr: BoxedExpression
) => undefined | BoxedExpression | RuleStep;

/** @category Rules */
export type RuleStep = {
  value: BoxedExpression;
  because: string; // id of the rule
};

/** @category Rules */
export type RuleSteps = RuleStep[];

/**
 * A rule describes how to modify an expressions that matches a pattern `match`
 * into a new expression `replace`.
 *
 * - `x-1` \( \to \) `1-x`
 * - `(x+1)(x-1)` \( \to \) `x^2-1
 *
 * The patterns can be expressed as LaTeX strings or a MathJSON expressions.
 *
 * As a shortcut, a rule can be defined as a LaTeX string: `x-1 -> 1-x`.
 * The expression to the left of `->` is the `match` and the expression to the
 * right is the `replace`. When using LaTeX strings, single character variables
 * are assumed to be wildcards.
 *
 * When using MathJSON expressions, anonymous wildcards (`_`) will match any
 * expression. Named wildcards (`_x`, `_a`, etc...) will match any expression
 * and bind the expression to the wildcard name.
 *
 * In addition the sequence wildcard (`__1`, `__a`, etc...) will match
 * a sequence of one or more expressions, and bind the sequence to the
 * wildcard name.
 *
 * Sequence wildcards are useful when the number of elements in the sequence
 * is not known in advance. For example, in a sum, the number of terms is
 * not known in advance. ["Add", 0, `__a`] will match two or more terms and
 * the `__a` wildcard will be a sequence of the matchign terms.
 *
 * If `exact` is false, the rule will match variants.
 *
 * For example 'x' will match 'a + x', 'x' will match 'ax', etc...
 *
 * For simplification rules, you generally want `exact` to be true, but
 * to solve equations, you want it to be false. Default to true.
 *
 * When set to false, infinite recursion is possible.
 *
 * @category Rules
 */

export type Rule =
  | string
  | RuleFunction
  | {
      match?: LatexString | SemiBoxedExpression | BoxedExpression;
      replace:
        | LatexString
        | SemiBoxedExpression
        | RuleReplaceFunction
        | RuleFunction;
      condition?: LatexString | RuleConditionFunction;
      useVariations?: boolean; // Default to false
      id?: string; // Optional, for debugging or filtering
    };

/**
 *
 * If the `match` property is `undefined`, all expressions match this rule
 * and `condition` should also be `undefined`. The `replace` property should
 * be a `BoxedExpression` or a `RuleFunction`, and further filtering can be
 * done in the `replace` function.
 *
 * @category Rules
 */
export type BoxedRule = {
  /** @internal */
  readonly _tag: 'boxed-rule';

  match: undefined | BoxedExpression;

  replace: BoxedExpression | RuleReplaceFunction | RuleFunction;

  condition: undefined | RuleConditionFunction;

  useVariations?: boolean; // If true, the rule will match variations, for example
  // 'x' will match 'a + x', 'x' will match 'ax', etc...
  // Default to false.

  id?: string; // For debugging
};

/**
 * To create a BoxedRuleSet use the `ce.rules()` method.
 *
 * Do not create a `BoxedRuleSet` directly.
 *
 * @category Rules
 */
export type BoxedRuleSet = { rules: ReadonlyArray<BoxedRule> };

/** @category Compute Engine */
export type AssignValue =
  | boolean
  | number
  | SemiBoxedExpression
  | ((
      args: ReadonlyArray<BoxedExpression>,
      options: EvaluateOptions & { engine: IComputeEngine }
    ) => BoxedExpression)
  | undefined;

/** @internal */
export interface IComputeEngine extends IBigNum {
  latexDictionary: readonly LatexDictionaryEntry[];

  /** @private */
  indexedLatexDictionary: IndexedLatexDictionary;

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

  /** The current scope */
  context: RuntimeScope | null;

  /** Absolute time beyond which evaluation should not proceed
   * @internal
   */
  _deadline?: number;

  /** Time remaining before _deadline */
  _timeRemaining: number;

  /** @private */
  generation: number;

  /** Throw a `CancellationError` when the duration of an evaluation exceeds
   * the time limit.
   *
   * Time in milliseconds, default 2000 ms = 2 seconds.
   *
   */
  timeLimit: number;

  /** Throw `CancellationError` `iteration-limit-exceeded` when the iteration limit
   * in a loop is exceeded. Default: no limits.
   *
   * @experimental
   */
  iterationLimit: number;

  /** Signal `recursion-depth-exceeded` when the recursion depth for this
   * scope is exceeded.
   *
   * @experimental
   */
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

  /** If the precision is set to `machine`, floating point numbers
   * are represented internally as a 64-bit floating point number (as
   * per IEEE 754-2008), with a 52-bit mantissa, which gives about 15
   * digits of precision.
   *
   * If the precision is set to `auto`, the precision is set to 300 digits.
   *
   */
  set precision(p: number | 'machine' | 'auto');
  get precision(): number;

  tolerance: number;

  angularUnit: AngularUnit;

  costFunction: (expr: BoxedExpression) => number;

  strict: boolean;

  box(
    expr: NumericValue | SemiBoxedExpression,
    options?: { canonical?: CanonicalOptions; structural?: boolean }
  ): BoxedExpression;

  function(
    name: string,
    ops: ReadonlyArray<SemiBoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: CanonicalOptions;
      structural?: boolean;
    }
  ): BoxedExpression;

  number(
    value:
      | number
      | bigint
      | string
      | NumericValue
      | MathJsonNumber
      | BigNum
      | Complex
      | Rational,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
  ): BoxedExpression;

  symbol(
    sym: string,
    options?: { metadata?: Metadata; canonical?: CanonicalOptions }
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

  /**
   * Return a set of built-in rules.
   */
  getRuleSet(
    id?: 'harmonization' | 'solve-univariate' | 'standard-simplification'
  ): BoxedRuleSet | undefined;

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
    options?: Metadata & { canonical?: boolean }
  ): BoxedExpression;

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

  pushScope(scope?: Partial<Scope>): IComputeEngine;

  popScope(): IComputeEngine;

  swapScope(scope: RuntimeScope | null): RuntimeScope | null;

  resetContext(): void;

  defineSymbol(name: string, def: SymbolDefinition): BoxedSymbolDefinition;
  lookupSymbol(
    name: string,
    wikidata?: string,
    scope?: RuntimeScope
  ): undefined | BoxedSymbolDefinition;

  defineFunction(
    name: string,
    def: FunctionDefinition
  ): BoxedFunctionDefinition;
  lookupFunction(
    name: string,
    scope?: RuntimeScope | null
  ): undefined | BoxedFunctionDefinition;

  assign(ids: { [id: string]: AssignValue }): IComputeEngine;
  assign(id: string, value: AssignValue): IComputeEngine;
  assign(
    arg1: string | { [id: string]: AssignValue },
    arg2?: AssignValue
  ): IComputeEngine;

  declare(identifiers: {
    [id: string]:
      | Type
      | TypeString
      | OneOf<[SymbolDefinition | FunctionDefinition]>;
  }): IComputeEngine;
  declare(
    id: string,
    def: Type | TypeString | SymbolDefinition | FunctionDefinition
  ): IComputeEngine;
  declare(
    arg1:
      | string
      | {
          [id: string]:
            | Type
            | TypeString
            | OneOf<[SymbolDefinition | FunctionDefinition]>;
        },
    arg2?: Type | OneOf<[SymbolDefinition | FunctionDefinition]>
  ): IComputeEngine;

  assume(predicate: BoxedExpression): AssumeResult;

  forget(symbol?: string | string[]): void;

  get assumptions(): ExpressionMapInterface<boolean>;

  ask(pattern: BoxedExpression): BoxedSubstitution[];

  verify(query: BoxedExpression): boolean;

  /** @internal */
  shouldContinueExecution(): boolean;

  /** @internal */
  checkContinueExecution(): void;

  /** @internal */
  cache<T>(name: string, build: () => T, purge?: (t: T) => T | undefined): T;

  /** @internal */
  readonly stats: ComputeEngineStats;

  /** @internal */
  reset(): void;

  /** @internal */
  _register(expr: BoxedExpression): void;

  /** @internal */
  _unregister(expr: BoxedExpression): void;
}
