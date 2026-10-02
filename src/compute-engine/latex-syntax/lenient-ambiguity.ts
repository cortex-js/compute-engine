import type { MathJsonExpression } from '../../math-json/types.js';
import {
  nops,
  operand,
  operands,
  operator,
  stringValue,
  symbol,
} from '../../math-json/utils.js';
import { SYMBOLS } from './dictionary/definitions-symbols.js';

/**
 * Reports of the lenient grammar for the reading choices that are visible
 * only in the whole line: the spelling of the tokens around an operator, the
 * start or the end of the line, or a pattern of digit groups.
 *
 * Each report is a parse diagnostic whose code starts with `ambiguous-`. A
 * report never changes the parse result. The caller runs these checks once,
 * after the parse of a line is complete, on the token stream of the adopted
 * parse and on its raw MathJSON result. Because the checks run after the
 * parse, the backtracking of the parser cannot emit a report twice or keep
 * a report of an abandoned branch.
 *
 * Every check reads only the tokens outside braces, so the content of
 * `\text{…}` or of a LaTeX argument is never reported. Most checks also
 * confirm the reading in the raw result (for example, that the result holds
 * a `NotEqual`), so a pattern of tokens that the parser read another way is
 * not reported.
 *
 * The reading choices and their codes are listed in
 * `docs/plans/2026-10-01-lenient-ambiguity-codes.md`.
 */

/** Record a diagnostic spanning the tokens `[startToken, endToken)`. */
export type EmitAmbiguity = (
  code: string,
  startToken: number,
  endToken: number,
  detail?: Record<string, unknown>
) => void;

const SPACE = '<space>';

const OPEN_TOKENS = new Set(['(', '[', '<{>', '\\{', '\\lbrace', '\\lparen']);
const CLOSE_TOKENS = new Set([')', ']', '<}>', '\\}', '\\rbrace', '\\rparen']);

function isDigit(t: string | undefined): boolean {
  return t !== undefined && t.length === 1 && t >= '0' && t <= '9';
}

/** True when the token `t` is one letter of any script: `x`, `π`, `θ`. */
export function isLetterToken(t: string | undefined): boolean {
  return t !== undefined && /^\p{L}$/u.test(t);
}

const isLetter = isLetterToken;

/** Lazy map from LaTeX command (e.g. '\\alpha') to its Unicode character.
 * Built once from the SYMBOLS table on first access. */
let _symbolToUnicode: Map<string, string> | null = null;
export function getSymbolToUnicode(): Map<string, string> {
  if (!_symbolToUnicode) {
    _symbolToUnicode = new Map();
    for (const [, latex, codepoint] of SYMBOLS) {
      _symbolToUnicode.set(latex, String.fromCodePoint(codepoint));
    }
  }
  return _symbolToUnicode;
}

/**
 * True when the token `t` can start an operand that a juxtaposition reads
 * as a factor: a Latin letter, a digit, a letter of another script (`π`,
 * `θ`) or a command for a letter (`\pi`, `\alpha`).
 */
export function isOperandStartToken(t: string | undefined): boolean {
  if (t === undefined) return false;
  if (/^[a-zA-Z0-9]$/.test(t) || isLetterToken(t)) return true;
  return getSymbolToUnicode().has(t);
}

// The opening and closing brackets that `matchingBracket()` pairs. A brace
// is the token `<{>` in a token stream and `{` in the normalized LaTeX of
// one token (`parser.latex(i, i + 1)`).
const MATCH_OPEN = new Set(['(', '[', '<{>', '{', '\\lbrack', '\\lparen']);
const MATCH_CLOSE = new Set([')', ']', '<}>', '}', '\\rbrack', '\\rparen']);

/**
 * The index of the bracket that matches the bracket at index `i`, or `-1`
 * when there is none. `at(k)` is the token at index `k` (`undefined` out of
 * range). For an opening bracket the search goes forward up to the index
 * `limit` (exclusive), for a closing bracket it goes backward to index 0.
 * Every kind of bracket counts for the nesting level: `(`, `[`, `{`,
 * `\lbrack` and `\lparen`, and their closing brackets.
 */
export function matchingBracket(
  at: (k: number) => string | undefined,
  i: number,
  limit = Infinity
): number {
  const t = at(i);
  if (t === undefined) return -1;
  const forward = MATCH_OPEN.has(t);
  if (!forward && !MATCH_CLOSE.has(t)) return -1;
  let level = 0;
  for (let k = i; forward ? k < limit : k >= 0; k += forward ? 1 : -1) {
    const tok = at(k);
    if (tok === undefined) return -1;
    if (MATCH_OPEN.has(tok)) level += forward ? 1 : -1;
    else if (MATCH_CLOSE.has(tok)) level += forward ? -1 : 1;
    if (level === 0) return k;
  }
  return -1;
}

/**
 * The index after the operand that starts at token `i`. Used to end the span
 * of a diagnostic after a whole operand instead of inside it:
 *
 * - a run of letters of the Latin alphabet (`pi` in `e^2pi`), or one letter
 *   of another script, or one command;
 * - a run of digits;
 * - a `^` or a `_` and its script: a braced group, or a run of digits, or
 *   an operand;
 * - a `/` and the operand after it;
 * - a bracket and what it holds, up to the matching bracket.
 *
 * Any other token is one token long. `at(k)` is the token at index `k`.
 */
export function operandEnd(
  at: (k: number) => string | undefined,
  i: number
): number {
  const t = at(i);
  if (t === undefined) return i;
  if (/^[a-zA-Z]$/.test(t)) {
    let k = i + 1;
    while (/^[a-zA-Z]$/.test(at(k) ?? '')) k += 1;
    return k;
  }
  if (isDigit(t)) {
    let k = i + 1;
    while (isDigit(at(k))) k += 1;
    return k;
  }
  if (t === '^' || t === '_' || t === '/') {
    let k = i + 1;
    if (t !== '/' && (at(k) === '-' || at(k) === '+')) k += 1;
    if (at(k) === undefined) return k;
    return operandEnd(at, k);
  }
  if (MATCH_OPEN.has(t)) {
    const close = matchingBracket(at, i);
    return close < 0 ? i + 1 : close + 1;
  }
  return i + 1;
}

function isCommand(t: string | undefined): boolean {
  return t !== undefined && /^\\[a-zA-Z]+$/.test(t);
}

/** True when the token can end an operand: `5`, `x`, `)`, `!`, `\pi`. */
function isOperandEnd(t: string | undefined): boolean {
  if (t === undefined) return false;
  return (
    isDigit(t) ||
    isLetter(t) ||
    isCommand(t) ||
    t === ')' ||
    t === ']' ||
    t === '<}>' ||
    t === '!' ||
    t === '|'
  );
}

/**
 * The bracket structure of the token stream.
 *
 * `segment[i]` identifies the run of tokens that token `i` belongs to: the
 * tokens between the same pair of brackets, and between the same two commas
 * or semicolons at that level. The tokens inside a nested bracket pair have
 * their own segment, and the tokens after the closing bracket return to the
 * segment of the opening bracket. Two operators with the same segment are
 * operands of the same chain: in `y = f(x) = 2` both `=` have the same
 * segment, in `1..10, 1..5` the two `..` do not.
 */
export type Layout = {
  segment: number[];
  depth: number[];
  inBraces: boolean[];
};

export function layoutOf(tokens: readonly string[]): Layout {
  const n = tokens.length;
  const segment = new Array<number>(n);
  const depth = new Array<number>(n);
  const inBraces = new Array<boolean>(n);
  const stack: { segment: number; brace: boolean }[] = [];
  let current = 0;
  let nextSegment = 1;
  let braces = 0;
  for (let i = 0; i < n; i++) {
    const t = tokens[i];
    if (OPEN_TOKENS.has(t)) {
      segment[i] = current;
      depth[i] = stack.length;
      inBraces[i] = braces > 0;
      const brace = t === '<{>' || t === '\\{' || t === '\\lbrace';
      stack.push({ segment: current, brace });
      if (brace) braces += 1;
      current = nextSegment++;
      continue;
    }
    if (CLOSE_TOKENS.has(t) && stack.length > 0) {
      const top = stack.pop()!;
      if (top.brace) braces -= 1;
      current = top.segment;
    }
    segment[i] = current;
    depth[i] = stack.length;
    inBraces[i] = braces > 0;
    if (t === ',' || t === ';') current = nextSegment++;
  }
  return { segment, depth, inBraces };
}

/** True when some node of `expr` (or `expr` itself) satisfies `pred`. */
function someNode(
  expr: MathJsonExpression | null | undefined,
  pred: (x: MathJsonExpression) => boolean
): boolean {
  if (expr === null || expr === undefined) return false;
  if (pred(expr)) return true;
  for (const x of operands(expr)) if (someNode(x, pred)) return true;
  return false;
}

/**
 * A standalone `=` token: not part of `<=`, `>=`, `!=`, `==`, `:=`, `+=`,
 * `-=`, `*=`, `/=`, `=<` or `=>`.
 */
function isStandaloneEqual(tokens: readonly string[], i: number): boolean {
  if (tokens[i] !== '=') return false;
  const prev = tokens[i - 1];
  if (prev !== undefined && '<>!=:+-*/~'.includes(prev)) return false;
  const next = tokens[i + 1];
  if (next !== undefined && '=<>'.includes(next)) return false;
  return true;
}

/** Group the token indexes by their segment (see `Layout`). */
function bySegment(indexes: number[], layout: Layout): Map<number, number[]> {
  const result = new Map<number, number[]>();
  for (const i of indexes) {
    const s = layout.segment[i];
    const group = result.get(s);
    if (group) group.push(i);
    else result.set(s, [i]);
  }
  return result;
}

/**
 * True when the tokens `[start, end)` are a label: an integer of one to
 * three digits (`1`, `12`), or a lowercase Roman numeral from 1 to 9 (`i`,
 * `ii`, `iv`, `v`, `ix`). When `letters` is true, one letter from `a` to `h`
 * is also a label (`a`, `b`). The letter `x` is never a label: alone in
 * parentheses, `(x)` is a variable, and a person rarely numbers ten items
 * with Roman numerals and pastes the tenth alone.
 */
function isLabelContent(
  tokens: readonly string[],
  start: number,
  end: number,
  letters: boolean
): boolean {
  if (end <= start) return false;
  const text = tokens.slice(start, end).join('');
  if (end - start !== text.length) return false;
  if (/^[0-9]{1,3}$/.test(text)) return true;
  if (letters && /^[a-h]$/.test(text)) return true;
  // A short lowercase Roman numeral, as in `(ii)` or `(iv)`.
  return /^(?:i{1,3}|iv|vi{0,3}|ix)$/.test(text);
}

/**
 * Report the reading choices of the lenient grammar that a check of the
 * whole line finds. `tokens` is the token stream of the adopted parse and
 * `expr` its raw MathJSON result. `skippedTail` is the text that the
 * trailing-noise recovery of the parse removed, if any.
 */
export function reportLineAmbiguities(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  skippedTail?: string
): void {
  const n = tokens.length;
  if (n === 0) return;
  const layout = layoutOf(tokens);
  const outside = (i: number) => !layout.inBraces[i];

  reportFactorial(tokens, expr, emit, outside);
  reportArrow(tokens, expr, emit, outside);
  reportEqualChain(tokens, expr, emit, layout);
  reportElement(tokens, expr, emit, layout);
  reportRange(tokens, expr, emit, layout, skippedTail);
  reportEquationNumber(tokens, expr, emit, outside);
  reportComma(tokens, expr, emit, layout);
  reportListLabel(tokens, emit, outside);
  reportNumberNotation(tokens, emit, outside);
  reportDate(tokens, emit, outside);
}

/**
 * `ambiguous-factorial`: `5!=120` is read as `5 ≠ 120`, and a person can
 * mean `5! = 120`. The `!=` follows an operand. It is not reported when
 * white space is on both sides of `!=` (`x != y`), which is the spelling of
 * "not equal" in programming languages.
 */
function reportFactorial(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  outside: (i: number) => boolean
): void {
  if (!someNode(expr, (x) => operator(x) === 'NotEqual')) return;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] !== '!' || tokens[i + 1] !== '=' || !outside(i)) continue;
    if (tokens[i + 2] === '=') continue;
    let p = i - 1;
    const spaceBefore = tokens[p] === SPACE;
    if (spaceBefore) p -= 1;
    if (!isOperandEnd(tokens[p])) continue;
    const spaceAfter = tokens[i + 2] === SPACE;
    if (spaceBefore && spaceAfter) continue;
    emit('ambiguous-factorial', i, i + 2);
  }
}

/**
 * `ambiguous-arrow`: `x <- 2` is read as `x < -2`, and a person can mean an
 * assignment arrow. The `-` directly follows the `<`.
 */
function reportArrow(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  outside: (i: number) => boolean
): void {
  if (!someNode(expr, (x) => operator(x) === 'Less')) return;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] !== '<' || tokens[i + 1] !== '-' || !outside(i)) continue;
    let p = i - 1;
    if (tokens[p] === SPACE) p -= 1;
    if (!isOperandEnd(tokens[p])) continue;
    emit('ambiguous-arrow', i, i + 2);
  }
}

/**
 * `ambiguous-equal-chain`: more than one `=` in a chain (`x = x = x`) is
 * read as nested equations, and a person can mean an assignment to several
 * names, or a chain of equal values. The span is from the first `=` to the
 * last `=` of the chain.
 */
function reportEqualChain(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  layout: Layout
): void {
  const nested = someNode(
    expr,
    (x) =>
      operator(x) === 'Equal' &&
      operands(x).some((y) => operator(y) === 'Equal')
  );
  if (!nested) return;
  const equals: number[] = [];
  for (let i = 0; i < tokens.length; i++)
    if (!layout.inBraces[i] && isStandaloneEqual(tokens, i)) equals.push(i);
  for (const group of bySegment(equals, layout).values()) {
    if (group.length < 2) continue;
    emit('ambiguous-equal-chain', group[0], group[group.length - 1] + 1);
  }
}

/**
 * `ambiguous-element`: `y = x in [0,1]` is read as `(y = x) ∈ [0,1]`, and a
 * person can mean the equation `y = x` restricted to `x ∈ [0,1]`. The left
 * operand of `in` (or `\in`, `∈`) is an equation. The span is the `in`.
 */
function reportElement(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  layout: Layout
): void {
  const read = someNode(
    expr,
    (x) => operator(x) === 'Element' && operator(operand(x, 1)) === 'Equal'
  );
  if (!read) return;
  for (let i = 0; i < tokens.length; i++) {
    if (layout.inBraces[i]) continue;
    let end = -1;
    if (tokens[i] === '\\in' || tokens[i] === '∈') end = i + 1;
    else if (
      tokens[i] === 'i' &&
      tokens[i + 1] === 'n' &&
      !isLetter(tokens[i - 1]) &&
      !isLetter(tokens[i + 2])
    )
      end = i + 2;
    if (end < 0) continue;
    // An equation is on the left: a standalone `=` in the same segment,
    // before the `in`.
    let equation = false;
    for (let j = i - 1; j >= 0; j--) {
      if (layout.segment[j] !== layout.segment[i]) continue;
      if (tokens[j] === ',' || tokens[j] === ';') break;
      if (isStandaloneEqual(tokens, j)) {
        equation = true;
        break;
      }
    }
    if (equation) emit('ambiguous-element', i, end);
  }
}

/**
 * `ambiguous-range`: a range with two `..`, such as `1..10..2`, is read as
 * first, second and last values, and a person can mean first value, last
 * value and step. The span is from the first `..` to the end of the second.
 *
 * When the trailing-noise recovery removed a final `.` (`1..3..` is parsed
 * as `1..3.`), the `.` left at the end of the token stream counts as the
 * second `..`.
 */
function reportRange(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  layout: Layout,
  skippedTail: string | undefined
): void {
  if (!someNode(expr, (x) => operator(x) === 'Range')) return;
  const n = tokens.length;
  const pairs: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (layout.inBraces[i]) continue;
    if (
      tokens[i] === '.' &&
      tokens[i + 1] === '.' &&
      tokens[i - 1] !== '.' &&
      tokens[i + 2] !== '.'
    )
      pairs.push(i);
  }
  const trailingDot =
    skippedTail?.trim() === '.' &&
    tokens[n - 1] === '.' &&
    tokens[n - 2] !== '.' &&
    !layout.inBraces[n - 1];
  if (trailingDot) pairs.push(n - 1);
  // A range with one `..` next to an operation, such as `1..5/2` or
  // `2*1..5`, has two readings: the operation on one bound (the range from 1
  // to 5/2) and the operation on the whole range (`(1..5)/2`, the way Desmos
  // scales a list). It is reported when a `Range` of the raw result has a
  // bound that is not a number or a name, or is itself an operand of an
  // arithmetic operation (the raw result seen here can group the operation
  // either way).
  const compoundBound = someNode(
    expr,
    (x) =>
      (operator(x) === 'Range' &&
        operands(x).some((op) => Array.isArray(op) && !isNumberLiteral(op))) ||
      (RANGE_ARITHMETIC.has(operator(x) ?? '') &&
        operands(x).some((op) => operator(op) === 'Range'))
  );
  for (const group of bySegment(pairs, layout).values()) {
    if (group.length < 2) {
      if (compoundBound && group[0] !== n - 1)
        emit('ambiguous-range', group[0], Math.min(n, group[0] + 2));
      continue;
    }
    const last = group[group.length - 1];
    emit('ambiguous-range', group[0], Math.min(n, last + 2));
  }
}

/** The arithmetic operations that can apply to a whole range. `Negate` is
 * not one: `-1..5` is the range from -1 to 5, and `-(1..5)` is not a common
 * reading of it. */
const RANGE_ARITHMETIC = new Set([
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Power',
  'InvisibleOperator',
]);

/** True for a MathJSON number written as an array, such as `["Rational", 1, 2]`
 * or a negative number `["Negate", 2]`: a bound that is still one number. */
function isNumberLiteral(x: MathJsonExpression): boolean {
  if (!Array.isArray(x)) return false;
  const h = x[0];
  if (h === 'Rational') return true;
  if (h === 'Negate' && x.length === 2)
    return (
      typeof x[1] === 'number' ||
      (typeof x[1] === 'object' && x[1] !== null && 'num' in x[1])
    );
  return false;
}

// White space, and the LaTeX spacing commands that separate an equation from
// its label (`y = x \quad (2)`).
const SPACING_TOKENS = new Set([
  SPACE,
  '\\quad',
  '\\qquad',
  '\\,',
  '\\:',
  '\\;',
  '\\ ',
  '\\enspace',
]);

/**
 * `ambiguous-equation-number`: a parenthesized number or single letter at
 * the end of the line, after white space (`y = x^2 (2)`, `x = 4 (m)`), is
 * read as a factor of a product, and a person can mean an equation label or
 * a unit. The result must hold that product: `sin (2)` is the function
 * call, and `y = (2)` has no product, so neither is reported.
 */
function reportEquationNumber(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  outside: (i: number) => boolean
): void {
  let k = tokens.length - 1;
  while (k >= 0 && tokens[k] === SPACE) k -= 1;
  if (k < 0 || tokens[k] !== ')' || !outside(k)) return;
  let j = k - 1;
  while (j >= 0 && tokens[j] !== '(' && tokens[j] !== ')') j -= 1;
  if (j < 1 || tokens[j] !== '(') return;
  if (!SPACING_TOKENS.has(tokens[j - 1]) || j - 2 < 0) return;

  // The content is a number (`2`, `1.2`) or one letter (`a`, `\alpha`).
  let a = j + 1;
  let b = k;
  while (a < b && tokens[a] === SPACE) a += 1;
  while (b > a && tokens[b - 1] === SPACE) b -= 1;
  const text = tokens.slice(a, b).join('');
  const isNumber = /^[0-9]+(?:\.[0-9]+)?$/.test(text) && b - a === text.length;
  const isOneLetter = b - a === 1 && (isLetter(text) || isCommand(text));
  if (!isNumber && !isOneLetter) return;

  // The last factor of the product at the end of the result is that group.
  let node: MathJsonExpression | null = expr;
  while (node !== null) {
    const h = operator(node);
    if (h === '' || h === 'Delimiter') return;
    const ops = operands(node);
    const last = ops[ops.length - 1] ?? null;
    if (
      h === 'InvisibleOperator' &&
      operator(last) === 'Delimiter' &&
      nops(last) === 1
    ) {
      emit('ambiguous-equation-number', j, k + 1);
      return;
    }
    node = last;
  }
}

/**
 * `ambiguous-comma`: a comma outside every bracket (`1,5`) is read as a
 * separator of a sequence, and in many locales a person means the decimal
 * number 1.5. Each such comma is reported. A comma inside brackets
 * (`f(x, y)`, `(1, 2)`, `[0,1]`) or inside braces (`1{,}5`) is not.
 */
function reportComma(
  tokens: readonly string[],
  expr: MathJsonExpression | null,
  emit: EmitAmbiguity,
  layout: Layout
): void {
  if (operator(expr) !== 'Delimiter') return;
  if (stringValue(operand(expr, 2))?.includes(',') !== true) return;
  for (let i = 0; i < tokens.length; i++)
    if (tokens[i] === ',' && layout.depth[i] === 0)
      emit('ambiguous-comma', i, i + 1);
}

/**
 * `ambiguous-list-label`: the label of an item of a numbered list, read as
 * math.
 *
 * - An integer and a period followed by white space and more (`1. y = x`,
 *   `10. 5`, `x = 1. 5`), or a line that is only an integer and a period
 *   (`1.`). The span is the integer and the period.
 * - A line that is only a parenthesized or bracketed label of digits or a
 *   Roman numeral: `(1)`, `(i)`, `(iv)`, `[1]`. A line that is only a letter
 *   in brackets (`(x)`, `[a]`) is not reported.
 * - A parenthesized label at the start of the line, followed by white space
 *   and a letter or a digit (`(1) y = x`, `(a) y = x`), or a label and a
 *   closing parenthesis with no opening parenthesis (`1) y = x`,
 *   `a) y = x`). A letter label is one of `a` to `h`.
 *
 * See `isLabelContent()` for the text that is a label.
 */
function reportListLabel(
  tokens: readonly string[],
  emit: EmitAmbiguity,
  outside: (i: number) => boolean
): void {
  const n = tokens.length;
  let first = 0;
  while (first < n && tokens[first] === SPACE) first += 1;
  let last = n - 1;
  while (last >= 0 && tokens[last] === SPACE) last -= 1;
  if (first > last) return;

  // An integer and a period, anywhere in the line.
  for (let s = 0; s < n; s++) {
    if (!isDigit(tokens[s]) || !outside(s)) continue;
    const prev = tokens[s - 1];
    if (
      isDigit(prev) ||
      isLetter(prev) ||
      prev === '.' ||
      prev === '_' ||
      prev === '^'
    )
      continue;
    let e = s;
    while (isDigit(tokens[e])) e += 1;
    if (tokens[e] !== '.' || tokens[e + 1] === '.' || isDigit(tokens[e + 1])) {
      s = e;
      continue;
    }
    const onlyLabel = s === first && e === last;
    const followed = tokens[e + 1] === SPACE && e + 1 < last;
    if (onlyLabel || followed) emit('ambiguous-list-label', s, e + 1);
    s = e;
  }

  // A line that is only a label: `(1)`, `(i)`, `(a)`, `[1]`, `[a]`. A
  // pasted line that is only a parenthesized letter from `a` to `h` is
  // more often the label of a list item than a variable.
  const closeOf: Record<string, string> = { '(': ')', '[': ']' };
  if (
    closeOf[tokens[first]] !== undefined &&
    tokens[last] === closeOf[tokens[first]] &&
    isLabelContent(tokens, first + 1, last, true)
  ) {
    emit('ambiguous-list-label', first, last + 1);
    return;
  }

  // A parenthesized label at the start of the line, then more.
  if (tokens[first] === '(') {
    let c = first + 1;
    while (c < n && tokens[c] !== ')' && tokens[c] !== '(') c += 1;
    if (tokens[c] === ')' && isLabelContent(tokens, first + 1, c, true)) {
      const after = tokens[c + 2];
      if (tokens[c + 1] === SPACE && (isLetter(after) || isDigit(after)))
        emit('ambiguous-list-label', first, c + 1);
    }
    return;
  }

  // A label and a closing parenthesis with no opening parenthesis: `1)`,
  // `a)`.
  let c = first;
  while (c < n && tokens[c] !== ')' && tokens[c] !== SPACE) c += 1;
  // A letter is a label only when more follows the `)`.
  if (tokens[c] === ')' && isLabelContent(tokens, first, c, c < last))
    emit('ambiguous-list-label', first, c + 1);
}

/**
 * `ambiguous-number-notation`: a notation of a programming language for a
 * number. `1_000` (digit grouping) is read as a subscript and a product,
 * `0x10` (hexadecimal) as `0·x_10`. The span is the whole notation.
 */
function reportNumberNotation(
  tokens: readonly string[],
  emit: EmitAmbiguity,
  outside: (i: number) => boolean
): void {
  const n = tokens.length;
  for (let s = 0; s < n; s++) {
    if (!isDigit(tokens[s]) || !outside(s)) continue;
    const prev = tokens[s - 1];
    if (
      isDigit(prev) ||
      isLetter(prev) ||
      prev === '.' ||
      prev === '_' ||
      prev === '^' ||
      isCommand(prev)
    )
      continue;

    // Hexadecimal: `0x` and at least one hexadecimal digit.
    if (tokens[s] === '0' && tokens[s + 1] === 'x') {
      let e = s + 2;
      while (e < n && /^[0-9a-fA-F]$/.test(tokens[e])) e += 1;
      if (e > s + 2) {
        emit('ambiguous-number-notation', s, e, { notation: 'hexadecimal' });
        s = e - 1;
        continue;
      }
    }

    // Digit groups joined by `_`: `1_000`, `1_000_000`.
    let e = s;
    while (isDigit(tokens[e])) e += 1;
    let groups = 0;
    while (tokens[e] === '_' && isDigit(tokens[e + 1])) {
      e += 1;
      while (isDigit(tokens[e])) e += 1;
      groups += 1;
    }
    if (groups > 0)
      emit('ambiguous-number-notation', s, e, { notation: 'digit-grouping' });
    s = e - 1;
  }
}

// The tokens that can be on the left (`BEFORE`) or on the right (`AFTER`) of
// a date or a phone number. An operator such as `+`, `*`, `^` or a letter
// next to the digit groups makes the text arithmetic (`10-20x`, `2^10-20`).
// A parenthesis next to the groups is allowed only for three or more groups
// (see `reportDate()`).
const DATE_BEFORE = new Set([SPACE, '=', '(', '[', ',', ';', ':', '<', '>']);
const DATE_AFTER = new Set([SPACE, '=', ')', ']', ',', ';', ':', '<', '>']);

/**
 * `ambiguous-date`: groups of digits joined by `-` or `/` with no white
 * space, read as a difference or a quotient, where a person can mean a date,
 * a phone number or a range.
 *
 * - Three or more groups joined by the same separator: `2026-10-15`,
 *   `9/30/2026`, `1-800-555-1234`.
 * - Two groups joined by `-` when the second group has two or more digits
 *   and either is greater than the first (`7-11`, `10-20`, `1999-2000`,
 *   `555-1234`: a range or a phone number), or one of the groups starts
 *   with a `0` (`555-0123`). A difference such as `2-1` or `100-20` is not
 *   reported.
 *   Two groups next to a parenthesis (`x = (1-10)`) are not reported.
 * - Two groups joined by `/` are a fraction (`3/4`, `24/7`) and are not
 *   reported.
 */
function reportDate(
  tokens: readonly string[],
  emit: EmitAmbiguity,
  outside: (i: number) => boolean
): void {
  const n = tokens.length;
  for (let s = 0; s < n; s++) {
    if (!isDigit(tokens[s]) || !outside(s)) continue;
    if (isDigit(tokens[s - 1])) continue;
    const prev = tokens[s - 1];
    const groups: string[] = [];
    let e = s;
    let sep: string | undefined;
    for (;;) {
      const g = e;
      while (isDigit(tokens[e])) e += 1;
      groups.push(tokens.slice(g, e).join(''));
      const t = tokens[e];
      if ((t === '-' || t === '/') && (sep === undefined || sep === t)) {
        if (!isDigit(tokens[e + 1])) break;
        sep = t;
        e += 1;
        continue;
      }
      break;
    }
    const next = tokens[e];
    const skipTo = e - 1;
    if (
      groups.length < 2 ||
      (prev !== undefined && !DATE_BEFORE.has(prev)) ||
      (next !== undefined && !DATE_AFTER.has(next))
    ) {
      s = skipTo;
      continue;
    }
    let report = groups.length >= 3;
    // Two groups in parentheses are more often a difference: `x = (1-10)`.
    const inParentheses = prev === '(' || next === ')';
    if (!report && sep === '-' && !inParentheses) {
      const [a, b] = groups;
      const leadingZero = (g: string) => g.length > 1 && g.startsWith('0');
      report =
        b.length >= 2 &&
        (Number(b) > Number(a) || leadingZero(a) || leadingZero(b));
    }
    if (report) emit('ambiguous-date', s, e);
    s = skipTo;
  }
}

/**
 * True when `expr` is a parenthesized single name: `(x)`, `(θ)`, `(alpha)`,
 * `(x_1)` or `((x))`.
 */
function isParenthesizedName(expr: MathJsonExpression | null): boolean {
  if (operator(expr) !== 'Delimiter' || nops(expr) !== 1) return false;
  let inner = operand(expr, 1);
  while (operator(inner) === 'Delimiter' && nops(inner) === 1)
    inner = operand(inner, 1);
  if (symbol(inner) !== null) return true;
  return operator(inner) === 'Subscript' && symbol(operand(inner, 1)) !== null;
}

/**
 * True when `lhs` juxtaposed with `rhs` is a parenthesized single name
 * followed by a parenthesized group with a comma, as in `(x)(1,2)` or
 * `(t)(cos t, sin t)`: the product of a scalar and a point, where a person
 * can mean a call. `lhs` can be a product whose last factor is the name.
 * Used for the `ambiguous-group-product` code.
 */
export function isGroupProductShape(
  lhs: MathJsonExpression,
  rhs: MathJsonExpression
): boolean {
  const left =
    operator(lhs) === 'InvisibleOperator'
      ? (operands(lhs).at(-1) ?? null)
      : lhs;
  if (!isParenthesizedName(left)) return false;
  if (operator(rhs) !== 'Delimiter') return false;
  if (stringValue(operand(rhs, 2)) !== '(,)') return false;
  const body = operand(rhs, 1);
  return operator(body) === 'Sequence' && nops(body) >= 2;
}

/**
 * The index of the `(` that opens the group which ends just before token
 * `end` (white space before `end` is skipped), or `-1` if the tokens before
 * `end` are not a parenthesized group.
 */
export function openingParenthesisBefore(
  tokens: readonly string[],
  end: number
): number {
  let i = end - 1;
  while (i >= 0 && tokens[i] === SPACE) i -= 1;
  if (tokens[i] !== ')') return -1;
  const open = matchingBracket((k) => tokens[k], i);
  return open >= 0 && tokens[open] === '(' ? open : -1;
}

/**
 * `ambiguous-percent`: in the text before a `%` that started a discarded
 * comment, the number that the `%` follows, as an offset range of `text`.
 * `y = 50%` gives the range of `50`. Returns `null` when no number is
 * directly before the `%` (white space between them is allowed).
 */
export function numberBeforePercent(
  text: string
): [start: number, end: number] | null {
  const m = text.match(/(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)\s*$/);
  if (m === null || m.index === undefined) return null;
  const before = text[m.index - 1];
  // A digit of a subscript or a name (`x_5%`, `a5%`) is not a number.
  if (before !== undefined && /[\p{L}_^\\]/u.test(before)) return null;
  return [m.index, m.index + m[0].trimEnd().length];
}
