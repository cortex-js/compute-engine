import { ComputeEngine } from '../compute-engine/public';
import {
  Expression,
  ErrorCode,
  DictionaryCategory,
  ErrorListener,
} from '../public';

/**
 * A `LatexToken` is a token as returned by `Scanner.peek`.
 *
 * It can be one of the indicated constants, or a string that starts with a
 * `\` for LaTeX commands, or another LaTeX characters, which include digits,
 * letters and punctuation.
 */
export type LatexToken = string | '<{>' | '<}>' | '<space>' | '<$>' | '<$$>';

/** A LatexString is a regular string of LaTeX, for example:
 * `\frac{\pi}{2}`
 */
export type LatexString = string;

/**
 * Custom parser function.
 *
 * It is triggered by a LaTeX fragment (the `latex` argument). When invoked,
 * the scanner points right after that LaTeX fragment. The scanner should be
 * moved, by calling `scanner.next()` for every consumed token.
 *
 * If it was in an infix or postfix context, `lhs` will represent the
 * left-hand side argument. In a prefix or matchfix context, `lhs` is `null`.
 *
 * The function should return a tuple:
 *
 * - Its first element is an unprocessed left-hand side, if any. If the
 * left-hand-side has been consumed (for example if this was a valid infix
 * operator), the first element of the tuple should be `null`.
 *
 * - Its second element is the resulting expression.
 *
 */
export type ParserFunction<T extends number = number> = (
  lhs: Expression<T> | null,
  scanner: Scanner<T>,
  minPrec: number
  // latex: LatexString
) => [lhs: Expression<T> | null, result: Expression<T> | null];

/**
 * Maps a string of LaTeX tokens to a function or symbol and vice-versa.
 *
 */
export type LatexDictionaryEntry<T extends number = number> = {
  /**
   * Map a function or symbol name to this record.
   *
   * Each record should have at least a `name` or a `parse`. If no `name`
   * is provided, the `name` is the same as `parse`.  This may be useful
   * for definitions that are only for parsing a symbol, but not serializing,
   * for example when there are synonyms for the same symbol (e.g. `\varnothing`
   * and `\emptyset`).
   *
   * The name is used when serializing to select the appropriate record
   * and call its `serialize` function.
   */
  name?: string;

  /**
   * The trigger is the first token (or set of tokens) that will make this
   * record eligible for attempting to parse the stream and generate an
   * expression. After trigger matches, the `parse` function is called,
   * if available. If there is no `parse` function, but there is a `parse`
   * property, the value of that property is the resuluting output.
   *
   * As a shortcut, if the trigger is `trigger: <string>`, it is equivalent to
   * `trigger: { symbol: [<tokens of string>] }`.
   *
   * There can be multiple entries, for example `+` is both an infix and a
   * prefix.
   */
  trigger?:
    | LatexString
    | {
        symbol?: LatexToken[];
        matchfix?: LatexToken[];
        /**
         * Infix position, with an operand before and an operand after: `a ⊛ b`.
         *
         * Example: `+`, `\times`
         */
        infix?: LatexToken[];

        /**
         * Prefix position, with an operand after: `⊛ a`
         *
         * Example: `-`, `\not`
         */
        prefix?: LatexToken[];

        /**
         * Postfix position, with an operand before: `a ⊛`
         */
        postfix?: LatexToken[];

        /**
         * Superfix position (in a superscript), with the base of the
         * superscript as the operand: `a^{⊛}`
         */
        superfix?: LatexToken[];

        /**
         * Subfix position (in a subscript), with the base of the
         * subscript as the operand: `a_{⊛}`
         */
        subfix?: LatexToken[];

        /**
         * The name of an environment, as used in `\begin{matrix}` where
         * `"matrix"` is the name of the environment.
         *
         */
        environment?: string;
      };

  /**
   * The `Expression` that is the result of parsing. If providing a parser
   * function, the context can be considered, for example accounting for
   * the left-hand-side expression, or the current precedence level.
   *
   * If the `parse` property is not provided, the `name` is used instead.
   */
  parse?: ParserFunction<T> | Expression<T>;

  /**
   * The LaTeX to serialize.
   */
  serialize?: SerializerFunction<T> | LatexString;

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
   * If a LaTeX command (i.e. the trigger starts with `\`, e.g. `\sqrt`)
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
   * If a LaTeX command (i.e. the trigger starts with `\`, e.g. `\frac`)
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

export type LatexDictionary<T extends number = number> =
  LatexDictionaryEntry<T>[];

export type ParseLatexOptions = {
  /**
   * If a symbol follows a number, consider them separated by this
   * invisible operator.
   *
   * Default: `Multiply`
   */
  invisibleOperator?: string;

  /**
   * If true, ignore space characters.
   *
   * Default: `true`
   *
   */
  skipSpace?: boolean;

  /**
   * When an unknown LaTeX command is encountered, attempt to parse
   * any arguments it may have.
   *
   * For example, `\foo{x+1}` would produce `['\foo', ['Add', 'x', 1]]` if
   * this property is true, `['LatexSymbols', '\foo', '<{>', 'x', '+', 1, '<{>']`
   * otherwise.
   */
  parseArgumentsOfUnknownLatexCommands?: boolean;

  /**
   * When a number is encountered, parse it.
   *
   * Otherwise, return each token making up the number (minus sign, digits,
   * decimal separator, etc...).
   *
   * Default: `true`
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
   * When one of these commands is encountered, it is skipped.
   *
   * Useful for purely presentational commands such as `\displaystyle`
   */
  ignoreCommands?: LatexToken[];

  /**
   * When one these commands is encountered, its argument is parsed,
   * as if the command was not present.
   *
   * Useful for some presentational commands such as `\left`, `\bigl`, etc...
   */
  idempotentCommands?: LatexToken[];

  /**
   * When a token is encountered at a position that could match
   * a function call, and it is followed by an apply function operator
   * (typically, parentheses), consider them to a be a function if the
   * string of tokens match this regular expression.
   *
   * While this is a convenient shortcut, it is recommended to more explicitly
   * define custom functions by providing an entry for them in a function
   * dictionary (providing additional information about their arguments, etc...)
   * and in a LaTeX translation dictionary (indicating what LaTeX markup
   * corresponds to the function).
   *
   * Example:
   *
   * By default, `f(x)` is parsed as `["Multiply", "f", "x"]`.
   *
   * After...
   *
   * ```
   *      promoteUnknownFunctions = /^[fg]$/
   * ```
   *
   * ... `f(x)` is parsed as `["f", "x"]`
   *
   *
   */
  promoteUnknownFunctions?: RegExp;

  /**
   * If true, the expression will be decorated with the LaTeX
   * fragments corresponding to each elements of the expression
   */
  preserveLatex?: boolean;
};

export type SerializeLatexOptions = {
  /**
   * LaTeX string used to render an invisible multiply, e.g. in '2x'.
   * Leave it empty to join the adjacent terms, or use `\cdot` to insert
   * a `\cdot` operator between them, i.e. `2\cdot x`.
   *
   * Empty by default.
   */
  invisibleMultiply?: LatexString;

  /**
   * LaTeX string used for an invisible plus, e.g. in '1 3/4'.
   * Leave it empty to join the main number and the fraction, i.e. render it
   * as `1\frac{3}{4}`, or use `+` to insert a `+` operator between them, i.e.
   * `1+\frac{3}{4}`
   *
   * Empty by default.
   */
  invisiblePlus?: LatexString;

  // @todo: consider invisibleApply?: string;

  /**
   * LaTeX string used for an explicit multiply operator,
   *
   * Default: `\times`
   */
  multiply?: LatexString; // e.g. '\\times', '\\cdot'

  // Styles
  applyFunctionStyle?: (
    expr: Expression,
    level: number
  ) => 'paren' | 'leftright' | 'big' | 'none';

  groupStyle?: (
    expr: Expression,
    level: number
  ) => 'paren' | 'leftright' | 'big' | 'none';

  rootStyle?: (
    expr: Expression,
    level: number
  ) => 'radical' | 'quotient' | 'solidus';

  fractionStyle?: (
    expr: Expression,
    level: number
  ) => 'quotient' | 'inline-solidus' | 'nice-solidus' | 'reciprocal' | 'factor';

  logicStyle?: (
    expr: Expression,
    level: number
  ) => 'word' | 'boolean' | 'uppercase-word' | 'punctuation';

  powerStyle?: (
    expr: Expression,
    level: number
  ) => 'root' | 'solidus' | 'quotient';

  numericSetStyle?: (
    expr: Expression,
    level: number
  ) => 'compact' | 'regular' | 'interval' | 'set-builder';
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
 * To customize the parsing and serializing of LaTeX syntax, create a `LatexSyntax`
 * instance.
 */
export declare class LatexSyntax<T extends number = number> {
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
        dictionary?: LatexDictionary;
      }
  );

  /**
   * Return a LaTeX dictionary suitable for the specified category, or `"all"`
   * for all categories (`"arithmetic"`, `"algebra"`, etc...).
   *
   * A LaTeX dictionary is needed to translate between LaTeX and MathJSON.
   *
   * Each entry in the dictionary indicate how a LaTeX token (or string of
   * tokens) should be parsed into a MathJSON expression.
   *
   * For example an entry can define that the `\pi` LaTeX token should map to the
   * symbol `"Pi"`, or that the token `-` should map to the function
   * `["Negate",...]` when in a prefix position and to the function
   * `["Subtract", ...]` when in an infix position.
   *
   * Furthermore, the information in each dictionary entry is used to serialize
   * the LaTeX string corresponding to a MathJSON expression.
   *
   * Use the value returned by this function to the `options` argument of the
   * constructor.
   */
  static getDictionary(
    domain?: DictionaryCategory | 'all'
  ): Readonly<LatexDictionary<any>>;

  parse(latex: LatexString): Expression<T>;
  serialize(expr: Expression<T>): LatexString;
}

export interface Serializer<T extends number = number> {
  readonly onError: ErrorListener<ErrorCode>;
  readonly options: Required<SerializeLatexOptions>;
  readonly computeEngine?: ComputeEngine;

  /** "depth" of the expression:
   * - 0 for the root
   * - 1 for the arguments of the root
   * - 2 for the arguments of the arguments of the root
   * - etc...
   *
   * This allows for variation of the LaTeX serialized based
   * on the depth of the expression, for example using `\Bigl(`
   * for the top level, and `\bigl(` or `(` for others.
   */
  level: number;

  /** Output a LaTeX string representing the expression */
  serialize: (expr: Expression<T> | null) => string;

  wrapString(s: string, style: 'paren' | 'leftright' | 'big' | 'none'): string;

  /** Add a group fence around the expression if it is
   * an operator of precedence less than or equal to `prec`.
   */

  wrap: (expr: Expression<T> | null, prec?: number) => string;

  /** Add a group fence around the expression if it is
   * short (not a function)
   */
  wrapShort(expr: Expression<T> | null): string;

  /** Styles */
  applyFunctionStyle: (
    expr: Expression,
    level: number
  ) => 'paren' | 'leftright' | 'big' | 'none';

  groupStyle: (
    expr: Expression,
    level: number
  ) => 'paren' | 'leftright' | 'big' | 'none';

  rootStyle: (
    expr: Expression,
    level: number
  ) => 'radical' | 'quotient' | 'solidus';

  fractionStyle: (
    expr: Expression,
    level: number
  ) => 'quotient' | 'inline-solidus' | 'nice-solidus' | 'reciprocal' | 'factor';

  logicStyle: (
    expr: Expression,
    level: number
  ) => 'word' | 'boolean' | 'uppercase-word' | 'punctuation';

  powerStyle: (
    expr: Expression,
    level: number
  ) => 'root' | 'solidus' | 'quotient';

  numericSetStyle: (
    expr: Expression,
    level: number
  ) => 'compact' | 'regular' | 'interval' | 'set-builder';
}

export type SerializerFunction<T extends number = number> = (
  serializer: Serializer<T>,
  expr: T | Expression<T>
) => string;

export interface Scanner<T extends number = number> {
  readonly onError: ErrorListener<ErrorCode>;
  readonly options: Required<ParseLatexOptions>;
  readonly computeEngine?: ComputeEngine;

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

  /** Return a LaTeX string before the index */
  latexBefore(): string;

  /** Return a LaTeX string after the index */
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

  matchTabular(): null | Expression<T>;

  applyOperator(
    op: string,
    lhs: Expression<T> | null,
    rhs: Expression<T> | null
  ): NonNullable<[Expression<T> | null, Expression<T> | null]>;
  applyInvisibleOperator(
    lhs: Expression<T> | null,
    rhs: Expression<T> | null
  ): Expression<T> | null;
  /** If the next tokens correspond to an optional argument,
   * enclosed with `[` and `]` return the content of the argument
   * as an expression and advance the index past the closing `]`.
   * Otherwise, return null
   */
  matchOptionalLatexArgument(): Expression<T> | null;
  matchRequiredLatexArgument(): Expression<T> | null;
  matchArguments(kind: '' | 'group' | 'implicit'): Expression<T>[] | null;

  matchSupsub(lhs: Expression<T> | null): Expression<T> | null;

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
  matchPrimary(minPrec?: number): Expression<T> | null;

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
  matchExpression(minPrec?: number): Expression<T> | null;

  matchBalancedExpression(
    open: LatexToken,
    close: LatexToken,
    onError?: ErrorListener<ErrorCode>
  ): Expression<T> | null;
}

/**
 * Parse a LaTeX string and return a corresponding MathJSON expression.
 *
 * @param onError - Called when a non-fatal error is encountered while parsing.
 * The parsing will attempt to recover and continue.
 *
 */
export declare function parse<T extends number = number>(
  latex: LatexString,
  options?: NumberFormattingOptions &
    ParseLatexOptions & {
      onError?: ErrorListener<ErrorCode>;
    }
): Expression<T>;

/**
 * Serialize a MathJSON expression as a LaTeX string.
 *
 */
export declare function serialize<T extends number = number>(
  expr: Expression<T>,
  options?: NumberFormattingOptions &
    SerializeLatexOptions & {
      dictionary?: Readonly<LatexDictionary<T>>;
      onError?: ErrorListener<ErrorCode>;
    }
): LatexString;
