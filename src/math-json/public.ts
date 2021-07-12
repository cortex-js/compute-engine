import { ComputeEngine } from './compute-engine-interface';
import { Expression } from './math-json-format';

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

export type Delimiter =
  | ')'
  | '('
  | ']'
  | '['
  | '{' // \lbrace
  | '<' // \langle
  | '>' // \rangle
  | '}' // \rbrace
  | '|'
  | '||'
  | '\\lceil'
  | '\\lfloor'
  | '\\rceil'
  | '\\rfloor';

export type DictionaryCategory =
  | 'algebra'
  | 'arithmetic'
  | 'calculus'
  | 'collections'
  | 'combinatorics'
  | 'core'
  | 'dimensions'
  | 'domains'
  | 'inequalities'
  | 'linear-algebra'
  | 'logic'
  | 'numeric'
  | 'other'
  | 'physics'
  | 'polynomials'
  | 'relations'
  | 'sets'
  | 'statistics'
  | 'symbols'
  | 'trigonometry'
  | 'units';

export type RuntimeSignalCode =
  | 'timeout'
  | 'out-of-memory'
  | 'recursion-depth-exceeded'
  | 'iteration-limit-exceeded';

export type SignalCode =
  | RuntimeSignalCode
  | (
      | 'syntax-error'
      | 'invalid-name'
      | 'expected-predicate'
      | 'expected-symbol'
      | 'operator-requires-one-operand'
      | 'postfix-operator-requires-one-operand'
      | 'prefix-operator-requires-one-operand'
      | 'unbalanced-symbols'
      | 'expected-argument'
      | 'unexpected-command'
      | 'cyclic-definition' // arg: [cycle]
      | 'invalid-supersets' // arg: [superset-domain]
      | 'expected-supersets'
      | 'unknown-domain' // arg: [domain]
      | 'duplicate-wikidata' // arg: [wikidata]
      | 'invalid-dictionary-entry' // arg: [error]
    );

export type SignalMessage = SignalCode | [SignalCode, ...any[]];

export type SignalOrigin = {
  url?: string;
  source?: string;
  offset?: number;
  line?: number;
  column?: number;
  around?: string;
};

export type Signal = {
  severity?: 'warning' | 'error';

  /** An error/warning code or, a code with one or more arguments specific to
   * the signal code.
   */
  message: SignalMessage;

  /** If applicable, the head of the function about which the
   * signal was raised
   */
  head?: string;

  /** Location where the signal was raised. */
  origin?: SignalOrigin;
};

export type ErrorSignal = Signal & {
  severity: 'error';
};

export declare class CortexError extends Error {
  constructor(errorSignal: Signal);
  toString(): string;
}

export type WarningSignal = Signal & {
  severity: 'warning';
};

export type ErrorSignalHandler = (error: ErrorSignal | WarningSignal) => void;
export type WarningSignalHandler = (warnings: WarningSignal[]) => void;

/**
 * * `unknown-symbol`: a symbol was encountered which does not have a
 * definition.
 *
 * * `unknown-operator`: a presumed operator was encountered which does not
 * have a definition.
 *
 * * `unknown-function`: a LaTeX command was encountered which does not
 * have a definition.
 *
 * * `unexpected-command`: a LaTeX command was encountered when only a string
 * was expected
 *
 * * `unexpected-superscript`: a superscript was encountered in an unexpected
 * context, or no `powerFunction` was defined. By default, superscript can
 * be applied to numbers, symbols or expressions, but not to operators (e.g.
 * `2+^34`) or to punctuation.
 *
 * * `unexpected-subscript`: a subscript was encountered in an unexpected
 * context or no 'subscriptFunction` was defined. By default, subscripts
 * are not expected on numbers, operators or symbols. Some commands (e.g. `\sum`)
 * do expected a subscript.
 *
 * * `unexpected-sequence`: some adjacent elements were encountered (for
 * example `xy`), but no `invisibleOperator` is defined, therefore the elements
 * can't be combined. The default `invisibleOperator` is `multiply`, but you
 * can also use `list`.
 *
 * * `expected-argument`: a LaTeX command that requires one or more argument
 * was encountered without the required arguments.
 *
 * * `expected-operand`: an operator was encountered without its required
 * operands.
 *
 * * `non-associative-operator`: an operator which is not associative was
 * encountered in an associative context, for example: `a < b < c` (assuming
 * `<` is defined as non-associative)
 *
 * * `postfix-operator-requires-one-operand`: a postfix operator which requires
 * a single argument was encountered with no arguments or more than one argument
 *
 * * `prefix-operator-requires-one-operand`: a prefix operator which requires
 * a single argument was encountered with no arguments or more than one argument
 *
 * * `base-out-of-range`:  The base is expected to be between 2 and 36.
 *
 */
export type ErrorCode =
  | 'expected-argument'
  | 'unexpected-argument'
  | 'expected-operator'
  | 'expected-operand'
  | 'invalid-name'
  | 'invalid-dictionary-entry'
  | 'unknown-symbol'
  | 'unknown-operator'
  | 'unknown-function'
  | 'unknown-command'
  | 'unexpected-command'
  | 'unbalanced-symbols'
  | 'unexpected-superscript'
  | 'unexpected-subscript'
  | 'unexpected-sequence'
  | 'non-associative-operator'
  | 'function-has-too-many-arguments'
  | 'function-has-too-few-arguments'
  | 'operator-requires-one-operand'
  | 'infix-operator-requires-two-operands'
  | 'prefix-operator-requires-one-operand'
  | 'postfix-operator-requires-one-operand'
  | 'associative-function-has-too-few-arguments'
  | 'commutative-function-has-too-few-arguments'
  | 'threadable-function-has-too-few-arguments'
  | 'hold-first-function-has-too-few-arguments'
  | 'hold-rest-function-has-too-few-arguments'
  | 'base-out-of-range'
  | 'syntax-error';

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
 * In a superfix (^) or subfix (_) context (that is if the first token of the
 * trigger is `^` or `_`), lhs is `["Superscript", lhs, rhs]`
 * and `["Subscript", lhs, rhs]`, respectively.
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
) => [lhs: Expression<T> | null, result: Expression<T> | null];

/**
 * Maps a string of LaTeX tokens to a function or symbol and vice-versa.
 *
 */
export type LatexDictionaryEntry<T extends number = number> = {
  /**
   * Map a MathJSON function or symbol name to this entry.
   *
   * Each entry should have at least a `name` or a `parse` property.
   *
   * An entry with no `name` cannot be serialized: the `name` is used to map
   * a MathJSON function or symbol name to the appropriate entry for serializing.
   * However, an entry with no `name` defines a parsing synonym (for example
   * for the symbol `\varnothing` which is a synonym for `\emptyset`).
   *
   * If not `parse` property is provided, only the trigger is used to select this
   * entry. Otherwise, the if the trigger of the entry matches the current
   * token, the `parse` function is invoked.
   */
  name?: string;

  /**
   * The trigger is the set of tokens that will make this record eligible for
   * attempting to parse the stream and generate an expression. After the
   * trigger matches, the `parse` function is called, if available.
   *
   * `matchfix` operators use `openDelimiter` and `closeDelimiter` instead.
   *
   */
  trigger?: LatexString | LatexToken[];

  /**
   * The kind of entry. If none is provided, `symbol` is assumed.
   *
   * Infix position, with an operand before and an operand after: `a ⊛ b`.
   *
   * Example: `+`, `\times`
   *
   * Prefix position, with an operand after: `⊛ a`
   *
   * Example: `-`, `\not`
   *
   * Postfix position, with an operand before: `a ⊛`
   *
   * Example: `!`
   *
   * The name of an environment, as used in `\begin{matrix}` where
   * `"matrix"` is the name of the environment.
   */
  kind?: 'symbol' | 'matchfix' | 'infix' | 'prefix' | 'postfix' | 'environment';

  /**
   * If the current token matches the `trigger` for this entry
   * the `parse` method is used to produce a matching `Expression`.
   *
   * When the `parse` method is called (if the kind is different than
   * `matchfix`), the scanner is pointing to the token right after the trigger.
   *
   * The context can be considered in the parse method, for example by checking
   * the domain of the left-hand-side expression, or the current precedence
   * level. A rhs expression can be tentatively scanned for,  for example by
   * calling `scanner.matchExpression()`.
   *
   * If the match is not successful, parse should return `[lhs, null]`
   *
   * For example, the `\times` command distinguishes being applied to two
   * numbers (in which case it's the `Multiply` function) or to two sets
   * (in which case it's the `CartesianProduct` function).
   *
   * For `matchfix` kind, the `parse` function is called after the trigger
   * (the open delimiter), 0 or more expressions (separated by `separator`)
   * and the closing delimiter have been scanned. The `lhs` argument is the
   * expressions in between the open and close delimiter. If multiple expressions,
   * it is passed as a `['Sequence',...]`.
   *
   * If the `parse` property is a string, it's a shorthand for the parse method
   * `(lhs) => [lhs, parse]`.
   *
   * If the `parse` property is not provided, the `name` is used instead as the
   * result of the parsing when the trigger matches.
   */
  parse?: Expression | ParserFunction<T>;

  /**
   * Transform an expression into a LaTeX string.
   * If no `serialize` property is provided, the trigger is used
   */
  serialize?: SerializerFunction<T> | LatexString;

  /**
   * If `kind` is `'infix'``
   * - **`both`**: a + b + c -> +(a, b, c)
   * - **`left`**: a / b / c -> /(/(a, b), c)
   * - **`right`**: a = b = c -> =(a, =(b, c))
   * - **`non`**: a < b < c -> syntax error
   *
   * - a `both`-associative operator has an unlimited number of arguments
   * - a `left`, `right` or `non` associative operator has at most two arguments
   *
   * Applicable if not a symbol.
   */
  associativity?: 'right' | 'left' | 'non' | 'both';

  /** Applies to `infix`, `symbol` (used for correct wrapping) */
  precedence?: number; // Priority

  /**
   * If `kind` is `'symbol'``.
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
   * If `kind` is `'symbol'``.
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
   * If `kind` is `'symbol'``.
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
   * If `kind` is `'matchfix'`: the `closeDelimiter` and `trigger` property are
   * required
   */
  openDelimiter?: Delimiter | LatexToken[];
  closeDelimiter?: Delimiter | LatexToken[];
};

export type LatexDictionary<T extends number = number> =
  LatexDictionaryEntry<T>[];

export type ParseLatexOptions<T extends number = number> = {
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
  applyInvisibleOperator?:
    | 'auto'
    | null
    | ((lhs: Expression<T>, scanner: Scanner<T>) => Expression<T> | null);

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
   * The `parseUnknownToken`  function is invoked when a token (`a`,
   * `\alpha`...) is encountered at a position where a symbol or a function
   * could be parsed.
   *
   * If it returns `symbol` or `function`, the token is interpreted as a symbol
   * or function, respectively.
   *
   * If a `function` and the token is followed by an apply function operator
   * (typically, parentheses), parse them as arguments to the function.
   *
   * If `skip`, the token is skipped as if it was not present. This is
   * convenient for purely presentational commands, such as `\displaystyle`.
   *
   * If `error`, an error condition is raised.
   */
  parseUnknownToken?: (
    token: LatexToken,
    scanner: Scanner
  ) => 'symbol' | 'function' | 'skip' | 'error';

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
  positiveInfinity?: LatexString;
  negativeInfinity?: LatexString;
  notANumber?: LatexString;
  /**
   * A string representing the decimal marker, the string separating
   * the whole portion of a number from the fractional portion, i.e.
   * the '.' in '3.1415'.
   *
   * Some countries use a comma rather than a dot. In this case it is
   * recommended to use `"{,}""` as the marker: the surrounding bracket ensure
   * there is no additional gap after the comma.
   *
   * Default: `"."`
   */
  decimalMarker?: LatexString;

  /**
   * A string representing the separator between groups of digits,
   * used to improve readability of numbers with lots of digits.
   *
   * If you change it to another value, be aware that this may lead to
   * unexpected results. For example, if changing it to `,` the expression
   * `x_{1,2}` will parse as `x` with a subscript of `1.2`, rather than `x`
   * with two subscripts, `1` and `2`.
   *
   * Default: `"\\,"` (thin space, 3/18mu) (Resolution 7 of the 1948 CGPM)
   */

  groupSeparator?: LatexString;
  exponentProduct?: LatexString;
  beginExponentMarker?: LatexString;
  endExponentMarker?: LatexString;
  notation?: 'engineering' | 'auto' | 'scientific';
  truncationMarker?: LatexString;
  beginRepeatingDigits?: LatexString;
  endRepeatingDigits?: LatexString;
  imaginaryNumber?: LatexString;
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
    domain?: DictionaryCategory | 'all'
  ): Readonly<LatexDictionary<any>>;

  parse(latex: LatexString): Expression<T>;
  serialize(expr: Expression<T>): LatexString;
}

export interface Serializer<T extends number = number> {
  readonly onError: WarningSignalHandler;
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
  readonly onError: WarningSignalHandler;
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

  applyInvisibleOperator(
    lhs: Expression<T> | null,
    scanner: Scanner<T>
  ): Expression<T> | null;

  /** If the next tokens correspond to an optional LaTeX argument,
   * enclosed with `[` and `]` return the content of the argument
   * as an expression and advance the index past the closing `]`.
   * Otherwise, return `null`.
   */
  matchOptionalLatexArgument(): Expression<T> | null;
  matchRequiredLatexArgument(): Expression<T> | null;
  /**
   * 'group' : will look for an argument inside a pair of `()`
   * 'implicit': either an expression inside a pair of `()`, or just a primary
   *  (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)
   */
  matchArguments(kind: '' | 'group' | 'implicit'): Expression<T>[] | null;

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
}
