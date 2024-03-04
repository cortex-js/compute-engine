import {
  Expression,
  MathJsonFunction,
  MathJsonIdentifier,
  MathJsonNumber,
  MathJsonString,
  MathJsonSymbol,
} from './math-json-format';

export const MISSING: Expression = ['Error', "'missing'"];

export function isNumberExpression(
  expr: Expression | null
): expr is number | string | MathJsonNumber {
  if (typeof expr === 'number' || isNumberObject(expr)) return true;
  if (typeof expr === 'string' && /^[+-]?[0-9\.]/.test(expr)) return true;
  return false;
}

export function isNumberObject(
  expr: Expression | null
): expr is MathJsonNumber {
  return expr !== null && typeof expr === 'object' && 'num' in expr;
}

export function isSymbolObject(
  expr: Expression | null
): expr is MathJsonSymbol {
  return expr !== null && typeof expr === 'object' && 'sym' in expr;
}

export function isStringObject(
  expr: Expression | null
): expr is MathJsonString {
  return expr !== null && typeof expr === 'object' && 'str' in expr;
}

export function isFunctionObject(
  expr: Expression | null
): expr is MathJsonFunction {
  return expr !== null && typeof expr === 'object' && 'fn' in expr;
}

export function isDictionaryObject(expr: Expression): expr is MathJsonNumber {
  return expr !== null && typeof expr === 'object' && 'dict' in expr;
}

let recommendedScriptsRegex: RegExp;

function isRecommendedScripts(text: string): boolean {
  if (!recommendedScriptsRegex) {
    // Define the recommended script property notation from UAX#31Table 5
    // https://www.unicode.org/reports/tr31/#Table_Recommended_Scripts
    const recommendedScripts = [
      'Zyyy',
      'Zinh',
      'Arab',
      'Armn',
      'Beng',
      'Bopo',
      'Cyrl',
      'Deva',
      'Ethi',
      'Geor',
      'Grek',
      'Gujr',
      'Guru',
      'Hang',
      'Hani',
      'Hebr',
      'Hira',
      'Kana',
      'Knda',
      'Khmr',
      'Laoo',
      'Latn',
      'Mlym',
      'Mymr',
      'Orya',
      'Sinh',
      'Taml',
      'Telu',
      'Thaa',
      'Thai',
      'Tibt',
    ];

    // Combine the recommended script properties into a single regex pattern
    const regexPattern = `^[${recommendedScripts
      .map((x) => `\\p{Script=${x}}`)
      .join('')}]*$`;

    // Test if the input text contains only characters from the
    // recommended scripts
    recommendedScriptsRegex = new RegExp(regexPattern, 'u');
  }
  return recommendedScriptsRegex.test(text);
}

// Return true if the string is a valid identifier.
// Check for identifiers matching a profile of [Unicode UAX31]
// (https://unicode.org/reports/tr31/)
// See https://cortexjs.io/math-json/#identifiers for a full definition of the
// profile.

export function isValidIdentifier(s: string): boolean {
  // Quick check for simple identifiers
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) return true;

  // Is it an emoji, with possibly a ZWJ sequence, as in 👨🏻‍🎤,
  // or flags, or characters that are legacy non-presentation emoji
  // (like the sunglass emoji)?
  if (ONLY_EMOJIS.test(s)) return true;

  // Only consider recommended scripts
  if (!isRecommendedScripts(s)) return false;

  // Non-ASCII identifiers
  return /^[\p{XIDS}_]\p{XIDC}*$/u.test(s);
}

const VS16 = '\\u{FE0F}'; // Variation Selector-16, forces emoji presentation
const KEYCAP = '\\u{20E3}'; // Combining Enclosing Keycap
const ZWJ = '\\u{200D}'; // Zero Width Joiner

const FLAG_SEQUENCE = '\\p{RI}\\p{RI}';

const TAG_MOD = `(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})`;
const EMOJI_MOD = `(?:\\p{EMod}|${VS16}${KEYCAP}?|${TAG_MOD})`;
const EMOJI_NOT_IDENTIFIER = `(?:(?=\\P{XIDC})\\p{Emoji})`;
const ZWJ_ELEMENT = `(?:${EMOJI_NOT_IDENTIFIER}${EMOJI_MOD}*|\\p{Emoji}${EMOJI_MOD}+|${FLAG_SEQUENCE})`;
const POSSIBLE_EMOJI = `(?:${ZWJ_ELEMENT})(${ZWJ}${ZWJ_ELEMENT})*`;
const SOME_EMOJI = new RegExp(`(?:${POSSIBLE_EMOJI})+`, 'u');
export const ONLY_EMOJIS = new RegExp(`^(?:${POSSIBLE_EMOJI})+$`, 'u');

// Examine the string and return a string indicating if it's a valid identifier,
// and if not, why not.
// Useful for debugging. In production, use `isValidIdentifier()` instead.
export function validateIdentifier(
  s: unknown
):
  | 'valid'
  | 'not-a-string'
  | 'empty-string'
  | 'expected-nfc'
  | 'unexpected-mixed-emoji'
  | 'unexpected-bidi-marker'
  | 'unexpected-script'
  | 'invalid-first-char'
  | 'invalid-char' {
  if (typeof s !== 'string') return 'not-a-string';

  // console.log([...s].map((x) => x.codePointAt(0)!.toString(16)).join(' '));

  if (s === '') return 'empty-string';

  // MathJSON symbols are always stored in Unicode NFC canonical order.
  // See https://unicode.org/reports/tr15/
  if (s.normalize() !== s) return 'expected-nfc';

  // Does the string contain any bidi marker?
  // See https://www.unicode.org/L2/L2022/22028-bidi-prog.pdf
  // > For identifiers, there should be no need to allow
  // > [bidi control characters] at all, even if formally allowed.
  if (/[\u200E\u200F\u2066-\u2069\u202A-\u202E]/.test(s))
    return 'unexpected-bidi-marker';

  // Does the string contains some emojis (or flags) mixed with other characters?
  if (ONLY_EMOJIS.test(s)) return 'valid';
  if (/\p{XIDC}/u.test(s) && SOME_EMOJI.test(s))
    return 'unexpected-mixed-emoji';

  // Does the string contain scripts that are not recommended?
  if (!isRecommendedScripts(s)) return 'unexpected-script';

  // It's a supported script, but is it a valid identifier?
  if (!isValidIdentifier(s)) {
    if (!isValidIdentifier(s[0])) return 'invalid-first-char';
    return 'invalid-char';
  }

  return 'valid';
}

/**  If expr is a string literal, return it.
 *
 * A string literal is a JSON string that begins and ends with
 * **U+0027 APOSTROPHE** : **`'`** or an object literal with a `str` key.
 */
export function stringValue(
  expr: Expression | null | undefined
): string | null {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === 'object' && 'str' in expr) return expr.str;
  if (typeof expr !== 'string') return null;
  if (expr.length < 2) return null;
  if (expr[0] !== "'" || expr[expr.length - 1] !== "'") return null;
  return expr.substring(1, expr.length - 1);
}

export function stripText(
  expr: Expression | null | undefined
): Expression | null {
  if (expr === null || expr === undefined || stringValue(expr) !== null)
    return null;

  const h = head(expr);
  if (h == null) return expr;
  return [
    h as MathJsonIdentifier | MathJsonFunction,
    ...(ops(expr) ?? []).map((x) => stripText(x)!).filter((x) => x !== null),
  ];
}

/**
 * The head of a function can be an identifier or an expression.
 *
 * Return `null` if the expression is not a function.
 *
 * Examples:
 * * `["Negate", 5]`  -> `"Negate"`
 * * `[["Prime", "f"], "x"]` -> `["Prime", "f"]`
 */
export function head(expr: Expression | null | undefined): Expression | null {
  if (Array.isArray(expr)) {
    if (typeof expr[0] === 'string' && !isValidIdentifier(expr[0])) {
      console.error(
        `Invalid identifier "${expr[0]}": ${validateIdentifier(expr[0])}`
      );
      return null;
    }
    return expr[0];
  }

  if (expr === null || expr === undefined) return null;

  if (isFunctionObject(expr)) return expr.fn[0];

  return null;
}

/** Return the head of an expression, only if it's a string */
export function headName(expr: Expression | null): string {
  const h = head(expr);
  return typeof h === 'string' ? h : '';
}

/**
 * Return all the elements but the first one, i.e. the arguments of a
 * function.
 */
export function ops(expr: Expression | null | undefined): Expression[] | null {
  if (Array.isArray(expr)) return expr.slice(1);

  if (expr === null || expr === undefined) return null;

  if (isFunctionObject(expr)) return expr.fn.slice(1);

  return null;
}

/** Return the nth argument of a function expression */
export function op(
  expr: Expression | null | undefined,
  n: number
): Expression | null {
  if (Array.isArray(expr)) return expr[n] ?? null;

  if (expr === null || expr === undefined) return null;

  if (isFunctionObject(expr)) return expr.fn[n] ?? null;

  return null;
}

export function op1(expr: Expression | null | undefined): Expression | null {
  return op(expr, 1);
}

export function op2(expr: Expression | null | undefined): Expression | null {
  return op(expr, 2);
}

export function nops(expr: Expression | null | undefined): number {
  if (expr === null || expr === undefined) return 0;
  if (Array.isArray(expr)) return Math.max(0, expr.length - 1);
  if (isFunctionObject(expr)) return Math.max(0, expr.fn.length - 1);
  return 0;
}

export function unhold(expr: Expression | null | undefined): Expression | null {
  if (expr === null || expr === undefined) return null;
  if (head(expr) === 'Hold') return op(expr, 1);
  return expr;
}

export function symbol(expr: Expression | null | undefined): string | null {
  if (typeof expr === 'string') {
    // Is it a number?
    if (/^[+-]?[0-9\.]/.test(expr)) return null;
    // Is it a string literal?
    if (expr.length >= 2 && expr[0] === "'" && expr[expr.length - 1] === "'")
      return null;
    return expr;
  }

  if (expr === null || expr === undefined) return null;

  const s = isSymbolObject(expr) ? expr.sym : expr;
  if (typeof s !== 'string') return null;

  return s;
}

function keyValuePair(
  expr: Expression | null
): null | [key: string, value: Expression] {
  const h = head(expr);
  if (h === 'KeyValuePair' || h === 'Tuple' || h === 'Pair') {
    const key = stringValue(op1(expr));
    if (!key) return null;
    return [key, op2(expr) ?? 'Nothing'];
  }

  return null;
}

export function dictionary(
  expr: Expression | null
): null | Record<string, Expression> {
  if (expr === null) return null;
  if (typeof expr === 'object' && 'dict' in expr) return expr.dict;

  const kv = keyValuePair(expr);
  if (kv) return { [kv[0]]: kv[1] };

  const h = head(expr);
  if (h === 'Dictionary') {
    const result = {};
    for (let i = 1; i < nops(expr); i++) {
      const kv = keyValuePair(op(expr, i));
      if (kv) result[kv[0]] = kv[1];
    }

    return result;
  }

  return null;
}

function machineValueOfString(s: string): number | null {
  s = s
    .toLowerCase()
    .replace(/[0-9][nd]$/, '')
    .replace(/[\u0009-\u000d\u0020\u00a0]/g, '');

  if (s === 'nan') return NaN;
  if (s === 'infinity' || s === '+infinity') return Infinity;
  if (s === '-infinity') return -Infinity;

  // Are there some repeating decimals?
  if (/\([0-9]+\)/.test(s)) {
    const [_, body, repeat, trail] = s.match(/(.+)\(([0-9]+)\)(.*)$/) ?? [];
    s = body + repeat.repeat(Math.ceil(16 / repeat.length)) + (trail ?? '');
  }
  // CAUTION: By using parseFloat, numbers with a precision greater than
  // machine range will be truncated. Numbers with an exponent outside of the
  // machine range will be returned as `Infinity` or `-Infinity`
  return parseFloat(s);
}

/**
 *  CAUTION: `machineValue()` will return a truncated value if the number
 *  has a precision outside of the machine range.
 */
export function machineValue(
  expr: Expression | null | undefined
): number | null {
  if (typeof expr === 'number') return expr;

  if (typeof expr === 'string') return machineValueOfString(expr);

  if (expr === null || expr === undefined) return null;

  // Stricly, expr.num should be a string, but we allow it to be a number
  if (isNumberObject(expr)) return machineValue(expr.num);

  return null;
}

/**
 * Return a rational (numer over denom) representation of the expression,
 * if possible, `null` otherwise.
 *
 * The expression can be:
 * - Some symbols: "Infinity", "Half"...
 * - ["Power", d, -1]
 * - ["Power", n, 1]
 * - ["Divide", n, d]
 *
 * The denominator is always > 0.
 */
export function rationalValue(
  expr: Expression | undefined | null
): [number, number] | null {
  if (expr === undefined || expr === null) return null;

  if (symbol(expr) === 'Half') return [1, 2];

  const h = head(expr);
  if (!h) return null;

  let numer: number | null = null;
  let denom: number | null = null;

  if (h === 'Negate') {
    const r = rationalValue(op1(expr));
    if (r) return [-r[0], r[1]];
  }

  if (h === 'Rational' || h === 'Divide') {
    numer = machineValue(op1(expr)) ?? NaN;
    denom = machineValue(op2(expr)) ?? NaN;
  }

  if (h === 'Power') {
    const exponent = machineValue(op2(expr));
    if (exponent === 1) {
      numer = machineValue(op1(expr));
      denom = 1;
    } else if (exponent === -1) {
      numer = 1;
      denom = machineValue(op1(expr));
    }
  }

  if (
    h === 'Multiply' &&
    head(op2(expr)) === 'Power' &&
    machineValue(op2(op2(expr))) === -1
  ) {
    numer = machineValue(op1(expr));
    denom = machineValue(op1(op2(expr)));
  }

  if (numer === null || denom === null) return null;

  if (Number.isInteger(numer) && Number.isInteger(denom)) return [numer, denom];

  return null;
}

export function applyRecursively<T extends Expression = Expression>(
  expr: T,
  fn: (x: T) => T
): Expression {
  const h = head(expr);
  if (h !== null) {
    return [
      fn(h as T) as MathJsonIdentifier | MathJsonFunction,
      ...(ops(expr) ?? []).map(fn),
    ];
  }
  const dict = dictionary(expr);
  if (dict !== null) {
    const keys = Object.keys(dict);
    const result = {};
    for (const key of keys) result[key] = fn(dict[key] as T);
    return { dict: result };
  }
  return fn(expr);
}

export function subs(
  expr: Expression,
  s: { [symbol: string]: Expression }
): Expression {
  const h = head(expr);
  if (h !== null)
    return [
      subs(h, s) as MathJsonIdentifier | MathJsonFunction,
      ...(ops(expr) ?? []).map((x) => subs(x, s)),
    ];

  const dict = dictionary(expr);
  if (dict !== null) {
    const keys = Object.keys(dict);
    const result = {};
    for (const key of keys) result[key] = subs(dict[key], s);
    return { dict: result };
  }

  const sym = symbol(expr);
  if (sym && s[sym]) return s[sym];

  return expr;
}

/**
 * Apply a function to the arguments of a function and return an array of T
 */
export function mapArgs<T>(expr: Expression, fn: (x: Expression) => T): T[] {
  let args: Expression[] | null = null;
  if (Array.isArray(expr)) args = expr;
  if (isFunctionObject(expr)) args = expr.fn;
  if (args === null) return [];
  let i = 1;
  const result: T[] = [];
  while (i < args.length) {
    result.push(fn(args[i]));
    i += 1;
  }

  return result;
}

/**
 * Assuming that op is an associative operator, fold lhs or rhs
 * if either are the same operator.
 */
export function foldAssociativeOperator(
  op: string,
  lhs: Expression,
  rhs: Expression
): Expression {
  const lhsName = head(lhs);
  const rhsName = head(rhs);

  if (lhsName === op && rhsName === op)
    return [op, ...(ops(lhs) ?? []), ...(ops(rhs) ?? [])];

  if (lhsName === op) return [op, ...(ops(lhs) ?? []), rhs];
  if (rhsName === op) return [op, lhs, ...(ops(rhs) ?? [])];
  return [op, lhs, rhs];
}

/** Return the elements of a sequence, or null if the expression is not a sequence. The sequence can be optionally enclosed by a`["Delimiter"]` expression  */
export function getSequence(expr: Expression | null): Expression[] | null {
  if (expr === null) return null;

  let h = head(expr);
  if (h === 'Delimiter') {
    expr = op(expr, 1);
    if (expr === null) return [];
    h = head(expr);
    if (h !== 'Sequence') return [expr];
  }

  if (h !== 'Sequence') return null;

  return ops(expr) ?? [];
}

export function isEmptySequence(expr: Expression | null): boolean {
  return head(expr) === 'Sequence' && nops(expr) === 0;
}

export function missingIfEmpty(expr: Expression | null): Expression {
  if (isEmptySequence(expr)) return MISSING;
  return expr ?? MISSING;
}

function countFunctionLeaves(xs: Expression[]): number {
  if (xs[0] === 'Square') {
    // Square is synonym with Power(..., 2)
    return countFunctionLeaves(xs.slice(1)) + 2;
  }
  return xs.reduce<number>((acc, x) => acc + countLeaves(x), 0);
}

/** The number of leaves (atomic expressions) in the expression */
export function countLeaves(expr: Expression | null): number {
  if (expr === null) return 0;
  if (typeof expr === 'number' || typeof expr === 'string') return 1;
  if (isNumberExpression(expr) || isSymbolObject(expr) || isStringObject(expr))
    return 1;

  if (Array.isArray(expr)) return countFunctionLeaves(expr);
  if ('fn' in expr) return countFunctionLeaves(expr.fn);

  const dict = dictionary(expr);
  if (dict) {
    const keys = Object.keys(dict);
    return (
      1 +
      keys.length +
      keys.reduce<number>((acc, x) => acc + countLeaves(dict[x]), 0)
    );
  }

  return 0;
}
