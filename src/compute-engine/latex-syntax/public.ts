import type { Expression } from '../../math-json/math-json-format';

export type SymbolType = 'symbol' | 'function' | 'unknown';

export type SymbolTable = {
  parent: SymbolTable | null;
  ids: { [id: string]: SymbolType };
};

/**
 * A `LatexToken` is a token as returned by `Parser.peek`.
 *
 * It can be one of the indicated tokens, or a string that starts with a
 * `\` for LaTeX commands, or a LaTeX character which includes digits,
 * letters and punctuation.
 *
 * @category Latex Parsing and Serialization
 */
export type LatexToken = string | '<{>' | '<}>' | '<space>' | '<$>' | '<$$>';

/** A LatexString is a regular string of LaTeX, for example:
 * `\frac{\pi}{2}`
 *
 * @category Latex Parsing and Serialization
 */
export type LatexString = string;

/**
 * Open and close delimiters that can be used with {@linkcode MatchfixEntry}
 * record to define new LaTeX dictionary entries.
 *
 * @category Latex Parsing and Serialization
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
  | '\\rfloor'
  | '\\llbracket'
  | '\\rrbracket';

/** @category Latex Parsing and Serialization */
export type DelimiterScale = 'normal' | 'scaled' | 'big' | 'none';

/**
 * @category Latex Parsing and Serialization
 */
export type LibraryCategory =
  | 'algebra'
  | 'arithmetic'
  | 'calculus'
  | 'collections'
  | 'control-structures'
  | 'combinatorics'
  | 'complex'
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
 *
 * :::info[THEORY OF OPERATIONS]
 *
 * The precedence of an operator is a number that indicates the order in which
 * operators are applied.
 *
 * For example, in `1 + 2 * 3`, the `*` operator has a **higher** precedence
 * than the `+` operator, so it is applied first.
 *
 * The precedence range from 0 to 1000. The larger the number, the higher the
 * precedence, the more "binding" the operator is.
 *
 * Here are some rough ranges for the precedence:
 *
 * - 800: prefix and postfix operators: `\lnot` etc...
 *    - `POSTFIX_PRECEDENCE` = 810: `!`, `'`
 * - 700: some arithmetic operators
 *    - `EXPONENTIATION_PRECEDENCE` = 700: `^`
 * - 600: some binary operators
 *    - `DIVISION_PRECEDENCE` = 600: `\div`
 * - 500: not used
 * - 400: not used
 * - 300: some logic and arithmetic operators:
 *        `\land`, `\lor`, `\times`, etc...
 *   - `MULTIPLICATION_PRECEDENCE` = 390: `\times`
 * - 200: arithmetic operators, inequalities:
 *   - `ADDITION_PRECEDENCE` = 275: `+` `-`
 *   - `ARROW_PRECEDENCE` = 270: `\to` `\rightarrow`
 *   - `ASSIGNMENT_PRECEDENCE` = 260: `:=`
 *   - `COMPARISON_PRECEDENCE` = 245: `\lt` `\gt`
 *   - 241: `\leq`
 * - 100: not used
 * - 0: `,`, `;`, etc...
 *
 * Some constants are defined below for common precedence values.
 *
 *
 * **Note**: MathML defines
 * [some operator precedence](https://www.w3.org/TR/2009/WD-MathML3-20090924/appendixc.html),
 * but it has some issues and inconsistencies. However,
 * whenever possible we adopted the MathML precedence.
 *
 * The JavaScript operator precedence is documented
 * [here](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence).
 *
 * :::
 *
 * @category Latex Parsing and Serialization
 */
export type Precedence = number;

// > < >= ≥ <= ≤ == === ≡ != ≠ !== ≢ ∈ ∉ ∋ ∌ ⊆ ⊈ ⊂ ⊄ ⊊ ∝ ∊ ∍ ∥ ∦ ∷ ∺ ∻ ∽ ∾ ≁ ≃ ≂ ≄ ≅ ≆ ≇ ≈ ≉ ≊ ≋ ≌ ≍ ≎ ≐ ≑ ≒ ≓ ≖ ≗ ≘ ≙ ≚ ≛ ≜ ≝ ≞ ≟ ≣ ≦ ≧ ≨ ≩ ≪ ≫ ≬ ≭ ≮ ≯ ≰ ≱ ≲ ≳ ≴ ≵ ≶ ≷ ≸ ≹ ≺ ≻ ≼ ≽ ≾ ≿ ⊀ ⊁ ⊃ ⊅ ⊇ ⊉ ⊋ ⊏ ⊐ ⊑ ⊒ ⊜ ⊩ ⊬ ⊮ ⊰ ⊱ ⊲ ⊳ ⊴ ⊵ ⊶ ⊷ ⋍ ⋐ ⋑ ⋕ ⋖ ⋗ ⋘ ⋙ ⋚ ⋛ ⋜ ⋝ ⋞ ⋟ ⋠ ⋡ ⋢ ⋣ ⋤ ⋥ ⋦ ⋧ ⋨ ⋩ ⋪ ⋫ ⋬ ⋭ ⋲ ⋳ ⋴ ⋵ ⋶ ⋷ ⋸ ⋹ ⋺ ⋻ ⋼ ⋽ ⋾ ⋿ ⟈ ⟉ ⟒ ⦷ ⧀ ⧁ ⧡ ⧣ ⧤ ⧥ ⩦ ⩧ ⩪ ⩫ ⩬ ⩭ ⩮ ⩯ ⩰ ⩱ ⩲ ⩳ ⩵ ⩶ ⩷ ⩸ ⩹ ⩺ ⩻ ⩼ ⩽ ⩾ ⩿ ⪀ ⪁ ⪂ ⪃ ⪄ ⪅ ⪆ ⪇ ⪈ ⪉ ⪊ ⪋ ⪌ ⪍ ⪎ ⪏ ⪐ ⪑ ⪒ ⪓ ⪔ ⪕ ⪖ ⪗ ⪘ ⪙ ⪚ ⪛ ⪜ ⪝ ⪞ ⪟ ⪠ ⪡ ⪢ ⪣ ⪤ ⪥ ⪦ ⪧ ⪨ ⪩ ⪪ ⪫ ⪬ ⪭ ⪮ ⪯ ⪰ ⪱ ⪲ ⪳ ⪴ ⪵ ⪶ ⪷ ⪸ ⪹ ⪺ ⪻ ⪼ ⪽ ⪾ ⪿ ⫀ ⫁ ⫂ ⫃ ⫄ ⫅ ⫆ ⫇ ⫈ ⫉ ⫊ ⫋ ⫌ ⫍ ⫎ ⫏ ⫐ ⫑ ⫒ ⫓ ⫔ ⫕ ⫖ ⫗ ⫘ ⫙ ⫷ ⫸ ⫹ ⫺ ⊢ ⊣ ⟂ ⫪ ⫫ <: >:
/** @hidden */
export const COMPARISON_PRECEDENCE: Precedence = 245;

// := $= = += -= −= *= /= //= |\\=| ^= ÷= %= <<= >>= >>>= |\|=| &= ⊻= ≔ ⩴ ≕
/** @hidden */
export const ASSIGNMENT_PRECEDENCE: Precedence = 260;

// Unicode U+2190 to U+2950:
// ← → ↔ ↚ ↛ ↞ ↠ ↢ ↣ ↦ ↤ ↮ ⇎ ⇍ ⇏ ⇐ ⇒ ⇔ ⇴ ⇶ ⇷ ⇸ ⇹ ⇺ ⇻ ⇼ ⇽ ⇾ ⇿ ⟵ ⟶ ⟷ ⟹ ⟺ ⟻ ⟼ ⟽ ⟾ ⟿ ⤀ ⤁ ⤂ ⤃ ⤄ ⤅ ⤆ ⤇ ⤌ ⤍ ⤎ ⤏ ⤐ ⤑ ⤔ ⤕ ⤖ ⤗ ⤘ ⤝ ⤞ ⤟ ⤠ ⥄ ⥅ ⥆ ⥇ ⥈ ⥊ ⥋ ⥎ ⥐ ⥒ ⥓ ⥖ ⥗ ⥚ ⥛ ⥞ ⥟ ⥢ ⥤ ⥦ ⥧ ⥨ ⥩ ⥪ ⥫ ⥬ ⥭ ⥰
// More:
// ⧴ ⬱ ⬰ ⬲ ⬳ ⬴ ⬵ ⬶ ⬷ ⬸ ⬹ ⬺ ⬻ ⬼ ⬽ ⬾ ⬿ ⭀ ⭁ ⭂ ⭃ ⥷ ⭄ ⥺ ⭇ ⭈ ⭉ ⭊ ⭋ ⭌ ￩ ￫ ⇜ ⇝ ↜ ↝ ↩ ↪ ↫ ↬ ↼ ↽ ⇀ ⇁ ⇄ ⇆ ⇇ ⇉ ⇋ ⇌ ⇚ ⇛ ⇠ ⇢ ↷ ↶ ↺ ↻ --> <-- <--> <==>
//
// See unicode.ts for equivalent LaTeX commands
/** @hidden */
export const ARROW_PRECEDENCE: Precedence = 270;

// + - − ¦ |\|| ⊕ ⊖ ⊞ ⊟ |++| ∪ ∨ ⊔ ± ∓ ∔ ∸ ≏ ⊎ ⊻ ⊽ ⋎ ⋓ ⟇ ⧺ ⧻ ⨈ ⨢ ⨣ ⨤ ⨥ ⨦ ⨧ ⨨ ⨩ ⨪ ⨫ ⨬ ⨭ ⨮ ⨹ ⨺ ⩁ ⩂ ⩅ ⩊ ⩌ ⩏ ⩐ ⩒ ⩔ ⩖ ⩗ ⩛ ⩝ ⩡ ⩢ ⩣)
/** @hidden */
export const ADDITION_PRECEDENCE: Precedence = 275;
// * / ⌿ ÷ % & · · ⋅ ∘ × |\\| ∩ ∧ ⊗ ⊘ ⊙ ⊚ ⊛ ⊠ ⊡ ⊓ ∗ ∙ ∤ ⅋ ≀ ⊼ ⋄ ⋆ ⋇ ⋉ ⋊ ⋋ ⋌ ⋏ ⋒ ⟑ ⦸ ⦼ ⦾ ⦿ ⧶ ⧷ ⨇ ⨰ ⨱ ⨲ ⨳ ⨴ ⨵ ⨶ ⨷ ⨸ ⨻ ⨼ ⨽ ⩀ ⩃ ⩄ ⩋ ⩍ ⩎ ⩑ ⩓ ⩕ ⩘ ⩚ ⩜ ⩞ ⩟ ⩠ ⫛ ⊍ ▷ ⨝ ⟕ ⟖ ⟗ ⨟
/** @hidden */
export const MULTIPLICATION_PRECEDENCE: Precedence = 390;

// Rational, Divide
/** @hidden */
export const DIVISION_PRECEDENCE: Precedence = 600;

// Power, Square, Overscript
/** @hidden */
export const EXPONENTIATION_PRECEDENCE: Precedence = 700;

// Factorial, Prime
/** @hidden */
export const POSTFIX_PRECEDENCE: Precedence = 810;

/**
 * This indicates a condition under which parsing should stop:
 * - an operator of a precedence higher than specified has been encountered
 * - the last token has been reached
 * - or if a condition is provided, the condition returns true
 *
 * @category Latex Parsing and Serialization
 */
export type Terminator = {
  minPrec: Precedence;
  condition?: (parser: Parser) => boolean;
};

/**
 * Custom parsing handler.
 *
 * When invoked the parser points right after the LaTeX fragment that triggered
 * this parsing handler.
 *
 * The parser should be moved, by calling `parser.nextToken()` for
 * every consumed token.
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
 * @category Latex Parsing and Serialization
 */
export type ExpressionParseHandler = (
  parser: Parser,
  until?: Readonly<Terminator>
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
export type PrefixParseHandler = (
  parser: Parser,
  until?: Readonly<Terminator>
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
export type SymbolParseHandler = (
  parser: Parser,
  until?: Readonly<Terminator>
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
export type FunctionParseHandler = (
  parser: Parser,
  until?: Readonly<Terminator>
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
export type EnvironmentParseHandler = (
  parser: Parser,
  until?: Readonly<Terminator>
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
export type PostfixParseHandler = (
  parser: Parser,
  lhs: Expression,
  until?: Readonly<Terminator>
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
export type InfixParseHandler = (
  parser: Parser,
  lhs: Expression,
  until: Readonly<Terminator>
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
export type MatchfixParseHandler = (
  parser: Parser,
  body: Expression
) => Expression | null;

/**
 * @category Latex Parsing and Serialization
 */
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
 * A trigger is the set of tokens that will make an entry in the
 * LaTeX dictionary eligible to parse the stream and generate an expression.
 * If the trigger matches, the `parse` handler is called, if available.
 *
 * The trigger can be specified either as a LaTeX string (`latexTrigger`) or
 * as an identifier (`identifierTrigger`). An identifier match several
 * LaTeEx expressions that are equivalent, for example `\operatorname{gcd}` or
 *  `\mathbin{gcd}`, match the `"gcd"` identifier
 *
 * `matchfix` operators use `openTrigger` and `closeTrigger` instead.
 *
 * @category Latex Parsing and Serialization
 */

export type Trigger = {
  latexTrigger?: LatexString | LatexToken[];
  identifierTrigger?: string;
};

/**
 * Maps a string of LaTeX tokens to a function or symbol and vice-versa.
 * @category Latex Parsing and Serialization
 */

export type BaseEntry = {
  /**
   * Map a MathJSON identifier to this entry.
   *
   * Each entry should have at least a `name` or a `parse` handler.
   *
   * An entry with no `name` cannot be serialized: the `name` is used to map
   * a MathJSON function or symbol name to the appropriate entry for
   * serializing.
   *
   * However, an entry with no `name` can be used to define a synonym (for
   * example for the symbol `\varnothing` which is a synonym for `\emptyset`).
   *
   * If no `parse` handler is provided, only the trigger is used to select this
   * entry. Otherwise, if the trigger of the entry matches the current
   * token, the `parse` handler is invoked.
   */
  name?: string;

  /**
   * Transform an expression into a LaTeX string.
   * If no `serialize` handler is provided, the trigger is used.
   */
  serialize?: LatexString | SerializeHandler;
};

/**
 * @category Latex Parsing and Serialization
 */
export type DefaultEntry = BaseEntry &
  Trigger & {
    parse: Expression | ExpressionParseHandler;
  };

/**
 * @category Latex Parsing and Serialization
 */
export type ExpressionEntry = BaseEntry &
  Trigger & {
    kind: 'expression'; // Default entry is "expression"

    parse: Expression | ExpressionParseHandler;

    precedence?: Precedence;
  };

/**
 * @category Latex Parsing and Serialization
 */
export type MatchfixEntry = BaseEntry & {
  kind: 'matchfix';
  /**
   * If `kind` is `'matchfix'`: the `openTrigger` and `closeTrigger`
   * properties are required.
   */
  openTrigger: Delimiter | LatexToken[];
  closeTrigger: Delimiter | LatexToken[];

  /** When invoked, the parser is pointing after the close delimiter.
   * The argument of the handler is the body, i.e. the content between
   * the open delimiter and the close delimiter.
   */
  parse?: MatchfixParseHandler;
};

/**
 * @category Latex Parsing and Serialization
 */
export type InfixEntry = BaseEntry &
  Trigger & {
    /**
     * Infix position, with an operand before and an operand after: `a ⊛ b`.
     *
     * Example: `+`, `\times`.
     */
    kind: 'infix';

    /**
     * - **`none`**: a ? b ? c -> syntax error
     * - **`any`**: a + b + c -> +(a, b, c)
     * - **`left`**: a / b / c -> /(/(a, b), c)
     * - **`right`**: a = b = c -> =(a, =(b, c))
     *
     * - `any`-associative operators have an unlimited number of arguments
     * - `left`, `right` or `none` associative operators have two arguments
     *
     */
    associativity?: 'right' | 'left' | 'none' | 'any';

    precedence?: Precedence;

    parse?: string | InfixParseHandler;
  };

/**
 * @category Latex Parsing and Serialization
 */
export type PostfixEntry = BaseEntry &
  Trigger & {
    /**
     * Postfix position, with an operand before: `a ⊛`
     *
     * Example: `!`.
     */
    kind: 'postfix';

    precedence?: Precedence;

    parse?: string | PostfixParseHandler;
  };

/**
 * @category Latex Parsing and Serialization
 */
export type PrefixEntry = BaseEntry &
  Trigger & {
    /**
     * Prefix position, with an operand after: `⊛ a`
     *
     * Example: `-`, `\not`.
     */
    kind: 'prefix';
    precedence: Precedence;

    parse?: string | PrefixParseHandler;
  };

/**
 * A LaTeX dictionary entry for an environment, that is a LaTeX
 * construct using `\begin{...}...\end{...}`.
 * @category Latex Parsing and Serialization
 */
export type EnvironmentEntry = BaseEntry & {
  kind: 'environment';
  parse: EnvironmentParseHandler;
  identifierTrigger: string;
};

/**
 * @category Latex Parsing and Serialization
 */
export type SymbolEntry = BaseEntry &
  Trigger & {
    kind: 'symbol';

    /** Used for appropriate wrapping (i.e. when to surround it with parens) */
    precedence?: Precedence;

    parse: Expression | SymbolParseHandler;
  };

/**
 * A function is an identifier followed by:
 * - some postfix operators such as `\prime`
 * - an optional list of arguments in an enclosure (parentheses)
 *
 * For more complex situations, for example implicit arguments or
 * inverse functions postfix (i.e. ^{-1}), use a custom parse handler with a
 * entry of kind `expression`.
 * @category Latex Parsing and Serialization
 */
export type FunctionEntry = BaseEntry &
  Trigger & {
    kind: 'function';
    parse?: Expression | FunctionParseHandler;
  };

/**
 *
 * A dictionary entry is a record that maps a LaTeX token or string of tokens
 * ( a trigger) to a MathJSON expression or to a parsing handler.
 *
 * Set the {@linkcode ComputeEngine.latexDictionary} property to an array of
 * dictionary entries to define custom LaTeX parsing and serialization.
 *
 * @category Latex Parsing and Serialization
 *
 */
export type LatexDictionaryEntry =
  | DefaultEntry
  | ExpressionEntry
  | MatchfixEntry
  | InfixEntry
  | PostfixEntry
  | PrefixEntry
  | SymbolEntry
  | FunctionEntry
  | EnvironmentEntry;

/** @internal */
export function isExpressionEntry(
  entry: LatexDictionaryEntry
): entry is ExpressionEntry {
  return !('kind' in entry) || entry.kind === 'expression';
}

/** @internal */
export function isSymbolEntry(
  entry: LatexDictionaryEntry
): entry is SymbolEntry {
  return 'kind' in entry && entry.kind === 'symbol';
}
/** @internal */
export function isFunctionEntry(
  entry: LatexDictionaryEntry
): entry is FunctionEntry {
  return 'kind' in entry && entry.kind === 'function';
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

/**
 * A LaTeX dictionary is a collection of LaTeX dictionary entries.
 *
 * Each entry in the dictionary indicates how to parse and serialize a
 * particular LaTeX token or string of tokens.
 *
 * @category Latex Parsing and Serialization
 * @internal
 */
export type LatexDictionary = ReadonlyArray<Partial<LatexDictionaryEntry>>;

/**
 * These options control how numbers are parsed and serialized.
 */
export type NumberFormat = {
  positiveInfinity: LatexString;
  negativeInfinity: LatexString;
  notANumber: LatexString;
  imaginaryUnit: LatexString;
  // @todo: percent: LatexString;

  /**
   * A string representing the decimal separator, the string separating
   * the whole portion of a number from the fractional portion, i.e.
   * the "." in "3.1415".
   *
   * Some countries use a comma rather than a dot. In this case it is
   * recommended to use `"{,}"` as the separator: the surrounding brackets
   * ensure there is no additional gap after the comma.
   *
   * **Default**: `"."`
   */
  decimalSeparator: LatexString;

  /**
   * A string representing the separator between groups of digits,
   * to make numbers with many digits easier to read.
   *
   * If a single string is provided, it is used to group digits in the
   * whole and the fractional part of the number. If two strings are provided,
   * the first is used for the whole part and the second for the fractional
   * part.
   *
   * Caution: some values may lead to unexpected results.
   *
   * For example, if the `digitGroupSeparator` is `,` (comma) the expression
   * `\operatorname{Hypot}(1,2)` will parse as `["Hypot", 1.2]` rather than
   * `["Hypot", 1, 2]`. You can however use `{,}` which will avoid this issue
   * and display with correct spacing.
   *
   * **Default**: `"\\,"` (thin space, 3/18mu) (Resolution 7 of the 1948 CGPM)
   */
  digitGroupSeparator: LatexString | [LatexString, LatexString];

  /**
   * Maximum length of digits between digit group separators.
   *
   * If a single number is provided, it is used for the whole and the fractional
   * part of the number. If two numbers are provided, the first is used for the
   * whole part and the second for the fractional part.
   *
   * If '`"lakh"`' is provided, the number is grouped in groups of 2 digits,
   * except for the last group which has 3 digits. For example: `1,00,00,000`.
   *
   *
   * **Default**: `3`
   */
  digitGroup: 'lakh' | number | [number | 'lakh', number];

  exponentProduct: LatexString;
  beginExponentMarker: LatexString;
  endExponentMarker: LatexString;

  truncationMarker: LatexString;

  repeatingDecimal:
    | 'auto'
    | 'vinculum'
    | 'dots'
    | 'parentheses'
    | 'arc'
    | 'none';
};

export type NumberSerializationFormat = NumberFormat & {
  /**
   * The maximum number of significant digits in serialized numbers.
   * - `"max"`: all availabe digits are serialized.
   * - `"auto"`: use the same precision as the compute engine.
   *
   * Default: `"auto"`
   */
  fractionalDigits: 'auto' | 'max' | number;
  notation: 'auto' | 'engineering' | 'scientific'; // @todo: add | 'percent'
  avoidExponentsInRange:
    | undefined
    | null
    | [negativeExponent: number, positiveExponent: number];
};

/**
 *
 * The LaTeX parsing options can be used with the `ce.parse()` method.
 *
 * @category Latex Parsing and Serialization
 */

export type ParseLatexOptions = NumberFormat & {
  /**
   * If true, ignore space characters in math mode.
   *
   * **Default**: `true`
   *
   */
  skipSpace: boolean;

  /**
   * When parsing a decimal number, e.g. `3.1415`:
   *
   * - `"auto"` or `"decimal"`: if a decimal number, parse it as an approximate
   *   decimal number with a whole part and a fractional part
   * - `"rational"`: if a decimal number, parse it as an exact rational number
   *   with a numerator  and a denominator. If not a decimal number, parse
   *   it as a regular number.
   * - `"never"`: do not parse numbers, instead return each token making up
   *  the number (minus sign, digits, decimal marker, etc...).
   *
   * Note: if the number includes repeating digits (e.g. `1.33(333)`),
   * it will be parsed as a decimal number even if this setting is `"rational"`.
   *
   * **Default**: `"auto"`
   *
   */
  parseNumbers: 'auto' | 'rational' | 'decimal' | 'never';

  /**
   * This handler is invoked when the parser encounters an identifier
   * that has not yet been declared.
   *
   * The `identifier` argument is a (valid identifier)[/math-json/#identifiers].
   *
   * The handler can return:
   *
   * - `"variable"`: the identifier is a variable
   * - `"function"`: the identifier is a function name. If an apply
   * function operator (typically, parentheses) follow, they will be parsed
   * as arguments to the function.
   *
   * - `"unknown"`: the identifier is not recognized.
   */
  getIdentifierType: (identifier: string) => SymbolType;

  /** This handler is invoked when the parser encounters an unexpected token.
   *
   * The `lhs` argument is the left-hand side of the token, if any.
   *
   * The handler can access the unexpected token with `parser.peek`. If
   * it is a token that should be recognized, the handler can consume it
   * by calling `parser.nextToken()`.
   *
   * The handler should return an expression or `null` if the token is not
   * recognized.
   */
  parseUnexpectedToken: (
    lhs: Expression | null,
    parser: Parser
  ) => Expression | null;

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

/**
 *
 * The expected format of numbers in the LaTeX string can be specified with
 * the `ce.parse()` method.
 *
 * @category Latex Parsing and Serialization
 */

/**
 * An instance of `Parser` is provided to the `parse` handlers of custom
 * LaTeX dictionary entries.
 *
 * @category Latex Parsing and Serialization
 */

export interface Parser {
  readonly options: Required<ParseLatexOptions>;

  getIdentifierType(id: string): SymbolType;

  pushSymbolTable(): void;

  popSymbolTable(): void;

  addSymbol(id: string, type: SymbolType): void;

  /** The index of the current token */
  index: number;

  /** True if the last token has been reached.
   * Consider also `atTerminator()`.
   */
  readonly atEnd: boolean;

  /** Return true if the terminator condition is met or if the last token
   * has been reached.
   */
  atTerminator(t: Terminator | undefined): boolean;

  /** Return the next token, without advancing the index */
  readonly peek: LatexToken;

  /** Return the next token and advance the index */
  nextToken(): LatexToken;

  /** Return a string representation of the expression
   * between `start` and `end` (default: the whole expression)
   *
   *
   */
  latex(start: number, end?: number): string;

  /** Return an error expression with the specified code and arguments */
  error(
    code: string | [string, ...Expression[]],
    fromToken: number
  ): Expression;

  /** If there are any space, advance the index until a non-space is encountered */
  skipSpace(): boolean;

  /** Skip over "visual space" which
  includes space tokens, empty groups `{}`, and commands such as `\,` and `\!` */
  skipVisualSpace(): void;

  /** If the next token matches the target advance and return true. Otherwise
   * return false
   */
  match(token: LatexToken): boolean;

  /** Return true if the next tokens match the argument, an array of tokens, or null otherwise
   */
  matchAll(tokens: LatexToken[]): boolean;

  /** Return the next token if it matches any of the token in the argument or null otherwise
   */
  matchAny(tokens: LatexToken[]): LatexToken;

  /** If the next token is a character, return it and advance the index
   * This includes plain characters (e.g. 'a', '+'...), characters
   * defined in hex (^^ and ^^^^), the `\char` and `\unicode` command.
   */
  matchChar(): string | null;

  /**
   * Parse an expression in aLaTeX group enclosed in curly brackets `{}`.
   * These are often used as arguments to LaTeX commands, for example
   * `\frac{1}{2}`.
   *
   * Return `null` if none was found
   * Return `['Sequence']` if an empty group `{}` was found
   */
  parseGroup(): Expression | null;

  /**
   * Some LaTeX commands (but not all) can accept arguments as single
   * tokens (i.e. without braces), for example `^2`, `\sqrt3` or `\frac12`
   *
   * This argument will usually be a single token, but can be a sequence of
   * tokens (e.g. `\sqrt\frac12` or `\sqrt\operatorname{speed}`).
   *
   * The following tokens are excluded from consideration in order to fail
   * early when encountering a likely syntax error, for example `x^(2)`
   * instead of `x^{2}`. With `(` in the list of excluded tokens, the
   * match will fail and the error can be recovered.
   *
   * The excluded tokens include `!"#$%&(),/;:?@[]`|~", `\left`, `\bigl`, etc...
   */
  parseToken(): Expression | null;

  /**
   * Parse an expression enclosed in a LaTeX optional group enclosed in square brackets `[]`.
   *
   * Return `null` if none was found.
   */
  parseOptionalGroup(): Expression | null;

  /**
   * Some LaTeX commands have arguments that are not interpreted as
   * expressions, but as strings. For example, `\begin{array}{ccc}` (both
   * `array` and `ccc` are strings), `\color{red}` or `\operatorname{lim sup}`.
   *
   * If the next token is the start of a group (`{`), return the content
   * of the group as a string. This may include white space, and it may need
   * to be trimmed at the start and end of the string.
   *
   * LaTeX commands are typically not allowed inside a string group (for example,
   * `\alpha` would result in an error), but we do not enforce this.
   *
   * If `optional` is true, this should be an optional group in square brackets
   * otherwise it is a regular group in braces.
   */
  parseStringGroup(optional?: boolean): string | null;

  /**
   * A symbol can be:
   * - a single-letter identifier: `x`
   * - a single LaTeX command: `\pi`
   * - a multi-letter identifier: `\operatorname{speed}`
   */
  parseSymbol(until?: Partial<Terminator>): Expression | null;

  /**
   * Parse an expression in a tabular format, where rows are separated by `\\`
   * and columns by `&`.
   *
   * Return rows of sparse columns: empty rows are indicated with `Nothing`,
   * and empty cells are also indicated with `Nothing`.
   */
  parseTabular(): null | Expression[][];

  /**
   * Parse an argument list, for example: `(12, x+1)` or `\left(x\right)`
   *
   * - 'enclosure' : will look for arguments inside an enclosure
   *    (an open/close fence) (**default**)
   * - 'implicit': either an expression inside a pair of `()`, or just a primary
   *    (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)
   *
   * Return an array of expressions, one for each argument, or `null` if no
   * argument was found.
   */
  parseArguments(
    kind?: 'implicit' | 'enclosure',
    until?: Terminator
  ): Expression[] | null;

  /**
   * Parse a postfix operator, such as `'` or `!`.
   *
   * Prefix, infix and matchfix operators are handled by `parseExpression()`
   *
   */

  parsePostfixOperator(
    lhs: Expression | null,
    until?: Partial<Terminator>
  ): Expression | null;

  /**
   * Parse an expression:
   *
   * ```
   * <expression> ::=
   *  | <primary> ( <infix-op> <expression> )?
   *  | <prefix-op> <expression>
   *
   * <primary> :=
   *   (<number> | <symbol> | <function-call> | <matchfix-expr>)
   *   (<subsup> | <postfix-operator>)*
   *
   * <matchfix-expr> :=
   *   <matchfix-op-open> <expression> <matchfix-op-close>
   *
   * <function-call> ::=
   *   | <function><matchfix-op-group-open><expression>[',' <expression>]<matchfix-op-group-close>
   * ```
   *
   * This is the top-level parsing entry point.
   *
   * Stop when an operator of precedence less than `until.minPrec`
   * or the sequence of tokens `until.tokens` is encountered
   *
   * `until` is `{ minPrec:0 }` by default.
   */
  parseExpression(until?: Partial<Terminator>): Expression | null;

  /**
   * Parse a number.
   */
  parseNumber(): Expression | null;

  /**
   * Boundaries are used to detect the end of an expression.
   *
   * They are used for unusual syntactic constructs, for example
   * `\int \sin x dx` where the `dx` is not an argument to the `\sin`
   * function, but a boundary of the integral.
   *
   * They are also useful when handling syntax errors and recovery.
   *
   * For example, `\begin{bmatrix} 1 & 2 { \end{bmatrix}` has an
   * extraneous `{`, but the parser will attempt to recover and continue
   * parsing when it encounters the `\end{bmatrix}` boundary.
   */
  addBoundary(boundary: LatexToken[]): void;
  removeBoundary(): void;
  get atBoundary(): boolean;
  matchBoundary(): boolean;
  boundaryError(msg: string | [string, ...Expression[]]): Expression;
}

/**
 *
 * The LaTeX serialization options can used with the `expr.toLatex()` method.
 *
 * @category Latex Parsing and Serialization
 */

export type SerializeLatexOptions = NumberSerializationFormat & {
  /**
   * If true, prettify the LaTeX output.
   *
   * For example, render `\frac{a}{b}\frac{c}{d}` as `\frac{ac}{bd}`
   *
   */
  prettify: boolean;

  /**
   * LaTeX string used to render an invisible multiply, e.g. in '2x'.
   *
   * If empty, both operands are concatenated, i.e. `2x`.
   *
   * Use `\cdot` to insert a `\cdot` operator between them, i.e. `2 \cdot x`.
   *
   * Empty by default.
   */
  invisibleMultiply: LatexString;

  /**
   * LaTeX string used to render [mixed numbers](https://en.wikipedia.org/wiki/Fraction#Mixed_numbers) e.g. '1 3/4'.
   *
   * Leave it empty to join the main number and the fraction, i.e. render it
   * as `1\frac{3}{4}`.
   *
   * Use `+` to insert an explicit `+` operator between them,
   *  i.e. `1+\frac{3}{4}`
   *
   * Empty by default.
   */
  invisiblePlus: LatexString;

  /**
   * LaTeX string used to render an explicit multiply operator.
   *
   * For example, `\times`, `\cdot`, etc...
   *
   * Default: `\times`
   */
  multiply: LatexString;

  /**
   * Serialize the expression `["Error", "'missing'"]`,  with this LaTeX string
   *
   */
  missingSymbol: LatexString; // e.g. '\\placeholder{}'

  // Styles
  applyFunctionStyle: (expr: Expression, level: number) => DelimiterScale;

  groupStyle: (expr: Expression, level: number) => DelimiterScale;

  rootStyle: (
    expr: Expression,
    level: number
  ) => 'radical' | 'quotient' | 'solidus';

  fractionStyle: (
    expr: Expression,
    level: number
  ) =>
    | 'quotient'
    | 'block-quotient'
    | 'inline-quotient'
    | 'inline-solidus'
    | 'nice-solidus'
    | 'reciprocal'
    | 'factor';

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

/**
 *
 * An instance of `Serializer` is provided to the `serialize` handlers of custom
 * LaTeX dictionary entries.
 *
 * @category Latex Parsing and Serialization
 *
 */
export interface Serializer {
  readonly options: Required<SerializeLatexOptions>;

  /** "depth" of the expression:
   * - 0 for the root
   * - 1 for a subexpression of the root
   * - 2 for subexpressions of the subexpressions of the root
   * - etc...
   *
   * This allows the serialized LaTeX to vary depending on the depth of the
   * expression.
   *
   * For example use `\Bigl(` for the top level, and `\bigl(` or `(` for others.
   */
  level: number;

  /** Output a LaTeX string representing the expression */
  serialize: (expr: Expression | null) => string;

  serializeFunction(expr: Expression): LatexString;

  serializeSymbol(expr: Expression): LatexString;

  /** Output `s` surrounded by delimiters.
   *
   * If `delimiters` is not specified, use `()`
   *
   */
  wrapString(
    s: LatexString,
    style: DelimiterScale,
    delimiters?: string
  ): LatexString;

  /** A string with the arguments of expr fenced appropriately and separated by
   * commas.
   */
  wrapArguments(expr: Expression): LatexString;

  /** Add a group fence around the expression if it is
   * an operator of precedence less than or equal to `prec`.
   */
  wrap: (expr: Expression | null, prec?: number) => LatexString;

  /** Add a group fence around the expression if it is
   * short (not a function)
   */
  wrapShort(expr: Expression | null): LatexString;

  /** Styles */
  applyFunctionStyle: (expr: Expression, level: number) => DelimiterScale;

  groupStyle: (expr: Expression, level: number) => DelimiterScale;

  rootStyle: (
    expr: Expression,
    level: number
  ) => 'radical' | 'quotient' | 'solidus';

  fractionStyle: (
    expr: Expression,
    level: number
  ) =>
    | 'quotient'
    | 'block-quotient'
    | 'inline-quotient'
    | 'inline-solidus'
    | 'nice-solidus'
    | 'reciprocal'
    | 'factor';

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

/** The `serialize` handler of a custom LaTeX dictionary entry can be
 * a function of this type.
 *
 * @category Latex Parsing and Serialization
 *
 */
export type SerializeHandler = (
  serializer: Serializer,
  expr: Expression
) => string;
