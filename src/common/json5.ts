export class JSON5 {
  static parse(input: string): any {
    const parser = new JSON5Parser(input);
    const value = parser.parseValue();
    parser.skipWhitespace();
    if (!parser.isAtEnd()) {
      throw parser.error(
        `Unexpected token '${parser.currentChar()}' after parsing complete value`
      );
    }
    return value;
  }
}

class JSON5Parser {
  private index = 0;
  private readonly text: string;

  constructor(input: string) {
    this.text = input;
  }

  parseValue(): any {
    this.skipWhitespace();
    if (this.isAtEnd()) {
      throw this.error('Unexpected end of input');
    }
    const ch = this.currentChar();
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '"' || ch === "'") return this.parseString();
    if (ch === '-' || ch === '+' || (ch >= '0' && ch <= '9') || ch === '.')
      return this.parseNumber();
    return this.parseIdentifier();
  }

  private parseObject(): any {
    const obj: Record<string, any> = {};
    this.expectChar('{');
    this.skipWhitespace();
    // Empty object?
    if (this.currentChar() === '}') {
      this.index++; // consume "}"
      return obj;
    }
    while (true) {
      this.skipWhitespace();
      let key: string;
      const ch = this.currentChar();
      if (ch === '"' || ch === "'") {
        key = this.parseString();
      } else {
        key = this.parseIdentifier();
      }
      this.skipWhitespace();
      this.expectChar(':');
      this.skipWhitespace();
      const value = this.parseValue();
      obj[key] = value;
      this.skipWhitespace();
      if (this.currentChar() === ',') {
        this.index++; // consume comma
        this.skipWhitespace();
        // Allow trailing comma: if next is "}", break out.
        if (this.currentChar() === '}') {
          this.index++;
          break;
        }
      } else if (this.currentChar() === '}') {
        this.index++; // consume "}"
        break;
      } else {
        throw this.error(
          `Expected ',' or '}' in object but found '${this.currentChar()}'`
        );
      }
    }
    return obj;
  }

  private parseArray(): any[] {
    const arr: any[] = [];
    this.expectChar('[');
    this.skipWhitespace();
    // Empty array?
    if (this.currentChar() === ']') {
      this.index++; // consume "]"
      return arr;
    }
    while (true) {
      this.skipWhitespace();
      arr.push(this.parseValue());
      this.skipWhitespace();
      if (this.currentChar() === ',') {
        this.index++; // consume comma
        this.skipWhitespace();
        // Allow trailing comma:
        if (this.currentChar() === ']') {
          this.index++;
          break;
        }
      } else if (this.currentChar() === ']') {
        this.index++; // consume "]"
        break;
      } else {
        throw this.error(
          `Expected ',' or ']' in array but found '${this.currentChar()}'`
        );
      }
    }
    return arr;
  }

  private parseString(): string {
    const quote = this.currentChar();
    if (quote !== '"' && quote !== "'") {
      throw this.error(`String should start with a quote, got '${quote}'`);
    }
    this.index++; // consume opening quote
    let result = '';
    while (!this.isAtEnd()) {
      const ch = this.currentChar();
      if (ch === quote) {
        this.index++; // consume closing quote
        return result;
      }
      if (ch === '\\') {
        this.index++; // consume backslash
        if (this.isAtEnd()) {
          throw this.error('Unterminated escape sequence in string');
        }
        const esc = this.currentChar();
        switch (esc) {
          case 'b':
            result += '\b';
            break;
          case 'f':
            result += '\f';
            break;
          case 'n':
            result += '\n';
            break;
          case 'r':
            result += '\r';
            break;
          case 't':
            result += '\t';
            break;
          case 'v':
            result += '\v';
            break;
          case '\\':
            result += '\\';
            break;
          case "'":
            result += "'";
            break;
          case '"':
            result += '"';
            break;
          case '0':
            result += '\0';
            break;
          case 'u': {
            // Unicode escape sequence: exactly 4 hex digits
            this.index++; // consume 'u'
            const hex = this.text.substr(this.index, 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw this.error(`Invalid Unicode escape sequence: \\u${hex}`);
            }
            result += String.fromCharCode(parseInt(hex, 16));
            this.index += 3; // already consumed one digit by switch's index++ later
            break;
          }
          default:
            // Allow arbitrary escaped character (or throw error to be stricter)
            result += esc;
        }
        this.index++; // move past escape character (or after unicode sequence)
      } else {
        result += ch;
        this.index++;
      }
    }
    throw this.error('Unterminated string literal');
  }

  private parseNumber(): number {
    const start = this.index;

    // Check explicitly for signed Infinity
    if (this.text.startsWith('-Infinity', this.index)) {
      this.index += '-Infinity'.length;
      return -Infinity;
    }
    if (this.text.startsWith('+Infinity', this.index)) {
      this.index += '+Infinity'.length;
      return Infinity;
    }
    if (this.text.startsWith('Infinity', this.index)) {
      this.index += 'Infinity'.length;
      return Infinity;
    }

    // Otherwise, collect a typical number literal.
    while (!this.isAtEnd() && /[0-9+\-_.eE]/.test(this.currentChar())) {
      this.index++;
    }
    const token = this.text.slice(start, this.index);
    // Remove underscores (allowed in JSON5)
    const normalized = token.replace(/_/g, '');
    const num = Number(normalized);
    if (isNaN(num)) {
      throw this.error(`Invalid number: ${token}`);
    }
    return num;
  }

  private parseIdentifier(): any {
    const start = this.index;
    // An identifier can start with a letter, underscore, or dollar sign.
    const firstChar = this.currentChar();
    if (!/[a-zA-Z$_]/.test(firstChar)) {
      throw this.error(`Unexpected token '${firstChar}'`);
    }
    this.index++;
    while (!this.isAtEnd()) {
      const ch = this.currentChar();
      if (!/[a-zA-Z0-9$_]/.test(ch)) break;
      this.index++;
    }
    const token = this.text.slice(start, this.index);
    // Recognize standard literals.
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (token === 'Infinity') return Infinity;
    if (token === 'NaN') return NaN;
    return token;
  }

  skipWhitespace(): void {
    while (!this.isAtEnd()) {
      const ch = this.currentChar();
      if (/\s/.test(ch)) {
        this.index++;
        continue;
      }
      if (ch === '/') {
        // Support for comments: either // or /* ... */
        const next = this.peekChar(1);
        if (next === '/') {
          // Single-line comment
          this.index += 2;
          while (!this.isAtEnd() && this.currentChar() !== '\n') {
            this.index++;
          }
          continue;
        } else if (next === '*') {
          // Multi-line comment
          this.index += 2;
          while (
            !this.isAtEnd() &&
            !(this.currentChar() === '*' && this.peekChar(1) === '/')
          ) {
            this.index++;
          }
          if (this.isAtEnd()) {
            throw this.error('Unterminated multi-line comment');
          }
          this.index += 2; // consume closing */
          continue;
        }
      }
      break;
    }
  }

  private expectChar(expected: string): void {
    if (this.currentChar() !== expected) {
      throw this.error(
        `Expected '${expected}' but found '${this.currentChar()}'`
      );
    }
    this.index++;
  }

  currentChar(): string {
    return this.text[this.index];
  }

  peekChar(offset: number): string {
    return this.text[this.index + offset];
  }

  isAtEnd(): boolean {
    return this.index >= this.text.length;
  }

  error(message: string): Error {
    return new Error(`${message} at position ${this.index}`);
  }
}
