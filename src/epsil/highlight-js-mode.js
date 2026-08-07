/*
Language: Epsil
Description: The Epsil language is a technical computing programming language
Authors: Arno Gourdol <arno@arno.org>
Website: https://www.cortexjs.io
Category: scientific

Grammar validation
------------------
Last validated: 2026-08-06 against the Epsil grammar shipped in
`src/epsil/`. The first pass that day narrowed the keyword table to the words
the grammar actually claims (the reserved-word relaxation), added
`break`/`continue`, the contextual `type`/`alias`/`is`, and the non-finite
literals. A second pass replaced the identifier character class with the actual
complement of `WHITE_SPACE ∪ PATTERN_SYNTAX ∪ IDENTIFIER_CONTINUE_PROHIBITED`
(it had excluded only the C0 controls, so a symbol swallowed the `,` and `;`
that follow it), unbounded the verbatim-symbol body, widened the Unicode
operator class to all of non-ASCII `PATTERN_SYNTAX`, made `#pragma` stop where
the lexer stops, and dropped the trailing `\b` from the number literals so
implicit multiplication (`3x`) is a number followed by a symbol. That pass was
checked mechanically, not by eye: every symbol boundary the mode produces over
the 255 ```epsil blocks in `src/epsil/docs` matches `tokenize()`, and the
identifier class agrees with `isBreak`/`isIdentifierContinueProhibited` on
every code point in U+0000..U+FFFF.
Tables cross-checked against source:
  - operators.ts   — operator spellings incl. `%` (Mod) and postfix `!`
                     (Factorial), plus `|>`/`~>` (Pipe), `**` (Power), `!in`
                     (NotElement) and the fancy-Unicode aliases.
  - lexer.ts       — number literals (decimal / `0x` hex / `0b` binary with `_`
                     digit separators), `"…"` / `"""…"""` / `#"…"#` strings,
                     `` `…` `` verbatim symbols, `$…$` LaTeX islands, `#…`
                     pragmas, and line + nested block comments.
  - characters.ts  — `isBreak` / `isIdentifierContinueProhibited`, the tables
                     the identifier and Unicode-operator classes mirror.
  - reserved-words.ts — `ACTIVE_WORDS` (highlighted as keywords) and
                     `LITERAL_WORDS` (highlighted as constants). The merely
                     RESERVED words are ordinary identifiers and are NOT
                     highlighted.

`highlight.js` is NOT a devDependency of this repo, so the assembled mode is
maintained by static review rather than an automated test — but the keyword and
constant TABLES are exported and pinned by
`test/epsil/reserved-words.test.ts`, which needs no such dependency. When the grammar changes, update
the tables below and refresh the "Last validated" date. A quick structural check
is `node -e "import('./src/epsil/highlight-js-mode.js').then(m =>
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

// The words the grammar CLAIMS (source of truth: `ACTIVE_WORDS` in
// `src/epsil/reserved-words.ts`), plus the contextual heads that are not
// reserved words at all but do head a construct: `let`, `type`, `alias`, and
// the `is` type test.
//
// The merely-RESERVED words (`set`, `with`, `label`, `where`, …) are
// deliberately NOT here. They are ordinary identifiers — they can name a
// binding, be assigned to, be a `|->` parameter, and be called — so painting
// them as keywords would tell the author a name is unavailable when it is
// available. They are a documentation concern, not a coloring one.
//
// The literal words (`true`, `false`, `NaN`, `Infinity`, `oo`) complete the
// hard-reserved set and live in `CONSTANTS_LIST` below.
//
// `test/epsil/reserved-words.test.ts` pins this list against the two tiers so
// it cannot drift again.
export const KEYWORDS_LIST = [
  // Contextual heads — not reserved words, but they head a construct.
  'let',
  'type',
  'alias',
  'is',
  // ACTIVE_WORDS — the heads and word operators the parser claims.
  'break',
  'const',
  'continue',
  'do',
  'else',
  'for',
  'function',
  'if',
  'in',
  'match',
  'while',
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
export const CONSTANTS_LIST = [
  'True',
  'False',
  'true',
  'false',
  'NaN',
  'Infinity',
  'oo',
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
// A leading `\b` keeps the digits of `x2` inside the identifier, but there is
// deliberately NO trailing `\b`: `scanNumber` stops as soon as the literal ends
// and lets `scanSymbol` take over, so implicit multiplication — `3x`, `2h`,
// `5r`, all over the docs — is a NUMBER followed by a SYMBOL. A trailing `\b`
// would fail to match `3` in `3x` (digit and letter are both word characters)
// and hand the whole run to the identifier matcher as one name.
const NUMBER = {
  className: 'number',
  relevance: 0,
  variants: [
    // hexadecimal floating-point-literal (subsumes hexadecimal-literal).
    // `e`/`E` are hex digits, so the exponent marker is only `p`/`P`.
    {
      match:
        `\\b0[xX](${hexDigits})(\\.(${hexDigits}))?` +
        `([pP][+-]?(${decimalDigits}))?`,
    },
    // binary-literal
    {
      match: /\b0[bB]([01]_*)+/,
    },
    // decimal floating-point-literal (subsumes decimal-literal)
    {
      match:
        `\\b(${decimalDigits})(\\.(${decimalDigits}))?` +
        `([eE][+-]?(${decimalDigits}))?`,
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

// An identifier runs until a *break* character. `lexer.ts` `scanSymbol` stops
// on `isBreak(c) || isIdentifierContinueProhibited(c)`, and `isBreak` is
// `WHITE_SPACE ∪ PATTERN_SYNTAX` (`characters.ts`), so the class below is the
// complement of those three tables.
//
// The previous class excluded only the C0 controls, so it swallowed every
// separator the grammar relies on: `Add(x, 2)` matched `x,` as one identifier
// and `a;b` as one name. It also excluded `_`, which the lexer accepts
// anywhere in a symbol.
//
// There is deliberately no separate initial-character class:
// `isIdentifierStartProhibited` only adds characters `PATTERN_SYNTAX` already
// excludes, and digits are kept out of the first position by listing `NUMBER`
// before `SYMBOLS` in `contains` — the same precedence the lexer gets from
// consulting `scanNumber` before `scanSymbol`.
//
// Ranges below, in table order: C0 and space + `!"#$%&'()*+,-./` | `:;<=>?@` |
// `[\]^` | backtick | `{|}~` + DEL and C1 + NBSP + `¡¢£¤¥¦§` | © | «¬ | ® |
// °± | ¶ | » | ¿ | × | ÷ | OGHAM SPACE | MONGOLIAN VOWEL SEPARATOR | the
// U+2000 spaces | LRM and RLM | U+2010‥U+203E | U+2041‥U+2053 | MEDIUM
// MATHEMATICAL SPACE | the arrow, math and dingbat blocks | CJK punctuation |
// U+FD3E‥U+FD3F | U+FE45‥U+FE46 | the non-characters.
const IDENTIFIER_CHARACTER =
  /[^\u0000-\u002F\u003A-\u0040\u005B-\u005E\u0060\u007B-\u00A7\u00A9\u00AB\u00AC\u00AE\u00B0\u00B1\u00B6\u00BB\u00BF\u00D7\u00F7\u1680\u180E\u2000-\u200A\u200E\u200F\u2010-\u203E\u2041-\u2053\u205F\u2190-\u2775\u2794-\u2E7F\u3000-\u3003\u3008-\u3020\u3030\uFD3E\uFD3F\uFE45\uFE46\uFFFE\uFFFF]/;
const IDENTIFIER_CHARACTERS = concat(
  IDENTIFIER_CHARACTER,
  IDENTIFIER_CHARACTER,
  '*'
);

// A pragma is `#` followed by identifier characters (`scanHash` reuses the
// same break rule as `scanSymbol`), so `#simplify+1` is the pragma `#simplify`
// followed by an operator, not one long pragma. `#!` on the first line is a
// shebang.
const META = {
  className: 'meta',
  variants: [{ match: /^#!.*/ }, { match: concat(/#/, IDENTIFIER_CHARACTERS) }],
};

const COMMENT_MODES = (hljs) => [
  hljs.C_LINE_COMMENT_MODE,
  hljs.COMMENT('/\\*', '\\*/', {
    contains: ['self'],
  }),
];

const SYMBOLS = [
  // Verbatim (backtick-quoted) symbol: `` `while` `` — a literal name that may
  // shadow a reserved word. `scanVerbatimSymbol` accepts *any* character up to
  // the closing backtick (a linebreak ends it unbalanced), so this is not the
  // identifier class: `` `hello world` `` is a single verbatim symbol.
  {
    className: 'variable',
    match: /`[^`\n]*`/,
  },
  {
    className: 'variable',
    match: IDENTIFIER_CHARACTERS,
  },
];

// Operators. The ASCII variant maximal-munches a run of the lexer's operator
// characters (`src/epsil/lexer.ts` OPERATOR_CHARS) so multi-character
// operators — `|>`, `~>`, `->`, `|->`, `**`, `!=`, `%`, postfix `!` and the
// range `..` — are one token.
//
// The fancy variant covers the Unicode operator glyphs the serializer emits and
// the parser accepts (`↦ → ⋁ ⋀ ≣ ≠ ⩽ ⩾ ≤ ≥ ∈ ∉ ∧ ∨ × ÷ − ¬`). It spans the whole
// non-ASCII part of `PATTERN_SYNTAX` rather than a hand-picked subset: those
// characters all break an identifier, so anything left uncovered here would
// render as unstyled text. One glyph per token — unlike the ASCII run, the
// lexer does not munch these together.
const OPERATOR = {
  className: 'operator',
  relevance: 0,
  variants: [
    { begin: /[+\-*/^=<>!&|~:?%.]+/ },
    {
      begin:
        /[\u00A1-\u00A7\u00A9\u00AB\u00AC\u00AE\u00B0\u00B1\u00B6\u00BB\u00BF\u00D7\u00F7\u2010-\u203E\u2041-\u2053\u2190-\u2775\u2794-\u2E7F\u3001-\u3003\u3008-\u3020\u3030\uFD3E\uFD3F\uFE45\uFE46]/,
    },
  ],
};

// Brackets and the separators. `,` and `;` are not OPERATOR_CHARS in the lexer
// — they end a symbol as `PATTERN_SYNTAX` and are consumed by the parser as
// separators — so they are punctuation here rather than operators.
const BRACE = {
  className: 'punctuation',
  relevance: 0,
  begin: /[[\](){},;]/,
};

/**
 * @param {object} hljs
 * @returns {object}
 */
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export default function (hljs) {
  return {
    name: 'Epsil',
    aliases: ['epsil'],
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
