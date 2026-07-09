import { DiagnosticMessage } from './diagnostics.js';

/**
 * The set of token types produced by the Cortex {@link Lexer}.
 *
 * This is the initial (Phase 1) set. The lexer emits a single `OPERATOR`
 * type: it maximal-munches a run of operator characters but does **not**
 * classify the operator or assign precedence — that is the job of the Phase 2
 * shared operator table.
 */
export type TokenType =
  // Literals
  | 'NUMBER' // Raw numeric literal (digits kept as written, see below)
  | 'SYMBOL' // Identifier / symbol name
  | 'VERBATIM_SYMBOL' // Backtick-delimited symbol: `a+b`
  | 'STRING' // Composite string (see `parts`)
  // Directives
  | 'PRAGMA' // `#name` (the argument clause, if any, is separate tokens)
  | 'SHEBANG' // `#!...` on the first line only
  // Operators & punctuation
  | 'OPERATOR' // Maximal munch of operator characters (e.g. `===`, `->`)
  | 'OPEN_PAREN'
  | 'CLOSE_PAREN'
  | 'OPEN_BRACKET'
  | 'CLOSE_BRACKET'
  | 'OPEN_BRACE'
  | 'CLOSE_BRACE'
  | 'COMMA'
  | 'SEMICOLON'
  // Islands
  | 'LATEX_ISLAND' // `$...$` (lexed here, consumed in Phase 2)
  // Special
  | 'EOF'
  | 'ERROR'; // An invalid character run — the lexer never throws

/**
 * A raw source span, used for the interpolation holes of a {@link STRING}
 * token (`\(…)`) and for the inner content of a {@link LATEX_ISLAND}.
 *
 * `start`/`end` are offsets into the original source (half-open: the slice is
 * `source.slice(start, end)`). The parser re-parses this span, offset-shifted,
 * so diagnostics inside it get correct positions.
 */
export interface SourceSpan {
  start: number;
  end: number;
}

/**
 * A segment of a composite string token.
 *
 * - A `string` is a **cooked** text segment: escape sequences have already
 *   been resolved and (for multiline strings) indentation stripped and line
 *   breaks normalized to `\n`.
 * - A {@link SourceSpan} is the raw span of a `\(…)` interpolation hole (the
 *   expression source between the parentheses), to be parsed later.
 */
export type StringPart = string | SourceSpan;

/**
 * A doc comment (`/// …` or `/** … *\/`) recorded as trivia.
 *
 * Doc comments are skipped like ordinary comments (they do not appear in the
 * token stream) but are attached to the following token so a later phase can
 * associate documentation with a declaration. Nothing consumes them in
 * Phase 1.
 */
export interface DocComment {
  /** Raw source slice of the comment, including its delimiters. */
  text: string;
  start: number;
  end: number;
}

export interface Token {
  type: TokenType;

  /**
   * Raw source slice for this token (`source.slice(start, end)`).
   *
   * For `NUMBER` tokens the digits are kept exactly as written (including
   * `_` separators, leading zeros, and the radix prefix). No `parseFloat`
   * round-trip happens in the lexer — the parser converts the text to a
   * MathJSON `{num}` preserving full precision.
   */
  text: string;

  /** Offset in the source of the first character of the token. */
  start: number;
  /** Offset in the source just past the last character of the token. */
  end: number;

  /**
   * `true` if whitespace and/or comments immediately preceded this token.
   * Load-bearing later for the infix-operator whitespace rule and for
   * sign-vs-infix `+`/`-` disambiguation in Phase 2.
   */
  precededByWhitespace: boolean;

  /** `true` if a line break was part of the trivia preceding this token. */
  precededByLinebreak: boolean;

  /**
   * For `STRING` tokens: the cooked text segments interleaved with the raw
   * spans of `\(…)` interpolation holes. See {@link StringPart}.
   */
  parts?: StringPart[];

  /**
   * For `LATEX_ISLAND` tokens: the span of the inner LaTeX content (between
   * the `$` delimiters).
   */
  island?: SourceSpan;

  /**
   * For `VERBATIM_SYMBOL` tokens: the cooked symbol name (backticks removed,
   * escape sequences resolved).
   */
  value?: string;

  /**
   * Diagnostics attached to this token.
   *
   * The lexer never throws. Two kinds of lexical problems are represented:
   *
   * - A wholly unrecognizable character run becomes an `ERROR` token whose
   *   `diagnostics` explain why.
   * - A recognizable-but-malformed token (an unterminated string, an invalid
   *   escape sequence, an unbalanced verbatim symbol, an unterminated block
   *   comment, …) keeps its semantic token type but carries the diagnostics
   *   here, mirroring the old "error result still produced a value" model.
   *
   * The parser stage collects these into the returned `ParsingDiagnostic[]`.
   */
  diagnostics?: DiagnosticMessage[];

  /** Doc comments recorded in the trivia immediately before this token. */
  docComments?: DocComment[];
}
