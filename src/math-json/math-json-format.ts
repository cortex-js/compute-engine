export type Attributes = {
  /** A human readable string to annotate an expression, since JSON does not
   * allow comments in its encoding */
  comment?: string;

  /** A Markdown-encoded string providing documentation about this expression.
   */
  documentation?: string;

  /** A human readable string to indicate a syntax error or
   * other problem when parsing or evaluating an expression.
   */
  error?: string;

  /** A visual representation in LaTeX of the expression.
   *
   * This can be useful to preserve non-semantic details, for example
   * parentheses in an expression or styling attributes
   */
  latex?: string;

  /**
   * A short string indicating an entry in a wikibase.
   *
   * For example
   * `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   *  for the `Pi` constant.
   */
  wikidata?: string;

  /** A base URL for the `wikidata` key.
   *
   * A full URL can be produced by concatenating this key with the `wikidata`
   * key. This key applies to this node and all its children.
   *
   * The default value is "https://www.wikidata.org/wiki/"
   */
  wikibase?: string;

  /** A short string indicating an entry in an OpenMath Content Dictionary.
   *
   * For example: `arith1/#abs`.
   *
   */
  openmathSymbol?: string;

  /** A base URL for an OpenMath content dictionary. This key applies to this
   * node and all its children.
   *
   * The default value is "http://www.openmath.org/cd".
   */
  openmathCd?: string;

  /**  A url to the source of this expression.
   */
  sourceUrl?: string;

  /** The source from which this expression was generated.
   *
   * It could be a LaTeX expression, or some other source language
   */
  sourceContent?: string;

  /**
   * A character offset in `sourceContent` or `sourceUrl` from which this
   * expression was generated
   */
  sourceOffsets?: [start: number, end: number];
};

/**
 * A MathJSON numeric quantity.
 *
 * The string is a string of:
 * - an optional `-` minus sign
 * - a string of decimal digits
 * - an optional fraction part (a `.` decimal point followed by decimal digits)
 * - an optional exponent part (a `e` or `E` exponent marker followed by an
 *   optional `-` minus sign, followed by a string of digits).
 * - an optional format indicator:
 *    - `n` to indicate the preceding is a BigInt
 *    - `d` to indicate the preceding is an arbitrary precision Decimal number
 *
 * For example: `-12.34`, `0.234e-56`, `123454d`.
 */
export type MathJsonNumber = {
  num: 'NaN' | '-Infinity' | '+Infinity' | string;
} & Attributes;

export type MathJsonSymbol = {
  sym: string;
} & Attributes;

export type MathJsonString = {
  str: string;
} & Attributes;

export type MathJsonFunction<T extends number = number> = {
  fn: Expression<T>[];
} & Attributes;

export type MathJsonDictionary<T extends number = number> = {
  dict: { [key: string]: Expression<T> };
} & Attributes;

/**
 * A MathJSON expression is a recursive data structure.
 *
 * The leaf nodes of an expression are numbers, strings and symbols.
 * The dictionary and function nodes can contain expressions themselves.
 *
 * The type variable `T` indicates which numeric type are valid. For a
 * canonical, well-formed, MathJSON expression, this is limited to the
 * `number` type. However, for the purpose of internal calculations this can
 * be extended to other numeric types. For example, internally the
 * Compute Engine also uses `Decimal` and `Complex` classes.
 */
export type Expression<T extends number = number> =
  // Shortcut for MathJsonNumber without metadata and in the JavaScript
  // 64-bit float range.
  | T
  | MathJsonNumber
  | MathJsonString
  | MathJsonSymbol
  // Shortcut for a MathJsonSymbol with no metadata. Or a string.
  | string
  | MathJsonFunction<T>
  | MathJsonDictionary<T>
  | Expression<T>[];

export type Substitution<T extends number = number> = {
  [symbol: string]: Expression<T>;
};
