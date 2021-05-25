import {
  Expression,
  ErrorCode,
  DictionaryCategory,
  ErrorListener,
} from '../public';

export type LatexToken = string | '<{>' | '<}>' | '<space>' | '<$>' | '<$$>';

export type LatexString = string;

/**
 * Custom parser function.
 *
 * It is triggered by a latex fragment (the `latex` argument). When invoked,
 * the scanner points right after that latex fragment. The scanner should be
 * moved, by calling `scanner.next()` for every consumed token.
 *
 * If it was in an infix or postfix context, `lhs` will represent the
 * left-hand side argument. In a prefix or matchfix context, `lhs` is `null`.
 *
 * The function should return a tuple whose first element is an unprocessed
 * left-hand side, if any. If the left-hand-side has been consumed (for example
 * if this was a valid infix operator), the first element of the tuple
 * should be `null`.
 *
 * The second element is the resulting expression.
 *
 */
export type ParserFunction = (
  lhs: Expression | null,
  scanner: Scanner,
  minPrec: number
  // latex: LatexString
) => [lhs: Expression | null, result: Expression | null];

/**
 * Maps a string of Latex tokens to a function or symbol and vice-versa.
 *
 */
export type LatexDictionaryEntry = {
  /**
   * Map a function or symbol name to this record.
   *
   * Each record should have at least a `name` or a `trigger`
   */
  name?: string;

  /**
   * Map one or more latex tokens to this record.
   *
   * As a shortcut, if the trigger is a LatexToken, it is assumed to be a symbol.
   *
   * There can be multiple entries (for example '+' is both an infix and a
   * prefix)
   */
  trigger?:
    | LatexToken
    | {
        symbol?: LatexToken | LatexToken[];
        matchfix?: LatexToken | LatexToken[];
        /**
         * Infix position, with an operand before and an operand after: `a ⊛ b`.
         *
         * Example: `+`, `\times`
         */
        infix?: LatexToken | LatexToken[];

        /**
         * Prefix position, with an operand after: `⊛ a`
         *
         * Example: `-`, `\not`
         */
        prefix?: LatexToken | LatexToken[];

        /**
         * Postfix position, with an operand before: `a⊛`
         */
        postfix?: LatexToken | LatexToken[];
        /**
         * Superfix position (in a superscript), with the base of the
         * superscript as the operand: `a^{⊛}`
         */
        superfix?: LatexToken | LatexToken[];
        /**
         * Subfix position (in a subscript), with the base of the
         * subscript as the operand: `a_{⊛}`
         */
        subfix?: LatexToken | LatexToken[];
        /**
         * The name of an environment, as used in `\begin{matrix}` where
         * `"matrix"` is the name of the environment.
         *
         */
        environment?: string;
      };

  /**
   * A function that returns an expression, or an expression
   */
  parse?: Expression | ParserFunction;

  /**
   * The Latex to serialize.
   */
  serialize?: SerializerFunction | LatexString;

  /**
   * If `trigger` is `'infix'``
   * - **`both`**: a + b + c -> +(a, b, c)
   * - **`left`**: a / b / c -> /(/(a, b), c)
   * - **`right`**: a = b = c -> =(a, =(b, c))
   * - **`non`**: a < b < c -> syntax error
   *
   * - a `both`-associative operator has an unlimited number of arguments
   * - a `left`, `right` or `non` associative operator has at most two arguments
   */
  associativity?: 'right' | 'left' | 'non' | 'both';

  /** If `trigger` is `'infix'`` */
  precedence?: number; // Priority

  /**
   * If `trigger` is `'symbol'``.
   * Indicate if this symbol can be followed by arguments.
   * The presence of arguments will indicate that the arguments should be
   * applied to the symbol. Otherwise, the invisible operator is applied
   * to the symbol and the arguments.
   *
   * If `arguments` is `"group"`:
   *
   * "f(x)" -> `["f", "x"]`
   * "f x" -> `["multiply", "f", "x"]`
   *
   * If `arguments` is `""`:
   *
   * "f(x)" -> `["multiply", "f", ["group", "x"]]`
   * "f x" -> `["multiply", "f", "x"]`
   *
   * If `arguments` is `"group/primary"` and the symbol is followed either
   * by a group or by a primary (prefix + symbol + subsupfix + postfix).
   * Used for trig functions. i.e. `\sin x` vs `\sin(x)`:
   *
   * "f(x)" -> `["f", "x"]`
   * "f x" -> `["f", "x"]`
   *
   */
  arguments?: 'group' | 'implicit' | '';

  /**
   * If `trigger` is `'symbol'``.
   *
   * If a Latex command (i.e. the trigger starts with `\`, e.g. `\sqrt`)
   * indicates the number of optional arguments expected (indicate with
   * square brackets).
   *
   * For example, for the `\sqrt` command, 1: `\sqrt[3]{x}`
   *
   */
  optionalLatexArg?: number;

  /**
   * If `trigger` is `'symbol'``.
   *
   * If a Latex command (i.e. the trigger starts with `\`, e.g. `\frac`)
   * indicates the number of required arguments expected (indicated with
   * curly braces).
   *
   * For example, for the `\frac` command, 2: `\frac{1}{n}`
   *
   */
  requiredLatexArg?: number;

  /**
   * If `trigger` is `'matchfix'``.
   */
  separator?: LatexString;
  closeFence?: LatexToken | LatexToken[];
};

export type LatexDictionary = LatexDictionaryEntry[];

export type ParseLatexOptions = {
  /**
   * If a symbol follows a number, consider them separated by this
   * invisible operator.
   *
   * Default: `"Multiply"`
   */
  invisibleOperator?: string;

  /**
   * If true, ignore space characters.
   *
   */
  skipSpace?: boolean;

  /**
   * When an unknown latex command is encountered, attempt to parse
   * any arguments it may have.
   *
   * For example, `\foo{x+1}` would produce `['\foo', ['add', 'x', 1]]` if
   * this property is true, `['latex', '\foo', '<{>', 'x', '+', 1, '<{>']`
   * otherwise.
   */
  parseArgumentsOfUnknownLatexCommands?: boolean;

  /**
   * When a number is encountered, parse it.
   *
   * Otherwise, return each token making up the number (minus sign, digits,
   * decimal separator, etc...)
   */
  parseNumbers?: boolean;

  /**
   * If this setting is not empty, when a number is immediately followed by a
   * fraction, assume that the fraction should be added to the number, that
   * is that there is an invisible plus operator between the two.
   *
   * For example with `2\frac{3}{4}`:
   * - when `invisiblePlusOperator` is `"add"` : `["add", 2, ["divide", 3, 4]]`
   * - when `invisiblePlusOperator` is `""`: `["multiply", 2, ["divide", 3, 4]]`
   */
  invisiblePlusOperator?: string;

  /**
   * When a token is encountered at a position where a symbol could be
   * parsed, if the token matches `promoteUnknownSymbols` it will be
   * accepted as a symbol (an `unknown-symbol` error will still be triggered
   * so that the caller can be notified). Otherwise, the symbol is rejected.
   */
  promoteUnknownSymbols?: RegExp;

  /**
   * When a token is encountered at a position that could match
   * a function call, and it is followed by an apply function operator
   * (typically, parentheses), consider them to a be a function if the
   * string of tokens match this regular expression.
   *
   * While this is a convenient shortcut, it is recommended to more explicitly
   * define custom functions by providing an entry for them in a function
   * dictionary (providing additional information about their arguments, etc...)
   * and in a Latex translation dictonary (indicating what Latex markup
   * corresponds to the function).
   *
   * Example:
   *
   * By default, `f(x)` is parsed as ["multiply", "f", "x"].
   *
   * After...
   *
   * ```
   *      promoteUnknownFunctions = /^[fg]$/
   * ```
   *
   * ... `f(x)` is parsed as ["f", "x"]
   *
   *
   */
  promoteUnknownFunctions?: RegExp;

  /**
   * If true, the expression will be decorated with the Latex
   * fragments corresponding to each elements of the expression
   */
  preserveLatex?: boolean;
};

export type SerializeLatexOptions = {
  /**
   * Latex string used to render an invisible multiply, e.g. in '2x'.
   * Leave it empty to join the adjacent terms, or use `\cdot` to insert
   * a `\cdot` operator between them, i.e. `2\cdot x`.
   *
   * Empty by default.
   */
  invisibleMultiply?: LatexString;

  /**
   * Latex string used for an invisible plus, e.g. in '1 3/4'.
   * Leave it empty to join the main number and the fraction, i.e. render it
   * as `1\frac{3}{4}`, or use `+` to insert a `+` operator between them, i.e.
   * `1+\frac{3}{4}`
   *
   * Empty by default.
   */
  invisiblePlus?: LatexString;

  // @todo: consider invisibleApply?: string;

  /**
   * Latex string used for an explicit multiply operator,
   *
   * Default: `\times`
   */
  multiply?: LatexString; // e.g. '\\times', '\\cdot'
};

export type NumberFormattingOptions = {
  precision?: number;
  positiveInfinity?: string;
  negativeInfinity?: string;
  notANumber?: string;
  /**
   * A string representing the decimal marker, the string separating
   * the whole portion of a number from the fractional portion, i.e.
   * the '.' in '3.1415'.
   *
   * Default: `"."`
   */
  decimalMarker?: string;
  /**
   * A string representing the separator between groups of digits,
   * used to improve readability of numbers with lots of digits.
   *
   * Default: `","`
   */
  groupSeparator?: string;
  exponentProduct?: string;
  beginExponentMarker?: string;
  endExponentMarker?: string;
  notation?: 'engineering' | 'auto' | 'scientific';
  truncationMarker?: string;
  beginRepeatingDigits?: string;
  endRepeatingDigits?: string;
  imaginaryNumber?: string;
};

/**
 * For best performance when calling repeatedly `parse()` or `serialize()`,
 * create an instance of `LatexSyntax` and call its methods. The constructor
 * of `LatexSyntax` will compile and optimize the dictionary so that calls of
 * the `parse()` and `serialize()` methods will bypass that step. By contrast
 * invoking the `parse()` and `serialize()` functions will compile the
 * dictionary each time they are called.
 */
export declare class LatexSyntax {
  /**
   *
   * @param onError - Called when a non-fatal error is encountered. When parsing,
   * the parser will attempt to recover and continue.
   *
   */
  constructor(
    options?: NumberFormattingOptions &
      ParseLatexOptions &
      SerializeLatexOptions & {
        onError?: ErrorListener<ErrorCode>;
      }
  );

  /**
   * Return a Latex dictionary suitable for the specified category, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A Latex dictionary is needed to translate between Latex and MathJSON.
   *
   * Each entry in the dictionary indicate how a Latex token (or string of
   * tokens) should be parsed into a MathJSON expression.
   *
   * For example an entry can define that the token `\pi` should map to the
   * symbol `"pi"`, or that the token `-` should map to the function
   * `["negate",...]` when in a prefix position and to the function
   * `["subtract", ...]` when in an infix position.
   *
   * Furthermore, the information in each dictionary entry is used to serialize
   * the Latex string corresponding to a MathJSON expression.
   *
   * Use the value returned by this function to the `options` argument of the
   * constructor.
   */
  static getDictionary(
    domain?: DictionaryCategory | 'all'
  ): Readonly<LatexDictionary>;

  parse(latex: LatexString): Expression;
  serialize(expr: Expression): LatexString;
}

export interface Serializer {
  readonly onError: ErrorListener<ErrorCode>;

  readonly options: Required<SerializeLatexOptions>;

  /** "depth" of the expression:
   * - 0 for the root
   * - 1 for the arguments of the root
   * - 2 for the arguments of the arguments of the root
   * - etc...
   *
   * This allows for variation of the Latex serialized based
   * on the depth of the expression, for example using `\Bigl(`
   * for the top level, and `\bigl(` or `(` for others.
   */
  level: number;

  /** Output a Latex string representing the expression */
  serialize: (expr: Expression | null) => string;

  wrapString(s: string, style: 'paren' | 'leftright' | 'big' | 'none'): string;

  /** Add a group fence around the expression if it is
   * an operator of precedence less than or equal to `prec`.
   */

  wrap: (expr: Expression | null, prec?: number) => string;

  /** Add a group fence around the expression if it is
   * short (not a function)
   */
  wrapShort(expr: Expression | null): string;
}

export type SerializerFunction = (
  serializer: Serializer,
  expr: Expression
) => string;

export interface Scanner {
  readonly onError: ErrorListener<ErrorCode>;
  readonly options: Required<ParseLatexOptions>;

  index: number;
  readonly atEnd: boolean;

  /** Return the next token, without advancing the index */
  readonly peek: LatexToken;

  /** Return an array of string corresponding to tokens ahead.
   * The index is unchanged.
   */
  lookAhead(): string[];
  /** Return the next token and advance the index */
  next(): LatexToken;
  /** Return a latex string before the index */
  latexBefore(): string;
  /** Return a latex string after the index */
  latexAfter(): string;
  /** If there are any space, advance the index until a non-space is encountered */
  skipSpace(): boolean;
  /** If the next token matches the target advance and return true. Otherwise
   * return false */
  match(target: LatexToken): boolean;
  matchAny(targets: LatexToken[]): LatexToken;
  matchWhile(targets: LatexToken[]): LatexToken[];

  /** If the next token matches a `+` or `-` sign, return it and advance the index.
   * Otherwise return `''` and do not advance */
  matchSign(): string;
  matchDecimalDigits(): string;
  matchSignedInteger(): string;
  matchExponent(): string;
  matchNumber(): string;

  matchTabular(): null | Expression;

  applyOperator(
    op: string,
    lhs: Expression | null,
    rhs: Expression | null
  ): NonNullable<[Expression | null, Expression | null]>;
  applyInvisibleOperator(
    lhs: Expression | null,
    rhs: Expression | null
  ): Expression | null;
  /** If the next tokens correspond to an optional argument,
   * enclosed with `[` and `]` return the content of the argument
   * as an expression and advance the index past the closing `]`.
   * Otherwise, return null
   */
  matchOptionalLatexArgument(): Expression | null;
  matchRequiredLatexArgument(): Expression | null;
  matchArguments(kind: '' | 'group' | 'implicit'): Expression[] | null;

  matchSupsub(lhs: Expression | null): Expression | null;

  /**
   * <primary> :=
   * (<number> | <symbol> | <latex-command> | <function-call> | <matchfix-expr>)
   * (<subsup> | <postfix-operator>)*
   *
   * <matchfix-expr> :=
   *  <matchfix-op-open> <expression> <matchfix-op-close>
   *
   * <function-call> ::=
   *  | <function><matchfix-op-group-open><expression>[',' <expression>]<matchfix-op-group-close>
   *
   * If not a primary, return `null` and do not advance the index.
   */
  matchPrimary(minPrec?: number): Expression | null;

  /**
   *  Parse an expression:
   *
   * <expression> ::=
   *  | <prefix-op> <expression>
   *  | <primary>
   *  | <primary> <infix-op> <expression>
   *
   * Stop when an operator of precedence less than `minPrec` is encountered
   *
   * `minPrec` is 0 by default.
   */
  matchExpression(minPrec?: number): Expression | null;

  matchBalancedExpression(
    open: LatexToken,
    close: LatexToken,
    onError?: ErrorListener<ErrorCode>
  ): Expression | null;
}

/**
 * Parse a Latex string and return a corresponding MathJSON expression.
 *
 * @param onError - Called when a non-fatal error is encountered while parsing.
 * The parsing will attempt to recover and continue.
 *
 */
export declare function parse(
  latex: LatexString,
  options?: NumberFormattingOptions &
    ParseLatexOptions & {
      onError?: ErrorListener<ErrorCode>;
    }
): Expression;

/**
 * Serialize a MathJSON expression as a Latex string.
 *
 */
export declare function serialize(
  expr: Expression,
  options?: NumberFormattingOptions &
    SerializeLatexOptions & {
      dictionary?: Readonly<LatexDictionary>;
      onError?: ErrorListener<ErrorCode>;
    }
): LatexString;
