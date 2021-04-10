import { codePointLength, isLinebreak } from './characters';

export type DiagnosticCode =
  | 'binary-number-expected'
  | 'closing-bracket-expected' // %0 = bracket
  | 'decimal-number-expected'
  | 'eof-expected' // %0 = unexpected symbol
  | 'empty-verbatim-symbol'
  | 'end-of-comment-expected'
  | 'exponent-expected'
  | 'expression-expected'
  | 'hexadecimal-number-expected'
  | 'invalid-symbol-name' // %0 = symbol name
  | 'invalid-escape-sequence' // &0 = escape sequence char
  | 'invalid-unicode-codepoint-string' // %0 = codepoint string
  | 'invalid-unicode-codepoint-value' // %0 = codepoint
  | 'literal-expected' // %0 = literal
  | 'multiline-string-expected'
  | 'multiline-whitespace-expected'
  | 'opening-bracket-expected' // %0 = bracket
  | 'primary-expected'
  | 'string-literal-opening-delimiter-expected'
  | 'string-literal-closing-delimiter-expected' // %0 = delimiter
  | 'symbol-expected'
  | 'unbalanced-verbatim-symbol' // %0 = symbol name
  | 'unexpected-symbol'; // %0 symbol, %1 = trace

export type DiagnosticMessage = DiagnosticCode | [DiagnosticCode, ...any];

/**
 * The parser will attempt to continue parsing even when an error is
 * encountered.
 *
 * However, in the rare cases where parsing cannot proceed, this
 * error will be thrown.
 *
 * This would happen if a `#error` directive is encountered.
 */
export class FatalParsingError extends Error {
  constructor(msg: string) {
    super();
    this.message = msg;
  }
}

export type Fixit = [start: number, end: number, value: string];

export type ParsingDiagnostic = {
  // A `warning` is a diagnostic that indicate something that does not
  // prevent the code from being compiled. It could be a linting issue for
  // example.
  // An `error` is something that will prevent the code from being parsed.
  severity: 'warning' | 'error';
  message: DiagnosticMessage;
  range: [start: number, end: number, position?: number];
  // "Fixits" is a suggestion in the form of a series of operations
  // to modify the source in a way that could address the warning or error.
  // The fixit for a warning is always safe to apply. The fixit for an error
  // is a guess and should be reviewed before being applied.
  fixits?: Fixit[];
};

export interface Rules {
  parse<T = any>(
    name: string,
    parser: Parser | string,
    url?: string
  ): Result<T>;
  has(name: string): boolean;
}

export type Combinator<T = any> = [
  label: string,
  parser: (parser: Parser) => Result<T>
];

/**
 * The `Parser` keeps track of what we are parsing (the source) and what we have
 * parsed so far (the offset).
 */
export class Parser {
  private rules: Rules;
  readonly url: string;
  readonly source: string;
  protected _offset = 0;
  length = 0;
  private _trace: string[];

  constructor(rules: Rules, source: string, url: string) {
    this.rules = rules;
    this.source = source;
    this.url = url;
    this.length = source.length;
    this._trace = [];
  }

  get(offset: number): number {
    return this.source.codePointAt(offset);
  }

  atEnd(): boolean {
    return this.offset >= this.source.length;
  }

  atLinebreak(): boolean {
    return isLinebreak(this.source.codePointAt(this.offset));
  }

  atString(s: string): boolean {
    let i = 0;
    let match = true;
    const start = this.offset;
    while (match && i < s.length && i < this.source.length) {
      match = this.get(start + i) === s.codePointAt(i);
      i += 1;
    }
    return match;
  }

  slice(start: number, end?: number): string {
    return this.source.slice(start, end);
  }

  get offset(): number {
    return this._offset;
  }

  trace(rule: string | Combinator | ((parser: Parser) => Result)): string[] {
    return [
      ...this._trace,
      typeof rule === 'string'
        ? rule
        : typeof rule === 'function'
        ? '???'
        : rule[0],
    ];
  }

  skipTo(offset: number): Parser {
    this._offset = offset;
    return this;
  }
  fatalError(msg: string): void {
    throw new FatalParsingError(msg);
  }

  hasRule(rule: string): boolean {
    return this.rules.has(rule);
  }
  parse<T>(
    rule: string | Combinator<T> | ((parser: Parser) => Result<T>),
    fromOffset?: number
  ): Result<T> {
    this._trace.push(
      typeof rule === 'string'
        ? rule
        : typeof rule === 'function'
        ? '???'
        : rule[0]
    );

    if (fromOffset !== undefined) this.skipTo(fromOffset);
    let result: Result<T>;
    if (typeof rule === 'string') result = this.rules.parse<T>(rule, this);
    else if (typeof rule === 'function') result = rule(this);
    else result = rule[1](this);
    this._trace.pop();
    return result;
  }

  parseWhitespace(): Result<boolean> {
    if (!this.hasRule('whitespace')) return this.ignore();
    return this.parse('whitespace');
  }

  ignore(): Result {
    const result = new Result(this);
    return result.ignore();
  }
  failure(): Result {
    const result = new Result(this);
    return result.failure();
  }
}

/**
 * The result of applying a parsing rule:
 * - `Ignore`: the rule matched and the result can be ignored
 * - `Failure`: the rule did not match at all. Maybe try something else?
 * - `Success`: the rule matched and generated a value that can be passed on.
 * - `Error`: the rule matched, then something went wrong. Probably a
 * syntax error. It still produced a value so the parsing can attempt to
 * recover and continue (Panic Mode).
 */
export class Result<IR = any> {
  readonly _parser: Parser;
  // An `undefined` value indicate a failure (the rule did not match)
  // A `null` value indicate the result should be ignored
  _value: undefined | null | IR;
  _diagnostics?: ParsingDiagnostic[];
  _range: [start: number, end: number];
  constructor(parser: Parser) {
    this._parser = parser;
    this._range = [parser.offset, parser.offset];
  }
  copyDiagnostics(from: Result<any>): void {
    if (!from.isError) return;
    if (this._diagnostics === undefined) this._diagnostics = [];
    this._diagnostics = [...this._diagnostics, ...from._diagnostics];
  }
  get parser(): Parser {
    return this._parser;
  }
  get diagnostics(): ParsingDiagnostic[] {
    return this._diagnostics;
  }
  get isFailure(): boolean {
    return this._diagnostics === undefined && this._value === undefined;
  }
  get isEmpty(): boolean {
    return this._diagnostics === undefined && this._value === null;
  }
  get isSuccess(): boolean {
    return (
      this._diagnostics === undefined &&
      this._value !== undefined &&
      this._value !== null
    );
  }
  get isError(): boolean {
    return this._diagnostics !== undefined;
  }
  get start(): number {
    return this._range[0];
  }
  get end(): number {
    return this._range[1];
  }
  set end(val: number) {
    this._range[1] = val;
  }
  set range(val: [start: number, end: number]) {
    this._range = val;
  }
  get value(): IR {
    return this._value;
  }
  set value(val: IR) {
    this._value = val;
  }
  /**
   * Use when a portion of the source has been successfully parsed.
   */
  success(val: IR): Result<IR> {
    this._value = val;
    this._range[1] = this._parser.offset - 1;
    return this;
  }
  // successAt(val: IR, offset: number): Result<IR> {
  //   this._value = val;
  //   this._parser.skipTo(offset);
  //   this._range[1] = offset - 1;
  //   return this;
  // }
  /**
   * A `failure` indicates a failed attempt to parse, with no presumption
   * of success, for example when exploring multiple alternatives.
   *
   * `state` indicate where to restart parsing from.
   *
   * The `error` includes the origin (offset) of the failure. It could be after
   * the `state`.
   *
   */
  failure(): Result {
    this._parser.skipTo(this._range[0]);
    return this;
  }
  /**
   * An `ignore` result indicates success in parsing, but with a result that
   * can be ignored.
   *
   * This is useful for whitespace, keywords, braces and other similar syntactic
   * constructs.
   *
   * `next` is the offset from which parsing can continue.
   * `start` is the offset in the source where the element was first ignored.
   *
   */
  ignore(): Result {
    this._value = null;
    return this;
  }
  ignoreUntil(offset: number): Result {
    this._parser.skipTo(offset);
    this._range[1] = this._parser.offset;
    this._value = null;
    return this;
  }
  /**
   * An `error` is used when an unexpected failure was encountered.
   * It typically indicates a syntax error.
   *
   * Nonetheless, an attempt is made to recover.
   *
   * The range indicate the portion of the source covered by this result.
   * The optional `pos` indicate where the error occurred. It's the `end`
   * by default.
   *
   */
  error(
    value: IR,
    msg: DiagnosticMessage | ((Parser) => DiagnosticMessage),
    fixits?: Fixit[]
  ): Result<IR> {
    this._value = value;
    this._range[1] = this._parser.offset - 1;
    if (!this._diagnostics) this._diagnostics = [];
    this._diagnostics.push({
      severity: 'error',
      range: [this._range[0], this._range[1]],
      message: typeof msg === 'function' ? msg(this) : msg,
      fixits,
    });
    return this;
  }
  errorAt(
    value: IR,
    msg: DiagnosticMessage | ((Parser) => DiagnosticMessage),
    pos: number,
    fixits?: Fixit[]
  ): Result<IR> {
    this._value = value;
    this._range[1] = this._parser.offset - 1;
    if (!this._diagnostics) this._diagnostics = [];
    this._diagnostics.push({
      severity: 'error',
      range: [this._range[0], this._range[1], pos],
      message: typeof msg === 'function' ? msg(this) : msg,
      fixits,
    });
    return this;
  }
  errorFrom(result: Result, value: IR): Result<IR> {
    this._value = value;
    this._range[1] = this._parser.offset - 1;
    if (!this._diagnostics) this._diagnostics = [];
    this._diagnostics = [...this._diagnostics, ...result._diagnostics];
    return this;
  }
  warning(msg: DiagnosticMessage, fixits?: Fixit[]): Result {
    this._range[1] = this._parser.offset - 1;
    if (!this._diagnostics) this._diagnostics = [];
    this._diagnostics.push({
      severity: 'warning',
      range: [this._range[0], this._range[1]],
      message: msg,
      fixits,
    });
    return this;
  }
}

export function skipUntil(parser: Parser, value: number): number {
  let i = parser.offset;
  while (i < parser.length) {
    const c = parser.get(i);
    if (c === value) return i;
    i += codePointLength(c);
  }
  return -1;
}

export function skipUntilString(parser: Parser, pattern: string): number {
  let i = parser.offset;
  const cps = [...pattern].map((x) => x.codePointAt(0));
  while (i < pattern.length - cps.length) {
    let c = parser.get(i);
    if (c === cps[0]) {
      let match = true;
      let j = 1;
      while (match && j < cps.length) {
        c = parser.get(i);
        match = c === cps[j];
        if (match) {
          j += 1;
          i += codePointLength(c);
        }
      }
      if (match) return i;
    }
    i += codePointLength(c);
  }
  return -1;
}
