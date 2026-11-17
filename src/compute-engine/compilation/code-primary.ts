// A reading of emitted code: whether a piece of code is a primary
// expression, which an operator can take as its operand with no parentheses.

/**
 * The words that start a statement or apply a prefix operator. An identifier
 * that is one of them is not the start of a primary: `typeof(x).length` is
 * `typeof ((x).length)`, and `not(x)` (a word operator of a target) is
 * `not x`.
 */
const KEYWORDS: ReadonlySet<string> = new Set([
  'and',
  'async',
  'await',
  'break',
  'case',
  'class',
  'const',
  'continue',
  'delete',
  'do',
  'else',
  'for',
  'function',
  'if',
  'in',
  'instanceof',
  'lambda',
  'let',
  'new',
  'not',
  'of',
  'or',
  'return',
  'switch',
  'throw',
  'typeof',
  'var',
  'void',
  'while',
  'yield',
]);

// A name in emitted code can hold any letter, mark or digit of Unicode, `_`
// and `$` (a user's symbol `α`, `x_1`, `$t`), so every test of a name is
// Unicode-aware: an ASCII test sees the end of a name inside `doα`.
const IDENTIFIER = /[\p{L}_$][\p{L}\p{M}\p{N}\p{Pc}$\u200c\u200d]*/uy;
const NUMBER =
  /(?:0[xXbBoO][\p{N}a-fA-F_]+|(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)[a-zA-Z]*/uy;
const IDENTIFIER_CHAR = /[\p{L}\p{M}\p{N}\p{Pc}$\u200c\u200d]/u;

/**
 * The longest code that `isPrimaryCode()` reads. The compiler writes the code
 * of a nested expression level by level, and a bound on each scan keeps the
 * compilation of a deep nest linear in its depth. Longer code is not a
 * primary, so it is put in parentheses.
 */
const MAX_PRIMARY_LENGTH = 256;

/**
 * The index of the bracket that closes the one at `open` in `text`, or `-1`
 * when the scan cannot tell.
 *
 * The scan reads the code of the C family that the targets write
 * (JavaScript, GLSL): it counts the three kinds of brackets and skips the
 * string literals quoted with `'` or `"`. It answers `-1`, and so never
 * names a wrong bracket, for a bracket that is not closed or is closed by
 * one of another kind, and for the text in which a bracket may be part of
 * something it does not read: a template literal, a comment, or a `/` that
 * may start a regular expression (after an operator, an opening bracket, a
 * keyword such as `return`, or at the start).
 */
export function closingBracket(text: string, open: number): number {
  const first = text.charCodeAt(open);
  if (first !== 0x28 && first !== 0x5b && first !== 0x7b) return -1;
  // The closing bracket that each open bracket expects: `)` is `(` + 1, `]`
  // and `}` are `[` and `{` + 2.
  const stack: number[] = [];
  for (let i = open; i < text.length; i++) {
    const c = text.charCodeAt(i);
    switch (c) {
      case 0x28: // (
        stack.push(0x29);
        break;
      case 0x5b: // [
      case 0x7b: // {
        stack.push(c + 2);
        break;
      case 0x29: // )
      case 0x5d: // ]
      case 0x7d: // }
        if (stack.pop() !== c) return -1;
        if (stack.length === 0) return i;
        break;
      case 0x22: // "
      case 0x27: // '
        i = stringEnd(text, i);
        if (i < 0) return -1;
        break;
      case 0x60: // `
        return -1;
      case 0x2f: {
        // /
        const next = text.charCodeAt(i + 1);
        if (next === 0x2f || next === 0x2a) return -1;
        if (mayStartRegex(text, i)) return -1;
        break;
      }
    }
  }
  return -1;
}

/** The index of the quote that ends the string literal that starts at
 * `start`, or `-1` when it is not closed on the same line. */
function stringEnd(text: string, start: number): number {
  const quote = text[start];
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === quote) return i;
    else if (c === '\n' || c === '\r') return -1;
  }
  return -1;
}

/** Whether the `/` at `i` may start a regular expression: it is not after
 * an operand (a name, a number, a closing bracket) or it is after a keyword.
 * A keyword that cannot precede a regular expression only makes the answer
 * more cautious. */
function mayStartRegex(text: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  if (j < 0) return true;
  const p = text[j];
  if (p === ')' || p === ']') return false;
  if (!IDENTIFIER_CHAR.test(p)) return true;
  let k = j;
  while (k > 0 && IDENTIFIER_CHAR.test(text[k - 1])) k -= 1;
  return KEYWORDS.has(text.slice(k, j + 1));
}

/**
 * Whether `code`, an expression written for a target of the C family
 * (JavaScript, GLSL), is a primary expression: an operator binds it as a
 * whole, so it needs no parentheses as an operand.
 *
 * A primary is an atom followed by any number of member reads (`.name`),
 * index reads (`[…]`) and calls (`(…)`). An atom is a name that is not a
 * keyword, a number literal with no sign, a string literal, or a group in
 * parentheses or brackets. Thus `_.x`, `Math.cos(_.x)`, `f(a)(b)`,
 * `vec2(a, b).x`, `[a, b]`, `(a + b)` and `(() => { … })()` are primaries;
 * `-1`, `a + b`, `c ? a : b`, `x => x`, `typeof x` and `{ re: 1 }` are not.
 *
 * The reading is conservative: it answers `false` when it cannot tell
 * (`closingBracket()`) and for code longer than `MAX_PRIMARY_LENGTH`, and
 * parentheses around a primary change nothing.
 */
export function isPrimaryCode(code: string): boolean {
  if (code.length > MAX_PRIMARY_LENGTH) return false;
  const text = code.trim();
  const n = text.length;
  if (n === 0) return false;
  let pos: number;
  const c = text[0];
  if (c === '(' || c === '[') {
    pos = closingBracket(text, 0) + 1;
    if (pos === 0) return false;
  } else if (c === '"' || c === "'") {
    pos = stringEnd(text, 0) + 1;
    if (pos === 0) return false;
  } else {
    IDENTIFIER.lastIndex = 0;
    if (IDENTIFIER.test(text)) {
      if (KEYWORDS.has(text.slice(0, IDENTIFIER.lastIndex))) return false;
      pos = IDENTIFIER.lastIndex;
    } else {
      NUMBER.lastIndex = 0;
      if (!NUMBER.test(text)) return false;
      pos = NUMBER.lastIndex;
    }
  }
  while (pos < n) {
    const d = text[pos];
    if (d === '.') {
      IDENTIFIER.lastIndex = pos + 1;
      if (!IDENTIFIER.test(text)) return false;
      pos = IDENTIFIER.lastIndex;
    } else if (d === '(' || d === '[') {
      const close = closingBracket(text, pos);
      if (close < 0) return false;
      pos = close + 1;
    } else return false;
  }
  return true;
}

/** Code that starts a statement, which an operand never is: a caller that
 * tests for it (`compileValueOperand()`) must still see it. The keyword is a
 * whole name: `doα` is a name, not `do`. */
const STATEMENT_START =
  /^\s*(?:return|break|continue|if|for|while|do|switch|const|let|var|throw)(?![\p{L}\p{M}\p{N}\p{Pc}$\u200c\u200d])/u;

/**
 * `code` written as the operand of an operator of precedence `prec`: in
 * parentheses, unless it is a primary (`isPrimaryCode()`) or `prec` is `0`
 * (no operator).
 *
 * For the code of a head with no infix spelling, which a handler or a
 * selection writes as it chooses (`(1 - Math.cos(x)) / 2` for a haversine,
 * the bare code of the selected branch of an `If`), so that the operator
 * around it does not bind to a part of it. Empty code and code that starts
 * a statement are returned as they are.
 */
export function operandCode(code: string, prec: number): string {
  if (prec <= 0 || !/\S/.test(code) || STATEMENT_START.test(code)) return code;
  if (isPrimaryCode(code)) return code;
  // A line comment in the code (`a + 1 // note`, or `//` in a string, which
  // is not told apart) would also comment out a closing parenthesis on its
  // line.
  return code.includes('//') ? `(${code}\n)` : `(${code})`;
}
