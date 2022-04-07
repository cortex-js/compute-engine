import {
  Expression,
  MathJsonFunction,
  MathJsonNumber,
  MathJsonString,
  MathJsonSymbol,
} from './math-json-format';

/**
 * These constants are the 'primitive' functions and constants that are used
 * for some basic manipulations such as parsing, and transforming to canonical
 * form.
 *
 */
export const IDENTITY = 'Identity';
export const LIST = 'List';

export const ADD = 'Add';
export const DERIVATIVE = 'Derivative';
export const DIVIDE = 'Divide';
export const EXP = 'Exp';
export const MULTIPLY = 'Multiply';
export const NEGATE = 'Negate';
export const POWER = 'Power';
export const PRIME = 'Prime';
export const ROOT = 'Root';
export const SQRT = 'Sqrt';
export const SUBTRACT = 'Subtract';

export const COMPLEX_INFINITY = 'ComplexInfinity';
export const PI = 'Pi';
export const EXPONENTIAL_E = 'ExponentialE';
export const IMAGINARY_UNIT = 'ImaginaryUnit';

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

/**
 * True if the expression is a number, a symbol or a string
 * (i.e. not a function and not a dictionary)
 */
export function isAtomic(expr: Expression | null): boolean {
  return (
    expr === null ||
    (!Array.isArray(expr) &&
      (typeof expr !== 'object' || !('fn' in expr || 'dic' in expr)))
  );
}

/**  If expr is a string literal, return it.
 *
 * A string literal is a JSON string that begins and ends with
 * **U+0027 APOSTROPHE** : **`'`** or an object literal with a `str` key.
 */
export function stringValue(expr: Expression | null): string | null {
  if (expr === null) return null;
  if (typeof expr === 'object' && 'str' in expr) return expr.str;
  if (typeof expr !== 'string') return null;
  if (expr.length < 2) return null;
  if (expr[0] !== "'" || expr[expr.length - 1] !== "'") return null;
  return expr.substring(1, expr.length - 1);
}

/**
 * The head of a function can be a string or an expression.
 *
 * Return `null` if the expression is not a function.
 *
 * Examples:
 * * `["Negate", 5]`  -> `"Negate"`
 * * `[["Prime", "f"], "x"]` -> `["Prime", "f"]`
 */
export function head(expr: Expression | null): Expression | null {
  if (expr === null) return null;
  if (Array.isArray(expr)) return expr[0];
  if (isFunctionObject(expr)) return expr.fn[0];
  return null;
}

/** Return the head of an expression, only if it's a string */
export function headName(expr: Expression | null): string {
  const h = head(expr);
  return typeof h === 'string' ? h : '';
}

export function op(expr: Expression | null, n: number): Expression | null {
  if (expr === null) return null;

  if (Array.isArray(expr)) return expr[n] ?? null;

  if (isFunctionObject(expr)) return expr.fn[n] ?? null;

  return null;
}

export function nops(expr: Expression): number {
  if (Array.isArray(expr)) {
    return Math.max(0, expr.length - 1);
  }
  if (isFunctionObject(expr)) {
    return Math.max(0, expr.fn.length - 1);
  }
  return 0;
}

export function symbol(expr: Expression | null): string | null {
  if (expr === null) return null;
  const s = isSymbolObject(expr) ? expr.sym : expr;
  if (typeof s !== 'string') return null;
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    // It's a string literal, not a symbol
    return null;
  }
  return s;
}

export function string(expr: Expression | null): string | null {
  if (expr === null) return null;
  const s = isSymbolObject(expr) ? expr.sym : expr;
  if (typeof s !== 'string') return null;
  if (s.length < 2 || s[0] !== "'" || s[s.length - 1] !== "'") {
    // It's a symbol
    return null;
  }
  return s.slice(1, -1);
}

function keyValuePair(
  expr: Expression | null
): null | [key: string, value: Expression] {
  const h = head(expr);
  if (h === 'KeyValuePair' || h === 'Tuple' || h === 'Pair') {
    const key = string(op(expr, 1));
    if (!key) return null;
    return [key, op(expr, 2) ?? 'Nothing'];
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
  if (h === 'List' || h === 'Dictionary') {
    const result = {};
    for (let i = 1; i < nops(expr); i++) {
      const kv = keyValuePair(op(expr, i));
      if (kv) result[kv[0]] = kv[1];
    }

    return result;
  }

  return null;
}

export function machineValue(expr: Expression | null): number | null {
  if (expr === null) return null;
  if (typeof expr === 'number') return expr;
  if (isNumberObject(expr)) return parseFloat(expr.num);

  const sym = symbol(expr);
  if (sym === 'NaN') return NaN;
  if (sym === '+Infinity') return Infinity;
  if (sym === '-Infinity') return -Infinity;
  return null;
}

/**
 * Return a rational (numer over denom) representation of the expression,
 * if possible, `[null, null]` otherwise.
 *
 * The expression can be:
 * - Some symbols: "ThreeQuarte", "Half"...
 * - ["Power", d, -1]
 * - ["Power", n, 1]
 * - ["Divide", n, d]
 *
 * The denominator is always > 0.
 */
export function rationalValue(
  expr: Expression
): [number, number] | [null, null] {
  // const symbol = getSymbolName(expr);
  // if (symbol === 'ThreeQuarter') return [3, 4];
  // if (symbol === 'TwoThird') return [2, 3];
  // if (symbol === 'Half') return [1, 2];
  // if (symbol === 'Third') return [1, 3];
  // if (symbol === 'Quarter') return [1, 4];

  if (isAtomic(expr)) return [null, null];

  const h = head(expr);
  if (!h) return [null, null];

  let numer: number | null = null;
  let denom: number | null = null;

  if (h === 'Negate') {
    [numer, denom] = rationalValue(op(expr, 1) ?? 'Missing');
    if (numer !== null && denom !== null) {
      return [-numer, denom];
    }
  }

  if (h === 'Rational') {
    return [
      machineValue(op(expr, 1) ?? NaN) ?? NaN,
      machineValue(op(expr, 2) ?? NaN) ?? NaN,
    ];
  }

  if (h === 'Power') {
    const exponent = machineValue(op(expr, 2));
    if (exponent === 1) {
      numer = machineValue(op(expr, 1)) ?? null;
      denom = 1;
    } else if (exponent === -1) {
      numer = 1;
      denom = machineValue(op(expr, 1)) ?? null;
    }
  }

  if (h === 'Divide') {
    numer = machineValue(op(expr, 1)) ?? null;
    denom = machineValue(op(expr, 2)) ?? null;
  }

  if (
    h === 'Multiply' &&
    head(op(expr, 2)) === POWER &&
    machineValue(op(op(expr, 2), 2)) === -1
  ) {
    numer = machineValue(op(expr, 1)) ?? null;
    denom = machineValue(op(op(expr, 2), 1)) ?? null;
  }

  if (numer === null || denom === null) return [null, null];

  if (Number.isInteger(numer) && Number.isInteger(denom)) {
    return [numer, denom];
  }
  return [null, null];
}

/**
 * Return all the elements but the first one, i.e. the arguments of a
 * function.
 */
export function tail(expr: Expression | null): Expression[] {
  if (Array.isArray(expr)) {
    return expr.slice(1);
  }
  if (isFunctionObject(expr)) {
    return expr.fn.slice(1);
  }
  return [];
}

export function applyRecursively(
  expr: Expression,
  fn: (x: Expression) => Expression
): Expression {
  const h = head(expr);
  if (h !== null) {
    return [fn(h), ...tail(expr).map(fn)];
  }
  const dict = dictionary(expr);
  if (dict !== null) {
    const keys = Object.keys(dict);
    const result = {};
    for (const key of keys) result[key] = fn(dict[key]);
    return { dict: result };
  }
  return fn(expr);
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
 * Return num as a number if it's a valid JSON number (that is
 * a valid JavaScript number but not NaN or +/-Infinity) or
 * as a string otherwise
 */

export function asValidJSONNumber(num: string): string | number {
  if (typeof num === 'string') {
    const val = Number(num);
    if (num[0] === '+') num = num.slice(1);
    if (val.toString() === num) {
      // If the number roundtrips, it can be represented by a
      // JavaScript number
      // However, NaN and Infinity cannot be represented by JSON
      if (isNaN(val) || !isFinite(val)) {
        return val.toString();
      }
      return val;
    }
  }
  return num;
}

/**
 * Apply the operator `op` to the left-hand-side and right-hand-side
 * expression. Applies the associativity rule specified by the definition,
 * i.e. 'op(a, op(b, c))` -> `op(a, b, c)`, etc...
 *
 */
export function applyAssociativeOperator(
  op: string,
  lhs: Expression,
  rhs: Expression,
  associativity: 'right' | 'left' | 'non' | 'both' = 'both'
): Expression {
  if (associativity === 'non') return [op, lhs, rhs];

  const lhsName = head(lhs);
  const rhsName = head(rhs);

  if (associativity === 'left') {
    if (lhsName === op) return [op, ...(tail(lhs) ?? []), rhs];
    return [op, lhs, rhs];
  }

  if (associativity === 'right') {
    if (rhsName === op) return [op, lhs, ...(tail(rhs) ?? [])];
    return [op, lhs, rhs];
  }

  // Associativity: 'both'
  if (lhsName === op && rhsName === op) {
    return [op, ...(tail(lhs) ?? []), ...(tail(rhs) ?? [])];
  }
  if (lhsName === op) return [op, ...(tail(lhs) ?? []), rhs];
  if (rhsName === op) return [op, lhs, ...(tail(rhs) ?? [])];
  return [op, lhs, rhs];
}

export function getSequence(expr: Expression | null): Expression[] | null {
  const h = head(expr);
  if (expr === null) return null;

  if (h === 'Delimiter') expr = op(expr, 1) ?? null;

  if (expr === null) return null;

  if (h === 'Sequence') return tail(expr) ?? [];
  return null;
}

export function isValidSymbolName(s: string): boolean {
  // A symbol name must not contain any of these characters
  if (/[\u0000-\u0020\u0022\u0060\ufffe\uffff]/.test(s)) return false;

  // A symbol name must not start with one these characters
  if (
    /^[\u0021\u0022\u0024-\u002e\u003a\u003f\u0040\u005b\u005d\u005e\u007b\u007d\u007e]$/.test(
      s[0]
    )
  )
    return false;
  return true;
}
