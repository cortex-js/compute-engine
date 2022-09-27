/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-empty-function */

import {
  ParseLatexOptions,
  LatexToken,
  NumberFormattingOptions,
  Delimiter,
  Terminator,
  Parser,
} from './public';
import { tokenize, tokensToString } from './tokenizer';
import {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
  InfixEntry,
  PostfixEntry,
  PrefixEntry,
  SymbolEntry,
} from './dictionary/definitions';

import { IComputeEngine } from '../public';

import { Expression } from '../../math-json/math-json-format';
import {
  applyAssociativeOperator,
  head,
  isValidSymbolName,
  machineValue,
  op,
  ops,
  symbol,
} from '../../math-json/utils';

/** These delimiters can be used as 'shorthand' delimiters in
 * `openDelimiter` and `closeDelimiter` for `matchfix` operators.
 */
const DELIMITER_SHORTHAND = {
  '(': ['\\lparen', '('],
  ')': ['\\rparen', ')'],
  '[': ['\\lbrack'],
  ']': ['\\rbrack'],
  '<': ['<', '\\langle'],
  '>': ['>', '\\rangle'],
  '{': ['\\{', '\\lbrace'],
  '}': ['\\}', '\\rbrace'],
  ':': [':', '\\colon'],
  '|': ['|', '\\|', '\\lvert', '\\rvert'], //special: '\lvert` when open, `\rvert` when close
  '||': ['||', '\\Vert', '\\lVert', '\\rVert'], // special: `\lVert` when open, `\rVert` when close
  '\\lfloor': ['\\lfloor'],
  '\\rfloor': ['\\rfloor'],
  '\\lceil': ['\\lceil'],
  '\\rceil': ['\\rceil'],
  '\\ulcorner': ['\\ulcorner'],
  '\\urcorner': ['\\urcorner'],
  '\\llcorner': ['\\llcorner'],
  '\\lrcorner': ['\\lrcorner'],
  '\\lgroup': ['\\lgroup'],
  '\\rgroup': ['\\rgroup'],
  '\\lmoustache': ['\\lmoustache'],
  '\\rmoustache': ['\\rmoustache'],
};

const MIDDLE_DELIMITER = {
  ':': [':', '\\colon'],
  '|': ['|', '\\|', '\\mid', '\\mvert'],
};

/** Commands that can be used with an open delimiter, and their corresponding
 * closing commands.
 */

const OPEN_DELIMITER_PREFIX = {
  '\\left': '\\right',
  '\\bigl': '\\bigr',
  '\\Bigl': '\\Bigr',
  '\\biggl': '\\biggr',
  '\\Biggl': '\\Biggr',
  '\\big': '\\big',
  '\\Big': '\\Big',
  '\\bigg': '\\bigg',
  '\\Bigg': '\\Bigg',
};

/** Commands that can be used with a middle delimiter */
const MIDDLE_DELIMITER_PREFIX = [
  '\\middle',
  '\\bigm',
  '\\Bigm',
  '\\biggm',
  '\\Biggm',
  '\\big',
  '\\Big',
  '\\bigg',
  '\\Bigg',
];

/**
 * Map open delimiters to a matching close delimiter
 */
const CLOSE_DELIMITER = {
  '(': ')',
  '[': ']',
  '\\{': '\\}',
  '\\lbrace': '\\rbrace',
  '\\lparen': '\\rparen',
  '\\langle': '\\rangle',
  '\\lfloor': '\\rfloor',
  '\\lceil': '\\rceil',
  '\\vert': '\\vert',
  '\\lvert': '\\rvert',
  '\\Vert': '\\Vert',
  '\\lVert': '\\rVert',
  '\\lbrack': '\\rbrack',
  '\\ulcorner': '\\urcorner',
  '\\llcorner': '\\lrcorner',
  '\\lgroup': '\\rgroup',
  '\\lmoustache': '\\rmoustache',
};

export const DEFAULT_LATEX_NUMBER_OPTIONS: NumberFormattingOptions = {
  precision: 6, // with machine numbers, up to 15 assuming 2^53 bits floating points
  positiveInfinity: '\\infty',
  negativeInfinity: '-\\infty',
  notANumber: '\\operatorname{NaN}',
  decimalMarker: '.', // Use `{,}` for comma as a decimal marker
  groupSeparator: '\\,', // for thousands, etc...
  exponentProduct: '\\cdot',
  beginExponentMarker: '10^{', // could be 'e'
  endExponentMarker: '}',
  notation: 'auto',
  truncationMarker: '\\ldots',
  beginRepeatingDigits: '\\overline{',
  endRepeatingDigits: '}',
  imaginaryNumber: '\\imaginaryI',
  avoidExponentsInRange: [-7, 20],
};

export const DEFAULT_PARSE_LATEX_OPTIONS: ParseLatexOptions = {
  applyInvisibleOperator: 'auto',
  skipSpace: true,

  parseArgumentsOfUnknownLatexCommands: true,
  parseNumbers: true,
  parseUnknownSymbol: (s: string, parser: Parser) => {
    if (parser.computeEngine?.lookupFunction(s) !== undefined)
      return 'function';
    if (/^[a-zA-Z]+$/.test(s)) return 'symbol';
    return 'unknown';
  },

  preserveLatex: false,
};

export class _Parser implements Parser {
  readonly computeEngine: IComputeEngine;
  readonly options: NumberFormattingOptions & ParseLatexOptions;

  index = 0;

  private readonly _tokens: LatexToken[];

  private _decimalMarkerTokens: LatexToken[];
  private readonly _dictionary: IndexedLatexDictionary;

  // A parsing boundary is a sequence of tokens that indicate that a
  // recursive parsing operation should stop.
  // In a traditional parser, keeping track of parsing boundaries would
  // not be necessary. However, because we attempt to deliver the best
  // interpretation of a partial expression, boundaries allow us to fail
  // parsing more locally.
  // For example, in `\begin{cases} | \end{cases}`, without boundary
  // detection, the parsing of `|` would attempt to goble up `\end{cases}`
  // which would be interpreted as an unexpected command, and the whole `\begin`
  // would be rejected as an unbalanced environment. With `\end{cases}` as a
  // boundary, the parsing of the `|` argument stops as soon as it encounters
  // the `\end{cases}` and can properly report an unexpected toke on the `|`
  // only while correctly interpreting the `\begin{cases}...\end{cases}`
  private _boundaries: { index: number; tokens: LatexToken[] }[] = [];

  // Those two properties are used to detect infinite loops while parsing
  private _lastPeek = '';
  private _peekCounter = 0;

  constructor(
    tokens: LatexToken[],
    options: NumberFormattingOptions & ParseLatexOptions,
    dictionary: IndexedLatexDictionary,
    computeEngine: IComputeEngine
  ) {
    this._tokens = tokens;
    this.options = {
      ...DEFAULT_LATEX_NUMBER_OPTIONS,
      ...DEFAULT_PARSE_LATEX_OPTIONS,
      ...options,
    };
    this._dictionary = dictionary;
    this.computeEngine = computeEngine;

    this._decimalMarkerTokens = tokenize(this.options.decimalMarker, []);
  }

  updateOptions(
    opt: Partial<NumberFormattingOptions> & Partial<ParseLatexOptions>
  ) {
    for (const [k, v] of Object.entries(opt)) {
      if (k in this.options) {
        this.options[k] = v;
        if (k === 'decimalMarker' && typeof v === 'string') {
          this._decimalMarkerTokens = tokenize(v, []);
        }
      } else throw Error(`Unexpected option "${k}"`);
    }
  }

  get atEnd(): boolean {
    return this.index >= this._tokens.length;
  }

  get peek(): LatexToken {
    const peek = this._tokens[this.index];
    if (peek === this._lastPeek) this._peekCounter += 1;
    else this._peekCounter = 0;
    if (this._peekCounter >= 1024) {
      console.error(
        `Infinite loop detected while parsing "${this.latex(0)}" at "${
          this._lastPeek
        }" (index ${this.index})`
      );
      throw new Error(
        `Infinite loop detected while parsing "${this.latex(0)}" at ${
          this._lastPeek
        } (index ${this.index})`
      );
    }
    this._lastPeek = peek;
    return peek;
  }

  next(): LatexToken {
    return this._tokens[this.index++];
  }

  /**
   * Return true if
   * - at end of the token stream
   * - the upcoming tokens match `t.tokens`
   * - the `t.condition` function returns true
   * Note: the `minPrec` condition is not checked. It should be checked separately.
   */
  atTerminator(t?: Terminator): boolean {
    if (this.atBoundary) return true;
    if (t?.condition && t.condition(this)) return true;
    return false;
  }

  /** True if the current token matches any of the boundaries we are waiting for */
  get atBoundary(): boolean {
    if (this.atEnd) return true;
    const start = this.index;
    for (const boundary of this._boundaries) {
      if (this.matchAll(boundary.tokens)) {
        this.index = start;
        return true;
      }
    }
    return false;
  }

  addBoundary(boundary: LatexToken[]): void {
    this._boundaries.push({ index: this.index, tokens: boundary });
  }

  removeBoundary(): void {
    this._boundaries.pop();
  }

  matchBoundary(): boolean {
    const currentBoundary = this._boundaries[this._boundaries.length - 1];
    const match = currentBoundary && this.matchAll(currentBoundary.tokens);
    if (match) this._boundaries.pop();
    return match;
  }

  boundaryError(msg: string | [string, ...Expression[]]): Expression {
    const currentBoundary = this._boundaries[this._boundaries.length - 1];
    this._boundaries.pop();
    return this.error(msg, currentBoundary.index);
  }

  latex(start: number, end?: number): string {
    return tokensToString(this._tokens.slice(start, end));
  }

  latexAhead(n: number): string {
    return this.latex(this.index, this.index + n);
  }
  latexBefore(): string {
    return this.latex(0, this.index);
  }
  latexAfter(): string {
    return this.latex(this.index);
  }

  /**
   * Return at most `this._dictionary.lookahead` strings made from the tokens
   * ahead.
   *
   * The index in the returned array correspond to the number of tokens.
   * Note that since a token can be longer than one char ('\\pi', but also
   * some astral plane unicode characters), the length of the string
   * does not match that index. However, knowing the index is important
   * to know by how many tokens to advance.
   *
   */
  lookAhead(): string[] {
    let n = Math.min(
      this._dictionary.lookahead,
      this._tokens.length - this.index
    );
    const result = Array<string>(n + 1);
    while (n > 0) result[n] = this.latexAhead(n--);

    return result;
  }

  /** Return all the definitions that potentially match the tokens ahead */
  peekDefinitions(kind: 'symbol'): [SymbolEntry, number][] | null;
  peekDefinitions(kind: 'postfix'): [PostfixEntry, number][] | null;
  peekDefinitions(kind: 'infix'): [InfixEntry, number][] | null;
  peekDefinitions(kind: 'prefix'): [PrefixEntry, number][] | null;
  peekDefinitions(
    kind: 'operator'
  ): [InfixEntry | PrefixEntry | PostfixEntry, number][] | null;
  peekDefinitions(
    kind: 'symbol' | 'infix' | 'prefix' | 'postfix' | 'operator'
  ): [IndexedLatexDictionaryEntry, number][] | null {
    let defs: (undefined | IndexedLatexDictionaryEntry[])[];
    if (kind === 'operator') {
      defs = this.lookAhead().map(
        (x, n) =>
          this._dictionary.infix[n]?.get(x) ??
          this._dictionary.postfix[n]?.get(x) ??
          this._dictionary.prefix[n]?.get(x)
      );
    } else {
      defs = this.lookAhead().map((x, n) => this._dictionary[kind][n]?.get(x));
    }
    const result: [IndexedLatexDictionaryEntry, number][] = [];
    for (let i = defs.length; i > 0; i--) {
      if (defs[i] !== undefined) {
        console.assert(Array.isArray(defs[i]));
        for (const def of defs[i]!) result.push([def, i]);
      }
    }
    return result.length === 0 ? null : result;
  }

  skipSpaceTokens(): void {
    while (this.match('<space>')) {}
  }

  /** While parsing in math mode, skip applicable spaces.
   * Do not use to skip spaces e.g. while parsing a string. See `skipSpaceTokens()` instead.
   */
  skipSpace(): boolean {
    // Check if there is a `{}` token sequence.
    // Those are used in LaTeX to force an invisible separation between commands
    // and are considered skipable space.
    if (!this.atEnd && this.peek === '<{>') {
      const index = this.index;
      this.next();
      while (this.match('<space>')) {}
      if (this.next() === '<}>') {
        this.skipSpace();
        return true;
      }

      this.index = index;
    }

    if (!this.options.skipSpace) return false;

    let result = false;
    while (this.match('<space>')) result = true;

    if (result) this.skipSpace();

    return result;
  }

  matchChar(): string | null {
    const index = this.index;
    let caretCount = 0;
    while (this.match('^')) caretCount += 1;
    if (caretCount >= 2) {
      let digits = '';
      let n = 0;
      while (n != caretCount) {
        const digit = this.matchAny([
          '0',
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
          '7',
          '8',
          '9',
          'a',
          'b',
          'c',
          'd',
          'e',
          'f',
        ]);
        if (!digit) break;
        digits += digit;
        n += 1;
      }
      if (digits.length === caretCount) {
        return String.fromCodePoint(Number.parseInt(digits, 16));
      }
    } else if (this.match('\\char')) {
      let codepoint = Math.floor(this.matchLatexNumber() ?? Number.NaN);
      if (
        !Number.isFinite(codepoint) ||
        codepoint < 0 ||
        codepoint > 0x10ffff
      ) {
        codepoint = 0x2753; // BLACK QUESTION MARK
      }
      return String.fromCodePoint(codepoint);
    } else if (this.match('\\unicode')) {
      this.skipSpaceTokens();
      if (this.peek === '<{>') {
        this.next();
        const codepoint = this.matchLatexNumber();

        if (
          this.match('<}>') &&
          codepoint !== null &&
          codepoint >= 0 &&
          codepoint <= 0x10ffff
        ) {
          return String.fromCodePoint(codepoint);
        }
      } else {
        const codepoint = this.matchLatexNumber();

        if (codepoint !== null && codepoint >= 0 && codepoint <= 0x10ffff) {
          return String.fromCodePoint(codepoint);
        }
      }
    }
    this.index = index;
    const nextToken = this.next();
    return nextToken;
  }

  matchColor(_background = false): string | null {
    let s = '';
    while (!this.atEnd && this.peek !== '}') s += this.next();

    // @todo: interpret the string according to `xcolor` (see
    return s;
  }

  matchLatexDimension(): string | null {
    // @todo
    return null;
  }

  match(token: LatexToken): boolean {
    if (this._tokens[this.index] === token) {
      this.index++;
      return true;
    }
    return false;
  }

  matchAll(tokens: LatexToken | LatexToken[]): boolean {
    if (typeof tokens === 'string') tokens = [tokens];

    let matched = true;
    let i = 0;
    do {
      matched = this._tokens[this.index + i] === tokens[i++];
    } while (matched && i < tokens.length);
    if (matched) this.index += i;

    return matched;
  }

  matchAny(tokens: LatexToken[]): LatexToken {
    if (tokens.includes(this._tokens[this.index]))
      return this._tokens[this.index++];

    return '';
  }

  matchSequence(tokens: LatexToken[]): LatexToken[] {
    const result: LatexToken[] = [];
    while (tokens.includes(this._tokens[this.index]))
      result.push(this._tokens[this.index++]);

    return result;
  }

  matchOptionalSign(): string {
    let isNegative = !!this.matchAny(['-', '\u2212']);
    while (this.matchAny(['+', '\ufe62']) || this.skipSpace())
      if (this.matchAny(['-', '\u2212'])) isNegative = !isNegative;

    return isNegative ? '-' : '+';
  }

  matchDecimalDigits(): string {
    let result = '';
    let done = false;
    while (!done) {
      result += this.matchSequence([
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
      ]).join('');
      done = true;
      if (this.options.groupSeparator) {
        const savedIndex = this.index;
        this.skipSpace();
        if (this.match(this.options.groupSeparator)) {
          this.skipSpace();
          // Are there more digits after a group separator
          if (/[0-9]/.test(this.peek)) done = false;
          else this.index = savedIndex;
        }
      }
    }
    return result;
  }

  matchSignedInteger(): string {
    const start = this.index;
    const sign = this.matchOptionalSign();
    const result = this.matchDecimalDigits();
    if (result) return sign === '-' ? '-' + result : result;

    this.index = start;
    return '';
  }

  matchExponent(): string {
    const start = this.index;

    if (this.matchAny(['e', 'E'])) {
      const exponent = this.matchSignedInteger();
      if (exponent) return 'e' + exponent;
      this.index = start;
    }

    if (this.match('\\times')) {
      this.skipSpace();
      if (this.match('1') && this.match('0') && this.match('^')) {
        // Is it a single digit exponent, i.e. `\times 10^5`
        if (/[0-9]/.test(this.peek)) return 'e' + this.next();

        if (this.match('<{>')) {
          // Multi digit exponent,i.e. `\times 10^{10}` or `\times 10^{-5}`
          this.skipSpace();
          const exponent = this.matchSignedInteger();
          this.skipSpace();
          if (this.match('<}>') && exponent) return 'e' + exponent;
        }
      }
    }

    this.index = start;
    return '';
  }

  matchNumber(): string {
    if (!this.options.parseNumbers) return '';
    const start = this.index;

    this.skipSpace();

    // Skip an optional '+' sign.
    // Important: the `-` sign is not handled as part of a number:
    // this is so we can correctly parse `-1^2` as `['Negate', ['Square', 1]]`
    this.match('+');

    // Does the number start with a decimal marker? i.e. `.5`
    let dotPrefix = false;

    if (this.matchAll(this._decimalMarkerTokens)) {
      const i = this.index;
      if (!this.matchAny(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])) {
        // A decimal marker followed by not a digit -> not a number
        this.index = start;
        return '';
      }
      // Rewind by 1
      this.index = i;
      dotPrefix = true;
    }

    let result = this.matchDecimalDigits();
    if (!result) {
      this.index = start;
      return '';
    }

    if (!dotPrefix && this.matchAll(this._decimalMarkerTokens)) {
      result += '.' + (this.matchDecimalDigits() ?? '0');
    }

    return (dotPrefix ? '0.' : '') + result + this.matchExponent();
  }

  /**
   * A Latex number can be a decimal, hex or octal number.
   * It is used in some Latex commands, such as `\char`
   *
   * From TeX:8695 (scan_int):
   * > An integer number can be preceded by any number of spaces and `+' or
   * > `-' signs. Then comes either a decimal constant (i.e., radix 10), an
   * > octal constant (i.e., radix 8, preceded by '), a hexadecimal constant
   * > (radix 16, preceded by "), an alphabetic constant (preceded by `), or
   * > an internal variable.
   */
  matchLatexNumber(isInteger = true): null | number {
    let negative = false;
    let token = this.peek;
    while (token === '<space>' || token === '+' || token === '-') {
      if (token === '-') negative = !negative;
      this.next();
      token = this.peek;
    }

    let radix = 10;
    let digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    if (this.match("'")) {
      // Apostrophe indicates an octal value
      radix = 8;
      digits = ['0', '1', '2', '3', '4', '5', '6', '7'];
      isInteger = true;
    } else if (this.match('"') || this.match('x')) {
      // Double-quote indicates a hex value
      // The 'x' prefix notation for the hexadecimal numbers is a MathJax extension.
      // For example: 'x3A'
      radix = 16;
      // Hex digits have to be upper-case
      digits = [
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
      ];
      isInteger = true;
    } else if (this.match('`')) {
      // A backtick indicates an alphabetic constant: a letter, or a single-letter command
      token = this.next();
      if (token) {
        if (token.startsWith('\\') && token.length === 2) {
          return (negative ? -1 : 1) * (token.codePointAt(1) ?? 0);
        }

        return (negative ? -1 : 1) * (token.codePointAt(0) ?? 0);
      }

      return null;
    }

    let value = '';
    while (digits.includes(this.peek)) {
      value += this.next();
    }

    // Parse the fractional part, if applicable
    if (!isInteger && this.match('.')) {
      value += '.';
      while (digits.includes(this.peek)) {
        value += this.next();
      }
    }

    const result: number = isInteger
      ? Number.parseInt(value, radix)
      : Number.parseFloat(value);
    if (Number.isNaN(result)) return null;
    return negative ? -result : result;
  }

  matchPrefixOperator(until?: Terminator): Expression | null {
    if (!until) until = { minPrec: 0 };
    if (!until.minPrec) until = { ...until, minPrec: 0 };

    const defs = this.peekDefinitions('prefix');
    if (defs === null) return null;
    const start = this.index;
    for (const [def, n] of defs) {
      this.index = start + n;
      const rhs = def.parse(this, until);
      if (rhs) return rhs;
    }
    this.index = start;
    return null;
  }

  matchInfixOperator(lhs: Expression, until?: Terminator): Expression | null {
    if (!until) until = { minPrec: 0 };
    if (!until.minPrec) until = { ...until, minPrec: 0 };

    const defs = this.peekDefinitions('infix');
    if (defs === null) return null;
    const start = this.index;
    for (const [def, n] of defs) {
      if (def.precedence >= until.minPrec) {
        this.index = start + n;
        const rhs = def.parse(this, until, lhs);
        if (rhs) return rhs;
      }
    }
    this.index = start;
    return null;
  }

  /**
   * - 'enclosure' : will look for an argument inside an enclosure (open/close fence)
   * - 'implicit': either an expression inside a pair of `()`, or just a primary
   *  (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)
   */
  matchArguments(
    kind: undefined | '' | 'enclosure' | 'implicit'
  ): Expression[] | null {
    if (!kind) return null;

    const savedIndex = this.index;

    const group = this.matchEnclosure();

    if (kind === 'enclosure' && head(group) === 'Delimiter') {
      // We got an enclosure i.e. `f(a, b, c)`
      if (op(group, 1) === 'Sequence') return ops(op(group, 1)) ?? [];
      return [op(group, 1) ?? 'Nothing'];
    }

    if (kind === 'implicit') {
      // We are looking for an expression inside an optional pair of `()`
      // (i.e. trig functions, as in `\cos x`.)
      if (head(group) === 'Delimiter') {
        if (op(group, 1) === 'Sequence') return ops(op(group, 1)) ?? [];
        return [op(group, 1) ?? 'Nothing'];
      }

      // Was there a matchfix? the "group" is the argument, i.e.
      // `\sin [a, b, c]`
      if (group !== null) return [group];

      // No group, but arguments without parentheses are allowed
      // Read a primary
      const primary = this.matchPrimary();
      if (primary !== null) return [primary];
      return null;
    }

    // The element following the function does not match
    // a possible argument list
    // That's OK, but need to undo the parsing of the matchfix
    // This is the case: `f[a]` or `f|a|`
    this.index = savedIndex;
    return null;
  }

  /** If matches the normalized open delimiter, return the
   * expected closing delimiter.
   *
   * For example, if `delimiter` is `(`, it would match `\left\lparen` and
   * return `['\right', '\rparen']`, which can be matched with `matchAll()`
   *
   * If you need to match several tokens, use `matchAll()`
   */
  matchOpenDelimiter(
    openDelim: Delimiter,
    closeDelim: Delimiter
  ): LatexToken[] | null {
    const index = this.index;

    const closePrefix = OPEN_DELIMITER_PREFIX[this.peek];
    if (closePrefix) this.next();

    const alternatives = DELIMITER_SHORTHAND[openDelim] ?? [openDelim];

    const result = closePrefix ? [closePrefix] : [];

    // Special case '||' delimiter
    if (alternatives.includes('||') && this.matchAll(['|', '|'])) {
      result.push('|');
      result.push('|');
      return result;
    }

    if (!alternatives.includes(this.peek)) {
      // Not the delimiter we were expecting: backtrack
      this.index = index;
      return null;
    }

    if (CLOSE_DELIMITER[openDelim] === closeDelim) {
      // If this is the standard pair (i.e. '(' and ')')
      // use the matching closing (i.e. '\lparen' -> '\rparen')
      result.push(CLOSE_DELIMITER[this.peek]);
    } else {
      result.push(closeDelim);
    }

    this.next();

    return result;
  }

  matchMiddleDelimiter(delimiter: '|' | ':' | LatexToken): boolean {
    const delimiters = MIDDLE_DELIMITER[delimiter] ?? [delimiter];
    if (MIDDLE_DELIMITER_PREFIX.includes(this.peek)) {
      const index = this.index;
      this.next();
      if (delimiters.includes(this.peek)) {
        this.next();
        return true;
      }
      this.index = index;
      return false;
    } else if (delimiters.include(this.peek)) {
      this.next();
      return true;
    }
    return false;
  }

  /**
   * An enclosure is an opening matchfix operator, an optional expression,
   * optionally followed multiple times by a separator and another expression,
   * and finally a closing matching operator.
   */
  matchEnclosure(): Expression | null {
    const defs = this._dictionary.matchfix;

    if (defs.length === 0) return null;

    const start = this.index;

    //
    // Try each def
    //
    for (const def of defs) {
      this.index = start;

      // The `openDelimiter` can be either an array of LatexToken
      // (for cases like `\langle\vert` as a delimiter)
      // or a Delimiter (limited set of special strings that get interpreted
      // as synonyms, e.g. '(' = '\lparen' = '\left(' =...)
      if (Array.isArray(def.openDelimiter)) {
        //
        // If we have an array of tokens, match them all
        //

        // 1. Match the opening delimiter
        if (!this.matchAll(def.openDelimiter)) continue;
        this.addBoundary(def.closeDelimiter as string[]);

        // 2. Collect the sequence in between the delimiters
        const body = this.matchExpression();
        this.skipSpace();

        // 3. Match the closing delimiter
        if (!this.matchBoundary()) {
          this.removeBoundary();
          continue;
        }

        const rhs = def.parse(this, body ?? 'Nothing');
        if (rhs === null) continue; // This def didn't work. Try another.
        return rhs;
      }
      //
      // We have a 'normalized' delimiter (i.e. '(' will match '(' or
      // '\lparen)
      //

      // 1. Match the opening delimiter
      const closeDelimiter = this.matchOpenDelimiter(
        def.openDelimiter,
        def.closeDelimiter as Delimiter
      );
      if (closeDelimiter === null) continue;

      if (this.matchAll(closeDelimiter)) {
        const result = def.parse(this, 'Nothing');
        if (result === null) continue; // This def didn't work. Try another.
        return result;
      }

      // 2. Collect the expression in between the delimiters
      this.addBoundary(closeDelimiter);
      const bodyStart = this.index;
      let body = this.matchExpression();
      this.skipSpace();
      if (!this.matchBoundary()) {
        // We couldn't parse the body up to the closing delimiter.
        // This could be a case where the boundary of the enclosure is
        // ambiguous, i.e. `|(a+|b|+c)|`. Attempt to parse without the boundary
        this.removeBoundary();
        this.index = bodyStart;
        body = this.matchExpression();
        // If still could not match, try another
        if (!this.matchAll(closeDelimiter)) {
          if (!this.atEnd) continue;
          // If we're at the end, we may need to backtrack and try again
          // That's the case for `|1+|2|+3|`
          this.index = bodyStart;
          return null;
        }
      }
      const result = def.parse(this, body ?? 'Nothing');
      if (result !== null) return result;
    }
    this.index = start;
    return null;
  }

  /**
   * Match a single variable name. It can be:
   * - a single letter: `x`, `i`
   * - a multi-letter variable: `\mathrm{speed}`
   * - a command: `\alpha`  @todo
   * - a complex name such as `\alpha_12` or `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}` (see serializer.ts) @todo:
   * @todo: matchSymbol should use matchVariable
   */
  matchVariable(): string | null {
    let result: string | null = null;
    if (
      this.match('\\operatorname') ||
      this.match('\\mathit') ||
      this.match('\\mathrm')
    ) {
      result = this.matchStringArgument();
      if (result === null || !isValidSymbolName(result)) null;
      return result;
    }

    result = this.peek;
    if (/[a-zA-Z]/.test(result)) return this.next();

    return null;
  }

  /**
   * A symbol can be:
   * - a constant: `\pi`
   * - a single-letter variable: `x`
   * - a multi-letter variable: `\mathit{speed}` or `\mathrm{speed}`
   * - a function with explicit arguments `f(x)`
   * - a function with implicit arguments: `\cos x`
   * - a command: `\frac{2}{3}`
   */
  matchSymbol(): Expression | null {
    const start = this.index;

    //
    // Is there a custom parser for this symbol?
    //
    const defs = this.peekDefinitions('symbol');
    if (defs) {
      for (const [def, tokenCount] of defs) {
        this.index = start + tokenCount;
        // @todo: should capture symbol, and check it is not in use as a symbol,  function, or inferred (calling parseUnknownSymbol() or somethinglike it (parseUnknownSymbol() may aggressively return 'symbol'...))
        if (typeof def.parse === 'function') {
          const result = def.parse(this);
          if (result) return result;
        } else return def.name!;
      }
    }

    // No custom parser worked. Backtrack.
    this.index = start;

    let sym: string | null = null;

    if (
      this.match('\\operatorname') ||
      this.match('\\mathit') ||
      this.match('\\mathrm')
    ) {
      sym = this.matchStringArgument();
      if (sym === null) return this.error('expected-string-argument', start);
      if (!isValidSymbolName(sym))
        return this.error('invalid-symbol-name', start);
    }

    //
    // Is this an unexpected operator?
    // (this is an error handling code path)
    //
    if (!sym) {
      let opDefs = this.peekDefinitions('operator');
      if (opDefs) {
        opDefs = this.peekDefinitions('postfix');
        if (opDefs) {
          const [def, n] = opDefs[0] as [PostfixEntry, number];
          this.index += n;
          if (typeof def.parse === 'function') {
            const result = def.parse(this, this.error('missing', start));
            if (result) return result;
          }
          if (def.name) return [def.name, this.error('missing', start)];
          return this.error('unexpected-operator', start);
        }

        // Check prefix before infix, to catch `-` as a single missing operand
        opDefs = this.peekDefinitions('prefix');
        if (opDefs) {
          const [def, n] = opDefs[0] as [PrefixEntry, number];
          this.index += n;
          if (typeof def.parse === 'function') {
            const result = def.parse(this, { minPrec: 0 });
            if (result) return result;
          }
          if (def.name)
            return [
              def.name,
              this.matchExpression() ?? this.error('missing', start),
            ];
          return this.error('unexpected-operator', start);
        }

        opDefs = this.peekDefinitions('infix');
        if (opDefs) {
          const [def, n] = opDefs[0] as [InfixEntry, number];
          this.index += n;
          if (typeof def.parse === 'function') {
            const result = def.parse(
              this,
              { minPrec: 0 },
              this.error('missing', start)
            );
            if (result) return result;
          }
          if (def.name)
            return [
              def.name,
              this.error('missing', start),
              this.matchExpression() ?? this.error('missing', start),
            ];
          return this.error('unexpected-operator', start);
        }
      }
    }

    // If we could not capture a symbol yet, simply use the next token.
    if (!sym) sym = this.next();

    if (sym && isValidSymbolName(sym)) {
      //
      // This is a symbol with no custom parsing.
      //

      // Are we OK with it as either a symbol or  function?
      const action = this.options.parseUnknownSymbol?.(sym, this);

      if (action === 'symbol') return sym;

      if (action === 'function') {
        // Is it followed by an argument list inside parentheses?
        const enclosure = this.matchEnclosure();
        // If no arguments, return it as a symbol
        if (enclosure === null) return sym;
        if (head(enclosure) !== 'Delimiter') return null;
        if (symbol(op(enclosure, 1)) === 'Nothing') return [sym];
        const h = head(op(op(enclosure, 1), 1));
        if (h === 'Sequence') return [sym, ...(ops(op(enclosure, 1)) ?? [])];
        return [sym, ...(ops(enclosure) ?? [])];
      }
    }
    // Backtrack
    this.index = start;

    // Not a symbol, maybe an unknown LaTeX command?
    return this.matchUnknownLatexCommand();
  }

  matchOptionalLatexArgument(): Expression | null {
    const index = this.index;
    this.skipSpaceTokens();
    if (this.match('[')) {
      this.addBoundary([']']);
      const expr = this.matchExpression();
      this.skipSpace();
      if (this.matchBoundary()) return expr;
      return this.boundaryError('expected-closing-delimiter');
    }
    this.index = index;
    return null;
  }

  matchRequiredLatexArgument(): Expression | null {
    const start = this.index;
    this.skipSpaceTokens();
    if (this.match('<{>')) {
      this.addBoundary(['<}>']);
      const expr = this.matchExpression();
      this.skipSpace();
      if (this.matchBoundary()) return expr;
      return this.boundaryError('expected-closing-delimiter');
    }

    // Is it a single digit?
    // Note: `x^23` is `x^{2}3`, not x^{23}
    if (/^[0-9]$/.test(this.peek)) return parseInt(this.next());

    // Is it a single letter (but not a special letter)?
    if (/^[^\\#]$/.test(this.peek)) return this.next();

    // Otherwise, this can only be a symbol.
    // `\frac{1}2+1` is not valid, neither is `\frac\frac123`
    const expr = this.matchSymbol();
    if (expr) return expr;

    this.index = start;
    return null;
  }

  matchSupsub(lhs: Expression | null): Expression | null {
    console.assert(lhs !== null); // @todo validate
    if (lhs === null) return null;

    const index = this.index;

    this.skipSpace();

    //
    // 1/ Gather possible superscript/subscripts
    //
    const superscripts: Expression[] = [];
    const subscripts: Expression[] = [];
    let subIndex = index;
    while (this.peek === '_' || this.peek === '^') {
      if (this.match('_')) {
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          subscripts.push(this.error('syntax-error', subIndex));
        else {
          const sub =
            this.matchRequiredLatexArgument() ?? this.matchStringArgument();
          if (!sub) return this.error('missing', index);

          subscripts.push(sub);
        }
      } else if (this.match('^')) {
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          superscripts.push(this.error('syntax-error', subIndex));
        else {
          const sup = this.matchRequiredLatexArgument();
          if (!sup) return this.error('missing', index);
          superscripts.push(sup);
        }
      }
      subIndex = this.index;
      this.skipSpace();
    }

    if (superscripts.length === 0 && subscripts.length === 0) {
      this.index = index;
      return lhs;
    }

    let result: Expression | null = lhs;

    //
    // 2/ Apply subscripts (first)
    //
    if (subscripts.length > 0) {
      const defs = this._dictionary.infix[1]?.get('_');
      if (defs) {
        const arg: Expression = [
          'Subscript',
          result,
          subscripts.length === 1 ? subscripts[0] : ['Sequence', ...subscripts],
        ];
        for (const def of defs) {
          if (typeof def.parse === 'function')
            result = def.parse(this, { minPrec: 0 }, arg);
          else result = arg;
          if (result) break;
        }
      }
    }

    //
    // 3/ Apply superscripts (second)
    //
    if (superscripts.length > 0) {
      const defs = this._dictionary.infix[1]?.get('^');
      if (defs) {
        const arg: Expression = [
          'Superscript',
          result!,
          superscripts.length === 1
            ? superscripts[0]
            : ['Sequence', ...superscripts],
        ];
        for (const def of defs) {
          if (typeof def.parse === 'function')
            result = def.parse(this, { minPrec: 0 }, arg);
          else result = arg;
          if (result) break;
        }
      }
    }

    // Restore the index if we did not find a match
    if (result === null) this.index = index;

    return result;
  }

  matchPostfix(lhs: Expression | null): Expression | null {
    console.assert(lhs !== null); // @todo validate
    if (lhs === null) return null;

    const defs = this.peekDefinitions('postfix');
    if (defs === null) return null;

    const start = this.index;
    for (const [def, n] of defs) {
      this.index = start + n;
      const result = def.parse(this, lhs);
      if (result !== null) return result;
    }
    this.index = start;
    return null;
  }

  /** Match a string used as a LaTeX identifier, for example an environment
   * name.
   * Not suitable for general purpose text, e.g. argument of a `\text{}
   * command. See `matchChar()` instead.
   */
  matchString(): string {
    let result = '';
    while (!this.atBoundary) {
      const token = this.peek;
      if (token === '<$>' || token === '<$$>') {
        return '';
      } else if (token === '<space>') {
        this.next();
        result += ' ';
      } else if (token[0] === '\\') {
        // TeX will give a 'Missing \endcsname inserted' error
        // if it encounters any command when expecting a string.
        // We're a bit more lax.
        result += this.next();
      } else {
        result += this.next();
      }
    }
    return result;
  }

  /** Match a string as an argument (in a `{}` pair) */
  matchStringArgument(): string | null {
    const start = this.index;
    this.skipSpaceTokens();
    if (this.match('<{>')) {
      this.addBoundary(['<}>']);
      // Don't use this.skipSpace(), as only the space token
      // should be skipped here, and regardless of the `options.skipSpace` setting
      while (this.match('<space>')) {}
      const arg = this.matchString();
      if (this.matchBoundary()) return arg.trimEnd();
      this.removeBoundary();
    }

    this.index = start;
    return null;
  }

  /**
   * Match an expression in a tabular format, where rows are separated by `\\`
   * and columns by `&`.
   *
   * Return rows of sparse columns: empty rows are indicated with `Nothing`,
   * and empty cells are also indicated with `Nothing`.
   */
  matchTabular(): null | Expression[][] {
    const result: Expression[][] = [];

    let row: Expression[] = [];
    let expr: Expression | null = null;
    while (!this.atBoundary) {
      this.skipSpace();

      if (this.match('&')) {
        // new column
        // Push even if expr is NULL (it represents a skipped column)
        row.push(expr ?? 'Nothing');
        expr = null;
      } else if (this.match('\\\\') || this.match('\\cr')) {
        // new row

        this.skipSpace();
        // Parse but drop optional argument (used to indicate spacing between lines)
        this.matchOptionalLatexArgument();

        if (expr !== null) row.push(expr);
        result.push(row);
        row = [];
        expr = null;
      } else {
        const cell: Expression[] = [];
        let peek = this.peek;
        while (
          peek !== '&' &&
          peek !== '\\\\' &&
          peek !== '\\cr' &&
          !this.atBoundary
        ) {
          expr = this.matchExpression({
            condition: (p) => {
              const peek = p.peek;
              return peek === '&' || peek === '\\\\' || peek === '\\cr';
            },
          });
          if (expr) cell.push(expr);
          else {
            cell.push(['Error', ["'unexpected-token'", peek]]);
            this.next();
          }
          this.skipSpace();
          peek = this.peek;
        }
        if (cell.length > 1) expr = ['Sequence', ...cell];
        else expr = cell[0] ?? 'Nothing';
      }
    }
    // Capture any leftover columns or row
    if (expr !== null) row.push(expr);
    if (row.length > 0) result.push(row);

    return result;
  }

  matchEnvironment(): Expression | null {
    const index = this.index;
    if (!this.match('\\begin')) return null;
    const name = this.matchStringArgument();

    if (name === null) return this.error('expected-environment-name', index);

    // @todo:parse optional and required arguments.

    this.addBoundary(['\\end', '<{>', ...name.split(''), '<}>']);

    const def = this._dictionary.environment.get(name);
    if (!def) {
      // If unknown environment, attempt to parse as tabular, but discard content

      this.matchTabular();
      this.skipSpace();

      if (!this.matchBoundary())
        return this.boundaryError('unbalanced-environment');
      return this.error(['unknown-environment', { str: name }], index);
    }

    const expr = def.parse(this, [], []);

    this.skipSpace();
    if (!this.matchBoundary())
      return this.boundaryError('unbalanced-environment');

    if (expr !== null) return this.decorate(expr, index);

    this.index = index;
    return null;
  }

  /**
   * Apply an invisible operator between two expressions.
   *
   * If the `lhs` is an literal integer and the `rhs` is a literal rational
   * -> 'invisible plus'
   *
   * That is '2 3/4' -> ['Add', 2, ['Rational', 3, 4]]
   *
   * If `lhs` is a number and `rhs` is a number but not a literal -> 'invisible multiply'.
   * - 2x
   * - 2(x+1)
   * - x(x+1)
   * - f(x)g(y)
   * - 2 sin(x)
   * - 2 f(x)
   * - x f(x)
   * - (x-1)(x+1)
   * - (x+1)2 -> no
   * - x2 -> no
   * => lhs is a number, rhs is a number, but not a literal
   */
  applyInvisibleOperator(
    terminator: Terminator,
    lhs: Expression | null
  ): Expression | null {
    if (lhs === null || head(lhs) === 'Error' || this.atTerminator(terminator))
      return null;

    if (this.options.applyInvisibleOperator === null) return null;

    //
    // If the right hand side is an operator, no invisible operator to apply
    //
    const opDefs = this.peekDefinitions('operator');
    if (opDefs !== null) return null;

    //
    // Capture a right hand side expression, if there is one
    //
    const start = this.index;
    const rhs = this.matchExpression({ ...terminator, minPrec: 390 });
    if (rhs === null || symbol(rhs) === 'Nothing') {
      this.index = start;
      return null;
    }

    if (head(rhs) === 'Error') {
      // If we got an error, apply a 'Sequence'
      return applyAssociativeOperator('Sequence', lhs, rhs);
    }

    //
    // Invoke custom `applyInvisibleOperator` handler
    //
    if (typeof this.options.applyInvisibleOperator === 'function')
      return this.options.applyInvisibleOperator(this, lhs, rhs);

    if (!this.computeEngine) return null;

    //
    // Is it a function application?
    //
    const lhsSymbol = symbol(lhs);
    if (lhsSymbol) {
      const isFunction =
        this.options.parseUnknownSymbol(lhsSymbol, this) === 'function';
      if (isFunction) {
        if (head(rhs) === 'Delimiter') {
          const op1 = op(rhs, 1);
          if (head(op1) === 'Sequence') return [lhsSymbol, ...(ops(op1) ?? [])];
          if (op1 && symbol(op1) !== 'Nothing') return [lhsSymbol, op1];
          return [lhsSymbol];
        }
        return lhsSymbol;
      }
    }

    //
    // Is it an invisible plus?
    //
    // Integer literal followed by a fraction -> Invisible Add
    // CAUTION: machineValue() only works for numbers in machine range. OK in this case.
    const lhsNumber = machineValue(lhs);
    if (lhsNumber !== null && Number.isInteger(lhsNumber)) {
      const rhsHead = head(rhs);
      if (rhsHead === 'Divide' || rhsHead === 'Rational') {
        const [n, d] = [machineValue(op(rhs, 1)), machineValue(op(rhs, 2))];
        if (
          n !== null &&
          d !== null &&
          n > 0 &&
          n <= 1000 &&
          d > 1 &&
          d <= 1000 &&
          Number.isInteger(n) &&
          Number.isInteger(d)
        )
          return ['Add', lhs, rhs];
      }
    }

    // If the value of `lhs` is a number and the value of `rhs` is a number
    // (but they may not be literal)
    // -> Apply Invisible Multiply
    if (symbol(rhs) === 'Nothing') return lhs;
    if (head(rhs) === 'Delimiter' && symbol(op(rhs, 1)) === 'Nothing')
      return ['Multiply', lhs, this.error('expected-expression', start)];
    if (head(rhs) === 'Delimiter' && head(op(rhs, 1)) === 'Sequence') {
      return [lhsSymbol ?? lhs, ...(ops(op(rhs, 1)) ?? [])];
    }
    return applyAssociativeOperator('Multiply', lhs, rhs);

    // ------

    // const rhs = this.engine.box(rawRhs);

    // // If the `lhs` is a symbol that has a function definition, do a
    // // functional application
    // const symbolName = symbol(rawLhs);
    // if (symbolName) {
    //   const def = this.engine.lookupFunctionName(symbolName);
    //   if (def) {
    //     let ops: BoxedExpression[] = [];
    //     if (rhs.head === 'Delimiter') {
    //       if (rhs.op1.head === 'Sequence') {
    //         ops = [...rhs.op1.ops!];
    //       } else ops = [rhs.op1];
    //     } else ops = [rhs];
    //     return [symbolName, ...ops.map((x) => x.json)];
    //   }
    // }

    // const rhsName = symbol(rawRhs);
    // if (rhsName) {
    //   const def = this.engine.lookupSymbolDefinition(rhsName);
    // }

    // const lhs = this.engine.box(rawLhs);

    // // Integer literal followed by a fraction -> Invisible Add
    // if (lhs.isLiteral && lhs.isInteger && rhs.isLiteral) {
    //   const [numer, denom] = rhs.rationalValue;
    //   if (numer !== null && denom !== null) return ['Add', rawLhs, rawRhs];
    // }

    // // If the value of `lhs` is a number and the value of `rhs` is a number
    // // (but they may not be literal)
    // // -> Apply Invisible Multiply
    // if (
    //   (lhs.isMissing || lhs.symbol === 'Nothing' || lhs.isNumber) &&
    //   (rhs.isMissing || rhs.symbol === 'Nothing' || rhs.isNumber)
    // ) {
    //   return applyAssociativeOperator('Multiply', rawLhs, rawRhs);
    // }

    this.index = start;
    return null;
  }

  matchUnknownLatexCommand(): Expression | null {
    const command = this.peek;

    const index = this.index;

    if (!command || command[0] !== '\\') return null;

    this.next();

    // Capture potential optional and required arguments
    // This is a lazy capture, to handle the case `\foo[\blah[12]\blarg]`.
    // However, a `[` (or `{`) could be e.g. inside a string and this
    // would fail to parse.
    // Since we're already in an error situation, though, probably OK.
    this.skipSpaceTokens();

    if (command === '\\end') {
      const name = this.matchStringArgument();
      if (name === null) return this.error('expected-environment-name', index);

      return this.error(['unbalanced-environment', { str: name }], index);
    }

    while (this.match('[')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== ']') {
        if (this.peek === '[') level += 1;
        if (this.peek === ']') level -= 1;
        this.next();
      }
      this.match(']');
    }

    while (this.match('<{>')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== '<}>') {
        if (this.peek === '<{>') level += 1;
        if (this.peek === '<}>') level -= 1;
        this.next();
      }
      this.match('<}>');
    }
    return this.error(['unexpected-command', { str: command }], index);
  }

  /**
   * <primary> :=
   * (<number> | <symbol> | <environment> | <matchfix-expr>) <subsup>* <postfix-operator>*
   *
   * <symbol> ::= (<symbol-id> | (<latex-command><latex-arguments>)) <arguments>
   *
   * <matchfix-expr> :=
   *  <matchfix-op-open> <expression> [<matchfix-op-separator> <expression>] <matchfix-op-close>
   *
   */
  matchPrimary(): Expression | null {
    if (this.atBoundary) return null;

    let result: Expression | null = null;
    const start = this.index;

    //
    // 1. Is it a group? (i.e. `{...}`)
    //
    // Unabalanced `<}>`? Syntax error
    if (this.match('<}>'))
      return this.error('unexpected-closing-delimiter', start);

    if (this.match('<{>')) {
      this.addBoundary(['<}>']);
      result = this.matchExpression();
      if (result === null) return this.boundaryError('expected-expression');

      if (!this.matchBoundary()) {
        return this.decorate(
          [
            'Sequence',
            result,
            this.boundaryError('expected-closing-delimiter'),
          ],
          start
        );
      }
    }

    //
    // 2. Is it a number?
    //
    if (result === null) {
      const num = this.matchNumber();
      if (num) result = { num };
    }

    //
    // 3. Is it an enclosure, i.e. a matchfix expression?
    //    (group fence, absolute value, integral, etc...)
    // (check before other LaTeX commands)
    //
    if (result === null) result = this.matchEnclosure();

    //
    // 4. Is it an environment?
    //    `\begin{...}...\end{...}`
    // (check before other LaTeX commands)
    //
    if (result === null) result = this.matchEnvironment();

    //
    // 5. Is it a symbol, a LaTeX command or a function call?
    //    `x` or `\pi'
    //    `f(x)` or `\sin(\pi)
    //    `\frac{1}{2}`
    //
    if (result === null) result = this.matchSymbol();

    //
    // 6. Are there postfix operators ?
    //
    if (result !== null) {
      result = this.decorate(result, start);
      let postfix: Expression | null = null;
      let index = this.index;
      do {
        postfix = this.matchPostfix(result);
        result = postfix ?? result;
        if (this.index === index && postfix !== null) {
          console.assert(this.index !== index, 'No token consumed');
          break;
        }
        index = this.index;
      } while (postfix !== null);
    }

    //
    // 7. Are there superscript or subfix operators?
    //
    if (result !== null) result = this.matchSupsub(result);

    return this.decorate(result, start);
  }

  /**
   *  Parse an expression:
   *
   * <expression> ::=
   *  | <primary>
   *  | <prefix-op> <primary>
   *  | <primary> <infix-op> <expression>
   *
   * Stop when an operator of precedence less than `until.minPrec` is encountered
   */
  matchExpression(until?: Partial<Terminator>): Expression | null {
    const start = this.index;

    this.skipSpace();

    if (this.atBoundary) {
      this.index = start;
      return null;
    }

    if (!until) until = { minPrec: 0 };
    if (until.minPrec === undefined) until.minPrec = 0;

    //
    // 1. Do we have a prefix operator?
    //
    let lhs = this.matchPrefixOperator({ ...until, minPrec: 0 } as Terminator);

    //
    // 2. Do we have a primary?
    // (if we had a prefix, it consumed the primary following it)
    //
    if (lhs === null) lhs = this.matchPrimary();

    //
    // 3. Are there some infix operators?
    //
    if (lhs) {
      let done = false;
      while (!done && !this.atTerminator(until as Terminator)) {
        this.skipSpace();

        let result = this.matchInfixOperator(lhs, until as Terminator);
        if (result === null) {
          // We've encountered something else than an infix operator
          // OR an infix operator with a lower priority.
          // Could be "y" after "x": time to apply the invisible operator
          result = this.applyInvisibleOperator(until as Terminator, lhs);
        }
        if (result !== null) {
          lhs = result;
        } else {
          // We could not apply the infix operator: the rhs may
          // have been a postfix operator, or something else
          done = true;
        }
      }
    }
    return this.decorate(lhs, start);
  }

  /**
   * Add LaTeX or other requested metadata to the expression
   */
  decorate(expr: Expression | null, start: number): Expression | null {
    if (expr === null) return null;
    if (!this.options.preserveLatex) return expr;

    const latex = this.latex(start, this.index);
    if (Array.isArray(expr)) {
      expr = { latex, fn: expr };
    } else if (typeof expr === 'number') {
      expr = { latex, num: Number(expr).toString() };
    } else if (typeof expr === 'string') {
      expr = { latex, sym: expr };
    } else if (typeof expr === 'object' && expr !== null) {
      expr.latex = latex;
    }
    return expr;
  }

  error(
    code: string | [string, ...Expression[]],
    fromToken: number
  ): Expression {
    if (typeof code === 'string')
      return [
        'Error',
        { str: code },
        [
          'Latex',
          {
            str: this.latex(fromToken, this.index),
          },
        ],
      ];

    return [
      'Error',
      ['ErrorCode', { str: code[0] }, ...code.slice(1)],
      [
        'Latex',
        {
          str: this.latex(fromToken, this.index),
        },
      ],
    ];
  }
}
