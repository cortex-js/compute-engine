/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-empty-function */

import {
  ParseLatexOptions,
  LatexToken,
  NumberFormattingOptions,
  Delimiter,
  Terminator,
  Parser,
  FunctionEntry,
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
  dictionary,
  getSequence,
  head,
  isEmptySequence,
  isValidIdentifier,
  machineValue,
  nops,
  op,
  ops,
  stringValue,
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
  imaginaryUnit: '\\imaginaryI',
  avoidExponentsInRange: [-7, 20],
};

export const DEFAULT_PARSE_LATEX_OPTIONS: ParseLatexOptions = {
  applyInvisibleOperator: 'auto',
  skipSpace: true,

  parseArgumentsOfUnknownLatexCommands: true,
  parseNumbers: true,
  parseUnknownIdentifier: (s: string, parser: Parser) => {
    if (parser.computeEngine?.lookupFunction(s) !== undefined)
      return 'function';
    if (/^[a-zA-Z]/.test(s)) return 'symbol';
    return 'unknown';
  },

  preserveLatex: false,
};

export class _Parser implements Parser {
  readonly computeEngine: IComputeEngine;
  readonly options: NumberFormattingOptions & ParseLatexOptions;

  index = 0;

  private readonly _tokens: LatexToken[];

  private _positiveInfinityTokens: LatexToken[];
  private _negativeInfinityTokens: LatexToken[];
  private _notANumberTokens: LatexToken[];
  private _decimalMarkerTokens: LatexToken[];
  private _groupSeparatorTokens: LatexToken[];
  private _exponentProductTokens: LatexToken[];
  private _beginExponentMarkerTokens: LatexToken[];
  private _endExponentMarkerTokens: LatexToken[];
  private _truncationMarkerTokens: LatexToken[];
  private _beginRepeatingDigitsTokens: LatexToken[];
  private _endRepeatingDigitsTokens: LatexToken[];
  private _imaginaryNumberTokens: LatexToken[];
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

    this._positiveInfinityTokens = tokenize(this.options.positiveInfinity, []);
    this._negativeInfinityTokens = tokenize(this.options.negativeInfinity, []);
    this._notANumberTokens = tokenize(this.options.notANumber, []);
    this._decimalMarkerTokens = tokenize(this.options.decimalMarker, []);
    this._groupSeparatorTokens = tokenize(this.options.groupSeparator, []);
    this._exponentProductTokens = tokenize(this.options.exponentProduct, []);
    this._beginExponentMarkerTokens = tokenize(
      this.options.beginExponentMarker,
      []
    );
    this._endExponentMarkerTokens = tokenize(
      this.options.endExponentMarker,
      []
    );
    this._truncationMarkerTokens = tokenize(this.options.truncationMarker, []);
    this._beginRepeatingDigitsTokens = tokenize(
      this.options.beginRepeatingDigits,
      []
    );
    this._endRepeatingDigitsTokens = tokenize(
      this.options.endRepeatingDigits,
      []
    );
    this._imaginaryNumberTokens = tokenize(this.options.imaginaryUnit, []);
  }

  updateOptions(
    opt: Partial<NumberFormattingOptions> & Partial<ParseLatexOptions>
  ) {
    for (const [k, v] of Object.entries(opt))
      if (k in this.options) {
        this.options[k] = v;
        if (typeof v === 'string') {
          if (k === 'positiveInfinity')
            this._positiveInfinityTokens = tokenize(v, []);
          if (k === 'negativeInfinity')
            this._negativeInfinityTokens = tokenize(v, []);
          if (k === 'notANumber') this._notANumberTokens = tokenize(v, []);
          if (k === 'decimalMarker')
            this._decimalMarkerTokens = tokenize(v, []);
          if (k === 'groupSeparator')
            this._groupSeparatorTokens = tokenize(v, []);
          if (k === 'exponentProduct')
            this._exponentProductTokens = tokenize(v, []);
          if (k === 'beginExponentMarker')
            this._beginExponentMarkerTokens = tokenize(v, []);
          if (k === 'endExponentMarker')
            this._endExponentMarkerTokens = tokenize(v, []);
          if (k === 'truncationMarker')
            this._truncationMarkerTokens = tokenize(v, []);
          if (k === 'beginRepeatingDigits')
            this._beginRepeatingDigitsTokens = tokenize(v, []);
          if (k === 'endRepeatingDigits')
            this._endRepeatingDigitsTokens = tokenize(v, []);
          if (k === 'imaginaryNumber')
            this._imaginaryNumberTokens = tokenize(v, []);
        }
      } else throw Error(`Unexpected option "${k}"`);
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
    if (n < 0) return [];
    const result = Array<string>(n + 1);
    while (n > 0) result[n] = this.latexAhead(n--);

    return result;
  }

  /** Return all the definitions that potentially match the tokens ahead */
  peekDefinitions(kind: 'function'): [FunctionEntry, number][] | null;
  peekDefinitions(kind: 'symbol'): [SymbolEntry, number][] | null;
  peekDefinitions(kind: 'postfix'): [PostfixEntry, number][] | null;
  peekDefinitions(kind: 'infix'): [InfixEntry, number][] | null;
  peekDefinitions(kind: 'prefix'): [PrefixEntry, number][] | null;
  peekDefinitions(
    kind: 'operator'
  ): [InfixEntry | PrefixEntry | PostfixEntry, number][] | null;
  peekDefinitions(
    kind: 'function' | 'symbol' | 'infix' | 'prefix' | 'postfix' | 'operator'
  ): [FunctionEntry | IndexedLatexDictionaryEntry, number][] | null {
    let defs: (undefined | IndexedLatexDictionaryEntry[])[];
    if (kind === 'function') {
      const start = this.index;
      if (
        this.match('\\operatorname') ||
        this.match('\\mathrm') ||
        this.match('\\mathit')
      ) {
        const fn = this.matchStringArgument();
        const n = this.index - start;
        this.index = start;
        if (fn !== null && this._dictionary.function.has(fn))
          return this._dictionary.function.get(fn)!.map((x) => [x, n]);

        return null;
      }
      return null;
    } else if (kind === 'operator') {
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

  /** Skip strictly `<space>` tokens.
   * To also skip `{}` see `skipSpace()`.
   * To skip visual space (e.g. `\,`) see `skipVisualSpace()`.
   */
  skipSpaceTokens(): void {
    while (this.match('<space>')) {}
  }

  /** While parsing in math mode, skip applicable spaces, which includes `{}`.
   * Do not use to skip spaces while parsing a string. See  `skipSpaceTokens()`
   * instead.
   */
  skipSpace(): boolean {
    if (!this.options.skipSpace) return false;

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

    let result = false;
    while (this.match('<space>')) result = true;

    if (result) this.skipSpace();

    return result;
  }

  skipVisualSpace(): void {
    if (!this.options.skipSpace) return;

    this.skipSpace();

    if (
      [
        '\\!',
        '\\,',
        '\\:',
        '\\;',
        '\\enskip',
        '\\enspace',
        '\\space',
        '\\quad',
        '\\qquad',
      ].includes(this.peek)
    ) {
      this.next();
      this.skipVisualSpace();
    }

    // @todo maybe also `\hspace` and `\hspace*` and `\hskip` and `\kern` with a glue param

    this.skipSpace();
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
    if (tokens.length === 0) return false;

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

  matchDecimalDigits(options?: { withGrouping?: boolean }): string {
    options ??= {};
    options.withGrouping ??= false;

    const result: string[] = [];
    let done = false;
    while (!done) {
      while (/^[0-9]$/.test(this.peek)) {
        result.push(this.next());
        this.skipVisualSpace();
      }

      done = true;
      if (options.withGrouping && this.options.groupSeparator) {
        const savedIndex = this.index;
        this.skipVisualSpace();
        if (this.matchAll(this._groupSeparatorTokens)) {
          this.skipVisualSpace();
          // Are there more digits after a group separator
          if (/^[0-9]$/.test(this.peek)) done = false;
          else this.index = savedIndex;
        }
      }
    }
    return result.join('');
  }

  matchSignedInteger(options?: { withGrouping?: boolean }): string {
    options ??= {};
    options.withGrouping ??= false;

    const start = this.index;

    const sign = this.matchOptionalSign();
    const result = this.matchDecimalDigits(options);
    if (result) return sign === '-' ? '-' + result : result;

    this.index = start;
    return '';
  }

  matchExponent(): string {
    const start = this.index;

    if (this.matchAny(['e', 'E'])) {
      // The exponent does not contain grouping markers. See
      // https://physics.nist.gov/cuu/Units/checklist.html  #16
      const exponent = this.matchSignedInteger({ withGrouping: false });
      if (exponent) return 'e' + exponent;
    }

    this.index = start;
    if (this.match('\\times')) {
      this.skipSpaceTokens();
      if (this.match('1') && this.match('0') && this.match('^')) {
        // Is it a single digit exponent, i.e. `\times 10^5`
        if (/^[0-9]$/.test(this.peek)) return 'e' + this.next();

        if (this.match('<{>')) {
          // Multi digit exponent,i.e. `\times 10^{10}` or `\times 10^{-5}`
          this.skipSpaceTokens();
          // Note: usually don't have group markers, but since we're inside
          // a `{}` there can't be ambiguity, so we're lenient
          const exponent = this.matchSignedInteger();
          this.skipSpaceTokens();
          if (this.match('<}>') && exponent) return 'e' + exponent;
        }
      }
    }

    this.index = start;
    // `%` is a synonym for `e-2`. See // https://physics.nist.gov/cuu/Units/checklist.html  #10
    this.skipSpaceTokens();
    if (this.match('\\%')) return `e-2`;

    this.index = start;
    if (this.matchAll(this._exponentProductTokens)) {
      this.skipSpaceTokens();
      if (this.matchAll(this._beginExponentMarkerTokens)) {
        this.skipSpaceTokens();
        const exponent = this.matchSignedInteger();
        this.skipSpaceTokens();
        if (this.matchAll(this._endExponentMarkerTokens) && exponent)
          return 'e' + exponent;
      }
    }

    this.index = start;
    return '';
  }

  matchRepeatingDecimal(): string {
    const start = this.index;
    let repeatingDecimals = '';
    if (this.match('(')) {
      repeatingDecimals = this.matchDecimalDigits();
      if (repeatingDecimals && this.match(')'))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    if (this.matchAll([`\\left`, '('])) {
      repeatingDecimals = this.matchDecimalDigits();
      if (repeatingDecimals && this.matchAll([`\\right`, ')']))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    if (this.matchAll([`\\overline`, '<{>'])) {
      repeatingDecimals = this.matchDecimalDigits();
      if (repeatingDecimals && this.match('<}>'))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    if (this.matchAll(this._beginRepeatingDigitsTokens)) {
      repeatingDecimals = this.matchDecimalDigits();
      if (repeatingDecimals && this.matchAll(this._endRepeatingDigitsTokens))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    return '';
  }

  matchNumber(): string {
    // If we don't parse numbers, we'll return them as individual tokens
    if (!this.options.parseNumbers) return '';

    const start = this.index;
    this.skipVisualSpace();

    // Skip an optional '+' sign.
    // Important: the `-` sign is not handled as part of a number:
    // this is so we can correctly parse `-1^2` as `['Negate', ['Square', 1]]`
    this.match('+');

    let result = '';

    // Does the number start with the decimal marker? i.e. `.5`
    let dotPrefix = false;

    if (this.match('.') || this.matchAll(this._decimalMarkerTokens)) {
      const peek = this.peek;
      // Include `(` for repeating decimals
      if (
        peek !== '\\overline' &&
        peek !== this._beginRepeatingDigitsTokens[0] &&
        !/[0-9\(]/.test(peek)
      ) {
        // A decimal marker followed by not a digit (and not a repeating decimal marker) -> not a number
        this.index = start;
        return '';
      }
      dotPrefix = true;
    } else {
      result = this.matchDecimalDigits({ withGrouping: true });
      if (!result) {
        this.index = start;
        return '';
      }
    }

    let hasDecimal = true;
    if (
      !dotPrefix &&
      (this.match('.') || this.matchAll(this._decimalMarkerTokens))
    )
      result += '.' + this.matchDecimalDigits({ withGrouping: true });
    else if (dotPrefix)
      result = '0.' + this.matchDecimalDigits({ withGrouping: true });
    else hasDecimal = false;

    if (hasDecimal) {
      const repeat = this.matchRepeatingDecimal();
      if (repeat) result += repeat;
      else if (
        this.match('\\ldots') ||
        this.matchAll(this._truncationMarkerTokens)
      ) {
        // We got a truncation marker, just ignore it.
      }
    }

    this.skipVisualSpace();
    return result + this.matchExponent();
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
   * - 'implicit': either an expression inside a pair of `()`, or just a product
   *  (i.e. we interpret `\cos 2x + 1` as `\cos(2x) + 1`)
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
      return [op(group, 1) ?? ['Sequence']];
    }

    if (kind === 'implicit') {
      // We are looking for an expression inside an optional pair of `()`
      // (i.e. trig functions, as in `\cos x`.)
      if (head(group) === 'Delimiter') {
        if (head(op(group, 1)) === 'Sequence') return getSequence(group) ?? [];
        return [op(group, 1) ?? ['Sequence']];
      }

      // Was there a matchfix? the "group" is the argument, i.e.
      // `\sin [a, b, c]`
      if (group !== null) return [group];

      // No group, but arguments without parentheses are allowed
      // Read a primary
      const primary = this.matchExpression({ minPrec: 390 });
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

  /**
   * A function can be followed by the following suffixes:
   * - a `\prime`, `\doubleprime`, `'`, `(n)` to indicate a derivative
   * - a subscript to indicate an argument
   * - an argument, optionally inside an enclosure
   */
  matchFunctionSuffix(): Expression | null {
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

  /** For error handling, when there is potentially a mismatched delimiter.
   * Return a LaTeX fragment of the expected closing delimiter
   */
  matchEnclosureOpen(): string | null {
    const defs = this._dictionary.matchfix;
    if (defs.length === 0) return null;

    const start = this.index;
    for (const def of defs) {
      this.index = start;
      if (Array.isArray(def.openDelimiter)) {
        if (this.matchAll(def.openDelimiter))
          return tokensToString(def.closeDelimiter);
        continue;
      }

      const closeDelimiter = this.matchOpenDelimiter(
        def.openDelimiter,
        def.closeDelimiter as Delimiter
      );
      if (closeDelimiter !== null) return tokensToString(closeDelimiter);
    }
    this.index = start;
    return null;
  }

  matchEnclosureClose(): string | null {
    const defs = this._dictionary.matchfix;
    if (defs.length === 0) return null;

    const start = this.index;
    for (const def of defs) {
      this.index = start;
      if (Array.isArray(def.closeDelimiter)) {
        if (this.matchAll(def.closeDelimiter))
          return tokensToString(def.openDelimiter);
        continue;
      }
      this.index = start;
      let peek = this.peek;
      const prefix = Object.keys(OPEN_DELIMITER_PREFIX).find(
        (x) => OPEN_DELIMITER_PREFIX[x] === peek
      );
      if (prefix) this.next();

      let openDelimiter: string[] = [];
      peek = this.peek;
      const matchingDelim = Object.keys(CLOSE_DELIMITER).find(
        (x) => CLOSE_DELIMITER[x] === peek
      );
      if (matchingDelim) openDelimiter = [matchingDelim];

      if (prefix) openDelimiter = [prefix, ...openDelimiter];
      if (openDelimiter.length > 0) {
        this.next();
        return tokensToString(openDelimiter);
      }
    }
    this.index = start;
    return null;
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

        const rhs = def.parse(this, body ?? ['Sequence']);
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
        const result = def.parse(this, ['Sequence']);
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
          this.index = start;
          return null;
        }
      }
      const result = def.parse(this, body ?? ['Sequence']);
      if (result !== null) return result;
    }
    this.index = start;
    return null;
  }

  /**
   * Match an identifier. It can be:
   * - a symbol
   * - a simple multi-letter identifier: `\mathrm{speed}`
   * - a complex multi-letter identifier: `\mathrm{\alpha_{12}}` or `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
   * - a command: `\alpha`  @todo
   */
  matchIdentifier(): string | Expression | null {
    if (
      this.match('\\operatorname') ||
      this.match('\\mathit') ||
      this.match('\\mathrm')
    ) {
      const start = this.index;
      const id = this.matchStringArgument();
      if (id === null) return this.error('expected-string-argument', start);

      if (id === null || !isValidIdentifier(id))
        return this.error('invalid-symbol-name', start);
      return id;
    }

    if (/^[a-zA-Z]$/.test(this.peek)) return this.next();

    return null;
  }

  /**
   * A function is a function identifier followed by arguments
   * - a function with explicit arguments `f(x)`
   * - a function with explicit arguments `\mathrm{floor}(x)`
   * - a function name: `\mathrm{floor}`
   * - a function with implicit arguments: `\cos x` (via a  custom parser)
   *
   */

  matchFunction(): Expression | null {
    const start = this.index;
    //
    // Is there a definition for this as a function?
    // (a string wrapped in `\\mathrm`, etc...) with some optional arguments
    //
    const fnDefs = this.peekDefinitions('function');
    if (fnDefs) {
      for (const [def, tokenCount] of fnDefs) {
        this.index = start + tokenCount;
        if (typeof def.parse === 'function') {
          const result = def.parse(this);
          if (result) return result;
        } else {
          // Is it followed by an argument list inside parentheses?
          const seq = this.matchArguments('enclosure');
          return seq ? [def.name!, ...seq] : def.name!;
        }
      }
    }

    this.index = start;

    //
    // No known function definition matched
    // Capture a function name
    //

    const fn = this.matchIdentifier();
    if (fn === null) {
      this.index = start;
      return null;
    }
    // If not a string, this was a malformed name (invalid identifier)
    if (typeof fn !== 'string') return fn;

    //
    // Is it a generic multi-char function identifier?
    //
    if (this.options.parseUnknownIdentifier?.(fn, this) === 'function') {
      // Function application:
      // Is it followed by an argument list inside parentheses?
      const seq = this.matchArguments('enclosure');
      return seq ? [fn, ...seq] : fn;
    }

    this.index = start;
    return null;
  }

  /**
   * A symbol can be:
   * - a single-letter variable: `x`
   * - a single LaTeX command: `\pi`
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
        // @todo: should capture symbol, and check it is not in use as a symbol,  function, or inferred (calling parseUnknownIdentifier() or somethinglike it (parseUnknownIdentifier() may aggressively return 'symbol'...)). Maybe not during parsing, but canonicalization
        if (typeof def.parse === 'function') {
          const result = def.parse(this);
          if (result) return result;
        } else return def.name!;
      }
    }

    // No custom parser worked. Backtrack.
    this.index = start;

    const id = this.matchIdentifier();

    // No match. Backtrack and exit.
    if (id === null) {
      this.index = start;
      return null;
    }

    // Was there an error? Return it.
    if (typeof id !== 'string') return id;

    // Are we OK with it as a symbol?
    if (id && this.options.parseUnknownIdentifier?.(id, this) === 'symbol')
      return id;

    // Backtrack
    this.index = start;
    return null;
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

  matchRequiredLatexArgument(excluding?: string[]): Expression | null {
    if (!excluding)
      excluding = [...'!"#$%&(),/;:?@[]`|~'.split(''), '\\left', '\\bigl'];
    const start = this.index;
    this.skipSpaceTokens();
    if (this.match('<{>')) {
      this.addBoundary(['<}>']);
      const expr = this.matchExpression();
      this.skipSpace();
      if (this.matchBoundary()) return expr ?? ['Sequence'];
      return this.boundaryError('expected-closing-delimiter');
    }

    if (excluding.includes(this.peek)) {
      this.index = start;
      return null;
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

  missingIfEmptyRequiredLatexArgument(): Expression {
    const expr = this.matchRequiredLatexArgument();
    return this.missingIfEmpty(expr);
  }

  missingIfEmpty(expr: Expression | null): Expression {
    if (expr === null) {
      // No Expression and the parser.index should be at the right spot for it
      // The latex will be empty in this case
      return this.missing(this.index);
    } else if (isEmptySequence(expr)) {
      // Empty sequence so parser.index will be one more than where the missing
      // element should be.
      // The latex will be `}` which isn't very useful but it does identify this is
      // inside of a group.
      return this.missing(this.index - 1);
    } else {
      return expr;
    }
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
          if (sub === null) return this.missing(index);

          subscripts.push(sub);
        }
      } else if (this.match('^')) {
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          superscripts.push(this.error('syntax-error', subIndex));
        else {
          const sup = this.matchRequiredLatexArgument();
          if (sup === null) return this.missing(index);
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
          subscripts.length === 1 ? subscripts[0] : ['List', ...subscripts],
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
            : ['List', ...superscripts],
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
    if (
      lhs === null ||
      head(lhs) === 'Error' ||
      symbol(lhs) === 'Nothing' ||
      isEmptySequence(lhs) ||
      this.atTerminator(terminator) ||
      this.options.applyInvisibleOperator === null
    )
      return null;

    //
    // If the right hand side is an operator, no invisible operator to apply
    //
    if (this.peekDefinitions('operator') !== null) return null;

    //
    // Capture a right hand side expression, if there is one
    //
    const start = this.index;
    const rhs = this.matchExpression({ ...terminator, minPrec: 390 });
    if (rhs === null || symbol(rhs) === 'Nothing' || isEmptySequence(rhs)) {
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

    //
    // Is it a function application?
    //
    const lhsSymbol = symbol(lhs);
    if (lhsSymbol) {
      const isFunction =
        this.options.parseUnknownIdentifier(lhsSymbol, this) === 'function';
      if (isFunction) {
        const seq = getSequence(rhs);
        return seq ? [lhs, ...seq] : lhsSymbol;
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
    // if (symbol(rhs) === 'Nothing') return lhs;
    if (head(rhs) === 'Delimiter') {
      if (head(op(rhs, 1)) === 'Sequence')
        return [lhsSymbol ?? lhs, ...(ops(op(rhs, 1)) ?? [])];

      if (!op(rhs, 1) || symbol(op(rhs, 1)) === 'Nothing')
        return applyAssociativeOperator(
          'Sequence',
          lhs,
          this.error('expected-expression', start)
        );
    }
    if (
      head(rhs) === 'Sequence' ||
      head(lhs) === 'Sequence' ||
      stringValue(lhs) !== null ||
      stringValue(rhs) !== null ||
      dictionary(lhs) !== null ||
      dictionary(rhs) !== null
    )
      return applyAssociativeOperator('Sequence', lhs, rhs);

    return applyAssociativeOperator('Multiply', lhs, rhs);
  }

  matchUnexpectedLatexCommand(): Expression | null {
    const start = this.index;

    //
    // Is this an unexpected operator?
    // (this is an error handling code path)
    //
    let opDefs = this.peekDefinitions('operator');
    if (opDefs) {
      opDefs = this.peekDefinitions('postfix');
      if (opDefs) {
        const [def, n] = opDefs[0] as [PostfixEntry, number];
        this.index += n;
        if (typeof def.parse === 'function') {
          const result = def.parse(this, this.missing(start));
          if (result) return result;
        }
        if (def.name) return [def.name, this.missing(start)];
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
          return [def.name, this.matchExpression() ?? this.missing(start)];
        return this.error('unexpected-operator', start);
      }

      opDefs = this.peekDefinitions('infix');
      if (opDefs) {
        const [def, n] = opDefs[0] as [InfixEntry, number];
        this.index += n;
        if (typeof def.parse === 'function') {
          const result = def.parse(this, { minPrec: 0 }, this.missing(start));
          if (result) return result;
        }
        if (def.name)
          return [
            def.name,
            this.missing(start),
            this.matchExpression() ?? this.missing(start),
          ];
        return this.error('unexpected-operator', start);
      }
    }

    const command = this.peek;
    if (!command || command[0] !== '\\') return null;

    this.next();

    this.skipSpaceTokens();

    if (command === '\\end') {
      const name = this.matchStringArgument();
      if (name === null) return this.error('expected-environment-name', start);

      return this.error(['unbalanced-environment', { str: name }], start);
    }

    // Capture potential optional and required LaTeX arguments
    // This is a lazy capture, to handle the case `\foo[\blah[12]\blarg]`.
    // However, a `[` (or `{`) could be e.g. inside a string and this
    // would fail to parse.
    // Since we're already in an error situation, though, probably OK.
    while (this.match('[')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== ']') {
        if (this.peek === '[') level += 1;
        if (this.peek === ']') level -= 1;
        this.next();
      }
      this.match(']');
    }

    const index = this.index;
    this.index = start;
    const closeDelimiter = this.matchEnclosureOpen();
    if (closeDelimiter)
      return this.error(['expected-close-delimiter', closeDelimiter], index);

    const openDelimiter = this.matchEnclosureClose();
    if (openDelimiter)
      return this.error(['expected-open-delimiter', openDelimiter], start);

    // Capture any potential arguments to this unexpected command
    this.index = index;

    while (this.match('<{>')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== '<}>') {
        if (this.peek === '<{>') level += 1;
        if (this.peek === '<}>') level -= 1;
        this.next();
      }
      this.match('<}>');
    }

    return this.error(['unexpected-command', { str: command }], start);
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

    if (result === null && this.matchAll(this._positiveInfinityTokens))
      result = { num: '+Infinity' };
    if (result === null && this.matchAll(this._negativeInfinityTokens))
      result = { num: '-Infinity' };
    if (result === null && this.matchAll(this._notANumberTokens))
      result = { num: 'NaN' };

    if (result === null) result = this.matchFunction() ?? this.matchSymbol();

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
    // 7. We've encountered an unexpected LaTeX command
    //
    if (result === null) result = this.matchUnexpectedLatexCommand();

    //
    // 8. Are there superscript or subfix operators?
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
    if (lhs === null) {
      lhs = this.matchPrimary();
      // If we got an empty sequence, ignore it.
      // This is returned by some purely presentational commands, for example `\displaystyle`
      if (head(lhs) === 'Sequence' && nops(lhs) === 0) lhs = null;
    }

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
  decorate(expr: Expression, start: number): Expression;
  decorate(expr: Expression | null, start: number): Expression | null;
  decorate(expr: Expression | null, start: number): Expression | null {
    if (expr === null) return null;
    if (!this.options.preserveLatex) return expr;

    const latex = this.latex(start, this.index);
    // start and this.index are indexes in the tokens array
    // for sourceOffsets we want indexes in the source latex
    const latexBeforeLength = this.latex(0, start).length;
    const sourceOffsets: [number, number] = [
      latexBeforeLength,
      latexBeforeLength + latex.length,
    ];
    if (Array.isArray(expr)) {
      expr = { latex, sourceOffsets, fn: expr };
    } else if (typeof expr === 'number') {
      expr = { latex, sourceOffsets, num: Number(expr).toString() };
    } else if (typeof expr === 'string') {
      expr = { latex, sourceOffsets, sym: expr };
    } else if (typeof expr === 'object' && expr !== null) {
      expr.latex = latex;
      expr.sourceOffsets = sourceOffsets;
    }
    return expr;
  }

  missing(fromToken: number): Expression {
    const maybeDecorated = this.decorate(
      [
        'Error',
        { str: 'missing' },
        [
          'Latex',
          {
            str: this.latex(fromToken, this.index),
          },
        ],
      ],
      fromToken
    );
    // TODO: it might be better to manually construct the decorated expression
    // if this.options.preserveLatex
    if (
      !Array.isArray(maybeDecorated) &&
      typeof maybeDecorated === 'object' &&
      maybeDecorated !== null &&
      maybeDecorated.sourceOffsets
    ) {
      // TODO: this might be wrong in some cases we need to check various
      // cases. Currently the missing error shows the latex of the operator
      // that "caused" the error.
      maybeDecorated.sourceOffsets[1] = maybeDecorated.sourceOffsets[0];
    }
    return maybeDecorated;
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
