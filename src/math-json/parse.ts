/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-empty-function */
import { Expression } from './math-json-format';
import {
  ParseLatexOptions,
  LatexToken,
  NumberFormattingOptions,
  ParserFunction,
  WarningSignalHandler,
  Delimiter,
} from './public';
import {
  getFunctionName,
  getTail,
  NOTHING,
  MISSING,
  applyAssociativeOperator,
  getNumberValue,
  getRationalValue,
} from '../common/utils';
import { tokensToString } from './core/tokenizer';
import {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
} from './definitions';
import {
  DEFAULT_LATEX_NUMBER_OPTIONS,
  DEFAULT_PARSE_LATEX_OPTIONS,
} from './utils';
import { ComputeEngine, Numeric } from './compute-engine-interface';

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

export class Scanner<T extends number = Numeric> implements Scanner<T> {
  readonly onError: WarningSignalHandler;
  readonly options: Required<NumberFormattingOptions> &
    Required<ParseLatexOptions<T>>;
  readonly computeEngine?: ComputeEngine;

  readonly _dictionary: IndexedLatexDictionary<T>;

  index = 0;

  // Those two properties are used to detect infinite loops
  _lastPeek = '';
  _peekCounter = 0;

  readonly _tokens: LatexToken[];

  constructor(
    tokens: LatexToken[],
    options: Required<NumberFormattingOptions> & Required<ParseLatexOptions<T>>,
    dictionary: IndexedLatexDictionary<T>,
    computeEngine: undefined | ComputeEngine,
    onError: WarningSignalHandler
  ) {
    this.options = {
      ...DEFAULT_LATEX_NUMBER_OPTIONS,
      ...DEFAULT_PARSE_LATEX_OPTIONS,
      ...options,
    };
    this.computeEngine = computeEngine;
    this._tokens = tokens;

    this.onError = onError;
    this._dictionary = dictionary;
  }

  clone(start: number, end: number): Scanner<T> {
    return new Scanner<T>(
      this._tokens.slice(start, end),
      this.options,
      this._dictionary,
      this.computeEngine,
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
  peekDefinitions(
    kind: 'symbol' | 'infix' | 'prefix' | 'postfix' | 'operator'
  ): [IndexedLatexDictionaryEntry<T>, number][] | null {
    let defs: (undefined | IndexedLatexDictionaryEntry<T>[])[];
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
    const result: [IndexedLatexDictionaryEntry<T>, number][] = [];
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

  match(target: LatexToken): boolean {
    if (this._tokens[this.index] === target) {
      this.index++;
      return true;
    }
    return false;
  }

  matchAll(target: LatexToken | LatexToken[]): boolean {
    let matched = true;

    if (typeof target === 'string') {
      target = [target];
    }
    let i = 0;
    do {
      matched = this._tokens[this.index + i] === target[i++];
    } while (matched && i < target.length);
    if (matched) {
      this.index += i;
    }
    return matched;
  }

  matchAny(targets: LatexToken[]): LatexToken {
    if (targets.includes(this._tokens[this.index])) {
      return this._tokens[this.index++];
    }
    return '';
  }

  matchWhile(targets: LatexToken[]): LatexToken[] {
    const result: LatexToken[] = [];
    while (targets.includes(this._tokens[this.index])) {
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
      } else if (this.match('-')) {
        isNegative = !isNegative;
        done = false;
      } else if (this.match('+')) {
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
        if (this.match(this.options.groupSeparator)) {
          if (/[0-9]/.test(this.peek)) {
            done = false;
          } else {
            this.index = savedIndex;
          }
        }
      }
    }
    return result;
  }

  matchSignedInteger(): string {
    const savedIndex = this.index;
    const sign = this.matchSign();
    const result = this.matchDecimalDigits();
    if (result) return (sign === '-' ? '-' : '') + result;

    this.index = savedIndex;
    return '';
  }

  matchExponent(): string {
    const savedIndex = this.index;
    let result = '';

    if (this.matchAny(['e', 'E', 'd', 'D'])) {
      const exponent = this.matchSignedInteger();
      if (exponent) {
        result = 'e' + exponent;
      }
    }
    if (result) return result;

    if (this.match('\\times')) {
      this.skipSpace();
      if (this.match('1') && this.match('0') && this.match('^')) {
        if (/[0-9]/.test(this.peek)) {
          return 'e' + this.next();
        }
        if (this.match('<{>')) {
          this.skipSpace();
          const exponent = this.matchSignedInteger();
          this.skipSpace();
          if (this.match('<}>') && exponent) {
            return 'e' + exponent;
          }
        }
      }
    }

    this.index = savedIndex;
    return '';
  }

  matchNumber(): string {
    if (!this.options.parseNumbers) return '';
    const savedIndex = this.index;

    this.skipSpace();
    // Skip an optional '+' sign.
    // Important: the `-` sign is not handled as part of a number:
    // this is so we can correctly parse `-1^2` as `['Negate', ['Square', 1]]`
    this.match('+');

    let result = this.matchDecimalDigits();
    if (!result) {
      this.index = savedIndex;
      return '';
    }

    let hasDecimalMarker = false;
    let hasExponent = false;
    if (this.match(this.options.decimalMarker ?? '')) {
      hasDecimalMarker = true;
      result += '.' + (this.matchDecimalDigits() ?? '0');
    }
    const exponent = this.matchExponent();
    if (exponent) hasExponent = true;

    if (result) {
      // If the number has more than about 10 significant digits, use a Decimal or BigInt
      if (result.length + exponent.length > 12) {
        if (hasDecimalMarker || hasExponent) {
          return result + exponent + 'd'; // Decimal number
        } else {
          return result + 'n'; // BigInt
        }
      }
      return result + exponent;
    }

    this.index = savedIndex;
    return '';
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

  matchOperator(
    kind: 'infix' | 'prefix' | 'postfix',
    lhs: Expression<T> | null = null,
    minPrec = 0
  ): Expression<T> | null {
    //
    // Consider all the definitions that match the upcoming tokens
    //
    const defs = this.peekDefinitions(kind);
    if (defs === null) return null;
    const index = this.index;
    for (const [def, n] of defs) {
      let rhs: Expression<T> | null = null;
      this.index = index + n;

      console.assert(typeof def.parse === 'function');

      if (typeof def.parse === 'function') {
        [lhs, rhs] = callParse(this, def, lhs, minPrec);

        if (rhs === null) {
          // This def didn't work out. Try another.
          this.index = index;
          continue;
        }
        console.assert(lhs === null);
        return rhs;
        // return this.applyInvisibleOperator(lhs, rhs);
      }

      // This def doesn't have a parse function, so we're going to assume it
      // matches
      if (kind === 'postfix') return [def.parse as string, lhs ?? MISSING];

      // Get the `rhs`
      let prec = def.precedence;
      if (prec === undefined || prec < minPrec) return null;
      prec += def.associativity === 'left' ? 1 : 0;
      rhs = this.matchExpression(prec) ?? MISSING;

      if (kind === 'prefix') {
        console.assert(lhs === null);
        return [def.parse, rhs];
        // return this.applyInvisibleOperator(lhs, [def.parse, rhs]);
      }

      if (kind === 'infix') {
        return applyAssociativeOperator(
          def.parse as string,
          lhs ?? MISSING,
          rhs ?? MISSING,
          def.associativity
        );
      }
    }
    return null;
  }

  /**
   * 'group' : will look for an argument inside a pair of `()`
   * 'implicit': either an expression inside a pair of `()`, or just a primary
   *  (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)
   */
  matchArguments(
    kind: undefined | '' | 'group' | 'implicit'
  ): Expression<T>[] | null {
    if (!kind) return null;

    const savedIndex = this.index;
    let result: Expression<T>[] | null = null;

    const group = this.matchMatchfixOperator();

    if (kind === 'group' && getFunctionName(group) === 'Delimiter') {
      // We got a group i.e. `f(a, b, c)`
      result = getTail(group);
    } else if (kind === 'implicit') {
      // We are looking for an expression inside an optional pair of `()`
      // (i.e. trig functions, as in `\cos x`.)
      if (getFunctionName(group) === 'Delimiter') {
        result = getTail(group);
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

  matchMatchfixOperator(): Expression<T> | null {
    const defs = this._dictionary.matchfix;

    if (defs.length === 0) return null;

    const originalIndex = this.index;

    // Try each def
    for (const def of defs) {
      this.index = originalIndex;

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
        const body = this.matchExpression();

        // 3. Match the closing delimiter
        this.skipSpace();
        if (!this.matchAll(def.closeDelimiter)) continue;

        if (typeof def.parse === 'function') {
          const [lhs, rhs] = callParse(this, def, body);
          if (rhs === null || lhs !== null) continue; // This def didn't work. Try another.
          return rhs;
        }
        if (!body) return [def.name];
        return [def.name, body];
      } else {
        //
        // We have some 'normalized' delimiters (i.e. '(' will match '(' or
        // '\lparen)
        //

        // 1. Match the opening delimiter
        const closeDelimiter = this.matchOpenDelimiter(
          def.openDelimiter,
          def.closeDelimiter as Delimiter
        );
        if (closeDelimiter === null) continue;

        // 2. Collect the sequence in between the delimiters
        const body = this.matchExpression();

        // 3. Match the closing delimiter
        this.skipSpace();
        if (!this.matchAll(closeDelimiter)) {
          this.index = originalIndex;
          return null;
        }

        if (typeof def.parse === 'function') {
          const [_, result] = callParse(this, def, body);
          if (result === null) continue; // This def didn't work. Try another.
          return result;
        }
        if (!body) return [def.name];
        return [def.name, body];
      }
    }
    this.index = originalIndex;
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
  matchSymbol(): Expression<T> | null {
    const defs = this.peekDefinitions('symbol');
    const index = this.index;
    if (defs) {
      for (const [def, tokenCount] of defs) {
        let result: Expression<T> | null = null;
        // If there is a custom parsing function associated with this
        // definition, invoke it.
        this.index = index + tokenCount;
        if (typeof def.parse === 'function') {
          [, result] = callParse(this, def);
          if (result === null) continue;
        } else {
          result = def.name;
        }
        if (result) return result;
      }
    }

    this.index = index;

    // This is an unknown symbol.
    // Can we promote it?
    const action = this.options.parseUnknownToken?.(this.peek, this);
    if (action === 'function') {
      const name = this.next();
      // this.onError({ code: 'unknown-function', arg: name });
      const group = this.matchMatchfixOperator();
      // If no arguments, return it as a symbol
      if (group === null) return name;
      if (getFunctionName(group) !== 'Delimiter') return null;
      return [name, ...getTail(group)];
    }
    if (action === 'symbol') {
      // this.onError({ code: 'unknown-symbol', arg: this.peek });
      return this.next();
    }

    // Not a symbol (punctuation or fence, maybe?)...

    return this.matchUnknownLatexCommand();
  }

  matchOptionalLatexArgument(): Expression<T> | null {
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
  matchRequiredLatexArgument(): Expression<T> | null {
    const index = this.index;
    this.skipSpace();
    if (this.match('<{>')) {
      const expr = this.matchExpression();
      this.skipSpace();
      if (this.match('<}>')) return expr;
    }

    // Is it a single digit?
    if (/^[0-9]$/.test(this.peek)) {
      // ... only match the digit, i.e. `x^23` is `x^{2}3`, not x^{23}
      return parseFloat(this.next()) as T;
    }

    // Is it a single letter (but not a special letter)?
    if (/^[^\\#]$/.test(this.peek)) return this.next();

    // Otherwise, this can only be a symbol.
    // `frac{1}2+1` is not valid, neither is `\frac\frac123`
    const expr = this.matchSymbol();
    if (expr) return expr;

    this.index = index;
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
  matchSupsub(lhs: Expression<T> | null): Expression<T> | null {
    if (lhs === null) return null;

    const index = this.index;

    this.skipSpace();

    //
    // 1/ Gather possible superscript/subscripts
    //
    const superscripts: Expression<T>[] = [];
    const subscripts: Expression<T>[] = [];
    while (this.peek === '_' || this.peek === '^') {
      if (this.match('_'))
        subscripts.push(this.matchRequiredLatexArgument() ?? 'Nothing');
      else if (this.match('^'))
        superscripts.push(this.matchRequiredLatexArgument() ?? 'Nothing');
      this.skipSpace();
    }

    if (superscripts.length === 0 && subscripts.length === 0) {
      this.index = index;
      return lhs;
    }

    let result: Expression<T> | null = lhs;

    //
    // 2/ Apply subscripts (first)
    //
    if (subscripts.length > 0) {
      const defs = this._dictionary.infix[1]?.get('_');
      if (defs) {
        const arg: Expression<T> = [
          'Subscript',
          result,
          subscripts.length === 1 ? subscripts[0] : ['Sequence', ...subscripts],
        ];
        for (const def of defs) {
          if (typeof def.parse === 'function')
            result = callParse(this, def, arg)[1];
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
        const arg: Expression<T> = [
          'Superscript',
          result!,
          superscripts.length === 1
            ? superscripts[0]
            : ['Sequence', ...superscripts],
        ];
        for (const def of defs) {
          if (typeof def.parse === 'function')
            result = callParse(this, def, arg)[1];
          else result = arg;
          if (result) break;
        }
      }
    }

    // Restore the index if we did not find a match
    if (result === null) this.index = index;

    return result;
  }

  matchPostfix(lhs: Expression<T> | null): Expression<T> | null {
    if (lhs === null) return null;

    const defs = this.peekDefinitions('postfix');
    if (defs === null) return null;

    const index = this.index;
    for (const [def, n] of defs) {
      this.index = index + n;
      if (typeof def.parse === 'function') {
        [, lhs] = (def.parse as ParserFunction<T>)(lhs, this, 0);
        if (lhs === null) continue;

        return lhs;
      }
      return [def.name, lhs ?? MISSING];
    }
    return null;
  }

  matchString(): string {
    let result = '';
    let done = this.atEnd;
    while (!done) {
      if (this.match('<space>')) {
        result += ' ';
      } else {
        const token = this.peek;
        if (token === ']') {
          done = true;
        } else if (!/^<({|}|\$|\$\$|space)>$/.test(token)) {
          result += this.next();
        } else if (token[0] === '\\') {
          // TeX will give a 'Missing \endcsname inserted' error
          // if it encounters any command when expecting a string.
          // We're a bit more lax.
          this.onError([
            { severity: 'warning', message: 'unexpected-command' },
          ]);
          result += this.next();
        } else {
          // It's '<{>', '<}>', '<$>' or '<$$>
          done = true;
        }
      }
      done = done || this.atEnd;
    }
    return result;
  }

  matchEnvironmentName(command: '\\begin' | '\\end', envName: string): boolean {
    if (this.match(command)) {
      const savedIndex = this.index;
      if (this.match('<{>')) {
        const name = this.matchString();
        if (this.match('<}>') && name === envName) {
          return true;
        }
      }
      this.index = savedIndex;
    }

    return false;
  }

  /**
   * Match an expression in a tabular format,
   * where row are separated by `\\` and columns by `&`
   *
   * Return rows of sparse columns as a list: empty rows are indicated with NOTHING,
   * and empty cells are also indicated with NOTHING.
   */
  matchTabular(): null | Expression<T> {
    const result: null | Expression<T> = ['List'];

    let row: Expression<T>[] = ['List'];
    let expr: Expression<T> | null = null;
    while (!this.atEnd) {
      if (this.match('&')) {
        // new column
        // Push even if expr is NULL (it represents a skipped column)
        row.push(expr ?? NOTHING);
        expr = null;
      } else if (this.match('\\\\') || this.match('\\cr')) {
        // new row

        this.skipSpace();
        // Parse but drop optional argument (used to indicate spacing between lines)
        this.matchOptionalLatexArgument();

        if (expr !== null) row.push(expr);
        result.push(row);
        row = ['List'];
        expr = null;
      } else {
        expr = this.applyInvisibleOperator(expr, this);
      }
    }
    // Capture any leftover row
    if (row.length > 1) {
      result.push(row);
    }

    return result;
  }

  matchEnvironment(): Expression<T> | null {
    if (this.match('\\begin')) {
      if (this.match('<{>')) {
        const name = this.matchString();
        if (this.match('<}>')) {
          const start = this.index;
          let end = this.index;

          // Find the end of the environment
          let level = 1;
          while (!this.atEnd && level !== 0) {
            end = this.index;
            if (this.matchEnvironmentName('\\begin', name)) {
              level += 1;
            } else if (this.matchEnvironmentName('\\end', name)) {
              level -= 1;
            } else {
              this.next();
            }
          }

          const def = this._dictionary.environment.get(name);
          if (typeof def?.parse === 'function') {
            return def.parse(null, this.clone(start, end), 0)[1];
          }
          return def?.parse ?? null;
        }
      }
    }
    return null;
  }

  /**
   * Apply an invisible operator between two expressions.
   *
   * If the `lhs` is an integer and the `rhs` is a fraction of integers
   * -> 'invisible plus'
   *
   * That is '2 3/4' -> ['Add', 2, ['Divide', 3, 4]]
   *
   * If the domain of the `lhs` is numeric and the domain of `rhs` is numeric
   * but `rhs` is not a numbervalue -> 'invisible multiply'.
   * - 2x
   * - 2(x+1)
   * - x(x+1)
   * - 2 sin(x)
   * - 2 f(x)
   * - x f(x)
   * - (x-1)(x+1)
   * - (x+1)2 -> no
   * - x2 -> no
   */
  applyInvisibleOperator(
    lhs: Expression<T> | null,
    scanner: Scanner<T>
  ): Expression<T> | null {
    if (lhs === null) return null;
    const index = scanner.index;

    if (typeof this.options.applyInvisibleOperator === 'function') {
      return this.options.applyInvisibleOperator(lhs, this);
    } else if (this.options.applyInvisibleOperator === 'auto') {
      //
      // Apply the default invisible operator
      //
      const rhs = scanner.matchExpression(390);
      if (rhs === null) return null;
      const valNum = getNumberValue(lhs);
      const [numer, denom] = getRationalValue(rhs);

      // Integer followed by a fraction -> Invisible Add
      if (
        valNum !== null &&
        Number.isInteger(valNum) &&
        numer !== null &&
        denom !== null
      ) {
        return ['Add', lhs, rhs];
      }
      // If the domain of lhs is numeric and the domain of rhs is numeric ->
      // Invisible Multiply
      if (
        (valNum !== null || this.computeEngine?.isNumeric(lhs)) &&
        this.computeEngine?.isNumeric(rhs)
      ) {
        return ['Multiply', lhs, rhs];
      }

      // @todo if the domain of LHS is `function`, functional apply
    }
    scanner.index = index;
    return null;
  }

  matchUnknownLatexCommand(): Expression<T> | null {
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
        return ['Error', ['LatexString', { str: command }], 'syntax-error'];
      return [
        'Error',
        ['LatexString', { str: `${command}{${tokensToString(tokens)}}` }],
        'unknown-command',
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
      ['LatexString', { str: `${command}${tokensToString(tokens)}` }],
      'unknown-command',
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
  matchPrimary(_minPrec?: number): Expression<T> | null {
    let result: Expression<T> | null = null;
    const originalIndex = this.index;

    //
    // 1. Is it a number?
    //
    const num = this.matchNumber();
    if (num) result = { num: num };

    //
    // 2. Is it a matchfix expression?
    //    (group fence, absolute value, integral, etc...)
    // (check before other latex commands)
    //
    if (result === null) result = this.matchMatchfixOperator();

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
      let postfix: Expression<T> | null = null;
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

    return this.decorate(result, originalIndex);
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
  matchExpression(minPrec = 0): Expression<T> | null {
    const originalIndex = this.index;

    this.skipSpace();

    //
    // 1. Do we have a prefix operator?
    //
    let lhs: Expression<T> | null = this.matchOperator('prefix');

    //
    // 2. Do we have a primary?
    // (if we had a prefix, it consumed the primary following it)
    //
    if (lhs === null) lhs = this.matchPrimary(minPrec);

    //
    // 3. Are there some infix operators?
    //
    let done = false;
    while (!this.atEnd && !done) {
      this.skipSpace();
      let result = this.matchOperator('infix', lhs, minPrec);
      if (result === null && lhs !== null) {
        // We've encountered something else than an infix operator
        // OR an infix operator with a lower priority.
        // Could be "y" after "x": time to apply the invisible operator
        // if the next element is:
        // - a symbol: `2x`, `2f(x)` (after `2`)
        // - a number: `x2` (after `x`)
        // - a matchfix open: `x(n+1)` (after `x`)
        // (i.e. not an operator)
        const opDefs = this.peekDefinitions('operator');
        if (opDefs === null) {
          // It's not an operator, so eligible for invisible operator
          // @todo: do we need to check opDefs?
          result = this.applyInvisibleOperator(lhs, this);
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
    return this.decorate(lhs, originalIndex);
  }

  /**
   * Add latex or other requested metadata to the expression
   */
  decorate(expr: Expression<T> | null, start: number): Expression<T> | null {
    if (expr === null) return null;
    if (this.options.preserveLatex) {
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
    }
    return expr;
  }
}

/**
 * Invoke the parse function of the definition
 * and performs some sanity checks.
 */
function callParse<T extends number = Numeric>(
  scanner: Scanner<T>,
  def: IndexedLatexDictionaryEntry<T>,
  lhs: Expression<T> | null = null,
  prec = 0
): [lhs: Expression<T> | null, rhs: Expression<T> | null] {
  if (typeof def.parse !== 'function') return [lhs, null];

  const index = scanner.index;

  const [newLhs, rhs] = def.parse(lhs, scanner, prec);

  if (rhs === undefined) {
    console.assert(
      rhs !== undefined,
      `In ${def.name ?? '<unknown>'}.parse(), ` +
        'returned `undefined. Should return `null` if cannot parse.'
    );
    scanner.index = index;
    return [lhs, null];
  }

  if (rhs === null && newLhs !== lhs) {
    console.assert(
      rhs !== null || newLhs === lhs,
      `In ${def.name ?? '<unknown>'}.parse(), ` +
        'LHS was modified without returning a result'
    );
    scanner.index = index;
    return [lhs, null];
  }

  return [newLhs, rhs];
}
