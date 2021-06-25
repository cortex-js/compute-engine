/* eslint-disable no-empty */
/* eslint-disable @typescript-eslint/no-empty-function */
import { Expression, ErrorCode, ErrorListener } from '../public';
import {
  ParseLatexOptions,
  LatexDictionaryEntry,
  LatexToken,
  NumberFormattingOptions,
  ParserFunction,
} from './public';
import {
  isFunctionObject,
  getFunctionName,
  getTail,
  isNumberObject,
  PARENTHESES,
  LATEX_TOKENS,
  NOTHING,
  MISSING,
  isRationalNumber,
} from '../common/utils';
import { tokensToString } from './core/tokenizer';
import { IndexedLatexDictionary } from './definitions';
import {
  DEFAULT_LATEX_NUMBER_OPTIONS,
  DEFAULT_PARSE_LATEX_OPTIONS,
} from './utils';

export class Scanner<T extends number = number> implements Scanner<T> {
  index = 0;

  readonly tokens: LatexToken[];

  readonly onError: ErrorListener<ErrorCode>;

  readonly dictionary: IndexedLatexDictionary<T>;

  readonly options: Required<NumberFormattingOptions> &
    Required<ParseLatexOptions>;

  private invisibleOperatorPrecedence: number;

  constructor(
    tokens: LatexToken[],
    options: Required<NumberFormattingOptions> & Required<ParseLatexOptions>,
    dictionary: IndexedLatexDictionary<T>,
    onError: ErrorListener<ErrorCode>
  ) {
    this.options = {
      ...DEFAULT_LATEX_NUMBER_OPTIONS,
      ...DEFAULT_PARSE_LATEX_OPTIONS,
      ...options,
    };
    this.tokens = tokens;

    this.onError = (err) => {
      return onError({
        ...err,
        before: this.latexBefore(),
        after: this.latexAfter(),
      });
    };
    this.dictionary = dictionary;

    let def: LatexDictionaryEntry<T> | undefined;
    this.invisibleOperatorPrecedence = 0;
    if (this.options.invisibleOperator) {
      def = this.dictionary.name.get(this.options.invisibleOperator);
      if (def === undefined) {
        onError({
          code: 'unknown-operator',
          arg: 'invisible operator ' + this.options.invisibleOperator,
        });
      } else if (def.precedence === undefined) {
        onError({
          code: 'expected-operator',
          arg: 'invisible operator ' + this.options.invisibleOperator,
        });
      } else {
        this.invisibleOperatorPrecedence = def.precedence;
      }
    }
  }

  clone(start: number, end: number): Scanner<T> {
    return new Scanner<T>(
      this.tokens.slice(start, end),
      this.options,
      this.dictionary,
      this.onError
    );
  }

  balancedClone(
    open: LatexToken | LatexToken[],
    close: LatexToken | LatexToken[],
    silentError = true
  ): Scanner<T> | null {
    if (!this.matchAll(open)) {
      if (!silentError) {
        this.onError({
          code: 'syntax-error',
          arg: 'Expected ' + tokensToString(open),
        });
      }
      return null;
    }
    const start = this.index;
    let end = start;
    let level = 1;
    while (!this.atEnd && level !== 0) {
      this.skipSpace();
      // In case of ambiguity, we prioritize close fence over open,
      // e.g. `|a|+b+|c|` -> `(|a|)+b+(|c|)`
      // So we check *first* if it's a closefence, before trying to
      // match an expression which would interpret an open fence
      end = this.index;
      if (this.matchAll(close)) {
        level -= 1;
      } else if (this.matchAll(open)) {
        level += 1;
      } else {
        this.next();
      }
    }
    if (level !== 0) {
      if (!silentError) {
        this.onError({
          code: 'unbalanced-symbols',
          arg: tokensToString(open) + tokensToString(close),
        });
      }
      this.index = start;
      return null;
    }
    return this.clone(start, end);
  }

  get atEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  get peek(): LatexToken {
    return this.tokens[this.index];
  }

  latex(start: number, end?: number): string {
    return tokensToString(this.tokens.slice(start, end));
  }

  latexAhead(n: number): string {
    return tokensToString(this.tokens.slice(this.index, this.index + n));
  }
  latexBefore(): string {
    return this.latex(0, this.index);
  }
  latexAfter(): string {
    return this.latex(this.index);
  }

  /**
   * Return at most `maxLookahead` strings made from the tokens
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
      this.dictionary.lookahead,
      this.tokens.length - this.index
    );
    const result: string[] = [];
    while (n > 0) {
      result[n] = this.latexAhead(n--);
    }
    return result;
  }

  peekDefinition(
    kind:
      | 'symbol'
      | 'infix'
      | 'matchfix'
      | 'prefix'
      | 'postfix'
      | 'superfix'
      | 'subfix'
      | 'operator'
  ): [LatexDictionaryEntry<T> | null, number] {
    let defs: (undefined | LatexDictionaryEntry<T>)[];
    if (kind === 'operator') {
      defs = this.lookAhead().map(
        (x, n) =>
          this.dictionary.infix[n]?.get(x) ??
          this.dictionary.postfix[n]?.get(x) ??
          this.dictionary.prefix[n]?.get(x)
      );
    } else {
      defs = this.lookAhead().map((x, n) => this.dictionary[kind][n]?.get(x));
    }
    for (let i = defs.length; i > 0; i--) {
      if (defs[i] !== undefined) return [defs[i]!, i];
    }
    return [null, 0];
  }

  next(): LatexToken {
    return this.tokens[this.index++];
  }

  skipSpace(): boolean {
    // Check if the have a `{}` token sequence.
    // Those are used in LaTeX to force an invisible separation between commands
    if (
      !this.atEnd &&
      this.peek === '<{>' &&
      this.tokens[this.index + 1] === '<}>'
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
      (this.options.ignoreCommands.includes(this.peek) ||
        this.options.idempotentCommands.includes(this.peek))
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

  match(target: LatexToken): boolean {
    if (this.tokens[this.index] === target) {
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
      matched = this.tokens[this.index + i] === target[i++];
    } while (matched && i < target.length);
    if (matched) {
      this.index += i;
    }
    return matched;
  }

  matchAny(targets: LatexToken[]): LatexToken {
    if (targets.includes(this.tokens[this.index])) {
      return this.tokens[this.index++];
    }
    return '';
  }

  matchWhile(targets: LatexToken[]): LatexToken[] {
    const result: LatexToken[] = [];
    while (targets.includes(this.tokens[this.index])) {
      result.push(this.tokens[this.index++]);
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

  matchOperator(
    kind: 'infix' | 'prefix' | 'postfix',
    lhs: Expression<T> | null = null,
    minPrec = 0
  ): Expression<T> | null {
    const [def, n] = this.peekDefinition(kind);

    if (def === null) return null;

    if (typeof def.parse === 'function') {
      // Custom parser found
      let rhs: Expression<T> | null = null;
      [lhs, rhs] = (def.parse as ParserFunction<T>)(lhs, this, minPrec);
      if (rhs === null) return null;

      return this.applyInvisibleOperator(lhs, rhs);
    }

    let prec = def.precedence;
    if (prec === undefined || prec < minPrec) return null;
    prec += def.associativity === 'left' ? 1 : 0;

    this.index += n;
    const rhs = this.matchExpression(prec);
    return this.applyInvisibleOperator(
      ...this.applyOperator(def.parse as string, lhs, rhs)
    );
  }

  matchArguments(
    kind: undefined | '' | 'group' | 'implicit'
  ): Expression<T>[] | null {
    if (!kind) return null;

    const savedIndex = this.index;
    let result: Expression<T>[] | null = null;

    const group = this.matchMatchfixOperator();

    if (kind === 'group' && getFunctionName(group) === PARENTHESES) {
      // We got a group i.e. `f(a, b, c)`
      result = getTail(group);
    } else if (kind === 'implicit') {
      // Does this function allow arguments with optional parentheses?
      // (i.e. trig functions, as in `\cos x`.
      if (getFunctionName(group) === PARENTHESES) {
        result = getTail(group);
      } else if (group !== null) {
        // There was a matchfix, the "group" is the argument, i.e.
        // `\sin [a, b, c]`
        result = [group];
      } else {
        // No group, but arguments without parentheses are allowed
        // Read a primary
        // (i.e. we interpret `\cos x + 1` as `\cos(x) + 1`)
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

  matchMatchfixOperator(): Expression<T> | null {
    const [def] = this.peekDefinition('matchfix');
    if (def === null) return null;

    if (typeof def.parse === 'function') {
      // Custom parser: invoke it.
      return this.applyInvisibleOperator(
        ...(def.parse as ParserFunction<T>)(null, this, 0)
      );
    }
    const trigger =
      typeof def.trigger === 'object' ? def.trigger.matchfix : def.trigger;
    if (!trigger || !def.closeFence || !def.parse) return null;
    const arg = this.matchBalancedExpression(
      trigger,
      def.closeFence,
      this.onError
    );
    if (!arg) return [def.parse];
    return [def.parse, arg];
  }

  matchDefinition(
    kind:
      | 'symbol'
      | 'infix'
      | 'matchfix'
      | 'prefix'
      | 'postfix'
      | 'superfix'
      | 'subfix'
      | 'operator'
  ): [LatexDictionaryEntry<T> | null, Expression<T> | null] {
    // Find the longest string of tokens with a definition of the
    // specified kind
    const [def, tokenCount] = this.peekDefinition(kind);

    // If there is a custom parsing function associated with this
    // definition, invoke it.
    if (typeof def?.parse === 'function') {
      const [, result] = (def.parse as ParserFunction<T>)(null, this, 0);
      return [def, result];
    }
    this.index += tokenCount;

    return [def, null];
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
    const [def, result] = this.matchDefinition('symbol');

    // If a result is ready (because there was a parsing function associated
    // with the definition), we're done
    if (result !== null) return result;

    if (def === null) {
      // This is an unknown symbol.
      // Can we promote it?
      if (this.options.promoteUnknownFunctions?.test(this.peek)) {
        const name = this.next();
        // this.onError({ code: 'unknown-function', arg: name });
        const group = this.matchMatchfixOperator();
        // If no arguments, return it as a symbol
        if (group === null) return name;
        if (getFunctionName(group) !== PARENTHESES) return null;
        return [name, ...getTail(group)];
      }
      if (this.options.promoteUnknownSymbols?.test(this.peek)) {
        // this.onError({ code: 'unknown-symbol', arg: this.peek });
        return this.next();
      }

      // Not a symbol (punctuation or fence, maybe?)...

      return this.matchUnknownLatexCommand();
    }

    //
    // Is it a LaTeX command, e.g. `\frac{}{}`?
    //
    const requiredArgs: Expression<T>[] = [];
    const optionalArgs: Expression<T>[] = [];
    let arg: Expression<T> | null;
    let i = def.optionalLatexArg ?? 0;
    while (i > 0) {
      arg = this.matchOptionalLatexArgument();
      if (arg !== null) optionalArgs.push(arg);
      i--;
    }
    i = def.requiredLatexArg ?? 0;
    while (i > 0) {
      arg = this.matchRequiredLatexArgument();
      // `null` indicate that no required argument was found
      if (arg === null) this.onError({ code: 'expected-argument' });
      // `""` indicate an empty argument, i.e. `{}` was found
      if (arg !== null) requiredArgs.push(arg);
      i--;
    }

    const args = this.matchArguments(def.arguments);
    if (args === null) {
      // Didn't get arguments
      if (requiredArgs.length === 0 && optionalArgs.length === 0) {
        return def.parse as string;
      }
      return [def.parse as string, ...requiredArgs, ...optionalArgs];
    }

    return [def.parse as string, ...requiredArgs, ...args, ...optionalArgs];
  }

  matchOptionalLatexArgument(): Expression<T> | null {
    this.skipSpace();
    return this.matchBalancedExpression('[', ']');
  }

  /**
   * Match a required latex argument:
   * - either enclosed in `{}`
   * - or a single token.
   *
   * Return null if an argument was not found
   * Return '' if an empty argument `{}` was found
   */
  matchRequiredLatexArgument(): Expression<T> | null {
    this.skipSpace();
    const expr = this.matchBalancedExpression('<{>', '<}>');
    if (expr) return expr;

    // Is it a single digit?
    if (/^[0-9]$/.test(this.peek)) {
      // ... only match the digit, i.e. `x^23` is `x^{2}3`, not x^{23}
      return parseFloat(this.next()) as T;
    }
    // Is it a single letter (but not a special letter)?
    if (/^[^\\#]$/.test(this.peek)) {
      return this.next();
    }
    // Otherwise, this can only be a symbol.
    // `frac{1}2+1` is not valid, neither is `\frac\frac123`
    return this.matchSymbol();
  }

  /**
   *  Match a superfix/subfix operator, e.g. `^{*}`
   */
  matchSupsub(lhs: Expression<T> | null): Expression<T> | null {
    if (lhs === null) return null;
    let result: Expression<T> | null = null;
    this.skipSpace();
    (
      [
        ['^', 'superfix'],
        ['_', 'subfix'],
      ] as [string, 'superfix' | 'subfix'][]
    ).forEach((x) => {
      if (result !== null) return;

      const [triggerChar, opKind] = x;

      const beforeTrigger = this.index;

      if (!this.match(triggerChar)) return;

      const savedIndex = this.index;

      let def: LatexDictionaryEntry<T> | null | undefined;
      let n = 0;
      if (this.match('<{>')) {
        // Supsub with an argument
        [def, n] = this.peekDefinition(opKind);
        if (def) {
          //
          // It's a supfix/subfix operator (
          //  i.e. `^{*}` for `superstar`
          //
          if (typeof def.parse === 'function') {
            result = (def.parse as ParserFunction<T>)(lhs, this, 0)[1];
          } else {
            this.index += n;
            if (this.match('<}>')) {
              result = [(def.parse as string) ?? def.name, lhs!];
            } else {
              // Not a supfix/subfix
              // For example, "^{-1}", start with `"-"` from `superminus`,
              // but the "1" after it makes it not match
              this.index = savedIndex;
            }
          }
        } else {
          this.index = savedIndex;
        }
      } else {
        //
        // Single token argument for a sup/subfix
        //
        [def, n] = this.peekDefinition(opKind);
        if (def) {
          if (typeof def.parse === 'function') {
            result = (def.parse as ParserFunction<T>)(lhs, this, 0)[1];
          } else {
            this.index += n;
            result = [(def.parse as string) ?? def.name, lhs!];
          }
        } else {
          this.index = savedIndex;
        }
      }

      if (result === null) {
        def = this.dictionary.infix[1]?.get(triggerChar);
        if (typeof def?.parse === 'function') {
          this.index = beforeTrigger;
          result = (def.parse as ParserFunction<T>)(lhs, this, 0)[1];
        } else if (typeof def?.parse === 'string') {
          [lhs, result] = this.applyOperator(
            def.parse,
            lhs,
            this.matchRequiredLatexArgument()
          );
          result = this.applyInvisibleOperator(lhs, result);
        } else {
          result = this.applyInvisibleOperator(lhs, triggerChar);
        }
      }
      if (result !== null) {
        // There could be some arguments following the supsub, e.g.
        // `f^{-1}(x)`
        const args = this.matchArguments(def?.arguments);
        if (args !== null) result = [result, ...args];
      }
    });
    return result;
  }

  matchPostfix(lhs: Expression<T> | null): Expression<T> | null {
    if (lhs === null) return null;

    const [def, n] = this.peekDefinition('postfix');
    if (def === null || def === undefined) return null;

    if (typeof def.parse === 'function') {
      [, lhs] = (def.parse as ParserFunction<T>)(lhs, this, 0);
      if (lhs === null) return null;

      return lhs;
    }

    this.index += n;
    return [def.parse!, lhs];
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
          this.onError({ code: 'unexpected-command' });
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
    const result: null | Expression<T> = ['list'];

    let row: Expression<T>[] = ['list'];
    let expr: Expression<T> | null = null;
    let done = false;
    while (!this.atEnd && !done) {
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
        row = ['list'];
        expr = null;
      } else {
        const rhs = this.matchExpression();
        if (rhs === null) done = true;
        if (expr !== null) {
          expr = this.applyInvisibleOperator(expr, rhs);
        } else {
          expr = rhs;
        }
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

          const def = this.dictionary.environment.get(name);
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
   * Apply the operator `op` to the left-hand-side and right-hand-side
   * expression. Applies the associativity rule specified by the definition,
   * i.e. 'op(a, op(b, c))` -> `op(a, b, c)`, etc...
   *
   * `op` is the name of the operator which should have a corresponding
   * definition.
   *
   * If `op` is an infix operator, it should have both a lhs and rhs.
   * If `op` is a postfix operator, it should only have a lhs.
   * If `op` is a prefix operator, the lhs is returned as the first element
   * of the return tuple.
   *
   * @return a tuple: [lhs, rhs]
   */
  applyOperator(
    op: string,
    lhs: Expression<T> | null,
    rhs: Expression<T> | null
  ): NonNullable<[Expression<T> | null, Expression<T> | null]> {
    const def = this.dictionary.name.get(op);

    if (def === undefined) {
      this.onError({ code: 'unknown-operator' });
      return [lhs, rhs];
    }

    if (def.trigger?.prefix !== undefined && lhs === null && rhs !== null) {
      return [null, [def.name, rhs]];
    }
    if (def.trigger?.postfix !== undefined && lhs !== null) {
      return [null, [def.name, lhs]];
    }

    if (
      def.trigger?.matchfix !== undefined ||
      def.trigger?.infix !== undefined
    ) {
      // infix
      if (def.associativity === 'non') {
        return [null, [op, lhs ?? 'Missing', rhs ?? 'Missing']];
      }
      if (getFunctionName(lhs) === op) {
        // Possible associativity
        if (def.associativity === 'both') {
          if (getFunctionName(rhs) === op) {
            // +(+(a, b), +(c, d)) -> +(a, b, c, d)
            if (Array.isArray(lhs)) {
              return [null, lhs.concat(getTail(rhs))];
            }
            if (isFunctionObject(lhs)) {
              return [null, lhs.fn.concat(getTail(rhs))];
            }
          } else if (rhs) {
            if (Array.isArray(lhs)) {
              lhs.push(rhs);
            }
            if (isFunctionObject(lhs)) {
              lhs.fn.push(rhs);
            }
          }
          return [null, lhs];
        }
        if (def.associativity === 'left') {
          return [null, [op, lhs ?? MISSING, rhs ?? MISSING]];
        }
        // Right-associative
        if (Array.isArray(lhs)) {
          return [null, [op, lhs[1], [op, lhs[2], rhs ?? MISSING]]];
        }
        if (isFunctionObject(lhs)) {
          lhs.fn[2] = [op, lhs.fn[2], rhs ?? MISSING];
        }
        return [null, lhs];
      } else if (getFunctionName(rhs) === op) {
        // Possible associativity
        if (def.associativity === 'both') {
          if (Array.isArray(rhs) && lhs) {
            rhs.splice(1, 0, lhs);
          }
          if (isFunctionObject(rhs) && lhs) {
            rhs.fn.splice(1, 0, lhs);
          }
          return [null, rhs];
        }
        if (def.associativity === 'right') {
          return [null, [op, lhs ?? MISSING, rhs ?? MISSING]];
        }
        // Left-associative
        if (Array.isArray(rhs)) {
          return [null, [op, rhs[1], [op, rhs[2], lhs ?? MISSING]]];
        }
        if (isFunctionObject(rhs)) {
          rhs.fn[2] = [op, rhs.fn[2], lhs ?? MISSING];
        }
        return [null, rhs];
      }
      return [null, [op, lhs ?? 'Missing', rhs ?? 'Missing']];
    }

    return [lhs, null];
  }

  /**
   * Apply an invisible operator between two expressions.
   *
   * If no `invisibleOperator` was specified, use the `latex` operator.
   *
   * If the lhs is a number and the rhs is a fraction of integers,
   * assume an 'invisible plus', that is '2 3/4' -> ['add', 2, [divide, 3, 4]]
   * unless `invisiblePlusOperator` is empty
   *
   */
  applyInvisibleOperator(
    lhs: Expression<T> | null,
    rhs: Expression<T> | null
  ): Expression<T> | null {
    if (lhs === null) return rhs;
    if (rhs === null) return lhs;
    // @todo: handle invisible plus
    if (this.options.invisiblePlusOperator) {
      if (
        (typeof lhs === 'number' || isNumberObject(lhs)) &&
        isRationalNumber(rhs)
      ) {
        [lhs, rhs] = this.applyOperator(
          this.options.invisiblePlusOperator,
          lhs,
          rhs
        );
        if (lhs === null) return rhs;
        return null;
      }
    }
    if (this.options.invisibleOperator) {
      [lhs, rhs] = this.applyOperator(this.options.invisibleOperator, lhs, rhs);
      if (lhs === null) return rhs;
      return null;
    }
    // No invisible operator, use 'LatexTokens'
    let fn: Expression<T> = [LATEX_TOKENS];
    if (getFunctionName(lhs) === LATEX_TOKENS) {
      fn = fn.concat(getTail(lhs));
    } else {
      fn.push(lhs);
    }
    if (rhs !== null) {
      if (getFunctionName(rhs) === LATEX_TOKENS) {
        fn = fn.concat(getTail(rhs));
      } else {
        fn.push(rhs);
      }
    }
    if (this.options.invisibleOperator) {
      this.onError({ code: 'unexpected-sequence' });
    }
    return fn;
  }

  matchUnknownLatexCommand(): Expression<T> | null {
    const command = this.peek;
    if (!command || command[0] !== '\\') {
      return null;
    }

    this.next();

    if (command === '\\operatorname') {
      this.skipSpace();
      if (this.peek === '<{>') {
        let result = '';
        this.next();
        while (!this.atEnd && this.tokens[this.index] !== '<}>') {
          result += this.next();
        }
        return result;
      }
      return this.next() ?? MISSING;
    }

    const optArgs: Expression<T>[] = [];
    const reqArgs: Expression<T>[] = [];

    let done = false;
    do {
      done = true;
      let expr = this.matchOptionalLatexArgument();
      if (expr !== null) {
        optArgs.push(expr);
        done = false;
      }
      this.skipSpace();
      if (this.peek === '<{>') {
        expr = this.matchRequiredLatexArgument();
        if (expr !== null) {
          reqArgs.push(expr);
          done = false;
        }
      }
    } while (!done);

    if (optArgs.length > 0 || reqArgs.length > 0) {
      return [command, ...reqArgs, ...optArgs];
    }
    return command;
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
    // 5. Are there subsup or postfix operators?
    //
    let supsub: Expression<T> | null = null;
    do {
      supsub = this.matchSupsub(result);
      result = supsub ?? result;
    } while (supsub !== null);

    let postfix: Expression<T> | null = null;
    do {
      postfix = this.matchPostfix(result);
      result = postfix ?? result;
    } while (postfix !== null);

    return this.decorate(result, originalIndex);
  }

  matchBalancedExpression(
    open: LatexToken | LatexToken[],
    close: LatexToken | LatexToken[],
    onError?: ErrorListener<ErrorCode>
  ): Expression<T> | null {
    const scanner = this.balancedClone(open, close);
    if (!scanner) {
      // eslint-disable-next-line no-unused-expressions
      onError?.({
        code: 'unbalanced-symbols',
        arg: tokensToString(open) + tokensToString(close),
      });
      return null;
    }
    const result = scanner.matchExpression();
    if (!scanner.atEnd) {
      // eslint-disable-next-line no-unused-expressions
      onError?.({
        code: 'unbalanced-symbols',
        arg: tokensToString(open) + tokensToString(close),
      });
    }
    return result;
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
    let lhs: Expression<T> | null = null;
    const originalIndex = this.index;

    this.skipSpace();

    //
    // 1. Do we have a primary?
    // (we check first to capture "-1" as a negative number, and not as a prefix
    // operator applied to a number).
    //
    lhs = this.matchPrimary(minPrec);

    //
    // 2. Do we have a prefix operator?
    //
    if (lhs === null) lhs = this.matchOperator('prefix');

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
        const [op] = this.peekDefinition('operator');
        if (op === null) {
          const rhs = this.matchExpression(this.invisibleOperatorPrecedence);
          if (rhs !== null) {
            result = this.applyInvisibleOperator(lhs, rhs);
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
