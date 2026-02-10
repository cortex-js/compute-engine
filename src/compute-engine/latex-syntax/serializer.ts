import type { MathJsonExpression } from '../../math-json/types';
import {
  nops,
  stringValue,
  operator,
  symbol,
  isNumberObject,
  isSymbolObject,
  operands,
  isNumberExpression,
  machineValue,
} from '../../math-json/utils';

import {
  LatexString,
  SerializeLatexOptions,
  DelimiterScale,
  ADDITION_PRECEDENCE,
} from './types';

import type {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
} from './dictionary/definitions';

import { countTokens, supsub } from './tokenizer';
import { serializeNumber } from './serialize-number';
import { SYMBOLS } from './dictionary/definitions-symbols';
import { DELIMITERS_SHORTHAND } from './dictionary/definitions-core';
import { EMOJIS } from '../../math-json/symbols';

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
  calligraphic: (s) => `\\mathcal{${s}}`,
  gothic: (s) => `\\mathfrak{${s}}`,
  sansserif: (s) => `\\mathsf{${s}}`,
  monospace: (s) => `\\mathtt{${s}}`,
};

export class Serializer {
  options: Readonly<SerializeLatexOptions>;
  readonly dictionary: IndexedLatexDictionary;
  level = -1;
  constructor(
    dictionary: IndexedLatexDictionary,
    options: SerializeLatexOptions
  ) {
    this.dictionary = dictionary;
    this.options = options;
  }

  /**
   * Serialize the expression, and if the expression is an operator
   * of precedence less than or equal to prec, wrap it in some parens.
   * @todo: don't wrap Abs, Floor, Ceil, Delimiter
   */
  wrap(expr: MathJsonExpression | null | undefined, prec?: number): string {
    if (expr === null || expr === undefined) return '';
    if (prec === undefined) {
      return this.wrapString(
        this.serialize(expr),
        this.options.groupStyle(expr, this.level + 1)
      );
    }

    if (typeof expr === 'number' || isNumberObject(expr)) {
      const val = machineValue(expr);
      if (val !== null && val < 0 && prec > ADDITION_PRECEDENCE)
        return this.wrap(expr);
      return this.serialize(expr);
    }
    const name = operator(expr);
    if (name && name !== 'Delimiter' && name !== 'Subscript') {
      const def = this.dictionary.ids.get(name);
      if (
        def &&
        (def.kind === 'symbol' ||
          def.kind === 'expression' ||
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

  /**
   * If this is a "short" expression, wrap it.
   * Do not wrap symbols, positive numbers or functions.
   *
   * This is called by the serializer for power and division (i.e. "(a+1)/b")
   *
   */
  wrapShort(expr: MathJsonExpression | null | undefined): string {
    if (expr === null || expr === undefined) return '';
    const exprStr = this.serialize(expr);

    if (symbol(expr) !== null) return exprStr;

    const isNum = isNumberExpression(expr);
    // It's not a negative number, or a decimal number
    if (isNum && !/^(-|\.)/.test(exprStr)) return exprStr;

    // If the default Delimiter (i.e. using parens), don't wrap
    const h = operator(expr);
    if (h === 'Delimiter' && nops(expr) === 1) return exprStr;
    if (
      h !== 'Add' &&
      h !== 'Negate' &&
      h !== 'Subtract' &&
      h !== 'PlusMinus' &&
      h !== 'Multiply'
    )
      return exprStr;

    // Wrap the expression with delimiters
    return this.wrapString(
      exprStr,
      this.options.groupStyle(expr, this.level + 1)
    );
  }

  wrapString(s: string, style: DelimiterScale, fence?: string): string {
    if (style === 'none') return s;
    fence ??= '()';
    let openFence = fence?.[0] ?? '.';
    let closeFence = fence?.[1] ?? '.';

    // Map Unicode characters to LaTeX commands
    if (openFence === '"') openFence = '``';
    else if (openFence === '|') openFence = '\\lvert';
    else openFence = DELIMITERS_SHORTHAND[openFence] ?? openFence;

    if (closeFence === '"') closeFence = "''";
    else if (closeFence === '|') closeFence = '\\rvert';
    else closeFence = DELIMITERS_SHORTHAND[closeFence] ?? closeFence;

    if (openFence === '.' && closeFence === '.') return s;

    if ((openFence === '.' || closeFence === '.') && style === 'normal')
      style = 'scaled';

    if (style === 'scaled')
      return `\\left${openFence}${s}\\right${closeFence}}`;

    if (style === 'big')
      return `${`\\Bigl${openFence}`}${s}${`\\Bigr${closeFence}`})`;

    return openFence + s + closeFence;
  }

  wrapArguments(expr: MathJsonExpression): string {
    return this.wrapString(
      operands(expr)
        .map((x) => this.serialize(x))
        .join(', '),
      this.options.applyFunctionStyle(expr, this.level)
    );
  }

  serializeSymbol(
    expr: MathJsonExpression,
    def?: IndexedLatexDictionaryEntry
  ): LatexString {
    console.assert(typeof expr === 'string' || isSymbolObject(expr));
    if (def?.kind === 'function') {
      // It's a function, but it doesn't have arguments.
      // For example `"Cos"`.
      // Print the trigger as an symbol
      return serializeSymbol(symbol(expr) ?? '') ?? '';
    }
    return def?.serialize?.(this, expr) ?? serializeSymbol(symbol(expr)) ?? '';
  }

  serializeFunction(
    expr: MathJsonExpression,
    def?: IndexedLatexDictionaryEntry
  ): LatexString {
    //
    // Use serialize handler if available
    //
    if (def?.serialize) return def.serialize(this, expr);

    // It's a function without a serializer.
    // It may have come from `getSymbolType()`
    // Serialize the arguments as function arguments
    const h = operator(expr);
    return serializeSymbol(h, 'auto') + this.wrapArguments(expr);
  }

  serialize(expr: MathJsonExpression | null | undefined): LatexString {
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
          return this.serializeSymbol(
            expr,
            this.dictionary.ids.get(symbolName)
          );
        }

        //
        // 4. Is it a function?
        //
        const fnName = operator(expr);
        if (fnName) {
          const def = this.dictionary.ids.get(fnName);
          return this.serializeFunction(expr, def);
        }

        //
        // 5. Unknown expression
        //
        // This doesn't look like a symbol, or a function,
        // or anything we were expecting.
        // This is an invalid expression, for example an
        // object literal with no known fields, or an invalid number:
        // `{num: 'not a number'}`
        // `{foo: 'not an expression}`

        throw Error(
          `Syntax error ${expr ? JSON.stringify(expr, undefined, 4) : ''}`
        );
      })();
      this.level -= 1;
      return result ?? '';
    } catch (e) {}

    this.level -= 1;
    return '';
  }
  applyFunctionStyle(expr: MathJsonExpression, level: number): DelimiterScale {
    return this.options.applyFunctionStyle(expr, level);
  }

  groupStyle(expr: MathJsonExpression, level: number): DelimiterScale {
    return this.options.groupStyle(expr, level);
  }

  rootStyle(
    expr: MathJsonExpression,
    level: number
  ): 'radical' | 'quotient' | 'solidus' {
    return this.options.rootStyle(expr, level);
  }

  fractionStyle(
    expr: MathJsonExpression,
    level: number
  ):
    | 'quotient'
    | 'block-quotient'
    | 'inline-quotient'
    | 'inline-solidus'
    | 'nice-solidus'
    | 'reciprocal'
    | 'factor' {
    return this.options.fractionStyle(expr, level);
  }

  logicStyle(
    expr: MathJsonExpression,
    level: number
  ): 'word' | 'boolean' | 'uppercase-word' | 'punctuation' {
    return this.options.logicStyle(expr, level);
  }

  powerStyle(expr: MathJsonExpression, level: number): 'root' | 'solidus' | 'quotient' {
    return this.options.powerStyle(expr, level);
  }

  numericSetStyle(
    expr: MathJsonExpression,
    level: number
  ): 'compact' | 'regular' | 'interval' | 'set-builder' {
    return this.options.numericSetStyle(expr, level);
  }
}

export function appendLatex(src: string, s: string): string {
  if (!s) return src;

  // If the source end in a LaTeX command,
  // and the appended string begins with a letter
  if (/\\[a-zA-Z]+\*?$/.test(src) && /[a-zA-Z]/.test(s[0])) {
    // Add a space between them
    return src + ' ' + s;
  }
  // No space needed
  return src + s;
}

/** If the string is a special name, extract it. A special name is considered
 * until we run into a '_' or a digit.
 * So, for example `Number` is not `\Nu mber`, but `Number`.
 */
function specialName(s: string): [result: string, rest: string] {
  // Handle ____XXXX unicode escape at the start of the string
  const unicodeMatch = s.match(/^____([0-9A-Fa-f]{6})(.*)/s);
  if (unicodeMatch) {
    // Trim leading zeros but keep at least 4 hex digits
    const hex = unicodeMatch[1].replace(/^0+/, '') || '0';
    const paddedHex = hex.padStart(4, '0');
    return [`\\unicode{"${paddedHex}}`, unicodeMatch[2]];
  }

  const prefix = s.match(/^([^_]+)/)?.[1] ?? '';
  // Does the name start with a greek letter or other special symbol?
  let i = SYMBOLS.findIndex((x) => prefix === x[0]);
  if (i >= 0) return [SYMBOLS[i][1], s.substring(SYMBOLS[i][0].length)];

  // Does the name start with a digit, spelled out?
  // i.e. for `\mathbb{1}`.
  const DIGITS = {
    zero: '0',
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    ten: '10',
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
  i = Object.keys(EXTRA_SYMBOLS).findIndex((x) => prefix === x);
  if (i >= 0) {
    // Access the ith key of the object
    const key = Object.keys(EXTRA_SYMBOLS)[i];
    return [EXTRA_SYMBOLS[key], s.substring(key.length)];
  }

  return [prefix, s.substring(prefix.length)];
}

/** Extract the body of the symbol, and the modifiers
 * (accents and styles)
 */
function parseModifiers(
  s: string
): [body: string, accents: string[], styles: string[], rest: string] {
  // Get the special names
  // eslint-disable-next-line prefer-const
  let [body, rest] = specialName(s);

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

function parseSymbolBody(
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

  // Consume continuation text after unicode escapes (e.g., "abc" in "____2012abc")
  // This handles the case where specialName consumed a ____XXXX prefix and left
  // plain text in rest that isn't a modifier/subscript/superscript
  while (rest.length > 0 && !rest.startsWith('_') && !/^\d/.test(rest)) {
    const [nextSegment, nextRest] = specialName(rest);
    if (nextSegment === '' || nextRest === rest) break;
    body += nextSegment;
    rest = nextRest;
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
      // Check for ____XXXX unicode escape (4 underscores + hex) before
      // checking __ (superscript) or _ (subscript) separators
      const ucMatch = rest.match(/^____([0-9A-Fa-f]{6})(.*)/s);
      if (ucMatch) {
        const ucHex = ucMatch[1].replace(/^0+/, '') || '0';
        body += `\\unicode{"${ucHex.padStart(4, '0')}}`;
        rest = ucMatch[2];
        // Consume any following text segment up to the next _ separator
        if (rest.length > 0 && !rest.startsWith('_')) {
          const [nextSegment, nextRest] = specialName(rest);
          body += nextSegment;
          rest = nextRest;
        }
      } else if (rest.startsWith('__')) {
        const [sup, rest2] = parseSymbolBody(rest.substring(2), false, 'none');
        sups.push(sup);
        rest = rest2;
      } else if (rest.startsWith('_')) {
        const [sub, rest2] = parseSymbolBody(rest.substring(1), false, 'none');
        subs.push(sub);
        rest = rest2;
      } else {
        break;
      }
    }

    // Apply the superscripts and subscripts
    if (sups.length > 0) body = supsub('^', body, sups.join(','));
    if (subs.length > 0) body = supsub('_', body, subs.join(','));
  }

  for (const style of styles) {
    if (STYLE_MODIFIERS[style]) body = STYLE_MODIFIERS[style](body);
  }

  if (styles.length === 0 && style !== 'none') {
    switch (style) {
      case 'auto':
        if (countTokens(body) > 1) {
          // Use \operatorname for symbols containing \unicode escapes
          // (these are named symbols, not styled text)
          if (body.includes('\\unicode')) body = `\\operatorname{${body}}`;
          else body = `\\mathrm{${body}}`;
        }
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
// 'x_"max"' --> `x_\operatorname{max}`
// '_' --> `\operatorname{\_}`
// '_a' --> `\operatorname{\_a}`
// '___a' --> `\operatorname{\_\_\_a}`
// 'alpha0' --> `mathit{\alpha_{0}}`
// 'alpha__beta' --> `\operatorname{\alpha^{\beta}}`
// 'alpha_beta' --> `\operatorname{\alpha_{beta}}`
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
function serializeSymbol(
  s: string | null,
  style: 'operator' | 'italic' | 'upright' | 'none' | 'auto' = 'auto'
): string | null {
  if (s === null) return null;

  // If the symbol contains emojis, skip the wrapping
  if (EMOJIS.test(s)) return s;

  // If the symbol starts with one or more underscore,
  // it's a wildcard symbol and always wrapped with \operatorname{...}.
  // But ____XXXXXX (4 underscores + 6 hex digits) is a unicode escape, not a wildcard.
  const m = s.match(/^(_+)(.*)/);
  if (m && !s.match(/^____[0-9A-Fa-f]{6}/)) {
    const [body, rest] = parseSymbolBody(m[2], true, 'none');
    return `\\operatorname{${'\\_'.repeat(m[1].length) + body + rest}}`;
  }

  const [body, rest] = parseSymbolBody(s, true, style);

  // We couldn't parse the symbol, so just wrap it in \operatorname{...}
  if (rest.length > 0) return `\\operatorname{${s}}`;

  return body;
}

export function serializeLatex(
  expr: MathJsonExpression | null,
  dict: IndexedLatexDictionary,
  options: Readonly<SerializeLatexOptions>
): string {
  const serializer = new Serializer(dict, options);
  return serializer.serialize(expr);
}
