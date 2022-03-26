import type { Expression } from '../../math-json/math-json-format';
import {
  NumberFormattingOptions,
  LatexString,
  SerializeLatexOptions,
} from './public';
import {
  IndexedLatexDictionary,
  InfixEntry,
  MatchfixEntry,
  PostfixEntry,
  PrefixEntry,
  SymbolEntry,
} from './dictionary/definitions';
import { joinLatex } from './tokenizer';
import { serializeNumber } from './serialize-number';
import {
  op,
  nops,
  dictionary,
  stringValue,
  head,
  headName,
  symbol,
  tail,
  isFunctionObject,
  isNumberObject,
  isSymbolObject,
} from '../../math-json/utils';
import { WarningSignalHandler } from '../../common/signals';
import { IComputeEngine } from '../public';

function serializeMatchfix(
  serializer: Serializer,
  expr: Expression,
  def: MatchfixEntry
): string {
  return replaceLatex(def.serialize as string, [
    serializer.serialize(op(expr, 1) ?? 'Nothing'),
  ]);
}

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
  readonly computeEngine?: IComputeEngine;
  readonly dictionary: IndexedLatexDictionary;
  level = -1;
  constructor(
    options: NumberFormattingOptions & SerializeLatexOptions,
    dictionary: IndexedLatexDictionary,
    computeEngine: undefined | IComputeEngine,
    onError: WarningSignalHandler
  ) {
    this.options = options;
    this.computeEngine = computeEngine;
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
      return '(' + this.serialize(expr) + ')';
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
    if (typeof name === 'string' && name !== 'Delimiter') {
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

    if (head(expr) === 'Delimiter') return exprStr;

    if (
      typeof expr !== 'number' &&
      !isNumberObject(expr) &&
      !/(^(.|\\[a-zA-Z*]+))$/.test(exprStr)
    ) {
      // It's a long expression, wrap it
      return this.wrapString(
        exprStr,
        this.options.groupStyle(expr, this.level + 1)
      );
    }

    return exprStr;
  }

  wrapString(s: string, style: 'paren' | 'leftright' | 'big' | 'none'): string {
    if (style === 'none') return s;
    return '(' + s + ')';
  }

  serializeSymbol(expr: Expression, def?: SymbolEntry): string {
    const h = head(expr);
    if (!h) {
      console.assert(typeof expr === 'string' || isSymbolObject(expr));
      // It's a symbol
      if (typeof def?.serialize === 'string') {
        return def.serialize;
      } else if (typeof def?.serialize === 'function') {
        return def.serialize(this, expr);
      }

      return sanitizeName(symbol(expr), 'upright.') ?? '';
    }
    //
    // It's a function
    //
    const args = tail(expr);
    if (!def) {
      // We don't know anything about this function
      if (typeof h === 'string' && h.length > 0 && h[0] === '\\') {
        //
        // 1. Is it an unknown LaTeX command?
        //
        // This looks like a LaTeX command. Serialize
        // the arguments as LaTeX arguments
        let result: string = h;
        for (const arg of args) {
          result += '{' + this.serialize(arg) + '}';
        }
        return result;
      }

      //
      // 2. Is it an unknown function call?
      //
      // It's a function we don't know.
      // Maybe it came from `promoteUnknownToken`
      // Serialize the arguments as function arguments
      if (typeof h === 'string')
        return `${sanitizeName(h, 'upright.')}(${args
          .map((x) => this.serialize(x))
          .join(', ')})`;
      return `\\operatorname{Apply}(${this.serialize(h)}, ${this.serialize([
        'List',
        ...args,
      ])})`;
    }

    if (def.requiredLatexArg > 0) {
      //
      // 3. Is it a known LaTeX command?
      //
      // This looks like a LaTeX command. Serialize the arguments as LaTeX
      // arguments
      let optionalArg = '';
      let requiredArg = '';
      let i = 0;
      while (i < def.requiredLatexArg) {
        requiredArg += '{' + this.serialize(args[i++]) + '}';
      }
      while (
        i < Math.min(args.length, def.optionalLatexArg + def.requiredLatexArg)
      ) {
        const optValue = this.serialize(args[1 + i++]);
        if (optValue) {
          optionalArg += '[' + optValue + ']';
        }
      }
      return (def.serialize as string) + (optionalArg + requiredArg);
    }

    //
    // 4. Is it a known function?
    //
    if (typeof def.serialize === 'function') {
      return def.serialize(this, expr);
    }
    const style = this.options.applyFunctionStyle(expr, this.level);
    if (style === 'none') {
      return def.serialize + joinLatex(args.map((x) => this.serialize(x)));
    }
    return def.serialize + this.serialize(['Delimiter', ...args]);
  }

  serializeDictionary(dict: { [key: string]: Expression }): string {
    return `\\left[\\begin{array}{lll}${Object.keys(dict)
      .map((x) => {
        return `\\textbf{${x}} & \\rightarrow & ${this.serialize(dict[x])}`;
      })
      .join('\\\\')}\\end{array}\\right]`;
  }

  serialize(expr: Expression | null): LatexString {
    if (expr === null) return '';

    this.level += 1;
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
          const args = tail(expr);
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
          let result = '';
          // If there is a custom serializer function, use it.
          if (typeof def.serialize === 'function') {
            result = def.serialize(this, expr);
          }
          if (
            !result &&
            (def.kind === 'infix' ||
              def.kind === 'postfix' ||
              def.kind === 'prefix')
          ) {
            result = serializeOperator(this, expr, def);
          }
          if (!result && def.kind === 'matchfix') {
            result = serializeMatchfix(this, expr, def);
          }
          if (!result && def.kind === 'symbol') {
            result = this.serializeSymbol(expr, def);
          }
          return result;
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
          message: ['syntax-error', JSON.stringify(expr)],
        },
      ]);
    })();
    this.level -= 1;
    return result ?? '';
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

const COMMON_VARIABLE_NAME = [
  'alpha',
  'beta',
  'gamma',
  'Gamma',
  'delta',
  'Delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'Theta',
  'iota',
  'kappa',
  'lambda',
  'Lambda',
  'mu',
  'nu',
  'xi',
  'Xi',
  'pi',
  'Pi',
  'rho',
  'sigma',
  'Sigma',
  'tau',
  'upsilon',
  'phi',
  'Phi',
  'varphi',
  'chi',
  'psi',
  'Psi',
  'omega',
  'Omega',
  'aleph',
  'ast',
  'blacksquare',
  'bot',
  'bullet',
  'circ',
  'diamond',
  'times',
  'top',
  'square',
  'star',
];

// If the name contains an underscore, e.g.'mu_0', make sure
// to add braces.
//
// If s has a numeric prefix, put it in subscript.
//
// Escape special Latex characters
// `{`, `}`, `$`, `%`, `[`, `]`, `\`
//
// Other special symbols:
// 'x_012' --> `x_{012}`
// 'x012' --> `x_{012}`
// 'x_"max"' --> `x_\mathrm{max}`
// '_' --> `\mathrm{\_}`
// '_a' --> `\mathrm{\_a}`
// '___a' --> `\mathrm{\_\_\_a}`
// 'alpha0' --> `mathit{\alpha_{0}}`
// 'alpha_beta' --> `mathit{\alpha_{beta}}`
// 'speed-of-sound' --> `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
// 'not[this]' --> `\mathit{\lbrace this\rbrace}`

/**
 * The `defaultMulticharStyle` indicate which style should be use to
 * wrap the symbol if it has more than one character and doesn't have a style
 * specified. This is used to display function names upright, and other
 * (single-char) symbols italic
 */
function sanitizeName(
  s: string | null,
  defaultMulticharStyle: 'italic.' | 'upright.' = 'italic.'
): string | null {
  if (s === null) return null;

  // If the name starts with one or more underscore, it's a wildcard symbol
  const m = s.match(/^(_+)(.*)/);
  if (m) {
    return `\\text{${'\\_'.repeat(m[1].length) + sanitizeNameFragment(m[2])}}`;
  }

  let modifier: string;
  [modifier, s] = extractSymbolStyleModifier(s);

  const name = sanitizeNameFragment(s);

  if (name.length === 1 && !modifier) return name;

  if (!modifier) modifier = defaultMulticharStyle;

  const SYMBOL_MODIFIER_PATTERN = {
    'upright.': '\\mathrm{_}',
    'italic.': '\\mathit{_}',
    'bold-italic.': '\\mathbf{\\mathit{_}}',
    'script.': '\\mathscr{_}',
    'calligraphic.': '\\mathcal{_}',
    'bold-script.': '\\mathbf{\\mathscr{_}}',
    'bold-calligraphic.': '\\mathbf{\\mathcal{_}}',
    'fraktur.': '\\mathfrak{_}',
    'gothic.': '\\mathfrak{_}',
    'bold-gothic.': '\\mathbf{\\mathfrak{_}}',
    'bold-fraktur.': '\\mathbf{\\mathfrak{_}}',
    'sans-serif.': '\\mathsf{_}',
    'bold-sans-serif.': '\\mathbf{\\mathsf{_}}',
    'italic-sans-serif.': '\\mathit{\\mathsf{_}}',
    'monospace.': '\\mathtt{_}',
    'blackboard.': '\\mathbb{_}',
    'double-struck.': '\\mathbb{_}',
  };
  return (SYMBOL_MODIFIER_PATTERN[modifier] ?? '\\mathit{_}').replace(
    '_',
    name
  );
}

function extractSymbolStyleModifier(
  s: string
): [modifier: string, symbol: string] {
  const m = s.match(/^([a-zA-Z-]+\.)(.*)/);
  if (m) return [m[1], m[2]];
  return ['', s];
}

function sanitizeNameFragment(s: string): string {
  const index = s.indexOf('_');
  if (index > 0) {
    const prefix = s.substring(0, index);
    const suffix = s.substring(index + 1);
    if (!suffix) return `${sanitizeName(prefix)}\\_`;
    if (suffix.startsWith('"') && suffix.endsWith('"')) {
      return `${sanitizeNameFragment(prefix)}_\\mathrm{${sanitizeNameFragment(
        suffix.substring(1, -1)
      )}}`;
    }
    return `${sanitizeNameFragment(prefix)}_{${sanitizeNameFragment(suffix)}}`;
  }

  // Ends with a numeric suffix?
  const m = s.match(/([^0-9]+?)([0-9]+)$/);
  if (m) {
    if (m[1].length === 0) return s;
    return `${sanitizeNameFragment(m[1])}_{${m[2]}}`;
  }

  // Is it a special name, e.g. "alpha", etc...
  if (COMMON_VARIABLE_NAME.includes(s)) return '\\' + s;

  // Replace special Latex characters
  s = s.replace(
    /[{}\[\]\\:\-\$%]/g,
    (c) =>
      ({
        '{': '\\lbrace ',
        '}': '\\rbrace ',
        '[': '\\lbrack ',
        ']': '\\rbrack ',
        ':': '\\colon ',
        '\\': '\\backslash ',
        '-': '\\unicode{"2013}',
      }[c] ?? '\\' + c)
  );

  return s;
}
