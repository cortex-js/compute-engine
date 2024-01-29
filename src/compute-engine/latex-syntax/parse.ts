/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-empty-function */

import {
  ParseLatexOptions,
  LatexToken,
  NumberFormattingOptions,
  Delimiter,
  Terminator,
  Parser,
  MULTIPLICATION_PRECEDENCE,
} from './public';
import { tokenize, tokensToString } from './tokenizer';
import {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
  IndexedInfixEntry,
  IndexedPostfixEntry,
  IndexedPrefixEntry,
  IndexedSymbolEntry,
  IndexedExpressionEntry,
  IndexedFunctionEntry,
  IndexedEnvironmentEntry,
  IndexedMatchfixEntry,
} from './dictionary/definitions';

import { IComputeEngine } from '../public';

import { Expression } from '../../math-json/math-json-format';
import {
  getSequence,
  head,
  missingIfEmpty,
  nops,
  op1,
  ops,
  symbol,
} from '../../math-json/utils';
import { parseIdentifier, parseInvalidIdentifier } from './parse-identifier';

/** These delimiters can be used as 'shorthand' delimiters in
 * `openTrigger` and `closeTrigger` for `matchfix` operators.
 */
const DELIMITER_SHORTHAND: { [key: string]: LatexToken[] } = {
  '(': ['\\lparen', '('],
  ')': ['\\rparen', ')'],
  '[': ['\\lbrack', '\\[', '['],
  ']': ['\\rbrack', '\\]', ']'],
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

// const MIDDLE_DELIMITER = {
//   ':': [':', '\\colon'],
//   '|': ['|', '\\|', '\\mid', '\\mvert'],
// };

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
// const MIDDLE_DELIMITER_PREFIX = [
//   '\\middle',
//   '\\bigm',
//   '\\Bigm',
//   '\\biggm',
//   '\\Biggm',
//   '\\big',
//   '\\Big',
//   '\\bigg',
//   '\\Bigg',
// ];

/**
 * Map open delimiters to a matching close delimiter
 */
const CLOSE_DELIMITER = {
  '(': ')',
  '[': ']',
  '|': '|',
  '\\{': '\\}',
  '\\[': '\\]',
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
  skipSpace: true,

  parseArgumentsOfUnknownLatexCommands: true,
  parseNumbers: 'auto',
  parseUnknownIdentifier: (id, parser) =>
    parser.computeEngine?.lookupFunction(id) !== undefined
      ? 'function'
      : 'symbol',
  preserveLatex: false,
};

export class _Parser implements Parser {
  readonly computeEngine: IComputeEngine;
  readonly options: NumberFormattingOptions & ParseLatexOptions;

  _index = 0;

  get index(): number {
    return this._index;
  }
  set index(val: number) {
    this._index = val;
    this._lastPeek = '';
    this._peekCounter = 0;
  }

  private _tokens: LatexToken[];

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
      const msg = `Infinite loop detected while parsing "${this.latex(
        0
      )}" at "${this._lastPeek}" (index ${this.index})`;
      console.error(msg);
      throw new Error(msg);
    }
    this._lastPeek = peek;
    return peek;
  }

  nextToken(): LatexToken {
    return this._tokens[this.index++];
  }

  /**
   * Return true if
   * - at end of the token stream
   * - the `t.condition` function returns true
   * Note: the `minPrec` condition is not checked. It should be checked separately.
   */
  atTerminator(t?: Readonly<Terminator>): boolean {
    return this.atBoundary || ((t?.condition && t.condition(this)) ?? false);
  }

  /**
   * True if the current token matches any of the boundaries we are
   * waiting for.
   */
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

  private latexAhead(n: number): string {
    return this.latex(this.index, this.index + n);
  }
  // latexBefore(): string {
  //   return this.latex(0, this.index);
  // }
  // latexAfter(): string {
  //   return this.latex(this.index);
  // }

  /**
   * Return at most `this._dictionary.lookahead` LaTeX tokens.
   *
   * The index in the returned array correspond to the number of tokens.
   * Note that since a token can be longer than one char ('\\pi', but also
   * some astral plane unicode characters), the length of the string
   * does not match that index. However, knowing the index is important
   * to know by how many tokens to advance.
   *
   * For example:
   *
   * `[empty, '\\sqrt', '\\sqrt{', '\\sqrt{2', '\\sqrt{2}']`
   *
   */
  lookAhead(): [count: number, tokens: string][] {
    let n = Math.min(
      this._dictionary.lookahead,
      this._tokens.length - this.index
    );
    if (n <= 0) return [];

    const result: [number, string][] = [];

    while (n > 0) result.push([n, this.latexAhead(n--)]);

    return result;
  }

  /** Return all the definitions that match the tokens ahead
   *
   * The return value is an array of pairs `[def, n]` where `def` is the
   * definition that matches the tokens ahead, and `n` is the number of tokens
   * that matched.
   *
   * Note the 'operator' kind matches both infix, prefix and postfix operators.
   *
   */
  peekDefinitions(kind: 'expression'): [IndexedExpressionEntry, number][];
  peekDefinitions(kind: 'function'): [IndexedFunctionEntry, number][];
  peekDefinitions(kind: 'symbol'): [IndexedSymbolEntry, number][];
  peekDefinitions(kind: 'postfix'): [IndexedPostfixEntry, number][];
  peekDefinitions(kind: 'infix'): [IndexedInfixEntry, number][];
  peekDefinitions(kind: 'prefix'): [IndexedPrefixEntry, number][];
  peekDefinitions(
    kind: 'operator'
  ): [IndexedInfixEntry | IndexedPrefixEntry | IndexedPostfixEntry, number][];
  peekDefinitions(
    kind:
      | 'expression'
      | 'function'
      | 'symbol'
      | 'infix'
      | 'prefix'
      | 'postfix'
      | 'operator'
  ): [IndexedLatexDictionaryEntry, number][] {
    if (this.atEnd) return [];

    const result: [IndexedLatexDictionaryEntry, number][] = [];
    const defs = [...this.getDefs(kind)];

    //
    // Add any "universal" definitions (ones with an empty string for a trigger)
    //

    for (const def of defs) if (def.latexTrigger === '') result.push([def, 0]);

    //
    // Filter the definition matching the tokens ahead with a LaTeX trigger
    //
    for (const [n, tokens] of this.lookAhead()) {
      for (const def of defs)
        if (def.latexTrigger === tokens) result.push([def, n]);
    }

    //
    // Filter the definitions that match with a complex LaTeX identifier
    //
    for (const def of defs) {
      if (def.identifierTrigger) {
        const n = parseComplexId(this, def.identifierTrigger);
        if (n > 0) result.push([def, n]);
      }
    }

    return result;
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
    // Check if there is a `{}` token sequence.
    // Those are used in LaTeX to force an invisible separation between commands
    // and are considered skipable space.
    if (!this.atEnd && this.peek === '<{>') {
      const index = this.index;
      this.nextToken();
      while (this.match('<space>')) {}
      if (this.nextToken() === '<}>') {
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
      this.nextToken();
      this.skipVisualSpace();
    }

    // @todo maybe also `\hspace` and `\hspace*` and `\hskip` and `\kern` with a glue param

    this.skipSpace();
  }

  match(token: LatexToken): boolean {
    if (this._tokens[this.index] === token) {
      this.index++;
      return true;
    }
    return false;
  }

  matchAll(tokens: LatexToken[]): boolean {
    console.assert(Array.isArray(tokens));
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

  matchChar(): string | null {
    const index = this.index;
    let caretCount = 0;
    while (this.match('^')) caretCount += 1;
    if (caretCount < 2) this.index = index;
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
      if (digits.length === caretCount)
        return String.fromCodePoint(Number.parseInt(digits, 16));
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
      if (this.match('<{>')) {
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

        if (codepoint !== null && codepoint >= 0 && codepoint <= 0x10ffff)
          return String.fromCodePoint(codepoint);
      }
    }
    this.index = index;
    return null;
  }

  /**
   *
   * If the next token matches the open delimiter, set a boundary with
   * the close token and return true.
   *
   * Note this method handles "shorthand" delimiters, i.e. '(' will match both
   * `(` and `\lparen`. If a shorthand is used for the open delimiter, the
   * corresponding shorthand will be used for the close delimiter.
   * See DELIMITER_SHORTHAND.
   *
   * It also handles prefixes like `\left` and `\bigl`.
   *
   */
  private matchDelimiter(
    open: Delimiter | LatexToken[],
    close: Delimiter | LatexToken[]
  ): boolean {
    // A standalone `[` is not a valid delimiter, because it is used
    // for optional arguments, but `\left[` is OK
    if (this.peek === '[') return false;

    // If the delimiters are token arrays, look specifically for those
    if (Array.isArray(open)) {
      // If the open trigger is an array, the close trigger must be an array too
      console.assert(Array.isArray(close));
      if (!this.matchAll(open)) return false;
      this.addBoundary(close as LatexToken[]);
      return true;
    }

    console.assert(!Array.isArray(close));

    const start = this.index;
    const closePrefix = OPEN_DELIMITER_PREFIX[this.peek];
    if (closePrefix) this.nextToken();

    if (open === '||' && this.matchAll(['|', '|'])) {
      this.addBoundary(['|', '|']);
      return true;
    }

    if (!(DELIMITER_SHORTHAND[open] ?? [open]).includes(this.peek)) {
      // Not the delimiter we were expecting: backtrack
      this.index = start;
      return false;
    }

    open = this.nextToken() as Delimiter;

    // If we are using a shorthand delimiter, we need to add the
    // corresponding close delimiter.
    close = CLOSE_DELIMITER[open] ?? close;

    this.addBoundary(closePrefix ? [closePrefix, close] : [close]);
    return true;
  }

  parseGroup(): Expression | null {
    const start = this.index;
    this.skipSpaceTokens();
    if (this.match('<{>')) {
      this.addBoundary(['<}>']);
      const expr = this.parseExpression();
      this.skipSpace();
      if (this.matchBoundary()) return expr ?? ['Sequence'];
      // Try to find the boundary (or the end)
      while (!this.matchBoundary() && !this.atEnd) this.nextToken();
      if (head(expr) === 'Error') return expr;
      const err = this.error('expected-closing-delimiter', start);
      return expr ? ['InvisibleOperator', expr, err] : err;
    }

    this.index = start;
    return null;
  }

  // Some LaTeX commands (but not all) can accept an argument without braces,
  // for example `^` , `\sqrt` or `\frac`.
  // This argument will usually be a single token, but can be a sequence of
  // tokens (e.g. `\sqrt\frac12` or `\sqrt\operatorname{speed}`).
  parseToken(): Expression | null {
    // Skip any white space, for example in `\frac5 7`
    this.skipSpace();

    const excluding = [
      ...'!"#$%&(),/;:?@[]\\`|~'.split(''),
      '\\left',
      '\\bigl',
    ];
    if (excluding.includes(this.peek)) return null;

    // Is it a single digit?
    // Note: `x^23` is `x^{2}3`, not x^{23}
    if (/^[0-9]$/.test(this.peek)) return parseInt(this.nextToken());

    // This can be a generic expression or a symbol
    // Setup the token stream to include only the next token
    // const start = this.index;
    // const token = this.peek;
    // const tokens = this._tokens;
    // this._tokens = [token];
    // this.index = 0;

    const result = this.parseGenericExpression() ?? this.parseSymbol();

    // this._tokens = tokens;
    // this.index = start;
    if (!result) return null;
    // this.index += 1;
    return result;
  }

  parseOptionalGroup(): Expression | null {
    const index = this.index;
    this.skipSpaceTokens();
    if (this.match('[')) {
      this.addBoundary([']']);
      const expr = this.parseExpression();
      this.skipSpace();
      if (this.matchBoundary()) return expr;
      return this.boundaryError('expected-closing-delimiter');
    }
    this.index = index;
    return null;
  }

  /**
   * Parse an expression in a tabular format, where rows are separated by `\\`
   * and columns by `&`.
   *
   * Return rows of sparse columns: empty rows are indicated with `Nothing`,
   * and empty cells are also indicated with `Nothing`.
   */
  parseTabular(): null | Expression[][] {
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
        this.parseOptionalGroup();

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
          expr = this.parseExpression({
            minPrec: 0,
            condition: (p) => {
              const peek = p.peek;
              return peek === '&' || peek === '\\\\' || peek === '\\cr';
            },
          });
          if (expr) cell.push(expr);
          else {
            cell.push(['Error', ["'unexpected-token'", peek]]);
            this.nextToken();
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

  /** Parse a group as a a string, for example for `\operatorname` or `\begin` */
  parseStringGroup(optional?: boolean): string | null {
    if (optional === undefined) optional = false;
    const start = this.index;
    while (this.match('<space>')) {}
    if (this.match(optional ? '[' : '<{>')) {
      this.addBoundary([optional ? ']' : '<}>']);
      const arg = this.parseStringGroupContent();
      if (this.matchBoundary()) return arg;
      this.removeBoundary();
    }

    this.index = start;
    return null;
  }

  /** Parse an environment: `\begin{env}...\end{end}`
   */
  private parseEnvironment(until?: Readonly<Terminator>): Expression | null {
    const index = this.index;

    if (!this.match('\\begin')) return null;

    const name = this.parseStringGroup()?.trim();
    if (!name) return this.error('expected-environment-name', index);

    this.addBoundary(['\\end', '<{>', ...name.split(''), '<}>']);

    for (const def of this.getDefs('environment') as IndexedEnvironmentEntry[])
      if (def.identifierTrigger === name) {
        const expr = def.parse(this, until);

        this.skipSpace();
        if (!this.matchBoundary())
          return this.boundaryError('unbalanced-environment');

        if (expr !== null) return this.decorate(expr, index);

        this.index = index;
        return null;
      }

    // Unknown environment:
    // attempt to parse as tabular, but discard content
    this.parseTabular();

    this.skipSpace();
    if (!this.matchBoundary())
      return this.boundaryError('unbalanced-environment');
    return this.error(['unknown-environment', { str: name }], index);
  }

  /** If the next token matches a `+` or `-` sign, return it and advance the index.
   * Otherwise return `''` and do not advance */
  private parseOptionalSign(): string {
    let isNegative = !!this.matchAny(['-', '\u2212']);
    while (this.matchAny(['+', '\ufe62']) || this.skipSpace())
      if (this.matchAny(['-', '\u2212'])) isNegative = !isNegative;

    return isNegative ? '-' : '+';
  }

  private parseDecimalDigits(options?: { withGrouping?: boolean }): string {
    options ??= {};
    options.withGrouping ??= true;

    const result: string[] = [];
    let done = false;
    while (!done) {
      while (/^[0-9]$/.test(this.peek)) {
        result.push(this.nextToken());
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

  private parseSignedInteger(options?: { withGrouping?: boolean }): string {
    options ??= {};
    options.withGrouping ??= true;

    const start = this.index;

    const sign = this.parseOptionalSign();
    const result = this.parseDecimalDigits(options);
    if (result) return sign === '-' ? '-' + result : result;

    this.index = start;
    return '';
  }

  private parseExponent(): string {
    const start = this.index;

    if (this.matchAny(['e', 'E'])) {
      // The exponent does not contain grouping markers. See
      // https://physics.nist.gov/cuu/Units/checklist.html  #16
      const exponent = this.parseSignedInteger({ withGrouping: false });
      if (exponent) return exponent;
    }

    this.index = start;
    if (this.match('\\times')) {
      this.skipSpaceTokens();
      if (this.match('1') && this.match('0') && this.match('^')) {
        // Is it a single digit exponent, i.e. `\times 10^5`
        if (/^[0-9]$/.test(this.peek)) return this.nextToken();

        if (this.match('<{>')) {
          // Multi digit exponent,i.e. `\times 10^{10}` or `\times 10^{-5}`
          this.skipSpaceTokens();
          // Note: usually don't have group markers, but since we're inside
          // a `{}` there can't be ambiguity, so we're lenient
          const exponent = this.parseSignedInteger();
          this.skipSpaceTokens();
          if (this.match('<}>') && exponent) return exponent;
        }
      }
    }

    this.index = start;
    // `%` is a synonym for `e-2`. See // https://physics.nist.gov/cuu/Units/checklist.html  #10
    this.skipSpaceTokens();
    if (this.match('\\%')) return `-2`;

    this.index = start;
    if (this.matchAll(this._exponentProductTokens)) {
      this.skipSpaceTokens();
      if (this.matchAll(this._beginExponentMarkerTokens)) {
        this.skipSpaceTokens();
        const exponent = this.parseSignedInteger({ withGrouping: false });
        this.skipSpaceTokens();
        if (this.matchAll(this._endExponentMarkerTokens) && exponent)
          return exponent;
      }
    }

    this.index = start;
    return '';
  }

  parseRepeatingDecimal(): string {
    const start = this.index;
    let repeatingDecimals = '';
    if (this.match('(')) {
      repeatingDecimals = this.parseDecimalDigits();
      if (repeatingDecimals && this.match(')'))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    if (this.matchAll([`\\left`, '('])) {
      repeatingDecimals = this.parseDecimalDigits();
      if (repeatingDecimals && this.matchAll([`\\right`, ')']))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    if (this.matchAll([`\\overline`, '<{>'])) {
      repeatingDecimals = this.parseDecimalDigits();
      if (repeatingDecimals && this.match('<}>'))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    if (this.matchAll(this._beginRepeatingDigitsTokens)) {
      repeatingDecimals = this.parseDecimalDigits();
      if (repeatingDecimals && this.matchAll(this._endRepeatingDigitsTokens))
        return '(' + repeatingDecimals + ')';
      this.index = start;
      return '';
    }

    this.index = start;
    return '';
  }

  /**
   * Parse a number, with an optional sign, exponent, decimal marker,
   * repeating decimals, etc...
   */
  private parseNumber(): Expression | null {
    // If we don't parse numbers, we'll return them as individual tokens
    if (
      (this.options.parseNumbers as any as boolean) === false ||
      this.options.parseNumbers === 'never'
    )
      return null;

    const start = this.index;

    this.skipVisualSpace();

    // Parse a '+' or '-' sign
    let sign = +1;
    while (this.peek === '-' || this.peek === '+') {
      if (this.match('-')) sign *= -1;
      else this.match('+');
      this.skipVisualSpace();
    }

    let wholePart = '';
    let fractionalPart = '';

    // Does the number start with the decimal marker? i.e. `.5`
    let startsWithDecimalMarker = false;

    if (this.match('.') || this.matchAll(this._decimalMarkerTokens)) {
      const peek = this.peek;
      // We have a number if followed by a digit, or a `\overline` or a `\ldots`
      if (
        peek === '\\overline' ||
        peek === this._beginRepeatingDigitsTokens[0] ||
        /[0-9\(]/.test(peek)
      ) {
        startsWithDecimalMarker = true;
        wholePart = '0';
      }
    } else wholePart = this.parseDecimalDigits();

    if (!wholePart) {
      this.index = start;
      return null;
    }

    const fractionalIndex = this.index;
    let hasFractionalPart = false;
    if (
      startsWithDecimalMarker ||
      this.match('.') ||
      this.matchAll(this._decimalMarkerTokens)
    ) {
      fractionalPart = this.parseDecimalDigits();
      hasFractionalPart = true;
    }

    let hasRepeatingPart = false;
    if (hasFractionalPart) {
      const repeat = this.parseRepeatingDecimal();
      if (repeat) {
        fractionalPart += repeat;
        hasRepeatingPart = true;
      } else if (
        this.match('\\ldots') ||
        this.matchAll(this._truncationMarkerTokens)
      ) {
        // We got a truncation marker, just ignore it.
      }
    }

    if (hasFractionalPart && !fractionalPart) {
      // There was a '.', but an empty fractional part and no repeating part.
      // The '.' may be part of something else, i.e. '1..2'
      // so backtrack
      this.index = fractionalIndex;
      return { num: sign < 0 ? '-' + wholePart : wholePart };
    }

    this.skipVisualSpace();

    const exponent = this.parseExponent();

    if (!hasRepeatingPart && this.options.parseNumbers === 'rational') {
      const whole = parseInt(wholePart, 10);

      if (!fractionalPart) {
        if (exponent)
          return ['Multiply', sign * whole, ['Power', 10, exponent]];
        return sign * whole;
      }

      const fraction = parseInt(fractionalPart, 10);

      // Determine the number of decimal places in fractional part
      const n = fractionalPart.length;

      // Calculate numerator and denominator
      const numerator = whole * Math.pow(10, n) + fraction;
      const denominator = Math.pow(10, n);

      if (exponent) {
        return [
          'Multiply',
          ['Rational', sign * numerator, denominator],
          ['Power', 10, exponent],
        ];
      }
      return ['Rational', sign * numerator, denominator];
    }
    return {
      num:
        (sign < 0 ? '-' : '') +
        wholePart +
        (hasFractionalPart ? '.' + fractionalPart : '') +
        (exponent ? 'e' + exponent : ''),
    };
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
      this.nextToken();
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
      token = this.nextToken();
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
      value += this.nextToken();
    }

    // Parse the fractional part, if applicable
    if (!isInteger && this.match('.')) {
      value += '.';
      while (digits.includes(this.peek)) {
        value += this.nextToken();
      }
    }

    const result: number = isInteger
      ? Number.parseInt(value, radix)
      : Number.parseFloat(value);
    if (Number.isNaN(result)) return null;
    return negative ? -result : result;
  }

  private parsePrefixOperator(until?: Readonly<Terminator>): Expression | null {
    if (!until) until = { minPrec: 0 };
    if (!until.minPrec) until = { ...until, minPrec: 0 };

    const start = this.index;
    for (const [def, n] of this.peekDefinitions('prefix')) {
      this.index = start + n;
      const rhs = def.parse(this, { ...until, minPrec: def.precedence + 1 });
      if (rhs) return rhs;
    }
    this.index = start;
    return null;
  }

  private parseInfixOperator(
    lhs: Expression,
    until?: Readonly<Terminator>
  ): Expression | null {
    until ??= { minPrec: 0 };
    console.assert(until.minPrec !== undefined);
    if (until.minPrec === undefined) until = { ...until, minPrec: 0 };

    const start = this.index;
    for (const [def, n] of this.peekDefinitions('infix')) {
      if (def.precedence >= until.minPrec) {
        this.index = start + n;
        const rhs = def.parse(this, lhs, until);
        if (rhs) return rhs;
      }
    }
    this.index = start;
    return null;
  }

  /**
   * This returns an array of arguments (as in a function application),
   * or null if there is no match.
   *
   * - 'enclosure' : will look for an argument inside an enclosure
   *   (open/close fence)
   * - 'implicit': either an expression inside a pair of `()`, or just a product
   *  (i.e. we interpret `\cos 2x + 1` as `\cos(2x) + 1`)
   *
   */
  parseArguments(
    kind: 'enclosure' | 'implicit' = 'enclosure',
    until?: Readonly<Terminator>
  ): Expression[] | null {
    if (this.atTerminator(until)) return null;

    const savedIndex = this.index;

    const group = this.parseEnclosure();

    // We're looking for an enclosure i.e. `f(a, b, c)`
    if (kind === 'enclosure') {
      if (group === null) return null;
      return getSequence(group) ?? [];
    }

    // We are looking for an expression inside an optional pair of `()`
    // (i.e. trig functions, as in `\cos x`.)
    if (kind === 'implicit') {
      if (head(group) === 'Delimiter') {
        if (head(op1(group)) === 'Sequence') {
          const seq = op1(op1(group));
          return seq ? [seq] : [];
        }
        return op1(group) ? [op1(group)!] : [];
      }

      // Was there a matchfix? the "group" is the argument, i.e.
      // `\sin [a, b, c]`
      if (group !== null) return [group];

      // No group, but arguments without parentheses are allowed
      // Read a primary
      const primary = this.parseExpression({ ...until, minPrec: 390 });
      return primary === null ? null : [primary];
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
   *
   * @internal
   */
  private matchOpenDelimiter(
    openDelim: Delimiter,
    closeDelim: Delimiter
  ): LatexToken[] | null {
    const index = this.index;

    const closePrefix = OPEN_DELIMITER_PREFIX[this.peek];
    if (closePrefix) this.nextToken();

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

    this.nextToken();

    return result;
  }

  // matchMiddleDelimiter(delimiter: '|' | ':' | LatexToken): boolean {
  //   const delimiters = MIDDLE_DELIMITER[delimiter] ?? [delimiter];
  //   if (MIDDLE_DELIMITER_PREFIX.includes(this.peek)) {
  //     const index = this.index;
  //     this.nextToken();
  //     if (delimiters.includes(this.peek)) {
  //       this.nextToken();
  //       return true;
  //     }
  //     this.index = index;
  //     return false;
  //   } else if (delimiters.include(this.peek)) {
  //     this.nextToken();
  //     return true;
  //   }
  //   return false;
  // }

  /**
   * An enclosure is an opening matchfix operator, an optional expression,
   * optionally followed multiple times by a separator and another expression,
   * and finally a closing matching operator.
   */
  private parseEnclosure(): Expression | null {
    const defs = this.getDefs('matchfix') as Iterable<IndexedMatchfixEntry>;

    const start = this.index;

    //
    // Try each def
    //
    for (const def of defs) {
      this.index = start;

      // 1. Match the opening delimiter
      if (!this.matchDelimiter(def.openTrigger, def.closeTrigger)) continue;

      // 2. Collect the expression in between the delimiters
      const bodyStart = this.index;
      this.skipSpace();
      let body = this.parseExpression();
      this.skipSpace();
      if (!this.matchBoundary()) {
        // We couldn't parse the body up to the closing delimiter.
        // This could be a case where the boundary of the enclosure is
        // ambiguous, i.e. `|(a+|b|+c)|`. Attempt to parse without the boundary
        const boundary = this._boundaries[this._boundaries.length - 1].tokens;
        this.removeBoundary();
        this.index = bodyStart;
        this.skipSpace();
        body = this.parseExpression();
        this.skipSpace();
        // If still could not match, try another
        if (!this.matchAll(boundary)) {
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
   * A generic expression is used for dictionary entries that take do
   * some complex (non-standard) parsing. This includes trig functions (to
   * parse implicit arguments), and integrals (to parse the integrand and
   * limits and the "dx" terminator).
   */

  private parseGenericExpression(
    until?: Readonly<Terminator>
  ): Expression | null {
    if (this.atTerminator(until)) return null;

    const start = this.index;
    let expr: Expression | null = null;
    const fnDefs = this.peekDefinitions('expression') ?? [];
    for (const [def, tokenCount] of fnDefs) {
      // Skip the trigger tokens
      this.index = start + tokenCount;
      if (typeof def.parse === 'function') {
        // Give a custom parser a chance to parse the expression
        expr = def.parse(this, until);
        if (expr !== null) return expr;
      } else {
        return def.name!;
      }
    }

    this.index = start;
    return null;
  }

  /**
   * A function is an identifier followed by postfix operators
   * (`\prime`...) and some arguments.
   */

  private parseFunction(until?: Readonly<Terminator>): Expression | null {
    if (this.atTerminator(until)) return null;

    const start = this.index;
    //
    // Is there a definition for this as a function? (a string wrapped in
    //  `\\mathrm`, etc...)
    //
    let fn: Expression | null = null;
    for (const [def, tokenCount] of this.peekDefinitions('function')) {
      // Skip the trigger tokens
      this.index = start + tokenCount;
      if (typeof def.parse === 'function') {
        // Give a custom parser a chance to parse the function
        fn = def.parse(this, until);
        if (fn !== null) return fn;
      } else {
        fn = def.name!;
        break;
      }
    }

    //
    // No known function definition matched.
    //
    if (fn === null) {
      this.index = start;
      fn = parseIdentifier(this);
      if (!this.isFunctionHead(fn)) {
        this.index = start;
        return null;
      }
    }

    //
    // Is it followed by one or more postfix (e.g. `\prime`)
    //
    do {
      const pf = this.parsePostfixOperator(fn, until);
      if (pf === null) break;
      fn = pf;
    } while (true);

    // If fn is a function identifier (i.e. not a symbol), it may be followed
    // by an argument list

    const args = this.parseArguments('enclosure', until);

    if (args === null) return fn;

    return typeof fn === 'string' ? [fn, ...args] : ['Apply', fn!, ...args];
  }

  parseSymbol(until?: Readonly<Terminator>): Expression | null {
    if (this.atTerminator(until)) return null;

    const start = this.index;

    //
    // Is there a custom parser for this symbol?
    //
    for (const [def, tokenCount] of this.peekDefinitions('symbol')) {
      this.index = start + tokenCount;
      // @todo: should capture symbol, and check it is not in use as a symbol,  function, or inferred (calling parseUnknownIdentifier() or somethinglike it (parseUnknownIdentifier() may aggressively return 'symbol'...)). Maybe not during parsing, but canonicalization
      if (typeof def.parse === 'function') {
        const result = def.parse(this, until);
        if (result) return result;
      } else return def.name!;
    }

    // No custom parser worked. Backtrack.
    // (we shouldn't need to backtrack, but this is in case there's a bug
    // in a custom parser)
    this.index = start;

    const id = parseIdentifier(this);
    if (id === null) return null;

    // Are we OK with it as a symbol?
    // Note: by the time we call parseUnknownIdentifier(),
    // we know it is a valid identifier
    if (this.options.parseUnknownIdentifier?.(id, this) === 'symbol') return id;

    // This was an identifier, but not a valid symbol. Backtrack
    this.index = start;
    return null;
  }

  /**
   * Parse a sequence superfix/subfix operator, e.g. `^{*}`
   *
   * Superfix and subfix need special handling:
   *
   * - they act mostly like an infix operator, but they are commutative, i.e.
   * `x_a^b` should be parsed identically to `x^b_a`.
   *
   * - furthermore, in LaTeX `x^a^b` parses the same as `x^a{}^b`.
   *
   */
  private parseSupsub(lhs: Expression): Expression | null {
    if (this.atEnd) return lhs;
    console.assert(lhs !== null);

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
            this.parseGroup() ?? this.parseToken() ?? this.parseStringGroup();
          if (sub === null) return this.error('missing', index);

          subscripts.push(sub);
        }
      } else if (this.match('^')) {
        subIndex = this.index;
        if (this.match('_') || this.match('^'))
          superscripts.push(this.error('syntax-error', subIndex));
        else {
          const sup = this.parseGroup() ?? this.parseToken();
          if (sup === null) return this.error('missing', index);
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
      const defs = [...this.getDefs('infix')].filter(
        (x) => x.latexTrigger === '_'
      ) as IndexedInfixEntry[];
      if (defs) {
        const arg: Expression = [
          'Subscript',
          result,
          subscripts.length === 1 ? subscripts[0] : ['List', ...subscripts],
        ];
        for (const def of defs) {
          if (typeof def.parse === 'function')
            result = def.parse(this, arg, { minPrec: 0 });
          else result = arg;
          if (result) break;
        }
      }
    }

    //
    // 3/ Apply superscripts (second)
    //
    if (superscripts.length > 0) {
      const defs = [...this.getDefs('infix')].filter(
        (x) => x.latexTrigger === '^'
      ) as IndexedInfixEntry[];

      if (defs) {
        const nonEmptySuperscripts = superscripts.filter(
          (x) => !(head(x) === 'Sequence' && nops(x) === 0)
        ) as Expression[];
        if (nonEmptySuperscripts.length !== 0) {
          const superscriptExpression: Expression =
            nonEmptySuperscripts.length === 1
              ? nonEmptySuperscripts[0]
              : ['List', ...nonEmptySuperscripts];
          const arg: Expression = [
            'Superscript',
            result!,
            superscriptExpression,
          ];
          for (const def of defs) {
            if (typeof def.parse === 'function')
              result = def.parse(this, arg, { minPrec: 0 });
            else result = arg;
            if (result) break;
          }
        }
      }
    }

    // Restore the index if we did not find a match
    if (result === null) this.index = index;

    return result;
  }

  parsePostfixOperator(
    lhs: Expression | null,
    until?: Readonly<Terminator>
  ): Expression | null {
    console.assert(lhs !== null); // @todo validate
    if (lhs === null || this.atEnd) return null;

    const start = this.index;
    for (const [def, n] of this.peekDefinitions('postfix')) {
      this.index = start + n;
      const result = def.parse(this, lhs, until);
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
  private parseStringGroupContent(): string {
    const start = this.index;
    let result = '';
    let level = 0;
    while (!this.atBoundary || level > 0) {
      const token = this.nextToken();
      if (token === '<$>' || token === '<$$>') {
        this.index = start;
        return '';
      }
      if (token === '<{>') {
        level += 1;
        result += '\\{';
      } else if (token === '<}>') {
        level -= 1;
        result += '\\}';
      } else if (token === '<space>') {
        result += ' ';
      } else if (token[0] === '\\') {
        // TeX will give a 'Missing \endcsname inserted' error
        // if it encounters any command when expecting a string.
        // We're a bit more lax.
        // @todo: interpret some symbols, i.e. \alpha, etc..
        result += token;
      } else {
        result += token;
      }
    }
    return result;
  }

  /**
   * This method can be invoked when we know we're in an error situation.
   *
   * In general, if a context does not apply, we return `null` to give
   * the chance to some other option to be considered. However, in some cases
   * we know we've exhausted all posibilities, and in this case this method
   * will return an error expression as informative as possible.
   *
   * We've encountered a LaTeX command or symbol but were not able to match it
   * to any entry in the LaTeX dictionary, or ran into it in an unexpected
   * context (postfix operator lacking an argument, for example)
   */
  parseSyntaxError(): Expression {
    const start = this.index;

    //
    // Is this an unexpected operator?
    // (this is an error handling code path)
    //
    // '^' is a special infix operator, with a custom parser
    if (this.peek === '^') {
      this.index += 1;
      return [
        'Superscript',
        this.error('missing', start),
        missingIfEmpty(this.parseGroup()),
      ];
    }

    let opDefs = this.peekDefinitions('operator');
    if (opDefs.length > 0) {
      opDefs = this.peekDefinitions('postfix');
      if (opDefs.length > 0) {
        const [def, n] = opDefs[0] as [IndexedPostfixEntry, number];
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
      if (opDefs.length > 0) {
        const [def, n] = opDefs[0] as [IndexedPrefixEntry, number];
        this.index += n;
        if (typeof def.parse === 'function') {
          const result = def.parse(this, { minPrec: 0 });
          if (result) return result;
        }
        if (def.name)
          return [
            def.name,
            // @todo: pass a precedence?
            this.parseExpression() ?? this.error('missing', start),
          ];
        return this.error('unexpected-operator', start);
      }

      opDefs = this.peekDefinitions('infix');
      if (opDefs.length > 0) {
        const [def, n] = opDefs[0] as [IndexedInfixEntry, number];
        this.index += n;
        const result = def.parse(this, this.error('missing', start), {
          minPrec: 0,
        });
        if (result) return result;
        // if (def.name)
        //   return [
        //     def.name,
        //     this.error('missing', start),
        //     this.error('missing', start),
        //   ];
        return this.error('unexpected-operator', start);
      }
    }

    const index = this.index;

    let id = parseInvalidIdentifier(this);
    if (id) return id;
    id = parseIdentifier(this);
    if (id) return this.error(['unexpected-identifier', id], index);

    const command = this.peek;
    if (!command) {
      return this.error('syntax-error', start);
    }
    if (command[0] !== '\\') {
      return this.error(
        ['unexpected-token', { str: tokensToString(command) }],
        start
      );
    }

    // If the command is an open or close delimiter prefix, exit
    if (isDelimiterCommand(this))
      return this.error('unexpected-delimiter', start);

    const errorToken = this.nextToken();

    this.skipSpaceTokens();

    if (errorToken === '\\end') {
      const name = this.parseStringGroup();

      return name === null
        ? this.error('expected-environment-name', start)
        : this.error(['unbalanced-environment', { str: name }], start);
    }

    // Capture potential optional and required LaTeX arguments
    // This is a lazy capture, to handle the case `\foo[\blah[12]\blarg]`.
    // However, a `[` could be e.g. inside a string and this
    // would fail to parse.
    // Since we're already in an error situation, though, probably OK.
    while (this.match('[')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== ']') {
        if (this.peek === '[') level += 1;
        if (this.peek === ']') level -= 1;
        this.nextToken();
      }
      this.match(']');
    }

    // Capture any potential arguments to this unexpected command

    while (this.match('<{>')) {
      let level = 0;
      while (!this.atEnd && level === 0 && this.peek !== '<}>') {
        if (this.peek === '<{>') level += 1;
        if (this.peek === '<}>') level -= 1;
        this.nextToken();
      }
      this.match('<}>');
    }

    return this.error(
      ['unexpected-command', { str: tokensToString(errorToken) }],
      start
    );
  }

  /**
   * <primary> :=
   *  (<number> | <symbol> | <environment> | <matchfix-expr>)
   *    <subsup>* <postfix-operator>*
   *
   * <symbol> ::=
   *  (<symbol-id> | (<latex-command><latex-arguments>)) <arguments>
   *
   * <matchfix-expr> :=
   *  <matchfix-op-open>
   *  <expression>
   *  (<matchfix-op-separator> <expression>)*
   *  <matchfix-op-close>
   *
   */
  private parsePrimary(until?: Readonly<Terminator>): Expression | null {
    if (this.atBoundary) return null;

    if (this.atTerminator(until)) return null;

    let result: Expression | null = null;
    const start = this.index;

    //
    // 1. Is it a group? (i.e. `{...}`)
    //
    // Unabalanced `<}>`? Syntax error
    if (this.match('<}>'))
      return this.error('unexpected-closing-delimiter', start);

    result ??= this.parseGroup();

    //
    // 2. Is it a number?
    //
    result ??= this.parseNumber();

    //
    // 3. Is it an enclosure, i.e. a matchfix expression?
    //    (group fence, absolute value, integral, etc...)
    // (check before other LaTeX commands)
    //
    result ??= this.parseEnclosure();

    //
    // 4. Is it an environment?
    //    `\begin{...}...\end{...}`
    // (check before other LaTeX commands)
    //
    result ??= this.parseEnvironment(until);

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

    // ParseGenericExpression() has priority. Some generic expressions
    // may include symbols which have not been explicitly defined
    // with a 'symbol' kind
    result ??=
      this.parseGenericExpression(until) ??
      this.parseFunction(until) ??
      this.parseSymbol(until) ??
      parseInvalidIdentifier(this);

    // We're parsing invalid identifier explicitly so we can get a
    // better error message, otherwise we would end up with "unexpected
    // token")

    //
    // 6. Are there postfix operators ?
    //
    if (result !== null) {
      result = this.decorate(result, start);
      let postfix: Expression | null = null;
      let index = this.index;
      do {
        postfix = this.parsePostfixOperator(result, until);
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
    if (result !== null) result = this.parseSupsub(result);

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
   * Stop when an operator of precedence less than `until.minPrec`
   * is encountered
   */
  parseExpression(until?: Readonly<Terminator>): Expression | null {
    // We want to skip spaces before parsing the expression
    // That way, an "empty" `{}` expression is still considered
    // valid.
    this.skipSpace();

    const start = this.index;
    if (this.atBoundary) {
      this.index = start;
      return null;
    }

    until ??= { minPrec: 0 };
    console.assert(until.minPrec !== undefined);
    if (until.minPrec === undefined) until = { ...until, minPrec: 0 };

    //
    // 1. Do we have a prefix operator?
    //
    let lhs = this.parsePrefixOperator({ ...until, minPrec: 0 });

    //
    // 2. Do we have a primary?
    // (if we had a prefix, it consumed the primary following it)
    //
    if (lhs === null) {
      lhs = this.parsePrimary(until);
      // If we got an empty sequence, ignore it.
      // This is returned by some purely presentational commands,
      // for example `\displaystyle`
      if (head(lhs) === 'Sequence' && nops(lhs) === 0) lhs = null;
    }

    //
    // 3. Are there some infix operators?
    //
    if (lhs) {
      let done = false;
      while (!done && !this.atTerminator(until)) {
        this.skipSpace();

        let result = this.parseInfixOperator(lhs, until);
        if (result === null) {
          // If any operator, no sequence to apply
          if (this.peekDefinitions('operator').length === 0) {
            // No infix operator, join the expressions with a Sequence
            const rhs = this.parseExpression({
              ...until,
              minPrec: MULTIPLICATION_PRECEDENCE,
            });
            if (rhs !== null) {
              if (head(lhs) === 'InvisibleOperator') {
                if (head(rhs) === 'InvisibleOperator')
                  result = ['InvisibleOperator', ...ops(lhs)!, ...ops(rhs)!];
                else result = ['InvisibleOperator', ...ops(lhs)!, rhs];
              } else if (head(rhs) === 'InvisibleOperator') {
                result = ['InvisibleOperator', lhs, ...ops(rhs)!];
              } else result = ['InvisibleOperator', lhs, rhs];
            }
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
    let msg: Expression;
    if (typeof code === 'string') {
      console.assert(!code.startsWith("'"));
      msg = { str: code };
    } else {
      console.assert(!code[0].startsWith("'"));
      msg = ['ErrorCode', { str: code[0] }, ...code.slice(1)];
    }

    const latex = this.latex(fromToken, this.index);
    return latex
      ? ['Error', msg, ['LatexString', { str: latex }]]
      : ['Error', msg];
  }

  private isFunctionHead(expr: Expression | null): boolean {
    if (expr === null) return false;

    const s = symbol(expr);
    if (!s) return false;

    // Is this a known symbol with a definition?
    if (this.computeEngine?.lookupFunction(s) !== undefined) return true;

    // Is this a valid function identifier?
    if (this.options.parseUnknownIdentifier?.(s, this) === 'function')
      return true;

    // This doesn't look like the expression could be the head of a function:
    // it's a number, a string, a symbol identifier or something else.
    return false;
  }

  /** Return all defs of the specified kind */
  *getDefs(kind: string): Iterable<IndexedLatexDictionaryEntry> {
    if (kind === 'operator') {
      for (const def of this._dictionary.defs)
        if (/^prefix|infix|postfix/.test(def.kind)) yield def;
    } else {
      for (const def of this._dictionary.defs) if (def.kind === kind) yield def;
    }
  }
}

/** Return the number of tokens matched, 0 if none */
function parseComplexId(parser: Parser, id: string): number {
  const start = parser.index;

  const candidate = parseIdentifier(parser)?.trim();
  if (candidate === null) return 0;

  const result = candidate !== id ? 0 : parser.index - start;

  parser.index = start;

  return result;
}

function isDelimiterCommand(parser: Parser): boolean {
  const command = parser.peek;
  if (
    Object.values(CLOSE_DELIMITER).includes(command) ||
    CLOSE_DELIMITER[command]
  ) {
    parser.nextToken();
    return true;
  }

  if (
    OPEN_DELIMITER_PREFIX[command] ||
    Object.values(OPEN_DELIMITER_PREFIX).includes(command)
  ) {
    parser.nextToken();
    parser.nextToken();
    return true;
  }

  return false;
}
