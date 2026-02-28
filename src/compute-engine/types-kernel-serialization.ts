/** @category Definitions */
export type Hold = 'none' | 'all' | 'first' | 'rest' | 'last' | 'most';

/**
 * Options to control serialization to MathJSON when using
 * `Expression.toMathJson()`.
 *
 * @category Serialization
 */
export type JsonSerializationOptions = {
  /**
   * If true, serialization applies readability transforms.
   * Example: `["Power", "x", 2]` -> `["Square", "x"]`.
   */
  prettify: boolean;

  /**
   * Function names to exclude from prettified output.
   * Excluded functions are replaced by equivalent non-prettified forms.
   */
  exclude: string[];

  /**
   * Which expression kinds can use shorthand output.
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

  /**
   * Metadata fields to include. When metadata is included, shorthand notation
   * is disabled for affected nodes.
   */
  metadata: ('all' | 'wikidata' | 'latex')[];

  /**
   * If true, detect and serialize repeating decimals (for example `0.(3)`).
   *
   * **Default**: `true`
   */
  repeatingDecimal: boolean;

  /**
   * Controls how many digits are emitted for arbitrary-precision numbers.
   *
   * - `"max"`: all available digits from the raw `BigDecimal` value,
   *   including digits beyond the working precision (no rounding).
   * - `"auto"`: round to `ce.precision` significant digits. Internally
   *   converted to `-ce.precision` (negative = total significant digits).
   * - A non-negative number: exactly that many digits after the decimal
   *   point (passed to `BigDecimal.toFixed()`).
   *
   * The `.json` property and `toJSON()` use `"max"` for lossless data
   * interchange. The `.latex` getter uses `"auto"` so that noise digits
   * from precision-bounded operations are not displayed.
   *
   * **Default**: `"max"` (when called via `toMathJson()` directly)
   */
  fractionalDigits: 'auto' | 'max' | number;
};

/**
 * Control how a pattern is matched to an expression.
 *
 * ## Wildcards
 * - Universal (`_` or `_name`): exactly one element
 * - Sequence (`__` or `__name`): one or more elements
 * - Optional Sequence (`___` or `___name`): zero or more elements
 *
 * @category Pattern Matching
 */
export type PatternMatchOptions<T = unknown> = {
  /**
   * Preset bindings for named wildcards. Useful to enforce consistency
   * across repeated wildcard occurrences.
   */
  substitution?: BoxedSubstitution<T>;

  /**
   * If true, match recursively in sub-expressions; otherwise only at
   * the top level.
   */
  recursive?: boolean;

  /**
   * If true, allow structurally equivalent variations to match.
   * If false, require structural identity.
   */
  useVariations?: boolean;

  /**
   * If true (default), commutative operators may match with permuted operands.
   * If false, operand order must match exactly.
   */
  matchPermutations?: boolean;

  /**
   * If true, allow matching when the expression has fewer operands than the
   * pattern by treating missing terms as identity elements (0 for `Add`,
   * 1 for `Multiply`). A free wildcard in a missing product term is set to 0
   * (since 0 × anything = 0).
   *
   * For example, `3x²+5` matches `_a·x²+_b·x+_c` with `_b = 0`.
   *
   * **Default**: `true` when the pattern is a string, `false` otherwise.
   */
  matchMissingTerms?: boolean;
};

/**
 * Options for `Expression.replace()`.
 *
 * @category Boxed Expression
 */
export type ReplaceOptions = {
  /**
   * If true, apply rules to all sub-expressions.
   * If false, only the top-level expression is considered.
   */
  recursive: boolean;

  /**
   * If true, stop after the first matching rule.
   * If false, continue applying remaining rules.
   */
  once: boolean;

  /**
   * If true, rules may match equivalent variants.
   * Can be powerful but may introduce recursion hazards.
   */
  useVariations: boolean;

  /**
   * If true (default), commutative matches may permute operands.
   * If false, matching is order-sensitive.
   */
  matchPermutations: boolean;

  /**
   * Repeat rule application up to this limit when `once` is false.
   */
  iterationLimit: number;

  /**
   * Canonicalization policy after replacement.
   */
  canonical: CanonicalOptions;
};

/**
 * Canonical normalization transforms.
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
 * Controls how expressions are created.
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
 * Metadata that can be associated with a MathJSON expression.
 *
 * @category Boxed Expression
 */
export type Metadata = {
  latex?: string | undefined;
  wikidata?: string | undefined;
};

/**
 * A substitution maps wildcard symbols to bound values.
 *
 * @category Pattern Matching
 */
export type Substitution<T = unknown> = {
  [symbol: string]: T;
};

/**
 * @category Pattern Matching
 */
export type BoxedSubstitution<T = unknown> = Substitution<T>;
