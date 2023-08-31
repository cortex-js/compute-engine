import { Expression } from '../../math-json';
import {
  ONLY_EMOJIS,
  isValidIdentifier,
  validateIdentifier,
} from '../../math-json/utils';
import { SYMBOLS } from './dictionary/definitions-symbols';
import { Parser } from './public';

const IDENTIFIER_PREFIX = {
  '\\operatorname': '_operator',
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

function matchIdentifierToken(
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
    parser.next();
    return special;
  }

  const i = SYMBOLS.findIndex((x) => x[1] === token);
  if (i >= 0) {
    parser.next();
    return SYMBOLS[i][0];
  }

  // Unexpected LaTeX command or \\char or \\unicode?
  return parser.matchChar() ?? parser.next();
}

// The body of an identifier is a sequence of tokens contained
// inside a prefix such as `\mathrm{}`.
// It can include a string of tokens (characters and commands)
// and a list of modifiers (superscript, subscript, etc.)
// and can be wrapped in a prefix (e.g. `\mathbb{}`).
function matchIdentifierBody(parser: Parser): string | null {
  let id = matchPrefixedIdentifier(parser);

  const start = parser.index;

  const prefix = IDENTIFIER_MODIFIER[parser.peek] ?? null;

  if (prefix) {
    parser.next();
    if (!parser.match('<{>')) {
      parser.index = start;
      return null;
    }
    const body = matchIdentifierBody(parser);
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
      const next = matchIdentifierToken(parser, { toplevel: false });
      if (next === null) {
        parser.index = start;
        return null;
      }
      id += next;
    }
    // If we're immediately followed by a sequence of digits, capture them
    // e.g.  \alpha1234
    while (!parser.atEnd && /\d/.test(parser.peek)) id += parser.next();
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
      const sub = matchIdentifierBody(parser);
      if ((hasBrace && !parser.match('<}>')) || sub === null) {
        parser.index = start;
        return null;
      }
      subs.push(sub);
    } else if (parser.match('^')) {
      const hasBrace = parser.match('<{>');
      const sup = matchIdentifierBody(parser);
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
 * Match an identifier. It can be:
 * - a multi-letter identifier: `\mathrm{speed}`
 * - an identifier with modifiers: `\mathrm{\alpha_{12}}` or `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
 */
function matchPrefixedIdentifier(parser: Parser): string | null {
  const start = parser.index;

  //
  // Is it a prefix identifier, e.g. `\\mathrm{abc}`?
  //
  const prefix = IDENTIFIER_PREFIX[parser.peek] ?? null;

  if (prefix === null) return null;

  parser.next();
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
      parser.next();
    }

    body += matchIdentifierBody(parser);
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
 * `mathIdentifier()` otherwise) and return an error expression */
export function matchInvalidIdentifier(parser: Parser): Expression | null {
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
  // parser.next();
  // if (parser.match('<{>')) {
  //   let level = 0;
  //   while (!parser.atEnd && level === 0 && parser.peek !== '<}>') {
  //     if (parser.peek === '<{>') level += 1;
  //     if (parser.peek === '<}>') level -= 1;
  //     parser.next();
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
 * Match an identifier. It can be:
 * - a sequence of emojis: `👍🏻👍🏻👍🏻`
 * - a single-letter identifier: `a`
 * - some LaTeX commands: `\alpha`
 * - a multi-letter identifier with a prefix: `\mathrm{speed}`
 * - an identifier with modifiers: `\mathrm{\alpha_{12}}` or `\mathit{speed\unicode{"2012}of\unicode{"2012}sound}`
 */
export function matchIdentifier(parser: Parser): string | null {
  //
  // Is it a single-letter identifier (shortcut)?
  //
  if (/^[a-zA-Z]$/.test(parser.peek) || /^\p{XIDS}$/u.test(parser.peek))
    return parser.next();

  //
  // Is it a multi-letter, prefixed, identifier?
  //
  const start = parser.index;
  let id = matchPrefixedIdentifier(parser);

  //
  // Is it a sequence of emojis? (they don't need to be wrapped)
  //
  if (!id) {
    id = '';
    while (!parser.atEnd && ONLY_EMOJIS.test(id + parser.peek))
      id += parser.next();
  }

  if (id) {
    id = id.normalize();
    if (isValidIdentifier(id)) return id;
    parser.index = start;
    return null;
  }

  //
  // Is it a single-letter identifier?
  //
  let next = matchIdentifierToken(parser, { toplevel: true });
  if (next) {
    next = next.normalize();
    if (isValidIdentifier(next)) return next;
  }

  //
  // Not a valid identifier
  //

  parser.index = start;
  return null;
}
