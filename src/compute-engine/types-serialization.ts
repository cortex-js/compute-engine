import type {
  BoxedExpression,
  SemiBoxedExpression,
} from './types-expression';

/** @category Definitions */
export type Hold = 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

/**
 * Options to control the serialization to MathJSON when using `BoxedExpression.toMathJson()`.
 *
 * @category Serialization
 */
export type JsonSerializationOptions = {
  /** If true, the serialization applies some transformations to make
   * the JSON more readable. For example, `["Power", "x", 2]` is serialized
   * as `["Square", "x"]`.
   */
  prettify: boolean;

  /** A list of space separated function names that should be excluded from
   * the JSON output.
   *
   * Those functions are replaced with an equivalent, for example, `Square` with
   * `Power`, etc...
   *
   * Possible values include `Sqrt`, `Root`, `Square`, `Exp`, `Subtract`,
   * `Rational`, `Complex`
   *
   * **Default**: `[]` (none)
   */
  exclude: string[];

  /** A list of space separated keywords indicating which MathJSON expressions
   * can use a shorthand.
   *
   * **Default**: `["all"]`
   */
  shorthands: (
    | 'all'
    | 'number'
    | 'symbol'
    | 'function'
    | 'string'
    | 'dictionary'
  )[];

  /** A list of space separated keywords indicating which metadata should be
   * included in the MathJSON. If metadata is included, shorthand notation
   * is not used.
   *
   * **Default**: `[]`  (none)
   */
  metadata: ('all' | 'wikidata' | 'latex')[];

  /** If true, repeating decimals are detected and serialized accordingly
   * For example:
   * - `1.3333333333333333` \( \to \) `1.(3)`
   * - `0.142857142857142857142857142857142857142857142857142` \( \to \) `0.(1428571)`
   *
   * **Default**: `true`
   */
  repeatingDecimal: boolean;

  /**
   * The maximum number of significant digits in serialized numbers.
   * - `"max"`: all availabe digits are serialized.
   * - `"auto"`: use the same precision as the compute engine.
   *
   * **Default**: `"auto"`
   */
  fractionalDigits: 'auto' | 'max' | number;
};

/**
 * Control how a pattern is matched to an expression.
 *
 * ## Wildcards
 *
 * Patterns can include wildcards to match parts of expressions:
 *
 * - **Universal (`_` or `_name`)**: Matches exactly one element
 * - **Sequence (`__` or `__name`)**: Matches one or more elements
 * - **Optional Sequence (`___` or `___name`)**: Matches zero or more elements
 *
 * Named wildcards capture values in the returned substitution:
 * - `['Add', '_a', 1].match(['Add', 'x', 1])` → `{_a: 'x'}`
 * - `['Add', '__a'].match(['Add', 1, 2, 3])` → `{__a: [1, 2, 3]}`
 *
 * ## Options
 *
 * - `substitution`: if present, assumes these values for a subset of
 *    named wildcards, and ensure that subsequent occurrence of the same
 *    wildcard have the same value.
 * - `recursive`: if true, match recursively, otherwise match only the top
 *    level.
 * - `useVariations`: if false, only match expressions that are structurally identical.
 *    If true, match expressions that are structurally identical or equivalent.
 *    For example, when true, `["Add", '_a', 2]` matches `2`, with `_a = 0`.
 *    **Default**: `false`
 * - `matchPermutations`: if true (default), for commutative operators, try all
 *    permutations of pattern operands. If false, match exact order only.
 *
 * @category Pattern Matching
 *
 */
export type PatternMatchOptions<T = BoxedExpression> = {
  substitution?: BoxedSubstitution<T>;
  recursive?: boolean;
  useVariations?: boolean;
  /**
   * If `true` (default), for commutative operators, try all permutations of
   * the pattern operands to find a match.
   *
   * If `false`, only match in the exact order given. This can be useful
   * when the pattern order is significant or for performance optimization
   * with large patterns.
   */
  matchPermutations?: boolean;
};

/**
 * @category Boxed Expression
 *
 */
export type ReplaceOptions = {
  /**
   * If `true`, apply replacement rules to all sub-expressions.
   *
   * If `false`, only consider the top-level expression.
   *
   * **Default**: `false`
   */
  recursive: boolean;

  /**
   * If `true`, stop after the first rule that matches.
   *
   * If `false`, apply all the remaining rules even after the first match.
   *
   * **Default**: `false`
   */
  once: boolean;

  /**
   * If `true` the rule will use some equivalent variations to match.
   *
   * For example when `useVariations` is true:
   * - `x` matches `a + x` with a = 0
   * - `x` matches `ax` with a = 1
   * - etc...
   *
   * Setting this to `true` can save time by condensing multiple rules
   * into one. This can be particularly useful when describing equations
   * solutions. However, it can lead to infinite recursion and should be
   * used with caution.
   *
   */
  useVariations: boolean;

  /**
   * If `true` (default), for commutative operators, try all permutations of
   * the pattern operands to find a match.
   *
   * If `false`, only match in the exact order given. This can be useful
   * when the pattern order is significant or for performance optimization
   * with large patterns.
   *
   * **Default**: `true`
   */
  matchPermutations: boolean;

  /**
   * If `iterationLimit` > 1, the rules will be repeatedly applied
   * until no rules apply, up to `iterationLimit` times.
   *
   * Note that if `once` is true, `iterationLimit` has no effect.
   *
   * **Default**: `1`
   */
  iterationLimit: number;

  /**
   * Indicate if the expression should be canonicalized after the replacement.
   * If not provided, the expression is canonicalized if the expression
   * that matched the pattern is canonical.
   */
  canonical: CanonicalOptions;
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
 *    application (`f(x)`). Also replaces ['InvisibleOperator', real, imaginary] instances with
 *    complex (imaginary) numbers.
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

/** @category Boxed Expression */
export type CanonicalOptions = boolean | CanonicalForm | CanonicalForm[];

/**
 * Controls how an expression is created:
 *
 * - `'canonical'` (default): Full canonicalization with binding. Equivalent
 *   to the previous `{ canonical: true }`.
 * - `'raw'`: No canonicalization, no binding. Equivalent to the previous
 *   `{ canonical: false }`.
 * - `'structural'`: Binding + structural normalization (flatten associative
 *   ops, sort commutative ops) but no full canonicalization. Equivalent to
 *   the previous `{ structural: true }`.
 * - A single `CanonicalForm` name (e.g. `'Number'`): Apply only that canonical
 *   form.
 * - An array of `CanonicalForm` names: Apply those canonical forms in order.
 *
 * @category Boxed Expression
 */
export type FormOption =
  | 'canonical'
  | 'structural'
  | 'raw'
  | CanonicalForm
  | CanonicalForm[];

/**
 * Metadata that can be associated with an MathJSON expression.
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

  * @category Pattern Matching
  */
export type Substitution<T = SemiBoxedExpression> = {
  [symbol: string]: T;
};

/**
 * @category Pattern Matching
 *
 */
export type BoxedSubstitution<T = BoxedExpression> = Substitution<T>;
