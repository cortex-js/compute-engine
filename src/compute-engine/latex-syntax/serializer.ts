import type { Expression } from '../../math-json/math-json-format';
import {
  op,
  nops,
  dictionary,
  stringValue,
  head,
  headName,
  symbol,
  isFunctionObject,
  isNumberObject,
  isSymbolObject,
  ops,
  isNumberExpression,
  ONLY_EMOJIS,
} from '../../math-json/utils';

import { WarningSignalHandler } from '../../common/signals';

import {
  NumberFormattingOptions,
  LatexString,
  SerializeLatexOptions,
  FunctionEntry,
} from './public';

import {
  IndexedLatexDictionary,
  InfixEntry,
  PostfixEntry,
  PrefixEntry,
  SymbolEntry,
} from './dictionary/definitions';

import { countTokens, joinLatex } from './tokenizer';
import { serializeNumber } from './serialize-number';
import { SYMBOLS } from './dictionary/definitions-symbols';

const ACCENT_MODIFIERS = {
  deg: (s: string) => `${s}\\degree`,
  prime: (s: string) => `${s}^{\\prime}`,
  dprime: (s: string) => `${s}^{\\doubleprime}`,
  ring: (s: string) => `\\mathring{${s}}`,
  hat: (s: string) => `\\hat{${s}}`,
  tilde: (s: string) => `\\tilde{${s}}`,
  vec: (s: string) => `\\vec{${s}}`,
  bar: (s: string) => `\\overline{${s}}`,
  underbar: (s: string) => `\\underline{${s}}`,
  dot: (s: string) => `\\dot{${s}}`,
  ddot: (s: string) => `\\ddot{${s}}`,
  tdot: (s: string) => `\\dddot{${s}}`,
  qdot: (s: string) => `\\ddddot{${s}}`,

  // Supplemental
  acute: (s: string) => `\\acute{${s}}`,
  grave: (s: string) => `\\grave{${s}}`,
  breve: (s: string) => `\\breve{${s}}`,
  check: (s: string) => `\\check{${s}}`,
};

const STYLE_MODIFIERS = {
  upright: (s) => `\\mathrm{${s}}`,
  italic: (s) => `\\mathit{${s}}`,
  bold: (s) => `\\mathbf{${s}}`,
  script: (s) => `\\mathscr{${s}}`,
  fraktur: (s) => `\\mathfrak{${s}}`, // Note Unicode uses 'fraktur' for 'gothic'
  doublestruck: (s) => `\\mathbb{${s}}`, // Unicode uses 'double-struck' for 'blackboard'

  // Supplemental
  blackboard: (s) => `\\mathbb{${s}}`,
  // boldItalic: (s) => `\\mathbf{\\mathit{${s}}}`,
  calligraphic: (s) => `\\mathcal{${s}}`,
  // scriptBold: (s) => `\\mathbf{\\mathscr{${s}}}`,
  // calligraphicBold: (s) => `\\mathbf{\\mathcal{${s}}}`,
  gothic: (s) => `\\mathfrak{${s}}`,
  // gothicBold: (s) => `\\mathbf{\\mathfrak{${s}}}`,
  // frakturBold: (s) => `\\mathbf{\\mathfrak{${s}}}`,
  sansSerif: (s) => `\\mathsf{${s}}`,
  // sansSerifBold: (s) => `\\mathbf{\\mathsf{${s}}}`,
  // sansSerifItalic: (s) => `\\mathit{\\mathsf{${s}}}`,
  monospace: (s) => `\\mathtt{${s}}`,
};

// function serializeMatchfix(
//   serializer: Serializer,
//   expr: Expression,
//   def: MatchfixEntry
// ): string {
//   return replaceLatex(def.serialize as string, [
//     serializer.serialize(op(expr, 1) ?? ['Sequence']),
//   ]);
// }

function serializeOperator(
  serializer: Serializer,
  expr: Expression,
  def: InfixEntry | PrefixEntry | PostfixEntry
): string {
  let result = '';
  const count = nops(expr);
  const name = headName(expr);
  if (def.kind === 'postfix') {
    if (count !== 1) {
      serializer.onError([
        {
          severity: 'warning',
          message: [
            'postfix-operator-requires-one-operand',
            serializer.serializeSymbol(name),
          ],
        },
      ]);
    }
    return replaceLatex(def.serialize as string, [
      serializer.wrap(op(expr, 1), def.precedence),
    ]);
  }
  if (def.kind === 'prefix') {
    if (count !== 1) {
      serializer.onError([
        {
          severity: 'warning',
          message: [
            'prefix-operator-requires-one-operand',
            serializer.serializeSymbol(name),
          ],
        },
      ]);
    }
    return replaceLatex(def.serialize as string, [
      serializer.wrap(op(expr, 1), def.precedence! + 1),
    ]);
  }
  if (def.kind === 'infix') {
    result = serializer.wrap(op(expr, 1), def.precedence);
    for (let i = 2; i < count + 1; i++) {
      const arg = op(expr, i);
      if (arg !== null) {
        result = replaceLatex(def.serialize as string, [
          result,
          serializer.wrap(arg, def.precedence),
        ]);
      }
    }
  }
  return result;
}

export class Serializer {
  readonly onError: WarningSignalHandler;
  options: NumberFormattingOptions & SerializeLatexOptions;
  readonly dictionary: IndexedLatexDictionary;
  level = -1;
  constructor(
    options: NumberFormattingOptions & SerializeLatexOptions,
    dictionary: IndexedLatexDictionary,
    onError: WarningSignalHandler
  ) {
    this.options = options;
    if (options.invisibleMultiply) {
      if (
        !/#1/.test(options.invisibleMultiply) ||
        !/#2/.test(options.invisibleMultiply)
      ) {
        onError([
          {
            severity: 'warning',
            message: ['expected-argument', 'invisibleMultiply'],
          },
        ]);
      }
    }
    this.onError = onError;
    this.dictionary = dictionary;
  }

  updateOptions(
    opt: Partial<NumberFormattingOptions> & Partial<SerializeLatexOptions>
  ) {
    for (const k of Object.keys(this.options))
      if (k in opt) this.options[k] = opt[k];
  }

  /**
   * Serialize the expression, and if the expression is an operator
   * of precedence less than or equal to prec, wrap it in some paren.
   * @todo: don't wrap Abs, Floor, Ceil, Delimiter
   */
  wrap(expr: Expression | null, prec?: number): string {
    if (expr === null) return '';
    if (prec === undefined) {
      return this.wrapString(
        this.serialize(expr),
        this.options.groupStyle(expr, this.level + 1)
      );
    }
    if (
      typeof expr === 'number' ||
      isNumberObject(expr) ||
      typeof expr === 'string' ||
      isSymbolObject(expr)
    ) {
      return this.serialize(expr);
    }
    const name = head(expr);
    if (
      typeof name === 'string' &&
      name !== 'Delimiter' &&
      name !== 'Subscript'
    ) {
      const def = this.dictionary.name.get(name);
      if (
        def &&
        (def.kind === 'symbol' ||
          def.kind === 'prefix' ||
          def.kind === 'infix' ||
          def.kind === 'postfix') &&
        def.precedence < prec
      )
        return this.wrapString(
          this.serialize(expr),
          this.options.applyFunctionStyle(expr, this.level)
        );
    }
    return this.serialize(expr);
  }

  /** If this is a "short" expression (atomic), wrap it.
   *
   */
  wrapShort(expr: Expression | null): string {
    if (expr === null) return '';
    const exprStr = this.serialize(expr);

    if (head(expr) === 'Delimiter' && nops(expr) === 1) return exprStr;

    if (!isNumberExpression(expr) && !/(^(.|\\[a-zA-Z*]+))$/.test(exprStr)) {
      // It's a long expression, wrap it
      return this.wrapString(
        exprStr,
        this.options.groupStyle(expr, this.level + 1)
      );
    }

    return exprStr;
  }

  wrapString(
    s: string,
    style: 'paren' | 'leftright' | 'big' | 'none',
    fence?: string
  ): string {
    if (style === 'none') return s;
    const openFence = fence?.[0] ?? '(';
    const closeFence = fence?.[1] ?? ')';

    if ((openFence === '.' || closeFence === '.') && style === 'paren')
      style = 'leftright';

    if (style === 'leftright')
      return `${openFence === '.' ? '' : `\\left(${openFence}`}${s}${
        closeFence === '.' ? '' : `\\right(${closeFence}`
      })`;
    if (style === 'big')
      return `${openFence === '.' ? '' : `\\Bigl(${openFence}`}${s}${
        closeFence === '.' ? '' : `\\Bigr(${closeFence}`
      })`;

    return openFence + s + closeFence;
  }

  wrapArguments(expr: Expression): string {
    return this.wrapString(
      (ops(expr) ?? []).map((x) => this.serialize(x)).join(', '),
      this.options.applyFunctionStyle(expr, this.level)
    );
  }

  serializeSymbol(expr: Expression, def?: SymbolEntry | FunctionEntry): string {
    const h = head(expr);
    if (h) return this.serializeFunction(expr, def);

    console.assert(typeof expr === 'string' || isSymbolObject(expr));
    // It's a symbol
    if (typeof def?.serialize === 'string') return def.serialize;
    else if (typeof def?.serialize === 'function')
      return def.serialize(this, expr);

    return serializeIdentifier(symbol(expr)) ?? '';
  }

  serializeFunction(
    expr: Expression,
    def?: FunctionEntry | SymbolEntry
  ): string {
    const h = head(expr);
    if (!h) return this.serializeSymbol(expr, def);

    const args = ops(expr) ?? [];

    if (def) {
      //
      // 1. Is it a known function?
      //
      if (typeof def.serialize === 'function') return def.serialize(this, expr);

      return joinLatex([
        def.serialize ?? (h as string),
        this.wrapArguments(expr),
      ]);
    }

    // We don't know anything about this function
    if (typeof h === 'string' && h.length > 0 && h[0] === '\\') {
      //
      // 2. Is it an unknown LaTeX command?
      //
      // This looks like a LaTeX command. Serialize the arguments as LaTeX arguments

      return joinLatex([h, ...args.map((x) => `{${this.serialize(x)}}`)]);
    }

    //
    // 2. Is it an unknown function call?
    //
    // It's a function we don't know.
    // Maybe it came from `promoteUnknownToken`
    // Serialize the arguments as function arguments
    if (typeof h === 'string')
      return serializeIdentifier(h, 'upright') + this.wrapArguments(expr);

    const style = this.options.applyFunctionStyle(expr, this.level);
    return (
      '\\mathrm{Apply}' +
      this.wrapString(
        this.serialize(h) + ', ' + this.serialize(['List', ...args]),
        style
      )
    );
  }

  serializeDictionary(dict: { [key: string]: Expression }): string {
    return `\\left\\lbrack\\begin{array}{lll}${Object.keys(dict)
      .map((x) => {
        return `\\textbf{${x}} & \\rightarrow & ${this.serialize(dict[x])}`;
      })
      .join('\\\\')}\\end{array}\\right\\rbrack`;
  }

  serialize(expr: Expression | null): LatexString {
    if (expr === null || expr === undefined) return '';

    this.level += 1;
    try {
      const result = (() => {
        //
        // 1. Is it a number
        //
        const numericValue = serializeNumber(expr, this.options);
        if (numericValue) return numericValue;

        //
        // 2. Is it a string?
        //
        const s = stringValue(expr);
        if (s !== null) return `\\text{${s}}`;

        //
        // 3. Is it a symbol?
        //
        const symbolName = symbol(expr);
        if (symbolName !== null) {
          const def = this.dictionary.name.get(symbolName);
          if (def?.kind === 'symbol') return this.serializeSymbol(expr, def);
          if (def?.kind === 'function')
            return this.serializeFunction(expr, def);
        }

        //
        // 4. Is it a dictionary?
        //
        const dict = dictionary(expr);
        if (dict !== null) return this.serializeDictionary(dict);

        //
        // 5. Is it a named function?
        //
        const fnName = headName(expr);
        if (fnName) {
          if (fnName[0] === '\\') {
            // 5.1 An unknown LaTeX command, possibly with arguments.
            // This can happen if we encountered an unrecognized LaTeX command
            // during parsing, e.g. "\foo{x + 1}"
            const args = ops(expr) ?? [];
            if (args.length === 0) return fnName;
            return (
              fnName +
              '{' +
              args
                .map((x) => this.serialize(x))
                .filter((x) => Boolean(x))
                .join('}{') +
              '}'
            );
          }
          //
          // 5.2 A function, operator or matchfix operator
          //
          const def = this.dictionary.name.get(fnName);
          if (def) {
            // If there is a custom serializer function, use it.
            // (note: 'matchfix' entries always have a default serializer)
            if (typeof def.serialize === 'function')
              return def.serialize(this, expr);

            if (
              def.kind === 'infix' ||
              def.kind === 'postfix' ||
              def.kind === 'prefix'
            )
              return serializeOperator(this, expr, def);

            if (def.kind === 'symbol') return this.serializeSymbol(expr, def);
            if (def.kind === 'function')
              return this.serializeFunction(expr, def);

            return '';
          }
        }

        if (
          Array.isArray(expr) ||
          isFunctionObject(expr) ||
          symbol(expr) !== null
        ) {
          // It's a function or a symbol, but without definition.
          // It could be a [['derive', "f"], x]
          // serializeSymbol() will take care of it.
          return this.serializeSymbol(expr);
        }

        // This doesn't look like a symbol, or a function,
        // or anything we were expecting.
        // This is an invalid expression, for example an
        // object literal with no known fields, or an invalid number:
        // `{num: 'not a number'}`
        // `{foo: 'not an expression}`

        this.onError([
          {
            severity: 'warning',
            message: [
              'syntax-error',
              expr ? JSON.stringify(expr) : 'undefined',
            ],
          },
        ]);
      })();
      this.level -= 1;
      return result ?? '';
    } catch (e) {}
    this.level -= 1;
    return '';
  }
  applyFunctionStyle(
    expr: Expression,
    level: number
  ): 'paren' | 'leftright' | 'big' | 'none' {
    return this.options.applyFunctionStyle(expr, level);
  }

  groupStyle(
    expr: Expression,
    level: number
  ): 'paren' | 'leftright' | 'big' | 'none' {
    return this.options.groupStyle(expr, level);
  }

  rootStyle(
    expr: Expression,
    level: number
  ): 'radical' | 'quotient' | 'solidus' {
    return this.options.rootStyle(expr, level);
  }

  fractionStyle(
    expr: Expression,
    level: number
  ): 'quotient' | 'inline-solidus' | 'nice-solidus' | 'reciprocal' | 'factor' {
    return this.options.fractionStyle(expr, level);
  }

  logicStyle(
    expr: Expression,
    level: number
  ): 'word' | 'boolean' | 'uppercase-word' | 'punctuation' {
    return this.options.logicStyle(expr, level);
  }

  powerStyle(expr: Expression, level: number): 'root' | 'solidus' | 'quotient' {
    return this.options.powerStyle(expr, level);
  }

  numericSetStyle(
    expr: Expression,
    level: number
  ): 'compact' | 'regular' | 'interval' | 'set-builder' {
    return this.options.numericSetStyle(expr, level);
  }
}

export function appendLatex(src: string, s: string): string {
  if (!s) return src;

  // If the source end in a LaTeX command,
  // and the appended string begins with a letter
  if (/\\[a-zA-Z]+\*?$/.test(src) && /[a-zA-Z*]/.test(s[0])) {
    // Add a space between them
    return src + ' ' + s;
  }
  // No space needed
  return src + s;
}

/**
 * Replace '#1', '#2' in the LaTeX template stings with the corresponding
 * values from `replacement`, in a LaTeX syntax safe manner (i.e. inserting spaces when needed)
 */
export function replaceLatex(template: string, replacement: string[]): string {
  console.assert(typeof template === 'string');
  console.assert(template.length > 0);
  let result = template;
  for (let i = 0; i < replacement.length; i++) {
    let s = replacement[i] ?? '';
    if (/[a-zA-Z*]/.test(s[0])) {
      const m = result.match(new RegExp('(.*)#' + Number(i + 1).toString()));
      if (m && /\\[a-zA-Z*]+/.test(m[1])) {
        s = ' ' + s;
      }
    }
    result = result.replace('#' + Number(i + 1).toString(), s);
  }

  return result;
}

function specialName(s: string): [result: string, rest: string] {
  // Does the name start with a greek letter or other special symbol?
  let i = SYMBOLS.findIndex((x) => s.startsWith(x[0]));
  if (i >= 0) return [SYMBOLS[i][1], s.substring(SYMBOLS[i][0].length)];

  // Does the name start with a digit, spelled out?
  const DIGITS = {
    ZERO: '0',
    ONE: '1',
    TWO: '2',
    THREE: '3',
    FOUR: '4',
    FIVE: '5',
    SIX: '6',
    SEVEN: '7',
    EIGHT: '8',
    NINE: '9',
    TEN: '10',
  };
  i = Object.keys(DIGITS).findIndex((x) => s.startsWith(x));
  if (i >= 0) {
    const key = Object.keys(DIGITS)[i];
    return [DIGITS[key], s.substring(key.length)];
  }

  // Does the name start with a Unicode symbol?
  const code = s.codePointAt(0);
  i = SYMBOLS.findIndex((x) => x[2] === code);
  if (i >= 0) return [SYMBOLS[i][1], s.substring(1)];

  const EXTRA_SYMBOLS = {
    plus: '+',
    minus: '-',
    pm: '\\pm',
    ast: '\\ast',
    dag: '\\dag',
    ddag: '\\ddag',
    hash: '\\#',
    bottom: '\\bot',
    top: '\\top',
    bullet: '\\bullet',
    circle: '\\circ',
    diamond: '\\diamond',
    times: '\\times',
    square: '\\square',
    star: '\\star',
  };
  i = Object.keys(EXTRA_SYMBOLS).findIndex((x) => s.startsWith(x));
  if (i >= 0) {
    // Access the ith key of the object
    const key = Object.keys(EXTRA_SYMBOLS)[i];
    return [EXTRA_SYMBOLS[key], s.substring(key.length)];
  }

  return ['', s];
}

// Convert special names in the string until there are no more
// special names to convert, for example if we run into a '_' or a digit.
function specialNames(s: string): [result: string, rest: string] {
  const result: string[] = [];
  let rest = s;

  while (rest.length > 0 && !rest.startsWith('_')) {
    const [special, rest2] = specialName(rest);
    if (special === '') {
      result.push(rest[0]);
      rest = rest.substring(1);
    } else {
      result.push(special);
      rest = rest2;
    }
  }

  return [joinLatex(result), rest];
}

function parseModifiers(
  s: string
): [body: string, accents: string[], styles: string[], rest: string] {
  // Get the special names
  // eslint-disable-next-line prefer-const
  let [body, rest] = specialNames(s);

  // Check for accent modifiers
  const accent: string[] = [];
  while (rest.length > 0) {
    const m = rest.match(/^_([a-zA-Z]+)(.*)/);
    if (!m) break;
    if (!ACCENT_MODIFIERS[m[1]]) break;
    accent.push(m[1]);
    rest = m[2];
  }

  const styles: string[] = [];
  while (rest.length > 0) {
    const m = rest.match(/^_([a-zA-Z]+)(.*)/);
    if (!m) break;
    if (!STYLE_MODIFIERS[m[1]]) break;
    styles.push(m[1]);
    rest = m[2];
  }

  return [body, accent, styles, rest];
}

function parseIdentifierBody(
  s: string,
  topLevel = true,
  style: 'operator' | 'italic' | 'upright' | 'auto' | 'none' = 'auto'
): [result: string, rest: string] {
  // eslint-disable-next-line prefer-const
  let [body, accents, styles, rest] = parseModifiers(s);

  // Apply accents
  for (const accent of accents) {
    if (ACCENT_MODIFIERS[accent]) body = ACCENT_MODIFIERS[accent](body);
  }

  // Only the top level can have superscripts and subscripts
  if (topLevel) {
    const sups: string[] = [];
    const subs: string[] = [];

    // Check if we have a string of digits at the end of the body
    const m = body.match(/^([^\d].*?)(\d+)$/);
    if (m) {
      subs.push(m[2]);
      body = m[1];
    }

    while (rest.length > 0) {
      if (rest.startsWith('__')) {
        const [sup, rest2] = parseIdentifierBody(
          rest.substring(2),
          false,
          'none'
        );
        sups.push(sup);
        rest = rest2;
      } else if (rest.startsWith('_')) {
        const [sub, rest2] = parseIdentifierBody(
          rest.substring(1),
          false,
          'none'
        );
        subs.push(sub);
        rest = rest2;
      } else {
        break;
      }
    }

    // Apply the superscripts and subscripts
    if (sups.length > 0) body = `${body}^{${sups.join(',')}}`;
    if (subs.length > 0) body = `${body}_{${subs.join(',')}}`;
  }

  for (const style of styles) {
    if (STYLE_MODIFIERS[style]) body = STYLE_MODIFIERS[style](body);
  }

  if (styles.length === 0 && style !== 'none') {
    switch (style) {
      case 'auto':
        if (countTokens(body) > 1) body = `\\mathrm{${body}}`;
        break;
      case 'operator':
        body = `\\operatorname{${body}}`;
        break;
      case 'italic':
        body = `\\mathit{${body}}`;
        break;
      case 'upright':
        body = `\\mathrm{${body}}`;
        break;
    }
  }
  return [body, rest];
}

// If the name contains an underscore, e.g.'mu_0', make sure
// to add braces.
//
// If s has a numeric prefix, put it in subscript.
//
// Other special symbols:
// 'x_012' --> `x_{012}`
// 'x012' --> `x_{012}`
// 'x_"max"' --> `x_\mathrm{max}`
// '_' --> `\mathrm{\_}`
// '_a' --> `\mathrm{\_a}`
// '___a' --> `\mathrm{\_\_\_a}`
// 'alpha0' --> `mathit{\alpha_{0}}`
// 'alpha__beta' --> `mathrm{\alpha^{\beta}}`
// 'alpha_beta' --> `mathrm{\alpha_{beta}}`
// 'speed-of-sound' --> `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
// 'not[this]' --> `\mathit{\lbrace this\rbrace}`

/**
 * The `defaultMulticharStyle` indicate which style should be used to
 * wrap the symbol if it has more than one character and doesn't have a style
 * specified. This is used to display function names upright, and other
 * (single-char) symbols italic. If the style is '', the symbols is wrapped
 * in `\mathrm{...}` if it has more than one character and no other style
 * is specified.
 */
function serializeIdentifier(
  s: string | null,
  defaultMulticharStyle:
    | 'operator'
    | 'italic'
    | 'upright'
    | 'none'
    | 'auto' = 'auto'
): string | null {
  if (s === null) return null;

  // If the identifier contains emojis, skip the wrapping
  if (ONLY_EMOJIS.test(s)) return s;

  // If the identifier starts with one or more underscore,
  // it's a wildcard symbol and always wrapped with \mathrm{...}.
  const m = s.match(/^(_+)(.*)/);
  if (m) {
    const [body, rest] = parseIdentifierBody(m[2], true, 'none');
    return `\\mathrm{${'\\_'.repeat(m[1].length) + body + rest}}`;
  }

  const [body, rest] = parseIdentifierBody(s, true, defaultMulticharStyle);

  // We couldn't parse the identifier, so just wrap it in \mathrm{...}
  if (rest.length > 0) return `\\mathrm{${s}}`;

  return body;
}
