import { Expression } from '../../math-json';
import {
  EMOJIS,
  isValidIdentifier,
  validateIdentifier,
} from '../../math-json/identifiers';
import { SYMBOLS } from './dictionary/definitions-symbols';
import { Parser } from './public';

const IDENTIFIER_PREFIX = {
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

  // This is the preferred way to specify an identifier
  // it defines both spacing and font. By default, identifiers
  // are wrapper with `\\operatorname{}`.
  '\\operatorname': '',

  // These styling commands are used to change the font of an identifier
  // They may be problematic, as adjacent identifiers may be merged
  // into a single identifier when used in editors, such a MathLive.
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

// These commands can be used inside the body of an identifier.
const IDENTIFIER_MODIFIER = {
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

function parseIdentifierToken(
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

  // Unexpected LaTeX command or \\char or \\unicode?
  return parser.matchChar() ?? parser.nextToken();
}

// The body of an identifier is a sequence of tokens contained
// inside a prefix such as `\mathrm{}`.
// It can include a string of tokens (characters and commands)
// and a list of modifiers (superscript, subscript, etc.)
// and can be wrapped in a prefix (e.g. `\mathbb{}`).
function parseIdentifierBody(parser: Parser): string | null {
  let id = matchPrefixedIdentifier(parser);

  const start = parser.index;

  const prefix = IDENTIFIER_MODIFIER[parser.peek] ?? null;

  if (prefix) {
    parser.nextToken();
    if (!parser.match('<{>')) {
      parser.index = start;
      return null;
    }
    const body = parseIdentifierBody(parser);
    if (body === null || !parser.match('<}>')) {
      parser.index = start;
      return null;
    }
    id = `${body}${prefix}`;
  }

  //
  // If not an identifier, could be a sequence of tokens
  //
  if (id === null) {
    id = '';
    while (!parser.atEnd) {
      const token = parser.peek;
      if (token === '<}>' || token === '_' || token === '^') break;
      const next = parseIdentifierToken(parser, { toplevel: false });
      if (next === null) {
        parser.index = start;
        return null;
      }
      id += next;
    }
    // If we're immediately followed by a sequence of digits, capture them
    // e.g.  \alpha1234
    while (!parser.atEnd && /\d/.test(parser.peek)) id += parser.nextToken();
  }

  while (!parser.atEnd) {
    if (parser.match('\\degree')) id += '_deg';
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
      const sub = parseIdentifierBody(parser);
      if ((hasBrace && !parser.match('<}>')) || sub === null) {
        parser.index = start;
        return null;
      }
      subs.push(sub);
    } else if (parser.match('^')) {
      const hasBrace = parser.match('<{>');
      const sup = parseIdentifierBody(parser);
      if ((hasBrace && !parser.match('<}>')) || sup === null) {
        parser.index = start;
        return null;
      }
      sups.push(sup);
    } else break;
  }

  if (sups.length > 0) id += '__' + sups.join('');
  if (subs.length > 0) id += '_' + subs.join('');

  return id;
}

/**
 * Match a prefix identifier.
 *
 * It can be:
 * - a multi-letter identifier: `\operatorname{speed}`
 *  (`\operatorname` specified both the spacing around the symbol and the font)
 * - a multi-prefix identifier: `\mathbin{\mathsf{U}}`
 *  (`\mathbin` specifies the spacing around the symbol,
 *  `\mathsf` specifies the font)
 * - an identifier with modifiers as subscripts/superscript: `\mathrm{\alpha_{12}}` or `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
 */
function matchPrefixedIdentifier(parser: Parser): string | null {
  const start = parser.index;

  //
  // Is it a prefix identifier, e.g. `\\mathrm{abc}`?
  //
  const prefix = IDENTIFIER_PREFIX[parser.peek] ?? null;

  if (prefix === null) return null;

  parser.nextToken();
  if (parser.match('<{>')) {
    // If the identifier starts with a digit,
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

    body += parseIdentifierBody(parser);
    if (body === null || !parser.match('<}>')) {
      parser.index = start;
      return null;
    }
    // Multi-character identifiers do not need a prefix
    // if they are upright (that's their default presentation)
    if (prefix === '_upright' && body.length > 1) return body;
    return body + prefix;
  }

  //
  // Not a prefixed identifier
  //
  parser.index = start;
  return null;
}

/** For error handling, if we have a identifier prefix, assume
 * the identifier is invalid (it would have been captured by
 * `matchIdentifier()` otherwise) and return an error expression */
export function parseInvalidIdentifier(parser: Parser): Expression | null {
  const start = parser.index;
  const id = matchPrefixedIdentifier(parser);
  if (id === null || isValidIdentifier(id)) {
    parser.index = start;
    return null;
  }
  return parser.error(
    ['invalid-identifier', { str: validateIdentifier(id) }],
    start
  );

  // const prefix = IDENTIFIER_PREFIX[parser.peek] ?? null;
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
  // if (isValidIdentifier(s)) {
  //   this.index = start;
  //   return null;
  // }
  // return parser.error(['invalid-identifier', validateIdentifier(s)], start);
}

/**
 * Match an identifier.
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
export function parseIdentifier(parser: Parser): string | null {
  //
  // Shortcut: Is it a single-letter identifier?
  //
  if (/^[a-zA-Z]$/.test(parser.peek) || /^\p{XIDS}$/u.test(parser.peek))
    return parser.nextToken();

  //
  // Is it a prefixed, identifier?
  //
  const start = parser.index;
  let id = matchPrefixedIdentifier(parser);

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
  // Is it a single-token identifier?
  // (other than a letter, it could be a command, e.g. \alpha)
  //
  id ??= parseIdentifierToken(parser, { toplevel: true });

  if (id) {
    id = id.normalize();
    if (isValidIdentifier(id)) return id;
  }

  //
  // Not a valid identifier
  //

  parser.index = start;
  return null;
}
