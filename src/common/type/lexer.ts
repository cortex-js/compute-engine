export type TokenType =
  // Literals
  | 'IDENTIFIER'
  | 'STRING_LITERAL'
  | 'NUMBER_LITERAL'
  | 'VERBATIM_STRING'
  // Keywords
  | 'TRUE'
  | 'FALSE'
  | 'NAN'
  | 'INFINITY'
  | 'PLUS_INFINITY'
  | 'MINUS_INFINITY'
  // Operators
  | '|'
  | '&'
  | '!'
  | '->'
  | '^'
  // Punctuation
  | '('
  | ')'
  | '<'
  | '>'
  | '['
  | ']'
  | ','
  | ':'
  | '?'
  | '*'
  | '+'
  | '..'
  | 'x'
  // Special
  | 'EOF'
  | 'WHITESPACE';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
  line: number;
  column: number;
}

export interface LexerError {
  message: string;
  position: number;
  line: number;
  column: number;
}

export class Lexer {
  input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private tokens: Token[] = [];

  constructor(input: string) {
    this.input = input;
  }

  // Save current lexer state for backtracking
  saveState() {
    return {
      pos: this.pos,
      line: this.line,
      column: this.column,
      tokens: [...this.tokens],
    };
  }

  // Restore lexer state for backtracking
  restoreState(state: {
    pos: number;
    line: number;
    column: number;
    tokens: Token[];
  }) {
    this.pos = state.pos;
    this.line = state.line;
    this.column = state.column;
    this.tokens = state.tokens;
  }

  error(message: string): never {
    throw new Error(
      `Lexer error at line ${this.line}, column ${this.column}: ${message}`
    );
  }

  private peek(offset: number = 0): string {
    const index = this.pos + offset;
    return index < this.input.length ? this.input[index] : '';
  }

  private advance(): string {
    const char = this.input[this.pos++];
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  private match(str: string): boolean {
    if (this.input.slice(this.pos, this.pos + str.length) === str) {
      for (let i = 0; i < str.length; i++) {
        this.advance();
      }
      return true;
    }
    return false;
  }

  private isEOF(): boolean {
    return this.pos >= this.input.length;
  }

  private skipWhitespace(): void {
    while (!this.isEOF() && /\s/.test(this.peek())) {
      this.advance();
    }
  }

  private readIdentifier(): string {
    let value = '';
    while (!this.isEOF() && /[a-zA-Z0-9_]/.test(this.peek())) {
      value += this.advance();
    }
    return value;
  }

  private readVerbatimString(): string {
    if (!this.match('`')) return '';

    let value = '';
    while (!this.isEOF() && this.peek() !== '`') {
      if (this.match('\\`')) {
        value += '`';
      } else if (this.match('\\\\')) {
        value += '\\';
      } else {
        value += this.advance();
      }
    }

    if (this.isEOF()) {
      this.error('Unterminated verbatim string');
    }

    this.advance(); // consume closing backtick
    return value;
  }

  private readStringLiteral(): string {
    const quote = this.advance(); // consume opening quote
    let value = '';

    while (!this.isEOF() && this.peek() !== quote) {
      if (this.match('\\' + quote)) {
        value += quote;
      } else if (this.match('\\\\')) {
        value += '\\';
      } else {
        value += this.advance();
      }
    }

    if (this.isEOF()) {
      this.error('Unterminated string literal');
    }

    this.advance(); // consume closing quote
    return value;
  }

  private readNumber(): string {
    let value = '';

    // Handle sign
    if (this.peek() === '-' || this.peek() === '+') {
      value += this.advance();
    }

    // Handle hex
    if (this.match('0x') || this.match('0X')) {
      value += 'x';
      while (!this.isEOF() && /[0-9a-fA-F]/.test(this.peek())) {
        value += this.advance();
      }
      return '0' + value;
    }

    // Handle binary
    if (this.match('0b') || this.match('0B')) {
      value += 'b';
      while (!this.isEOF() && /[01]/.test(this.peek())) {
        value += this.advance();
      }
      return '0' + value;
    }

    // Handle decimal
    while (!this.isEOF() && /[0-9]/.test(this.peek())) {
      value += this.advance();
    }

    // Handle decimal point
    if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
      value += this.advance(); // consume '.'
      while (!this.isEOF() && /[0-9]/.test(this.peek())) {
        value += this.advance();
      }
    }

    // Handle scientific notation
    if (this.peek() === 'e' || this.peek() === 'E') {
      value += this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        value += this.advance();
      }
      while (!this.isEOF() && /[0-9]/.test(this.peek())) {
        value += this.advance();
      }
    }

    return value;
  }

  private createToken(type: TokenType, value: string): Token {
    return {
      type,
      value,
      position: this.pos - value.length,
      line: this.line,
      column: this.column - value.length,
    };
  }

  private nextToken(): Token | null {
    this.skipWhitespace();

    if (this.isEOF()) {
      return this.createToken('EOF', '');
    }

    const start = this.pos;
    const char = this.peek();

    // Two-character operators
    if (this.match('->')) {
      return this.createToken('->', '->');
    }
    if (this.match('..')) {
      return this.createToken('..', '..');
    }
    if (this.match('+∞') || this.match('+oo')) {
      return this.createToken(
        'PLUS_INFINITY',
        this.input.slice(start, this.pos)
      );
    }
    if (this.match('-∞') || this.match('-oo')) {
      return this.createToken(
        'MINUS_INFINITY',
        this.input.slice(start, this.pos)
      );
    }
    if (this.match('+infinity')) {
      return this.createToken('PLUS_INFINITY', '+infinity');
    }
    if (this.match('-infinity')) {
      return this.createToken('MINUS_INFINITY', '-infinity');
    }

    // Identifiers and keywords (check this before single character tokens)
    if (/[a-zA-Z_]/.test(char)) {
      const value = this.readIdentifier();

      // Check for keywords
      switch (value) {
        case 'true':
          return this.createToken('TRUE', value);
        case 'false':
          return this.createToken('FALSE', value);
        case 'nan':
          return this.createToken('NAN', value);
        case 'infinity':
          return this.createToken('INFINITY', value);
        case 'oo':
          return this.createToken('INFINITY', value);
        default:
          return this.createToken('IDENTIFIER', value);
      }
    }

    // Single-character operators and punctuation
    switch (char) {
      case '|':
        this.advance();
        return this.createToken('|', '|');
      case '&':
        this.advance();
        return this.createToken('&', '&');
      case '!':
        this.advance();
        return this.createToken('!', '!');
      case '^':
        this.advance();
        return this.createToken('^', '^');
      case '(':
        this.advance();
        return this.createToken('(', '(');
      case ')':
        this.advance();
        return this.createToken(')', ')');
      case '<':
        this.advance();
        return this.createToken('<', '<');
      case '>':
        this.advance();
        return this.createToken('>', '>');
      case '[':
        this.advance();
        return this.createToken('[', '[');
      case ']':
        this.advance();
        return this.createToken(']', ']');
      case ',':
        this.advance();
        return this.createToken(',', ',');
      case ':':
        this.advance();
        return this.createToken(':', ':');
      case '?':
        this.advance();
        return this.createToken('?', '?');
      case '*':
        this.advance();
        return this.createToken('*', '*');
      case '+':
        if (/[0-9]/.test(this.peek(1))) {
          return this.createToken('NUMBER_LITERAL', this.readNumber());
        }
        this.advance();
        return this.createToken('+', '+');
      case 'x':
        // Treat 'x' as TIMES only in dimension contexts (like 2x3)
        // Check if it's between numbers
        if (/[0-9]/.test(this.peek(1))) {
          this.advance();
          return this.createToken('x', 'x');
        }
        // Otherwise it should be treated as identifier, but we already checked for that
        // This case should not be reached often
        this.advance();
        return this.createToken('x', 'x');
    }

    // String literals
    if (char === '"' || char === "'") {
      return this.createToken('STRING_LITERAL', this.readStringLiteral());
    }

    // Verbatim strings
    if (char === '`') {
      return this.createToken('VERBATIM_STRING', this.readVerbatimString());
    }

    // Numbers
    if (/[0-9]/.test(char) || (char === '-' && /[0-9]/.test(this.peek(1)))) {
      const number = this.readNumber();

      // Special case: if number is followed immediately by 'x' and then another number,
      // treat it as a dimension pattern (like 2x3)
      if (this.peek() === 'x' && /[0-9]/.test(this.peek(1))) {
        // Don't consume the 'x' here, let it be handled as TIMES token
      }

      return this.createToken('NUMBER_LITERAL', number);
    }

    // This was moved up before single character tokens

    // Special Unicode symbols
    if (char === '∞') {
      this.advance();
      return this.createToken('INFINITY', '∞');
    }

    this.error(`Unexpected character: ${char}`);
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (!this.isEOF()) {
      const token = this.nextToken();
      if (token) {
        tokens.push(token);
        if (token.type === 'EOF') break;
      }
    }

    return tokens;
  }

  peekToken(): Token {
    if (this.tokens.length === 0) {
      const token = this.nextToken();
      if (token) this.tokens.push(token);
    }
    return this.tokens[0] || this.createToken('EOF', '');
  }

  consumeToken(): Token {
    if (this.tokens.length === 0) {
      const token = this.nextToken();
      if (token) return token;
    }
    return this.tokens.shift() || this.createToken('EOF', '');
  }

  matchToken(type: TokenType): boolean {
    const token = this.peekToken();
    if (token.type === type) {
      this.consumeToken();
      return true;
    }
    return false;
  }

  expectToken(type: TokenType): Token {
    const token = this.consumeToken();
    if (token.type !== type) {
      this.error(`Expected ${type}, got ${token.type}`);
    }
    return token;
  }
}
