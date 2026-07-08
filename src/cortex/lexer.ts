import {
  DIGITS,
  HEX_DIGITS,
  REVERSED_ESCAPED_CHARS,
  isWhitespace,
  isLinebreak,
  isBreak,
  isIdentifierStartProhibited,
  isIdentifierContinueProhibited,
  codePointLength,
} from './characters';
import { DiagnosticMessage } from './diagnostics';
import { DocComment, SourceSpan, StringPart, Token, TokenType } from './tokens';

//
// The Cortex lexer turns a source string into a flat `Token[]`.
//
// It is modeled structurally on `src/common/type/lexer.ts`: a character
// cursor (`pos`) with `cp`/`advance`/maximal-munch helpers and a `Lexer` class
// producing a token array. The Cortex lexer is richer (composite strings,
// pragmas, `$…$` islands) but the skeleton reads like that file.
//
// It **never throws**. Two kinds of lexical problems are surfaced:
//   - a wholly unrecognizable character run becomes an `ERROR` token; and
//   - a recognizable-but-malformed token (unterminated string, invalid escape,
//     unbalanced verbatim symbol, unterminated block comment, …) keeps its
//     semantic type and carries `diagnostics`.
// The number-scanning and string-scanning logic is ported from the old
// combinator library's numeric and string parsers (the combinator wrappers are
// stripped; only the character-level scanning remains).
//
// ─── Decisions settled during implementation (see the phase plan) ───────────
//
// • Fullwidth digits (U+FF10–FF19) are SUPPORTED. The shared `DIGITS`/
//   `HEX_DIGITS` tables imported from `characters.ts` already include them, and
//   the Cortex docs (`literals.md`/`syntax.md`) accept them, so `１２３` lexes
//   as one `NUMBER` token. The token `text` preserves the fullwidth glyphs as
//   written; the parser normalizes later. Dropping support would mean building
//   an ASCII-only table, contradicting the "reuse the shared tables"
//   instruction — so we keep it.
//
// • Leading unary signs are NOT folded into number tokens. `+`/`-` lex as
//   `OPERATOR` tokens; the parser resolves sign-vs-infix in Phase 2 using the
//   `precededByWhitespace` flag (as the token model was explicitly designed
//   to). Only the *internal* exponent sign (`1e-2`, `0xFp+1`) is part of a
//   number, matching the ported scanner. This keeps the lexer context-free.
//
// • `ERROR` tokens cover a maximal *run* of consecutive unrecognizable
//   characters (one token per run, not per character) — coarser but fewer
//   diagnostics.
//
// • Lex errors are represented as `Token.diagnostics` (a `DiagnosticMessage[]`),
//   plus the `ERROR` token type for unlexable runs. There is no diagnostic sink
//   in the lexer, so the parser stage harvests `token.diagnostics`.
//

// Frequently used code points, for readability.
const TAB = 0x09;
const SPACE = 0x20;
const QUOTE = 0x22; // "
const HASH = 0x23; // #
const DOLLAR = 0x24; // $
const LPAREN = 0x28; // (
const RPAREN = 0x29; // )
const PLUS = 0x2b; // +
const COMMA = 0x2c; // ,
const MINUS = 0x2d; // -
const DOT = 0x2e; // .
const SLASH = 0x2f; // /
const SEMICOLON = 0x3b; // ;
const BANG = 0x21; // !
const LBRACKET = 0x5b; // [
const BACKSLASH = 0x5c; // \
const RBRACKET = 0x5d; // ]
const BACKTICK = 0x60; // `
const LBRACE = 0x7b; // {
const RBRACE = 0x7d; // }
const STAR = 0x2a; // *
const UNDERSCORE = 0x5f; // _
const LBRACE_ESCAPE = 0x7b; // { (unicode escape)
const RBRACE_ESCAPE = 0x7d; // }

// Characters that may appear in an operator. The lexer maximal-munches a run
// of these into a single `OPERATOR` token; it does NOT classify the operator
// or assign precedence (Phase 2). Comment sequences (`//`, `/*`) and the
// number/string/bracket starters are handled before this set is consulted, so
// including `/` here is safe.
const OPERATOR_CHARS = new Set(
  [...'+-*/^=<>!&|~:?%'].map((c) => c.codePointAt(0)!)
);

export class Lexer {
  readonly source: string;
  private pos = 0;
  private tokens: Token[] = [];

  // Trivia state for the token currently being produced. Refreshed by
  // `scanTrivia()` and consumed by `makeToken()`.
  private _precededByWhitespace = false;
  private _precededByLinebreak = false;
  private _docComments: DocComment[] = [];

  constructor(source: string) {
    this.source = source;
  }

  //
  // ─── Cursor helpers ───────────────────────────────────────────────────────
  //

  /** Code point at `pos + offset` (offset in UTF-16 units), or -1 past EOF. */
  private cp(offset = 0): number {
    return this.source.codePointAt(this.pos + offset) ?? -1;
  }

  /** Code point at an absolute index `i`, or -1 past EOF. */
  private codeAt(i: number): number {
    return this.source.codePointAt(i) ?? -1;
  }

  private atEnd(): boolean {
    return this.pos >= this.source.length;
  }

  private atLinebreak(): boolean {
    return this.pos < this.source.length && isLinebreak(this.cp());
  }

  private skipInlineSpaces(): void {
    while (this.cp() === SPACE || this.cp() === TAB) this.pos += 1;
  }

  private skipLinebreak(): void {
    const c = this.cp();
    if (c === 0x0d) {
      this.pos += 1;
      if (this.cp() === 0x0a) this.pos += 1;
    } else if (c === 0x0a) {
      this.pos += 1;
      if (this.cp() === 0x0d) this.pos += 1;
    } else if (c === 0x2028 || c === 0x2029) {
      this.pos += 1;
    }
  }

  //
  // ─── Top-level ────────────────────────────────────────────────────────────
  //

  tokenize(): Token[] {
    this.tokens = [];

    // A shebang is only recognized at the very start of the source.
    if (this.cp(0) === HASH && this.cp(1) === BANG) {
      const start = this.pos;
      this.skipUntilLinebreak();
      this.tokens.push(this.makeToken('SHEBANG', start));
    }

    while (true) {
      const errToken = this.scanTrivia();
      if (errToken) {
        this.tokens.push(errToken);
        // An unterminated block comment consumed to EOF; loop once more to emit
        // the EOF token.
        continue;
      }
      if (this.atEnd()) {
        this.tokens.push(this.makeToken('EOF', this.pos));
        break;
      }
      this.tokens.push(this.scanToken());
    }

    return this.tokens;
  }

  private makeToken(
    type: TokenType,
    start: number,
    extra?: Partial<Token>
  ): Token {
    const token: Token = {
      type,
      text: this.source.slice(start, this.pos),
      start,
      end: this.pos,
      precededByWhitespace: this._precededByWhitespace,
      precededByLinebreak: this._precededByLinebreak,
      ...extra,
    };
    if (this._docComments.length > 0) {
      token.docComments = this._docComments;
      this._docComments = [];
    }
    return token;
  }

  //
  // ─── Trivia (whitespace + comments) ───────────────────────────────────────
  //

  /**
   * Consume whitespace and comments, recording the `precededBy*` flags and any
   * doc comments for the next token.
   *
   * Returns an `ERROR` token if an unterminated block comment is encountered
   * (consumed to EOF); otherwise `null`.
   */
  private scanTrivia(): Token | null {
    this._precededByWhitespace = false;
    this._precededByLinebreak = false;
    this._docComments = [];

    while (!this.atEnd()) {
      const c = this.cp();

      if (isWhitespace(c)) {
        if (isLinebreak(c)) this._precededByLinebreak = true;
        this._precededByWhitespace = true;
        this.pos += codePointLength(c);
        continue;
      }

      // Line comment: `//` (ordinary) or `///` (doc)
      if (c === SLASH && this.cp(1) === SLASH) {
        this._precededByWhitespace = true;
        const start = this.pos;
        const isDoc = this.cp(2) === SLASH;
        this.skipUntilLinebreak();
        if (isDoc)
          this._docComments.push({
            text: this.source.slice(start, this.pos),
            start,
            end: this.pos,
          });
        continue;
      }

      // Block comment: `/* … */` (nested) or `/** … */` (doc)
      if (c === SLASH && this.cp(1) === STAR) {
        this._precededByWhitespace = true;
        const start = this.pos;
        const isDoc = this.cp(2) === STAR && this.cp(3) !== SLASH;
        const closed = this.skipBlockComment();
        if (!closed) {
          return this.makeToken('ERROR', start, {
            diagnostics: ['end-of-comment-expected'],
          });
        }
        if (isDoc)
          this._docComments.push({
            text: this.source.slice(start, this.pos),
            start,
            end: this.pos,
          });
        continue;
      }

      break;
    }
    return null;
  }

  /** Advance to (but not past) the next linebreak, or to EOF. */
  private skipUntilLinebreak(): void {
    while (!this.atEnd() && !isLinebreak(this.cp()))
      this.pos += codePointLength(this.cp());
  }

  /** At `/*`. Returns true if the (possibly nested) comment was closed. */
  private skipBlockComment(): boolean {
    this.pos += 2; // consume `/*`
    let level = 1;
    while (level > 0 && !this.atEnd()) {
      const c = this.cp();
      if (c === SLASH && this.cp(1) === STAR) {
        level += 1;
        this.pos += 2;
      } else if (c === STAR && this.cp(1) === SLASH) {
        level -= 1;
        this.pos += 2;
      } else {
        if (isLinebreak(c)) this._precededByLinebreak = true;
        this.pos += codePointLength(c);
      }
    }
    return level === 0;
  }

  //
  // ─── Token dispatch ───────────────────────────────────────────────────────
  //

  private scanToken(): Token {
    const start = this.pos;
    const c = this.cp();

    switch (c) {
      case LPAREN:
        this.pos += 1;
        return this.makeToken('OPEN_PAREN', start);
      case RPAREN:
        this.pos += 1;
        return this.makeToken('CLOSE_PAREN', start);
      case LBRACKET:
        this.pos += 1;
        return this.makeToken('OPEN_BRACKET', start);
      case RBRACKET:
        this.pos += 1;
        return this.makeToken('CLOSE_BRACKET', start);
      case LBRACE:
        this.pos += 1;
        return this.makeToken('OPEN_BRACE', start);
      case RBRACE:
        this.pos += 1;
        return this.makeToken('CLOSE_BRACE', start);
      case COMMA:
        this.pos += 1;
        return this.makeToken('COMMA', start);
      case SEMICOLON:
        this.pos += 1;
        return this.makeToken('SEMICOLON', start);
    }

    if (c === BACKTICK) return this.scanVerbatimSymbol();
    if (c === DOLLAR) return this.scanLatexIsland();
    if (c === HASH) return this.scanHash();
    if (c === QUOTE) return this.scanString();
    if (DIGITS.has(c)) return this.scanNumber();
    if (OPERATOR_CHARS.has(c)) return this.scanOperator();
    if (this.canStartSymbol(c)) return this.scanSymbol();

    return this.scanError();
  }

  private canStartSymbol(c: number): boolean {
    return c >= 0 && !isIdentifierStartProhibited(c) && !isBreak(c);
  }

  /** Would `scanToken` produce something other than an `ERROR` at `c`? */
  private canStartToken(c: number): boolean {
    if (c < 0) return false;
    if (DIGITS.has(c) || OPERATOR_CHARS.has(c)) return true;
    switch (c) {
      case LPAREN:
      case RPAREN:
      case LBRACKET:
      case RBRACKET:
      case LBRACE:
      case RBRACE:
      case COMMA:
      case SEMICOLON:
      case BACKTICK:
      case DOLLAR:
      case HASH:
      case QUOTE:
        return true;
    }
    return this.canStartSymbol(c);
  }

  //
  // ─── Operators ────────────────────────────────────────────────────────────
  //

  private scanOperator(): Token {
    const start = this.pos;
    // Maximal munch: `===` is one token, not `==` then `=`.
    while (!this.atEnd() && OPERATOR_CHARS.has(this.cp())) this.pos += 1;
    return this.makeToken('OPERATOR', start);
  }

  //
  // ─── Unrecognized character runs ──────────────────────────────────────────
  //

  private scanError(): Token {
    const start = this.pos;
    // Consume at least the current code point, then a maximal run of other
    // characters that cannot start a token and are not whitespace.
    this.pos += codePointLength(this.cp());
    while (!this.atEnd()) {
      const c = this.cp();
      if (isWhitespace(c) || this.canStartToken(c)) break;
      this.pos += codePointLength(c);
    }
    const text = this.source.slice(start, this.pos);
    return this.makeToken('ERROR', start, {
      diagnostics: [['unexpected-symbol', text]],
    });
  }

  //
  // ─── Symbols ──────────────────────────────────────────────────────────────
  //

  private scanSymbol(): Token {
    const start = this.pos;
    while (!this.atEnd()) {
      const c = this.cp();
      if (isBreak(c) || isIdentifierContinueProhibited(c)) break;
      this.pos += codePointLength(c);
    }
    return this.makeToken('SYMBOL', start);
  }

  /**
   * A verbatim symbol is enclosed in backticks and may contain characters that
   * are otherwise invalid (e.g. `+`) plus escape sequences. Ported from
   * `identifier-parsers.ts` `parseVerbatimIdentifier`.
   */
  private scanVerbatimSymbol(): Token {
    const start = this.pos;
    this.pos += 1; // opening backtick

    const diagnostics: DiagnosticMessage[] = [];
    let id = '';
    let invalidChar = false;
    let done = false;
    let atLinebreak = false;

    while (!done && !atLinebreak && !this.atEnd()) {
      const c = this.cp();
      atLinebreak = isLinebreak(c);
      done = c === BACKTICK;
      if (!done) {
        if (c === BACKSLASH) {
          id += this.scanEscapeSequence(diagnostics);
        } else {
          invalidChar = invalidChar || isIdentifierContinueProhibited(c);
          id += String.fromCodePoint(c);
          this.pos += codePointLength(c);
        }
      }
    }

    if (!done) {
      // Reached a linebreak or EOF before the closing backtick.
      return this.makeToken('VERBATIM_SYMBOL', start, {
        value: id,
        diagnostics: [['unbalanced-verbatim-symbol', id]],
      });
    }
    this.pos += 1; // closing backtick

    if (id.length === 0)
      return this.makeToken('VERBATIM_SYMBOL', start, {
        value: id,
        diagnostics: ['empty-verbatim-symbol'],
      });

    if (invalidChar || isIdentifierStartProhibited(id.codePointAt(0)!))
      return this.makeToken('VERBATIM_SYMBOL', start, {
        value: id,
        diagnostics: [['invalid-symbol-name', id]],
      });

    return this.makeToken('VERBATIM_SYMBOL', start, { value: id });
  }

  //
  // ─── Numbers ──────────────────────────────────────────────────────────────
  //
  // Ported from `numeric-parsers.ts`. The lexer only captures the *extent* of
  // the literal (raw text); the parser converts it to a MathJSON `{num}`
  // preserving full precision. No `parseFloat`, no value computation here.
  //

  private scanNumber(): Token {
    const start = this.pos;

    if (this.cp() === 0x30 && (this.cp(1) === 0x62 || this.cp(1) === 0x42)) {
      // Binary: `0b` / `0B`
      this.pos += 2;
      this.scanBinaryRun();
      if (this.cp() === DOT) {
        this.pos += 1;
        this.scanBinaryRun();
      }
      this.scanExponent(true);
    } else if (
      this.cp() === 0x30 &&
      (this.cp(1) === 0x78 || this.cp(1) === 0x58)
    ) {
      // Hexadecimal: `0x` / `0X`. Note: `e`/`E` are hex digits, so the
      // exponent marker is only `p`/`P`.
      this.pos += 2;
      this.scanHexRun();
      if (this.cp() === DOT) {
        this.pos += 1;
        this.scanHexRun();
      }
      this.scanExponent(false);
    } else {
      // Decimal
      this.scanDecimalRun();
      if (this.cp() === DOT) {
        this.pos += 1;
        this.scanDecimalRun();
      }
      this.scanExponent(true);
    }

    return this.makeToken('NUMBER', start);
  }

  private scanDecimalRun(): void {
    while (DIGITS.has(this.cp()) || this.cp() === UNDERSCORE) this.pos += 1;
  }

  private scanHexRun(): void {
    while (HEX_DIGITS.has(this.cp()) || this.cp() === UNDERSCORE) this.pos += 1;
  }

  private scanBinaryRun(): void {
    while (this.cp() === UNDERSCORE || this.isBinaryDigit(this.cp()))
      this.pos += 1;
  }

  private isBinaryDigit(c: number): boolean {
    return HEX_DIGITS.has(c) && HEX_DIGITS.get(c)! <= 1;
  }

  /**
   * Optionally scan an exponent. Decimal/binary allow `e`/`E`/`p`/`P`;
   * hexadecimal allows only `p`/`P` (`e`/`E` are hex digits). The marker is
   * consumed only when it is followed by an optional sign and at least one
   * decimal digit — a deliberate improvement over the old scanner, which could
   * half-consume a stray `e` (e.g. `2et`).
   */
  private scanExponent(allowE: boolean): void {
    const c = this.cp();
    const isE = c === 0x65 || c === 0x45; // e / E
    const isP = c === 0x70 || c === 0x50; // p / P
    if (!((allowE && (isE || isP)) || (!allowE && isP))) return;

    let k = 1;
    if (this.cp(1) === PLUS || this.cp(1) === MINUS) k = 2;
    if (!DIGITS.has(this.cp(k))) return;

    this.pos += k; // consume the marker (+ optional sign)
    while (DIGITS.has(this.cp())) this.pos += 1;
  }

  //
  // ─── LaTeX islands ────────────────────────────────────────────────────────
  //
  // `$…$`. Lexed here; unused until Phase 2. `\$` escapes a literal `$` inside
  // the island so it does not close it. The `island` span covers the inner
  // content (between the delimiters).
  //

  private scanLatexIsland(): Token {
    const start = this.pos;
    this.pos += 1; // opening `$`
    const innerStart = this.pos;
    let closed = false;
    while (!this.atEnd()) {
      const c = this.cp();
      if (c === BACKSLASH && this.cp(1) === DOLLAR) {
        this.pos += 2; // escaped `\$`
        continue;
      }
      if (c === DOLLAR) {
        closed = true;
        break;
      }
      this.pos += codePointLength(c);
    }
    const island: SourceSpan = { start: innerStart, end: this.pos };
    if (closed) {
      this.pos += 1; // closing `$`
      return this.makeToken('LATEX_ISLAND', start, { island });
    }
    return this.makeToken('LATEX_ISLAND', start, {
      island,
      diagnostics: [['string-literal-closing-delimiter-expected', '$']],
    });
  }

  //
  // ─── Hash: shebang (handled earlier), pragma, extended string ─────────────
  //

  private scanHash(): Token {
    const start = this.pos;

    // Extended string: one or more `#` followed by `"`.
    let j = this.pos;
    while (this.codeAt(j) === HASH) j += 1;
    if (this.codeAt(j) === QUOTE) return this.scanExtendedString();

    // Pragma: `#` followed by an identifier character.
    const next = this.cp(1);
    if (this.canStartSymbol(next)) {
      this.pos += 1; // `#`
      while (!this.atEnd()) {
        const c = this.cp();
        if (isBreak(c) || isIdentifierContinueProhibited(c)) break;
        this.pos += codePointLength(c);
      }
      return this.makeToken('PRAGMA', start);
    }

    // A lone `#`.
    this.pos += 1;
    return this.makeToken('ERROR', start, {
      diagnostics: [['unexpected-symbol', '#']],
    });
  }

  /**
   * An extended string is delimited by `#"…"#`, `##"…"##`, etc. and contains
   * no escape sequences. Ported from `string-parsers.ts` `parseExtendedString`.
   */
  private scanExtendedString(): Token {
    const start = this.pos;
    let prefixLen = 0;
    while (this.cp() === HASH) {
      prefixLen += 1;
      this.pos += 1;
    }
    this.pos += 1; // opening quote (guaranteed by the caller)

    let value = '';
    let found = false;
    while (!this.atEnd()) {
      const c = this.cp();
      if (isLinebreak(c)) break;
      if (c === QUOTE) {
        let k = 0;
        while (k < prefixLen && this.codeAt(this.pos + 1 + k) === HASH) k += 1;
        if (k === prefixLen) {
          found = true;
          this.pos += 1 + prefixLen;
          break;
        }
      }
      value += String.fromCodePoint(c);
      this.pos += codePointLength(c);
    }

    const diagnostics: DiagnosticMessage[] = [];
    if (!found)
      diagnostics.push([
        'string-literal-closing-delimiter-expected',
        '#'.repeat(prefixLen) + '"',
      ]);
    return this.makeToken('STRING', start, {
      parts: [value],
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    });
  }

  //
  // ─── Strings ──────────────────────────────────────────────────────────────
  //

  private scanString(): Token {
    // `"""` → multiline; otherwise single-line (which also handles `""`).
    if (this.cp(1) === QUOTE && this.cp(2) === QUOTE)
      return this.scanMultilineString();
    return this.scanSingleLineString();
  }

  /**
   * A single-line string. Ported from `string-parsers.ts`
   * `parseSingleLineString`. Produces a `STRING` token whose `parts` are cooked
   * text segments interleaved with raw `\(…)` interpolation spans.
   */
  private scanSingleLineString(): Token {
    const start = this.pos;
    this.pos += 1; // opening quote

    const diagnostics: DiagnosticMessage[] = [];
    const parts: StringPart[] = [];
    let current = '';
    let found = false;

    while (!this.atEnd()) {
      const c = this.cp();
      if (c === QUOTE) {
        found = true;
        this.pos += 1; // closing quote
        break;
      }
      if (isLinebreak(c)) break;
      if (c === BACKSLASH && this.cp(1) === LPAREN) {
        // Interpolation `\(…)`
        parts.push(current);
        current = '';
        parts.push(this.scanInterpolationSpan(diagnostics));
      } else if (c === BACKSLASH) {
        current += this.scanEscapeSequence(diagnostics);
      } else {
        current += String.fromCodePoint(c);
        this.pos += codePointLength(c);
      }
    }

    if (current) parts.push(current);

    if (!found) {
      if (parts.length === 0 && (this.atEnd() || this.atLinebreak())) {
        // A lone quote at end of line/source: probably a stray closing quote.
        diagnostics.push(['string-literal-opening-delimiter-expected', '"']);
      } else {
        diagnostics.push(['string-literal-closing-delimiter-expected', '"']);
      }
    }

    // Represent the empty string as a single empty cooked segment.
    if (parts.length === 0) parts.push('');

    return this.makeToken('STRING', start, {
      parts,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    });
  }

  /**
   * At the `\` of a `\(…)` interpolation. Consumes through the matching `)` and
   * returns the raw span of the inner expression (parsed later, offset-shifted,
   * by the Phase 2 parser).
   *
   * Limitation: the closing `)` is located by paren-depth counting, which does
   * not skip over a `)` that appears inside a nested string literal within the
   * interpolation. The Phase 2 sub-parse tolerates this; a nested-string-aware
   * scan can be added then if needed.
   */
  private scanInterpolationSpan(diagnostics: DiagnosticMessage[]): SourceSpan {
    this.pos += 2; // consume `\(`
    const start = this.pos;
    let depth = 1;
    while (!this.atEnd()) {
      const c = this.cp();
      if (isLinebreak(c)) break; // interpolation cannot cross a line
      if (c === LPAREN) depth += 1;
      else if (c === RPAREN) {
        depth -= 1;
        if (depth === 0) break;
      }
      this.pos += codePointLength(c);
    }
    const span: SourceSpan = { start, end: this.pos };
    if (this.cp() === RPAREN) this.pos += 1;
    else diagnostics.push(['closing-bracket-expected', ')']);
    return span;
  }

  /**
   * A multiline string delimited by `"""`. Handles indentation stripping,
   * `\`-continuations, line-break normalization to `\n`, and interpolations,
   * following `docs/literals.md`. Unlike the old implementation, it enforces
   * that every nonblank line begins with the closing-delimiter indentation.
   */
  private scanMultilineString(): Token {
    const start = this.pos;
    this.pos += 3; // `"""`

    // Anything after the opening `"""` up to the linebreak must be inline
    // whitespace only.
    this.skipInlineSpaces();
    if (!this.atLinebreak() && !this.atEnd()) {
      return this.makeToken('STRING', start, {
        parts: [''],
        diagnostics: ['multiline-string-expected'],
      });
    }
    this.skipLinebreak();

    const diagnostics: DiagnosticMessage[] = [];

    // Collect lines. Each line is an ordered list of segments (cooked string /
    // interpolation span) plus a `continues` flag (line ended with `\`).
    const lines: { segments: StringPart[]; continues: boolean }[] = [];
    let segments: StringPart[] = [];
    let text = '';
    let closed = false;
    let prefix = '';

    while (!this.atEnd()) {
      const c = this.cp();

      // Closing `"""`? The text accumulated on this line is the indentation
      // prefix.
      if (c === QUOTE && this.cp(1) === QUOTE && this.cp(2) === QUOTE) {
        prefix = text;
        this.pos += 3;
        closed = true;
        break;
      }

      if (isLinebreak(c)) {
        if (text) segments.push(text);
        text = '';
        lines.push({ segments, continues: false });
        segments = [];
        this.skipLinebreak();
        continue;
      }

      if (c === BACKSLASH && this.isContinuation()) {
        // Line continuation: drop the `\`, trailing inline whitespace, and the
        // newline; the next line joins directly.
        if (text) segments.push(text);
        text = '';
        lines.push({ segments, continues: true });
        segments = [];
        this.consumeContinuation();
        continue;
      }

      if (c === BACKSLASH && this.cp(1) === LPAREN) {
        if (text) segments.push(text);
        text = '';
        segments.push(this.scanInterpolationSpan(diagnostics));
        continue;
      }

      if (c === BACKSLASH) {
        text += this.scanEscapeSequence(diagnostics);
        continue;
      }

      text += String.fromCodePoint(c);
      this.pos += codePointLength(c);
    }

    if (!closed) {
      // Unterminated: flush the pending line and report.
      if (text) segments.push(text);
      if (segments.length > 0) lines.push({ segments, continues: false });
      diagnostics.push(['string-literal-closing-delimiter-expected', '"""']);
    }

    // Validate the closing indentation and strip it from each nonblank line.
    let validPrefix = true;
    for (const ch of prefix) if (ch !== ' ' && ch !== '\t') validPrefix = false;

    if (!validPrefix) diagnostics.push('multiline-whitespace-expected');
    else if (prefix.length > 0) {
      for (const line of lines) {
        if (this.isBlankLine(line.segments)) continue;
        const head = line.segments[0];
        if (typeof head === 'string' && head.startsWith(prefix)) {
          line.segments[0] = head.slice(prefix.length);
        } else {
          // Every nonblank line MUST begin with the closing indentation.
          diagnostics.push('multiline-whitespace-expected');
          break;
        }
      }
    }

    // Assemble the parts: join lines with `\n`, except continued lines join
    // directly to the following line.
    const parts: StringPart[] = [];
    let acc = '';
    for (let i = 0; i < lines.length; i++) {
      for (const seg of lines[i].segments) {
        if (typeof seg === 'string') {
          acc += seg;
        } else {
          if (acc) {
            parts.push(acc);
            acc = '';
          }
          parts.push(seg);
        }
      }
      const isLast = i === lines.length - 1;
      if (!isLast && !lines[i].continues) acc += '\n';
    }
    if (acc || parts.length === 0) parts.push(acc);

    return this.makeToken('STRING', start, {
      parts,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    });
  }

  /** A blank line has no interpolation spans and only whitespace text. */
  private isBlankLine(segments: StringPart[]): boolean {
    for (const seg of segments) {
      if (typeof seg !== 'string') return false;
      for (const ch of seg) if (ch !== ' ' && ch !== '\t') return false;
    }
    return true;
  }

  /** At a `\`: is it a line continuation (`\` + inline spaces + linebreak)? */
  private isContinuation(): boolean {
    let i = this.pos + 1;
    while (this.codeAt(i) === SPACE || this.codeAt(i) === TAB) i += 1;
    return i >= this.source.length || isLinebreak(this.codeAt(i));
  }

  /** Consume a `\` continuation: the `\`, trailing inline spaces, and newline. */
  private consumeContinuation(): void {
    this.pos += 1; // `\`
    this.skipInlineSpaces();
    this.skipLinebreak();
  }

  //
  // ─── Escape sequences ─────────────────────────────────────────────────────
  //
  // Ported from `string-parsers.ts` `parseEscapeSequence`. Returns the cooked
  // replacement text and appends any diagnostics. On an invalid escape it
  // returns the offending source (backslash + char) so nothing is silently
  // dropped.
  //

  private scanEscapeSequence(diagnostics: DiagnosticMessage[]): string {
    const bs = this.pos; // at the backslash
    const next = this.cp(1);

    const replacement = REVERSED_ESCAPED_CHARS.get(next);
    if (replacement !== undefined) {
      this.pos = bs + 2;
      return String.fromCodePoint(replacement);
    }

    if (next !== 0x75) {
      // Not `\u…`: an unrecognized escape such as `\z`.
      this.pos = bs + 2;
      diagnostics.push([
        'invalid-escape-sequence',
        '\\' + (next >= 0 ? String.fromCodePoint(next) : ''),
      ]);
      return '\\' + (next >= 0 ? String.fromCodePoint(next) : '');
    }

    // Unicode escape: `A` (exactly 4 hex digits) or `\u{41}` (0–8 digits).
    let i = bs + 2; // after `\u`
    let code = 0;
    let invalidChar = false;
    let done = false;
    let codepointString = '';

    if (this.codeAt(i) === LBRACE_ESCAPE) {
      i += 1;
      while (!done && i < bs + 11) {
        const c = this.codeAt(i++);
        if (c >= 0) codepointString += String.fromCodePoint(c);
        invalidChar = invalidChar || !HEX_DIGITS.has(c);
        if (!invalidChar) code = 16 * code + HEX_DIGITS.get(c)!;
        done = this.codeAt(i) === RBRACE_ESCAPE;
      }
      if (done) i += 1;
    } else {
      while (!invalidChar && i <= bs + 5) {
        const c = this.codeAt(i++);
        if (c >= 0) codepointString += String.fromCodePoint(c);
        invalidChar = !HEX_DIGITS.has(c);
        if (!invalidChar) code = 16 * code + HEX_DIGITS.get(c)!;
      }
      done = i <= this.source.length;
    }
    this.pos = i;

    if (invalidChar || !done) {
      diagnostics.push(['invalid-unicode-codepoint-string', codepointString]);
      return '�';
    }
    if (code > 0x10ffff) {
      diagnostics.push([
        'invalid-unicode-codepoint-value',
        'U+' + ('00000' + code.toString(16)).slice(-8).toUpperCase(),
      ]);
      return '�';
    }
    if (code >= 0xd800 && code <= 0xdfff) {
      diagnostics.push([
        'invalid-unicode-codepoint-value',
        'U+' + ('0000' + code.toString(16)).slice(-4).toUpperCase(),
      ]);
      return '�';
    }
    return String.fromCodePoint(code);
  }
}

/** Convenience: tokenize `source` into a `Token[]` (never throws). */
export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
