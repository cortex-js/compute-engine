/*
Language: Cortex
Description: The Cortex language is a technical computing programming language
Authors: Arno Gourdol <arno@arno.org>
Website: https://www.cortexjs.io
Category: scientific
*/

/**
 * @param {RegExp | string } re
 * @returns {string}
 */
function source(re) {
  if (!re) return null;
  if (typeof re === 'string') return re;

  return re.source;
}

/**
 * @param {...(RegExp | string) } args
 * @returns {string}
 */
function concat(...args) {
  const joined = args.map((x) => source(x)).join('');
  return joined;
}

/**
 * Any of the passed expresssions may match
 *
 * Creates a huge this | this | that | that match
 * @param {(RegExp | string)[] } args
 * @returns {string}
 */
function either(...args) {
  const joined = '(' + args.map((x) => source(x)).join('|') + ')';
  return joined;
}

const DOMAINS_LIST = [
  'Anything',
  'String',
  'Symbol',
  'Boolean',
  'Number',
  'Set',
  'Vector',
  'Matrix',
];

const BUILT_INS_LIST = ['Add', 'Multiply', 'Divide', 'Evaluate'];

const BUILT_IN = {
  className: 'built_in',
  match: concat(/\b/, either(...BUILT_INS_LIST), /(?=\()/),
};

const CONSTANTS_LIST = [
  'True',
  'False',
  'Maybe',
  'Missing',
  'Nothing',
  'None',
  'All',
];
const CONSTANT = {
  className: 'keyword',
  match: concat(/\b/, either(...CONSTANTS_LIST), /(?=\()/),
};

const COMMENTS = [
  hljs.C_LINE_COMMENT_MODE,
  hljs.COMMENT('/\\*', '\\*/', {
    contains: ['self'],
  }),
];

const decimalDigits = '([0-9]_*)+';
const hexDigits = '([0-9a-fA-F]_*)+';
const NUMBER = {
  className: 'number',
  relevance: 0,
  variants: [
    // decimal floating-point-literal (subsumes decimal-literal)
    {
      match:
        `\\b(${decimalDigits})(\\.(${decimalDigits}))?` +
        `([eE][+-]?(${decimalDigits}))?\\b`,
    },
    // hexadecimal floating-point-literal (subsumes hexadecimal-literal)
    {
      match:
        `\\b0x(${hexDigits})(\\.(${hexDigits}))?` +
        `([pP][+-]?(${decimalDigits}))?\\b`,
    },
    // binary-literal
    {
      match: /\b0b([01]_*)+\b/,
    },
  ],
};

const ESCAPED_CHARACTER = () => ({
  className: 'subst',
  variants: [{ match: /\\[0\\tnr"']/ }, { match: /\\u\{[0-9a-fA-F]{1,8}\}/ }],
});

const ESCAPED_NEWLINE = () => ({
  className: 'subst',
  match: /\\[\t ]*(?:[\r\n]|\r\n)/,
});
const INTERPOLATION = () => ({
  className: 'subst',
  label: 'interpol',
  begin: /\\\(/,
  end: /\)/,
});
const MULTILINE_STRING = () => ({
  begin: /"""/,
  end: /"""/,
  contains: [
    ESCAPED_CHARACTER(rawDelimiter),
    ESCAPED_NEWLINE(rawDelimiter),
    INTERPOLATION(rawDelimiter),
  ],
});
const SINGLE_LINE_STRING = (rawDelimiter = '') => ({
  begin: concat(rawDelimiter, /"/),
  end: concat(/"/, rawDelimiter),
  contains: [ESCAPED_CHARACTER(rawDelimiter), INTERPOLATION(rawDelimiter)],
});
const STRING = {
  className: 'string',
  variants: [MULTILINE_STRING(), SINGLE_LINE_STRING()],
};

const IDENTIFIER_INITIAL_CHARACTER = /[^\u0000-\u0020\uFFFE\uFFFF#$%@_\u0060\u007E]/;
const IDENTIFIER_CHARACTER = /[^\u0000-\u0020\uFFFE\uFFFF]/;
const IDENTIFIER_CHARACTERS = concat(
  IDENTIFIER_INITIAL_CHARACTER,
  IDENTIFIER_CHARACTER,
  '*'
);

const SYMBOLS = [
  {
    className: 'keyword',
    match: either(...DOMAINS_LIST),
  },
  {
    className: 'variable',
    match: concat(/`/, IDENTIFIER_CHARACTERS, /`/),
  },
  {
    className: 'variable',
    match: IDENTIFIER_CHARACTERS,
  },
];

const OPERATOR = {
  className: 'operator',
  relevance: 0,
  begin: /[+\-*/,;.:@~=><&|_`'^?!%]+/,
};

const BRACE = {
  className: 'punctuation',
  relevance: 0,
  begin: /[[\](){}]/,
};

/**
 * @returns {object}
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export default function (_hljs) {
  return {
    name: 'Cortex',
    aliases: ['cortex'],
    contains: [
      ...COMMENTS,
      ...SYMBOLS,
      BRACE,
      OPERATOR,
      NUMBER,
      STRING,
      CONSTANT,
      FUNCTION,
      BUILT_IN,
      // DICTIONARY,
    ],
  };
}
