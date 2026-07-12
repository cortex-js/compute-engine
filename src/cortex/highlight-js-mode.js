/*
Language: Cortex
Description: The Cortex language is a technical computing programming language
Authors: Arno Gourdol <arno@arno.org>
Website: https://www.cortexjs.io
Category: scientific

Grammar validation
------------------
Last validated: 2026-07-12 against the Cortex grammar shipped in
`src/cortex/` (compute-engine 0.74.0). This pass added the lowercase
`true`/`false` literal aliases (ratified 2026-07-11) to the constants table.
Tables cross-checked against source:
  - operators.ts   — operator spellings incl. `%` (Mod) and postfix `!`
                     (Factorial), plus `|>`/`~>` (Pipe), `**` (Power), `!in`
                     (NotElement) and the fancy-Unicode aliases.
  - lexer.ts       — number literals (decimal / `0x` hex / `0b` binary with `_`
                     digit separators), `"…"` / `"""…"""` / `#"…"#` strings,
                     `` `…` `` verbatim symbols, `$…$` LaTeX islands, `#…`
                     pragmas, and line + nested block comments.
  - reserved-words.ts — the reserved-word set (highlighted as keywords).

`highlight.js` is NOT a devDependency of this repo, so this mode is maintained
by static review rather than an automated test. When the grammar changes, update
the tables below and refresh the "Last validated" date. A quick structural check
is `node -e "import('./src/cortex/highlight-js-mode.js').then(m =>
m.default({ C_LINE_COMMENT_MODE:{}, COMMENT:()=>({}) }))"` (asserts the module
loads and assembles a mode object without throwing).
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

// Built-in domain/type names — highlighted as types.
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

// Reserved words (source of truth: `src/cortex/reserved-words.ts`) plus the
// contextual `let` keyword (which is NOT reserved but heads a declaration).
// Most reserved words are not yet wired to a construct; the live heads are
// `let`, `const`, `function`, `if`, `else`, `while`, `for`, and the contextual
// `in`. All reserved words are highlighted so an author sees that the name is
// unavailable as a bare identifier.
const KEYWORDS_LIST = [
  'let',
  'abstract',
  'at',
  'and',
  'as',
  'async',
  'assert',
  'await',
  'begin',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'dynamic',
  'do',
  'each',
  'else',
  'end',
  'export',
  'extern',
  'finally',
  'for',
  'from',
  'function',
  'generator',
  'get',
  'global',
  'goto',
  'if',
  'in',
  'inline',
  'interface',
  'internal',
  'import',
  'iterator',
  'label',
  'lazy',
  'local',
  'loop',
  'match',
  'module',
  'namespace',
  'native',
  'new',
  'not',
  'of',
  'on',
  'optional',
  'or',
  'package',
  'parallel',
  'private',
  'protected',
  'protocol',
  'public',
  'repeat',
  'return',
  'self',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'to',
  'try',
  'union',
  'until',
  'using',
  'var',
  'variant',
  'warn',
  'when',
  'where',
  'while',
  'with',
  'xor',
  'yield',
];

const KEYWORD = {
  className: 'keyword',
  match: concat(/\b/, either(...KEYWORDS_LIST), /\b/),
};

const TYPE = {
  className: 'type',
  match: concat(/\b/, either(...DOMAINS_LIST), /\b/),
};

const BUILT_INS_LIST = ['Add', 'Multiply', 'Divide', 'Evaluate'];
const BUILT_IN = {
  className: 'built_in',
  match: concat(/\b/, either(...BUILT_INS_LIST), /(?=\()/),
};

// Literal constants. `true`/`false` are the lowercase input aliases for the
// `True`/`False` symbols (ratified 2026-07-11).
const CONSTANTS_LIST = [
  'True',
  'False',
  'true',
  'false',
  'Maybe',
  'Missing',
  'Nothing',
  'None',
  'All',
];
const CONSTANT = {
  className: 'literal',
  match: concat(/\b/, either(...CONSTANTS_LIST), /\b/),
};

const decimalDigits = '([0-9]_*)+';
const hexDigits = '([0-9a-fA-F]_*)+';
const NUMBER = {
  className: 'number',
  relevance: 0,
  variants: [
    // hexadecimal floating-point-literal (subsumes hexadecimal-literal).
    // `e`/`E` are hex digits, so the exponent marker is only `p`/`P`.
    {
      match:
        `\\b0[xX](${hexDigits})(\\.(${hexDigits}))?` +
        `([pP][+-]?(${decimalDigits}))?\\b`,
    },
    // binary-literal
    {
      match: /\b0[bB]([01]_*)+\b/,
    },
    // decimal floating-point-literal (subsumes decimal-literal)
    {
      match:
        `\\b(${decimalDigits})(\\.(${decimalDigits}))?` +
        `([eE][+-]?(${decimalDigits}))?\\b`,
    },
  ],
};

// String escape sequences: `\0 \\ \t \n \r \" \'`, `\u{1F600}`, and `\uXXXX`.
const ESCAPED_CHARACTER = {
  className: 'char.escape',
  variants: [
    { match: /\\[0\\tnr"']/ },
    { match: /\\u\{[0-9a-fA-F]{1,8}\}/ },
    { match: /\\u[0-9a-fA-F]{4}/ },
  ],
};

// A `\(…)` interpolation embeds an expression inside a string.
const INTERPOLATION = {
  className: 'subst',
  begin: /\\\(/,
  end: /\)/,
  contains: ['self'],
};

const STRING = {
  className: 'string',
  variants: [
    // Multiline string `"""…"""`.
    {
      begin: /"""/,
      end: /"""/,
      contains: [ESCAPED_CHARACTER, INTERPOLATION],
    },
    // Single-line string `"…"`.
    {
      begin: /"/,
      end: /"/,
      illegal: /\n/,
      contains: [ESCAPED_CHARACTER, INTERPOLATION],
    },
    // Extended raw string `#"…"#` / `##"…"##` (no escape processing). The
    // opening/closing hash runs must match; highlight.js cannot backreference
    // the begin capture in `end`, so the common single/double-hash forms are
    // matched explicitly, longest-first.
    {
      begin: /##"/,
      end: /"##/,
    },
    {
      begin: /#"/,
      end: /"#/,
    },
  ],
};

// A LaTeX island `$…$`. `\$` escapes a literal `$` inside the island so it does
// not close it.
const LATEX_ISLAND = {
  className: 'string',
  begin: /\$/,
  end: /\$/,
  illegal: /\n/,
  contains: [{ className: 'char.escape', match: /\\./ }],
  relevance: 10,
};

// A pragma `#identifier` (and the leading `#!` shebang).
const META = {
  className: 'meta',
  variants: [{ match: /^#!.*/ }, { match: /#[^\s#"(){}[\],;]+/ }],
};

const COMMENT_MODES = (hljs) => [
  hljs.C_LINE_COMMENT_MODE,
  hljs.COMMENT('/\\*', '\\*/', {
    contains: ['self'],
  }),
];

const IDENTIFIER_INITIAL_CHARACTER =
  /[^\u0000-\u0020\uFFFE\uFFFF#$%@_\u0060\u007E]/;
const IDENTIFIER_CHARACTER = /[^\u0000-\u0020\uFFFE\uFFFF]/;
const IDENTIFIER_CHARACTERS = concat(
  IDENTIFIER_INITIAL_CHARACTER,
  IDENTIFIER_CHARACTER,
  '*'
);

const SYMBOLS = [
  // Verbatim (backtick-quoted) symbol: `` `while` `` — a literal name that may
  // shadow a reserved word.
  {
    className: 'variable',
    match: concat(/`/, IDENTIFIER_CHARACTERS, /`/),
  },
  {
    className: 'variable',
    match: IDENTIFIER_CHARACTERS,
  },
];

// Operators. The ASCII variant maximal-munches a run of the lexer's operator
// characters (`src/cortex/lexer.ts` OPERATOR_CHARS) so multi-character
// operators — `|>`, `~>`, `->`, `|->`, `**`, `!=`, `%`, postfix `!` — are one
// token. The fancy variant covers the Unicode operator glyphs the serializer
// emits and the parser accepts (`↦ → ⋁ ⋀ ≣ ≠ ⩽ ⩾ ≤ ≥ ∈ ∉ ∧ ∨ × ÷ − ¬`), which
// would otherwise be swallowed by the identifier matcher above.
const OPERATOR = {
  className: 'operator',
  relevance: 0,
  variants: [
    { begin: /[+\-*/^=<>!&|~:?%]+/ },
    { begin: /[\u2190-\u21FF\u2200-\u22FF\u00AC\u00D7\u00F7\u2A7D\u2A7E]/ },
  ],
};

const BRACE = {
  className: 'punctuation',
  relevance: 0,
  begin: /[[\](){}]/,
};

/**
 * @param {object} hljs
 * @returns {object}
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export default function (hljs) {
  return {
    name: 'Cortex',
    aliases: ['cortex'],
    // Order matters: the `SYMBOLS` identifier catch-all is last, so the more
    // specific matchers (comments, strings, islands, numbers, keywords,
    // operators, braces) win at each position — the identifier character class
    // is deliberately permissive and would otherwise swallow operator and
    // bracket glyphs.
    contains: [
      ...COMMENT_MODES(hljs),
      META,
      STRING,
      LATEX_ISLAND,
      NUMBER,
      KEYWORD,
      CONSTANT,
      TYPE,
      BUILT_IN,
      OPERATOR,
      BRACE,
      ...SYMBOLS,
    ],
  };
}
