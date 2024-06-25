import type { Expression } from '../../math-json/math-json-format';
import {
  nops,
  dictionary,
  stringValue,
  head,
  headName,
  symbol,
  isNumberObject,
  isSymbolObject,
  ops,
  isNumberExpression,
  ONLY_EMOJIS,
  machineValue,
} from '../../math-json/utils';

import {
  LatexString,
  SerializeLatexOptions,
  DelimiterScale,
  ADDITION_PRECEDENCE,
} from './public';

import {
  IndexedLatexDictionary,
  IndexedLatexDictionaryEntry,
} from './dictionary/definitions';

import { countTokens, joinLatex, supsub } from './tokenizer';
import { serializeNumber } from './serialize-number';
import { SYMBOLS } from './dictionary/definitions-symbols';
import { DELIMITERS_SHORTHAND } from './dictionary/definitions-core';

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
  options: SerializeLatexOptions;
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
  wrap(expr: Expression | null, prec?: number): string {
    if (expr === null) return '';
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
    const name = head(expr);
    if (
      typeof name === 'string' &&
      name !== 'Delimiter' &&
      name !== 'Subscript'
    ) {
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
   * Do not wrap identifiers, positive numbers or functions.
   *
   * This is called by the serializer for power and division (i.e. "(a+1)/b")
   *
   */
  wrapShort(expr: Expression | null): string {
    if (expr === null) return '';
    const exprStr = this.serialize(expr);

    if (symbol(expr) !== null) return exprStr;
    // If the default Delimiter (i.e. using parens), don't wrap
    if (head(expr) === 'Delimiter' && nops(expr) === 1) return exprStr;

    const isNum = isNumberExpression(expr);
    // It's not a negative number, or a decimal number
    if (isNum && !/^(-|\.)/.test(exprStr)) return exprStr;

    const h = head(expr);
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

  wrapArguments(expr: Expression): string {
    return this.wrapString(
      (ops(expr) ?? []).map((x) => this.serialize(x)).join(', '),
      this.options.applyFunctionStyle(expr, this.level)
    );
  }

  serializeSymbol(
    expr: Expression,
    def?: IndexedLatexDictionaryEntry
  ): LatexString {
    console.assert(typeof expr === 'string' || isSymbolObject(expr));
    if (def?.kind === 'function') {
      // It's a function, but it doesn't have arguments.
      // For example `"Cos"`.
      // Print the trigger as an identifier
      return serializeIdentifier(symbol(expr) ?? '') ?? '';
    }
    return (
      def?.serialize?.(this, expr) ?? serializeIdentifier(symbol(expr)) ?? ''
    );
  }

  serializeFunction(
    expr: Expression,
    def?: IndexedLatexDictionaryEntry
  ): LatexString {
    //
    // Use serialize handler if available
    //
    if (def?.serialize) return def.serialize(this, expr);

    // It's a function without a serializer.
    // It may have come from `getIdentifierType()`
    // Serialize the arguments as function arguments
    const h = head(expr);
    if (typeof h === 'string')
      return serializeIdentifier(h, 'auto') + this.wrapArguments(expr);

    //
    // It's a function with a head expression. Use an `apply()`
    // See https://en.wikipedia.org/wiki/Apply
    //

    if (head(h) === 'InverseFunction' || head(h) === 'Derivative') {
      // For inverse functions and derivatives display as a regular function,
      // e.g. \sin^{-1} x, f'(x) instead of x \rhd f' and x \rhd \sin^{-1}

      return (
        this.serializeFunction(h!, this.dictionary.ids.get(head(h) as string)) +
        this.wrapArguments(expr)
      );
    }

    const args = ops(expr) ?? [];
    if (args.length === 1) {
      // If there's a single argument, we can use the pipeline operator
      // (i.e. `\rhd` `|>`)
      return joinLatex([
        this.serialize(args[0]),
        '\\rhd',
        this.wrapString(
          this.serialize(h),
          this.options.applyFunctionStyle(expr, this.level)
        ),
      ]);
    }

    const style = this.options.applyFunctionStyle(expr, this.level);
    return joinLatex([
      '\\operatorname{apply}',
      this.wrapString(
        this.serialize(h) + ', ' + this.serialize(['List', ...args]),
        style
      ),
    ]);
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
        // 3. Is it a dictionary?
        //
        const dict = dictionary(expr);
        if (dict !== null) return this.serializeDictionary(dict);

        //
        // 4. Is it a symbol?
        //
        const symbolName = symbol(expr);
        if (symbolName !== null) {
          return this.serializeSymbol(
            expr,
            this.dictionary.ids.get(symbolName)
          );
        }

        //
        // 5. Is it a named function?
        //
        const fnName = headName(expr);
        if (fnName) {
          const def = this.dictionary.ids.get(fnName);
          return this.serializeFunction(expr, def);
        }

        //
        // 6/ Is it a function with a head expression?
        //
        // For example [['derive', "f"], x]
        if (head(expr) !== null) return this.serializeFunction(expr);

        //
        // 7. Unknown expression
        //
        // This doesn't look like a symbol, or a function,
        // or anything we were expecting.
        // This is an invalid expression, for example an
        // object literal with no known fields, or an invalid number:
        // `{num: 'not a number'}`
        // `{foo: 'not an expression}`

        throw Error(`Syntax error ${expr ? JSON.stringify(expr) : ''}`);
      })();
      this.level -= 1;
      return result ?? '';
    } catch (e) {}

    this.level -= 1;
    return '';
  }
  applyFunctionStyle(expr: Expression, level: number): DelimiterScale {
    return this.options.applyFunctionStyle(expr, level);
  }

  groupStyle(expr: Expression, level: number): DelimiterScale {
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

/** If the string is a special name, extract it. A special name is considered
 * until we run into a '_' or a digit.
 * So, for example `Number` is not `\Nu mber`, but `Number`.
 */
function specialName(s: string): [result: string, rest: string] {
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

/** Extract the body of the identifier, and the modifiers
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
    if (sups.length > 0) body = `${body}${supsub('^', sups.join(','))}`;
    if (subs.length > 0) body = `${body}${supsub('_', subs.join(','))}`;
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
function serializeIdentifier(
  s: string | null,
  style: 'operator' | 'italic' | 'upright' | 'none' | 'auto' = 'auto'
): string | null {
  if (s === null) return null;

  // If the identifier contains emojis, skip the wrapping
  if (ONLY_EMOJIS.test(s)) return s;

  // If the identifier starts with one or more underscore,
  // it's a wildcard symbol and always wrapped with \operatorname{...}.
  const m = s.match(/^(_+)(.*)/);
  if (m) {
    const [body, rest] = parseIdentifierBody(m[2], true, 'none');
    return `\\operatorname{${'\\_'.repeat(m[1].length) + body + rest}}`;
  }

  const [body, rest] = parseIdentifierBody(s, true, style);

  // We couldn't parse the identifier, so just wrap it in \operatorname{...}
  if (rest.length > 0) return `\\operatorname{${s}}`;

  return body;
}

export function serializeLatex(
  expr: Expression | null,
  dict: IndexedLatexDictionary,
  options: SerializeLatexOptions
): string {
  if (options.invisibleMultiply) {
    if (
      !/#1/.test(options.invisibleMultiply) ||
      !/#2/.test(options.invisibleMultiply)
    ) {
      throw Error('Expected 2 arguments (#1 and #2) for invisibleMultiply');
    }
  }

  const serializer = new Serializer(dict, options);
  return serializer.serialize(expr);
}
