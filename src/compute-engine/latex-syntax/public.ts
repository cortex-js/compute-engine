import { WarningSignalHandler } from '../../common/signals';
import { Expression } from '../../math-json/math-json-format';
import type { IComputeEngine } from '../public';

/**
 * A `LatexToken` is a token as returned by `Scanner.peek`.
 *
 * It can be one of the indicated tokens, or a string that starts with a
 * `\` for LaTeX commands, or a LaTeX character which includes digits,
 * letters and punctuation.
 */
export type LatexToken = string | '<{>' | '<}>' | '<space>' | '<$>' | '<$$>';

/** A LatexString is a regular string of LaTeX, for example:
 * `\frac{\pi}{2}`
 */
export type LatexString = string;

/**
 * Open and close delimiters that can be used with {@link MatchfixEntry}
 * record to define new LaTeX dictionary entries.
 */
export type Delimiter =
  | ')'
  | '('
  | ']'
  | '['
  | '{' /** \lbrace */
  | '}' /** \rbrace */
  | '<' /** \langle  */
  | '>' /** \rangle  */
  | '|'
  | '||'
  | '\\lceil'
  | '\\rceil'
  | '\\lfloor'
  | '\\rfloor';

export type LibraryCategory =
  | 'algebra'
  | 'arithmetic'
  | 'calculus'
  | 'collections'
  | 'control-structures'
  | 'combinatorics'
  | 'core'
  | 'data-structures'
  | 'dimensions'
  | 'domains'
  | 'linear-algebra'
  | 'logic'
  | 'numeric'
  | 'other'
  | 'physics'
  | 'polynomials'
  | 'relop'
  | 'sets'
  | 'statistics'
  | 'styling'
  | 'symbols'
  | 'trigonometry'
  | 'units';

/**
 * This indicates a condition under which parsing should stop:
 * - an operator of a precedence higher than specified has been encountered
 * - the last token has been reached
 * - or if a function is provided, the function returns true;
 */
export type Terminator = {
  minPrec: number;
  condition?: (parser: Parser) => boolean;
};

/**
 * Custom parsing handler.
 *
 * When invoked the scanner points right after the LaTeX fragment that triggered
 * this parsing handler.
 *
 * The scanner should be moved, by calling `scanner.next()` for every consumed
 * token.
 *
 * If it was in an infix or postfix context, `lhs` will represent the
 * left-hand side argument. In a prefix or matchfix context, `lhs` is `null`.
 *
 * In a superfix (^) or subfix (_) context (that is if the first token of the
 * trigger is `^` or `_`), lhs is `["Superscript", lhs, rhs]`
 * and `["Subscript", lhs, rhs]`, respectively.
 *
 * The handler should return `null` if the expression could not be parsed
 * (didn't match the syntax that was expected). The matching expression
 * otherwise.
 *
 */

export type EnvironmentParseHandler = (
  parser: Parser,
  reqArgs: Expression[],
  optArgs: Expression[]
) => Expression | null;

export type SymbolParseHandler = (parser: Parser) => Expression | null;

export type FunctionParseHandler = (parser: Parser) => Expression | null;

export type PostfixParseHandler = (
  parser: Parser,
  lhs: Expression
) => Expression | null;

export type PrefixParseHandler = (
  parser: Parser,
  until: Terminator
) => Expression | null;

export type InfixParseHandler = (
  parser: Parser,
  until: Terminator,
  lhs: Expression
) => Expression | null;

export type MatchfixParseHandler = (
  parser: Parser,
  body: Expression
) => Expression | null;

export type ParseHandler =
  | SymbolParseHandler
  | FunctionParseHandler
  | EnvironmentParseHandler
  | PostfixParseHandler
  | PrefixParseHandler
  | InfixParseHandler
  | MatchfixParseHandler;

export type LatexArgumentType =
  | '{expression}' /** A required math mode expression */
  | '[expression]' /** An optional math mode expression */
  | '{text}' /** A required expression in text mode */
  | '[text]' /** An optional expression in text mode */
  | '{unit}' /** A required unit expression, e.g. `3em` */
  | '[unit]' /** An optional unit expression, e.g. `3em` */
  | '{glue}' /** A required glue expression, e.g. `25 mu plus 3em ` */
  | '[glue]' /** An optional glue expression, e.g. `25 mu plus 3em ` */
  | '{string}' /** A required text string, terminated by a non-literal token */
  | '[string]' /** An optional text string, terminated by a non-literal token */
  | '{color}' /** A required color expression, e.g. `red` or `#00ff00` */
  | '[color]'; /** An optional color expression, e.g. `red` or `#00ff00` */

/**
 * Maps a string of LaTeX tokens to a function or symbol and vice-versa.
 *
 */

export type BaseEntry = {
  /**
   * Map a MathJSON function or symbol name to this entry.
   *
   * Each entry should have at least a `name` or a `parse` handler.
   *
   * An entry with no `name` cannot be serialized: the `name` is used to map
   * a MathJSON function or symbol name to the appropriate entry for serializing.
   * However, an entry with no `name` can be used to define a synonym (for example
   * for the symbol `\varnothing` which is a synonym for `\emptyset`).
   *
   * If not `parse` handler is provided, only the trigger is used to select this
   * entry. Otherwise, if the trigger of the entry matches the current
   * token, the `parse` handler is invoked.
   */
  name?: string;
  /**
   * The trigger is the set of tokens that will make this record eligible for
   * attempting to parse the stream and generate an expression. After the
   * trigger matches, the `parse` handler is called, if available.
   *
   * `matchfix` operators use `openDelimiter` and `closeDelimiter` instead.
   *
   */
  trigger?: LatexString | LatexToken[];

  /**
   * Transform an expression into a LaTeX string.
   * If no `serialize` handler is provided, the `trigger` property is used
   */
  serialize?: LatexString | SerializeHandler;
};

export type MatchfixEntry = BaseEntry & {
  kind: 'matchfix';
  /**
   * If `kind` is `'matchfix'`: the `closeDelimiter` and `openDelimiter`
   * property are required
   */
  openDelimiter?: Delimiter | LatexToken[];
  closeDelimiter?: Delimiter | LatexToken[];

  /** When invoked, the parser is pointing after the close delimiter.
   * The argument of the handler is the body, i.e. the content between
   * the open delimiter and the close delimiter.
   */
  parse: MatchfixParseHandler;
};

export type InfixEntry = BaseEntry & {
  /**
   * Infix position, with an operand before and an operand after: `a ⊛ b`.
   *
   * Example: `+`, `\times`.
   */
  kind: 'infix';

  /**
   * - **`both`**: a + b + c  +(a, b, c)
   * - **`left`**: a / b / c -> /(/(a, b), c)
   * - **`right`**: a = b = c -> =(a, =(b, c))
   * - **`non`**: a < b < c -> syntax error
   *
   * - a `both`-associative operator has an unlimited number of arguments
   * - a `left`, `right` or `non` associative operator has at most two arguments
   *
   */
  associativity?: 'right' | 'left' | 'non' | 'both';

  precedence?: number; // Priority

  /**
   */
  parse: string | InfixParseHandler;
};

export type PostfixEntry = BaseEntry & {
  /**
   * Postfix position, with an operand before: `a ⊛`
   *
   * Example: `!`.
   */
  kind: 'postfix';

  precedence?: number; // Priority

  parse: PostfixParseHandler;
};

export type PrefixEntry = BaseEntry & {
  /**
   * Prefix position, with an operand after: `⊛ a`
   *
   * Example: `-`, `\not`.
   */
  kind: 'prefix';
  precedence: number;

  parse: PrefixParseHandler;
};

/**
 * A LaTeX dictionary entry for an environment, that is a LaTeX
 * construct using `\begin{...}...\end{...}`.
 */
export type EnvironmentEntry = BaseEntry & {
  kind: 'environment';
  parse: EnvironmentParseHandler;
};

export type SymbolEntry = BaseEntry & {
  kind: 'symbol';

  /** Used for appropriate wrapping (i.e. when to surround it with parens) */
  precedence?: number;

  parse: Expression | SymbolParseHandler;
};

export type FunctionEntry = BaseEntry & {
  kind: 'function';

  /**
   * Indicate if this symbol can be followed by arguments.
   *
   * The presence of arguments will indicate that the arguments should be
   * applied to the symbol. Otherwise, the invisible operator is applied
   * to the symbol and the arguments.
   *
   * If `arguments` is `"group"`:
   *
   * "f(x)" -> `["f", "x"]`
   * "f x" -> `["Multiply", "f", "x"]`
   *
   * If `arguments` is `""`:
   *
   * "f(x)" -> `["Multiply", "f", "x"]`
   * "f x" -> `["Multiply", "f", "x"]`
   *
   * If `arguments` is `"implicit"` and the symbol is followed either
   * by a group or by a primary (prefix + symbol + subsupfix + postfix).
   * Used for trig functions. i.e. `\sin x` vs `\sin(x)`:
   *
   * "f(x)" -> `["f", "x"]`
   * "f x" -> `["f", "x"]`
   *
   */
  // arguments?: 'group' | 'implicit' | '';

  parse: Expression | FunctionParseHandler;
};

/**
 * A simple LaTeX dictionary entry, for example for a command like `\pi`.
 */
export type DefaultEntry = BaseEntry & {
  precedence?: number;
  parse?: Expression | SymbolParseHandler;
};

export type LatexDictionaryEntry =
  | DefaultEntry
  | MatchfixEntry
  | InfixEntry
  | PostfixEntry
  | PrefixEntry
  | SymbolEntry
  | FunctionEntry
  | EnvironmentEntry;

/** @internal */
export function isSymbolEntry(
  entry: LatexDictionaryEntry
): entry is SymbolEntry {
  return !('kind' in entry) || entry.kind === 'symbol';
}
/** @internal */
export function isFunctionEntry(
  entry: LatexDictionaryEntry
): entry is FunctionEntry {
  return !('kind' in entry) || entry.kind === 'function';
}
/** @internal */
export function isMatchfixEntry(
  entry: LatexDictionaryEntry
): entry is MatchfixEntry {
  return 'kind' in entry && entry.kind === 'matchfix';
}
/** @internal */
export function isInfixEntry(entry: LatexDictionaryEntry): entry is InfixEntry {
  return 'kind' in entry && entry.kind === 'infix';
}
/** @internal */
export function isPrefixEntry(
  entry: LatexDictionaryEntry
): entry is PrefixEntry {
  return 'kind' in entry && entry.kind === 'prefix';
}
/** @internal */
export function isPostfixEntry(
  entry: LatexDictionaryEntry
): entry is PostfixEntry {
  return 'kind' in entry && entry.kind === 'postfix';
}
/** @internal */
export function isEnvironmentEntry(
  entry: LatexDictionaryEntry
): entry is EnvironmentEntry {
  return 'kind' in entry && entry.kind === 'environment';
}

export type LatexDictionary = LatexDictionaryEntry[];

export type ParseLatexOptions = {
  /**
   * This function is invoked when a number is followed by a symbol,
   * an open delimiter or a function.
   *
   * If this function is set to `null`, the lhs and rhs are joined as a `Sequence`.
   *
   * If this function is set to `undefined` it behaves in the following way:
   * - a number followed by a numeric expression is considered as separated
   *  with an invisible multiplication sign, and the two are joined as
   *  ['Multiply', lhs, rhs].
   * - a number followed by a rational number is considered to be separated
   *  with an invisible plus, and the two are joined as ['Add', lhs,
   *
   * For example with `2\frac{3}{4}`: `["Add", 2, ["Divide", 3, 4]]`
   *
   */
  applyInvisibleOperator:
    | 'auto'
    | null
    | ((parser: Parser, lhs: Expression, rhs: Expression) => Expression | null);

  /**
   * If true, ignore space characters.
   *
   * **Default**: `true`
   *
   */
  skipSpace: boolean;

  /**
   * When an unknown LaTeX command is encountered, attempt to parse
   * any arguments it may have.
   *
   * For example, `\foo{x+1}` would produce `['\foo', ['Add', 'x', 1]]` if
   * this property is true, `['LatexSymbols', '\foo', '<{>', 'x', '+', 1, '<{>']`
   * otherwise.
   */
  parseArgumentsOfUnknownLatexCommands: boolean;

  /**
   * When a number is encountered, parse it.
   *
   * Otherwise, return each token making up the number (minus sign, digits,
   * decimal marker, etc...).
   *
   * **Default**: `true`
   */
  parseNumbers: boolean;

  /**
   * This handler is invoked when the parser encounter a set of tokens
   * at a position that could be a symbol or function.
   *
   * The `symbol` argument is one or more tokens.
   *
   * The handler can return:
   *
   * - `symbol` to indicate the string represent a constant or variable.
   *
   * - `function` to indicate the string is a function name. If an apply
   * function operator (typically, parentheses) follow, parse them as arguments
   * to the function.
   *
   * - `error`, an error condition is raised.
   */
  parseUnknownIdentifier: (
    symbol: string,
    parser: Parser
  ) => 'symbol' | 'function' | 'unknown';

  /**
   * If true, the expression will be decorated with the LaTeX
   * fragments corresponding to each elements of the expression.
   *
   * The top-level expression, that is the one returned by `parse()`, will
   * include the verbatim LaTeX input that was parsed. The sub-expressions
   * may contain a slightly different LaTeX, for example with consecutive spaces
   * replaced by one, with comments removed and with some low-level LaTeX
   * commands replaced, for example `\egroup` and `\bgroup`.
   *
   * **Default:** `false`
   */
  preserveLatex: boolean;
};

export type SerializeLatexOptions = {
  /**
   * LaTeX string used to render an invisible multiply, e.g. in '2x'.
   * Leave it empty to join the adjacent terms, or use `\cdot` to insert
   * a `\cdot` operator between them, i.e. `2\cdot x`.
   *
   * Empty by default.
   */
  invisibleMultiply: LatexString;

  /**
   * LaTeX string used for an invisible plus, e.g. in '1 3/4'.
   * Leave it empty to join the main number and the fraction, i.e. render it
   * as `1\frac{3}{4}`, or use `+` to insert a `+` operator between them, i.e.
   * `1+\frac{3}{4}`
   *
   * Empty by default.
   */
  invisiblePlus: LatexString;

  // @todo: consider invisibleApply?: string;

  /**
   * LaTeX string used for an explicit multiply operator,
   *
   * Default: `\times`
   */
  multiply: LatexString; // e.g. '\\times', '\\cdot'

  /**
   * When an expression contains the error expression `["Error", 'missing']`,
   * serialize it with this LaTeX string
   */
  missingSymbol: LatexString; // e.g. '\\placeholder{}'

  // Styles
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
};

export type NumberFormattingOptions = {
  precision: number;
  positiveInfinity: LatexString;
  negativeInfinity: LatexString;
  notANumber: LatexString;
  /**
   * A string representing the decimal marker, the string separating
   * the whole portion of a number from the fractional portion, i.e.
   * the '.' in '3.1415'.
   *
   * Some countries use a comma rather than a dot. In this case it is
   * recommended to use `"{,}"` as the marker: the surrounding brackets ensure
   * there is no additional gap after the comma.
   *
   * **Default**: `"."`
   */
  decimalMarker: LatexString;

  /**
   * A string representing the separator between groups of digits,
   * used to improve readability of numbers with lots of digits.
   *
   * If you change it to another value, be aware that this may lead to
   * unexpected results. For example, if changing it to `,` the expression
   * `\mathrm{Hypot}(1,2)` will parse as `["Hypot", 1.2]` rather than
   * `["Hypot", 1, 2]`.
   *
   * **Default**: `"\\,"` (thin space, 3/18mu) (Resolution 7 of the 1948 CGPM)
   */
  groupSeparator: LatexString;

  exponentProduct: LatexString;
  beginExponentMarker: LatexString;
  endExponentMarker: LatexString;
  notation: 'engineering' | 'auto' | 'scientific';
  truncationMarker: LatexString;
  beginRepeatingDigits: LatexString;
  endRepeatingDigits: LatexString;
  imaginaryUnit: LatexString;

  avoidExponentsInRange:
    | undefined
    | null
    | [negativeExponent: number, positiveExponent: number];
};

/**
 * To customize the parsing and serializing of LaTeX syntax, create a `LatexSyntax`
 * instance.
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
        onError?: WarningSignalHandler;
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
    domain?: LibraryCategory | 'all'
  ): Readonly<LatexDictionary>;

  parse(latex: LatexString): Expression;
  serialize(expr: Expression): LatexString;
}

export interface Serializer {
  readonly onError: WarningSignalHandler;
  readonly options: Required<SerializeLatexOptions>;
  // readonly computeEngine?: ComputeEngine;

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
  serialize: (expr: Expression | null) => string;

  wrapString(
    s: string,
    style: 'paren' | 'leftright' | 'big' | 'none',
    fence?: string
  ): string;

  /** A string with the arguments of expr fenced appropriately and separated by
   * commas.
   */
  wrapArguments(expr: Expression): string;

  /** Add a group fence around the expression if it is
   * an operator of precedence less than or equal to `prec`.
   */

  wrap: (expr: Expression | null, prec?: number) => string;

  /** Add a group fence around the expression if it is
   * short (not a function)
   */
  wrapShort(expr: Expression | null): string;

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

export type SerializeHandler = (
  serializer: Serializer,
  expr: Expression
) => string;

export interface Parser {
  readonly options: Required<ParseLatexOptions>;
  readonly computeEngine?: IComputeEngine;

  index: number;

  /** True if the last token has been reached */
  readonly atEnd: boolean;

  /** Return the next token, without advancing the index */
  readonly peek: LatexToken;

  /** Return true if the terminator condition is met */
  atTerminator(t: Terminator): boolean;

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

  addBoundary(boundary: LatexToken[]): void;
  removeBoundary(): void;
  matchBoundary(): boolean;
  boundaryError(msg: string | [string, ...Expression[]]): Expression;

  /** If the next token is a character, return it and advance the index
   * This includes plain characters (e.g. 'a', '+'...), characters
   * defined in hex (^^ and ^^^^), the `\char` and `\unicode` command.
   */
  matchChar(): string | null;

  /** Return a CSS color. Handle the various color formats supported by the
   * `xcolor` package.
   */
  matchColor(background?: boolean): string | null;

  /**
   * Return a LaTeX dimension.
   *
   */
  matchLatexDimension(): string | null;

  /** If the next token matches the target advance and return true. Otherwise
   * return false */
  match(tokens: LatexToken): boolean;
  matchAll(tokens: LatexToken | LatexToken[]): boolean;
  matchAny(tokens: LatexToken[]): LatexToken;
  matchSequence(tokens: LatexToken[]): LatexToken[];

  /** If the next token matches a `+` or `-` sign, return it and advance the index.
   * Otherwise return `''` and do not advance */
  matchOptionalSign(): string;

  matchDecimalDigits(): string;
  matchSignedInteger(): string;
  matchExponent(): string;
  matchNumber(): string;

  /** Parse a tabular environment, until `\end{endName}`
   */
  matchTabular(endName: string): null | Expression[][];

  applyInvisibleOperator(
    terminator: Terminator,
    lhs: Expression | null
  ): Expression | null;

  /** If the next tokens correspond to an optional LaTeX argument,
   * enclosed with `[` and `]` return the content of the argument
   * as an expression and advance the index past the closing `]`.
   *
   * Otherwise, return `null`.
   */

  matchOptionalLatexArgument(): Expression | null;

  /**
   * Match a required LaTeX argument:
   * - either enclosed in `{}`
   * - or a single token (except if token is in `excluding`)
   *
   * The `excluding` option is useful to fail early when encountering a likely
   * syntax error, for example `x^(2)` (instead of `x^{2}`). With `(` in the list
   * of excluded tokens, the match will fail and the error can be recovered.
   *
   * If none is provided, `excluding` is `!"#$%&(),/;:?@[]`|~", `\left` and `\bigl`
   *
   *
   * Return null if no argument was found
   * Return `['Sequence']` if an empty argument `{}` was found
   */
  matchRequiredLatexArgument(excluding?: string[]): Expression | null;

  /**
   * Same as above, but if the argument is not there return a missing element.
   */
  missingIfEmptyRequiredLatexArgument(): Expression;

  /**
   * If the expression is an empty sequence or null, return a missing element.
   * Unlike missingIfEmpty from math-json/utils, this function will add latex and
   * sourceOffsets if enabled.
   */
  missingIfEmpty(expr: Expression | null): Expression;

  /**
   * - 'enclosure' : will look for an argument inside an enclosure (an open/close fence)
   * - 'implicit': either an expression inside a pair of `()`, or just a primary
   *    (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)
   */
  matchArguments(kind: '' | 'implicit' | 'enclosure'): Expression[] | null;

  matchStringArgument(): string | null;

  /** If matches the normalized open delimiter, returns the
   * expected closing delimiter.
   *
   * For example, if `openDelim` is `(`, and `closeDelim` is `)` it would match
   * `\left\lparen` and return `['\right', '\rparen']`, which can be matched
   * with `matchAll()`
   */
  matchOpenDelimiter(
    openDelim: Delimiter,
    closeDelim: Delimiter
  ): LatexToken[] | null;

  matchMiddleDelimiter(delimiter: '|' | ':' | LatexToken): boolean;

  /**
   *  Match a sequence superfix/subfix operator, e.g. `^{*}`
   *
   * Superfix and subfix need special handling:
   *
   * - they act mostly like an infix operator, but they are commutative, i.e.
   * `x_a^b` should be parsed identically to `x^b_a`.
   *
   * - furthermore, in LaTeX `x^a^b` parses the same as `x^a{}^b`.
   *
   */
  matchSupsub(lhs: Expression | null): Expression | null;

  /**
   *
   * ```
   *    <primary> :=
   *       (<number> | <symbol> | <latex-command> | <function-call> | <matchfix-expr>)
   *       (<subsup> | <postfix-operator>)*
   * ```
   *
   * ```
   *    <matchfix-expr> :=
   *        <matchfix-op-open> <expression> <matchfix-op-close>
   *```
   *
   *```
   *    <function-call> ::=
   *      | <function><matchfix-op-group-open><expression>[',' <expression>]<matchfix-op-group-close>
   *```
   * If not a primary, return `null` and do not advance the index.
   */
  matchPrimary(): Expression | null;

  /**
   * A symbol can be:
   * - a single-letter variable: `x`
   * - a single LaTeX command: `\pi`
   */
  matchSymbol(): Expression | null;

  /**
   * Parse an expression:
   *
   * ```
   * <expression> ::=
   *  | <prefix-op> <expression>
   *  | <primary>
   *  | <primary> <infix-op> <expression>
   * ```
   *
   * This is the top-level parsing entry point.
   *
   * Stop when an operator of precedence less than `until.minPrec`
   * or the sequence of tokens `until.tokens` is encountered
   *
   * `until` is `{ minPrec:0 }` by default.
   */
  matchExpression(until?: Partial<Terminator>): Expression | null;

  /** Return an error expression with the specified code and arguments */
  error(
    code: string | [string, ...Expression[]],
    fromToken: number
  ): Expression;
}
