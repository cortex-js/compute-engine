//
// Reserved words, in two tiers.
//
// `RESERVED_WORDS` is the *documented* list (mirrored by `docs/literals.md`,
// pinned by `test/epsil/reserved-words.test.ts`): words the language reserves
// the right to claim later. Most of them are **not** claimed today, and per the
// reservation policy — future words should be contextual wherever possible,
// following the precedent of `type`/`alias` — they are ordinary identifiers
// until their construct exists.
//
// `HARD_RESERVED_WORDS` is the set a plain (non-verbatim) symbol may NOT spell.
// It holds only the words the grammar actually consumes today:
//
//   - `LITERAL_WORDS` — the boolean and non-finite numeric literals. They can
//     never name a binding, in any position, because the token is a literal.
//   - `ACTIVE_WORDS` — the heads and word operators the parser claims. They are
//     rejected in expression position so a keyword used out of place
//     (`y = while`) reports `reserved-word` rather than silently becoming an
//     undeclared symbol.
//
// A word moves from the first tier to the second exactly when its construct
// lands. Everything else — `set`, `with`, `label`, `where`, `to`, `each`, … —
// is usable as an identifier in every position: a binding name, a bare
// assignment target, a mapsto parameter, and a call's callee.
//
// The verbatim form (`` `word` ``) always spells any of them.
//

/**
 * The reserved words that are LITERALS: they cannot name a binding (the
 * verbatim `` `word` `` form still can). `true`/`false` are the boolean
 * literals; `Infinity`, its input alias `oo`, and `NaN` are the non-finite
 * numeric literals.
 */
export const LITERAL_WORDS: ReadonlySet<string> = new Set<string>([
  'true',
  'false',
  'Infinity',
  'oo',
  'NaN',
]);

/**
 * The words the grammar consumes today: statement/expression heads (`if`,
 * `match`, `do`, `for`, `while`, `function`, `const`), the `else` clause
 * separator, the loop separator and membership operator `in`, and the loop
 * control transfers `break`/`continue`.
 *
 * `let`, `type`, and `alias` are deliberately absent: they are already
 * contextual (`let type = 5` and `type = 5` both parse), so they are not
 * reserved words at all.
 */
export const ACTIVE_WORDS: ReadonlySet<string> = new Set<string>([
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
]);

/**
 * The words a plain symbol may not spell — the union of `LITERAL_WORDS` and
 * `ACTIVE_WORDS`. This is the set the parser rejects and the serializer emits
 * in the verbatim form.
 */
export const HARD_RESERVED_WORDS: ReadonlySet<string> = new Set<string>([
  ...LITERAL_WORDS,
  ...ACTIVE_WORDS,
]);

/**
 * Every word the language reserves the right to claim. Only the members of
 * `HARD_RESERVED_WORDS` are rejected today; the rest are ordinary identifiers
 * (see the module comment). Mirrored by `docs/literals.md`.
 */
export const RESERVED_WORDS = new Set<string>([
  'abstract', // Not in use
  'at', // Not in use
  'and', // Not in use
  'as', // Not in use
  'async', // Not in use
  'assert', // Not in use
  'await', // Not in use
  'begin', // Not in use
  'break', // ACTIVE — loop control transfer
  'case', // Not in use
  'catch', // Not in use
  'class', // Not in use
  'const', // ACTIVE — immutable declaration head
  'continue', // ACTIVE — loop control transfer
  'debugger', // Not in use
  'default', // Not in use
  'delete', // Not in use
  'dynamic', // Not in use
  'do', // ACTIVE — block-expression head: `do { … }` (parser `parseDoBlock`)
  'each', // Not in use
  'else', // ACTIVE — `if`/conditional-expression clause separator
  'end', // Not in use
  'export', // Not in use
  'extern', // Not in use
  'false', // LITERAL — parsed as the `False` symbol
  'finally', // Not in use
  'for', // ACTIVE — collection loop head
  'from', // Not in use
  'function', // ACTIVE — block-style function definition head
  'generator', // Not in use
  'get', // Not in use
  'global', // Not in use
  'goto', // Not in use
  'if', // ACTIVE — conditional head and conditional-expression infix
  'in', // ACTIVE — membership operator and loop separator
  'Infinity', // LITERAL — numeric literal (+∞); `oo` is an input alias
  'inline', // Not in use
  'interface', // Not in use
  'internal', // Not in use
  'import', // Not in use
  'iterator', // Not in use
  'label', // Not in use
  'lazy', // Not in use
  'local', // Not in use
  'loop', // Not in use
  'match', // ACTIVE — match-expression head (parser `parseMatch`)
  'module', // Not in use
  'namespace', // Not in use
  'NaN', // LITERAL — numeric literal (Not a Number)
  'native', // Not in use
  'new', // Not in use
  'not', // Not in use
  'of', // Not in use
  'on', // Not in use
  'oo', // LITERAL — numeric literal, input alias for `Infinity`
  'optional', // Not in use
  'or', // Not in use
  'package', // Not in use
  'parallel', // Not in use
  'private', // Not in use
  'protected', // Not in use
  'protocol', // Not in use
  'public', // Not in use
  'repeat', // Not in use
  'return', // Not in use
  'self', // Not in use
  'set', // Not in use
  'static', // Not in use
  'super', // Not in use
  'switch', // Not in use
  'this', // Not in use
  'throw', // Not in use
  'to', // Not in use
  'true', // LITERAL — parsed as the `True` symbol
  'try', // Not in use
  'union', // Not in use
  'until', // Not in use
  'using', // Not in use
  'var', // Not in use
  'variant', // Not in use
  'warn', // Not in use
  'when', // Not in use
  'where', // Not in use
  'while', // ACTIVE — conditional loop head
  'with', // Not in use
  'xor', // Not in use
  'yield', // Not in use
]);
