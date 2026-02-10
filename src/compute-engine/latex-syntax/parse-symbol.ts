import type {
  MathJsonExpression,
  MathJsonSymbol,
} from '../../math-json';
import { EMOJIS, isValidSymbol, validateSymbol } from '../../math-json/symbols';
import { SYMBOLS } from './dictionary/definitions-symbols';
import { Parser } from './types';

const SYMBOL_PREFIX = {
  // Those are "grouping" prefix that also specify spacing
  // around the symbol. We ignore the spacing, though.
  '\\mathord': '',
  '\\mathop': '',
  '\\mathbin': '',
  '\\mathrel': '',
  '\\mathopen': '',
  '\\mathclose': '',
  '\\mathpunct': '',
  '\\mathinner': '',

  // This is the preferred way to specify a symbol
  // it defines both spacing and font. By default, symbols
  // are wrapped with `\\operatorname{}`.
  '\\operatorname': '',

  // Text commands - extract the text content as a symbol name
  // e.g., x_{\text{max}} -> x_max
  '\\text': '',

  // These styling commands are used to change the font of a symbol
  // They may be problematic, as adjacent symbols may be merged
  // into a single symbol when used in editors, such a MathLive.
  // For example `\mathrm{speed}\mathrm{sound}` can be confused with `\mathrm{speedsound}`
  '\\mathrm': '_upright',
  '\\mathit': '_italic',
  '\\mathbf': '_bold',
  '\\mathscr': '_script',
  '\\mathcal': '_calligraphic',
  '\\mathfrak': '_fraktur',
  '\\mathsf': '_sansserif',
  '\\mathtt': '_monospace',
  '\\mathbb': '_doublestruck',
};

// These commands can be used inside the body of a symbol.
const SYMBOL_MODIFIER = {
  '\\mathring': '_ring',
  '\\hat': '_hat',
  '\\tilde': '_tilde',
  '\\vec': '_vec',
  '\\overline': '_bar',
  '\\underline': '_underbar',
  '\\dot': '_dot',
  '\\ddot': '_ddot',
  '\\dddot': '_dddot',
  '\\ddddot': '_ddddot',
  '\\acute': '_acute',
  '\\grave': '_grave',
  '\\breve': '_breve',
  '\\check': '_check',
};

function parseSymbolToken(
  parser: Parser,
  options: { toplevel: boolean }
): string | null {
  if (parser.atEnd) return null;

  const token = parser.peek;
  let special = {
    '\\_': '_',
    '\\#': 'hash',
  }[token];

  if (!special && !options.toplevel) {
    special = {
      '+': 'plus',
      '-': 'minus',

      '\\plusmn': 'pm',
      '\\pm': 'pm',
      '\\ast': 'ast',
      '\\dag': 'dag',
      '\\ddag': 'ddag',
      '\\bot': 'bottom',
      '\\top': 'top',
      '\\bullet': 'bullet',
      '\\cir': 'circle',
      '\\diamond': 'diamond',
      '\\times': 'times',
      '\\square': 'square',
      '\\star': 'star',
    }[token];
  }

  if (special) {
    parser.nextToken();
    return special;
  }

  const i = SYMBOLS.findIndex((x) => x[1] === token);
  if (i >= 0) {
    parser.nextToken();
    return SYMBOLS[i][0];
  }

  // Handle \char, \unicode, and ^^ character escapes
  const c = parser.parseChar();
  if (c !== null) {
    // Valid XIDC characters pass through as-is
    if (/^\p{XIDC}+$/u.test(c)) return c;

    // Single non-XIDC character: encode as ____XXXXXX (4 underscores + 6 hex digits)
    // Always 6 digits to avoid ambiguity when followed by hex-valid characters.
    // This keeps the symbol name valid per isValidSymbol()
    if ([...c].length === 1) {
      const cp = c.codePointAt(0)!;
      return '____' + cp.toString(16).toUpperCase().padStart(6, '0');
    }

    return c;
  }

  // Raw token (e.g., unrecognized LaTeX command or punctuation) — pass through
  // without encoding so that isValidSymbol() can reject invalid characters
  return parser.nextToken();
}

// The body of a symbol is a sequence of tokens contained
// inside a prefix such as `\mathrm{}`.
// It can include a string of tokens (characters and commands)
// and a list of modifiers (superscript, subscript, etc.)
// and can be wrapped in a prefix (e.g. `\mathbb{}`).
function parseSymbolBody(parser: Parser): string | null {
  let id = matchPrefixedSymbol(parser);

  const prefix = SYMBOL_MODIFIER[parser.peek] ?? null;

  if (prefix) {
    parser.nextToken();
    if (!parser.match('<{>')) return null;

    const body = parseSymbolBody(parser);
    if (body === null || !parser.match('<}>')) return null;

    id = `${body}${prefix}`;
  }

  //
  // If not a symbol, could be a sequence of tokens
  //
  if (id === null) {
    id = '';
    while (!parser.atEnd) {
      const token = parser.peek;
      if (token === '<}>' || token === '_' || token === '^') break;
      if (token === '<space>') {
        parser.nextToken();
        continue;
      }
      const next = parseSymbolToken(parser, { toplevel: false });
      if (next === null) return null;
      id += next;
    }
    // If we're immediately followed by a sequence of digits, capture them
    // e.g.  \alpha1234
    while (!parser.atEnd && /\d/.test(parser.peek)) id += parser.nextToken();
  }

  while (!parser.atEnd) {
    if (parser.match('\\degree')) id += '_deg';
    else if (parser.matchAll(['^', '\\circ'])) id += '_deg';
    else if (parser.matchAll(['^', '\\prime'])) id += '_prime';
    else if (parser.matchAll(['^', '<{>', '\\prime', '<}>'])) id += '_prime';
    else if (parser.matchAll(['^', '<{>', '\\doubleprime', '<}>']))
      id += '_dprime';
    else if (parser.matchAll(['^', '<{>', '\\prime', '\\prime', '<}>']))
      id += '_dprime';
    else break;
  }

  const sups: string[] = [];
  const subs: string[] = [];
  while (!parser.atEnd) {
    if (parser.match('_')) {
      const hasBrace = parser.match('<{>');
      const sub = parseSymbolBody(parser);
      if ((hasBrace && !parser.match('<}>')) || sub === null) return null;
      subs.push(sub);
    } else if (parser.match('^')) {
      const hasBrace = parser.match('<{>');
      const sup = parseSymbolBody(parser);
      if ((hasBrace && !parser.match('<}>')) || sup === null) return null;
      sups.push(sup);
    } else break;
  }

  if (sups.length > 0) id += '__' + sups.join('');
  if (subs.length > 0) id += '_' + subs.join('');

  return id;
}

/**
 * Match a prefix symbol.
 *
 * It can be:
 * - a multi-letter symbol: `\operatorname{speed}`
 *  (`\operatorname` specified both the spacing around the symbol and the font)
 * - a multi-prefix symbol: `\mathbin{\mathsf{U}}`
 *  (`\mathbin` specifies the spacing around the symbol,
 *  `\mathsf` specifies the font)
 * - a symbol with modifiers as subscripts/superscript: `\mathrm{\alpha_{12}}` or `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
 */
function matchPrefixedSymbol(parser: Parser): string | null {
  //
  // Is it a prefix symbol, e.g. `\\mathrm{abc}`?
  //
  const prefix = SYMBOL_PREFIX[parser.peek] ?? null;

  if (prefix === null) return null;

  parser.nextToken();
  if (parser.match('<{>')) {
    // If the symbol starts with a digit,
    // convert it to a string, e.g. `\mathbb{1}` -> `one_blackboard`
    let body = '';
    const digit =
      {
        0: 'zero',
        1: 'one',
        2: 'two',
        3: 'three',
        4: 'four',
        5: 'five',
        6: 'six',
        7: 'seven',
        8: 'eight',
        9: 'nine',
      }[parser.peek] ?? '';
    if (digit) {
      body = digit;
      parser.nextToken();
    }

    body += parseSymbolBody(parser);
    if (body === null || !parser.match('<}>')) return null;
    // Multi-character symbols do not need a prefix
    // if they are upright (that's their default presentation)
    if (prefix === '_upright' && body.length > 1) return body;
    return body + prefix;
  }

  //
  // Not a prefixed symbol
  //
  return null;
}

/** For error handling, if we have a symbol prefix, assume
 * the symbol is invalid (it would have been captured by
 * `matchSymbol()` otherwise) and return an error expression */
export function parseInvalidSymbol(parser: Parser): MathJsonExpression | null {
  const start = parser.index;
  const id = matchPrefixedSymbol(parser);
  if (id === null || isValidSymbol(id)) return null;

  return parser.error(['invalid-symbol', { str: validateSymbol(id) }], start);

  // const prefix =SYMBOL_PREFIX[parser.peek] ?? null;
  // if (prefix === null) return null;

  // const start = parser.index;
  // parser.nextToken();
  // if (parser.match('<{>')) {
  //   let level = 0;
  //   while (!parser.atEnd && level === 0 && parser.peek !== '<}>') {
  //     if (parser.peek === '<{>') level += 1;
  //     if (parser.peek === '<}>') level -= 1;
  //     parser.nextToken();
  //   }
  //   parser.match('<}>');
  // }
  // const s = parser.latex(start, parser.index);
  // if (isValidSymbo(s)) {
  //   this.index = start;
  //   return null;
  // }
  // return parser.error(['invalid-symbol', validateSymbol(s)], start);
}

/**
 * Match a symbol.
 *
 * It can be:
 * - a sequence of emojis: `👍🏻👍🏻👍🏻`
 * - a single-letter: `a`
 * - some LaTeX commands: `\alpha`
 * - a multi-letter id with a prefix: `\operatorname{speed}`
 * - an id with multiple prefixes:
 *  `\mathbin{\mathsf{T}}`
 * - an id with modifiers:
 *    - `\mathrm{\alpha_{12}}` or
 *    - `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
 */
export function parseSymbol(parser: Parser): MathJsonSymbol | null {
  //
  // Is it a single-letter symbol (possibly with subscript)?
  //
  if (/^[a-zA-Z]$/.test(parser.peek) || /^\p{XIDS}$/u.test(parser.peek)) {
    let id = parser.nextToken();

    // Check if the symbol is declared as a collection type or has subscriptEvaluate.
    // If so, don't absorb subscripts into the symbol name - let them be
    // handled as Subscript expressions which will convert to At() calls
    // or be evaluated by the subscriptEvaluate handler.
    const symbolType = parser.getSymbolType(id);
    const isCollection = symbolType.matches('indexed_collection');
    const hasSubscriptEval = parser.hasSubscriptEvaluate(id);

    // Check if followed by subscript(s) - if so, include them in the symbol name
    // This ensures 'i_A' is parsed as a single symbol 'i_A', not as a subscript
    // applied to 'i' (which would turn 'i' into ImaginaryUnit first)
    // However, complex subscripts should remain as Subscript expressions:
    // - {n,m} (comma indicates multi-index)
    // - {n+1} (operators indicate an expression)
    // - {(n+1)} (parentheses indicate an expression)
    // Also, if the symbol is a collection type or has subscriptEvaluate,
    // all subscripts should be Subscript expressions.
    while (!parser.atEnd && !isCollection && !hasSubscriptEval) {
      const currentPeek = parser.peek;
      if (currentPeek !== '_') break;

      const underscoreIndex = parser.index;
      parser.nextToken(); // consume '_'
      const hasBrace = parser.match('<{>');
      if (hasBrace) {
        // Braced subscript: only include in symbol name if it contains
        // only simple tokens (letters, digits, and nested subscripts).
        // If it starts with '(' or contains operators, it's an expression.
        const firstToken = parser.peek;
        if (
          firstToken === '(' ||
          firstToken === '\\lparen' ||
          firstToken === '\\left'
        ) {
          // Starts with parenthesis - it's an expression, not a symbol
          parser.index = underscoreIndex;
          break;
        }

        const sub = parseSymbolBody(parser);
        // Check for indicators that this is an expression, not a simple symbol:
        // - null result
        // - contains comma (multi-index)
        // - contains operators (converted to 'plus', 'minus', etc. by parseSymbolBody)
        // - doesn't end with closing brace
        const hasOperators = sub !== null && /plus|minus|times|ast/.test(sub);
        if (
          sub === null ||
          sub.includes(',') ||
          hasOperators ||
          parser.peek !== '<}>'
        ) {
          parser.index = underscoreIndex;
          break;
        }
        parser.match('<}>');
        id += '_' + sub;
      } else {
        // Unbraced subscript: only accept a single letter or digit
        const subToken = parser.peek;
        if (/^[a-zA-Z0-9]$/.test(subToken) || /^\p{XIDS}$/u.test(subToken)) {
          parser.nextToken();
          id += '_' + subToken;
        } else {
          // Not a valid subscript token, backtrack the '_'
          parser.index = underscoreIndex;
          break;
        }
      }
    }

    return id;
  }

  //
  // Is it a prefixed symbol?
  //
  let id = matchPrefixedSymbol(parser);

  //
  // Is it a sequence of emojis? (they don't need to be wrapped)
  //
  if (!id) {
    id = '';
    while (!parser.atEnd && EMOJIS.test(id + parser.peek))
      id += parser.nextToken();
    if (!id) id = null;
  }

  //
  // Is it a single-token symbol?
  // (other than a letter, it could be a command, e.g. \alpha)
  //
  const index = parser.index;
  id ??= parseSymbolToken(parser, { toplevel: true });

  if (id) {
    id = id.normalize();
    if (isValidSymbol(id)) return id;
  }

  //
  // Not a valid symbol
  //
  parser.index = index;
  return null;
}
