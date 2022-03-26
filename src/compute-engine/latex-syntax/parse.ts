/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-empty-function */
import { Expression } from '../../math-json/math-json-format';
import {
  ParseLatexOptions,
  LatexToken,
  NumberFormattingOptions,
  Delimiter,
  Terminator,
  Parser,
} from './public';
import { tokensToString } from './tokenizer';
import {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
  InfixEntry,
  PostfixEntry,
  PrefixEntry,
  SymbolEntry,
} from './dictionary/definitions';
import { WarningSignalHandler } from '../../common/signals';
import { BoxedExpression, IComputeEngine } from '../public';
import {
  applyAssociativeOperator,
  head,
  symbol,
  tail,
} from '../../math-json/utils';

/** These delimiters can be used as 'shorthand' delimiters in
 * `openDelimiter` and `closeDelimiter` for `matchfix` operators */
const SHORTHAND_DELIMITER = {
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

//Maps an open delimiter prefix to the corresponding close delimiter prefix
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

const CLOSE_DELIMITERS = {
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
  decimalMarker: '.',
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
  parseUnknownToken: (token: LatexToken) => {
    if (
      [
        '\\displaystyle',
        '\\!',
        '\\:',
        '\\enskip',
        '\\quad',
        '\\,',
        '\\;',
        '\\enspace',
        '\\qquad',
        '\\selectfont',
        '\\tiny',
        '\\scriptsize',
        '\\footnotesize',
        '\\small',
        '\\normalsize',
        '\\large',
        '\\Large',
        '\\LARGE',
        '\\huge',
        '\\Huge',
      ].includes(token)
    ) {
      return 'skip';
    }
    if (/^[fg]$/.test(token)) return 'function';
    if (/^[a-zA-Z]$/.test(token)) return 'symbol';
    return 'error';
  },

  preserveLatex: true,
};

export class _Parser implements Parser {
  readonly onError: WarningSignalHandler;
  readonly options: NumberFormattingOptions & ParseLatexOptions;
  readonly engine: IComputeEngine;

  readonly _dictionary: IndexedLatexDictionary;

  index = 0;

  // Those two properties are used to detect infinite loops
  _lastPeek = '';
  _peekCounter = 0;

  readonly _tokens: LatexToken[];

  constructor(
    tokens: LatexToken[],
    options: NumberFormattingOptions & ParseLatexOptions,
    dictionary: IndexedLatexDictionary,
    computeEngine: IComputeEngine,
    onError: WarningSignalHandler
  ) {
    this.options = {
      ...DEFAULT_LATEX_NUMBER_OPTIONS,
      ...DEFAULT_PARSE_LATEX_OPTIONS,
      ...options,
    };
    this.engine = computeEngine;
    this._tokens = tokens;

    this.onError = onError;
    this._dictionary = dictionary;
  }

  updateOptions(
    opt: Partial<NumberFormattingOptions> & Partial<ParseLatexOptions>
  ) {
    for (const [k, v] of Object.entries(opt)) this.options[k] = v;
  }

  // @todo: deprecate it (use terminator)
  clone(start: number, end: number): Parser {
    return new _Parser(
      this._tokens.slice(start, end),
      this.options,
      this._dictionary,
      this.engine,
      this.onError
    );
  }

  get atEnd(): boolean {
    return this.index >= this._tokens.length;
  }

  get peek(): LatexToken {
    if (this._tokens[this.index] === this._lastPeek) this._peekCounter += 1;
    else this._peekCounter = 0;
    console.assert(
      this._peekCounter < 1024,
      'Infinite loop detected in the scanner'
    );
    if (this._peekCounter >= 1024) throw new Error('Infinite loop');
    this._lastPeek = this._tokens[this.index];
    return this._tokens[this.index];
  }

  /**
   * Return true if
   * - at end of the token stream
   * - the upcoming tokens match `t.tokens`
   * - the `t.condition` function returns true
   * Note: the `minPrec` condition is not checked. It should be checked separately.
   */
  atTerminator(t?: Terminator): boolean {
    const start = this.index;
    if (this.atEnd) return true;
    if (!t) return false;
    if (t.condition && t.condition(this)) return true;
    if (t.tokens && t.tokens.length > 0 && this.matchAll(t.tokens)) {
      this.index = start;
      return true;
    }
    return false;
  }

  latex(start: number, end?: number): string {
    return tokensToString(this._tokens.slice(start, end));
  }

  latexAhead(n: number): string {
    return tokensToString(this._tokens.slice(this.index, this.index + n));
  }
  latexBefore(): string {
    return this.latex(0, this.index);
  }
  latexAfter(): string {
    return this.latex(this.index);
  }

  /**
   * Return at most `lookahead` strings made from the tokens
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
    const result: string[] = [];
    while (n > 0) {
      result[n] = this.latexAhead(n--);
    }
    return result;
  }

  /** Return all the definitions that potentially match the tokens ahead */
  peekDefinitions(kind: 'symbol'): [SymbolEntry, number][] | null;
  peekDefinitions(kind: 'postfix'): [PostfixEntry, number][] | null;
  peekDefinitions(kind: 'postfix'): [PostfixEntry, number][] | null;
  peekDefinitions(
    kind: 'operator'
  ): [InfixEntry | PrefixEntry | PostfixEntry, number][] | null;
  peekDefinitions(kind: 'infix'): [InfixEntry, number][] | null;
  peekDefinitions(kind: 'prefix'): [PrefixEntry, number][] | null;
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

  next(): LatexToken {
    return this._tokens[this.index++];
  }

  skipSpace(): boolean {
    // Check if the have a `{}` token sequence.
    // Those are used in LaTeX to force an invisible separation between commands
    if (
      !this.atEnd &&
      this.peek === '<{>' &&
      this._tokens[this.index + 1] === '<}>'
    ) {
      this.index += 2;
      this.skipSpace();
      return true;
    }

    let result = false;

    // Check if we have an ignorable command (e.g. \displaystyle and other
    // purely presentational commands)
    while (
      !this.atEnd &&
      this.options.parseUnknownToken?.(this.peek, this) === 'skip'
    ) {
      this.index += 1;
      this.skipSpace();
      result = true;
    }

    if (!this.options.skipSpace) return false;
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
      if (this.peek === '<{>') {
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
    if (tokens.includes(this._tokens[this.index])) {
      return this._tokens[this.index++];
    }
    return '';
  }

  matchWhile(tokens: LatexToken[]): LatexToken[] {
    const result: LatexToken[] = [];
    while (tokens.includes(this._tokens[this.index])) {
      result.push(this._tokens[this.index++]);
    }
    return result;
  }

  matchSign(): string {
    let isNegative = false;
    let done = false;
    while (!done) {
      if (this.skipSpace()) {
        done = false;
      } else if (this.matchAny(['-', '\u2212'])) {
        isNegative = !isNegative;
        done = false;
      } else if (this.matchAny(['+', '\ufe62'])) {
        done = false;
      } else {
        done = true;
      }
    }
    return isNegative ? '-' : '+';
  }

  matchDecimalDigits(): string {
    let result = '';
    let done = false;
    while (!done) {
      result += this.matchWhile([
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
          if (/[0-9]/.test(this.peek)) {
            done = false; // There are more digits after a group separator
          } else {
            this.index = savedIndex;
          }
        }
      }
    }
    return result;
  }

  matchSignedInteger(): string {
    const start = this.index;
    const sign = this.matchSign();
    const result = this.matchDecimalDigits();
    if (result) return (sign === '-' ? '-' : '') + result;

    this.index = start;
    return '';
  }

  matchExponent(): string {
    const start = this.index;
    let result = '';

    if (this.matchAny(['e', 'E'])) {
      const exponent = this.matchSignedInteger();
      if (exponent) result = 'e' + exponent;
    }
    if (result) return result;

    if (this.match('\\times')) {
      this.skipSpace();
      if (this.match('1') && this.match('0') && this.match('^')) {
        if (/[0-9]/.test(this.peek)) {
          // single digit exponent, i.e. `\times 10^5`
          return 'e' + this.next();
        }
        if (this.match('<{>')) {
          // Multi digit exponent,i.e. `\times 10^{10}` or `\times 10^{-5}`
          this.skipSpace();
          const exponent = this.matchSignedInteger();
          this.skipSpace();
          if (this.match('<}>') && exponent) {
            return 'e' + exponent;
          }
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

    // Does the number start with a dot prefix? i.e. `.5`
    let dotPrefix = false;

    if (this.match(this.options.decimalMarker)) {
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

    if (!dotPrefix && this.match(this.options.decimalMarker ?? '')) {
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
      // For example: 'x3a'
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
   * 'group' : will look for an argument inside a pair of `()`
   * 'implicit': either an expression inside a pair of `()`, or just a primary
   *  (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)
   */
  matchArguments(
    kind: undefined | '' | 'group' | 'implicit'
  ): Expression[] | null {
    if (!kind) return null;

    const savedIndex = this.index;
    let result: Expression[] | null = null;

    const group = this.matchEnclosure();

    if (kind === 'group' && head(group) === 'Delimiter') {
      // We got a group i.e. `f(a, b, c)`
      result = tail(group);
    } else if (kind === 'implicit') {
      // We are looking for an expression inside an optional pair of `()`
      // (i.e. trig functions, as in `\cos x`.)
      if (head(group) === 'Delimiter') {
        result = tail(group);
      } else if (group !== null) {
        // There was a matchfix, the "group" is the argument, i.e.
        // `\sin [a, b, c]`
        result = [group];
      } else {
        // No group, but arguments without parentheses are allowed
        // Read a primary
        const primary = this.matchPrimary();
        if (primary !== null) result = [primary];
      }
    } else {
      // The element following the function does not match
      // a possible argument list
      // That's OK, but need to undo the parsing of the matchfix
      // This is the case: `f[a]` or `f|a|`
      this.index = savedIndex;
    }
    return result;
  }

  /** If matches the normalized open delimiter, returns the
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

    const alternatives = SHORTHAND_DELIMITER[openDelim] ?? [openDelim];

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

    if (CLOSE_DELIMITERS[openDelim] === closeDelim) {
      // If this is the standard pair (i.e. '(' and ')')
      // use the matching closing (i.e. '\lparen' -> '\rparen')
      result.push(CLOSE_DELIMITERS[this.peek]);
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
   * An enclosure is an opening matchfix operator, an expression, optionally
   * followed multiple times by a separator and another expression,
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

        // 2. Collect the sequence in between the delimiters
        const body = this.matchExpression({
          tokens: def.closeDelimiter as string[],
          minPrec: 0,
        });

        // 3. Match the closing delimiter
        this.skipSpace();
        if (!this.matchAll(def.closeDelimiter)) continue;

        if (typeof def.parse === 'function') {
          const rhs = def.parse(this, body ?? 'Nothing');
          if (rhs === null) continue; // This def didn't work. Try another.
          return rhs;
        }
        console.assert(def.name);
        return [def.name!, body ?? 'Nothing'];
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

      // 2. Collect the expression in between the delimiters
      const body = this.matchExpression({ minPrec: 0, tokens: closeDelimiter });
      if (body && this.matchAll(closeDelimiter)) {
        if (typeof def.parse === 'function') {
          const result = def.parse(this, body ?? 'Nothing');
          if (result === null) continue; // This def didn't work. Try another.
          return result;
        }
        console.assert(def.name);
        return [def.name!, body];
      }
    }
    this.index = start;
    return null;
  }

  /**
   * A symbol can be:
   * - a constant: `\pi`
   * - a variable: `x`
   * - a function with explicit arguments `f(x)`
   * - a function with implicit arguments: `\cos x`
   * - a command: `\frac{2}{3}`
   */
  matchSymbol(): Expression | null {
    const start = this.index;

    const defs = this.peekDefinitions('symbol');
    if (defs) {
      for (const [def, tokenCount] of defs) {
        let result: Expression | null = null;
        // If there is a custom parsing function associated with this
        // definition, invoke it.
        this.index = start + tokenCount;
        if (typeof def.parse === 'function') {
          result = def.parse(this);
          if (result) return result;
        } else return def.name!;
      }
    }

    this.index = start;

    // This is an unknown symbol.
    // Can we promote it?
    const action = this.options.parseUnknownToken?.(this.peek, this);
    if (action === 'function') {
      const name = this.next();
      // this.onError({ code: 'unknown-function', arg: name });
      const enclosure = this.matchEnclosure();
      // If no arguments, return it as a symbol
      if (enclosure === null) return name;
      if (head(enclosure) !== 'Delimiter') return null;
      return [name, ...tail(enclosure)];
    }
    if (action === 'symbol') {
      // this.onError({ code: 'unknown-symbol', arg: this.peek });
      return this.next();
    }

    // Not a symbol (punctuation or fence, maybe?)...

    return this.matchUnknownLatexCommand();
  }

  matchOptionalLatexArgument(): Expression | null {
    const index = this.index;
    this.skipSpace();
    if (this.match('[')) {
      const expr = this.matchExpression();
      this.skipSpace();
      if (this.match(']')) return expr;
    }
    this.index = index;
    return null;
  }

  /**
   * Match a required LaTeX argument:
   * - either enclosed in `{}`
   * - or a single token.
   *
   * Return null if an argument was not found
   * Return 'Nothing' if an empty argument `{}` was found
   */
  matchRequiredLatexArgument(): Expression | null {
    const start = this.index;
    this.skipSpace();
    if (this.match('<{>')) {
      const expr = this.matchExpression({ tokens: ['<}>'] });
      this.skipSpace();
      if (this.match('<}>')) return expr;
      this.index = start;
      return null;
    }

    // Is it a single digit?
    if (/^[0-9]$/.test(this.peek)) {
      // ... only match the digit, i.e. `x^23` is `x^{2}3`, not x^{23}
      return parseInt(this.next());
    }

    // Is it a single letter (but not a special letter)?
    if (/^[^\\#]$/.test(this.peek)) return this.next();

    // Otherwise, this can only be a symbol.
    // `frac{1}2+1` is not valid, neither is `\frac\frac123`
    const expr = this.matchSymbol();
    if (expr) return expr;

    this.index = start;
    return null;
  }

  /**
   *  Match a sequence superfix/subfix operator, e.g. `^{*}`
   *
   * Superfix and subfix need special handling:
   *
   * - they act mostly like an infix operator, but they are commutative, i.e.
   * `x_a^b` should be parsed identically to `x^b_a`.
   *
   * - furthermore, in LaTeX, consecutive `^` or `_` are treated as concatenated,
   * that is `x^a^b` parses the same as `x^{ab}`.
   *
   */
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
    while (this.peek === '_' || this.peek === '^') {
      if (this.match('_')) {
        let sub = this.matchRequiredLatexArgument();
        if (!sub && this.match('<{>')) {
          sub = this.matchString({ tokens: ['<}>'] });
          if (sub) this.match('<}>');
        }
        subscripts.push(sub ?? 'Missing');
      } else if (this.match('^'))
        superscripts.push(this.matchRequiredLatexArgument() ?? 'Missing');
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

  matchString(until: { tokens: LatexToken[] } & Partial<Terminator>): string {
    if (!until.minPrec) until = { ...until, minPrec: 0 };
    console.assert(until.tokens);
    let result = '';
    let done = this.atEnd;
    while (!done) {
      const token = this.peek;
      if (token === '<space>') result += ' ';
      else if (token[0] === '\\') {
        // TeX will give a 'Missing \endcsname inserted' error
        // if it encounters any command when expecting a string.
        // We're a bit more lax.
        this.onError([{ severity: 'warning', message: 'unexpected-command' }]);
        result += this.next();
      } else if (!/^<(\$|\$\$)>$/.test(token)) {
        result += this.next();
      } else {
        // It's'<$>' or '<$$>
        done = true;
      }

      done = done || this.atTerminator(until as Terminator);
    }
    return result;
  }

  matchEnvironmentName(command: '\\begin' | '\\end', envName: string): boolean {
    if (!this.match(command)) return false;

    const start = this.index;
    if (this.match('<{>')) {
      const name = this.matchString({ tokens: ['<}>'] });
      if (this.match('<}>') && name === envName) return true;
    }

    this.index = start;
    return false;
  }

  /**
   * Match an expression in a tabular format,
   * where row are separated by `\\` and columns by `&`
   *
   * Return rows of sparse columns as a list: empty rows are indicated with NOTHING,
   * and empty cells are also indicated with NOTHING.
   */
  matchTabular(endName: string): null | Expression {
    const result: null | Expression = ['List'];

    const until: Terminator = {
      minPrec: 0,
      tokens: ['\\end', '<{>', ...endName.split(''), '<}>'],
    };

    let row: [Expression, ...Expression[]] = ['List'];
    let expr: Expression | null = null;
    while (!this.atTerminator(until)) {
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
        result.push(row as Expression);
        row = ['List'];
        expr = null;
      }
    }
    // Capture any leftover row
    if (row.length > 1) {
      result.push(row as Expression);
    }

    return result;
  }

  matchEnvironment(): Expression | null {
    if (!this.match('\\begin')) return null;
    const start = this.index;
    if (this.match('<{>')) {
      const name = this.matchString({ tokens: ['<}>'] });
      if (this.match('<}>')) {
        // @todo:parse optional and required arguments.

        const def = this._dictionary.environment.get(name);
        if (def) return def.parse(this, [], []);

        // Unknown environment. Attempt to parse as tabular
        const expr = this.matchTabular(name);
        if (expr !== null) return expr;
      }
    }

    this.index = start;
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
    rawLhs: Expression | null
  ): Expression | null {
    if (rawLhs === null || this.atTerminator(terminator)) return null;

    if (this.options.applyInvisibleOperator === null) return null;

    //
    // Capture a right hand side, if there is one
    //
    const start = this.index;
    const rawRhs = this.matchExpression({ ...terminator, minPrec: 390 });
    if (rawRhs === null) {
      this.index = start;
      return null;
    }

    //
    // Invoke custom applyInvisibleOperator handler
    //
    if (typeof this.options.applyInvisibleOperator === 'function')
      return this.options.applyInvisibleOperator(this, rawLhs, rawRhs);

    const rhs = this.engine.box(rawRhs);

    // If the `lhs` is a symbol that has a function definition, do a
    // functional application
    const symbolName = symbol(rawLhs);
    if (symbolName) {
      const def = this.engine.getFunctionDefinition(symbolName);
      if (def) {
        let ops: BoxedExpression[] = [];
        if (rhs.head === 'Delimiter') {
          if (rhs.op1.head === 'Sequence') {
            ops = [...rhs.op1.ops!];
          } else ops = [rhs.op1];
        } else ops = [rhs];
        return [symbolName, ...ops.map((x) => x.json)];
      }
    }

    const lhs = this.engine.box(rawLhs);

    // Integer literal followed by a fraction -> Invisible Add
    if (lhs.isLiteral && lhs.isInteger && rhs.isLiteral) {
      const [numer, denom] = rhs.rationalValue;
      if (numer !== null && denom !== null) return ['Add', rawLhs, rawRhs];
    }

    // If the value of `lhs` is a number and the value of `rhs` is a number
    // (but they may not be literal)
    // -> Apply Invisible Multiply
    if (lhs.isNumber && rhs.isNumber) {
      return applyAssociativeOperator('Multiply', rawLhs, rawRhs);
    }

    this.index = start;
    return null;
  }

  matchUnknownLatexCommand(): Expression | null {
    const command = this.peek;
    if (!command || command[0] !== '\\') return null;

    this.next();

    const tokens: LatexToken[] = [];

    if (command === '\\operatorname') {
      if (this.match('<{>')) {
        while (!this.atEnd && this.peek !== '<}>') tokens.push(this.next());
        this.match('<}>');
      } else {
        tokens.push(this.next());
      }
      if (tokens.length === 0)
        return [
          'Error',
          'Missing',
          { str: 'syntax-error' },
          ['LatexForm', { str: command }],
        ];
      return [
        'Error',
        'Missing',
        { str: 'unknown-command' },
        ['LatexForm', { str: `${command}{${tokensToString(tokens)}}` }],
      ];
    }

    // Capture the optional and required arguments

    while (this.match('[')) {
      tokens.push('[');
      // This is a lazy capture, to handle the case `\foo[\blah[12]\blarg]`.
      // However, a `[` could be e.g. inside a string and this would fail to parse
      // Since we're already in an error situation, though, probably OK.
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== ']') {
        if (this.peek === '[') level += 1;
        if (this.peek === ']') level -= 1;
        tokens.push(this.next());
      }
      if (this.match(']')) tokens.push(']');
    }

    while (this.match('<{>')) {
      tokens.push('<{>');
      // This is a lazy capture, to handle the case `\foo[\blah[12]\blarg]`.
      // However, a `[` could be e.g. inside a string and this would fail to parse
      // Since we're already in an error situation, though, probably OK.
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== '<}>') {
        if (this.peek === '<{>') level += 1;
        if (this.peek === '<}>') level -= 1;
        tokens.push(this.next());
      }
      if (this.match('<}>')) tokens.push('<}>');
    }

    return [
      'Error',
      'Missing',
      { str: 'unknown-command' },
      ['LatexForm', { str: `${command}${tokensToString(tokens)}` }],
    ];
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
    let result: Expression | null = null;
    const start = this.index;

    //
    // 1. Is it a number?
    //
    const num = this.matchNumber();
    if (num) result = { num };

    //
    // 2. Is it an enclosure, i.e. a matchfix expression?
    //    (group fence, absolute value, integral, etc...)
    // (check before other latex commands)
    //
    if (result === null) result = this.matchEnclosure();

    //
    // 3. Is it an environment?
    // `\begin{...}...\end{...}`
    // (check before other latex commands)
    //
    if (result === null) result = this.matchEnvironment();

    //
    // 4. Is it a symbol, a LaTeX command or a function call?
    //    `x` or `\pi'
    //    `f(x)` or `\sin(\pi)
    //    `\frac{1}{2}`
    //
    if (result === null) result = this.matchSymbol();

    //
    // 5. Are there postfix operators ?
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
    // 5. Are there superscript or subfix operators?
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
   * Stop when an operator of precedence less than `minPrec` is encountered
   */
  matchExpression(until?: Partial<Terminator>): Expression | null {
    const start = this.index;
    if (!until) until = { minPrec: 0 };
    if (!until.minPrec) until = { ...until, minPrec: 0 };

    this.skipSpace();

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
      while (!this.atTerminator(until as Terminator) && !done) {
        this.skipSpace();
        let result = this.matchInfixOperator(lhs, until as Terminator);
        if (result === null) {
          // We've encountered something else than an infix operator
          // OR an infix operator with a lower priority.
          // Could be "y" after "x": time to apply the invisible operator
          const opDefs = this.peekDefinitions('operator');
          if (opDefs === null) {
            // It's not an operator, so eligible for invisible operator
            // @todo: do we need to check opDefs?
            result = this.applyInvisibleOperator(until as Terminator, lhs);
          }
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
   * Add latex or other requested metadata to the expression
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
}
