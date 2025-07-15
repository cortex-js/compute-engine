/**
 * Parser class for parsing strings with various utility methods.
 *
 * Concrete parsers should extend this class and implement the `parse` method.
 */

export abstract class Parser<T = unknown> {
  readonly buffer: string;
  pos: number;

  constructor(buffer: string, pos: number = 0) {
    this.buffer = buffer;
    this.pos = pos;
  }

  abstract parse(): T;

  /** Note: Typescript does incorrect data flow analysis on getters. To avoid
   * this, we use a method instead of a getter.
   */
  peek(): string | undefined {
    return this.buffer[this.pos];
  }

  consume(): string | undefined {
    const char = this.peek();
    if (char !== undefined) this.pos++;

    return char;
  }

  get atEnd(): boolean {
    return this.pos >= this.buffer.length;
  }

  get atLineEnd(): boolean {
    const c = this.peek();
    return c === '\n' || c === undefined;
  }

  get lineCol(): { line: number; col: number } {
    const start = this.pos;
    this.pos = 0;
    let line = 1;
    let col = 1;
    while (this.pos < start) {
      if (this.atLineEnd) {
        line++;
        col = 1; // Reset column on new line
      } else {
        this.consume();
        col++;
      }
    }
    return { line, col };
  }

  getLine(line: number): string | undefined {
    if (line < 1) return undefined; // Lines are 1-indexed
    let currentLine = 1;
    let start = 0;
    while (currentLine < line && start < this.buffer.length) {
      const nextNewline = this.buffer.indexOf('\n', start);
      if (nextNewline === -1) break; // No more lines
      start = nextNewline + 1; // Move past the newline character
      currentLine++;
    }
    if (currentLine !== line) return undefined; // Line not found
    const end = this.buffer.indexOf('\n', start);
    if (end === -1) return this.buffer.slice(start); // Last line
    return this.buffer.slice(start, end);
  }

  error(message: string): never {
    const { line, col } = this.lineCol;
    // message = message.replace(/\n/g, ' ');
    // message = message.replace(/\s+/g, ' '); // Normalize whitespace
    // message = message.trim();
    // if (message.endsWith('.')) message = message.slice(0, -1); // Remove trailing period
    message = `|${this.getLine(line)}\n|${' '.repeat(col - 1)}^\n| ${line}:${col}: ${message}`;

    throw new Error(message);
  }

  // @todo: atString()?, or just at()?
  match(pattern: string): boolean {
    const start = this.pos;
    for (const char of pattern) {
      if (this.peek() !== char) {
        this.pos = start; // Reset position if match fails
        return false;
      }
      this.consume(); // Consume the character
    }
    return true;
  }

  skipWhitespace(): void {
    while (!this.atEnd && /\s/.test(this.peek()!)) this.pos += 1;
  }

  skipToEndOfLine(): void {
    while (!this.atLineEnd) this.consume();
  }

  skipToNextLine(): void {
    while (!this.atEnd && this.peek() !== '\n') this.consume();
    if (!this.atEnd) this.consume(); // Consume the newline character
  }

  skipToString(str: string): boolean {
    const start = this.pos;
    while (!this.atEnd) {
      if (this.match(str)) return true;
      this.consume();
    }
    this.pos = start; // Reset position if match fails
    return false;
  }
}

/** Parse an escape sequence such as:
 * - `\n` (newline)
 * - `\t` (tab)
 * - `\u{0041}` (Unicode code point)
 * - `\u{red}` (ANSI style)
 * - `\u{#ff0000}` (hex color code)
 */
export function parseEscapeSequence<T>(parser: Parser<T>): string | undefined {
  const start = parser.pos;
  if (!parser.match('\\')) return undefined; // Not an escape sequence

  const char = parser.peek();
  if (char === undefined) {
    parser.pos = start; // Reset position if no character to consume
    return undefined;
  }

  // If we have a `\` at the end of the line, we treat it as a line continuation
  if (char === '\\' && parser.atLineEnd) return parseEscapeSequence(parser);

  const REVERSED_ESCAPED_CHARS = {
    '0': '\0', // Not allowed in JSON
    '\\': '\\',
    "'": "'",
    '"': '"',
    'a': '\u0007', // Bell character (from C)
    'b': '\b', // Backspace character
    'e': '\x1B', // Escape character
    'f': '\f',
    'n': '\n',
    'r': '\r',
    's': ' ', // Space character
    't': '\t',
    'v': '\v', // Vertical tab, not allowed in JSON
    '{': '{',
    '}': '}',
    '[': '[',
    ']': ']',
    '(': '(',
    ')': ')',
    '<': '<',
    '>': '>',
    '=': '=',
    '+': '+',
    '-': '-',
    '*': '*',
    '/': '/',
    '%': '%',
    '^': '^',
    '|': '|',
    '&': '&',
    '!': '!',
    '?': '?',
    '@': '@',
    '#': '#',
    '$': '$',
    '`': '`',
    '~': '~',
    ':': ':',
    ';': ';',
    ',': ',',
    '_': '_',
  };

  // Is it a common escape sequence? ("\b", "\n", etc...)
  if (REVERSED_ESCAPED_CHARS[char]) {
    parser.consume();
    return REVERSED_ESCAPED_CHARS[char];
  }

  // Is it a Unicode escape sequence: "\u0041", "\u{0041}"
  if (parser.match('u')) {
    let unicodeStr = '';
    if (parser.match('{')) {
      // Handle ANSI-style sequences like \u{red}
      const start = parser.pos;

      let style = '';
      while (!parser.atEnd && parser.peek() !== '}') style += parser.consume();

      if (!parser.match('}')) parser.error('invalid unicode escape sequence');

      // Define ANSI style mapping
      const ANSI_STYLE_CODES: Record<string, string> = {
        'red': '\x1b[31m',
        'green': '\x1b[32m',
        'yellow': '\x1b[33m',
        'blue': '\x1b[34m',
        'magenta': '\x1b[35m',
        'cyan': '\x1b[36m',
        'white': '\x1b[37m',
        'black': '\x1b[30m',
        'bold': '\x1b[1m',
        'reset': '\x1b[0m',
        // Add more ANSI styles as needed
        // Note: ANSI styles are not Unicode codepoints, but we handle them here
        // for convenience in the parser.
        // They are used for styling terminal output.
        // They are not part of the Unicode standard.
        'red-bg': '\x1b[41m',
        'green-bg': '\x1b[42m',
        'yellow-bg': '\x1b[43m',
        'blue-bg': '\x1b[44m',
        'magenta-bg': '\x1b[45m',
        'cyan-bg': '\x1b[46m',
        'white-bg': '\x1b[47m',
        'black-bg': '\x1b[40m',
        'bold-red': '\x1b[1;31m',
        'bold-green': '\x1b[1;32m',
        'bold-yellow': '\x1b[1;33m',
        'bold-blue': '\x1b[1;34m',
        'bold-magenta': '\x1b[1;35m',
        'bold-cyan': '\x1b[1;36m',
        'bold-white': '\x1b[1;37m',
        'bold-black': '\x1b[1;30m',
        'reset-bold': '\x1b[22m',
        'reset-italic': '\x1b[23m',
        'reset-underline': '\x1b[24m',
        'reset-strikethrough': '\x1b[29m',
        'reset-inverse': '\x1b[27m',
        'reset-all': '\x1b[0m',
        // Add more ANSI styles as needed
        'italic': '\x1b[3m', // Not widely supported
        'underline': '\x1b[4m',
        'strikethrough': '\x1b[9m',
        'inverse': '\x1b[7m',
        'hidden': '\x1b[8m',
        'dim': '\x1b[2m',
        'blink': '\x1b[5m',
        'reverse': '\x1b[7m', // Swap foreground and background colors
        'conceal': '\x1b[8m', // Not widely supported
      };

      if (style.startsWith('#')) {
        // Handle hex color codes like \u{#ff0000}
        style = style.slice(1); // Remove the leading '#'
        if (!/^[0-9a-fA-F]{6}$/.test(style))
          parser.error(`invalid hex color code: ${style}`);
        // Convert hex color to ANSI escape code
        const r = parseInt(style.slice(0, 2), 16);
        const g = parseInt(style.slice(2, 4), 16);
        const b = parseInt(style.slice(4, 6), 16);
        return `\x1b[38;2;${r};${g};${b}m`; // RGB ANSI escape code
      }

      const ansi = ANSI_STYLE_CODES[style];
      if (ansi !== undefined) return ansi;

      parser.pos = start; // Reset position if no valid ANSI style found

      while (!parser.atEnd && /[0-9a-fA-F]/.test(parser.peek()!))
        unicodeStr += parser.consume();

      if (!parser.match('}')) parser.error('invalid unicode escape sequence');

      // `\u{...}` can have 1 to 6 hex digits
      // (e.g. `\u{1F600}` for 😀)
      if (unicodeStr.length < 1 || unicodeStr.length > 6)
        parser.error(`invalid unicode escape sequence: \\u${unicodeStr}`);
    } else {
      while (!parser.atEnd && /[0-9a-fA-F]/.test(parser.peek()!))
        unicodeStr += parser.consume();
      // `\u` must be followed by exactly 4 hex digits
      if (unicodeStr.length !== 4)
        parser.error(`invalid unicode escape sequence: \\u${unicodeStr}`);
    }

    if (!unicodeStr)
      parser.error('invalid unicode escape sequence: missing code point');

    // Validate that the codepoint is a Unicode scalar value:
    // - In the range of Unicode codepoints: [0..0x10ffff]
    // - Not in the Surrogate range (a surrogate codepoint is valid
    // as part of a UTF-16 encoding, but not as a standalone codepoint)
    const code = parseInt(unicodeStr, 16);
    if (isNaN(code))
      parser.error(`invalid unicode escape sequence: \\u${unicodeStr}`);

    if (code < 0 || code > 0x10ffff)
      parser.error(`unicode code point out of range: \\u${unicodeStr}`);

    if (code >= 0xd800 && code <= 0xdfff)
      parser.error(
        `unicode surrogate code point not allowed: \\u${unicodeStr}`
      );

    return String.fromCodePoint(code);
  }

  parser.error(`invalid escape sequence`);
}
