/*
Language: Epsil
Description: The Epsil language is a technical computing programming language
Authors: Arno Gourdol <arno@arno.org>
Website: https://www.cortexjs.io
Category: scientific

Grammar validation
------------------
Last validated: 2026-09-05 against the Epsil grammar shipped in
`src/epsil/`. That day added the Unicode notations the lexer learned:
superscripts end a symbol and are styled as operators (`x²`), the subscript
signs `₊₋₍₎` likewise while subscript letters and digits stay in the name
(`xₙ`), the glyph constants (π ℝ …) are literals, and `∫ ∑ ∏` are built-ins
rather than operators. The 2026-08-06 first pass narrowed the keyword table to the words
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
                     the identifier and Unicode-operator classes mirror, plus
                     `SUPERSCRIPT_UNICODE` / `SUBSCRIPT_UNICODE` (the `SCRIPT`
                     matcher and the identifier-class exclusions) and the
                     `FANCY_UNICODE` symbol aliases (glyph constants and the
                     `∫ ∑ ∏` built-ins).
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
// reserved words at all but do head a construct: `let`, `type`, `alias`,
// the `is` type test, and the trailing `where` clause.
//
// The merely-RESERVED words (`set`, `with`, `label`, …) are
// deliberately NOT here. They are ordinary identifiers — they can name a
// binding, be assigned to, be a `=>` parameter, and be called — so painting
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
  // (`readonly`/`readwrite` head protocol property members; `get`/`set` are
  // deliberately NOT here — they are merely-reserved and common identifiers,
  // and the pinning test forbids painting non-hard reserved words.)
  'let',
  'type',
  'alias',
  'is',
  'where',
  'readonly',
  'readwrite',
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
  'protocol',
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

const IDENTIFIER_CHARACTER =
  /[^\u0000-\u002F\u003A-\u0040\u005B-\u005E\u0060\u007B-\u00A7\u00A9\u00AB-\u00AC\u00AE\u00B0-\u00B1\u00B6\u00BB\u00BF\u00D7\u00F7\u1680\u180E\u2000-\u200A\u200E-\u200F\u2010-\u203E\u2041-\u2053\u205F\u2190-\u2775\u2794-\u2E7F\u3000-\u3003\u3008-\u3020\u3030\uFD3E-\uFD3F\uFE45-\uFE46\uFFFE-\uFFFF\u00B2-\u00B3\u00B9\u02B0\u02B2-\u02B3\u02B7-\u02B8\u02E1-\u02E3\u1D43\u1D47-\u1D49\u1D4D\u1D4F-\u1D50\u1D52\u1D56-\u1D58\u1D5B\u1D62-\u1D65\u1D9C\u1DA0\u1DBB\u2070-\u2071\u2074-\u207B\u207D-\u208B\u208D-\u208E\u2090-\u2093\u2095-\u209C\u2C7C]/;
// The name-boundary class: an identifier character OR a subscript letter or
// digit. A keyword or constant word ends only where the lexer would end a
// symbol: `ifₙ` is the symbol `if_n`, not the keyword `if`.
const NAME_BOUNDARY_CHARACTER =
  /[^\u0000-\u002F\u003A-\u0040\u005B-\u005E\u0060\u007B-\u00A7\u00A9\u00AB-\u00AC\u00AE\u00B0-\u00B1\u00B6\u00BB\u00BF\u00D7\u00F7\u1680\u180E\u2000-\u200A\u200E-\u200F\u2010-\u203E\u2041-\u2053\u205F\u2190-\u2775\u2794-\u2C7B\u2C7D-\u2E7F\u3000-\u3003\u3008-\u3020\u3030\uFD3E-\uFD3F\uFE45-\uFE46\uFFFE-\uFFFF\u00B2-\u00B3\u00B9\u02B0\u02B2-\u02B3\u02B7-\u02B8\u02E1-\u02E3\u1D43\u1D47-\u1D49\u1D4D\u1D4F-\u1D50\u1D52\u1D56-\u1D58\u1D5B\u1D9C\u1DA0\u1DBB\u2070-\u2071\u2074-\u207B\u207D-\u207F\u208A-\u208B\u208D-\u208E]/;
// A pragma name (`scanHash`) stops at `isBreak`/`isIdentifierContinueProhibited`
// only — it does NOT stop at a script character, so `#simplify²` is one pragma.
const PRAGMA_CHARACTER =
  /[^\u0000-\u002F\u003A-\u0040\u005B-\u005E\u0060\u007B-\u00A7\u00A9\u00AB-\u00AC\u00AE\u00B0-\u00B1\u00B6\u00BB\u00BF\u00D7\u00F7\u1680\u180E\u2000-\u200A\u200E-\u200F\u2010-\u203E\u2041-\u2053\u205F\u2190-\u2775\u2794-\u2E7F\u3000-\u3003\u3008-\u3020\u3030\uFD3E-\uFD3F\uFE45-\uFE46\uFFFE-\uFFFF]/;

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
  variants: [
    { match: concat(/\b/, either(...CONSTANTS_LIST), /\b/) },
    // The glyph aliases of library constants (`FANCY_UNICODE` in
    // `characters.ts`). They lex as SYMBOL tokens for `Pi`,
    // `ComplexNumbers`, …, so they are styled as constants. The letter-like
    // glyphs π ℂ ℕ ℚ ℝ ℤ ⅇ ⅈ are identifier characters, and the lexer
    // resolves the alias only when the glyph is the WHOLE symbol: `πvalue`
    // is an ordinary name, so the match requires a name boundary after the
    // glyph. ∅ ∞ ⧝ are Pattern_Syntax and always stand alone.
    {
      match: concat(
        /[\u03C0\u2102\u2115\u211A\u211D\u2124\u2147-\u2148]/,
        '(?!',
        NAME_BOUNDARY_CHARACTER,
        ')'
      ),
    },
    { match: /[\u2205\u221E\u29DD]/ },
  ],
};

// The glyph aliases of library FUNCTIONS: `∫` (Integrate), `∑` (Sum), `∏`
// (Product). They fall inside the Unicode operator class, so this matcher
// must come before `OPERATOR`.
const BIG_OPERATOR = {
  className: 'built_in',
  match: /[\u222B\u2211\u220F]/,
};

// A run of script characters: a superscript exponent (`x²`, `xⁿ⁺¹`) or a
// subscript that is an expression rather than a name (`xₖ₊₁`, `(a+b)ₖ`). The
// lexer makes the run one `SUPERSCRIPT`/`SUBSCRIPT` token and the parser
// reads it as a postfix `Power`/`Subscript`, so it is styled with the
// operators. The matcher covers every script character: a subscript run of
// letters and digits that FOLLOWS a name never reaches it, because
// `IDENTIFIER_CHARACTERS` has already taken it as part of the name.
const SCRIPT = {
  className: 'operator',
  relevance: 0,
  match:
    /[\u00B2-\u00B3\u00B9\u02B0\u02B2-\u02B3\u02B7-\u02B8\u02E1-\u02E3\u1D43\u1D47-\u1D49\u1D4D\u1D4F-\u1D50\u1D52\u1D56-\u1D58\u1D5B\u1D62-\u1D65\u1D9C\u1DA0\u1DBB\u2070-\u2071\u2074-\u207B\u207D-\u208B\u208D-\u208E\u2090-\u2093\u2095-\u209C\u2C7C]+/,
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
// U+FD3E‥U+FD3F | U+FE45‥U+FE46 | the non-characters | then every SCRIPT
// character (`SUPERSCRIPT_UNICODE` and `SUBSCRIPT_UNICODE`), which
// `scanSymbol` stops at. Whether a subscript run then JOINS the name is
// decided per run, by `IDENTIFIER_CHARACTERS` below.
// A symbol: identifier characters, then optionally a subscript run — which
// joins the name ONLY when the whole maximal run is letters and digits
// (`xₙ` → `x_n`, `a₁₂` → `a_12`). A run that holds a sign anywhere is rolled
// back whole by `scanSymbol` and re-lexed as one SUBSCRIPT token, so
// `xₖ₊₁` is the name `x` followed by the script `ₖ₊₁`: the lookahead refuses
// a letter/digit run that a subscript sign follows, and the backtracking
// then refuses every shorter prefix of it too.
const IDENTIFIER_CHARACTERS = concat(
  IDENTIFIER_CHARACTER,
  IDENTIFIER_CHARACTER,
  '*',
  '(?:[',
  '\u1D62-\u1D65\u2080-\u2089\u2090-\u2093\u2095-\u209C\u2C7C',
  ']+(?![',
  '\u1D62-\u1D65\u2080-\u208B\u208D-\u208E\u2090-\u2093\u2095-\u209C\u2C7C',
  ']))?'
);

// A pragma is `#` followed by pragma characters (`scanHash` stops at the
// lexer's break rule, not at a script character — see `PRAGMA_CHARACTER`), so
// `#simplify+1` is the pragma `#simplify` followed by an operator, not one
// long pragma. `#!` on the first line is a shebang.
const META = {
  className: 'meta',
  variants: [
    { match: /^#!.*/ },
    { match: concat(/#/, PRAGMA_CHARACTER, PRAGMA_CHARACTER, '*') },
  ],
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
// operators — `|>`, `~>`, `->`, `=>`, `**`, `!=`, `%`, postfix `!` and the
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
        /[\u00A1-\u00A7\u00A9\u00AB\u00AC\u00AE\u00B0\u00B1\u00B6\u00BB\u00BF\u00D7\u00F7\u2010-\u203E\u2041-\u2053\u2190-\u2775\u2794-\u2C7B\u2C7D-\u2E7F\u3001-\u3003\u3008-\u3020\u3030\uFD3E\uFD3F\uFE45\uFE46]/,
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
      BIG_OPERATOR,
      SCRIPT,
      OPERATOR,
      BRACE,
      ...SYMBOLS,
    ],
  };
}
