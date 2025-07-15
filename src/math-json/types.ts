/**
 * The following properties can be added to any MathJSON expression
 * to provide additional information about the expression.
 *
 * @category MathJSON */
export type MathJsonAttributes = {
  /** A human readable string to annotate this expression, since JSON does not
   * allow comments in its encoding */
  comment?: string;

  /** A Markdown-encoded string providing documentation about this expression.
   */
  documentation?: string;

  /** A visual representation of this expression as a LaTeX string.
   *
   * This can be useful to preserve non-semantic details, for example
   * parentheses in an expression or styling attributes.
   */
  latex?: string;

  /**
   * A short string referencing an entry in a wikibase.
   *
   * For example:
   *
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

  /**  A URL to the source code from which this expression was generated.
   */
  sourceUrl?: string;

  /** The source code from which this expression was generated.
   *
   * It could be a LaTeX expression, or some other source language.
   */
  sourceContent?: string;

  /**
   * A character offset in `sourceContent` or `sourceUrl` from which this
   * expression was generated.
   */
  sourceOffsets?: [start: number, end: number];
};

/** @category MathJSON */
export type MathJsonSymbol = string;

/**
 * A MathJSON numeric quantity.
 *
 * The `num` string is made of:
 * - an optional `-` minus sign
 * - a string of decimal digits
 * - an optional fraction part (a `.` decimal marker followed by decimal digits)
 * - an optional repeating decimal pattern: a string of digits enclosed in
 *    parentheses
 * - an optional exponent part (a `e` or `E` exponent marker followed by an
 *   optional `-` minus sign, followed by a string of digits)
 *
 * It can also consist of the string `NaN`, `-Infinity` or `+Infinity` to
 * represent these respective values.
 *
 * A MathJSON number may contain more digits or an exponent with a greater
 * range than can be represented in an IEEE 64-bit floating-point.
 *
 * For example:
 * - `-12.34`
 * - `0.234e-56`
 * - `1.(3)`
 * - `123456789123456789.123(4567)e999`
 * @category MathJSON
 */
export type MathJsonNumberObject = {
  num: 'NaN' | '-Infinity' | '+Infinity' | string;
} & MathJsonAttributes;

/** @category MathJSON */
export type MathJsonSymbolObject = {
  sym: MathJsonSymbol;
} & MathJsonAttributes;

/** @category MathJSON */
export type MathJsonStringObject = {
  str: string;
} & MathJsonAttributes;

/** @category MathJSON */
export type MathJsonFunctionObject = {
  fn: [MathJsonSymbol, ...Expression[]];
} & MathJsonAttributes;

/** @category MathJSON */
export type MathJsonDictionaryObject = {
  dict: Record<string, Expression>;
} & MathJsonAttributes;

/**
 * @category MathJSON
 */
export type ExpressionObject =
  | MathJsonNumberObject
  | MathJsonStringObject
  | MathJsonSymbolObject
  | MathJsonFunctionObject
  | MathJsonDictionaryObject;
/**
 * A MathJSON expression is a recursive data structure.
 *
 * The leaf nodes of an expression are numbers, strings and symbols.
 * The dictionary and function nodes can contain expressions themselves.
 *
 * @category MathJSON
 */
export type Expression =
  | ExpressionObject
  // Shortcut for MathJsonNumber in the JavaScript 64-bit float range.
  | number
  // Shortcut for a MathJsonSymbol
  | MathJsonSymbol
  // Shortcut for a string or a number
  | string
  // Shortcut for a function
  | readonly [MathJsonSymbol, ...Expression[]];
